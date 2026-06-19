// Potomac Pulse — Client-side ES module copy of shared model pure math
// SYNC WARNING: Server canonical source is netlify/functions/shared/model.js
// This file contains ONLY pure math/constants — NO Supabase dependency.
// When changing model constants, formulas, or logic, update BOTH files + tests.

import { TRAVEL_COEF, TRAVEL_EXP, MEDIAN_TRAVEL, TRAVEL_POR_GF_BASELINE, TRAVEL_GF_LF_BASELINE, GF_FLOW_BINS, CEILING_RATIO } from './constants.js';

// --- Hierarchical correction fallback (v35.1) ---
// SOURCE OF TRUTH: netlify/functions/shared/model.js — keep client copy in sync

/**
 * Returns a correction bin's scalar correction value, preferring the EMA-smoothed mean over the raw mean.
 * @param {Object} stateData - One (flowBin × flowState) bin's stats; may have {number} emaMeanError and/or {number} meanError.
 * @returns {number} The EMA mean error if present, else the raw mean error, else 0.
 */
export function getBinCorrection(stateData) {
    if (stateData.emaMeanError !== undefined) return stateData.emaMeanError;
    return stateData.meanError || 0;
}

/**
 * Computes a hierarchical fallback correction when a (flowBin × flowState) bin has too few observations.
 * Falls back through: same-bin count-weighted average of states with ≥5 obs → adjacent-bin same-state (or steady) with ≥5 obs → 0.
 * @param {Object} correctionBins - Map of flowBin → { rising, falling, steady } stats objects.
 * @param {string} flowBin - The target flow bin key (e.g. '3000-6000').
 * @param {string} flowState - The flow state ('rising' | 'falling' | 'steady').
 * @returns {number} The fallback correction value, or 0 if none qualifies.
 */
export function getFallbackCorrection(correctionBins, flowBin, flowState) {
    const bin = correctionBins[flowBin];
    if (bin) {
        const states = ['rising', 'falling', 'steady'];
        let totalWeight = 0;
        let weightedSum = 0;
        for (const s of states) {
            const sd = bin[s];
            if (sd && sd.count >= 5) {
                weightedSum += sd.count * getBinCorrection(sd);
                totalWeight += sd.count;
            }
        }
        if (totalWeight > 0) return weightedSum / totalWeight;
    }

    const idx = GF_FLOW_BINS.indexOf(flowBin);
    const neighbors = [idx - 1, idx + 1].filter(i => i >= 0 && i < GF_FLOW_BINS.length);
    for (const ni of neighbors) {
        const neighbor = correctionBins[GF_FLOW_BINS[ni]];
        if (!neighbor) continue;
        const sd = neighbor[flowState] || neighbor['steady'];
        if (sd && sd.count >= 5) return getBinCorrection(sd);
    }

    return 0;
}

// --- Flow bins ---

export { GF_FLOW_BINS };

/**
 * Maps a flow value in cfs to its discrete Great Falls flow bin key.
 * @param {number} cfs - Flow in cubic feet per second.
 * @returns {string} The flow bin key (one of GF_FLOW_BINS).
 */
export function getGFFlowBin(cfs) {
    if (cfs < 3000) return '0-3000';
    if (cfs < 6000) return '3000-6000';
    if (cfs < 12000) return '6000-12000';
    if (cfs < 25000) return '12000-25000';
    if (cfs < 50000) return '25000-50000';
    return '50000+';
}

// Pure hierarchical correction lookup (v36.0). Byte-identical to the server copy in
// netlify/functions/shared/model.js — keep in sync (the correction-parity test asserts equality).
/**
 * Pure hierarchical correction lookup for a (flowBin, flowState); blends the bin's own EMA with the
 * hierarchical fallback while the bin has <5 obs, crossing smoothly to the bin value at 5 obs.
 * @param {Object|null} correctionBins - Map of flowBin → { rising, falling, steady } stats; returns 0 if falsy.
 * @param {string} flowBin - The target flow bin key (e.g. '3000-6000').
 * @param {string} flowState - The flow state ('rising' | 'falling' | 'steady').
 * @returns {number} The blended correction value.
 */
export function getGFCorrection(correctionBins, flowBin, flowState) {
    if (!correctionBins) return 0;

    const bin = correctionBins[flowBin];
    const stateData = bin?.[flowState] || bin?.['steady'];
    const count = stateData?.count || 0;

    if (count >= 5) return getBinCorrection(stateData);

    const fallback = getFallbackCorrection(correctionBins, flowBin, flowState);
    const weight = count / 5;
    const binVal = count > 0 ? getBinCorrection(stateData) : 0;
    return weight * binVal + (1 - weight) * fallback;
}

// --- C45 (v37.0): flow-edge transition smoothing of the APPLIED correction ---
// Removes the displayed step as flow crosses the LOW/MID bin boundaries (3k/6k/12k) by ramping the
// correction linearly (in log flow) within a ±CORR_SMOOTH_BAND band around each boundary; flows away from a
// boundary keep their exact binned correction. The 25000/50000 boundaries are deliberately LEFT as steps —
// the correction is genuine high-flow regime structure there (backtest: smoothing them degraded the
// 25-50k bin). Learning is unchanged (bins still keyed by getGFFlowBin(rawFinal)); only the APPLICATION is
// continuous, so there is no learn↔apply feedback. Byte-identical to the server copy
// (netlify/functions/shared/model.js) — keep in sync; the correction-parity test asserts equality.
export const CORR_SMOOTH_BAND = 0.12;   // ±12% flow around each smoothed boundary (gated value)
export const CORR_SMOOTH_BOUNDARIES = [
    { B: 3000,  below: '0-3000',     above: '3000-6000' },
    { B: 6000,  below: '3000-6000',  above: '6000-12000' },
    { B: 12000, below: '6000-12000', above: '12000-25000' },
];
/**
 * Flow-continuous correction lookup: ramps linearly (in log flow) between adjacent bins' corrections within
 * a ±CORR_SMOOTH_BAND band around the low/mid boundaries (3k/6k/12k); away from a boundary returns the exact binned value.
 * @param {Object|null} correctionBins - Map of flowBin → { rising, falling, steady } stats; returns 0 if falsy.
 * @param {number} flowCFS - Flow in cfs (floored to 1 internally for the log).
 * @param {string} flowState - The flow state ('rising' | 'falling' | 'steady').
 * @returns {number} The flow-continuous correction value.
 */
export function getGFCorrectionInterpolated(correctionBins, flowCFS, flowState) {
    if (!correctionBins) return 0;
    const f = Math.max(flowCFS, 1);
    const lnf = Math.log(f);
    for (const bd of CORR_SMOOTH_BOUNDARIES) {
        const lnLo = Math.log(bd.B / (1 + CORR_SMOOTH_BAND));
        const lnHi = Math.log(bd.B * (1 + CORR_SMOOTH_BAND));
        if (lnf > lnLo && lnf < lnHi) {                 // inside a smoothed boundary's band → ramp
            const t = (lnf - lnLo) / (lnHi - lnLo);
            const cLo = getGFCorrection(correctionBins, bd.below, flowState);
            const cHi = getGFCorrection(correctionBins, bd.above, flowState);
            return (1 - t) * cLo + t * cHi;
        }
    }
    return getGFCorrection(correctionBins, getGFFlowBin(f), flowState);  // away from a smoothed boundary → own bin (exact)
}

// Assemble the 18-bin correction structure from raw DB rows; skips stage_* keys.
// Mirror of server buildCorrectionBins — keep in sync.
/**
 * Assembles the 18-bin (6 flow bins × 3 states) correction structure from raw DB rows, seeding every
 * (bin × state) empty and overlaying matching rows; skips stage_* keys (a separate rating-curve series).
 * @param {Array<Object>} rows - DB rows, each with {string} gauge_id ('<flowBin>_<flowState>') and {Object} data; non-array yields empty bins.
 * @returns {Object} Map of flowBin → { rising, falling, steady } stats objects.
 */
export function buildCorrectionBins(rows) {
    const correctionBins = {};
    GF_FLOW_BINS.forEach(bin => {
        correctionBins[bin] = {
            rising:  { count: 0, sumError: 0, sumErrorSq: 0, meanError: 0 },
            falling: { count: 0, sumError: 0, sumErrorSq: 0, meanError: 0 },
            steady:  { count: 0, sumError: 0, sumErrorSq: 0, meanError: 0 }
        };
    });
    if (Array.isArray(rows)) {
        rows.forEach(b => {
            if (!b || typeof b.gauge_id !== 'string') return;
            if (b.gauge_id.startsWith('stage_')) return;  // separate stage-error series
            const [flowBin, flowState] = b.gauge_id.split('_');
            if (correctionBins[flowBin] && correctionBins[flowBin][flowState]) {
                correctionBins[flowBin][flowState] = b.data;
            }
        });
    }
    return correctionBins;
}

// End-apply, unit gain (v36.0). Byte-identical to the server copy — see netlify/functions/shared/model.js.
// correctedFinal = rawFinalUnclipped − correction, then a display-only 120%-LF ceiling guard.
// The correction is looked up off the bin of the UNCLIPPED raw final (= the bin the EMA learns into).
/**
 * Turns a raw final estimate into the corrected/displayed estimate: subtracts the flow-continuous correction,
 * then applies a display-only 120%-of-LF ceiling guard. The correction is looked up off the unclipped raw's bin (== the learn-bin).
 * @param {Object} params - Destructured input.
 * @param {number} params.rawFinalUnclipped - Raw final GF estimate in cfs (also the learn-bin source).
 * @param {number} params.lfCFS - Observed Little Falls flow in cfs; ceiling applied only when > 0.
 * @param {Object|null} params.correctionBins - Map of flowBin → { rising, falling, steady } stats.
 * @param {string} params.flowState - The flow state ('rising' | 'falling' | 'steady').
 * @returns {{flowBin: string, correction: number, correctedFinalUnclipped: number, correctedFinal: number, ceilingApplied: boolean}} Correction telemetry and the corrected estimate.
 */
export function applyGFCorrection({ rawFinalUnclipped, lfCFS, correctionBins, flowState }) {
    const flowBin = getGFFlowBin(rawFinalUnclipped);   // still the discrete learn-bin (telemetry + CI lookup)
    const correction = getGFCorrectionInterpolated(correctionBins, rawFinalUnclipped, flowState);  // C45 v37.0: continuous in flow
    const correctedFinalUnclipped = rawFinalUnclipped - correction;

    let correctedFinal = correctedFinalUnclipped;
    let ceilingApplied = false;
    if (lfCFS > 0) {
        const maxEstimate = lfCFS * CEILING_RATIO;
        if (correctedFinal > maxEstimate) {
            correctedFinal = maxEstimate;
            ceilingApplied = true;
        }
    }

    return { flowBin, correction, correctedFinalUnclipped, correctedFinal, ceilingApplied };
}

// --- LF stage estimation (flow → stage) ---

/**
 * Estimates Little Falls gauge stage (feet) from flow via the piecewise-linear rating curve.
 * @param {number} cfs - Flow in cubic feet per second.
 * @returns {number} Estimated stage in feet.
 */
export function estimateLFStage(cfs) {
    if (cfs < 600) return 2.40 + (cfs / 600) * 0.06;
    if (cfs < 1300) return 2.46 + ((cfs - 600) / 700) * 0.23;
    if (cfs < 2000) return 2.69 + ((cfs - 1300) / 700) * 0.14;
    if (cfs < 2600) return 2.83 + ((cfs - 2000) / 600) * 0.13;
    if (cfs < 3200) return 2.96 + ((cfs - 2600) / 600) * 0.13;
    if (cfs < 3600) return 3.09 + ((cfs - 3200) / 400) * 0.07;
    if (cfs < 4200) return 3.16 + ((cfs - 3600) / 600) * 0.07;
    if (cfs < 5000) return 3.23 + ((cfs - 4200) / 800) * 0.12;
    if (cfs < 5700) return 3.35 + ((cfs - 5000) / 700) * 0.11;
    if (cfs < 7500) return 3.46 + ((cfs - 5700) / 1800) * 0.21;
    if (cfs < 10000) return 3.67 + ((cfs - 7500) / 2500) * 0.28;
    if (cfs < 13000) return 3.95 + ((cfs - 10000) / 3000) * 0.34;
    if (cfs < 28000) return 4.29 + ((cfs - 13000) / 15000) * 1.21;
    if (cfs < 50000) return 5.50 + ((cfs - 28000) / 22000) * 1.29;
    if (cfs < 80000) return 6.79 + ((cfs - 50000) / 30000) * 1.57;
    if (cfs < 150000) return 8.36 + ((cfs - 80000) / 70000) * 2.57;
    return 10.93 + ((cfs - 150000) / 100000) * 2.5;
}

// --- LF flow estimation from stage (stage → flow, inverse rating curve) ---
// SOURCE OF TRUTH: netlify/functions/shared/model.js — keep client copy in sync

/**
 * Estimates Little Falls flow (cfs) from gauge stage via the inverse piecewise-linear rating curve.
 * @param {number} stage - Gauge stage in feet.
 * @returns {number} Estimated flow in cubic feet per second (0 below the 2.40 ft floor).
 */
export function estimateLFFlowFromStage(stage) {
    if (stage < 2.40) return 0;
    if (stage < 2.46) return ((stage - 2.40) / 0.06) * 600;
    if (stage < 2.69) return 600 + ((stage - 2.46) / 0.23) * 700;
    if (stage < 2.83) return 1300 + ((stage - 2.69) / 0.14) * 700;
    if (stage < 2.96) return 2000 + ((stage - 2.83) / 0.13) * 600;
    if (stage < 3.09) return 2600 + ((stage - 2.96) / 0.13) * 600;
    if (stage < 3.16) return 3200 + ((stage - 3.09) / 0.07) * 400;
    if (stage < 3.23) return 3600 + ((stage - 3.16) / 0.07) * 600;
    if (stage < 3.35) return 4200 + ((stage - 3.23) / 0.12) * 800;
    if (stage < 3.46) return 5000 + ((stage - 3.35) / 0.11) * 700;
    if (stage < 3.67) return 5700 + ((stage - 3.46) / 0.21) * 1800;
    if (stage < 3.95) return 7500 + ((stage - 3.67) / 0.28) * 2500;
    if (stage < 4.29) return 10000 + ((stage - 3.95) / 0.34) * 3000;
    if (stage < 5.50) return 13000 + ((stage - 4.29) / 1.21) * 15000;
    if (stage < 6.79) return 28000 + ((stage - 5.50) / 1.29) * 22000;
    if (stage < 8.36) return 50000 + ((stage - 6.79) / 1.57) * 30000;
    if (stage < 10.93) return 80000 + ((stage - 8.36) / 2.57) * 70000;
    return 150000 + ((stage - 10.93) / 2.5) * 100000;
}

// --- Flow-dependent EF weight ---
// SOURCE OF TRUTH: netlify/functions/shared/model.js — keep client copy in sync

/**
 * Computes the logistic blend weight for the Edwards Ferry power-law estimate (0 below 1000 cfs, ramping to 0.40 max, midpoint 10k cfs).
 * @param {number} estimatedFlow - Estimated flow in cfs.
 * @returns {number} EF blend weight in [0, 0.40].
 */
export function getEFWeight(estimatedFlow) {
    if (estimatedFlow < 1000) return 0.0;
    const W_MAX = 0.40;
    const K = 5.0;
    const MIDPOINT = Math.log(10000);
    return W_MAX / (1 + Math.exp(-K * (Math.log(estimatedFlow) - MIDPOINT)));
}

// --- Flow condition labels ---

/**
 * Maps a flow value to a human-readable condition label (Extreme Low … Major Flood).
 * @param {number} flow - Flow in cubic feet per second.
 * @returns {string} The flow condition label.
 */
export function getFlowCondition(flow) {
    if (flow < 2000) return "Extreme Low";
    if (flow < 3500) return "Low";
    if (flow < 4500) return "Below Normal";
    if (flow < 6000) return "Normal";
    if (flow < 10000) return "Above Normal";
    if (flow < 17000) return "Elevated";
    if (flow < 27000) return "High";
    if (flow < 50000) return "Very High";
    if (flow < 80000) return "Minor Flood";
    return "Major Flood";
}

// --- Travel time multiplier ---
// SOURCE OF TRUTH: netlify/functions/shared/model.js — keep client copy in sync

/**
 * Computes the flow-dependent travel-time scaling multiplier (relative to median travel) for a given LF flow.
 * @param {number} lfFlow - Little Falls flow in cfs (floored to 1000 internally).
 * @returns {{flow: number, mult: number, cond: string, travelHrs: number}} The clamped flow, travel-time multiplier, condition label, and raw travel hours.
 */
export function getFlowMultiplier(lfFlow) {
    const flow = Math.max(lfFlow, 1000);
    const travelHrs = TRAVEL_COEF * Math.pow(flow, TRAVEL_EXP);
    const mult = travelHrs / MEDIAN_TRAVEL;
    const cond = getFlowCondition(flow);
    return { flow, mult, cond, travelHrs };
}

// --- Travel-time helpers (wave-celerity adjusted) ---
// Canonical home for the PoR→GF / GF→LF travel-time helpers (moved here from
// great-falls.js in v36.4 so client and server share one node-importable source).
// SYNC WARNING: Server copy is netlify/functions/shared/model.js — keep in sync!
// Both take a SCALAR mult. Rising rivers propagate waves faster (reduction capped at 30%).
/**
 * Computes Point of Rocks → Great Falls travel time, reducing it (capped 30%) when the river is rising.
 * @param {number} mult - Scalar flow-dependent travel multiplier (from getFlowMultiplier).
 * @param {{flowState: string, ratePerHour: number}|null} [riseRate=null] - Optional rise-rate; reduction applies only when flowState is 'rising' and ratePerHour > 0.
 * @returns {number} Travel time in hours.
 */
export function getPoRtoGFTravelTime(mult, riseRate = null) {
    const baseTravelTime = TRAVEL_POR_GF_BASELINE * mult;
    if (riseRate && riseRate.flowState === 'rising' && riseRate.ratePerHour > 0) {
        const reductionFactor = Math.min(0.30, riseRate.ratePerHour * 0.02);
        return baseTravelTime * (1 - reductionFactor);
    }
    return baseTravelTime;
}

/**
 * Computes Great Falls → Little Falls travel time, reducing it (capped 30%) when the river is rising.
 * @param {number} mult - Scalar flow-dependent travel multiplier (from getFlowMultiplier).
 * @param {{flowState: string, ratePerHour: number}|null} [riseRate=null] - Optional rise-rate; reduction applies only when flowState is 'rising' and ratePerHour > 0.
 * @returns {number} Travel time in hours.
 */
export function getGFtoLFTravelTime(mult, riseRate = null) {
    const baseTravelTime = TRAVEL_GF_LF_BASELINE * mult;
    if (riseRate && riseRate.flowState === 'rising' && riseRate.ratePerHour > 0) {
        const reductionFactor = Math.min(0.30, riseRate.ratePerHour * 0.02);
        return baseTravelTime * (1 - reductionFactor);
    }
    return baseTravelTime;
}

// --- Flow state classification ---
// SOURCE OF TRUTH: netlify/functions/shared/model.js — keep client copy in sync

/**
 * Classifies the flow trend ('rising' | 'falling' | 'steady') by comparing the current flow to the reading ~6h ago.
 * Requires ≥8 history entries; the change must exceed max(100 cfs, 2% of current) to be non-steady.
 * @param {Array<{timestamp: number, cfs: number}>} history - Chronological readings (epoch ms + cfs).
 * @param {number} currentCFS - The current flow in cfs.
 * @returns {string} 'rising', 'falling', or 'steady'.
 */
export function getFlowState(history, currentCFS) {
    if (!history?.length || history.length < 8) return 'steady';

    const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);
    let pastReading = null;

    for (const r of history) {
        if (r.timestamp <= sixHoursAgo) {
            pastReading = r;
        }
    }

    if (!pastReading) return 'steady';

    const change = currentCFS - pastReading.cfs;
    const absChange = Math.abs(change);

    const minAbsChange = 100;
    const minPctChange = 0.02;
    const threshold = Math.max(minAbsChange, currentCFS * minPctChange);

    if (absChange >= threshold) {
        if (change > 0) return 'rising';
        if (change < 0) return 'falling';
    }
    return 'steady';
}

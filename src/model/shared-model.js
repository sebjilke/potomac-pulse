// Potomac Pulse — Client-side ES module copy of shared model pure math
// SYNC WARNING: Server canonical source is netlify/functions/shared/model.js
// This file contains ONLY pure math/constants — NO Supabase dependency.
// When changing model constants, formulas, or logic, update BOTH files + tests.

import { TRAVEL_COEF, TRAVEL_EXP, MEDIAN_TRAVEL, GF_FLOW_BINS, CEILING_RATIO } from './constants.js';

// --- Hierarchical correction fallback (v35.1) ---
// SOURCE OF TRUTH: netlify/functions/shared/model.js — keep client copy in sync

export function getBinCorrection(stateData) {
    if (stateData.emaMeanError !== undefined) return stateData.emaMeanError;
    return stateData.meanError || 0;
}

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

// Assemble the 18-bin correction structure from raw DB rows; skips stage_* keys.
// Mirror of server buildCorrectionBins — keep in sync.
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
export function applyGFCorrection({ rawFinalUnclipped, lfCFS, correctionBins, flowState }) {
    const flowBin = getGFFlowBin(rawFinalUnclipped);
    const correction = getGFCorrection(correctionBins, flowBin, flowState);
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

export function getEFWeight(estimatedFlow) {
    if (estimatedFlow < 1000) return 0.0;
    const W_MAX = 0.40;
    const K = 5.0;
    const MIDPOINT = Math.log(10000);
    return W_MAX / (1 + Math.exp(-K * (Math.log(estimatedFlow) - MIDPOINT)));
}

// --- Flow condition labels ---

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

export function getFlowMultiplier(lfFlow) {
    const flow = Math.max(lfFlow, 1000);
    const travelHrs = TRAVEL_COEF * Math.pow(flow, TRAVEL_EXP);
    const mult = travelHrs / MEDIAN_TRAVEL;
    const cond = getFlowCondition(flow);
    return { flow, mult, cond, travelHrs };
}

// --- Flow state classification ---
// SOURCE OF TRUTH: netlify/functions/shared/model.js — keep client copy in sync

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

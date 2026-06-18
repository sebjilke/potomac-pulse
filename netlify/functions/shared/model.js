// Potomac Pulse — Shared Server Module
// Canonical source for constants and functions used by both scheduled-update.js and sync-learning.js.
// Client-side copies live in src/model/shared-model.js (+ src/model/constants.js) — keep in sync for any model changes.

const { createClient } = require('@supabase/supabase-js');

// --- Supabase singleton ---

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;

function getSupabase() {
    if (!supabase && supabaseUrl && supabaseKey) {
        supabase = createClient(supabaseUrl, supabaseKey);
    }
    return supabase;
}

// --- Flow bins ---

const GF_FLOW_BINS = ['0-3000', '3000-6000', '6000-12000', '12000-25000', '25000-50000', '50000+'];

function getFlowBin(cfs) {
    if (cfs < 3000) return '0-3000';
    if (cfs < 6000) return '3000-6000';
    if (cfs < 12000) return '6000-12000';
    if (cfs < 25000) return '12000-25000';
    if (cfs < 50000) return '25000-50000';
    return '50000+';
}

// --- LF stage-to-flow inverse rating curve ---
// Piecewise linear interpolation from USGS field measurements at Little Falls (01646500)
// Used for ice/anomaly detection — if actual CFS is much lower than expected from stage,
// likely indicates frazil ice affecting ADVM velocity measurement.
// SYNC WARNING: Client copy is src/model/shared-model.js — keep in sync!

function estimateLFFlowFromStage(stage) {
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

// --- Travel time constants ---
// Searcy & Davis (1961) dye-tracer model × 0.80 empirical correction
// Investigated via cross-correlation on 117k obs (travel_time_audit.md).
// SYNC WARNING: Client copy is src/model/shared-model.js — keep in sync!

const TRAVEL_COEF = 4139;        // Adjusted (5174 × 0.80)
const TRAVEL_EXP = -0.5963;      // Searcy exponent (unchanged)
const MEDIAN_TRAVEL = 25.8;      // Adjusted (32.3 × 0.80)
const TRAVEL_POR_GF_BASELINE = 19.4;  // Adjusted (24.3 × 0.80)
const TRAVEL_GF_LF_BASELINE = 6.5;    // Adjusted (8.1 × 0.80)

// PoR-history retention (server). 72h > max PoR→GF travel (~50.6h at the 1,000-cfs
// floor) so the time-shift lookup is covered at every flow (C16, v36.4).
// SYNC WARNING: Client copy is src/model/constants.js:11 POR_HISTORY_MAX_AGE — keep in sync!
const POR_HISTORY_MAX_AGE = 72 * 60 * 60 * 1000; // 72 hours

// --- Edwards Ferry power-law model ---
// Updated 2026-02-18: Deduped dataset (v24.16)
// Cold water (≤10°C): 160 × EF^2.36 (deduped fit, R²=0.96)
// Default (>10°C): 126 × EF^2.46 (deduped fit, R²=0.91)
// SYNC WARNING: Client copy is src/model/shared-model.js — keep in sync!

const EF_MODEL = {
    coef: 126,
    exp: 2.46,
    coldCoef: 160,
    coldExp: 2.36,
    coldMaxTemp: 10,
    minStage: 2.5,
    maxStage: 20.0
};

// --- Flow-dependent EF weight ---
// v30.0: Logistic EF weight ramp — smooth 0% → 40%, midpoint 10k cfs.
// Calibrated via Approach 5 horse race on 117,704 hourly obs (2011-2026).
// SYNC WARNING: Client copy is src/model/shared-model.js — keep in sync!

function getEFWeight(estimatedFlow) {
    if (estimatedFlow < 1000) return 0.0;
    const W_MAX = 0.40;
    const K = 5.0;
    const MIDPOINT = Math.log(10000);
    return W_MAX / (1 + Math.exp(-K * (Math.log(estimatedFlow) - MIDPOINT)));
}

// --- Flow multiplier for travel time scaling ---
// SYNC WARNING: Client copy is src/model/shared-model.js — keep in sync!

function getFlowMultiplier(lfFlow) {
    const flow = Math.max(lfFlow, 1000);
    const travelHrs = TRAVEL_COEF * Math.pow(flow, TRAVEL_EXP);
    return travelHrs / MEDIAN_TRAVEL;
}

// --- Travel-time helpers (wave-celerity adjusted) ---
// SYNC WARNING: byte-identical LOGIC to the client copies in src/model/shared-model.js
// (re-exported by src/estimation/great-falls.js). console.log intentionally dropped — the
// server runs these up to 3× per cron inside the iteration loop. Rising rivers propagate
// waves faster, so travel time is reduced (capped at 30%).
function getPoRtoGFTravelTime(mult, riseRate = null) {
    const baseTravelTime = TRAVEL_POR_GF_BASELINE * mult;
    if (riseRate && riseRate.flowState === 'rising' && riseRate.ratePerHour > 0) {
        const reductionFactor = Math.min(0.30, riseRate.ratePerHour * 0.02);
        return baseTravelTime * (1 - reductionFactor);
    }
    return baseTravelTime;
}

function getGFtoLFTravelTime(mult, riseRate = null) {
    const baseTravelTime = TRAVEL_GF_LF_BASELINE * mult;
    if (riseRate && riseRate.flowState === 'rising' && riseRate.ratePerHour > 0) {
        const reductionFactor = Math.min(0.30, riseRate.ratePerHour * 0.02);
        return baseTravelTime * (1 - reductionFactor);
    }
    return baseTravelTime;
}

// --- Outlier-robust historic-reading selection ---
// SYNC WARNING: byte-identical LOGIC to src/estimation/rise-rate-robust.mjs
// (medianCfs lines 15-20, selectHistoricReading lines 71-88). Server history is clean
// USGS data, so the outlier filter is effectively a no-op here; ported so the server's
// time-shift lookup matches the client's on identical input (C8, v36.4) + future-proofing.
function medianCfs(entries) {
    if (!entries || entries.length === 0) return null;
    const vals = entries.map(e => e.cfs).sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

function selectHistoricReading(history, targetTime, opts = {}) {
    const matchMs = opts.matchMs ?? 60 * 60 * 1000;
    const outlierFrac = opts.outlierFrac ?? 0.40;
    const minForFilter = opts.minForFilter ?? 3;
    const candidates = history.filter(e =>
        e && e.cfs > 0 && Math.abs(e.timestamp - targetTime) < matchMs);
    if (candidates.length === 0) return null;
    let pool = candidates;
    if (candidates.length >= minForFilter) {
        const med = medianCfs(candidates);
        if (med > 0) {
            const filtered = candidates.filter(e => Math.abs(e.cfs - med) / med <= outlierFrac);
            if (filtered.length > 0) pool = filtered;
        }
    }
    return pool.reduce((best, e) =>
        Math.abs(e.timestamp - targetTime) < Math.abs(best.timestamp - targetTime) ? e : best, pool[0]);
}

// --- Flow state classification ---
// Threshold scales with flow: max(100 cfs, 2% of flow)
// SYNC WARNING: Client copy is src/model/shared-model.js — keep in sync!

function getFlowState(history, currentCFS) {
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

// --- EMA learning alpha ---
// Shared between scheduled-update.js and any other server-side learners.
// Client copy: src/model/constants.js GF_EMA_ALPHA = 0.3
const GF_EMA_ALPHA = 0.3;

// --- Soft ceiling ratio ---
// v28.0: Cap GF estimate at 120% of LF actual.
// Validated in 25-config grid search on 117k hourly obs (backtest_117k_audit.md).
const CEILING_RATIO = 1.20;

// --- PoR-delta decay cap ---
// v28.0: Lowered from 0.75 to 0.50 based on validation.
const DECAY_CAP = 0.50;

// --- PoR rise rate from server-side history ---
// Server equivalent of client's getPoRRiseRate() in great-falls.js.
// Used by makeGFPrediction() to apply wave celerity travel time reduction.
// history: array of { timestamp, cfs } sorted ascending (oldest first)
//
// DELIBERATE DIVERGENCE (do NOT "resync" by reverting): the client copy uses
// median-of-record selection for current/past readings because it merges noisy
// localStorage. This server copy keeps the simple last-entry / closest-to-6h
// selection because its `history` is rebuilt fresh from USGS and pre-sorted each
// cron — clean by construction. Only the rising/falling/steady THRESHOLDS must
// stay identical across the two (they do).

function getPoRRiseRateFromHistory(history) {
    if (!history || history.length < 4) return null;
    const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);
    const current = history[history.length - 1];
    // Find most recent entry at or before the 6-hour mark
    let past = null;
    for (const r of history) {
        if (r.timestamp <= sixHoursAgo) past = r;
    }
    if (!past || !current) return null;
    const hoursDiff = (current.timestamp - past.timestamp) / 3600000;
    if (hoursDiff <= 0) return null;
    const pctChange = ((current.cfs - past.cfs) / past.cfs) * 100;
    const ratePerHour = pctChange / hoursDiff;
    return { ratePerHour, flowState: getFlowState(history, current.cfs) };
}

// --- Hierarchical correction fallback (v35.1) ---
// Pure helpers for getGFCorrection(). When a specific flow-bin × flow-state
// has <5 observations, fall back through: same-bin pooled → adjacent-bin same-state → 0.
// Linear blending eliminates discontinuity at the 5-obs threshold.

function getBinCorrection(stateData) {
    if (stateData.emaMeanError !== undefined) return stateData.emaMeanError;
    return stateData.meanError || 0;
}

function getFallbackCorrection(correctionBins, flowBin, flowState) {
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

// Pure hierarchical correction lookup for a (flowBin, flowState).
// Blends the bin's own EMA with the hierarchical fallback while the bin has <5 obs,
// crossing smoothly to the bin value at the 5-obs threshold. Pure: correctionBins is
// passed in (no globals), so the client mirror in src/model/shared-model.js is byte-identical.
function getGFCorrection(correctionBins, flowBin, flowState) {
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

// Assemble the 18-bin correction structure from raw DB rows (observation_type
// 'gf_correction_bin'). Seeds every (bin × state) empty, then overlays matching rows.
// Skips stage_* keys (a separate rating-curve series) explicitly. Shared by the cron
// (scheduled-update.js) and the API read path (sync-learning.js) so both build bins identically.
function buildCorrectionBins(rows) {
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

// End-apply, unit gain (v36.0). The single point client and server both call to turn a
// raw final estimate into the displayed/corrected estimate, so the two cannot drift.
//   correctedFinal = rawFinalUnclipped − correction, then a display-only 120%-LF ceiling guard.
// The correction is looked up off the bin of the UNCLIPPED raw final, which is also the bin
// the EMA learns into — so apply-bin == learn-bin by construction. Pure (no rounding; callers round).
function applyGFCorrection({ rawFinalUnclipped, lfCFS, correctionBins, flowState }) {
    const flowBin = getFlowBin(rawFinalUnclipped);
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

// --- EMA correction-bin update (v36.1) ---
// Pure, in-place update of a single correction bin's running stats from one RAW residual
// (errorCFS = rawFinalCFS − actualLF). Extracted verbatim from validatePendingPredictions
// (scheduled-update.js) so the cron AND the offline CI backtest harness learn through the
// SAME code — no drift (the v36.0 shared-helper philosophy, applied to learning).
//
// Contract:
//  - HARD-flagged observations must be filtered by the CALLER; they never reach this function.
//  - SOFT-flagged observations are clamped to ±2σ around the current EMA center, but ONLY once
//    the bin has ≥10 observations (so σ is meaningful). The center is `emaMeanError ?? meanError`
//    and the recurrence falls back `emaMeanError || meanError` — both preserved EXACTLY as the
//    original, because a fresh bin's seed may or may not carry an `emaMeanError` key.
//  - count===1 seeds emaMeanError = learningError (the EMA's first value), matching the original.
// Mutates `binData` and returns { learningError, clamped, maxDelta } for the caller to log.
function updateCorrectionBin(binData, errorCFS, isSoftFlagged) {
    binData.count += 1;
    binData.sumError += errorCFS;
    binData.sumErrorSq += errorCFS * errorCFS;
    binData.meanError = binData.sumError / binData.count;

    let learningError = errorCFS;
    let clamped = false;
    let maxDelta = null;
    if (isSoftFlagged && binData.count >= 10) {
        const variance = (binData.sumErrorSq / binData.count) - (binData.meanError * binData.meanError);
        const stdDev = Math.sqrt(Math.max(0, variance));
        maxDelta = 2 * stdDev;
        const center = binData.emaMeanError ?? binData.meanError;
        learningError = Math.max(center - maxDelta, Math.min(center + maxDelta, errorCFS));
        clamped = (learningError !== errorCFS);
    }

    if (binData.count === 1) {
        binData.emaMeanError = learningError;
    } else {
        binData.emaMeanError = GF_EMA_ALPHA * learningError + (1 - GF_EMA_ALPHA) * (binData.emaMeanError || binData.meanError);
    }

    return { learningError, clamped, maxDelta };
}

// --- Tributary drainage-area fallback ratios ---
// Used only when real-time gauge data is unavailable.
const TRIB_FALLBACK = {
    monocacy: 0.071,
    goose: 0.030,
    broadRun: 0.0066,
    seneca: 0.0087
};

// --- LF stage from flow (inverse rating curve) ---
// Based on USGS field measurements at Little Falls (01646500), 2015-2025
// SYNC WARNING: Client copy is src/model/shared-model.js — keep in sync!
function estimateLFStage(cfs) {
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

// --- Pending-prediction validation window ---

// A validated prediction is accepted only within this delay after its due time.
// With a 1h cron, normal delay is 0-1h; beyond this, flow conditions have changed
// too much to learn from. Shared by the cron validator and the API write path.
const VALIDATION_MAX_DELAY_MS = 2.5 * 60 * 60 * 1000;

// Should an EXISTING pending prediction be replaced by a newly computed one?
// True if it has missed its validation window, OR if its validationDue is missing
// or unparseable. An Invalid Date is truthy and `now - InvalidDate` is NaN, so the
// old `!validationDue || (now - validationDue) > MAX` guard treated a bad-date row
// as still-in-window forever — deadlocking the single pending slot (C12).
function isExistingPredictionReplaceable(existingData, nowMs) {
    const dueMs = Date.parse(existingData?.validationDue);
    return isNaN(dueMs) || (nowMs - dueMs) > VALIDATION_MAX_DELAY_MS;
}

module.exports = {
    getSupabase,
    VALIDATION_MAX_DELAY_MS, isExistingPredictionReplaceable,
    GF_FLOW_BINS, getFlowBin,
    estimateLFFlowFromStage,
    TRAVEL_COEF, TRAVEL_EXP, MEDIAN_TRAVEL, TRAVEL_POR_GF_BASELINE, TRAVEL_GF_LF_BASELINE,
    POR_HISTORY_MAX_AGE,
    EF_MODEL,
    getEFWeight, getFlowMultiplier, getFlowState,
    getPoRtoGFTravelTime, getGFtoLFTravelTime,
    medianCfs, selectHistoricReading,
    GF_EMA_ALPHA,
    getPoRRiseRateFromHistory,
    CEILING_RATIO, DECAY_CAP,
    TRIB_FALLBACK,
    getBinCorrection, getFallbackCorrection,
    getGFCorrection, buildCorrectionBins, applyGFCorrection,
    updateCorrectionBin,
    estimateLFStage
};

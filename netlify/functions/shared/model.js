// Potomac Pulse — Shared Server Module
// Canonical source for constants and functions used by both scheduled-update.js and sync-learning.js.
// Client-side copies exist in index.html — keep all three in sync for any model changes.

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
// SYNC WARNING: Client copy exists in index.html — keep in sync!

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
// SYNC WARNING: Client copy exists in index.html — keep in sync!

const TRAVEL_COEF = 4139;        // Adjusted (5174 × 0.80)
const TRAVEL_EXP = -0.5963;      // Searcy exponent (unchanged)
const MEDIAN_TRAVEL = 25.8;      // Adjusted (32.3 × 0.80)
const TRAVEL_POR_GF_BASELINE = 19.4;  // Adjusted (24.3 × 0.80)
const TRAVEL_GF_LF_BASELINE = 6.5;    // Adjusted (8.1 × 0.80)

// --- Edwards Ferry power-law model ---
// Updated 2026-02-18: Deduped dataset (v24.16)
// Cold water (≤10°C): 160 × EF^2.36 (deduped fit, R²=0.96)
// Default (>10°C): 126 × EF^2.46 (deduped fit, R²=0.91)
// SYNC WARNING: Client copy exists in index.html — keep in sync!

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
// SYNC WARNING: Client copy exists in index.html — keep in sync!

function getEFWeight(estimatedFlow) {
    if (estimatedFlow < 1000) return 0.0;
    const W_MAX = 0.40;
    const K = 5.0;
    const MIDPOINT = Math.log(10000);
    return W_MAX / (1 + Math.exp(-K * (Math.log(estimatedFlow) - MIDPOINT)));
}

// --- Flow multiplier for travel time scaling ---
// SYNC WARNING: Client copy exists in index.html — keep in sync!

function getFlowMultiplier(lfFlow) {
    const flow = Math.max(lfFlow, 1000);
    const travelHrs = TRAVEL_COEF * Math.pow(flow, TRAVEL_EXP);
    return travelHrs / MEDIAN_TRAVEL;
}

// --- Flow state classification ---
// Threshold scales with flow: max(100 cfs, 2% of flow)
// SYNC WARNING: Client copy exists in index.html — keep in sync!

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
// SYNC WARNING: Client copy exists in index.html — keep in sync!
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

module.exports = {
    getSupabase,
    GF_FLOW_BINS, getFlowBin,
    estimateLFFlowFromStage,
    TRAVEL_COEF, TRAVEL_EXP, MEDIAN_TRAVEL, TRAVEL_POR_GF_BASELINE, TRAVEL_GF_LF_BASELINE,
    EF_MODEL,
    getEFWeight, getFlowMultiplier, getFlowState,
    GF_EMA_ALPHA,
    getPoRRiseRateFromHistory,
    CEILING_RATIO, DECAY_CAP,
    TRIB_FALLBACK,
    getBinCorrection, getFallbackCorrection,
    estimateLFStage
};

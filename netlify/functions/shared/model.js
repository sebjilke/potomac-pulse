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

    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
    let pastReading = null;

    for (const r of history) {
        if (r.timestamp <= twoHoursAgo) {
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

// --- Soft ceiling ratio ---
// v28.0: Cap GF estimate at 120% of LF actual.
// Validated in 25-config grid search on 117k hourly obs (backtest_117k_audit.md).
const CEILING_RATIO = 1.20;

// --- PoR-delta decay cap ---
// v28.0: Lowered from 0.75 to 0.50 based on validation.
const DECAY_CAP = 0.50;

// --- Tributary drainage-area fallback ratios ---
// Used only when real-time gauge data is unavailable.
const TRIB_FALLBACK = {
    monocacy: 0.071,
    goose: 0.030,
    broadRun: 0.0066,
    seneca: 0.0087
};

module.exports = {
    getSupabase,
    GF_FLOW_BINS, getFlowBin,
    estimateLFFlowFromStage,
    TRAVEL_COEF, TRAVEL_EXP, MEDIAN_TRAVEL, TRAVEL_POR_GF_BASELINE, TRAVEL_GF_LF_BASELINE,
    EF_MODEL,
    getEFWeight, getFlowMultiplier, getFlowState,
    CEILING_RATIO, DECAY_CAP,
    TRIB_FALLBACK
};

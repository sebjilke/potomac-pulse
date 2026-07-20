// Potomac Pulse — Constants
// All configuration constants used across the client application.

export const LF = { id: "01646500", name: "Little Falls", lat: 38.9498, lon: -77.1278, area: 11560 };
export const CACHE_KEY = "potomac_cached_data";
export const CACHE_MAX_AGE = 6 * 60 * 60 * 1000; // 6 hours

// PoR history for Great Falls time-shifting
export const POR_HISTORY_KEY = "potomac_por_history";
export const POR_HISTORY_MAX_AGE = 72 * 60 * 60 * 1000; // 72 hours

// GF estimate history for forecast graph
export const GF_HISTORY_KEY = "potomac_gf_history";
export const GF_HISTORY_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

// Shadow model keys
export const SHADOW_STATE_KEY = "potomac_shadow_models";
export const SHADOW_PREDICTION_KEY = "potomac_shadow_predictions";

// Server API (System-2 GF learning, forecast accuracy, PoR/GF history)
export const SYNC_API = '/api/sync';

// GAUGES with baseline hours derived from USGS Circular 438 / Searcy (1961)
// EMPIRICAL CORRECTION (Jan 2026): Original Searcy values × 0.80
export const GAUGES = {
    "01646500": { name: "Little Falls", lat: 38.9498, lon: -77.1278, area: 11560, pctLF: 100, baseHrs: 0, branch: "target" },
    "01638500": { name: "Point of Rocks", lat: 39.2726, lon: -77.5405, area: 9651, pctLF: 83.5, baseHrs: 26, branch: "mainstem" },
    "01618000": { name: "Shepherdstown", lat: 39.4309, lon: -77.8033, area: 5955, pctLF: 51.5, baseHrs: 50, branch: "mainstem" },
    "01613000": { name: "Hancock", lat: 39.6987, lon: -78.1789, area: 4073, pctLF: 35.2, baseHrs: 120, branch: "mainstem" },
    "01610000": { name: "Paw Paw", lat: 39.5320, lon: -78.4578, area: 3109, pctLF: 26.9, baseHrs: 141, branch: "mainstem" },
    "01603000": { name: "Cumberland", lat: 39.6218, lon: -78.7622, area: 877, pctLF: 7.6, baseHrs: 181, branch: "northBranch" },
    "01595500": { name: "Kitzmiller", lat: 39.3892, lon: -79.1817, area: 247, pctLF: 2.1, baseHrs: 190, branch: "northBranch" },
    "01608500": { name: "Springfield", lat: 39.4454, lon: -78.6545, area: 1486, pctLF: 12.7, baseHrs: 176, branch: "southBranch" },
    "01606500": { name: "Petersburg", lat: 38.9926, lon: -79.1239, area: 642, pctLF: 5.6, baseHrs: 187, branch: "southBranch" },
    "01604500": { name: "Franklin", lat: 38.6428, lon: -79.3306, area: 179, pctLF: 1.5, baseHrs: 200, branch: "southBranch" },
    "01636500": { name: "Millville", lat: 39.2743, lon: -77.7850, area: 3041, pctLF: 26.3, baseHrs: 38, branch: "shenandoah" },
    "01631000": { name: "Front Royal", lat: 38.9140, lon: -78.2117, area: 1642, pctLF: 14.2, baseHrs: 64, branch: "shenandoah" },
    "01643000": { name: "Monocacy", lat: 39.4143, lon: -77.4080, area: 817, pctLF: 7.1, baseHrs: 14, branch: "belowPtR" },
    "01644000": { name: "Goose Creek", lat: 39.0559, lon: -77.5191, area: 332, pctLF: 3.0, baseHrs: 10, branch: "belowPtR" },
    "01644280": { name: "Broad Run", lat: 39.0464, lon: -77.4324, area: 76, pctLF: 0.7, baseHrs: 8, branch: "belowPtR" },
    "01645000": { name: "Seneca Creek", lat: 39.1273, lon: -77.3386, area: 101, pctLF: 0.9, baseHrs: 5, branch: "belowPtR" },
    "01611500": { name: "Cacapon", lat: 39.5832, lon: -78.3011, area: 675, pctLF: 5.8, baseHrs: 128, branch: "tribs" },
    "01614500": { name: "Conococheague", lat: 39.6510, lon: -77.9239, area: 494, pctLF: 4.9, baseHrs: 112, branch: "tribs" },
    "01619500": { name: "Antietam", lat: 39.4487, lon: -77.7389, area: 281, pctLF: 2.4, baseHrs: 53, branch: "tribs" }
};

// Great Falls virtual gauge (estimated, no USGS gauge exists)
export const GREAT_FALLS = {
    id: "GF_VIRTUAL",
    name: "Great Falls",
    lat: 38.9985,
    lon: -77.2519,
    area: 10000,
    pctLF: 88.1,
    estimated: true
};

// Edwards Ferry - hidden gauge just above Great Falls for backend validation
export const EDWARDS_FERRY = {
    id: "01644148",
    name: "Edwards Ferry",
    lat: 39.0986,
    lon: -77.4711,
    area: 11130,
    pctLF: 96.3,
    hidden: true
};

// Edwards Ferry → Little Falls Correlation Model
// Power-law: LF_cfs = EF_COEF × EF_stage^EF_EXP
// Generated: 2026-02-11 | Data range: 2011-2026 (5,220 deduplicated daily observations)
export const EF_MODEL = {
    coef: 126,
    exp: 2.46,
    coldCoef: 160,
    coldExp: 2.36,
    coldMaxTemp: 10,
    rSquared: 0.91,
    medianErrorPct: 6.3,    // daily-resolution median |error|; hourly refit = 11.7% (analysis/powerlaw_refit_audit.md)
    minStage: 2.5,
    maxStage: 20.0
};

export const EF_HISTORY_MAX = 48;

// Empirical 90% Confidence Intervals — CORRECTED-residual quantiles (v36.1, C2).
// q05/q95 of the corrected residual r = (displayed estimate − actual LF), per flowBin × flowState.
// Applied SIGN-AWARE and asymmetric as the band [estimate − q95, estimate − q05] (great-falls.js).
// Derived by replaying the REAL production model over 126,916 hourly obs (2011-2026, incl. the 4
// tributaries + LF stage) in a prequential EMA backtest (analysis/ci_backtest_harness.mjs), binned
// by the model's own (flowBin, flowState) output — the exact lookup key — then quantiled blind in
// Python and R (agree <1e-9) and verified against live USGS. High-flow bins (25000-50000, 50000+)
// take the wider of the multi/single-pending tails so the band doesn't under-cover the laggier
// correction production actually serves. See analysis/ci_v36.1_backtest_plan.md.
export const EMPIRICAL_CI_90 = {
    '0-3000':     { rising: { q05: -547, q95: 369 }, steady: { q05: -271, q95: 250 }, falling: { q05: -315, q95: 336 }, all: { q05: -309, q95: 284 } },
    '3000-6000':  { rising: { q05: -676, q95: 535 }, steady: { q05: -327, q95: 287 }, falling: { q05: -391, q95: 361 }, all: { q05: -425, q95: 356 } },
    '6000-12000': { rising: { q05: -1650, q95: 1046 }, steady: { q05: -404, q95: 320 }, falling: { q05: -451, q95: 359 }, all: { q05: -628, q95: 506 } },
    '12000-25000':{ rising: { q05: -2384, q95: 1543 }, steady: { q05: -549, q95: 425 }, falling: { q05: -514, q95: 464 }, all: { q05: -884, q95: 741 } },
    '25000-50000':{ rising: { q05: -3851, q95: 2860 }, steady: { q05: -2013, q95: 1844 }, falling: { q05: -1068, q95: 1059 }, all: { q05: -2402, q95: 1899 } },
    '50000+':     { rising: { q05: -7354, q95: 5519 }, steady: { q05: -5858, q95: 6410 }, falling: { q05: -4099, q95: 6429 }, all: { q05: -5858, q95: 6410 } }
};

export const BRANCHES = {
    mainstem: { name: "Mainstem", color: "#2563eb", ids: ["01638500","01618000","01613000","01610000"] },
    northBranch: { name: "North Branch", color: "#0891b2", ids: ["01603000","01595500"] },
    southBranch: { name: "South Branch", color: "#7c3aed", ids: ["01608500","01606500","01604500"] },
    shenandoah: { name: "Shenandoah", color: "#c026d3", ids: ["01636500","01631000"] },
    belowPtR: { name: "Below Pt Rocks ⚠️", color: "#dc2626", warn: true, ids: ["01643000","01644000","01644280","01645000"] },
    tribs: { name: "Tributaries", color: "#059669", ids: ["01611500","01614500","01619500"] }
};

// Creek runs — rain-dependent whitewater, NOT used in GF estimation
export const CREEK_RUNS = {
    "01648010": { name: "Rock Creek", class: "II-III+(V)", runnable: 400, awId: 2587, area: 62, estimated: false },
    "01650500": { name: "NW Branch Anacostia", class: "I-III(V+)", runnable: 200, awId: 706, area: 21, estimated: false },
    "01646000": { name: "Difficult Run", class: "III-IV(V+)", runnable: 200, awId: 1930, area: 58, estimated: false },
    "01650800": { name: "Sligo Creek", class: "~II", runnable: 200, awId: null, area: 6.5, estimated: false, microRun: true }
};

// Travel time model — Searcy 1961 (USGS Circular 438) × 0.80 empirical correction
export const TRAVEL_COEF = 4139;
export const TRAVEL_EXP = -0.5963;
export const MEDIAN_FLOW = 4940;
export const MEDIAN_TRAVEL = 25.8;
export const TRAVEL_POR_GF_BASELINE = 19.4;
export const TRAVEL_GF_LF_BASELINE = 6.5;

// Tributary inflow fallbacks (fraction of LF) used when a gauge is offline.
// Mirrors server netlify/functions/shared/model.js TRIB_FALLBACK — keep in sync.
export const TRIB_FALLBACK = { monocacy: 0.071, goose: 0.030, broadRun: 0.0066, seneca: 0.0087 };

// Model guards — mirror server shared/model.js (keep values in sync).
export const DECAY_CAP = 0.50;           // PoR-delta staleness: max fraction of change propagated
export const EF_DISCREPANCY_MAX = 0.50;  // skip EF ensemble above this relative PoR/EF gap
export const CEILING_RATIO = 1.20;       // soft LF ceiling: GF estimate ≤ 120% of LF actual

// v37.13: EF divergence advisory freshness — hide server advisory state older than this
// (cron stall → fail-safe silence). Mirrors server shared/model.js EF_DIVERGENCE.staleMs —
// keep in sync (the client never computes divergence; it only renders persisted state).
export const EF_DIVERGENCE_STALE_MS = 2 * 60 * 60 * 1000;

// GF prediction/learning intervals
// (GF_PREDICTION_INTERVAL / GF_MIN_VALIDATION_TIME removed in v36.0 — the client no longer writes
//  predictions, so the throttle and min-validation-window constants have no consumers.)
export const GF_VALIDATION_CHECK_INTERVAL = 60 * 1000;
export const FORECAST_PREDICTION_INTERVAL = 2 * 60 * 60 * 1000;
export const FORECAST_HORIZONS = [6, 12, 24, 48];
export const GF_EMA_ALPHA = 0.3;
export const GF_OUTLIER_THRESHOLD = 3;
export const GF_FLOW_BINS = ['0-3000', '3000-6000', '6000-12000', '12000-25000', '25000-50000', '50000+'];

// NWS location IDs
export const NWS_LIDS = {
    "01646500": "BRKM2",
    "01638500": "PORM2",
    "01618000": "SHEW2",
    "01613000": "HNKM2",
    "01610000": "PAWW2",
    "01603000": "CBEM2",
    "01595500": "KITM2",
    "01608500": "SPRW2",
    "01606500": "PETW2",
    "01636500": "MILW2",
    "01631000": "FROV2",
    "01643000": "FDKM2",
    "01644000": "LEEV2",
    "01645000": "DAWM2",
    "01611500": "GCPW2",
    "01614500": "FAVM2",
    "01619500": "SACM2",
};

// PIN hash for learning panel access
// Learning-panel PIN hash lives in src/ui/auth.js (this module no longer re-exports it).

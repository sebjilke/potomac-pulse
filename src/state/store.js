// Potomac Pulse — Central mutable state store
// All global mutable variables live here. Modules import getters/setters.

// --- PoR & GF history ---
export let porHistory = [];
export let gfHistory = [];

// --- Shadow models ---
export let shadowModelState = {
    lfFeedback: {
        correctionFactor: 0,
        lastPredictedLF: null,
        lastPredictionTime: null,
        alpha: 0.4
    },
    onlineRegression: {
        weights: null,
        learningRate: 0.001,
        nFeatures: 9,
        trainCount: 0
    },
    kalman: {
        x: null,
        P: null,
        Q_base: 0.0001,
        initialized: false
    }
};
export let shadowResults = {
    lfFeedback: { cfs: null, stage: null, label: 'LF Feedback' },
    onlineRegression: { cfs: null, stage: null, label: 'Online Regression' },
    kalman: { cfs: null, stage: null, label: 'Kalman Filter' }
};

// --- Data fetch state ---
export let dataSource = "loading";
export let lastFetchTime = null;
export let isFetching = false;

// --- Edwards Ferry ---
export let efHysteresis = {
    rising: { multiplier: 1.08, count: 0, sumError: 0 },
    falling: { multiplier: 0.92, count: 0, sumError: 0 },
    steady: { multiplier: 1.0, count: 0, sumError: 0 }
};
export let edwardsFerryData = {
    current: null,
    history: [],
    correlation: null
};
export let waterTempC = null;

// --- Creek data ---
export let creekData = {};

// --- Great Falls estimation ---
export let gfEstimate = null;
export let gfLearningData = null;
export let gfDataReady = false;
// v36.0 (C1): lastGFPredictionTime / gfPredictionRetryQueue removed — the client no longer writes
// GF predictions (the cron is the sole writer), so the throttle timer and retry queue are obsolete.

// --- Shadow leaderboard ---
export let shadowLeaderboard = null;

// --- Forecast accuracy ---
export let lastForecastPredictionTime = 0;
export let forecastAccuracyData = null;

// --- Forecast graph ---
export let forecastGraphData = null;
export let graphScales = null;

// --- Map & UI ---
export let map = null;
export let data = {};
export let markers = {};

// --- Error banner ---
export let errorBannerTimeout = null;

// --- Setters ---
// For reassigning `let` bindings from other modules.

export function setPorHistory(v) { porHistory = v; }
export function setGfHistory(v) { gfHistory = v; }
export function setShadowModelState(v) { shadowModelState = v; }
export function setShadowResults(v) { shadowResults = v; }
export function setDataSource(v) { dataSource = v; }
export function setLastFetchTime(v) { lastFetchTime = v; }
export function setIsFetching(v) { isFetching = v; }
export function setEfHysteresis(v) { efHysteresis = v; }
export function setEdwardsFerryData(v) { edwardsFerryData = v; }
export function setWaterTempC(v) { waterTempC = v; }
export function setCreekData(v) { creekData = v; }
export function setGfEstimate(v) { gfEstimate = v; }
export function setGfLearningData(v) { gfLearningData = v; }
export function setGfDataReady(v) { gfDataReady = v; }
export function setShadowLeaderboard(v) { shadowLeaderboard = v; }
export function setLastForecastPredictionTime(v) { lastForecastPredictionTime = v; }
export function setForecastAccuracyData(v) { forecastAccuracyData = v; }
export function setForecastGraphData(v) { forecastGraphData = v; }
export function setGraphScales(v) { graphScales = v; }
export function setMap(v) { map = v; }
export function setData(v) { data = v; }
export function setMarkers(v) { markers = v; }
export function setErrorBannerTimeout(v) { errorBannerTimeout = v; }

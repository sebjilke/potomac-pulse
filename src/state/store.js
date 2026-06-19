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

/** Set the {@link porHistory} state value. @param {Array} v - New PoR history array. */
export function setPorHistory(v) { porHistory = v; }
/** Set the {@link gfHistory} state value. @param {Array} v - New GF history array. */
export function setGfHistory(v) { gfHistory = v; }
/** Set the {@link shadowModelState} state value. @param {Object} v - New shadow-model state object. */
export function setShadowModelState(v) { shadowModelState = v; }
/** Set the {@link shadowResults} state value. @param {Object} v - New shadow-results object. */
export function setShadowResults(v) { shadowResults = v; }
/** Set the {@link dataSource} state value. @param {string} v - New data-source identifier. */
export function setDataSource(v) { dataSource = v; }
/** Set the {@link lastFetchTime} state value. @param {number|null} v - New last-fetch timestamp (ms), or null. */
export function setLastFetchTime(v) { lastFetchTime = v; }
/** Set the {@link isFetching} state value. @param {boolean} v - New fetch-in-progress flag. */
export function setIsFetching(v) { isFetching = v; }
/** Set the {@link efHysteresis} state value. @param {Object} v - New Edwards Ferry hysteresis object. */
export function setEfHysteresis(v) { efHysteresis = v; }
/** Set the {@link edwardsFerryData} state value. @param {Object} v - New Edwards Ferry data object. */
export function setEdwardsFerryData(v) { edwardsFerryData = v; }
/** Set the {@link waterTempC} state value. @param {number|null} v - New water temperature in Celsius, or null. */
export function setWaterTempC(v) { waterTempC = v; }
/** Set the {@link creekData} state value. @param {Object} v - New creek-data object. */
export function setCreekData(v) { creekData = v; }
/** Set the {@link gfEstimate} state value. @param {Object|null} v - New Great Falls estimate object, or null. */
export function setGfEstimate(v) { gfEstimate = v; }
/** Set the {@link gfLearningData} state value. @param {Object|null} v - New GF learning-data object, or null. */
export function setGfLearningData(v) { gfLearningData = v; }
/** Set the {@link gfDataReady} state value. @param {boolean} v - New GF-data-ready flag. */
export function setGfDataReady(v) { gfDataReady = v; }
/** Set the {@link shadowLeaderboard} state value. @param {Object|null} v - New shadow-leaderboard object, or null. */
export function setShadowLeaderboard(v) { shadowLeaderboard = v; }
/** Set the {@link lastForecastPredictionTime} state value. @param {number} v - New last-forecast-prediction timestamp (ms). */
export function setLastForecastPredictionTime(v) { lastForecastPredictionTime = v; }
/** Set the {@link forecastAccuracyData} state value. @param {Object|null} v - New forecast-accuracy object, or null. */
export function setForecastAccuracyData(v) { forecastAccuracyData = v; }
/** Set the {@link forecastGraphData} state value. @param {Object|null} v - New forecast-graph data object, or null. */
export function setForecastGraphData(v) { forecastGraphData = v; }
/** Set the {@link graphScales} state value. @param {Object|null} v - New graph-scales object, or null. */
export function setGraphScales(v) { graphScales = v; }
/** Set the {@link map} state value. @param {Object|null} v - New Leaflet map instance, or null. */
export function setMap(v) { map = v; }
/** Set the {@link data} state value. @param {Object} v - New gauge-data object. */
export function setData(v) { data = v; }
/** Set the {@link markers} state value. @param {Object} v - New map-markers object. */
export function setMarkers(v) { markers = v; }
/** Set the {@link errorBannerTimeout} state value. @param {number|null} v - New error-banner timer id, or null. */
export function setErrorBannerTimeout(v) { errorBannerTimeout = v; }

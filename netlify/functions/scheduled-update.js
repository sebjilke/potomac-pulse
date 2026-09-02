// Potomac Pulse - Scheduled Background Update
// Runs every hour to fetch data, store history, and validate predictions
// This allows the learning system to work even when no browsers are open

const {
    getSupabase,
    GF_FLOW_BINS, getFlowBin, estimateLFFlowFromStage,
    TRAVEL_COEF, TRAVEL_EXP, MEDIAN_TRAVEL,
    POR_HISTORY_MAX_AGE,
    EF_MODEL,
    getEFWeight, getFlowMultiplier, getFlowState,
    updateEfDivergenceState,
    updateLfResidualState,
    getPoRtoGFTravelTime, getGFtoLFTravelTime, selectHistoricReading,
    GF_EMA_ALPHA,
    getPoRRiseRateFromHistory,
    CEILING_RATIO, DECAY_CAP,
    TRIB_FALLBACK,
    estimateLFStage,
    applyGFCorrection, buildCorrectionBins, updateCorrectionBin,
    VALIDATION_MAX_DELAY_MS, isExistingPredictionReplaceable
} = require('./shared/model');

const {
    getObs, getObsRows,
    upsertObs, insertObs, deleteObs, deleteObsById
} = require('./shared/observations');

// v37.16: how long a pending FORECAST row may live before the stale sweep reclaims it.
// Server-only (forecast validation has no client counterpart), so it is deliberately not in the
// shared model pair. Was a flat 72h. A forecast is now scored one GF→LF travel time after its
// target, and travel peaks at 16.95h at the 1,000-cfs discharge floor — a +48h forecast then
// ripens at 64.95h, leaving the old threshold only ~7h of margin. A cron gap at low flow would
// have deleted the row before it ripened, biasing the metric exactly where travel is longest.
const FORECAST_STALE_MAX_AGE_HRS = 90;   // 72h base + 18h (> the 16.95h physical maximum)

/**
 * Validates the shape of a parsed USGS IV-service JSON response before it is used.
 * @param {Object} json - Parsed USGS response; expected to have value.timeSeries[] each with sourceInfo.siteCode, variable.variableCode, and a values array.
 * @returns {{valid: boolean, error?: string}} valid:true when the schema checks pass; otherwise valid:false with a human-readable error describing the first failure.
 */
// Validate USGS API response schema
function validateUSGSResponse(json) {
    // Check required top-level structure
    if (!json || typeof json !== 'object') {
        return { valid: false, error: 'Response is not an object' };
    }
    if (!json.value) {
        return { valid: false, error: 'Missing "value" property' };
    }
    if (!Array.isArray(json.value.timeSeries)) {
        return { valid: false, error: '"value.timeSeries" is not an array' };
    }

    // Validate each time series has required fields
    for (let i = 0; i < json.value.timeSeries.length; i++) {
        const ts = json.value.timeSeries[i];
        if (!ts.sourceInfo?.siteCode?.[0]?.value) {
            return { valid: false, error: `timeSeries[${i}] missing sourceInfo.siteCode` };
        }
        if (!ts.variable?.variableCode?.[0]?.value) {
            return { valid: false, error: `timeSeries[${i}] missing variable.variableCode` };
        }
        if (!Array.isArray(ts.values) || !ts.values[0]) {
            return { valid: false, error: `timeSeries[${i}] missing values array` };
        }
    }

    return { valid: true };
}

/**
 * Scores the production and shadow model predictions for one validation round against the actual LF CFS and returns the updated leaderboard. Pure function (no I/O).
 * @param {Object} shadowModels - Per-model predicted CFS for this round, keyed lfFeedback/onlineRegression/kalman (null entries are skipped).
 * @param {number} actualCFS - Observed Little Falls discharge (cfs); must be > 0 or the function returns null.
 * @param {number} productionErrorPercent - Pre-computed signed error percent of the production (raw) model for this round.
 * @param {Object|null} existingLeaderboard - Prior leaderboard ({models: {production, lfFeedback, onlineRegression, kalman} each with count/sumAbsErrorPercent/meanAbsErrorPercent/lastValidation/currentStreak/bestStreak, totalRounds, lastWinner, lastValidationTime}); a default structure is created when null.
 * @returns {Object|null} The mutated/created leaderboard object, or null when inputs are missing/invalid.
 */
// Score shadow model predictions against actual CFS
// Pure function: takes inputs, returns updated leaderboard (or null)
function scoreShadowPredictions(shadowModels, actualCFS, productionErrorPercent, existingLeaderboard) {
    if (!shadowModels || !actualCFS || actualCFS <= 0) return null;

    // Initialize default leaderboard structure
    const lb = existingLeaderboard || {
        models: {
            production: { count: 0, sumAbsErrorPercent: 0, meanAbsErrorPercent: null, lastValidation: null, currentStreak: 0, bestStreak: 0 },
            lfFeedback: { count: 0, sumAbsErrorPercent: 0, meanAbsErrorPercent: null, lastValidation: null, currentStreak: 0, bestStreak: 0 },
            onlineRegression: { count: 0, sumAbsErrorPercent: 0, meanAbsErrorPercent: null, lastValidation: null, currentStreak: 0, bestStreak: 0 },
            kalman: { count: 0, sumAbsErrorPercent: 0, meanAbsErrorPercent: null, lastValidation: null, currentStreak: 0, bestStreak: 0 }
        },
        totalRounds: 0,
        lastWinner: null,
        lastValidationTime: null
    };

    const now = new Date().toISOString();
    const modelNames = ['production', 'lfFeedback', 'onlineRegression', 'kalman'];

    // Compute error for each model
    const errors = {};
    // Production uses pre-computed errorPercent
    errors.production = Math.abs(productionErrorPercent);
    lb.models.production.count += 1;
    lb.models.production.sumAbsErrorPercent += errors.production;
    lb.models.production.meanAbsErrorPercent = lb.models.production.sumAbsErrorPercent / lb.models.production.count;
    lb.models.production.lastValidation = now;

    // Shadow models
    for (const name of ['lfFeedback', 'onlineRegression', 'kalman']) {
        const predicted = shadowModels[name];
        if (predicted == null) continue;  // Skip if shadow had no prediction

        const errPct = Math.abs(((predicted - actualCFS) / actualCFS) * 100);
        errors[name] = errPct;
        lb.models[name].count += 1;
        lb.models[name].sumAbsErrorPercent += errPct;
        lb.models[name].meanAbsErrorPercent = lb.models[name].sumAbsErrorPercent / lb.models[name].count;
        lb.models[name].lastValidation = now;
    }

    // Determine round winner (lowest error among scored models)
    let winner = null;
    let lowestError = Infinity;
    for (const name of modelNames) {
        if (errors[name] !== undefined && errors[name] < lowestError) {
            lowestError = errors[name];
            winner = name;
        }
    }

    // Update streaks
    for (const name of modelNames) {
        if (errors[name] === undefined) continue;
        if (name === winner) {
            lb.models[name].currentStreak += 1;
            lb.models[name].bestStreak = Math.max(lb.models[name].bestStreak, lb.models[name].currentStreak);
        } else {
            lb.models[name].currentStreak = 0;
        }
    }

    lb.totalRounds += 1;
    lb.lastWinner = winner;
    lb.lastValidationTime = now;

    return lb;
}

/**
 * Wraps fetch with an AbortController-based timeout.
 * @param {string} url - The URL to fetch.
 * @param {number} [timeoutMs=5000] - Timeout in milliseconds before the request is aborted.
 * @returns {Promise<Response>} Resolves with the fetch Response; rejects with a timeout Error on abort or rethrows other fetch errors.
 */
// Fetch with timeout wrapper
async function fetchWithTimeout(url, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw error;
    }
}

/**
 * Fetches the latest Point of Rocks water temperature (USGS param 00010) for cold-water EF model selection.
 * @returns {Promise<number|null>} Latest water temperature in Celsius when within the sane range [-5, 40]; otherwise null (also null on fetch/parse failure or missing data).
 */
// Fetch water temperature from Point of Rocks for EF model cold adjustment
async function fetchWaterTemp() {
    const url = 'https://waterservices.usgs.gov/nwis/iv/?sites=01638500&parameterCd=00010&period=P1D&format=json';
    try {
        const response = await fetchWithTimeout(url, 5000);
        if (!response.ok) return null;

        const json = await response.json();
        const values = json?.value?.timeSeries?.[0]?.values?.[0]?.value;
        if (!values?.length) return null;

        const latest = values[values.length - 1];
        const tempC = parseFloat(latest.value);

        if (tempC >= -5 && tempC <= 40) {
            console.log(`🌡️ Water temp: ${tempC.toFixed(1)}°C — using ${tempC <= EF_MODEL.coldMaxTemp ? 'COLD' : 'default'} EF model`);
            return tempC;
        }
        return null;
    } catch (e) {
        console.warn('Water temp fetch failed:', e.message);
        return null;
    }
}

/**
 * Fetches and parses current USGS discharge (00060) and stage (00065) for all model gauges (PoR, LF, Monocacy, Goose, Broad Run, Seneca, EF) over a 2-day window.
 * @returns {Promise<{gauges: Object, data: Object}|null>} gauges maps logical names to site IDs; data is keyed by site ID with {q, h, iceAffected, history}, where history (PoR only) is an array of {timestamp, cfs}. Returns null on fetch/parse/validation failure.
 */
// Fetch current USGS data
async function fetchUSGSData() {
    const gauges = {
        por: '01638500',      // Point of Rocks
        lf: '01646500',       // Little Falls
        monocacy: '01643000', // Monocacy
        goose: '01644000',    // Goose Creek
        broadRun: '01644280', // Broad Run (v31.0)
        seneca: '01645000',   // Seneca Creek
        ef: '01644148'        // Edwards Ferry (stage only)
    };

    const sites = Object.values(gauges).join(',');
    const url = `https://waterservices.usgs.gov/nwis/iv/?sites=${sites}&parameterCd=00060,00065&period=P2D&format=json`;

    try {
        const response = await fetchWithTimeout(url, 10000); // 10 second timeout
        if (!response.ok) {
            console.error('USGS fetch failed:', response.status, response.statusText);
            return null;
        }

        // Parse JSON with explicit error handling
        let json;
        try {
            json = await response.json();
        } catch (parseError) {
            console.error('USGS JSON parse error:', parseError.message);
            return null;
        }

        // Validate response schema
        const validation = validateUSGSResponse(json);
        if (!validation.valid) {
            console.error('USGS response validation failed:', validation.error);
            return null;
        }

        const data = {};

        for (const ts of json.value?.timeSeries || []) {
            const siteId = ts.sourceInfo.siteCode[0].value;
            const param = ts.variable.variableCode[0].value;
            const values = ts.values[0]?.value || [];

            if (!data[siteId]) data[siteId] = { history: [] };

            if (values.length > 0) {
                // Current value
                const latest = values[values.length - 1];
                const val = parseFloat(latest.value);
                const qualifiers = latest.qualifiers?.map(q => q.qualifierCode) || [];
                const isIce = val <= -999999 || qualifiers.includes('Ice');

                if (isIce && param === '00060') {
                    data[siteId].iceAffected = true;
                    console.log(`🧊 ${siteId}: Ice-affected (discharge)`);
                }

                if (val > 0 && val < 9999999) {
                    if (param === '00060') data[siteId].q = val;
                    if (param === '00065') {
                        data[siteId].h = val;
                        // v37.13: stage-reading age feeds the EF divergence advisory's strict
                        // validity — a gauge frozen inside the P2D fetch window is otherwise
                        // present-but-stale with no way to know (plan §1/F7).
                        data[siteId].hTime = new Date(latest.dateTime).getTime();
                    }
                }

                // Full history for PoR (for time-shifting)
                if (siteId === gauges.por && param === '00060') {
                    data[siteId].history = values.map(v => ({
                        timestamp: new Date(v.dateTime).getTime(),
                        cfs: parseFloat(v.value)
                    })).filter(v => v.cfs > 0 && v.cfs < 500000);
                }
            }
        }

        return { gauges, data };
    } catch (e) {
        console.error('USGS fetch error:', e);
        return null;
    }
}

/**
 * Merges new Point of Rocks readings into the stored rolling history, dedups by timestamp, trims to the retention window (POR_HISTORY_MAX_AGE), and upserts.
 * @param {Object} client - Supabase client.
 * @param {Array<{timestamp: number, cfs: number}>} history - New PoR readings to merge.
 * @returns {Promise<boolean>} true on success or no-op (no history / no new readings); false if the upsert fails.
 */
// Store PoR history to Supabase
async function storePoRHistory(client, history) {
    if (!history?.length) return true;

    // Get existing timestamps to avoid duplicates
    const existing = await getObs(client, 'por_history', 'system');

    const existingTimestamps = new Set(
        (existing?.readings || []).map(r => r.timestamp)
    );

    // Merge new readings
    const newReadings = history.filter(r => !existingTimestamps.has(r.timestamp));
    if (newReadings.length === 0) {
        console.log('No new PoR readings to store');
        return true;
    }

    const allReadings = [...(existing?.readings || []), ...newReadings]
        .sort((a, b) => a.timestamp - b.timestamp);

    // Keep only the retention window (72h ≥ max PoR→GF travel ~50.6h, so the
    // time-shift lookup is covered at every flow — C16, v36.4).
    const cutoff = Date.now() - POR_HISTORY_MAX_AGE;
    const trimmedReadings = allReadings.filter(r => r.timestamp > cutoff);

    const { error: porHistErr } = await upsertObs(client, 'por_history', 'system', {
        readings: trimmedReadings,
        lastUpdate: new Date().toISOString()
    });

    if (porHistErr) {
        console.error('❌ PoR history upsert FAILED:', porHistErr.message, porHistErr.code, porHistErr.details);
        return false;
    }

    console.log(`Stored ${newReadings.length} new PoR readings, total: ${trimmedReadings.length}`);
    return true;
}

/**
 * Appends the latest GF prediction to the rolling 24h server-side history (single row of {timestamp, cfs, stage} readings) so the graph stays continuous with no browser open. Skips if the last entry is <30min old.
 * @param {Object} client - Supabase client.
 * @param {Object} prediction - Prediction object; uses predictedCFS and predictedStage (no-op when predictedCFS is falsy).
 * @returns {Promise<void>}
 */
// Store GF estimate in rolling 24h server-side history
// Ensures continuous history for graph display even when no browser is open
// Pattern: single row with array of {timestamp, cfs, stage} readings
async function storeGFHistory(client, prediction) {
    if (!prediction?.predictedCFS) return;

    const now = Date.now();
    const newEntry = {
        timestamp: now,
        cfs: prediction.predictedCFS,
        stage: prediction.predictedStage
    };

    // Load existing history
    const existing = await getObs(client, 'gf_history', 'system');

    const existingReadings = existing?.readings || [];

    // Dedup guard: skip if last entry is within 30 minutes (prevents duplicates on retries)
    if (existingReadings.length > 0) {
        const lastEntry = existingReadings[existingReadings.length - 1];
        if (now - lastEntry.timestamp < 30 * 60 * 1000) {
            console.log(`📈 GF history: skipped — last entry is ${((now - lastEntry.timestamp) / 60000).toFixed(0)}min old`);
            return;
        }
    }

    // Add new entry, trim to last 24h
    const allReadings = [...existingReadings, newEntry];
    const cutoff = now - (24 * 60 * 60 * 1000);
    const trimmedReadings = allReadings.filter(r => r.timestamp > cutoff);

    const { error: gfHistErr } = await upsertObs(client, 'gf_history', 'system', {
        readings: trimmedReadings,
        lastUpdate: new Date().toISOString()
    });

    if (gfHistErr) {
        console.error('❌ GF history upsert FAILED:', gfHistErr.message, gfHistErr.code, gfHistErr.details);
        return;
    }

    console.log(`📈 GF history: stored ${prediction.predictedCFS} cfs, ${trimmedReadings.length} entries in 24h window`);
}

/**
 * Appends a predicted-vs-actual validation pair to the rolling 7-day server-side validation history. Skips if the last entry is <30min old.
 * @param {Object} client - Supabase client.
 * @param {number} predictedCFS - Predicted (corrected/displayed) GF discharge in cfs (rounded before storage).
 * @param {number} actualCFS - Observed Little Falls discharge in cfs (rounded before storage).
 * @param {number} errorPercent - Signed error percent (rounded to 0.1) for this pair.
 * @param {string} flowBin - Flow-range bin label for the prediction.
 * @param {string} flowState - Flow state ('rising'/'falling'/'steady') for the prediction.
 * @param {{efDivergence?: (number|null), divergenceActive?: (boolean|null), lfResidualActive?: (boolean|null), lfResidualLastErrPct?: (number|null)}} [divergence={}] - Prediction-time advisory states (v37.13 EF divergence, v37.15 LF residual; null-safe for legacy rows).
 * @returns {Promise<void>}
 */
async function storeValidationPair(client, predictedCFS, actualCFS, errorPercent, flowBin, flowState, divergence = {}) {
    const now = Date.now();
    const newEntry = {
        timestamp: now,
        predictedCFS: Math.round(predictedCFS),
        actualCFS: Math.round(actualCFS),
        errorPercent: Math.round(errorPercent * 10) / 10,
        flowBin,
        flowState,
        // v37.13: prediction-time EF divergence advisory state (null for legacy pending rows)
        efDivergence: divergence.efDivergence ?? null,
        divergenceActive: divergence.divergenceActive ?? null,
        // v37.15: prediction-time LF-residual advisory state (null for legacy pending rows)
        lfResidualActive: divergence.lfResidualActive ?? null,
        lfResidualLastErrPct: divergence.lfResidualLastErrPct ?? null
    };

    const existing = await getObs(client, 'gf_validation_history', 'system');

    const existingReadings = existing?.readings || [];

    if (existingReadings.length > 0) {
        const lastEntry = existingReadings[existingReadings.length - 1];
        if (now - lastEntry.timestamp < 30 * 60 * 1000) {
            console.log(`📊 Validation history: skipped — last entry is ${((now - lastEntry.timestamp) / 60000).toFixed(0)}min old`);
            return;
        }
    }

    const allReadings = [...existingReadings, newEntry];
    const cutoff = now - (7 * 24 * 60 * 60 * 1000);
    const trimmedReadings = allReadings.filter(r => r.timestamp > cutoff);

    const { error: valHistErr } = await upsertObs(client, 'gf_validation_history', 'system', {
        readings: trimmedReadings,
        lastUpdate: new Date().toISOString()
    });

    if (valHistErr) {
        console.error('❌ Validation history upsert FAILED:', valHistErr.message, valHistErr.code, valHistErr.details);
        return;
    }

    console.log(`📊 Validation history: stored ${Math.round(predictedCFS)} vs ${Math.round(actualCFS)} cfs (${errorPercent.toFixed(1)}%), ${trimmedReadings.length} entries in 7d window`);
}

/**
 * Selects the Point of Rocks reading closest to `hoursAgo` ago using the shared outlier-robust selection (selectHistoricReading), matching the client's time-shift lookup.
 * @param {Array<{timestamp: number, cfs: number}>} history - PoR reading history.
 * @param {number} hoursAgo - How many hours back to look up.
 * @returns {{cfs: number, actualHoursAgo: number}|null} The selected reading's cfs plus the actual age (hours) of the matched entry, or null if no history or no match within the selection window.
 */
// Get PoR reading from X hours ago. Uses the same outlier-robust selection as the
// client (selectHistoricReading, shared/model.js) so the server's time-shift lookup
// matches the displayed one on identical input (C8, v36.4). The 1h null-within-window
// guard now comes solely from selectHistoricReading's internal matchMs default (1h).
function getPoRFromHistory(history, hoursAgo) {
    if (!history?.length) return null;

    const targetTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
    const closest = selectHistoricReading(history, targetTime);
    if (!closest) return null;

    // Build the {cfs, actualHoursAgo} shape explicitly from the selected ENTRY — do not
    // return the entry itself, or actualHoursAgo would be undefined and silently zero out
    // the PoR-delta staleness decay downstream.
    return {
        cfs: closest.cfs,
        actualHoursAgo: (Date.now() - closest.timestamp) / (60 * 60 * 1000)
    };
}

// estimateLFFlowFromStage and estimateLFStage imported from ./shared/model
// getFlowState imported from shared/model.js

// --- Server-side shadow model state management ---

/**
 * Loads persisted shadow-model state from Supabase, merging onto defaults so missing/new fields are populated. Fail-safe: returns defaults on read error.
 * @param {Object} client - Supabase client.
 * @returns {Promise<Object>} Shadow state with lfFeedback ({correctionFactor, lastPredictedLF, lastPredictionTime, alpha}), onlineRegression ({weights, learningRate, nFeatures, trainCount}), and kalman ({x, P, Q_base, initialized}).
 */
async function loadShadowModelState(client) {
    const defaults = {
        lfFeedback: { correctionFactor: 0, lastPredictedLF: null, lastPredictionTime: null, alpha: 0.4 },
        onlineRegression: { weights: null, learningRate: 0.001, nFeatures: 9, trainCount: 0 },
        kalman: { x: null, P: null, Q_base: 0.0001, initialized: false }
    };
    try {
        const stored = await getObs(client, 'shadow_model_state', 'system');
        if (stored) {
            if (stored.lfFeedback) Object.assign(defaults.lfFeedback, stored.lfFeedback);
            if (stored.onlineRegression) Object.assign(defaults.onlineRegression, stored.onlineRegression);
            if (stored.kalman) Object.assign(defaults.kalman, stored.kalman);
            return defaults;
        }
    } catch (e) {
        console.warn('Shadow state load failed (non-fatal):', e.message);
    }
    return defaults;
}

/**
 * Persists shadow-model state to Supabase, stamping state.lastUpdated. Fail-safe: swallows errors (non-fatal warning).
 * @param {Object} client - Supabase client.
 * @param {Object} state - Shadow-model state object (lfFeedback/onlineRegression/kalman) to persist.
 * @returns {Promise<void>}
 */
async function saveShadowModelState(client, state) {
    try {
        state.lastUpdated = new Date().toISOString();
        await upsertObs(client, 'shadow_model_state', 'system', state);
    } catch (e) {
        console.warn('Shadow state save failed (non-fatal):', e.message);
    }
}

/**
 * Shadow model 1: corrects the production CFS by a fast EMA (alpha) of the recent GF→LF discrepancy, learning only when the prior prediction is 4–12h old. Mutates `state`.
 * @param {number} productionCFS - Current production (raw) GF estimate in cfs; null/<=0 returns null.
 * @param {number} lfActualCFS - Observed Little Falls discharge in cfs; falsy returns null.
 * @param {Object} state - LF-feedback state ({correctionFactor, lastPredictedLF, lastPredictionTime, alpha}); mutated in place.
 * @returns {{cfs: number, stage: number}|null} Corrected LF-scale prediction (cfs + estimated stage), or null when inputs are missing or the corrected value is <= 0.
 */
// --- Server Shadow Model 1: LF Feedback ---
// Tracks recent GF→LF discrepancy with fast EMA (α=0.4).
// Ported from src/estimation/shadow-models.js lines 18-57
function shadowLFFeedback(productionCFS, lfActualCFS, state) {
    if (!productionCFS || productionCFS <= 0 || !lfActualCFS) return null;

    if (state.lastPredictedLF !== null && state.lastPredictionTime !== null) {
        const hoursSincePrediction = (Date.now() - state.lastPredictionTime) / 3600000;
        if (hoursSincePrediction >= 4 && hoursSincePrediction <= 12) {
            const discrepancy = (lfActualCFS - state.lastPredictedLF) / state.lastPredictedLF;
            const clampedDisc = Math.max(-0.30, Math.min(0.30, discrepancy));
            state.correctionFactor = state.alpha * clampedDisc + (1 - state.alpha) * state.correctionFactor;
            state.lastPredictedLF = null;
            state.lastPredictionTime = null;
        }
    }

    const correctedCFS = Math.round(productionCFS * (1 + state.correctionFactor));

    if (state.lastPredictedLF === null) {
        state.lastPredictedLF = correctedCFS;
        state.lastPredictionTime = Date.now();
    }

    if (correctedCFS <= 0) return null;
    return { cfs: correctedCFS, stage: estimateLFStage(correctedCFS) };
}

/**
 * Shadow model 2: predicts LF discharge from a 9-feature linear model trained online by SGD toward the observed LF. Mutates `state` (weights/trainCount).
 * @param {number} productionCFS - Current production (raw) GF estimate in cfs; null/<=0 returns null. Also feeds the recent-error feature.
 * @param {Object} inputs - Feature inputs: porCFS (required), porROC, efEstimateCFS, tribSumCFS, lfActualCFS (required), hourFraction.
 * @param {Object} state - Online-regression state ({weights, learningRate, nFeatures, trainCount}); weights are lazily initialized and updated in place.
 * @returns {{cfs: number, stage: number}|null} Predicted LF-scale value (cfs + estimated stage), or null when required inputs are missing or the result is <= 0.
 */
// --- Server Shadow Model 2: Online Regression ---
// Multi-feature weighted regression with online SGD.
// Ported from src/estimation/shadow-models.js lines 63-142
function shadowOnlineRegression(productionCFS, inputs, state) {
    if (!productionCFS || productionCFS <= 0 || !inputs.lfActualCFS) return null;
    if (!inputs.porCFS) return null;

    if (!state.weights) {
        state.weights = new Array(state.nFeatures).fill(0);
        state.weights[0] = 0;      // bias
        state.weights[1] = 1.0;    // PoR CFS (dominant feature)
        state.weights[2] = 0;      // PoR rate of change
        state.weights[3] = 0;      // EF estimate
        state.weights[4] = 0;      // tributary sum
        state.weights[5] = 0;      // LF actual
        state.weights[6] = 0;      // sin(hour)
        state.weights[7] = 0;      // cos(hour)
        state.weights[8] = 0;      // recent error signal
    }

    const porROC = inputs.porROC ? inputs.porROC / 10 : 0;
    const efCFS = (inputs.efEstimateCFS || 0) / 10000;
    const tribSum = (inputs.tribSumCFS || 0) / 1000;
    const lfCFS = inputs.lfActualCFS / 10000;
    const hour = inputs.hourFraction;
    const sinHr = Math.sin(2 * Math.PI * hour / 24);
    const cosHr = Math.cos(2 * Math.PI * hour / 24);
    const recentError = (productionCFS - inputs.lfActualCFS) / Math.max(1, inputs.lfActualCFS);

    const features = [
        1,                          // bias
        inputs.porCFS / 10000,      // PoR (normalized)
        porROC,                     // PoR rate of change
        efCFS,                      // EF estimate
        tribSum,                    // tributary sum
        lfCFS,                      // LF actual
        sinHr,                      // sin(hour)
        cosHr,                      // cos(hour)
        recentError                 // recent error signal
    ];

    let prediction = 0;
    for (let i = 0; i < state.nFeatures; i++) {
        prediction += state.weights[i] * features[i];
    }
    prediction *= 10000;

    const target = inputs.lfActualCFS / 10000;
    const predNorm = prediction / 10000;
    const error = target - predNorm;

    if (Math.abs(error) > 0.001) {
        const lr = state.learningRate / (1 + state.trainCount * 0.0001);
        for (let i = 0; i < state.nFeatures; i++) {
            state.weights[i] += lr * error * features[i];
        }
        state.trainCount++;
    }

    const resultCFS = Math.round(Math.max(0, prediction));
    if (resultCFS <= 0) return null;
    return { cfs: resultCFS, stage: estimateLFStage(resultCFS) };
}

/**
 * Shadow model 3: a sequential Kalman filter that predicts forward from production CFS then assimilates LF actual (R=2%), time-shifted PoR/0.835 (R=5%), and the EF estimate (R=10%). Mutates `state` (x, P).
 * @param {number} productionCFS - Current production (raw) GF estimate in cfs; null/<=0 returns null. Used to seed/predict the state.
 * @param {Object} inputs - Observation inputs: lfActualCFS (required), porCFS (optional), efEstimateCFS (optional), isRising (boolean, inflates process noise).
 * @param {Object} state - Kalman state ({x, P, Q_base, initialized}); lazily initialized and updated in place.
 * @returns {{cfs: number, stage: number}|null} Filtered LF-scale estimate (cfs + estimated stage), or null when inputs are missing or the result is <= 0.
 */
// --- Server Shadow Model 3: Kalman Filter ---
// Sequential Kalman: assimilate LF (R=2%), PoR/0.835 (R=5%), EF (R=10%).
// Ported from src/estimation/shadow-models.js lines 148-219
function shadowKalman(productionCFS, inputs, state) {
    if (!productionCFS || productionCFS <= 0 || !inputs.lfActualCFS) return null;

    if (!state.initialized) {
        state.x = productionCFS;
        state.P = (productionCFS * 0.10) ** 2;
        state.initialized = true;
    }

    const x_prior = state.x;
    const innovation = productionCFS - x_prior;
    const x_predict = x_prior + 0.7 * innovation;

    const Q_mult = inputs.isRising ? 4.0 : 1.0;
    const Q = state.Q_base * (x_predict ** 2) * Q_mult;
    let P_predict = state.P + Q;

    let x_updated = x_predict;
    let P_updated = P_predict;

    // Observation 1: LF actual (R = 2%)
    const lfCFS = inputs.lfActualCFS;
    const R_lf = (lfCFS * 0.02) ** 2;
    let K = P_updated / (P_updated + R_lf);
    x_updated = x_updated + K * (lfCFS - x_updated);
    P_updated = (1 - K) * P_updated;

    // Observation 2: PoR time-shifted (R = 5%)
    if (inputs.porCFS) {
        const porEstimate = inputs.porCFS / 0.835;
        const R_por = (porEstimate * 0.05) ** 2;
        K = P_updated / (P_updated + R_por);
        x_updated = x_updated + K * (porEstimate - x_updated);
        P_updated = (1 - K) * P_updated;
    }

    // Observation 3: EF power-law estimate (R = 10%)
    if (inputs.efEstimateCFS && inputs.efEstimateCFS > 0) {
        const R_ef = (inputs.efEstimateCFS * 0.10) ** 2;
        K = P_updated / (P_updated + R_ef);
        x_updated = x_updated + K * (inputs.efEstimateCFS - x_updated);
        P_updated = (1 - K) * P_updated;
    }

    state.x = x_updated;
    state.P = P_updated;

    const resultCFS = Math.round(Math.max(0, x_updated));
    if (resultCFS <= 0) return null;
    return { cfs: resultCFS, stage: estimateLFStage(resultCFS) };
}

/**
 * Runs all three shadow models against the current inputs, each guarded so one failure can't break the others, and returns their predicted CFS. Mutates the per-model state inside shadowState.
 * @param {number} productionCFS - Production (raw) GF estimate in cfs used as each model's operating point.
 * @param {{data: Object, gauges: Object}} usgsData - Parsed USGS data/gauge map; source of LF/PoR/tributary discharge.
 * @param {Object} prediction - Current prediction object; uses efEstimateCFS.
 * @param {Object|null} porRiseRate - PoR rise-rate descriptor ({ratePerHour, flowState}) used for ROC and rising flag.
 * @param {Object} shadowState - Combined shadow state ({lfFeedback, onlineRegression, kalman}); mutated in place.
 * @returns {{lfFeedback: number|null, onlineRegression: number|null, kalman: number|null}} Each model's predicted CFS, or null where the model declined/failed.
 */
// --- Server shadow model orchestrator ---
function runServerShadowModels(productionCFS, usgsData, prediction, porRiseRate, shadowState) {
    const { data, gauges } = usgsData;
    const results = { lfFeedback: null, onlineRegression: null, kalman: null };

    const lfActualCFS = data[gauges.lf]?.q;
    const porCFS = data[gauges.por]?.q;
    const monocacyCFS = data[gauges.monocacy]?.q || 0;
    const gooseCFS = data[gauges.goose]?.q || 0;
    const broadRunCFS = data[gauges.broadRun]?.q || 0;
    const senecaCFS = data[gauges.seneca]?.q || 0;
    const tribSumCFS = monocacyCFS + gooseCFS + broadRunCFS + senecaCFS;

    const efEstimateCFS = prediction.efEstimateCFS || 0;
    const porROC = porRiseRate?.ratePerHour || 0;
    const isRising = porRiseRate?.flowState === 'rising';
    const hourFraction = new Date().getHours() + new Date().getMinutes() / 60;

    try {
        const r = shadowLFFeedback(productionCFS, lfActualCFS, shadowState.lfFeedback);
        results.lfFeedback = r?.cfs || null;
    } catch (e) { console.warn('🏇 LF Feedback failed:', e.message); }

    try {
        const r = shadowOnlineRegression(productionCFS,
            { porCFS, porROC, efEstimateCFS, tribSumCFS, lfActualCFS, hourFraction },
            shadowState.onlineRegression);
        results.onlineRegression = r?.cfs || null;
    } catch (e) { console.warn('🏇 Online Regression failed:', e.message); }

    try {
        const r = shadowKalman(productionCFS,
            { lfActualCFS, porCFS, efEstimateCFS, isRising },
            shadowState.kalman);
        results.kalman = r?.cfs || null;
    } catch (e) { console.warn('🏇 Kalman failed:', e.message); }

    return results;
}

/**
 * Loads the 18 EMA correction bins (gf_correction_bin rows) and assembles them via buildCorrectionBins for the prediction path. Fail-safe: returns {} (correction 0 / RAW model) on read error.
 * @param {Object} client - Supabase client.
 * @returns {Promise<Object>} Correction-bin map keyed by bin, or {} when the read fails.
 */
// Load the 18 EMA correction bins for the prediction path. Fail-safe: on read error
// return {} so the model predicts RAW (correction 0) rather than crashing, and WARN
// loudly so a silent raw-model regression is visible in the cron logs.
async function loadCorrectionBins(client) {
    const { data: rows, error } = await getObsRows(client, 'gf_correction_bin', { columns: 'gauge_id, data' });
    if (error) {
        console.warn(`⚠️ Failed to load correction bins — predicting RAW (correction=0): ${error.message}`);
        return {};
    }
    return buildCorrectionBins(rows);
}

/**
 * Computes the Great Falls nowcast: time-shifts PoR to GF (iterated to self-consistency), adds tributary inflows, applies the PoR-delta staleness correction, blends the flow-weighted EF power-law estimate, end-applies the learned EMA bin correction, and caps at 120% of LF (display-only).
 * @param {{data: Object, gauges: Object}} usgsData - Parsed USGS data/gauge map; requires LF and PoR discharge (returns null if either missing).
 * @param {Array<{timestamp: number, cfs: number}>} porHistory - PoR reading history for time-shifting and rise-rate.
 * @param {number|null} [waterTempC=null] - Water temperature in Celsius for cold-water EF model selection (<= coldMaxTemp uses the cold coefficients).
 * @param {Object} [correctionBins={}] - The 18 EMA correction bins; the learned correction is END-APPLIED (v36.0) via applyGFCorrection.
 * @returns {Object|null} Prediction record with predictedCFS/predictedStage (corrected, displayed), rawFinalCFS/rawFinalStage (uncorrected learning target), correctionApplied, flowBin, flowState, travelTimeGFtoLF, validationDue, EF fields (efStage/efEstimateCFS/efModelType/efWeight), waterTempC, useTimeShifted, useEfEnsemble, ceilingApplied, and lfCFS. Returns null when LF or PoR data is missing.
 */
// Make GF prediction
// waterTempC: water temperature in Celsius for cold-water EF model adjustment
// correctionBins: the 18 EMA bins; the learned correction is END-APPLIED (v36.0) — see applyGFCorrection
function makeGFPrediction(usgsData, porHistory, waterTempC = null, correctionBins = {}) {
    const { data, gauges } = usgsData;

    const lf = data[gauges.lf];
    const por = data[gauges.por];
    const monocacy = data[gauges.monocacy];
    const goose = data[gauges.goose];
    const broadRun = data[gauges.broadRun];
    const seneca = data[gauges.seneca];
    const ef = data[gauges.ef];

    if (!lf?.q || !por?.q) {
        console.log('Missing LF or PoR data');
        return null;
    }

    // Travel times, iterated to PoR-self-consistency — mirrors the client
    // great-falls.js:340-360 loop so the server's time-shift matches the displayed one
    // (C8, v36.4). Converges in 1 pass at normal/high flow (historic≈current), so output
    // is unchanged there; it only shifts the lookup at low flow where the curve is steep.
    const porRiseRate = getPoRRiseRateFromHistory(porHistory);
    let mult = getFlowMultiplier(lf.q);   // scalar (server returns a number); lf.q guaranteed by the !lf?.q guard above
    let travelPoRtoGF = getPoRtoGFTravelTime(mult, porRiseRate);
    let historicPoR = null;
    for (let iteration = 0; iteration < 3; iteration++) {
        const tryHistoric = getPoRFromHistory(porHistory, travelPoRtoGF);
        if (!tryHistoric) break;
        historicPoR = tryHistoric;
        const historicMult = getFlowMultiplier(historicPoR.cfs);   // bare scalar — NO .mult (server getFlowMultiplier returns a number)
        const newTravelTime = getPoRtoGFTravelTime(historicMult, porRiseRate);
        if (Math.abs(newTravelTime - travelPoRtoGF) < 1.0) break;  // converged: keep current historicPoR / travel / mult
        travelPoRtoGF = newTravelTime;
        mult = historicMult;
    }
    const travelGFtoLF = getGFtoLFTravelTime(mult, porRiseRate);

    // Tributary contributions (real-time gauge data, with drainage-area fallbacks)
    const monocacyFlow = monocacy?.q || (lf.q * TRIB_FALLBACK.monocacy);
    const gooseFlow = goose?.q || (lf.q * TRIB_FALLBACK.goose);
    const broadRunFlow = broadRun?.q || (lf.q * TRIB_FALLBACK.broadRun);
    const senecaFlow = seneca?.q || (lf.q * TRIB_FALLBACK.seneca);

    let porEstimateCFS;
    let useTimeShifted = false;

    if (historicPoR) {
        porEstimateCFS = historicPoR.cfs + monocacyFlow + gooseFlow + broadRunFlow + senecaFlow;
        useTimeShifted = true;

        // PoR-delta staleness correction: if PoR has changed significantly
        // since the time-shifted reading, scale the estimate proportionally.
        // Uses decay factor to account for wave travel (not all change has reached GF yet).
        const porChangeRatio = por.q / historicPoR.cfs;
        const porChangePct = (porChangeRatio - 1) * 100;

        if (Math.abs(porChangePct) > 5) {
            const fractionElapsed = Math.min(1.0, (historicPoR.actualHoursAgo || 0) / Math.max(1, travelPoRtoGF));
            const decayFactor = Math.min(DECAY_CAP, Math.sqrt(fractionElapsed));  // v28.0: lowered from 0.75
            const appliedRatio = 1 + (porChangeRatio - 1) * decayFactor;
            const rawEstimate = porEstimateCFS;
            porEstimateCFS = Math.round(porEstimateCFS * appliedRatio);
            console.log(`📊 PoR-delta correction: ${porChangePct > 0 ? '+' : ''}${porChangePct.toFixed(1)}%. ` +
                `Decay: ${(decayFactor*100).toFixed(0)}%. Estimate: ${rawEstimate} → ${porEstimateCFS} cfs`);
        }
    } else {
        porEstimateCFS = por.q + monocacyFlow + gooseFlow + broadRunFlow + senecaFlow;
    }

    // Edwards Ferry power-law estimate with cold-water adjustment
    // Cold water (≤10°C): 160 × EF^2.36
    // Default (>10°C or unknown): 126 × EF^2.46
    let efEstimateCFS = null;
    let useEfEnsemble = false;
    let efModelType = 'default';
    const efStage = ef?.h || null;

    if (efStage && efStage >= EF_MODEL.minStage && efStage <= EF_MODEL.maxStage) {
        // Select coefficients based on water temperature
        const useCold = waterTempC !== null && waterTempC <= EF_MODEL.coldMaxTemp;
        const coef = useCold ? EF_MODEL.coldCoef : EF_MODEL.coef;
        const exp = useCold ? EF_MODEL.coldExp : EF_MODEL.exp;
        efModelType = useCold ? 'cold' : (waterTempC !== null ? 'default' : 'default-no-temp');

        efEstimateCFS = coef * Math.pow(efStage, exp);
        if (efEstimateCFS > 500 && efEstimateCFS < 500000) {
            useEfEnsemble = true;
        }
    }

    // Weighted ensemble with flow-dependent EF weight
    const flowState = getFlowState(porHistory, por.q);
    const timeShiftedHoursAgo = historicPoR ? historicPoR.actualHoursAgo : null;

    let estimatedCFS;
    let efWeightUsed = null;
    if (useEfEnsemble) {
        efWeightUsed = getEFWeight(porEstimateCFS);
        const porWeight = 1 - efWeightUsed;

        // Discrepancy guard: >50% difference likely means ice/backwater/malfunction
        const discrepancy = Math.abs(efEstimateCFS - porEstimateCFS) / porEstimateCFS;
        if (discrepancy > 0.50) {
            console.log(`⚠️ Skipping EF: ${Math.round(discrepancy*100)}% discrepancy`);
            estimatedCFS = porEstimateCFS;
            useEfEnsemble = false;
            efWeightUsed = null;
        } else {
            estimatedCFS = porWeight * porEstimateCFS + efWeightUsed * efEstimateCFS;
            console.log(`🔀 Ensemble: ${(porWeight*100).toFixed(0)}% PoR (${Math.round(porEstimateCFS)}) + ${(efWeightUsed*100).toFixed(0)}% EF (${Math.round(efEstimateCFS)}) = ${Math.round(estimatedCFS)} cfs`);
        }
    } else {
        estimatedCFS = porEstimateCFS;
    }

    // v36.0: END-APPLY the learned EMA correction AFTER the ensemble (unit gain), with a
    // display-only 120%-LF ceiling guard on the CORRECTED output. `estimatedCFS` here is the
    // raw final — post-ensemble, PRE-ceiling. This UNCLIPPED raw final is the learning target
    // (the ceiling never censors it), and the correction bin is taken off it, so the bin the
    // correction is APPLIED from is the same bin the EMA LEARNS into.
    const rawFinalUnclipped = estimatedCFS;
    const { flowBin, correction, correctedFinal, ceilingApplied } = applyGFCorrection({
        rawFinalUnclipped, lfCFS: lf.q, correctionBins, flowState
    });
    if (correction !== 0) {
        console.log(`🎯 EMA correction (${flowBin}/${flowState}): raw ${Math.round(rawFinalUnclipped)} − ${Math.round(correction)} = ${Math.round(correctedFinal)} cfs${ceilingApplied ? ' (ceiling)' : ''}`);
    } else if (ceilingApplied) {
        console.log(`🔒 LF ceiling: ${Math.round(rawFinalUnclipped)} → ${Math.round(correctedFinal)} cfs (120% of LF ${Math.round(lf.q)})`);
    }

    return {
        timestamp: new Date().toISOString(),
        predictedCFS: Math.round(correctedFinal),                                   // displayed + headline (corrected)
        predictedStage: Math.round(estimateLFStage(correctedFinal) * 100) / 100,    // displayed stage
        rawFinalCFS: Math.round(rawFinalUnclipped),                                 // EMA learning target (raw, unclipped)
        rawFinalStage: Math.round(estimateLFStage(rawFinalUnclipped) * 100) / 100,  // stage-error learning target
        correctionApplied: Math.round(correction),                                  // signed EMA correction applied
        porCFS: Math.round(por.q),
        porEstimateCFS: Math.round(porEstimateCFS),  // PoR-only estimate before blending
        historicPorCFS: historicPoR ? Math.round(historicPoR.cfs) : null,
        monocacyCFS: Math.round(monocacyFlow),
        gooseCFS: Math.round(gooseFlow),
        flowBin,
        flowState,
        travelTimeGFtoLF: travelGFtoLF,
        validationDue: new Date(Date.now() + travelGFtoLF * 60 * 60 * 1000).toISOString(),
        efStage,
        efEstimateCFS: efEstimateCFS ? Math.round(efEstimateCFS) : null,
        efModelType,                         // 'cold', 'default', or 'default-no-temp'
        efWeight: efWeightUsed,              // Flow-dependent logistic weight (0 below 1000 cfs, ramps to W_MAX=0.40)
        waterTempC,                          // Water temperature used for model selection
        useTimeShifted,
        useEfEnsemble,
        ceilingApplied,
        lfCFS: Math.round(lf.q)
    };
}

/**
 * Validates due pending GF predictions against actual LF: cleans stale/unparseable rows, claims each row idempotently (delete-before-learn), runs two-tier anomaly detection, and on non-hard-flagged obs updates the EMA flow bin, stage bin, EF correlation, metadata accuracy, validation history, and shadow leaderboard. Learns on the RAW residual; headline scores the CORRECTED residual.
 * @param {Object} client - Supabase client.
 * @param {{data: Object, gauges: Object}} usgsData - Parsed USGS data/gauge map; requires LF discharge within [500, 500000] cfs or validation is skipped.
 * @param {number|null|undefined} waterTempC - Current water temperature (Celsius) for cold-water EF model selection in the EF cross-check.
 * @returns {Promise<{validated: number, cleaned: number}>} Counts of predictions validated and stale/invalid rows cleaned (returns 0 when there is no LF data, LF is out of range, or there are no pending rows).
 */
// Check and validate pending predictions
// waterTempC: current water temperature (°C) for cold-water EF model selection in anomaly check
async function validatePendingPredictions(client, usgsData, waterTempC) {
    const { data, gauges } = usgsData;
    const lf = data[gauges.lf];
    const seneca = data[gauges.seneca];
    const ef = data[gauges.ef];  // Edwards Ferry - needed for ice detection cross-check

    if (!lf?.q) {
        console.log('No LF data for validation');
        return 0;
    }

    // Sanity check
    if (lf.q < 500 || lf.q > 500000) {
        console.log(`LF reading ${lf.q} outside valid range, skipping validation`);
        return 0;
    }

    // Get pending predictions
    const { data: pending, error } = await client
        .from('potomac_observations')
        .select('id, data, created_at')
        .eq('observation_type', 'gf_prediction')
        .eq('gauge_id', 'pending')
        .order('created_at', { ascending: true });

    if (error || !pending?.length) {
        console.log('No pending predictions to validate');
        return 0;
    }

    console.log(`Found ${pending.length} pending predictions to check`);

    const now = new Date();
    const staleThreshold = 48 * 60 * 60 * 1000; // 48 hours
    let validated = 0;
    let cleaned = 0;
    // v37.15: validated pairs feed the LF-residual advisory (handler step 5c). BOTH paths
    // report (regular + hard-flagged) — the advisory's motivating misses were hard-flagged.
    const pairs = [];

    for (const pred of pending) {
        const validationDue = new Date(pred.data.validationDue);
        const createdAt = new Date(pred.created_at);
        const ageMs = now - createdAt;

        // Clean up stale predictions FIRST — older than 48h, or with an unparseable
        // created_at (NaN age) that could otherwise never age out. This must run
        // before the validationDue check below so a row with a bad due date can't
        // occupy the single pending slot forever (C12 deadlock).
        // Note: UPDATE to 'expired' hits the unique constraint, so we delete.
        if (isNaN(ageMs) || ageMs > staleThreshold) {
            const ageLabel = isNaN(ageMs) ? 'unparseable created_at' : `${Math.round(ageMs/3600000)}h old`;
            console.log(`🧹 Cleaning stale prediction (${ageLabel})`);
            const { error: staleErr } = await client.from('potomac_observations')
                .delete()
                .eq('id', pred.id);
            if (staleErr) {
                console.error(`❌ Stale cleanup FAILED for ${pred.id}:`, staleErr.message, staleErr.code, staleErr.details);
            }
            cleaned++;
            continue;
        }

        // A prediction whose validationDue can't be parsed can never validate —
        // delete it now rather than skip it forever (C12 deadlock).
        if (isNaN(validationDue.getTime())) {
            console.log(`🧹 Cleaning prediction with invalid validationDue: ${pred.id}`);
            const { error: badDueErr } = await client.from('potomac_observations')
                .delete()
                .eq('id', pred.id);
            if (badDueErr) {
                console.error(`❌ Invalid-date cleanup FAILED for ${pred.id}:`, badDueErr.message, badDueErr.code, badDueErr.details);
            }
            cleaned++;
            continue;
        }

        // v34.0: Reject validations >2.5h after due time
        // With 1h cron, normal delay is 0-1h; beyond that, flow conditions have changed too much
        // Predictions that miss the window remain pending until 48h stale cleanup expires them
        const validationDelayMs = now - validationDue;
        if (now >= validationDue && validationDelayMs <= VALIDATION_MAX_DELAY_MS) {
            const delayMinutes = Math.round(validationDelayMs / 60000);
            console.log(`⏱️ Validation delay: ${delayMinutes}min after due time`);

            // v34.0: Validate against raw LF discharge (not LF - Seneca estimate)
            // Eliminates ±50-200 cfs noise from 1% Seneca approximation
            // Correction naturally absorbs Seneca error + ungauged area signal
            // Also makes anomaly checks more consistent (EF model and stage-discharge
            // both predict LF-scale flow, so comparing to actual LF is more correct)
            const actualCFS = lf.q;

            // v36.0: split the RAW residual (what the EMA learns — correction-independent, no
            // feedback loop) from the CORRECTED residual (the headline — what the user is shown).
            // Legacy pending rows written before v36.0 have no rawFinalCFS/rawFinalStage; the ??
            // fallback treats their (corrected) predictedCFS as the raw value (no NaN).
            const rawCFS = pred.data.rawFinalCFS ?? pred.data.predictedCFS;
            const correctedCFS = pred.data.predictedCFS;

            const errorCFS = rawCFS - actualCFS;                               // LEARNING target (raw)
            const errorPercentRaw = (errorCFS / actualCFS) * 100;             // shadow leaderboard (raw)
            const errorPercentCorrected = ((correctedCFS - actualCFS) / actualCFS) * 100;  // HEADLINE (corrected)
            const flowBin = pred.data.flowBin;
            const flowState = pred.data.flowState || 'steady';

            // Stage error for rating-curve learning — on the RAW stage (same raw basis as errorCFS)
            const predictedStage = pred.data.rawFinalStage ?? pred.data.predictedStage;
            const actualStage = lf.h;  // LF gauge stage at validation time
            // v37.18 (TODO #29): finiteness checks, not truthiness — a legitimate 0.00 ft reading is a
            // real measurement, not a missing one. Unreachable at Little Falls (stage never approaches
            // 0) but it was the wrong predicate, and the v37.17 stageSkipped counter would have
            // silently absorbed it as "no stage pair". Number.isFinite (not `!= null`) is deliberate:
            // `actualStage = lf.h` comes from parsed USGS text, so NaN is reachable, and the old
            // truthiness test at least rejected it — `!= null` would not, and NaN would poison
            // sumAbsStageError irrecoverably.
            const errorStage = (Number.isFinite(predictedStage) && Number.isFinite(actualStage))
                ? Math.round((predictedStage - actualStage) * 100) / 100
                : null;

            // Log stage error for rating curve analysis
            if (errorStage !== null) {
                console.log(`📊 Stage validation: predicted=${predictedStage}ft, actual=${actualStage}ft, error=${errorStage > 0 ? '+' : ''}${errorStage}ft @ ${Math.round(actualCFS)}cfs (${flowBin}, ${flowState})`);
            }

            // ============================================
            // TWO-TIER ANOMALY DETECTION (v33.0)
            // Hard flags: physical data corruption → skip learning AND accuracy
            // Soft flags: model disagreement → INCLUDE in learning (with EMA clamp) AND accuracy
            // USGS ice flags are separate (upstream) — anomaly detection only runs on clean data
            // ============================================
            let hardScore = 0;
            let softScore = 0;
            const anomalyFlags = [];
            // Note: actualStage already declared above for stage error calculation

            // Check 1: EF cross-check → SOFT (model disagreement, not data corruption)
            // Use same cold/warm model selection as production to avoid false flags in winter
            const currentEfStage = ef?.h;
            let efEstimateNow = null;
            if (currentEfStage && currentEfStage >= EF_MODEL.minStage && currentEfStage <= EF_MODEL.maxStage) {
                const useColdEF = waterTempC !== null && waterTempC !== undefined && waterTempC <= EF_MODEL.coldMaxTemp;
                const efCoef = useColdEF ? EF_MODEL.coldCoef : EF_MODEL.coef;
                const efExp  = useColdEF ? EF_MODEL.coldExp  : EF_MODEL.exp;
                efEstimateNow = efCoef * Math.pow(currentEfStage, efExp);
                if (useColdEF) console.log(`🌡️ EF cross-check using cold-water model (${waterTempC.toFixed(1)}°C)`);
            }
            if (efEstimateNow && actualCFS) {
                const efDiscrepancy = (efEstimateNow - actualCFS) / actualCFS;
                if (efDiscrepancy > 0.25) {
                    softScore += 2;
                    anomalyFlags.push(`EF_DISCREPANCY:${(efDiscrepancy * 100).toFixed(0)}%,EF_est=${Math.round(efEstimateNow)},LF=${Math.round(actualCFS)}`);
                }
            }

            // Check 2: Stage-discharge inconsistency → HARD (LF data corrupted)
            if (actualStage && actualCFS) {
                const expectedFlowFromStage = estimateLFFlowFromStage(actualStage);
                if (expectedFlowFromStage > 0) {
                    const stageDiscrepancy = (expectedFlowFromStage - actualCFS) / actualCFS;
                    if (stageDiscrepancy > 0.35) {
                        hardScore += 2;
                        anomalyFlags.push(`STAGE_DISCHARGE:expected=${Math.round(expectedFlowFromStage)},actual=${Math.round(actualCFS)},disc=${(stageDiscrepancy*100).toFixed(0)}%`);
                    }
                }
            }

            // Check 3: Low flow + high stage → HARD (classic ice signature)
            if (actualCFS < 1500 && actualStage > 2.45) {
                hardScore += 2;
                anomalyFlags.push(`LOW_FLOW_HIGH_STAGE:${Math.round(actualCFS)}cfs@${actualStage}ft`);
            }

            // Check 4: Large prediction error → SOFT (model error, not data corruption)
            // Uses the RAW error — this gates the raw learning path (clamp/skip).
            if (Math.abs(errorPercentRaw) > 50) {
                softScore += 1;
                anomalyFlags.push(`LARGE_ERROR:${errorPercentRaw.toFixed(0)}%`);
            }

            // Idempotency claim (C12): delete this prediction row BEFORE persisting any
            // learning, and proceed only if we actually removed it. If 0 rows come back,
            // a concurrent run already claimed it — skip to avoid double-counting the same
            // observation into the EMA. A crash after the claim but before the bin write
            // loses one observation (noise), far better than a double-counted EMA (bias).
            const { data: claimed, error: claimErr } = await client.from('potomac_observations')
                .delete()
                .eq('id', pred.id)
                .select('id');
            if (claimErr) {
                console.error(`❌ Prediction CLAIM failed for ${pred.id}:`, claimErr.message, claimErr.code, claimErr.details);
                continue;
            }
            if (!claimed || claimed.length === 0) {
                console.log(`↩️ Prediction ${pred.id} already claimed by another run — skipping`);
                continue;
            }

            // Update correction bin
            const binKey = `${flowBin}_${flowState}`;
            const { data: existingBin } = await client
                .from('potomac_observations')
                .select('data')
                .eq('observation_type', 'gf_correction_bin')
                .eq('gauge_id', binKey)
                .single();

            const binData = existingBin?.data || {
                count: 0, sumError: 0, sumErrorSq: 0, meanError: 0, emaMeanError: 0
            };

            // Check 5: Statistical outlier → HARD (transient event, not systematic bias)
            // GF_EMA_ALPHA imported from shared/model.js (= 0.3); used below for EMA updates
            let isOutlier = false;

            if (binData.count >= 10) {
                const variance = (binData.sumErrorSq / binData.count) - (binData.meanError * binData.meanError);
                const stdDev = Math.sqrt(Math.max(0, variance));
                if (stdDev > 0) {
                    const zScore = Math.abs((errorCFS - binData.meanError) / stdDev);
                    isOutlier = zScore > 3;
                    if (isOutlier) {
                        hardScore += 2;  // v33.0: statistical outliers are hard flags
                        anomalyFlags.push(`STATISTICAL_OUTLIER:z=${zScore.toFixed(1)}`);
                    }
                }
            }

            // v33.0: Two-tier flag determination
            const isHardFlagged = hardScore >= 2;
            const isSoftFlagged = !isHardFlagged && softScore >= 2;
            const skipLearning = isHardFlagged;  // Only hard flags skip learning

            if (isHardFlagged) {
                console.log(`🧊 HARD FLAG (score=${hardScore}): ${anomalyFlags.join(', ')}`);
                console.log(`   LF reading: ${Math.round(actualCFS)} cfs — skipping learning + accuracy`);

                // v37.9 (#18): persist the dropped validation for post-hoc analysis. Hard-flagged
                // obs are excluded from BOTH learning and accuracy and otherwise vanish (only an
                // aggregate count + the single last reason survive in gf_metadata). Append-only
                // `validation_failure` row, unique gauge_id (`${Date.now()}_${pred.id}` — pred.id
                // makes it collision-safe even for two flags in the same ms). NON-FATAL: a logging
                // failure must never abort validation/accounting for this or any later pending row
                // (the row is already claim-deleted above; `validated++` and the metadata upsert
                // below still run). Mirrors the shadow-scoring try/catch.
                try {
                    const { error: failErr } = await insertObs(
                        client, 'validation_failure', `${Date.now()}_${pred.id}`,
                        {
                            predictionId: pred.id,
                            predictionCreatedAt: pred.created_at,
                            validatedAt: new Date().toISOString(),
                            predictedCFS: correctedCFS,      // headline (corrected) estimate
                            rawPredictedCFS: rawCFS,         // raw estimate (learning basis)
                            actualCFS,                       // the suspect LF reading that triggered the flag
                            errorCFS,                        // raw − actual
                            errorPercentCorrected,
                            errorPercentRaw,
                            predictedStage,
                            actualStage,
                            errorStage,
                            flowBin,
                            flowState,
                            hardScore,
                            anomalyFlags,                    // reason strings (e.g. LOW_FLOW_HIGH_STAGE:…)
                            // v37.13: prediction-time advisory state — both 2026 divergence misses
                            // were hard-flagged, so this row is where the correlation lives.
                            efDivergence: pred.data.efDivergence ?? null,
                            divergenceActive: pred.data.divergenceActive ?? null,
                            // v37.15: LF-residual advisory state at prediction time.
                            lfResidualActive: pred.data.lfResidualActive ?? null,
                            lfResidualLastErrPct: pred.data.lfResidualLastErrPct ?? null,
                        }
                    );
                    if (failErr) console.error(`❌ validation_failure log FAILED for ${pred.id}:`, failErr.message);
                } catch (logErr) {
                    console.error(`❌ validation_failure log threw (non-fatal) for ${pred.id}:`, logErr?.message || logErr);
                }
            } else if (isSoftFlagged) {
                console.log(`⚠️ SOFT FLAG (score=${softScore}): ${anomalyFlags.join(', ')}`);
                console.log(`   LF reading: ${Math.round(actualCFS)} cfs — included in learning (EMA clamped) + accuracy`);
            }

            // Track bin write outcome for health counters (set inside learning block)
            let binWriteFailed = false;

            // Update learning: hard flags skip entirely, soft flags use EMA clamping
            if (!isHardFlagged) {
                // v36.1: EMA bin update extracted to shared/model.js `updateCorrectionBin` so the
                // cron and the offline CI backtest harness (analysis/) learn through identical code
                // (no drift). Behavior-preserving — same accumulation, ±2σ soft-clamp, and EMA
                // recurrence as v36.0. Hard-flagged obs are filtered above and never reach here.
                const { learningError, clamped, maxDelta } = updateCorrectionBin(binData, errorCFS, isSoftFlagged);
                if (clamped) {
                    console.log(`   EMA clamped: ${Math.round(errorCFS)} → ${Math.round(learningError)} cfs (±2σ = ±${Math.round(maxDelta)})`);
                }

                const { error: binErr } = await client.from('potomac_observations').upsert({
                    observation_type: 'gf_correction_bin',
                    gauge_id: binKey,
                    data: binData
                }, { onConflict: 'observation_type,gauge_id' });
                if (binErr) {
                    console.error(`❌ Bin upsert FAILED for ${binKey}:`, binErr.message, binErr.code, binErr.details);
                    binWriteFailed = true;
                }

                // Also update stage error statistics for rating curve analysis
                if (errorStage !== null) {
                    const stageBinKey = `stage_${flowBin}_${flowState}`;
                    const { data: existingStageBin } = await client
                        .from('potomac_observations')
                        .select('data')
                        .eq('observation_type', 'gf_correction_bin')
                        .eq('gauge_id', stageBinKey)
                        .single();

                    const stageBinData = existingStageBin?.data || {
                        count: 0, sumError: 0, sumErrorSq: 0, meanError: 0, emaMeanError: 0
                    };

                    stageBinData.count += 1;
                    stageBinData.sumError += errorStage;
                    stageBinData.sumErrorSq += errorStage * errorStage;
                    stageBinData.meanError = stageBinData.sumError / stageBinData.count;

                    // EMA with soft-flag clamp (mirrors flow bin logic — Fix A).
                    // v36.0: clamp around emaMeanError (the updated quantity), not cumulative meanError.
                    let stageLearningError = errorStage;
                    if (isSoftFlagged && stageBinData.count >= 10) {
                        const stageVariance = (stageBinData.sumErrorSq / stageBinData.count) - (stageBinData.meanError * stageBinData.meanError);
                        const stageStdDev = Math.sqrt(Math.max(0, stageVariance));
                        const stageMaxDelta = 2 * stageStdDev;
                        const stageCenter = stageBinData.emaMeanError ?? stageBinData.meanError;
                        stageLearningError = Math.max(stageCenter - stageMaxDelta,
                                             Math.min(stageCenter + stageMaxDelta, errorStage));
                        if (stageLearningError !== errorStage) {
                            console.log(`   Stage EMA clamped: ${errorStage.toFixed(3)} → ${stageLearningError.toFixed(3)} ft (±2σ = ±${stageMaxDelta.toFixed(3)})`);
                        }
                    }

                    if (stageBinData.count === 1) {
                        stageBinData.emaMeanError = stageLearningError;
                    } else {
                        stageBinData.emaMeanError = GF_EMA_ALPHA * stageLearningError + (1 - GF_EMA_ALPHA) * (stageBinData.emaMeanError || stageBinData.meanError);
                    }

                    const stageVariance = (stageBinData.sumErrorSq / stageBinData.count) - (stageBinData.meanError * stageBinData.meanError);
                    stageBinData.stdDev = Math.round(Math.sqrt(Math.max(0, stageVariance)) * 1000) / 1000;

                    const { error: stageBinErr } = await client.from('potomac_observations').upsert({
                        observation_type: 'gf_correction_bin',
                        gauge_id: stageBinKey,
                        data: stageBinData
                    }, { onConflict: 'observation_type,gauge_id' });
                    if (stageBinErr) {
                        console.error(`❌ Stage bin upsert FAILED for ${stageBinKey}:`, stageBinErr.message, stageBinErr.code, stageBinErr.details);
                    }

                    console.log(`📈 Stage bin ${stageBinKey}: n=${stageBinData.count}, mean=${stageBinData.meanError.toFixed(3)}ft, stdDev=${stageBinData.stdDev}ft`);
                }
            }

            // Update EF correlation if we have EF stage
            const efStage = pred.data.efStage;
            if (efStage && actualCFS) {
                const { data: efCorr } = await client
                    .from('potomac_observations')
                    .select('data')
                    .eq('observation_type', 'ef_gf_correlation')
                    .eq('gauge_id', 'system')
                    .single();

                const corrData = efCorr?.data || {
                    points: [],
                    count: 0,
                    sumStage: 0,
                    sumCFS: 0,
                    sumStageCFS: 0,
                    sumStageSq: 0
                };

                corrData.points.push({ stage: efStage, cfs: actualCFS, timestamp: new Date().toISOString() });
                if (corrData.points.length > 200) {
                    // Re-anchor all cumulative sums to the trimmed 200-point window so regression
                    // reflects current conditions, not an ever-growing historical average.
                    corrData.points = corrData.points.slice(-200);
                    corrData.count    = corrData.points.length;
                    corrData.sumStage = corrData.points.reduce((s, p) => s + p.stage, 0);
                    corrData.sumCFS   = corrData.points.reduce((s, p) => s + p.cfs, 0);
                    corrData.sumStageCFS = corrData.points.reduce((s, p) => s + p.stage * p.cfs, 0);
                    corrData.sumStageSq  = corrData.points.reduce((s, p) => s + p.stage * p.stage, 0);
                    corrData.sumCFSSq    = corrData.points.reduce((s, p) => s + p.cfs * p.cfs, 0);
                    console.log('📈 EF correlation: re-anchored sums to last 200 observations');
                } else {
                    corrData.count += 1;
                    corrData.sumStage += efStage;
                    corrData.sumCFS += actualCFS;
                    corrData.sumStageCFS += efStage * actualCFS;
                    corrData.sumStageSq += efStage * efStage;
                }

                // Linear regression with R² calculation
                if (corrData.count >= 5) {
                    const n = corrData.count;
                    const meanStage = corrData.sumStage / n;
                    const meanCFS = corrData.sumCFS / n;

                    // Slope and intercept
                    const denominator = n * corrData.sumStageSq - corrData.sumStage * corrData.sumStage;
                    const slope = (n * corrData.sumStageCFS - corrData.sumStage * corrData.sumCFS) / denominator;
                    const intercept = (corrData.sumCFS - slope * corrData.sumStage) / n;
                    corrData.slope = slope;
                    corrData.intercept = intercept;

                    // R² calculation (coefficient of determination)
                    // sumCFSSq initialized excluding the just-pushed current obs (slice(0,-1))
                    // to avoid double-counting — it is added separately on the next line.
                    if (!corrData.sumCFSSq) {
                        corrData.sumCFSSq = corrData.points
                            .slice(0, -1)  // exclude current obs (already pushed above)
                            .reduce((sum, p) => sum + p.cfs * p.cfs, 0);
                    }
                    corrData.sumCFSSq += actualCFS * actualCFS;

                    // R² = 1 - (SS_res / SS_tot)
                    // For simple linear regression: R² = r² where r is Pearson correlation
                    const ssTotal = corrData.sumCFSSq - (corrData.sumCFS * corrData.sumCFS) / n;
                    const ssReg = slope * slope * (corrData.sumStageSq - (corrData.sumStage * corrData.sumStage) / n);
                    corrData.rSquared = ssTotal > 0 ? Math.round((ssReg / ssTotal) * 1000) / 1000 : 0;
                }

                const { error: efCorrErr } = await client.from('potomac_observations').upsert({
                    observation_type: 'ef_gf_correlation',
                    gauge_id: 'system',
                    data: corrData
                }, { onConflict: 'observation_type,gauge_id' });
                if (efCorrErr) {
                    console.error(`❌ EF correlation upsert FAILED:`, efCorrErr.message, efCorrErr.code, efCorrErr.details);
                }

                console.log(`🔗 EF correlation: n=${corrData.count}, slope=${corrData.slope?.toFixed(0)}, R²=${corrData.rSquared || 'N/A'}`);
            }

            // (The prediction row was already claimed/deleted above, before learning —
            // see the idempotency claim. No second delete needed.)

            // Update metadata
            const { data: meta } = await client
                .from('potomac_observations')
                .select('data')
                .eq('observation_type', 'gf_metadata')
                .eq('gauge_id', 'system')
                .single();

            const metaData = meta?.data || { totalValidations: 0, totalPredictions: 0, sumAbsErrorPercent: 0 };

            // v33.0 one-time migration: reset accuracy counters for two-tier system
            if (metaData.hardFlaggedValidations === undefined) {
                console.log(`🔄 v33.0 migration: initializing two-tier flagging counters`);
                metaData.hardFlaggedValidations = metaData.flaggedValidations || 0;
                metaData.softFlaggedValidations = 0;
                metaData.validValidations = 0;
                metaData.sumAbsErrorPercent = 0;
                metaData.avgErrorPercent = null;
            }

            metaData.totalValidations += 1;
            metaData.lastValidation = new Date().toISOString();

            // v33.0: Two-tier anomaly tracking
            if (isHardFlagged) {
                metaData.hardFlaggedValidations = (metaData.hardFlaggedValidations || 0) + 1;
                metaData.flaggedValidations = (metaData.flaggedValidations || 0) + 1;  // backward compat
                metaData.lastFlagged = new Date().toISOString();
                metaData.lastFlaggedReason = anomalyFlags.join(', ');
            } else {
                // Both validated AND soft-flagged contribute to accuracy
                if (isSoftFlagged) {
                    metaData.softFlaggedValidations = (metaData.softFlaggedValidations || 0) + 1;
                }
                metaData.validValidations = (metaData.validValidations || 0) + 1;
                // Headline accuracy scores the CORRECTED model (what the user sees), prequentially.
                metaData.sumAbsErrorPercent = (metaData.sumAbsErrorPercent || 0) + Math.abs(errorPercentCorrected);
            }

            // Compute accuracy from valid (non-hard-flagged) observations only
            const validCount = metaData.validValidations || 0;
            metaData.avgErrorPercent = validCount > 0 ? metaData.sumAbsErrorPercent / validCount : null;

            // Track stage error in metadata
            if (errorStage !== null) {
                metaData.stageValidations = (metaData.stageValidations || 0) + 1;
                metaData.sumAbsStageError = (metaData.sumAbsStageError || 0) + Math.abs(errorStage);
                metaData.avgStageError = metaData.sumAbsStageError / metaData.stageValidations;
            } else if (!isHardFlagged) {
                // v37.17: a NON-hard-flagged validation with no usable stage pair still updates the CFS
                // correction bin but never reaches the stage_* bin write, which is gated on
                // `errorStage !== null` INSIDE the `!isHardFlagged` block above. That gap was silent:
                // `binWriteFailures` stays 0 because a missing stage is not a write failure, so the
                // stage_* series drifts behind the CFS series with nothing counting the difference.
                //
                // The `!isHardFlagged` guard here is load-bearing. Validations partition four ways:
                //   c1  clean + stage      -> CFS bin AND stage bin written   (stage bins sum to this)
                //   c2  clean + no stage   -> CFS bin only                    <- THIS counter
                //   c3  hard-flag + stage  -> neither bin written, but stageValidations++ (pre-existing)
                //   c4  hard-flag+no stage -> neither bin written
                // Without the guard this would count c2+c4 and no longer mean "learned CFS but not
                // stage". c4 is 0 live today, but a degraded LF gauge (actualStage = lf.h) is exactly
                // the condition that also trips the outlier hard flags, so it is not impossible.
                //
                // NOT backfilled: `totalValidations - stageValidations` = c2+c4, a different (also
                // well-defined) quantity that the UI shows alongside. Both counters live in the same
                // metadata object and are dropped together by the reset actions, so the derived figure
                // is scoped to "since the last metadata reset", not all-time.
                metaData.stageSkipped = (metaData.stageSkipped || 0) + 1;
            }

            // Bin write health counters (visible via API without checking logs)
            if (!isHardFlagged) {
                metaData.binWriteSuccesses = (metaData.binWriteSuccesses || 0) + (binWriteFailed ? 0 : 1);
                metaData.binWriteFailures = (metaData.binWriteFailures || 0) + (binWriteFailed ? 1 : 0);
                if (binWriteFailed) {
                    metaData.lastBinError = `${binKey}: upsert failed`;
                }
            }

            // Monthly summary (log on 1st of month, or every 100 validations)
            const isFirstOfMonth = new Date().getDate() === 1;
            const isMilestone = metaData.totalValidations % 100 === 0;
            if ((isFirstOfMonth || isMilestone) && metaData.totalValidations > 0) {
                console.log('📅 === MONTHLY/MILESTONE SUMMARY ===');
                console.log(`   Total validations: ${metaData.totalValidations}`);
                console.log(`   Avg CFS error: ${metaData.avgErrorPercent?.toFixed(1)}%`);
                console.log(`   Stage validations: ${metaData.stageValidations || 0}`);
                console.log(`   Avg stage error: ${metaData.avgStageError?.toFixed(3) || 'N/A'}ft`);
                console.log('=====================================');
            }

            const { error: metaErr } = await client.from('potomac_observations').upsert({
                observation_type: 'gf_metadata',
                gauge_id: 'system',
                data: metaData
            }, { onConflict: 'observation_type,gauge_id' });
            if (metaErr) {
                console.error(`❌ Metadata upsert FAILED:`, metaErr.message, metaErr.code, metaErr.details);
            }

            if (!isHardFlagged) {
                // Validation pair records the CORRECTED (displayed) estimate vs actual.
                await storeValidationPair(client, correctedCFS, actualCFS, errorPercentCorrected, flowBin, flowState,
                    {
                        efDivergence: pred.data.efDivergence ?? null,
                        divergenceActive: pred.data.divergenceActive ?? null,
                        lfResidualActive: pred.data.lfResidualActive ?? null,
                        lfResidualLastErrPct: pred.data.lfResidualLastErrPct ?? null
                    });
            }

            // Score shadow model predictions (non-blocking — failure must not break validation)
            if (!isHardFlagged && pred.data.shadowModels) {
                try {
                    const { data: existingLB } = await client
                        .from('potomac_observations')
                        .select('data')
                        .eq('observation_type', 'shadow_leaderboard')
                        .eq('gauge_id', 'system')
                        .single();

                    // One-time migration: reset leaderboard for server-side shadow transition
                    let lb = existingLB?.data || null;
                    if (lb && !metaData.shadowServerMigration) {
                        console.log('🏇 Resetting shadow leaderboard for server-side transition');
                        lb = null;
                    }

                    // Shadows are RAW-model variants — score the production row on the RAW error so
                    // the leaderboard comparison stays apples-to-apples (the EMA correction is an
                    // orthogonal post-hoc layer, not part of the horse race).
                    const updatedLB = scoreShadowPredictions(
                        pred.data.shadowModels,
                        actualCFS,
                        errorPercentRaw,
                        lb
                    );

                    if (updatedLB) {
                        if (!metaData.shadowServerMigration) {
                            metaData.shadowServerMigration = new Date().toISOString();
                            // Re-persist metadata (already upserted above, but migration flag is new)
                            await client.from('potomac_observations').upsert({
                                observation_type: 'gf_metadata', gauge_id: 'system', data: metaData
                            }, { onConflict: 'observation_type,gauge_id' });
                        }
                        const { error: lbErr } = await client.from('potomac_observations').upsert({
                            observation_type: 'shadow_leaderboard',
                            gauge_id: 'system',
                            data: updatedLB
                        }, { onConflict: 'observation_type,gauge_id' });
                        if (lbErr) {
                            console.error(`❌ Shadow leaderboard upsert FAILED:`, lbErr.message, lbErr.code, lbErr.details);
                        }
                        console.log(`🏇 Shadow leaderboard updated: round ${updatedLB.totalRounds}, winner=${updatedLB.lastWinner}`);
                    }
                } catch (shadowErr) {
                    console.error('Shadow scoring failed (non-fatal):', shadowErr.message);
                }
            }

            console.log(`✅ Validated prediction: corrected=${correctedCFS} (raw=${rawCFS}), actual=${Math.round(actualCFS)}, error=${errorPercentCorrected.toFixed(1)}% (raw ${errorPercentRaw.toFixed(1)}%)`);
            pairs.push({ at: Date.now(), errPct: errorPercentCorrected, hardFlagged: isHardFlagged });
            validated++;
        }
    }

    if (cleaned > 0) {
        console.log(`🧹 Cleaned ${cleaned} stale predictions`);
    }

    return { validated, cleaned, pairs };
}

/**
 * Stores a new pending GF prediction, but only if no existing pending row is still within its validation window (replaces a missed-window/invalid-date row first, per isExistingPredictionReplaceable). Increments totalPredictions on success.
 * @param {Object} client - Supabase client.
 * @param {Object} prediction - Prediction record (as returned by makeGFPrediction) to insert under gauge_id 'pending'.
 * @returns {Promise<void>}
 */
// Store new prediction
async function storePrediction(client, prediction) {
    // Check if there's an existing pending prediction still within its validation window.
    // If so, skip storing a new one — overwriting it would prevent it from ever being validated.
    // NOTE: this read is intentionally NOT swapped to getObs(). The original branches on
    // ROW existence (`if (existing)`), then passes the PAYLOAD (`existing.data`) to
    // isExistingPredictionReplaceable. getObs() collapses both into the payload, which would
    // skip the replace-and-reinsert path for a (pathological) pending row whose `data` column
    // is null — a behavior change. Kept raw to preserve row-vs-payload distinction exactly.
    const { data: existing } = await client.from('potomac_observations')
        .select('data')
        .eq('observation_type', 'gf_prediction')
        .eq('gauge_id', 'pending')
        .single();

    if (existing) {
        // Replace the existing pending row only if it has missed its validation window,
        // or has a missing/unparseable due date that could never validate (C12 — an
        // Invalid Date is truthy, so the old guard left bad-date rows un-replaceable).
        if (!isExistingPredictionReplaceable(existing.data, Date.now())) {
            console.log(`⏳ Skipping new prediction — existing pending still in window (due: ${existing.data?.validationDue})`);
            return;
        }

        console.log(`🗑️ Removing missed-window/invalid prediction (due: ${existing.data?.validationDue})`);
        await deleteObs(client, 'gf_prediction', { gaugeId: 'pending' });
    }

    const { error: insertErr } = await insertObs(client, 'gf_prediction', 'pending', prediction);

    if (insertErr) {
        console.error(`❌ Prediction INSERT FAILED:`, insertErr.message, insertErr.code, insertErr.details);
        return; // Don't increment metadata for a prediction that wasn't stored
    }

    // Increment prediction count (health tracking moved to updateRunHealth)
    const metaData = await getObs(client, 'gf_metadata', 'system') || { totalValidations: 0, totalPredictions: 0 };
    metaData.totalPredictions += 1;

    const { error: predMetaErr } = await upsertObs(client, 'gf_metadata', 'system', metaData);
    if (predMetaErr) {
        console.error(`❌ Prediction metadata upsert FAILED:`, predMetaErr.message, predMetaErr.code, predMetaErr.details);
    }

    console.log(`Stored prediction: ${prediction.predictedCFS} cfs, validation due: ${prediction.validationDue}`);
}

/**
 * Pure: given hours since the last run and prior counters, computes updated run-health counters under the hourly cron cadence (the current run is not a miss, hence cycles − 1).
 * @param {number} gapHours - Hours elapsed since the last recorded run.
 * @param {Object} [prev={}] - Prior counters ({missedRuns, consecutiveRuns}).
 * @returns {{missedRuns: number, consecutiveRuns: number, missedThisGap: number}} Updated total missed runs, consecutive-run streak (reset to 1 when a gap > 1 cycle), and misses attributed to this gap.
 */
// Update function execution health — fires every run regardless of prediction outcome.
// Pure: given hours since the last run and the prior counters, return updated run-health
// counters. The cron cadence is hourly (netlify.toml: "0 */1 * * *"), so round(gapHours)
// approximates the number of hourly cycles elapsed; the current run itself is not a miss,
// hence the −1. round() (vs floor()) tolerates scheduler jitter symmetrically and avoids
// undercounting on large fractional gaps. Extracted + exported (_test) so the arithmetic is
// unit-tested without DB/network.
function computeRunHealth(gapHours, prev = {}) {
    const cycles = Math.round(gapHours);
    const missedThisGap = Math.max(0, cycles - 1);
    return {
        missedRuns: (prev.missedRuns || 0) + missedThisGap,
        consecutiveRuns: cycles <= 1 ? (prev.consecutiveRuns || 0) + 1 : 1,
        missedThisGap,
    };
}

/**
 * Updates persisted run-health metadata every run (independent of prediction outcome): computes the gap since lastPrediction, applies computeRunHealth, and upserts missedRuns/consecutiveRuns/lastPrediction.
 * @param {Object} client - Supabase client.
 * @returns {Promise<void>}
 */
// Separated from storePrediction so skipped-prediction runs are still tracked correctly.
async function updateRunHealth(client) {
    const metaData = await getObs(client, 'gf_metadata', 'system') || { totalValidations: 0, totalPredictions: 0 };
    const now = new Date();
    const lastRun = metaData.lastPrediction ? new Date(metaData.lastPrediction) : null;
    const gapHours = lastRun ? (now - lastRun) / (60 * 60 * 1000) : 0;

    // Update run-health counters under the hourly cadence (see computeRunHealth).
    const health = computeRunHealth(gapHours, metaData);
    if (health.missedThisGap > 0) {
        console.log(`⚠️ Gap detected: ${gapHours.toFixed(1)}h since last run (~${health.missedThisGap} missed cycles)`);
    }
    metaData.missedRuns = health.missedRuns;
    metaData.consecutiveRuns = health.consecutiveRuns;
    metaData.lastPrediction = now.toISOString();

    const { error } = await upsertObs(client, 'gf_metadata', 'system', metaData);
    if (error) {
        console.error(`❌ Health metadata upsert FAILED:`, error.message, error.code, error.details);
    }

    console.log(`📊 Health: ${metaData.consecutiveRuns} consecutive runs, ${metaData.missedRuns || 0} total missed`);
}

/**
 * Validates due pending 48h forecast predictions against actual LF. A row is due at `targetTime + GF→LF travel` when it carries the travel offset (`travelApplied`, the NWS-LF path) and at `targetTime` when it does not (the PoR/extrapolation fallbacks) — v37.16; before that every row was scored at `targetTime`, ignoring the travel term. Rows are processed in ripeness order; a row with an unparseable `targetTime` is deleted rather than scored; rows older than `FORECAST_STALE_MAX_AGE_HRS` (90h) are swept. For each due row it updates per-horizon forecast metadata scoring the model plus the persistence baseline (the two NWS baselines were retired in v37.16 — on the model's own clock they are the model plus a constant; their existing counters remain untouched as an audit trail), then deletes the validated row.
 * @param {Object} client - Supabase client.
 * @param {{data: Object, gauges: Object}} usgsData - Parsed USGS data/gauge map; requires LF discharge within [500, 500000] cfs to validate a row.
 * @returns {Promise<{validated: number, cleaned: number}>} Counts of forecast predictions validated and stale rows cleaned.
 */
// Validate pending 48h forecast predictions
async function validateForecastPredictions(client, usgsData) {
    const { data, gauges } = usgsData;
    const lf = data[gauges.lf];
    const now = new Date();
    let validated = 0;
    let cleaned = 0;

    if (!lf?.q) {
        console.log('No LF data for forecast validation');
        return { validated: 0, cleaned: 0 };
    }

    // v37.16: GF→LF travel for the validation clock. A forecast for wall-clock T predicts flow at
    // GREAT FALLS at T; that water reaches Little Falls only at T + travel, so it must be scored
    // against LF then — the behavior CLAUDE.md and tech-appendix §8.6 already document. Recomputed
    // here from current LF flow rather than persisting the client's value: that keeps the public
    // unauthenticated write path free of a numeric field an attacker could use to defer or deny
    // validation, and needs no migration for rows already in flight. The tradeoff, stated honestly:
    // the value was BUILT with the client's travel (from the GF estimate at creation) and is SCORED
    // with the server's (from LF flow at validation). Under near-stationary flow those agree well
    // inside the cron's own hourly quantization, but across a flood recession over a +48h row's
    // life they can differ by hours. Validation-time flow is the more physical choice for the
    // parcel actually arriving, so the direction is right — but it is an approximation, not an
    // identity. NB the server's getFlowMultiplier returns a BARE SCALAR (no .mult) — see shared/model.js.
    const forecastTravelHrs = getGFtoLFTravelTime(getFlowMultiplier(lf.q));

    // Get pending forecast predictions. Cap raised 100 → 300: the 2h client-side posting throttle
    // lives in memory only (src/state/store.js), so it resets on every page load and depth scales
    // with visitor count rather than a fixed cadence — and deferring validation by one travel time
    // lengthens every row's life.
    const { data: pending, error } = await getObsRows(client, 'gf_forecast_pending', {
        columns: 'id, gauge_id, data, created_at',
        orderBy: 'created_at',
        ascending: true,
        limit: 300
    });

    if (error) {
        console.error('Error loading pending forecasts:', error);
        return { validated: 0, cleaned: 0 };
    }

    if (!pending || pending.length === 0) {
        return { validated: 0, cleaned: 0 };
    }

    console.log(`📈 Found ${pending.length} pending forecast predictions`);

    // Process in ripeness order rather than insertion order. Be precise about what this does and
    // does not buy: the sort runs AFTER the fetch, so it cannot change WHICH rows arrive — the
    // starvation guard is the cap raise above, not this. The loop below has no break and no
    // per-tick budget, so every fetched row is examined regardless of order. What the sort buys is
    // resilience if this function throws or times out part-way (it is wrapped non-fatally by the
    // caller): the rows already processed are then the ones that were actually due, not an
    // arbitrary prefix by age. Sorted here rather than in the query so it does not depend on
    // JSON-path ordering in the DB layer, where a malformed clause would error the whole read and
    // silently halt all forecast validation.
    // Unparseable targetTime sorts last and is cleaned by the validity guard in the loop.
    const byRipeness = [...pending].sort((a, b) => {
        const ta = Date.parse(a.data?.targetTime);
        const tb = Date.parse(b.data?.targetTime);
        return (isNaN(ta) ? Infinity : ta) - (isNaN(tb) ? Infinity : tb);
    });

    for (const pred of byRipeness) {
        const targetTime = new Date(pred.data.targetTime);
        const horizonNum = pred.data.horizon;  // e.g., 6, 12, 24, 48
        const horizonKey = `+${horizonNum}h`;  // e.g., '+6h' for metadata lookup
        const createdAt = new Date(pred.created_at);

        // An unparseable targetTime makes every downstream comparison NaN — and `now < NaN` is
        // false, so such a row would validate immediately against whatever LF happens to be.
        // It can never validate meaningfully, so clean it now rather than let it score garbage,
        // mirroring the nowcast's invalid-validationDue handling (C12). The write path already
        // rejects these (C13a), so this only reaches corrupt or legacy rows.
        if (isNaN(targetTime.getTime())) {
            console.log(`🧹 Cleaning forecast prediction with invalid targetTime: ${pred.id}`);
            const { error: badTimeDelErr } = await deleteObsById(client, pred.id);
            if (badTimeDelErr) {
                console.error('❌ Invalid-targetTime forecast delete FAILED:', badTimeDelErr.message, badTimeDelErr.code, badTimeDelErr.details);
            } else {
                cleaned++;
            }
            continue;
        }

        // Ripeness. Rows whose value carries the GF→LF offset (the NWS-LF path) are scored one
        // travel time after targetTime; rows from the PoR/extrapolation fallbacks carry no offset
        // and must NOT be deferred — deferring them would newly mis-score a path that was never
        // wrong. Absent flag ⇒ false ⇒ pre-v37.16 behavior for legacy rows.
        const travelOffsetHrs = pred.data.travelApplied === true ? forecastTravelHrs : 0;
        const dueTime = new Date(targetTime.getTime() + travelOffsetHrs * 60 * 60 * 1000);

        // Check if the water has arrived at LF (allow 15 min buffer for processing)
        if (now < new Date(dueTime.getTime() + 15 * 60 * 1000)) {
            continue; // Not ready for validation yet
        }

        // Check if prediction is stale. Threshold covers the deferred window: a +48h forecast at
        // the 1,000-cfs floor ripens at 48 + 16.95 = 64.95h, so the old flat 72h left ~7h of
        // margin — a cron gap at low flow would have deleted low-flow rows before they ripened,
        // biasing the metric exactly where travel is longest.
        const ageHours = (now - createdAt) / (1000 * 60 * 60);
        if (ageHours > FORECAST_STALE_MAX_AGE_HRS) {
            const { error: staleDelErr } = await deleteObsById(client, pred.id);
            if (staleDelErr) {
                console.error('❌ Stale forecast delete FAILED:', staleDelErr.message, staleDelErr.code, staleDelErr.details);
            } else {
                cleaned++;
            }
            continue;
        }

        // Validate: compare predicted vs actual
        const predictedCFS = pred.data.predictedCFS;
        const actualCFS = lf.q;

        // Skip validation if actual CFS is unrealistic
        if (actualCFS < 500 || actualCFS > 500000) {
            console.warn(`⚠️ Skipping forecast validation: LF reading ${actualCFS} cfs is outside valid range`);
            continue;
        }

        const errorCFS = predictedCFS - actualCFS;
        const errorPercent = Math.abs(errorCFS / actualCFS) * 100;

        console.log(`📈 Validating ${horizonKey} forecast: predicted=${predictedCFS} cfs, actual=${actualCFS} cfs, error=${errorPercent.toFixed(1)}%`);

        // Update metadata for this horizon
        const metaData = await getObs(client, 'gf_forecast_metadata', horizonKey) || { validations: 0, sumAbsErrorPercent: 0 };
        metaData.validations += 1;
        metaData.sumAbsErrorPercent = (metaData.sumAbsErrorPercent || 0) + errorPercent;
        metaData.avgErrorPercent = metaData.sumAbsErrorPercent / metaData.validations;
        metaData.lastValidation = now.toISOString();
        metaData.lastErrorPercent = errorPercent;

        // v37.16: the two NWS baselines are no longer scored. Once the model is validated on the GF
        // clock, a same-clock NWS baseline is the model by construction — nwsLfBiasCorrected is the
        // identical integer, nwsLfRaw is the model minus the batch-constant lfBiasOffset — so the
        // "vs NWS" delta could not be made informative by any clock alignment. Existing
        // nwsRaw*/nwsCorrected* counters are left untouched in the metadata rows as an audit trail;
        // they simply stop accruing and are no longer rendered.

        // Score persistence baseline (assume flow stays the same). This is the only baseline that
        // survives clock alignment: observed LF is an external reference, not a model output.
        if (pred.data.persistenceCFS) {
            const persistError = Math.abs((pred.data.persistenceCFS - actualCFS) / actualCFS) * 100;
            metaData.persistenceValidations = (metaData.persistenceValidations || 0) + 1;
            metaData.persistenceSumAbsErrorPercent = (metaData.persistenceSumAbsErrorPercent || 0) + persistError;
            metaData.persistenceAvgErrorPercent = metaData.persistenceSumAbsErrorPercent / metaData.persistenceValidations;
        }

        const { error: fcastMetaErr } = await upsertObs(client, 'gf_forecast_metadata', horizonKey, metaData);

        if (fcastMetaErr) {
            console.error('❌ Forecast metadata upsert FAILED:', fcastMetaErr.message, fcastMetaErr.code, fcastMetaErr.details);
        }

        // Delete the validated prediction
        const { error: delErr } = await deleteObsById(client, pred.id);
        if (delErr) {
            console.error('❌ Forecast prediction delete FAILED:', delErr.message, delErr.code, delErr.details);
            continue; // skip validated++ to prevent double-counting
        }
        validated++;
    }

    return { validated, cleaned };
}

// Expose internals for testing
/**
 * Handler step 5c (v37.15): advances and persists the LF-residual advisory state — the
 * model's own validated-scorecard honesty signal (plan: analysis/lf-residual-advisory-plan-
 * 2026-07-23.md §1). Runs every cycle so the state decays; NEVER throws (display-only
 * plumbing must not break the learning cron). On the active→inactive transition, emits the
 * completed firing as an append-only `lf_residual_episode` row (gauge_id = episode.startedAt,
 * F9: a concurrent duplicate insert collides with the unique key and self-dedups).
 * @param {Object} client - Supabase client.
 * @param {Object} cycle - Cycle inputs.
 * @param {number} cycle.runStartMs - Handler start time, for the F2 concurrent-write skip-guard.
 * @param {Array<{at: number, errPct: number, hardFlagged?: boolean}>} cycle.pairs - This cycle's validated pairs (empty when validation was skipped or matured nothing).
 * @param {number|null} cycle.lfCFS - Observed LF discharge (cfs) for episode documentation.
 * @returns {Promise<Object|null>} The persisted state, or null when skipped/failed (callers must tolerate null — the prediction stamp is simply omitted).
 */
async function updateLfResidualAdvisory(client, { runStartMs, pairs, lfCFS }) {
    try {
        const prevResidual = await getObs(client, 'lf_residual', 'state');
        // F2 skip-guard: if we validated nothing this cycle and another (overlapping) run
        // wrote the state after we started, our no-pair update adds nothing but a
        // timestamp — writing it could clobber a just-latched state with a stale read.
        const prevWriteMs = Date.parse(prevResidual?.updatedAt || '') || 0;
        if (pairs.length === 0 && prevWriteMs > runStartMs) {
            console.log('⏭️ LF-residual state skipped (fresher concurrent write, no pairs this cycle)');
            return null;
        }
        const state = updateLfResidualState(prevResidual, { nowMs: Date.now(), pairs, lfCFS });
        // Write failures — resolved {error} OR rejection — must not lose the computed state:
        // the prediction stamp and episode emission still proceed (5b-parity: divergenceState
        // is assigned before its upsert, so a 5b write failure keeps the stamp too).
        const { error: resErr } = await upsertObs(client, 'lf_residual', 'state', state)
            .catch(e => ({ error: e }));
        if (resErr) console.warn('⚠️ LF-residual state write failed (non-fatal):', resErr.message);
        else if (state.active) console.log(`⚠️ LF-residual ADVISORY active: last err ${state.lastErrPct}%`);

        // Deactivation -> append-only episode row (duty/flow-regime documentation).
        if (prevResidual?.active && !state.active && prevResidual.episode) {
            const ep = prevResidual.episode;
            const { error: epErr } = await insertObs(client, 'lf_residual_episode', `${ep.startedAt}`, {
                ...ep,
                endedAt: state.updatedAt,
                meanErrPct: ep.pairCount > 0 ? Math.round((ep.sumErrPct / ep.pairCount) * 10) / 10 : null
            }).catch(e => ({ error: e }));
            if (epErr) console.warn('⚠️ LF-residual episode log failed (non-fatal):', epErr.message);
            else console.log(`📒 LF-residual episode logged: ${ep.cycles} cycles, ${ep.pairCount} pairs, worst ${ep.worstErrPct}%, LF ${ep.minLF}–${ep.maxLF}`);
        }
        return state;
    } catch (e) {
        console.warn('⚠️ LF-residual state update threw (non-fatal):', e?.message || e);
        return null;
    }
}

exports._test = {
    validateUSGSResponse, fetchWithTimeout, fetchWaterTemp,
    fetchUSGSData, getPoRFromHistory, estimateLFStage, makeGFPrediction,
    scoreShadowPredictions, storePrediction, validatePendingPredictions,
    shadowLFFeedback, shadowOnlineRegression, shadowKalman,
    runServerShadowModels, loadShadowModelState, saveShadowModelState,
    computeRunHealth,
    updateLfResidualAdvisory,
    validateForecastPredictions, FORECAST_STALE_MAX_AGE_HRS,
};

/**
 * Netlify scheduled-function entry point (hourly cron). Fetches USGS data and water temp, stores PoR history, validates pending nowcast and 48h forecast predictions (skipping learning when PoR/LF are ice-affected), makes and stores a new prediction with attached shadow models, records GF history, updates run health, and pings healthchecks.io on success/failure.
 * @param {Object} event - Netlify function event (unused).
 * @param {Object} context - Netlify function context (unused).
 * @returns {Promise<{statusCode: number, body: string}>} 200 with a JSON run summary on success; 500 when Supabase is unconfigured or the run throws (with a JSON error body).
 */
// Main handler
exports.handler = async (event, context) => {
    console.log('=== Scheduled Update Starting ===');
    console.log('Time:', new Date().toISOString());

    const client = getSupabase();
    if (!client) {
        console.error('Supabase not configured');
        return { statusCode: 500, body: 'Supabase not configured' };
    }

    try {
        // v37.15 (F2): run-start marker for the LF-residual concurrent-write skip-guard (5c).
        const runStartMs = Date.now();

        // 1. Fetch USGS data and water temperature in parallel
        console.log('Fetching USGS data and water temperature...');
        const [usgsData, waterTempC] = await Promise.all([
            fetchUSGSData(),
            fetchWaterTemp()
        ]);
        if (!usgsData) {
            // Throw (don't early-return) so the failure flows into the catch block's healthchecks
            // /fail ping — an early return here pinged neither success nor /fail, making a USGS-fetch
            // stall invisible to monitoring (it masked a ~2h outage on 2026-06-18). (Tier 2 #5)
            throw new Error('Failed to fetch USGS data');
        }
        console.log('USGS data fetched successfully');

        // 2. Store PoR history
        console.log('Storing PoR history...');
        const porHistory = usgsData.data[usgsData.gauges.por]?.history || [];
        const porStored = await storePoRHistory(client, porHistory);
        if (!porStored) console.warn('⚠️ PoR history write failed — predictions may use incomplete history');

        // 3. Load stored PoR history for time-shifting
        const storedHistory = await getObs(client, 'por_history', 'system');

        const fullHistory = storedHistory?.readings || porHistory;

        // Check if critical gauges are ice-affected (PoR, LF, or EF missing)
        const porIce = usgsData.data[usgsData.gauges.por]?.iceAffected;
        const lfIce = usgsData.data[usgsData.gauges.lf]?.iceAffected;
        const efMissing = !usgsData.data[usgsData.gauges.ef]?.h;
        if (efMissing) {
            // EF is optional cross-check only — predictions fall back to PoR-only (makeGFPrediction handles this)
            console.warn('⚠️ EF stage unavailable — predictions will use PoR-only (no ensemble blending)');
        }

        // Only PoR/LF ice suspends learning; EF absence is non-blocking
        const criticalIce = porIce || lfIce;

        if (criticalIce) {
            console.log(`🧊 Critical gauge ice — skipping learning & validation (PoR ice: ${!!porIce}, LF ice: ${!!lfIce})`);
        }

        // 4. Validate pending predictions (skip if critical gauges ice-affected)
        let validated = 0, cleaned = 0;
        // v37.15: pairs feed the LF-residual advisory (step 5c). `|| []` also covers the
        // function's bare-0 early returns (no LF / out-of-range / no pending) and the ice skip.
        let lfPairs = [];
        if (!criticalIce) {
            console.log('Checking pending predictions...');
            const validationResult = await validatePendingPredictions(client, usgsData, waterTempC);
            validated = validationResult.validated || 0;
            cleaned = validationResult.cleaned || 0;
            lfPairs = validationResult.pairs || [];
            console.log(`Validated ${validated} predictions, cleaned ${cleaned} stale`);
        }

        // 4b. Validate pending 48h forecast predictions (skip if critical gauges ice-affected)
        let forecastValidation = { validated: 0, cleaned: 0 };
        if (!criticalIce) {
            console.log('Checking pending forecast predictions...');
            try {
                forecastValidation = await validateForecastPredictions(client, usgsData);
                console.log(`Validated ${forecastValidation.validated || 0} forecast predictions`);
            } catch (e) {
                console.error('Forecast validation error (non-fatal):', e);
            }
        }

        // 5. Make new prediction (skip if critical gauges ice-affected)
        let prediction = null;
        if (!criticalIce) {
            console.log('Making new prediction...');
            const correctionBins = await loadCorrectionBins(client);
            prediction = makeGFPrediction(usgsData, fullHistory, waterTempC, correctionBins);
        }

        // 5b. EF divergence advisory state — EVERY cycle, prediction or not (v37.13, plan §1/F10):
        // with no prediction the window still trims and the state decays to inactive rather than
        // freezing active. Display-only honesty signal (v38 gate FAIL fallback); never feeds the
        // estimate or learning; non-fatal by construction.
        let divergenceState = null;
        try {
            const prevDivergence = await getObs(client, 'ef_divergence', 'state');
            divergenceState = updateEfDivergenceState(prevDivergence, {
                nowMs: Date.now(),
                efEstimateCFS: prediction?.efEstimateCFS ?? null,
                porEstimateCFS: prediction?.porEstimateCFS ?? null,
                efReadingMs: usgsData.data[usgsData.gauges.ef]?.hTime ?? null,
                waterTempC,
                lfCFS: usgsData.data[usgsData.gauges.lf]?.q ?? null
            });
            const { error: divErr } = await upsertObs(client, 'ef_divergence', 'state', divergenceState);
            if (divErr) console.warn('⚠️ EF divergence state write failed (non-fatal):', divErr.message);
            else if (divergenceState.active) console.log(`⚠️ EF divergence ADVISORY active: D̄=${divergenceState.dbar}`);

            // v37.14: on deactivation, emit the completed firing as an append-only episode row —
            // duty/flow-regime documentation (validation-history stamps only live 7 days).
            if (prevDivergence?.active && !divergenceState.active && prevDivergence.episode) {
                const ep = prevDivergence.episode;
                const { error: epErr } = await insertObs(client, 'ef_divergence_episode', `${Date.now()}`, {
                    ...ep,
                    endedAt: divergenceState.updatedAt,
                    meanDbar: ep.cycles > 0 ? Math.round((ep.sumDbar / ep.cycles) * 10000) / 10000 : null
                });
                if (epErr) console.warn('⚠️ EF divergence episode log failed (non-fatal):', epErr.message);
                else console.log(`📒 EF divergence episode logged: ${ep.cycles} cycles, peak D̄=${ep.peakDbar}, LF ${ep.minLF}–${ep.maxLF}`);
            }
        } catch (e) {
            console.warn('⚠️ EF divergence state update threw (non-fatal):', e?.message || e);
        }

        // 5c. LF-residual advisory state — EVERY cycle, prediction or not (v37.15, plan §1):
        // the model's own validated scorecard; catches below-EF ungauged inflow the EF
        // detector is structurally blind to. Display-only honesty signal; never feeds the
        // estimate or learning; non-fatal by construction (the helper never throws).
        const lfResidualState = await updateLfResidualAdvisory(client, {
            runStartMs,
            pairs: lfPairs,
            lfCFS: usgsData.data[usgsData.gauges.lf]?.q ?? null
        });

        if (!criticalIce) {
            if (prediction) {
                // Stamp the advisory state onto the prediction (flows into the pending row and,
                // at validation, into the validation-history / validation_failure entries).
                if (divergenceState) {
                    prediction.efDivergence = divergenceState.dbar;
                    prediction.divergenceActive = divergenceState.active;
                }
                if (lfResidualState) {
                    prediction.lfResidualActive = lfResidualState.active;
                    prediction.lfResidualLastErrPct = lfResidualState.lastErrPct;
                }
                // Run server-side shadow models and attach before storing.
                // Shadows are RAW-model variants — seed them off the raw final (rawFinalCFS), NOT the
                // corrected predictedCFS, so their operating point is unchanged by the v36.0 cutover.
                try {
                    const shadowState = await loadShadowModelState(client);
                    const porRiseRate = getPoRRiseRateFromHistory(fullHistory);
                    const shadowResults = runServerShadowModels(
                        prediction.rawFinalCFS, usgsData, prediction, porRiseRate, shadowState
                    );
                    prediction.shadowModels = shadowResults;
                    await saveShadowModelState(client, shadowState);
                    console.log(`🏇 Server shadow: LF=${shadowResults.lfFeedback}, Reg=${shadowResults.onlineRegression}, Kal=${shadowResults.kalman}`);
                } catch (e) {
                    console.warn('Shadow model execution failed (non-fatal):', e.message);
                }

                await storePrediction(client, prediction);
                console.log(`📊 New prediction: ${prediction.predictedCFS} cfs (${prediction.flowBin}, ${prediction.flowState})`);

                // Store GF estimate in rolling 24h history for graph display
                // This ensures the history line is continuous even when no browser is open
                await storeGFHistory(client, prediction);
            }
        }

        // 6. Update run health (every run, regardless of prediction/ice outcome)
        await updateRunHealth(client);

        // 7. Log summary
        const summary = {
            timestamp: new Date().toISOString(),
            porCFS: usgsData.data[usgsData.gauges.por]?.q,
            lfCFS: usgsData.data[usgsData.gauges.lf]?.q,
            efStage: usgsData.data[usgsData.gauges.ef]?.h,
            waterTempC: waterTempC,                        // Water temp for EF model
            efModelType: prediction?.efModelType || null,  // 'cold' or 'default'
            iceAffected: criticalIce ? { por: !!porIce, lf: !!lfIce, efMissing } : false,
            learningSuspended: criticalIce,
            porHistoryCount: fullHistory.length,
            predictionsValidated: validated,
            predictionsCleaned: cleaned,
            forecastsValidated: forecastValidation.validated || 0,
            forecastsCleaned: forecastValidation.cleaned || 0,
            newPrediction: prediction ? {
                cfs: prediction.predictedCFS,
                flowBin: prediction.flowBin,
                flowState: prediction.flowState,
                validationDue: prediction.validationDue
            } : null
        };

        console.log('=== Scheduled Update Complete ===');
        console.log(JSON.stringify(summary, null, 2));

        // Heartbeat ping — tells healthchecks.io "cron ran successfully"
        if (process.env.HEALTHCHECKS_PING_URL) {
            try {
                await fetch(process.env.HEALTHCHECKS_PING_URL, {
                    signal: AbortSignal.timeout(5000)
                });
            } catch (pingErr) {
                console.warn('Healthchecks ping failed (non-fatal):', pingErr.message);
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify(summary)
        };

    } catch (e) {
        console.error('Scheduled update error:', e);

        // Heartbeat failure ping — tells healthchecks.io "cron errored"
        if (process.env.HEALTHCHECKS_PING_URL) {
            try {
                await fetch(process.env.HEALTHCHECKS_PING_URL + '/fail', {
                    signal: AbortSignal.timeout(5000)
                });
            } catch (pingErr) {
                console.warn('Healthchecks fail-ping failed (non-fatal):', pingErr.message);
            }
        }

        return {
            statusCode: 500,
            body: JSON.stringify({ error: e.message })
        };
    }
};

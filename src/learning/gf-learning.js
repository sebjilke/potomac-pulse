// Potomac Pulse — Great Falls learning system (System 2)
// Server-side prediction storage, validation, and correction bins
// Extracted from index.html inline script

import {
    SYNC_API,
    GF_OUTLIER_THRESHOLD, FORECAST_PREDICTION_INTERVAL,
    FORECAST_HORIZONS
} from '../model/constants.js';

import {
    gfLearningData, setGfLearningData,
    gfDataReady, setGfDataReady,
    edwardsFerryData,
    lastForecastPredictionTime, setLastForecastPredictionTime,
    forecastAccuracyData, setForecastAccuracyData,
    setShadowLeaderboard, setLearningInFlight
} from '../state/store.js';

import { getEdwardsFerryTrend } from '../estimation/edwards-ferry.js';
import { isCriticalGaugeIceAffected } from '../estimation/great-falls.js';
import { emit } from '../state/event-bus.js';

// ==================== GF LEARNING DATA ====================

// v39.7: the learning call has a deadline. 10 s matches the 10 s timeout of the main USGS call, so the card
// and the numbers settle in the same window; the server normally answers in well under 2 s. A shorter
// deadline would turn a slow but working answer into an uncorrected number on the card.
const LEARNING_DEADLINE_MS = 10000;

/**
 * Fetches JSON with one deadline that covers headers AND body. It races a timer instead of relying only on
 * the abort, so a stalled body (or a fetch that ignores the abort) still ends at the deadline.
 * @param {string} url
 * @param {number} ms
 * @returns {Promise<{ok: boolean, status: number, body: *}>}
 */
function fetchJsonWithDeadline(url, ms) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`Request timed out after ${ms}ms`));
        }, ms);
    });
    const work = (async () => {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return { ok: false, status: response.status, body: null };
        return { ok: true, status: response.status, body: await response.json() };
    })();
    work.catch(() => {}); // the race may already be lost; do not leave an unhandled rejection
    return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

let loadGen = 0;      // each request takes a number; only the newest may write to the store (admin reset)
let inFlight = null;  // the shared request, so two callers make one call

/**
 * Fetches GF (System 2) learning data from the sync API, populating the store with
 * correction bins, EF correlation, and shadow leaderboard; falls back to an empty
 * structure on failure and marks GF data as ready. v39.7: 10 s deadline, one shared request
 * for concurrent callers, and a 'learning:loaded' event when it settles. Never rejects.
 * @param {{force?: boolean}} [opts] - force: skip sharing and start a new request (admin reset).
 * @returns {Promise<void>}
 */
export function loadGFLearningData({ force = false } = {}) {
    if (inFlight && !force) return inFlight;
    const my = ++loadGen;
    const p = (async () => {
        try {
            await doLoadGFLearning(my);
        } catch (e) {
            console.warn('GF learning load error:', e);
        } finally {
            if (inFlight === p) { inFlight = null; setLearningInFlight(null); }
        }
    })();
    inFlight = p;
    setLearningInFlight(p);
    return p;
}

async function doLoadGFLearning(my) {
    // Default empty structure
    const emptyData = {
        correctionBins: {},
        pendingPredictions: [],
        metadata: { totalValidations: 0, totalPredictions: 0, avgErrorPercent: null },
        efCorrelation: null
    };
    const current = () => my === loadGen; // a newer request (admin reset) owns the store

    try {
        const response = await fetchJsonWithDeadline(SYNC_API + '?endpoint=gf', LEARNING_DEADLINE_MS);
        if (response.ok) {
            if (current()) {
                setGfLearningData(response.body);
                console.log('🌊 GF learning data loaded:', gfLearningData.metadata);

                // Store EF correlation for use in estimation
                if (gfLearningData.efCorrelation?.slope) {
                    edwardsFerryData.correlation = gfLearningData.efCorrelation;
                    console.log(`📍 EF correlation loaded: CFS = ${gfLearningData.efCorrelation.slope.toFixed(0)} × stage + ${gfLearningData.efCorrelation.intercept.toFixed(0)}`);
                }

                // Store shadow leaderboard for UI rendering
                if (gfLearningData.shadowLeaderboard) {
                    setShadowLeaderboard(gfLearningData.shadowLeaderboard);
                    console.log(`🏇 Shadow leaderboard loaded: ${gfLearningData.shadowLeaderboard.totalRounds} rounds`);
                }
            }
        } else {
            console.warn('GF learning API returned:', response.status);
            // v37.13: keep the last good payload on refresh failure — this loader now runs on
            // the 15-min cycle, and wiping to emptyData would drop the live correction bins
            // (and thus the displayed estimate's correction) for a whole cycle on one flaky
            // response. emptyData is only the cold-start fallback.
            if (current() && !gfLearningData) setGfLearningData(emptyData);
        }
    } catch (e) {
        // Network error, bad JSON, or the deadline: same as before the deadline existed.
        console.warn('Failed to load GF learning data:', e);
        if (current() && !gfLearningData) setGfLearningData(emptyData);
    }

    if (!current()) return;
    // Mark GF data as ready (UI will update when USGS data arrives)
    setGfDataReady(true);
    // A handler error must never turn a good load (or an admin reset) into a failure.
    try { emit('learning:loaded'); } catch (e) { console.warn('learning:loaded handler failed:', e); }
}

// ==================== PREDICTION STORAGE ====================
// v36.0 (C1): client-side GF-prediction writing REMOVED. The hourly cron (scheduled-update.js) is
// now the SOLE writer of GF predictions — it computes the raw + corrected estimate, stores both,
// and learns on the raw residual. This eliminates the client/cron contamination race into the single
// `pending` slot (finishing C12) and yields one clean raw-based learning stream. The client only
// READS learning data (loadGFLearningData above) and applies the correction for display
// (great-falls.js via the shared applyGFCorrection helper). Forecast predictions are unaffected.

// ==================== FORECAST PREDICTIONS ====================

// Store 48h forecast predictions for accuracy tracking
/**
 * Posts the current display-horizon NWS-based forecast periods to the sync API for later
 * accuracy validation, skipping when critical gauges are ice-affected, when throttled within
 * the forecast prediction interval, or when no NWS-based forecasts qualify.
 * @param {Array<Object>} periods - Forecast period objects (each with label, time, cfs, stage, source, isCurrent, isDisplayPeriod, and optional baseline CFS fields).
 * @returns {Promise<void>}
 */
export async function storeForecastPredictions(periods) {
    // Don't store forecasts when critical gauges are ice-affected
    if (isCriticalGaugeIceAffected()) {
        console.log('🧊 Forecast storage skipped: critical gauge ice-affected');
        return;
    }

    const now = Date.now();

    // Throttle: only store every 2 hours
    if (now - lastForecastPredictionTime < FORECAST_PREDICTION_INTERVAL) return;

    // Filter to only display horizons (6, 12, 24, 48h) and NWS-based forecasts
    const forecastsToStore = periods.filter(p =>
        !p.isCurrent &&
        p.isDisplayPeriod &&
        p.source &&
        p.source.startsWith('NWS')
    );

    if (forecastsToStore.length === 0) {
        console.log('📈 Forecast storage skipped: no NWS-based forecasts');
        return;
    }

    try {
        const response = await fetch(SYNC_API + '?endpoint=gf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'storeForecastPredictions',
                forecasts: forecastsToStore.map(p => ({
                    horizon: parseInt(p.label.replace('+', '').replace('h', '')),
                    targetTime: p.time.toISOString(),
                    predictedCFS: p.cfs,
                    predictedStage: p.stage,
                    source: p.source,
                    createdAt: new Date().toISOString(),
                    // v37.16: tells the server whether this value carries the GF→LF travel offset.
                    // true → validate at targetTime + travel; false (PoR fallback) → at targetTime.
                    travelApplied: p.travelApplied === true,
                    // Persistence baseline (observed LF). The two NWS baselines were retired in
                    // v37.16 — on the model's own clock they are the model plus a constant.
                    persistenceCFS: p.persistenceCFS || null
                }))
            })
        });

        if (response.ok) {
            setLastForecastPredictionTime(now);
            console.log(`📈 Stored ${forecastsToStore.length} forecast predictions for accuracy tracking`);
        }
    } catch (e) {
        console.warn('Failed to store forecast predictions:', e);
    }
}

// ==================== FORECAST ACCURACY ====================

// Load forecast accuracy data from server
/**
 * Fetches forecast accuracy data from the sync API into the store and emits a
 * 'forecast-accuracy:updated' event on success.
 * @returns {Promise<void>}
 */
export async function loadForecastAccuracy() {
    try {
        const response = await fetch(SYNC_API + '?endpoint=forecast-accuracy');
        if (response.ok) {
            setForecastAccuracyData(await response.json());
            emit('forecast-accuracy:updated');
        }
    } catch (e) {
        console.warn('Failed to load forecast accuracy:', e);
    }
}

// ==================== ADMIN RESET ====================

// Reset GF learning data (System 2) on server
/**
 * Prompts for confirmation and an admin PIN, then resets all server-side GF flow-bin
 * corrections (System 2) via the sync-learning endpoint, reloading learning data and
 * emitting 'learning:reset' on success.
 * @returns {Promise<void>}
 */
export async function resetGFLearning() {
    if (!confirm("Reset all GF flow-bin corrections?\n\nThis clears System 2 (server-side) learning.\nGauge corrections (System 1) will be preserved.\n\nThis cannot be undone.")) return;
    const pin = prompt("Enter admin PIN to confirm reset:");
    if (!pin) return;

    try {
        const response = await fetch('/.netlify/functions/sync-learning?endpoint=gf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'resetGFLearning', pin })
        });

        const result = await response.json();
        if (result.success) {
            alert("GF learning data reset.\n\nFlow-bin corrections cleared.\nNew observations will start accumulating with proper flow state classification.");
            // Reload GF learning data
            await loadGFLearningData({ force: true });
            emit('learning:reset');
        } else {
            alert("Reset failed: " + (result.error || 'Unknown error'));
        }
    } catch (e) {
        console.error('Reset error:', e);
        alert("Reset failed: " + e.message);
    }
}


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
    setShadowLeaderboard
} from '../state/store.js';

import { getEdwardsFerryTrend } from '../estimation/edwards-ferry.js';
import { isCriticalGaugeIceAffected } from '../estimation/great-falls.js';
import { emit } from '../state/event-bus.js';

// ==================== GF LEARNING DATA ====================

/**
 * Fetches GF (System 2) learning data from the sync API, populating the store with
 * correction bins, EF correlation, and shadow leaderboard; falls back to an empty
 * structure on failure and marks GF data as ready.
 * @returns {Promise<void>}
 */
export async function loadGFLearningData() {
    // Default empty structure
    const emptyData = {
        correctionBins: {},
        pendingPredictions: [],
        metadata: { totalValidations: 0, totalPredictions: 0, avgErrorPercent: null },
        efCorrelation: null
    };

    try {
        const response = await fetch(SYNC_API + '?endpoint=gf');
        if (response.ok) {
            setGfLearningData(await response.json());
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
        } else {
            console.warn('GF learning API returned:', response.status);
            setGfLearningData(emptyData);
        }
    } catch (e) {
        console.warn('Failed to load GF learning data:', e);
        setGfLearningData(emptyData);
    }

    // Mark GF data as ready (UI will update when USGS data arrives)
    setGfDataReady(true);
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
                    // Baselines for accuracy comparison
                    nwsLfRawCFS: p.nwsLfRawCFS || null,
                    nwsLfBiasCorrectedCFS: p.nwsLfBiasCorrectedCFS || null,
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
            await loadGFLearningData();
            emit('learning:reset');
        } else {
            alert("Reset failed: " + (result.error || 'Unknown error'));
        }
    } catch (e) {
        console.error('Reset error:', e);
        alert("Reset failed: " + e.message);
    }
}

// Reset only low-flow bins (ice cleanup, v24)
/**
 * Prompts for confirmation and an admin PIN, then resets only the low-flow correction bins
 * (0-3k and 3k-6k cfs) plus accuracy stats via the sync-learning endpoint, reloading
 * learning data and emitting 'learning:reset' on success.
 * @returns {Promise<void>}
 */
export async function resetLowFlowBins() {
    if (!confirm("Reset low-flow bins AND accuracy stats?\n\nThis clears:\n• 0-3k and 3k-6k cfs correction bins\n• Validation count and accuracy %\n\nHigher flow bins (6k+) preserved.\nAccuracy will rebuild from fresh validations.\n\nUse this after winter ice conditions.")) return;
    const pin = prompt("Enter admin PIN to confirm reset:");
    if (!pin) return;

    try {
        const response = await fetch('/.netlify/functions/sync-learning?endpoint=gf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'resetLowFlowBins', pin })
        });

        const result = await response.json();
        if (result.success) {
            alert(`Ice cleanup complete!\n\nCleared:\n• ${result.deletedCount} low-flow bins (0-3k, 3k-6k cfs)\n• Validation count and accuracy metrics\n\nHigher flow bins preserved.\nAccuracy will rebuild from fresh validations.\n\nv24 anomaly detection will prevent future contamination.`);
            // Reload GF learning data
            await loadGFLearningData();
            emit('learning:reset');
        } else {
            alert("Reset failed: " + (result.error || 'Unknown error'));
        }
    } catch (e) {
        console.error('Reset error:', e);
        alert("Reset failed: " + e.message);
    }
}

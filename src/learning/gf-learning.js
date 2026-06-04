// Potomac Pulse — Great Falls learning system (System 2)
// Server-side prediction storage, validation, and correction bins
// Extracted from index.html inline script

import {
    SYNC_API, EMPIRICAL_CI_90,
    GF_PREDICTION_INTERVAL, GF_MIN_VALIDATION_TIME,
    GF_OUTLIER_THRESHOLD, FORECAST_PREDICTION_INTERVAL,
    FORECAST_HORIZONS
} from '../model/constants.js';

import {
    gfLearningData, setGfLearningData,
    gfDataReady, setGfDataReady,
    edwardsFerryData,
    lastGFPredictionTime, setLastGFPredictionTime,
    gfPredictionRetryQueue,
    lastForecastPredictionTime, setLastForecastPredictionTime,
    forecastAccuracyData, setForecastAccuracyData,
    setShadowLeaderboard
} from '../state/store.js';

import { getEdwardsFerryTrend } from '../estimation/edwards-ferry.js';
import { isCriticalGaugeIceAffected, getGFCorrection, getGFUncertainty, isGFOutlier } from '../estimation/great-falls.js';

// Forward declarations — resolved at runtime to avoid circular deps
let _updateGFLearningUI = null;
let _updateGFBinStats = null;
let _updateForecastAccuracyUI = null;

export function setUpdateGFLearningUI(fn) { _updateGFLearningUI = fn; }
export function setUpdateGFBinStats(fn) { _updateGFBinStats = fn; }
export function setUpdateForecastAccuracyUI(fn) { _updateForecastAccuracyUI = fn; }

// ==================== GF LEARNING DATA ====================

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

// Store a GF prediction for later validation
export async function storeGFPrediction(estimate) {
    // Don't store predictions when critical gauges are ice-affected
    if (isCriticalGaugeIceAffected()) {
        console.log('🧊 Prediction storage skipped: critical gauge ice-affected');
        return;
    }

    const now = Date.now();

    // Throttle: only store every 30 minutes
    if (now - lastGFPredictionTime < GF_PREDICTION_INTERVAL) {
        // Process retry queue if any
        processGFRetryQueue();
        return;
    }

    if (!estimate?.cfs) return;

    // Use flow bin from estimate (based on estimated GF flow)
    const flowBin = estimate.inputs.flowBin;

    // Ensure minimum validation time (prevents validating same water parcel)
    const minValidationHours = GF_MIN_VALIDATION_TIME / (60 * 60 * 1000);
    const actualValidationHours = Math.max(estimate.validationCountdown, minValidationHours);
    const validationDue = new Date(now + actualValidationHours * 60 * 60 * 1000).toISOString();

    // Include Edwards Ferry stage and trend for correlation learning
    const efStage = edwardsFerryData.current?.stage || null;
    const efTrend = getEdwardsFerryTrend();

    const predictionData = {
        timestamp: new Date().toISOString(),
        predictedCFS: estimate.cfs,
        porCFS: estimate.inputs.historicPorCFS || estimate.inputs.porCFS,
        monocacyCFS: estimate.inputs.monocacyCFS,
        gooseCFS: estimate.inputs.gooseCFS,
        flowBin: flowBin,
        flowState: estimate.flowState,
        travelTimeGFtoLF: actualValidationHours,
        validationDue: validationDue,
        efStage: efStage,  // Edwards Ferry stage at prediction time
        efTrend: efTrend   // Edwards Ferry trend (rising/falling/steady) for hysteresis learning
    };

    const success = await sendGFPrediction(predictionData);

    if (success) {
        setLastGFPredictionTime(now);  // Only advance timer on success
        console.log('🌊 GF prediction stored for validation');
    } else {
        // Add to retry queue (max 5 retries)
        if (gfPredictionRetryQueue.length < 5) {
            gfPredictionRetryQueue.push({ data: predictionData, retries: 0 });
            console.warn('🌊 GF prediction queued for retry');
        }
    }
}

// Send prediction to server (returns success boolean)
export async function sendGFPrediction(predictionData) {
    try {
        const response = await fetch(SYNC_API + '?endpoint=gf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'storePrediction',
                prediction: predictionData
            })
        });
        return response.ok;
    } catch (e) {
        console.warn('Failed to store GF prediction:', e);
        return false;
    }
}

// Process retry queue for failed predictions
export async function processGFRetryQueue() {
    if (gfPredictionRetryQueue.length === 0) return;

    const item = gfPredictionRetryQueue[0];
    const success = await sendGFPrediction(item.data);

    if (success) {
        gfPredictionRetryQueue.shift();  // Remove from queue
        console.log('🌊 GF prediction retry succeeded');
    } else {
        item.retries++;
        if (item.retries >= 3) {
            gfPredictionRetryQueue.shift();  // Give up after 3 retries
            console.warn('🌊 GF prediction retry failed, giving up');
        }
    }
}

// ==================== FORECAST PREDICTIONS ====================

// Store 48h forecast predictions for accuracy tracking
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
export async function loadForecastAccuracy() {
    try {
        const response = await fetch(SYNC_API + '?endpoint=forecast-accuracy');
        if (response.ok) {
            setForecastAccuracyData(await response.json());
            if (_updateForecastAccuracyUI) _updateForecastAccuracyUI();
        }
    } catch (e) {
        console.warn('Failed to load forecast accuracy:', e);
    }
}

// ==================== ADMIN RESET ====================

// Reset GF learning data (System 2) on server
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
            if (_updateGFLearningUI) _updateGFLearningUI();
            if (_updateGFBinStats) _updateGFBinStats();
        } else {
            alert("Reset failed: " + (result.error || 'Unknown error'));
        }
    } catch (e) {
        console.error('Reset error:', e);
        alert("Reset failed: " + e.message);
    }
}

// Reset only low-flow bins (ice cleanup, v24)
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
            if (_updateGFLearningUI) _updateGFLearningUI();
            if (_updateGFBinStats) _updateGFBinStats();
        } else {
            alert("Reset failed: " + (result.error || 'Unknown error'));
        }
    } catch (e) {
        console.error('Reset error:', e);
        alert("Reset failed: " + e.message);
    }
}

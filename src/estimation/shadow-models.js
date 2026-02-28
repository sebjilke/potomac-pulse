// Potomac Pulse — Shadow model horse race (developmental)
// Three alternative GF estimation approaches running alongside production.
// Display-only in Learning tab — never affects production estimate.
// Extracted from index.html inline script

import { LF, SHADOW_STATE_KEY } from '../model/constants.js';
import { estimateLFStage } from '../model/shared-model.js';
import {
    data, shadowModelState, setShadowModelState,
    shadowResults, setShadowResults
} from '../state/store.js';
import { getPoRRiseRate } from '../estimation/great-falls.js';
import { estimateGFFromEdwardsFerry } from '../estimation/edwards-ferry.js';

// --- Shadow Model 1: LF Feedback ---
// Tracks recent GF→LF discrepancy with fast EMA (α=0.4).
// If our GF estimate leads to LF overshoot/undershoot, apply correction.
export function shadowEstimateLFFeedback(productionCFS) {
    if (!productionCFS || productionCFS <= 0) return null;
    const lf = data[LF.id];
    if (!lf?.q) return null;

    const state = shadowModelState.lfFeedback;
    const lfActualCFS = lf.q;

    // Step 1: If we have a pending prediction, validate it against current LF
    if (state.lastPredictedLF !== null && state.lastPredictionTime !== null) {
        const hoursSincePrediction = (Date.now() - state.lastPredictionTime) / 3600000;
        // GF→LF travel time is ~6.5h at median flow. Check if enough time has passed.
        // Use a window: if 4-12h have passed, this LF reading is influenced by our past GF prediction.
        if (hoursSincePrediction >= 4 && hoursSincePrediction <= 12) {
            // Discrepancy: (actual - predicted) / predicted
            const discrepancy = (lfActualCFS - state.lastPredictedLF) / state.lastPredictedLF;
            // Clamp to ±30% to prevent outlier corruption
            const clampedDisc = Math.max(-0.30, Math.min(0.30, discrepancy));
            // Update EMA correction
            state.correctionFactor = state.alpha * clampedDisc + (1 - state.alpha) * state.correctionFactor;
            // Clear the pending prediction (consumed)
            state.lastPredictedLF = null;
            state.lastPredictionTime = null;
            console.log(`🏇 LF Feedback: discrepancy=${(clampedDisc*100).toFixed(1)}%, correction=${(state.correctionFactor*100).toFixed(1)}%`);
        }
    }

    // Step 2: Apply correction to production estimate
    const correctedCFS = Math.round(productionCFS * (1 + state.correctionFactor));

    // Step 3: Store this prediction for future validation
    // Our GF estimate will flow down to LF in ~6.5 hours
    if (state.lastPredictedLF === null) {
        state.lastPredictedLF = correctedCFS;
        state.lastPredictionTime = Date.now();
    }

    if (correctedCFS <= 0) return null;
    return { cfs: correctedCFS, stage: estimateLFStage(correctedCFS) };
}

// --- Shadow Model 2: Online Regression (Browser-Friendly ML) ---
// Multi-feature weighted regression with online SGD.
// Features: [bias, PoR, PoR_rateOfChange, EF_estimate, tributary_sum, LF_actual, sin(hour), cos(hour), recent_error]
// Initialized to approximate production model; weights learned via gradient descent.
export function shadowEstimateOnlineRegression(productionCFS) {
    if (!productionCFS || productionCFS <= 0) return null;
    const lf = data[LF.id];
    if (!lf?.q) return null;
    const por = data["01638500"];
    if (!por?.q) return null;

    const state = shadowModelState.onlineRegression;

    // Initialize weights to approximate production model on first run
    if (!state.weights) {
        state.weights = new Array(state.nFeatures).fill(0);
        // bias=0, PoR weight=1.0 (primary input), rest=0 → starts ≈ PoR value
        state.weights[0] = 0;      // bias
        state.weights[1] = 1.0;    // PoR CFS (dominant feature)
        state.weights[2] = 0;      // PoR rate of change
        state.weights[3] = 0;      // EF estimate (will learn)
        state.weights[4] = 0;      // tributary sum (will learn)
        state.weights[5] = 0;      // LF actual (will learn)
        state.weights[6] = 0;      // sin(hour)
        state.weights[7] = 0;      // cos(hour)
        state.weights[8] = 0;      // recent error signal
    }

    // Build feature vector (all normalized to ~0-1 scale)
    const porCFS = por.q;
    const riseRate = getPoRRiseRate();
    const porROC = riseRate ? riseRate.ratePerHour / 10 : 0;  // Normalize: 10%/hr → 1.0
    const efEst = estimateGFFromEdwardsFerry();
    const efCFS = efEst ? efEst.cfs / 10000 : 0;  // Normalize: 10k cfs → 1.0
    const monocacy = data["01643000"];
    const goose = data["01644000"];
    const broadRun = data["01644280"];
    const seneca = data["01645000"];
    const tribSum = ((monocacy?.q || 0) + (goose?.q || 0) + (broadRun?.q || 0) + (seneca?.q || 0)) / 1000;  // Normalize: 1k → 1.0
    const lfCFS = lf.q / 10000;  // Normalize
    const hour = new Date().getHours() + new Date().getMinutes() / 60;
    const sinHr = Math.sin(2 * Math.PI * hour / 24);
    const cosHr = Math.cos(2 * Math.PI * hour / 24);
    const recentError = (productionCFS - lf.q) / Math.max(1, lf.q);  // Production's error vs LF

    const features = [
        1,                     // bias
        porCFS / 10000,        // PoR (normalized)
        porROC,                // PoR rate of change
        efCFS,                 // EF estimate
        tribSum,               // tributary sum
        lfCFS,                 // LF actual
        sinHr,                 // sin(hour)
        cosHr,                 // cos(hour)
        recentError            // recent error signal
    ];

    // Forward pass: weighted sum
    let prediction = 0;
    for (let i = 0; i < state.nFeatures; i++) {
        prediction += state.weights[i] * features[i];
    }
    // Scale back to CFS (prediction is in 10k-normalized space via PoR weight)
    prediction *= 10000;

    // SGD update: use LF actual as target (delayed signal — GF ≈ LF within travel time)
    // Only update after warm-up period (10 cycles) and with throttle
    const target = lf.q / 10000;  // Normalized target
    const predNorm = prediction / 10000;
    const error = target - predNorm;

    // Gradient step (only if we have meaningful data)
    if (Math.abs(error) > 0.001) {
        const lr = state.learningRate / (1 + state.trainCount * 0.0001);  // Decay learning rate
        for (let i = 0; i < state.nFeatures; i++) {
            state.weights[i] += lr * error * features[i];
        }
        state.trainCount++;
    }

    const resultCFS = Math.round(Math.max(0, prediction));
    if (resultCFS <= 0) return null;
    return { cfs: resultCFS, stage: estimateLFStage(resultCFS) };
}

// --- Shadow Model 3: Kalman Filter ---
// State: GF flow (CFS). Predict step: propagate using production model delta.
// Update step: sequentially assimilate LF (R=2%), PoR time-shifted (R=5%), EF power-law (R=10%).
// Process noise scales with flow state (4× on rising).
export function shadowEstimateKalman(productionCFS) {
    if (!productionCFS || productionCFS <= 0) return null;
    const lf = data[LF.id];
    if (!lf?.q) return null;

    const state = shadowModelState.kalman;

    // Initialize on first run
    if (!state.initialized) {
        state.x = productionCFS;  // Initial state = production estimate
        state.P = (productionCFS * 0.10) ** 2;  // Initial covariance: ±10%
        state.initialized = true;
        console.log(`🏇 Kalman: initialized at ${productionCFS} cfs, P=${state.P.toFixed(0)}`);
    }

    // === PREDICT STEP ===
    // Use the delta from production model as our process model
    // State transition: x_new = x_old + (production_delta)
    // We don't have previous production, so use: x_predict = production (track production closely)
    // But add process noise to allow observations to pull us away
    const x_prior = state.x;
    const innovation = productionCFS - x_prior;
    // Blend: 70% follow production delta, 30% hold position (inertia)
    const x_predict = x_prior + 0.7 * innovation;

    // Process noise scales with flow state
    const riseRate = getPoRRiseRate();
    const isRising = riseRate && riseRate.flowState === 'rising';
    const Q_mult = isRising ? 4.0 : 1.0;
    const Q = state.Q_base * (x_predict ** 2) * Q_mult;  // Proportional to state²
    let P_predict = state.P + Q;

    // === UPDATE STEP: Sequential assimilation ===
    let x_updated = x_predict;
    let P_updated = P_predict;

    // Observation 1: LF actual (R = 2% of LF² — LF is the most reliable gauge)
    // GF ≈ LF (they're close, ~10 river miles apart)
    const lfCFS = lf.q;
    const R_lf = (lfCFS * 0.02) ** 2;
    let K = P_updated / (P_updated + R_lf);  // Kalman gain
    x_updated = x_updated + K * (lfCFS - x_updated);
    P_updated = (1 - K) * P_updated;

    // Observation 2: PoR time-shifted (R = 5% — more uncertainty due to travel time)
    const por = data["01638500"];
    if (por?.q) {
        const porCFS = por.q;
        // PoR accounts for ~83.5% of LF, scale up
        const porEstimate = porCFS / 0.835;
        const R_por = (porEstimate * 0.05) ** 2;
        K = P_updated / (P_updated + R_por);
        x_updated = x_updated + K * (porEstimate - x_updated);
        P_updated = (1 - K) * P_updated;
    }

    // Observation 3: EF power-law estimate (R = 10% — high variance at low flows)
    const efEst = estimateGFFromEdwardsFerry();
    if (efEst && efEst.cfs > 0) {
        const R_ef = (efEst.cfs * 0.10) ** 2;
        K = P_updated / (P_updated + R_ef);
        x_updated = x_updated + K * (efEst.cfs - x_updated);
        P_updated = (1 - K) * P_updated;
    }

    // Store updated state
    state.x = x_updated;
    state.P = P_updated;

    const resultCFS = Math.round(Math.max(0, x_updated));
    if (resultCFS <= 0) return null;
    return { cfs: resultCFS, stage: estimateLFStage(resultCFS) };
}

// --- Shadow Model State Management ---
export function loadShadowModelState() {
    try {
        const stored = localStorage.getItem(SHADOW_STATE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Merge with defaults (in case new fields were added)
            if (parsed.lfFeedback) {
                Object.assign(shadowModelState.lfFeedback, parsed.lfFeedback);
            }
            if (parsed.onlineRegression) {
                Object.assign(shadowModelState.onlineRegression, parsed.onlineRegression);
            }
            if (parsed.kalman) {
                Object.assign(shadowModelState.kalman, parsed.kalman);
            }
            console.log('🏇 Shadow model state loaded from localStorage');
        }
    } catch (e) {
        console.warn('Failed to load shadow model state:', e);
    }
}

export function saveShadowModelState() {
    try {
        localStorage.setItem(SHADOW_STATE_KEY, JSON.stringify(shadowModelState));
    } catch (e) {
        console.warn('Failed to save shadow model state:', e);
    }
}

// Run all shadow models and store results. Called after estimateGreatFalls().
// Wrapped in try/catch — shadow model failure must never affect production.
export function runShadowModels(productionEstimate) {
    if (!productionEstimate?.cfs) return;
    const prodCFS = productionEstimate.cfs;

    try {
        const t0 = performance.now();

        // Model 1: LF Feedback
        try {
            const result = shadowEstimateLFFeedback(prodCFS);
            shadowResults.lfFeedback.cfs = result?.cfs || null;
            shadowResults.lfFeedback.stage = result?.stage || null;
        } catch (e) {
            console.warn('🏇 LF Feedback failed:', e);
            shadowResults.lfFeedback.cfs = null;
        }

        // Model 2: Online Regression
        try {
            const result = shadowEstimateOnlineRegression(prodCFS);
            shadowResults.onlineRegression.cfs = result?.cfs || null;
            shadowResults.onlineRegression.stage = result?.stage || null;
        } catch (e) {
            console.warn('🏇 Online Regression failed:', e);
            shadowResults.onlineRegression.cfs = null;
        }

        // Model 3: Kalman Filter
        try {
            const result = shadowEstimateKalman(prodCFS);
            shadowResults.kalman.cfs = result?.cfs || null;
            shadowResults.kalman.stage = result?.stage || null;
        } catch (e) {
            console.warn('🏇 Kalman failed:', e);
            shadowResults.kalman.cfs = null;
        }

        const elapsed = performance.now() - t0;
        console.log(`🏇 Shadow models: LF=${shadowResults.lfFeedback.cfs}, Reg=${shadowResults.onlineRegression.cfs}, Kal=${shadowResults.kalman.cfs} (${elapsed.toFixed(1)}ms)`);

        // Save state after each run
        saveShadowModelState();

    } catch (e) {
        console.error('🏇 Shadow models wrapper failed:', e);
    }
}

export function resetShadowModels() {
    if (!confirm('Reset all shadow models? Learned state (Kalman covariance, regression weights, LF feedback) will be lost.')) return;
    setShadowModelState({
        lfFeedback: { correctionFactor: 0, lastPredictedLF: null, lastPredictionTime: null, alpha: 0.4 },
        onlineRegression: { weights: null, learningRate: 0.001, nFeatures: 9, trainCount: 0 },
        kalman: { x: null, P: null, Q_base: 0.0001, initialized: false }
    });
    setShadowResults({
        lfFeedback: { cfs: null, stage: null, label: 'LF Feedback' },
        onlineRegression: { cfs: null, stage: null, label: 'Online Regression' },
        kalman: { cfs: null, stage: null, label: 'Kalman Filter' }
    });
    localStorage.removeItem(SHADOW_STATE_KEY);
    // updateShadowModelUI() will be called from the UI module
    console.log('🏇 Shadow models reset');
}

// Potomac Pulse — Edwards Ferry estimation and hysteresis
// Extracted from index.html inline script

import {
    EDWARDS_FERRY, EF_MODEL, EF_HISTORY_MAX
} from '../model/constants.js';

import {
    edwardsFerryData, waterTempC, setWaterTempC,
    efHysteresis
} from '../state/store.js';

import { fetchWithTimeout } from '../data/fetch.js';
import { isCriticalGaugeIceAffected } from '../estimation/great-falls.js';

// ==================== EDWARDS FERRY DATA FETCH ====================

// Fetch Edwards Ferry data (hidden gauge for GF validation)
// Stage-only gauge just above Great Falls
/**
 * Fetches the latest Edwards Ferry stage reading from USGS and appends it to the EF history buffer.
 * Mutates edwardsFerryData.current and edwardsFerryData.history; trims history to EF_HISTORY_MAX.
 * @returns {Promise<void>} Resolves when the fetch completes; silently returns on error or invalid data.
 */
export async function fetchEdwardsFerry() {
    const url = `https://waterservices.usgs.gov/nwis/iv/?sites=${EDWARDS_FERRY.id}&parameterCd=00065&period=P1D&format=json`;

    try {
        const r = await fetchWithTimeout(url, 5000);
        if (!r.ok) return;

        const json = await r.json();
        if (!json?.value?.timeSeries?.[0]?.values?.[0]?.value) return;

        const values = json.value.timeSeries[0].values[0].value;
        if (!values.length) return;

        // Get current reading
        const latest = values[values.length - 1];
        const stage = parseFloat(latest.value);
        const timestamp = new Date(latest.dateTime).getTime();

        if (stage > 0 && stage < 100) {
            edwardsFerryData.current = { stage, timestamp };

            // Add to history (avoid duplicates)
            const lastHistory = edwardsFerryData.history[edwardsFerryData.history.length - 1];
            if (!lastHistory || lastHistory.timestamp !== timestamp) {
                edwardsFerryData.history.push({ stage, timestamp });

                // Trim to max size
                if (edwardsFerryData.history.length > EF_HISTORY_MAX) {
                    edwardsFerryData.history = edwardsFerryData.history.slice(-EF_HISTORY_MAX);
                }
            }

            console.log(`📍 Edwards Ferry: ${stage.toFixed(2)} ft`);

            // EF data is now available; updateUI() will use it when called
            // (No early re-render — single render after all data arrives)
        }
    } catch(e) {
        console.warn('Edwards Ferry fetch failed:', e);
    }
}

// Fetch water temperature from Point of Rocks for EF model cold adjustment
// PoR is 15mi upstream of EF but on same mainstem, so temp is representative
/**
 * Fetches the latest Point of Rocks water temperature (°C) from USGS and stores it for EF model selection.
 * Calls setWaterTempC only when the reading passes the -5°C to 40°C sanity check; leaves waterTempC null on error.
 * @returns {Promise<void>} Resolves when the fetch completes; silently returns on error or invalid data.
 */
export async function fetchWaterTemp() {
    const url = 'https://waterservices.usgs.gov/nwis/iv/?sites=01638500&parameterCd=00010&period=P1D&format=json';
    try {
        const r = await fetchWithTimeout(url, 5000);
        if (!r.ok) return;

        const json = await r.json();
        if (!json?.value?.timeSeries?.[0]?.values?.[0]?.value?.length) return;

        const values = json.value.timeSeries[0].values[0].value;
        const latest = values[values.length - 1];
        const tempC = parseFloat(latest.value);

        if (tempC >= -5 && tempC <= 40) {  // Sanity check
            setWaterTempC(tempC);
            const isCold = tempC <= EF_MODEL.coldMaxTemp;
            console.log(`🌡️ Water temp: ${tempC.toFixed(1)}°C (${(tempC * 9/5 + 32).toFixed(0)}°F) — using ${isCold ? 'COLD' : 'default'} EF model`);
        }
    } catch(e) {
        console.warn('Water temp fetch failed:', e);
        // waterTempC remains null, will use default model
    }
}

// ==================== EDWARDS FERRY TREND & MODEL ====================

// Get Edwards Ferry trend (rising/falling/steady)
/**
 * Determines the Edwards Ferry stage trend by comparing the current reading to roughly one hour ago.
 * Uses a ±2% threshold on percent change between the latest stage and the reading ~5 samples back.
 * @returns {('rising'|'falling'|'steady'|null)} The trend, or null if fewer than 4 history readings exist.
 */
export function getEdwardsFerryTrend() {
    const history = edwardsFerryData.history;
    if (history.length < 4) return null;  // Need at least 1 hour of data

    // Compare current to 1 hour ago
    const current = history[history.length - 1].stage;
    const oneHourAgo = history[Math.max(0, history.length - 5)].stage;  // ~4-5 readings = 1 hour

    const change = current - oneHourAgo;
    const pctChange = (change / oneHourAgo) * 100;

    if (pctChange > 2) return 'rising';
    if (pctChange < -2) return 'falling';
    return 'steady';
}

// Estimate LF CFS directly from Edwards Ferry stage using power-law model
// Model: LF_cfs = coef × EF_stage^exp (coefficients depend on water temperature)
// Cold water (≤10°C): 160 × EF^2.36 (deduped fit, R²=0.98 on the cold-water subset)
// Default (>10°C or unknown): 126 × EF^2.46 (deduped fit, R²=0.91)
// Applies a FIXED prior hysteresis multiplier (frozen, client-only): rising limb carries more flow than falling at same stage
// Returns null if EF data missing or stage out of valid range
/**
 * Estimates Little Falls discharge (cfs) from the current Edwards Ferry stage via a temperature-dependent power-law,
 * then applies the fixed EF trend hysteresis multiplier.
 * @returns {{cfs: number, stage: number, model: string, modelType: ('cold'|'default'|'default-no-temp'), waterTempC: (number|null), coef: number, exp: number, rSquared: number, medianErrorPct: number, efTrend: ('rising'|'falling'|'steady'|null), hysteresisMultiplier: number, hysteresisCount: number}|null}
 *   Estimate object (cfs in cubic feet per second, stage in feet), or null if EF data is missing,
 *   stage is out of [minStage, maxStage], or the estimate falls outside 500–500000 cfs.
 */
export function estimateGFFromEdwardsFerry() {
    const ef = edwardsFerryData;
    if (!ef.current?.stage) return null;

    const stage = ef.current.stage;

    // Validate stage is in reasonable range
    if (stage < EF_MODEL.minStage || stage > EF_MODEL.maxStage) return null;

    // Select coefficients based on water temperature
    // Cold water has different hydraulic properties (higher viscosity)
    let coef, exp, modelType;
    if (waterTempC !== null && waterTempC <= EF_MODEL.coldMaxTemp) {
        coef = EF_MODEL.coldCoef;
        exp = EF_MODEL.coldExp;
        modelType = 'cold';
    } else {
        coef = EF_MODEL.coef;
        exp = EF_MODEL.exp;
        modelType = waterTempC !== null ? 'default' : 'default-no-temp';
    }

    // Power-law model: LF_cfs = coef × stage^exp
    let estimatedCFS = coef * Math.pow(stage, exp);

    // Apply the FIXED hysteresis multiplier based on EF trend (frozen, not learned).
    // Literature-informed priors (rising ×1.08 / falling ×0.92 / steady ×1.0); an EMA update
    // path exists but is unwired, so they stay frozen. Client-only. See tech-appendix §5.8.
    const efTrend = getEdwardsFerryTrend();
    const hysteresisData = efHysteresis[efTrend] || { multiplier: 1.0, count: 0 };
    const hysteresisMultiplier = hysteresisData.multiplier;
    estimatedCFS *= hysteresisMultiplier;

    // Sanity check - should be positive and reasonable
    if (estimatedCFS < 500 || estimatedCFS > 500000) return null;

    return {
        cfs: Math.round(estimatedCFS),
        stage: stage,
        model: 'power-law',
        modelType: modelType,         // 'cold', 'default', or 'default-no-temp'
        waterTempC: waterTempC,       // Water temp used for model selection
        coef: coef,                   // Coefficient used
        exp: exp,                     // Exponent used
        rSquared: EF_MODEL.rSquared,
        medianErrorPct: EF_MODEL.medianErrorPct,
        efTrend: efTrend,
        hysteresisMultiplier: hysteresisMultiplier,
        hysteresisCount: hysteresisData.count,  // How many observations informed this multiplier
    };
}

// ==================== HYSTERESIS LEARNING ====================

// Update EF hysteresis multiplier based on validation error
// Called when a GF prediction is validated against actual LF reading
/**
 * Updates the EF hysteresis multiplier for the given trend via an EMA (alpha=0.2) on the prediction error ratio.
 * No-ops for steady/missing trends or when a critical gauge is ice-affected; clamps the multiplier to [0.8, 1.2] and persists.
 * @param {('rising'|'falling'|'steady'|null)} efTrend - The EF trend at prediction time; only 'rising'/'falling' are learned.
 * @param {number} predictedCFS - The predicted Great Falls discharge in cfs.
 * @param {number} actualCFS - The actual observed Little Falls discharge in cfs.
 * @returns {void}
 */
export function updateEFHysteresis(efTrend, predictedCFS, actualCFS) {
    if (!efTrend || efTrend === 'steady') return;  // Only learn for rising/falling
    // Don't update hysteresis when critical gauges are ice-affected
    if (isCriticalGaugeIceAffected()) {
        console.log('🧊 EF hysteresis update skipped: critical gauge ice-affected');
        return;
    }

    const h = efHysteresis[efTrend];
    if (!h) return;

    // Calculate what multiplier would have been perfect
    // If predicted was 10% too high, we need to multiply by 0.91 next time
    const errorRatio = actualCFS / predictedCFS;

    // Use EMA to update multiplier (α=0.2 for gradual learning)
    const alpha = 0.2;
    h.multiplier = alpha * (h.multiplier * errorRatio) + (1 - alpha) * h.multiplier;

    // Clamp to reasonable range (0.8 to 1.2 = ±20% max correction)
    h.multiplier = Math.max(0.8, Math.min(1.2, h.multiplier));

    h.count += 1;
    h.sumError += Math.abs(predictedCFS - actualCFS);

    console.log(`📊 EF hysteresis update (${efTrend}): multiplier=${h.multiplier.toFixed(3)}, n=${h.count}`);

    // Persist to localStorage
    saveEFHysteresis();
}

// Save EF hysteresis to localStorage
/**
 * Persists the current efHysteresis state to localStorage under the 'potomac_ef_hysteresis' key.
 * @returns {void}
 */
export function saveEFHysteresis() {
    try {
        localStorage.setItem('potomac_ef_hysteresis', JSON.stringify(efHysteresis));
    } catch (e) {
        console.warn('Failed to save EF hysteresis:', e);
    }
}

// Load EF hysteresis from localStorage
/**
 * Loads saved EF hysteresis from localStorage and merges it into efHysteresis, preserving defaults for missing keys.
 * @returns {void}
 */
export function loadEFHysteresis() {
    try {
        const saved = localStorage.getItem('potomac_ef_hysteresis');
        if (saved) {
            const parsed = JSON.parse(saved);
            // Merge with defaults to handle missing keys
            for (const key of ['rising', 'falling', 'steady']) {
                if (parsed[key]) {
                    efHysteresis[key] = { ...efHysteresis[key], ...parsed[key] };
                }
            }
            console.log('📊 EF hysteresis loaded:', efHysteresis);
        }
    } catch (e) {
        console.warn('Failed to load EF hysteresis:', e);
    }
}

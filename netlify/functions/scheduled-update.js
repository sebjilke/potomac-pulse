// Potomac Pulse - Scheduled Background Update
// Runs every 2 hours to fetch data, store history, and validate predictions
// This allows the learning system to work even when no browsers are open

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;

function getSupabase() {
    if (!supabase && supabaseUrl && supabaseKey) {
        supabase = createClient(supabaseUrl, supabaseKey);
    }
    return supabase;
}

// Constants matching client-side code
// EMPIRICAL CORRECTION (Jan 2026): Searcy × 0.80 based on cross-correlation analysis
const TRAVEL_COEF = 4139;        // Adjusted (5174 × 0.80)
const TRAVEL_EXP = -0.5963;      // Searcy exponent (unchanged)
const MEDIAN_TRAVEL = 25.8;      // Adjusted (32.3 × 0.80)
const TRAVEL_POR_GF_BASELINE = 19.4;  // Adjusted (24.3 × 0.80)
const TRAVEL_GF_LF_BASELINE = 6.5;    // Adjusted (8.1 × 0.80)

// Edwards Ferry → Little Falls power-law model
// Updated 2026-02-18: Deduped dataset (v24.16)
// Cold water (≤10°C): 160 × EF^2.36 (deduped fit, R²=0.96)
// Default (>10°C): 126 × EF^2.46 (deduped fit, R²=0.91)
// SYNC WARNING: Keep in sync with EF_MODEL in index.html
const EF_MODEL = {
    // Default coefficients (temp > 10°C or temp unavailable)
    coef: 126,
    exp: 2.46,
    // Cold water coefficients (temp ≤ 10°C)
    coldCoef: 160,
    coldExp: 2.36,
    coldMaxTemp: 10,      // Temperature threshold in °C
    // Static params (weight now flow-dependent, see getEFWeight)
    minStage: 2.5,        // Minimum valid EF stage (ft)
    maxStage: 20.0        // Maximum valid EF stage (ft)
};

// Flow-dependent EF weight for ensemble model
// v30.0: Logistic EF weight ramp — smooth 0% → 40%, midpoint 10k cfs.
// Calibrated via Approach 5 (EF-Dominant) horse race on 117,704 hourly obs (2011-2026).
// Leave-One-Year-Out CV (14 folds), OOS RMSE: 1,907 cfs (-4.6% vs v29.0 baseline).
// Blind Python + R subagents + independent auditor verified.
// See analysis/horserace_v2_python.py and horserace_v2_R.R
// SYNC WARNING: Keep in sync with getEFWeight() in index.html
function getEFWeight(estimatedFlow) {
    // Logistic ramp: near 0% at low flows, 20% at 10k, approaching 40% at high flows
    if (estimatedFlow < 1000) return 0.0;  // Short-circuit: negligible weight below 1k
    const W_MAX = 0.40;
    const K = 5.0;
    const MIDPOINT = Math.log(10000);
    return W_MAX / (1 + Math.exp(-K * (Math.log(estimatedFlow) - MIDPOINT)));
}

const GF_FLOW_BINS = ['0-3000', '3000-6000', '6000-12000', '12000-25000', '25000-50000', '50000+'];

function getFlowBin(cfs) {
    if (cfs < 3000) return '0-3000';
    if (cfs < 6000) return '3000-6000';
    if (cfs < 12000) return '6000-12000';
    if (cfs < 25000) return '12000-25000';
    if (cfs < 50000) return '25000-50000';
    return '50000+';
}

function getFlowMultiplier(lfFlow) {
    const flow = Math.max(lfFlow, 1000);
    const travelHrs = TRAVEL_COEF * Math.pow(flow, TRAVEL_EXP);
    return travelHrs / MEDIAN_TRAVEL;
}

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
                    if (param === '00065') data[siteId].h = val;
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

// Store PoR history to Supabase
async function storePoRHistory(client, history) {
    if (!history?.length) return;

    // Get existing timestamps to avoid duplicates
    const { data: existing } = await client
        .from('potomac_observations')
        .select('data')
        .eq('observation_type', 'por_history')
        .eq('gauge_id', 'system')
        .single();

    const existingTimestamps = new Set(
        (existing?.data?.readings || []).map(r => r.timestamp)
    );

    // Merge new readings
    const newReadings = history.filter(r => !existingTimestamps.has(r.timestamp));
    if (newReadings.length === 0) {
        console.log('No new PoR readings to store');
        return;
    }

    const allReadings = [...(existing?.data?.readings || []), ...newReadings]
        .sort((a, b) => a.timestamp - b.timestamp);

    // Keep only last 48 hours
    const cutoff = Date.now() - (48 * 60 * 60 * 1000);
    const trimmedReadings = allReadings.filter(r => r.timestamp > cutoff);

    await client.from('potomac_observations').upsert({
        observation_type: 'por_history',
        gauge_id: 'system',
        data: {
            readings: trimmedReadings,
            lastUpdate: new Date().toISOString()
        }
    }, { onConflict: 'observation_type,gauge_id' });

    console.log(`Stored ${newReadings.length} new PoR readings, total: ${trimmedReadings.length}`);
}

// Get PoR reading from X hours ago
function getPoRFromHistory(history, hoursAgo) {
    if (!history?.length) return null;

    const targetTime = Date.now() - (hoursAgo * 60 * 60 * 1000);

    let closest = null;
    let closestDiff = Infinity;

    for (const entry of history) {
        const diff = Math.abs(entry.timestamp - targetTime);
        if (diff < closestDiff) {
            closestDiff = diff;
            closest = entry;
        }
    }

    // Only return if within 1 hour of target
    if (closest && closestDiff < 60 * 60 * 1000) {
        return {
            cfs: closest.cfs,
            actualHoursAgo: (Date.now() - closest.timestamp) / (60 * 60 * 1000)
        };
    }

    return null;
}

// Estimate LF flow from stage (inverse rating curve)
// Used for ice/anomaly detection - if actual CFS is much lower than expected from stage,
// likely indicates frazil ice affecting ADVM velocity measurement
// SYNC WARNING: This function is duplicated in index.html. Keep both in sync!
function estimateLFFlowFromStage(stage) {
    // Inverse of estimateLFStage - find CFS that produces given stage
    // Uses piecewise linear interpolation (same breakpoints as estimateLFStage)
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

// Estimate LF-equivalent stage from flow
// Based on USGS field measurements at Little Falls (01646500), 2015-2025
// SYNC WARNING: This function is duplicated in index.html (line ~1539). Keep both in sync!
function estimateLFStage(cfs) {
    if (cfs < 600) return 2.40 + (cfs / 600) * 0.06;
    if (cfs < 1300) return 2.46 + ((cfs - 600) / 700) * 0.23;
    if (cfs < 2000) return 2.69 + ((cfs - 1300) / 700) * 0.14;
    if (cfs < 2600) return 2.83 + ((cfs - 2000) / 600) * 0.13;
    if (cfs < 3200) return 2.96 + ((cfs - 2600) / 600) * 0.13;
    if (cfs < 3600) return 3.09 + ((cfs - 3200) / 400) * 0.07;
    if (cfs < 4200) return 3.16 + ((cfs - 3600) / 600) * 0.07;
    if (cfs < 5000) return 3.23 + ((cfs - 4200) / 800) * 0.12;
    if (cfs < 5700) return 3.35 + ((cfs - 5000) / 700) * 0.11;
    if (cfs < 7500) return 3.46 + ((cfs - 5700) / 1800) * 0.21;
    if (cfs < 10000) return 3.67 + ((cfs - 7500) / 2500) * 0.28;
    if (cfs < 13000) return 3.95 + ((cfs - 10000) / 3000) * 0.34;
    if (cfs < 28000) return 4.29 + ((cfs - 13000) / 15000) * 1.21;
    if (cfs < 50000) return 5.50 + ((cfs - 28000) / 22000) * 1.29;
    if (cfs < 80000) return 6.79 + ((cfs - 50000) / 30000) * 1.57;
    if (cfs < 150000) return 8.36 + ((cfs - 80000) / 70000) * 2.57;
    return 10.93 + ((cfs - 150000) / 100000) * 2.5;
}

// Determine flow state from recent history
// Threshold scales with flow: max(100 cfs, 2% of flow) to filter noise at low flows
// while still detecting real changes at high flows
function getFlowState(history, currentCFS) {
    if (!history?.length || history.length < 8) return 'steady';

    // Get reading from ~2 hours ago
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

    // Threshold: at least 100 cfs change OR 2% of flow, whichever is larger
    // At 2,000 cfs: threshold = 100 cfs (5%)
    // At 5,000 cfs: threshold = 100 cfs (2%)
    // At 10,000 cfs: threshold = 200 cfs (2%)
    // At 50,000 cfs: threshold = 1,000 cfs (2%)
    const minAbsChange = 100;  // Minimum 100 cfs to count as change
    const minPctChange = 0.02; // Minimum 2% to count as change
    const threshold = Math.max(minAbsChange, currentCFS * minPctChange);

    if (absChange >= threshold) {
        if (change > 0) return 'rising';
        if (change < 0) return 'falling';
    }
    return 'steady';
}

// Make GF prediction
// waterTempC: water temperature in Celsius for cold-water EF model adjustment
function makeGFPrediction(usgsData, porHistory, waterTempC = null) {
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

    // Calculate travel times based on current flow
    const mult = getFlowMultiplier(lf.q);
    const travelPoRtoGF = TRAVEL_POR_GF_BASELINE * mult;
    const travelGFtoLF = TRAVEL_GF_LF_BASELINE * mult;

    // Get time-shifted PoR
    const historicPoR = getPoRFromHistory(porHistory, travelPoRtoGF);

    // Tributary contributions
    const monocacyFlow = monocacy?.q || (lf.q * 0.071);
    const gooseFlow = goose?.q || (lf.q * 0.03);
    const broadRunFlow = broadRun?.q || (lf.q * 0.0066);   // 0.66% of LF (v31.0)
    const senecaFlow = seneca?.q || (lf.q * 0.0087);       // 0.87% of LF (v31.0)

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
            const decayFactor = Math.min(0.50, Math.sqrt(fractionElapsed));  // v28.0: lowered from 0.75
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

    // Soft LF ceiling (v28.0): cap GF estimate at 120% of LF actual.
    // decay=0.50 + 120% ceiling: near-zero rising bias (-29 cfs hourly).
    // 120% avoids systematic under-prediction (110% had -476 cfs bias).
    // Cross-verified on 5,208 daily + 42,837 hourly pairs (Python + R).
    let ceilingApplied = false;
    const CEILING_RATIO = 1.20;
    if (lf?.q > 0) {
        const maxEstimate = lf.q * CEILING_RATIO;
        if (estimatedCFS > maxEstimate) {
            console.log(`🔒 LF ceiling: ${Math.round(estimatedCFS)} → ${Math.round(maxEstimate)} cfs (120% of LF ${Math.round(lf.q)})`);
            estimatedCFS = Math.round(maxEstimate);
            ceilingApplied = true;
        }
    }

    const flowBin = getFlowBin(estimatedCFS);

    return {
        timestamp: new Date().toISOString(),
        predictedCFS: Math.round(estimatedCFS),
        predictedStage: Math.round(estimateLFStage(estimatedCFS) * 100) / 100,  // Round to 2 decimal places
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
        efWeight: efWeightUsed,              // Flow-dependent weight used (0% <3k, 35% ≥3k)
        waterTempC,                          // Water temperature used for model selection
        useTimeShifted,
        useEfEnsemble,
        ceilingApplied,
        lfCFS: Math.round(lf.q)
    };
}

// Check and validate pending predictions
async function validatePendingPredictions(client, usgsData) {
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

    for (const pred of pending) {
        const validationDue = new Date(pred.data.validationDue);
        const createdAt = new Date(pred.created_at);

        // Skip invalid timestamps
        if (isNaN(validationDue.getTime())) {
            console.log(`⚠️ Skipping prediction with invalid validationDue: ${pred.id}`);
            continue;
        }

        // Clean up stale predictions (>48 hours old) - mark as expired, don't validate
        const ageMs = now - createdAt;
        if (ageMs > staleThreshold) {
            console.log(`🧹 Cleaning stale prediction from ${createdAt.toISOString()} (${Math.round(ageMs/3600000)}h old)`);
            await client.from('potomac_observations').update({
                gauge_id: 'expired',
                data: {
                    ...pred.data,
                    expiredAt: now.toISOString(),
                    reason: 'stale_prediction'
                }
            }).eq('id', pred.id);
            cleaned++;
            continue;
        }

        if (now >= validationDue) {
            // Calculate actual GF CFS
            const senecaFlow = seneca?.q || (lf.q * 0.01);
            const actualCFS = lf.q - senecaFlow;

            // Calculate CFS error
            const predictedCFS = pred.data.predictedCFS;
            const errorCFS = predictedCFS - actualCFS;
            const errorPercent = (errorCFS / actualCFS) * 100;
            const flowBin = pred.data.flowBin;
            const flowState = pred.data.flowState || 'steady';

            // Calculate stage error (for rating curve analysis)
            const predictedStage = pred.data.predictedStage;
            const actualStage = lf.h;  // LF gauge stage at validation time
            const errorStage = (predictedStage && actualStage)
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
            const currentEfStage = ef?.h;
            let efEstimateNow = null;
            if (currentEfStage && currentEfStage >= EF_MODEL.minStage && currentEfStage <= EF_MODEL.maxStage) {
                efEstimateNow = EF_MODEL.coef * Math.pow(currentEfStage, EF_MODEL.exp);
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
            if (Math.abs(errorPercent) > 50) {
                softScore += 1;
                anomalyFlags.push(`LARGE_ERROR:${errorPercent.toFixed(0)}%`);
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
            const EMA_ALPHA = 0.3;
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
            } else if (isSoftFlagged) {
                console.log(`⚠️ SOFT FLAG (score=${softScore}): ${anomalyFlags.join(', ')}`);
                console.log(`   LF reading: ${Math.round(actualCFS)} cfs — included in learning (EMA clamped) + accuracy`);
            }

            // Update learning: hard flags skip entirely, soft flags use EMA clamping
            if (!isHardFlagged) {
                binData.count += 1;
                binData.sumError += errorCFS;
                binData.sumErrorSq += errorCFS * errorCFS;
                binData.meanError = binData.sumError / binData.count;

                // EMA update with clamping for soft-flagged observations (R1)
                let learningError = errorCFS;
                if (isSoftFlagged && binData.count >= 10) {
                    const variance = (binData.sumErrorSq / binData.count) - (binData.meanError * binData.meanError);
                    const stdDev = Math.sqrt(Math.max(0, variance));
                    const maxDelta = 2 * stdDev;
                    learningError = Math.max(binData.meanError - maxDelta,
                                    Math.min(binData.meanError + maxDelta, errorCFS));
                    if (learningError !== errorCFS) {
                        console.log(`   EMA clamped: ${Math.round(errorCFS)} → ${Math.round(learningError)} cfs (±2σ = ±${Math.round(maxDelta)})`);
                    }
                }

                if (binData.count === 1) {
                    binData.emaMeanError = learningError;
                } else {
                    binData.emaMeanError = EMA_ALPHA * learningError + (1 - EMA_ALPHA) * (binData.emaMeanError || binData.meanError);
                }

                await client.from('potomac_observations').upsert({
                    observation_type: 'gf_correction_bin',
                    gauge_id: binKey,
                    data: binData
                }, { onConflict: 'observation_type,gauge_id' });

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

                    if (stageBinData.count === 1) {
                        stageBinData.emaMeanError = errorStage;
                    } else {
                        stageBinData.emaMeanError = EMA_ALPHA * errorStage + (1 - EMA_ALPHA) * (stageBinData.emaMeanError || stageBinData.meanError);
                    }

                    const stageVariance = (stageBinData.sumErrorSq / stageBinData.count) - (stageBinData.meanError * stageBinData.meanError);
                    stageBinData.stdDev = Math.round(Math.sqrt(Math.max(0, stageVariance)) * 1000) / 1000;

                    await client.from('potomac_observations').upsert({
                        observation_type: 'gf_correction_bin',
                        gauge_id: stageBinKey,
                        data: stageBinData
                    }, { onConflict: 'observation_type,gauge_id' });

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
                    corrData.points = corrData.points.slice(-200);
                }

                corrData.count += 1;
                corrData.sumStage += efStage;
                corrData.sumCFS += actualCFS;
                corrData.sumStageCFS += efStage * actualCFS;
                corrData.sumStageSq += efStage * efStage;

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
                    // We need sumCFSSq for this - add it if not present
                    if (!corrData.sumCFSSq) {
                        // Initialize from points if available
                        corrData.sumCFSSq = corrData.points.reduce((sum, p) => sum + p.cfs * p.cfs, 0);
                    }
                    corrData.sumCFSSq += actualCFS * actualCFS;

                    // R² = 1 - (SS_res / SS_tot)
                    // For simple linear regression: R² = r² where r is Pearson correlation
                    const ssTotal = corrData.sumCFSSq - (corrData.sumCFS * corrData.sumCFS) / n;
                    const ssReg = slope * slope * (corrData.sumStageSq - (corrData.sumStage * corrData.sumStage) / n);
                    corrData.rSquared = ssTotal > 0 ? Math.round((ssReg / ssTotal) * 1000) / 1000 : 0;
                }

                await client.from('potomac_observations').upsert({
                    observation_type: 'ef_gf_correlation',
                    gauge_id: 'system',
                    data: corrData
                }, { onConflict: 'observation_type,gauge_id' });

                console.log(`🔗 EF correlation: n=${corrData.count}, slope=${corrData.slope?.toFixed(0)}, R²=${corrData.rSquared || 'N/A'}`);
            }

            // Move to validated/hard_flagged/soft_flagged
            await client.from('potomac_observations').update({
                gauge_id: isHardFlagged ? 'hard_flagged' : (isSoftFlagged ? 'soft_flagged' : 'validated'),
                data: {
                    ...pred.data,
                    actualCFS,
                    actualStage,
                    errorCFS,
                    errorStage,
                    errorPercent,
                    validatedAt: new Date().toISOString(),
                    isOutlier,
                    // v33.0 two-tier anomaly detection fields
                    isHardFlagged,
                    isSoftFlagged,
                    hardScore,
                    softScore,
                    anomalyFlags: anomalyFlags.length > 0 ? anomalyFlags : null,
                    skipLearning,
                    // Backward compat
                    isSuspicious: isHardFlagged,
                    suspiciousScore: hardScore + softScore
                }
            }).eq('id', pred.id);

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
                metaData.sumAbsErrorPercent = (metaData.sumAbsErrorPercent || 0) + Math.abs(errorPercent);
            }

            // Compute accuracy from valid (non-hard-flagged) observations only
            const validCount = metaData.validValidations || 0;
            metaData.avgErrorPercent = validCount > 0 ? metaData.sumAbsErrorPercent / validCount : null;

            // Track stage error in metadata
            if (errorStage !== null) {
                metaData.stageValidations = (metaData.stageValidations || 0) + 1;
                metaData.sumAbsStageError = (metaData.sumAbsStageError || 0) + Math.abs(errorStage);
                metaData.avgStageError = metaData.sumAbsStageError / metaData.stageValidations;
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

            await client.from('potomac_observations').upsert({
                observation_type: 'gf_metadata',
                gauge_id: 'system',
                data: metaData
            }, { onConflict: 'observation_type,gauge_id' });

            console.log(`✅ Validated prediction: predicted=${predictedCFS}, actual=${Math.round(actualCFS)}, error=${errorPercent.toFixed(1)}%`);
            validated++;
        }
    }

    if (cleaned > 0) {
        console.log(`🧹 Cleaned ${cleaned} stale predictions`);
    }

    return { validated, cleaned };
}

// Store new prediction
async function storePrediction(client, prediction) {
    await client.from('potomac_observations').insert({
        observation_type: 'gf_prediction',
        gauge_id: 'pending',
        data: prediction
    });

    // Update prediction count
    const { data: meta } = await client
        .from('potomac_observations')
        .select('data')
        .eq('observation_type', 'gf_metadata')
        .eq('gauge_id', 'system')
        .single();

    const metaData = meta?.data || { totalValidations: 0, totalPredictions: 0 };
    metaData.totalPredictions += 1;

    // Track execution health
    const now = new Date();
    const lastRun = metaData.lastPrediction ? new Date(metaData.lastPrediction) : null;
    const gapHours = lastRun ? (now - lastRun) / (60 * 60 * 1000) : 0;

    // Detect missed runs (gap > 3 hours means we missed at least one 2-hour cycle)
    if (gapHours > 3) {
        metaData.missedRuns = (metaData.missedRuns || 0) + Math.floor(gapHours / 2) - 1;
        console.log(`⚠️ Gap detected: ${gapHours.toFixed(1)}h since last run (~${Math.floor(gapHours / 2) - 1} missed cycles)`);
    }

    metaData.lastPrediction = now.toISOString();
    metaData.consecutiveRuns = gapHours <= 3 ? (metaData.consecutiveRuns || 0) + 1 : 1;

    await client.from('potomac_observations').upsert({
        observation_type: 'gf_metadata',
        gauge_id: 'system',
        data: metaData
    }, { onConflict: 'observation_type,gauge_id' });

    console.log(`Stored prediction: ${prediction.predictedCFS} cfs, validation due: ${prediction.validationDue}`);
    console.log(`📊 Health: ${metaData.consecutiveRuns} consecutive runs, ${metaData.missedRuns || 0} total missed`);
}

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

    // Get pending forecast predictions
    const { data: pending, error } = await client
        .from('potomac_observations')
        .select('id, gauge_id, data, created_at')
        .eq('observation_type', 'gf_forecast_pending')
        .order('created_at', { ascending: true })
        .limit(100);

    if (error) {
        console.error('Error loading pending forecasts:', error);
        return { validated: 0, cleaned: 0 };
    }

    if (!pending || pending.length === 0) {
        return { validated: 0, cleaned: 0 };
    }

    console.log(`📈 Found ${pending.length} pending forecast predictions`);

    for (const pred of pending) {
        const targetTime = new Date(pred.data.targetTime);
        const horizonNum = pred.data.horizon;  // e.g., 6, 12, 24, 48
        const horizonKey = `+${horizonNum}h`;  // e.g., '+6h' for metadata lookup
        const createdAt = new Date(pred.created_at);

        // Check if target time has passed (allow 15 min buffer for processing)
        if (now < new Date(targetTime.getTime() + 15 * 60 * 1000)) {
            continue; // Not ready for validation yet
        }

        // Check if prediction is stale (>72h old)
        const ageHours = (now - createdAt) / (1000 * 60 * 60);
        if (ageHours > 72) {
            await client.from('potomac_observations').delete().eq('id', pred.id);
            cleaned++;
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
        const { data: meta } = await client
            .from('potomac_observations')
            .select('data')
            .eq('observation_type', 'gf_forecast_metadata')
            .eq('gauge_id', horizonKey)
            .single();

        const metaData = meta?.data || { validations: 0, sumAbsErrorPercent: 0 };
        metaData.validations += 1;
        metaData.sumAbsErrorPercent = (metaData.sumAbsErrorPercent || 0) + errorPercent;
        metaData.avgErrorPercent = metaData.sumAbsErrorPercent / metaData.validations;
        metaData.lastValidation = now.toISOString();
        metaData.lastErrorPercent = errorPercent;

        await client.from('potomac_observations').upsert({
            observation_type: 'gf_forecast_metadata',
            gauge_id: horizonKey,
            data: metaData
        }, { onConflict: 'observation_type,gauge_id' });

        // Delete the validated prediction
        await client.from('potomac_observations').delete().eq('id', pred.id);
        validated++;
    }

    return { validated, cleaned };
}

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
        // 1. Fetch USGS data and water temperature in parallel
        console.log('Fetching USGS data and water temperature...');
        const [usgsData, waterTempC] = await Promise.all([
            fetchUSGSData(),
            fetchWaterTemp()
        ]);
        if (!usgsData) {
            return { statusCode: 500, body: 'Failed to fetch USGS data' };
        }
        console.log('USGS data fetched successfully');

        // 2. Store PoR history
        console.log('Storing PoR history...');
        const porHistory = usgsData.data[usgsData.gauges.por]?.history || [];
        await storePoRHistory(client, porHistory);

        // 3. Load stored PoR history for time-shifting
        const { data: storedHistory } = await client
            .from('potomac_observations')
            .select('data')
            .eq('observation_type', 'por_history')
            .eq('gauge_id', 'system')
            .single();

        const fullHistory = storedHistory?.data?.readings || porHistory;

        // Check if critical gauges are ice-affected (PoR, LF, or EF missing)
        const porIce = usgsData.data[usgsData.gauges.por]?.iceAffected;
        const lfIce = usgsData.data[usgsData.gauges.lf]?.iceAffected;
        const efMissing = !usgsData.data[usgsData.gauges.ef]?.h;
        const criticalIce = porIce || lfIce || efMissing;

        if (criticalIce) {
            console.log(`🧊 Critical gauge ice/unavailable — skipping learning & validation (PoR ice: ${!!porIce}, LF ice: ${!!lfIce}, EF missing: ${efMissing})`);
        }

        // 4. Validate pending predictions (skip if critical gauges ice-affected)
        let validated = 0, cleaned = 0;
        if (!criticalIce) {
            console.log('Checking pending predictions...');
            const validationResult = await validatePendingPredictions(client, usgsData);
            validated = validationResult.validated || 0;
            cleaned = validationResult.cleaned || 0;
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
            prediction = makeGFPrediction(usgsData, fullHistory, waterTempC);
            if (prediction) {
                await storePrediction(client, prediction);
                console.log(`📊 New prediction: ${prediction.predictedCFS} cfs (${prediction.flowBin}, ${prediction.flowState})`);
            }
        }

        // 6. Log summary
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

        return {
            statusCode: 200,
            body: JSON.stringify(summary)
        };

    } catch (e) {
        console.error('Scheduled update error:', e);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: e.message })
        };
    }
};

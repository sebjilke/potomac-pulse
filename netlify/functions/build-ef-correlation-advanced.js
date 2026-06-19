// Potomac Pulse - Advanced EF→LF Correlation Builder (Limnologist Approach)
//
// This implements a rigorous hydrological model:
// 1. Uses instantaneous (15-min) data, not daily averages
// 2. Time-shifts EF readings to match when that water reaches LF
// 3. Classifies rising vs falling limb (hysteresis)
// 4. Fits power-law models: LF = a × EF^b
// 5. Tests for seasonal effects
// 6. Identifies and excludes outliers
//
// GET /.netlify/functions/build-ef-correlation-advanced?months=12
// GET /.netlify/functions/build-ef-correlation-advanced?months=24&save=true

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

const EDWARDS_FERRY_ID = '01644148';
const LITTLE_FALLS_ID = '01646500';

// ==================== SEARCY TRAVEL TIME MODEL ====================
// Based on USGS Circular 438 (Searcy & Davis, 1961)
// Original power law: T_PoR_to_LF = 5174 × Q^(-0.5963) hours
// EMPIRICAL CORRECTION (Jan 2026): T = 4139 × Q^(-0.5963) (0.80 multiplier)
//
// Distance calibration:
//   - PoR to LF: 41 miles (full Searcy model)
//   - EF to LF: ~15 miles (37% of PoR→LF distance)
//   - But EF→LF includes Mather Gorge (faster flow), so use ~30% of time
//
// The Searcy model gives travel time as function of LF discharge.
// We need to estimate LF discharge from EF stage to get travel time.

// ==================== SEARCY-BASED TRAVEL TIME MODEL ====================
// Based on USGS Circular 438 (Searcy & Davis, 1961)
// EMPIRICAL CORRECTION (Jan 2026): Cross-correlation analysis showed travel
// times ~20% faster than the 1961 dye-tracer study. Applied 0.80 multiplier.
//
// Original model: T_PoR_to_LF = 5174 × Q^(-0.5963) hours (41 miles)
// Corrected model: T_PoR_to_LF = 4139 × Q^(-0.5963) hours
//
// For EF→LF (15 miles), we scale using the same power-law exponent but
// recalibrate the coefficient for the shorter, faster gorge section.
//
// Derivation (with 0.80 correction):
//   - At median flow (4940 cfs), PoR→LF = 25.8 hrs for 41 miles
//   - Average velocity = 41/25.8 = 1.59 mph
//   - GF→LF section (gorge): ~1.5x faster due to gradient = 2.4 mph
//   - EF→LF (~15 miles through gorge region): 15/2.4 ≈ 6.3 hrs at median
//   - At flood (50000 cfs): proportionally faster → ~2 hrs
//
// We use: T_EF_to_LF = 1120 × Q^(-0.5963) hours (1400 × 0.80)
// This gives: 5000 cfs → 7.0 hrs, 20000 cfs → 3.7 hrs, 50000 cfs → 2.3 hrs
//
const SEARCY_COEF = 4139;        // Corrected Searcy coefficient (5174 × 0.80)
const SEARCY_EXP = -0.5963;      // Searcy exponent (velocity-flow relationship)
const EF_LF_COEF = 1120;         // Scaled coefficient for EF→LF (1400 × 0.80)

/**
 * Estimates EF→LF water travel time from an estimated Little Falls discharge using the scaled Searcy power law, clamped to physical bounds.
 * @param {number} estimatedLfFlow - Estimated Little Falls discharge in cubic feet per second (cfs).
 * @returns {number} Travel time in hours, bounded to [1.5, 5.0].
 */
function estimateTravelTimeHours(estimatedLfFlow) {
    // Clamp flow to reasonable range (avoid divide-by-zero type issues)
    const flow = Math.max(estimatedLfFlow, 1000);

    // EF→LF travel time using scaled Searcy power law (with 0.80 correction)
    const efToLfHours = EF_LF_COEF * Math.pow(flow, SEARCY_EXP);

    // Sanity bounds based on physical constraints:
    // - Minimum: ~1.5 hrs (even in major flood, water needs time to traverse gorge)
    // - Maximum: ~5 hrs (at very low flows, adjusted from 6 hrs with 0.80 correction)
    return Math.max(1.5, Math.min(5.0, efToLfHours));

    // Reference values (with 0.80 empirical correction):
    //   LF Flow     EF→LF Travel Time
    //   2,000 cfs   12.2 hrs → capped to 5.0 hrs
    //   3,000 cfs    9.4 hrs → capped to 5.0 hrs
    //   5,000 cfs    7.0 hrs → capped to 5.0 hrs
    //   7,500 cfs    5.5 hrs → capped to 5.0 hrs
    //   10,000 cfs   4.7 hrs
    //   15,000 cfs   4.1 hrs
    //   20,000 cfs   3.7 hrs
    //   30,000 cfs   3.0 hrs
    //   50,000 cfs   2.3 hrs
    //   75,000 cfs   1.9 hrs
    //   100,000 cfs  1.7 hrs
}

// Determine if stage is rising, falling, or steady based on recent history
/**
 * Classifies the hydrograph limb (rising, falling, or steady) at a point by inspecting stage changes over a preceding window.
 * @param {Array<{stage: number, timestamp: number}>} history - Time-ordered EF readings; only `.stage` (feet) is used here.
 * @param {number} currentIdx - Index into `history` of the reading being classified.
 * @param {number} [windowSize=4] - Number of preceding intervals examined for the trend.
 * @returns {string} One of 'rising', 'falling', 'steady', or 'unknown' (when too few prior readings exist).
 */
function classifyLimb(history, currentIdx, windowSize = 4) {
    if (currentIdx < windowSize) return 'unknown';

    let rising = 0, falling = 0;
    for (let i = currentIdx - windowSize; i < currentIdx; i++) {
        if (history[i + 1].stage > history[i].stage + 0.02) rising++;
        else if (history[i + 1].stage < history[i].stage - 0.02) falling++;
    }

    if (rising >= windowSize - 1) return 'rising';
    if (falling >= windowSize - 1) return 'falling';
    return 'steady';
}

// Fit power-law model: y = a * x^b using log-linear regression
// ln(y) = ln(a) + b*ln(x)
/**
 * Fits a power-law model LF = a × EF^b via log-linear least-squares and reports fit quality and prediction-error percentiles.
 * @param {Array<{efStage: number, lfFlow: number}>} pairs - EF stage (feet) / LF flow (cfs) observation pairs.
 * @returns {{a: number, b: number, equation: string, rSquaredLog: number, rSquaredOrig: number, count: number, medianErrorPct: number, p90ErrorPct: number}|null} Fitted coefficients, R² in log and original space, valid sample count, and median/90th-percentile absolute percent errors; null if fewer than 10 valid pairs.
 */
function fitPowerLaw(pairs) {
    if (pairs.length < 10) return null;

    // Filter out invalid values (can't take log of zero/negative)
    const valid = pairs.filter(p => p.efStage > 0 && p.lfFlow > 0);
    if (valid.length < 10) return null;

    const n = valid.length;
    let sumLnX = 0, sumLnY = 0, sumLnXLnY = 0, sumLnX2 = 0, sumLnY2 = 0;

    for (const p of valid) {
        const lnX = Math.log(p.efStage);
        const lnY = Math.log(p.lfFlow);
        sumLnX += lnX;
        sumLnY += lnY;
        sumLnXLnY += lnX * lnY;
        sumLnX2 += lnX * lnX;
        sumLnY2 += lnY * lnY;
    }

    // Linear regression in log space
    const b = (n * sumLnXLnY - sumLnX * sumLnY) / (n * sumLnX2 - sumLnX * sumLnX);
    const lnA = (sumLnY - b * sumLnX) / n;
    const a = Math.exp(lnA);

    // R² in log space
    const meanLnY = sumLnY / n;
    let ssRes = 0, ssTot = 0;
    for (const p of valid) {
        const lnX = Math.log(p.efStage);
        const lnY = Math.log(p.lfFlow);
        const predictedLnY = lnA + b * lnX;
        ssRes += Math.pow(lnY - predictedLnY, 2);
        ssTot += Math.pow(lnY - meanLnY, 2);
    }
    const rSquaredLog = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;

    // Also calculate R² in original space for comparison
    let ssResOrig = 0, ssTotOrig = 0;
    const meanY = valid.reduce((sum, p) => sum + p.lfFlow, 0) / n;
    for (const p of valid) {
        const predicted = a * Math.pow(p.efStage, b);
        ssResOrig += Math.pow(p.lfFlow - predicted, 2);
        ssTotOrig += Math.pow(p.lfFlow - meanY, 2);
    }
    const rSquaredOrig = ssTotOrig > 0 ? 1 - (ssResOrig / ssTotOrig) : 0;

    // Calculate prediction errors
    const errors = valid.map(p => {
        const predicted = a * Math.pow(p.efStage, b);
        return Math.abs((p.lfFlow - predicted) / p.lfFlow * 100);
    });
    errors.sort((x, y) => x - y);

    return {
        a: Math.round(a * 100) / 100,
        b: Math.round(b * 1000) / 1000,
        equation: `LF_cfs = ${Math.round(a * 100) / 100} × EF_stage^${Math.round(b * 1000) / 1000}`,
        rSquaredLog: Math.round(rSquaredLog * 1000) / 1000,
        rSquaredOrig: Math.round(rSquaredOrig * 1000) / 1000,
        count: valid.length,
        medianErrorPct: Math.round(errors[Math.floor(errors.length / 2)] * 10) / 10,
        p90ErrorPct: Math.round(errors[Math.floor(errors.length * 0.9)] * 10) / 10
    };
}

// Fit simple linear model for comparison: y = mx + c
/**
 * Fits a simple ordinary-least-squares line LF = slope × EF + intercept for comparison against the power-law model.
 * @param {Array<{efStage: number, lfFlow: number}>} pairs - EF stage (feet) / LF flow (cfs) observation pairs.
 * @returns {{slope: number, intercept: number, equation: string, rSquared: number, count: number}|null} Rounded slope/intercept, equation string, R², and valid sample count; null if fewer than 10 valid pairs.
 */
function fitLinear(pairs) {
    if (pairs.length < 10) return null;

    const valid = pairs.filter(p => p.efStage > 0 && p.lfFlow > 0);
    if (valid.length < 10) return null;

    const n = valid.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (const p of valid) {
        sumX += p.efStage;
        sumY += p.lfFlow;
        sumXY += p.efStage * p.lfFlow;
        sumX2 += p.efStage * p.efStage;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // R²
    const meanY = sumY / n;
    let ssRes = 0, ssTot = 0;
    for (const p of valid) {
        const predicted = slope * p.efStage + intercept;
        ssRes += Math.pow(p.lfFlow - predicted, 2);
        ssTot += Math.pow(p.lfFlow - meanY, 2);
    }

    return {
        slope: Math.round(slope),
        intercept: Math.round(intercept),
        equation: `LF_cfs = ${Math.round(slope)} × EF_stage + ${Math.round(intercept)}`,
        rSquared: Math.round((ssTot > 0 ? 1 - (ssRes / ssTot) : 0) * 1000) / 1000,
        count: valid.length
    };
}

// Detect outliers using IQR method on prediction errors
/**
 * Partitions observation pairs into clean and outlier sets using the 1.5×IQR upper-fence rule on power-law prediction percent errors.
 * @param {Array<{efStage: number, lfFlow: number, timestamp: (string|number), limb: string}>} pairs - EF/LF observation pairs to screen.
 * @param {{a: number, b: number}|null} model - Fitted power-law model used to compute prediction errors.
 * @returns {{clean: Array<Object>, outliers: Array<Object>, upperFence: number}} The retained `clean` pairs, the rejected `outliers` (with predicted flow and rounded error percent), and the error-percent `upperFence` threshold; if no model or fewer than 20 pairs, returns all pairs as clean with an empty outlier list.
 */
function detectOutliers(pairs, model) {
    if (!model || pairs.length < 20) return { clean: pairs, outliers: [] };

    const withErrors = pairs.map(p => {
        const predicted = model.a * Math.pow(p.efStage, model.b);
        const errorPct = Math.abs((p.lfFlow - predicted) / p.lfFlow * 100);
        return { ...p, predicted, errorPct };
    });

    // Calculate IQR of errors
    const errors = withErrors.map(p => p.errorPct).sort((a, b) => a - b);
    const q1 = errors[Math.floor(errors.length * 0.25)];
    const q3 = errors[Math.floor(errors.length * 0.75)];
    const iqr = q3 - q1;
    const upperFence = q3 + 1.5 * iqr;

    const clean = withErrors.filter(p => p.errorPct <= upperFence);
    const outliers = withErrors.filter(p => p.errorPct > upperFence);

    return {
        clean: clean.map(p => ({ efStage: p.efStage, lfFlow: p.lfFlow, timestamp: p.timestamp, limb: p.limb })),
        outliers: outliers.map(p => ({
            timestamp: p.timestamp,
            efStage: p.efStage,
            lfFlow: p.lfFlow,
            predicted: Math.round(p.predicted),
            errorPct: Math.round(p.errorPct)
        })),
        upperFence: Math.round(upperFence)
    };
}

/**
 * Netlify function handler that builds the advanced EF→LF correlation model: fetches multi-month instantaneous USGS data, discovers optimal flow-regime time shifts, fits power-law/linear/hysteresis/seasonal models, and optionally persists the result to Supabase.
 * @param {Object} event - Netlify event; `queryStringParameters` may include `pin` (admin auth), `months` (lookback, capped at 24), and `save` ('true' to write to the database).
 * @param {Object} context - Netlify execution context (unused).
 * @returns {Promise<{statusCode: number, headers?: Object, body: string}>} HTTP response whose JSON body is the analysis result, or an error payload (403/503 auth, 400 insufficient data, 500 on exception).
 */
exports.handler = async (event, context) => {
    console.log('=== Advanced EF→LF Correlation (Limnologist Approach) ===');

    // Admin gate: this endpoint triggers multi-month USGS pulls and (with ?save=true)
    // writes to Supabase under the service-role key. Require the admin PIN.
    const ADMIN_PIN = process.env.ADMIN_PIN;
    const pin = event.queryStringParameters?.pin;
    if (!ADMIN_PIN || pin !== ADMIN_PIN) {
        return { statusCode: !ADMIN_PIN ? 503 : 403, body: JSON.stringify({ error: !ADMIN_PIN ? 'Admin PIN not configured' : 'Invalid PIN' }) };
    }

    const months = parseInt(event.queryStringParameters?.months || '12');
    const saveToDb = event.queryStringParameters?.save === 'true';

    // Limit to 24 months max to avoid timeout (instantaneous data is large)
    const actualMonths = Math.min(months, 24);

    console.log(`Fetching ${actualMonths} months of instantaneous data...`);

    try {
        // Calculate date range
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - actualMonths * 30 * 24 * 60 * 60 * 1000);

        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        console.log(`Date range: ${startStr} to ${endStr}`);

        // Fetch instantaneous values (15-min intervals)
        // EF: stage only (00065)
        // LF: discharge (00060)
        const efUrl = `https://nwis.waterservices.usgs.gov/nwis/iv/?format=json&sites=${EDWARDS_FERRY_ID}&startDT=${startStr}&endDT=${endStr}&parameterCd=00065&siteStatus=all`;
        const lfUrl = `https://nwis.waterservices.usgs.gov/nwis/iv/?format=json&sites=${LITTLE_FALLS_ID}&startDT=${startStr}&endDT=${endStr}&parameterCd=00060&siteStatus=all`;

        console.log('Fetching USGS instantaneous data (this may take a moment)...');

        const [efResponse, lfResponse] = await Promise.all([
            fetch(efUrl),
            fetch(lfUrl)
        ]);

        if (!efResponse.ok) {
            throw new Error(`EF fetch failed: ${efResponse.status} ${efResponse.statusText}`);
        }
        if (!lfResponse.ok) {
            throw new Error(`LF fetch failed: ${lfResponse.status} ${lfResponse.statusText}`);
        }

        const efData = await efResponse.json();
        const lfData = await lfResponse.json();

        // Extract time series
        const efTimeSeries = efData.value?.timeSeries?.[0]?.values?.[0]?.value || [];
        const lfTimeSeries = lfData.value?.timeSeries?.[0]?.values?.[0]?.value || [];

        console.log(`EF raw data points: ${efTimeSeries.length}`);
        console.log(`LF raw data points: ${lfTimeSeries.length}`);

        if (efTimeSeries.length < 1000 || lfTimeSeries.length < 1000) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    error: 'Insufficient instantaneous data',
                    efPoints: efTimeSeries.length,
                    lfPoints: lfTimeSeries.length
                })
            };
        }

        // Build EF history with timestamps (for limb classification)
        const efHistory = [];
        for (const point of efTimeSeries) {
            const stage = parseFloat(point.value);
            if (!isNaN(stage) && stage > 0) {
                efHistory.push({
                    timestamp: new Date(point.dateTime).getTime(),
                    stage
                });
            }
        }
        efHistory.sort((a, b) => a.timestamp - b.timestamp);

        // Build LF lookup map by timestamp (rounded to 15 min)
        const lfByTime = new Map();
        for (const point of lfTimeSeries) {
            const flow = parseFloat(point.value);
            if (!isNaN(flow) && flow > 0) {
                const ts = new Date(point.dateTime).getTime();
                // Round to nearest 15 minutes
                const rounded = Math.round(ts / (15 * 60 * 1000)) * (15 * 60 * 1000);
                lfByTime.set(rounded, flow);
            }
        }

        console.log(`EF valid readings: ${efHistory.length}`);
        console.log(`LF valid readings: ${lfByTime.size}`);

        // ==================== OPTIMAL TIME SHIFT DISCOVERY ====================
        // The limnologist approach: empirically find the time shift that maximizes
        // correlation, rather than assuming a fixed shift.
        //
        // We test shifts from 1 to 8 hours in 15-minute increments and find the
        // shift that produces the highest R² between EF stage and LF flow.

        console.log('Finding optimal time shift...');

        /**
         * Builds EF-stage/LF-flow pairs by shifting each classified EF reading forward in time and matching the nearest LF reading within ±15 minutes.
         * @param {number} shiftMs - Forward time shift applied to EF timestamps, in milliseconds.
         * @returns {Array<{efStage: number, lfFlow: number, limb: string, timestamp: number}>} Matched pairs (excludes readings with 'unknown' limb or no LF match within tolerance).
         */
        function matchPairsWithShift(shiftMs) {
            const pairs = [];
            for (let i = 4; i < efHistory.length; i++) {
                const ef = efHistory[i];
                const limb = classifyLimb(efHistory, i, 4);
                if (limb === 'unknown') continue;

                const targetTime = ef.timestamp + shiftMs;
                const roundedTarget = Math.round(targetTime / (15 * 60 * 1000)) * (15 * 60 * 1000);

                // Look for LF reading within ±15 minutes of target
                let lfFlow = lfByTime.get(roundedTarget);
                if (!lfFlow) {
                    lfFlow = lfByTime.get(roundedTarget + 15 * 60 * 1000);
                }
                if (!lfFlow) {
                    lfFlow = lfByTime.get(roundedTarget - 15 * 60 * 1000);
                }
                if (!lfFlow) continue;

                pairs.push({ efStage: ef.stage, lfFlow, limb, timestamp: ef.timestamp });
            }
            return pairs;
        }

        /**
         * Computes a fast log-space R² for a power-law fit, used to score candidate time shifts during the shift sweep.
         * @param {Array<{efStage: number, lfFlow: number}>} pairs - EF stage (feet) / LF flow (cfs) pairs.
         * @returns {number} R² of the log-linear fit, or 0 if fewer than 100 valid pairs or zero total variance.
         */
        function quickR2(pairs) {
            if (pairs.length < 100) return 0;
            // Quick R² calculation for power-law fit in log space
            const valid = pairs.filter(p => p.efStage > 0 && p.lfFlow > 0);
            if (valid.length < 100) return 0;

            const n = valid.length;
            let sumLnX = 0, sumLnY = 0, sumLnXLnY = 0, sumLnX2 = 0, sumLnY2 = 0;
            for (const p of valid) {
                const lnX = Math.log(p.efStage);
                const lnY = Math.log(p.lfFlow);
                sumLnX += lnX;
                sumLnY += lnY;
                sumLnXLnY += lnX * lnY;
                sumLnX2 += lnX * lnX;
                sumLnY2 += lnY * lnY;
            }

            const b = (n * sumLnXLnY - sumLnX * sumLnY) / (n * sumLnX2 - sumLnX * sumLnX);
            const lnA = (sumLnY - b * sumLnX) / n;

            const meanLnY = sumLnY / n;
            let ssRes = 0, ssTot = 0;
            for (const p of valid) {
                const lnX = Math.log(p.efStage);
                const lnY = Math.log(p.lfFlow);
                const predictedLnY = lnA + b * lnX;
                ssRes += Math.pow(lnY - predictedLnY, 2);
                ssTot += Math.pow(lnY - meanLnY, 2);
            }
            return ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
        }

        // Test shifts from 1 to 8 hours in 15-min increments
        let bestShiftHrs = 4;
        let bestR2 = 0;
        const shiftResults = [];

        for (let shiftHrs = 1; shiftHrs <= 8; shiftHrs += 0.25) {
            const shiftMs = shiftHrs * 60 * 60 * 1000;
            const pairs = matchPairsWithShift(shiftMs);
            const r2 = quickR2(pairs);
            shiftResults.push({ shiftHrs, r2, pairCount: pairs.length });

            if (r2 > bestR2) {
                bestR2 = r2;
                bestShiftHrs = shiftHrs;
            }
        }

        console.log(`Optimal time shift: ${bestShiftHrs} hours (R² = ${bestR2.toFixed(4)})`);

        // ==================== FLOW-REGIME-SPECIFIC TIME SHIFTS ====================
        // The Searcy model tells us travel time varies with flow. Let's verify this
        // by finding optimal shifts for different flow regimes.

        console.log('Testing flow-regime-specific time shifts...');

        // First, get pairs using the overall optimal shift
        const optimalShiftMs = bestShiftHrs * 60 * 60 * 1000;
        const initialPairs = matchPairsWithShift(optimalShiftMs);

        // Separate into flow regimes based on initial LF flow estimates
        const lowFlowEF = initialPairs.filter(p => p.lfFlow < 5000);
        const medFlowEF = initialPairs.filter(p => p.lfFlow >= 5000 && p.lfFlow < 15000);
        const highFlowEF = initialPairs.filter(p => p.lfFlow >= 15000);

        // Find optimal shift for each regime
        /**
         * Sweeps candidate time shifts (in 0.25-hour steps) over the EF timestamps of a flow-regime subset and returns the shift that maximizes log-space R².
         * @param {Array<{timestamp: number}>} basePairs - Pairs whose EF timestamps define the regime subset to re-match at each trial shift.
         * @param {number} [minShift=1] - Minimum trial shift in hours.
         * @param {number} [maxShift=8] - Maximum trial shift in hours.
         * @returns {{shiftHrs: number, r2: number}} Best shift in hours and its R²; falls back to the overall best shift with r2 0 if fewer than 100 base pairs.
         */
        function findOptimalShiftForPairs(basePairs, minShift = 1, maxShift = 8) {
            if (basePairs.length < 100) return { shiftHrs: bestShiftHrs, r2: 0 };

            // Get the EF timestamps from these pairs
            const efTimestamps = new Set(basePairs.map(p => p.timestamp));

            let regimeBestShift = bestShiftHrs;
            let regimeBestR2 = 0;

            for (let shiftHrs = minShift; shiftHrs <= maxShift; shiftHrs += 0.25) {
                const shiftMs = shiftHrs * 60 * 60 * 1000;
                const pairs = [];

                for (const efTs of efTimestamps) {
                    const ef = efHistory.find(e => e.timestamp === efTs);
                    if (!ef) continue;

                    const targetTime = ef.timestamp + shiftMs;
                    const roundedTarget = Math.round(targetTime / (15 * 60 * 1000)) * (15 * 60 * 1000);

                    let lfFlow = lfByTime.get(roundedTarget) ||
                                 lfByTime.get(roundedTarget + 15 * 60 * 1000) ||
                                 lfByTime.get(roundedTarget - 15 * 60 * 1000);
                    if (!lfFlow) continue;

                    pairs.push({ efStage: ef.stage, lfFlow });
                }

                const r2 = quickR2(pairs);
                if (r2 > regimeBestR2) {
                    regimeBestR2 = r2;
                    regimeBestShift = shiftHrs;
                }
            }

            return { shiftHrs: regimeBestShift, r2: regimeBestR2 };
        }

        const lowFlowOptimal = findOptimalShiftForPairs(lowFlowEF);
        const medFlowOptimal = findOptimalShiftForPairs(medFlowEF);
        const highFlowOptimal = findOptimalShiftForPairs(highFlowEF);

        console.log(`Low flow (<5k cfs) optimal shift: ${lowFlowOptimal.shiftHrs} hrs (R²=${lowFlowOptimal.r2.toFixed(3)})`);
        console.log(`Med flow (5k-15k cfs) optimal shift: ${medFlowOptimal.shiftHrs} hrs (R²=${medFlowOptimal.r2.toFixed(3)})`);
        console.log(`High flow (>15k cfs) optimal shift: ${highFlowOptimal.shiftHrs} hrs (R²=${highFlowOptimal.r2.toFixed(3)})`);

        // ==================== BUILD FINAL PAIRS WITH DYNAMIC SHIFTS ====================
        // Use flow-regime-specific shifts for best accuracy

        console.log('Building final dataset with dynamic time shifts...');

        // First pass: use overall optimal shift to estimate flow regime
        const allPairs = [];
        const risingPairs = [];
        const fallingPairs = [];
        const steadyPairs = [];
        const winterPairs = [];
        const summerPairs = [];

        for (let i = 4; i < efHistory.length; i++) {
            const ef = efHistory[i];
            const limb = classifyLimb(efHistory, i, 4);
            if (limb === 'unknown') continue;

            // Initial estimate using overall optimal shift to determine flow regime
            const initialTargetTime = ef.timestamp + optimalShiftMs;
            const initialRounded = Math.round(initialTargetTime / (15 * 60 * 1000)) * (15 * 60 * 1000);
            let initialLfFlow = lfByTime.get(initialRounded) ||
                               lfByTime.get(initialRounded + 15 * 60 * 1000) ||
                               lfByTime.get(initialRounded - 15 * 60 * 1000);

            if (!initialLfFlow) continue;

            // Determine flow regime and use appropriate shift
            let regimeShiftHrs;
            if (initialLfFlow < 5000) {
                regimeShiftHrs = lowFlowOptimal.shiftHrs;
            } else if (initialLfFlow < 15000) {
                regimeShiftHrs = medFlowOptimal.shiftHrs;
            } else {
                regimeShiftHrs = highFlowOptimal.shiftHrs;
            }

            // Get final LF flow using regime-specific shift
            const finalShiftMs = regimeShiftHrs * 60 * 60 * 1000;
            const finalTargetTime = ef.timestamp + finalShiftMs;
            const finalRounded = Math.round(finalTargetTime / (15 * 60 * 1000)) * (15 * 60 * 1000);
            let lfFlow = lfByTime.get(finalRounded) ||
                        lfByTime.get(finalRounded + 15 * 60 * 1000) ||
                        lfByTime.get(finalRounded - 15 * 60 * 1000);

            if (!lfFlow) continue;

            const pair = {
                timestamp: new Date(ef.timestamp).toISOString(),
                efStage: ef.stage,
                lfFlow,
                limb,
                travelHrs: regimeShiftHrs
            };

            allPairs.push(pair);

            // Categorize by limb
            if (limb === 'rising') risingPairs.push(pair);
            else if (limb === 'falling') fallingPairs.push(pair);
            else steadyPairs.push(pair);

            // Categorize by season
            const month = new Date(ef.timestamp).getMonth();
            if (month >= 9 || month <= 2) {
                winterPairs.push(pair);
            } else {
                summerPairs.push(pair);
            }
        }

        console.log(`Total matched pairs: ${allPairs.length}`);
        console.log(`  Rising: ${risingPairs.length}, Falling: ${fallingPairs.length}, Steady: ${steadyPairs.length}`);
        console.log(`  Winter: ${winterPairs.length}, Summer: ${summerPairs.length}`);

        if (allPairs.length < 100) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    error: 'Insufficient matched pairs after time-shifting',
                    matchedPairs: allPairs.length
                })
            };
        }

        // ===== MODEL FITTING =====

        // 1. Overall power-law model
        const overallPowerLaw = fitPowerLaw(allPairs);
        const overallLinear = fitLinear(allPairs);

        // 2. Detect and remove outliers, then refit
        const outlierAnalysis = detectOutliers(allPairs, overallPowerLaw);
        const cleanPowerLaw = fitPowerLaw(outlierAnalysis.clean);

        // 3. Hysteresis models (rising vs falling limb)
        const risingModel = fitPowerLaw(risingPairs);
        const fallingModel = fitPowerLaw(fallingPairs);
        const steadyModel = fitPowerLaw(steadyPairs);

        // 4. Seasonal models
        const winterModel = fitPowerLaw(winterPairs);
        const summerModel = fitPowerLaw(summerPairs);

        // ===== BUILD RESULTS =====

        const result = {
            meta: {
                generatedAt: new Date().toISOString(),
                approach: 'Limnologist (instantaneous data, time-shifted, hysteresis-aware)',
                dateRange: { start: startStr, end: endStr },
                monthsAnalyzed: actualMonths,
                totalPairs: allPairs.length,
                dataQuality: {
                    efRawPoints: efTimeSeries.length,
                    lfRawPoints: lfTimeSeries.length,
                    matchedPairs: allPairs.length,
                    matchRate: Math.round(allPairs.length / efHistory.length * 100) + '%'
                }
            },

            // Time shift analysis (Searcy-derived, empirically validated)
            timeShiftAnalysis: {
                overallOptimal: {
                    shiftHours: bestShiftHrs,
                    rSquared: Math.round(bestR2 * 1000) / 1000
                },
                byFlowRegime: {
                    low: {
                        flowRange: '<5,000 cfs',
                        shiftHours: lowFlowOptimal.shiftHrs,
                        rSquared: Math.round(lowFlowOptimal.r2 * 1000) / 1000,
                        pairCount: lowFlowEF.length
                    },
                    medium: {
                        flowRange: '5,000-15,000 cfs',
                        shiftHours: medFlowOptimal.shiftHrs,
                        rSquared: Math.round(medFlowOptimal.r2 * 1000) / 1000,
                        pairCount: medFlowEF.length
                    },
                    high: {
                        flowRange: '>15,000 cfs',
                        shiftHours: highFlowOptimal.shiftHrs,
                        rSquared: Math.round(highFlowOptimal.r2 * 1000) / 1000,
                        pairCount: highFlowEF.length
                    }
                },
                searcyComparison: {
                    note: 'Comparing empirical optimal shifts vs Searcy-predicted shifts',
                    searcyPredicted: {
                        lowFlow: '6.0 hrs (capped from higher)',
                        medFlow: '5.5 hrs',
                        highFlow: '3.5 hrs'
                    },
                    interpretation: Math.abs(lowFlowOptimal.shiftHrs - 6) < 1 &&
                                   Math.abs(highFlowOptimal.shiftHrs - 3.5) < 1 ?
                        'Empirical shifts match Searcy predictions well' :
                        'Empirical shifts differ from Searcy - may need recalibration'
                },
                shiftSweepResults: shiftResults.filter((_, i) => i % 4 === 0) // Every hour
            },

            // Main model comparison
            modelComparison: {
                linearModel: overallLinear,
                powerLawModel: overallPowerLaw,
                improvement: overallPowerLaw && overallLinear ? {
                    rSquaredGain: Math.round((overallPowerLaw.rSquaredOrig - overallLinear.rSquared) * 1000) / 1000,
                    verdict: overallPowerLaw.rSquaredOrig > overallLinear.rSquared ?
                        'Power-law fits better (as expected for hydraulic systems)' :
                        'Linear model performs comparably'
                } : null
            },

            // Outlier analysis
            outlierAnalysis: {
                outlierCount: outlierAnalysis.outliers.length,
                outlierPct: Math.round(outlierAnalysis.outliers.length / allPairs.length * 100 * 10) / 10,
                errorThreshold: outlierAnalysis.upperFence + '%',
                cleanModelImprovement: cleanPowerLaw && overallPowerLaw ? {
                    before: overallPowerLaw.rSquaredOrig,
                    after: cleanPowerLaw.rSquaredOrig,
                    gain: Math.round((cleanPowerLaw.rSquaredOrig - overallPowerLaw.rSquaredOrig) * 1000) / 1000
                } : null,
                sampleOutliers: outlierAnalysis.outliers.slice(0, 5)
            },

            // Hysteresis analysis
            hysteresisAnalysis: {
                rising: risingModel ? {
                    ...risingModel,
                    count: risingPairs.length
                } : null,
                falling: fallingModel ? {
                    ...fallingModel,
                    count: fallingPairs.length
                } : null,
                steady: steadyModel ? {
                    ...steadyModel,
                    count: steadyPairs.length
                } : null,
                hysteresisEffect: risingModel && fallingModel ? {
                    exponentDifference: Math.round((risingModel.b - fallingModel.b) * 1000) / 1000,
                    coefficientRatio: Math.round(risingModel.a / fallingModel.a * 100) / 100,
                    interpretation: Math.abs(risingModel.b - fallingModel.b) > 0.1 ?
                        'Significant hysteresis detected - rising/falling limbs behave differently' :
                        'Minimal hysteresis - single model may suffice'
                } : null
            },

            // Seasonal analysis
            seasonalAnalysis: {
                winter: winterModel ? {
                    ...winterModel,
                    months: 'Oct-Mar',
                    count: winterPairs.length
                } : null,
                summer: summerModel ? {
                    ...summerModel,
                    months: 'Apr-Sep',
                    count: summerPairs.length
                } : null,
                seasonalEffect: winterModel && summerModel ? {
                    exponentDifference: Math.round((winterModel.b - summerModel.b) * 1000) / 1000,
                    interpretation: Math.abs(winterModel.b - summerModel.b) > 0.1 ?
                        'Seasonal effect detected - consider separate models' :
                        'Minimal seasonal effect - single model OK'
                } : null
            },

            // Final recommended model
            recommendedModel: null,

            // Sample predictions for verification
            samplePredictions: [],

            // Recommendations
            recommendations: []
        };

        // Determine best model
        const candidates = [
            { name: 'overall_powerlaw', model: overallPowerLaw, r2: overallPowerLaw?.rSquaredOrig || 0 },
            { name: 'clean_powerlaw', model: cleanPowerLaw, r2: cleanPowerLaw?.rSquaredOrig || 0 }
        ];

        const best = candidates.reduce((a, b) => a.r2 > b.r2 ? a : b);

        result.recommendedModel = {
            type: best.name,
            ...best.model,
            useHysteresis: Math.abs((risingModel?.b || 0) - (fallingModel?.b || 0)) > 0.1,
            useSeasonal: Math.abs((winterModel?.b || 0) - (summerModel?.b || 0)) > 0.1
        };

        // Generate sample predictions
        const testStages = [3.0, 4.0, 5.0, 6.0, 8.0, 10.0, 12.0, 15.0];
        const model = best.model;
        if (model) {
            result.samplePredictions = testStages.map(stage => ({
                efStage: stage,
                predictedLF: Math.round(model.a * Math.pow(stage, model.b)),
                risingLF: risingModel ? Math.round(risingModel.a * Math.pow(stage, risingModel.b)) : null,
                fallingLF: fallingModel ? Math.round(fallingModel.a * Math.pow(stage, fallingModel.b)) : null
            }));
        }

        // Generate recommendations
        if (best.r2 >= 0.95) {
            result.recommendations.push('Excellent fit (R² ≥ 0.95). Model is highly reliable for production use.');
        } else if (best.r2 >= 0.90) {
            result.recommendations.push('Very good fit (R² ≥ 0.90). Suitable as primary or weighted estimator.');
        } else if (best.r2 >= 0.85) {
            result.recommendations.push('Good fit (R² ≥ 0.85). Suitable as secondary estimator or cross-check.');
        } else {
            result.recommendations.push('Moderate fit (R² < 0.85). Use as cross-check only, not primary estimator.');
        }

        if (result.recommendedModel.useHysteresis) {
            result.recommendations.push('Hysteresis is significant. Use rising/falling limb models for best accuracy.');
        }

        if (result.recommendedModel.useSeasonal) {
            result.recommendations.push('Seasonal effect detected. Consider winter/summer submodels.');
        }

        if (outlierAnalysis.outlierPct > 5) {
            result.recommendations.push(`${outlierAnalysis.outlierPct}% outliers detected. Review for sensor issues or unusual events.`);
        }

        const medianErr = best.model?.medianErrorPct || 0;
        if (medianErr < 10) {
            result.recommendations.push(`Median prediction error is ${medianErr}% - excellent accuracy.`);
        } else if (medianErr < 20) {
            result.recommendations.push(`Median prediction error is ${medianErr}% - good accuracy.`);
        } else {
            result.recommendations.push(`Median prediction error is ${medianErr}% - consider weighted ensemble with PoR model.`);
        }

        // Save to database if requested
        if (saveToDb && supabaseUrl && supabaseKey) {
            const client = createClient(supabaseUrl, supabaseKey);

            await client
                .from('potomac_observations')
                .upsert({
                    gauge_id: 'advanced_historical',
                    observation_type: 'ef_lf_correlation',
                    data: {
                        approach: 'limnologist',
                        recommended: result.recommendedModel,
                        hysteresis: {
                            rising: risingModel,
                            falling: fallingModel
                        },
                        seasonal: {
                            winter: winterModel,
                            summer: summerModel
                        },
                        outlierPct: outlierAnalysis.outlierPct,
                        dateRange: result.meta.dateRange,
                        totalPairs: allPairs.length,
                        generatedAt: result.meta.generatedAt
                    },
                    created_at: new Date().toISOString()
                }, {
                    onConflict: 'gauge_id,observation_type'
                });

            result.savedToDatabase = true;
            console.log('Saved advanced correlation model to database');
        }

        console.log('=== Analysis Complete ===');
        console.log(`Best model R² = ${best.r2}`);
        console.log(`Equation: ${best.model?.equation}`);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result, null, 2)
        };

    } catch (e) {
        console.error('Error in advanced correlation analysis:', e);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: e.message,
                stack: e.stack
            })
        };
    }
};

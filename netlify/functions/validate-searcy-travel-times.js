// Potomac Pulse - Searcy Travel Time Validation
// Empirically validates the Searcy (1961) PoR→LF travel time model using modern USGS data
//
// GET /.netlify/functions/validate-searcy-travel-times?months=6
//
// Searcy's original model (USGS Circular 438):
//   T_PoR_to_LF = 5174 × Q^(-0.5963) hours
//   where Q = discharge at Little Falls (cfs)
//
// This analysis:
// 1. Fetches 15-min instantaneous data for PoR and LF
// 2. Uses cross-correlation to find empirical travel times at different flow levels
// 3. Fits a power law to the empirical data
// 4. Compares against Searcy's 1961 coefficients
// 5. Produces updated multipliers if warranted

const POINT_OF_ROCKS_ID = '01638500';
const LITTLE_FALLS_ID = '01646500';

// Searcy's original model coefficients
const SEARCY_COEF = 5174;
const SEARCY_EXP = -0.5963;

// Calculate Searcy-predicted travel time
function searcyTravelTime(lfFlow) {
    return SEARCY_COEF * Math.pow(lfFlow, SEARCY_EXP);
}

exports.handler = async (event, context) => {
    console.log('=== Searcy Travel Time Validation ===');

    const months = parseInt(event.queryStringParameters?.months || '6');

    // Limit to 6 months max for instantaneous data (API limits)
    const effectiveMonths = Math.min(months, 6);

    console.log(`Fetching ${effectiveMonths} months of instantaneous data...`);

    try {
        // Calculate date range
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - effectiveMonths * 30 * 24 * 60 * 60 * 1000)
            .toISOString().split('T')[0];

        console.log(`Date range: ${startDate} to ${endDate}`);

        // Fetch instantaneous discharge data for both gauges
        // Parameter 00060 = Discharge (cfs)
        const porUrl = `https://nwis.waterservices.usgs.gov/nwis/iv/?format=json&sites=${POINT_OF_ROCKS_ID}&startDT=${startDate}&endDT=${endDate}&parameterCd=00060&siteStatus=all`;
        const lfUrl = `https://nwis.waterservices.usgs.gov/nwis/iv/?format=json&sites=${LITTLE_FALLS_ID}&startDT=${startDate}&endDT=${endDate}&parameterCd=00060&siteStatus=all`;

        console.log('Fetching USGS instantaneous data...');

        const [porResponse, lfResponse] = await Promise.all([
            fetch(porUrl),
            fetch(lfUrl)
        ]);

        if (!porResponse.ok || !lfResponse.ok) {
            throw new Error(`USGS fetch failed: PoR=${porResponse.status}, LF=${lfResponse.status}`);
        }

        const porData = await porResponse.json();
        const lfData = await lfResponse.json();

        // Extract time series
        const porTimeSeries = porData.value?.timeSeries?.[0]?.values?.[0]?.value || [];
        const lfTimeSeries = lfData.value?.timeSeries?.[0]?.values?.[0]?.value || [];

        console.log(`PoR raw data points: ${porTimeSeries.length}`);
        console.log(`LF raw data points: ${lfTimeSeries.length}`);

        if (porTimeSeries.length < 1000 || lfTimeSeries.length < 1000) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Insufficient data points' })
            };
        }

        // Build time-indexed maps (round to 15-min intervals)
        const porByTime = new Map();
        const porHistory = [];

        for (const point of porTimeSeries) {
            const flow = parseFloat(point.value);
            if (isNaN(flow) || flow <= 0) continue;

            const ts = new Date(point.dateTime).getTime();
            const rounded = Math.round(ts / (15 * 60 * 1000)) * (15 * 60 * 1000);

            porByTime.set(rounded, flow);
            porHistory.push({ timestamp: rounded, flow });
        }

        const lfByTime = new Map();

        for (const point of lfTimeSeries) {
            const flow = parseFloat(point.value);
            if (isNaN(flow) || flow <= 0) continue;

            const ts = new Date(point.dateTime).getTime();
            const rounded = Math.round(ts / (15 * 60 * 1000)) * (15 * 60 * 1000);

            lfByTime.set(rounded, flow);
        }

        console.log(`PoR valid readings: ${porHistory.length}`);
        console.log(`LF valid readings: ${lfByTime.size}`);

        // ==================== CROSS-CORRELATION ANALYSIS ====================
        // For each time shift, calculate correlation between PoR(t) and LF(t + shift)
        // The shift with maximum correlation is the empirical travel time

        console.log('Running cross-correlation analysis...');

        function calculateCorrelation(shiftMs) {
            const pairs = [];

            for (const por of porHistory) {
                const targetTime = por.timestamp + shiftMs;
                const roundedTarget = Math.round(targetTime / (15 * 60 * 1000)) * (15 * 60 * 1000);

                // Look for LF reading at target time (±15 min tolerance)
                let lfFlow = lfByTime.get(roundedTarget);
                if (!lfFlow) lfFlow = lfByTime.get(roundedTarget + 15 * 60 * 1000);
                if (!lfFlow) lfFlow = lfByTime.get(roundedTarget - 15 * 60 * 1000);
                if (!lfFlow) continue;

                pairs.push({ porFlow: por.flow, lfFlow, porTimestamp: por.timestamp });
            }

            if (pairs.length < 100) return { r: 0, n: pairs.length, pairs: [] };

            // Calculate Pearson correlation
            const n = pairs.length;
            let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

            for (const p of pairs) {
                sumX += p.porFlow;
                sumY += p.lfFlow;
                sumXY += p.porFlow * p.lfFlow;
                sumX2 += p.porFlow * p.porFlow;
                sumY2 += p.lfFlow * p.lfFlow;
            }

            const numerator = n * sumXY - sumX * sumY;
            const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

            const r = denominator > 0 ? numerator / denominator : 0;

            return { r, n, pairs };
        }

        // Test shifts from 10 to 60 hours in 30-min increments
        // (Searcy predicts ~13 hrs at flood to ~48 hrs at low flow)
        const shiftResults = [];
        let overallBestShift = 32;
        let overallBestR = 0;

        for (let shiftHrs = 10; shiftHrs <= 60; shiftHrs += 0.5) {
            const shiftMs = shiftHrs * 60 * 60 * 1000;
            const result = calculateCorrelation(shiftMs);

            shiftResults.push({
                shiftHrs,
                correlation: Math.round(result.r * 1000) / 1000,
                pairCount: result.n
            });

            if (result.r > overallBestR) {
                overallBestR = result.r;
                overallBestShift = shiftHrs;
            }
        }

        console.log(`Overall optimal shift: ${overallBestShift} hrs (r = ${overallBestR.toFixed(4)})`);

        // ==================== FLOW-REGIME ANALYSIS ====================
        // Find optimal travel times for different flow levels

        console.log('Analyzing travel times by flow regime...');

        // Categorize PoR readings by flow level
        const flowRegimes = [
            { name: 'very_low', min: 0, max: 3000, label: '<3k cfs' },
            { name: 'low', min: 3000, max: 6000, label: '3-6k cfs' },
            { name: 'medium', min: 6000, max: 12000, label: '6-12k cfs' },
            { name: 'high', min: 12000, max: 25000, label: '12-25k cfs' },
            { name: 'very_high', min: 25000, max: 50000, label: '25-50k cfs' },
            { name: 'flood', min: 50000, max: Infinity, label: '>50k cfs' }
        ];

        const regimeResults = {};

        for (const regime of flowRegimes) {
            // Filter PoR readings for this flow regime
            const regimeReadings = porHistory.filter(p =>
                p.flow >= regime.min && p.flow < regime.max
            );

            if (regimeReadings.length < 200) {
                regimeResults[regime.name] = {
                    label: regime.label,
                    count: regimeReadings.length,
                    status: 'insufficient_data'
                };
                continue;
            }

            // Find optimal shift for this regime
            let bestShift = overallBestShift;
            let bestR = 0;

            // Determine search range based on flow (higher flow = shorter travel)
            const avgFlow = (regime.min + Math.min(regime.max, 100000)) / 2;
            const searcyPredicted = searcyTravelTime(avgFlow);
            const searchMin = Math.max(8, searcyPredicted - 15);
            const searchMax = Math.min(72, searcyPredicted + 15);

            for (let shiftHrs = searchMin; shiftHrs <= searchMax; shiftHrs += 0.5) {
                const shiftMs = shiftHrs * 60 * 60 * 1000;

                // Calculate correlation using only readings from this regime
                const pairs = [];
                for (const por of regimeReadings) {
                    const targetTime = por.timestamp + shiftMs;
                    const roundedTarget = Math.round(targetTime / (15 * 60 * 1000)) * (15 * 60 * 1000);

                    let lfFlow = lfByTime.get(roundedTarget) ||
                                 lfByTime.get(roundedTarget + 15 * 60 * 1000) ||
                                 lfByTime.get(roundedTarget - 15 * 60 * 1000);
                    if (!lfFlow) continue;

                    pairs.push({ porFlow: por.flow, lfFlow });
                }

                if (pairs.length < 100) continue;

                // Calculate correlation
                const n = pairs.length;
                let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
                for (const p of pairs) {
                    sumX += p.porFlow;
                    sumY += p.lfFlow;
                    sumXY += p.porFlow * p.lfFlow;
                    sumX2 += p.porFlow * p.porFlow;
                    sumY2 += p.lfFlow * p.lfFlow;
                }

                const num = n * sumXY - sumX * sumY;
                const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
                const r = den > 0 ? num / den : 0;

                if (r > bestR) {
                    bestR = r;
                    bestShift = shiftHrs;
                }
            }

            // Calculate what Searcy predicts for this flow range
            const searcyLow = searcyTravelTime(regime.max);
            const searcyHigh = searcyTravelTime(regime.min || 1000);
            const searcyMid = searcyTravelTime((regime.min + Math.min(regime.max, 100000)) / 2);

            regimeResults[regime.name] = {
                label: regime.label,
                count: regimeReadings.length,
                empiricalTravelHrs: bestShift,
                correlation: Math.round(bestR * 1000) / 1000,
                searcyPredicted: {
                    lowEnd: Math.round(searcyLow * 10) / 10,
                    midpoint: Math.round(searcyMid * 10) / 10,
                    highEnd: Math.round(searcyHigh * 10) / 10
                },
                deviation: Math.round((bestShift - searcyMid) * 10) / 10,
                deviationPct: Math.round((bestShift - searcyMid) / searcyMid * 100)
            };
        }

        // ==================== FIT NEW POWER LAW ====================
        // Using empirical travel times at different flow levels, fit: T = a × Q^b

        console.log('Fitting empirical power law...');

        // Collect (flow, travel_time) pairs from regime results
        const empiricalPoints = [];
        for (const regime of flowRegimes) {
            const result = regimeResults[regime.name];
            if (result.status === 'insufficient_data') continue;

            // Use midpoint of flow range and empirical travel time
            const midFlow = (regime.min + Math.min(regime.max, 100000)) / 2;
            empiricalPoints.push({
                flow: midFlow,
                travelHrs: result.empiricalTravelHrs
            });
        }

        let empiricalModel = null;

        if (empiricalPoints.length >= 3) {
            // Fit power law in log space: ln(T) = ln(a) + b × ln(Q)
            const n = empiricalPoints.length;
            let sumLnQ = 0, sumLnT = 0, sumLnQLnT = 0, sumLnQ2 = 0;

            for (const p of empiricalPoints) {
                const lnQ = Math.log(p.flow);
                const lnT = Math.log(p.travelHrs);
                sumLnQ += lnQ;
                sumLnT += lnT;
                sumLnQLnT += lnQ * lnT;
                sumLnQ2 += lnQ * lnQ;
            }

            const b = (n * sumLnQLnT - sumLnQ * sumLnT) / (n * sumLnQ2 - sumLnQ * sumLnQ);
            const lnA = (sumLnT - b * sumLnQ) / n;
            const a = Math.exp(lnA);

            // Calculate R² for the fit
            const meanLnT = sumLnT / n;
            let ssRes = 0, ssTot = 0;
            for (const p of empiricalPoints) {
                const lnQ = Math.log(p.flow);
                const lnT = Math.log(p.travelHrs);
                const predictedLnT = lnA + b * lnQ;
                ssRes += Math.pow(lnT - predictedLnT, 2);
                ssTot += Math.pow(lnT - meanLnT, 2);
            }
            const rSquared = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;

            empiricalModel = {
                equation: `T = ${Math.round(a)} × Q^(${b.toFixed(4)})`,
                coefficient: Math.round(a),
                exponent: Math.round(b * 10000) / 10000,
                rSquared: Math.round(rSquared * 1000) / 1000,
                samplePredictions: [
                    { flow: 3000, predicted: Math.round(a * Math.pow(3000, b) * 10) / 10 },
                    { flow: 5000, predicted: Math.round(a * Math.pow(5000, b) * 10) / 10 },
                    { flow: 10000, predicted: Math.round(a * Math.pow(10000, b) * 10) / 10 },
                    { flow: 20000, predicted: Math.round(a * Math.pow(20000, b) * 10) / 10 },
                    { flow: 50000, predicted: Math.round(a * Math.pow(50000, b) * 10) / 10 }
                ]
            };
        }

        // ==================== COMPARISON & RECOMMENDATIONS ====================

        const searcyModel = {
            equation: `T = ${SEARCY_COEF} × Q^(${SEARCY_EXP})`,
            coefficient: SEARCY_COEF,
            exponent: SEARCY_EXP,
            samplePredictions: [
                { flow: 3000, predicted: Math.round(searcyTravelTime(3000) * 10) / 10 },
                { flow: 5000, predicted: Math.round(searcyTravelTime(5000) * 10) / 10 },
                { flow: 10000, predicted: Math.round(searcyTravelTime(10000) * 10) / 10 },
                { flow: 20000, predicted: Math.round(searcyTravelTime(20000) * 10) / 10 },
                { flow: 50000, predicted: Math.round(searcyTravelTime(50000) * 10) / 10 }
            ]
        };

        // Generate comparison table
        const comparisonTable = [];
        for (const flow of [3000, 5000, 10000, 20000, 50000]) {
            const searcyPred = searcyTravelTime(flow);
            const empiricalPred = empiricalModel ?
                empiricalModel.coefficient * Math.pow(flow, empiricalModel.exponent) : null;

            comparisonTable.push({
                flow,
                searcy: Math.round(searcyPred * 10) / 10,
                empirical: empiricalPred ? Math.round(empiricalPred * 10) / 10 : 'N/A',
                difference: empiricalPred ? Math.round((empiricalPred - searcyPred) * 10) / 10 : 'N/A',
                pctDiff: empiricalPred ? Math.round((empiricalPred - searcyPred) / searcyPred * 100) : 'N/A'
            });
        }

        // Generate recommendations
        const recommendations = [];

        if (empiricalModel) {
            const coefDiff = Math.abs(empiricalModel.coefficient - SEARCY_COEF) / SEARCY_COEF;
            const expDiff = Math.abs(empiricalModel.exponent - SEARCY_EXP) / Math.abs(SEARCY_EXP);

            if (coefDiff < 0.15 && expDiff < 0.15) {
                recommendations.push('Searcy model validated: empirical coefficients within 15% of 1961 values');
                recommendations.push('No changes recommended - continue using Searcy power law');
            } else if (coefDiff < 0.30 && expDiff < 0.30) {
                recommendations.push('Moderate deviation from Searcy model detected (15-30%)');
                recommendations.push('Consider using empirical coefficients for improved accuracy');
                recommendations.push(`Suggested update: T = ${empiricalModel.coefficient} × Q^(${empiricalModel.exponent})`);
            } else {
                recommendations.push('Significant deviation from Searcy model (>30%)');
                recommendations.push('Strongly recommend updating to empirical model');
                recommendations.push(`New model: T = ${empiricalModel.coefficient} × Q^(${empiricalModel.exponent})`);
            }

            if (empiricalModel.rSquared >= 0.95) {
                recommendations.push(`Empirical model fit is excellent (R² = ${empiricalModel.rSquared})`);
            } else if (empiricalModel.rSquared >= 0.85) {
                recommendations.push(`Empirical model fit is good (R² = ${empiricalModel.rSquared})`);
            } else {
                recommendations.push(`Empirical model fit is moderate (R² = ${empiricalModel.rSquared}) - more data may help`);
            }
        } else {
            recommendations.push('Insufficient data to fit empirical model');
            recommendations.push('Continue using Searcy model, collect more data across flow regimes');
        }

        // Calculate multiplier for app integration
        let multiplierUpdate = null;
        if (empiricalModel && empiricalModel.rSquared >= 0.85) {
            multiplierUpdate = {
                currentBaseHrs: 32,  // Current Searcy baseline at median flow
                empiricalBaseHrs: Math.round(empiricalModel.coefficient * Math.pow(5000, empiricalModel.exponent) * 10) / 10,
                multiplierAdjustment: Math.round(
                    (empiricalModel.coefficient * Math.pow(5000, empiricalModel.exponent)) /
                    searcyTravelTime(5000) * 100
                ) / 100,
                note: 'Multiply current travel times by this factor for empirical accuracy'
            };
        }

        // Build result
        const result = {
            meta: {
                generatedAt: new Date().toISOString(),
                dateRange: { start: startDate, end: endDate },
                monthsAnalyzed: effectiveMonths,
                dataQuality: {
                    porPoints: porHistory.length,
                    lfPoints: lfByTime.size,
                    overallCorrelation: Math.round(overallBestR * 1000) / 1000
                }
            },

            searcyModel: searcyModel,
            empiricalModel: empiricalModel,

            comparisonTable: comparisonTable,

            byFlowRegime: regimeResults,

            recommendations: recommendations,

            multiplierUpdate: multiplierUpdate,

            // For charting: shift sweep results (every 2 hours)
            correlationSweep: shiftResults.filter((_, i) => i % 4 === 0)
        };

        console.log('=== Analysis Complete ===');
        console.log(`Searcy: T = ${SEARCY_COEF} × Q^(${SEARCY_EXP})`);
        if (empiricalModel) {
            console.log(`Empirical: ${empiricalModel.equation}`);
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result, null, 2)
        };

    } catch (e) {
        console.error('Validation error:', e);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: e.message })
        };
    }
};

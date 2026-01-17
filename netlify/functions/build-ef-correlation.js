// Potomac Pulse - Historical EF→LF Correlation Builder
// Fetches years of USGS data to build a robust Edwards Ferry → Little Falls correlation
// GET /.netlify/functions/build-ef-correlation?months=12
//
// Edwards Ferry (01644148): Stage only, 11,130 mi² drainage (96.3% of LF)
// Little Falls (01646500): Stage + Discharge, 11,560 mi² drainage
//
// Travel time EF→LF is ~2-4 hours depending on flow

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

const EDWARDS_FERRY_ID = '01644148';
const LITTLE_FALLS_ID = '01646500';

// Estimated travel time from EF to LF (hours) based on flow
function estimateTravelTime(lfFlow) {
    // Higher flow = faster travel
    if (lfFlow > 50000) return 1.5;
    if (lfFlow > 20000) return 2;
    if (lfFlow > 10000) return 2.5;
    if (lfFlow > 5000) return 3;
    return 4;
}

exports.handler = async (event, context) => {
    console.log('=== Building Historical EF→LF Correlation ===');

    const months = parseInt(event.queryStringParameters?.months || '12');
    const saveToDb = event.queryStringParameters?.save === 'true';

    console.log(`Fetching ${months} months of historical data...`);

    try {
        // Fetch historical data from USGS
        // Using daily values (dv) for long-term analysis - more manageable data size
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000)
            .toISOString().split('T')[0];

        console.log(`Date range: ${startDate} to ${endDate}`);

        // Fetch Edwards Ferry stage (daily values)
        const efUrl = `https://nwis.waterservices.usgs.gov/nwis/dv/?format=json&sites=${EDWARDS_FERRY_ID}&startDT=${startDate}&endDT=${endDate}&parameterCd=00065&siteStatus=all`;

        // Fetch Little Falls discharge (daily values)
        const lfUrl = `https://nwis.waterservices.usgs.gov/nwis/dv/?format=json&sites=${LITTLE_FALLS_ID}&startDT=${startDate}&endDT=${endDate}&parameterCd=00060&siteStatus=all`;

        console.log('Fetching USGS data...');

        const [efResponse, lfResponse] = await Promise.all([
            fetch(efUrl),
            fetch(lfUrl)
        ]);

        if (!efResponse.ok || !lfResponse.ok) {
            throw new Error(`USGS fetch failed: EF=${efResponse.status}, LF=${lfResponse.status}`);
        }

        const efData = await efResponse.json();
        const lfData = await lfResponse.json();

        // Extract time series
        const efTimeSeries = efData.value?.timeSeries?.[0]?.values?.[0]?.value || [];
        const lfTimeSeries = lfData.value?.timeSeries?.[0]?.values?.[0]?.value || [];

        console.log(`EF data points: ${efTimeSeries.length}`);
        console.log(`LF data points: ${lfTimeSeries.length}`);

        if (efTimeSeries.length < 30 || lfTimeSeries.length < 30) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Insufficient historical data' })
            };
        }

        // Build lookup maps by date
        const efByDate = {};
        for (const point of efTimeSeries) {
            const date = point.dateTime.split('T')[0];
            const stage = parseFloat(point.value);
            if (!isNaN(stage) && stage > 0) {
                efByDate[date] = stage;
            }
        }

        const lfByDate = {};
        for (const point of lfTimeSeries) {
            const date = point.dateTime.split('T')[0];
            const flow = parseFloat(point.value);
            if (!isNaN(flow) && flow > 0) {
                lfByDate[date] = flow;
            }
        }

        // Match EF stage with same-day LF discharge
        // (Daily values average out the travel time difference)
        const pairs = [];
        for (const date in efByDate) {
            if (lfByDate[date]) {
                pairs.push({
                    date,
                    efStage: efByDate[date],
                    lfFlow: lfByDate[date]
                });
            }
        }

        console.log(`Matched pairs: ${pairs.length}`);

        if (pairs.length < 30) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Insufficient matched data pairs' })
            };
        }

        // Sort by date
        pairs.sort((a, b) => a.date.localeCompare(b.date));

        // Calculate linear regression: LF_flow = slope * EF_stage + intercept
        const n = pairs.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

        for (const p of pairs) {
            sumX += p.efStage;
            sumY += p.lfFlow;
            sumXY += p.efStage * p.lfFlow;
            sumX2 += p.efStage * p.efStage;
            sumY2 += p.lfFlow * p.lfFlow;
        }

        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        // R² calculation
        const meanY = sumY / n;
        let ssRes = 0, ssTot = 0;

        for (const p of pairs) {
            const predicted = slope * p.efStage + intercept;
            ssRes += Math.pow(p.lfFlow - predicted, 2);
            ssTot += Math.pow(p.lfFlow - meanY, 2);
        }

        const rSquared = 1 - (ssRes / ssTot);

        // Calculate prediction errors
        const errors = pairs.map(p => {
            const predicted = slope * p.efStage + intercept;
            return {
                date: p.date,
                actual: p.lfFlow,
                predicted: Math.round(predicted),
                error: Math.round(p.lfFlow - predicted),
                errorPct: Math.round((p.lfFlow - predicted) / p.lfFlow * 100)
            };
        });

        const absErrors = errors.map(e => Math.abs(e.errorPct));
        const meanAbsError = absErrors.reduce((a, b) => a + b, 0) / absErrors.length;
        const medianAbsError = absErrors.sort((a, b) => a - b)[Math.floor(absErrors.length / 2)];

        // Analyze by flow regime
        const flowBins = {
            'low_0_5k': pairs.filter(p => p.lfFlow < 5000),
            'med_5k_15k': pairs.filter(p => p.lfFlow >= 5000 && p.lfFlow < 15000),
            'high_15k_50k': pairs.filter(p => p.lfFlow >= 15000 && p.lfFlow < 50000),
            'flood_50k_plus': pairs.filter(p => p.lfFlow >= 50000)
        };

        const binAnalysis = {};
        for (const [binName, binPairs] of Object.entries(flowBins)) {
            if (binPairs.length >= 5) {
                // Calculate R² for this bin
                let binSumX = 0, binSumY = 0, binSumXY = 0, binSumX2 = 0;
                for (const p of binPairs) {
                    binSumX += p.efStage;
                    binSumY += p.lfFlow;
                    binSumXY += p.efStage * p.lfFlow;
                    binSumX2 += p.efStage * p.efStage;
                }
                const binN = binPairs.length;
                const binSlope = (binN * binSumXY - binSumX * binSumY) / (binN * binSumX2 - binSumX * binSumX);
                const binIntercept = (binSumY - binSlope * binSumX) / binN;

                const binMeanY = binSumY / binN;
                let binSsRes = 0, binSsTot = 0;
                for (const p of binPairs) {
                    const pred = binSlope * p.efStage + binIntercept;
                    binSsRes += Math.pow(p.lfFlow - pred, 2);
                    binSsTot += Math.pow(p.lfFlow - binMeanY, 2);
                }

                binAnalysis[binName] = {
                    count: binPairs.length,
                    stageRange: [
                        Math.round(Math.min(...binPairs.map(p => p.efStage)) * 100) / 100,
                        Math.round(Math.max(...binPairs.map(p => p.efStage)) * 100) / 100
                    ],
                    flowRange: [
                        Math.round(Math.min(...binPairs.map(p => p.lfFlow))),
                        Math.round(Math.max(...binPairs.map(p => p.lfFlow)))
                    ],
                    slope: Math.round(binSlope),
                    intercept: Math.round(binIntercept),
                    rSquared: binSsTot > 0 ? Math.round((1 - binSsRes / binSsTot) * 1000) / 1000 : 0
                };
            }
        }

        // Build result
        const result = {
            meta: {
                generatedAt: new Date().toISOString(),
                dateRange: { start: startDate, end: endDate },
                monthsAnalyzed: months,
                totalPairs: pairs.length
            },
            overallModel: {
                equation: `LF_cfs = ${Math.round(slope)} × EF_stage + ${Math.round(intercept)}`,
                slope: Math.round(slope * 10) / 10,
                intercept: Math.round(intercept),
                rSquared: Math.round(rSquared * 1000) / 1000,
                interpretation: rSquared >= 0.95 ? 'Excellent fit' :
                               rSquared >= 0.90 ? 'Very good fit' :
                               rSquared >= 0.80 ? 'Good fit' :
                               rSquared >= 0.70 ? 'Moderate fit' : 'Weak fit'
            },
            accuracy: {
                meanAbsoluteErrorPct: Math.round(meanAbsError * 10) / 10,
                medianAbsoluteErrorPct: Math.round(medianAbsError * 10) / 10
            },
            flowRegimeAnalysis: binAnalysis,
            recommendations: [],
            samplePredictions: [
                { efStage: 3.0, predictedLF: Math.round(slope * 3.0 + intercept) },
                { efStage: 4.0, predictedLF: Math.round(slope * 4.0 + intercept) },
                { efStage: 5.0, predictedLF: Math.round(slope * 5.0 + intercept) },
                { efStage: 6.0, predictedLF: Math.round(slope * 6.0 + intercept) },
                { efStage: 8.0, predictedLF: Math.round(slope * 8.0 + intercept) },
                { efStage: 10.0, predictedLF: Math.round(slope * 10.0 + intercept) }
            ]
        };

        // Add recommendations
        if (rSquared >= 0.90) {
            result.recommendations.push('R² ≥ 0.90: EF→LF correlation is strong enough to use as primary estimator');
            result.recommendations.push('Consider weighted ensemble: GF = 0.6×(PoR model) + 0.4×(EF model)');
        } else if (rSquared >= 0.80) {
            result.recommendations.push('R² ≥ 0.80: Good correlation, useful as cross-check and secondary estimator');
        } else {
            result.recommendations.push('R² < 0.80: Correlation is moderate. Use only as cross-check, not primary estimator');
        }

        // Check if different flow regimes need different models
        const binR2s = Object.values(binAnalysis).map(b => b.rSquared);
        if (binR2s.length >= 3 && Math.max(...binR2s) - Math.min(...binR2s) > 0.1) {
            result.recommendations.push('Flow regime R² varies significantly. Consider piecewise model for different flow levels');
        }

        // Save to database if requested
        if (saveToDb && supabaseUrl && supabaseKey) {
            const client = createClient(supabaseUrl, supabaseKey);

            await client
                .from('potomac_observations')
                .upsert({
                    gauge_id: 'historical',
                    observation_type: 'ef_lf_correlation',
                    data: {
                        slope: result.overallModel.slope,
                        intercept: result.overallModel.intercept,
                        rSquared: result.overallModel.rSquared,
                        count: pairs.length,
                        dateRange: result.meta.dateRange,
                        flowRegimes: binAnalysis,
                        generatedAt: result.meta.generatedAt
                    },
                    created_at: new Date().toISOString()
                }, {
                    onConflict: 'gauge_id,observation_type'
                });

            result.savedToDatabase = true;
            console.log('Saved correlation model to database');
        }

        console.log('=== Analysis Complete ===');
        console.log(`R² = ${result.overallModel.rSquared}`);
        console.log(`Equation: ${result.overallModel.equation}`);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result, null, 2)
        };

    } catch (e) {
        console.error('Error building correlation:', e);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: e.message })
        };
    }
};

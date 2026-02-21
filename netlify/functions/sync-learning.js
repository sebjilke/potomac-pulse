// Potomac Forecaster - Secure Supabase Sync Function
// Handles learning data sync without exposing credentials to client

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase with service role key (from environment variables)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

// Admin PIN from environment variable (defaults to legacy value if not set)
const ADMIN_PIN = process.env.ADMIN_PIN || '1506';

let supabase = null;

function getSupabase() {
    if (!supabase && supabaseUrl && supabaseKey) {
        supabase = createClient(supabaseUrl, supabaseKey);
    }
    return supabase;
}

// CORS headers for browser requests
const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
    // Handle preflight CORS requests
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    const client = getSupabase();
    if (!client) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Supabase not configured' })
        };
    }

    // Parse query parameters for endpoint routing
    const params = event.queryStringParameters || {};
    const endpoint = params.endpoint || 'learning';

    try {
        // Route to appropriate handler based on endpoint
        if (endpoint === 'gf') {
            // Great Falls learning endpoints
            if (event.httpMethod === 'GET') {
                return await loadGFLearningData(client);
            }
            if (event.httpMethod === 'POST') {
                const body = JSON.parse(event.body || '{}');
                return await saveGFLearningData(client, body);
            }
        }

        // Forecast accuracy endpoint
        if (endpoint === 'forecast-accuracy') {
            if (event.httpMethod === 'GET') {
                return await loadForecastAccuracy(client);
            }
        }

        // Default: Original learning endpoints
        if (event.httpMethod === 'GET') {
            return await loadLearningData(client);
        }

        if (event.httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            return await saveLearningData(client, body);
        }

        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };

    } catch (error) {
        console.error('Sync error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};

// Load learning data from Supabase
async function loadLearningData(client) {
    try {
        // Load corrections
        const { data: corrections, error: corrErr } = await client
            .from('potomac_observations')
            .select('gauge_id, data')
            .eq('observation_type', 'correction');

        if (corrErr) throw corrErr;

        // Load recent observations (last 2000)
        const { data: observations, error: obsErr } = await client
            .from('potomac_observations')
            .select('gauge_id, data, created_at')
            .eq('observation_type', 'observation')
            .order('created_at', { ascending: false })
            .limit(2000);

        if (obsErr) throw obsErr;

        // Load metadata
        const { data: meta, error: metaErr } = await client
            .from('potomac_observations')
            .select('data')
            .eq('observation_type', 'metadata')
            .eq('gauge_id', 'system')
            .single();

        // Build learning data structure
        const learningData = {
            startDate: meta?.data?.startDate || new Date().toISOString(),
            observations: {},
            corrections: {},
            totalObs: meta?.data?.totalObs || 0
        };

        // Process corrections
        if (corrections) {
            corrections.forEach(c => {
                if (c.data?.correction_factor) {
                    learningData.corrections[c.gauge_id] = c.data.correction_factor;
                }
            });
        }

        // Process observations (group by gauge)
        if (observations) {
            observations.forEach(o => {
                if (!learningData.observations[o.gauge_id]) {
                    learningData.observations[o.gauge_id] = [];
                }
                if (o.data) {
                    learningData.observations[o.gauge_id].push(o.data);
                }
            });
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(learningData)
        };

    } catch (error) {
        console.error('Load error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to load learning data' })
        };
    }
}

// Save learning data to Supabase
async function saveLearningData(client, data) {
    try {
        const { metadata, corrections, observations, lastSyncTime } = data;

        // Validate input structure
        if (!metadata && !corrections && !observations) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'No data provided' })
            };
        }

        let savedCount = 0;

        // Save metadata
        if (metadata) {
            const { error } = await client.from('potomac_observations').upsert({
                observation_type: 'metadata',
                gauge_id: 'system',
                data: {
                    startDate: metadata.startDate,
                    totalObs: metadata.totalObs,
                    lastSync: new Date().toISOString()
                }
            }, { onConflict: 'observation_type,gauge_id' });

            if (error) {
                console.error('Metadata save error:', error);
            } else {
                savedCount++;
            }
        }

        // Save corrections
        if (corrections && typeof corrections === 'object') {
            for (const [gaugeId, factor] of Object.entries(corrections)) {
                // Validate correction factor is a reasonable number
                if (typeof factor === 'number' && factor > 0.1 && factor < 10) {
                    const { error } = await client.from('potomac_observations').upsert({
                        observation_type: 'correction',
                        gauge_id: gaugeId,
                        data: { correction_factor: factor }
                    }, { onConflict: 'observation_type,gauge_id' });

                    if (!error) savedCount++;
                }
            }
        }

        // Save new observations
        if (observations && Array.isArray(observations) && observations.length > 0) {
            // Limit to 100 observations per sync to prevent abuse
            const limitedObs = observations.slice(0, 100);

            const records = limitedObs.map(o => ({
                observation_type: 'observation',
                gauge_id: o.gauge_id,
                data: o.data
            }));

            const { error } = await client.from('potomac_observations').insert(records);

            if (!error) {
                savedCount += records.length;
            } else {
                console.error('Observations save error:', error);
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                savedCount,
                syncTime: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Save error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to save learning data' })
        };
    }
}

// ==================== GREAT FALLS LEARNING ====================
// Handles GF predictions, validations, and correction bins

// Flow bins for GF learning corrections
// NOTE: This must match getGFFlowBin() in index.html client code
const GF_FLOW_BINS = ['0-3000', '3000-6000', '6000-12000', '12000-25000', '25000-50000', '50000+'];

// Estimate LF flow from stage (inverse rating curve)
// Used for ice/anomaly detection - if actual CFS is much lower than expected from stage,
// likely indicates frazil ice affecting ADVM velocity measurement
// SYNC WARNING: This function is duplicated in scheduled-update.js and index.html. Keep all in sync!
function estimateLFFlowFromStage(stage) {
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

function getFlowBin(cfs) {
    if (cfs < 3000) return '0-3000';
    if (cfs < 6000) return '3000-6000';
    if (cfs < 12000) return '6000-12000';
    if (cfs < 25000) return '12000-25000';
    if (cfs < 50000) return '25000-50000';
    return '50000+';
}

// Load GF learning data from Supabase
async function loadGFLearningData(client) {
    try {
        // Load correction bins
        const { data: bins, error: binErr } = await client
            .from('potomac_observations')
            .select('gauge_id, data')
            .eq('observation_type', 'gf_correction_bin');

        if (binErr) throw binErr;

        // Load pending predictions (not yet validated)
        const { data: pending, error: pendErr } = await client
            .from('potomac_observations')
            .select('gauge_id, data, created_at')
            .eq('observation_type', 'gf_prediction')
            .eq('gauge_id', 'pending')
            .order('created_at', { ascending: false })
            .limit(50);

        if (pendErr) throw pendErr;

        // Load GF metadata (total validations, accuracy stats)
        const { data: meta, error: metaErr } = await client
            .from('potomac_observations')
            .select('data')
            .eq('observation_type', 'gf_metadata')
            .eq('gauge_id', 'system')
            .single();

        // Load Edwards Ferry to GF correlation
        const { data: efCorr, error: efErr } = await client
            .from('potomac_observations')
            .select('data')
            .eq('observation_type', 'ef_gf_correlation')
            .eq('gauge_id', 'system')
            .single();

        // Build correction bins structure
        const correctionBins = {};
        GF_FLOW_BINS.forEach(bin => {
            correctionBins[bin] = {
                rising: { count: 0, sumError: 0, sumErrorSq: 0, meanError: 0 },
                falling: { count: 0, sumError: 0, sumErrorSq: 0, meanError: 0 },
                steady: { count: 0, sumError: 0, sumErrorSq: 0, meanError: 0 }
            };
        });

        // Populate from database
        if (bins) {
            bins.forEach(b => {
                const [flowBin, flowState] = b.gauge_id.split('_');
                if (correctionBins[flowBin] && correctionBins[flowBin][flowState]) {
                    correctionBins[flowBin][flowState] = b.data;
                }
            });
        }

        // Build pending predictions array
        const pendingPredictions = (pending || []).map(p => ({
            ...p.data,
            created_at: p.created_at
        }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                correctionBins,
                pendingPredictions,
                metadata: meta?.data || {
                    totalValidations: 0,
                    totalPredictions: 0,
                    avgErrorPercent: null,
                    lastValidation: null
                },
                efCorrelation: efCorr?.data || null  // Edwards Ferry stage to GF CFS correlation
            })
        };

    } catch (error) {
        console.error('Load GF error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to load GF learning data' })
        };
    }
}

// Save GF learning data to Supabase
async function saveGFLearningData(client, data) {
    try {
        const { action } = data;
        let result = { success: false };

        // Action: Store a new prediction
        if (action === 'storePrediction') {
            const { prediction } = data;
            if (!prediction) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'No prediction provided' }) };
            }

            const { error } = await client.from('potomac_observations').insert({
                observation_type: 'gf_prediction',
                gauge_id: 'pending',
                data: {
                    timestamp: prediction.timestamp,
                    predictedCFS: prediction.predictedCFS,
                    porCFS: prediction.porCFS,
                    monocacyCFS: prediction.monocacyCFS,
                    gooseCFS: prediction.gooseCFS,
                    flowBin: prediction.flowBin,
                    flowState: prediction.flowState,
                    travelTimeGFtoLF: prediction.travelTimeGFtoLF,
                    validationDue: prediction.validationDue,
                    efStage: prediction.efStage || null  // Edwards Ferry stage at prediction time
                }
            });

            if (error) throw error;
            result = { success: true, action: 'storePrediction' };
        }

        // Action: Store 48h forecast predictions for accuracy tracking
        if (action === 'storeForecastPredictions') {
            const { forecasts } = data;
            if (!forecasts || !Array.isArray(forecasts)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'No forecasts provided' }) };
            }

            // Store each forecast as a pending prediction
            // Use unique gauge_id with timestamp to allow multiple forecasts per horizon
            const timestamp = Date.now();
            const insertData = forecasts.filter(f => f && typeof f === 'object' && f.horizon && f.targetTime).map(f => ({
                observation_type: 'gf_forecast_pending',
                gauge_id: `+${f.horizon}h_${timestamp}`,
                data: {
                    horizon: f.horizon,  // Store horizon in data for validation lookup
                    targetTime: f.targetTime,
                    predictedCFS: f.predictedCFS,
                    predictedStage: f.predictedStage,
                    source: f.source,
                    createdAt: f.createdAt
                }
            }));

            const { error } = await client.from('potomac_observations').insert(insertData);
            if (error) {
                console.error('Forecast insert error:', error);
                throw error;
            }

            console.log(`📈 Stored ${forecasts.length} forecast predictions for accuracy tracking`);
            result = { success: true, action: 'storeForecastPredictions', count: forecasts.length };
        }

        // Action: Record a validation (compare prediction to actual)
        if (action === 'recordValidation') {
            const { predictionId, actualCFS, lfCFS, senecaCFS, actualStage, efEstimateCFS } = data;

            // Sanity check: Reject validation if actualCFS is unrealistic
            // (gauge malfunction, freezing, or data error)
            if (!actualCFS || actualCFS < 500 || actualCFS > 500000) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Invalid actualCFS value',
                        reason: 'Outside valid range (500-500k cfs) - possible gauge malfunction'
                    })
                };
            }

            // Get the pending prediction
            const { data: predictions, error: fetchErr } = await client
                .from('potomac_observations')
                .select('id, data')
                .eq('observation_type', 'gf_prediction')
                .eq('gauge_id', 'pending')
                .order('created_at', { ascending: true })
                .limit(1);

            if (fetchErr) throw fetchErr;

            if (predictions && predictions.length > 0) {
                const pred = predictions[0];
                const predictedCFS = pred.data.predictedCFS;
                const errorCFS = predictedCFS - actualCFS;
                const errorPercent = (errorCFS / actualCFS) * 100;
                const flowBin = pred.data.flowBin;
                const flowState = pred.data.flowState || 'steady';

                // ============================================
                // ICE/ANOMALY DETECTION (v24.1)
                // Uses multiple signals to detect suspicious readings
                // When flagged, skip learning but still record validation
                // Thresholds aligned with scheduled-update.js
                // ============================================
                let suspiciousScore = 0;
                const anomalyFlags = [];

                // Check 1: EF cross-check (if EF estimate available)
                const efEstimate = efEstimateCFS || pred.data.efEstimateCFS;
                if (efEstimate && actualCFS) {
                    const efDiscrepancy = (efEstimate - actualCFS) / actualCFS;
                    if (efDiscrepancy > 0.30) {
                        suspiciousScore += 2;
                        anomalyFlags.push(`EF_DISCREPANCY:${(efDiscrepancy * 100).toFixed(0)}%`);
                    }
                }

                // Check 2: Stage-discharge inconsistency (v24.1: lowered from 50% to 35%)
                if (actualStage && actualCFS) {
                    const expectedFlowFromStage = estimateLFFlowFromStage(actualStage);
                    if (expectedFlowFromStage > 0) {
                        const stageDiscrepancy = (expectedFlowFromStage - actualCFS) / actualCFS;
                        if (stageDiscrepancy > 0.35) {
                            suspiciousScore += 2;
                            anomalyFlags.push(`STAGE_DISCHARGE:expected=${Math.round(expectedFlowFromStage)},actual=${Math.round(actualCFS)},disc=${(stageDiscrepancy*100).toFixed(0)}%`);
                        }
                    }
                }

                // Check 3: Low flow sanity check (v24.1: raised from 1000 to 1500 cfs, lowered stage from 2.50 to 2.45)
                if (actualCFS < 1500 && actualStage > 2.45) {
                    suspiciousScore += 1;
                    anomalyFlags.push(`LOW_FLOW_HIGH_STAGE:${Math.round(actualCFS)}cfs@${actualStage}ft`);
                }

                // Check 4: Large prediction error (v24.1: new check)
                if (Math.abs(errorPercent) > 50) {
                    suspiciousScore += 1;
                    anomalyFlags.push(`LARGE_ERROR:${errorPercent.toFixed(0)}%`);
                }

                const isSuspicious = suspiciousScore >= 2;
                if (isSuspicious) {
                    console.log(`🧊 ANOMALY DETECTED (score=${suspiciousScore}): ${anomalyFlags.join(', ')}`);
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

                // Outlier detection (skip if error is > 3 std devs from mean)
                const EMA_ALPHA = 0.3;
                const OUTLIER_THRESHOLD = 3;
                let isOutlier = false;

                if (binData.count >= 10) {
                    const variance = (binData.sumErrorSq / binData.count) - (binData.meanError * binData.meanError);
                    const stdDev = Math.sqrt(Math.max(0, variance));
                    if (stdDev > 0) {
                        const zScore = Math.abs((errorCFS - binData.meanError) / stdDev);
                        isOutlier = zScore > OUTLIER_THRESHOLD;
                        if (isOutlier) {
                            suspiciousScore += 2;
                            anomalyFlags.push(`STATISTICAL_OUTLIER:z=${zScore.toFixed(1)}`);
                        }
                    }
                }

                // Final determination
                const skipLearning = isSuspicious || isOutlier;

                // Only update learning if not suspicious/outlier
                if (!skipLearning) {
                    binData.count += 1;
                    binData.sumError += errorCFS;
                    binData.sumErrorSq += errorCFS * errorCFS;
                    binData.meanError = binData.sumError / binData.count;

                    // Update EMA (exponential moving average)
                    if (binData.count === 1) {
                        binData.emaMeanError = errorCFS;
                    } else {
                        binData.emaMeanError = EMA_ALPHA * errorCFS + (1 - EMA_ALPHA) * (binData.emaMeanError || binData.meanError);
                    }
                }

                await client.from('potomac_observations').upsert({
                    observation_type: 'gf_correction_bin',
                    gauge_id: binKey,
                    data: binData
                }, { onConflict: 'observation_type,gauge_id' });

                // Update Edwards Ferry to GF CFS correlation (if we have EF stage data)
                const efStage = pred.data.efStage;
                if (efStage && actualCFS) {
                    // Load existing correlation data
                    const { data: efCorr } = await client
                        .from('potomac_observations')
                        .select('data')
                        .eq('observation_type', 'ef_gf_correlation')
                        .eq('gauge_id', 'system')
                        .single();

                    const corrData = efCorr?.data || {
                        points: [],      // Array of {stage, cfs} pairs
                        count: 0,
                        sumStage: 0,
                        sumCFS: 0,
                        sumStageCFS: 0,  // For linear regression
                        sumStageSq: 0
                    };

                    // Add new data point (keep last 200 points)
                    corrData.points.push({ stage: efStage, cfs: actualCFS, timestamp: new Date().toISOString() });
                    if (corrData.points.length > 200) {
                        corrData.points = corrData.points.slice(-200);
                    }

                    // Update running sums for linear regression
                    corrData.count += 1;
                    corrData.sumStage += efStage;
                    corrData.sumCFS += actualCFS;
                    corrData.sumStageCFS += efStage * actualCFS;
                    corrData.sumStageSq += efStage * efStage;

                    // Calculate linear regression: CFS = slope * stage + intercept
                    if (corrData.count >= 5) {
                        const n = corrData.count;
                        const slope = (n * corrData.sumStageCFS - corrData.sumStage * corrData.sumCFS) /
                                      (n * corrData.sumStageSq - corrData.sumStage * corrData.sumStage);
                        const intercept = (corrData.sumCFS - slope * corrData.sumStage) / n;
                        corrData.slope = slope;
                        corrData.intercept = intercept;
                    }

                    await client.from('potomac_observations').upsert({
                        observation_type: 'ef_gf_correlation',
                        gauge_id: 'system',
                        data: corrData
                    }, { onConflict: 'observation_type,gauge_id' });
                }

                // Move prediction from pending to validated/flagged
                await client.from('potomac_observations').update({
                    gauge_id: skipLearning ? 'flagged' : 'validated',
                    data: {
                        ...pred.data,
                        actualCFS,
                        actualStage,
                        errorCFS,
                        errorPercent,
                        validatedAt: new Date().toISOString(),
                        isOutlier,
                        // v24 anomaly detection fields
                        isSuspicious,
                        suspiciousScore,
                        anomalyFlags: anomalyFlags.length > 0 ? anomalyFlags : null,
                        skipLearning
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

                // v32.3 one-time migration: if validValidations doesn't exist yet, the existing
                // sumAbsErrorPercent is polluted with flagged observation errors. Reset to start fresh.
                if (!metaData.validValidations && metaData.sumAbsErrorPercent > 0) {
                    console.log(`🔄 v32.3 migration: resetting polluted sumAbsErrorPercent (was ${metaData.sumAbsErrorPercent})`);
                    metaData.sumAbsErrorPercent = 0;
                }

                metaData.totalValidations += 1;
                metaData.lastValidation = new Date().toISOString();

                // Track anomaly detection statistics (v24)
                if (skipLearning) {
                    metaData.flaggedValidations = (metaData.flaggedValidations || 0) + 1;
                    metaData.lastFlagged = new Date().toISOString();
                    metaData.lastFlaggedReason = anomalyFlags.join(', ');
                } else {
                    // v32.3: Only include non-flagged observations in accuracy calculation
                    // Flagged (ice-affected) observations have large errors that artificially depress accuracy
                    metaData.validValidations = (metaData.validValidations || 0) + 1;
                    metaData.sumAbsErrorPercent = (metaData.sumAbsErrorPercent || 0) + Math.abs(errorPercent);
                }

                // Compute accuracy from valid (non-flagged) observations only
                const validCount = metaData.validValidations || (metaData.totalValidations - (metaData.flaggedValidations || 0));
                metaData.avgErrorPercent = validCount > 0 ? metaData.sumAbsErrorPercent / validCount : null;

                await client.from('potomac_observations').upsert({
                    observation_type: 'gf_metadata',
                    gauge_id: 'system',
                    data: metaData
                }, { onConflict: 'observation_type,gauge_id' });

                result = {
                    success: true,
                    action: 'recordValidation',
                    errorCFS,
                    errorPercent: errorPercent.toFixed(1),
                    binUpdated: skipLearning ? null : binKey,
                    isOutlier,
                    isSuspicious,
                    suspiciousScore,
                    anomalyFlags,
                    skipLearning,
                    binCount: binData.count
                };
            } else {
                result = { success: false, error: 'No pending prediction found' };
            }
        }

        // Action: Update metadata (prediction count)
        if (action === 'incrementPredictions') {
            const { data: meta } = await client
                .from('potomac_observations')
                .select('data')
                .eq('observation_type', 'gf_metadata')
                .eq('gauge_id', 'system')
                .single();

            const metaData = meta?.data || { totalValidations: 0, totalPredictions: 0 };
            metaData.totalPredictions += 1;

            await client.from('potomac_observations').upsert({
                observation_type: 'gf_metadata',
                gauge_id: 'system',
                data: metaData
            }, { onConflict: 'observation_type,gauge_id' });

            result = { success: true, action: 'incrementPredictions' };
        }

        // Action: Reset low-flow bins only (ice-affected, v24)
        // Keeps higher flow bins which are less likely to be contaminated
        if (action === 'resetLowFlowBins') {
            const { pin } = data;
            if (pin !== ADMIN_PIN) {
                return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid PIN' }) };
            }

            // Only delete low-flow bins (0-3000 and 3000-6000) - most affected by ice
            const lowFlowBins = ['0-3000', '3000-6000'];
            const flowStates = ['rising', 'falling', 'steady'];
            let deletedCount = 0;

            for (const bin of lowFlowBins) {
                for (const state of flowStates) {
                    const binKey = `${bin}_${state}`;
                    const { error } = await client.from('potomac_observations')
                        .delete()
                        .eq('observation_type', 'gf_correction_bin')
                        .eq('gauge_id', binKey);
                    if (!error) deletedCount++;

                    // Also delete stage bins
                    const stageBinKey = `stage_${bin}_${state}`;
                    await client.from('potomac_observations')
                        .delete()
                        .eq('observation_type', 'gf_correction_bin')
                        .eq('gauge_id', stageBinKey);
                }
            }

            // Reset metadata - accuracy metrics are no longer valid after partial bin reset
            // Keep health tracking stats, reset learning stats
            const { data: meta } = await client
                .from('potomac_observations')
                .select('data')
                .eq('observation_type', 'gf_metadata')
                .eq('gauge_id', 'system')
                .single();

            const oldMeta = meta?.data || {};
            const newMeta = {
                // Reset learning stats
                totalValidations: 0,
                validValidations: 0,
                totalPredictions: 0,
                avgErrorPercent: null,
                sumAbsErrorPercent: 0,
                lastValidation: null,
                flaggedValidations: 0,
                // Keep health tracking
                lastPrediction: oldMeta.lastPrediction,
                consecutiveRuns: oldMeta.consecutiveRuns,
                missedRuns: oldMeta.missedRuns,
                // Record reset details
                lastPartialReset: new Date().toISOString(),
                partialResetReason: 'v24_ice_contamination_cleanup',
                binsReset: lowFlowBins
            };

            await client.from('potomac_observations').upsert({
                observation_type: 'gf_metadata',
                gauge_id: 'system',
                data: newMeta
            }, { onConflict: 'observation_type,gauge_id' });

            console.log(`🧊 Low-flow bins reset (ice cleanup): ${deletedCount} bins deleted, metadata reset`);
            result = { success: true, action: 'resetLowFlowBins', deletedCount, binsReset: lowFlowBins, metadataReset: true };
        }

        // Action: Reset all GF learning data (admin only, requires PIN)
        if (action === 'resetGFLearning') {
            const { pin } = data;
            // Simple PIN protection (same as client-side learning tab)
            if (pin !== ADMIN_PIN) {
                return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid PIN' }) };
            }

            // Delete all correction bins
            await client.from('potomac_observations')
                .delete()
                .eq('observation_type', 'gf_correction_bin');

            // Delete all pending predictions
            await client.from('potomac_observations')
                .delete()
                .eq('observation_type', 'gf_prediction')
                .eq('gauge_id', 'pending');

            // Reset metadata (keep health stats, reset learning stats)
            const { data: meta } = await client
                .from('potomac_observations')
                .select('data')
                .eq('observation_type', 'gf_metadata')
                .eq('gauge_id', 'system')
                .single();

            const oldMeta = meta?.data || {};
            const newMeta = {
                totalValidations: 0,
                validValidations: 0,
                totalPredictions: 0,
                avgErrorPercent: null,
                sumAbsErrorPercent: 0,
                lastValidation: null,
                flaggedValidations: 0,
                lastPrediction: oldMeta.lastPrediction,  // Keep for health tracking
                consecutiveRuns: oldMeta.consecutiveRuns,
                missedRuns: oldMeta.missedRuns,
                resetAt: new Date().toISOString(),
                resetReason: 'v24_full_reset'
            };

            await client.from('potomac_observations').upsert({
                observation_type: 'gf_metadata',
                gauge_id: 'system',
                data: newMeta
            }, { onConflict: 'observation_type,gauge_id' });

            console.log('🔄 GF Learning data reset');
            result = { success: true, action: 'resetGFLearning', message: 'All GF learning data cleared' };
        }

        // Action: Reset forecast accuracy data (admin only, requires PIN)
        if (action === 'resetForecastAccuracy') {
            const { pin } = data;
            if (pin !== ADMIN_PIN) {
                return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid PIN' }) };
            }

            // Delete all forecast metadata (accuracy stats)
            const { error: metaErr } = await client.from('potomac_observations')
                .delete()
                .eq('observation_type', 'gf_forecast_metadata');

            // Delete all pending forecast predictions
            const { error: pendingErr } = await client.from('potomac_observations')
                .delete()
                .eq('observation_type', 'gf_forecast_pending');

            console.log('🔄 Forecast accuracy data reset');
            result = {
                success: true,
                action: 'resetForecastAccuracy',
                message: 'Forecast accuracy data cleared',
                errors: { metaErr: !!metaErr, pendingErr: !!pendingErr }
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('Save GF error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to save GF learning data', details: error.message || error })
        };
    }
}

// Load forecast accuracy data
async function loadForecastAccuracy(client) {
    try {
        // Load forecast accuracy metadata for each horizon
        const { data: metadata, error: metaErr } = await client
            .from('potomac_observations')
            .select('gauge_id, data')
            .eq('observation_type', 'gf_forecast_metadata');

        if (metaErr) throw metaErr;

        // Build response with accuracy stats per horizon
        const horizons = {};
        for (const row of metadata || []) {
            const horizon = parseInt(row.gauge_id.replace('+', '').replace('h', ''));
            horizons[horizon] = {
                validations: row.data?.validations || 0,
                avgErrorPercent: row.data?.avgErrorPercent || null,
                sumAbsErrorPercent: row.data?.sumAbsErrorPercent || 0
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ horizons })
        };

    } catch (error) {
        console.error('Load forecast accuracy error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to load forecast accuracy' })
        };
    }
}

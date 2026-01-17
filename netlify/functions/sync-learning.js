// Potomac Forecaster - Secure Supabase Sync Function
// Handles learning data sync without exposing credentials to client

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase with service role key (from environment variables)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

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

        // Action: Record a validation (compare prediction to actual)
        if (action === 'recordValidation') {
            const { predictionId, actualCFS, lfCFS, senecaCFS } = data;

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
                    }
                }

                // Only update if not an outlier
                if (!isOutlier) {
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

                // Move prediction from pending to validated
                await client.from('potomac_observations').update({
                    gauge_id: 'validated',
                    data: {
                        ...pred.data,
                        actualCFS,
                        errorCFS,
                        errorPercent,
                        validatedAt: new Date().toISOString()
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
                metaData.totalValidations += 1;
                metaData.sumAbsErrorPercent = (metaData.sumAbsErrorPercent || 0) + Math.abs(errorPercent);
                metaData.avgErrorPercent = metaData.sumAbsErrorPercent / metaData.totalValidations;
                metaData.lastValidation = new Date().toISOString();

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
                    binUpdated: binKey,
                    isOutlier: isOutlier,
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
            body: JSON.stringify({ error: 'Failed to save GF learning data' })
        };
    }
}

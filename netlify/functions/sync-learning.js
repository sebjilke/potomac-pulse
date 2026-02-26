// Potomac Forecaster - Secure Supabase Sync Function
// Handles learning data sync without exposing credentials to client

const { getSupabase, GF_FLOW_BINS, getFlowBin, estimateLFFlowFromStage } = require('./shared/model');

// Admin PIN from environment variable (no hardcoded fallback for security)
const ADMIN_PIN = process.env.ADMIN_PIN;

// CORS headers for browser requests
// Production default locks to Netlify domain; set CORS_ORIGIN=* for deploy previews/localhost
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'https://potomac-pulse.netlify.app';

const headers = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
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

        // GF history endpoint — server-side 24h history for graph display
        if (endpoint === 'gf-history') {
            if (event.httpMethod === 'GET') {
                return await loadGFHistory(client);
            }
        }

        // PoR history endpoint — server-side 48h history for cross-device time-shifting
        if (endpoint === 'por-history') {
            if (event.httpMethod === 'GET') {
                return await loadPoRHistory(client);
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

// GF_FLOW_BINS, getFlowBin, estimateLFFlowFromStage imported from ./shared/model

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
                // TWO-TIER ANOMALY DETECTION (v33.0)
                // Hard flags: physical data corruption → skip learning AND accuracy
                // Soft flags: model disagreement → INCLUDE in learning (with EMA clamp) AND accuracy
                // USGS ice flags are separate (upstream) — anomaly detection only runs on clean data
                // ============================================
                let hardScore = 0;
                let softScore = 0;
                const anomalyFlags = [];

                // Check 1: EF cross-check → SOFT (model disagreement, not data corruption)
                const efEstimate = efEstimateCFS || pred.data.efEstimateCFS;
                if (efEstimate && actualCFS) {
                    const efDiscrepancy = (efEstimate - actualCFS) / actualCFS;
                    if (efDiscrepancy > 0.25) {  // v33.0: standardized to 0.25 (was 0.30)
                        softScore += 2;
                        anomalyFlags.push(`EF_DISCREPANCY:${(efDiscrepancy * 100).toFixed(0)}%`);
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
                    hardScore += 2;  // v33.0: standardized to +2 (was +1)
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

                // v34.0: Correction bin updates disabled in client path
                // Server-side validatePendingPredictions() is the single source of truth
                // for EMA bin updates and EF correlation. This eliminates the client/server
                // race condition where both paths independently updated the same bins,
                // metadata counters, and EF correlation data.

                // Move prediction from pending to validated/hard_flagged/soft_flagged
                await client.from('potomac_observations').update({
                    gauge_id: isHardFlagged ? 'hard_flagged' : (isSoftFlagged ? 'soft_flagged' : 'validated'),
                    data: {
                        ...pred.data,
                        actualCFS,
                        actualStage,
                        errorCFS,
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
                // Map old flaggedValidations → hardFlaggedValidations, reset accuracy to start fresh
                if (metaData.hardFlaggedValidations === undefined) {
                    console.log(`🔄 v33.0 migration: initializing two-tier flagging counters`);
                    metaData.hardFlaggedValidations = metaData.flaggedValidations || 0;
                    metaData.softFlaggedValidations = 0;
                    // Reset accuracy counters — old data mixed hard+soft in ways we can't untangle
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
                    binUpdated: null,  // v34.0: server-only bin updates
                    isOutlier,
                    // v33.0 two-tier fields
                    isHardFlagged,
                    isSoftFlagged,
                    hardScore,
                    softScore,
                    anomalyFlags,
                    skipLearning,
                    // Backward compat
                    isSuspicious: isHardFlagged,
                    suspiciousScore: hardScore + softScore,
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
            if (!ADMIN_PIN || pin !== ADMIN_PIN) {
                return { statusCode: !ADMIN_PIN ? 503 : 403, headers, body: JSON.stringify({ error: !ADMIN_PIN ? 'Admin PIN not configured' : 'Invalid PIN' }) };
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
                hardFlaggedValidations: 0,
                softFlaggedValidations: 0,
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
            if (!ADMIN_PIN || pin !== ADMIN_PIN) {
                return { statusCode: !ADMIN_PIN ? 503 : 403, headers, body: JSON.stringify({ error: !ADMIN_PIN ? 'Admin PIN not configured' : 'Invalid PIN' }) };
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
                hardFlaggedValidations: 0,
                softFlaggedValidations: 0,
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
            if (!ADMIN_PIN || pin !== ADMIN_PIN) {
                return { statusCode: !ADMIN_PIN ? 503 : 403, headers, body: JSON.stringify({ error: !ADMIN_PIN ? 'Admin PIN not configured' : 'Invalid PIN' }) };
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
                sumAbsErrorPercent: row.data?.sumAbsErrorPercent || 0,
                // NWS LF baseline accuracy
                nwsRawValidations: row.data?.nwsRawValidations || 0,
                nwsRawAvgErrorPercent: row.data?.nwsRawAvgErrorPercent || null,
                nwsCorrectedValidations: row.data?.nwsCorrectedValidations || 0,
                nwsCorrectedAvgErrorPercent: row.data?.nwsCorrectedAvgErrorPercent || null,
                // Persistence baseline accuracy
                persistenceValidations: row.data?.persistenceValidations || 0,
                persistenceAvgErrorPercent: row.data?.persistenceAvgErrorPercent || null
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

// Load server-side GF history (24h rolling) for graph display
// Returns array of {timestamp, cfs, stage} readings
async function loadGFHistory(client) {
    try {
        const { data: row, error } = await client
            .from('potomac_observations')
            .select('data')
            .eq('observation_type', 'gf_history')
            .eq('gauge_id', 'system')
            .single();

        if (error && error.code !== 'PGRST116') throw error;  // PGRST116 = no rows

        const readings = row?.data?.readings || [];
        const lastUpdate = row?.data?.lastUpdate || null;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ readings, lastUpdate })
        };

    } catch (error) {
        console.error('Load GF history error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to load GF history' })
        };
    }
}

// Load server-side PoR history (48h rolling) for cross-device time-shifting
// Written by storePoRHistory() in scheduled-update.js every 2h
// Returns array of {timestamp, cfs} readings from USGS 15-min data
async function loadPoRHistory(client) {
    try {
        const { data: row, error } = await client
            .from('potomac_observations')
            .select('data')
            .eq('observation_type', 'por_history')
            .eq('gauge_id', 'system')
            .single();

        if (error && error.code !== 'PGRST116') throw error;  // PGRST116 = no rows

        const readings = row?.data?.readings || [];
        const lastUpdate = row?.data?.lastUpdate || null;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ readings, lastUpdate })
        };

    } catch (error) {
        console.error('Load PoR history error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to load PoR history' })
        };
    }
}

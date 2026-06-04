// Potomac Pulse - Stage Error Analysis
// Call this endpoint to analyze accumulated stage error data
// GET /.netlify/functions/analyze-stage-errors

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event, context) => {
    console.log('=== Stage Error Analysis ===');

    // Admin gate: diagnostic endpoint reads learning state via the service-role key.
    const ADMIN_PIN = process.env.ADMIN_PIN;
    const pin = event.queryStringParameters?.pin;
    if (!ADMIN_PIN || pin !== ADMIN_PIN) {
        return { statusCode: !ADMIN_PIN ? 503 : 403, body: JSON.stringify({ error: !ADMIN_PIN ? 'Admin PIN not configured' : 'Invalid PIN' }) };
    }

    if (!supabaseUrl || !supabaseKey) {
        return { statusCode: 500, body: 'Supabase not configured' };
    }

    const client = createClient(supabaseUrl, supabaseKey);

    try {
        // 1. Get all stage correction bins
        const { data: stageBins, error: stageBinsError } = await client
            .from('potomac_observations')
            .select('gauge_id, data')
            .eq('observation_type', 'gf_correction_bin')
            .like('gauge_id', 'stage_%');

        if (stageBinsError) throw stageBinsError;

        // 2. Get all CFS correction bins for comparison
        const { data: cfsBins, error: cfsBinsError } = await client
            .from('potomac_observations')
            .select('gauge_id, data')
            .eq('observation_type', 'gf_correction_bin')
            .not('gauge_id', 'like', 'stage_%');

        if (cfsBinsError) throw cfsBinsError;

        // 3. Get EF correlation data
        const { data: efCorr, error: efError } = await client
            .from('potomac_observations')
            .select('data')
            .eq('observation_type', 'ef_gf_correlation')
            .eq('gauge_id', 'system')
            .single();

        // 4. Get recent validated predictions with stage data
        const { data: validations, error: valError } = await client
            .from('potomac_observations')
            .select('data, created_at')
            .eq('observation_type', 'gf_prediction')
            .eq('gauge_id', 'validated')
            .not('data->errorStage', 'is', null)
            .order('created_at', { ascending: false })
            .limit(50);

        // Analyze stage bins
        const stageAnalysis = {};
        let totalStageObs = 0;
        let weightedMeanError = 0;

        for (const bin of stageBins || []) {
            const parts = bin.gauge_id.replace('stage_', '').split('_');
            const flowBin = parts[0];
            const flowState = parts[1] || 'unknown';

            if (!stageAnalysis[flowBin]) {
                stageAnalysis[flowBin] = { rising: null, falling: null, steady: null };
            }

            stageAnalysis[flowBin][flowState] = {
                count: bin.data.count,
                meanError: Math.round(bin.data.meanError * 1000) / 1000,
                emaMeanError: Math.round(bin.data.emaMeanError * 1000) / 1000,
                stdDev: bin.data.stdDev || 0
            };

            totalStageObs += bin.data.count;
            weightedMeanError += bin.data.meanError * bin.data.count;
        }

        // Overall weighted mean stage error
        const overallMeanStageError = totalStageObs > 0
            ? Math.round((weightedMeanError / totalStageObs) * 1000) / 1000
            : null;

        // Compare CFS vs Stage correlation
        const recentValidations = (validations || []).map(v => ({
            timestamp: v.data.validatedAt,
            predictedCFS: v.data.predictedCFS,
            actualCFS: v.data.actualCFS,
            errorCFS: v.data.errorCFS,
            predictedStage: v.data.predictedStage,
            actualStage: v.data.actualStage,
            errorStage: v.data.errorStage,
            flowBin: v.data.flowBin,
            flowState: v.data.flowState
        }));

        // Calculate correlation between CFS error and stage error
        let cfsStageCorrelation = null;
        if (recentValidations.length >= 5) {
            const validWithBoth = recentValidations.filter(v =>
                v.errorCFS !== null && v.errorStage !== null
            );

            if (validWithBoth.length >= 5) {
                const n = validWithBoth.length;
                let sumCFS = 0, sumStage = 0, sumCFSStage = 0, sumCFSSq = 0, sumStageSq = 0;

                for (const v of validWithBoth) {
                    sumCFS += v.errorCFS;
                    sumStage += v.errorStage;
                    sumCFSStage += v.errorCFS * v.errorStage;
                    sumCFSSq += v.errorCFS * v.errorCFS;
                    sumStageSq += v.errorStage * v.errorStage;
                }

                const numerator = n * sumCFSStage - sumCFS * sumStage;
                const denominator = Math.sqrt(
                    (n * sumCFSSq - sumCFS * sumCFS) * (n * sumStageSq - sumStage * sumStage)
                );

                cfsStageCorrelation = denominator > 0
                    ? Math.round((numerator / denominator) * 1000) / 1000
                    : 0;
            }
        }

        // Build recommendations
        const recommendations = [];

        if (totalStageObs < 20) {
            recommendations.push(`Need more data: only ${totalStageObs} stage observations. Wait for 20+ before adjusting rating curve.`);
        } else {
            if (Math.abs(overallMeanStageError) > 0.03) {
                recommendations.push(`Consistent stage bias of ${overallMeanStageError > 0 ? '+' : ''}${overallMeanStageError}ft detected. Consider adjusting rating curve.`);
            }

            if (cfsStageCorrelation !== null && cfsStageCorrelation > 0.7) {
                recommendations.push(`Stage error correlates with CFS error (r=${cfsStageCorrelation}). Fix flow estimation first, not rating curve.`);
            } else if (cfsStageCorrelation !== null && cfsStageCorrelation < 0.3) {
                recommendations.push(`Stage error is independent of CFS error (r=${cfsStageCorrelation}). Rating curve adjustment may help.`);
            }
        }

        // EF analysis
        const efAnalysis = efCorr?.data ? {
            pointCount: efCorr.data.count,
            slope: efCorr.data.slope ? Math.round(efCorr.data.slope) : null,
            intercept: efCorr.data.intercept ? Math.round(efCorr.data.intercept) : null,
            rSquared: efCorr.data.rSquared,
            recommendation: efCorr.data.rSquared >= 0.9
                ? 'EF correlation is strong (R² ≥ 0.9). Consider using EF as primary estimator.'
                : efCorr.data.rSquared >= 0.7
                    ? 'EF correlation is good (R² ≥ 0.7). Useful as cross-check.'
                    : 'EF correlation needs more data or is weak. Continue as cross-check only.'
        } : { message: 'No EF correlation data yet' };

        const result = {
            timestamp: new Date().toISOString(),
            summary: {
                totalStageObservations: totalStageObs,
                overallMeanStageError: overallMeanStageError,
                cfsStageCorrelation: cfsStageCorrelation,
                recommendations: recommendations
            },
            stageErrorByFlowBin: stageAnalysis,
            edwardsFerryCorrelation: efAnalysis,
            recentValidations: recentValidations.slice(0, 10)  // Last 10 only
        };

        console.log(JSON.stringify(result, null, 2));

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result, null, 2)
        };

    } catch (e) {
        console.error('Analysis error:', e);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: e.message })
        };
    }
};

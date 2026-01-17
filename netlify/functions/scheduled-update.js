// Potomac Pulse - Scheduled Background Update
// Runs every 4 hours to fetch data, store history, and validate predictions
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
const TRAVEL_COEF = 5174;
const TRAVEL_EXP = -0.5963;
const MEDIAN_TRAVEL = 32.3;
const TRAVEL_POR_GF_BASELINE = 24.3;
const TRAVEL_GF_LF_BASELINE = 8.1;

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

// Fetch current USGS data
async function fetchUSGSData() {
    const gauges = {
        por: '01638500',      // Point of Rocks
        lf: '01646500',       // Little Falls
        monocacy: '01643000', // Monocacy
        goose: '01644000',    // Goose Creek
        seneca: '01645000',   // Seneca Creek
        ef: '01644148'        // Edwards Ferry (stage only)
    };

    const sites = Object.values(gauges).join(',');
    const url = `https://waterservices.usgs.gov/nwis/iv/?sites=${sites}&parameterCd=00060,00065&period=P2D&format=json`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error('USGS fetch failed:', response.status);
            return null;
        }

        const json = await response.json();
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

// Determine flow state from recent history
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

    const pctChange = ((currentCFS - pastReading.cfs) / pastReading.cfs) * 100;

    if (pctChange > 5) return 'rising';
    if (pctChange < -5) return 'falling';
    return 'steady';
}

// Make GF prediction
function makeGFPrediction(usgsData, porHistory) {
    const { data, gauges } = usgsData;

    const lf = data[gauges.lf];
    const por = data[gauges.por];
    const monocacy = data[gauges.monocacy];
    const goose = data[gauges.goose];
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

    let estimatedCFS;
    let useTimeShifted = false;

    if (historicPoR) {
        estimatedCFS = historicPoR.cfs + monocacyFlow + gooseFlow;
        useTimeShifted = true;
    } else {
        estimatedCFS = por.q + monocacyFlow + gooseFlow;
    }

    // Flow state
    const flowState = getFlowState(porHistory, por.q);
    const flowBin = getFlowBin(estimatedCFS);

    return {
        timestamp: new Date().toISOString(),
        predictedCFS: Math.round(estimatedCFS),
        porCFS: Math.round(por.q),
        historicPorCFS: historicPoR ? Math.round(historicPoR.cfs) : null,
        monocacyCFS: Math.round(monocacyFlow),
        gooseCFS: Math.round(gooseFlow),
        flowBin,
        flowState,
        travelTimeGFtoLF: travelGFtoLF,
        validationDue: new Date(Date.now() + travelGFtoLF * 60 * 60 * 1000).toISOString(),
        efStage: ef?.h || null,
        useTimeShifted,
        lfCFS: Math.round(lf.q)
    };
}

// Check and validate pending predictions
async function validatePendingPredictions(client, usgsData) {
    const { data, gauges } = usgsData;
    const lf = data[gauges.lf];
    const seneca = data[gauges.seneca];

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

    const now = new Date();
    let validated = 0;

    for (const pred of pending) {
        const validationDue = new Date(pred.data.validationDue);
        if (isNaN(validationDue.getTime())) continue;

        if (now >= validationDue) {
            // Calculate actual GF CFS
            const senecaFlow = seneca?.q || (lf.q * 0.01);
            const actualCFS = lf.q - senecaFlow;

            // Calculate error
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

            // Outlier detection
            const EMA_ALPHA = 0.3;
            let isOutlier = false;

            if (binData.count >= 10) {
                const variance = (binData.sumErrorSq / binData.count) - (binData.meanError * binData.meanError);
                const stdDev = Math.sqrt(Math.max(0, variance));
                if (stdDev > 0) {
                    const zScore = Math.abs((errorCFS - binData.meanError) / stdDev);
                    isOutlier = zScore > 3;
                }
            }

            if (!isOutlier) {
                binData.count += 1;
                binData.sumError += errorCFS;
                binData.sumErrorSq += errorCFS * errorCFS;
                binData.meanError = binData.sumError / binData.count;

                if (binData.count === 1) {
                    binData.emaMeanError = errorCFS;
                } else {
                    binData.emaMeanError = EMA_ALPHA * errorCFS + (1 - EMA_ALPHA) * (binData.emaMeanError || binData.meanError);
                }

                await client.from('potomac_observations').upsert({
                    observation_type: 'gf_correction_bin',
                    gauge_id: binKey,
                    data: binData
                }, { onConflict: 'observation_type,gauge_id' });
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

                // Linear regression
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

                console.log(`Updated EF correlation: ${corrData.count} points`);
            }

            // Move to validated
            await client.from('potomac_observations').update({
                gauge_id: 'validated',
                data: {
                    ...pred.data,
                    actualCFS,
                    errorCFS,
                    errorPercent,
                    validatedAt: new Date().toISOString(),
                    isOutlier
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

            console.log(`Validated prediction: predicted=${predictedCFS}, actual=${Math.round(actualCFS)}, error=${errorPercent.toFixed(1)}%`);
            validated++;
        }
    }

    return validated;
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
    metaData.lastPrediction = new Date().toISOString();

    await client.from('potomac_observations').upsert({
        observation_type: 'gf_metadata',
        gauge_id: 'system',
        data: metaData
    }, { onConflict: 'observation_type,gauge_id' });

    console.log(`Stored prediction: ${prediction.predictedCFS} cfs, validation due: ${prediction.validationDue}`);
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
        // 1. Fetch USGS data
        console.log('Fetching USGS data...');
        const usgsData = await fetchUSGSData();
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

        // 4. Validate pending predictions
        console.log('Checking pending predictions...');
        const validated = await validatePendingPredictions(client, usgsData);
        console.log(`Validated ${validated} predictions`);

        // 5. Make new prediction
        console.log('Making new prediction...');
        const prediction = makeGFPrediction(usgsData, fullHistory);
        if (prediction) {
            await storePrediction(client, prediction);
        }

        // 6. Log summary
        const summary = {
            timestamp: new Date().toISOString(),
            porCFS: usgsData.data[usgsData.gauges.por]?.q,
            lfCFS: usgsData.data[usgsData.gauges.lf]?.q,
            efStage: usgsData.data[usgsData.gauges.ef]?.h,
            porHistoryCount: fullHistory.length,
            predictionsValidated: validated,
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

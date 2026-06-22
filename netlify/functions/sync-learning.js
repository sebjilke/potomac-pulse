// Potomac Forecaster - Secure Supabase Sync Function
// Handles learning data sync without exposing credentials to client

const { getSupabase, GF_FLOW_BINS, getFlowBin, buildCorrectionBins, isExistingPredictionReplaceable } = require('./shared/model');

// Admin PIN from environment variable (no hardcoded fallback for security)
const ADMIN_PIN = process.env.ADMIN_PIN;

// CORS headers for browser requests
// Production default locks to Netlify domain; set CORS_ORIGIN=* for deploy previews/localhost
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'https://potomac-pulse.netlify.app';

// === Rate limiting (in-memory, per-instance — lightweight protection) ===
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_GET = 60;   // GET requests per minute per IP
const RATE_LIMIT_POST = 10;  // POST requests per minute per IP

/**
 * Records a request against the in-memory per-instance rate limiter and reports whether it is within the limit.
 * @param {string} ip - Client IP used (with method) as the bucket key.
 * @param {string} method - HTTP method; 'POST' uses RATE_LIMIT_POST, anything else uses RATE_LIMIT_GET.
 * @returns {boolean} True if the request is allowed (count within the window's limit), false if it should be throttled.
 */
function checkRateLimit(ip, method) {
    const key = `${ip}:${method}`;
    const now = Date.now();
    const limit = method === 'POST' ? RATE_LIMIT_POST : RATE_LIMIT_GET;

    let entry = rateLimitMap.get(key);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        entry = { windowStart: now, count: 0 };
        rateLimitMap.set(key, entry);
    }
    entry.count++;

    // Prune stale entries periodically (prevent memory growth)
    if (rateLimitMap.size > 1000) {
        for (const [k, v] of rateLimitMap) {
            if (now - v.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(k);
        }
    }

    return entry.count <= limit;
}

// === POST body validation ===
/**
 * Validates top-level POST body shape (object, size, finite numbers, sane timestamp/CFS).
 * @param {Object} body - Parsed JSON request body.
 * @param {string} endpoint - Endpoint name the body targets (currently unused by the checks).
 * @returns {(string|null)} An error message if invalid, or null if the body passes.
 */
function validatePostBody(body, endpoint) {
    if (!body || typeof body !== 'object') return 'Request body must be a JSON object';
    // Reject oversized payloads (checked as serialized string)
    const bodyStr = JSON.stringify(body);
    if (bodyStr.length > 10240) return 'Request body exceeds 10KB limit';
    // Reject NaN/Infinity in numeric fields
    for (const [key, val] of Object.entries(body)) {
        if (typeof val === 'number' && (!isFinite(val) || isNaN(val))) {
            return `Invalid numeric value for field "${key}"`;
        }
    }
    // Reject future timestamps (more than 1 hour ahead)
    if (body.timestamp && body.timestamp > Date.now() + 3600000) {
        return 'Timestamp cannot be more than 1 hour in the future';
    }
    // Reject negative CFS values
    if (body.predictedCFS !== undefined && body.predictedCFS < 0) {
        return 'CFS values cannot be negative';
    }
    return null; // valid
}

// Build the rows inserted by the 'storeForecastPredictions' action.
// Pure (timestamp injected) so it can be unit-tested. The three NWS/persistence
// baseline fields are preserved here so scheduled-update.js can score model
// forecast skill against them (C24 — previously dropped at insert).
/**
 * Maps forecast entries to `gf_forecast_pending` observation rows, keeping NWS/persistence baselines for later scoring.
 * @param {Object[]} forecasts - Forecast objects; only those with both `horizon` and `targetTime` are kept.
 * @param {number} timestamp - Batch timestamp (ms) embedded in each row's gauge_id (`+<horizon>h_<timestamp>`).
 * @returns {Object[]} Observation rows ({ observation_type, gauge_id, data }) ready to insert.
 */
function buildForecastRows(forecasts, timestamp) {
    return forecasts
        .filter(f => f && typeof f === 'object' && f.horizon && f.targetTime)
        .map(f => ({
            observation_type: 'gf_forecast_pending',
            gauge_id: `+${f.horizon}h_${timestamp}`,
            data: {
                horizon: f.horizon,  // Store horizon in data for validation lookup
                targetTime: f.targetTime,
                predictedCFS: f.predictedCFS,
                predictedStage: f.predictedStage,
                source: f.source,
                createdAt: f.createdAt,
                // Baselines for accuracy comparison (scored in scheduled-update.js)
                nwsLfRawCFS: f.nwsLfRawCFS ?? null,
                nwsLfBiasCorrectedCFS: f.nwsLfBiasCorrectedCFS ?? null,
                persistenceCFS: f.persistenceCFS ?? null
            }
        }));
}

// === Nested write-payload validation (C13) ===
// validatePostBody only checks top-level fields, but the storePrediction and
// storeForecastPredictions actions carry attacker-controllable NESTED payloads
// that feed the learning bins. Bound them to sane ranges so the public, unauthenticated
// write path can't poison the bins with absurd values. (The reset* actions are PIN-gated;
// stronger auth is tracked separately as RLS + the client/server canonical-model decision.)
const FLOW_STATES = ['rising', 'steady', 'falling'];
const WRITE_CFS_MAX = 500000;        // matches the LF sanity ceiling used server-side
const WRITE_STAGE_MAX = 60;          // ft — far above any real Potomac stage
const MAX_FORECASTS = 16;            // client sends ~4 horizons; generous cap
const PRED_DUE_MIN_OFFSET_MS = -3 * 60 * 60 * 1000;   // validationDue may be slightly past (retry/skew)
const PRED_DUE_MAX_OFFSET_MS = 49 * 60 * 60 * 1000;   // ...up to the 48h horizon + slack
const FCAST_TARGET_MAX_OFFSET_MS = 72 * 60 * 60 * 1000;

/**
 * Tests whether a value is a finite number within an inclusive [lo, hi] range.
 * @param {*} x - Value to test.
 * @param {number} lo - Inclusive lower bound.
 * @param {number} hi - Inclusive upper bound.
 * @returns {boolean} True if `x` is a finite number and lo <= x <= hi.
 */
function finiteInRange(x, lo, hi) {
    return typeof x === 'number' && isFinite(x) && x >= lo && x <= hi;
}

// Returns an error string if the write payload is invalid, else null.
/**
 * Bounds the nested write payloads of the storePrediction / storeForecastPredictions actions to sane ranges (C13).
 * @param {Object} data - Parsed request body, including `action` and its nested `prediction` or `forecasts`.
 * @param {number} nowMs - Current time (ms) used to range-check due/target timestamps.
 * @returns {(string|null)} An error message if the payload is out of range, or null (also null for non-write actions).
 */
function validateGFWritePayload(data, nowMs) {
    const action = data && data.action;

    if (action === 'storePrediction') {
        const p = data.prediction;
        if (!p || typeof p !== 'object') return 'prediction must be an object';
        if (!finiteInRange(p.predictedCFS, 0, WRITE_CFS_MAX)) return 'prediction.predictedCFS out of range';
        if (p.rawFinalCFS != null && !finiteInRange(p.rawFinalCFS, 0, WRITE_CFS_MAX)) return 'prediction.rawFinalCFS out of range';
        const dueMs = Date.parse(p.validationDue);
        if (isNaN(dueMs) || dueMs < nowMs + PRED_DUE_MIN_OFFSET_MS || dueMs > nowMs + PRED_DUE_MAX_OFFSET_MS) {
            return 'prediction.validationDue out of range';
        }
        // flowBin/flowState form the EMA bin key — require both present and in-vocabulary
        // (the legit client always sends both) so no phantom 'null_*'/'undefined_*' bin can be created.
        if (!GF_FLOW_BINS.includes(p.flowBin)) return 'prediction.flowBin invalid';
        if (!FLOW_STATES.includes(p.flowState)) return 'prediction.flowState invalid';
        // The bin key must be consistent with the magnitude that DEFINES it. v36.0: flowBin is the bin
        // of the RAW final estimate (the bin the EMA learns into), so couple it to rawFinalCFS when
        // present (legacy pre-v36.0 rows fall back to predictedCFS). Allow same/adjacent bin (boundary
        // rounding) but reject distant mismatches that would free-target an arbitrary bin to poison.
        const couplingCFS = (p.rawFinalCFS != null) ? p.rawFinalCFS : p.predictedCFS;
        const expectedIdx = GF_FLOW_BINS.indexOf(getFlowBin(couplingCFS));
        if (Math.abs(GF_FLOW_BINS.indexOf(p.flowBin) - expectedIdx) > 1) {
            return 'prediction.flowBin inconsistent with the raw estimate';
        }
        for (const f of ['porCFS', 'monocacyCFS', 'gooseCFS']) {
            if (p[f] != null && !finiteInRange(p[f], 0, WRITE_CFS_MAX)) return `prediction.${f} out of range`;
        }
        if (p.efStage != null && !finiteInRange(p.efStage, 0, WRITE_STAGE_MAX)) return 'prediction.efStage out of range';
        if (p.predictedStage != null && !finiteInRange(p.predictedStage, 0, WRITE_STAGE_MAX)) return 'prediction.predictedStage out of range';
        if (p.rawFinalStage != null && !finiteInRange(p.rawFinalStage, 0, WRITE_STAGE_MAX)) return 'prediction.rawFinalStage out of range';
        if (p.correctionApplied != null && !finiteInRange(p.correctionApplied, -WRITE_CFS_MAX, WRITE_CFS_MAX)) return 'prediction.correctionApplied out of range';
        if (p.travelTimeGFtoLF != null && !finiteInRange(p.travelTimeGFtoLF, 0, 72)) return 'prediction.travelTimeGFtoLF out of range';
        return null;
    }

    if (action === 'storeForecastPredictions') {
        const fc = data.forecasts;
        if (!Array.isArray(fc)) return 'forecasts must be an array';
        if (fc.length > MAX_FORECASTS) return `too many forecasts (max ${MAX_FORECASTS})`;
        const seenHorizons = new Set();
        for (const f of fc) {
            // Mirror buildForecastRows' filter: only entries with horizon+targetTime are stored.
            if (!f || typeof f !== 'object' || !f.horizon || !f.targetTime) continue;
            if (!Number.isInteger(f.horizon) || f.horizon < 1 || f.horizon > 72) return 'forecast.horizon invalid';
            // Duplicate horizons in one batch collide on gauge_id (+Nh_<batchTs>) → DB insert
            // fails as a whole; reject up front for a clean 400 instead of a 500.
            if (seenHorizons.has(f.horizon)) return 'duplicate forecast horizon';
            seenHorizons.add(f.horizon);
            if (!finiteInRange(f.predictedCFS, 0, WRITE_CFS_MAX)) return 'forecast.predictedCFS out of range';
            const tMs = Date.parse(f.targetTime);
            if (isNaN(tMs) || tMs < nowMs + PRED_DUE_MIN_OFFSET_MS || tMs > nowMs + FCAST_TARGET_MAX_OFFSET_MS) {
                return 'forecast.targetTime out of range';
            }
            if (f.predictedStage != null && !finiteInRange(f.predictedStage, 0, WRITE_STAGE_MAX)) return 'forecast.predictedStage out of range';
            for (const b of ['nwsLfRawCFS', 'nwsLfBiasCorrectedCFS', 'persistenceCFS']) {
                if (f[b] != null && !finiteInRange(f[b], 0, WRITE_CFS_MAX)) return `forecast.${b} out of range`;
            }
            // source/createdAt are stored verbatim by buildForecastRows — bound them so junk
            // (non-string source, oversized strings, bogus dates) can't be persisted and served back.
            if (f.source != null && (typeof f.source !== 'string' || f.source.length > 40)) return 'forecast.source invalid';
            if (f.createdAt != null && isNaN(Date.parse(f.createdAt))) return 'forecast.createdAt invalid';
        }
        return null;
    }

    return null; // non-write actions (reset*) are authorized via ADMIN_PIN elsewhere
}

const headers = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
};

/**
 * Netlify function entry point: handles CORS preflight, rate limiting, and routes GET/POST requests by `endpoint`.
 * @param {Object} event - Netlify event (httpMethod, headers, queryStringParameters, body).
 * @param {Object} context - Netlify function context (unused).
 * @returns {Promise<{statusCode: number, headers: Object, body: string}>} HTTP response object.
 */
exports.handler = async (event, context) => {
    // Handle preflight CORS requests
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    // Rate limiting
    const clientIP = (event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown').split(',')[0].trim();
    if (!checkRateLimit(clientIP, event.httpMethod)) {
        return {
            statusCode: 429,
            headers: { ...headers, 'Retry-After': '60' },
            body: JSON.stringify({ error: 'Too many requests. Try again in 60 seconds.' })
        };
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
                const validationError = validatePostBody(body, 'gf');
                if (validationError) {
                    return { statusCode: 400, headers, body: JSON.stringify({ error: validationError }) };
                }
                return await saveGFLearningData(client, body);
            }
        }

        // Forecast accuracy endpoint
        if (endpoint === 'forecast-accuracy') {
            if (event.httpMethod === 'GET') {
                return await loadForecastAccuracy(client);
            }
        }

        // Validation history endpoint — 7d rolling predicted-vs-actual pairs
        if (endpoint === 'validation-history') {
            if (event.httpMethod === 'GET') {
                return await loadValidationHistory(client);
            }
        }

        // GF history endpoint — server-side 24h history for graph display
        if (endpoint === 'gf-history') {
            if (event.httpMethod === 'GET') {
                return await loadGFHistory(client);
            }
        }

        // PoR history endpoint — server-side 72h history for cross-device time-shifting
        if (endpoint === 'por-history') {
            if (event.httpMethod === 'GET') {
                return await loadPoRHistory(client);
            }
        }

        // Audit log endpoint — recent admin actions (resets), newest-first (v37.8 #17)
        if (endpoint === 'audit-log') {
            if (event.httpMethod === 'GET') {
                return await loadAuditLog(client);
            }
        }

        // System-1 (gauge-learning) sync was retired in v37.1. All live traffic uses a named
        // `endpoint` (gf, forecast-accuracy, validation-history, gf-history, por-history), each
        // handled above. A request with no recognized endpoint is no longer a valid route.
        return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Unknown or missing endpoint' })
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

// ==================== GREAT FALLS LEARNING ====================
// Handles GF predictions, validations, and correction bins

// GF_FLOW_BINS imported from ./shared/model

// Load GF learning data from Supabase
/**
 * Loads GF learning state (correction bins, pending predictions, metadata, EF correlation, shadow leaderboard) for the GET 'gf' endpoint.
 * @param {Object} client - Supabase client.
 * @returns {Promise<{statusCode: number, headers: Object, body: string}>} HTTP response with the assembled learning payload, or a 500 on failure.
 */
async function loadGFLearningData(client) {
    try {
        // v37.5: fire the 5 independent reads concurrently. Bins, pending, metadata, EF correlation,
        // and shadow leaderboard have no inter-dependency, so Promise.all collapses 5 sequential
        // round-trips into 1 on the cold-load critical path (this endpoint is awaited before the first
        // GF estimate paints). Error semantics preserved EXACTLY: bins/pending throw -> caught -> 500;
        // metadata/efCorrelation/shadowLeaderboard tolerate a missing row (errors ignored). Supabase
        // query builders resolve to {data,error} (never reject), so Promise.all resolves with all 5.
        const [binsRes, pendRes, metaRes, efRes, shadowRes] = await Promise.all([
            // Correction bins
            client
                .from('potomac_observations')
                .select('gauge_id, data')
                .eq('observation_type', 'gf_correction_bin'),
            // Pending predictions (not yet validated)
            client
                .from('potomac_observations')
                .select('gauge_id, data, created_at')
                .eq('observation_type', 'gf_prediction')
                .eq('gauge_id', 'pending')
                .order('created_at', { ascending: false })
                .limit(50),
            // GF metadata (total validations, accuracy stats)
            client
                .from('potomac_observations')
                .select('data')
                .eq('observation_type', 'gf_metadata')
                .eq('gauge_id', 'system')
                .single(),
            // Edwards Ferry to GF correlation
            client
                .from('potomac_observations')
                .select('data')
                .eq('observation_type', 'ef_gf_correlation')
                .eq('gauge_id', 'system')
                .single(),
            // Shadow model leaderboard
            client
                .from('potomac_observations')
                .select('data')
                .eq('observation_type', 'shadow_leaderboard')
                .eq('gauge_id', 'system')
                .single()
        ]);

        const { data: bins, error: binErr } = binsRes;
        if (binErr) throw binErr;

        const { data: pending, error: pendErr } = pendRes;
        if (pendErr) throw pendErr;

        // metadata / efCorrelation / shadowLeaderboard: a missing row is tolerated (errors ignored),
        // exactly as the prior sequential code did (it destructured but never checked these errors).
        const { data: meta } = metaRes;
        const { data: efCorr } = efRes;
        const { data: shadowLB } = shadowRes;

        // Build correction bins via the shared helper (single source of truth with the cron;
        // seeds all 18 cells and skips stage_* keys). v36.0 — replaces the inline duplicate.
        const correctionBins = buildCorrectionBins(bins);

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
                efCorrelation: (() => {
                    // Fix C: recompute sumCFSSq from points on load to correct legacy double-count bug.
                    // Safe because points array is ground truth; sumCFSSq is a derivative.
                    // This is a one-time in-memory heal — does not write back to Supabase.
                    const d = efCorr?.data || null;
                    if (d?.points?.length > 0) {
                        d.sumCFSSq = d.points.reduce((s, p) => s + p.cfs * p.cfs, 0);
                    }
                    return d;
                })(),  // Edwards Ferry stage to GF CFS correlation
                shadowLeaderboard: shadowLB?.data || null  // Shadow model horse race leaderboard
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
/**
 * Handles POST 'gf' write actions: validates the payload then dispatches storePrediction, storeForecastPredictions, or the PIN-gated reset* actions.
 * @param {Object} client - Supabase client.
 * @param {Object} data - Validated request body carrying `action` and its action-specific fields (prediction/forecasts/pin).
 * @returns {Promise<{statusCode: number, headers: Object, body: string}>} HTTP response with the action result, or a 400/403/500/503 on error.
 */
async function saveGFLearningData(client, data) {
    // C13: reject out-of-range nested write payloads before any DB write.
    const writeErr = validateGFWritePayload(data, Date.now());
    if (writeErr) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: writeErr }) };
    }
    try {
        const { action } = data;
        let result = { success: false };

        // Action: Store a new prediction
        if (action === 'storePrediction') {
            const { prediction } = data;
            if (!prediction) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'No prediction provided' }) };
            }

            // Check if an existing pending prediction is still within its validation window.
            // If so, don't replace it — the server cron needs the original prediction to
            // stay untouched so it can validate against actual LF when water arrives.
            const { data: existing } = await client.from('potomac_observations')
                .select('data')
                .eq('observation_type', 'gf_prediction')
                .eq('gauge_id', 'pending')
                .single();

            if (existing) {
                // Replace only if the existing pending row missed its window or has a
                // missing/unparseable due date (C12 — shared with scheduled-update.js so
                // both write paths agree and neither deadlocks on a bad-date row).
                if (!isExistingPredictionReplaceable(existing.data, Date.now())) {
                    result = { success: true, action: 'storePrediction', skipped: true,
                               reason: 'Existing prediction still in validation window' };
                    return { statusCode: 200, headers, body: JSON.stringify(result) };
                }

                // Existing prediction missed its validation window — safe to replace
                await client.from('potomac_observations')
                    .delete()
                    .eq('observation_type', 'gf_prediction')
                    .eq('gauge_id', 'pending');
            }

            const { error } = await client.from('potomac_observations').insert({
                observation_type: 'gf_prediction',
                gauge_id: 'pending',
                data: {
                    timestamp: prediction.timestamp,
                    predictedCFS: prediction.predictedCFS,
                    rawFinalCFS: prediction.rawFinalCFS ?? null,          // v36.0: raw learning target
                    rawFinalStage: prediction.rawFinalStage ?? null,      // v36.0: raw stage learning target
                    correctionApplied: prediction.correctionApplied ?? null,
                    porCFS: prediction.porCFS,
                    monocacyCFS: prediction.monocacyCFS,
                    gooseCFS: prediction.gooseCFS,
                    flowBin: prediction.flowBin,
                    flowState: prediction.flowState,
                    travelTimeGFtoLF: prediction.travelTimeGFtoLF,
                    validationDue: prediction.validationDue,
                    efStage: prediction.efStage || null
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
            const insertData = buildForecastRows(forecasts, timestamp);

            const { error } = await client.from('potomac_observations').insert(insertData);
            if (error) {
                console.error('Forecast insert error:', error);
                throw error;
            }

            console.log(`📈 Stored ${forecasts.length} forecast predictions for accuracy tracking`);
            result = { success: true, action: 'storeForecastPredictions', count: forecasts.length };
        }

        // (v34.0) Client-side 'recordValidation' and 'incrementPredictions' actions removed:
        // validation + EMA bin learning is server-only (scheduled-update.js
        // validatePendingPredictions). No client code calls these actions.

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

            // Delete shadow leaderboard (accuracy starts fresh)
            await client.from('potomac_observations')
                .delete()
                .eq('observation_type', 'shadow_leaderboard')
                .eq('gauge_id', 'system');

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
            await logAdminAction(client, 'resetLowFlowBins', { deletedCount, binsReset: lowFlowBins });
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

            // Delete shadow leaderboard (accuracy starts fresh)
            await client.from('potomac_observations')
                .delete()
                .eq('observation_type', 'shadow_leaderboard')
                .eq('gauge_id', 'system');

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
                resetReason: 'manual_admin_reset'
            };

            await client.from('potomac_observations').upsert({
                observation_type: 'gf_metadata',
                gauge_id: 'system',
                data: newMeta
            }, { onConflict: 'observation_type,gauge_id' });

            console.log('🔄 GF Learning data reset');
            result = { success: true, action: 'resetGFLearning', message: 'All GF learning data cleared' };
            await logAdminAction(client, 'resetGFLearning', { cleared: 'correction bins + pending + shadow leaderboard + learning stats' });
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
            await logAdminAction(client, 'resetForecastAccuracy', { cleared: 'forecast metadata + pending' });
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
/**
 * Loads per-horizon forecast accuracy stats (model plus NWS-raw/NWS-corrected/persistence baselines) for the GET 'forecast-accuracy' endpoint.
 * @param {Object} client - Supabase client.
 * @returns {Promise<{statusCode: number, headers: Object, body: string}>} HTTP response with `{ horizons }` keyed by horizon hours, or a 500 on failure.
 */
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

// ==================== ADMIN AUDIT LOG (v37.8 #17) ====================

/**
 * Append-only audit record of a PIN-gated admin action. Inserts one `audit_log` row.
 * NON-FATAL: a failed insert is swallowed (logged) so it can never break or 500 the action it records.
 * @param {Object} client - Supabase client.
 * @param {string} action - The admin action name (e.g. 'resetGFLearning').
 * @param {Object|null} [details] - Optional structured details (e.g. {deletedCount}).
 * @returns {Promise<void>}
 */
async function logAdminAction(client, action, details) {
    try {
        // Append-only: unique gauge_id per entry respects the (observation_type, gauge_id) key.
        // Growth is negligible (manual resets are rare); pruning deferred. The GET caps the READ at 50.
        await client.from('potomac_observations').insert({
            observation_type: 'audit_log',
            gauge_id: `${Date.now()}_${action}`,
            data: { action, at: new Date().toISOString(), details: details || null }
        });
    } catch (e) {
        console.warn('Audit log write failed (non-fatal):', e?.message || e);
    }
}

/**
 * Loads the 50 most-recent admin-action audit entries for the GET 'audit-log' endpoint (newest first).
 * @param {Object} client - Supabase client.
 * @returns {Promise<{statusCode: number, headers: Object, body: string}>} HTTP response with `{ entries }`, or a 500 on failure.
 */
async function loadAuditLog(client) {
    try {
        const { data: rows, error } = await client
            .from('potomac_observations')
            .select('data')
            .eq('observation_type', 'audit_log')
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) throw error;
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ entries: (rows || []).map(r => r.data) })
        };
    } catch (error) {
        console.error('Load audit log error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to load audit log' })
        };
    }
}

/**
 * Loads the rolling predicted-vs-actual validation history for the GET 'validation-history' endpoint.
 * @param {Object} client - Supabase client.
 * @returns {Promise<{statusCode: number, headers: Object, body: string}>} HTTP response with `{ readings, lastUpdate }`, or a 500 on failure.
 */
async function loadValidationHistory(client) {
    try {
        const { data: row, error } = await client
            .from('potomac_observations')
            .select('data')
            .eq('observation_type', 'gf_validation_history')
            .eq('gauge_id', 'system')
            .single();

        if (error && error.code !== 'PGRST116') throw error;

        const readings = row?.data?.readings || [];
        const lastUpdate = row?.data?.lastUpdate || null;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ readings, lastUpdate })
        };

    } catch (error) {
        console.error('Load validation history error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to load validation history' })
        };
    }
}

// Load server-side GF history (24h rolling) for graph display
// Returns array of {timestamp, cfs, stage} readings
/**
 * Loads the server-side 24h rolling GF history for graph display (GET 'gf-history' endpoint).
 * @param {Object} client - Supabase client.
 * @returns {Promise<{statusCode: number, headers: Object, body: string}>} HTTP response with `{ readings, lastUpdate }` (readings are {timestamp, cfs, stage}), or a 500 on failure.
 */
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

// Load server-side PoR history (72h rolling) for cross-device time-shifting
// Written by storePoRHistory() in scheduled-update.js every hour (serves whatever
// retention storePoRHistory writes — POR_HISTORY_MAX_AGE, 72h since v36.4)
// Returns array of {timestamp, cfs} readings from USGS 15-min data
/**
 * Loads the server-side 72h rolling PoR history for cross-device time-shifting (GET 'por-history' endpoint).
 * @param {Object} client - Supabase client.
 * @returns {Promise<{statusCode: number, headers: Object, body: string}>} HTTP response with `{ readings, lastUpdate }` (readings are {timestamp, cfs}), or a 500 on failure.
 */
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

// Test-only exports (mirrors the convention in scheduled-update.js)
exports._test = { buildForecastRows, validateGFWritePayload, loadGFLearningData, logAdminAction, loadAuditLog, saveGFLearningData };

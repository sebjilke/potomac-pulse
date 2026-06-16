const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const {
    validateUSGSResponse, fetchWithTimeout, fetchWaterTemp,
    getPoRFromHistory, estimateLFStage, makeGFPrediction,
    scoreShadowPredictions, storePrediction, validatePendingPredictions,
    shadowLFFeedback, shadowOnlineRegression, shadowKalman,
    runServerShadowModels,
} = require('../netlify/functions/scheduled-update')._test;

const { estimateLFFlowFromStage, EF_MODEL } = require('../netlify/functions/shared/model');

// ─── validateUSGSResponse ─────────────────────────────────────────────────────

describe('validateUSGSResponse', () => {
    const validFixture = require('./fixtures/usgs-response-valid.json');

    it('accepts a valid USGS response', () => {
        const result = validateUSGSResponse(validFixture);
        assert.deepEqual(result, { valid: true });
    });

    it('rejects null', () => {
        const result = validateUSGSResponse(null);
        assert.equal(result.valid, false);
        assert.match(result.error, /not an object/);
    });

    it('rejects non-object (string)', () => {
        const result = validateUSGSResponse('hello');
        assert.equal(result.valid, false);
    });

    it('rejects missing value property', () => {
        const result = validateUSGSResponse({ foo: 'bar' });
        assert.equal(result.valid, false);
        assert.match(result.error, /value/);
    });

    it('rejects non-array timeSeries', () => {
        const result = validateUSGSResponse({ value: { timeSeries: 'not-array' } });
        assert.equal(result.valid, false);
        assert.match(result.error, /timeSeries/);
    });

    it('rejects timeSeries entry missing siteCode', () => {
        const result = validateUSGSResponse({
            value: {
                timeSeries: [{
                    sourceInfo: {},
                    variable: { variableCode: [{ value: '00060' }] },
                    values: [{ value: [] }]
                }]
            }
        });
        assert.equal(result.valid, false);
        assert.match(result.error, /siteCode/);
    });

    it('rejects timeSeries entry missing variableCode', () => {
        const result = validateUSGSResponse({
            value: {
                timeSeries: [{
                    sourceInfo: { siteCode: [{ value: '01646500' }] },
                    variable: {},
                    values: [{ value: [] }]
                }]
            }
        });
        assert.equal(result.valid, false);
        assert.match(result.error, /variableCode/);
    });

    it('rejects timeSeries entry missing values array', () => {
        const result = validateUSGSResponse({
            value: {
                timeSeries: [{
                    sourceInfo: { siteCode: [{ value: '01646500' }] },
                    variable: { variableCode: [{ value: '00060' }] },
                    values: []
                }]
            }
        });
        assert.equal(result.valid, false);
        assert.match(result.error, /values/);
    });
});

// ─── fetchWithTimeout ─────────────────────────────────────────────────────────

describe('fetchWithTimeout', () => {
    it('returns response on successful fetch', async (t) => {
        const mockResponse = { ok: true, status: 200 };
        t.mock.method(global, 'fetch', () => Promise.resolve(mockResponse));

        const result = await fetchWithTimeout('https://example.com', 5000);
        assert.equal(result.ok, true);
    });

    it('throws timeout error when fetch takes too long', async (t) => {
        t.mock.method(global, 'fetch', (url, opts) => {
            return new Promise((resolve, reject) => {
                const id = setTimeout(resolve, 60000);
                opts.signal.addEventListener('abort', () => {
                    clearTimeout(id);
                    reject(new DOMException('The operation was aborted.', 'AbortError'));
                });
            });
        });

        await assert.rejects(
            fetchWithTimeout('https://example.com', 50),
            (err) => {
                assert.match(err.message, /timed out/);
                return true;
            }
        );
    });

    it('propagates non-timeout fetch errors', async (t) => {
        t.mock.method(global, 'fetch', () => Promise.reject(new Error('DNS failed')));

        await assert.rejects(
            fetchWithTimeout('https://example.com', 5000),
            (err) => {
                assert.match(err.message, /DNS failed/);
                return true;
            }
        );
    });
});

// ─── fetchWaterTemp ───────────────────────────────────────────────────────────

describe('fetchWaterTemp', () => {
    it('returns valid temperature', async (t) => {
        const mockJson = {
            value: {
                timeSeries: [{
                    values: [{
                        value: [{ value: '12.5' }]
                    }]
                }]
            }
        };
        t.mock.method(global, 'fetch', () => Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockJson)
        }));

        const temp = await fetchWaterTemp();
        assert.equal(temp, 12.5);
    });

    it('returns null for out-of-range temperature', async (t) => {
        const mockJson = {
            value: {
                timeSeries: [{
                    values: [{
                        value: [{ value: '99.0' }]
                    }]
                }]
            }
        };
        t.mock.method(global, 'fetch', () => Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockJson)
        }));

        const temp = await fetchWaterTemp();
        assert.equal(temp, null);
    });

    it('returns null on fetch failure', async (t) => {
        t.mock.method(global, 'fetch', () => Promise.reject(new Error('Network error')));

        const temp = await fetchWaterTemp();
        assert.equal(temp, null);
    });

    it('returns null on non-ok response', async (t) => {
        t.mock.method(global, 'fetch', () => Promise.resolve({ ok: false, status: 500 }));

        const temp = await fetchWaterTemp();
        assert.equal(temp, null);
    });
});

// ─── getPoRFromHistory ────────────────────────────────────────────────────────

describe('getPoRFromHistory', () => {
    it('returns null for empty history', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        t.mock.timers.setTime(1700000000000);

        assert.equal(getPoRFromHistory([], 20), null);
        assert.equal(getPoRFromHistory(null, 20), null);
    });

    it('returns closest match within 1 hour tolerance', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        const now = 1700000000000;
        t.mock.timers.setTime(now);

        const targetTime = now - 20 * 60 * 60 * 1000;  // 20 hours ago
        const history = [
            { timestamp: targetTime - 10 * 60 * 1000, cfs: 8500 },  // 10 min before target
            { timestamp: targetTime + 5 * 60 * 1000, cfs: 8600 },   // 5 min after target (closest)
        ];

        const result = getPoRFromHistory(history, 20);
        assert.ok(result);
        assert.equal(result.cfs, 8600);
        assert.ok(Math.abs(result.actualHoursAgo - 20) < 0.2);
    });

    it('returns null when closest exceeds 1 hour tolerance', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        const now = 1700000000000;
        t.mock.timers.setTime(now);

        const targetTime = now - 20 * 60 * 60 * 1000;
        const history = [
            { timestamp: targetTime - 2 * 60 * 60 * 1000, cfs: 8000 },  // 2 hrs before target
        ];

        const result = getPoRFromHistory(history, 20);
        assert.equal(result, null);
    });

    it('computes correct actualHoursAgo', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        const now = 1700000000000;
        t.mock.timers.setTime(now);

        const threeHoursAgo = now - 3 * 60 * 60 * 1000;
        const history = [
            { timestamp: threeHoursAgo, cfs: 9000 },
        ];

        const result = getPoRFromHistory(history, 3);
        assert.ok(result);
        assert.ok(Math.abs(result.actualHoursAgo - 3) < 0.01);
    });
});

// ─── estimateLFStage ──────────────────────────────────────────────────────────

describe('estimateLFStage', () => {
    it('round-trips with estimateLFFlowFromStage at breakpoints', () => {
        const testFlows = [600, 1300, 2000, 5000, 10000, 28000, 50000, 80000, 150000];
        for (const cfs of testFlows) {
            const stage = estimateLFStage(cfs);
            const flowBack = estimateLFFlowFromStage(stage);
            assert.ok(
                Math.abs(flowBack - cfs) < 5,
                `Round-trip failed for ${cfs}: stage=${stage}, flowBack=${flowBack}`
            );
        }
    });

    it('returns low stage for low flow', () => {
        const stage = estimateLFStage(300);
        assert.ok(stage > 2.40 && stage < 2.46, `Expected 2.40-2.46, got ${stage}`);
    });

    it('is monotonically increasing', () => {
        const flows = [0, 600, 1300, 2000, 3200, 5000, 10000, 28000, 50000, 80000, 150000, 200000];
        for (let i = 1; i < flows.length; i++) {
            const prev = estimateLFStage(flows[i - 1]);
            const curr = estimateLFStage(flows[i]);
            assert.ok(curr > prev, `Stage at ${flows[i]} (${curr}) should be > stage at ${flows[i-1]} (${prev})`);
        }
    });
});

// ─── makeGFPrediction ─────────────────────────────────────────────────────────

describe('makeGFPrediction', () => {
    function buildUsgsData(overrides = {}) {
        const gauges = {
            por: '01638500',
            lf: '01646500',
            monocacy: '01643000',
            goose: '01644000',
            broadRun: '01644280',
            seneca: '01645000',
            ef: '01644148'
        };
        const data = {
            '01638500': { q: 10000, history: [] },
            '01646500': { q: 11000, h: 3.85 },
            '01643000': { q: 800 },
            '01644000': { q: 350 },
            '01644280': { q: 75 },
            '01645000': { q: 100 },
            '01644148': { h: 4.50 },
            ...overrides
        };
        return { gauges, data };
    }

    it('returns null when LF data is missing', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        t.mock.timers.setTime(1700000000000);

        const usgsData = buildUsgsData({ '01646500': {} });
        const result = makeGFPrediction(usgsData, []);
        assert.equal(result, null);
    });

    it('returns null when PoR data is missing', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        t.mock.timers.setTime(1700000000000);

        const usgsData = buildUsgsData({ '01638500': {} });
        const result = makeGFPrediction(usgsData, []);
        assert.equal(result, null);
    });

    it('returns a prediction with expected shape', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        t.mock.timers.setTime(1700000000000);

        const usgsData = buildUsgsData();
        const result = makeGFPrediction(usgsData, []);

        assert.ok(result);
        assert.equal(typeof result.predictedCFS, 'number');
        assert.equal(typeof result.predictedStage, 'number');
        assert.ok(result.predictedCFS > 0);
        assert.ok(result.predictedStage > 0);
        assert.equal(typeof result.timestamp, 'string');
        assert.equal(typeof result.flowBin, 'string');
        assert.equal(typeof result.flowState, 'string');
        assert.equal(typeof result.validationDue, 'string');
        assert.equal(typeof result.porCFS, 'number');
        assert.equal(typeof result.lfCFS, 'number');
    });

    it('uses cold EF model when water temp is below threshold', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        t.mock.timers.setTime(1700000000000);

        const usgsData = buildUsgsData();
        const coldResult = makeGFPrediction(usgsData, [], 5.0);
        assert.equal(coldResult.efModelType, 'cold');
        assert.equal(coldResult.waterTempC, 5.0);
    });

    it('uses default EF model when water temp is above threshold', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        t.mock.timers.setTime(1700000000000);

        const usgsData = buildUsgsData();
        const warmResult = makeGFPrediction(usgsData, [], 15.0);
        assert.equal(warmResult.efModelType, 'default');
    });

    it('applies ceiling when estimate exceeds CEILING_RATIO of LF', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        t.mock.timers.setTime(1700000000000);

        // Set PoR very high relative to LF to trigger ceiling
        const usgsData = buildUsgsData({
            '01638500': { q: 50000, history: [] },
            '01646500': { q: 5000, h: 3.35 },
            '01644148': {},  // No EF stage to avoid ensemble
        });
        const result = makeGFPrediction(usgsData, []);
        assert.ok(result);
        // Ceiling = 5000 * 1.20 = 6000
        assert.ok(result.predictedCFS <= 6000, `Expected <= 6000, got ${result.predictedCFS}`);
        assert.equal(result.ceilingApplied, true);
    });

    it('skips EF ensemble when discrepancy exceeds 50%', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        t.mock.timers.setTime(1700000000000);

        // Set EF stage very high to produce a huge EF estimate
        const usgsData = buildUsgsData({
            '01644148': { h: 15.0 },  // Very high EF stage
        });
        const result = makeGFPrediction(usgsData, []);
        assert.ok(result);
        // Should skip EF due to >50% discrepancy
        assert.equal(result.useEfEnsemble, false);
    });

    it('uses tributary fallbacks when gauge data is missing', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        t.mock.timers.setTime(1700000000000);

        const usgsData = buildUsgsData({
            '01643000': {},  // No monocacy
            '01644000': {},  // No goose
            '01644280': {},  // No broad run
            '01645000': {},  // No seneca
            '01644148': {},  // No EF
        });
        const result = makeGFPrediction(usgsData, []);
        assert.ok(result);
        // Monocacy fallback = LF * 0.071 = 11000 * 0.071 = 781
        assert.equal(result.monocacyCFS, Math.round(11000 * 0.071));
    });

    it('does not include EF when stage is below minStage', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        t.mock.timers.setTime(1700000000000);

        const usgsData = buildUsgsData({
            '01644148': { h: 1.0 },  // Below EF_MODEL.minStage (2.5)
        });
        const result = makeGFPrediction(usgsData, []);
        assert.ok(result);
        assert.equal(result.useEfEnsemble, false);
        assert.equal(result.efEstimateCFS, null);
    });

    it('does not include EF when stage is above maxStage', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        t.mock.timers.setTime(1700000000000);

        const usgsData = buildUsgsData({
            '01644148': { h: 25.0 },  // Above EF_MODEL.maxStage (20.0)
        });
        const result = makeGFPrediction(usgsData, []);
        assert.ok(result);
        assert.equal(result.useEfEnsemble, false);
        assert.equal(result.efEstimateCFS, null);
    });
});

// ─── scoreShadowPredictions ─────────────────────────────────────────────────

describe('scoreShadowPredictions', () => {
    it('returns null for null shadowModels', () => {
        const result = scoreShadowPredictions(null, 10000, 5.0, null);
        assert.equal(result, null);
    });

    it('returns null for zero actualCFS', () => {
        const shadows = { lfFeedback: 10500, onlineRegression: 9800, kalman: 10200 };
        const result = scoreShadowPredictions(shadows, 0, 5.0, null);
        assert.equal(result, null);
    });

    it('initializes leaderboard from scratch with correct error calculations', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        t.mock.timers.setTime(1700000000000);

        const shadows = { lfFeedback: 10500, onlineRegression: 9800, kalman: 10200 };
        const actualCFS = 10000;
        const productionErrorPercent = 3.0;  // production predicted 10300

        const result = scoreShadowPredictions(shadows, actualCFS, productionErrorPercent, null);
        assert.ok(result);
        assert.equal(result.totalRounds, 1);

        // Production: |3.0| = 3.0%
        assert.equal(result.models.production.count, 1);
        assert.equal(result.models.production.meanAbsErrorPercent, 3.0);

        // LF Feedback: |((10500 - 10000) / 10000) * 100| = 5.0%
        assert.equal(result.models.lfFeedback.count, 1);
        assert.equal(result.models.lfFeedback.meanAbsErrorPercent, 5.0);

        // Online Regression: |((9800 - 10000) / 10000) * 100| = 2.0%
        assert.equal(result.models.onlineRegression.count, 1);
        assert.equal(result.models.onlineRegression.meanAbsErrorPercent, 2.0);

        // Kalman: |((10200 - 10000) / 10000) * 100| = 2.0%
        assert.equal(result.models.kalman.count, 1);
        assert.equal(result.models.kalman.meanAbsErrorPercent, 2.0);

        // Winner should be onlineRegression or kalman (both 2.0%, first found wins)
        assert.ok(['onlineRegression', 'kalman'].includes(result.lastWinner));
    });

    it('skips shadow models with null predictions', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        t.mock.timers.setTime(1700000000000);

        const shadows = { lfFeedback: null, onlineRegression: 9800, kalman: null };
        const result = scoreShadowPredictions(shadows, 10000, 5.0, null);
        assert.ok(result);
        assert.equal(result.models.lfFeedback.count, 0);
        assert.equal(result.models.onlineRegression.count, 1);
        assert.equal(result.models.kalman.count, 0);
        assert.equal(result.models.production.count, 1);
    });

    it('accumulates counts across multiple rounds', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        t.mock.timers.setTime(1700000000000);

        const shadows1 = { lfFeedback: 10500, onlineRegression: 9800, kalman: 10200 };
        const lb1 = scoreShadowPredictions(shadows1, 10000, 3.0, null);

        const shadows2 = { lfFeedback: 11000, onlineRegression: 10100, kalman: 10300 };
        const lb2 = scoreShadowPredictions(shadows2, 10000, 2.0, lb1);

        assert.equal(lb2.totalRounds, 2);
        assert.equal(lb2.models.production.count, 2);
        assert.equal(lb2.models.lfFeedback.count, 2);
        assert.equal(lb2.models.onlineRegression.count, 2);
        assert.equal(lb2.models.kalman.count, 2);

        // Production: (3.0 + 2.0) / 2 = 2.5%
        assert.equal(lb2.models.production.meanAbsErrorPercent, 2.5);
    });

    it('tracks best streak correctly across winner changes', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        t.mock.timers.setTime(1700000000000);

        // Round 1: production wins (lowest error)
        const shadows1 = { lfFeedback: 12000, onlineRegression: 11000, kalman: 11500 };
        const lb1 = scoreShadowPredictions(shadows1, 10000, 1.0, null);  // production = 1%
        assert.equal(lb1.lastWinner, 'production');
        assert.equal(lb1.models.production.currentStreak, 1);

        // Round 2: production wins again
        const shadows2 = { lfFeedback: 12000, onlineRegression: 11000, kalman: 11500 };
        const lb2 = scoreShadowPredictions(shadows2, 10000, 0.5, lb1);  // production = 0.5%
        assert.equal(lb2.lastWinner, 'production');
        assert.equal(lb2.models.production.currentStreak, 2);
        assert.equal(lb2.models.production.bestStreak, 2);

        // Round 3: onlineRegression wins — production streak breaks
        const shadows3 = { lfFeedback: 12000, onlineRegression: 10050, kalman: 11500 };
        const lb3 = scoreShadowPredictions(shadows3, 10000, 10.0, lb2);  // production = 10%, OR = 0.5%
        assert.equal(lb3.lastWinner, 'onlineRegression');
        assert.equal(lb3.models.production.currentStreak, 0);
        assert.equal(lb3.models.production.bestStreak, 2);  // bestStreak preserved
        assert.equal(lb3.models.onlineRegression.currentStreak, 1);
    });
});

// ─── storePrediction error handling ─────────────────────────────────────────

describe('storePrediction', () => {
    function mockClient({ insertError = null, selectData = null, upsertError = null } = {}) {
        return {
            from: () => ({
                insert: () => Promise.resolve({ error: insertError }),
                select: () => ({
                    eq: () => ({
                        eq: () => ({
                            single: () => Promise.resolve({ data: selectData, error: null })
                        })
                    })
                }),
                upsert: () => Promise.resolve({ error: upsertError }),
            })
        };
    }

    it('stores prediction and updates metadata on success', async () => {
        const metaData = { totalValidations: 0, totalPredictions: 5 };
        let upsertCalled = false;
        let fromCallCount = 0;
        // storePrediction flow: (1) select existing pending, (2) insert, (3) select metadata, (4) upsert
        const client = {
            from: () => {
                fromCallCount++;
                const callNum = fromCallCount;
                return {
                    select: () => ({
                        eq: () => ({
                            eq: () => ({
                                single: () => {
                                    if (callNum === 1) {
                                        // Check existing pending — none
                                        return Promise.resolve({ data: null, error: null });
                                    }
                                    // Get metadata
                                    return Promise.resolve({ data: { data: metaData }, error: null });
                                }
                            })
                        })
                    }),
                    delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
                    insert: () => Promise.resolve({ error: null }),
                    upsert: () => { upsertCalled = true; return Promise.resolve({ error: null }); },
                };
            }
        };

        await storePrediction(client, { predictedCFS: 10000, validationDue: '2026-01-01' });
        assert.equal(upsertCalled, true);
    });

    it('skips metadata update when INSERT fails', async () => {
        let metadataCalled = false;
        let fromCallCount = 0;
        const client = {
            from: () => {
                fromCallCount++;
                const callNum = fromCallCount;
                return {
                    select: () => ({
                        eq: () => ({
                            eq: () => ({
                                single: () => {
                                    if (callNum === 1) {
                                        // Check existing pending — none
                                        return Promise.resolve({ data: null, error: null });
                                    }
                                    // Should never reach metadata select
                                    metadataCalled = true;
                                    return Promise.resolve({ data: null, error: null });
                                }
                            })
                        })
                    }),
                    delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
                    insert: () => Promise.resolve({ error: { message: 'RLS blocked', code: '42501', details: null } }),
                    upsert: () => { metadataCalled = true; return Promise.resolve({ error: null }); },
                };
            }
        };

        await storePrediction(client, { predictedCFS: 10000, validationDue: '2026-01-01' });
        // Should return early — metadata select and upsert should NOT be called
        assert.equal(metadataCalled, false);
    });
});

// ─── validatePendingPredictions error handling ──────────────────────────────

describe('validatePendingPredictions', () => {
    it('returns 0 when LF data is missing', async () => {
        const client = {};
        const usgsData = {
            data: { '01646500': {} },
            gauges: { lf: '01646500', seneca: '01645000', ef: '01644148' }
        };
        const result = await validatePendingPredictions(client, usgsData);
        assert.equal(result, 0);
    });

    it('returns 0 when no pending predictions exist', async () => {
        const client = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        eq: () => ({
                            order: () => Promise.resolve({ data: [], error: null })
                        })
                    })
                })
            })
        };
        const usgsData = {
            data: { '01646500': { q: 10000, h: 3.95 }, '01645000': {}, '01644148': {} },
            gauges: { lf: '01646500', seneca: '01645000', ef: '01644148' }
        };
        const result = await validatePendingPredictions(client, usgsData);
        assert.equal(result, 0);
    });

    // ── C12: claim-delete idempotency + invalid/stale deadlock cleanup ──
    // Universal mock for the full validation-window branch: select→single returns null
    // (callers fall back to defaults); upserts/inserts are captured; the pending-list read
    // resolves via .order(); `.delete().eq()` awaited directly returns {error:null} (stale/
    // invalid cleanup) while `.delete().eq().select()` returns the claimed rows.
    function validateClient({ pending, claimRows = [{ id: 'p1' }], captures }) {
        return {
            from() {
                const q = { op: 'select' };
                const builder = {
                    select() {
                        if (q.op === 'delete') {
                            captures.deletes.push({ withSelect: true });
                            return Promise.resolve({ data: claimRows, error: null });
                        }
                        return builder;
                    },
                    eq() { return builder; },
                    order() { return Promise.resolve({ data: pending, error: null }); },
                    single() { return Promise.resolve({ data: null, error: null }); },
                    upsert(row) { captures.upserts.push(row); return Promise.resolve({ error: null }); },
                    insert(row) { captures.inserts.push(row); return Promise.resolve({ error: null }); },
                    delete() { q.op = 'delete'; return builder; },
                    then(resolve, reject) {
                        if (q.op === 'delete') { captures.deletes.push({ withSelect: false }); return Promise.resolve({ error: null }).then(resolve, reject); }
                        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
                    },
                };
                return builder;
            }
        };
    }

    // LF at 10000cfs/3.95ft is self-consistent on the rating curve → no hard anomaly flag,
    // so a claimed prediction reaches the learning (gf_correction_bin) upsert.
    const usgs = {
        data: { '01646500': { q: 10000, h: 3.95 }, '01645000': {}, '01644148': {} },
        gauges: { lf: '01646500', seneca: '01645000', ef: '01644148' }
    };
    function pendingRow(overrides = {}) {
        return {
            id: 'p1',
            created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h old — not stale
            data: {
                validationDue: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // due 10min ago — in window
                predictedCFS: 10500, predictedStage: 4.0,
                flowBin: '7500-12000', flowState: 'steady',
                ...overrides
            }
        };
    }
    const binUpserts = (caps) => caps.upserts.filter(u => u.observation_type === 'gf_correction_bin');

    it('claim succeeds (1 row) → learns: a correction bin is upserted, validated=1', async () => {
        const captures = { upserts: [], inserts: [], deletes: [] };
        const client = validateClient({ pending: [pendingRow()], claimRows: [{ id: 'p1' }], captures });
        const result = await validatePendingPredictions(client, usgs);
        assert.equal(result.validated, 1);
        assert.ok(binUpserts(captures).length >= 1, 'expected a gf_correction_bin upsert');
    });

    it('claim returns 0 rows (already claimed) → NO learning, validated=0 (idempotency)', async () => {
        const captures = { upserts: [], inserts: [], deletes: [] };
        const client = validateClient({ pending: [pendingRow()], claimRows: [], captures });
        const result = await validatePendingPredictions(client, usgs);
        assert.equal(result.validated, 0);
        assert.equal(binUpserts(captures).length, 0, 'must not learn when the row was not claimed');
    });

    it('invalid validationDue → row deleted (cleaned), not learned (FIX 1 deadlock)', async () => {
        const captures = { upserts: [], inserts: [], deletes: [] };
        const client = validateClient({ pending: [pendingRow({ validationDue: 'not-a-date' })], captures });
        const result = await validatePendingPredictions(client, usgs);
        assert.equal(result.cleaned, 1);
        assert.equal(result.validated, 0);
        assert.equal(binUpserts(captures).length, 0);
        assert.ok(captures.deletes.some(d => !d.withSelect), 'invalid-date row should be deleted');
    });

    it('stale (>48h) prediction → cleaned, not learned (reorder regression)', async () => {
        const captures = { upserts: [], inserts: [], deletes: [] };
        const stale = pendingRow();
        stale.created_at = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString();
        const client = validateClient({ pending: [stale], captures });
        const result = await validatePendingPredictions(client, usgs);
        assert.equal(result.cleaned, 1);
        assert.equal(result.validated, 0);
        assert.equal(binUpserts(captures).length, 0);
    });
});

// ─── Server Shadow Models ────────────────────────────────────────────────────

describe('Server shadow models', () => {

    describe('shadowLFFeedback', () => {
        it('returns corrected CFS with valid inputs', () => {
            const state = { correctionFactor: 0, lastPredictedLF: null, lastPredictionTime: null, alpha: 0.4 };
            const result = shadowLFFeedback(5000, 4800, state);
            assert.ok(result);
            assert.equal(result.cfs, 5000);
            assert.ok(typeof result.stage === 'number');
        });

        it('returns null with missing LF', () => {
            const state = { correctionFactor: 0, lastPredictedLF: null, lastPredictionTime: null, alpha: 0.4 };
            const result = shadowLFFeedback(5000, null, state);
            assert.equal(result, null);
        });

        it('returns null with zero production', () => {
            const state = { correctionFactor: 0, lastPredictedLF: null, lastPredictionTime: null, alpha: 0.4 };
            const result = shadowLFFeedback(0, 4800, state);
            assert.equal(result, null);
        });

        it('updates correction factor after validation window', () => {
            const state = {
                correctionFactor: 0,
                lastPredictedLF: 5000,
                lastPredictionTime: Date.now() - 6 * 3600000,
                alpha: 0.4
            };
            shadowLFFeedback(5000, 5500, state);
            assert.ok(state.correctionFactor !== 0);
        });

        it('stores prediction for future validation', () => {
            const state = { correctionFactor: 0, lastPredictedLF: null, lastPredictionTime: null, alpha: 0.4 };
            shadowLFFeedback(5000, 4800, state);
            assert.equal(state.lastPredictedLF, 5000);
            assert.ok(state.lastPredictionTime !== null);
        });
    });

    describe('shadowOnlineRegression', () => {
        it('returns CFS with valid inputs', () => {
            const state = { weights: null, learningRate: 0.001, nFeatures: 9, trainCount: 0 };
            const inputs = {
                porCFS: 8000, porROC: 2, efEstimateCFS: 6000,
                tribSumCFS: 500, lfActualCFS: 7000, hourFraction: 12
            };
            const result = shadowOnlineRegression(7500, inputs, state);
            assert.ok(result);
            assert.ok(result.cfs > 0);
            assert.ok(typeof result.stage === 'number');
        });

        it('initializes weights on first run', () => {
            const state = { weights: null, learningRate: 0.001, nFeatures: 9, trainCount: 0 };
            const inputs = {
                porCFS: 8000, porROC: 0, efEstimateCFS: 0,
                tribSumCFS: 0, lfActualCFS: 7000, hourFraction: 12
            };
            shadowOnlineRegression(7500, inputs, state);
            assert.ok(Array.isArray(state.weights));
            assert.equal(state.weights.length, 9);
            assert.ok(Math.abs(state.weights[1] - 1.0) < 0.01);
        });

        it('returns null with missing PoR', () => {
            const state = { weights: null, learningRate: 0.001, nFeatures: 9, trainCount: 0 };
            const inputs = {
                porCFS: null, porROC: 0, efEstimateCFS: 0,
                tribSumCFS: 0, lfActualCFS: 7000, hourFraction: 12
            };
            const result = shadowOnlineRegression(7500, inputs, state);
            assert.equal(result, null);
        });

        it('increments trainCount after SGD step', () => {
            const state = { weights: null, learningRate: 0.001, nFeatures: 9, trainCount: 0 };
            const inputs = {
                porCFS: 8000, porROC: 0, efEstimateCFS: 6000,
                tribSumCFS: 500, lfActualCFS: 7000, hourFraction: 12
            };
            shadowOnlineRegression(7500, inputs, state);
            assert.ok(state.trainCount > 0);
        });
    });

    describe('shadowKalman', () => {
        it('returns CFS with valid inputs', () => {
            const state = { x: null, P: null, Q_base: 0.0001, initialized: false };
            const inputs = { lfActualCFS: 7000, porCFS: 8000, efEstimateCFS: 6000, isRising: false };
            const result = shadowKalman(7500, inputs, state);
            assert.ok(result);
            assert.ok(result.cfs > 0);
            assert.ok(typeof result.stage === 'number');
        });

        it('initializes state on first run', () => {
            const state = { x: null, P: null, Q_base: 0.0001, initialized: false };
            const inputs = { lfActualCFS: 7000, porCFS: 8000, efEstimateCFS: 6000, isRising: false };
            shadowKalman(7500, inputs, state);
            assert.equal(state.initialized, true);
            assert.ok(state.x > 0);
            assert.ok(state.P > 0);
        });

        it('returns null with missing LF', () => {
            const state = { x: null, P: null, Q_base: 0.0001, initialized: false };
            const inputs = { lfActualCFS: null, porCFS: 8000, efEstimateCFS: 6000, isRising: false };
            const result = shadowKalman(7500, inputs, state);
            assert.equal(result, null);
        });

        it('updates x and P after assimilation', () => {
            const state = { x: 7000, P: 490000, Q_base: 0.0001, initialized: true };
            const inputs = { lfActualCFS: 7500, porCFS: 8000, efEstimateCFS: 6000, isRising: false };
            const xBefore = state.x;
            shadowKalman(7000, inputs, state);
            assert.notEqual(state.x, xBefore);
        });

        it('uses higher process noise when rising', () => {
            const stateRising = { x: 7000, P: 490000, Q_base: 0.0001, initialized: true };
            const stateSteady = { x: 7000, P: 490000, Q_base: 0.0001, initialized: true };
            const inputsR = { lfActualCFS: 7500, porCFS: 8000, efEstimateCFS: 6000, isRising: true };
            const inputsS = { lfActualCFS: 7500, porCFS: 8000, efEstimateCFS: 6000, isRising: false };
            shadowKalman(7000, inputsR, stateRising);
            shadowKalman(7000, inputsS, stateSteady);
            // Rising should have more uncertainty, so P should differ
            assert.notEqual(stateRising.P, stateSteady.P);
        });
    });

    describe('runServerShadowModels', () => {
        it('returns results for all three models', () => {
            const usgsData = {
                data: {
                    '01646500': { q: 7000 },
                    '01638500': { q: 8000 },
                    '01643000': { q: 500 },
                    '01644000': { q: 200 },
                    '01644280': { q: 50 },
                    '01645000': { q: 60 }
                },
                gauges: {
                    lf: '01646500', por: '01638500',
                    monocacy: '01643000', goose: '01644000',
                    broadRun: '01644280', seneca: '01645000'
                }
            };
            const prediction = { efEstimateCFS: 6000 };
            const porRiseRate = { ratePerHour: 0.5, flowState: 'steady' };
            const shadowState = {
                lfFeedback: { correctionFactor: 0, lastPredictedLF: null, lastPredictionTime: null, alpha: 0.4 },
                onlineRegression: { weights: null, learningRate: 0.001, nFeatures: 9, trainCount: 0 },
                kalman: { x: null, P: null, Q_base: 0.0001, initialized: false }
            };
            const results = runServerShadowModels(7500, usgsData, prediction, porRiseRate, shadowState);
            assert.ok(results.lfFeedback !== null);
            assert.ok(results.onlineRegression !== null);
            assert.ok(results.kalman !== null);
        });

        it('handles missing gauge data gracefully', () => {
            const usgsData = {
                data: {},
                gauges: {
                    lf: '01646500', por: '01638500',
                    monocacy: '01643000', goose: '01644000',
                    broadRun: '01644280', seneca: '01645000'
                }
            };
            const prediction = { efEstimateCFS: 0 };
            const shadowState = {
                lfFeedback: { correctionFactor: 0, lastPredictedLF: null, lastPredictionTime: null, alpha: 0.4 },
                onlineRegression: { weights: null, learningRate: 0.001, nFeatures: 9, trainCount: 0 },
                kalman: { x: null, P: null, Q_base: 0.0001, initialized: false }
            };
            const results = runServerShadowModels(7500, usgsData, prediction, null, shadowState);
            assert.equal(results.lfFeedback, null);
            assert.equal(results.onlineRegression, null);
            assert.equal(results.kalman, null);
        });
    });

    describe('estimateLFStage (from shared/model)', () => {
        it('returns correct stage for known CFS values', () => {
            assert.ok(Math.abs(estimateLFStage(600) - 2.46) < 0.01);
            assert.ok(Math.abs(estimateLFStage(5000) - 3.35) < 0.01);
            assert.ok(Math.abs(estimateLFStage(10000) - 3.95) < 0.01);
        });

        it('handles zero CFS', () => {
            assert.ok(Math.abs(estimateLFStage(0) - 2.40) < 0.01);
        });

        it('handles very high CFS', () => {
            const stage = estimateLFStage(200000);
            assert.ok(stage > 10.93);
        });
    });
});

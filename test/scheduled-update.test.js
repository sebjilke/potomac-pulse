const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const {
    validateUSGSResponse, fetchWithTimeout, fetchWaterTemp,
    getPoRFromHistory, estimateLFStage, makeGFPrediction,
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

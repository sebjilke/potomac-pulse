// Characterization tests for loadGFLearningData (sync-learning.js).
//
// Written test-first (#12): they lock in the CURRENT sequential behavior — the asymmetric error
// semantics (bins/pending throw -> 500; metadata/efCorrelation/shadowLeaderboard tolerate a missing
// row), the efCorrelation sumCFSSq on-load heal, the correctionBins build, and the pending mapping —
// so the subsequent Promise.all refactor can be proven behavior-equivalent. The file had no DB-site
// test coverage before this.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { loadGFLearningData } = require('../netlify/functions/sync-learning')._test;

// Mock Supabase client modelled on the validateClient idiom in scheduled-update.test.js:
// a chainable builder that records observation_type from .eq(), and resolves a scripted {data,error}
// at each terminal — `then` (bins, awaited after .eq), `.limit()` (pending), and `.single()`
// (metadata/efCorrelation/shadowLeaderboard). `scripts` is keyed by observation_type; an absent key
// resolves to {data:null, error:null} (the no-error tolerated path).
function mockClient(scripts) {
    return {
        from() {
            let obsType = null;
            const result = () => Promise.resolve(scripts[obsType] ?? { data: null, error: null });
            const builder = {
                select() { return builder; },
                eq(col, val) { if (col === 'observation_type') obsType = val; return builder; },
                order() { return builder; },
                limit() { return result(); },                                  // pending terminal
                single() { return result(); },                                 // meta/efCorr/shadow terminal
                then(resolve, reject) { return result().then(resolve, reject); } // bins terminal (awaited)
            };
            return builder;
        }
    };
}

const DB_ERR = { message: 'boom', code: 'PGRST500' };
const SINGLE_MISS = { message: 'No rows found', code: 'PGRST116' }; // supabase .single() on 0 rows

// Helper: parse the handler-style response body.
const parse = (res) => JSON.parse(res.body);

describe('loadGFLearningData — happy path', () => {
    it('assembles bins, pending, metadata, efCorrelation (sumCFSSq healed), and shadowLeaderboard', async () => {
        const binRow = { count: 5, sumError: 210, sumErrorSq: 9000, meanError: 42 };
        const client = mockClient({
            gf_correction_bin: { data: [{ gauge_id: '6000-12000_steady', data: binRow }], error: null },
            gf_prediction: { data: [{ data: { predictedCFS: 9000, flowBin: '6000-12000' }, created_at: '2026-06-19T00:00:00Z' }], error: null },
            gf_metadata: { data: { data: { totalValidations: 7, totalPredictions: 10, avgErrorPercent: 3.2 } }, error: null },
            ef_gf_correlation: { data: { data: { slope: 100, intercept: 50, points: [{ cfs: 10 }, { cfs: 20 }], sumCFSSq: 99999 } }, error: null },
            shadow_leaderboard: { data: { data: { totalRounds: 4 } }, error: null }
        });

        const res = await loadGFLearningData(client);
        assert.equal(res.statusCode, 200);
        const body = parse(res);

        // correctionBins: the populated cell carries the row's data; all 18 cells exist (6 bins × 3 states)
        assert.deepEqual(body.correctionBins['6000-12000'].steady, binRow);
        assert.deepEqual(body.correctionBins['0-3000'].rising, { count: 0, sumError: 0, sumErrorSq: 0, meanError: 0 });
        assert.equal(Object.keys(body.correctionBins).length, 6);

        // pending: data spread + created_at merged in
        assert.deepEqual(body.pendingPredictions, [{ predictedCFS: 9000, flowBin: '6000-12000', created_at: '2026-06-19T00:00:00Z' }]);

        // metadata: the row's .data
        assert.deepEqual(body.metadata, { totalValidations: 7, totalPredictions: 10, avgErrorPercent: 3.2 });

        // efCorrelation: sumCFSSq is recomputed from points (10²+20²=500), overwriting the bogus stored 99999
        assert.equal(body.efCorrelation.slope, 100);
        assert.equal(body.efCorrelation.sumCFSSq, 500);

        // shadowLeaderboard: the row's .data
        assert.deepEqual(body.shadowLeaderboard, { totalRounds: 4 });

        // efDivergence: absent row -> null (v37.13; tolerated like metadata)
        assert.equal(body.efDivergence, null);
    });
});

describe('loadGFLearningData — efDivergence advisory state (v37.13)', () => {
    it('ships only the render-relevant fields from the state row', async () => {
        const client = mockClient({
            gf_correction_bin: { data: [], error: null },
            gf_prediction: { data: [], error: null },
            ef_divergence: { data: { data: {
                active: true, dbar: 1.27, activeSince: '2026-07-20T02:00:00Z',
                updatedAt: '2026-07-20T12:00:00Z', coldLockout: false,
                samples: [{ t: 1, d: 1.3 }]   // server-internal — must NOT ship
            } }, error: null }
        });
        const body = parse(await loadGFLearningData(client));
        assert.deepEqual(body.efDivergence, {
            active: true, dbar: 1.27,
            activeSince: '2026-07-20T02:00:00Z', updatedAt: '2026-07-20T12:00:00Z'
        });
    });

    it('a missing state row yields efDivergence: null (no error)', async () => {
        const client = mockClient({
            gf_correction_bin: { data: [], error: null },
            gf_prediction: { data: [], error: null },
            ef_divergence: { data: null, error: SINGLE_MISS }
        });
        const res = await loadGFLearningData(client);
        assert.equal(res.statusCode, 200);
        assert.equal(parse(res).efDivergence, null);
    });
});

describe('loadGFLearningData — error semantics (asymmetric)', () => {
    it('THROWS -> 500 when the correction-bins query errors', async () => {
        const res = await loadGFLearningData(mockClient({
            gf_correction_bin: { data: null, error: DB_ERR }
        }));
        assert.equal(res.statusCode, 500);
        assert.equal(parse(res).error, 'Failed to load GF learning data');
    });

    it('THROWS -> 500 when the pending query errors (bins ok)', async () => {
        const res = await loadGFLearningData(mockClient({
            gf_correction_bin: { data: [], error: null },
            gf_prediction: { data: null, error: DB_ERR }
        }));
        assert.equal(res.statusCode, 500);
        assert.equal(parse(res).error, 'Failed to load GF learning data');
    });

    it('TOLERATES a missing metadata row -> 200 with default metadata', async () => {
        const res = await loadGFLearningData(mockClient({
            gf_metadata: { data: null, error: SINGLE_MISS }
        }));
        assert.equal(res.statusCode, 200);
        assert.deepEqual(parse(res).metadata, {
            totalValidations: 0, totalPredictions: 0, avgErrorPercent: null, lastValidation: null
        });
    });

    it('TOLERATES a missing efCorrelation row -> 200 with efCorrelation null', async () => {
        const res = await loadGFLearningData(mockClient({
            ef_gf_correlation: { data: null, error: SINGLE_MISS }
        }));
        assert.equal(res.statusCode, 200);
        assert.equal(parse(res).efCorrelation, null);
    });

    it('TOLERATES a missing shadowLeaderboard row -> 200 with shadowLeaderboard null', async () => {
        const res = await loadGFLearningData(mockClient({
            shadow_leaderboard: { data: null, error: SINGLE_MISS }
        }));
        assert.equal(res.statusCode, 200);
        assert.equal(parse(res).shadowLeaderboard, null);
    });
});

describe('loadGFLearningData — edge cases', () => {
    it('cold start: bins/pending null (no error) -> empty 18-bin scaffold + empty pending, 200', async () => {
        const res = await loadGFLearningData(mockClient({})); // every query resolves {data:null,error:null}
        assert.equal(res.statusCode, 200);
        const body = parse(res);
        assert.equal(Object.keys(body.correctionBins).length, 6);
        assert.deepEqual(body.correctionBins['25000-50000'].falling, { count: 0, sumError: 0, sumErrorSq: 0, meanError: 0 });
        assert.deepEqual(body.pendingPredictions, []);
        assert.equal(body.metadata.totalValidations, 0);
        assert.equal(body.efCorrelation, null);
        assert.equal(body.shadowLeaderboard, null);
    });

    it('recomputes efCorrelation.sumCFSSq from points even when no prior sumCFSSq exists', async () => {
        const res = await loadGFLearningData(mockClient({
            ef_gf_correlation: { data: { data: { slope: 1, points: [{ cfs: 3 }, { cfs: 4 }] } }, error: null }
        }));
        assert.equal(res.statusCode, 200);
        assert.equal(parse(res).efCorrelation.sumCFSSq, 25); // 3²+4²
    });
});

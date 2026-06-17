// v36.1 — CROSS-CHECK: the offline CI backtest harness (analysis/ci_backtest_harness.mjs)
// must reproduce the REAL server validation/learning path bit-for-bit. The EMA math is already
// shared (updateCorrectionBin), so the only harness REIMPLEMENTATION is the anomaly scoring
// (scoreAnomalies vs validatePendingPredictions Checks 1-5). This test drives the REAL
// validatePendingPredictions with a mock Supabase client, captures the learned correction bin,
// and asserts it equals what the harness path produces from the same inputs — across a clean,
// a HARD-flagged (skip), and a SOFT-flagged (clamp at count>=10) scenario. (Plan §6/§12 C-F1.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _test } = require('../netlify/functions/scheduled-update.js');
const { validatePendingPredictions } = _test;
const { updateCorrectionBin } = require('../netlify/functions/shared/model.js');
const { scoreAnomalies } = await import('../analysis/ci_backtest_harness.mjs');

const clone = (o) => JSON.parse(JSON.stringify(o));

// Mock client driving validatePendingPredictions through the full validation-window branch.
// single() returns the seeded existing bin ONLY for the matching flow-bin gauge_id (so stage_*
// and metadata lookups still fall back to defaults). Captures bin upserts.
function makeClient({ pending, claimRows = [{ id: 'p1' }], seedBin = null, binKey = null, captures }) {
    return {
        from() {
            const q = { op: 'select', filters: {} };
            const builder = {
                select() {
                    if (q.op === 'delete') { captures.deletes.push({ withSelect: true }); return Promise.resolve({ data: claimRows, error: null }); }
                    return builder;
                },
                eq(col, val) { q.filters[col] = val; return builder; },
                order() { return Promise.resolve({ data: pending, error: null }); },
                single() {
                    if (seedBin && q.filters.observation_type === 'gf_correction_bin' && q.filters.gauge_id === binKey) {
                        return Promise.resolve({ data: { data: clone(seedBin) }, error: null });
                    }
                    return Promise.resolve({ data: null, error: null });
                },
                upsert(row) { captures.upserts.push(row); return Promise.resolve({ error: null }); },
                insert(row) { captures.inserts.push(row); return Promise.resolve({ error: null }); },
                delete() { q.op = 'delete'; return builder; },
                then(res, rej) {
                    if (q.op === 'delete') { captures.deletes.push({ withSelect: false }); return Promise.resolve({ error: null }).then(res, rej); }
                    return Promise.resolve({ data: null, error: null }).then(res, rej);
                },
            };
            return builder;
        },
    };
}

function pendingRow(overrides = {}) {
    return {
        id: 'p1',
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        data: {
            validationDue: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
            predictedCFS: 10000, predictedStage: 3.95,
            flowBin: '6000-12000', flowState: 'steady',
            ...overrides,
        },
    };
}
const binUpsert = (caps, key) => caps.upserts.find(u => u.observation_type === 'gf_correction_bin' && u.gauge_id === key);

// Run the REAL path; return the learned flow-bin data (or null if not learned).
async function realLearned({ usgs, temp, row, seedBin = null, binKey }) {
    const captures = { upserts: [], inserts: [], deletes: [] };
    const client = makeClient({ pending: [row], captures, seedBin, binKey });
    const result = await validatePendingPredictions(client, usgs, temp);
    const bin = binUpsert(captures, binKey);
    return { learned: !!bin, bin: bin ? bin.data : null, result };
}

// Run the HARNESS path on the same inputs; return the learned bin (or null if hard-flagged).
function harnessLearned({ rawFinalCFS, usgs, temp, flowBin, flowState, seedBin = null }) {
    const lf = usgs.data['01646500'];
    const actualLF = lf.q, actualStage = lf.h;
    const ef = usgs.data['01644148'];
    const errorCFS = rawFinalCFS - actualLF;
    const errorPercentRaw = (errorCFS / actualLF) * 100;
    const binData = seedBin ? clone(seedBin) : { count: 0, sumError: 0, sumErrorSq: 0, meanError: 0 };
    const { isHardFlagged, isSoftFlagged } = scoreAnomalies({
        errorCFS, errorPercentRaw, actualLF, actualStage, efStage: ef ? ef.h : undefined, temp, binData,
    });
    if (isHardFlagged) return { learned: false, bin: null };
    updateCorrectionBin(binData, errorCFS, isSoftFlagged);
    return { learned: true, bin: binData };
}

function assertBinsMatch(realBin, harnessBin) {
    for (const k of ['count', 'sumError', 'sumErrorSq', 'meanError', 'emaMeanError']) {
        assert.ok(Math.abs(realBin[k] - harnessBin[k]) < 1e-6, `bin.${k}: real=${realBin[k]} harness=${harnessBin[k]}`);
    }
}

test('CLEAN: both learn the raw residual identically (fresh bin)', async () => {
    const usgs = { data: { '01646500': { q: 10000, h: 3.95 }, '01645000': {}, '01644148': {} },
                   gauges: { lf: '01646500', seneca: '01645000', ef: '01644148', monocacy: '01643000', goose: '01644000', broadRun: '01644280', por: '01638500' } };
    const rawFinalCFS = 10500, binKey = '6000-12000_steady';
    const real = await realLearned({ usgs, temp: undefined, row: pendingRow({ rawFinalCFS, predictedCFS: 10400 }), binKey });
    const harness = harnessLearned({ rawFinalCFS, usgs, temp: undefined, flowBin: '6000-12000', flowState: 'steady' });
    assert.equal(real.learned, true);
    assert.equal(harness.learned, true);
    assert.equal(real.bin.sumError, 500);   // 10500 − 10000 (raw)
    assertBinsMatch(real.bin, harness.bin);
});

test('HARD-FLAG (low flow + high stage): both SKIP learning', async () => {
    const usgs = { data: { '01646500': { q: 1000, h: 3.00 }, '01645000': {}, '01644148': {} },
                   gauges: { lf: '01646500', seneca: '01645000', ef: '01644148', monocacy: '01643000', goose: '01644000', broadRun: '01644280', por: '01638500' } };
    const rawFinalCFS = 1200, binKey = '0-3000_steady';
    const real = await realLearned({ usgs, temp: undefined, row: pendingRow({ rawFinalCFS, predictedCFS: 1150, flowBin: '0-3000' }), binKey });
    const harness = harnessLearned({ rawFinalCFS, usgs, temp: undefined, flowBin: '0-3000', flowState: 'steady' });
    assert.equal(real.learned, false, 'real path must skip learning on a HARD flag');
    assert.equal(harness.learned, false, 'harness must skip learning on a HARD flag');
});

test('SOFT-FLAG (EF discrepancy) clamps identically at count>=10', async () => {
    // EF stage 6.0 → ~10344 cfs vs LF 5000 → +107% → SOFT (+2). Stage 3.46 consistent (no hard).
    const usgs = { data: { '01646500': { q: 5000, h: 3.46 }, '01645000': {}, '01644148': { h: 6.0 } },
                   gauges: { lf: '01646500', seneca: '01645000', ef: '01644148', monocacy: '01643000', goose: '01644000', broadRun: '01644280', por: '01638500' } };
    const rawFinalCFS = 10000, binKey = '6000-12000_steady';   // err = +5000 (2σ<|err|<3σ → clamp, not z-outlier)
    const seedBin = { count: 10, sumError: 0, sumErrorSq: 4e7, meanError: 0, emaMeanError: 0 };  // σ=2000
    const real = await realLearned({ usgs, temp: 15, row: pendingRow({ rawFinalCFS, predictedCFS: 9800 }), seedBin, binKey });
    const harness = harnessLearned({ rawFinalCFS, usgs, temp: 15, flowBin: '6000-12000', flowState: 'steady', seedBin });
    assert.equal(real.learned, true);
    assert.equal(harness.learned, true);
    assert.equal(real.bin.count, 11);
    // If the harness had MISjudged soft→clean, it would NOT clamp and emaMeanError would differ
    // (this is the meaningful cross-check of the soft determination).
    assertBinsMatch(real.bin, harness.bin);
    // Prove the soft clamp actually engaged: with the seed emaMeanError=0 (falsy), the recurrence
    // falls back to meanError via `|| meanError` (the preserved v36.0 quirk), so the UNCLAMPED value
    // would be 0.3*5000 + 0.7*(5000/11) = 1818.2; the clamped (learningError=4777) value is ~1751.
    const unclampedEma = 0.3 * 5000 + 0.7 * (5000 / 11);
    assert.ok(real.bin.emaMeanError < unclampedEma - 1,
        `clamp must pull ema below the unclamped ${unclampedEma.toFixed(1)} (got ${real.bin.emaMeanError.toFixed(1)})`);
});

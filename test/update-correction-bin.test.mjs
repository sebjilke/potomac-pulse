// v36.1 — unit tests for the extracted pure EMA bin-update helper updateCorrectionBin
// (shared/model.js). These pin the arithmetic that BOTH the cron (scheduled-update.js
// validatePendingPredictions) and the offline CI backtest harness (analysis/) rely on.
// v39.0 — the soft-flag clamp now uses PRE-observation stats (σ_pre, EMA centre) and a PRE-count
// gate, and the EMA recurrence runs from the pre-state centre with `??`. Tests below that pinned
// the old post-stat behaviour were rewritten (marked "v39.0"); the GOLDEN_* constants were computed
// from the v37.21 implementation BEFORE the edit and pin "identical for unflagged observations".
// The end-to-end fidelity guard is the cross-check test against the real
// validatePendingPredictions; this file pins the helper in isolation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { updateCorrectionBin, GF_EMA_ALPHA } = require('../netlify/functions/shared/model.js');

// The two seed shapes that exist in production (see plan §12 C-F1):
//  - validation default seed: carries emaMeanError:0 (scheduled-update.js:1018-1020)
//  - buildCorrectionBins seed: NO emaMeanError key (model.js:250-252)
const validationSeed = () => ({ count: 0, sumError: 0, sumErrorSq: 0, meanError: 0, emaMeanError: 0 });
const buildSeed = () => ({ count: 0, sumError: 0, sumErrorSq: 0, meanError: 0 });

test('count==1 seeds emaMeanError = learningError; no clamp below 10 obs', () => {
    const bin = validationSeed();
    const r = updateCorrectionBin(bin, 100, false);
    assert.equal(bin.count, 1);
    assert.equal(bin.sumError, 100);
    assert.equal(bin.sumErrorSq, 10000);
    assert.equal(bin.meanError, 100);
    assert.equal(bin.emaMeanError, 100);   // first EMA value = learningError
    assert.equal(r.learningError, 100);
    assert.equal(r.clamped, false);
    assert.equal(r.maxDelta, null);
});

test('count>=2 EMA recurrence = alpha*err + (1-alpha)*prevEma (exact)', () => {
    const bin = validationSeed();
    updateCorrectionBin(bin, 100, false);          // emaMeanError = 100
    updateCorrectionBin(bin, 200, false);          // 0.3*200 + 0.7*100
    assert.equal(bin.count, 2);
    assert.equal(bin.sumError, 300);
    assert.equal(bin.sumErrorSq, 50000);
    assert.equal(bin.meanError, 150);
    assert.equal(GF_EMA_ALPHA, 0.3);
    assert.equal(bin.emaMeanError, 0.3 * 200 + 0.7 * 100);   // = 130
});

test('buildCorrectionBins seed (no emaMeanError key) is handled at count==1', () => {
    const bin = buildSeed();
    assert.equal('emaMeanError' in bin, false);
    updateCorrectionBin(bin, 50, false);
    assert.equal(bin.emaMeanError, 50);    // key created, seeded to learningError
});

test('v39.0: absent emaMeanError at count>=2 -> centre is the PRE-update mean (was the post-update mean)', () => {
    // A bin arriving at count=5 with NO emaMeanError key.
    const bin = { count: 5, sumError: 500, sumErrorSq: 60000, meanError: 100 };
    const r = updateCorrectionBin(bin, 200, false);
    assert.equal(bin.count, 6);
    assert.equal(bin.meanError, 700 / 6);
    // v39.0: recurrence from the pre-state centre (preMean = 100). Through v37.x it mixed in the
    // post-update mean 700/6 = 116.67 (0.3*200 + 0.7*116.67 = 141.67).
    assert.equal(bin.emaMeanError, 0.3 * 200 + 0.7 * 100);
    assert.equal(r.center, 100);
    assert.equal(r.emaBefore, null);
    assert.equal(r.emaAfter, bin.emaMeanError);
});

test('v39.0: soft-flag clamps a large outlier to ±2σ_PRE once the bin already holds >=10; returns clamped+maxDelta', () => {
    // Build a bin with 10 obs, mean 0, known spread so σ is meaningful: σ_pre = sqrt(100000/10) = 100.
    const bin = { count: 10, sumError: 0, sumErrorSq: 100000, meanError: 0, emaMeanError: 0 };
    const r = updateCorrectionBin(bin, 10000, true);   // huge overestimate outlier, soft-flagged
    assert.equal(r.clamped, true);
    // v39.0: maxDelta is 2σ of the PRE-observation stats (= 200). Through v37.x it was 2σ of the
    // POST-update stats, where the 10,000 cfs error had already entered sumErrorSq (σ_post ≈ 2,970).
    assert.equal(r.maxDelta, 200);
    assert.equal(r.sdPre, 100);
    assert.equal(r.center, 0);
    assert.equal(r.learningError, 0 + 200);            // centre (EMA 0, honoured) + maxDelta
    assert.equal(r.emaBefore, 0);
    assert.equal(bin.emaMeanError, 0.3 * 200);
    assert.equal(r.emaAfter, bin.emaMeanError);
    assert.equal(bin.sumError, 10000);                 // lifetime sums still take the RAW value
    assert.equal(bin.sumErrorSq, 100000 + 10000 * 10000);
});

test('NOT soft-flagged: no clamp even with a large error at count>=10', () => {
    const bin = { count: 10, sumError: 0, sumErrorSq: 100000, meanError: 0, emaMeanError: 0 };
    const r = updateCorrectionBin(bin, 10000, false);
    assert.equal(r.clamped, false);
    assert.equal(r.learningError, 10000);              // raw error used unclamped
    assert.equal(r.maxDelta, null);
});

test('soft-flag below 10 obs does NOT clamp (σ not yet meaningful)', () => {
    const bin = { count: 5, sumError: 0, sumErrorSq: 50000, meanError: 0, emaMeanError: 0 };
    const r = updateCorrectionBin(bin, 9000, true);
    assert.equal(r.clamped, false);
    assert.equal(r.learningError, 9000);
});

// ── v39.0: pre-observation clamp rule ──────────────────────────────────────────────────────────
// Live bins, frozen in analysis/snapshot-2026-11-10-gf.json (fixture test/fixtures/outlier-replay-2026-10.json).
const RISING = () => ({ count: 22, sumError: 4088, meanError: 4088 / 22, sumErrorSq: 4933260, emaMeanError: -226.27556965580249 });
const FALLING = () => ({ count: 17, sumError: 3933, meanError: 3933 / 17, sumErrorSq: 1422029, emaMeanError: 401.15096838548686 });
const sdOf = (b) => Math.sqrt(Math.max(0, b.sumErrorSq / b.count - b.meanError * b.meanError));
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// GOLDEN numbers: computed with the v37.21 updateCorrectionBin before the v39.0 edit.
const GOLDEN_UNFLAGGED_RISING = { e: -4275, count: 23, sumError: -187, sumErrorSq: 23208885, meanError: -8.130434782608695, ema: -1440.8928987590616 };
const GOLDEN_UNFLAGGED_FALLING_SEQ = [   // errors fed in order to FALLING(), isSoftFlagged=false
    { e: -410, count: 18, ema: 157.8056778698408 },
    { e: -413, count: 19, ema: -13.436025491111437 },
    { e: 250, count: 20, ema: 65.594782156222 },
    { e: 1000, count: 21, ema: 345.9163475093554, sumError: 4360, sumErrorSq: 2823198 },
];
// OLD (post-stat) soft results, kept only to show the new rule differs and is smaller.
const OLD_SOFT_RISING_EMA = -828.974256329927;       // step -602.70 from -226.28 for e = -4275
const OLD_SOFT_RISING_MAXDELTA = 2008.9956222470819;

test('v39.0: NOT soft-flagged is numerically identical to the v37.21 recurrence (golden, numeric non-zero EMA)', () => {
    const b = RISING();
    const r = updateCorrectionBin(b, GOLDEN_UNFLAGGED_RISING.e, false);
    assert.equal(b.count, GOLDEN_UNFLAGGED_RISING.count);
    assert.equal(b.sumError, GOLDEN_UNFLAGGED_RISING.sumError);
    assert.equal(b.sumErrorSq, GOLDEN_UNFLAGGED_RISING.sumErrorSq);
    assert.equal(b.meanError, GOLDEN_UNFLAGGED_RISING.meanError);
    assert.equal(b.emaMeanError, GOLDEN_UNFLAGGED_RISING.ema);
    assert.equal(r.clamped, false);
    assert.equal(r.maxDelta, null);
    assert.equal(r.learningError, -4275);
    const f = FALLING();
    for (const g of GOLDEN_UNFLAGGED_FALLING_SEQ) {
        updateCorrectionBin(f, g.e, false);
        assert.equal(f.count, g.count);
        assert.equal(f.emaMeanError, g.ema);
        if (g.sumError !== undefined) { assert.equal(f.sumError, g.sumError); assert.equal(f.sumErrorSq, g.sumErrorSq); }
    }
});

test('v39.0: soft, preCount>=10, extreme error: step == 0.6*sdPre exactly, far below the old post-stat step; sums take the raw value', () => {
    const b = RISING();
    const sdPre = sdOf(b);                                   // ~435.6 cfs
    const r = updateCorrectionBin(b, -4275, true);           // the 2026-10-12 miss
    close(r.sdPre, sdPre);
    close(r.maxDelta, 2 * sdPre);
    close(r.center, -226.27556965580249);
    assert.equal(r.emaBefore, -226.27556965580249);
    assert.equal(r.clamped, true);
    close(r.learningError, -226.27556965580249 - 2 * sdPre);
    const step = r.emaAfter - r.emaBefore;
    close(step, -0.6 * sdPre, 1e-9);                          // ~ -261.4 cfs
    assert.ok(Math.abs(step) < 270 && Math.abs(step) > 250, `step ${step}`);
    // the OLD rule moved this bin by ~603 cfs and its clamp half-width was 2,009
    const oldStep = OLD_SOFT_RISING_EMA - (-226.27556965580249);
    assert.ok(Math.abs(oldStep) > 600 && Math.abs(oldStep) < 606);
    assert.ok(Math.abs(step) < Math.abs(oldStep) / 2);
    assert.ok(r.maxDelta < OLD_SOFT_RISING_MAXDELTA / 2);
    // lifetime sums take the RAW error (so lifetime sd still jumps)
    assert.equal(b.sumError, 4088 - 4275);
    assert.equal(b.sumErrorSq, 4933260 + 4275 * 4275);
    assert.ok(sdOf(b) > 2 * sdPre, `lifetime sd ${sdPre} -> ${sdOf(b)}`);
});

test('v39.0: bound property: |emaAfter - center| <= 0.6*sdPre for soft observations over a grid of errors', () => {
    const grid = [];
    for (const m of [100, 250, 500, 1000, 2000, 4275, 10000, 25000, 50000]) grid.push(m, -m);
    for (const mk of [RISING, FALLING]) {
        for (const e of grid) {
            const b = mk();
            const sdPre = sdOf(b), center = b.emaMeanError;
            const r = updateCorrectionBin(b, e, true);
            assert.ok(Math.abs(r.emaAfter - center) <= 0.6 * sdPre + 1e-9, `e=${e}: |${r.emaAfter} - ${center}| > ${0.6 * sdPre}`);
        }
    }
});

test('v39.0: gate is the PRE count: preCount 9 soft -> unclamped, preCount 10 soft -> clamped (TODO #34)', () => {
    const mk = (n) => ({ count: n, sumError: 0, sumErrorSq: n * 10000, meanError: 0, emaMeanError: 0 });   // sdPre = 100
    const b9 = mk(9);
    const r9 = updateCorrectionBin(b9, 5000, true);
    assert.equal(r9.clamped, false);
    assert.equal(r9.maxDelta, null);
    assert.equal(r9.learningError, 5000);
    assert.equal(b9.emaMeanError, 0.3 * 5000);
    const b10 = mk(10);
    const r10 = updateCorrectionBin(b10, 5000, true);
    assert.equal(r10.clamped, true);
    assert.equal(r10.maxDelta, 200);
    assert.equal(b10.emaMeanError, 0.3 * 200);
});

test('v39.0: sdPre of 0 with preCount>=10 -> NO clamp (a zero-width clamp would freeze the bin); EMA moves', () => {
    const b = { count: 12, sumError: 1200, sumErrorSq: 120000, meanError: 100, emaMeanError: 100 };   // all obs == 100 -> sd 0
    const r = updateCorrectionBin(b, 900, true);
    assert.equal(r.sdPre, 0);
    assert.equal(r.clamped, false);
    assert.equal(r.maxDelta, null);
    assert.equal(r.learningError, 900);
    assert.equal(b.emaMeanError, 0.3 * 900 + 0.7 * 100);
});

test('v39.0: missing sumErrorSq / non-finite stats -> no NaN in the EMA or return fields, no clamp (sums may still go NaN)', () => {
    const b = { count: 15, sumError: 150, meanError: 10, emaMeanError: 10 };   // sumErrorSq absent
    const r = updateCorrectionBin(b, 500, true);
    assert.equal(r.sdPre, null);
    assert.equal(r.clamped, false);
    assert.equal(r.learningError, 500);
    assert.equal(b.emaMeanError, 0.3 * 500 + 0.7 * 10);
    assert.ok(Number.isFinite(b.emaMeanError));
    assert.ok(Number.isFinite(r.emaAfter));
    // non-finite centre: no clamp, and a finite learning error
    const c = { count: 15, sumError: 0, sumErrorSq: 150000, meanError: 0, emaMeanError: NaN };
    const rc = updateCorrectionBin(c, 700, true);
    assert.equal(rc.clamped, false);
    assert.equal(rc.center, null);
    assert.ok(Number.isFinite(rc.emaAfter), 'non-finite centre must not give a NaN EMA');
    assert.equal(rc.emaAfter, 700);
});

test('v39.0 (review): non-finite pre-state centre (no meanError, EMA null/undefined/NaN) seeds the EMA with the learning error', () => {
    for (const ema of [null, undefined, NaN]) {
        const b = { count: 15, sumError: 0, sumErrorSq: 150000, emaMeanError: ema };   // meanError missing
        const r = updateCorrectionBin(b, 700, false);
        assert.ok(Number.isFinite(r.emaAfter), `ema=${ema}`);
        assert.equal(r.emaAfter, r.learningError);
        assert.equal(r.emaAfter, 700);
        assert.equal(b.emaMeanError, 700);
    }
});

test('v39.0: an EMA of exactly 0 is honoured (?? not ||); undefined EMA -> centre is the pre mean; first observation -> EMA = error', () => {
    const z = { count: 4, sumError: 800, sumErrorSq: 200000, meanError: 200, emaMeanError: 0 };
    updateCorrectionBin(z, 100, false);
    assert.equal(z.emaMeanError, 0.3 * 100 + 0.7 * 0);     // old code: 0 is falsy -> mixed in the mean (200.0 pre / 180 post)
    const u = { count: 4, sumError: 800, sumErrorSq: 200000, meanError: 200 };
    const ru = updateCorrectionBin(u, 100, false);
    assert.equal(u.emaMeanError, 0.3 * 100 + 0.7 * 200);   // pre mean (200), not post mean (180)
    assert.equal(ru.center, 200);
    const f = { count: 0, sumError: 0, sumErrorSq: 0, meanError: 0 };
    const rf = updateCorrectionBin(f, -42, true);
    assert.equal(f.emaMeanError, -42);
    assert.equal(rf.sdPre, null);
    assert.equal(rf.emaBefore, null);
    assert.equal(rf.clamped, false);
});

test('v39.0: telemetry carries sdPre, center, emaBefore, emaAfter for an unclamped soft observation too', () => {
    const b = FALLING();
    const r = updateCorrectionBin(b, 420, true);           // inside the band -> not clamped
    assert.equal(r.clamped, false);
    close(r.sdPre, sdOf({ count: 17, meanError: 3933 / 17, sumErrorSq: 1422029 }));
    assert.equal(r.center, 401.15096838548686);
    assert.equal(r.emaBefore, 401.15096838548686);
    assert.equal(r.emaAfter, b.emaMeanError);
    assert.equal(typeof r.maxDelta, 'number');
});

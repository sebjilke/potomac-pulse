// v36.1 — unit tests for the extracted pure EMA bin-update helper updateCorrectionBin
// (shared/model.js). These pin the arithmetic that BOTH the cron (scheduled-update.js
// validatePendingPredictions) and the offline CI backtest harness (analysis/) rely on.
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

test('|| meanError fallback fires when emaMeanError is absent at count>=2', () => {
    // A bin arriving at count=5 with NO emaMeanError key (the `||` fallback path).
    const bin = { count: 5, sumError: 500, sumErrorSq: 60000, meanError: 100 };
    updateCorrectionBin(bin, 200, false);
    // count=6, meanError = 700/6; recurrence uses (emaMeanError || meanError) = meanError(=100 before update?)
    // NOTE: meanError is recomputed BEFORE the recurrence, so the fallback uses the UPDATED meanError.
    const expectedMean = 700 / 6;
    assert.equal(bin.count, 6);
    assert.equal(bin.meanError, expectedMean);
    assert.equal(bin.emaMeanError, 0.3 * 200 + 0.7 * expectedMean);
});

test('soft-flag clamps a large outlier to ±2σ once count>=10; returns clamped+maxDelta', () => {
    // Build a bin with 10 obs, mean 0, known spread so σ is meaningful.
    const bin = { count: 10, sumError: 0, sumErrorSq: 100000, meanError: 0, emaMeanError: 0 };
    const r = updateCorrectionBin(bin, 10000, true);   // huge overestimate outlier, soft-flagged
    assert.equal(r.clamped, true);
    assert.ok(r.maxDelta > 0);
    // center = emaMeanError(0); learningError clamped to center + maxDelta (outlier is above band)
    assert.equal(r.learningError, 0 + r.maxDelta);
    assert.ok(Math.abs(r.learningError) < 10000);      // genuinely reduced
    // maxDelta must be 2σ of the POST-update stats (count=11), matching the original order
    const variance = bin.sumErrorSq / bin.count - bin.meanError * bin.meanError;
    assert.equal(r.maxDelta, 2 * Math.sqrt(Math.max(0, variance)));
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

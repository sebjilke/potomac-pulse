// v36.1 (C2) — regression guard for the 90% CI band formula in great-falls.js.
// The pre-v36.1 code used a SYMMETRIC band est ± (q95−q05)/2, which discarded the sign of the
// corrected residual and forced symmetry around the estimate — structurally wrong for the
// asymmetric, often same-signed corrected-residual quantiles. The correct band is sign-aware:
//   r = estimate − actual,  q05/q95 are quantiles of r  ⇒  90% interval for actual = [est − q95, est − q05].
// These tests pin that exact formula with hardcoded expectations (NOT recomputed from the same
// expression), so a revert to ±halfWidth fails loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadEstimators } from './characterization/harness.mjs';

const require = createRequire(import.meta.url);
const { computeUncertaintyBand } = await loadEstimators();

test('sign-aware: low = est − q95, high = est − q05 (asymmetric)', () => {
    // est=10000, q05=−500, q95=+300 → low=10000−300=9700, high=10000−(−500)=10500
    const band = computeUncertaintyBand(10000, -500, 300);
    assert.equal(band.lowCFS, 9700);
    assert.equal(band.highCFS, 10500);
});

test('REGRESSION: must NOT be the symmetric ±(q95−q05)/2 band', () => {
    // For q05=−500,q95=300 the OLD (wrong) halfWidth=(300−(−500))/2=400 would give [9600,10400].
    const band = computeUncertaintyBand(10000, -500, 300);
    assert.notEqual(band.lowCFS, 9600, 'low must not be est−halfWidth (the reverted bug)');
    assert.notEqual(band.highCFS, 10400, 'high must not be est+halfWidth (the reverted bug)');
    assert.equal(band.lowCFS, 9700);
    assert.equal(band.highCFS, 10500);
});

test('same-signed quantiles produce a one-sided band ±halfWidth could not represent', () => {
    // The old 6000-12000/steady was [q05=−2377, q95=−159] (both negative). The correct band sits
    // ENTIRELY ABOVE the estimate: low=est−(−159)=est+159, high=est−(−2377)=est+2377.
    const est = 8000;
    const band = computeUncertaintyBand(est, -2377, -159);
    assert.equal(band.lowCFS, 8159);
    assert.equal(band.highCFS, 10377);
    assert.ok(band.lowCFS > est, 'a same-signed (negative) residual band must lie above the estimate');
});

test('low end floored at 0 (no negative flow)', () => {
    const band = computeUncertaintyBand(100, -500, 300);   // est−q95 = 100−300 = −200 → 0
    assert.equal(band.lowCFS, 0);
    assert.equal(band.highCFS, 600);
});

test('shipped EMPIRICAL_CI_90 high-flow band flows through correctly', async () => {
    // Import the actual shipped table (headless-safe — no window deps in constants.js).
    const { EMPIRICAL_CI_90 } = await import('../src/model/constants.js');
    const cell = EMPIRICAL_CI_90['50000+'].falling;
    assert.equal(cell.q05, -4099);
    assert.equal(cell.q95, 6429);
    const band = computeUncertaintyBand(55000, cell.q05, cell.q95);
    assert.equal(band.lowCFS, 55000 - 6429);   // 48571
    assert.equal(band.highCFS, 55000 + 4099);  // 59099
    // genuinely asymmetric: the lower arm (6429) is wider than the upper arm (4099)
    const lowerArm = 55000 - band.lowCFS, upperArm = band.highCFS - 55000;
    assert.ok(lowerArm !== upperArm, 'high-flow band must be asymmetric');
    assert.equal(lowerArm, 6429);
    assert.equal(upperArm, 4099);
});

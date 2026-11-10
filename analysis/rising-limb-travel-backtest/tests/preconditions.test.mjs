// Plan section 7 preconditions P1 (identity + invariants), P3, P4, and the mask/REC agreement with the frozen event file.
// Reports pass/fail and counts only; computes no arm error vs the truth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computePreconditions } from '../preconditions.mjs';

const R = await computePreconditions();

test('P1 baseline identity: harness base == production makeGFPrediction, every tick, return + trace, zero tolerance', () => {
  console.error(`identity: ${R.invariants.identity.exact} exact of ${R.invariants.identity.checked}`);
  assert.ok(R.invariants.identity.checked > 100000);
  assert.equal(R.invariants.identity.exact, R.invariants.identity.checked);
  assert.equal(R.invariants.identity.firstFail, null);
});
for (const k of ['B_eq_base_not_rising', 'A_eq_base_delta_off', 'C_eq_A_B_inactive', 'C_eq_B_delta_off', 'A_travel_eq_base', 'C_travel_eq_B', 'C_porEst_delta_on']) {
  test(`P1 invariant ${k}`, () => {
    console.error(`${k}: ${R.invariants[k].checked} checked, ${R.invariants[k].fail} fail`);
    assert.ok(R.invariants[k].checked > 1000);
    assert.equal(R.invariants[k].fail, 0);
  });
}
test('common mask and RL tick counts equal the step-2 event file for all 53 events; REC stamp counts too', () => {
  assert.equal(R.maskCmp.rlTicksMatch, R.maskCmp.events);
  assert.equal(R.maskCmp.scoredMatch, R.maskCmp.events);
  assert.equal(R.recCmp.match, R.recCmp.events);
});
test('P3 October mechanism: base non-converged share on October RL rising ticks (common mask) >= 20%', () => {
  console.error(`P3: ${R.p3.nonConverged}/${R.p3.risingTicks}`);
  assert.ok(R.p3.applicable); assert.ok(R.p3.pass);
});
test('P4 (report only): 20 logged hard-flag raw values vs harness base raw within max(5%,150 cfs)', () => {
  console.error(`P4: ${R.p4.within}/${R.p4.n}`);
  assert.equal(R.p4.n, 20);
  assert.equal(R.p4.within, R.p4.n);
});

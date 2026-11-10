// Baseline-only replay, hashed. Contains no truth column and no error.
import crypto from 'node:crypto';
import * as H from '../rising_limb_harness.mjs';
const D = H.loadData();
const c = new H.ArmChain('base');
const h = crypto.createHash('sha256');
for (let i = 0; i < D.n; i++) {
  const inp = H.inputsAt(D, i); const o = await c.tick(D, i, inp);
  const p = o.r?.pred, t = o.r?.trace;
  h.update([i, p?.rawFinalCFS, t?.rawUnc, t?.unc, p?.predictedCFS, p?.flowBin, p?.flowState, t?.rst, t?.stop, p?.travelTimeGFtoLF, p?.validationDue, o.slot, +o.v.validated, +o.v.hard, +o.v.soft].join(',') + '\n');
}
h.update(JSON.stringify(c.bins));
console.log(h.digest('hex'), JSON.stringify(c.n));

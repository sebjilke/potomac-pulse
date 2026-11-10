// Synthetic checks of the four VARIANT hooks. Invented series only; no real data, no truth.
import { createRequire } from 'node:module';
import { makeVariant } from '../rising_limb_model_variants.mjs';
import { withSim, GAUGES, HOUR } from '../rising_limb_harness.mjs';
const require = createRequire(import.meta.url);
const SM = require('../../../netlify/functions/shared/model.js');
const PROD = require('../../../netlify/functions/scheduled-update.js')._test;
const T = Date.UTC(2022, 6, 1, 12);
const bins = SM.buildCorrectionBins([]);
// history: hourly at s'+30min for s' = t-72..t-2, values f(hoursBeforeT)
const mkHist = (f, from = 72, to = 2) => { const h = []; for (let k = from; k >= to; k--) h.push({ timestamp: T - k * HOUR + 30 * 60e3, cfs: f(k) }); return h; };
const mkUsgs = (por, lf, tribs = { m: 500, g: 200, b: 40, s: 60 }, ef = null) => ({ gauges: GAUGES, data: {
  [GAUGES.por]: { q: por }, [GAUGES.lf]: { q: lf, h: 4 }, [GAUGES.monocacy]: { q: tribs.m }, [GAUGES.goose]: { q: tribs.g },
  [GAUGES.broadRun]: { q: tribs.b }, [GAUGES.seneca]: { q: tribs.s }, [GAUGES.ef]: ef ? { h: ef } : {} } });
const run = (arm, usgs, hist) => { const tr = {}; const p = withSim(T, () => makeVariant(arm)(usgs, hist.map(o => ({ ...o })), 20, bins, tr)); return { p, tr }; };
const prod = (usgs, hist) => { const tr = {}; const p = withSim(T, () => PROD.makeGFPrediction(usgs, hist.map(o => ({ ...o })), 20, bins, tr)); return { p, tr }; };
const cases = {
  rising_delta_on: { usgs: mkUsgs(30000, 4000), hist: mkHist(k => k <= 30 ? 30000 - (k - 2) * 900 : 4000) },
  rising_delta_on_lf_above_por: { usgs: mkUsgs(9000, 12000), hist: mkHist(k => 12000 - Math.min(k, 40) * 50 - (k <= 8 ? 0 : 1500)) },
  rising_small_delta_off: { usgs: mkUsgs(5000, 3000), hist: mkHist(k => 5000 - k * 3.5) },
  falling: { usgs: mkUsgs(8000, 14000), hist: mkHist(k => 8000 + k * 300) },
  crest_steady: { usgs: mkUsgs(25000, 12000), hist: mkHist(k => k <= 10 ? 25000 : 25000 - (k - 10) * 600) },
  no_history: { usgs: mkUsgs(20000, 5000), hist: [] },
  short_history_no_rate: { usgs: mkUsgs(20000, 5000), hist: mkHist(k => 20000 - k * 1000, 4, 2) },
  history_gap_at_lookup: { usgs: mkUsgs(30000, 4000), hist: mkHist(k => k <= 30 ? 30000 - (k - 2) * 900 : 4000).filter((e, i) => i % 5 !== 0 && !(e.timestamp < T - 8 * HOUR && e.timestamp > T - 20 * HOUR)) },
  rising_with_ef: { usgs: mkUsgs(30000, 9000, undefined, 6.0), hist: mkHist(k => k <= 30 ? 30000 - (k - 2) * 900 : 4000) },
};
const keysBefore = (tr, key) => { const k = Object.keys(tr); return k.slice(0, k.indexOf(key)); };
const travelKeys = ['t0', 't', 'it', 'stop', 'mult', 'nohist', 'gf2lf', 'histTs', 'histCfs', 'histAgo'];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let bad = 0;
for (const [name, c] of Object.entries(cases)) {
  const R = Object.fromEntries(['base', 'A', 'B', 'C'].map(a => [a, run(a, c.usgs, c.hist)]));
  const P = prod(c.usgs, c.hist);
  const rr = withSim(T, () => SM.getPoRRiseRateFromHistory(c.hist));
  const rising = !!(rr && rr.flowState === 'rising' && rr.ratePerHour > 0);
  const b = R.base.tr, deltaOn = b.deltaOn === true;
  const out = { name, rst: b.rst, rate: b.rate && +b.rate.toFixed(3), rising, deltaOn_base: b.deltaOn ?? null, stop: { base: b.stop, B: R.B.tr.stop } };
  const chk = (lbl, cond) => { if (!cond) { bad++; out['FAIL_' + lbl] = true; } };
  chk('base==prod', eq(R.base.p, P.p) && eq(R.base.tr, P.tr));
  // A: travel/lookup identical to base always; only porEst onward may differ, and only when delta on
  chk('A_travel==base', travelKeys.every(k => eq(R.A.tr[k], b[k])) && eq(R.A.tr.pct, b.pct) && eq(R.A.tr.ratio, b.ratio));
  if (!deltaOn) chk('A==base when delta off', eq(R.A.p, R.base.p) && eq(R.A.tr, b));
  if (deltaOn) {
    const expA = Math.round(b.histCfs * b.ratio) + b.monoFlow + b.gooseFlow + b.brFlow + b.senFlow;
    const expBase = Math.round(b.preCfs * b.ratio);
    chk('A porEst formula', R.A.tr.porEst === expA); chk('base porEst formula', b.porEst === expBase);
    out.A_minus_base_porEst_sign_expected = Math.sign((b.ratio - 1) * -(b.monoFlow + b.gooseFlow + b.brFlow + b.senFlow)) === Math.sign(R.A.tr.porEst - b.porEst) || Math.abs(R.A.tr.porEst - b.porEst) <= 1;
  }
  // B: equals base when not rising; when rising: only travel-path fields change; delta formula unchanged (base rule)
  if (!rising) chk('B==base when not rising', eq(R.B.p, R.base.p) && eq(R.B.tr, b));
  if (rising) {
    const lf = c.usgs.data[GAUGES.lf].q, por = c.usgs.data[GAUGES.por].q;
    chk('B initial mult', R.B.tr.t0 === SM.getPoRtoGFTravelTime(SM.getFlowMultiplier(Math.max(lf, por)), rr));
    chk('B travel <= base', R.B.tr.t0 <= b.t0 + 1e-12);
    if (R.B.tr.deltaOn) chk('B porEst base formula', R.B.tr.porEst === Math.round(R.B.tr.preCfs * R.B.tr.ratio));
    chk('B rst/rate same', R.B.tr.rst === b.rst && R.B.tr.rate === b.rate);
  }
  // C = A applied on B's travel path
  chk('C travel==B', travelKeys.every(k => eq(R.C.tr[k], R.B.tr[k])) && eq(R.C.tr.ratio, R.B.tr.ratio));
  if (R.B.tr.deltaOn) chk('C porEst = A formula on B path', R.C.tr.porEst === Math.round(R.B.tr.histCfs * R.B.tr.ratio) + R.B.tr.monoFlow + R.B.tr.gooseFlow + R.B.tr.brFlow + R.B.tr.senFlow);
  else chk('C==B when B delta off', eq(R.C.p, R.B.p) && eq(R.C.tr, R.B.tr));
  if (!rising) chk('C==A when not rising', eq(R.C.p, R.A.p) && eq(R.C.tr, R.A.tr));
  // validationDue = T + travelGFtoLF for each arm
  for (const a of ['base', 'A', 'B', 'C']) chk('due_' + a, Date.parse(R[a].p.validationDue) === T + Math.round(R[a].p.travelTimeGFtoLF * 3600000) || Math.abs(Date.parse(R[a].p.validationDue) - (T + R[a].p.travelTimeGFtoLF * 3600000)) < 1);
  // which fields differ (names only)
  const diff = (x, y) => Object.keys({ ...x.tr, ...y.tr }).filter(k => !eq(x.tr[k], y.tr[k]));
  out.diffFields = { A: diff(R.A, R.base), B: diff(R.B, R.base), C_vs_B: diff(R.C, R.B) };
  console.log(JSON.stringify(out));
}
console.log('FAILS', bad);

// Leak-by-construction test. Compares a harness run on real data against the same run on perturbed data,
// SAME arm vs SAME arm only. Never compares any arm with the truth or with another arm. Prints booleans/counts only.
import * as H from '../rising_limb_harness.mjs';
const D0 = H.loadData();
const evs = H.loadEvents();
const KEYS = ['por', 'temp', 'ef', 'lf', 'lfStage', 'monocacy', 'goose', 'broadRun', 'seneca'];
const LAG2 = ['por', 'temp', 'ef', 'broadRun'];
const clone = (D) => { const P = { ...D }; for (const k of KEYS) P[k] = D[k].slice(); return P; };
const sig = (x) => JSON.stringify(x, (k, v) => (typeof v === 'number' && Number.isNaN(v) ? 'NaN' : v));
async function runTo(D, i, span = 600) {
  const chains = Object.fromEntries(H.ARMS.map(a => [a, new H.ArmChain(a)]));
  let last = null;
  for (let u = i - span; u <= i; u++) {
    const inp = H.inputsAt(D, u); const o = {};
    for (const a of H.ARMS) o[a] = await chains[a].tick(D, u, inp);
    if (u === i) last = { inp: sig(inp), hist: sig(H.porHistoryAt(D, i)),
      arms: Object.fromEntries(H.ARMS.map(a => [a, sig({ v: { ...o[a].v, gate: o[a].v.gate ? { ...o[a].v.gate } : null }, r: o[a].r, slot: o[a].slot, bins: chains[a].bins, pend: chains[a].pending })])) };
  }
  return last;
}
// ticks: RL ticks of kept events (including October) plus a few random ticks
let seed = 20261113; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const ticks = [];
for (const e of evs.filter(e => e.kept)) ticks.push(D0.idx(e.rl[0] + Math.floor(rnd() * ((e.rl[1] - e.rl[0]) / H.HOUR + 1)) * H.HOUR));
for (let k = 0; k < 6; k++) ticks.push(2000 + Math.floor(rnd() * (D0.n - 3000)));
const sel = ticks.filter((_, k) => k % 3 === 0 || evs.find(e => e.oct && D0.idx(e.rl[0]) <= ticks[k] && ticks[k] <= D0.idx(e.rl[1])));
const res = { ticks: sel.length, futureUnchanged: 0, lagWindowUnchanged: 0, blankFutureUnchanged: 0, allowedPorChanged: 0, allowedLfChanged: 0, fails: [] };
for (const i of sel) {
  const ref = await runTo(D0, i);
  // (1) future stamps >= i, every gauge, scaled
  let P = clone(D0); for (const k of KEYS) for (let j = i; j < P.n; j++) P[k][j] = P[k][j] * 1.7 + 3;
  let r = await runTo(P, i); if (sig(r) === sig(ref)) res.futureUnchanged++; else res.fails.push(['future', i]);
  // (2) forbidden lag window: stamp i-1 for the 2 h-lag gauges (por, temp, ef, broadRun), plus future
  P = clone(D0); for (const k of LAG2) P[k][i - 1] = P[k][i - 1] * 1.7 + 3;
  r = await runTo(P, i); if (sig(r) === sig(ref)) res.lagWindowUnchanged++; else res.fails.push(['lagwin', i]);
  // (3) blank the future (carry must not reach forward)
  P = clone(D0); for (const k of KEYS) for (let j = i; j < P.n; j++) P[k][j] = NaN;
  r = await runTo(P, i); if (sig(r) === sig(ref)) res.blankFutureUnchanged++; else res.fails.push(['blankfuture', i]);
  // (4) allowed stamps must change something: PoR stamp i-2; LF stamp i-1
  P = clone(D0); P.por[i - 2] = P.por[i - 2] * 1.3; r = await runTo(P, i); if (sig(r) !== sig(ref)) res.allowedPorChanged++;
  P = clone(D0); P.lf[i - 1] = P.lf[i - 1] * 1.3; r = await runTo(P, i); if (sig(r) !== sig(ref)) res.allowedLfChanged++;
}
console.log(JSON.stringify(res));

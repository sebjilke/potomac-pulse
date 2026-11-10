import * as H from '../rising_limb_harness.mjs';
const D = H.loadData(); const evs = H.loadEvents();
let multi = { rl: 0, rlx: 0, rec: 0 }, rlAndRec = 0, normalInsideKeptWindow = 0, beforeBurn = 0, normalBeforeBurn = 0;
const burn = Date.UTC(2012, 11, 1);
for (let i = 0; i < D.n; i++) { const t = D.epoch(i); const L = H.labelTick(evs, t);
  for (const k of ['rl', 'rlx', 'rec']) if (L[k + '_event'].includes('|')) multi[k]++;
  if (L.rl_event && L.rec_event) rlAndRec++;
  if (L.normal && (L.rl_event || L.rec_event || L.rlx_event)) normalInsideKeptWindow++;
  if (t < burn) { beforeBurn++; if (L.normal) normalBeforeBurn++; } }
// events whose windows extend beyond the grid
const last = D.epoch(D.n - 1); const beyond = evs.filter(e => e.ew[1] > last).map(e => e.id);
// RL windows of kept events: does RL include ticks before the grid?
console.log(JSON.stringify({ multi, rlAndRec, normalInsideKeptWindow, beforeBurn, normalBeforeBurn, ewBeyondGrid: beyond, nKept: evs.filter(e => e.kept).length,
  classes: evs.reduce((a, e) => (a[e.cls + (e.kept ? '_kept' : '_excl')] = (a[e.cls + (e.kept ? '_kept' : '_excl')] || 0) + 1, a), {}) }));

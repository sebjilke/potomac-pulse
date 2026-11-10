// Data-only counts (no model output, no truth comparison).
import * as H from '../rising_limb_harness.mjs';
const D = H.loadData();
const KEYS = ['por', 'temp', 'ef', 'lf', 'lfStage', 'monocacy', 'goose', 'broadRun', 'seneca'];
const out = {};
for (const k of KEYS) { let nonpos = 0, blank = 0, mn = Infinity, mx = -Infinity; for (let i = 0; i < D.n; i++) { const v = D[k][i]; if (Number.isNaN(v)) blank++; else { if (v <= 0) nonpos++; mn = Math.min(mn, v); mx = Math.max(mx, v); } } out[k] = { blank, nonpos, mn, mx }; }
// blank share by month for por and lf (ice proxy)
const bym = {}; for (let i = 0; i < D.n; i++) { const m = new Date(D.epoch(i)).getUTCMonth() + 1; bym[m] ??= { n: 0, por: 0, lf: 0 }; bym[m].n++; if (Number.isNaN(D.por[i])) bym[m].por++; if (Number.isNaN(D.lf[i])) bym[m].lf++; }
out.blankPctByMonth = Object.fromEntries(Object.entries(bym).map(([m, o]) => [m, { por: +(100 * o.por / o.n).toFixed(2), lf: +(100 * o.lf / o.n).toFixed(2) }]));
// ticks where the LF view exists but the PoR view is missing (harness validates, cannot predict); split winter vs not
let lfOnly = 0, lfOnlyWinter = 0, porOnly = 0, both = 0;
for (let i = 0; i < D.n; i++) { const p = H.view(D.por, i, 2), l = H.view(D.lf, i, 1); const w = [12, 1, 2, 3].includes(new Date(D.epoch(i)).getUTCMonth() + 1);
  if (Number.isNaN(p) && !Number.isNaN(l)) { lfOnly++; if (w) lfOnlyWinter++; } if (!Number.isNaN(p) && Number.isNaN(l)) porOnly++; if (!Number.isNaN(p) && !Number.isNaN(l)) both++; }
out.views = { grid: D.n, both, lfOnly, lfOnlyWinter, porOnly };
// temp outside production fetch filter [-5, 40]
let tOut = 0; for (let i = 0; i < D.n; i++) { const v = D.temp[i]; if (!Number.isNaN(v) && (v < -5 || v > 40)) tOut++; } out.tempOutOfRange = tOut;
// runs of PoR blanks >= 4 in Dec-Mar (cron would have seen sentinel/ice or nothing)
let runs = 0, run = 0, runsW = 0; for (let i = 0; i < D.n; i++) { if (Number.isNaN(D.por[i])) run++; else { if (run >= 4) { runs++; if ([12,1,2,3].includes(new Date(D.epoch(i)).getUTCMonth()+1)) runsW++; } run = 0; } } out.porBlankRuns4 = { all: runs, winter: runsW };
console.log(JSON.stringify(out, null, 1));

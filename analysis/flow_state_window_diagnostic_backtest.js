// Storm-period validation for the proposed 6h-window flow-state rule.
// Loads hourly_backtest_data.csv (117k rows, 2011-12 to 2026-02), runs the
// classification across the full dataset and a few known wet months, and
// reports rising/steady/falling distribution for current and proposed rules.

const fs = require('fs');
const path = '/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv';

const lines = fs.readFileSync(path, 'utf8').trim().split('\n');
const header = lines[0].split(',');
const tsIdx = header.indexOf('timestamp');
const porIdx = header.indexOf('por_now');

const rows = [];
for (let i = 1; i < lines.length; i++) {
  const parts = lines[i].split(',');
  const t = new Date(parts[tsIdx].replace(' ', 'T') + 'Z').getTime();
  const q = parseFloat(parts[porIdx]);
  if (Number.isFinite(t) && Number.isFinite(q) && q > 0 && q < 500000) rows.push({ t, q });
}
rows.sort((a, b) => a.t - b.t);
console.log(`Loaded ${rows.length} hourly PoR observations, ` +
  `${new Date(rows[0].t).toISOString().slice(0,10)} → ${new Date(rows.at(-1).t).toISOString().slice(0,10)}`);

const RULES = [
  { name: 'current  (2h, max(100, 2.0%))', windowH: 2, floor: 100, pct: 0.020 },
  { name: 'option B (6h, max(100, 2.0%))', windowH: 6, floor: 100, pct: 0.020 },
];

// Classify a slice of rows under one rule. Returns {rising, steady, falling}.
// Algorithm mirrors getFlowState exactly: walk history, take latest entry whose
// timestamp <= cur.t - windowH. Hourly data → step is 1h → window=2 means past=2 rows ago.
function classify(slice, rule) {
  const windowMs = rule.windowH * 3600 * 1000;
  let rising = 0, steady = 0, falling = 0, undef = 0;
  let pastIdx = 0;
  for (let i = 0; i < slice.length; i++) {
    const cur = slice[i];
    const cutoff = cur.t - windowMs;
    while (pastIdx + 1 < slice.length && slice[pastIdx + 1].t <= cutoff) pastIdx++;
    const past = slice[pastIdx];
    if (!past || past.t > cutoff) { undef++; continue; }
    const change = cur.q - past.q;
    const threshold = Math.max(rule.floor, cur.q * rule.pct);
    if (Math.abs(change) >= threshold) {
      if (change > 0) rising++; else falling++;
    } else {
      steady++;
    }
  }
  return { rising, steady, falling, undef };
}

function fmt(label, c) {
  const tot = c.rising + c.steady + c.falling;
  const p = (n) => tot ? ((n / tot) * 100).toFixed(1).padStart(5) : '  ?';
  return `${label.padEnd(36)}  rising=${String(c.rising).padStart(5)} (${p(c.rising)}%)  ` +
    `steady=${String(c.steady).padStart(5)} (${p(c.steady)}%)  ` +
    `falling=${String(c.falling).padStart(5)} (${p(c.falling)}%)`;
}

// Full dataset
console.log('\n=== Full dataset (117k hourly obs, 2011-2026) ===');
for (const rule of RULES) console.log(fmt(rule.name, classify(rows, rule)));

// Slice helpers
const sliceMonth = (year, month) => rows.filter(r => {
  const d = new Date(r.t);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1;
});

// Pick a few historically wet/stormy months for spot-check.
// Mix snowmelt-driven (Mar-May) and tropical/heavy-rain (Jun-Sep) regimes.
const periods = [
  ['2018-05', 2018, 5],   // wet spring
  ['2020-04', 2020, 4],   // spring rains
  ['2018-09', 2018, 9],   // hurricane season
  ['2011-12', 2011, 12],  // dataset start, often wet
  ['2025-09', 2025, 9],   // recent
  ['2025-12', 2025, 12],  // recent
];
console.log('\n=== Spot-check on storm-prone months ===');
for (const [label, y, m] of periods) {
  const slice = sliceMonth(y, m);
  if (!slice.length) { console.log(`${label}: (no data)`); continue; }
  const qMin = Math.min(...slice.map(r => r.q));
  const qMax = Math.max(...slice.map(r => r.q));
  console.log(`\n${label}  n=${slice.length}  q range ${qMin.toFixed(0)}–${qMax.toFixed(0)} cfs`);
  for (const rule of RULES) console.log('  ' + fmt(rule.name, classify(slice, rule)));
}

// Also: per-flow-bin breakdown for full dataset under Option B.
// Flow bins per the model: <3k, 3-6k, 6-10k, 10-15k, 15-25k, 25-50k, 50k+
const BINS = [
  ['low      <3k',     0,   3000],
  ['mid_low  3-6k',  3000,  6000],
  ['mid     6-10k',  6000, 10000],
  ['high   10-15k', 10000, 15000],
  ['vhigh  15-25k', 15000, 25000],
  ['flood  25-50k', 25000, 50000],
  ['major   >50k',  50000, 1e9],
];
console.log('\n=== Option B (6h window) — distribution per flow bin (full dataset) ===');
const optB = RULES[1];
for (const [label, lo, hi] of BINS) {
  const slice = rows.filter(r => r.q >= lo && r.q < hi);
  if (!slice.length) continue;
  console.log('  ' + fmt(label, classify(slice, optB)));
}

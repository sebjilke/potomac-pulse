// Flow-state classification diagnostic
// Pulls PoR (01638500) 15-min discharge from USGS for last 14 days,
// then evaluates several (threshold, lookback) combos against the data.
// Reports rising/steady/falling counts so we can pick a non-arbitrary
// rule before changing getFlowState() in shared/model.js.

const SITE = '01638500';
const PERIOD = 'P14D';
const URL = `https://waterservices.usgs.gov/nwis/iv/?sites=${SITE}&parameterCd=00060&period=${PERIOD}&format=json`;

const RULES = [
  { name: 'current  (2h, max(100, 2.0%))', windowH: 2, floor: 100, pct: 0.020 },
  { name: 'looser pct (2h, max(100, 1.0%))', windowH: 2, floor: 100, pct: 0.010 },
  { name: 'looser both (2h, max(50, 0.5%))', windowH: 2, floor:  50, pct: 0.005 },
  { name: '4h window  (4h, max(100, 2.0%))', windowH: 4, floor: 100, pct: 0.020 },
  { name: '4h looser  (4h, max(100, 1.0%))', windowH: 4, floor: 100, pct: 0.010 },
  { name: '6h window  (6h, max(100, 2.0%))', windowH: 6, floor: 100, pct: 0.020 },
  { name: '6h looser  (6h, max(100, 1.0%))', windowH: 6, floor: 100, pct: 0.010 },
];

(async () => {
  const res = await fetch(URL);
  if (!res.ok) { console.error('USGS fetch failed:', res.status); process.exit(1); }
  const json = await res.json();

  const ts = json.value?.timeSeries?.[0];
  const values = ts?.values?.[0]?.value || [];
  const readings = values
    .map(v => ({ t: new Date(v.dateTime).getTime(), q: parseFloat(v.value) }))
    .filter(r => r.q > 0 && r.q < 500000)
    .sort((a, b) => a.t - b.t);

  console.log(`Pulled ${readings.length} readings, ` +
    `${new Date(readings[0].t).toISOString()} → ${new Date(readings.at(-1).t).toISOString()}`);
  console.log(`q range: ${Math.min(...readings.map(r => r.q)).toFixed(0)}` +
    ` – ${Math.max(...readings.map(r => r.q)).toFixed(0)} cfs\n`);

  // For each rule, classify each reading using the same algorithm
  // getFlowState uses: walk history, take latest entry whose timestamp <= now - windowH.
  // We mimic exactly: for reading[i], find reading[j] with t_j <= t_i - windowH*3600s,
  // taking the j that maximizes t_j (closest to the boundary, on the older side).
  for (const rule of RULES) {
    const windowMs = rule.windowH * 3600 * 1000;
    let rising = 0, steady = 0, falling = 0, undef = 0;
    let pastIdx = 0;

    for (let i = 0; i < readings.length; i++) {
      const cur = readings[i];
      const cutoff = cur.t - windowMs;
      // Advance pastIdx to track latest reading <= cutoff. Monotonic since readings sorted.
      while (pastIdx + 1 < readings.length && readings[pastIdx + 1].t <= cutoff) pastIdx++;
      const past = readings[pastIdx];
      if (!past || past.t > cutoff) { undef++; continue; }

      const change = cur.q - past.q;
      const threshold = Math.max(rule.floor, cur.q * rule.pct);
      if (Math.abs(change) >= threshold) {
        if (change > 0) rising++; else falling++;
      } else {
        steady++;
      }
    }

    const total = rising + steady + falling;
    const pct = (n) => total ? ((n / total) * 100).toFixed(1).padStart(5) : '  ?';
    console.log(
      `${rule.name.padEnd(36)}  rising=${String(rising).padStart(4)} (${pct(rising)}%)  ` +
      `steady=${String(steady).padStart(4)} (${pct(steady)}%)  ` +
      `falling=${String(falling).padStart(4)} (${pct(falling)}%)  ` +
      `(undef=${undef})`
    );
  }

  // Histogram of |Δcfs| / q (percent change per 2h) — sanity check on threshold floors
  console.log('\nDistribution of |Δcfs| over 2h, as percent of current cfs:');
  const pctChanges2h = [];
  let pIdx = 0;
  for (let i = 0; i < readings.length; i++) {
    const cur = readings[i];
    const cutoff = cur.t - 2 * 3600 * 1000;
    while (pIdx + 1 < readings.length && readings[pIdx + 1].t <= cutoff) pIdx++;
    const past = readings[pIdx];
    if (!past || past.t > cutoff) continue;
    pctChanges2h.push(Math.abs(cur.q - past.q) / cur.q);
  }
  pctChanges2h.sort((a, b) => a - b);
  const q = (p) => (pctChanges2h[Math.floor(pctChanges2h.length * p)] * 100).toFixed(2);
  console.log(`  p10=${q(0.10)}%  p25=${q(0.25)}%  p50=${q(0.50)}%  ` +
    `p75=${q(0.75)}%  p90=${q(0.90)}%  p99=${q(0.99)}%`);

  // And the absolute Δcfs distribution
  console.log('\nDistribution of |Δcfs| over 2h, absolute:');
  const absChanges2h = [];
  pIdx = 0;
  for (let i = 0; i < readings.length; i++) {
    const cur = readings[i];
    const cutoff = cur.t - 2 * 3600 * 1000;
    while (pIdx + 1 < readings.length && readings[pIdx + 1].t <= cutoff) pIdx++;
    const past = readings[pIdx];
    if (!past || past.t > cutoff) continue;
    absChanges2h.push(Math.abs(cur.q - past.q));
  }
  absChanges2h.sort((a, b) => a - b);
  const qa = (p) => absChanges2h[Math.floor(absChanges2h.length * p)].toFixed(0);
  console.log(`  p10=${qa(0.10)}  p25=${qa(0.25)}  p50=${qa(0.50)}  ` +
    `p75=${qa(0.75)}  p90=${qa(0.90)}  p99=${qa(0.99)} cfs`);
})();

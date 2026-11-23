#!/usr/bin/env node
'use strict';
// Gate run: replays scenario S0 over all predicted runs, compares with the log (FIDELITY_SPEC.md), writes
// out/fidelity_table.csv and out/fidelity_summary.csv, prints the gate verdict. No clock, no randomness.
const path = require('path');
const fs = require('fs');
const E = require('./lib/engine.cjs');
const G = require('./lib/gate.cjs');
const { writeObjects } = require('./lib/csv.cjs');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

async function runGate() {
    const F = E.loadFrozen();
    const all = E.loadRuns();
    const P = all.filter(r => r.out === 'predicted');
    const revIdxLogged = E.findRevisionIndex(F, P);
    const revIdx = E.findRevisionIndexByStamp(F, P);
    if (revIdx !== revIdxLogged) throw new Error('STOP: revision boundary from the bulk stamp (run index ' + revIdx + ') differs from the one found by the logged flow (' + revIdxLogged + ')');
    const TL = E.buildBinTimeline();
    const binsFor = (k, run) => TL.stateAt(run.at);
    const { recs, counters } = await E.runScenario(F, P, 'S0', revIdx, binsFor);
    const defs = G.fieldDefs();
    const table = [];
    const perRun = [];
    for (let k = 0; k < P.length; k++) {
        const run = P[k], rec = recs[k];
        if (!rec.ok || !rec.pred) { perRun.push({ k, run, gate: 'none', failed: ['no_prediction'], cats: [] }); continue; }
        const c = G.compareRun(rec, run, defs);
        const gate = G.gateOf(rec);
        const cats = c.failed.length ? G.categorize(rec, run, c.failed, F, all) : [];
        for (const r of c.rows) table.push({ seq: run.seq, at: run.atIso, used: run.used ? 1 : 0, gate, ver: run.ver, field: r.field, counted: r.counted ? 1 : 0, logged: r.logged, replayed: r.replayed, diff: r.diff, pass: r.pass });
        perRun.push({ k, run, rec, gate, failed: c.failed, cats });
    }
    return { F, all, P, revIdx, TL, recs, counters, defs, table, perRun };
}

function summarize(res) {
    const { perRun, table, P, revIdx } = res;
    const out = { revIdx, revRunAt: P[revIdx].atIso, nRuns: P.length };
    const gates = { A: [], B: [] };
    for (const pr of perRun) if (pr.gate === 'A' || pr.gate === 'B') gates[pr.gate].push(pr);
    out.gateA = { runs: gates.A.length, misses: gates.A.filter(p => p.failed.length).length, byCategory: {} };
    for (const p of gates.A) if (p.failed.length) {
        const key = p.cats.length ? p.cats.join('+') : 'UNCLASSIFIED';
        (out.gateA.byCategory[key] = out.gateA.byCategory[key] || []).push({ at: p.run.atIso, failed: p.failed });
    }
    out.gateB = { runs: gates.B.length, misses: gates.B.filter(p => p.failed.length).length };
    // Gate B stats
    const histRows = table.filter(r => r.gate === 'B' && r.field === 'hist.cfs');
    const withDiff = histRows.filter(r => r.diff !== null);
    out.gateB.histCfsRuns = histRows.length;
    out.gateB.histCfsExact = histRows.filter(r => r.pass).length;
    out.gateB.histCfsWithin20 = withDiff.filter(r => Math.abs(r.diff) <= 20).length;
    out.gateB.histCfsMaxAbsDiff = withDiff.length ? Math.max(...withDiff.map(r => Math.abs(r.diff))) : null;
    const riseRows = table.filter(r => r.gate === 'B' && r.field === 'rise.r');
    out.gateB.riseRRuns = riseRows.length;
    out.gateB.riseRExact = riseRows.filter(r => r.pass).length;
    // per-field pass rates, all runs
    const byField = {};
    for (const r of table) {
        const b = byField[r.field] = byField[r.field] || { counted: r.counted, n: 0, pass: 0 };
        b.n++; b.pass += r.pass;
    }
    out.byField = byField;
    return out;
}

module.exports = { runGate, summarize };

if (require.main === module) {
    runGate().then(res => {
        const s = summarize(res);
        console.log(JSON.stringify(s, null, 1));
        console.log('input counters', JSON.stringify(res.counters));
        const sub = res.perRun.filter(p => p.failed.length).map(p => `${p.run.seq} ${p.run.atIso} ${p.gate} [${p.failed.join(',')}] ${p.cats.join('+')}`);
        console.log(sub.slice(0, 80).join('\n'));
        console.log('failed runs', sub.length);
    }).catch(e => { console.error(e); process.exit(1); });
}

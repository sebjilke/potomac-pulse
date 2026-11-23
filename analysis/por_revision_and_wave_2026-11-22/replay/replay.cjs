#!/usr/bin/env node
'use strict';
// Replay tool: gate, scenarios, per-component labels, 2 x 2 x 2, truth series. One command: see README.md.
//   node replay.cjs                       gate, fidelity outputs, and (only if the gate verdict is PASS) everything else
//   node replay.cjs --gate-ruling="text"  run everything although Gate A is not PASS; the ruling text is written into the outputs' GATE_VERDICT.json
//   node replay.cjs --outdir=DIR          write into DIR instead of out/ (used for tests)
// No clock, no randomness, no network, no database. Output files are byte-identical between runs.
const path = require('path');
const fs = require('fs');
const E = require('./lib/engine.cjs');
const G = require('./lib/gate.cjs');
const { load } = require('./lib/loader.cjs');
const { postIteration } = require('./lib/post_iteration_copy.cjs');
const { writeObjects, readObjects } = require('./lib/csv.cjs');
const { runGate, summarize } = require('./gate_run.cjs');

const args = process.argv.slice(2);
const argv = {};
for (const a of args) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) argv[m[1]] = m[2] === undefined ? true : m[2]; }
const OUT = argv.outdir ? path.resolve(argv.outdir) : path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const H = E.H;
const iso = ms => (ms === null || ms === undefined || !Number.isFinite(ms)) ? '' : new Date(ms).toISOString();
const r1 = x => (x === null || x === undefined || !Number.isFinite(x)) ? '' : x;
const GATE_MISS = { 136: 'temp_only', 147: 'temp_only', 212: 'por_reading_rewritten', 217: 'rise_rate_only' };
const gm = seq => GATE_MISS[seq] || '';
const lab = p => (p === 'archive' || p === 'f_old') ? 'old' : (p === 'current' ? 'new' : '');
const mix = (...ps) => { const s = new Set(ps.map(lab)); return s.size === 1 ? [...s][0] : 'mixed'; };

function writeJson(name, obj) { fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 1) + '\n'); }

// ------------------------------------------------------------------ fidelity outputs
function writeFidelity(res, summary, verdict) {
    const cols = ['seq', 'at_utc', 'used', 'gate', 'ver', 'field', 'counted', 'logged', 'replayed', 'difference', 'pass'];
    const rows = res.table.map(r => ({ seq: r.seq, at_utc: r.at, used: r.used, gate: r.gate, ver: r.ver, field: r.field, counted: r.counted, logged: r.logged, replayed: r.replayed, difference: r.diff, pass: r.pass }));
    writeObjects(path.join(OUT, 'fidelity_table.csv'), cols, rows);
    // summary: per field, then per gate
    const S = [];
    const fields = [...new Set(res.table.map(r => r.field))];
    for (const f of fields) {
        const rs = res.table.filter(r => r.field === f);
        const a = rs.filter(r => r.gate === 'A'), b = rs.filter(r => r.gate === 'B');
        const rate = (x, k) => x.length ? (x.filter(r => r.pass).length / x.length).toFixed(4) : '';
        S.push({ section: 'field', item: f, counted: rs[0].counted, runs: rs.length, passes: rs.filter(r => r.pass).length, rate: rate(rs), gateA_runs: a.length, gateA_passes: a.filter(r => r.pass).length, gateA_rate: rate(a), gateB_runs: b.length, gateB_passes: b.filter(r => r.pass).length, gateB_rate: rate(b), note: '' });
    }
    S.push({ section: 'gate', item: 'A', counted: '', runs: summary.gateA.runs, passes: summary.gateA.runs - summary.gateA.misses, rate: (1 - summary.gateA.misses / summary.gateA.runs).toFixed(4), note: `misses=${summary.gateA.misses}; cap=3; categories=${JSON.stringify(Object.fromEntries(Object.entries(summary.gateA.byCategory).map(([k, v]) => [k, v.length])))}` });
    S.push({ section: 'gate', item: 'B', counted: '', runs: summary.gateB.runs, passes: summary.gateB.runs - summary.gateB.misses, rate: (1 - summary.gateB.misses / summary.gateB.runs).toFixed(4), note: `hist.cfs exact ${summary.gateB.histCfsExact}/${summary.gateB.histCfsRuns}, within 20 cfs ${summary.gateB.histCfsWithin20}, max abs diff ${summary.gateB.histCfsMaxAbsDiff}; rise.r exact ${summary.gateB.riseRExact}/${summary.gateB.riseRRuns}; B verdict ${verdict.gateB}` });
    S.push({ section: 'gate', item: 'verdict', counted: '', runs: res.P.length, passes: '', rate: '', note: `Gate A ${verdict.gateA}; Gate B ${verdict.gateB}` });
    writeObjects(path.join(OUT, 'fidelity_summary.csv'), ['section', 'item', 'counted', 'runs', 'passes', 'rate', 'gateA_runs', 'gateA_passes', 'gateA_rate', 'gateB_runs', 'gateB_passes', 'gateB_rate', 'note'], S);
}

function gateVerdict(summary) {
    const catsOk = Object.keys(summary.gateA.byCategory).every(k => k !== 'UNCLASSIFIED');
    const A = (summary.gateA.misses <= 3 && catsOk) ? 'PASS' : 'FAIL';
    const histOk = summary.gateB.histCfsWithin20 === summary.gateB.histCfsRuns;
    const exactShare = summary.gateB.histCfsExact / summary.gateB.histCfsRuns;
    const riseShare = summary.gateB.riseRExact / summary.gateB.riseRRuns;
    const B = (histOk && exactShare >= 0.95 && riseShare >= 0.95) ? 'PASS' : 'FAIL_approximate';
    return { gateA: A, gateB: B, gateA_misses: summary.gateA.misses, gateA_runs: summary.gateA.runs, gateB_runs: summary.gateB.runs };
}

// ------------------------------------------------------------------ flat run record
function flat(F, rec, scName, runMissed) {
    const run = rec.run, tr = rec.trace, pr = rec.pred;
    const d = rec.usgsData.data, g = rec.usgsData.gauges;
    const foldFlag = (ts) => { const f = F.fold.get(ts); return f ? f.flag : ''; };
    const isOldRule = scName.startsWith('S-old');
    const foldFlagC = (ts) => { const f = F.fold.get(ts); return f ? f.flagC : ''; };
    const extrap = (ts, prov) => ((isOldRule && prov === 'f_old') || (scName === 'S0' && prov === 'f_old')) ? (scName === 'S-old-C' ? foldFlagC(ts) : foldFlag(ts)) : '';
    const tribSum = (tr.monoFlow || 0) + (tr.gooseFlow || 0) + (tr.brFlow || 0) + (tr.senFlow || 0);
    return {
        seq: run.seq, at_utc: run.atIso, used: run.used ? 1 : 0, ver: run.ver, scenario: scName,
        cur_q: d[g.por].q, cur_qT_utc: iso(run.T.por_q), cur_prov: rec.curProv, cur_extrap_flag: extrap(run.T.por_q, rec.curProv),
        back6_ts_utc: rec.back6 ? iso(rec.back6.ts) : '', back6_cfs: rec.back6 ? rec.back6.cfs : '', back6_prov: rec.back6 ? rec.back6.prov : '', back6_extrap_flag: rec.back6 ? extrap(rec.back6.ts, rec.back6.prov) : '',
        hist_ts_utc: tr.nohist ? '' : iso(tr.histTs), hist_cfs: tr.nohist ? '' : tr.histCfs, hist_ago_h: tr.nohist ? '' : E.logNum(tr.histAgo, 2), hist_prov: rec.histProv || '', hist_extrap_flag: tr.nohist ? '' : extrap(tr.histTs, rec.histProv),
        rise_r_pct_per_h: tr.rate === null ? '' : E.logNum(tr.rate, 3), rise_rst: tr.rst || '',
        trv_t0_h: E.logNum(tr.t0, 2), trv_t_h: E.logNum(tr.t, 2), trv_it: tr.it, trv_stop: tr.stop, iteration_limit: tr.stop === 'max_iter' ? 1 : 0, trv_mult: E.logNum(tr.mult, 3), trv_gf2lf_h: E.logNum(tr.gf2lf, 2), trv_nohist: tr.nohist ? 1 : 0,
        lf_q: d[g.lf].q, trib_sum_cfs: tribSum,
        pre_cfs: E.logNum(tr.preCfs, 1), delta_pct: tr.nohist ? '' : E.logNum(tr.pct, 2), delta_on: tr.deltaOn ? 1 : 0, delta_decay: tr.decay === undefined ? '' : E.logNum(tr.decay, 3), delta_ratio: tr.ratio === undefined ? '' : E.logNum(tr.ratio, 4),
        por_est_cfs: E.logNum(tr.porEst), ef_w: E.logNum(pr.efWeight, 3), ef_used: pr.useEfEnsemble ? 1 : 0,
        raw_cfs: E.logNum(tr.rawUnc, 1), raw_cfs_unrounded: tr.rawUnc, raw_stage_ft: E.logNum(pr.rawFinalStage, 2),
        corr_bin: pr.flowBin, corr_st: pr.flowState, corr_c: E.logNum(tr.corr, 1), corr_unc: E.logNum(tr.unc, 1), ceil_lim: E.logNum(tr.ceilLim, 1), ceil_bound: tr.ceilBound ? 1 : 0,
        final_cfs: pr.predictedCFS, final_stage_ft: pr.predictedStage, due_utc: pr.validationDue,
        bins_basis: scName === 'S0' ? 'timeline' : 'frozen_before_first_revised_reading',
        approx_final: scName === 'S0' ? 0 : 1,
        approx_replay: scName === 'S0' ? 0 : '',      // set after the Gate B verdict is known (see below)
        s0_run_missed_a_counted_field: scName === 'S0' ? (runMissed ? 1 : 0) : '',
        gate_miss: gm(run.seq)
    };
}
const RUN_COLS = ['seq', 'at_utc', 'used', 'ver', 'scenario', 'cur_q', 'cur_qT_utc', 'cur_prov', 'cur_extrap_flag', 'back6_ts_utc', 'back6_cfs', 'back6_prov', 'back6_extrap_flag', 'hist_ts_utc', 'hist_cfs', 'hist_ago_h', 'hist_prov', 'hist_extrap_flag', 'rise_r_pct_per_h', 'rise_rst', 'trv_t0_h', 'trv_t_h', 'trv_it', 'trv_stop', 'iteration_limit', 'trv_mult', 'trv_gf2lf_h', 'trv_nohist', 'lf_q', 'trib_sum_cfs', 'pre_cfs', 'delta_pct', 'delta_on', 'delta_decay', 'delta_ratio', 'por_est_cfs', 'ef_w', 'ef_used', 'raw_cfs', 'raw_cfs_unrounded', 'raw_stage_ft', 'corr_bin', 'corr_st', 'corr_c', 'corr_unc', 'ceil_lim', 'ceil_bound', 'final_cfs', 'final_stage_ft', 'due_utc', 'bins_basis', 'approx_final', 'approx_replay', 's0_run_missed_a_counted_field', 'gate_miss'];

// ------------------------------------------------------------------ 2 x 2 x 2
function cell(F, rkX, rkP, rkD, M, run) {
    // X: flow numbers (rec of the scenario whose values are used), P: rec that picks the reading (timestamp, travel time),
    // D: rec that sets the due time (gf2lf).
    const { selectHistoricReading } = M;
    const out = { empty: 0, exact_stamp: '', match_window: 0 };
    const trP = rkP.trace;
    let historicPoR = null;
    if (!trP.nohist) {
        const hx = rkX.fullHistory;
        const ent = hx.find(e => e.timestamp === trP.histTs);
        if (ent) { historicPoR = { cfs: ent.cfs, actualHoursAgo: (run.finalTs - ent.timestamp) / H }; out.exact_stamp = 1; }
        else {
            out.exact_stamp = 0;
            const near = selectHistoricReading(hx, trP.histTs);   // the job's own one-hour match window (shared/model.js)
            if (!near) { out.empty = 1; return out; }
            historicPoR = { cfs: near.cfs, actualHoursAgo: (run.finalTs - near.timestamp) / H }; out.match_window = 1;
        }
    }
    const d = rkX.usgsData.data, g = rkX.usgsData.gauges;
    const t = rkX.trace;   // tributary flows: identical across scenarios by construction; taken from X
    const r = postIteration({
        historicPoR, travelPoRtoGF: trP.t, por: { q: d[g.por].q },
        monocacyFlow: t.monoFlow, gooseFlow: t.gooseFlow, broadRunFlow: t.brFlow, senecaFlow: t.senFlow,
        ef: d[g.ef], waterTempC: rkX.waterTempC
    }, M);
    out.raw = r.rawFinalUnclipped; out.pct = r.pct; out.decay = r.decay; out.ratio = r.ratio;
    out.hist_ts = historicPoR ? run.finalTs - historicPoR.actualHoursAgo * H : null;
    out.hist_cfs = historicPoR ? historicPoR.cfs : null; out.por_q = d[g.por].q; out.trv_t = trP.t;
    out.gf2lf = rkD.trace.gf2lf; out.due = new Date(run.finalTs + rkD.trace.gf2lf * H).toISOString();
    out.iter_limit_P = trP.stop === 'max_iter' ? 1 : 0;
    return out;
}

// ------------------------------------------------------------------ truth
function buildTruth(F, all, recsByScenario, P) {
    const lf = F.cur['01646500|00060'];
    const lfT = [], lfV = [];
    for (let i = 0; i < lf.t.length; i++) if (lf.v[i] !== '') { lfT.push(lf.t[i]); lfV.push(Number(lf.v[i])); }
    const T1 = (ms) => {
        let a = 0, b = lfT.length;
        while (a < b) { const m = (a + b) >> 1; if (lfT[m] <= ms) a = m + 1; else b = m; }
        const i = a - 1;       // last reading <= ms
        if (i < 0 || i >= lfT.length - 1) return { v: null, gap: null };
        if (lfT[i] === ms) return { v: lfV[i], gap: 0 };
        const f = (ms - lfT[i]) / (lfT[i + 1] - lfT[i]);
        return { v: lfV[i] + f * (lfV[i + 1] - lfV[i]), gap: (lfT[i + 1] - lfT[i]) / 60000 };
    };
    // runs that can validate: successful (predicted) rows with a logged LF flow reading in range; ordered by time
    const validators = P.filter(r => { const g = r.T.lf_q === null ? null : lf.get(r.T.lf_q); const q = g && g.v !== '' ? Number(g.v) : null; return q !== null && q >= 500 && q <= 500000; });
    const T2 = (dueMs) => {
        const run = validators.find(r => r.finalTs >= dueMs);
        if (!run) return null;
        const t = run.T.lf_q;
        const g = t === null ? null : lf.get(t);
        return { run, t, v: g && g.v !== '' ? Number(g.v) : null, delayMin: (run.finalTs - dueMs) / 60000, margin: run.finalTs - dueMs };
    };
    return { T1, T2 };
}

async function main() {
    const res = await runGate();
    const { F, all, P, revIdx, TL } = res;
    const summary = summarize(res);
    if (summary.gateA.runs + summary.gateB.runs !== P.length) throw new Error('STOP: only ' + (summary.gateA.runs + summary.gateB.runs) + ' of ' + P.length + ' predicted runs were replayed to a prediction');
    const verdict = gateVerdict(summary);
    writeFidelity(res, summary, verdict);
    const runMissed = new Map(res.perRun.map(p => [p.run.seq, p.failed.length > 0]));

    // bin timeline consistency (diagnostic, goes into facts.json)
    const binDiag = { snapshots_checked: 0, max_count_diff: 0, max_ema_diff: 0, bins_compared: 0 };
    for (let i = 1; i < TL.snapTimes.length; i++) {
        const S = TL.snapTimes[i], prev = TL.snaps.get(TL.snapTimes[i - 1]);
        const cur = new Map([...prev].map(([k, v]) => [k, { ...v }]));
        for (const u of TL.updates) if (u.tickAt > TL.snapTimes[i - 1] && u.tickAt <= S) cur.set(u.key, { ...u.state });
        for (const [k, v] of TL.snaps.get(S)) {
            const c = cur.get(k); if (!c) continue;
            binDiag.bins_compared++;
            binDiag.max_count_diff = Math.max(binDiag.max_count_diff, Math.abs(c.count - v.count));
            binDiag.max_ema_diff = Math.max(binDiag.max_ema_diff, Math.abs(c.emaMeanError - v.emaMeanError));
        }
        binDiag.snapshots_checked++;
    }
    const facts = { gateVerdict: verdict, revIdx, revRunAt: P[revIdx].atIso, predictedRuns: P.length, usedRuns: P.filter(r => r.used).length, errorRows: all.length - P.length, binTimelineConsistency: binDiag, inputCountersS0: res.counters, ruling: argv['gate-ruling'] || null };
    verdict.gateA_after_ruling = argv['gate-ruling'] ? (verdict.gateA === 'PASS' ? 'PASS' : 'ACCEPTED_DEVIATION') : null;
    writeJson('GATE_VERDICT.json', { verdict, summary: { gateA: { runs: summary.gateA.runs, misses: summary.gateA.misses, byCategory: summary.gateA.byCategory }, gateB: summary.gateB }, ruling: argv['gate-ruling'] || null });
    console.log('Gate A:', verdict.gateA, `(${summary.gateA.misses} misses of ${summary.gateA.runs} runs, cap 3)`, '| Gate B:', verdict.gateB, `(hist.cfs exact ${summary.gateB.histCfsExact}/${summary.gateB.histCfsRuns}, rise.r exact ${summary.gateB.riseRExact}/${summary.gateB.riseRRuns})`);
    if (verdict.gateA !== 'PASS' && !argv['gate-ruling']) {
        writeJson('facts.json', facts);
        console.log('Gate A is not PASS: scenarios, labels, 2x2x2 and truth are NOT produced. Re-run with --gate-ruling="<ruling>" after a ruling.');
        return;
    }
    const approxB = verdict.gateB !== 'PASS';

    // ---------------- scenarios
    const frozenBins = TL.stateAt(P[revIdx - 1].at);
    const frozenFn = () => frozenBins;
    const scen = { 'S0': res.recs };
    for (const sc of ['S-old-A', 'S-old-B', 'S-new', 'S-old-C']) {
        const o = await E.runScenario(F, P, sc, revIdx, frozenFn);
        scen[sc] = o.recs;
        facts['inputCounters_' + sc] = o.counters;
    }
    const names = ['S0', 'S-old-A', 'S-old-B', 'S-new', 'S-old-C'];
    // sanity that the "everything else identical" holds: tributary, LF, EF, temperature values equal across scenarios
    let identOther = 0;
    for (let k = 0; k < P.length; k++) {
        const a = scen['S0'][k];
        for (const nm of names.slice(1)) {
            const b = scen[nm][k];
            const ta = a.trace, tb = b.trace;
            if (ta.monoFlow !== tb.monoFlow || ta.gooseFlow !== tb.gooseFlow || ta.brFlow !== tb.brFlow || ta.senFlow !== tb.senFlow || a.pred.lfCFS !== b.pred.lfCFS || a.pred.efStage !== b.pred.efStage || a.waterTempC !== b.waterTempC || a.pred.validationDue === undefined) identOther++;
            if (E.GAUGES && a.run.finalTs !== b.run.finalTs) identOther++;
        }
    }
    facts.other_inputs_not_identical_across_scenarios = identOther;

    // ---------------- replay_runs.csv
    const runRows = [];
    for (const nm of names) {
        for (let k = 0; k < P.length; k++) {
            if (!P[k].used) continue;
            const f = flat(F, scen[nm][k], nm, runMissed.get(P[k].seq));
            if (nm === 'S0') f.approx_replay = approxB && res.perRun[k].gate === 'B' ? 1 : 0;
            runRows.push(f);
        }
    }
    writeObjects(path.join(OUT, 'replay_runs.csv'), RUN_COLS, runRows);

    // ---------------- labels.csv (S0, used runs)
    const labRows = [];
    for (let k = 0; k < P.length; k++) {
        if (!P[k].used) continue;
        const rec = scen['S0'][k];
        labRows.push({
            seq: P[k].seq, at_utc: P[k].atIso, gate: res.perRun[k].gate,
            cur_q: rec.usgsData.data[rec.usgsData.gauges.por].q, cur_qT_utc: iso(P[k].T.por_q), cur_prov: rec.curProv, cur_label: lab(rec.curProv),
            back6_ts_utc: rec.back6 ? iso(rec.back6.ts) : '', back6_prov: rec.back6 ? rec.back6.prov : '', back6_label: rec.back6 ? lab(rec.back6.prov) : '',
            hist_ts_utc: rec.trace.nohist ? '' : iso(rec.trace.histTs), hist_prov: rec.histProv || '', hist_label: rec.histProv ? lab(rec.histProv) : '',
            label_flow_state_rise_rate: rec.back6 ? mix(rec.curProv, rec.back6.prov) : '',
            label_time_shift: rec.histProv ? lab(rec.histProv) : '',
            label_delta_correction: rec.histProv ? mix(rec.curProv, rec.histProv) : '',
            label_all_three: rec.back6 && rec.histProv ? mix(rec.curProv, rec.back6.prov, rec.histProv) : '',
            gate_miss: gm(P[k].seq)
        });
    }
    writeObjects(path.join(OUT, 'labels.csv'), ['seq', 'at_utc', 'gate', 'cur_q', 'cur_qT_utc', 'cur_prov', 'cur_label', 'back6_ts_utc', 'back6_prov', 'back6_label', 'hist_ts_utc', 'hist_prov', 'hist_label', 'label_flow_state_rise_rate', 'label_time_shift', 'label_delta_correction', 'label_all_three', 'gate_miss'], labRows);
    const labBySeq = new Map(labRows.map(r => [r.seq, r]));

    // ---------------- iteration_limit_share.csv
    const ils = [];
    for (const nm of names) {
        const rs = P.map((r, k) => ({ r, rec: scen[nm][k] })).filter(x => x.r.used);
        const grp = (type, fn) => {
            const m = new Map();
            for (const x of rs) { const key = fn(x); if (key === null) continue; const b = m.get(key) || { n: 0, lim: 0 }; b.n++; b.lim += x.rec.trace.stop === 'max_iter' ? 1 : 0; m.set(key, b); }
            for (const [key, b] of [...m].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) ils.push({ scenario: nm, group_type: type, group: key, n_runs: b.n, n_max_iter: b.lim, share: (b.lim / b.n).toFixed(4) });
        };
        grp('all', () => 'all');
        grp('s0_label_time_shift', x => labBySeq.get(x.r.seq).label_time_shift || 'none');
        grp('s0_label_all_three', x => labBySeq.get(x.r.seq).label_all_three || 'none');
        grp('utc_day', x => x.r.atIso.slice(0, 10));
    }
    writeObjects(path.join(OUT, 'iteration_limit_share.csv'), ['scenario', 'group_type', 'group', 'n_runs', 'n_max_iter', 'share'], ils);

    // ---------------- 2 x 2 x 2: identity test first
    const M = load('v39.11').M;
    const idRows = [];
    let idFail = 0;
    for (const rule of ['A', 'B', 'C']) {
        const so = scen['S-old-' + rule], sn = scen['S-new'];
        for (let k = 0; k < P.length; k++) {
            const run = P[k];
            const co = cell(F, so[k], so[k], so[k], load(run.ver).M, run);
            const cn = cell(F, sn[k], sn[k], sn[k], load(run.ver).M, run);
            const eo = co.raw === so[k].trace.rawUnc, en = cn.raw === sn[k].trace.rawUnc;
            const eod = co.due === so[k].pred.validationDue, end = cn.due === sn[k].pred.validationDue;
            if (!(eo && en && eod && end)) idFail++;
            idRows.push({ seq: run.seq, old_rule: rule, used: run.used ? 1 : 0, old_raw_copy: co.raw, old_raw_production: so[k].trace.rawUnc, old_equal: eo ? 1 : 0, new_raw_copy: cn.raw, new_raw_production: sn[k].trace.rawUnc, new_equal: en ? 1 : 0, old_due_equal: eod ? 1 : 0, new_due_equal: end ? 1 : 0 });
        }
    }
    writeObjects(path.join(OUT, 'cell_identity_test.csv'), ['seq', 'old_rule', 'used', 'old_raw_copy', 'old_raw_production', 'old_equal', 'new_raw_copy', 'new_raw_production', 'new_equal', 'old_due_equal', 'new_due_equal'], idRows);
    facts.cell_identity_test = { runs: P.length, rules: 3, comparisons_per_rule: P.length * 2, failures: idFail };
    let cellRows = [];
    if (idFail === 0) {
        for (const rule of ['A', 'B', 'C']) {
            const so = scen['S-old-' + rule], sn = scen['S-new'];
            for (let k = 0; k < P.length; k++) {
                const run = P[k];
                if (!run.used) continue;
                const Mv = load(run.ver).M;
                for (const Nn of ['old', 'new']) for (const Pn of ['old', 'new']) for (const Dn of ['old', 'new']) {
                    const X = Nn === 'old' ? so[k] : sn[k], Pk = Pn === 'old' ? so[k] : sn[k], D = Dn === 'old' ? so[k] : sn[k];
                    const c = cell(F, X, Pk, D, Mv, run);
                    cellRows.push({
                        seq: run.seq, at_utc: run.atIso, old_rule: rule, flow_numbers: Nn, reading_pick_from: Pn, due_from: Dn,
                        pure_cell: (Nn === Pn && Pn === Dn) ? 1 : 0, empty: c.empty,
                        raw_cfs: c.empty ? '' : E.logNum(c.raw, 1), raw_cfs_unrounded: c.empty ? '' : c.raw,
                        hist_ts_utc: c.empty || c.hist_ts === null ? '' : iso(c.hist_ts), hist_cfs: c.empty ? '' : (c.hist_cfs === null ? '' : c.hist_cfs),
                        exact_stamp_in_history: c.exact_stamp, match_window_used: c.match_window, pick_scenario_iteration_limit: c.iter_limit_P === undefined ? '' : c.iter_limit_P,
                        por_q_used: c.empty ? '' : c.por_q, trv_t_of_pick_h: c.empty ? '' : E.logNum(c.trv_t, 2), delta_pct: c.empty || c.pct === null ? '' : E.logNum(c.pct, 2), delta_ratio: c.empty || c.ratio === null ? '' : E.logNum(c.ratio, 4),
                        gf2lf_h: E.logNum(c.gf2lf === undefined ? NaN : c.gf2lf, 2), due_utc: c.due || '', gate_miss: gm(run.seq)
                    });
                }
            }
        }
        writeObjects(path.join(OUT, 'replay_2x2x2.csv'), ['seq', 'at_utc', 'old_rule', 'flow_numbers', 'reading_pick_from', 'due_from', 'pure_cell', 'empty', 'raw_cfs', 'raw_cfs_unrounded', 'hist_ts_utc', 'hist_cfs', 'exact_stamp_in_history', 'match_window_used', 'pick_scenario_iteration_limit', 'por_q_used', 'trv_t_of_pick_h', 'delta_pct', 'delta_ratio', 'gf2lf_h', 'due_utc', 'gate_miss'], cellRows);
        facts.cells = { rows: cellRows.length, empty: cellRows.filter(r => r.empty).length, match_window_used: cellRows.filter(r => r.match_window_used).length };
    } else {
        console.log('2x2x2 identity test FAILED on', idFail, 'comparisons; mixed cells not written.');
    }

    // ---------------- truth.csv and the T2 gate
    const TR = buildTruth(F, all, scen, P);
    const truthRows = [];
    for (const nm of names) {
        for (let k = 0; k < P.length; k++) {
            if (!P[k].used) continue;
            const due = Date.parse(scen[nm][k].pred.validationDue);
            const t1 = TR.T1(due), t2 = TR.T2(due);
            truthRows.push({
                seq: P[k].seq, at_utc: P[k].atIso, scenario: nm, due_utc: scen[nm][k].pred.validationDue,
                t1_lf_cfs_interpolated: t1.v === null ? '' : t1.v.toFixed(3), t1_neighbour_gap_min: t1.gap === null ? '' : t1.gap,
                t2_lf_cfs_first_run_at_or_after_due: t2 && t2.v !== null ? t2.v : '', t2_run_at_utc: t2 ? t2.run.atIso : '', t2_run_seq: t2 ? t2.run.seq : '', t2_reading_time_utc: t2 && t2.t ? iso(t2.t) : '',
                t2_delay_min: t2 ? t2.delayMin.toFixed(2) : '', t2_within_2p5h_window: t2 ? (t2.delayMin * 60000 <= 2.5 * H ? 1 : 0) : '', t2_ambiguous_within_3s: t2 ? (Math.abs(t2.margin) < 3000 ? 1 : 0) : '', gate_miss: gm(P[k].seq)
            });
        }
    }
    writeObjects(path.join(OUT, 'truth.csv'), ['seq', 'at_utc', 'scenario', 'due_utc', 't1_lf_cfs_interpolated', 't1_neighbour_gap_min', 't2_lf_cfs_first_run_at_or_after_due', 't2_run_at_utc', 't2_run_seq', 't2_reading_time_utc', 't2_delay_min', 't2_within_2p5h_window', 't2_ambiguous_within_3s', 'gate_miss'], truthRows);
    // T2 gate: every logged check
    const checks = readObjects(path.join(__dirname, '..', 'data', 'tidy', 'checks.csv'));
    const gateRows = [];
    for (const c of checks) {
        const predTs = Date.parse(c.predTs_utc);
        const k = P.findIndex(r => r.finalTs === predTs);
        let traced = k >= 0;
        const dueLogged = Date.parse(c.dueAt_utc);
        const dueRep = traced ? Date.parse(scen['S0'][k].pred.validationDue) : null;
        const t2 = TR.T2(traced ? dueRep : dueLogged);
        const act = Number(c.actualCFS);
        gateRows.push({
            check_seq: c.seq, pred_ts_utc: c.predTs_utc, pred_run_seq: traced ? P[k].seq : '', traceable_in_log: traced ? 1 : 0,
            due_logged_utc: c.dueAt_utc, due_replayed_utc: traced ? scen['S0'][k].pred.validationDue : '', tick_at_utc: c.tickAt_utc,
            t2_run_at_utc: t2 ? t2.run.atIso : '', t2_equals_check_tick: t2 ? (t2.run.atIso === c.tickAt_utc ? 1 : 0) : '',
            t2_lf_cfs: t2 && t2.v !== null ? t2.v : '', actual_cfs_logged: act, t2_equals_actual: t2 && t2.v === act ? 1 : 0,
            note: traced ? '' : 'prediction made before the log begins: due time cannot be replayed; T2 shown from the logged due time, not part of the gate'
        });
    }
    writeObjects(path.join(OUT, 'truth_gate.csv'), ['check_seq', 'pred_ts_utc', 'pred_run_seq', 'traceable_in_log', 'due_logged_utc', 'due_replayed_utc', 'tick_at_utc', 't2_run_at_utc', 't2_equals_check_tick', 't2_lf_cfs', 'actual_cfs_logged', 't2_equals_actual', 'note'], gateRows);
    const tr = gateRows.filter(r => r.traceable_in_log === 1);
    facts.truth_gate = { checks: gateRows.length, traceable: tr.length, t2_equals_actual: tr.filter(r => r.t2_equals_actual === 1).length, t2_run_equals_check_tick: tr.filter(r => r.t2_equals_check_tick === 1).length, not_traceable: gateRows.filter(r => r.traceable_in_log !== 1).map(r => r.check_seq) };
    facts.truth = { rows: truthRows.length, t2_missing: truthRows.filter(r => r.t2_lf_cfs_first_run_at_or_after_due === '').length, t1_missing: truthRows.filter(r => r.t1_lf_cfs_interpolated === '').length, t2_outside_2p5h: truthRows.filter(r => r.t2_within_2p5h_window === 0).length, t2_ambiguous: truthRows.filter(r => r.t2_ambiguous_within_3s === 1).length };
    facts.rows = { replay_runs: runRows.length, labels: labRows.length, iteration_limit_share: ils.length, truth: truthRows.length };
    writeJson('facts.json', facts);
    console.log('wrote outputs to', OUT);
}

main().catch(e => { console.error(e); process.exit(1); });

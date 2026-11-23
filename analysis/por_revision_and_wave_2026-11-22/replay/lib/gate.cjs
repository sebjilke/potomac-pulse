'use strict';
// Fidelity gate: replay (scenario S0) against the logged values. Implements FIDELITY_SPEC.md sections 3 to 6.
const { logNum, porFlow, POR, H, GAUGES } = require('./engine.cjs');

const nz = s => (s === '' || s === undefined || s === null ? null : Number(s));
const eqNum = (a, b) => (a === null && b === null) || (a !== null && b !== null && a === b);

// [field, logged column, replay value fn(rec) -> number|string|null, kind, unrounded fn, tolerance extra, counted]
function fieldDefs() {
    const T = r => r.trace;
    const P = r => r.pred;
    const D = r => r.usgsData.data;
    const G = r => r.usgsData.gauges;
    return [
        // counted fields
        { f: 'hist.ts', col: 'hist_ts', num: true, get: r => (T(r).nohist ? null : T(r).histTs) },
        { f: 'hist.cfs', col: 'hist_cfs', num: true, get: r => (T(r).nohist ? null : logNum(T(r).histCfs, 1)) },
        { f: 'hist.ago', col: 'hist_ago', num: true, get: r => (T(r).nohist ? null : logNum(T(r).histAgo, 2)) },
        { f: 'rise.r', col: 'rise_r', num: true, get: r => logNum(T(r).rate, 3) },
        { f: 'rise.rst', col: 'rise_rst', num: false, get: r => (T(r).rst ?? null) },
        { f: 'trv.t0', col: 'trv_t0', num: true, get: r => logNum(T(r).t0, 2) },
        { f: 'trv.t', col: 'trv_t', num: true, get: r => logNum(T(r).t, 2) },
        { f: 'trv.it', col: 'trv_it', num: true, get: r => Math.round(T(r).it) },
        { f: 'trv.stop', col: 'trv_stop', num: false, get: r => T(r).stop ?? null },
        { f: 'trv.mult', col: 'trv_mult', num: true, get: r => logNum(T(r).mult, 3) },
        { f: 'trv.gf2lf', col: 'trv_gf2lf', num: true, get: r => logNum(T(r).gf2lf, 2) },
        { f: 'delta.pct', col: 'delta_pct', num: true, get: r => (T(r).nohist ? null : logNum(T(r).pct, 2)) },
        { f: 'delta.ratio', col: 'delta_ratio', num: true, get: r => logNum(T(r).ratio, 4) },
        { f: 'pre.cfs', col: 'pre_cfs', num: true, get: r => logNum(T(r).preCfs, 1) },
        { f: 'raw.cfs', col: 'raw_cfs', num: true, get: r => logNum(T(r).rawUnc, 1) },
        { f: 'corr.st', col: 'corr_st', num: false, get: r => P(r).flowState ?? null },
        { f: 'corr.bin', col: 'corr_bin', num: false, get: r => P(r).flowBin ?? null },
        { f: 'corr.c', col: 'corr_c', num: true, get: r => logNum(T(r).corr, 1), unr: r => T(r).corr, tol: 0.05 + 0.001 },
        { f: 'ceil.lim', col: 'ceil_lim', num: true, get: r => logNum(T(r).ceilLim, 1) },
        { f: 'ceil.bound', col: 'ceil_bound', num: true, get: r => (T(r).ceilBound ? 1 : 0) },
        { f: 'final.cfs', col: 'final_cfs', num: true, get: r => logNum(P(r).predictedCFS, 0), unr: r => (T(r).ceilBound ? T(r).ceilLim : T(r).unc), tol: 0.5 + 0.001 },
        { f: 'due', col: 'due', num: false, due: true, get: r => P(r).validationDue ?? null },
        { f: 'in.porHist.n', col: 'in_porHist_n', num: true, get: r => r.fullHistory.length },
        { f: 'in.porHist.firstT', col: 'in_porHist_firstT', num: true, get: r => r.fullHistory[0]?.timestamp ?? null },
        { f: 'in.porHist.lastT', col: 'in_porHist_lastT', num: true, get: r => r.fullHistory[r.fullHistory.length - 1]?.timestamp ?? null },
        // current readings (compared against the frozen value at the logged reading time)
        { f: 'cur.por.q', col: 'in_por_q', num: true, get: r => logNum(D(r)[G(r).por]?.q), cur: 'por' },
        { f: 'cur.por.h', col: 'in_por_h', num: true, get: r => logNum(D(r)[G(r).por]?.h, 2), cur: 'por' },
        { f: 'cur.lf.q', col: 'in_lf_q', num: true, get: r => logNum(D(r)[G(r).lf]?.q) },
        { f: 'cur.lf.h', col: 'in_lf_h', num: true, get: r => logNum(D(r)[G(r).lf]?.h, 2) },
        { f: 'cur.mono.q', col: 'in_mono_q', num: true, get: r => logNum(D(r)[G(r).monocacy]?.q) },
        { f: 'cur.goose.q', col: 'in_goose_q', num: true, get: r => logNum(D(r)[G(r).goose]?.q) },
        { f: 'cur.br.q', col: 'in_br_q', num: true, get: r => logNum(D(r)[G(r).broadRun]?.q) },
        { f: 'cur.sen.q', col: 'in_sen_q', num: true, get: r => logNum(D(r)[G(r).seneca]?.q) },
        { f: 'cur.ef.h', col: 'in_ef_h', num: true, get: r => logNum(D(r)[G(r).ef]?.h, 2) },
        { f: 'cur.temp.c', col: 'in_tC', num: true, get: r => logNum(r.waterTempC) },
        // informational
        { f: 'por.est', col: 'por_est', num: true, info: true, get: r => logNum(T(r).porEst) },
        { f: 'pre.shifted', col: 'pre_shifted', num: true, info: true, get: r => (T(r).preShifted ? 1 : 0) },
        { f: 'trv.nohist', col: 'trv_nohist', num: true, info: true, get: r => (T(r).nohist ? 1 : 0) },
        { f: 'delta.decay', col: 'delta_decay', num: true, info: true, get: r => logNum(T(r).decay, 3) },
        { f: 'raw.stage', col: 'raw_stage', num: true, info: true, get: r => logNum(P(r).rawFinalStage, 2) },
        { f: 'corr.unc', col: 'corr_unc', num: true, info: true, get: r => logNum(T(r).unc, 1) },
        { f: 'final.stage', col: 'final_stage', num: true, info: true, get: r => logNum(P(r).predictedStage, 2) },
        { f: 'ef.est', col: 'ef_est', num: true, info: true, get: r => logNum(P(r).efEstimateCFS) },
        { f: 'ef.w', col: 'ef_w', num: true, info: true, get: r => logNum(P(r).efWeight, 3) },
        { f: 'ef.used', col: 'ef_used', num: true, info: true, get: r => (P(r).useEfEnsemble ? 1 : 0) },
        { f: 'ef.disc', col: 'ef_disc', num: true, info: true, get: r => logNum(T(r).efDisc, 3) }
    ];
}

// Compare one replayed run with its logged row. Returns {rows, missed, failedFields}.
function compareRun(rec, run, defs) {
    const rows = [];
    const failed = [];
    for (const d of defs) {
        const lg = run.row[d.col];
        let logged = d.num ? nz(lg) : (lg === '' ? null : lg);
        let rep;
        try { rep = d.get(rec); } catch (e) { rep = null; }
        if (rep === undefined) rep = null;
        let pass, diff = null;
        if (d.due) {
            const ld = logged === null ? null : Date.parse(logged), rd = rep === null ? null : Date.parse(rep);
            diff = ld !== null && rd !== null ? rd - ld : null;
            pass = diff !== null && Math.abs(diff) <= 5000;
        } else if (d.num) {
            if (rep !== null && logged !== null) diff = Math.round((rep - logged) * 1e6) / 1e6;
            pass = eqNum(rep, logged);
            if (!pass && d.unr && logged !== null) {
                let u; try { u = d.unr(rec); } catch (e) { u = null; }
                if (typeof u === 'number' && Math.abs(u - logged) <= d.tol) pass = true;
            }
        } else {
            pass = (rep === logged);
        }
        // the first part of a counted-field pass for the circular reading of an old PoR flow is tabulated, not a basis (spec section 4)
        rows.push({ field: d.f, counted: !d.info, logged, replayed: rep, diff, pass: pass ? 1 : 0 });
        if (!d.info && !pass) failed.push(d.f);
    }
    return { rows, failed };
}

// Gate membership by provenance of the three used values.
function gateOf(rec) {
    if (!rec.trace) return 'none';
    const provs = [rec.curProv, rec.back6 ? rec.back6.prov : null, rec.histProv];
    return provs.includes('f_old') ? 'B' : 'A';
}

// Category assignment for a Gate A miss (FIDELITY_SPEC section 5, in this order).
function categorize(rec, run, failed, F, runsAll) {
    const cats = [];
    const cur = F.cur[POR + '|00060'];
    // 1. value rewritten after the run
    let c1 = false;
    const curFailed = failed.some(f => f.startsWith('cur.'));
    if (curFailed) c1 = true;
    const lmOf = t => { const g = cur.get(t); return g && g.lm > F.REV_LM ? g.lm : null; };
    const lmCheck = (ts, firstAt) => {
        if (ts == null) return false;
        const lm = lmOf(ts);
        return lm !== null && lm !== undefined && lm > (Number.isFinite(firstAt) ? firstAt : run.at);
    };
    if (rec.curProv === 'current' && lmCheck(run.T.por_q, run.at)) c1 = true;
    if (rec.histProv === 'current' && lmCheck(rec.trace?.histTs, rec.histFirstAt)) c1 = true;
    if (rec.back6 && rec.back6.prov === 'current' && lmCheck(rec.back6.ts, rec.back6.firstAt)) c1 = true;
    if (c1) cats.push('value_rewritten_after_run');
    // 2. reading not yet published
    const histFailed = failed.some(f => f.startsWith('in.porHist'));
    if (histFailed) {
        const lo = run.at - 48 * H;
        let late = false;
        for (const i of cur.range(lo, run.T.por_q)) {
            if (cur.lm[i] !== null && cur.lm[i] > F.REV_LM && cur.lm[i] > run.at) { late = true; break; }
        }
        if (late) cats.push('reading_not_yet_published');
    }
    // 3. duplicate run row
    const hourRows = runsAll.filter(r => r.row.clock_hour_utc === run.row.clock_hour_utc);
    const sib = runsAll.some(r => r !== run && r.out === 'predicted' && Math.abs(r.at - run.at) <= 15 * 60e3);
    if ((hourRows.length > 1 && !run.used) || (hourRows.length > 1 && sib)) cats.push('duplicate_run_row');
    return cats;
}

module.exports = { fieldDefs, compareRun, gateOf, categorize, nz };

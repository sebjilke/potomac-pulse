// Self-tests for ci_backtest_harness_lag.mjs on SMALL SYNTHETIC data (never the real series).
// Run: node selftest.mjs   (exit code non-zero if any test fails)
import {
    buildSeries, pickAt, inputsAt, LAGS, interpAt, ceilHour, tauFor, assertHistory, historyFor,
    runHybrid, anomaliesNew, scoreAnomalies, predictAtSimTime,
} from './ci_backtest_harness_lag.mjs';

const H = 3600000, MIN = 60000;
const T0 = Date.parse('2020-01-01T00:00:00Z');
let pass = 0, fail = 0;
function ok(cond, name, detail = '') {
    if (cond) { pass++; console.log(`PASS ${name}`); }
    else { fail++; console.log(`FAIL ${name} ${detail}`); }
}
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }
const hr = k => T0 + k * H;

// synthetic rows: hours 0..n-1, constant river, optional per-hour overrides; `skip` = hours with no row at all
function mkRows(n, { skip = [], por = 5000, lf = 5000, stage = 3.4, ef = null, goose = 150, temp = 12, over = {} } = {}) {
    const rows = [];
    for (let k = 0; k < n; k++) {
        if (skip.includes(k)) continue;
        const r = { epoch: hr(k), ts: '', por: por + (k % 7), ef, lf, lfStage: stage, temp, mono: 300, goose: goose + k, broad: 30, seneca: 40 };
        Object.assign(r, over[k] || {});
        rows.push(r);
    }
    return rows;
}

// ---- 1. lag operator by timestamp across a gap ----
{
    const rows = mkRows(30, { skip: [5, 6] });                // hours 5 and 6 have no row
    const S = buildSeries(rows);
    const t = hr(7);
    const F = pickAt(S, 'por', LAGS.F.por, t);
    ok(F && F.ep === hr(4) && F.age === 3,
        'F at t=7: lag 1 -> hour 6 is missing -> last available at/before = hour 4, age 3 h (timestamp, not row index)', JSON.stringify(F));
    const L = pickAt(S, 'por', LAGS.L.por, t);
    ok(L.ep === hr(4) && L.age === 3, 'L at t=7: lag 2 -> hour 5 missing -> hour 4, age 3 h', JSON.stringify(L));
    // index-based lag would have given a different row: row index of hour 7 is 5; index-2 = hour 3
    const idx = rows.findIndex(r => r.epoch === t);
    ok(rows[idx - 2].epoch === hr(3) && L.ep !== rows[idx - 2].epoch, 'index-based lag would differ from the timestamp lag here (so the test discriminates)');
    const t9 = hr(9);
    ok(pickAt(S, 'por', 1, t9).ep === hr(8) && pickAt(S, 'por', 2, t9).ep === hr(7), 'no gap involved: t=9 lag 1 -> hour 8, lag 2 -> hour 7 exactly, ages 1 and 2',
        JSON.stringify([pickAt(S, 'por', 1, t9), pickAt(S, 'por', 2, t9)]));
    ok(pickAt(S, 'por', 0, t9).ep === hr(9) && pickAt(S, 'por', 0, t9).age === 0, 'lag 0 returns the row at t, age 0');
}
// ---- 2. missing lagged value for one channel only; ages; window ----
{
    const rows = mkRows(60, { over: { 20: { goose: null }, 19: { goose: null }, 21: { ef: null } }, ef: 4.5 });
    const S = buildSeries(rows);
    const inp = inputsAt(S, 'L', hr(21));                       // L lag 2 -> hour 19 for PoR/EF/Goose/temp
    ok(inp.por.ep === hr(19) && inp.por.age === 2, 'L: PoR from t-2h, age 2');
    ok(inp.goose.ep === hr(18) && inp.goose.age === 3, 'L: Goose missing at hours 19,20 -> last available hour 18, age 3 h', JSON.stringify(inp.goose));
    ok(inp.lf.ep === hr(20) && inp.lf.age === 1 && inp.mono.ep === hr(20) && inp.seneca.age === 1 && inp.broad.age === 1,
        'L: LF, Monocacy, Seneca, Broad Run from t-1h');
    ok(inp.ef.ep === hr(19) && inp.temp.ep === hr(19), 'L: Edwards Ferry and PoR water temperature from t-2h');
    const F = inputsAt(S, 'F', hr(21));
    ok(F.ef.ep === hr(20) && F.ef.age === 1, 'F: EF from t-1h (hour 20 present), age 1', JSON.stringify(F.ef));
    const F0 = inputsAt(S, 'F0', hr(21));
    ok(F0.ef.ep === hr(20) && F0.ef.age === 1 && F0.por.age === 0, 'F0: EF missing at t=21 -> filled from hour 20 (age 1); PoR age 0');
    const L0 = inputsAt(S, 'L0', hr(21));
    ok(L0.por.age === 1 && L0.temp.age === 1 && L0.ef.age === 1 && L0.goose.ep === hr(18) && L0.lf.age === 0 && L0.mono.age === 0 && L0.broad.age === 0,
        'L0: three lagged gauges (PoR+temp, EF, Goose) at t-1h, rest at t', JSON.stringify(L0.goose));
    // window: nothing within 48h -> null
    const rows2 = mkRows(80, { skip: Array.from({ length: 60 }, (_, i) => 10 + i) });   // rows 0-9 and 70-79 only
    const S2 = buildSeries(rows2);
    ok(pickAt(S2, 'por', 1, hr(9 + 49)) === null, 'value older than 48 h at the sim clock -> null (no_por territory)');
    const p48 = pickAt(S2, 'por', 1, hr(9 + 48));
    ok(p48 !== null && p48.age === 48, 'value exactly 48 h old is still accepted (age logged as 48)');
}
// ---- 3. interpolation rule ----
{
    const rows = mkRows(10, { lf: 1000, over: { 3: { lf: 1000 }, 4: { lf: 2000 }, 7: { lf: null }, 8: { lf: 3000 } } });
    const S = buildSeries(rows);
    const m = S.lf.map;
    // placement: hour k's value sits at k + 22.5 min
    ok(interpAt(m, hr(3) + 22.5 * MIN).v === 1000, 'tau exactly at the centre of hour 3 returns that row');
    ok(Math.abs(interpAt(m, hr(3) + 52.5 * MIN).v - 1500) < 1e-9, 'tau half-way between centres of rows 3 and 4 -> mean');
    const tauX = hr(4) - 11 * MIN;                          // hour4:00 minus 11 min = 3:49
    const expect = 1000 + (2000 - 1000) * ((49 - 22.5) / 60);
    ok(Math.abs(interpAt(m, tauX).v - expect) < 1e-9 && interpAt(m, tauX).kind === 'interp', 'tau = 3:49 interpolates with weight 26.5/60 (two neighbours)');
    // one neighbour missing: tau 6:49 sits between rows 6 (present) and 7 (missing) -> row 6
    const t7 = interpAt(m, hr(7) - 11 * MIN);
    ok(t7.v === 1000 && t7.kind === 'lo', 'hi neighbour missing -> nearest row (lo) used', JSON.stringify(t7));
    // tau 7:49 sits between rows 7 (missing) and 8 (present, 3000) -> row 8, within one hour (centre 8:22.5 is 33.5 min away)
    const t8 = interpAt(m, hr(8) - 11 * MIN);
    ok(t8.v === 3000 && t8.kind === 'hi', 'lo neighbour missing -> nearest row (hi) used', JSON.stringify(t8));
    // no neighbour: remove rows 5..6 and tau between them
    const rows3 = mkRows(10, { over: { 5: { lf: null }, 6: { lf: null } } });
    const S3 = buildSeries(rows3);
    ok(interpAt(S3.lf.map, hr(6) - 11 * MIN) === null, 'both neighbours missing -> null (status no_truth), a row two hours away is NOT used');
    // truth instant rule
    ok(ceilHour(hr(10) + 30 * MIN) === hr(11) && tauFor(ceilHour(hr(10) + 30 * MIN)) === hr(11) - 11 * MIN, 'due 10:30 -> first whole hour 11:00 -> tau 10:49');
    ok(ceilHour(hr(11)) === hr(11) && tauFor(hr(11)) === hr(10) + 49 * MIN, 'due exactly 11:00 -> tau 10:49');
}
// ---- 4. history assertion ----
{
    const rows = mkRows(100);
    const S = buildSeries(rows);
    const t = hr(90);
    for (const a of ['F', 'L', 'F0', 'L0']) {
        const inp = inputsAt(S, a, t);
        const h = historyFor(S, inp.por, t);
        let okAll = true;
        try { assertHistory(inp.por, h); } catch (e) { okAll = false; }
        const lagH = LAGS[a].por;
        ok(okAll && h[h.length - 1].timestamp === t - lagH * H && h[0].timestamp >= t - 72 * H && h.every(e => e.timestamp <= inp.por.ep),
            `history for arm ${a}: last entry is PoR row t-${lagH}h, nothing newer, window <= 72 h`);
    }
    const inp = inputsAt(S, 'L', t);
    const h = historyFor(S, inp.por, t);
    const bad = h.slice(0, -1);                                // drop the newest entry
    ok(throws(() => assertHistory(inp.por, bad)), 'assertion throws when the history lacks the newest PoR row');
    const bad2 = h.slice(); bad2[bad2.length - 1] = { timestamp: h[h.length - 1].timestamp, cfs: h[h.length - 1].cfs + 1 };
    ok(throws(() => assertHistory(inp.por, bad2)), 'assertion throws when the last history value differs from por.q');
    // fill case: PoR missing at lagged timestamp -> history must end at the filled row
    const rowsG = mkRows(100, { skip: [88, 89] });
    const SG = buildSeries(rowsG);
    const inpG = inputsAt(SG, 'F', hr(90));                    // lag 1 -> hour 89 missing -> hour 87
    const hG = historyFor(SG, inpG.por, hr(90));
    let okG = true; try { assertHistory(inpG.por, hG); } catch (e) { okG = false; }
    ok(okG && inpG.por.ep === hr(87) && hG[hG.length - 1].timestamp === hr(87) && inpG.por.age === 3, 'filled PoR: newest history entry is the filled row (age 3 h)');
}
// ---- 5. hybrid slot logic, with a recording wrapper around the real production model ----
{
    const over = { 0: { lf: null }, 1: { lf: null }, 2: { lf: null } };
    for (let k = 100; k <= 130; k++) over[k] = { lf: null };
    const rows = mkRows(240, { over });
    const calls = [];
    const rec = (t, usgs, hist, temp, bins, trace) => {
        calls.push({ t, porQ: usgs.data['01638500'].q, last: hist[hist.length - 1], n: hist.length });
        return predictAtSimTime(t, usgs, hist, temp, bins, trace);
    };
    const a = runHybrid(rows, { arm: 'L', gate: 'new', predictFn: rec });
    const b = runHybrid(rows, { arm: 'L', gate: 'new' });
    ok(calls.length > 0 && calls.every(c => c.last.cfs === c.porQ), `recording model: newest PoR value == last history entry on all ${calls.length} calls`);
    ok(calls.every(c => c.last.timestamp === c.t - 2 * H), 'arm L (no gaps in PoR): newest history row is exactly t-2h on every call');
    ok(JSON.stringify(a.shadowRows) === JSON.stringify(b.shadowRows) && JSON.stringify(a.learnRows) === JSON.stringify(b.learnRows),
        'runHybrid is deterministic (two runs, identical rows)');
    // slot logic: intervals [predTs, valHourTs] of consecutive learning rows are disjoint and ordered
    const lr = a.learnRows;
    let disjoint = true;
    for (let i = 1; i < lr.length; i++) {
        if (!(Date.parse(lr[i].predTs) >= Date.parse(lr[i - 1].valHourTs))) disjoint = false;
        if (!(Date.parse(lr[i].valHourTs) > Date.parse(lr[i - 1].valHourTs))) disjoint = false;
    }
    ok(lr.length > 5 && disjoint, `single slot: ${lr.length} learning validations, each prediction stored at/after the previous validation`);
    const stored = a.cnt.learnSlotsStored;
    ok(stored === lr.length + a.cnt.learnDroppedMissedWindow + a.cnt.slotLeftPending, `every stored slot (${stored}) ends as a validation (${lr.length}), a missed-window drop (${a.cnt.learnDroppedMissedWindow}) or is still pending`);
    // shadow track never learns: total bin count equals learned rows, far fewer than shadow predictions
    let total = 0; for (const bn of Object.values(a.bins)) for (const s of Object.values(bn)) total += s.count;
    ok(total === a.cnt.learnLearned && a.cnt.learnLearned < a.cnt.status.predicted / 2, `bins hold ${total} observations == learning-track learned count; shadow predictions (${a.cnt.status.predicted}) added none`);
    ok(a.binRows.length === a.cnt.learnLearned, 'one bins row per bin update');
    // shadow row for every simulated prediction hour; never dropped
    ok(a.shadowRows.length === a.cnt.predictAttempts && Object.values(a.cnt.status).reduce((x, y) => x + y, 0) === a.shadowRows.length, 'one shadow row per simulated hour, statuses sum to rows');
    // retry path: LF missing at hours 100-102 must yield no_truth shadow rows and at least one retry or drop in the learning track
    const nt = a.shadowRows.filter(r => r.status === 'no_truth').length;
    ok(nt > 0 && a.cnt.status.no_lf > 0, `missing LF produces no_truth (${nt}) and no_lf (${a.cnt.status.no_lf}) statuses, not silent drops`);
    ok(a.cnt.learnRetries + a.cnt.learnDroppedMissedWindow > 0, 'learning track retried or dropped a slot when truth was missing');
    // switch run: arm L until the switch then F
    const sw = runHybrid(rows, { arm: 'L', gate: 'new', switchMs: hr(150), armLabel: 'L>F' });
    ok(sw.shadowRows.filter(r => Date.parse(r.predTs) < hr(150)).every(r => r.inputArm === 'L') && sw.shadowRows.filter(r => Date.parse(r.predTs) >= hr(150)).every(r => r.inputArm === 'F'),
        'switch: inputs follow L before the switch time and F from then on');
    const upto = runHybrid(rows, { arm: 'F', gate: 'new', untilMs: hr(120) });
    ok(upto.shadowRows.every(r => Date.parse(r.predTs) <= hr(120)) && upto.shadowRows.length > 100, '--until stops new predictions at the given time');
    // shadow validated at its own tau: tauTs == valHourTs - 11 min, valHourTs the first whole hour >= dueTs
    const vr = a.shadowRows.filter(r => r.status === 'predicted');
    ok(vr.every(r => Date.parse(r.tauTs) === Date.parse(r.valHourTs) - 11 * MIN && Date.parse(r.valHourTs) >= Date.parse(r.dueTs) && Date.parse(r.valHourTs) - Date.parse(r.dueTs) <= H),
        'every validated shadow row: valHour = first whole hour at/after due, tau = valHour - 11 min');
}
// ---- 6. anomaly gates on synthetic values ----
{
    const bin0 = { count: 0, sumError: 0, sumErrorSq: 0, meanError: 0 };
    const base = { errorCFS: 0, errorPercentRaw: 0, actualLF: 1000, actualStage: 2.6, efStage: null, temp: 15, binData: bin0 };
    const cold = anomaliesNew({ ...base, temp: 2, nowMs: Date.parse('2020-07-01T00:00Z') });
    ok(cold.checks.c3 === 1 && cold.isHardFlagged, 'new gate: low flow + high stage + cold water -> Check 3 hard');
    const warm = anomaliesNew({ ...base, temp: 15, nowMs: Date.parse('2020-01-15T00:00Z') });
    ok(warm.checks.c3 === 0 && !warm.isHardFlagged, 'new gate: same but 15 C in January -> no Check 3 (temperature decides)');
    const unkJan = anomaliesNew({ ...base, temp: null, nowMs: Date.parse('2020-01-15T00:00Z') });
    const unkJul = anomaliesNew({ ...base, temp: null, nowMs: Date.parse('2020-07-15T00:00Z') });
    ok(unkJan.checks.c3 === 1 && unkJul.checks.c3 === 0, 'new gate: unknown temperature falls back to the Nov-Mar month rule');
    ok(scoreAnomalies({ ...base, temp: 15 }).checks.c3 === 1, 'old gate: Check 3 has no temperature gate (fires at 15 C)');
    const s2 = anomaliesNew({ ...base, actualLF: 10000, actualStage: 8.0, temp: 15, nowMs: 0 });
    ok(s2.checks.c2 === 1 && s2.isHardFlagged, 'Check 2: stage implies much more flow than reported -> hard');
    const ef = anomaliesNew({ ...base, actualLF: 10000, actualStage: 3.95, efStage: 8, nowMs: 0 });
    ok(ef.checks.c1 === 1 && ef.isSoftFlagged && !ef.isHardFlagged, 'Check 1: EF estimate > 125% of LF -> soft only');
    const bigBin = { count: 20, sumError: 0, sumErrorSq: 20 * 100 * 100, meanError: 0, emaMeanError: 0 };
    const o = anomaliesNew({ ...base, actualStage: 3.4, actualLF: 5000, errorCFS: 500, errorPercentRaw: 10, binData: bigBin, nowMs: 0 });
    ok(o.checks.c5 === 1 && o.isSoftFlagged && !o.isHardFlagged, 'Check 5 (z=5): soft in the new gate (never hard)');
    const oo = scoreAnomalies({ ...base, actualStage: 3.4, actualLF: 5000, errorCFS: 500, errorPercentRaw: 10, binData: bigBin });
    ok(oo.checks.c5 === 1 && oo.isHardFlagged, 'Check 5 (z=5): HARD in the old gate');
    const c4 = anomaliesNew({ ...base, actualStage: 3.4, actualLF: 5000, errorCFS: 3000, errorPercentRaw: 60, nowMs: 0 });
    ok(c4.checks.c4 === 1 && !c4.isSoftFlagged, 'Check 4 alone (+1) does not flag');
}

console.log(`\nSELFTEST: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

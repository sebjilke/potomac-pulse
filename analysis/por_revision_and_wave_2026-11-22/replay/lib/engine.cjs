'use strict';
// Replay engine: re-runs the production prediction code (frozen export) for every logged run of the job.
// No fitting, no logged values as inputs, no randomness, no wall clock. See ../FIDELITY_SPEC.md.
const path = require('path');
const fs = require('fs');
const { readObjects } = require('./csv.cjs');
const { load } = require('./loader.cjs');

const STUDY = path.resolve(__dirname, '..', '..');
const TIDY = path.join(STUDY, 'data', 'tidy');
const FOLD = path.join(STUDY, 'replay', 'f_old', 'f_old_values.csv');

const H = 3600e3;
const POR = '01638500', LF = '01646500', MONO = '01643000', GOOSE = '01644000', BR = '01644280', SEN = '01645000', EF = '01644148';
const GAUGES = { por: POR, lf: LF, monocacy: MONO, goose: GOOSE, broadRun: BR, seneca: SEN, ef: EF };
const ARCH_END = Date.parse('2026-11-09T23:55:00Z');
const OLD_END = Date.parse('2026-11-13T17:55:00Z');

// -------------------------------------------------------------- numbers as the job logs them
function logNum(x, d = 1) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return null;
    const f = Math.pow(10, d);
    return Math.round(x * f) / f;
}

// -------------------------------------------------------------- frozen data
class Series {
    constructor() { this.t = []; this.v = []; this.a = []; this.lm = []; this.idx = new Map(); }
    add(t, v, a, lm) { this.idx.set(t, this.t.length); this.t.push(t); this.v.push(v); this.a.push(a); this.lm.push(lm); }
    get(t) { const i = this.idx.get(t); return i === undefined ? null : { v: this.v[i], a: this.a[i], lm: this.lm[i] }; }
    // indices of readings with lo < t <= hi (series is time-ordered in the tables)
    range(lo, hi) {
        const out = [];
        // binary search first index with t > lo
        let a = 0, b = this.t.length;
        while (a < b) { const m = (a + b) >> 1; if (this.t[m] > lo) b = m; else a = m + 1; }
        for (let i = a; i < this.t.length && this.t[i] <= hi; i++) out.push(i);
        return out;
    }
}

function loadFrozen() {
    const F = { cur: {}, arch: new Series(), fold: new Map() };
    for (const r of readObjects(path.join(TIDY, 'readings_current_model.csv'))) {
        const key = r.gauge + '|' + r.parameter;
        (F.cur[key] || (F.cur[key] = new Series())).add(Date.parse(r.time_utc), r.value, r.approval, r.last_modified_utc ? Date.parse(r.last_modified_utc) : null);
    }
    for (const k of Object.keys(F.cur)) {
        const s = F.cur[k];
        for (let i = 1; i < s.t.length; i++) if (s.t[i] <= s.t[i - 1]) throw new Error('current series not strictly increasing: ' + k);
    }
    for (const r of readObjects(path.join(TIDY, 'readings_old_archive.csv'))) {
        if (r.gauge === POR && r.parameter === '00060') F.arch.add(Date.parse(r.time_utc), r.value, r.approval, null);
    }
    for (const r of readObjects(FOLD)) {
        F.fold.set(Date.parse(r.time_utc), { A: Number(r.f_old_rule_A_cfs), B: Number(r.f_old_rule_B_cfs), C: Number(r.f_old_rule_C_cfs), flag: r.flag, flagC: r.flag_rule_C, level: r.level_ft_today });
    }
    // The common last_modified stamp of the 13 Nov bulk revision: the stamp carried by the last old-world reading (13 Nov 17:55).
    // Stamps at or below it carry no publication-time information (the revision overwrote them).
    const g = F.cur[POR + '|00060'].get(Date.parse('2026-11-13T17:55:00Z'));
    F.REV_LM = g.lm;
    return F;
}

// -------------------------------------------------------------- the job log
const num = s => (s === '' || s === undefined ? null : Number(s));
function loadRuns() {
    const rows = readObjects(path.join(TIDY, 'runs.csv'));
    return rows.map(r => ({
        row: r, seq: Number(r.seq), ver: r.ver, v: Number(r.v), src: r.src, out: r.out, used: r.used === '1',
        atIso: r.at, at: Date.parse(r.at), finalTs: r.final_ts ? Date.parse(r.final_ts) : null,
        T: {
            por_q: num(r.in_por_qT), por_h: num(r.in_por_hT), lf_q: num(r.in_lf_qT), lf_h: num(r.in_lf_hT),
            mono: num(r.in_mono_qT), goose: num(r.in_goose_qT), br: num(r.in_br_qT), sen: num(r.in_sen_qT),
            ef_h: num(r.in_ef_hT), temp: num(r.in_tT)
        }
    }));
}

// Index (in the predicted list) of the first run that fetched revised Point of Rocks values: the first run
// whose logged current flow equals the current record at its reading time, after the old prefix.
function findRevisionIndex(F, P) {
    const cur = F.cur[POR + '|00060'];
    for (let k = 0; k < P.length; k++) {
        const t = P[k].T.por_q, q = num(P[k].row.in_por_q);
        const g = cur.get(t);
        if (g && Number(g.v) === q) return k;
    }
    return -1;
}

// Revision boundary from the bulk-revision stamp (no logged value): the first run that started after the common
// last_modified stamp of the revision. Asserted equal to findRevisionIndex by the callers.
function findRevisionIndexByStamp(F, P) {
    for (let k = 0; k < P.length; k++) if (P[k].at >= F.REV_LM) return k;
    return -1;
}

// -------------------------------------------------------------- Point of Rocks flow value by scenario
// sc: 'S0' | 'S-old-A' | 'S-old-B' | 'S-old-C' | 'S-new'. k: index of the run that fetches (matters only for S0).
function porFlow(F, sc, t, k, revIdx) {
    const cur = F.cur[POR + '|00060'];
    const cget = () => { const g = cur.get(t); return g && g.v !== '' ? Number(g.v) : null; };
    if (sc === 'S-new') return { v: cget(), prov: 'current' };
    if (sc === 'S0' && k >= revIdx) return { v: cget(), prov: 'current' };
    // old world
    if (t <= ARCH_END) { const g = F.arch.get(t); return { v: g && g.v !== '' ? Number(g.v) : null, prov: 'archive' }; }
    const f = F.fold.get(t);
    if (!f) return { v: null, prov: 'f_old' };
    const rule = sc === 'S-old-B' ? 'B' : (sc === 'S-old-C' ? 'C' : 'A');
    return { v: f[rule], prov: 'f_old' };
}

// -------------------------------------------------------------- fake responses
const ISO = ms => new Date(ms).toISOString();
function apprWord(a) { return a === 'A' ? 'Approved' : 'Provisional'; }

// rows: [{t, v(string), a}] -> per (site,param) lists
function buildOld(seriesList) {
    return {
        value: {
            queryInfo: {},
            timeSeries: seriesList.map(s => ({
                sourceInfo: { siteCode: [{ value: s.site }] },
                variable: { variableCode: [{ value: s.param }] },
                values: [{ value: s.rows.map(r => ({ value: r.v, qualifiers: [r.a || 'P'], dateTime: ISO(r.t) })) }]
            }))
        }
    };
}
function buildNew(seriesList) {
    const features = [];
    for (const s of seriesList) {
        for (const r of s.rows) {
            features.push({
                type: 'Feature',
                properties: {
                    monitoring_location_id: 'USGS-' + s.site, parameter_code: s.param, statistic_id: '00011',
                    time: ISO(r.t).replace('.000Z', '+00:00'), value: r.v === '' ? null : r.v,
                    approval_status: apprWord(r.a), qualifier: null, last_modified: null, time_series_id: 'replay-' + s.site + '-' + s.param
                }
            });
        }
    }
    return { type: 'FeatureCollection', features, links: [] };
}

// Series the job's main request would return at run k (window (at-48h, T]); also temperature.
function seriesForRun(F, run, sc, k, revIdx, counters) {
    const lo = run.at - 48 * H;
    const out = [];
    const miss = (name) => { counters[name] = (counters[name] || 0) + 1; };
    const addCur = (site, param, T, name) => {
        if (T === null || T === undefined) { miss(name + '_noT'); return; }
        const s = F.cur[site + '|' + param];
        const g = s && s.get(T);
        if (!g) { miss(name + '_notInFrozen'); return; }
        const rows = [];
        for (const i of s.range(T - H, T)) rows.push({ t: s.t[i], v: s.v[i] === '' ? '-999999' : s.v[i], a: s.a[i] });
        out.push({ site, param, rows });
    };
    // Point of Rocks flow: window (at-48h, qT], values by scenario rule
    {
        const T = run.T.por_q;
        const s = F.cur[POR + '|00060'];
        if (T === null || !s.get(T)) miss('por_q_notInFrozen');
        else {
            const rows = [];
            for (const i of s.range(lo, T)) {
                const f = porFlow(F, sc, s.t[i], k, revIdx);
                if (f.v === null || !(f.v > 0)) continue;   // absent (or filtered by the job's cfs > 0 rule anyway)
                // availability (GATE_ITERATIONS attempt 2): a reading written after the run started was not in its fetch. Applied to every scenario
                // (publication timing is a property of USGS's service, not of the value rule), so availability is identical across scenarios.
                if (s.t[i] !== T && s.lm[i] !== null && s.lm[i] > F.REV_LM && s.lm[i] > run.at) { counters.late_stamps_excluded = (counters.late_stamps_excluded || 0) + 1; continue; }
                rows.push({ t: s.t[i], v: String(f.v), a: 'P' });
            }
            // old-world stamps missing from the current record (archive only) are added
            if (sc !== 'S-new' && !(sc === 'S0' && k >= revIdx)) {
                const have = new Set(rows.map(r => r.t));
                for (let j = 0; j < F.arch.t.length; j++) {
                    const t = F.arch.t[j];
                    if (t > lo && t <= T && t <= ARCH_END && !have.has(t) && F.arch.v[j] !== '') rows.push({ t, v: F.arch.v[j], a: 'P' });
                }
                rows.sort((a, b) => a.t - b.t);
            }
            out.push({ site: POR, param: '00060', rows });
        }
    }
    addCur(POR, '00065', run.T.por_h, 'por_h');
    addCur(LF, '00060', run.T.lf_q, 'lf_q');
    addCur(LF, '00065', run.T.lf_h, 'lf_h');
    addCur(MONO, '00060', run.T.mono, 'mono');
    addCur(GOOSE, '00060', run.T.goose, 'goose');
    addCur(BR, '00060', run.T.br, 'br');
    addCur(SEN, '00060', run.T.sen, 'sen');
    addCur(EF, '00065', run.T.ef_h, 'ef_h');
    return out;
}
function tempRows(F, run, counters) {
    const T = run.T.temp;
    if (T === null) return [];
    const s = F.cur[POR + '|00010'];
    if (!s || !s.get(T)) { counters.temp_notInFrozen = (counters.temp_notInFrozen || 0) + 1; return []; }
    const rows = [];
    for (const i of s.range(T - H, T)) rows.push({ t: s.t[i], v: s.v[i] === '' ? '-999999' : s.v[i], a: s.a[i] });
    return rows;
}

// -------------------------------------------------------------- in-memory store for the por_history row
function fakeClient(state) {
    return {
        from(table) {
            const q = { f: {} };
            const api = {
                select() { return api; },
                eq(c, v) { q.f[c] = v; return api; },
                single() {
                    if (q.f.observation_type === 'por_history' && q.f.gauge_id === 'system' && state.por_history) {
                        return Promise.resolve({ data: { data: state.por_history }, error: null });
                    }
                    return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
                },
                upsert(row) {
                    if (row.observation_type === 'por_history' && row.gauge_id === 'system') state.por_history = JSON.parse(JSON.stringify(row.data));
                    else throw new Error('replay: unexpected upsert ' + row.observation_type);
                    return Promise.resolve({ error: null });
                }
            };
            return api;
        }
    };
}

// -------------------------------------------------------------- bin timeline (FIDELITY_SPEC section 2)
function buildBinTimeline() {
    const checks = readObjects(path.join(TIDY, 'checks.csv'));
    const bins = readObjects(path.join(TIDY, 'bins.csv'));
    const snaps = new Map();   // iso time -> Map(key -> state)
    for (const b of bins) {
        if (b.source !== 'bin_snapshot') continue;
        if (b.bin_key.startsWith('stage_')) continue;
        // effective time of a snapshot = when the row was written (the end of the run that wrote it), not its 03:00 key:
        // after an error at 03:00 (17 Nov) the 04:00 run wrote the day's snapshot
        const t = Date.parse(b.row_created_utc);
        if (!snaps.has(t)) snaps.set(t, new Map());
        snaps.get(t).set(b.bin_key, { count: Number(b.n), emaMeanError: Number(b.ema), meanError: Number(b.mean), sumError: Number(b.sum), sumErrorSq: Number(b.sum_sq) });
    }
    const snapTimes = [...snaps.keys()].sort((a, b) => a - b);
    const updates = [];
    for (const c of checks) {
        if (c.learned !== '1') continue;
        updates.push({
            tickAt: Date.parse(c.tickAt_utc), key: c.bin + '_' + c.st,
            state: { count: Number(c.binAfter_count), emaMeanError: Number(c.binAfter_emaMeanError), meanError: Number(c.binAfter_meanError), sumError: Number(c.binAfter_sumError), sumErrorSq: Number(c.binAfter_sumErrorSq) }
        });
    }
    updates.sort((a, b) => a.tickAt - b.tickAt);
    function stateAt(runAt) {
        let S = snapTimes[0];
        for (const t of snapTimes) if (t <= runAt) S = t;
        const cur = new Map();
        for (const [k, v] of snaps.get(S)) cur.set(k, { ...v });
        for (const u of updates) if (u.tickAt <= runAt && (u.tickAt > S || runAt < snapTimes[0])) cur.set(u.key, { ...u.state });
        return cur;
    }
    return { stateAt, snapTimes, snaps, updates };
}
function rowsOf(stateMap) {
    return [...stateMap].map(([key, data]) => ({ gauge_id: key, data: { ...data } }));
}

// -------------------------------------------------------------- one run
async function replayRun(F, run, k, sc, revIdx, state, binsFor, counters, opts = {}) {
    const ctx = load(run.ver);
    const { T, shim, M, OBS } = ctx;
    const realNow = Date.now;
    const log = console.log, warn = console.warn, err = console.error;
    Date.now = () => run.finalTs;
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    const realFetch = global.fetch;
    try {
        const isNew = run.src === 'new';
        if (isNew) process.env.USGS_API_KEY = 'REPLAY-NOT-A-REAL-KEY'; else delete process.env.USGS_API_KEY;
        delete process.env.USGS_SOURCE;
        const main = seriesForRun(F, run, sc, k, revIdx, counters);
        const temp = tempRows(F, run, counters);
        global.fetch = async (url) => {
            url = String(url);
            let body;
            if (url.startsWith('https://waterservices.usgs.gov/')) {
                if (isNew) throw new Error('replay: old service called on a new-service run');
                body = url.includes('parameterCd=00010') ? buildOld([{ site: POR, param: '00010', rows: temp }]) : buildOld(main);
            } else if (url.startsWith('https://api.waterdata.usgs.gov/')) {
                if (!isNew) throw new Error('replay: new service called on an old-service run');
                body = url.includes('parameter_code=00010') ? buildNew([{ site: POR, param: '00010', rows: temp }]) : buildNew(main);
            } else throw new Error('replay: network blocked: ' + url);
            return { ok: true, status: 200, statusText: 'OK', json: async () => JSON.parse(JSON.stringify(body)) };
        };
        const tempOut = {};
        const meta = {};
        const [usgsData, waterTempC] = await Promise.all([T.fetchUSGSData(meta), T.fetchWaterTemp(tempOut)]);
        if (!usgsData) throw new Error('replay: fetchUSGSData returned null at seq ' + run.seq + ' ' + sc + ' counters ' + JSON.stringify(counters));
        // the job's own source selection must have taken the path the log says it took
        if (run.ver === 'v39.11' && meta.src !== run.src) throw new Error('replay: source path ' + meta.src + ' differs from logged src ' + run.src + ' at seq ' + run.seq);
        if (run.ver !== 'v39.11' && Object.keys(meta).length) throw new Error('replay: unexpected meta on pre-adapter version');
        const por = usgsData.data[usgsData.gauges.por] || {};
        const porHistory = por.history || [];
        const client = fakeClient(state);
        const before = new Set((state.por_history && state.por_history.readings || []).map(r => r.timestamp));
        await shim.storePoRHistory(client, porHistory);
        const stored = await OBS.getObs(client, 'por_history', 'system');
        const fullHistory = (stored && stored.readings) || porHistory;
        // provenance bookkeeping (first-seen), parallel to the real store
        for (const r of fullHistory) {
            if (!state.prov.has(r.timestamp)) {
                state.prov.set(r.timestamp, porFlow(F, sc, r.timestamp, k, revIdx).prov);
                state.firstAt.set(r.timestamp, run.at);
            }
        }
        const porIce = por.iceAffected, lfIce = usgsData.data[usgsData.gauges.lf]?.iceAffected;
        const criticalIce = porIce || lfIce;
        const rec = { ok: true, run, k, sc };
        rec.usgsData = usgsData; rec.waterTempC = waterTempC; rec.tempT = tempOut.t ?? null;
        rec.fullHistory = fullHistory;
        rec.curProv = porFlow(F, sc, run.T.por_q, k, revIdx).prov;
        rec.criticalIce = !!criticalIce;
        // 6-hour-back entry exactly as getPoRRiseRateFromHistory / getFlowState pick it
        {
            const sixAgo = run.finalTs - 6 * H;
            let past = null;
            for (const r of fullHistory) if (r.timestamp <= sixAgo) past = r;
            rec.back6 = past ? { ts: past.timestamp, cfs: past.cfs, prov: state.prov.get(past.timestamp), firstAt: state.firstAt.get(past.timestamp) } : null;
        }
        if (!criticalIce) {
            const bins = M.buildCorrectionBins(rowsOf(binsFor(k, run)));
            const trace = {};
            const pred = T.makeGFPrediction(usgsData, fullHistory, waterTempC, bins, trace);
            rec.trace = trace; rec.pred = pred;
            rec.bins = bins;
            rec.histProv = trace.histTs != null ? state.prov.get(trace.histTs) : null;
            rec.histFirstAt = trace.histTs != null ? state.firstAt.get(trace.histTs) : null;
        }
        return rec;
    } finally {
        global.fetch = realFetch;
        Date.now = realNow;
        console.log = log; console.warn = warn; console.error = err;
    }
}

// Warm start: the history the job already held before its first logged run.
function warmStart(F, P, sc, revIdx, state) {
    const run = P[0];
    const cur = F.cur[POR + '|00060'];
    const lo = run.finalTs - 72 * H;
    const readings = [];
    for (const i of cur.range(lo, run.T.por_q)) {
        const f = porFlow(F, sc, cur.t[i], 0, revIdx);
        if (f.v === null || !(f.v > 0)) continue;
        readings.push({ timestamp: cur.t[i], cfs: f.v });
    }
    if (sc !== 'S-new') {
        const have = new Set(readings.map(r => r.timestamp));
        for (let j = 0; j < F.arch.t.length; j++) {
            const t = F.arch.t[j];
            if (t > lo && t <= run.T.por_q && t <= ARCH_END && !have.has(t) && F.arch.v[j] !== '') readings.push({ timestamp: t, cfs: Number(F.arch.v[j]) });
        }
        readings.sort((a, b) => a.timestamp - b.timestamp);
    }
    state.por_history = { readings, lastUpdate: 'warm' };
    state.prov = new Map();
    state.firstAt = new Map();
    for (const r of readings) { state.prov.set(r.timestamp, porFlow(F, sc, r.timestamp, 0, revIdx).prov); state.firstAt.set(r.timestamp, -Infinity); }
}

async function runScenario(F, P, sc, revIdx, binsFor) {
    const state = { por_history: null, prov: new Map(), firstAt: new Map() };
    warmStart(F, P, sc, revIdx, state);
    const counters = {};
    const recs = [];
    for (let k = 0; k < P.length; k++) {
        const rec = await replayRun(F, P[k], k, sc, revIdx, state, binsFor, counters);
        recs.push(rec);
    }
    return { recs, counters };
}

module.exports = { loadFrozen, loadRuns, findRevisionIndex, findRevisionIndexByStamp, buildBinTimeline, runScenario, logNum, porFlow, POR, ARCH_END, OLD_END, H, GAUGES, num, rowsOf };

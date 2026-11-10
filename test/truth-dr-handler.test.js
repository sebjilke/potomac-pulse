// v39.6 (A5, A8): the whole handler against an in-memory database, with the Difficult Run request in
// every failure mode. The point: the feature is observation only. Every pre-existing stored value, the
// return value and the pings are identical across arms; the Difficult Run request goes out after the
// success ping and before the first log write; it can never fail a good tick.
// Plan: analysis/truth-and-confidence-logging-plan-2026-11-10.md section 5.

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
process.env.HEALTHCHECKS_PING_URL = 'https://hc-ping.test/abc-123';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

let CURRENT = null;
const model = require('../netlify/functions/shared/model');
model.getSupabase = () => CURRENT;
const { handler, _test } = require('../netlify/functions/scheduled-update');
const { createMemClient, LOG_TYPES } = require('./helpers/mem-supabase');
const { iso, usgsPayload, tempPayload, drPayload } = require('./helpers/usgs-mock');

const HOUR = 3600000;
const PING = process.env.HEALTHCHECKS_PING_URL;
const T0 = Date.UTC(2023, 10, 14, 16, 5, 0);
const MAIN_URL = 'https://waterservices.usgs.gov/nwis/iv/?sites=01638500,01646500,01643000,01644000,01644280,01645000,01644148&parameterCd=00060,00065&period=P2D&format=json';

const flush = () => new Promise(r => setImmediate(r));
async function drive(t, fn) {
    let done = false, result, error;
    const p = fn().then(v => { done = true; result = v; }, e => { done = true; error = e; });
    for (let i = 0; i < 80 && !done; i++) { for (let k = 0; k < 6; k++) await flush(); if (!done) t.mock.timers.tick(500); }
    if (!done) throw new Error('drive: the call did not finish within the virtual time budget (a missing time cap?)');
    await p;
    if (error) throw error;
    return result;
}

function pendingSeed(nowMs, dueOffsetMs) {
    return {
        observation_type: 'gf_prediction', gauge_id: 'pending', created_at: iso(nowMs - 6 * HOUR),
        data: {
            timestamp: iso(nowMs - 6 * HOUR), validationDue: iso(nowMs + dueOffsetMs),
            predictedCFS: 10500, rawFinalCFS: 10800, correctionApplied: 300, predictedStage: 4.0, rawFinalStage: 4.05,
            flowBin: '6000-12000', flowState: 'steady', lfCFS: 9900, ceilingApplied: false,
            shadowModels: { lfFeedback: 10100, onlineRegression: 10300, kalman: 10050 },
        },
    };
}
function seeds(nowMs) {
    const rows = [pendingSeed(nowMs, -10 * 60000)];   // due: one claimed validation per run
    for (const k of ['6000-12000_steady', '6000-12000_rising', '3000-6000_steady', 'stage_6000-12000_steady']) {
        rows.push({ observation_type: 'gf_correction_bin', gauge_id: k, data: { count: 12, sumError: 3000, sumErrorSq: 900000, meanError: 250, emaMeanError: 260 } });
    }
    rows.push({ observation_type: 'shadow_leaderboard', gauge_id: 'system', data: { totalRounds: 3 } });
    return rows;
}

const BEHAVIORS = {
    ok: (nowMs) => ({ ok: true, status: 200, json: async () => drPayload(nowMs, { vals: [12.7, 12.9, 13.1], ageMin: 73, quals: ['P'] }) }),
    huge: (nowMs) => ({ ok: true, status: 200, json: async () => drPayload(nowMs, { vals: [4900, 5000], ageMin: 20 }) }),
    http_error: () => ({ ok: false, status: 500, json: async () => { throw new Error('x'); } }),
    network: () => { throw new Error('ECONNRESET'); },
    hang_headers: () => new Promise(() => {}),
    hang_body: () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }),
    sentinel: (nowMs) => ({ ok: true, status: 200, json: async () => drPayload(nowMs, { vals: [12, 12.5, -999999] }) }),
    empty: () => ({ ok: true, status: 200, json: async () => ({ value: { timeSeries: [] } }) }),
    getters: () => ({ get ok() { throw new Error('boom'); }, get status() { throw new Error('boom'); }, json() { throw new Error('boom'); } }),
    html: () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }),
};

// One full run. `dr` names a behavior; `lateSkip` moves the clock 25 s after the ping (before the DR request);
// `dateThrowAfterPing` makes the first Date.now() after the ping throw (to reach the call site's own catch).
async function runArm(t, { dr = 'ok', lateSkip = false, dateThrowAfterPing = false, usgsFails = false, insertMode = {}, usgs = {}, rows = seeds(T0) } = {}) {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.timers.setTime(T0);
    for (const m of ['log', 'warn', 'error']) t.mock.method(console, m, () => {});
    const mem = createMemClient({ rows, insertMode });
    const events = [];
    const realFrom = mem.client.from;
    mem.client.from = (tbl) => {
        const b = realFrom(tbl);
        const ins = b.insert.bind(b);
        b.insert = (row) => { events.push(['insert', row.observation_type]); return ins(row); };
        const up = b.upsert.bind(b);
        b.upsert = (row, o) => { events.push(['upsert', row.observation_type]); return up(row, o); };
        return b;
    };
    CURRENT = mem.client;
    const urls = [];
    const realNow = Date.now;
    let throwNext = false;
    if (dateThrowAfterPing) {
        Date.now = () => { if (throwNext) { throwNext = false; throw new Error('Date.now exploded (test)'); } return realNow(); };
    }
    t.mock.method(global, 'fetch', async (url) => {
        const u = String(url);
        urls.push(u);
        if (u.startsWith(PING)) {
            events.push(['ping', u === PING ? 'ok' : 'fail']);
            if (u === PING && lateSkip) t.mock.timers.tick(25000);
            if (u === PING && dateThrowAfterPing) throwNext = true;
            return { ok: true };
        }
        if (u.includes('sites=01646000')) { events.push(['dr', u]); return BEHAVIORS[dr](T0); }
        if (u.includes('parameterCd=00010')) return { ok: true, json: async () => tempPayload(T0) };
        if (u.includes('parameterCd=00060,00065')) {
            events.push(['main', u]);
            if (usgsFails) throw new Error('usgs down (mock)');
            return { ok: true, status: 200, json: async () => usgsPayload(T0, usgs) };
        }
        throw new Error('unexpected fetch ' + u);
    });
    const started = Date.now();
    const res = await drive(t, () => handler({}, {}));
    const elapsed = Date.now() - started;
    const out = { mem, events, urls, res, elapsed };
    t.mock.restoreAll();
    Date.now = realNow;
    t.mock.timers.reset();
    return out;
}

const nonLog = (mem) => mem.rows.filter(r => !LOG_TYPES.includes(r.observation_type))
    .map(r => JSON.stringify([r.observation_type, r.gauge_id, r.data])).sort();
const nonLogWrites = (mem) => mem.ops.filter(o => !LOG_TYPES.includes(o.type) && o.op !== 'select')
    .map(o => JSON.stringify([o.op, o.type, o.filters, o.payload]));
// Log rows with every v39.6 field removed (and the wall-clock ms, which includes the DR wait).
function strippedLogs(mem) {
    return mem.rows.filter(r => LOG_TYPES.includes(r.observation_type)).map(r => {
        const d = JSON.parse(JSON.stringify(r.data));
        delete d.ms;
        if (r.observation_type === 'tick_log') {
            delete d.conf; delete d.ci;
            if (d.in) { delete d.in.dr; delete d.in.efx; }
        }
        if (r.observation_type === 'validation_log') { delete d.dr; delete d.tickAt; }
        return JSON.stringify([r.observation_type, r.gauge_id, d]);
    }).sort();
}
const pings = (events) => events.filter(e => e[0] === 'ping').map(e => e[1]);
const idx = (events, pred) => events.findIndex(pred);
const isLogWrite = (e) => (e[0] === 'insert' || e[0] === 'upsert') && LOG_TYPES.includes(e[1]);

describe('handler A/B: the Difficult Run request never changes anything that already existed', () => {
    const ARMS = [
        ['ok', { dr: 'ok' }],
        ['error status', { dr: 'http_error' }],
        ['network error', { dr: 'network' }],
        ['hang before headers', { dr: 'hang_headers' }],
        ['hang after headers', { dr: 'hang_body' }],
        ['sentinel value', { dr: 'sentinel' }],
        ['empty series', { dr: 'empty' }],
        ['throwing getters', { dr: 'getters' }],
        ['HTML body with 200', { dr: 'html' }],
        ['DR value 5000 cfs', { dr: 'huge' }],
        ['throw at the call site itself', { dr: 'ok', dateThrowAfterPing: true }],
    ];

    it('every arm equals the late-skip baseline (no request made): stored rows, writes, body, pings', async (t) => {
        const base = await runArm(t, { dr: 'ok', lateSkip: true });
        assert.equal(base.events.filter(e => e[0] === 'dr').length, 0, 'baseline made no Difficult Run request');
        assert.equal(base.res.statusCode, 200);
        const baseTick = base.mem.of('tick_log')[0].data;
        assert.equal(baseTick.in.dr.why, 'late_skip');
        for (const [name, opts] of ARMS) {
            const a = await runArm(t, opts);
            assert.equal(a.res.statusCode, 200, name);
            assert.equal(a.res.body, base.res.body, `${name}: 200 body`);
            assert.deepEqual(nonLog(a.mem), nonLog(base.mem), `${name}: final non-log rows`);
            assert.deepEqual(nonLogWrites(a.mem), nonLogWrites(base.mem), `${name}: non-log write sequence and payloads`);
            assert.deepEqual(strippedLogs(a.mem), strippedLogs(base.mem), `${name}: log rows minus the v39.6 fields`);
            assert.deepEqual(pings(a.events), ['ok'], `${name}: exactly one ok ping, no fail ping`);
            assert.equal(a.mem.of('tick_log').length, 1, `${name}: one tick row`);
            assert.equal(a.mem.of('tick_log')[0].data.out, 'predicted', name);
            assert.equal(a.mem.of('validation_log').length, 1, `${name}: one validation row`);
            // order: ping, then the DR request, then the first log write
            const iPing = idx(a.events, e => e[0] === 'ping');
            const iDr = idx(a.events, e => e[0] === 'dr');
            const iLog = idx(a.events, isLogWrite);
            if (!opts.dateThrowAfterPing) {
                assert.equal(a.events.filter(e => e[0] === 'dr').length, 1, `${name}: at most one DR request`);
                assert.ok(iPing >= 0 && iDr > iPing && iLog > iDr, `${name}: ping < DR GET < first log write (${JSON.stringify(a.events)})`);
            } else {
                assert.equal(iDr, -1, 'the request was never reached');
                assert.equal(a.mem.of('tick_log')[0].data.in.dr.why, 'internal_error');
                assert.ok(iLog > iPing);
            }
            // the main request is exactly the pre-change string
            assert.deepEqual(a.events.filter(e => e[0] === 'main').map(e => e[1]), [MAIN_URL], `${name}: main URL byte for byte`);
            assert.equal(a.urls.filter(u => u.includes('01646000') && !u.includes('sites=01646000&parameterCd=00060&period=PT6H')).length, 0);
            assert.ok(!MAIN_URL.includes('01646000'));
        }
    });

    it('what is logged in each arm', async (t) => {
        const want = { 'ok': null, 'error status': 'http_error', 'network error': 'fetch_error', 'hang before headers': 'timeout', 'hang after headers': 'timeout', 'sentinel value': 'sentinel', 'empty series': 'no_series', 'throwing getters': 'fetch_error', 'HTML body with 200': 'parse_error' };
        for (const [name, opts] of ARMS) {
            if (!(name in want)) continue;
            const a = await runArm(t, opts);
            const tick = a.mem.of('tick_log')[0].data;
            const val = a.mem.of('validation_log')[0].data;
            assert.equal(tick.in.dr.why, want[name], name);
            assert.equal(val.dr.why, want[name], name);
            assert.equal(val.tickAt, tick.at, 'join key');
            assert.ok(!('tail' in val.dr), 'the tail lives on the tick row only');
            assert.equal(tick.v, 2); assert.equal(val.v, 2);
            assert.equal(tick.ver, 'v39.6');
            if (name === 'ok') {
                assert.equal(tick.in.dr.q, 13.1);
                assert.equal(tick.in.dr.t, T0 - 73 * 60000);
                assert.equal(tick.in.dr.at, T0);
                assert.deepEqual(tick.in.dr.qual, ['P']);
                assert.equal(tick.in.dr.tail.v.length, 3);
                assert.equal(val.dr.q, 13.1);
                assert.notEqual(val.dr.t, val.actualT, 'DR time and LF time are distinct fields');
            }
            if (name.startsWith('hang')) assert.equal(tick.in.dr.ms, 2000);
        }
    });

    it('the learning truth stays Little Falls alone: a 5000 cfs Difficult Run changes nothing', async (t) => {
        const a = await runArm(t, { dr: 'huge' });
        const b = await runArm(t, { dr: 'ok', lateSkip: true });
        const va = a.mem.of('validation_log')[0].data, vb = b.mem.of('validation_log')[0].data;
        assert.equal(va.dr.q, 5000);
        assert.equal(va.actualCFS, 11000, 'actualCFS is lf.q');
        assert.equal(va.actualCFS, vb.actualCFS);
        assert.equal(va.errRawCFS, vb.errRawCFS);
        assert.deepEqual(a.mem.of('gf_correction_bin').map(r => r.data), b.mem.of('gf_correction_bin').map(r => r.data));
        assert.deepEqual(nonLog(a.mem), nonLog(b.mem));
    });

    it('no request on the catch path (USGS down): /fail ping, 500, no Difficult Run GET, error row has in.dr null', async (t) => {
        const a = await runArm(t, { dr: 'ok', usgsFails: true, rows: [] });
        assert.equal(a.res.statusCode, 500);
        assert.equal(a.events.filter(e => e[0] === 'dr').length, 0);
        assert.deepEqual(pings(a.events), ['fail']);
        const tick = a.mem.of('tick_log')[0].data;
        assert.equal(tick.out, 'error');
        assert.equal(tick.in.dr, null);
        assert.equal(tick.conf, null); assert.equal(tick.ci, null);
        assert.equal(tick.v, 2);
    });

    it('time: DR hangs AND every log write hangs: added time stays at or under 8.5 s', async (t) => {
        const hang = { tick_log: 'hang', validation_log: 'hang', bin_snapshot: 'hang', log_health: 'hang' };
        const a = await runArm(t, { dr: 'hang_headers', insertMode: hang });
        assert.equal(a.res.statusCode, 200);
        assert.deepEqual(pings(a.events), ['ok']);
        assert.ok(a.elapsed >= 2000, `the DR cap bit (elapsed ${a.elapsed})`);
        assert.ok(a.elapsed <= 8500, `elapsed ${a.elapsed} ms`);
        assert.ok(a.events.some(e => e[0] === 'insert' && e[1] === 'tick_log'), 'the tick row was still attempted');
        const base = await runArm(t, { dr: 'ok', lateSkip: true, insertMode: hang });
        assert.deepEqual(nonLog(a.mem), nonLog(base.mem));
    });

    it('late tick: no DR request, the tick row says late_skip', async (t) => {
        const a = await runArm(t, { dr: 'ok', lateSkip: true });
        assert.equal(a.events.filter(e => e[0] === 'dr').length, 0);
        assert.equal(a.mem.of('tick_log')[0].data.in.dr.why, 'late_skip');
        assert.equal(a.mem.of('validation_log')[0].data.dr.why, 'late_skip');
    });

    it('the existing "unexpected fetch throws" rule still holds: only the four known URLs are requested', async (t) => {
        const a = await runArm(t, { dr: 'ok' });
        const known = a.urls.filter(u => u.startsWith(PING) || u.includes('sites=01646000') || u.includes('parameterCd=00010') || u === MAIN_URL);
        assert.equal(known.length, a.urls.length);
    });
});

describe('tick row: conf and ci on a real run', () => {
    it('fresh-load label and band are present, named, and consistent with the row', async (t) => {
        const a = await runArm(t, { dr: 'ok' });
        const tick = a.mem.of('tick_log')[0].data;
        assert.ok(['high', 'medium', 'low'].includes(tick.conf.freshLoad));
        assert.equal(tick.conf.tribs, true);
        assert.equal(tick.conf.st, tick.corr.st);
        assert.equal(tick.conf.ef, tick.ef.used);
        assert.equal(tick.conf.freshLoadShown, tick.conf.freshLoad, 'no advisory active');
        assert.equal(tick.ci.bin, tick.corr.bin);
        assert.equal(tick.ci.st, tick.corr.st);
        const exp = _test.confidenceLabel({ hasTribs: true, shifted: tick.trv.nohist === false, efUsed: tick.ef.used, efTrend: null, flowState: tick.corr.st });
        assert.equal(tick.conf.freshLoad, exp);
        assert.ok(tick.ci.lo <= tick.final.cfs && tick.final.cfs <= tick.ci.hi);
        assert.deepEqual(Object.keys(tick.in.ef).sort(), ['h', 'hT'], 'the v39.2 shape of in.ef is unchanged');
    });
    it('Edwards Ferry tail and 1 h trend are logged from the 15-minute series', async (t) => {
        const efVals = [4.0, 4.0, 4.0, 4.0, 4.1, 4.2, 4.3, 4.4];
        const a = await runArm(t, { dr: 'ok', usgs: { efVals } });
        const tick = a.mem.of('tick_log')[0].data;
        assert.deepEqual(tick.in.efx.tail.v, efVals);
        assert.equal(tick.in.efx.tail.step, 15);
        assert.equal(tick.in.efx.tr1h, 'rising');
        assert.equal(tick.in.ef.h, 4.4);
    });
});

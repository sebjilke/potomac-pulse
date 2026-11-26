// v39.15: the whole handler against an in-memory database, with the Weather Service archive on, off,
// hanging and failing. The point: the archive is observation only. Every non-log write, every existing
// log row, the return value and the ping sequence are identical across arms; the request goes out after
// the success ping, the row is written after the tick row, and nothing new can reach the main catch.
// Plan: analysis/forecast-archive-plan-2026-11-24.md (version 2) sections 3 and 6 and its audit, ten points.

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
process.env.HEALTHCHECKS_PING_URL = 'https://hc-ping.test/abc-123';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let CURRENT = null;
const model = require('../netlify/functions/shared/model');
model.getSupabase = () => CURRENT;
const { handler, _test } = require('../netlify/functions/scheduled-update');
const { createMemClient, LOG_TYPES } = require('./helpers/mem-supabase');
const { iso, usgsPayload, tempPayload, drPayload } = require('./helpers/usgs-mock');

const HOUR = 3600000;
const PING = process.env.HEALTHCHECKS_PING_URL;
const T0 = Date.UTC(2023, 10, 14, 16, 5, 0);
const T_HOUR3 = Date.UTC(2023, 10, 14, 3, 5, 0);
const BRK = fs.readFileSync(path.join(__dirname, 'fixtures/nws-brkm2.json'), 'utf8');
const POR = fs.readFileSync(path.join(__dirname, 'fixtures/nws-porm2.json'), 'utf8');
const enc = new TextEncoder();

const flush = () => new Promise(r => setImmediate(r));
async function drive(t, fn) {
    let done = false, result, error;
    const p = fn().then(v => { done = true; result = v; }, e => { done = true; error = e; });
    for (let i = 0; i < 100 && !done; i++) { for (let k = 0; k < 6; k++) await flush(); if (!done) t.mock.timers.tick(500); }
    if (!done) throw new Error('drive: the call did not finish within the virtual time budget (a missing time cap?)');
    await p;
    if (error) throw error;
    return result;
}

function seeds(nowMs, extra = []) {
    const rows = [{
        observation_type: 'gf_prediction', gauge_id: 'pending', created_at: iso(nowMs - 6 * HOUR),
        data: {
            timestamp: iso(nowMs - 6 * HOUR), validationDue: iso(nowMs - 10 * 60000),
            predictedCFS: 10500, rawFinalCFS: 10800, correctionApplied: 300, predictedStage: 4.0, rawFinalStage: 4.05,
            flowBin: '6000-12000', flowState: 'steady', lfCFS: 9900, ceilingApplied: false,
            shadowModels: { lfFeedback: 10100, onlineRegression: 10300, kalman: 10050 },
        },
    }];
    for (const k of ['6000-12000_steady', '6000-12000_rising', '3000-6000_steady', 'stage_6000-12000_steady']) {
        rows.push({ observation_type: 'gf_correction_bin', gauge_id: k, data: { count: 12, sumError: 3000, sumErrorSq: 900000, meanError: 250, emaMeanError: 260 } });
    }
    rows.push({ observation_type: 'shadow_leaderboard', gauge_id: 'system', data: { totalRounds: 3 } });
    return rows.concat(extra);
}

const body = (text) => new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close(); } });
const okResp = (text) => ({ ok: true, status: 200, headers: { get: () => null }, body: body(text) });
const NWS = {
    ok: (lid) => okResp(lid === 'BRKM2' ? BRK : POR),
    hang: () => new Promise(() => {}),
    hangPor: (lid) => (lid === 'PORM2' ? new Promise(() => {}) : okResp(BRK)), // v39.16: one gauge answers, the other hangs
    http500: () => ({ ok: false, status: 500 }),
    http429: () => ({ ok: false, status: 429 }),
    shape: () => okResp('{"unexpected": true}'),
    html: () => okResp('<html>down</html>'),
    network: () => { throw new Error('ECONNRESET'); },
    // Streams that END WITH AN ERROR after a bounded number of reads, so a missing limit fails the test quickly instead of hanging it.
    endless: () => { let n = 0; return ({ ok: true, status: 200, headers: { get: () => null }, body: new ReadableStream({ pull(c) { if (++n > 20) { c.error(new Error('endless body was not cut off')); return; } if (n <= 5) c.enqueue(enc.encode(' ')); else return new Promise(() => {}); } }) }); },
    oversize: () => { let n = 0; return ({ ok: true, status: 200, headers: { get: () => null }, body: new ReadableStream({ pull(c) { if (++n > 10) { c.error(new Error('bound not enforced')); return; } c.enqueue(new Uint8Array(100000).fill(97)); } }) }); },
};

// One full run. nws: behaviour name. pingAt: ms the clock moves when the ping goes out. hooks: replaces the
// two test-seam functions for this run. dateThrow: 'nws' makes the first Date.now() after the ping throw.
async function runArm(t, { nws = 'ok', nwsEnv, pingAt = 0, hooks = null, dateThrow = false, insertMode = {}, rows = seeds(T0), start = T0, usgsFails = false, usgs = {}, faults = {} } = {}) {
    if (nwsEnv === undefined) delete process.env.NWS_ARCHIVE; else process.env.NWS_ARCHIVE = nwsEnv;
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.timers.setTime(start);
    for (const m of ['log', 'warn', 'error']) t.mock.method(console, m, () => {});
    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    const mem = createMemClient({ rows, insertMode, faults });
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
    const inits = [];
    const realNow = Date.now;
    let throwNext = false;
    if (dateThrow) Date.now = () => { if (throwNext) { throwNext = false; throw new Error('Date.now exploded (test)'); } return realNow(); };
    const saved = { ..._test.nwsHooks };
    if (hooks) Object.assign(_test.nwsHooks, hooks);
    t.mock.method(global, 'fetch', async (url, init) => {
        const u = String(url);
        urls.push(u);
        if (u.startsWith(PING)) {
            events.push(['ping', u === PING ? 'ok' : 'fail']);
            if (u === PING && pingAt) t.mock.timers.tick(pingAt);
            if (u === PING && dateThrow) throwNext = true;
            return { ok: true };
        }
        if (u.startsWith('https://api.water.noaa.gov/')) {
            events.push(['nws', u]);
            inits.push(init);
            return NWS[nws](u.includes('BRKM2') ? 'BRKM2' : 'PORM2');
        }
        if (u.includes('sites=01646000')) return { ok: true, status: 200, json: async () => drPayload(start, { vals: [12.7, 12.9, 13.1], ageMin: 73, quals: ['P'] }) };
        if (u.includes('parameterCd=00010')) return { ok: true, json: async () => tempPayload(start) };
        if (u.includes('parameterCd=00060,00065')) {
            if (usgsFails) throw new Error('usgs down (mock)');
            return { ok: true, status: 200, json: async () => usgsPayload(start, usgs) };
        }
        throw new Error('unexpected fetch ' + u);
    });
    const t0 = Date.now();
    let res;
    try {
        res = await drive(t, () => handler({}, {}));
    } finally {
        Object.assign(_test.nwsHooks, saved);
    }
    const elapsed = Date.now() - t0;
    for (let k = 0; k < 10; k++) await flush();
    process.off('unhandledRejection', onUnhandled);
    const out = { mem, events, urls, inits, res, elapsed, unhandled };
    t.mock.restoreAll();
    Date.now = realNow;
    t.mock.timers.reset();
    delete process.env.NWS_ARCHIVE;
    return out;
}

const nonLog = (mem) => mem.rows.filter(r => !LOG_TYPES.includes(r.observation_type))
    .map(r => JSON.stringify([r.observation_type, r.gauge_id, r.data])).sort();
const nonLogWrites = (mem) => mem.ops.filter(o => !LOG_TYPES.includes(o.type) && o.op !== 'select')
    .map(o => JSON.stringify([o.op, o.type, o.filters, o.payload]));
// Existing log types, with the wall-clock `ms` fields removed (CPU/virtual-time jitter only).
const stripMs = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'ms' ? undefined : v)));
const existingLogs = (mem) => mem.rows.filter(r => ['tick_log', 'validation_log', 'bin_snapshot'].includes(r.observation_type))
    .map(r => JSON.stringify([r.observation_type, r.gauge_id, stripMs(r.data)])).sort();
const pings = (events) => events.filter(e => e[0] === 'ping').map(e => e[1]);
const idx = (events, pred) => events.findIndex(pred);
const nwsRow = (a) => a.mem.of('nws_fc')[0] && a.mem.of('nws_fc')[0].data;

describe('N6: a normal tick', () => {
    it('one nws_fc row, keyed like the tick row, written after the ping and after the tick row; inputs equal the tick row', async (t) => {
        const a = await runArm(t);
        assert.equal(a.res.statusCode, 200);
        assert.equal(a.mem.of('nws_fc').length, 1);
        const tickRow = a.mem.of('tick_log')[0];
        assert.equal(a.mem.of('nws_fc')[0].gauge_id, tickRow.gauge_id);
        assert.equal(a.mem.of('nws_fc')[0].gauge_id, iso(T0));
        const iPing = idx(a.events, e => e[0] === 'ping');
        const iNws = idx(a.events, e => e[0] === 'nws');
        const iTick = idx(a.events, e => e[0] === 'insert' && e[1] === 'tick_log');
        const iFc = idx(a.events, e => e[0] === 'insert' && e[1] === 'nws_fc');
        assert.ok(iPing >= 0 && iNws > iPing, 'the first Weather Service request is after the ping');
        assert.ok(iFc > iTick && iTick > iPing, 'ping < tick row < nws_fc row');
        assert.ok(!a.events.slice(0, iPing + 1).some(e => e[1] === 'nws_fc' || e[0] === 'nws'));
        const urls = a.events.filter(e => e[0] === 'nws').map(e => e[1]).sort();
        assert.deepEqual(urls, ['https://api.water.noaa.gov/nwps/v1/gauges/BRKM2/stageflow/forecast', 'https://api.water.noaa.gov/nwps/v1/gauges/PORM2/stageflow/forecast']);
        for (const i of a.inits) assert.deepEqual(Object.keys(i), ['signal'], 'no header of ours');
        const tick = tickRow.data, fc = nwsRow(a);
        assert.equal(fc.ver, _test.SERVER_VERSION);
        assert.equal(fc.at, tick.at);
        assert.equal(fc.in.lfq, tick.in.lf.q); assert.equal(fc.in.lfT, tick.in.lf.qT);
        assert.equal(fc.in.porq, tick.in.por.q); assert.equal(fc.in.porT, tick.in.por.qT);
        assert.equal(fc.in.fin, tick.final.cfs);
        assert.equal(fc.in.out, 'predicted');
        for (const lid of ['BRKM2', 'PORM2']) {
            assert.equal(fc.g[lid].http, 200); assert.equal(fc.g[lid].why, null); assert.equal(fc.g[lid].n, 12);
        }
        assert.equal(a.mem.of('log_health').length, 0, 'a clean run writes no log_health');
        assert.deepEqual(a.unhandled, []);
    });
    for (const [name, nws, why] of [
        ['NWS hangs', 'hang', 'timeout'], ['NWS answers 500', 'http500', 'http_error'], ['NWS answers 429', 'http429', 'http_error'],
        ['NWS answers a changed shape', 'shape', 'shape'], ['NWS answers HTML', 'html', 'parse_error'], ['network error', 'network', 'fetch_error'],
        ['the body never ends', 'endless', 'timeout'], ['the body is over 256 KB', 'oversize', 'shape'],
    ]) {
        it(`${name}: the row exists with why ${why}, the job is unchanged`, async (t) => {
            const a = await runArm(t, { nws });
            assert.equal(a.res.statusCode, 200);
            assert.deepEqual(pings(a.events), ['ok']);
            assert.equal(a.mem.of('nws_fc').length, 1);
            assert.equal(nwsRow(a).g.BRKM2.why, why);
            assert.equal(nwsRow(a).g.PORM2.why, why);
            assert.equal(a.mem.of('tick_log').length, 1);
            assert.deepEqual(a.unhandled, []);
        });
    }
    it('a tick with no prediction (no Little Falls reading) still archives, with in.out no_prediction and null inputs', async (t) => {
        const a = await runArm(t, { usgs: { noLF: true } });
        assert.equal(a.res.statusCode, 200);
        assert.equal(a.mem.of('tick_log')[0].data.out, 'no_prediction');
        assert.equal(nwsRow(a).in.out, 'no_prediction');
        assert.equal(nwsRow(a).in.fin, null);
        assert.equal(nwsRow(a).in.lfq, null);
        assert.equal(nwsRow(a).in.porq, a.mem.of('tick_log')[0].data.in.por.q);
    });
});

const BASE_ARMS = [
    ['archive on', {}],
    ['NWS hangs', { nws: 'hang' }],
    ['NWS 500', { nws: 'http500' }],
    ['NWS changed shape', { nws: 'shape' }],
    ['NWS endless body', { nws: 'endless' }],
    ['NWS oversize body', { nws: 'oversize' }],
    ['NWS network error', { nws: 'network' }],
    ['nws_fc insert hangs', { insertMode: { nws_fc: 'hang' } }],
    ['nws_fc insert errors', { insertMode: { nws_fc: 'error' } }],
    ['nws_fc insert rejects', { insertMode: { nws_fc: 'reject' } }],
    ['fetch function throws synchronously', { hooks: { fetchNwsArchive: () => { throw new Error('sync boom'); } } }],
    ['fetch promise rejects', { hooks: { fetchNwsArchive: () => Promise.reject(new Error('rejected')) } }],
    ['fetch function returns junk', { hooks: { fetchNwsArchive: () => 12345 } }],
    ['row builder throws', { hooks: { buildNwsFcRecord: () => { throw new Error('builder boom'); } } }],
    ['Date.now throws at the call site', { dateThrow: 'nws' }],
];

describe('N5 and N7: the central test. Archive on, off, hanging and failing change nothing that existed', () => {
    for (const pingAt of [0, 24000, 26000]) {
        it(`ping ends at ${pingAt / 1000} s: every non-log write and existing log row identical to the off arm; same 200 body; ping sequence ['ok']`, async (t) => {
            const off = await runArm(t, { nwsEnv: 'off', pingAt });
            assert.equal(off.res.statusCode, 200);
            assert.deepEqual(pings(off.events), ['ok']);
            for (const [name, opts] of BASE_ARMS) {
                const a = await runArm(t, { ...opts, pingAt });
                assert.equal(a.res.statusCode, 200, name);
                assert.equal(a.res.body, off.res.body, `${name}: 200 body`);
                assert.deepEqual(pings(a.events), ['ok'], `${name}: ping sequence`);
                assert.deepEqual(nonLog(a.mem), nonLog(off.mem), `${name}: final non-log rows`);
                assert.deepEqual(nonLogWrites(a.mem), nonLogWrites(off.mem), `${name}: non-log write sequence and payloads`);
                assert.deepEqual(existingLogs(a.mem), existingLogs(off.mem), `${name}: tick_log, validation_log, bin_snapshot rows`);
                assert.equal(a.mem.of('tick_log').length, 1, `${name}: one tick row`);
                assert.deepEqual(a.unhandled, [], `${name}: no unhandled rejection`);
            }
        });
    }
    it('the same holds when the job throws (USGS down): /fail ping, 500, no archive request, no archive row', async (t) => {
        const off = await runArm(t, { nwsEnv: 'off', usgsFails: true, rows: [] });
        const on = await runArm(t, { usgsFails: true, rows: [] });
        assert.equal(on.res.statusCode, 500);
        assert.deepEqual(pings(on.events), ['fail']);
        assert.equal(on.events.filter(e => e[0] === 'nws').length, 0);
        assert.equal(on.mem.of('nws_fc').length, 0);
        assert.equal(on.res.body, off.res.body);
        assert.deepEqual(existingLogs(on.mem), existingLogs(off.mem));
    });
});

describe('N5: mutants that must not reach the main catch', () => {
    it('fetch function throws synchronously: both gauges internal_error, 200, one ok ping', async (t) => {
        const a = await runArm(t, { hooks: { fetchNwsArchive: () => { throw new Error('sync boom'); } } });
        assert.equal(a.res.statusCode, 200);
        assert.deepEqual(pings(a.events), ['ok']);
        assert.equal(nwsRow(a).g.BRKM2.why, 'internal_error'); assert.equal(nwsRow(a).g.PORM2.why, 'internal_error');
        assert.equal(nwsRow(a).ft, null);
        assert.deepEqual(a.unhandled, []);
    });
    it('fetch promise rejects: same, and no unhandledRejection', async (t) => {
        const a = await runArm(t, { hooks: { fetchNwsArchive: () => Promise.reject(new Error('rejected')) } });
        assert.equal(a.res.statusCode, 200);
        assert.equal(nwsRow(a).g.BRKM2.why, 'internal_error');
        assert.deepEqual(a.unhandled, []);
    });
    it('Date.now throws at the Weather Service call site: contained, internal_error, 200', async (t) => {
        const a = await runArm(t, { dateThrow: 'nws' });
        assert.equal(a.res.statusCode, 200);
        assert.deepEqual(pings(a.events), ['ok']);
        assert.equal(nwsRow(a).g.BRKM2.why, 'internal_error');
    });
    it('the row builder throws: no nws_fc row, 200, one ok ping, the failure is counted in log_health', async (t) => {
        const a = await runArm(t, { hooks: { buildNwsFcRecord: () => { throw new Error('builder boom'); } } });
        assert.equal(a.res.statusCode, 200);
        assert.deepEqual(pings(a.events), ['ok']);
        assert.equal(a.mem.of('nws_fc').length, 0);
        assert.equal(a.mem.of('tick_log').length, 1);
        assert.equal(a.mem.get('log_health', 'system').byType.nws_fc, 1);
    });
    it('the row builder throws on a no-fail path: no /fail ping and no second tick row', async (t) => {
        const a = await runArm(t, { hooks: { buildNwsFcRecord: () => { throw new Error('builder boom'); } } });
        assert.equal(a.events.filter(e => e[0] === 'ping' && e[1] === 'fail').length, 0);
        assert.equal(a.mem.of('tick_log').length, 1);
        assert.equal(a.mem.of('tick_log')[0].data.out, 'predicted');
    });
});

describe('kill switch', () => {
    it('NWS_ARCHIVE=off: no request, no nws_fc row or query of any kind, no extra health flush, no prune; result as v39.14 does', async (t) => {
        const old = { observation_type: 'nws_fc', gauge_id: '2020-01-01T00:00:00.000Z', data: { old: true } };
        const a = await runArm(t, { nwsEnv: 'off', rows: seeds(T_HOUR3, [old]), start: T_HOUR3, insertMode: { nws_fc: 'error' } });
        assert.equal(a.res.statusCode, 200);
        assert.equal(a.events.filter(e => e[0] === 'nws').length, 0);
        assert.equal(a.urls.filter(u => u.includes('noaa.gov')).length, 0);
        assert.equal(a.mem.ops.filter(o => o.type === 'nws_fc').length, 0, 'not one query on the new type');
        assert.equal(a.mem.of('nws_fc').length, 1, 'the old row was not pruned');
        assert.equal(a.mem.of('log_health').length, 0);
        assert.deepEqual(Object.keys(a.mem.of('tick_log')[0].data.aux.prune), ['tick_log', 'validation_log', 'bin_snapshot']);
    });
    it('any value other than the exact string off leaves the archive on', async (t) => {
        for (const v of ['OFF', 'false', '0', '', 'on']) {
            const a = await runArm(t, { nwsEnv: v });
            assert.equal(a.mem.of('nws_fc').length, 1, `value ${JSON.stringify(v)}`);
        }
    });
});

describe('N8: the deadline (tick start + 25 s)', () => {
    it('ping ends at 22 s, NWS and the insert both hang: the end is at 25 s, not later', async (t) => {
        const a = await runArm(t, { nws: 'hang', pingAt: 22000, insertMode: { nws_fc: 'hang' } });
        assert.equal(a.res.statusCode, 200);
        assert.ok(a.elapsed >= 24000, `elapsed ${a.elapsed}`);
        assert.ok(a.elapsed <= 25500, `elapsed ${a.elapsed}`);
        assert.equal(a.mem.of('nws_fc').length, 0);
    });
    it('the write cap is what is left: await returns at 23.5 s, so the insert gets 1500 ms at most', async (t) => {
        // ping at 23.5 s: fetch cap is 1500 ms; NWS hangs; await ends at 25 s; no time left to write
        const a = await runArm(t, { nws: 'hang', pingAt: 23500 });
        assert.equal(a.mem.of('nws_fc').length, 0, 'the deadline had passed');
        assert.ok(a.elapsed <= 25500, `elapsed ${a.elapsed}`);
    });
    it('ping ends at 25.1 s: no request, no write, no insert attempt, and the skip is NOT counted in log_health', async (t) => {
        const a = await runArm(t, { pingAt: 25100 });
        assert.equal(a.res.statusCode, 200);
        assert.equal(a.events.filter(e => e[0] === 'nws').length, 0, 'no Weather Service request');
        assert.equal(a.mem.of('nws_fc').length, 0);
        assert.ok(!a.events.some(e => e[1] === 'nws_fc'), 'no insert attempt');
        assert.equal(a.mem.of('log_health').length, 0, 'a skipped hour is visible only as a missing key');
    });
    it('everything hanging at ping times 3, 19.99, 21 and 24 s: the end is at most max(today, 25 s)', async (t) => {
        const hang = { tick_log: 'hang', validation_log: 'hang', bin_snapshot: 'hang', log_health: 'hang', nws_fc: 'hang' };
        for (const pingAt of [3000, 19990, 21000, 24000]) {
            const off = await runArm(t, { nwsEnv: 'off', pingAt, insertMode: hang, nws: 'hang' });
            const on = await runArm(t, { pingAt, insertMode: hang, nws: 'hang' });
            assert.equal(on.res.statusCode, 200, String(pingAt));
            assert.deepEqual(pings(on.events), ['ok']);
            assert.ok(on.elapsed <= Math.max(off.elapsed, 25000) + 500, `ping ${pingAt}: on ${on.elapsed} off ${off.elapsed}`);
        }
    });
    it('a hung NWS adds at most about 5 s to a normal tick', async (t) => {
        const off = await runArm(t, { nwsEnv: 'off' });
        const on = await runArm(t, { nws: 'hang' });
        assert.ok(on.elapsed - off.elapsed <= 5500, `added ${on.elapsed - off.elapsed}`);
    });
    // v39.16: the case the cap formula protects. Ping at 22 s leaves 3 s, so the timer is 2 s (not 3 s) and a full
    // write still fits. With the plain Math.min(NWS_CALL_CAP_MS, left) the wait would run to 25 s and no row would be written.
    it('late run: ping ends at 22 s and one gauge hangs: the nws_fc row IS written, with the forecast of the gauge that answered', async (t) => {
        const a = await runArm(t, { nws: 'hangPor', pingAt: 22000 });
        assert.equal(a.res.statusCode, 200);
        assert.deepEqual(pings(a.events), ['ok']);
        assert.equal(a.mem.of('nws_fc').length, 1, 'the row was written');
        const g = nwsRow(a).g;
        assert.equal(g.BRKM2.why, null);
        assert.ok(Array.isArray(g.BRKM2.pts) && g.BRKM2.pts.length > 0, 'the answering gauge keeps its points');
        assert.equal(g.PORM2.why, 'timeout');
        assert.ok(a.elapsed <= 25500, `elapsed ${a.elapsed}`);
    });
});

describe('N8b: the deadline holds for the prune too (hour 3)', () => {
    it('ping ends at 24 s, the nws_fc prune select hangs: the run ends by 25 s, not 26 s', async (t) => {
        const old = { observation_type: 'nws_fc', gauge_id: '2020-01-01T00:00:00.000Z', data: { old: true } };
        const a = await runArm(t, { pingAt: 24000, start: T_HOUR3, rows: seeds(T_HOUR3, [old]), faults: { selectHang: ['nws_fc'] } });
        assert.equal(a.res.statusCode, 200);
        assert.deepEqual(pings(a.events), ['ok']);
        assert.ok(a.mem.ops.some(o => o.op === 'select' && o.type === 'nws_fc'), 'the prune select was attempted');
        assert.equal(a.mem.of('nws_fc').filter(r => r.gauge_id === iso(T_HOUR3)).length, 1, 'this hour\'s row was written first');
        assert.ok(a.elapsed >= 24500, `elapsed ${a.elapsed}`);
        assert.ok(a.elapsed <= 25500, `elapsed ${a.elapsed}`);
    });
});

describe('N9: log_health counts a failed archive write', () => {
    for (const mode of ['error', 'reject', 'hang']) {
        it(`nws_fc insert ${mode}: counted under byType.nws_fc`, async (t) => {
            const a = await runArm(t, { insertMode: { nws_fc: mode } });
            assert.equal(a.mem.of('nws_fc').length, 0);
            const h = a.mem.get('log_health', 'system');
            assert.ok(h, 'a log_health row exists');
            assert.equal(h.byType.nws_fc, 1);
            assert.equal(a.res.statusCode, 200);
        });
    }
    it('a clean run writes no log_health', async (t) => {
        assert.equal((await runArm(t)).mem.of('log_health').length, 0);
    });
});

describe('N10: pool isolation', () => {
    it('hung nws_fc inserts do not stop validation_log, snapshot or tick writes', async (t) => {
        const a = await runArm(t, { insertMode: { nws_fc: 'hang' }, rows: seeds(T_HOUR3), start: T_HOUR3 });
        assert.equal(a.mem.of('tick_log').length, 1);
        assert.equal(a.mem.of('validation_log').length, 1);
        assert.equal(a.mem.of('bin_snapshot').length, 1);
    });
    it('the nws_fc write draws on the arch pool, not the general or tick pool', async (t) => {
        const { LogBudget, writeLogRow } = _test;
        const b = new LogBudget();
        const client = { from: () => ({ insert: () => Promise.resolve({ error: null }) }) };
        const before = { ...b.left };
        await writeLogRow(client, 'nws_fc', 'k', {}, b, 'arch', {}, Date.now() + 25000);
        assert.equal(b.left.general, before.general);
        assert.equal(b.left.tick, before.tick);
    });
});

describe('the archive and the hour-3 prune', () => {
    it('hour 3: old nws_fc rows go, young stay, other types untouched; the tick row aux.prune is as before', async (t) => {
        const oldKey = iso(T_HOUR3 - 731 * 24 * HOUR), youngKey = iso(T_HOUR3 - 100 * 24 * HOUR);
        const extra = [
            { observation_type: 'nws_fc', gauge_id: oldKey, data: { old: true } },
            { observation_type: 'nws_fc', gauge_id: youngKey, data: { young: true } },
            { observation_type: 'audit_log', gauge_id: oldKey, data: {} },
            { observation_type: 'tick_log', gauge_id: iso(T_HOUR3 - 700 * 24 * HOUR), data: { keepsOnlyIfTooYoung: false } },
        ];
        const on = await runArm(t, { rows: seeds(T_HOUR3, extra), start: T_HOUR3 });
        const off = await runArm(t, { nwsEnv: 'off', rows: seeds(T_HOUR3, extra), start: T_HOUR3 });
        const keys = on.mem.of('nws_fc').map(r => r.gauge_id);
        assert.ok(!keys.includes(oldKey), 'the old row is pruned');
        assert.ok(keys.includes(youngKey));
        assert.ok(keys.includes(iso(T_HOUR3)), 'this hour\'s row is there');
        assert.equal(on.mem.of('audit_log').length, 1, 'a similar non-log type is never pruned');
        const del = on.mem.ops.filter(o => o.op === 'delete' && o.type === 'nws_fc');
        assert.equal(del.length, 1);
        assert.deepEqual(on.mem.of('tick_log')[0].data.aux.prune, off.mem.of('tick_log')[0].data.aux.prune);
        assert.deepEqual(Object.keys(on.mem.of('tick_log')[0].data.aux.prune), ['tick_log', 'validation_log', 'bin_snapshot']);
        assert.deepEqual(existingLogs(on.mem), existingLogs(off.mem));
    });
    it('not at hour 3: no nws_fc delete or select-for-prune', async (t) => {
        const a = await runArm(t);
        assert.equal(a.mem.ops.filter(o => o.type === 'nws_fc' && o.op !== 'insert').length, 0);
    });
});

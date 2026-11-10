// A3 (v39.2) T5b and T6: the whole handler against an in-memory database.
// T5b: logging never changes what the run writes, returns, or when it pings.
// T6: one tick_log row per run with the right identity, slot, join keys and exit coverage.

// Env must be set BEFORE the module loads (shared/model.js captures it). The mock client replaces
// getSupabase before scheduled-update.js is required, so no real credential is ever read or used.
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
process.env.HEALTHCHECKS_PING_URL = 'https://hc-ping.test/abc-123';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

let CURRENT = null;                                    // the in-memory client the handler will get
const model = require('../netlify/functions/shared/model');
model.getSupabase = () => CURRENT;
const { handler, _test } = require('../netlify/functions/scheduled-update');
const { createMemClient, LOG_TYPES } = require('./helpers/mem-supabase');

const HOUR = 3600000;
const iso = (ms) => new Date(ms).toISOString();
const PING = process.env.HEALTHCHECKS_PING_URL;
// 16:05 UTC: not a snapshot hour. HOUR3 is a snapshot-and-prune hour.
const T_NORMAL = Date.UTC(2023, 10, 14, 16, 5, 0);
const T_HOUR3 = Date.UTC(2023, 10, 14, 3, 5, 0);

const flush = () => new Promise(r => setImmediate(r));
async function settle(n = 6) { for (let i = 0; i < n; i++) await flush(); }
async function drive(t, fn) {
    let done = false, result, error;
    const p = fn().then(v => { done = true; result = v; }, e => { done = true; error = e; });
    for (let i = 0; i < 80 && !done; i++) { await settle(); if (!done) t.mock.timers.tick(500); }
    await p;
    if (error) throw error;
    return result;
}

function usgsPayload(nowMs, { lfQ = 11000, lfIce = false, noLF = false, porQ = 10000 } = {}) {
    const ts = (site, param, vals) => ({
        sourceInfo: { siteCode: [{ value: site }] },
        variable: { variableCode: [{ value: param }] },
        values: [{ value: vals }],
    });
    const one = (v, ageMin = 10, quals = []) => [{ value: String(v), dateTime: iso(nowMs - ageMin * 60000), qualifiers: quals.map(q => ({ qualifierCode: q })) }];
    const porHist = [];
    for (let k = 48 * 4; k >= 0; k--) porHist.push({ value: String(porQ), dateTime: iso(nowMs - k * 15 * 60000), qualifiers: [] });
    const series = [
        ts('01638500', '00060', porHist),
        ts('01638500', '00065', one(5.1)),
        ts('01646500', '00065', one(3.85, 12)),
        ts('01643000', '00060', one(800)),
        ts('01644000', '00060', one(350)),
        ts('01645000', '00060', one(100)),
        ts('01644148', '00065', one(4.0, 20)),
    ];
    if (!noLF) series.push(ts('01646500', '00060', one(lfQ, 15, lfIce ? ['Ice'] : [])));
    return { value: { timeSeries: series } };
}
const tempPayload = (nowMs) => ({ value: { timeSeries: [{ values: [{ value: [{ value: '12.5', dateTime: iso(nowMs - 5 * 60000) }] }] }] } });

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
function binSeeds() {
    const rows = [];
    for (const k of ['6000-12000_steady', '6000-12000_rising', '3000-6000_steady', 'stage_6000-12000_steady']) {
        rows.push({ observation_type: 'gf_correction_bin', gauge_id: k, data: { count: 12, sumError: 3000, sumErrorSq: 900000, meanError: 250, emaMeanError: 260 } });
    }
    rows.push({ observation_type: 'shadow_leaderboard', gauge_id: 'system', data: { totalRounds: 3 } });
    return rows;
}

// Installs fake time + a fetch mock + a fresh in-memory database; records the cross-cutting event order.
function setup(t, nowMs, { rows = [], insertMode = {}, usgs = {}, usgsFails = false, advanceMs = 0 } = {}) {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.timers.setTime(nowMs);
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
    t.mock.method(global, 'fetch', async (url) => {
        const u = String(url);
        if (u.startsWith(PING)) { events.push(['ping', u === PING ? 'ok' : 'fail']); return { ok: true }; }
        if (u.includes('parameterCd=00010')) return { ok: true, json: async () => tempPayload(nowMs) };
        if (u.includes('parameterCd=00060,00065')) {
            if (usgsFails) throw new Error('usgs down (mock)');
            if (advanceMs) t.mock.timers.tick(advanceMs);   // the clock moves between tick start and the prediction
            return { ok: true, status: 200, json: async () => usgsPayload(nowMs, usgs) };
        }
        throw new Error('unexpected fetch ' + u);
    });
    return { mem, events };
}

const ticks = (mem) => mem.of('tick_log');
// The keys makeGFPrediction has always put on the stored pending row. A key added by the log path would fail this.
const PENDING_KEYS = ["ceilingApplied","correctionApplied","divergenceActive","efDivergence","efEstimateCFS","efModelType","efStage","efWeight","flowBin","flowState","gooseCFS","historicPorCFS","lfCFS","lfResidualActive","lfResidualLastErrPct","monocacyCFS","porCFS","porEstimateCFS","predictedCFS","predictedStage","rawFinalCFS","rawFinalStage","shadowModels","timestamp","travelTimeGFtoLF","useEfEnsemble","useTimeShifted","validationDue","waterTempC"];
const nonLogWrites = (mem) => mem.ops
    .filter(o => !LOG_TYPES.includes(o.type) && o.op !== 'select')
    .map(o => JSON.stringify([o.op, o.type, o.filters, o.payload]));

describe('T6: handler writes one tick_log row per run', () => {
    it('normal tick: one row, identity, slot, join keys, final equals what the app stored', async (t) => {
        const { mem, events } = setup(t, T_NORMAL, { rows: binSeeds() });
        const res = await handler({}, {});
        assert.equal(res.statusCode, 200);
        const rows = ticks(mem);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].gauge_id, iso(T_NORMAL), 'full-ms start ISO');
        const rec = rows[0].data;
        assert.equal(rec.at, iso(T_NORMAL));
        assert.equal(rec.out, 'predicted');
        assert.equal(rec.why, null);
        assert.equal(rec.ver, _test.SERVER_VERSION);
        assert.equal(rec.slot, 'stored');
        assert.equal(rec.in.lf.q, 11000);
        assert.equal(rec.in.lf.qT, T_NORMAL - 15 * 60000, 'discharge reading time captured');
        assert.equal(rec.in.tT, T_NORMAL - 5 * 60000, 'temperature reading time captured');
        assert.equal(rec.in.tC, 12.5);
        assert.equal(rec.in.ef.hT, T_NORMAL - 20 * 60000);
        assert.ok(rec.in.porHist.n > 100);
        const pending = mem.get('gf_prediction', 'pending');
        assert.equal(rec.final.ts, pending.timestamp, 'join key equals the stored pending timestamp');
        const hist = mem.get('gf_history', 'system');
        assert.equal(rec.final.cfs, hist.readings[hist.readings.length - 1].cfs, 'final.cfs equals the gf_history entry');
        assert.equal(rec.final.cfs, pending.predictedCFS);
        assert.equal(rec.trv.stop, 'converged');
        assert.deepEqual(rec.adv && Object.keys(rec.adv).sort(), ['dbar', 'ef', 'lfr', 'lfe'].sort());
        assert.equal(rec.aux.snapshot, 'not_due');
        assert.deepEqual(rec.aux.logFail, []);
        assert.ok(rec.ms >= 0);
        // TD-3: the stored pending row has exactly the pre-A3 key set: nothing from the log path leaked in
        assert.deepEqual(Object.keys(pending).sort(), PENDING_KEYS);
        // success ping went out before the tick insert
        const iPing = events.findIndex(e => e[0] === 'ping');
        const iTick = events.findIndex(e => e[0] === 'insert' && e[1] === 'tick_log');
        assert.ok(iPing >= 0 && iTick > iPing, 'ping before tick insert');
    });

    it('TD-2: final.ts is the prediction timestamp, not the tick start, when the clock has moved', async (t) => {
        const { mem } = setup(t, T_NORMAL, { rows: binSeeds(), advanceMs: 7 * 60000 });
        await handler({}, {});
        const rec = ticks(mem)[0].data;
        const pending = mem.get('gf_prediction', 'pending');
        assert.notEqual(pending.timestamp, iso(T_NORMAL), 'the prediction was stamped after the tick started');
        assert.equal(rec.at, iso(T_NORMAL));
        assert.equal(rec.final.ts, pending.timestamp);
        assert.notEqual(rec.final.ts, rec.at);
    });

    it('slot is skipped_in_window when a live pending row exists', async (t) => {
        const { mem } = setup(t, T_NORMAL, { rows: [...binSeeds(), pendingSeed(T_NORMAL, 4 * HOUR)] });
        const before = JSON.stringify(mem.get('gf_prediction', 'pending'));
        const res = await handler({}, {});
        assert.equal(res.statusCode, 200);
        assert.equal(ticks(mem)[0].data.slot, 'skipped_in_window');
        assert.equal(JSON.stringify(mem.get('gf_prediction', 'pending')), before, 'live pending row untouched');
        assert.equal(ticks(mem)[0].data.final.ts !== mem.get('gf_prediction', 'pending').timestamp, true, 'final.ts is the prediction that was NOT stored');
    });

    it('a missed-window pending row is replaced: slot replaced and one validation_log row', async (t) => {
        const { mem } = setup(t, T_NORMAL, { rows: [...binSeeds(), pendingSeed(T_NORMAL, -4 * HOUR)] });
        await handler({}, {});
        assert.equal(ticks(mem)[0].data.slot, 'replaced');
        const v = mem.of('validation_log');
        assert.equal(v.length, 1);
        assert.equal(v[0].data.outcome, 'replaced_missed_window');
    });

    it('join key: the next validation row predTs equals the earlier tick final.ts', async (t) => {
        const first = setup(t, T_NORMAL, { rows: binSeeds() });
        await handler({}, {});
        const tick1 = ticks(first.mem)[0].data;
        const due = Date.parse(tick1.due);
        // carry the database forward and run again when the prediction is due (fresh clock)
        const carried = first.mem.rows.map(r => ({ observation_type: r.observation_type, gauge_id: r.gauge_id, data: r.data, created_at: r.created_at }));
        t.mock.timers.reset();
        const second = setup(t, due + 10 * 60000, { rows: carried });
        const res = await handler({}, {});
        assert.equal(res.statusCode, 200);
        const v = second.mem.of('validation_log');
        assert.equal(v.length, 1);
        assert.equal(v[0].data.outcome, 'validated');
        assert.equal(v[0].data.predTs, tick1.final.ts, 'validation_log.predTs === tick_log.final.ts');
        const tick2 = second.mem.of('tick_log').find(r => r.data.at === iso(due + 10 * 60000)).data;
        assert.equal(tick2.val.n, 1);
    });

    it('ice tick records no_prediction / ice_skip', async (t) => {
        const { mem } = setup(t, T_NORMAL, { rows: binSeeds(), usgs: { lfIce: true } });
        const res = await handler({}, {});
        assert.equal(res.statusCode, 200);
        const rec = ticks(mem)[0].data;
        assert.equal(rec.out, 'no_prediction');
        assert.equal(rec.why, 'ice_skip');
        assert.equal(rec.in.ice.lf, true);
        assert.equal(rec.final, null);
        assert.equal(rec.slot, 'none');
        assert.ok(rec.adv, 'banner state is recorded on no-prediction ticks too');
    });

    it('missing LF discharge records no_prediction / null_lf_or_por', async (t) => {
        const { mem } = setup(t, T_NORMAL, { rows: binSeeds(), usgs: { noLF: true } });
        const res = await handler({}, {});
        assert.equal(res.statusCode, 200);
        const rec = ticks(mem)[0].data;
        assert.equal(rec.out, 'no_prediction');
        assert.equal(rec.why, 'null_lf_or_por');
        assert.equal(rec.in.lf.q, null);
    });

    it('USGS fetch failure: error row with the stage, /fail ping BEFORE the error row, same 500', async (t) => {
        const { mem, events } = setup(t, T_NORMAL, { usgsFails: true });
        const res = await handler({}, {});
        assert.equal(res.statusCode, 500);
        assert.deepEqual(JSON.parse(res.body), { error: 'Failed to fetch USGS data' });
        const rows = ticks(mem);
        assert.equal(rows.length, 1);
        const rec = rows[0].data;
        assert.equal(rec.out, 'error');
        assert.equal(rec.why, 'usgs_fetch_failed');
        assert.equal(rec.err, 'Failed to fetch USGS data');
        assert.equal(rec.in.lf.q, null);
        const iFail = events.findIndex(e => e[0] === 'ping' && e[1] === 'fail');
        const iTick = events.findIndex(e => e[0] === 'insert' && e[1] === 'tick_log');
        assert.ok(iFail >= 0 && iTick > iFail, '/fail ping before the error row');
        assert.ok(!events.some(e => e[0] === 'ping' && e[1] === 'ok'), 'no success ping');
    });

    it('a throw after the fetch records the stage it died in and keeps the inputs', async (t) => {
        const { mem } = setup(t, T_NORMAL, { rows: binSeeds() });
        // make the correction-bin load throw: that is the 'predict' stage
        const real = mem.client.from;
        mem.client.from = (tbl) => {
            const b = real(tbl);
            const origSel = b.select.bind(b);
            b.select = (c) => { b.__sel = true; return origSel(c); };
            const origEq = b.eq.bind(b);
            b.eq = (c, v) => { if (c === 'observation_type' && v === 'gf_correction_bin' && b.__sel) throw new Error('bin read exploded'); return origEq(c, v); };
            return b;
        };
        const res = await handler({}, {});
        assert.equal(res.statusCode, 500);
        const rec = ticks(mem)[0].data;
        assert.equal(rec.out, 'error');
        assert.equal(rec.why, 'predict');
        assert.equal(rec.err, 'bin read exploded');
        assert.equal(rec.in.lf.q, 11000, 'inputs recorded because the fetch completed');
    });
});

describe('T6b: error paths keep the queued fate rows (TD-4, TD-5, FM-1)', () => {
    const dueSeed = (nowMs) => [...binSeeds(), pendingSeed(nowMs, -10 * 60000)];
    const throwOn = (mem, type, op) => {
        const real = mem.client.from;
        mem.client.from = (tbl) => {
            const b = real(tbl);
            const orig = b[op].bind(b);
            b[op] = (row, o) => { if (row && row.observation_type === type) throw new Error('boom in ' + type); return orig(row, o); };
            return b;
        };
    };
    const insertOrder = (events) => events.filter(e => e[0] === 'ping' || e[0] === 'insert').map(e => e.join(':'));

    it('TD-4: a validated row queued before a later throw is flushed in the catch, before the error tick row', async (t) => {
        const { mem, events } = setup(t, T_NORMAL, { rows: dueSeed(T_NORMAL) });
        throwOn(mem, 'gf_prediction', 'insert');   // the store stage, after validation
        const res = await handler({}, {});
        assert.equal(res.statusCode, 500);
        const v = mem.of('validation_log');
        assert.equal(v.length, 1);
        assert.equal(v[0].data.outcome, 'validated');
        const tick = ticks(mem)[0].data;
        assert.equal(tick.out, 'error');
        const order = insertOrder(events);
        const iFail = order.indexOf('ping:fail'), iVal = order.indexOf('insert:validation_log'), iTick = order.indexOf('insert:tick_log');
        assert.ok(iFail >= 0 && iVal > iFail && iTick > iVal, `order was ${order.join(' ')}`);
    });

    it('FM-1: a row claimed and then lost to a throw in the learning block gets a claimed_then_threw fate row', async (t) => {
        const { mem, events } = setup(t, T_NORMAL, { rows: dueSeed(T_NORMAL) });
        const predTs = mem.get('gf_prediction', 'pending').timestamp;
        throwOn(mem, 'gf_correction_bin', 'upsert');
        const res = await handler({}, {});
        assert.equal(res.statusCode, 500);
        assert.equal(mem.of('gf_prediction').filter(r => r.gauge_id === 'pending').length, 0, 'the row was claimed (deleted)');
        const v = mem.of('validation_log');
        assert.equal(v.length, 1);
        assert.equal(v[0].data.outcome, 'claimed_then_threw');
        assert.equal(v[0].data.predTs, predTs);
        assert.match(v[0].data.claimErr, /boom in gf_correction_bin/);
        const tick = ticks(mem)[0].data;
        assert.equal(tick.out, 'error');
        assert.equal(tick.why, 'validate');
        const order = insertOrder(events);
        assert.ok(order.indexOf('insert:validation_log') > order.indexOf('ping:fail') && order.indexOf('insert:tick_log') > order.indexOf('insert:validation_log'));
    });

    it('FM-1: a normal validation leaves no inflight marker and no extra fate row', async (t) => {
        const { mem } = setup(t, T_NORMAL, { rows: dueSeed(T_NORMAL) });
        await handler({}, {});
        assert.deepEqual(mem.of('validation_log').map(r => r.data.outcome), ['validated']);
    });

    it('TD-5: a failed validation_log write is counted in log_health when the tick write succeeds', async (t) => {
        const { mem } = setup(t, T_NORMAL, { rows: dueSeed(T_NORMAL), insertMode: { validation_log: 'error' } });
        const res = await handler({}, {});
        assert.equal(res.statusCode, 200);
        assert.equal(ticks(mem).length, 1, 'the tick row landed');
        const lh = mem.get('log_health', 'system');
        assert.ok(lh, 'log_health row written');
        assert.ok(lh.errors >= 1);
        assert.ok(lh.byType.validation_log >= 1);
        const t0 = ticks(mem)[0].data;
        assert.equal(t0.aux.logFail.length, 1);
        assert.equal(t0.aux.logFailTotal, 1);
    });
});

describe('T5b: logging cannot change the run', () => {
    // Pending row due and in window, so the run validates, learns, replaces and stores. Hour 3, so
    // the snapshot and the prune also run.
    const seed = (nowMs) => [...binSeeds(), pendingSeed(nowMs, -10 * 60000),
        { observation_type: 'tick_log', gauge_id: '2020-01-01T00:00:00.000Z', data: { old: true } }];

    async function runMode(t, mode) {
        t.mock.timers.reset();
        const insertMode = mode === 'ok' ? {} : { tick_log: mode, validation_log: mode, bin_snapshot: mode, log_health: mode };
        const ctx = setup(t, T_HOUR3, { rows: seed(T_HOUR3), insertMode });
        const res = await drive(t, () => handler({}, {}));
        return { ...ctx, res };
    }

    it('non-log writes, payloads, return value and ping order are identical whether log writes succeed, error, reject or hang', { timeout: 5000 }, async (t) => {
        const base = await runMode(t, 'ok');
        assert.equal(base.res.statusCode, 200);
        assert.equal(ticks(base.mem).filter(r => r.gauge_id !== '2020-01-01T00:00:00.000Z').length, 1);
        assert.equal(base.mem.of('validation_log').length, 1);
        assert.equal(base.mem.of('bin_snapshot').length, 1);
        assert.equal(ticks(base.mem)[0].data.aux.snapshot, 'written');
        assert.equal(ticks(base.mem)[0].data.aux.prune.tick_log.deleted, 1);
        const wantWrites = nonLogWrites(base.mem);
        assert.ok(wantWrites.length > 10, 'the run did real work');
        const nonLogRows = (mem) => mem.rows.filter(r => !LOG_TYPES.includes(r.observation_type)).map(r => JSON.stringify([r.observation_type, r.gauge_id, r.data])).sort();
        const wantRows = nonLogRows(base.mem);

        for (const mode of ['error', 'reject', 'hang']) {
            const m = await runMode(t, mode);
            assert.equal(m.res.statusCode, base.res.statusCode, mode);
            assert.equal(m.res.body, base.res.body, `${mode}: identical return body`);
            assert.deepEqual(nonLogWrites(m.mem), wantWrites, `${mode}: identical non-log write sequence and payloads`);
            assert.deepEqual(nonLogRows(m.mem), wantRows, `${mode}: identical final non-log state`);
            // the success ping went out in every mode, and before the tick insert attempt
            const iPing = m.events.findIndex(e => e[0] === 'ping' && e[1] === 'ok');
            const iTick = m.events.findIndex(e => e[0] === 'insert' && e[1] === 'tick_log');
            assert.ok(iPing >= 0, `${mode}: ping sent`);
            if (iTick >= 0) assert.ok(iTick > iPing, `${mode}: ping before the tick insert`);
            assert.ok(!m.events.some(e => e[0] === 'ping' && e[1] === 'fail'), `${mode}: no fail ping`);
            // and no log row slipped through
            assert.equal(ticks(m.mem).filter(r => r.gauge_id !== '2020-01-01T00:00:00.000Z').length, 0, mode);
            // the old tick_log row is still there only if pruning could not run (hang eats the pool); never deleted wrongly
            assert.ok(m.mem.of('tick_log').length <= 1);
        }
    });

    it('the ping precedes every housekeeping and tick write (event order)', async (t) => {
        const { events } = await runMode(t, 'ok');
        const iPing = events.findIndex(e => e[0] === 'ping' && e[1] === 'ok');
        const logAfter = events.slice(iPing + 1).filter(e => ['bin_snapshot', 'tick_log'].includes(e[1]));
        assert.ok(logAfter.length >= 2);
        assert.ok(!events.slice(0, iPing).some(e => ['bin_snapshot', 'tick_log'].includes(e[1])), 'no snapshot/tick write before the ping');
    });

    it('a hung log write cannot hold the run past its budgets', { timeout: 3000 }, async (t) => {
        t.mock.timers.reset();
        const ctx = setup(t, T_HOUR3, { rows: seed(T_HOUR3), insertMode: { tick_log: 'hang', validation_log: 'hang', bin_snapshot: 'hang', log_health: 'hang' } });
        let virtual = 0;
        let done = false;
        const p = handler({}, {}).then(r => { done = true; return r; });
        while (!done && virtual < 30000) { await settle(); if (!done) { t.mock.timers.tick(500); virtual += 500; } }
        await p;
        assert.ok(virtual <= 6500, `added time was ${virtual} ms virtual; the plan caps it near 6 s`);
        assert.equal(ctx.mem.of('tick_log').length <= 1, true);
    });
});

describe('Final re-audit residue: ordering, stored values, scrub', () => {
    const dueSeed = (nowMs) => [...binSeeds(), pendingSeed(nowMs, -10 * 60000)];

    it('M3: every log write, validation_log included, comes after the success ping on a validating tick', async (t) => {
        const { events, mem } = setup(t, T_HOUR3, { rows: dueSeed(T_HOUR3) });
        const res = await handler({}, {});
        assert.equal(res.statusCode, 200);
        assert.equal(mem.of('validation_log').length, 1, 'the tick validated a prediction');
        const iPing = events.findIndex(e => e[0] === 'ping' && e[1] === 'ok');
        assert.ok(iPing >= 0);
        const logEvents = events.map((e, i) => [e, i]).filter(([e]) => LOG_TYPES.includes(e[1]));
        const kinds = new Set(logEvents.map(([e]) => e[1]));
        for (const k of ['validation_log', 'tick_log', 'bin_snapshot']) assert.ok(kinds.has(k), `${k} was written`);
        for (const [e, i] of logEvents) assert.ok(i > iPing, `${e.join(':')} came before the success ping`);
    });

    it('M8: the stored pending row equals makeGFPrediction on the same inputs, plus only the handler stamps', async (t) => {
        const { mem } = setup(t, T_NORMAL, { rows: binSeeds() });
        const res = await handler({}, {});
        assert.equal(res.statusCode, 200);
        const stored = mem.get('gf_prediction', 'pending');
        const usgsData = await _test.fetchUSGSData();
        const temp = await _test.fetchWaterTemp({});
        const history = mem.get('por_history', 'system').readings;
        const binRows = mem.of('gf_correction_bin').map(r => ({ gauge_id: r.gauge_id, data: r.data }));
        const bins = model.buildCorrectionBins(binRows);
        const expected = _test.makeGFPrediction(usgsData, history, temp, bins);
        assert.ok(expected && expected.predictedCFS > 0);
        const STAMPS = ['efDivergence', 'divergenceActive', 'lfResidualActive', 'lfResidualLastErrPct', 'shadowModels'];
        const strip = (o) => { const c = { ...o }; for (const k of STAMPS) delete c[k]; return c; };
        assert.deepEqual(strip(stored), strip(expected), 'every value the model made is stored unchanged');
        // the stamps are the only things the handler adds; each one has to be present
        for (const k of STAMPS) assert.ok(Object.hasOwn(stored, k), `${k} stamped`);
        const div = mem.get('ef_divergence', 'state');
        assert.equal(stored.efDivergence, div ? div.dbar : stored.efDivergence);
    });

    it('FM-6: a URL in the error that ends a claimed row is not stored in validation_log.claimErr', async (t) => {
        const { mem } = setup(t, T_NORMAL, { rows: dueSeed(T_NORMAL) });
        const real = mem.client.from;
        mem.client.from = (tbl) => {
            const b = real(tbl);
            const orig = b.upsert.bind(b);
            b.upsert = (row, o) => { if (row && row.observation_type === 'gf_correction_bin') throw new Error('boom https://test.supabase.co/rest/v1?apikey=SECRET&x=1 end'); return orig(row, o); };
            return b;
        };
        const res = await handler({}, {});
        assert.equal(res.statusCode, 500);
        const v = mem.of('validation_log');
        assert.equal(v[0].data.outcome, 'claimed_then_threw');
        assert.ok(!JSON.stringify(v).includes('SECRET'));
        assert.match(v[0].data.claimErr, /<url>/);
    });
});

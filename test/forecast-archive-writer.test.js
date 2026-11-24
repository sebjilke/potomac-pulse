// v39.15: the shared log helpers keep their old behaviour when called the old way (audit point 3, N-6);
// the new pool and deadline work; the nws_fc prune (P1); and source scans (S1).
// Plan: analysis/forecast-archive-plan-2026-11-24.md (version 2) section 6 and its audit.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { _test } = require('../netlify/functions/scheduled-update');
const { LogBudget, timedLogCall, writeLogRow, flushLogHealth, pruneLogType, LOG_RETENTION_DAYS } = _test;
const { createMemClient } = require('./helpers/mem-supabase');

const SRC = fs.readFileSync(path.join(__dirname, '../netlify/functions/scheduled-update.js'), 'utf8');
const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 24, 3, 5, 0);
const iso = (ms) => new Date(ms).toISOString();

const flush = () => new Promise(r => setImmediate(r));
async function drive(t, fn) {
    let done = false, result;
    const p = fn().then(v => { done = true; result = v; });
    for (let i = 0; i < 60 && !done; i++) { for (let k = 0; k < 6; k++) await flush(); if (!done) t.mock.timers.tick(100); }
    if (!done) throw new Error('did not finish');
    await p;
    return result;
}
const quiet = (t) => { for (const m of ['log', 'warn', 'error']) t.mock.method(console, m, () => {}); };

describe('timedLogCall: the default path is unchanged, the optional deadline works', () => {
    it('default: a hung call is abandoned after min(2000, pool left) and charged to the pool', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); t.mock.timers.setTime(NOW);
        const b = new LogBudget();
        const r = await drive(t, () => timedLogCall(b, 'general', () => new Promise(() => {})));
        assert.deepEqual(r, { ok: false, reason: 'timeout' });
        assert.equal(b.remaining('general'), 1000);
        const r2 = await drive(t, () => timedLogCall(b, 'general', () => new Promise(() => {})));
        assert.equal(r2.reason, 'timeout');
        assert.equal(b.remaining('general'), 0);
        assert.deepEqual(await timedLogCall(b, 'general', () => 1), { ok: false, reason: 'budget' });
        const small = new LogBudget(500, 3000);
        const start = Date.now();
        await drive(t, () => timedLogCall(small, 'general', () => new Promise(() => {})));
        assert.equal(Date.now() - start, 500, 'cap is the pool left when that is smaller');
    });
    it('default: ok, error and thrown results as before', async () => {
        const b = new LogBudget();
        assert.deepEqual(await timedLogCall(b, 'tick', () => 5), { ok: true, value: 5 });
        const e = new Error('x');
        const r = await timedLogCall(b, 'tick', () => { throw e; });
        assert.equal(r.reason, 'error'); assert.equal(r.error, e);
        assert.equal(await timedLogCall(b, 'nope', () => 1).then(x => x.reason), 'budget', 'unknown pool is refused');
    });
    it('a deadline in the past refuses the call (budget) without running it and without charging the pool', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); t.mock.timers.setTime(NOW);
        const b = new LogBudget();
        let ran = false;
        const r = await timedLogCall(b, 'arch', () => { ran = true; }, NOW - 1);
        assert.deepEqual(r, { ok: false, reason: 'budget' });
        assert.equal(ran, false);
        assert.equal(b.remaining('arch'), _test.NWS_ARCH_POOL_MS);
    });
    it('a deadline limits the cap to the time left', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); t.mock.timers.setTime(NOW);
        const b = new LogBudget();
        const start = Date.now();
        const r = await drive(t, () => timedLogCall(b, 'arch', () => new Promise(() => {}), NOW + 800));
        assert.equal(r.reason, 'timeout');
        assert.equal(Date.now() - start, 800);
        const s2 = Date.now();
        await drive(t, () => timedLogCall(b, 'arch', () => new Promise(() => {}), NOW + 99999));
        assert.equal(Date.now() - s2, 2000, 'a far deadline does not lengthen the usual 2000 ms cap');
    });
    it('the constructor keeps its two-argument form and gains the arch pool', () => {
        const b = new LogBudget(111, 222);
        assert.deepEqual(b.left, { general: 111, tick: 222, arch: 4000 });
        assert.deepEqual(new LogBudget().left, { general: 3000, tick: 3000, arch: 4000 });
    });
});

describe('writeLogRow and flushLogHealth keep their default behaviour', () => {
    it('writeLogRow without a deadline is unchanged; a passed deadline records a budget failure that is not a warning', async (t) => {
        quiet(t);
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); t.mock.timers.setTime(NOW);
        const mem = createMemClient();
        const b = new LogBudget();
        assert.equal((await writeLogRow(mem.client, 'tick_log', 'k1', { a: 1 }, b, 'tick')).reason, 'ok');
        assert.equal((await writeLogRow(mem.client, 'nws_fc', 'k2', { a: 1 }, b, 'arch', {}, NOW + 25000)).reason, 'ok');
        const r = await writeLogRow(mem.client, 'nws_fc', 'k3', { a: 1 }, b, 'arch', {}, NOW - 5);
        assert.equal(r.reason, 'budget');
        assert.equal(b.pending.skipped, 1);
        assert.equal(mem.of('nws_fc').length, 1);
    });
    it('flushLogHealth: no third argument draws on the general pool; {pool, deadline} on the named pool', async (t) => {
        quiet(t);
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); t.mock.timers.setTime(NOW);
        const mem = createMemClient();
        const b = new LogBudget();
        b.noteFailure('tick_log', 'error', { msg: 'x' });
        const g0 = b.left.general, a0 = b.left.arch;
        assert.equal((await flushLogHealth(mem.client, b)).status, 'written');
        assert.equal(b.left.arch, a0);
        assert.ok(b.left.general <= g0);
        b.noteFailure('nws_fc', 'error', { msg: 'y' });
        assert.equal((await flushLogHealth(mem.client, b, { pool: 'arch', deadline: NOW + 5000 })).status, 'written');
        assert.equal(mem.get('log_health', 'system').byType.nws_fc, 1);
        assert.equal(mem.get('log_health', 'system').errors, 2);
        b.noteFailure('nws_fc', 'error', { msg: 'z' });
        assert.deepEqual(await flushLogHealth(mem.client, b, { pool: 'arch', deadline: NOW - 1 }), { status: 'skipped', reason: 'budget' });
        assert.equal(await flushLogHealth(mem.client, new LogBudget()).then(x => x.status), 'none');
    });
});

describe('P1: pruning nws_fc', () => {
    function seeded() {
        return createMemClient({ rows: [
            { observation_type: 'nws_fc', gauge_id: iso(NOW - 731 * DAY), data: { old: 1 } },
            { observation_type: 'nws_fc', gauge_id: iso(NOW - 729 * DAY), data: { young: 1 } },
            { observation_type: 'nws_fc', gauge_id: iso(NOW - 1 * DAY), data: { new: 1 } },
            { observation_type: 'tick_log', gauge_id: iso(NOW - 731 * DAY), data: { other: 1 } },
            { observation_type: 'gf_forecast_pending', gauge_id: iso(NOW - 900 * DAY) + '_x', data: { other: 1 } },
            { observation_type: 'log_health', gauge_id: 'system', data: {} },
        ] });
    }
    it('retention is 730 days; older rows go, younger stay, other types are untouched', async (t) => {
        quiet(t);
        assert.equal(LOG_RETENTION_DAYS.nws_fc, 730);
        const mem = seeded();
        const r = await pruneLogType(mem.client, 'nws_fc', { nowMs: NOW });
        assert.deepEqual(r, { cand: 1, deleted: 1 });
        assert.deepEqual(mem.of('nws_fc').map(x => x.data), [{ young: 1 }, { new: 1 }]);
        assert.equal(mem.of('tick_log').length, 1);
        assert.equal(mem.of('gf_forecast_pending').length, 1);
        assert.equal(mem.of('log_health').length, 1);
        for (const o of mem.ops) assert.ok(o.filters.some(f => f.c === 'observation_type' && f.v === 'nws_fc'), 'every query carries the type predicate');
    });
    it('the allow-list refuses a similar non-log type and unknown types with zero queries', async (t) => {
        quiet(t);
        const mem = seeded();
        const before = mem.ops.length;
        for (const bad of ['gf_forecast_pending', 'nws_fc_x', 'NWS_FC', 'nws', '']) {
            assert.equal((await pruneLogType(mem.client, bad, { nowMs: NOW })).error, 'type_not_allowed', bad);
        }
        assert.equal(mem.ops.length, before);
    });
    it('the 30-day floor, the 100-id batch and the URL size hold for the new type', async (t) => {
        quiet(t);
        const mem = seeded();
        assert.equal((await pruneLogType(mem.client, 'nws_fc', { nowMs: NOW, days: 29 })).error, 'cutoff_refused');
        const rows = [];
        for (let i = 0; i < 250; i++) rows.push({ observation_type: 'nws_fc', gauge_id: iso(NOW - (800 + i) * DAY), data: {} });
        const big = createMemClient({ rows });
        const r = await pruneLogType(big.client, 'nws_fc', { nowMs: NOW });
        assert.equal(r.cand, 100); assert.equal(r.deleted, 100);
        const del = big.ops.find(o => o.op === 'delete');
        assert.ok(del.urlLen < 8000, `url ${del.urlLen}`);
        assert.equal(big.of('nws_fc').length, 150);
    });
    it('a pool and a deadline can be passed; a passed deadline skips the prune as a budget error', async (t) => {
        quiet(t);
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); t.mock.timers.setTime(NOW);
        const mem = seeded();
        const r = await pruneLogType(mem.client, 'nws_fc', { nowMs: NOW, deadline: NOW - 1 });
        assert.equal(r.error, 'select_budget');
        assert.equal(mem.ops.length, 0);
    });
});

describe('S1: source scans', () => {
    const region = SRC.slice(SRC.indexOf('// v39.15: the Weather Service forecast archive'), SRC.indexOf('exports._test = {'));
    const handlerSrc = SRC.slice(SRC.indexOf('exports.handler = async'));
    it('the new code is found and is non-trivial', () => { assert.ok(region.length > 3000); });
    it('sync-learning.js does not mention nws_fc', () => {
        assert.ok(!fs.readFileSync(path.join(__dirname, '../netlify/functions/sync-learning.js'), 'utf8').includes('nws_fc'));
    });
    it('no real healthchecks address in the new code or in the new tests', () => {
        const bad = 'hc-ping' + '.com';   // built, so this file does not contain the literal itself
        assert.ok(!region.includes(bad));
        for (const f of fs.readdirSync(__dirname).filter(n => n.startsWith('forecast-archive-'))) {
            assert.ok(!fs.readFileSync(path.join(__dirname, f), 'utf8').includes(bad), f);
        }
    });
    it('no User-Agent or other custom request header, key or contact detail in the new request code', () => {
        assert.ok(!/user-agent/i.test(region));
        assert.ok(!/headers\s*:/.test(region.slice(region.indexOf('async function nwsFetchOne'), region.indexOf('async function fetchNwsArchive'))));
        assert.ok(!/api[-_ ]?key|@[a-z0-9-]+\.(com|org|gov)/i.test(region));
    });
    it('the housekeeping prune list stays the three names; the nws_fc prune is its own literal call; no Object.keys of the table is used to prune', () => {
        assert.ok(SRC.includes("for (const type of ['tick_log', 'validation_log', 'bin_snapshot']) {"));
        assert.ok(handlerSrc.includes("pruneLogType(client, 'nws_fc'"));
        assert.ok(!/Object\.keys\(LOG_RETENTION_DAYS\)/.test(SRC));
    });
    it('nothing new is referenced above the success ping, and the archive row comes after finalizeTick', () => {
        const iPing = handlerSrc.indexOf('process.env.HEALTHCHECKS_PING_URL');
        const iPingEnd = handlerSrc.indexOf('v39.15: start the Weather Service forecast archive request');
        const iFinal = handlerSrc.indexOf('await finalizeTick(client, logBudget, tickCtx, tickStartMs, {\n            out: prediction');
        const iWrite = handlerSrc.indexOf("writeLogRow(client, 'nws_fc'");
        assert.ok(iPing > 0 && iPingEnd > iPing && iFinal > iPingEnd && iWrite > iFinal);
        for (const word of ['nwsP', 'nwsOn', 'nwsHooks', 'nwsFallback', 'nws_fc', 'NWS_ARCHIVE', 'fetchNwsArchive']) {
            assert.ok(handlerSrc.indexOf(word) > iPing, `${word} is first used after the ping`);
        }
        // the one await of the archive promise is after finalizeTick
        assert.equal(handlerSrc.split('await (nwsP').length, 2);
        assert.ok(handlerSrc.indexOf('await (nwsP') > iFinal);
    });
    it('the archive row is written on the arch pool under the deadline, and its health flush too', () => {
        assert.ok(handlerSrc.includes("writeLogRow(client, 'nws_fc', rec.at, rec, logBudget, 'arch', {}, deadline)"));
        assert.ok(handlerSrc.includes("flushLogHealth(client, logBudget, { pool: 'arch', deadline })"));
        assert.ok(handlerSrc.includes("pruneLogType(client, 'nws_fc', { nowMs: tickStartMs, budget: logBudget, deadline })"));
    });
    it('the new block after finalizeTick has its own try/catch that swallows everything', () => {
        const blk = handlerSrc.slice(handlerSrc.indexOf('if (nwsOn) {\n            try {'), handlerSrc.indexOf('return {\n            statusCode: 200'));
        assert.ok(blk.includes('} catch (_) { /* log-only'));
    });
    it('validateForecastPredictions and the pending-forecast code do not mention the archive', () => {
        const a = SRC.indexOf('async function validateForecastPredictions');
        const b = SRC.indexOf('\n}\n', a);
        assert.ok(a > 0 && b > a);
        assert.ok(!/nws_fc|nwsFc|nwsHooks|nwsP\b|fetchNwsArchive|NWS_ARCHIVE/.test(SRC.slice(a, b)));
    });
    it('the code that reads from the estimate side never references the archive helpers', () => {
        const model = fs.readFileSync(path.join(__dirname, '../netlify/functions/shared/model.js'), 'utf8');
        assert.ok(!/nws_fc|nwsFcInputs|fetchNwsArchive/.test(model));
    });
});

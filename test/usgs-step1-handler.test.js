// v39.11 (Step 1): the whole cron handler with fetch stubbed, in every USGS source and failure mode.
// New service (key set): the X-Api-Key header, the old host never called, one retry on timeout / 5xx,
// none on 429; no key or USGS_SOURCE=old: the old address byte for byte; the key never appears in any
// logged string, address or stored row. No network, hc-ping.com is never called (the ping host is a stub).
// Plan: analysis/usgs-service-move-plan-2026-11-17.md.

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
process.env.HEALTHCHECKS_PING_URL = 'https://hc-ping.test/abc-123';
delete process.env.USGS_API_KEY;
delete process.env.USGS_SOURCE;

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

let CURRENT = null;
const model = require('../netlify/functions/shared/model');
model.getSupabase = () => CURRENT;
const { handler, _test } = require('../netlify/functions/scheduled-update');
const { createMemClient } = require('./helpers/mem-supabase');
const { iso, usgsPayload, tempPayload, drPayload } = require('./helpers/usgs-mock');

const HOUR = 3600000;
const PING = process.env.HEALTHCHECKS_PING_URL;
const T0 = Date.UTC(2023, 10, 14, 16, 5, 0);
const KEY = 'KEYKEYKEY-do-not-log-0123456789';
const OLD_MAIN_URL = 'https://waterservices.usgs.gov/nwis/iv/?sites=01638500,01646500,01643000,01644000,01644280,01645000,01644148&parameterCd=00060,00065&period=P2D&format=json';
const OLD_TEMP_URL = 'https://waterservices.usgs.gov/nwis/iv/?sites=01638500&parameterCd=00010&period=P1D&format=json';
const OLD_DR_URL = 'https://waterservices.usgs.gov/nwis/iv/?sites=01646000&parameterCd=00060&period=PT6H&format=json';
const NEW_HOST = 'https://api.waterdata.usgs.gov/';
const OLD_HOST = 'waterservices.usgs.gov';

// old-structure payload -> new-service FeatureCollection (the inverse of the adapter, for stubbing)
function toNew(old, nowMs) {
    const features = [];
    for (const ts of old.value.timeSeries) {
        const site = ts.sourceInfo.siteCode[0].value, param = ts.variable.variableCode[0].value;
        for (const v of ts.values[0].value) {
            const quals = (v.qualifiers || []).map(q => (typeof q === 'string' ? q : q.qualifierCode));
            const ice = quals.includes('Ice');
            const extra = quals.filter(q => q !== 'P' && q !== 'Ice');
            const qualifier = ice ? ['ICE', ...extra] : (extra.length ? extra : null);
            features.push({
                type: 'Feature', geometry: null, id: 'x',
                properties: {
                    time_series_id: `${site}-${param}`, monitoring_location_id: `USGS-${site}`, parameter_code: param, statistic_id: '00011',
                    time: v.dateTime, value: ice ? null : v.value, approval_status: 'Provisional', qualifier,
                    last_modified: new Date(Date.parse(v.dateTime) + 25 * 60000).toISOString()
                }
            });
        }
    }
    return { type: 'FeatureCollection', features, numberReturned: features.length, links: [{ rel: 'self', href: 'x' }], timeStamp: iso(nowMs) };
}
const ok = (json) => ({ ok: true, status: 200, json: async () => json });

const flush = () => new Promise(r => setImmediate(r));
async function drive(t, fn) {
    let done = false, result, error;
    const p = fn().then(v => { done = true; result = v; }, e => { done = true; error = e; });
    for (let i = 0; i < 80 && !done; i++) { for (let k = 0; k < 6; k++) await flush(); if (!done) t.mock.timers.tick(500); }
    if (!done) throw new Error('drive: the call did not finish within the virtual time budget');
    await p;
    if (error) throw error;
    return result;
}

function seeds(nowMs) {
    const rows = [{
        observation_type: 'gf_prediction', gauge_id: 'pending', created_at: iso(nowMs - 6 * HOUR),
        data: { timestamp: iso(nowMs - 6 * HOUR), validationDue: iso(nowMs - 10 * 60000), predictedCFS: 10500, rawFinalCFS: 10800, correctionApplied: 300, predictedStage: 4.0, rawFinalStage: 4.05, flowBin: '6000-12000', flowState: 'steady', lfCFS: 9900, ceilingApplied: false, shadowModels: { lfFeedback: 10100, onlineRegression: 10300, kalman: 10050 } },
    }];
    for (const k of ['6000-12000_steady', '6000-12000_rising', '3000-6000_steady', 'stage_6000-12000_steady']) {
        rows.push({ observation_type: 'gf_correction_bin', gauge_id: k, data: { count: 12, sumError: 3000, sumErrorSq: 900000, meanError: 250, emaMeanError: 260 } });
    }
    rows.push({ observation_type: 'shadow_leaderboard', gauge_id: 'system', data: { totalRounds: 3 } });
    return rows;
}

// `main` is a list of behaviours for successive main-request attempts (the last one repeats).
// Behaviours: 'ok' | 'hang' | 'network' | 503 | 429 | 403 | 'paged' | 'badjson'.
async function runArm(t, { key = KEY, usgsSource, main = ['ok'], temp = 'ok', dr = 'ok', unknownQual = false } = {}) {
    if (key) process.env.USGS_API_KEY = key; else delete process.env.USGS_API_KEY;
    if (usgsSource) process.env.USGS_SOURCE = usgsSource; else delete process.env.USGS_SOURCE;
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.timers.setTime(T0);
    const logged = [];
    for (const m of ['log', 'warn', 'error', 'info']) t.mock.method(console, m, (...a) => { logged.push(a.map(x => (x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); });
    const mem = createMemClient({ rows: seeds(T0) });
    CURRENT = mem.client;
    const calls = [];
    let mainN = 0;
    const isNew = (u) => u.startsWith(NEW_HOST);
    const respond = (b, payloadOld, mk) => {
        if (b === 'ok') return ok(mk(payloadOld));
        if (b === 'hang') return new Promise(() => {});
        if (b === 'network') throw new Error('ECONNRESET');
        if (b === 'paged') { const j = mk(payloadOld); j.links.push({ rel: 'next', href: 'x' }); return ok(j); }
        if (b === 'badjson') return { ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } };
        return { ok: false, status: b, statusText: 'x', json: async () => ({}) };
    };
    t.mock.method(global, 'fetch', async (url, init) => {
        const u = String(url);
        calls.push({ url: u, headers: init && init.headers ? { ...init.headers } : null });
        if (u.startsWith(PING)) return { ok: true };
        const isMain = u.includes('parameter_code=00060,00065') || u.includes('parameterCd=00060,00065');
        const isTemp = u.includes('parameter_code=00010') || u.includes('parameterCd=00010');
        const isDr = u.includes('USGS-01646000') || u.includes('sites=01646000');
        const asOld = (j) => j;
        if (isMain) {
            const b = main[Math.min(mainN++, main.length - 1)];
            let payload = usgsPayload(T0);
            if (unknownQual) payload.value.timeSeries[0].values[0].value.at(-1).qualifiers = ['Weird'];
            return respond(b, payload, isNew(u) ? (j) => toNew(j, T0) : asOld);
        }
        if (isTemp) return respond(temp, tempPayloadFull(), isNew(u) ? (j) => toNew(j, T0) : asOld);
        if (isDr) return respond(dr, drPayload(T0, { vals: [12.7, 12.9, 13.1], ageMin: 73, quals: ['P'] }), isNew(u) ? (j) => toNew(j, T0) : asOld);
        throw new Error('unexpected fetch ' + u);
    });
    const res = await drive(t, () => handler({}, {}));
    t.mock.restoreAll();
    t.mock.timers.reset();
    delete process.env.USGS_API_KEY; delete process.env.USGS_SOURCE;
    return { mem, calls, res, logged };
}
// temp payload with the site/param the new-service stub needs
function tempPayloadFull() {
    const p = tempPayload(T0);
    p.value.timeSeries[0].sourceInfo = { siteCode: [{ value: '01638500' }] };
    p.value.timeSeries[0].variable = { variableCode: [{ value: '00010' }] };
    p.value.timeSeries[0].values[0].value[0].qualifiers = [];
    return p;
}

const mainCalls = (a) => a.calls.filter(c => c.url.includes('parameter_code=00060,00065') || c.url.includes('parameterCd=00060,00065'));
const pingKinds = (a) => a.calls.filter(c => c.url.startsWith(PING)).map(c => (c.url === PING ? 'ok' : 'fail'));
const tickOf = (a) => a.mem.of('tick_log')[0].data;
const noKeyAnywhere = (a) => {
    const all = JSON.stringify([a.calls.map(c => c.url), a.logged, a.mem.rows]);
    assert.ok(!all.includes(KEY), 'the key must not appear in any address, log line or stored row');
    for (const c of a.calls) assert.ok(!c.url.includes(KEY));
};

describe('key set: the new service', () => {
    it('main, temperature and Difficult Run all go to the new host with X-Api-Key; the old host is never called', async (t) => {
        const a = await runArm(t);
        assert.equal(a.res.statusCode, 200);
        const usgs = a.calls.filter(c => !c.url.startsWith(PING));
        assert.equal(usgs.length, 3, 'main, temperature, Difficult Run: one request each');
        for (const c of usgs) {
            assert.ok(c.url.startsWith(NEW_HOST), c.url);
            assert.ok(!c.url.includes(OLD_HOST));
            assert.equal(c.headers['X-Api-Key'], KEY);
        }
        assert.ok(mainCalls(a)[0].url.includes('time=P2D') && mainCalls(a)[0].url.includes('USGS-01638500,USGS-01646500'));
        assert.deepEqual(pingKinds(a), ['ok']);
        const tick = tickOf(a);
        assert.equal(tick.out, 'predicted');
        assert.equal(tick.src, 'new');
        assert.equal(tick.att, 1);
        assert.equal(tick.in.dr.why, null);
        assert.equal(tick.in.dr.q, 13.1);
        assert.equal(tick.in.tC, 12.5);
        noKeyAnywhere(a);
    });
    it('tick_log carries the publish time of the newest reading per gauge (log only)', async (t) => {
        const a = await runArm(t);
        const tick = tickOf(a);
        assert.ok(tick.pub && tick.pub['01638500'], JSON.stringify(tick.pub));
        assert.equal(tick.pub['01638500'].lm - tick.pub['01638500'].t, 25 * 60000);
        assert.ok(Number.isFinite(tick.pub['01646500'].t));
        assert.equal(tick.in.por.q, 10000);
    });
    it('the estimate is the same from either source (old structure vs adapter)', async (t) => {
        const a = await runArm(t, { key: null });
        const b = await runArm(t);
        assert.equal(tickOf(b).final.cfs, tickOf(a).final.cfs);
        assert.equal(tickOf(b).in.lf.q, tickOf(a).in.lf.q);
        assert.deepEqual(tickOf(b).in.lf, tickOf(a).in.lf);
        assert.deepEqual(tickOf(b).in.por, tickOf(a).in.por);
    });
    it('first attempt times out: one retry, then success (the key never leaks)', async (t) => {
        const a = await runArm(t, { main: ['hang', 'ok'] });
        assert.equal(mainCalls(a).length, 2);
        assert.deepEqual(pingKinds(a), ['ok']);
        assert.equal(tickOf(a).out, 'predicted');
        assert.equal(tickOf(a).src, 'new');
        assert.equal(tickOf(a).att, 2);
        noKeyAnywhere(a);
    });
    it('first attempt 503 or network error: one retry, then success', async (t) => {
        for (const first of [503, 'network']) {
            const a = await runArm(t, { main: [first, 'ok'] });
            assert.equal(mainCalls(a).length, 2, String(first));
            assert.deepEqual(pingKinds(a), ['ok'], String(first));
        }
    });
    it('both attempts fail: the existing failure path (fail signal, no success signal, 500)', async (t) => {
        for (const bad of [['hang'], [503], ['network']]) {
            const a = await runArm(t, { main: bad });
            assert.equal(mainCalls(a).length, 2, JSON.stringify(bad));
            assert.equal(a.res.statusCode, 500);
            assert.deepEqual(pingKinds(a), ['fail']);
            assert.ok(a.logged.some(l => l.includes('Failed to fetch USGS data')) || tickOf(a).why === 'usgs_fetch_failed');
            assert.equal(tickOf(a).out, 'error');
            assert.equal(tickOf(a).src, 'new');
            assert.equal(tickOf(a).att, 2);
            noKeyAnywhere(a);
        }
    });
    it('HTTP 429: no retry, labelled new_429, failure path', async (t) => {
        const a = await runArm(t, { main: [429] });
        assert.equal(mainCalls(a).length, 1);
        assert.equal(a.res.statusCode, 500);
        assert.deepEqual(pingKinds(a), ['fail']);
        assert.equal(tickOf(a).src, 'new_429');
        noKeyAnywhere(a);
    });
    it('HTTP 4xx other than 429, a paged answer and an unparsable body: no retry, failure path', async (t) => {
        for (const bad of [403, 'paged', 'badjson']) {
            const a = await runArm(t, { main: [bad] });
            assert.equal(mainCalls(a).length, 1, String(bad));
            assert.deepEqual(pingKinds(a), ['fail'], String(bad));
            assert.equal(tickOf(a).out, 'error');
        }
    });
    it('no fallback to the old service, ever', async (t) => {
        for (const bad of [['hang'], [429], [503]]) {
            const a = await runArm(t, { main: bad });
            assert.ok(!a.calls.some(c => c.url.includes(OLD_HOST)), JSON.stringify(bad));
        }
    });
    it('an unknown qualifier code is passed through, logged in aux.unkQ, and does not fail the run', async (t) => {
        const a = await runArm(t, { unknownQual: true });
        assert.equal(a.res.statusCode, 200);
        assert.deepEqual(tickOf(a).aux.unkQ, ['Weird']);
        assert.ok(a.logged.some(l => l.includes('unknown qualifier')));
    });
    it('temperature: HTTP 429 gives the existing "no temperature" result and one attempt', async (t) => {
        const a = await runArm(t, { temp: 429 });
        assert.equal(a.calls.filter(c => c.url.includes('parameter_code=00010')).length, 1);
        assert.equal(a.res.statusCode, 200);
        assert.equal(tickOf(a).in.tC, null);
    });
    it('Difficult Run: 429 is an http_error with http 429, one attempt; a timeout stays "timeout"', async (t) => {
        const a = await runArm(t, { dr: 429 });
        assert.equal(a.calls.filter(c => c.url.includes('USGS-01646000')).length, 1);
        assert.equal(tickOf(a).in.dr.why, 'http_error');
        assert.equal(tickOf(a).in.dr.http, 429);
        assert.equal(a.res.statusCode, 200);
        const b = await runArm(t, { dr: 'hang' });
        assert.equal(tickOf(b).in.dr.why, 'timeout');
        assert.equal(b.res.statusCode, 200);
    });
});

describe('no key, or USGS_SOURCE=old: the old service exactly as before', () => {
    it('no key: the three old addresses byte for byte, no header, source old_nokey', async (t) => {
        const a = await runArm(t, { key: null });
        const usgs = a.calls.filter(c => !c.url.startsWith(PING));
        assert.deepEqual(usgs.map(c => c.url).sort(), [OLD_DR_URL, OLD_MAIN_URL, OLD_TEMP_URL].sort());
        for (const c of usgs) assert.equal(c.headers, null);
        assert.equal(tickOf(a).src, 'old_nokey');
        assert.equal(tickOf(a).pub, null);
        assert.equal(tickOf(a).out, 'predicted');
    });
    it('key set and USGS_SOURCE=old: old addresses, no key sent, source old', async (t) => {
        const a = await runArm(t, { usgsSource: 'old' });
        const usgs = a.calls.filter(c => !c.url.startsWith(PING));
        assert.deepEqual(usgs.map(c => c.url).sort(), [OLD_DR_URL, OLD_MAIN_URL, OLD_TEMP_URL].sort());
        for (const c of usgs) assert.equal(c.headers, null);
        assert.equal(tickOf(a).src, 'old');
        noKeyAnywhere(a);
    });
    it('the old path keeps one attempt: a failure is not retried', async (t) => {
        const a = await runArm(t, { key: null, main: [503] });
        assert.equal(mainCalls(a).length, 1);
        assert.deepEqual(pingKinds(a), ['fail']);
        assert.equal(tickOf(a).src, 'old_nokey');
    });
    it('USGS_SOURCE other than old does not switch the source', async (t) => {
        const a = await runArm(t, { usgsSource: 'new' });
        assert.equal(tickOf(a).src, 'new');
    });
});

describe('usgsRequest (pure source rule)', () => {
    const r = { sites: ['01638500'], params: ['00060'], period: 'P2D', oldUrl: 'OLD' };
    it('decides by key and switch', () => {
        delete process.env.USGS_API_KEY; delete process.env.USGS_SOURCE;
        assert.equal(_test.usgsRequest(r).source, 'old_nokey');
        process.env.USGS_API_KEY = KEY;
        assert.equal(_test.usgsRequest(r).source, 'new');
        assert.ok(!_test.usgsRequest(r).url.includes(KEY));
        process.env.USGS_SOURCE = 'old';
        assert.equal(_test.usgsRequest(r).source, 'old');
        assert.equal(_test.usgsRequest(r).url, 'OLD');
        delete process.env.USGS_API_KEY;
        assert.equal(_test.usgsRequest(r).source, 'old_nokey');
        delete process.env.USGS_SOURCE;
    });
});

describe('a malformed key never reaches a log', () => {
    it('a key with a newline: the old URL is used, source old_nokey, the key text is in no logged string', async (t) => {
        const bad = 'SECRETSECRET\nabc';
        const a = await runArm(t, { key: bad });
        const usgs = a.calls.filter(c => !c.url.startsWith(PING));
        assert.deepEqual(usgs.map(c => c.url).sort(), [OLD_DR_URL, OLD_MAIN_URL, OLD_TEMP_URL].sort());
        for (const c of usgs) assert.equal(c.headers, null);
        assert.equal(tickOf(a).src, 'old_nokey');
        assert.ok(a.logged.some(l => l.includes('USGS key malformed, using the old service')));
        const all = JSON.stringify([a.calls, a.logged, a.mem.rows]);
        assert.ok(!all.includes('SECRETSECRET') && !all.includes('abc\\'), 'no part of the key is logged');
    });
    it('keys with a space or a control character are also rejected; a normal key is accepted', () => {
        for (const k of ['a b', 'a\tb', 'é']) {
            process.env.USGS_API_KEY = k;
            assert.equal(_test.usgsRequest({ sites: ['01638500'], params: ['00060'], period: 'P2D', oldUrl: 'OLD' }).source, 'old_nokey', JSON.stringify(k));
        }
        process.env.USGS_API_KEY = 'Abc123-_.xyz';
        assert.equal(_test.usgsRequest({ sites: ['01638500'], params: ['00060'], period: 'P2D', oldUrl: 'OLD' }).source, 'new');
        delete process.env.USGS_API_KEY;
    });
    it('an error message that contains the key is redacted in the log (defensive)', async (t) => {
        process.env.USGS_API_KEY = KEY;
        const logged = [];
        for (const m of ['log', 'warn', 'error']) t.mock.method(console, m, (...x) => logged.push(x.join(' ')));
        t.mock.method(global, 'fetch', async () => { throw new Error(`boom with header ${KEY} inside`); });
        const r = await _test.fetchNewIvJson({ url: NEW_HOST + 'x', headers: { 'X-Api-Key': KEY } }, [1000]);
        t.mock.restoreAll(); delete process.env.USGS_API_KEY;
        assert.equal(r, null);
        assert.ok(logged.length && logged.every(l => !l.includes(KEY)));
        assert.ok(logged.some(l => l.includes('[redacted]')));
    });
});

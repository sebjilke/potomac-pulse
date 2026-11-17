// v39.12 (Step 2, push A): the /api/usgs function (netlify/functions/usgs-proxy.mjs) with fetch stubbed.
// No network. The key is set (and restored) inside the tests, so the suite ignores the machine's
// environment. Nothing in the app calls the function yet.
// Plan and rulings: analysis/usgs-step2-app-plan-2026-11-17.md.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import handler, { config } from '../netlify/functions/usgs-proxy.mjs';
import { GAUGES, CREEK_RUNS, EDWARDS_FERRY } from '../src/model/constants.js';

const require = createRequire(import.meta.url);
const { SETS, CACHE_POLICY } = require('../netlify/functions/shared/usgs-sets.js');
const adapter = require('../netlify/functions/shared/usgs-adapter.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'usgs', f), 'utf8'));
const parNew = load('par_new.json');

const KEY = 'TEST-KEY-3f9a1c7e-do-not-log';
const KEY2 = 'APP-KEY-7b2d4e-do-not-log';
const BASE = 'https://potomac-pulse.test';
const NEW_HOST = 'https://api.waterdata.usgs.gov/';

// fixture split by parameter (what the two upstream calls of `main` would return)
const byParam = (code) => ({ ...parNew, features: parNew.features.filter(f => f.properties.parameter_code === code) });
const FLOW = byParam('00060');
const STAGE = byParam('00065');
const TEMP = byParam('00010');

function resp(status, json, headers = {}) {
    return {
        ok: status >= 200 && status < 300, status,
        headers: { get: (k) => (headers[String(k).toLowerCase()] === undefined ? null : String(headers[String(k).toLowerCase()])) },
        json: async () => { if (json instanceof Error) throw json; return json; }
    };
}

// Runs one request. `upstream(url, n)` returns a response (or a promise, or throws). Returns everything observable.
async function run(t, { url = `${BASE}/api/usgs?set=creeks`, method = 'GET', upstream, key = KEY, appKey, advance = 0, raw, tick = advance } = {}) {
    const saved = { a: process.env.USGS_API_KEY, b: process.env.USGS_API_KEY_APP };
    if (key) process.env.USGS_API_KEY = key; else delete process.env.USGS_API_KEY;
    if (appKey) process.env.USGS_API_KEY_APP = appKey; else delete process.env.USGS_API_KEY_APP;
    t.after(() => { for (const [k, v] of [['USGS_API_KEY', saved.a], ['USGS_API_KEY_APP', saved.b]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (u, init) => {
        calls.push({ url: String(u), headers: init && init.headers ? { ...init.headers } : {}, signal: init && init.signal });
        return upstream ? upstream(String(u), calls.length) : resp(200, FLOW);
    });
    const logged = [];
    for (const m of ['log', 'warn', 'error', 'info', 'debug']) t.mock.method(console, m, (...a) => { logged.push(a.map(x => (typeof x === 'string' ? x : x instanceof Error ? x.stack : JSON.stringify(x))).join(' ')); });
    const flush = () => new Promise(r => setImmediate(r));
    let p;
    const pendingTimers = new Set();   // timers the function started that neither fired nor were cleared
    const trackTimers = () => {
        const origSet = globalThis.setTimeout, origClear = globalThis.clearTimeout;
        t.mock.method(globalThis, 'setTimeout', (cb, ms, ...a) => { const h = origSet(() => { pendingTimers.delete(h); cb(...a); }, ms); pendingTimers.add(h); return h; });
        t.mock.method(globalThis, 'clearTimeout', (h) => { pendingTimers.delete(h); return origClear(h); });
    };
    const target = raw !== undefined ? { method, url: raw } : null;
    const mkReq = () => target || new Request(url, { method });
    if (advance) {
        t.mock.timers.reset();
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        t.mock.timers.setTime(Date.UTC(2031, 0, 1));
        trackTimers();
        p = handler(mkReq(), {});
        for (let i = 0; i < 5; i++) await flush();
        if (tick) t.mock.timers.tick(tick);
    } else {
        trackTimers();
        p = handler(mkReq(), {});
    }
    const res = await p;
    const body = await res.text();
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { res, status: res.status, body, headers, calls, logged, pendingTimers: pendingTimers.size };
}
const parse = (r) => JSON.parse(r.body);
const sorted = (j) => ({ ...j, value: { ...j.value, timeSeries: [...j.value.timeSeries].sort((a, b) => (a.sourceInfo.siteCode[0].value + a.variable.variableCode[0].value).localeCompare(b.sourceInfo.siteCode[0].value + b.variable.variableCode[0].value)) } });
const everything = (r) => [r.body, JSON.stringify(r.headers), r.logged.join('\n'), JSON.stringify(r.calls.map(c => c.url))].join('\n');

const NO_STORE_ALL = (h) => { assert.equal(h['cache-control'], 'no-store'); assert.equal(h['netlify-cdn-cache-control'], 'no-store'); };

describe('usgs-proxy: configuration', () => {
    it('modern format: path /api/usgs, method GET', () => {
        assert.deepEqual(config, { path: '/api/usgs', method: 'GET' });
        assert.equal(typeof handler, 'function');
    });
    it('CACHE_POLICY has exactly the agreed fields and stays inside the bounds', () => {
        assert.deepEqual(Object.keys(CACHE_POLICY).sort(), ['errorSeconds', 'okGraceSeconds', 'okSeconds', 'rateLimitedMaxSeconds', 'rateLimitedMinSeconds']);
        assert.ok(CACHE_POLICY.okSeconds + CACHE_POLICY.okGraceSeconds <= 300, 'ok + grace must be well under the 10 minute saved-copy rule');
        assert.ok(CACHE_POLICY.okSeconds >= 30);
        assert.ok(CACHE_POLICY.errorSeconds >= 30);
        assert.ok(CACHE_POLICY.rateLimitedMinSeconds <= CACHE_POLICY.rateLimitedMaxSeconds);
    });
    it('7. set tables equal GAUGES, CREEK_RUNS and EDWARDS_FERRY.id in src/model/constants.js', () => {
        assert.deepEqual([...SETS.main.sites].sort(), Object.keys(GAUGES).sort());
        assert.equal(SETS.main.sites.length, 19);
        assert.deepEqual([...SETS.creeks.sites].sort(), Object.keys(CREEK_RUNS).sort());
        assert.deepEqual([...SETS.ef.sites], [EDWARDS_FERRY.id]);
        assert.deepEqual([...SETS.temp.sites], ['01638500']);
        assert.deepEqual([...SETS.main.params], ['00060', '00065']); assert.equal(SETS.main.period, 'P7D');
        assert.deepEqual([...SETS.creeks.params], ['00060']); assert.equal(SETS.creeks.period, 'P1D');
        assert.deepEqual([...SETS.ef.params], ['00065']); assert.equal(SETS.ef.period, 'P1D');
        assert.deepEqual([...SETS.temp.params], ['00010']); assert.equal(SETS.temp.period, 'P1D');
        assert.equal(SETS.main.capMs, 5000);
        for (const s of ['creeks', 'ef', 'temp']) assert.equal(SETS[s].capMs, 3500);
    });
});

describe('usgs-proxy: upstream requests and the key', () => {
    it('1. each set builds the exact upstream URL(s); the key is only in X-Api-Key', async (t) => {
        for (const [name, set] of Object.entries(SETS)) {
            const r = await run(t, { url: `${BASE}/api/usgs?set=${name}`, upstream: (u) => resp(200, u.includes('00010') ? TEMP : u.includes('00065') ? STAGE : FLOW) });
            assert.equal(r.status, 200, name);
            const expected = set.params.map(p => adapter.buildContinuousUrl({ sites: [...set.sites], params: [p], period: set.period }));
            assert.deepEqual(r.calls.map(c => c.url).sort(), expected.sort(), name);
            for (const c of r.calls) {
                assert.ok(c.url.startsWith(NEW_HOST));
                assert.deepEqual(c.headers, { 'X-Api-Key': KEY });
                assert.ok(!c.url.includes(KEY));
            }
            t.mock.restoreAll();
        }
    });
    it('main makes exactly two upstream calls (one per parameter); the merge equals converting the combined fixture', async (t) => {
        const r = await run(t, { url: `${BASE}/api/usgs?set=main`, upstream: (u) => resp(200, u.includes('parameter_code=00065') ? STAGE : FLOW) });
        assert.equal(r.calls.length, 2);
        assert.ok(r.calls.some(c => c.url.includes('parameter_code=00060&')) && r.calls.some(c => c.url.includes('parameter_code=00065&')));
        const combined = { ...parNew, features: parNew.features.filter(f => f.properties.parameter_code !== '00010') };
        const expected = adapter.toLegacyIv({ ...combined, timeStamp: parNew.timeStamp });
        const got = parse(r);
        expected.value.queryInfo.note[0].value = new Date(Date.parse(parNew.timeStamp)).toISOString();
        assert.deepEqual(sorted(got), sorted(expected));
        assert.ok(got.value.timeSeries.length > 0);
    });
    it('the older timeStamp wins for main', async (t) => {
        const older = '2031-01-01T00:00:00.123456Z', newer = '2031-01-01T00:01:30.500000Z';
        for (const flip of [false, true]) {
            const r = await run(t, {
                url: `${BASE}/api/usgs?set=main`,
                upstream: (u) => (u.includes('parameter_code=00065') ? resp(200, { ...STAGE, timeStamp: flip ? older : newer }) : resp(200, { ...FLOW, timeStamp: flip ? newer : older }))
            });
            assert.equal(parse(r).value.queryInfo.note[0].value, '2031-01-01T00:00:00.123Z');
            t.mock.restoreAll();
        }
    });
    it('USGS_API_KEY_APP takes precedence over USGS_API_KEY; either alone works', async (t) => {
        let r = await run(t, { appKey: KEY2 });
        assert.deepEqual(r.calls[0].headers, { 'X-Api-Key': KEY2 });
        t.mock.restoreAll();
        r = await run(t, { appKey: '' });
        assert.deepEqual(r.calls[0].headers, { 'X-Api-Key': KEY });
        t.mock.restoreAll();
        r = await run(t, { key: '', appKey: KEY2 });
        assert.deepEqual(r.calls[0].headers, { 'X-Api-Key': KEY2 });
    });
    it('a missing or malformed key gives 503 no_key, no-store, and no upstream call', async (t) => {
        for (const key of ['', 'has space', 'new\nline', 'tab\tkey', 'café']) {
            const r = await run(t, { key });
            assert.equal(r.status, 503, JSON.stringify(key));
            assert.deepEqual(parse(r), { error: 'no_key' });
            NO_STORE_ALL(r.headers);
            assert.equal(r.calls.length, 0);
            t.mock.restoreAll();
        }
    });
});

describe('usgs-proxy: rejections (zero upstream calls, never echoed, no-store)', () => {
    const cases = [
        ['?%73et=main', 'GET', 400], ['?set=%6Dain', 'GET', 400], ['?SET=main', 'GET', 400], ['?set=Main', 'GET', 400],
        ['?set=main&x=1', 'GET', 400], ['?set=main&set=ef', 'GET', 400], ['?set=', 'GET', 400], ['', 'GET', 400],
        ['?', 'GET', 400], ['?set=main&', 'GET', 400], ['?x=1&set=main', 'GET', 400], ['?url=https://example.com', 'GET', 400],
        ['?set=x', 'GET', 400],
        ['?set=main', 'POST', 405], ['?set=main', 'HEAD', 405], ['?set=main', 'PUT', 405], ['?set=main', 'DELETE', 405]
    ];
    for (const [q, method, status] of cases) {
        it(`2. ${method} /api/usgs${q} -> ${status}`, async (t) => {
            const r = await run(t, { url: `${BASE}/api/usgs${q}`, method });
            assert.equal(r.status, status);
            assert.equal(r.calls.length, 0);
            NO_STORE_ALL(r.headers);
            assert.ok(!r.body.includes('example.com') && !r.body.includes(q.slice(1) || '\u0000'));
            assert.ok(['bad_request', 'method'].includes(parse(r).error));
        });
    }
    for (const p of ['/api/usgs/', '/api/usgs/x', '/api/USGS', '/api/usgs//', '/.netlify/functions/usgs-proxy', '/']) {
        it(`2. path ${p}?set=main -> 400`, async (t) => {
            const r = await run(t, { url: `${BASE}${p}?set=main` });
            assert.equal(r.status, 400);
            assert.equal(r.calls.length, 0);
            NO_STORE_ALL(r.headers);
        });
    }
});

describe('usgs-proxy: status map', () => {
    it('4. upstream 429 -> 503 upstream_rate_limited, Retry-After clamped, edge cached for that long', async (t) => {
        const P = CACHE_POLICY;
        for (const [ra, want] of [['10', P.rateLimitedMinSeconds], ['120', 120], ['99999', P.rateLimitedMaxSeconds], [undefined, P.rateLimitedMinSeconds], ['soon', P.rateLimitedMinSeconds]]) {
            const hdr = ra === undefined ? {} : { 'retry-after': ra };
            const r = await run(t, { upstream: () => resp(429, {}, hdr) });
            assert.equal(r.status, 503);
            assert.deepEqual(parse(r), { error: 'upstream_rate_limited' });
            const w = Math.min(P.rateLimitedMaxSeconds, Math.max(P.rateLimitedMinSeconds, want));
            assert.equal(r.headers['retry-after'], String(w));
            assert.equal(r.headers['netlify-cdn-cache-control'], `public, durable, max-age=${w}`);
            assert.equal(r.headers['cache-control'], 'no-store');
            assert.ok(w >= P.rateLimitedMinSeconds && w <= P.rateLimitedMaxSeconds);
            t.mock.restoreAll();
        }
    });
    it('4. a 429 on one of the two main calls is a 429; no retry', async (t) => {
        const r = await run(t, { url: `${BASE}/api/usgs?set=main`, upstream: (u) => (u.includes('00065') ? resp(429, {}, { 'retry-after': '90' }) : resp(200, FLOW)) });
        assert.equal(r.status, 503);
        assert.equal(r.calls.length, 2);
    });
    it('4. cap exceeded -> 504 upstream_timeout (fake timers), error caching from the policy', async (t) => {
        for (const [name, cap] of [['creeks', 3500], ['main', 5000]]) {
            const r = await run(t, { url: `${BASE}/api/usgs?set=${name}`, upstream: () => new Promise(() => {}), advance: cap });
            assert.equal(r.status, 504, name);
            assert.deepEqual(parse(r), { error: 'upstream_timeout' });
            assert.equal(r.headers['netlify-cdn-cache-control'], `public, durable, max-age=${CACHE_POLICY.errorSeconds}`);
            assert.equal(r.headers['cache-control'], 'no-store');
            t.mock.restoreAll();
        }
    });
    it('4. not yet at the cap: still waiting (no early 504)', async (t) => {
        let done = false;
        const saved = process.env.USGS_API_KEY; process.env.USGS_API_KEY = KEY;
        t.after(() => { if (saved === undefined) delete process.env.USGS_API_KEY; else process.env.USGS_API_KEY = saved; });
        t.mock.method(globalThis, 'fetch', () => new Promise(() => {}));
        t.mock.method(console, 'log', () => {});
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        const p = handler(new Request(`${BASE}/api/usgs?set=main`), {}).then(() => { done = true; });
        await new Promise(r => setImmediate(r));
        t.mock.timers.tick(4999);
        await new Promise(r => setImmediate(r));
        assert.equal(done, false);
        t.mock.timers.tick(1);
        await p;
        assert.equal(done, true);
    });
    it('4. upstream 5xx, other 4xx, network error, malformed, paged, adapter-rejected -> 502 upstream_bad_response', async (t) => {
        const paged = { ...FLOW, links: [{ rel: 'next', href: 'x' }] };
        const noStat = { ...FLOW, features: FLOW.features.map(f => ({ ...f, properties: { ...f.properties, statistic_id: '00003' } })) };
        const dup = { ...FLOW, features: [FLOW.features[0], FLOW.features[0]] };
        const variants = {
            '500': () => resp(500, {}), '503': () => resp(503, {}), '400': () => resp(400, {}), '403': () => resp(403, {}), '404': () => resp(404, {}),
            network: () => { throw new Error('ECONNRESET'); },
            badjson: () => resp(200, new SyntaxError('bad json')), notobject: () => resp(200, null), nofeatures: () => resp(200, { timeStamp: FLOW.timeStamp }),
            paged: () => resp(200, paged), noStat: () => resp(200, noStat), dup: () => resp(200, dup)
        };
        for (const [name, up] of Object.entries(variants)) {
            const r = await run(t, { upstream: up });
            assert.equal(r.status, 502, name);
            assert.deepEqual(parse(r), { error: 'upstream_bad_response' }, name);
            assert.equal(r.headers['netlify-cdn-cache-control'], `public, durable, max-age=${CACHE_POLICY.errorSeconds}`);
            assert.equal(r.headers['cache-control'], 'no-store');
            assert.equal(r.calls.length, 1, `${name}: one attempt, no retry`);
            t.mock.restoreAll();
        }
    });
    it('4. unexpected exception -> 500 internal, no-store', async (t) => {
        const saved = process.env.USGS_API_KEY; process.env.USGS_API_KEY = KEY;
        t.after(() => { if (saved === undefined) delete process.env.USGS_API_KEY; else process.env.USGS_API_KEY = saved; });
        t.mock.method(console, 'log', () => {});
        const bad = { method: 'GET', get url() { throw new Error(`boom ${KEY}`); } };
        const res = await handler(bad, {});
        assert.equal(res.status, 500);
        assert.deepEqual(JSON.parse(await res.text()), { error: 'internal' });
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.equal(res.headers.get('netlify-cdn-cache-control'), 'no-store');
    });
});

describe('usgs-proxy: requestDT and success headers', () => {
    it('5. requestDT is the upstream timeStamp normalised, never the function clock', async (t) => {
        const r = await run(t, { advance: 1 });   // fake clock set to 2031
        assert.equal(r.status, 200);
        const note = parse(r).value.queryInfo.note[0];
        assert.equal(note.title, 'requestDT');
        assert.equal(note.value, new Date(Date.parse(FLOW.timeStamp)).toISOString());
        assert.match(note.value, /\.\d{3}Z$/);
        assert.ok(Date.parse(note.value) < Date.UTC(2030, 0, 1));
    });
    it('5. missing or unparseable timeStamp -> 502 no_timestamp (also when only one main call lacks it)', async (t) => {
        for (const ts of [undefined, null, '', 'not a date', 12345]) {
            const { timeStamp, ...rest } = FLOW;
            const r = await run(t, { upstream: () => resp(200, ts === undefined ? rest : { ...rest, timeStamp: ts }) });
            assert.equal(r.status, 502, String(ts));
            assert.deepEqual(parse(r), { error: 'no_timestamp' });
            t.mock.restoreAll();
        }
        const r = await run(t, { url: `${BASE}/api/usgs?set=main`, upstream: (u) => resp(200, u.includes('00065') ? { ...STAGE, timeStamp: 'junk' } : FLOW) });
        assert.equal(r.status, 502);
        assert.deepEqual(parse(r), { error: 'no_timestamp' });
    });
    it('6. 200 headers are built from CACHE_POLICY; body is compact JSON', async (t) => {
        const r = await run(t);
        assert.equal(r.status, 200);
        const P = CACHE_POLICY;
        assert.equal(r.headers['netlify-cdn-cache-control'], `public, durable, max-age=${P.okSeconds}, stale-while-revalidate=${P.okGraceSeconds}`);
        assert.equal(r.headers['netlify-vary'], 'query=set');
        assert.equal(r.headers['cache-control'], 'public, max-age=0, must-revalidate');
        assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
        assert.equal(r.body, JSON.stringify(JSON.parse(r.body)));
        assert.ok(P.okSeconds + P.okGraceSeconds <= 300);
        assert.ok(P.okSeconds >= 30 && P.errorSeconds >= 30);
        const expected = adapter.toLegacyIv({ ...FLOW, timeStamp: new Date(Date.parse(FLOW.timeStamp)).toISOString() });
        assert.equal(r.body, JSON.stringify(expected));
    });
    it('6. every non-200 outcome that must not be cached carries no-store on both headers', async (t) => {
        for (const url of [`${BASE}/api/usgs?x=1`, `${BASE}/api/usgs`]) { const r = await run(t, { url }); NO_STORE_ALL(r.headers); t.mock.restoreAll(); }
        const r = await run(t, { key: '' }); NO_STORE_ALL(r.headers);
    });
    it('the function source has no literal cache numbers (they come from CACHE_POLICY)', () => {
        const src = fs.readFileSync(path.join(here, '..', 'netlify', 'functions', 'usgs-proxy.mjs'), 'utf8');
        for (const line of src.split('\n').filter(l => /Cache-Control/.test(l) && /h\[/.test(l))) assert.ok(!/\b\d{2,}\b/.test(line), line);
    });
});

describe('usgs-proxy: logging and the key', () => {
    const OUTCOMES = {
        ok200: { upstream: () => resp(200, FLOW, { 'x-ratelimit-remaining': '987' }) },
        rate429: { upstream: () => resp(429, {}, { 'retry-after': '60' }) },
        timeout: { upstream: () => new Promise(() => {}), advance: 3500 },
        err5xx: { upstream: () => resp(503, {}) },
        malformed: { upstream: () => resp(200, { nothing: 1 }) },
        networkKeyInMessage: { upstream: () => { throw new Error(`connect failed with header X-Api-Key: ${KEY}`); } },
        badJsonKeyInMessage: { upstream: () => resp(200, new SyntaxError(`Unexpected token ${KEY}`)) },
        noTimestamp: { upstream: () => resp(200, { features: FLOW.features }) },
        rejected: { url: `${BASE}/api/usgs?set=main&x=1` },
        method: { method: 'POST' },
        noKey: { key: '' }
    };
    it('3. the key is nowhere (logs, body, headers, upstream URLs) across all outcomes; app key too', async (t) => {
        for (const [name, o] of Object.entries(OUTCOMES)) {
            for (const which of ['key', 'appKey']) {
                const opts = which === 'key' ? { ...o } : { ...o, key: KEY, appKey: KEY2 };
                const r = await run(t, opts);
                const all = everything(r);
                assert.ok(!all.includes(KEY2), `${name}/${which}: app key leaked`);
                // the legacy key may appear only as a header VALUE sent upstream (not part of `everything`)
                assert.ok(!all.includes(KEY), `${name}/${which}: key leaked`);
                t.mock.restoreAll();
            }
        }
    });
    it('3. an exception whose message holds the key is redacted in the log', async (t) => {
        const saved = process.env.USGS_API_KEY; process.env.USGS_API_KEY = KEY;
        t.after(() => { if (saved === undefined) delete process.env.USGS_API_KEY; else process.env.USGS_API_KEY = saved; });
        const logged = [];
        t.mock.method(console, 'log', (...a) => logged.push(a.join(' ')));
        t.mock.method(console, 'error', (...a) => logged.push(a.join(' ')));
        const res = await handler({ method: 'GET', get url() { throw new Error(`boom ${KEY} boom`); } }, {});
        assert.equal(res.status, 500);
        assert.ok(logged.length >= 1);
        assert.ok(!logged.join('\n').includes(KEY));
        assert.ok(logged.join('\n').includes('[redacted]'));
    });
    it('one log line per request: set, status, ms, upstream statuses, rows per call, rate limit as a number', async (t) => {
        const r = await run(t, { url: `${BASE}/api/usgs?set=main`, upstream: (u) => resp(200, u.includes('00065') ? STAGE : FLOW, { 'x-ratelimit-remaining': '987' }) });
        assert.equal(r.logged.length, 1);
        const line = r.logged[0];
        assert.match(line, /set=main/); assert.match(line, /status=200/); assert.match(line, /ms=\d+/);
        assert.match(line, /up=200,200/);
        assert.ok(line.includes(`rows=${FLOW.features.length},${STAGE.features.length}`));
        assert.match(line, /rl=987,987/);
        t.mock.restoreAll();
        const r2 = await run(t, { upstream: () => resp(200, FLOW, { 'x-ratelimit-remaining': 'abc <script>' }) });
        assert.equal(r2.logged.length, 1);
        assert.ok(!/rl=/.test(r2.logged[0]), 'a non-numeric rate limit header is not logged');
        assert.ok(!r2.logged[0].includes('script'));
    });
});

describe('usgs-proxy: timers and aborts (re-audit finding 1)', () => {
    const hang = (u, n) => new Promise(() => {});
    it('no timer started by the function is left running after success, 429, 5xx, malformed, network error and timeout', async (t) => {
        const cases = {
            ok: { upstream: () => resp(200, FLOW) },
            okMain: { url: `${BASE}/api/usgs?set=main`, upstream: (u) => resp(200, u.includes('00065') ? STAGE : FLOW) },
            rate: { upstream: () => resp(429, {}, { 'retry-after': '70' }) },
            err5xx: { upstream: () => resp(503, {}) },
            malformed: { upstream: () => resp(200, { x: 1 }) },
            network: { upstream: () => { throw new Error('ECONNRESET'); } },
            timeout: { upstream: hang, advance: 3500 },
            timeoutMain: { url: `${BASE}/api/usgs?set=main`, upstream: hang, advance: 5000 },
            rejected: { url: `${BASE}/api/usgs?x=1` }
        };
        for (const [name, o] of Object.entries(cases)) {
            const r = await run(t, o);
            assert.equal(r.pendingTimers, 0, `${name}: a timer is still pending`);
            t.mock.restoreAll();
        }
    });
    it('the real process has no extra Timeout handle after a normal answer (before/after count)', async (t) => {
        const count = () => process.getActiveResourcesInfo().filter(x => x === 'Timeout').length;
        await new Promise(r => setImmediate(r));
        const before = count();
        const r = await run(t, { upstream: () => resp(200, FLOW) });
        assert.equal(r.status, 200);
        assert.ok(count() <= before, `Timeout handles ${before} -> ${count()}`);
    });
    it('after a 504 the upstream request is aborted (signal.aborted true), for both main calls', async (t) => {
        for (const name of ['creeks', 'main']) {
            const r = await run(t, { url: `${BASE}/api/usgs?set=${name}`, upstream: hang, advance: name === 'main' ? 5000 : 3500 });
            assert.equal(r.status, 504);
            assert.ok(r.calls.length >= 1);
            for (const c of r.calls) assert.equal(c.signal.aborted, true, name);
            t.mock.restoreAll();
        }
    });
    it('a normal answer does not abort the request', async (t) => {
        const r = await run(t);
        assert.equal(r.calls[0].signal.aborted, false);
    });
    it('a 429 on one main call with the other hanging answers at once, and aborts the hanging call', async (t) => {
        for (const rateOn of ['00060', '00065']) {
            const r = await run(t, {
                url: `${BASE}/api/usgs?set=main`, advance: 1, tick: 1,
                upstream: (u) => (u.includes(`parameter_code=${rateOn}&`) ? resp(429, {}, { 'retry-after': '90' }) : new Promise(() => {}))
            });
            assert.equal(r.status, 503, rateOn);
            assert.equal(r.calls.length, 2);
            assert.ok(r.calls.every(c => c.signal.aborted), 'both signals aborted');
            assert.equal(r.pendingTimers, 0);
            assert.equal(r.headers['retry-after'], '90');
            t.mock.restoreAll();
        }
    });
    it('a 5xx on one main call with the other hanging answers 502 at once (well before the cap)', async (t) => {
        const r = await run(t, { url: `${BASE}/api/usgs?set=main`, advance: 1, tick: 100, upstream: (u) => (u.includes('00065') ? resp(500, {}) : new Promise(() => {})) });
        assert.equal(r.status, 502);
        assert.ok(r.calls.every(c => c.signal.aborted));
    });
    it('a network error on one main call with the other hanging answers 502 at once and aborts the sibling', async (t) => {
        const r = await run(t, { url: `${BASE}/api/usgs?set=main`, advance: 1, tick: 100, upstream: (u) => { if (u.includes('00065')) throw new Error('ECONNRESET'); return new Promise(() => {}); } });
        assert.equal(r.status, 502);
        assert.ok(r.calls.every(c => c.signal.aborted));
    });
    it('the body of a non-OK answer is cancelled', async (t) => {
        let cancelled = 0;
        const bad = { ...resp(503, {}), body: { cancel: () => { cancelled++; return Promise.resolve(); } } };
        const r = await run(t, { upstream: () => bad });
        assert.equal(r.status, 502);
        assert.equal(cancelled, 1);
        t.mock.restoreAll();
        const throwing = { ...resp(503, {}), body: { cancel: () => { throw new Error('nope'); } } };
        assert.equal((await run(t, { upstream: () => throwing })).status, 502);
    });
});

describe('usgs-proxy: partial failure of main (re-audit finding 2)', () => {
    const MAIN = `${BASE}/api/usgs?set=main`;
    const failures = {
        '5xx': { make: () => resp(500, {}), status: 502, error: 'upstream_bad_response' },
        network: { make: () => { throw new Error('ECONNRESET'); }, status: 502, error: 'upstream_bad_response' },
        paged: { make: (w) => resp(200, { ...w, links: [{ rel: 'next', href: 'x' }] }), status: 502, error: 'upstream_bad_response' },
        malformed: { make: () => resp(200, { nothing: 1 }), status: 502, error: 'upstream_bad_response' },
        badjson: { make: () => resp(200, new SyntaxError('x')), status: 502, error: 'upstream_bad_response' },
        notimestamp: { make: (w) => resp(200, { features: w.features }), status: 502, error: 'no_timestamp' },
        rate: { make: () => resp(429, {}, { 'retry-after': '100' }), status: 503, error: 'upstream_rate_limited' },
        timeout: { make: () => new Promise(() => {}), status: 504, error: 'upstream_timeout', advance: 5000 }
    };
    for (const [name, f] of Object.entries(failures)) {
        for (const failing of ['00060', '00065']) {
            it(`${name} on the ${failing} call, the other 200 -> ${f.status}, two calls, no partial body`, async (t) => {
                const r = await run(t, {
                    url: MAIN, advance: f.advance || 0,
                    upstream: (u) => (u.includes(`parameter_code=${failing}&`) ? f.make(failing === '00060' ? FLOW : STAGE) : resp(200, failing === '00060' ? STAGE : FLOW))
                });
                assert.equal(r.status, f.status);
                assert.deepEqual(parse(r), { error: f.error });
                assert.equal(r.calls.length, 2);
                assert.ok(!r.body.includes('timeSeries'));
            });
        }
    }
    it('two different Retry-After values: the larger is used', async (t) => {
        for (const [a, b] of [['100', '200'], ['200', '100']]) {
            const r = await run(t, { url: MAIN, upstream: (u) => resp(429, {}, { 'retry-after': u.includes('00065') ? a : b }) });
            assert.equal(r.status, 503);
            assert.equal(r.headers['retry-after'], '200');
            assert.equal(r.headers['netlify-cdn-cache-control'], 'public, durable, max-age=200');
            t.mock.restoreAll();
        }
    });
});

describe('usgs-proxy: raw address (re-audit finding 3)', () => {
    // The Request constructor normalises dot segments and strips tabs, newlines and trailing spaces
    // before the function can see them, so these are tested with a plain object {method, url} that
    // carries the raw string. A real Netlify request that arrives already normalised cannot be told
    // apart from a clean one; whether Netlify normalises before routing is a live check (TODO D12).
    const rawCases = [
        '/api/./usgs?set=main', '/api/x/../usgs?set=ef', '/api/usgs?set=main ', '/api/usgs?set=ma\nin', '/api/usgs?set=main\t',
        '/api/usgs?set=m\tain', '/api/usgs ?set=main', '/./api/usgs?set=creeks', '/api//usgs?set=temp', '/api/usgs?set=main\n'
    ];
    for (const rawPath of rawCases) {
        it(`${JSON.stringify(rawPath)} -> 400, zero upstream calls`, async (t) => {
            const r = await run(t, { raw: `https://potomac-pulse.test${rawPath}` });
            assert.equal(r.status, 400);
            assert.equal(r.calls.length, 0);
            NO_STORE_ALL(r.headers);
        });
    }
    it('the canonical raw address passes, with any scheme and host', async (t) => {
        const r = await run(t, { raw: 'http://localhost:8888/api/usgs?set=ef' });
        assert.equal(r.status, 200);
    });
    it('what the Request constructor does to these (documents the limit)', () => {
        assert.equal(new Request('https://x.test/api/./usgs?set=main').url, 'https://x.test/api/usgs?set=main');
        assert.equal(new Request('https://x.test/api/usgs?set=ma\nin').url, 'https://x.test/api/usgs?set=main');
    });
});

describe('usgs-proxy: malformed key is logged as a fixed token (re-audit finding 5)', () => {
    it('USGS_API_KEY_APP malformed: 503 no_key, key=malformed, no fallback to USGS_API_KEY, no key part logged', async (t) => {
        const bad = 'SECRETPART bad key';
        const r = await run(t, { key: KEY, appKey: bad });
        assert.equal(r.status, 503);
        assert.equal(r.calls.length, 0);
        assert.match(r.logged.join('\n'), /key=malformed/);
        const all = everything(r);
        for (const part of ['SECRETPART', 'bad key', KEY]) assert.ok(!all.includes(part), part);
    });
    it('USGS_API_KEY malformed alone: same token; a missing key does not log the token', async (t) => {
        let r = await run(t, { key: 'new\nline-SECRET' });
        assert.match(r.logged.join('\n'), /key=malformed/);
        assert.ok(!everything(r).includes('SECRET'));
        t.mock.restoreAll();
        r = await run(t, { key: '' });
        assert.equal(r.status, 503);
        assert.ok(!/key=malformed/.test(r.logged.join('\n')));
        t.mock.restoreAll();
        r = await run(t);
        assert.ok(!/key=malformed/.test(r.logged.join('\n')));
    });
});

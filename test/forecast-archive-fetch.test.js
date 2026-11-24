// v39.15 (N3): fetchNwsArchive under fake timers. Two requests, one timer, one body bound, one deadline.
// Plan: analysis/forecast-archive-plan-2026-11-24.md (version 2) section 3.3, audit point 4 and 10.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { _test } = require('../netlify/functions/scheduled-update');
const { fetchNwsArchive, NWS_BODY_MAX } = _test;

const BRK = fs.readFileSync(path.join(__dirname, 'fixtures/nws-brkm2.json'), 'utf8');
const POR = fs.readFileSync(path.join(__dirname, 'fixtures/nws-porm2.json'), 'utf8');
const URL_B = 'https://api.water.noaa.gov/nwps/v1/gauges/BRKM2/stageflow/forecast';
const URL_P = 'https://api.water.noaa.gov/nwps/v1/gauges/PORM2/stageflow/forecast';
const T0 = Date.UTC(2026, 10, 24, 18, 0, 3);

const enc = new TextEncoder();
const flush = () => new Promise(r => setImmediate(r));
async function drive(t, fn) {
    let done = false, result, error;
    const p = fn().then(v => { done = true; result = v; }, e => { done = true; error = e; });
    for (let i = 0; i < 80 && !done; i++) { for (let k = 0; k < 6; k++) await flush(); if (!done) t.mock.timers.tick(100); }
    if (!done) throw new Error('drive: did not finish (a missing time cap?)');
    await p;
    if (error) throw error;
    return result;
}
const body = (text) => new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close(); } });
const okResp = (text, extra = {}) => ({ ok: true, status: 200, headers: { get: () => null }, body: body(text), ...extra });
const endless = () => new ReadableStream({ pull() { return new Promise(() => {}); } });

// `routes`: { BRKM2: fn(init) => response | promise, PORM2: ... }
function setup(t, routes) {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.timers.setTime(T0);
    for (const m of ['log', 'warn', 'error']) t.mock.method(console, m, () => {});
    const calls = [];
    t.mock.method(global, 'fetch', (url, init) => {
        calls.push({ url: String(url), init });
        const lid = String(url).includes('BRKM2') ? 'BRKM2' : 'PORM2';
        return routes[lid](init);
    });
    return calls;
}
const both = (fn) => ({ BRKM2: fn, PORM2: fn });
const clean = () => ({ BRKM2: () => okResp(BRK), PORM2: () => okResp(POR) });

describe('N3: fetchNwsArchive', () => {
    it('clean: exactly the two upper-case URLs, only an abort signal in the init, no header, parsed rows', async (t) => {
        const calls = setup(t, clean());
        const r = await drive(t, () => fetchNwsArchive(T0));
        assert.deepEqual(calls.map(c => c.url).sort(), [URL_B, URL_P]);
        for (const c of calls) {
            assert.deepEqual(Object.keys(c.init), ['signal']);
            assert.ok(!('headers' in c.init));
        }
        assert.equal(r.g.BRKM2.why, null); assert.equal(r.g.BRKM2.http, 200);
        assert.equal(r.g.BRKM2.parsed.n, 12); assert.equal(r.g.PORM2.parsed.n, 12);
        assert.equal(r.g.BRKM2.site, '01646500'); assert.equal(r.g.PORM2.site, '01638500');
        assert.equal(r.ft, T0);
    });
    it('one gauge answers 500, the other is intact', async (t) => {
        setup(t, { BRKM2: () => ({ ok: false, status: 500 }), PORM2: () => okResp(POR) });
        const r = await drive(t, () => fetchNwsArchive(T0));
        assert.equal(r.g.BRKM2.why, 'http_error'); assert.equal(r.g.BRKM2.http, 500);
        assert.equal(r.g.PORM2.why, null); assert.equal(r.g.PORM2.parsed.n, 12);
    });
    it('429 and 403 are http_error with the status', async (t) => {
        setup(t, { BRKM2: () => ({ ok: false, status: 429 }), PORM2: () => ({ ok: false, status: 403 }) });
        const r = await drive(t, () => fetchNwsArchive(T0));
        assert.deepEqual([r.g.BRKM2.why, r.g.BRKM2.http, r.g.PORM2.why, r.g.PORM2.http], ['http_error', 429, 'http_error', 403]);
    });
    it('bad JSON and an HTML 200 are parse_error with a short head', async (t) => {
        setup(t, { BRKM2: () => okResp('{"data": [1,'), PORM2: () => okResp('<html><body>Maintenance https://x.test/?k=1</body></html>') });
        const r = await drive(t, () => fetchNwsArchive(T0));
        assert.equal(r.g.BRKM2.why, 'parse_error');
        assert.equal(r.g.PORM2.why, 'parse_error');
        assert.ok(r.g.PORM2.rawHead.includes('<url>'));
        assert.equal(r.g.PORM2.http, 200);
    });
    it('valid JSON without a forecast array is shape', async (t) => {
        setup(t, { BRKM2: () => okResp('{"data": []}'), PORM2: () => okResp('{"other": 1}') });
        const r = await drive(t, () => fetchNwsArchive(T0));
        assert.equal(r.g.BRKM2.why, 'shape'); assert.equal(r.g.PORM2.why, 'shape');
        assert.ok(r.g.BRKM2.rawHead);
    });
    it('network error is fetch_error, for a throw and for a rejection', async (t) => {
        setup(t, { BRKM2: () => { throw new Error('ECONNRESET'); }, PORM2: () => Promise.reject(new Error('boom')) });
        const r = await drive(t, () => fetchNwsArchive(T0));
        assert.equal(r.g.BRKM2.why, 'fetch_error'); assert.equal(r.g.PORM2.why, 'fetch_error');
    });
    it('hang before headers with a mock that IGNORES the abort and never settles: the timer ends the wait at 2000 ms', async (t) => {
        setup(t, both(() => new Promise(() => {})));
        const start = Date.now();
        const r = await drive(t, () => fetchNwsArchive(T0));
        assert.equal(Date.now() - start, 2000);
        assert.equal(r.g.BRKM2.why, 'timeout'); assert.equal(r.g.PORM2.why, 'timeout');
        assert.equal(r.ms, 2000);
    });
    it('the abort signal is fired at the cap', async (t) => {
        let sig;
        setup(t, both((init) => { sig = init.signal; return new Promise(() => {}); }));
        await drive(t, () => fetchNwsArchive(T0));
        assert.equal(sig.aborted, true);
    });
    it('a body that never ends ends at the cap, and the finished gauge keeps its result', async (t) => {
        setup(t, { BRKM2: () => okResp(BRK), PORM2: () => ({ ok: true, status: 200, headers: { get: () => null }, body: endless() }) });
        const start = Date.now();
        const r = await drive(t, () => fetchNwsArchive(T0));
        assert.equal(Date.now() - start, 2000);
        assert.equal(r.g.BRKM2.why, null); assert.equal(r.g.BRKM2.parsed.n, 12);
        assert.equal(r.g.PORM2.why, 'timeout');
        assert.equal(r.g.PORM2.http, 200);
    });
    it('a body over 256 KB is shape, the read stops and the stream is cancelled', async (t) => {
        let pulls = 0, cancelled = false;
        // ends with an error after 10 reads, so a missing bound fails this test quickly instead of hanging it
        const huge = () => new ReadableStream({
            pull(c) { pulls++; if (pulls > 10) { c.error(new Error('bound not enforced')); return; } c.enqueue(new Uint8Array(100000).fill(97)); },
            cancel() { cancelled = true; },
        });
        setup(t, { BRKM2: () => ({ ok: true, status: 200, headers: { get: () => null }, body: huge() }), PORM2: () => okResp(POR) });
        const r = await drive(t, () => fetchNwsArchive(T0));
        assert.equal(r.g.BRKM2.why, 'shape');
        assert.ok(cancelled, 'cancel() was called');
        assert.ok(pulls <= 6, 'reading stopped soon after the bound (' + pulls + ' pulls)');
        assert.ok(r.g.BRKM2.rawHead.length <= 1000);
        assert.equal(r.g.PORM2.why, null);
        assert.ok(NWS_BODY_MAX === 262144);
    });
    it('a content-length above the bound is a fast shape without reading (a hint only)', async (t) => {
        let read = false, cancelled = false;
        const spy = { getReader: () => ({ read() { read = true; return new Promise(() => {}); }, cancel() { cancelled = true; return Promise.resolve(); } }) };
        setup(t, { BRKM2: () => ({ ok: true, status: 200, headers: { get: () => '999999' }, body: spy }), PORM2: () => okResp(POR) });
        const r = await drive(t, () => fetchNwsArchive(T0));
        assert.equal(r.g.BRKM2.why, 'shape');
        assert.equal(read, false);
        assert.equal(cancelled, true);
    });
    it('a missing body is shape', async (t) => {
        setup(t, { BRKM2: () => ({ ok: true, status: 200 }), PORM2: () => okResp(POR) });
        const r = await drive(t, () => fetchNwsArchive(T0));
        assert.equal(r.g.BRKM2.why, 'shape');
    });
    it('started late so the cap would pass the deadline: the cap shrinks to the time left', async (t) => {
        setup(t, both(() => new Promise(() => {})));
        const tickStart = T0 - 23500;                 // deadline = T0 + 1500
        const start = Date.now();
        const r = await drive(t, () => fetchNwsArchive(tickStart));
        assert.equal(Date.now() - start, 1500);
        assert.equal(r.g.BRKM2.why, 'timeout');
    });
    it('started after the deadline: no request, late_skip for both', async (t) => {
        const calls = setup(t, clean());
        const r = await drive(t, () => fetchNwsArchive(T0 - 25000));
        assert.equal(calls.length, 0);
        assert.equal(r.g.BRKM2.why, 'late_skip'); assert.equal(r.g.PORM2.why, 'late_skip');
        assert.equal(r.ms, 0);
    });
    it('a Response whose getters throw gives a result, not a throw', async (t) => {
        const bad = () => ({ get ok() { throw new Error('boom'); }, get status() { throw new Error('boom'); }, get body() { throw new Error('boom'); } });
        setup(t, both(bad));
        const r = await drive(t, () => fetchNwsArchive(T0));
        assert.equal(r.g.BRKM2.why, 'fetch_error'); assert.equal(r.g.PORM2.why, 'fetch_error');
    });
    it('a late worker cannot change what was returned', async (t) => {
        let release;
        const gate = new Promise(r => { release = r; });
        setup(t, { BRKM2: () => gate, PORM2: () => okResp(POR) });
        const r = await drive(t, () => fetchNwsArchive(T0));
        assert.equal(r.g.BRKM2.why, 'timeout');
        release(okResp(BRK));
        for (let k = 0; k < 10; k++) await flush();
        assert.equal(r.g.BRKM2.why, 'timeout');
        assert.ok(!('parsed' in r.g.BRKM2));
    });
    // Spies on setTimeout and clearTimeout (wrapping the fake-timer versions) and returns the fetch's own timer:
    // the one set with the cap as its delay.
    function spyTimers(t) {
        const set = [], cleared = [];
        const realSet = global.setTimeout, realClear = global.clearTimeout;
        t.mock.method(global, 'setTimeout', (fn, ms, ...r) => { const h = realSet(fn, ms, ...r); set.push({ h, ms }); return h; });
        t.mock.method(global, 'clearTimeout', (h) => { cleared.push(h); return realClear(h); });
        return { set, cleared };
    }
    const fetchTimer = (sp) => sp.set.filter(x => x.ms === 2000);

    for (const [name, routes, why] of [
        ['a normal answer', clean(), null],
        ['an HTTP error', both(() => ({ ok: false, status: 503 })), 'http_error'],
        ['a bad shape', both(() => okResp('{"x":1}')), 'shape'],
        ['a timeout', both(() => new Promise(() => {})), 'timeout'],
    ]) {
        it(`the fetch's one timer is set and cleared: ${name}`, async (t) => {
            setup(t, routes);
            const sp = spyTimers(t);
            const r = await drive(t, () => fetchNwsArchive(T0));
            assert.equal(r.g.BRKM2.why, why);
            const mine = fetchTimer(sp);
            assert.equal(mine.length, 1, 'exactly one timer of the cap length');
            assert.ok(sp.cleared.includes(mine[0].h), 'that timer was cleared');
        });
    }
    it('no timer is set at all when the call is skipped (late_skip)', async (t) => {
        setup(t, clean());
        const sp = spyTimers(t);
        await drive(t, () => fetchNwsArchive(T0 - 25000));
        assert.equal(sp.set.length, 0);
    });
});

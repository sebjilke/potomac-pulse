// v39.13 (Step 2, push B): how the app obtains USGS readings. No network: `fetch` is stubbed.
//   stage 1  /api/usgs?set=<name> (our own function, same origin)
//   stage 2  USGS's new service called directly, keyless (two parallel calls for `main`)
//   then     the localStorage copy, then the UNAVAILABLE state
// The app is esbuild-bundled at test time (same approach as test/data-freshness.test.mjs).
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { build } from 'esbuild';
import { toNewShape, paramOf } from './helpers/usgs-new-shape.mjs';
import { directSet, functionUrl, PAGE_TIMERS, fetchFromFunction, fetchFromDirect, fetchOldShape } from '../src/data/usgs-source.js';
import { buildContinuousUrl } from '../src/data/usgs-adapter.js';
import { CACHE_KEY, CREEK_RUNS, EDWARDS_FERRY, GAUGES } from '../src/model/constants.js';
import { runtimeCaching } from '../config/runtime-caching.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 60000;
const LF = '01646500', POR = '01638500';
const iso = (ms) => new Date(ms).toISOString();
const pt = (ms, value) => ({ value: String(value), qualifiers: ['P'], dateTime: iso(ms) });
const series = (site, vals, param = '00060') => ({ sourceInfo: { siteCode: [{ value: site }] }, variable: { variableCode: [{ value: param }] }, values: [{ value: vals }] });
const body = (notes, ...ts) => ({ value: { queryInfo: { note: notes }, timeSeries: ts } });
const reqNote = (ms) => [{ value: iso(ms), title: 'requestDT' }];
// main-shaped answer: both headline gauges report `readingAgoMin` minutes ago; body time `bodyAgoMin` ago (null: no requestDT)
const mk = (readingAgoMin, bodyAgoMin) => {
    const t = Date.now() - readingAgoMin * MIN;
    const ts = [series(LF, [pt(t, 5000)]), series(POR, [pt(t, 4000)])];
    return bodyAgoMin === null ? body(undefined, ...ts) : body(reqNote(Date.now() - bodyAgoMin * MIN), ...ts);
};
const D2 = 'https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items?';
const isDirect = (u) => u.startsWith(D2);
const res = (b, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => b });
const html404 = () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError('Unexpected token <'); } });
const htmlOk = () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });

// ------------------------------------------------------------------ the helper on its own
describe('usgs-source helper: stage definitions come from the app constants', () => {
    it('1. direct set definitions use GAUGES, CREEK_RUNS, EDWARDS_FERRY.id and the temperature gauge', () => {
        assert.deepEqual(directSet('main'), { sites: Object.keys(GAUGES), params: ['00060', '00065'], period: 'P7D' });
        assert.deepEqual(directSet('creeks'), { sites: Object.keys(CREEK_RUNS), params: ['00060'], period: 'P1D' });
        assert.deepEqual(directSet('ef'), { sites: [EDWARDS_FERRY.id], params: ['00065'], period: 'P1D' });
        assert.deepEqual(directSet('temp'), { sites: ['01638500'], params: ['00010'], period: 'P1D' });
        assert.equal(directSet('nope'), null);
    });

    it('2. the function address is the exact string, and the page timers are 8 s (main) and 7 s (others)', () => {
        for (const n of ['main', 'creeks', 'ef', 'temp']) assert.equal(functionUrl(n), `/api/usgs?set=${n}`);
        assert.deepEqual({ ...PAGE_TIMERS }, { main: 8000, creeks: 7000, ef: 7000, temp: 7000 });
    });

    it('3. the source file has no literal gauge lists: the sites in it come from the constants', () => {
        const src = readFileSync(resolve(root, 'src/data/usgs-source.js'), 'utf8');
        const lits = src.match(/'\d{8}'/g) || [];
        assert.deepEqual(lits, ["'01638500'"], 'only the temperature gauge may be a literal');
    });
});

describe('usgs-source helper: stage behaviour', () => {
    const saved = {};
    const setGlobal = (k, v) => { if (!(k in saved)) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k) ?? null; Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); };
    afterEach(() => { for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; delete saved[k]; } });
    const quiet = () => { setGlobal('console', { ...console, log() {}, warn() {} }); };
    const newShapeAnswer = (param, stamp) => toNewShape(mk(40, 1), { param, timeStamp: stamp });

    it('4. stage 1 requests exactly /api/usgs?set=<name>; no key, no custom headers (only the abort signal)', async () => {
        const calls = [];
        setGlobal('fetch', async (u, o) => { calls.push([u, o]); return res(mk(10, 0)); });
        const j = await fetchFromFunction('main');
        assert.equal(calls.length, 1);
        assert.equal(calls[0][0], '/api/usgs?set=main');
        assert.deepEqual(Object.keys(calls[0][1]), ['signal']);
        assert.ok(j.value.timeSeries.length);
    });

    it('5. stage 1 failures: non-OK status, non-JSON body, no value.timeSeries, 404 page', async () => {
        for (const r of [res({}, 503), res({}, 400), res({}, 504), res({ error: 'x' }), res({ value: {} }), res({ value: { timeSeries: 'x' } }), res(null), htmlOk(), html404()]) {
            setGlobal('fetch', async () => r);
            await assert.rejects(fetchFromFunction('creeks'));
        }
    });

    it('6. stage 1 timer: a request that outlives the page timer is aborted and fails', async () => {
        setGlobal('fetch', (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))));
        await assert.rejects(fetchFromFunction('ef', { timeoutMs: 20 }), /timed out after 20ms/);
    });

    it('7. stage 2 for the small sets: one call, address from the browser adapter, no custom headers, converted to the old structure', async () => {
        for (const [name, site, param] of [['creeks', Object.keys(CREEK_RUNS)[0], '00060'], ['ef', EDWARDS_FERRY.id, '00065'], ['temp', '01638500', '00010']]) {
            const calls = [];
            setGlobal('fetch', async (u, o) => {
                calls.push([String(u), o]);
                return res(toNewShape(body(reqNote(Date.now() - 5000), series(site, [pt(Date.now() - 60000, 3.2)], param))));
            });
            const j = await fetchFromDirect(name);
            assert.equal(calls.length, 1, name);
            assert.equal(calls[0][0], buildContinuousUrl(directSet(name)));
            assert.match(calls[0][0], /time=P1D/);
            assert.ok(!/key/i.test(calls[0][0]));
            assert.deepEqual(Object.keys(calls[0][1]), ['signal']);
            assert.equal(j.value.timeSeries[0].sourceInfo.siteCode[0].value, site);
            assert.equal(j.value.timeSeries[0].values[0].value[0].value, '3.2');
        }
    });

    it('8. stage 2 for main: exactly two parallel calls (flow, stage), time=P7D, merged, the OLDER timeStamp is requestDT', async () => {
        const calls = [];
        const older = iso(Date.now() - 140000), newer = iso(Date.now() - 20000);
        const t = Date.now() - 600000;
        const flowBody = toNewShape(body(null, series(LF, [pt(t, 5000)], '00060'), series(POR, [pt(t, 4000)], '00060')), { timeStamp: newer });
        const stageBody = toNewShape(body(null, series(LF, [pt(t, 3.1)], '00065')), { timeStamp: older });
        setGlobal('fetch', async (u) => { calls.push(String(u)); return res(paramOf(u) === '00060' ? flowBody : stageBody); });
        const j = await fetchFromDirect('main');
        assert.equal(calls.length, 2);
        assert.deepEqual(calls.map(paramOf).sort(), ['00060', '00065']);
        for (const u of calls) { assert.match(u, /time=P7D/); assert.ok(u.startsWith(D2)); }
        assert.equal(j.value.queryInfo.note[0].value, older);
        assert.deepEqual([...new Set(j.value.timeSeries.map((s) => s.variable.variableCode[0].value))].sort(), ['00060', '00065']);
        // the same merge in the other order
        setGlobal('fetch', async (u) => res(paramOf(u) === '00060' ? stageBody : flowBody));
        assert.equal((await fetchFromDirect('main')).value.queryInfo.note[0].value, older);
    });

    it('9. stage 2 failures are final: 429, any status, network error, timeout, paged, malformed; never retried', async () => {
        for (const [name, answer] of [
            ['429', () => res({}, 429)], ['500', () => res({}, 500)], ['network', () => { throw new TypeError('Failed to fetch'); }],
            ['paged', () => res({ features: [], links: [{ rel: 'next', href: 'x' }], timeStamp: iso(Date.now()) })],
            ['no features', () => res({ error: 'x' })], ['not json', () => htmlOk()]
        ]) {
            let n = 0;
            setGlobal('fetch', async () => { n++; return answer(); });
            await assert.rejects(fetchFromDirect('creeks'), undefined, name);
            assert.equal(n, 1, `${name}: one call, no retry`);
            n = 0;
            await assert.rejects(fetchFromDirect('main'), undefined, name);
            assert.equal(n, 2, `${name}: main is two calls and no more`);
        }
    });

    it('10. main stage 2: one failing call fails the stage and aborts its sibling', async () => {
        let siblingAborted = false;
        setGlobal('fetch', (u, o) => {
            if (paramOf(u) === '00060') return Promise.resolve(res({}, 429));
            return new Promise((_, rej) => o.signal.addEventListener('abort', () => { siblingAborted = true; rej(Object.assign(new Error('x'), { name: 'AbortError' })); }));
        });
        await assert.rejects(fetchFromDirect('main', { timeoutMs: 5000 }), /HTTP 429/);
        assert.equal(siblingAborted, true);
    });

    it('11. stage 2 timer: aborts a slow call', async () => {
        setGlobal('fetch', (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))));
        await assert.rejects(fetchFromDirect('temp', { timeoutMs: 20 }), /timed out after 20ms/);
    });

    it('12a. main guard: an empty, headless or reading-less main answer fails stage 1 and stage 2; small sets are not guarded', async () => {
        const t = Date.now() - 600000;
        const mkMain = (...ts) => body(reqNote(Date.now()), ...ts);
        const bad = {
            'empty timeSeries': mkMain(),
            'Little Falls flow missing': mkMain(series(POR, [pt(t, 4000)])),
            'Point of Rocks flow missing': mkMain(series(LF, [pt(t, 5000)])),
            'both gauges only as stage': mkMain(series(LF, [pt(t, 3)], '00065'), series(POR, [pt(t, 3)], '00065')),
            'series present, zero readings': mkMain(series(LF, []), series(POR, [pt(t, 4000)])),
            'series present, no values block': mkMain({ ...series(LF, []), values: [] }, series(POR, [pt(t, 4000)])),
            'another gauge only': mkMain(series('01643000', [pt(t, 800)]))
        };
        for (const [name, b] of Object.entries(bad)) {
            setGlobal('fetch', async () => res(b));
            await assert.rejects(fetchFromFunction('main'), /Little Falls|Point of Rocks/, `stage 1: ${name}`);
            setGlobal('fetch', async (u) => res(toNewShape(b, { param: paramOf(u) })));
            await assert.rejects(fetchFromDirect('main'), undefined, `stage 2: ${name}`);
        }
        setGlobal('fetch', async () => res({ type: 'FeatureCollection', features: [], links: [], timeStamp: iso(Date.now()) }));
        await assert.rejects(fetchFromDirect('main'), undefined, 'stage 2: features []');
        // the good answer still passes on both stages
        setGlobal('fetch', async () => res(mk(10, 0)));
        assert.ok((await fetchFromFunction('main')).value.timeSeries.length);
        setGlobal('fetch', async (u) => res(toNewShape(mk(10, 0), { param: paramOf(u) })));
        assert.ok((await fetchFromDirect('main')).value.timeSeries.length);
        // small sets: an empty answer is legitimate and passes through unchanged
        for (const name of ['creeks', 'ef', 'temp']) {
            setGlobal('fetch', async () => res(mkMain()));
            assert.deepEqual((await fetchFromFunction(name)).value.timeSeries, [], name);
            setGlobal('fetch', async () => res({ type: 'FeatureCollection', features: [], links: [], timeStamp: iso(Date.now()) }));
            assert.deepEqual((await fetchFromDirect(name)).value.timeSeries, [], name);
        }
    });

    it('12. fetchOldShape: stage 1 first, then stage 2, then null; says which stage answered', async () => {
        quiet();
        const seen = [];
        setGlobal('fetch', async (u) => { seen.push(String(u)); return String(u).startsWith('/api/usgs') ? res(mk(10, 0)) : res({}, 500); });
        let r = await fetchOldShape('creeks');
        assert.equal(r.stage, 'function');
        assert.deepEqual(seen, ['/api/usgs?set=creeks']);
        seen.length = 0;
        setGlobal('fetch', async (u) => { seen.push(String(u)); return String(u).startsWith('/api/usgs') ? res({}, 503) : res(newShapeAnswer(null, iso(Date.now()))); });
        r = await fetchOldShape('creeks');
        assert.equal(r.stage, 'direct');
        assert.equal(seen.length, 2);
        assert.ok(isDirect(seen[1]));
        setGlobal('fetch', async () => res({}, 503));
        assert.equal(await fetchOldShape('creeks'), null);
    });
});

// ------------------------------------------------------------------ the app: fetchData and the small requests
describe('app chain through fetchData and the small requests (stubbed fetch)', () => {
    let F;
    const els = {}; const timers = []; const saved = {};
    const setGlobal = (k, v) => { if (!(k in saved)) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k) ?? null; Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); };
    const el = (id) => (els[id] ??= { style: {}, classList: { add() {}, remove() {} }, textContent: '', className: '', title: '' });
    const realLog = console.log, realWarn = console.warn;
    let calls; // [{url, opts}]
    let route; // (url, opts) => response | Promise

    before(async () => {
        if (!globalThis.localStorage) {
            const m = new Map();
            globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, clear: () => m.clear() };
        }
        const entry = [
            `export { fetchData, fetchCreekData } from ${JSON.stringify(resolve(root, 'src/data/fetch.js'))};`,
            `export { fetchEdwardsFerry, fetchWaterTemp } from ${JSON.stringify(resolve(root, 'src/estimation/edwards-ferry.js'))};`,
            `export { clearChainMemo } from ${JSON.stringify(resolve(root, 'src/ui/data-freshness.js'))};`,
            `export * as store from ${JSON.stringify(resolve(root, 'src/state/store.js'))};`
        ].join('\n');
        const out = await build({ stdin: { contents: entry, resolveDir: root, sourcefile: 'chain-entry.mjs', loader: 'js' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
        F = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
    });

    beforeEach(() => {
        console.log = () => {}; console.warn = () => {};
        calls = []; timers.length = 0;
        for (const k of Object.keys(els)) delete els[k];
        globalThis.localStorage.clear();
        setGlobal('document', { getElementById: el });
        setGlobal('navigator', { get onLine() { return true; } });
        setGlobal('setTimeout', (fn, ms) => { timers.push({ fn, ms }); return timers.length; });
        setGlobal('clearTimeout', () => {});
        setGlobal('fetch', async (u, opts) => { calls.push({ url: String(u), opts }); return route(String(u), opts); });
        const s = F.store;
        s.setIsFetching(false); s.setLastReading(null); s.setLastFetchTime(null); s.setDataSource(null); s.setData({});
        s.edwardsFerryData.current = null; s.edwardsFerryData.history = [];
        s.setWaterTempC(null);
        for (const k of Object.keys(s.creekData)) delete s.creekData[k];
        F.clearChainMemo();
    });
    afterEach(async () => {
        for (const t of timers.filter((x) => x.ms === 60000)) t.fn();
        for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
        console.log = realLog; console.warn = realWarn;
        for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; delete saved[k]; }
    });

    // route builder: fn(set) answers stage 1; direct(set, param, url) answers stage 2; both default to "fails" (503 / 500)
    const routes = ({ fn = () => res({}, 503), direct = () => res({}, 500) } = {}) => (url, opts) => {
        if (url.startsWith('/api/usgs?set=')) return fn(url.slice('/api/usgs?set='.length), opts);
        if (isDirect(url)) {
            const set = url.includes('time=P7D') ? 'main' : url.includes('parameter_code=00010') ? 'temp' : url.includes('USGS-01644148') ? 'ef' : 'creeks';
            return direct(set, paramOf(url), url);
        }
        return res({}, 404); // NWS and anything else
    };
    const mainCalls1 = () => calls.filter((c) => c.url === '/api/usgs?set=main').length;
    const mainCalls2 = () => calls.filter((c) => isDirect(c.url) && c.url.includes('time=P7D')).length;
    const direct = (b) => (set, param) => res(toNewShape(b, { param }));
    const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
    const seedCache = (b, ageMs = 5 * MIN) => localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now() - ageMs, data: b }));

    it('13. function answers: one stage 1 call, no stage 2 call for main, source live, page timer 8 s for main and 7 s for the small sets', async () => {
        route = routes({ fn: () => res(mk(10, 0)) });
        await F.fetchData();
        assert.equal(mainCalls1(), 1);
        assert.equal(mainCalls2(), 0);
        assert.equal(F.store.dataSource, 'live');
        assert.ok(F.store.lastReading.ms > Date.now() - 20 * MIN);
        const stage1Timers = timers.filter((t) => t.ms === 8000 || t.ms === 6000).map((t) => t.ms).sort();
        assert.ok(stage1Timers.includes(8000), 'a main page timer of 8000 ms was set');
        assert.equal(timers.filter((t) => t.ms === 7000).length, 3, 'creeks, ef and temp each set a 7000 ms timer');
        assert.deepEqual(JSON.parse(localStorage.getItem(CACHE_KEY)).data.value.timeSeries.length, 2, 'the saved copy is written as before');
    });

    it('14. function 503: stage 2 answers, source live, exactly two direct main calls (one per parameter)', async () => {
        route = routes({ fn: () => res({}, 503), direct: direct(mk(10, 0)) });
        await F.fetchData();
        assert.equal(mainCalls1(), 1);
        assert.equal(mainCalls2(), 2);
        assert.deepEqual(calls.filter((c) => isDirect(c.url) && c.url.includes('time=P7D')).map((c) => paramOf(c.url)).sort(), ['00060', '00065']);
        assert.equal(F.store.dataSource, 'live');
        assert.ok(F.store.lastReading.ms > Date.now() - 20 * MIN);
    });

    it('15. function timeout (the 8000 ms page timer fires): stage 2 answers', async () => {
        route = routes({
            fn: (set, o) => (set === 'main' ? new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) : res({}, 503)),
            direct: direct(mk(10, 0))
        });
        const p = F.fetchData();
        await tick();
        const t = timers.find((x) => x.ms === 8000);
        assert.ok(t, 'main page timer 8000 ms');
        t.fn();
        await p;
        assert.equal(mainCalls2(), 2);
        assert.equal(F.store.dataSource, 'live');
    });

    it('16. function answers with a 404 page, or a 200 that is not JSON: stage 2 answers', async () => {
        for (const bad of [html404, htmlOk]) {
            calls = [];
            route = routes({ fn: (set) => (set === 'main' ? bad() : res({}, 503)), direct: direct(mk(10, 0)) });
            F.store.setIsFetching(false);
            await F.fetchData();
            assert.equal(mainCalls2(), 2);
            assert.equal(F.store.dataSource, 'live');
        }
    });

    it('17. function and direct both fail: the localStorage copy is shown, source cached', async () => {
        seedCache(mk(20, 1));
        route = routes();
        await F.fetchData();
        assert.equal(mainCalls1(), 1);
        assert.equal(mainCalls2(), 2);
        assert.equal(F.store.dataSource, 'cached');
    });

    it('18. all three fail: unavailable', async () => {
        route = routes();
        await F.fetchData();
        assert.equal(F.store.dataSource, 'unavailable');
        assert.equal(F.store.lastReading, null);
    });

    it('19. a saved-copy body from stage 1 (old readings, old body) still triggers stage 2, and the newer stage 2 payload wins', async () => {
        route = routes({ fn: () => res(mk(300, 45)), direct: direct(mk(30, 0)) });
        await F.fetchData();
        assert.equal(mainCalls1(), 1);
        assert.equal(mainCalls2(), 2);
        assert.ok(Date.now() - F.store.lastReading.ms < 60 * MIN, 'the direct answer is shown');
        assert.equal(F.store.dataSource, 'live');
    });

    it('20. a live-behind body from stage 1 (old readings, body seconds old) is accepted at once, no stage 2', async () => {
        route = routes({ fn: () => res(mk(300, 1)) });
        await F.fetchData();
        assert.equal(mainCalls2(), 0);
        assert.equal(F.store.dataSource, 'live');
    });

    it('21. direct 429 is not retried: main makes exactly two direct calls even when both answer 429', async () => {
        route = routes({ direct: () => res({}, 429) });
        await F.fetchData();
        assert.equal(mainCalls2(), 2);
        assert.equal(F.store.dataSource, 'unavailable');
        // the small sets: one direct call each, no retry
        assert.equal(calls.filter((c) => isDirect(c.url) && !c.url.includes('time=P7D')).length, 3, 'one direct call per small set');
    });

    it('21a. an empty main answer from stage 1 is not accepted as live: stage 2 is used', async () => {
        route = routes({ fn: () => res(body(reqNote(Date.now()))), direct: direct(mk(10, 0)) });
        await F.fetchData();
        assert.equal(mainCalls2(), 2);
        assert.ok(F.store.lastReading.ms > Date.now() - 20 * MIN);
        assert.equal(F.store.dataSource, 'live');
    });

    it('21b. both stages empty: the localStorage copy is kept, NOT overwritten, and shown as cached', async () => {
        const saved0 = mk(20, 1);
        seedCache(saved0);
        const before = localStorage.getItem(CACHE_KEY);
        route = routes({ fn: () => res(body(reqNote(Date.now()))), direct: () => res({ type: 'FeatureCollection', features: [], links: [], timeStamp: iso(Date.now()) }) });
        await F.fetchData();
        assert.equal(localStorage.getItem(CACHE_KEY), before, 'the saved copy must not change');
        assert.equal(F.store.dataSource, 'cached');
        assert.ok(F.store.lastReading.ms < Date.now() - 15 * MIN);
    });

    it('21c. both stages empty and no saved copy: unavailable, nothing saved', async () => {
        route = routes({ fn: () => res(body(reqNote(Date.now()))), direct: () => res({ type: 'FeatureCollection', features: [], links: [], timeStamp: iso(Date.now()) }) });
        await F.fetchData();
        assert.equal(F.store.dataSource, 'unavailable');
        assert.equal(localStorage.getItem(CACHE_KEY), null);
    });

    it('21d. small sets: an empty answer from stage 1 is passed through (no walk to stage 2)', async () => {
        route = routes({ fn: () => res(body(reqNote(Date.now()))) });
        await Promise.all([F.fetchCreekData(), F.fetchEdwardsFerry(), F.fetchWaterTemp()]);
        assert.equal(calls.filter((c) => isDirect(c.url)).length, 0);
        assert.equal(F.store.waterTempC, null);
    });

    it('22. main direct: the OLDER of the two timeStamps becomes the body time the freshness rule sees', async () => {
        const older = Date.now() - 200 * 1000, newer = Date.now() - 5 * 1000;
        const t = Date.now() - 300 * MIN; // old readings, so the body time decides
        const b = body(null, series(LF, [pt(t, 5000)], '00060'), series(POR, [pt(t, 4000)], '00060'));
        route = routes({ direct: (set, param) => res(toNewShape(b, { param, timeStamp: iso(param === '00060' ? newer : older) })) });
        await F.fetchData();
        assert.equal(F.store.lastReading.bodyMs, Date.parse(iso(older)));
    });

    it('23. creeks, Edwards Ferry and temperature through stage 1', async () => {
        const site = Object.keys(CREEK_RUNS)[0];
        const now = Date.now();
        const vals = Array.from({ length: 10 }, (_, i) => pt(now - (9 - i) * 15 * 60000, 100 + i));
        route = routes({
            fn: (set) => ({
                creeks: res(body(reqNote(now), series(site, vals))),
                ef: res(body(reqNote(now), series(EDWARDS_FERRY.id, [pt(now - 600000, 4.25)], '00065'))),
                temp: res(body(reqNote(now), series('01638500', [pt(now - 300000, 11.5)], '00010')))
            }[set] ?? res({}, 404))
        });
        await Promise.all([F.fetchCreekData(), F.fetchEdwardsFerry(), F.fetchWaterTemp()]);
        assert.deepEqual(calls.map((c) => c.url).sort(), ['/api/usgs?set=creeks', '/api/usgs?set=ef', '/api/usgs?set=temp']);
        assert.equal(F.store.creekData[site].q, 109);
        assert.equal(F.store.edwardsFerryData.current.stage, 4.25);
        assert.equal(F.store.waterTempC, 11.5);
    });

    it('24. creeks, Edwards Ferry and temperature through stage 2 when the function fails', async () => {
        const site = Object.keys(CREEK_RUNS)[0];
        const now = Date.now();
        const vals = Array.from({ length: 10 }, (_, i) => pt(now - (9 - i) * 15 * 60000, 100 + i));
        const answers = {
            creeks: body(reqNote(now), series(site, vals)),
            ef: body(reqNote(now), series(EDWARDS_FERRY.id, [pt(now - 600000, 4.25)], '00065')),
            temp: body(reqNote(now), series('01638500', [pt(now - 300000, 11.5)], '00010'))
        };
        route = routes({ fn: () => res({}, 503), direct: (set) => res(toNewShape(answers[set])) });
        await Promise.all([F.fetchCreekData(), F.fetchEdwardsFerry(), F.fetchWaterTemp()]);
        const d = calls.filter((c) => isDirect(c.url)).map((c) => c.url);
        assert.equal(d.length, 3);
        assert.ok(d.every((u) => u.includes('time=P1D')));
        assert.equal(F.store.creekData[site].q, 109);
        assert.equal(F.store.edwardsFerryData.current.stage, 4.25);
        assert.equal(F.store.waterTempC, 11.5);
    });

    it('25. small requests with both stages failing leave the data as it was and do not throw', async () => {
        route = routes();
        await Promise.all([F.fetchCreekData(), F.fetchEdwardsFerry(), F.fetchWaterTemp()]);
        assert.equal(F.store.edwardsFerryData.current, null);
        assert.equal(F.store.waterTempC, null);
        assert.deepEqual(F.store.creekData, {});
    });

    it('26. no request in any chain scenario goes to the old host or a relay', async () => {
        const all = [];
        const wrap = (r) => (u, o) => { all.push(u); return r(u, o); };
        for (const r of [routes({ fn: () => res(mk(10, 0)) }), routes({ direct: direct(mk(10, 0)) }), routes()]) {
            calls = [];
            route = wrap(r);
            F.store.setIsFetching(false);
            await F.fetchData();
        }
        assert.ok(all.length > 8);
        for (const u of all) assert.doesNotMatch(u, /waterservices\.usgs\.gov|allorigins|corsproxy/, u);
    });
});

// ------------------------------------------------------------------ stage 2 still goes through validateUSGSResponse
describe('stage 2 body validation (re-audit finding 4)', () => {
    let G;
    const saved = {};
    const setGlobal = (k, v) => { if (!(k in saved)) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k) ?? null; Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); };
    const el = () => ({ style: {}, classList: { add() {}, remove() {} }, textContent: '', className: '', title: '' });
    before(async () => {
        if (!globalThis.localStorage) {
            const m = new Map();
            globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, clear: () => m.clear() };
        }
        // The browser adapter is replaced by a stub whose conversion yields a structurally invalid old-shape body:
        // fresh Little Falls and Point of Rocks flow (so the main guard passes) plus one series without a variable code.
        const stubAdapter = {
            name: 'stub-adapter',
            setup(b) {
                b.onResolve({ filter: /usgs-adapter(\.js)?$/ }, () => ({ path: 'stub-adapter', namespace: 'stub-ad' }));
                b.onLoad({ filter: /.*/, namespace: 'stub-ad' }, () => ({
                    loader: 'js',
                    contents: `export const buildContinuousUrl = () => 'https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items?f=json&time=P7D&parameter_code=00060';
export const toLegacyIv = () => { const t = new Date(Date.now() - 600000).toISOString(); const v = [{ value: '5000', qualifiers: ['P'], dateTime: t }];
  const ts = (site, extra = {}) => ({ sourceInfo: { siteCode: [{ value: site }] }, variable: { variableCode: [{ value: '00060' }] }, values: [{ value: v }], ...extra });
  return { value: { queryInfo: { note: [{ title: 'requestDT', value: new Date().toISOString() }] }, timeSeries: [ts('01646500'), ts('01638500'), { sourceInfo: { siteCode: [{ value: '01643000' }] }, variable: {}, values: [{ value: v }] }] } }; };`
                }));
            }
        };
        const entry = [
            `export { fetchData } from ${JSON.stringify(resolve(root, 'src/data/fetch.js'))};`,
            `export * as store from ${JSON.stringify(resolve(root, 'src/state/store.js'))};`
        ].join('\n');
        const out = await build({ stdin: { contents: entry, resolveDir: root, sourcefile: 'val-entry.mjs', loader: 'js' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', plugins: [stubAdapter] });
        G = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
    });
    afterEach(() => { for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; delete saved[k]; } });

    it('33. a structurally invalid stage 2 body is rejected: nothing shown as live, nothing saved', async () => {
        const realLog = console.log, realWarn = console.warn;
        console.log = () => {}; console.warn = () => {};
        try {
            globalThis.localStorage.clear();
            setGlobal('document', { getElementById: el });
            setGlobal('navigator', { get onLine() { return true; } });
            setGlobal('setTimeout', () => 1);
            setGlobal('clearTimeout', () => {});
            setGlobal('fetch', async (u) => (String(u).startsWith('https://api.waterdata.usgs.gov/') && String(u).includes('time=P7D')
                ? { ok: true, status: 200, json: async () => ({ features: [], links: [], timeStamp: new Date().toISOString() }) }
                : { ok: false, status: 503, json: async () => ({}) }));
            G.store.setIsFetching(false); G.store.setLastReading(null); G.store.setLastFetchTime(null); G.store.setDataSource(null); G.store.setData({});
            await G.fetchData();
            assert.equal(G.store.dataSource, 'unavailable');
            assert.equal(localStorage.getItem(CACHE_KEY), null);
        } finally { console.log = realLog; console.warn = realWarn; }
    });
});

// ------------------------------------------------------------------ nothing of the old address is left
describe('no trace of the old service or the relays in the app', () => {
    const walk = (dir, out = []) => {
        for (const f of readdirSync(dir)) {
            const p = join(dir, f);
            if (statSync(p).isDirectory()) { if (p !== resolve(root, 'src/assets')) walk(p, out); } else out.push(p);
        }
        return out;
    };
    const BAD = ['waterservices.usgs.gov', 'allorigins', 'corsproxy'];

    it('27. no file under src/ (excluding src/assets/ documents) names the old host or a relay', () => {
        const files = walk(resolve(root, 'src'));
        assert.ok(files.length > 20);
        for (const f of files) {
            const t = readFileSync(f, 'utf8');
            for (const bad of BAD) assert.ok(!t.includes(bad), `${f.slice(root.length + 1)} contains ${bad}`);
        }
    });

    it('28. no service worker rule (config) names the old host or a relay', () => {
        const text = runtimeCaching.map((r) => String(r.urlPattern)).join('\n') + readFileSync(resolve(root, 'config/runtime-caching.mjs'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
        for (const bad of BAD) assert.ok(!text.includes(bad), bad);
    });

    it('29. no relay list is left in fetch.js', () => {
        const f = readFileSync(resolve(root, 'src/data/fetch.js'), 'utf8');
        assert.doesNotMatch(f, /PROXIES_LIST|for \(const p of/);
    });
});

describe('security policy (netlify.toml)', () => {
    const toml = readFileSync(resolve(root, 'netlify.toml'), 'utf8');
    const csp = toml.match(/Content-Security-Policy = "([^"]+)"/)[1];
    const connect = csp.split(';').map((s) => s.trim()).find((d) => d.startsWith('connect-src '));

    it('30. connect-src is exactly the new list', () => {
        assert.equal(connect, "connect-src 'self' https://api.waterdata.usgs.gov https://api.water.noaa.gov https://*.supabase.co https://potomacpulse.goatcounter.com https://*.ingest.sentry.io");
    });

    it('31. the old host and both relays are gone from the whole file; the new host is allowed', () => {
        for (const bad of ['waterservices.usgs.gov', 'corsproxy.io', 'api.allorigins.win']) assert.ok(!toml.includes(bad), bad);
        assert.ok(connect.includes('https://api.waterdata.usgs.gov'));
    });

    it('32. /api/usgs is served by the function itself (config.path), so netlify.toml has no redirect for it', () => {
        assert.doesNotMatch(toml, /from = "\/api\/usgs"/);
        assert.match(readFileSync(resolve(root, 'netlify/functions/usgs-proxy.mjs'), 'utf8'), /path: '\/api\/usgs'/);
    });
});

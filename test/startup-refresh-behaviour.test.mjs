// v39.7: card state, retry button and deferred resume, through the real fetchData and updateGreatFallsUI
// with a fake browser (same approach as test/data-freshness.test.mjs).
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const MIN = 60000;
const LF = '01646500', POR = '01638500';
const realLog = console.log, realWarn = console.warn;

let B; // bundle
before(async () => {
    if (!globalThis.localStorage) {
        const m = new Map();
        globalThis.localStorage = {
            getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
            removeItem: (k) => { m.delete(k); }, clear: () => m.clear()
        };
    }
    const q = (p) => JSON.stringify(resolve(root, p));
    const entry = [
        `export { fetchData, setStatus } from ${q('src/data/fetch.js')};`,
        `export { updateGreatFallsUI } from ${q('src/ui/great-falls-ui.js')};`,
        `export { createRefresher, maybeResume, onResumeFetchSettled, onLearningLoaded, onFetchSettled, clearLearningMissed } from ${q('src/data/refresh.js')};`,
        `export { on, clear } from ${q('src/state/event-bus.js')};`,
        `export { clearChainMemo } from ${q('src/ui/data-freshness.js')};`,
        `export * as store from ${q('src/state/store.js')};`
    ].join('\n');
    const out = await build({
        stdin: { contents: entry, resolveDir: root, sourcefile: 'behaviour-entry.mjs', loader: 'js' },
        bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent'
    });
    B = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
});

// ---- fake browser ----
const els = {};
const timers = [];
const saved = {};
const setGlobal = (k, v) => {
    if (!(k in saved)) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k) ?? null;
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
};
const el = (id) => (els[id] ??= {
    id, style: {}, hidden: false, disabled: false, classList: { add() {}, remove() {}, toggle() {} },
    textContent: '', className: '', title: '', innerHTML: '', children: [], dataset: {},
    clientWidth: 300, parentElement: { clientWidth: 300 }, getBoundingClientRect: () => ({ left: 0, width: 300, top: 0, height: 100 }),
    appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => []
});
const iso = (ms) => new Date(ms).toISOString();
const pt = (ms, value, quals = ['P']) => ({ value: String(value), qualifiers: quals, dateTime: iso(ms) });
const series = (site, vals, param = '00060') => ({
    sourceInfo: { siteCode: [{ value: site }] }, variable: { variableCode: [{ value: param }] }, values: [{ value: vals }]
});
const fresh = (body = Date.now()) => {
    const t = Date.now() - 5 * MIN;
    return { value: { queryInfo: { note: [{ value: iso(body), title: 'requestDT' }] }, timeSeries: [series(LF, [pt(t, 5000)]), series(POR, [pt(t, 4000)])] } };
};
const iceBody = () => {
    const t = Date.now() - 5 * MIN;
    return { value: { queryInfo: { note: [{ value: iso(Date.now()), title: 'requestDT' }] }, timeSeries: [
        series(LF, [pt(t, -999999, ['Ice'])]), series(POR, [pt(t, -999999, ['Ice'])])] } };
};
const efBody = () => ({ value: { timeSeries: [{ values: [{ value: [pt(Date.now() - 5 * MIN, 5.2)] }] }] } });
const ok = (b) => ({ ok: true, json: async () => b });
const no = () => ({ ok: false, json: async () => ({}) });
let net; // { main, ef }
let mainCalls;
const tickN = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

beforeEach(() => {
    console.log = () => {}; console.warn = () => {};
    timers.length = 0; mainCalls = 0;
    for (const k of Object.keys(els)) delete els[k];
    globalThis.localStorage.clear();
    setGlobal('document', { getElementById: el, visibilityState: 'visible', querySelectorAll: () => [], querySelector: () => null, createElement: () => el('__created' + Math.random()), body: el('__body') });
    setGlobal('navigator', { onLine: true });
    setGlobal('setTimeout', (fn, ms) => { timers.push({ fn, ms }); return timers.length; });
    setGlobal('clearTimeout', () => {});
    setGlobal('fetch', async (u) => {
        const url = String(u);
        if (url.startsWith('https://waterservices.usgs.gov/') && url.includes('P7D')) { mainCalls++; return net.main ? ok(net.main()) : no(); }
        if (url.includes('01644148')) return net.ef ? ok(efBody()) : no();
        return no();
    });
    B.clear();
    B.clearLearningMissed();
    B.clearChainMemo();
    const s = B.store;
    s.setIsFetching(false); s.setLastReading(null); s.setLastFetchTime(null); s.setFetchSettled(false);
    s.setLastAttemptMs(null); s.setGfDataReady(true); s.setGfEstimate(null);
    s.setGfLearningData({ correctionBins: {}, pendingPredictions: [], metadata: {}, efCorrelation: null });
    s.edwardsFerryData.current = null; s.edwardsFerryData.history = [];
    s.setPorHistory([]);
    s.setData({});
});
afterEach(async () => {
    for (const t of timers.filter((x) => x.ms === 60000)) t.fn(); // let a pending early refetch run out
    await tickN(20);
    await new Promise((r) => realSetTimeoutShim(r, 20));
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; delete saved[k]; }
    console.log = realLog; console.warn = realWarn;
});
const realSetTimeoutShim = (fn, ms) => setImmediate(fn); // timers are stubbed during the test; afterEach restores them first

const labelOf = () => el('gf-estimate-label').textContent;
const trendOf = () => el('gf-trend').textContent;

describe('card state through fetchData (PA-1)', () => {
    it('Edwards Ferry fails, USGS succeeds: after one fetchData the card is unavailable, with no further event', async () => {
        net = { main: () => fresh(), ef: false };
        B.on('data:updated', B.updateGreatFallsUI); // the only render trigger; no nws:arrived, no fetch:settled
        await B.fetchData();
        assert.equal(B.store.fetchSettled, true);
        assert.equal(labelOf(), 'UNAVAILABLE');
        assert.equal(trendOf(), 'Edwards Ferry data did not load.');
        assert.equal(el('gf-cfs').textContent, '--');
        assert.equal(el('gfRetryBtn').hidden, false);
    });
    it('USGS down with no cache: unavailable with the USGS reason after one fetchData', async () => {
        net = { main: null, ef: false };
        B.on('data:unavailable', B.updateGreatFallsUI);
        await B.fetchData();
        assert.equal(B.store.dataSource, 'unavailable');
        assert.equal(labelOf(), 'UNAVAILABLE');
        assert.equal(trendOf(), 'USGS data did not load.');
        assert.equal(el('gfRetryBtn').hidden, false);
    });
    it('USGS down, Edwards Ferry fine: still the USGS reason (no estimate to show)', async () => {
        net = { main: null, ef: true };
        B.on('data:unavailable', B.updateGreatFallsUI);
        await B.fetchData();
        assert.equal(trendOf(), 'USGS data did not load.');
        assert.equal(el('gfRetryBtn').hidden, false);
    });
    it('before any fetch has settled the card only says loading, never unavailable', () => {
        B.updateGreatFallsUI();
        assert.equal(el('gf-cfs').textContent, '...');
        assert.notEqual(labelOf(), 'UNAVAILABLE');
        assert.equal(el('gfRetryBtn').hidden, true);
    });
    it('fetch:settled is emitted once per fetchData, after isFetching is false', async () => {
        net = { main: () => fresh(), ef: true };
        const seen = [];
        B.on('fetch:settled', () => seen.push(B.store.isFetching));
        await B.fetchData();
        assert.deepEqual(seen, [false]);
    });
    it('a fetch that throws (render handler breaks) still sets fetchSettled and emits fetch:settled', async () => {
        net = { main: () => fresh(), ef: true };
        let settled = 0;
        B.on('data:updated', () => { throw new Error('render broke'); });
        B.on('fetch:settled', () => { settled++; });
        await assert.rejects(B.fetchData(), /render broke/);
        assert.equal(settled, 1);
        assert.equal(B.store.isFetching, false);
    });
});

describe('retry button and labels (PA-3)', () => {
    it('after the card becomes ready, "Try again" is hidden again and the label is a normal one', async () => {
        net = { main: () => fresh(), ef: false };
        B.on('data:updated', B.updateGreatFallsUI);
        await B.fetchData();
        assert.equal(el('gfRetryBtn').hidden, false);
        net.ef = true;
        await B.fetchData();
        assert.ok(B.store.gfEstimate, 'a real estimate must have been computed');
        assert.equal(el('gfRetryBtn').hidden, true);
        assert.notEqual(labelOf(), 'UNAVAILABLE');
        assert.notEqual(trendOf(), 'Edwards Ferry data did not load.');
    });
    it('the ice label survives: the unavailable helper does not touch the ice branch', async () => {
        net = { main: () => iceBody(), ef: true };
        B.on('data:updated', B.updateGreatFallsUI);
        await B.fetchData();
        assert.equal(B.store.gfEstimate, null);
        assert.equal(labelOf(), 'UNAVAILABLE');
        assert.equal(el('gf-estimate-label').style.color, 'var(--accent-blue)');
        assert.match(trendOf(), /Ice conditions/);
        assert.equal(el('gfRetryBtn').hidden, true);
    });
    it('setStatus disables "Try again" with the refresh button while loading, and re-enables it afterwards', () => {
        B.setStatus('loading');
        assert.equal(el('gfRetryBtn').disabled, true);
        assert.equal(el('refreshBtn').disabled, true);
        B.setStatus('ok');
        assert.equal(el('gfRetryBtn').disabled, false);
        assert.equal(el('refreshBtn').disabled, false);
    });
    it('4e: an exception after setStatus("loading") releases both buttons', async () => {
        // validates (site and variable codes present) but breaks processData (no values block at all)
        const broken = { value: { timeSeries: [{ sourceInfo: { siteCode: [{ value: LF }] }, variable: { variableCode: [{ value: '00060' }] } }] } };
        net = { main: () => broken, ef: true };
        await assert.rejects(B.fetchData());
        assert.equal(el('refreshBtn').disabled, false);
        assert.equal(el('gfRetryBtn').disabled, false);
        assert.equal(B.store.isFetching, false);
    });
});

// A payload that passes validateUSGSResponse but breaks processData: one series with no values block,
// placed after Little Falls and Point of Rocks (the auditor's N-1 case).
const partialBody = () => {
    const b = fresh();
    b.value.timeSeries.push({ sourceInfo: { siteCode: [{ value: '01638480' }] }, variable: { variableCode: [{ value: '00060' }] } });
    return b;
};

describe('processData throwing partway (N-1)', () => {
    it('first load: the settled repaint shows no number (data is put back to empty)', async () => {
        net = { main: partialBody, ef: true };
        B.on('fetch:settled', B.onFetchSettled);
        B.on('data:updated', B.updateGreatFallsUI);
        await assert.rejects(B.fetchData());
        assert.deepEqual(B.store.data, {});
        assert.equal(B.store.gfEstimate, null);
        assert.ok(!/\d/.test(el('gf-cfs').textContent), 'gf-cfs must not hold a number: ' + el('gf-cfs').textContent);
    });
    it('refresh: the previous good data is kept', async () => {
        net = { main: () => fresh(), ef: true };
        await B.fetchData();
        const good = B.store.data;
        assert.ok(good[LF]?.q);
        net = { main: partialBody, ef: true };
        await assert.rejects(B.fetchData());
        assert.strictEqual(B.store.data, good);
        assert.ok(B.store.data[LF].q);
    });
});

describe('render hooks (N-2)', () => {
    const mark = () => { el('gf-cfs').textContent = 'SENTINEL'; };
    const rendered = () => el('gf-cfs').textContent !== 'SENTINEL';
    it('onLearningLoaded does not render the card while a fetch is running, and renders when none is', () => {
        B.store.setIsFetching(true); mark();
        B.onLearningLoaded();
        assert.equal(rendered(), false);
        B.store.setIsFetching(false); mark();
        B.onLearningLoaded();
        assert.equal(rendered(), true);
    });
    it('the fetch:settled hook renders when learning landed during the fetch', () => {
        B.store.setFetchSettled(true);
        B.store.setIsFetching(true);
        B.onLearningLoaded();
        B.store.setIsFetching(false); mark();
        B.onFetchSettled();
        assert.equal(rendered(), true);
    });
    it('the hook does not render when nothing changed, or when a data render already used the learning', () => {
        B.store.setFetchSettled(true); mark();
        B.onFetchSettled();
        assert.equal(rendered(), false, 'nothing changed');
        B.store.setIsFetching(true);
        B.onLearningLoaded();
        B.clearLearningMissed(); // what data:updated does
        B.store.setIsFetching(false); mark();
        B.onFetchSettled();
        assert.equal(rendered(), false);
    });
    it('the hook renders when the settled flag changed (first fetch ended without a render)', () => {
        B.store.setFetchSettled(false); mark();
        B.onFetchSettled();
        assert.equal(B.store.fetchSettled, true);
        assert.equal(rendered(), true);
    });
});

describe('refresh waits for a learning load in flight (PA-6 b)', () => {
    const run = async (ready) => {
        net = { main: () => fresh(), ef: true };
        B.store.setGfDataReady(ready);
        let release; const gate = new Promise((r) => { release = r; });
        B.store.setLearningInFlight(gate);
        let rendered = 0;
        B.on('data:updated', () => { rendered++; });
        const p = B.fetchData();
        await tickN(20);
        const renderedBeforeRelease = rendered;
        release();
        await p;
        B.store.setLearningInFlight(null);
        return { renderedBeforeRelease, rendered };
    };
    it('corrections already loaded and a load in flight: no render until the load settles, then exactly one', async () => {
        const r = await run(true);
        assert.equal(r.renderedBeforeRelease, 0);
        assert.equal(r.rendered, 1);
    });
    it('at startup (corrections not loaded yet) the fetch does not wait for the load', async () => {
        const r = await run(false);
        assert.equal(r.renderedBeforeRelease, 1);
    });
});

describe('lastAttemptMs', () => {
    it('is set when a fetch starts, and a call blocked by the isFetching guard does not touch it', async () => {
        net = { main: () => fresh(), ef: true };
        assert.equal(B.store.lastAttemptMs, null);
        B.store.setIsFetching(true);
        await B.fetchData();
        assert.equal(B.store.lastAttemptMs, null, 'blocked call must not count');
        B.store.setIsFetching(false);
        const t0 = Date.now();
        await B.fetchData();
        assert.ok(B.store.lastAttemptMs >= t0);
    });
});

describe('deferred resume consumed by the fetch:settled hook (PA-8)', () => {
    const oldBody = () => { // body 45 min old and readings 5 h old: a saved copy, so the early refetch is scheduled
        const t = Date.now() - 300 * MIN;
        return { value: { queryInfo: { note: [{ value: iso(Date.now() - 45 * MIN), title: 'requestDT' }] }, timeSeries: [series(LF, [pt(t, 5000)]), series(POR, [pt(t, 4000)])] } };
    };
    it('a wake event during the early-timer fetch sets the flag, and the hook runs one more refresh', async () => {
        net = { main: oldBody, ef: true };
        B.on('fetch:settled', B.onResumeFetchSettled);
        await B.fetchData();                       // first fetch: schedules the single early timer
        const early = timers.filter((x) => x.ms === 60000);
        assert.equal(early.length, 1);
        const before = mainCalls;
        B.store.setLastAttemptMs(Date.now() - 5 * MIN);
        // fire the early timer: fetchData({early:true}) starts and is now in flight
        early[0].fn();
        assert.equal(B.store.isFetching, true);
        assert.equal(B.maybeResume(), false);      // blocked by the fetch in flight
        await tickN(20);                           // early fetch settles; the hook consumes the flag
        await tickN(20);
        assert.ok(mainCalls >= before + 2, `expected the early fetch plus one resume fetch, got ${mainCalls - before}`);
    });
    it('without the hook subscribed, the pending flag would be left unread (control)', async () => {
        net = { main: oldBody, ef: true };
        await B.fetchData();
        const early = timers.filter((x) => x.ms === 60000);
        const before = mainCalls;
        B.store.setLastAttemptMs(Date.now() - 5 * MIN);
        early[0].fn();
        B.maybeResume();
        await tickN(30);
        assert.equal(mainCalls, before + 1, 'only the early fetch ran');
    });
});

describe('source guards (PA-2 and wiring)', () => {
    it('PA-2: the CSS has a #gfRetryBtn[hidden] rule that sets display:none (.btn display:flex would win otherwise)', () => {
        const css = read('src/styles/main.css');
        assert.match(css, /\.btn\s*\{[^}]*display:\s*flex/);
        assert.match(css, /#gfRetryBtn\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
        assert.doesNotMatch(css, /(^|\n)\[hidden\]\s*\{/, 'no global [hidden] rule');
    });
    it('the button sits just after #gf-estimate-display, is hidden, and has no inline handler', () => {
        const html = read('index.html');
        const btn = html.match(/<button[^>]*id="gfRetryBtn"[^>]*>[^<]*<\/button>/);
        assert.ok(btn, 'button present');
        assert.match(btn[0], /\bhidden\b/);
        assert.doesNotMatch(btn[0], /\bonclick\b/i);
        assert.match(btn[0], />Try again</);
        const iDisplay = html.indexOf('id="gf-estimate-display"');
        const iBtn = html.indexOf('id="gfRetryBtn"');
        const iNext = html.indexOf('Hidden elements for JS compatibility');
        assert.ok(iDisplay < iBtn && iBtn < iNext, 'button is between the card and the next block');
        // not inside the live region: the card div is closed before the button
        const between = html.slice(iDisplay, iBtn);
        const opens = (between.match(/<div/g) || []).length, closes = (between.match(/<\/div>/g) || []).length;
        assert.equal(closes, opens + 1, 'the card div is closed before the button');
    });
});

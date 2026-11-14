// v39.9: behaviour tests for the forecast-accuracy line (one row, no "vs persistence") and the new
// "Great Falls to Little Falls" header line, through the real updateGreatFallsUI with a fake browser
// (same harness as clean-screen-behaviour.test.mjs). Display only: the estimate itself is not under test.
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 60000;
const LF = '01646500', POR = '01638500';
const realLog = console.log, realWarn = console.warn;

let B;
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
        `export { fetchData } from ${q('src/data/fetch.js')};`,
        `export { updateGreatFallsUI, updateForecastAccuracyUI } from ${q('src/ui/great-falls-ui.js')};`,
        `export { getGFtoLFTravelTime } from ${q('src/model/shared-model.js')};`,
        `export { on, clear } from ${q('src/state/event-bus.js')};`,
        `export { clearChainMemo } from ${q('src/ui/data-freshness.js')};`,
        `export { clearLearningMissed } from ${q('src/data/refresh.js')};`,
        `export * as store from ${q('src/state/store.js')};`
    ].join('\n');
    const out = await build({
        stdin: { contents: entry, resolveDir: root, sourcefile: 'v399-entry.mjs', loader: 'js' },
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
const fresh = (lf = 5000, por = 4000) => {
    const t = Date.now() - 5 * MIN;
    return { value: { queryInfo: { note: [{ value: iso(Date.now()), title: 'requestDT' }] }, timeSeries: [series(LF, [pt(t, lf)]), series(POR, [pt(t, por)])] } };
};
const iceBody = () => {
    const t = Date.now() - 5 * MIN;
    return { value: { queryInfo: { note: [{ value: iso(Date.now()), title: 'requestDT' }] }, timeSeries: [
        series(LF, [pt(t, -999999, ['Ice'])]), series(POR, [pt(t, -999999, ['Ice'])])] } };
};
// Little Falls reads normally; Point of Rocks is ice-flagged with no valid reading: the Edwards Ferry-only branch.
const porIceBody = () => {
    const t = Date.now() - 5 * MIN;
    return { value: { queryInfo: { note: [{ value: iso(Date.now()), title: 'requestDT' }] }, timeSeries: [
        series(LF, [pt(t, 5000)]), series(POR, [pt(t, -999999, ['Ice'])])] } };
};
const efBody = () => ({ value: { timeSeries: [{ values: [{ value: [pt(Date.now() - 5 * MIN, 5.2)] }] }] } });
const ok = (b) => ({ ok: true, json: async () => b });
const no = () => ({ ok: false, json: async () => ({}) });
const tickN = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
let net, posts;

beforeEach(() => {
    console.log = () => {}; console.warn = () => {};
    timers.length = 0; posts = [];
    for (const k of Object.keys(els)) delete els[k];
    globalThis.localStorage.clear();
    setGlobal('document', { getElementById: el, visibilityState: 'visible', querySelectorAll: () => [], querySelector: () => null, createElement: () => el('__created' + Math.random()), body: el('__body') });
    setGlobal('navigator', { onLine: true });
    setGlobal('setTimeout', (fn, ms) => { timers.push({ fn, ms }); return timers.length; });
    setGlobal('clearTimeout', () => {});
    setGlobal('fetch', async (u, opts) => {
        const url = String(u);
        if (opts && opts.method === 'POST') { posts.push({ url, body: JSON.parse(opts.body) }); return ok({}); }
        if (url.startsWith('https://waterservices.usgs.gov/') && url.includes('P7D')) return net.main ? ok(net.main()) : no();
        if (url.includes('01644148')) return net.ef ? ok(efBody()) : no();
        return no();
    });
    B.clear(); B.clearLearningMissed(); B.clearChainMemo();
    const s = B.store;
    s.setIsFetching(false); s.setLastReading(null); s.setLastFetchTime(null); s.setFetchSettled(false);
    s.setLastAttemptMs(null); s.setGfDataReady(true); s.setGfEstimate(null);
    // renderForecastGraph needs at least one history point (production always has one: recordGFEstimate runs first)
    s.setGfHistory([{ timestamp: Date.now() - 3600000, cfs: 10700, stage: 6.3 }]);
    s.setLastForecastPredictionTime(0);
    s.setGfLearningData({ correctionBins: {}, pendingPredictions: [], metadata: {}, efCorrelation: null });
    s.edwardsFerryData.current = null; s.edwardsFerryData.history = [];
    s.setPorHistory([]);
    s.setData({});
});
afterEach(async () => {
    await tickN(20);
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; delete saved[k]; }
    console.log = realLog; console.warn = realWarn;
});


const load = async (body) => {
    net = { main: body, ef: true };
    B.on('data:updated', B.updateGreatFallsUI);
    await B.fetchData();
};
const hdr = () => el('gfLfTravelVal').textContent;
const seedPoR = () => {
    // Point of Rocks was low a day ago and is now high: the model looks up a low historic reading (a
    // different flow multiplier) and the river counts as rising, so inputs.travelGFtoLF is NOT the header's basis.
    const now = Date.now();
    const h = [];
    for (let m = 30 * 60; m >= 120; m -= 30) h.push({ timestamp: now - m * MIN, cfs: 1500, stage: 3 });
    for (let m = 90; m >= 0; m -= 15) h.push({ timestamp: now - m * MIN, cfs: 4000, stage: 4 });
    B.store.setPorHistory(h);
};

describe('forecast accuracy line: one row, no "vs persistence" (item 2)', () => {
    const horizons = (pv) => Object.fromEntries([6, 12, 24, 48].map((h) => [h, {
        validations: 3, avgErrorPercent: 8, persistenceValidations: pv, persistenceAvgErrorPercent: 15
    }]));
    for (const pv of [12, 0]) {
        it(`renders only the first row (persistence validations ${pv} per horizon)`, () => {
            B.store.setForecastAccuracyData({ horizons: horizons(pv) });
            B.updateForecastAccuracyUI();
            const html = el('forecast-accuracy').innerHTML;
            assert.equal(el('forecast-accuracy').style.display, 'block');
            assert.ok(html.includes('Forecast accuracy:'));
            assert.ok(html.includes('+6h:'));
            assert.ok(html.includes('(12 validations)'));
            assert.ok(!/persistence/i.test(html), html);
            assert.ok(!html.includes('<br>'), html);
            assert.ok(!html.includes('vs '), html);
        });
    }
});

describe('Great Falls to Little Falls header line (item 6)', () => {
    it('main path: shows the model value, rounded from the panel one-decimal text, and it differs from the header basis', async () => {
        await load(() => fresh(5000, 4000));
        seedPoR();
        B.updateGreatFallsUI();
        const g = B.store.gfEstimate;
        assert.ok(g && !g.efOnly);
        const x = g.inputs.travelGFtoLF;
        // precondition: the model's value is not what a calculation from data._mult would give
        const headerBasis = B.getGFtoLFTravelTime(B.store.data._mult.mult, null);
        assert.notEqual(x.toFixed(1), headerBasis.toFixed(1), `precondition: ${x} vs ${headerBasis}`);
        assert.notEqual(Math.round(Number(x.toFixed(1))), Math.round(Number(headerBasis.toFixed(1))), 'precondition: the rounded hours differ too');
        assert.equal(hdr(), '~' + Math.round(Number(x.toFixed(1))) + ' hrs');
        assert.equal(el('gf-input-travel-gf-lf').textContent, x.toFixed(1) + ' hrs');
    });
    it('no estimate (ice at both gauges) resets a number to "--"', async () => {
        await load(() => fresh(5000, 4000));
        assert.match(hdr(), /^~\d+ hrs$/);
        net.main = iceBody;
        await B.fetchData();
        assert.equal(B.store.gfEstimate, null);
        assert.equal(hdr(), '--');
    });
    it('Edwards Ferry-only render resets a number to "--"', async () => {
        await load(() => fresh(5000, 4000));
        assert.match(hdr(), /^~\d+ hrs$/);
        net.main = porIceBody;
        await B.fetchData();
        assert.ok(B.store.gfEstimate?.efOnly);
        assert.equal(hdr(), '--');
    });
    it('loading render (data not ready) resets a number to "--"', async () => {
        await load(() => fresh(5000, 4000));
        assert.match(hdr(), /^~\d+ hrs$/);
        B.store.setGfDataReady(false);
        B.updateGreatFallsUI();
        assert.equal(hdr(), '--');
    });
    it('with no estimate object and no Edwards Ferry reading the line shows "--"', async () => {
        await load(() => fresh(5000, 4000));
        B.store.setGfEstimate(null);
        B.store.edwardsFerryData.current = null;
        B.updateGreatFallsUI();
        assert.equal(hdr(), '--');
    });
});

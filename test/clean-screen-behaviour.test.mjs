// v39.8: the clean-screen release, through the real updateGreatFallsUI / updateForecastPeriods with a fake
// browser (same approach as startup-refresh-behaviour.test.mjs). Display only: the estimate is not under test.
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
        `export { updateGreatFallsUI, updateForecastPeriods, showGraphMarker } from ${q('src/ui/great-falls-ui.js')};`,
        `export { estimateLFStage } from ${q('src/model/shared-model.js')};`,
        `export { on, clear } from ${q('src/state/event-bus.js')};`,
        `export { clearChainMemo } from ${q('src/ui/data-freshness.js')};`,
        `export { clearLearningMissed } from ${q('src/data/refresh.js')};`,
        `export * as store from ${q('src/state/store.js')};`
    ].join('\n');
    const out = await build({
        stdin: { contents: entry, resolveDir: root, sourcefile: 'clean-screen-entry.mjs', loader: 'js' },
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

// ---- forecast fixtures ----
// A flat NWS series: every future period then equals the observed Little Falls flow (bias offset cancels).
const flatForecast = (kcfs) => ({ data: Array.from({ length: 100 }, (_, i) => ({ validTime: iso(Date.now() + (i - 4) * 3600000), primary: 5, secondary: kcfs })) });
const setNws = (lfQ) => {
    B.store.edwardsFerryData.current = { stage: 5.2, time: new Date() }; // forecast posting is skipped without an Edwards Ferry reading
    B.store.setData({
        [POR]: { q: lfQ, forecast: flatForecast(lfQ / 1000) },
        [LF]: { q: lfQ, forecast: flatForecast(lfQ / 1000) }
    });
};
const gfEst = (cfs, stage = 6.43) => ({ cfs, stage, forecastCFS: cfs, inputs: { travelPoRtoGF: 8 } });
const cardsHtml = () => el('gf-forecast-periods').innerHTML;
const cardText = (hrs) => {
    const m = cardsHtml().match(new RegExp(`data-hrs="${hrs}"[\\s\\S]*?<div class="fp-stage">([^<]*)</div>\\s*<div class="fp-cfs">([^<]*)</div>`));
    assert.ok(m, `card +${hrs}h present`);
    return { stage: m[1], cfs: m[2] };
};

describe('forecast cards: rounded text, exact stored values (C1, PA-12)', () => {
    it('future cards show rounded text, the Now card stays exact, and there is no per-card source text', async () => {
        setNws(10812);
        B.updateForecastPeriods(gfEst(10812));
        await tickN();
        const html = cardsHtml();
        assert.ok(!html.includes('fp-source'), 'no per-card source span');
        assert.ok(!/>\s*(NWS|NWS\+EF|extrapolated)\s*</.test(html));
        assert.deepEqual(cardText(0), { stage: '6.43 ft', cfs: '10,812 cfs' });
        const six = cardText(6);
        assert.equal(six.cfs, '10,800 cfs');
        assert.match(six.stage, /^\d+\.\d\d ft$/, 'stage keeps two decimals');
        // raw values stay in the data attributes
        assert.match(html, /data-hrs="6" data-stage="[\d.]+" data-cfs="10812"/);
    });
    it('PA-12: exactly one POST; source stays NWS; predictedCFS and predictedStage are the unrounded values', async () => {
        setNws(10812);
        B.updateForecastPeriods(gfEst(10812));
        await tickN();
        assert.equal(posts.length, 1);
        const f = posts[0].body.forecasts;
        assert.equal(f.length, 4);
        for (const x of f) {
            assert.ok(x.source === 'NWS' || x.source === 'NWS+EF', 'source is not a display label: ' + x.source);
            assert.equal(x.predictedCFS, 10812, 'posted flow is not rounded');
            assert.equal(x.predictedStage, B.estimateLFStage(10812), 'posted stage is the exact value');
        }
        assert.notEqual(Math.round(f[0].predictedStage * 100) / 100, f[0].predictedStage, 'the posted stage is not rounded to two decimals');
    });
    it('one source line under the cards, and the same text on each future card title', async () => {
        setNws(10812);
        B.updateForecastPeriods(gfEst(10812));
        assert.equal(el('gf-forecast-source').textContent, 'Source: National Weather Service forecast');
        assert.equal(el('gf-forecast-source').title, 'National Weather Service forecast (arrival time varies with flow)');
        const titles = cardsHtml().match(/title="[^"]*"/g) || [];
        assert.equal(titles.length, 4);
        for (const t of titles) assert.equal(t, 'title="National Weather Service forecast (arrival time varies with flow)"');
    });
    it('no NWS forecast: the line says rough projection, the cards say the same, and p.source is still "extrapolated"', async () => {
        B.store.setData({ [LF]: { q: 5000 }, [POR]: { q: 4000 } });
        B.updateForecastPeriods(gfEst(5000));
        await tickN();
        assert.equal(el('gf-forecast-source').textContent, 'No Weather Service forecast. Rough projection.');
        assert.match(el('gf-forecast-source').title, /^No National Weather Service forecast available\. A rough projection from the current estimate and the upstream reading\.$/);
        assert.ok(!/straight-line/.test(cardsHtml()));
        assert.equal(posts.length, 0, 'extrapolated forecasts are never posted');
    });
});

describe('trend arrow against the rounded numbers (PA-5)', () => {
    const arrows = () => (cardsHtml().match(/class="fp-trend"[^>]*>([^<]*)</g) || []).map((x) => x.slice(-2, -1));
    it('Now 10,812 and +6h 10,830 both read 10,800: the arrow is ●, not ▲', () => {
        setNws(10830);
        B.updateForecastPeriods(gfEst(10812));
        assert.equal(cardText(6).cfs, '10,800 cfs');
        assert.deepEqual(arrows(), ['●', '●', '●', '●']);
    });
    it('a real rise still shows ▲ and a real fall ▼', () => {
        setNws(11500);
        B.updateForecastPeriods(gfEst(10812));
        assert.deepEqual(arrows(), ['▲', '▲', '▲', '▲']);
        setNws(9000);
        B.updateForecastPeriods(gfEst(10812));
        assert.deepEqual(arrows(), ['▼', '▼', '▼', '▼']);
    });
});

describe('graph tooltip agrees with the cards (PA-4)', () => {
    const tip = () => ({ stage: el('gf-tooltip-stage').textContent, cfs: el('gf-tooltip-cfs').textContent });
    it('tapping Now shows the exact Now text; tapping +6h shows the rounded +6h text', () => {
        setNws(10812);
        B.store.setGfHistory([{ timestamp: Date.now() - 3 * 3600000, cfs: 10700, stage: 6.3 }, { timestamp: Date.now() - 1 * 3600000, cfs: 10790, stage: 6.4 }]);
        B.updateForecastPeriods(gfEst(10812));
        B.showGraphMarker(0);
        assert.deepEqual(tip(), { stage: '6.43', cfs: '10,812' });
        B.showGraphMarker(6);
        const six = cardText(6);
        assert.equal(tip().cfs + ' cfs', six.cfs);
        assert.equal(tip().stage + ' ft', six.stage);
        assert.equal(tip().cfs, '10,800');
    });
    it('the graph hover tooltip follows the same rule (forecast-graph.js)', () => {
        setNws(10812);
        B.updateForecastPeriods(gfEst(10812));
        const hover = el('gf-graph-hover');
        assert.equal(typeof hover.onmousemove, 'function');
        // plot area: left 35, width 235 (300 - 20 padding - 35 - 10), x range -24..48 hrs
        const xAt = (hrs) => 35 + ((hrs + 24) / 72) * 235;
        hover.onmousemove({ clientX: xAt(0) });
        assert.deepEqual(tip(), { stage: '6.43', cfs: '10,812' });
        hover.onmousemove({ clientX: xAt(6) });
        const six = cardText(6);
        assert.equal(tip().cfs + ' cfs', six.cfs);
        assert.equal(tip().stage + ' ft', six.stage);
    });
});

describe('Edwards Ferry-only render: spelled-out labels (A, PA-13)', () => {
    it('the card, the trend, the confidence and the panel say "Edwards Ferry", never "EF"', async () => {
        net = { main: porIceBody, ef: true };
        B.on('data:updated', B.updateGreatFallsUI);
        await B.fetchData();
        assert.ok(B.store.gfEstimate?.efOnly, 'the fixture reaches the Edwards Ferry-only branch');
        assert.equal(el('gf-estimate-label').textContent, '❄️ ESTIMATE FROM EDWARDS FERRY ONLY');
        assert.match(el('gf-trend').textContent, /^[▲▼●] (RISING|FALLING|STEADY) \(Edwards Ferry trend\)$/);
        assert.equal(el('gf-confidence').textContent, 'Confidence: LOW (Edwards Ferry only)');
        for (const id of ['gf-input-flowbin', 'gf-input-correction', 'gf-input-uncertainty', 'gf-input-ceiling']) {
            assert.equal(el(id).textContent, 'N/A (Edwards Ferry only)', id);
        }
        for (const e of Object.values(els)) assert.ok(!/\bEF\b/.test(String(e.textContent)), `${e.id}: ${e.textContent}`);
    });
});

describe('Flow band label value (A)', () => {
    it('a learned bin shows "<band> (N checks)"', async () => {
        net = { main: () => fresh(), ef: true };
        B.on('data:updated', B.updateGreatFallsUI);
        await B.fetchData();
        const g = B.store.gfEstimate;
        assert.ok(g && !g.efOnly);
        B.store.setGfLearningData({ correctionBins: { [g.inputs.flowBin]: { [g.flowState]: { count: 12, ema: 0 } } }, pendingPredictions: [], metadata: {}, efCorrelation: null });
        B.updateGreatFallsUI();
        assert.equal(el('gf-input-flowbin').textContent, `${g.inputs.flowBin} (12 checks)`);
    });
});

describe('the one notice box through updateGreatFallsUI (B, PA-13)', () => {
    const nowIso = () => new Date().toISOString();
    const setAdvisories = (e, r) => {
        const g = B.store.gfLearningData;
        B.store.setGfLearningData({ ...g, efDivergence: e ? { active: true, updatedAt: nowIso() } : null, lfResidual: r ? { active: true, updatedAt: nowIso() } : null });
    };
    const load = async (body) => {
        net = { main: body, ef: true };
        B.on('data:updated', B.updateGreatFallsUI);
        await B.fetchData();
    };
    const box = () => ({
        hidden: el('gf-notice').hidden,
        lines: ['cap', 'ef', 'lf'].map((k) => (el(`gf-notice-${k}`).hidden ? '' : `${el(`gf-notice-${k}-lead`).textContent} ${el(`gf-notice-${k}-text`).textContent}`)),
        closing: el('gf-notice-closing').hidden ? '' : el('gf-notice-closing').textContent
    });
    const EF = 'Cross-check gauge disagrees: Edwards Ferry has read well above what the upstream gauges suggest for several hours. That can be gauge noise at low water, or water entering below those gauges, water this estimate may not fully see.';
    const LFL = 'Recent estimates ran low: they came in well below what Little Falls later measured. That often means rain-swollen local streams are adding water the upstream gauges cannot see. The current number may be low too.';
    const CLOSING = 'Treat this estimate with extra caution. If the river looks higher than the number, believe the river.';

    it('no cap and no advisory: the box is hidden and every slot is empty', async () => {
        await load(() => fresh());
        assert.ok(B.store.gfEstimate && !B.store.gfEstimate.inputs.ceilingApplied);
        assert.deepEqual(box(), { hidden: true, lines: ['', '', ''], closing: '' });
    });
    it('both advisories: the EF line, the Little Falls line and the closing sentence once, in that order; confidence moves two notches with the warning mark', async () => {
        await load(() => fresh());
        const before = el('gf-confidence').textContent;
        setAdvisories(true, true);
        B.updateGreatFallsUI();
        assert.deepEqual(box(), { hidden: false, lines: ['', EF, LFL], closing: CLOSING });
        assert.match(el('gf-confidence').textContent, /^Confidence: [A-Z]+ ⚠$/);
        assert.notEqual(el('gf-confidence').textContent, before);
    });
    it('each single advisory shows its line plus the closing sentence; the other line is hidden', async () => {
        await load(() => fresh());
        setAdvisories(true, false); B.updateGreatFallsUI();
        assert.deepEqual(box(), { hidden: false, lines: ['', EF, ''], closing: CLOSING });
        setAdvisories(false, true); B.updateGreatFallsUI();
        assert.deepEqual(box(), { hidden: false, lines: ['', '', LFL], closing: CLOSING });
        setAdvisories(false, false); B.updateGreatFallsUI();
        assert.deepEqual(box(), { hidden: true, lines: ['', '', ''], closing: '' });
    });
    it('the cap alone: the cap line without a closing sentence; cap plus both advisories: all four in order', async () => {
        await load(() => fresh(3000, 4000));
        const g = B.store.gfEstimate;
        assert.equal(g.inputs.ceilingApplied, true, 'the fixture binds the cap');
        const b1 = box();
        assert.equal(b1.hidden, false);
        assert.ok(b1.lines[0].startsWith('Capped: the model estimates '));
        assert.deepEqual([b1.lines[1], b1.lines[2], b1.closing], ['', '', '']);
        assert.ok(b1.lines[0].includes(g.cfs.toLocaleString()));
        setAdvisories(true, true); B.updateGreatFallsUI();
        const b7 = box();
        assert.equal(b7.lines[0], b1.lines[0]);
        assert.deepEqual([b7.lines[1], b7.lines[2], b7.closing], [EF, LFL, CLOSING]);
    });
    it('a later Edwards Ferry-only render hides the whole box (PA-14, PA-15)', async () => {
        await load(() => fresh(3000, 4000));
        setAdvisories(true, true); B.updateGreatFallsUI();
        assert.equal(box().hidden, false);
        net.main = porIceBody;
        await B.fetchData();
        assert.ok(B.store.gfEstimate?.efOnly);
        assert.deepEqual(box(), { hidden: true, lines: ['', '', ''], closing: '' });
    });
    it('a later no-estimate render (ice at both gauges) hides the box too', async () => {
        await load(() => fresh());
        setAdvisories(true, true); B.updateGreatFallsUI();
        assert.equal(box().hidden, false);
        net.main = iceBody;
        await B.fetchData();
        assert.equal(B.store.gfEstimate, null);
        assert.equal(box().hidden, true);
    });
    it('a stale advisory (older than the freshness window) shows nothing', async () => {
        await load(() => fresh());
        const g = B.store.gfLearningData;
        B.store.setGfLearningData({ ...g, efDivergence: { active: true, updatedAt: new Date(Date.now() - 48 * 3600000).toISOString() } });
        B.updateGreatFallsUI();
        assert.equal(box().hidden, true);
        assert.doesNotMatch(el('gf-confidence').textContent, /⚠/);
    });
});

describe('stage keeps two decimals so it cannot contradict the arrow (v39.8 re-audit N-1)', () => {
    it('low flow: a future point below Now shows a down arrow and a stage text not above the Now stage text', () => {
        // find a flow whose stage, rounded to one decimal, would land ABOVE the Now stage (the rounding bug)
        let F = null, nowStage = null;
        for (let f = 300; f <= 900 && F === null; f++) {
            const s = B.estimateLFStage(f);
            const ns = Math.ceil(s * 100) / 100;
            if (Math.round(s * 10) / 10 > ns) { F = f; nowStage = ns; }
        }
        assert.ok(F !== null, 'fixture flow found');
        setNws(F);
        B.updateForecastPeriods(gfEst(F + 150, nowStage));
        const now = cardText(0), six = cardText(6);
        assert.equal(now.stage, nowStage.toFixed(2) + ' ft');
        assert.match(cardsHtml().match(/class="fp-trend"[^>]*>([^<]*)</)[1], /▼/);
        assert.match(six.stage, /^\d+\.\d\d ft$/);
        assert.ok(parseFloat(six.stage) <= parseFloat(now.stage), `${six.stage} vs ${now.stage}`);
        assert.equal(six.cfs, roundedText(F));
    });
});
function roundedText(f) { const step = f < 1000 ? 10 : f < 5000 ? 50 : 100; return Math.round(f / step) * step + ' cfs'; }

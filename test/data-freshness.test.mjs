// v39.1 (audit finding 5 / TODO A1): the "last update" label describes READING age, not fetch time.
// Pure label logic is tested directly. processData / updateStalenessDisplay are tested through an
// esbuild bundle of src/data/fetch.js (same approach as test/characterization/harness.mjs).
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';
import {
    describeFreshness, readingFromData, shouldEarlyRefetch, formatAge, bandFor,
    payloadReadingMs, isOldPayload,
    bodyTimeMs, classifyOldPayload, chainSuppressed, noteChainFoundNothing, clearChainMemo,
    BODY_FRESH_MIN, CHAIN_MEMO_MIN,
    RECENT_MIN, OLD_MIN, STALE_MIN
} from '../src/ui/data-freshness.js';

const realSetTimeout = globalThis.setTimeout;
const realLog = console.log, realWarn = console.warn;
// Stray console output from fetches fired by timers corrupts the node:test child channel (rare "Unable to deserialize" failure).
const muteConsole = () => { console.log = () => {}; console.warn = () => {}; };
const unmuteConsole = () => { console.log = realLog; console.warn = realWarn; };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const MIN = 60000;
const NOW = Date.parse('2026-11-10T18:00:00Z');
const LF = '01646500';
const POR = '01638500';

// ---- fixtures -------------------------------------------------------------
const iso = (ms) => new Date(ms).toISOString();
const pt = (ms, value, quals = ['P']) => ({ value: String(value), qualifiers: quals, dateTime: typeof ms === 'string' ? ms : iso(ms) });
const series = (site, vals, param = '00060') => ({
    sourceInfo: { siteCode: [{ value: site }] },
    variable: { variableCode: [{ value: param }] },
    values: [{ value: vals }]
});
const payload = (...ts) => ({ value: { timeSeries: ts } });

let F; // bundled fetch.js + store

before(async () => {
    if (!globalThis.localStorage) {
        const m = new Map();
        globalThis.localStorage = {
            getItem: (k) => (m.has(k) ? m.get(k) : null),
            setItem: (k, v) => { m.set(k, String(v)); },
            removeItem: (k) => { m.delete(k); }, clear: () => m.clear()
        };
    }
    const entry = [
        `export { processData, updateStalenessDisplay, fillMissingData, fetchData } from ${JSON.stringify(resolve(root, 'src/data/fetch.js'))};`,
        `export { clearChainMemo } from ${JSON.stringify(resolve(root, 'src/ui/data-freshness.js'))};`,
        `export * as store from ${JSON.stringify(resolve(root, 'src/state/store.js'))};`
    ].join('\n');
    const out = await build({
        stdin: { contents: entry, resolveDir: root, sourcefile: 'fresh-entry.mjs', loader: 'js' },
        bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent'
    });
    F = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
});

const quiet = (fn) => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };
const run = (json) => { quiet(() => F.processData(json)); return F.store.data; };

// ---- per-gauge reading time (processData) ---------------------------------
describe('processData records readTime', () => {
    it('1. older-of rule', () => {
        const d = run(payload(
            series(LF, [pt(NOW - 60 * MIN, 5000), pt(NOW - 30 * MIN, 5100)]),
            series(POR, [pt(NOW - 90 * MIN, 4000), pt(NOW - 45 * MIN, 4100)])
        ));
        const r = F.store.lastReading;
        assert.equal(d[LF].readTime, NOW - 30 * MIN);
        assert.equal(r.lf, NOW - 30 * MIN);
        assert.equal(r.por, NOW - 45 * MIN);
        assert.equal(r.ms, NOW - 45 * MIN);
    });

    it('2. Eqp sentinel uses the older valid reading time, and q agrees with it', () => {
        const d = run(payload(
            series(LF, [pt(NOW - 240 * MIN, 5000), pt(NOW - 60 * MIN, -999999, ['Eqp'])]),
            series(POR, [pt(NOW - 30 * MIN, 4100)])
        ));
        assert.equal(d[LF].q, 5000);
        assert.equal(d[LF].readTime, NOW - 240 * MIN);
    });

    it('3. Ice rule', () => {
        // Ice-qualified sentinel with an older valid value: the gauge is reporting, so latest time.
        let d = run(payload(series(LF, [pt(NOW - 240 * MIN, 5000), pt(NOW - 20 * MIN, -999999, ['Ice'])])));
        assert.equal(d[LF].iceAffected, true);
        assert.equal(d[LF].readTime, NOW - 20 * MIN);
        // Bare sentinel, no valid value: nothing.
        d = run(payload(series(LF, [pt(NOW - 20 * MIN, -999999, [])])));
        assert.equal(d[LF].readTime, undefined);
        // Ice qualifier, no valid value in window: latest time.
        d = run(payload(series(LF, [pt(NOW - 20 * MIN, -999999, ['Ice'])])));
        assert.equal(d[LF].iceLongTerm, true);
        assert.equal(d[LF].readTime, NOW - 20 * MIN);
    });

    it('4. zero or NaN latest value has no readTime', () => {
        let d = run(payload(series(LF, [pt(NOW - 20 * MIN, 0)])));
        assert.equal(d[LF].readTime, undefined);
        d = run(payload(series(LF, [pt(NOW - 20 * MIN, 'abc')])));
        assert.equal(d[LF].readTime, undefined);
    });

    it('5. parity: shown value and its reading time come from the same instant (valid and Eqp cases)', () => {
        const vals = [pt(NOW - 180 * MIN, 111), pt(NOW - 120 * MIN, 222), pt(NOW - 60 * MIN, 333)];
        let d = run(payload(series(LF, vals)));
        assert.equal(d[LF].q, 333);
        assert.equal(d[LF].readTime, NOW - 60 * MIN);
        d = run(payload(series(LF, [...vals.slice(0, 2), pt(NOW - 60 * MIN, -999999, ['Mnt'])])));
        assert.equal(d[LF].q, 222);
        assert.equal(d[LF].readTime, NOW - 120 * MIN);
    });

    it('6. mixed UTC offsets: the LAST element is parsed as an instant', () => {
        const last = '2026-11-01T01:30:00.000-04:00'; // 05:30Z
        const d = run(payload(series(LF, [pt('2026-11-01T01:45:00.000-05:00', 4000), pt(last, 4100)]))); // 06:45Z earlier-listed
        assert.equal(d[LF].readTime, Date.parse(last));
    });

    it('7. empty array, second values block, unparseable dateTime', () => {
        let d = run(payload(series(LF, [])));
        assert.equal(d[LF].readTime, undefined);
        const two = series(LF, [pt(NOW - 60 * MIN, 5000)]);
        two.values.push({ value: [pt(NOW - 5 * MIN, 9999)] });
        d = run(payload(two));
        assert.equal(d[LF].readTime, NOW - 60 * MIN);
        d = run(payload(series(LF, [pt(NOW - 60 * MIN, 5000), pt('not-a-date', 5100)])));
        assert.equal(d[LF].readTime, undefined);
        d = run(payload(series(LF, [pt('bad', 5000), pt(NOW - 60 * MIN, 5100)])));
        assert.equal(d[LF].readTime, NOW - 60 * MIN);
    });

    it('8. fillMissingData never sets readTime (estimated PoR counts as missing)', () => {
        const d = run(payload(series(LF, [pt(NOW - 30 * MIN, 5000)])));
        assert.equal(d[POR].estimated, true);
        assert.equal(d[POR].readTime, undefined);
        assert.equal(F.store.lastReading.por, null);
        assert.equal(F.store.lastReading.ms, NOW - 30 * MIN);
    });
});

// ---- pure label logic -----------------------------------------------------
const base = { now: NOW, online: true, source: 'live', fetchMs: NOW };
const withAge = (min, extra = {}) => describeFreshness({
    ...base, readingMs: NOW - min * MIN, lfMs: NOW - min * MIN, porMs: NOW - min * MIN, ...extra
});

describe('describeFreshness', () => {
    it('9. bands and formatting never round across a band', () => {
        for (const [m, txt] of [[10, '10m'], [75, '1h 15m'], [89, '1h 29m']]) {
            const r = withAge(m);
            assert.equal(r.className, 'fresh');
            assert.equal(r.text, `Latest reading ${txt} ago`);
        }
        let r = withAge(119);
        assert.equal(r.className, 'fresh');
        assert.match(r.text, /1h 59m/);
        r = withAge(120);
        assert.equal(r.className, 'recent');
        assert.equal(r.text, 'Readings 2h old');
        assert.equal(withAge(179).className, 'recent');
        assert.equal(withAge(180).className, 'old');
        r = withAge(359);
        assert.equal(r.className, 'old');
        assert.match(r.text, /5h 59m/);
        r = withAge(360);
        assert.equal(r.className, 'stale');
        assert.match(r.text, /^Readings 6h old/);
        assert.match(withAge(420).text, /7h old/);
        assert.match(withAge(2 * 1440).text, /2d old/);
        assert.match(withAge(9 * 1440).text, /9d old/);
        assert.equal(withAge(2 * 1440).className, 'stale');
        assert.equal(withAge(0).text, 'Latest reading just now');
        assert.equal(formatAge(2879), '47h');
        assert.equal(bandFor(RECENT_MIN), 'recent');
        assert.equal(bandFor(OLD_MIN), 'old');
        assert.equal(bandFor(STALE_MIN), 'stale');
    });

    it('10. normal lag plus drift stays fresh', () => {
        const r = withAge(90, { fetchMs: NOW - 15 * MIN });
        assert.equal(r.className, 'fresh');
        assert.doesNotMatch(r.text, /not refreshed/);
    });

    it('11. core regression: fetch time "now" with 5 h old readings is not "just now"', () => {
        const r = describeFreshness({ ...base, fetchMs: NOW, readingMs: NOW - 300 * MIN, lfMs: NOW - 300 * MIN, porMs: NOW - 300 * MIN });
        assert.match(r.text, /5h/);
        assert.doesNotMatch(r.text, /just now/);
        assert.equal(r.className, 'old');
    });

    it('12. saved copy wording when offline, cached or stale', () => {
        for (const x of [{ online: false }, { source: 'cached' }, { source: 'stale' }]) {
            const r = withAge(10, x);
            assert.ok(r.text.startsWith('Saved copy: '), r.text);
            assert.notEqual(r.className, 'fresh');
        }
        assert.equal(withAge(10, { source: 'cached' }).text, 'Saved copy: latest reading 10m ago');
        assert.equal(withAge(420, { source: 'stale' }).text, 'Saved copy: readings 7h old');
    });

    it('13. stalled refresh: old readings and an old fetch', () => {
        const r = withAge(420, { fetchMs: NOW - 420 * MIN });
        assert.match(r.text, /not refreshed since \d{1,2}:\d{2}/);
        assert.doesNotMatch(r.text, /no newer data received/);
    });

    it('14. live and current fetch with very old readings', () => {
        const r = withAge(420);
        assert.match(r.text, /no newer data received/);
        assert.equal(r.className, 'stale');
    });

    it('15. missing gauge note and unknown time', () => {
        let r = describeFreshness({ ...base, readingMs: NOW - 40 * MIN, lfMs: NOW - 40 * MIN, porMs: null });
        assert.ok(r.text.endsWith('Point of Rocks missing'), r.text);
        assert.notEqual(r.className, 'fresh');
        r = describeFreshness({ ...base, readingMs: NOW - 40 * MIN, lfMs: null, porMs: NOW - 40 * MIN });
        assert.ok(r.text.endsWith('Little Falls missing'), r.text);
        assert.notEqual(r.className, 'fresh');
        r = describeFreshness({ ...base, readingMs: null, lfMs: null, porMs: null, fetchMs: NOW });
        assert.equal(r.text, 'Reading time unknown');
        assert.equal(r.className, 'stale');
    });

    it('16. future reading times never give a negative age', () => {
        let r = describeFreshness({ ...base, readingMs: NOW + 2 * MIN, lfMs: NOW + 2 * MIN, porMs: NOW + 2 * MIN });
        assert.equal(r.text, 'Latest reading just now');
        assert.doesNotMatch(r.title, /clock/);
        r = describeFreshness({ ...base, readingMs: NOW + 20 * MIN, lfMs: NOW + 20 * MIN, porMs: NOW + 20 * MIN });
        assert.equal(r.text, 'Latest reading just now');
        assert.match(r.title, /Device clock may be wrong/);
        assert.doesNotMatch(r.text, /-\d/);
    });

    it('17. shouldEarlyRefetch', () => {
        const ok = { readingMs: NOW - 120 * MIN, now: NOW, online: true, source: 'live', early: false };
        assert.equal(shouldEarlyRefetch(ok), true);
        assert.equal(shouldEarlyRefetch({ ...ok, early: true }), false);
        assert.equal(shouldEarlyRefetch({ ...ok, online: false }), false);
        assert.equal(shouldEarlyRefetch({ ...ok, source: 'cached' }), false);
        assert.equal(shouldEarlyRefetch({ ...ok, readingMs: NOW - 119 * MIN }), false);
        assert.equal(shouldEarlyRefetch({ ...ok, readingMs: null }), false);
    });

    it('18. no dash punctuation in any returned string (en and em dash; no hyphen in the text)', () => {
        for (const m of [0, 1, 30, 119, 120, 200, 400, 5000, 20000]) {
            for (const online of [true, false]) {
                for (const source of ['live', 'cached', 'stale']) {
                    for (const fetchAge of [0, 60, 600]) {
                        for (const por of [NOW - m * MIN, null]) {
                            const r = describeFreshness({ now: NOW, online, source, fetchMs: NOW - fetchAge * MIN, readingMs: NOW - m * MIN, lfMs: NOW - m * MIN, porMs: por });
                            assert.doesNotMatch(r.text, /[-–—]/);
                            assert.doesNotMatch(r.title, /[–—]/);
                        }
                    }
                }
            }
        }
        assert.doesNotMatch(describeFreshness({ now: NOW, online: true, source: 'live', readingMs: null }).title, /[–—]/);
    });
});


describe('boundaries and rounding (review tests-and-docs-4)', () => {
    it('22. just now cutoff is 2 minutes, floor not round', () => {
        assert.equal(withAge(1).text, 'Latest reading just now');
        assert.equal(withAge(2).text, 'Latest reading 2m ago');
        // 1 min 59 s must floor to 1 min (just now); Math.round would give 2m.
        const r = describeFreshness({ ...base, readingMs: NOW - 119 * 1000, lfMs: NOW - 119 * 1000, porMs: NOW - 119 * 1000 });
        assert.equal(r.text, 'Latest reading just now');
        // 119.9 min stays fresh and shows 1h 59m.
        const q = describeFreshness({ ...base, readingMs: NOW - 119.9 * MIN, lfMs: NOW - 119.9 * MIN, porMs: NOW - 119.9 * MIN });
        assert.equal(q.className, 'fresh');
        assert.match(q.text, /1h 59m/);
    });

    it('23. stalled-refresh fetch age boundary is 20 minutes (20 quiet, 21 called out)', () => {
        assert.doesNotMatch(withAge(130, { fetchMs: NOW - 20 * MIN }).text, /not refreshed/);
        assert.match(withAge(130, { fetchMs: NOW - 21 * MIN }).text, /not refreshed since/);
    });

    it('24. clock skew boundary is 5 minutes ahead', () => {
        const at = (min) => describeFreshness({ ...base, readingMs: NOW + min * MIN, lfMs: NOW + min * MIN, porMs: NOW + min * MIN });
        assert.doesNotMatch(at(5).title, /clock/);
        assert.match(at(6).title, /Device clock may be wrong/);
    });

    it('25. payloadReadingMs and isOldPayload', () => {
        const p = payload(
            series(LF, [pt(NOW - 90 * MIN, 5000), pt(NOW - 30 * MIN, 5100)]),
            series(POR, [pt(NOW - 60 * MIN, 4100)]),
            series(LF, [pt(NOW - 1 * MIN, 9)], '00065')
        );
        assert.equal(payloadReadingMs(p), NOW - 60 * MIN);
        assert.equal(payloadReadingMs(payload(series(LF, [pt(NOW - 30 * MIN, 1)]))), NOW - 30 * MIN);
        assert.equal(payloadReadingMs(payload(series('x', [pt(NOW, 1)]))), null);
        assert.equal(payloadReadingMs({}), null);
        assert.equal(isOldPayload(NOW - 119 * MIN, NOW), false);
        assert.equal(isOldPayload(NOW - 120 * MIN, NOW), true);
        assert.equal(isOldPayload(null, NOW), false);
    });
});

// ---- wiring ---------------------------------------------------------------
describe('wiring', () => {
    it('19. updateStalenessDisplay uses reading time, not fetch time', () => {
        const el = { textContent: '', className: '', title: '' };
        globalThis.document = { getElementById: (id) => (id === 'lastUpdate' ? el : null) };
        try {
            const now = Date.now();
            F.store.setLastFetchTime(now);
            F.store.setDataSource('live');
            F.store.setLastReading({ ms: now - 300 * MIN, lf: now - 300 * MIN, por: now - 300 * MIN });
            F.updateStalenessDisplay();
            assert.match(el.textContent, /5h/);
            assert.doesNotMatch(el.textContent, /just now/);
            assert.match(el.className, /old/);
        } finally {
            delete globalThis.document;
        }
    });

    it('20. processData sets lastReading from the payload, and null for an empty payload', () => {
        const t = Date.now() - 300 * MIN;
        F.store.setLastReading(null); // do not inherit test 19's leftover state
        run(payload(series(LF, [pt(t, 5000)]), series(POR, [pt(t, 4000)])));
        assert.equal(F.store.lastReading.ms, t);
        quiet(() => F.processData({}));
        assert.equal(F.store.lastReading, null);
    });

    it('21. structural: fetchData, updateStalenessDisplay and init wiring', () => {
        const f = read('src/data/fetch.js');
        const noData = f.slice(f.indexOf('if (!usgsJson) {'), f.indexOf('processData(usgsJson);'));
        assert.match(noData, /setLastReading\(null\)/);
        const fd = f.slice(f.indexOf('export async function fetchData'), f.indexOf('// ==================== STATUS'));
        assert.match(fd, /shouldEarlyRefetch/);
        const us = f.slice(f.indexOf('export function updateStalenessDisplay'), f.indexOf('// ==================== FORMATTING'));
        assert.match(us, /lastReading/);
        assert.match(us, /describeFreshness/);
        assert.doesNotMatch(us, /Date\.now\(\) - lastFetchTime/);
        const init = read('src/init.js');
        assert.match(init, /addEventListener\('online', updateStalenessDisplay\)/);
        assert.match(init, /addEventListener\('offline', updateStalenessDisplay\)/);
    });
});

// ---- fetchData and label wiring with a fake browser (review C1, SW-1, tests-and-docs-2, -3) ----
describe('fetchData wiring', () => {
    const els = {};
    const timers = [];
    const saved = {};
    const setGlobal = (k, v) => {
        if (!(k in saved)) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k) ?? null;
        Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    };
    const restoreAll = () => {
        for (const [k, d] of Object.entries(saved)) {
            if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k];
            delete saved[k];
        }
    };
    const el = (id) => (els[id] ??= { style: {}, classList: { add() {}, remove() {} }, textContent: '', className: '', title: '' });
    let directBody, proxyBody, online;
    const reply = (body) => (body ? { ok: true, json: async () => body } : { ok: false, json: async () => ({}) });
    const setup = ({ direct, proxy, isOnline = true }) => {
        directBody = direct; proxyBody = proxy; online = isOnline;
        muteConsole();
        timers.length = 0;
        for (const k of Object.keys(els)) delete els[k];
        setGlobal('document', { getElementById: el });
        setGlobal('navigator', { get onLine() { return online; } });
        setGlobal('setTimeout', (fn, ms) => { timers.push({ fn, ms }); return timers.length; });
        setGlobal('clearTimeout', () => {});
        setGlobal('fetch', async (u) => {
            const url = String(u);
            if (!url.includes('P7D')) return reply(null);
            if (url.startsWith('https://waterservices.usgs.gov/')) return reply(directBody);
            return reply(proxyBody);
        });
        F.store.setIsFetching(false);
        F.store.setLastReading(null);
        F.store.setLastFetchTime(null);
        F.clearChainMemo(); // the unknown-body memo is module state inside the bundle
    };
    // earlyRefetchTimer is module state: fire any pending early callback so the next test starts clean.
    afterEach(async () => {
        for (const t of early()) t.fn();
        for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
        restoreAll();
        unmuteConsole();
    });
    const bodyAged = (min) => {
        const t = Date.now() - min * MIN;
        return payload(series(LF, [pt(t, 5000)]), series(POR, [pt(t, 4000)]));
    };
    const early = () => timers.filter((x) => x.ms === 60000);
    const go = async (opts) => { await F.fetchData(opts); };

    it('26. SW-1: an old direct payload (SW cache fallback) still tries the proxies and the newest reading wins', async () => {
        setup({ direct: bodyAged(300), proxy: bodyAged(40) });
        await go();
        const ms = F.store.lastReading.ms;
        assert.ok(Date.now() - ms < 60 * MIN, 'proxy payload with the newer reading must be used');
        assert.equal(F.store.dataSource, 'live');
        assert.equal(early().length, 0);
    });

    it('27. SW-1: when the proxies are no better, the direct payload is kept and still counts as live', async () => {
        setup({ direct: bodyAged(300), proxy: null });
        await go();
        assert.ok(Date.now() - F.store.lastReading.ms > 290 * MIN);
        assert.equal(F.store.dataSource, 'live');
    });

    it('28. fresh direct payload does not touch the proxies and schedules no early refetch', async () => {
        let proxyHit = false;
        setup({ direct: bodyAged(40), proxy: bodyAged(10) });
        const inner = globalThis.fetch;
        setGlobal('fetch', async (u) => { if (!String(u).startsWith('https://waterservices.usgs.gov/')) proxyHit = proxyHit || String(u).includes('P7D'); return inner(u); });
        await go();
        assert.equal(proxyHit, false);
        assert.equal(early().length, 0);
    });

    it('29. old readings schedule exactly one early refetch at 60000 ms, and the early run never schedules another', async () => {
        setup({ direct: bodyAged(300), proxy: bodyAged(300) });
        await go();
        assert.equal(early().length, 1);
        await go(); // a second cycle before the timer fires must not stack a second timer
        assert.equal(early().length, 1);
        const cb = early()[0].fn;
        cb(); // fires fetchData({ early: true })
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        assert.equal(early().length, 1, 'early run must not schedule another');
    });

    it('30. no early refetch when offline', async () => {
        setup({ direct: bodyAged(300), proxy: null, isOnline: false });
        await go();
        assert.equal(early().length, 0);
    });

    it('31. C1: a mid-fetch redraw keeps the label for the payload on screen', () => {
        setup({ direct: null, proxy: null });
        const now = Date.now();
        F.store.setLastFetchTime(now);
        F.store.setDataSource('live');
        F.store.setLastReading(null); // new payload fetched, processData not yet run
        F.store.setIsFetching(true);
        const target = el('lastUpdate');
        target.textContent = 'Latest reading 10m ago';
        F.updateStalenessDisplay(); // 60 s tick or online event
        assert.equal(target.textContent, 'Latest reading 10m ago');
        F.updateStalenessDisplay({ ignoreFetching: true }); // setStatus final redraw
        assert.equal(target.textContent, 'Reading time unknown');
        F.store.setIsFetching(false);
    });

    it('32. tests-and-docs-3: the browser online state reaches the label (offline shows Saved copy)', () => {
        setup({ direct: null, proxy: null, isOnline: false });
        const now = Date.now();
        F.store.setLastFetchTime(now);
        F.store.setDataSource('live'); // the SW served its cache as a 200 while offline
        F.store.setLastReading({ ms: now - 10 * MIN, lf: now - 10 * MIN, por: now - 10 * MIN });
        F.updateStalenessDisplay();
        assert.ok(el('lastUpdate').textContent.startsWith('Saved copy: '), el('lastUpdate').textContent);
        online = true;
        F.updateStalenessDisplay();
        assert.ok(el('lastUpdate').textContent.startsWith('Latest reading'), el('lastUpdate').textContent);
    });

    it('33. structural: early refetch guard, delay and early flag', () => {
        const f = read('src/data/fetch.js');
        const fd = f.slice(f.indexOf('export async function fetchData'), f.indexOf('// ==================== STATUS'));
        assert.match(fd, /!earlyRefetchTimer && shouldEarlyRefetch\(/);
        assert.match(fd, /setTimeout\(\(\) => \{ earlyRefetchTimer = null; fetchData\(\{ early: true \}\); \}, 60000\)/);
        assert.match(fd, /\bearly\s*\n/);
    });
});

// ---- amendment: body time (requestDT) ---------------------------------------
// Shape taken from a live GET on 2026-11-10:
// https://waterservices.usgs.gov/nwis/iv/?format=json&sites=01646500&parameterCd=00060&period=PT2H
// value.queryInfo.note = [{value:'[ALL:01646500]',title:'filter:sites'}, ..., {value:'2026-11-10T18:10:32.962Z',title:'requestDT'}, ...]
const LIVE_NOTES = [
    { value: '[ALL:01646500]', title: 'filter:sites' },
    { value: '[mode=PERIOD, period=PT2H, modifiedSince=null]', title: 'filter:timeRange' },
    { value: 'methodIds=[ALL]', title: 'filter:methodId' },
    { value: '2026-11-10T18:10:32.962Z', title: 'requestDT' },
    { value: '0524ff10-dd32-11f1-ac9d-2cea7f5e5ede', title: 'requestId' },
    { value: 'Provisional data are subject to revision.', title: 'disclaimer' },
    { value: 'sdas01', title: 'server' }
];
const withNotes = (notes, ...ts) => ({ value: { queryInfo: { note: notes }, timeSeries: ts } });
const reqNote = (ms) => [{ value: iso(ms), title: 'requestDT' }];

describe('bodyTimeMs', () => {
    const at = Date.parse('2026-11-10T18:10:40Z');
    it('34. reads requestDT from a live-shaped payload', () => {
        assert.equal(bodyTimeMs(withNotes(LIVE_NOTES), at), Date.parse('2026-11-10T18:10:32.962Z'));
    });
    it('35. null for missing, wrong-shaped or unparseable notes', () => {
        assert.equal(bodyTimeMs(null, at), null);
        assert.equal(bodyTimeMs({}, at), null);
        assert.equal(bodyTimeMs({ value: {} }, at), null);
        assert.equal(bodyTimeMs({ value: { queryInfo: {} } }, at), null);
        assert.equal(bodyTimeMs({ value: { queryInfo: { note: 'requestDT' } } }, at), null);
        assert.equal(bodyTimeMs(withNotes([{ value: 'x', title: 'server' }]), at), null);
        assert.equal(bodyTimeMs(withNotes([null, { title: 'requestDT' }]), at), null);
        assert.equal(bodyTimeMs(withNotes([{ value: 12345, title: 'requestDT' }]), at), null);
        assert.equal(bodyTimeMs(withNotes([{ value: 'not a date', title: 'requestDT' }]), at), null);
    });
    it('36. future: up to 5 min ahead is accepted, more than 5 min gives null', () => {
        assert.equal(bodyTimeMs(withNotes(reqNote(at + 5 * MIN)), at), at + 5 * MIN);
        assert.equal(bodyTimeMs(withNotes(reqNote(at + 5 * MIN + 1000)), at), null);
    });
});

describe('classifyOldPayload (A2, A3)', () => {
    const old = NOW - 300 * MIN;
    it('37. body 10 min old is a live answer, 11 min is a saved copy', () => {
        assert.equal(BODY_FRESH_MIN, 10);
        assert.equal(classifyOldPayload({ readingMs: old, bodyMs: NOW - 10 * MIN, now: NOW }), 'live-behind');
        assert.equal(classifyOldPayload({ readingMs: old, bodyMs: NOW - 11 * MIN, now: NOW }), 'saved-copy');
    });
    it('38. unknown body time with old readings', () => {
        assert.equal(classifyOldPayload({ readingMs: old, bodyMs: null, now: NOW }), 'unknown-body');
    });
    it('39. fresh readings are never reclassified, whatever the body time', () => {
        for (const bodyMs of [null, NOW - 5 * MIN, NOW - 600 * MIN]) {
            assert.equal(classifyOldPayload({ readingMs: NOW - 119 * MIN, bodyMs, now: NOW }), 'readings-fresh');
        }
        assert.equal(classifyOldPayload({ readingMs: null, bodyMs: NOW - 600 * MIN, now: NOW }), 'readings-fresh');
    });
});

describe('unknown-body memo (pure)', () => {
    it('40. suppresses for the same reading time under 60 min, releases at 60 min or on a new reading time', () => {
        clearChainMemo();
        assert.equal(CHAIN_MEMO_MIN, 60);
        assert.equal(chainSuppressed(1000, NOW), false);
        noteChainFoundNothing(1000, NOW);
        assert.equal(chainSuppressed(1000, NOW + 59 * MIN), true);
        assert.equal(chainSuppressed(1000, NOW + 60 * MIN), false);
        assert.equal(chainSuppressed(2000, NOW + 1 * MIN), false);
        clearChainMemo();
        assert.equal(chainSuppressed(1000, NOW + 1 * MIN), false);
    });
});

describe('label with body time (A4)', () => {
    const base = { readingMs: NOW - 300 * MIN, lfMs: NOW - 300 * MIN, porMs: NOW - 300 * MIN, fetchMs: NOW, now: NOW, online: true, source: 'live' };
    it('41. old readings in a body older than 10 min at fetch time read as a saved copy, even online and live', () => {
        const f = describeFreshness({ ...base, bodyMs: NOW - 11 * MIN });
        assert.ok(f.text.startsWith('Saved copy: readings 5h'), f.text);
        assert.notEqual(f.className, 'fresh');
        assert.match(f.title, /Source: saved copy/);
    });
    it('42. old readings in a fresh body use the normal online wording, and the title carries the body time', () => {
        const f = describeFreshness({ ...base, bodyMs: NOW - 10 * MIN });
        assert.equal(f.text, 'Readings 5h 0m old'.replace('5h 0m', '5h'));
        assert.equal(f.className, 'old');
        assert.match(f.title, new RegExp(`Server response: ${new Date(NOW - 10 * MIN).toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
        assert.match(f.title, /Source: live/);
    });
    it('43. unknown body time changes nothing; the title says none', () => {
        const f = describeFreshness({ ...base, bodyMs: null });
        assert.equal(f.text, 'Readings 5h old');
        assert.match(f.title, /Server response: none/);
    });
    it('44. fresh readings ignore body time', () => {
        const f = describeFreshness({ ...base, readingMs: NOW - 40 * MIN, lfMs: NOW - 40 * MIN, porMs: NOW - 40 * MIN, bodyMs: NOW - 600 * MIN });
        assert.equal(f.text, 'Latest reading 40m ago');
        assert.equal(f.className, 'fresh');
    });
    it('45. body age is measured at fetch time, so a live body does not turn into a saved copy as the tab ages', () => {
        const f = describeFreshness({ ...base, fetchMs: NOW - 30 * MIN, bodyMs: NOW - 35 * MIN, now: NOW });
        assert.doesNotMatch(f.text, /^Saved copy/);
    });
    it('46. shouldEarlyRefetch honours allowed:false', () => {
        const i = { readingMs: NOW - 300 * MIN, now: NOW, online: true, source: 'live', early: false };
        assert.equal(shouldEarlyRefetch(i), true);
        assert.equal(shouldEarlyRefetch({ ...i, allowed: false }), false);
    });
    it('47. no em-dash in new strings', () => {
        for (const b of [null, NOW - 5 * MIN, NOW - 90 * MIN]) {
            const f = describeFreshness({ ...base, bodyMs: b });
            assert.doesNotMatch(f.text, /[-\u2013\u2014]/);
            assert.doesNotMatch(f.title, /[\u2013\u2014]/);
        }
    });
});

describe('fetchData with body time (A2, A4)', () => {
    const els = {};
    const timers = [];
    const saved = {};
    const setGlobal = (k, v) => {
        if (!(k in saved)) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k) ?? null;
        Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    };
    const el = (id) => (els[id] ??= { style: {}, classList: { add() {}, remove() {} }, textContent: '', className: '', title: '' });
    const realNow = Date.now;
    const clock = realNow(); // frozen clock so the 10 and 11 minute boundaries are exact
    let offset = 0;
    let mainCalls = 0, proxyCalls = 0, direct, proxy;
    const reply = (b) => (b ? { ok: true, json: async () => b } : { ok: false, json: async () => ({}) });
    const early = () => timers.filter((x) => x.ms === 60000);
    const mk = (readingAgoMin, bodyAgoMin) => {
        const t = clock - readingAgoMin * MIN;
        const ts = [series(LF, [pt(t, 5000)]), series(POR, [pt(t, 4000)])];
        return bodyAgoMin === null ? payload(...ts) : withNotes(reqNote(clock - bodyAgoMin * MIN), ...ts);
    };
    const setup = (d, p) => {
        direct = d; proxy = p; mainCalls = 0; proxyCalls = 0; offset = 0;
        muteConsole();
        timers.length = 0;
        for (const k of Object.keys(els)) delete els[k];
        setGlobal('document', { getElementById: el });
        setGlobal('navigator', { get onLine() { return true; } });
        setGlobal('setTimeout', (fn, ms) => { timers.push({ fn, ms }); return timers.length; });
        setGlobal('clearTimeout', () => {});
        setGlobal('fetch', async (u) => {
            const url = String(u);
            if (!url.includes('P7D')) return reply(null);
            if (url.startsWith('https://waterservices.usgs.gov/')) { mainCalls++; return reply(direct); }
            proxyCalls++;
            return reply(proxy);
        });
        Date.now = () => clock + offset;
        F.store.setIsFetching(false);
        F.store.setLastReading(null);
        F.store.setLastFetchTime(null);
        F.clearChainMemo();
    };
    afterEach(async () => {
        const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; // stray output corrupts the runner channel
        for (const t of early()) t.fn();
        timers.length = 0;
        for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
        await new Promise((r) => realSetTimeout(r, 40));
        unmuteConsole();
        Date.now = realNow;
        for (const [k, d] of Object.entries(saved)) {
            if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k];
            delete saved[k];
        }
    });
    const go = async (opts) => { await F.fetchData(opts); };
    const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };

    it('48. fresh body with old readings: exactly one main request, no proxies, no early timer, normal label', async () => {
        setup(mk(300, 5), mk(10, 1));
        await go();
        assert.equal(mainCalls, 1);
        assert.equal(proxyCalls, 0);
        assert.equal(early().length, 0);
        assert.equal(F.store.dataSource, 'live');
        assert.ok(Date.now() - F.store.lastReading.ms > 290 * MIN);
        assert.match(el('lastUpdate').textContent, /^Readings 5h/);
    });

    it('49. boundary through fetchData: body 10 min old is accepted at once, 11 min walks the chain', async () => {
        setup(mk(300, 10), mk(300, 10));
        await go();
        assert.equal(proxyCalls, 0);
        assert.equal(early().length, 0);
        await settle();
        setup(mk(300, 11), mk(300, 11));
        await go();
        assert.equal(proxyCalls, 2);
        assert.equal(early().length, 1);
    });

    it('50. old body with old readings: walks the chain, keeps the newest, one early timer, label says saved copy', async () => {
        setup(mk(300, 45), null);
        await go();
        assert.equal(mainCalls, 1);
        assert.equal(proxyCalls, 2);
        assert.equal(early().length, 1);
        assert.equal(F.store.dataSource, 'live');
        assert.match(el('lastUpdate').textContent, /^Saved copy: readings 5h/);
    });

    it('51. old body, proxy has a newer reading: the proxy payload wins and the label is normal', async () => {
        setup(mk(300, 45), mk(30, 1));
        await go();
        assert.ok(Date.now() - F.store.lastReading.ms < 60 * MIN);
        assert.equal(early().length, 0);
        assert.match(el('lastUpdate').textContent, /^Latest reading/);
    });

    it('52. fresh readings behave as before whatever the body time', async () => {
        setup(mk(40, 600), mk(10, 1));
        await go();
        assert.equal(proxyCalls, 0);
        assert.equal(early().length, 0);
        assert.match(el('lastUpdate').textContent, /^Latest reading/);
    });

    it('53. unknown body: first cycle walks the chain and allows one early timer, the second cycle is suppressed', async () => {
        const d = mk(300, null);
        setup(d, d);
        await go();
        assert.equal(mainCalls, 1);
        assert.equal(proxyCalls, 2);
        assert.equal(early().length, 1);
        // the early run reuses the memo: one main request only, and it schedules nothing
        early()[0].fn();
        await settle();
        assert.equal(mainCalls, 2);
        assert.equal(proxyCalls, 2);
        assert.equal(early().length, 1, 'the early run must not schedule another');
        timers.length = 0;
        // next regular cycle, same reading time: no chain, no early timer
        await go();
        assert.equal(mainCalls, 3);
        assert.equal(proxyCalls, 2);
        assert.equal(early().length, 0);
    });

    it('54. unknown body: the memo releases when the reading time changes', async () => {
        const d = mk(300, null);
        setup(d, d);
        await go();
        early()[0].fn(); await settle(); timers.length = 0; // the early run, then a clean slate
        await go();
        assert.equal(proxyCalls, 2, 'suppressed while the reading time is the same');
        direct = mk(290, null); // gauge reported again, still old
        await go();
        assert.equal(proxyCalls, 4, 'a new reading time runs the chain again');
        assert.equal(early().length, 1);
    });

    it('55. unknown body: the memo releases after 60 minutes', async () => {
        const d = mk(300, null);
        setup(d, d);
        await go();
        early()[0].fn(); await settle(); timers.length = 0;
        offset = 59 * MIN;
        await go();
        assert.equal(proxyCalls, 2, 'still suppressed at 59 min');
        offset = 61 * MIN;
        await go();
        assert.equal(proxyCalls, 4, 'released after 60 min');
        assert.equal(early().length, 1);
    });

    it('56. unknown body: a chain that finds something newer leaves no memo', async () => {
        setup(mk(300, null), mk(30, null));
        await go();
        timers.length = 0;
        await go();
        assert.equal(proxyCalls, 2, 'one proxy call per cycle: the second cycle tries the chain again (direct still old, first proxy fresh)');
    });

    it('58. review B-1/T-3: equal readings, saved direct body and live proxy body: the live body wins, normal wording, no early timer', async () => {
        setup(mk(300, 45), mk(300, 1));
        await go();
        assert.equal(mainCalls, 1);
        assert.equal(early().length, 0);
        assert.match(el('lastUpdate').textContent, /^Readings 5h/);
        assert.doesNotMatch(el('lastUpdate').textContent, /^Saved copy/);
    });

    it('59. review T-2: a newer but still old proxy payload with a live body schedules no early refetch', async () => {
        setup(mk(300, 45), mk(250, 1));
        await go();
        assert.equal(proxyCalls, 2);
        assert.equal(early().length, 0);
        assert.match(el('lastUpdate').textContent, /^Readings 4h/);
    });

    it('60. review T-1: a chain that finds a newer (still old) reading clears the memo, so the next cycle walks the chain again', async () => {
        setup(mk(300, null), mk(200, null));
        await go();
        assert.equal(proxyCalls, 2);
        await go();
        assert.equal(proxyCalls, 4, 'memo must not suppress the second cycle');
        assert.ok(Date.now() - F.store.lastReading.ms < 210 * MIN, 'the newer proxy reading is shown');
    });

    it('61. review B-2: a saved-copy body (fast device clock) is rate limited like an unknown body: one chain per reading time per 60 min', async () => {
        setup(mk(300, 30), null);
        await go();
        assert.equal(proxyCalls, 2);
        assert.equal(early().length, 1);
        early()[0].fn(); await settle();
        assert.equal(proxyCalls, 2, 'the early run is suppressed by the memo');
        timers.length = 0;
        await go();
        assert.equal(mainCalls, 3);
        assert.equal(proxyCalls, 2, 'second cycle suppressed');
        assert.equal(early().length, 0);
        assert.match(el('lastUpdate').textContent, /^Saved copy/);
        offset = 61 * MIN;
        await go();
        assert.equal(proxyCalls, 4, 'released after 60 min');
    });

    it('57. structural: fetchUSGS classifies by body time and fetchData passes the early permission', () => {
        const f = read('src/data/fetch.js');
        const fd = f.slice(f.indexOf('export async function fetchData'), f.indexOf('// ==================== STATUS'));
        assert.match(fd, /classifyOldPayload\(/);
        assert.match(fd, /chainSuppressed\(/);
        assert.match(fd, /noteChainFoundNothing\(/);
        assert.match(fd, /allowed: earlyOk/);
        assert.match(f, /bodyMs: bodyTimeMs\(json\)/);
        assert.match(f, /bodyMs: lastReading\?\.bodyMs/);
    });
});

describe('title source follows body age (review B-5)', () => {
    it('62. fresh readings in an old body: text and class unchanged, the hover names a saved copy', () => {
        const f = describeFreshness({ readingMs: NOW - 40 * MIN, lfMs: NOW - 40 * MIN, porMs: NOW - 40 * MIN, bodyMs: NOW - 90 * MIN, fetchMs: NOW, now: NOW, online: true, source: 'live' });
        assert.equal(f.text, 'Latest reading 40m ago');
        assert.equal(f.className, 'fresh');
        assert.match(f.title, /Source: saved copy/);
    });
});

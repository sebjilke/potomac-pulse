// v39.7: the learning load has a 10 s deadline, shares one request, never lets an older request overwrite a
// newer one (admin reset), and emits 'learning:loaded' once per settle. fetch and timers are stubbed.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadGFLearningData } from '../src/learning/gf-learning.js';
import * as store from '../src/state/store.js';
import { on, clear } from '../src/state/event-bus.js';

const realFetch = globalThis.fetch, realST = globalThis.setTimeout, realCT = globalThis.clearTimeout;
const realLog = console.log, realWarn = console.warn;
let timers, fetchCalls, nextFetch, loaded;

const good = (tag) => ({ correctionBins: { tag }, pendingPredictions: [], metadata: { totalValidations: 1 }, efCorrelation: null });
const never = () => new Promise(() => {});
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });
const fireDeadline = () => { const t = timers.find((x) => x.ms === 10000 && !x.cleared); assert.ok(t, 'a 10 s deadline timer must be pending'); t.fn(); };
// Fails (instead of hanging) when the load never settles. Uses the real timer: setTimeout is stubbed in these tests.
const within = (p, ms = 1500) => Promise.race([p, new Promise((_, rej) => realST(() => rej(new Error('load did not settle: the deadline race is missing')), ms))]);
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

beforeEach(() => {
    timers = []; fetchCalls = []; loaded = 0;
    console.log = () => {}; console.warn = () => {};
    store.setGfLearningData(null);
    store.setGfDataReady(false);
    clear();
    on('learning:loaded', () => { loaded++; });
    globalThis.setTimeout = (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; };
    globalThis.clearTimeout = (t) => { if (t) t.cleared = true; };
    globalThis.fetch = (url, opts) => { fetchCalls.push({ url, opts }); return nextFetch(url, opts); };
});
afterEach(() => {
    globalThis.fetch = realFetch; globalThis.setTimeout = realST; globalThis.clearTimeout = realCT;
    console.log = realLog; console.warn = realWarn;
    clear();
    store.setGfLearningData(null); store.setGfDataReady(false);
});

const EMPTY_SHAPE = (d) => d && typeof d.correctionBins === 'object' && Object.keys(d.correctionBins).length === 0 && d.efCorrelation === null;

describe('learning deadline', () => {
    it('success: store filled, ready, one event, timer cleared', async () => {
        nextFetch = async () => okResponse(good('A'));
        await loadGFLearningData();
        assert.equal(store.gfLearningData.correctionBins.tag, 'A');
        assert.equal(store.gfDataReady, true);
        assert.equal(loaded, 1);
        assert.ok(timers.every((t) => t.cleared));
    });
    it('hung headers (fetch ignores the abort): the timer race still ends it, empty data, ready', { timeout: 2000 }, async () => {
        nextFetch = () => never();
        const p = loadGFLearningData();
        await tick();
        assert.equal(store.gfDataReady, false);
        fireDeadline();
        await within(p);
        assert.ok(EMPTY_SHAPE(store.gfLearningData));
        assert.equal(store.gfDataReady, true);
        assert.equal(loaded, 1);
    });
    it('hung headers: the abort signal is fired at the deadline', { timeout: 2000 }, async () => {
        let signal;
        nextFetch = (u, o) => { signal = o.signal; return never(); };
        const p = loadGFLearningData();
        await tick();
        assert.equal(signal.aborted, false);
        fireDeadline();
        await within(p);
        assert.equal(signal.aborted, true);
    });
    it('stalled body after headers: still ends at the deadline', { timeout: 2000 }, async () => {
        nextFetch = async () => ({ ok: true, status: 200, json: () => never() });
        const p = loadGFLearningData();
        await tick();
        fireDeadline();
        await within(p);
        assert.ok(EMPTY_SHAPE(store.gfLearningData));
        assert.equal(store.gfDataReady, true);
    });
    it('500: empty data on first load, ready, one event', async () => {
        nextFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
        await loadGFLearningData();
        assert.ok(EMPTY_SHAPE(store.gfLearningData));
        assert.equal(store.gfDataReady, true);
        assert.equal(loaded, 1);
    });
    it('bad JSON: empty data on first load, ready', async () => {
        nextFetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } });
        await loadGFLearningData();
        assert.ok(EMPTY_SHAPE(store.gfLearningData));
        assert.equal(store.gfDataReady, true);
    });
    it('failures on a later cycle keep the previous payload (timeout, 500, bad JSON)', async () => {
        nextFetch = async () => okResponse(good('PREV'));
        await loadGFLearningData();
        nextFetch = () => never();
        let p = loadGFLearningData(); await tick(); fireDeadline(); await p;
        assert.equal(store.gfLearningData.correctionBins.tag, 'PREV');
        nextFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
        await loadGFLearningData();
        assert.equal(store.gfLearningData.correctionBins.tag, 'PREV');
        nextFetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } });
        await loadGFLearningData();
        assert.equal(store.gfLearningData.correctionBins.tag, 'PREV');
        assert.equal(store.gfDataReady, true);
        assert.equal(loaded, 4);
    });
    it('two simultaneous calls share one request; force starts a second', async () => {
        const d = deferred();
        nextFetch = () => d.promise;
        const a = loadGFLearningData(), b = loadGFLearningData();
        assert.strictEqual(a, b);
        assert.equal(fetchCalls.length, 1);
        const c = loadGFLearningData({ force: true });
        assert.notStrictEqual(a, c);
        assert.equal(fetchCalls.length, 2);
        d.resolve(okResponse(good('X')));
        await Promise.all([a, c]);
    });
    it('after a settle, the next call starts a fresh request', async () => {
        nextFetch = async () => okResponse(good('A'));
        await loadGFLearningData();
        await loadGFLearningData();
        assert.equal(fetchCalls.length, 2);
        assert.equal(store.learningInFlight, null);
    });
    it('PA-4: a forced load that finishes first is not overwritten by the older request', async () => {
        const old = deferred(), forced = deferred();
        const queue = [old, forced];
        nextFetch = () => queue.shift().promise;
        const a = loadGFLearningData();
        const b = loadGFLearningData({ force: true });
        forced.resolve(okResponse(good('POST-RESET')));
        await b;
        assert.equal(store.gfLearningData.correctionBins.tag, 'POST-RESET');
        old.resolve(okResponse(good('PRE-RESET')));
        await a;
        assert.equal(store.gfLearningData.correctionBins.tag, 'POST-RESET', 'the old request must not write');
        assert.equal(loaded, 1, 'the superseded request emits nothing');
    });
    it('PA-4: the old request settling does not clear the forced request from the shared slot', async () => {
        const old = deferred(), forced = deferred();
        const queue = [old, forced];
        nextFetch = () => queue.shift().promise;
        const a = loadGFLearningData();
        const b = loadGFLearningData({ force: true });
        old.resolve(okResponse(good('PRE')));
        await a;
        assert.strictEqual(store.learningInFlight, b);
        const c = loadGFLearningData(); // must share the forced one, not start a third
        assert.strictEqual(c, b);
        assert.equal(fetchCalls.length, 2);
        forced.resolve(okResponse(good('POST')));
        await b;
        assert.equal(store.gfLearningData.correctionBins.tag, 'POST');
    });
    it('learning:loaded is emitted once per settle, for each outcome', async () => {
        nextFetch = async () => okResponse(good('A'));
        await loadGFLearningData(); assert.equal(loaded, 1);
        nextFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
        await loadGFLearningData(); assert.equal(loaded, 2);
        nextFetch = () => never();
        const p = loadGFLearningData(); await tick(); fireDeadline(); await p;
        assert.equal(loaded, 3);
    });
    it('PA-9: a throwing learning:loaded handler does not make the load fail', async () => {
        clear();
        on('learning:loaded', () => { throw new Error('render broke'); });
        nextFetch = async () => okResponse(good('A'));
        const warns = [];
        console.warn = (...a) => warns.push(a.join(' '));
        await assert.doesNotReject(loadGFLearningData());
        assert.ok(warns.some((w) => w.includes('learning:loaded handler failed')), 'the emit itself is guarded');
        assert.equal(store.gfDataReady, true);
        assert.equal(store.gfLearningData.correctionBins.tag, 'A');
    });
});

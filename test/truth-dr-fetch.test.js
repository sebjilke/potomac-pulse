// v39.6 (A5): the Difficult Run fetch and parse, unit level. See
// analysis/truth-and-confidence-logging-plan-2026-11-10.md section 5.

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const model = require('../netlify/functions/shared/model');
model.getSupabase = () => null;
const { _test } = require('../netlify/functions/scheduled-update');
const { parseDifficultRun, fetchDifficultRun, compactSeries, cleanDr, DR_URL, DR_CAP_MS } = _test;
const { drPayload, iso, ts } = require('./helpers/usgs-mock');
const REAL = require('./fixtures/usgs-difficult-run-real.json');

const NOW = Date.UTC(2026, 10, 10, 21, 30, 0);
const flush = () => new Promise(r => setImmediate(r));
async function drive(t, fn) {
    let done = false, result, error;
    const p = fn().then(v => { done = true; result = v; }, e => { done = true; error = e; });
    for (let i = 0; i < 40 && !done; i++) { for (let k = 0; k < 6; k++) await flush(); if (!done) t.mock.timers.tick(250); }
    if (!done) throw new Error('drive: the call did not finish within the virtual time budget (a missing time cap?)');
    await p;
    if (error) throw error;
    return result;
}
const okResp = (json) => ({ ok: true, status: 200, json: async () => json });

describe('parseDifficultRun', () => {
    it('clean reading: last value, time, qualifiers, age, regular 15-minute tail', () => {
        const r = parseDifficultRun(drPayload(NOW, { vals: [12.7, 12.8, 13.1], ageMin: 73 }), NOW);
        assert.equal(r.q, 13.1);
        assert.equal(r.t, NOW - 73 * 60000);
        assert.deepEqual(r.qual, ['P']);
        assert.equal(r.why, null);
        assert.equal(Math.round(r.ageMin * 10) / 10, 73);
        assert.deepEqual(r.tail, { t0: NOW - (73 + 30) * 60000, step: 15, v: [12.7, 12.8, 13.1] });
    });
    it('the -05:00 offset is parsed to the right instant', () => {
        const r = parseDifficultRun(drPayload(NOW, { vals: [13], ageMin: 60, offset: '-05:00' }), NOW);
        assert.equal(r.t, NOW - 60 * 60000);
    });
    it('series are selected by site and parameter code, not by position', () => {
        const decoy1 = drPayload(NOW, { vals: [999], site: '01646500' }).value.timeSeries[0];
        const decoy2 = drPayload(NOW, { vals: [888], param: '00065' }).value.timeSeries[0];
        const real = drPayload(NOW, { vals: [13.5] }).value.timeSeries[0];
        const r = parseDifficultRun({ value: { timeSeries: [decoy1, decoy2, real] } }, NOW);
        assert.equal(r.q, 13.5);
        assert.equal(parseDifficultRun({ value: { timeSeries: [decoy1, decoy2] } }, NOW).why, 'no_series');
    });
    it('no series, empty value list, empty body', () => {
        assert.equal(parseDifficultRun({ value: { timeSeries: [] } }, NOW).why, 'no_series');
        assert.equal(parseDifficultRun({}, NOW).why, 'no_series');
        assert.equal(parseDifficultRun(null, NOW).why, 'no_series');
        const empty = { value: { timeSeries: [ts('01646000', '00060', [])] } };
        assert.equal(parseDifficultRun(empty, NOW).why, 'no_series');
    });
    it('sentinel as the LAST value gives q null even when earlier values are valid (last value only)', () => {
        const r = parseDifficultRun(drPayload(NOW, { vals: [12, 12.5, -999999] }), NOW);
        assert.equal(r.q, null);
        assert.equal(r.why, 'sentinel');
        assert.deepEqual(r.tail.v, [12, 12.5, null], 'earlier readings kept in the tail, the sentinel is null');
        assert.equal(r.t, NOW - 60 * 60000, 'reading time still recorded');
    });
    it('Ice qualifier: q null, why ice, qualifiers stored', () => {
        const r = parseDifficultRun(drPayload(NOW, { vals: [5], quals: ['P', 'Ice'] }), NOW);
        assert.equal(r.q, null);
        assert.equal(r.why, 'ice');
        assert.deepEqual(r.qual, ['P', 'Ice']);
    });
    it('negative is invalid; zero is valid (low flow)', () => {
        assert.equal(parseDifficultRun(drPayload(NOW, { vals: [-5] }), NOW).why, 'invalid');
        const z = parseDifficultRun(drPayload(NOW, { vals: [0] }), NOW);
        assert.equal(z.q, 0);
        assert.equal(z.why, null);
    });
    it('non-numeric value is invalid-class (sentinel path), not a crash', () => {
        const r = parseDifficultRun(drPayload(NOW, { vals: ['abc'] }), NOW);
        assert.equal(r.q, null);
        assert.ok(['sentinel', 'invalid'].includes(r.why));
    });
    it('an old reading keeps q and t and is marked old', () => {
        const r = parseDifficultRun(drPayload(NOW, { vals: [13], ageMin: 300 }), NOW);
        assert.equal(r.q, 13);
        assert.equal(r.t, NOW - 300 * 60000);
        assert.equal(r.why, 'old');
    });
    it('a reading time in the future keeps q and t and is marked future', () => {
        const r = parseDifficultRun(drPayload(NOW, { vals: [13], ageMin: -20 }), NOW);
        assert.equal(r.q, 13);
        assert.ok(r.ageMin < 0);
        assert.equal(r.why, 'future');
    });
    it('two values blocks (method ids): the block with the newest reading wins', () => {
        const a = drPayload(NOW, { vals: [10], ageMin: 120 }).value.timeSeries[0];
        const b = drPayload(NOW, { vals: [14], ageMin: 30 }).value.timeSeries[0];
        const s = { ...a, values: [a.values[0], b.values[0]] };
        assert.equal(parseDifficultRun({ value: { timeSeries: [s] } }, NOW).q, 14);
        const s2 = { ...a, values: [b.values[0], a.values[0]] };
        assert.equal(parseDifficultRun({ value: { timeSeries: [s2] } }, NOW).q, 14, 'order of blocks does not matter');
    });
    it('qualifier lists are stored as read, never interpreted', () => {
        for (const quals of [['P'], ['P', 'e'], ['A', 'Eqp'], ['P', 'Bkw']]) {
            const r = parseDifficultRun(drPayload(NOW, { vals: [13], quals }), NOW);
            assert.deepEqual(r.qual, quals);
            assert.equal(r.q, 13);
            assert.equal(r.why, null);
        }
    });
    it('irregular spacing is stored with its own times', () => {
        const base = drPayload(NOW, { vals: [1, 2, 3], ageMin: 60 });
        const pts = base.value.timeSeries[0].values[0].value;
        pts.splice(1, 1);   // a missing 15-minute reading
        const r = parseDifficultRun(base, NOW);
        assert.ok(r.tail.ts && !('t0' in r.tail));
        assert.deepEqual(r.tail.v, [1, 3]);
    });
    it('the tail is capped at the last 32 readings', () => {
        const r = parseDifficultRun(drPayload(NOW, { n: 60 }), NOW);
        assert.equal(r.tail.v.length, 32);
    });
});

describe('real USGS response format (qualifiers are plain strings)', () => {
    it('the saved real response parses: q, t, qual, age, tail, series chosen by site and parameter', () => {
        const real = JSON.parse(JSON.stringify(REAL));
        const vals = real.value.timeSeries[0].values[0].value;
        assert.ok(vals.every(v => Array.isArray(v.qualifiers) && v.qualifiers.every(q => typeof q === 'string')), 'fixture keeps the real string form');
        const at = Date.parse('2026-11-10T22:04:00.000Z');
        // a decoy series first: the real one must still be chosen by site and parameter code
        const decoy = drPayload(at, { vals: [999], site: '01646500' }).value.timeSeries[0];
        real.value.timeSeries.unshift(decoy);
        const r = parseDifficultRun(real, at);
        assert.deepEqual(r, {
            q: 13.5, t: Date.parse('2026-11-10T16:15:00.000-05:00'), qual: ['P'], why: null, ageMin: 49,
            tail: { t0: Date.parse('2026-11-10T15:00:00.000-05:00'), step: 15, v: [13.1, 13.1, 13.5, 13.5, 13.5, 13.5] }
        });
        assert.equal(r.t, Date.UTC(2026, 10, 10, 21, 15, 0));
    });
    it('a real-format Ice qualifier (strings) is detected: q null, why ice, qualifiers kept', () => {
        const real = JSON.parse(JSON.stringify(REAL));
        const vals = real.value.timeSeries[0].values[0].value;
        vals[vals.length - 1].qualifiers = ['P', 'Ice'];
        const r = parseDifficultRun(real, Date.parse('2026-11-10T22:04:00.000Z'));
        assert.equal(r.q, null);
        assert.equal(r.why, 'ice');
        assert.deepEqual(r.qual, ['P', 'Ice']);
        assert.deepEqual(r.tail.v.slice(-2), [13.5, null], 'the iced reading is null in the tail');
    });
    it('never yields the string "undefined" as a qualifier; empty and missing codes are dropped', () => {
        const real = JSON.parse(JSON.stringify(REAL));
        const vals = real.value.timeSeries[0].values[0].value;
        vals[vals.length - 1].qualifiers = ['P', '', null, {}, { qualifierCode: 'e' }];
        assert.deepEqual(parseDifficultRun(real, Date.parse('2026-11-10T22:04:00.000Z')).qual, ['P', 'e']);
        delete vals[vals.length - 1].qualifiers;
        assert.deepEqual(parseDifficultRun(real, Date.parse('2026-11-10T22:04:00.000Z')).qual, []);
    });
    it('the object form {qualifierCode} is also accepted (harmless)', () => {
        const r = parseDifficultRun(drPayload(NOW, { vals: [13], quals: ['P', 'Ice'], objectQuals: true }), NOW);
        assert.deepEqual(r.qual, ['P', 'Ice']);
        assert.equal(r.why, 'ice');
    });
});

describe('fetchDifficultRun', () => {
    function setup(t, handler) {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        t.mock.timers.setTime(NOW);
        const calls = [];
        t.mock.method(global, 'fetch', async (url, opts) => { calls.push({ url: String(url), signal: opts && opts.signal }); return handler(url, opts); });
        return calls;
    }

    it('one GET of the exact URL; clean result with fetch time and duration', async (t) => {
        const calls = setup(t, () => okResp(drPayload(NOW, { vals: [13.1], ageMin: 73 })));
        const r = await drive(t, () => fetchDifficultRun(NOW));
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, DR_URL);
        assert.match(DR_URL, /sites=01646000&parameterCd=00060&period=PT6H/);
        assert.equal(r.q, 13.1);
        assert.equal(r.at, NOW);
        assert.equal(r.ms, 0);
        assert.equal(r.why, null);
    });
    it('HTTP error, bad JSON, HTML body with status 200, network error', async (t) => {
        setup(t, () => ({ ok: false, status: 503, json: async () => { throw new Error('no'); } }));
        const a = await drive(t, () => fetchDifficultRun(NOW));
        assert.equal(a.why, 'http_error'); assert.equal(a.http, 503); assert.equal(a.q, null);
        t.mock.timers.reset(); t.mock.restoreAll();
        setup(t, () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } }));
        assert.equal((await drive(t, () => fetchDifficultRun(NOW))).why, 'parse_error');
        t.mock.timers.reset(); t.mock.restoreAll();
        setup(t, () => { throw new Error('ECONNRESET'); });
        assert.equal((await drive(t, () => fetchDifficultRun(NOW))).why, 'fetch_error');
        t.mock.timers.reset(); t.mock.restoreAll();
        setup(t, () => Promise.reject(new Error('down')));
        assert.equal((await drive(t, () => fetchDifficultRun(NOW))).why, 'fetch_error');
    });
    it('a Response with throwing getters is a result, not a throw', async (t) => {
        setup(t, () => ({ get ok() { throw new Error('getter boom'); }, get status() { throw new Error('getter boom'); }, json() { throw new Error('sync boom'); } }));
        const r = await drive(t, () => fetchDifficultRun(NOW));
        assert.equal(r.why, 'fetch_error');
        assert.equal(r.q, null);
    });
    it('hang before headers: timeout at the 2 s cap, the request is aborted', async (t) => {
        const calls = setup(t, () => new Promise(() => {}));
        const r = await drive(t, () => fetchDifficultRun(NOW));
        assert.equal(r.why, 'timeout');
        assert.equal(r.ms, DR_CAP_MS);
        assert.equal(calls[0].signal.aborted, true, 'abort fired');
    });
    it('headers arrive, body never resolves: still times out (the body is inside the cap)', async (t) => {
        const calls = setup(t, () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }));
        const r = await drive(t, () => fetchDifficultRun(NOW));
        assert.equal(r.why, 'timeout');
        assert.equal(r.ms, DR_CAP_MS);
        assert.equal(calls[0].signal.aborted, true);
    });
    it('a slow but in-time answer is accepted', async (t) => {
        setup(t, () => new Promise(res => setTimeout(() => res(okResp(drPayload(NOW, { vals: [13] }))), 1500)));
        const r = await drive(t, () => fetchDifficultRun(NOW));
        assert.equal(r.why, null);
        assert.equal(r.q, 13);
        assert.equal(r.ms, 1500);
    });
    it('late tick: no request at all, why late_skip', async (t) => {
        const calls = setup(t, () => okResp(drPayload(NOW)));
        const r = await drive(t, () => fetchDifficultRun(NOW - 21000));
        assert.equal(calls.length, 0);
        assert.equal(r.why, 'late_skip');
        const r2 = await drive(t, () => fetchDifficultRun(NOW - 19000));
        assert.equal(calls.length, 1, 'under 20 s still fetches');
        assert.equal(r2.why, null);
    });
});

describe('storage helpers', () => {
    it('cleanDr keeps plain numbers; the tail only when asked', () => {
        const dr = parseDifficultRun(drPayload(NOW, { vals: [13.123456, 13.2] }), NOW);
        dr.at = NOW; dr.ms = 12;
        const withTail = cleanDr(dr, true), without = cleanDr(dr, false);
        assert.ok(withTail.tail && !('tail' in without));
        assert.equal(withTail.q, 13.2);
        assert.deepEqual(Object.keys(without).sort(), ['ageMin', 'at', 'ms', 'q', 'qual', 't', 'why']);
        JSON.stringify(withTail);
    });
    it('compactSeries: regular, irregular, empty, bad input', () => {
        assert.deepEqual(compactSeries([{ t: 0, v: 1 }, { t: 900000, v: null }], 15), { t0: 0, step: 15, v: [1, null] });
        assert.deepEqual(compactSeries([{ t: 0, v: 1 }, { t: 1000000, v: 2 }], 15), { ts: [0, 1000000], v: [1, 2] });
        assert.equal(compactSeries([], 15), null);
        assert.equal(compactSeries(null, 15), null);
    });
});

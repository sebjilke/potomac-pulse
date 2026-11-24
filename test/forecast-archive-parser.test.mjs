// v39.15: the Weather Service forecast archive. Pure parts: the answer parser (N1), its parity with the
// browser parser (N2), and the row builder (N4). Fixtures are the real answers of 2026-11-24 (public data).
// Plan: analysis/forecast-archive-plan-2026-11-24.md (version 2), section 6.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { _test } = require('../netlify/functions/scheduled-update');
const { parseNwsForecastBody, buildNwsFcRecord, nwsFallback, NWS_ARCHIVE_GAUGES, FC_LOG_SCHEMA } = _test;
const { parseNWSForecast } = await import('../src/estimation/nws.js');
const { NWS_LIDS } = await import('../src/model/constants.js');

const fx = (n) => JSON.parse(fs.readFileSync(new URL('./fixtures/' + n, import.meta.url), 'utf8'));
const BRK = fx('nws-brkm2.json');
const POR = fx('nws-porm2.json');
const T = Date.UTC(2026, 10, 24, 14, 30, 0);

const quiet = (t) => { for (const m of ['log', 'warn', 'error']) t.mock.method(console, m, () => {}); };
const expectPts = (j) => j.data.map(p => [Date.parse(p.validTime), p.primary, p.secondary]);

describe('N1: parser over the saved live answers', () => {
    it('Little Falls: counts, times, units, exact points', () => {
        const r = parseNwsForecastBody(BRK);
        assert.equal(r.why, null);
        assert.equal(r.n, BRK.data.length);
        assert.equal(r.n, 12);
        assert.equal(r.iss, Date.parse(BRK.issuedTime));
        assert.equal(r.gen, Math.max(...BRK.data.map(p => Date.parse(p.generatedTime))));
        assert.equal(r.u, 'kcfs'); assert.equal(r.pu, 'ft'); assert.equal(r.pedts, 'HGIFF');
        assert.deepEqual(r.pts, expectPts(BRK));
        assert.equal(r.nAll, undefined);
    });
    it('Point of Rocks: same checks', () => {
        const r = parseNwsForecastBody(POR);
        assert.equal(r.n, 12);
        assert.deepEqual(r.pts, expectPts(POR));
        assert.equal(r.gen, Math.max(...POR.data.map(p => Date.parse(p.generatedTime))));
    });
    it('an array under each path of the browser list is found; the first non-empty path wins', () => {
        const pt = [{ validTime: '2026-11-24T18:00:00Z', primary: 1, secondary: 2 }];
        const shapes = [
            { forecast: { data: pt } }, { data: pt }, { forecast: pt }, { data: { forecast: { data: pt } } },
            { data: { forecast: pt } }, { stageflow: { forecast: { data: pt } } }, { stageflow: { forecast: pt } },
        ];
        for (const s of shapes) {
            const r = parseNwsForecastBody(s);
            assert.equal(r.why, null, JSON.stringify(s));
            assert.deepEqual(r.pts, [[Date.parse('2026-11-24T18:00:00Z'), 1, 2]]);
        }
        const two = parseNwsForecastBody({ forecast: { data: [{ secondary: 9 }] }, data: pt });
        assert.equal(two.pts[0][2], 9, 'forecast.data comes before data');
    });
    it('no array, an empty array, or junk gives shape', () => {
        for (const j of [{}, { data: [] }, { forecast: { data: [] } }, null, undefined, 'x', 5, [], { data: 'x' }]) {
            assert.equal(parseNwsForecastBody(j).why, 'shape', JSON.stringify(j));
        }
    });
    it('odd points are kept in order: no time gives null time, strings stay strings, bad values give null', () => {
        const r = parseNwsForecastBody({ data: [
            { primary: 1, secondary: 2 },                                        // no time
            { validTime: 'not a time', primary: 1, secondary: 2 },               // unparseable
            { time: '2026-11-24T18:00:00Z', primary: 1, secondary: 2 },          // only the key the page ignores
            { validTime: '2026-11-24T18:00:00Z', primary: 'x', secondary: '1.5' },
            { validTime: '2026-11-24T19:00:00Z', primary: null, secondary: null },
            { validTime: '2026-11-24T20:00:00Z', primary: {}, secondary: [1] },
            { validTime: '2026-11-24T21:00:00Z', primary: 1, secondary: 'a'.repeat(40) },
            { validTime: '2026-11-24T22:00:00Z', primary: NaN, secondary: Infinity },
            null,
        ] });
        assert.equal(r.n, 9);
        assert.deepEqual(r.pts[0], [null, 1, 2]);
        assert.deepEqual(r.pts[1], [null, 1, 2]);
        assert.deepEqual(r.pts[2], [null, 1, 2], 'validTime only: a point with only `time` has a null time');
        assert.deepEqual(r.pts[3], [Date.parse('2026-11-24T18:00:00Z'), 'x', '1.5']);
        assert.deepEqual(r.pts[4], [Date.parse('2026-11-24T19:00:00Z'), null, null]);
        assert.deepEqual(r.pts[5], [Date.parse('2026-11-24T20:00:00Z'), null, null]);
        assert.equal(r.pts[6][2].length, 24);
        assert.deepEqual(r.pts[7], [Date.parse('2026-11-24T22:00:00Z'), null, null]);
        assert.deepEqual(r.pts[8], [null, null, null]);
    });
    it('a very long array is cut at 200 points and says how long it was', () => {
        const data = Array.from({ length: 500 }, (_, i) => ({ validTime: new Date(T + i * 3600000).toISOString(), primary: 1, secondary: 2 }));
        const r = parseNwsForecastBody({ data });
        assert.equal(r.n, 200); assert.equal(r.nAll, 500); assert.equal(r.pts.length, 200);
    });
    it('missing or odd top-level fields give nulls, not throws', () => {
        const r = parseNwsForecastBody({ data: [{ validTime: '2026-11-24T18:00:00Z', secondary: 1 }], issuedTime: 'garbage', secondaryUnits: 5 });
        assert.equal(r.iss, null); assert.equal(r.gen, null); assert.equal(r.pu, null);
    });
});

describe('N2: server and browser parsers agree', () => {
    it('same array chosen over the live fixtures and the odd shapes (browser clock set inside the window)', (t) => {
        quiet(t);
        t.mock.method(Date, 'now', () => T);
        // one point at +24 h and +48 h, so the browser's acceptance gate (a 24 h or 48 h value) passes
        const pt = (i) => ({ validTime: new Date(T + (i % 2 ? 48 : 24) * 3600000).toISOString(), primary: i, secondary: i + 1 });
        const shapes = [BRK, POR,
            { secondaryUnits: 'kcfs', forecast: { data: [pt(0), pt(1)] } }, { data: [pt(0)] }, { forecast: [pt(0)] },
            { data: { forecast: { data: [pt(2)] } } }, { data: { forecast: [pt(3)] } },
            { stageflow: { forecast: { data: [pt(4)] } } }, { stageflow: { forecast: [pt(5)] } }];
        for (const s of shapes) {
            const b = parseNWSForecast(s, '01646500', 'BRKM2');
            const r = parseNwsForecastBody(s);
            assert.ok(b, 'the browser accepted it');
            assert.equal(r.why, null);
            assert.equal(r.n, b.data.length);
            assert.deepEqual(r.pts.map(p => p[2]), b.data.map(p => p.secondary));
        }
        // shapes the browser rejects for lack of an array are shape for the server too
        for (const s of [{}, { data: [] }, { forecast: {} }]) {
            assert.equal(parseNWSForecast(s, 'x', 'y'), null);
            assert.equal(parseNwsForecastBody(s).why, 'shape');
        }
    });
    it('the two archived gauges are the matching NWS_LIDS entries', () => {
        assert.deepEqual(Object.keys(NWS_ARCHIVE_GAUGES).sort(), ['01638500', '01646500']);
        for (const [site, lid] of Object.entries(NWS_ARCHIVE_GAUGES)) assert.equal(NWS_LIDS[site], lid);
        assert.equal(NWS_ARCHIVE_GAUGES['01646500'], 'BRKM2');
        assert.equal(NWS_ARCHIVE_GAUGES['01638500'], 'PORM2');
    });
});

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const okRes = (j, ms = 300) => ({ site: null, http: 200, why: null, ms, parsed: parseNwsForecastBody(j) });
function nwsOf() {
    return {
        ft: T, ms: 640,
        g: { BRKM2: { ...okRes(BRK, 312), site: '01646500' }, PORM2: { ...okRes(POR, 355), site: '01638500' } },
    };
}
const INP = { lfq: 11000.04, lfT: T - 900000, porq: 10000, porT: T - 1200000, fin: 10850.4, out: 'predicted' };

function numbersOk(x, path = '') {
    if (typeof x === 'number') assert.ok(Number.isFinite(x), path);
    else if (Array.isArray(x)) x.forEach((v, i) => numbersOk(v, path + '[' + i + ']'));
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) numbersOk(v, path + '.' + k);
}

describe('N4: the row builder', () => {
    it('shape, rounding as tick_log rounds, join key, version', () => {
        const rec = buildNwsFcRecord(nwsOf(), INP, T);
        assert.equal(rec.v, FC_LOG_SCHEMA);
        assert.equal(rec.ver, _test.SERVER_VERSION);
        assert.equal(rec.at, new Date(T).toISOString());
        assert.equal(rec.ft, T); assert.equal(rec.ms, 640);
        assert.deepEqual(rec.in, { lfq: 11000, lfT: T - 900000, porq: 10000, porT: T - 1200000, fin: 10850, out: 'predicted' });
        assert.deepEqual(Object.keys(rec.g), ['BRKM2', 'PORM2']);
        const g = rec.g.BRKM2;
        assert.equal(g.site, '01646500'); assert.equal(g.http, 200); assert.equal(g.why, null);
        assert.equal(g.n, 12); assert.equal(g.u, 'kcfs'); assert.equal(g.pu, 'ft'); assert.equal(g.pedts, 'HGIFF');
        assert.equal(g.iss, Date.parse(BRK.issuedTime));
        assert.match(g.sig, /^[0-9a-f]{8}$/);
        assert.equal(g.pts.length, 12);
        assert.ok(!('rawHead' in g));
        numbersOk(rec);
    });
    it('size stays under 3 KB with 2 x 12 points', () => {
        assert.ok(JSON.stringify(buildNwsFcRecord(nwsOf(), INP, T)).length < 3000);
    });
    it('rawHead only on shape or parse_error, and URLs are replaced', () => {
        const nws = nwsOf();
        nws.g.BRKM2 = { site: '01646500', http: 200, why: 'shape', ms: 5, rawHead: 'see https://x.test/a?key=SECRET now' };
        nws.g.PORM2 = { site: '01638500', http: 200, why: 'timeout', ms: 5, rawHead: 'should not appear' };
        const rec = buildNwsFcRecord(nws, INP, T);
        assert.ok(rec.g.BRKM2.rawHead.includes('<url>'));
        assert.ok(!JSON.stringify(rec).includes('SECRET'));
        assert.ok(!('rawHead' in rec.g.PORM2));
        assert.ok(!('pts' in rec.g.BRKM2));
    });
    it('inputs are not mutated (deep-frozen inputs build without a throw) and no reference is kept', () => {
        const nws = deepFreeze(nwsOf()), inp = deepFreeze({ ...INP });
        const rec = buildNwsFcRecord(nws, inp, T);
        assert.notEqual(rec.g.BRKM2.pts, nws.g.BRKM2.parsed.pts);
        assert.notEqual(rec.g.BRKM2.pts[0], nws.g.BRKM2.parsed.pts[0]);
        assert.notEqual(rec.in, inp);
    });
    it('sig is stable for equal points and changes when a point changes', () => {
        const a = buildNwsFcRecord(nwsOf(), INP, T).g.BRKM2.sig;
        assert.equal(buildNwsFcRecord(nwsOf(), INP, T).g.BRKM2.sig, a);
        const j = JSON.parse(JSON.stringify(BRK)); j.data[3].secondary += 0.01;
        const n2 = nwsOf(); n2.g.BRKM2 = { ...okRes(j), site: '01646500' };
        assert.notEqual(buildNwsFcRecord(n2, INP, T).g.BRKM2.sig, a);
    });
    it('the fallback result (and a null result) gives both gauges internal_error, with no clock read', () => {
        for (const n of [nwsFallback('internal_error'), null, undefined, {}]) {
            const rec = buildNwsFcRecord(n, INP, T);
            assert.equal(rec.g.BRKM2.why, 'internal_error');
            assert.equal(rec.g.PORM2.why, 'internal_error');
            assert.equal(rec.ft, null);
            assert.equal(rec.at, new Date(T).toISOString());
        }
    });
    it('missing or odd inputs give nulls and no_prediction', () => {
        const rec = buildNwsFcRecord(nwsOf(), { lfq: undefined, fin: NaN, out: 'x' }, T);
        assert.deepEqual(rec.in, { lfq: null, lfT: null, porq: null, porT: null, fin: null, out: 'no_prediction' });
        const rec2 = buildNwsFcRecord(nwsOf(), undefined, T);
        assert.equal(rec2.in.lfq, null);
    });
    it('nwsFcInputs: primitive copies with the same rounding as the tick row, safe on missing pieces', () => {
        const { nwsFcInputs } = _test;
        const ud = { gauges: { lf: 'L', por: 'P' }, data: { L: { q: 11000.04, qTime: 5 }, P: { q: 9999.96, qTime: 6 } } };
        assert.deepEqual(nwsFcInputs(ud, { predictedCFS: 10850.5 }), { lfq: 11000, lfT: 5, porq: 10000, porT: 6, fin: 10851, out: 'predicted' });
        assert.deepEqual(nwsFcInputs(ud, null), { lfq: 11000, lfT: 5, porq: 10000, porT: 6, fin: null, out: 'no_prediction' });
        assert.deepEqual(nwsFcInputs(null, null), { lfq: null, lfT: null, porq: null, porT: null, fin: null, out: 'no_prediction' });
        assert.deepEqual(nwsFcInputs({ gauges: { lf: 'L' }, data: {} }, null).lfq, null);
    });
});

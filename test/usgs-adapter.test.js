// v39.11 (Step 1): the USGS adapter (new continuous service -> old IV structure) on its own and
// against four saved real responses (test/fixtures/usgs/). No network: fetch is stubbed where used.
// par_new / par_old: the same 6 hours (2026-11-15 12:00 to 18:00 UTC, end excluded) from both services,
// 8 gauges, flow, stage and temperature, 18 series (trimmed identically by script, see TODO / report).
// ice_new / ice_old: two Alaska gauges that were iced or out of service on 2026-11-17 (no Potomac gauge is iced).
// Plan: analysis/usgs-service-move-plan-2026-11-17.md.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildContinuousUrl, toLegacyIv, newestPublishTimes } = require('../netlify/functions/shared/usgs-adapter');
const { _test } = require('../netlify/functions/scheduled-update');

const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'usgs', f), 'utf8'));
const parNew = load('par_new.json'), parOld = load('par_old.json');
const iceNew = load('ice_new.json'), iceOld = load('ice_old.json');

// flatten an old-structure document to Map "site|param" -> readings (all value blocks, in file order)
function oldSeries(json) {
    const m = new Map();
    for (const ts of json.value.timeSeries) {
        const k = `${ts.sourceInfo.siteCode[0].value}|${ts.variable.variableCode[0].value}`;
        m.set(k, ts.values.flatMap(b => b.value));
    }
    return m;
}

// row factory for the unit tests
function row(site, param, time, value, o = {}) {
    return {
        type: 'Feature', geometry: null, id: Math.random().toString(36).slice(2),
        properties: {
            time_series_id: o.sid ?? `${site}-${param}`, monitoring_location_id: `USGS-${site}`, parameter_code: param,
            statistic_id: o.stat ?? '00011', time, value, approval_status: o.appr === undefined ? 'Provisional' : o.appr,
            qualifier: o.q === undefined ? null : o.q, last_modified: o.lm ?? '2026-11-17T10:25:24+00:00'
        }
    };
}
const fc = (features, extra = {}) => ({ type: 'FeatureCollection', features, numberReturned: features.length, links: [{ rel: 'self', href: 'x' }], timeStamp: '2026-11-17T15:57:01.033544Z', ...extra });
const seriesOf = (iv, site, param) => iv.value.timeSeries.find(s => s.sourceInfo.siteCode[0].value === site && s.variable.variableCode[0].value === param);

describe('fixtures: what they are', () => {
    it('the parity pair holds the same 18 series and the same reading counts', () => {
        const o = oldSeries(parOld);
        const n = oldSeries(toLegacyIv(parNew));
        assert.equal(o.size, 18);
        assert.deepEqual([...n.keys()].sort(), [...o.keys()].sort());
        for (const [k, v] of o) assert.equal(n.get(k).length, v.length, k);
        assert.ok([...n.values()].reduce((a, v) => a + v.length, 0) > 900);
    });
    it('no fixture contains a key or a key header', () => {
        for (const f of ['par_new.json', 'par_old.json', 'ice_new.json', 'ice_old.json']) {
            const s = fs.readFileSync(path.join(__dirname, 'fixtures', 'usgs', f), 'utf8');
            assert.ok(!/api[_-]?key|x-api/i.test(s), f);
        }
    });
});

describe('parity: toLegacyIv(new) against the old service, same window', () => {
    const o = oldSeries(parOld);
    const iv = toLegacyIv(parNew);
    const n = oldSeries(iv);
    it('every (gauge, parameter): same instants, identical value strings, qualifiers equal as arrays', () => {
        for (const [k, oldVals] of o) {
            const newVals = n.get(k);
            assert.equal(newVals.length, oldVals.length, k);
            for (let i = 0; i < oldVals.length; i++) {
                assert.equal(Date.parse(newVals[i].dateTime), Date.parse(oldVals[i].dateTime), `${k} #${i} instant`);
                assert.equal(newVals[i].value, oldVals[i].value, `${k} #${i} value`);
                assert.deepEqual(newVals[i].qualifiers, oldVals[i].qualifiers, `${k} #${i} qualifiers`);
            }
        }
    });
    it('the old structure is complete: requestDT note, siteCode, variableCode, noDataValue, one values block', () => {
        assert.deepEqual(iv.value.queryInfo.note, [{ title: 'requestDT', value: parNew.timeStamp }]);
        for (const ts of iv.value.timeSeries) {
            assert.match(ts.sourceInfo.siteCode[0].value, /^\d{8}$/);
            assert.match(ts.variable.variableCode[0].value, /^\d{5}$/);
            assert.equal(ts.variable.noDataValue, -999999);
            assert.equal(ts.values.length, 1);
        }
        assert.ok(_test.validateUSGSResponse(iv).valid);
    });
    it('the REAL server parser gives identical output on the old answer and on the adapter output', async (t) => {
        const run = async (payload, withKey) => {
            if (withKey) process.env.USGS_API_KEY = 'unit-test-key-not-real'; else delete process.env.USGS_API_KEY;
            delete process.env.USGS_SOURCE;
            t.mock.method(global, 'fetch', async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(payload)) }));
            t.mock.method(console, 'log', () => {});
            const meta = {};
            const r = await _test.fetchUSGSData(meta);
            t.mock.restoreAll();
            delete process.env.USGS_API_KEY;
            return { r, meta };
        };
        const a = await run(parOld, false);
        const b = await run(parNew, true);
        assert.equal(a.meta.src, 'old_nokey');
        assert.equal(b.meta.src, 'new');
        assert.ok(a.r && b.r);
        assert.deepEqual(b.r, a.r);
        const por = a.r.data['01638500'];
        assert.ok(por.q > 0 && por.h > 0 && por.history.length > 50, 'the comparison is not vacuous');
        assert.ok(a.r.data['01644148'].h > 0 && a.r.data['01644148'].hTail.length === 16);
    });
    it('the REAL temperature and Difficult Run parsers agree too', async (t) => {
        const at = Date.parse('2026-11-15T18:30:00Z');
        assert.deepEqual(_test.parseDifficultRun(iv, at), _test.parseDifficultRun(parOld, at));
        assert.equal(_test.parseDifficultRun(iv, at).why, null);
        const temp = async (payload, withKey) => {
            if (withKey) process.env.USGS_API_KEY = 'unit-test-key-not-real'; else delete process.env.USGS_API_KEY;
            t.mock.method(global, 'fetch', async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(payload)) }));
            t.mock.method(console, 'log', () => {});
            const out = {};
            const v = await _test.fetchWaterTemp(out);
            t.mock.restoreAll(); delete process.env.USGS_API_KEY;
            return [v, out.t];
        };
        // the real temperature request names one gauge and one parameter, so the answer has one series:
        // cut the saved answers down to that series (Point of Rocks 00010)
        const oldTemp = { ...parOld, value: { ...parOld.value, timeSeries: parOld.value.timeSeries.filter(ts => ts.sourceInfo.siteCode[0].value === '01638500' && ts.variable.variableCode[0].value === '00010') } };
        const newTemp = { ...parNew, features: parNew.features.filter(f => f.properties.monitoring_location_id === 'USGS-01638500' && f.properties.parameter_code === '00010') };
        assert.equal(oldTemp.value.timeSeries.length, 1);
        const [va, ta] = await temp(oldTemp, false);
        const [vb, tb] = await temp(newTemp, true);
        assert.ok(va > 0 && Number.isFinite(ta));
        assert.deepEqual([vb, tb], [va, ta]);
    });
});

describe('ice and equipment flags (Alaska fixture)', () => {
    const iv = toLegacyIv(iceNew);
    const o = oldSeries(iceOld), n = oldSeries(iv);
    it('null value becomes "-999999"; ICE becomes ["P","Ice"]; EQUIP becomes ["P","Eqp"]; others match the old service', () => {
        for (const [k, oldVals] of o) {
            const newVals = n.get(k);
            assert.equal(newVals.length, oldVals.length, k);
            oldVals.forEach((ov, i) => {
                assert.equal(Date.parse(newVals[i].dateTime), Date.parse(ov.dateTime), k);
                assert.equal(newVals[i].value, ov.value, `${k} #${i}`);
                assert.deepEqual(newVals[i].qualifiers, ov.qualifiers, `${k} #${i}`);
            });
        }
        assert.deepEqual(n.get('15515500|00060')[0], { value: '-999999', qualifiers: ['P', 'Ice'], dateTime: '2026-11-17T10:00:00+00:00' });
        assert.deepEqual(n.get('15356000|00060')[0].qualifiers, ['P', 'Eqp']);
    });
    it('no unknown qualifier code in the real ice answer', () => {
        const rep = {};
        toLegacyIv(iceNew, rep);
        assert.deepEqual(rep.unknownQualifiers, []);
    });
    it('the real server parser flags ice on the adapter output exactly as on the old response', async (t) => {
        const run = async (payload, withKey) => {
            if (withKey) process.env.USGS_API_KEY = 'unit-test-key-not-real'; else delete process.env.USGS_API_KEY;
            t.mock.method(global, 'fetch', async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(payload)) }));
            t.mock.method(console, 'log', () => {});
            const r = await _test.fetchUSGSData();
            t.mock.restoreAll(); delete process.env.USGS_API_KEY;
            return r;
        };
        const a = await run(iceOld, false), b = await run(iceNew, true);
        assert.deepEqual(b, a);
        assert.equal(a.data['15515500'].iceAffected, true);
        assert.equal(b.data['15515500'].iceAffected, true);
        assert.equal(b.data['15356000'].iceAffected, true);
        assert.equal(b.data['15515500'].q, undefined);
        assert.ok(b.data['15515500'].h > 0, 'the stage series of the iced gauge is a normal reading');
    });
    it('the Difficult Run parser reports ice / sentinel the same way on adapter output', () => {
        const mk = (feat) => toLegacyIv(fc(feat));
        const rows = [row('01646000', '00060', '2026-11-17T10:00:00+00:00', '12.5'), row('01646000', '00060', '2026-11-17T10:15:00+00:00', null, { q: ['ICE'] })];
        const r = _test.parseDifficultRun(mk(rows), Date.parse('2026-11-17T10:30:00Z'));
        assert.equal(r.why, 'sentinel');
        assert.deepEqual(r.qual, ['P', 'Ice']);
    });
});

describe('adapter units', () => {
    it('sorts ascending by time inside a series (shuffled rows, mixed offsets)', () => {
        const times = ['2026-11-17T10:30:00+00:00', '2026-11-17T10:00:00+00:00', '2026-11-17T10:45:00+00:00', '2026-11-17T10:15:00+00:00'];
        const iv = toLegacyIv(fc(times.map((t, i) => row('01638500', '00060', t, String(100 + i)))));
        const got = seriesOf(iv, '01638500', '00060').values[0].value.map(v => v.dateTime);
        assert.deepEqual(got, [...times].sort());
    });
    it('keeps only statistic 00011', () => {
        const iv = toLegacyIv(fc([
            row('01638500', '00060', '2026-11-17T10:00:00+00:00', '1', { stat: '00003', sid: 'daily' }),
            row('01638500', '00060', '2026-11-17T10:00:00+00:00', '2'),
            row('01638500', '00065', '2026-11-17T10:00:00+00:00', '3', { stat: '00001', sid: 'max' }),
        ]));
        assert.equal(iv.value.timeSeries.length, 1);
        assert.deepEqual(seriesOf(iv, '01638500', '00060').values[0].value.map(v => v.value), ['2']);
        assert.equal(seriesOf(iv, '01638500', '00065'), undefined);
    });
    it('two different series for one gauge and parameter throw', () => {
        assert.throws(() => toLegacyIv(fc([
            row('01638500', '00060', '2026-11-17T10:00:00+00:00', '1', { sid: 'a' }),
            row('01638500', '00060', '2026-11-17T10:00:00+00:00', '2', { sid: 'b' }),
        ])), /two different series/);
    });
    it('a next link throws a clear paged-response error', () => {
        assert.throws(() => toLegacyIv(fc([row('01638500', '00060', '2026-11-17T10:00:00+00:00', '1')], { links: [{ rel: 'next', href: 'x' }] })), /paged/);
        assert.throws(() => newestPublishTimes(fc([], { links: [{ rel: 'next' }] })), /paged/);
    });
    it('a malformed answer throws', () => {
        assert.throws(() => toLegacyIv(null), /malformed/);
        assert.throws(() => toLegacyIv({ features: 'x' }), /malformed/);
        assert.throws(() => toLegacyIv(fc([{ type: 'Feature' }])), /properties/);
        assert.throws(() => toLegacyIv(fc([row('01638500', '00060', 'not a time', '1')])), /time/);
    });
    it('unknown qualifier codes pass through unchanged and are reported', () => {
        const rep = {};
        const iv = toLegacyIv(fc([row('01638500', '00060', '2026-11-17T10:00:00+00:00', '1', { q: ['ZZZ', 'ICE', 'ZZZ', 'ABC'] })]), rep);
        assert.deepEqual(seriesOf(iv, '01638500', '00060').values[0].value[0].qualifiers, ['P', 'ZZZ', 'Ice', 'ZZZ', 'ABC']);
        assert.deepEqual(rep.unknownQualifiers, ['ABC', 'ZZZ']);
    });
    it('a requested gauge with no rows has no block', () => {
        const iv = toLegacyIv(fc([row('01638500', '00060', '2026-11-17T10:00:00+00:00', '1')]));
        assert.equal(iv.value.timeSeries.length, 1);
        assert.equal(seriesOf(iv, '01646500', '00060'), undefined);
        assert.deepEqual(toLegacyIv(fc([])).value.timeSeries, []);
    });
    it('qualifiers: null adds nothing; Approved gives A; no approval status gives none; empty array adds nothing', () => {
        const iv = toLegacyIv(fc([
            row('01638500', '00060', '2026-11-17T10:00:00+00:00', '1', { q: null }),
            row('01638500', '00060', '2026-11-17T10:15:00+00:00', '2', { appr: 'Approved', q: [] }),
            row('01638500', '00060', '2026-11-17T10:30:00+00:00', '3', { appr: null }),
            row('01638500', '00060', '2026-11-17T10:45:00+00:00', '4', { q: ['EQUIP'] }),
        ]));
        assert.deepEqual(seriesOf(iv, '01638500', '00060').values[0].value.map(v => v.qualifiers), [['P'], ['A'], [], ['P', 'Eqp']]);
    });
    it('values and dateTime are passed through as given; null value is "-999999"; numbers become strings', () => {
        const iv = toLegacyIv(fc([
            row('01638500', '00060', '2026-11-17T10:00:00+00:00', '1.50'),
            row('01638500', '00060', '2026-11-17T10:15:00+00:00', null),
            row('01638500', '00060', '2026-11-17T10:30:00+00:00', 7),
        ]));
        const v = seriesOf(iv, '01638500', '00060').values[0].value;
        assert.deepEqual(v.map(x => x.value), ['1.50', '-999999', '7']);
        assert.equal(v[0].dateTime, '2026-11-17T10:00:00+00:00');
        assert.ok(v.every(x => typeof x.value === 'string'));
    });
    it('timeStamp becomes the requestDT note', () => {
        const iv = toLegacyIv(fc([], { timeStamp: '2030-01-02T03:04:05.678Z' }));
        assert.deepEqual(iv.value.queryInfo.note, [{ title: 'requestDT', value: '2030-01-02T03:04:05.678Z' }]);
    });
    it('newestPublishTimes: newest reading per gauge and parameter, with its last_modified', () => {
        const p = newestPublishTimes(fc([
            row('01638500', '00060', '2026-11-17T10:30:00+00:00', '1', { lm: '2026-11-17T10:58:00+00:00' }),
            row('01638500', '00060', '2026-11-17T10:00:00+00:00', '1', { lm: '2026-11-17T09:58:00+00:00' }),
            row('01638500', '00065', '2026-11-17T10:15:00+00:00', '1', { lm: '2026-11-17T10:58:00+00:00' }),
        ]));
        assert.deepEqual(p['01638500']['00060'], { time: '2026-11-17T10:30:00+00:00', lastModified: '2026-11-17T10:58:00+00:00' });
        assert.deepEqual(p['01638500']['00065'], { time: '2026-11-17T10:15:00+00:00', lastModified: '2026-11-17T10:58:00+00:00' });
    });
    it('buildContinuousUrl: exact string, no key', () => {
        const u = buildContinuousUrl({ sites: ['01638500', '01646500'], params: ['00060', '00065'], period: 'P2D' });
        assert.equal(u, 'https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items?f=json&monitoring_location_id=USGS-01638500,USGS-01646500&parameter_code=00060,00065&time=P2D&limit=50000&skipGeometry=true&properties=monitoring_location_id,parameter_code,statistic_id,time,value,approval_status,qualifier,last_modified,time_series_id');
        assert.ok(!/key/i.test(u));
        assert.match(buildContinuousUrl({ sites: ['01646000'], params: ['00060'], period: 'PT6H' }), /&time=PT6H&/);
        assert.match(buildContinuousUrl({ sites: ['01638500'], params: ['00010'], period: 'P1D' }), /&time=P1D&/);
    });
    it('buildContinuousUrl refuses odd input', () => {
        assert.throws(() => buildContinuousUrl({ sites: ['01638500'], params: ['00060'], period: 'P2D&x=1' }));
        assert.throws(() => buildContinuousUrl({ sites: ['0163&8500'], params: ['00060'], period: 'P2D' }));
        assert.throws(() => buildContinuousUrl({ sites: [], params: ['00060'], period: 'P2D' }));
    });
});

// Shaped like a REAL answer to the `properties=` request: only the requested names, geometry null.
const REQUESTED = ['monitoring_location_id', 'parameter_code', 'statistic_id', 'time', 'value', 'approval_status', 'qualifier', 'last_modified', 'time_series_id'];
function restricted(features, { withId = true } = {}) {
    return features.map(f => {
        const props = {};
        for (const k of REQUESTED) if (k in f.properties && (withId || k !== 'time_series_id')) props[k] = f.properties[k];
        return { type: 'Feature', geometry: null, properties: props };
    });
}

describe('real-shaped (properties-restricted) answers and the duplicate-series guards', () => {
    it('the saved parity answer, cut to the requested properties, converts identically', () => {
        assert.ok(REQUESTED.length === buildContinuousUrl({ sites: ['01638500'], params: ['00060'], period: 'P1D' }).split('properties=')[1].split(',').length);
        const a = toLegacyIv(parNew);
        const b = toLegacyIv({ ...parNew, features: restricted(parNew.features) });
        assert.deepEqual(b, a);
        // without time_series_id the saved answer still converts (no timestamp collides in a real answer)
        assert.deepEqual(toLegacyIv({ ...parNew, features: restricted(parNew.features, { withId: false }) }), a);
    });
    const A = [['2026-11-17T10:00:00+00:00', '5000'], ['2026-11-17T10:15:00+00:00', '5010']];
    const B = [['2026-11-17T10:00:00+00:00', '9100'], ['2026-11-17T10:15:00+00:00', '9110']];
    const mk = (sid, rowsT) => rowsT.map(([t, v]) => row('01646500', '00060', t, v, { sid }));
    it('two interleaved series WITH time_series_id throw', () => {
        const feats = restricted([...mk('A', A.slice(0, 1)), ...mk('B', B.slice(0, 1)), ...mk('A', A.slice(1)), ...mk('B', B.slice(1))]);
        assert.throws(() => toLegacyIv(fc(feats)), /two different series/);
    });
    it('two interleaved series WITHOUT time_series_id throw when instants collide', () => {
        const feats = restricted([...mk('A', A), ...mk('B', B)], { withId: false });
        assert.ok(feats.every(f => !('time_series_id' in f.properties)));
        assert.throws(() => toLegacyIv(fc(feats)), /same instant/);
    });
    it('NOT caught (documented limit): two id-less series whose instants never collide merge into one block', () => {
        const a = mk('A', [['2026-11-17T10:00:00+00:00', '5000'], ['2026-11-17T10:30:00+00:00', '5010']]);
        const b = mk('B', [['2026-11-17T10:15:00+00:00', '9100'], ['2026-11-17T10:45:00+00:00', '9110']]);
        const iv = toLegacyIv(fc(restricted([...a, ...b], { withId: false })));
        assert.deepEqual(seriesOf(iv, '01646500', '00060').values[0].value.map(v => v.value), ['5000', '9100', '5010', '9110']);
    });
    it('duplicate instants in different parameters or gauges are fine', () => {
        const feats = [row('01646500', '00060', '2026-11-17T10:00:00+00:00', '1'), row('01646500', '00065', '2026-11-17T10:00:00+00:00', '2'), row('01638500', '00060', '2026-11-17T10:00:00+00:00', '3')];
        assert.equal(toLegacyIv(fc(feats)).value.timeSeries.length, 3);
    });
});

describe('schema-change guard, string qualifier, unknown approval status', () => {
    it('rows present but none with statistic 00011 throws; an empty answer does not', () => {
        assert.throws(() => toLegacyIv(fc([row('01638500', '00060', '2026-11-17T10:00:00+00:00', '1', { stat: '00003' })])), /00011/);
        assert.throws(() => toLegacyIv(fc([{ type: 'Feature', geometry: null, properties: { monitoring_location_id: 'USGS-01638500', parameter_code: '00060', time: '2026-11-17T10:00:00+00:00', value: '1' } }])), /00011/);
        assert.deepEqual(toLegacyIv(fc([])).value.timeSeries, []);
    });
    it('a qualifier given as a string is a one-item list', () => {
        const rep = {};
        const iv = toLegacyIv(fc([row('01638500', '00060', '2026-11-17T10:00:00+00:00', null, { q: 'ICE' }), row('01638500', '00060', '2026-11-17T10:15:00+00:00', '1', { q: 'ZZZ' })]), rep);
        assert.deepEqual(seriesOf(iv, '01638500', '00060').values[0].value.map(v => v.qualifiers), [['P', 'Ice'], ['P', 'ZZZ']]);
        assert.deepEqual(rep.unknownQualifiers, ['ZZZ']);
    });
    it('an approval_status other than Provisional or Approved is reported as status:<value>; null is not', () => {
        const rep = {};
        const iv = toLegacyIv(fc([row('01638500', '00060', '2026-11-17T10:00:00+00:00', '1', { appr: 'Revised' }), row('01638500', '00060', '2026-11-17T10:15:00+00:00', '2', { appr: null })]), rep);
        assert.deepEqual(seriesOf(iv, '01638500', '00060').values[0].value.map(v => v.qualifiers), [[], []]);
        assert.deepEqual(rep.unknownQualifiers, ['status:Revised']);
    });
});

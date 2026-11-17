// v39.13 (Step 2, push B): the browser copy of the USGS adapter (src/data/usgs-adapter.js, ES module) must
// do exactly what the server copy (netlify/functions/shared/usgs-adapter.js, CommonJS) does.
//   1. the text between the BEGIN SHARED and END SHARED markers is byte-identical in both files;
//   2. both copies are executed over the saved real answers and the error cases: same output, same messages.
// The server copy is loaded with createRequire; the browser copy with import (module syntax stays outside the markers).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as browser from '../src/data/usgs-adapter.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = createRequire(import.meta.url)('../netlify/functions/shared/usgs-adapter.js');
const SERVER_FILE = resolve(root, 'netlify/functions/shared/usgs-adapter.js');
const BROWSER_FILE = resolve(root, 'src/data/usgs-adapter.js');
const BEGIN = '// --- BEGIN SHARED ---';
const END = '// --- END SHARED ---';

const shared = (file) => {
    const t = readFileSync(file, 'utf8');
    assert.equal(t.split(BEGIN).length, 2, `${file}: exactly one BEGIN marker`);
    assert.equal(t.split(END).length, 2, `${file}: exactly one END marker`);
    const a = t.indexOf(BEGIN) + BEGIN.length, b = t.indexOf(END);
    assert.ok(a < b, 'markers in order');
    return { text: t.slice(a, b), before: t.slice(0, a), after: t.slice(b) };
};
const load = (f) => JSON.parse(readFileSync(resolve(root, 'test/fixtures/usgs', f), 'utf8'));
const parNew = load('par_new.json'), iceNew = load('ice_new.json');

// run a function on both copies; return {out} or {err: message}
const run = (name, ...args) => {
    const one = (m) => { try { return { out: m[name](...JSON.parse(JSON.stringify(args))) }; } catch (e) { return { err: e.message }; } };
    return { s: one(server), b: one(browser) };
};
const same = (name, ...args) => {
    const { s, b } = run(name, ...args);
    assert.deepEqual(b, s, `${name}: browser copy differs from the server copy`);
    return s;
};

const row = (site, param, time, value, o = {}) => ({
    type: 'Feature', geometry: null, id: 'x',
    properties: {
        time_series_id: o.sid ?? `${site}-${param}`, monitoring_location_id: `USGS-${site}`, parameter_code: param,
        statistic_id: o.stat ?? '00011', time, value, approval_status: o.appr === undefined ? 'Provisional' : o.appr,
        qualifier: o.q === undefined ? null : o.q, last_modified: '2026-11-17T10:25:24+00:00'
    }
});
const fc = (features, extra = {}) => ({ type: 'FeatureCollection', features, links: [{ rel: 'self', href: 'x' }], timeStamp: '2026-11-17T15:57:01.033544Z', ...extra });

describe('USGS adapter: server copy and browser copy', () => {
    it('1. the shared text between the markers is byte-identical', () => {
        const s = shared(SERVER_FILE), b = shared(BROWSER_FILE);
        assert.ok(s.text.length > 3000, 'the shared block is the whole adapter, not a stub');
        assert.equal(b.text, s.text);
    });

    it('2. module syntax stays outside the markers (CommonJS in the server copy, export in the browser copy)', () => {
        const s = shared(SERVER_FILE), b = shared(BROWSER_FILE);
        assert.doesNotMatch(s.text, /module\.exports|^\s*export\s/m);
        assert.doesNotMatch(b.text, /module\.exports|^\s*export\s/m);
        assert.match(s.after, /module\.exports = \{ buildContinuousUrl, toLegacyIv, newestPublishTimes, QUALIFIER_MAP, NO_DATA \}/);
        assert.match(b.after, /export \{ buildContinuousUrl, toLegacyIv, newestPublishTimes, QUALIFIER_MAP, NO_DATA \}/);
    });

    it('3. same exports; same constants', () => {
        for (const k of ['buildContinuousUrl', 'toLegacyIv', 'newestPublishTimes']) assert.equal(typeof browser[k], 'function', k);
        assert.deepEqual(browser.QUALIFIER_MAP, server.QUALIFIER_MAP);
        assert.equal(browser.NO_DATA, server.NO_DATA);
    });

    it('4. both copies convert the saved real answers to the same document', () => {
        for (const j of [parNew, iceNew]) {
            const r = same('toLegacyIv', j);
            assert.ok(r.out.value.timeSeries.length > 0);
            const rep = { s: {}, b: {} };
            assert.deepEqual(browser.toLegacyIv(j, rep.b), server.toLegacyIv(j, rep.s));
            assert.deepEqual(rep.b, rep.s);
            same('newestPublishTimes', j);
        }
    });

    it('5. the address is the same for the app sets', () => {
        for (const req of [
            { sites: ['01646500', '01638500'], params: ['00060', '00065'], period: 'P7D' },
            { sites: ['01644148'], params: ['00065'], period: 'P1D' },
            { sites: ['01638500'], params: ['00010'], period: 'PT6H' }
        ]) assert.equal(browser.buildContinuousUrl(req), server.buildContinuousUrl(req));
        for (const bad of [
            { sites: [], params: ['00060'], period: 'P1D' }, { sites: ['01646500'], params: [], period: 'P1D' },
            { sites: ['01646500'], params: ['00060'], period: 'tomorrow' }, { sites: ['x'], params: ['00060'], period: 'P1D' },
            { sites: ['01646500'], params: ['6'], period: 'P1D' }
        ]) {
            const s = (() => { try { return server.buildContinuousUrl(bad); } catch (e) { return e.message; } })();
            const b = (() => { try { return browser.buildContinuousUrl(bad); } catch (e) { return e.message; } })();
            assert.equal(b, s);
            assert.match(s, /^buildContinuousUrl:/);
        }
    });

    it('6. error cases give equal error messages: malformed, paged, no 00011, duplicate instants, two series, bad time, no site', () => {
        const cases = {
            'no features array': { timeStamp: 'x' },
            'null': null,
            'paged': fc([row('01646500', '00060', '2026-11-17T10:00:00+00:00', '5')], { links: [{ rel: 'next', href: 'y' }] }),
            'rows but no 00011': fc([row('01646500', '00060', '2026-11-17T10:00:00+00:00', '5', { stat: '00003' })]),
            'duplicate instants': fc([row('01646500', '00060', '2026-11-17T10:00:00+00:00', '5'), row('01646500', '00060', '2026-11-17T10:00:00+00:00', '6')]),
            'two series': fc([row('01646500', '00060', '2026-11-17T10:00:00+00:00', '5', { sid: 'a' }), row('01646500', '00060', '2026-11-17T10:15:00+00:00', '5', { sid: 'b' })]),
            'unreadable time': fc([row('01646500', '00060', 'soon', '5')]),
            'no site': fc([{ type: 'Feature', properties: { statistic_id: '00011', parameter_code: '00060', time: '2026-11-17T10:00:00+00:00', value: '1' } }]),
            'no properties': fc([{ type: 'Feature' }])
        };
        for (const [name, j] of Object.entries(cases)) {
            const r = same('toLegacyIv', j);
            assert.ok(r.err, `${name} must be rejected`);
            const n = same('newestPublishTimes', j);
            if (['no features array', 'null', 'paged', 'no site', 'no properties'].includes(name)) assert.ok(n.err, `${name} must be rejected by newestPublishTimes`);
        }
    });

    it('7. qualifiers: ICE and EQUIP are mapped, an unknown code is a pass-through case (not an error), null value is -999999', () => {
        const j = fc([
            row('01646500', '00060', '2026-11-17T10:00:00+00:00', null, { q: ['ICE'] }),
            row('01646500', '00060', '2026-11-17T10:15:00+00:00', '7', { q: ['EQUIP', 'XYZ'], appr: 'Approved' }),
            row('01646500', '00060', '2026-11-17T10:30:00+00:00', '8', { q: 'ICE', appr: 'Weird' })
        ]);
        const rs = { s: {}, b: {} };
        const s = server.toLegacyIv(j, rs.s), b = browser.toLegacyIv(j, rs.b);
        assert.deepEqual(b, s);
        assert.deepEqual(rs.b, rs.s);
        const v = s.value.timeSeries[0].values[0].value;
        assert.equal(v[0].value, '-999999');
        assert.deepEqual(v[0].qualifiers, ['P', 'Ice']);
        assert.deepEqual(v[1].qualifiers, ['A', 'Eqp', 'XYZ']);
        assert.deepEqual(v[2].qualifiers, ['Ice']);
        assert.deepEqual(rs.s.unknownQualifiers, ['XYZ', 'status:Weird']);
    });

    it('8. requestDT is the upstream timeStamp, untouched, in both copies', () => {
        const j = fc([row('01646500', '00060', '2026-11-17T10:00:00+00:00', '5')]);
        for (const m of [server, browser]) assert.equal(m.toLegacyIv(j).value.queryInfo.note[0].value, '2026-11-17T15:57:01.033544Z');
    });
});

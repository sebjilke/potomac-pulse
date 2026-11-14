// v39.10: gauge-list label "Next 24h", whole header cell opens its explanation, and the per-gauge
// flood-category requests are gone from fetchNWSForecasts(). Source checks plus a behaviour test that
// bundles src/estimation/nws.js, stubs fetch and checks the requests made and the trend written.
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const walk = (dir) => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
});

describe('gauge-list header: label and cells', () => {
    const g = read('src/ui/gauges-ui.js');
    const start = g.indexOf('<div class="gauge-header">');
    const header = g.slice(start, g.indexOf('</div>`;', start));
    it('the label is "Next 24h" and the old label is gone from the template', () => {
        assert.ok(header.includes('Next 24h <button type="button" class="col-info"'));
        assert.ok(!header.includes('24h Trend'));
        assert.ok(!g.includes('24h Trend'));
    });
    it('exactly two col-info-cell cells, each with one col-info button', () => {
        assert.equal((header.match(/class="col-info-cell"/g) || []).length, 2);
        assert.equal((g.match(/col-info-cell"/g) || []).length, 2);
        const cells = header.match(/<div class="col-info-cell"[^>]*>[\s\S]*?<\/div>/g) || [];
        assert.equal(cells.length, 2);
        for (const c of cells) assert.equal((c.match(/class="col-info"/g) || []).length, 1);
    });
    it('CSS: .col-info-cell has cursor: pointer and no position', () => {
        const css = read('src/styles/main.css');
        const i = css.indexOf('.col-info-cell {');
        assert.ok(i >= 0, '.col-info-cell rule exists');
        const body = css.slice(i, css.indexOf('}', i));
        assert.match(body, /cursor:\s*pointer/);
        assert.ok(!/position\s*:/.test(body), 'the bubble must stay anchored to the sticky header');
    });
});

describe('flood-category requests: source', () => {
    it('no src/**/*.js mentions floodCategory or fetchFloodCategory', () => {
        const hits = walk(resolve(root, 'src')).filter((f) => f.endsWith('.js'))
            .filter((f) => /floodCategory|fetchFloodCategory/.test(readFileSync(f, 'utf8')));
        assert.deepEqual(hits, []);
    });
    it('nws.js has no bare gauge-endpoint template and exactly four stageflow templates', () => {
        const n = read('src/estimation/nws.js');
        assert.ok(!/nwps\/v1\/gauges\/\$\{[^}]*\}`/.test(n), 'a template closing right after the placeholder is the flood-stage request');
        assert.equal((n.match(/gauges\/\$\{[^}]*\}\/stageflow/g) || []).length, 4);
    });
});

describe('fetchNWSForecasts(): requests and trend', () => {
    let M, urls, realFetch, realLog, realErr;
    const HR = 3600000;

    before(async () => {
        if (!globalThis.localStorage) {
            const m = new Map();
            globalThis.localStorage = {
                getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
                removeItem: (k) => { m.delete(k); }, clear: () => m.clear()
            };
        }
        const entry = [
            `export { fetchNWSForecasts } from ${JSON.stringify(resolve(root, 'src/estimation/nws.js'))};`,
            `export { NWS_LIDS } from ${JSON.stringify(resolve(root, 'src/model/constants.js'))};`,
            `export * as store from ${JSON.stringify(resolve(root, 'src/state/store.js'))};`
        ].join('\n');
        const out = await build({
            stdin: { contents: entry, resolveDir: root, sourcefile: 'nws-entry.mjs', loader: 'js' },
            bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent'
        });
        M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
    });

    beforeEach(() => {
        urls = [];
        realFetch = globalThis.fetch; realLog = console.log; realErr = console.error;
        console.log = () => {}; console.error = () => {};
    });
    afterEach(() => {
        globalThis.fetch = realFetch; console.log = realLog; console.error = realErr;
    });

    // Scenario per gauge, by position in NWS_LIDS. q is the current flow; point24 / point48 are cfs values the
    // stub returns at +24 h / +48 h (kcfs on the wire). null point24 and point48 means no usable forecast.
    const scenarios = (ids) => ({
        [ids[0]]: { name: 'up', q: 1000, p24: 1500, p48: 1800 },
        [ids[1]]: { name: 'down', q: 1000, p24: 500, p48: 400 },
        [ids[2]]: { name: 'stable', q: 1000, p24: 1010, p48: 1020 },
        [ids[3]]: { name: 'fallback48', q: 1000, p24: null, p48: 1300 },
        [ids[4]]: { name: 'none', q: 1000, p24: null, p48: null },
        // small moves just past the 2% threshold, so a wrong threshold is caught
        [ids[5]]: { name: 'mild up', q: 1000, p24: 1050, p48: 1050 },
        [ids[6]]: { name: 'mild down', q: 1000, p24: 950, p48: 950 }
    });

    it('makes no bare-gauge request, one request per gauge with a forecast and four without, and writes the same trend', async () => {
        const ids = Object.keys(M.NWS_LIDS);
        const lidToId = Object.fromEntries(ids.map((id) => [M.NWS_LIDS[id].toLowerCase(), id]));
        const sc = scenarios(ids);
        const seed = {};
        for (const id of ids) seed[id] = { q: sc[id] ? sc[id].q : 1000 };
        M.store.setData(seed);

        const t0 = Date.now();
        globalThis.fetch = async (u) => {
            urls.push(String(u));
            const lid = new URL(String(u)).pathname.split('/')[4].toLowerCase();
            const s = sc[lidToId[lid]];
            if (!s || (s.p24 === null && s.p48 === null)) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
            const pts = [];
            if (s.p24 !== null) pts.push({ validTime: new Date(t0 + 24 * HR).toISOString(), secondary: s.p24 / 1000 });
            if (s.p48 !== null) pts.push({ validTime: new Date(t0 + 48 * HR).toISOString(), secondary: s.p48 / 1000 });
            const body = { secondaryUnits: 'kcfs', data: pts };
            return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
        };

        await M.fetchNWSForecasts();

        const bare = urls.filter((u) => /^\/nwps\/v1\/gauges\/[^/]+$/.test(new URL(u).pathname));
        assert.deepEqual(bare, [], 'no flood-stage (bare gauge) request');
        for (const id of ids) {
            const lid = M.NWS_LIDS[id].toLowerCase();
            const n = urls.filter((u) => new URL(u).pathname.split('/')[4].toLowerCase() === lid).length;
            const has = sc[id] ? (sc[id].p24 !== null || sc[id].p48 !== null) : false;
            // gauges outside the scenarios answer 404 on every endpoint, so they also try all four
            assert.equal(n, has ? 1 : 4, `${lid} request count`);
        }

        const d = M.store.data;
        const withForecast = [0, 1, 2, 3, 5, 6].map((i) => ids[i]);
        for (const id of withForecast) {
            const s = sc[id];
            const fut = s.p24 || s.p48;
            const rate = (fut - s.q) / s.q;
            const dir = rate > 0.02 ? 'up' : rate < -0.02 ? 'down' : 'stable';
            assert.ok(d[id].forecast, `${s.name}: forecast set`);
            assert.equal(d[id].trend.source, 'NWS', s.name);
            assert.equal(d[id].trend.direction, dir, s.name);
            assert.ok(Math.abs(d[id].trend.rate - rate) < 1e-9, `${s.name}: rate ${d[id].trend.rate} vs ${rate}`);
            assert.equal(d[id].floodCategory, undefined);
        }
        assert.deepEqual(withForecast.map((id) => d[id].trend.direction), ['up', 'down', 'stable', 'up', 'up', 'down']);
        assert.equal(d[ids[3]].forecast.forecast24, null, 'the fallback gauge has no 24 h value');
        assert.equal(d[ids[4]].forecast, undefined);
        assert.equal(d[ids[4]].trend, undefined);
    });
});

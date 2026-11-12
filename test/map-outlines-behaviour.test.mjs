// v39.8 (TODO S6): the map outline files load on the first map open, not at initMap. Behaviour test:
// real map.js bundled with esbuild (one entry, so store.js is shared) and a recording stub for Leaflet.
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Chainable recording stub: every property read and every call returns the stub itself. `then` is undefined so
// that awaiting it does not hang.
const LEAFLET_STUB = `
const make = () => new Proxy(function () {}, {
    get: (_t, p) => (p === 'then' || p === Symbol.toPrimitive ? undefined : stub),
    apply: () => stub,
    construct: () => stub
});
const stub = make();
export default stub;
`;

let M;
before(async () => {
    const leafletStub = {
        name: 'leaflet-stub',
        setup(b) {
            b.onResolve({ filter: /^leaflet$/ }, () => ({ path: 'leaflet-stub', namespace: 'stub' }));
            b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: LEAFLET_STUB, loader: 'js' }));
        }
    };
    const entry = [
        `export { initMap, toggleMap } from ${JSON.stringify(resolve(root, 'src/ui/map.js'))};`,
        `export * as store from ${JSON.stringify(resolve(root, 'src/state/store.js'))};`
    ].join('\n');
    const out = await build({
        stdin: { contents: entry, resolveDir: root, sourcefile: 'map-entry.mjs', loader: 'js' },
        bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', plugins: [leafletStub]
    });
    M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
});

const saved = {};
const setGlobal = (k, v) => {
    if (!(k in saved)) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k) ?? null;
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
};
const tick = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
let urls;

beforeEach(() => {
    urls = [];
    const stubEl = () => ({
        style: {}, appendChild() {}, setAttribute() {}, addEventListener() {},
        classList: { add() {}, remove() {}, toggle() {} }
    });
    let shown = false;
    setGlobal('document', {
        getElementById: () => stubEl(),
        createElement: () => stubEl(),
        body: { classList: { toggle: () => (shown = !shown), remove: () => { shown = false; } } }
    });
    setGlobal('fetch', async (u) => {
        urls.push(String(u));
        return { json: async () => ({ type: 'FeatureCollection', features: [] }) };
    });
});
afterEach(() => {
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; delete saved[k]; }
});

const outlineUrls = () => urls.filter((u) => /potomac-.*\.geojson/.test(u));

describe('map outlines load on the first map open (TODO S6)', () => {
    it('initMap fetches no outline file', async () => {
        M.initMap();
        await tick();
        assert.deepEqual(outlineUrls(), []);
        assert.ok(M.store.map, 'the map was created');
    });
    it('the first toggleMap (show) fetches both files once; later toggles fetch nothing more', async () => {
        M.initMap();
        await tick();
        M.toggleMap(); // show
        await tick();
        assert.equal(outlineUrls().filter((u) => u.includes('potomac-watershed.geojson')).length, 1);
        assert.equal(outlineUrls().filter((u) => u.includes('potomac-nhd.geojson')).length, 1);
        M.toggleMap(); // hide
        M.toggleMap(); // show again
        await tick();
        assert.equal(outlineUrls().length, 2);
    });
});

// Potomac Pulse — Phase-0 characterization harness (READ-ONLY safety net).
//
// Purpose: load BOTH estimators so we can run identical inputs through each and
// snapshot/quantify where they diverge BEFORE any refactor touches the model:
//   - CLIENT  src/estimation/great-falls.js  estimateGreatFalls()
//   - SERVER  netlify/functions/scheduled-update.js  _test.makeGFPrediction()
//
// Why this is non-trivial (and why the harness looks the way it does):
//   1. The client estimator is ESM-syntax `.js` but the repo has no
//      "type":"module", so Node cannot `import` it directly. We esbuild-bundle it
//      AT TEST TIME (esbuild ships with Vite) into a single in-memory ESM module
//      imported via a data: URL. Bundling at test time means the snapshot always
//      reflects current source — no committed generated artifact to drift.
//   2. edwards-ferry.js imports `fetchWithTimeout` from data/fetch.js, which pulls
//      in the whole UI layer + Leaflet. The estimate path never calls it, so we
//      stub that one module at the esbuild layer (see stubFetchPlugin).
//   3. estimateGreatFalls -> recordPoRReading -> localStorage, absent in Node, so
//      we install a tiny in-memory localStorage shim.
//
// This harness MODIFIES NO SOURCE FILES.

import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..'); // project root
const require = createRequire(import.meta.url);

// In-memory localStorage shim (recordPoRReading/savePoRHistory call setItem).
function installLocalStorageShim() {
    if (globalThis.localStorage) return;
    const map = new Map();
    globalThis.localStorage = {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
        clear: () => map.clear(),
    };
}

// Cut the single bridge from the estimator graph to the UI/network world.
// (edwards-ferry.js: `import { fetchWithTimeout } from '../data/fetch.js'`)
const stubFetchPlugin = {
    name: 'stub-fetch',
    setup(b) {
        b.onResolve({ filter: /data\/fetch(\.js)?$/ }, () => ({ path: 'char-stub-fetch', namespace: 'char-stub' }));
        b.onLoad({ filter: /.*/, namespace: 'char-stub' }, () => ({
            contents: `export async function fetchWithTimeout(){ throw new Error('fetchWithTimeout is stubbed in the characterization harness'); }`,
            loader: 'js',
        }));
    },
};

let _cache = null;

export async function loadEstimators() {
    if (_cache) return _cache;
    installLocalStorageShim();

    const entry = [
        `export { estimateGreatFalls, computeUncertaintyBand } from ${JSON.stringify(resolve(ROOT, 'src/estimation/great-falls.js'))};`,
        `export * as store from ${JSON.stringify(resolve(ROOT, 'src/state/store.js'))};`,
        `export * as model from ${JSON.stringify(resolve(ROOT, 'src/model/shared-model.js'))};`,
    ].join('\n');

    const out = await build({
        stdin: { contents: entry, resolveDir: ROOT, sourcefile: 'char-entry.mjs', loader: 'js' },
        bundle: true,
        format: 'esm',
        platform: 'node',
        write: false,
        logLevel: 'silent',
        plugins: [stubFetchPlugin],
    });

    const code = out.outputFiles[0].text;
    const client = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

    // Server predictor (CJS) via createRequire — same module the existing
    // test/scheduled-update.test.js exercises through its _test export.
    const { _test } = require(resolve(ROOT, 'netlify/functions/scheduled-update.js'));

    _cache = {
        estimateGreatFalls: client.estimateGreatFalls,
        computeUncertaintyBand: client.computeUncertaintyBand,
        store: client.store,
        model: client.model,
        makeGFPrediction: _test.makeGFPrediction,
    };
    return _cache;
}

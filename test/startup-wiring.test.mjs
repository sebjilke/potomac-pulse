// v39.7: minimal structural guards (source text). These only prove the wiring exists; the behaviour is
// covered in refresh.test.mjs, learning-deadline.test.mjs and startup-refresh-behaviour.test.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

describe('v39.7 wiring', () => {
    const init = read('src/init.js');
    it('init.js no longer waits on the learning load, and uses refreshAll', () => {
        assert.doesNotMatch(init, /await loadGFLearningData/);
        assert.match(init, /await refreshAll\(\)/);
        assert.match(init, /refreshAll\(\);\s*\/\/ v39\.7: the fallback/);
    });
    it('init.js subscribes learning:loaded and fetch:settled, and registers the three resume listeners', () => {
        assert.match(init, /on\('learning:loaded', onLearningLoaded\)/);
        assert.match(init, /on\('fetch:settled', onFetchSettled\)/);
        assert.match(init, /document\.addEventListener\('visibilitychange'/);
        assert.match(init, /window\.addEventListener\('pageshow'/);
        assert.match(init, /window\.addEventListener\('online', onResume\)/);
    });
    it('both buttons bind an arrow function, not the click event handler directly (PA-15)', () => {
        assert.match(init, /bindButton\('refreshBtn', \(\) => refreshAll\(\)\)/);
        assert.match(init, /bindButton\('gfRetryBtn', \(\) => refreshAll\(\)\)/);
    });
    it('onLearningLoaded also refreshes the bin table (PA-14)', () => {
        const rf = read('src/data/refresh.js');
        const fn = rf.slice(rf.indexOf('export function onLearningLoaded'), rf.indexOf('export function onFetchSettled'));
        assert.match(fn, /updateGFLearningUI\(\)/);
        assert.match(fn, /updateGreatFallsUI\(\)/);
        assert.ok(fn.indexOf('updateGFLearningUI()') < fn.indexOf('if (isFetching)'), 'bin table is filled before the fetching check (N-5)');
    });
    it('map.js: initMap fetches no outline file; toggleMap loads them on show', () => {
        const m = read('src/ui/map.js');
        const start = m.indexOf('export function initMap');
        const body = m.slice(start, m.indexOf('\n}\n', start));
        assert.ok(body.length > 500, 'found the initMap body');
        assert.doesNotMatch(body, /potomac-/);
        assert.doesNotMatch(body, /ensureMapOutlines|ensureOutlines|outlineLoader/);
        const tog = m.slice(m.indexOf('export function toggleMap'));
        assert.match(tog, /ensureMapOutlines\(\)/);
    });
    it('main.js interval calls refreshAll and no longer imports the learning loader', () => {
        const main = read('src/main.js');
        assert.match(main, /setInterval\(\(\) => \{ refreshAll\(\); \}, 900000\)/);
        assert.doesNotMatch(main, /loadGFLearningData/);
    });
    it('index.html has the hidden Try again button', () => {
        assert.match(read('index.html'), /<button[^>]*id="gfRetryBtn"[^>]*\bhidden\b/);
    });
    it('the v39.1 lines other tests read are still there (online/offline label redraw, creek subscriptions)', () => {
        assert.match(init, /addEventListener\('online', updateStalenessDisplay\)/);
        assert.match(init, /on\('data:unavailable', updateCreeksUI\)/);
        assert.match(init, /on\('data:updated', updateCreeksUI\)/);
    });
});

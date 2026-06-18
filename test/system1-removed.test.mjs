// Regression guard: System-1 (gauge-learning) was fully retired in v37.1.
// calcTravelTimes() can't be unit-tested in isolation (its module graph pulls in
// Leaflet/DOM), so this locks the removal structurally — the per-gauge travel time is now
// baseHrs × Searcy-multiplier with NO learned correction, and the dead sync surface is gone.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

describe('System-1 retirement (v37.1)', () => {
    it('deletes the System-1 client modules', () => {
        assert.equal(existsSync(resolve(root, 'src/learning/gauge-learning.js')), false);
        assert.equal(existsSync(resolve(root, 'src/learning/cloud-sync.js')), false);
    });

    it('calcTravelTimes applies no learned correction (baseHrs × mult only)', () => {
        const fetchSrc = read('src/data/fetch.js');
        assert.ok(!/getCorrectionFactor/.test(fetchSrc), 'getCorrectionFactor must be gone from fetch.js');
        assert.ok(!/recordObservation/.test(fetchSrc), 'recordObservation must be gone from fetch.js');
        assert.ok(!/d\.correction\s*=/.test(fetchSrc), 'd.correction must no longer be set');
        assert.ok(/d\.travelHrs\s*=\s*travelHrs/.test(fetchSrc), 'travelHrs is still assigned');
    });

    it('drops System-1 state from the store', () => {
        const storeSrc = read('src/state/store.js');
        for (const sym of ['learningData', 'learningEnabled', 'cloudSyncEnabled', 'syncPending', 'syncTimeout']) {
            assert.ok(!new RegExp(`\\b${sym}\\b`).test(storeSrc), `${sym} must be removed from store.js`);
        }
    });

    it('retires the System-1 server sync handlers but keeps the named endpoints', () => {
        const serverSrc = read('netlify/functions/sync-learning.js');
        assert.ok(!/function\s+saveLearningData/.test(serverSrc), 'saveLearningData removed');
        assert.ok(!/function\s+loadLearningData/.test(serverSrc), 'loadLearningData removed');
        // Live endpoints + shared validators must survive.
        assert.ok(/endpoint === 'gf'/.test(serverSrc), 'gf endpoint kept');
        assert.ok(/validatePostBody/.test(serverSrc), 'validatePostBody kept (used by gf endpoint)');
    });
});

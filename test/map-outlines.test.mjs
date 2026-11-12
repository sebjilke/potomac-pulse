// v39.7: lazy outline loader (pure; the Leaflet add functions are stubs).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createOutlineLoader } from '../src/ui/map-outlines.js';

const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

function setup(failing = new Set()) {
    const fetched = [], added = [];
    const fetchFn = async (url) => {
        fetched.push(url);
        if (failing.has(url)) throw new Error('offline');
        return { json: async () => ({ url }) };
    };
    const loader = createOutlineLoader({
        fetchFn,
        files: [
            { url: '/a.geojson', add: (d) => added.push(['a', d.url]) },
            { url: '/b.geojson', add: (d) => added.push(['b', d.url]) }
        ]
    });
    return { fetched, added, loader, failing };
}

describe('createOutlineLoader', () => {
    it('no fetch until ensureOutlines is called', () => {
        const { fetched } = setup();
        assert.deepEqual(fetched, []);
    });
    it('one promise per file: a second call fetches and adds nothing more', async () => {
        const { fetched, added, loader } = setup();
        await loader.ensureOutlines();
        await loader.ensureOutlines();
        assert.deepEqual(fetched, ['/a.geojson', '/b.geojson']);
        assert.equal(added.length, 2);
    });
    it('concurrent calls share the in-flight promises', async () => {
        const { fetched, loader } = setup();
        await Promise.all([loader.ensureOutlines(), loader.ensureOutlines()]);
        assert.equal(fetched.length, 2);
    });
    it('a failed file retries on the next call without duplicating the other', async () => {
        const { fetched, added, loader, failing } = setup(new Set(['/b.geojson']));
        await quiet(() => loader.ensureOutlines());
        assert.deepEqual(added, [['a', '/a.geojson']]);
        failing.clear();
        await loader.ensureOutlines();
        assert.deepEqual(fetched, ['/a.geojson', '/b.geojson', '/b.geojson']);
        assert.deepEqual(added, [['a', '/a.geojson'], ['b', '/b.geojson']]);
        await loader.ensureOutlines();
        assert.equal(fetched.length, 3);
    });
});

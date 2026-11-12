// v39.7: createRefresher with stub deps.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRefresher } from '../src/data/refresh.js';

const MIN = 60000;
const NOW = Date.parse('2026-11-12T15:00:00Z');

function mk(stateOver = {}) {
    const calls = [];
    const state = { bodyMs: NOW - 30 * MIN, fetchMs: NOW, source: 'live', lastAttemptMs: null, online: true, visible: true, fetching: false, ...stateOver };
    const deps = {
        loadLearning: () => { calls.push('learn'); return Promise.resolve(); },
        fetchData: () => { calls.push('fetch'); return Promise.resolve(); },
        getState: () => state, now: () => NOW
    };
    return { calls, state, deps, r: createRefresher(deps) };
}

describe('createRefresher.refreshAll', () => {
    it('starts both calls in the same tick (before any await)', () => {
        const { calls, r } = mk();
        r.refreshAll();
        assert.deepEqual(calls, ['learn', 'fetch']);
    });
    it('a rejected learning load does not stop the fetch', async () => {
        const { calls, deps } = mk();
        const r = createRefresher({ ...deps, loadLearning: () => { calls.push('learn'); return Promise.reject(new Error('x')); } });
        const w = console.warn; console.warn = () => {};
        try { await r.refreshAll(); } finally { console.warn = w; }
        assert.deepEqual(calls, ['learn', 'fetch']);
    });
    it('a throwing learning load (sync) does not stop the fetch; a rejected fetch does not stop learning', async () => {
        const { calls, deps } = mk();
        const w = console.warn; console.warn = () => {};
        try {
            const a = createRefresher({ ...deps, loadLearning: () => { throw new Error('sync'); } });
            await a.refreshAll();
            const b = createRefresher({ ...deps, fetchData: () => { calls.push('fetch'); return Promise.reject(new Error('y')); } });
            const res = await b.refreshAll();
            assert.equal(res.length, 2);
            assert.ok(res.every((x) => x.status === 'fulfilled'));
        } finally { console.warn = w; }
        assert.deepEqual(calls, ['fetch', 'learn', 'fetch']);
    });
});

describe('createRefresher resume', () => {
    it('maybeResume refreshes when the age test says old', () => {
        const { calls, r } = mk();
        assert.equal(r.maybeResume(), true);
        assert.deepEqual(calls, ['learn', 'fetch']);
        assert.equal(r.isResumePending(), false);
    });
    it('maybeResume does nothing when fresh', () => {
        const { calls, r } = mk({ bodyMs: NOW - 2 * MIN });
        assert.equal(r.maybeResume(), false);
        assert.deepEqual(calls, []);
    });
    it('while fetching: sets the pending flag; the settle hook re-runs exactly once, and never chains', () => {
        const { calls, state, r } = mk({ fetching: true });
        assert.equal(r.maybeResume(), false);
        assert.equal(r.isResumePending(), true);
        assert.deepEqual(calls, []);
        state.fetching = false;
        assert.equal(r.onFetchSettled(), true);
        assert.deepEqual(calls, ['learn', 'fetch']);
        assert.equal(r.isResumePending(), false);
        assert.equal(r.onFetchSettled(), false); // second settle: nothing
        assert.deepEqual(calls, ['learn', 'fetch']);
    });
    it('several wake events during one fetch still give one re-run', () => {
        const { calls, state, r } = mk({ fetching: true });
        r.maybeResume(); r.maybeResume(); r.maybeResume();
        state.fetching = false;
        r.onFetchSettled(); r.onFetchSettled();
        assert.equal(calls.filter((c) => c === 'fetch').length, 1);
    });
    it('the re-run skips only the 60 s gap: allowed inside the gap, skipped when the age is fresh', () => {
        const a = mk({ fetching: true, lastAttemptMs: NOW - 5000 });
        a.r.maybeResume();
        a.state.fetching = false;
        assert.equal(a.r.onFetchSettled(), true); // old data, inside the gap: force skips the gap
        const b = mk({ fetching: true });
        b.r.maybeResume();
        b.state.fetching = false;
        b.state.bodyMs = NOW - 1 * MIN; // the fetch that just ended made it fresh
        assert.equal(b.r.onFetchSettled(), false);
        assert.deepEqual(b.calls, []);
        assert.equal(b.r.isResumePending(), false);
    });
    it('no flag when hidden or offline', () => {
        const a = mk({ fetching: true, visible: false });
        a.r.maybeResume();
        assert.equal(a.r.isResumePending(), false);
        const b = mk({ fetching: true, online: false });
        b.r.maybeResume();
        assert.equal(b.r.isResumePending(), false);
    });
    it('the settle hook without a pending flag does nothing', () => {
        const { calls, r } = mk();
        assert.equal(r.onFetchSettled(), false);
        assert.deepEqual(calls, []);
    });
});

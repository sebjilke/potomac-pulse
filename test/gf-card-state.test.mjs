// v39.7: card state table (pure).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gfCardState } from '../src/ui/gf-card-state.js';

const base = { learningReady: true, efReady: true, fetchSettled: true, sourceUnavailable: false, hasEstimate: false, iceIssue: false };
const st = (o) => gfCardState({ ...base, ...o });

describe('gfCardState', () => {
    it('learning not ready is loading, whatever else is true', () => {
        assert.deepEqual(st({ learningReady: false, efReady: false, fetchSettled: true }), { kind: 'loading', text: 'Loading corrections...' });
        assert.equal(st({ learningReady: false, hasEstimate: true }).kind, 'loading');
    });
    it('EF missing: loading before the fetch settles, unavailable after', () => {
        assert.deepEqual(st({ efReady: false, fetchSettled: false }), { kind: 'loading', text: 'Loading EF data...' });
        assert.deepEqual(st({ efReady: false }), { kind: 'unavailable', text: 'Edwards Ferry data did not load.' });
        assert.deepEqual(st({ efReady: false, sourceUnavailable: true }), { kind: 'unavailable', text: 'USGS data did not load.' });
    });
    it('EF ready, no estimate: waiting before settle, reason after', () => {
        assert.deepEqual(st({ fetchSettled: false }), { kind: 'loading', text: 'Waiting for data...' });
        assert.deepEqual(st({}), { kind: 'unavailable', text: 'Little Falls or Point of Rocks readings are missing.' });
        assert.deepEqual(st({ sourceUnavailable: true }), { kind: 'unavailable', text: 'USGS data did not load.' });
    });
    it('a computed estimate is never replaced by the message', () => {
        for (const fetchSettled of [true, false]) for (const sourceUnavailable of [true, false]) {
            assert.equal(st({ hasEstimate: true, fetchSettled, sourceUnavailable }).kind, 'ready');
        }
    });
    it('ice passes through unchanged (even after settle), but EF missing still wins', () => {
        assert.equal(st({ iceIssue: true }).kind, 'ice');
        assert.equal(st({ iceIssue: true, fetchSettled: false }).kind, 'ice');
        assert.equal(st({ iceIssue: true, efReady: false }).kind, 'unavailable');
    });
    it('never unavailable before fetchSettled (all input combinations)', () => {
        for (const learningReady of [true, false]) for (const efReady of [true, false])
            for (const sourceUnavailable of [true, false]) for (const hasEstimate of [true, false]) for (const iceIssue of [true, false]) {
                const r = gfCardState({ learningReady, efReady, fetchSettled: false, sourceUnavailable, hasEstimate, iceIssue });
                assert.notEqual(r.kind, 'unavailable');
            }
    });
});

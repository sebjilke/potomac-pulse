// v39.7: resume policy truth table (pure).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lastGoodMs, shouldResumeRefresh, RESUME_STALE_MIN, RESUME_ATTEMPT_GAP_MS } from '../src/data/refresh.js';

const MIN = 60000;
const NOW = Date.parse('2026-11-12T15:00:00Z');
const base = { now: NOW, lastGood: NOW - 30 * MIN, lastAttemptMs: null, online: true, visible: true, fetching: false };
const go = (o) => shouldResumeRefresh({ ...base, ...o });

describe('lastGoodMs', () => {
    it('body time wins over fetch time', () => {
        assert.equal(lastGoodMs({ bodyMs: 100, fetchMs: 999, source: 'live' }), 100);
        assert.equal(lastGoodMs({ bodyMs: 100, fetchMs: 999, source: 'cached' }), 100);
    });
    it('no body time: fetch time only for a live answer', () => {
        assert.equal(lastGoodMs({ bodyMs: null, fetchMs: 999, source: 'live' }), 999);
        assert.equal(lastGoodMs({ bodyMs: null, fetchMs: 999, source: 'cached' }), null);
        assert.equal(lastGoodMs({ bodyMs: null, fetchMs: 999, source: 'stale' }), null);
        assert.equal(lastGoodMs({ bodyMs: undefined, fetchMs: 999, source: 'unavailable' }), null);
        assert.equal(lastGoodMs({ bodyMs: null, fetchMs: null, source: 'live' }), null);
    });
});

describe('shouldResumeRefresh truth table', () => {
    it('constants are 10 min and 60 s', () => {
        assert.equal(RESUME_STALE_MIN, 10);
        assert.equal(RESUME_ATTEMPT_GAP_MS, 60000);
    });
    it('hidden, offline or fetching never resume (even forced)', () => {
        assert.equal(go({ visible: false }), false);
        assert.equal(go({ online: false }), false);
        assert.equal(go({ fetching: true }), false);
        assert.equal(go({ visible: false, force: true }), false);
        assert.equal(go({ online: false, force: true }), false);
        assert.equal(go({ fetching: true, force: true }), false);
    });
    it('age boundary: 9 min no, 10 min yes', () => {
        assert.equal(go({ lastGood: NOW - 9 * MIN }), false);
        assert.equal(go({ lastGood: NOW - 10 * MIN + 1 }), false);
        assert.equal(go({ lastGood: NOW - 10 * MIN }), true);
        assert.equal(go({ lastGood: NOW - 11 * MIN }), true);
    });
    it('null lastGood resumes', () => {
        assert.equal(go({ lastGood: null }), true);
    });
    it('attempt gap: under 60 s blocks, 60 s allows; force skips only the gap', () => {
        assert.equal(go({ lastAttemptMs: NOW - 59 * 1000 }), false);
        assert.equal(go({ lastAttemptMs: NOW - 60 * 1000 }), true);
        assert.equal(go({ lastAttemptMs: NOW - 10 * 1000, force: true }), true);
        // force does not skip the age test
        assert.equal(go({ lastAttemptMs: NOW - 10 * 1000, lastGood: NOW - 2 * MIN, force: true }), false);
    });
    it('clock skew row 1 (PA-5): a server time 1 to 5 min in the future is skew, not unknown, and does not resume', () => {
        assert.equal(go({ lastGood: NOW + 1 * MIN }), false);
        assert.equal(go({ lastGood: NOW + 4.9 * MIN }), false);
        assert.equal(go({ lastGood: NOW + 5 * MIN }), false);
    });
    it('clock skew row 2 (PA-5): a server time more than 5 min in the future (clock moved back) resumes', () => {
        assert.equal(go({ lastGood: NOW + 5 * MIN + 1000 }), true);
        assert.equal(go({ lastGood: NOW + 60 * MIN }), true);
    });
});

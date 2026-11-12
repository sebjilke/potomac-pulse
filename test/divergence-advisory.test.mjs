// v37.13 — client divergence-advisory helpers (src/ui/divergence-advisory.js).
// Pure display logic: show only when the server state is active AND fresh; one-notch
// confidence downgrade; copy honors the v38-verdict constraint (disagreement, not
// "EF is right").

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    shouldShowDivergenceAdvisory, downgradeConfidence,
    DIVERGENCE_LEAD, DIVERGENCE_TEXT, DIVERGENCE_LINE
} from '../src/ui/divergence-advisory.js';
import { EF_DIVERGENCE_STALE_MS } from '../src/model/constants.js';

const NOW = Date.parse('2026-07-20T12:00:00Z');
const iso = ms => new Date(ms).toISOString();

describe('shouldShowDivergenceAdvisory', () => {
    it('shows for an active, fresh state', () => {
        assert.equal(shouldShowDivergenceAdvisory({ active: true, updatedAt: iso(NOW - 30 * 60000) }, NOW), true);
    });

    it('hides an inactive state regardless of freshness', () => {
        assert.equal(shouldShowDivergenceAdvisory({ active: false, updatedAt: iso(NOW) }, NOW), false);
    });

    it('hides a stale state (cron stall must fail silent)', () => {
        assert.equal(shouldShowDivergenceAdvisory(
            { active: true, updatedAt: iso(NOW - EF_DIVERGENCE_STALE_MS - 60000) }, NOW), false);
    });

    it('hides null/missing state and malformed timestamps', () => {
        assert.equal(shouldShowDivergenceAdvisory(null, NOW), false);
        assert.equal(shouldShowDivergenceAdvisory(undefined, NOW), false);
        assert.equal(shouldShowDivergenceAdvisory({ active: true }, NOW), false);
        assert.equal(shouldShowDivergenceAdvisory({ active: true, updatedAt: 'not-a-date' }, NOW), false);
    });

    it('hides a future-dated state (clock skew is not freshness)', () => {
        assert.equal(shouldShowDivergenceAdvisory({ active: true, updatedAt: iso(NOW + 60 * 60000) }, NOW), false);
    });
});

describe('downgradeConfidence', () => {
    it('drops one notch and floors at low', () => {
        assert.equal(downgradeConfidence('high'), 'medium');
        assert.equal(downgradeConfidence('medium'), 'low');
        assert.equal(downgradeConfidence('low'), 'low');
    });
});

describe('advisory copy', () => {
    it('is non-empty and frames the signal as disagreement, not EF correctness', () => {
        assert.ok(DIVERGENCE_LINE.length > 100);
        assert.equal(DIVERGENCE_LINE, DIVERGENCE_LEAD + ' ' + DIVERGENCE_TEXT);
        assert.match(DIVERGENCE_LEAD, /disagrees/i);
        assert.match(DIVERGENCE_LINE, /disagrees/i);
        assert.doesNotMatch(DIVERGENCE_LINE, /Edwards Ferry is (right|correct)/i);
        assert.match(DIVERGENCE_LINE, /gauge noise/i, 'keeps the false-positive hedge');
    });
    it('PA-1: keeps the direction of the error (water this estimate may not fully see)', () => {
        assert.match(DIVERGENCE_LINE, /may not fully see/);
        assert.match(DIVERGENCE_LINE, /water entering below those gauges/);
        assert.match(DIVERGENCE_LINE, /well above/);
        assert.match(DIVERGENCE_LINE, /several hours/);
    });
    it('the closing sentence is shared, so the line itself no longer carries it or the title wording', () => {
        assert.doesNotMatch(DIVERGENCE_LINE, /believe the river/);
        assert.doesNotMatch(DIVERGENCE_LINE, /extra caution/);
        assert.doesNotMatch(DIVERGENCE_LINE, /upper limit/i);
    });
});

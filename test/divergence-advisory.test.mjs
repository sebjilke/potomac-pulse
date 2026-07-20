// v37.13 — client divergence-advisory helpers (src/ui/divergence-advisory.js).
// Pure display logic: show only when the server state is active AND fresh; one-notch
// confidence downgrade; copy honors the v38-verdict constraint (disagreement, not
// "EF is right").

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    shouldShowDivergenceAdvisory, downgradeConfidence,
    DIVERGENCE_ADVISORY_TITLE, DIVERGENCE_ADVISORY_BODY
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
        assert.ok(DIVERGENCE_ADVISORY_TITLE.length > 10);
        assert.ok(DIVERGENCE_ADVISORY_BODY.length > 100);
        assert.match(DIVERGENCE_ADVISORY_TITLE, /disagrees/i);
        assert.doesNotMatch(DIVERGENCE_ADVISORY_BODY, /Edwards Ferry is (right|correct)/i);
        assert.match(DIVERGENCE_ADVISORY_BODY, /gauge noise/i, 'keeps the false-positive hedge');
    });
});

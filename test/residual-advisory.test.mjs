// v37.15 — client LF-residual-advisory helpers (src/ui/residual-advisory.js).
// Pure display logic: show only when the server state is active AND fresh; downgrade
// stacking with the EF advisory; client↔server staleness-constant parity (plan F8-3,
// retrofitted for the EF pair too, which shipped without it).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
    shouldShowResidualAdvisory,
    RESIDUAL_LEAD, RESIDUAL_TEXT, RESIDUAL_LINE
} from '../src/ui/residual-advisory.js';
import { downgradeConfidence } from '../src/ui/divergence-advisory.js';
import { NOTICE_CLOSING } from '../src/ui/estimate-notice.js';
import { LF_RESIDUAL_STALE_MS, EF_DIVERGENCE_STALE_MS } from '../src/model/constants.js';

const require = createRequire(import.meta.url);
const { LF_RESIDUAL, EF_DIVERGENCE } = require('../netlify/functions/shared/model.js');

const NOW = Date.parse('2026-07-23T12:00:00Z');
const iso = ms => new Date(ms).toISOString();

describe('shouldShowResidualAdvisory', () => {
    it('shows for an active, fresh state', () => {
        assert.equal(shouldShowResidualAdvisory({ active: true, updatedAt: iso(NOW - 30 * 60000) }, NOW), true);
    });

    it('hides an inactive state regardless of freshness', () => {
        assert.equal(shouldShowResidualAdvisory({ active: false, updatedAt: iso(NOW) }, NOW), false);
    });

    it('hides a stale state (cron stall must fail silent)', () => {
        assert.equal(shouldShowResidualAdvisory(
            { active: true, updatedAt: iso(NOW - LF_RESIDUAL_STALE_MS - 60000) }, NOW), false);
    });

    it('hides null/missing state and malformed timestamps', () => {
        assert.equal(shouldShowResidualAdvisory(null, NOW), false);
        assert.equal(shouldShowResidualAdvisory(undefined, NOW), false);
        assert.equal(shouldShowResidualAdvisory({ active: true }, NOW), false);
        assert.equal(shouldShowResidualAdvisory({ active: true, updatedAt: 'not-a-date' }, NOW), false);
    });

    it('hides a future-dated state (clock skew is not freshness — plan F8-7)', () => {
        assert.equal(shouldShowResidualAdvisory({ active: true, updatedAt: iso(NOW + 60 * 60000) }, NOW), false);
    });
});

describe('advisory stacking (v37.15 — intended behavior)', () => {
    it('both advisories active: two one-notch downgrades take high to low', () => {
        assert.equal(downgradeConfidence(downgradeConfidence('high')), 'low');
        assert.equal(downgradeConfidence(downgradeConfidence('medium')), 'low');
        assert.equal(downgradeConfidence(downgradeConfidence('low')), 'low');
    });
});

describe('client↔server staleness-constant parity (plan F8-3)', () => {
    it('LF_RESIDUAL_STALE_MS (client) equals LF_RESIDUAL.clientStaleMs (server)', () => {
        assert.equal(LF_RESIDUAL_STALE_MS, LF_RESIDUAL.clientStaleMs);
    });

    it('EF_DIVERGENCE_STALE_MS (client) equals EF_DIVERGENCE.staleMs (server) — retrofit', () => {
        assert.equal(EF_DIVERGENCE_STALE_MS, EF_DIVERGENCE.staleMs);
    });
});

describe('advisory copy (audit-constrained wording)', () => {
    it('says "Recent"/"often", never claims certainty or blames a cause definitively (plan F7)', () => {
        assert.equal(RESIDUAL_LINE, RESIDUAL_LEAD + ' ' + RESIDUAL_TEXT);
        assert.ok(RESIDUAL_LINE.includes('Recent'));
        assert.ok(RESIDUAL_LINE.includes('often'));
        assert.ok(!RESIDUAL_LINE.includes('usually'));
        assert.ok(RESIDUAL_LINE.includes('may be low'));
    });
    it('the shared closing sentence (extra caution, believe the river) lives in estimate-notice.js, once', () => {
        assert.ok(!RESIDUAL_LINE.includes('believe the river'));
        assert.ok(NOTICE_CLOSING.includes('extra caution'));
        assert.ok(NOTICE_CLOSING.includes('believe the river'));
    });
});

// Tests for the offline indicator's pure decision function (offline-banner.js, #19 / v37.10).
//
// Only the pure shouldShowOffline() is unit-tested — initOfflineBanner() and the service worker are
// DOM/SW-only and verified in-browser (see analysis/service-worker-offline-plan-2026-06-23.md).
// Importing the module under Node must not throw, which asserts it has no top-level DOM/window access.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowOffline } from '../src/ui/offline-banner.js';

describe('shouldShowOffline', () => {
    it('shows the indicator when the browser is offline', () => {
        assert.equal(shouldShowOffline(false), true);
    });

    it('hides the indicator when the browser is online', () => {
        assert.equal(shouldShowOffline(true), false);
    });
});

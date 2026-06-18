// Tier 2 #5: a USGS-fetch failure must flow into the catch block's healthchecks /fail ping,
// not silently early-return. Regression test for the invisible-cron-stall bug (v37.2).
//
// Env vars are set BEFORE requiring the module because shared/model.js captures SUPABASE_URL /
// SUPABASE_SERVICE_KEY at import time (so getSupabase() returns a client and the handler reaches the
// USGS branch instead of the pre-try "Supabase not configured" return). `node --test` runs each test
// file in its own process, so this ordering is isolated from other suites.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
process.env.HEALTHCHECKS_PING_URL = 'https://hc-ping.test/abc-123';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { handler } = require('../netlify/functions/scheduled-update');

describe('cron handler — USGS-null fires the healthchecks /fail ping (Tier 2 #5)', () => {
    it('pings <HEALTHCHECKS_PING_URL>/fail and returns 500 when USGS data is unavailable', async (t) => {
        const calls = [];
        // Reject every fetch: fetchUSGSData/fetchWaterTemp return null (→ !usgsData → throw),
        // and the catch block's /fail ping is still ATTEMPTED (recorded here) before its own
        // non-fatal try/catch swallows the rejection.
        t.mock.method(global, 'fetch', (url) => {
            calls.push(String(url));
            return Promise.reject(new Error('network down (mocked)'));
        });

        const res = await handler({}, {});

        assert.equal(res.statusCode, 500, 'USGS-null run should still return 500');
        assert.ok(
            calls.some((u) => u.endsWith('/fail')),
            `expected a healthchecks /fail ping; fetch was called with: ${JSON.stringify(calls)}`
        );
        // And it must NOT have fired the success ping (the bare HEALTHCHECKS_PING_URL with no suffix).
        assert.ok(
            !calls.some((u) => u === process.env.HEALTHCHECKS_PING_URL),
            'must not fire the success heartbeat on a failed run'
        );
    });
});

// Tests for the validation-failure READ endpoint (sync-learning.js, #18 / v37.9).
//
// loadValidationFailures returns {entries} (newest-first, capped 50) and 500s on a query error.
// The WRITE side — validatePendingPredictions emitting a `validation_failure` row on a hard flag —
// is tested in test/scheduled-update.test.js (it drives the real function through validateClient).

// ADMIN_PIN is captured at module-load (sync-learning.js), so it MUST be set before require().
process.env.ADMIN_PIN = 'test-pin-1234';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { loadValidationFailures } = require('../netlify/functions/sync-learning')._test;

// Minimal chainable mock: select/eq/order return the builder; .limit() is the terminal that
// resolves the scripted rows (or an error) — mirrors the loadAuditLog read shape.
function mockClient({ limitResult } = {}) {
    return {
        from() {
            const b = {
                select() { return b; },
                eq() { return b; },
                order() { return b; },
                limit() { return Promise.resolve(limitResult ?? { data: [], error: null }); },
            };
            return b;
        }
    };
}

describe('loadValidationFailures', () => {
    it("returns {entries} (the rows' data payloads), 200", async () => {
        const rows = [
            { data: { predictionId: 'p2', actualCFS: 1200, anomalyFlags: ['LOW_FLOW_HIGH_STAGE:1200cfs@2.5ft'], validatedAt: '2026-06-22T10:00:00Z' } },
            { data: { predictionId: 'p1', actualCFS: 900, anomalyFlags: ['STAGE_DISCHARGE:expected=2000,actual=900,disc=122%'], validatedAt: '2026-06-21T10:00:00Z' } },
        ];
        const res = await loadValidationFailures(mockClient({ limitResult: { data: rows, error: null } }));
        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.entries.length, 2);
        assert.equal(body.entries[0].predictionId, 'p2');
        assert.deepEqual(body.entries[1].anomalyFlags, ['STAGE_DISCHARGE:expected=2000,actual=900,disc=122%']);
    });

    it('returns {entries:[]} when there are no failures, 200', async () => {
        const res = await loadValidationFailures(mockClient({ limitResult: { data: [], error: null } }));
        assert.equal(res.statusCode, 200);
        assert.deepEqual(JSON.parse(res.body).entries, []);
    });

    it('returns 500 on a query error', async () => {
        const res = await loadValidationFailures(mockClient({ limitResult: { data: null, error: { message: 'boom' } } }));
        assert.equal(res.statusCode, 500);
        assert.ok(JSON.parse(res.body).error);
    });
});

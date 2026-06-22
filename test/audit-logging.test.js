// Tests for admin audit logging (sync-learning.js, #17 / v37.8).
//
// Covers: logAdminAction inserts the right append-only row and is NON-FATAL (swallows insert
// errors); loadAuditLog returns {entries} and 500s on error; and a characterization that a reset
// handler still returns its success result even when the audit insert fails (the non-fatal guarantee).

// ADMIN_PIN is captured at module-load (sync-learning.js:7), so it MUST be set before require().
process.env.ADMIN_PIN = 'test-pin-1234';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { logAdminAction, loadAuditLog, saveGFLearningData } = require('../netlify/functions/sync-learning')._test;

// A chainable mock Supabase builder. Every filter/select returns the builder; terminals resolve
// {data,error}. Knobs: capture inserts, script the .limit() read, and make .insert fail.
function mockClient({ onInsert, limitResult, failInsert = false } = {}) {
    return {
        from() {
            const b = {
                select() { return b; },
                eq() { return b; },
                order() { return b; },
                limit() { return Promise.resolve(limitResult ?? { data: [], error: null }); },
                single() { return Promise.resolve({ data: null, error: null }); },
                upsert() { return Promise.resolve({ error: null }); },
                delete() { return b; },
                insert(row) {
                    if (onInsert) onInsert(row);
                    return failInsert ? Promise.reject(new Error('audit boom')) : Promise.resolve({ error: null });
                },
                // bins/pending deletes + bare selects are awaited directly → thenable terminal
                then(resolve, reject) { return Promise.resolve({ data: null, error: null }).then(resolve, reject); }
            };
            return b;
        }
    };
}

describe('logAdminAction', () => {
    it('inserts one append-only audit_log row with the right shape', async () => {
        let captured = null;
        await logAdminAction(mockClient({ onInsert: (r) => { captured = r; } }), 'resetGFLearning', { deletedCount: 3 });
        assert.ok(captured, 'insert was called');
        assert.equal(captured.observation_type, 'audit_log');
        assert.match(captured.gauge_id, /^\d+_resetGFLearning$/);   // `${Date.now()}_${action}`
        assert.equal(captured.data.action, 'resetGFLearning');
        assert.deepEqual(captured.data.details, { deletedCount: 3 });
        assert.equal(typeof captured.data.at, 'string');
        assert.ok(!Number.isNaN(Date.parse(captured.data.at)), 'at is a valid ISO timestamp');
    });

    it('normalizes missing details to null', async () => {
        let captured = null;
        await logAdminAction(mockClient({ onInsert: (r) => { captured = r; } }), 'resetForecastAccuracy');
        assert.equal(captured.data.details, null);
    });

    it('is NON-FATAL: swallows a rejected insert (does not throw)', async () => {
        await assert.doesNotReject(() => logAdminAction(mockClient({ failInsert: true }), 'resetGFLearning', {}));
    });

    it('is NON-FATAL: swallows a synchronously-throwing client', async () => {
        const throwingClient = { from() { throw new Error('client boom'); } };
        await assert.doesNotReject(() => logAdminAction(throwingClient, 'x', null));
    });
});

describe('loadAuditLog', () => {
    it('returns {entries} (the rows\' data), 200', async () => {
        const rows = [{ data: { action: 'resetGFLearning', at: '2026-06-21T10:00:00Z' } },
            { data: { action: 'resetLowFlowBins', at: '2026-06-20T10:00:00Z', details: { deletedCount: 2 } } }];
        const res = await loadAuditLog(mockClient({ limitResult: { data: rows, error: null } }));
        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.entries.length, 2);
        assert.equal(body.entries[0].action, 'resetGFLearning');
        assert.deepEqual(body.entries[1].details, { deletedCount: 2 });
    });

    it('tolerates an empty table -> 200 with []', async () => {
        const res = await loadAuditLog(mockClient({ limitResult: { data: null, error: null } }));
        assert.equal(res.statusCode, 200);
        assert.deepEqual(JSON.parse(res.body).entries, []);
    });

    it('returns 500 on a query error', async () => {
        const res = await loadAuditLog(mockClient({ limitResult: { data: null, error: { message: 'db down' } } }));
        assert.equal(res.statusCode, 500);
    });
});

describe('non-fatal guarantee on the reset handler', () => {
    it('resetGFLearning still returns success (200) even when the audit insert fails', async () => {
        const res = await saveGFLearningData(
            mockClient({ failInsert: true }),
            { action: 'resetGFLearning', pin: 'test-pin-1234' }
        );
        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.success, true);
        assert.equal(body.action, 'resetGFLearning');
    });

    it('resetGFLearning rejects a wrong PIN with 403 (audit never runs)', async () => {
        let inserted = false;
        const res = await saveGFLearningData(
            mockClient({ onInsert: () => { inserted = true; } }),
            { action: 'resetGFLearning', pin: 'wrong' }
        );
        assert.equal(res.statusCode, 403);
        assert.equal(inserted, false);
    });
});

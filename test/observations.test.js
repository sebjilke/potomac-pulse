const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    getObs, getObsRaw, getObsRows,
    upsertObs, insertObs,
    deleteObs, deleteObsById, claimObsById,
} = require('../netlify/functions/shared/observations');

// ─── Mock client ────────────────────────────────────────────────────────────
// `from()` returns a chained builder that records the exact method sequence (op,
// filter chain, onConflict, etc.). Terminal methods (.single / awaited query / write
// ops) resolve to the configured result. Mirrors the chained-builder mock style in
// test/scheduled-update.test.js (validateClient).
function mockClient({ result = { data: null, error: null } } = {}) {
    const calls = [];          // ordered list of { method, args }
    const tableNames = [];     // every from() table arg
    const record = (method, ...args) => calls.push({ method, args });

    const builder = {
        select(...a) { record('select', ...a); return builder; },
        eq(...a) { record('eq', ...a); return builder; },
        order(...a) { record('order', ...a); return builder; },
        limit(...a) { record('limit', ...a); return builder; },
        single() { record('single'); return Promise.resolve(result); },
        upsert(...a) { record('upsert', ...a); return Promise.resolve(result); },
        insert(...a) { record('insert', ...a); return Promise.resolve(result); },
        delete(...a) { record('delete', ...a); return builder; },
        // Awaited directly (multi-row read, delete) — resolves the configured result.
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    };

    const client = {
        from(name) { tableNames.push(name); record('from', name); return builder; },
        _calls: calls,
        _tableNames: tableNames,
        // Convenience: the ordered method names (excluding the leading from()).
        seq() { return calls.filter(c => c.method !== 'from').map(c => c.method); },
        // Find a recorded call by method name (first match).
        call(method) { return calls.find(c => c.method === method); },
        callsOf(method) { return calls.filter(c => c.method === method); },
    };
    return client;
}

// ─── getObs (swallows error → data?.data ?? null) ─────────────────────────────

describe('observations.getObs', () => {
    it('issues select(data).eq(type).eq(gauge).single() on potomac_observations', async () => {
        const client = mockClient({ result: { data: { data: { foo: 1 } }, error: null } });
        const out = await getObs(client, 'gf_metadata', 'system');
        assert.deepEqual(out, { foo: 1 });
        assert.equal(client._tableNames[0], 'potomac_observations');
        assert.deepEqual(client.seq(), ['select', 'eq', 'eq', 'single']);
        assert.deepEqual(client.call('select').args, ['data']);
        const eqs = client.callsOf('eq');
        assert.deepEqual(eqs[0].args, ['observation_type', 'gf_metadata']);
        assert.deepEqual(eqs[1].args, ['gauge_id', 'system']);
    });

    it('returns null when there is no stored data', async () => {
        const client = mockClient({ result: { data: null, error: null } });
        assert.equal(await getObs(client, 't', 'g'), null);
    });

    it('SWALLOWS an error → null (does not throw, ignores error)', async () => {
        const client = mockClient({ result: { data: null, error: { code: 'PGRST116', message: 'not found' } } });
        const out = await getObs(client, 't', 'g');
        assert.equal(out, null);  // error swallowed, no throw
    });

    it('returns data.data even when an error is also present (data wins, error ignored)', async () => {
        const client = mockClient({ result: { data: { data: { x: 9 } }, error: { code: 'X' } } });
        assert.deepEqual(await getObs(client, 't', 'g'), { x: 9 });
    });
});

// ─── getObsRaw (passes { data, error } through UNCHANGED) ──────────────────────

describe('observations.getObsRaw', () => {
    it('returns { data, error } with the error passed through UNCHANGED', async () => {
        const err = { code: 'PGRST116', message: 'no rows', details: 'd' };
        const client = mockClient({ result: { data: null, error: err } });
        const out = await getObsRaw(client, 'gf_history', 'system');
        assert.equal(out.error, err);          // same object reference — untouched
        assert.equal(out.data, null);
        assert.deepEqual(client.seq(), ['select', 'eq', 'eq', 'single']);
        assert.deepEqual(client.call('select').args, ['data']);
    });

    it('honours a custom columns arg', async () => {
        const client = mockClient({ result: { data: { data: {} }, error: null } });
        await getObsRaw(client, 't', 'g', 'gauge_id, data');
        assert.deepEqual(client.call('select').args, ['gauge_id, data']);
    });

    it('returns the data row on success', async () => {
        const row = { data: { a: 1 } };
        const client = mockClient({ result: { data: row, error: null } });
        const out = await getObsRaw(client, 't', 'g');
        assert.equal(out.data, row);
        assert.equal(out.error, null);
    });
});

// ─── getObsRows (multi-row; optional gaugeId/orderBy/limit; returns {data,error}) ─

describe('observations.getObsRows', () => {
    it('multi-row read with no gaugeId emits NO .eq(gauge_id) — only the type filter', async () => {
        const client = mockClient({ result: { data: [{ data: {} }], error: null } });
        const out = await getObsRows(client, 'gf_correction_bin', { columns: 'gauge_id, data' });
        assert.deepEqual(out, { data: [{ data: {} }], error: null });
        const eqs = client.callsOf('eq');
        assert.equal(eqs.length, 1, 'exactly one .eq (observation_type) when gaugeId omitted');
        assert.deepEqual(eqs[0].args, ['observation_type', 'gf_correction_bin']);
        assert.deepEqual(client.call('select').args, ['gauge_id, data']);
        // No order / limit when not requested.
        assert.equal(client.call('order'), undefined);
        assert.equal(client.call('limit'), undefined);
    });

    it('adds .eq(gauge_id) when gaugeId is provided', async () => {
        const client = mockClient({ result: { data: [], error: null } });
        await getObsRows(client, 't', { gaugeId: 'system' });
        const eqs = client.callsOf('eq');
        assert.equal(eqs.length, 2);
        assert.deepEqual(eqs[1].args, ['gauge_id', 'system']);
    });

    it('adds .order(orderBy, {ascending}) and .limit when provided', async () => {
        const client = mockClient({ result: { data: [], error: null } });
        await getObsRows(client, 't', { orderBy: 'created_at', ascending: true, limit: 100 });
        assert.deepEqual(client.call('order').args, ['created_at', { ascending: true }]);
        assert.deepEqual(client.call('limit').args, [100]);
    });

    it('passes a read error through in { data, error }', async () => {
        const err = { code: 'XX', message: 'boom' };
        const client = mockClient({ result: { data: null, error: err } });
        const out = await getObsRows(client, 't', {});
        assert.equal(out.error, err);
    });
});

// ─── upsertObs ────────────────────────────────────────────────────────────────

describe('observations.upsertObs', () => {
    it('upserts {observation_type,gauge_id,data} with onConflict observation_type,gauge_id', async () => {
        const client = mockClient({ result: { error: null } });
        const out = await upsertObs(client, 'gf_history', 'system', { readings: [] });
        assert.deepEqual(out, { error: null });
        const up = client.call('upsert');
        assert.deepEqual(up.args[0], { observation_type: 'gf_history', gauge_id: 'system', data: { readings: [] } });
        assert.deepEqual(up.args[1], { onConflict: 'observation_type,gauge_id' });
    });

    it('passes the upsert error through', async () => {
        const err = { message: 'RLS', code: '42501' };
        const client = mockClient({ result: { error: err } });
        const out = await upsertObs(client, 't', 'g', {});
        assert.equal(out.error, err);
    });
});

// ─── insertObs ──────────────────────────────────────────────────────────────

describe('observations.insertObs', () => {
    it('inserts {observation_type,gauge_id,data} (no onConflict)', async () => {
        const client = mockClient({ result: { error: null } });
        const out = await insertObs(client, 'gf_prediction', 'pending', { predictedCFS: 100 });
        assert.deepEqual(out, { error: null });
        const ins = client.call('insert');
        assert.deepEqual(ins.args[0], { observation_type: 'gf_prediction', gauge_id: 'pending', data: { predictedCFS: 100 } });
        assert.equal(ins.args.length, 1, 'insert takes a single row arg (no onConflict)');
    });

    it('passes the insert error through', async () => {
        const err = { message: 'dup', code: '23505' };
        const client = mockClient({ result: { error: err } });
        assert.equal((await insertObs(client, 't', 'g', {})).error, err);
    });
});

// ─── deleteObs (conditional second .eq) ───────────────────────────────────────

describe('observations.deleteObs', () => {
    it('delete with a gaugeId emits TWO .eq (type + gauge)', async () => {
        const client = mockClient({ result: { error: null } });
        const out = await deleteObs(client, 'gf_prediction', { gaugeId: 'pending' });
        assert.deepEqual(out, { error: null });
        assert.equal(client.call('delete') !== undefined, true);
        const eqs = client.callsOf('eq');
        assert.equal(eqs.length, 2);
        assert.deepEqual(eqs[0].args, ['observation_type', 'gf_prediction']);
        assert.deepEqual(eqs[1].args, ['gauge_id', 'pending']);
    });

    it('delete WITHOUT a gaugeId emits exactly ONE .eq (type only — delete-all, MUST-FIX 4)', async () => {
        const client = mockClient({ result: { error: null } });
        await deleteObs(client, 'gf_correction_bin', {});
        const eqs = client.callsOf('eq');
        assert.equal(eqs.length, 1, 'no gauge filter → only the observation_type filter');
        assert.deepEqual(eqs[0].args, ['observation_type', 'gf_correction_bin']);
    });

    it('delete with no options object at all still emits ONE .eq', async () => {
        const client = mockClient({ result: { error: null } });
        await deleteObs(client, 'gf_correction_bin');
        assert.equal(client.callsOf('eq').length, 1);
    });

    it('passes the delete error through', async () => {
        const err = { message: 'fk', code: '23503' };
        const client = mockClient({ result: { error: err } });
        assert.equal((await deleteObs(client, 't', {})).error, err);
    });
});

// ─── deleteObsById ────────────────────────────────────────────────────────────

describe('observations.deleteObsById', () => {
    it('deletes by id, returns { error }', async () => {
        const client = mockClient({ result: { error: null } });
        const out = await deleteObsById(client, 'row-123');
        assert.deepEqual(out, { error: null });
        assert.equal(client.call('delete') !== undefined, true);
        const eqs = client.callsOf('eq');
        assert.equal(eqs.length, 1);
        assert.deepEqual(eqs[0].args, ['id', 'row-123']);
    });

    it('passes the delete error through', async () => {
        const err = { message: 'no', code: 'X' };
        const client = mockClient({ result: { error: err } });
        assert.equal((await deleteObsById(client, 'r')).error, err);
    });
});

// ─── claimObsById (C12 distinct: delete.eq(id).select('id') → {data,error}) ─────

describe('observations.claimObsById', () => {
    it('deletes by id, chains .select(id), returns { data, error }', async () => {
        const client = mockClient({ result: { data: [{ id: 'r1' }], error: null } });
        const out = await claimObsById(client, 'r1');
        assert.deepEqual(out, { data: [{ id: 'r1' }], error: null });
        assert.deepEqual(client.seq(), ['delete', 'eq', 'select']);
        assert.deepEqual(client.call('eq').args, ['id', 'r1']);
        assert.deepEqual(client.call('select').args, ['id']);
    });

    it('returns 0-row data when the row was already claimed', async () => {
        const client = mockClient({ result: { data: [], error: null } });
        const out = await claimObsById(client, 'r1');
        assert.deepEqual(out.data, []);
    });

    it('passes the claim error through', async () => {
        const err = { message: 'boom', code: 'X' };
        const client = mockClient({ result: { data: null, error: err } });
        assert.equal((await claimObsById(client, 'r')).error, err);
    });
});

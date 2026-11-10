// In-memory stand-in for the Supabase client, used by the A3 audit-logging tests.
//
// It EVALUATES filters (eq, lt, in, order, limit), the unique key (observation_type, gauge_id) and
// delete scoping, so a missing predicate in the code under test really deletes the wrong rows and
// fails the test. It records every operation in `ops` (with a fake URL length for deletes).
// Not a test file: the `npm test` globs only pick up *.test.js and *.test.mjs.

// `faults`: { claim: 'error' | 'lost', readFail: [gauge_id...], upsertFail: [gauge_id...] } injects the
// failures the validation tests need (a failed claim delete, a lost claim, a failing single-row read,
// a failing upsert for one gauge_id).
function createMemClient({ rows: seedRows = [], insertMode = {}, faults = {} } = {}) {
    const rows = [];
    const ops = [];
    let seq = 0;
    const mkId = () => {
        seq += 1;
        return `${String(seq).padStart(8, '0')}-0000-4000-8000-${String(seq).padStart(12, '0')}`;   // 36 chars like a uuid
    };
    const add = (r) => { const row = { id: mkId(), created_at: new Date(Date.now()).toISOString(), ...r }; rows.push(row); return row; };
    for (const r of seedRows) add(r);

    const modes = { ...insertMode };   // observation_type -> 'ok' | 'reject' | 'error' | 'hang' | 'missing'

    function matches(row, filters) {
        return filters.every(f => {
            const v = row[f.c];
            if (f.k === 'eq') return v === f.v;
            if (f.k === 'lt') return v < f.v;
            if (f.k === 'in') return f.v.includes(v);
            return false;
        });
    }
    function project(row, cols) {
        if (!cols || cols === '*') return { ...row };
        const out = {};
        for (const c of cols.split(',').map(x => x.trim())) out[c] = row[c];
        return out;
    }

    function query() {
        const q = { op: 'select', filters: [], cols: null, order: null, limit: null, single: false, payload: null, wantRows: false, conflict: null };
        const b = {
            select(cols) {
                if (['delete', 'insert', 'upsert'].includes(q.op)) q.wantRows = true; else q.cols = cols;
                return b;
            },
            eq(c, v) { q.filters.push({ k: 'eq', c, v }); return b; },
            lt(c, v) { q.filters.push({ k: 'lt', c, v }); return b; },
            in(c, v) { q.filters.push({ k: 'in', c, v }); return b; },
            order(c, o) { q.order = { c, asc: !(o && o.ascending === false) }; return b; },
            limit(n) { q.limit = n; return b; },
            single() { q.single = true; return b; },
            delete() { q.op = 'delete'; return b; },
            insert(row) { q.op = 'insert'; q.payload = row; return b; },
            upsert(row, o) { q.op = 'upsert'; q.payload = row; q.conflict = o && o.onConflict; return b; },
            then(res, rej) { return exec().then(res, rej); },
        };
        const typeOf = () => (q.filters.find(f => f.c === 'observation_type' && f.k === 'eq') || {}).v ?? (q.payload && q.payload.observation_type);
        function exec() {
            const type = typeOf();
            const op = { op: q.op, type, filters: q.filters.map(f => ({ ...f })), payload: q.payload, limit: q.limit };
            ops.push(op);
            if (q.op === 'select') {
                let m = rows.filter(r => matches(r, q.filters));
                if (q.order) m.sort((a, z) => (a[q.order.c] < z[q.order.c] ? -1 : a[q.order.c] > z[q.order.c] ? 1 : 0) * (q.order.asc ? 1 : -1));
                if (q.limit != null) m = m.slice(0, q.limit);
                if (q.single) {
                    const gid = q.filters.find(f => f.c === 'gauge_id' && f.k === 'eq');
                    if (gid && (faults.readFail || []).includes(gid.v)) return Promise.resolve({ data: null, error: { code: '08006', message: 'connection failure (mock)' } });
                    return Promise.resolve(m.length ? { data: project(m[0], q.cols), error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } });
                }
                return Promise.resolve({ data: m.map(r => project(r, q.cols)), error: null });
            }
            if (q.op === 'delete') {
                if (q.filters.length === 0) throw new Error('mem-supabase: delete without a filter (PostgREST would refuse)');
                if (q.wantRows && faults.claim === 'error') return Promise.resolve({ data: null, error: { code: 'XX000', message: faults.claimMsg || 'claim failed (mock)' } });
                if (q.wantRows && faults.claim === 'lost') return Promise.resolve({ data: [], error: null });
                op.urlLen = q.filters.map(f => `${f.c}=${f.k}.${f.k === 'in' ? '(' + f.v.join(',') + ')' : f.v}`).join('&').length;
                const gone = rows.filter(r => matches(r, q.filters));
                for (const g of gone) rows.splice(rows.indexOf(g), 1);
                op.deleted = gone.map(g => ({ type: g.observation_type, gauge_id: g.gauge_id }));
                return Promise.resolve(q.wantRows ? { data: gone.map(g => ({ id: g.id })), error: null } : { error: null });
            }
            if (q.op === 'insert') {
                const mode = modes[q.payload.observation_type] || 'ok';
                if (mode === 'reject') return Promise.reject(new Error('insert rejected (mock)'));
                if (mode === 'error') return Promise.resolve({ error: { message: 'insert error (mock)', code: 'XX000' } });
                if (mode === 'hang') return new Promise(() => {});
                const dup = rows.find(r => r.observation_type === q.payload.observation_type && r.gauge_id === q.payload.gauge_id);
                if (dup) return Promise.resolve({ error: { message: 'duplicate key', code: '23505' } });
                add({ observation_type: q.payload.observation_type, gauge_id: q.payload.gauge_id, data: q.payload.data });
                return Promise.resolve({ error: null });
            }
            if (q.op === 'upsert') {
                const mode = modes[q.payload.observation_type] || 'ok';
                if ((faults.upsertFail || []).includes(q.payload.gauge_id)) return Promise.resolve({ error: { message: 'upsert failed (mock)', code: 'XX000' } });
                if (mode === 'reject') return Promise.reject(new Error('upsert rejected (mock)'));
                if (mode === 'error') return Promise.resolve({ error: { message: 'upsert error (mock)', code: 'XX000' } });
                if (mode === 'hang') return new Promise(() => {});
                const ex = rows.find(r => r.observation_type === q.payload.observation_type && r.gauge_id === q.payload.gauge_id);
                if (ex) ex.data = q.payload.data; else add({ observation_type: q.payload.observation_type, gauge_id: q.payload.gauge_id, data: q.payload.data });
                return Promise.resolve({ error: null });
            }
            throw new Error('mem-supabase: unknown op');
        }
        return b;
    }

    const client = { from(table) { if (table !== 'potomac_observations') throw new Error('mem-supabase: unexpected table ' + table); return query(); } };
    return {
        client, rows, ops, modes,
        of: (type) => rows.filter(r => r.observation_type === type),
        get: (type, gaugeId) => (rows.find(r => r.observation_type === type && r.gauge_id === gaugeId) || {}).data,
        add,
    };
}

const LOG_TYPES = ['tick_log', 'validation_log', 'bin_snapshot', 'log_health'];

module.exports = { createMemClient, LOG_TYPES };

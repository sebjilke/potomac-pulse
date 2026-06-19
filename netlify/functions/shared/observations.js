// Potomac Pulse — Shared Observations Data-Access Helper
// Server-only thin wrapper over `client.from('potomac_observations')`.
// Names the DB-access boilerplate (op + filter chain + onConflict + return shape) so the
// periodic writers/readers in scheduled-update.js (and, later, sync-learning.js) don't repeat it.
//
// SERVER-ONLY: there is no client-side twin of this module (the browser never touches the
// `potomac_observations` table directly), so no parity test is needed — unlike shared/model.js.
//
// Error-shape contract (behavior-preservation): each helper reproduces the handling its call
// sites already had. `getObs` SWALLOWS read errors → null (the callers fall back to defaults);
// `getObsRaw`/`getObsRows` pass `{ data, error }` through UNCHANGED so the few sites that branch
// on `error.code === 'PGRST116'` keep doing so; the write helpers return `{ error }`.

const TABLE = 'potomac_observations';
const ON_CONFLICT = 'observation_type,gauge_id';

// Single-row read that SWALLOWS any error (incl. PGRST116 not-found) → returns the stored
// `data.data` payload or null. For sites that fall back to a default object on a failed read.
async function getObs(client, type, gaugeId) {
    const { data } = await client
        .from(TABLE)
        .select('data')
        .eq('observation_type', type)
        .eq('gauge_id', gaugeId)
        .single();
    return data?.data ?? null;
}

// Single-row read that passes `{ data, error }` through UNCHANGED — for the few sites that
// inspect `error.code`. `error` is returned exactly as Supabase gave it (no rewrap).
async function getObsRaw(client, type, gaugeId, columns = 'data') {
    const { data, error } = await client
        .from(TABLE)
        .select(columns)
        .eq('observation_type', type)
        .eq('gauge_id', gaugeId)
        .single();
    return { data, error };
}

// Multi-row read. `gaugeId`, `orderBy`, and `limit` are all OPTIONAL — when `gaugeId` is
// undefined the `.eq('gauge_id', …)` filter is OMITTED ENTIRELY (so a no-gauge-filter read
// loads all matching rows, not zero). Returns `{ data, error }` so callers can branch on error.
async function getObsRows(client, type, { gaugeId, columns = 'data', orderBy, ascending = true, limit } = {}) {
    let query = client
        .from(TABLE)
        .select(columns)
        .eq('observation_type', type);
    if (gaugeId !== undefined) query = query.eq('gauge_id', gaugeId);
    if (orderBy !== undefined) query = query.order(orderBy, { ascending });
    if (limit !== undefined) query = query.limit(limit);
    const { data, error } = await query;
    return { data, error };
}

// Upsert one observation row keyed on (observation_type, gauge_id). Returns `{ error }`.
async function upsertObs(client, type, gaugeId, data) {
    const { error } = await client
        .from(TABLE)
        .upsert({ observation_type: type, gauge_id: gaugeId, data }, { onConflict: ON_CONFLICT });
    return { error };
}

// Insert one observation row. Returns `{ error }`.
async function insertObs(client, type, gaugeId, data) {
    const { error } = await client
        .from(TABLE)
        .insert({ observation_type: type, gauge_id: gaugeId, data });
    return { error };
}

// Delete by (observation_type[, gauge_id]). The `.eq('gauge_id', …)` filter is chained ONLY
// when `gaugeId !== undefined` — a delete-by-type-only (no gauge filter) must NOT silently
// scope to a single gauge. Returns `{ error }`.
async function deleteObs(client, type, { gaugeId } = {}) {
    let query = client.from(TABLE).delete().eq('observation_type', type);
    if (gaugeId !== undefined) query = query.eq('gauge_id', gaugeId);
    const { error } = await query;
    return { error };
}

// Delete a single row by its primary-key `id`. Returns `{ error }`.
async function deleteObsById(client, id) {
    const { error } = await client.from(TABLE).delete().eq('id', id);
    return { error };
}

// C12 idempotency claim: delete-by-id AND return the deleted id(s) so the caller can verify it
// actually removed the row before acting (0 rows back == already claimed by another run). Kept
// DISTINCT from deleteObsById — the `.select('id')` is load-bearing. Returns `{ data, error }`.
// (Defined for completeness; this slice does NOT apply it — the C12 site lives inside
// validatePendingPredictions, which is out of scope.)
async function claimObsById(client, id) {
    const { data, error } = await client
        .from(TABLE)
        .delete()
        .eq('id', id)
        .select('id');
    return { data, error };
}

module.exports = {
    getObs,
    getObsRaw,
    getObsRows,
    upsertObs,
    insertObs,
    deleteObs,
    deleteObsById,
    claimObsById,
};

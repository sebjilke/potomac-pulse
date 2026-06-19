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
/**
 * Reads a single observation row's `data` payload, swallowing any error to null.
 * @param {Object} client - Supabase client.
 * @param {string} type - observation_type to match.
 * @param {string} gaugeId - gauge_id to match.
 * @returns {Promise<Object|null>} The stored `data.data` payload, or null on error/not-found.
 */
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
/**
 * Reads a single observation row, passing Supabase's `{ data, error }` through unchanged.
 * @param {Object} client - Supabase client.
 * @param {string} type - observation_type to match.
 * @param {string} gaugeId - gauge_id to match.
 * @param {string} [columns='data'] - Columns to select.
 * @returns {Promise<{data: Object|null, error: Object|null}>} Supabase result; `error.code` may be 'PGRST116' for not-found.
 */
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
/**
 * Reads multiple observation rows for an observation_type, with optional gauge/order/limit filters.
 * @param {Object} client - Supabase client.
 * @param {string} type - observation_type to match.
 * @param {Object} [options] - Optional query refinements.
 * @param {string} [options.gaugeId] - When set, adds an `.eq('gauge_id', …)` filter; omitting it loads all rows for the type.
 * @param {string} [options.columns='data'] - Columns to select.
 * @param {string} [options.orderBy] - Column to order by; applied only when provided.
 * @param {boolean} [options.ascending=true] - Sort direction when `orderBy` is set.
 * @param {number} [options.limit] - Max rows to return; applied only when provided.
 * @returns {Promise<{data: Object[]|null, error: Object|null}>} Supabase result with rows and any error.
 */
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
/**
 * Upserts a single observation row, keyed on (observation_type, gauge_id) via onConflict.
 * @param {Object} client - Supabase client.
 * @param {string} type - observation_type for the row.
 * @param {string} gaugeId - gauge_id for the row (the conflict key alongside type).
 * @param {Object} data - JSON payload stored in the row's `data` column.
 * @returns {Promise<{error: Object|null}>} Supabase result containing any write error.
 */
async function upsertObs(client, type, gaugeId, data) {
    const { error } = await client
        .from(TABLE)
        .upsert({ observation_type: type, gauge_id: gaugeId, data }, { onConflict: ON_CONFLICT });
    return { error };
}

// Insert one observation row. Returns `{ error }`.
/**
 * Inserts a single new observation row.
 * @param {Object} client - Supabase client.
 * @param {string} type - observation_type for the row.
 * @param {string} gaugeId - gauge_id for the row.
 * @param {Object} data - JSON payload stored in the row's `data` column.
 * @returns {Promise<{error: Object|null}>} Supabase result containing any write error.
 */
async function insertObs(client, type, gaugeId, data) {
    const { error } = await client
        .from(TABLE)
        .insert({ observation_type: type, gauge_id: gaugeId, data });
    return { error };
}

// Delete by (observation_type[, gauge_id]). The `.eq('gauge_id', …)` filter is chained ONLY
// when `gaugeId !== undefined` — a delete-by-type-only (no gauge filter) must NOT silently
// scope to a single gauge. Returns `{ error }`.
/**
 * Deletes observation rows by observation_type, optionally narrowed to one gauge_id.
 * @param {Object} client - Supabase client.
 * @param {string} type - observation_type to delete.
 * @param {Object} [options] - Optional filter.
 * @param {string} [options.gaugeId] - When set, restricts the delete to that gauge_id; omitting it deletes all rows for the type.
 * @returns {Promise<{error: Object|null}>} Supabase result containing any delete error.
 */
async function deleteObs(client, type, { gaugeId } = {}) {
    let query = client.from(TABLE).delete().eq('observation_type', type);
    if (gaugeId !== undefined) query = query.eq('gauge_id', gaugeId);
    const { error } = await query;
    return { error };
}

// Delete a single row by its primary-key `id`. Returns `{ error }`.
/**
 * Deletes a single observation row by its primary-key `id`.
 * @param {Object} client - Supabase client.
 * @param {(string|number)} id - Primary-key id of the row to delete.
 * @returns {Promise<{error: Object|null}>} Supabase result containing any delete error.
 */
async function deleteObsById(client, id) {
    const { error } = await client.from(TABLE).delete().eq('id', id);
    return { error };
}

// C12 idempotency claim: delete-by-id AND return the deleted id(s) so the caller can verify it
// actually removed the row before acting (0 rows back == already claimed by another run). Kept
// DISTINCT from deleteObsById — the `.select('id')` is load-bearing. Returns `{ data, error }`.
// (Defined for completeness; this slice does NOT apply it — the C12 site lives inside
// validatePendingPredictions, which is out of scope.)
/**
 * C12 idempotency claim: deletes a row by `id` and returns the deleted id(s) so the caller can confirm the delete won the race (0 rows back = already claimed).
 * @param {Object} client - Supabase client.
 * @param {(string|number)} id - Primary-key id of the row to claim/delete.
 * @returns {Promise<{data: Object[]|null, error: Object|null}>} Supabase result; `data` holds the deleted id rows (empty if already claimed).
 */
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

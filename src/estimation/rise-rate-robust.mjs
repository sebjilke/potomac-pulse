// Potomac Pulse — pure robustness helpers for PoR/GF history interpretation
//
// Dependency-free by design: no app imports, no DOM, no localStorage. This keeps
// the logic unit-testable in isolation (see test/rise-rate-robust.test.mjs) and
// importable by both the estimation engine (great-falls.js) and the graph UI.
//
// GUIDING PRINCIPLE (project owner constraint): NEVER discard a genuine reading.
// These helpers keep every data point and instead make the *interpretation*
// robust — a single stale / out-of-order / glitch entry cannot define the current
// level or flip a trend, but a real, sustained change registers normally. The only
// hard rejection (in history.js record functions) is for physically-impossible
// values (<=0 or > 500,000 cfs), never for plausible river flows.

// Numeric median of the cfs values in `entries`.
/**
 * Computes the numeric median of the `cfs` values across the given entries (averaging the two central values for even counts). Has a server copy in netlify/functions/shared/model.js that must stay in sync.
 * @param {Array<{cfs: number}>} entries - History entries, each with a numeric cfs field.
 * @returns {number|null} The median cfs value, or null when entries is empty/missing.
 */
export function medianCfs(entries) {
    if (!entries || entries.length === 0) return null;
    const vals = entries.map(e => e.cfs).sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

// Median *of record*: returns a real entry whose cfs is the median, so cfs and
// timestamp stay mutually consistent (critical — callers compute rates from the
// returned timestamp). For even counts, returns the NEWER of the two central
// records, biasing toward recency without inventing a synthetic value.
/**
 * Returns the actual history entry whose cfs is the median (the newer of the two central records for even counts), keeping cfs and timestamp mutually consistent.
 * @param {Array<{cfs: number, timestamp: number}>} entries - History entries, each with numeric cfs and timestamp fields.
 * @returns {{cfs: number, timestamp: number}|null} The median-of-record entry, or null when entries is empty/missing.
 */
export function medianOfRecord(entries) {
    if (!entries || entries.length === 0) return null;
    const byCfs = [...entries].sort((a, b) => a.cfs - b.cfs);
    const n = byCfs.length;
    const mid = Math.floor(n / 2);
    if (n % 2 === 1) return byCfs[mid];
    const a = byCfs[mid - 1], b = byCfs[mid];
    return a.timestamp >= b.timestamp ? a : b;
}

// Robust "current" level: median-of-record over a trailing window. Returns null
// when fewer than `minPts` points fall in the window, so the caller can defer to
// the NWS-trend fallback rather than trust a single (possibly stale) reading.
// Future-dated entries (clock skew) are excluded.
/**
 * Robust "current" level: the median-of-record over a trailing window ending at `now`, excluding future-dated entries; returns null when too few points fall in the window.
 * @param {Array<{cfs: number, timestamp: number}>} history - History entries with numeric cfs and timestamp fields.
 * @param {number} now - Current time as an epoch-ms timestamp.
 * @param {{windowMs?: number, minPts?: number}} [opts] - Optional trailing-window length (default 90 min) and minimum point count (default 3).
 * @returns {{cfs: number, timestamp: number}|null} The median-of-record entry within the window, or null when fewer than `minPts` points qualify.
 */
export function robustCurrentReading(history, now, opts = {}) {
    const windowMs = opts.windowMs ?? 90 * 60 * 1000;
    const minPts = opts.minPts ?? 3;
    const win = history.filter(e =>
        e && e.cfs > 0 && (now - e.timestamp) >= 0 && (now - e.timestamp) <= windowMs);
    if (win.length < minPts) return null;
    return medianOfRecord(win);
}

// Robust "past" level near `targetMsAgo` before now, strictly older than
// `currentTs`. Uses median-of-record when enough points cluster near the target;
// otherwise falls back to the single closest older entry (acceptable: `current`
// is already robust, and simultaneous glitches at both ends are improbable).
/**
 * Robust "past" level near `targetMsAgo` before `now` and strictly older than `currentTs`: median-of-record when enough points cluster near the target, otherwise the single closest older entry.
 * @param {Array<{cfs: number, timestamp: number}>} history - History entries with numeric cfs and timestamp fields.
 * @param {number} now - Current time as an epoch-ms timestamp.
 * @param {number} currentTs - Timestamp of the current reading; only entries strictly older than this are considered.
 * @param {{targetMsAgo?: number, windowMs?: number, minPts?: number}} [opts] - Optional lookback offset (default 6 h), clustering window (default 60 min), and minimum point count (default 3).
 * @returns {{cfs: number, timestamp: number}|null} The chosen past entry, or null when no older entries exist.
 */
export function robustPastReading(history, now, currentTs, opts = {}) {
    const targetMsAgo = opts.targetMsAgo ?? 6 * 3600 * 1000;
    const windowMs = opts.windowMs ?? 60 * 60 * 1000;
    const minPts = opts.minPts ?? 3;
    const target = now - targetMsAgo;
    const older = history.filter(e => e && e.cfs > 0 && e.timestamp < currentTs);
    if (older.length === 0) return null;
    const near = older.filter(e => Math.abs(e.timestamp - target) <= windowMs);
    if (near.length >= minPts) return medianOfRecord(near);
    return older.reduce((best, e) =>
        Math.abs(e.timestamp - target) < Math.abs(best.timestamp - target) ? e : best, older[0]);
}

// Outlier-resistant pick of the historic reading nearest `targetTime`. When there
// are enough candidates in the match window to define a reliable median, drops
// lone glitches (cfs more than `outlierFrac` off the window median), then returns
// the single closest survivor INTACT — its cfs/timestamp are preserved, so no
// value-smearing or rising-limb bias is introduced (unlike medianizing the cfs).
/**
 * Outlier-resistant pick of the historic entry nearest `targetTime`: drops lone glitches more than `outlierFrac` off the window median (when enough candidates exist) then returns the single closest survivor intact. Has a server copy in netlify/functions/shared/model.js that must stay in sync.
 * @param {Array<{cfs: number, timestamp: number}>} history - History entries with numeric cfs and timestamp fields.
 * @param {number} targetTime - The target time as an epoch-ms timestamp to match against.
 * @param {{matchMs?: number, outlierFrac?: number, minForFilter?: number}} [opts] - Optional match window (default 60 min), outlier fraction off the median (default 0.40), and minimum candidate count to enable filtering (default 3).
 * @returns {{cfs: number, timestamp: number}|null} The closest surviving entry, or null when no candidate falls within the match window.
 */
export function selectHistoricReading(history, targetTime, opts = {}) {
    const matchMs = opts.matchMs ?? 60 * 60 * 1000;
    const outlierFrac = opts.outlierFrac ?? 0.40;
    const minForFilter = opts.minForFilter ?? 3;
    const candidates = history.filter(e =>
        e && e.cfs > 0 && Math.abs(e.timestamp - targetTime) < matchMs);
    if (candidates.length === 0) return null;
    let pool = candidates;
    if (candidates.length >= minForFilter) {
        const med = medianCfs(candidates);
        if (med > 0) {
            const filtered = candidates.filter(e => Math.abs(e.cfs - med) / med <= outlierFrac);
            if (filtered.length > 0) pool = filtered;
        }
    }
    return pool.reduce((best, e) =>
        Math.abs(e.timestamp - targetTime) < Math.abs(best.timestamp - targetTime) ? e : best, pool[0]);
}

// Display-only spike filter: drop a point ONLY if it is a strict local extremum
// that reverses — i.e. it exceeds BOTH immediate neighbours by more than `frac`
// (a peak), or falls below both by more than `frac` (a trough). This is the
// signature of a glitch: a lone value its neighbours do not corroborate.
//
// Critically, a point on a MONOTONE run is never an extremum, so a genuine rapid
// rise (or fall), and level steps, are preserved in full — including steep,
// sparse, hourly-spaced surges. Endpoints are always kept (no two-sided context).
// This NEVER mutates or deletes stored history — it only declines to *plot* a
// reversal spike.
/**
 * Display-only spike filter: returns the points with any strict, reversing local extremum removed — a value exceeding BOTH neighbours by more than `frac` (peak) or below both by more than `frac` (trough); endpoints and monotone runs are always kept, and stored history is never mutated.
 * @param {Array<Object>} points - Ordered data points; each is read via `key` for its numeric value.
 * @param {{frac?: number, key?: string}} [opts] - Optional reversal threshold fraction (default 0.40) and the property name holding the value (default 'cfs').
 * @returns {Array<Object>} A new array with reversal spikes dropped, or the original array unchanged when there are fewer than 3 points.
 */
export function dropLocalSpikes(points, opts = {}) {
    const frac = opts.frac ?? 0.40;
    const key = opts.key ?? 'cfs';
    if (!points || points.length < 3) return points;
    return points.filter((p, i) => {
        if (i === 0 || i === points.length - 1) return true; // keep endpoints
        const v = p[key];
        const left = points[i - 1][key];
        const right = points[i + 1][key];
        if (!(left > 0) || !(right > 0) || !(v > 0)) return true;
        const peak = v > left * (1 + frac) && v > right * (1 + frac);
        const trough = v < left * (1 - frac) && v < right * (1 - frac);
        return !(peak || trough);
    });
}

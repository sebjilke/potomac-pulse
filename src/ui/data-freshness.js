// Potomac Pulse - data freshness label logic (v39.1, audit finding 5 / TODO A1)
//
// Pure functions only: no DOM, no browser globals at module top level (same pattern as
// offline-banner.js), so everything here is unit-tested under Node.
//
// The "last update" label describes the age of the READINGS on screen, never the time of the
// fetch. A fetch can be answered by a cached or stale body, so fetch time says nothing about how
// old the river numbers are. Reading time is recorded by processData (fetch.js) as
// data[gauge].readTime; this module only combines those times.

/** Minutes of reading age at which the label leaves "fresh" (amber). Covers USGS lag up to ~75 min plus one 15-min cycle plus one missed cycle. */
export const RECENT_MIN = 120;
/** Minutes at which the label turns orange. */
export const OLD_MIN = 180;
/** Minutes at which the label turns red. */
export const STALE_MIN = 360;
/** A live fetch older than this (minutes) is called out as a stalled refresh. */
export const RECENT_FETCH_MIN = 20;
/** A response generated this recently (minutes) is a live answer. A live body is seconds old (no shared cache; the service worker bypasses the HTTP cache with no-cache). The previous 15 min cycle's saved copy is about 15 min old, so 10 separates them, and still tolerates a device clock up to 10 min fast. */
export const BODY_FRESH_MIN = 10;
/** With an unknown body time, a proxy chain that found nothing newer is not repeated for this long (minutes) unless the reading time changes. */
export const CHAIN_MEMO_MIN = 60;
/** Reading times this far ahead of the device clock (minutes) trigger the clock warning in the title. */
export const CLOCK_SKEW_MIN = 5;

const LF_ID = '01646500';
const POR_ID = '01638500';
const ORDER = ['fresh', 'recent', 'old', 'stale'];

/**
 * Reduces the processed gauge data to the reading time of the headline gauges.
 * @param {Object} data - The processData output, keyed by site id, each entry optionally with readTime (ms).
 * @param {string[]} [ids] - Little Falls then Point of Rocks site ids.
 * @returns {{ms: (number|null), lf: (number|null), por: (number|null)}} Per-gauge times and the older of the two.
 */
export function readingFromData(data, ids = [LF_ID, POR_ID]) {
    const pick = (id) => {
        const t = data?.[id]?.readTime;
        return typeof t === 'number' && Number.isFinite(t) ? t : null;
    };
    const lf = pick(ids[0]);
    const por = pick(ids[1]);
    const known = [lf, por].filter((t) => t !== null);
    return { ms: known.length ? Math.min(...known) : null, lf, por };
}

/**
 * Cheap read of a raw USGS payload: the older of the Little Falls and Point of Rocks discharge
 * report times (last element of each 00060 series). Used only to rank payloads before processData;
 * processData stays the source of truth for the label.
 * @param {Object} json - Raw USGS iv response.
 * @param {string[]} [ids] - Little Falls then Point of Rocks site ids.
 * @returns {(number|null)} Older report time in ms, or null when neither series has a parseable time.
 */
export function payloadReadingMs(json, ids = [LF_ID, POR_ID]) {
    const series = json?.value?.timeSeries;
    if (!Array.isArray(series)) return null;
    const times = [];
    for (const id of ids) {
        for (const ts of series) {
            if (ts?.sourceInfo?.siteCode?.[0]?.value !== id) continue;
            if (ts?.variable?.variableCode?.[0]?.value !== '00060') continue;
            const vals = ts?.values?.[0]?.value;
            const last = Array.isArray(vals) && vals.length ? vals[vals.length - 1] : null;
            const t = last ? Date.parse(last.dateTime) : NaN;
            if (Number.isFinite(t)) times.push(t);
            break;
        }
    }
    return times.length ? Math.min(...times) : null;
}

/**
 * Time the USGS server generated the response: value.queryInfo.note is an array of {title, value}
 * and the entry titled "requestDT" holds an ISO timestamp (checked against the live API 2026-11-10).
 * @param {Object} payload - Raw USGS iv response (live, or unwrapped from a CORS proxy).
 * @param {number} [now] - Current time in ms (injectable for tests).
 * @returns {(number|null)} Parsed time in ms, or null when missing, malformed, unparseable or more than 5 minutes in the future.
 */
export function bodyTimeMs(payload, now = Date.now()) {
    const notes = payload?.value?.queryInfo?.note;
    if (!Array.isArray(notes)) return null;
    const entry = notes.find((n) => n && n.title === 'requestDT');
    if (!entry || typeof entry.value !== 'string') return null;
    const t = Date.parse(entry.value);
    if (!Number.isFinite(t)) return null;
    if (t - now > CLOCK_SKEW_MIN * 60000) return null;
    return t;
}

/**
 * Classifies a payload by its readings and its body time.
 * @param {Object} i
 * @param {(number|null)} i.readingMs - From payloadReadingMs.
 * @param {(number|null)} i.bodyMs - From bodyTimeMs.
 * @param {number} i.now - Current time in ms.
 * @returns {string} "readings-fresh" (readings under 120 min or unknown), "live-behind" (old readings, body at most 10 min old: the gauges are behind),
 *   "saved-copy" (old readings, body older than 10 min) or "unknown-body" (old readings, no usable body time).
 */
export function classifyOldPayload({ readingMs, bodyMs, now }) {
    if (!isOldPayload(readingMs, now)) return 'readings-fresh';
    if (bodyMs === null || bodyMs === undefined || !Number.isFinite(bodyMs)) return 'unknown-body';
    return (now - bodyMs) / 60000 <= BODY_FRESH_MIN ? 'live-behind' : 'saved-copy';
}

// Memo for the unknown-body case (module state, deliberately not localStorage): the reading time and
// wall-clock time of the last proxy chain that found nothing newer than the direct payload.
let chainMemo = null;

/**
 * True when the proxy chain (and the early refetch) must be skipped: the last chain found nothing
 * newer for this same direct reading time, and under 60 minutes have passed.
 * @param {(number|null)} readingMs - Reading time of the direct payload.
 * @param {number} now - Current time in ms.
 * @returns {boolean}
 */
export function chainSuppressed(readingMs, now) {
    if (!chainMemo || chainMemo.readingMs !== readingMs) return false;
    const elapsed = now - chainMemo.at;
    return elapsed >= 0 && elapsed < CHAIN_MEMO_MIN * 60000;
}

/**
 * Records that a proxy chain ran for this direct reading time and found nothing newer.
 * @param {(number|null)} readingMs - Reading time of the direct payload.
 * @param {number} now - Current time in ms.
 */
export function noteChainFoundNothing(readingMs, now) { chainMemo = { readingMs, at: now }; }

/** Forgets the memo (a newer payload was found, and tests). */
export function clearChainMemo() { chainMemo = null; }

/**
 * True when a payload's readings are old enough that the next source (CORS proxy) should be tried
 * before accepting it. A service-worker fallback to a cached copy looks like a normal 200 to the page.
 * Unknown reading time does not trigger a retry (keeps the pre-v39.1 behaviour).
 * @param {(number|null)} readingMs - From payloadReadingMs.
 * @param {number} now - Current time in ms.
 * @returns {boolean}
 */
export function isOldPayload(readingMs, now) {
    if (readingMs === null || readingMs === undefined || !Number.isFinite(readingMs)) return false;
    return (now - readingMs) / 60000 >= RECENT_MIN;
}

/**
 * Formats an age in whole minutes without rounding across a band boundary.
 * @param {number} min - Age in minutes (>= 0).
 * @returns {string} "42m", "1h 59m", "2h", "7h", or "9d".
 */
export function formatAge(min) {
    const m = Math.max(0, Math.floor(min));
    if (m < 60) return `${m}m`;
    if (m < STALE_MIN) {
        const h = Math.floor(m / 60);
        const r = m % 60;
        return r ? `${h}h ${r}m` : `${h}h`;
    }
    if (m < 2880) return `${Math.floor(m / 60)}h`;
    return `${Math.floor(m / 1440)}d`;
}

/**
 * Maps a reading age to its colour class.
 * @param {number} min - Age in minutes.
 * @returns {string} One of fresh, recent, old, stale.
 */
export function bandFor(min) {
    if (min < RECENT_MIN) return 'fresh';
    if (min < OLD_MIN) return 'recent';
    if (min < STALE_MIN) return 'old';
    return 'stale';
}

const atLeast = (cls, floor) => (ORDER.indexOf(cls) < ORDER.indexOf(floor) ? floor : cls);
const pad2 = (n) => String(n).padStart(2, '0');
const clock = (ms) => { const d = new Date(ms); return `${d.getHours()}:${pad2(d.getMinutes())}`; };
const stamp = (ms) => (ms === null || ms === undefined ? 'none' : new Date(ms).toLocaleString());

/**
 * Pure label decision.
 * @param {Object} i
 * @param {(number|null)} i.readingMs - Older of the Little Falls and Point of Rocks reading times.
 * @param {(number|null)} i.lfMs - Little Falls reading time.
 * @param {(number|null)} i.porMs - Point of Rocks reading time.
 * @param {(number|null)} [i.bodyMs] - Time the server generated the payload (bodyTimeMs); with old readings, a body older than 10 min at fetch time counts as a saved copy.
 * @param {(number|null)} i.fetchMs - When the payload was fetched or saved (used for wording and the title only, never as the age).
 * @param {number} i.now - Current time in ms.
 * @param {boolean} i.online - Browser connectivity.
 * @param {string} i.source - live, cached, stale or unavailable.
 * @returns {{text: string, className: string, title: string}}
 */
export function describeFreshness({ readingMs, lfMs = null, porMs = null, bodyMs = null, fetchMs = null, now, online, source }) {
    // v39.1 amendment: old readings in a body that was already old when fetched mean a saved copy,
    // even when the fetch returned 200. Fresh readings are never affected by body time.
    const readingsOld = readingMs !== null && readingMs !== undefined && Number.isFinite(readingMs) && (now - readingMs) / 60000 >= RECENT_MIN;
    const bodyAgeOld = Number.isFinite(bodyMs) && ((fetchMs ?? now) - bodyMs) / 60000 > BODY_FRESH_MIN;
    const bodyOld = readingsOld && bodyAgeOld;
    const saved = !online || source === 'cached' || source === 'stale' || bodyOld;
    // The hover names an old body as a saved copy even when the readings are fresh (text and class stay as before, A3).
    const where = (saved || bodyAgeOld) ? 'saved copy' : 'live';
    const times = `Little Falls reading: ${stamp(lfMs)}. Point of Rocks reading: ${stamp(porMs)}. Server response: ${stamp(Number.isFinite(bodyMs) ? bodyMs : null)}. Fetched: ${fetchMs ? new Date(fetchMs).toLocaleString() : 'unknown'}. Source: ${where}.`;

    if (readingMs === null || readingMs === undefined || !Number.isFinite(readingMs)) {
        return {
            text: 'Reading time unknown',
            className: 'stale',
            title: `The data had no usable timestamp. ${times}`,
        };
    }

    const rawMin = (now - readingMs) / 60000;
    const ageMin = rawMin < 0 ? 0 : Math.floor(rawMin);
    const clockWarn = rawMin < -CLOCK_SKEW_MIN;
    let className = bandFor(ageMin);

    let text = className === 'fresh'
        ? (ageMin < 2 ? 'Latest reading just now' : `Latest reading ${formatAge(ageMin)} ago`)
        : `Readings ${formatAge(ageMin)} old`;

    if (saved) {
        text = `Saved copy: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
        className = atLeast(className, 'recent');
    } else {
        const fetchAgeMin = fetchMs ? (now - fetchMs) / 60000 : 0;
        if (fetchAgeMin > RECENT_FETCH_MIN && className !== 'fresh') {
            text += `, not refreshed since ${clock(fetchMs)}`;
        } else if (className === 'stale') {
            text += ', no newer data received';
        }
    }

    if (lfMs === null && porMs !== null) {
        text += ', Little Falls missing';
        className = atLeast(className, 'recent');
    } else if (porMs === null && lfMs !== null) {
        text += ', Point of Rocks missing';
        className = atLeast(className, 'recent');
    }

    return { text, className, title: `${times}${clockWarn ? ' Device clock may be wrong.' : ''}` };
}

/**
 * Decides whether to schedule one early refetch after a fetch that returned old readings (a cache
 * fallback is refreshed by the service worker a few seconds later; the page would otherwise wait 15 min).
 * @param {Object} i
 * @param {(number|null)} i.readingMs - Older-of-two reading time.
 * @param {number} i.now - Current time in ms.
 * @param {boolean} i.online - Browser connectivity.
 * @param {string} i.source - Data source of the fetch that just finished.
 * @param {boolean} i.early - True when this fetch was itself the early one.
 * @param {boolean} [i.allowed] - False when the body time or the unknown-body memo says a refetch cannot help.
 * @returns {boolean} True when an early refetch should be scheduled.
 */
export function shouldEarlyRefetch({ readingMs, now, online, source, early, allowed = true }) {
    if (early || !online || source !== 'live' || allowed === false) return false;
    if (readingMs === null || readingMs === undefined || !Number.isFinite(readingMs)) return false;
    return (now - readingMs) / 60000 >= RECENT_MIN;
}

// Potomac Pulse - USGS service adapter (v39.11, server only).
//
// Pure functions, no network, no environment access. Turns the answer of USGS's new continuous-data
// service (api.waterdata.usgs.gov, a GeoJSON FeatureCollection with one row per reading) into the
// structure the old service (waterservices.usgs.gov/nwis/iv) returned, so the existing parsers in
// scheduled-update.js read it unchanged. A browser copy follows in Step 2 (see CLAUDE.md sync notes).
//
// The key never appears here: it is sent by the caller as the X-Api-Key header, never in the address.
// Plan: analysis/usgs-service-move-plan-2026-11-17.md (and its rulings and Step 0 results).

const BASE = 'https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items';
const PROPERTIES = 'monitoring_location_id,parameter_code,statistic_id,time,value,approval_status,qualifier,last_modified,time_series_id';
const NO_DATA = '-999999';          // the old service's missing-value marker (its noDataValue)
const STAT_INSTANT = '00011';       // instantaneous values; the only statistic the old service served
const PERIOD_RE = /^P(?=\d|T\d)(\d+D)?(T(\d+H)?(\d+M)?)?$/;

// New service qualifier code -> old service qualifier string. Codes not listed here are passed
// through unchanged and reported to the caller (unknownQualifiers) so they can be logged.
const QUALIFIER_MAP = Object.freeze({ ICE: 'Ice', EQUIP: 'Eqp' });
const APPROVAL_MAP = Object.freeze({ Provisional: 'P', Approved: 'A' });

/**
 * Builds the request address for the new service. The key is never part of it.
 * @param {{sites: string[], params: string[], period: string}} req - 8-digit site ids, parameter codes, ISO duration (P2D, P1D, PT6H).
 * @returns {string}
 */
function buildContinuousUrl({ sites, params, period }) {
    if (!Array.isArray(sites) || !sites.length) throw new Error('buildContinuousUrl: sites required');
    if (!Array.isArray(params) || !params.length) throw new Error('buildContinuousUrl: params required');
    if (typeof period !== 'string' || !PERIOD_RE.test(period)) throw new Error('buildContinuousUrl: period must be an ISO duration like P2D or PT6H');
    for (const s of sites) if (!/^\d{8,15}$/.test(String(s))) throw new Error('buildContinuousUrl: bad site id');
    for (const p of params) if (!/^\d{5}$/.test(String(p))) throw new Error('buildContinuousUrl: bad parameter code');
    return `${BASE}?f=json`
        + `&monitoring_location_id=${sites.map(s => `USGS-${s}`).join(',')}`
        + `&parameter_code=${params.join(',')}`
        + `&time=${period}`
        + `&limit=50000&skipGeometry=true`
        + `&properties=${PROPERTIES}`;
}

function siteOf(props) {
    const id = props && props.monitoring_location_id;
    if (typeof id !== 'string' || !id) throw new Error('USGS row without monitoring_location_id');
    return id.replace(/^USGS-/, '');
}

function checkShape(newJson) {
    if (!newJson || typeof newJson !== 'object' || !Array.isArray(newJson.features)) {
        throw new Error('USGS new-service response is malformed (no features array)');
    }
    if (Array.isArray(newJson.links) && newJson.links.some(l => l && l.rel === 'next')) {
        throw new Error('USGS new-service response is paged (a next link is present); refusing a truncated answer');
    }
}

function* instantRows(newJson) {
    for (const f of newJson.features) {
        const p = f && f.properties;
        if (!p) throw new Error('USGS row without properties');
        if (p.statistic_id !== STAT_INSTANT) continue;
        yield p;
    }
}

/**
 * Converts the new service's FeatureCollection into the old service's structure.
 * @param {Object} newJson - parsed FeatureCollection ({features, links, timeStamp}).
 * @param {{unknownQualifiers?: string[]}} [report] - optional out-parameter; `report.unknownQualifiers`
 *   receives the sorted list of qualifier codes that had no mapping (passed through unchanged).
 * @returns {Object} the old-structure document `{value: {queryInfo, timeSeries}}`.
 */
function toLegacyIv(newJson, report = null) {
    checkShape(newJson);
    const groups = new Map();            // "site|param" -> {site, param, seriesId, rows: [], seen: Set}
    const unknown = new Set();
    for (const p of instantRows(newJson)) {
        const site = siteOf(p);
        const param = String(p.parameter_code);
        const key = `${site}|${param}`;
        const sid = p.time_series_id == null ? '' : String(p.time_series_id);
        let g = groups.get(key);
        if (!g) { g = { site, param, seriesId: sid, rows: [], seen: new Set() }; groups.set(key, g); }
        else if (g.seriesId !== sid) throw new Error(`USGS returned two different series for ${site} parameter ${param}`);
        const t = Date.parse(p.time);
        if (!Number.isFinite(t)) throw new Error(`USGS row with unreadable time for ${site} parameter ${param}`);
        // Second guard: two readings at one instant inside one (gauge, parameter) group mean two series
        // were merged, whether or not time_series_id was present. NOT caught: two series without a
        // time_series_id whose instants never collide.
        if (g.seen.has(t)) throw new Error(`USGS returned two readings at the same instant for ${site} parameter ${param} (two series?)`);
        g.seen.add(t);
        const quals = [];
        const approval = APPROVAL_MAP[p.approval_status];
        if (approval) quals.push(approval);
        else if (p.approval_status !== null && p.approval_status !== undefined && p.approval_status !== '') unknown.add(`status:${p.approval_status}`);
        const qlist = typeof p.qualifier === 'string' ? [p.qualifier] : p.qualifier;
        if (Array.isArray(qlist)) {
            for (const code of qlist) {
                if (typeof code !== 'string' || code === '') continue;
                if (Object.prototype.hasOwnProperty.call(QUALIFIER_MAP, code)) quals.push(QUALIFIER_MAP[code]);
                else { quals.push(code); unknown.add(code); }
            }
        }
        g.rows.push({
            t,
            value: p.value === null || p.value === undefined ? NO_DATA : String(p.value),
            qualifiers: quals,
            dateTime: p.time
        });
    }
    // Schema-change guard: rows exist but none is an instantaneous (00011) row.
    if (newJson.features.length > 0 && groups.size === 0) {
        throw new Error('USGS new-service response has rows but none with statistic_id 00011 (schema change?)');
    }
    const timeSeries = [];
    for (const g of groups.values()) {
        g.rows.sort((a, b) => a.t - b.t);
        timeSeries.push({
            sourceInfo: { siteCode: [{ value: g.site }] },
            variable: { variableCode: [{ value: g.param }], noDataValue: -999999 },
            values: [{ value: g.rows.map(r => ({ value: r.value, qualifiers: r.qualifiers, dateTime: r.dateTime })) }]
        });
    }
    if (report) report.unknownQualifiers = [...unknown].sort();
    return { value: { queryInfo: { note: [{ title: 'requestDT', value: newJson.timeStamp }] }, timeSeries } };
}

/**
 * For logging only: per gauge and parameter, the `time` and `last_modified` (ISO strings) of the
 * newest reading. Same statistic filter as toLegacyIv.
 * @param {Object} newJson
 * @returns {Object} {'<site>': {'<param>': {time, lastModified}}}
 */
function newestPublishTimes(newJson) {
    checkShape(newJson);
    const out = {};
    const best = {};
    for (const p of instantRows(newJson)) {
        const site = siteOf(p);
        const param = String(p.parameter_code);
        const t = Date.parse(p.time);
        if (!Number.isFinite(t)) continue;
        const k = `${site}|${param}`;
        if (best[k] === undefined || t > best[k]) {
            best[k] = t;
            (out[site] = out[site] || {})[param] = { time: p.time, lastModified: p.last_modified ?? null };
        }
    }
    return out;
}

module.exports = { buildContinuousUrl, toLegacyIv, newestPublishTimes, QUALIFIER_MAP, NO_DATA };

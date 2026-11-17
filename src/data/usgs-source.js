// Potomac Pulse - where the USGS readings come from (v39.13).
//
// One helper returns the old-structure JSON (`{value: {queryInfo, timeSeries}}`) for a named set, so the
// parsers in fetch.js and edwards-ferry.js stay as they were. Two stages:
//   stage 1  our own function, same origin: /api/usgs?set=<name> (the key lives there, never here)
//   stage 2  USGS's new service called directly from the browser, no key and no custom headers (so no
//            CORS preflight), converted with the browser adapter
// A failure of a stage is final for that stage: no retry (the keyless limit is per visitor address and
// unknown). The caller walks on to its saved copy. Page timers cover the response headers only, as before.
// Plan and rulings: analysis/usgs-step2-app-plan-2026-11-17.md

import { LF, GAUGES, CREEK_RUNS, EDWARDS_FERRY } from '../model/constants.js';
import { buildContinuousUrl, toLegacyIv } from './usgs-adapter.js';

/** Point of Rocks: the temperature gauge and, with Little Falls, one of the two headline flow gauges. */
export const POR_ID = '01638500';
export const TEMP_SITE = POR_ID;

/** Page timers in ms. The service worker timeouts (config/runtime-caching.mjs) must stay below these. */
export const PAGE_TIMERS = Object.freeze({ main: 8000, creeks: 7000, ef: 7000, temp: 7000 });

/**
 * The direct-stage request for a named set, built from the app's own constants.
 * @param {string} name - 'main', 'creeks', 'ef' or 'temp'.
 * @returns {{sites: string[], params: string[], period: string}|null} Null for an unknown name.
 */
export function directSet(name) {
    switch (name) {
        case 'main':   return { sites: Object.keys(GAUGES), params: ['00060', '00065'], period: 'P7D' };
        case 'creeks': return { sites: Object.keys(CREEK_RUNS), params: ['00060'], period: 'P1D' };
        case 'ef':     return { sites: [EDWARDS_FERRY.id], params: ['00065'], period: 'P1D' };
        case 'temp':   return { sites: [TEMP_SITE], params: ['00010'], period: 'P1D' };
        default:       return null;
    }
}

/** The exact stage-1 address for a set. */
export function functionUrl(name) { return `/api/usgs?set=${name}`; }

// GET one address with a page timer on the response headers. Throws on timeout, network error or a
// status that is not OK. `parent` (optional AbortController) lets a sibling call abort this one.
async function getJson(url, ms, parent) {
    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    if (parent) parent.signal.addEventListener('abort', onParentAbort);
    const timer = setTimeout(() => controller.abort(), ms);
    let r;
    try {
        r = await fetch(url, { signal: controller.signal });
    } catch (e) {
        if (e && e.name === 'AbortError') throw new Error(`Request timed out after ${ms}ms`);
        throw e;
    } finally {
        clearTimeout(timer);
        if (parent) parent.signal.removeEventListener('abort', onParentAbort);
    }
    if (!r.ok) {
        try { if (r.body && typeof r.body.cancel === 'function') r.body.cancel(); } catch (e) { /* ignore */ }
        throw new Error(`HTTP ${r.status}`);
    }
    return r.json();
}

const hasTimeSeries = (j) => !!j && typeof j === 'object' && !!j.value && Array.isArray(j.value.timeSeries);

/**
 * A `main` answer must hold at least one reading for Little Falls flow and Point of Rocks flow (00060).
 * An empty or headless answer is a failure of the stage, so it is never accepted as live or saved.
 * The small sets are not guarded: a gauge that is out of service is a legitimate empty answer.
 * @param {Object} json - Old-structure body.
 * @returns {boolean}
 */
export function mainHasHeadlineGauges(json) {
    const series = json && json.value && json.value.timeSeries;
    if (!Array.isArray(series)) return false;
    const has = (site) => series.some((ts) => ts && ts.sourceInfo?.siteCode?.[0]?.value === site
        && ts.variable?.variableCode?.[0]?.value === '00060'
        && Array.isArray(ts.values) && ts.values.some((b) => b && Array.isArray(b.value) && b.value.length > 0));
    return has(LF.id) && has(POR_ID);
}

/**
 * Stage 1: our own function. Fails on a non-OK status, a non-JSON body or a body without value.timeSeries.
 * @param {string} name - Set name.
 * @param {{timeoutMs?: number}} [opts] - Page timer override (tests).
 * @returns {Promise<Object>} The old-structure JSON.
 */
export async function fetchFromFunction(name, { timeoutMs } = {}) {
    if (!directSet(name)) throw new Error(`unknown USGS set ${name}`);
    const json = await getJson(functionUrl(name), timeoutMs ?? PAGE_TIMERS[name]);
    if (!hasTimeSeries(json)) throw new Error('function answer has no value.timeSeries');
    if (name === 'main' && !mainHasHeadlineGauges(json)) throw new Error('function answer for main has no Little Falls or Point of Rocks flow');
    return json;
}

// Merge the two answers of `main` (one per parameter): rows and links together, the OLDER timeStamp.
function mergeAnswers(list) {
    for (const j of list) {
        if (!j || typeof j !== 'object' || !Array.isArray(j.features)) throw new Error('USGS new-service response is malformed (no features array)');
    }
    let stamp = list[0].timeStamp;
    let stampMs = Date.parse(stamp);
    for (const j of list.slice(1)) {
        const t = Date.parse(j.timeStamp);
        // An unparseable stamp is kept (it makes the body time unknown, the conservative reading).
        if (Number.isFinite(stampMs) && (!Number.isFinite(t) || t < stampMs)) { stamp = j.timeStamp; stampMs = t; }
    }
    return {
        features: list.flatMap((j) => j.features),
        links: list.flatMap((j) => (Array.isArray(j.links) ? j.links : [])),
        timeStamp: stamp
    };
}

/**
 * Stage 2: USGS's new service called directly, no key, no custom headers. `main` is two calls in
 * parallel (one per parameter, ruling 5), merged. HTTP 429, any error, a paged or rejected answer is a failure.
 * @param {string} name - Set name.
 * @param {{timeoutMs?: number}} [opts] - Page timer override (tests).
 * @returns {Promise<Object>} The old-structure JSON.
 */
export async function fetchFromDirect(name, { timeoutMs } = {}) {
    const def = directSet(name);
    if (!def) throw new Error(`unknown USGS set ${name}`);
    const ms = timeoutMs ?? PAGE_TIMERS[name];
    const requests = name === 'main' ? def.params.map((p) => ({ ...def, params: [p] })) : [def];
    const urls = requests.map((q) => buildContinuousUrl(q));
    const parent = new AbortController();
    let answers;
    try {
        answers = await Promise.all(urls.map((u) => getJson(u, ms, parent)));
    } catch (e) {
        parent.abort(); // a failing call stops its sibling
        throw e;
    }
    const legacy = toLegacyIv(answers.length === 1 ? answers[0] : mergeAnswers(answers));
    if (name === 'main' && !mainHasHeadlineGauges(legacy)) throw new Error('direct answer for main has no Little Falls or Point of Rocks flow');
    return legacy;
}

/**
 * Both stages in order, for callers that have no classification to do (creeks, Edwards Ferry, temperature).
 * Never throws.
 * @param {string} name - Set name.
 * @returns {Promise<{json: Object, stage: ('function'|'direct')}|null>} Null when both stages failed.
 */
export async function fetchOldShape(name) {
    try {
        return { json: await fetchFromFunction(name), stage: 'function' };
    } catch (e) {
        console.log(`USGS ${name}: function stage failed:`, e && e.message || e);
    }
    try {
        return { json: await fetchFromDirect(name), stage: 'direct' };
    } catch (e) {
        console.log(`USGS ${name}: direct stage failed:`, e && e.message || e);
    }
    return null;
}

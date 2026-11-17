// Potomac Pulse - /api/usgs (v39.12, server only). Nothing in the app calls it yet (push A).
//
// Serves four named sets of USGS readings from the new service (api.waterdata.usgs.gov), converted to
// the old service's structure, from one shared cache. Modern Netlify function format: the path and
// method are declared in `config`, so the function answers only at /api/usgs (no /.netlify/functions
// address). The key goes only in the X-Api-Key header and never in an address, log line, body or header.
// Accepted: GET, exact path, raw query exactly ?set=main|creeks|ef|temp. Anything else is refused with
// no upstream call (so cache-busting variants cannot spend the key).
// Plan and rulings: analysis/usgs-step2-app-plan-2026-11-17.md

import adapter from './shared/usgs-adapter.js';
import setsModule from './shared/usgs-sets.js';

const { buildContinuousUrl, toLegacyIv } = adapter;
const { SETS, CACHE_POLICY } = setsModule;

export const config = { path: '/api/usgs', method: 'GET' };

const KEY_RE = /^[\x21-\x7e]+$/;
// The raw address (scheme and host removed) must equal one of these character for character.
const CANONICAL = { '/api/usgs?set=main': 'main', '/api/usgs?set=creeks': 'creeks', '/api/usgs?set=ef': 'ef', '/api/usgs?set=temp': 'temp' };
const ORIGIN_RE = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

// USGS_API_KEY_APP wins when it is set (non-empty). A malformed value there is NOT replaced by
// USGS_API_KEY: the endpoint fails closed (503 no_key) and logs the fixed token key=malformed.
function appKey() {
    return process.env.USGS_API_KEY_APP || process.env.USGS_API_KEY || '';
}

// Message text with any configured key removed.
function redact(msg) {
    let m = String(msg == null ? '' : msg);
    for (const k of [process.env.USGS_API_KEY_APP, process.env.USGS_API_KEY]) {
        if (k) m = m.split(k).join('[redacted]');
    }
    return m.slice(0, 200);
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Cache header sets. All numbers come from CACHE_POLICY.
function headersFor(kind, extra = {}) {
    const h = { 'Content-Type': 'application/json; charset=utf-8' };
    if (kind === 'ok') {
        h['Netlify-CDN-Cache-Control'] = `public, durable, max-age=${CACHE_POLICY.okSeconds}, stale-while-revalidate=${CACHE_POLICY.okGraceSeconds}`;
        h['Netlify-Vary'] = 'query=set';
        h['Cache-Control'] = 'public, max-age=0, must-revalidate';
    } else if (kind === 'error') {
        h['Netlify-CDN-Cache-Control'] = `public, durable, max-age=${CACHE_POLICY.errorSeconds}`;
        h['Netlify-Vary'] = 'query=set';
        h['Cache-Control'] = 'no-store';
    } else if (kind === 'rate') {
        h['Netlify-CDN-Cache-Control'] = `public, durable, max-age=${extra.seconds}`;
        h['Netlify-Vary'] = 'query=set';
        h['Cache-Control'] = 'no-store';
        h['Retry-After'] = String(extra.seconds);
    } else {
        h['Cache-Control'] = 'no-store';
        h['Netlify-CDN-Cache-Control'] = 'no-store';
    }
    return h;
}

function errorResponse(status, code, kind, extra) {
    return new Response(JSON.stringify({ error: code }), { status, headers: headersFor(kind, extra) });
}

// One GET plus the body read under ONE timer. Resolves {status, json?, retryAfter?, remaining?, rows?, bad?};
// rejects with {timeout:true} on the cap and with a plain error otherwise.
async function fetchCapped(url, key, capMs, controller) {
    let timer;
    let onAbort;
    const work = (async () => {
        const response = await fetch(url, { signal: controller.signal, headers: { 'X-Api-Key': key } });
        const out = { status: response.status };
        const h = response.headers;
        if (h && typeof h.get === 'function') {
            const rem = Number(h.get('x-ratelimit-remaining'));
            if (h.get('x-ratelimit-remaining') != null && Number.isFinite(rem)) out.remaining = rem;
            const ra = Number(h.get('retry-after'));
            if (h.get('retry-after') != null && Number.isFinite(ra)) out.retryAfter = ra;
        }
        if (!response.ok) { try { const c = response.body && response.body.cancel && response.body.cancel(); if (c && c.catch) c.catch(() => {}); } catch (_) { /* nothing to cancel */ } return out; }
        try { out.json = await response.json(); } catch (_) { out.bad = true; }
        return out;
    })();
    work.catch(() => {});
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject({ timeout: true });   // before the abort, so the timeout is what the race reports
            try { controller.abort(); } catch (_) { /* nothing to abort */ }
        }, capMs);
    });
    // A sibling call that failed aborts the shared controller; this ends the wait at once.
    const aborted = new Promise((_, reject) => {
        onAbort = () => reject({ aborted: true });
        if (controller.signal.aborted) onAbort(); else controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    aborted.catch(() => {});
    try {
        return await Promise.race([work, timeout, aborted]);
    } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
    }
}

function log(info) {
    const parts = [`usgs-proxy set=${info.set}`, `status=${info.status}`, `ms=${info.ms}`,
        `up=${(info.up || []).join(',') || '-'}`, `rows=${(info.rows || []).join(',') || '-'}`];
    if (info.remaining && info.remaining.length) parts.push(`rl=${info.remaining.join(',')}`);
    if (info.keyBad) parts.push('key=malformed');
    if (info.err) parts.push(`err=${info.err}`);
    console.log(parts.join(' '));
}

export default async (req, context) => {
    const t0 = Date.now();
    const info = { set: '-', status: 0, up: [], rows: [], remaining: [] };
    const finish = (res) => { info.status = res.status; info.ms = Date.now() - t0; try { log(info); } catch (_) { /* logging never breaks an answer */ } return res; };
    try {
        if (req.method !== 'GET') return finish(errorResponse(405, 'method', 'none'));
        const url = new URL(req.url);
        // Raw-address check: what is left of req.url after scheme and host must be exactly canonical, and
        // URL parsing must not have changed it (dot segments, tabs, newlines, trailing spaces).
        const raw = String(req.url).replace(ORIGIN_RE, '');
        const setName = raw === url.pathname + url.search ? CANONICAL[raw] : undefined;
        if (!setName) return finish(errorResponse(400, 'bad_request', 'none'));
        info.set = setName;
        const key = appKey();
        if (!KEY_RE.test(key)) { if (key) info.keyBad = true; return finish(errorResponse(503, 'no_key', 'none')); }

        const set = SETS[setName];
        const urls = set.params.map(p => buildContinuousUrl({ sites: [...set.sites], params: [p], period: set.period }));
        const controller = new AbortController();   // shared: the first failing call aborts its sibling
        const results = await Promise.all(urls.map(u => fetchCapped(u, key, set.capMs, controller).then(
            (r) => { if (r.status !== 200 || r.bad) controller.abort(); return r; },
            (e) => {
                if (!(e && (e.timeout || e.aborted))) controller.abort();   // a timeout already aborted it
                return { failed: e && e.timeout ? 'timeout' : e && e.aborted ? 'aborted' : 'network' };
            }
        )));
        for (const r of results) {
            info.up.push(r.failed || r.status);
            if (r.json && Array.isArray(r.json.features)) info.rows.push(r.json.features.length);
            if (r.remaining !== undefined) info.remaining.push(r.remaining);
        }
        // Order: rate limit, then timeout, then any other failure.
        const limited = results.filter(r => r.status === 429);
        if (limited.length) {
            const asked = Math.max(...limited.map(r => (r.retryAfter === undefined ? 0 : r.retryAfter)));
            const seconds = clamp(Math.round(asked), CACHE_POLICY.rateLimitedMinSeconds, CACHE_POLICY.rateLimitedMaxSeconds);
            return finish(errorResponse(503, 'upstream_rate_limited', 'rate', { seconds }));
        }
        if (results.some(r => r.failed === 'timeout')) return finish(errorResponse(504, 'upstream_timeout', 'error'));
        if (results.some(r => r.failed || r.bad || r.status !== 200 || !r.json || typeof r.json !== 'object' || !Array.isArray(r.json.features))) {
            return finish(errorResponse(502, 'upstream_bad_response', 'error'));
        }
        // The OLDER upstream timeStamp; the function's own clock is never used.
        let oldest = Infinity;
        for (const r of results) {
            const ms = typeof r.json.timeStamp === 'string' ? Date.parse(r.json.timeStamp) : NaN;
            if (!Number.isFinite(ms)) return finish(errorResponse(502, 'no_timestamp', 'error'));
            oldest = Math.min(oldest, ms);
        }
        const merged = {
            features: results.flatMap(r => r.json.features),
            links: results.flatMap(r => (Array.isArray(r.json.links) ? r.json.links : [])),
            timeStamp: new Date(oldest).toISOString()
        };
        let legacy;
        try { legacy = toLegacyIv(merged); } catch (_) { return finish(errorResponse(502, 'upstream_bad_response', 'error')); }
        return finish(new Response(JSON.stringify(legacy), { status: 200, headers: headersFor('ok') }));
    } catch (e) {
        info.err = redact(e && e.message);
        return finish(errorResponse(500, 'internal', 'none'));
    }
};

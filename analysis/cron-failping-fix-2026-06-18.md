# Silent USGS-null cron early-return → fire the /fail ping (Tier 2 #5)

**Date:** 2026-06-18 · **Version:** MINOR (v37.1 → v37.2) · server-only, no model/UI change.
**Load-bearing** (`scheduled-update.js`, cron) → verification by a fresh subagent + upfront verification path.

## Problem

`exports.handler` fetches USGS data inside the `try`; on failure it does an **early `return`**:

```js
if (!usgsData) {
    return { statusCode: 500, body: 'Failed to fetch USGS data' };   // line 1634
}
```

Because it `return`s (not `throw`s) **inside the try**, it bypasses both:
- the success heartbeat ping (line ~1753, `fetch(HEALTHCHECKS_PING_URL)`), and
- the catch block's failure ping (line ~1772, `fetch(HEALTHCHECKS_PING_URL + '/fail')`).

So a USGS fetch stall writes nothing and pings **neither** success nor `/fail` — healthchecks.io sees
silence, not a failure, and only alerts on its own grace-period timeout (and `missedRuns` is only
gap-derived on the *next successful* run). This invisibility masked the ~2h outage on 2026-06-18.
Confirmed: line 1634 is the **only** silent early-return in the handler — the ice/EF-missing paths
deliberately continue (they aren't failures) and the pre-`try` "Supabase not configured" return (1623,
a deploy misconfig) is out of scope.

## Fix (one line)

```js
if (!usgsData) {
    throw new Error('Failed to fetch USGS data');
}
```

Routing the failure through the existing `catch` (which already fires the `/fail` ping and returns
`500`) is the DRY fix — no duplicated ping code. Status stays `500`; the body changes from the plain
string to `{"error":"Failed to fetch USGS data"}`, consistent with the catch's other 500s. `missedRuns`
remains gap-derived (computeRunHealth on the next success) — unchanged; the real-time signal is the
`/fail` ping.

## Files
- `netlify/functions/scheduled-update.js` — line 1634 `return` → `throw`.
- `test/cron-fail-ping.test.js` (new) — see below.
- Docs/version → v37.2 (CHANGELOG, README history, index.html title, CLAUDE.md/tech-appendix version).

## Test (end-to-end, deterministic)
New `test/cron-fail-ping.test.js`: set `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` (dummy, so `getSupabase`
returns a client) and `HEALTHCHECKS_PING_URL` **before** requiring the module; `t.mock.method(global,
'fetch', …)` to reject every call and record URLs; invoke `handler({}, {})`. Assert: `statusCode === 500`
**and** some recorded fetch URL ends with `/fail`. (Reject-all makes `fetchUSGSData` return null →
reaches the branch → throw → catch attempts the `/fail` ping, which the mock records even though it
also rejects, harmlessly, inside the ping's own try/catch.) Runs in its own `node --test` process, so
the env-before-require ordering is isolated.

## Verification path (stated upfront)
1. New unit test green (directly proves the `/fail` ping fires on USGS-null).
2. Full `npm test` green; `npm run build` clean.
3. Fresh-subagent re-audit (goal + diff): confirms the throw routes to the catch, no other path
   regresses, body/status correct.
4. **Unverified-until-it-happens gap (flagged):** a *live* USGS outage can't be simulated in prod, and
   the ping is a no-op unless `HEALTHCHECKS_PING_URL` is set in Netlify env (Tier 2 #6/#7 — separate).
   The code path is proven by the unit test; live alerting depends on that env var existing.

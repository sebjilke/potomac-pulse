# Independent re-audit of push A (the /api/usgs function)

Auditor: a fresh subagent (Opus) that did not write the code, read-only, 2026-11-17. Text extracted by script from the auditor's final report, not retyped.

## Re-audit: v39.12 push A (`/api/usgs`)

**Verdict: SHIP AFTER FIXES.** There are no blockers. Fixes 1 to 3 below are small changes to tests or docs. Every bullet in the brief was checked. Nothing in the repo was modified. All scratch work is in `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/reaudit2/`.

### Findings

**1. MAJOR (test gap): the tests do not prove the timer is cleared or that the request is aborted.**
- Evidence: on a copy, I deleted `clearTimeout(timer);` (`usgs-proxy.mjs:93`) and all 45 tests still passed. Deleting `controller.abort()` (`:86`) also left 45/45 passing.
- Why it matters: with the timer left running, the `timeout` promise rejects after the race has already settled. That is an unhandled rejection, which by default ends the Node process. It also keeps the instance alive until the cap. The current code is correct; nothing stops a regression.
- My own check of the current code (real timers, stub that honours the abort signal): 0 `Timeout` handles left after the response, and no unhandled rejections in any path.
- Fix: in the success, timeout and failure tests, assert that `process.getActiveResourcesInfo()` contains no `Timeout` once the response is returned. Add a stub that records `signal.aborted` and assert it is true after a 504.

**2. MAJOR (test gap): a partial failure of `main` is not pinned.**
- Evidence: changing `results.some(` to `results.every(` at `:134` still passes 45/45. With that change, a 5xx on one of the two calls falls through and crashes on `r.json.timeStamp`, giving 500 `internal` instead of 502. A 500 is never cached, so this is also a quota risk.
- Also uncaught: replacing `Math.max` of Retry-After with `Math.min` (`:129`).
- Fix: add tests for `main` where one call is 5xx, network error, timeout, paged or malformed and the other is 200. Each must give 502 or 504, two calls, and no partial body. Add a test with two different Retry-After values on the two `main` calls.

**3. MINOR: path normalisation lets more than the exact path through.**
- Evidence: `new URL()` resolves dot segments and strips tabs, newlines and trailing spaces. `/api/./usgs?set=main`, `/api/x/../usgs?set=ef`, `?set=main ` and `?set=ma\nin` all reach upstream (200, 2 calls).
- Real HTTP requests cannot carry a literal space or tab, but `curl --path-as-is /api/./usgs` can send dot segments. Whether Netlify routes those to the function and gives them a separate cache key is unknown. If it does, endlessly varied dot paths would bypass the cache and spend the key.
- Fix: add `curl --path-as-is "$SITE/api/./usgs?set=main"` (expect 404 or a cache hit) to TODO D12 and the section 9 checks. Optionally also reject when `req.url` (the raw string) differs from `url.href`.

**4. MINOR: Netlify's documentation does not say it caches 502/503/504.**
- Evidence: docs.netlify.com/platform/caching does not say which status codes are cached. `durable` and `stale-while-revalidate` are documented, and `query=item_id|page` is the documented `Netlify-Vary` form, so `query=set` is valid.
- If error answers are not cached, every visitor request during a USGS outage reaches upstream on the key it shares with the hourly job. TODO D12 already lists "error caching" as unmeasured, which is honest.
- A related risk that is not documented: when a stale 200 is revalidated and gets a 502, the 502 probably replaces the good copy for 60 s.
- Fix: in D12, add "does a 502 at revalidation replace the stale 200".

**5. MINOR: a malformed `USGS_API_KEY_APP` disables the endpoint even when `USGS_API_KEY` is valid.**
- Evidence: I set `USGS_API_KEY_APP='bad\nkey'` with a valid `USGS_API_KEY` (also tried `'  '`). The result is 503 `no_key`, and the log line is identical to "key missing".
- Failing closed is defensible, but it cannot be diagnosed from the logs.
- Fix: add a fixed log token such as `key=malformed` (never the value), and document that there is no fallback.

**6. MINOR: upstream bodies are not cancelled on a non-OK answer.**
- Evidence: `:79` returns without reading or cancelling the body. With undici this can hold the connection until garbage collection. Also, when one `main` call fails fast, the other runs on to its cap (measured: 429 plus a hang took 5,006 ms). Both are bounded.
- Fix: call `response.body?.cancel()` before returning. Optional: abort the sibling call once the first one fails.

**7. MINOR (docs):**
- TODO D8 was not extended to `USGS_API_KEY_APP`, although the plan's section 10 says it should be.
- The CHANGELOG's v39.11 test count was silently changed from 1476 to 1477 (a correction, but it was not mentioned).
- `navigateFallbackDenylist` (`vite.config.js:28`) does not exclude `/api/`. That only matters for a browser navigation to `/api/usgs` after the service worker is installed, and `/api/sync` already has the same behaviour. It does not matter for curl checks.

### Confirmed sound

- **Requests:** 17 query and method variants and 6 path variants are rejected with no upstream call. Every probe that was not a dot segment or whitespace was also refused: `%73et`, `%6Dain`, `SET`, duplicate or extra parameters, `?`, `??`, a trailing `&`, `;x`, `%00`, `%20`, a 100 kB query, `//api`, `/API`, `%2F`, HEAD, POST and OPTIONS. Nothing from the request is ever echoed (log shows `set=-`). The host and scheme in `req.url` are ignored, which is harmless.
- **Secrets:** a `fetch` rejection whose message contains the header value, a header getter that throws, a key containing a newline, and the exception path all produced no leak in the body, headers or logs. The rejection message is never logged; the exception path is redacted.
- **Retry-After:** `-50`, `1e9`, `Infinity`, `""`, `0x20`, `NaN` and an HTTP date are all clamped into 60 to 300.
- **Live shape check (3 keyless GETs, the limit was 4):** `timeStamp` and `links` are present; only `00011` rows with a single `time_series_id`; no `next` link.
- **Live `main` through the handler:** 18,079 + 18,079 rows, 38 series covering all 19 gauges. The body is 2.71 MB uncompressed, under the 6 MB limit. `requestDT` was the older of the two stamps and parses in `bodyTimeMs`. Flow and stage groups never collide, so the adapter's duplicate guards cannot misfire across the merge.
- **Fields:** everything read by `processData`, `fetchCreekData`, `edwards-ferry.js` and validation is present with the right type.
- **Set tables:** they match `constants.js` (tested).
- **Bundling:** esbuild bundles it to 14.7 kB as ESM. The bundled module loads and, with no key, answers 503 `no_key` with `no-store` on both cache headers.
- **No conflicts:** with the `/api/sync` redirect, the schedule or the build command.

### Tests

- `npm test`: 1522 tests, 1520 pass, 0 fail, 2 skipped.
- With `USGS_API_KEY=dummy USGS_API_KEY_APP=dummy2 USGS_SOURCE=new`: the same counts (the script clears the variables).
- Proxy file alone: 45/45.
- No network or wall-clock dependence (fetch is stubbed; the timeout tests use fake timers).
- Mutation results:

| Mutation | Result |
|---|---|
| Newer `timeStamp` instead of older | caught (1 fail) |
| `searchParams` instead of the raw query | caught (6 fail) |
| `clearTimeout` removed | survived |
| `abort` removed | survived |
| `some` changed to `every` | survived |
| `max` changed to `min` for Retry-After | survived |

### Versions

v39.12 agrees in `CLAUDE.md`, `index.html` (meta and footer), the README, the Tech Appendix, the CHANGELOG and TODO; `howitworks-text` passes. The docs claim nothing the code does not do.

**Fix list before shipping:** 1, 2, and the D12 additions from 3 and 4. Items 5 to 7 can wait.

### Not checked

- A real Netlify deploy: routing of `config.path`, dot-segment normalisation, caching of error statuses, `durable` and `stale-while-revalidate` behaviour, compression.
- Whether Netlify passes HEAD to a GET-only function.
- How long upstream calls take from Netlify's region.
- Whether the background revalidation sends the triggering URL.

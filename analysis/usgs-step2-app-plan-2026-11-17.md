# Step 2 plan: the app reads USGS through /api/usgs (v39.12)

Drafted 2026-11-17 from the repo as it stands (v39.11). Nothing was built. Assumptions are marked "ASSUMED" and listed in section 8.

## 1. Inventory: what changes (file:line)

| Place | Today | Change |
|---|---|---|
| `src/data/fetch.js:409` | main URL on `waterservices.usgs.gov`, `period=P7D` | replaced by `set=main` via the new source helper |
| `fetch.js:416-501` `fetchUSGS` | direct 10 s, then proxies, then localStorage | stage 1 `/api/usgs?set=main` (6 s), stage 2 direct new service (6 s), then localStorage. The body-time classification, `consider`, `directOld`, `chainSuppressed`, `noteChainFoundNothing` and the tail logic stay as written |
| `fetch.js:444`, `468-482` | direct call and the proxy loop | the first call becomes stage 1; the loop body becomes stage 2 (one entry, not two) |
| `fetch.js:392-395` `PROXIES_LIST` | allorigins, corsproxy | deleted |
| `fetch.js:326-328` `fetchCreekData` | old URL, 5 s | `set=creeks` page 5 s (SW 4 s), then direct 5 s. Parser untouched |
| `fetch.js:100-136` cache write/read | old structure | unchanged: the adapter output has the old structure, so saved copies from v39.11 stay readable |
| `fetch.js:246` (`processData`) | `bodyMs: bodyTimeMs(json)` | unchanged |
| `src/estimation/edwards-ferry.js:26,29` and `75,77` | two old URLs, 5 s | `set=ef` and `set=temp`, same two-stage helper, 5 s each. Parsers untouched |
| `src/ui/data-freshness.js:19` and `74-77` | comments say "no shared cache" and "CORS proxy" | comments only. The code (`bodyTimeMs` 80-90, `BODY_FRESH_MIN` 10) is unchanged |
| `config/runtime-caching.mjs:12-16`, `39-58` | rules for the old host and relays | see section 4 |
| `netlify.toml:27` | `connect-src` lists the old host and relays | see section 5 |
| `netlify.toml:29-32` | one redirect (`/api/sync`) | add `/api/usgs` to `/.netlify/functions/usgs-proxy`, status 200 |
| `vite.config.js:3, 28-30` | imports the routes; `navigateFallbackDenylist` | no change. `/api/usgs` is a fetch, not a navigation |
| New `src/data/usgs-source.js` | none | helper `fetchOldShape(set, {serverMs, directMs})`, used by creeks, EF and temperature. The main chain keeps its own loop for the classification |
| New `src/data/usgs-adapter.js` | none | browser copy of the adapter (section 3) |
| New `netlify/functions/usgs-proxy.js`, `shared/usgs-sets.js` | none | section 2 |

Out of scope, unchanged: `scheduled-update.js` (not edited at all), `build-ef-correlation-advanced.js` (TODO D1), `nws.js`.

Tests that pin old addresses, relays, `P7D` or the SW rules:
- Change in Step 2: `test/sw-runtime-caching.test.mjs:32-40` (URLs), `62-74` (#3), `76-82` (#4), the built-SW test #8.
- Change in Step 2: `test/clean-screen-behaviour.test.mjs:92`, `test/startup-refresh-behaviour.test.mjs:87`, `test/forecast-accuracy-row.test.mjs:93`, `test/data-freshness.test.mjs:387,429,637`. Their stubs answer `/api/usgs?set=main`.
- Add to `test/map-removed.test.mjs:52`: no change needed; it stays green.
- Unchanged: `usgs-step1-handler`, `truth-dr-handler`, `truth-dr-fetch`, `usgs-adapter`. They pin the server's old URLs and the hourly job.

## 2. The function `/api/usgs` (`usgs-proxy.js`)

**Sets** (the app's four requests, one-to-one):

| set | sites | params | period |
|---|---|---|---|
| main | the 19 `GAUGES` keys | 00060,00065 | P7D |
| creeks | the 4 `CREEK_RUNS` keys | 00060 | P1D |
| ef | `EDWARDS_FERRY.id` | 00065 | P1D |
| temp | 01638500 | 00010 | P1D |

The tables live in `shared/usgs-sets.js`. A test compares them with `src/model/constants.js`, so a new gauge cannot be added to the app and missed on the server.

**Input**
- Methods GET and HEAD only (else 405).
- The query must be exactly one `set` with one value from the table, checked on `multiValueQueryStringParameters`. Anything else gets 400 `bad_request`, with no upstream call.
- The body never echoes the input.

**Upstream call**
- Built with `usgsAdapter.buildContinuousUrl`.
- The key goes only in the `X-Api-Key` header. A key that fails `/^[\x21-\x7e]+$/` (or is missing) gives 503 `no_key`. The function never calls USGS keyless and never calls the old service.
- No `console` line contains the key or an upstream message. Logged: set, status, duration, upstream status, `x-ratelimit-remaining` (a number).
- One attempt, no retry in the function. The app's stage 2 is the retry, and a retry would break the 10 s limit.
- Time caps: main 4.5 s, small sets 3.5 s, covering the request and the body read (reuse the Step 1 pattern: one timer, abort, race).
- Netlify's synchronous limit is ASSUMED to be 10 s. The caps leave about 5 s of margin.

**Output**
- 200 with `toLegacyIv(json)`.
- `requestDT` is the upstream `timeStamp`, normalised to a millisecond ISO string (`new Date(Date.parse(ts)).toISOString()`) so iOS Safari cannot choke on 6 fractional digits. A missing or unparseable `timeStamp` gives 502 `no_timestamp`. The function's own clock is never used.

| Status | `error` | Cause |
|---|---|---|
| 400 | `bad_request` | free-form or extra parameter |
| 405 | `method` | not GET or HEAD |
| 500 | `internal` | bug |
| 502 | `upstream_bad_response` | 5xx, malformed, paged or adapter-rejected answer |
| 503 | `no_key` | key missing or malformed |
| 503 | `upstream_rate_limited` | upstream 429; `Retry-After` from upstream, capped at 300 |
| 504 | `upstream_timeout` | cap exceeded |

Error bodies are tiny JSON.

**Size.** The old-structure body for the main set is about 36,126 readings × about 85 bytes, roughly 3.1 MB. This is an ESTIMATE; the old service's measured body was 2.9 MB. Netlify's buffered response limit is ASSUMED to be 6 MB. That leaves about 2× margin, and it must be checked on a real deploy. If the body is not compressed, a phone downloads 3 MB; check `content-encoding` on a live request. If it is missing, gzip in the function (base64, `Content-Encoding: gzip`).

**Caching** (status 200):
```
Netlify-CDN-Cache-Control: public, max-age=120, stale-while-revalidate=30, durable
Netlify-Vary: query=set
Cache-Control: public, max-age=0, must-revalidate
```
- Maximum body age at delivery is 150 s, against the app's 10 min rule. Ruling 8 said "at most 2 minutes"; `stale-while-revalidate=30` adds 30 s, so drop it if the owner wants a strict 2 minutes (see Q2).
- Errors 502, 503 and 504 get `Netlify-CDN-Cache-Control: public, max-age=15` (this shields the key from a stampede while USGS is down). 400, 405 and 500 get `no-store`.
- `Netlify-Vary: query=set` plus rejection of other parameters means 4 cache keys exist, so a visitor cannot spend the key's quota with cache-busting.
- No CORS headers (same origin).

**Budget** (limit 1,000 an hour with the key, shared with the hourly job's 3):
- Four sets × 30 windows an hour = 120 calls an hour at most with `durable`. With a 2× stampede allowance that is about 243 including the job.
- Without `durable` it is 120 × the number of active edge nodes. This stays under 1,000 only for 8 nodes or fewer.
- Measure: log `x-ratelimit-remaining`, and read the `cache-status` header on a live request.

## 3. The app

**Fetch order and time limits**

| Request | Stage 1: `/api/usgs` page / SW | Stage 2: direct new service page / SW | Worst case before the saved copy |
|---|---|---|---|
| main | 6 s / 5 s | 6 s / 5 s | 12 s |
| creeks, EF, temp | 5 s / 4 s | 5 s / 4 s | 10 s |

- The slowest one sets the page time, so worst case is 12 s. Today it is up to about 20 s (10 s + 5 + 5); the 8 s main wait only applies when the SW answers with its saved copy.
- A healthy path is one call of about 1 to 3 s. The creeks request fits (about 1 s upstream).
- The page timers cover the headers only, as today (`fetchWithTimeout` clears its timer once the response arrives). This is unchanged.
- No hedged parallel request: it would spend keyless quota.

**Direct stage**
- URL from the browser adapter's `buildContinuousUrl`, no custom headers (so no CORS preflight), conversion with `toLegacyIv`, `requestDT` untouched. Because of this the existing body-time rule works.
- A 429, any error or a paged answer on the keyless path counts as a failure of that stage. It is not retried and the chain moves on. The keyless limit is per visitor IP and unknown; the 15-minute refresh makes at most 4 keyless calls per refresh, and only after the function failed.

**Behaviour per path**
- Fresh answer from the function: classified by `classifyOldPayload`. `readings-fresh` and `live-behind` are accepted; `live-behind` sets `earlyOk=false` as today.
- SW saved copy of `/api/usgs` (after the SW timeout or a network error): the body is old, so it classifies as `saved-copy`. The chain continues to stage 2, `chainSuppressed` and the 60 min memo work as before, and the early refetch is allowed.
- Function answers 5xx, 429 or 400: Workbox passes the response through (ASSUMED for the installed Workbox version; verify by reading its source in `node_modules`). The page sees a non-OK response and goes to stage 2.
- Everything fails: localStorage copy ("cached" or "stale"), else `data:unavailable` and the UNAVAILABLE state with its Try again button. That code is untouched.
- Resume and refresh triggers (v39.7) read `lastReading.bodyMs`, which is now the upstream `timeStamp` (at most 150 s old at delivery, plus real publish lag). No change.

## 4. Service worker (`config/runtime-caching.mjs`)

1. `sync-learning`: unchanged.
2. `url.pathname === '/api/usgs' && url.search.indexOf('set=main') !== -1`: NetworkFirst, `pp-data-main`, `networkTimeoutSeconds: 5`, `maxEntries: 2`, 6 h, `no-cache`, statuses `[200]`.
3. `url.hostname === 'api.waterdata.usgs.gov' && url.search.indexOf('time=P7D') !== -1`: NetworkFirst, a new `pp-data-direct`, 5 s, `maxEntries: 1`. This entry holds the 11.8 MB unpacked GeoJSON, and the cap limits it to one.
4. General rule: regex `api\.water\.noaa\.gov`, plus `/api/usgs` and `api.waterdata.usgs.gov` as inline checks; `pp-data`, 4 s. The relays and the old host are removed. Predicates stay self-contained (test 2).

Existing installed clients:
- `skipWaiting` and `clientsClaim` take over at once.
- Old `pp-data` and `pp-data-main` entries stay and are never matched again. `maxAgeSeconds` (6 h) clears them on the next write to those caches. The cache names are kept on purpose, because `cleanupOutdatedCaches` only cleans the precache.
- The precache is the hashed shell. The new `index.html` (with the new CSP header) and the new JS update together.
- An already-open old tab keeps calling the old host until it reloads; the new SW does not touch those requests.

## 5. Security policy

New `connect-src`: `'self' https://api.waterdata.usgs.gov https://api.water.noaa.gov https://*.supabase.co https://potomacpulse.goatcounter.com https://*.ingest.sentry.io`.

Removed: `https://waterservices.usgs.gov`, `https://corsproxy.io`, `https://api.allorigins.win`.

No existing test pins `connect-src`; a new one does. `test/map-removed.test.mjs:52` still passes.

## 6. Non-goals and wording

No change to the estimate, model files, learning, the 48 h forecast, NWS requests, the 15 minute refresh or `P7D` / `P1D` windows (the new service gets `time=P7D`, same span). **No new visible wording** ("Live - Connected to USGS" and the banners stay as they are). Server: `scheduled-update.js` and `SERVER_VERSION` (v39.11) are not touched.

## 7. Tests (no network; mutation each must catch)

1. **Function unit** (`test/usgs-proxy.test.js`). It sets `process.env.USGS_API_KEY = 'TEST-KEY-<random>'` itself, restores it afterwards, and stubs `fetch`. Cases: each set builds the exact upstream URL and sends the key only in the `X-Api-Key` header. Mutation: put the key in the URL.
2. **Rejection**: `?url=...`, `?set=x`, `set=main&x=1`, `set=main&set=ef`, POST, no query. Expect 400 or 405 and no `fetch` call. Mutation: forward a free-form parameter.
3. **No leak**: the stub throws an Error whose message contains the key. Capture `console.*`, the body and the headers across 200, 429, timeout, 5xx and malformed; the key must be nowhere. Mutation: log `e.message` unredacted.
4. **Status map**: 429 gives 503 `upstream_rate_limited` with `Retry-After`; timeout gives 504 (fake timers); 5xx or paged or malformed gives 502; no key gives 503 and zero upstream calls. Mutation: pass the 429 through as 429.
5. **`requestDT`**: with the fixture's `timeStamp` and a fake clock far in the future, `requestDT` equals the normalised upstream value, and a missing `timeStamp` gives 502. Mutation: use `Date.now()`.
6. **Cache headers**: exact strings on 200; errors short; 400 `no-store`. Mutation: drop `Netlify-Vary`.
7. **Set tables vs `constants.js`**: same 19 gauges, same creek keys, same EF id. Mutation: remove a gauge from the table.
8. **Adapter parity** (`test/usgs-adapter-parity.test.mjs`): the shared text between `// --- BEGIN SHARED ---` and `// --- END SHARED ---` markers is byte-identical in both copies. It also executes both over `test/fixtures/usgs/par_new.json` and `ice_new.json` and the error cases (paged, no 00011, duplicate instants, unknown qualifier) and requires deep-equal output and equal error messages. Mutation: change one qualifier mapping in the browser copy.
9. **App chain** (stubbed `fetch`): function OK; function 503 then direct OK; function timeout then direct; both fail then localStorage; all fail then UNAVAILABLE; saved-copy body triggers stage 2; direct 429 is not retried. Mutation: let a 429 loop.
10. **Never calls the old host or the relays**: scan every stubbed URL in the behaviour tests, and grep `src/` for `waterservices` and the two relay names. Mutation: restore `PROXIES_LIST`.
11. **Service worker config** (`sw-runtime-caching.test.mjs`): `/api/usgs?set=main` hits the main rule with 5 s; the other sets and the direct URLs hit the general rule or `pp-data-direct`; the old host and relays match nothing; SW timeouts (5, 4) are below the page timers (6, 5); the built `dist/sw.js` test #8 follows. Mutation: set the SW timeout above the page's.
12. **Security policy**: `netlify.toml` `connect-src` contains `api.waterdata.usgs.gov` and none of the three removed hosts; the redirect exists. Mutation: leave a relay in.
13. `npm test` clears `USGS_API_KEY`; test 1-6 set their own key, so the suite does not depend on the machine's environment.

## 8. Risks and what cannot be verified without a real deploy or screen

| Risk | Guard |
|---|---|
| The function breaks the shared 1,000/hour quota | caching, 4 cache keys, rejected parameters, short negative caching, logged `x-ratelimit-remaining` |
| A gauge list drift between app and function | test 7 |
| `durable`/`stale-while-revalidate` unsupported or different | check `cache-status`; fall back to a 180 s TTL |
| The 3.1 MB body hits a limit or the localStorage quota | measure; the adapter output is smaller than the old body |
| 6 fractional digits in `timeStamp` on iOS Safari | normalised in the function; direct path falls to `unknown-body` (handled) |
| The saved copy hides a failing function | `saved-copy` classification and stage 2 |

Cannot be verified without a real deploy or screen: the sync timeout and response limit; compression; `durable` and SWR behaviour; upstream time from Netlify's region (p95 for the main set); the quota header; Workbox pass-through of 5xx; Safari date parsing; the localStorage quota with a real body; the phone render and speed.

## 9. Verification after deploy (fresh verifier; `SITE=https://potomac-pulse.netlify.app`)

```
curl -sS -o /dev/null -D - -w '%{http_code} %{time_total}s %{size_download}B\n' -H 'Accept-Encoding: br,gzip' "$SITE/api/usgs?set=creeks"
curl -sS -o /dev/null -D - -w '%{http_code} %{time_total}s\n' "$SITE/api/usgs?set=creeks"    # second: cache-status hit, faster
curl -sS -D - "$SITE/api/usgs?set=main" -o /tmp/main.json    # size < 6 MB, content-encoding, cache headers
curl -sS -i "$SITE/api/usgs?set=main&x=1"        # 400
curl -sS -i "$SITE/api/usgs?url=https://example.com"   # 400
curl -sSI "$SITE/" | grep -i content-security-policy     # new connect-src
curl -sS "$SITE/sw.js" | grep -c -E 'allorigins|corsproxy|waterservices'   # expect 0
curl -sS "$SITE/sw.js" | grep -o -E '/api/usgs|api\.waterdata\.usgs\.gov'
```
- Also check that `requestDT` in the JSON is a past timestamp, the key string is absent from every body and header, and the next three `tick_log` rows still show `src=new`.
- Owner on a phone: open the page cold, time it to the number (target under about 5 s, against 8 s or more today), open the Creeks tab (it should show levels), and confirm the visible texts are unchanged.

## 10. Versions and documents

- v39.12 in: `CLAUDE.md` (header block, "Current Model Parameters" entry, sync-list sentence: the two adapter copies plus the set tables vs `constants.js` join the list with the parity test), `index.html` meta and footer version, `src/assets/tech-appendix.md` (data sources line 778, version history, `Generated by` line 864), `src/assets/CHANGELOG.md`, `README.md` (version, test count, table row, last updated). `test/howitworks-text.test.mjs` checks agreement.
- TODO: close D5 and D9; close A1f (relays dead and removed); update D1 and D8 notes (D8 now also covers the function's key). Add D11 (`/api/usgs` live checks), D12 (the budget and cache-status measurements), D13 (Step 4 cleanup: the old-host fallbacks).

## 11. Rollout and rollback

The function can ship first because nothing calls it. Recommended: push A = function, redirect, set table, tests (version v39.12). Verify with section 9. Push B = the app, CSP, service worker rules, browser adapter (version v39.13). Both deploys avoid the top of the hour.

If the function misbehaves: the app already falls back to the direct path, so users are not stranded. Then remove the `/api/usgs` redirect (the app then gets the SPA page, a non-JSON answer, and falls to direct), or revert push B. The key can be revoked in Netlify; the hourly job's `old_nokey` path then covers it until 2027-02-22.

## 12. Open questions

1. Two pushes (A function, then B app) or one? Recommend two; the version name is the owner's call (v39.12 and v39.13, or one v39.12 deploy).
2. Is `stale-while-revalidate=30` acceptable? It makes the worst body age 150 s, not 120 s. Recommend yes, because it hides the 2 to 3 s refill from the visitor who arrives at expiry.
3. Check from the real deploy whether `durable` and compression work before B; if not, which TTL? Recommend 180 s, still well under 10 minutes.

<!-- Drafted by a Sonnet drafter (read-only) on 2026-11-17; text extracted by script from its final report, not retyped. Owner decisions already taken: option C with A as fallback. -->

---

# Rulings on the plan audit (orchestrator, 2026-11-17)

The audit is `usgs-step2-app-plan-2026-11-17.PLAN_AUDIT.md`. A ruling wins over the audit; the audit wins over
the plan.

| Finding | Ruling |
|---|---|
| 1 Cache-key bypass (encoded or case variants, the `/.netlify/functions/` address, trailing slash, HEAD) | ACCEPTED. The function accepts only a raw query string exactly equal to `set=main`, `set=creeks`, `set=ef` or `set=temp` on the exact path `/api/usgs`; everything else is 400 with `no-store` and no upstream call. HEAD is 405. Variants go into the tests and the live checks. |
| 2 Error caching too short; the hourly job could be starved of the shared quota | ACCEPTED. An upstream 429 is kept at the edge for min(max(Retry-After, 60), 300) s; 502 and 504 for 60 s; all with `durable`. The budget arithmetic is redone with error refills. In addition the function reads its key from `USGS_API_KEY_APP` when that is set and from `USGS_API_KEY` otherwise, so the owner can later give the app its own key (its own quota) without a code change. Not required for launch. |
| 3 Time limits do not compose | ACCEPTED, with these numbers: function upstream cap 5 s for `main`, 3.5 s for the small sets (request plus body); service worker 7 s (`main`) and 5 s (others); page timers 8 s and 6 s. A test requires cap + 1.5 s < service worker timeout < page timer. Worst case before the saved copy: 16 s for the main request (about 20 s today); the normal case is a shared copy answered at once or one call of 1 to 3 s. |
| 4 Old function format; Netlify stops accepting it on 2027-07-01 (as read by the auditor in Netlify's documentation) | ACCEPTED for the new function: modern format, `config.path: '/api/usgs'`, method GET, no redirect. Whether it bundles and deploys in this project is unknown until push A; if it does not, the builder reports and does not improvise. New TODO row: the three existing functions use the old format and must move before 2027-07-01 (verify the date first). |
| 5 The main set is at 72% of the 50,000 row limit | ACCEPTED: the main set is fetched as two upstream calls in parallel (flow, stage), merged before conversion; `requestDT` is the OLDER of the two `timeStamp` values; the row count per call is logged. The direct keyless stage in the app does the same. Even with every gauge on 5 minute readings each call stays under 50,000 (19 x 2,016 = 38,304). |
| 6 Test list incomplete | ACCEPTED: the builder of push B lists every test it changes; the Edwards Ferry stubs, the relay-chain tests in `data-freshness` and the new-shape stubs for stage 2 are named in the audit. |
| 7 Parity test details | ACCEPTED: unknown qualifiers are a pass-through case, not an error case; the shared-text markers edit the server adapter (comment lines only, its tests must stay green); `createRequire` loads the server copy. |
| 8 `pp-data-direct` cache | ACCEPTED: no service worker route for the direct main call. |
| 9 Clock tolerance | ACCEPTED: stated as about 7.5 minutes in the plan and the code comment; the "plus real publish lag" sentence is struck. |
| 10 Netlify limits | Noted: synchronous limit 60 s per the documentation the auditor read (the plan assumed 10 s, the safe side); 6 MB confirmed. Compression and error caching are measured after push A. |
| 11 Rollback wording | ACCEPTED: with the modern format there is no redirect to remove; rollback of push A is a revert commit, and the app falls to the direct call if `/api/usgs` answers anything but 200. The old service is not described as cover. |
| 12 Verification gaps | ACCEPTED as stated gaps: stage 2 live, error caching, `durable` across locations, `no-cache` bypass, and everything on a real screen. A desktop check with `/api/usgs` blocked in developer tools is offered to the owner as optional. |

**Rollout:** push A (the function only, v39.12; nothing calls it) is built and measured live first. Push B (the app,
service worker, security policy, browser adapter, v39.13) follows, and only after Step 1's first runs on the new
service are confirmed.

**Owner's decision, pending:** how long a shared answer is kept (the plan proposes 120 s plus a 30 s grace period).

---

# Push A: build, re-audit, fix round (orchestrator, 2026-11-17)

Built by a Sonnet builder; re-audited by a fresh Opus auditor (`usgs-step2-app-plan-2026-11-17.REAUDIT-A.md`,
verdict SHIP AFTER FIXES, no blockers). Fix round done by the builder: tests now pin timer clean-up, request
abort and partial failure of the main set; the raw request address must equal the canonical one before and after
URL parsing; unused upstream bodies are cancelled and the sibling call of `main` is aborted on the first failure;
a malformed key is logged as `key=malformed`. All six of the auditor's surviving mutations are now caught.
1,561 tests, 1,559 pass, 2 opt-in skips, identical with dummy key variables in the environment.

Live smoke by the orchestrator with the owner's key, function invoked locally (17:00 UTC): `main` 2.1 s, 2.59 MB
(125 kB gzipped), 38 series, 36,176 readings, two upstream calls of 18,088 rows; `creeks` 0.16 s; `ef` 0.15 s;
`temp` 0.15 s; two malformed addresses rejected with no upstream call.

**Owner's decision (2026-11-17, "keep"):** cache policy 120 s shared, 30 s grace, 60 s for failures, 60 to 300 s
when USGS rate-limits.

Unmeasured until the function is deployed: everything in TODO D12.

---

# Push A live (v39.12, commit 2781168, deployed 2026-11-17 17:36 UTC)

Step 1 gate: the owner pasted the job's log rows; the 17:00 UTC run shows `src: new`, `att: 1`, 4,533 ms, one row
for the hour (started 17:01:02, late after the fresh deploy). Push A was pushed after that.

Orchestrator's first timings on the live site: `set=main` 2.1 s on a miss and 0.13 s from the shared copy
(`cache-status: "Netlify Durable"; hit; ttl=117`), 75 kB on the wire with brotli; `set=ef` 1.0 s then 0.11 s.

Independent live check by a fresh verifier (Opus, public requests only, 21 requests to `/api/usgs`):

| Check | Result |
|---|---|
| Version v39.12 live, commit agrees | PASS |
| Four sets: structure, gauge ids (19 for main; the 4 creeks; Edwards Ferry; temperature), ascending times, newest reading at most 1.1 h old, `requestDT` 8 to 41 s old | PASS. Sizes wire / unpacked: main 125,900 / 2,710,041 bytes (gzip; 75 kB with brotli), creeks 2,793 / 57,232, ef 567 / 7,225, temp 1,207 / 21,072 |
| Shared copy: second request served by "Netlify Durable" with the same `requestDT` | PASS |
| Rejections | PASS except as noted: encoded, case, duplicate, empty, missing and free-form parameters and the trailing slash answer 400 with `no-store`; `/api/usgs/x` and both `--path-as-is` dot paths answer 404 at the edge; the direct function address answers 404 |
| A client `Cache-Control: no-cache` does not bypass the shared copy | PASS |
| The app is unchanged (service worker has no `/api/usgs`; the bundle mentions it only in changelog text) | PASS |
| Hourly job unaffected | PASS |
| No key material in any header or body | PASS |

Three behaviours differ from the plan's wording and are ACCEPTED as they are (ruling): (1) `?set=main&x=1` is
answered with the shared copy of `set=main` while one exists, because the copy varies only on `set`; the function
is not invoked, no quota is spent, and on a cold cache the function rejects it (the cold-cache case was not tested
live). This is the intended effect of the vary rule: an added parameter cannot force an upstream call. (2) HEAD is
answered from the shared copy. (3) POST gets Netlify's own 404 page, not the function's 405, because the function
is registered for GET only. The plan's "never data" wording is corrected to "never an upstream call".

Still unmeasured (TODO D12): the 30 s grace period, whether failure answers are kept at the edge, a failure at
revalidation replacing a good copy, the shared copy across Netlify locations, the remaining-quota header in
production, and upstream time for `main` from Netlify's region beyond the single 2.1 s observation.

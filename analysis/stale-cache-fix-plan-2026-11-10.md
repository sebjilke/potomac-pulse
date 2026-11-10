# Stale-cache fix plan (A1, audit finding 5), v39.1

Date: 2026-11-10. Status: REVISED after independent audit (rev 2). FINAL SPECIFICATION. Nothing implemented yet.
Sources: `analysis/pulse-audit-2026-10/REPORT.md` finding 5; reader notes `understand-sw.md`, `understand-freshness.md`; plan audit (17 findings, all answered in section 9). Load-bearing facts checked in code: vite.config.js:30-51, fetch.js:169-231 (processData), 280-298 (fillMissingData), 380-460 (fetchData, fetchUSGS), 544-578 (updateStalenessDisplay), constants.js:21, store.js:36-37, init.js:58 and 99-106, main.js:52-61.

Sections 2 to 7 are the whole spec. An implementer needs no other document except the code.

## 1. The problem in three sentences
The service worker serves live river data with StaleWhileRevalidate (`pp-data`), so a returning visitor gets the cached USGS response first. The page sees an ordinary 200, stamps `lastFetchTime = Date.now()`, and prints "Updated just now" although the readings can be hours old. On a rising river that is a safety problem, and the page stays one 15-minute cycle behind afterwards.

## 2. Design decisions

### D1. Strategy and timeouts (R1, R2)
Two NetworkFirst routes, both with `fetchOptions: { cache: 'no-cache' }` and `cacheableResponse: { statuses: [0, 200] }`. The main route is listed FIRST so it wins.

| Route | Matches | cacheName | networkTimeoutSeconds | expiration |
|---|---|---|---|---|
| main | direct `waterservices.usgs.gov` URL with `period=P7D` and `parameterCd=00060,00065` (the one multi-site call, fetch.js:386; grep confirms no other caller uses P7D) | `pp-data-main` | 8 | maxEntries 4, maxAgeSeconds 21600 |
| general | existing `pp-data` predicate, unchanged (proxies, creeks, Edwards Ferry, water temp, NWS) | `pp-data` | 4 | unchanged (32, 21600) |

- Why two timeouts (audit PA-1): the page budgets differ. The main direct call has a 10 s page timer (fetch.js:394). Every other river call, including all proxy calls, has 5 s (fetch.js:411, :308, edwards-ferry.js:26 and :75). A SW timeout must fire before the page timer, or the page gives up first and the cache fallback can never reach it. 8 s leaves 2 s of margin on the main call. 4 s leaves 1 s on the rest. Measured TTFB of the main call is about 1 s (3 runs, 0.93 to 1.02 s) with a 2.9 MB body, so 8 s is 8x the normal header time and 4 s is 4x.
- Proxy URLs carry the USGS URL URL-encoded in the query, so the main predicate (which tests `url.hostname` and the plain `url.search`) does not match them. They stay on the 4 s route.
- Why the separate cache name `pp-data-main` for the main route: Workbox keeps one expiration instance per plugin, and two routes sharing one cache name is unverified territory. A separate name avoids it and also fixes a pre-existing gap: the 2.9 MB main entry can no longer be evicted by NWS URL variants filling `pp-data` (maxEntries 32). Old SWR-era `main` entries stay in `pp-data` unused until they age out; no one-time `caches.delete` (extra scope). Consequence: a returning visitor has no offline fallback for the main call until the new worker has fetched it once online. This is accepted: it is one online load, and the old entry could be hours old anyway.
- Predicate constraint: Workbox `generateSW` serialises `urlPattern` functions with `toString()`. Both predicates must be self-contained (inline regex or string checks, no imported helper, no closure over module variables).
  Main predicate (spec): `({ url }) => url.hostname === 'waterservices.usgs.gov' && url.search.indexOf('period=P7D') !== -1 && url.search.indexOf('parameterCd=00060,00065') !== -1`.
- Why `no-cache`, with the real cost (audit PA-10): USGS sends `Cache-Control: max-age=900` and no ETag or Last-Modified. Without `no-cache` the browser HTTP cache can answer the "network" request with a body up to 15 min old and no network call, which is the exact problem on a rising river. Cost: every request is a full download (about 2.9 MB for the main call, not a conditional request), and page reloads within 15 min lose the HTTP cache hit they get today. Kept, because R1 says network-first and a 15-min invisible age is the harm being fixed. Pinned by test. Unverified: whether the `no-cache` request header is handled cleanly by both CORS proxies.
- Workbox timing facts (verified in workbox-strategies 7.4.1): the timeout races response HEADERS only. After a timeout the cache entry is returned (a cache miss waits for the network instead) and the network request keeps running and refreshes the cache. A thrown fetch falls back to cache. A non-2xx Response (proxy 502, USGS 503) is returned as-is with no cache fallback; the page then tries the next proxy and finally its own localStorage copy (fetch.js:424-433).
- Rejected: NetworkOnly for river data (breaks R2). Rejected: one global 8 s (breaks the proxy and 5 s paths). Rejected: purging old entries (see above).

### D2. pp-api: OUT (stays StaleWhileRevalidate, unchanged)
- The route regex matches only `/.netlify/functions/sync-learning`. The client's main learning reads use `SYNC_API = '/api/sync'` (constants.js:21, Netlify rewrite), which matches neither cache. The correction bins, pending predictions and EF correlation behind the Great Falls number are never SW-cached today.
- pp-api only serves two admin panel reads (learning-ui.js:556-557). No displayed river number depends on them, so they cannot mislead a visitor about river state.
- Rejected: making pp-api network-first "for consistency". It changes nothing a visitor reads and adds risk.
- Follow-up (TODO, not done here): the `/api/sync` mismatch means the June plan's claim "offline user sees last learned estimate" is false for corrections. If someone later widens the regex to `/api/sync`, SWR there WOULD mislead and must be network-first. Add a code comment at the pp-api route saying so.
- The main.js:52-55 comment claims the learning payload is SW-cached and that "SWR converges to fresh within one cycle". That is false for `/api/sync` (never SW-cached). Correct that comment in this change (audit PA-14) and reference it in the TODO follow-up.

### D3. What "reading time" means (R3, R4)
Definition: per-gauge reading time is the time of the value `processData` actually uses for that gauge's discharge. Page-level reading time is the OLDER of Little Falls (`01646500`) and Point of Rocks (`01638500`).

Single source of truth (audit PA-3): the rule lives in `processData` only, so there is no second implementation that can drift. For each `00060` series, `processData` already reads `ts.values[0].value` and takes the LAST element as the current value. It now also records `data[s].readTime` (ms, from `Date.parse(dateTime)`), by exactly its existing branches:
1. Latest value valid (`n > 0 && n < 9999999`): `readTime` = latest `dateTime`.
2. Latest value is a sentinel (`n <= -999999`) or carries a real `Ice` qualifier, and the backward search finds a valid earlier value (the existing ice fallback at fetch.js:198-211): `readTime` = that earlier value's `dateTime` (equal to `lastValidTime`), UNLESS the latest value carries a real `'Ice'` qualifier, in which case `readTime` = the latest `dateTime` (the gauge is reporting; it is saying "ice"; `iceAffected` already marks it).
3. Ice branch, no valid value found: `readTime` = latest `dateTime` only if the latest carries a real `'Ice'` qualifier (`iceLongTerm`), else undefined.
4. Any other latest value (zero, NaN, negative non-sentinel): `readTime` undefined.
Ice rule, in words: only a value carrying the literal `'Ice'` qualifier counts as a fresh report when the discharge number is unusable. A bare `-999999` sentinel (Eqp, Mnt, Ssn, Dis equipment or seasonal gaps, which processData lumps in with ice at fetch.js:192) never counts, so a broken gauge that keeps transmitting sentinels ages visibly. Reason in code: the label must describe the value the page shows, and for a sentinel the page shows the older valid value or nothing.
- `fillMissingData` must NOT set `readTime`. It estimates missing non-LF gauges, including PoR, from LF (fetch.js:289-291); an estimated PoR has no reading time and counts as missing.
- A series with unparseable `dateTime` yields `readTime` undefined.
- `processData` ends by calling `setLastReading(readingFromData(data))`, and its early return (`!json?.value?.timeSeries`) calls `setLastReading(null)`. The `!usgsJson` branch of `fetchData` (about :442-447) also calls `setLastReading(null)`. Because the call is inside `processData`, the live, SW-fallback and localStorage payloads all go through the same path, and a test can drive it by calling `processData` on a fixture.
- `readingFromData(data, ids = ['01646500','01638500'])` is pure (in `data-freshness.js`): returns `{ ms, lf, por }`, `lf` and `por` the per-gauge `readTime` or null, `ms` = min of the non-null ones, null if both are null.
- Deviation from the literal R3 wording (audit PA-17), stated openly: R3 says "the newest observation timestamp in the gauge data the page is actually showing". We use the older of LF and PoR instead of the newest of all gauges, because the GF estimate cannot run without both (great-falls.js:327-339), so the older one is the honest age of the headline number, and one live creek must not hide a dead LF. This is recorded in the CHANGELOG and the Tech Appendix entry. Known gap: Edwards Ferry carries up to about 40% ensemble weight at high flow and is the sole input when LF or PoR is ice-affected, and its freshness is not in the label. Logged as a TODO follow-up.
- Rejected: the localStorage `timestamp` (save time, poisoned by an SW-stale 200).
- `lastFetchTime` stays: the Learning tab "Last fetch" row uses it (learning-ui.js:363). It is now used for the label only to pick wording (D4), never as the age.

### D4. Label states, thresholds, wording (R3, R4)
Pure function `describeFreshness({ readingMs, lfMs, porMs, fetchMs, now, online, source })` returns `{ text, className, title }`. It reuses the `lastUpdate` element and the four existing CSS classes (`fresh`, `recent`, `old`, `stale`). No CSS change.

Age = `now - readingMs` in minutes (floored to whole minutes for banding, see D5 for clock skew).

Bands (constants exported from the module so tests import them):

| Reading age | Class | Colour meaning |
|---|---|---|
| under 120 min | fresh | normal |
| 120 min to under 180 min | recent | amber |
| 180 min to under 360 min | old | orange |
| 360 min or more | stale | red |

- Why 120, not 90 (audit PA-4): the label age is lag at fetch time PLUS drift until the next refresh. Measured today: LF 54 min, PoR 49 min, several gauges 74 min at fetch time. 75 min lag plus 15 min drift reaches 90 in normal operation, and the older-of-two rule widens it. 120 min covers lag up to 75 plus a full 15-min cycle plus one missed cycle. Reasoned, not measured over 24 h: the post-deploy lag sample is on the checklist (section 6).
- 180 and 360 reuse the existing escalation steps. They are NOT linked to any cache max age: the cache does not bound age at serve time (see section 5, PA-7).

Age formatting (audit PA-5): never round down across a band.
- under 60 min: `Nm` (`42m`).
- 60 min to under 6 h: hours and minutes `Hh Mm`, minutes omitted when 0 (`1h 59m`, `2h`, `5h 59m`).
- 6 h to under 48 h: whole hours, floored (`7h`). Floor cannot cross a band here because the whole range is the red band.
- 48 h or more: whole days, floored (`2d`, `9d`).

Wording depends on context (audit PA-6). Inputs: `online`, `source` (`live`, `cached`, `stale`, `unavailable`), `fetchAgeMin` = minutes since `fetchMs`. Constant `RECENT_FETCH_MIN = 20`.
- Normal text by band: fresh and under 2 min: `Latest reading just now`; fresh otherwise: `Latest reading 42m ago` (or `1h 5m ago`); other bands: `Readings 2h 5m old`.
- Branch A, saved copy: `online` is false OR `source` is `cached` or `stale`. Text prefix `Saved copy: ` and the rest lowercased from the normal text (`Saved copy: latest reading 20m ago`, `Saved copy: readings 7h old`). Class never better than `recent`.
- Branch B, stalled refresh: source live, online, `fetchAgeMin > RECENT_FETCH_MIN`, and the band is `recent` or worse. Normal text plus `, not refreshed since HH:MM` (local time of `fetchMs`). Class is the band class.
- Branch C, live and current: source live, online, `fetchAgeMin <= RECENT_FETCH_MIN`. Normal text. If the band is `stale` (6 h or more) append `, no newer gauge reports`. This wording states what is on screen, not a cause; "gauges may have stopped" is removed because a frozen background tab, a stalled refresh, an old SW entry or a localStorage fallback produce the same age. Known limitation: if the SW serves an old entry after a thrown fetch while the browser says online, branch C still applies. The early refetch (D6) and the 60 s redraw limit how long that lasts.
- Visible missing-gauge note (audit PA-11): if exactly one of `lfMs`, `porMs` is null, append `, Little Falls missing` or `, Point of Rocks missing` to the text (after any other suffix) and force the class to at least `recent`. A missing PoR is estimated from LF, so the headline number depends on an estimate while the label would otherwise be green. If both are null see D5.
- Ice: if the implementer finds no visible ice indicator in the UI for an `iceAffected` gauge (grep `iceAffected` in src), append `, ice-affected` to the text for that gauge. Otherwise leave it, because the ice state is already shown.
- `title` attribute: `Little Falls reading: <local date time or none>. Point of Rocks reading: <...>. Fetched: <local time>. Source: live|saved copy.` The fetch time appears only here and in branch B. Both gauge times shown (audit PA-17).
- Offline events (audit PA-13): `online` is an input, so the label must redraw when connectivity changes. Add `window.addEventListener('online', updateStalenessDisplay)` and the same for `offline` in `src/init.js` next to `initOfflineBanner()` (init.js:58), so the label and the offline bar cannot disagree for up to 60 s.
- Rejected: the word "Updated" (claims the app did something; the reading is what matters). Rejected: red for any age over 60 min (normal lag would look like a fault, violates R3).

### D5. Missing, unparseable or future times
- Both `lfMs` and `porMs` null (no usable reading time): text `Reading time unknown`, class `stale`, title says the payload had no usable timestamp. Never fall back to fetch time.
- One null: use the other, with the visible note from D4.
- `readingMs` ahead of `now` by up to 5 min: age 0, silent. Ahead by more than 5 min: age 0, text unchanged, title appends `Device clock may be wrong`. Never a negative age, never red.
- Known limitation, not detectable: a device clock running AHEAD of true time inflates the age and can show false amber or red. Server Date is unreadable on CORS responses (USGS sends no Access-Control-Expose-Headers).
- No payload at all (`unavailable`, `lastFetchTime` null): existing `No data` behaviour kept.

### D6. Early refetch after a fallback (audit PA-2)
After a timeout fallback, Workbox stores the fresh response a few seconds later, but the page would not refetch for 15 minutes. So:
- Pure helper in `data-freshness.js`: `shouldEarlyRefetch({ readingMs, now, online, source, early })` returns true only when `!early`, `online`, `source === 'live'` and the reading age is at least 120 min (the amber boundary).
- `fetchData` gains an optional argument `{ early = false } = {}` (callers today pass none: main.js:57, init.js:99 and :106). At the end of a successful fetch, if `shouldEarlyRefetch(...)` and no early timer is pending, schedule `setTimeout(() => fetchData({ early: true }), 60000)`. An early run never schedules another, so there is at most one extra fetch per 15-min cycle, and no loop.
- Cost, corrected by section 11: if a gauge is genuinely down for hours, the direct body is a live answer (its requestDT is at most 10 min old), so no early refetch is scheduled and there is no extra download, provided the direct call answers in time and the device clock is within 20 min of USGS time. Otherwise (a saved copy, an unknown body time, a fast clock, a persistently slow network) the chain and the early refetch run at most once per reading time per 60 min (section 11, B-2).
- Implementer checks whether `fetchData` has an in-flight guard; if it does not, the early timer must not start a run while another is in progress.

## 3. File-by-file change list
1. **NEW `src/ui/data-freshness.js`** (pure, no DOM, no top-level browser access, same pattern as offline-banner.js). Exports: band and threshold constants, `readingFromData`, `describeFreshness`, `shouldEarlyRefetch`, and an internal age formatter (export it for tests).
2. `src/state/store.js`: add `export let lastReading = null;` and `setLastReading(v)` next to lastFetchTime (store.js:37, 96).
3. `src/data/fetch.js`:
   - `processData`: record `data[s].readTime` for `00060` series by the D3 rules; at the end call `setLastReading(readingFromData(data))` (after `fillMissingData`, which must not set `readTime`); early return calls `setLastReading(null)`.
   - `fetchData`: `!usgsJson` branch calls `setLastReading(null)`; add the `{ early }` option and the D6 scheduling after `processData(usgsJson)`.
   - Rewrite `updateStalenessDisplay` to call `describeFreshness` with `lastReading` (ms, lf, por), `lastFetchTime`, `Date.now()`, `navigator.onLine`, `dataSource`, then set `textContent`, `className` (`last-update ` + class) and `title`. Keep the `No data` branch. Update the JSDoc (it says "since the last successful fetch").
   - Do NOT change fetch order, timeouts, `saveToCache` or `loadFromCache`.
4. **NEW `config/runtime-caching.mjs`**: exports the `runtimeCaching` array in this order: pp-api (unchanged, plus the comment from D2), main route, general route (D1).
5. `vite.config.js`: `import { runtimeCaching } from './config/runtime-caching.mjs'` and use it in `workbox.runtimeCaching`. Update the header comment (it says stale-while-revalidate). No inline `urlPattern` may remain. Nothing else.
6. `src/init.js`: `online` and `offline` listeners (D4).
7. `src/main.js`: correct the comment at :52-55 (D2). The 60 s redraw at :61 stays.
8. No change: `netlify/functions/**`, CSP (`netlify.toml`), `package.json` dependencies, `sync-learning` routes, CSS.

## 4. Tests to add (R5)
Every test below must fail if the fix it guards is reverted. Implementer proves this by reverting each guarded piece once and showing red.

**`test/data-freshness.test.mjs`** (node:test, runs in `npm test`, no dist needed)
Per-gauge reading time, driven through `processData` on small fixtures (audit PA-3, PA-15), then `readingFromData`:
1. Older-of rule: LF latest 10:00, PoR latest 09:15 gives `ms` = 09:15, `lf` 10:00, `por` 09:15.
2. Eqp sentinel: latest value `-999999` with qualifier `Eqp`, older valid value 3 h earlier: `readTime` is the older time (not the sentinel time).
3. Ice rule: latest `-999999` with qualifier `Ice` and an older valid value: `readTime` is the latest (ice report) time. Bare `-999999` with no qualifier and no valid value: `readTime` undefined. `Ice` qualifier, no valid value in window: latest time.
4. Latest value zero or NaN: `readTime` undefined.
5. Parity: for the same fixtures, assert the gauge's `data[s].q` is the value from the `readTime` instant (the page-shown value and the reading time agree), including the Eqp and Ice cases.
6. Mixed UTC offsets around a DST change (`-04:00` last element, `-05:00` earlier): `readTime` equals the parsed instant of the LAST element, not a string comparison.
7. Empty `value` array: undefined. A second `values[]` block with newer times is ignored (processData reads `values[0]` only). An unparseable `dateTime` in the last element: undefined, and a fixture with unparseable earlier elements still reads the good last element.
8. `fillMissingData` does not set `readTime`: PoR absent from the payload, estimated from LF, yields `por: null`.
Label logic, pure (`describeFreshness`):
9. Bands and format: ages 10, 75 and 89 min fresh with `Latest reading Nm ago`; 119 min text `1h 59m`, fresh; 120 min `Readings 2h old`, recent; 179 recent; 180 old; 359 min text `5h 59m`, old (never `5h`); 360 min `7h`-style, stale; 2 d `2d`, stale; 9 d `9d`, stale.
10. Normal lag plus drift stays fresh (PA-4): reading age 90 min with fetchTime 15 min ago reads fresh.
11. The core regression: `fetchMs = now`, `readingMs = now - 5 h`, live, online: text contains `5h` and not `just now`, class old. Fails if the label goes back to fetch time.
12. Branch A: offline with a fresh 10-min reading: text starts `Saved copy:`, class not `fresh`. Same for `source: 'cached'` and `'stale'`.
13. Branch B: reading 7 h old, fetch 7 h ago, live, online: text contains `not refreshed since` and a `H:MM` time, and does NOT contain `no newer gauge reports`.
14. Branch C: reading 7 h old, fetch now, live, online: text contains `no newer gauge reports`, class stale.
15. Missing gauge (PA-11): `porMs` null, `lfMs` 40 min ago: text ends with `Point of Rocks missing`, class at least `recent`. Same for LF. Both null: `Reading time unknown`, stale, never uses fetchTime.
16. Future time: 2 min ahead gives age 0 and no negative number; 20 min ahead: title contains `Device clock may be wrong`.
17. `shouldEarlyRefetch`: true for live, online, age 120 min, `early` false; false when `early` true, when offline, when `source` is `cached`, and when age is 119 min.
18. No em-dash in any string the module returns (house rule), checked across a grid of inputs.
Wiring (audit PA-8), importing `fetch.js` under Node with the localStorage shim as in `test/characterization/harness.mjs`:
19. Stub `globalThis.document.getElementById` to return a plain object for `lastUpdate`. Set `lastFetchTime = now`, `lastReading = { ms: now - 5h, ... }`, call `updateStalenessDisplay()`, assert the element text shows 5 h and not `just now`. Fails if `updateStalenessDisplay` goes back to `lastFetchTime`.
20. Call `processData(fixture)` with timestamps 5 h old and assert the store's `lastReading.ms` is set from the payload (and is null after `processData({})`). Fails if the `setLastReading` call is dropped.
21. Structural source assertions (as in `system1-removed.test.mjs`), as a belt-and-braces layer: `fetchData` sets `setLastReading(null)` in the `!usgsJson` branch and references `shouldEarlyRefetch`; `updateStalenessDisplay` body references `lastReading` and not `lastFetchTime` as the age base; `init.js` registers `online` and `offline` listeners that call `updateStalenessDisplay`.

**`test/sw-runtime-caching.test.mjs`**
1. Structural (audit PA-9a): `vite.config.js` imports `runtimeCaching` from `./config/runtime-caching.mjs` and contains no inline `urlPattern`.
2. Serialisation trap (audit PA-9b), no build needed: for every route, rebuild the predicate in isolation with `new Function('return (' + String(route.urlPattern) + ')')()` and run all URL-match assertions on that copy.
3. Matching: the main P7D USGS URL (`https://waterservices.usgs.gov/nwis/iv/?sites=...&parameterCd=00060,00065&period=P7D&format=json`) is matched by the FIRST matching route, which is the main route: `handler === 'NetworkFirst'`, `cacheName === 'pp-data-main'`, `networkTimeoutSeconds === 8`. A creek URL (`period=P1D`), the Edwards Ferry URL, the water-temp URL, an `api.allorigins.win/raw?url=...` URL, a `corsproxy.io/?...` URL (including one that wraps the encoded P7D URL) and `https://api.water.noaa.gov/...` match the general route: `NetworkFirst`, `pp-data`, `networkTimeoutSeconds === 4`.
4. Budgets (PA-1): each timeout is pinned below its page budget: main 8 < 10, general 4 < 5. Reverting to SWR fails the handler assertion; setting 12 or 8 on the wrong route fails the bound. Comment in the test cites fetch.js:394 and :411 and the measured TTFB (about 1 s, 2.9 MB body).
5. `fetchOptions.cache === 'no-cache'` on both river routes (catches a revert of the HTTP-cache fix).
6. Map tiles and `/api/sync` URLs match no route (documents D2 and the tile exclusion).
7. The pp-api route still exists, is StaleWhileRevalidate, and matches `/.netlify/functions/sync-learning` (pins D2 so scope does not drift silently).
8. Built output: if `dist/sw.js` exists, first compare mtimes; if `dist/sw.js` is older than `config/runtime-caching.mjs` or `vite.config.js`, FAIL with the message `dist/sw.js is stale, run npm run build first` (audit PA-9c). Otherwise assert on the handler constructor adjacent to each `cacheName`, not on a whole-file substring (pp-api still contains `StaleWhileRevalidate`): the constructor adjacent to `cacheName:"pp-data-main"` is `NetworkFirst` with `networkTimeoutSeconds:8`; adjacent to `cacheName:"pp-data"` is `NetworkFirst` with `networkTimeoutSeconds:4`; adjacent to `cacheName:"pp-api"` is `StaleWhileRevalidate`. The current minified shape is `e.registerRoute(({url:e})=>/.../.test(e.href),new e.StaleWhileRevalidate({cacheName:"pp-data",...}),"GET")`; implementer re-reads the real dist/sw.js after the build and writes the assertion against it. If `dist/sw.js` is absent: `t.skip('dist/sw.js absent')`.
- Gap: Netlify runs `npm test` before `npm run build` (netlify.toml:13), so test 8 skips there; tests 1 to 7 do not need a build and do run there. The implementer runs `npm run build && npm test` and shows test 8 executed, not skipped. Do not reorder the Netlify command (out of scope).

Existing suites must stay green (model, parity, characterization). Test count in docs comes from the real run.

## 5. Side effects and risks
- **Cache expiry does NOT bound served age (audit PA-7, corrects the earlier draft and the June SW plan).** `ExpirationPlugin` decides freshness from the response `Date` header, which a page-side SW cannot read on a CORS response (USGS sends no Access-Control-Expose-Headers, verified), so the entry is treated as fresh. `expireEntries` runs in the background, so an entry of any age can be served once before it is deleted. The label therefore handles multi-day ages (`2d`, `9d`, tests 9). Correct the "bounded at 6 h" claim in this plan, the CHANGELOG entry and the addendum to `analysis/service-worker-offline-plan-2026-06-23.md`.
- **Old cache entries:** SWR-era `main` entries sit unused in `pp-data` (the main route has its own cache now). General-route entries stay as fallback and are labelled by payload age.
- **Slow networks (audit PA-16, precise):** the SW timeout races response HEADERS only. Slow headers (over 4 s general, over 8 s main) return the cache entry and the network request finishes in the background. A slow BODY after fast headers is bounded by neither the SW timeout nor the page timer (`fetchWithTimeout` clears its timer when headers arrive), so on a weak mobile link the 2.9 MB body now makes the page wait where SWR answered instantly. Accepted trade, and the safe direction: the page shows the new data or a visibly old label, never an invisibly old one.
- **Fallback lag after timeout (audit PA-2):** handled by D6 (one early refetch about 60 s later). Residual lag at most about 60 s plus the fetch time.
- **Proxy failures:** a proxy 5xx is passed through, not cached-over (D1). The page chain (direct, allorigins, corsproxy, localStorage) is unchanged. A localStorage copy saved after an SW-stale 200 is stamped "now", so `loadFromCache` may report it fresher than it is. The label is immune (payload time); only the status-dot "cached vs stale" split can be off. Left alone, TODO.
- **First load after deploy:** `skipWaiting` and `clientsClaim` apply, but a returning visitor's first load still runs the old SWR worker once; the new worker takes over on the next load or update check. Expect up to one session of old behaviour. The new label code ships in the app bundle, which the old SW precache serves only after update, so the label fix and the SW fix reach a visitor together.
- **Status text:** "Live - Connected to USGS" (fetch.js:497-501) is also set for an SW-served stale body. Out of scope; TODO follow-up so the header label is not the only honest indicator.
- **Edwards Ferry freshness** is not in the label (D3). TODO follow-up.
- **Extra traffic:** `no-cache` makes every main request a full 2.9 MB download. During a real gauge outage there is no extra download when the direct call answers in time and the device clock is right (section 11); in the other cases the chain (two proxy downloads and one early main call, about 8.7 MB) runs at most once per reading time per 60 minutes.
- Estimation, learning, server and CSP untouched. Parity and characterization tests should be unaffected; run them.

## 6. Unverified gaps (cannot be confirmed without a real browser)
- That the built SW actually serves the cache after a timeout (4 s general, 8 s main), and the network result after a fast response. Unit tests pin the config and the built string, not Workbox runtime behaviour.
- That `cache: 'no-cache'` defeats the USGS `max-age=900` header through the SW, and that both proxies accept it.
- Offline open of the installed app (R2) with last-known data and the `Saved copy:` label. Needs DevTools Application > Service Workers > Offline. Note the first online load after deploy must populate `pp-data-main` before offline fallback exists for the main call.
- Throttled 3G behaviour around the 4 s and 8 s boundaries, and the one-load delay after deploy for a visitor holding the old worker.
- Real lag distribution. 120 min is reasoned from the measured 49 to 74 min lag plus 15 min drift, not from a 24 h sample. Post-deploy: sample LF and PoR lag over at least 24 h at random cycle phases and confirm the 99th percentile of lag plus drift is under 120 min, or raise the boundary.
- Known limitation: a device clock ahead of true time cannot be detected (D5).
- Known limitation: branch C wording can be wrong if the SW serves an old entry after a thrown fetch while the browser reports online (D4).
These are listed as UNVERIFIED in the final report. A manual browser checklist goes in the CHANGELOG entry, not claimed as passed.

## 7. Docs and version (R6): v39.1, MINOR, client-only, estimation unchanged
- `CLAUDE.md`: version `v39.0` to `v39.1` in the "Current Model Parameters" heading (line 148, the only version-bearing line); add one line on the freshness rule and network-first river data.
- `src/assets/tech-appendix.md`: new v39.1 entry in version history, naming the older-of-LF-and-PoR deviation from R3 and the Edwards Ferry gap; prepend v39.1 to the `Generated by` footer (line 755) with "Previous: v39.0 ..."; change "v16 through v39.0" (line 751) to v39.1. The v37.10 recap in the footer that mentions stale-while-revalidate is history; leave it. Grep for any other section describing the SW as stale-while-revalidate.
- `src/assets/CHANGELOG.md`: new top row `v39.1 | 2026-11-10 | ...` stating: network-first river data (8 s main, 4 s rest), label from reading time with the 120/180/360 min bands, cache expiry does not bound served age, the headers-only timeout note, the older-of-LF-and-PoR deviation, the `no-cache` cost, the early refetch, and the manual browser checklist from section 6 (not claimed as passed).
- `README.md`: Current Version line 6, "Current Model" heading line 58 if version-bearing, new row in the version table (after line 178), "Last updated" footer line 251, test count.
- `TODO.md`: A1 row (line 186) from "in progress" to done with date and a pointer to this plan. Annotate the #19 row (line 66): network-first since v39.1; the in-browser verification that row lists as pending is still pending. Add follow-ups: `/api/sync` not SW-cached (include the corrected main.js comment), "Live - Connected" status text, `loadFromCache` age stamp, Edwards Ferry freshness in the label, 24 h lag sample for the 120 min boundary.
- `analysis/service-worker-offline-plan-2026-06-23.md`: addendum that river data is now network-first (v39.1) and that the "cache expiry bounds age at 6 h" claim is false at serve time.
- All user-facing strings and docs: no em-dashes, short sentences.

## 8. Verification path (stated upfront)
1. Done: fresh Opus auditor reviewed rev 1 (17 findings). This revision answers each in section 9.
2. Implementation, then `npm run build && npm test` with SW test 8 shown as run, plus revert-and-fail proof for the guarded pieces.
3. Fresh Opus auditor given only the goal and the diff, marking each audit finding RESOLVED, PARTIAL or NOT RESOLVED.
4. A manual browser check remains an explicit unverified gap (section 6).

## 9. Audit response
Every finding id with its outcome. No finding is rejected outright. Two are accepted with a changed mechanism, and the reason is given.

- **PA-3 (blocker): ACCEPTED, mechanism simplified.** Reading time is recorded inside `processData` by its own branches (`data[s].readTime`, D3), so one rule serves display and label and cannot drift; bare sentinels never count and only a literal `Ice` qualifier counts as an ice report. This replaces the audit's separate `latestReadingTime` with a parity test: the code at fetch.js:187-218 is the only place the "current value" is chosen, so tests 2 to 5 drive `processData` and check the shown value and its time agree.
- **PA-1: ACCEPTED (option a).** Separate first route for the P7D call with 8 s, 4 s elsewhere, measured TTFB recorded, both pinned below page budgets (D1, tests 3 and 4). Added a separate `pp-data-main` cache to avoid two routes sharing one cache name.
- **PA-2: ACCEPTED.** One early refetch about 60 s later, once per cycle, never from an early run (D6, test 17).
- **PA-4: ACCEPTED.** Fresh/amber boundary moved to 120 min, with the 24 h lag sample as a post-deploy check (D4, test 10).
- **PA-5: ACCEPTED.** Hours and minutes below 6 h, floor only inside the red band (D4, test 9 at 119 and 359 min).
- **PA-6: ACCEPTED, wording changed.** Wording now depends on source, online state and fetch age (branches A, B, C). The audit's phrase "gauges not reporting" is replaced by `no newer gauge reports`, which states what is on screen without naming a cause the page cannot know (D4, tests 12 to 14).
- **PA-7: ACCEPTED.** False "bounded at 6 h" claim corrected in section 5, CHANGELOG and the June plan addendum; multi-day label tests added (test 9).
- **PA-8: ACCEPTED.** Wiring tests 19 and 20 plus structural assertions in test 21.
- **PA-9: ACCEPTED.** Structural import check, predicate rebuilt with `new Function`, mtime-based "rebuild first" failure, handler asserted next to each `cacheName` (SW tests 1, 2 and 8).
- **PA-10: ACCEPTED.** Cost restated as a full 2.9 MB download per request and lost reload cache hit; `no-cache` kept for R1 and pinned (D1, SW test 5).
- **PA-11: ACCEPTED.** Visible `Point of Rocks missing` or `Little Falls missing` note and class at least `recent` (D4, test 15).
- **PA-12: ACCEPTED.** #19 row at TODO.md:66 is annotated as well as the A1 row (section 7). The earlier claim that no `#19` text exists was wrong.
- **PA-13: ACCEPTED.** `online` and `offline` listeners call `updateStalenessDisplay` (D4, file list 6, test 21).
- **PA-14: ACCEPTED.** The main.js:52-55 comment is corrected in this change (D2, file list 7).
- **PA-15: ACCEPTED, partly moot.** Tests for mixed offsets, empty arrays, second `values[]` block and unparseable `dateTime` added (tests 6 and 7). The "string max versus time max" case is moot because no max is taken: the rule uses the last element exactly as `processData` does, and the test asserts the parsed instant. Clock-ahead listed as a known limitation (D5, section 6).
- **PA-16: ACCEPTED.** Headers-only timeout and unbounded slow body described precisely (section 5, CHANGELOG). No code change.
- **PA-17: ACCEPTED.** Deviation from literal R3 named with its reason (D3), both gauge times in the title (D4), Edwards Ferry freshness logged as a known gap and TODO (D3, sections 5 and 7).

## 10. Post-review amendments

Findings from three reviewers (correctness, service worker, tests and docs). Tests: 871 to 884, all green, also with TZ=UTC. `npm run build` ok.

- **correctness-C1: FIXED.** `updateStalenessDisplay({ ignoreFetching })` returns early while `isFetching` is true. `setStatus` passes `ignoreFetching: true` for every state except `loading`, so the final redraw after `processData` still runs. Test 31. Mutation (guard removed) fails.
- **correctness-C2: FIXED.** Test 20 now calls `setLastReading(null)` first. Verified it no longer inherits test 19 state.
- **SW-1: FIXED (client only, no SW change).** `fetchUSGS` ranks payloads with the new pure `payloadReadingMs` and `isOldPayload` (120 min = RECENT_MIN). An old direct or proxy payload does not end the chain; the newest reading wins, saved to cache and labelled live. Unknown reading time does not trigger a retry (old behaviour). Cost as first written: during a real gauge outage each cycle also hit both proxies (about 17 MB per cycle with the early refetch). Superseded by section 11: a live body with old readings is accepted without proxies. Tests 25 to 27, 28 (fresh direct skips proxies). Mutation fails.
- **SW-2: FIXED.** Suffix is now `, no newer data received` (cause-neutral). Code, test, README, CHANGELOG updated. Earlier sections of this plan keep the old wording as history.
- **SW-3: FIXED as docs only.** Both transitional effects added to the manual browser checklist in the CHANGELOG and README row.
- **SW-4: FIXED.** Test URLs are built from `GAUGES`, `CREEK_RUNS` and `EDWARDS_FERRY` using the same templates as the app (all `P1D` for the non-main calls). Test 8 now evaluates the built `dist/sw.js` with a stub Workbox and runs the real URLs through the built matchers, checking handler kind, cache name, timeout and `no-cache`. Mutation (period=P7X in dist/sw.js) fails.
- **tests-and-docs-1: FIXED.** Test 18 asserts `/[-–—]/` on text and `/[–—]/` on title; the plain-hyphen ban on the locale-dependent title is gone. Passes under `sv_SE.UTF-8`.
- **tests-and-docs-2: FIXED.** New `fetchData` tests with a fake browser (stub fetch, timers, document, navigator): one early timer at 60000 ms, no stacking across cycles, early run schedules none, none when offline or when readings are fresh. Structural test 33 pins the guard, delay and `early: true`. Mutations M34, M35 and M42 each fail.
- **tests-and-docs-3: FIXED.** Test 32 sets `navigator.onLine` false with source `live` and asserts `Saved copy:`. Mutation M43 fails.
- **tests-and-docs-4: FIXED.** Tests 22 to 24 pin: just now cutoff (1 vs 2 min), floor not round (119 s, 119.9 min), fetch age 20 vs 21 min, skew 5 vs 6 min. Constants themselves are not mutation-proven one by one; the boundary assertions cover each.
- **tests-and-docs-5: FIXED.** `index.html` title is v39.1.
- **tests-and-docs-6: FIXED.** TODO.md header v39.1, test count 884.
- **tests-and-docs-7: FIXED.** v39.1 entry added to Recently completed.
- **tests-and-docs-8: FIXED.** `.github/workflows/test.yml` gains a step `npm run build && node --test test/sw-runtime-caching.test.mjs`. Test 9 pins that step. No dependency change. Netlify untouched (it already builds after `npm test`; the built-worker test is not run there).

Still unverified (needs a real browser): see section 6. Nothing was committed.

## 11. Amendment: body time

Date: 2026-11-10. Version stays v39.1 (nothing released). Tests 884 to 908, then 913 after the review fixes below.

### Why
SW-1 (section 10) treated every payload with readings 120 min old or older as a possible saved copy and walked both proxies. The page cannot see whether the service worker answered from cache, so it guessed from reading age. Old readings have two causes: (a) an old saved body, where the proxies help, and (b) a gauge that stopped reporting, where the proxies return the same readings. In case (b) every 15 min cycle downloaded the 2.9 MB main call three times and the 60 s early refetch repeated the chain, about 17 MB per cycle while the outage lasted. The label also could not tell the two apart.

### A1. Body time
USGS iv JSON carries the server's generation time: `value.queryInfo.note` is an array of `{title, value}`, and the entry titled `requestDT` is an ISO timestamp. Checked on 2026-11-10 with one GET (`sites=01646500&parameterCd=00060&period=PT2H`): `requestDT` = `2026-11-10T18:10:32.962Z`, server clock matched the local clock to about 1 s; response header `Cache-Control: max-age=900`. `bodyTimeMs(payload, now)` in `src/ui/data-freshness.js` returns the parsed time, or null for a missing note, wrong shape, unparseable value, or a time more than 5 min in the future. Proxy shape: the page calls `r.json()` on the proxy response with no unwrapping, and both proxies are raw pass-through by design, so the field is expected to survive. This could NOT be checked live today: `api.allorigins.win` did not answer (HTTP 000) and `corsproxy.io` answered 403 `keyless_legacy_url` (anonymous legacy URLs no longer supported). That second fact matters beyond this amendment: the corsproxy.io fallback is probably dead for every visitor. Logged as a finding, not changed here.

### A2. Classification (only when readings are 120 min or older)
Body age = now minus `requestDT`.
- At most `BODY_FRESH_MIN` = 10 min: live answer, gauges behind. Accept. No proxies. No early refetch. (Changed from 20 to 10 on 2026-11-10 after review finding B-4. The first draft assumed a live answer could be up to 15 min old because of `max-age=900`. That does not apply: a live body is seconds old. See B-4.)
- Over 10 min: saved copy. Walk the proxies, keep the newest reading, allow one early refetch (SW-1 behaviour).
- Unknown: SW-1 behaviour, rate limited. Module state (not localStorage) remembers the reading time and wall-clock time of the last chain that found nothing newer than the direct payload. The chain and the early refetch are skipped while the direct reading time is the same and under 60 min have passed (`CHAIN_MEMO_MIN`). The first cycle still schedules its one early refetch; that early run sees the memo and makes only the main call.

Pure pieces: `classifyOldPayload`, `chainSuppressed`, `noteChainFoundNothing`, `clearChainMemo`. `shouldEarlyRefetch` gains `allowed` (false means a refetch cannot help). `fetchData` computes `earlyOk` in `fetchUSGS`.

### A3. Fresh readings
Readings under 120 min behave exactly as before, whatever the body time. Pinned by tests 39, 44, 52.

### A4. Label
`processData` stores `bodyMs` in `lastReading`. With old readings, a body that was more than 10 min old at fetch time makes the label use the saved-copy wording and class rules, even online with a 200. The body age is measured against the fetch time, not the redraw time, so a live body does not turn into a saved copy as the tab ages. A fresh body with old readings keeps the existing online wording. The hover text gains `Server response: <time or none>` next to the two gauge times. No new bands.

### Small additions beyond the letter of the spec
- After the chain, if the payload finally shown is a live-behind body (for example a proxy answered and the direct call failed), no early refetch is scheduled either. Same reasoning as A2.
- When a chain finds a newer reading that is itself still old, the memo is cleared (test 60 pins it). When the newer reading is fresh, the proxy loop returns before the memo code runs; no memo exists in that case, so nothing needs clearing.

### What remains unverified in a browser
- That the service worker's cached body keeps its original `requestDT` through a timeout fallback (it should: the cached Response is stored whole). Not seen end to end.
- That a Workbox network answer reaching the page inside 15 min via `no-cache` always carries a new `requestDT`.
- Proxy bodies (see A1): not checked live. corsproxy.io looks dead.
- Device clock skew: a device clock running ahead can make a live body look old (a body is only trusted as future up to 5 min).
- The 10 min threshold is reasoned from live requests (a live body is seconds old) and the 15 min refresh cycle, not sampled over a day.

### Tests
Tests 34 to 57 in `test/data-freshness.test.mjs`. Revert checks run once each, every one turned red: live-behind accept removed, 10 min boundary changed to strict, memo skip removed, memo recording removed, early permission removed, label saved-copy rule removed, future-time check removed, 60 min expiry widened, reading-time key ignored. Tests 58 to 62 were added by the review fixes below.

### Review fixes (after the amendment review)
Findings from `amend-review-behaviour.md` and `amend-review-tests.md`. Tests 884 to 913 in total; 5 new (58 to 62). Each new test was proven by reverting its behaviour once and seeing it fail.
- **B-1 / T-3 FIXED.** `consider()` in `fetchUSGS` now breaks a reading-time tie in favour of the payload with the newer body time (null counts as oldest). A saved direct copy no longer beats a live proxy body with the same readings. Test 58.
- **B-2 FIXED (deviates from the letter of A2, as the review proposed).** The 60 min memo now covers the saved-copy branch too (`cls === 'saved-copy'` shares the unknown-body path). A device clock more than 10 min fast (was 20 before B-4 moved the threshold), or a slow network that makes the service worker answer from its cache every cycle during an outage, now costs one chain (about 8.7 MB) per reading time per 60 min, not one per cycle. The label still says `Saved copy` in the fast-clock case. Test 61.
- **B-3 / T-4 FIXED (docs).** CHANGELOG, README, tech appendix and plan D6 and its extra-traffic note no longer say an outage costs nothing unconditionally. They say: no extra requests when the direct call answers in time and the device clock is within 10 min of USGS time; otherwise at most one chain per hour. Clock skew and slow network added to the unverified lists. A clock more than 5 min slow gives no body time, which also means one chain per hour.
- **B-4 RESOLVED (owner-delegated decision, 2026-11-10): `BODY_FRESH_MIN` is now 10 min.** Live checks showed `requestDT` equals the response `Date` with no shared cache, so a live body that reaches the page is seconds old; the 15 min `max-age` only affects the browser HTTP cache, which the service worker `no-cache` already bypasses. The page refreshes every 15 min, so the previous cycle's saved copy is about 15 min old. 10 separates the two. 10 min also still tolerates a device clock up to 10 min fast before a live body is mistaken for a saved copy; that mistake is bounded by the 60 min memo and only changes the wording to "Saved copy". Tests 37, 41, 42 and 49 now pin 10 versus 11 min. Test count unchanged (913).
- **B-5 FIXED.** The hover `Source:` now follows body age even when readings are fresh (old body gives `saved copy`). The label text and colour for fresh readings are unchanged, so A3 holds. Test 62.
- **B-6 FIXED (wording).** The "Small additions" bullet above now states when the memo is cleared.
- **T-1 FIXED.** New test 60: direct reading 300 min with no body time, proxy reading 200 min with no body time; the second cycle walks the chain again and shows the proxy reading. Reverting the memo clear turns it red. Old test 56 is kept; it never reached that branch (a fresh proxy returns first).
- **T-2 FIXED.** New test 59: old direct body, newer but still old proxy payload with a live body; no early timer. Reverting the post-chain rule turns it red.
- **T-5 FIXED.** The em-dash in the new TODO.md v39.1 line is now a colon.
- **Test harness.** The fetchData suites now mute console output during the run and wait on real timers in `afterEach`; stray log output from timer-fired fetches caused a rare "Unable to deserialize cloned data" failure of the whole file (about 1 run in 12 before the fix, 0 in 20 after).
- **Still unverified in a browser:** everything listed above, plus the fast-clock and slow-network cases (covered by unit tests only).

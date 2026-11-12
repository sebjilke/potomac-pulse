# Plan: Potomac Pulse v39.7, "speed and robustness" (client only, MINOR)

Status: draft for the independent auditor. Nothing was edited, built or run. Line numbers are from the repo as read today (v39.6). Where I could not verify something, it is listed at the end.

## 0. Summary of recommendations

| Item | Recommendation |
|---|---|
| 1. Startup not waiting on learning | Do. Timeout 10 s. Parallel start. New `learning:loaded` re-render. |
| 2. Refresh on wake, visible, online | Do. Threshold 10 min of server-response age. 60 s attempt gap. Deferred retry when a fetch is already in flight. |
| 3a. `period=P7D` | Do NOT change. P3D changes the winter ice behaviour, which is an estimate input. |
| 3b. Geojson on first map open | Do. Keep the service-worker precache. |
| 3c. NWS calls | Do one cut only: defer the 17 flood-category calls to the first map open. Keep all 17 forecast calls. Separable step. |
| 3d. localStorage write | Do NOT change. List as follow-up. |
| 4. No endless "Loading..." | Do. Neutral message, reason, retry button. No client estimate without Edwards Ferry. |

The service worker, `config/runtime-caching.mjs`, `vite.config.js`, `netlify.toml` and all server code are NOT touched. `SERVER_VERSION` does not change.

Corrections to the CX review (analysis/cx-review-2026-11-11.md), found while verifying:
- `NWS_LIDS` has 17 gauges, not 12 (`src/model/constants.js:160-178`).
- A refresh makes 4 USGS calls (main, Edwards Ferry, water temp, creeks), not 3.
- Startup makes 4 `/api/sync` reads (`gf`, `por-history`, `gf-history`, `forecast-accuracy`), not 5.
- "Loading EF data..." is written to `#gf-data-source`, which is `display:none` in `index.html:134` and never shown (grep: only `textContent` is ever set). What the user sees in that state is "..." in the number and stage boxes, and an empty trend line. The "Waiting for data..." text at `great-falls-ui.js:114` goes to `#gf-trend`, which is visible.
- The Edwards Ferry gauge (01644148) is not in `NWS_LIDS`, so `data['01644148'].forecast` never exists.
- CLAUDE.md bullets for v39.3/v39.4 say "`SERVER_VERSION` stays v39.2". The real constant is `'v39.6'` (`netlify/functions/scheduled-update.js:2228`).

## 1. Measured numbers

Single read-only curl of the app's own main URL (19 gauges, `parameterCd=00060,00065&period=P7D`), `Accept-Encoding: gzip`:
- Wire size 156,431 bytes. Decoded 2,905,127 bytes.
- 38 series, 36,164 points. Eight series (Point of Rocks, Broad Run, Seneca, Little Falls, each with discharge and stage) have about 2,000 points. The other 30 have about 670.
- `requestDT` is present in `value.queryInfo.note` (the v39.1 body-time rule still holds).
- Derived, not fetched: P3D would be about 15,552 points (43 percent), about 1.25 MB decoded, about 67 KB on the wire.

From `dist/` (built Nov 11 13:43, may not equal what is live; the CX review saw different hashes on the live site):

| File | Raw | gzip |
|---|---|---|
| `assets/index-BJIcCO_5.js` | 362,850 | 118,220 |
| `assets/index-DAklZDSt.css` | 33,156 | 10,513 |
| `index.html` | 68,706 | 13,312 |
| `potomac-nhd.geojson` | 301,003 | 29,103 |
| `potomac-watershed.geojson` | 4,733 | 1,565 |

Request counts from the code, per refresh:
- USGS: 4 (`fetch.js:410`, `edwards-ferry.js:26`, `edwards-ferry.js:75`, `fetch.js:324`). Plus up to 2 proxy calls when the direct payload is old.
- Learning: 1 (`/api/sync?endpoint=gf`).
- NWS: 17 category calls (`nws.js:105`) plus 17 to 68 forecast calls (`nws.js:15-41` tries up to 4 URLs per gauge in sequence; the first usually succeeds). So 34 to 85.
- Total per refresh: about 39 minimum.
- Startup adds 3 `/api/sync` reads (`por-history`, `gf-history`, `forecast-accuracy`) and 2 geojson reads.

After this plan, per refresh: about 22 (categories deferred). Startup: 2 fewer requests.

Honest size of the gain: the geojson saving on the wire is only about 31 KB gzipped. The real saving is parsing 300 KB of JSON and building SVG layers for a hidden map at startup, and (first visit) one fewer network contender. The P7D payload is the big one, and it stays (see 3a).

## 2. Item 1: startup does not wait on the learning call

### Current behaviour
`src/init.js`:
- L88 `await loadGFLearningData();` (blocks everything below).
- L93-101 `initMap(); buildBranches(); buildCreeks(); initTabs(); initAuth(); initAbout(); updateLearningUI(); renderAuditLog();`
- L104 `await fetchData();`
- L105-112 catch: `initMap(); buildBranches(); buildCreeks(); fetchData();` (this path never loads learning, so `gfDataReady` stays false for ever).

`src/main.js:57-60`:
```
setInterval(async () => {
    try { await loadGFLearningData(); } catch (e) { ... }
    fetchData();
}, 900000);
```

`src/learning/gf-learning.js`:
- L42 `const response = await fetch(SYNC_API + '?endpoint=gf');` has no timeout and no abort.
- L58-65: not ok, so `console.warn`, and `if (!gfLearningData) setGfLearningData(emptyData)`.
- L66-69: any throw (network error, bad JSON) does the same.
- L72 `setGfDataReady(true);` runs on success and on failure.

What a failure looks like today, exactly:
- First load: `gfLearningData` becomes `{correctionBins:{}, pendingPredictions:[], metadata:{...0}, efCorrelation:null}`. `gfDataReady` becomes true. The card computes the estimate with an empty correction table (correction 0 through `great-falls.js:66-67`). No divergence or residual advisory (the fields are absent). No leaderboard. No note on screen.
- Later cycles: the last good payload is kept (v37.13 comment at L60-63).
- A hang (request never answers) has no handler at all. `gfDataReady` stays false and the card sits on "...".

The card gate is `great-falls-ui.js:80-81`: `const efReady = edwardsFerryData.current !== null; if (!gfDataReady || !efReady) {...}`. So with parallel loading, if USGS arrives first the card correctly shows "..." until learning settles. No wrong number can appear.

A hole that exists today and that this change also closes: nothing emits an event when learning finishes. If learning arrived after the first `data:updated`, the card would stay on "..." until the next 15 min cycle. Also `history.js:96` only emits `por-history:healed` when `gfDataReady` is already true.

### Change
1. **Learning loader** (`gf-learning.js`):
   - Replace the bare `fetch` with a local `fetchJsonWithDeadline(url, ms)` that keeps its abort timer running until the JSON body is parsed. `fetchWithTimeout` in `fetch.js:75-90` clears its timer once headers arrive, so a stalled body would still hang. Put the helper in a new leaf file `src/data/deadline.js` (no app imports, so no import cycle).
   - Timeout: **10 s**. Reasons: (a) it matches the 10 s page timer of the main USGS call, so the card and the numbers settle in the same window; (b) typical server time is well under 2 s (five parallel selects, v37.5), so 10 s only fires when something is really wrong; (c) I recall the Netlify default for synchronous functions is 10 s and `netlify.toml` sets no override, so the platform would kill a slower call anyway (not verifiable here); (d) the CX review suggested 4-6 s, which I reject: a slow but working answer at 7 s would become an uncorrected number on the card, and the owner said the number must not change.
   - On timeout the loader behaves exactly as the existing catch at L66-69: same warn, same `emptyData` only if nothing was ever loaded, same `setGfDataReady(true)`.
   - In-flight sharing: a module-level `inFlight` promise, so two callers (startup plus a wake event, or a timer plus a retry) share one request. `resetGFLearning` (L195) passes `{ force: true }` to skip sharing, so an admin reset never reads a pre-reset in-flight answer.
   - After `setGfDataReady(true)`, `emit('learning:loaded')`.
2. **New file `src/data/refresh.js`**: `createRefresher({loadLearning, fetchData, ...})` and `export const refreshAll`. It starts the learning load and `fetchData()` in the same tick, each with its own try/catch, so neither can block or break the other. It returns `Promise.allSettled`. Both `init.js`, `main.js`, the ↻ button, the Retry button (item 4) and the wake handler (item 2) call `refreshAll`.
3. **`init.js`**:
   - Add `on('learning:loaded', onLearningLoaded)` with the other subscriptions.
   - `onLearningLoaded`: `if (isFetching) return; updateGreatFallsUI(); updateLearningUI();`. Why skipping while a fetch runs is safe: every `fetchData` path that finishes ends with `emit('data:updated')` or `emit('data:unavailable')` (`fetch.js:517`, `:527`), and both call `updateUI`, which calls `updateGreatFallsUI`. So a render with the new learning data always follows. Skipping avoids one render that would mix a new correction with the previous cycle's gauge data. (The exception path is covered by 4e.)
   - Remove `await loadGFLearningData()` (L88). Order becomes: subscriptions, buttons, local loads (`loadPoRHistory`, `loadGFHistory`, `loadShadowModelState`, `loadEFHysteresis`), `loadForecastAccuracy()` (already non-blocking), UI build (L93-101), then `refreshAll()` (not awaited by anything that builds UI). `init()` may still `await` it at the end, so errors reach the catch.
   - Catch path: replace `fetchData()` with `refreshAll()` so the fallback also loads learning and cannot leave the card at "Loading corrections" for ever.
   - Keep these existing lines, because tests read them: L62-63 `window.addEventListener('online', updateStalenessDisplay)` and `'offline'` (data-freshness test 21), and `on('data:unavailable', updateCreeksUI)` / `on('data:updated', updateCreeksUI)` (creek-level test, `test/creek-level.test.mjs:391`).
4. **`main.js`**: the interval body becomes `refreshAll()`. Remove the `loadGFLearningData` import if unused. Update the comment at L51-56.
5. **`#refreshBtn`** (`init.js:67`) binds to `refreshAll` instead of `fetchData`. A side benefit: if learning timed out at start, ↻ is a recovery path. This is one extra small request per tap; list it in the changelog.

Micro-option NOT taken: start `refreshAll()` before the UI build to overlap network with the 20-60 ms Leaflet build. It is safe in theory (responses are processed only after the synchronous build), but it makes failure ordering harder to reason about. Not worth it now.

### Edge cases
- First visit, slow `/api/sync`: header and numbers render when USGS lands; the card shows "..." until learning settles or 10 s passes.
- First visit, `/api/sync` down: card shows an estimate with empty corrections, as today. Not new.
- Learning fails on a later cycle: last good payload kept, as today (L60-64).
- Returning visit with a service-worker cache: `/api/sync` is not routed by the service worker (test 6 in `sw-runtime-caching.test.mjs`), so nothing changes there.
- Offline: learning fails at once; the card renders from cache with empty corrections, as today.
- Edwards Ferry down: unchanged here; handled by item 4.
- Ice: unchanged; the ice branches are reached only after the gate.
- Long-open tab and phone sleep: item 2.

### Must NOT change
Estimate code (`great-falls.js`, `shared-model.js`), `applyGFCorrection`, the `emptyData` shape, the keep-last-good rule, `setGfDataReady(true)` on every outcome.

### Residual risk to state plainly
If the 10 s timeout fires, the card shows a number with no learned correction until the next learning load (next 15 min cycle, a ↻ tap, or a Retry tap). This is today's failure behaviour, reached by a new route. There is no on-screen note, as today. See open question 1.

## 3. Item 2: refresh on wake, visible, online

### Current behaviour
- `fetch.js:404-406`: `if (isFetching) return; setIsFetching(true);` There is no `await` between the check and the set, so the guard is race-free in a single-threaded page. `finally { setIsFetching(false); }` at L549-551 covers every exit, including the `!usgsJson` early return (L511-519).
- The only triggers: the 15 min interval, the ↻ button, the 60 s early refetch (L531-540), and startup. No `visibilitychange`, `pageshow` or refresh-on-`online` handler exists (`init.js:62-63` only redraws the label).
- Early refetch: a single `earlyRefetchTimer`, scheduled only for source `live`, old readings, and `allowed` (body time says saved copy or unknown). The 60 min proxy-chain memo is module state in `data-freshness.js:108-131`.
- `lastFetchTime` is set to `Date.now()` in `accept()` (`fetch.js:440`) even when the payload is a service-worker saved copy. So it is not a trustworthy "last good fetch".

### Change
New pure file `src/data/refresh-policy.js` (same style as `data-freshness.js`: no DOM at module level):
- `RESUME_STALE_MIN = 10`, `RESUME_ATTEMPT_GAP_MS = 60000`.
- `lastGoodMs({bodyMs, fetchMs, source})`: returns `bodyMs` when finite (the server's own response time, `lastReading.bodyMs`); else `fetchMs` only if `source === 'live'`; else `null`. This makes a service-worker saved copy count as old.
- `shouldResumeRefresh({now, lastGood, lastAttemptMs, online, visible, fetching, force})`:
  - false if `!online`, if `!visible`, or if `fetching`;
  - false if the last attempt was under 60 s ago (unless `force`, see below);
  - true if `lastGood === null`, or the age is negative (device clock moved back), or the age is at least 10 min.

Threshold justification (10 min): USGS posts a reading every 15 min, so refetching sooner returns mostly the same numbers for a 156 KB gzip / 2.9 MB decoded download plus about 34 NWS calls. 10 min is below the 15 min timer, so a wake is never later than the timer would have been. The CX review proposed 5 min. At 5 min, a user flipping between apps would refetch the large payload very often. 60 s attempt gap bounds failure loops to one attempt per minute.

Wiring (`init.js`, once, after the existing online/offline lines; keep those):
- `document.addEventListener('visibilitychange', ...)`, `window.addEventListener('pageshow', ...)` (covers back/forward-cache restores where `visibilitychange` may not fire), `window.addEventListener('online', ...)`.
- Each handler first calls `updateStalenessDisplay()` (cheap, no network; ages the label at once), then `maybeResume()`.
- `maybeResume()` reads the store, calls `shouldResumeRefresh`, and if true calls `refreshAll()`.
- **Deferred resume** (closes a real hole): if a fetch is already in flight at wake (iOS freezes a fetch mid-flight; its promise can take up to 10 to 20 s after wake to settle), the event would be dropped and nothing would retrigger for 15 min. So when `fetching` blocks, set a module flag `resumePending`. When `refreshAll` finishes, if `resumePending` is set, clear it and re-evaluate once with `force: true` (skips only the attempt gap; the age test still applies). It cannot chain: the re-run never sets the flag again.
- Store additions (`store.js`): `lastAttemptMs` plus setter. `fetchData` sets it right after `setIsFetching(true)` (calls blocked by the guard do not count).
- `fetchData` internals are not edited for this item beyond that one line.

### Why this does not conflict with v39.1
- Same `fetchData`, same `fetchUSGS`, same `consider/accept/classifyOldPayload/chainSuppressed`. Resume only decides WHEN to call it.
- The 60 min memo (`chainSuppressed`) applies to a resume fetch exactly as to a timer fetch. A resume does not clear it.
- The pending early timer is left alone (editing it would break data-freshness test 29, which counts scheduled timers with `clearTimeout` stubbed). Worst case: a resume fetch finishes, then the pending early timer fires up to 60 s later and does one more fetch. That is one extra fetch, never a storm, and `isFetching` serialises it.
- Reading-time label logic is untouched.

### Edge cases
- Phone sleep: handled by `visibilitychange` plus `pageshow` plus deferred resume. When the radio is not yet up, the direct call times out, the service worker may answer with its saved copy (body time old), `lastGoodMs` is old, and the next event after 60 s tries again; the v39.1 early refetch also fires at +60 s.
- Offline: `online` false, so nothing runs; when `online` fires, the age test decides.
- USGS down: at most one attempt per 60 s per event; the proxy chain is suppressed by the memo after the first pass.
- Long-open visible tab: unchanged (timer). Backgrounded desktop tab: wakes on return to the tab if older than 10 min.
- Timer and wake at the same moment (browsers fire overdue timers on resume): the second `fetchData` returns on `isFetching`; learning is shared by the in-flight promise.
- First visit: handlers are registered inside `init()` after subscriptions; a wake during first load is skipped by `fetching` and handled by the deferred flag.

## 4. Item 3a: the 7-day request

### What needs more than 3 days (verified in code)
- Latest value (`fetch.js:191`): last point only.
- Sparklines: creeks use their own P1D call (`fetch.js:324`). The gauge rows have no sparkline. No other consumer of `timeSeries` exists (grep across `src`).
- Point of Rocks history (`fetch.js:235-238`, `backfillPoRHistory`): adds every point, then keeps only `POR_HISTORY_MAX_AGE` = 72 h (`constants.js:10`). The travel lookup needs at most about 50.6 h. So 72 h is enough.
- Edwards Ferry, temperature: own P1D calls.
- Server uses P2D (`test/truth-dr-handler.test.js:24`).
- **Ice lookback: the one thing that uses days 3 to 7.** `fetch.js:208-231`: when the latest point is ice-flagged, the loop `for (let i = values.length - 2; i >= 0; i--)` walks the whole 7-day series to find the last valid reading. It sets `q`, `iceAffected` and `lastValidTime`. If none is found it sets `iceLongTerm` (the comment at L224 says "2-day window", which is stale; the window is 7 days).
  - With P3D, a gauge whose last valid reading is 3 to 7 days old would change from "q = that old reading, ice-affected" to "no q, `iceLongTerm`, filled from the drainage ratio by `fillMissingData`".
  - For a tributary this changes the number fed into the estimate (`great-falls.js`, `monocacy?.q` etc.) and the tooltip text (`gauges-ui.js:176-181`).
  - For Little Falls it is worse: `estimateGreatFalls` returns null when `!lf?.q` (`great-falls.js:335-337`). LF is skipped by `fillMissingData` (`fetch.js:301`). So a 3 to 7 day LF ice episode would flip the card from an "EF-ONLY ESTIMATE" to "UNAVAILABLE".

### Recommendation
Leave `P7D`. The only saving is about 90 KB on the wire and about 1.65 MB of parse and cache-write work, and it cannot be had without changing an estimate input in winter. If the owner later wants it, the safe route is a separate small request issued only when a series is ice-flagged (a follow-up with its own plan).

### If it were ever changed (so the auditor knows the blast radius)
`config/runtime-caching.mjs:39-41` matches `period=P7D`. `test/sw-runtime-caching.test.mjs` line 33 builds `MAIN` with `P7D`. `test/data-freshness.test.mjs` lines 386, 429, 636 filter fetches by `includes('P7D')`. CLAUDE.md names the main call. All would need to change together. Not doing it, so none are touched.

## 5. Item 3b: geojson on first map open

### Current behaviour
`map.js:105-128` (`initMap`) calls `loadWatershedBoundary(mapInstance)` and `loadNHDRivers(mapInstance)` at startup. They `fetch('/potomac-watershed.geojson')` and `fetch('/potomac-nhd.geojson')` (L55, L70). The map is hidden: `main.css:83` `#map { display: none }`, `main.css:84` `body.show-map #map { display: block }`. The only code that adds `show-map` is `toggleMap` (`map.js:292-298`). `updateMapVisibility` only removes it.

What else depends on the geojson: nothing in `src` (grep: only `map.js`). Gauge-row clicks call `panTo` (`map.js:93`), which only needs the map object and markers, not the outlines.

Service worker: `vite.config.js:23` globs `geojson`, and `dist/sw.js` precaches both files with revision hashes. A lazy page fetch of the same URL is therefore served from the precache. So offline map outlines keep working, and returning visits cost no network.

### Change
- New pure helper `src/ui/map-outlines.js`: `createOutlineLoader({ fetchFn, addNhd, addWatershed })` returning `ensureOutlines()` that runs once (a second call returns the same promise; a failed load clears the "started" flag so the next open retries; failure only `console.warn`, as today).
- `map.js`: remove the two calls from `initMap`. Keep the styling functions. Add `export function ensureMapOutlines()` using the real `L` and `map`. `toggleMap` calls it when `show` is true (before or after `invalidateSize`, both fine).
- Do not touch `vite.config.js` globs. Do not remove the precache.

### Edge cases and notes
- Layer order: both layers call `bringToBack()` and arrive in whatever order the fetches resolve (already a race today). Lazy loading keeps that. If the owner wants a fixed order (watershed behind rivers), load them in sequence; I do not recommend changing it silently.
- Offline first-ever map open before the precache finished: outlines are missing, a warn is logged, and the next open retries.
- Not verified: whether Leaflet requests Esri tiles for a `display:none` map of size 0 at startup (`map.js:116`). That is a possible larger saving, out of scope.

## 6. Item 3c: NWS calls

### What is called, and what uses it
`fetch.js:542` calls `fetchNWSForecasts()` after every successful `fetchData` (after the first render, so it never delays first paint). It must run every time, because `processData` starts with `setData({})` (`fetch.js:172`), which wipes `forecast`, `trend` and `floodCategory` from every gauge. So skipping NWS on a refresh would blank the arrows.

Per refresh (`nws.js:48-61`): 17 forecast calls (1 to 4 sequential URLs each) plus 17 category calls.

| Call | Used by |
|---|---|
| Forecast, all 17 | Per-gauge trend arrows and 24h/48h text in the All Gauges tab and map popups (`gauges-ui.js:201,264,268`). |
| Forecast, Little Falls (BRKM2) | Header `lfTrend` (`gauges-ui.js:156`) and the Great Falls 48 h forecast (`great-falls-ui.js:406`). |
| Forecast, Point of Rocks (PORM2) | The 48 h forecast (`great-falls-ui.js:350`) and `por.trend`, which `great-falls.js:464` uses as the flow-state fallback when there is no observed rise rate. That reaches the estimate, so it must not be cut or delayed. |
| Flood category, all 17 | Only the marker border ring on the map (`gauges-ui.js:216`). Nothing else reads `floodCategory`. |

### Recommendation
Do: defer the 17 category calls until the first map open, and refetch them on each later cycle only if the map has ever been opened.
Do NOT: cut or defer any forecast call. The 15 non-core forecasts feed arrows on the second tab, which is a visible feature, and they run after first render, so they cost battery and data but not first-paint time. Deferring them is a possible later step with its own decision.

Do not change the Great Falls forecast inputs: Little Falls and Point of Rocks forecasts stay exactly as they are.

### Change
- `nws.js`: split `fetchNWSForecasts({ includeCategories })`, and export `fetchNWSFloodCategories()` (same code as today's category half). The default for the cycle call is `includeCategories: store.mapOpened`.
- `store.js`: `mapOpened` plus setter. `toggleMap` sets it on first show and calls `fetchNWSFloodCategories().then(() => emit('nws:arrived'))` (`nws:arrived` already runs `updateUI`, which redraws the marker rings).
- Result: per refresh about 22 requests instead of about 39 until the map is opened.

### Risk
The ring on a first map open shows white ("Normal" in the legend) for the 0 to 5 s the category calls take. Today the ring is also white from each render until NWS arrives, and white whenever the category call fails (`nws.js:112`, default `'no_flooding'`). So this is not a new kind of state, but it is a new delay on a safety-flavoured display. Mitigation: none that adds UI. Decision for the owner (question 3). Make this step last and separable.

## 7. Item 3d: the localStorage write

### Current behaviour
`fetch.js:98-109`: `localStorage.setItem(CACHE_KEY, JSON.stringify({timestamp, data: json}))`. The payload is about 2.9 million characters today. It runs on every successful live fetch, synchronously, on the main thread (stringify plus a blocking disk write), before `processData`.

Can it exceed quota? I cannot verify on a device. Browsers limit localStorage per origin (roughly 5 MB; whether the unit is characters or UTF-16 bytes differs by browser, and if it is bytes, 2.9 M characters is about 5.8 MB). So on some phones it may already fail. Not verified (open question 4, owner check).

What happens when it fails: `setItem` throws, the `catch` at L106-108 only logs "Cache save failed". The previous entry (if any) stays untouched, with its old timestamp. Later, in a USGS outage, `loadFromCache` returns that older entry and the label honestly says the readings are old (`describeFreshness`). With no earlier entry there is no fallback, and a USGS outage ends at the "No data" state (item 4). The small writes after it (`potomac_por_history` at `fetch.js:287`, EF hysteresis, creek last-ran) share the same quota and also swallow errors.

Is there a safe reduction? A trimmed copy has to keep, per series: the latest point, the last valid point when the latest is ice, and 72 h of Point of Rocks discharge. That duplicates processData's selection logic, and any mismatch changes a displayed or estimate value in a winter outage. Recommendation: **leave it**. Follow-up (own plan): store a derived compact form, or store only the last N points per series plus the ice-lookback result computed at fetch time.

## 8. Item 4: no endless "Loading..."

### Current behaviour (exact)
`great-falls-ui.js:80-93`:
```
const efReady = edwardsFerryData.current !== null;
if (!gfDataReady || !efReady) {
    "gf-cfs" -> "..."   "gf-stage" -> "..."   "gf-trend" -> ""
    "gf-data-source" -> !gfDataReady ? "Loading corrections..." : "Loading EF data..."
    ... renderCapIndicator(null); return;
}
```
- `gf-data-source` is hidden (see section 0), so the visible state is "...", "...", and an empty trend line.
- Edwards Ferry stuck: `fetchEdwardsFerry` (`edwards-ferry.js:25-65`) returns silently on timeout (5 s), non-OK, empty body, or stage outside 0 to 100. `current` stays null on a fresh page. It only recovers on a later successful fetch.
- USGS down with no cache: `fetch.js:511-519` sets `dataSource = "unavailable"`, status "error", emits `data:unavailable`, which calls `updateUI` then `updateGreatFallsUI`. If EF is also null the card shows "...". If EF is fine, `computeGFEstimate()` returns null and the card shows "Waiting for data..." in `#gf-trend` (L114) for ever. The header says "No Data" and the banner clears itself after 10 s (`fetch.js:613`).
- The ice branch (L106-112) is a deliberate message and stays.
- Existing retry control: only the header ↻ (`#refreshBtn`), disabled while loading, away from the card.
- Hidden stuck state elsewhere: if `fetchData` throws after `setStatus("loading")` (for example inside an `emit` handler, since the bus does not swallow handler errors), the ↻ button stays disabled and the dot stays "Fetching data..." for ever (`setStatus` re-enables only on non-loading states).

The client's own estimator already works without EF outside ice: `great-falls.js:476-500` falls back to `porEstimateCFS` when `estimateGFFromEdwardsFerry()` is null. The only thing blocking it is the UI gate at L81. That is the model decision the owner has not made, so the gate logic must keep requiring EF.

### Change
**4a. Pure state function** `src/ui/gf-card-state.js`:
`gfCardState({ learningReady, efReady, fetchSettled, sourceUnavailable, hasEstimate, iceIssue })` returns `{kind, text?}`:
- `!learningReady` returns `loading` ("Loading corrections..."). It always ends, because the learning load now has a deadline.
- `!efReady && !fetchSettled` returns `loading` ("Loading EF data...").
- `!efReady && fetchSettled` returns `unavailable`. Reason: `sourceUnavailable` ? "USGS data did not load." : "Edwards Ferry data did not load."
- `efReady && !hasEstimate && !iceIssue`: `fetchSettled` returns `unavailable` ("USGS data did not load." if `sourceUnavailable`, else "Little Falls or Point of Rocks readings are missing."), otherwise `loading` ("Waiting for data...").
- `iceIssue` and `hasEstimate` pass through unchanged.

**4b. Store flag** `fetchSettled` (`store.js`): set true in `fetchData`'s `finally` the first time a fetch finishes (success, no-data, or error). It never goes back to false, so a retry does not flash back to "Loading" text; the Retry button is simply disabled while fetching.

**4c. Card rendering, edited in place** in `updateGreatFallsUI` (do not extract the two early-return branches: `test/cap-indicator.test.mjs` lines 310-330 split the function body on `\n\s*return;\n` and require exactly two `renderCapIndicator(null)` calls, each in one of the first two early-return segments, plus exactly one `renderCapIndicator(gfEstimate)`). Add a call to a small `renderGFCardGate(view)` helper before each `renderCapIndicator(null)`. The helper sets, for `unavailable`:
- `#gf-cfs` and `#gf-stage`: "--"
- `#gf-estimate-label`: "UNAVAILABLE" (same wording the ice branch already uses at L107), colour `var(--text-muted)`
- `#gf-trend`: "Estimate unavailable. " + reason (plain, no cautions)
- `#gf-confidence`: "", `#gf-ci-range` hidden, forecast spans "--"
- show `#gfRetryBtn`
and for `loading` / ready: restore label "ESTIMATED NOW", reset the trend colour, hide `#gfRetryBtn`. Ready-path code already rewrites label, colour and trend, so no other branch is edited.

**4d. Retry control**: `index.html`, inside `#gf-estimate-display` after `#gf-trend`: `<button class="btn" id="gfRetryBtn" hidden>Try again</button>` (no inline handler: CSP). `init.js`: `bindButton('gfRetryBtn', refreshAll)`. `setStatus` (`fetch.js:565-573`) also disables it while status is "loading". Same 44 px target as header buttons. No new styling beyond existing `.btn`.

**4e. Optional hardening (separable, small)**: in `fetchData`'s `finally`, if the last status set was "loading" (an exception skipped the final `setStatus`), re-enable `#refreshBtn` and remove its `loading` class. I recommend only the button release. Changing the dot text there could mislabel the state.

### Not done (model decision, one paragraph for later)
Today the server (`netlify/functions/scheduled-update.js:901-940`) takes the Edwards Ferry stage from `ef?.h`. If it is missing or outside `EF_MODEL.minStage..maxStage` (2.5 to 20 ft), `useEfEnsemble` stays false and `estimatedCFS = porEstimateCFS`: the estimate becomes PoR plus tributaries (with the PoR-delta correction) and then the same end-applied correction, and the cron still stores and learns from it. The same happens when EF and PoR disagree by more than 50 percent (L930-936). The client has the same fallback in `great-falls.js:476-500`; only the card gate at `great-falls-ui.js:81` stops it from being shown. Letting the client show that PoR-only number is a one-line gate change plus a decision about wording and confidence, and it is out of scope. Also note: when EF is the stale one, the client has no age check on `edwardsFerryData.current` (a failed later fetch keeps the old value).

### Edge cases
- First visit, everything slow: "..." until the fetches settle. Then either a number or the message.
- USGS up, EF down: message "Edwards Ferry data did not load." plus Try again; the rest of the page (header, creeks, gauges) is live.
- USGS down, cache exists: unchanged; a number from the saved copy (this is the CX F3 issue, not in scope).
- USGS down, no cache: message "USGS data did not load." plus Try again. Header already says "No Data".
- Learning API down or slow: unchanged text; after the deadline the card renders uncorrected (section 2).
- Ice: unchanged (the ice message). If EF is also null, the new message (reason: Edwards Ferry).
- Retry during an outage: button disabled while fetching, re-enabled by `setStatus`.
- A computed estimate is never replaced by the message.

## 9. Sequence of small steps (the app works after each)

1. Baseline: run `npm test`; record the count (TODO.md says 1223 at v39.6).
2. Add the pure files and their tests only, no wiring: `src/data/deadline.js`, `src/data/refresh-policy.js`, `src/ui/gf-card-state.js`, `src/ui/map-outlines.js`, and `createRefresher` in `src/data/refresh.js`. App unchanged.
3. Learning loader: deadline, in-flight sharing, `emit('learning:loaded')`, `force` for reset, `init.js` subscription. `init()` still awaits (so behaviour is the same except for the deadline).
4. Parallel start: `refreshAll` in `init.js` (UI first), catch path, `main.js` interval, ↻ button.
5. Item 4: store flags, card gate edit in place, `#gfRetryBtn`, `setStatus` disable, 4e.
6. Item 2: resume handlers and `lastAttemptMs`.
7. Item 3b: lazy outlines.
8. Item 3c: category deferral (last, droppable).
9. Version and docs (section 12). Fresh-auditor re-audit (CLAUDE.md step 5). Deploy.

## 10. Tests

Existing tests that cover or constrain touched code:
- `test/data-freshness.test.mjs`: `fetchData` with a fake browser (tests 26-32, 34-60). Test 29 counts early timers and relies on `clearTimeout` being a no-op stub. Test 21 reads `init.js` for the `online`/`offline` lines. Keep all of them green; step 6 adds one assignment inside `fetchData` and the stub `document` must serve the new element ids (add `gfRetryBtn` support to the `el()` helper if `setStatus` touches it; it returns a generic object for any id, so likely nothing to change).
- `test/cap-indicator.test.mjs` 310-330: structural test on `updateGreatFallsUI` (see 4c).
- `test/creek-level.test.mjs:391`: `init.js` subscriptions.
- `test/reset-low-flow-bins-removed.test.mjs`: sweeps `src` for a string; no effect.
- `test/sw-runtime-caching.test.mjs`, `test/seo-basics.test.mjs`, `test/howitworks-text.test.mjs`: unchanged files; the last two only need the version bump to agree (section 12).
- `test/characterization/*` and the parity tests: untouched code.

New tests (pure, `node --test`, no browser):
1. `test/refresh-policy.test.mjs`: `lastGoodMs` (body time wins; null body falls back to live fetch time only; cached/stale sources return null); `shouldResumeRefresh` truth table: hidden, offline, fetching, within 60 s gap, age 9 min vs 10 min boundary, negative age, null lastGood, `force` skips only the gap.
2. `test/refresh.test.mjs` (`createRefresher` with stub deps): both calls start in the same tick; a rejected learning load does not stop the fetch; a rejected fetch does not stop learning; a call while fetching sets the pending flag and re-runs exactly once, never twice; the re-run is skipped when the age test says fresh.
3. `test/learning-deadline.test.mjs`: stubbed `fetch`: hangs headers (abort at the deadline), stalls the body after headers (still aborts), returns 500, returns bad JSON, succeeds. In all failure cases the store ends with `emptyData` (first load) or the previous payload (refresh), and `gfDataReady` is true. Two simultaneous calls issue one request; `force` issues a second. `learning:loaded` is emitted once per settle.
4. `test/gf-card-state.test.mjs`: every branch in 4a, including ice passes through, and "never `unavailable` before `fetchSettled`".
5. `test/map-outlines.test.mjs`: loader runs once; second call shares the promise; failure allows a retry; no fetch happens until `ensureOutlines()` is called.
6. `test/startup-wiring.test.mjs` (structural, source text like data-freshness test 21): `init.js` has no `await loadGFLearningData`; contains `on('learning:loaded'`; contains the three resume listeners; `map.js`'s `initMap` body has no `potomac-` fetch; `main.js` interval calls `refreshAll`; `index.html` has `id="gfRetryBtn"` with `hidden`.
7. Fetch test additions in `data-freshness.test.mjs` style: a resume-triggered `fetchData` after an old payload schedules at most the same single early timer; `lastAttemptMs` is set only when the guard passes.
8. Revert checks: for each new behaviour, revert once and confirm the new test goes red (the repo's established practice).

Cannot be tested without a browser (owner checks on a phone):
- Wake from sleep refreshes numbers within a few seconds (iOS home-screen app and Safari tab, Android Chrome).
- Airplane mode on, then off: refresh happens.
- DevTools request blocking: block `/api/sync`, card shows an uncorrected number after 10 s; block the Edwards Ferry URL, card shows "Estimate unavailable" and "Try again", and the button works after unblocking; block `waterservices.usgs.gov` with empty site data, same message; header and creeks remain live.
- Network tab on a fresh load: no `.geojson` request until the map button is tapped; map outlines appear after tapping; map works offline after one online visit.
- Marker rings appear after the first map open.
- Slow-3G throttle: the page is usable before learning returns.
- Whether the 2.9 M-character cache write succeeds on the owner's phone.

## 11. Risks, ranked

1. **Uncorrected number shown as current after a learning timeout** (new route to today's failure behaviour). Mitigation: 10 s deadline (not 4-6 s); ↻ and Retry both reload learning; the card never renders before learning settles; keep-last-good on refresh failures. Optional automatic retry is open question 1.
2. **Dropped refresh when a wake lands during a frozen in-flight fetch.** Mitigation: the deferred-resume flag, tested. Without it the next refresh is 15 min away.
3. **Fetch storm or battery drain from wake events.** Mitigation: 10 min age rule, 60 s attempt gap, `isFetching`, shared learning promise, proxy chain still memo-suppressed. Worst case is one attempt per minute during an outage.
4. **Card gate regression** (item 4 edits the estimate gate). Mitigation: edit in place so the cap-indicator structural test stays valid; the message branch is reachable only after `fetchSettled`; a computed estimate is never replaced; the pure function is table-tested.
5. **Double render side effects.** `learning:loaded` calls `updateGreatFallsUI`, which records history (`recordGFEstimate` replaces within 10 min, idempotent), runs shadow models (display only, already runs several times per cycle) and may call `storeForecastPredictions` (2 h throttle that is set only after the POST returns, so two renders close together could post twice; this already exists with `data:updated` plus `nws:arrived`). The skip-while-fetching rule removes the extra render in the common case.
6. **Resume age measured from a saved copy.** Mitigation: `lastGoodMs` prefers the server body time. If body time is missing it falls back to fetch time, which a service-worker saved copy can inflate; the effect is a skipped resume for at most 10 min, and the v39.1 early refetch still runs.
7. **Flood-category ring shows "Normal" briefly on first map open** (3c). Separable; owner decision.
8. **Lazy outlines:** layer order is a pre-existing race; failure leaves no outlines until the next open (warn only).
9. **Stale text in the repo** (CLAUDE.md `SERVER_VERSION` v39.2 claims) could mislead the next maintainer; fix the new bullet to say v39.6.

Things that could show an old number as current, summarised: risk 1 and risk 6 only. The EF-persisting-after-failure case (no age check on the client) already exists and is not changed.

## 12. Version and docs (MINOR, v39.7)

Per CLAUDE.md "Versioning Rules" and the consistency test, update all of:
- `index.html:8` `<meta name="app-version" content="v39.7">` and the footer span `id="app-version-text"` (line 721, currently `v39.6`). `seo-basics.test.mjs` checks they match.
- `CLAUDE.md`: heading `## Current Model Parameters (v39.6)` becomes `(v39.7)` (the test regex reads it); add one bullet "Startup and refresh (v39.7, client only)" in the style of the v39.1 bullet. State: estimate unchanged, `SERVER_VERSION` stays v39.6.
- `src/assets/tech-appendix.md`: `**Current version:** v39.7` (L836), "v16 through v39.7" (L838), a v39.7 history paragraph before L840, the footer `*Generated by Potomac Pulse v39.7 - ...` (L854), and a short subsection under the freshness material describing resume refresh, the 10 s learning deadline and the unavailable state.
- `src/assets/CHANGELOG.md`: new top row `| v39.7 | 2026-11-?? | ...` (test requires the row).
- `README.md`: `**Current Version**: v39.7` (L6), `## Current Model (v39.7)` (L58), test count (L161), a v39.7 row in the version table (near L178), and the "Last updated" line (L257). CLAUDE.md requires a README update on every commit.
- `TODO.md`: L7 current version and test count; version history near L258; mark the CX review items F1, F2, F6 and the geojson part of F9 as done, and add follow-ups (3a ice-safe shorter period, 3d compact cache, flood-category and forecast deferral if not done, CX F3 old-estimate label).
- A new plan file under `analysis/` (this document, revised after audit) per CLAUDE.md.
- `SERVER_VERSION` (`scheduled-update.js:2228`) does NOT change. Parity and prediction-logging tests that read it stay as they are.
- `howitworks-text.test.mjs` compares the page meta, CLAUDE.md, appendix current, appendix footer, README and TODO versions, so all six must say v39.7 in the same commit.

## 13. Verification after deploy

A fresh verifier with curl, on the built site (public paths only; do not call `/api/` or `/.netlify/`):
1. `curl -s https://potomac-pulse.netlify.app/` shows `app-version" content="v39.7"`, the footer `v39.7`, and `id="gfRetryBtn"`.
2. Read the hashed script name from that HTML, fetch it, and grep for: `visibilitychange`, `pageshow`, `learning:loaded`, `gfRetryBtn`, `Estimate unavailable`.
3. `curl -s https://.../sw.js`: still lists `potomac-nhd.geojson` and `potomac-watershed.geojson` in the precache, and the route string `period=P7D` is still present (proves 3a and the service worker are unchanged).
4. `curl -sI` the two geojson paths: 200.
5. Compare the live `sw.js` script hash with the one in `index.html` (the CX review saw a mismatch between `dist/` and live).

Only the owner can check: the phone and DevTools list in section 10 (sleep/wake, airplane mode, blocked requests, network tab on a fresh load, map first open, iPhone storage).

## 14. Recommend NOT doing

- **3a, shorter USGS period:** changes ice behaviour (estimate input). Keep P7D.
- **3d, trimming the cache:** needs a re-implementation of the ice lookback and Point of Rocks window; risk of altering a winter fallback. Follow-up.
- **Cutting any NWS forecast call:** Little Falls and Point of Rocks feed the estimate path and the forecast; the other 15 feed the All Gauges arrows.
- **CX F3 (old-estimate label), F4, F5 (proxies), F7, F8:** not in the four approved items.
- **Starting the fetch before the UI build:** tiny gain, harder failure ordering.
- **Editing or clearing the pending early-refetch timer:** breaks data-freshness test 29 and is not needed.
- **A client estimate without Edwards Ferry:** model decision, out of scope (paragraph in section 8).
- **No new warning or caution text anywhere:** the only new strings are "Estimate unavailable. <reason>." and "Try again". The reasons state a fact ("... did not load."), no advice.

## Open questions for the owner

1. After a learning timeout or failure at start, should the app retry the learning call once automatically (for example 30 s later) and re-render? My plan does not (it keeps today's behaviour and lets ↻ or Try again recover). Yes means the uncorrected number is replaced sooner; it also means one extra request in a bad-signal case.
2. Is a 10 s wait for the card acceptable when `/api/sync` is slow (the rest of the page is live), or would you rather cut at 6 s and accept an uncorrected number more often?
3. Flood-category deferral (3c): accept a 0 to 5 s delay of the marker rings on the first map open, in return for about 17 fewer requests every 15 min? If not, drop step 8.
4. Can you open the app on your iPhone (Safari Web Inspector or a USB-attached Mac) and check whether "Cache save failed" is logged after a fetch? That decides how urgent the 3d follow-up is.
5. Wording: "UNAVAILABLE" label, "Estimate unavailable. Edwards Ferry data did not load.", and button "Try again" are my proposals. Change any you prefer.

## Things I could not verify

- Any browser behaviour: localStorage quota on iOS or Android, wake and `visibilitychange`/`pageshow` behaviour in an iOS home-screen app, whether Leaflet fetches tiles for a hidden zero-size map.
- Whether Netlify's synchronous function limit for this site is 10 s (nothing in `netlify.toml` sets it).
- Whether live matches `dist/`; the CX review saw different hashes. I did not call the live site.
- NWS response sizes and latency (api.water.noaa.gov is outside the allowed hosts).
- The full-suite result; I did not run any tests. The baseline of 1223 comes from TODO.md.
- That `index.html` has no other consumer of `#gf-data-source` display state; grep over `src` and `index.html` found only `textContent` writes.
- The exact `gzip` size of the P3D payload (derived by proportion, not fetched).

### Critical Files for Implementation
- /Users/sebjilke/Desktop/PotomacPulse/src/init.js
- /Users/sebjilke/Desktop/PotomacPulse/src/learning/gf-learning.js
- /Users/sebjilke/Desktop/PotomacPulse/src/data/fetch.js
- /Users/sebjilke/Desktop/PotomacPulse/src/ui/great-falls-ui.js
- /Users/sebjilke/Desktop/PotomacPulse/src/ui/map.js

---

## 15. Audit response (independent plan audit 2026-11-12: approve_with_changes) and final scope

The audit is in `startup-refresh-plan-2026-11-12.PLAN_AUDIT.md`. Orchestrator rulings, 2026-11-12. Where a ruling differs from the text above, the ruling wins. The implementer works from this section plus the audit's exact wording.

| Finding | Severity | Ruling |
|---|---|---|
| PA-1 `fetchSettled` never seen by a render | must-fix | Accepted. Set it before each final emit and in the exception path; behaviour test added. Implemented through the PA-7 hook. |
| PA-2 `hidden` does not hide `.btn` | must-fix | Accepted. `#gfRetryBtn[hidden] { display: none; }` plus a source test. No global `[hidden]` rule. |
| PA-3 retry button never hidden on the ready path; helper could overwrite the ice label | must-fix | Accepted, with all four constraints of the audit (hide at the top of `updateGreatFallsUI`; helper is a no-op for ice; helper defined above the function with no `return;` line and no `renderCapIndicator` call; no new `return;` in the second segment). |
| PA-4 admin reset overwritten by an older request | must-fix | Accepted. Generation counter; `if (inFlight === p) inFlight = null`; race test. |
| PA-5 negative age refetches on slow device clocks | must-fix | Accepted. Age between -5 min and 0 is clamped to 0; only a larger negative age counts as unknown. |
| PA-6 two renders within seconds on refresh | should-fix | Accepted, option (b): when `gfDataReady` is already true and a learning load is in flight, `fetchData` awaits the shared learning promise (bounded by the 10 s deadline) after its network `Promise.all` and before `processData`, so a refresh renders once. At startup (`gfDataReady` false) the two stay independent. |
| PA-7 exception path not covered; one hook instead of three mechanisms | should-fix | Accepted. One `emit('fetch:settled')` in `fetchData`'s `finally` (after `setIsFetching(false)`, in try/catch) with one subscriber that sets `fetchSettled`, re-renders the card if learning settled during the fetch or the flag changed, and consumes `resumePending`. |
| PA-8 deferred resume dropped during an early-timer fetch | should-fix | Accepted (consumed in the PA-7 hook). The "up to three downloads in about 60 s when the radio is not up" bound is added to the risk list. |
| PA-9 emit inside the loader can break a reset | should-fix | Accepted. `emit('learning:loaded')` is wrapped in try/catch. |
| PA-10 Netlify limit is 60 s, not 10 s | should-fix | Accepted. Reason (c) is deleted; the 10 s deadline stands on (a), (b), (d). The helper races a timer and does not rely on the abort alone. |
| PA-11 duplicate outline layer on retry | should-fix | Accepted. One run-once promise per file. |
| PA-12 drop the flood-category deferral (3c) | should-fix | Accepted. 3c is NOT in v39.7. NWS calls are unchanged. The `pp-data` cache size observation goes to TODO as a follow-up. |
| PA-13 ice-lookback text | note | Accepted as a correction; the decision to keep `period=P7D` stands. The stage-series cut is a follow-up. |
| PA-14 bin table empty for a signed-in admin | note | Accepted. `onLearningLoaded` also calls `updateGFLearningUI()`. |
| PA-15 click event passed to `refreshAll` | note | Accepted. Bind `() => refreshAll()`. |
| PA-16 tests | should-fix | Accepted, all six additions. `startup-wiring.test.mjs` stays minimal and is not counted as behaviour coverage. |
| PA-17 simplicity | note | Accepted. `refresh-policy` is merged into `src/data/refresh.js`; the deadline helper is a local function in `gf-learning.js`. New files: `src/data/refresh.js`, `src/ui/gf-card-state.js`, and `src/ui/map-outlines.js` only if it is needed for a test. 4e also releases `#gfRetryBtn`. |
| PA-18 docs | note | Accepted. Baseline is 1224 tests (1222 pass, 2 skipped). The new CLAUDE.md bullet says `SERVER_VERSION` stays v39.6. |
| PA-19 browser check after deploy | should-fix | Partly accepted. The curl additions are adopted. No browser tool exists in this session, so the browser pass is an owner check on a phone and is reported as an unverified gap until done. |
| PA-20 button inside the live region | note | Accepted. The button is placed just after `#gf-estimate-display`, not inside it. |
| PA-21 extra renders step the shadow models | note | Noted; PA-6 (b) and dropping 3c remove the extra renders this plan would have added. |

Defaults for the plan's five open questions (the auditor agreed with 1, 2, 4, 5 and objected to 3; the owner was told on 2026-11-12):
1. No automatic learning retry.
2. The learning deadline is 10 s.
3. The flood-category deferral is dropped (PA-12).
4. The iPhone cache-write check is an optional owner check later.
5. Wording: label "UNAVAILABLE"; the line under it shows the reason only ("Edwards Ferry data did not load." / "USGS data did not load." / "Little Falls or Point of Rocks readings are missing."), without an "Estimate unavailable." prefix; button "Try again". No other new text.

Final scope of v39.7: item 1 (startup does not wait on learning; 10 s deadline; in-flight sharing), item 2 (resume on visible, pageshow, online; 10 min age, 60 s gap), item 3b only (map outlines on first map open), item 4 (unavailable state with a retry button). Not in v39.7: 3a (shorter period), 3c (NWS), 3d (cache write). Steps: section 9 without step 8.

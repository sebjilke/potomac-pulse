# Plan (version 2): archive the Weather Service forecast every hour (v39.15, MINOR, server only, logging only)

Status: VERSION 2, revised after the independent plan audit (`forecast-archive-plan-2026-11-24.PLAN_AUDIT.md`, verdict GO WITH CHANGES) and the orchestrator's rulings. Not implemented. Version 1 is kept unchanged as `forecast-archive-plan-2026-11-24.v1.md`. CLAUDE.md protocol step 5 applies: a fresh auditor re-checks this version before code is written, and again after.
Date: 2026-11-24. Owner decision of the same day: "store forecasts" (TODO A3f).
Line numbers: `netlify/functions/scheduled-update.js` is "S", `src/ui/great-falls-ui.js` is "UI", `src/estimation/nws.js` is "N". Re-read on 2026-11-24 for this version. The implementer must re-check them, the file drifts.

## 0. What the release does (for the owner)

Once an hour, right after the job has told healthchecks "I ran fine", the job asks the Weather Service for its river forecast at two places: Little Falls and Point of Rocks. These are the two series the 48 hour forecast on the page really uses. The answer is kept exactly as received, as one new row in the database, with the time the Weather Service issued it, the time we asked, and whether the call worked. A few numbers from that hour's own tick (Little Falls flow, Point of Rocks flow, the model's estimate) are copied into the row so the forecast can be rebuilt later even after the old tick rows are gone. With this you can recompute today's forecast, or any alternative, for any past hour, from the same inputs, on an even hourly grid that does not depend on who visited. The step runs after everything the job does today, including the existing log rows, under one fixed clock that stops it at 25 seconds into the run. It cannot delay the ping, cannot fail the job, and changes no estimate and no existing row. Scoring the forecasts visitors posted (the old "Part B-lite") is NOT in this release. It is a later, separate task (section 11).

## 1. Rulings on the plan audit

All 14 findings were read. Rulings 1 to 12 of the orchestrator are binding. How each is handled:

| # | Audit finding | Ruling | Where |
|---|---|---|---|
| 1 | The `nws_fc` write sat in front of the tick row; time arithmetic wrong (29 s, not 26 s) | ACCEPTED. Fetch starts after the ping. Await and write only after `finalizeTick`. One absolute deadline `tickStart + 25 s` for all new calls | 3.4, 3.5 |
| 2 | New-type failures never reach `log_health` | ACCEPTED. One more `flushLogHealth` after the new write, under the same deadline | 3.4 |
| 3 | The fetch promise needs a rejection handler where it is created | ACCEPTED. `.catch` at the call site. Mutant test added | 3.4, 6 (N5) |
| 4 | Replay inputs live in `tick_log` for 180 days, the archive for 730 | ACCEPTED. Replay scalars copied into the row | 2.2 |
| 5 | More existing tests break than "two lines" | ACCEPTED. Full list with file, line, reason. Dry run of `npm test` first | 5 |
| 6 | `fc_scored` write path over-built; batch it | NOT APPLICABLE in this release (Part B-lite removed). Recorded for the later task | 11 |
| 7 | Part B-lite is not needed for the stated purpose, and touches the scorer before the ping | ACCEPTED. Removed. `validateForecastPredictions` is not touched | 11 |
| 8 | Part B-lite changes more of the scorer than stated | ACCEPTED as notes for the later task | 11 |
| 9 | The replay must copy the browser's acceptance gate and `\|\| 0` rule; unusable-time points are kept in the browser | ACCEPTED. Every point stored, `null` for an unusable time; rules listed | 2.3 |
| 10 | Bound the response body | ACCEPTED. About 256 KB, outcome `shape` beyond it | 3.3 |
| 11 | Prune on a shared pool; keep the list hard-coded; negative test | ACCEPTED | 3.6, 6 (P1) |
| 12 | Handler line numbers off by about 10 | ACCEPTED, corrected throughout | all |
| 13 | Etiquette, no contact detail in a header | AGREED, nothing to change. No custom header | 3.2 |
| 14 | Hourly beats on-change | AGREED. Row size cross-check: `tick_log` averages about 1.5 KB per row (audit measure), above my 1.0 KB guess; the `nws_fc` size estimate in 4 is raised accordingly | 4 |

Not followed: nothing in the audit was rejected. Two deviations from my own v1 choices: the fetch cap is 2000 ms (was 2500) so every new call has the same cap, as ruling 2 says; and Part B-lite pool names (`fcs`) are gone.

Owner-level defaults, stated as recommendations for the owner to confirm: keep 730 days; store every hour, not only on change; two gauges only (Little Falls, Point of Rocks); no archive row on a tick where the job itself throws; kill switch `NWS_ARCHIVE=off` read from the environment, default on.

Separate to-do items, NOT part of this release (section 12): the dead Edwards Ferry branch and the overstated sentence in CLAUDE.md; the bias offset that uses the first future point; the scorer counting a forecast twice when its delete fails.

## 2. Facts read from the code, and the design

### 2.1 How the forecast is built, posted, stored, scored, deleted (facts)

- Build. `updateForecastPeriods(gfEst)` is UI:348. It reads `data['01638500'].forecast` (Point of Rocks), `data['01644148'].forecast` (Edwards Ferry), `data['01646500'].forecast` (Little Falls) (UI:357-360, 414-415). They are set only by `fetchNWSForecasts()` (N:48) for the ids in `NWS_LIDS` (`src/model/constants.js:160-178`; 17 entries; `01646500: BRKM2`, `01638500: PORM2`). **`01644148` is not in `NWS_LIDS`.** The only `.forecast` writer is N:64. So the Edwards Ferry blend never runs (UI:386-390, 493-502). Code reading only; not run in a browser.
- Gate. `hasNWSForecast = hasPoRForecast` (UI:363). Without a Point of Rocks series the whole forecast is linear extrapolation (UI:543-567), even if Little Falls is present.
- Points. `{validTime, generatedTime, primary (ft), secondary (kcfs)}`. The UI uses `p.validTime` and `(p.secondary || 0) * 1000` always (UI:379-383, 419-423), ignoring `secondaryUnits`.
- Inputs of the forecast computation, and where a replay gets each:

| # | Input | Browser source | Replay source |
|---|---|---|---|
| 1 | Little Falls series | `data['01646500'].forecast.data` | `nws_fc.g.BRKM2.pts` |
| 2 | Point of Rocks series (gate, fallback) | `data['01638500'].forecast.data` | `nws_fc.g.PORM2.pts` |
| 3 | Edwards Ferry series | never present | not needed |
| 4 | `now` | browser clock | tick time `at` (grid, section 9) |
| 5 | Observed LF flow (bias offset, persistence) | browser USGS load | `nws_fc.in.lfq`, `.lfT` (copied, 2.2) |
| 6 | Great Falls estimate `gfEst.cfs` (travel multiplier UI:436, last fallback UI:482, `getEFWeight`) | browser nowcast | `nws_fc.in.fin` (the server's estimate, not the visitor's) |
| 7 | Observed PoR flow (last fallback UI:413, 482) | browser USGS load | `nws_fc.in.porq` |
| 8 | Water temperature, `EF_MODEL` | store | not needed (dead EF branch) |
| 9 | Constants, `getFlowMultiplier`, `getEFWeight`, `estimateLFStage` | code | code at `nws_fc.ver` |

- Endpoints. Browser, in order, 5 s each (N:17-26): `https://api.water.noaa.gov/nwps/v1/gauges/{LID}/stageflow/forecast`, the same with lower-case LID, then `/stageflow` and its lower-case form. `fetchWithTimeout` (`src/data/fetch.js:78-93`) sends only an abort signal. Live check on 2026-11-24 (plain GETs, read-only): `BRKM2` and `PORM2` `/stageflow/forecast` answered 200, about 2 KB, top level `pedts`, `issuedTime`, `wfo`, `timeZone`, `primaryName`, `primaryUnits` "ft", `secondaryName`, `secondaryUnits` "kcfs", `data` (12 points, 6 h apart, about 66 h reach). `issuedTime` (13:59Z) was the same for both gauges; `generatedTime` (14:09Z, 14:10Z) was later and differed by gauge. No code in `src/` reads `issuedTime`. No rate-limit header seen. No rate rule or User-Agent rule found in code.
- Service worker. NWS is NetworkFirst, 4 s, cache up to 6 h (`config/runtime-caching.mjs:65-76`). A visitor can see an old series. The archive is NWS's state at the tick, not each visitor's input.
- Posted, stored, scored. Post: `src/learning/gf-learning.js:152-207` (display horizons, `NWS*` source, 2 h in-memory throttle, ice skip; no inputs are posted). Store: `sync-learning.js` (`validateGFWritePayload` line 141, `buildForecastRows` line 86). Score: `validateForecastPredictions` S:2125-2293, called at S:3207 BEFORE the ping, skipped on ice; it updates running totals and deletes the row. None of this changes in this release.
- Existing log types: `tick_log` 180 d, `validation_log` 730 d, `bin_snapshot` 730 d, `log_health` never pruned (`LOG_RETENTION_DAYS` frozen, S:2364). `LOG_SCHEMA = 3` (S:2361). `SERVER_VERSION = 'v39.11'` (S:2360). Pools `general` and `tick`, 3000 ms each (S:2365, `LogBudget` S:2412-2430); `timedLogCall` abandons a call after `min(2000, left)` ms (`LOG_WRITE_CAP_MS` S:2366, `timedLogCall` S:2434-2453); `writeLogRow` never throws, a `23505` is "already there" (S:2459-2481); `flushLogHealth` S:2487-2514; `pruneLogType` S:3017-3044; hard-coded prune list S:3053; `finalizeTick` S:3072-3084, which flushes health, writes the tick row, flushes health again only if the tick write failed.
- Keys. `tick_log`: `gauge_id` = tick start ISO with milliseconds. Unique key `(observation_type, gauge_id)` (`shared/observations.js:15`).
- Difficult Run pattern (v39.6): `fetchDifficultRun` S:2685-2728, one controller, one real timer over request and body (`DR_CAP_MS` 2000, S:2529), late-skip 20 s (S:2530, 2688), own try/catch.
- Handler order after the checks (S:3114-3421): scorer S:3207 (before ping); ping S:3346-3354; Difficult Run S:3359-3365 (call at S:3360); `flushDeferredLogs` S:3372; `runLogHousekeeping` S:3373; `finalizeTick` S:3374-3377; return after that; catch: `/fail` ping S:3388-3390, error `finalizeTick` S:3409.
- Nothing in `netlify/` calls `api.water.noaa.gov` today.

### 2.2 Row: `nws_fc`

Key. `gauge_id` = the tick start ISO with milliseconds, equal to the `tick_log` key of the same run. One row per tick, both gauges inside. Type name `nws_fc`. Version constant `FC_LOG_SCHEMA = 1` (new). `LOG_SCHEMA` stays 3, so no existing row changes.

Example (numbers illustrative, built from the 2026-11-24 live sample):

```json
{
  "v": 1, "ver": "v39.15",
  "at": "2026-11-24T18:00:03.412Z",
  "ft": 1764007203900,
  "ms": 640,
  "in": { "lfq": 11000, "lfT": 1764006300000, "porq": 10000, "porT": 1764006000000, "fin": 10850, "out": "predicted" },
  "g": {
    "BRKM2": {
      "site": "01646500", "http": 200, "why": null, "ms": 312,
      "iss": 1763992740000, "gen": 1763993360000,
      "u": "kcfs", "pu": "ft", "pedts": "HGIFF",
      "n": 12, "sig": "9f2c1a4e",
      "pts": [[1764007200000, 2.7, 1.48], [1764028800000, 2.7, 1.48]]
    },
    "PORM2": { "site": "01638500", "http": 200, "why": null, "ms": 355, "iss": 1763992740000, "gen": 1763993413000, "u": "kcfs", "pu": "ft", "pedts": "HGIFF", "n": 12, "sig": "b71d0c33", "pts": [[1764007200000, 1.3, 1.76]] }
  }
}
```

| Field | Meaning |
|---|---|
| `v`, `ver`, `at` | Schema, `SERVER_VERSION`, tick start ISO (equals `gauge_id`) |
| `ft`, `ms` | Fetch start (epoch ms) and whole fetch duration |
| `in.lfq`, `in.lfT` | Little Falls flow of this tick and its reading time (`usgsData` lf `.q`, `.qTime`). Read-only copies |
| `in.porq`, `in.porT` | Same for Point of Rocks |
| `in.fin` | The model's estimate of this tick (`prediction.predictedCFS`, rounded to 0 decimals as `tick_log.final.cfs`), or null |
| `in.out` | `predicted` or `no_prediction`, computed from whether `prediction` exists, the same as the handler passes to `finalizeTick` |
| `g.<LID>.site`, `http`, `why`, `ms` | USGS id the browser files the series under; HTTP status or null; null when clean, else `timeout`, `fetch_error`, `http_error`, `parse_error`, `shape`, `late_skip`, `internal_error`; request plus body time |
| `iss`, `gen` | Top-level `issuedTime` (the forecast's own issue time) and the largest `generatedTime`, epoch ms or null |
| `u`, `pu`, `pedts` | `secondaryUnits`, `primaryUnits`, `pedts` as received. The browser ignores `u` and multiplies by 1000; storing it lets a replay detect a unit change |
| `n`, `sig` | Number of points stored; first 8 hex of a SHA-1 (Node built-in `crypto`) over the `pts` JSON |
| `pts` | Every point of the data array, as received, in order: `[validTime epoch ms or null, primary, secondary]`. A number stays a number; a string stays a string cut at 24 characters; anything else is null. `null` for the time when it cannot be parsed (2.3) |
| `rawHead` | Only when `why` is `shape` or `parse_error`: first 1000 characters of the body, URLs replaced by `<url>` with the existing `logMsg` rule |

Why the scalars. `tick_log` is kept 180 days, `nws_fc` 730. Without the copies, a row older than 180 days has no join partner and cannot be replayed (audit finding 4). The scalars are about 100 bytes. They are read from `tickCtx` and `prediction`, never written. The tick row itself is not changed. Limits, stated: `in.fin` is the server's estimate, not the visitor's; on a no-prediction tick it is null and a replay must use `in.lfq` as the stand-in for the travel multiplier. A USGS answer with no discharge for a gauge gives null.

### 2.3 What an offline replay must itself reimplement (rules, with file and line)

The archive stores raw points. It does not store the browser's decisions. A replay must reproduce these, at the replay's `now`:

1. Acceptance gate. `data[id].forecast` exists only if `parseNWSForecast` returns non-null (N:64, N:94-218). That needs a data array found by the path list (N:108-123) and at least one point with `0 <= hoursAhead <= 96` (the 24/48 search uses 0 to 72, then widens to 96; N:136-202) and `parseFloat(point.secondary) > 0`. The time string comes from `validTime || time || dateTime || valid || timestamp` (N:138). The UI then gates on `forecast.data.length > 0` (UI:361-363, 416).
2. The `|| 0` rule. The UI reads `(p.secondary || 0) * 1000` (UI:382, 422). A null or missing flow becomes 0 cfs. A string "1.5" becomes 1500 (string times number). A replay must apply the same JavaScript coercion, not a "cleaner" one.
3. Unusable times are kept. A point with no parseable `validTime` is NOT dropped by the UI: `new Date(undefined)` gives NaN `hoursAhead`, and the point stays in `lfPoints` (UI:379-383, 419-424). It counts in `lfPoints.length` and can feed `lfPoints[0]?.cfs` (UI:428-429). This is why the archive stores such points with a null time.
4. Sources of `now`. The UI uses the browser clock (UI:353). The archive grid is the tick time (section 9).
5. On each refresh `processData` empties `data` (`src/data/fetch.js:516`), so the first render after a refresh can have no forecast (extrapolation) and the forecast arrives later (`nws:arrived`, fetch.js:541-545). A replay of "what a visitor saw" cannot know which render a visitor looked at. It reproduces the forecast the page computes once the series has arrived.
6. Two known oddities a replay must keep, not fix (to-do items, section 12): the bias offset uses the first future point when all points are in the future (UI:400-410, 428-433); the Edwards Ferry branch is never taken.

## 3. The step: fetch, deadline, order, failure handling

### 3.1 What is fetched

Per tick, two GETs started together, the first browser variant only: `https://api.water.noaa.gov/nwps/v1/gauges/BRKM2/stageflow/forecast` and `.../PORM2/stageflow/forecast`. Server constant `NWS_ARCHIVE_GAUGES = { '01646500': 'BRKM2', '01638500': 'PORM2' }`; a test checks both entries equal the matching `NWS_LIDS` entries. No fallback to the long `/stageflow` form. No custom header, no User-Agent set by us (Node sends its default), no key, no contact detail.
Array selection copies the browser's path list (N:108-123) so a shape change hits both the same way. A parity test (6, N2) runs the browser parser and the server parser over the same fixtures.

### 3.2 Kill switch

`process.env.NWS_ARCHIVE === 'off'`: nothing is fetched and nothing is written. Any other value, or unset: on.

### 3.3 `fetchNwsArchive(tickStartMs)`

- Absolute deadline. `NEW_LOG_DEADLINE_MS = 25000`. `deadline = tickStartMs + 25000`. Cap for any new call = `min(2000, deadline - Date.now())`. A call whose cap is not positive is not made and is recorded (`late_skip` for the fetch, `budget` failure for the writes).
- One `AbortController` and one real timer over BOTH requests and both body reads, set to the cap (so at most 2000 ms, and never past the deadline). On timeout both are aborted; a gauge that had already finished is kept, the other gets `why: timeout`.
- Body bound. Each body is read with a byte counter (stream reader, or `content-length` checked first). Past about 256 KB (`NWS_BODY_MAX = 262144`) the read is aborted and the gauge gets `why: shape` (and `rawHead` only from what was read). The normal answer is about 2 KB.
- Per gauge: non-OK status gives `http_error` plus `http`; not JSON gives `parse_error`; no usable array (no path in the list, empty, or no point at all) gives `shape`. A 429, a 5xx, a changed shape, a timeout each give a row with `why` set and the other gauge intact.
- The function never throws and never rejects. In addition the CALL SITE attaches the handler (3.4).

### 3.4 Order inside the job

1. Everything up to the ping is unchanged, including the scorer (S:3207) and the ping (S:3346-3354). Nothing new before the ping.
2. Right after the ping, if the switch is on: `const nwsP = fetchNwsArchive(tickStartMs).catch(() => ({ rows: null, why: 'internal_error' }));` The rejection handler is attached in the same statement that creates the promise (audit finding 3). The fetch runs while the Difficult Run, `flushDeferredLogs`, `runLogHousekeeping` and `finalizeTick` run, so it adds no wall time on a normal tick.
3. Difficult Run block (S:3359-3365), `flushDeferredLogs` (S:3372), `runLogHousekeeping` (S:3373), `finalizeTick` (S:3374): unchanged, same order, same pools. No existing write starts later than today. `tick_log.aux.logFail` and every existing row see nothing from this step.
4. After `finalizeTick` has returned: `const nws = await nwsP`. Then build the row (pure, reads `tickCtx`, `usgsData`, `prediction`, never writes them) and `writeLogRow(client, 'nws_fc', at, rec, budget, 'arch')`. New pool `arch` on `LogBudget` (4000 ms, defaulted constructor argument, so `new LogBudget(g, t)` callers are unchanged). Each call inside it is capped `min(2000, deadline - now)`; skipped when not positive.
5. Then one more `flushLogHealth(client, budget, { pool: 'arch', deadline })`, so a failed or skipped `nws_fc` write is counted in `log_health` (audit finding 2). It reads and writes `log_health/system` only if `budget.hasPending()`; each call under the same cap rule. The existing `flushLogHealth` behaviour (pool `general`, no deadline) is the default and is unchanged.
6. Return the same 200 and body as today.

Catch path: unchanged. No archive row on a tick where the job throws (owner default, confirm).

### 3.5 Time arithmetic (recomputed)

Today, after the ping (limits from the timers): Difficult Run at most 2.0 s (`DR_CAP_MS`), and only if the Difficult Run starts by 20 s (S:2530, 2688); then the `general` pool at most 3.0 s total (S:2365; `flushDeferredLogs`, snapshot, prune, `log_health`); then the tick insert at most 2.0 s (one call capped `min(2000, 3000)`, S:2437; the tick pool never spends more than that on one write). That is about 7 s after the ping. **Today's worst end is about 20 + 2 + 3 + 2 = 27 s** (ping ending at 20 s). If the ping ends at 21 s the Difficult Run is skipped and the end is about 26 s. (Version 1 said 27.9 s; the audit corrected it.)

New work, with the plan above:
- The fetch starts after the ping and is capped at `min(2000, deadline - start)`. It ends by the deadline at the latest, whatever the tick did.
- Its write and the extra health flush start only after `finalizeTick` and each ends by `min(start + 2000, deadline)`. So all new work ends by 25 s, or does not start.
- Therefore the new worst case end is `max(today's end, 25 s)`. Today's worst is 27 s. **The new worst case is 27 s: the same as today.** On such a tick the deadline has already passed when `finalizeTick` returns, so nothing new runs and the archive row for that hour is lost (visible as a gap in `nws_fc` keys).
- Typical tick: the tick ends 1 to 2 s after the ping; the fetch (about 300 ms) is already done; the write adds one insert (tens to a few hundred ms, assumed not measured). If NWS hangs, the await after `finalizeTick` waits at most until the fetch timer (2 s after the fetch started), so a hung NWS adds at most about 2 s to a normal tick, after every existing write.
- Pre-ping time is NOT bounded today and this plan does not change that. Before the ping: the USGS retry, the scorer loop over up to 300 rows with three DB calls each (S:2155-2290), and the ping itself (up to 5 s). A tick whose ping ends after 25 s runs no new step (fetch skipped).
- All of this rests on the 30 s Netlify limit, which is "from memory, unverified" (TODO A3h).

### 3.6 Retention and pruning

- `LOG_RETENTION_DAYS` gains `nws_fc: 730`. The prune list at S:3053 stays HARD-CODED and gains the one name: `['tick_log', 'validation_log', 'bin_snapshot', 'nws_fc']`. Do not switch to `Object.keys` (audit finding 11): a key added later for another reason must not be pruned by accident.
- Prune calls use the `general` pool at UTC hour 3. The new type is last in the list, so on a spent pool it is the first skipped. That delays trimming only. It adds `skipped` counts only once rows qualify (November 2028).
- String order: the key is a fixed-width ISO time, so text order equals time order.
- First possible `nws_fc` prune: November 2028. Until then the delete path for this type is proven only by mocks. The first real prune of ANY log type is still unproven (TODO A3c; `tick_log` first candidates about 2027-05).

## 4. Volume

`nws_fc` row: about 1.0 to 1.5 KB of data (2 x 12 points, 2 x about 250 bytes of meta, about 100 bytes of scalars) plus about 0.35 KB for key and index (assumption, as in the A3 plan). The audit measured `tick_log` at about 1.5 KB per row, so plan 1.5 to 2 KB all in. 8,760 rows a year, about 13 to 18 MB a year, about 26 to 35 MB at 730 days. The live database is about 101 MB, this table 1.6 MB (audit read). The 500 MB versus 2 GB plan limit is still unchecked (A3h). Re-measure with `pg_column_size` after a day and a week.

## 5. Files to change, and what must not change

| File | Change |
|---|---|
| `netlify/functions/scheduled-update.js` | `SERVER_VERSION = 'v39.15'`; consts `FC_LOG_SCHEMA`, `NWS_ARCHIVE_GAUGES`, `NEW_LOG_DEADLINE_MS`, `NWS_CALL_CAP_MS = 2000`, `NWS_BODY_MAX`; `LOG_RETENTION_DAYS` plus `nws_fc`; `LogBudget` third pool `arch` (defaulted); `flushLogHealth` optional third argument `{pool, deadline}` (default behaviour unchanged); new pure `parseNwsForecastBody`, `buildNwsFcRecord`; new `fetchNwsArchive`; handler: start after the ping, await and write after `finalizeTick`; prune list plus the one name; `_test` exports. NOT touched: `validateForecastPredictions`, `makeGFPrediction`, `buildTickRecord`, the order of existing writes. |
| `index.html` | Version strings only (`<meta name="app-version">` and the footer text), as server-only v39.12 did. `test/howitworks-text.test.mjs` requires all version places to agree. |
| `CLAUDE.md`, `README.md`, `TODO.md`, `src/assets/CHANGELOG.md`, `src/assets/tech-appendix.md` | Section 8. |
| Existing tests | The list below, and nothing else. |
| New tests | Section 6. |

Existing tests that must change (read from the code by the auditor; to be confirmed by the dry run below). Each change is legitimate because it follows from a stated, intended change (version string, a new log type, two new allowed URLs). None loosens a check on estimate, learning, order or ping.

| File and line | Why it breaks | Legitimate edit |
|---|---|---|
| `test/truth-dr-handler.test.js:206` | asserts `tick.ver === 'v39.11'` | compare with `_test.SERVER_VERSION` (as `prediction-logging-handler.test.js:131` does) |
| `test/truth-dr-model.test.js:138` (title at 132) | asserts `rec.ver === 'v39.11'` | same |
| `test/truth-dr-handler.test.js:263-267` | "only the four known URLs are requested"; the two NWPS GETs are new | add the two exact NWPS URLs to the allow-list. Do not loosen it to any `api.water.noaa.gov` URL |
| `test/truth-dr-handler.test.js:126-137` (`strippedLogs`), used at `:158-170` | the late-skip baseline has the clock moved 25 s at the ping (`:99`), so under the deadline rule it writes no `nws_fc` row, while every other arm writes one (`fetch_error`, the mock throws for unknown URLs, `:110`) | drop `nws_fc` rows in `strippedLogs`, the way the v39.6 fields are dropped |
| `test/helpers/mem-supabase.js:118` (`LOG_TYPES`) | the existing handler tests count unknown types as non-log writes (`prediction-logging-handler.test.js:116, 361, 414`, `truth-dr-handler.test.js:122-141`) | add `'nws_fc'` |
| `test/prediction-logging-writer.test.js:531` | asserts `LOG_RETENTION_DAYS` deep-equals three types | four types |
| `test/prediction-logging-writer.test.js:451-461` | `keepers` and `type_not_allowed` lists | add a negative case for a similar non-log type, `gf_forecast_pending` (audit 11) |
| any others found by the dry run | unknown | each listed here with line and reason before it is edited |

STEP 0, before writing any other code: do a dry run of `npm test` with only the version bump and a stub `fetchNwsArchive` (the fetch in place, the row built from fixtures) and list EVERY failing assertion, with file and line. Add them to the table above. Rule R1 then reads: no existing test is edited beyond this list. This also catches tests that count log rows or hour-3 queries (the prune list change) or stub `fetch` and fail on an unknown URL.

Must NOT change: `shared/model.js`, `src/model/*`, `src/estimation/*`, `src/ui/*`, `src/learning/*`, `sync-learning.js`, `shared/observations.js`, `netlify.toml`, `config/runtime-caching.mjs`; `validateForecastPredictions` and its writes; `LOG_SCHEMA`; the fields and writes of `tick_log`, `validation_log`, `bin_snapshot`; the ping position and the `/fail` ping; status code and body; the estimate and every existing row (timing fields `ms` aside, CPU jitter only).

## 6. Tests to add (`node --test`, patterns of v39.2 and v39.6)

Seams as in `prediction-logging-handler.test.js` and `truth-dr-handler.test.js`: env set first, `getSupabase` patched before require, fake timers, the in-memory client; ping URL `hc-ping.test`, never `hc-ping.com`.

| ID | Test | Catches |
|---|---|---|
| N1 | Parser over saved fixtures (`test/fixtures/nws-brkm2.json`, `nws-porm2.json`, from the 2026-11-24 answers, no personal data): `n`, `iss`, `gen`, units, exact `pts`. Odd shapes: array under each path of N:108-123, missing array, empty, point without time (kept with null time), string flow, null flow, non-numeric, HTML body | Wrong parse; silent shape drift; dropped points |
| N2 | Parity: import the browser `parseNWSForecast` (ESM, as the other `.mjs` parity tests) and the server parser over the N1 fixtures; same array chosen. `NWS_ARCHIVE_GAUGES` equals the two `NWS_LIDS` entries | Server and browser choosing different series |
| N3 | `fetchNwsArchive` with fake timers: exact two URLs, upper-case LID, no custom header; clean; one gauge 500, other fine; 429; 403; bad JSON; HTML 200; network error; hang before headers (ends at the cap, aborts); body never ends (ends at the cap); body over 256 KB (`shape`, read stops); started late so the cap would pass the deadline (cap shrinks); started after the deadline (no request, `late_skip`); Response with throwing getters is a result, not a throw | Hung or failing NWS call; unbounded body |
| N4 | `buildNwsFcRecord`: example shape, size under 3 KB with 2 x 12 points, finite numbers or null, `rawHead` only on `shape`/`parse_error` and URL-scrubbed, `in.*` equal the tick values, inputs deep-frozen (no mutation), `sig` stable and sensitive | Shape, size, leaks, mutation |
| N5 | **Mutant: `fetchNwsArchive` itself throws (synchronously, and as a rejection).** The handler still returns 200, with exactly one ok ping, no fail ping, exactly one tick row, existing rows unchanged, and no `unhandledRejection` (`process.on('unhandledRejection')` in the test) | Missing `.catch` at the call site (audit 3) |
| N6 | Handler, normal tick: exactly one `nws_fc` row; `gauge_id` equals the `tick_log` key; its write comes AFTER the ping and AFTER the tick row insert (event order); NWS hanging, rejecting, 500, bad shape: same; the row exists with `why` set | "Nothing before the ping", order, join key |
| N7 | Equivalence (the T5b pattern): record every non-log DB write and payload, and the return value, with the archive on, off (`NWS_ARCHIVE=off`), NWS hanging or erroring, and the `nws_fc` insert hanging or rejecting. Identical. `tick_log`, `validation_log`, `bin_snapshot` identical (timing fields removed). `tick_log.aux.logFail` identical (new-type failures appear only in `log_health`) | Coupling into estimate or existing rows |
| N8 | Deadline: tick already 23.5 s old at the await: write cap is 1500 ms at most; 25.1 s old: no fetch result used, no write, a `budget` failure counted in `log_health`; the extra health flush also obeys the deadline. Total run time with everything hanging stays within today's worst case (assert end <= max(today's end, 25 s)) | Time bound (audit 1) |
| N9 | `log_health`: a failed `nws_fc` write (error, timeout, skip) is counted in `log_health/system` by the extra flush (`byType.nws_fc`); a clean run writes no `log_health` | Audit 2 |
| N10 | Pool isolation: hang `nws_fc` inserts; `validation_log`, snapshot and tick writes still land | Starvation |
| P1 | Prune with the filter-evaluating mock: `nws_fc` pruned at 730 days (older rows go, younger stay, other types untouched); allow-list refuses `gf_forecast_pending` and unknown types with zero queries; the list is the literal four names (source scan); hour 3 only; 30-day floor; 100 ids a batch; URL under 8 KB | Deleting something it should not |
| S1 | Source scans: `sync-learning.js` does not mention `nws_fc`; no `hc-ping.com` literal in new code or tests; no `User-Agent` header set by the new code; no reference to `nwsP` above the ping line | Exposure; contact details; ordering |
| R1 | `git diff --stat` on `test/characterization`, golden fixtures, the parity tests, `forecast-validation-timing.test.js`, `cron-fail-ping.test.js` is empty; edits to other existing tests are exactly the list in section 5 | Silent weakening |

Count: record `npm test` before and after (README says 1617 at v39.14).

## 7. Version

v39.15, MINOR (no estimation change), server only, logging only. `SERVER_VERSION` `v39.15`. `commit` is null in every row (A3j), so this constant is the only code marker.

## 8. Documents (versioning rules; `test/howitworks-text.test.mjs` requires agreement)

- `index.html`: `<meta name="app-version">` and footer text to v39.15.
- `CLAUDE.md`: heading "Current Model Parameters (v39.15)"; new bullet "Forecast archive (v39.15, server only, logging only)" (type `nws_fc`, key, hourly, 730 days, deadline 25 s, kill switch, never feeds the estimate); in "Audit logging" add the new type and its key form (`gauge_id` = tick ISO) to the stored `gauge_id` list. Do NOT edit the forecast section sentences (section 12).
- `README.md`: Current Version, version table row, test count.
- `TODO.md`: "current version: v39.15"; A3f stays open (scored forecasts are the later task) with a note that the inputs are now archived; add the section 12 items; add verification rows (first rows, 24 h gap check, first prune 2028, `pg_column_size`).
- `src/assets/CHANGELOG.md`: a `| v39.15 |` row (required by the test).
- `src/assets/tech-appendix.md`: new subsection 6.10.2 (row, fields, join, replay rules of 2.3, retention, example SQL), a v39.15 paragraph, "Current version" line, "Generated by" footer, and the "Not logged:" sentence near line 582 (the Weather Service forecast is now archived; scored visitor forecasts still are not).

## 9. Risks, most serious first

1. **Time.** All limits rest on the unverified 30 s limit (A3h). The design keeps the worst case equal to today's 27 s, but today's 27 s is already 3 s from the limit, and pre-ping time is unbounded. Mitigation: the deadline, the kill switch. Gap: real durations are unknown.
2. **Unhandled rejection** would kill the process after the ping. Mitigation: `.catch` at creation, mutant N5.
3. **The archive is not what the visitor saw** (service worker cache up to 6 h, own fetch times) and is on the tick grid. Fine for comparing methods on the same grid, wrong for reproducing one visitor's card to the cfs. `in.fin` is the server's estimate; on no-prediction ticks it is null.
4. **Slow ticks lose the row** (gap in keys). Accepted.
5. **New outside call.** Two requests an hour from Netlify's address. If NWPS limits or blocks it, rows show `http_error`, nothing else breaks. Not verified from Netlify.
6. **Existing tests change** (section 5), and the dry run may find more.
7. **Replay is only as good as the rules of 2.3**; they are not in the data.
8. Table is readable with the anon key and the logs are not tamper-evident (same caveat as A3). Content is public NWS data plus our estimate scalars.

## 10. Verification path (stated up front, per the global rules)

Fresh Opus verifier, given the goal and the diff only.

Before the push:
1. Run `npm test`; report counts before and after; list any failing test.
2. R1: no edits beyond the section 5 list; empty diff on the protected tests.
3. Mutants in a scratch copy, each must make a named test fail: (a) fetch or write moved before the ping; (b) `nws_fc` write moved before `finalizeTick`; (c) deadline removed; (d) `.catch` removed from the call site (N5); (e) fetch timer removed; (f) body bound removed; (g) `nws_fc` written to the `general` pool; (h) `LOG_SCHEMA` set to 4; (i) a `User-Agent` header added; (j) the second health flush removed (N9); (k) prune list switched to `Object.keys`.
4. Read the diff: nothing on the estimate path; the row builder reads, never writes; no `validateForecastPredictions` change.

On the live system after the push (read-only SQL, `ver = 'v39.15'`):
1. The first `nws_fc` row exists for the first tick after deploy. `gauge_id` equals that tick's `tick_log` key. Two gauges, `http` 200, `why` null, `n` 12, `iss` within 48 h of `at`, `in.lfq` and `in.fin` equal to the tick row's `in.lf.q` and `final.cfs`.
2. Fetch the same two NWPS URLs within minutes and compare `iss` and `pts` (same `iss` must have the same `pts`).
3. The tick row of that hour: `ms` in the normal range (expect a few hundred ms at most beyond earlier ticks), `aux.logFail` empty, `log_health` unchanged.
4. After 24 h: 24 `nws_fc` rows, no gap; rows with `why` set; `pg_column_size` replaces my size guess.

UNVERIFIED GAPS: the ping still arriving in time on the live system (a tick row proves order, not delivery; the owner checks healthchecks; nothing here is sent to hc-ping.com); the 30 s limit and real post-ping durations; NWPS behaviour from Netlify; the first prune (2028); the plan size limit (A3h); `COMMIT_REF` null; whether the browser really never has an Edwards Ferry forecast (code reading only); no browser check (no client change).

## 11. Later, separate task: scored visitor forecasts (old "Part B-lite"), NOT in this release

Not needed for a comparison on the even hourly grid. It touches `validateForecastPredictions`, which runs before the ping. Do it as its own push after `nws_fc` has run live for 24 h. Points the audit records for it:
- Volume is small. Live read (audit, 2026-11-24): about 927 scored per horizon since 2026-08-29, about 42 rows a day, about 1.8 per tick, about 31k rows over 730 days (15 to 20 MB). Backlogs after an outage or ice spell can ripen up to 300 rows in one tick. So: write all rows of a tick in ONE batched `insert([...])` (or upsert with ignore-duplicates), cap about 300 (the fetch cap, S:2159), one round trip, one 2 s cap, no per-row pool drain. Needs a small extension of the in-memory test client (array payloads). A per-row cap of 40 would lose rows after a backlog.
- `persistError` is declared inside `if (pred.data.persistenceCFS)` (S:2270-2275). Logging a persistence error means lifting it out of that block, which is an edit to scorer code. Say so; compute from copies inside a try/catch.
- On the bad-target path `targetTime` is an Invalid Date; `.toISOString()` throws `RangeError`. Store the raw string `logStr(pred.data.targetTime)`.
- The scored row is logged after the delete even if the metadata upsert failed (S:2277-2281). Add a boolean `metaOk`.
- Assert the scorer's return value and every DB write are identical with and without the out-parameter, including a throwing push; assert (source scan) that nothing reads the collected rows before the ping.
- Give it its own kill switch; `NWS_ARCHIVE=off` covers the archive only.
- Fields and keys as in v1 section 4 (`<valAt ISO ms>_<pending row id>`, `act.q`, `act.qT` from `lf.qTime`, signed `errPct`, `mk`, `ck`, `dueAt`, `lagMin`, `tickAt`).
- Retention to decide then; 730 days is about 15 to 20 MB. The prune must handle about 42 rows a day (the 100 a day batch is enough).

## 12. Separate to-do items (not part of this release)

1. The dead Edwards Ferry branch in the forecast (`01644148` not in `NWS_LIDS`), and the overstated sentence in CLAUDE.md line 140 and the Tech Appendix ("an Edwards Ferry blend that is under 1% below ~6,000 cfs"; today it is zero).
2. The bias offset uses the first FUTURE point when all points are in the future (UI:400-410, 428-433).
3. The scorer changes the running totals before the delete; if the delete fails the forecast is counted again next tick (S:2277-2288).
Decide after the archive exists. Changing the forecast now would destroy the comparison baseline.

## 13. Order of work (after the owner confirms the defaults and the auditor passes this version)

0. Dry run of `npm test` (section 5, STEP 0); complete the list of existing tests to change.
1. Fixtures from the live answers; N1, N2.
2. `fetchNwsArchive`, bounds, N3.
3. Row builder and handler wiring, N4 to N10.
4. Prune and P1, S1.
5. Docs and version (section 8).
6. Fresh verifier (section 10). Commit and push only when the owner says so.

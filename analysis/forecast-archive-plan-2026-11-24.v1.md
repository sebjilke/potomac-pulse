# Plan: store the 48 h forecast inputs and the scored visitor forecasts (v39.15, MINOR, server only, logging only)

Status: DRAFT 1. Not audited. Not implemented. CLAUDE.md protocol: an independent auditor must review this file before any code is written.
Date: 2026-11-24. Owner decision of the same day: "store forecasts" (TODO A3f).
Line numbers: `netlify/functions/scheduled-update.js` is "S", `src/ui/great-falls-ui.js` is "UI", `src/estimation/nws.js` is "N". Read on 2026-11-24. The implementer must re-check them.

## 0. Short answer

- Part A is possible with no client change. The job fetches two Weather Service series (Little Falls `BRKM2`, Point of Rocks `PORM2`) once an hour and appends one row `nws_fc`. Its key is the tick's own ISO time, so it joins to `tick_log` by equality.
- Store every hour. Do not store only on change (section 3.3).
- Part B-lite adds one `fc_scored` row for each scored (or swept) visitor forecast. It is collected inside the existing scoring loop and written after the success ping.
- Three things in the orchestrator's design are wrong or need care. They are in section 9 ("What I think is wrong").
- The biggest one: the Edwards Ferry forecast the browser code asks for does not exist. The forecast uses two series, not three.

## 1. Facts read from the code

### 1.1 How the forecast is built (browser)

1. `updateForecastPeriods(gfEst)` is at UI:348. It runs on every render of the Great Falls card (UI:329).
2. Data sources. `data['01638500'].forecast` (Point of Rocks), `data['01644148'].forecast` (Edwards Ferry), `data['01646500'].forecast` (Little Falls) (UI:357-360, 414-415). They are filled only by `fetchNWSForecasts()` (N:48), which loops over `NWS_LIDS` (`src/model/constants.js:160-178`).
3. `NWS_LIDS` has 17 gauges. The two that matter: `"01646500": "BRKM2"` and `"01638500": "PORM2"`. **`01644148` (Edwards Ferry) is not in `NWS_LIDS`.** Nothing else assigns `.forecast` (grep of `src/`). So `efForecast` is always undefined, `hasEFForecast` is always false, `efEstimate` is always null (UI:386-390, 493-502) and the label is always plain `NWS`. This is read from the code. I did not open the page to confirm it.
4. The gate. `hasNWSForecast = hasPoRForecast` (UI:363). The Little Falls series is used only if the Point of Rocks series is present too. If Point of Rocks has no data array, the whole forecast falls to linear extrapolation (UI:543-567), even when Little Falls is fine.
5. Series points. Each point is `{validTime, generatedTime, primary (stage, ft), secondary (flow, kcfs)}`. The browser reads `p.validTime` and `p.secondary`, and multiplies by 1000 always (UI:382, 422). It does not read `secondaryUnits`. (`parseNWSForecast` at N:94 does read the unit, but only to build `forecast24/48` for the gauge list trend, not for the forecast periods.)
6. Inputs of the forecast computation. Every one of them:

| # | Input | Where it comes from in the browser | Where the offline replay gets it |
|---|---|---|---|
| 1 | Little Falls forecast series (`secondary`, `validTime`) | `data['01646500'].forecast.data` | NEW `nws_fc` row, gauge `BRKM2` |
| 2 | Point of Rocks forecast series | `data['01638500'].forecast.data` (gate, and fallback path) | NEW `nws_fc` row, gauge `PORM2` |
| 3 | Edwards Ferry forecast series | never present (see 1.1.3) | nothing needed |
| 4 | `now` (browser clock, used for `hoursAhead`) | `new Date()` at render | tick time `at` (up to 60 min off, section 9.4) |
| 5 | Observed Little Falls flow `lfData.q` (bias offset, persistence) | USGS load in the browser | `tick_log.in.lf.q` and `.qT` of the same tick |
| 6 | Current Great Falls estimate `gfEst.cfs` (travel multiplier at UI:436, last fallback at UI:482, `getEFWeight`) | browser nowcast | `tick_log.final.cfs` of the same tick (the server's estimate, not the visitor's) |
| 7 | Observed Point of Rocks flow `porData.q` (only as the very last fallback, UI:413, 482) | USGS load | `tick_log.in.por.q` |
| 8 | Water temperature `waterTempC`, `EF_MODEL` | store | not needed (only used on the dead EF branch) |
| 9 | Constants `TRAVEL_GF_LF_BASELINE` 6.5, `getFlowMultiplier`, `getEFWeight`, `estimateLFStage` | code | code at the replayed version (`tick_log.ver`) |

7. Two properties of the existing forecast that the replay must reproduce, not fix.
   - The bias offset is `observed LF - forecast at hoursAhead 0` (UI:428-433). The first point of a fresh series is usually in the future (live sample today: fetched 17:26Z, first point 18:00Z). Then `interpolateForecast(points, 0)` finds no earlier point and returns the FIRST future point (UI:401-408), not a value for "now". The offset therefore compares observed flow with a value up to 6 hours ahead. This is a fact about today's forecast. Out of scope here.
   - The `+48h` card reads the Little Falls series at 48 + about 6.5 h or more. A fresh series has about 66 h of reach (live sample: 12 points, 6 hours apart, 18:00Z to 12:00Z three days later). Beyond the last point the code holds the last value (UI:458-461). Offline replay of `+48h` needs the full series.

### 1.2 Endpoints, shape, headers (browser and live check)

- Browser, in order, 5 s each (N:17-26): `https://api.water.noaa.gov/nwps/v1/gauges/{LID}/stageflow/forecast`, then the same with the lower-case LID, then `.../stageflow` and its lower-case form (500+ points). First answer that parses wins. `fetchWithTimeout` (`src/data/fetch.js:78`) passes only an abort signal. No custom header, no User-Agent.
- Live check on 2026-11-24 (two plain GETs, read-only): `BRKM2` and `PORM2` `/stageflow/forecast` both answered 200, about 2 KB each. The lower-case LID also answered 200. Top level: `pedts`, `issuedTime` ("2026-11-24T13:59:00Z" for both), `wfo`, `timeZone`, `primaryName`, `primaryUnits` ("ft"), `secondaryName`, `secondaryUnits` ("kcfs"), `data` (array of 12). Point: `validTime`, `generatedTime`, `primary`, `secondary`.
- `issuedTime` exists in the answer. **No code in `src/` reads it** (grep). `generatedTime` (14:09:20Z for `BRKM2`, 14:10:13Z for `PORM2`) is later than `issuedTime` and differs by gauge.
- Rate limits and User-Agent rules: not found anywhere in the code. The live answers carried no rate-limit header (I looked at the response headers). I did not read the NWPS documentation. The job's other outside calls (USGS) send no custom User-Agent either (grep of `netlify/`). A Node `fetch` sends the default. Plan: send nothing custom, no contact detail. If NWPS ever rejects the default, the row shows `http: 403` or similar and we learn it.
- CSP and service worker concern the browser only. For info: the browser's NWS calls go through the service worker route `NetworkFirst`, 4 s, cache up to 6 h (`config/runtime-caching.mjs:65-76`). So a visitor can see a series up to 6 hours old when the network is slow. The server archive is NWS's state at the tick, not what each visitor saw.

### 1.3 How a forecast is posted, stored, scored, deleted

- Post. `storeForecastPredictions(periods)` (`src/learning/gf-learning.js:152-207`). Only periods that are display horizons (6, 12, 24, 48) and whose `source` starts with `NWS`. Throttle: once per 2 h per page load, in memory only. The body per horizon: `horizon, targetTime, predictedCFS, predictedStage, source, createdAt (client clock), travelApplied, persistenceCFS`. **No NWS inputs, no observed flow, no estimate are posted.**
- Store. `sync-learning.js` `storeForecastPredictions` action: payload bounds at lines 177-205, `buildForecastRows` at lines 86-107. One `gf_forecast_pending` row per horizon, `gauge_id = +<horizon>h_<batch ms>`, same fields.
- Score. `validateForecastPredictions` (S:2125), called from the handler at S:3207 (step 4b, skipped on ice), BEFORE the success ping. It fetches up to 300 pending rows (S:2155-2160), sorts by `targetTime`, then per row:
  - bad `targetTime`: delete, `cleaned++` (S:2200-2209);
  - not due (`targetTime` + GF to LF travel if `travelApplied`, plus 15 min): skip (S:2215-2221);
  - older than 90 h (`FORECAST_STALE_MAX_AGE_HRS`): delete, `cleaned++` (S:2227-2236);
  - LF outside 500 to 500,000 cfs: skip, row stays (S:2243-2246);
  - else score: error percent against `lf.q` at tick time, upsert `gf_forecast_metadata/<+Nh>` (running totals, S:2254-2281), delete the row (S:2284). If the delete fails the row stays and the totals are already changed (existing behaviour, S:2284-2288).
- Truth time is not kept. `lf.qTime` exists on `usgsData` since v39.2 (used by `buildTickRecord`, S:2793) but the scorer does not use it.
- What is kept today: running totals per horizon (`validations`, `sumAbsErrorPercent`, persistence totals). Nothing per forecast. (TODO A3f; CLAUDE.md "Forecast (48h)".)

### 1.4 Existing log types, limits, helpers (S:2355-3105)

- Types: `tick_log` (180 d), `validation_log` (730 d), `bin_snapshot` (730 d), `log_health` (never pruned). `LOG_RETENTION_DAYS` is a frozen object (S:2364). `LOG_SCHEMA = 3` (S:2361), `SERVER_VERSION = 'v39.11'` (S:2360, hand maintained).
- Keys. `tick_log`: `gauge_id` = the tick start as ISO with milliseconds (S:2792 region, written at S:3077 with `rec.at`). `validation_log`: `<valAt ISO ms>_<pending row id>` (S:2933). `bin_snapshot`: day key. Unique key of the table: `(observation_type, gauge_id)` (`ON_CONFLICT` in `shared/observations.js:15`). A duplicate is a `23505` and counts as "already there" (S:2473).
- Writers. `LogBudget` has two pools, `general` and `tick`, 3000 ms each (S:2412-2430). `timedLogCall` abandons a call after `min(2000, remaining)` ms and charges the time (S:2434-2453). `writeLogRow` never throws and records failures on the budget (S:2459-2481). `flushLogHealth` counts failures in `log_health/system` (S:2487).
- Pruning: `pruneLogType` allow-lists the type from `LOG_RETENTION_DAYS`, refuses a cutoff younger than 30 days, selects at most 100 ids, deletes them with the type predicate repeated (S:3017-3044). `runLogHousekeeping` loops over a hard-coded list of the three types, at UTC hour 3 only (S:3047-3061).
- The Difficult Run pattern (v39.6): `fetchDifficultRun` (S:2685-2728). One `AbortController`, one real timer (2000 ms) over the request and the body, a late-skip when the tick has run more than 20 s (S:2688), every failure becomes a `why` string, result is a plain object. In the handler it runs after the ping in its own try/catch (S:3350-3358).
- No outside call in the job is made by `fetch` to NWS today. Nothing in `netlify/` mentions `api.water.noaa.gov` (grep).

### 1.5 The job's order and time budget (handler S:3114 to 3421)

1. Fetch USGS and temperature. 2. Store PoR history. 3. Validate nowcast. 4b. Validate forecasts (S:3202-3212). 5. Predict and store. 6. `updateRunHealth`. 7. Summary. 8. **Success ping** (S:3335-3345, 5 s cap). 9. Difficult Run (own try/catch). 10. `flushDeferredLogs`, `runLogHousekeeping`, `finalizeTick` (S:3369-3377). 11. Return 200. The `catch` sends the `/fail` ping, then flushes and writes an error tick row (S:3382-3420).
Time. Worst case after the ping today: the Difficult Run skip is decided at 20 s, then 2 s + 3 s general + 3 s tick. About 27.9 s at the worst edge. The 30 s function limit is "from memory, unverified" (TODO A3h). Any new step must keep inside that, or it adds a risk to a job that is otherwise stable.

## 2. Design choices, in one place

| Question | Choice | Why |
|---|---|---|
| New types | `nws_fc` (Part A), `fc_scored` (Part B-lite) | Same table, no migration, same append-only pattern |
| Key of `nws_fc` | `gauge_id` = tick start ISO ms, identical to the `tick_log` key of that run | One equality join. No new conventions. Unique per tick |
| Key of `fc_scored` | `<valAt ISO ms>_<pending row id>` | Same as `validation_log`. Row ids are unique, so no clash |
| One row per tick or per gauge | One row per tick holding both gauges | One insert. About 1 KB. Part failure (one gauge down) is a field, not a missing row |
| Hourly or on change | Hourly | Section 3.3 |
| Schema constant | New `FC_LOG_SCHEMA = 1` for the two new types. `LOG_SCHEMA` stays 3 | Existing rows then stay byte identical. A bump would change `v` in every row |
| Pools | New pools `arch` (2000 ms) and `fcs` (2000 ms) on `LogBudget` | A slow archive write cannot starve validation or tick rows, and the reverse |
| Retention | 730 days for both (owner decision, section 8) | Fair comparison needs seasons and rare floods. About 25 MB for `nws_fc` |
| Kill switch | env `NWS_ARCHIVE=off` skips Part A (default on) | Cheap, mirrors `USGS_SOURCE`. Optional (section 8) |
| Tick row | Not changed | Keeps "every existing row byte identical". Failures show in existing `log_health` and `tick_log.aux.logFail` (existing paths) |

## 3. Part A: the Weather Service archive

### 3.1 What is fetched

Per tick, two GETs in parallel, each the FIRST browser variant only: `https://api.water.noaa.gov/nwps/v1/gauges/BRKM2/stageflow/forecast` and `.../PORM2/stageflow/forecast`. The LIDs come from a small server constant `NWS_ARCHIVE_GAUGES = { '01646500': 'BRKM2', '01638500': 'PORM2' }`, not from the browser file (the server cannot import `src/` ESM; a test checks the two ids and LIDs equal `NWS_LIDS`). No fallback to the long `/stageflow` form (500+ points): if the short form fails, the row says so.
Not archived: the other 15 gauges in `NWS_LIDS`. They only feed the gauge-list trend. If the forecast-from-upstream study (TODO D26) wants Shenandoah, Monocacy and the others, that is a later one-line change to the constant (section 8, Q6).

### 3.2 Row layout: `nws_fc`

`gauge_id` = tick start ISO ms (the `tick_log` key). Example:

```json
{
  "v": 1,
  "ver": "v39.15",
  "at": "2026-11-24T18:00:03.412Z",
  "ft": 1764007203900,
  "ms": 640,
  "g": {
    "BRKM2": {
      "site": "01646500",
      "http": 200,
      "why": null,
      "ms": 312,
      "iss": 1763992740000,
      "gen": 1763993360000,
      "u": "kcfs",
      "pu": "ft",
      "pedts": "HGIFF",
      "n": 12,
      "sig": "9f2c1a4e",
      "pts": [[1764007200000, 2.7, 1.48], [1764028800000, 2.7, 1.48]]
    },
    "PORM2": { "site": "01638500", "http": 200, "why": null, "ms": 355, "iss": 1763992740000, "gen": 1763993413000, "u": "kcfs", "pu": "ft", "pedts": "HGIFF", "n": 12, "sig": "b71d0c33", "pts": [[1764007200000, 1.3, 1.76]] }
  }
}
```

(Numbers above are illustrative, built from the 2026-11-24 live sample; the epoch values are not exact.)

| Field | Type, unit | Meaning |
|---|---|---|
| `v` | int | `FC_LOG_SCHEMA` |
| `ver` | string | `SERVER_VERSION` |
| `at` | ISO ms | Tick start. Equals the `gauge_id` and `tick_log.at` |
| `ft` | epoch ms | Fetch start time |
| `ms` | int | Whole step duration, fetch to parsed |
| `g.<LID>.site` | string | USGS id the browser files this series under |
| `http` | int or null | HTTP status; null when no answer |
| `why` | string or null | null when clean. Else `timeout`, `fetch_error`, `http_error`, `parse_error`, `shape` (no usable array or no point with a `validTime`), `late_skip`, `internal_error` |
| `ms` (per gauge) | int | Request plus body time |
| `iss` | epoch ms or null | Top-level `issuedTime`. The forecast's own issue time |
| `gen` | epoch ms or null | Largest `generatedTime` in the points |
| `u`, `pu` | string | `secondaryUnits` and `primaryUnits` as received. The browser ignores `u` and multiplies by 1000, so storing it lets a replay detect a unit change |
| `pedts` | string | As received. Cheap, may flag a product change |
| `n` | int | Number of points stored |
| `sig` | string | First 8 hex of a SHA-1 over the `pts` JSON (Node's built-in `crypto`). Lets an analyst find reissues without comparing arrays |
| `pts` | array of `[validTime epoch ms, primary, secondary]` | Raw numbers as received (stage in the answer's `primaryUnits`, flow in `secondaryUnits`), no rounding, no unit conversion, same order. A point with no parseable `validTime` is dropped (the browser would also get NaN from it). `null` for a missing number |
| `rawHead` | string, only when `why` is `shape` or `parse_error` | First 1000 characters of the body, `<url>`-scrubbed with the existing `logMsg` rule, so a changed response shape can be read later |

The array selection copies the browser's path list in `parseNWSForecast` (N:108-123), because the same shape drift would hit the browser. A parity test (section 5) runs the browser parser and the server parser on the same fixtures and compares which array was picked.

### 3.3 Every hour, or only when the issue time changes

Recommendation: every hour.
- The live sample shows `generatedTime` (14:09 and 14:10) after `issuedTime` (13:59) and different between gauges. `issuedTime` alone is not a safe change marker. A reissue with the same `issuedTime` but new numbers would be missed.
- Change detection needs a read of the last row each hour (one more round trip, one more failure mode), or an in-memory value that the function does not keep between runs.
- Cost of every hour is small. One row is about 1.0 KB of data plus about 0.35 KB of key and index (an assumption, as in the A3 plan; to be measured). 8,760 rows a year, about 12 MB a year, about 25 MB at 730 days. That is well inside what the A3 plan accepted (about 25 MB realistic).
- Every hour also gives a clean "what NWS said at hour H" for any H, which is what the replay needs. With on-change storage the replay would have to assume the series did not move between issues. `sig` lets analysts collapse repeats afterwards.
- Cost of the alternative, if the owner prefers it: about 3 to 4 times less data, plus one read a tick and a "pointer" row per hour (the "small hourly pointer" of the brief). That is two writes a tick instead of one. Not recommended.

### 3.4 Time bounds, order, failure handling

Order inside the job (the success ping stays exactly where it is, nothing new before it):
1. Ping (unchanged, S:3335-3345).
2. NEW: immediately after the ping, start `const nwsP = fetchNwsArchive(tickStartMs)`. It never rejects. It runs in parallel with the Difficult Run fetch, so it adds no wall time on top of it.
3. Difficult Run block (unchanged, S:3350-3358).
4. NEW: `const nws = await nwsP`. Then, if the tick has run 22 s or less, `writeLogRow(client, 'nws_fc', at, rec, budget, 'arch')`. Skipped otherwise (recorded as a `budget` failure through the normal path).
5. `flushDeferredLogs`, `runLogHousekeeping`, `finalizeTick` (unchanged).
6. NEW (Part B): `fc_scored` writes (section 4).
7. Return (unchanged).

`fetchNwsArchive(tickStartMs)`:
- Skipped (`why: late_skip`, no request) when the tick has already run more than 15 s. Stricter than the Difficult Run's 20 s because it adds a second step (arithmetic in 3.5).
- One shared `AbortController`, one real timer of 2500 ms over BOTH requests and both body reads, as `fetchDifficultRun` does for one. When the timer fires, both are aborted, and each gauge records `why: timeout` (or the part that already finished is kept). Whole thing wrapped so it returns `{rows}` and never throws.
- Per gauge: non-OK answer gives `http_error` plus `http`; a body that is not JSON gives `parse_error`; no usable array gives `shape`. A changed response shape, a timeout, a 429 or a 5xx still produce a row, with `why` set and the other gauge intact. Failures never reach the handler's `catch`, never send `/fail`, never change the status or body.
- A row is written even when both gauges failed or the fetch was skipped (it is the gap record). With `NWS_ARCHIVE=off` nothing is fetched and nothing is written.
- If the insert fails or times out: the existing `writeLogRow` path records it in `log_health` and in `tick_log.aux.logFail`. Nothing else changes.

### 3.5 Time arithmetic

New after-ping cost, worst case: fetch runs inside the Difficult Run window (adds 0.5 s beyond its 2 s cap when slow), then the archive write at most 2000 ms, then the Part B writes at most 2000 ms. With the guards: nothing starts after 22 s (Part A write) or 24 s (Part B). Existing worst case 27.9 s becomes at most about 26 s for the new writes because the guards stop them. A slow tick loses its archive row. That is the right side to fail on, and the gap is visible as a missing `nws_fc` key. All of this rests on the unverified 30 s limit.

Typical cost: two GETs of about 2 KB in parallel with a call that is already there, one insert of about 1.4 KB. Round trips per tick: one outside request pair, one database insert.

### 3.6 Retention and pruning

- `LOG_RETENTION_DAYS` gains `nws_fc: 730` and `fc_scored: 730`. `runLogHousekeeping` loops over `Object.keys(LOG_RETENTION_DAYS)` or the list gains the two names (the list is hard-coded at S:3053).
- Order check: both keys start with a fixed-width ISO time, so text order equals time order (same argument as A3 section 10).
- First possible prune is in November 2028. Until then the delete path for these types is proven only by mocks. That is an unverified gap (TODO A3c has the same gap for `tick_log`).
- Batch limit. `PRUNE_BATCH` is 100 a day per type. `nws_fc` writes 24 a day, so it drains. `fc_scored` volume is unknown (section 4.4). If it exceeds 100 a day the prune cannot keep up. The plan: loop up to 3 batches for `fc_scored`, inside the existing `general` pool. Decide after measuring (Q4).

## 4. Part B-lite: scored visitor forecasts

### 4.1 Where the rows are collected

`validateForecastPredictions(client, usgsData, fcOut = null)`: a new optional third parameter, write-only, like the `trace` parameter of `makeGFPrediction` (A3 section 4). Return value `{validated, cleaned}` is unchanged. At each of three exits, after the delete has succeeded, it pushes one plain object of copied primitives into `fcOut` inside `try { } catch { }`:
- `scored`: after the delete succeeds, the same place `validated++` runs (S:2289).
- `stale_deleted`: after the delete succeeds (S:2233).
- `bad_target_deleted`: after the delete succeeds (S:2206).
Rows skipped (not due, LF out of range, delete failed) leave the row in place and log nothing. A delete failure means the row will be seen again; it is logged when it finally leaves. (The existing scorer changes the running totals before the delete; if the delete then fails the totals double count on the next tick. That is an existing issue, not touched here. Noted in the risks.)
The handler passes a local array, `tickCtx.fc = []`, and keeps it. Nothing reads it before the ping.

### 4.2 Row layout: `fc_scored`

`gauge_id = <valAt ISO ms>_<pending row id>`. `valAt` is the tick's `now` used by the scorer (one value per tick).

```json
{
  "v": 1, "ver": "v39.15", "outcome": "scored",
  "predId": "c2b1...", "hz": 24, "src": "NWS", "trvApplied": true,
  "cfs": 4210, "stg": 3.18, "persist": 4390,
  "tgt": "2026-11-25T18:00:00.000Z",
  "mk": "2026-11-24T14:41:07.120Z", "ck": "2026-11-24T14:40:58.004Z",
  "dueAt": "2026-11-25T20:45:00.000Z", "valAt": "2026-11-25T21:00:04.100Z", "lagMin": 15.1,
  "trv": 6.9,
  "act": { "q": 4105, "qT": 1764093900000 },
  "errCFS": 105, "errPct": 2.6, "absPct": 2.6, "persistAbsPct": 6.9,
  "tickAt": "2026-11-25T21:00:03.390Z"
}
```

(Illustrative numbers. `dueAt` in the example is for layout only.)

| Field | Source in the scorer |
|---|---|
| `outcome` | `scored`, `stale_deleted`, `bad_target_deleted` |
| `predId`, `hz`, `src`, `trvApplied`, `cfs`, `stg`, `persist`, `tgt`, `ck` | The pending row's `id` and `data` (`horizon`, `source`, `travelApplied`, `predictedCFS`, `predictedStage`, `persistenceCFS`, `targetTime`, `createdAt`) |
| `mk` | `pred.created_at`: the database's time of the post. `ck` is the visitor's clock. Both are kept so a clock error is visible |
| `dueAt` | `targetTime` + travel offset (`dueTime`, S:2216) |
| `valAt`, `lagMin` | `now`, and minutes from `dueAt` to `valAt` |
| `trv` | `forecastTravelHrs` as used (S:2149), or 0 for rows with no offset |
| `act.q`, `act.qT` | `lf.q` and `lf.qTime`: the truth and the time of that reading. Today's scorer does not keep the time |
| `errCFS`, `errPct`, `absPct` | `predictedCFS - actualCFS`, signed percent of actual, and the existing absolute percent |
| `persistAbsPct` | Existing persistence error, or null |
| `tickAt` | Tick start ISO, so the row joins to `tick_log` and `nws_fc` |
Stale and bad-target rows carry only the identity and values part (no `act`, no errors).

### 4.3 Writing

After `finalizeTick` and before the return. A new pool `fcs` (2000 ms). Each row goes through the existing `writeLogRow` one by one, capped at 40 rows a tick. The cap and any skipped rows are counted in `log_health` through the normal failure path (`reason: budget`). A guard skips the step when the tick has run more than 24 s. One insert is tens of ms to a few hundred ms (an assumption, not measured), so 40 rows fit in 2 s only on a fast database. If the first week of data shows `fc_scored` budget skips, switch to a batched `upsert` with `ignoreDuplicates` (needs a test-helper extension, section 5). Not done now: bias toward less.

### 4.4 Volume (unknown, bounded by a formula)

Rows a day = 4 horizons x visitor posts a day (the throttle is per page load, 2 h, in memory, so it scales with visits). Row is about 0.45 KB plus index. At 50 posts a day: 200 rows, about 0.16 MB a day, about 58 MB over 730 days. At 10 posts a day: about 12 MB. I did not read the database. A read-only count is available for free: the per-horizon `validations` totals in `gf_forecast_metadata` (running since 2026-08-28) divided by the days elapsed gives the rate. Do that before locking retention for `fc_scored` (Q4).

## 5. Files to change, and what must not change

| File | Change |
|---|---|
| `netlify/functions/scheduled-update.js` | (a) `SERVER_VERSION = 'v39.15'`. (b) New consts: `FC_LOG_SCHEMA`, `NWS_ARCHIVE_GAUGES`, `NWS_ARCHIVE_CAP_MS = 2500`, `NWS_LATE_SKIP_MS = 15000`, `NWS_WRITE_GUARD_MS = 22000`, `FCS_WRITE_GUARD_MS = 24000`, `FCS_MAX_ROWS = 40`. (c) `LOG_RETENTION_DAYS` plus two keys. (d) `LogBudget`: two more pools `arch`, `fcs`, with a defaulted constructor argument so existing `new LogBudget(g, t)` callers are unchanged. (e) New pure functions `parseNwsForecastBody(json)`, `buildNwsFcRecord(res, tickStartMs, ver)`, `buildFcScoredRecord(outcome, pred, ctx)`, and `fetchNwsArchive(tickStartMs)`. (f) `validateForecastPredictions` gets the optional `fcOut` parameter and three guarded pushes. (g) Handler: start the fetch after the ping, await it after the Difficult Run block, write the archive row, write `fc_scored` rows after `finalizeTick`. (h) `runLogHousekeeping` prune list. (i) `_test` exports. |
| `index.html` | Version strings only: `<meta name="app-version">` and the small footer text, as in v39.12 (server only releases still move them, and `test/howitworks-text.test.mjs` requires all places to agree). No behaviour. |
| `CLAUDE.md`, `README.md`, `TODO.md`, `src/assets/CHANGELOG.md`, `src/assets/tech-appendix.md` | Section 7. |
| `test/helpers/mem-supabase.js` | One line: add `nws_fc` and `fc_scored` to `LOG_TYPES`. Without it the existing handler tests count the new rows as non-log writes and fail (`prediction-logging-handler.test.js:116, 361, 414`, `truth-dr-handler.test.js:122-141`). This is a real edit to an existing test file. It is the one place a test must change because a type is added. The auditor checks it is only that line. |
| `test/prediction-logging-writer.test.js` | Line 531 asserts `LOG_RETENTION_DAYS` deep-equals the three types. It must change to the five. Same reason, same check. |
| New test files | Section 6. |

Must NOT change:
- `netlify/functions/shared/model.js`, `src/model/*`, `src/estimation/*`, `src/ui/*`, `src/learning/*`, `netlify/functions/sync-learning.js`, `shared/observations.js`, `netlify.toml`, `config/runtime-caching.mjs`. No client change is needed: the whole of Part A is a server fetch. (A client change would be needed only if the archive had to hold what each visitor saw. That is not the goal, and B-lite covers the part that matters.)
- Everything the job writes today: estimate, pending row, bins, metadata, history, `tick_log`, `validation_log`, `bin_snapshot`, `log_health` (except through its normal failure counters).
- The success ping position, the `/fail` ping, the status code and the body.
- `LOG_SCHEMA` (stays 3), `tick_log` fields, the order of existing writes.
- `validateForecastPredictions`' return value and its DB writes, deletes and order.

## 6. Tests to add (`node --test`, as the v39.2 and v39.6 logging tests)

Seams: same as `prediction-logging-handler.test.js` (env set first, `getSupabase` patched before require, `t.mock.timers`, the in-memory client). The `fetch` mock must answer the two NWS URLs and the ping URL `hc-ping.test` (never `hc-ping.com`). Existing handler tests that mock `fetch` must still pass: make the default mock answer an unknown URL with a network error, so the new step records `fetch_error` and writes a row. The auditor checks that no existing handler test had to be edited to hide the new step beyond the two lines in section 5.

| ID | Test | Regression it catches |
|---|---|---|
| N1 | Parser: the saved live fixtures (`test/fixtures/nws-brkm2.json`, `nws-porm2.json`, made from the 2026-11-24 answers, ids and times only, no personal data) give `n 12`, `iss`, `gen`, units, exact `pts`. Odd shapes: `json.data` missing, nested paths from `parseNWSForecast`'s list, no `validTime`, a non-numeric `secondary`, empty array, HTML body, `kcfs` missing | Wrong parse; silent shape drift |
| N2 | Parity: import the browser `parseNWSForecast` and the server parser (ESM dynamic import, as the other `.mjs` parity tests) over every N1 fixture; both choose the same array. Also: `NWS_ARCHIVE_GAUGES` equals the two matching entries of `NWS_LIDS` | Server and browser choosing different series |
| N3 | `fetchNwsArchive` with fake timers: exact URLs (two GETs, upper-case LID, `/stageflow/forecast`), no custom header; clean; one gauge 500 and the other fine; 429; 403; bad JSON; HTML 200; network error; hang before headers: ends at 2500 ms and aborts; body never ends: still ends at 2500 ms; late tick (more than 15 s): zero requests, `late_skip`; a Response with throwing getters is a result, not a throw | Hung or failing NWS call delaying or failing the job |
| N4 | `buildNwsFcRecord`: example shape, size under 3 KB with 12+12 points, all numbers finite or null, `rawHead` only on `shape`/`parse_error` and URL-scrubbed, inputs deep-frozen (no mutation), `sig` stable for equal series and different for one changed value | Shape, size, leaks |
| N5 | Handler: a normal tick writes exactly one `nws_fc` row; `gauge_id` equals the single `tick_log` key; ping happens BEFORE the `nws_fc` insert; same with NWS hanging and with NWS rejecting | "Nothing before the ping"; join key |
| N6 | Equivalence (the T5b pattern): record every non-log DB write and its payload plus the handler return value over a full tick with the archive ON, OFF (`NWS_ARCHIVE=off`), NWS hanging, NWS erroring, and the `nws_fc` insert hanging or rejecting. Sequences, payloads and return value identical. Existing log rows (`tick_log`, `validation_log`, `bin_snapshot`, `log_health` aside from failure counters) are byte identical once the timing fields (`ms`, `at`-derived durations) are removed. Estimate (`final`) identical | Coupling into estimate or existing rows |
| N7 | Timing: with `nws_fc` and `fc_scored` inserts hanging, total added time after the ping stays within the pool caps (2 s + 2 s plus the guard), and the `tick_log` row is still attempted and lands (`tick` pool untouched). With the tick already 23 s old: no `nws_fc` write; 25 s old: no `fc_scored` write | Slow step eating the tick row or the limit |
| N8 | Pool isolation: hang `nws_fc` writes, `validation_log` writes still use the `general` pool and land; the reverse | Starvation |
| F1 | `validateForecastPredictions`: with and without `fcOut`, the return value and every DB write (order and payload) are identical, including a throwing push (monkeypatched array whose `push` throws) | The out-parameter changing scoring |
| F2 | Rows: one `fc_scored` row per scored row, with the fields in 4.2; `act.qT` equals `lf.qTime`; `errPct` sign; `stale_deleted` and `bad_target_deleted`; nothing for not-due rows, out-of-range LF, or a failed delete; a row whose delete failed is logged only when it finally leaves | Missing or double rows |
| F3 | Handler: scored rows appear after the ping and after the tick row; cap of 40; the 41st is a `budget` failure counted in `log_health`; a failing insert is counted, run unaffected | Order, bound |
| P1 | Prune with the filter-evaluating mock: `nws_fc` and `fc_scored` are pruned at their cutoff (older rows go, younger stay, other types untouched); allow-list still refuses unknown types; hour 3 only; the 30-day floor; 100 per batch; URL under 8 KB. Existing tests for the three old types stay green | Deleting something it should not |
| S1 | Source scans: `sync-learning.js` mentions neither new type; no `hc-ping.com` literal in any new test or in the job; no header named `User-Agent` set by the new code | Exposure; contact details |
| R1 | Unchanged tests: `git diff --stat` on `test/characterization`, golden fixtures, the three parity tests, `forecast-validation-timing.test.js`, `cron-fail-ping.test.js` must be empty. The two single-line edits of section 5 are the only edits to existing tests | Silent weakening |

Count: record the `npm test` count before and after (README says 1617 at v39.14).

## 7. Version and documents

- v39.15, MINOR (no estimation change, per the Versioning Rules), server only, logging only. `SERVER_VERSION` moves from `v39.11` to `v39.15` (it has been stale since v39.12; the `commit` field is null in every row, TODO A3j, so this constant is the only code marker).
- Places named by the rules and by `test/howitworks-text.test.mjs`, all moved together: `CLAUDE.md` (the "Current Model Parameters (v39.14)" heading, plus a new bullet "Forecast archive (v39.15)"), the Tech Appendix "Current version" line and the "Generated by Potomac Pulse" footer line, `index.html` `<meta name="app-version">` and the footer text, `README.md` ("Current Version", version table row, test count), `TODO.md` ("current version"), `src/assets/CHANGELOG.md` (a `| v39.15 |` row: the test requires one).
- Also in those files:
  - `CLAUDE.md`: "Audit logging (v39.2)" says four append-only types and lists stored `gauge_id` values: add the two new types and their key forms. "Forecast (48h)" validation paragraph: say scored forecasts are now also logged. Do not edit the estimate sections.
  - Tech Appendix: new section 6.10.2 (rows, fields, joins, retention, example SQL for replay), a v39.15 paragraph in the version list, the "Not logged:" sentence at line 582 (scored forecast rows are now logged), the volume table.
  - `TODO.md`: A3f becomes "logging live (v39.15)" with the verification rows; A3h still open. Add: first prune of the new types (2028), `fc_scored` volume measurement, NWS cache and rate-limit note, the dead Edwards Ferry forecast branch (section 9.1), the forecast bias-offset behaviour (1.1.7).
  - `CLAUDE.md` "sub-1% EF blend" claim (also in the Tech Appendix line 15): flag for the owner. Do not change it in this release (section 9.1).
- Not changed: `src/assets/how-it-works*` text (nothing visible changes).

## 8. Open questions and decisions for the owner (each with my recommendation)

1. **Retention for `nws_fc` and `fc_scored`.** Recommend 730 days both (about 25 MB for `nws_fc`; `fc_scored` after measurement). Longer is cheap if the forecast study wants more flood seasons (365 days more costs about 12 MB). The 500 MB versus 2 GB plan limit is still unchecked (TODO A3h).
2. **Hourly or on change.** Recommend hourly (section 3.3).
3. **Errors in the tick.** On a tick where the job throws, no archive is written (the fetch runs only on the success path). That is a gap exactly on bad-USGS hours. Recommend accept; the alternative is a second fetch in the `catch`, which adds risk to the failure path. Ask only if the owner wants completeness.
4. **`fc_scored` volume.** Measure the posts a day from `gf_forecast_metadata` before the push. If above about 100 rows a day, add the batched write and the multi-batch prune.
5. **Rows for swept (stale, bad-target) forecasts.** Recommend yes: they show how many forecasts never got scored and why. Cost small.
6. **More gauges.** Only the two the forecast uses. The other 15 in `NWS_LIDS` (upstream, for the D26 study) are one constant away. Recommend no now (scope, "bias toward less"); decide after the owner confirms D26 Stage 1.
7. **Kill switch `NWS_ARCHIVE=off`.** Recommend yes. It is five lines and a test.
8. **Whether to also fix the dead Edwards Ferry branch and the bias-offset oddity.** Out of scope here. Recommend a separate TODO and a decision after the replay exists; changing the forecast now would destroy the comparison baseline.

## 9. What I think is wrong in the recommended design, and risks (most serious first)

### 9.1 The forecast has two series, not three (design assumption wrong)
The brief lists Little Falls, Edwards Ferry and Point of Rocks "as far as the forecast uses them". Edwards Ferry is not requested at all (1.1.3), so it is not archived. The Edwards Ferry blend never happens in the browser forecast; CLAUDE.md and the Tech Appendix say "a sub-1% EF blend below ~6k cfs", which overstates it (it is zero today). I did not run the page to confirm. A verifier should run the page or a test that calls `updateForecastPeriods` with a stub.

### 9.2 The archive is not "what the visitor saw" (design claim too strong)
Browsers read NWS through a NetworkFirst service-worker route with a 6 h cache fallback. They fetch at their own times. The archive gives NWS's state each hour for everyone. That is the right base for a fair comparison. It is not a record of each visitor's input. B-lite stores the visitor's output, so the two together are enough, but the plan must not claim more.

### 9.3 The replay also needs `gfEst.cfs` and observed flow, which the archive does not hold
They are in `tick_log` (`final.cfs`, `in.lf`, `in.por`). `final` is null on ticks with no prediction (ice, missing input, or a stored-nothing tick). On those hours a replay cannot rebuild the travel multiplier exactly. The plan: use `in.lf.q` as the stand-in for the multiplier on those hours and say so. The server estimate also differs slightly from the visitor's (different time, different learning payload). The effect is small (it enters through the GF to LF travel, about flow^0.4 or so, and the dead EF weight); not measured here.

### 9.4 The hourly grid is not the browser's clock
The browser interpolates from its own `now`. The archive row is at `:00`. A replay at the tick time differs from a visitor at `:37` by 37 minutes of slope (series points are 6 hours apart, so the slope is shallow, but bias offset uses the first point, which can jump when a reissue lands). Fine for comparing alternatives on the same grid. Wrong for reproducing a particular visitor's card to the cfs.

### 9.5 New outside call in the job
Two requests an hour to NWPS from a new place (Netlify's address). If NWPS rate-limits or blocks it, rows show `http_error` and nothing else breaks. Unknown: real rate rules; NWPS is a public service and 2 requests an hour is tiny against what each page load does (17 or more). Not verified live from Netlify (only from this machine).

### 9.6 Function time limit
All the new time rests on the unverified 30 s limit (A3h). The guards (15 s, 22 s, 24 s) keep the worst case near 26 s. If the limit is lower, the same logging that already exists is at risk first.

### 9.7 Existing tests must change in two lines
`LOG_TYPES` in the mock and the retention assertion at `prediction-logging-writer.test.js:531`. If an implementer edits more, flag it.

### 9.8 Existing scoring double count if a delete fails
Not caused by this work, not fixed (S:2277-2288). B-lite logs a forecast only after the delete succeeds, so the log can show fewer rows than the running totals count in that rare case. Document it.

### 9.9 `fc_scored` volume is unknown
Handled by the cap of 40 a tick and Q4.

### 9.10 Table access
Anyone with the anon key can read these rows (the table still has "Allow public reads"). The content is public NWS data plus our forecasts. Nothing secret. Not tamper-evident (same caveat as the A3 logs).

## 10. Two alternatives (the owner's rules ask for this)

### Alternative 1: the client posts all its inputs with each forecast (no server fetch)
- What: `storeForecastPredictions` also sends the two series, observed LF, the estimate. The server stores them in the pending row or a log row.
- For: records exactly what each visitor saw, including a service-worker-cached old series. No new outside request in the job.
- Against: needs a client change (the plan's rule: only if Part A is impossible without one; it is not). A public unauthenticated write path would take about 2 KB of attacker-controlled data per post (needs new payload bounds in `validateGFWritePayload`, line 141). The sample is the same uneven, visitor-driven sample the brief calls unfair: quiet hours and nights are missing, and one busy hour gives many. Old clients (cached service worker, TODO v39.13 note) keep posting the old shape for days. Cannot compare alternatives on hours when nobody visited. Larger row sizes per post.
- Verdict: weaker as the base. Worth a later thin add-on only if the owner needs the "what the visitor saw" record.

### Alternative 2: the server computes the whole forecast itself every hour (a port of the browser logic)
- What: port `updateForecastPeriods` (interpolation, bias offset, travel, EF blend, stage) into the job, store the result per hour, score it directly.
- For: a visitor-independent forecast series with no replay needed. Scoring would not depend on posts.
- Against: a second copy of model logic. The project's rule is that such copies need parity tests and are kept to a minimum (CLAUDE.md "Versioning Rules": the sync pairs). It would be a MAJOR-risk change to load-bearing code and needs the full verification protocol. It freezes today's forecast in a second place before the alternatives are known. It cannot recompute for hours before it ships, unlike a raw archive that can be replayed with any formula later. It also stores the output, not the input, so a bug in the port is baked into the record.
- Verdict: not now. The raw archive (Part A) keeps this option open: a port can be validated later against `fc_scored` rows and the archive.

## 11. Verification path (stated up front, per the global rules)

Fresh Opus verifier (never the implementer), given the goal and the diff only, not this conversation:

Before the push:
1. Run `npm test` (`USGS_API_KEY=` etc. as in `package.json`). Report counts before and after.
2. Check R1 (no edits under characterization, golden, parity, timing, fail-ping tests) and that the only edits to existing tests are the two lines of section 5.
3. Run mutants in a scratch copy and show tests fail: (a) move the NWS fetch or the `nws_fc` write before the ping; (b) remove the 15 s late-skip; (c) remove the timer so a hang waits; (d) write `nws_fc` into the `general` pool; (e) have `validateForecastPredictions` change a payload when `fcOut` is set; (f) set `LOG_SCHEMA` to 4; (g) add a header `User-Agent` with a contact string; (h) let a NWS failure throw into the handler `catch`.
4. Read the diff for: nothing on the estimate path, no reference to `fcOut` or `nwsP` before the ping, no secret or personal detail in a header or a log line, `rawHead` URL-scrubbed.
5. Confirm by test that nothing in `shared/model.js`, `src/`, `sync-learning.js` changed.

On the live system after the push (read-only SQL on the first hours, `ver = 'v39.15'`):
1. First `nws_fc` row exists for the first tick after deploy. Its `gauge_id` equals the `tick_log` key of that tick. Two gauges, `http` 200, `why` null, `n` 12 each, `iss` within 48 h of `at`.
2. Fetch the same two NWPS URLs within minutes and compare `iss` and `pts` with the row (they may differ if a reissue landed in between; same `iss` must have the same `pts`).
3. The tick row of the same hour: `out`, `why`, `ms` in the normal range; `ms` vs earlier ticks to see the added time (expect no more than a few hundred ms on a normal tick); `aux.logFail` empty; `log_health` counters unchanged or explained.
4. 24 hours later: 24 `nws_fc` rows with no gap; count of rows with `why` not null; `pg_column_size` of a row (replace my 1.0 KB guess).
5. After the first visitor forecast ripens: `fc_scored` rows well formed (`act.qT` close to `valAt`, `lagMin` plausible, `tickAt` joins).

What stays an UNVERIFIED GAP (cannot be confirmed before or at deploy):
- Whether the success ping still arrives in time on the live system. The tick row is written after the ping but the ping can fail silently and non-fatally, so a row proves the order, not delivery. The owner must look at the healthchecks dashboard; this plan must not send anything to hc-ping.com.
- The 30 s function limit and the real post-ping duration on a slow day.
- NWPS behaviour from Netlify's address (rate limits, blocking, shape changes later).
- `fc_scored` rows appear only after a visitor posts and the forecast ripens (6 h to about 65 h). Days may pass with none. The non-scored outcomes may take weeks.
- The first prune of the new types (2028) and a retention that cannot be tested on live data.
- `COMMIT_REF` is null (A3j): rows identify code only by `ver`.
- Whether the browser really never has an Edwards Ferry forecast (code reading only).
- Any real-screen effect: none expected (no client change); not checked in a browser.

## 12. Order of work (for later, after the audit)

1. Auditor reviews this plan (protocol step 2). Owner answers section 8.
2. Fixtures from the live answers; N1, N2 tests first (parser). 3. `fetchNwsArchive` and its tests. 4. Builders and handler wiring, N5 to N8. 5. `fcOut` and `fc_scored`, F1 to F3. 6. Prune, P1, S1. 7. Docs and version (section 7). 8. Fresh verifier (section 11). 9. Commit and push only when the owner says (the repo rule is to push after changes; the global rule asks for a verification path first, which is section 11).

# Plan audit: forecast-archive-plan-2026-11-24.md (DRAFT 1)

Auditor: independent, fresh. Date: 2026-11-24. Code read on this date. "S" = `netlify/functions/scheduled-update.js`, "UI" = `src/ui/great-falls-ui.js`, "N" = `src/estimation/nws.js`.

## Verdict

GO WITH CHANGES. The idea and most facts hold, but the plan's write order delays the existing tick row and raises the worst-case run time instead of lowering it. Its claim that only two lines of existing tests change is false. The archive also cannot be replayed for its proposed 730 days, because the inputs it joins to are deleted at 180.

## Findings (most serious first)

### 1. MUST: the `nws_fc` write sits in front of the existing tick row, and the time arithmetic in 3.5 is wrong
- Evidence. Today, after the ping (S:3346-3354), the order is: Difficult Run (S:3359-3365), `flushDeferredLogs` (S:3372), `runLogHousekeeping` (S:3373), `finalizeTick` (S:3374). Plan 3.4 step 4 puts `await nwsP` and the `nws_fc` insert (up to 2000 ms, `LOG_WRITE_CAP_MS`, S:2366, 2437) BEFORE step 10. So every existing post-ping log write, the tick row included, can start up to 2.5 s later (up to 0.5 s of fetch beyond the 2 s Difficult Run cap, then up to 2 s of insert).
- Recomputed from the timers. Today's post-ping maximum is: Difficult Run 2.0 s (`DR_CAP_MS`, S:2529, only if the ping ended by 20 s, S:2530), then the general pool 3.0 s (S:2365), then the tick insert. The tick pool holds one call capped at 2.0 s (S:2437, 3077), so its real maximum is 2.0 s, not 3. That makes about 7 s after the ping. The worst end today is about 20 + 2 + 3 + 2 = 27 s (not 27.9).
  - Plan as written, ping ends at 19.99 s: the fetch is late-skipped (15 s), the Difficult Run runs to 21.99 s, and the gap row is still written because 21.99 ≤ 22 s, for up to 2 s, to 23.99 s. Then general 3 s and tick 2 s end at about **29.0 s**. That is 2 s worse than today and 1 s from the unverified 30 s limit (TODO A3h).
  - Ping ends at 21 s: today about 26 s, plan about 28 s.
  - The plan says "becomes at most about 26 s". That is wrong. Its guards limit when a new write STARTS, not when it ENDS, and the work they guard pushes the existing writes later.
- The existing run has no absolute deadline. Time before the ping is unbounded: the USGS retry, a scorer loop over up to 300 rows with 3 DB calls each (S:2155-2290), and a ping of up to 5 s. So "worst case 27.9 s" is only the worst case on ticks where the Difficult Run runs. The plan should say so.
- It also contradicts the plan's own N6. A hung `nws_fc` insert is noted on the budget before `finalizeTick` copies `budget.fails` into `tick_log.aux.logFail` (S:3074). So `tick_log` would NOT be byte-identical across N6's arms.
- Change:
  - Start the fetch right after the ping, as planned.
  - Await it and write `nws_fc` only AFTER `finalizeTick` has returned, so the existing order is unchanged and the tick row comes first.
  - Then write `fc_scored`.
  - Replace the start-only guards with one absolute deadline, for example `NEW_LOG_DEADLINE = tickStart + 25 s`. Each new call gets `cap = min(2000, deadline - now)` and is skipped when that cap is ≤ 0. That bounds the END time of all new work at 25 s whatever the tick did before.
  - Rewrite 3.5 with the corrected numbers.

### 2. MUST: `fc_scored` failures after `finalizeTick` never reach `log_health`
- Evidence. `flushLogHealth` runs only inside `finalizeTick` (S:3075, 3078) and in the catch path. Plan 4.3 writes `fc_scored` after `finalizeTick` and says skipped rows are "counted in `log_health` through the normal failure path". They are not: `budget.noteFailure` (S:2420) only fills memory, and nothing flushes it after the tick row. Plan test F3 ("the 41st is a budget failure counted in log_health") cannot pass as designed. The same applies to `nws_fc` once it moves after the tick (finding 1).
- Change: after the new writes, call `flushLogHealth` once more. Run it under the same absolute deadline and give it its own small allowance; the `general` pool may already be spent. Or state plainly that new-type failures are not counted, and drop the F3 claim. The first is better.

### 3. MUST: `nwsP` must have a rejection handler attached when it is created
- Evidence. The plan starts `const nwsP = fetchNwsArchive(...)` and awaits it only after the Difficult Run (up to 2 s later). "It never rejects" rests on the function's own try/catch. If any path escapes (a bug, a throwing getter outside the inner try, a synchronous throw in a helper), the promise rejects with no handler. Node then raises `unhandledRejection`, which by default ends the process (Node 15 and later). On Lambda that kills the invocation after the ping: the tick row is lost, and Netlify records an error while healthchecks recorded success.
- Change: `const nwsP = fetchNwsArchive(tickStartMs).catch(() => ({ rows: null, why: 'internal_error' }));` at the call site. Add a mutant to 11.3: make `fetchNwsArchive` throw. The handler must still return 200 with exactly one ok ping and one tick row, with no unhandled rejection (use `process.on('unhandledRejection')` in the test).

### 4. MUST: the replay inputs expire at 180 days, while the archive keeps 730
- Evidence. The plan's replay table (1.1 item 6) takes observed LF, PoR and `gfEst.cfs` from `tick_log` (`in.lf`, `in.por`, `final.cfs`, S:2801-2802, 2840). `tick_log` is kept 180 days (S:2364). Plan 2 and 8.1 choose 730 days for `nws_fc` "for seasons and rare floods". From day 181 an `nws_fc` row has no join partner, so the replay the plan promises is impossible for three quarters of the retained window.
- Change: copy the few scalars the replay needs into the `nws_fc` row at write time, read-only from `tickCtx`: `lf.q`, `lf.qT`, `por.q`, `final.cfs`, plus `out`. That is about 80 bytes. The tick row stays unchanged. Or justify relying on USGS archives plus `bin_snapshot` to rebuild `final.cfs`; that is much weaker. Either way, the plan must state the dependency.

### 5. MUST: "two single-line edits to existing tests" is false; at least four more existing assertions break
Each edit below is legitimate, but each must be listed in the plan so that the R1 check is honest.
- `test/truth-dr-handler.test.js:206` asserts `tick.ver === 'v39.11'`. Bumping `SERVER_VERSION` breaks it.
- `test/truth-dr-model.test.js:138` asserts `rec.ver === 'v39.11'`. Same reason. Recommended edit: compare with `_test.SERVER_VERSION`, as `prediction-logging-handler.test.js:131` already does.
- `test/truth-dr-handler.test.js:263-267` asserts that only the four known URLs are requested. The two NWPS GETs break it. Edit: add the two exact NWPS URLs to the allow-list. Do not loosen the check to any `api.water.noaa.gov` URL.
- `test/truth-dr-handler.test.js:158-170` compares every arm with a late-skip baseline. The ping ticks the clock 25 s (`:99`), so the baseline writes no `nws_fc` row (more than 22 s), while every other arm writes one (`fetch_error`, because the mock throws for unknown URLs, `:110`). With `nws_fc` in `LOG_TYPES`, `strippedLogs` differs. Edit: drop `nws_fc` and `fc_scored` rows in `strippedLogs`, the same way the v39.6 fields are dropped (`:126-137`).
- `test/helpers/mem-supabase.js:118` (`LOG_TYPES`) and `test/prediction-logging-writer.test.js:531`: as the plan says.
- Recommend: run `npm test` on a branch with only the version bump and the two new fetches stubbed. List every failing assertion in the plan before implementing. R1's rule of "no edits beyond two lines" then becomes "no edits beyond this list".

### 6. SHOULD: the `fc_scored` write path is over-built for the real volume; use one batched insert
- Live read-only check (Supabase project "potomac forecast", 2026-11-24):
  - `gf_forecast_metadata` shows 929/927/927/924 validations for +6/+12/+24/+48 h. The rows date from 2026-08-29, so that is about 88 days: about 10.5 per horizon per day, about 42 `fc_scored` rows a day, about 1.8 per tick.
  - `gf_forecast_pending`: 34 rows created in the last 24 h (about 8 posts), 37 rows in total.
- So the cap of 40 is about 20 times the mean. That is fine, except right after an outage or an ice spell, when a backlog (up to 300 rows, S:2159) ripens in one tick and rows above 40 are lost for good: their pending rows were already deleted before the ping. Over 730 days the volume is about 31k rows, roughly 15-20 MB. The plan's Q4 measurement is answered: well under 100 a day, so the multi-batch prune is not needed.
- Change: write all of a tick's `fc_scored` rows in ONE `insert([...])` call (one round trip, one 2 s cap, no per-row pool drain), with a cap of about 300 to match the fetch cap. That needs the test-helper extension the plan deferred; it is small. If the owner keeps per-row writes, keep 40 but record the dropped count in the next `nws_fc` row or in `log_health`.

### 7. SHOULD: Part B-lite is not needed for the stated purpose; ship it as a separate push
- The purpose is a fair comparison of methods on an even hourly grid. Part A plus the replay scalars (finding 4) is enough for that. B-lite records the uneven, visitor-driven sample the plan itself calls unfair (10, Alt 1). Its real value is a fidelity check of the replay against what visitors were scored on, and closing A3f.
- B-lite is the only part that touches the pre-ping scorer. Splitting it out keeps the first push free of any change to code that runs before the ping.
- Change: push A first (logging after the ping only), verify it live for 24 h, then B-lite. If kept together, give B-lite its own kill switch: `NWS_ARCHIVE=off` covers Part A only (plan 2).

### 8. SHOULD: B-lite changes more of the scorer than "three guarded pushes"
- `persistError` is declared inside `if (pred.data.persistenceCFS)` (S:2270-2275). Logging `persistAbsPct` needs it lifted out of that block, which is an edit to scorer code. The signed `errPct` is a new expression. Both are safe if computed inside the push's try/catch from copies, but the plan must say the scorer body changes there.
- On the bad-target path, `targetTime` is an Invalid Date. Any `.toISOString()` on it throws a `RangeError`. Inside the try that loses the row quietly. Store the raw string `logStr(pred.data.targetTime)`.
- The scored row is logged after the delete succeeds even when the metadata upsert failed (S:2277-2281). The row then says "scored" but the totals did not count it. Add a `metaOk` boolean.
- F1 should also assert that the scorer's run time with `fcOut` stays within normal CPU jitter, and that `fcOut` is never read before the ping (source scan for `tickCtx.fc` above the ping line).

### 9. SHOULD: the replay must also copy the browser's acceptance gate, or it overstates when the NWS forecast was used
- Evidence. `data[id].forecast` is set only when `parseNWSForecast` returns non-null (N:64). That needs at least one point 0-96 h ahead of the visitor's `now` with `secondary > 0`, found by the 24/48 h window search (N:136-202). The UI gate `hasPoRForecast` (UI:361-363) and `hasLFForecast` (UI:416) inherit that. The UI then uses `(p.secondary || 0) * 1000` (UI:382, 422), so a null flow becomes 0 cfs, and a point with no valid time is kept with NaN `hoursAhead`. It is not dropped, contrary to plan 3.2's `pts` note. It is still counted in `lfPoints.length` and can feed `lfPoints[0]?.cfs` (UI:429).
- Also, on each refresh `processData` empties `data` (`src/data/fetch.js:516`, `174`). The first render then has no forecast (extrapolated, not posted), and the forecast arrives later through `nws:arrived` (fetch.js:541-545).
- Change: keep every point in `pts`, with `null` for an unparseable time, so the replay can mirror the browser exactly. Write in 9.x that the replay reimplements `parseNWSForecast`'s null-return rule and the `|| 0` substitution at the replay `now`.

### 10. SHOULD: bound the body size in `fetchNwsArchive`
- It reads `text()` (needed for `rawHead`). A changed endpoint or an HTML error page can be large. Abort and record `why: 'shape'` once the body passes about 256 KB. The fixed answer is about 2 KB.

### 11. SHOULD: the prune runs on a shared pool, and the existing prune path is still unproven
- `runLogHousekeeping` runs the prunes from the `general` pool (S:3028, 3034), the same pool as the `validation_log` flush, the hour-3 snapshot and `log_health`. Appending two more types (each a select, plus a delete when there are candidates) at the end of the list (S:3053) means they are the first to be skipped when the pool is spent. That is harmless for the data (it only delays), but it adds `skipped` counts at 03:00 once rows qualify.
- The string order works: `<ISO>_<id>` compared with `lt(gauge_id, cutoff ISO)` is correct, because a longer string with an equal prefix sorts higher.
- The first real prune of ANY type is still unproven (TODO A3c, open). `tick_log`'s first candidates arrive around 2027-05-09. The new types add no new risk to that path, but they do not reduce it. Keep the list hard-coded (do not switch to `Object.keys`), so a future key added for another reason is not pruned by accident.
- Update `test/prediction-logging-writer.test.js:451-461` (the `keepers` and `type_not_allowed` list) to add a negative case for one non-log type that sounds similar, such as `gf_forecast_pending`.

### 12. NOTE: the plan's handler line numbers are off by about 10
Ping at S:3346-3354 (plan: 3335-3345); Difficult Run at S:3359-3365 (plan: 3350-3358); housekeeping at S:3372-3377 (plan: 3369-3377). The plan says to re-check them; do so.

### 13. NOTE: etiquette and privacy
- The plan sends no custom header. Node's `fetch` sends `User-Agent: node` with no contact detail.
- The browser sends no custom header either (`fetchWithTimeout`, `src/data/fetch.js:78-93`, passes only `signal`). The browser makes up to 17 to 68 NWPS GETs per page refresh (N:17-26, 52-55).
- Two GETs an hour from the server is negligible. I did not read the NWPS terms. If NWPS ever asks for a UA with contact, that is an owner decision. Do not add one now (S1 test is right).
- No key is involved.

### 14. NOTE: hourly versus on-change
Agree with hourly. On-change needs a read every tick and adds a failure mode. The redundancy costs about 15-20 MB a year in total. The live database is 101 MB in total; the `potomac_observations` table is 1.6 MB, with 605 rows. `tick_log` averages about 1.5 KB of data per row (553 kB over 360 rows), which is a useful size check for the plan's 1.0 KB guess. The 500 MB vs 2 GB plan limit is still unchecked (A3h), but either limit is far away.

## Plan facts verified as correct
- `NWS_LIDS` has 17 entries including `01646500: BRKM2` and `01638500: PORM2`; `01644148` is absent (`src/model/constants.js:160-178`). The only `.forecast` writer is N:64. So `efForecast` is always undefined, and the EF blend in the forecast never runs (UI:358-362, 386-390, 492-513). The "sub-1% EF blend" claim in `CLAUDE.md:140` and the Tech Appendix overstates it: it is zero. (Code reading only; not run in a browser.)
- The gate: `hasNWSForecast = hasPoRForecast` (UI:363). Without a PoR series the whole forecast falls to linear extrapolation (UI:543-567).
- Bias offset `observed LF - interpolateForecast(lfPoints, 0)`. When every point is in the future it returns the first future point (UI:400-410, 428-433).
- The `+48h` horizon reads at 48 h plus travel; the last value is held past the end of the series (UI:449-462).
- Endpoint order and 5 s timers (N:17-26). The UI multiplies by 1000 and ignores `secondaryUnits` (UI:382, 422); `parseNWSForecast` reads the unit only for `forecast24/48` (N:99-104).
- Posting: display horizons only, `NWS*` source only, a 2 h in-memory throttle, ice skip, and the exact field list (`src/learning/gf-learning.js:152-207`). No inputs are posted.
- Scorer: 300-row fetch, ripeness sort, bad-target delete, not-due skip with `travelApplied`, 90 h stale sweep, LF 500-500,000 skip, metadata upsert, then delete with no `validated++` on a failed delete (S:2125-2293). Called at S:3207 before the ping, skipped on ice. `lf.qTime` exists (S:416) and the scorer does not use it.
- Log helpers: `LOG_RETENTION_DAYS` frozen (S:2364), `LOG_SCHEMA = 3`, `SERVER_VERSION = 'v39.11'` (S:2360-2361), two 3000 ms pools (S:2412-2430), `timedLogCall` caps at `min(2000, left)` (S:2434-2453), `writeLogRow` never throws and treats 23505 as already there (S:2459-2481). Unique key `(observation_type, gauge_id)` (`shared/observations.js:15`), insert at `:29-32`.
- Prune: allow-list, 30-day floor, 100-id batch, type predicate repeated (S:3017-3044). The list is hard-coded at S:3053.
- Difficult Run pattern: one controller, one timer over request and body, 20 s late-skip, never throws (S:2685-2728). It runs after the ping in its own try/catch.
- The service worker serves NWS NetworkFirst with a 4 s wait and a cache of up to 6 h (`config/runtime-caching.mjs:65-76`).
- Nothing in `netlify/` calls `api.water.noaa.gov` today.
- The existing handler fetch mocks already throw on an unknown URL (`prediction-logging-handler.test.js:107`, `truth-dr-handler.test.js:110`), so the new step records `fetch_error` there without new test code.
- `tick_log` holds `in.lf.q/qT`, `in.por.q/qT` and `final.cfs`. It is enough for an hourly-grid replay within 180 days (see finding 4), and only approximately reproduces any visitor's card: different `now`, a possibly cached series, a different USGS read, and the server's estimate instead of the visitor's.

## What I could not check
- Netlify's real scheduled-function time limit (A3h) and the real post-ping durations on live ticks.
- The Supabase plan limit (500 MB vs 2 GB).
- NWPS rate limits, terms or User-Agent rules, and NWPS behaviour from Netlify's addresses. I made no NWPS request.
- I did not run `npm test` or any page. The list of breaking tests in finding 5 comes from reading the code, not from running it.
- That `gf_forecast_metadata.validations` counts only rows scored since 2026-08-28. The rows' `created_at` is 2026-08-29/30; earlier resets could change the rate a little. The order of magnitude (about 2 rows a tick) is safe.
- Whether `final.cfs` in the server matches the browser's `gfEst.cfs` closely enough for the travel multiplier. The plan says the effect is small; it is not measured.

---

# Second pass, version 2

Auditor: same independent auditor, fresh read of `analysis/forecast-archive-plan-2026-11-24.md` (version 2) against the code as it is on 2026-11-24. No file changed except this report.

## Verdict

IMPLEMENTATION MAY START, provided the implementer is told the ten points at the end. Three of them are corrections to version 2 that must go into the code: an own try/catch around the whole new block, a synchronous-throw-safe call site, and a fix to the self-contradictory test N8. They are small, local and do not change the design, so they do not need a third plan pass.

## 1. Status of findings 1 to 14

| # | Status | Checked in v2 | Note |
|---|---|---|---|
| 1 | RESOLVED | 3.4, 3.5 | The order is right: fetch after the ping, await and write after `finalizeTick`, one absolute deadline. The arithmetic is confirmed in section 2a below. One new gap: see N-1. |
| 2 | PARTIAL | 3.4 step 5, N8, N9 | The extra flush exists. But it obeys the deadline, so a write skipped because the deadline passed can never be counted. N8 nevertheless asserts that it is counted. The `arch` pool is 4000 ms: a 2 s hung insert plus a 2 s hung health read leaves 0 ms for the health write, so the count is lost there too. See N-3. |
| 3 | PARTIAL | 3.4 step 2, N5 | `.catch` is attached at creation. It does NOT catch a synchronous throw from the call expression itself, yet N5 requires the synchronous case to pass. See N-2. |
| 4 | RESOLVED | 2.2 | Scalars copied. Use the same rounding as `tick_log` (`logNum(q, 1)` for flows, `logNum(predictedCFS, 0)` for `fin`). Otherwise live check 10.1 ("equal to the tick row") fails on decimals. |
| 5 | RESOLVED, one known miss | 5, step 0 | The dry run covers it. One more existing test will break and should be listed now; see N-4. |
| 6 | RESOLVED by deferral | 11 | Carried to the later task with the live numbers. |
| 7 | RESOLVED | 0, 11 | Part B-lite removed; the scorer is untouched (5, "NOT touched"). |
| 8 | RESOLVED by deferral | 11 | |
| 9 | RESOLVED, with a note | 2.2 `pts`, 2.3 | The UI reads only `p.validTime` (UI:380, 420). The parser's acceptance gate also accepts `time`/`dateTime`/`valid`/`timestamp` (N:138). Store the time that the UI uses (`validTime` only, null otherwise) in `pts`, and keep the raw alternative only if present. Otherwise a point with only `time` is stored with a time the UI never saw. A boolean flow coerces to 1000 or 0 in the UI but is stored as null; negligible. |
| 10 | PARTIAL | 3.3 | Implementable, but "stream reader, or content-length checked first" leaves the method open, and content-length alone is not a bound (chunked or absent). See 2d. |
| 11 | RESOLVED, with a new side effect | 3.6 | Hard-coded list of four, negative test P1. New: every hour-3 `tick_log` row gains `aux.prune.nws_fc`; see N-5. |
| 12 | RESOLVED | 2.1 | Spot-checked: ping S:3346-3354, Difficult Run S:3359-3365, `flushDeferredLogs` S:3372, `runLogHousekeeping` S:3373, `finalizeTick` S:3374. All match. |
| 13 | RESOLVED | 3.1 | No custom header, no key, no contact detail. |
| 14 | RESOLVED | 4 | Size range raised to 1.5-2 KB a row. |

## 2. New problems and the checks asked for

### (a) Time arithmetic for the new order

Rules as written: the fetch cap is `min(2000, deadline - now)` at fetch start; every existing step is unchanged; then `await nwsP`; then the write and the health-flush calls, each capped `min(2000, deadline - now)`, inside the 4000 ms `arch` pool. Today's post-ping maximum: Difficult Run 2 s (only if it starts by 20 s), general pool 3 s, tick insert 2 s (S:2365-2366, 2437, 2529-2530).

| Ping ends at | Today, latest end | New, latest end | Why |
|---|---|---|---|
| 3 s (early) | about 10 s | about 14 s | The fetch is done by 5 s. Today's chain ends at about 10 s. Then the write (2 s) and the health read (2 s) use up the `arch` pool, and the health write is refused. |
| 3 s, NWS hangs, DB fast | about 3.5 s | about 5 s | The await waits for the fetch timer (2 s after start). |
| 19.99 s | about 27.0 s | about 27.0 s | Fetch to 21.99 s. Today's chain ends at 26.99 s, past the deadline, so no write and no flush. The row for the hour is lost and the loss is not counted (N-3). |
| 21 s | about 26 s (DB slow), 21.3 s (DB fast) | 26 s (DB slow), 25 s (DB fast, NWS hangs) | DB fast: the await runs to 23 s, the write is capped at 2 s to 25 s, and the flush cap is 0, so it is skipped. |
| 24 s | about 24.3 s | 25 s | Fetch cap 1 s. The write cap is ≤ 0, so it is skipped. |
| 25 s or later | ping end + up to 5 s | same | Fetch cap ≤ 0: no request (`late_skip`), no write. |

- The latest moment the function can be running is `max(today's latest end, 25 s)` on the same tick.
- It is never later than today's worst case. Today's worst case is itself unbounded, because time before the ping is unbounded (version 2 says so in 3.5).
- On a given tick the run can end later than it would today, by at most `min(4 s plus the fetch wait, 25 s minus today's end)`. That is acceptable and is the stated design.
- An NWS hang does not lengthen the worst case. A hang on the new insert does not either: both are capped by the deadline.
- One residual effect, not a bug and not new. `timedLogCall` (S:2434-2453) abandons a slow insert without cancelling it. The request can complete later, even during the next invocation if the container is reused. That is true of every log write today; for `nws_fc` it is harmless (unique key per tick).

### (b) Can anything after `finalizeTick` throw out of the handler, change the return value, or leave an unhandled rejection?

- N-1 (fix in code). Version 2 does not say the new block after `finalizeTick` (await, row build, write, flush) runs inside its OWN try/catch. As drawn it sits inside the handler's main `try` (S:3132-3383). Any throw there would:
  - jump to the catch at S:3384,
  - send a `/fail` ping after the success ping,
  - try a second `finalizeTick` (its tick row collides with the existing key and is counted as a duplicate),
  - return 500 instead of 200.
  A throw is possible: from `buildNwsFcRecord` on odd data, or from `Date.now` (the existing test harness can make it throw, `truth-dr-handler.test.js:91-100`).
  - Required: wrap the whole new block exactly like the Difficult Run block (S:3359-3365), catch and swallow, nothing escapes.
  - Add a mutant: make `buildNwsFcRecord` throw. Expect 200, one ok ping, no fail ping, the same body.
- N-2 (fix in code). `fetchNwsArchive(t).catch(...)` handles a rejection, not a synchronous throw of the call expression. N5's synchronous arm then reaches the main catch.
  - Required: declare `fetchNwsArchive` as `async`, so every throw inside it becomes a rejection.
  - Also put the creation statement, together with the switch check and any `Date.now()` at the call site, in a try/catch whose fallback is `Promise.resolve(<internal_error result>)`.
  - The fallback object must have the shape that `buildNwsFcRecord` accepts. Version 2's `{ rows: null, why: 'internal_error' }` must yield a row with both gauges marked `internal_error`; test that.
- With N-1 and N-2, nothing new can change the return value or leave an unhandled rejection. `writeLogRow` and `flushLogHealth` never throw (S:2459-2481, 2487-2514). The new optional argument to `flushLogHealth` must keep that property.

### (c) Is the replay-scalar read truly read-only and safe?

- Read-only if it copies primitives:
  - `usgsData.data[usgsData.gauges.lf]?.q`, `?.qTime`, the same for `por`,
  - `prediction?.predictedCFS`,
  - `out = prediction ? 'predicted' : 'no_prediction'`.
- `prediction` is in scope at that point: it is declared at S:3215 inside the same `try`.
- On the success path `usgsData` is non-null (S:3148-3153 throws otherwise). On an ice tick or a no-prediction tick `prediction` is null; `?.` gives null.
- A missing gauge gives `undefined?.q`, which is safe. `logNum` maps everything that is not a finite number to null (S:2373-2377).
- It cannot throw if written with optional chaining throughout and run inside the N-1 try.
- The handler's stamps mutate `prediction` (S:3283-3290) before this point. Reading `predictedCFS` after them is fine; the stamps do not touch it.
- No reference to these objects may be stored in the row: copy values, not objects. N4's deep-freeze test covers mutation.

### (d) Is the body bound implementable in Node's fetch?

Yes, but only by stream reading. Exactly how:
1. `const reader = response.body && response.body.getReader();` If there is no body, the gauge gets `shape`.
2. Loop `const { done, value } = await reader.read()`. Add `value.byteLength` to a counter and push `value` to an array.
3. When the counter passes `NWS_BODY_MAX`, call `reader.cancel()` (or `controller.abort()`), stop, and set `why: 'shape'`.
4. On `done`, decode with `new TextDecoder().decode(concat(chunks))` and `JSON.parse` in a try (`parse_error`).

- A `content-length` header may be checked first as a fast reject, but it cannot be the bound, because chunked answers have none.
- The whole loop sits inside the same race against the one timer. An abort makes a pending `read()` reject, and the race ends at the cap even if it does not.
- Runtime: the repo pins no Node version for functions (`netlify.toml` has only `node_bundler = "esbuild"`, no `NODE_VERSION`, no `.nvmrc`). Every Netlify default with built-in `fetch` (Node 18 and later) has web-stream bodies, so `getReader()` exists.
- Test mocks must give `body` as a real `ReadableStream`. The existing handler mocks return `{ ok, json }` without a body, but they never answer an NWS URL (they throw on it), so they are not affected.
- N3 must include a mock that IGNORES the abort signal and never resolves. Only that proves the race, not the abort, ends the wait.

### (e) Does the kill switch remove every new effect?

Almost. With `NWS_ARCHIVE=off`, the fetch, the write and the extra flush are gone (3.2). Two effects remain:
- The hour-3 prune still selects `nws_fc` (S:3053 plus the new name). That is one more query a day on the `general` pool, and a new key in `tick_log.aux.prune` (N-5).
- `SERVER_VERSION` moves to v39.15 in every row; that is intended.

Recommendation: accept the prune and say so in 3.2, or skip the `nws_fc` prune when the switch is off. Either is fine; the doc must not claim "nothing".

### (f) Do the tests prove "every non-log write and every existing log row byte-identical, on, off, hanging, failing"?

Mostly. N7 is the right test, but:
- N-5. N7 compares on with off, not with today. At UTC hour 3 both arms write `tick_log.aux.prune.nws_fc`, which today's code does not, so "existing rows byte-identical" is false for hour-3 tick rows. Since `aux.prune` is built before `finalizeTick` (S:3373), the new key does land in the tick row. That is a real, small change to an existing row type.
  - Fix: state it in 5 ("Must NOT change" gets the exception) and in the appendix.
  - Or keep the tick row as it is by running the `nws_fc` prune after `finalizeTick`, in the new block under the deadline. The second is cleaner and consistent with ruling 1. Recommended.
- N-4. One more existing test breaks: the `dateThrowAfterPing` arm of `truth-dr-handler.test.js` (`:91-100`, `:155`, `:182-185`). The harness makes the FIRST `Date.now()` after the ping throw. In the new order that is the NWS call site, not the Difficult Run. The Difficult Run then runs, and `assert.equal(iDr, -1)` and `in.dr.why === 'internal_error'` fail. If the throw lands outside an async function, the run returns 500.
  - Legitimate edit: make the harness throw on the Difficult Run's own call. For example, throw on the second `Date.now()` after the ping, or throw only while the stack contains `fetchDifficultRun`. Keep the intent "a throw at the DR call site is contained".
  - Add the same style of arm for the NWS call site (this is N-2's test).
- N7 should include an arm with the ping at 24 s and one at 26 s: deadline partly or fully passed.
- N7 should also assert the 200 body and the ping sequence exactly (`['ok']`) in every arm, as the Difficult Run A/B test does (`truth-dr-handler.test.js:166-171`).
- "Byte-identical" can only hold up to the timing fields already excluded (`ms`). That is stated, so acceptable.
- N-3 (test fix). N8 asserts that a write skipped after 25.1 s is "a budget failure counted in log_health". But the flush obeys the same deadline and cannot run then.
  - Change N8 to assert that it is NOT counted and that the only record is the missing key; document that a skipped hour is visible only as a gap.
  - Or give the final flush a small allowance past the deadline. That breaks the 25 s bound, so it is not recommended.
  - Also note in 3.4 that with the 4000 ms `arch` pool, a hung insert plus a hung health read loses the count. Acceptable, but say it.
- N-6 (implementation detail, must be explicit). The per-call cap `min(2000, deadline - now)` does not exist in `timedLogCall` today (its cap is `min(LOG_WRITE_CAP_MS, pool remaining)`, S:2437). Version 2 needs an optional `deadline` argument on `timedLogCall` and `writeLogRow`, or a wrapper.
  - It must be optional and default to today's behaviour.
  - A test must show that every existing call path (no deadline) gives the same caps and the same results.
  - It is a change to a shared helper and must be named in the 5 table.

## 3. Final verdict

IMPLEMENTATION MAY START.

Tell the implementer explicitly:
1. Wrap the entire block after `finalizeTick` (await, build, write, flush, and the `nws_fc` prune if moved there) in its own try/catch that swallows everything, like S:3359-3365 (N-1).
2. Make `fetchNwsArchive` `async`. Create the promise inside a try/catch with a `Promise.resolve(fallback)` fallback, plus `.catch` on the promise. Read the env switch and any `Date.now()` inside that try (N-2).
3. Per-call deadline caps need an optional `deadline` on `timedLogCall`/`writeLogRow`, or a wrapper. The default path must be unchanged and tested (N-6).
4. Body bound by `response.body.getReader()` with a byte counter, `reader.cancel()` past 262144 bytes, all inside the one timer race. `content-length` is a hint only.
5. Scalars as primitive copies with `?.`, rounded exactly as `tick_log` (`logNum(q, 1)`, `logNum(predictedCFS, 0)`).
6. `pts` time = `validTime` only (the UI's rule), null otherwise.
7. Prefer running the `nws_fc` prune after `finalizeTick` under the deadline, so hour-3 tick rows keep today's shape. Otherwise document `aux.prune.nws_fc` as the one change to an existing row (N-5).
8. Fix N8: a skip after the deadline is NOT counted, only visible as a gap (N-3).
9. Add the `dateThrowAfterPing` arm of `truth-dr-handler.test.js` to the list of tests that change, with an edit that keeps its intent, and add an NWS call-site twin (N-4).
10. N3 needs a fetch mock that ignores the abort signal and never settles. N7 needs arms with the ping at 24 s and 26 s and exact body and ping assertions.

The post-implementation audit must look at:
- that nothing new is reachable from the main catch: source read, plus mutants for a builder throw, a synchronous throw and a rejection;
- the diff of `timedLogCall`/`writeLogRow`/`flushLogHealth` for default-path identity;
- the event order (ping, then the DR request, then the existing log writes, then `tick_log`, then `nws_fc`);
- the end time with everything hanging, at ping times of 3, 19.99, 21 and 24 s: end ≤ max(today's chain, 25 s);
- the body bound with a stream that never ends and with an over-size stream;
- that the list of edited existing tests equals the dry-run list and each edit keeps its assertion's intent;
- that an hour-3 tick row is identical to today's (or the documented exception);
- that `nws_fc` rounding equals `tick_log`;
- the kill-switch arm (no NWPS request in the URL log);
- the docs: no claim that the switch removes "everything" if the prune stays, and the "Not logged" sentence updated.

Still unverified after all of this: the 30 s Netlify limit, real NWPS behaviour from Netlify, the Supabase plan limit, and the first real prune (A3c).

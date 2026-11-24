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

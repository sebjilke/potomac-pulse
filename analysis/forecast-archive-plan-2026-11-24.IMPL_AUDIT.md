# Post-implementation audit: v39.15 forecast archive (`nws_fc`)

Auditor: independent and fresh. I wrote neither the plan nor the code, and I did not audit the plan. Date: 2026-11-24. What I audited: the uncommitted working tree against `HEAD`. "S" means `netlify/functions/scheduled-update.js` (new line numbers). Scratch work was done in `/private/tmp/impl_audit_v3915/` only. The repository was not touched, except for this file.

## Verdict

PUSH MAY PROCEED AFTER THE LISTED FIXES. Only finding 1 is a MUST, and it is a TODO id collision that affects documents only. The code itself holds on every point I checked.

## Findings (most serious first)

### 1. MUST: the new TODO row `A3l` collides with an existing `A3l`
- Evidence: in `TODO.md`, line 230 is the new "A3l: The forecast's Edwards Ferry branch never runs". Line 234 is the old "A3l: Left by the production check of the first snapshot and validation rows, 2026-11-11". `git show HEAD:TODO.md` already has `A3l` at its line 231. `A3m` and `A3n` are new and do not collide. No other file refers to A3l, A3m or A3n.
- Fix: renumber the three new rows to `A3o`, `A3p` and `A3q`. None of these ids exists yet. Alternatively, renumber only the new `A3l` to `A3o`. Also update any reference in the v39.15 changelog line of `TODO.md`.

### 2. SHOULD: the test "no timer is left running" checks nothing
- Evidence: `test/forecast-archive-fetch.test.js:177-183` ticks the fake clock 10 s and asserts that the clock moved 10 s. That holds whatever the code does. Mutant m12 removes `clearTimeout(timer)` from `fetchNwsArchive` (S:3266), and the whole suite still passes (1704/1704).
- Fix: wrap `setTimeout` and `clearTimeout` with `t.mock.method`. Record the id that `setTimeout` returns inside `fetchNwsArchive`, and assert that `clearTimeout` was called with that id on a clean run.

### 3. SHOULD: the deadline on the `nws_fc` prune is pinned only by a source-text scan
- Evidence: mutant m17 drops `deadline` from the `pruneLogType(client, 'nws_fc', ...)` call (S:3668). Only `S1: ... arch pool under the deadline` fails, which is a string match on the source. No behavioural test hangs the prune's select or delete on a late hour-3 tick. The prune runs on the `general` pool after `finalizeTick`. Without the deadline, a late hour-3 tick could run up to 4 s past 25 s.
- Fix: add a handler test at hour 3 with the ping at 24 s and the `nws_fc` select hanging. This needs `insertMode`-style hang support for selects in `mem-supabase`, or a wrapped `from`. Assert that the end is at or before 25 s.

### 4. SHOULD: removing the body bound makes the test suite hang, not fail
- Evidence: mutant m6 disables both bound checks. `test/forecast-archive-fetch.test.js` and `test/forecast-archive-handler.test.js` then hang for more than 60 s, even with `--test-timeout=15000`. The "oversize" mock stream enqueues at once on every pull, so the read loop spins in microtasks and the fake timer never gets to fire. In CI this would show as a hung job, not as a named failing test.
- Fix: in the oversize mocks, count pulls and call `c.error(new Error('bound not enforced'))` after, say, 10 pulls. The test then fails cleanly and names the problem.

### 5. SHOULD: the list of edited existing tests is not stated honestly
- Evidence: `test/usgs-step1-handler.test.js` was edited (four filters now also exclude `https://api.water.noaa.gov/`). It is not in the plan's section 5 table, and the v39.15 line in `TODO.md` ("Existing tests edited only for ...") does not mention it. Plan rule R1 requires each such edit to be listed before it is made.
- The edit itself is legitimate. The test counts USGS requests, and the two Weather Service GETs are not USGS requests. The `length === 3` and URL assertions are unchanged. Excluding the whole host is broader than the exact-URL rule the plan audit asked for in `truth-dr-handler`. That is acceptable here, because N6 and the `truth-dr-handler` allow-list pin the two exact URLs.
- Fix: add the file to the table in plan section 5, and add it to the `TODO.md` changelog line.

### 6. NOTE: a code comment says the prune runs on the `arch` pool; it runs on `general`
- Evidence: the comment on `NWS_ARCH_POOL_MS` (S:2382) says it covers "the nws_fc write, its prune and the health flush". The prune call (S:3668) passes no `pool`, so it uses `general`. That matches plan 3.6 and is harmless: all existing writes are done by then, and `budget.fails` is read only before the tick row.
- Fix: correct the comment. Do not move the prune to `arch`: that 4 s pool would then starve the health flush.

### 7. NOTE: unread bodies are not cancelled on `http_error`, or when there is no reader
- Evidence: in `nwsFetchOne` (S:3200-3203), a non-OK answer returns without consuming or cancelling `response.body`. Undici keeps the socket until garbage collection. This is harmless at two requests an hour.
- Fix (optional): `try { response.body?.cancel?.().catch?.(() => {}); } catch (_) {}` before `return` on the `http_error` path.

### 8. NOTE: `await nwsP` has no deadline of its own
- Evidence: S:3654. It is safe in production, because the real `fetchNwsArchive` always settles by its timer (cap at most 2 s, at most the deadline). If `_test.nwsHooks.fetchNwsArchive` were replaced by a function that never settles, the handler would hang. Only a test can do that.
- Fix (optional): `await Promise.race([nwsP, sleep(max(0, deadline - now))])`, with a fallback value.

### 9. NOTE: the v39.6 statement "added time after the ping is about 7 s" no longer describes a run with the archive on
- Evidence: in my scratch comparison with every insert hanging and the ping ending at 3 s, the run ends at 8 s on `HEAD` and 12 s on v39.15. With the Difficult Run also hanging, it ends at 10 s and 14 s. The extra 4 s are the 2 s `nws_fc` write and the 2 s health read on the `arch` pool. This is within the design bound of max(today, 25 s), and section 6.10.2 states that bound. But appendix 6.10.1 and the v39.6 test "added time stays at or under 8.5 s" describe only the old part. That test passes because its mock does not hang `nws_fc`.
- Fix: add one sentence to 6.10.2: "with the archive on, up to about 4 s more after the tick row, never past tick start + 25 s".

### 10. NOTE: `log_health` can differ between the on and off arms
- Evidence: when the extra flush runs (S:3672), it writes every pending count, including counts for existing types that `finalizeTick`'s own flush could not write (general pool spent). With the switch off, those counts are lost, as they were before. This is a small improvement, but it means `log_health/system` is not identical across the arms. The N7 test excludes `log_health`, and so does the plan's "must not change" list.
- Fix: none needed. Mention it in 6.10.2 if precision matters.

### 11. NOTE: the switch is the exact string `off`
- `OFF`, ` off` and `false` leave the archive ON. This is tested (`kill switch: any value other than ...`) and documented. Tell the owner explicitly before he needs it.

### 12. NOTE: wording in `CLAUDE.md` and `README.md`
- "the body is read with a byte counter and cut at 256 KB". The body is not cut: past 256 KB the read is cancelled, nothing is parsed, and the gauge gets `why: shape` with a 1000-character `rawHead`. The Tech Appendix says this correctly.
- Fix: replace "cut at" with "abandoned (why `shape`) past".

### 13. NOTE: several guards are proven only by source-text scans
- m3 (removing the block's own try/catch) and m17 (finding 3) are caught only by `S1` string matches. m15 (`fetchNwsArchive` not `async`) is not caught at all. That is acceptable for m15: the call-site `try` plus `Promise.resolve(...).catch` already covers a synchronous throw, so `async` is a redundant layer. For m3, no throwing path is left inside the block (the builder throw has an inner catch), so a behavioural test cannot tell. The scans are mirrors of the text and break on harmless reformatting.

## Checks requested (1-10), with evidence

1. **Plan-audit findings and ten points.** See the table below.

2. **Nothing new before the ping; nothing reachable from the main catch.** The success ping is at S:3592-3601. The new start block (S:3609-3622) comes after it. It reads the switch, calls `Date.now()` and calls the hook, all inside one `try`. The `catch` gives `Promise.resolve(nwsFallback('internal_error'))`. The promise gets `.catch` in the same statement. The Difficult Run block, `flushDeferredLogs`, `runLogHousekeeping` and `finalizeTick` are textually unchanged. The new tail block (S:3651-3674) is wrapped in `try { ... } catch (_) {}`, and the builder has an inner `try`. `writeLogRow`, `flushLogHealth` and `pruneLogType` never throw (each has an outer try/catch). A missing or undefined hook raises a TypeError inside these trys, which leads to the fallback or a counted failure.
   - Evidence: tests N5 (synchronous throw, rejection, junk return, builder throw, `Date.now` throw) pass with 200, pings `['ok']`, one tick row and no unhandled rejection.
   - Mutants: m3b (no call-site try) fails 6 tests; m4 (no `.catch`) fails the unhandled-rejection test.
   - The test seam `nwsHooks` is a module-level object exposed only through `_test`. Nothing in production mutates it.

3. **Existing behaviour unchanged.**
   - The diff of `timedLogCall` (S:2452-2471) shows the deadline branch runs only when `deadline !== undefined`. `writeLogRow` passes `deadline` through. `flushLogHealth` defaults to `pool 'general'` with no deadline. `pruneLogType` defaults to `pool 'general'`.
   - Every existing call site (S:2965, 2978, 3013, 3019, 3024, 3027, 3082, 3103, 3105, 3106) passes no new argument.
   - `LogBudget.left` gains `arch`. It is never serialised (`grep \.left`).
   - My strongest check was a scratch test (`/private/tmp/impl_audit_v3915/work/test/zz-audit-head-vs-off.audit.js`). It runs `HEAD`'s handler and the new handler with `NWS_ARCHIVE=off` under the same mocks, over 9 arms: normal; hour 3; ping at 19.99, 24 and 26 s; everything hanging at hour 3; insert errors; USGS down; Difficult Run hanging. In all arms the full DB op log (every select, insert, upsert and delete with its payload), the final rows, the URL list, the status, the body and the elapsed virtual time are IDENTICAL, apart from `ver` and `ms`.
   - With the archive ON, the ops on every type except `nws_fc` and `log_health` (the hour-3 `tick_log` row included) are identical to `HEAD`'s in all 9 arms.
   - `validateForecastPredictions`, `shared/model.js` and `src/` (except the two documents) are untouched (`git diff --stat HEAD -- netlify/functions/shared src/`).
   - No existing log write starts later than before, except by the CPU time needed to start two fetches (microseconds).

4. **Time.** Scratch test, every insert (including `nws_fc` and `log_health`) hanging, the Weather Service hanging, a 10 ms fake-clock step. End of run, `HEAD` vs new:

   | Ping ends at | DR hangs | `HEAD` | v39.15 | max(`HEAD`, 25 s) |
   |---|---|---|---|---|
   | 3 s | no / yes | 8.0 / 10.0 s | 12.0 / 14.0 s | 25 s |
   | 19.99 s | no / yes | 24.99 / 26.99 s | 25.00 / 26.99 s | 25 / 26.99 s |
   | 21 s | either | 26.0 s | 26.0 s | 26 s |
   | 24 s | either | 29.0 s | 29.0 s | 29 s |
   | 26 s | either | 31.0 s | 31.0 s | 31 s |

   The results are the same at hour 3 and hour 16. The new run never ends later than max(`HEAD`, 25 s). The `HEAD` end at a 24 s ping is 29 s (5 s of existing log pools), which is already close to the unverified 30 s limit; this change does not make it worse.

5. **The request.**
   - `fetch(NWS_BASE_URL + lid + '/stageflow/forecast', { signal })` (S:3199) produces exactly `https://api.water.noaa.gov/nwps/v1/gauges/BRKM2/stageflow/forecast` and the same for `PORM2`. This is the browser's first variant (`src/estimation/nws.js:18`). There is no header, key or contact detail. Tests: N3 `clean` asserts the init keys are `['signal']`; m7 (adding a User-Agent) fails 3 tests.
   - There is one `setTimeout` over both requests and both body reads, cleared in a `finally`. On timeout, `abort()` is called. The race ends the wait even if the mock ignores the abort (N3 "hang before headers").
   - The body is read with a byte counter and `reader.cancel()` past 262144 bytes. `content-length` is only a hint. A missing body gives `shape`.
   - The cap is `min(2000, tickStart + 25000 - callAt)`. A cap at or below 0 means no request (`late_skip`).
   - A late worker cannot change the stored result, because results are snapshotted after the race (tested).
   - Gap: the clearTimeout is real but untested (finding 2).

6. **The row.**
   - `buildNwsFcRecord` (S:3304-3333): `at = new Date(tickStartMs).toISOString()` is the same expression as the `tick_log` key (S:3322 in `buildTickRecord`). It is written with `gauge_id = rec.at`.
   - Scalars: `logNum(q)` (1 decimal), `logEpoch(qTime)` and `logNum(predictedCFS, 0)`. These are the same calls `tick_log` uses (S:2827-2828, 2866). Test N6 asserts equality against the real tick row.
   - Points are new arrays (`x.slice()`) of primitives. Strings are cut to 24 characters. Non-number, non-string values become null. Times are `validTime` only.
   - Hostile content: `u`, `pu` and `pedts` go through `logStr(..., 16)`, and a throwing `toString` is caught, giving `shape`. `rawHead` goes through `logMsg(..., 1000)`, with URLs replaced. The JSON size is bounded at 256 KB before parsing.
   - Worst-case row size is about 30 KB (2 × 200 points with 24-character strings). The normal size is about 2 KB.
   - The 200-point cut is honest: `n` is the number stored, `nAll` is the original length, and `sig` covers the stored points (as the docs say).
   - Nothing is shared by reference: N4 builds from deep-frozen inputs.

7. **The kill switch.**
   - Effects: no request, no row, no `nws_fc` query, no extra flush and no prune (S:3613 and S:3651, `if (nwsOn)`). Tested in "kill switch: NWS_ARCHIVE=off ...", including an old `nws_fc` row left unpruned at hour 3.
   - The repository's tests compare only against the off arm. I closed that gap with the `HEAD` vs off comparison in check 3: identical in all 9 arms.
   - Mutants: m8 (the switch ignores `off`) fails 2 tests plus 16 of my comparisons. m19 (the prune runs when off) fails 2 tests.

8. **Tests.**
   - `npm test` in the repository: `tests 1706, pass 1704, fail 0, skipped 2`, exit 0. This matches the implementer's claim.
   - New tests: mostly behavioural (the handler on the in-memory database with fake timers, event order, equivalence to the off arm, deadline arms at 0, 22, 23.5, 24, 25.1 and 26 s). The `S1` source scans are mirrors (finding 13). The "no timer" test is vacuous (finding 2).
   - Edits to existing tests (`git diff -- test/`):
     - Version string becomes `_test.SERVER_VERSION`: legitimate.
     - `LOG_TYPES` gains `nws_fc`: legitimate.
     - Retention table now has four types: legitimate.
     - New negative prune case `gf_forecast_pending`: this strengthens the test.
     - `truth-dr-handler`: `nws_fc` rows dropped from `strippedLogs` (planned; the late-skip baseline writes none); the two exact NWPS URLs added to the allow-list (exact, not the host); the date-throw arm re-aimed at the Difficult Run's own `Date.now` by a stack check, plus a twin arm for the NWS call site. The intent is kept: if the stack check never fired, the `else` branch's assertions (`iDr === -1`, `why internal_error`) would fail, so it cannot pass silently.
     - `usgs-step1-handler`: legitimate but unlisted (finding 5).
     - None of these is a weakening.
   - Mutants: see the table below.

9. **Documents and version.**
   - v39.15 is in `SERVER_VERSION` (S:2363), `index.html` (meta and footer), `CLAUDE.md` (heading and bullet), `README.md`, `TODO.md`, `CHANGELOG.md` and the Tech Appendix (6.10.2, the version paragraph, "Current version", "Generated by", the "Not logged" sentence). `test/howitworks-text.test.mjs` passes.
   - Statements checked against the code: true, except the comment in finding 6 and the wording in finding 12.
   - `TODO.md`: the `A3l` collision (finding 1). The `A3f` rewrite keeps "Flood audit item 4 stays open" and says Part B-lite is open. The `A3h` addition is accurate. Nothing else was lost (7 insertions, 3 deletions: the header line, A3f, A3h).
   - `npm run build` in a scratch copy: exit 0.

10. **Other.** Findings 6 to 13.

## Plan-audit findings and the ten points

| Item | Status | Evidence |
|---|---|---|
| Pass 1 #1 order and time | RESOLVED | Fetch after the ping; await and write after `finalizeTick`; one deadline. Timing table in check 4. |
| #2 failures after `finalizeTick` reach `log_health` | RESOLVED (as amended by N-3) | Extra flush on `arch` under the deadline (S:3672); N9 passes; a skip after the deadline is not counted (N8, documented). |
| #3 rejection handler at creation | RESOLVED | S:3617; m4 caught. |
| #4 replay scalars | RESOLVED | `nwsFcInputs` (S:3292-3301); N6 equality against the tick row. |
| #5 list of edited tests | PARTIAL | `usgs-step1-handler` unlisted (finding 5). |
| #6 batched `fc_scored` | Deferred (B-lite out) | |
| #7 B-lite out | RESOLVED | Scorer untouched. |
| #8 scorer changes | Deferred | |
| #9 keep every point; `validTime` only | RESOLVED | `parseNwsForecastBody`; N1, N2. |
| #10 body bound | RESOLVED | Stream reader and counter; tests pass. The mutant hangs the suite rather than failing it (finding 4). |
| #11 prune list hard-coded; negative case | RESOLVED | The housekeeping list is still the three names; `nws_fc` is a literal call; m23 (`Object.keys`) caught. |
| #12 line numbers | RESOLVED | n/a |
| #13 etiquette | RESOLVED | No header, key or contact; m7 caught. |
| #14 hourly | RESOLVED | |
| N-1 own try/catch | RESOLVED | S:3652/3673; caught only by a source scan (finding 13). |
| N-2 synchronous-throw-safe call site; `async` | RESOLVED | S:3613-3621; m3b caught. m15 is redundant. |
| N-3 skip after the deadline not counted | RESOLVED | N8 "25.1 s" asserts no `log_health` row. |
| N-4 date-throw arm | RESOLVED | Stack-aimed arm plus the NWS twin. |
| N-5 hour-3 tick row | RESOLVED | Prune after the tick; `aux.prune` keys unchanged (test plus my `HEAD` comparison). |
| N-6 optional deadline, default unchanged | RESOLVED | Diff reading plus the `HEAD`=off identity; m10b caught. |
| Ten points 1-10 | All RESOLVED | 1: N-1. 2: N-2. 3: N-6. 4: #10. 5: #4 rounding. 6: #9. 7: N-5. 8: N-3. 9: N-4. 10: N3 "IGNORES the abort" mock; N7 arms at 0, 24 and 26 s with the body and `['ok']` asserted. |

## Mutant table (suite = `npm test`; "audit" = my `HEAD` comparison and timing file)

| Mutant | Caught by |
|---|---|
| m1 new block moved before `finalizeTick` | N6 order; N7 (0, 24, 26 s); N8 (25.1 s and all-hanging); S1; `truth-dr` A/B. Audit: 21. |
| m2 fetch start moved before the ping | N6; N7; N5 `Date.now` arm; N8 (23.5 s and 25.1 s); S1 |
| m3 own try/catch removed | S1 source scan ONLY |
| m3b call-site try removed | N7 (3 arms); N5 synchronous throw and `Date.now`; `truth-dr` A/B |
| m4 `.catch` removed | N5 "fetch promise rejects ... no unhandledRejection" |
| m5 deadline removed from the write | N8 (22, 23.5, 25.1 s, all-hanging); S1. Audit: 34. |
| m6 body bound removed | The suite HANGS (fetch and handler files, more than 60 s); no clean failure (finding 4) |
| m7 User-Agent header added | N3 clean; N6; S1 |
| m8 switch ignores `off` | kill-switch test; S1. Audit: 16. |
| m9 prune moved into `runLogHousekeeping` | kill switch; hour-3 prune test (`aux.prune` keys); S1. Audit: 10. |
| m10a existing tick write given a 25 s deadline | N7 (26 s); N8; `prediction-logging` T6/TD-2/FM-3/T7; `truth-dr` A/B |
| m10b default cap of `timedLogCall` changed | `forecast-archive-writer` default path; existing T5 and T5a |
| m11 `nws_fc` written on the `general` pool | S1; existing T5b and the `truth-dr` time test |
| m12 `clearTimeout` removed | NOT CAUGHT (finding 2) |
| m13 fetch cap ignores the deadline | N3 (late and after-deadline); N8 (25.1 s) |
| m14 / m24 flush after every write (plan's original rule) | Existing T5b and `truth-dr` "added time ≤ 8.5 s" |
| m15 `fetchNwsArchive` not `async` | NOT CAUGHT (redundant layer; acceptable) |
| m16 `lfq` rounding changed | N4 (2 tests) |
| m17 deadline removed from the prune | S1 source scan ONLY (finding 3) |
| m18 deadline removed from the flush | N8 (25.1 s, all-hanging); S1; `truth-dr` A/B. Audit: 34. |
| m19 prune runs with the switch off | kill switch; S1. Audit: 14. |
| m20 `LOG_SCHEMA` set to 4 | Existing T4, `truth-dr-model`, `truth-dr` A/B. Audit: 38. |
| m21 fetch timer removed | N3 (5 tests); N6; N7; N8 |
| m22 extra health flush removed | N5 builder; N9 (3 arms); S1 |
| m23 prune list switched to `Object.keys` | kill switch; hour-3 prune test; S1 |

## The seven deviations

1. **Flush only on a new failure: acceptable.** On a clean tick, `log_health` stays identical to the off arm and to `HEAD`. Mutants m14 and m24 show that the plan's "flush whenever pending" rule breaks two existing v39.6 time tests. A new failure is still counted.
2. **200-point cut with `nAll`: acceptable.** It is recorded honestly and documented (at most 200; `nAll` only when the answer was longer). It bounds the row at about 30 KB.
3. **Test seam `_test.nwsHooks`: acceptable.** It is a module-private object. Mutating it to `undefined` or to a thrower is contained by the trys. The only hazard is a replacement that never settles, which only a test can do (finding 8).
4. **Prune in the new block, not in `runLogHousekeeping`: acceptable.** This is what the orchestrator ruled, and it keeps the hour-3 `tick_log` row unchanged (verified against `HEAD`). Fix the pool comment (finding 6).
5. **A row-builder throw is counted and writes no row: acceptable.** It is tested (`byType.nws_fc === 1`).
6. **`usgs-step1-handler.test.js` edited: acceptable in substance; not listed** (finding 5).
7. **TODO ids: `A3l` collides (finding 1, MUST).** `A3m` and `A3n` are fine. The `A3f` and `A3h` rewording is accurate and keeps the old content.

## After the push: check live (read-only SQL), and what stays unverified

Check after the first tick:
- One `nws_fc` row with `ver = 'v39.15'`, and its `gauge_id` equals that tick's `tick_log.gauge_id`.
- Both gauges show `http` 200, `why` null and `n` 12. `iss` is within 48 h of `at`.
- `in.lfq`, `in.lfT`, `in.porq`, `in.porT` and `in.fin` equal the tick row's `in.lf.q`, `in.lf.qT`, `in.por.q`, `in.por.qT` and `final.cfs`.
- The tick row's `ms` is in its usual range. `aux.logFail` is empty. `log_health/system` is unchanged.

Check after 24 h:
- 24 rows and no key gaps. Count the `why` values.
- `pg_column_size` of the rows (planned at 1.5 to 2 KB).

Check after the first hour-3 tick:
- `tick_log.aux.prune` has only the three old keys.

Stays unverified:
- The 30 s Netlify limit (A3h). `HEAD` already ends at 29 s on a tick whose ping ends at 24 s with the log pools hanging.
- That the ping still arrives in time on Netlify. Healthchecks is the owner's to check; I made no request to it.
- Weather Service behaviour and rate limits from Netlify's addresses.
- The first real `nws_fc` prune (November 2028).
- The Supabase plan size limit.
- Real (not mocked) body streams from undici under abort.

---

# Second pass, after the fixes

Same auditor, same limits. The only write in the repository is this section. Mutants were run in a fresh scratch copy, `/private/tmp/impl_audit_v3915/pass2/`.

## 1. What changed since the first pass

- In `netlify/functions/scheduled-update.js`, ONE line differs from the copy I audited:
  ```
  2381c2381
  < const NWS_ARCH_POOL_MS = 4000;     // time budget of the `arch` pool (the nws_fc write, its prune and the health flush)
  > const NWS_ARCH_POOL_MS = 4000;     // time budget of the `arch` pool (the nws_fc write and the extra health flush; the nws_fc prune uses the `general` pool)
  ```
  The code is otherwise identical byte for byte (`diff` against my scratch copy).
- Other files changed since the first pass:
  - Tests: `test/helpers/mem-supabase.js`, `test/forecast-archive-fetch.test.js`, `test/forecast-archive-handler.test.js`.
  - Documents: `CLAUDE.md`, `README.md`, `TODO.md`, `src/assets/CHANGELOG.md`, `src/assets/tech-appendix.md`, plan section 5.
- `index.html` and every other non-test, non-document file are unchanged (`cmp` against the scratch copy). The other existing test files (`truth-dr-*`, `prediction-logging-writer`, `usgs-step1-handler`) did not change in this round.

## 2. Status of the findings

| # | Status | Evidence |
|---|---|---|
| 1 `A3l` collision | RESOLVED | The new rows are now `A3o`, `A3p`, `A3q`. The existing `A3l` row is byte-identical to `HEAD` (`cmp` of the grepped lines). `git diff HEAD -- TODO.md` deletes only the header line, A3f and A3h, which were all rewritten; no row is lost. |
| 2 vacuous timer test | RESOLVED | Spies on `setTimeout`/`clearTimeout` over four exit paths, plus `late_skip` (no timer set). The mutant that removes `clearTimeout` is now caught by 4 tests. |
| 3 prune deadline only checked by a source scan | RESOLVED | New test N8b (hour 3, ping at 24 s, `nws_fc` select hangs, end 24.5 to 25.5 s). The mutant is now caught behaviourally (N8b) as well as by S1. |
| 4 the suite hangs without the body limit | RESOLVED | The oversize mocks error after 10 reads. The endless mock pends after 5 reads and errors after 20. The mutant now fails 3 tests and the suite finishes in 4.9 s. |
| 5 unlisted test edit | RESOLVED | Plan section 5 has a new row for `test/usgs-step1-handler.test.js:149, 261, 270, 309`. The v39.15 TODO line names the filter edit. |
| Note 6: pool comment | RESOLVED | See the diff in section 1. |
| Note 12: "cut at 256 KB" | RESOLVED | No "cut at" wording is left. `CLAUDE.md` and appendix 6.10.2 now say the body is abandoned and recorded as `why: shape`. |
| Note 11: exact `off` | RESOLVED | Stated in `CLAUDE.md` and in appendix 6.10.2 (kill switch paragraph). |
| Note 9: v39.6 "about 7 s" | RESOLVED, wording clumsy | Appendix 6.10.1 now says up to about 4 s more, never past 25 s. The insertion splits the old parenthetical ("about 7 s (v39.15: ...) (2 s for this request ..."). The meaning is correct; tidy the wording at the next doc pass. |
| Notes 7, 8, 10 | Accepted as they are | Listed in the v39.15 TODO entry as "could not verify / accepted as is". |
| Note 13: source-scan-only guards | Unchanged, accepted | The own try/catch is still caught only by S1 (below). No throwing path is left inside the block, so a behavioural test cannot tell the difference. |

## 3. Mutants re-run (fresh copy, full `npm test`)

| Mutant | Caught by | Run time |
|---|---|---|
| `clearTimeout` removed | "the fetch's one timer is set and cleared": normal answer, HTTP error, bad shape, timeout (4 fail) | 6.4 s |
| body limit removed | N3 "a body over 256 KB ..."; N3 "a content-length above the bound ..."; N6 "the body is over 256 KB" (3 fail, no hang) | 4.9 s |
| deadline removed from the prune | N8b "the run ends by 25 s"; S1 (2 fail) | 5.0 s |
| own try/catch removed | S1 "the new block ... has its own try/catch" only (1 fail) | 4.9 s |

## 4. The `selectHang` fault in the test helper

- It is safe for the other tests. The check is `(faults.selectHang || []).includes(type)` inside the select branch. The default `faults = {}` gives an empty list, so behaviour is unchanged for the 9 test files that use `createMemClient`.
- Only the new N8b test passes `selectHang`.
- No other existing test changed in this round.

## 5. `npm test` and `TODO.md`

- `npm test`: tests 1711, pass 1709, fail 0, skipped 2, exit 0. This matches the claim.
- `TODO.md`: see finding 1 above. The old `A3l` row is identical to `HEAD`, and no existing row is lost.
- I did not re-run the build. The only build-relevant change is a code comment, and the documents that are bundled changed only in wording.

## 6. Verdict

PUSH MAY PROCEED.

Read-only checks on the live system after the first hourly run (filter `observation_type = 'nws_fc'`, `data->>'ver' = 'v39.15'`):
1. Exactly one new `nws_fc` row, and its `gauge_id` equals that run's `tick_log.gauge_id`. `data.at` equals `tick_log.data.at`.
2. For both `data.g.BRKM2` and `data.g.PORM2`: `http` 200, `why` null, `n` 12, `iss` within 48 h before `at`, `pts` with 12 entries.
3. `data.in.lfq`, `lfT`, `porq`, `porT` and `fin` equal `tick_log.data.in.lf.q`, `in.lf.qT`, `in.por.q`, `in.por.qT` and `final.cfs`. `data.in.out` equals `tick_log.data.out`.
4. In that run's `tick_log.data`: `ms` in its usual range; `aux.logFail` empty; `logFailTotal` 0. `log_health/system` is unchanged.
5. At the first 03:xx UTC run: `tick_log.data.aux.prune` has only the keys `tick_log`, `validation_log`, `bin_snapshot`.
6. After 24 h: 24 `nws_fc` keys with no gap. Count the `why` values. Measure `pg_column_size(data)`.

Still unverified: the 30 s limit, the ping arriving in time, the Weather Service from Netlify, the first prune (November 2028).

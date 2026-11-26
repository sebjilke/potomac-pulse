PROCEED AFTER CHANGES

# Plan audit: forecast archive, a longer limit for the Weather Service requests (TODO A3s, plan version 1)

Auditor: independent, read-only (Opus). Date 2026-11-26. I did not write the plan.
Abbreviation: S = `netlify/functions/scheduled-update.js`. Line numbers are those of the current working tree (v39.15).

What I ran:
- The suite as it is: `ℹ tests 1711`, `ℹ pass 1709`, `ℹ fail 0`, `ℹ skipped 2`, about 5.3 s. This matches plan section 5.
- A scratch copy of the repository with only `NWS_CALL_CAP_MS = 5000` (S:2379): 1711 tests, 1702 pass, **7 fail**, 2 skipped, about 5.2 s. The 7 are listed in finding 3.
- A scratch timeline test (copy of `test/forecast-archive-handler.test.js` with insert times recorded), run against 2000 and 5000. Results are in question 9. Scratch files: `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/limit_plan_audit/` (`w2000/`, `w5000/`, `test/zz-audit-timeline.test.js` in each; `baseline.txt`, `cap5000.txt`).

Short verdict: the code change is safe for the ping, the tick row, the learning and every number the app shows. One number is enough for the ordinary run. But the plan gives one wrong test instruction, misses the test that pins the time budget, and is wrong that "in a late run nothing changes": with 5 s, a late run whose request hangs now loses the whole archive row, also the gauge that did answer.

## Findings

### 1. BLOCKER: the plan tells the builder to change a test that is not about this limit
- Evidence: plan section 3 row `test/forecast-archive-writer.test.js`: "the assertion 'a far deadline does not lengthen the usual 2000 ms cap' becomes the new value". That assertion (`test/forecast-archive-writer.test.js:64-73`) tests `timedLogCall`, whose cap is `LOG_WRITE_CAP_MS = 2000` (S:2371, S:2455), the cap of every log write. It has nothing to do with `NWS_CALL_CAP_MS`. With the constant at 5000 in my scratch copy, this test still passes. If the builder edits it to 5000, it fails; a builder who then "makes it pass" would have to raise `LOG_WRITE_CAP_MS`, which lengthens every log write of every run and breaks the 3 s pool arithmetic.
- Recommendation: delete this row from section 3 and from section 5 ("A far deadline does not lengthen the limit beyond the constant (existing case, new value)"). Add one line to the plan: "`LOG_WRITE_CAP_MS`, `DR_CAP_MS`, `NWS_ARCH_POOL_MS`, `LOG_POOL_MS` and `NEW_LOG_DEADLINE_MS` do not change." If a test of "a far deadline does not lengthen the fetch cap" is wanted, add it to the fetch test file (fetch started with lots of time left: the wait is exactly `NWS_CALL_CAP_MS`); the existing hang case already does that.

### 2. MAJOR: "In a late run nothing changes" is false; the late window in which the whole row is lost grows from about 2 s to about 5 s
- Evidence: the fetch cap is `min(NWS_CALL_CAP_MS, tickStart + 25 s − callAt)` (S:3247). When a request hangs, the fetch ends exactly at the deadline whenever `callAt` is later than 25 s − cap. The write is then refused, because `timedLogCall` refuses a call whose deadline has passed (S:2457-2460), and the extra health flush is refused for the same reason (S:3672). So no `nws_fc` row is written, the gauge that answered is lost too, and nothing is counted in `log_health`.
  - Today (2 s) this happens when the ping ends after about 23 s. With 5 s it happens when the ping ends after about 20 s.
  - Scratch run, one gauge answers at once, the other hangs, inserts fast:
    - ping ends at 22 s: 2000 gives a row at 24.0 s (`BRKM2` clean, `PORM2` timeout); 5000 gives **no row**, run ends at 25.0 s.
    - ping ends at 20 s: 2000 gives a row at 22.0 s; 5000 gives **no row**, run ends at 25.0 s.
    - ping ends at 19 s: both write a row (5000 at 24.0 s).
  - The existing test `ping ends at 22 s, NWS and the insert both hang` (`test/forecast-archive-handler.test.js:320-326`) still passes because the insert hangs in both versions; no test covers "late, one gauge hangs, insert fast".
- How much it matters: little in practice today. In the 45 measured runs the job's own work ended 2.5 to 4.5 s after the start (plan section 4). Late pings come from slow pre-ping work (USGS retry, a scorer backlog, a slow ping), which is when a forecast is most likely to change. The plan text must not claim the opposite.
- Recommendation, pick one and record the ruling:
  - (a) Preferred, one line, never worse than today: keep room for the write when there is room, and keep today's cap otherwise:
    `const left = tickStartMs + NEW_LOG_DEADLINE_MS - ft;`
    `const cap = Math.min(NWS_CALL_CAP_MS, Math.max(left - LOG_WRITE_CAP_MS, Math.min(2000, left)));`
    With more than 7 s left the cap is 5 s; between 4 and 7 s left it is `left − 2 s`; below 4 s it is exactly today's `min(2 s, left)`. A literal `2000` would need its own named constant (for example `NWS_CALL_CAP_MIN_MS`). This is a logic change, so it needs the owner's word, a test per branch, and an explicit line in the docs.
  - (b) Keep one number. Then correct section 2 and section 4 ("a late run whose request hangs loses the whole row when the ping ends after about 20 s; today after about 23 s"), add the test of finding 6 item 2 that pins this, and add the live check of question 12 item 3.

### 3. MAJOR: the plan's list of test edits is incomplete; the test that pins the time budget is missing
- Evidence, the 7 tests that fail with only the constant changed:
  1. `test/forecast-archive-fetch.test.js:93` "hang before headers ... the timer ends the wait at 2000 ms" (asserts at `:97` and `:99`). Listed in the plan.
  2. `test/forecast-archive-fetch.test.js:106` "a body that never ends ends at the cap" (asserts `2000` at `:111`). Not listed.
  3. to 6. `test/forecast-archive-fetch.test.js:195` "the fetch's one timer is set and cleared" (4 cases). The helper `fetchTimer` at `:187` filters timers with `ms === 2000`. Not listed.
  7. `test/forecast-archive-handler.test.js:351-355` "a hung NWS adds at most about 2 s to a normal tick" (`added 5000`). Not listed. This is the one test that pins the time budget of plan section 4, so its new bound must be chosen on purpose, not "fixed until green".
- Recommendation: list all seven in section 3. For 1 to 6 read `_test.NWS_CALL_CAP_MS` (it is already exported, S:3356). For 7 rename to "adds at most about 5 s" and set the bound to `NWS_CALL_CAP_MS + 500`, or better a literal `5500`, so that a future increase has to touch it. Keep the rule from the plan: each edit listed in the report.

### 4. MINOR: one sentence in the Tech Appendix becomes false and is not in the document list
- Evidence: `src/assets/tech-appendix.md:588` (section 6.10.1, Difficult Run): "v39.15: with the archive on, up to about 4 s more can follow after the tick row, never past 25 s from the tick's start". With 5 s and a fast tick row, the wait for the fetch alone can be about 3 to 4.5 s after the tick row, then the write and the flush up to 4 s more on the `arch` pool. Scratch: ping 3 s, one gauge hangs, `nws_fc` insert and `log_health` hang: tick row at 3.0 s, run ends at 12.0 s (9 s after the tick row; today 6 s).
- Recommendation: rewrite it, for example "up to the fetch limit (5 s from the ping) plus about 4 s more can follow after the tick row, never past 25 s from the tick's start". Add the line to plan section 3.

### 5. MINOR: the version places are listed only in part
- Evidence: `test/howitworks-text.test.mjs:53-69` requires agreement of `index.html` meta, `CLAUDE.md` heading, `src/assets/tech-appendix.md` "**Current version:**" (`:865`) and "Generated by Potomac Pulse" (`:901`), `README.md` "**Current Version**" (`:6`), `TODO.md` "current version:" (`:7`) and a `| v39.16 |` row in `src/assets/CHANGELOG.md`. The plan names the appendix only for "section 6.10.2: the limit; version history line" and `TODO.md` only for row A3s. `README.md` also has "## Current Model (v39.15)" (`:58`), the test count (`:161`) and the "Last updated" line (`:266`); `TODO.md:7` carries the test count.
- Recommendation: list each of these lines in section 3. The suite would catch the pinned ones, but the plan should not rely on that.

### 6. MINOR: the time budget of section 4 has three small errors
- Evidence:
  - "the write (usually well under 1 s, capped at 4 s)". One write is capped at 2 s (`LOG_WRITE_CAP_MS`, S:2371, S:2455). The 4 s is the `arch` pool (S:2381), shared by the write and the extra health flush (read and write, S:2516, S:2532).
  - The hour-3 `nws_fc` prune (S:3667-3671) runs on the `general` pool, up to what is left of its 3 s. So after the fetch the worst is about 2 s (write) + up to 3 s (prune, hour 3 only) + 2 s (flush, what is left of `arch`) = about 7 s, not 4 s. Worst ordinary run: about 9.5 + 7 = about 16.5 s, not 13 s. Still far below 25 s.
  - "the requests start about 2 to 4 s after the run starts": the plan's own figure for the end of the job's work is 2.5 to 4.5 s, and the ping comes after it (S:3598-3607), so the requests start no earlier than that.
- Recommendation: correct the numbers. The conclusion (well inside 25 s; the 29 s case unchanged) holds.

### 7. MINOR: "on a timeout the stored ms is now 5000" holds only for a run that is not late
- Evidence: a timed-out gauge stores `ms: cap` (S:3278), and `cap` is shortened in a late run (S:3247). The row-level `ms` is `Date.now() − ft` (S:3281), slightly above the cap.
- Recommendation: say "5000, or less in a late run". Live check items 4 and 5 should then identify a timeout by `why`, not by `ms = 5000`.

### 8. MINOR: two comments in S are test anchors and must not be edited
- Evidence: `test/forecast-archive-writer.test.js:170` cuts the source at `'// v39.15: the Weather Service forecast archive'` and `:195` at `'v39.15: start the Weather Service forecast archive request'` (S:3609). If the builder "updates" these comments to v39.16, those tests break or, worse, scan the wrong region.
- Recommendation: tell the builder: change only the comment at S:3238 (doc comment of `fetchNwsArchive`, "min(2000 ms, ...)"). The comment at S:2379 does not state 2 s (it reads "one timer over both requests and both body reads"); leave it. Leave all "v39.15:" comments and S:3626 "Time-bounded (2 s)" (that is the Difficult Run).

### 9. MINOR: with every test reading the constant, only the new 3 s case pins the value
- Evidence: plan section 3 wants the tests to read the exported constant. Then a slip back to 2000 fails only the new "answers after 3 s" case (my scratch run confirms the old value fails such a case only if the case exists).
- Recommendation: keep the 3 s case as written (it must fail on 2000), and add one plain assertion `assert.equal(_test.NWS_CALL_CAP_MS, 5000)` next to it, so the intended number is stated once in the tests.

## Answers to the questions of plan section 9

1. **Is one number enough?** For the code, yes. `NWS_CALL_CAP_MS` is read in one place (S:3247) and exported for tests (S:3356). The timeout record copies `cap` (S:3278). No pool, budget or helper derives from it: `arch` 4 s (S:2381), `LOG_WRITE_CAP_MS` 2 s (S:2371), the deadline 25 s (S:2378) are independent. The test drivers have room: `drive` in the fetch tests runs at most 80 × 100 ms = 8 s of fake time (`test/forecast-archive-fetch.test.js:23`), in the handler tests 100 × 500 ms = 50 s (`test/forecast-archive-handler.test.js:35`). The one interaction that changes behaviour is with the deadline (finding 2). Comments that would become false: S:3238 only; doc sentences: findings 4 and 5.
2. **Is the time budget right; can the wait delay the tick row, the ping, the learning or the next run?** The ping is awaited at S:3598-3607, before the fetch starts (S:3612-3622). Learning, validation, run health and the pending prediction are all before the ping (S:~3540-3580). The tick row is written in `finalizeTick` (S:3642, S:3100-3113), and `nwsP` is awaited only after that (S:3654). The tick row's `ms` is taken inside `finalizeTick` (S:3104). So no path lets the longer wait delay the ping, the tick row or the learning. Only the end of the function moves, by up to 3 s, and never past 25 s for the new part. The next run is an hour later. The budget numbers need the corrections of finding 6.
3. **Does anything else read `NWS_CALL_CAP_MS` or depend on `ms` 2000?** In code, no (grep over the repository). No test imports `NWS_CALL_CAP_MS` today; the tests hard-code 2000 (finding 3). Nothing in `src/` or `index.html` reads `nws_fc` (grep: only `src/assets/*.md` mention it). The only analysis script that touches the Weather Service (`analysis/forecast_source_check_2026-11-26/check_source.py`) calls it directly and does not read `nws_fc.ms`. The v39.15 live-check queries that classify timeouts should use `why`, not `ms` (finding 7).
4. **Is 5 s right?** Yes, as a probe. The data are censored at 2 s (slowest success 1.98 s), so the tail is unknown; 5 s is 2.5 times the old limit and 3.5 times the 90th percentile, and an ordinary run still ends near 9 s (worst about 16.5 s) against 25 s. There is no case for 4 s. More than 5 s fits the ordinary budget too, but each extra second widens the late window of finding 2 unless option (a) is taken. Keep 5 s; decide after the data.
5. **Is rejecting a second try sound?** Yes for now. Inside one 5 s timer a second try needs a per-attempt timer and more code in a load-bearing file. The data to decide already exist: a timed-out gauge keeps `http` when the headers had arrived (S:3278, `rec.http ?? null`). So "no headers" (`http` null: stalled connection, where a retry helps) and "slow body" (`http` 200) can be told apart. Make this split part of the live check (question 12).
6. **Which test is missing?**
   - The seven edits of finding 3, done on purpose.
   - Handler: ping ends at about 21 to 22 s, one gauge answers, the other hangs, inserts fast. With option (b) it asserts no `nws_fc` row and an end by 25.5 s (and that the old cap would have kept the row is stated in the comment); with option (a) it asserts a row with the answered gauge clean.
   - Fetch: a cap between 2 and 5 s from the deadline (for example 3.5 s left: the wait is exactly 3500 ms). The existing late case (`test/forecast-archive-fetch.test.js:145-152`, 1.5 s left) cannot tell 2 s from 5 s.
   - Fetch: the new 3 s success case (in the plan), plus the value pin of finding 9.
   - With option (a): one test per branch of the new cap (more than 7 s left, 4 to 7 s left, below 4 s left).
7. **Is the document list complete?** No. Add `src/assets/tech-appendix.md:588` (finding 4) and every version line of finding 5. The places that state this step's 2 s limit are: `CLAUDE.md:150` ("under one 2 s timer"), `src/assets/tech-appendix.md:610` ("at most 2 s"), S:3238, `TODO.md:234` (row A3s). The Difficult Run's own 2 s (S:2555, S:3626, `CLAUDE.md:170`, `src/assets/tech-appendix.md:588` first half) must stay. `TODO.md:227` (A3h, "Added time is capped at about 6 s after the ping") describes the old path; worth a clause "(plus up to 5 s for the archive request since v39.16, never past 25 s)".

## Answers to the auditor's questions 8 to 12

8. **Statements in the plan that do not hold:**
   - Section 4, "In a late run nothing changes": false (finding 2).
   - Section 3, the writer test asserts "the usual 2000 ms cap" of this step: false, it is `LOG_WRITE_CAP_MS` (finding 1).
   - Section 3, "the two comments that say 2000 ms or 2 s (`:2379`, ...)": the comment at S:2379 does not say 2 s; only S:3238 does (finding 8).
   - Section 4, "plus the write (... capped at 4 s)": one write is capped at 2 s; 4 s is the `arch` pool; the hour-3 prune adds up to 3 s on `general` (finding 6).
   - Section 4, "about 13 s at the very worst in an ordinary run": about 16.5 s at hour 3 (finding 6).
   - Section 4, "requests start about 2 to 4 s after the run starts": no earlier than 2.5 to 4.5 s plus the ping (finding 6).
   - Section 2, "On a timeout the stored ms is now 5000": only outside late runs (finding 7).
   - Section 5, "A far deadline does not lengthen the limit beyond the constant (existing case, new value)": the existing case is about the write cap (finding 1).
   - These hold: S:2379 is the constant and S:3247 its use; the fetch starts after the ping (S:3598-3622); it runs beside the Difficult Run request and the log writes (S:3628, S:3640-3645); it is awaited only after `finalizeTick` (S:3654 after S:3642); it has its own try/catch (S:3652, S:3673); the write uses `arch` 4 s and the deadline (S:3664); `NWS_ARCHIVE=off` gates both the start (S:3615-3616) and the whole tail (S:3651), so it covers the request, the write, the prune and the extra flush; the 29 s case (ping ends at 24 s, log writes hang) is unchanged, because the cap is 1 s in both versions (confirmed by `.IMPL_AUDIT.md` check 4 table); two requests an hour.
9. **Four runs with 5 s** (fake-clock scratch runs, ping ends at the time stated, database answers at once unless it hangs; "today" is the same run with 2 s):
   - (a) Ordinary, both requests answer in 0.5 s, ping ends at 3 s: fetch done 3.5 s; tick row 3.0 s; `nws_fc` row 3.5 s; function ends 3.5 s. Today: identical.
   - (b) Ordinary, one request hangs, ping ends at 3 s: tick row 3.0 s (unchanged); fetch ends 8.0 s (today 5.0 s); `nws_fc` row 8.0 s with the other gauge clean (today 5.0 s); function ends 8.0 s (today 5.0 s). If the `nws_fc` insert and the health flush also hang: no row in either version, function ends 12.0 s (today 9.0 s). Difference: up to 3 s later end, nothing else.
   - (c) Late, ping ends at 22 s, one request hangs: Difficult Run skipped (more than 20 s, S:2714); tick row 22.0 s (unchanged); fetch cap min(5, 3) = 3 s, ends 25.0 s (today cap 2 s, ends 24.0 s); write refused, **no `nws_fc` row, the answered gauge is lost, nothing counted in `log_health`** (today: row at 24.0 s with the answered gauge clean); function ends 25.0 s (today 24.0 s). Same loss with the ping at 20 s (today: row at 22.0 s). With the ping at 19 s the row is still written (24.0 s).
   - (d) Log writes before the tick row hang (validation, snapshot, `log_health`: the `general` pool, 3 s), Difficult Run fast, one request hangs, ping ends at 3 s: tick row 6.0 s (unchanged); fetch ends 8.0 s (today 5.0 s, already done); `nws_fc` row 8.0 s (today 6.0 s); function ends 8.0 s (today 6.0 s). If the Difficult Run also hangs (2 s), the tick row is at 8.0 s and the fetch is already done: no difference. If every insert hangs, including the tick row and `nws_fc`: function ends 12.0 s in both versions, no tick row and no `nws_fc` row in both.
   - In all four the tick row is written at the same time as today. Only (b), (c) and (d) end later (0 to 3 s), and only (c) loses data.
10. **Overlap, learning, shown numbers.** Two runs cannot overlap: runs are an hour apart, and the new part ends by 25 s after the start (the old 29 s worst case is unchanged). The learning, the validation, the bins, run health (`updateRunHealth`, before the ping; `missedRuns` is computed from the time of that call, S:2093-2118) and the pending prediction all happen before the ping, so nothing learned changes. Nothing on the page reads `nws_fc` or `tick_log` (grep over `src/`, `index.html`). The tick row's own `ms` is taken before the await (S:3104). The only stored values that change are in `nws_fc`: more gauges with points, timeouts with `ms` 5000, and in rare late runs a missing row (finding 2). `log_health` can show fewer `nws_fc` counts in those late runs, since a skip past the deadline is not counted.
11. **Mocks and real time.** All affected tests run under `t.mock.timers` (setTimeout and Date). The drivers have room for 5 s (question 1). The suite took about 5.3 s before and about 5.2 s with 5000; no test waits in real time on this limit. The seven failures are assertion values, not hangs or driver overruns. `test/truth-dr-handler.test.js` is not affected: its fetch mock throws for the Weather Service addresses, so the archive ends at once with `fetch_error` (`test/truth-dr-handler.test.js:118`). The new 3 s success case will work with a `setTimeout`-based mock under fake timers, as my scratch case `slow3` showed (`null/3000` for both gauges with 5000; `timeout/2000` with 2000).
12. **What the live check should add to section 6:**
    1. Split the timeouts by `http`: `null` (no headers; stalled connection, where a second try would help) and `200` (headers arrived, slow body). This is the evidence for the retry decision of section 7.
    2. The distribution of successful `ms`, and how many are within 500 ms of 5000. A pile-up near 5000 means the data are still censored and 5 s is still short.
    3. The call start relative to the run start (`ft` minus the epoch of `at`), and the number of runs where it is above about 18 s. Count `tick_log` keys without an `nws_fc` key. Any such gap with a late call start is finding 2 happening.
    4. `tick_log.data.ms` (the run time at the tick row) before and after: it must not move. This is the direct proof that the tick row is not delayed.
    5. `log_health/system` counts for `nws_fc` and the `logFail` list in `tick_log.aux`: no new timeouts or budget skips.
    6. For the first run: the timed-out gauge (if any) has `ms` exactly 5000, and the row-level `ms` is not above about 5.1 s plus the time of the wait behind the Difficult Run request.
    7. If the Netlify function log is readable to the verifier: the function's real duration for runs with a timeout (about 3 s longer than before, never near 30 s). Otherwise say it was not checked.
    8. healthchecks.io: no late or missing ping after the deploy (expected unchanged; it is the only external effect worth one look).

## Could not check
- The live database, Netlify logs and healthchecks.io (read-only audit of the repository only; no outside requests).
- Netlify's real 30 s limit for scheduled functions, and whether Netlify retries a scheduled run that times out (TODO A3h).
- Where the slowness comes from (Netlify's route or the Weather Service), and whether the slow requests finish between 2 and 5 s at all.
- Real-clock behaviour of `setTimeout` and `AbortController` under load on Netlify; all timings above are from fake timers with a 500 ms driver step, so they are exact to about 0.5 s.
- How often pings end later than 20 s in production (the plan's 45 runs suggest never so far; I did not see the data).

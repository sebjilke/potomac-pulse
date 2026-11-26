PUSH AFTER CHANGES (documents only: the code and the tests may go as they are)

# Implementation audit: a longer limit for the Weather Service requests (TODO A3s, v39.16)

Auditor: independent, read-only (Opus). Date 2026-11-26. I did not write the change.
S = `netlify/functions/scheduled-update.js` in the working tree. HEAD = 26db8db.
Scratch: `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/limit_impl_audit/` (`head/`, `wt/`, `timeline*.json`, `t2_*.json`, `mutations.txt`, `mut_*.txt`, `suite_*.txt`).

Short verdict: the code does what plan section 2 says, nothing more. The ping, the tick row and everything before the archive step are identical to HEAD in all 24 runs I drove. Late runs store at least what HEAD stored. The tests catch 14 of my 15 mutants. Two document sentences are false or misleading and should be fixed before the push (findings 1 and 2). One small behaviour change in late runs is not mentioned anywhere (finding 3).

## Findings

### 1. MINOR: Tech Appendix line 588, the measured figure is attributed to the wrong case, and hour 3 is missing
- Text: "... the wait for the Weather Service (up to 5 s from the ping, less in a late run) and up to about 4 s of writes can follow after the tick row, never past 25 s from the tick's start; measured 9 s after the tick row with every request and write hanging".
- Evidence (fake clock, ping ends at 3 s, one gauge hangs):
  - Only the two archive writes hang (`nws_fc` insert and `log_health`): tick row 3.0 s, run ends 12.0 s, so 9 s after the tick row (HEAD: 9.0 s, 6 s).
  - Every log write hangs: the tick row itself is late (6.0 s) and the run ends 12.0 s, so 6 s after the tick row, the same as HEAD.
  - Hour 3, archive writes and the `nws_fc` prune select hang: tick row 3.0 s, run ends 14.0 s, so 11 s after the tick row (HEAD 11.0 s, 8 s). The writes after the wait take about 6 s here, not "about 4 s".
- Recommendation: replace the clause with: "with the archive on, the wait for the Weather Service (up to 5 s from the ping, less in a late run) and up to about 4 s of writes (about 6 s at 03 UTC, when the `nws_fc` prune runs) can follow after the tick row, never past 25 s from the tick's start; measured 9 s after the tick row when the archive writes hang (11 s at 03 UTC)".

### 2. MINOR: the one-line rule says "otherwise as before", which is false for 4 to 7 s left
- Text in CLAUDE.md (v39.16 bullet), README (row and "Last updated"), CHANGELOG, Tech Appendix 6.10.2, the version history line and the footer, TODO A3s: "5 s when a full log write still fits before the 25 s deadline, otherwise as before (2 s or the time left)".
- Evidence: with 5 s left the code gives 3 s (test "with 5000 ms left the timer is 3000 ms"; run d20 below: `PORM2` timeout `ms` 3000). Before it was 2 s. So between 4 and 7 s left it is neither 5 s nor "as before". The CLAUDE.md bullet also opens with "is 5 s, up from 2 s, when a full log write still fits after it", which is the same simplification.
- Second wording slip, Tech Appendix 6.10.2: "2 s with 4 s or 3 s left, the time left below that". With 2.5 s left the limit is 2 s, not the time left.
- Recommendation: one sentence everywhere: "5 s when a full log write still fits after it; with less time, the longest wait that still leaves room for a full log write, but never less than before (2 s, or the time left below 2 s)". In 6.10.2: "2 s with between 2 and 4 s left, the time left below 2 s".

### 3. MINOR: in a late run with 4 to 7 s left, a hung `nws_fc` write is no longer counted in `log_health`
- Evidence (one gauge hangs, the `nws_fc` insert hangs):
  - ping at 18 s: HEAD writes `log_health` (`byType.nws_fc` 1) at 22 s, ends 22 s. New: no `log_health` row, ends 25 s.
  - ping at 20 s: HEAD counts it at 24 s, ends 24 s. New: not counted, ends 25 s.
  - ping at 3 s and at 21 s: same count in both versions.
- Why: the formula keeps room for one write (2 s) but not for the extra health flush that follows a failed write. Both draw on the same 25 s deadline.
- What it costs: only the counter of a failure of the log itself; the forecast row was already lost in both versions, and the missing `nws_fc` key still shows it. The plan's claim "never leaves less room for the write than today" holds. The broader claim "never worse than before" does not hold for this counter.
- Recommendation: either (a) record it in the plan and in Tech Appendix 6.10.2 ("in a late run with 4 to 7 s left, a hung archive write may not be counted in `log_health`; it shows as a missing key"), or (b) set `NWS_WRITE_RESERVE_MS = NWS_ARCH_POOL_MS` (4000). Option (b) gives 5 s only from 9 s left (every ordinary run still gets 5 s) and keeps room for the write and the flush; it changes the table, the tests of the table and the docs, so it needs another round. I recommend (a) now.

### 4. MINOR (not part of this change, noted for the live check): nothing tests `SERVER_VERSION`
- Evidence: mutant M15 (`SERVER_VERSION = 'v39.15'`) passes the whole suite (1720 / 1718 / 0 / 2). `test/howitworks-text.test.mjs` compares the documents and `index.html`, not the server constant; the handler tests compare `ver` with `_test.SERVER_VERSION` itself.
- Recommendation: nothing for this push; the live check item 1 (`tick_log` and `nws_fc` carry `ver` v39.16) is the only guard, so it must be done.

### 5. Information: "a full log write still fits" holds to within the timer's lateness
- With 4 to 7 s left the write's own cap is `min(2000, deadline − now)`, and "now" is a few ms after the timer fired. So on a real clock the write gets about 1,99x ms, not exactly 2,000. No action.

## 1. The plan audit's findings

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Wrong test named (`forecast-archive-writer.test.js`) | RESOLVED | File not in the diff; its tests pass; `LOG_WRITE_CAP_MS` still 2000 (S:2371 unchanged) |
| 2 | Late run loses the row with one number | RESOLVED | Formula at S:3251-3252; runs d20 and d22: the row is written with `BRKM2` clean, as in HEAD; mutant M7 (plain `min(5000, left)`) is caught by the new handler test and three fetch cases. Residual: finding 3 |
| 3 | Seven tests to edit | RESOLVED | `:93`, `:106`, helper `fetchTimer` read `NWS_CALL_CAP_MS`; handler bound 5500 literal |
| 4 | Tech Appendix `:588` false | PARTIAL | Rewritten, but the measured figure and the hour-3 case are wrong (finding 1) |
| 5 | Version places | RESOLVED | All places say v39.16 (point 5) |
| 6 | Time budget errors | RESOLVED in the plan; docs see finding 1 |
| 7 | Stored `ms` is the limit that applied | RESOLVED | CLAUDE.md and Tech Appendix say "5000, or less in a late run"; runs d19 (4000), d20 (3000) |
| 8 | Comments to leave alone | RESOLVED | No "v39.15:" comment and not `:3631` "(2 s)" touched; S:2379 only its number; writer source-scan tests pass |
| 9 | Pin the value | RESOLVED | `assert.equal(_test.NWS_CALL_CAP_MS, 5000)` plus the reserve and late constants |

## 2. The code diff

Changed lines of S, all of them: `SERVER_VERSION` v39.16 (:2363); `NWS_CALL_CAP_MS` 5000 (:2379); new `NWS_WRITE_RESERVE_MS = LOG_WRITE_CAP_MS` (:2380, declared after :2371, so no use before definition) and `NWS_CALL_CAP_LATE_MS = 2000` (:2381); the doc comment of `fetchNwsArchive` (:3240-3241); `left` and `cap` (:3250-3252); two names added to `_test` (:3361). Nothing else. Unchanged and checked: `LOG_WRITE_CAP_MS` 2000, `LOG_POOL_MS`, `NWS_ARCH_POOL_MS` 4000, `NEW_LOG_DEADLINE_MS` 25000, `DR_CAP_MS`, `DR_LATE_SKIP_MS`, `FC_LOG_SCHEMA` 1, the handler, `timedLogCall`.

`cap = min(5000, max(left − 2000, min(2000, left)))` against the old `min(2000, left)`:

| Time left | New | Old | Room after the wait |
|---|---|---|---|
| more than 7 s (e.g. 22 s) | 5000 | 2000 | at least 2 s |
| exactly 7 s | 5000 | 2000 | 2 s |
| 4 to 7 s (e.g. 5 s) | left − 2000 (3000) | 2000 | exactly 2 s |
| exactly 4 s | 2000 | 2000 | 2 s |
| 2 to 4 s (e.g. 3 s) | 2000 | 2000 | same as old |
| below 2 s (e.g. 1.5 s) | left (1500) | 1500 | same as old (none) |
| zero | 0, `late_skip` | 0, `late_skip` | same |
| negative | negative, `late_skip` | same | same |
| not a number (NaN) | NaN, `!(cap > 0)` gives `late_skip` | same | same |

Never shorter than before; longer only in the first three rows, and there at least 2 s (one full write) remains. Confirmed.

## 3. Old against new, by experiment

Method: copies of HEAD and the working tree, each with a scratch test that reuses the handler test's harness (`runArm`, the fake clock with a 500 ms step, `createMemClient`) and records the virtual time of each ping, request, insert and upsert. "Ping" is the time the success ping ends. In every run, for both versions: one ping `ok` at 0 s, status 200, the same non-log rows, the same non-log write sequence, the same `tick_log` row apart from `ver` (v39.15 against v39.16), the same tick row time, the same insert order up to the tick row, no unhandled rejection.

| Run | Tick row | HEAD: `nws_fc` row (time, content), end | New: `nws_fc` row (time, content), end |
|---|---|---|---|
| a ordinary, both answer in 0.5 s, ping 3 s | 3.0 | 3.5 s, both clean (12 points), end 3.5 | identical |
| b ordinary, PoR answers after 3 s | 3.0 | 5.0 s, BRK clean, PoR timeout `ms` 2000, end 5.0 | 6.0 s, both clean (PoR `ms` 3000), end 6.0 |
| c ordinary, PoR hangs | 3.0 | 5.0 s, BRK clean, PoR timeout 2000, end 5.0 | 8.0 s, BRK clean, PoR timeout 5000, end 8.0 |
| c2 ordinary, both hang | 3.0 | 5.0 s, both timeout 2000 | 8.0 s, both timeout 5000 |
| d19 ping 19 s, PoR hangs | 19.0 | 21.0 s, BRK clean, PoR timeout 2000, end 21.0 | 23.0 s, BRK clean, PoR timeout 4000, end 23.0 |
| d20 ping 20 s, PoR hangs | 20.0 | 22.0 s, BRK clean, PoR 2000, end 22.0 | 23.0 s, BRK clean, PoR 3000, end 23.0 |
| d21 ping 21 s, PoR answers after 3 s | 21.0 | 23.0 s, BRK clean, PoR timeout 2000 | identical |
| d22 ping 22 s, PoR hangs | 22.0 | 24.0 s, BRK clean, PoR 2000, end 24.0 | identical |
| d23.5 ping 23.5 s, PoR hangs | 23.5 | no row, end 25.0 | identical |
| d24.5 ping 24.5 s, PoR hangs | 24.5 | no row, end 25.0 | identical |
| e `NWS_ARCHIVE=off` (also with PoR hanging) | 3.0 | no request, no row, end 3.0 | identical |
| f3 every log write hangs, PoR hangs, ping 3 | 6.0 | no row, end 12.0 | identical |
| f3ok every log write hangs, NWS fast | 6.0 | no row, end 12.0 | identical |
| f20 every log write hangs, ping 20 | 23.0 | no row, end 25.0 | identical |
| k24 everything hangs, ping 24 | 27.0 | no row, end 29.0 | identical |
| g3 `nws_fc` insert hangs, PoR hangs, ping 3 | 3.0 | counted in `log_health`, end 7.0 | counted, end 10.0 |
| g18 same, ping 18 | 18.0 | counted at 22, end 22.0 | NOT counted, end 25.0 (finding 3) |
| g20 same, ping 20 | 20.0 | counted at 24, end 24.0 | NOT counted, end 25.0 (finding 3) |
| g21 same, ping 21 | 21.0 | not counted, end 25.0 | identical |
| i3 `nws_fc` and `log_health` hang, ping 3 | 3.0 | end 9.0 | end 12.0 |
| h3 hour 3, PoR hangs, ping 3 | 3.0 | 5.0 s, end 5.0 | 8.0 s, end 8.0 |
| j3 hour 3, archive writes and prune select hang | 3.0 | end 11.0 | end 14.0 |

Late runs: the new version stores at least what HEAD stored in every case (d19 to d24.5). No run ends past 25 s except k24, which ends at 29 s in both versions (pre-existing, plan section 4).

## 4. The tests

Whole suite, run by me: working tree `ℹ tests 1720`, `ℹ pass 1718`, `ℹ fail 0`, `ℹ skipped 2`. HEAD copy: 1711 / 1709 / 0 / 2. The 9 new tests: fetch file 8 (value pin, 3 s success, five table rows, `late_skip`), handler file 1 (late run at 22 s).

Reading the changed and added tests: each asserts what its name says. The table cases check the wait, that exactly one timer of that length was set, the timeout and the stored `ms`. The 3 s case fails on 2000. The late-run handler case fails on the plain one-number change (M7). No assertion was weakened beyond the planned 2500 to 5500 bound; the literal 2000 was replaced by the constant, and the constant's value is pinned by its own test. Not covered by a test, but correct by reading: a non-number time.

Mutants (each on a fresh copy of the working-tree S, whole suite):

| Mutant | Failing | Caught by (examples) |
|---|---|---|
| M1 reserve 0 | 5 | table 3, 4, 5 s; late run at 22 s; value pin |
| M2 reserve 4000 | 3 | table 5 and 7 s; value pin |
| M3 late limit 5000 | 5 | table 3, 4, 5 s; late run at 22 s; value pin |
| M4 inner `max` to `min` | 13 | 3 s success, hang ends at the cap, one timer cases, table |
| M5 inner `min` to `max` | 10 | `late_skip` cases, ping at 25.1 s, table, late run at 22 s |
| M6 old constant 2000 | 4 | 3 s success, value pin, table 5 and 7 s |
| M7 plain `min(5000, left)` | 4 | late run at 22 s; table 3, 4, 5 s |
| M8 one timer per gauge | 9 | "the fetch's one timer is set and cleared" (4), table (5) |
| M9 `late_skip` branch removed | 4 | three `late_skip` cases, ping at 25.1 s |
| M10 `min(5000, left − 2000)` | 4 | table 1.5 and 3 s, "cap shrinks to the time left", write cap at 23.5 s |
| M11 `max(left − 2000, 2000)` | 6 | table 1.5 s, `late_skip` cases, ping at 25.1 s |
| M12 reserve 1000 | 3 | table 4 and 5 s; value pin |
| M13 no 5 s ceiling | 9 | hang ends at the cap, "adds at most about 5 s", one timer cases |
| M14 limit 6000 | 2 | value pin; "adds at most about 5 s" |
| M15 `SERVER_VERSION` v39.15 | 0 | NOT CAUGHT (finding 4, pre-existing gap) |

## 5. Version places and documents

`test/howitworks-text.test.mjs` passes (part of the suite). v39.16 appears in: `index.html` meta and footer span; S `SERVER_VERSION`; CLAUDE.md heading and new bullet; README `:6`, `:58`, `:161` (1720), row `:178`, `:267`; TODO `:7` (1720 / 1718 / 2, was 1711) and A3s; CHANGELOG row; Tech Appendix 6.10.2 heading, `:588`, `:610`, `:865`, `:867`, `:869`, `:903`. v39.15 remains only where it should: the v39.15 code comments, the v39.15 bullet and history lines. No stray v39.16.

Document statements checked against the code: the formula, the constants, "never shorter than the old one", "up to 3 s later" (ordinary runs: +3 s; late runs: +1 to +3 s, runs d19, d20, g18, g20), "ping and tick row not delayed", "count timeouts by `why`", the test counts: all true. False or misleading: Tech Appendix `:588` (finding 1); "otherwise as before" and "the time left below that" (finding 2). TODO A3h ("Added time is capped at about 6 s after the ping; since v39.15 the forecast archive may run until tick start plus 25 s"): not made false by this change; its first clause was already out of date (the Appendix says about 7 s), the second still holds. TODO A3s still says "share one 2 s limit" in its problem description; that is history and is followed by "Built in v39.16". No other untouched sentence is now false that I found (grep for 2 s, 2000, 6.4 s, about 4 s, about 6 s over the five documents).

## 6. Wording

`index.html` changes only the two version strings. The Tech Appendix is offered to visitors as a download (`src/ui/tech-appendix.js`), so its new text reaches visitors, as with every release; the on-page wording is unchanged. Em-dash counts per document are the same before and after (CLAUDE.md 29, README 99, TODO 91, CHANGELOG 161, Appendix 86); the added lines that show an em-dash are old text on a changed line. Plain words, apart from finding 2.

Files outside the expected list: none. `git status` shows the expected files, the three plan files, and the sampler's `source_samples.csv` and two `samples/20261126T221305Z_*.json` files, which I ignored.

## 7. For the live check, beyond plan section 6

1. Item 1 is the only guard of `SERVER_VERSION` (finding 4): check `ver` on `tick_log` and `nws_fc` explicitly.
2. For each timed-out gauge, check that its `ms` equals the formula: with `left = at + 25000 − ft` (both stored in the `nws_fc` row), `ms == min(5000, max(left − 2000, min(2000, left)))`. This checks the formula live in every run, ordinary and late.
3. Count runs whose `ft` is 18 to 21 s after `at`, and in those any `tick_log` key without an `nws_fc` key: there a lost write is no longer counted in `log_health` (finding 3).
4. At 03 UTC, the gap from `at` to the `nws_fc` row's save time (the prune adds to it).

## Could not check

- The live database, Netlify logs, healthchecks.io (no outside requests).
- Netlify's real 30 s limit and real-clock timer behaviour; all times are fake-clock with a 500 ms step, so they are exact to about 0.5 s.
- Whether the slow requests finish between 2 and 5 s at all.
- A run with a real network stall where the abort does not end the socket; the mocks ignore or honour the abort, as in the existing tests.

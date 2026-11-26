# Forecast archive: a longer limit for the Weather Service requests (TODO A3s)

Plan version 2, 2026-11-26. It replaces version 1 (kept as `forecast-archive-limit-plan-2026-11-26.v1.md`) after the independent audit (`forecast-archive-limit-plan-2026-11-26.PLAN_AUDIT.md`, verdict "proceed after changes"). Rulings on the audit: section 10.

Owner's word: "raise the limit" (2026-11-26), after the recommendation "raise the limit to about 5 seconds; a small server change with the usual plan, audit and live check".

## 1. The problem

Since v39.15 the hourly job asks the Weather Service once an hour for its river forecast at Little Falls (`BRKM2`) and Point of Rocks (`PORM2`) and stores the answers in one `nws_fc` row. Both requests run side by side under one timer of 2 s (`NWS_CALL_CAP_MS`, `netlify/functions/scheduled-update.js:2379`, used at `:3247`). A request that has not finished when the timer fires is stored as `why: timeout` with no forecast.

Full live check, 2026-11-26 21:37 UTC, 45 runs (fresh verifier, read-only):
- 16 of 90 requests ran into the limit (Little Falls 7, Point of Rocks 9); 13 of 45 runs have at least one gauge without a forecast, 3 have neither.
- The rate rose: 2 of 30 requests in the first 15 runs, 14 of 60 after.
- Requests that succeeded: median about 0.5 s, 90th percentile about 1.4 s, slowest 1.98 s.
- No harm so far: three forecasts were issued in the period, about a day apart, and each was captured at both gauges.

Why it matters now: a rise began on 2026-11-26 (Little Falls about 1,500 to 3,400 cfs; official forecast 21,000 cfs for 2026-11-29 12:00 UTC). On a rise the Weather Service can issue forecasts more often, and a forecast that lives only a few hours can be missed when one request in five fails.

What is not known: how long the slow requests would have taken. From this machine, 28 requests on 2026-11-26 22:05 UTC all answered within 1.2 s, so the slowness seen by the job is either on the route from Netlify or comes in bursts. A limit of 5 s will show the answer: requests that now finish between 2 and 5 s become visible as such.

## 2. The change

**The limit becomes 5 s when there is room for it, and never leaves less room for the write than today.**

```
left = tick start + 25 s − now
cap  = min( NWS_CALL_CAP_MS, max( left − NWS_WRITE_RESERVE_MS, min( NWS_CALL_CAP_LATE_MS, left ) ) )
```

with `NWS_CALL_CAP_MS = 5000` (was 2000), and two new named numbers: `NWS_WRITE_RESERVE_MS = LOG_WRITE_CAP_MS` (2000, the longest one log write may take) and `NWS_CALL_CAP_LATE_MS = 2000` (the old limit, kept for late runs).

What the formula gives:

| Time left before 25 s | Today | New |
|---|---|---|
| 7 s or more (every ordinary run) | 2 s | 5 s |
| 5 s | 2 s | 3 s |
| 4 s | 2 s | 2 s |
| 3 s | 2 s | 2 s |
| 1.5 s | 1.5 s | 1.5 s |
| none | skipped (`late_skip`) | skipped (`late_skip`) |

So the new limit is never shorter than today's and is longer only where a full log write still fits after it. This is the auditor's preferred fix for its finding 2: with the plain change of one number, a late run in which a request hangs would have used up the whole time to the deadline, and the row, including the forecast of the gauge that did answer, would not have been written. That would have been worse than today for runs whose success ping goes out between about 20 and 23 s after the start.

Nothing else in the logic changes:
- One timer and one abort controller for both requests. A gauge that finished before the timer keeps its result.
- The step still starts right after the success ping, runs beside the existing log writes, is awaited only after the tick row is written, and sits in its own try/catch. The success ping is sent before any of it.
- **These numbers do not change:** `LOG_WRITE_CAP_MS` (2 s, every log write), `LOG_POOL_MS` (3 s), `NWS_ARCH_POOL_MS` (4 s, shared by the `nws_fc` write and the extra health flush), `NEW_LOG_DEADLINE_MS` (25 s), `DR_CAP_MS` (2 s, the Difficult Run request), `DR_LATE_SKIP_MS`.
- `NWS_ARCHIVE=off` still switches all of it off.
- `FC_LOG_SCHEMA` stays 1: the row's fields do not change. On a timeout the stored `ms` is the limit that applied: 5000 in an ordinary run, less in a late run.

Rejected for now:
- **The plain change of one number** (see above).
- **A second try after a timeout.** More code in a load-bearing file; whether it is needed is what a day with the new limit will show. A gauge that timed out keeps its `http` value, so "no answer at all" and "answer started, body slow" can be told apart in the stored rows.
- **One timer per gauge.** No gain: the two requests already finish independently.
- **A limit above 5 s.**

## 3. Files

| File | Change |
|---|---|
| `netlify/functions/scheduled-update.js` | `NWS_CALL_CAP_MS = 5000`; the two new constants; the `cap` line at `:3247` with the formula above and a short comment; the doc comment above `fetchNwsArchive` (`:3238`, the only comment that says 2000 ms for this step); export of the two new constants through `_test`; `SERVER_VERSION = 'v39.16'`. **Leave alone:** the comment at `:2379` except for its number if it states one, every comment that begins "v39.15:" (source-scanning tests anchor on them: `test/forecast-archive-writer.test.js:170`, `:195`), and `:3626` "(2 s)", which is the Difficult Run's limit |
| `test/forecast-archive-fetch.test.js` | `:93` (the timer ends the wait), `:106` (asserts 2000 at `:111`), and the four cases of `:195` with the helper `fetchTimer` at `:187` that filters `ms === 2000`: all read `_test.NWS_CALL_CAP_MS` instead of a literal. New cases: `assert.equal(_test.NWS_CALL_CAP_MS, 5000)`; a request that answers after 3 s is a success with its points; one case per row of the table in section 2 (7 s, 5 s, 4 s, 3 s, 1.5 s, none left) |
| `test/forecast-archive-handler.test.js` | `:351-355` "a hung NWS adds at most about 2 s" becomes "about 5 s" with the literal bound 5500. New case: success ping at 22 s, one gauge hangs: the `nws_fc` row IS written and holds the forecast of the gauge that answered (this is the case the formula protects; it must fail on the plain change of one number) |
| `test/forecast-archive-writer.test.js` | **No change.** Its assertion at `:64-73` ("a far deadline does not lengthen the usual 2000 ms cap") tests `timedLogCall` and `LOG_WRITE_CAP_MS`, not this limit. Version 1 of this plan was wrong about it |
| any other test that pins the version string | found by running the whole suite; each edit is listed in the report |
| `index.html` | `<meta name="app-version">` and the footer text: v39.16. No visible wording changes |
| `CLAUDE.md` | header "Current Model Parameters (v39.16)"; a short bullet for v39.16; in the v39.15 bullet the words "under one 2 s timer" get the note "(5 s since v39.16, shorter in a late run)" |
| `src/assets/tech-appendix.md` | section 6.10.2: the limit and the formula; `:588`, where "up to about 4 s more can follow after the tick row" becomes false (it is now up to about 9 s, measured by the auditor on a scratch copy: tick row at 3 s, run ends at 12 s with every write hanging); "Current version" (`:865`); the "Generated by" footer (`:901`); the version history |
| `src/assets/CHANGELOG.md` | a row `\| v39.16 \|` |
| `README.md` | `:6` (checked by a test) and the stale version mentions at `:58`, `:161`, `:266`; the entry for this change |
| `TODO.md` | `:7` (version, checked by a test); row A3s: built |

Version: v39.16, MINOR (server only, logging only, the estimate is unchanged).

## 4. Time budget

Measured since the release (45 runs): the job's own work ends 2.5 to 4.5 s after the run starts; the archive row was saved at most 6.4 s after the start, in a timeout run.

Ordinary run with a hanging request, auditor's timeline on a scratch copy: tick row at 3.0 s as today; the requests end at 8.0 s (today 5.0); the `nws_fc` row is written at 8.0 s; the function ends at 8.0 s (today 5.0). If the row's write and the health flush hang as well, the run ends at about 12 s (today 9). At UTC hour 3 the `nws_fc` prune can add up to 3 s from the general pool, so the worst ordinary run is about 16.5 s. All of it is far inside the 25 s deadline of this step.

Late run: with the formula of section 2 a late run behaves as today (same limit, same room for the write).

The tick row is written at the same moment as today in every case.

Not checkable from here: Netlify's hard limit of 30 s. The old code could already reach about 29 s when the ping ended at 24 s and log writes hung; this change does not move that case.

## 5. Tests that must catch a regression

- The timer ends the wait at the limit when a request never answers.
- The limit is 5000 (pinned by its own assertion, since the other tests read the constant).
- A request that answers after 3 s is a success with its points (fails on the old value).
- One case per row of the table in section 2.
- A gauge that answers fast keeps its result when the other one times out.
- A hung request adds at most about 5 s to an ordinary run (bound 5500).
- Late run, success ping at 22 s, one gauge hangs: the row is written with the other gauge's forecast.
- With `NWS_ARCHIVE=off` no request is made.
- The version places agree (`test/howitworks-text.test.mjs`).
- The whole suite: before the change 1,711 tests, 1,709 pass, 0 fail, 2 skipped (confirmed by the auditor). After: the same plus the new cases, 0 fail.

## 6. Verification after the push (stated before the change)

By a fresh verifier on the top model tier, read-only, not by the session that built it.

First run with the new code:
1. The site serves v39.16; the run's `tick_log` row and `nws_fc` row carry `ver` v39.16.
2. The `nws_fc` row exists, has the same fields as before, is saved after the tick row.
3. The job is healthy: the run is counted, `missedRuns` stays 659, no log failure; the tick row's own `ms` is in the range of the days before (it is taken before the wait, so it must not move).

After about a day of runs (date-gated):
4. The share of requests stored with `why: timeout` (counted by `why`, not by `ms`), against 18% before; split by `http` null (no answer at all) and 200 (answer started).
5. How many successful requests took between 2,000 and 5,000 ms (the ones the old limit lost), and whether they pile up near 5,000 (then 5 s is still too short).
6. The gap between a run's start and the time its `nws_fc` row was saved: maximum, against 6.4 s before.
7. Any `tick_log` key without an `nws_fc` key (a row that was not written).
8. Whether any forecast issue was missed at a gauge.

Cannot be verified by anyone here: Netlify's 30 s limit in a worst-case run; the function's real duration (Netlify's logs are not readable from this session); where the slowness comes from; whether the alert service saw any late ping (the owner would see an email).

## 7. Side effects

- A run in which a request hangs now ends up to 3 s later. The success ping has gone out long before.
- The Weather Service gets no more requests than before: still two an hour.
- If the slow requests take longer than 5 s, the timeout share will not fall, and each such run costs 3 s more. That is the signal to plan the second try, not to raise the number again.

## 8. Roles

Orchestrator: plan, rulings, records. Builder: Sonnet. Plan auditor, code auditor, live verifier: Opus. The push is made outside the two minutes around the top of an hour.

## 9. What differs from what the owner was told

He was told "one number". The audit showed that one number alone makes a rare case worse (section 2). The change is therefore one number plus one line that keeps late runs as they are today. He is told so before the push.

## 10. Rulings on the audit

| Finding | Severity | Ruling |
|---|---|---|
| 1. The plan named a test that checks another limit (`LOG_WRITE_CAP_MS`) | Blocker | Accepted. The row is removed; section 2 lists the numbers that do not change |
| 2. "In a late run nothing changes" was false: with one number, a hung request in a late run leaves no time for the write | Major | Accepted, the auditor's preferred fix (a): the formula of section 2, a test per branch, a test for the late run |
| 3. Seven tests fail on the new value, the plan listed one | Major | Accepted, all seven listed in section 3 |
| 4. A sentence of the Tech Appendix (`:588`) becomes false | Minor | Accepted |
| 5. Version places listed in part | Minor | Accepted, each line listed |
| 6. Three errors in the time budget | Minor | Accepted, section 4 rewritten with the auditor's timeline |
| 7. A timeout's stored `ms` is the limit that applied, not always 5000 | Minor | Accepted; the live check counts by `why` |
| 8. Which comments to leave alone | Minor | Accepted |
| 9. If every test reads the constant, nothing pins its value | Minor | Accepted: an assertion on 5000 and a case per branch |
| Additions to the live check | | Accepted, section 6 |

## 11. After the code audit (`forecast-archive-limit-plan-2026-11-26.IMPL_AUDIT.md`, verdict "push after changes, documents only"), 2026-11-26

The code and the tests go as built: the formula matches section 2 for every time left; ping, tick row and everything before the archive step are identical to the old code in 24 runs driven with a fake clock; late runs store at least what the old code stored; 14 of 15 mutants are caught by the tests.

| Finding | Ruling |
|---|---|
| 1. The Tech Appendix sentence on how long the step can add after the tick row was wrong | Accepted, the auditor's wording |
| 2. The one-sentence form of the rule, "otherwise as before (2 s or the time left)", is false for 4 to 7 s left. The wording came from the orchestrator's brief | Accepted, corrected in every document |
| 3. In a late run with between 4 and 7 s left, an `nws_fc` write that hangs is no longer counted in `log_health`: the formula keeps room for the write, not for the extra health flush after a failed write. The row is lost in both versions and shows as a missing key | Accepted as a known cost and written into the documents. A larger reserve (4 s) would remove it at the price of another round of tests; not done. The statement "never worse than before" is therefore not exact and is not used; "the limit is never shorter than before, and a full log write still fits whenever it is longer" is |
| 4. Nothing in the suite tests `SERVER_VERSION` (older than this change) | No change now. The live check must read `ver` on the rows |

Additions to the live check (section 6): `ver` v39.16 read on both rows; for each timed-out gauge the stored `ms` equals the formula with `left` taken from the row's own times; runs whose requests started 18 to 21 s after the run started; at 03 UTC the gap from the run's start to the time the row was saved.

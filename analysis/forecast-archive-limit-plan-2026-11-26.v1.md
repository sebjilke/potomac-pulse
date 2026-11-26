# Forecast archive: a longer limit for the Weather Service requests (TODO A3s)

Plan version 1, 2026-11-26. Draft for the independent audit. No code is changed before the audit and the rulings on it.

Owner's word: "raise the limit" (2026-11-26), after the recommendation "raise the limit to about 5 seconds; a small server change with the usual plan, audit and live check".

## 1. The problem

Since v39.15 the hourly job asks the Weather Service once an hour for its river forecast at Little Falls (`BRKM2`) and Point of Rocks (`PORM2`) and stores the answers in one `nws_fc` row. Both requests run side by side under one timer of 2 s (`NWS_CALL_CAP_MS`, `netlify/functions/scheduled-update.js:2379`, used at `:3247`). A request that has not finished when the timer fires is stored as `why: timeout` with no forecast.

Full live check, 2026-11-26 21:37 UTC, 45 runs (fresh verifier, read-only):
- 16 of 90 requests ran into the limit (Little Falls 7, Point of Rocks 9); 13 of 45 runs have at least one gauge without a forecast, 3 have neither.
- The rate rose: 2 of 30 requests in the first 15 runs, 14 of 60 after.
- Requests that succeeded: median about 0.5 s, 90th percentile about 1.4 s, slowest 1.98 s.
- No harm so far: three forecasts were issued in the period, about a day apart, and each was captured at both gauges.

Why it matters now: a rise began on 2026-11-26 (Little Falls about 1,500 to 3,400 cfs; official forecast 21,000 cfs for 2026-11-29 12:00 UTC). On a rise the Weather Service can issue forecasts more often, and a forecast that lives only a few hours can be missed when one request in five fails.

What is not known: how long the slow requests would have taken. From this machine, 28 requests on 2026-11-26 22:05 UTC all answered within 1.2 s (median about 0.5 to 0.7 s), so the slowness seen by the job is either on the route from Netlify or comes in bursts. A limit of 5 s will show the answer: requests that now finish between 2 and 5 s become visible as such.

## 2. The change

One number: `NWS_CALL_CAP_MS` from `2000` to `5000`.

Nothing else in the logic changes. In particular:
- The limit stays `min(NWS_CALL_CAP_MS, tick start + 25 s − now)` (`:3247`), so a late run still shortens or skips the requests.
- One timer and one abort controller for both requests, as now. A gauge that finished before the timer keeps its result.
- The step still starts right after the success ping, runs beside the existing log writes, is awaited only after the tick row is written, and sits in its own try/catch. The success ping is sent before any of it, so alerting cannot be affected.
- The write of the `nws_fc` row keeps its own pool (`arch`, 4 s) and the same deadline of tick start plus 25 s.
- `NWS_ARCHIVE=off` still switches all of it off.
- `FC_LOG_SCHEMA` stays 1: the row's fields do not change. On a timeout the stored `ms` is now 5000 instead of 2000.

Rejected for now:
- **A second try after a timeout.** It may help more if the slow requests are stalled connections. It is more code in a load-bearing file, and whether it is needed is exactly what a day with the 5 s limit will show.
- **One timer per gauge.** No gain: the two requests already run side by side and finish independently.
- **A limit above 5 s.** Kept for later; see section 4 for the time budget.

## 3. Files

| File | Change |
|---|---|
| `netlify/functions/scheduled-update.js` | `NWS_CALL_CAP_MS = 5000`; the two comments that say 2000 ms or 2 s (`:2379`, the doc comment above `fetchNwsArchive`); `SERVER_VERSION = 'v39.16'` |
| `test/forecast-archive-fetch.test.js` | the case "the timer ends the wait at 2000 ms" becomes 5000 ms, read from the exported constant where the test can, so the test pins the behaviour and not a copy of the number; a new case: a request that answers after 3 s is stored as a success |
| `test/forecast-archive-writer.test.js` | the assertion "a far deadline does not lengthen the usual 2000 ms cap" becomes the new value |
| any other test that pins the version string or the 2 s | found by running the whole suite; each edit is listed in the report |
| `index.html` | version in `<meta name="app-version">` and the footer text: v39.16 (no other change; no visible wording changes) |
| `CLAUDE.md` | header "Current Model Parameters (v39.16)"; a short bullet for v39.16; in the v39.15 bullet the words "under one 2 s timer" get the note "(5 s since v39.16)" |
| `src/assets/tech-appendix.md` | section 6.10.2: the limit; version history line |
| `src/assets/CHANGELOG.md`, `README.md` | entry for v39.16 |
| `TODO.md` | row A3s: built, with the result of the live check |

Version: v39.16, MINOR (server only, logging only, the estimate is unchanged).

## 4. Time budget

Measured since the release (45 runs): the job's own work ends 2.5 to 4.5 s after the run starts; the archive row was saved at most 6.4 s after the start, in a timeout run.

With the new limit, worst ordinary case: the requests start about 2 to 4 s after the run starts and are cut at 5 s, so the step ends about 7 to 9 s after the start, plus the write (usually well under 1 s, capped at 4 s). That is about 13 s at the very worst in an ordinary run, against the job's own deadline of 25 s for this step.

In a late run nothing changes: every new call still ends by tick start plus 25 s or is not made.

Not checkable from here: Netlify's hard limit of 30 s. The old code could already reach about 29 s when the ping ended at 24 s and log writes hung; this change does not move that case, because the limit is cut to the time left before 25 s.

## 5. Tests that must catch a regression

- The timer ends the wait at the new limit when a request never answers (existing case, new value).
- A request that answers after 3 s is a success with its points (new case; it fails on the old value).
- A gauge that answers fast keeps its result when the other one times out (existing case).
- A late run shortens the limit to the time left; with none left the result is `late_skip` (existing cases, unchanged).
- A far deadline does not lengthen the limit beyond the constant (existing case, new value).
- With `NWS_ARCHIVE=off` no request is made (existing case).
- The version places agree (`test/howitworks-text.test.mjs`).
- The whole suite: before the change 1,711 tests, 1,709 pass, 0 fail, 2 skipped. After: the same plus the new case, 0 fail.

## 6. Verification after the push (stated before the change)

By a fresh verifier on the top model tier, read-only, not by the session that built it.

First run with the new code:
1. The site serves v39.16; the run's `tick_log` row and `nws_fc` row carry `ver` v39.16.
2. The `nws_fc` row exists, has the same fields as before, is saved after the tick row.
3. The job is healthy: the run is counted, `missedRuns` stays 659, no log failure.

After about a day of runs (date-gated, on the owner's word or at the next working session):
4. The share of requests stored as `timeout`, against 18% before.
5. How many successful requests took between 2,000 and 5,000 ms (these are the ones the old limit lost).
6. The gap between a run's start and the time its `nws_fc` row was saved: maximum, against 6.4 s before.
7. Whether any forecast issue was missed at a gauge.

Cannot be verified by anyone here: Netlify's 30 s limit in a worst-case run; where the slowness comes from.

## 7. Side effects

- A run in which a request hangs now waits up to 3 s longer before it ends. The success ping has gone out long before, so nothing downstream sees it.
- The Weather Service gets no more requests than before: still two an hour.
- If the slow requests take longer than 5 s, the timeout share will not fall, and each such run costs 3 s more. That is the signal to plan the second try, not to raise the number again.

## 8. Roles

Orchestrator: plan, rulings, records. Builder: Sonnet. Plan auditor, code auditor, live verifier: Opus. The push is made outside the two minutes around the top of an hour.

## 9. Questions put to the plan auditor

1. Is one number enough, or does something else in the step assume 2 s (a pool, a budget, a test helper, a comment that would become false)?
2. Is the time budget of section 4 right? Read the handler from the success ping to the end. Is there any path on which the longer wait can delay the tick row, the success ping, the learning, or the next run?
3. Does anything else read `NWS_CALL_CAP_MS` or depend on the stored `ms` of a timeout being 2000?
4. Is 5 s the right number given what is known, or is there a reason for 4 s or for more?
5. Is the rejection of a second try sound for now?
6. Which test is missing?
7. Is the list of documents complete (every place that states the 2 s limit of this step, and only this step: the Difficult Run request has its own 2 s limit, which does not change)?

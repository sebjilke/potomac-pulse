# Plan: move Potomac Pulse off the old USGS data service (draft for owner approval)

Written by the orchestrator on 2026-11-17. Nothing in this plan has been built. Line numbers are
from commit 13f5924.

## 1. Why

- The app and the hourly job read river data from `waterservices.usgs.gov/nwis/iv/` (the old service).
- USGS bulletin of 2026-09-17: "Service degradation begins November 2026, with planned outages in
  January 2027"; the old service is switched off on 2027-02-22.
- Since 2026-11-16 18:00 UTC the old service is slow. Measured 2026-11-17 15:00 to 15:50 UTC from one
  computer: 4.4 to 12 s to the first byte, 6.6 to 30 s in total, two requests of four not answered.
- Effects, all measured:
  - Hourly job: run time 2 to 4 s before, 10 to 20 s since. It allows USGS 10 s. In 13 of 21 hours at
    least one attempt failed; 3 hours had no successful run (missedRuns 656 to 659). Each failure sends
    a "failed" signal to the monitoring service, hence the alert emails.
  - App: the main request waits up to 8 s before the saved copy is used, so the page loads slowly.
  - Creeks tab: the creek request needs about 4.4 s to the first byte and 6.6 s in total; the app
    allows 4 s (service worker) and 5 s (`fetchCreekData`), so it gets no data.
  - Netlify starts a second attempt about 11 to 15 s after a slow first one. In 4 hours two runs both
    completed in the same minute.

## 2. What was learned about the replacement (probes of 2026-11-17, no key)

Base: `https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items`.

| Fact | Evidence |
|---|---|
| The job's request (7 gauges, flow and stage, 2 days) answers in about 2 s | 5,456 readings, 2.3 MB as JSON, no paging needed |
| The app's request (19 gauges, 7 days) answers in under 3 s | 36,126 readings; 101 kB on the wire as CSV, 984 kB as JSON (11.8 MB unpacked) |
| One row per reading, not one block per gauge | fields `monitoring_location_id` ("USGS-01646500"), `parameter_code`, `time`, `value` (a string), `approval_status`, `qualifier`, `last_modified` |
| Browsers may call it directly | `access-control-allow-origin: *` |
| The response time of the body is `timeStamp` (was `requestDT`) | USGS migration page |
| Calls without a key are limited | USGS: "If you're going to make more than a few queries per hour, you'll need to provide an API key"; the exact numbers are in `X-RateLimit-*` headers, which the keyless answers did not carry |
| A key is free; it is sent to an email address and passed in the `X-Api-Key` header | USGS key page |

Not known yet: the request limits with and without a key; how ice and missing values are marked
(the old service used the qualifier "Ice" and the value -999999, and the code tests for both).

### How often USGS publishes (from `last_modified`, 2 days, 7 gauges)

| Gauge | Reading every | New batch every | Batch arrives at minute | Typical age when published |
|---|---|---|---|---|
| Little Falls | 5 min | 60 min | :57 to :58 | 7 to 64 min |
| Seneca | 5 min | 60 min | :55 to :56 | 5 to 68 min |
| Broad Run | 5 min | 60 min | :48 to :49 | 8 to 68 min |
| Monocacy | 15 min | 60 min | :46 to :48 | 6 to 71 min |
| Goose Creek | 15 min | 60 min | :00 to :01 | 15 to 66 min |
| Edwards Ferry | 15 min | 60 min | :01 | 6 to 121 min |
| Point of Rocks | 5 min | 60 min | :02 to :03 | 4 to 69 min |

The hourly job starts at about :00:53. It therefore reads Little Falls, Seneca, Broad Run and Monocacy
a few minutes after they arrive, and Point of Rocks, Edwards Ferry and usually Goose Creek one batch
late (about an hour older than necessary). One logged run confirms it: at 14:01 UTC Little Falls was
11 min old and Point of Rocks 66 min old. Two days is a short sample and the batch minutes may drift.

## 3. Decision the owner has to make: how the app gets its data

| | A. App calls USGS directly, no key | B. App calls USGS directly with a key in the page | C. App asks our own server, which asks USGS (recommended) |
|---|---|---|---|
| Key | none | visible to anyone who opens the page source | secret, in Netlify settings |
| Request limit | per visitor; "a few queries per hour" may not cover a 15 min refresh | shared by all visitors; anyone can copy the key and use it up | one shared request serves all visitors (answers cached for a few minutes) |
| If our server fails | not affected | not affected | falls back to A |
| New moving part | no | no | one small server function |
| Work | smallest | small | largest |

Recommendation: C with A as its fallback. USGS publishes each gauge once an hour, so a shared copy
that is a few minutes old loses nothing, and the app goes from four USGS requests per refresh to one
request to our own site. The hourly job uses the key in all three options.

## 4. Design

One pure module, the adapter, turns rows from the new service into the exact structure the old
service returned (`value.timeSeries[...]` with `sourceInfo.siteCode`, `variable.variableCode`,
`values[0].value[]` of `{value, dateTime, qualifiers}`, and a `requestDT` note taken from `timeStamp`).
Every existing parser on the server and in the app stays as it is and reads the adapter's output.
The estimate, the learning and the model files are not edited.

Why this shape: the parsers feed the estimate and the ice checks. Leaving them untouched limits the
risk to one new function whose output can be compared field by field with the old service while the
old service still exists.

## 5. Steps

Each step ships alone and follows the project's protocol: independent plan audit, build, independent
re-audit, push away from the top of the hour, live check by a fresh verifier.

**Step 0. Checks before any code (read-only).**
- Double runs: for the 4 hours with two completed runs (2026-11-16 20:00; 2026-11-17 01:00, 06:00,
  09:00 UTC), read `validation_log` and the bin counts and establish whether any validation was
  learned twice. Report the result before anything else; a repair, if needed, is its own change.
- Ice and missing values: find how the new service marks them (documentation, and gauges that are
  iced or out of service now). The adapter must reproduce "Ice" and -999999 exactly as the parsers
  expect them.
- Request limits: read the `X-RateLimit-*` headers once the key exists.
- Owner action: request a USGS key (form at `api.waterdata.usgs.gov/signup`, the key arrives by
  email) and store it in Netlify as `USGS_API_KEY`. The assistant does not submit the owner's email
  address anywhere.

**Step 1. Hourly job (server). Stops the alerts and the missed runs.**
- New `netlify/functions/shared/usgs-adapter.js`: builds the request address, parses rows, returns the
  old structure. Used by `fetchUSGSData` (line 220), `fetchWaterTemp` (185) and `fetchDifficultRun` (2553).
- New service first; if it fails or times out, one attempt on the old service (until 2027-02-22).
  Time limits chosen so the whole run stays well under the point where Netlify starts a second attempt.
- `tick_log` gains the source used and, per gauge, the publish time of the newest reading
  (logging only; this is the tracking of USGS's update rhythm).
- Tests: adapter unit tests on saved real responses; a parity test that feeds the same two-day window
  from both services through the parser and requires identical values, times and ice flags; failure
  and fallback paths; the existing 1,425 tests unchanged.
- Verification after deploy: the next three hourly runs in `tick_log` show source "new", run time back
  under 5 s, no failed attempt, the estimate in line with the previous hours; the monitoring service
  stays up. A fresh verifier reads them.

**Step 2. App (client). Fixes the slow load and the Creeks tab.**
- Option C: new function `usgs-proxy` behind `/api/usgs` returning the old structure for a fixed set
  of named requests (main, creeks, Edwards Ferry, temperature; no free-form address), cached a few
  minutes at the edge. The app asks `/api/usgs` first, then USGS directly (option A), then the saved copy.
- Changes: `src/data/fetch.js` (main and creek requests, the two public relay sites removed),
  `src/estimation/edwards-ferry.js`, `config/runtime-caching.mjs`, the security policy line in
  `netlify.toml` (add `api.waterdata.usgs.gov`, later remove `waterservices.usgs.gov` and the relays),
  a browser copy of the adapter with a parity test against the server copy.
- Verification: file-level check of the live site by a fresh verifier; the owner's phone check of load
  time and the Creeks tab (no browser tool is available to the assistant).

**Step 3. Run the job when the data has arrived (optional, owner decides after two weeks of Step 1 logs).**
- Move the job from minute :00 to about :06 so Point of Rocks, Edwards Ferry and Goose Creek are one
  batch fresher. This changes which readings the estimate and the validation see, so it is a model
  input change and gets its own plan, with the logged publish times as evidence.

**Step 4. Clean-up (after 2027-02-22 or once the new path has run clean for 30 days).**
- Remove the old-service fallback, the old host from the security policy, and the stale wording in the docs.

## 6. Non-goals

- No change to the estimate's formulas, the learning, the bins, the 48 h forecast or the weather-service requests.
- No change to the 15 minute refresh of the app or the hourly schedule (Step 3 is separate).
- No new warnings on screen.

## 7. Risks

1. Values differ between the two services (rounding, revised readings, a different newest reading).
   The parity test is the guard; any difference is reported, not averaged away.
2. Ice or equipment flags are marked differently and the ice checks stop firing. Winter is close.
   Step 0 settles this before Step 1 is built.
3. Request limits are tighter than expected. Step 1 makes 3 requests an hour; Step 2 with option C
   at most one per cached window.
4. The new service has its own outages. The old service is the fallback until it is switched off;
   after that the saved copy and the UNAVAILABLE state already exist.
5. Option C makes the app depend on a Netlify function. Fallback to a direct call covers it.
6. The response is large as JSON (11.8 MB unpacked for the app's request). The server asks for CSV or
   trims fields; the app never receives the raw response under option C.
7. The key leaks into logs. It is sent as a header, never in an address, and never printed.

## 8. Versions and documents

Step 1: server version v39.11 (the page version follows the project rule that all version places
agree). Step 2: v39.12. Both MINOR: the same inputs give the same estimate. Tech appendix (data
sources, 6.10 logging fields), CHANGELOG, README, CLAUDE.md, TODO updated in each step.

## 9. Open questions for the owner

1. Option A, B or C for the app (recommended: C).
2. Will you request the USGS key and add it to Netlify (needed for Step 1)?
3. Step 1 and Step 2 in this order (alerts first), or the app first?

---

# Rulings on the plan audit (orchestrator, 2026-11-17)

The audit is `usgs-service-move-plan-2026-11-17.PLAN_AUDIT.md`. A ruling wins over the audit; the audit
wins over the plan. Three audit claims were spot-checked by the orchestrator and hold: the old service
sends qualifiers as plain strings (`['P']`), `scheduled-update.js:270` reads `q.qualifierCode`, and
seven test files pin the old address.

| Finding | Ruling |
|---|---|
| 1 Ice and missing values are marked differently (`value: null`, qualifier `ICE` / `EQUIP`) | ACCEPTED. The adapter gets an explicit mapping table: `null` value to `"-999999"`; `ICE` to `Ice`, `EQUIP` to `Eqp`, the other codes listed after reading USGS's code list; `P` added when `approval_status` is Provisional. Tested on a saved response from gauges that are iced now (the auditor used Alaska sites 15515500 and 15356000). An unknown code fails the test, it is not passed through silently. |
| 2 Server reads qualifiers as objects, the old service sends strings, so the server's "Ice" qualifier test has never fired | ACCEPTED. The adapter emits strings, as the old service does. The server test at line 270 is NOT changed in this work; it is reported to the owner as a separate, pre-existing defect (today only the -999999 value catches ice on the server). |
| 3 Missing call sites | ACCEPTED. Added to scope: `netlify/functions/build-ef-correlation-advanced.js:307-308` (decide in Step 1: move or mark as a manual tool that stops working on 2027-02-22), the service worker rules in `config/runtime-caching.mjs:39-58`, the relays in the security policy line. The sentence "the existing 1,425 tests unchanged" is withdrawn: the builder lists every test that pins the old address (`truth-dr-handler`, `data-freshness`, `clean-screen-behaviour`, `startup-refresh-behaviour`, `forecast-accuracy-row`, `sw-runtime-caching`, and any other found by grep) and states for each whether it changes in Step 1 or Step 2. |
| 4 Grouping, ordering, several series per gauge, paging, gauges with no rows | ACCEPTED. Adapter spec: group by gauge and parameter; where several series exist, take the instantaneous one (`statistic_id` 00011) and fail the request if two remain; sort ascending by time; a `next` link is an error, not a truncation; a requested gauge with no rows yields no block, and the parsers' existing handling of a missing gauge applies (pinned by a test). |
| 5 Five-minute readings are not new; `values.length - 9`, `i += 4` and `len - 5` already assume 15 minutes | Noted, out of scope, one TODO line. |
| 6 A live parity test would be flaky and would block deploys | ACCEPTED. Parity runs on saved responses for one fixed past window fetched from both services (old: `startDT`/`endDT`; new: `time=a/b`), compares values on matching timestamps, and reports timestamps present on one side only. No network call in `npm test`. |
| 7 Time budget, HTTP 429, key, run lock | ACCEPTED in part. The key is required for Step 1. The in-run fallback to the old service is DROPPED (it cannot answer inside the budget today); instead one retry of the new service inside a fixed budget, and an environment switch `USGS_SOURCE=old` that the owner can set without a deploy while the old service exists. On 429: no retry, logged as such, and the run fails with the normal failure signal. Run lock: NOT in Step 1; it is proposed to the owner as its own change once Step 0 shows whether the overlapping runs did harm. |
| 8 Option C and the freshness logic | ACCEPTED. If the owner picks C: edge copy kept at most 2 minutes (well under the app's 10 minute "saved copy" rule), `requestDT` taken from the upstream `timeStamp`, `Netlify-CDN-Cache-Control` and `Netlify-Vary` on named parameters, unknown parameters rejected, a NetworkFirst service worker rule for `/api/usgs`, compact body. The claim "one request serves all visitors" is corrected to "one request per edge location per 2 minutes". Step 2 gets its own detailed plan and audit before it is built. |
| 9 `last_modified` is the new database's intake time | Noted. Step 3 waits for two weeks of logged publish times, as planned. |
| 10 Verification gaps | ACCEPTED. Live check of Step 1: for three runs the verifier compares each gauge's logged reading value and time with what the service returns for that timestamp, and requires run time under 5 s and no failed attempt. `tick_log` records the source per run, which also dates the Point of Rocks history rows by source. Stated as unverified gaps: the ice path on the Potomac (no ice now), the 429 path, and everything on a real screen in Step 2 (owner's phone check). |
| 11 Version and sync list | ACCEPTED. Step 1 bumps `SERVER_VERSION`; the two adapter copies are added to the sync list in CLAUDE.md with a parity test; the 2 s Difficult Run cap is kept and its miss rate reported. |

Step 0 now reads: (a) double-run check, (b) mapping table and the iced-gauge fixture, (c) request
limits once the key exists, (d) the owner's key. Step 1 is not built before the owner approves this
plan and the key exists.

---

# Step 0 results (orchestrator, 2026-11-17, about 16:00 UTC)

Owner: green light for the plan, the server route for the app (option C), and the key supplied.
The key is kept outside the repository and is never written to a file that is committed.

| Check | Result |
|---|---|
| Request limit with the key | `x-ratelimit-limit: 1000` (the job needs 3 requests an hour). Keyless answers carry no limit headers. |
| Same past day from both services (2026-11-15 00:00 to 2026-11-16 00:00 UTC; 8 gauges; flow, stage, temperature; 18 series) | Identical: same number of readings, same timestamps, same value strings in every series (3,666 readings, 0 differences). One series per gauge and parameter on the new service, all `statistic_id` 00011. Old qualifiers `["P"]`, new `qualifier: null` with `approval_status: "Provisional"`. |
| Ice and equipment marking (Alaska gauges 15515500 and 15356000, iced or out of service now) | Old: value `"-999999"`, qualifiers `["P","Ice"]` / `["P","Eqp"]`, `noDataValue -999999`. New: `value: null`, `qualifier: ["ICE"]` / `["EQUIP"]` (an array, or null on normal rows). |
| Environment switch | To be confirmed in Step 1: on Netlify a changed environment variable may need "Trigger deploy" before functions see it. If so, the ruling's "without a deploy" becomes "with one click, no code change". |
| Double runs learned twice? | NOT CHECKED: the database connection of this session dropped and has not come back. Open. |

Saved responses for the tests (scratch, to be copied into `test/fixtures/usgs/` by the builder):
`par_new.json`, `par_old.json` (the day above), `ice_new.json`, `ice_old.json`.

Additional rule for Step 1: when `USGS_API_KEY` is not set, the job uses the old service exactly as
today and logs that. The code can therefore be deployed safely in either order with the key.

---

# Step 1: build, re-audit and rulings (orchestrator, 2026-11-17)

Build by a Sonnet builder; re-audit by a fresh Opus auditor (`usgs-service-move-plan-2026-11-17.REAUDIT.md`,
verdict SHIP AFTER FIXES). Live smoke by the orchestrator with the owner's key at 16:06 UTC, read-only,
through `buildContinuousUrl` and `toLegacyIv`: main request 906 ms (5,535 rows, 13 series, all ascending,
no unknown codes), temperature 147 ms, Difficult Run 122 ms.

| Re-audit finding | Ruling |
|---|---|
| 1 BLOCKER: `time_series_id` was not requested, so the duplicate-series guard could never fire | ACCEPTED. The defect came from the orchestrator's brief, which listed the properties without it. Fix: request `time_series_id`; second guard on colliding timestamps in a group; a test on a real-shaped restricted answer. Not caught by either guard: two series without ids whose timestamps never collide; with the id requested this needs USGS to stop sending the id. |
| 2 A malformed key could be printed in an error message | ACCEPTED: a key outside printable ASCII is treated as no key; fixed log text; redaction on the new-service path. |
| 3 TODO omitted the open items | ACCEPTED: rows added. |
| 4 Rows present but none with `statistic_id` 00011 | ACCEPTED: throws. |
| 5 Odd shapes dropped without trace | ACCEPTED: string qualifier accepted; other approval statuses reported in `aux.unkQ`. |
| 6 Unknown qualifier codes are passed through and logged, not rejected | AMENDMENT to ruling 1 of the plan audit: at run time an unknown code is passed through and logged (`aux.unkQ`), because failing the hourly run over an unknown label would cost more than it protects; ice is carried by the value (`null` to `-999999`), which the server's ice test uses. |
| 7 `validation_log` and `bin_snapshot` also become `v: 3` | ACCEPTED: one sentence in the appendix. |

Owner: `USGS_API_KEY` is set in Netlify (checked read-only at 16:09 UTC: name exact, value equal to the key, all contexts).

**First Netlify build of v39.11 failed (cd7b0c3, 16:13 UTC); the site stayed on v39.10.** Cause: Netlify's
build environment carries the real `USGS_API_KEY`, so 36 older tests that stub the old response shape took
the new path. Reproduced locally with a dummy key set (36 failures, the same tests). Fix: the `npm test`
script clears `USGS_API_KEY` and `USGS_SOURCE`; tests that need a key set it themselves; one test pins the
script. With a dummy key in the environment and without: 1,477 tests, 1,475 pass, 2 opt-in skips.
Lesson: a test run must not depend on the machine's environment (same family as the ignored-file lesson of v39.9).

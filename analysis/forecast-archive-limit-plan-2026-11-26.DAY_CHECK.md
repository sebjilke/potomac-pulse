PASS WITH NOTES

# Forecast archive request limit (v39.16, TODO A3s): check after a day of runs

Fresh verifier, read-only, 2026-11-27 22:36 UTC. Scope: every run since the push of 56f0a4c (2026-11-26 22:33:34 UTC), that is 24 hourly runs, 2026-11-26 23:01 to 2026-11-27 22:01 UTC. Sources: `potomac_observations` (SELECT only) and the public endpoint `/api/sync?endpoint=gf`. Nothing was written except this file. No request was sent to any monitoring ping address.

Why "with notes": every check in plan sections 6 and 11 that the data can answer passes. Two things are noted: (a) no timeout happened at all, so the rule for a timeout's stored `ms` and the late-run branch are still untested live; (b) the tick row's own `ms` is higher than in the days before (median 3,504 against 3,058, two runs above 5 s), but the extra time lies entirely before the archive step begins, in code the change does not touch.

## Check 1. One `nws_fc` row per run, `ver` v39.16 on both rows

Query: full join of `tick_log` and `nws_fc` on `gauge_id` for keys from 2026-11-26 22:00 on; counts and distinct counts since 22:30.

- `tick_log` rows since the push: 24, distinct keys 24. `nws_fc` rows: 24, distinct keys 24. Every `tick_log` key has an `nws_fc` key and the reverse. No duplicate.
- Every hour from 23 UTC on 26 Nov to 22 UTC on 27 Nov has exactly one run. No run is missing.
- `ver` is `v39.16` on both rows of all 24 runs. The run before (22:01 on 26 Nov) carries v39.15 on both rows.
- `data.at` equals `gauge_id` in all 24 `nws_fc` rows.
- The `nws_fc` row was saved after the tick row in 24 of 24 runs (`created_at`).
- Fields: the top-level keys (`at, ft, g, in, ms, v, ver`) and the gauge keys (`gen, http, iss, ms, n, pedts, pts, pu, sig, site, u, why`) are the same as on the successful v39.15 rows.

## Check 2. Outcome of every request (plan 6.4, 6.5)

Query: `jsonb_each(data->'g')` over all `nws_fc` rows, grouped by `ver`, `why`, `http`.

| version | outcome | http | requests | longest stored ms | successes above 2,000 ms |
|---|---|---|---|---|---|
| v39.15 (46 runs) | success | 200 | 76 | 1,975 | 0 |
| v39.15 | timeout | null | 16 | 2,000 | n/a |
| v39.16 (24 runs) | success | 200 | 48 | 3,629 | 8 |
| v39.16 | timeout | any | 0 | n/a | n/a |

- Timeouts: 0 of 48 since the push, against 16 of 90 (18%) before and 11 of 48 in the last day before. No timeout with `http` 200 either (no answer that started and then stalled). No other `why` value appears.
- Successes that the old 2 s limit would have lost: 8 of 48 (17%): 23:01 PORM2 2,570; 06:01 BRKM2 3,112; 08:01 PORM2 3,629; 10:01 PORM2 3,066; 11:01 PORM2 2,079; 15:01 BRKM2 2,480 and PORM2 2,300; 22:01 PORM2 2,075.
- Pile-up near 5,000: none. Longest 3,629 ms, nothing above 4,000 ms. No stored value exceeds the limit that applied (5,000 in every run, see check 3).
- Every request returned 12 forecast points at both gauges.

## Check 3. Late runs and the limit that applied (plan 11)

Query: `left = start + 25,000 - ft`, with start from `gauge_id` and `ft` from the row.

- Smallest `left` when the archive step began: 17,945 ms (17:01 run, archive began 7.06 s after start). Largest start offset 7,055 ms. No run had less than 7 s left, and no run began its requests 18 to 21 s after the start. So the limit was 5,000 ms in all 24 runs (`min(5000, max(left - 2000, ...))` with `left` at least 17,945), and all 24 rows were written.
- The late branch of the formula was not exercised live.

## Check 4. Start-to-save gap (plan 6.6)

Query: `nws_fc.created_at - gauge_id`.

- Maximum 8,206 ms (06:01 run: archive began at 5.05 s, longest request 3.11 s), against 6.4 s before. Expected with a longer wait and far inside the 25 s deadline. The 17:01 run: 7,517 ms; 08:01: 7,102 ms.
- Hour 03 UTC (the prune hour): 4,044 ms.

## Check 5. Missed forecast issues (plan 6.8)

Query: distinct `iss` per gauge with first and last run that stored it.

Since the push four new issues appeared (issue times 01:24, 07:00, 15:11 and 19:23 UTC on 27 Nov; the 15:00 UTC issue of 26 Nov was still current at the push). Each was stored at both gauges, first by the same run at both gauges: 02:01, 08:01, 16:01 and 20:01. In three cases that is the first run after the issue time. The 07:00 issue reached the 08:01 run because the 07:01 request was made 64 s after the issue time and still got the previous issue (publication lag, not a lost request: both 07:01 requests succeeded). Each issue has one fingerprint (`sig`) per gauge. No issue was missed at either gauge.

## Check 6. Did anything else move

- `tick_log.err`: null on all 24 rows. `out`: `predicted` on all 24.
- `log_health`: no row exists at all (as before the push). `binWriteFailures` 0.
- Endpoint: `missedRuns` 659 (unchanged), `consecutiveRuns` 251, `lastPrediction` 2026-11-27T22:01:05.451Z (the last run).
- Tick row `ms` (taken before the archive wait):

| version | runs | min | median | max | above 5,000 |
|---|---|---|---|---|---|
| v39.11 (since 20 Nov) | 121 | 2,371 | 2,955 | 5,096 | 1 |
| v39.15 | 46 | 2,462 | 3,058 | 4,524 | 0 |
| v39.16 | 24 | 2,929 | 3,504 | 7,350 | 2 (06:01 5,325; 17:01 7,350) |

  Split at the moment the archive step begins (`ft`): time from start to `ft`, median 2,925 (v39.15) against 3,375 (v39.16), max 4,376 against 7,055; time from `ft` to the tick row's `ms`, median 113.5 against 108, max 672 against 613. So the whole rise lies before the archive request starts, that is in the readings, estimate and ping part of the run, which the code audit found identical between the two versions. In both slow runs the Difficult Run request was fast (209 and 240 ms) and the USGS main request had one attempt. The cause is not visible in the rows (likely upstream or platform latency); it is not attributable to this change.

## Run table (v39.16)

| run (UTC) | tick ms | archive began (s) | BRKM2 ms | PORM2 ms | saved after start (ms) |
|---|---|---|---|---|---|
| 26 Nov 23:01 | 4,450 | 4.35 | 835 | 2,570 | 6,938 |
| 27 Nov 00:01 | 3,142 | 3.04 | 1,373 | 1,854 | 4,937 |
| 01:01 | 3,753 | 3.65 | 681 | 1,152 | 4,862 |
| 02:01 | 3,127 | 3.02 | 284 | 1,845 | 4,931 |
| 03:01 | 3,349 | 2.96 | 985 | 1,033 | 4,044 |
| 04:01 | 3,391 | 2.78 | 307 | 265 | 3,503 |
| 05:01 | 3,591 | 3.42 | 1,894 | 463 | 5,357 |
| 06:01 | 5,325 | 5.05 | 3,112 | 106 | 8,206 |
| 07:01 | 3,179 | 3.08 | 1,599 | 353 | 4,688 |
| 08:01 | 3,564 | 3.46 | 182 | 3,629 | 7,102 |
| 09:01 | 3,358 | 3.25 | 294 | 1,824 | 5,097 |
| 10:01 | 3,353 | 3.24 | 166 | 3,066 | 6,355 |
| 11:01 | 4,328 | 4.22 | 1,543 | 2,079 | 6,325 |
| 12:01 | 3,413 | 3.31 | 206 | 348 | 3,674 |
| 13:01 | 3,386 | 3.21 | 575 | 551 | 3,827 |
| 14:01 | 4,097 | 3.99 | 863 | 1,128 | 5,139 |
| 15:01 | 3,246 | 3.13 | 2,480 | 2,300 | 5,660 |
| 16:01 | 4,641 | 4.54 | 160 | 1,643 | 6,269 |
| 17:01 | 7,350 | 7.06 | 378 | 219 | 7,517 |
| 18:01 | 4,374 | 4.27 | 196 | 145 | 4,507 |
| 19:01 | 3,444 | 3.34 | 744 | 339 | 4,091 |
| 20:01 | 4,237 | 4.14 | 1,331 | 821 | 5,488 |
| 21:01 | 2,929 | 2.71 | 465 | 401 | 3,222 |
| 22:01 | 3,986 | 3.86 | 287 | 2,075 | 5,986 |

All requests: `why` null, `http` 200, 12 points.

## Unverified gaps

1. The rule for a timeout's stored `ms` (equal to the limit that applied, from the row's own `at` and `ft`): no timeout happened, so it cannot be checked live.
2. The late-run branch (less than 7 s left) and the known cost of a hung write in a late run with 4 to 7 s left: never exercised.
3. Whether 0 of 48 reflects the new limit or a calmer Weather Service day: 8 successes took 2 to 3.6 s and would have been timeouts before, which accounts for most of the drop (the day before: 11 of 48); the other effect cannot be separated from one day of data.
4. The cause of the higher tick `ms` before the archive step (two runs above 5 s): not visible in the rows. Netlify's function logs and real function duration are not readable from here.
5. The success ping reaching the monitoring service, and any late-ping email: not checkable (no request to the ping service was made; only the owner sees the email).
6. An issue that lived less than an hour between two runs would leave no trace; "no issue missed" means none seen.
7. Netlify's 30 s hard limit in a worst-case run: not testable here.

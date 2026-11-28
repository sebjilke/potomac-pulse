# Results audit: the measured clock, replay description (third auditor)

2026-11-27. Scope: the eleven output files in `py/` and `r/`, built from `ANALYSIS_SPEC.md` v1.2 and `ANALYSIS_SPEC_CLARIFICATIONS.md` (C1, C2). Authority: `PLAN.md` sections 2, 3, 9, 11 to 13; section 7 read only for the expectations table. My own code was written from the specification and the raw inputs before I read either analyst's script, and I never needed to read them, because nothing differed. Scratch code: `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/clock_results_audit/` (`audit.py`, `compare.py`, `extra.py`, `usgs.py`, raw USGS answers in `usgs_raw/`).

## Verdict: PASS WITH NOTES

Every number I recomputed is the same as the files, digit for digit. The inputs are the ones the specification names. Ten Little Falls hourly values match the public USGS service exactly. No row goes missing or appears from nowhere. I found no blocker.

The notes are about what the numbers mean. The owner's headline difference (badly-low share on rising water) is under 1 point on the central and long truths. Its resampling interval includes zero. Its size is about what the choice of truth or the staircase moves on its own, and on OLD's own clock it is exactly zero. Several expectations written before the run did not hold. One of them, "over all hours the app beats both yardsticks", came out the other way round.

## Findings

1. **MAJOR (meaning). The owner's headline difference cannot be told apart from zero, except on the short-end truth.** Test years, Little Falls rising: badly-low share OLD 21.45% against NEW 20.60% on the central truth (NEW minus OLD -0.84 points); 22.48% against 21.67% on the long end (-0.82); 19.01% against 17.33% on the short end (-1.68). I added month-block intervals with the same 10,000 draws (my addition; the specification computes none for this table): central [-1.98, +0.24], long [-2.20, +0.47], short [-3.04, -0.44]. Design years: +0.09 [-1.01, +1.26], +0.41 [-0.74, +1.67], 0.00 [-0.94, +0.99]. The sign depends on the truth. On a truth at OLD's clock (exact time), test, the difference is 0.00 (1,051 against 1,051 hours). On OLD's own staircase truth it is +0.09. On NEW's own staircase truth it is -0.73. Moving the central truth by +0.28 h (the staircase's mean offset) changes it to -0.57; moving it by -0.5 h changes it to -1.21. On the same hours, the three common truths change the level of the share itself by 3 to 5 points. In plain terms: about one rising hour in five reads badly low under both clocks. The change moves that by less than one point on the central and long truths, and that move is inside the noise.
2. **MAJOR (meaning; an expectation came out the other way). Inside run NEW, both yardsticks are closer to the truth than the app over all hours, on all three truths, in both periods** (`new_readings.csv`: `all`, Y0 and Y1, `yardstick_closer`, holds 1). Test, central truth, all hours: app MAE 4.83, "Great Falls equals Little Falls now" (Y0) 3.50, the trend yardstick (Y1) 3.88. On rising hours (central truth), badly-low readings number 906 for the app, 608 for Y0 and 157 for Y1, of 4,397 hours. Limits that must be stated with it: the truth is Little Falls itself, and Y0 is a copy of an earlier Little Falls reading, so persistence has a built-in advantage over short horizons. Y1 is never below Y0 by construction. The app's number is a Great Falls estimate scored on Little Falls through a clock. This is not evidence that the app is broken. It must still be reported, not explained away.
3. **MAJOR (statement risk). "NEW switches the trust-it-less line on less often" is not supported.** The share of scored estimates 15% or more low falls (test 3.36% to 3.00%; design 2.53% to 2.32%). The count rises, because NEW scores 1.67 times as often: test 330 to 490, which is 0.13 to 0.20 per day. The table does not model the note's real rule (latch at -15%, clear above -7.5%, newest pair 12 h old at most), so neither number is how often the note is on. Both self-scoring numbers, the low share and the share inside the band (84.8% to 86.2%), are tilted toward NEW by construction: a shorter clock scores a shorter forecast horizon against a truth closer to the reading the model holds. The two runs also score different, unpaired hours.
4. **MINOR. "Each run looks best on its own truth by construction" (plan 3.4 item 3) holds only when the table is read by column, and then not everywhere.** Read by row it reverses: OLD scores better on NEW's (earlier) truth than on its own (test, all: MAE 5.10 against 5.48), because a shorter horizon is easier. By column (both runs on the same truth), MAE follows the expected pattern in most groups, with these exceptions. At low water NEW beats OLD even on OLD's own truth (test 7.198 against 7.213; design 5.456 against 5.537). On NEW's own truth OLD beats NEW in `rl_large` and its creek splits (test 14.690 against 14.814) and in `rl_rises_bump` (design). On the badly-low share there are more exceptions (for example design `lf_rising` on NEW's own truth: OLD 15.84%, NEW 16.16%). The report must say how to read the table and must not call every cell "by construction".
5. **MINOR. Known property 2 is worded too strongly.** The specification says "a lower value for NEW is therefore expected below 20,000 cfs and shows nothing". On the badly-low share it is a tilt, not a guarantee: in the design years NEW is higher on the central and long truths, and on NEW's own truth OLD has the lower share (finding 4). So a lower value for NEW is not purely built in. A higher value is also not automatically "informative". The honest wording: the table leans toward NEW, and the observed differences are smaller than what the lean, the staircase or the choice of truth can produce.
6. **MINOR. B10a to B10c pass only because "mean error" is read as MAE.** The reading is defended in the specification (section 11) and I accept it. But the signed bias at low water (test, central) is +1.31% for NEW against +0.79% for OLD. On the bias or its size, B10c would fail, and B10a would fail on the signed reading. NEW reads higher at low water (movement `low_water` test: mean +0.70%, median +0.39%). B10 is a machinery check and must not be quoted as "NEW is not worse".
7. **MINOR. The movement on rising hours is diluted by the cap.** Of the 673 Little Falls rising test hours with no move, 663 are capped in both runs. On the 3,693 rising test hours not capped in either run: mean +0.13%, median -0.17%, 5th percentile -8.05%, 95th +9.12% (my computation). So the expected "lower by a few percent" is not there. What is there is a broad two-way shuffle with almost no average shift. The "lower" direction of `movement.csv` is a count (2,047 down against 1,794 up), not a size.
8. **MINOR. Placement of hourly values in the 5-minute era.** The +22.5 min placement is exact for 15-minute readings (the median of :00, :15, :30, :45). In my USGS check, 2025-12-01 and 2026-10-11 have 5-minute readings (2025-03-10 still 15-minute). There the median sits at about +27.5 min, so the common truths are read about 5 minutes early in the last part of the test years. The offset is the same for both runs and for the tool, and is small against the staircase (0 to 0.82 h).
9. **MINOR. Scoring rate.** NEW scores 1.67 times as many estimates per day in the test years (6.53 against 3.92) and 1.55 times in the design years, not "about twice".
10. **MINOR. Creek split.** Five creek-fed and eight other rises in the test years (159 and 293 hours). Rise 34 sits at 0.1556, next to the 0.15 cut. `share_lower` includes Seneca and Broad Run, which the model gauges. In `units.csv`, `share_lower` is not bounded by 1 (E2: 1.52), although all 21 selected rises are between 0 and 0.63. Several design intervals of these groups are wide or `unclear` (for example `rl_large_notcreek`, short, cap: [0.000, 248.58]). These rows are anecdotes, not a split.
11. **MINOR. Hours left out on rising water.** Of 4,514 rising test hours, 117 are not valid for the central truth: 47 have no truth, 3 are out of range, 67 are hard-flagged. These are the same hours for both runs, so they do not bias the comparison. Hard flags fall on rising hours more often than on others. That is consistent with the app, which never scores them, but it means the table says nothing about those hours.

No finding against the analysts' judgment calls (section 3 below).

## 1. Agreement and inputs

- All eleven `.csv` files are byte-identical between `py/` and `r/` (`cmp`, eleven of eleven).
- `checks.csv`: 89 rows; no `F`; 76 `P` and 13 `I`. B10a 4.830464:5.112843, B10b 10.713975:10.996433, B10c 6.075688:6.473613, H01 to H04 pass, M05 0, B11 0.
- All twelve input checksums and byte sizes match table 1.1 (`shasum -a 256`, `stat`). `ANALYSIS_SPEC.md` hash `19c979f2...0bf9`, as the clarifications file states.

## 2. My own recomputation

My code (`audit.py`) uses its own time conversion (`calendar.timegm`), its own truth interpolation, groups, common truths, own-truth sets, bootstrap and band. I recomputed whole tables, not samples. Result: **every row equal to the file after `%.6f` formatting**.

| Table | Rows recomputed | Rows that differ |
|---|---|---|
| `badly_low_rising.csv` | 18 of 18 | 0 |
| `movement.csv` | 20 of 20 (all columns except `n_excluded`, `direction_by_count`, which follow) | 0 |
| `common_truth_errors.csv` | 120 of 120 | 0 |
| `two_by_two.csv` | 80 of 80 | 0 |
| `new_cap_yardsticks.csv` | 180 of 180, including `lo`, `hi`, `n_valid`, `n_skipped`, `label` | 0 |
| `self_report.csv` | 4 of 4 | 0 |
| `groups.csv` | 22 of 22 | 0 |
| `learning_health.csv` blocks 2 (`n_clamped`) and 3 | all | 0 |

Selected rows (mine = file in every column):

| Row | n | value(s) |
|---|---|---|
| badly_low test central OLD / NEW / diff | 4397 | 943 21.446441 / 906 20.604958 / -37 -0.841483 |
| badly_low test long OLD / NEW | 4412 | 992 22.484134 / 956 21.668178 |
| badly_low test short OLD / NEW | 4403 | 837 19.009766 / 763 17.329094 |
| badly_low design central OLD / NEW | 4395 | 684 15.563140 / 688 15.654152 |
| movement test all | 60120 | mean 0.409907, median 0.279423, p05 -4.237544, p95 5.440005, ge5 9.510978, up 35128, down 22614 |
| movement test lf_rising | 4514 | mean -0.011678, median 0, p05 -7.650724, p95 8.392286, ge5 20.713336, up 1794, down 2047 |
| movement design all | 60663 | mean 0.205873, median 0.180180, p05 -3.677293, p95 4.112098 |
| movement design lf_rising | 4428 | mean -0.550656, median 0, p05 -6.416604, p95 6.032603 |
| self test OLD / NEW | | 9840/9809 rows/learned, low15 330 (3.364257), inband 8322 (84.840453) / 16395/16346, 490 (2.997675), 14094 (86.222929) |
| self design OLD / NEW | | 12237/12231, 309 (2.526367), 10348 (84.604693) / 18941/18925, 439 (2.319683), 16142 (85.294584) |
| common test all central OLD / NEW | 59368 | MAE 5.112843 / 4.830464 |
| common test lf_rising long OLD / NEW | 4412 | MAE 11.017272 / 10.847267; low 22.484134 / 21.668178 |
| common test high_20plus short OLD / NEW | 4480 | MAE 3.704842 / 3.284411 |
| common design all central OLD / NEW | 59970 | MAE 4.194531 / 3.984119 |
| common test rl_large_creekfed central OLD / NEW | 159 | MAE 16.560120 / 16.736302 |
| common test low_water central OLD / NEW | 15583 | MAE 6.473613 / 6.075688; bias 0.791523 / 1.314252 |
| two_by_two test lf_rising OLD own / OLD other / NEW own / NEW other | 4384 | MAE 11.648985 / 11.008249 / 10.761119 / 11.802608 |
| two_by_two test all (same order) | 59208 | 5.481824 / 5.095660 / 4.838003 / 5.525975 |
| two_by_two design lf_rising (same order) | 4395 | 10.274679 / 9.036598 / 8.998180 / 10.459092 |
| ncy test all central Y0 | 59368 | mean_d -1.334751 [-1.595418, -1.088764] yardstick_closer |
| ncy test lf_rising central cap | 4397 | 2.796362 [1.425326, 4.456443] cap_closer; n_low 906 app, 840 no cap |
| ncy test lf_rising long Y1 | 4412 | 1.897610 [0.058065, 3.981067] app_closer |
| ncy test high_20plus central Y0 | 4480 | 1.155568 [0.803618, 1.477154] app_closer |
| ncy design lf_rising short Y1 | 4395 | -0.670928 [-1.088404, -0.245220] yardstick_closer |
| ncy design rl_large_notcreek long cap | 108 | 41.576331 [0.000000, 96.887589] n_valid 9949, unclear |

Health checks (inputs mine = file):

| Check | Inputs | Test | Result |
|---|---|---|---|
| H01 | pending at end 0 and 0 | 0:0 | pass |
| H02 missed window | 76 / 23,764 against 133 / 38,046 | 2*133*23764 = 6,321,224 <= 3*76*38046 = 8,674,488 | pass (rates 0.320% against 0.350%) |
| H02 retries | 222 against 396 | 18,821,088 <= 25,338,636 | pass (0.934% against 1.041%) |
| H02 hard-skipped | 37 against 65 | 3,089,320 <= 4,223,106 | pass (0.156% against 0.171%) |
| H03 | test p99 of jump: OLD 9.676820, NEW 11.116113 | 22,232,226 <= 29,030,460 (mic) | pass (ratio 1.15) |
| H04 | test jumps >= 5: OLD 2,043, NEW 2,195 | 4,390 <= 6,129 | pass (ratio 1.07) |
| B10a | test all central MAE NEW 4.830464, OLD 5.112843 | NEW <= OLD | pass |
| B10b | lf_rising: 10.713975, 10.996433 | | pass |
| B10c | low_water: 6.075688, 6.473613 | | pass |

## 3. A shared misreading?

I read the specification against the plan clause by clause. No rule is read wrong by both analysts in a way that changes a number: my independent reading gives the same bytes. Where the specification itself takes a position the plan leaves open, it says so openly:

- "Mean error" read as MAE (B10): defensible, but see finding 6.
- `share_lower` as the creek share: the plan does not say which share; the choice is stated and its limit given (finding 10).
- Low water keeps the rising hours (643 test hours in both groups); this follows the plan's text and number.
- Y1 uses the NEW clock on all three truths: the orchestrator's ruling, so that "same on all three" protects.
- Self-scoring on learned rows only (hard-skipped rows out; the app's note does count them): a small gap of 49 test rows in NEW and 31 in OLD.
- Plan 3.4 item 5 calls the -15% share "the line at which the trust-it-less note switches on". The specification computes exactly that share. It is not the note's duty cycle (finding 3). The departure is in how the result might be read, not in the computation.
- The placement at +22.5 min is shared by the tool and both analysts and is slightly off in the 5-minute era (finding 8).

The analysts' own judgment calls (`py/REPORT.md`): M01, M02 and M04 on the base set, M03, M06, I02 and I03 on all estimate hours, G24 on the base set, B03 on hours where either file has an estimate, Y1's `Row(3)` from NEW without an estimate requirement, `Row(6)` with only a non-blank `lfCap`, S16 not checking the 12-digit cell form, and the bootstrap skipping zero terms. All are information-only or bit-neutral. My code made the same choices for Y1 and `Row(6)` independently and matched every row. Skipping zero terms adds 0.0 and cannot change a sum. I judge each acceptable.

Clarifications. C1 fixes row order only (the file follows it: block 2 period outer). C2 concerns an information row: I get M04 = 13 on the base set and 14 on all estimate hours, as C2 describes. The file has 13. No table number depends on either clarification, and my recomputation, made without them, reproduces every table.

## 4. Data integrity

Row accounting reconciles end to end. Shadow rows 130,987, minus 1,453 without an estimate, gives 129,534; minus 8,751 burn-in gives 120,783, which is 60,663 + 60,120. Central truth: minus 909 missing, minus 41 out of range, minus 495 hard-flagged in either file, gives 119,338, which is 59,970 + 59,368 (`groups.csv`). Long: 119,368 = 59,966 + 59,402. Short: 119,356 = 59,987 + 59,369. Two-by-two: 119,117 = 59,909 + 59,208. Learn files: OLD 1,611 + 12,237 + 9,840 = 23,688; NEW 2,577 + 18,941 + 16,395 = 37,913; joined OLD 22,040 = 12,231 + 9,809 and NEW 35,271 = 18,925 + 16,346, with 0 unjoined. Group counts, by my own code: all 60,120; lf_rising 4,514; rl_rises 2,975 and 4,488; low_water 16,140; high_12_20 7,271; high_20plus 4,480; rl_large 452 (159 creek-fed, 293 not, 0 unknown); 13 test rises (5 and 8). All equal the plan's numbers. No silent drop or addition.

## 5. Readings against the public USGS service

Request pattern as in `fetch_difficult_run_hourly.py`: `https://waterservices.usgs.gov/nwis/iv/`, only `sites=01646500`, `parameterCd=00060`, `startDT`, `endDT`, `format=json`, no key, no custom header, more than one second between requests. Each window ran from 6 h before the day to 30 h after it, so the daylight-saving quirk (answers one hour earlier than asked) cannot cut off a needed hour. Readings were binned by their own time stamps converted to UTC. All ten hours feed at least six common-truth reads of test estimate hours.

| Hour (UTC) | Kind | Hourly record | USGS median | Readings |
|---|---|---|---|---|
| 2021-06-12 09:00 | steep rise (rise 30), DST | 13900.0 | 13900 | 4 at 15 min, A |
| 2021-06-12 10:00 | steep rise (rise 30), DST | 15450.0 | 15450 | 4, A |
| 2026-10-11 16:00 | steep rise (rise 53), DST | 3690.0 | 3690 | 12 at 5 min, P |
| 2026-10-11 17:00 | steep rise (rise 53), DST | 4050.0 | 4050 | 12 at 5 min, P |
| 2024-09-30 02:00 | steep rise (rise 48), DST | 14200.0 | 14200 | 4, A |
| 2020-08-15 17:00 | DST | 4360.0 | 4360 | 4, A |
| 2022-02-03 09:00 | standard time | 4645.0 | 4645 | 4, A |
| 2023-07-04 20:00 | DST | 4040.0 | 4040 | 4, A |
| 2025-12-01 12:00 | standard time | 2210.0 | 2210 | 12 at 5 min, A |
| 2025-03-10 06:00 | DST | 9500.0 | 9500 | 4, A |

Ten of ten match exactly. The record's stamps are UTC, start of the hour. Finding 8 comes from this check.

## 6. What the numbers mean

Properties beyond the two the specification names:

- (a) A shorter clock scores a shorter horizon. Shorter horizons give smaller errors whatever the learning does. This favours NEW on every own-truth and self-scoring number.
- (b) The cap only lowers. It can add badly-low readings (906 with the cap against 840 without it, test, rising, central) and can never remove one.
- (c) Persistence (Y0) is scored on its own gauge (finding 2).
- (d) Cap dilution of the movement (finding 7).
- (e) Self-scoring uses unpaired subsamples steered by each clock.
- (f) Groups are decided on the held Little Falls reading (1 to 2 h old, up to 48 h after gaps), so "rising" lags the river.
- (g) The scoring rate ratio is mechanical: a shorter clock frees the single slot sooner.

Headline by headline:

| Number | Could it have come out the other way? |
|---|---|
| Badly-low share on rising water, NEW minus OLD | Yes in principle. It is tilted toward NEW, and the observed -0.8 points (central, long) is within the interval and within what the truth choice (0.00 on OLD's clock) or the staircase (reading the central truth on the staircase, or 0.28 h later, moves the difference by 0.1 to 0.3 points) produce alone. Only the short-end -1.7 points clears its interval, and the short end is the truth furthest from either run's learning. |
| Movement (size, direction) | Not decided by construction. Mean +0.41% over all test hours, lower by count on rising hours, higher on recessions and at low water. |
| Two-by-two | Largely decided by construction (finding 4). |
| Common-truth MAE, NEW below OLD | Tilted by construction (Known property 2). The differences (0.2 to 0.5 points of MAE) are of the size the lean produces. |
| Cap closer, inside NEW | Not construction, but one-sided: the cap cannot fix a low reading. |
| Yardsticks closer over all hours | Not construction, but favoured by scoring on Little Falls (finding 2). |
| Self-report (low share down, band coverage up, rate up) | Mostly decided by construction (a, e, g). |
| Health H01 to H04 | Could have failed. Passed with room (ratios 1.10, 1.11, 1.10, 1.15, 1.07 against the 1.5 limit). |

## 7. Against the expectations written before the run (PLAN.md section 7)

| Expectation | Held? | Numbers |
|---|---|---|
| The shown number moves by less than 1% on most hours | Not in the test years; barely in the design years | share of hours moving under 1%: test 48.5%, design 56.6%; 9.5% of test hours move 5% or more |
| On rising hours without the cap it reads lower by a few percent | No | uncapped rising test hours: mean +0.13%, median -0.17% (5th to 95th percentile -8.1% to +9.1%) |
| On recessions a little higher | Yes | recession windows (not rising), test: mean +1.0%, median +0.86%; design +1.7%, +1.0% (auditor's computation) |
| Badly-low on rising water goes up for NEW on the long-end truth | No in test (-0.82 points); yes in sign in design (+0.41), within noise | |
| ... and down on the central and short-end truths | Test: yes (central -0.84, within noise; short -1.68, interval excludes 0). Design: no (central +0.09, short 0.00) | |
| NEW scores about twice as many estimates per day | Partly: 1.67 times (test), 1.55 times (design) | 6.53 against 3.92 per day |
| The hour-to-hour change of the correction grows a little | Yes | test p95 3.60 to 3.84, p99 9.68 to 11.12, jumps of 5 or more 2,043 to 2,195 |
| Inside NEW the cap does a good job on all three truths | Yes, by its label: `cap_closer` holds in all 10 test groups and 8 of 10 design groups. Limit: it adds badly-low readings | |
| The trend yardstick beats the app on rising hours | Not in test (`mixed`: unclear, app closer, unclear); yes in design (holds) | |
| Over all hours the app beats both yardsticks | No, the reverse: both yardsticks closer on all three truths, both periods | test central MAE app 4.83, Y0 3.50, Y1 3.88 |
| Under its own scoring NEW switches the trust-it-less line on less often | As a share, yes (3.36% to 3.00%). As a count, no (0.13 to 0.20 per day) | |
| More of its truths fall inside the band | Yes, mostly by construction | 84.8% to 86.2% (test), 84.6% to 85.3% (design) |

## 8. Statements for the owner's report

### Supported (each with its limits)

1. "On Little Falls rising hours in 2020 to 2026, about one shown number in five reads 15% or more low under both clocks: 21.4% today and 20.6% with the new clock on the central truth (4,397 hours); 22.5% and 21.7% on the long end; 19.0% and 17.3% on the short end." Limits: the truth is Little Falls read at a modelled travel time, not Great Falls. The table leans toward NEW by construction. On the central and long truths the difference is inside a month-block resampling interval that includes zero ([-2.0, +0.2] and [-2.2, +0.5] points). On a truth at today's clock the difference is zero. In 2012 to 2019 the share is about 15.6% for both, and NEW is not lower there.
2. "The change does not reduce the badly-low problem on rising water in any way this replay can show. It neither clearly increases nor clearly decreases it." Same limits.
3. "The new clock moves the shown number by +0.4% on average over all test hours (5th to 95th percentile -4.2% to +5.4%). One hour in ten moves by 5% or more. On rising hours slightly more hours move down than up (2,047 against 1,794), with almost no average shift. On recessions and at low water the number reads about 0.7% to 1% higher." Limits: capped hours do not move. These are hourly medians.
4. "With the new clock the replay scores 1.67 times as many estimates per day. Missed windows, retries and data-check skips per stored estimate stay within 1.1 times today's. The hour-to-hour change of the correction grows a little (99th percentile 9.7% to 11.1% of the raw estimate). All health limits pass." Limit: the limits were set after the counts files were seen (plan 13.1).
5. "Inside the new-clock run the 120% cap brings the shown number closer to the truth on all three truths. But it can only lower the number, and on rising hours it adds badly-low readings (906 with the cap against 840 without it)."
6. "Over all hours, simply showing the latest Little Falls reading would have been closer to the Little Falls truth than the app's number, on all three truths, under the new clock (MAE 3.5% against 4.8%). On rising hours it reads badly low less often (608 against 906 of 4,397)." Limits: the truth is that same gauge, read hours later. The app estimates a different place. This is a statement about scoring against Little Falls, not proof that the app's Great Falls number is worse than Little Falls as a Great Falls estimate.
7. "Every number in the eleven tables was reproduced independently by a third implementation. Ten Little Falls hourly values match USGS exactly."

### Not supported (must not be said)

1. "The new clock reduces badly-low readings on rising water", or any figure such as "by 0.8 points" stated as an effect.
2. "The new clock is better" or "more accurate", from any table. The plan says so itself, and the common-truth MAE gains are of the size the construction lean produces.
3. "The cap protects against reading low." It cannot.
4. "NEW will switch the trust-it-less note on less often." The share of low scores falls, but the count per day rises, and the note's real rule was not modelled.
5. "NEW's 90% band is better calibrated." The coverage gain is mostly the shorter scoring horizon.
6. "Scoring about doubles." It is 1.6 to 1.7 times.
7. "On rising water the number reads a few percent lower." Not seen: almost no average shift.
8. "The creek-fed rises behave differently." Five rises against eight: too few, and wide intervals.
9. "B10 shows NEW is not worse." It is a machinery check on MAE. At low water NEW's signed bias is larger (+1.31% against +0.79%).
10. "Each run looks best on its own truth in every cell" (finding 4).
11. Anything about rises fed by creeks below Great Falls, high water above 20,000 cfs, or low water below 1,400 cfs (plan section 6).

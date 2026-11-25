VERIFIED WITH CAVEATS

# Results audit of the onset study (third auditor)

Date 2026-11-25. Auditor: a fresh agent that ran none of the study. Scope: points 1 to 8 of the brief. Everything below was run by me unless it says otherwise. My scratch work is in `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/onset_results_audit/` (`audit.mjs`, `addendum.mjs`, `acct.mjs`, `cmp_usgs.py`, `out.txt`, `usgs/`, `rmut/`). Nothing else in the repository was changed.

**Short version.** The numbers are right. My own Node.js implementation, written from `PLAN.md`, reproduces every decision input to the sixth decimal, and the shared-draw intervals exactly. The verdict UNCLEAR is the correct verdict under the plan. No criterion was evaluated on the wrong population. The caveats are about what the numbers mean: most of the gain comes from any blend, the picked `m` sits at the edge of the list, and criterion 5 is built so that almost any rule that lowers many values fails it.

## Findings

| # | Severity | Finding |
|---|---|---|
| F1 | Major (reading) | **Criterion 7 fails because the gain is mostly plain blending.** "Half and half" alone gives mean `d` of -0.563 [-0.752, -0.373] on R. The picked rule gives -0.658. The difference, -0.095 [-0.222, +0.030], covers 0. About 86% of the gain needs no knowledge of the size of the rise. |
| F2 | Major (reading) | **Criterion 5's share test can almost never pass for a rule that lowers many values.** Lowering a shown value can only move an hour into the "15% or more below" group, never out. So "share not higher than production's" means "not one lowered hour crosses the line". Here 42 of 2,284 lowered hours cross and none leave (131 to 173 hours, 5.74% to 7.57%). The mean `d` on these hours is better (-1.175). The verdict stays UNCLEAR as the plan says; the report must not re-read the criterion afterwards, but it should say this plainly. |
| F3 | Major (reading) | **`m*` = 5 is at the edge of the candidate list.** My design-year scan beyond the list (mine, not part of the decision): the MAE is lowest near m = 7 to 10 (7.579 and 7.580 against 7.602 at m = 5), and flat from 5 to 15 (within 0.03). In the test years m = 5 happens to be the best of my grid (-0.658; m = 7 gives -0.642). The edge cost nothing here, but the list did not bracket the optimum. With m = 5 the rule keeps a share of the steady value up to r = 5, which covers 87% of R (7,072 of 8,148 test hours). This is a broad blend, not a narrow onset fix. |
| F4 | Minor | **The plan's counts of changed hours (section 2, point 12) do not reproduce.** The plan says 3,386 / 4,514 / 5,733 / 6,643 hours changed at m = 1.5 / 2 / 3 / 5, and 1,781 lowered at m = 2. The outputs, and my own run, give 2,363 / 3,781 / 5,363 / 6,516, and 1,389. The plan's own shares (30.5% of hours with r below 1.5, 49% below 2) do reproduce (2,486 and 4,017 of 8,148). The plan's counts must not be quoted. No effect on any criterion. |
| F5 | Minor | **USGS check: 11 of 11 readings before the revision window match exactly.** At Point of Rocks the input is lower than today's values from 2026-10-08 on (as expected), by up to 18% (2026-11-05 12:00: input 1,780, today 2,180). One reading before that date also differs slightly: 2026-10-01 12:00, input 2,520, today's median 2,530 (0.4%). So the input is not identical to today's data just before the stated boundary either. Small, and outside the hours that drive the result. |
| F6 | Minor (reading) | **The table by cell age points to a stale or noisy rising cell as a rival explanation.** In the design years, production's MAE on R grows with the age of the rising cell (6.59, 9.45, 11.25, 12.50). The steady value's lead over production is near zero for fresh cells (0.05 points under one day) and 1.1 to 1.9 points for older ones. In fresh cells the steady value helps only at r below 2 (0.50 and 0.28 points). |
| F7 | Minor | **The subgroup "from 2026-10-08" has the largest effect (-2.237, 174 hours) and no interval** (two months only). It also sits on values that USGS has since revised. It must not be quoted as evidence. |
| F8 | Info | The known difference between the analysts (an hour with ratio below 1 goes to no group in Python, to "1-1.5" in R) cannot occur: my own count of rising or falling scored hours with a ratio below 1 is 0 in both arms. Every other listed reading difference is on a stop path or an empty population that does not occur in this data. |

## 1. Agreement

What I ran: `python3 -I tools/compare_analysts.py py r`, and SHA-256 of all 13 files in both folders, of the specification and of the three inputs.

What came back:
- `BYTE-IDENTICAL: yes (13 of 13 files)`, `AGREE`, exit status 0.
- All 13 pairs have the same hash (for example `decision.csv` 0c7cb232a3bcb551..., `intervals.csv` 4ca413a8f0d7ecb5...).
- Specification hash `8485759c...10d11`, as in the plan, section 17. Input hashes match the specification, section 1.1.

**Readings of the specification that differ between the READMEs:**
- Ratio below 1: Python puts it in no group, R in "1-1.5". Not reachable: 0 such hours (my check).
- Python: `lowered_below15_diff` blank when `R_lowered` is empty (line 1315); R the same (its reading 9). Not reachable: 2,284 lowered hours.
- Empty cell and `mae_prod` 0 in criterion 2: both set the criterion to 0. Same reading.
- C13, C14, C15, C16 counting: different words, same counts in `checks.csv`.
- Python's weight 0 when `thr6 <= 0`: stop path only; C12 has 0 violations.
None of these could have mattered on this data.

**R unit tests.** I read `r/run_all.R` lines 116 to 247. The test values are those of the specification, section 5 (every case of `unit_rule`, including the halves, the cap under one rule and not another, the falling tie, the error boundary). The change the analyst describes (scalar inputs repeated to full length, through the helper `sh`) touches only the inputs, not the expected values. The main code uses the same helpers (`shown_of`, `hw`, `hwf`, `blend`, lines 276 to 289). To check that the tests can fail, I ran lines 1 to 212 in a scratch copy with one change each:

| Change | Failed assertions |
|---|---|
| none | 0 |
| weight divides by m instead of m - 1 | 16 (unit_rule) |
| `round()` instead of `floor(x + 0.5)` | 2 |
| cap removed | 2 |
| blend swapped (corrR and corrS) | 20 |
| ratio group closed above | 1 (unit_groups) |
| spell ignores missing hours | 1 (unit_spell) |

The tests test the specification and can fail. (A removed tie rule also fails 5, but only because of an `ifelse` length effect; the tie rule changes nothing in arithmetic, since (1 - 1)/(m - 1) is 0 anyway.)

## 2. Specification against plan, code against specification

I read both codes at the decision (Python lines 1330 to 1378, R lines 742 to 766), the choice of `m*` (Python 1122 to 1140, R 525 to 550), the rules (R 41 to 50, 276 to 289) and the spell age (R 97 to 106).

- **Eight criteria.** The specification's section 10.3 matches plan section 9 point by point: thresholds -0.25 and -0.10, 2% relative per cell with the lower bound above 0, halves below 0, seasons not above 0, lowered hours on mean `d` and on the share below 15%, the R shares (above by at most 0.5 points), half-and-half with the whole interval below 0, arm F below 0. The two changes recorded in plan section 17 (tie rule never picks a candidate not better than production; criterion 5 is 1 if nothing is lowered) are in both codes. Neither applied here.
- **Verdict logic.** Order NOT SUPPORTED, FAIL, PASS, GAIN WITHOUT ONSET, UNCLEAR in both codes, as in plan section 9. With criteria 5 and 7 at 0, only UNCLEAR is possible. If criterion 5 alone had passed, the verdict would have been GAIN WITHOUT ONSET.
- **Population R.** Scored, rising, flow range below 25,000 cfs, as in the plan. Scoring follows plan section 5 and the cited earlier specification, for one arm.
- **Rule arithmetic.** As in plan section 6, including `floor(x + 0.5)`, the cap at 1.2 times `lfCap`, and `w = 0` at r = 1.
- **`m*`.** Lowest design-year MAE among the four candidates, 0.02 tie rule. Gap here 0.106, so no tie.
- **Bootstrap.** Calendar months, 10,000 draws, shared file, mean as a ratio of block sums. Quarters as a report.

I found no shared misreading. My own implementation, written from the plan, gives the same numbers (point 3), which rules out a shared error in the parts I recomputed.

## 3. Independent recomputation

What I ran: `audit.mjs` (Node.js, no libraries), written from `PLAN.md` sections 5 to 9. For the percentile I used the type 7 rule of the specification so the shared-draw bounds can match exactly. For my own random numbers: a seeded generator (mulberry32, seed 777), 10,000 draws, simple order-statistic percentiles.

| Number | Analysts | Mine | Difference |
|---|---|---|---|
| Design R, MAE production | 8.507747 | 8.507747 | 0 |
| MAE m = 1.5 / 2 / 3 / 5 | 8.100574 / 7.898789 / 7.707896 / 7.602047 | same | 0 |
| MAE half / mean of three / steady | 7.710294 / 7.775914 / 7.736583 | same | 0 |
| `m*` | 5 | 5 | 0 |
| R test n | 8,148 | 8,148 | 0 |
| mean `d` on R | -0.658022 | -0.658022 | 0 |
| 95% interval, shared draws | [-0.940536, -0.375557] | [-0.940536, -0.375557] | 0 |
| 95% interval, my own draws | | [-0.936630, -0.370887] | about 0.005 |
| quarters | [-0.934711, -0.347754] | same | 0 |
| half1 / half2 | -0.727379 / -0.587807 | same | 0 |
| eel / non-eel | -0.667237 / -0.653126 | same | 0 |
| cell rel 0-3000 / 3000-6000 / 6000-12000 / 12000-25000 | -0.049692 / -0.070896 / -0.087888 / -0.088570 | same | 0 |
| cell lower bounds | -1.360725 / -1.212479 / -1.058470 / -1.079127 | same | 0 |
| lowered n / mean `d` / below-15 difference | 2,284 / -1.175285 / 1.838879 | same | 0 |
| R below-15 / above-15 difference | -1.804124 / -0.515464 | same | 0 |
| `hh_est` / `hh_ci_hi` | -0.094838 / 0.030301 | -0.094838 / 0.030301 (own draws 0.028777) | 0 |
| arm F mean `d` | -0.593357 | -0.593357 | 0 |
| arm F interval | [-0.834457, -0.370762] | same (own draws [-0.834208, -0.371496]) | 0 |
| mean `d`, all scored test hours | -0.090189 | -0.090189 | 0 |
| Verdict | UNCLEAR (1,2,3,4,6,8 met) | UNCLEAR (same) | none |

Also recomputed with no mismatch: the row checks (shown value equals `predictedCFS` on all 119,447 / 119,464 scored hours; error equals `errPctCorr` within 1e-9; `corrUsed` equals the text of the state's correction; no ratio below 1), and every row of `stepb_rules.csv` (MAE, bias, mean `d`, both shares).

## 4. Row accounting

What I ran: `acct.mjs`, every row of both shadow files, by period.

| Arm L | burn-in (to 2012-11) | design | test | total |
|---|---|---|---|---|
| rows read | 8,779 | 62,088 | 60,120 | 130,987 |
| not predicted | 28 | 1,990 | 374 | 2,392 |
| burn-in | 8,751 | | | 8,751 |
| truth-dependent hard flag | | 99 | 257 | 356 |
| truth out of range | | 0 | 41 | 41 |
| blank error | | 0 | 0 | 0 |
| scored | 0 | 59,999 | 59,448 | 119,447 |
| of which R | | 7,052 | 8,148 | 15,200 |
| R rows dropped before scoring | 921 (burn-in) | 65 (not predicted) | 34 not predicted, 24 hard, 8 range | |

Arm F: read 130,987; not predicted 2,374; burn-in 8,753; hard 355 (99 design, 256 test); range 41 (all test); scored 119,464 (60,013 design, 59,451 test); R 8,209 design, 9,373 test.

All equal `row_accounting.csv` and `populations.csv`. Sums close. No silent drop. The shadow files have 571 more rows than the 130,416-row input because the replay writes one row per hour of the grid; those hours are not "predicted" (`no_por`, `no_lf`, `no_truth`).

## 5. Source data against USGS

Provenance: `analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.PROVENANCE.txt` and `fetch_hourly_backtest_data_v39.py`: each hourly value at stamp T is the **median of all readings in [T, T+1h)**, UTC. I compared like with like: the median of the readings the service returns for that hour.

Request form: `https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items?monitoring_location_id=USGS-<site>&parameter_code=00060&time=<start>/<end>`. No key, nothing else in the request. All answers HTTP 200.

| Gauge | Hour (UTC) | Readings | Median now | Input | Difference |
|---|---|---|---|---|---|
| Point of Rocks 01638500 | 2012-06-15 12:00 | 4 | 4,880 | 4,880 | 0 |
| Point of Rocks | 2015-03-10 06:00 | 4 | 25,800 | 25,800 | 0 |
| Point of Rocks | 2018-09-20 18:00 | 4 | 45,000 | 45,000 | 0 |
| Point of Rocks | 2021-05-05 00:00 | 4 | 7,910 | 7,910 | 0 |
| Point of Rocks | 2024-01-20 12:00 | 1 | 10,000 | 10,000 | 0 |
| Little Falls 01646500 | 2012-06-15 12:00 | 4 | 5,640 | 5,640 | 0 |
| Little Falls | 2015-03-10 06:00 | 4 | 32,300 | 32,300 | 0 |
| Little Falls | 2018-09-20 18:00 | 4 | 58,900 | 58,900 | 0 |
| Little Falls | 2021-05-05 00:00 | 4 | 11,200 | 11,200 | 0 |
| Little Falls | 2024-01-20 12:00 | 4 | 12,600 | 12,600 | 0 |
| Little Falls | 2026-10-20 12:00 | 10 | 5,500 | 5,500 | 0 |
| Point of Rocks | 2026-10-01 12:00 | 10 | 2,530 | 2,520 | -0.4% |
| Point of Rocks | 2026-10-10 12:00 | 10 | 1,560 | 1,540 | -1.3% |
| Point of Rocks | 2026-10-20 12:00 | 10 | 4,570 | 4,350 | -4.8% |
| Point of Rocks | 2026-11-05 12:00 | 10 | 2,180 | 1,780 | -18.3% |

Readings before 2026 are "Approved"; the 2026 ones "Provisional". The 11 readings outside the revision window match exactly. From 2026-10-08 the input is lower than today's Point of Rocks values, growing to 18% by early November, as the brief said to expect. The 0.4% difference on 2026-10-01 is just before the stated boundary (finding F5). Little Falls on 2026-10-20 matches.

## 6. The 15 percent line (C15)

What I ran: `addendum.mjs`, the C15 count by the specification's definition, from my own parsing.

- Count reproduced: **63 pairs in arm L (13 distinct hours), 83 in arm F (18 distinct hours).** The ratio part adds 0 in both arms.
- **They are exact values.** Every truth on these hours is a whole number written without decimals (for example 1,940 or 3,280 cfs), and the shown value is exactly 0.85 or 1.15 times it (truth 3,280, shown 2,788). Whole-number strings parse exactly in R and in Python. So the parsing risk the check was built for does not exist on these hours.
- Populations, arm L: 7 falling hours below 25,000 cfs, 2 steady hours, 4 R hours (1 design, 3 test). Most pairs come from non-R hours that count once for each variant that leaves them unchanged (a steady hour gives 12 pairs, a falling hour 1 to 10, depending on whether production itself is on the line).
- **Could any change a share used by criterion 5 or 6?** Those use production and m = 5 on the arm L test hours of R. None of the 63 pairs is a production or m = 5 pair on an R test hour. The three R test hours sit on the line only under other rules (2023-10-28 15:00 under half and half; 2026-08-05 14:00 and 2026-09-01 19:00 under other candidates or controls). Even one flipped hour would move criterion 5's share by 0.044 points (100 / 2,284) against a gap of 1.84, and criterion 6's by 0.012 against a gap of 1.80. No criterion can flip.
- Arm F has R test hours on the line under production (2026-05-05 21:00) and m = 5 (2023-12-03 14:00), but arm F is used only through its mean `d` (criterion 8).

## 7. What the result is made of

All numbers in this section that are not in the analysts' files are mine and not part of the pre-set decision.

### Criterion 7: the rule against the blends

Test years, R (8,148 hours). `dX` = |error of the picked rule| - |error of X|, per hour, intervals over months with the shared draws.

| Comparison | Test mean | 95% interval | Design (MAE difference) |
|---|---|---|---|
| picked rule vs half and half | -0.095 | [-0.222, +0.030] | -0.108 |
| picked rule vs steady always | -0.224 | [-0.374, -0.075] | -0.135 |
| picked rule vs mean of three | -0.237 | [-0.371, -0.103] | -0.174 |
| half and half vs production | -0.563 | [-0.752, -0.373] | |
| steady always vs production | -0.434 | [-0.800, -0.065] | |
| mean of three vs production | -0.421 | [-0.685, -0.158] | |

Reading: of the gain of -0.658, half and half alone gives 86%. Simply not using the rising value (steady always) gives 66%, the mean of three 64%. The hand-over is clearly better than "steady always" and "mean of three", but not distinguishable from "half and half". The two differ in where they win. At r below 1.5, the picked rule beats half and half by 0.26 points (MAE 7.285 against 7.541, test). At r from 5 to 10, where the picked rule is production, half and half is better by 0.24 points (9.503 against 9.747). So part of the gain does depend on the size of the rise, and part is plain averaging that the hand-over leaves out at large rises. Leave-one-year-out (my computation), the advantage over half and half stays between -0.076 and -0.110. It is never large.

### Criterion 5: the lowered hours

- 2,284 of the 8,148 R test hours are lowered (28%), mean change -163 cfs (3.4% of the truth).
- Mean `d` on them: -1.175 (better). By flow range: 0-3000 cfs -0.61 (593 hours), 3000-6000 -2.08 (821), 6000-12000 -0.81 (701), 12000-25000 -0.28 (169).
- Hours shown 15% or more below the truth: 131 under production, 173 under the rule. **42 hours cross the line, none leave** (by construction, see F2). By flow range: 14, 16, 12 and 0. Their production errors ran from -1.5% to -14.9% (mean -10.6%); the rule moved them by a mean of -6.4% of the truth, to a mean of -17.0%. Mean truth 4,740 cfs, mean r 1.78. 19 of the 42 are in 2025.
- Whether lowering helps depends on the sign of production's error on that hour, which the rule does not know. On lowered hours where production was already low (errors from -15 to 0, 647 hours), mean `d` is +2.55 to +2.58. Where production was high (errors above 0, 1,506 hours), mean `d` is -0.54 to -7.48.
- **Beside criterion 6.** Over all of R the share 15% or more below falls from 10.59% to 8.79% (863 to 716 hours). The raised hours do this: 502 of them were 15% or more below under production, 313 under the rule (189 out). The lowered hours add 42. The share 15% or more above falls from 7.03% to 6.52%: the lowered hours take 211 hours down to 78, the raised hours push 81 up to 172. Criterion 6 holds because the two directions are netted over R. Criterion 5 fails because it looks at one direction only, where the share can only grow.

### The tables by cell age and by ratio (design years, `a1_tables.csv`)

| `ageR_h` | n | MAE production (rising value) | MAE steady value | Lead of steady |
|---|---|---|---|---|
| under 1 day | 3,657 | 6.588 | 6.538 | 0.05 |
| 1 to 7 days | 1,725 | 9.455 | 7.952 | 1.50 |
| 7 to 30 days | 1,028 | 11.254 | 9.324 | 1.93 |
| over 30 days | 642 | 12.503 | 11.443 | 1.06 |

The error of production's rising value grows with the age of the rising cell. The raw estimate's error grows too (8.98 to 24.74), so old cells also mark rarer, harder conditions. The steady value's lead is close to zero when the rising cell is fresh. Within fresh cells (under one day) the steady value is better only at r below 2 (by 0.50 and 0.28 points) and not better from r = 2 up (worse by 0.05 and 0.29, level at r 5 to 10, worse by 1.89 at r above 10).

| r | Design: production / steady | Test: production / steady |
|---|---|---|
| 1-1.5 | 7.54 / 5.83 | 8.50 / 7.32 |
| 1.5-2 | 7.84 / 7.05 | 8.66 / 7.89 |
| 2-3 | 8.19 / 7.60 | 8.83 / 8.59 |
| 3-5 | 8.53 / 8.50 | 9.11 / 9.75 |
| 5-10 | 11.17 / 11.03 | 9.75 / 9.90 |
| 10+ | 13.77 / 14.67 | 12.69 / 12.85 |

The steady value is better only at small ratios (below about 3), in both periods; from 3 up it is equal or worse. That fits the starting idea that the problem is tied to small rises. But two other patterns compete with it. First, the steady value's lead sits mostly in hours where the rising cell is old (above). Second, the split by which value is larger (design): production's bias follows the sign of `corrR - corrS` (-3.56 where the rising value is larger, +3.49 where it is smaller), and the steady value is closer in both groups. A rising value that overshoots in both directions is what a noisy cell looks like. The spell table points the same way as the ratio table: the steady value's lead is largest in the first hour of a rising spell (8.91 against 6.81) and gone after 12 hours (6.87 against 7.08). Small ratios and early spell hours overlap, so the study cannot separate "small rise" from "start of a rise" from "stale cell".

### Is the optimum inside the list?

No (F3). Design MAE by m, mine beyond the list: 1.5: 8.101; 2: 7.899; 3: 7.708; 5: 7.602; 7: 7.579; 10: 7.580; 15: 7.591; 20: 7.612; 50: 7.680; steady (m going to infinity): 7.737. The curve is flat from 5 to 15. Test mean `d` by m: 3: -0.601; 5: -0.658; 7: -0.642; 10: -0.608; 20: -0.530; steady: -0.434. What follows: the choice of m is not sharp, the selected rule blends over almost all of R, and the plan's expectation (m* of 2 or 3) did not hold. A follow-up must not treat m = 5 as a tuned value. The replay's state span is also about one fifth shorter than production's (plan section 12), so the same rule in production would correspond to a different m.

### Robustness (reported, not judged)

| Variant | mean `d` | 95% interval |
|---|---|---|
| R, months (decision) | -0.658 | [-0.941, -0.376] |
| R, quarters | -0.658 | [-0.935, -0.348] |
| R without unusual span (55 hours out) | -0.646 | [-0.931, -0.360] |
| same, quarters | -0.646 | [-0.925, -0.333] |
| arm F, R | -0.593 | [-0.834, -0.371] |
| arm F, quarters | -0.593 | [-0.852, -0.342] |
| arm F without unusual span (183 hours out) | -0.582 | [-0.828, -0.352] |
| before 2026-10-08 | -0.624 | [-0.908, -0.341] |
| from 2026-10-08 (174 hours) | -2.237 | none (two months) |
| vs half and half, quarters | -0.095 | [-0.215, +0.028] |
| cell 0-3000, quarters | -0.537 | [-1.268, +0.088] |

Year by year (mine), test years, mean `d` on R: 2020 -0.62, 2021 -1.08, 2022 -0.41, 2023 -0.79, 2024 -0.89, 2025 -0.70, 2026 -0.14. Negative in every year. Leave one year out: from -0.59 to -0.73. Design years 2012 to 2019: negative in every year too (-0.48 to -1.26, and -3.67 in the 104 hours of December 2012). The 2026 figure is the smallest and its last weeks rest on unrevised values. Quarters as blocks change nothing material. The cell 0-3000 is the one cell whose interval covers 0, in both block choices; this does not touch criterion 2 (its relative change is -5%, not above +2%).

## 8. What may be claimed

**The verdict.** UNCLEAR, computed correctly: criteria 1, 2, 3, 4, 6 and 8 met; 5 and 7 not met; no unclear cell; no FAIL flag. In my judgement it is the right verdict under the plan as written. No criterion was evaluated on the wrong population or number. Plan section 10: after UNCLEAR, **the owner decides**. No build follows. Even a PASS would only have led to a check on the app's own log (section 10).

**Statements the report may make:**
1. In the test years, on scored rising hours below 25,000 cfs (8,148 hours), the hand-over with m = 5 lowers the absolute error of the shown value by 0.658 points on average (95% interval -0.941 to -0.376; months as blocks).
2. MAE on R falls from 8.980 to 8.322 (-7.3% relative). The mean signed error goes from -1.315 to -0.107.
3. Over all scored test hours the change is -0.090 points (-0.128 to -0.052).
4. The share of R hours shown 15% or more below the truth falls from 10.59% to 8.79%, the share 15% or more above from 7.03% to 6.52%.
5. The gain is negative in both halves of the test years (-0.727, -0.588), in both seasons (-0.667, -0.653), in all four flow ranges below 25,000 cfs (-0.537 to -0.724) and, in the fresher-timing arm F, -0.593 (-0.834 to -0.371).
6. m = 5 was picked mechanically in the design years (MAE 7.602 against production 8.508), before the test years were scored.
7. A fixed half-and-half blend gives -0.563 (-0.752 to -0.373). The hand-over is not distinguishable from it: -0.095 (-0.222 to +0.030). Criterion 7 is not met.
8. On the 2,284 lowered hours the mean error improves (-1.175), but 42 hours move to 15% or more below the truth (5.74% to 7.57%). Criterion 5 is not met.
9. In the design years the steady value is closer than the rising value at small ratios (r 1 to 1.5: MAE 5.83 against 7.54), not at large ones.
10. Source data: 11 of 11 USGS readings checked outside the revision window match the input exactly.
11. Labelled as the auditor's description, outside the decision: the hand-over beats "steady always" (-0.224, interval -0.374 to -0.075) and "mean of three" (-0.237, -0.371 to -0.103); the design-year optimum lies beyond m = 5.

**Statements the report must NOT make:**
1. "The gain is an onset effect" or "is tied to the size of the rise." Criterion 7 failed; half and half gives 86% of it.
2. "The study passed" or "GAIN WITHOUT ONSET." Criterion 5 failed. Re-reading criterion 5 after the result, even though its share test is structurally hard (F2), would be a change of the decision rule after the outcome.
3. "The hand-over should be built" or any production change. Plan section 10: UNCLEAR, owner decides; a build would anyway need a check on the app's own log first, a MAJOR version, and separate work on the browser path.
4. "m = 5 is the best value" or "m = 5 carries over to the app." It is the edge of the list (F3); the replay's state span is about 4 hours against about 4.9 in production (section 12).
5. "No harm on lowered hours." 42 hours were pushed to 15% or more below the truth.
6. "The app's headline error would improve by 0.09 points." This is a replay on hourly values with no resets; the browser decides its state by another route; truth is the Little Falls flow (section 12).
7. "Since 2026-10-08 the gain is -2.2 points." 174 hours, no interval, inputs revised by USGS (F5, F7).
8. "The steady value is better than the rising value" without the ratio. From r = 3 up it is equal or worse.
9. The plan's counts of changed hours (3,386 / 4,514 / 5,733 / 6,643; 1,781). They do not reproduce (F4).
10. "The study confirms the D20 finding independently." The form of the rule came from the whole record, including the test years; the split protects only the choice of m (section 12).
11. "The problem is caused by small rises." Small ratio, early spell hour and old rising cell overlap; the study cannot separate them, and the age table and the two-sided overshoot point also to cell noise (F6).

## Could not check

- The replay itself (whether the shadow files are what production would have computed). I relied on `TOOL_AUDIT.md` and the row checks; I recomputed only that the shown value, the error and the correction of the state are consistent inside the files.
- More USGS readings than the 15 above, and the travel-time pairing of the truth (truth is Little Falls one travel time later; I checked Little Falls values at the hour, not the pairing).
- Why Point of Rocks on 2026-10-01 12:00 differs by 0.4% from today's values, before the stated revision boundary. It may be a small revision or a different set of readings in that hour. The service returned 10 readings for the 2026 hours, where 12 might be expected.
- The Python code beyond the decision, the `m*` choice and its README readings. Its output equals R's byte for byte and equals mine, so I did not mutation-test it.
- Anything about production after 2026-11-25 (the app's own log). That is a separate check under its own plan, and an unverified gap until it is run.

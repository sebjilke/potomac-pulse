# Analysis specification: the onset study (version 1)

Written 2026-11-25, BEFORE any result was computed or seen. It turns the method of the study into exact arithmetic.
Two analysts, one in Python and one in R, work from THIS FILE and the data files named in section 1 ONLY.
They cannot see each other. The aim is output files that are byte for byte identical. Every number must agree within 0.01.

**Blindness.** Do NOT read `PLAN.md`, `PLAN_v1.md`, `PLAN_AUDIT.md`, `TOOL_AUDIT.md` or `TODO.md`, nor any other file
in the study folder, nor the other analyst's folder. Nothing in this file is a result or an expectation. You state no
opinion on what any number means. The decision rule (section 10) is computed mechanically and written to a file.

If this file is silent or unclear on a point, do not guess in your own way: make the most literal and simplest choice,
and write it in your `REPORT.md` under "Judgment calls".

Conventions reused from `analysis/forecast_from_measured_water_2026-11-24/ANALYSIS_SPEC.md` (the earlier specification
that gave byte-identical files from two analysts): the bootstrap with a shared file of 12-digit integers and block index
`(n * B) // 10^12`; the hand-written type 7 percentile; number format `%.6f`; `\n` line endings; blank for missing;
decision tests on the written strings as integers in units of 1e-6; the compare tool. Whatever this study needs beyond
that is defined below from scratch.

## 0. Environment

- Python: Python 3, standard library only (no numpy, no pandas). Run every script as `python3 -I script.py`. `-I` removes the
  script's folder from the import path: use one single-file script, or insert the folder in `sys.path` yourself.
- R: R 4.5.2, base R only (packages base, stats, utils). Run as `Rscript`.
- Write ONLY into your own folder inside the study folder `analysis/onset_correction_2026-11-25/`: `py/` (Python) or `r/` (R).
  Everything else is read-only. No network. No installs.
- Read only: this file, `replay_L/shadow_L.csv`, `replay_F/shadow_F.csv`, `tools/boot_uniforms.csv`.
- Do not use `round()` in either language anywhere in the rules (R rounds halves to even). The only rounding is `floor(x + 0.5)`.
- R: read each shadow file with `read.csv(header = TRUE, colClasses = <named vector: "character" for the 21 columns of section 1.2, "NULL" for all others>, quote = "", comment.char = "", na.strings = character(0), stringsAsFactors = FALSE)`, then convert numbers yourself with `as.numeric`. Use vectors, not row loops over a data frame; a loop over plain vectors of about 131,000 elements is fine.
- Python: the `csv` module with `newline=''`. Strip a trailing `\r` if present (the shadow files use `\n`).
- One command rebuilds all your outputs from the raw files: `python3 -I py/run_all.py` or `Rscript r/run_all.R`, run from the study folder. Put a short `README.md` in your folder.
- Also write `REPORT.md` in your folder with the headings: `## What was run`, `## Row counts`, `## Judgment calls`, `## Deviations from the specification`, `## Checks`. No opinion on what the numbers mean.

## 1. Inputs

### 1.1 Files (paths relative to the study folder)

| Role | Path | Facts |
|---|---|---|
| Main run, arm L | `replay_L/shadow_L.csv` | 130,987 data rows, 87 columns, LF line ends. SHA-256 `dcc63931841b537a834962b9a7c60e6edfd3b72b8bd491b43af89bbba0ba5aba`, 109,952,178 bytes |
| Timing check, arm F | `replay_F/shadow_F.csv` | 130,987 data rows, 87 columns, same header as L. SHA-256 `7fb8072237cd21c99d196a7b2c1525f4aa850885638e4f06321617cdcf2a63a3`, 110,149,295 bytes |
| Bootstrap draws | `tools/boot_uniforms.csv` | 10,000 data rows, columns `u1`..`u100`, every cell a 12-digit zero-padded integer, 13,000,392 bytes. SHA-256 `71d75af9b10c1ba4d3d9492f0e07d17497a35e01d3568d9b3ed8ab8fe528d515`. Made by `tools/make_boot_uniforms.py` (seed 20261125, `python3 -I tools/make_boot_uniforms.py`) |

Python analyst: compute the SHA-256 of the three files and stop on a mismatch. R analyst: no base SHA-256 exists; check
the byte sizes (`file.size`) and the row counts instead.

### 1.2 Columns used (header names exact, case sensitive; each must occur exactly once in the header)

`predTs, status, rawFinalCFS, predictedCFS, flowBin, flowState, truthFlow, truthInProdRange, truthDependentHard, errPctRaw, errPctCorr, rawUnc, corrUsed, corrR, corrS, corrF, d6, thr6, span_h, lfCap, ageR_h` (21 columns).

No other column is used. Never use `hardFlag`, `softFlag`, `chk*`, `outlierZ`, `histShort`, `ageS_h`.

### 1.3 Parsing

- Text columns, compared as exact strings: `predTs, status, flowBin, flowState, truthInProdRange, truthDependentHard`. The last two hold `1` or `0` or blank.
- Number columns, parsed as 64-bit floating point numbers: `rawFinalCFS, predictedCFS, truthFlow, errPctRaw, errPctCorr, rawUnc, corrUsed, corrR, corrS, corrF, d6, thr6, span_h, lfCap, ageR_h`. Python `float(s)`, R `as.numeric(s)`.
- Blank = the empty string = missing. Never turn a blank into 0. `corrUsed, corrR, corrS, corrF` are also kept as TEXT for the equality check C08.
- The files are unquoted. No field contains a comma.

### 1.4 Time

All times are UTC. `predTs` has the fixed form `YYYY-MM-DDTHH:00:00.000Z` (24 characters).
- **Period tests use string comparison** of `predTs` with the boundary strings given below (valid because the form is fixed-width).
- **Hour key** `K(predTs)` = `days_from_civil(Y, M, D) * 24 + HH`, all integers, with this integer algorithm (floor division on integers; Python `//`, R `%/%`):
  `y = Y - (M <= 2 ? 1 : 0); era = y // 400; yoe = y - era * 400; doy = (153 * (M + (M > 2 ? -3 : 9)) + 2) // 5 + D - 1; doe = yoe * 365 + yoe // 4 - yoe // 100 + doy; days = era * 146097 + doe - 719468`.
  No library time function is used. Test values: `K(2020-01-01T00) = 438288`, `K(2012-12-01T00) = 376200`, `K(2026-11-09T23) = 498407`, `K(1970-01-01T00) = 0`.
- Month label of an hour = `predTs[0:7]` (`YYYY-MM`). Quarter label = `YYYY` + `Q` + `((MM - 1) // 3 + 1)`. `md = 100 * MM + DD`.

## 2. Scored hours (one arm at a time; the rules of `replay_lag_2026-11-17/ANALYSIS_SPEC.md` section 1, for one arm)

Apply these conditions to the rows of the arm's file IN THIS ORDER. Each row meeting a condition is dropped; later conditions
see only the rows left. Write the row accounting (section 12, `row_accounting.csv`) for each arm.

0. `read`: all data rows.
1. `status_not_predicted`: `status != "predicted"`.
2. `burn_in`: `predTs < "2012-12-01T00:00:00.000Z"`.
3. `truth_dependent_hard`: `truthDependentHard == "1"`.
4. `truth_out_of_range`: `truthInProdRange == "0"`.
5. `blank_error`: `errPctCorr == ""` or `errPctRaw == ""`.

The rows left are the SCORED hours, in file order (ascending `predTs`). A blank `truthDependentHard` or `truthInProdRange` is NOT dropped by
conditions 3 and 4 (literal rule); on a scored row such a blank is a violation of check C06 and stops the study.

## 3. Periods and sub-populations (all by `predTs` of the hour of the estimate, UTC)

| Name | Condition |
|---|---|
| design | `"2012-12-01T00:00:00.000Z" <= predTs < "2020-01-01T00:00:00.000Z"` |
| test | `predTs >= "2020-01-01T00:00:00.000Z"` (the file ends 2026-11-09T23) |
| half1 | test and `predTs < "2023-06-01T00:00:00.000Z"` |
| half2 | test and `predTs >= "2023-06-01T00:00:00.000Z"` |
| eel | `915 <= md <= 1215`: ALL 24 hours (00 to 23 UTC) of 15 September, through ALL 24 hours of 15 December, every year |
| noneel | not eel |
| from1008 | `predTs >= "2026-10-08T00:00:00.000Z"` |
| before1008 | `predTs < "2026-10-08T00:00:00.000Z"` |

`LOW4` = `flowBin` is exactly one of the four strings `0-3000`, `3000-6000`, `6000-12000`, `12000-25000` ("below 25,000 cfs").
The other two labels are `25000-50000` and `50000+` ("HIGH2"). Any other `flowBin` text on a scored row violates C06.

**R** (the main population) = scored hours with `flowState == "rising"` and `flowBin` in LOW4. R is the same for every rule and every `m`.
`R_design` = R and design. `R_test` = R and test. Sub-populations of `R_test`:
- `R_half1`, `R_half2`, `R_eel`, `R_noneel`, `R_before1008`, `R_from1008`: R_test and the period of that name.
- `R_cell_<bin>` for the four LOW4 strings: R_test and `flowBin == <bin>`.
- `R_span_usual`: R_test and `span_h == U`, where `U = 4` for arm L and `U = 5` for arm F (parsed number equality; `span_h` is non-blank on every R hour, check C06). The hours of R_test with `span_h != U` are `R_span_unusual`; they stay in every other population and are dropped only for this one sensitivity.
- `R_affected`, `R_raised`, `R_lowered`: R_test hours whose shown value under the rule differs from production's / is larger / is smaller (section 4.3).

`scored_all` = all scored hours of the period named. `rising_high_test` = scored test hours with `flowState == "rising"` and flowBin in HIGH2.
`falling_low_test` = scored test hours with `flowState == "falling"` and flowBin in LOW4.

Hours with an unusual state span (`span_h != U`) are NOT removed from any population. They are counted (`populations.csv`) and used in one sensitivity (section 8.5).

## 4. The rules, as exact arithmetic

All arithmetic in IEEE doubles, in the order written. Constant: `CAP = 1.2`.

### 4.1 Shown value of a rule on a scored hour

```
if the hour is in the rule's CHANGE SET:   correction = formula of the rule (4.2)
else:                                        correction = corrUsed
v     = rawUnc - correction
if lfCap > 0:  v = min(v, 1.2 * lfCap)       (if lfCap <= 0 the cap is not applied; a blank lfCap is a stop, C06)
shown = floor(v + 0.5)
err   = (shown - truthFlow) / truthFlow * 100     (percent; "points" are percentage points of err)
```
`floor(x + 0.5)` is the only rounding (halves go up; negative halves too: `-0.5` gives `0`, `-1.5` gives `-1`).

**Production** has an empty change set: `correction = corrUsed` on every hour. Its recomputed shown value must equal `predictedCFS`
(check C09) and its recomputed error must equal `errPctCorr` (check C10). Production's shown value and error are the recomputed ones (they are equal when the checks pass).

### 4.2 Formulas

Ratio on a rising hour: `r = d6 / thr6` (check C12 asserts `thr6 > 0` and `d6 >= thr6`, so `r >= 1`).
Hand-over weight for a candidate `m` in {1.5, 2, 3, 5}: `w = 0` if `d6 == thr6` (the tie: `r` exactly 1), else `w = min(1, (r - 1) / (m - 1))`.
Blend: `correction = (1 - w) * corrS + w * corrR`, written exactly so (`(1.0 - w) * corrS + w * corrR`).

| Rule name | Change set | Correction |
|---|---|---|
| `production` | none | `corrUsed` |
| `handover_m1.5`, `handover_m2`, `handover_m3`, `handover_m5` | R | blend with the hand-over weight of that `m` |
| `half_half` | R | blend with `w = 0.5` |
| `mean_of_three` | R | `((corrR + corrS) + corrF) / 3` |
| `steady_always` | R | blend with `w = 0` (equals `corrS`) |
| `both_sides` (with `m*`, reported only) | R and the scored hours with `flowState == "falling"` and flowBin in LOW4 (any period) | rising hours: the hand-over of `m*`. Falling hours: `rf = (0 - d6) / thr6` (C12 asserts `rf >= 1`); `w = 0` if `(0 - d6) == thr6`, else `w = min(1, (rf - 1) / (m* - 1))`; `correction = (1 - w) * corrS + w * corrF` |
| `handover_mstar` | R | the hand-over of `m*` (section 7.2) |

Hours outside the change set keep `corrUsed`. In particular every hour in HIGH2 has the same shown value under every rule (check C14).

### 4.3 Per-hour comparison with production

For a rule X and an hour: `errX`; `errP` = production's error. `d = abs(errX) - abs(errP)` (negative = X better).
`affected` = `shownX != shownP` (exact comparison of the integer-valued doubles). `raised` = `shownX > shownP`. `lowered` = `shownX < shownP`.
`chg = shownX - shownP` (cfs). `chgpct = abs(shownX - shownP) / truthFlow * 100`.
`below15` = `err <= -15` (shown 15 percent or more below the truth). `above15` = `err >= 15`.
Hours outside the change set have `d = 0` and are not affected.

### 4.4 Measures of a rule X on a population P (n = number of hours in P)

All sums run in file order. A measure over an empty set is blank. Column names (in this order, the "MEAS" columns):

| Column | Definition |
|---|---|
| `n` | hours in P |
| `n_affected`, `n_raised`, `n_lowered` | counts of affected, raised, lowered hours in P |
| `mean_d` | mean of `d` over P |
| `mean_d_affected` | mean of `d` over the affected hours of P (blank if none) |
| `mean_abs_change_cfs` | mean of `abs(chg)` over affected hours |
| `mean_signed_change_cfs` | mean of `chg` over affected hours |
| `mean_abs_change_pct` | mean of `chgpct` over affected hours |
| `mae_prod`, `mae_rule` | mean of `abs(errP)`, mean of `abs(errX)` over P |
| `bias_prod`, `bias_rule` | mean of `errP`, mean of `errX` over P |
| `below15_prod`, `below15_rule` | `100 * (count of below15) / n` for production, for X |
| `above15_prod`, `above15_rule` | `100 * (count of above15) / n` |
| `rel_mae_diff` | `(mae_rule - mae_prod) / mae_prod`; blank if P is empty or `mae_prod == 0` |

## 5. The unit tests on made-up numbers (run FIRST, before any file is read; a failure stops the run)

Each is one row with `n_checked = 1` in `checks.csv` (arm `-`). Names and assertions:

1. `unit_round`: `floor(x + 0.5)`: `0.5 -> 1`, `2.4 -> 2`, `2.5 -> 3`, `-0.5 -> 0`, `-1.5 -> -1`, `8.49 -> 8`, `8.5 -> 9`.
2. `unit_key`: the four key values in 1.4.
3. `unit_rule`: with `rawUnc = 3000.4, corrS = 100, corrR = 300, corrF = -50`, `lfCap = 3300` unless stated:
   `d6 = 150, thr6 = 100, m = 2` gives `w = 0.5`, `correction = 200`, shown `2800`;
   `d6 = 100, thr6 = 100` (tie) gives `w = 0`, correction `100`, shown `2900`;
   `d6 = 400, thr6 = 100, m = 3` gives `w = 1` (the value 1.5 is capped), correction `300`, shown `2700`;
   `lfCap = 2000, w = 0.5`: the cap `2400` binds, shown `2400`; `lfCap = 0, w = 0.5`: no cap, shown `2800`;
   `mean_of_three`: correction `116.66666666666667` (to 1e-12), shown `2884`; `steady_always`: shown `2900`;
   both sides, falling: `d6 = -250, thr6 = 100, m = 3` gives `rf = 2.5`, `w = 0.75`, `correction = 0.25 * 100 + 0.75 * (-50) = -12.5`, shown `3013`.
4. `unit_groups` (section 7.1): `r = 1.5 -> "1.5-2"`, `r = 10 -> "10+"`, `r = 1 -> "1-1.5"`, `r = 4.999 -> "3-5"`; spell age `3 -> "3"`, `4 -> "4-6"`, `6 -> "4-6"`, `7 -> "7-12"`, `12 -> "7-12"`, `13 -> "13+"`; `ageR_h`: `23 -> "lt1d"`, `24 -> "1-7d"`, `167 -> "1-7d"`, `168 -> "7-30d"`, `719 -> "7-30d"`, `720 -> "gt30d"`, blank `-> "blank"`.
5. `unit_spell`: rows at hour offsets with states `0 steady, 1 rising, 2 rising, 3 rising, 4 blank, 5 rising, 6 rising, 8 rising, 9 rising` (offset 7 is absent) give spell ages `-, 1, 2, 3, -, 1, 2, 1, 2`.
6. `unit_percentile`: the rule of 9.3 on `x = 1, 2, ..., 10000` gives `250.975` (2.5th) and `9750.025` (97.5th), each within 1e-9.
7. `unit_boot_index`: `(n * B) // 10^12` with `B = 83`: `n = 0 -> 0`, `n = 999999999999 -> 82`; `B = 7, n = 500000000000 -> 3`; and the first cell of the first data row of `tools/boot_uniforms.csv` is `343638232196`, giving index `28` for `B = 83` and `9` for `B = 28`.

## 6. Checks on the real data (after the unit tests, before any step)

All checks are computed for both arms and `checks.csv` is written. If ANY violation exists the run STOPS and writes no other file.
Per arm (L then F). `n_checked` and `n_violations` are integers.

| Check | Tested on | Violation |
|---|---|---|
| `C01_rows_fields` | every data row | a row without exactly 87 fields; plus one violation if the number of rows is not 130,987 |
| `C02_header` | the 21 column names | a name not occurring exactly once in the header |
| `C03_predTs_form` | every row | `predTs` is not 24 characters of the form `dddd-dd-ddTdd:00:00.000Z` with month 01-12, day 01-31, hour 00-23 |
| `C04_hour_grid` | every row after the first | `K(predTs)` is not exactly the previous row's key plus 1 |
| `C05_numbers_parse` | every non-blank value in the 15 number columns of scored hours | not matching `^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$` |
| `C06_needed_nonblank` | scored hours | a blank in any of `rawFinalCFS, predictedCFS, flowBin, flowState, truthFlow, truthInProdRange, truthDependentHard, rawUnc, corrUsed, corrR, corrS, corrF, lfCap, thr6, errPctRaw, errPctCorr`; or `flowState` not one of `rising, steady, falling`; or `flowBin` not one of the six labels; or, on a `rising` or `falling` hour, a blank `d6` or `span_h`. One violation per hour |
| `C07_truth_positive` | scored hours | `truthFlow <= 0` |
| `C08_corr_of_state` | scored hours | the TEXT of `corrUsed` differs from the TEXT of `corrR` (rising), `corrS` (steady) or `corrF` (falling), for the hour's `flowState` |
| `C09_shown_recomputed` | scored hours | production's recomputed shown value (4.1, `correction = corrUsed`) differs from `predictedCFS` (number equality) |
| `C10_err_corr` | scored hours | `abs(recomputed production err - errPctCorr) > 1e-9` |
| `C11_err_raw` | scored hours | `abs((rawFinalCFS - truthFlow) / truthFlow * 100 - errPctRaw) > 1e-9` |
| `C12_ratio_ge_1` | scored hours with `flowState` rising or falling | rising: `thr6 <= 0` or `d6 < thr6`; falling: `thr6 <= 0` or `(0 - d6) < thr6` |
| `C13_weights_range` | each scored R hour times the 5 weights (`m` = 1.5, 2, 3, 5 and `half_half`), and each scored falling hour with flowBin in LOW4 times the 4 values of `m` | a weight outside `[0, 1]` |
| `C14_unchanged_outside` | every (scored hour, rule) pair for the 8 non-production rules (`m` = 1.5, 2, 3, 5, `half_half`, `mean_of_three`, `steady_always`, and `both_sides` run with each of the 4 values of `m`; HIGH2 hours included) | the hour is outside that rule's change set and the rule's shown value differs from production's |

`n_checked` is the number of rows, values, hours or pairs the check ran on. Violations are counted, not just flagged. Where a check needs
`d6`, `thr6` and a field is blank on an hour outside the tested set, skip the hour.

## 7. Step A (design years, arm L only)

### 7.1 A1: description

Population: `R_design` (arm L). For each hour three errors: `errRaw = (rawFinalCFS - truthFlow) / truthFlow * 100` (the rounded raw estimate),
`errProd` (production, 4.1), `errSteady` (rule `steady_always`, 4.1). Per group: `n`, mean of the signed error and mean of the absolute error, for each of the three.

**Ratio groups** by `r = d6 / thr6` (closed at the lower end, open at the upper end), in this order:
`1-1.5` = `1 <= r < 1.5`; `1.5-2` = `1.5 <= r < 2`; `2-3`; `3-5`; `5-10`; `10+` = `r >= 10`; then the extra level `all` (every hour of the split level).

**Splits** (each split is crossed with the ratio groups; one table each):
- `all`: one level `all`.
- `corr`: `R_larger` = `corrR > corrS` (strict); `R_not_larger` = `corrR <= corrS`.
- `flowbin`: the four LOW4 strings, in the order `0-3000, 3000-6000, 6000-12000, 12000-25000`.
- `spell`: hours since the rising spell began (below), levels `1, 2, 3, 4-6, 7-12, 13+`.
- `ageR`: `ageR_h` (hours, number) levels `lt1d` = `ageR_h < 24`; `1-7d` = `24 <= ageR_h < 168`; `7-30d` = `168 <= ageR_h < 720`; `gt30d` = `ageR_h >= 720`; `blank` = blank `ageR_h` (a blank goes to its own level, never into a number group).

**Spell age.** Computed on ALL rows of the arm's file, in file order, not only scored ones, using `flowState` of every row. A row is "rising" if its `flowState == "rising"` (rows with blank `flowState`, e.g. `no_por`, are not rising). The spell age `k` of a rising row = the number of consecutive rising rows ending at it, counting it, where consecutive means the hour keys differ by exactly 1. The first rising hour after a non-rising row, a blank-state row or a missing hour has `k = 1`. An unscored hour (hard flag, out of range, `no_truth`) that has `flowState == "rising"` does NOT interrupt a spell. Rising hours in HIGH2 flow ranges count as rising too. The age of an R hour is the `k` of its own row.

Every cell is written, also when `n = 0` (then the statistics are blank).

Note for the output description: `ageR_h` and `ageS_h` describe only the cells of the hour's OWN flow range, while `corrR` and `corrS` can mix several cells near 3,000, 6,000 and 12,000 cfs (smoothing across flow ranges) and wherever a cell has fewer than 5 observations (fallback to an average over the states of its range). So the `ageR` table groups hours by the age of one cell, not by the age of all the information in `corrR`. No change to the computation.

### 7.2 A2: the choice of `m*` (mechanical; written to `a2_pick.csv` and `mstar.csv`)

On `R_design`, for each rule of 4.2 except `both_sides` and `handover_mstar`: `n`, `mae` (mean absolute error of the shown value), `mean_signed`. Let `mic(x)` = the value `x` written as `%.6f`, as an integer in units of 1e-6 (section 10.1). The four hand-over candidates are ranked by `mic(mae)` ascending; ties by smaller `m` first. Let `b1` be rank 1, `b2` rank 2.
- If `mic(mae(b2)) - mic(mae(b1)) <= 20000` (within 0.02 points, inclusive), `m* = min(m(b1), m(b2))`; else `m* = m(b1)`. `tie_rule_used` = 1 if the first branch was taken, else 0.
- `beats_production` = 1 if `mic(mae(b1)) < mic(mae(production))` (strictly), else 0.
- If `beats_production == 0`, step B is still run (with `m*` as the rule above gave it) for description, and the verdict is NOT_SUPPORTED regardless of any other number (section 10).

`a2_pick.csv` ranks (`mae_rank`) only the four candidates. `mstar.csv` is read back by step B.

## 8. Step B (test years; used once)

Arm L: all rules and populations below on the test years. Arm F: the rule `handover_mstar` with the `m*` of arm L (read from `mstar.csv`), on the populations listed in 8.1 (`stepb_main.csv`), computed with arm F's own scored hours, its own production, its own columns.

### 8.1 Rule tables

- `stepb_main.csv`: rule `handover_mstar` against production, for each population: arm L: `R, R_half1, R_half2, R_eel, R_noneel, R_cell_0-3000, R_cell_3000-6000, R_cell_6000-12000, R_cell_12000-25000, R_affected, R_raised, R_lowered, R_before1008, R_from1008, R_span_usual, scored_all`; arm F: `R, R_affected, R_span_usual, scored_all`. MEAS columns of 4.4. For `R_affected, R_raised, R_lowered` the population is the stated subset of `R_test` (selected by the rule's own shown values); for `scored_all` all scored test hours (the rule changes only R hours). In this file the names `R`, `R_half1` ... refer to the test years (`R_test` and its parts).
- `stepb_rules.csv`: on `R_test`, arm L, every rule except `both_sides` and `handover_mstar`: `production, handover_m1.5, handover_m2, handover_m3, handover_m5, half_half, mean_of_three, steady_always`. MEAS columns (for `production` the rule equals production: `d` is 0 everywhere).
- `both_sides.csv`: rule `both_sides` with `m*`, test years, arm L; populations `B_all` (test hours that are in R or in `falling_low_test`), `B_eel`, `B_noneel` (its eel / non-eel hours), `B_falling`, `B_falling_eel`, `B_falling_noneel` (the `falling_low_test` hours and their eel / non-eel hours). MEAS columns, against production.
- `step_at_25000.csv`: on scored test hours of `rising_high_test` (arm L): `n_rising_high`; `n_small_rise` = those with `r < m*`; for the small-rise hours: `mean_corrR_minus_corrS` (mean of `corrR - corrS`, cfs); the hypothetical shown value with `w` = the hand-over weight of `m*` (4.2) applied to the hour (no other change); `n_hyp_changed` (hypothetical shown differs from production); `mean_abs_hyp_change_cfs` and `mean_abs_hyp_change_pct` (as `chg`, `chgpct`, over all small-rise hours, including those not changed). Blank when the denominator is 0.

### 8.2 Intervals

Section 9. List and order of the interval rows: section 12, `intervals.csv`.

### 8.3 Controls

`half_half` is compared with `handover_mstar` on `R_test`: per hour `dHH = abs(err of handover_mstar) - abs(err of half_half)` (negative = the hand-over is better). Interval in `intervals.csv` (`I17`, `I18`).

### 8.4 Timing check

Arm F, `m*` from arm L, mean `d` on arm F's `R_test`, interval in `intervals.csv` (`I21`, `I22`).

### 8.5 Span sensitivity (reported, not judged)

Mean `d` of `handover_mstar` on `R_span_usual` (R_test without the hours whose `span_h != U`), with its interval (months and quarters), for arm L and arm F (`I19` to `I24`, and the row `R_span_usual` of `stepb_main.csv`). `populations.csv` counts, per arm and per period (design, test), the R hours with `span_h != U` (`R_design_span_unusual`, `R_test_span_unusual`) and the value of `U`. Nothing in the decision rule changes.

## 9. Bootstrap

### 9.1 Blocks

Test years only (arm L and arm F alike). The block lists are FIXED, the same for every statistic and every population:
- **Months**: the 83 calendar months `2020-01, 2020-02, ..., 2026-11` (UTC month of the `predTs` of the hour), ascending. Block `j` (0-based) is the `j`-th. `B = 83`.
- **Quarters** (sensitivity, reported): the 28 quarters `2020Q1, ..., 2026Q4`, ascending. `B = 28`.
A block with no hour of a population contributes nothing to that population's statistic. Assert that every scored test hour falls in a listed block.

### 9.2 Draws

`tools/boot_uniforms.csv`: data row `r` (1..10000, file order) is draw `r`; read the cells as numbers (exact doubles, 12 digits). For `k = 1..B`
the `k`-th drawn block (0-based) is `j = (n * B) // 10^12` using the cell `n` in column `uk` (Python integers; R `(n * B) %/% 1e12`, exact since `n * B < 1e14 < 2^53`).
Build for each draw the counts `c_j` (how many times block `j` was drawn, 0 or more). Months use `u1..u83`, quarters `u1..u28`, of the same rows.

### 9.3 Statistic, interval, percentile rule

Every interval is for a MEAN over a set of hours: the statistic is the mean of `x` over population P, where `x` is a per-hour value (`d`, or `dHH`).
Per block `j`: `S_j` = sum of `x` over the hours of P in block `j` (file order), `N_j` = their count.
For a draw: `num = sum over j ascending of c_j * S_j`, `den = sum over j of c_j * N_j` (repeated blocks counted repeatedly). Statistic = `num / den`.
If `den == 0` the draw is SKIPPED (counted in `n_skipped`). `n_valid = 10000 - n_skipped`.
If `n_skipped > 500` or the full-data `n = 0`, `lo` and `hi` are blank. Otherwise sort the valid values ascending `x[0..m-1]` (`m = n_valid`) and for `p = 0.025` and `0.975`:
`pos = (m - 1) * p` (double), `i = floor(pos)`, `frac = pos - i`, value = `x[i] + frac * (x[i + 1] - x[i])`; if `i + 1 > m - 1` the value is `x[i]`.
Implement this by hand in both languages (no `quantile`, no `numpy.percentile`). `lo` is the 0.025 value, `hi` the 0.975 value.
`est` = the same statistic on the full data (not the bootstrap mean); blank only when `n = 0`.
Differences between rules are formed inside the hour (`d`, `dHH`), never between intervals.

## 10. The decision rule (mechanical; `decision_inputs.csv` and `decision.csv`)

All named numbers are computed at full precision, then WRITTEN with `%.6f`. Each condition is evaluated on the WRITTEN strings turned into integers
in units of 1e-6.

### 10.1 The integer rule

`mic(s)`: remove the decimal point from the written string; read it as an integer. `"0.500000" -> 500000`, `"-0.020000" -> -20000`. A written `-0.000000` is
normalised to `0.000000` first (section 11). A blank value makes every condition that uses it FALSE (and the blank stays blank in the inputs file). There is no minimum `n`.

### 10.2 Named numbers (all from the arm L test years with `m*`, except `F_mean_d`)

- `R_mean_d`, `R_ci_lo`, `R_ci_hi`: `mean_d` of `R` (`stepb_main.csv`, arm L) and the `lo`, `hi` of interval `I01` (months).
- `half1_mean_d`, `half2_mean_d`, `eel_mean_d`, `noneel_mean_d`: `mean_d` of `R_half1`, `R_half2`, `R_eel`, `R_noneel`.
- For each cell `c` in the four LOW4 strings: `cell_<c>_rel` = `rel_mae_diff` of `R_cell_<c>`; `cell_<c>_ci_lo` = `lo` of the cell's interval (`I09` to `I12`).
- `lowered_n` = `n` of `R_lowered`; `lowered_mean_d` = its `mean_d`; `lowered_below15_diff` = `below15_rule - below15_prod` of `R_lowered` (full precision difference, then written).
- `R_below15_diff` = `below15_rule - below15_prod` of `R`; `R_above15_diff` = `above15_rule - above15_prod` of `R`.
- `hh_ci_hi` = `hi` of interval `I17` (dHH, months).
- `F_mean_d` = `mean_d` of arm F `R`.

### 10.3 The eight criteria (each 1 or 0)

1. `crit1_size` = `mic(R_mean_d) <= -250000` AND `mic(R_ci_hi) < 0`.
2. `crit2_no_harm_by_cell`: for each cell `above_margin_c` = `mic(cell_c_rel) > 20000` (a relative excess above 2%), `fail_c` = `above_margin_c` AND `mic(cell_c_ci_lo) > 0`. `crit2_no_harm_by_cell` = 1 if no cell has `fail_c`, else 0. Also `flag_unclear_cell` = 1 if some cell has `above_margin_c` and not `fail_c`, else 0. A blank `cell_c_rel` (empty cell or `mae_prod` 0) gives `above_margin_c = 0`.
3. `crit3_stable_time` = `mic(half1_mean_d) < 0` AND `mic(half2_mean_d) < 0`.
4. `crit4_stable_season` = `mic(eel_mean_d) <= 0` AND `mic(noneel_mean_d) <= 0`.
5. `crit5_lowered` = `mic(lowered_mean_d) <= 0` AND `mic(lowered_below15_diff) <= 0`. (Blank, for example no lowered hour, gives 0.)
6. `crit6_large_errors` = `mic(R_below15_diff) <= 0` AND `mic(R_above15_diff) <= 500000`.
7. `crit7_tied_to_rise` = `mic(hh_ci_hi) < 0`.
8. `crit8_timing` = `mic(F_mean_d) < 0`.

### 10.4 Flags and verdict

- `flag_not_supported` = 1 if `beats_production == 0` (section 7.2), else 0.
- `flag_fail` = 1 if (`R_ci_lo` or `R_ci_hi` is blank, or `mic(R_ci_lo) <= 0 <= mic(R_ci_hi)`) OR `mic(R_mean_d) > -100000`, else 0.
- Verdict, first hit wins:
  1. `NOT_SUPPORTED` if `flag_not_supported` = 1.
  2. else `FAIL` if `flag_fail` = 1.
  3. else `PASS` if criteria 1 to 8 are all 1 and `flag_unclear_cell` = 0.
  4. else `GAIN_WITHOUT_ONSET` if criteria 1 to 6 and 8 are 1, criterion 7 is 0, and `flag_unclear_cell` = 0.
  5. else `UNCLEAR`.

The analysts compute and write this; they state no opinion on it.

## 11. Number format and file conventions

- UTF-8 without BOM, `\n` line endings, a final newline, comma separated, no quotes, header line first.
- Decimal numbers: `%.6f` (Python `"%.6f" % x`; R `sprintf("%.6f", x)`). If the result is the string `-0.000000`, write `0.000000` (a negative zero, or a tiny negative number that rounds to zero, is written without the minus sign). Never `NA`, `NaN`, `Inf`, or exponent notation.
- Counts and 0/1 flags: plain integers (no decimal point). Missing value: the empty field.
- Text values exactly as spelled in this file.
- Row order as listed in section 12. Every listed row is written, also when its population is empty (counts 0, other values blank).
- `lo, hi, est` are written `%.6f`; `n, n_valid, n_skipped` integers; `m`-values (`m_star`, `m_best`, `m_second`) `%.6f` (e.g. `2.000000`).

## 12. Output files (identical names in `py/` and `r/`)

Percentages (`below15_*`, `above15_*`) are percent (0 to 100). Errors and `d` are percentage points.

1. `checks.csv`: `check,arm,n_checked,n_violations`. Rows: the unit tests (arm `-`: `unit_round, unit_key, unit_rule, unit_groups, unit_spell, unit_percentile, unit_boot_index`), then `C01` to `C14` each for arm `L` then arm `F` (`C01_rows_fields` L, `C01_rows_fields` F, `C02_header` L, ...), with the full check names of section 6. Written first; if any violation, the run stops after writing it and nothing else is written.
2. `row_accounting.csv`: `arm,step,condition,rows_in,rows_dropped,rows_left`. Per arm (L, then F), steps 0 to 5 as in section 2 (`read, status_not_predicted, burn_in, truth_dependent_hard, truth_out_of_range, blank_error`), `step` = 0..5. Step 0 has `rows_in = rows_left = rows read` and `rows_dropped = 0`.
3. `populations.csv`: `arm,population,n`. Per arm (L, then F), in this order: `scored, scored_design, scored_test, R_design, R_test, R_design_span_unusual, R_test_span_unusual, span_usual_value, R_test_half1, R_test_half2, R_test_eel, R_test_noneel, R_test_cell_0-3000, R_test_cell_3000-6000, R_test_cell_6000-12000, R_test_cell_12000-25000, R_test_before1008, R_test_from1008, rising_high_test, falling_low_test, blocks_months, blocks_quarters`. (`span_usual_value` = `U`; the block counts are 83 and 28.) Counts of hours in the populations of section 3; no rule involved.
4. `a1_tables.csv`: `table,split,rgroup,n,mean_signed_raw,mean_abs_raw,mean_signed_prod,mean_abs_prod,mean_signed_steady,mean_abs_steady`. Order: tables `all, corr, flowbin, spell, ageR`; within a table the levels of 7.1 in the order written there; within a level the ratio groups in order `1-1.5, 1.5-2, 2-3, 3-5, 5-10, 10+, all`. 126 rows. `table` is the table name, `split` the level name.
5. `a2_pick.csv`: `rule,role,n,mae,mean_signed,mae_rank`. Rows in this order: `production` (role `baseline`), `handover_m1.5`, `handover_m2`, `handover_m3`, `handover_m5` (role `candidate`), `half_half`, `mean_of_three`, `steady_always` (role `control`). `mae_rank` 1 to 4 for candidates, blank otherwise.
6. `mstar.csv`: `key,value`. Rows in order: `m_star, m_best, m_second, mae_best, mae_second, gap_best_second, tie_rule_used, mae_production, beats_production`. `m_best`, `m_second`: the `m` of `b1`, `b2`; `gap_best_second` = `mae_second - mae_best` (full precision, then written). `tie_rule_used`, `beats_production`: 0/1.
7. `stepb_main.csv`: `arm,rule,population,` + the MEAS columns. `rule` = `handover_mstar`. Rows: arm L populations in the order of 8.1, then arm F populations in the order of 8.1. 20 rows.
8. `stepb_rules.csv`: `rule,population,` + MEAS. `population` = `R_test`. 8 rows in the order of 8.1.
9. `both_sides.csv`: `rule,population,` + MEAS. `rule` = `both_sides`. 6 rows in the order of 8.1.
10. `step_at_25000.csv`: `key,value`. Rows in order: `n_rising_high, n_small_rise, mean_corrR_minus_corrS, n_hyp_changed, mean_abs_hyp_change_cfs, mean_abs_hyp_change_pct`.
11. `intervals.csv`: `id,arm,population,x,blocks,n,est,lo,hi,n_valid,n_skipped`. `x` = `d` or `dHH`; `blocks` = `months` or `quarters`; `n` = hours of the population; `population` named as in 8.1. Rows in this order:
    `I01` L `R` d months; `I02` L `R` d quarters; `I03` L `scored_all` d months; `I04` L `R_affected` d months; `I05` L `R_half1`; `I06` L `R_half2`; `I07` L `R_eel`; `I08` L `R_noneel`; `I09` to `I12` L `R_cell_0-3000`, `R_cell_3000-6000`, `R_cell_6000-12000`, `R_cell_12000-25000`; `I13` L `R_raised`; `I14` L `R_lowered`; `I15` L `R_before1008`; `I16` L `R_from1008` (I05 to I16 all d months);
    `I17` L `R` dHH months; `I18` L `R` dHH quarters; `I19` L `R_span_usual` d months; `I20` L `R_span_usual` d quarters;
    `I21` F `R` d months; `I22` F `R` d quarters; `I23` F `R_span_usual` d months; `I24` F `R_span_usual` d quarters.
    For `I04`, `I13`, `I14` the population is a subset selected by the rule's shown values, the same in every draw.
12. `decision_inputs.csv`: `name,value`. Rows in order: `m_star, beats_production, R_mean_d, R_ci_lo, R_ci_hi, half1_mean_d, half2_mean_d, eel_mean_d, noneel_mean_d, cell_0-3000_rel, cell_0-3000_ci_lo, cell_3000-6000_rel, cell_3000-6000_ci_lo, cell_6000-12000_rel, cell_6000-12000_ci_lo, cell_12000-25000_rel, cell_12000-25000_ci_lo, lowered_n, lowered_mean_d, lowered_below15_diff, R_below15_diff, R_above15_diff, hh_ci_hi, F_mean_d`. Values formatted as in section 11 (`beats_production`, `lowered_n` integers; `m_star` `%.6f`).
13. `decision.csv`: `item,result`. Rows in order: `crit1_size, crit2_no_harm_by_cell, crit3_stable_time, crit4_stable_season, crit5_lowered, crit6_large_errors, crit7_tied_to_rise, crit8_timing, flag_unclear_cell, flag_not_supported, flag_fail, verdict`. Results 1/0; `verdict` one of `PASS, GAIN_WITHOUT_ONSET, FAIL, NOT_SUPPORTED, UNCLEAR`.

## 13. Floating point: where the two languages can differ

- Sums of per-hour values (tens of thousands of terms): R's `sum()` may accumulate in extended precision and Python in plain doubles; the bootstrap `num` in R may be a matrix product with another order. Differences are about 1e-13 or smaller; the `%.6f` format hides them except when a value lies within about 1e-12 of a rounding boundary of the sixth decimal (rare). Sum in file order (hours) and in ascending block order (blocks) to remove even that.
- Parsing: R's `as.numeric` is not always correctly rounded for decimals of 16 or 17 significant digits (`truthFlow` and part of `thr6`, e.g. `193.20000000000002`); Python's is. A one-unit-in-the-last-place difference can in principle move a value `r` or a shown value across a boundary (a tie, a group edge, a half). Integer-valued strings and short decimals are exact in both. This is a known residual risk; the compare tool's tolerance of 0.01 absorbs it; byte-identity may not.
- Sorting for the percentile: near-equal bootstrap values may swap; the percentile values then differ by 1e-13 or less.
- The decision tests use written strings, so they cannot flip through such noise unless the written value itself differs.

## 14. Compare tool

`tools/compare_analysts.py` (standard library). After both analysts finish, from the study folder: `python3 -I tools/compare_analysts.py py r`.
It compares the 13 files of section 12 (`.csv` only; other files in the folders are ignored, a `.csv` of another name on one side only is a difference). It prints `AGREE` as the last line only when every file exists on both sides and is not empty (a file with no data row counts as empty), has the same header and the same rows in the same order, the leading key columns equal as text, every number within 0.01, and no missing-value token (`NA`, `NaN`, `inf`) occurs. A line `BYTE-IDENTICAL: yes/no` before the last line says separately whether the files are byte for byte the same. A number written with a different number of decimals on the two sides is a FORMAT difference and also gives `DIFFER`. Exit status 0 only for AGREE.
If the analysts differ: stop and find the cause; never average or pick one.

## 15. Choices the plan left open (my choice for each; for the plan's author to rule on before the analysts start)

1. **Burn-in end**: scoring starts at `2012-12-01T00:00:00.000Z` (the plan's burn-in sentence and the design-years start). The older specification used 2011-12-04T05; not used here.
2. **Hard flag, range**: literal old rules (`truthDependentHard == "1"` dropped, `truthInProdRange == "0"` dropped); a blank in either on a scored row is a stop, not a drop.
3. **Needed column blank on a scored hour** (the plan does not say): STOP (check C06). No imputation and no silent drop. `lfCap <= 0` (not blank) means the cap is not applied, as the plan says.
4. **Eel season** = all 24 UTC hours from 15 September 00:00 through 15 December 23:00, every year (same as the earlier study).
5. **Hours from 2026-10-08** = `predTs >= 2026-10-08T00:00:00.000Z`; "with and without" = `R_test` (with) and `R_before1008` (without); `R_from1008` also given.
6. **Rising spell** (A1): defined on `flowState` of all rows on the consecutive hour grid; a blank-state row, a non-rising row or a missing hour ends it; an unscored rising hour does not; counting starts at 1.
7. **Group edges**: closed at the lower end and open at the upper end in every grouping (`r`: 1.5 goes to `1.5-2`; `ageR_h = 24` to `1-7d`; `720` to `gt30d`). A blank `ageR_h` has its own level `blank`.
8. **Which table cells exist**: every ratio group is crossed with every split level, plus an `all` ratio level; one long file.
9. **`corrR > corrS` split**: strict; equal goes to `R_not_larger`.
10. **`m*` rule**: only the best two candidates are compared for the 0.02 tie rule (not every candidate within 0.02 of the best); the gap is judged on the written 6-decimal values, inclusive (`<= 0.02`). `beats_production` = the best candidate is strictly better than production on the written MAE (even when the tie rule then picks the smaller `m`, whose own MAE may be above production's).
11. **When no candidate beats production**: step B is still computed, with the `m*` given by the rule, for description; the verdict is NOT_SUPPORTED. (The plan says "reported as description only".)
12. **"Mean size of the change on affected hours"**: reported three ways: mean `abs(chg)` in cfs, mean signed `chg` in cfs, mean `abs(chg)` as percent of truth.
13. **"Mean d over all scored hours"** = (sum of `d` over R_test) / (number of scored test hours); non-R hours have `d = 0`. Interval `I03`.
14. **"15 percent or more below/above"**: `err <= -15` and `err >= 15` (inclusive), on the error in percent.
15. **Bootstrap blocks**: one fixed list for every statistic (all 83 test months, all 28 quarters; arm F the same lists); blocks without hours of a population contribute nothing; a draw with no hour of the population is skipped; more than 500 skipped gives blank bounds. No bootstrap in the design years (step A has none in the plan). The shared file has 100 columns (B at most 83).
16. **Criterion 2**: "no harm" = no cell has (relative MAE excess above 2% AND interval lower bound above 0). A cell above the margin whose interval reaches 0 sets `flag_unclear_cell`, which turns PASS and GAIN_WITHOUT_ONSET into UNCLEAR and leaves FAIL alone. The relative excess is `(mae_rule - mae_prod) / mae_prod`, threshold 0.02.
17. **Inequalities**: "not above 0" is `<= 0`; "below 0" is `< 0`; criterion 5's share part and criterion 6 use the full-precision difference of the two percentages, written, then compared as integers (criterion 6 second part `<= 0.5` points). An empty population makes its criterion 0.
18. **Criterion 5's population** = `R_lowered` (R hours whose shown value is lower under the rule); production's 15% share is taken on the same hours.
19. **FAIL**: "the interval includes 0" = `lo <= 0 <= hi` on written values; "mean d above -0.10" = `mic(mean_d) > -100000`. FAIL is tested before PASS (they cannot both hold anyway); NOT_SUPPORTED before all.
20. **Criterion 7** uses the upper bound of the interval of `dHH` (the whole interval below 0).
21. **Both sides**: falling hours use `corrF` and `rf = (-d6) / thr6` with the same weight formula; population is R plus falling hours below 25,000 cfs; point estimates only.
22. **Step at 25,000 cfs**: "small rises" at or above 25,000 cfs = scored test rising hours with `r < m*`; the step is reported as the mean `corrR - corrS` and the hypothetical change of the shown value (no error measure).
23. **Tie `d6 == thr6`**: `w = 0` is tested by equality of the parsed numbers; the formula would give the same.
24. **Self-check tolerance**: 1e-9 absolute on the percent errors; the shown-value check C09 is exact.
25. **Span sensitivity** (ruling of the plan's author): hours with `span_h != U` stay in every population; counted per arm and period; sensitivity `I19` to `I24`; the decision rule is unchanged. `U = 4` (arm L), `5` (arm F).
26. **Gaps in the plan with no rule here**: the arm F run has no step A; the quarters sensitivity is given for `R`, `dHH` and the span sensitivity only.
27. **Tool note, no action**: the replay's default `--in` is unusable, the runs always passed `--in=`; line 2 of the counts files names the original tool. Not used by the analysts.

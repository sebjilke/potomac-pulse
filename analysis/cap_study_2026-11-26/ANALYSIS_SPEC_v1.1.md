# Analysis specification: the cap study (version 1.1)

Version 1.1, 2026-11-27, written BEFORE any analyst started and before any error of any rule was computed or seen. Version 1.0 is kept as `ANALYSIS_SPEC_v1.0.md`.

Changes from version 1.0 (from the independent review; no analyst had started):
- Finding 1: compare contract, key columns and cell types (section 19).
- Finding 2: MR "has an estimate" means `rawUnc` and `corrUsed` non-blank, any status (4.3, ruling 5); two counts of C15 change (MR fall-back test 0, MR differs test 2,122); new unit cases (14.2, 14.3).
- Finding 3: the study truth is the rebuilt truth `truth(tau0)` in every error (new 2.1); new stopping check C16 (both arms); section 18 parsing bullet corrected; C07 now tests the rebuilt truth.
- Finding 4: M1 and M4 count near misses only; new information rows M1x and M4x (section 15).
- Finding 5: wording of the shifted hour set (12.3).
- Finding 6: arm F is shifted and gated the same way; condition 7 of each shifted table comes from the shifted arm F (12.3, 12.4).
- Finding 7: `timing_flag` is blank when the shift -1 value is blank (12.4).
- Finding 8: C13 asserts every non-blank `lf_discharge` is above 0.
- Finding 9: C14 asserts every `rl_large` hour has the period of its rise.
- Finding 10: the pick on exact integer counts (section 9); new columns `c_off_rising`, `n_rising`, `mean_d_sign` in `pick_design.csv`; new row `P_c_off_rising` in `decision_inputs.csv`; M5 keeps only its first half; new unit table T4.
- Finding 11: new stopping check C17_monotone (both arms); note in 8.2.
- Finding 12: wording of `mae_rel` for P (7.2).
- Finding 13: note on the `rawUnc = 5100` MR case (14.3).
- Finding 14: one sentence on step B when there is no pick (10.2).
- Consequences: `checks.csv` 60 rows, `decision_inputs.csv` 22 rows, `timing_gate.csv` 32 rows, `timing_candidates.csv` 30 and `timing_pick.csv` 72 rows always (the gate cannot fail past C16).
It turns the method of the study into exact arithmetic. Two analysts, one in Python and one in R, work from THIS FILE and the data files named in section 1 ONLY.
They cannot see each other. The aim is output files that are byte for byte identical. Every number must agree within 0.01.

**Blindness.** Do NOT read `PLAN.md`, `PLAN_v1.md`, `PLAN_AUDIT.md`, or any other file in the study folder `analysis/cap_study_2026-11-26/` except this one, nor any document or tool in the folder `analysis/onset_correction_2026-11-25/` (the only files you read there are `tools/boot_uniforms.csv` and the two shadow files named in section 1), nor the other analyst's folder.
Nothing in this file is a result or an expectation. You state no opinion on what any number means. The pick and the verdict (sections 9 and 10) are computed mechanically and written to files.

If this file is silent or unclear on a point, do not guess in your own way: make the most literal and simplest choice, and write it in your `REPORT.md` under "Judgment calls".

## 0. Environment

- Python: Python 3.14 (as installed), standard library only (no numpy, no pandas). Run every script as `python3 -I script.py`. See 7.1 on `sum()`. `-I` removes the script's folder from the import path: use one single-file script, or insert the folder in `sys.path` yourself.
- R: R 4.5.2, base R only (packages base, stats, utils; the package `tools` only for the one call `tools::sha256sum`). Run as `Rscript --vanilla r/run_all.R`. First line of the script: `Sys.setlocale("LC_COLLATE", "C")`.
- Write ONLY into your own folder inside the study folder `analysis/cap_study_2026-11-26/`: `py/` (Python) or `r/` (R). Everything else is read-only. No network. No installs.
- Read only: this file and the five input files of section 1.1.
- Do not use `round()` in either language anywhere in the rules (R rounds halves to even). The only rounding is `floor(x + 0.5)`.
- R: read each shadow file with `read.csv(header = TRUE, colClasses = <named vector: "character" for the 22 columns of section 1.2, "NULL" for all others>, quote = "", comment.char = "", na.strings = character(0), stringsAsFactors = FALSE)`, then convert numbers yourself with `as.numeric`. Use vectors, not row loops over a data frame; a loop over plain vectors of about 131,000 elements is fine. For C01 count the fields per line with `count.fields(path, sep = ",", quote = "", comment.char = "", blank.lines.skip = FALSE)` (it includes the header line, which is not counted as a data row); `read.csv` pads short rows silently. Read the two small files of 1.1 (hourly input, events) with `readLines` and split each line with `strsplit(line, ",", fixed = TRUE)` after appending one sentinel character to the line (`strsplit` drops a trailing empty field), or any equivalent way; a blank field must stay a blank field and the field count must be exact.
- Python: the `csv` module with `newline=''`. Strip a trailing `\r` if present (the files use `\n`).
- One command rebuilds all your outputs from the raw files: `python3 -I py/run_all.py` or `Rscript --vanilla r/run_all.R`, run from the study folder. Put a short `README.md` in your folder.
- Also write `REPORT.md` in your folder with the headings: `## What was run`, `## Row counts`, `## Judgment calls`, `## Deviations from the specification`, `## Checks`. No opinion on what the numbers mean.

## 1. Inputs

### 1.1 Files (paths relative to the study folder `analysis/cap_study_2026-11-26/`)

| Role | Path | Facts |
|---|---|---|
| Main run, arm L | `../onset_correction_2026-11-25/replay_L/shadow_L.csv` | 130,987 data rows, 87 columns, LF line ends. SHA-256 `dcc63931841b537a834962b9a7c60e6edfd3b72b8bd491b43af89bbba0ba5aba`, 109,952,178 bytes |
| Timing check, arm F | `../onset_correction_2026-11-25/replay_F/shadow_F.csv` | 130,987 data rows, 87 columns, same header as L. SHA-256 `7fb8072237cd21c99d196a7b2c1525f4aa850885638e4f06321617cdcf2a63a3`, 110,149,295 bytes |
| Bootstrap draws | `../onset_correction_2026-11-25/tools/boot_uniforms.csv` | 10,000 data rows, columns `u1`..`u100`, every cell a 12-digit zero-padded integer, 13,000,392 bytes. SHA-256 `71d75af9b10c1ba4d3d9492f0e07d17497a35e01d3568d9b3ed8ab8fe528d515` |
| Hourly input of the replay | `../rising-limb-travel-backtest/hourly_backtest_data_v39.csv` | 130,416 data rows, 12 columns, LF line ends, 10,133,893 bytes. SHA-256 `d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f`. Header `timestamp,por_now,por_lagged,ef_stage,lf_discharge,lf_stage,water_temp_c,monocacy,goose,broad_run,seneca,travel_time_h` |
| Rise events | `../rising-limb-travel-backtest/rising_limb_events_python_v39.csv` | 87 data rows, 47 columns, LF line ends, 24,205 bytes. SHA-256 `978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44` |

Python analyst: compute the SHA-256 of the five files (`hashlib`) and stop on a mismatch. R analyst: check the SHA-256 with `tools::sha256sum` and stop on a mismatch; also check the byte sizes. Both: check the row counts (checks C00 to C15 of section 15).

### 1.2 Columns used in the shadow files (header names exact, case sensitive; each must occur exactly once in the header)

`predTs, status, flowBin, flowState, truthFlow, truthInProdRange, truthDependentHard, errPctRaw, errPctCorr, predictedCFS, rawUnc, corrUsed, d6, span_h, lfCap, lfQ, lfSrcTs, age_lf_h, travelGFtoLF, porQ, tempC, tauTs` (22 columns).
No other column is used.

### 1.3 Parsing of the shadow files

- Text columns, compared as exact strings: `predTs, status, flowBin, flowState, truthInProdRange, truthDependentHard, lfSrcTs, tauTs, errPctRaw` (`errPctRaw` only for the blank test of section 2).
- Number columns, parsed as 64-bit floating point numbers: `truthFlow, predictedCFS, rawUnc, corrUsed, d6, span_h, lfCap, lfQ, age_lf_h, travelGFtoLF, porQ, tempC, errPctCorr` (13 columns). Python `float(s)`, R `as.numeric(s)`.
- Blank = the empty string = missing. Never turn a blank into 0.
- The files are unquoted. No field contains a comma.
- Numbers are parsed on every row of the file (also rows that are not scored), because rows `k` hours earlier are looked up (4.2).

### 1.4 Time

All times are UTC. `predTs` has the fixed form `YYYY-MM-DDTHH:00:00.000Z` (24 characters).
- **Period tests use string comparison** of `predTs` with the boundary strings given in section 3 (valid because the form is fixed-width).
- **Hour key** `K(predTs)` = `days_from_civil(Y, M, D) * 24 + HH`, all integers, with this integer algorithm (floor division on integers; Python `//`, R `%/%`):
  `y = Y - (M <= 2 ? 1 : 0); era = y // 400; yoe = y - era * 400; doy = (153 * (M + (M > 2 ? -3 : 9)) + 2) // 5 + D - 1; doe = yoe * 365 + yoe // 4 - yoe // 100 + doy; days = era * 146097 + doe - 719468`.
  No library time function is used. Test values: `K(2020-01-01T00) = 438288`, `K(2012-12-01T00) = 376200`, `K(2019-12-31T23) = 438287`, `K(2026-11-09T23) = 498407`, `K(1970-01-01T00) = 0`.
- **Seconds** `S(ts)` of a time string `YYYY-MM-DDTHH:MM:SS.mmmZ` (used for `lfSrcTs`) = `days * 86400 + HH * 3600 + MM * 60 + SS`, integer, the same `days` as above. The milliseconds are ignored (check C11 asserts they are `.000`).
- **Epoch milliseconds** of a time string (used for `tauTs` and the hourly input file, section 12) = `(days * 86400 + HH * 3600 + MM * 60 + SS) * 1000 + mmm`, integer (the hourly input form `YYYY-MM-DD HH:MM` has `SS = 0` and `mmm = 0`).
- **Month index.** Month label of an hour = `predTs[0:7]` (`YYYY-MM`). Design months: the 85 months `2012-12, 2013-01, ..., 2019-12`; design month index = `(Y * 12 + M) - (2012 * 12 + 12)`, 0 to 84. Test months: the 83 months `2020-01, ..., 2026-11`; test month index = `(Y * 12 + M) - (2020 * 12 + 1)`, 0 to 82.
- **Events file times** have the form `YYYY-MM-DD HH:MM` (16 characters, `MM` is `00` on every row used). Convert to the `predTs` form by replacing the space with `T` and appending `:00.000Z` (`2015-06-20 12:00` becomes `2015-06-20T12:00:00.000Z`). Its hour key is the `K` of the converted string.

## 2. Scored hours (one arm at a time)

Apply these conditions to the rows of the arm's file IN THIS ORDER. Each row meeting a condition is dropped; later conditions see only the rows left. Write the row accounting (`row_accounting.csv`) for each arm.

0. `read`: all data rows.
1. `status_not_predicted`: `status != "predicted"`.
2. `burn_in`: `predTs < "2012-12-01T00:00:00.000Z"`.
3. `truth_dependent_hard`: `truthDependentHard == "1"`.
4. `truth_out_of_range`: `truthInProdRange == "0"`.
5. `blank_error`: `errPctCorr == ""` or `errPctRaw == ""`.

The rows left are the SCORED hours, in file order (ascending `predTs`). A blank `truthDependentHard` or `truthInProdRange` is NOT dropped by conditions 3 and 4 (literal rule); on a scored row such a blank is a violation of check C06 and stops the study.
Rows that are not scored are still used as "the row `k` hours earlier" in section 4.

### 2.1 The study truth (new in 1.1)

After the scored hours of an arm are fixed, compute `truth(tau0)` of 12.1 for every scored hour of both arms, with `tau0` = epoch ms of the hour's `tauTs`. In EVERY error, class, table, interval and check of this study, `truth` means this rebuilt value `truth(tau0)`, never the parsed `truthFlow`. `truthFlow` is used only in check C16 (and its blank test in C06). Check C16 stops the run if `truth(tau0)` is missing or differs from `truthFlow` by more than `1e-6 * max(1.0, abs(truthFlow))`.

## 3. Periods

By `predTs` of the hour of the estimate:

| Name | Condition |
|---|---|
| design | `"2012-12-01T00:00:00.000Z" <= predTs < "2020-01-01T00:00:00.000Z"` |
| test | `predTs >= "2020-01-01T00:00:00.000Z"` (the file ends 2026-11-09T23) |
| test_half1 | test and `predTs < "2023-06-01T00:00:00.000Z"` |
| test_half2 | test and `predTs >= "2023-06-01T00:00:00.000Z"` |

Every scored hour is in design or in test (check C12). The four periods are processed in the order design, test, test_half1, test_half2.

## 4. The rules, as exact arithmetic

All arithmetic in IEEE doubles, in the order written (left to right inside an expression, parentheses as shown). Constants are written as decimal literals (`1.2`, `1.35`, `1.02`, `2.0`, ...) and parsed by the language's own parser.

### 4.1 Per-hour quantities and the shown value

For a scored hour: `L = lfCap`, `T = travelGFtoLF`, `a = age_lf_h`, `u = rawUnc - corrUsed` (the estimate before the cap), `PROD = 1.2 * L` (production's limit).
A rule gives a limit `lim`: a number or NONE (no limit). The shown value of a rule:

```
if lim is NONE:   shown = floor(u + 0.5)
else:             shown = floor(min(u, lim) + 0.5)
```

`floor(x + 0.5)` is the only rounding (halves go up; negative halves too: `-0.5` gives `0`, `-1.5` gives `-1`).
The hour is **capped** when `u > 1.2 * L` (strict). Under production `lim = PROD`.

### 4.2 The "row k hours earlier" and the fall-backs

`Row(k)` = the row of the arm's file (any row, scored or not, any status) whose hour key equals `K(predTs) - k`. It is found by key, never by position. If no row has that key, `Row(k)` is "absent" (no value). A blank field in a row is "no value".
"The rule is production for this hour" means `lim = PROD`.

### 4.3 The rules

**Baseline**
- `P`: `lim = PROD`.

**Candidates** (ten; list order exactly as written here): `F135, F150, F200, LF3, LF6, MR, UP, RIS, ICE, N`.
- `F135`: `lim = 1.35 * L`. `F150`: `lim = 1.5 * L`. `F200`: `lim = 2.0 * L`.
- `LF3`, `LF6` (`k = 3` and `k = 6`). Steps in this order, the first that applies ends the rule with `lim = PROD`:
  1. `T` or `a` blank on this hour.
  2. `Row(k)` absent.
  3. `lfCap` of `Row(k)` blank.
  4. `lfSrcTs` of `Row(k)` blank, or `lfSrcTs` of this hour blank.
  5. `e = (S(lfSrcTs of this hour) - S(lfSrcTs of Row(k))) / 3600.0` (integer difference of seconds, then one division; `e` can be fractional); `e <= 0`.

  Otherwise: `Lk = lfCap of Row(k)`; `g = L + (((L - Lk) * (T + a)) / e)`; `m = max(L, g)`; `lim = min(2.0 * L, 1.2 * m)`.
- `MR`. Steps in this order, the first that applies ends the rule with `lim = PROD`:
  1. `T` or `a` blank.
  2. `h = floor((T + a) + 0.5)` (an integer); `h <= 0`.
  3. `Row(h)` absent.
  4. `Row(h)` has no estimate: its `rawUnc` is blank or its `corrUsed` is blank (any `status`: a row with status `no_truth` or `no_por` and non-blank `rawUnc` and `corrUsed` HAS an estimate).
  5. `uh = rawUnc of Row(h) - corrUsed of Row(h)`; `uh <= 0`.

  Otherwise: `ratio = u / uh`; `lim = min(2.0, 1.2 * max(1.0, ratio)) * L`.
- `UP`. Steps in this order, the first that applies ends the rule with `lim = PROD`:
  1. `T` or `a` blank.
  2. `d6` blank or `d6 <= 0`.
  3. `span_h` blank or `span_h <= 0`.
  4. `porQ` blank.
  5. `porQ - d6 <= 0`.

  Otherwise: `p = ((d6 / (porQ - d6)) * (T + a)) / span_h`; `lim = min(2.0, 1.2 * (1.0 + p)) * L`.
- `RIS`: `lim = NONE` when `flowState == "rising"`, else `lim = PROD`.
- `ICE`: month `M = int(predTs[5:7])`; `lim = PROD` when `M` is 11, 12, 1, 2 or 3, else `lim = NONE`.
- `N`: `lim = NONE`.

**Description rules** (never picked; order exactly as written): `T110, F125, F130, F140, F175, ICE-T`.
- `T110`: `lim = 1.1 * L`. `F125`: `1.25 * L`. `F130`: `1.3 * L`. `F140`: `1.4 * L`. `F175`: `1.75 * L`.
- `ICE-T`: defined only for hours with `predTs >= "2021-05-07T00:00:00.000Z"`; on other hours it does not exist (the hour is not in any population of this rule). On a defined hour: if `tempC` is non-blank: `lim = PROD` when `tempC <= 5.0`, else `lim = NONE`; if `tempC` is blank: the `ICE` month rule.
- `P_icet_hours`: not a rule but a label. It is production restricted to the same hours as `ICE-T` (`predTs >= "2021-05-07T00:00:00.000Z"`). In every table the statistics of `ICE-T` are compared with the production figures of exactly those hours, which are the rows of `P_icet_hours`.

The rule list in table order (18 entries): `P, F135, F150, F200, LF3, LF6, MR, UP, RIS, ICE, N, T110, F125, F130, F140, F175, ICE-T, P_icet_hours`.

### 4.4 Production recomputed

Production's recomputed shown value (`lim = PROD`) must equal `predictedCFS` on every scored hour (check C09, exact number equality), and its recomputed error (with the rebuilt truth) must equal `errPctCorr` within 1e-9 (C10).

## 5. Error, classes, difference

Per hour and rule (truth = the rebuilt `truth(tau0)` of 2.1, positive on every scored hour, check C07):

```
error = ((shown - truth) / truth) * 100.0              (percent; "points" are percentage points of error)
d     = abs(error of the rule) - abs(error of P)        (negative = the rule is closer to the truth)
```

- **Badly off**: `abs(error) >= 15`. **Badly low**: `error <= -15`. **Badly high**: `error >= 15`. "Within" means neither low nor high.
- `differs` = `shown(rule) != shown(P)` (exact comparison of integer-valued doubles). Where `differs` is false, `d` is exactly 0.
- Class under a rule: `low`, `within`, `high` by the two tests above.

## 6. Populations

For one arm, one period of section 3 and one population name, the hour set is the scored hours of the arm in that period that satisfy the population condition. Hours keep file order.

**Little Falls rising**: `Row(3)` exists, its `lfCap` is non-blank, and `lfCap >= 1.02 * (lfCap of Row(3))` (the product first, then the comparison).

Populations, in this order (18):

| # | Name | Condition |
|---|---|---|
| 1 | `all` | every scored hour |
| 2 | `rising` | `flowState == "rising"` |
| 3 | `lf_rising` | Little Falls rising (above) |
| 4 | `capped` | capped (`u > 1.2 * L`) |
| 5 | `capped_rising` | capped and `flowState == "rising"` |
| 6 | `capped_notrising` | capped and `flowState != "rising"` |
| 7 | `rl_large` | the hour lies in the rising limb of a selected rise (6.1) |
| 8 | `rl_large_upstream` | as 7, and the rise is classed `upstream` |
| 9 | `rl_large_lfled` | as 7, and the rise is classed `lfled` |
| 10 | `rl_large_notclassed` | as 7, and the rise is classed `notclassed` |
| 11 to 16 | `bin_0-3000`, `bin_3000-6000`, `bin_6000-12000`, `bin_12000-25000`, `bin_25000-50000`, `bin_50000+` | `flowBin` equals that string exactly |
| 17 | `high_water` | `flowBin` is `25000-50000` or `50000+` |
| 18 | `low_water` | `flowBin` is `0-3000` |

`flowBin` takes exactly the six strings above on every scored hour (check C06).

### 6.1 The selected rises

Selected rises: the rows of the events file with `event_class == "GATE"` and `kept == "1"` (exact strings). 21 rows are expected (check C14). The rows are kept in file order.
A rise belongs to the design period when its `event_t0` string is `< "2020-01-01 00:00"`, else to the test period (string comparison on the file's form). 8 and 13 rises are expected.
An hour (scored, of the arm) is in the rising limb of a rise when `rl_start <= predTs <= rl_end` after converting `rl_start` and `rl_end` to the `predTs` form (1.4); both ends are included. The period of the hour (section 3) is the hour's own, not the rise's.
No scored hour may lie in the limbs of two selected rises (check C14).
Class of a rise, in the arm's own file: let `t0row` be the row whose hour key is the key of the converted `event_t0` (any status). If `t0row` is absent, or its `porQ` or its `lfCap` is blank: the rise is `notclassed`. Else if `porQ < 0.5 * lfCap` (the product first): `lfled`. Else `upstream`.

## 7. Measures

### 7.1 Sums

All sums run in file order over the hours of the hour set. A sum is computed as `s = 0.0`, then `s = s + x` for each term in that order. Python: an explicit loop (never `sum()`, `math.fsum` or `statistics.mean`; `sum()` is compensated since Python 3.12). R: an explicit loop, or `sum()` on a plain double vector in that order (never `mean()`, `%*%`, `crossprod`, `colSums`, `rowSums`). A mean is that sum divided by the count. Counts are exact integers. A measure over an empty hour set is blank.

### 7.2 Columns of `rule_tables.csv`

Hour set `H` = the scored hours of the arm in the period and population; for the rules `ICE-T` and `P_icet_hours` only those with `predTs >= "2021-05-07T00:00:00.000Z"`. `n = |H|`. For a rule `X` (counts over `H`; `cX_off`, `cX_low`, `cX_high` are the counts of badly off, low, high hours under `X`; `cP_off` and so on under production, in the same `H`):

| Column | Definition |
|---|---|
| `n` | `n` |
| `mae` | sum of `abs(error of X)` over `H`, divided by `n` |
| `bias` | sum of `error of X` over `H`, divided by `n` |
| `off` | `(100.0 * cX_off) / n` |
| `low` | `(100.0 * cX_low) / n` |
| `high` | `(100.0 * cX_high) / n` |
| `mean_d` | sum of `d` over `H`, divided by `n` |
| `off_diff` | `(100.0 * (cX_off - cP_off)) / n` |
| `low_diff` | `(100.0 * (cX_low - cP_low)) / n` |
| `high_diff` | `(100.0 * (cX_high - cP_high)) / n` |
| `mae_rel` | `(mae of X - mae of P) / mae of P`, with `mae of P` over the same `H`; blank when `n = 0` or `mae of P == 0` |
| `n_differ` | count of hours of `H` with `differs` true |

For `P` and `P_icet_hours`, `mean_d`, the three differences and `mae_rel` are 0, each blank when `n = 0`; `mae_rel` is also blank when `mae of P == 0`; `n_differ` is 0.
`low_diff` and `high_diff` are reported as description. Shares are percent of `n` (0 to 100); errors and `d` are percentage points.

## 8. Description: the cap against no cap (arm L only)

### 8.1 `cap_description.csv`

For each period in the order `design, test` and each group in the order `all, capped, capped_rising, capped_notrising, lf_rising, rl_large` (populations of section 6): `n`, `mean_d` of the rule `N` against `P` (the `mean_d` of `N` in `rule_tables.csv` for that period and population), and the interval `lo`, `hi` of section 13 (rows `I01` to `I12`).
`label` (computed on the WRITTEN strings of `lo` and `hi`, 10.1): `good_job` if `mic(lo) > 0`; else `harm` if `mic(hi) < 0`; else `unclear`. A blank `lo` or `hi` gives `unclear`. The columns `mean_d, lo, hi` of an empty group are blank (`n` is 0).

### 8.2 `cap_classes.csv`

For each period in the order `design, test`, on the capped hours of arm L (population `capped`): the three-by-three table of the class of the hour under `N` ("without the cap") against its class under `P` ("with the cap"). Rows in this order, `item` = `no_<class without>__cap_<class with>`: `no_low__cap_low, no_low__cap_within, no_low__cap_high, no_within__cap_low, no_within__cap_within, no_within__cap_high, no_high__cap_low, no_high__cap_within, no_high__cap_high` (classes `low`, `within`, `high`). `n` = hours in that cell; `share` = `(100.0 * n) / (number of capped hours of the period)` (blank when there are none).
Then two rows: `reach_rising_low_P` (`n` = hours of population `rising` that are badly low under `P`; `share` blank) and `reach_rising_low_P_capped` (`n` = those among them that are capped; `share` = `(100.0 * n) / (n of the row before)`, blank when that is 0).
11 rows per period, 22 in all. The cells `no_low__cap_within`, `no_low__cap_high` and `no_within__cap_high` are 0 by construction (on a capped hour `shown(N) >= shown(P)`); they are not a finding and are asserted in check C17.

## 9. Step A, design years, arm L: the pick (mechanical)

Using arm L, period `design`, on exact integer counts. Let `n_r` = the number of rising design hours (population `rising`, the same for every rule). For a rule `X`: `c_off(X)` = the count of badly-off hours among them under `X` (so `off_rising(X) = (100.0 * c_off(X)) / n_r`). `mean_d_all(X)` = `mean_d` of `X`, population `all`, computed as in 7.2 (an unrounded double). `mean_d_sign(X)` = -1, 0 or 1 by the sign of that double.
- A candidate **qualifies** if `mean_d_all(X) <= 0` (the double; an exact 0 qualifies, `1e-12` does not).
- Among the qualifiers, the **leader** is the one with the smallest `c_off` (the first in candidate list order if several are equal); `c_off(leader)` is that count.
- A qualifier is **tied** if `1000 * (c_off(X) - c_off(leader)) <= n_r` (integer arithmetic; this is "within 0.1 percentage points").
- Tie order: `F135, F150, LF6, LF3, MR, UP, RIS, F200, ICE, N`. The **first tied** candidate is the earliest tied one in that order.
- The **pick** is the first tied candidate if `c_off(first tied) < c_off(P)` (strictly); otherwise there is NO pick. If nobody qualifies there is NO pick.
- `T110` and the other description rules are never picked.

`pick_design.csv`: ten rows (candidate list order), columns `rule, tie_order, mean_d_all, off_rising, c_off_rising, n_rising, mean_d_sign, qualifies, is_leader, is_tied, is_first_tied`; `tie_order` is the position in the tie order (F135 1, F150 2, LF6 3, LF3 4, MR 5, UP 6, RIS 7, F200 8, ICE 9, N 10); `c_off_rising` is `c_off(X)`, `n_rising` is `n_r`, `mean_d_sign` is -1, 0 or 1; the last four are 0/1 (`is_leader`, `is_tied`, `is_first_tied` are 0 for a non-qualifier). `mean_d_all` and `off_rising` are written with `%.6f`.

## 10. Step B, test years: the nine conditions and the verdict

### 10.1 The integer rule

All named numbers are computed at full precision, then WRITTEN with `%.6f`. Each condition and each label is evaluated on the WRITTEN strings turned into integers in units of 1e-6 (`mic`): remove the decimal point from the written string and read it as an integer. `"0.500000"` gives 500000, `"-0.020000"` gives -20000, `"-1.000000"` gives -1000000. A written `-0.000000` is normalised to `0.000000` first (section 16). A blank value makes every condition that uses it fail. In R read the digit string with `as.numeric`, not `as.integer`. (Section 9 uses exact integer counts, and the unrounded double for `mean_d_all`, as stated there.)

### 10.2 Named numbers (`decision_inputs.csv`)

Let `X` be the pick and `P` production. All from arm L, test period, rule `X`, except `c7`. When there is no pick, every value in the rows from `pick_off_rising_design` downward is blank, and `pick` is `none`.

| Name | Value |
|---|---|
| `pick` | the rule name, or `none` |
| `n_qualifiers` | number of qualifiers (integer) |
| `leader` | the leader's rule name, or `none` when nobody qualifies |
| `leader_off_rising_design` | `off_rising(leader)`, `%.6f`; blank when nobody qualifies |
| `P_off_rising_design` | `off_rising(P)`, `%.6f` |
| `P_c_off_rising` | `c_off(P)` (integer) |
| `pick_off_rising_design` | `off_rising(X)`, `%.6f` |
| `pick_mean_d_all_design` | `mean_d_all(X)`, `%.6f` |
| `c1_off_diff_rising` | `off_diff` of `X`, period `test`, population `rising` |
| `c1_ci_lo`, `c1_ci_hi` | `lo`, `hi` of the interval of `X`, `off_diff` on `rising`, test (section 13, the row for `X` among `I13` to `I32`) |
| `c2_mean_d_all` | `mean_d` of `X`, `test`, `all` |
| `c3_high_diff_all` | `high_diff` of `X`, `test`, `all` |
| `c4_high_diff_rising` | `high_diff` of `X`, `test`, `rising` |
| `c5_n_rl` | `n` of `X`, `test`, `rl_large` (integer) |
| `c5_off_diff_rl` | `off_diff` of `X`, `test`, `rl_large` |
| `c5_rel_mae_rl` | `mae_rel` of `X`, `test`, `rl_large` |
| `c6_off_diff_half1`, `c6_off_diff_half2` | `off_diff` of `X`, periods `test_half1`, `test_half2`, population `rising` |
| `c7_off_diff_rising_F` | `off_diff` of `X`, **arm F**, period `test`, population `rising` |
| `c8_rel_mae_high` | `mae_rel` of `X`, `test`, `high_water` |
| `c9_rel_mae_low` | `mae_rel` of `X`, `test`, `low_water` |

22 rows, in the order of the table (a table row that names two items counts as two rows: `c1_ci_lo`, `c1_ci_hi`; `c6_off_diff_half1`, `c6_off_diff_half2`). The first six rows (`pick, n_qualifiers, leader, leader_off_rising_design, P_off_rising_design, P_c_off_rising`) are filled wherever they are defined; `pick_off_rising_design` and every later row are blank when there is no pick. With no pick, step B's description is the candidates' rows of `rule_tables.csv` and `I13` to `I32`; no rule is named.

### 10.3 The nine conditions (`decision.csv`; each `pass`, `fail` or `not_applicable`)

With a pick, on the written strings:
1. `cond1_rising_off`: `mic(c1_off_diff_rising) <= -1000000` AND `mic(c1_ci_hi) < 0`.
2. `cond2_overall`: `mic(c2_mean_d_all) <= 50000`.
3. `cond3_high_all`: `mic(c3_high_diff_all) <= 500000`.
4. `cond4_high_rising`: `mic(c4_high_diff_rising) <= 1500000`.
5. `cond5_large_rises`: `mic(c5_off_diff_rl) <= 0` AND `mic(c5_rel_mae_rl) <= 50000`.
6. `cond6_halves`: `mic(c6_off_diff_half1) < 0` AND `mic(c6_off_diff_half2) < 0`.
7. `cond7_timing_arm_F`: `mic(c7_off_diff_rising_F) < 0`.
8. `cond8_high_water`: `mic(c8_rel_mae_high) <= 50000`.
9. `cond9_low_water`: `mic(c9_rel_mae_low) <= 50000`.

A blank input makes its condition `fail`. With no pick, all nine are `not_applicable`.

**Verdict** (`verdict` row of `decision.csv`), first hit wins:
1. `KEEP` if there is no pick.
2. `BETTER_RULE_FOUND` if all nine conditions are `pass`.
3. `KEEP` if `c1_ci_hi` is blank or `mic(c1_ci_hi) >= 0` (the interval of the first condition includes 0 or lies above it; a blank bound counts as including 0).
4. `UNCLEAR` otherwise.

`decision.csv` rows in order: `cond1_rising_off, cond2_overall, cond3_high_all, cond4_high_rising, cond5_large_rises, cond6_halves, cond7_timing_arm_F, cond8_high_water, cond9_low_water, verdict` (10 rows; columns `item,result`).
The analysts compute and write this; they state no opinion on it.

## 11. Description: the large rises one by one (`rises_test.csv`, arm L)

For each selected rise of the TEST period (13 expected, file order) and each of the rules `P, F135, F150, F200, LF3, LF6, MR, UP, RIS, ICE, N` (that order): `n` = scored arm-L hours in the rising limb of that rise (the same for every rule), `mae` = mean of `abs(error)` of the rule over those hours (7.1; blank when `n = 0`), `lower_than_P` = 1 if `mae(rule) < mae(P)` (doubles, strict), else 0 (blank for `P` and when `n = 0`).
Columns: `event_id, event_t0, rule, n, mae, lower_than_P`. `event_t0` as written in the events file. Rows: 13 rises times 11 rules = 143 rows.
Then ten rows with `event_id` = `COUNT`, `event_t0` blank, `rule` = each candidate in list order (F135 to N), `n` = number of the 13 rises with `lower_than_P == 1` for that candidate, `mae` and `lower_than_P` blank. 153 rows in all.

## 12. Truth timing (arm L; report only)

### 12.1 Rebuilding the truth

Input: the hourly input file (1.1); it is also the source of the study truth (2.1). Parse: read the whole file as text, remove leading and trailing whitespace (so the final newline goes), split on `\n`, the first line is the header, split every line on `,` (12 fields, a blank field stays blank; check C13). Column 0 is `timestamp` (`YYYY-MM-DD HH:MM`, minutes `00`), column 4 is `lf_discharge`. For every data line with a non-blank `lf_discharge`: `map[epoch ms of timestamp] = float(lf_discharge)` (epoch ms by the integer algorithm of 1.4 with `SS = 0`; a later line with the same epoch would overwrite an earlier one; none is expected). Blank values are simply not in the map.
Constants (integers): `HOUR = 3600000`, `CENTER = 1350000`.

`truth(tau)` for an integer `tau` (epoch ms):
```
lo0 = ((tau - CENTER) // HOUR) * HOUR          (integer floor division)
cLo = lo0 + CENTER ; cHi = lo0 + HOUR + CENTER
lo = map[lo0] (or missing) ; hi = map[lo0 + HOUR] (or missing)
if lo and hi present:                         v = lo + (hi - lo) * ((tau - cLo) / HOUR)
else if lo present and (tau - cLo) <= HOUR:   v = lo
else if hi present and (cHi - tau) <= HOUR:   v = hi
else:                                         missing
```
Range check (the production range): a truth value `v` is in range when `v >= 500.0` and `v <= 500000.0`.

### 12.2 Gate

For every scored hour of arm L (design and test): `rebuilt = truth(tau0)`. The hour FAILS the gate if `rebuilt` is missing or `abs(rebuilt - truthFlow) > 1e-6 * max(1.0, abs(truthFlow))`. This is the test of check C16 (arm L), which stops the run; a run that reaches section 12 has therefore passed it, and `gate_n_failing` is 0 and `gate_passed` is 1. The rows are still written (12.4).

### 12.3 The shifted runs

For each arm (L, and F for condition 7 only) and each shift `s` in the order `-1, 1, 2` (hours): for every scored TEST hour of the arm, `tau = tau0 + s * 3600000`, `v = truth(tau)`. The scored set is the one of section 2 (built with the file's flags for the unshifted truth); no hour is added. On top of that, a shifted hour is left out when `v` is missing (`n_missing`) or `v` is outside the range of 12.1 (`n_range`, counted only when not missing). The hard flag of the tool (Checks 2 and 3) is not recomputed for the shifted truth; this is a stated limit of the timing tables. Production and the rule are scored on the same reduced hour set, and every population, including `test_half1`, `test_half2`, `high_water` and `low_water`, is intersected with it. The hours left (`n_left`) form the hour set of the shift; `truth = v` replaces the rebuilt truth. On those hours compute errors and everything below with `truth = v`:
- `timing_candidates.csv` (arm L): for each shift and each of the ten candidates (candidate list order), columns `shift, rule, n_all, mean_d_all, n_rising, off_diff_rising, n_rl, off_diff_rl, mae_rel_rl`, defined as in 7.2 on the populations `all`, `rising`, `rl_large` of the test period (`n_rl` is the `n` of `rl_large`). `shift` is written as `-1`, `1`, `2`. 30 rows.
- `timing_pick.csv`: for each shift, the same named numbers and conditions as 10.2 and 10.3 for the pick, in this order: `c1_off_diff_rising, c1_ci_lo, c1_ci_hi, c2_mean_d_all, c3_high_diff_all, c4_high_diff_rising, c5_n_rl, c5_off_diff_rl, c5_rel_mae_rl, c6_off_diff_half1, c6_off_diff_half2, c7_off_diff_rising_F, c8_rel_mae_high, c9_rel_mae_low`, then `cond1_rising_off` to `cond9_low_water`, then `verdict`. The pick is the one of section 9 (it does not change with the shift). All numbers are from the shifted arm L run, with these exceptions: `c1_ci_lo`, `c1_ci_hi` come from the interval `S01`, `S02`, `S03` (section 13); `c7_off_diff_rising_F` is the `off_diff` of the pick on the rising test hours of the SHIFTED arm F run (the same shift, arm F's own `tauTs` and left-out hours). Conditions and verdict as in 10.3 on the written strings. Columns `shift,item,value`; 24 rows per shift, 72 rows. With no pick the values are blank, the nine conditions `not_applicable`, the verdict `KEEP`.
- A shift with an empty hour set gives blank values as usual.

### 12.4 `timing_gate.csv`

Columns `key,value`. Rows in this order: `gate_n_checked` (scored hours of arm L), `gate_n_failing`, `gate_passed` (1 or 0), `gate_fail_1` to `gate_fail_10` (the `predTs` of the first ten failing hours in file order; blank when fewer), then for arm L and shift `m1`, `p1`, `p2` (meaning -1, +1, +2) the three rows `shift_<m1|p1|p2>_n_missing`, `shift_<...>_n_range`, `shift_<...>_n_left`, then the same nine rows for arm F with the prefix `shiftF_` (`shiftF_<m1|p1|p2>_n_missing`, ...), then `timing_flag` (integers except `gate_fail_*`, which are text). `timing_flag`: blank when there is no pick, or when `c1_off_diff_rising` of shift -1 is blank. Otherwise 1 if `mic(c1_off_diff_rising)` of the main decision (10.2) is `< 0` AND `mic(c1_off_diff_rising)` of shift -1 is `>= 0`, else 0. 32 rows.

## 13. Bootstrap

### 13.1 Blocks

Month blocks only. Design periods use the 85 design months (`B = 85`, columns `u1..u85`), test periods the 83 test months (`B = 83`, columns `u1..u83`), all of the same 10,000 rows. A block with no hour of a population contributes nothing. If a scored hour has a month label outside its list, check C12 counts it and the run stops.

### 13.2 Draws

`boot_uniforms.csv`: data row `r` (1..10000, file order) is draw `r`; read the cells as numbers (exact doubles, 12 digits). For `k = 1..B` the `k`-th drawn block (0-based) is `j = (n * B) // 10^12` using the cell `n` in column `uk` (Python integers; R `(n * B) %/% 1e12`, exact since `n * B < 1e14 < 2^53`). Build for each draw the counts `c_j` (how many times block `j` was drawn, 0 or more), once for `B = 85` and once for `B = 83`.

### 13.3 Statistic, interval, percentile rule

Every interval is for a MEAN over a set of hours `P` of a per-hour value `x`: `x = d` (5), or for a share difference `x = 100.0 * (ind_rule - ind_P)` where `ind` is 1 if the hour is badly off under that rule and 0 otherwise (so `x` is -100, 0 or 100). Per block `j`: `S_j` = sum of `x` over the hours of `P` in block `j` (file order), `N_j` = their count. `S_j` and `N_j` are computed once per interval row, before the draws. For a draw: `num` and `den` start at 0 and add `c_j * S_j` and `c_j * N_j` for `j = 0, 1, ..., B-1`, every `j` included (plain loop, order as stated). Statistic = `num / den`.
If `den == 0` the draw is SKIPPED (counted in `n_skipped`). `n_valid = 10000 - n_skipped`.
If `n_skipped > 500` or the full-data `n = 0`, `lo` and `hi` are blank. Otherwise sort the valid values ascending `x[0..m-1]` (`m = n_valid`) and for `p = 0.025` and `0.975`:
`pos = (m - 1) * p` (double), `i = floor(pos)`, `frac = pos - i`, value = `x[i] + frac * (x[i + 1] - x[i])`; if `i + 1 > m - 1` the value is `x[i]`.
Implement this by hand in both languages (no `quantile`, no `numpy.percentile`). `lo` is the 0.025 value, `hi` the 0.975 value.
`est` = the sum of `x` over `P` in file order divided by the count of `P` (the same number as the matching `mean_d` or `off_diff` of `rule_tables.csv`); blank when `n = 0`.
Differences between rules are formed inside the hour, never between intervals.

### 13.4 The interval rows (`intervals.csv`, arm L, 35 rows)

Columns `id, period, rule, population, x, n, est, lo, hi, n_valid, n_skipped`. `x` is the text `d`, `off_diff`, or `off_diff_shift_m1`, `off_diff_shift_p1`, `off_diff_shift_p2`. `n` = hours of the population. Rows in this order:
- `I01` to `I06`: period `design`, rule `N`, `x` = `d`, populations `all, capped, capped_rising, capped_notrising, lf_rising, rl_large` (in that order).
- `I07` to `I12`: the same for period `test`.
- `I13` to `I32`: period `test`; for each candidate in list order (F135, F150, F200, LF3, LF6, MR, UP, RIS, ICE, N) two rows: population `rising` with `x` = `off_diff`, then population `all` with `x` = `d`.
- `S01`, `S02`, `S03`: period `test`, rule = the pick (blank when there is none), population `rising`, `x` = `off_diff_shift_m1`, `off_diff_shift_p1`, `off_diff_shift_p2`: the share-difference interval of the pick on the rising hours of the shifted arm L run of 12.3 (blocks: the test months). When there is no pick, all value columns of these rows (`n` to `n_skipped`) are blank.

## 14. Unit tests on made-up numbers (run FIRST, before any input file is read; a failure stops the run)

Each is one row with `n_checked = 1` in `checks.csv` (arm `-`); `n_violations` 0 or 1 (1 if any assertion of the test fails). The rule code, the class and measure code, the pick code, the verdict code, the percentile code and the truth code must be the SAME functions the real run uses, called on the made-up inputs below (for the rule tests build the made-up table `U` in memory with the same column names and call the same lookup by hour key as in 4.2).
Tolerance: where a value is marked "(1e-9)" compare to within 1e-9; every other value exactly. A failure of any unit test stops the run: `checks.csv` is written with the unit rows only and nothing else.

1. `unit_round`: `floor(x + 0.5)`: `0.5 -> 1`, `2.4 -> 2`, `2.5 -> 3`, `-0.5 -> 0`, `-1.5 -> -1`, `8.49 -> 8`, `8.5 -> 9`.
2. `unit_key`: `K(2020-01-01T00) = 438288`, `K(2012-12-01T00) = 376200`, `K(2019-12-31T23) = 438287`, `K(2026-11-09T23) = 498407`, `K(1970-01-01T00) = 0`.
3. `unit_time`: `S("2020-12-01T11:00:36.000Z") - S("2020-12-01T08:00:00.000Z") = 10836`; epoch ms of `"2012-01-01 00:00"` is `1325376000000`; epoch ms of `"1970-01-01 00:30"` is `1800000`; epoch ms of `"2013-06-01T05:49:00.000Z"` is `1370065740000` and equals the epoch ms of `"2013-06-01 05:49"`; the events form `"2015-06-20 12:00"` converts to `"2015-06-20T12:00:00.000Z"`, whose hour key is `398556`.
4. `unit_rules`: made-up table `U` and the cases of 14.2.
5. `unit_fallbacks`: the cases of 14.3.
6. `unit_error`: see 14.4.
7. `unit_measures`: see 14.4.
8. `unit_pick`: see 14.5.
9. `unit_verdict`: see 14.5.
10. `unit_labels`: see 14.5.
11. `unit_percentile`: the rule of 13.3 on `x = 1, 2, ..., 10000` gives `250.975` (2.5th) and `9750.025` (97.5th), each within 1e-9.
12. `unit_periods`: `2019-12-31T23:00:00.000Z` is design and `2020-01-01T00:00:00.000Z` is test; `2012-11-30T23:00:00.000Z` is burn-in (dropped by condition 2) and `2012-12-01T00:00:00.000Z` is design; `2023-05-31T23:00:00.000Z` is test_half1 and `2023-06-01T00:00:00.000Z` is test_half2; design month index of `2012-12` is 0 and of `2019-12` is 84; test month index of `2020-01` is 0 and of `2026-11` is 82.
13. `unit_boot_index`: `(n * B) // 10^12`: `B = 85, n = 0 -> 0`; `B = 85, n = 999999999999 -> 84`; `B = 83, n = 0 -> 0`; `B = 83, n = 999999999999 -> 82`; `B = 7, n = 500000000000 -> 3`. This test reads one file: the first cell of the first data row of `boot_uniforms.csv` is `343638232196`, giving index `29` for `B = 85` and `28` for `B = 83`.
14. `unit_truth`: see 14.6.
15. `unit_mic`: `mic("0.500000") = 500000`, `mic("-0.020000") = -20000`, `mic("10.000000") = 10000000`, `mic("-1.000000") = -1000000`, and the written form of `-0.0000001` is `0.000000` (not `-0.000000`) with `mic = 0`.

(`unit_boot_index` is the only unit test that reads a file; it reads only the first data row of `boot_uniforms.csv`.)

### 14.1 The made-up table `U`

13 rows, `k = 0..12`, hours of 2020-12-01 (`predTs = "2020-12-01T" + two-digit k + ":00:00.000Z"`). All rows: `status = predicted`, `flowState = steady`, `travelGFtoLF = 4.5`, `age_lf_h = 1`, `tempC` blank, `d6` blank, `span_h` blank, `porQ` blank, `rawUnc = 2100`, `corrUsed = 100`. Per row:
- `lfCap` by `k`: 1000, 1000, 1000, 1000, 1050, 1100, 1200, 1250, 1300, 1350, 1400, 1450, 1500.
- `lfSrcTs` = the hour before the row (`"2020-12-01T" + two-digit (k-1) + ":00:00.000Z"`; for `k = 0` it is `"2020-11-30T23:00:00.000Z"`), EXCEPT row 6, whose `lfSrcTs` is `"2020-12-01T04:30:00.000Z"`.
- Row 12 (the "base row") in addition: `flowState = rising`, `rawUnc = 2600`, `corrUsed = 100` (so `u = 2500`), `d6 = 400`, `porQ = 2000`, `span_h = 4`.

So on the base row `L = 1500`, `u = 2500`, `T + a = 5.5`, `PROD = 1800`, `Row(3)` is row 9 (`lfCap` 1350, `lfSrcTs` 08:00, so `e = 3` for LF3), `Row(6)` is row 6 (`lfCap` 1200, `lfSrcTs` 04:30, so `e = 6.5` for LF6), and `h = floor(5.5 + 0.5) = 6`, `Row(6)` has `uh = 2000`.

### 14.2 Cases (`lim` then `shown`, for the base row unless a change is stated; "row j" means row `k = j` of `U`)

Base row:
- `P`: 1800, 1800. `F135`: 2025 (1e-9), 2025. `F150`: 2250, 2250. `F200`: 3000, 2500. `T110`: 1650 (1e-9), 1650. `F125`: 1875, 1875. `F130`: 1950, 1950. `F140`: 2100, 2100. `F175`: 2625, 2500.
- `LF3`: `g = 1500 + ((150 * 5.5) / 3) = 1775`, `lim = 2130`, shown 2130.
- `LF6`: `lim = 2104.6153846153843` (1e-9), shown 2105.
- `MR`: `ratio = 2500 / 2000 = 1.25`, `lim = 2250`, shown 2250.
- `UP`: `p = ((400 / 1600) * 5.5) / 4 = 0.34375`, `lim = 2418.75`, shown 2419.
- `RIS`: NONE, 2500. `ICE` (month 12): 1800, 1800. `N`: NONE, 2500.

Changes to the base row or to `U` (rules not named keep their base value):
- `LF3` with row 9 `lfCap = 1600`: `g = 1500 + (((-100) * 5.5) / 3)` is below `L`, so `m = L`, `lim = 1800`, shown 1800.
- `LF3` with base `lfSrcTs = "2020-12-01T11:00:36.000Z"`: `e = 10836 / 3600 = 3.01`, `lim = 2128.9036544850496` (1e-9), shown 2129.
- Ceiling 2.00 with `rawUnc = 3600` on the base row (`u = 3500`): `F200` 3000, 3000; `N` NONE, 3500; `P` 1800, 1800; `LF3` with row 9 `lfCap = 100`: `lim = 3000`, shown 3000; `LF6` with row 6 `lfCap = 100`: `lim = 3000`, shown 3000; `MR` with row 6 `rawUnc = 130` (`uh = 30`): `lim = 3000`, shown 3000; `UP` with `d6 = 1200`: `p = ((1200 / 800) * 5.5) / 4 = 2.0625`, `lim = 3000`, shown 3000.
- `MR` with `travelGFtoLF = 5.5` (so `h = floor(7.0) = 7`, row 5) and row 5 `rawUnc = 2300` (`uh = 2200`): `lim = 2045.4545454545457` (1e-9), shown 2045.
- `MR` with `travelGFtoLF = 4.0`, `age_lf_h = 0.5` (so `h = floor(5.0) = 5`, row 7) and row 7 `rawUnc = 2300`: `lim = 2045.4545454545457` (1e-9), shown 2045.
- `MR` with row 6 `status = no_truth` (rawUnc 2100, corrUsed 100 kept): the row has an estimate, `uh = 2000`, `lim = 2250`, shown 2250. The same with row 6 `status = no_por` and non-blank `rawUnc`, `corrUsed`: `lim = 2250`, shown 2250. (Status does not matter for MR.)
- Rounding half up: base row with `lfCap = 1501`, `rawUnc = 3100`, `corrUsed = 100` (`u = 3000`): `P` lim 1801.2 (1e-9) shown 1801; `F150` lim 2251.5 shown 2252; `N` NONE shown 3000. Base row with `lfCap = 1500`, `rawUnc = 1700.5`, `corrUsed = 0`: `N` shown 1701.
- `ICE` on a copy of the base row with only `predTs` changed: `2021-03-31T23:00:00.000Z`: 1800, 1800; `2021-04-01T00:00:00.000Z`: NONE, 2500; `2021-10-31T23:00:00.000Z`: NONE, 2500; `2021-11-01T00:00:00.000Z`: 1800, 1800; `2022-01-15T05:00:00.000Z`: 1800, 1800.
- `ICE-T` on a copy of the base row with `predTs` and `tempC` changed: (`2021-05-07T00:00:00.000Z`, `5`): 1800, 1800; (`2021-07-07T00:00:00.000Z`, `5.0000001`): NONE, 2500; (`2021-12-07T00:00:00.000Z`, blank): 1800, 1800 (month rule); (`2021-07-07T00:00:00.000Z`, blank): NONE, 2500; (`2021-07-07T00:00:00.000Z`, `-1`): 1800, 1800; (`2021-12-07T00:00:00.000Z`, `20`): NONE, 2500; (`2021-12-07T00:00:00.000Z`, `4.9`): 1800, 1800; a row with `predTs = 2021-05-06T23:00:00.000Z` is not defined for `ICE-T` (it is in no `ICE-T` population).

### 14.3 Fall-back cases (test `unit_fallbacks`): in every case the rule named gives `lim = 1800` and shown 1800 (production)

- Row 9 deleted from `U`: `LF3`. Row 6 deleted: `LF6` and `MR`. (A deleted row is absent: the lookup is by key, so no other row takes its place.)
- Row 9 `lfCap` blank: `LF3`.
- Row 9 `lfSrcTs = "2020-12-01T11:00:00.000Z"` (`e = 0`): `LF3`. Row 9 `lfSrcTs = "2020-12-01T12:00:00.000Z"` (`e = -1`): `LF3`.
- Row 9 `lfSrcTs` blank: `LF3`. Base `lfSrcTs` blank: `LF3` and `LF6`.
- Base `age_lf_h` blank: `LF3, LF6, MR, UP`. Base `travelGFtoLF` blank: `LF3, LF6, MR, UP`.
- `MR` with row 6 `rawUnc` blank; with row 6 `corrUsed` blank; with row 6 `rawUnc = 100, corrUsed = 100` (`uh = 0`); with row 6 `rawUnc = 100, corrUsed = 105` (`uh = -5`); with row 6 `rawUnc = 5100` (`ratio = 0.5`, so `max(1.0, ratio) = 1.0` and `lim = (1.2 * 1.0) * L = 1800`; this case is not a fall-back step and does not count in `mr_fallback`).
- `UP` with base `d6` blank; `d6 = 0`; `d6 = -50`; `span_h` blank; `span_h = 0`; `span_h = -1`; `porQ` blank; `porQ = 400` (`porQ - d6 = 0`); `porQ = 300`.
- `RIS` with base `flowState = steady`.

### 14.4 Error, class and measure tests

`unit_error`: `((850 - 1000) / 1000) * 100.0` equals `-15` exactly (badly low and badly off); `((1150 - 1000) / 1000) * 100.0` equals `15` exactly (badly high and badly off); `((17 - 20) / 20) * 100.0` equals `-15` exactly; `((1149 - 1000) / 1000) * 100.0` is within (1e-9 of 14.9); `d` with truth 1000, production shown 850 and rule shown 1100: `-5` (1e-9).
`unit_measures`: truth 1000 on four hours; production shown `850, 1000, 1160, 1000`; rule shown `1000, 1000, 1000, 1200`. Expected for the rule against production (1e-9): `n 4; mae_P 7.75; mae 5; bias_P 0.25; bias 5; off_P 50; off 25; low_P 25; low 0; high_P 25; high 25; mean_d -2.75; off_diff -25; low_diff -25; high_diff 0; mae_rel -0.3548387096774194; n_differ 3`.

### 14.5 Pick, verdict and label tests

`unit_pick`: candidates in list order with (`mean_d_all`, `c_off`), `n_r = 10000`, production count `P`. (`off_rising` = `c_off / 100`.)
- Table T1: F135 (-0.1, 1900), F150 (-0.2, 1893), F200 (-0.3, 1950), LF3 (0.5, 1000), LF6 (0.0, 1890), MR (0.0000001, 500), UP (-1.0, 1885), RIS (0.3, 500), ICE (0.0, 1894), N (1.0, 100).
  Qualifiers: F135, F150, F200, LF6, UP, ICE (6; LF6 and ICE qualify with exactly 0.0; MR does not, its `mean_d_sign` is 1). Leader UP, `c_off(leader) = 1885`. Tied (`1000 * (c_off - 1885) <= 10000`): F150, LF6, UP, ICE (F135 at 1900 gives 15000, F200 is not tied). First tied in the tie order: F150. With `P = 2000`: pick F150. With `P = 1893`: no pick (not strictly below). With `P = 1890`: no pick (the pick F150 at 1893 is not below 1890 although the leader is). With `P = 1800`: no pick.
- Table T2: every `mean_d_all` positive: nobody qualifies, no pick (`n_qualifiers = 0`).
- Table T3: only LF3 (-0.1, 1500), MR (-0.1, 1505) and UP (-0.1, 1496) qualify (the others have `mean_d_all = 1.0`), `P = 3000`: leader UP, all three tied, the first tied in the tie order is LF3: pick LF3.
- Table T4: only UP (-0.1, 1000), F135 (-0.1, 1010) and F150 (-0.1, 1011) qualify, `P = 2000`: leader UP; F135 is tied (`1000 * 10 <= 10000`, exactly on the edge), F150 is not (`11000`); first tied F135: pick F135.

`unit_verdict`: the inputs of 10.2 as written strings and the results of 10.3. Base set A: `c1_off_diff_rising -1.500000, c1_ci_lo -2.000000, c1_ci_hi -0.500000, c2_mean_d_all 0.010000, c3_high_diff_all 0.100000, c4_high_diff_rising 0.200000, c5_off_diff_rl 0.000000, c5_rel_mae_rl 0.040000, c6_off_diff_half1 -1.000000, c6_off_diff_half2 -2.000000, c7_off_diff_rising_F -0.500000, c8_rel_mae_high 0.000000, c9_rel_mae_low 0.050000`: all nine `pass`, verdict `BETTER_RULE_FOUND`.
Changes to set A, each alone: `c1_ci_hi 0.000000` gives cond1 `fail` and verdict `KEEP`; `c1_ci_lo 0.100000` with `c1_ci_hi 0.900000` gives cond1 `fail`, verdict `KEEP`; `c1_ci_hi` blank gives cond1 `fail`, verdict `KEEP`; `c1_off_diff_rising -1.000000` gives cond1 `pass`; `c1_off_diff_rising -0.999999` gives cond1 `fail`, verdict `UNCLEAR`; `c2_mean_d_all 0.050000` passes, `0.050001` fails (verdict `UNCLEAR`); `c3_high_diff_all 0.500000` passes, `0.500001` fails; `c4_high_diff_rising 1.500000` passes, `1.500001` fails; `c5_off_diff_rl 0.000001` fails; `c5_rel_mae_rl 0.050000` passes, `0.050001` fails; `c6_off_diff_half1 -0.000001` passes, `0.000000` fails (verdict `UNCLEAR`); `c7_off_diff_rising_F 0.000000` fails; `c8_rel_mae_high 0.050001` fails; `c9_rel_mae_low` blank fails. No pick: all nine `not_applicable`, verdict `KEEP`.

`unit_labels` (rule of 8.1, on written `lo`, `hi`): (`0.100000`, `0.300000`) gives `good_job`; (`-0.300000`, `-0.100000`) gives `harm`; (`-0.100000`, `0.200000`) gives `unclear`; (`0.000000`, `0.200000`) gives `unclear`; (`-0.200000`, `0.000000`) gives `unclear`; (blank, `0.200000`) gives `unclear`; (`0.000001`, `0.200000`) gives `good_job`.

### 14.6 Truth tests (`unit_truth`)

Made-up map (epoch ms of the hour start to value): `{0: 1000.0, 3600000: 2000.0, 10800000: 4000.0}`. `truth(tau)`:
- `tau = 2250000`: `lo0 = 0`, both present, `1000 + 1000 * (900000 / 3600000) = 1250`.
- `tau = 1350000`: 1000. `tau = 3150000`: 1500.
- `tau = 1349999`: `lo0 = -3600000`, only `hi` (hour start 0) present and `cHi - tau = 1`: 1000.
- `tau = 5400000`: `lo0 = 3600000`, `lo` present, `hi` (7200000) missing: 2000.
- `tau = 8551000`: `lo0 = 7200000`, `lo` missing, `hi = 4000`, `cHi - tau = 3599000 <= HOUR`: 4000.
- `tau = 18000000 + 1350000 + 5`: `lo0 = 18000000`, both missing: missing.
Range check: 500.0 in range, 499.9 out, 500000.0 in range, 500000.1 out.

## 15. Checks on the real data (after the unit tests; a mismatch stops the run and is reported, never worked around)

Per arm (L then F) for C01 to C12, written in interleaved order (`C01_rows_fields` L, `C01_rows_fields` F, `C02_header` L, ...). `n_checked` and `n_violations` are integers. Violations are counted, not just flagged.
Order of work: unit tests; then C00 (if it has a violation: write `checks.csv` with the unit rows and the C00 row and stop); then read the files, build the study truth (2.1) and the tables, and compute C01 to C17; if any of C00 to C17 has a violation, write `checks.csv` with the unit rows and every C row and stop (no other file is written); otherwise compute the M rows (never stopping), write `checks.csv` with all rows, and continue.

| Check | Arm | Tested on | Violation |
|---|---|---|---|
| `C00_inputs_sha` | `-` | the five input files (n_checked 5) | a SHA-256 or a byte size different from 1.1 (one per file) |
| `C01_rows_fields` | L, F | every data row | a row without exactly 87 fields; plus one violation if the number of rows is not 130,987 |
| `C02_header` | L, F | the 22 column names of 1.2 | a name not occurring exactly once in the header |
| `C03_predTs_form` | L, F | every row | `predTs` is not 24 characters of the form `dddd-dd-ddTdd:00:00.000Z` with month 01-12, day 01-31, hour 00-23 |
| `C04_hour_grid` | L, F | every row after the first | `K(predTs)` is not exactly the previous row's key plus 1 |
| `C05_numbers_parse` | L, F | every non-blank value in the 13 number columns of 1.3, on all rows | not matching `^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$` |
| `C06_needed_nonblank` | L, F | scored hours | a blank in any of `predictedCFS, flowBin, flowState, truthFlow, truthInProdRange, truthDependentHard, rawUnc, corrUsed, lfCap, lfQ, age_lf_h, travelGFtoLF, lfSrcTs, tauTs, errPctRaw, errPctCorr`; or `flowState` not one of `rising, steady, falling`; or `flowBin` not one of the six strings. One violation per hour |
| `C07_truth_positive` | L, F | scored hours | the rebuilt truth `truth(tau0)` is `<= 0` |
| `C08_lfcap_lfq` | L, F | scored hours | `lfCap != lfQ` (number equality) or `lfCap <= 0` |
| `C09_shown_recomputed` | L, F | scored hours | production's recomputed shown value (4.4) differs from `predictedCFS` (number equality) |
| `C10_err_corr` | L, F | scored hours | `abs(recomputed production error - errPctCorr) > 1e-9` |
| `C11_time_forms` | L, F | every non-blank `lfSrcTs` of every row, and `tauTs` of every scored hour | not matching `dddd-dd-ddTdd:dd:dd.000Z` (milliseconds exactly `.000`) with month 01-12, day 01-31, hour 00-23, minute 00-59, second 00-59 |
| `C12_blocks_cover` | L, F | scored hours | a design hour whose month label is not in the 85 design months, or a test hour whose month label is not in the 83 test months |
| `C13_hourly_file` | `-` | every data line of the hourly input (130,416) | a line without exactly 12 fields; a `timestamp` not of the form `dddd-dd-dd dd:00`; a timestamp not strictly later than the previous line's; a non-blank `lf_discharge` not matching the number pattern of C05 or not above 0; plus one violation if the number of data lines is not 130,416 or if header fields 0 and 4 are not `timestamp` and `lf_discharge` |
| `C14_events_file` | `-` | every data line of the events file (87) | a line without exactly 47 fields; a header lacking any of `event_id, event_t0, event_class, rl_start, rl_end, kept`; a selected row (6.1) with `event_t0`, `rl_start` or `rl_end` not of the form `dddd-dd-dd dd:00`; plus one violation each if the selected rows are not 21, the design rises not 8, the test rises not 13; plus one violation for every scored hour of arm L or arm F that lies in the rising limbs of two selected rises; plus one violation for every scored hour of `rl_large` (either arm) whose own period (section 3) differs from the period of its rise (6.1) |
| `C15_expected_counts` | L | the 26 counts below (n_checked 26) | a count that differs from the value given |
| `C16_truth_rebuilt` | L, F | scored hours | `truth(tau0)` (2.1) missing, or `abs(truth(tau0) - truthFlow) > 1e-6 * max(1.0, abs(truthFlow))` |
| `C17_monotone` | L, F | see below | see below |

`C15` counts, arm L, design then test (each count computed by the rules of this file; if your reading of a rule gives another number, that is a violation and the run stops: do NOT bend the rule to match):

| Count | Design | Test |
|---|---|---|
| scored hours | 59,999 | 59,448 |
| capped hours | 2,137 | 2,511 |
| rising hours | 9,272 | 9,059 |
| capped rising hours | 1,238 | 1,302 |
| Little Falls rising hours | 9,885 | 10,302 |
| Little Falls rising hours that are capped | 1,296 | 1,257 |
| hours in `rl_large` | 275 | 452 |
| selected rises | 8 | 13 |
| `rl_large` hours that are capped | 140 | 240 |
| hours with blank `d6` | 498 | 0 |
| hours with `span_h == 0` (number equality) | 593 | 81 |
| hours where `MR` falls back to production (a fall-back step of 4.3 ended the rule) | 120 | 0 |
| hours where the shown value of `MR` differs from `P` | 1,903 | 2,122 |

**C17_monotone** (arm L and arm F; evaluated after the tables of 7.2 are built, before anything is written). Let `X` run over the 15 rules `F135, F150, F200, LF3, LF6, MR, UP, RIS, ICE, N, F125, F130, F140, F175, ICE-T` (ICE-T only on its hours), that is every rule except `P`, `T110` and `P_icet_hours`. `n_checked` = (number of (scored hour, `X`) pairs) + (number of rows of `rule_tables.csv` of this arm with rule `X` in this list and `n > 0`) + 6 for arm L (the three zero cells of 8.2 in each of the two periods; 0 for arm F). Violations: (a) pairs with `shown(X) < shown(P)`; (b) pairs with `differs` true and the hour not capped; (c) table rows with `cX_low > cP_low` or `cX_high < cP_high` (counts of 7.2); (d) arm L only: each of the cells `no_low__cap_within`, `no_low__cap_high`, `no_within__cap_high` of `cap_classes.csv` with `n > 0`, per period.

**M rows (never stop the run; `M1`, `M2`, `M3`, `M4`, `M5` count near misses where a last-digit difference in parsing could change a result, section 18; `M1x` and `M4x` are exact hits, deterministic and identical in the two languages, reported as information).**
- `M1_err15_margin` (L, F): `n_checked` = the number of (scored hour, rule) pairs over the 17 rules `P, F135, F150, F200, LF3, LF6, MR, UP, RIS, ICE, N, T110, F125, F130, F140, F175, ICE-T` (ICE-T only on its hours); `n_violations` = pairs with `0 < abs(abs(error) - 15.0) < 1e-9` (near misses, not exact hits).
- `M1x_err15_exact` (L, F): information only: `n_checked` as `M1`; `n_violations` = pairs with `abs(error) == 15.0` exactly.
- `M2_cap_margin` (L, F): `n_checked` = scored hours; `n_violations` = hours with `abs(u - 1.2 * L) < 1e-9 * max(1.0, abs(u))`.
- `M3_lfrise_margin` (L, F): `n_checked` = scored hours with `Row(3)` present and its `lfCap` non-blank; `n_violations` = those with `abs(L - 1.02 * L3) < 1e-9 * max(1.0, abs(L))`.
- `M4_floor_margin` (L, F): `n_checked` as `M1`; `n_violations` = pairs where, with `v = u` (limit NONE) or `v = min(u, lim)`, `z = v + 0.5` satisfies `0 < abs(z - floor(z + 0.5)) < 1e-9` (near misses).
- `M4x_floor_exact` (L, F): information only: `n_checked` as `M1`; `n_violations` = pairs with `z == floor(z + 0.5)` exactly.
- `M5_pick_margin` (L): `n_checked` = 10 candidates; `n_violations` = candidates with `0 < abs(mean_d_all) < 1e-9` (design).
Both analysts report the M counts under "Checks" in `REPORT.md`; a DIFFER in a share column or in the pick is first explained by `M1`, `M4` and `M5`.

Total rows of `checks.csv` after a complete run: 15 unit tests + 1 (C00) + 24 (C01 to C12 times two arms) + 3 (C13 to C15) + 2 (C16) + 2 (C17) + 13 (M1, M1x, M2, M3, M4, M4x times two arms, plus M5) = 60.

## 16. Number format and file conventions

- UTF-8 without BOM, `\n` line endings, a final newline, comma separated, no quotes, header line first.
- Decimal numbers: `%.6f` (Python `"%.6f" % x`; R `sprintf("%.6f", x)`). If the result is the string `-0.000000`, write `0.000000` (a negative zero, or a tiny negative number that rounds to zero, is written without the minus sign). Never `NA`, `NaN`, `Inf`, or exponent notation.
- Counts and 0/1 flags: plain integers (no decimal point). Missing value: the empty field. R: write every integer with `sprintf("%d", x)` (x a whole number) and every decimal with `sprintf("%.6f", x)`; never through `paste`, `as.character`, `format`, `write.csv` or `cat` of a number (R writes `100000` as `1e+05` that way).
- Text values exactly as spelled in this file. Rule names, population names, period names, items, labels and verdict words are the strings written in this file.
- Row order as listed in section 17. Every listed row is written, also when its population is empty (counts 0, other values blank).
- Integer columns: `n`, `c_off_rising`, `n_rising` (also in `pick_design.csv`), `mean_d_sign`, `n_differ`, `n_valid`, `n_skipped`, `n_checked`, `n_violations`, `n_all`, `n_rising`, `n_rl`, `tie_order`, the 0/1 flags (`qualifies`, `is_leader`, `is_tied`, `is_first_tied`, `lower_than_P`), `rows_in`, `rows_dropped`, `rows_left`, `step`, `shift`; in key-value files the value is an integer where the item is a count (`n_qualifiers`, `c5_n_rl`, `gate_*` counts, `gate_passed`, `shift_*_n_*`, `timing_flag`). All other numbers are `%.6f`.

## 17. Output files (identical names in `py/` and `r/`; 14 files)

Data rows per file (header not counted): `checks.csv` 60, `row_accounting.csv` 12, `populations.csv` 76, `rule_tables.csv` 2592, `cap_description.csv` 12, `cap_classes.csv` 22, `intervals.csv` 35, `pick_design.csv` 10, `decision_inputs.csv` 22, `decision.csv` 10, `rises_test.csv` 153, `timing_gate.csv` 32, `timing_candidates.csv` 30, `timing_pick.csv` 72.

1. `checks.csv`: `check,arm,n_checked,n_violations`. Rows: the 15 unit tests (arm `-`, names `unit_round, unit_key, unit_time, unit_rules, unit_fallbacks, unit_error, unit_measures, unit_pick, unit_verdict, unit_labels, unit_percentile, unit_periods, unit_boot_index, unit_truth, unit_mic`), then `C00_inputs_sha`, then C01 to C12 (L then F for each), then `C13_hourly_file`, `C14_events_file`, `C15_expected_counts`, then `C16_truth_rebuilt` (L then F), `C17_monotone` (L then F), then `M1_err15_margin`, `M1x_err15_exact`, `M2_cap_margin`, `M3_lfrise_margin`, `M4_floor_margin`, `M4x_floor_exact` (L then F for each) and `M5_pick_margin` (L). Full names as in section 15. Written first (the M rows only after a complete run); if a check stops the run, nothing else is written (section 15).
2. `row_accounting.csv`: `arm,step,condition,rows_in,rows_dropped,rows_left`. Per arm (L, then F), steps 0 to 5 as in section 2 (`read, status_not_predicted, burn_in, truth_dependent_hard, truth_out_of_range, blank_error`), `step` = 0..5. Step 0 has `rows_in = rows_left = rows read` and `rows_dropped = 0`. 12 rows.
3. `populations.csv`: `arm,period,item,n`. Per arm (L, F), per period (`design`, `test`), items in this order (19): `scored, capped, rising, capped_rising, lf_rising, lf_rising_capped, rl_hours, rl_rises, rl_capped, d6_blank, span_zero, mr_fallback, mr_differs, up_fallback, lf3_fallback, lf6_fallback, icet_hours, icet_temp_blank, blocks`. Definitions: `lf_rising_capped` = Little Falls rising and capped; `rl_hours` = scored hours in `rl_large`; `rl_rises` = selected rises of that period (6.1); `rl_capped` = capped hours of `rl_large`; `d6_blank`, `span_zero` as in C15; `mr_fallback` as in C15; `mr_differs` = hours where `shown(MR) != shown(P)`; `up_fallback` = hours where a fall-back step of `UP` ended the rule; `lf3_fallback`, `lf6_fallback` = hours where a fall-back step of that rule ended it; `icet_hours` = scored hours with `predTs >= "2021-05-07T00:00:00.000Z"`; `icet_temp_blank` = those with blank `tempC`; `blocks` = 85 (design) or 83 (test). 76 rows.
4. `rule_tables.csv`: `arm,period,population,rule,n,mae,bias,off,low,high,mean_d,off_diff,low_diff,high_diff,mae_rel,n_differ`. Order: arm L then F; within an arm the periods `design, test, test_half1, test_half2`; within a period the 18 populations of section 6 in order; within a population the 18 rules of 4.3 in order. 2 x 4 x 18 x 18 = 2,592 rows.
5. `cap_description.csv`: `period,group,n,mean_d,lo,hi,label`. 12 rows (8.1).
6. `cap_classes.csv`: `period,item,n,share`. 22 rows (8.2).
7. `intervals.csv`: `id,period,rule,population,x,n,est,lo,hi,n_valid,n_skipped`. 35 rows (13.4).
8. `pick_design.csv`: `rule,tie_order,mean_d_all,off_rising,c_off_rising,n_rising,mean_d_sign,qualifies,is_leader,is_tied,is_first_tied`. 10 rows (section 9).
9. `decision_inputs.csv`: `name,value`. 22 rows (10.2).
10. `decision.csv`: `item,result`. 10 rows (10.3).
11. `rises_test.csv`: `event_id,event_t0,rule,n,mae,lower_than_P`. 153 rows (section 11).
12. `timing_gate.csv`: `key,value`. 32 rows (12.4).
13. `timing_candidates.csv`: `shift,rule,n_all,mean_d_all,n_rising,off_diff_rising,n_rl,off_diff_rl,mae_rel_rl`. 30 rows (12.3).
14. `timing_pick.csv`: `shift,item,value`. 72 rows (12.3).

Other notes: `cap_description.csv` and the intervals `I01` to `I12` carry the same numbers (`lo`, `hi`; `est` equals `mean_d`); `label` is derived from the written `lo`, `hi`.

## 18. Floating point: where the two languages can differ

Identical output files are the aim. Agreement of every number within 0.01 is the requirement.

- **Sums.** Section 7.1 and 13.3 fix the order of every sum (plain left-to-right loop). Python's `sum()` is compensated since Python 3.12 and R's `mean()` adds a correction pass, so neither is used. With the stated order the two languages add the same terms in the same order; the terms are identical doubles except where the parsing difference of the next bullet reaches them, which moves a sum in its last bits only.
- **Parsing.** R's `as.numeric` is not correctly rounded for long decimals. On the shadow files, R's `as.numeric` gives a different double (one unit in the last place) for `rawUnc`, `corrUsed`, `travelGFtoLF`, `errPctCorr` (about 10% of rows each) and `truthFlow` (324 rows of arm L); `lfCap, lfQ, age_lf_h, d6, span_h, porQ, tempC, predictedCFS` parse identically. The reviewer verified that the shown value of every rule is identical under both parsers on every scored hour of both arms, and that no mis-parsed truth admits an error of exactly -15 or +15. The errors of this study use the rebuilt truth (2.1), built from short decimals that both languages parse exactly with the same IEEE operations, so the errors are bit-identical in the two languages; `truthFlow` and `errPctCorr` enter only checks C16 and C10, which use tolerances. `M1`, `M2`, `M3`, `M4`, `M5` count near misses where a last-digit difference could still matter; they never stop the run. A DIFFER in a share column or in the pick is first explained by them.
- **Knife edges and operation order** (both languages must compute exactly the expressions of section 4, in that order, so that the same IEEE operations happen):
  - `1.2 * L`, `1.35 * L`, `1.5 * L`, `2.0 * L`, `1.1 * L`, `1.25 * L`, `1.3 * L`, `1.4 * L`, `1.75 * L`: one multiplication of the literal by `L`. Example: `1.35 * 1501` is `2026.3500000000001` and `1.5 * 1501` is exactly `2251.5`, whose `floor(x + 0.5)` is 2252.
  - `u > 1.2 * L`: `u = rawUnc - corrUsed` (one subtraction) against the product, strict.
  - `L >= 1.02 * L3`: the product first, then the comparison. For integer readings this is a knife edge: `1.02 * 1000` is exactly `1020` in both languages, so `L = 1020` with `L3 = 1000` is Little Falls rising; the same expression in both languages gives the same answer, so do not write it as `L / L3 >= 1.02` or `L - L3 >= 0.02 * L3`.
  - `porQ < 0.5 * lfCap`: product first.
  - `e = (integer seconds difference) / 3600.0`: one division of two exactly represented numbers; `e <= 0` is exact.
  - `g = L + (((L - Lk) * (T + a)) / e)`, then `max(L, g)`, then `1.2 * m`, then `min(2.0 * L, ...)`.
  - `h = floor((T + a) + 0.5)`: sum first, then `+ 0.5`, then floor (an integer). A value of `T + a` that is exactly a half-integer sits on the boundary and is decided by the IEEE sum.
  - `ratio = u / uh`, then `1.2 * max(1.0, ratio)`, then `min(2.0, ...)`, then `* L`.
  - `p = ((d6 / (porQ - d6)) * (T + a)) / span_h`, then `1.2 * (1.0 + p)`, then `min(2.0, ...)`, then `* L`.
  - `error = ((shown - truth) / truth) * 100.0`; `d = abs(error X) - abs(error P)`.
  - Shares: `(100.0 * count) / n`; share differences `(100.0 * (count_X - count_P)) / n` (not the difference of two shares).
  - Pick: `mean_d_all(X) <= 0` on the unrounded double; the leader, the tie window `1000 * (c_off(X) - c_off(leader)) <= n_r` and the pick test `c_off(first tied) < c_off(P)` are on exact integers.
  - Gate: `1e-6 * max(1.0, abs(truthFlow))`: `max` first, then the product.
  - Truth interpolation: `lo + (hi - lo) * ((tau - cLo) / HOUR)` with integer-valued doubles for `tau`, `cLo`, `HOUR`; `tau` and `lo0` are computed in exact integers.
  - `floor(x + 0.5)` on `min(u, lim)`; for a limit NONE on `u`.
- Sorting for the percentile: near-equal bootstrap values may swap; the percentile values then differ by 1e-13 or less, hidden by `%.6f` except at a rounding boundary.
- The decisions of section 10 are made on written strings; section 9 on integer counts plus the sign of the unrounded double `mean_d_all` (see M5).
- The study runs on one arm64 machine (R's `sum()` has no extended precision there). On another machine do not assume this.

## 19. Compare tool (contract)

`tools/compare_analysts.py` (standard library; written separately from this file). After both analysts finish, from the study folder: `python3 -I tools/compare_analysts.py py r`.
1. It looks at the 14 `.csv` files of section 17 (other files in the folders are ignored; a `.csv` of another name on one side only is a difference). A file missing on a side, empty, or with a different header is a difference. The expected header and the expected number of data rows of each file are those of section 17 (`timing_candidates.csv` 30 and `timing_pick.csv` 72, always). The key columns of each file, which must equal the expected values in the expected order, are: `checks.csv` `check,arm`; `row_accounting.csv` `arm,step,condition`; `populations.csv` `arm,period,item`; `rule_tables.csv` `arm,period,population,rule`; `cap_description.csv` `period,group`; `cap_classes.csv` `period,item`; `intervals.csv` `id,period,population,x` (and `rule` for `I01` to `I32`; for `S01` to `S03` the two sides must agree with each other and with the `pick` row of `decision_inputs.csv`); `pick_design.csv` `rule,tie_order`; `decision_inputs.csv` `name`; `decision.csv` `item`; `rises_test.csv` `event_id,event_t0,rule` (the two sides must agree; the tool does not read the events file); `timing_gate.csv` `key`; `timing_candidates.csv` `shift,rule`; `timing_pick.csv` `shift,item`. All other integer columns are data and are compared as text in step 2. A `.csv` present on both sides but not in section 17 is ignored.
2. Step 1, exact text: for each file it states whether the two files are byte for byte equal. `checks.csv`, `row_accounting.csv`, `populations.csv`, `decision_inputs.csv`, `decision.csv`, `timing_gate.csv` must be equal as text (tolerance 0), or the result is `DIFFER`.
3. Step 2, numeric fall-back for the other files: every integer and text column equal as text; every `%.6f` column within 0.01 (absolute); a number written with a different number of decimals on the two sides is a FORMAT difference; a blank on one side and a number on the other is a difference. In a key-value file and in `timing_pick.csv`, a cell is typed by its text: a cell matching `^-?[0-9]+\.[0-9]{6}$` is a decimal (tolerance 0.01), a cell matching `^-?[0-9]+$` is an integer (exact), anything else is text (exact).
4. Format guards (on both sides, any file): no leading or trailing space, no quote character in the raw bytes, no CR, no BOM, a final newline; and for every cell that is not a key or a text value, the cell is empty or matches `^-?[0-9]+(\.[0-9]{6})?$` (this excludes `NA`, `NaN`, `-nan`, `+nan`, `inf`, `Infinity`, exponent forms, a leading plus sign and, with the rule of section 16, `-0.000000`, which is checked separately as a literal string). The guards apply to numeric cells only, not to text such as `rl_large_lfled` or `2015-06-20 12:00`.
5. It prints one line per file, then `BYTE-IDENTICAL: yes` if all 14 are byte equal (else `no`), and as the last line `AGREE` only when every file passes steps 1 to 4, otherwise `DIFFER`. Exit status 0 only for AGREE. If the run stopped after `checks.csv`, the other files are missing and the result is `DIFFER`.
If the analysts differ: stop and find the cause; never average or pick one.

## 20. Rulings on the points the plan left open

Final statements. The analysts must not read the plan, the audits or the review (section 0).

1. **One run** computes everything, for arm L (main) and arm F (timing check). The pick uses arm L design-year numbers only.
2. **Rules** exactly as in 4.3, including every fall-back; the earlier row is found by the hour key of `predTs`; a missing row is "no value".
3. **Blank `age_lf_h` or `travelGFtoLF` on a scored hour:** LF3, LF6, MR and UP are production for that hour; C06 counts such hours and stops the run (none is expected).
4. **Elapsed time `e`** of LF3 and LF6 is in hours from the two `lfSrcTs` by the integer seconds algorithm; a blank `lfSrcTs` on either row gives production.
5. **MR:** "has an estimate" means `rawUnc` and `corrUsed` non-blank, any `status`; `h <= 0` or `uh <= 0` gives production.
6. **UP:** as in 4.3; a blank `porQ` gives production.
7. **ICE** uses the UTC month of `predTs`; **ICE-T** exists from `2021-05-07T00:00:00.000Z` on, uses `tempC <= 5.0` when `tempC` is non-blank and the month rule when it is blank; its statistics and those of `P_icet_hours` are computed on those hours only; in the design period `ICE-T` and `P_icet_hours` have no hours (`n` 0, other measures blank).
8. **Error** is `((shown - truth) / truth) * 100.0`; `d = abs(error rule) - abs(error P)`; badly off `abs(error) >= 15`, badly low `error <= -15`, badly high `error >= 15`; for P the shown value must equal `predictedCFS` on every scored hour.
9. **Periods** and **halves** as in section 3; populations as in section 6, including the Little Falls rising test (`lfCap >= 1.02 * lfCap` of the row 3 hours earlier, that row's `lfCap` non-blank), the large-rise hours (both ends included), the classes `upstream`, `lfled`, `notclassed`, and the six `flowBin` strings; `high_water` and `low_water` are populations of their own (`low_water` is the same hour set as `bin_0-3000`).
10. **A rise belongs to the design period** when its `event_t0` is before `2020-01-01 00:00`, else to the test period; its hours belong to the period of their own `predTs`.
11. **Tables** for every arm, period (design, test, and the two halves of the test years), population and rule, with the measures of 7.2.
12. **Shares and share differences** are `(100.0 * count) / n` and `(100.0 * (count_X - count_P)) / n`.
13. **Cap against no cap** (section 8): groups, periods, labels on the written bounds (`good_job` lower bound above 0, `harm` upper bound below 0, else `unclear`); the three-by-three table of the class without the cap (rule `N`) against the class with the cap (rule `P`) on capped hours; the reach on rising hours that are badly low under `P`.
14. **Bootstrap:** month blocks only; 85 design months and 83 test months; the interval rows of 13.4 for arm L only; shifted-truth intervals `S01` to `S03` for the pick.
15. **The pick** (section 9): qualify = mean `d` over all scored design hours `<= 0` on the unrounded double; leader = lowest badly-off count on rising design hours among qualifiers; tied = within 0.1 points of the leader (`1000 * (count difference) <= n_r`); tie order F135, F150, LF6, LF3, MR, UP, RIS, F200, ICE, N; no pick when nobody qualifies or when the pick's badly-off count on rising design hours is not strictly below production's. `T110` and the other description rules are never picked.
16. **The nine conditions and the verdict** (10.3) are evaluated on written strings (`mic`); a blank makes a condition `fail`; no pick gives `not_applicable` and `KEEP`; the verdict `KEEP` also applies when the interval of the first condition includes 0 or lies above it (a blank bound counts as including 0).
17. **Per-rise table** (section 11): test years, arm L, `P` and the ten candidates; the count of rises where a candidate's mean absolute error is strictly lower than production's.
18. **Truth** (2.1, section 12): the study truth is the truth rebuilt from the hourly input file with the replay tool's rules (hourly values placed at the hour start plus 22.5 minutes, linear interpolation, nearest neighbour when only one side exists within an hour, blanks not in the map) at `tauTs`, for every scored hour of both arms; check C16 (both arms) stops the run unless it equals `truthFlow` within `1e-6 * max(1.0, abs(truthFlow))`. Every error uses the rebuilt truth. **Truth timing:** shifts of -1, +1, +2 hours of `tauTs`, for arm L and for arm F (condition 7 of each shifted table comes from the shifted arm F); an hour whose shifted truth is missing or out of range (500 to 500,000) is left out and counted; the hard flag of the file is not recomputed.
19. **Arm F** gets the tables of ruling 11 (no bootstrap). Condition 7 uses arm F's own scored hours and its own rising test hours.
20. **Unit tests** (section 14) run first; a failure stops the run. **Checks on the real data** (section 15) after them; a mismatch stops the run and is reported.
21. **Compare tool:** exact text first for six files, numeric tolerance 0.01 for the others, key columns and cell types as in section 19.
23. **MR "has an estimate"** (ruling 5) does not depend on the status of the earlier row.
24. **The pick** is decided on exact integer counts (ruling 15 as implemented in section 9); **no pick** names no rule, and step B's description is then the candidates' rows of `rule_tables.csv` and `I13` to `I32`.
22. **Scored hours, burn-in and flags** as in section 2 (the burn-in ends at `2012-12-01T00:00:00.000Z`; a blank hard flag or range flag on a scored row stops the study).

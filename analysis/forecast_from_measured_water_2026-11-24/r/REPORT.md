# REPORT, blind R analyst (specification version 1.2)

## What was run

Command, from the study folder: `Rscript r/run_all.R`. Base R 4.5.2 only. The script runs the made-up-data and unit tests first (before any real file is read), then reads the real files and writes every output file into `r/`.
Run time of the run that wrote this file: 40 seconds.

Design requirement (section 5): the forecasts come from `forecast_fn(lfQ, qstar, qlf)`, a function whose only arguments are the issue row's `lfQ` and the two hourly flows; it has no access to the target row or the truth. `truthFlow` is read in `compute_cases` only after `forecast_fn` has returned, to build the errors. The case status needs the target row but does not enter the forecast.

## Row counts

- Period A replay rows read: 127463; window rows (issue rows): 118684 (predicted: 116348); blocks (months): 163; hourly rows: 126916.
- Period B replay rows read: 130987; window rows: 1776 (predicted: 1763); blocks (weeks): 12; hourly rows: 130416.
- Events kept (kept == 1 and event_class == GATE): 21.
- SHA-256 of the input files was not computed inside R (no base SHA-256); the row counts and status counts of section 1 were asserted. The analyst also compared the SHA-256 of all six input files with section 1 from the shell (all equal).

## Judgment calls

1. (2.1/11.3) Output of `n` for interval rows is the cell's case count; `n_valid`/`n_skipped` for an empty cell are written as 0 and 10000 as the specification says.
2. (11.7, G2) The group G2 is filled for statuses 10 to 13 only (status 8 and 9 have no complete set of source fields to use); within it `qStar`, `qLf` are blank when the hourly value does not exist. Statuses 10 to 12 also carry `uStarTs`, `uLfTs`, `inside`, `rtGL`, `ageLf` etc.
3. (11.7, G1) For statuses 8 to 13, `pLF` and `errP` are filled; for 8 and 9 the group G1 is filled too (flowBin, flowState, lrWindow, season, lfLt3000, lfQ, truth). `lfLt3000` is 1 iff `lfQ < 3000`.
4. (11.4) For `overall` the row is `overall` followed by 14 commas and the verdict (all 16 columns, only horizon and verdict filled). Where a cell used by a condition has `n = 0` or a blank bound, that condition is 0 and its inputs are blank; `cond4` is blank for h = 6, 12 and 0 (not blank) for h = 24 if its input is blank. `ADDS_NOTHING` requires a non-blank `D_hi` below 500000 (integer units of 1e-6).
5. (9.4) `D_est` is the cell's full-data statistic written with `%.6f`; `cond1` and `ADDS_NOTHING` use the written `D_lo` and `D_hi`; `cond3` compares the written signed values as integers.
6. (9.1) Period A block label is the UTC `YYYY-MM` of `predTs`; period B blocks are sorted by `w = (K %/% 24 + 3) %/% 7`.
7. (10, C9) The C9 violation count adds the replay timestamps, the hourly timestamps, the non-blank source timestamps of the predicted window rows and the event timestamps (t0, tp) of the 21 kept events; `n_checked` is the replay rows plus the hourly rows. (10, C10/C11) A violation is a key that is not strictly greater than its predecessor, or a key that failed to parse.
8. (10, C12) `Q[K(porSrcTs)] == porQ` is tested with exact double equality on the numbers parsed by `as.numeric` from the same strings; the half-unit test uses `abs(diff) <= 0.5` literally.
9. (10, C1 to C7) All case-level checks run on the four horizons and are summed; C1 to C5 on statuses 10 to 13, C6 on statuses 12 and 13, C7 on status 13.
10. (9.5) `mae_pLF` is the mean of `|errP|` over all period B cases with status 8 to 13; the stored constants are written with `%.6f`.
11. (2.2) The hour key is `as.numeric(as.POSIXct(substr(x, 1, 13), format = "%Y-%m-%dT%H", tz = "UTC")) / 3600` for the replay format and `format = "%Y-%m-%d %H:%M"` for the hourly and event format; minute 00 is asserted by regular expression in C9, not by the parser.
12. (7) A case whose issue `lfQ` is blank is in no level of `seasonLow` (the status excludes it from scoring anyway); an issue year outside 2012 to 2026 is in no `era` level (none occurs).
13. (9.2) The first cell of the first data row of `boot_uniforms.csv` was also asserted to be 192517163266 on the real file.

## Deviations from the specification

None.

## Checks

Total violations in `checks.csv`: 0. All synthetic tests, unit tests and checks C1 to C12 passed.
C12: 11 rows in A differ by exactly 0.5 between `Q[K(histSrcTs)]` and `historicPorCFS`; 11 in B.

## Period B

Built.

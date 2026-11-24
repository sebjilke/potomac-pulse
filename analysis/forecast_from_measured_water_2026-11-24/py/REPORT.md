# REPORT, blind Python analyst (specification 1.2)

## What was run

`python3 -I py/run_all.py` from the study folder (`analysis/forecast_from_measured_water_2026-11-24/`). Python standard library only. Run time of the run that wrote this file: 87 seconds.

Order inside the script: made-up-data test and unit assertions first (no real file read), then SHA-256 of every real input, then period A, then period B. Forecasts are computed by `forecast(issue_row, h, Q)`, which receives only the issue row object and the hourly dictionary `Q`; it has no access to the replay index or to any truth field of the target. The target row and `truthFlow` are looked up in `run_cases` only after the forecast tuple exists (design statement for C7).

## Row counts

- Period A: replay rows read 127463; window (issue) rows 118684; hourly rows 126916; blocks 163.
- Period B: replay rows read 130987; window (issue) rows 1776; hourly rows 130416; blocks 12.
- Events kept (`kept == 1` and `event_class == GATE`): 21.

## Judgment calls

- (2.2, 10 C9) The source timestamps tested by C9 (not counted in `n_checked`) are `histSrcTs`, `porSrcTs`, `lfSrcTs` of every window issue row (any status) where non-blank; violations add to the C9 violation count.
- (4 rules 6, 7) `truthDependentHard == 1` and `truthInProdRange == 0` are tested as the literal strings `"1"` and `"0"`; a blank value triggers neither rule. (4 rule 8) `useTimeShifted != 1` is the string test `!= "1"`.
- (4) The forecast function is evaluated for every case first (also where an earlier status rule will apply); the status is then the first rule in the order of section 4. For issue rows with `status != predicted` the forecast result is ignored.
- (10 C1 to C6) These checks are evaluated on cases whose FINAL status is 10 to 13 (C6: 12 or 13), recomputed from the stored values of the case, per section 10; the rows tested for C7 are the SCORED cases (the target row used must have key `t + h`).
- (10 C12) Where `histSrcTs` is non-blank the history comparison is made; `historicPorCFS` blank in that case counts as a violation. `porQ` equality is exact double equality of the parsed decimals.
- (11.7) `truth`, `pLF`, `errP` and the group G1 are written for every case with status 8 to 13; the group G2 for 10 to 13 (with `qStar`/`qLf` blank when the value is missing); G3 for 13 only. `refNow`/`refHeld` and their errors are blank if the source value is blank (never occurred in design).
- (9.3, 9.4) Full-data `est` of the three statistics is computed as `fsum(block differences) / n` and the means and medians with `math.fsum`; the decision-rule quantities `rising_worse_by` = mae(R-LF) - mae(P-LF) from the cell means at full precision, then written with `%.6f` and compared as integers.
- (9.3) A cell with `n > 0` and `n_skipped > 500` has blank `lo`/`hi`, `est` written, `n_valid = 10000 - n_skipped` written.
- (9.4) A blank `D_hi` never gives `ADDS_NOTHING`. If the cell used for a condition has `n = 0`, its inputs are blank and the condition is 0. `D_est`, `D_lo`, `D_hi` are blank when `n_inside = 0`. In the `overall` row every field other than `horizon` and `verdict` is blank (including `cond4_applicable`).
- (9.5) If the P-LF Q4 `n_q4` were 0 the maes would be blank and `comparable = 0`; this did not matter in practice.
- (2.2/8) The made-up data pass through the same parser: `hour(i)` strings are generated from keys by `ts_replay`/`ts_hourly` and parsed back by `parse_replay`/`parse_hourly`; the explicit-row and metric assertions of S1 are compared with an absolute tolerance of 6e-5 against the four-decimal table values.
- (8) For the S1 step rule I assert the stated differences on every scored case with `t` in the given ranges and zero elsewhere, and that `(t=78, h=12)` and `(t=66, h=24)` are not scored.
- (1) Beside the SHA-256 checks I assert the file row counts, the status counts of both replay files, the window sizes (118,684 / 116,348 predicted; 1,776 / 1,763), 163 months, 12 ISO weeks, 21 events, and the first draw of the uniforms file (192517163266); any mismatch stops the run.
- (7) The `largeRise` dimension is computed by membership of the issue hour `t` in the union of `[K(event_t0)-48, K(event_tp)]` as a set of keys; the same 21 events are used for both periods.
- (7) Cases in `flowBin` or `flowState` levels outside the listed values would be in no level of that dimension (none observed assumption; not asserted).
- (0) Output is written to `py/` only; hash verification for period B files is skipped only if they are missing (then PERIOD_B_NOT_ANSWERED).

## Deviations from the specification

none

## Checks

Total violations over all rows of `checks.csv`: 0 (all passed). See `checks.csv`.

## Period B

Built.


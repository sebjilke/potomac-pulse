# REPORT (Python analyst)

## What was run

`python3 -I py/run_all.py` from the study folder, spec version 1.2. All 23 unit tests, C00 to C08 passed; run time about 14 s. 15 CSV files written to `py/`. The Difficult Run file was present and passed its SHA-256.

## Row counts

- checks.csv: 36
- row_accounting.csv: 54
- units.csv: 225
- unit_lags.csv: 1125
- bumps.csv: 103
- class_summary.csv: 150
- fits.csv: 15
- fit_at_flows.csv: 60
- clock_grid.csv: 9
- lowwater_weeks.csv: 500
- lowwater_summary.csv: 27
- dr_units.csv: 10
- dr_summary.csv: 18
- cells.csv: 4
- decision.csv: 7

## Judgment calls

1. Unit-test series on "every integer hour" are finite arrays with missing outside; values outside the arrays in the XC test are 0.0 as the spec's rule gives.
2. Byte size is checked together with the SHA-256 for all four input files (C00, one violation per file).
3. `checks.csv`, and all other files, are written once at the end; at a stop only `checks.csv` is written.
4. `n_checked` of C07 = rows of `unit_lags.csv` with status `ok`; of C06 = 225; of C08 = 100.
5. `used_UPP_*` counts are filled after the lag run (they depend on LOW_P); C05 is evaluated before the lag run on the 50 items that have an expected value.
6. `n_both` is written (the count `cb`) for every row except a `UPP` row with LOW_P not `ok`, including rows with status `data`.
7. Bootstrap: the fit-at-flow draw values are recorded for every non-blank flow of 10.4, whether or not the flow is usable.
8. Range when LOW_P is usable but its bounds are blank and a sensitivity is switched in: bounds are the min/max over versions that have bounds (literal 12). If none has bounds, lo/hi stay blank.
9. Cells: a rising cell with fewer than 5 units still gets its range columns written when defined; `qual` is 0. A qualifying cell with a blank `app_value` would get status INSIDE (a blank makes both comparisons false); the code does this literally.
10. Low-water cell `no_phase` is tested on the week class of `median_q`.
11. M3 counts only the unit-version windows of `unit_lags.csv` (not weeks, not Difficult Run windows).
12. Parts: if a crossing time were undefined it would be treated as `no_rise` (never occurs by construction).
13. A tie in `clusters`: singleton order by (a, id) in plain codepoint (C) order.
14. `period` of a recession window is by its own start `a`.

## Deviations from the specification

None.

## Checks

```
check,n_checked,n_violations
unit_key,1,0
unit_weeks,1,0
unit_stats,1,0
unit_corr,1,0
unit_xc,1,0
unit_parabola,1,0
unit_start,1,0
unit_parts,1,0
unit_bumps,1,0
unit_thin,1,0
unit_creek,1,0
unit_theilsen,1,0
unit_circ,1,0
unit_lcg,1,0
unit_detrend,1,0
unit_days,1,0
unit_range,1,0
unit_verdict,1,0
unit_dr,1,0
unit_mic,1,0
unit_cluster,1,0
unit_draw,1,0
unit_use,1,0
C00_inputs_sha,4,0
C01_hourly_file,130416,0
C02_events_file,87,0
C03_replay_file,130987,0
C04_dr_file,130987,0
C05_row_accounting,50,0
C06_unit_sanity,225,0
C07_lag_sanity,935,0
C08_week_sanity,100,0
M1_gate_margin,1405,0
M2_creek_margin,781,0
M3_tie_margin,992,1
M4_floor,141,0
```

M rows are information only. M3 has one near-tie window (n_violations 1), reported, not acted upon.

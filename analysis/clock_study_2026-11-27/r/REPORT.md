# REPORT (R analyst, ANALYSIS_SPEC version 1.2)

## What was run
`Rscript --vanilla r/run_all.R` from the study folder, base R 4.5.2. Order: 23 unit tests, C00 (4 files, Difficult Run file present), reading, C01-C04, units/bumps/recessions/weeks/clusters, C05, lags and parts, C06-C08, low water, Difficult Run check, class summary, fits and bootstrap, clock, cells, verdict, 15 csv files. Run time about 20 s. A second full run gave byte-identical files.

## Row counts
checks 36; row_accounting 54; units 225; unit_lags 1,125; bumps 103; class_summary 150; fits 15; fit_at_flows 60; clock_grid 9; lowwater_weeks 500; lowwater_summary 27; dr_units 10 (selected units); dr_summary 18; cells 4; decision 7.

## Judgment calls
1. `M3_tie_margin` counts the unit-version windows of `unit_lags.csv` for which XC ran and at least two shifts were eligible (week phases not included).
2. `M1` includes the rows with status `ok` of `unit_lags.csv` and `lowwater_weeks.csv`; `M2` the rows with a defined share.
3. Cell range columns (`L, lo, hi, long_end, central, short_end`) are written whatever the rule yields, also when `qual` is 0 (status then `not_qualified`).
4. Section 12 bounds with switched-in versions: min/max are taken over `LOW_P` and the switched-in versions that have bounds (a version without bounds is left out).
5. A sensitivity version is switched in only if it is also usable at the flow (section 12 text), in addition to the class rule.
6. Low-water cell reason `no_phase` is tested on the class of `median_q` (`LOW_P` class phase); `chain` also covers a chain check that is undefined because the phase of `UPP` or `WHO` is undefined.
7. `n_checked` of C01-C04 is the number of data lines; violations are counted per bad line (or per bad cell for numeric columns).
8. Rise-list time columns checked in C02: `onset_t0`, `onset_tp` for small-onset rows and `event_t0`, `event_tp` for event rows.
9. A cluster id of a joined small onset is the text of the event cluster (`E<event_id>`).
10. In bootstrap draws, pairs are skipped on equal `Q`; the slope uses the matrix of differences `y_i - y_j` over `x_i - x_j` (identical double to `(y_j - y_i)/(x_j - x_i)`).
11. `n_both` of a `data` row (not the UPP/LOW_P case) is the count `cb`.
12. The data-absent branch of the Difficult Run file is implemented only as the marker rows; the run used the present file.

## Deviations from the specification
None.

## Checks
All unit tests, C00-C08 with 0 violations. M1 1,405 checked / 0; M2 781 / 0; M3 992 / 1; M4 141 / 0 (see `checks.csv`).

# Report of the Python analyst

## What was run
`python3 -I py/run_all.py` from the study folder, Python 3.14.7, standard library only. Wall-clock time about 31 s (two runs, identical output bytes for `rule_tables.csv`). All 15 unit tests passed, C00 to C17 had zero violations, so every file was written. The script was read-only on all inputs and wrote only into `py/`.

## Row counts
checks 60, row_accounting 12, populations 76, rule_tables 2592, cap_description 12, cap_classes 22, intervals 35, pick_design 10, decision_inputs 22, decision 10, rises_test 153, timing_gate 32, timing_candidates 30, timing_pick 72.

## Judgment calls
1. Shadow files are read with `csv.reader(quoting=csv.QUOTE_NONE)` streaming, keeping only the 22 columns; this is the same as splitting on commas.
2. `n_checked` values where the spec gives no number: C01/C03 = data rows, C02 = 22, C04 = rows - 1, C05 = non-blank values in the 13 number columns, C06/C07/C08/C09/C10/C12/C16 = scored hours, C11 = non-blank `lfSrcTs` of all rows + scored hours (`tauTs`), C13 = data lines of the hourly file, C14 = data lines of the events file.
3. C14 is one violation per selected-row format error, per wrong count of selected rises (total, design, test), per scored hour in two limbs, per `rl_large` hour whose period differs from its rise's, per line without 47 fields, per missing header name.
4. In `rule_tables.csv` an empty hour set gives `n` 0 and `n_differ` 0, all other values blank.
5. In `intervals.csv`, a row with an empty hour set would carry `n_valid` 0 and `n_skipped` 10000 (every draw has den 0). No such row occurred except the no-pick S rows, which are blank in all value columns as specified.
6. `timing_flag`: if the main `c1_off_diff_rising` is blank it counts as not `< 0` (flag 0).
7. `rises_test.csv`: the hours of a rise are all scored arm-L hours with `rl_start <= predTs <= rl_end` (either period).
8. Shown values are kept as doubles (`float(floor(x + 0.5))`).
9. Output files of an earlier run are deleted at the start, so a stopped run leaves only `checks.csv`.
10. The pick path (a non-empty pick) did not occur on the real data; it was exercised only by the unit tests and by a throwaway forced-pick run written outside `py/` (no crash; its output is not part of the deliverable).

## Deviations from the specification
None. (The `C15_expected_counts` row of `checks.csv` was first written with arm `-` and corrected to `L` after a check against section 15; no other cell changed.)

## Checks
All unit tests and C00 to C17: zero violations. Information rows (do not stop the run), n_checked / n_violations:
- M1_err15_margin L 1958792 / 0; F 1959067 / 0
- M1x_err15_exact L 1958792 / 90; F 1959067 / 167
- M2_cap_margin L 119447 / 0; F 119464 / 0
- M3_lfrise_margin L 119394 / 0; F 119416 / 0
- M4_floor_margin L 1958792 / 615; F 1959067 / 641
- M4x_floor_exact L 1958792 / 3360; F 1959067 / 3543
- M5_pick_margin L 10 / 0

## What was run

`cd analysis/cap_study_2026-11-26 && Rscript --vanilla r/run_all.R` (R 4.5.2, arm64). Run time about 22 s wall clock.
Order: 15 unit tests, C00 (SHA-256 and sizes of the five inputs), hourly file and events file, arm L and arm F
(C01 to C12, C16, C17, M rows, tables), C14/C15, bootstrap (85 and 83 month blocks), pick, shifted-truth runs,
decision, all 14 output files. Only the five input files of section 1.1 were read. No file of the
study folder other than ANALYSIS_SPEC.md was opened (the folder listing printed once by `ls` shows other names; none was opened).

## Row counts

checks.csv 60, row_accounting.csv 12, populations.csv 76, rule_tables.csv 2592, cap_description.csv 12,
cap_classes.csv 22, intervals.csv 35, pick_design.csv 10, decision_inputs.csv 22, decision.csv 10,
rises_test.csv 153, timing_gate.csv 32, timing_candidates.csv 30, timing_pick.csv 72.

## Judgment calls

1. `colClasses` for `read.csv` is an unnamed vector of length 87 ("character" for the 22 columns, "NULL" otherwise), same effect as the named vector of section 0.
2. C13 and C14: `n_checked` = number of data lines (130,416 and 87); every failed condition on a line counts as its own violation; a header lacking a required name counts one violation per missing name.
3. C00: one violation per file if its SHA-256 or its byte size differs.
4. C07 counts only non-missing rebuilt truths `<= 0`; a missing truth is counted by C06/C16. C12 also counts a scored hour that is in neither period.
5. C17 `n_checked`: pairs (hour, X) over the hours where X is defined (ICE-T only from 2021-05-07), plus table rows of X with n > 0 (all four periods and 18 populations), plus 6 for arm L.
6. M-row `n_checked` for M1, M1x, M4, M4x counts pairs over the 17 rules where the rule is defined.
7. Sums use `sum()` on plain double vectors in file order; checked once on 1e5 random doubles that it equals an explicit left-to-right loop on this arm64 machine.
8. Bootstrap: per draw, `num` and `den` are built by looping over blocks j in order with vector operations across the 10,000 draws (the same scalar IEEE operations in the same order per draw). For an empty population `n_valid` is 0 and `n_skipped` is 10000 and `est`, `lo`, `hi` are blank.
9. `timing_flag`: if the main `c1_off_diff_rising` is blank (cannot happen with a pick) it would give 0.
10. With no pick: `decision_inputs.csv` rows from `pick_off_rising_design` down are blank, `leader_off_rising_design` follows the leader (blank when nobody qualifies), `intervals.csv` rows S01 to S03 have a blank `rule` and blank `n` to `n_skipped`, `timing_pick.csv` values blank, conditions `not_applicable`, verdict `KEEP`, `timing_flag` blank.
11. Hourly file: lines are split on `\n` after `readLines`; a trailing empty last line is dropped; field splitting with a sentinel character so a trailing blank field is kept.
12. `rl_large` membership of an hour uses the first selected rise whose limb contains it; C14 counts any hour in two limbs.
13. Rule limits are computed on vectors with NONE represented as `Inf` (`min(u, Inf) = u`); undefined `ICE-T` hours carry NA and are excluded by the `ICE-T` hour mask.
14. C15 expected values are compared in the order scored, capped, rising, capped rising, LF rising, LF rising capped, rl_large, rises, rl capped, blank d6, span zero, MR fall-back, MR differs; design then test for each.

## Deviations from the specification

None. One label: `C15_expected_counts` was first written with arm `-` in checks.csv and corrected to `L` after a check against section 15.

## Checks

Unit tests (15), C00, C01 to C17: every n_violations is 0. M rows (never stop the run) are listed below with their counts.

```
C13_hourly_file,-,130416,0
C14_events_file,-,87,0
C15_expected_counts,L,26,0
C17_monotone,L,1720878,0
C17_monotone,F,1721113,0
M1_err15_margin,L,1958792,0
M1_err15_margin,F,1959067,0
M1x_err15_exact,L,1958792,90
M1x_err15_exact,F,1959067,167
M2_cap_margin,L,119447,0
M2_cap_margin,F,119464,0
M3_lfrise_margin,L,119394,0
M3_lfrise_margin,F,119416,0
M4_floor_margin,L,1958792,615
M4_floor_margin,F,1959067,641
M4x_floor_exact,L,1958792,3360
M4x_floor_exact,F,1959067,3543
M5_pick_margin,L,10,0
```

M1x and M4x are exact hits (information only). Full list in checks.csv.

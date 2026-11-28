# R analyst: run report

Saved by the orchestrator from the R analyst's final report (the analyst's own tool refused to write a report file; the text below is the analyst's, unchanged in substance). No interpretation of results.

## What was run
`Rscript --vanilla r/run_all.R` from `analysis/clock_build_2026-11-27/`, following `ANALYSIS_SPEC.md` version 1.2 and clarifications C1 and C2. About 15 s. Two full runs gave byte-identical files.

## Row counts
badly_low_rising 18, movement 20, groups 22, two_by_two 80, common_truth_errors 120, new_cap_yardsticks 180, new_readings 60, self_report 4, learning_health 82, checks 89, row_accounting 40.

## Judgment calls
- M03, M06, I02, I03 and the M05 total count every row with an estimate, burn-in included (3.1 "estimate hour").
- M04 and G24 are counted over the base set (C2). Before C2, M04 counted every row with an estimate and came out at 14; after C2 it is 13.
- M01 and M02 use valid common-truth hours; M07 uses the block-3 steps.
- The no-estimate step in the `movement` and `common_*` row accounting uses OLD's estimate flag.
- B01, B05, B06 and B08 count one violation per hour and file.
- In 2.3 `floor` of the double quotient is used for every `tau`.
- S16 also counts a mismatch of the learn and boot headers, and learn rows without 23 fields (all 0).
- U07 reads the first boot lines before the S08 checksum check.
- C1 is applied: period is the outer loop and metric the inner loop in blocks 2 and 3 of `learning_health.csv`.

## Deviations from the specification
None known.

## Checks
89 rows: 76 P, 13 I, 0 F. I01 design (NEW:OLD): all 3.984119:4.194531, lf_rising 8.940623:8.998875, low_water 4.730569:5.064836. I02 0, I03 0, I04 233:250, I05 0:0, M01 0, M02 26, M03 0:0, M04 13, M05 0 (P), M06 0:0, M07 0:0.

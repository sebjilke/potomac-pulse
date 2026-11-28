# Report (Python analyst)

## What was run
`python3 -I py/run_all.py`, three consecutive runs, each about 12 s. All 89 checks written; 76 P, 13 I, 0 F. Spec version 1.2 and clarification C1 (learning_health row order: period outer, metric inner) applied. Output files byte-identical across the runs.

## Row counts
badly_low_rising 18, movement 20, groups 22, two_by_two 80, common_truth_errors 120, new_cap_yardsticks 180, new_readings 60, self_report 4, learning_health 82, checks 89, row_accounting 40.

## Judgment calls
- M01/M02 and M04: base set (design and test hours). M03, M06, I02, I03: all estimate hours of 3.1 (burn-in included). M07: the steps of block 3 (design and test hours).
- G24: all estimate hours (any period).
- B03: hours where either file has an estimate. B01: one violation per hour and file.
- Y1: `Row(3)` lfCap read as text from the NEW file; blank means Y1 = Y0; Row(3) need not have an estimate.
- lf_rising: `Row(6)` needs only a non-blank lfCap, not an estimate.
- S16: boot cell form (12 digits) not checked, only row and column counts.
- Bootstrap: terms with draw count 0 or an empty block are skipped (adds 0.0, bit-identical).

## Deviations from the specification
None known.

## Checks
See `checks.csv`.

## C2
C2 applied: M04 counted over the base set (it already was); G24 moved from all estimate hours to the base set. M04 = 13. No output bytes changed.

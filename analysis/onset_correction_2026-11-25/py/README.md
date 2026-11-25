# py/ : Python implementation of ANALYSIS_SPEC.md v1.2 (SHA-256 8485759c...10d11)

Run from the study folder: `python3 -I py/run_all.py` (standard library only). Rebuilds the 13 csv files of section 12
and `REPORT.md` in this folder. Order: unit tests, input hash check, checks (writes `checks.csv`, stops on any violation
in C01-C14 or C16), then steps A and B, intervals, decision.

## Readings of the specification
- All error measures (A2 `mae`, `mean_signed`, MEAS columns) use the percent error `err`; the 0.02 tie margin is on that scale.
- `unit_boot_index` reads the first data cell of `tools/boot_uniforms.csv` before the hash check; shadow files are read after the unit tests and hash check.
- C02: header split on commas, no quote handling. C05 `n_checked` = non-blank values in the 15 number columns of scored hours.
- C07-C14 run on scored hours whose needed fields parse and pass C06 (all scored hours on clean data).
- C13 counts the `half_half` weight (0.5) as one tested weight per R hour without data.
- C14: change set of `both_sides` = R plus scored falling LOW4 hours; all other variants change R only.
- C15: a (hour, variant) pair counts once; variants = production + the 11 of C14.
- crit2: "mae_prod is 0" tested on the full-precision value. flag_fail: a blank `R_mean_d` makes its condition false.
- A ratio below 1 would fall in no ratio group (only in `all`); cannot occur after C12.
- A unit-test failure stops before any file is written.

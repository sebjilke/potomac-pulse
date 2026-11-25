# R implementation of ANALYSIS_SPEC.md v1.2

Run from the study folder: `Rscript --vanilla r/run_all.R` (base R + `tools::sha256sum`). Rebuilds the 13 csv files in `r/`. About 12 s.
Spec SHA-256 checked: 8485759c0586114eb0c6b8d37e2e83d2f4850a56518753cfb5133fc4a5b10d11. Input hashes and sizes are checked in the script.
All sums are explicit left-to-right loops (`ssum`); the bootstrap adds `c_j * S_j` for j = 1..B in order, vectorised across draws.
No REPORT.md was written (the brief asked for this README and a returned report).

## Readings of the specification
1. Unit-test harness: `ifelse` returns length 1 for a scalar test, so my first unit-test code passed scalar `d6` / `lfCap` to vectorised helpers and failed. I changed only the test inputs (repeated to full length); no rule, expectation or data changed.
2. C13: the `half_half` weight is the constant 0.5 for each scored R hour (counted, never out of range).
3. C15: the 12 variants are production plus the 11 variants of C14; `err` is the recomputed error of 4.1.
4. C16 counts one violation per scored test hour whose month label or quarter label is outside the lists.
5. C02 and C01 are computed before reading; if the header check fails the script stops before `checks.csv`.
6. Criterion 2: "mae_prod is 0" is tested on the full-precision number; an empty cell or such a cell sets `crit2 = 0` and is skipped for `flag_unclear_cell`.
7. `flag_fail`: a blank `R_mean_d` makes the `mic(R_mean_d) > -100000` part FALSE.
8. Ratio group for `r < 1` falls in `1-1.5` (cannot occur on R hours after C12).
9. `lowered_below15_diff` is blank when `R_lowered` is empty (criterion 5 is 1 then).
10. A1 `ageR` levels use the parsed number of `ageR_h`; the `spell` level of an hour is the spell age computed on all rows of the file.
11. Only the first 83 columns of `boot_uniforms.csv` are read (quarters use the first 28); the 12-digit width is checked on all 83.
12. `step_at_25000.csv`: `mean_abs_hyp_change_pct` is `abs(hyp - prod_shown) / truthFlow * 100` averaged over all small-rise hours.
13. Step B reads `m*` back from the written `mstar.csv` as the spec says.

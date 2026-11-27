# R analysis of the clock study

Run from the study folder: `Rscript --vanilla r/run_all.R` (base R 4.5.2; `tools::sha256sum` only for the checksums).

- `r/lib.R`: functions (parsing keys, series, XC, creek share, parts, Theil-Sen, circular statistics, clock).
- `r/unit_tests.R`: the 23 unit tests of section 14 of ANALYSIS_SPEC.md (version 1.2).
- `r/run_all.R`: the run (unit tests, checks C00-C08, units, lags, low water, Difficult Run, fits, clock, cells, verdict) and the 15 output csv files, written into `r/`.
- `r/REPORT.md`: what was run, row counts, judgment calls, checks.

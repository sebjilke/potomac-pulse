# Part W, R implementation (base R only)

Run from the study folder (`por_revision_and_wave_2026-11-22/`), one command, about 40 seconds:

    Rscript r_W/run_all.R

Check headers of every table against the spec lists:

    Rscript r_W/check_tables.R

Files: `lib.R` (all shared functions: grid, moving average, detrending, wave sizes, crest/trough, event days,
circular statistics, lagged correlation, bootstrap, hourly cycle), `q_W12.R` (W1, W2), `q_runs.R` (used runs,
phases, T1 of S0 logged), `q_W3.R`, `q_W456.R`, `q_W7.R`, `run_all.R`. Outputs: `tables/*.csv`, `metrics.csv`,
`REPORT.md`. Extra tables (not in the spec): `tables/series_prep.csv` (step, grid counts per prepared series),
`tables/boot_skipped.csv` (skipped resamples per interval). The run is deterministic (two runs gave identical files).

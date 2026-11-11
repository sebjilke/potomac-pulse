# metrics_R LOG (blind R metrics analyst, step 5)

## Step 1 (2026-11-11): checksums
- shasum -a 256 on the 4 tick files, event file, 2 bootstrap index files, raw CSV: ALL 8 MATCH the manifest / plan values. No file written except this log.
- Bootstrap index files have no header, 10000 rows each.

## Step 2 (2026-11-11): arm-independent assertions -> STOP
- Wrote metrics_R/rising_limb_metrics_R.R (sections: checksums, raw lag views, tau_ref truth rule, window labels from the frozen event file, per-run assertions). Run `Rscript rising_limb_metrics_R.R assert_only`.
- Wrote metrics_R/check_cache.rds (only the assertion counts, no arm values).
- Results, identical for all four runs: 130,987 ticks compared. The layout assertions pass (four arm rows per tick in order, tick-level columns identical across arm rows, base-copy columns equal the base row, in_scoring correct). has_pred == 1 on every masked row. Labels RL/RLX/REC/EW/normal: 0 mismatches. LF/PoR view values and carry: 0 mismatches. tau max abs diff 1.78e-15 h. Window columns derived from t0/tp/tend: 0 disagreements with the event file.
- One truth/mask mismatch per run, at tick 2026-11-09T12:00Z. The file has mask 1 and truth 1940 read at 2026-11-10T00:00Z, which is after the last grid tick. Under the literal reading (ASSUMPTIONS A1) this tick is tau_lf_missing and mask 0.
- Per the brief, STOP before any arm metric. No metric was computed. Outputs 2 to 4 were NOT written. Waiting for an orchestrator ruling on A1.

## Step 2b (2026-11-11): resumed under ruling D-8 (plan s.12, commit e5375a8)
- Read D-8. Added an explicit, commented override to the script: tick 2026-11-09T12:00Z is mask 0 in all four runs. The script asserts that this is the only tick where the rebuilt truth or mask differs from the file, and that the difference is exactly file mask 1 / rebuilt mask 0 / file truth tick 2026-11-10T00:00Z. Any other difference is a STOP.
- Added the D-8 assertion: no row with an RL, RLX or REC label has truth_tick_utc, truth_basehz_tick or truth_own_tick after 2026-11-09T23:00Z (checked on all arm rows). Result: 0 in all four runs.
- Removed check_cache.rds (no longer written).
- `assert_only` run: all assertions pass in all four runs. truth_mismatches 1 before the override, 0 after it. Labels 0, views 0.

## Step 3 (2026-11-11): gate metrics
- Full run `Rscript rising_limb_metrics_R.R`. Wrote metrics_R/rising_limb_metrics_R.csv (5,156 rows; four runs x the same criteria; no blank value) and metrics_R/rising_limb_metrics_R.json (nested run > criterion > arm > subset > stat [> key]; blank arm or subset = "_").
- 0 bootstrap resamples with a non-finite statistic.
- Structural cross-check: G1a n_ticks (primary) equals the sum of x3_scored_rl_ticks over the 21 kept GATE events in the frozen event file.

## Step 4 (2026-11-11): report-only
- Added section 4 to the script. Wrote metrics_R/rising_limb_report_only_R.csv (3,152 rows) and metrics_R/REPORT_ONLY_README.md (it lists the items not computed and why). ASSUMPTIONS.md updated with the readings for the gate metrics and the report-only items.
- Reran the whole script end to end. The three output files are byte-identical across reruns.

## Step 5: done. Final hashes in the hand-back report.

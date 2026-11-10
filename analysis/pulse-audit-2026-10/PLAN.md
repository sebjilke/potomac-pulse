# Post-event audit plan — the 2026-10-12→19 Potomac flood through Potomac Pulse

Purpose: trace the last major pulse (Little Falls ~1,330 → ~24,300 cfs → recession) through every
part of the app and record what went wrong or needs improvement. Descriptive post-mortem of ONE
event; no model fitting, no parameter changes, no repo edits.

## Evidence (all under pulse-audit/)
- `code/` — frozen export of commit 573d8eb (v37.21). The estimator is identical to the v37.20
  that ran during the flood (the only functional diff is the Check 3 ice gate in the anomaly block).
  `code/node_modules` is a symlink so the server functions can be imported.
- `data/usgs_iv_2026-10-05_2026-10-22.json` — USGS instantaneous values, 7 gauges (PoR 01638500,
  LF 01646500, Monocacy 01643000, Goose 01644000, Broad Run 01644280, Seneca 01645000,
  Edwards Ferry 01644148 stage-only), discharge/stage/temp. Provisional.
- `data/snapshot-2026-11-10-validation-failures.json` — the 50 newest hard-flagged validations
  (incl. all of October) with rawPredictedCFS, errorCFS, stages, predictionCreatedAt, flags.
- `data/captured_context_2026-10.json` — the 21 clean validations of 2026-10-09→19 (only surviving
  copy; source has 7-day retention), bin / metadata / forecast-counter snapshots.
- `data/snapshot-2026-11-10-gf.json` — live learning state on 2026-11-10.
- Live Supabase (read-only SELECT, project `sabbonifrduiunuebxzf`, table `potomac_observations`):
  `lf_residual_episode`, `ef_divergence_episode`, `shadow_leaderboard`, `gf_forecast_metadata`,
  `rise_event`, `validation_failure`.

## Method
1. **Hourly replay.** Re-run the real server `makeGFPrediction` (imported from the frozen code)
   for every hourly cron tick 2026-10-08T00Z → 2026-10-21T00Z, feeding it exactly what the cron
   would have had at that tick (latest USGS values at or before the tick, the rolling PoR history
   as the cron stores it, water temp). Two passes: empty bins (RAW model) and the 2026-10-15 bin
   snapshot (approximate corrected). Truth = observed LF at each prediction's own validationDue.
   Fidelity gate: replayed raw must reproduce `rawPredictedCFS` of the October hard-flag rows at
   their `predictionCreatedAt` (report the match table; the audit's replay-based findings are only
   as good as this match).
2. **Six aspect traces** (hydrology/travel time; estimator decomposition; correction + learning +
   cadence; display honesty incl. CI band, ceiling, advisories, stage; 48h forecast; ops + data
   plumbing), each producing findings with numbers and file paths.
3. **Independent verification** of every finding by a separate Opus agent that recomputes in
   Python from the raw files (different language from the JS replay), spot-checks ≥5 USGS values
   against the live API, and marks each finding CONFIRMED / CORRECTED / REFUTED / UNVERIFIABLE.
4. **Completeness critic** — what part of the app was not traced.

## Known limits (state them, do not paper over)
- Bins as they were BEFORE the flood were never captured; corrected-pass replay uses the 10-15 snapshot.
- Clean validation rows carry only the corrected estimate; raw comes from the replay.
- Per-forecast rows (48h forecast) and NWS forecasts issued during the event are gone.
- One event. Findings are observations, not estimates of general skill.

# replay_B: period B replay (2026-11-24)

Unmodified tool `analysis/replay_lag_2026-11-17/ci_backtest_harness_lag.mjs`, run unchanged on the v39 data file.
Only counts, hashes and dates are reported here; no error comparison.

- Node: v24.12.0
- `git rev-parse HEAD`: 8c88893f4ccc36cd88f42052a9f7e9c2ecc4cdd1 (tracked `PLAN.md` in this folder was already modified before the run; the replay_lag README names HEAD 81c5c78...)

## Step 1: regression (scratch folder, outside the repo)
`cd analysis/replay_lag_2026-11-17 && node ci_backtest_harness_lag.mjs --arm=L --gate=new --mode=hybrid --outdir=<scratch>/regress_L`
shadow_L.csv, learn_L.csv, bins_L.csv: SHA-256 identical to the committed files and to the replay_lag README. PASS.
(b6a917c0..., 26755398..., 1d153c0f...)

## Step 2: command (exit 0)
`cd analysis/replay_lag_2026-11-17 && node ci_backtest_harness_lag.mjs --in=/Users/sebjilke/Desktop/PotomacPulse/analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv --arm=L --gate=new --mode=hybrid --outdir=/Users/sebjilke/Desktop/PotomacPulse/analysis/forecast_from_measured_water_2026-11-24/replay_B`

## Input
- hourly_backtest_data_v39.csv: SHA-256 d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f, 130,416 data rows (130,417 lines), last row 2026-11-09 23:00.
- Header columns identical to v361's; raw header line differs only in line ending (v39 LF, v361 CRLF).

## shadow_L.csv
- 90,915,623 bytes, SHA-256 549f200645b4bb9b2a6a43ee4bee00a84903726ceefdce259f73c54bed6b0d99, 130,987 data rows
- predTs 2011-12-01T05:00:00.000Z to 2026-11-09T23:00:00.000Z
- status: predicted 128,595; no_por 1,014; no_lf 439; no_truth 939; other 0
- predTs >= 2026-08-28T00:00Z: predicted 1,763; no_truth 13

## Overlap with replay_lag shadow_L.csv (predTs <= 2026-06-16T03:00Z)
Columns predTs,status,rawFinalCFS,predictedCFS,truthFlow: 127,463 rows each side, none missing; identical: no; 8 rows differ.
First three differing predTs: 2026-06-15T20:00, 2026-06-15T21:00, 2026-06-15T22:00.

## Other files
learn_L.csv (23,688 validations), bins_L.csv, counts_L.txt, stdout.txt. Large CSVs (not for git): shadow_L.csv (~91 MB), learn_L.csv (~5 MB), bins_L.csv (~1.7 MB).

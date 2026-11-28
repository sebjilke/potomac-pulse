# replay_NEW: arm L, new gate, hybrid, due time from the measured clock (2026-11-27)

Tool: `tools/replay_clock.mjs` (copy of `analysis/onset_correction_2026-11-25/tools/replay_onset.mjs` plus `--clock=old|new`; diff `tools/replay_clock.diff`). Node v24.12.0. Date 2026-11-27.
Input: `analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv`, SHA-256 d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f.

## Commands (from `tools/`, `<repo>` = /Users/sebjilke/Desktop/PotomacPulse)
```
node replay_clock.mjs --in=<repo>/analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv --arm=L --gate=new --mode=hybrid --clock=new --outdir=<repo>/analysis/clock_build_2026-11-27/replay_NEW > <repo>/analysis/clock_build_2026-11-27/replay_NEW/stdout.txt
```
Regression (`--clock` omitted, scratch folder): shadow_L, learn_L, bins_L byte-identical to `onset_correction_2026-11-25/replay_L/` (same SHA-256 below); counts_L differs only in the command line.
A second `--clock=new` run into a scratch folder was byte-identical to this one (shadow, learn, bins, counts except the --outdir path, stdout).

## SHA-256
| File | SHA-256 | Bytes |
|---|---|---|
| replay_NEW/shadow_L.csv | e0111ffcae8ffe135921fccc5db9a26e5d49e12ef9230f43b23dab489fdb9cc3 | 113,025,453 |
| replay_NEW/learn_L.csv | cebe8e728d7ba2ec669d5b00c63479cf62d4d01c81e7dadaa7651d5fc9f29750 | 8,299,789 |
| replay_NEW/bins_L.csv | e6d95c886cd9060a4710da8294a252971b15e8f8935a7148c965b79d1b9678b1 | 2,656,268 |
| replay_NEW/counts_L.txt | ecb415ca3ccb62b1fe3068a51455eea3f2785a0711989db51b6d89e49e43eed8 | 1,200 |
| replay_NEW/stdout.txt | a7993004c3c5634e55d43c936a3ed07eeebbf3866e72802c82a3b7ba8fe5a7f1 | 379 |
| OLD shadow_L.csv (existing and regression) | dcc63931841b537a834962b9a7c60e6edfd3b72b8bd491b43af89bbba0ba5aba | 109,952,178 |
| OLD learn_L.csv | be9c95c12ebb8dbf622f6ae1859830f63326bf026fdf31078e210e16c198b3e6 | 5,197,278 |
| OLD bins_L.csv | ad2a48e19344468d5960492a3d95a5d936ead578789388b4b2fc30f331978eea | 1,658,625 |

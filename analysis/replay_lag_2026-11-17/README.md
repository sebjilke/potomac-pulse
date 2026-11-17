# Replay-lag tool: builder README (2026-11-17)

Built for `PLAN.md` (plan, "Rulings on the plan audit", "Pre-registration", owner confirmation). This README is written
by the builder. The builder computed no comparison of prediction errors between arms; every number below is a row
count, status count, hash, date or test result. Analysis (two blind analysts, auditor) comes after.

Everything lives in `analysis/replay_lag_2026-11-17/`. Nothing else in the repository was modified. The production
model is imported read-only (`netlify/functions/scheduled-update.js` `_test.makeGFPrediction`;
`netlify/functions/shared/model.js` `updateCorrectionBin`, `classifyOutlier`, `isIcePlausible`, ...).

## Environment

- Node: v24.12.0
- Repository HEAD (`git rev-parse HEAD`): 81c5c781f766b1eeaa7b43e68201eebec895cd95 (the working tree has no changes outside this folder; `git status --short` shows only `?? analysis/replay_lag_2026-11-17/`)
- Data: `analysis/hourly_backtest_data_v361.csv`, SHA-256 `b247c0be5f8c3c15a64a4c2e58b0bfb1097711c6f2da3c98b767fbea1e6941d3`, 126,916 rows, 2011-12-01 05:00 to 2026-06-16 03:00 UTC. Hash re-checked after every run: unchanged. (The file is mode 644; I did not chmod it, because that would touch an existing file outside my scope. Nobody wrote to it.)

## Generating commands (run from this folder)

| Output | Command |
|---|---|
| `baseline/ci_residuals_v361_multi.csv`, `baseline/stdout_multi.txt` | `node ../ci_backtest_harness.mjs --mode=multi --out=baseline/ci_residuals_v361_multi.csv > baseline/stdout_multi.txt` (UNMODIFIED tool; it has an `--out` option, so no copy was needed) |
| `baseline/ci_residuals_v361_single.csv`, `baseline/stdout_single.txt` | the same with `--mode=single` |
| `shadow_<arm>.csv`, `learn_<arm>.csv`, `bins_<arm>.csv`, `counts_<arm>.txt` for arm F, L, F0, L0 | `node ci_backtest_harness_lag.mjs --arm=<arm> --gate=new --mode=hybrid` |
| the same with suffix `_gateold` (appendix, arms F and L) | `node ci_backtest_harness_lag.mjs --arm=<arm> --gate=old --mode=hybrid` |
| `switch_2015-01-01.csv`, `counts_switch_2015-01-01.txt` (likewise 2019-01-01 and 2023-01-01) | `node ci_backtest_harness_lag.mjs --arm=L --gate=new --mode=hybrid --switch=2015-01-01T00:00Z --until=2015-03-02T00:00Z` (until = switch + 60 days) |
| `months.csv`, `bootstrap_indices.csv` | `node make_bootstrap_indices.mjs shadow_F.csv .` |
| all of the above except the baseline | `./run_all.sh` |
| regression test | `./regress.sh` (exit non-zero on any difference) |
| determinism test | `./determinism.sh` (every configuration run twice into scratch folders, every output compared by SHA-256) |
| self-test | `node selftest.mjs` |

`run_all.log` holds the console lines of the last `run_all.sh`, `determinism.log` the result of the last determinism run.
`ci_backtest_harness_lag.mjs` options: `--arm=orig|F|L|F0|L0`, `--gate=old|new`, `--mode=multi|single|hybrid`,
`--in=`, `--out=` (orig only), `--outdir=` (default: this folder), `--switch=`, `--until=`. Defaults (`--arm=orig --gate=old --mode=multi`) make it a drop-in for the original tool.

## Test results

- Regression: `--arm=orig --gate=old`, mode multi and mode single, reproduce `baseline/ci_residuals_v361_*.csv` byte for byte (SHA-256 equal), and the console summary from line 2 on is identical. PASS.
  The baseline itself is the frozen output of today's unmodified tool (ruling 1): multi 110,548 rows, single 21,477 rows.
- Determinism: 32 output files (9 configurations plus the two original modes, every file of every run) are identical across two independent runs. PASS. (The `command:` line inside `counts_*.txt` carries the scratch `--outdir`, so it is excluded from that comparison.)
- Self-test: 51 checks on synthetic data, all PASS (lag operator across a gap, missing lagged value and ages, 48 h window, lag tables of all four arms, interpolation with two, one and no neighbour, tau rule, history assertion, hybrid slot logic, switch, `--until`, determinism, the old and new gates).
- Per-step assertion in the real runs: on every model call the newest Point of Rocks value passed equals the last history entry, and its timestamp equals the source row of that input. A violation throws and stops the run; none occurred.

## Output files: sizes, row counts, SHA-256

Data rows exclude the header. `shadow_*` rows are all simulated hours (status column), so they exceed the 126,916 CSV rows: the replay steps the full hourly clock from the first to the last CSV hour, including hours with no CSV row, and ends predictions at the last CSV hour.

| file | bytes | data rows | SHA-256 |
|---|---:|---:|---|
| baseline/ci_residuals_v361_multi.csv | 10786630 | 110548 | 9f970983f21fbc519847864f05c278aa06e169be5e8158c467f69fddb6a96545 |
| baseline/ci_residuals_v361_single.csv | 2117772 | 21477 | e265dbd245b5ef8e35cee3b7e1f52814e9e16b425624b6a3c78ff39e81b48d56 |
| shadow_F.csv | 88563074 | 127463 | 1de92d2e360400c238f8e6373e66651acefd7d8d4ca922c81860b622a49812e0 |
| shadow_L.csv | 88393649 | 127463 | b6a917c0a7092d36594a7ee1de44f05df6ad1d70626eefe6aba2fb2e23011e1d |
| shadow_F0.csv | 88996136 | 127463 | 84e151bc38cfb4ab2371b9a59b212792acdc5c812426e3292be2d5ec722bdd25 |
| shadow_L0.csv | 88821522 | 127463 | 87f3132f532df7ce76643430fdb1b22bc344f11135ea686181a097df6ba526fc |
| shadow_F_gateold.csv | 88531929 | 127463 | c364a2029c4b5aaf72e87c237663f639921d942d09bfdf8abafb5c6a6d74b97c |
| shadow_L_gateold.csv | 88361273 | 127463 | b673d67b1c7485e54b802b4d88038addb88477e7f13ba4cbb83dec3376370626 |
| learn_F.csv | 5126472 | 23343 | f334a307114cdbc2f6842bc75d140e7922371bb3780e850220a8871d89584074 |
| learn_L.csv | 5121897 | 23333 | 267553980849171848f5cc562cd11c954bc5be6c989782409c2c14ce3c01c7bf |
| learn_F0.csv | 5180050 | 23370 | ef13e38ddcd452452c53cef17e782d6d67637273596b68e9f016792311ff3b68 |
| learn_L0.csv | 5175443 | 23363 | 37a18cf721ffafb6fc35fd1a80f830e9d925140c7df84bb3dcb2eafb1ce4df71 |
| learn_F_gateold.csv | 5110475 | 23343 | 9028b5c747f0db68dbc57d5bc7b958a0adb50561f5499b0580f9e8e48ffec9ea |
| learn_L_gateold.csv | 5105170 | 23333 | af81b78ed2e20e5e18598abad4bf3ae1e3177ad200ef3ca9adc893cca49a3610 |
| bins_F.csv | 1636887 | 23307 | d359b7cc7f279644a12e74de4a93bed466dc3dcfd2b435077e7375338601f914 |
| bins_L.csv | 1634468 | 23296 | 1d153c0f0ba5a77301e4d069faac4592f0af2d1a3e6aad2956b830eb1e1ae15a |
| bins_F0.csv | 1663538 | 23335 | 85aaaf5fa516c020278a210124f6421ff0764ecad94029651b3bf42d5ef6f4d8 |
| bins_L0.csv | 1661476 | 23326 | 1175304180b37a27fa9a52e559f5c3954f62d00b52fad97ce4b8d9ffdb4077af |
| bins_F_gateold.csv | 1520175 | 21633 | 63555875b1b149c6e7f07c41fde2a87a351e7a476f88414483744bbf0df86cd4 |
| bins_L_gateold.csv | 1510447 | 21513 | 1741c93d580c392c2a8f9d013494fd5873221f8edfd112f6bd9a5888482afdbc |
| switch_2015-01-01.csv | 825566 | 1441 | 2ae51fc07ed07416cccec4e575ec0781817bd667c924620470450b15996ef2ed |
| switch_2019-01-01.csv | 1005032 | 1441 | 2030cdd5d9fc11566d97f5ed220bb9e76b0b75019557eb2417e099a7746525d8 |
| switch_2023-01-01.csv | 1015685 | 1441 | 60ac0add162b11ce67b40aa368ea3900dfcf3fbdb523f04b79c8c26f64a1464b |
| months.csv | 1406 | 175 | 2ea3bcded61fbf270ceed21dd888839b97d4d74a29ccc0564bcc91868928c12d |
| bootstrap_indices.csv | 14049663 | 10000 | b5caa071d47b0e4d57cd908569ad4fbd0faf7a850287e3b45db79eb49c58f4b1 |
| counts_F.txt | 990 | (text) | 0575c2e571c8ed2a7a8a34760bbfdd7ab92a32423602115c90197777f4f453c6 |
| counts_F0.txt | 992 | (text) | 4881e8f9cdc296423e0f7306854f34908e3990b83f9b357fa4e64f5979f69870 |
| counts_F_gateold.txt | 1068 | (text) | 0ae4136e96db9f0b93b4f90137d7c393bc247f522b500ebafff876fa5242d7a5 |
| counts_L.txt | 991 | (text) | 56c06d3d509e2536069acc7c126cba5372b931173bd6b0beef1808821e9e2854 |
| counts_L0.txt | 992 | (text) | 330c6c2527c461c998162b373702fc02ec7913e430df897b166d37559ad868ab |
| counts_L_gateold.txt | 1069 | (text) | b09d0398d0be762f3174d5a52d42e664a7d734da7210beb39d1124daaff534d2 |
| counts_switch_2015-01-01.txt | 1261 | (text) | abb096b052b3741c07fa7538f867ed53c096bcab5d019a6e716eabf7c6038996 |
| counts_switch_2019-01-01.txt | 1246 | (text) | 721737e2dadc2fb952177237cf54a4eadf5bb4a2859fcfc757ee39d0a730cdd1 |
| counts_switch_2023-01-01.txt | 1235 | (text) | 39d8b28b2fbbac7143abc8ad4ea1bbdf4c32ad71b2b66fe6902d1ab1c4b2a5ac |
| baseline/stdout_multi.txt | 870 | (text) | cbc9f818689e5deee2587aa5c4867886ace7aef3f5481b96eeaf30d9c7f98595 |
| baseline/stdout_single.txt | 854 | (text) | 18ced8403a99d7433c17222b6f8f86452029bed62982de4dbf6f5b6a1658a69e |

## Columns

- `shadow_*.csv` (and `switch_*.csv`): `predTs` (simulated hour t, UTC), `arm`, `inputArm` (the arm whose inputs were used at t; differs from `arm` only in switch files, where `arm` = `L>F`), `status` (`predicted`, `no_por`, `no_lf`, `no_truth`, `other`; `no_truth` = a prediction exists but the truth rule found no Little Falls row; `other` = the model returned null with PoR and LF present, never observed), `rawFinalCFS`, `predictedCFS` (corrected, after the cap), `correctionApplied`, `flowBin`, `flowState`, the trace fields (`porQ` newest PoR flow used, `historicPorCFS`, `histSrcTs`, `travelPoRtoGF`, `travelGFtoLF`, `pct`, `deltaOn`, `appliedRatio` (blank when the delta gate is off), `decay`, `riseRatePerHr`, `efWeight`, `ceilingApplied` = whether the cap bound, `porEstimateCFS`, `efEstimateCFS`, `useTimeShifted`), the history seen (`histLen`, `histLastTs`), every input value and the timestamp of its source row (`*Q`/`*Stage`/`tempC` with `*SrcTs`), the input ages in hours (`age_por_h`, `age_ef_h`, `age_goose_h`, `age_lf_h`, plus `age_temp_h`, `age_mono_h`, `age_seneca_h`, `age_broad_h`; age = t minus the source row's hour start), `dueTs`, `valHourTs` (first whole hour at or after due), `tauTs` (= valHourTs - 11 min), `truthFlow`, `truthStage`, `truthInProdRange` (0 when the truth flow is outside production's 500 to 500,000 cfs validation range), `errPctRaw`, `errPctCorr` ((estimate - truth)/truth x 100), the validation-time Check 1 and Check 3 inputs (`valEfStage`, `valEfAge_h`, `valTempC`, `valTempAge_h`), one column per check (`chk1_ef`, `chk2_stage`, `chk3_lowflow_ice`, `chk4_largeerr`, `chk5_outlier`, `outlierZ`), `hardFlag`, `softFlag`, `truthDependentHard` (1 when Check 2 or Check 3 fired).
  Under `--gate=new` the checks are production's current ones (Check 3 needs ice plausibility via `isIcePlausible`; Check 5 via `classifyOutlier` is soft; hard = Checks 2 and 3 only; Check 1 > 25% soft, Check 4 raw error > 50% soft +1; soft flag = score >= 2 and not hard). Under `--gate=old` they are the original tool's checks (Check 3 without the temperature gate, Check 5 hard), with the same columns; there `hardFlag` can differ from `truthDependentHard` (it includes old Check 5).
- `learn_*.csv`: one row per learning-track validation that found a truth value: `predTs`, `valHourTs`, `dueTs`, `tauTs`, `cell` (`<flowBin>_<flowState>`), `outcome` (`learned` or `hard_skipped`), `learned`, `clamped`, `softFlagged`, `rawResidualCFS`, `learningErrorCFS`, `emaBefore`, `countBefore`, `emaAfter`, `countAfter`, check columns, `truthDependentHard`. A hard-skipped row leaves the bin unchanged (after = before).
- `bins_*.csv`: one row per bin update (not for hard-skipped rows): `ts` (the validation hour), `arm`, `cell`, `emaMeanError`, `count`, `clamped`. All 18 bins start empty; the bin value at any date is the last row at or before it for each cell.
- `counts_*.txt`: rows read, rows per status, validations, exclusions. See the blindness note below.
- `bootstrap_indices.csv`: header `b,m1..m175`, 10,000 rows of month labels, drawn with replacement from `months.csv` (175 months, 2011-12 to 2026-06, the UTC calendar months of the `predTs` of ALL rows of `shadow_F.csv`, any status). Generator: mulberry32, seed 20261117, index floor(u*K); documented at the top of `make_bootstrap_indices.mjs`.

## What the replay does (summary of the implementation)

- Clock: every whole UTC hour t from the first to the last CSV hour (`Date.now()` is set to t for each model call, as the original tool does). One model call per hour serves both tracks: the prediction the learning track stores in its slot is the same call as that hour's shadow prediction.
- Inputs: arm F takes every input from the row at t-1 h; arm L takes PoR flow, its water temperature, Edwards Ferry stage and Goose flow from t-2 h and everything else from t-1 h; F0 all from t; L0 the three lagged gauges from t-1 h, the rest from t. By timestamp. A missing value at the lagged timestamp is replaced by the last available value at or before it, accepted only if within 48 h of t; otherwise the input is absent (PoR absent: `no_por`; LF absent: `no_lf`; tributary or Edwards Ferry absent: the model's own fallback). This applies to every channel, not only the three gauges.
- History: PoR rows from t-72 h up to the arm's newest PoR row (the filled one when the lagged row is missing).
- Truth: Little Falls flow and stage linearly interpolated between hourly rows placed at hour start + 22.5 min, at tau = (first whole hour at or after due) - 11 min; one missing neighbour -> the nearest row within one hour; none -> `no_truth`. Flow and stage are interpolated independently.
- Learning track: one pending prediction. At the first whole hour T at or after due: truth at T-11 min, checks, learn on the raw residual with `updateCorrectionBin` (hard flags skip, soft flags learn with the clamp), then the slot is free and a new prediction is stored at the same hour (production order). If there is no truth, or the truth flow is outside 500 to 500,000 cfs, the slot stays and is retried at the next hour (production returns early and leaves the row pending); a slot more than 2.5 h past due is dropped (`VALIDATION_MAX_DELAY_MS`) and frees the slot.
- Shadow track: every hour, the prediction with the bins as they stand after that hour's learning; never learned from; validated at its own tau. Shadow validations at hour T are evaluated before the learning step of hour T (this only matters for the Check 5 column, which reads the bin).
- Check 1 and Check 3 at validation use the arm's own Edwards Ferry stage and water temperature at the validation hour (the same lag rule as for predictions), `isIcePlausible` uses T as "now". Truth-dependent hard flags can therefore differ between arms through the temperature; scoring exclusion in either arm is the analysts' rule.
- Switch runs: the whole replay from the start of the data with arm L inputs until the switch hour and arm F from then on, bins carried; the file keeps shadow rows with predTs from the switch. The counts file covers the whole run.

## Blindness note

I did not aggregate, print or compare any error column. Two slips, disclosed: my first run wrote error-dependent tallies (Check 4 and Check 5 fire counts, soft-flag counts, clamp counts) into the `counts_*.txt` files and I saw them in the console before removing them; I report no figure from them and the counts files in the final set no longer contain them (only Check 1 to 3 and truth-dependent hard counts, which do not depend on the prediction error; under the new gate the learned and hard-skipped counts are kept, since hard = Checks 2 and 3). A second version of the counts files showed, for the old gate (`_gateold`), the learning-track learned and hard-skipped counts, which include the error-dependent old Check 5 and differ between arms; I saw them before removing them and report nothing from them (old-gate counts files now say "not tallied"; the same information remains in `learn_*_gateold.csv`, column `outcome`, for the analysts). `learn_*` and `bins_*` rows I only counted, apart from the first three lines of `bins_F.csv` (EMA values of one arm, no comparison).

## Simplifications of the replay relative to production (noticed)

1. Hourly medians instead of 15-minute readings; history spacing 1 h. Source rows are labelled by hour start; their real centre is about +22.5 min. History timestamps are the hour starts (as in the original tool) while the truth is placed at the centres, so "age" is measured from hour starts: F is about 37.5 min and L about 97.5 min old in reality (production: about 11 and 66 min).
2. No cron minute: the clock is the whole hour; the truth instant tau stands in for production's validation timing.
3. Critical-ice handling is not replayed. Production skips validation and prediction when the PoR or LF reading is ice-affected; the CSV has no qualifiers and `-999999` was dropped, so ice appears as gaps (then `no_por`/fill/`no_truth`), and ice-affected numbers that are present enter as ordinary values.
4. Not replayed because they never feed the estimate or the bins: stage-error bins, EF-correlation learning, the shadow leaderboard, run health, divergence and residual advisories, forecasts, audit logs.
5. Bins start empty (production's load path with no rows), no seeding.
6. Production fetches P2D and takes the latest reading in the window; here that is the 48 h fill rule, for every channel (incl. Little Falls flow used as an input).
7. Truth is not rounded to Little Falls reporting precision.
8. Hours with no CSV row are simulated (production's cron would run); the original tool skipped them.
9. Predictions stop at the last CSV hour; validations continue for 72 further hours (they find no truth, status `no_truth`).
10. `makeGFPrediction` is called with a `trace` object (write-only in production); outputs are unaffected.

## Decisions the plan left open

- Output naming: `_gateold` suffix for the appendix; `switch_<date>` for switch runs (shadow file and counts only, no learn or bins file).
- Status order: `no_por` is tested before `no_lf`; `no_truth` rows keep their estimates but have blank truth and error columns.
- Out-of-range truth (< 500 or > 500,000 cfs): shadow rows keep the error and carry `truthInProdRange=0`; the learning track treats it like production (no validation, retry).
- Retry and 2.5 h drop rule for the learning slot (see above).
- One model call per hour for both tracks; shadow validation before learning at the same hour.
- Fill window 48 h counted from the simulated clock, applied to all channels including the temperature.
- `--arm=orig --gate=new` is accepted (original modes with the new gate); it is not covered by the regression test.
- Burn-in is not marked or dropped (the first 72 h are in the files).
- The bootstrap month list is taken from all rows of `shadow_F.csv`, any status.
- Extra columns beyond the brief (source timestamps, further ages, check inputs) for the analysts' lag check.

## Not implemented as written / open points

- "The data file must be read-only": verified unchanged by hash, not chmod-ed (see above).
- `counts_<run>.txt` "exclusions": reported as truth-dependent hard counts and learning-track hard skips; error-dependent exclusions (old Check 5, soft flags) are not tallied, for blindness.
- Not verified here: that the replay agrees with live USGS spot checks (the auditor's job).

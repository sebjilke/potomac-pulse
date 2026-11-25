# Onset study replay: builder README (2026-11-25)

Tool: `tools/replay_onset.mjs` (copy of `analysis/replay_lag_2026-11-17/ci_backtest_harness_lag.mjs`). Diff for the tool auditor: `tools/replay_onset.diff`.
The builder computed no error statistic of any correction rule; every number below is a count, hash, size or time.
Node v24.12.0. Input `analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv`, SHA-256 d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f, 130,416 rows.

## Commands (from `tools/`)
```
node replay_onset.mjs --in=<repo>/analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv --arm=L --gate=new --mode=hybrid --outdir=../replay_L
node replay_onset.mjs --in=<repo>/analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv --arm=F --gate=new --mode=hybrid --outdir=../replay_F
```
Run time (wall, `time -p`, two runs in parallel with the two original-tool runs): arm L 4.61 s, arm F 4.75 s (original tool: 4.14 s, 4.39 s). Both exit 0.

## Row counts by status (shadow rows written: 130,987 in each arm)
| Arm | predicted | no_por | no_lf | no_truth | other | learn validations |
|---|---|---|---|---|---|---|
| L | 128,595 | 1,014 | 439 | 939 | 0 | 23,688 |
| F | 128,613 | 999 | 439 | 936 | 0 | 23,698 |

Rows on which the model returned a prediction (= predicted + no_truth; rows with the added columns filled): L 129,534, F 129,549.

## Columns
Old columns (unchanged, same order; from `SHADOW_COLS`): predTs (sim hour, ISO), arm, inputArm, status, statusDetail, rawFinalCFS (rounded raw estimate), predictedCFS (shown value, rounded, after cap), correctionApplied (rounded correction), flowBin, flowState (the model's), porQ/porSrcTs (PoR input and its time), historicPorCFS, histSrcTs (time-shifted PoR reading), travelPoRtoGF, travelGFtoLF, pct, deltaOn, appliedRatio, decay (PoR-delta correction pieces), riseRatePerHr, efWeight, ceilingApplied, porEstimateCFS, efEstimateCFS, useTimeShifted, histLen, histLastTs (history length and newest entry time), efStage/efSrcTs, gooseQ/gooseSrcTs, tempC/tempSrcTs, lfQ/lfSrcTs, lfStageIn/lfStageSrcTs, monoQ/monoSrcTs, senecaQ/senecaSrcTs, broadQ/broadSrcTs (inputs with their reading times), age_*_h (input ages in hours), dueTs, valHourTs, tauTs (validation times), truthFlow, truthStage, truthInProdRange, errPctRaw, errPctCorr, valEfStage, valEfAge_h, valTempC, valTempAge_h, chk1_ef..chk5_outlier, outlierZ, hardFlag, softFlag, truthDependentHard (anomaly gate results at validation). See the replay_lag README for full detail.

Added columns (appended after `truthDependentHard`; JS default number-to-string; blank when not available or the row has no model prediction):
- `rawUnc`: raw estimate before rounding (`trace.rawUnc`).
- `corrUsed`: correction the model applied, unrounded (`trace.corr`).
- `corrR`, `corrS`, `corrF`: `getGFCorrectionInterpolated(bins, rawUnc, 'rising'|'steady'|'falling')` on the cells object the model used at that hour.
- `d6`: PoR flow now minus the past reading the state rule used; `thr6`: `max(100, 0.02 x flow now)`; `p6Ts`, `p6Cfs`: time and value of that past reading; `span_h`: hours between the newest history entry and the past reading; `histShort`: 1 when the rule had fewer than 8 history entries or no reading at or before now minus 6 h (then `d6`, `p6Ts`, `p6Cfs`, `span_h` blank), else 0. "Flow now" is the arm's PoR input (`por.q`), the history is the array passed to the model, the clock is the sim hour.
- `lfCap`: Little Falls reading passed to the cap (`lf.q`).
- `ageR_h`, `ageS_h`: hours (sim time) from the last `updateCorrectionBin` call on the rising / steady cell of the row's `flowBin` to this hour's prediction; blank if never. A learn at the same hour (learning runs before the prediction in an hour) gives 0. Hard-skipped validations do not count.

Blank counts among the rows with a prediction: L: d6/p6Ts/p6Cfs/span_h 571 (histShort = 1), ageR_h 535, ageS_h 63. F: 570, ageR_h 537, ageS_h 65.

## Checks (every row with a model prediction; one failure stops the run with exit 1 and a message naming predTs and both values)
Constant for (c): the production export `CEILING_RATIO` (`shared/model.js:502`, = 1.2), imported, not typed.
| Arm | rows checked | (a) state | (a) past-reading second lookup | (b) | (c) |
|---|---|---|---|---|---|
| L | 129,534 | 129,534 | 129,534 | 129,534 | 129,534 |
| F | 129,549 | 129,549 | 129,549 | 129,549 | 129,549 |

All passed, no row failed. Fault injection on scratch copies (past window 5 h instead of 6 h; `corrS` computed off rawUnc+1; cap 1.1 instead of 1.2) each stopped the run with exit 1 and a named row, so the checks do bite. Second lookup: binary search over the whole PoR series for the greatest timestamp at or before now minus 6 h, accepted only inside the history window (not the history-array scan the first lookup uses).

## Output files (SHA-256, bytes)
| File | SHA-256 | Bytes |
|---|---|---|
| replay_L/shadow_L.csv | dcc63931841b537a834962b9a7c60e6edfd3b72b8bd491b43af89bbba0ba5aba | 109,952,178 |
| replay_L/learn_L.csv | be9c95c12ebb8dbf622f6ae1859830f63326bf026fdf31078e210e16c198b3e6 | 5,197,278 |
| replay_L/bins_L.csv | ad2a48e19344468d5960492a3d95a5d936ead578789388b4b2fc30f331978eea | 1,658,625 |
| replay_L/counts_L.txt | 2413d7da60ef9445959e75316e6868de6945678836c63ccf22675fde3a7dde7e | 1,200 |
| replay_L/stdout.txt | 21c38664d35aa50bb6b0dc0541dc1f8df8e9d6362a73cf84b341519f376608ce | 379 |
| replay_F/shadow_F.csv | 7fb8072237cd21c99d196a7b2c1525f4aa850885638e4f06321617cdcf2a63a3 | 110,149,295 |
| replay_F/learn_F.csv | eec61197434eb4290716355aa574d7213388a01f6f9f85681383e353153eb5ba | 5,201,881 |
| replay_F/bins_F.csv | cca914ddf153d11760ceecfbbc2548a272d80435f76d9b86e1213004681ed0fc | 1,661,086 |
| replay_F/counts_F.txt | b0a2ae6711a8d82fe6e3a60f3a919171729f650f01236e0cce3d9fc11f61542d | 1,199 |
| replay_F/stdout.txt | 0d5d3e022638ade6abd1ae8b99091fdbf3dceb9a10f4c16cf54b5cd3be4924ee | 378 |
| tools/replay_onset.mjs | 86572a5bf5f5c6ef7a118a8f8e3ad63e963785a3d3ecbbf7671263c2be0e7786 | 45,314 |
| tools/replay_onset.diff | d9a8df789cb9c96c258364dcb462ac9ecdb9bba7d8472f222ec21fc4fbc47e29 | 5,112 |

## Regression (original tool, same arguments, same v39 input, into a scratch folder)
"Stripped" = my shadow file with the last 14 columns cut (`awk -F, -v OFS=, '{NF=NF-14; print}'`).
| Arm | File | SHA-256 (mine, stripped where shadow) | SHA-256 (original) | Result |
|---|---|---|---|---|
| L | shadow | 549f200645b4bb9b2a6a43ee4bee00a84903726ceefdce259f73c54bed6b0d99 | same | identical |
| L | learn | be9c95c12ebb8dbf622f6ae1859830f63326bf026fdf31078e210e16c198b3e6 | same | identical |
| L | bins | ad2a48e19344468d5960492a3d95a5d936ead578789388b4b2fc30f331978eea | same | identical |
| F | shadow | 0cde90f730df8a3c5a53ea29ed97db805472270c7ec10f8fe1a2cd9b35e453c8 | same | identical |
| F | learn | eec61197434eb4290716355aa574d7213388a01f6f9f85681383e353153eb5ba | same | identical |
| F | bins | cca914ddf153d11760ceecfbbc2548a272d80435f76d9b86e1213004681ed0fc | same | identical |

Counts files: identical except line 2 (`command:`), which echoes the argument list (it names the output folder and, in the original, `ci_backtest_harness_lag.mjs` is the fixed text in both). Hashes of the full files differ for that reason only: mine L 2413d7da..., original L 0662ad1d...; mine F b0a2ae67..., original F c60e1cd8....

Arm L against the earlier run `forecast_from_measured_water_2026-11-24/replay_B/` (on disk): shadow_L.csv 549f2002... , learn_L.csv be9c95c1..., bins_L.csv ad2a48e1... are byte-identical to both the fresh original-tool run and to my stripped output; counts_L.txt identical apart from line 2. The production code reproduces yesterday's run.

Determinism: arm L run a second time (to a scratch folder): shadow_L.csv, learn_L.csv, bins_L.csv byte-identical to the first (shadow SHA-256 dcc63931...); counts differs on line 2 only (output path).

Arm F note: the plan (section 5) asks for arm F regression on the older input; here arm F was regressed on the v39 input against the original tool run fresh, as the brief states.

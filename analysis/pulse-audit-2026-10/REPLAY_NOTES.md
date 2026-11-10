# Hourly replay of the server estimator: 2026-10-08T00Z to 2026-10-21T00Z

All times are UTC. USGS `dateTime` values carry `-04:00` (EDT). The script parses them to epoch ms.
Sign convention: error = estimate − truth. A negative error means the app under-read the river.
One event. These numbers describe what happened. They are not skill estimates.

## Files (all in this folder)
| file | what it is |
|---|---|
| `replay_build.cjs` | builds everything. It imports the real `makeGFPrediction`, `fetchUSGSData`, `fetchWaterTemp` and `getPoRFromHistory` (from `code/netlify/functions/scheduled-update.js` `_test`) and the shared helpers from `shared/model.js` |
| `replay_hourly.csv` | **the shared dataset**: 313 hourly ticks at the chosen per-gauge lag setting (see below) |
| `replay_hourly_L{0,15,30,60,75}.csv` | the same dataset at a uniform lag on every gauge, with no LF overrides (amendment 2 sensitivity) |
| `fidelity_table.csv` | 41 logged validations (20 hard-flag, 21 clean) compared with the replay at the chosen setting |
| `fidelity_table_lag_sensitivity.csv` | the same comparison at L = 0/15/30/60/75 plus the chosen setting |
| `fidelity_summary_by_lag.csv` | one row of match statistics per lag setting |
| `grid_fit.csv` | 7×7 grid of LF lag × all-other-gauge lag (0–90 min), with match statistics |
| `fit_trace.csv`, `best_lags.json`, `lf_lag_scan.csv` | the per-gauge lag fit (coordinate descent) and the LF lag scan |
| `lf_overrides.csv` | each logged cron LF value, the smallest lag that reproduces it, and any per-tick override |
| `exactbins_updates.json` | bin updates applied in the exact-bins pass (replay-derived, and snapped to logged values) |
| `phase_summary.csv` | MAPE, bias, median, min and max by phase, for raw / approx1015 / exactbins / app truth |
| `phase_by_lag.py`, `phase_by_lag.txt` | phase MAPE and bias at every lag setting (robustness check) |
| `supabase_episodes_2026-10.json`, `compare_advisories.py`, `advisory_compare.txt` | logged advisory episodes (read-only SELECT) compared with the replayed chains |

## How to rerun
```
cd <this folder>
node replay_build.cjs              # uses best_lags.json; writes every CSV except grid_fit.csv
node replay_build.cjs --fit        # refits the per-gauge lags -> best_lags.json, then builds
node replay_build.cjs --grid       # also writes grid_fit.csv
node replay_build.cjs --lags=por:60,ef:30,lfOverride:false   # override the lag for any gauge
python3 -I phase_by_lag.py ; python3 -I compare_advisories.py
```
The script needs Node 24 and nothing else. It makes no network calls: `fetch` is replaced by a stub that serves the local USGS file. `@supabase/supabase-js` is stubbed. Any module that resolves into `/Users/sebjilke/Desktop/PotomacPulse` is refused, which includes the symlinked `node_modules`. Console output from the model is muted during calls. One full build takes about 4 s.

## Input reconstruction rules
1. **Frozen clock (amendment 1).** `Date.now` is stubbed to each tick's run time for every call, then restored. Run times come from four sources:
   - hard-flag `predictionCreatedAt` − 2 s
   - hard-flag `validatedAt` − 2 s
   - start and end times of the logged advisory episodes
   - otherwise HH:00:20.
2. **USGS view.** Each tick builds a fake IV JSON in the real schema. It holds the readings with `dateTime` in (run − 48 h, run − lag(gauge)]. The real `fetchUSGSData` parses it, so the latest value, the ice and qualifier logic, `hTime` and the PoR P2D history all come from the real parser. Water temperature comes from the real `fetchWaterTemp` (PoR 00010, P1D) under the PoR lag. It ran 14–21 °C, so the cold EF model never fires (`ef_model` is always `default`).
3. **PoR history (amendment 4).** This is the `storePoRHistory` logic run in memory:
   - the union of the P2D fetches from every earlier tick, starting at a 2026-10-05T00Z warm-up
   - first-seen value kept per timestamp
   - sorted, and trimmed to > run − 72 h only when new readings arrived
   - the cron's fallback `stored.readings || porHistory` is kept.

   Revisions cannot be observed. The current USGS record stands in for the first-seen values.
4. **Latency (amendments 2 and 3).** The chosen setting is in `best_lags.json`: `por55_lf10_monocacy5_goose5_broadRun50_seneca20_ef45_lfov`, in minutes. A gauge's lag applies to every use of that gauge: q, h, the history tail, `hTime`, and temperature for PoR.
   - **LF lag of 10 min.** Fitted on the cron's logged LF values: the `actualCFS` and `actualStage` of the 39 validations, plus 8 ceiling-implied values. At 10 min, 37 of 41 values reproduce exactly, against 16 at 0 min and 23 at 15 min (`lf_lag_scan.csv`).
   - **LF overrides.** At three ticks the cron demonstrably had older LF: 10-14T09 (70 min), 10-14T21 (65 min) and 10-15T09 (70 min). `lfOverride` applies those lags at those ticks only (`lf_overrides.csv`). Late LF deliveries at other ticks cannot be observed.
   - **Other gauges.** Their lags come from a coordinate-descent fit, in 5-min steps, on the mean absolute raw error over two sets: the 20 hard-flag raw values and the 2 bin-implied raw constraints. Mismatches in flowState or flowBin add a 0.25 penalty each. The fit is in-sample: 6 parameters on 22 constraints. The uniform-lag sensitivity files exist so analysts can see how much depends on it.
5. **Correction passes.** `makeGFPrediction` is called up to three times per tick.
   - **RAW**: `{}` bins. The correction is 0, but the 120%-of-LF ceiling still applies to `raw_displayed_cfs`.
   - **approx1015**: the 2026-10-15T16Z snapshot at every tick. Bins whose count and EMA were unchanged at 11-10 use the exact 11-10 state.
   - **exactbins** (amendment 10): built only for ticks 10-15T16..10-19T16. It starts from the 10-15T16 snapshot. Each logged clean validation runs the real `updateCorrectionBin` in cron order: validation (learning) first, then the prediction. Each update uses the replay raw for that prediction and the logged actual. The bin is then snapped to the exact logged state where that state is known: 12000-25000/falling after 10-15T20, and 6000-12000/steady after 10-19T10. The intermediate 6000-12000/steady EMAs (after 10-18T13, 10-18T20 and 10-19T03) are replay-derived.
6. **Decomposition.** `travel_*`, `historic_por_*`, `por_change_pct`, `por_delta_*`, `trib_sum_cfs`, the rise rate and `flow_state` are recomputed with the same shared helpers under the same clock. They are checked against the function's `porEstimateCFS`, `historicPorCFS`, `travelTimeGFtoLF` and `flowState`. `decomposition_matches_function` is true on all 313 ticks.
7. **Single pending slot (amendment 13).** The validate-then-store chain is simulated from 10-05 with the cron's rules:
   - due-time check
   - 2.5 h acceptance window
   - 48 h stale cleanup
   - `isExistingPredictionReplaceable`
   - LF in [500, 500000].

   `chain_stored` marks the hourly predictions that were stored and scored.
8. **Advisory chains (amendment 17).** `updateEfDivergenceState` runs on every tick with the raw pass's `efEstimateCFS`, `porEstimateCFS` and EF `hTime`. `updateLfResidualState` receives the **logged** `errorPercentCorrected` at each logged validated tick.

## Truth definitions (amendment 7)
- **Physical truth** (`truth_phys_*`): LF discharge and stage interpolated linearly at `validation_due_utc` from today's USGS record. `truth_phys_gap_min` is the distance to the nearest reading. Use it for skill findings.
- **App truth** (`truth_app_*`): the replayed cron `lf.q` and `lf.h` at the first tick at or after due, within 2.5 h, from the same lagged view. Use it for fidelity and for published-accuracy questions. `app_vs_phys_truth_pct` is the difference between the two: mean absolute 0.9 % across all ticks, up to +17 % at the onset.
- Both are LF at Little Falls, which includes the ungauged area below Great Falls. "Error" means error against LF as defined here. It is not error against Great Falls.

## Column dictionary (`replay_hourly.csv`)
- `tick_utc`, `run_utc`: cron hour and the frozen clock used. `phase`: pre (10-08 to 10-11), onset (10-11T00 to 10-12T00), rise (10-12T00 to 10-14T06), peak (10-14T06 to 10-15T00), recession (10-15T00 to 10-21T00). Phases are keyed on the tick, not on validationDue.
- `lag_config`; `lf_lag_used_min` (shows the override where one applies).
- `in_*`: the cron's inputs. `*_age_min` is run time minus the timestamp of the latest available reading. `in_trib_fallback` lists tributaries that used the drainage-area fallback (none did). `in_water_temp_c`; `por_hist_n`, `por_hist_first_utc`, `por_hist_last_utc`.
- `rise_rate_pct_per_h`, `rise_flow_state` (the server rise rate: last entry against the entry at or before 6 h ago).
- `travel_por_gf_initial_h` (from LF), `travel_por_gf_h` (after the 3-step iteration), `travel_iters`, `travel_converged`.
- `historic_por_cfs`, `historic_por_hours_ago`: the time-shifted PoR reading.
- `trib_sum_cfs`: Monocacy + Goose + Broad Run + Seneca.
- `por_change_pct`, `por_delta_decay`, `por_delta_applied_ratio`: the PoR-delta correction. Decay 0 and ratio 1 mean |change| ≤ 5 %.
- `por_estimate_cfs`, `ef_estimate_cfs`, `ef_model`, `ef_discrepancy_pct`, `ef_used` (false means EF was skipped for a >50 % discrepancy or a bad stage), `ef_weight`.
- `flow_state`, `flow_bin` (keyed on the raw final value); `raw_final_cfs` (unclipped learning target); `raw_displayed_cfs` (raw after the ceiling); `raw_stage_ft`.
- `ceiling_limit_cfs` (= 1.2 × the stale `in_lf_cfs`); `raw_ceiling_bound`; `raw_ceiling_excess_cfs`.
- `approx1015_*` (correction, corrected value after the ceiling, stage, ceiling bound) and `exactbins_*` (only 10-15T16..10-19T16).
- `travel_gf_lf_h`, `validation_due_utc`.
- `truth_phys_*`, `truth_app_*`, `truth_app_delay_after_due_min`.
- `err_*_phys_*` / `err_*_app_pct`: raw errors use `raw_final_cfs`. approx1015 and exactbins errors use the displayed (clipped) corrected value.
- `chain_stored`, `chain_validated_pred_created_utc`, `obs_pred_created_here`, `obs_validated_here`.
- `ef_div_dbar`, `ef_div_active`, `lf_res_active`, `lf_res_last_err_pct`.
- `decomposition_matches_function`.
- `fidelity_evidence`: a set built from `raw_verified`, `bin_raw_verified`, `corrected_verified`, `lf_view_verified` and `timing_verified` (defined in the script above `toCSV`). An empty value means no direct evidence at that tick. `hours_to_nearest_raw_verified_tick` gives the gap.

## Fidelity result
At the chosen setting:
- **Raw estimate.** The replay reproduces the logged `rawPredictedCFS` of all 20 hard-flag rows from 10-08 to 10-18. The median absolute difference is 0.15 %, the maximum 0.83 %, and all 20 are within 1 %.
- **Bin-implied raw.** On the two raw constraints recoverable from clean rows, the replay is within 0.31 % (sum of the four 6000-12000/steady errors) and within 0.15 % (the 10-15T20 12000-25000/falling error).
- **Logged LF.** All 39 logged `actualCFS` values and all 8 ceiling-implied LF values match exactly.
- **Timing, state and bin.** All 41 replayed `validationDue` values fall in the observed validation interval. flowState and flowBin match on 41/41.
- **Corrected values.** The exact-bins pass reproduces the logged `predictedCFS` on 17/17 rows from 10-15T16 on, within 0.57 % at most. The in-force corrections on hard-flag rows are reproduced within 4 cfs: 80/82, 188/188, 290/294, 378/378, then 401–402.
- **Chain.** The simulated pending-slot chain recreates all 41 observed prediction-creation ticks with no extra stored predictions up to 10-19T10. After 10-19T10 it continues with 6 stored predictions that are unverified.
- **Other lags.** At uniform lags the raw match is clearly worse:
  - L = 0: median 0.74 %, max 9.1 %, 17/20 within 2 %
  - L = 60: median 0.18 %, max 2.2 %, 18/20 within 2 %

  At every uniform lag only 0–3 of the 8 ceiling LF values are reproduced.
- **Phase results** (raw and approx MAPE and bias) move by about 2 percentage points at most across all lag settings (`phase_by_lag.txt`).
- **Advisory chains.** The LF-residual chain matches every `lfResidualActive` and `lfResidualLastErrPct` stamp. Its episode boundaries differ from the logged ones by a seconds-level race at the 12 h staleness edge: the replay breaks at 10-12T14 and ends at 10-13T04, while the log shows one episode from 10-12T02 to 10-13T03. The EF-divergence chain reproduces the `efDivergence` stamps to a median absolute 0.009, and the replay tends to read low at the peak. It misses four logged one-tick deactivations (10-09T04, 10-10T05, 10-11T05, 10-11T08), so it mismatches the stamp at 10-09T04. Those deactivations most likely come from EF readings older than 2 h, and per-tick EF latency cannot be observed. The replayed EF episode ends at 10-11T15; the logged one ends at 10-11T14.

## Caveats analysts must respect
1. **Rising-limb raw values are unverified.** No logged raw value exists between 10-11T12 and 10-14T06, a gap of up to 45 h. The evidence on that limb covers only validation timing, the cron's LF view and ceiling binding: all 6 clean rising-limb rows were clipped at 1.2 × stale LF, which confirms `lf.q` but not raw. The onset and rise raw numbers therefore depend on the tributary and PoR lag fit. Label any finding that rests on a single rising-limb raw value accordingly (amendment 18).
2. **The lag fit is in-sample.** Six lags were fitted on 22 constraints. Late deliveries were observed only for LF. Unobserved late deliveries at other gauges or ticks are absorbed as noise. Always check a finding against `replay_hourly_L*.csv`.
3. **approx1015 is contaminated before 10-15T16.** It applies flood-learned bins to the flood's own earlier hours. 12000-25000/rising (n=7, 3762) and 25000-50000 were learned during the event. Bins before the event were never captured. The logged in-force corrections differ: 12000-25000/falling was 209 at 10-14T18 and 403 at 10-15T06, against 230 in the snapshot. On the rising limb, clean rows 10-13T07 and 10-13T14 were ceiling-bound in production, while approx1015 is not, so the correction in force then was smaller than the snapshot's. Treat approx1015 before 10-15T16 as a bracket, not as what was displayed. Only `exactbins_*` (10-15T16..10-19T16) is reconstructed.
4. **The intermediate exact-bin EMAs come from the replay.** 6000-12000/steady after 1, 2 and 3 updates uses replay errors. The replay's four-error sum is −740 against −816 logged, and its sum of squares 150,474 against 177,556. That is why the logged clean values for 10-18T13 to 10-19T10 differ by 0.3–0.4 %.
5. **The ceiling decides what was displayed on the rise.** The corrected and displayed value is 1.2 × an LF reading that is up to 70 min old. Ceiling binding is reported separately (`*_ceiling_bound`, `ceiling_limit_cfs`). It says nothing about the correction (amendment 12).
6. **This is the server's estimate, not the paddlers'.** The replay reproduces only the server cron estimate: the gf_history line and the stored and validated predictions. The browser estimate (`estimateGreatFalls`: client fetch, localStorage history, median-robust rise rate) is not replayed.
7. **Scoring covered a small, non-random sample.** The chain stored 47 of 313 hourly predictions, so 266 were never scored; 41 stored predictions are verified up to 10-19T10. The slot was locked for 24 hourly ticks between 10-11T13 and 10-12T14 (10-12T02 was the only store in that window) (two predictions with 13-h travel times), which covers most of the onset surge. Stored predictions are a sample chosen by the timing of the slot lock.
8. **Hard flags are logged, not reproduced.** Check 5 depends on bin state that was never captured. Use the logged `anomalyFlags`. Flag provenance follows v37.20 rules: the four October LOW_FLOW_HIGH_STAGE flags would not fire under the frozen v37.21 code.
9. **Revisions cannot be checked.** PoR, tributary and EF revisions are unobservable. LF at the 39 validation ticks still matches what the cron saw, so there is no evidence of LF revision there. Monocacy values before 10-07T14:30Z are 'A' (approved). That is before the event.
10. **Truth is Little Falls, not Great Falls.** Both truths are LF at Little Falls. Below-GF ungauged inflow appears as model error, most strongly at the onset, where local runoff dominated: LF climbed to about 11,500 cfs while PoR was still about 3,000 cfs.

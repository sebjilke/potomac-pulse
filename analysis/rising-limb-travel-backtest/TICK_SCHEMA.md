# Tick file schema (rising_limb_ticks.csv and its S2, S3 and multi siblings)

Status: written before the gate run. The plan (`rising-limb-travel-backtest-plan-2026-11-10.md`, incl. Deviations D-1 to D-5) wins over this file wherever they differ. This file only fixes how to read each column. It contains no results.

## 0. Layout and general rules

- One row per tick per arm. Arms: `base`, `A`, `B`, `C`. Rows come in tick order, four consecutive rows per tick in that arm order. CSV, header line, comma separated, no quoting (no field contains a comma), blank field = missing/not applicable. Encoding UTF-8, `\n` line ends.
- Ticks: every UTC hour from 2011-12-01T05:00:00Z to 2026-11-09T23:00:00Z inclusive (130,987 ticks, D-5 H1). Hours with no CSV row are still ticks.
- `tick_utc` is the model clock. Nothing after `tick_utc` was read by the model (inputs come from the lag view, plan section 2).
- Numbers are written in full JavaScript precision (shortest round-trip). Booleans are 0/1.
- Files: `rising_limb_ticks.csv` is the primary run (single-slot chains, primary lag view) and the only file that decides the gate. `_S2` (unlagged leaky view), `_S3` (uniform 1 h lag) and `_multi` (a pending at every tick, primary view) have the same columns and are report-only. Under S2, S3 and the multi-pending replay only the model inputs, the Point of Rocks history and the learning inputs change (D-5 H12). The truth reading (LF view lookup), `tau_ref`, `tau_converged`, `truth` and the rise rate behind them use the PRIMARY lag view in all four files, so `tau_ref`, `truth` and `truth_tick_utc` are identical across files. `truth_basehz` and `truth_own` also read the primary LF view, but at the horizon of the file's own model travel time (`travel_gf_lf`), which depends on the view the model saw. The mask in S2/S3/multi is the primary mask AND the view's own Point of Rocks and Little Falls exist (`mask_why = view_input_missing` when only the second part fails). Window labels (event ids) are identical in all four files. `lf_view`, `por_view` and the carry columns show the view the file's model used.
- Event ids refer to `event_id` in the frozen `rising_limb_events_python_v39.csv` (rows with `event_row == 1`). Class (GATE or STRATUM), `kept`, `oct`, `holdout` are read from that file by id; they are not repeated here.

## 1. The three rules every metric must apply

1. Burn-in (D-5 H7): use only rows with `in_scoring == 1`.
2. Common mask: use only ticks with `mask == 1`. `mask == 1` means: the Point of Rocks view (lag 2 h, carry up to 3 h) and the Little Falls view (lag 1 h, carry up to 3 h) both exist at the tick, and the arm-independent truth exists (section 4 of the plan). The mask is the same for all four arms at a tick. Also require `has_pred == 1`; on a masked tick every arm has a prediction, and an analyst must assert that and stop if it fails.
3. Window membership comes only from the label columns in section 3, which derive from the frozen event file. Do not recompute event times from the tick file.

All metrics are computed on rows satisfying rules 1 and 2 plus the window of the criterion. Normal-hours metrics use `normal == 1`.

## 2. Errors (D-5 H8). All in cfs, signed, estimate minus truth

- `e_raw = raw - truth`
- `e_unc = unc - truth`
- `e_disp = disp - truth`
- G7d / S1: `e_unc_basehz = unc - truth_basehz` and `e_unc_own = unc - truth_own`. Scoring set, for each arm-versus-baseline comparison: `mask == 1`, `truth_basehz` non-blank, and the arm's `truth_own` non-blank; both horizons use that same set (D-5 H6). Under the base horizon both the arm and base are scored with `truth_basehz`. Under the arm's own horizon each arm is scored with its own `truth_own` (the base row's own horizon is its `truth_own`, which equals its `truth_basehz`).
- Rising tick for G5 and G7e (D-5 H8): a row with `in_scoring == 1`, `mask == 1`, a non-blank `rl_event`, and `base_rst == 'rising'`. The test uses the BASELINE flow state `base_rst`, for every arm. `b_active` is NOT the denominator.
- G7b: MAPE is the hour-pooled mean of `100 * |e_unc| / truth` over the rising-limb ticks (RL window rows, rules 1 and 2) (D-5 H14).
- Recession bias (G3): mean over REC ticks of `100 * e_raw / truth`, hour-pooled (REC = rows with non-blank `rec_event`).

## 3. Window label format

- `rl_event`, `rlx_event`, `rec_event`: the integer `event_id` of the KEPT event (`kept == 1` in the event file, GATE and STRATUM both) whose window contains the tick; blank if none. RL = [t0-12 h, min(t0+24 h, tp)], RLX = [t0-12 h, tp], REC as in plan section 3 (M1; for the merged event the later component's limb is removed). Bounds inclusive (D-1 C4).
- Each label holds exactly one id (D-5 H9). The harness stops if a second id would appear, so a tick is never in two events' same-type window. Analysts must filter to the criterion's class (GATE for the gate; STRATUM is report-only) using the event file.
- `ew_any`: 1 if the tick lies in the EW window [t0-12 h, tend+24 h] of ANY detected event of any class, kept or excluded; else 0. `normal = 1 - ew_any`.
- Excluded events (X0 to X4) carry no `rl_event`/`rlx_event`/`rec_event` label but do contribute to `ew_any`.

## 4. Columns

Arm column: "all" = every arm row carries its own value; "base-copy" = the value is the baseline arm's and is repeated on A, B and C rows of the same tick; "tick" = arm-independent, identical on all four rows. Blank when the model returned no prediction unless stated.

| # | Column | Type / unit | Exact meaning | Arms | Used by |
|---|---|---|---|---|---|
| 1 | `tick_utc` | ISO-8601 UTC, ms | Model clock of the tick | tick | all |
| 2 | `arm` | text | base, A, B or C | all | all |
| 3 | `in_scoring` | 0/1 | 1 iff `tick_utc >= 2012-12-01T00:00:00Z` (burn-in end, D-5 H7). Arms learn through burn-in; it is never scored | tick | every criterion (rule 1) |
| 4 | `has_pred` | 0/1 | The arm's model returned a prediction (needs PoR and LF view non-zero) | all | rule 2 assertion |
| 5 | `raw` | integer cfs | `rawFinalCFS` as production returns it (`Math.round(rawFinalUnclipped)`): the ensemble estimate before the learned correction and before the cap | all | e_raw: G3a, G3b, G7a |
| 6 | `raw_unc` | float cfs | `trace.rawUnc` = `rawFinalUnclipped`, unrounded raw. The learning target and the bin-selection input. Informational | all | diagnostics |
| 7 | `unc` | float cfs | `trace.unc` exactly as the model returns it (`correctedFinalUnclipped` = raw minus correction, before the 120 percent cap, not rounded, not recomputed) | all | e_unc: G1a, G1b, G2, G6a, G6b, G7b, G7c, G7d |
| 8 | `disp` | integer cfs | `predictedCFS` = `Math.round(correctedFinal)`: the displayed value after the 120 percent cap | all | e_disp: G4a, G4b, G7f |
| 9 | `ceiling_applied` | 0/1 | The cap bound at this tick | all | cap-bind diagnostic |
| 10 | `corr` | float cfs | `trace.corr`: the correction subtracted from raw (interpolated bins). Depends on the arm's own bins | all | diagnostics |
| 11 | `flow_bin` | text | `flowBin` of the arm's own raw (bin of `rawFinalUnclipped`): 0-3000, 3000-6000, 6000-12000, 12000-25000, 25000-50000, 50000+ | all | per-bin tables |
| 12 | `flow_state` | text | The arm's `flowState` from `getFlowState` on the Point of Rocks history: rising, falling or steady | all | per-state tables |
| 13 | `rst` | text | `trace.rst`: flow state returned by `getPoRRiseRateFromHistory`; blank when that function returns null (fewer than 4 history entries, no entry 6 h back) | all | diagnostics |
| 14 | `rate` | float, percent per hour | `trace.rate`: PoR rise rate; blank when `rst` blank | all | diagnostics |
| 15 | `stop` | text | How the PoR-to-GF travel loop ended: converged, max_iter, no_hist, hist_lost | all | G5a, G5b, G7e |
| 16 | `nonconverged` | 0/1 | `stop == 'max_iter'` | all | G5a, G5b |
| 17 | `lookup_fail` | 0/1 | `stop` is no_hist or hist_lost | all | G7e |
| 18 | `it` | integer 1 to 3 | Loop passes executed | all | diagnostics |
| 19 | `travel_por_gf` | float hours | Final PoR-to-GF travel time (`trace.t`) | all | diagnostics |
| 20 | `travel_gf_lf` | float hours | `travelTimeGFtoLF` returned with the prediction; sets the validation due time and is the arm's "own horizon" for G7d | all | G7d, diagnostics |
| 21 | `b_active` | 0/1 | This arm's own `rising`: `rst == 'rising' && rate > 0` (the exact condition arm B uses). Depends only on the Point of Rocks history, so it is equal across arms at a tick. NOT the G5/G7e denominator (that is `base_rst`) | all | invariants, diagnostics |
| 22 | `delta_on` | 0/1 | `trace.deltaOn`: absolute PoR change since the lookup exceeds 5 percent; blank when there is no history | all | diagnostics |
| 23 | `pct` | float percent | `trace.pct`: PoR change percent used by the delta | all | diagnostics |
| 24 | `lf_view` | float cfs | LF discharge from the lag view (L = 1 h, carried up to 3 h) used by the model and by the learning step at this tick | tick | diagnostics |
| 25 | `por_view` | float cfs | PoR discharge from the lag view (L = 2 h, carried up to 3 h) | tick | diagnostics |
| 26 | `lf_carry_h` | integer hours 0 to 3 | Hours the LF view was carried forward (0 = the stamp itself existed); blank if missing | tick | diagnostics |
| 27 | `por_carry_h` | integer hours 0 to 3 | Same for PoR | tick | diagnostics |
| 28 | `base_rst` | text | The BASELINE arm's `rst` at this tick, repeated on every arm row | base-copy | G5a, G5b, G7e denominator |
| 29 | `base_stop` | text | The baseline's `stop` | base-copy | diagnostics |
| 30 | `base_flow_bin` | text | The baseline's `flow_bin` | base-copy | G4b cells |
| 31 | `base_flow_state` | text | The baseline's `flow_state` | base-copy | G4b cells |
| 32 | `mask` | 0/1 | Common mask (rule 2 above) | tick | every criterion |
| 33 | `mask_why` | text | ok; or why not: view_input_missing (S2/S3 files only: the view's PoR or LF is missing though the primary view has them), no_input (PoR or LF view missing), tau_lf_missing (LF view missing during the truth iteration, searched to +2 h), no_truth (LF view missing at the truth tick, searched to +2 h) | tick | audit |
| 34 | `tau_ref` | float hours | Arm-independent truth horizon: tau_0 = 6.5 h, up to 3 passes of `getGFtoLFTravelTime(getFlowMultiplier(LF view at t + tau_(k-1)), riseRate(t))`, stop at the first pass moving less than 0.5 h, last iterate kept. Blank when `mask_why` is no_input or tau_lf_missing | tick | truth |
| 35 | `tau_converged` | 0/1 | The iteration met the 0.5 h stop within 3 passes. Blank when `tau_ref` blank | tick | non-converged-truth count |
| 36 | `truth` | float cfs | LF view at the first tick v >= t + `tau_ref`, trying v, v+1 h, v+2 h (the LF view is the L = 1 h view of the tick v; first non-missing wins) | tick | the truth of every criterion except G7d |
| 37 | `truth_tick_utc` | ISO-8601 UTC | The tick v that supplied `truth` | tick | audit |
| 38 | `truth_basehz` | float cfs | Same LF view rule at horizon h = the BASELINE arm's `travel_gf_lf` at this tick (first tick v >= t + h, v to v+2 h). Computed whether or not `mask` is 1 | base-copy | G7d, S1 |
| 39 | `truth_basehz_tick` | ISO-8601 UTC | The tick v that supplied `truth_basehz` | base-copy | audit |
| 40 | `truth_own` | float cfs | Same rule at h = THIS arm's own `travel_gf_lf` | all | G7d, S1 |
| 41 | `truth_own_tick` | ISO-8601 UTC | The tick v that supplied `truth_own` | all | audit |
| 42 | `rl_event` | integer or blank | Event id whose RL window holds the tick (section 3) | tick | G1, G2, G5, G6, G7a, G7b, G7d, G7e, G7f |
| 43 | `rlx_event` | integer or blank | Event id whose RLX window holds the tick | tick | G7c |
| 44 | `rec_event` | integer or blank | Event id whose REC window holds the tick | tick | G3a, G3b |
| 45 | `ew_any` | 0/1 | Tick lies in the EW of any detected event | tick | G4 |
| 46 | `normal` | 0/1 | `1 - ew_any` | tick | G4a, G4b |
| 47 | `slot` | text | Single-slot outcome of the store step at this tick: stored, skipped_in_window (a pending still inside its validation window), no_prediction. In the multi file always stored | all | diagnostics |
| 48 | `validated` | 0/1 | This arm validated (claimed) a pending at this tick | all | learning-speed diagnostics |
| 49 | `hard_flag` | 0/1 | The validation was hard-flagged (claimed, not learned) | all | diagnostics |
| 50 | `soft_flag` | 0/1 | The validation was soft-flagged (learned, clamped where the shared rule applies) | all | diagnostics |

## 5. Notes that prevent misreading

- `raw` is an integer (production rounds it); `unc` is not rounded; `disp` is an integer and capped. Do not derive one from another (rounding and the cap differ).
- `truth` is not the learning target. Learning inside the chains compared the stored raw prediction with the Little Falls view at the validation tick; that never appears as a column.
- `lfViewAtTime` horizon epsilon: a horizon h maps to tick offset `ceil(h - 1e-12)`. The `1e-12` keeps a horizon that is exactly a whole number of hours (7.0) from moving a tick later through floating-point noise. It never changes a real horizon.
- Learning and every arm column use the lag view. The columns `por_lagged` and `travel_time_h` of the data CSV are never read.
- Blank means "not applicable or missing", never zero.
- Event membership of a tick for bootstrap resampling: use `rl_event` / `rec_event` ids; the resampling index files refer to included GATE-class events sorted by t0 (21; non-October 20) (see the event-count log).
- Snapshots for the third implementation (D-5 H13), `rising_limb_snapshots_t0m72.json`: for every kept event and every arm, the bins and the pending slot AFTER the full tick at t0-72 h (validate, predict, store of that tick all done). The third implementation resumes at the tick t0-71 h. `bins` has the 6 flow bins x {rising, falling, steady} objects `{count, sumError, sumErrorSq, meanError[, emaMeanError]}`; a bin never written has count 0 and no `emaMeanError` and is equivalent to an empty bin; `written` lists the bin keys (`<flowBin>_<flowState>`) that have been written. `pending` is the single pending record (`id`, `created_at`, `createdMs`, `data` = the prediction object incl. `validationDue`) or null. The seeded rebuild replays the baseline from 2011-12-01 05:00 through the tick t0-72 h inclusive and compares bin by bin.

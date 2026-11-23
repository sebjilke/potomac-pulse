# OUT_DICTIONARY: tables in replay/out/

CSV, UTC ISO times ending in Z, blank = missing, booleans 1/0, no clock, no randomness (reruns are byte-identical).
**Fix round 2026-11-23.** Added: scenario `S-old-C` and `old_rule = C` (rule C of the old curve, see `f_old/CURVE_DEFINITION.md`), column `gate_miss`, `GATE_VERDICT.json` field `gateA_after_ruling`. Rows of the earlier scenarios and rules are unchanged (`LOG.md`, `compare_before_after.py`). Row counts: `replay_runs.csv` 1,375 (275 x 5 scenarios), `truth.csv` 1,375, `iteration_limit_share.csv` 95, `replay_2x2x2.csv` 6,600 (275 x 3 rules x 8 cells), `cell_identity_test.csv` 840 (280 x 3 rules), `labels.csv` 275, `truth_gate.csv` 20, `fidelity_table.csv` 12,880, `fidelity_summary.csv` 49.

Scenario names: `S0` = as stored by the job (old and new mixed by the first-seen rule); `S-old-A`, `S-old-B`, `S-old-C` = "revision never happened",
every Point of Rocks flow from 10 Nov on is `f_old` rule A, B or C (before 10 Nov the old archive; rule C = rules A/B inside the knots, plus the October knots 1.01 and 1.02 ft and a linear extrapolation from them below 1.01 ft; rules A, B and C are three assumptions below 1.01 ft, none demonstrated to bound the old curve); `S-new` = "revised from the start", every
Point of Rocks flow is the current record. Everything else (Little Falls, tributaries, Edwards Ferry, temperature, run times,
which readings had been published at run time) is identical in all scenarios.

**Which files exist depends on the gate verdict.** `fidelity_table.csv`, `fidelity_summary.csv`, `GATE_VERDICT.json` and `facts.json` are
always written. `replay_runs.csv`, `replay_2x2x2.csv`, `labels.csv`, `truth.csv`, `truth_gate.csv`, `iteration_limit_share.csv`,
`cell_identity_test.csv` are written only when Gate A is PASS or after `--gate-ruling` (see README.md). They were written after Orchestrator ruling 1.

**Which gate field governs.** `GATE_VERDICT.json` -> `verdict.gateA` = `"FAIL"` is the MECHANICAL result of the pre-registered spec (4 misses of 174 runs, cap 3). `verdict.gateA_after_ruling` = `"ACCEPTED_DEVIATION"` is the status after Orchestrator ruling 1 (reworded 2026-11-23): the deviation is accepted and the runs are kept and flagged. Use `gateA_after_ruling` for "may the runs be used"; quote `gateA` when describing what the gate measured. Gate B is `PASS`.

**The four Gate A misses (`gate_miss`).** Column `gate_miss` in `replay_runs.csv`, `labels.csv`, `truth.csv` and `replay_2x2x2.csv`: blank for ordinary runs, `temp_only` (seq 136 and 147; only the water temperature differs from the log by 0.1 degC), `por_reading_rewritten` (seq 212), `rise_rate_only` (seq 217). seq 147 is a duplicate-run row (`used = 0`), so only seq 136 appears among the used runs for `temp_only`. No value of these runs was changed. **For seq 212 and 217 the S0 rows hold the REPLAYED chain** (computed from the 12:00 Point of Rocks reading as USGS rewrote it: 1860 cfs at 1.14 ft instead of the logged 1840 at 1.13); **the values that actually ran are the logged ones in `data/tidy/runs.csv`.**

## fidelity_table.csv (one row per predicted run and compared field; 280 runs x 45 fields)
| column | meaning |
|---|---|
| `seq`, `at_utc`, `used`, `ver` | run number in the log, run start, 1 = the row used for its clock hour, server version that ran it |
| `gate` | `A` (no old-curve value among the current reading, the 6-hour-back reading and the time-shifted reading) or `B` (at least one `f_old` value) |
| `field` | logged field (`hist.ts`, `hist.cfs`, `rise.r`, ..., `due`, `in.porHist.n`, `cur.por.q` ...) as in FIDELITY_SPEC section 3 |
| `counted` | 1 = counts toward a run's miss, 0 = informational |
| `logged`, `replayed` | values in the logged rounding (epoch ms for `hist.ts` and `in.porHist.firstT/lastT`; ISO text for `due`) |
| `difference` | replayed minus logged (milliseconds for `due`), blank for text fields or when one side is blank |
| `pass` | 1 if within the tolerance of the spec |
For Gate B runs `cur.por.q` is circular (the curve was fitted on that pair); it is tabulated, not a basis of any pass statement.

## fidelity_summary.csv
Section `field`: per field, runs compared, passes, rate, and the same split by Gate A and Gate B runs. Section `gate`: Gate A (runs, misses, cap, misses by category), Gate B (runs, `hist.cfs` exact/within 20 cfs/maximum absolute difference, `rise.r` exact), and the verdict.

## GATE_VERDICT.json, facts.json
Machine-readable verdict and counts (late stamps excluded, bin timeline consistency, identity test, truth gate, row counts).

## replay_runs.csv (one row per used run and scenario; 275 x 5 = 1,375 rows)
| column | meaning |
|---|---|
| `seq`, `at_utc`, `used`, `ver`, `scenario` | as above |
| `cur_q`, `cur_qT_utc`, `cur_prov`, `cur_extrap_flag` | current Point of Rocks reading the run used, its time, its provenance (`archive`, `f_old`, `current`) and, for `f_old` values (S0 and the S-old scenarios), the position of the reading's level: `observed` (a knot level of the window), `extrapolated_low` (below the window knots); under `S-old-C` also `observed_oct_knot` (1.01 and 1.02 ft). `interpolated` and `extrapolated_high` are defined but do not occur (every level in the knot range is a knot). Blank when the value is not `f_old` |
| `back6_ts_utc`, `back6_cfs`, `back6_prov`, `back6_extrap_flag` | the stored reading at or before 6 hours back (used by the rise rate and the flow state) |
| `hist_ts_utc`, `hist_cfs`, `hist_ago_h`, `hist_prov`, `hist_extrap_flag` | the time-shifted reading |
| `rise_r_pct_per_h`, `rise_rst` | rise rate and its flow state |
| `trv_t0_h`, `trv_t_h`, `trv_it`, `trv_stop`, `iteration_limit`, `trv_mult`, `trv_gf2lf_h`, `trv_nohist` | travel-time loop results; `iteration_limit` = 1 if the loop ended at the iteration limit (`trv_stop = max_iter`) |
| `lf_q`, `trib_sum_cfs` | Little Falls flow the run used; the four tributary flows as the model used them |
| `pre_cfs`, `delta_pct`, `delta_on`, `delta_decay`, `delta_ratio`, `por_est_cfs`, `ef_w`, `ef_used` | chain after the time shift |
| `raw_cfs`, `raw_cfs_unrounded`, `raw_stage_ft` | raw estimate (1 decimal, and unrounded) |
| `corr_bin`, `corr_st`, `corr_c`, `corr_unc`, `ceil_lim`, `ceil_bound`, `final_cfs`, `final_stage_ft` | learned correction, 120% cap, final estimate |
| `due_utc` | due time = frozen clock + `trv_gf2lf_h` |
| `bins_basis`, `approx_final` | `S0`: bins as they stood at the run (timeline from checks and snapshots), `approx_final = 0`. Other scenarios: bins frozen at their state before the first revised reading (the state used by seq 71), `approx_final = 1` ("approximate": learning is not replayed) |
| `approx_replay` | S0 only: 1 if the run is in Gate B and the Gate B verdict is not PASS |
| `s0_run_missed_a_counted_field` | S0 only: 1 if the run failed at least one counted field of the fidelity gate |
| `gate_miss` | see above (last column) |

## labels.csv (S0, used runs, 275 rows)
Provenance and old/new label of each value a run used: `cur_*` (current reading), `back6_*` (reading 6 hours back), `hist_*` (time-shifted reading). `old` = `archive` or `f_old`, `new` = `current`. Component labels (PLAN section 5): `label_flow_state_rise_rate` (current + 6-hour-back), `label_time_shift` (time-shifted reading), `label_delta_correction` (current + time-shifted), `label_all_three`; `mixed` = one of each. `gate` = A or B.

## iteration_limit_share.csv
Per scenario (used runs): share of runs whose travel-time loop ended at the iteration limit, over all runs, by S0 time-shift label, by S0 `label_all_three`, and by UTC day of the run. Columns: `scenario`, `group_type`, `group`, `n_runs`, `n_max_iter`, `share`.

## replay_2x2x2.csv (used runs x 3 old-rules x 8 cells = 6,600 rows)
Raw estimate only. `old_rule` = A, B or C (what "old" means). `flow_numbers` = old|new (which scenario's Point of Rocks numbers: the current reading and the stored history), `reading_pick_from` = old|new (the scenario whose run chose the timestamp and travel time of the time-shifted reading), `due_from` = old|new (the scenario whose `trv_gf2lf` sets the due time). `pure_cell` = 1 for (old,old,old) and (new,new,new), which reproduce the production function's raw estimate exactly (see `cell_identity_test.csv`). `empty` = 1 if the swapped timestamp had no reading in the other history and nothing fell inside the one-hour match window (count in `facts.json`). `exact_stamp_in_history` = 0 and `match_window_used` = 1 if the match window was used. Other columns: `raw_cfs`, `raw_cfs_unrounded`, `hist_ts_utc`, `hist_cfs`, `por_q_used`, `trv_t_of_pick_h` (travel time of the picking scenario, used in the decay), `delta_pct`, `delta_ratio`, `gf2lf_h`, `due_utc`, `pick_scenario_iteration_limit`. The iteration and the rise-rate shortening are not re-run.

## cell_identity_test.csv
For every predicted run (280) and each old rule (A, B, C): raw estimate of the separate post-iteration copy (`lib/post_iteration_copy.cjs`) against the production function's raw estimate in the all-old and all-new cell (exact equality), and equality of the due time. Failures: see `facts.json` (`cell_identity_test.failures`).

## truth.csv (used runs x 5 scenarios = 1,375 rows)
At each estimate's due time (the scenario's own `due_utc`): `t1_lf_cfs_interpolated` = Little Falls flow interpolated linearly between the neighbouring readings (`t1_neighbour_gap_min` = spacing of those readings); `t2_lf_cfs_first_run_at_or_after_due` = the Little Falls reading of the first successful job run whose frozen clock is at or after the due time (`t2_run_at_utc`, `t2_run_seq`, `t2_reading_time_utc`, `t2_delay_min`; `t2_within_2p5h_window` = the job validates only up to 2.5 h after due; `t2_ambiguous_within_3s` = the due time lies within 3 s of that run's clock). Due times after the last reading of the frozen record have blanks.

## truth_gate.csv
The 20 logged checks: T2 from the replayed due time of the run that made the prediction against the logged `actualCFS`. `traceable_in_log = 0` for the check whose prediction was made before the log begins (check 1); T2 is shown from its logged due time and is not part of the gate.

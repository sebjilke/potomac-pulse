# Third implementation (plan step 6): result

Status: COMPLETE. No STOP finding. This verifies the harness; it scores no arm. No error of any arm against the truth was computed.

## Checks

| Check | Result | Evidence |
|---|---|---|
| Lag view and arm-independent truth (`mask`, `mask_why`, `tau_ref`, `tau_converged`, `truth`, `truth_tick_utc`; also `lf_view`, `por_view`, carries) | PASS | 1,555 ticks in 4 windows, compared on all 4 arm rows: 0 differences. Max abs diff for `tau_ref` and `truth` is 0. |
| raw within 1 cfs | PASS | 6,220 tick x arm comparisons, 0 beyond tolerance, max abs diff 0 |
| travel_por_gf and travel_gf_lf within 0.01 h | PASS | 6,220 each, 0 beyond, max abs diff 0 |
| corr within 0.5 cfs (bin check through the chain, D-7 E6) | PASS | 6,220, 0 beyond, max abs diff 1.1e-11 |
| slot, validated, hard_flag, soft_flag exact (chain stores and validation times) | PASS | 6,220 each, 0 differences |
| Report-only fields: raw_unc, unc, disp, ceiling_applied, flow_bin, flow_state, rst, rate, stop, it, pct, b_active, delta_on, has_pred | all agree | 0 differences. Max abs diff: unc 1.1e-11, raw_unc 5.5e-12, disp 0 |
| Harness snapshots of other events inside the windows | not applicable | None falls inside any of the 4 windows |
| Seeded rebuild (1e-6 cfs) | PASS | pick = `default_rng(20261112).integers(0,4)` = 3, so event 53. Baseline replayed from empty bins, 2011-12-01T05:00Z through 2026-10-09T02:00Z (130,222 ticks: 23,520 validations, 34 hard-flagged, 2,302 soft-flagged, 11 missed-window replacements, 6 stale cleanups). All 18 bins x {count, sumError, sumErrorSq, meanError, emaMeanError}: abs diff 0.0. Pending slot: identical (created 2026-10-09T02:00Z, due ms 1791556317094, raw 1651, predicted 1390, 0-3000/falling, travel 12.5325 h). |

Events replayed (t0 order): 11 (2015-06-17T13Z to 2015-07-11T02Z, 566 ticks), 30 (2021-06-08T17Z to 2021-06-22T14Z, 334 ticks), 51 (2026-05-20T19Z to 2026-06-05T12Z, 378 ticks), 53 October 2026 (2026-10-09T03Z to 2026-10-20T15Z, 277 ticks).

The variants were exercised in every window, so the match is not trivial. The delta was active on 204 to 313 ticks per window. B's `rising` was active on 65 to 122 ticks per window. Arms A, B and C each differ from base in `raw` on many ticks, and my port reproduces those differences tick by tick.

## Findings
None. No difference survived, so there was nothing to adjudicate.

## Limits
- The hard-flag path and the missed-window replacement never occur inside the four windows. They are checked only indirectly, through the rebuild: 34 hard flags and 11 replacements over 15 years, with bins that end bit-identical. The `replaced` to `stored` slot mapping (ASSUMPTIONS 3) was never needed in a comparison.
- Window replays start from the harness state at t0-72 h. Only event 53's state was re-derived independently (the rebuild).
- The port follows production code read by me. If production and the harness share a misreading of the plan, this check cannot see it. The truth rule and the variants were written from the plan text, though.
- Production's critical-ice skip is not modelled (D-5 H4), identically to the harness.

## Files (this folder)
`rising_limb_model_check_python.py` (regenerates everything, about 15 s), `rising_limb_model_check.csv` (512 rows = 4 events x 4 arms x 32 fields), `rising_limb_model_check_rebuild.csv` (90 bin-field rows + 7 pending rows), `ASSUMPTIONS.md`, `LOG.md`, diagnostics `_replay_event{11,30,51,53}.csv` (my value next to the harness value per tick, arm and field) and `_run_summary.json`.

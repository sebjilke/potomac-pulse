# metrics_python LOG (blind Python metrics analyst, step 4)

Read so far: plan sections 0-7 and 12 (D-1..D-7), TICK_SCHEMA.md, production `getFlowMultiplier`,
`getGFtoLFTravelTime`, `getPoRtoGFTravelTime`, `getFlowState`, `getPoRRiseRateFromHistory` and the
travel constants in `netlify/functions/shared/model.js` (getPoRRiseRateFromHistory lives in shared/model.js
and is imported by scheduled-update.js). No forbidden file opened.

## 2026-11-11 step 1: checksums (manual shasum, before any script)
All 8 inputs match: 4 tick files vs GATE_RUN_MANIFEST.txt, events 978c6c2f..., both bootstrap index files vs
rising_limb_bootstrap_indices.sha256.txt, raw CSV d1d3f6a5... The script repeats this check (STOP on mismatch).

## run of rising_limb_metrics_python.py (assert-only)
step 1 checksums OK: {"rising_limb_ticks.csv": "8d841145905de1f6b6d217835c65229862ec6e115f33823c9472ffcfbfca0a6f", "rising_limb_ticks_S2.csv": "0407062ba39f5bb3381fab77b7418fbef984ab4c2de423a6b636d04b8079b0f4", "rising_limb_ticks_S3.csv": "33af47ce920bea6a51956e2e2deb06ff6a1d79d06cdb13f05e19f65e1f844f26", "rising_limb_ticks_multi.csv": "c99c4b56e3ae3edc47cda561a7322174d6797709e509ea63f8e0106e17064778", "rising_limb_events_python_v39.csv": "978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44", "hourly_backtest_data_v39.csv": "d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f", "rising_limb_bootstrap_indices.csv": "7eff92a751fd9cc0c6f8e0220998e98788cc2f293b5437088bf9376e1dd96519", "rising_limb_bootstrap_indices_nonoct.csv": "c1f50235edf229d65f8dcd0432f0a9699c752e3a67f7fac27e597c040a29ff5c"}
step 2: own lag view / tau_ref / truth / labels built. REC rebuilt from filled LF; events whose REC differs from the event file rec_start/rec_end/rec_n_stamps: []; overlapping labels: 0
event sets: GATE kept 21 [11, 12, 13, 16, 17, 21, 22, 25, 28, 30, 32, 34, 35, 39, 41, 43, 47, 48, 49, 51, 53]; non-Oct 20; Oct 53; holdout [47, 48, 49, 51]; STRATUM kept 15
- primary: {"truth_ticks_compared": 130987, "truth_mismatches": 1, "tau_mism": 1, "truth_val_mism": 1, "truth_tick_mism": 1, "mask_mism": 1, "conv_mism": 1, "mask_why_mism": 1, "lf_view_mism": 0, "por_view_mism": 0, "tau_max_abs_diff": 1.7763568394002505e-15, "label_mismatches": 0, "in_scoring_mism": 0, "masked_ticks": 127745, "n_tau_nonconverged_masked": 775, "n_tau_nonconverged_masked_scoring": 741}
    tick 2026-11-09T12:00:00.000Z: file tau=np.float64(11.420178853367457) truth=np.float64(1940.0) tt=2026-11-10T00:00:00.000Z mask=np.True_ conv=np.float64(1.0) | mine tau=np.float64(nan) truth=np.float64(nan) tt= mask=np.False_ conv=np.float64(nan) | file rl/rlx/rec/ew=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.float64(0.0) mine=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.int64(0)
- S2: {"truth_ticks_compared": 130987, "truth_mismatches": 1, "tau_mism": 1, "truth_val_mism": 1, "truth_tick_mism": 1, "mask_mism": 1, "conv_mism": 1, "mask_why_mism": 1, "lf_view_mism": 0, "por_view_mism": 0, "tau_max_abs_diff": 1.7763568394002505e-15, "label_mismatches": 0, "in_scoring_mism": 0, "masked_ticks": 127400, "n_tau_nonconverged_masked": 755, "n_tau_nonconverged_masked_scoring": 721}
    tick 2026-11-09T12:00:00.000Z: file tau=np.float64(11.420178853367457) truth=np.float64(1940.0) tt=2026-11-10T00:00:00.000Z mask=np.True_ conv=np.float64(1.0) | mine tau=np.float64(nan) truth=np.float64(nan) tt= mask=np.False_ conv=np.float64(nan) | file rl/rlx/rec/ew=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.float64(0.0) mine=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.int64(0)
- S3: {"truth_ticks_compared": 130987, "truth_mismatches": 1, "tau_mism": 1, "truth_val_mism": 1, "truth_tick_mism": 1, "mask_mism": 1, "conv_mism": 1, "mask_why_mism": 1, "lf_view_mism": 0, "por_view_mism": 0, "tau_max_abs_diff": 1.7763568394002505e-15, "label_mismatches": 0, "in_scoring_mism": 0, "masked_ticks": 127575, "n_tau_nonconverged_masked": 763, "n_tau_nonconverged_masked_scoring": 729}
    tick 2026-11-09T12:00:00.000Z: file tau=np.float64(11.420178853367457) truth=np.float64(1940.0) tt=2026-11-10T00:00:00.000Z mask=np.True_ conv=np.float64(1.0) | mine tau=np.float64(nan) truth=np.float64(nan) tt= mask=np.False_ conv=np.float64(nan) | file rl/rlx/rec/ew=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.float64(0.0) mine=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.int64(0)
- multi: {"truth_ticks_compared": 130987, "truth_mismatches": 1, "tau_mism": 1, "truth_val_mism": 1, "truth_tick_mism": 1, "mask_mism": 1, "conv_mism": 1, "mask_why_mism": 1, "lf_view_mism": 0, "por_view_mism": 0, "tau_max_abs_diff": 1.7763568394002505e-15, "label_mismatches": 0, "in_scoring_mism": 0, "masked_ticks": 127745, "n_tau_nonconverged_masked": 775, "n_tau_nonconverged_masked_scoring": 741}
    tick 2026-11-09T12:00:00.000Z: file tau=np.float64(11.420178853367457) truth=np.float64(1940.0) tt=2026-11-10T00:00:00.000Z mask=np.True_ conv=np.float64(1.0) | mine tau=np.float64(nan) truth=np.float64(nan) tt= mask=np.False_ conv=np.float64(nan) | file rl/rlx/rec/ew=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.float64(0.0) mine=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.int64(0)

**STOP**: truth/label mismatches: {"primary": {"truth_ticks_compared": 130987, "truth_mismatches": 1, "tau_mism": 1, "truth_val_mism": 1, "truth_tick_mism": 1, "mask_mism": 1, "conv_mism": 1, "mask_why_mism": 1, "lf_view_mism": 0, "por_view_mism": 0, "tau_max_abs_diff": 1.7763568394002505e-15, "label_mismatches": 0, "in_scoring_mism": 0, "masked_ticks": 127745, "n_tau_nonconverged_masked": 775, "n_tau_nonconverged_masked_scoring": 741}, "S2": {"truth_ticks_compared": 130987, "truth_mismatches": 1, "tau_mism": 1, "truth_val_mism": 1, "truth_tick_mism": 1, "mask_mism": 1, "conv_mism": 1, "mask_why_mism": 1, "lf_view_mism": 0, "por_view_mism": 0, "tau_max_abs_diff": 1.7763568394002505e-15, "label_mismatches": 0, "in_scoring_mism": 0, "masked_ticks": 127400, "n_tau_nonconverged_masked": 755, "n_tau_nonconverged_masked_scoring": 721}, "S3": {"truth_ticks_compared": 130987, "truth_mismatches": 1, "tau_mism": 1, "truth_val_mism": 1, "truth_tick_mism": 1, "mask_mism": 1, "conv_mism": 1, "mask_why_mism": 1, "lf_view_mism": 0, "por_view_mism": 0, "tau_max_abs_diff": 1.7763568394002505e-15, "label_mismatches": 0, "in_scoring_mism": 0, "masked_ticks": 127575, "n_tau_nonconverged_masked": 763, "n_tau_nonconverged_masked_scoring": 729}, "multi": {"truth_ticks_compared": 130987, "truth_mismatches": 1, "tau_mism": 1, "truth_val_mism": 1, "truth_tick_mism": 1, "mask_mism": 1, "conv_mism": 1, "mask_why_mism": 1, "lf_view_mism": 0, "por_view_mism": 0, "tau_max_abs_diff": 1.7763568394002505e-15, "label_mismatches": 0, "in_scoring_mism": 0, "masked_ticks": 127745, "n_tau_nonconverged_masked": 775, "n_tau_nonconverged_masked_scoring": 741}}

## 2026-11-11 analyst note after the assert-only run: STOPPED before any arm metric
- Own code re-checked against plan section 2/4, D-5 H1-H3, H6, H12 and TICK_SCHEMA section 5. The single
  mismatch (identical in all four files) is an end-of-grid reading, not a coding slip:
  tick 2026-11-09T12:00Z (ew_any = 0, no RL/RLX/REC label, in_scoring = 1, i.e. a NORMAL-hours tick).
  File: mask = 1, mask_why = ok, tau_ref = 11.420178853367455, tau_converged = 1, truth = 1940,
  truth_tick_utc = 2026-11-10T00:00:00.000Z.
  Mine: mask = 0, mask_why = tau_lf_missing, tau/truth blank.
  Cause: the file reads the LF view at tick 2026-11-10T00:00Z (= LF stamp 2026-11-09 23:00), one hour beyond the
  last tick of the D-5 H1 grid (2026-11-09T23:00Z). Under the literal plan text ("the first tick v >= t + tau",
  ticks per H1) that tick does not exist, so no truth. The harness itself does not apply the "view beyond the grid"
  reading consistently: ticks 13:00 to 23:00 are tau_lf_missing in the file, although a view at 01:00 would carry
  from the 23:00 stamp under the same reading.
- Everything else agrees exactly on all 130,987 ticks of all four files: lf_view and por_view 0 mismatches,
  tau max |diff| 1.8e-15 h, labels (RL, RLX, REC, EW, normal) 0 mismatches, in_scoring 0, arm order, tick-level
  columns identical across arm rows, has_pred == 1 on every masked row, REC rebuilt from raw = event file.
- Per the brief (E8) this is a STOP: no arm metric computed. Needs an orchestrator ruling (deviation) on the tick:
  (a) accept the file's truth for 2026-11-09T12:00Z, or (b) treat it as unmasked (literal). Affects only the
  normal-hours criteria G4a/G4b (one tick).
- State for resumption: rising_limb_metrics_python.py contains steps 1-2 (run, tested) and the step-3 gate-metric
  code (written, NEVER RUN). The report-only code (planned module rising_limb_report_only_python) is not written
  yet and should be folded into the single script. After a ruling, change the step-2 STOP to apply the ruling
  (documented in ASSUMPTIONS.md), then run without --assert-only.

## 2026-11-11 resume after ruling D-8 (plan section 12, commit e5375a8; read D-8 only)
- Script edited: explicit commented D-8 override in load_ticks (tick 2026-11-09T12:00Z -> mask 0 in all four runs;
  `mask_file` keeps the mask as written); step 2 now asserts that this tick is the ONLY truth/mask difference,
  that masks agree after the override, and that no RL/RLX/REC-labelled tick has truth_tick_utc /
  truth_basehz_tick / truth_own_tick after 2026-11-09T23:00Z (STOP otherwise). G4a_edge / G4b_edge added
  (file mask, report-only, not in ARM). CHECK rows per D-8 item 5. Report-only code folded into the same script
  (step 4, run after the gate files are written).

## run of rising_limb_metrics_python.py (full)
step 1 checksums OK: {"rising_limb_ticks.csv": "8d841145905de1f6b6d217835c65229862ec6e115f33823c9472ffcfbfca0a6f", "rising_limb_ticks_S2.csv": "0407062ba39f5bb3381fab77b7418fbef984ab4c2de423a6b636d04b8079b0f4", "rising_limb_ticks_S3.csv": "33af47ce920bea6a51956e2e2deb06ff6a1d79d06cdb13f05e19f65e1f844f26", "rising_limb_ticks_multi.csv": "c99c4b56e3ae3edc47cda561a7322174d6797709e509ea63f8e0106e17064778", "rising_limb_events_python_v39.csv": "978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44", "hourly_backtest_data_v39.csv": "d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f", "rising_limb_bootstrap_indices.csv": "7eff92a751fd9cc0c6f8e0220998e98788cc2f293b5437088bf9376e1dd96519", "rising_limb_bootstrap_indices_nonoct.csv": "c1f50235edf229d65f8dcd0432f0a9699c752e3a67f7fac27e597c040a29ff5c"}
step 2: own lag view / tau_ref / truth / labels built. REC rebuilt from filled LF; events whose REC differs from the event file rec_start/rec_end/rec_n_stamps: []; overlapping labels: 0
event sets: GATE kept 21 [11, 12, 13, 16, 17, 21, 22, 25, 28, 30, 32, 34, 35, 39, 41, 43, 47, 48, 49, 51, 53]; non-Oct 20; Oct 53; holdout [47, 48, 49, 51]; STRATUM kept 15
- primary: {"truth_ticks_compared": 130987, "truth_mismatches": 1, "truth_mismatches_after_override": 0, "d8_tick_is_mismatch": true, "labelled_ticks_truth_beyond_grid": 0, "ticks_any_truth_beyond_grid": 2, "tau_mism": 1, "truth_val_mism": 1, "truth_tick_mism": 1, "mask_mism": 1, "conv_mism": 1, "mask_why_mism": 1, "lf_view_mism": 0, "por_view_mism": 0, "tau_max_abs_diff": 1.7763568394002505e-15, "label_mismatches": 0, "in_scoring_mism": 0, "masked_ticks_file": 127745, "masked_ticks_after_override": 127744, "n_tau_nonconverged_masked": 741, "n_tau_nonconverged_masked_all_ticks_file": 775}
    tick 2026-11-09T12:00:00.000Z: file tau=np.float64(11.420178853367457) truth=np.float64(1940.0) tt=2026-11-10T00:00:00.000Z mask=np.True_ conv=np.float64(1.0) | mine tau=np.float64(nan) truth=np.float64(nan) tt= mask=np.False_ conv=np.float64(nan) | file rl/rlx/rec/ew=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.float64(0.0) mine=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.int64(0)
- S2: {"truth_ticks_compared": 130987, "truth_mismatches": 1, "truth_mismatches_after_override": 0, "d8_tick_is_mismatch": true, "labelled_ticks_truth_beyond_grid": 0, "ticks_any_truth_beyond_grid": 2, "tau_mism": 1, "truth_val_mism": 1, "truth_tick_mism": 1, "mask_mism": 1, "conv_mism": 1, "mask_why_mism": 1, "lf_view_mism": 0, "por_view_mism": 0, "tau_max_abs_diff": 1.7763568394002505e-15, "label_mismatches": 0, "in_scoring_mism": 0, "masked_ticks_file": 127400, "masked_ticks_after_override": 127399, "n_tau_nonconverged_masked": 721, "n_tau_nonconverged_masked_all_ticks_file": 755}
    tick 2026-11-09T12:00:00.000Z: file tau=np.float64(11.420178853367457) truth=np.float64(1940.0) tt=2026-11-10T00:00:00.000Z mask=np.True_ conv=np.float64(1.0) | mine tau=np.float64(nan) truth=np.float64(nan) tt= mask=np.False_ conv=np.float64(nan) | file rl/rlx/rec/ew=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.float64(0.0) mine=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.int64(0)
- S3: {"truth_ticks_compared": 130987, "truth_mismatches": 1, "truth_mismatches_after_override": 0, "d8_tick_is_mismatch": true, "labelled_ticks_truth_beyond_grid": 0, "ticks_any_truth_beyond_grid": 2, "tau_mism": 1, "truth_val_mism": 1, "truth_tick_mism": 1, "mask_mism": 1, "conv_mism": 1, "mask_why_mism": 1, "lf_view_mism": 0, "por_view_mism": 0, "tau_max_abs_diff": 1.7763568394002505e-15, "label_mismatches": 0, "in_scoring_mism": 0, "masked_ticks_file": 127575, "masked_ticks_after_override": 127574, "n_tau_nonconverged_masked": 729, "n_tau_nonconverged_masked_all_ticks_file": 763}
    tick 2026-11-09T12:00:00.000Z: file tau=np.float64(11.420178853367457) truth=np.float64(1940.0) tt=2026-11-10T00:00:00.000Z mask=np.True_ conv=np.float64(1.0) | mine tau=np.float64(nan) truth=np.float64(nan) tt= mask=np.False_ conv=np.float64(nan) | file rl/rlx/rec/ew=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.float64(0.0) mine=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.int64(0)
- multi: {"truth_ticks_compared": 130987, "truth_mismatches": 1, "truth_mismatches_after_override": 0, "d8_tick_is_mismatch": true, "labelled_ticks_truth_beyond_grid": 0, "ticks_any_truth_beyond_grid": 2, "tau_mism": 1, "truth_val_mism": 1, "truth_tick_mism": 1, "mask_mism": 1, "conv_mism": 1, "mask_why_mism": 1, "lf_view_mism": 0, "por_view_mism": 0, "tau_max_abs_diff": 1.7763568394002505e-15, "label_mismatches": 0, "in_scoring_mism": 0, "masked_ticks_file": 127745, "masked_ticks_after_override": 127744, "n_tau_nonconverged_masked": 741, "n_tau_nonconverged_masked_all_ticks_file": 775}
    tick 2026-11-09T12:00:00.000Z: file tau=np.float64(11.420178853367457) truth=np.float64(1940.0) tt=2026-11-10T00:00:00.000Z mask=np.True_ conv=np.float64(1.0) | mine tau=np.float64(nan) truth=np.float64(nan) tt= mask=np.False_ conv=np.float64(nan) | file rl/rlx/rec/ew=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.float64(0.0) mine=np.float64(nan)/np.float64(nan)/np.float64(nan)/np.int64(0)
step 2 assertions PASSED on all four files (D-8 override applied: the only difference is 2026-11-09T12:00:00.000Z).
step 3: gate metrics computed for run primary
step 3: gate metrics computed for run S2
step 3: gate metrics computed for run S3
step 3: gate metrics computed for run multi
wrote rising_limb_metrics_python.csv (5148 rows) and .json
step 4: report-only items computed for run primary
step 4: report-only items computed for run S2
step 4: report-only items computed for run S3
step 4: report-only items computed for run multi
wrote rising_limb_report_only_python.csv (2544 rows)
- Full run done (~24 s). Step 2: in each of the four files exactly 1 truth/mask difference before the override
  (the D-8 tick), 0 after; 0 label mismatches; 0 labelled ticks with any truth tick beyond 2026-11-09T23:00Z
  (2 unlabelled ticks in total carry a truth tick beyond the grid in some truth column; neither is in any window).
  Wrote rising_limb_metrics_python.csv (5148 rows) + .json, step2_check.json, then
  rising_limb_report_only_python.csv (2544 rows); ASSUMPTIONS.md updated. REPORT_ONLY_README.md could NOT be written:
  the tool harness blocked the file write (no .md report files from subagents); its content was returned to the
  orchestrator in the hand-back message instead.
  Structural checks: no NaN/inf values, all required criteria present for all four runs.
- STATUS: COMPLETE.

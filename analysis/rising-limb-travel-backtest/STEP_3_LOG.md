# STEP 3 (first half) log: harness + baseline identity
Started 2026-11-10. Repo HEAD at start: ffcc83d3cb4b022c6f9544661cf8271f3b45f266
## Input hashes (verified at start)
- hourly_backtest_data_v39.csv d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f OK
- rising_limb_events_python_v39.csv 978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44 OK
- rising_limb_bootstrap_indices.csv 7eff92a751fd9cc0c6f8e0220998e98788cc2f293b5437088bf9376e1dd96519 OK
- rising_limb_bootstrap_indices_nonoct.csv c1f50235edf229d65f8dcd0432f0a9699c752e3a67f7fac27e597c040a29ff5c OK
## Progress
- [1] Read plan; anchors all verified present once in scheduled-update.js at HEAD (lines 797/490/817/818/831/837/871/882/888/982/955/957/1150/1367/1202/1244, same as plan hints).
- Design: drift_lib.mjs (anchor extraction), generate_copies.mjs -> rising_limb_model_variants.mjs + rising_limb_learning_gate.mjs (generated, never hand-edited), rising_limb_harness.mjs, tests/*.test.mjs.
- Interpretations (not ambiguities, plan/step-2 consistent): lag carry = stamps s, s-1h..s-3h; history = non-blank s' in [t-72h, t-2h] stamped s'+30min (same as step-2 script rise_rate); 2.5 h search = offsets 0,1,2 ticks (D-1 C2); ticks = every UTC hour from first to last CSV stamp.
- Not modelled (plan silent): production's criticalIce skip of validation/prediction.
- [2] drift_lib.mjs + generate_copies.mjs written; generated rising_limb_model_variants.mjs / rising_limb_learning_gate.mjs (preamble start anchor not unique file-wide: handled as last occurrence after validatePendingPredictions, extra guard).
- [3] rising_limb_harness.mjs (lag view, ArmChain single-slot, truth, labels, tickRow schema, runPreconditions) + preconditions.mjs written. Full-record run (STEP_3_PRECONDITIONS.json, counts only):
  - P1 identity: base vs production makeGFPrediction, return + trace, zero tolerance: 127,874 / 127,874 exact.
  - Invariants (raw + trace to rawUnc): B=base not rising 105,744 ok/0 fail; A=base delta off 66,018/0; C=A B inactive 105,744/0; C=B delta off 66,046/0.
  - Common mask vs step-2 event file: RL tick counts 53/53, scored RL ticks 53/53 equal; REC stamp counts 53/53 equal.
  - P3 (base convergence only): October RL rising ticks on mask 26, max_iter 9 = 34.6% (>=20%) PASS.
  - P4 (harness base raw vs 20 logged hard-flag raw): 20/20 within max(5%,150).
  - No arm error vs truth computed or displayed.
- [4] BUG FOUND by chain test and FIXED: binRead hook returned the bin instead of the row {data: bin}, so every validation started from an empty bin (learning was inert). Identity numbers in entry [3] were computed with the bug and are superseded by the rerun below.
- [5] Rerun after the fix, `node --test tests/*.test.mjs` from this folder: 33 pass, 0 fail. Identity 127,874/127,874 exact; invariants 0 fail (105,744 / 66,018 / 105,744 / 66,046 ticks); mask and REC equal the event file (53/53); P3 9/26 = 34.6% PASS; P4 20/20 within tolerance (max |diff| 6.5% / 444 cfs vs logged, all inside max(5%,150)).
- git status: only new untracked files under analysis/rising-limb-travel-backtest/. npm test glob (test/**) cannot reach tests/ here (asserted in drift.test.mjs).
## Remaining for second half of step 3
- Write the arms' tick file (rising_limb_ticks.csv) with H.tickRow (schema TICK_COLUMNS) via one gate run + run log with input hashes; no error computed in the harness.
- Open points: ticks span first..last CSV stamp (no ticks past the last stamp); production's criticalIce skip not modelled (plan silent); label for overlapping windows joins ids with '|'.

## Reviewer fixes (after D-5), 2026-11-10
- Done: MUST 1 truth_basehz/_tick, truth_own/_tick (lfViewAtTime at base / own travel_gf_lf); MUST 2 `rising` -> `b_active`, `base_rst` on every row; MUST 3 raw/unc/disp documented per D-5 H8; MUST 4 `in_scoring`.
- Done: SHOULD 6 drift header uses git blob hash, blob line excluded from comparison; 7 production_fingerprints.json (validation loop head, storePrediction, handler validate/predict/store segments + order), with negative tests; 8 per-tick invariants A_travel_eq_base, C_travel_eq_B, C_porEst_delta_on; 9 run_gate.mjs prepared (NOT run): refuses without --i-am-the-single-gate-run, refuses if any output exists, runs all tests + preconditions in the same invocation, writes primary + S2 + S3 + multi tick files, t0-72h snapshots, run log (node version, hashes); 10 por_carry_h / lf_carry_h.
- Done: MINOR retries counter, epsilon comment + schema note, H9 STOP in labelTick (all 130,987 ticks labelled without a STOP), hook-line-vs-anchor test. TICK_SCHEMA.md written.
- Dry-run of run_gate.mjs on a 1,500-tick burn-in slice into a temp dir (deleted): plumbing, 50 columns, 4 files OK. No tick file exists in the project.
- Open question Q1 (plan silent): truth and mask under S2/S3 views. Prepared as: same view's LF lag for the truth. S3 history upper bound t-1 h with +30 min stamps; S2 history up to t with stamp s'. Needs orchestrator confirmation before the gate run.
- Open question Q2: snapshot at t0-72 h is taken AFTER completing that tick (plan: "saved at t0 minus 72 h").
- Results after fixes: 45 tests pass / 0 fail. Identity 127,874/127,874; invariants 105,744/66,018/105,744/66,046 and new 127,874/127,874/61,828, all 0 fail; mask+REC 53/53; P3 9/26; P4 20/20.
- A mistaken command line of mine tried to launch the real gate run; the permission system blocked it before anything ran; verified no output files exist.

## Last reviewer fixes (D-5 H12 to H15)
- H12 done: runReplay computes truth/tau/rise rate with the PRIMARY view for S2, S3 and multi; mask = primary mask AND view PoR/LF exist (mask_why view_input_missing). truth_basehz/own use the primary LF view at the file's own travel time. Tested (tau_ref, truth, labels identical across views).
- H15 done: run_gate.mjs refuses on any uncommitted/untracked file under the folder (porcelain, own outputs excepted), logs git commit + sha256 of every .mjs (incl. tests), TICK_SCHEMA.md, production_fingerprints.json and the plan. Not exercised on a clean tree (tree is dirty; running it with the flag is forbidden here).
- Dry-run capped to --limit <= 8,779 (burn-in ticks only); verified 9000 is refused; temp outputs deleted.
- H13 done: snapshot = state after the full tick, plus `written` keys; documented in TICK_SCHEMA.md (resume at t0-71 h, never-written bins = count 0). Schema wording for G7d, G7b (H14), bootstrap events done.
- Open: Q1 is resolved by H12 (S2/S3 truth = primary). Q2 resolved by H13.
- Results: 47 tests pass; identity 127,874/127,874; invariants unchanged (all 0 fail); mask/REC 53/53; P3 9/26; P4 20/20. No tick file exists; no arm error computed.

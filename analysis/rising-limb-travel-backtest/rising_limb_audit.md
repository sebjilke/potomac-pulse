# Rising-limb travel backtest (A7): independent audit, step 7

Auditor: fresh Opus subagent, 2026-11-11. It ran none of steps 1 to 6 and was the first to read any metric value.
Scope: plan `analysis/rising-limb-travel-backtest-plan-2026-11-10.md`, sections 3 to 7 and deviations D-1 to D-9.
Every table below can be rebuilt from a script in `audit_work/` (named in each section). No existing file was changed. The gate was not rerun, nothing was committed, and nothing was installed.

## 1. Verdict of the audit

**The numbers can be trusted, within the plan's own limits (section 8) and the limits in section 5 below.**

- Every input and output hash matches. Both bootstrap index files regenerate bit for bit from the seeds.
- Python and R agree on all 5,148 shared rows. The largest gap on a gate quantity is 5.5e-11 (G4a). Counts, ids and pass flags are identical.
- My own recomputation from the tick file matches both analysts on every criterion and every arm.
- The guards pass:
  - the baseline equals production on 127,874 of 127,874 ticks;
  - all seven invariants show 0 failures;
  - the drift tests pass, and my independent text diff agrees;
  - 47 of 47 tests pass on rerun.
- The third implementation reproduces its own files byte for byte, and it matches the harness.
- The live USGS spot checks agree within tolerance on every comparable stamp.

I found no implementation bug that touches a gate quantity. Confidence: high for the arithmetic and the data path. It is lower, as the plan already says, for what the replay means for live behaviour.

## 2. Outcome under section 5

**FAIL. No arm meets every applicable criterion.** Preconditions hold: P1 passes, P2 is frozen, and P3 is 34.6% against a 20% floor. There are 20 non-October GATE events against a floor of 15, so this is not FAIL-INSUFFICIENT, and it is not a STOP.

| Arm | Failed criteria (primary run) | Binding criterion |
|---|---|---|
| A | G7f only | **G7f**: displayed-error gain on the rising limb is -5.49% (needs >= 0) |
| B | G1a, G1b, G4b, G6a, G6b, G7d, G7f | **G1a**: gain +5.98% (needs >= 15%); also G1b +6.33% (needs >= 10%), G4b worst cell +10.58%, G6a, G6b, G7d own horizon -1.34%, G7f -4.55% |
| C | G4b, G7f | **G4b**: worst cell (12,000-25,000 cfs, rising) +7.48% (needs <= +5%); and **G7f** -8.27% |

Per section 5 the item closes. No retuning and no rerun on the same data.

For the reader: A and C pass every originally approved threshold (15%/10% gain, 65% breadth, 2% normal hours, recession bias). They fail only on rows the plan added as tightenings (G7f; for C also G4b; plan section 5 note: "Rows G4b, G6, G7a to G7f only tighten"). This explains the result. It does not change it.

## 3. Gate table (primary run; Python and R values side by side)

N = 21 included GATE-class events (20 non-October plus October 2026, event 53). Holdout H = events 47, 48, 49, 51 (ceil(0.20 x 20) = 4). P3 (base, October RL rising ticks on the common mask): 9 of 26 = **34.6%**, threshold >= 20%, **pass** (Python and R identical).

D-3 caveat for every October-specific number (P3, G1a versus G1b, the October drop in G6a): the October 2026 event lies wholly in the freshly fetched, provisional part of `hourly_backtest_data_v39.csv`. That part sits on a later USGS revision state than the months before it, and it differs from what the cron saw live. On 2026-11-11 the live provisional values still equal the file (section 4.7).

Source: `audit_work/a11_gate_table.py`. In the last column the auditor applies the threshold to the value. Every one of these agrees with both analysts' pass flags.

| Id | Arm | Quantity | Python | R | Threshold | Auditor |
|---|---|---|---|---|---|---|
| G1a | A | gain [95% CI] | +36.57% [+29.41%, +42.37%] | +36.57% [+29.41%, +42.37%] | >= 15% and CI lo > 0 | pass |
| G1b | A | gain [95% CI] | +35.46% [+27.65%, +41.10%] | +35.46% [+27.65%, +41.10%] | >= 10% and CI lo > 0 | pass |
| G2 | A | improved / N | 18/21 (85.7%) | 18/21 (85.7%) | improved x100 >= 65 x N | pass |
| G3a | A | D_bias pp [95% CI] | -0.110 [-0.209, +0.193] | -0.110 [-0.209, +0.193] | <= 0 and CI hi <= +1.0 pp | pass |
| G3b | A | abs bias pp | 0.153 | 0.153 | <= 1.6 pp | pass |
| G4a | A | rel change normal MAE | -0.40% | -0.40% | <= +2% | pass |
| G4b | A | worst cell rel change | +2.44% (18 cells) | +2.44% (18 cells) | every cell <= +5% | pass |
| G5b | A | share(A) - share(base) all / noOct | +0.00% / +0.00% | +0.00% / +0.00% | <= 0 in both | pass |
| G6a | A | min LOEO gain (i) / (ii) | +34.05% / +32.64% | +34.05% / +32.64% | (i) >= 15% (Oct drop 10%), (ii) >= 10%, breadth >= 65% every drop | pass |
| G6b | A | holdout gain, improved/4 | +31.67%, 4/4 | +31.67%, 4/4 | >= 10% and >= 65% (3 of 4) | pass |
| G7a | A | raw MAE gain | +38.42% | +38.42% | > 0 | pass |
| G7b | A | MAPE gain | +37.54% | +37.54% | > 0 | pass |
| G7c | A | RLX gain | +27.17% | +27.17% | >= 0 | pass |
| G7d | A | gain base hz / own hz | +34.91% / +34.91% | +34.91% / +34.91% | both >= 0 | pass |
| G7e | A | lookup-fail share arm / base | 0.00% / 0.00% | 0.00% / 0.00% | not above base | pass |
| G7f | A | displayed-error gain | -5.49% | -5.49% | >= 0 | **FAIL** |
| G1a | B | gain [95% CI] | +5.98% [+2.99%, +9.33%] | +5.98% [+2.99%, +9.33%] | >= 15% and CI lo > 0 | **FAIL** |
| G1b | B | gain [95% CI] | +6.33% [+3.28%, +9.75%] | +6.33% [+3.28%, +9.75%] | >= 10% and CI lo > 0 | **FAIL** |
| G2 | B | improved / N | 15/21 (71.4%) | 15/21 (71.4%) | improved x100 >= 65 x N | pass |
| G3a | B | D_bias pp [95% CI] | -0.037 [-0.068, +0.077] | -0.037 [-0.068, +0.077] | <= 0 and CI hi <= +1.0 pp | pass |
| G3b | B | abs bias pp | 0.227 | 0.227 | <= 1.6 pp | pass |
| G4a | B | rel change normal MAE | +1.28% | +1.28% | <= +2% | pass |
| G4b | B | worst cell rel change | +10.58% (18 cells) | +10.58% (18 cells) | every cell <= +5% | **FAIL** |
| G5a | B | non-converged share all / noOct | 1.56% / 1.65% | 1.56% / 1.65% | < 5% in both | pass |
| G6a | B | min LOEO gain (i) / (ii) | +5.18% / +5.50% | +5.18% / +5.50% | as above | **FAIL** |
| G6b | B | holdout gain, improved/4 | +9.08%, 2/4 | +9.08%, 2/4 | >= 10% and 3 of 4 | **FAIL** |
| G7a | B | raw MAE gain | +2.91% | +2.91% | > 0 | pass |
| G7b | B | MAPE gain | +6.31% | +6.31% | > 0 | pass |
| G7c | B | RLX gain | +5.05% | +5.05% | >= 0 | pass |
| G7d | B | gain base hz / own hz | +5.52% / -1.34% | +5.52% / -1.34% | both >= 0 | **FAIL** |
| G7e | B | lookup-fail share arm / base | 0.00% / 0.00% | 0.00% / 0.00% | not above base | pass |
| G7f | B | displayed-error gain | -4.55% | -4.55% | >= 0 | **FAIL** |
| G1a | C | gain [95% CI] | +36.07% [+28.06%, +41.90%] | +36.07% [+28.06%, +41.90%] | >= 15% and CI lo > 0 | pass |
| G1b | C | gain [95% CI] | +34.65% [+26.08%, +40.19%] | +34.65% [+26.08%, +40.19%] | >= 10% and CI lo > 0 | pass |
| G2 | C | improved / N | 17/21 (81.0%) | 17/21 (81.0%) | improved x100 >= 65 x N | pass |
| G3a | C | D_bias pp [95% CI] | -0.159 [-0.236, +0.232] | -0.159 [-0.236, +0.232] | <= 0 and CI hi <= +1.0 pp | pass |
| G3b | C | abs bias pp | 0.104 | 0.104 | <= 1.6 pp | pass |
| G4a | C | rel change normal MAE | +0.54% | +0.54% | <= +2% | pass |
| G4b | C | worst cell rel change | +7.48% (18 cells) | +7.48% (18 cells) | every cell <= +5% | **FAIL** |
| G5a | C | non-converged share all / noOct | 1.56% / 1.65% | 1.56% / 1.65% | < 5% in both | pass |
| G6a | C | min LOEO gain (i) / (ii) | +34.05% / +32.31% | +34.05% / +32.31% | as above | pass |
| G6b | C | holdout gain, improved/4 | +30.72%, 3/4 | +30.72%, 3/4 | >= 10% and 3 of 4 | pass |
| G7a | C | raw MAE gain | +34.80% | +34.80% | > 0 | pass |
| G7b | C | MAPE gain | +37.25% | +37.25% | > 0 | pass |
| G7c | C | RLX gain | +26.54% | +26.54% | >= 0 | pass |
| G7d | C | gain base hz / own hz | +33.80% / +30.49% | +33.80% / +30.49% | both >= 0 | pass |
| G7e | C | lookup-fail share arm / base | 0.00% / 0.00% | 0.00% / 0.00% | not above base | pass |
| G7f | C | displayed-error gain | -8.27% | -8.27% | >= 0 | **FAIL** |

Applicability (plan section 5): G5a applies to B and C, and G5b to A; every other criterion applies to all three arms. For reference, the base non-converged share on RL rising ticks is 7.78% (35/450, all events) and 6.13% (26/424, no October). G4b worst cells: A 50000+ rising, B and C 12000-25000 rising (`audit_work/a3_recompute.py`).

Report-only, never deciding (D-8): G4a_edge A -0.4011%, B +1.2814%, C +0.5358%; G4b_edge equals G4b to all printed digits (A +2.44%, B +10.58%, C +7.48%). The D-8 tick changes G4a by at most 1e-6 in absolute terms (for example A -0.0040116 versus -0.0040115), and does not change G4b at all.

Excluded GATE-class events (event file `exclusion_reasons`; 34 GATE detected, 13 excluded, 21 kept):

| Event id | t0 (UTC) | Peak LF (cfs) | Reason |
|---|---|---|---|
| 1 | 2012-09-19 19:00 | 15,600 | X0 burn-in + X2 outage |
| 3 | 2012-10-29 19:00 | 140,500 | X0 burn-in |
| 4 | 2012-12-21 12:00 | 20,150 | X1 ice risk |
| 8 | 2014-08-12 16:00 | 12,050 | X2 outage |
| 14 | 2015-12-02 05:00 | 19,000 | X1 |
| 15 | 2016-01-26 17:00 | 118,500 | X1 + X2 + X3 (0 scored RL ticks) |
| 18 | 2017-01-03 22:00 | 17,400 | X1 |
| 23 | 2018-01-13 15:00 | 13,300 | X1 + X2 |
| 26 | 2019-12-15 18:00 | 17,400 | X1 |
| 29 | 2020-11-30 17:00 | 15,700 | X1 |
| 37 | 2022-01-03 09:00 | 15,500 | X1 |
| 42 | 2022-12-15 20:00 | 44,700 | X1 |
| 50 | 2026-02-17 12:00 | 32,700 | X1 |

Kept GATE events: ids 11, 12, 13, 16, 17, 21, 22, 25, 28, 30, 32, 34, 35, 39, 41, 43, 47, 48, 49, 51, 53 (October).

## 4. Checks performed

### 4.1 Integrity (`audit_work/a1_regen_bootstrap.py`, plus shasum)
- The four tick files, the snapshot JSON and the run log match `GATE_RUN_MANIFEST.txt` exactly.
- The event file (978c6c2f...), the R event copy (6faa963f...), the raw CSV (d1d3f6a5...) and both bootstrap files (7eff92a7..., c1f50235...) match D-2/D-3.
- All 26 step 4 to 6 output files pass `shasum -c STEP_4_5_6_OUTPUTS.sha256.txt`.
- I regenerated both bootstrap matrices from `default_rng(20261110)` with numpy 2.0.2, using N = 21 and N_nonOct = 20 with events sorted by t0. Both shapes and sha256 values match.

### 4.2 Cross-language agreement (`audit_work/a2_agreement.py`, output `a2_agreement_by_criterion.csv`)
- Join on run, criterion, arm, subset, stat, key: Python has 5,148 rows and R has 5,156. All 5,148 Python rows have an R partner.
- R alone has 8 extra CHECK rows (`labelled_rows_truth_after_grid_end` = 0 and `view_mismatches` = 0, in all four runs). These are assertions, not metrics.
- The two layouts turned out to be identical, so no remapping was needed.
- Count, id and pass-flag rows: 0 differences.
- Numeric rows beyond 0.01: none. Largest absolute and relative difference per criterion, primary run:

| Criterion | Max abs diff | Max rel diff |
|---|---|---|
| G1a | 4.5e-13 | 3.1e-16 |
| G1b | 4.5e-13 | 1.8e-15 |
| G2, G3b, G5a, G5b, G6a, G6b, G7c, G7e, G7f, P3, ARM, CHECK | 0 | 0 |
| G3a | 2.8e-17 | 1.8e-16 |
| G4a | 5.0e-11 | 3.6e-11 |
| G4b | 2.2e-16 | 1.9e-13 |
| G7a | 5.5e-12 | 7.6e-14 |
| G7b | 2.5e-14 | 5.3e-15 |
| G7d | 2.0e-15 | 1.5e-13 |

- The S2, S3 and multi runs agree to the same order (at most 7.2e-11).
- The E3-exempt month-block bootstrap is only in the report-only files. It is roughly consistent: for A the CI is [-1.11%, +0.35%] in Python and [-1.10%, +0.35%] in R; B and C are similar.
- Divergence: none, so no STOP.

### 4.3 Independent recomputation (`audit_work/a3_recompute.py`, output `a3_recompute_rising_limb_ticks.csv`)
- Method: my own pandas code on `rising_limb_ticks.csv`, the frozen event file and the index files. Rules applied: in_scoring = 1, mask = 1, has_pred asserted on the mask, the D-8 tick removed, GATE kept events only, base_rst for the rising denominator.
- I recomputed all 17 criteria, not only the five requested, including both bootstrap CIs.
- Every value equals both analysts to the printed precision. For example:
  - G1a gain: A 0.365740, B 0.059828, C 0.360748
  - G1b gain: 0.354638, 0.063258, 0.346527
  - G2 improved: 18, 15, 17
  - G3a d_bias: -0.110396, -0.036684, -0.159083
  - G4a rel_change: -0.004012, +0.012813, +0.005358
  - G7f: -0.054867, -0.045495, -0.082676
- No G3a bootstrap resample produced a non-finite value. The only event with an empty REC is event 49, which tps at t0 + 239 h.

### 4.4 Guards, P1 (`audit_work/node_test_output.txt`, `rising_limb_run_log.json`, git)
- `node --test tests/*.test.mjs` (read-only; it writes only to OS temp folders) gives 47 pass and 0 fail. Identity is 127,874 / 127,874 exact. Invariant failures are all 0:
  - B equals base when B is not rising: 105,744 checked
  - A equals base when the delta is off: 66,018
  - C equals A when B is inactive: 105,744
  - C equals B when the delta is off: 66,046
  - A travel equals base: 127,874
  - C travel equals B: 127,874
  - C porEst under the delta: 61,828
- P3 is 9/26 and P4 is 20/20, the same numbers as the run log and STEP_3_PRECONDITIONS.json.
- I also checked the invariants on the tick file actually written (`audit_work/a7_truth_inputs_invariants.py`): the same four raw-equality sets give 0 failures; A and base, and C and B, have identical `travel_gf_lf` and `travel_por_gf` everywhere; `b_active` is equal across arms.
- Single run at 17c6060: the run log records head 17c60603...; the run refuses on a dirty tree and opens files with 'wx'; the manifest and run-log hashes match.
- The harness sources hash to the run-log values: all 12 files match. The plan as it stood at 17c6060 hashes to 59c29937..., the recorded value. The current plan differs only by the later D-6 to D-9 entries.
- `scheduled-update.js` has the same git blob (f8a3b244...) at 17c6060 and now, and `git diff 17c6060 HEAD` is empty for `netlify/functions/` and for the harness sources and tests.
- What I cannot prove from the repository: that no other, unlogged, run happened outside git. STEP_3_LOG notes one blocked launch attempt that wrote nothing.

### 4.5 Learning-gate and model drift (`audit_work/a5_drift_check.py`, own code, no harness import)
- Production `validatePendingPredictions` from `// Check 1: EF cross-check` (line 1150) through `const binUpdate = updateCorrectionBin(...)` (1367), 218 lines, equals the 210-line port. The only differences are the claim-delete statement (4 lines) and the bin-read statement (6 lines), each replaced by one hook line. The preamble from the last `const actualCFS = lf.q;` (49 lines) is equal.
- MODEL (lines 797-993) and POR blocks are equal after removing only H1, H2 and H3.
- The four hook lines implement section 1 exactly:
  - the `rising` condition as in the plan;
  - H1 and H2 use `Math.max(..., por.q)` only when `useB && rising`;
  - H3 under `useA` is `Math.round(historicPoR.cfs * appliedRatio) + tributaries`;
  - otherwise H3 is the production line.

### 4.6 Third implementation (`audit_work/a6_rerun_model_check.sh`)
- I ran a copy, with its output folder redirected to `audit_work/mc_rerun` (since removed; the script recreates it), in about 12 s. All 7 outputs are byte-identical to `model_check/`: the check CSV, the rebuild CSV, the four `_replay_event` files and `_run_summary.json`.
- Its imports are only json, math, os, sys, datetime, numpy and pandas. It reads the raw CSV, the event file, the snapshots and the tick file as data, and reads no `.mjs` code.
- Result:
  - 4 events (11, 30, 51, 53) x 4 arms;
  - raw, travel and slot/validation/flag columns: max difference 0;
  - corr and unc: max difference 1.1e-11; disp: 0;
  - seeded rebuild (pick 3, event 53): all 18 bins exact, pending slot identical.

### 4.7 D-8 handling (`audit_work/a7_truth_inputs_invariants.py`)
- In all four files, exactly one tick has `truth_tick_utc` after 2026-11-09T23:00Z: 2026-11-09T12:00Z, a normal tick with mask 1 in the file. Both analysts report truth_mismatches = 1 and 0 after the override.
- Root cause in the harness: `lfViewAtTime` accepts `u - 1 < D.n`, so it reads the LF view one tick past the grid.
- Related edge (D-9): tick 2026-11-09T10:00Z has `truth_basehz_tick` and `truth_own_tick` at 2026-11-10T00:00Z in all four files. This is one tick, not two as the D-9 wording suggests. Together with the D-8 tick, two ticks per file read past the grid. Neither carries an RL, RLX or REC label, so neither enters any criterion.
- Also verified on the primary file:
  - `lf_view` and `por_view` equal the raw CSV at t-1 h and t-2 h, with up to 3 h carry, on all 130,987 ticks.
  - On all 127,745 masked ticks, `truth` equals the LF view at `truth_tick_utc`.
  - That tick is the first available tick in [ceil(t + tau_ref), +2 h], and it is always strictly after t (tau_ref 0.76 to 16.95 h).
  - The mask is identical across the four arms.

### 4.8 Live USGS spot checks (`audit_work/a8_spotcheck.py`, results `a8_spotcheck.csv`, raw JSON `audit_work/usgs_raw/`)
Sampling: one generator, `numpy.random.default_rng(20261112)`. Pools are scored base RL ticks (in_scoring = 1, mask = 1, D-8 tick excluded), sorted by time.
1. Two ticks via `rng.choice(37, 2, replace=False)` from the October pool (event 53).
2. One tick via `rng.choice(52, 1)` from the early pool, D-9: RL ticks of kept events with t0 in 2012-2014. These are the STRATUM events 7 and 9, so the fallback to normal hours was not needed.
3. Five ticks via `rng.choice(690, 5)` from the RL ticks of the other 20 kept GATE events.

For each tick, every gauge was checked at the stamp the lag view actually used. The CSV value was compared with the median of live IV readings timestamped in [s, s+1h) UTC. I used a generic User-Agent and sent no personal data.

Note: the service returned a window shifted 1 h from the requested `...Z` times, so the script requests a wide window and filters by each reading's own UTC timestamp. A first, narrow pass that missed readings was discarded.

| Tick (UTC) | Pool | PoR | LF | Monocacy | Goose | Broad Run | Seneca | EF stage | LF stage | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-12 22:00 | Oct | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | +0.08% | 0.00% | provisional, flagged (matches) |
| 2026-10-13 01:00 | Oct | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | provisional, flagged (matches) |
| 2014-07-15 16:00 | early | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | -0.12% | 0.00% | OK |
| 2015-10-28 22:00 | rest | 0.00% | 0.00% | 0.00% | CSV blank* | 0.00% | -0.06% | 0.00% | 0.00% | OK |
| 2017-10-31 21:00 | rest | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | OK |
| 2021-09-01 20:00 | rest | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | +0.13% | OK |
| 2024-09-30 04:00 | rest | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% | -0.06% | 0.00% | OK |
| 2026-05-24 09:00 | rest | 0.00% | **+0.98%** | 0.00% | 0.00% (P) | 0.00% | 0.00% | -0.08% | +0.12% | OK, LF near tolerance |

The table shows the CSV value minus the live median, relative to the live median.
- *Goose had no stamp within the 3 h carry at that tick, so the model used the drainage-area fallback. There was nothing to compare.
- 63 of 64 gauge-stamps were comparable. All 46 approved ones are within 1%.
- 17 are provisional and flagged: both October rows, plus Goose on 2026-05-24, which still carries a P qualifier. The October live values still equal the file exactly.
- LF on 2026-05-24 08:00 is +0.98%, with 12 five-minute live readings against the CSV's earlier fetch. This is the stamp closest to the tolerance.
- The hourly bucket convention ([s, s+1h), median) is confirmed: every exact match uses it.

### 4.9 Preconditions and gate arithmetic
- P3: 34.6% (>= 20%), pass. P3 applies because October is detected, GATE class and not excluded, so G1b differs from G1a.
- Event floor: 20 non-October GATE events against 15, so PROCEED.
- Pass flags: every pass flag in both files follows from value and threshold as written (`audit_work/a11_gate_table.py`: 0 disagreements). This covers:
  - point plus CI for G1a, G1b and G3a;
  - the G6a October drop judged at 10% and other drops at 15%, with LOEO-noOct at 10%, breadth as the integer test on the remaining events, and G6b breadth requiring 3 of 4;
  - G5a only for B and C, G5b only for A.
- Outcome rule: at least 15 events remain, all preconditions hold, and no arm passes everything, so the outcome is FAIL.

### 4.10 Referee checks
- **Leakage**: none found.
  - Inputs are verified equal to the raw CSV at t-1 h and t-2 h, with no future read.
  - Truth always comes from a later tick.
  - Learning uses the LF view at the validation tick, as production does.
  - The harness also has a poisoning test, which passes.
- **Common mask**: identical across arms. Every masked tick has a prediction in every arm (asserted).
- **Burn-in**: all criteria use in_scoring = 1. The first kept GATE event starts in 2015, and X0 removed events 1 and 3.
- **Bootstrap membership**: the resamples index the 21 (20) kept GATE events in t0 order. My recomputation with that ordering reproduces both analysts' CIs to the last digit, which confirms that all three implementations agree on membership.
- **Knife edges**: no criterion that decides the outcome sits where the D-8 tick, rounding or the 0.01 tolerance could flip it.
  - G7f for A is -5.49%. Leave-one-event-out keeps it negative in every drop (range -6.37% to -0.35%, `audit_work/a10_g7f_context.py`).
  - G4b for C is +7.48% against +5%.
  - The D-8 tick moves G4a by at most 1e-6 in absolute terms.
  - The closest margins are on criteria that pass and do not decide the outcome: C's G6b breadth is exactly the minimum (3 of 4); B's G4a is +1.28% against +2%; A's LF spot-check is +0.98% against 1%.
- **Tolerance of 0.01 is loose for fractions**: the actual gaps are at or below 5.5e-11, so this is moot.

## 5. Findings, by seriousness, and limits

1. **Substantive, not a defect: the binding G7f failure comes from the 120% display cap.** Source: `audit_work/a10_g7f_context.py`; this is report-only context.
   - On the RL ticks the base arm overestimates heavily before the cap (mean signed e_unc +2,461 cfs). The cap on the lagged LF view binds on 52.5% of base RL ticks and clips that overestimate.
   - Arms A and C remove most of the overestimate (mean signed e_unc +478 and +379 cfs), so their large e_unc gains fall mainly on ticks where the display was capped anyway.
   - On the 342 RL ticks where neither base nor A is capped, the displayed estimate is already low for base (mean -1,477 cfs), and A is lower still (-1,811 cfs).
   - So users would have seen worse rising-limb numbers. Only 6 of 21 events have a lower displayed error under A.
   - This is a real property of the model and display path, reproduced by the third implementation (disp difference 0). It is not an implementation error.
2. **Harness edge at the grid end (D-8, D-9).** `lfViewAtTime` reads one tick past the H1 grid. This affects 2 ticks per file (2026-11-09 10:00 and 12:00), neither in any window, and it is handled by the D-8 override. The effect on G4a is at most 1e-6 in absolute terms, and there is none on G4b. D-9's description ("two unlabelled ticks have truth_basehz_tick or truth_own_tick after the grid") is slightly inexact: one tick has those columns past the grid; the other is the D-8 truth tick. No consequence.
3. **P1 letter versus practice.** Plan section 7 asks for the identity and invariants "inside the harness on every tick… any violation stops the run".
   - In the gate invocation they ran in the test suite's own full replay (`runPreconditions`), as a precondition of the same command, not inside the replay pass that wrote the tick files. `runReplay` asserts neither.
   - Both passes run the same committed code on the same inputs and are deterministic. I re-verified the raw and travel invariants on the written tick file itself (0 failures), and the third implementation matches that file.
   - Low severity; it does not affect the numbers.
4. **The single-run claim rests on the run log, the manifest, git history and the 'wx'/dirty-tree guards.** An unlogged run outside the repository cannot be excluded from repository evidence.
5. **USGS service quirk** (affects only the audit tooling): requested windows came back shifted by 1 h. Corrected by filtering on reading timestamps. The live values used are archived in `audit_work/usgs_raw/` because USGS revises data.
6. **Agreement on CIs is not RNG independence.** Both languages read the same index files by design (M4). Their agreement checks the resampling arithmetic, not the draw.

Limits:
- Plan section 8 applies in full. Most relevant here:
  - LF is the truth, including ungauged inflow;
  - the replay uses hourly medians and a 1 to 2 h lag view rather than live ticks;
  - single-slot learning;
  - selection on October;
  - home advantage for base;
  - about 21 events and a holdout of 4;
  - G3a is weak for B and G5a weak for B and C.
- D-3: October 2026 (and everything after 2026-06-14) is provisional USGS data on a later revision state than the cron saw.
- D-5 H4: production's critical-ice skip is not modelled.
- The third implementation verifies bin state independently for one event only.
- I did not port the travel and rise-rate functions to recompute tau_ref myself. I checked the truth read given tau_ref; tau_ref itself was rebuilt independently by both analysts (max difference 1.8e-15 h) and by the third implementation on four windows.

## 6. Report-only context (decides nothing; the primary run alone decides, and choosing among runs is not allowed)

Sensitivity runs (`audit_work/a9_runs_summary.py`, analysts' values):

| Run | Arm | G1a gain | G2 | G4a | G4b worst | G7f | Failed criteria |
|---|---|---|---|---|---|---|---|
| S2 (unlagged) | A | +37.6% | 85.7% | -0.64% | +3.2% | -3.8% | G7f |
| S2 | B | +5.6% | 76.2% | +0.71% | +8.1% | -4.4% | G1a G1b G4b G6a G6b G7d G7f |
| S2 | C | +37.1% | 85.7% | -0.11% | +4.7% | -6.1% | G7f |
| S3 (1 h uniform) | A | +37.5% | 90.5% | -0.67% | +2.5% | -2.7% | G7f |
| S3 | B | +4.9% | 61.9% | +1.93% | +12.3% | -5.0% | G1a G1b G2 G4b G6a G6b G7d G7f |
| S3 | C | +36.2% | 90.5% | +0.83% | +8.5% | -8.9% | G4b G7f |
| multi-pending | A | +38.6% | 85.7% | -1.17% | +1.2% | **+2.9%** | none |
| multi-pending | B | +6.7% | 81.0% | +0.49% | +4.8% | -8.3% | G1a G1b G6a G6b G7f |
| multi-pending | C | +36.7% | 76.2% | -0.85% | +1.2% | -3.5% | G7f |

Under the report-only multi-pending replay, A would meet all 17 criteria. So A's G7f result depends on the learning regime (single-slot, as production runs it, is primary by design, PA-3). This does not change the verdict.

- **STRATUM (8,000 to 12,000 cfs), 15 events, RL e_unc gain**: A +8.3% (9 of 15 improved), B +1.5% (5), C +6.0% (6).
- **Event-equal-weighted gain** (mean of per-event gains; all events, then no October): A +27.6% / +25.8%, B +3.8% / +4.1%, C +26.0% / +23.7%. Gain of the mean per-event MAE: A +35.3%, B +5.9%, C +34.9%.
- **The brief's literal window [t0, t0 + 24 h], 525 ticks**: A +35.8%, B +4.6%, C +34.8%.
- **Excluded GATE events' RL ticks** (R only, 10 events): A +10.3%, B +1.5%, C +11.7%.
- **Cap-bind rate on RL ticks**: base 52.5%, A 46.5%, B 50.2%, C 45.5%. Normal hours: about 3% in all arms.
- **Normal-hours month-block bootstrap** (seed 20261111, E3, Python): A -0.40% [-1.11%, +0.35%], B +1.28% [+0.40%, +2.19%], C +0.54% [-0.27%, +1.37%].

## 7. How to reproduce this audit

From `analysis/rising-limb-travel-backtest/`, using `/usr/bin/python3` (numpy 2.0.2, pandas 2.3.3) and node v24.12.0:
- `audit_work/a1_regen_bootstrap.py`: bootstrap regeneration and sha256
- `a2_agreement.py`: Python/R join
- `a3_recompute.py`: all criteria from the tick file
- `a5_drift_check.py`: text diff of the model and gate blocks
- `a6_rerun_model_check.sh`: third-implementation rerun and byte compare
- `a7_truth_inputs_invariants.py`: inputs, truth reads, mask, invariants, edge ticks
- `a8_spotcheck.py`: live USGS sample (cached JSON in `usgs_raw/`)
- `a9_runs_summary.py`: per-run summary
- `a10_g7f_context.py`: G7f decomposition
- `a11_gate_table.py`: gate table and flag check
- `node --test tests/*.test.mjs` (output in `node_test_output.txt`)

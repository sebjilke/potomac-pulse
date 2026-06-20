# #14 Phase 1 — Multi-pending vs single-pending learning: backtest plan

**Date:** 2026-06-19
**Status:** PLAN (pre-audit). No analysis code until plan + independent audit complete (CLAUDE.md Empirical Analysis Planning Protocol).
**Decision being gated:** Should the GF learning loop validate EVERY hourly prediction (multi-pending) instead of the current one-slot throttle (single-pending)? This changes the *learning stream*, so it must be backtest-gated before any production change (like C45).

---

## 1. Problem & hypothesis

**Today (single-pending):** `storePrediction` keeps one row `gauge_id='pending'`; while it's in its validation window a new prediction is *skipped* (`isExistingPredictionReplaceable` false). So during a fast event the cron validates ~1 prediction per ~9h window (≈6.5h travel + ≤2.5h grace) — the hourly predictions made *during* the event are discarded.

**Proposed (multi-pending):** store every hourly prediction (unique `gauge_id`), validate each when its water reaches LF. More learning signal exactly when the river moves fast — where the model is weakest.

**Hypothesis to test:** multi-pending yields a *better* prequential corrected residual (lower MAE / smaller bias), especially in rising/high-flow cells.

**Counter-hypothesis (the risk):** consecutive storm-hour predictions are highly autocorrelated (same regime, overlapping PoR inputs, correlated errors). The per-bin EMA (α=0.3, recency-weighted) would see an inflated *effective* count and could over-fit the learned correction to recent events — degrading the headline estimate. Net effect is genuinely uncertain → measure it.

---

## 2. Why a dual-arm parallel-learning gate (and why NOT "run the harness twice")

`ci_backtest_harness.mjs` already has `--mode=single|multi` and emits a corrected-residual CSV per run. The naive approach — run both modes, compare the two residual CSVs — is **rejected as confounded**:

- The two modes evaluate on **different prediction sets**. Single-mode only records residuals for the throttled subset (post-window hours), which **systematically excludes the storm-dense hours** that are the whole point. Comparing distribution A (every hour) to distribution B (a storm-excluding subsample) conflates "quality of the learned correction" with "which hours each policy happens to score."

**Correct design — one common evaluation stream, two parallel learners.** Build `analysis/multipending_gate.mjs` (modeled on `c45_gate.mjs`'s dual-arm structure + `ci_backtest_harness.mjs`'s prequential replay):

- Maintain **two independent 18-bin EMA states**: `binsSingle` and `binsMulti`, starting empty, evolving forward through the 14-year replay.
- **At each hour `t`** (the *common evaluation stream*): call the real `makeGFPrediction` once to get `rawFinalCFS` + `flowBin`/`flowState`. Compute the corrected residual **twice** — once applying `binsSingle`'s current correction, once applying `binsMulti`'s — via the shared `applyGFCorrection` (same raw, different bins). Log both against the same `actualLF` at the prediction's validation-due hour. This isolates *correction quality* from *policy throughput*.
- **Learning (per arm's policy):**
  - `binsMulti`: every validated, non-hard-flagged prediction feeds `updateCorrectionBin(binsMulti[...], rawErr, soft)`.
  - `binsSingle`: feeds `binsSingle` **only** for predictions that the single-slot rule would actually have stored — i.e. simulate the `pending`-slot occupancy with `isExistingPredictionReplaceable` exactly as production does, and learn only from the subset that would have been stored+validated.
  - Both arms validate with the identical anomaly gates + 2.5h window + claim semantics already in the harness (reuse `scoreAnomalies`, `VALIDATION_MAX_DELAY_MS`).
- This is the same pattern as `c45_gate.mjs` (two corrections, one stream) but the two arms differ in **what feeds the EMA**, not the correction formula.

**Self-check (gate integrity, mirrors c45_gate):** the `binsSingle` arm must reproduce production's single-pending learning trajectory. Cross-check: run the existing `ci_backtest_harness.mjs --mode=single` and confirm `binsSingle`'s final per-bin (count, emaMeanError) matches the gate's `binsSingle` within float tolerance. If not → gate is infidelitous, STOP.

---

## 3. Metrics (computed downstream, blind Python + R)

From the gate's residual CSV (columns: `predTs, valTs, flowBin, flowState, rawFinalCFS, actualLF, corrSingle, corrMulti, resSingle, resMulti, isHardFlagged, isSoftFlagged, binCountSingleAtPred, binCountMultiAtPred`), excluding hard-flagged and a per-cell burn-in (first B=30 obs each arm, per ci_v36.1 precedent):

- **Primary:** pooled and per-(flowBin×flowState) **MAE and median|residual|** of `resSingle` vs `resMulti` on the common eval stream.
- **Bias:** mean residual per cell, each arm (detects systematic over/under-correction).
- **Storm cells specifically:** rising + (12000-25000, 25000-50000, 50000+) cells — the cells the change targets.
- **Autocorrelation diagnostic (the counter-hypothesis):**
  - per-cell raw count vs **effective N** (decorrelation time from the lag-1+ autocorrelation of the residual series feeding each arm) — quantify how much multi-pending inflates apparent sample size.
  - **temporal holdout:** re-run the gate scoring only on the final 20% of the timeline (2024-2026), bins frozen at the 80% mark — does multi's advantage survive out-of-sample-in-time, or is it in-sample over-fit?
  - **moving-block bootstrap** (block ≈ decorrelation length) CIs on the per-cell MAE delta (resSingle−resMulti), so the gate decision rests on a CI, not a point estimate.

---

## 4. Pre-registered ACCEPT / REJECT gate

**ACCEPT multi-pending (proceed to implement, test-first) iff ALL hold:**
1. **Self-check passes** (binsSingle reproduces `--mode=single` trajectory within tol).
2. Pooled `resMulti` MAE ≤ `resSingle` MAE (multi is **not worse** overall), with the delta's bootstrap 95% CI excluding "multi worse by >1%".
3. **Storm cells improve or hold:** in the rising + ≥12k cells, multi's median|residual| improves by ≥ 2% **or** is statistically indistinguishable (CI contains 0) — and none regress with a CI excluding 0 on the worse side.
4. **No cell regresses materially:** no (flow×state) cell where multi's MAE is worse by >2% with a bootstrap CI excluding 0.
5. **Out-of-sample-in-time:** the temporal-holdout re-score preserves the sign of the pooled advantage (multi's edge is not in-sample-only over-fit).

**REJECT (document like C45 Phase 2, leave single-pending) if** multi degrades any storm cell with CI-significance, OR the advantage vanishes/reverses out-of-time (autocorrelation over-fit confirmed), OR is a wash (no significant improvement anywhere → not worth the added pipeline complexity + DB rows).

---

## 5. Verification (CLAUDE.md Analysis Verification)

- **Blind dual-language:** Python and R subagents, new + separate + results-blind, each compute §3 metrics from the gate CSV. Must agree <0.01; fail-fast on divergence.
- **Independent auditor (third agent):** verifies cross-language agreement, the gate's prequential fidelity (no look-ahead: correction at `t` uses only validations with `valTs < t`), the burn-in/hard-flag exclusions, the autocorrelation/holdout methodology, and spot-checks ≥5 residual records against the input CSV + live USGS.
- **Audit trail:** `multipending_gate.mjs`, `*_single.csv`/`*_multi.csv` residuals (or one combined), `*_python.csv`, `*_R.csv`, `multipending_findings.md`, `multipending_audit.md` in analysis/.

---

## 6. Data & provenance

- Input: `analysis/hourly_backtest_data_v361.csv` (126,917 hourly rows, 2011-12-01 → 2026-06-15; PoR discharge/temp, 4 tributaries, EF stage, LF discharge+stage). Generator: `analysis/fetch_hourly_backtest_data_v361.py`. Same data the v36.1 CI backtest used → trusted, already audited.
- No re-fetch needed (the harness already runs on this file in both modes today).

---

## 7. If the gate PASSES → implementation (separate, test-first; NOT part of Phase 1)

Structurally modest (the validation loop is already row-agnostic; forecast system is the multi-row template):
- `storePrediction`: `gauge_id = 'pending_<timestamp>'`; insert each cycle; **cap** concurrent rows (e.g. keep ≤ N most-recent, prune oldest-stale) to bound DB growth.
- `validatePendingPredictions`: load all `gf_prediction` rows by prefix; the existing `for` loop + per-row `id` claim/delete already handle N rows.
- `loadGFLearningData`: load all pending rows (already `.limit(50)`).
- **Test-harden first:** add characterization tests for `validatePendingPredictions` (the untested EF-corr/shadow/stage sub-blocks) BEFORE changing it — multi-row is exactly when "behavior-neutral" needs a net. This is the test-hardening the session has repeatedly deferred.
- Full Code-Change Verification Protocol (plan→audit→implement→re-audit). Likely MAJOR (changes the learned correction → changes GF output for same inputs).

If the gate FAILS → write `multipending_findings.md` REJECT, mark #14 not-pursuing with the evidence, done.

---

## 7b. Audit engagement (independent auditor, 2026-06-19) — verdict PROCEED w/ 6 must-fixes (ALL ACCEPTED)

1. **Self-check fidelity.** Assert the single-arm against production `storePrediction` + `isExistingPredictionReplaceable` + the 48h-stale path — NOT merely `--mode=single` (which uses a `pending.length>0` shortcut that only coincides on a clean grid). Require **exact integer `count` match** per bin (float tol only on `emaMeanError`), and add the v36.1-style cross-check: feed sample tuples through the REAL `validatePendingPredictions` with a mocked Supabase client, compare captured bins (also pins the re-implemented `scoreAnomalies`).
2. **Resolve the criterion-3 / wash contradiction (the false-ACCEPT risk).** Default is **REJECT** (keep simpler single-pending). ACCEPT requires *affirmative* improvement: point improvement ≥ threshold AND bootstrap CI excluding 0 on the better side in ≥1 target cell (rising ≥12k), with no material regression. "Statistically indistinguishable" no longer counts as acceptance.
3. **Pre-register a minimum-independent-events threshold (~15–20/cell).** Cells below it are reported **inconclusive** and excluded from ACCEPT criteria. State upfront: 50k+ (and likely 25-50k rising) are data-bound → their verdict is "insufficient data" regardless; the decidable question is the 12-25k / 25-50k cells.
4. **Inference = event-level paired deltas** (resSingle−resMulti aggregated to one value per independent gap-merged event), with BCa bootstrap over events — this makes effective N (= event count) explicit and removes the block-length free parameter. If moving-block bootstrap is also reported, block length = empirical event duration with a 24h/72h/event sweep, NOT lag-1 decorrelation.
5. **Report the RAW residual** (identical across arms — the shared baseline proving both correct the same model bias) **and the production headline `avgErrorPercent`** alongside corrected MAE/median/bias. Burn-in B swept {20,30,50,75} (don't import 30 as magic).
6. **Scope boundary (document explicitly):** this gate measures *correction quality at held-constant throughput*. It does NOT test multi-pending's real-time responsiveness benefit (more validated predictions during a live storm) — that's a separate, harder question this design deliberately does not answer.

Net: the dual-arm common-eval design and the "run twice is confounded" diagnosis are verified correct; the amendments fix the decision logic + set honest power expectations.

## 8. Risks / open items for the auditor

1. **Is the dual-arm common-eval design correct**, and is rejecting "run --mode twice" justified (the subsample-bias argument)?
2. **binsSingle fidelity:** does simulating `isExistingPredictionReplaceable` in the gate truly reproduce production single-pending, and is the self-check against `--mode=single` sufficient?
3. **Eval stream choice:** is "every hour" the right common eval set, or should it be every-hour-with-valid-LF-at-horizon only? Any look-ahead risk in scoring both arms at `t` with bins learned from `valTs<t`?
4. **Autocorrelation handling:** are effective-N + temporal-holdout + moving-block bootstrap the right defenses, and is the block length principled?
5. **Gate thresholds:** are the ±2% / CI criteria reasonable, or arbitrary? Should the "wash → reject" bar be explicit (improvement must exceed the implementation/complexity cost)?
6. **Hard-flag/burn-in exclusions** match the production learning semantics?
7. Anything that would make this gate give a wrong ACCEPT/REJECT.

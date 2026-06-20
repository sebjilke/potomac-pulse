# #14 Phase 1 — Multi-pending vs single-pending learning: findings

**Date:** 2026-06-19
**Verdict: QUALIFIED PASS — recommend REJECT / DEFER on cost-benefit.** (Decision deferred to user; no implementation started.)
**Plan:** `multipending-learning-backtest-plan-2026-06-19.md` (with §7b audit amendments). **Gate:** `multipending_gate.mjs`.
**Verification:** blind Python (`multipending_metrics_python.*`) + R (`multipending_metrics_R.*`), third-agent audit — all in analysis/.

## What was run

Dual-arm, common-evaluation-stream backtest over 126,916 hourly rows (2011-12 → 2026-06). Two parallel 18-cell
EMA states learned under the two policies (`binsSingle` fed by the production single-slot subset; `binsMulti`
fed by every validated hourly prediction), both scored on the same hourly prediction stream via two real
`makeGFPrediction` calls per hour. 110,182 paired corrected residuals; 107,589 after B=30 burn-in.

## Integrity (third-agent audited)

- Py ↔ R agree to **0.0000** on every deterministic metric across all 20 scopes (bootstrap CIs differ only by RNG).
- Gate self-check: raw/bin/state identical across arms (0 mismatches) → raw model is correction-independent, dual-arm design valid.
- Single arm reproduces `ci_backtest_harness.mjs --mode=single` final bins **exactly** → production-faithful.
- No look-ahead (0/110,182 rows with valTs ≤ predTs); residual arithmetic + actualLF↔input↔USGS spot-checks pass.

## Results (B=30, event-level 24h-gap, 20k-resample percentile bootstrap)

| Scope | n_events | MAE single→multi | Δ (cfs) | Δ CI (excl 0?) |
|---|---|---|---|---|
| **pooled** | 127 | 326.9 → 305.1 (−6.7%) | +21.9 | **No** [−6.6, 26.8] |
| **storm_pooled** (rising ≥12k) | 48 | 1450 → 1326 (−8.6%) | +124.6 | **No** [−7.0, 331] |
| 12000-25000_rising | 44 | 906 → 856 | +50.2 | No [−91, 46] |
| 25000-50000_rising | 31 | 1696 → 1559 | +136.5 | **Yes** [43, 286] |
| 50000+_rising | 24 | 3149 → 2745 | +404.7 | **Yes** [101, 789] |
| low/mid cells (0-3k, 3-6k, 6-12k_rising) | — | multi WORSE in all 7 | −1 to −23 | No (all straddle 0) |

- **Temporal holdout** (last 20%): pooled Δ = +10.8 (vs +21.9 full) → sign preserved, magnitude **halves** out-of-time.
- **Bias:** multi reduces high-flow under-prediction (storm bias −297 → −251; 50k+_rising −424 → −279).
- **Raw residual baseline** (shared, both arms): mean |raw| = 627 cfs.

## Reading

Multi-pending **helps the rare high-flow flood tail** (25-50k & 50k+ rising, CI-significant in both languages)
and reduces storm under-prediction bias — but:
1. The **aggregate** effect is **not statistically significant** (pooled & storm_pooled CIs straddle 0).
2. It **systematically worsens all 7 low/mid-flow (everyday) cells** — directionally consistent (the
   autocorrelation-overfit signature the plan warned of), though each per-cell CI straddles 0.
3. The targeted *everyday-storm* cell (12-25k rising) is a **wash**.
4. The out-of-time edge is **half** the in-sample edge → mild in-sample over-fit confirmed.
5. The CI-significant wins live in the cells the plan pre-flagged (§7b #3) as data-bound (n_events 31, 24).
6. Scope boundary (§7b #6): this gate measures **correction quality at held-constant throughput** only — it
   does NOT credit multi's live-storm responsiveness (the strongest a-priori case), which is out of scope.

## Recommendation

**REJECT / DEFER.** The literal pre-registered ACCEPT criteria are technically satisfied, but the evidence is
thin: a real-but-aggregate-insignificant edge, confined to the rarest flood regime, mildly degrading the
everyday regime, retaining only half its magnitude out-of-time. Against that, the implementation is the
**riskiest in the backlog** — a MAJOR change to the live learning loop requiring multi-row schema +
test-hardening the untested `validatePendingPredictions` sub-blocks. The juice does not justify the squeeze
for a nice-to-have. If revisited, the missing piece is a study of the **responsiveness** benefit (out of
scope here), not more correction-quality backtesting.

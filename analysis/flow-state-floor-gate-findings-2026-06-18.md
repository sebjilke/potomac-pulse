# Narrow flow-state floor fix — gate RESULT: REJECT (close 0a)

**Date:** 2026-06-18 · **Tier 0 #0a** · **Outcome: REJECT — close 0a as low-leverage. No model change shipped.**
**Plan:** `flow-state-floor-candidate-plan-2026-06-18.md` (REVISED RUN SPEC). **Harness:** `flow_state_floor_gate.mjs`.

## What was tested
A single continuous-taper candidate **C3′** vs the live baseline, differing ONLY in the flow-state
classifier floor: `threshold = max(q×0.02, floorFn(q))`, `floorFn(q)=clamp(100−40·(q−2700)/2000,60,100)`
(floor 100 below PoR 2,700, ramps 100→60 over 2,700→4,700). Prequential A/B replay of the real
`makeGFPrediction` (learn-on-raw EMA) over the 14-yr hourly data, both arms at HEAD (v37.2).

## Verification chain (4 independent layers)
1. Methodology auditor reviewed the candidate plan → 5 MUST-FIX folded in (band geometry, single
   continuous candidate, block-bootstrap-CI gate, rising-cell attribution, ≥12k invariant restatement).
2. Harness self-verified: base arm reproduces the v36.1 per-bin residuals **exactly** at commit e165734,
   and is **byte-identical row-for-row** to the trusted `ci_backtest_harness.mjs` at HEAD (110,548 rows).
   (Note: the live HEAD baseline is 421.6/319.5/228.8 for 3000-6000 rising/steady/falling, vs the
   v36.1-era 416.9/316.2/229.1 the diagnostic cited — v36.4's travel-time changes moved low-flow raw
   residuals slightly; the gradient and the leverage picture are unchanged, and the A/B is HEAD-vs-HEAD.)
3. Blind Python + R gate metrics agree to **<0.01** (max cell diff 7.75e-11).
4. Third-agent auditor independently re-derived every metric (<0.01 match) and steelmanned the PASS case.

## Result — fails every pre-registered ACCEPT condition

| condition | result |
|-----------|--------|
| 3000-6000 corrected-MAE delta (c3−base) | **+0.53 cfs (worse)**; block-bootstrap 95% CI ≈ [−0.4, +1.4] **includes 0** → FAIL |
| improvement attributable to the **rising** cell | **rising cell regresses +2.33 MAE** (the largest mover, wrong way) → FAIL |
| pooled corrected MAE / RMSE ≤ baseline | both **worse** (+0.11 / +0.06) → FAIL |
| flip sign-correctness (949 flips, all from steady) | **54% get worse** (steady→falling 53.5% worse, steady→rising 56.6% worse) — v35.0 noise signature |
| bins ≥12,000 raw output identical | 25-50k & 50k+ exact; 12-25k: 56 rows' *applied correction* differ 1–26 cfs via the C45 ±12% band (carved-out perturbation, raw gfFinal identical) |

Only 0-3000 (−0.060) and 6000-12000 (−0.057) had negative deltas — both ~0.05% of bin MAE with
bootstrap CIs including 0, i.e. pure noise.

## Why it failed (mechanism)
The Step-1 diagnostic found a real *static* raw-residual gradient in 3000-6000 (rising > steady >
falling). But the obs the loosened floor reclassifies are the **marginal, near-threshold** ones — the
noisiest. Moving them from steady into the directional cells **dilutes** the rising cell (pulls its mean
toward steady) instead of sharpening it, and the EMA was already absorbing their bias in the steady bin.
Net: more noise, no signal — a slight regression. This is the dilution the plan-auditor predicted and the
same "static leverage ≠ prequential gain" outcome as the travel-time refit and the C45 high-flow
boundaries.

## Disposition
**0a CLOSED as low-leverage.** No flow-state-classifier change ships. The live `getFlowState`
(`max(100, q×0.02)`, 6h lookback) stands. **Tier 0 is now cleared** (0a closed here; travel-time refit
closed v36.2; System-1 retired v37.1). Re-open only with a materially different hypothesis (e.g. a
recession-rate-aware classifier), which would start a fresh diagnostic.

Artifacts (committed): this findings doc, the candidate plan + spec + methodology, `flow_state_floor_gate.mjs`,
the Step-1 diagnostic scripts. Residual logs + metric CSVs are gitignored (regenerable from the harness);
the decisive numbers are recorded above.

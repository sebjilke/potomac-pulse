# Low-flow flow-state classification floor — methodology plan (Tier 0 #0a/0b)

**Date:** 2026-06-18 · **Status:** METHODOLOGY PLAN — awaiting user sign-off before any implementation.
**Class:** changes the estimate → **MAJOR** if shipped · empirical-analysis protocol applies
(plan → independent auditor → blind dual-language Python+R → third-agent audit → backtest gate).

> This document scopes the problem and the evaluation. **No analysis code or model change is written
> until the methodology is signed off.** Like the travel-time refit, the honest possible outcome is
> "low-leverage, no change."

## 1. The problem

Flow state (rising / steady / falling) is one of the two axes of the 18-bin EMA correction (6 flow
bins × 3 states). It is classified by comparing current PoR flow against a 6h-lookback reading with a
threshold `max(100, q × 2%)` (v35.0 widened the window 2h→6h).

At low flow the **absolute 100 cfs floor binds**: at 5,000 cfs, 2% = 100 cfs, so below ~5,000 cfs the
threshold is the flat 100 cfs floor rather than the 2% relative band. A slow recession at 3,000–5,000
cfs changes by less than 100 cfs over 6h and is therefore classified **steady**. Per
`analysis/flow_state_window_diagnostic.md`, ~77–80% of low-flow samples classify steady even in
genuine recession regimes.

**Consequence:** at low flow the rising/falling correction bins under-populate, the steady bin absorbs
mixed recession+steady signal, and any real low-flow directional bias in the raw model is learned
weakly or not at all. (Note the 0-3000 and 3000-6000 bins are also the sparsest and most ice-affected,
so the practical leverage is uncertain — hence the gate.)

## 2. Candidate approaches (to be evaluated, not pre-chosen)

| # | Approach | Sketch | Risk |
|---|----------|--------|------|
| A | **Flow-scaled absolute floor** | Replace flat 100 with `max(floor(q), q×2%)` where `floor(q)` decays at low flow (e.g. 50 cfs below 5k). | Smallest change; may still be noise-dominated at low flow. |
| B | **Pure relative threshold at low flow** | Drop the floor below some flow; use a fixed % (tune the %). | Sensitive to gauge noise → false rising/falling flips. |
| C | **Flow-dependent lookback window** | Longer window (e.g. 9–12h) below ~5k to capture slow recessions; keep 6h above. | Interacts with wave-celerity rise-rate smoothing (v35.0 side effect); must not degrade flashy-rise detection. |
| D | **Recession-rate-aware threshold** | Threshold tied to typical baseflow recession constant rather than a flat floor. | Most principled, most complex; needs a recession-rate fit first. |
| — | **Null (do nothing)** | Keep v35.0. | The honest baseline; wins if no candidate beats it on the gate. |

## 3. Evaluation framework

- **Harness:** the existing prequential backtest (`analysis/ci_backtest_harness.mjs` / `c45_gate.mjs`
  template) replaying the real `makeGFPrediction` over the 14-yr hourly dataset
  (`hourly_backtest_data_v361.csv`), learn-on-raw, A/B arms (baseline vs each candidate).
- **Primary metric:** per-(flow bin × state) and pooled corrected-residual MAE/RMSE and median |error|,
  with the **low-flow bins (0-3000, 3000-6000) as the bins of interest**. Accept only if low-flow
  improves AND no other bin regresses beyond a pre-registered tolerance (e.g. >2% median, the C45 gate
  rule).
- **Secondary/diagnostic:** flow-state classification distribution by regime (does it become
  hydrologically realistic without manufacturing spurious flips?), and the count of newly-populated
  low-flow rising/falling bins.
- **Blind dual-language:** metrics computed independently in Python and R (agree <1e-4); fail-fast on
  divergence; third-agent audit with ≥5 live-USGS spot-checks.
- **Pre-registration:** accept/reject thresholds fixed in the (separate) analysis plan BEFORE running,
  so the gate can't be moved to fit a result.

## 4. Interactions & risks to hold in mind

- **MAJOR / re-keys learning.** Changing classification changes which bin each observation trains →
  changes the EMA fixed point → changes the estimate. Unlike System-1 (display-only), this is a real
  model change requiring a version bump and a live bin-reset decision.
- **Feedback with v35.0.** The 6h window already smooths `getPoRRiseRate` (wave-celerity input). A
  window change (C) touches both classification and the rise-rate travel-time reduction — must be
  evaluated jointly, not in isolation.
- **Sparsity/ice.** Low-flow bins are sparse and ice-prone; a classification gain may not translate to
  an accuracy gain. The gate, not intuition, decides.
- **Client/server parity.** `getFlowState`/`getPoRRiseRate` exist in both runtimes — any change ships
  to `shared-model.js` ↔ `shared/model.js` together with a parity test.

## 5. Proposed next step (on sign-off)

1. Write the full analysis plan in `/analysis/` with pre-registered gate thresholds and the chosen
   candidate set; independent auditor reviews it.
2. Run the blind Python+R diagnostic of the *current* classifier first (quantify the actual low-flow
   misclassification + its accuracy cost) — this alone may show low leverage and end it cheaply.
3. Only if leverage is real: implement the winning candidate behind the backtest gate, parity-test,
   MAJOR bump, decide on bin reset.

**Decision requested:** approve this scope (and which candidates to carry into the analysis plan), or
defer/decline.

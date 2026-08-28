# Potomac Pulse — Technical Appendix

**Version:** 37.16 | **Date:** August 2026 | **Full changelog:** [CHANGELOG.md](CHANGELOG.md)

This document provides full methodological transparency for the Potomac Pulse prediction system. It is intended for scientists, hydrologists, and technically curious users who want to understand exactly how the model works.

---

## Executive Summary

Potomac Pulse estimates real-time water conditions at Great Falls on the Potomac River, where no USGS gauge exists. The system uses two complementary methods:

**Nowcast (current conditions):** The primary predictor is Point of Rocks (USGS 01638500), ~34 river miles upstream, which captures 83.5% of the Little Falls drainage area. Its reading from roughly 5 to 50 hours ago — flow-dependent: about 19h at median flow, as little as ~5h in high water and up to ~50h near the 1,000-cfs low-water floor, per Searcy 1961 with an empirical 0.80 correction factor — represents the water currently at Great Falls. Four gauged tributaries (Monocacy, Goose Creek, Broad Run, Seneca Creek) add inflows between the two points. The result is blended with an independent stage-discharge estimate from Edwards Ferry, ~16 river miles above the falls, using a flow-dependent logistic weight (0% at low flows, up to 40% at high flows). A PoR-delta correction adjusts for rising or falling conditions. The estimate is capped at 120% of observed Little Falls discharge. Every hour, the server validates the prediction against actual Little Falls data and updates learned correction factors across 18 bins (6 flow levels by 3 flow states) using exponential moving averages.

**Forecast (48 hours ahead):** Uses NWS predictions for Little Falls (downstream), shifted earlier in time by the Great Falls to Little Falls travel time (~1.6h in a flood, ~6.5h at median flow, up to ~17h at the 1,000-cfs discharge floor), with additive bias correction anchored to the current gauge-vs-forecast discrepancy. It is important to be clear about what this is: the forecast is the NWS Little Falls prediction re-expressed for Great Falls, not an independent forecast — its only content beyond NWS is the bias-correction term and an Edwards Ferry blend that is under 1% below ~6,000 cfs. It is therefore scored against **persistence** (Little Falls holds its observed flow), the only external reference available; the former "vs NWS" comparison was retired in v37.16 because on the forecast's own validation clock it reduces to the forecast compared against itself. See §8.6.

**Calibration basis:** 117,704 hourly observations (2011 to 2026), cross-validated with leave-one-year-out folds, cross-language verified (Python and R). Typical nowcast error is approximately 6%, varying by flow regime.

---

## 1. Introduction

Potomac Pulse is a real-time web application that estimates water conditions at Great Falls on the Potomac River, where no USGS gauge exists. It combines data from multiple upstream gauges using an ensemble model, validates predictions against a downstream gauge, and learns correction factors over time.

**Core approach:**
1. Look up what Point of Rocks was reading when today's Great Falls water passed through (~5-50 hours ago, flow-dependent)
2. Add tributary contributions (Monocacy, Goose Creek, Broad Run, Seneca Creek) at their confluence points
3. Blend with a nearby stage-only gauge (Edwards Ferry) using flow-dependent weights
4. Validate every prediction ~6 hours later when water reaches Little Falls
5. Learn correction factors by flow regime and flow state

---

## 2. Study Area & Gauge Network

### 2.1 Basin Overview

The Potomac River at Little Falls (USGS 01646500) drains 11,560 mi². Point of Rocks, 41 river miles upstream, captures 83.5% of this drainage. The remaining 16.5% enters between Point of Rocks and Little Falls via tributaries and ungauged streams.

### 2.2 Gauge Inventory

| Gauge | USGS ID | Parameters | Drainage (mi²) | % of LF Basin | Travel to LF | Role |
|-------|---------|------------|----------------|---------------|--------------|------|
| Little Falls | 01646500 | Q, H | 11,560 | 100% | — | Validation target |
| Point of Rocks | 01638500 | Q, H, T | 9,651 | 83.5% | ~26 hrs | Primary predictor |
| Edwards Ferry | 01644148 | H only | 11,130 | 96.3% | ~7 hrs | Ensemble blend |
| Monocacy River | 01643000 | Q, H | 817 | 7.1% | ~14 hrs | Tributary addition |
| Goose Creek | 01644000 | Q, H | 332 | 3.0% | ~10 hrs | Tributary addition |
| Broad Run | 01644280 | Q, H | 76 | 0.66% | ~8 hrs | Tributary addition |
| Seneca Creek | 01645000 | Q, H | 101 | 0.87% | ~5 hrs | Tributary addition (enters above GF, below EF) |
| Hancock | 01613000 | Q, H | 4,073 | 35.2% | ~120 hrs | Upstream early warning |
| Cumberland | 01603000 | Q, H | 877 | 7.6% | ~180 hrs | Upstream early warning |

*Q = discharge (param 00060), H = gage height (param 00065), T = water temperature (param 00010). Travel times at median flow (~5,000 cfs) with ×0.80 empirical correction.*

### 2.3 Data Availability & Missing Data Handling

When a gauge returns invalid data (USGS sentinel value -999999), discharge is estimated using drainage area ratio:

```
Estimated_CFS = LF_CFS × (gauge_drainage_area / 11,560)
```

Estimated values are displayed in italics with a yellow asterisk. Common causes: ice at measurement site, gauge malfunction, communication outage.

### 2.4 Below Point of Rocks

16.5% of Little Falls' drainage enters below Point of Rocks:
- Monocacy: 7.1% (gauged)
- Goose Creek: 3.0% (gauged)
- Broad Run: 0.66% (gauged)
- Seneca Creek: 0.87% (gauged, enters below EF but above GF — included in estimate, absorbed by LF validation)
- Ungauged streams: ~4.9% (~570 mi²)

Local storms in ungauged areas can raise Little Falls independently of Point of Rocks.

---

## 3. Travel Time Model

### 3.1 Theoretical Basis

The travel time model derives from USGS Circular 438 (Searcy & Davis, 1961), which measured mean water velocity vs. discharge at Point of Rocks and Little Falls using dye-tracer studies:

```
V_avg = 0.0116 × Q^0.5963   (R² = 0.99)
```

Converting velocity to travel time over the 41-mile PoR→LF reach:

```
T_original = 5174 × Q^(-0.5963)
```

### 3.2 Empirical Correction (×0.80)

Cross-correlation analysis of modern USGS instantaneous data (6 months of 15-minute readings plus 2 years of daily data, January 2026) showed observed travel times are approximately 20% faster than Searcy's 1961 measurements. We apply a conservative 0.80 multiplier:

```
T = 4139 × Q^(-0.5963)
```

Where T = travel time in hours, Q = Little Falls discharge in cfs.

**Correction evidence:**
- Rising limb analysis: peak PoR→LF correlation at 24 hours (r = 0.958)
- Empirical power-law fit: T = 2438 × Q^(-0.5491), R² = 0.908
- Conservative approach: preserve Searcy's physically-derived exponent (-0.5963), adjust coefficient only
- Likely cause: changed channel conditions (sediment, vegetation, cross-section geometry) over 60+ years

**What the time-shift represents:** the quantity we need is the *hydrograph* (flow-signal) propagation lag, which travels faster than the bulk water itself — so this is a wave-celerity time, not literal dye-tracer water-particle travel. The modern cross-correlation above (24h rising-limb peak) measures exactly that propagation lag, and the ×0.80 factor brings Searcy's water-velocity relation into line with it. The lag is well-constrained at higher flows (the PoR↔Little Falls signal correlation is strong there) but poorly identified at low flow, where tributary inflow and slow recession dominate; the low-flow times above should be read as order-of-magnitude.

### 3.3 Travel Time by Flow Regime

| LF Flow (cfs) | Searcy (1961) | Corrected (×0.80) | PoR → GF (75%) | GF → LF (25%) |
|---------------|---------------|-------------------|----------------|----------------|
| 1,000 (floor) | 84 hrs | 67 hrs | ~50 hrs | ~17 hrs |
| 2,000 | 56 hrs | 45 hrs | ~33 hrs | ~11 hrs |
| 5,000 | 32 hrs | 26 hrs | ~19 hrs | ~6.5 hrs |
| 15,000 | 17 hrs | 13 hrs | ~10 hrs | ~3.3 hrs |
| 50,000 | 8 hrs | 6.5 hrs | ~5 hrs | ~1.6 hrs |

*Values computed from the deployed relation `T = 4139·Q^−0.5963` (the Corrected column), not Searcy's raw table — they diverge below ~5,000 cfs.*

The PoR→GF segment accounts for 75% of total travel time (slower pooled sections above the falls), while GF→LF accounts for 25% (faster flow through the gorge). Discharge is floored at 1,000 cfs, so the PoR→GF time-shift spans **~5h (high water) to ~50h (the low-water floor), ~19h at median flow** — not the "19–33h" stated in earlier versions, which understated the low-flow end.

### 3.4 Upstream Gauge Extensions

For gauges upstream of Point of Rocks, baseline travel times are from Searcy Table 2, adjusted with the same 0.80 multiplier and scaled by the same flow-dependent function.

| Gauge | Baseline (median flow) | Uncertainty |
|-------|------------------------|-------------|
| Point of Rocks | 26 hrs | ±10% |
| Shepherdstown | 50 hrs | ±15% |
| Hancock | 120 hrs (~5 days) | ±15-20% |
| Cumberland | 181 hrs (~7.5 days) | ±15-20% |

**Limitation:** The Searcy power law was calibrated specifically for the PoR→LF reach. Upstream reaches have different channel characteristics. Upstream travel times are best used for "pulse is coming" awareness rather than precise arrival timing.

### 3.5 Iterative Convergence Algorithm

Travel time depends on flow, but we look up *historical* flow — creating a circular dependency.

**Problem:** Current flow = 1,200 cfs → travel time ~45h → look up PoR from 45h ago → find 1,900 cfs → but 1,900 cfs corresponds to ~34h, so that water already passed.

**Solution:** Iterate until convergence (within 1 hour):
1. Start with current flow → calculate travel time
2. Look up historical PoR from that many hours ago
3. Recalculate travel time based on that historical flow
4. Repeat until stable

Typically converges in 2-3 iterations. As of v36.4 this iteration runs on **both** the client and the
server (the server previously did a single pass), so the displayed and validated estimates compute the
time-shift by the same method.

### 3.6 Wave Celerity Adjustment

During rising flood events, the wave front travels faster than bulk water velocity (Fread, 1973). The pressure signal propagates faster than the water itself.

**Implementation:**
- Compute rate of rise from PoR history (% change per hour)
- Reduce travel time: 2% reduction per 1%/hr rise rate
- Maximum reduction: 30% (physics limit)
- Applied only during confirmed "rising" conditions

| Rise Rate | Travel Time Reduction | 19h Baseline → |
|-----------|----------------------|----------------|
| +2.5%/hr | 5% | 18.1h |
| +5%/hr | 10% | 17.1h |
| +10%/hr | 20% | 15.2h |
| +15%/hr+ | 30% (max) | 13.3h |

---

## 4. Edwards Ferry Stage-Discharge Model

### 4.1 Gauge Description

Edwards Ferry (USGS 01644148) is a stage-only gauge located ~2-3 miles upstream of Great Falls, draining 96.3% of the Little Falls basin (11,130 mi²). It provides gage height but no discharge. Its proximity to Great Falls makes it valuable for estimation, but the lack of discharge data requires a stage-discharge model.

### 4.2 Power-Law Calibration

We analyzed **5,220 deduplicated daily observations** from 2011-2026 using USGS daily value data:

1. Paired EF daily mean gage height with LF daily mean discharge
2. Excluded ice-flagged periods (USGS qualifier "e" or "Ice")
3. Excluded EF stage < 2.0 ft (below reliable measurement range)
4. Deduplicated by date (USGS returns two time series for this gauge; averaged)
5. Fit power-law: `LF_cfs = a × EF_stage^b` (physically appropriate for open-channel hydraulics)

**Important distinction: gauge accuracy vs. predictive accuracy.** All EF stage readings have been verified against the USGS API (7/7 spot-checks exact match). The gauge is accurate. However, a single stage reading at one location is a limited *predictor* of discharge at a downstream point — especially at low flows, where local channel geometry, vegetation, and dam operations dominate the stage-discharge relationship. This is why the ensemble weight is flow-dependent (§5.4).

### 4.3 Default Model

```
LF_cfs = 126 × EF_stage^2.46
```

| Metric | Value |
|--------|-------|
| R² | 0.91 |
| Median error | 11.7% (hourly) / 6.3% (daily) |
| RMSE | 3,391 cfs |
| Exponent | 2.46 |
| Observations | 5,220 (2011-2026, deduplicated) |

The exponent (2.46) is consistent with typical channel geometry power-law exponents (2.0-3.0) for natural rivers.

**Hourly validation:** Both models were re-estimated on 117,704 hourly observations (2011-2026). Coefficients changed less than 5% and exponents less than 0.05, confirming the daily-calibrated parameters are not materially biased. Autocorrelation inflates precision but does not bias OLS estimates, confirmed by Newey-West HAC standard errors and subsampling at 24h and 168h intervals. See `analysis/refit_powerlaw_hourly.py/.R`, audit: `analysis/powerlaw_refit_audit.md`.

### 4.4 Cold-Water Model

Analysis of 3,354 daily observations (1,680 unique dates; 12,959 hourly), 2021-2026, with concurrent water temperature data revealed temperature-dependent coefficients. Cold water has higher density and viscosity, altering the stage-discharge relationship.

| Condition | Formula | When Applied |
|-----------|---------|--------------|
| **Cold** | `LF_cfs = 160 × EF_stage^2.36` | Water temp ≤ 10°C (50°F) |
| **Default** | `LF_cfs = 126 × EF_stage^2.46` | Water temp > 10°C or unavailable |

The cold-water model improves winter RMSE by **10.9%**. A full three-regime model (cold/moderate/warm) was tested but degraded warm-season accuracy by 18.1%. The cold-only approach captures the largest improvement without negative side effects.

### 4.5 Temperature Data Source

Water temperature is fetched from Point of Rocks (USGS 01638500, parameter 00010). When temperature data is unavailable, the system falls back to the default model.

---

## 5. Great Falls Estimation

### 5.1 Problem Statement

No USGS gauge exists at Great Falls. The estimation combines upstream gauge readings with the Edwards Ferry stage-discharge model.

### 5.2 Estimation Formula

```
GF_estimated = PoR(t - T_converged) + Monocacy + Goose Creek + Broad Run + Seneca Creek - Correction
```

Where:
- PoR(t - T_converged) = Point of Rocks reading from T hours ago (T = converged travel time, §3.5)
- Monocacy = current Monocacy discharge (joins 6 mi below PoR)
- Goose Creek = current Goose Creek discharge (joins 12 mi below PoR)
- Broad Run = current Broad Run discharge (0.66% of LF, joins between Goose Creek and EF)
- Seneca Creek = current Seneca Creek discharge (0.87% of LF, joins below EF, above GF)
- Correction = learned correction factor for current flow bin and flow state (§6)

### 5.3 Ensemble Blending

The final estimate blends two independent models:

```
GF_final = (1 - w) × GF_PoR_model + w × GF_EF_model
```

Where w = EF weight (flow-dependent, see §5.4), GF_PoR_model = time-shifted PoR + tributaries, GF_EF_model = Edwards Ferry power-law estimate.

This ensemble reduces variance by combining a spatially distant but data-rich gauge (PoR, ~34 mi) with a nearby but data-limited gauge (EF, ~16 mi).

### 5.4 Flow-Dependent Weighting (Logistic Ramp)

A **7-approach model comparison** on 117,704 hourly observations (2011-2026) with Leave-One-Year-Out cross-validation (14 folds) identified a smooth logistic ramp as optimal. The EF gauge is accurate (USGS-verified), but its **predictive value** depends on flow regime — the logistic function captures this relationship continuously:

```
ef_weight = W_MAX / (1 + exp(-K × (ln(flow) - ln(MIDPOINT))))
         = 0.40  / (1 + exp(-5.0 × (ln(flow) - ln(10000))))
```

| Flow Level | EF Weight | PoR Weight |
|------------|:---------:|:----------:|
| 1,000 cfs | ~0.0% | ~100% |
| 3,000 cfs | 0.1% | 99.9% |
| 5,000 cfs | 1.2% | 98.8% |
| 10,000 cfs | 20.0% | 80.0% |
| 20,000 cfs | 38.8% | 61.2% |
| 50,000 cfs | 40.0% | 60.0% |

At low flows, EF weight is near zero (avoiding the negative-skill regime where local channel effects dominate). At high flows, it asymptotes at 40%. The logistic ramp achieved an out-of-sample RMSE of 1,907 cfs, a 4.6% improvement over the best alternative (flat 35% step function). Cross-language verified: blind Python and R subagents agree on the winner (RMSE within 7 cfs). See `analysis/horserace_v2_python.py`, `analysis/horserace_v2_R.R`, audit: `analysis/horserace_v2_audit.md`.

### 5.5 PoR-Delta Staleness Correction

When the river is rising or falling, the time-shifted PoR reading (~19h old at median flow, up to ~50h in low water) comes from a different flow regime and systematically misestimates current GF conditions. The PoR-delta correction scales the time-shifted estimate by the proportion of change observed at Point of Rocks since that reading:

```
IF |PoR_change%| > 5%:
    ratio = PoR_now / PoR_then
    decay = min(0.50, sqrt(staleness / travel_time))
    corrected = estimate × (1 + (ratio - 1) × decay)
```

The **decay factor** accounts for wave travel: if the time-shifted reading is 16h old and PoR→GF travel is 19h, the change at PoR has only partially reached GF. The sqrt ramp gives ~50% correction at 25% elapsed. The 0.50 cap prevents overcorrection on rises — cross-verified on 42,837 hourly pairs.

**Backtest results** (5,220 days, 2011-2026): PoR-delta correction reduced Rising RMSE by 17.8% (6,117→5,027 cfs) and Overall RMSE by 25.6% (3,981→2,963 cfs) with near-zero rising bias (+87 cfs vs baseline -2,286 cfs). See `analysis/backtest_approaches.py`.

### 5.6 Soft LF Ceiling

The GF estimate is capped at **120% of LF actual discharge**. On rising rivers, GF legitimately exceeds LF (the flood wave arrives at Great Falls before Little Falls), but the PoR-delta correction combined with EF blending can overshoot by 200% or more. The 120% ceiling limits extreme overshoots while preserving the legitimate rising signal. A 110% ceiling was tested but created a -509 cfs systematic under-prediction bias during rising events; 120% achieves near-zero rising bias (-61 cfs). A tool used to assess rising river conditions must not systematically under-predict. Cross-verified on 42,837 hourly pairs in Python and R. See `analysis/backtest_comprehensive.py`.

### 5.7 EF Discrepancy Check

When EF estimate differs from PoR estimate by more than 50%, the system skips ensemble blending and uses PoR-only. This guards against ice-affected EF readings, backwater conditions, or gauge malfunctions that would corrupt the ensemble.

### 5.8 Hysteresis Correction

At the same stage, a rising river carries more flow than a falling river (Fread 1973, Henderson 1966). The system applies fixed, literature-informed multipliers to the **client-side** Edwards Ferry estimate:

- Rising ×1.08 (+8%), falling ×0.92 (−8%), steady ×1.00 — **fixed priors, not learned** (they do not adapt to validation errors)
- Applied client-side only, to the EF component of the local ensemble and the shadow-model comparison; the server-written (validated, displayed) GF estimate applies no hysteresis multiplier

*(An adaptive-EMA update path (α = 0.2, clamped to ±20%) exists in the code but is not wired into the validation pipeline, so the multipliers stay frozen at the values above.)*

### 5.9 Confidence Indicator

Reflects **data quality**, not prediction accuracy:

| Level | Conditions |
|-------|------------|
| HIGH | Tributary data available AND time-shifted PoR history AND EF trend agrees |
| MEDIUM | Missing time-shifted data OR EF trend disagrees |
| LOW | Missing tributary data OR no PoR trend data |

Downgrades: EF trend conflict, insufficient history for time-shifting, tributary gauges offline.

**EF divergence advisory (v37.13).** A further display-only downgrade: the hourly cron computes
D = bare-EF-power-law ÷ PoR-side estimate each cycle and keeps a trailing 5h median (fail-closed —
≥3 valid samples, EF reading ≤2h old and in rating/sanity range, cold water ≤10 °C ineligible with
1 °C re-eligibility hysteresis, Nov–Mar proxy when temp is unknown). When D̄ ≥ 1.20 sustains
(deactivates below 1.15), the GF card drops its displayed confidence one further notch (stacking
with the trend downgrade above) and shows an amber "cross-check gauge disagrees" advisory
explaining why: across a 15-year replay, divergence-active hours were ~2.4× less accurate with ~3×
the >25%-miss rate, mostly under-reads. Server-authoritative (`ef_divergence/state` row shipped in
the learning payload; the client hides state older than 2h). Each completed firing is logged as an
append-only `ef_divergence_episode` row (v37.14): start/end, cycles, peak and mean D̄, LF range,
lfAtPeak, and a per-cycle {t, D̄, LF} trail (capped at 336 entries) — so how often and in which flow
regimes the advisory fires is durably documented. The displayed copy states the disagreement and the
caution; the accuracy statistics behind it live here and in the advisory plan, not on the card
(user-directed copy trim, v37.14). **Display-only by mandate:** the
corresponding v38.0 *estimator* change (shifting weight to EF during divergence) failed its
pre-registered backtest gate — in most historical below-PoR events EF did not read high at all, and
false activations were confirmed harmful — so nothing here touches the estimate, weights, or
learning (see `analysis/v38_gate_verdict_2026-07-20.md`).

**LF-residual advisory (v37.15).** A sibling display-only signal for the events the EF cross-check
is structurally blind to: water entering *below* Edwards Ferry (a 2026-07-22 storm produced a −21%
hard-flagged under-read while D̄ never crossed 1.15). The trigger is the model's **own validated
scorecard** — every hour a pending prediction matures, its corrected error against observed LF is
fed to a latch: a pair ≤ −15% latches ON, > −7.5% clears, in between holds; the advisory shows only
while the newest pair is ≤ 12h old (fail-closed on signal gaps; the latch itself survives, so a
mid-deadband pair after a gap resumes the advisory). Rule and thresholds were chosen by a
decision-gated backtest over the frozen 15-year v38 dataset (blind Python/R dual-verified):
predictions made while this banner was up scored a median |error| of 10.6% vs 1.8% baseline, with
~21× the ≤−25% under-read rate — mostly genuine alarms, at ~4.9% duty. The signal is inherently
*reactive*: it cannot fire before the first bad validation arrives, so the first miss of every
episode goes unflagged. When active and fresh (≤2h client guard), a second amber advisory renders
and displayed confidence drops one further notch (stacking with the divergence advisory above is
intended — different observables). Server-authoritative (`lf_residual/state` row; completed firings
logged as append-only `lf_residual_episode` rows with per-pair error/LF trails; validation entries
stamped `lfResidualActive`/`lfResidualLastErrPct`). Evidence and decision record:
`analysis/lf-residual-advisory-plan-2026-07-23.md`. **Display-only by mandate** — nothing here
touches the estimate, weights, or learning.

### 5.10 Uncertainty Display (Empirical 90% CI — v36.1)

The app displays a calibrated, **asymmetric** 90% confidence interval based on empirical quantiles of the *corrected* residual:

```
90% CI: 2,900 – 3,500 cfs
```

**Methodology (v36.1, C2):** The interval is calibrated on the **corrected residual** `r = (displayed estimate − actual LF)`, the residual the user actually sees — not the bare ensemble error. Quantiles were derived by replaying the **real production model** over 126,916 hourly observations (2011-2026, including the four tributaries and LF stage) in a prequential EMA backtest (`analysis/ci_backtest_harness.mjs`), logging `r` per validated prediction, and binning by the model's own `(flowBin, flowState)` output — the exact key the display looks up. Residuals are non-normal and, after the bias correction, genuinely two-sided and often asymmetric (e.g. `50000+/falling` is q05 = −4,099, q95 = +6,429).

**CI formula (sign-aware):** `[estimate − q95(bin), estimate − q05(bin)]`, where q05/q95 are the 5th/95th percentiles of `r` for the flow bin × flow state. This follows from `actual = estimate − r`: a 90% interval for `r` maps to `[estimate − q95, estimate − q05]` for the true flow. (Through v36.0 the band was the symmetric `estimate ± (q95−q05)/2`, which discarded the sign and could not represent an asymmetric or same-signed interval — fixed in v36.1.)

**High flow:** the 25000-50000 and 50000+ bins use the wider of the multi-/single-pending backtest tails, so the band does not under-cover the laggier correction the deployed cron actually serves.

**Semantics:** because the model is validated against Little Falls discharge, the band is an *LF-equivalent-flow* interval at the GF location — it bundles GF model error plus GF→LF routing / ungauged-flux variability, not pure GF model uncertainty.

**Verification:** blind Python + R derivation (agree < 1e-9) + independent auditor + 6/6 live-USGS provenance spot-checks; out-of-sample coverage 88.4%, deployed-proxy (single-pending) coverage 89.1%. See `analysis/ci_v36.1_backtest_plan.md` and `analysis/ci_v361_derivation_spec.md`.

---

## 6. Learning & Validation System

### 6.1 Prediction-Validation Cycle

Each Great Falls estimate is validated ~6-7 hours later when water reaches Little Falls:

1. Store prediction with timestamp, flow bin, and flow state
2. When the water arrives, read the **observed Little Falls discharge** (`lf.q`)
3. Compute error: (predicted − actual) / actual, where *actual* is that raw LF reading
4. Update correction factor using EMA (§6.4)

**What "actual" means here — read this before interpreting any accuracy figure.** Step 2 previously
read "calculate what GF actually was." That was false, and the distinction matters. **No Great Falls
ground truth exists** — there is no USGS gauge, NPS station or adjusted-flow series at the falls — so
nothing in this system ever observes GF discharge. The validation target is the raw Little Falls
reading, and the model is scored on how well it predicts *that*.

The consequence is an **estimand mismatch**: every calibrated component points at Little Falls, not
Great Falls. The EMA correction learns on (prediction − LF); the Edwards Ferry power law was fit to
LF discharge; the §5.7 confidence band is quantiles of (prediction − LF); and the displayed estimate
is capped at 120% of LF. The number the app calls "Great Falls flow" is therefore structurally
**"Little Falls discharge, one GF→LF travel time ahead."** For a paddler that is a defensible and
arguably preferable target — Great Falls conditions are in practice read off the Little Falls gauge —
but it is not the same quantity as discharge at the falls, and the difference is not merely
semantic: the **water-supply withdrawals between the two points** (Washington Aqueduct and WSSC draw
from this reach) sit inside the residual the EMA learns, so the correction silently absorbs them
rather than modelling them. That wedge is **unidentifiable** without a GF observable: any attempt to
separate "true GF flow" from "LF flow plus withdrawals" is unconstrained by data the system can see.

This is a known open item, not a defect being hidden — see TODO "Reassess LF ground-truth bias".

### 6.2 Correction Bins

Corrections are learned separately for 18 bins (6 flow levels × 3 flow states):
- **Flow bins:** <3k, 3-6k, 6-12k, 12-25k, 25-50k, >50k cfs
- **Flow states:** rising, falling, steady

### 6.3 Hierarchical Fallback

When a specific bin × state combination has fewer than 5 observations, the system falls back through three tiers:

1. **Tier 1 — Same bin, pooled states:** Observation-weighted average of all flow states within the same flow bin that have ≥5 observations. This preserves flow-regime specificity while relaxing the state requirement.
2. **Tier 2 — Adjacent bin, same state:** Uses the correction from the nearest neighboring flow bin (lower neighbor preferred) with the same flow state. Falls back to `steady` if the requested state is unavailable.
3. **Tier 3 — Cold start:** Returns 0 (no correction applied).

**Linear blending** eliminates the discontinuity at the 5-observation threshold:

```
weight = min(1, count / 5)
correction = weight × bin_correction + (1 - weight) × fallback_correction
```

At n=0, correction is 100% fallback. At n=5, correction is 100% bin-specific. The transition is smooth and monotonic.

This is a **read-side only** change — no modification to how the server validates predictions or updates correction bins. The fallback applies identically on both client and server via shared helper functions (`getBinCorrection`, `getFallbackCorrection`).

**Flow-edge smoothing (v37.0, C45):** the *applied* correction (`getGFCorrectionInterpolated`) is continuous in flow across the **low/mid** bin boundaries (3,000 / 6,000 / 12,000 cfs). Within ±12% flow of each, it ramps linearly in log-flow between the two adjacent bins' corrections; away from a boundary it returns the bin's exact correction (so mid-bin output is unchanged). The **25,000 and 50,000 boundaries are intentionally left as hard steps** — at high flow the correction reflects genuine flow-regime structure, and a prequential 14-yr backtest (blind Python+R, independent auditor) showed that smoothing those boundaries *degraded* accuracy (the 25,000–50,000 bin worsened), whereas the shipped low/mid-only design is accuracy-neutral-to-better (pooled MAE −1.1%, RMSE −0.6%; high-flow bins exactly unchanged). This is **application-only**: the 18-bin EMA still learns on the discrete `getFlowBin(rawFinalUnclipped)`, so there is no learn↔apply feedback. Identical on client and server (`getGFCorrectionInterpolated` in `shared-model.js` ↔ `shared/model.js`, parity-tested). Trend-state-axis smoothing (Phase 2) was deferred.

### 6.4 EMA Smoothing

Correction factors update via exponential moving average:
```
new_correction = α × latest_error + (1 - α) × old_correction
```
With α = 0.3, weighting recent observations more heavily while maintaining stability.

### 6.5 Outlier Filtering

Errors >3 standard deviations from the bin mean are discarded. This prevents bad data (gauge malfunction, ice) from corrupting learned corrections.

### 6.6 Flow State Classification

The threshold scales with flow magnitude:
```
threshold = max(100 cfs, 0.02 × current_flow)
```

| Flow Level | Threshold | Effective % |
|------------|-----------|-------------|
| 2,000 cfs | 100 cfs | 5.0% |
| 5,000 cfs | 100 cfs | 2.0% |
| 10,000 cfs | 200 cfs | 2.0% |
| 50,000 cfs | 1,000 cfs | 2.0% |

Flow state is determined from the observed PoR rate (**6-hour lookback** on stored PoR history). Cold-start behavior differs by runtime: the **client** falls back to NWS forecast trend direction when its PoR history is too sparse to classify a trend (rise-rate gate: fewer than 4 readings, or no ~6h-spaced baseline); the **server** (cron — the sole learner/validator) returns `steady` when its PoR history has fewer than 8 entries or lacks a reading ≥6h old, and never consults NWS for flow state. The 6-hour window matches the median PoR→GF travel time and is wide enough to capture the Potomac's slow recession dynamics (median |Δcfs|/2h is only ~1% at baseflow; over 6 hours the same recession registers above the 2% threshold).

Separate corrections per flow state account for momentum effects (rising water moves faster) and hysteresis (falling water drains slower).

### 6.7 Background Scheduler

A serverless function executes every hour:
1. Fetch USGS data for all gauges
2. Store PoR history to cloud database (72-hour window)
3. Validate pending predictions against actual LF readings
4. Update correction bins with new error data
5. Clean up stale predictions (>48 hours → deleted)
6. Make new prediction and store for future validation

The model improves continuously, even when no browsers are open.

### 6.8 Health Monitoring

- **Consecutive runs:** Streak of on-time hourly executions
- **Missed runs:** Count of skipped hourly cycles
- **Stale cleanup:** Predictions >48 hours deleted, not validated
- **Admin reset:** Clears flow-bin corrections while preserving health statistics

### 6.9 Historical Accuracy Tracking *(retired v33.2)*

An earlier build displayed a `100% − MAE%` "Historical Accuracy" badge. It was removed in v33.2 as structurally misleading (it scored the uncorrected model and conflated bias with noise); the display element remains hidden. Current accuracy reporting lives in the forecast-validation metrics (§8.6) and the learning panel.

---

## 7. Ice & Anomaly Detection

### 7.1 ADVM Physics

USGS Little Falls uses an Acoustic Doppler Velocity Meter (ADVM). Frazil ice — small crystals suspended in supercooled water — scatters and absorbs the acoustic signal, causing artificially low velocity readings even when stage (pressure transducer) remains accurate. This produces CFS readings far below actual discharge.

### 7.2 Two-Tier Scoring System

The system uses sensor fusion with two flag tiers. USGS ice flags are a separate upstream system — anomaly detection only runs when USGS says data is clean.

**Hard Flags** — physical data corruption → skip learning AND accuracy:

| Check | Signal | Threshold | Hard Score |
|-------|--------|-----------|------------|
| Stage-Discharge | LF stage vs ADVM velocity contradict | >35% discrepancy | +2 |
| Low Flow Sanity | Low CFS with elevated stage (classic ice) | <1,500 cfs @ >2.45 ft | +2 |
| Statistical Outlier | Error exceeds 3σ from bin mean | z-score > 3 | +2 |

**Soft Flags** — model disagreement → INCLUDE in learning (EMA clamped) AND accuracy:

| Check | Signal | Threshold | Soft Score |
|-------|--------|-----------|------------|
| EF Cross-Check | EF predicts higher flow than LF reports | >25% discrepancy | +2 |
| Large Error | Prediction error exceeds reasonable bounds | >50% error | +1 |

**Flag determination:** `isHardFlagged = hardScore ≥ 2`, `isSoftFlagged = !isHardFlagged && softScore ≥ 2`.

### 7.3 Learning Protection

**Hard flag (score ≥ 2):**
- Excluded from both learning and accuracy; logged with an anomaly tag for analysis — the LF reading itself is corrupted
- The pending row is deleted on validation like any other prediction (no per-record `hard_flagged` tier is stored)
- Displayed (v37.12): the Prediction Accuracy (7d) chart renders hard-flagged validations from the
  `validation_failure` log as hollow markers — outside the line paths and the y-axis domain (the flagged
  actual is by definition a suspect reading; out-of-range markers clamp to the plot edge, and only when
  zero clean validations exist in the window do flagged markers alone define the axis), windowed to
  7 days client-side, and never entering the headline average, which remains computed over clean
  validations exactly as before

**Soft flag (score ≥ 2, no hard flag):**
- INCLUDED in learning and accuracy — the model is probably wrong, not the data
- EMA contribution clamped at ±2σ from bin mean (prevents single large-error obs from spiking correction)
- Running sums (count, sumError, sumErrorSq) use raw values; only EMA uses clamped value
- Logged with a soft-flag tag (no per-record `soft_flagged` tier is stored; the pending row is deleted on validation)

**Scientific basis:**
- Stage (pressure transducer): unaffected by ice crystals
- ADVM (velocity): biased low by ice scattering
- Edwards Ferry (stage-only): provides independent check unaffected by ADVM interference
- Check 1 (EF discrepancy) alone is equally consistent with model error as with ice — hence soft flag

### 7.4 Trend Validation

If Edwards Ferry trend (rising/falling) disagrees with PoR trend, confidence is reduced. This detects local conditions differing from upstream.

### 7.5 Example Detection

```
Example 1 — HARD flag (ice):
LF reports:  1,120 cfs @ 2.83 ft stage
Expected:    ~2,000 cfs (from stage rating curve)
→ hardScore: 2 (stage-discharge 79%) + 2 (low flow @ high stage) = 4
→ HARD FLAGGED: Skip learning + accuracy

Example 2 — SOFT flag (model error):
LF reports:  8,500 cfs @ 3.10 ft stage
EF estimate: 11,200 cfs (from 6.20 ft stage)
→ softScore: 2 (EF 32% discrepancy)
→ SOFT FLAGGED: Included in learning (EMA clamped) + accuracy
```

---

## 8. 48-Hour Forecast

### 8.1 Why a Different Method is Needed

The nowcast estimate looks backward: "What PoR reading from ~5-50 hours ago has arrived at GF now?" For forecasting, at low flow (~1,000 cfs, PoR→GF lag ~50h):
- +6h forecast needs PoR from ~44 hours *ago* (historical, not forecast)
- +48h forecast needs PoR from ~2 hours *ago* (still historical)

The forecast would show flat conditions even when a rise is imminent.

### 8.2 LF-Constrained Approach

Great Falls is between Point of Rocks and Little Falls. If NWS predicts LF will rise, GF must rise first. We exploit this constraint:

1. Get NWS Little Falls forecast (BRKM2)
2. Shift backward by GF→LF travel time (~1.6h at 50,000 cfs, ~6.5h at median flow, up to ~17h at the 1,000-cfs discharge floor)

```
GF_forecast(t) ≈ LF_forecast(t + T_GF_LF)
```

### 8.3 Additive Bias Correction

NWS forecasts exhibit systematic bias. We apply an additive correction:

```
offset = observed_LF_now - forecast_LF_at_now
corrected_forecast = raw_forecast + offset
```

**Why additive, not multiplicative:** Preserves the forecast's predicted *change* in flow (physics of the rise). Percentage-based correction would over-correct at high flows and under-correct at low flows because river hydraulics are non-linear.

**Example:**
- Observed LF: 1,020 cfs | Forecast at now: 1,300 cfs → offset: -280 cfs
- NWS predicts 3,400 cfs at +6h → corrected: 3,120 cfs

The offset recalculates every 15 minutes and automatically shrinks as NWS updates their model runs.

### 8.4 Calculation & Display Intervals

- **Calculation:** 6, 12, 18, 24, 30, 36, 42, 48 hours (8 points for smooth interpolation)
- **Display:** 6, 12, 24, 48 hours (shown as forecast cards)

### 8.5 Ensemble Blending for Forecasts

When EF forecast data is available, forecast values are blended using the same flow-dependent weighting as the current estimate (§5.4). Otherwise, the LF-derived forecast is used alone.

### 8.6 Forecast Validation

Forecast predictions are stored as pending and validated when water arrives at Little Falls — that is, at `targetTime + T_GF_LF`, not at `targetTime`. A forecast for wall-clock *t* predicts flow at **Great Falls** at *t*, and that water reaches the Little Falls gauge only one GF→LF travel time later. **Through v37.15 the validator omitted that term** and scored every forecast against Little Falls at *t*, an error of 1.65 h at 50,000 cfs, ~9 h at 2,800 cfs and up to 16.95 h at the 1,000-cfs discharge floor — at typical summer flows, larger than the +6 h horizon itself. The error vanished under steady flow and concentrated on rising and falling limbs, so the published accuracy looked plausible while being systematically wrong exactly during the events a forecast exists for. Fixed in v37.16. The rare PoR-fallback path (used when the NWS Little Falls series is unavailable) reads PoR at the target hour with no travel offset, so it is already Great-Falls-referenced and is validated at *t*; rows carry a `travelApplied` flag recording which clock they belong on.

The surviving skill baseline is **persistence** (Little Falls holds its observed flow). The two NWS baselines (raw and bias-corrected) were retired in v37.16: once the model is scored on the Great Falls clock, a same-clock NWS baseline is the model by construction — the bias-corrected baseline is the identical value, and the raw baseline is the model minus the batch-constant bias offset — so the "vs NWS" comparison could not be made informative by any choice of validation time. Their historical counters remain in the metadata rows as an audit trail but no longer accrue. This is worth stating plainly: **the 48-hour forecast has no independent content beyond a time-shift of the bias-corrected NWS Little Falls forecast, plus a small Edwards Ferry blend that is negligible below ~6,000 cfs.** Persistence is therefore the only honest measure of whether it adds value.

### 8.7 Fallback Behavior

When NWS forecast is unavailable, the system uses linear extrapolation from recent trends.

---

## 9. Limitations & Uncertainties

### 9.1 Model Limitations

| Factor | Impact | Notes |
|--------|--------|-------|
| Steady-state assumption | High during floods | Rapid flood waves travel faster than predicted (mitigated by wave celerity adjustment, §3.6) |
| Single flow multiplier | ±10-20% for upstream | Same scaling applied to all reaches, though channel characteristics vary |
| Ungauged tributaries | ~4.9% unmonitored | Local storms in ungauged areas can cause unexpected rises |
| 0.80 travel time correction | Needs validation | Empirical correction based on limited modern data |
| Provisional USGS data | Small, transient | Both the Point of Rocks input and the raw Little Falls validation target come from the USGS instantaneous-values (IV) feed, which is real-time and provisional. Values are frozen at fetch time and never re-read, so a later USGS revision is not reflected; the effect on the learned correction is noise, not systematic bias. |

### 9.2 Great Falls Estimation Uncertainties

| Factor | Impact |
|--------|--------|
| Tributary timing | Monocacy/Goose/Broad Run/Seneca readings are current, not time-shifted to confluence arrival |
| Water withdrawals | Washington Aqueduct (at GF), WSSC (Swain's Lock), and Fairfax Water (Seneca) divert ~400-700 cfs above the falls. Already absorbed by LF-calibrated model; no correction needed. |
| EF dam influence | At <3,000 cfs, dam operations cause ±33% EF bias (mitigated by flow-dependent weighting) |
| Temperature data gaps | When PoR temp unavailable, cold-water model cannot activate |

The learning system corrects for systematic errors over time.

---

## 10. Data Sources & Acknowledgments

This application relies entirely on public data from U.S. government agencies.

### 10.1 Real-Time Streamflow Data
- **Source:** U.S. Geological Survey (USGS) National Water Information System (NWIS)
- **API:** USGS Water Services REST API (https://waterservices.usgs.gov)
- **Parameters:** Discharge (00060), Gage height (00065), Water temperature (00010)
- **Update frequency:** 15-minute intervals
- **Data status:** Provisional (real-time IV feed). Values are unverified and subject to USGS revision; Potomac Pulse uses the value available at fetch time and does not back-fill later revisions.

### 10.2 River Forecasts
- **Source:** National Weather Service (NWS) / NOAA
- **Service:** National Water Prediction Service (NWPS)
- **API:** https://api.water.noaa.gov/nwps/v1/
- **Forecast point:** BRKM2 (Little Falls / Brookmont)

### 10.3 Historical & Reference Data
- Travel time model: USGS Circular 438 (Searcy & Davis, 1961)
- Validation data: USGS Water-Supply Paper 2257 (Taylor et al., 1985)
- Drainage areas: USGS StreamStats and gauge metadata

### 10.4 Disclaimer
This application is not affiliated with, endorsed by, or connected to the USGS, NWS, NOAA, or any government agency. Data is provided "as-is" from public APIs. For official river information and flood warnings, consult https://water.weather.gov.

---

## 11. References

1. Searcy, J.K. and Davis, L.C., Jr. (1961). "Time of Travel of Water in the Potomac River, Cumberland to Washington." *USGS Circular 438.* U.S. Geological Survey.

2. Taylor, K.R., James, R.W., and Helinsky, B.M. (1985). "Traveltime and Dispersion in the Potomac River, Cumberland, Maryland, to Washington, D.C." *USGS Water-Supply Paper 2257.*

3. Fread, D.L. (1973). "Technique for Implicit Dynamic Routing in Rivers with Tributaries." *Water Resources Research,* 9(4), 918-926.

4. Henderson, F.M. (1966). *Open Channel Flow.* Macmillan.

5. MWCOG (1984). "Potomac River Hydraulic Survey." Metropolitan Washington Council of Governments.

6. ICPRB (2002). "Source Water Assessment for the Potomac River, Chapter 3: Hydrology." Interstate Commission on the Potomac River Basin.

7. USGS (ongoing). National Water Information System: Web Interface. https://waterdata.usgs.gov/nwis

8. NWS (ongoing). National Water Prediction Service. https://water.weather.gov

---

## 12. License & Copyright

© 2026 Gordon Shumway. All rights reserved.

Licensed under **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)**.

You may share and adapt this material for non-commercial purposes with attribution. Full license: https://creativecommons.org/licenses/by-nc/4.0/

---

## 13. Versioning Scheme

Starting with v25.0, Potomac Pulse uses **MAJOR.MINOR** versioning:

- **MAJOR** (v25 → v26): Changes to the core GF estimation logic — model recalibration, new estimation approach, architectural changes that alter outputs for the same inputs.
- **MINOR** (.0 → .1): Bug fixes, UI changes, new features/tabs, documentation updates, display changes — anything that does not alter the core estimation output.

**Current version:** v37.16 | **Last calibration:** v30.0 (Feb 2026) | **Last estimate-structural change:** v37.0 (Jun 2026 — C45: the applied correction is continuous in flow across the low/mid bin boundaries, not a hard step). v37.1 retired the legacy System-1 gauge travel-time learning (display-only); v37.2 fixed cron failure-ping observability (server-only); v37.3 was an internal decomposition; v37.4 replaced the render-path setter-injection scaffolding with an event bus and removed the 4s NWS render gate (client display/timing only); v37.5 parallelized the cold-load learning-data SELECTs (server perf, behavior-neutral); v37.6 added a PIN-gated learning-data backup export, v37.7 a System Diagnostics panel, v37.8 admin audit logging, v37.9 validation-failure logging, v37.10 an offline service worker, v37.11 a mobile sidebar-scroll fix, v37.12 hollow-marker display of hard-flagged validations in the accuracy chart, v37.13 the EF divergence advisory (display-only confidence downgrade + explanatory note during sustained EF-above-model divergence; the v38.0 estimator change failed its pre-registered gate and was NOT implemented), v37.14 divergence-episode logging, and v37.15 the LF-residual advisory (a second display-only honesty signal driven by the model’s own validated LF residual — catches below-EF ungauged-inflow events the EF cross-check cannot see) (all additive/read-only, server-only, client-only, or CSS-only). All leave the GF estimate unchanged. v37.16 corrected the forecast VALIDATION CLOCK — a forecast for wall-clock t predicts flow at Great Falls at t, so it is now scored against Little Falls at t + the GF→LF travel time rather than at t (the behavior §8.6 already specified) — and retired the two NWS skill baselines, which on the model's own clock are the model plus a constant; persistence (observed LF) is now the sole comparison. Metrics/display only.

For the complete version history (v16 through v37.16), see [CHANGELOG.md](CHANGELOG.md).

---

*Generated by Potomac Pulse v37.16 — forecast validation clock + NWS baselines retired (MINOR, metrics/display only; the GF estimate and EMA learning are untouched): a forecast for wall-clock t predicts flow at GREAT FALLS at t, but the validator compared it against Little Falls at t, omitting the GF→LF travel time — 1.65h at 50,000 cfs, ~9h at 2,800 cfs, up to 16.95h at the 1,000-cfs floor, i.e. larger than the +6h horizon itself at typical summer flows. This is the behavior CLAUDE.md and §8.6 already documented ("validated when water arrives at LF"); the code simply did not implement it. Forecasts are now scored at targetTime + travel (PoR-fallback rows, which carry no offset by construction, stay at targetTime via a new travelApplied flag); the stale sweep widens 72h→90h so a +48h forecast at the discharge floor cannot be deleted before it ripens; the fetch cap rises 100→300 so a long-horizon backlog is far less likely to crowd out due rows, and rows are processed in ripeness rather than insertion order (that sort runs after the fetch, so it does not change which rows arrive — it makes a tick that dies part-way have done the due work); a corrupt targetTime is now cleaned instead of scoring garbage. The two NWS baselines were RETIRED: on the model's own clock the bias-corrected baseline is the identical value and the raw baseline is the model minus a batch constant, so the "vs NWS" delta could not be made informative — persistence (observed LF) is the one external reference that survives and is now the displayed skill comparison. Existing NWS counters are frozen as an audit trail. Accumulated forecast accuracy accrued under the old comparison and needs a reset to be interpretable. Plan + 18-finding independent audit: analysis/forecast-validation-timing-fix-plan-2026-08-28.md. 744→757 tests. Recent: v37.15 — LF-residual advisory (MINOR, display-only): a second honesty banner driven by the model’s own validated LF residual — a validated pair ≤ −15% latches, > −7.5% clears, 12h signal staleness (decision-gated on the frozen v38 backtest, blind Python/R dual-verified: banner-up hours ~6× worse median error, ~21× the big-miss rate, ~4.9% duty; inherently reactive — the first miss of each episode is unflagged); catches below-EF ungauged-inflow events the EF divergence advisory is structurally blind to (2026-07-22: −21% miss at D̄ 1.15); state row + append-only episode rows + validation stamps; second amber banner + one more confidence notch (stacking intended). Nothing feeds the estimate, weights, or learning. Recent: v37.14 divergence-episode logging + advisory copy trim (MINOR, server-only + copy): each completed advisory firing is now recorded as an append-only `ef_divergence_episode` row (start/end, cycles, peak/mean D̄, LF range, per-cycle trail capped at 336 entries) so duty cycle and flow-regime concentration are durably documented with actual numbers; the displayed advisory copy drops the history-stats sentence (the evidence remains in §5.9). Recent: v37.13 EF divergence advisory (MINOR, display-only): when the Edwards Ferry cross-check has read well above the model's upstream inputs for a sustained 5h window (D̄≥1.20, fail-closed detector on the hourly cron, cold-water-ineligible), the GF card downgrades its displayed confidence one notch and explains why — replayed history shows such hours are ~2.4× less accurate with ~3× the >25%-miss rate, mostly under-reads. The v38.0 estimator change this descends from FAILED its pre-registered gate and was not implemented; nothing here feeds the estimate, the weights, or learning. Recent: v37.12 hard-flagged validations shown in the accuracy chart (MINOR, client display, additive): the Prediction Accuracy (7d) chart merges the append-only `validation_failure` log (v37.9) into its timeline as hollow markers — excluded from the line paths, the y-domain, and the headline average (which stays byte-identical over clean validations) — so anomalous events (e.g. local-runoff misses) are visible instead of appearing as silent gaps; pure client change via a new tested `src/ui/validation-merge.js` helper. No model/learning/accuracy-metric/estimate change. Recent: v37.11 mobile sidebar scrolling (Tier 4 #20) (MINOR, CSS-only): `#app` uses `100dvh` (with a `100vh` fallback) so it fills the visual viewport, and on mobile the sidebar is a single scroll container with sticky tabs — removing the nested double-scroll. No model/learning/estimate change. Recent: v37.10 service worker / offline cache (Tier 4 #19) (MINOR, client, additive): an offline service worker (`vite-plugin-pwa` / Workbox `generateSW`, `autoUpdate`) precaches the app shell + runtime-caches (stale-while-revalidate) the `sync-learning` GETs and USGS/NWS data, so a returning user can open the app offline with last-known state; `skipWaiting`+`clientsClaim`+`cleanupOutdatedCaches` fully bust the precache per deploy (no stale code). No model/learning/accuracy/estimate change. Recent: v37.9 log validation failures (Tier 4 #18) (MINOR, server-only, additive): hard-flagged validations (excluded from both learning and accuracy) are written to an append-only `validation_failure` observation row via a non-fatal `insertObs`, surfaced by a GET `validation-failures` endpoint. v37.8 admin audit logging (MINOR, additive): the 3 PIN-gated reset actions now append to an `audit_log` observation type via a non-fatal `logAdminAction` helper; a GET `audit-log` endpoint + a "🧾 Recent Admin Actions" list in the Learning tab surface them. v37.7 admin monitoring diagnostics (MINOR, additive display, read-only): a "🔧 System Diagnostics" panel surfaces previously-captured-but-unshown metrics already loaded in `gfLearningData` — throughput, stage error, bin-write health, last-flag recency + reason, EF regression R². v37.6 admin learning-data backup export (MINOR, additive, read-only): a PIN-gated "Download Backup (JSON)" button fetches the live GF learning state + forecast accuracy and downloads it as a timestamped JSON. v37.5 parallelized `loadGFLearningData`'s 5 independent SELECTs via `Promise.all` (MINOR, server-only perf, behavior-neutral; ~100–400ms off cold load). v37.4 render-path event-bus refactor (MINOR, client display/timing; no estimate-output change): replaced the setter-injection lazy-callback scaffolding + manually-scattered re-render triggers with a synchronous pub/sub bus (`src/state/event-bus.js`, producers emit / UI subscribes once in `init.js`) and removed the 4s NWS render gate (the page paints immediately on USGS+EF data; trends/forecast re-render on an `nws:arrived` event when NWS lands). Render functions unchanged; estimate math untouched (parity/characterization green). Recent: v37.3 Phase 2 internal decomposition (extracted `computeGFEstimate()` + server-only `shared/observations.js`); v37.2 fixed cron `/fail`-ping observability; v37.1 retired the legacy System-1 gauge travel-time learning (display-only). Full version history: [CHANGELOG.md](CHANGELOG.md).*

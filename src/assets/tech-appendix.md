# Potomac Pulse — Technical Appendix

**Version:** 36.1 | **Date:** June 2026 | **Full changelog:** [CHANGELOG.md](CHANGELOG.md)

This document provides full methodological transparency for the Potomac Pulse prediction system. It is intended for scientists, hydrologists, and technically curious users who want to understand exactly how the model works.

---

## Executive Summary

Potomac Pulse estimates real-time water conditions at Great Falls on the Potomac River, where no USGS gauge exists. The system uses two complementary methods:

**Nowcast (current conditions):** The primary predictor is Point of Rocks (USGS 01638500), 20 miles upstream, which captures 83.5% of the Little Falls drainage area. Its reading from 19 to 33 hours ago (travel time is flow-dependent, per Searcy 1961 with an empirical 0.80 correction factor) represents the water currently at Great Falls. Four gauged tributaries (Monocacy, Goose Creek, Broad Run, Seneca Creek) add inflows between the two points. The result is blended with an independent stage-discharge estimate from Edwards Ferry, 2 miles above the falls, using a flow-dependent logistic weight (0% at low flows, up to 40% at high flows). A PoR-delta correction adjusts for rising or falling conditions. The estimate is capped at 120% of observed Little Falls discharge. Every two hours, the server validates the prediction against actual Little Falls data and updates learned correction factors across 18 bins (6 flow levels by 3 flow states) using exponential moving averages.

**Forecast (48 hours ahead):** Uses NWS predictions for Little Falls (downstream), shifted earlier in time by the Great Falls to Little Falls travel time (~6 hours at typical flows), with additive bias correction anchored to the current gauge-vs-forecast discrepancy.

**Calibration basis:** 117,704 hourly observations (2011 to 2026), cross-validated with leave-one-year-out folds, cross-language verified (Python and R). Typical nowcast error is approximately 6%, varying by flow regime.

---

## 1. Introduction

Potomac Pulse is a real-time web application that estimates water conditions at Great Falls on the Potomac River, where no USGS gauge exists. It combines data from multiple upstream gauges using an ensemble model, validates predictions against a downstream gauge, and learns correction factors over time.

**Core approach:**
1. Look up what Point of Rocks was reading when today's Great Falls water passed through (~19-33 hours ago)
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
| Edwards Ferry | 01644148 | H only | 11,130 | 96.3% | ~4 hrs | Ensemble blend |
| Monocacy River | 01643000 | Q, H | 817 | 7.1% | ~14 hrs | Tributary addition |
| Goose Creek | 01644000 | Q, H | 332 | 3.0% | ~10 hrs | Tributary addition |
| Broad Run | 01644280 | Q, H | 76 | 0.66% | ~8 hrs | Tributary addition |
| Seneca Creek | 01645000 | Q, H | 101 | 0.87% | ~5 hrs | Tributary addition (enters below GF) |
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
- Seneca Creek: 0.87% (gauged, enters below GF — included in estimate, absorbed by LF validation)
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

### 3.3 Travel Time by Flow Regime

| LF Flow (cfs) | Searcy (1961) | Corrected (×0.80) | PoR → GF (75%) | GF → LF (25%) |
|---------------|---------------|-------------------|----------------|----------------|
| 1,200 | 55 hrs | 44 hrs | ~33 hrs | ~11 hrs |
| 2,000 | 44 hrs | 35 hrs | ~26 hrs | ~9 hrs |
| 5,000 | 32 hrs | 26 hrs | ~19 hrs | ~6.5 hrs |
| 15,000 | 18 hrs | 14 hrs | ~11 hrs | ~3.6 hrs |
| 50,000 | 9 hrs | 7 hrs | ~5.5 hrs | ~1.8 hrs |

The PoR→GF segment accounts for 75% of total travel time (slower pooled sections above the falls), while GF→LF accounts for 25% (faster flow through the gorge).

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

**Problem:** Current flow = 1,200 cfs → travel time ~33h → look up PoR from 33h ago → find 1,900 cfs → but 1,900 cfs travels in ~25h, so that water already passed.

**Solution:** Iterate until convergence (within 1 hour):
1. Start with current flow → calculate travel time
2. Look up historical PoR from that many hours ago
3. Recalculate travel time based on that historical flow
4. Repeat until stable

Typically converges in 2-3 iterations.

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
| R² | 0.94 |
| Median error | 6.3% |
| RMSE | 3,391 cfs |
| Exponent | 2.46 |
| Observations | 5,220 (2011-2026, deduplicated) |

The exponent (2.46) is consistent with typical channel geometry power-law exponents (2.0-3.0) for natural rivers.

**Hourly validation:** Both models were re-estimated on 117,704 hourly observations (2011-2026). Coefficients changed less than 5% and exponents less than 0.05, confirming the daily-calibrated parameters are not materially biased. Autocorrelation inflates precision but does not bias OLS estimates, confirmed by Newey-West HAC standard errors and subsampling at 24h and 168h intervals. See `analysis/refit_powerlaw_hourly.py/.R`, audit: `analysis/powerlaw_refit_audit.md`.

### 4.4 Cold-Water Model

Analysis of 3,354 observations (2021-2026) with concurrent water temperature data revealed temperature-dependent coefficients. Cold water has higher density and viscosity, altering the stage-discharge relationship.

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

This ensemble reduces variance by combining a spatially distant but data-rich gauge (PoR, 20 mi) with a nearby but data-limited gauge (EF, 2 mi).

### 5.4 Flow-Dependent Weighting (Logistic Ramp)

A **7-approach model comparison** on 117,704 hourly observations (2011-2026) with Leave-One-Year-Out cross-validation (14 folds) identified a smooth logistic ramp as optimal. The EF gauge is accurate (USGS-verified), but its **predictive value** depends on flow regime — the logistic function captures this relationship continuously:

```
ef_weight = W_MAX / (1 + exp(-K × (ln(flow) - ln(MIDPOINT))))
         = 0.40  / (1 + exp(-5.0 × (ln(flow) - ln(10000))))
```

| Flow Level | EF Weight | PoR Weight |
|------------|:---------:|:----------:|
| 1,000 cfs | ~0.0% | ~100% |
| 3,000 cfs | 1.8% | 98.2% |
| 5,000 cfs | 3.5% | 96.5% |
| 10,000 cfs | 20.0% | 80.0% |
| 20,000 cfs | 36.5% | 63.5% |
| 50,000 cfs | 39.8% | 60.2% |

At low flows, EF weight is near zero (avoiding the negative-skill regime where local channel effects dominate). At high flows, it asymptotes at 40%. The logistic ramp achieved an out-of-sample RMSE of 1,907 cfs, a 4.6% improvement over the best alternative (flat 35% step function). Cross-language verified: blind Python and R subagents agree on the winner (RMSE within 7 cfs). See `analysis/horserace_v2_python.py`, `analysis/horserace_v2_R.R`, audit: `analysis/horserace_v2_audit.md`.

### 5.5 PoR-Delta Staleness Correction

When the river is rising or falling, the time-shifted PoR reading (19-26h old) comes from a different flow regime and systematically misestimates current GF conditions. The PoR-delta correction scales the time-shifted estimate by the proportion of change observed at Point of Rocks since that reading:

```
IF |PoR_change%| > 5%:
    ratio = PoR_now / PoR_then
    decay = min(0.50, sqrt(staleness / travel_time))
    corrected = estimate × (1 + (ratio - 1) × decay)
```

The **decay factor** accounts for wave travel: if the time-shifted reading is 16h old and PoR→GF travel is 19h, the change at PoR has only partially reached GF. The sqrt ramp gives ~50% correction at 25% elapsed. The 0.50 cap prevents overcorrection on rises — cross-verified on 42,837 hourly pairs.

**Backtest results** (5,220 days, 2011-2026): PoR-delta correction reduced Rising RMSE by 17.8% (6,117→5,027 cfs) and Overall RMSE by 25.6% (3,981→2,963 cfs) with near-zero rising bias (+87 cfs vs baseline -2,286 cfs). See `analysis/backtest_approaches.py`.

### 5.6 Soft LF Ceiling

The GF estimate is capped at **120% of LF actual discharge**. On rising rivers, GF legitimately exceeds LF (the flood wave arrives at Great Falls before Little Falls), but the PoR-delta correction combined with EF blending can overshoot by 200% or more. The 120% ceiling limits extreme overshoots while preserving the legitimate rising signal. A 110% ceiling was tested but created a -476 cfs systematic under-prediction bias during rising events; 120% achieves near-zero rising bias (-29 cfs). A tool used to assess rising river conditions must not systematically under-predict. Cross-verified on 42,837 hourly pairs in Python and R. See `analysis/backtest_comprehensive.py`.

### 5.7 EF Discrepancy Check

When EF estimate differs from PoR estimate by more than 50%, the system skips ensemble blending and uses PoR-only. This guards against ice-affected EF readings, backwater conditions, or gauge malfunctions that would corrupt the ensemble.

### 5.8 Hysteresis Correction

At the same stage, a rising river carries more flow than a falling river (Fread 1973, Henderson 1966). The system learns adaptive multipliers:

- Starting values: **+8% rising, -8% falling** (literature-informed)
- Updated via EMA (α = 0.2) from validation errors
- Separate multipliers for rising, falling, and steady conditions
- Clamped to ±20% range (0.8 to 1.2)
- Stored in browser localStorage, persists across sessions

### 5.9 Confidence Indicator

Reflects **data quality**, not prediction accuracy:

| Level | Conditions |
|-------|------------|
| HIGH | Tributary data available AND time-shifted PoR history AND EF trend agrees |
| MEDIUM | Missing time-shifted data OR EF trend disagrees |
| LOW | Missing tributary data OR no PoR trend data |

Downgrades: EF trend conflict, insufficient history for time-shifting, tributary gauges offline.

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
2. When water arrives at LF, calculate what GF actually was
3. Compute error: (predicted - actual) / actual
4. Update correction factor using EMA (§6.4)

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

Flow state is determined from observed PoR rate (**6-hour lookback** on stored PoR history). On cold start (fewer than 4 PoR readings), falls back to NWS forecast direction. The 6-hour window matches the median PoR→GF travel time and is wide enough to capture the Potomac's slow recession dynamics (median |Δcfs|/2h is only ~1% at baseflow; over 6 hours the same recession registers above the 2% threshold).

Separate corrections per flow state account for momentum effects (rising water moves faster) and hysteresis (falling water drains slower).

### 6.7 Background Scheduler

A serverless function executes every 2 hours:
1. Fetch USGS data for all gauges
2. Store PoR history to cloud database (48-hour window)
3. Validate pending predictions against actual LF readings
4. Update correction bins with new error data
5. Clean up stale predictions (>48 hours → expired)
6. Make new prediction and store for future validation

The model improves continuously, even when no browsers are open.

### 6.8 Health Monitoring

- **Consecutive runs:** Streak of successful 2-hour executions
- **Missed runs:** Count of skipped cycles (gap > 3 hours)
- **Stale cleanup:** Predictions >48 hours marked expired, not validated
- **Admin reset:** Clears flow-bin corrections while preserving health statistics

### 6.9 Historical Accuracy Tracking

```
Accuracy = 100% - mean_absolute_error_%
```

Color coding: green ≥95% (excellent), yellow 90-95% (good), red <90% (needs refinement).

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
- Validation is recorded (for analysis) but skips learning AND accuracy
- Record is marked "hard_flagged" — the LF reading itself is corrupted

**Soft flag (score ≥ 2, no hard flag):**
- INCLUDED in learning and accuracy — the model is probably wrong, not the data
- EMA contribution clamped at ±2σ from bin mean (prevents single large-error obs from spiking correction)
- Running sums (count, sumError, sumErrorSq) use raw values; only EMA uses clamped value
- Record is marked "soft_flagged"

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
LF reports:  1,120 cfs @ 2.60 ft stage
Expected:    ~2,000 cfs (from stage rating curve)
→ hardScore: 2 (stage-discharge 79%) + 2 (low flow @ high stage) = 4
→ HARD FLAGGED: Skip learning + accuracy

Example 2 — SOFT flag (model error):
LF reports:  8,500 cfs @ 3.10 ft stage
EF estimate: 11,200 cfs (from 3.50 ft stage)
→ softScore: 2 (EF 32% discrepancy)
→ SOFT FLAGGED: Included in learning (EMA clamped) + accuracy
```

---

## 8. 48-Hour Forecast

### 8.1 Why a Different Method is Needed

The nowcast estimate looks backward: "What PoR reading from ~19-33 hours ago has arrived at GF now?" For forecasting, at low flow (~1,000 cfs, travel time ~40h):
- +6h forecast needs PoR from 34 hours *ago* (historical, not forecast)
- +48h forecast needs PoR from 8 hours *ago* (still historical)

The forecast would show flat conditions even when a rise is imminent.

### 8.2 LF-Constrained Approach

Great Falls is between Point of Rocks and Little Falls. If NWS predicts LF will rise, GF must rise first. We exploit this constraint:

1. Get NWS Little Falls forecast (BRKM2)
2. Shift backward by GF→LF travel time (~6-12h depending on flow)

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

The system scores its forecast against two NWS baselines (raw and bias-corrected) at each horizon (6, 12, 24, and 48 hours). Forecast predictions are stored as pending and validated when water arrives at Little Falls.

### 8.7 Fallback Behavior

When NWS forecast is unavailable, the system uses linear extrapolation from recent trends.

---

## 9. Limitations & Uncertainties

### 9.1 Model Limitations

| Factor | Impact | Notes |
|--------|--------|-------|
| Steady-state assumption | High during floods | Rapid flood waves travel faster than predicted (mitigated by wave celerity adjustment, §3.6) |
| Single flow multiplier | ±10-20% for upstream | Same scaling applied to all reaches, though channel characteristics vary |
| Ungauged tributaries | ~5.5% unmonitored | Local storms in ungauged areas can cause unexpected rises |
| 0.80 travel time correction | Needs validation | Empirical correction based on limited modern data |

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

**Current version:** v36.1 | **Last calibration:** v30.0 (Feb 2026) | **Last structural change:** v36.0 (Jun 2026 — closed the learning loop: server end-applies the EMA correction; displayed model == validated model)

For the complete version history (v16 through v36.1), see [CHANGELOG.md](CHANGELOG.md).

---

*Generated by Potomac Pulse v36.1 — Corrected-residual confidence band (C2): the 90% CI is now applied sign-aware and asymmetric as `[estimate − q95, estimate − q05]` (replacing the v36.0 symmetric ±halfWidth), and `EMPIRICAL_CI_90` was re-derived on the corrected residual the user sees by replaying the real model over 126,916 hourly obs (incl. tributaries + LF stage) in a prequential EMA backtest, binned by the model's own flow bin/state, with high-flow bins widened to the multi/single-pending union. EMA bin-update extracted to a shared `updateCorrectionBin`. MINOR — point estimate unchanged. Blind Python+R (<1e-9) + auditor + live-USGS verified; deployed-proxy coverage 89.1%.*

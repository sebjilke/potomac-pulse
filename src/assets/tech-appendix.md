# Potomac Pulse — Technical Appendix


**Version:** 34.7 | **Date:** March 2026

This document provides full methodological transparency for the Potomac Pulse prediction system. It is intended for scientists, hydrologists, and technically curious users who want to understand exactly how the model works.

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
| Edwards Ferry | 01644148 | H only | 11,130 | 96.3% | ~4 hrs | Ensemble cross-check |
| Monocacy River | 01643000 | Q, H | 817 | 7.1% | ~14 hrs | Tributary addition |
| Goose Creek | 01644000 | Q, H | 332 | 3.0% | ~10 hrs | Tributary addition |
| Broad Run | 01644280 | Q, H | 76 | 0.66% | ~8 hrs | Tributary addition |
| Seneca Creek | 01645000 | Q, H | 101 | 0.87% | ~5 hrs | Tributary addition (enters below GF) |
| Hancock | 01613000 | Q, H | 4,073 | 35.2% | ~120 hrs | Upstream early warning |
| Cumberland | 01603000 | Q, H | 877 | 7.6% | ~180 hrs | Upstream early warning |

*Q = discharge (param 00060), H = gage height (param 00065), T = water temperature (param 00010). Travel times at median flow (~5,000 cfs) with ×0.80 empirical correction.*

### 2.3 Data Availability & Missing Data Handling

When a gauge returns invalid data (USGS sentinel value -999999), discharge is estimated using drainage area ratio:

\`\`\`
Estimated_CFS = LF_CFS × (gauge_drainage_area / 11,560)
\`\`\`

Estimated values are displayed in italics with a yellow asterisk. Common causes: ice at measurement site, gauge malfunction, communication outage.

### 2.4 Below Point of Rocks

16.5% of Little Falls' drainage enters below Point of Rocks:
- Monocacy: 7.1% (gauged)
- Goose Creek: 3.0% (gauged)
- Broad Run: 0.66% (gauged, v31.0)
- Seneca Creek: 0.87% (gauged, enters below GF — included in estimate, absorbed by LF validation per v34.0)
- Ungauged streams: ~4.9% (~570 mi²)

Local storms in ungauged areas can raise Little Falls independently of Point of Rocks.

---

## 3. Travel Time Model

### 3.1 Theoretical Basis

The travel time model derives from USGS Circular 438 (Searcy & Davis, 1961), which measured mean water velocity vs. discharge at Point of Rocks and Little Falls using dye-tracer studies:

\`\`\`
V_avg = 0.0116 × Q^0.5963   (R² = 0.99)
\`\`\`

Converting velocity to travel time over the 41-mile PoR→LF reach:

\`\`\`
T_original = 5174 × Q^(-0.5963)
\`\`\`

### 3.2 Empirical Correction (×0.80)

Cross-correlation analysis of modern USGS instantaneous data (6 months of 15-minute readings plus 2 years of daily data, January 2026) showed observed travel times are approximately 20% faster than Searcy's 1961 measurements. We apply a conservative 0.80 multiplier:

\`\`\`
T = 4139 × Q^(-0.5963)
\`\`\`

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

### 3.7 Planned Validation

Cross-correlation analysis for upstream segment travel times is planned:
- Cumberland → Hancock (North Branch)
- Hancock → Point of Rocks (Mainstem)

Preliminary observation (Jan 12-15, 2026): Hancock peaked at 2,300 cfs on Jan 13 13:00; PoR peaked at 3,520 cfs on Jan 14 22:45 — approximately 34 hours lag.

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
5. Fit power-law: \`LF_cfs = a × EF_stage^b\` (physically appropriate for open-channel hydraulics)

**Important distinction: gauge accuracy vs. predictive accuracy.** All EF stage readings have been verified against the USGS API (7/7 spot-checks exact match). The gauge is accurate. However, a single stage reading at one location is a limited *predictor* of discharge at a downstream point — especially at low flows, where local channel geometry, vegetation, and dam operations dominate the stage-discharge relationship. This is why the ensemble weight is flow-dependent (§5.4).

### 4.3 Default Model

\`\`\`
LF_cfs = 126 × EF_stage^2.46
\`\`\`

| Metric | Value |
|--------|-------|
| R² | 0.94 |
| Median error | 6.3% |
| RMSE | 3,391 cfs |
| Exponent | 2.46 |
| Observations | 5,220 (2011-2026, deduplicated) |

The exponent (2.46) is consistent with typical channel geometry power-law exponents (2.0-3.0) for natural rivers.

### 4.4 Cold-Water Model

Analysis of 3,354 observations (2021-2026) with concurrent water temperature data revealed temperature-dependent coefficients. Cold water has higher density and viscosity, altering the stage-discharge relationship.

| Condition | Formula | When Applied |
|-----------|---------|--------------|
| **Cold** | \`LF_cfs = 160 × EF_stage^2.36\` | Water temp ≤ 10°C (50°F) |
| **Default** | \`LF_cfs = 126 × EF_stage^2.46\` | Water temp > 10°C or unavailable |

The cold-water model improves winter RMSE by **10.9%**. A full three-regime model (cold/moderate/warm) was tested but degraded warm-season accuracy by 18.1%. The cold-only approach captures the largest improvement without negative side effects.

### 4.6a 117k Hourly Validation (2026-02-19)

Both models were re-estimated on **117,704 hourly observations** (2011–2026) with autocorrelation diagnostics. As expected for hourly data, residuals show extreme autocorrelation (Durbin-Watson = 0.007 for default, 0.065 for cold; ACF lag-1 = 0.997 and 0.968 respectively). All Ljung-Box tests reject at p ≈ 0. However, autocorrelation inflates precision but does **not** bias OLS estimates — confirmed by:

1. **Newey-West HAC**: v29.0 values fall within corrected confidence intervals
2. **Subsampling (every 24h)**: n=4,905 → coef=128.0, exp=2.453 (virtually identical)
3. **Subsampling (every 168h)**: n=701 → coef=132.1, exp=2.432 (within normal sampling variation)

| Source | Default coef | Default exp | Cold coef | Cold exp |
|--------|:---:|:---:|:---:|:---:|
| v29.0 (5,220 daily) | 126 | 2.46 | 160 | 2.36 |
| 117k hourly OLS | 127.8 | 2.454 | 166.4 | 2.341 |
| 117k 24h subsample | 128.0 | 2.453 | 167.0 | 2.342 |

Changes are <5% coef and <0.05 exponent → **not material**. v29.0 parameters validated. GLS Cochrane-Orcutt was attempted but fails due to near-unit-root process (rho ≈ 0.997). Cross-language verified: Python and R exact match on all estimates.

See \`analysis/refit_powerlaw_hourly.py/.R\`, audit: \`analysis/powerlaw_refit_audit.md\`.

### 4.5 Temperature Data Source

Water temperature is fetched from Point of Rocks (USGS 01638500, parameter 00010). When temperature data is unavailable, the system falls back to the default model.

### 4.6 Updating the Model

To regenerate with more data:
\`\`\`
GET /.netlify/functions/build-ef-correlation-advanced?months=12
\`\`\`
Update the \`EF_MODEL\` constants in index.html and scheduled-update.js with the recommended values.

---

## 5. Great Falls Estimation

### 5.1 Problem Statement

No USGS gauge exists at Great Falls. The estimation combines upstream gauge readings with the Edwards Ferry stage-discharge model.

### 5.2 Estimation Formula

\`\`\`
GF_estimated = PoR(t - T_converged) + Monocacy + Goose Creek + Broad Run + Seneca Creek - Correction
\`\`\`

Where:
- PoR(t - T_converged) = Point of Rocks reading from T hours ago (T = converged travel time, §3.5)
- Monocacy = current Monocacy discharge (joins 6 mi below PoR)
- Goose Creek = current Goose Creek discharge (joins 12 mi below PoR)
- Broad Run = current Broad Run discharge (0.66% of LF, joins between Goose Creek and EF)
- Seneca Creek = current Seneca Creek discharge (0.87% of LF, joins below EF, above GF)
- Correction = learned correction factor for current flow bin and flow state (§6)

### 5.3 Ensemble Blending

The final estimate blends two independent models:

\`\`\`
GF_final = (1 - w) × GF_PoR_model + w × GF_EF_model
\`\`\`

Where w = EF weight (flow-dependent, see §5.4), GF_PoR_model = time-shifted PoR + tributaries, GF_EF_model = Edwards Ferry power-law estimate.

This ensemble reduces variance by combining a spatially distant but data-rich gauge (PoR, 20 mi) with a nearby but data-limited gauge (EF, 2 mi).

### 5.4 Flow-Dependent Weighting (Logistic Ramp, v30.0)

A **7-approach horse race** on 117,704 hourly observations (2011–2026) with Leave-One-Year-Out cross-validation (14 folds) identified a smooth logistic ramp as optimal. The EF gauge is accurate (USGS-verified), but its **predictive value** depends on flow regime — the logistic function captures this relationship continuously:

\`\`\`
ef_weight = W_MAX / (1 + exp(-K × (ln(flow) - ln(MIDPOINT))))
         = 0.40  / (1 + exp(-5.0 × (ln(flow) - ln(10000))))
\`\`\`

| Flow Level | EF Weight | PoR Weight |
|------------|:---------:|:----------:|
| 1,000 cfs | ~0.0% | ~100% |
| 3,000 cfs | 1.8% | 98.2% |
| 5,000 cfs | 3.5% | 96.5% |
| 10,000 cfs | 20.0% | 80.0% |
| 20,000 cfs | 36.5% | 63.5% |
| 50,000 cfs | 39.8% | 60.2% |

**Horse race results** (OOS RMSE on 115,213 observations across 14 CV folds):

| Approach | OOS RMSE | Skill Score | vs Baseline |
|----------|:--------:|:-----------:|:-----------:|
| EF-Dominant (logistic) — **winner** | **1,907** | **+0.090** | **−4.6%** |
| PoR Ratio Scaler | 1,950 | +0.048 | −2.4% |
| Tributary Addback | 1,975 | +0.025 | −1.2% |
| Combined Ratio+Tribs | 1,987 | +0.012 | −0.6% |
| Baseline (flat 35% step) | 1,999 | (ref) | — |
| EF Power-Law Refit | 2,003 | −0.004 | +0.2% |
| Log-Linear Regression | 2,006 | −0.007 | +0.3% |

The logistic ramp improves on the v29.0 flat 35% step by eliminating the hard 3k cfs cutoff and allowing EF influence to increase gradually with flow. At low flows, EF weight is near zero (avoiding the negative-skill regime). At high flows, it asymptotes at 40% — matching the previous optimal ceiling. The smooth sigmoid requires no arbitrary bin boundaries.

**Cross-language verified**: Blind Python + R subagents agree on winner (RMSE within 7 cfs). Independent auditor confirmed methodology is sound. See \`analysis/horserace_v2_python.py\`, \`analysis/horserace_v2_R.R\`, audit: \`analysis/horserace_v2_audit.md\`.

### 5.4.1 PoR-Delta Staleness Correction (v25.0)

When the river is rising or falling, the time-shifted PoR reading (19-26h old) comes from a different flow regime and systematically misestimates current GF conditions. The PoR-delta correction scales the time-shifted estimate by the proportion of change observed at Point of Rocks since that reading:

\`\`\`
IF |PoR_change%| > 5%:
    ratio = PoR_now / PoR_then
    decay = min(0.50, sqrt(staleness / travel_time))
    corrected = estimate × (1 + (ratio - 1) × decay)
\`\`\`

The **decay factor** accounts for wave travel: if the time-shifted reading is 16h old and PoR→GF travel is 19h, the change at PoR has only partially reached GF. The sqrt ramp gives ~50% correction at 25% elapsed. The 0.50 cap (v28.0, lowered from 0.75) prevents overcorrection on rises — cross-verified on 42,837 hourly pairs.

**Backtest results** (5,220 days, 2011-2026): PoR-delta correction reduced Rising RMSE by 17.8% (6,117→5,027 cfs) and Overall RMSE by 25.6% (3,981→2,963 cfs) with near-zero rising bias (+87 cfs vs baseline -2,286 cfs). It outperformed both EF weight boosting and the combined approach. See \`analysis/backtest_approaches.py\`.

### 5.4.2 Gradient Weight Optimization (v27.0)

The v26.0 step function (10%/10%/20%/70% at hard cutoffs) was replaced with a smooth piecewise-linear gradient, optimized via **coordinate descent** on 5,208 consecutive-day pairs (2011-2026). The optimization used lag-1 actual discharge as a PoR proxy and minimized RMSE of the blended ensemble: \`GF = (1-w) × yesterday + w × (126 × EF^2.46)\`.

**Methodology**:
1. Seven anchor points at [0, 3k, 6k, 10k, 15k, 25k, 50k] cfs
2. Coarse pass: sweep w = 0.00–0.80 in 0.05 steps at each anchor (5 passes)
3. Fine pass: refine ±0.05 in 0.01 steps at each anchor (3 passes)
4. Monotonicity enforced: weights must be non-decreasing with flow
5. Rounded to 1 decimal place

**Results**:
- Overall RMSE: **3,858 cfs** (gradient) vs **5,203 cfs** (step) = **-25.8% improvement**
- The gradient's smooth ramp through mid-flows (3-10k cfs) captures signal the step function missed
- Maximum EF weight settled at 40% (not 70%) — the gradient eliminates the need for aggressive high-flow weighting by properly weighting the transition zone
- Cross-language verified: Python and R independently produce identical optimal weights at all 7 anchors

**RMSE by flow regime**:

| Regime | N pairs | Step RMSE | Gradient RMSE | Change |
|--------|--------:|----------:|--------------:|-------:|
| < 3k | 3,407 | 155 | 155 | 0 |
| 3-6k | 901 | 710 | 584 | -126 |
| 6-10k | 355 | 1,357 | 1,101 | -256 |
| 10-15k | 206 | 2,157 | 1,901 | -256 |
| 15-25k | 179 | 5,597 | 5,433 | -164 |
| 25-50k | 120 | 15,722 | 15,722 | 0 |
| > 50k | 40 | 37,839 | 37,839 | 0 |

See \`analysis/optimize_gradient_weights.py\` (Python) and \`analysis/optimize_gradient_weights.R\` (R).

### 5.4.3 Soft LF Ceiling + Decay Cap Optimization (v28.0)

The GF estimate is capped at **120% of LF actual discharge**, and the PoR-delta decay cap is set to **0.50**. On rising rivers, GF legitimately exceeds LF (the flood wave arrives at Great Falls before Little Falls), but the PoR-delta correction + EF blend can overshoot by 200%+. The 120% ceiling limits extreme overshoots while preserving the legitimate rising signal.

**Why 120% instead of 110%?** Historical analysis of 42,837 hourly pairs shows the 110% ceiling triggered 5,780 times and created a -476 cfs systematic under-prediction bias during rising events. The 120% ceiling triggers ~2,777 times and achieves near-zero rising bias (-29 cfs), allowing real rising dynamics to pass through while still catching model overshoots.

**Grid search**: 25 configurations (5 decay caps × 5 ceiling ratios) tested on two independent datasets:

| Dataset | N pairs | Period | PoR method |
|---------|--------:|--------|------------|
| Daily | 5,208 | 2011-2026 | Lag-1 proxy (yesterday's LF) |
| Hourly | 42,837 | 2021-2026 | Travel-time-shifted (Searcy power law) |

**Selected config** (decay=0.50, ceil=120%): chosen for near-zero rising bias, prioritizing accuracy during rising events.

| Config | Hourly Rising RMSE | Hourly Rising Bias | Ceiling Triggers |
|--------|----------:|:----------:|:----------:|
| decay=0.50, ceil=120% (selected) | 3,387 | **-29** | ~2,777 |
| decay=0.50, ceil=110% | 2,542 | -476 | 5,780 |
| decay=0.50, no ceiling (baseline) | 6,294 | +887 | 0 |

The selected config prioritizes unbiased rising estimates (bias ≈ zero) over minimum RMSE. A tool used to assess rising river conditions must not systematically under-predict. Cross-language verified in Python and R (all 50 metrics match within 0.5 cfs).

See \`analysis/backtest_comprehensive.py\` (Python) and \`analysis/backtest_comprehensive_R.R\` (R).

**117k Hourly Validation (2026-02-19):** Re-tested on 117,704 hourly observations (2011–2026). With hourly staleness ≈ 1hr/20hr = 0.05, the decay factor is ≈ 0.22 regardless of cap — the decay cap is essentially irrelevant for hourly data. Current config validated. See \`analysis/backtest_117k.py/.R\`, audit: \`analysis/backtest_117k_audit.md\`.

### 5.4.4 Hourly Gradient Weight Re-Optimization (v29.0, superseded by v30.0)

*Historical context: The v29.0 flat 35% step function served as the baseline for the v30.0 horse race. The logistic ramp (§5.4) now replaces this.*

The v27.0 graduated ramp (0%→10%→40%) was optimized on daily data using lag-1 actual discharge as a PoR proxy. Re-optimization on **42,838 hourly observations** (2021-2026) with **actual travel-time-shifted PoR** (Searcy power law) found that a simple flat 35% weight above 3k cfs is optimal.

**Why hourly data produced different results:**
1. **8× more observations** (42,838 vs 5,208) reduces overfitting risk
2. **Real PoR proxy**: Travel-time-shifted PoR readings (not lag-1 daily) match the production model
3. **Intra-day dynamics**: Captures rapid event transitions that daily averages smooth over

**Optimization methodology:**
1. Seven anchor points at [0, 3k, 6k, 10k, 15k, 25k, 50k] cfs
2. Zero initialization (avoids warm-start bias — audit of v1 found binding constraints when initialized from current weights)
3. W_MAX = 0.80, forward-only monotonicity
4. Coarse pass: 0.00–0.80 in 0.05 steps (5 sweeps), fine pass: ±0.05 in 0.01 steps (3 sweeps)
5. Two-decimal precision

**Results (simultaneous blind Python + R subagents):**

| Config | Overall RMSE | vs Daily-Optimized |
|--------|:----------:|:----------:|
| Flat 35% (v29.0) | **1,676** | **-4.6%** |
| Flat 40% (v1 hourly) | 1,702 | -3.1% |
| Graduated 0→10→40% (v27.0 daily) | 1,757 | baseline |

**Cross-validation** (leave-one-year-out, 2021-2025): 4/6 years improve, 2 neutral. Average improvement: -36.4 cfs RMSE. No year shows significant degradation, confirming the result generalizes.

**Cross-language verification**: Python and R exact match (0.0000 weight difference, 0.0 cfs RMSE difference).

See \`analysis/optimize_gradient_weights_hourly_v2.py\` (Python) and \`analysis/optimize_gradient_weights_hourly_v2_verify.R\` (R).

**117k Hourly Validation (2026-02-19):** Re-optimized on 117,704 hourly observations (2011–2026). The graduated ramp [0.04, 0.15, 0.35×5] is 0.70 cfs WORSE overall than flat 35%. Cross-validation (leave-one-year-out, 2012–2025): only 2/14 years improve, mean 1.8% worse out-of-sample. Flat 35% confirmed optimal. See \`analysis/optimize_gradient_weights_117k.py/.R\`, audit: \`analysis/gradient_weights_117k_audit.md\`.

### 5.5 EF Discrepancy Check

When EF estimate differs from PoR estimate by more than 50%, the system skips ensemble blending and uses PoR-only. This guards against ice-affected EF readings, backwater conditions, or gauge malfunctions that would corrupt the ensemble.

### 5.6 Hysteresis Correction

At the same stage, a rising river carries more flow than a falling river (Fread 1973, Henderson 1966). The system learns adaptive multipliers:

- Starting values: **+8% rising, -8% falling** (literature-informed)
- Updated via EMA (α = 0.2) from validation errors
- Separate multipliers for rising, falling, and steady conditions
- Clamped to ±20% range (0.8 to 1.2)
- Stored in browser localStorage, persists across sessions

### 5.7 Confidence Indicator

Reflects **data quality**, not prediction accuracy:

| Level | Conditions |
|-------|------------|
| HIGH | Tributary data available AND time-shifted PoR history AND EF trend agrees |
| MEDIUM | Missing time-shifted data OR EF trend disagrees |
| LOW | Missing tributary data OR no PoR trend data |

Downgrades: EF trend conflict, insufficient history for time-shifting, tributary gauges offline.

### 5.8 Uncertainty Display (v29.1: Empirical 90% CI)

The app displays a calibrated 90% confidence interval based on empirical error quantiles:

\`\`\`
90% CI: 2,900 – 3,500 cfs
\`\`\`

**Methodology:** Prediction errors (blended estimate − actual LF discharge) were analyzed across 117,704 hourly observations (2011–2026) in 18 bins (6 flow levels × 3 flow states). Errors are non-normal in all bins (Shapiro-Wilk p &lt; 0.01, kurtosis up to 18.3, asymmetry ratios up to 42:1). Gaussian ±1.645σ would mis-specify uncertainty by up to 745%.

**CI formula:** \`[estimate + q05(bin), estimate + q95(bin)]\` where q05/q95 are the 5th/95th percentiles of the error distribution for the relevant flow bin and flow state.

**Verification:** 3-layer protocol — simultaneous blind Python + R subagents + independent auditor. See \`analysis/error_distribution_audit.md\`.

---

## 6. Learning & Validation System

### 6.1 Prediction-Validation Cycle

Each Great Falls estimate is validated ~6-7 hours later when water reaches Little Falls:

1. Store prediction with timestamp, flow bin, and flow state
2. When water arrives at LF, calculate what GF actually was
3. Compute error: (predicted - actual) / actual
4. Update correction factor using EMA (§6.3)

### 6.2 Correction Bins

Corrections are learned separately for 18 bins (6 flow levels × 3 flow states):
- **Flow bins:** <3k, 3-6k, 6-12k, 12-25k, 25-50k, >50k cfs
- **Flow states:** rising, falling, steady

### 6.3 EMA Smoothing

Correction factors update via exponential moving average:
\`\`\`
new_correction = α × latest_error + (1 - α) × old_correction
\`\`\`
With α = 0.3, weighting recent observations more heavily while maintaining stability.

### 6.4 Outlier Filtering

Errors >3 standard deviations from the bin mean are discarded. This prevents bad data (gauge malfunction, ice) from corrupting learned corrections.

### 6.5 Flow State Classification

The threshold scales with flow magnitude:
\`\`\`
threshold = max(100 cfs, 0.02 × current_flow)
\`\`\`

| Flow Level | Threshold | Effective % |
|------------|-----------|-------------|
| 2,000 cfs | 100 cfs | 5.0% |
| 5,000 cfs | 100 cfs | 2.0% |
| 10,000 cfs | 200 cfs | 2.0% |
| 50,000 cfs | 1,000 cfs | 2.0% |

Flow state is determined from observed PoR rate (**6-hour lookback** on stored PoR history, widened from 2 hours in v35.0). On cold start (fewer than 4 PoR readings), falls back to NWS forecast direction. The 6-hour window matches the median PoR→GF travel time and is wide enough to capture the Potomac's slow recession dynamics (median |Δcfs|/2h is only ~1% at baseflow; over 6 hours the same recession registers above the 2% threshold).

Separate corrections per flow state account for momentum effects (rising water moves faster) and hysteresis (falling water drains slower).

### 6.6 Background Scheduler

A serverless function executes every 2 hours:
1. Fetch USGS data for all gauges
2. Store PoR history to cloud database (48-hour window)
3. Validate pending predictions against actual LF readings
4. Update correction bins with new error data
5. Clean up stale predictions (>48 hours → expired)
6. Make new prediction and store for future validation

The model improves continuously, even when no browsers are open.

### 6.7 Health Monitoring

- **Consecutive runs:** Streak of successful 2-hour executions
- **Missed runs:** Count of skipped cycles (gap > 3 hours)
- **Stale cleanup:** Predictions >48 hours marked expired, not validated
- **Admin reset:** Clears flow-bin corrections while preserving health statistics

### 6.8 Historical Accuracy Tracking

\`\`\`
Accuracy = 100% - mean_absolute_error_%
\`\`\`

Color coding: 🟢 ≥95% (excellent), 🟡 90-95% (good), 🔴 <90% (needs refinement).

---

## 7. Ice & Anomaly Detection

### 7.1 ADVM Physics

USGS Little Falls uses an Acoustic Doppler Velocity Meter (ADVM). Frazil ice — small crystals suspended in supercooled water — scatters and absorbs the acoustic signal, causing artificially low velocity readings even when stage (pressure transducer) remains accurate. This produces CFS readings far below actual discharge.

### 7.2 Two-Tier Scoring System (v33.0)

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

**Flag determination:** \`isHardFlagged = hardScore ≥ 2\`, \`isSoftFlagged = !isHardFlagged && softScore ≥ 2\`.

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

\`\`\`
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
\`\`\`

---

## 8. 48-Hour Forecast

### 8.1 Why a Different Method is Needed

The current GF estimate looks backward: "What PoR reading from ~20-40 hours ago has arrived at GF now?" For forecasting, at low flow (~1,000 cfs, travel time ~40h):
- +6h forecast needs PoR from 34 hours *ago* (historical, not forecast)
- +48h forecast needs PoR from 8 hours *ago* (still historical)

The forecast would show flat conditions even when a rise is imminent.

### 8.2 LF-Constrained Approach

Great Falls is between Point of Rocks and Little Falls. If NWS predicts LF will rise, GF must rise first. We exploit this constraint:

1. Get NWS Little Falls forecast (BRKM2)
2. Shift backward by GF→LF travel time (~6-12h depending on flow)

\`\`\`
GF_forecast(t) ≈ LF_forecast(t + T_GF_LF)
\`\`\`

### 8.3 Additive Bias Correction

NWS forecasts exhibit systematic bias. We apply an additive correction:

\`\`\`
offset = observed_LF_now - forecast_LF_at_now
corrected_forecast = raw_forecast + offset
\`\`\`

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

### 8.6 Fallback Behavior

When NWS forecast is unavailable, the system uses linear extrapolation from recent trends.

---

## 9. Limitations & Uncertainties

### 9.1 Model Limitations

| Factor | Impact | Notes |
|--------|--------|-------|
| Steady-state assumption | High during floods | Rapid flood waves travel faster than predicted (mitigated by wave celerity adjustment, §3.6) |
| Single flow multiplier | ±10-20% for upstream | Same scaling applied to all reaches, though channel characteristics vary |
| Ungauged tributaries | ~5.5% unmonitored | Local storms in ungauged areas can cause unexpected rises |
| 0.80 travel time correction | Needs validation | Empirical correction based on limited modern data; spring validation planned |

### 9.2 Great Falls Estimation Uncertainties

| Factor | Impact |
|--------|--------|
| Tributary timing | Monocacy/Goose/Broad Run/Seneca readings are current, not time-shifted to confluence arrival |
| Water withdrawals | Washington Aqueduct (at GF), WSSC (Swain's Lock), and Fairfax Water (Seneca) divert ~400–700 cfs above the falls. Already absorbed by LF-calibrated model; no correction needed. |
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

## Versioning Scheme

Starting with v25.0, Potomac Pulse uses **MAJOR.MINOR** versioning:

- **MAJOR** (v25 → v26): Changes to the core GF estimation logic — model recalibration, new estimation approach, architectural changes that alter outputs for the same inputs.
- **MINOR** (.0 → .1): Bug fixes, UI changes, new features/tabs, documentation updates, display changes — anything that does not alter the core estimation output.

Earlier versions (v16–v24.x) used an ad-hoc scheme where major integers marked large features and dot releases marked incremental changes within a development sprint.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v35.0 | 2026-05-06 | Flow-state classification widened from a 2-hour to a 6-hour PoR lookback. Diagnostic on 117,704 hourly obs (2011–2026) showed the previous 2-hour window classified ~99% of baseflow as `steady` (production state at the time of the change: 3 rising / 87 steady / 3 falling), because the Potomac's slow recession dynamics rarely move ≥100 cfs or ≥2% in a 2-hour window at typical baseflow. The 6-hour window matches the median PoR→GF travel time and produces a non-degenerate distribution at all flow regimes (full-dataset 19/45/36 rising/steady/falling; storm months 25–55% non-steady; drought months ~80% steady; per-flow-bin spread 14–43% rising and 17–56% falling). Threshold formula (`max(100 cfs, q × 2%)`) and per-bin EMA logic unchanged. Because the prior bins were filled under the broken rule and no per-observation raw records were retained, all `gf_correction_bin` rows were wiped along with `gf_prediction:pending`, the shadow leaderboard, and the contaminated learning fields in `gf_metadata` (health stats preserved). Bins refill from new validations under the corrected classifier; full repopulation is expected over 1–2 weeks but high-flow rising bins may take longer in dry periods. **Side effect:** `getPoRRiseRate.ratePerHour` is now smoothed over 6h, reducing wave-celerity travel-time reductions on flashy sub-6h rises (deliberate accepted behavior change). MAJOR bump because the rule change affects which correction bin is selected for the same inputs. See `analysis/flow_state_window_diagnostic.md`. |
| v34.24 | 2026-03-22 | Fix scheduled-function health counter. `lastRun`, `consecutiveRuns`, and `missedRuns` were only updated inside `storePrediction()`, which is skipped on ~75% of runs when an existing pending prediction is still within its validation window (~9h). Display showed "last run: 8h ago / consecutive: 1 / missed: 422" even though the function ran every 2h. Fix: extracted health tracking into `updateRunHealth()`, called unconditionally from the main handler. `storePrediction()` now only increments `totalPredictions`. 88/88 tests pass. |
| v34.23 | 2026-03-22 | Map Tier 3 polish. (1) Potomac HUC4 watershed boundary as a static GeoJSON asset (5KB, simplified at 10m tolerance) rendered behind rivers and markers with 4% fill / 35% border opacity. (2) Flood-condition marker rings: parallel-fetched NWS gauge status for all 17 gauges, marker border color reflects `floodCategory` (white=normal, yellow=action, orange=minor, red=moderate/major); fill color preserves branch identity. (3) Zoom-dependent gauge labels via permanent Leaflet tooltips, hidden below zoom 10, shown at zoom ≥10 via a `zoomend` listener. |
| v34.22 | 2026-03-22 | Map overhaul. ESRI World Topo basemap (after a brief Stamen/Stadia attempt that required an API key), NHDPlus GeoJSON rivers as a static asset, drain-area-scaled gauge markers, and a more compact legend. CSP updated to allow `arcgisonline.com` tile images. |
| v34.21 | 2026-03-22 | Switch gauge-table trend column from 48h to 24h and rename header to "24h Trend" for consistency with the rest of the dashboard. |
| v34.20 | 2026-03-19 | Fix prediction overwrite loop. Pending predictions were re-stored on every run before the prior one had a chance to validate, so bins were never updated. Fix: skip storing a new prediction if an existing pending prediction is still within its validation window. Validation flow now runs to completion before the next prediction is created. Tests updated for the new multi-call flow. |
| v34.19 | 2026-03-17 | Fix learning-system deadlock. The `potomac_observations` table has a unique constraint on `(observation_type, gauge_id)`, so prediction lifecycle transitions implemented as UPDATE collided with the existing pending row. Predictions were never validated; learning stalled for ~270h. Fix: DELETE pending predictions after validation/expiry rather than UPDATE. |
| v34.18 | 2026-03-17 | Fix `efMissing` blocking all predictions when EF stage is unavailable. The early-return when EF stage was missing prevented the prediction store from running at all. Now treats EF as optional in the prediction path while preserving EF-aware estimation when stage is present. |
| v34.17 | 2026-03-16 | Remove the current-CFS label from the creek chart y-axis to reduce clutter; value is still visible in the card header. Display-only. |
| v34.16 | 2026-03-16 | Add horizontal gridlines to the creek 24h history charts for easier visual comparison against thresholds. Display-only. |
| v34.15 | 2026-03-16 | Expandable creek cards on the Creeks tab: click a card to reveal a 24h CFS history graph for that gauge. Reuses the existing P1D USGS fetch — no new requests. Display-only. |
| v34.14 | 2026-03-16 | Remove the "estimated threshold" warning from Difficult Run after the 200 cfs threshold was confirmed correct. Display-only. |
| v34.13 | 2026-03-16 | Replace the discontinued Rock Creek gauge `01648000` (Georgetown) with `01648010` (Joyce Rd) as the Creeks-tab Rock Creek source. Threshold and labelling preserved. |
| v34.12 | 2026-03-16 | Fix learning system: correct `GF_EMA_ALPHA` import typo in `scheduled-update.js`. The `ReferenceError` was crashing every cron run after the first observation per bin, stalling learning for 247h+. Server-only bug fix; no model/methodology change. |
| v34.11 | 2026-03-09 | Comprehensive correction system bug fixes: (1) EF cross-check in validation now uses cold-water model when temp ≤10°C, eliminating false soft-flags in winter. (2) EF correlation R² `sumCFSSq` double-count on first initialization fixed. (3) EF correlation sums re-anchored to rolling 200-point window when trimming (prevents historical drift). (4) EMA alpha centralized in `shared/model.js` (`GF_EMA_ALPHA`). (5) Server `makeGFPrediction()` now applies wave celerity travel-time reduction on rising rivers, matching client logic. (6) Stage bin EMA now applies same ±2σ soft-flag clamp as flow bin EMA. (7) `totalObs` merge uses sum not max. (8) `calculateCorrections()` throttled to every 5 obs (O(n²) optimization). (9) Cold-start fallback uses observed flow state instead of always 'steady'. |
| v34.10 | 2026-03-07 | Fix flat forecast line: NWS fetch tried slow `/stageflow` endpoint first (500+ observed points, often timing out against 4s race). Reordered to try `/stageflow/forecast` first (12 forecast points, fast). Added late-arrival UI re-render: if NWS completes after the 4s timeout, forecast graph re-renders automatically. |
| v34.9 | 2026-03-06 | UI enhancements: gauge search/filter in All Gauges tab, persist branch collapse state in localStorage, map loading spinner while tiles load. Consolidated TODO/remaining work documentation. |
| v34.8 | 2026-03-06 | Sentry DSN from env var: `sentry.js` reads `VITE_SENTRY_DSN` from Netlify env vars instead of hardcoded empty string. Set env var to activate client-side error monitoring. |
| v34.7 | 2026-03-06 | Fix silent Supabase write failures: error handling on all 5 remaining upserts/deletes in scheduled-update.js. PoR history upsert returns success boolean so caller warns on degraded state. Fix forecast prediction delete double-count bug (failed delete left prediction for re-validation). Version mismatch fix (v34.5/v34.6 → v34.7). |
| v34.6 | 2026-03-06 | Add error handling to correction bin writes: capture upsert errors, bin-write health counters, recovery script. |
| v34.5 | 2026-02-26 | All Gauges UIX improvements: sticky column headers, consistent CSS grid layout, row separators, trend column font fix, responsive mobile breakpoint. Documentation sync across Tech Appendix, README, and How It Works tab. Deleted redundant Model History table (§4.6). |
| v34.4 | 2026-02-26 | Security hardening: remove hardcoded admin PIN fallback (env-only), lock down CORS to production origin with env var override for deploy previews. |
| v34.3 | 2026-02-26 | Extract shared server module (netlify/functions/shared/model.js): deduplicate getSupabase(), GF_FLOW_BINS, getFlowBin(), estimateLFFlowFromStage() across scheduled-update.js and sync-learning.js. |
| v34.2 | 2026-02-26 | Client-side cleanup: collapsible estimation inputs (details/summary), null-check guards for updateGreatFallsUI() and dashboard, fix stale Tech Appendix version string, improve water temperature variable documentation. |
| v34.1 | 2026-02-26 | Fix 90% CI display centering (halfWidth formula) and Learning tab bin data race condition (defer render until after fetch completes). |
| v34.0 | 2026-02-26 | Fix EMA learning system. Three structural flaws in nowcast validation: (1) Seneca noise — was subtracting noisy 1% Seneca estimate from LF to approximate GF, adding ±50-200 cfs noise; now validates against raw LF, correction naturally absorbs Seneca + ungauged area signal. (2) Timing jitter — was accepting validations with unbounded delay (0-48h); now capped at 2.5h after validationDue, rejecting stale validations where flow conditions changed too much. (3) Race condition — both client (every 30min) and server (every 2h) independently updated correction bins, metadata, and EF correlation; now server-only. Client checkGFValidations() disabled. EF hysteresis learning freezes at converged values (minor: ±8% on EF component weighted 0-40%). Originally proposed switching to +6h forecast-based learning, but two independent auditors (coding + hydrology) identified critical domain mismatch: forecast uses NWS inputs, nowcast uses observed gauge data — learning from NWS-contaminated errors would inject forecast bias into clean estimates. Revised approach fixes the nowcast path instead. |
| v33.1 | 2026-02-23 | 24h stored GF history on forecast graph. Stores actual estimateGreatFalls() output in localStorage (mirroring porHistory pattern) instead of simplified PoR-only re-estimation. Fixes low baseline and visible jump at NOW junction caused by model mismatch (history was missing ~12% tributary flows, EF blending, flow-state corrections, LF ceiling). Graph extended from [-12h, 48h] to [-24h, 48h]. Cold-start fallback to computeGFHistoryFromPoR(). Display-only. |
| v33.0 | 2026-02-21 | Two-tier anomaly flagging. Many of the ~60 flagged observations were likely legitimate estimation errors, not ice — USGS ice flags are a separate upstream system. Hard flags (Checks 2, 3, 5: stage-discharge contradiction, low-flow+high-stage, 3σ outlier) skip learning AND accuracy. Soft flags (Checks 1, 4: EF discrepancy, large error) are INCLUDED in learning with EMA clamped at ±2σ from bin mean, and INCLUDED in accuracy. Three-tier gauge_id: hard_flagged, soft_flagged, validated. EF threshold standardized to 0.25 (was 0.30 in sync-learning.js). Check 3 score standardized to +2 (was +1 in sync-learning.js). Independent auditor reviewed: accepted EMA clamping (R1), STATISTICAL_OUTLIER as hard (R2), three-tier DB (R3), Tech Appendix update (R5). |
| v32.3 | 2026-02-21 | Fix accuracy metric inflated by flagged observations. The accuracy formula (100 − avgErrorPercent) included all observations in the denominator, including ~60 ice-flagged ones with 15–30% errors. These were correctly excluded from learning (correction bins) but incorrectly included in the accuracy metric. Fix: only non-flagged observations contribute to sumAbsErrorPercent and avgErrorPercent. New validValidations counter tracks clean observations. Dashboard shows "N valid / M total" split. Both sync-learning.js and scheduled-update.js fixed. |
| v32.2 | 2026-02-21 | Fix missing estimation inputs in EF-only (ice) mode. The EF-only early return in updateGreatFallsUI() skipped the inputs section (lines 2743-2804), leaving correction, 90% CI, flow bin, tributaries, and travel times at HTML defaults (all dashes). Now populates with "N/A — EF only" for PoR-based fields and "❄️ ice-affected" for PoR. Display-only fix. |
| v32.1 | 2026-02-21 | Forecast graph history extended from 6h to 12h: leverages existing 72h porHistory backfill. Junction gap fix: removed bridge from history line to forecast NOW point — the two models (PoR-only history vs full ensemble forecast) produce different values, so bridging created a visible jump. History line now ends naturally at last observed data point. X-axis labels updated (-12h, -6h). Display-only. |
| v32.0 | 2026-02-21 | Flow state classification fix: use observed PoR rate (2-hour lookback from porHistory) instead of NWS 48-hour forecast for rising/falling/steady detection. Matches server-side getFlowState() which already uses observed data. Fixes bug where display showed "STEADY" during actual rising events (NWS forecast flat or unavailable). Falls back to NWS on cold start (porHistory < 4 entries). Affects correction bin lookups and empirical CI selection. |
| v31.3 | 2026-02-20 | 6-hour history on forecast graph: extends graph from [0, 48h] to [-6h, 48h] by retroactively computing GF estimates from existing PoR history in localStorage. Blue history line with data dots, amber NOW divider, responsive x-axis labels. Tooltip shows "(observed)" for history points. No new localStorage — reuses porHistory backfill. Display-only. |
| v31.2 | 2026-02-20 | Aqueduct withdrawal investigation: Washington Aqueduct (at GF), WSSC (Swain's Lock), and Fairfax Water (Seneca) divert ~400–700 cfs above the falls. 3-agent investigation (2 researchers + independent auditor) confirmed withdrawals already absorbed by LF-calibrated model. Systematic errors are 2–7× larger than total withdrawals and scale proportionally — driven by ungauged area, not withdrawals. Documentation-only update. |
| v31.1 | 2026-02-20 | New "Creeks" tab showing rain-dependent whitewater runs near DC: Rock Creek (01648000, ≥400 cfs), NW Branch Anacostia (01650500, ≥200 cfs), Difficult Run (01646000, ≥200 cfs), Sligo Creek (01650800, ≥200 cfs). Binary green-light model with localStorage "last ran" tracking. Separate USGS fetch (P1D, discharge only). Display-only — no estimation logic change. |
| v31.0 | 2026-02-20 | Add Broad Run (01644280, 76 mi², 0.66% of LF) and Seneca Creek (01645000, 101 mi², 0.87% of LF) to GF estimation model. Both tributaries enter between Point of Rocks and Great Falls. Closes ~1,100 cfs of the PoR-to-LF tributary gap. Catoctin Creek (01638480) excluded after independent auditor identified it enters 0.3 mi above PoR gauge (already captured in PoR reading). |
| v30.0 | 2026-02-20 | Logistic EF weight ramp (0%→40%, midpoint 10k cfs, k=5.0) replaces flat 35% step function. Winner of 7-approach horse race on 117,704 hourly obs with Leave-One-Year-Out CV (14 folds). OOS RMSE 1,907 cfs (−4.6% vs v29.0 baseline). Smooth sigmoid eliminates hard 3k cfs cutoff. 3-layer verified (blind Python + R + independent auditor). |
| v29.1 | 2026-02-19 | Empirical 90% CI replaces ±1σ uncertainty display. Per-bin error quantiles (q05/q95) validated on 117,704 hourly observations. Errors are non-normal (kurtosis up to 18.3, asymmetry up to 42:1). Gaussian ±1.645σ would mis-specify by up to 745%. 3-layer verified (Python + R + auditor). |
| v29.0 | 2026-02-19 | Flat 35% EF weight above 3k cfs replaces graduated ramp (0%→10%→40%). Re-optimized on 42,838 hourly observations (2021-2026) with travel-time-shifted PoR. Overall RMSE -4.6% (1,676 vs 1,757 cfs). Simultaneous blind Python + R subagents + independent auditor. |
| v28.1 | 2026-02-19 | Parallel data loading: fetch USGS + EF + temp + NWS simultaneously. Single UI render after all data arrives (eliminates intermediate partial display). NWS fetches parallelized across 15 gauges (was sequential). 8s NWS timeout prevents stalling. |
| v28.0 | 2026-02-19 | Soft LF ceiling (120%) + decay cap (0.50). Grid search: 25 configs on daily (5,208 pairs) + hourly (42,837 pairs, travel-time-shifted PoR). 120% ceiling selected over 110% to avoid systematic under-prediction on rises (-29 cfs bias vs -476 cfs). Cross-verified Python + R. |
| v27.0 | 2026-02-19 | Step-function EF weights replaced with piecewise-linear gradient (0%→40% across 7 anchor points). Coordinate descent optimization on 5,208 consecutive-day pairs. Cross-language verified (Python + R). Overall RMSE -25.8% vs step function. Smooth ramp through mid-flows eliminates hard cutoffs. |
| v26.0 | 2026-02-19 | High-flow EF weight increased from 50% to 70% at >15k cfs. Cross-language optimization (Python + R) showed 22% RMSE improvement. EF beats persistence (RMSE ratio 0.52) with genuine predictive power, but PoR still needed (residual ACF=0.67, errors 5× larger during rapid changes). |
| v25.0 | 2026-02-18 | PoR-delta staleness correction (backtest winner: -18% Rising RMSE, -26% Overall RMSE). Removed EF weight boost (backtest showed it worsened accuracy). Clarified EF gauge accuracy vs. predictive accuracy. New MAJOR.MINOR versioning scheme. |
| v24.16 | 2026-02-18 | Data verification: Deduplicated primary dataset (10,434→5,220 obs). Recalibrated EF model (126×EF^2.46), cold-water model (160×EF^2.36), and flow weights (10-50%). Cross-validated in Python + R. |
| v24.15 | 2026-02-11 | Flow-dependent ensemble weighting: EF weight varies by flow regime based on skill/correlation optimization. |
| v24.14 | 2026-02-11 | Cold-water EF model when water temp ≤10°C. Improves winter RMSE. |
| v24.13 | 2026-02-10 | EF model recalibration from 15 years of USGS daily data. |
| v24.12 | 2026-02-10 | Phase 2 UX: Mobile sidebar, network error banner, map toggle, accessibility fixes. |
| v24.11 | 2026-02-10 | Phase 1 Security: XSS fix, USGS validation, fetch timeouts, PIN to env var, memory leak fix. |
| v24.10 | 2026-02-03 | EF-only fallback when PoR ice-affected, learning suspension, admin dashboard. |
| v24.9 | 2026-01-25 | Iterative travel time convergence for correct time-shifting at variable flows. |
| v24.8 | 2026-01-26 | EF discrepancy check (>50% → skip ensemble). Extended PoR history to 72h. |
| v24.7 | 2026-01-25 | 48h forecast accuracy tracking by horizon (6h, 12h, 24h, 48h). |
| v24.6 | 2026-01-25 | 48h forecast with LF-constrained approach and additive bias correction. |
| v24.5 | 2026-01-25 | LF-constrained forecast: GF rises before LF, shift forecast backward. |
| v24.4 | 2026-01-25 | Initial 48h forecast using NWS PoR forecast with ensemble model. |
| v24.3 | 2026-01-25 | Tighter ice detection thresholds. Reset corrupted low-flow bins. |
| v24.2 | 2026-01-24 | Ice-affected gauge display with ❄️ indicator. |
| v24.1 | 2026-01-24 | Multi-signal ice detection: EF cross-check, stage-discharge, large error, outlier checks. |
| v24.0 | 2026-01-24 | Ice/anomaly detection via sensor fusion. Learning protection when score ≥ 2. |
| v23 | 2026-01-24 | Wave celerity adjustment: up to 30% travel time reduction during rising floods. |
| v22 | 2026-01-23 | Flow-scaled thresholds. Learnable EF hysteresis (±8% starting, EMA α=0.2). |
| v21 | 2026-01-23 | Learning system overhaul: 2h schedule, stale cleanup, health monitoring. |
| v20 | 2026-01-17 | Empirical travel time correction (×0.80) from cross-correlation analysis. |
| v19 | 2026-01-17 | Edwards Ferry ensemble model. Background learning system. |
| v18 | 2026-01-10 | Hysteresis detection, flow-binned corrections. |
| v17 | 2025-12-15 | All Gauges tab with upstream travel time predictions. |
| v16 | 2025-12-01 | Initial public release with PoR-based GF estimation. |

---

*Generated by Potomac Pulse v35.0 — Flow-state lookback widened from 2h to 6h; correction bins reset. All estimation parameters validated on 117,704 hourly observations (2011–2026).*

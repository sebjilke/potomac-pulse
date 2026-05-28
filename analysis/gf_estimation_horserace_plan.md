# Great Falls Estimation Horse Race v2 -- Comprehensive Plan

**Date:** 2026-02-20 (revised)
**Model Version:** v29.1 (baseline)
**Dataset:** 117,704 hourly observations (2011-12-01 to 2026-02-19)
**Data File:** `analysis/hourly_backtest_data.csv`
**Supplementary Data:** `analysis/tributary_hourly_data.csv` (Monocacy + Goose Creek hourly)

---

## 1. Problem Statement

The v29.0/v29.1 model estimates Great Falls (GF) discharge -- a location with no
USGS gauge -- using an ensemble of Point of Rocks (PoR) lagged discharge and
Edwards Ferry (EF) stage converted to CFS. The evaluation target is Little Falls
(LF) discharge (USGS 01646500), which is downstream of GF.

**Important acknowledgement:** We are optimizing for LF prediction accuracy, which
is a proxy for GF accuracy but not identical to it. Since GF > LF (physics: water
is lost to diversions and evaporation between GF and LF, though this is small), the
"true" GF discharge is unknown and unobservable. Any approach that reduces the LF
bias to zero will still underestimate GF by the GF-to-LF loss (probably 1-3%). This
is an inherent limitation of the entire project, not specific to this horse race.

**The systematic bias problem:** The model estimate falls below LF discharge 81.4%
of the time. The root cause is that `por_lagged` is systematically ~10% below LF
(median ratio = 0.9026) because the travel-time-shifted PoR reading does not capture
tributary inflows (Monocacy, Goose Creek, Seneca Creek, and ungauged baseflow
accretion) between PoR and LF.

**Undershoot rates by flow bin:**

| Flow Bin  | Undershoot % | Physical Interpretation |
|-----------|-------------|------------------------|
| 0-2k cfs  | 20.5%       | Baseflow accretion dominates; PoR is close to LF |
| 2-5k      | 73.9%       | Tributary base contributions emerge |
| 5-10k     | 95.6%       | Systematic tributary gap at moderate flows |
| 10-20k    | 95.0%       | Consistent pattern through elevated flows |
| 20-50k    | 93.1%       | High flows; EF blend helps but not enough |
| 50k+      | 83.8%       | Flood flows; larger EF contribution helps |

**Why floors/clipping failed (Round 1):** The previous horse race tested LF-floor
approaches (`max(estimate, LF)`), which eliminated undershoots by definition but
produced estimates that were simply the LF reading 81% of the time -- providing no
information content beyond what the user could read directly from the LF gauge.

**What we need:** Approaches that genuinely improve the GF *estimate* -- reducing
the systematic low bias through better modeling of the PoR-to-GF flow accretion,
rather than substituting the known LF value when the model underestimates.

---

## 2. Available Inputs (Real-Time)

All approaches must be implementable in real time. Available at each hourly
timestamp:

| Variable        | Column in CSV     | Description |
|-----------------|-------------------|-------------|
| `por_now`       | `por_now`         | Current PoR discharge (cfs) |
| `por_lagged`    | `por_lagged`      | Time-shifted PoR discharge (cfs) -- the "same water" |
| `ef_stage`      | `ef_stage`        | Edwards Ferry gage height (ft) |
| `lf_discharge`  | `lf_discharge`    | Little Falls actual discharge (cfs) -- EVALUATION TARGET |
| `water_temp_c`  | `water_temp_c`    | Water temperature at PoR (C) -- NA before 2021 |
| `travel_time_h` | `travel_time_h`   | Searcy-derived travel time for this observation (hours) |

**Derived variables available in real time:**
- `ef_cfs`: Power-law estimate from EF stage (126 * EF^2.46, or 160 * EF^2.36 if temp <= 10C)
- `blended`: Current v29.0 estimate = (1 - ef_weight) * base + ef_weight * ef_cfs (with PoR-delta correction + ceiling)
- `por_change_ratio`: por_now / por_lagged (captures river trend at PoR)
- `monocacy_q`: Monocacy discharge (USGS 01643000), available in real time
- `goose_q`: Goose Creek discharge (USGS 01644000), available in real time
- `flow_state`: rising / falling / steady (derived from hourly LF change)
- Season/month (derived from timestamp)

**NOT available in real time (cannot use):**
- Future LF values
- Future PoR/EF values
- The "correct" GF discharge (no gauge exists)

---

## 3. Candidate Approaches (7 total, numbered 0-6)

### Approach 0: Baseline (v29.0 -- CORRECTED: with tributaries)

**Formula:**
```
ef_cfs = 126 * ef_stage^2.46           # (160 * ef_stage^2.36 if temp <= 10C)
ef_weight = 0.35 if por_lagged >= 3000, else 0.0

# Tributary estimation (matching production code):
# Use actual gauge when available, fall back to LF-based estimate
monocacy_flow = monocacy_q if available, else lf_discharge * 0.071
goose_flow = goose_q if available, else lf_discharge * 0.030
base = por_lagged + monocacy_flow + goose_flow

# PoR-delta correction (if |por_change| > 5%):
staleness = 1.0  # hourly data
decay = min(0.50, sqrt(staleness / travel_time_h))
applied_ratio = 1 + (por_now/por_lagged - 1) * decay
base_corrected = base * applied_ratio   # only if |change| > 5%

# Blending:
blended = (1 - ef_weight) * base_corrected + ef_weight * ef_cfs

# Ceiling:
estimate = min(blended, lf_discharge * 1.20)
```

**CRITICAL NOTE:** The baseline MUST match production code. Production adds
Monocacy + Goose Creek to `por_lagged` before blending. The Round 1 horse race
scripts used `base = por_lagged` without tributaries -- this was incorrect and
produced misleadingly large improvement estimates for tributary-based approaches.
The baseline for this horse race uses `base = por_lagged + monocacy_flow +
goose_flow` where tributary flow uses actual gauge when available, falling back to
`LF * 0.071` / `LF * 0.030`.

**Rationale:** This is the current production model. Establishes the performance
floor that all other approaches must beat.

**Known weakness:** `por_lagged` captures ~83.5% of LF watershed; the remaining
~16.5% (tributaries + ungauged accretion) is estimated from LF itself or from
tributary gauges. The systematic underestimate arises because `por_lagged` does
not grow proportionally with total basin discharge during wet periods.

---

### Approach 1: PoR Ratio Scaler (Continuous Interpolation)

**Core Idea:** The median ratio of LF/por_lagged varies by flow regime. Apply a
pre-calibrated multiplicative correction to `por_lagged` before blending, so the
PoR component is centered on LF rather than biased low. Use continuous interpolation
between bin medians to eliminate bin-boundary discontinuities.

**Formula:**
```
# Calibrate: for each flow bin, compute median(lf_discharge / por_lagged)
# Expected ratios: ~1.02 at 0-2k, ~1.10 at 2-5k, ~1.12 at 5-10k, etc.
# Fit spline/linear interpolation through (bin_midpoint, median_ratio) pairs
RATIO_SPLINE = interpolate(bin_midpoints, calibrated_ratios)  # ~4 knots

# Apply:
ratio = RATIO_SPLINE(por_lagged)   # continuous function, no bin boundaries
por_adjusted = por_lagged * ratio

# Then proceed with standard blending:
blended = (1 - ef_weight) * por_adjusted + ef_weight * ef_cfs
estimate = min(blended, lf_discharge * 1.20)
```

**Rationale:** This directly addresses the root cause: `por_lagged` is
systematically low by a flow-dependent factor because it misses tributary
accretion. The continuous interpolation encodes the empirical PoR-to-LF scaling
without step-function discontinuities at bin boundaries. This is the simplest
possible fix -- a smooth lookup-based correction.

**What it fixes:** Eliminates median bias across all flow regimes. Should reduce
the 81% undershoot rate substantially.

**Risks:**
- Overfitting to historical ratios (mitigated by cross-validation).
- The correction is applied to `por_lagged`, not the blended estimate, so the EF
  blend still provides independent information.
- Uses `por_lagged` to determine the correction magnitude, which is slightly
  circular (we're correcting the value used to choose the correction). The
  continuous interpolation mitigates this vs. a step function (no sharp jumps
  at bin edges).

**Calibration:** Leave-one-year-out cross-validation. Calibrate ratios on 13 years,
evaluate on the held-out year. Report both in-sample and OOS metrics.

---

### Approach 2: Actual Tributary Addback

**Core Idea:** Instead of estimating tributary contributions as a percentage of LF
(which is the evaluation target), use the actual USGS gauge readings for Monocacy
and Goose Creek -- they are available in real time. Add a calibrated term for
ungauged accretion (Seneca Creek, groundwater baseflow, etc.).

**Formula:**
```
# Real-time tributaries:
monocacy = monocacy_q   # USGS 01643000 (real-time gauge)
goose = goose_q          # USGS 01644000 (real-time gauge)

# Ungauged fraction: LF drainage area = 11,570 sq mi
# PoR = 9,651 sq mi (83.4%), Monocacy = 817 sq mi (7.1%), Goose = 350 sq mi (3.0%)
# Remaining ungauged: 1,752 sq mi (6.5%) -- includes Seneca, Muddy Branch, etc.
# Estimate ungauged as a fraction of gauged tributaries, scaled by drainage area:
UNGAUGED_RATIO = 1752 / (817 + 350)  # ~ 1.50
ungauged = (monocacy + goose) * UNGAUGED_RATIO * UNGAUGED_SCALE
# UNGAUGED_SCALE is calibrated (expected near 0.5-1.0, since ungauged areas
# have lower unit discharge than gauged tributaries in the Piedmont)

# GF estimate:
por_component = por_lagged   # time-shifted PoR
gf_base = por_component + monocacy + goose + ungauged
# Then blend with EF:
blended = (1 - ef_weight) * gf_base + ef_weight * ef_cfs
estimate = min(blended, lf_discharge * 1.20)
```

**Rationale:** The current model estimates tributaries as `LF * 0.071` and
`LF * 0.03`, which creates a circular dependency on LF. Using actual gauge
readings breaks this dependency and provides genuine new information. The ungauged
fraction is estimated from drainage area proportionality -- a standard hydrological
approach.

**What it fixes:** Adds ~10% of watershed area that the baseline misses. Monocacy
alone contributes 7.1% of LF flow; during wet Monocacy events (flashy Piedmont
stream), this contribution can be 15-20% of LF.

**Risks:**
- Monocacy and Goose are upstream tributaries; their water takes time to reach LF.
  However, the tributary timing audit showed that time-shifting tributaries does NOT
  improve RMSE (< 0.1% theoretical maximum), so using unshifted values is correct.
- The ungauged fraction is uncertain. UNGAUGED_SCALE will be calibrated but may
  vary seasonally.
- Data availability: tributary data has ~2% gaps. Fallback: use the `LF * pct`
  estimates when gauge data is missing. Track and report the gap-fill rate.

**Calibration:** Optimize UNGAUGED_SCALE via grid search (0.0 to 2.0 in 0.05 steps)
minimizing RMSE on training data. Cross-validate leave-one-year-out.

---

### Approach 3: Regression Ensemble (Log-Linear Ridge + Duan Correction)

**Core Idea:** Fit a log-linear Ridge regression predicting LF from all available
real-time inputs, with positive coefficient constraints. Single formulation --
no sub-variants.

**Formula:**
```
# Log-linear Ridge with positive constraints:
# log(LF) = b0 + b1*log(por_lagged) + b2*log(ef_cfs) + b3*log(monocacy_q)
#          + b4*log(goose_q) + b5*por_change_ratio
#
# Constraints: b1, b2, b3, b4 >= 0 (physically, more flow = more discharge)
# Ridge penalty: lambda * sum(b_i^2) to stabilize multicollinear coefficients
#
# Back-transform with Duan (1983) smearing correction:
# LF_hat = exp(log_LF_hat) * (1/N * sum(exp(residuals_train)))
# This corrects the exp(E[log(X)]) != E[X] bias from log-space regression
```

**Implementation:** Fit in log-space with Ridge penalty (`glmnet` in R, `sklearn`
Ridge in Python). Constrain coefficients to be non-negative. Report VIFs (Variance
Inflation Factors) for all predictors to quantify multicollinearity.

**Rationale:** The current model hard-codes a 35% EF weight and fixed tributary
fractions. A regression lets the data determine the optimal combination. The log
transformation handles the multiplicative error structure (errors scale with flow).
The Duan smearing correction prevents the systematic ~1% underestimate that arises
from back-transforming log-space predictions.

**What it fixes:** Jointly optimizes all component weights rather than tuning them
one at a time. May discover that the optimal PoR weight is > 1.0 (i.e., a scaling
correction) or that EF deserves more weight in certain regimes.

**Risks:**
- Multicollinearity between `por_lagged`, `ef_cfs`, `monocacy_q`, and `goose_q`
  (all positively correlated). Ridge penalty mitigates but report VIFs.
- Log transformation requires all inputs > 0 (true for discharge data).
- ~5 calibrated parameters.

**Calibration:** Leave-one-year-out cross-validation. Fit on 13 years, predict
held-out year. Report VIFs and coefficient stability across folds.

---

### Approach 4: PoR Ratio Scaler + Actual Tributaries (Combined)

**Core Idea:** Combine the bias correction from Approach 1 with the actual
tributary addback from Approach 2. This attacks both sources of error: (a) the PoR
component itself is biased low, and (b) the tributary estimates use circular LF data.

**Formula:**
```
# Step 1: Scale PoR component to remove systematic bias
por_adjusted = por_lagged * RATIO_SPLINE_V2(por_lagged)
# Note: RATIO_SPLINE_V2 is recalibrated AFTER adding actual tributaries,
# so it captures only the residual bias (ungauged accretion + timing effects)

# Step 2: Add actual tributary flows
gf_base = por_adjusted + monocacy_q + goose_q

# Step 3: Blend with EF
blended = (1 - ef_weight) * gf_base + ef_weight * ef_cfs
estimate = min(blended, lf_discharge * 1.20)
```

**Rationale:** Approach 1 corrects the PoR scaling but still uses estimated
tributaries. Approach 2 adds actual tributaries but does not correct the PoR
scaling. This combines both fixes. The ratio spline is smaller (closer to 1.0)
because actual tributaries absorb much of the gap.

**What it fixes:** Both the tributary estimation error (circular LF dependency) and
the residual PoR bias (ungauged accretion, Seneca Creek, groundwater).

**Risks:** Double-counting if the ratio correction and tributary addback overlap in
what they fix. Mitigated by recalibrating the ratio spline with actual tributaries
already in place.

**Calibration:** Two-stage. First fit UNGAUGED_SCALE (Approach 2), then calibrate
residual ratio correction. Cross-validate the full pipeline. ~5 parameters total.

---

### Approach 5: EF-Dominant Model (Logistic Weight Function)

**Core Idea:** Edwards Ferry is physically much closer to Great Falls than Point of
Rocks is. EF is located *downstream* of where Monocacy and Goose Creek join the
Potomac, so EF stage already reflects the tributary accretion that `por_lagged`
misses. At moderate-to-high flows (where the EF power law has good predictive
skill), EF should arguably dominate the estimate. This approach uses a smooth
logistic weight function with 2-3 parameters instead of step-function bins.

**Formula:**
```
# Logistic EF weight function (2-3 parameters):
# Replaces the current step function (0% < 3k, 35% >= 3k)
ef_weight = w_max / (1 + exp(-k * (por_lagged - midpoint)))

# Parameters:
#   w_max:    maximum EF weight (expected 0.50-0.80)
#   k:        steepness of transition (expected 0.0005-0.005)
#   midpoint: flow at which ef_weight = w_max/2 (expected 3000-8000 cfs)

# Standard blending with higher EF contribution:
blended = (1 - ef_weight) * por_lagged_adjusted + ef_weight * ef_cfs
estimate = min(blended, lf_discharge * 1.20)
```

**Rationale:** EF is ~2 miles upstream of GF. Its power-law relationship with LF
has R^2 = 0.91 (all flows) and R^2 = 0.98 (cold water). At high flows (where the
model most needs improvement), EF correlation with LF is 0.97. EF naturally
captures the contributions of all tributaries between PoR and EF (including
Monocacy and Goose Creek) because it measures the river *after* those tributaries
join. The current 35% weight may be too conservative.

The key insight: EF *already includes* the tributary accretion that PoR misses.
Higher EF weight effectively imports that information.

**Note on EF precision:** EF gage height is measured to 0.01 ft. The power-law
amplification means small stage errors become CFS errors, but analysis shows this
is < 0.5% of flow at all stages -- EF precision is NOT the limiting factor.

**What it fixes:** Uses a measurement point that inherently captures the tributary
gap. Does not require separate tributary estimation or bias correction tables.
The logistic function guarantees monotonicity and smoothness with only 2-3
parameters (vs. 6 anchors in a binned approach).

**Risks:**
- EF power law has higher residual variance than PoR at low flows (R^2 drops
  substantially below 3k cfs). The logistic weight function naturally assigns
  near-zero EF weight at low flows, protecting against this.
- Must cross-validate the 2-3 logistic parameters.

**Calibration:** Optimize (w_max, k, midpoint) via grid search or Nelder-Mead
on training data. Leave-one-year-out CV.

---

### Approach 6: EF Power-Law Refit (a * EF^b fitted to LF)

**Core Idea:** Instead of correcting the blended estimate after the fact (Approach
1) or increasing EF weight (Approach 5), recalibrate the EF power-law coefficients
to directly predict LF rather than GF. Currently: `ef_cfs = 126 * EF^2.46`. If we
fit `lf_hat = a * EF^b` directly on the training data, the intercept `a` will
absorb the systematic bias because EF captures the full river including tributaries.

**Formula:**
```
# For each LOYO fold:
#   Fit: log(lf_discharge) = log(a) + b * log(ef_stage) on training data
#   Predict: ef_cfs_new = a * ef_stage^b on test data
#   Blend: blended = (1 - ef_weight) * por_lagged + ef_weight * ef_cfs_new
#   Ceiling: estimate = min(blended, lf_discharge * 1.20)
```

**Why this is powerful:**
- It is the simplest possible change: just update two numbers (intercept and
  exponent). Only 2 calibrated parameters.
- It is physically interpretable: the new power law converts EF stage to LF-scale
  discharge, automatically including the tributary contribution.
- It requires NO new data sources.
- Combined with optimized EF weights (Approach 5), this could be the most
  parsimonious winning approach.

**Risks:** The EF power law was originally calibrated to EF's own rating curve, not
to LF. Recalibrating to predict LF changes its physical meaning. But since we have
no GF gauge, this is pragmatically justified -- we are building a LF predictor.

**Calibration:** Log-linear regression (OLS in log-space) with LOYO CV. 2 parameters
per fold. Report coefficient stability across folds.

---

## 4. Evaluation Framework

### 4.1 Why Evaluation Is Tricky

If we evaluate on all 117,704 hours with LF as the target, any approach that pushes
estimates upward will look good simply by closing the 10% systematic bias gap --
even if it is adding noise. Conversely, if we evaluate only on the ~18.6% of hours
where the baseline overshoots LF (the "unbiased" subset), we ignore the 81% of
hours where improvement is most needed.

The solution is a multi-level evaluation framework that separates bias correction
from noise injection.

### 4.2 Primary Metrics

For every approach, compute these metrics:

| Metric | Definition | Interpretation |
|--------|-----------|----------------|
| Skill Score (SS) | 1 - MSE_model / MSE_baseline | Primary comparison metric; 0 = no better than baseline, >0 = improvement |
| RMSE   | sqrt(mean((estimate - LF)^2)) | Overall prediction error |
| MAE    | mean(\|estimate - LF\|) | Average absolute error |
| Bias   | mean(estimate - LF) | Systematic over/under-estimation |
| % Bias (per bin) | mean((estimate - LF) / LF * 100) | Percentage bias -- most intuitive measure of whether systematic underestimate is fixed |
| MdAPE  | median(\|estimate - LF\| / LF * 100) | Percentage error (robust) |
| R^2    | 1 - SS_res / SS_tot | Variance explained |
| Undershoot % | % of hours where estimate < LF | Fraction below target |
| Info Content | % of hours where estimate != LF (within 1%) | Sanity check only (not discriminative -- all v2 approaches produce ~100% by construction) |

**Skill Score (SS)** is the primary comparison metric. It normalizes improvement
to a 0-1 scale relative to the baseline, which is more interpretable than raw RMSE
differences because it accounts for the difficulty of the prediction problem.

**Percentage bias** is reported per flow bin to give the most intuitive measure of
whether the systematic underestimate is fixed at each flow level.

**Info Content** is retained as a sanity check only (flag if < 50%), not as a
discriminative metric -- all proposed approaches compute estimates from PoR/EF
inputs and will have ~100% info content by construction.

### 4.3 Evaluation Subsets

Every metric is computed on three subsets (streamlined from the original five):

**Subset A: Overall (N = 117,704)**
- Shows total performance including bias correction effects.
- Primary reporting subset.

**Subset B: Per Flow Bin (6 bins)**
- Check for flow-dependent degradation.
- 0-2k cfs (N = 11,830, 10.1%)
- 2-5k cfs (N = 32,017, 27.2%)
- 5-10k cfs (N = 30,779, 26.1%)
- 10-20k cfs (N = 26,697, 22.7%)
- 20-50k cfs (N = 13,753, 11.7%)
- 50k+ cfs (N = 2,628, 2.2%)

**Subset C: Rising vs. Steady (2 states)**
- Rising-river hours (N = 6,303): the model struggles most on rising limbs
  (wave hasn't arrived yet, PoR is stale).
- Steady-state hours (N = 108,354): the dominant regime; determines the
  "typical" user experience.
- (Falling-river hours dropped as a primary subset -- only 3,047 obs. Can be
  computed post-hoc if needed.)

Additional subsets (overshoot hours, former undershoot hours, per_bin_state cross)
can be computed post-hoc if the winner is ambiguous, but are not in the primary
comparison table.

### 4.4 Cross-Validation Protocol

All approaches that involve calibrated parameters MUST use temporal
leave-one-year-out (LOYO) cross-validation:

- Years: 2012, 2013, ..., 2025 (14 folds, since 2011 is partial and 2026 is
  partial; include partial years in training only)
- For each fold: calibrate on 13 years, predict the held-out year
- **48-hour buffer at year boundaries:** exclude the first and last 48 hours of
  each held-out year from evaluation (not from training). This eliminates
  year-boundary contamination where December 31 training data is nearly identical
  to January 1 test data.
- Report both **in-sample** and **out-of-sample (OOS)** metrics
- The primary comparison metric is the **OOS Skill Score** (and OOS RMSE)

Approach 0 (baseline) has no calibrated parameters, so LOYO does not change its
metrics. It is evaluated on all data (with the same 48-hour exclusions applied for
comparability).

### 4.5 What Constitutes "Winning"

**Tier 1 -- Must beat baseline on ALL:**
1. OOS Skill Score > 0 (OOS RMSE < baseline RMSE overall)
2. OOS Bias closer to 0 than baseline

**Tier 2 -- Desirable properties:**
3. Undershoot rate 40-60% (substantially improved from 81%, targeting balanced errors)
4. Rising-river RMSE improvement > 5%
5. No single flow bin where OOS RMSE is > 10% worse than baseline
6. Parsimonious (fewer calibrated parameters preferred)

**Tier 3 -- Tiebreaker criteria:**
7. Implementation simplicity (can be coded in 20 lines of JavaScript)
8. Robustness: OOS RMSE std across folds is low
9. Physical interpretability of parameters

**Automatic disqualification:**
- Info Content < 20% (approach is mostly echoing LF -- this is a floor, not a model)
- OOS RMSE > 10% worse than baseline in any single flow bin above 5k cfs
  (must not seriously hurt high-flow prediction; minor per-bin noise is tolerated)
- Uses future information (look-ahead bias)

### 4.6 Diagnostic Plots

For each approach, generate:
1. **Residual vs. predicted**: scatter plot of (estimate - LF) vs. estimate.
   Should show zero-centered band, not a funnel.
2. **Q-Q plot of errors**: compare to normal distribution. Shows tail behavior.
3. **Time series of 5 representative flood events**: overlay estimate vs. LF for
   the 5 largest flood peaks in the dataset. Visual check of timing and magnitude.
4. **Bias by flow bin**: bar chart comparing baseline vs. approach % bias per bin.
5. **Undershoot rate by flow bin**: before vs. after comparison.
6. **Cumulative error distribution**: CDFs of |error| for baseline vs. approach.

---

## 5. Implementation Plan

### 5.1 Scripts to Create

Each approach needs two scripts (Python + R) per the CLAUDE.md verification protocol:

| Script | Description |
|--------|------------|
| `horserace_v2_python.py` | Python implementation of all 7 approaches + evaluation |
| `horserace_v2_R.R` | R implementation of all 7 approaches + evaluation |
| `horserace_v2_python.csv` | Python results (per-approach, per-subset, per-bin) |
| `horserace_v2_R.csv` | R results |
| `horserace_v2_audit.md` | Independent auditor verification |

### 5.2 Output CSV Format

Each row represents one approach x one evaluation scope:

```
approach, scope, flow_bin, flow_state, n, skill_score, rmse, mae, bias, pct_bias,
mdape, r2, pct_below_lf, info_content, n_params
```

Where:
- `approach`: 0_baseline, 1_ratio_scaler, 2_trib_addback, 3_regression,
  4_combined, 5_ef_dominant, 6_ef_powerlaw_refit
- `scope`: overall, per_bin, rising, steady, oos_overall, oos_per_bin
- `flow_bin`: ALL, 0-2k, 2-5k, 5-10k, 10-20k, 20-50k, 50k+
- `flow_state`: ALL, rising, steady

### 5.3 Data Preparation

1. Load `hourly_backtest_data.csv` (117,704 rows)
2. Load `tributary_hourly_data.csv` (Monocacy + Goose Creek actual discharge)
3. Left-join on timestamp. Track and report match rate (expect ~95-98% match).
4. Compute derived variables: `ef_cfs`, `blended` (v29.0 with corrected baseline),
   `flow_state`, `flow_bin`, `month`, `season`
5. **Baseline tributary handling:** Use actual gauge when available, fall back to
   `lf_discharge * 0.071` / `lf_discharge * 0.030` (matching production code).
6. For approaches using actual tributaries (2, 4): fill gaps with `LF * 0.071` and
   `LF * 0.030` (same fallback). Report gap-fill rate.
7. For pre-2021 data (no water_temp_c): use the default power law
   (126 * EF^2.46) always. Flag and report whether results differ materially
   between 2011-2020 and 2021-2026 subperiods.

### 5.4 Execution Order

1. **Prepare data** (both scripts)
2. **Compute Approach 0** (baseline -- no calibration, corrected with tributaries)
3. **Calibrate Approach 5** (EF-Dominant) and **Approach 6** (EF Power-Law Refit)
   first -- simplest changes, test the most promising physical mechanism
4. **Calibrate Approaches 1 and 2** -- the two main correction strategies
5. **Calibrate Approach 4** (combined) -- only if 1 and 2 both show improvement
6. **Calibrate Approach 3** (regression) -- flexible benchmark
7. **Evaluate all approaches** on all subsets
8. **Generate diagnostic outputs**
9. **Compare and rank by OOS Skill Score**

### 5.5 Estimated Computation

- 7 approaches x 14 CV folds x 117k observations = ~11.5 million evaluations
- Most approaches are O(N) per fold (lookup tables, linear blending)
- Approach 3 (regression) requires O(N * p^2) per fold (p ~ 5 features)
- Approaches 5, 6 require nonlinear optimization (grid search or Nelder-Mead)
- Total estimated runtime: ~15 minutes (Python), ~25 minutes (R)

---

## 6. Expected Outcomes and Hypotheses

### Approach summary table:

| # | Name | Key Parameters | Priority |
|---|------|---------------|----------|
| 0 | Baseline v29.0 (CORRECTED: with tributaries) | 0 | Reference |
| 1 | PoR Ratio Scaler (continuous interpolation) | ~4 spline knots | 3 |
| 2 | Actual Tributary Addback (gauged values + ungauged_scale) | 1 | 4 |
| 3 | Regression Ensemble (log-linear Ridge + Duan correction) | ~5 | 6 |
| 4 | Combined Ratio + Tributaries | ~5 | 5 |
| 5 | EF-Dominant (logistic weight function) | 2-3 | 2 |
| 6 | EF Power-Law Refit (a * EF^b fitted to LF) | 2 | 1 |

### Ordering prediction (most to least likely to win):

1. **Approach 6 (EF Power-Law Refit)** -- simplest possible change (2 parameters),
   physically interpretable, and the refit intercept directly absorbs the systematic
   bias because EF captures full-river flow including tributaries.

2. **Approach 5 (EF-Dominant)** -- most physically motivated: EF is downstream of
   tributary confluences and inherently captures the accretion that PoR misses.
   Smooth logistic weight function with only 2-3 parameters.

3. **Approach 4 (Combined Ratio + Tributaries)** -- attacks both sources of bias;
   should produce the largest bias reduction while preserving EF blend.

4. **Approach 1 (Ratio Scaler)** -- simplest direct fix for the dominant problem;
   may closely match Approach 4 if actual tributaries add little beyond what the
   ratio absorbs.

5. **Approach 2 (Actual Tributaries)** -- mechanistically sound but the 10%
   tributary contribution may be too small to dominate the improvement.

6. **Approach 3 (Regression)** -- flexible but may overfit on correlated features;
   Ridge penalty stabilizes but interpretability is limited.

### Key hypotheses to test:

**H1:** The majority of the 81% undershoot is explained by a simple flow-dependent
multiplicative bias in `por_lagged`. (Approach 1 reduces undershoot to <50%.)

**H2:** Actual tributary gauges provide genuine new information beyond what a ratio
correction captures. (Approach 4 beats Approach 1 by >2% RMSE.)

**H3:** Higher EF weights improve performance at flows above 5k cfs. (Approach 5
beats baseline on 5-10k, 10-20k, 20-50k bins.)

**H4:** Recalibrating the EF power law to predict LF directly is the most
parsimonious improvement. (Approach 6 achieves comparable Skill Score to more
complex approaches with only 2 parameters.)

**H5:** No approach reduces overall OOS RMSE by more than 25%. The fundamental
limit is the ~10% ungauged watershed fraction plus the EF power-law measurement
error.

---

## 7. Decision Framework

After the horse race completes:

**If Approach 5 or 6 wins clearly (SS > 0.05, robust across bins):**
- Implement in production as v30.0 (new estimation approach = major version bump)
- Update both `index.html` and `scheduled-update.js`
- Verify in browser via Chrome MCP

**If multiple approaches are within SS = 0.01 of each other:**
- Select the simplest (fewest parameters, easiest to maintain)
- Consider a hybrid: e.g., Approach 6's refit power law + Approach 5's higher
  EF weights

**If no approach beats baseline by SS > 0.02:**
- The baseline is already near-optimal given these inputs
- Document findings and close the investigation
- Consider whether additional data sources (NWS forecasts, radar rainfall) could
  break the performance ceiling

**Post-hoc refinements (applied to winner only):**
- **Seasonal correction:** Test whether the winner's residuals have seasonal
  structure. If so, add seasonal terms (originally Approach 5, dropped as
  standalone due to 72-parameter count but viable as refinement of a simpler model).
- **Ceiling re-optimization:** If the winning approach substantially changes the
  error distribution, re-optimize the 120% LF ceiling parameter.

---

## 8. Post-Hoc Analyses (Not in Primary Horse Race)

### 8.1 Seasonal Refinement (Former Approach 5)

After identifying the winner, test whether residuals show seasonal structure:
- Compute residuals = estimate - LF for the winning approach
- Test for monthly or quarterly (DJF/MAM/JJA/SON) patterns
- If seasonal bias exceeds 2% of flow in any season, add a seasonal correction
  term to the winner and re-evaluate via LOYO CV

This avoids the 72-parameter problem of a standalone seasonal model while
preserving the ability to capture seasonal effects as a refinement.

### 8.2 ML Performance Ceiling (Former Approach 8)

If desired, a gradient-boosted regression (LightGBM/XGBoost) can be run as a
separate analysis to establish the performance ceiling with these inputs. This is
NOT a production candidate (not implementable in JavaScript, R verification is
difficult, and performance is inflated by temporal autocorrelation). It serves
purely as a benchmark to assess whether simpler models are leaving performance on
the table.

---

## Revision History

**v2.1 (2026-02-20) -- Auditor-Recommended Changes:**

Changes incorporated from the independent plan audit
(`analysis/gf_horserace_v2_plan_audit.md`):

1. **CRITICAL: Fixed baseline (Approach 0).** Corrected to match production code:
   `base = por_lagged + monocacy_flow + goose_flow` where tributary flow uses
   actual gauge when available, falls back to `LF * 0.071` / `LF * 0.030`. The
   original plan described this correctly but the Round 1 scripts omitted
   tributaries from the baseline, which would have inflated improvement estimates.

2. **Dropped Approach 5 (Seasonal Bias Correction)** as standalone. 72 parameters
   (12 months x 6 bins) is over-parameterized for what is likely a second-order
   effect. Retained as a post-hoc refinement of the winner (Section 8.1).

3. **Dropped Approach 8 (ML Ensemble / Gradient-Boosted Trees).** Not a production
   candidate, R verification is difficult due to non-reproducible tree algorithms,
   and performance would be inflated by extreme temporal autocorrelation (DW=0.007).
   Retained as optional post-hoc ceiling analysis (Section 8.2).

4. **Added Approach 6 (EF Power-Law Refit).** New approach: refit `a * EF^b` to
   predict LF directly. Only 2 parameters, simplest possible change, physically
   interpretable. The refit intercept absorbs the systematic bias because EF
   captures full-river flow.

5. **Elevated Approach 5 (EF-Dominant) to priority #2** (now renumbered as
   Approach 5). Most physically motivated -- EF is downstream of tributary
   confluences. Changed from 6-anchor step function to 2-3 parameter logistic
   weight function to reduce parameterization and guarantee smoothness.

6. **Approach 1 modified:** Changed from step-function (bin lookup) to continuous
   interpolation (linear interp / spline between bin medians) to eliminate
   bin-boundary discontinuities identified by auditor.

7. **Added Skill Score** as primary comparison metric:
   `SS = 1 - MSE_model / MSE_baseline`. More interpretable than raw RMSE
   differences.

8. **Added percentage bias** per flow bin:
   `mean((estimate - LF) / LF * 100)`. Most intuitive measure of systematic
   underestimate at each flow level.

9. **Demoted Info Content** to sanity-check-only metric (not discriminative). All
   v2 approaches compute estimates from PoR/EF inputs and have ~100% info content
   by construction.

10. **Simplified evaluation subsets** from 5 to 3: overall, per-bin, rising vs.
    steady. Dropped overshoot, former-undershoot, and falling subsets from primary
    comparison (available post-hoc if needed). Reduces output table from ~810 rows
    to ~150 rows.

11. **Added 48-hour buffer** at year boundaries in LOYO CV to prevent
    year-boundary contamination from adjacent-hour similarity.

12. **Relaxed disqualification criterion** from "OOS RMSE worse than baseline on
    ANY flow bin above 5k" to "> 10% worse in any bin." A model that improves
    overall by 10% should not be disqualified for 2% noise in one bin.

13. **Added Duan (1983) smearing correction** for Approach 3 (log-space
    regression). Corrects the `exp(E[log(X)]) != E[X]` bias (~1% underestimate)
    from back-transforming log-space predictions.

14. **Approach 3 pinned to single formulation:** log-linear Ridge with positive
    constraints. Eliminated ambiguity between OLS, weighted least squares, and
    constrained variants. Added VIF reporting requirement.

15. **Renumbered all approaches** 0-6 (was 0-8) to reflect dropped/added approaches.

**Rejected auditor recommendations (with reasoning):**

- **Seneca Creek gauge (USGS 01645000):** Only 0.9% of LF drainage area. Already
  used in production for a different purpose (LF->GF correction). Not worth
  downloading additional hourly data for <1% improvement potential.

- **Additive vs. multiplicative bias correction sub-variants in Approach 1:** Adds
  complexity without clear payoff. The continuous interpolation already accommodates
  varying bias structure across flow levels. If residual analysis suggests additive
  is better, test post-hoc on the winner.

---

*Plan prepared 2026-02-20, revised 2026-02-20 based on auditor review, for
Potomac Pulse GF Estimation Horse Race v2.*

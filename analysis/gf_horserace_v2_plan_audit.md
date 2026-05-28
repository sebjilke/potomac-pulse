# GF Estimation Horse Race v2 -- Plan Audit Report

**Date:** 2026-02-20
**Auditor:** Independent subagent (Claude Opus 4.6)
**Scope:** Methodological review of proposed horse race plan, prior to execution
**Files reviewed:**
- `analysis/gf_estimation_horserace_plan.md` (the plan under review)
- `analysis/lf_floor_horserace_audit.md` (Round 1 audit)
- `analysis/lf_floor_horserace.py` / `.R` (Round 1 scripts)
- `analysis/hourly_backtest_data.csv` (117,704 rows, 7 columns)
- `analysis/tributary_hourly_data.csv` (124,430 rows, 3 columns)
- `analysis/validate_tributary_timing_python.csv` (tributary timing results)
- `analysis/error_distribution_python.csv` (error distribution by bin/state)

---

## 0. Executive Summary

The plan is thoughtful, well-structured, and correctly identifies the root cause
(systematic ~10% low bias in `por_lagged`). The evaluation framework is
significantly better than Round 1 (which lacked cross-validation entirely). However,
the plan has several material weaknesses:

1. **The most promising approach is buried at #6 and underrated.** Approach 6
   (EF-Dominant) deserves more attention because EF inherently captures the
   tributary accretion that is the root cause of the bias.

2. **The plan's most complex approaches (7, 8) add marginal value** given that
   the problem is fundamentally a ~10% multiplicative bias -- not a nonlinear
   interaction problem.

3. **The cross-validation design has a subtle flaw** for approaches that use
   `por_lagged` to determine flow bins (self-referential binning).

4. **A critical missing approach**: direct calibration of the EF power-law
   intercept (which absorbs the same bias as ratio scaling, but through a
   physically interpretable mechanism).

5. **The evaluation framework is solid but overspecified** -- 5 subsets x 6 bins
   x 3 states x 9 approaches = hundreds of cells, many with too few observations
   to draw conclusions.

**Bottom line:** The plan should be streamlined to 6 approaches (drop 5 and 8,
add the power-law recalibration approach), and the evaluation framework simplified.

---

## 1. Approach-by-Approach Evaluation

### Approach 0: Baseline (v29.0) -- KEEP AS-IS

Sound reference point. No concerns.

One observation: the plan's baseline formula on line 84-94 includes `monocacy_est
+ goose_est` as `LF*0.071` and `LF*0.03`. But the actual `compute_blended()`
function in `lf_floor_horserace.py` (line 61) uses `base_estimate = por_lagged`
with NO tributary addback -- the tributaries are not added in the Python baseline.
**The plan's description of the baseline does not match the implemented baseline.**
This must be clarified before execution: does v29.0 in production add tributary
estimates or not? If it does, the backtest scripts need to match. If it does not,
then the plan's formula for Approach 0 is wrong and the tributary addback in
Approaches 2/4 would show larger improvements than they should.

**ACTION REQUIRED:** Verify whether the production baseline (`index.html` and
`scheduled-update.js`) includes tributary addback. The Round 1 Python script does
NOT include it. If production does include it, the baseline must be updated in the
horse race scripts to match.

---

### Approach 1: PoR Ratio Scaler -- KEEP, with modification

**Strengths:**
- Directly targets the root cause (10% systematic low bias).
- Simple, interpretable, low parameter count (6 ratios, one per flow bin).
- Easy to implement in production JavaScript.

**Weaknesses and concerns:**

1. **Self-referential binning (circularity).** The plan uses `por_lagged` to
   determine the flow bin, then applies a correction to `por_lagged` based on
   that bin. This is acknowledged (line 139) but not resolved. The concern is
   real: if `por_lagged` is 4,500 cfs (in the 2-5k bin) and the ratio is 1.10,
   the corrected value is 4,950 -- still in the 2-5k bin. But if `por_lagged` is
   4,800 cfs, the corrected value is 5,280 -- which would be in the 5-10k bin.
   This creates a discontinuity at bin boundaries.

   **Recommendation:** Use continuous interpolation instead of a step function.
   Fit a smooth curve (e.g., linear interpolation or a low-degree polynomial) to
   the ratio vs. `por_lagged` relationship. This eliminates the bin-boundary
   discontinuity and is equally simple to implement.

2. **Training-target leakage.** The ratio `median(lf / por_lagged)` is computed
   using `lf_discharge`, which is also the evaluation target. Within LOYO CV,
   the ratio is computed on 13 years of training data and applied to the held-out
   year -- this is correct. But **the ratio table fundamentally encodes the
   historical LF/PoR relationship**, not the GF/PoR relationship. Since we have
   no GF gauge, we cannot know if this ratio generalizes to GF. This is an
   inherent limitation that should be stated explicitly: we are really building a
   LF predictor, not a GF predictor, because we have no GF ground truth.

3. **The 81% undershoot is partly mechanical.** The plan states `por_lagged` is
   10% below LF at the median. But the blended estimate also applies a 120% LF
   ceiling, which clips the top ~18% of estimates. This means the ceiling
   *creates* some undershoots that would not exist without it. The ratio correction
   should be computed on the *unceilinged* blended estimate to isolate the true
   PoR bias from the ceiling effect.

---

### Approach 2: Actual Tributary Addback -- KEEP, with caution

**Strengths:**
- Physically motivated: uses real gauge data instead of circular LF estimates.
- Monocacy (7.1% of drainage area) is a significant contributor.
- Breaks the dependency on LF for tributary estimation.

**Critical concern: Tributary timing was already tested and found irrelevant.**
The `validate_tributary_timing_python.csv` results show that for all flow regimes,
time-shifting tributaries produces < 0.1% RMSE change. This is consistent with the
plan's statement. BUT: the prior analysis tested adding tributaries at their
*current fractions* (`LF * 0.071` and `LF * 0.030`), not at their actual values.
When using actual gauge readings, the tributary contribution will be much larger
during flashy Monocacy events -- this is precisely the scenario where timing matters
most. **The timing validation may not transfer to the actual-tributary approach.**

**Recommendation:** As a diagnostic, compute the correlation between
`monocacy_q(t)` and `lf_discharge(t)` vs `monocacy_q(t-lag)` and `lf_discharge(t)`
for lag = 0, 1, 2, 3, 4 hours, restricted to hours where `monocacy_q > 2 *
median(monocacy_q)` (high-flow Monocacy events). If timing matters for high-trib
events, consider a flow-dependent lag.

**Data concern:** The tributary file has 124,430 rows while the backtest has 117,704
rows. The left-join will produce NaNs for unmatched timestamps. The plan correctly
specifies filling gaps with `LF * 0.071` and `LF * 0.030` -- but this reintroduces
the LF dependency for ~5% of hours. Track and report the gap-fill rate.

**UNGAUGED_RATIO concern:** The plan estimates ungauged accretion as
`(monocacy + goose) * 1.50 * UNGAUGED_SCALE`. This assumes the ungauged tributaries
have the same per-unit-area discharge as the gauged tributaries. This is a common
hydrological assumption but it is problematic here because:
- Monocacy and Goose are relatively large tributaries with flashy response.
- The ungauged 6.5% includes Seneca Creek (gauged at USGS 01645000!) and many
  small streams with more baseflow-dominated regimes.
- During baseflow, ungauged streams contribute proportionally MORE per unit area
  than Monocacy (more groundwater-fed); during storms, they contribute LESS.
- A fixed multiplier will underestimate in baseflow and overestimate in storms.

**Recommendation:** Consider using Seneca Creek (USGS 01645000, 101 sq mi) as a
third actual gauge. It is between PoR and LF and is available in real time. This
would reduce the ungauged fraction from 6.5% to 5.6% and provide a better proxy
for remaining ungauged flow.

---

### Approach 3: Regression-Based Ensemble -- KEEP, with discipline

**Strengths:**
- Jointly optimizes all component weights.
- Log-space formulation handles multiplicative error structure.
- May reveal that optimal weights differ substantially from current hard-coded values.

**Concerns:**

1. **Multicollinearity.** `por_lagged`, `ef_cfs`, `monocacy_q`, and `goose_q` are
   all positively correlated with each other and with LF. The regression
   coefficients will be unstable (high variance, sign flips). Ridge regression
   (mentioned) is the correct mitigation, but the plan should also report VIFs
   (Variance Inflation Factors) to quantify the problem.

2. **The plan suggests too many formulations.** Log-linear, weighted least squares,
   and a constrained positive-coefficient variant are all mentioned. This creates
   ambiguity about which regression is being compared. **Pin it down to one:**
   log-linear regression with Ridge penalty and positive-coefficient constraint.
   This is a single, well-defined model.

3. **The log-transformation smearing correction.** When predicting in log-space
   and back-transforming, `exp(E[log(LF)])` underestimates `E[LF]` by a factor
   of approximately `exp(sigma^2 / 2)`. The plan does not mention this. For
   sigma = 0.15 (typical for discharge data), this is a 1.1% bias -- small but
   relevant given the 10% bias we are trying to fix. **Apply the Duan (1983)
   smearing correction or the log-normal adjustment.**

4. **Temporal autocorrelation inflates R^2.** Hourly discharge data has extreme
   autocorrelation (DW = 0.007, per the powerlaw refit audit). A regression
   R^2 of 0.99 is meaningless because the predictors are also autocorrelated.
   LOYO CV partially addresses this but does not fully resolve it because
   year-boundary effects create informational leakage (December 31 predicts
   January 1). **Add a 7-day buffer between training and test periods.**

---

### Approach 4: Combined Ratio + Tributaries -- KEEP, but reconsider necessity

**Strengths:**
- Logical combination of Approaches 1 and 2.
- Recalibrating the ratio table after adding actual tributaries is correct practice.

**Concern: Double-counting risk is more serious than acknowledged.** The ratio
table (Approach 1) absorbs the *total* PoR-to-LF gap, which includes the tributary
contribution. After adding actual tributaries (Approach 2), the residual ratio
should be much smaller (~1.00-1.05 instead of ~1.10). But if the actual tributaries
are poorly calibrated or have timing mismatches, the residual ratio will compensate
for tributary errors -- creating a situation where the ratio and the tributaries
are jointly fitting the same signal. This may look good in-sample but degrade OOS.

**Recommendation:** Compare Approach 4's OOS performance carefully against Approaches
1 and 2 individually. If Approach 4 is not materially better (>2% RMSE improvement),
prefer the simpler approach. The plan already suggests this at line 277 -- good.

---

### Approach 5: Seasonal Bias Correction -- CONSIDER DROPPING

**Strengths:**
- Seasonal variation in baseflow accretion is physically real.
- Could capture patterns that a flow-only correction misses.

**Fatal weakness: 72 parameters from 12 months x 6 flow bins.** Even with 117k
observations, the corner cells are sparse:
- January x 50k+ cfs: likely < 50 observations in 14 years
- August x 20-50k cfs: also sparse (summer is low-flow season)

The plan acknowledges this (line 317) and suggests aggregating to 4 seasons, which
gives 24 parameters. But this is still a lot of degrees of freedom for what is
likely a second-order effect.

**More fundamentally:** if seasonal variation matters, it would show up as
seasonal residual patterns in Approach 1. A better design is to run Approach 1
first, then test whether the residuals have seasonal structure. If they do, add
season as a *refinement* to Approach 1, not as a separate approach.

**Recommendation:** DROP as a standalone approach. Instead, after the horse race,
test whether Approach 1 residuals have seasonal structure. If so, add season to
Approach 1 as an enhancement. This preserves the scientific question while avoiding
a noisy 24-parameter model in the main comparison.

---

### Approach 6: EF-Dominant Model -- KEEP, ELEVATE PRIORITY

**This is the most physically insightful approach in the plan and is underrated.**

**Key insight (correctly identified at line 357):** EF is located downstream of
where Monocacy and Goose Creek join the Potomac. Therefore, EF stage already
reflects the tributary accretion that por_lagged misses. Higher EF weight is not
just "using a different gauge" -- it is using a gauge that physically measures the
water mass that por_lagged cannot see.

**Strengths:**
- No new data sources needed (EF is already in the model).
- No new calibration tables (just optimized weights).
- Addresses the root cause through a physically direct mechanism.
- The EF power law has been extensively validated (R^2 = 0.91 overall, 0.98 cold).

**Concerns:**

1. **EF stage precision at low flows.** EF gage height is measured to 0.01 ft.
   At EF stage = 3.0 ft (low flow), the derivative d(CFS)/d(stage) =
   126 * 2.46 * 3.0^1.46 = 1,304 cfs/ft. A 0.01 ft error = 13 cfs. This is
   negligible (< 0.5% of typical low-flow LF). The plan's concern about EF
   precision is overstated for moderate-to-low flows. **At high flows** (EF =
   15 ft), d(CFS)/d(stage) = 126 * 2.46 * 15^1.46 = 21,600 cfs/ft, so a 0.01 ft
   error = 216 cfs. Still < 0.5% of the ~45,000 cfs flow at that stage. **EF
   precision is not the limiting factor.**

2. **The 6-anchor-weight schedule is over-parameterized.** With 6 weight bins, the
   optimization has 6 free parameters for what is essentially a monotonically
   increasing function from 0 to ~0.75. **Recommendation:** Use a 2-parameter
   logistic function: `ef_weight = w_max / (1 + exp(-k * (por_lagged - midpoint)))`.
   This gives a smooth S-curve with 2-3 parameters (w_max, k, midpoint) instead of
   6, and guarantees monotonicity and smoothness.

3. **The plan should test EF-dominant as a REPLACEMENT for the ratio scaler, not
   just an alternative.** If EF already captures the tributary gap, then a ratio
   scaler on top of high EF weights would double-count the correction. Test
   Approach 6 standalone, and also test Approach 6 + Approach 2 (actual
   tributaries for the remaining PoR component).

**Recommendation:** Move Approach 6 to position #2 in the testing priority.
Use a 2-3 parameter weight function instead of 6 anchors. Test hybrid of
Approach 6 + Approach 2 as a new combined approach.

---

### Approach 7: Quantile Mapping -- KEEP as diagnostic, DEPRIORITIZE

**Strengths:**
- Standard technique in climate science bias correction.
- Corrects the full distribution, not just the mean.
- Non-parametric: makes no assumptions about error distribution.

**Concerns:**

1. **Overfitting risk is high.** Quantile mapping with 6 bins x 20 quantiles =
   120 parameters. Even with 117k observations, the mapping is essentially a
   120-entry lookup table. The smoothness of the mapping depends on having enough
   data in each cell.

2. **The mapping is on the BLENDED estimate, which already uses LF (via the
   ceiling).** The ceiling clips at 120% of LF, so the upper tail of the blended
   distribution is mechanically truncated. The quantile mapping will "correct"
   this truncation by pushing the upper quantiles higher -- but this correction
   is an artifact of the ceiling, not a genuine distributional correction.

3. **Quantile mapping corrects the MARGINAL distribution, not the CONDITIONAL
   distribution.** It makes the histogram of estimates match the histogram of LF,
   but it does not improve the estimate-LF correlation. In other words: it fixes
   calibration but not resolution. For a real-time prediction system, resolution
   (does the estimate track LF's hour-to-hour variations?) matters more than
   calibration (does the distribution match?).

4. **In the limit, quantile mapping degenerates to the LF Floor.** If the model
   estimate is always below LF (which is true 81% of the time for the baseline),
   then the quantile mapping will push the lower quantiles upward toward LF.
   At the median, the corrected estimate will equal LF. This is just a
   distributional version of the floor.

**Recommendation:** Keep as a diagnostic to understand the distributional
properties of the bias, but do not expect it to outperform a well-calibrated
ratio scaler for point prediction. Deprioritize in the execution order.

---

### Approach 8: ML Ensemble (Gradient-Boosted Trees) -- RECOMMEND DROPPING

**Strengths:**
- Provides a theoretical performance ceiling.
- Could reveal nonlinear interactions.

**Concerns:**

1. **The problem is not nonlinear.** The systematic bias is a ~10% multiplicative
   factor that varies slowly with flow. A linear model in log-space (Approach 3)
   should capture this. If a gradient-boosted tree dramatically outperforms the
   linear model, it would suggest nonlinear interactions -- but the physics of
   this system (flow = flow_upstream + tributaries, approximately additive) does
   not support complex nonlinearities.

2. **Temporal autocorrelation is devastating for tree-based models.** With hourly
   data, adjacent observations are nearly identical (autocorrelation > 0.99). A
   tree model will learn to predict each hour from similar hours in the training
   set, which are often just adjacent hours from the SAME event. LOYO CV
   partially addresses this, but year boundaries still leak information.
   **The ML performance ceiling will be inflated** relative to what it can achieve
   in true real-time deployment.

3. **Implementation complexity vs. marginal value.** The plan correctly states
   this is not a production candidate. But it requires `lightgbm` or `xgboost`,
   inner CV for hyperparameters, monotonicity constraints, and significant
   additional compute. For what? To establish a ceiling that is probably 5-10%
   better than Approach 3, confirming what we already suspect -- that the inputs
   limit performance more than the model.

4. **Not reproducible in R without additional libraries.** The CLAUDE.md
   verification protocol requires Python + R cross-validation. LightGBM in R
   requires the `lightgbm` R package, which has non-trivial installation
   requirements. This creates a practical obstacle for the verification protocol.

**Recommendation:** DROP from the horse race. If the user wants a performance
ceiling after the main horse race, run it as a separate follow-up analysis. The
main horse race should focus on approaches that could actually be deployed.

---

## 2. Missing Approaches

### Missing Approach A: EF Power-Law Recalibration (RECOMMENDED TO ADD)

**Core idea:** Instead of correcting the blended estimate after the fact (Approach
1), recalibrate the EF power-law coefficients to directly predict LF rather than
GF. Currently: `ef_cfs = 126 * EF^2.46`. If we fit `lf_hat = a * EF^b` directly
on the training data, the intercept `a` will absorb the systematic bias because
EF captures the full river including tributaries.

**Why this is powerful:**
- It is the simplest possible change: just update two numbers (intercept and exponent).
- It is physically interpretable: the new power law converts EF stage to LF-scale
  discharge, automatically including the tributary contribution.
- It requires NO new data sources.
- With LOYO CV, it has only 2 calibrated parameters.
- Combined with optimized EF weights (Approach 6), this could be the most parsimonious
  winning approach.

**Implementation:**
```
# For each LOYO fold:
#   Fit: log(lf_discharge) = log(a) + b * log(ef_stage) on training data
#   Predict: ef_cfs_new = a * ef_stage^b on test data
#   Blend: blended = (1 - ef_weight) * por_lagged + ef_weight * ef_cfs_new
```

**Risk:** The EF power law was originally calibrated to EF's own rating curve, not
to LF. Recalibrating to predict LF changes its physical meaning. But since we have
no GF gauge, this is pragmatically justified -- we are building a LF predictor.

---

### Missing Approach B: Additive Bias Correction (constant or flow-dependent)

**Core idea:** Instead of multiplicative correction (`por_adjusted = por_lagged * ratio`),
use an additive correction (`por_adjusted = por_lagged + offset`). The offset can
be a constant (1 parameter) or flow-dependent (6 parameters, one per bin).

**Why this matters:** The multiplicative correction assumes the bias scales with
flow. The additive correction assumes the bias is approximately constant at each
flow level. The truth is probably somewhere in between:
- At low flows (< 5k), the bias is ~200-500 cfs (additive, driven by baseflow)
- At high flows (> 20k), the bias is ~10% of flow (multiplicative, driven by
  proportional tributary contribution during storms)

A multiplicative-only correction will overcorrect at low flows and undercorrect
at high flows (or vice versa). Testing additive vs. multiplicative vs. mixed
would reveal the bias structure.

**Recommendation:** This can be folded into Approach 1 as a variant:
- Approach 1a: multiplicative ratio (as planned)
- Approach 1b: additive offset per flow bin
- Approach 1c: mixed (additive for < 5k, multiplicative for >= 5k)

This adds no new approaches to the horse race -- just 3 sub-variants of Approach 1.

---

### Missing Approach C: Seneca Creek Gauge (USGS 01645000)

Seneca Creek is a 101 sq mi tributary entering the Potomac between PoR and LF.
It is available in real time from USGS. The plan does not mention it, even though
it accounts for ~0.9% of LF drainage area.

More importantly: Seneca Creek is a MUCH better proxy for the ungauged streams
than scaling Monocacy/Goose. The ungauged 6.5% of the watershed is mostly small
Piedmont streams similar to Seneca Creek. Using Seneca as a unit-area proxy
(scaling by drainage area ratio) is more defensible than using Monocacy (which
is a larger, less flashy watershed).

**Recommendation:** Add Seneca Creek to the tributary data and use it as the
ungauged proxy. This is a data improvement, not a new approach -- it enhances
Approach 2.

---

## 3. Evaluation Framework Critique

### 3.1 Cross-Validation Design

**LOYO with 14 folds (2012-2025) is appropriate** for this problem. It respects
the temporal structure of the data and prevents look-ahead leakage.

**Concern: Year-boundary contamination.** With hourly data, the last observations
of December 31 (training) are nearly identical to the first observations of
January 1 (test). For approaches with many parameters (Approaches 5, 7), this
creates a subtle form of leakage. **Recommendation:** Add a 48-hour buffer
(exclude the first and last 48 hours of each year from evaluation). This is
low-cost and eliminates the concern.

**Concern: Partial years.** 2011 (December only) and 2026 (January-February)
are included in training only. This is correct. But 2012 (starting January)
and 2025 (ending December) should be handled carefully -- check that no fold
leaks partial-year data into both training and test.

### 3.2 Metrics

**RMSE, MAE, Bias, MdAPE, R^2:** All standard and appropriate.

**Undershoot %:** Useful but requires careful interpretation. A model that
overshoots 80% of the time is not better than one that undershoots 80% of
the time. The target should be 40-60% undershoot (balanced), not 0%.

**Info Content ("% of hours where estimate != LF within 1%"):** This metric is
confusingly defined. The plan says it measures "genuine prediction rate" -- but
none of the proposed approaches produce estimates that equal LF (unlike the
Round 1 floor approaches). The Info Content metric was designed to detect
floor-like behavior, which is not present in Approaches 1-8. For Approaches 1-8,
Info Content will be ~100% by construction (the estimates are computed from PoR/EF,
not from LF). **This metric adds no discriminative power and should be dropped
from the primary comparison.** Keep it only as a sanity check (flag if < 50%).

**Missing metric: Skill Score (SS).** The standard way to compare forecasting
approaches is the Skill Score: `SS = 1 - MSE_model / MSE_reference`. Using
the baseline as the reference, this normalizes improvement to a 0-1 scale:
- SS = 0: no better than baseline
- SS = 0.10: 10% reduction in MSE
- SS < 0: worse than baseline

This is more interpretable than raw RMSE differences because it accounts for
the difficulty of the prediction problem. **Recommendation: Add SS relative to
baseline as a primary metric.**

**Missing metric: Bias by flow bin (as a % of flow).** The plan reports bias
in cfs, but a 500 cfs bias means very different things at 3,000 cfs (17%) vs.
30,000 cfs (1.7%). **Report percentage bias: mean((estimate - LF) / LF * 100)
per flow bin.** This is the most intuitive measure of whether the systematic
underestimate is fixed.

### 3.3 Evaluation Subsets

Five subsets (A-E) with per-flow-bin breakdowns create a huge output table.
With 9 approaches x 5 subsets x 6 bins x 3 states, the output CSV will have
~810 rows. Many of these cells will have too few observations for reliable
estimates (e.g., 50k+ x rising x former_undershoot: probably < 200 obs).

**Recommendation:** Streamline to 3 evaluation scopes:
1. **Overall** (N = 117,704) -- primary comparison
2. **Per flow bin** (6 bins) -- check for flow-dependent degradation
3. **Rising vs. steady** (2 states, drop "falling" which has only 3,047 obs)

Drop Subset B (overshoot hours), Subset C (former undershoot hours), and the
per_bin_state cross. These can be computed post-hoc if the winner is ambiguous,
but they should not be in the primary comparison table.

### 3.4 "Winning" Criteria

**Tier 1 is reasonable** but Info Content > 50% is trivially satisfied by all
proposed approaches (they never simply echo LF). Replace with Skill Score > 0.

**Tier 2 undershoot target (< 60%) is arbitrary.** A well-calibrated model should
have 50% undershoot (symmetric errors). Target 40-60%.

**Automatic disqualification on "OOS RMSE > baseline on ANY flow bin above 5k
cfs" is too strict.** A model could improve overall RMSE by 10% while being 2%
worse in one bin due to noise. **Recommendation:** Disqualify only if OOS RMSE
is > 10% worse than baseline in any bin above 5k cfs.

---

## 4. Data Concerns

### 4.1 Tributary Data File

**CONFIRMED: `analysis/tributary_hourly_data.csv` exists** with 124,430 rows.
It contains columns: `timestamp`, `monocacy_q`, `goose_q`. The file covers the
full 2011-2026 period.

**Coverage note:** 124,430 tributary rows vs. 117,704 backtest rows. The
tributary file has MORE rows (different timestamp coverage). Left-joining on
timestamp will produce NaN for backtest hours with no tributary match. Report
the match rate.

### 4.2 Missing Gauges

The plan does not consider **Seneca Creek** (USGS 01645000), which is:
- Located between PoR and LF
- 101 sq mi drainage area
- Available in real time from USGS
- A better proxy for ungauged Piedmont streams than Monocacy

See recommendation in Section 2, Missing Approach C.

### 4.3 Baseline Discrepancy (CRITICAL)

As noted in Section 1 (Approach 0), the plan describes the baseline as including
tributary estimates (`monocacy_est + goose_est`), but the Round 1 Python script
uses `base_estimate = por_lagged` with no tributaries. This discrepancy must be
resolved before execution. The wrong baseline means wrong improvement estimates
for every approach.

### 4.4 Temperature Data Gaps

`water_temp_c` is NaN for 2011-2020 (~63% of observations). The EF power-law
cold-water correction (`160 * EF^2.36` for temp <= 10C) cannot be applied before
2021. The plan does not address this: should pre-2021 data use the default
power law (126 * EF^2.46) always? Or should a seasonal proxy for temperature be
used? This affects the baseline and all approaches that use `ef_cfs`.

**Recommendation:** For pre-2021 data, use a seasonal temperature proxy:
apply the cold-water power law for December-March (when PoR temp is typically
below 10C) and the default for April-November. This is an approximation but
better than ignoring the cold-water effect for 63% of the dataset. Alternatively,
flag and report whether results differ materially between the 2011-2020 and
2021-2026 subperiods.

---

## 5. Practical Concerns

### 5.1 Script Size and Complexity

9 approaches in a single Python script + R verification will produce scripts
of 600-800 lines each. This is manageable but at the upper limit of
maintainability.

**Recommendation:** If dropping Approaches 5 and 8 (as recommended), the script
shrinks to 7 approaches, which is more tractable.

### 5.2 ML Approach (Approach 8) Complexity

As argued in Section 1, Approach 8 adds significant complexity (LightGBM
dependency, inner CV, hyperparameter tuning) for marginal diagnostic value.
It also creates a verification challenge because LightGBM results are not
perfectly reproducible between Python and R implementations (different
tree-building algorithms, different floating-point paths).

**Recommendation:** Drop Approach 8.

### 5.3 Computational Cost

The plan estimates 10 minutes (Python), 20 minutes (R). This seems optimistic
for 14-fold LOYO CV on 9 approaches with grid search calibration.

More realistic estimate for 7 approaches (dropping 5 and 8):
- Approaches 0, 1, 6: fast (pure vectorized operations), ~30 seconds each x 14 folds
- Approaches 2, 4: grid search for UNGAUGED_SCALE (41 grid points x 14 folds),
  ~2 minutes each
- Approach 3: regression fitting (14 folds), ~1 minute
- Approach 7: quantile mapping construction (14 folds), ~2 minutes
- New Approach A (EF refit): regression (14 folds), ~1 minute

**Total: ~15 minutes Python, ~25 minutes R.** Feasible.

### 5.4 R Verification Parity

Approaches 1, 2, 4, 5, 6 are implementable in base R. Approach 3 requires
`glmnet` or similar for Ridge regression. Approach 7 requires quantile
computation (base R `quantile()` is fine). Approach 8 requires `lightgbm` R
package. Approach A (EF refit) requires `nls()` or simple log-linear regression.

Dropping Approach 8 eliminates the only R dependency concern.

---

## 6. Recommendations Summary

### Approaches to KEEP (6 total):

| Priority | Approach | Rationale |
|----------|----------|-----------|
| 1 | **0: Baseline** | Reference point |
| 2 | **6: EF-Dominant** (modified: 2-3 param logistic weight function) | Most physically motivated; uses gauge that already captures tributaries |
| 3 | **1: PoR Ratio Scaler** (with continuous interpolation, not bins) | Simplest direct fix; test both multiplicative and additive variants |
| 4 | **2: Actual Tributary Addback** (add Seneca Creek if feasible) | Real gauge data; breaks LF circular dependency |
| 5 | **4: Combined Ratio + Tributaries** | Test synergy of 1+2 |
| 6 | **3: Regression Ensemble** (log-linear Ridge, single formulation) | Flexible benchmark; jointly optimizes weights |
| 7 | **A: EF Power-Law Recalibration** (NEW) | 2-parameter refit; simplest possible change |

### Approaches to DROP:

| Approach | Reason |
|----------|--------|
| **5: Seasonal** | Second-order effect; test as post-hoc refinement of winner |
| **8: ML Ensemble** | Not a production candidate; marginal diagnostic value; R verification difficulty |

### Approach to DEPRIORITIZE:

| Approach | Reason |
|----------|--------|
| **7: Quantile Mapping** | Useful diagnostic but unlikely to beat ratio scaler for point prediction |

### Evaluation Framework Changes:

1. **Add Skill Score** (SS = 1 - MSE_model / MSE_baseline) as primary metric
2. **Add percentage bias** per flow bin: mean((estimate - LF) / LF * 100)
3. **Drop Info Content** as a discriminative metric (keep as sanity check only)
4. **Simplify evaluation subsets** to 3: overall, per-bin, rising vs. steady
5. **Add 48-hour buffer** at year boundaries in LOYO CV
6. **Relax disqualification criterion** to > 10% worse in any bin (not any degradation)

### Data Actions:

1. **RESOLVE baseline discrepancy** (does production include tributary estimates?)
2. **Address pre-2021 temperature gaps** (seasonal proxy or subperiod analysis)
3. **Consider adding Seneca Creek** (USGS 01645000) to tributary data
4. **Track and report tributary gap-fill rate** for Approaches 2/4

### Execution Order:

1. Fix baseline definition (critical)
2. Run Approach 6 (EF-Dominant) and Approach A (EF Refit) first -- these are the
   simplest changes and test the most promising physical mechanism
3. Run Approaches 1 and 2 -- the two main correction strategies
4. Run Approach 4 (combined) -- only if 1 and 2 both show improvement
5. Run Approach 3 (regression) -- flexible benchmark
6. Run Approach 7 (quantile mapping) -- diagnostic only, lowest priority

---

## 7. Additional Methodological Notes

### 7.1 The Target Problem

All approaches use LF as the evaluation target, but the app estimates GF. Since
GF > LF (physics: water is lost to diversions and evaporation between GF and LF,
but this is small), the "true" GF discharge is unknown and unobservable. Any
approach that reduces the LF bias to zero will still underestimate GF by the
GF-to-LF loss (probably 1-3%). This is an inherent limitation of the entire
project, not specific to this horse race.

The plan should acknowledge this explicitly: **we are optimizing for LF prediction
accuracy, which is a proxy for GF accuracy but not identical to it.**

### 7.2 The Ceiling Issue

The 120% LF ceiling (`estimate = min(blended, lf * 1.20)`) uses LF as an input.
After bias correction, fewer estimates will hit the ceiling (because the corrected
estimates are higher and closer to LF, so `blended / lf` is closer to 1.0, less
likely to exceed 1.20). This is fine. But the ceiling creates a maximum possible
overshoot of 20%, which constrains the error distribution.

**Consideration:** After bias correction, the ceiling may need recalibration.
If the corrected estimates are centered near LF (rather than 10% below), a 120%
ceiling may be too loose (allows 20% overshoot for a model that is now unbiased).
Consider whether the ceiling parameter should be re-optimized as part of the
horse race, or held fixed at 1.20 for comparability.

**Recommendation:** Hold the ceiling fixed at 1.20 for the horse race (for
comparability), but flag it for re-optimization if the winning approach
substantially changes the error distribution.

### 7.3 What "Winning" Really Means

The horse race evaluates on LF as a target. But the app is meant to inform users
about GF conditions -- specifically, water levels for recreation and safety. The
user experience depends on:
- **Responsiveness** to changing conditions (does the estimate update quickly when
  the river rises?)
- **Never showing physically impossible values** (estimate >= LF)
- **Reasonable precision** (within 10-20% of the true value most of the time)

A model with slightly higher RMSE but better responsiveness to rising rivers
might be better for the user than a model with lower RMSE that lags by 2 hours.
The horse race should include a **rising-river lag analysis**: for the 5 largest
flood events, compare the timing of when each approach's estimate exceeds a
threshold (e.g., 20,000 cfs) vs. when LF exceeds that threshold.

---

*Audit completed 2026-02-20. The plan is well-designed and addresses the right
problem. With the modifications above, the horse race should produce actionable
results for a v30.0 model update.*

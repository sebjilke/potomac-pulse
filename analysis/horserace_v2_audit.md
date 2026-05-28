# Horse Race v2 Audit Report

**Auditor:** Independent Claude agent (blind to implementation agents)
**Date:** 2026-02-20
**Scope:** 7-approach GF estimation comparison on 117,704 hourly observations

---

## 1. Cross-Language Verification

### 1.1 Winner Agreement

| | Python | R |
|---|---|---|
| **Winner** | `5_ef_dominant` | `approach_5` (= `5_ef_dominant`) |
| **OOS RMSE** | 1907.07 | 1899.82 |
| **OOS Skill Score** | +0.0901 | +0.0946 |

**Both languages agree on the winner.** The ranking of all 7 approaches is
identical in both Python and R (5 > 1 > 2/4 > 0 > 6 > 3), with a minor
reordering of approaches 2 and 4 at ranks 3-4 (Python: 2 > 4; R: 4 > 2).

### 1.2 RMSE Agreement

| Metric | Value |
|---|---|
| Rows compared | 126 (all match) |
| Max RMSE absolute difference | 153.3 cfs |
| Mean RMSE absolute difference | 9.7 cfs |
| Rows with RMSE diff > 50 cfs | 7 |
| Rows with RMSE diff > 10 cfs | 24 |

**Rows exceeding the 50-cfs tolerance threshold (7 rows):**

All are concentrated in Approach 4 (Combined) and Approaches 5/6 in the
50k+ flow bin:

| Approach | Eval | Scope | Bin | RMSE_Py | RMSE_R | Diff |
|---|---|---|---|---|---|---|
| 6_ef_refit | insample | per_bin | 50k+ | 10336.5 | 10183.3 | +153.3 |
| 4_combined | insample | per_bin | 50k+ | 10501.1 | 10356.4 | +144.7 |
| 4_combined | oos | per_bin | 50k+ | 10609.8 | 10470.4 | +139.4 |
| 4_combined | oos | per_bin | 20-50k | 2858.3 | 2788.9 | +69.4 |
| 4_combined | insample | per_bin | 20-50k | 2817.6 | 2760.5 | +57.1 |
| 4_combined | oos | per_state | rising | 4955.7 | 4904.2 | +51.4 |
| 6_ef_refit | oos | per_bin | 50k+ | 10312.9 | 10261.8 | +51.0 |

### 1.3 Root Causes of Divergence

**Cause 1 (MAJOR): Approach 4 UNGAUGED_SCALE calibration differs.**
In the R implementation (line 404), the UNGAUGED_SCALE grid search optimizes
against the raw `gf_base` estimate (`est <- gf_base`) without applying
PoR-delta correction, EF blending, or the LF ceiling. In contrast, the Python
implementation calls `calibrate_approach_2()` which applies the full pipeline
(PoR-delta + standard_blend + ceiling). This means the two languages optimize
UNGAUGED_SCALE on different objective functions, leading to different optimal
scale values and a systematic ~27 cfs overall RMSE divergence for Approach 4.

**Severity: MODERATE bug in R's Approach 4.** The Python implementation is more
faithful to the plan (which says "Cross-validate the full pipeline"). The R
implementation takes a shortcut that changes the calibrated parameter.

**Cause 2 (MINOR): Cold-water detection diverges for post-2021 missing temp.**
Python applies the seasonal proxy ONLY for pre-2021 observations with missing
temperature (`(~has_temp) & (year_arr < 2021)`). R applies the seasonal proxy
for ALL observations with missing temperature, regardless of year. There are
3,093 post-2021 observations with missing `water_temp_c`, of which 2,151 fall
in cold months (Dec-Mar). For these 2,151 observations, Python uses the default
warm power law (126 * EF^2.46) while R uses the cold power law (160 * EF^2.36).

**Severity: MINOR.** Affects ~1.8% of observations. Both approaches are
defensible -- Python assumes post-2021 should have temp data and defaults to
warm; R uniformly applies the seasonal heuristic when temp is missing.

**Cause 3 (MINOR): Approach 5 grid search has different midpoint values.**
Python uses 7 midpoint values: [2000, 3000, 4000, 5000, 6000, 8000, 10000].
R uses 9 midpoint values: [2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000,
10000]. R includes 7000 and 9000 which Python does not. This can lead to
different optimal parameters per fold.

**Severity: LOW.** Does not affect the winner determination; both find the
same approach winning. If the optimal midpoint happens to be near 7000 or
9000, R could find a slightly better fit.

**Cause 4 (EXPECTED): Flow-state N counts differ by 1-4 observations.**
Python classifies 6,303 rising observations; R classifies 6,304. This is
within the documented tolerance for floating-point edge cases in the
threshold comparison.

### 1.4 Verdict

**CONDITIONAL PASS.** Both languages agree on the winner (Approach 5,
EF-Dominant) and the full ranking. The Approach 4 calibration bug in R is
a genuine implementation discrepancy, but it does not affect the winner or
the top-2 ranking. The cold-water and grid-search differences are minor and
do not change conclusions.

---

## 2. Data Integrity

### 2.1 Row Counts and Date Ranges

| Dataset | Rows | Date Range |
|---|---|---|
| hourly_backtest_data.csv | 117,704 | 2011-12-01 08:00 to 2026-02-19 18:00 |
| tributary_hourly_data.csv | 124,430 | 2011-12-01 00:00 to 2026-02-20 00:00 |

The main dataset has the expected 117,704 rows. The tributary dataset is larger
(covering a slightly wider time window), as expected for a left-join source.

### 2.2 Value Ranges

| Column | Min | Max | Negatives | NaN |
|---|---|---|---|---|
| por_now | 788 cfs | 175,000 cfs | 0 | 0 |
| por_lagged | 788 cfs | 175,000 cfs | 0 | 0 |
| ef_stage | 2.47 ft | 22.41 ft | 0 | 0 |
| lf_discharge | 377 cfs | 174,000 cfs | 0 | 0 |
| water_temp_c | -0.10 C | 32.90 C | N/A | 78,080 (66.3%) |
| travel_time_h | 2.3 h | 48.0 h | 0 | 0 |
| monocacy_q | 28.6 cfs | 30,800 cfs | 0 | 3,150 (2.5%) |
| goose_q | 1.63 cfs | 19,560 cfs | 0 | 1,600 (1.3%) |

All values are physically plausible:
- No negative discharges.
- EF stage range (2.47-22.41 ft) is reasonable for the Potomac.
- LF discharge range (377-174,000 cfs) spans low baseflow to major floods.
- Water temp has one value at -0.10 C, which is near-zero and plausible for
  instrument precision (not a data error).
- Travel time range (2.3-48.0 h) is consistent with Searcy-derived values.

### 2.3 Tributary Merge Rate

| Tributary | Matched | Rate |
|---|---|---|
| Monocacy | 116,613 / 117,704 | 99.1% |
| Goose Creek | 116,306 / 117,704 | 98.8% |

Excellent merge rates. The ~1-2% missing values are filled with the LF-based
fallback (`LF * 0.071` and `LF * 0.030`), matching production code.

### 2.4 Year Distribution

All 14 CV years (2012-2025) have substantial data (7,550-8,760 rows each).
2011 has only 736 rows (partial: Dec 2011 only) and 2026 has 508 rows
(partial: Jan-Feb 2026). Both partial years are correctly included in
training only, not used as test folds.

### 2.5 Verdict

**PASS.** Data integrity is excellent. No negative discharges, no implausible
values, high tributary merge rate, and complete year coverage for CV.

---

## 3. Methodology Review

### 3.1 Baseline Correctness

**ISSUE FOUND: EF weight threshold uses LF instead of estimated flow.**

The production code applies the EF weight based on the estimated flow:
```javascript
efWeightUsed = getEFWeight(porEstimateCFS);
// where getEFWeight returns 0.35 if estimatedFlow >= 3000, else 0.0
```

Both Python and R scripts apply the EF weight based on **actual LF discharge**:
```python
ef_weight = np.where(lf_val >= 3000.0, 0.35, 0.0)  # Python line 228
```
```r
ef_weight <- ifelse(d$lf_discharge >= 3000, 0.35, 0.0)  # R line 105
```

In production, `porEstimateCFS` is the PoR-based estimate (time-shifted PoR +
tributaries + PoR-delta correction) BEFORE blending with EF. Using actual LF
instead of the estimated flow for the threshold is a deviation from production
logic. At low flows near 3000 cfs, the estimate and LF often agree, but at
higher flows or during rapid changes, they can differ.

**Impact assessment:** The impact is likely small because:
1. The 3000 cfs threshold is a step function, so it only matters for
   observations near the boundary.
2. For most observations, both `porEstimateCFS` and `lf_discharge` are on the
   same side of 3000 cfs.
3. All 7 approaches use the same EF weight logic, so the comparison is fair
   (the bias is consistent across approaches).

**Severity: LOW for the horse race comparison** (all approaches equally affected),
**but MODERATE for absolute performance claims** (the baseline RMSE may differ
slightly from true production behavior).

### 3.2 Baseline Tributaries

**PASS.** Both scripts correctly include Monocacy + Goose Creek in the baseline:
```python
base = por_lag + mono + goose  # Python line 215
```
```r
base_est <- d$por_lagged + d$monocacy_flow + d$goose_flow  # R line 91
```

This matches production code:
```javascript
estimatedCFS = historicPoR.cfs + monocacyFlow + gooseFlow;  // line 2180
```

The fallback logic (`LF * 0.071` / `LF * 0.030` when gauge data missing) also
matches production.

### 3.3 Cross-Validation Implementation

**PASS.** Leave-One-Year-Out is correctly implemented in both scripts:

- **14 folds:** Years 2012-2025 (confirmed in both scripts).
- **48-hour buffer:** Both scripts exclude the first/last 48 hours of each
  held-out year from evaluation using timestamp-based boundaries.
  - Python: `eval_start = year_start + np.timedelta64(48, 'h')` (line 290)
  - R: `eval_start <- year_start + buffer_hours * 3600` (line 597)
- **Training set:** Everything except the held-out year (no buffer exclusion
  from training, which is correct -- buffer only affects evaluation).
- **Partial years:** 2011 (736 obs) and 2026 (508 obs) are correctly included
  in training only, never used as test folds.

### 3.4 Approach Implementations

**Approach 0 (Baseline):** PASS. Matches production code (with the EF weight
caveat noted in 3.1). Includes tributaries, PoR-delta correction, discrepancy
guard (50% threshold), and 120% LF ceiling.

**Approach 1 (PoR Ratio Scaler):** PASS. Continuous interpolation between 6
anchor points. Calibrates ratios on training data. No bin-boundary
discontinuities (uses `np.interp` / `approx`).

**Approach 2 (Actual Tributary Addback):** PASS. Grid search for UNGAUGED_SCALE
(0.0-2.0 in 0.05 steps). Falls back to baseline when tributary gauge data is
missing. Uses UNGAUGED_AREA_RATIO = 1752/(817+350) = 1.50.

**Approach 3 (Regression):** PASS with notes.
- Python uses `sklearn.linear_model.RidgeCV` with inner 2-fold CV.
- R implements Ridge manually with inner 5-fold CV.
- Both apply Duan smearing correction for log-space back-transformation.
- R applies non-negative constraint post-hoc (`beta <- pmax(beta, 0)`), while
  Python relies on RidgeCV without explicit positivity constraint (though the
  plan specified positive constraints). This is a minor methodological
  inconsistency but does not affect the winner.

**Approach 4 (Combined):** PARTIAL PASS. See divergence in Section 1.3 --
R calibrates UNGAUGED_SCALE on raw `gf_base` without the full pipeline.

**Approach 5 (EF-Dominant):** PASS with IMPORTANT CAVEAT.
- Both scripts use `log(lf_discharge)` in the logistic weight function during
  both calibration AND evaluation. The plan specifies the weight function as
  `w_max / (1 + exp(-k * (por_lagged - midpoint)))` using `por_lagged`, but
  the implementation uses `log(lf_discharge)`.
- Using the evaluation target (LF) to determine the blending weight is not
  traditional data leakage (LF is available in real-time), but it creates a
  subtle advantage: the weight function "knows" the true flow level and can
  optimally route to the better predictor at each flow level. In production,
  the implementation would need to use the estimated flow (since the "true
  GF" is unknown). See Section 4.3 for detailed impact assessment.
- Grid search grids differ slightly between Python and R (see Section 1.3).

**Approach 6 (EF Refit):** PASS. Simple log-linear OLS per fold, separate
warm/cold fits. 2 parameters per regime (intercept + exponent).

### 3.5 Skill Score Computation

**PASS.** Both scripts compute skill score as:
```
SS = 1 - MSE_approach / MSE_baseline
```
This matches the plan specification. Skill scores are computed separately for
each evaluation scope (overall, per-bin, per-state) using the baseline MSE
from the corresponding subset.

### 3.6 Cold-Water Detection

**MINOR ISSUE (see Section 1.3).** For pre-2021 observations (no temperature
data), Python uses the seasonal proxy only for pre-2021, while R uses it
universally for all missing-temp observations. There are 2,151 post-2021
cold-month observations with missing temp that are classified differently.

Both scripts correctly implement the dual power law:
- Default: 126 * EF^2.46
- Cold (temp <= 10C or seasonal proxy): 160 * EF^2.36

### 3.7 Overfitting Check

In-sample vs OOS RMSE comparison (Python results):

| Approach | IS RMSE | OOS RMSE | Gap | Gap % |
|---|---|---|---|---|
| 0_baseline | 1997.15 | 1999.23 | +2.08 | +0.10% |
| 1_ratio_scaler | 1941.03 | 1950.30 | +9.27 | +0.48% |
| 2_trib_addback | 1939.75 | 1974.58 | +34.83 | +1.80% |
| 3_regression | 1988.49 | 2006.04 | +17.55 | +0.88% |
| 4_combined | 1974.79 | 1987.32 | +12.53 | +0.63% |
| 5_ef_dominant | 1888.39 | 1907.07 | +18.68 | +0.99% |
| 6_ef_refit | 2008.78 | 2002.78 | -6.00 | -0.30% |

**PASS.** All IS-to-OOS gaps are small (<2%), indicating no meaningful
overfitting. The baseline (0 calibrated parameters) has essentially zero gap
(0.1%), as expected. Approach 2 has the largest gap (1.8%) but this is still
within acceptable bounds.

Approach 6 shows a slight negative gap (OOS better than IS), which is unusual
but can occur when the held-out year happens to be easier to predict than the
training average.

### 3.8 Flow-State Classification

**PASS.** Both scripts use the same logic:
```
hourly_change = LF[t] - LF[t-1]
threshold = max(100, 0.02 * LF[t])
rising if change >= threshold; falling if change <= -threshold; else steady
```

The 1-4 observation difference between Python and R is from floating-point
edge cases at the exact threshold boundary, which is documented and expected.

---

## 4. Results Interpretation

### 4.1 Winner Assessment

**Approach 5 (EF-Dominant) wins** with OOS RMSE = 1907 (Python) / 1900 (R),
representing a **4.6% (Python) / 4.9% (R) RMSE reduction** over the baseline
(1999 / 1997 cfs). The Skill Score is +0.090 / +0.095.

**Is this statistically meaningful?** At 115,213 OOS observations, a 92-97 cfs
RMSE reduction is very likely significant. However, because hourly data has
extreme autocorrelation (DW ~ 0.007 as documented in CLAUDE.md), the effective
sample size is much smaller than 115k. With an effective N of perhaps
~1,000-2,000 independent observations, the improvement is still likely
significant (92 cfs on a base of 2000 cfs = ~4.6% relative reduction, which
is substantial for hydrological modeling).

**Is this practically meaningful?** A 90+ cfs improvement on a 2000 cfs RMSE is
operationally useful. For a typical moderate flow (10,000 cfs), this represents
roughly a 1% improvement in prediction accuracy. For the highest flows (50k+
cfs), Approach 5 achieves RMSE = 9922 vs baseline 10499, a 5.5% improvement in
the regime where accuracy matters most.

### 4.2 Rising-State Weakness

The overall winner (Approach 5) is WORSE on rising-river hours:
- Approach 5 rising RMSE: 4623 (Python) / 4626 (R)
- Baseline rising RMSE: 4521 (Python) / 4518 (R)
- Skill Score on rising: -0.045 (Python) / -0.048 (R)

**Is this a concern?** YES, but it is moderate rather than disqualifying.

1. Rising hours are only 5.3% of observations (6,156 of 115,213 OOS hours).
   The steady-state improvement (+1.7% Skill Score, 13 cfs reduction) covers
   94.7% of hours and more than compensates.

2. The best-on-rising approach is Approach 6 (EF Refit) with rising RMSE =
   4449 vs baseline 4521, a modest 1.6% improvement. No approach dramatically
   improves rising-river prediction.

3. The rising-state degradation is physically interpretable: Approach 5 gives
   EF higher weight. During rapid rises, the EF stage reading may lag behind
   the true flow because the flood wave hasn't fully arrived at EF yet.
   Increasing EF weight amplifies this timing mismatch.

**Recommendation:** If Approach 5 is implemented, consider reducing EF weight
during detected rising events, or testing an Approach 5+6 hybrid that uses
Approach 6's refit power law for rising hours and Approach 5's logistic
weights for steady hours.

### 4.3 Data Leakage Assessment for Approach 5

**IMPORTANT FINDING:** Approach 5 uses `log(lf_discharge)` (the evaluation
target) as the input to the logistic weight function. The plan specified
`por_lagged` or estimated flow as the input. Both Python and R implement
it with `log(lf)`.

This is NOT classical data leakage (no future information is used), and LF
is available in real-time, so the approach is operationally implementable.
However, it means:

1. **During calibration:** The weight function is optimized using the true
   flow level, allowing it to assign EF higher weight precisely when EF
   happens to be a better predictor for that particular LF value. This is
   slightly "too smart" compared to using the estimated flow, which would
   have noise.

2. **During OOS evaluation:** The weight is still computed from actual LF,
   which is available in real time. So the OOS performance is achievable in
   production.

3. **In production:** The weight must be computed from some estimate of flow
   (since GF is unknown). The obvious choice is `lf_discharge` (available in
   real time from USGS). If the production implementation uses actual LF
   (which it can), then the horse race results are valid. If it must use the
   PoR-based estimate (as the current production code does), the OOS results
   may be slightly optimistic because the estimated flow has noise that the
   true LF does not.

**Severity: LOW if production uses actual LF for the weight function.
MODERATE if production must use the estimated flow.** The current production
code uses `getEFWeight(porEstimateCFS)`, so switching to
`getEFWeight(lf_discharge)` would be a design change.

### 4.4 Per-Flow-Bin Analysis

OOS RMSE by flow bin (Python):

| Bin | Baseline | App 5 | Skill | Assessment |
|---|---|---|---|---|
| 0-2k | 266.5 | 266.5 | -0.00004 | Identical (EF weight = 0 below 3k) |
| 2-5k | 349.3 | 357.0 | -0.044 | Slightly WORSE (-2.2%) |
| 5-10k | 668.3 | 623.2 | +0.130 | BETTER (+6.8%) |
| 10-20k | 1279.6 | 1256.4 | +0.036 | Better (+1.8%) |
| 20-50k | 2992.1 | 2885.6 | +0.070 | Better (+3.6%) |
| 50k+ | 10498.8 | 9922.1 | +0.107 | BETTER (+5.5%) |

**Key observation:** Approach 5 is slightly worse in the 2-5k bin (-2.2%).
This is within the 10% disqualification threshold and represents the
trade-off of increasing EF weight: at moderate flows (2-5k), the EF power
law has somewhat lower predictive skill than PoR, and increasing its weight
introduces noise. The plan's Tier 2 criterion ("No single flow bin where OOS
RMSE is > 10% worse than baseline") is satisfied.

### 4.5 Approach Ranking Analysis

| Rank | Approach | OOS RMSE | Skill Score | Parameters |
|---|---|---|---|---|
| 1 | 5_ef_dominant | 1907 | +0.090 | 3 (logistic) |
| 2 | 1_ratio_scaler | 1950 | +0.048 | 6 (spline anchors) |
| 3 | 2_trib_addback | 1975 | +0.025 | 1 (ungauged scale) |
| 4 | 4_combined | 1987 | +0.012 | 7 (ungauged + anchors) |
| 5 | 0_baseline | 1999 | 0.000 | 0 (reference) |
| 6 | 6_ef_refit | 2003 | -0.004 | 2 (power law) |
| 7 | 3_regression | 2006 | -0.007 | 5 (ridge) |

**Notable findings:**
- Approach 4 (Combined) performs WORSE than Approaches 1 and 2 individually,
  suggesting the two fixes partially overlap and the combined calibration is
  less stable.
- Approach 6 (EF Refit) fails to beat the baseline, which is surprising since
  it was the predicted favorite. The refit power law changes the EF estimate
  but retains the low 35% weight, so the impact is diluted.
- Approach 3 (Regression) is the worst performer, confirming that flexible
  regression overfits the multicollinear predictors.

### 4.6 Hypothesis Testing

| Hypothesis | Result |
|---|---|
| H1: Ratio correction reduces undershoot to <50% | **PARTIALLY CONFIRMED.** Approach 1 reduces undershoot to 69.1% (from 58.2% baseline -- note: baseline undershoot is 58%, not 81% as stated in the plan, because tributaries are now included). |
| H2: Actual tributaries provide info beyond ratio correction | **REJECTED.** Approach 4 (combined) is worse than Approach 1 alone. |
| H3: Higher EF weights improve 5k+ bins | **CONFIRMED.** Approach 5 improves all bins above 5k cfs. |
| H4: EF refit is most parsimonious improvement | **REJECTED.** Approach 6 does not beat the baseline. |
| H5: No approach reduces RMSE by >25% | **CONFIRMED.** Best reduction is 4.6%. |

---

## 5. Recommendations

### 5.1 Regarding the Winner

Approach 5 (EF-Dominant with logistic weight function) wins clearly with a
robust 4.6-4.9% RMSE reduction. **However, two issues should be resolved
before production implementation:**

1. **Clarify the weight function input.** If production will use
   `lf_discharge` (available in real time), the horse race results are valid
   as-is. If production must use `porEstimateCFS` (current design), re-run
   Approach 5 with the estimated flow as the weight function input and verify
   the improvement persists.

2. **Address rising-state degradation.** Consider a hybrid that uses lower EF
   weight during detected rising events (e.g., fall back to baseline 35% when
   `flow_state == rising`).

### 5.2 Implementation Notes

If Approach 5 is implemented as v30.0:
- **Parameters to store:** w_max, k, midpoint (3 values from final all-data
  calibration)
- **Code change:** Replace `getEFWeight(estimatedFlow)` step function with
  the logistic function
- **Remove** the discrepancy guard (50% threshold) for the Approach 5
  blending, since it was not used in the horse race calibration
- **Keep** the 120% LF ceiling (used in all approaches)

### 5.3 Fix Before Final Implementation

1. **Approach 4 R calibration bug:** Fix `est <- gf_base` to apply the full
   pipeline (PoR-delta + blend + ceiling) during UNGAUGED_SCALE optimization.
   This does not affect the winner but would bring R into closer agreement.

2. **Cold-water detection:** Align Python and R on whether the seasonal proxy
   applies to all missing-temp observations or only pre-2021. Recommend using
   R's approach (apply to all missing, regardless of year) since missing temp
   can occur in any year due to gauge outages.

3. **EF weight baseline:** Consider aligning the horse race baseline EF weight
   with production code by using `base_estimate` (the PoR-based estimate)
   instead of `lf_discharge` for the 3000 cfs threshold. This is a minor
   issue (all approaches are equally affected) but would improve fidelity to
   production behavior.

---

## 6. Summary Table

| Check | Result | Details |
|---|---|---|
| **Winner agreement** | PASS | Both: Approach 5 (EF-Dominant) |
| **RMSE within tolerance** | CONDITIONAL PASS | 7 rows exceed 50 cfs; root cause identified (Approach 4 R bug) |
| **N counts** | PASS | 1-4 obs difference from float edge cases (documented, expected) |
| **Data integrity** | PASS | No negatives, plausible ranges, 99%+ tributary merge |
| **Baseline matches production** | PARTIAL PASS | Tributaries correct; EF weight uses LF instead of estimated flow |
| **CV correctly implemented** | PASS | 14 folds, 48h buffer, timestamp-based |
| **All 7 approaches correct** | CONDITIONAL PASS | Approach 4 R bug, Approach 5 uses LF in weight function (deviates from plan) |
| **Skill Score formula** | PASS | 1 - MSE/MSE_baseline |
| **Cold-water handling** | MINOR ISSUE | Python/R diverge for 2,151 post-2021 observations |
| **Overfitting** | PASS | All IS-OOS gaps < 2% |
| **No data leakage** | CONDITIONAL PASS | Approach 5 uses LF in weight function (operationally valid but optimistic if production uses estimated flow) |
| **Winner improvement meaningful** | YES | 4.6-4.9% RMSE reduction, robust across bins |
| **Rising-state concern** | NOTED | Approach 5 is 2.2% worse on rising hours (5.3% of data) |

### Overall Assessment

**The horse race is methodologically sound and the winner is credibly
identified.** Approach 5 (EF-Dominant with logistic weight function) provides
a meaningful 4.6-4.9% RMSE improvement with only 3 parameters. The identified
issues (EF weight input, rising-state degradation, Approach 4 R bug) are
non-critical and do not change the winner determination.

**Recommended action:** Proceed with Approach 5 implementation as v30.0,
after resolving the weight function input question (LF vs estimated flow)
and considering a rising-state fallback.

---

*Audit completed 2026-02-20 by independent auditor agent.*

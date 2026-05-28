# Hourly Gradient Weight Optimization -- Independent Audit Report

**Auditor**: Independent Claude agent
**Date**: 2026-02-19
**Subject**: Audit of hourly EF gradient weight optimization (Python + R)
**Verdict**: Code is correct. Data is verified. But the proposed weights are **suboptimal due to a binding constraint**, and the improvement is modest enough to warrant caution.

---

## 1. Data Integrity

### 1.1 Dataset Overview

| Property | Value |
|---|---|
| File | `hourly_backtest_data.csv` |
| Rows | 42,838 |
| Columns | `timestamp, por_now, por_lagged, ef_stage, lf_discharge, water_temp_c, travel_time_h` |
| Date range | 2021-01-01 09:00 to 2026-02-19 11:00 |
| Null key columns | 0 (por_now, por_lagged, ef_stage, lf_discharge all complete) |
| water_temp_c nulls | 3,084 / 42,838 (7.2%) -- acceptable, cold-water model falls back to default |
| Zeros in key columns | 0 |
| Negatives in key columns | 0 |
| Rows filtered out by optimizer | 0 (all rows pass >0 filters) |

**Result**: PASS. All key columns are complete with no zeros or negatives.

### 1.2 Value Ranges

| Column | Min | Max | Mean | Plausible? |
|---|---|---|---|---|
| por_now (cfs) | 529 | 207,000 | 7,718 | Yes -- Potomac at PoR |
| por_lagged (cfs) | 522 | 207,000 | 7,730 | Yes -- similar magnitude to por_now |
| ef_stage (ft) | 2.47 | 21.24 | 5.14 | Yes -- EF gage height |
| lf_discharge (cfs) | 377 | 156,000 | 8,625 | Yes -- LF discharge |
| water_temp_c | -0.1 | 32.9 | 14.5 | Yes -- note -0.1 is sensor noise near freezing |
| travel_time_h | 2.5 | 48.0 | 21.0 | Yes -- PoR-to-LF travel time |

**Result**: PASS. All values physically plausible.

### 1.3 USGS API Spot-Checks (5 rows)

| Timestamp | Variable | CSV | USGS API | Diff | Status |
|---|---|---|---|---|---|
| 2021-01-01 09:00 | PoR discharge | 14,300 | 14,400 | 0.7% | MATCH |
| 2021-01-01 09:00 | EF stage | 6.96 | 6.97 | 0.1% | MATCH |
| 2021-01-01 09:00 | LF discharge | 16,700 | 16,800 | 0.6% | MATCH |
| 2022-03-30 03:00 | PoR discharge | 6,990 | 6,990 | 0.0% | MATCH |
| 2022-03-30 03:00 | EF stage | 5.17 | 5.17 | 0.0% | MATCH |
| 2022-03-30 03:00 | LF discharge | 8,065 | 8,110 | 0.6% | MATCH |
| 2023-06-24 19:00 | PoR discharge | 2,900 | 2,900 | 0.0% | MATCH |
| 2023-06-24 19:00 | EF stage | 3.46 | 3.46 | 0.0% | MATCH |
| 2023-06-24 19:00 | LF discharge | 3,160 | 3,160 | 0.0% | MATCH |
| 2024-10-17 00:00 | PoR discharge | 2,980 | 2,980 | 0.0% | MATCH |
| 2024-10-17 00:00 | EF stage | 3.69 | 3.69 | 0.0% | MATCH |
| 2024-10-17 00:00 | LF discharge | 3,255 | 3,280 | 0.8% | MATCH |
| 2026-02-19 11:00 | PoR discharge | 11,500 | 11,500 | 0.0% | MATCH |
| 2026-02-19 11:00 | EF stage | 6.09 | 6.07 | 0.3% | MATCH |
| 2026-02-19 11:00 | LF discharge | 9,590 | 9,500 | 0.9% | MATCH |

All 15 checks match within <1%. Small discrepancies (<100 cfs) are likely due to USGS provisional data revisions or rounding in the 15-minute to hourly aggregation.

**Result**: PASS.

### 1.4 Travel-Time Shift Verification

Verified that `por_lagged` is indeed `por_now` from `travel_time_h` hours ago by looking up the closest timestamp:

| Row | Shift (h) | por_lagged | por_now@shifted_ts | Diff (cfs) |
|---|---|---|---|---|
| 100 | 6.5 | 26,895 | 27,000 | 105 |
| 1000 | 14.6 | 6,410 | 6,410 | 0 |
| 5000 | 34.4 | 1,820 | 1,820 | 0 |
| 20000 | 21.5 | 3,793 | 3,800 | 7 |
| 40000 | 35.7 | 1,767 | 1,750 | 17 |

Small residuals (7-105 cfs) are from sub-hourly interpolation -- the shifted timestamp doesn't always land exactly on an hour boundary. This is correct behavior.

**Result**: PASS.

### 1.5 Minor Issues

- **4 duplicate timestamps**: All occur on November first-Sundays at 01:00 (2021, 2022, 2024, 2025) -- daylight saving time fall-back artifacts. Impact: 8 rows / 42,838 = 0.02%. Negligible but could be deduplicated for cleanliness.
- **236 gaps > 2 hours**: Largest gap is 20 days 19 hours. These are periods of missing USGS data. Not a problem for the optimization since each row is treated independently.

---

## 2. Methodology Review

### 2.1 Python Script (`optimize_gradient_weights_hourly.py`)

**Piecewise-linear interpolation**: Correct. Uses `np.interp()` which handles edge clamping automatically. The scalar version (used in regime breakdown) is also correctly implemented with `np.searchsorted`.

**EF power-law model**: Correct.
- Default: `126 * ef_stage^2.46`
- Cold (water_temp_c <= 10): `160 * ef_stage^2.36`
- Cold-water threshold applied only when temp data is available (`notna()` check present).

**RMSE calculation**: Correct. `sqrt(mean((estimated - actual)^2))`.

**Coordinate descent**: Correct implementation.
- Coarse: 5 passes, step 0.05, range [0.0, 0.80]
- Fine: 3 passes, step 0.01, +/- 0.05 radius
- Each anchor is optimized while holding others fixed
- Monotonicity enforced after each candidate trial and after each anchor update

**Monotonicity enforcement**: Correct -- forward sweep ensures `w[i] >= w[i-1]`.

**No off-by-one errors found.**

### 2.2 R Script (`optimize_gradient_weights_hourly.R`)

**Piecewise-linear interpolation**: Correct. Manual loop implementation matches Python's `np.interp()`.

**EF power-law model**: Correct. Same formulas.

**RMSE calculation**: Correct.

**Coordinate descent**: Correct, with one notable difference from Python:
- R enforces monotonicity **bidirectionally** (both forward and backward sweeps), while Python only enforces forward (`w[i] >= w[i-1]`).
- This difference is actually inconsequential here because the optimal weights are a flat 0.4 everywhere above 3k, so both directions produce the same result. However, if the optimal weights had a non-flat shape, the bidirectional enforcement in R could produce different intermediate states. This is a **minor code inconsistency** that happens not to affect results.

**Result**: Both scripts are methodologically correct. Minor inconsistency in monotonicity enforcement direction (R is more conservative, Python only enforces non-decreasing). No bugs found.

---

## 3. Cross-Verification

### 3.1 Output CSV Comparison

| Anchor Flow | Python | R | Match? |
|---|---|---|---|
| 0 | 0.0 | 0.0 | Yes |
| 3,000 | 0.4 | 0.4 | Yes |
| 6,000 | 0.4 | 0.4 | Yes |
| 10,000 | 0.4 | 0.4 | Yes |
| 15,000 | 0.4 | 0.4 | Yes |
| 25,000 | 0.4 | 0.4 | Yes |
| 50,000 | 0.4 | 0.4 | Yes |

**Result**: PASS. Outputs are identical.

### 3.2 RMSE Match

Both scripts report:
- Current weights RMSE on hourly data: ~1,757 cfs
- New weights RMSE: ~1,702 cfs
- Improvement: ~55 cfs (3.1%)

**Result**: PASS.

---

## 4. Estimation Strategy Concerns

### 4.1 CRITICAL FINDING: The Optimizer Hit a Binding Constraint

**The proposed 0.4 at 3k cfs is NOT the true optimum. It is the monotonicity-constrained optimum.**

The coordinate descent enforces `w_3k <= w_6k`. Since `w_6k` converges to 0.4 (its starting value, constrained by the higher anchors), the 3k weight is capped at 0.4. My sensitivity analysis shows:

- With 6k fixed at 0.4: the 3k weight surface is very flat from 0.35-0.55 (RMSE varies by only 1 cfs).
- If the monotonicity constraint is relaxed on 6k: the unconstrained optimum is **w_3k=0.4, w_6k=0.8, w_10k=0.7** with RMSE=**1,665 cfs** (vs proposed 1,702).
- The proposed weights leave **37 cfs of RMSE improvement on the table** compared to the unconstrained optimum within the same search space.

This means the "flat 40%" result is partly an artifact of the constraint structure. The true RMSE surface wants higher weights in the 6k-10k range than 0.4, but the optimizer was initialized at 0.4 for those anchors and never explored above because the coarse grid starts from current weights and is constrained by the 0.80 ceiling combined with monotonicity.

**Recommendation**: Before adopting the hourly result, run the optimizer without initializing from current weights -- try initializing from all-zeros or from the unconstrained optimum. The 6k and 10k anchors may want to be higher than 0.4.

### 4.2 The 3.1% Improvement Is Modest

- Overall RMSE drops from 1,757 to 1,702 cfs (55 cfs, 3.1%)
- By year, the improvement is **inconsistent**: 2023 benefits hugely (+13.8%), but 2025 actually gets slightly worse (-0.1%)
- Leave-one-year-out cross-validation shows the optimal 3k weight varies between 0.65 and 0.80 across holdout years -- far above the constrained optimum of 0.40
- The 2025 holdout year actually performs **worse** with optimized weights (RMSE +31 cfs worse)

This suggests the hourly optimization is partially overfitting to the 2023 water year (a low-flow year where EF provided more useful information). The improvement is not robust across all years.

### 4.3 Why Hourly and Daily Optimizations Differ

The daily optimization found a gradual ramp (0.0 at 3k, 0.1 at 6k, 0.4 at 10k). The hourly optimization finds a step function (0.0 at 0, 0.4 at 3k+). The key differences:

1. **Different PoR proxy**: Daily uses lag-1 actual LF as the PoR proxy; hourly uses actual travel-time-shifted PoR. The hourly proxy is nosier (includes sub-daily fluctuations) but more realistic.
2. **Sample size**: 42,838 hourly vs 5,208 daily. More data means the optimizer can detect smaller effects, but also means the RMSE is dominated by the most common flow regime (<3k cfs, which is 32.5% of hourly data).
3. **Autocorrelation**: Hourly data has extreme temporal autocorrelation (consecutive hours are nearly identical). The effective sample size is much smaller than 42,838. This inflates confidence in small improvements.

### 4.4 Low-Flow Risk Assessment

The new weights increase EF influence in the 3k-6k cfs range from near-zero to 40%. My analysis shows:

| Metric | Weight=0.0 (current) | Weight=0.1 (current 6k) | Weight=0.4 (proposed) |
|---|---|---|---|
| RMSE at 3-6k cfs | 1,175 | 1,128 | 1,037 |
| EF-only RMSE | 1,111 | -- | -- |
| EF correlation with LF | 0.79 | -- | -- |

At 3-6k cfs, blending at 0.4 genuinely helps (RMSE drops from 1,175 to 1,037). The EF power-law has reasonable correlation (0.79) in this range. However:

- At **<3k cfs**, EF correlation drops to 0.45 and the optimal blend is ~0.2 (not 0.0 as proposed, but also not 0.4). The optimizer correctly keeps w=0.0 at the 0 cfs anchor.
- At <3k cfs, w=0.4 would **increase** RMSE from 550 to 552 cfs. The optimizer's result is correct in not increasing weight here.

### 4.5 Rising Event Performance

The user cares most about rising events. Results:

| Regime | N rising events | Current RMSE | New RMSE | Improvement |
|---|---|---|---|---|
| <3k | 45 | 2,379 | 2,228 | +151 |
| 3-6k | 97 | 6,018 | 5,152 | **+866** |
| 6-15k | 161 | 4,947 | 4,446 | **+501** |
| 15-50k | 470 | 5,496 | 5,496 | 0 |
| **Overall** | **915** | **8,242** | **8,127** | **+115 (1.4%)** |

The new weights improve rising-event accuracy, especially in the 3-6k range (+866 cfs improvement, where the weight change is largest). This is a meaningful and targeted improvement for the use case.

### 4.6 Search Space Concerns

- **W_MAX = 0.80**: The flat-weight sensitivity test shows RMSE increases monotonically above w=0.4 for flat configurations. However, the unconstrained search finds w_6k=0.8 at the ceiling, meaning the 0.80 cap may be binding for individual anchors even if not for flat profiles.
- **Anchor placement**: The anchors at [0, 3k, 6k, 10k, 15k, 25k, 50k] create coarse resolution in the critical 0-6k range where 58% of observations fall. Finer anchor spacing at low flows could improve results.

### 4.7 Bias

Both weight configurations show persistent negative bias (underestimation):
- Current: -581 cfs mean bias
- New: -555 cfs mean bias (slightly improved)

The bias is concentrated in the 6-10k and 10-50k ranges (~-1,100 cfs). This is a model structural issue unrelated to the weight optimization.

---

## 5. Summary of Findings

### Things that check out:
1. Data integrity is excellent -- all 15 USGS spot-checks match within 1%
2. Travel-time shift is correctly computed
3. Both Python and R scripts are methodologically correct
4. Python and R produce identical outputs
5. EF power-law and cold-water model are correctly applied
6. The 3-6k cfs range does benefit from increased EF weight
7. Rising events see genuine improvement

### Concerns and issues:

| # | Severity | Finding |
|---|---|---|
| 1 | **HIGH** | **Binding constraint masks true optimum.** The monotonicity constraint caps w_3k at 0.4 because w_6k=0.4. Unconstrained search finds RMSE=1,665 (37 cfs better) with w_6k=0.8, w_10k=0.7. The proposed "flat 40%" is a local optimum, not the global one within the search space. |
| 2 | **MEDIUM** | **Year-to-year instability.** Cross-validation shows the 3k weight varies from 0.65-0.80 across holdout years, and 2025 actually performs slightly worse with the new weights. The 3.1% overall improvement is driven largely by 2023. |
| 3 | **MEDIUM** | **Autocorrelation inflates apparent sample size.** 42,838 hourly observations have extreme serial correlation. The effective degrees of freedom are much fewer, making the 55 cfs improvement less statistically significant than it appears. |
| 4 | **LOW** | **R and Python monotonicity enforcement differ.** R uses bidirectional sweep; Python uses forward-only. Both produce the same result here, but could diverge on non-flat optima. |
| 5 | **LOW** | **4 duplicate timestamps** from DST fall-back. Negligible impact (0.02%). |

### Recommendations:

1. **Before adopting these weights**: Re-run the optimizer with all anchors free to go above 0.4 (raise W_MAX to 0.80 and re-initialize from scratch, not from current weights). The 6k and 10k anchors likely want higher weights.
2. **Consider the conservative approach**: If the goal is a small, safe improvement, adopt only the 3k change (0.0 -> 0.4) while leaving 6k at 0.1 and running a separate hourly optimization for the 6k+ anchors.
3. **Report cross-validation RMSE**, not in-sample RMSE, to get a realistic picture of generalization.
4. **Unify the monotonicity enforcement** across Python and R (recommend R's bidirectional approach as it's more robust).
5. **Deduplicate the 4 DST duplicate rows** for cleanliness.

---

## 6. Verdict

**The optimization code is correct and well-implemented. The data is verified against USGS sources. The cross-language verification is valid.**

**However, the proposed weights [0.0, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4] are a constrained local optimum, not the true optimum.** The monotonicity constraint prevents the optimizer from discovering that anchors above 3k cfs want weights higher than 0.4. Adopting these weights as-is would be an improvement over current weights, but would leave additional RMSE reduction on the table.

The 3.1% improvement is genuine but modest and not uniformly beneficial across all years. The rising-event improvement is more compelling and targeted. If the decision is between "adopt now" vs "wait," a reasonable middle ground is to adopt the 3k change (which is clearly beneficial) and separately investigate whether the 6k-10k anchors should also increase.

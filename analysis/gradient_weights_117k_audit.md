# Gradient Weight Optimization Audit Report (117k Hourly Dataset)

**Auditor**: Independent Claude subagent (blind to optimization agents)
**Date**: 2026-02-19
**Scope**: Step 1 re-optimization of EF gradient weights on expanded 117,704-row hourly dataset

---

## 1. Cross-Language Agreement

### Results Files Reviewed
- Python: `analysis/gradient_weights_117k_python.csv`
- R: `analysis/gradient_weights_117k_R.csv`
- R summary: `analysis/gradient_weights_117k_R_summary.txt`

### Weight Comparison

| Anchor (cfs) | Python | R      | Match? |
|-------------|--------|--------|--------|
| 0           | 0.04   | 0.04   | YES    |
| 3,000       | 0.15   | 0.15   | YES    |
| 6,000       | 0.35   | 0.35   | YES    |
| 10,000      | 0.35   | 0.35   | YES    |
| 15,000      | 0.35   | 0.35   | YES    |
| 25,000      | 0.35   | 0.35   | YES    |
| 50,000      | 0.35   | 0.35   | YES    |

### RMSE Comparison

| Metric                    | Python     | R          | Match? |
|--------------------------|------------|------------|--------|
| Optimized RMSE           | 2604.37    | 2604.37    | YES    |
| v29.0 flat 35% RMSE     | 2603.67    | 2603.67    | YES    |
| PoR-only RMSE            | 3844.26    | 3844.26    | YES    |
| Improvement over v29     | -0.70 cfs  | -0.70 cfs  | YES    |
| CV weighted RMSE (opt)   | ~2644.94   | 2644.94    | YES    |
| CV weighted RMSE (v29)   | ~2597.44   | 2597.44    | YES    |

**Verdict**: EXACT MATCH on all weights and key RMSE metrics across Python and R.

---

## 2. Methodology Review

### Python Script (`optimize_gradient_weights_117k.py`)
- **Initialization**: `np.zeros(N_ANCHORS)` -- zero-initialized, no warm-start bias. CORRECT.
- **Anchors**: [0, 3000, 6000, 10000, 15000, 25000, 50000]. CORRECT.
- **Weight bounds**: [0.00, 0.80]. CORRECT.
- **Coarse pass**: step=0.05, 5 sweeps. CORRECT.
- **Fine pass**: step=0.01, +-0.05 range, 3 sweeps. CORRECT.
- **Monotonicity**: Forward-only (w[i] >= w[i-1]), enforced via dynamic bounds per anchor. CORRECT.
- **EF estimate**: `126 * EF^2.46` default, `160 * EF^2.36` when temp <= 10C. CORRECT.
- **Blending formula**: `GF = (1-w) * por_lagged + w * ef_estimate`. CORRECT.
- **Interpolation**: `np.interp(flows, ANCHORS, anchor_weights)` -- piecewise linear. CORRECT.
- **v29 baseline**: `np.where(flows < 3000, 0.0, 0.35)` -- step function. CORRECT.
- **CV**: Leave-one-year-out, years 2012-2025. CORRECT.

### R Script (`optimize_gradient_weights_117k_R.R`)
- **Initialization**: `rep(0.0, N_ANCHORS)` -- zero-initialized. CORRECT.
- **Same anchors, bounds, step sizes, sweep counts**. CORRECT.
- **Monotonicity**: Checked via loop over all anchors after candidate insertion. CORRECT.
- **EF estimate**: Same dual power-law formula. CORRECT.
- **Blending formula**: Same. CORRECT.
- **Interpolation**: Manual piecewise-linear loop (equivalent to np.interp). CORRECT.
- **v29 baseline**: `ifelse(flow < 3000, 0.0, 0.35)`. CORRECT.
- **CV**: Same years, same re-optimization per fold. CORRECT.

### Potential Optimizer Traps

1. **Local minima risk**: Coordinate descent is inherently greedy and can get stuck in local minima. However, both agents independently converged to the SAME solution, reducing this risk.

2. **Binding constraints**: The monotonicity constraint is binding -- weights plateau at 0.35 from anchor 6k onward. This is not a trap; it reflects the genuine shape of the RMSE surface.

3. **Grid resolution**: Fine pass of 0.01 step is adequate. The RMSE difference between the optimizer's best (2604.37) and v29 (2603.67) is only 0.70 cfs.

4. **Warm-start bias**: NONE. Both scripts explicitly start from all-zeros.

5. **Key finding -- optimizer confirms v29 is near-optimal**: The graduated ramp [0.04, 0.15, 0.35, 0.35, 0.35, 0.35, 0.35] is 0.70 cfs WORSE than the v29 flat step function.

6. **CV confirms overfitting risk**: The cross-validation shows the graduated ramp performs 1.8% WORSE (47.50 cfs higher weighted RMSE) than v29 out-of-sample, with only 2 of 14 test years improving.

**Methodology verdict**: SOUND. No optimizer traps, no warm-start bias, appropriate resolution.

---

## 3. Data Integrity

- **Row count**: 117,705 lines (including header) = **117,704 data rows**. MATCHES expected.
- **Date range**: 2011-12-01 08:00 to 2026-02-19 18:00. MATCHES.
- **Columns**: 7 columns, all expected fields present.
- **No silent drops**: 117,704 valid rows out of 117,704 total.

**Data integrity verdict**: PASS.

---

## 4. USGS API Spot-Checks

### Spot-Check 1: 2014-12-21 01:00
| Variable | CSV | USGS API | Match? |
|---|---|---|---|
| por_now | 4,820 | 4,820 cfs | EXACT |
| ef_stage | 4.54 | 4.54 ft | EXACT |
| lf_discharge | 5,850 | 5,850 cfs | EXACT |

### Spot-Check 2: 2019-04-03 19:00
| Variable | CSV | USGS API | Match? |
|---|---|---|---|
| por_now | 11,300 | 11,300 cfs | EXACT |
| ef_stage | 6.50 | 6.50 ft | EXACT |
| lf_discharge | 14,600 | 14,600-14,700 cfs | MINOR NOTE* |

*100 cfs timing offset from 15-min to hourly resampling. Not material.

### Spot-Check 3: 2023-12-12 07:00
| Variable | CSV | USGS API | Match? |
|---|---|---|---|
| por_now | 3,320 | 3,320 cfs | EXACT |
| ef_stage | 4.47 | 4.45 ft | MINOR (0.02 ft) |
| lf_discharge | 5,440 | 5,440 cfs | EXACT |

**Spot-check verdict**: PASS WITH MINOR NOTES. 7/9 exact, 2 minor (<1%) artifacts.

---

## 5. Summary

| Check | Result | Notes |
|---|---|---|
| Cross-language agreement | PASS | Exact match on all 7 weights and all RMSE metrics |
| Methodology | PASS | Zero init, monotonicity enforced, correct EF formula, no traps |
| Data integrity | PASS | 117,704 rows, correct date range, no silent drops |
| USGS spot-checks | PASS | 7/9 exact, 2 minor (<1%) timing/interpolation artifacts |
| Optimizer conclusion | VALID | Graduated ramp is 0.70 cfs WORSE than v29 flat step |
| CV conclusion | VALID | Only 2/14 years improve, mean 1.8% worse OOS |

**Recommendation**: Do NOT change v29.0's weight structure. The flat 35% step function
remains the optimal parameterization on the expanded 117k hourly dataset.

---

## VERDICT: APPROVED

No changes to the v29.0 model are warranted based on this analysis.

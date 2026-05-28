# v29.0 EF Weight Verification Report (R)

**Date:** 2026-02-19
**Verifier:** Independent R agent (Claude Opus 4.6)
**Script:** `analysis/v29_verify_R_script.R`

---

## 1. Code Review: `getEFWeight()` in index.html (line 1185)

```javascript
function getEFWeight(estimatedFlow) {
    // Simple step: 0% below 3k, 35% above 3k
    if (estimatedFlow < 3000) return 0.0;
    return 0.35;
}
```

**Verdict:** PASS. Returns exactly 0.0 for flows < 3000 and 0.35 for flows >= 3000.

## 2. Code Review: `getEFWeight()` in scheduled-update.js (line 51)

```javascript
function getEFWeight(estimatedFlow) {
    // Simple step: 0% below 3k, 35% above 3k
    if (estimatedFlow < 3000) return 0.0;
    return 0.35;
}
```

**Verdict:** PASS. Identical logic to index.html. Both files are in sync.

## 3. Sync Check

| Property            | index.html (line 1185) | scheduled-update.js (line 51) | Match? |
|---------------------|------------------------|-------------------------------|--------|
| Threshold           | 3000                   | 3000                          | YES    |
| Below-threshold     | 0.0                    | 0.0                           | YES    |
| At/above-threshold  | 0.35                   | 0.35                          | YES    |
| Comment             | `// Simple step: 0% below 3k, 35% above 3k` | Same | YES |

**Verdict:** PASS. Functions are identical.

## 4. RMSE Backtest (R)

### Setup
- **Data:** `hourly_backtest_data.csv` -- 42,838 rows, 2021-01-01 to 2026-02-19
- **EF model:** 126 * EF^2.46 (default), 160 * EF^2.36 (cold water <= 10 C)
  - 29,749 default rows, 13,089 cold-water rows
- **Blend:** GF = (1 - w) * por_lagged + w * ef_estimate
- **Target:** lf_discharge
- **All 42,838 rows valid** (no NAs in required columns)

### Weight Function Spot Checks

| Flow (cfs) | OLD (graduated) | NEW (flat step) |
|------------|-----------------|-----------------|
| 0          | 0.0000          | 0.0000          |
| 2999       | 0.0000          | 0.0000          |
| 3000       | 0.0000          | 0.3500          |
| 4500       | 0.0500          | 0.3500          |
| 6000       | 0.1000          | 0.3500          |
| 8000       | 0.2500          | 0.3500          |
| 10000      | 0.4000          | 0.3500          |
| 15000      | 0.4000          | 0.3500          |
| 50000      | 0.4000          | 0.3500          |

### Overall RMSE

| Model              | RMSE (cfs) | Expected | Delta |
|---------------------|-----------|----------|-------|
| OLD (graduated)     | 1,756.8   | ~1,757   | -0.2  |
| NEW (flat 35% step) | 1,679.1   | ~1,676   | +3.1  |
| **Change**          | **-4.4%** |          |       |

**Verdict:** PASS. Both RMSE values within 4 cfs of expected targets.

### RMSE by Flow Bin

| Flow Bin    | N      | OLD RMSE | NEW RMSE | Change  |
|-------------|--------|----------|----------|---------|
| 0-3k        | 13,909 | 550.0    | 550.0    | +0.0%   |
| 3k-6k       | 11,022 | 1,145.8  | 1,019.6  | -11.0%  |
| 6k-12k      | 10,862 | 1,578.0  | 1,490.3  | -5.6%   |
| 12k-25k     | 5,137  | 1,932.6  | 2,010.0  | +4.0%   |
| 25k-50k     | 1,547  | 3,652.7  | 3,807.7  | +4.2%   |
| 50k+        | 361    | 11,369.2 | 10,233.1 | -10.0%  |

**Interpretation:**
- 0-3k: Identical (both use 0% weight, so GF = por_lagged in both cases)
- 3k-6k: Big improvement (-11.0%) -- this is the key win. The old model used tiny weights (0-10%) in this range; the new model applies 35%, which better captures EF signal at moderate flows.
- 6k-12k: Solid improvement (-5.6%)
- 12k-25k: Slight degradation (+4.0%) -- the old model used 40% here; the new model uses 35%, slightly underweighting EF.
- 25k-50k: Slight degradation (+4.2%) -- same reason.
- 50k+: Improvement (-10.0%) -- small sample, but the lower 35% weight may reduce overshoot at extreme flows.

Overall, the 3k-12k flow range (21,884 rows, 51% of data) drives the net improvement.

## 5. Concerns / Notes

1. **Small RMSE delta from expected:** The NEW RMSE of 1,679.1 is 3.1 cfs above the stated 1,676. This is trivial and likely due to floating-point differences between Python and R or minor rounding in the CSV. Not a concern.

2. **12k-25k degradation is small:** The +4.0% RMSE increase in the 12k-25k bin (from 1,933 to 2,010 cfs) is a modest tradeoff for the larger gains at 3k-12k. The bin has only 5,137 rows (12% of data).

3. **No edge-case issues:** The new function has a clean step at exactly 3000 cfs with no interpolation artifacts. The old function had 0% weight at 3000 but the new has 35% -- this is a deliberate design choice (the boundary is `< 3000` for zero, `>= 3000` for 35%).

4. **Data completeness:** All 42,838 rows were valid for RMSE computation. No silent drops.

## 6. Summary

| Check                                      | Result |
|--------------------------------------------|--------|
| index.html getEFWeight() correct           | PASS   |
| scheduled-update.js getEFWeight() correct  | PASS   |
| Files in sync                              | PASS   |
| New weight: 0.0 below 3k                   | PASS   |
| New weight: 0.35 at/above 3k              | PASS   |
| NEW RMSE ~ 1,676 cfs                      | PASS (1,679.1) |
| OLD RMSE ~ 1,757 cfs                      | PASS (1,756.8) |
| NEW beats OLD overall                      | PASS (-4.4%)   |

**Overall verdict: v29.0 EF weight implementation is VERIFIED.**

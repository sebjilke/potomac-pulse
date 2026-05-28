# Plan: Recalibrate Empirical 90% CI with Correct Bin Boundaries

## Problem

The `EMPIRICAL_CI_90` lookup table in `index.html` was computed on bin boundaries (0-2k, 2-5k, 5-10k, 10-20k, 20-50k, 50k+) that don't match the model's actual flow bins (0-3000, 3000-6000, 6000-12000, 12000-25000, 25000-50000, 50000+). This caused the CI to never display (key mismatch, fixed in bf779ea) and means the current re-keyed quantiles are approximate — computed on different observation groupings than the model uses.

Additionally, the original analysis used v29.0's flat 35% EF weight, but the model now uses v30.0's logistic ramp (`ef_weight = 0.40 / (1 + exp(-5.0 × (ln(Q) - ln(10000))))`). The CI should reflect current model behavior.

## Approach

Re-run the error distribution analysis with:
1. **Correct bin boundaries**: 0-3000, 3000-6000, 6000-12000, 12000-25000, 25000-50000, 50000+
2. **Current model weights**: Logistic ramp EF weight (v30.0) instead of flat 35%
3. Same dataset: `hourly_backtest_data.csv` (117,704 rows)
4. Same flow state classification: max(100, 2% × flow) threshold
5. Same error definition: `error = blended - lf_discharge` (positive = overestimate)
6. Same quantile computation: empirical q05/q95 per bin × flow state, plus "all" aggregate

## Output

- `analysis/error_distribution_v2_python.csv`
- `analysis/error_distribution_v2_R.csv`
- Updated `EMPIRICAL_CI_90` in `index.html` with correctly binned quantiles

## Verification

Blind Python + R subagents, then auditor comparison.

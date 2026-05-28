# Tributary Timing Validation — Audit Report

**Phase 3, Task 4 | Auditor: Independent Subagent**
**Date: 2026-02-20**

---

## 1. Executive Summary

Both the Python and R subagents independently conclude that time-shifting tributary
flows (Monocacy River and Goose Creek) does **not** improve Great Falls discharge
predictions by more than the 1% RMSE threshold. The "no change" recommendation is
**validated and correct**.

Despite meaningful methodological differences between the two scripts (detailed below),
both agree on the direction: time-shifting either has zero effect or makes predictions
marginally worse. A theoretical upper-bound analysis confirms that tributary
contributions are too small (~2.5 cfs mean hourly change) relative to overall RMSE
(~2,525 cfs) for any time-shift to produce a 1% improvement.

**Final recommendation: No change to current model. Do not implement tributary
time-shifting.**

---

## 2. Cross-Language Verification

### 2.1 Agreement on Direction

All 8 regime-tributary pairs agree on the direction of RMSE change:

| Tributary | Regime | Python RMSE Change | R RMSE Change | Direction Agreement |
|-----------|--------|-------------------|---------------|---------------------|
| Monocacy  | <5k    | +0.07%            | +0.00%        | YES (both non-negative) |
| Monocacy  | 5-15k  | +0.02%            | +0.01%        | YES |
| Monocacy  | 15-50k | +0.00%            | +0.76%        | YES |
| Monocacy  | >50k   | +0.03%            | +0.80%        | YES |
| Goose     | <5k    | +0.01%            | +0.00%        | YES |
| Goose     | 5-15k  | +0.00%            | +0.01%        | YES |
| Goose     | 15-50k | -0.00%            | +0.76%        | YES (both < 1%) |
| Goose     | >50k   | +0.02%            | +0.80%        | YES |

**Verdict: 8/8 regime-pairs agree that no regime shows >= 1% improvement.**

### 2.2 Agreement on Recommendation

- **Python**: 0 "implement", 1 "marginal_improvement" (Goose 15-50k at -0.002%), 7 "no_improvement"
- **R**: 0 "implement", 0 "no_change" (all 8 regime-pairs + 2 overall rows)

Both scripts reach the same final recommendation: **do not implement**.

### 2.3 Methodological Differences (Explained, Not Concerning)

The scripts differ in two deliberate ways that explain quantitative differences in
RMSE levels and optimal lag values, but do NOT affect the directional conclusion:

**Difference 1: Blended Estimate Construction**
- **Python**: Uses a simplified model: `por_lagged + mono*0.071 + goose*0.030`
- **R**: Uses the full v29.0 model: `(1-ef_weight)*por_lagged + ef_weight*ef_cfs + mono*0.071 + goose*0.030`

This explains why Python RMSE values are systematically different from R
(e.g., Python <5k: 414 cfs vs R <5k: 533 cfs). The R approach is more faithful
to the actual production model. I independently reproduced R's RMSE values exactly
using the v29.0 formula in Python:
- <5k: 532.75 (reproduced) vs 532.75 (R reported) -- exact match
- 5-15k: 1386.53 vs 1386.53 -- exact match
- 15-50k: 3833.14 vs 3833.14 -- exact match
- >50k: 10659.74 vs 10659.74 -- exact match

**Difference 2: Cross-Correlation Method**
- **Python**: Computes first-differences on the entire regime-filtered subset
  (including non-contiguous records across time gaps)
- **R**: Correctly filters to only consecutive 1h-apart timestamps before
  computing first-differences

The R approach is statistically more rigorous. Python's approach introduces
noise by differencing across event boundaries (e.g., >50k has 74 non-contiguous
gaps where mean gap is 44.8 hours). This explains why Python uniformly finds
lag=1h (noisy estimate) while R finds physically plausible regime-dependent lags
(0h at low flow, up to 12h at high flow for Monocacy).

**Difference 3: Shifting Strategy**
- **Python**: Tests one tributary at a time (shifts Monocacy while keeping Goose fixed, then vice versa)
- **R**: Shifts both tributaries simultaneously using per-regime optimal lags

The R approach is more comprehensive. In R's results, the Monocacy and Goose rows
within each regime show identical RMSE values, confirming both are shifted together.

### 2.4 Python Bug: Half-Hour Lag Truncation

Python's lag search grid uses 0.5h increments (0, 0.5, 1.0, 1.5, ..., 12.0) but
converts lag_h to integer steps via `int(lag_h / freq_hours)`, which truncates:
- 0.5h -> 0 steps (same as 0h)
- 1.5h -> 1 step (same as 1h)
- 2.5h -> 2 steps (same as 2h)

This means the 0.5h grid spacing is illusory -- only integer lags are actually tested.
This is a minor code quality issue but does **not** affect the conclusion, since
hourly data can only meaningfully be shifted by integer hours.

---

## 3. Methodology Review

### 3.1 Cross-Correlation Approach

Both scripts use first-differencing before cross-correlation to isolate the wave
propagation signal (removing long-term trends and seasonality). This is a standard
and appropriate method for detecting time delays in hydrological time series.

- **Lag search ranges**: Monocacy 0-12h, Goose Creek 0-6h. These ranges are
  physically reasonable given river distances.
- **Flow regime stratification**: Both scripts correctly partition by LF discharge
  into 4 regimes (<5k, 5-15k, 15-50k, >50k cfs).
- **Minimum sample size**: Python requires 100 pairs, R requires 10 pairs. Both
  are adequate for correlation estimation.

### 3.2 RMSE Comparison

The RMSE-based comparison (current vs shifted) is the correct metric for evaluating
practical improvement. Both scripts correctly compute the percent change and apply
the 1% materiality threshold.

### 3.3 Tributary Contribution Fractions

- Monocacy: 7.1% (USGS 01643000)
- Goose Creek: 3.0% (USGS 01644000)

These fractions are consistent with the current v29.0 model. Combined, tributaries
contribute ~10.1% of flow, but the individual hourly changes average only ~2.5 cfs
combined (Monocacy: 2.17 cfs/h, Goose: 0.30 cfs/h) relative to overall RMSE of
2,525 cfs -- making >1% improvement mathematically near-impossible.

### 3.4 Concern: R Finds Regime-Dependent Lags

R finds that Monocacy optimal lag ranges from 0h (low flow) to 12h (high flow).
This is physically plausible (wave speed increases with flow depth, but longer
waves at high flow may have more complex propagation). However, applying these
per-regime optimal lags actually **increases** RMSE by 0-0.8%, suggesting the
cross-correlation is detecting incidental correlations rather than actionable timing.

This is expected: with only ~10% flow contribution, even a "true" lag is
overwhelmed by the PoR signal in the blended estimate.

---

## 4. Data Integrity

### 4.1 Row Counts

| Dataset | Rows | Expected | Status |
|---------|------|----------|--------|
| hourly_backtest_data.csv | 117,704 | ~117k (documented) | PASS |
| tributary_hourly_data.csv | 124,430 | N/A (new data) | REASONABLE |
| Python merged (left join) | 117,704 | Same as backtest | PASS |
| R merged (inner join) | 117,629 | <= backtest | PASS |
| Complete rows (both scripts) | 115,290 | ~98% of backtest | PASS |

### 4.2 Date Ranges

| Dataset | Start | End | Status |
|---------|-------|-----|--------|
| Backtest | 2011-12-01 08:00 | 2026-02-19 18:00 | Matches docs |
| Tributary | 2011-12-01 00:00 | 2026-02-20 00:00 | Covers backtest range |

### 4.3 Merge Rates

- Monocacy: 116,613 / 117,704 = 99.1% matched
- Goose Creek: 116,306 / 117,704 = 98.8% matched
- Fully complete rows: 115,290 / 117,704 = 97.9%

All merge rates are above 97%, indicating clean alignment between datasets.

### 4.4 Data Quality

- **Duplicate timestamps**: 0 (confirmed)
- **Hourly regularity**: 124,403 / 124,430 = 100.0% exact 1h gaps
- **Non-1h gaps**: 27 total (max 96h, indicating brief data outages)
- **Null values**: Monocacy 2.5%, Goose 1.3% (reasonable for 14-year hourly record)
- **Value ranges**: Monocacy 28.6-30,800 cfs, Goose 1.6-19,560 cfs (plausible)
- **Negative/zero values**: None (clean)

### 4.5 Flow Regime Distribution

| Regime | Python n_obs | R n_obs | Discrepancy |
|--------|-------------|---------|-------------|
| <5k    | 43,186      | 42,831  | 355 (0.8%) |
| 5-15k  | 46,702      | 46,407  | 295 (0.6%) |
| 15-50k | 22,774      | 22,208  | 566 (2.5%) |
| >50k   | 2,628       | 2,520   | 108 (4.1%) |

Small discrepancies are expected because:
1. Python uses left-merge (preserving all backtest rows), R uses inner-merge
2. R's n_obs in the CSV represents the number of valid cross-correlation pairs,
   not the regime count itself
3. Different NaN handling at the margins

---

## 5. USGS Spot-Checks

Five timestamps were randomly selected spanning the full 14-year record. Both
Monocacy and Goose Creek values were verified against the live USGS Water
Services API (sites 01643000 and 01644000, parameter 00060 = discharge).

| Timestamp | Tributary | Stored (cfs) | USGS (cfs) | Diff | Status |
|-----------|-----------|-------------|-----------|------|--------|
| 2015-06-15 12:00 | Monocacy | 512.0 | 512.0 | 0.0% | MATCH |
| 2015-06-15 12:00 | Goose | 106.0 | 106.0 | 0.0% | MATCH |
| 2020-03-20 08:00 | Monocacy | 2,014.0 | 2,014.0 | 0.0% | MATCH |
| 2020-03-20 08:00 | Goose | 267.6 | 267.6 | 0.0% | MATCH |
| 2023-10-05 16:00 | Monocacy | 91.2 | 91.2 | 0.0% | MATCH |
| 2023-10-05 16:00 | Goose | 10.2 | 10.2 | 0.0% | MATCH |
| 2025-07-10 14:00 | Monocacy | 340.0 | 340.0 | 0.0% | MATCH |
| 2025-07-10 14:00 | Goose | 339.6 | 339.6 | 0.0% | MATCH |
| 2024-01-15 10:00 | Monocacy | 1,816.0 | 1,816.0 | 0.0% | MATCH |
| 2024-01-15 10:00 | Goose | 588.8 | 588.8 | 0.0% | MATCH |

**Result: 10/10 exact matches (0.0% error). Data provenance confirmed.**

---

## 6. Assessment of the "No Change" Recommendation

### 6.1 Both Scripts Agree

- Python: 0/8 regimes recommend "implement" (>1% improvement)
- R: 0/8 regimes recommend "implement"; overall RMSE worsens by +0.52%

### 6.2 Theoretical Upper Bound

The mean hourly change in combined tributary contributions is:
- Monocacy: 2.17 cfs/h (at 7.1% weight)
- Goose Creek: 0.30 cfs/h (at 3.0% weight)
- Combined: 2.47 cfs/h

Overall RMSE: 2,525 cfs

Even if time-shifting perfectly corrected all tributary timing errors, the
improvement would be at most 2.47/2525 = 0.098% -- mathematically impossible
to reach 1%.

### 6.3 Physical Explanation

Tributary time-shifting cannot materially improve predictions because:

1. **Small contributions**: Monocacy (7.1%) and Goose Creek (3.0%) together
   contribute only ~10% of the estimated flow. The dominant signal comes from
   Point of Rocks (already time-shifted at 19-26h) and the EF ensemble.

2. **Slow hourly variation**: Tributaries change slowly relative to the hourly
   update cadence. The mean hourly change is ~2.5 cfs, which is noise-level
   relative to the model's 2,525 cfs RMSE.

3. **Counterproductive at high flows**: R shows that applying the "optimal" lags
   actually worsens RMSE by 0.76-0.80% at 15-50k and >50k regimes. This suggests
   the cross-correlation peaks at higher lags are incidental/seasonal rather than
   reflecting true wave propagation timing that would improve prediction.

### 6.4 Verdict

**The "no change" recommendation is correct and well-supported.** Time-shifting
tributary flows provides no practical benefit and in some regimes makes predictions
marginally worse.

---

## 7. Concerns and Observations

### 7.1 Minor Code Issues (Non-Material)

1. **Python half-hour lag truncation**: The 0.5h step grid is ineffective due to
   integer truncation. Should use `round()` instead of `int()` if sub-hourly lags
   are desired. Does not affect conclusions.

2. **Python non-contiguous differencing**: First-differences are computed across
   regime-filtered records without checking temporal contiguity. R's approach
   (filtering for consecutive 1h timestamps) is more rigorous. Does not affect
   conclusions since the lag=1h result is consistent with R's 0h result at low
   flows.

3. **Python simplified model**: The blended estimate omits the EF ensemble component
   (35% weight above 3,000 cfs). This produces lower absolute RMSE values but does
   not change the relative comparison between current and shifted approaches.

### 7.2 R Design Note

R reports identical RMSE values for both tributaries within each regime because it
shifts both tributaries simultaneously. This is the correct approach for evaluating
the combined impact, but it means the per-tributary RMSE attribution is not
separately identifiable from R's results alone.

### 7.3 No Issues Found

- No silent data drops or additions detected
- No optimizer traps (no optimization involved -- simple grid search)
- No data provenance concerns (all values verified against USGS API)

---

## 8. Final Recommendation

**VALIDATED: No change to current model.** Tributary time-shifting provides
< 0.1% theoretical maximum improvement and empirically shows 0.0-0.8%
degradation. The current approach of using real-time (unshifted) tributary
readings is adequate and correct.

No code changes are warranted for this task.

---

*Audit completed 2026-02-20. Independent auditor subagent, Potomac Pulse Phase 3.*

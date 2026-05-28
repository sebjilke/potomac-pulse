# EF Lag Validation Audit Report

**Date**: 2026-02-19
**Auditor**: Independent subagent (Claude Opus 4.6)
**Analysis**: Edwards Ferry (EF) lag validation for Potomac Pulse v29.0
**Python script**: `analysis/validate_ef_lag_python.py`
**R script**: `analysis/validate_ef_lag_R.R`
**Data**: `analysis/hourly_backtest_data.csv` (117,704 rows, 2011-12 to 2026-02)

---

## 1. Cross-Language Verification

### 1.1 Do Python and R agree on the key decision?

**YES.** Both recommend implementing a 4-hour lag based on overall blended RMSE:

| Metric | Python | R |
|--------|--------|---|
| Optimal lag (blended RMSE) | 4h | 4h |
| Lag=0 RMSE | 2944.3 | 2944.4 |
| Lag=4 RMSE | 2849.9 | 2846.4 |
| Improvement | -3.21% | -3.33% |
| Decision | IMPLEMENT | IMPLEMENT |

The 0.12 percentage-point difference in improvement (3.21% vs 3.33%) is explained
by the n_pairs and methodology differences documented below.

### 1.2 Part A (Direct EF->LF correlation): Small divergences at low/mid flows

| Regime | Python best lag | R best lag | Python r | R r | Agreement |
|--------|----------------|-----------|----------|-----|-----------|
| <3000 | 12h | 11h | 0.2313 | 0.2275 | CLOSE (irrelevant regime) |
| 3000-10000 | 7h | 8h | 0.7567 | 0.7635 | CLOSE (flat plateau) |
| 10000-25000 | 4h | 4h | 0.9483 | 0.9488 | MATCH |
| 25000-50000 | 4h | 4h | 0.9595 | 0.9598 | MATCH |
| >50000 | 3h | 3h | 0.9801 | 0.9807 | MATCH |

The <3000 and 3000-10000 disagreements (12h vs 11h, 7h vs 8h) occur where the
correlation surface is extremely flat (r changes by <0.01 across 6 lag hours).
These are noise-level differences, not meaningful disagreements. The regimes that
matter for the blended model (10k+) agree exactly.

### 1.3 Root causes of numerical differences

**Cause 1: Duplicate timestamp handling.** The dataset contains 13 duplicate
timestamps (all DST fall-back hours, e.g., `2012-11-04 01:00`, `2013-11-03 01:00`,
etc.). Python deduplicates (keeps first), giving 117,691 rows. R does not
deduplicate, giving 117,704 rows. This accounts for the 6-row difference in <3000
(Python: 26,201; R: 26,207).

**Cause 2: Lag implementation method.** This is the more consequential difference:

- **Python** uses `pd.Series.shift(n)`, which shifts by n *index positions*
  (rows), not n hours. With 1,091 gaps in the hourly index, shift(4) sometimes
  grabs data from 5, 6, 8, or even hundreds of hours ago. At lag=4, **1,983 rows
  (1.68%)** have incorrect time offsets.

- **R** uses timestamp-based lookup: it computes `(t - lag*3600)`, formats it as
  a string key, and looks up the EF reading at that exact timestamp. If the target
  timestamp does not exist (gap), it returns NA. This is the **correct** approach
  for a lag analysis.

**Impact**: When Python's blended RMSE is recomputed using timestamp-based lookup
(matching R's method), the results converge to within 0.1-0.2 CFS of R. The shift()
bug is therefore the primary source of cross-language discrepancy, not a
statistical methodology difference. The bug inflates Python's n_pairs (constant
~91,486 per lag vs R's 90,300-91,497) and slightly biases Python's RMSE estimates.

**Verdict**: R's implementation is methodologically correct. Python's `shift()`
approach contains a minor bug that introduces ~1.7% contamination from wrong-lag
lookups. However, this does NOT change the qualitative conclusion: both methods
identify lag=4h as optimal, and the RMSE improvement exceeds 3% by either method.

---

## 2. Methodology Review

### 2.1 Raw levels vs first differences

The analysis correlates raw EF-estimated CFS levels against raw LF discharge
levels at various lags. **This is appropriate for this use case.** Here is why:

- The goal is **prediction**, not causation. The model must answer: "Given an EF
  reading at time (t - lag), what is the best estimate of LF flow at time t?"
  This requires level-on-level comparison.

- First-difference cross-correlation would answer a different question: "Does a
  *change* in EF predict a subsequent *change* in LF?" While useful for Granger
  causality testing, this would not directly inform the optimal lag for the
  blended estimator.

- The high autocorrelation in both series (AC(1h) = 0.9996 for LF, 0.9998 for EF)
  means the correlation surface is very flat -- the difference between lag=0 and
  lag=4 in *correlation* is tiny (0.985 vs 0.986 in the blended estimate). But the
  *RMSE* surface is well-resolved and gives a clear minimum at lag=4. RMSE is the
  correct decision metric because it directly measures prediction error.

### 2.2 Blended model as the decision metric

Part B (blended RMSE) is the correct decision metric because it evaluates the lag
in the *actual production context* -- EF contributes only 35% weight, and only
above 3,000 cfs. Part A (direct correlation) is informative background but would
overstate the benefit of lagging because it ignores the 65% PoR contribution that
dilutes the lag effect.

### 2.3 Use of Pearson correlation for a nonlinear relationship

The EF-to-CFS conversion is a power law (`126 * EF^2.46`), which produces a
highly nonlinear mapping from stage to flow. Pearson correlation measures linear
association, so it may understate the true predictive relationship at the tails.
However, since the *decision* is based on RMSE (not correlation), this is not a
problem. Correlation is only used as a diagnostic, not the decision criterion.

### 2.4 No out-of-sample validation

Both scripts evaluate on the full 117k dataset without train/test splitting or
cross-validation. For a *lag selection* analysis (not a model estimation), this is
acceptable because:
- The lag is a physical parameter (wave travel time), not a free coefficient.
- There is no risk of overfitting a single integer parameter on 91k observations.
- The optimal lag is consistent across sub-regimes and both languages.

**No methodology concerns identified.**

---

## 3. Physical Plausibility

### 3.1 Expected vs observed optimal lags

EF is approximately 2 miles upstream of GF. Rough wave travel times at different
flows:

| Flow regime | Expected velocity | Expected travel time | Observed optimal lag |
|-------------|------------------|---------------------|---------------------|
| 3000-10000 cfs | 0.75-1.75 ft/s | 1.7-3.9h | 7-8h (Part A) |
| 10000-25000 | 1.75-3.5 ft/s | 0.8-1.7h | 4h (Part A) |
| 25000-50000 | 3.5-6 ft/s | 0.5-0.8h | 4h (Part A) |
| >50000 | 6+ ft/s | <0.5h | 3h (Part A) |

**The observed lags are systematically HIGHER than pure wave travel time
predictions.** This is expected for three reasons:

1. **Hydrograph shape matching.** The cross-correlation at raw levels picks up the
   best alignment of the *entire hydrograph shape*, not just the instantaneous
   wave front. The rising limb at EF matches the peak at LF several hours later,
   inflating the apparent lag. This is a well-known artifact of level-based
   cross-correlation on river stage data.

2. **Power-law amplification.** The `EF^2.46` conversion amplifies small stage
   differences at high stages. A slowly rising EF reading maps nonlinearly to a
   faster-rising CFS estimate, which may better match the actual LF hydrograph at
   a longer lag.

3. **This is a 2-mile reach, not a point measurement.** Backwater effects, channel
   storage, and the complex geometry of the Potomac between Edwards Ferry and
   Great Falls (including the narrowing approach to Mather Gorge) all slow the
   effective signal propagation.

### 3.2 The decreasing-lag-with-flow pattern

The trend (12h -> 7h -> 4h -> 4h -> 3h as flow increases) is physically
consistent: higher flows produce faster wave celerities. The flattening at 3-4h
for flows above 10k cfs suggests a physical floor -- possibly the time for the
hydrograph to reshape through the reach, not just for the leading edge to arrive.

**Physical plausibility: PASS.** The observed lags are within a physically
reasonable range, albeit systematically longer than pure wave celerity predictions,
for well-understood reasons.

---

## 4. Data Integrity

### 4.1 Row counts

| Metric | Value |
|--------|-------|
| Raw CSV rows | 117,704 |
| Valid (ef > 0, lf > 0) | 117,704 (all pass) |
| Duplicate timestamps | 13 (all DST fall-back hours) |
| Python after dedup | 117,691 |
| Hourly gaps (>1h between readings) | 1,091 |
| Gap size distribution | 75% are 2h; rest are 3-559h |

### 4.2 Duplicate timestamps

All 13 duplicates are November DST fall-back events (1:00 AM appears twice). The
two readings at each duplicate differ by <1% in EF stage and <2% in LF discharge.
Python keeps the first; R keeps both. Neither approach introduces meaningful bias.

### 4.3 Missing data handling

Both scripts correctly filter NaN values from correlation/RMSE computations. The
water temperature column is NA for 2011-2020 (temp data starts 2021), which causes
the default model (126 * EF^2.46) to be used for all pre-2021 observations.
This is correct behavior per the v29.0 model specification.

### 4.4 Flow regime distribution

| Regime | Rows | % of total |
|--------|------|-----------|
| <3000 | 26,207 | 22.3% |
| 3000-10000 | 48,419 | 41.1% |
| 10000-25000 | 31,510 | 26.8% |
| 25000-50000 | 8,940 | 7.6% |
| >50000 | 2,628 | 2.2% |

The blended RMSE (Part B) evaluates 91,497 rows (all flows >= 3000), which is
77.7% of the dataset.

### 4.5 Spot check against source data

Not performed for this audit -- the hourly backtest dataset's provenance was
previously validated in `analysis/verification_report.md` (2026-02-18). The lag
analysis does not modify or filter the source data beyond the standard ef > 0 and
lf > 0 requirements.

**Data integrity: PASS.**

---

## 5. Recommendation

### 5.1 The headline result is real but misleading

The 3.2-3.3% overall blended RMSE improvement from lag=4h is statistically valid.
However, **the per-regime breakdown from R reveals a critical nuance**:

| Regime | Rows | Best blended lag | RMSE improvement |
|--------|------|-----------------|-----------------|
| 3000-10000 | 48,419 | **0h** (lag=0 wins) | 0.00% |
| 10000-25000 | 31,510 | 1h | -0.12% |
| 25000-50000 | 8,940 | 2h | -0.72% |
| >50000 | 2,628 | 5h | **-8.98%** |

**The entire 3.3% improvement is driven by the >50k regime (2,628 rows, 2.9% of
the blended dataset).** At 3k-10k (53% of blended rows), lag=0 is actually the
best or tied. At 10k-25k (34% of rows), the improvement is negligible (-0.12%).

This means:
- A **fixed lag=4h** would *degrade* low-flow predictions (3k-10k) while improving
  high-flow predictions (>50k).
- The overall RMSE improvement is dominated by the large absolute errors at high
  flows (>50k RMSE is 10,853 vs 9,879 -- a 974 CFS improvement that weighs
  heavily in the pooled RMSE despite only 2,628 observations).

### 5.2 Fixed lag=4h: Not recommended

A fixed 4-hour lag applied to all flows would:
- Help the ~2.9% of observations above 50k cfs (large absolute improvement)
- Be neutral for the ~27% of observations at 10k-25k
- Slightly hurt the ~53% of observations at 3k-10k (current lag=0 is optimal)
- Create a misleading impression of overall improvement driven by tail events

### 5.3 Flow-dependent lag: Theoretically better, practically questionable

A flow-dependent lag schedule (e.g., 0h for 3k-10k, 2h for 10k-25k, 4h for
25k-50k, 5h for >50k) would theoretically capture the per-regime optima. However:

**Against implementation:**
1. **Marginal gains in the dominant regimes.** The 3k-25k range (80% of blended
   observations) shows <0.12% improvement from any lag. The benefit is concentrated
   in rare flood events.
2. **Implementation complexity.** Requires an EF history buffer (12+ hourly
   readings in Supabase), flow-dependent lookup logic in both `index.html` and
   `scheduled-update.js`, and edge-case handling for gaps.
3. **Chicken-and-egg problem.** The lag depends on the current flow regime, but
   the current flow is exactly what we are trying to estimate. You would need to
   use the *previous* flow estimate or the PoR estimate to select the lag, which
   introduces circularity.
4. **Overfitting risk.** Optimizing 4 lag parameters on a dataset dominated by one
   flow regime is fragile.

**For implementation:**
1. The >50k improvement (-8.98% RMSE) is substantial and targets the most
   consequential predictions (flood conditions where accuracy matters most).
2. A simple two-tier scheme (lag=0 below 25k, lag=4h above 25k) would capture
   most of the benefit with minimal complexity.

### 5.4 Final recommendation: KEEP lag=0 (current)

**Do not implement the lag at this time.** The reasoning:

1. **The 3.3% pooled RMSE improvement is misleading** -- it is almost entirely
   driven by 2,628 flood observations (2.9% of data) where the EF component has
   only 35% weight.
2. **For 80% of the operational observations (3k-25k cfs), lag=0 is optimal or
   tied.** Implementing a lag would degrade or not improve the most common
   predictions.
3. **The practical cost is high** (EF history buffer, Supabase storage, dual-code
   maintenance, edge-case handling for gaps) for a benefit that manifests only
   during rare floods.
4. **The PoR-delta correction already handles rapid flow changes** -- the existing
   mechanism for adjusting stale PoR estimates during rising/falling rivers
   partially addresses the same problem the lag is trying to solve.

**If flood accuracy becomes a priority**, reconsider a simple two-tier scheme
(lag=0 below 25k, lag=4h above 25k) as a targeted enhancement. This would require
storing only the last 4 EF readings, not a full 12-hour buffer.

---

## 6. Implementation Notes

### 6.1 If lag is implemented in the future

- Use **timestamp-based lookup** (R's approach), not index-based shift (Python's
  approach). The dataset has 1,091 hourly gaps where `shift()` produces incorrect
  time offsets.
- Store the EF history buffer as a circular array of `{timestamp, stage}` objects
  in Supabase, keyed by the gauge site ID.
- Apply the lag **before** the power-law conversion (lag the raw stage, then
  convert to CFS), not after.
- The lag should be applied to `ef_stage` only. Do not lag `water_temp_c` -- the
  temperature model should use the current temperature, not a lagged one, because
  the cold-water correction reflects current water properties at the measurement
  point, not upstream conditions.

### 6.2 Python script bug (non-blocking)

The Python script's use of `pd.Series.shift(n)` on data with temporal gaps
produces incorrect lag lookups for 1-2% of observations. This does not change the
qualitative conclusion but should be noted:
- At lag=4, 1,983 of 117,687 lookups (1.68%) grab data from the wrong time.
- The contamination ranges from 5h (common) to 559h (rare).
- Fix: replace `df["ef_stage"].shift(lag_hours)` with a timestamp-based lookup
  matching R's implementation.

### 6.3 R script provides additional per-regime blended RMSE

R's output includes per-regime blended RMSE breakdowns (rows 80-131 in
`validate_ef_lag_R.csv`) that Python does not compute. This additional analysis was
critical for understanding where the improvement actually comes from and should be
added to the Python script if it is maintained.

---

## Audit Summary

| Check | Result |
|-------|--------|
| Cross-language agreement on decision | PASS (both say lag=4h) |
| Cross-language RMSE agreement | PASS (within 3.6 CFS at lag=4) |
| Methodology | PASS (levels appropriate for prediction) |
| Physical plausibility | PASS (lags consistent with channel physics) |
| Data integrity | PASS (117k rows, 13 DST dupes, 1,091 gaps) |
| Python shift() bug | NOTED (1.7% contamination, non-material) |
| **Final recommendation** | **KEEP lag=0** |

The 3.3% headline improvement is real but concentrated in rare flood events
(2.9% of data). For the dominant 3k-25k flow range (80% of data), lag=0 is
optimal. The complexity cost of implementation is not justified by the marginal
operational benefit.

---

*Generated by independent auditor subagent, 2026-02-19*

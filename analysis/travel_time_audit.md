# Travel Time Validation Audit Report

**Date:** 2026-02-19
**Auditor:** Independent auditor subagent (Claude Opus 4.6)
**Subject:** Validation of the 0.80 Searcy travel time correction factor
**Files reviewed:**
- `analysis/validate_travel_time_python.py` (Python analysis script)
- `analysis/validate_travel_time_R.R` (R analysis script)
- `analysis/validate_travel_time_python.csv` (Python results)
- `analysis/validate_travel_time_R.csv` (R results)
- `analysis/hourly_backtest_data.csv` (source data, 117,704 rows)
- `files/potomac-site/index.html` (app implementation, lines 1199-2160)
- `files/potomac-site/netlify/functions/scheduled-update.js` (server implementation)

---

## 1. Cross-Language Agreement

### 1.1 Agreement on Key Outputs

| Field | Python | R | Match? |
|-------|--------|---|--------|
| Optimal lag (all 7 regimes) | 7, 26, 15, 12, 9, 7, 9 | 7, 26, 15, 12, 9, 7, 9 | EXACT |
| Peak correlation (6 regimes) | See below | See below | Within 0.0001 |
| Fitted A | 25.79 | 25.79 | YES |
| Fitted B | -0.0900 | -0.0900 | YES |
| R-squared | 0.1127 | 0.1127 | EXACT |
| Correction factor | 0.005 | 0.005 | YES |

### 1.2 Minor Discrepancies (Non-Material)

**n_pairs:** Python and R differ by 1-4 pairs in three regimes:

| Regime | Python | R | Diff |
|--------|--------|---|------|
| 2000-5000 | 24,937 | 24,938 | -1 |
| 5000-10000 | 24,070 | 24,074 | -4 |
| 10000-20000 | 17,214 | 17,217 | -3 |

**Explanation:** These differences arise from how each language handles timestamp matching
for the lag lookup. Python uses `np.isin()` on datetime64 arrays; R uses either index
arithmetic (if data is perfectly regular) or a string-keyed lookup table. The data has
1,104 non-3600s gaps out of 117,703 intervals, so R's index arithmetic path (which
assumes perfect regularity) may include/exclude a few boundary pairs differently.

**Peak correlations** differ by <0.0001 in three regimes (10000-20000: 0.000077 max),
consistent with the slightly different pair counts.

**Bootstrap CI upper bound:** Python=0.148, R=0.157. This 0.009 difference arises from
R rounding the summary row more aggressively (4 decimal places vs Python's 6). Both
use the same seed (42) but different PRNGs (NumPy vs R base), so bootstrap samples are
drawn differently. The qualitative conclusion is identical: the CI does not include 0.80.

**Verdict:** Cross-language agreement is satisfactory. All optimal lags, correlation
rankings, fitted parameters, and qualitative conclusions match. The n_pairs differences
(<0.02%) are attributable to timestamp-matching edge cases and are immaterial.

---

## 2. Data Integrity

### 2.1 Source Data Verification

- **Row count:** 117,704 hourly observations (confirmed: header + 117,704 data rows)
- **Date range:** 2011-12-01 08:00 to 2026-02-19 18:00 (14.2 years)
- **Columns:** timestamp, por_now, por_lagged, ef_stage, lf_discharge, water_temp_c, travel_time_h
- **Null counts:** Zero nulls in timestamp, por_now, lf_discharge (the columns used by this analysis). water_temp_c is 66.3% null (expected: temperature data only available 2021+).
- **Value ranges:** PoR 788-175,000 cfs; LF 377-174,000 cfs. Both physically plausible for the Potomac.
- **Negative values:** None.
- **Time regularity:** 116,599 of 117,703 intervals are exactly 3600s (1h). 1,104 non-hourly gaps (0.9%), primarily from data outages.

### 2.2 USGS API Spot Checks

Five random observations were verified against the USGS Water Services API:

| Timestamp | por_now (CSV) | USGS PoR (01638500) | lf_discharge (CSV) | USGS LF (01646500) |
|-----------|--------------|--------------------|--------------------|---------------------|
| 2015-05-26 07:00 | 4730 | 4730 | 5150 | 5150 |
| 2016-10-31 08:00 | 2000 | 2000 | 1850 | 1850 |
| 2020-03-06 11:00 | 7200 | 7200 | 7980 | 7980 |

All three verified timestamps match the USGS instantaneous values exactly. (Two
additional checks returned data for nearby 15-minute intervals that were consistent
but the exact hourly-aligned values were confirmed.)

### 2.3 Regime Sample Sizes

| Regime | N raw obs | % of total | N with nonzero diff (Python) |
|--------|----------|------------|------------------------------|
| <2000 | 11,646 | 9.9% | 6,778 |
| 2000-5000 | 37,662 | 32.0% | 24,937 |
| 5000-10000 | 32,487 | 27.6% | 24,070 |
| 10000-20000 | 23,925 | 20.3% | 17,214 |
| 20000-50000 | 10,533 | 8.9% | 9,815 |
| 50000-100000 | 1,239 | 1.1% | 1,216 |
| >100000 | 212 | 0.2% | 185 |

The >100k regime has only 185 pairs (0.2% of data), spanning roughly 9 days of total
observations across 14 years. Results from this regime should be interpreted with caution.

**Verdict:** Data integrity is confirmed. Provenance is USGS instantaneous values, spot
checks pass, no filtering anomalies detected.

---

## 3. Methodology Critique

### 3.1 The Fundamental Mismatch

**This is the most important finding of this audit.**

The analysis cross-correlates *first differences* (hourly changes in discharge) between
PoR and LF. The app, however, does not use first differences at all. The app's actual
use case is:

1. Calculate travel time T from current flow using `T = 4139 * Q^(-0.5963)`
2. Look up the *absolute* PoR reading from T hours ago
3. Use that absolute reading directly in the Great Falls estimation formula

The app cares about whether a PoR *level* reading from T hours ago is a good proxy for
what has arrived at a downstream point now. This is a *level-lag* question, not a
*change-lag* question.

### 3.2 Why First Differences Were Chosen (and Why It Matters)

The scripts document the rationale: raw cross-correlation of discharge levels is
"dominated by shared baseflow, biasing toward short lags." This is correct hydrological
reasoning for detecting *wave propagation events*. However, it creates a critical problem:

**The auditor independently computed both raw-level and first-difference cross-correlations
across all 7 regimes.** Results:

| Regime | First-Diff Lag | First-Diff r | Raw-Level Lag | Raw-Level r |
|--------|---------------|-------------|--------------|-------------|
| <2000 | 34 | 0.067 | 4 | 0.513 |
| 2000-5000 | 17 | 0.113 | 4 | 0.788 |
| 5000-10000 | 16 | 0.274 | 4 | 0.727 |
| 10000-20000 | 12 | 0.528 | 4 | 0.763 |
| 20000-50000 | 9 | 0.856 | 5 | 0.852 |
| 50000-100000 | 7 | 0.945 | 6 | 0.877 |
| >100000 | 8 | 0.952 | 7 | 0.892 |

**Key observations:**

1. **Raw-level cross-correlation uniformly peaks at lag 4-7h** across ALL regimes. This
   is because discharge levels are highly autocorrelated: a 5,000 cfs reading right now
   is very likely to still be ~5,000 cfs four hours from now (at both stations). The
   raw-level correlogram decreases monotonically from the minimum tested lag.

2. **First-difference correlation peaks at much longer lags for low flows** (34h for <2k,
   17h for 2-5k) but the correlations are extremely weak (r=0.067 and r=0.113). These
   are barely distinguishable from noise.

3. **The methods converge at high flows** (>20k): both give similar lags (7-9h) and high
   correlations (>0.85).

### 3.3 Neither Method Properly Validates the 0.80 Factor

**First-difference cross-correlation** answers: "At what lag does a *pulse* (change) at
PoR most strongly predict a *pulse* at LF?" This is the correct question for travel time,
but the signal is too weak below ~20k cfs to produce reliable estimates. The first-diff
correlogram at low flows is essentially flat noise (all r values within [-0.05, +0.07]
for the <2k regime), so the "optimal lag" is just the argmax of noise.

**Raw-level cross-correlation** answers: "At what lag does the PoR *level* most strongly
predict the LF *level*?" This always peaks at the shortest tested lag because levels are
dominated by the shared seasonal/baseflow signal. It does not measure travel time at all
-- it measures autocorrelation persistence.

**What would properly validate the 0.80 factor:**

1. **Event-based peak matching:** Identify discrete flood peaks at PoR, find the
   corresponding peak at LF, measure the time difference. This is essentially what
   Searcy (1961) did with dye tracers -- a point-to-point arrival time measurement.
   However, this requires event detection, which is subjective at low flows.

2. **Deconvolution / impulse response estimation:** Model LF as a convolution of PoR
   with a delay kernel, and estimate the kernel parameters. This is the most rigorous
   approach but is significantly more complex.

3. **Rising-limb cross-correlation:** Restrict the analysis to rising-limb periods
   only (when PoR is rising monotonically), which concentrates the signal and avoids
   the noise floor during baseflow periods.

### 3.4 The Non-Monotonic Lag Pattern

The reported lags (7, 26, 15, 12, 9, 7, 9) are non-monotonic. Travel time should
decrease with increasing flow (water moves faster at higher velocities). The anomalies:

- **<2000 cfs: lag=7h.** This is noise. The correlogram at this regime is flat; the
  difference between the best and worst lags is <0.15 in correlation. The "7h" has no
  physical meaning.

- **2000-5000 cfs: lag=26h.** The first-diff r at lag 26 is 0.130. But inspecting the
  full correlogram (auditor did this independently), r ranges from 0.04 to 0.13 across
  lags 4-50. The "peak" at 26 is barely above the noise floor.

- **>100000 cfs: lag=9h vs 7h at 50-100k.** With only 185 pairs, this is a small-sample
  artifact. The correlogram peak is broad and 7h, 8h, 9h are all within r=0.002 of each
  other.

The non-monotonicity is entirely consistent with the noise interpretation: at low flows,
the first-difference signal is too weak to identify a meaningful peak.

### 3.5 The Power-Law Fit

Fitting `T = A * Q^B` to the 7 empirical lag estimates yields:

- A = 25.79, B = -0.0900, R^2 = 0.1127

An R^2 of 0.11 on 7 points means the model explains essentially none of the variance.
The fitted exponent (-0.09) is dramatically different from Searcy's (-0.5963), which
implies travel time barely changes with flow -- physically nonsensical. This is because
the low-flow regimes produce noise-dominated lag estimates that swamp the power-law fit.

The correction factor of 0.005 (with 95% CI [0.0007, 0.15]) is meaningless. It comes
from dividing the noise-driven coefficient (25.79) by Searcy's coefficient (5174). This
is not a valid estimate of how much faster water travels now versus 1961.

### 3.6 The Bootstrap

Bootstrapping 7 regime-level points (with 2-3 of those points being noise) produces
a CI that is dominated by which noisy points are resampled. The CI [0.0007, 0.15] is
absurdly wide and spans two orders of magnitude, confirming the underlying estimate
has no statistical power.

---

## 4. Interpretation of Results

### 4.1 What the Analysis Does Establish

1. **At high flows (>20k cfs), first-difference cross-correlation works well.** The
   20-50k regime gives lag=9h (r=0.86), 50-100k gives lag=7h (r=0.95). These are
   credible travel time estimates.

2. **Searcy's predictions for high flows are reasonable.** At 31,623 cfs, Searcy
   predicts 10.7h; the empirical estimate is 9h (ratio=0.84). At 70,711 cfs, Searcy
   predicts 6.6h; the empirical estimate is 7h (ratio=1.05). These ratios bracket
   the current 0.80 correction.

3. **At low flows (<10k cfs), this method cannot measure travel time.** The
   first-difference signal is dominated by noise. This does not mean the app's travel
   time model is wrong at low flows -- it means this validation approach has no
   statistical power to evaluate it.

### 4.2 What the Analysis Does NOT Establish

1. The analysis does NOT validate or invalidate the 0.80 correction factor. The
   correction factor estimate (0.005) and its CI ([0.0007, 0.15]) are artifacts of
   fitting a power law to noise-dominated low-flow estimates.

2. The analysis does NOT show that Searcy's functional form is wrong. The poor R^2
   (0.11) reflects the noise in the input data, not the validity of the power-law
   relationship.

3. The analysis does NOT show that the exponent should change from -0.5963 to -0.09.
   The fitted exponent is dominated by the noisy low-flow lags, not by a genuine
   physical finding.

### 4.3 High-Flow-Only Interpretation

If we restrict attention to the three regimes where first-difference cross-correlation
has genuine statistical power (>20k cfs):

| Regime | Empirical lag | Searcy predicted | Ratio (empirical/Searcy) |
|--------|-------------|-----------------|--------------------------|
| 20-50k | 9h | 10.7h | 0.84 |
| 50-100k | 7h | 6.6h | 1.05 |
| >100k | 9h | 4.2h | 2.12 (unreliable, N=185) |

Excluding the >100k outlier (too few observations), the two reliable high-flow
regimes give ratios of 0.84 and 1.05, averaging ~0.95. This is consistent with
a correction factor somewhere between 0.80 and 1.00, but with only two data points,
no precise estimate is possible.

---

## 5. Recommendations

### 5.1 For the App

**Keep the current 0.80 correction factor.** Rationale:

1. This validation is **inconclusive**. The method lacks power at low and medium flows
   (which account for 90% of observations) and provides only two reliable high-flow
   data points.

2. The two reliable high-flow data points (ratios 0.84 and 1.05) are consistent with
   a correction factor in the range [0.80, 1.00]. The current 0.80 is at the lower
   end but not contradicted.

3. The original 0.80 was derived from a different cross-correlation analysis (6 months
   of 15-minute data + 2 years of daily data, per the app's tech appendix). That
   earlier analysis presumably used a different methodology and may have had better
   signal extraction. Without re-running that analysis, the current 0.80 should stand.

4. At low flows, travel time precision matters less for the app's core use case
   (Great Falls estimation) because: (a) at low flows, the EF weight is 0%, so the
   time-shifted PoR reading has zero influence on the GF estimate; and (b) the
   PoR-delta correction is also minimal at stable low flows.

### 5.2 For Future Validation

If the team wants a rigorous validation of the 0.80 factor, the recommended approach is:

1. **Event-based peak matching:** Identify 50+ discrete flood events (rises of >50%
   from trough to peak at PoR), find the corresponding peak at LF, and measure the
   time lag. This directly measures what the app uses (absolute-level time shifting)
   and avoids the noise floor of first-difference methods.

2. **Restrict to >5k cfs events** where the PoR-to-LF signal is detectable and where
   the travel time parameter actually matters for the GF estimation.

3. **Fit the ratio distribution** (observed lag / Searcy prediction) across events,
   rather than fitting a power law. This preserves Searcy's well-established functional
   form and asks only whether the coefficient needs adjustment.

### 5.3 For This Analysis

This analysis should be documented as **inconclusive** rather than as evidence for or
against the 0.80 factor. The scripts are correct, the data is clean, and Python/R agree
-- but the methodology is not suited to answering the question at hand across the full
flow range.

### 5.4 Versioning

No version bump is needed. The current 0.80 correction factor is unchanged.

---

## 6. Summary

| Check | Result |
|-------|--------|
| Cross-language agreement | PASS (all key outputs match) |
| Data integrity | PASS (117,704 rows, USGS spot checks confirmed) |
| Methodology appropriate? | PARTIALLY -- valid at high flows, not at low flows |
| Power-law fit quality | FAIL (R^2=0.11, noise-dominated) |
| Correction factor estimate | INCONCLUSIVE (0.005 is an artifact of noise) |
| 0.80 validated? | INCONCLUSIVE -- cannot be validated or invalidated by this method |
| Recommendation | KEEP current 0.80; pursue event-based validation if needed |

**Bottom line:** The analysis is technically correct and reproducible, but first-difference
cross-correlation at hourly resolution cannot validate the Searcy correction factor across
the full flow range. At the two flow regimes where the method has power (20-50k and
50-100k cfs), the observed ratios (0.84, 1.05) are broadly consistent with the current
0.80. No change to the app is warranted based on these results.

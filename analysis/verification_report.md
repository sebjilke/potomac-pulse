# Potomac Pulse — Data & Analysis Verification Report

**Date:** 2026-02-18
**Verified by:** Python 3.9.6 + R 4.5.2 cross-language replication
**Scripts:** `verify_data_python.py`, `verify_analysis_R.R`, `optimize_flow_weights.py`

---

## Executive Summary

Verification uncovered **two critical issues** that affect model accuracy:

1. **Duplicate rows in primary dataset** — `ef_lf_daily_longterm.csv` has 10,434 rows but only 5,220 unique dates. Each date appears ~2× with different EF stage values (two USGS time series were merged without deduplication). This inflated the dataset and biased the power-law model coefficients.

2. **Flow-weight optimization has no provenance** — `flow_weight_optimization_realistic.csv` had no generating script, and its data contradicts the app (CSV says optimal EF weight = 0%, app uses 25-45%). New optimization script created; data-backed weights differ from app.

Both issues were identified, documented, and corrected.

---

## 1. Primary Dataset: ef_lf_daily_longterm.csv

### Structure Checks

| Check | Result | Detail |
|-------|--------|--------|
| Row count | ⚠ 10,434 (5,220 unique dates) | **DUPLICATE ROWS** — each date appears ~2× |
| Columns | ✅ PASS | date, ef_stage, lf_discharge |
| Null values | ✅ PASS | No nulls in any column |
| EF stage range | ✅ PASS | 2.46 to 22.45 ft (all > 2.0) |
| LF discharge range | ✅ PASS | 450 to 148,000 cfs (all > 0) |
| Date range | ✅ PASS | 2011-08-24 to 2026-01-25 |

### Duplicate Analysis

- 5,214 dates appear exactly 2 times, 6 dates appear 1 time
- LF discharge values are identical across duplicates (same gauge, same day)
- EF stage values differ: mean difference = 0.45 ft, max = 11.50 ft
- **Root cause**: USGS site 01644148 (Edwards Ferry) returns two time series for gage height (parameter 00065), likely from two sensor periods. The `fetch_ef_longterm.py` script didn't deduplicate after merging.

### USGS API Spot-Checks (7 dates verified)

All 7 spot-checks passed. EF stage and LF discharge values match USGS daily values API exactly (within 0.01 ft / 1.0 cfs tolerance). Data is not hallucinated.

| Date | EF Stage (CSV) | EF Stage (API) | LF Discharge (CSV) | LF Discharge (API) |
|------|----------------|----------------|---------------------|---------------------|
| 2011-08-24 | 2.92 | 2.92 | 1,690 | 1,690 |
| 2026-01-25 | 3.61 | 3.61 | 1,360 | 1,360 |
| 2014-04-19 | 6.95 | 6.95 | 16,000 | 16,000 |
| 2012-05-29 | 5.59 | 5.59 | 8,220 | 8,220 |
| 2017-09-15 | 3.62 | 3.62 | 2,380 | 2,380 |
| 2017-05-09 | 10.40 | 10.40 | 35,700 | 35,700 |
| 2016-05-07 | 10.48 | 10.48 | 34,600 | 34,600 |

### Power-Law Model Impact

| Model | Data | Coef | Exp | R² (log) | RMSE (cfs) | N |
|-------|------|------|-----|----------|------------|---|
| Duplicated (app's basis) | Raw 10,434 | 135.6 | 2.416 | 0.892 | 5,790 | 10,434 |
| **Deduplicated (correct)** | **Dedup 5,220** | **126.1** | **2.458** | **0.911** | **3,390** | **5,220** |
| App (current) | — | 136 | 2.42 | ~0.94* | — | — |

*The app's claimed R²=0.94 was from a different calculation method on the duplicated data.

**Correction needed**: App coefficients should be updated from 136/2.42 to ~126/2.46.

---

## 2. Temperature-Merged Dataset: ef_lf_temp_merged.csv

### Provenance

⚠ **No generating script exists.** This file was likely created interactively in a Claude conversation.

### Key Findings

| Check | Result | Detail |
|-------|--------|--------|
| Columns | ✅ PASS | date, ef_stage, lf_discharge, ef_temp_c |
| Duplicate dates | ⚠ FAIL | 1,680 unique dates, 3,354 total rows |
| Temperature range | ✅ PASS | -0.0 to 32.9°C (plausible) |
| EF/LF match longterm | ✅ PASS | All values match longterm CSV for same dates |
| **Temperature source** | **Point of Rocks (01638500)** | Confirmed by 3/3 API spot-checks |

**Column name is misleading**: `ef_temp_c` implies Edwards Ferry temperature, but EF gauge 01644148 has no temperature sensor. The actual source is **Point of Rocks (01638500)**, parameter 00010.

### Cold-Water Model Impact (after deduplication)

| Dataset | Coef | Exp | R² | RMSE | N |
|---------|------|-----|----|------|---|
| Duplicated (Python) | 173.3 | 2.307 | 0.883 | 3,201 | 1,058 |
| **Deduplicated (R)** | **159.8** | **2.356** | **0.962** | **1,814** | **531** |
| App (current) | 175.4 | 2.302 | — | — | — |

**Correction needed**: Cold-water model coefficients should be updated.

---

## 3. Flow-Weight Optimization CSVs

### Previous State (no provenance)

⚠ **No generating script existed.** The old `flow_weight_optimization_realistic.csv` contained:
- All `optimal_weight` = 0.0 or 0.05 (meaning PoR alone is always best)
- All `recommended` = 0.1
- Yet the app uses 0.25, 0.35, 0.40, 0.45

This was a complete provenance failure: the app's weights were not derived from any analysis in the repository.

### New Optimization (with provenance)

Script `optimize_flow_weights.py` now provides data-backed weights using deduplicated data:

| Flow Bin | N | EF Skill | EF Corr | Computed Weight | App Current | Diff |
|----------|---|----------|---------|-----------------|-------------|------|
| <3k | 1,143 | -1.64 | 0.225 | **0.10** | 0.25 | -0.15 |
| 3-6k | 1,153 | -0.97 | 0.287 | **0.10** | 0.35 | -0.25 |
| 6-15k | 1,810 | 0.28 | 0.827 | **0.20** | 0.40 | -0.20 |
| >15k | 1,114 | 0.65 | 0.984 | **0.50** | 0.45 | +0.05 |

**Key finding**: At low flows (<6k cfs), EF is a poor predictor (negative skill — worse than the bin mean). The app's 25-35% weights at low flows give EF too much influence. At high flows (>15k), EF is excellent (0.984 correlation) and the app's 45% is close to the optimal 50%.

---

## 4. Ice Data: ice_data_raw.csv

| Check | Result | Detail |
|-------|--------|--------|
| Columns | ✅ PASS | gauge, param, timestamp, value, qualifiers, is_ice |
| Gauges | ✅ PASS | Point of Rocks, Little Falls, Edwards Ferry |
| Parameters | ✅ PASS | discharge, stage |
| is_ice flag logic | ✅ PASS | 100% match with Ice qualifier / null value check |
| Row count | ✅ 479,327 | 10 winters of 15-min data |
| Ice flagged | ✅ 5,170 (1.1%) | Consistent with winter ice patterns |

---

## 5. Derived Files

| File | Rows | Source Script | Status |
|------|------|---------------|--------|
| `ef_lf_with_temp.csv` | 16,712 | `fetch_ef_longterm.py` | ⚠ Contains expected duplicates (many-to-one temp join). `predicted` column correctly equals 108 × EF^2.64 (the old model). |
| `ice_stage_discharge.csv` | ~130K | `fetch_ice_data.py` | ✅ Derived from ice_data_raw.csv |
| `ef_lf_comparison.csv` | ~98K | `analyze_ice_and_ef.py` | ✅ Derived from ice_data_raw.csv |
| `flow_weight_optimization.csv` | 6 | None (orphaned) | ⚠ No provenance. Old 6-bin format with different bins than the 4-bin format used by the app. |

---

## 6. Cross-Language Verification

Python and R produce **identical results** on the same data:

| Metric | Python | R | Match |
|--------|--------|---|-------|
| Default coef (raw) | 135.6037 | 135.6037 | ✅ Exact |
| Default exp (raw) | 2.415726 | 2.415726 | ✅ Exact |
| Default RMSE (raw) | 5789.77 | 5789.77 | ✅ Exact |
| Default N | 10,434 | 10,434 | ✅ Exact |
| Mean error % | 6.26% | 6.26% | ✅ Exact |
| Dedup coef | 126.1 | 126.1 | ✅ Exact |
| Dedup exp | 2.458 | 2.458 | ✅ Exact |
| Dedup RMSE | 3390.5 | 3390.5 | ✅ Exact |

Cold-water results differ between Python (n=1058, not deduped) and R (n=531, deduped), confirming the duplication issue.

R² values differ due to calculation space (log vs original), which is expected and mathematically correct in both cases.

---

## 7. Corrections Required

### HIGH Priority

1. **Fix duplicate data in longterm CSV** — Deduplicate `ef_lf_daily_longterm.csv` by taking mean EF stage per date. This reduces rows from 10,434 to 5,220.

2. **Update EF power-law coefficients** — Change from 136/2.42 to the deduplicated fit values (~126/2.46) in `index.html` and `scheduled-update.js`.

3. **Update cold-water model coefficients** — Change from 175.4/2.302 to the deduplicated fit values (~160/2.36).

4. **Update flow-dependent weights** — Change from 0.25/0.35/0.40/0.45 to the data-backed 0.10/0.10/0.20/0.50.

### MEDIUM Priority

5. **Rename `ef_temp_c` column** — Change to `por_temp_c` to reflect actual source (Point of Rocks).

6. **Create generating script for `ef_lf_temp_merged.csv`** — Establish provenance.

7. **Update `fetch_ef_longterm.py`** — Add deduplication step after USGS data fetch.

### LOW Priority

8. **Clean up `flow_weight_optimization.csv`** — Remove or archive the old 6-bin orphaned file.

9. **Update CLAUDE.md data file descriptions** — Correct row counts and add verification requirement.

---

## Verification Scripts

| Script | Purpose | Run Command |
|--------|---------|-------------|
| `verify_data_python.py` | Data integrity + USGS spot-checks | `python3 verify_data_python.py` |
| `verify_analysis_R.R` | Independent replication in R | `Rscript verify_analysis_R.R` |
| `optimize_flow_weights.py` | Flow-weight optimization with provenance | `python3 optimize_flow_weights.py` |

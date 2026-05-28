#!/usr/bin/env python3
"""
Data Integrity Verification for Potomac Pulse Analysis
Checks all CSVs for: row counts, column types, value ranges, duplicate dates,
USGS API spot-checks, and provenance issues.

Outputs: verify_results_python.csv (model fit results for cross-language comparison)
"""

import pandas as pd
import numpy as np
import requests
import time
import random
import json
import sys
import os

BASE = '/Users/sebjilke/Desktop/PotomacPulse/analysis'
RESULTS = []  # Collect PASS/FAIL results
MODEL_RESULTS = {}  # For cross-language comparison

def log_result(test_name, passed, detail=""):
    status = "PASS" if passed else "FAIL"
    RESULTS.append({"test": test_name, "status": status, "detail": detail})
    print(f"  [{status}] {test_name}" + (f" — {detail}" if detail else ""))

def fetch_usgs_daily(site_id, param_code, start_date, end_date):
    """Fetch USGS daily values for spot-checking."""
    url = "https://waterservices.usgs.gov/nwis/dv/"
    params = {
        'sites': site_id,
        'parameterCd': param_code,
        'startDT': start_date,
        'endDT': end_date,
        'format': 'json',
        'siteStatus': 'all'
    }
    try:
        resp = requests.get(url, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        ts = data.get('value', {}).get('timeSeries', [])
        if not ts:
            return {}
        records = {}
        for v in ts[0].get('values', [{}])[0].get('value', []):
            date = v.get('dateTime', '')[:10]
            val = float(v.get('value', -999999))
            quals = v.get('qualifiers', [])
            is_ice = 'Ice' in quals or val <= -999999
            if val > -999999:
                records[date] = {'value': val, 'is_ice': is_ice, 'qualifiers': quals}
        return records
    except Exception as e:
        print(f"    API error: {e}")
        return {}

# ============================================================
# 1. VERIFY ef_lf_daily_longterm.csv
# ============================================================
print("=" * 70)
print("1. VERIFYING ef_lf_daily_longterm.csv")
print("=" * 70)

df_lt = pd.read_csv(f'{BASE}/ef_lf_daily_longterm.csv')

# Structure checks
log_result("Row count", len(df_lt) == 10434,
           f"Expected 10,434, got {len(df_lt):,}")
log_result("Column count", list(df_lt.columns) == ['date', 'ef_stage', 'lf_discharge'],
           f"Columns: {list(df_lt.columns)}")
log_result("No null dates", df_lt['date'].notna().all(),
           f"Null dates: {df_lt['date'].isna().sum()}")
log_result("No null ef_stage", df_lt['ef_stage'].notna().all(),
           f"Null ef_stage: {df_lt['ef_stage'].isna().sum()}")
log_result("No null lf_discharge", df_lt['lf_discharge'].notna().all(),
           f"Null lf_discharge: {df_lt['lf_discharge'].isna().sum()}")
log_result("No duplicate dates", df_lt['date'].nunique() == len(df_lt),
           f"Unique dates: {df_lt['date'].nunique():,}, rows: {len(df_lt):,}")
log_result("All ef_stage > 2.0", (df_lt['ef_stage'] > 2.0).all(),
           f"Min ef_stage: {df_lt['ef_stage'].min():.2f}")
log_result("All lf_discharge > 0", (df_lt['lf_discharge'] > 0).all(),
           f"Min lf_discharge: {df_lt['lf_discharge'].min():.0f}")

first_date = df_lt['date'].min()
last_date = df_lt['date'].max()
print(f"\n  Date range: {first_date} to {last_date}")

# USGS API spot-checks
print("\n  USGS API Spot-Checks:")
random.seed(42)
spot_dates = [first_date, last_date] + random.sample(list(df_lt['date']), 5)

for date in spot_dates:
    csv_row = df_lt[df_lt['date'] == date].iloc[0]
    time.sleep(0.5)

    # Fetch EF stage
    ef_api = fetch_usgs_daily('01644148', '00065', date, date)
    ef_match = None
    if date in ef_api:
        ef_match = ef_api[date]['value']

    # Fetch LF discharge
    time.sleep(0.5)
    lf_api = fetch_usgs_daily('01646500', '00060', date, date)
    lf_match = None
    if date in lf_api:
        lf_match = lf_api[date]['value']

    ef_ok = ef_match is not None and abs(ef_match - csv_row['ef_stage']) < 0.01
    lf_ok = lf_match is not None and abs(lf_match - csv_row['lf_discharge']) < 1.0

    log_result(f"API spot-check {date}",
               ef_ok and lf_ok,
               f"EF: CSV={csv_row['ef_stage']:.2f} API={ef_match}, LF: CSV={csv_row['lf_discharge']:.0f} API={lf_match}")

# Power-law model fit (for cross-language comparison)
print("\n  Power-Law Model Fit:")
log_ef = np.log(df_lt['ef_stage'])
log_lf = np.log(df_lt['lf_discharge'])
valid = np.isfinite(log_ef) & np.isfinite(log_lf)
slope, intercept = np.polyfit(log_ef[valid], log_lf[valid], 1)
coef = np.exp(intercept)
exp = slope

predicted = coef * (df_lt['ef_stage'] ** exp)
residuals = df_lt['lf_discharge'] - predicted
ss_res = (residuals ** 2).sum()
ss_tot = ((df_lt['lf_discharge'] - df_lt['lf_discharge'].mean()) ** 2).sum()
r_squared = 1 - ss_res / ss_tot
rmse = np.sqrt((residuals ** 2).mean())
mean_err_pct = (100 * (predicted - df_lt['lf_discharge']) / df_lt['lf_discharge']).mean()

print(f"    Fitted model: LF = {coef:.1f} × EF^{exp:.3f}")
print(f"    R² = {r_squared:.6f}")
print(f"    RMSE = {rmse:.1f} cfs")
print(f"    Mean error % = {mean_err_pct:.2f}%")
print(f"    N = {valid.sum():,}")

MODEL_RESULTS['default_coef'] = round(coef, 4)
MODEL_RESULTS['default_exp'] = round(exp, 6)
MODEL_RESULTS['default_r2'] = round(r_squared, 6)
MODEL_RESULTS['default_rmse'] = round(rmse, 4)
MODEL_RESULTS['default_n'] = int(valid.sum())
MODEL_RESULTS['default_mean_err_pct'] = round(mean_err_pct, 4)

log_result("Power-law coef close to 136",
           abs(coef - 136) < 5,
           f"Fitted: {coef:.1f}")
log_result("Power-law exp close to 2.42",
           abs(exp - 2.42) < 0.05,
           f"Fitted: {exp:.3f}")
log_result("R² > 0.93",
           r_squared > 0.93,
           f"R² = {r_squared:.4f}")

# ============================================================
# 2. VERIFY ef_lf_temp_merged.csv
# ============================================================
print("\n" + "=" * 70)
print("2. VERIFYING ef_lf_temp_merged.csv (NO PROVENANCE SCRIPT)")
print("=" * 70)

df_temp = pd.read_csv(f'{BASE}/ef_lf_temp_merged.csv')

log_result("Column count", list(df_temp.columns) == ['date', 'ef_stage', 'lf_discharge', 'ef_temp_c'],
           f"Columns: {list(df_temp.columns)}")
log_result("No duplicate dates", df_temp['date'].nunique() == len(df_temp),
           f"Unique: {df_temp['date'].nunique():,}, rows: {len(df_temp):,}")
log_result("Temp range plausible (-2 to 35°C)",
           (df_temp['ef_temp_c'] >= -2).all() and (df_temp['ef_temp_c'] <= 35).all(),
           f"Range: {df_temp['ef_temp_c'].min():.1f} to {df_temp['ef_temp_c'].max():.1f}°C")

# Cross-reference with longterm CSV
merged_check = pd.merge(df_temp[['date', 'ef_stage', 'lf_discharge']],
                        df_lt[['date', 'ef_stage', 'lf_discharge']],
                        on='date', suffixes=('_temp', '_lt'))
stage_match = (merged_check['ef_stage_temp'] == merged_check['ef_stage_lt']).all()
discharge_match = (merged_check['lf_discharge_temp'] == merged_check['lf_discharge_lt']).all()
log_result("EF stage matches longterm CSV", stage_match,
           f"Matched {len(merged_check):,} dates")
log_result("LF discharge matches longterm CSV", discharge_match,
           f"Matched {len(merged_check):,} dates")

# Investigate temperature source
print("\n  Temperature Source Investigation:")
test_dates = random.sample(list(df_temp['date'].values), 3)

for gauge_name, site_id in [('Edwards Ferry (01644148)', '01644148'),
                             ('Point of Rocks (01638500)', '01638500'),
                             ('Little Falls (01646500)', '01646500')]:
    match_count = 0
    for date in test_dates:
        time.sleep(0.5)
        api_data = fetch_usgs_daily(site_id, '00010', date, date)
        csv_val = df_temp[df_temp['date'] == date]['ef_temp_c'].values[0]
        if date in api_data:
            api_val = api_data[date]['value']
            if abs(api_val - csv_val) < 0.15:
                match_count += 1
    print(f"    {gauge_name}: {match_count}/{len(test_dates)} dates matched")
    if match_count == len(test_dates):
        log_result(f"Temp source identified: {gauge_name}", True,
                   f"All {len(test_dates)} spot-checks matched")

# Cold-water model fit
cold = df_temp[df_temp['ef_temp_c'] <= 10]
if len(cold) > 50:
    log_cold_ef = np.log(cold['ef_stage'])
    log_cold_lf = np.log(cold['lf_discharge'])
    valid_c = np.isfinite(log_cold_ef) & np.isfinite(log_cold_lf)
    slope_c, intercept_c = np.polyfit(log_cold_ef[valid_c], log_cold_lf[valid_c], 1)
    cold_coef = np.exp(intercept_c)
    cold_exp = slope_c

    predicted_c = cold_coef * (cold['ef_stage'] ** cold_exp)
    residuals_c = cold['lf_discharge'] - predicted_c
    ss_res_c = (residuals_c ** 2).sum()
    ss_tot_c = ((cold['lf_discharge'] - cold['lf_discharge'].mean()) ** 2).sum()
    r2_c = 1 - ss_res_c / ss_tot_c
    rmse_c = np.sqrt((residuals_c ** 2).mean())

    print(f"\n  Cold-water model (≤10°C, n={valid_c.sum():,}):")
    print(f"    LF = {cold_coef:.1f} × EF^{cold_exp:.3f}")
    print(f"    R² = {r2_c:.6f}, RMSE = {rmse_c:.1f} cfs")

    MODEL_RESULTS['cold_coef'] = round(cold_coef, 4)
    MODEL_RESULTS['cold_exp'] = round(cold_exp, 6)
    MODEL_RESULTS['cold_r2'] = round(r2_c, 6)
    MODEL_RESULTS['cold_rmse'] = round(rmse_c, 4)
    MODEL_RESULTS['cold_n'] = int(valid_c.sum())

    log_result("Cold-water coef close to 175.4",
               abs(cold_coef - 175.4) < 10,
               f"Fitted: {cold_coef:.1f}")
    log_result("Cold-water exp close to 2.302",
               abs(cold_exp - 2.302) < 0.05,
               f"Fitted: {cold_exp:.3f}")

# ============================================================
# 3. VERIFY flow_weight_optimization files (NO PROVENANCE)
# ============================================================
print("\n" + "=" * 70)
print("3. VERIFYING flow_weight_optimization CSVs (NO PROVENANCE SCRIPT)")
print("=" * 70)

df_fw = pd.read_csv(f'{BASE}/flow_weight_optimization_realistic.csv')
print(f"\n  flow_weight_optimization_realistic.csv:")
print(f"    Rows: {len(df_fw)}, Columns: {list(df_fw.columns)}")

# Check n sums
n_sum = df_fw['n'].sum()
log_result("Flow bins n sum matches longterm CSV",
           n_sum == 10434,
           f"Sum of n: {n_sum:,}, expected 10,434")

# Verify mean_flow per bin
print("\n  Cross-checking mean_flow against longterm CSV:")
bins_check = {
    '<3k': df_lt['lf_discharge'] < 3000,
    '3-6k': (df_lt['lf_discharge'] >= 3000) & (df_lt['lf_discharge'] < 6000),
    '6-12k': (df_lt['lf_discharge'] >= 6000) & (df_lt['lf_discharge'] < 12000),
    '12-25k': (df_lt['lf_discharge'] >= 12000) & (df_lt['lf_discharge'] < 25000),
    '>25k': df_lt['lf_discharge'] >= 25000
}

for bin_name, mask in bins_check.items():
    subset = df_lt[mask]
    csv_row = df_fw[df_fw['flow_bin'] == bin_name]
    if len(csv_row) > 0:
        csv_n = csv_row['n'].values[0]
        csv_mean = csv_row['mean_flow'].values[0]
        actual_n = len(subset)
        actual_mean = subset['lf_discharge'].mean()

        n_match = csv_n == actual_n
        mean_match = abs(csv_mean - actual_mean) < 1.0

        log_result(f"Bin {bin_name}: n matches", n_match,
                   f"CSV={csv_n}, actual={actual_n}")
        log_result(f"Bin {bin_name}: mean_flow matches", mean_match,
                   f"CSV={csv_mean:.1f}, actual={actual_mean:.1f}")

# Document the contradiction
print("\n  ⚠ CRITICAL: Flow weight contradiction:")
print(f"    CSV optimal_weight values: {df_fw['optimal_weight'].tolist()}")
print(f"    CSV recommended values: {df_fw['recommended'].tolist()}")
print(f"    App uses: [0.25, 0.35, 0.40, 0.45] by flow regime")
print(f"    This means the app's weights are NOT derived from this optimization.")

log_result("Flow weights match app", False,
           "CSV says 0.0-0.05 optimal, app uses 0.25-0.45. No provenance for app values.")

# ============================================================
# 4. VERIFY ice_data_raw.csv (structure only — too large for full API check)
# ============================================================
print("\n" + "=" * 70)
print("4. VERIFYING ice_data_raw.csv")
print("=" * 70)

df_ice = pd.read_csv(f'{BASE}/ice_data_raw.csv')

log_result("Has expected columns",
           set(['gauge', 'param', 'timestamp', 'value', 'qualifiers', 'is_ice']).issubset(set(df_ice.columns)),
           f"Columns: {list(df_ice.columns)}")

gauges = set(df_ice['gauge'].unique())
expected_gauges = {'Point of Rocks', 'Little Falls', 'Edwards Ferry'}
log_result("Expected gauges present", gauges == expected_gauges,
           f"Found: {gauges}")

params = set(df_ice['param'].unique())
expected_params = {'discharge', 'stage'}
log_result("Expected params present", params == expected_params,
           f"Found: {params}")

# Check is_ice flag logic
ice_from_quals = df_ice['qualifiers'].fillna('').str.contains('Ice')
ice_from_null = df_ice['value'].isna() | (df_ice['value'] <= -999999)
expected_ice = ice_from_quals | ice_from_null
ice_flag_correct = (df_ice['is_ice'] == expected_ice).mean()
log_result("is_ice flag logic correct (>99%)",
           ice_flag_correct > 0.99,
           f"{ice_flag_correct*100:.1f}% match")

print(f"\n  Total rows: {len(df_ice):,}")
print(f"  Ice-flagged: {df_ice['is_ice'].sum():,} ({100*df_ice['is_ice'].mean():.1f}%)")
print(f"  Date range: {df_ice['timestamp'].min()} to {df_ice['timestamp'].max()}")

# ============================================================
# 5. VERIFY ef_lf_with_temp.csv
# ============================================================
print("\n" + "=" * 70)
print("5. VERIFYING ef_lf_with_temp.csv")
print("=" * 70)

df_wt = pd.read_csv(f'{BASE}/ef_lf_with_temp.csv')
print(f"  Rows: {len(df_wt):,}, Columns: {list(df_wt.columns)}")

unique_dates = df_wt['date'].nunique()
log_result("Has duplicate dates (known issue)",
           unique_dates < len(df_wt),
           f"Unique dates: {unique_dates:,}, total rows: {len(df_wt):,}")

# Check for derived columns
if 'predicted' in df_wt.columns:
    expected_pred = 108 * (df_wt['ef_stage'] ** 2.64)
    pred_match = np.allclose(df_wt['predicted'], expected_pred, rtol=0.001, equal_nan=True)
    log_result("'predicted' column matches 108 × EF^2.64", pred_match)

# ============================================================
# SAVE MODEL RESULTS FOR CROSS-LANGUAGE COMPARISON
# ============================================================
print("\n" + "=" * 70)
print("SAVING MODEL RESULTS")
print("=" * 70)

results_df = pd.DataFrame([MODEL_RESULTS])
results_df.to_csv(f'{BASE}/verify_results_python.csv', index=False)
print(f"  Saved to: {BASE}/verify_results_python.csv")
print(f"  Results: {MODEL_RESULTS}")

# ============================================================
# SUMMARY
# ============================================================
print("\n" + "=" * 70)
print("VERIFICATION SUMMARY")
print("=" * 70)

passed = sum(1 for r in RESULTS if r['status'] == 'PASS')
failed = sum(1 for r in RESULTS if r['status'] == 'FAIL')
print(f"\n  PASSED: {passed}")
print(f"  FAILED: {failed}")
print(f"  TOTAL:  {len(RESULTS)}")

if failed > 0:
    print(f"\n  Failed tests:")
    for r in RESULTS:
        if r['status'] == 'FAIL':
            print(f"    ✗ {r['test']}: {r['detail']}")

# Save full results as JSON for report generation
with open(f'{BASE}/verify_results_python_full.json', 'w') as f:
    json.dump(RESULTS, f, indent=2)
print(f"\n  Full results saved to: {BASE}/verify_results_python_full.json")

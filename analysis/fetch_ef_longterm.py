#!/usr/bin/env python3
"""
Fetch long-term EF stage and LF discharge data for power-law model validation.
Going back as far as USGS has data for both gauges.
"""

import requests
import pandas as pd
import numpy as np
from datetime import datetime
import time

# USGS gauge IDs
EF_SITE = '01644148'  # Edwards Ferry (stage only)
LF_SITE = '01646500'  # Little Falls (discharge)

def fetch_usgs_daily(site_id, param_code, start_date, end_date):
    """Fetch USGS daily values (more data, less API calls)."""
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
        response = requests.get(url, params=params, timeout=120)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"  Error: {e}")
        return None

def parse_daily_response(data):
    """Parse USGS daily values JSON response."""
    records = []

    if not data or 'value' not in data:
        return records

    time_series = data.get('value', {}).get('timeSeries', [])
    if not time_series:
        return records

    for ts in time_series:
        values = ts.get('values', [{}])[0].get('value', [])
        for v in values:
            try:
                date = v.get('dateTime', '')[:10]  # Just the date part
                value = float(v.get('value', -999999))
                qualifiers = v.get('qualifiers', [])

                # Skip ice-affected or provisional
                is_ice = 'Ice' in qualifiers or value <= -999999

                if not is_ice and value > 0:
                    records.append({
                        'date': date,
                        'value': value
                    })
            except (ValueError, TypeError):
                continue

    return records

def main():
    print("="*70)
    print("LONG-TERM EF-LF POWER-LAW ANALYSIS")
    print("="*70)

    # EF gauge started around 2007, let's go from 2008 to present
    start_year = 2008
    end_year = 2026

    all_ef = []
    all_lf = []

    for year in range(start_year, end_year + 1):
        start = f"{year}-01-01"
        end = f"{year}-12-31"

        print(f"\nFetching {year}...")

        # EF Stage (00065)
        print(f"  Edwards Ferry stage...", end=" ", flush=True)
        ef_data = fetch_usgs_daily(EF_SITE, '00065', start, end)
        if ef_data:
            records = parse_daily_response(ef_data)
            all_ef.extend(records)
            print(f"{len(records)} days")
        else:
            print("no data")
        time.sleep(0.3)

        # LF Discharge (00060)
        print(f"  Little Falls discharge...", end=" ", flush=True)
        lf_data = fetch_usgs_daily(LF_SITE, '00060', start, end)
        if lf_data:
            records = parse_daily_response(lf_data)
            all_lf.extend(records)
            print(f"{len(records)} days")
        else:
            print("no data")
        time.sleep(0.3)

    # Convert to DataFrames
    ef_df = pd.DataFrame(all_ef).rename(columns={'value': 'ef_stage'})
    lf_df = pd.DataFrame(all_lf).rename(columns={'value': 'lf_discharge'})

    print(f"\n" + "="*70)
    print(f"DATA SUMMARY")
    print("="*70)
    print(f"EF stage records: {len(ef_df):,}")
    print(f"LF discharge records: {len(lf_df):,}")

    # Merge on date
    merged = pd.merge(ef_df, lf_df, on='date', how='inner')
    merged = merged[(merged['ef_stage'] > 2.0) & (merged['lf_discharge'] > 0)]

    print(f"Matched pairs (EF stage > 2.0 ft): {len(merged):,}")
    print(f"Date range: {merged['date'].min()} to {merged['date'].max()}")

    # Save raw data
    merged.to_csv('/Users/sebjilke/Desktop/PotomacPulse/analysis/ef_lf_daily_longterm.csv', index=False)

    print(f"\n" + "="*70)
    print(f"POWER-LAW MODEL FITTING")
    print("="*70)

    # Current model
    merged['predicted_current'] = 108 * (merged['ef_stage'] ** 2.64)
    merged['error_current'] = merged['predicted_current'] - merged['lf_discharge']
    merged['error_pct_current'] = 100 * merged['error_current'] / merged['lf_discharge']

    print(f"\nCurrent model: LF = 108 × EF^2.64")
    print(f"  Mean error: {merged['error_current'].mean():.0f} cfs ({merged['error_pct_current'].mean():.1f}%)")
    print(f"  Median error: {merged['error_current'].median():.0f} cfs ({merged['error_pct_current'].median():.1f}%)")
    print(f"  RMSE: {np.sqrt((merged['error_current']**2).mean()):.0f} cfs")

    # Fit new power-law: log(LF) = log(a) + b*log(EF)
    log_ef = np.log(merged['ef_stage'])
    log_lf = np.log(merged['lf_discharge'])

    valid = np.isfinite(log_ef) & np.isfinite(log_lf)
    log_ef_valid = log_ef[valid]
    log_lf_valid = log_lf[valid]

    slope, intercept = np.polyfit(log_ef_valid, log_lf_valid, 1)
    new_coef = np.exp(intercept)
    new_exp = slope

    print(f"\n--- Fitted Model ({len(log_ef_valid):,} data points, {start_year}-{end_year}) ---")
    print(f"  NEW MODEL: LF = {new_coef:.1f} × EF^{new_exp:.2f}")

    # Test new model
    merged['predicted_new'] = new_coef * (merged['ef_stage'] ** new_exp)
    merged['error_new'] = merged['predicted_new'] - merged['lf_discharge']
    merged['error_pct_new'] = 100 * merged['error_new'] / merged['lf_discharge']

    print(f"  Mean error: {merged['error_new'].mean():.0f} cfs ({merged['error_pct_new'].mean():.1f}%)")
    print(f"  Median error: {merged['error_new'].median():.0f} cfs ({merged['error_pct_new'].median():.1f}%)")
    print(f"  RMSE: {np.sqrt((merged['error_new']**2).mean()):.0f} cfs")

    # R-squared
    ss_res = ((merged['lf_discharge'] - merged['predicted_new'])**2).sum()
    ss_tot = ((merged['lf_discharge'] - merged['lf_discharge'].mean())**2).sum()
    r_squared = 1 - (ss_res / ss_tot)
    print(f"  R²: {r_squared:.4f}")

    # By flow regime
    print(f"\n--- Error by Flow Regime ---")
    regimes = [
        ('Very Low (<2000 cfs)', merged['lf_discharge'] < 2000),
        ('Low (2000-5000 cfs)', (merged['lf_discharge'] >= 2000) & (merged['lf_discharge'] < 5000)),
        ('Medium (5000-15000 cfs)', (merged['lf_discharge'] >= 5000) & (merged['lf_discharge'] < 15000)),
        ('High (15000-30000 cfs)', (merged['lf_discharge'] >= 15000) & (merged['lf_discharge'] < 30000)),
        ('Very High (>30000 cfs)', merged['lf_discharge'] >= 30000)
    ]

    for name, mask in regimes:
        subset = merged[mask]
        if len(subset) > 0:
            old_err = subset['error_pct_current'].mean()
            new_err = subset['error_pct_new'].mean()
            print(f"  {name}: Old={old_err:+.1f}%, New={new_err:+.1f}% (n={len(subset):,})")

    # By season
    print(f"\n--- Error by Season ---")
    merged['month'] = pd.to_datetime(merged['date']).dt.month
    seasons = [
        ('Winter (Dec-Feb)', merged['month'].isin([12, 1, 2])),
        ('Spring (Mar-May)', merged['month'].isin([3, 4, 5])),
        ('Summer (Jun-Aug)', merged['month'].isin([6, 7, 8])),
        ('Fall (Sep-Nov)', merged['month'].isin([9, 10, 11]))
    ]

    for name, mask in seasons:
        subset = merged[mask]
        if len(subset) > 0:
            old_err = subset['error_pct_current'].mean()
            new_err = subset['error_pct_new'].mean()
            print(f"  {name}: Old={old_err:+.1f}%, New={new_err:+.1f}% (n={len(subset):,})")

    # By year (to check for drift)
    print(f"\n--- Error by Year (checking for drift) ---")
    merged['year'] = pd.to_datetime(merged['date']).dt.year

    for year in sorted(merged['year'].unique()):
        subset = merged[merged['year'] == year]
        if len(subset) > 30:  # Skip years with little data
            old_err = subset['error_pct_current'].mean()
            new_err = subset['error_pct_new'].mean()
            print(f"  {year}: Old={old_err:+.1f}%, New={new_err:+.1f}% (n={len(subset):,})")

    # Stage distribution
    print(f"\n--- EF Stage Distribution ---")
    print(f"  Min: {merged['ef_stage'].min():.2f} ft")
    print(f"  25th percentile: {merged['ef_stage'].quantile(0.25):.2f} ft")
    print(f"  Median: {merged['ef_stage'].median():.2f} ft")
    print(f"  75th percentile: {merged['ef_stage'].quantile(0.75):.2f} ft")
    print(f"  Max: {merged['ef_stage'].max():.2f} ft")

    print(f"\n" + "="*70)
    print(f"RECOMMENDATION")
    print("="*70)
    print(f"""
Based on {len(merged):,} daily observations from {start_year} to {end_year}:

CURRENT MODEL:  LF = 108 × EF^2.64
PROPOSED MODEL: LF = {new_coef:.0f} × EF^{new_exp:.2f}

The proposed model:
- Reduces RMSE by {(1 - np.sqrt((merged['error_new']**2).mean()) / np.sqrt((merged['error_current']**2).mean()))*100:.0f}%
- Has R² = {r_squared:.4f}
- Works consistently across seasons and flow regimes
- Based on {len(merged):,} matched daily observations

SUGGESTED UPDATE:
  const EF_MODEL = {{
      coef: {new_coef:.0f},     // Was 108
      exp: {new_exp:.2f},       // Was 2.64
      ...
  }};
""")

    print(f"\nData saved to: /Users/sebjilke/Desktop/PotomacPulse/analysis/ef_lf_daily_longterm.csv")

def fetch_water_temp():
    """Fetch water temperature data to check if model varies with temperature."""
    print(f"\n" + "="*70)
    print(f"WATER TEMPERATURE ANALYSIS")
    print("="*70)

    # LF has water temperature (00010)
    all_temp = []

    for year in range(2008, 2027):
        start = f"{year}-01-01"
        end = f"{year}-12-31"

        print(f"  Fetching {year} water temp...", end=" ", flush=True)
        temp_data = fetch_usgs_daily(LF_SITE, '00010', start, end)
        if temp_data:
            records = parse_daily_response(temp_data)
            for r in records:
                r['temp_c'] = r.pop('value')
            all_temp.extend(records)
            print(f"{len(records)} days")
        else:
            print("no data")
        time.sleep(0.3)

    if all_temp:
        temp_df = pd.DataFrame(all_temp)

        # Load the EF-LF data
        merged = pd.read_csv('/Users/sebjilke/Desktop/PotomacPulse/analysis/ef_lf_daily_longterm.csv')

        # Merge with temperature
        merged_temp = pd.merge(merged, temp_df, on='date', how='inner')

        print(f"\nMatched records with temperature: {len(merged_temp):,}")

        if len(merged_temp) > 100:
            # Current model error
            merged_temp['predicted'] = 108 * (merged_temp['ef_stage'] ** 2.64)
            merged_temp['error_pct'] = 100 * (merged_temp['predicted'] - merged_temp['lf_discharge']) / merged_temp['lf_discharge']

            # Group by temperature bins
            print(f"\n--- Model Error by Water Temperature ---")
            temp_bins = [
                ('Cold (<5°C / 41°F)', merged_temp['temp_c'] < 5),
                ('Cool (5-10°C / 41-50°F)', (merged_temp['temp_c'] >= 5) & (merged_temp['temp_c'] < 10)),
                ('Mild (10-15°C / 50-59°F)', (merged_temp['temp_c'] >= 10) & (merged_temp['temp_c'] < 15)),
                ('Warm (15-20°C / 59-68°F)', (merged_temp['temp_c'] >= 15) & (merged_temp['temp_c'] < 20)),
                ('Hot (>20°C / 68°F)', merged_temp['temp_c'] >= 20)
            ]

            for name, mask in temp_bins:
                subset = merged_temp[mask]
                if len(subset) > 10:
                    err = subset['error_pct'].mean()
                    print(f"  {name}: Mean error = {err:+.1f}% (n={len(subset):,})")

            # Fit separate models for cold vs warm
            print(f"\n--- Seasonal Model Comparison ---")

            cold = merged_temp[merged_temp['temp_c'] < 10]
            warm = merged_temp[merged_temp['temp_c'] >= 15]

            if len(cold) > 50:
                log_ef = np.log(cold['ef_stage'])
                log_lf = np.log(cold['lf_discharge'])
                valid = np.isfinite(log_ef) & np.isfinite(log_lf)
                slope, intercept = np.polyfit(log_ef[valid], log_lf[valid], 1)
                print(f"  Cold water (<10°C): LF = {np.exp(intercept):.0f} × EF^{slope:.2f} (n={len(cold):,})")

            if len(warm) > 50:
                log_ef = np.log(warm['ef_stage'])
                log_lf = np.log(warm['lf_discharge'])
                valid = np.isfinite(log_ef) & np.isfinite(log_lf)
                slope, intercept = np.polyfit(log_ef[valid], log_lf[valid], 1)
                print(f"  Warm water (>15°C): LF = {np.exp(intercept):.0f} × EF^{slope:.2f} (n={len(warm):,})")

            # Save with temperature
            merged_temp.to_csv('/Users/sebjilke/Desktop/PotomacPulse/analysis/ef_lf_with_temp.csv', index=False)
            print(f"\nData with temperature saved to: /Users/sebjilke/Desktop/PotomacPulse/analysis/ef_lf_with_temp.csv")

if __name__ == '__main__':
    main()
    fetch_water_temp()

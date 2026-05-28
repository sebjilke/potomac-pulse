#!/usr/bin/env python3
"""
USGS Ice Detection Analysis - Phase A: Data Collection
Fetches 10 years of winter data (Dec-Feb) for Potomac gauges to analyze ice patterns.

Gauges:
- Point of Rocks (01638500) - primary predictor
- Little Falls (01646500) - target gauge
- Edwards Ferry (01644148) - stage-only ensemble input
"""

import requests
import json
import pandas as pd
from datetime import datetime, timedelta
import time

# USGS gauge IDs
GAUGES = {
    'por': {'id': '01638500', 'name': 'Point of Rocks'},
    'lf': {'id': '01646500', 'name': 'Little Falls'},
    'ef': {'id': '01644148', 'name': 'Edwards Ferry'}
}

# Parameters: 00060 = discharge (cfs), 00065 = stage (ft)
PARAMS = {
    'discharge': '00060',
    'stage': '00065'
}

def fetch_usgs_data(site_id, param_code, start_date, end_date):
    """Fetch USGS instantaneous values with qualifiers."""
    url = "https://waterservices.usgs.gov/nwis/iv/"
    params = {
        'sites': site_id,
        'parameterCd': param_code,
        'startDT': start_date,
        'endDT': end_date,
        'format': 'json',
        'siteStatus': 'all'
    }

    try:
        response = requests.get(url, params=params, timeout=60)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"  Error fetching {site_id}/{param_code}: {e}")
        return None

def parse_usgs_response(data, gauge_name, param_name):
    """Parse USGS JSON response, extracting values and ice qualifiers."""
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
                timestamp = v.get('dateTime', '')
                value = float(v.get('value', -999999))
                qualifiers = v.get('qualifiers', [])

                # Check for ice flag
                is_ice = 'Ice' in qualifiers or value <= -999999

                records.append({
                    'gauge': gauge_name,
                    'param': param_name,
                    'timestamp': timestamp,
                    'value': value if value > -999999 else None,
                    'qualifiers': ','.join(qualifiers) if qualifiers else '',
                    'is_ice': is_ice
                })
            except (ValueError, TypeError):
                continue

    return records

def fetch_winter_data(years_back=10):
    """Fetch winter months (Dec-Feb) for multiple years."""
    all_records = []
    current_year = datetime.now().year

    for year in range(current_year - years_back, current_year + 1):
        # Winter spans Dec of previous year to Feb of current year
        # So for "winter 2024" we want Dec 2023, Jan 2024, Feb 2024

        # December of previous year
        dec_start = f"{year-1}-12-01"
        dec_end = f"{year-1}-12-31"

        # January-February of current year
        jan_feb_start = f"{year}-01-01"
        jan_feb_end = f"{year}-02-28"

        print(f"\n=== Winter {year} (Dec {year-1} - Feb {year}) ===")

        for period_name, start, end in [("Dec", dec_start, dec_end), ("Jan-Feb", jan_feb_start, jan_feb_end)]:
            print(f"  Fetching {period_name}...")

            for gauge_key, gauge_info in GAUGES.items():
                site_id = gauge_info['id']
                gauge_name = gauge_info['name']

                # Fetch discharge (all gauges except EF which is stage-only)
                if gauge_key != 'ef':
                    print(f"    {gauge_name} discharge...", end=" ", flush=True)
                    data = fetch_usgs_data(site_id, PARAMS['discharge'], start, end)
                    if data:
                        records = parse_usgs_response(data, gauge_name, 'discharge')
                        all_records.extend(records)
                        ice_count = sum(1 for r in records if r['is_ice'])
                        print(f"{len(records)} records, {ice_count} ice-flagged")
                    else:
                        print("no data")
                    time.sleep(0.5)  # Rate limiting

                # Fetch stage (all gauges)
                print(f"    {gauge_name} stage...", end=" ", flush=True)
                data = fetch_usgs_data(site_id, PARAMS['stage'], start, end)
                if data:
                    records = parse_usgs_response(data, gauge_name, 'stage')
                    all_records.extend(records)
                    ice_count = sum(1 for r in records if r['is_ice'])
                    print(f"{len(records)} records, {ice_count} ice-flagged")
                else:
                    print("no data")
                time.sleep(0.5)  # Rate limiting

    return all_records

def analyze_ice_patterns(df):
    """Analyze ice detection patterns."""
    print("\n" + "="*60)
    print("ICE DETECTION ANALYSIS")
    print("="*60)

    # Overall statistics
    print(f"\nTotal records: {len(df):,}")
    print(f"Ice-flagged records: {df['is_ice'].sum():,} ({100*df['is_ice'].mean():.2f}%)")

    # By gauge and parameter
    print("\n--- By Gauge & Parameter ---")
    for gauge in df['gauge'].unique():
        gauge_df = df[df['gauge'] == gauge]
        print(f"\n{gauge}:")
        for param in gauge_df['param'].unique():
            param_df = gauge_df[gauge_df['param'] == param]
            ice_pct = 100 * param_df['is_ice'].mean()
            print(f"  {param}: {len(param_df):,} records, {param_df['is_ice'].sum():,} ice ({ice_pct:.2f}%)")

    # Analyze discharge values during ice vs normal
    print("\n--- Discharge During Ice vs Normal ---")
    discharge_df = df[(df['param'] == 'discharge') & (df['value'].notna())]

    for gauge in discharge_df['gauge'].unique():
        gauge_df = discharge_df[discharge_df['gauge'] == gauge]

        normal = gauge_df[~gauge_df['is_ice']]['value']
        ice = gauge_df[gauge_df['is_ice']]['value']

        if len(normal) > 0 and len(ice) > 0:
            print(f"\n{gauge}:")
            print(f"  Normal: mean={normal.mean():.0f} cfs, median={normal.median():.0f} cfs, n={len(normal):,}")
            print(f"  Ice:    mean={ice.mean():.0f} cfs, median={ice.median():.0f} cfs, n={len(ice):,}")

    # Analyze stage values during ice vs normal
    print("\n--- Stage During Ice vs Normal ---")
    stage_df = df[(df['param'] == 'stage') & (df['value'].notna())]

    for gauge in stage_df['gauge'].unique():
        gauge_df = stage_df[stage_df['gauge'] == gauge]

        normal = gauge_df[~gauge_df['is_ice']]['value']
        ice = gauge_df[gauge_df['is_ice']]['value']

        if len(normal) > 0 and len(ice) > 0:
            print(f"\n{gauge}:")
            print(f"  Normal: mean={normal.mean():.2f} ft, median={normal.median():.2f} ft, n={len(normal):,}")
            print(f"  Ice:    mean={ice.mean():.2f} ft, median={ice.median():.2f} ft, n={len(ice):,}")

    return df

def analyze_stage_discharge_relationship(df):
    """Analyze the stage-discharge relationship during ice vs normal conditions."""
    print("\n" + "="*60)
    print("STAGE-DISCHARGE RELATIONSHIP ANALYSIS")
    print("="*60)

    # Pivot to get stage and discharge for same timestamps
    # Focus on Little Falls which has both
    lf_discharge = df[(df['gauge'] == 'Little Falls') & (df['param'] == 'discharge')].copy()
    lf_stage = df[(df['gauge'] == 'Little Falls') & (df['param'] == 'stage')].copy()

    # Parse timestamps and merge
    lf_discharge['ts'] = pd.to_datetime(lf_discharge['timestamp'])
    lf_stage['ts'] = pd.to_datetime(lf_stage['timestamp'])

    # Round to nearest 15 minutes for matching
    lf_discharge['ts_round'] = lf_discharge['ts'].dt.round('15min')
    lf_stage['ts_round'] = lf_stage['ts'].dt.round('15min')

    merged = pd.merge(
        lf_discharge[['ts_round', 'value', 'is_ice']].rename(columns={'value': 'discharge', 'is_ice': 'discharge_ice'}),
        lf_stage[['ts_round', 'value', 'is_ice']].rename(columns={'value': 'stage', 'is_ice': 'stage_ice'}),
        on='ts_round',
        how='inner'
    )

    # Either parameter ice-flagged = ice condition
    merged['is_ice'] = merged['discharge_ice'] | merged['stage_ice']
    merged = merged[(merged['discharge'].notna()) & (merged['stage'].notna())]

    print(f"\nMatched stage-discharge pairs: {len(merged):,}")
    print(f"Ice conditions: {merged['is_ice'].sum():,} ({100*merged['is_ice'].mean():.2f}%)")

    # Analyze the expected flow from stage using our rating curve
    # LF rating: flow = 108 * stage^2.64 (approximately)
    merged['expected_flow'] = 108 * (merged['stage'] ** 2.64)
    merged['discrepancy'] = (merged['expected_flow'] - merged['discharge']) / merged['discharge']

    print("\n--- Stage-Discharge Discrepancy (expected_flow - actual) / actual ---")

    normal = merged[~merged['is_ice']]
    ice = merged[merged['is_ice']]

    if len(normal) > 0:
        print(f"\nNormal conditions (n={len(normal):,}):")
        print(f"  Discrepancy: mean={100*normal['discrepancy'].mean():.1f}%, median={100*normal['discrepancy'].median():.1f}%")
        print(f"  Discrepancy 10th-90th percentile: {100*normal['discrepancy'].quantile(0.1):.1f}% to {100*normal['discrepancy'].quantile(0.9):.1f}%")

    if len(ice) > 0:
        print(f"\nIce conditions (n={len(ice):,}):")
        print(f"  Discrepancy: mean={100*ice['discrepancy'].mean():.1f}%, median={100*ice['discrepancy'].median():.1f}%")
        print(f"  Discrepancy 10th-90th percentile: {100*ice['discrepancy'].quantile(0.1):.1f}% to {100*ice['discrepancy'].quantile(0.9):.1f}%")

    # Find optimal threshold
    print("\n--- Threshold Analysis for Stage-Discharge Discrepancy ---")
    print("(Looking for threshold that separates ice from normal)")

    thresholds = [0.20, 0.25, 0.30, 0.35, 0.40, 0.50, 0.60]

    for thresh in thresholds:
        if len(normal) > 0 and len(ice) > 0:
            # True positive: ice correctly flagged (discrepancy > threshold AND is_ice)
            tp = ((ice['discrepancy'] > thresh)).sum()
            # False negative: ice missed (discrepancy <= threshold AND is_ice)
            fn = ((ice['discrepancy'] <= thresh)).sum()
            # False positive: normal incorrectly flagged (discrepancy > threshold AND NOT is_ice)
            fp = ((normal['discrepancy'] > thresh)).sum()
            # True negative: normal correctly passed
            tn = ((normal['discrepancy'] <= thresh)).sum()

            sensitivity = tp / (tp + fn) if (tp + fn) > 0 else 0  # True positive rate
            specificity = tn / (tn + fp) if (tn + fp) > 0 else 0  # True negative rate

            print(f"  Threshold {100*thresh:.0f}%: Sensitivity={100*sensitivity:.1f}% (ice caught), Specificity={100*specificity:.1f}% (normal passed)")

    return merged

def analyze_low_flow_high_stage(df):
    """Analyze the low-flow + high-stage ice signature."""
    print("\n" + "="*60)
    print("LOW-FLOW + HIGH-STAGE SIGNATURE ANALYSIS")
    print("="*60)

    # Get Little Falls stage-discharge pairs (reusing logic from above)
    lf_discharge = df[(df['gauge'] == 'Little Falls') & (df['param'] == 'discharge')].copy()
    lf_stage = df[(df['gauge'] == 'Little Falls') & (df['param'] == 'stage')].copy()

    lf_discharge['ts'] = pd.to_datetime(lf_discharge['timestamp'])
    lf_stage['ts'] = pd.to_datetime(lf_stage['timestamp'])

    lf_discharge['ts_round'] = lf_discharge['ts'].dt.round('15min')
    lf_stage['ts_round'] = lf_stage['ts'].dt.round('15min')

    merged = pd.merge(
        lf_discharge[['ts_round', 'value', 'is_ice']].rename(columns={'value': 'discharge', 'is_ice': 'discharge_ice'}),
        lf_stage[['ts_round', 'value', 'is_ice']].rename(columns={'value': 'stage', 'is_ice': 'stage_ice'}),
        on='ts_round',
        how='inner'
    )

    merged['is_ice'] = merged['discharge_ice'] | merged['stage_ice']
    merged = merged[(merged['discharge'].notna()) & (merged['stage'].notna())]

    # Current thresholds: <1500 cfs AND >2.45 ft
    print("\nCurrent threshold: flow < 1500 cfs AND stage > 2.45 ft")

    current_flagged = (merged['discharge'] < 1500) & (merged['stage'] > 2.45)
    current_ice = merged['is_ice']

    tp = (current_flagged & current_ice).sum()
    fp = (current_flagged & ~current_ice).sum()
    fn = (~current_flagged & current_ice).sum()
    tn = (~current_flagged & ~current_ice).sum()

    print(f"  True Positives (ice caught): {tp:,}")
    print(f"  False Positives (normal wrongly flagged): {fp:,}")
    print(f"  False Negatives (ice missed): {fn:,}")
    print(f"  True Negatives (normal passed): {tn:,}")

    if (tp + fn) > 0:
        print(f"  Sensitivity: {100*tp/(tp+fn):.1f}%")
    if (tn + fp) > 0:
        print(f"  Specificity: {100*tn/(tn+fp):.1f}%")

    # Try different flow thresholds
    print("\n--- Varying Flow Threshold (stage > 2.45 ft fixed) ---")
    for flow_thresh in [1000, 1200, 1500, 1800, 2000, 2500, 3000]:
        flagged = (merged['discharge'] < flow_thresh) & (merged['stage'] > 2.45)

        tp = (flagged & current_ice).sum()
        fp = (flagged & ~current_ice).sum()
        fn = (~flagged & current_ice).sum()
        tn = (~flagged & ~current_ice).sum()

        sens = 100*tp/(tp+fn) if (tp+fn) > 0 else 0
        spec = 100*tn/(tn+fp) if (tn+fp) > 0 else 0

        print(f"  Flow < {flow_thresh} cfs: Sens={sens:.1f}%, Spec={spec:.1f}%")

    # Try different stage thresholds
    print("\n--- Varying Stage Threshold (flow < 1500 cfs fixed) ---")
    for stage_thresh in [2.0, 2.2, 2.4, 2.45, 2.5, 2.6, 2.8, 3.0]:
        flagged = (merged['discharge'] < 1500) & (merged['stage'] > stage_thresh)

        tp = (flagged & current_ice).sum()
        fp = (flagged & ~current_ice).sum()
        fn = (~flagged & current_ice).sum()
        tn = (~flagged & ~current_ice).sum()

        sens = 100*tp/(tp+fn) if (tp+fn) > 0 else 0
        spec = 100*tn/(tn+fp) if (tn+fp) > 0 else 0

        print(f"  Stage > {stage_thresh} ft: Sens={sens:.1f}%, Spec={spec:.1f}%")

def main():
    print("USGS Ice Detection Analysis")
    print("="*60)
    print("Fetching 10 years of winter data (Dec-Feb) for Potomac gauges...")
    print("This may take several minutes due to API rate limiting.")

    # Fetch data
    records = fetch_winter_data(years_back=10)

    if not records:
        print("No data retrieved!")
        return

    # Convert to DataFrame
    df = pd.DataFrame(records)

    # Save raw data
    output_path = '/Users/sebjilke/Desktop/PotomacPulse/analysis/ice_data_raw.csv'
    df.to_csv(output_path, index=False)
    print(f"\nRaw data saved to: {output_path}")

    # Analyze patterns
    df = analyze_ice_patterns(df)

    # Stage-discharge analysis
    merged = analyze_stage_discharge_relationship(df)

    # Low-flow high-stage analysis
    analyze_low_flow_high_stage(df)

    # Save merged analysis data
    if merged is not None and len(merged) > 0:
        merged.to_csv('/Users/sebjilke/Desktop/PotomacPulse/analysis/ice_stage_discharge.csv', index=False)
        print(f"\nStage-discharge analysis saved to: /Users/sebjilke/Desktop/PotomacPulse/analysis/ice_stage_discharge.csv")

    print("\n" + "="*60)
    print("Analysis complete!")
    print("="*60)

if __name__ == '__main__':
    main()

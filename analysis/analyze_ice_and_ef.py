#!/usr/bin/env python3
"""
Deep analysis of:
1. 2025-2026 ice events - stage-discharge patterns during USGS-flagged ice
2. EF power-law model accuracy - is 108 × stage^2.64 correct?
"""

import pandas as pd
import numpy as np
from datetime import datetime

# Load the raw data
df = pd.read_csv('/Users/sebjilke/Desktop/PotomacPulse/analysis/ice_data_raw.csv')

print("="*70)
print("PART 1: ANALYZING 2025-2026 ICE EVENTS")
print("="*70)

# Filter to 2025-2026 winter (where the ice flags are)
df['timestamp'] = pd.to_datetime(df['timestamp'])
winter_2026 = df[df['timestamp'] >= '2025-12-01']

print(f"\nWinter 2025-2026 records: {len(winter_2026):,}")
print(f"Ice-flagged: {winter_2026['is_ice'].sum():,}")

# Get ice-flagged periods at Little Falls
lf_ice = winter_2026[(winter_2026['gauge'] == 'Little Falls') & (winter_2026['is_ice'])]
print(f"\nLittle Falls ice-flagged records: {len(lf_ice):,}")

# Show the date ranges of ice events
if len(lf_ice) > 0:
    print("\nIce event periods at Little Falls:")
    lf_ice_sorted = lf_ice.sort_values('timestamp')

    # Group into contiguous periods (gap > 6 hours = new event)
    lf_ice_sorted['time_diff'] = lf_ice_sorted['timestamp'].diff()
    lf_ice_sorted['new_event'] = lf_ice_sorted['time_diff'] > pd.Timedelta(hours=6)
    lf_ice_sorted['event_id'] = lf_ice_sorted['new_event'].cumsum()

    for event_id in lf_ice_sorted['event_id'].unique():
        event = lf_ice_sorted[lf_ice_sorted['event_id'] == event_id]
        start = event['timestamp'].min()
        end = event['timestamp'].max()
        duration = end - start
        print(f"  Event {event_id+1}: {start.strftime('%Y-%m-%d %H:%M')} to {end.strftime('%Y-%m-%d %H:%M')} ({duration})")

# Now let's look at stage-discharge during ice vs normal for this winter
print("\n" + "-"*70)
print("Stage-Discharge Analysis for Winter 2025-2026")
print("-"*70)

# Get LF discharge and stage for this winter
lf_discharge = winter_2026[(winter_2026['gauge'] == 'Little Falls') & (winter_2026['param'] == 'discharge')].copy()
lf_stage = winter_2026[(winter_2026['gauge'] == 'Little Falls') & (winter_2026['param'] == 'stage')].copy()

lf_discharge['ts_round'] = lf_discharge['timestamp'].dt.round('15min')
lf_stage['ts_round'] = lf_stage['timestamp'].dt.round('15min')

merged = pd.merge(
    lf_discharge[['ts_round', 'value', 'is_ice']].rename(columns={'value': 'discharge', 'is_ice': 'discharge_ice'}),
    lf_stage[['ts_round', 'value', 'is_ice']].rename(columns={'value': 'stage', 'is_ice': 'stage_ice'}),
    on='ts_round',
    how='inner'
)

merged['is_ice'] = merged['discharge_ice'] | merged['stage_ice']
merged = merged[(merged['discharge'].notna()) & (merged['stage'].notna()) & (merged['discharge'] > 0)]

print(f"\nMatched stage-discharge pairs: {len(merged):,}")
print(f"Ice conditions: {merged['is_ice'].sum():,} ({100*merged['is_ice'].mean():.1f}%)")

if len(merged) > 0 and merged['is_ice'].sum() > 0:
    normal = merged[~merged['is_ice']]
    ice = merged[merged['is_ice']]

    print(f"\n--- Normal Conditions (n={len(normal):,}) ---")
    if len(normal) > 0:
        print(f"  Discharge: mean={normal['discharge'].mean():.0f} cfs, median={normal['discharge'].median():.0f} cfs")
        print(f"  Stage: mean={normal['stage'].mean():.2f} ft, median={normal['stage'].median():.2f} ft")

    print(f"\n--- Ice Conditions (n={len(ice):,}) ---")
    if len(ice) > 0:
        print(f"  Discharge: mean={ice['discharge'].mean():.0f} cfs, median={ice['discharge'].median():.0f} cfs")
        print(f"  Stage: mean={ice['stage'].mean():.2f} ft, median={ice['stage'].median():.2f} ft")

        # The key insight: during ice, stage stays elevated but discharge drops
        # because ice dampens the ADVM signal
        print(f"\n  Key ratios during ice:")
        print(f"    Discharge/Stage ratio: {(ice['discharge']/ice['stage']).mean():.0f} cfs/ft")
        if len(normal) > 0:
            print(f"    (Normal ratio: {(normal['discharge']/normal['stage']).mean():.0f} cfs/ft)")

print("\n" + "="*70)
print("PART 2: EF POWER-LAW MODEL ACCURACY")
print("="*70)

# The current model: LF_cfs = 108 × EF_stage^2.64
# Let's check this against actual data

# Get EF stage and LF discharge for ALL winters (non-ice periods)
all_ef_stage = df[(df['gauge'] == 'Edwards Ferry') & (df['param'] == 'stage') & (~df['is_ice'])].copy()
all_lf_discharge = df[(df['gauge'] == 'Little Falls') & (df['param'] == 'discharge') & (~df['is_ice'])].copy()

all_ef_stage['ts_round'] = pd.to_datetime(all_ef_stage['timestamp']).dt.round('15min')
all_lf_discharge['ts_round'] = pd.to_datetime(all_lf_discharge['timestamp']).dt.round('15min')

ef_lf = pd.merge(
    all_ef_stage[['ts_round', 'value']].rename(columns={'value': 'ef_stage'}),
    all_lf_discharge[['ts_round', 'value']].rename(columns={'value': 'lf_discharge'}),
    on='ts_round',
    how='inner'
)

ef_lf = ef_lf[(ef_lf['ef_stage'].notna()) & (ef_lf['lf_discharge'].notna()) &
              (ef_lf['ef_stage'] > 2.0) & (ef_lf['lf_discharge'] > 0)]

print(f"\nEF-LF matched pairs (non-ice): {len(ef_lf):,}")

if len(ef_lf) > 0:
    # Current model prediction
    ef_lf['predicted'] = 108 * (ef_lf['ef_stage'] ** 2.64)
    ef_lf['error'] = ef_lf['predicted'] - ef_lf['lf_discharge']
    ef_lf['error_pct'] = 100 * ef_lf['error'] / ef_lf['lf_discharge']

    print(f"\nCurrent model: LF = 108 × EF_stage^2.64")
    print(f"  Mean error: {ef_lf['error'].mean():.0f} cfs ({ef_lf['error_pct'].mean():.1f}%)")
    print(f"  Median error: {ef_lf['error'].median():.0f} cfs ({ef_lf['error_pct'].median():.1f}%)")
    print(f"  RMSE: {np.sqrt((ef_lf['error']**2).mean()):.0f} cfs")

    # Fit a new power-law model using least squares on log-log
    # log(LF) = log(a) + b*log(EF)
    log_ef = np.log(ef_lf['ef_stage'])
    log_lf = np.log(ef_lf['lf_discharge'])

    # Remove any inf/nan
    valid = np.isfinite(log_ef) & np.isfinite(log_lf)
    log_ef = log_ef[valid]
    log_lf = log_lf[valid]

    if len(log_ef) > 100:
        # Linear regression in log space
        slope, intercept = np.polyfit(log_ef, log_lf, 1)
        new_coef = np.exp(intercept)
        new_exp = slope

        print(f"\n--- Fitted Model (from {len(log_ef):,} data points) ---")
        print(f"  New model: LF = {new_coef:.1f} × EF_stage^{new_exp:.2f}")

        # Test new model
        ef_lf['predicted_new'] = new_coef * (ef_lf['ef_stage'] ** new_exp)
        ef_lf['error_new'] = ef_lf['predicted_new'] - ef_lf['lf_discharge']
        ef_lf['error_pct_new'] = 100 * ef_lf['error_new'] / ef_lf['lf_discharge']

        print(f"  Mean error: {ef_lf['error_new'].mean():.0f} cfs ({ef_lf['error_pct_new'].mean():.1f}%)")
        print(f"  Median error: {ef_lf['error_new'].median():.0f} cfs ({ef_lf['error_pct_new'].median():.1f}%)")
        print(f"  RMSE: {np.sqrt((ef_lf['error_new']**2).mean()):.0f} cfs")

        # R-squared
        ss_res = ((ef_lf['lf_discharge'] - ef_lf['predicted_new'])**2).sum()
        ss_tot = ((ef_lf['lf_discharge'] - ef_lf['lf_discharge'].mean())**2).sum()
        r_squared = 1 - (ss_res / ss_tot)
        print(f"  R²: {r_squared:.4f}")

        # Compare by flow regime
        print(f"\n--- Error by Flow Regime ---")
        regimes = [
            ('Low (<3000 cfs)', ef_lf['lf_discharge'] < 3000),
            ('Medium (3000-10000 cfs)', (ef_lf['lf_discharge'] >= 3000) & (ef_lf['lf_discharge'] < 10000)),
            ('High (>10000 cfs)', ef_lf['lf_discharge'] >= 10000)
        ]

        for name, mask in regimes:
            subset = ef_lf[mask]
            if len(subset) > 0:
                old_err = subset['error_pct'].mean()
                new_err = subset['error_pct_new'].mean()
                print(f"  {name}: Old={old_err:.1f}%, New={new_err:.1f}% (n={len(subset):,})")

print("\n" + "="*70)
print("PART 3: IMPACT ON APP - WHERE IS EF MODEL USED?")
print("="*70)

print("""
The EF power-law model (LF = 108 × EF^2.64) is used in:

1. GF ENSEMBLE PREDICTION (index.html, scheduled-update.js)
   - 60% PoR time-shifted + 40% EF power-law
   - If EF underestimates, GF predictions will be biased low

2. ICE DETECTION - EF CROSS-CHECK (scheduled-update.js:533)
   - Compares EF estimate to actual LF
   - If EF systematically underestimates, we'll get false positives!
   - Threshold: (efEstimate - actualLF) / actualLF > 0.25
   - But if EF underestimates by 40%, this will NEVER trigger!

3. EF-ONLY FALLBACK (when PoR ice-affected)
   - Uses 100% EF power-law
   - Underestimation directly affects displayed flow

CRITICAL FINDING: If EF model underestimates by ~40%, the ice detection
EF cross-check is essentially disabled! It looks for EF >> LF (ice signature),
but if EF is always << LF, it will never trigger.
""")

# Check the actual discrepancy distribution
print("\n--- Actual EF Discrepancy Distribution ---")
ef_lf['discrepancy'] = (ef_lf['predicted'] - ef_lf['lf_discharge']) / ef_lf['lf_discharge']

print(f"Discrepancy (predicted - actual) / actual:")
print(f"  Mean: {100*ef_lf['discrepancy'].mean():.1f}%")
print(f"  Median: {100*ef_lf['discrepancy'].median():.1f}%")
print(f"  10th percentile: {100*ef_lf['discrepancy'].quantile(0.10):.1f}%")
print(f"  90th percentile: {100*ef_lf['discrepancy'].quantile(0.90):.1f}%")

# How often would current threshold (>25%) trigger?
positive_disc = ef_lf['discrepancy'] > 0.25
print(f"\n  Records with discrepancy > +25%: {positive_disc.sum():,} ({100*positive_disc.mean():.1f}%)")
print(f"  (This is how often EF cross-check would flag as suspicious)")

print("\n" + "="*70)
print("RECOMMENDATIONS")
print("="*70)
print("""
1. UPDATE EF MODEL COEFFICIENTS
   - Current: 108 × stage^2.64
   - Suggested: Use fitted values from this analysis
   - Update in: index.html, scheduled-update.js, sync-learning.js

2. FIX ICE DETECTION LOGIC
   - Current EF cross-check looks for EF >> LF
   - With fixed model, this should work correctly
   - May need to re-tune the 25% threshold

3. VALIDATE WITH 2025-2026 ICE DATA
   - Use USGS ice-flagged records as ground truth
   - Check if new thresholds correctly identify ice
""")

# Save analysis data
ef_lf.to_csv('/Users/sebjilke/Desktop/PotomacPulse/analysis/ef_lf_comparison.csv', index=False)
print(f"\nEF-LF comparison data saved to: /Users/sebjilke/Desktop/PotomacPulse/analysis/ef_lf_comparison.csv")

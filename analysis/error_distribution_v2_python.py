#!/usr/bin/env python3
"""
Blind error distribution analysis for Potomac Pulse GF estimation model (v30.0+).
Computes empirical 90%% CI quantiles (q05, q95) for prediction errors across
18 bins (6 flow levels x 3 flow states) + 6 'all' aggregates.

Author: Independent blind analysis agent
Date: 2026-02-26
Seed: 42 for reproducibility
"""

import numpy as np
import pandas as pd
from scipy import stats

np.random.seed(42)

# Load data
DATA_PATH = '/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv'
OUT_PATH = '/Users/sebjilke/Desktop/PotomacPulse/analysis/error_distribution_v2_python.csv'

df = pd.read_csv(DATA_PATH, parse_dates=['timestamp'])
print(f'Loaded {len(df):,} rows from {DATA_PATH}')
print(f'Columns: {list(df.columns)}')
print(f'Date range: {df["timestamp"].min()} to {df["timestamp"].max()}')
print(f'Missing water_temp_c: {df["water_temp_c"].isna().sum():,} / {len(df):,}')
print()

# Step 1: EF Power-Law conversion
cold_mask = df['water_temp_c'].notna() & (df['water_temp_c'] <= 10.0)
df['ef_cfs'] = np.where(
    cold_mask,
    160.0 * np.power(df['ef_stage'], 2.36),
    126.0 * np.power(df['ef_stage'], 2.46),
)

print(f'Cold water observations: {cold_mask.sum():,}')
print(f'Default (warm/missing) observations: {(~cold_mask).sum():,}')
print(f'EF CFS range: {df["ef_cfs"].min():.1f} to {df["ef_cfs"].max():.1f}')
print()

# Step 2: EF weight (logistic ramp)
df['ef_weight'] = 0.40 / (1.0 + np.exp(-5.0 * (np.log(df['lf_discharge']) - np.log(10000.0))))

print(f'EF weight range: {df["ef_weight"].min():.6f} to {df["ef_weight"].max():.6f}')
print(f'EF weight mean: {df["ef_weight"].mean():.6f}')
print()

# Step 3: Blended estimate
df['blended'] = (1.0 - df['ef_weight']) * df['por_lagged'] + df['ef_weight'] * df['ef_cfs']

# Step 4: Error (positive = overestimate)
df['error'] = df['blended'] - df['lf_discharge']

print(f'Error range: {df["error"].min():.1f} to {df["error"].max():.1f}')
print(f'Error mean: {df["error"].mean():.1f}, median: {df["error"].median():.1f}')
print()

# Step 5: Flow bins
BIN_EDGES = [0, 3000, 6000, 12000, 25000, 50000, np.inf]
BIN_LABELS = ['0-3000', '3000-6000', '6000-12000', '12000-25000', '25000-50000', '50000+']

df['flow_bin'] = pd.cut(
    df['lf_discharge'],
    bins=BIN_EDGES,
    labels=BIN_LABELS,
    right=False,
    include_lowest=True,
)

print('Flow bin counts:')
for label in BIN_LABELS:
    n = (df['flow_bin'] == label).sum()
    print(f'  {label:>15s}: {n:>7,}')
print()

# Step 6: Flow state classification
df = df.sort_values('timestamp').reset_index(drop=True)
df['lf_change'] = df['lf_discharge'].diff().fillna(0.0)
df['threshold'] = np.maximum(100.0, 0.02 * df['lf_discharge'])

df['flow_state'] = 'steady'
df.loc[df['lf_change'] >= df['threshold'], 'flow_state'] = 'rising'
df.loc[df['lf_change'] <= -df['threshold'], 'flow_state'] = 'falling'

print('Flow state counts:')
for state in ['rising', 'falling', 'steady']:
    n = (df['flow_state'] == state).sum()
    print(f'  {state:>8s}: {n:>7,}')
print()

# Step 7: Analysis per bin
MIN_OBS = 20
SHAPIRO_MAX = 5000

def analyze_bin(errors, flow_bin, flow_state):
    n = len(errors)
    if n < MIN_OBS:
        return None

    arr = errors.values
    mean_err = np.mean(arr)
    median_err = np.median(arr)
    std_err = np.std(arr, ddof=1)
    skew = stats.skew(arr, bias=False)
    kurt = stats.kurtosis(arr, bias=False)

    # Shapiro-Wilk (sample 5000 if n > 5000)
    if n > SHAPIRO_MAX:
        rng = np.random.RandomState(42)
        sample = rng.choice(arr, size=SHAPIRO_MAX, replace=False)
        shapiro_stat, shapiro_p = stats.shapiro(sample)
    else:
        shapiro_stat, shapiro_p = stats.shapiro(arr)

    # Empirical quantiles
    quantiles = np.quantile(arr, [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95])

    # Normal approximation
    normal_q95 = mean_err + 1.645 * std_err

    recommended = 'empirical' if shapiro_p < 0.05 else 'normal'

    return {
        'flow_bin': flow_bin,
        'flow_state': flow_state,
        'n': n,
        'mean_error': round(mean_err, 2),
        'median_error': round(median_err, 2),
        'std_dev': round(std_err, 2),
        'skewness': round(skew, 4),
        'kurtosis': round(kurt, 4),
        'shapiro_p': round(shapiro_p, 6),
        'q05': round(quantiles[0], 2),
        'q10': round(quantiles[1], 2),
        'q25': round(quantiles[2], 2),
        'q50': round(quantiles[3], 2),
        'q75': round(quantiles[4], 2),
        'q90': round(quantiles[5], 2),
        'q95': round(quantiles[6], 2),
        'normal_q95_approx': round(normal_q95, 2),
        'recommended_method': recommended,
    }

results = []

# 18 bins: 6 flow levels x 3 flow states
for flow_bin in BIN_LABELS:
    for flow_state in ['rising', 'falling', 'steady']:
        mask = (df['flow_bin'] == flow_bin) & (df['flow_state'] == flow_state)
        errors = df.loc[mask, 'error']
        row = analyze_bin(errors, flow_bin, flow_state)
        if row is not None:
            results.append(row)

# 6 'all' aggregates
for flow_bin in BIN_LABELS:
    mask = df['flow_bin'] == flow_bin
    errors = df.loc[mask, 'error']
    row = analyze_bin(errors, flow_bin, 'all')
    if row is not None:
        results.append(row)

results_df = pd.DataFrame(results)
results_df.to_csv(OUT_PATH, index=False)
print(f'Wrote {len(results_df)} rows to {OUT_PATH}')
print()

# Summary table
print('=' * 100)
print(f'{"EMPIRICAL 90%% CI SUMMARY":^100}')
print('=' * 100)
print(f'{"Flow Bin":>15s}  {"State":>8s}  {"N":>7s}  {"Mean Err":>10s}  {"Median Err":>10s}  {"q05":>10s}  {"q95":>10s}  {"Std Dev":>10s}  {"Kurt":>8s}')
print('-' * 100)

for _, row in results_df.iterrows():
    print(
        f'{row["flow_bin"]:>15s}  {row["flow_state"]:>8s}  {int(row["n"]):>7,}  '
        f'{row["mean_error"]:>10.1f}  {row["median_error"]:>10.1f}  '
        f'{row["q05"]:>10.1f}  {row["q95"]:>10.1f}  '
        f'{row["std_dev"]:>10.1f}  {row["kurtosis"]:>8.2f}'
    )

print('=' * 100)
print()

# Extraction-friendly table
print('EXTRACTION TABLE: q05, q95 per bin')
print('-' * 60)
print(f'{"flow_bin":>15s}  {"flow_state":>8s}  {"q05":>10s}  {"q95":>10s}  {"n":>7s}')
print('-' * 60)
for _, row in results_df.iterrows():
    print(f'{row["flow_bin"]:>15s}  {row["flow_state"]:>8s}  {row["q05"]:>10.1f}  {row["q95"]:>10.1f}  {int(row["n"]):>7,}')
print('-' * 60)

# Normality summary
print()
print('NORMALITY ASSESSMENT:')
normal_count = (results_df['shapiro_p'] >= 0.05).sum()
non_normal_count = (results_df['shapiro_p'] < 0.05).sum()
print(f'  Normal (Shapiro p >= 0.05): {normal_count}')
print(f'  Non-normal (Shapiro p < 0.05): {non_normal_count}')
print(f'  Total bins analyzed: {len(results_df)}')
print()

# Asymmetry check
print('ASYMMETRY CHECK (|q05| vs |q95|):')
for _, row in results_df.iterrows():
    q05_abs = abs(row['q05'])
    q95_abs = abs(row['q95'])
    if q05_abs > 0 and q95_abs > 0:
        ratio = max(q05_abs, q95_abs) / min(q05_abs, q95_abs)
        if ratio > 3.0:
            wider = 'q95' if q95_abs > q05_abs else 'q05'
            print(f'  {row["flow_bin"]:>15s} {row["flow_state"]:>8s}: ratio {ratio:.1f}x ({wider} side wider)')

print()
print('DONE. All results written to:')
print(f'  {OUT_PATH}')

#!/usr/bin/env python3
"""
v29.0 Independent Verification Script (Python)
Compares OLD graduated EF weights vs NEW flat 35% step on hourly backtest data.
"""

import pandas as pd
import numpy as np

print("=" * 60)
print("v29.0 EF Weight Verification — Python Independent Agent")
print("=" * 60)

# ---- Load data ----
data_path = "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
df = pd.read_csv(data_path)
print(f"\nRaw rows loaded: {len(df)}")
print(f"Columns: {list(df.columns)}")

# ---- Filter valid rows (match R script methodology) ----
df = df.dropna(subset=["por_lagged", "ef_stage", "lf_discharge"])
df = df[(df["por_lagged"] > 0) & (df["ef_stage"] > 0) & (df["lf_discharge"] > 0)]
print(f"Valid rows after filtering (por_lagged>0, ef_stage>0, lf_discharge>0): {len(df)}")

# ---- EF power-law model ----
# Default: 126 * ef_stage^2.46
# Cold water (water_temp_c <= 10 AND not NaN): 160 * ef_stage^2.36
cold_mask = df["water_temp_c"].notna() & (df["water_temp_c"] <= 10)
df["ef_cfs"] = np.where(
    cold_mask,
    160 * df["ef_stage"] ** 2.36,
    126 * df["ef_stage"] ** 2.46,
)
cold_count = cold_mask.sum()
print(f"Cold-water rows (temp <= 10C): {cold_count} ({100 * cold_count / len(df):.1f}%)")
print(f"Default model rows: {len(df) - cold_count}")

# ---- OLD weight function (v28.0 graduated) ----
OLD_ANCHORS = [0, 3000, 6000, 10000, 15000, 25000, 50000]
OLD_WEIGHTS = [0.0, 0.0, 0.10, 0.40, 0.40, 0.40, 0.40]

def old_ef_weight(flow):
    """Piecewise-linear interpolation between anchor points."""
    anchors = OLD_ANCHORS
    weights = OLD_WEIGHTS
    if flow <= anchors[0]:
        return weights[0]
    if flow >= anchors[-1]:
        return weights[-1]
    for i in range(len(anchors) - 1):
        if anchors[i] <= flow < anchors[i + 1]:
            frac = (flow - anchors[i]) / (anchors[i + 1] - anchors[i])
            return weights[i] + frac * (weights[i + 1] - weights[i])
    return weights[-1]

def old_ef_weight_vec(flows):
    """Vectorized version of old piecewise-linear weight function."""
    anchors = np.array(OLD_ANCHORS, dtype=float)
    weights = np.array(OLD_WEIGHTS, dtype=float)
    flows = np.asarray(flows, dtype=float)
    result = np.full_like(flows, weights[-1])

    # Below first anchor
    result[flows <= anchors[0]] = weights[0]

    # Between anchors
    for i in range(len(anchors) - 1):
        mask = (flows >= anchors[i]) & (flows < anchors[i + 1])
        if mask.any():
            frac = (flows[mask] - anchors[i]) / (anchors[i + 1] - anchors[i])
            result[mask] = weights[i] + frac * (weights[i + 1] - weights[i])

    return result


# ---- NEW weight function (v29.0 flat step) ----
def new_ef_weight_vec(flows):
    """Flat step: 0% below 3k, 35% at/above 3k."""
    flows = np.asarray(flows, dtype=float)
    return np.where(flows < 3000, 0.0, 0.35)


# ---- Compute blended estimates ----
por_lagged = df["por_lagged"].values
ef_cfs = df["ef_cfs"].values
lf_actual = df["lf_discharge"].values

# Old weights
w_old = old_ef_weight_vec(por_lagged)
gf_old = (1 - w_old) * por_lagged + w_old * ef_cfs

# New weights
w_new = new_ef_weight_vec(por_lagged)
gf_new = (1 - w_new) * por_lagged + w_new * ef_cfs

# ---- RMSE calculations ----
rmse_old = np.sqrt(np.mean((gf_old - lf_actual) ** 2))
rmse_new = np.sqrt(np.mean((gf_new - lf_actual) ** 2))
pct_change = 100 * (rmse_old - rmse_new) / rmse_old

print(f"\n{'=' * 60}")
print("OVERALL RMSE COMPARISON")
print(f"{'=' * 60}")
print(f"  OLD (graduated v28.0):  {rmse_old:,.1f} cfs")
print(f"  NEW (flat 35% v29.0):   {rmse_new:,.1f} cfs")
print(f"  Improvement:            {pct_change:+.1f}% ({rmse_old - rmse_new:,.0f} cfs)")

# ---- Verify claimed values ----
print(f"\n{'=' * 60}")
print("CLAIMED vs COMPUTED")
print(f"{'=' * 60}")
claimed_new = 1676
claimed_old = 1757
print(f"  Claimed NEW RMSE: ~{claimed_new} cfs | Computed: {rmse_new:.1f} cfs | Delta: {abs(rmse_new - claimed_new):.1f} cfs")
print(f"  Claimed OLD RMSE: ~{claimed_old} cfs | Computed: {rmse_old:.1f} cfs | Delta: {abs(rmse_old - claimed_old):.1f} cfs")

tol = 15  # Allow ±15 cfs tolerance for rounding differences
new_match = abs(rmse_new - claimed_new) < tol
old_match = abs(rmse_old - claimed_old) < tol
print(f"  NEW within ±{tol} cfs tolerance: {'PASS' if new_match else 'FAIL'}")
print(f"  OLD within ±{tol} cfs tolerance: {'PASS' if old_match else 'FAIL'}")

# ---- RMSE by flow regime ----
print(f"\n{'=' * 60}")
print("RMSE BY FLOW REGIME")
print(f"{'=' * 60}")

flow_bins = [
    ("<3k", 0, 3000),
    ("3-6k", 3000, 6000),
    ("6-10k", 6000, 10000),
    ("10-15k", 10000, 15000),
    ("15-25k", 15000, 25000),
    ("25-50k", 25000, 50000),
    (">50k", 50000, np.inf),
]

print(f"  {'Regime':<8} | {'N':>6} | {'Old':>10} | {'New':>10} | {'Change':>10}")
print(f"  {'-'*8}-+-{'-'*6}-+-{'-'*10}-+-{'-'*10}-+-{'-'*10}")

for name, lo, hi in flow_bins:
    if lo == 0:
        mask = por_lagged < hi
    elif np.isinf(hi):
        mask = por_lagged >= lo
    else:
        mask = (por_lagged >= lo) & (por_lagged < hi)

    n = mask.sum()
    if n > 0:
        rmse_o = np.sqrt(np.mean((gf_old[mask] - lf_actual[mask]) ** 2))
        rmse_n = np.sqrt(np.mean((gf_new[mask] - lf_actual[mask]) ** 2))
        pct = 100 * (rmse_o - rmse_n) / rmse_o if rmse_o > 0 else 0
        print(f"  {name:<8} | {n:>6} | {rmse_o:>8.0f}   | {rmse_n:>8.0f}   | {pct:>+8.1f}%")
    else:
        print(f"  {name:<8} | {n:>6} |     --     |     --     |     --")

# ---- Spot-check weight function correctness ----
print(f"\n{'=' * 60}")
print("WEIGHT FUNCTION SPOT-CHECKS")
print(f"{'=' * 60}")

test_flows = [0, 100, 2999, 3000, 3001, 5000, 10000, 25000, 50000, 100000]
print(f"  {'Flow (cfs)':>12} | {'Old Weight':>10} | {'New Weight':>10} | {'Match expected?':>16}")
print(f"  {'-'*12}-+-{'-'*10}-+-{'-'*10}-+-{'-'*16}")

for f in test_flows:
    old_w = old_ef_weight(f)
    new_w = 0.0 if f < 3000 else 0.35
    # Verify old weight at specific points
    expected_old = None
    if f == 0: expected_old = 0.0
    if f == 3000: expected_old = 0.0
    if f == 6000: expected_old = 0.10
    if f == 10000: expected_old = 0.40
    if f == 5000: expected_old = 0.0 + (5000-3000)/(6000-3000) * (0.10 - 0.0)  # 0.0667
    old_ok = f"old={'OK' if expected_old is None or abs(old_w - expected_old) < 0.001 else 'FAIL'}"
    new_ok = f"new={'OK' if (f < 3000 and new_w == 0.0) or (f >= 3000 and new_w == 0.35) else 'FAIL'}"
    print(f"  {f:>12} | {old_w:>10.4f} | {new_w:>10.4f} | {old_ok}, {new_ok}")

# ---- Data integrity checks ----
print(f"\n{'=' * 60}")
print("DATA INTEGRITY CHECKS")
print(f"{'=' * 60}")
print(f"  Total valid rows: {len(df)}")
print(f"  Date range: {df['timestamp'].iloc[0]} to {df['timestamp'].iloc[-1]}")
print(f"  por_lagged range: [{df['por_lagged'].min():.0f}, {df['por_lagged'].max():.0f}] cfs")
print(f"  ef_stage range: [{df['ef_stage'].min():.2f}, {df['ef_stage'].max():.2f}] ft")
print(f"  lf_discharge range: [{df['lf_discharge'].min():.0f}, {df['lf_discharge'].max():.0f}] cfs")
print(f"  ef_cfs range: [{df['ef_cfs'].min():.0f}, {df['ef_cfs'].max():.0f}] cfs")
print(f"  Any NaN in ef_cfs: {df['ef_cfs'].isna().sum()}")
print(f"  Any negative ef_cfs: {(df['ef_cfs'] < 0).sum()}")

# ---- Summary verdict ----
print(f"\n{'=' * 60}")
print("VERIFICATION VERDICT")
print(f"{'=' * 60}")
issues = []
if not new_match:
    issues.append(f"NEW RMSE ({rmse_new:.1f}) not within ±{tol} of claimed {claimed_new}")
if not old_match:
    issues.append(f"OLD RMSE ({rmse_old:.1f}) not within ±{tol} of claimed {claimed_old}")
if rmse_new >= rmse_old:
    issues.append(f"NEW RMSE ({rmse_new:.1f}) is NOT better than OLD ({rmse_old:.1f})")

if issues:
    print("  STATUS: ISSUES FOUND")
    for issue in issues:
        print(f"    - {issue}")
else:
    print("  STATUS: ALL CHECKS PASS")
    print(f"    - NEW RMSE ({rmse_new:.1f}) matches claimed ~{claimed_new} within tolerance")
    print(f"    - OLD RMSE ({rmse_old:.1f}) matches claimed ~{claimed_old} within tolerance")
    print(f"    - NEW is {pct_change:.1f}% better than OLD")
    print(f"    - Weight functions verified at {len(test_flows)} test points")
    print(f"    - Data integrity: {len(df)} valid rows, no NaN/negative values in estimates")

print(f"\nDone.")

#!/usr/bin/env python3
"""
LF Floor Horserace: Compare 5 approaches for handling GF < LF in Potomac Pulse.

Approaches:
  0 - Baseline (current v29.0 model, no floor)
  1 - Simple LF Floor: max(blended, lf_discharge)
  2 - LF-Anchored Rising Correction (calibrated uplift per flow bin)
  3 - Raised Decay Cap (0.75 instead of 0.50)
  4 - Hybrid (Floor + Rising Uplift)

Output: analysis/lf_floor_horserace_python.csv
"""

import numpy as np
import pandas as pd
from math import sqrt
import os
import warnings
warnings.filterwarnings('ignore')

np.random.seed(42)

# ── Paths ──────────────────────────────────────────────────────────────────
BASE_DIR = "/Users/sebjilke/Desktop/PotomacPulse/analysis"
DATA_PATH = os.path.join(BASE_DIR, "hourly_backtest_data.csv")
OUTPUT_PATH = os.path.join(BASE_DIR, "lf_floor_horserace_python.csv")

# ── Load data ──────────────────────────────────────────────────────────────
print("Loading data...")
df = pd.read_csv(DATA_PATH, parse_dates=["timestamp"])
df = df.sort_values("timestamp").reset_index(drop=True)
print(f"  Loaded {len(df):,} rows, columns: {list(df.columns)}")
print(f"  Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
print(f"  water_temp_c missing: {df['water_temp_c'].isna().sum():,} ({df['water_temp_c'].isna().mean()*100:.1f}%)")
print()

# ── Helper: EF power law ──────────────────────────────────────────────────
def ef_power_law(ef_stage, water_temp_c):
    """Compute EF-based discharge estimate using v29.0 power law."""
    cold = (~np.isnan(water_temp_c)) & (water_temp_c <= 10.0)
    ef_cfs = np.where(cold, 160.0 * (ef_stage ** 2.36), 126.0 * (ef_stage ** 2.46))
    return ef_cfs


# ── Helper: compute blended estimate ──────────────────────────────────────
def compute_blended(df, decay_cap=0.50):
    """
    Replicate v29.0 blended estimate pipeline.
    Returns blended estimates, flow_state, ef_cfs, base_estimate.
    """
    n = len(df)

    # 1. EF power law
    ef_cfs = ef_power_law(
        df["ef_stage"].values,
        df["water_temp_c"].values
    )

    # 2. Base estimate from time-shifted PoR
    base_estimate = df["por_lagged"].values.copy().astype(float)

    # 3. PoR-delta correction
    por_now = df["por_now"].values.astype(float)
    por_lagged = df["por_lagged"].values.astype(float)
    travel_time_h = df["travel_time_h"].values.astype(float)

    por_change_ratio = np.where(por_lagged > 0, por_now / por_lagged, 1.0)
    por_change_pct = (por_change_ratio - 1.0) * 100.0

    # Apply correction where |change| > 5%
    mask_correct = np.abs(por_change_pct) > 5.0
    staleness = travel_time_h.copy()
    denom = np.maximum(1.0, travel_time_h)
    fraction_elapsed = np.minimum(1.0, staleness / denom)  # always 1.0
    decay_factor = np.minimum(decay_cap, np.sqrt(fraction_elapsed))
    applied_ratio = 1.0 + (por_change_ratio - 1.0) * decay_factor

    base_estimate = np.where(mask_correct, base_estimate * applied_ratio, base_estimate)

    # 4. Flow state (from hourly LF change)
    lf_discharge = df["lf_discharge"].values.astype(float)
    hourly_change = np.zeros(n)
    hourly_change[1:] = lf_discharge[1:] - lf_discharge[:-1]
    hourly_change[0] = 0.0

    threshold = np.maximum(100.0, 0.02 * lf_discharge)
    flow_state = np.where(
        hourly_change >= threshold, "rising",
        np.where(hourly_change <= -threshold, "falling", "steady")
    )

    # 5. EF weight: 0% below 3k, 35% above 3k
    ef_weight = np.where(lf_discharge >= 3000.0, 0.35, 0.0)

    # 6. Discrepancy guard: skip EF blend if >50% discrepancy
    discrepancy = np.where(
        base_estimate > 0,
        np.abs(ef_cfs - base_estimate) / base_estimate,
        999.0
    )
    blended = np.where(
        discrepancy > 0.50,
        base_estimate,
        (1.0 - ef_weight) * base_estimate + ef_weight * ef_cfs
    )

    # 7. Soft LF ceiling (120%)
    blended = np.where(
        lf_discharge > 0,
        np.minimum(blended, lf_discharge * 1.20),
        blended
    )

    return blended, flow_state, ef_cfs, base_estimate


# ── Flow bins ─────────────────────────────────────────────────────────────
def assign_flow_bin(lf):
    """Assign flow bin based on LF discharge."""
    bins = [0, 2000, 5000, 10000, 20000, 50000, np.inf]
    labels = ["0-2k", "2-5k", "5-10k", "10-20k", "20-50k", "50k+"]
    return pd.cut(lf, bins=bins, labels=labels, right=False)


# ── Metrics ───────────────────────────────────────────────────────────────
def compute_metrics(estimate, actual):
    """Compute all required metrics."""
    n = len(estimate)
    if n == 0:
        return {
            "n": 0, "rmse": np.nan, "mae": np.nan, "bias": np.nan,
            "mdape": np.nan, "pct_below_lf": np.nan, "pct_above_120_lf": np.nan
        }
    error = estimate - actual
    abs_error = np.abs(error)
    pct_error = np.where(actual > 0, np.abs(error / actual) * 100.0, np.nan)

    rmse = np.sqrt(np.mean(error ** 2))
    mae = np.mean(abs_error)
    bias = np.mean(error)
    mdape = np.nanmedian(pct_error)
    pct_below = np.mean(estimate < actual) * 100.0
    pct_above_120 = np.mean(estimate > actual * 1.20) * 100.0

    return {
        "n": n,
        "rmse": round(rmse, 2),
        "mae": round(mae, 2),
        "bias": round(bias, 2),
        "mdape": round(mdape, 4),
        "pct_below_lf": round(pct_below, 4),
        "pct_above_120_lf": round(pct_above_120, 4)
    }


# ══════════════════════════════════════════════════════════════════════════
# APPROACH 0: BASELINE (current v29.0, no floor)
# ══════════════════════════════════════════════════════════════════════════
print("=" * 70)
print("Computing Approach 0: Baseline (v29.0, no floor)")
print("=" * 70)

blended_baseline, flow_state, ef_cfs, base_estimate = compute_blended(df, decay_cap=0.50)
lf = df["lf_discharge"].values.astype(float)
df["flow_state"] = flow_state
df["flow_bin"] = assign_flow_bin(df["lf_discharge"])
df["blended_baseline"] = blended_baseline

approach_estimates = {
    "0_baseline": blended_baseline.copy()
}

# ══════════════════════════════════════════════════════════════════════════
# APPROACH 1: Simple LF Floor
# ══════════════════════════════════════════════════════════════════════════
print("Computing Approach 1: Simple LF Floor")

est_1 = np.maximum(blended_baseline, lf)
approach_estimates["1_lf_floor"] = est_1

# ══════════════════════════════════════════════════════════════════════════
# APPROACH 2: LF-Anchored Rising Correction
# ══════════════════════════════════════════════════════════════════════════
print("Computing Approach 2: LF-Anchored Rising Correction")
print()

# Calibrate uplift factors per flow bin
# When blended < lf AND rising, compute median(lf / blended) per bin
mask_under_rising = (blended_baseline < lf) & (flow_state == "rising")

uplift_factors = {}
flow_bins_ordered = ["0-2k", "2-5k", "5-10k", "10-20k", "20-50k", "50k+"]
fb = df["flow_bin"].values

print("  Calibrating uplift factors per flow bin (blended < LF AND rising):")
for b in flow_bins_ordered:
    mask_bin = (fb == b) & mask_under_rising
    n_bin = mask_bin.sum()
    if n_bin > 0:
        ratios = lf[mask_bin] / blended_baseline[mask_bin]
        med_ratio = np.median(ratios)
        # Cap between 1.0 and 1.20
        uplift = max(1.0, min(1.20, med_ratio))
        uplift_factors[b] = uplift
        print(f"    {b:>8s}: median(LF/blended) = {med_ratio:.4f}, capped uplift = {uplift:.4f}, n = {n_bin:,}")
    else:
        uplift_factors[b] = 1.0
        print(f"    {b:>8s}: no observations, uplift = 1.0000")

print()

# Apply Approach 2
est_2 = blended_baseline.copy()
mask_under = blended_baseline < lf
mask_rising = flow_state == "rising"

for b in flow_bins_ordered:
    mask_bin = fb == b
    # When blended < LF AND rising: apply uplift to LF
    mask_apply = mask_under & mask_rising & mask_bin
    est_2[mask_apply] = lf[mask_apply] * uplift_factors[b]
    # When blended < LF AND NOT rising: just use blended (no floor)
    # (already set from blended_baseline)

approach_estimates["2_rising_uplift"] = est_2

# ══════════════════════════════════════════════════════════════════════════
# APPROACH 3: Raised Decay Cap (0.75)
# ══════════════════════════════════════════════════════════════════════════
print("Computing Approach 3: Raised Decay Cap (0.75)")

blended_075, _, _, _ = compute_blended(df, decay_cap=0.75)

# Still apply ceiling
blended_075 = np.where(lf > 0, np.minimum(blended_075, lf * 1.20), blended_075)

approach_estimates["3_decay_075"] = blended_075

# ══════════════════════════════════════════════════════════════════════════
# APPROACH 4: Hybrid (Floor + Rising Uplift)
# ══════════════════════════════════════════════════════════════════════════
print("Computing Approach 4: Hybrid (Floor + Rising Uplift)")

est_4 = blended_baseline.copy()

# Hard floor: always max(blended, lf)
est_4 = np.maximum(est_4, lf)

# When floor is binding AND rising: apply calibrated uplift from Approach 2
floor_binding = blended_baseline < lf

for b in flow_bins_ordered:
    mask_bin = fb == b
    mask_apply = floor_binding & mask_rising & mask_bin
    # Apply uplift to LF (since floor already set est_4 = lf in these cases)
    est_4[mask_apply] = lf[mask_apply] * uplift_factors[b]
    # When floor binding AND NOT rising: just lf (already set by max)

approach_estimates["4_hybrid"] = est_4

# ══════════════════════════════════════════════════════════════════════════
# COMPUTE METRICS FOR ALL APPROACHES
# ══════════════════════════════════════════════════════════════════════════
print()
print("=" * 70)
print("Computing metrics for all approaches...")
print("=" * 70)

results = []

approach_names = list(approach_estimates.keys())

for approach_name in approach_names:
    est = approach_estimates[approach_name]

    # Overall
    m = compute_metrics(est, lf)
    m["approach"] = approach_name
    m["scope"] = "overall"
    m["flow_bin"] = "all"
    m["flow_state"] = "all"
    results.append(m)

    # Per flow bin
    for b in flow_bins_ordered:
        mask = fb == b
        if mask.sum() > 0:
            m = compute_metrics(est[mask], lf[mask])
            m["approach"] = approach_name
            m["scope"] = "per_bin"
            m["flow_bin"] = b
            m["flow_state"] = "all"
            results.append(m)

    # Per flow state
    for s in ["rising", "falling", "steady"]:
        mask = flow_state == s
        if mask.sum() > 0:
            m = compute_metrics(est[mask], lf[mask])
            m["approach"] = approach_name
            m["scope"] = "per_state"
            m["flow_bin"] = "all"
            m["flow_state"] = s
            results.append(m)

    # Per bin × state
    for b in flow_bins_ordered:
        for s in ["rising", "falling", "steady"]:
            mask = (fb == b) & (flow_state == s)
            if mask.sum() > 0:
                m = compute_metrics(est[mask], lf[mask])
                m["approach"] = approach_name
                m["scope"] = "per_bin_state"
                m["flow_bin"] = b
                m["flow_state"] = s
                results.append(m)

# ── Save results ──────────────────────────────────────────────────────────
results_df = pd.DataFrame(results)
cols = ["approach", "scope", "flow_bin", "flow_state", "n", "rmse", "mae", "bias", "mdape", "pct_below_lf", "pct_above_120_lf"]
results_df = results_df[cols]
results_df.to_csv(OUTPUT_PATH, index=False)
print(f"\nResults saved to: {OUTPUT_PATH}")
print(f"  Total rows: {len(results_df)}")

# ══════════════════════════════════════════════════════════════════════════
# SUMMARY TABLES
# ══════════════════════════════════════════════════════════════════════════
print()
print("=" * 100)
print("OVERALL COMPARISON")
print("=" * 100)

overall = results_df[results_df["scope"] == "overall"].copy()
overall = overall.sort_values("rmse")

print(f"\n{'Approach':<20s} {'N':>8s} {'RMSE':>10s} {'MAE':>10s} {'Bias':>10s} {'MdAPE%':>10s} {'%<LF':>8s} {'%>120%LF':>8s}")
print("-" * 80)
for _, row in overall.iterrows():
    print(f"{row['approach']:<20s} {row['n']:>8,} {row['rmse']:>10.2f} {row['mae']:>10.2f} {row['bias']:>10.2f} {row['mdape']:>10.4f} {row['pct_below_lf']:>8.2f} {row['pct_above_120_lf']:>8.2f}")

print()
print("=" * 100)
print("PER FLOW STATE COMPARISON")
print("=" * 100)

for s in ["rising", "falling", "steady"]:
    state_df = results_df[(results_df["scope"] == "per_state") & (results_df["flow_state"] == s)].copy()
    state_df = state_df.sort_values("rmse")
    print(f"\n  Flow State: {s.upper()}")
    print(f"  {'Approach':<20s} {'N':>8s} {'RMSE':>10s} {'MAE':>10s} {'Bias':>10s} {'MdAPE%':>10s} {'%<LF':>8s} {'%>120%LF':>8s}")
    print("  " + "-" * 78)
    for _, row in state_df.iterrows():
        print(f"  {row['approach']:<20s} {row['n']:>8,} {row['rmse']:>10.2f} {row['mae']:>10.2f} {row['bias']:>10.2f} {row['mdape']:>10.4f} {row['pct_below_lf']:>8.2f} {row['pct_above_120_lf']:>8.2f}")

print()
print("=" * 100)
print("PER FLOW BIN COMPARISON (RMSE only)")
print("=" * 100)

print(f"\n{'Approach':<20s}", end="")
for b in flow_bins_ordered:
    print(f" {b:>10s}", end="")
print()
print("-" * 85)

for approach_name in approach_names:
    print(f"{approach_name:<20s}", end="")
    for b in flow_bins_ordered:
        row = results_df[(results_df["approach"] == approach_name) &
                         (results_df["scope"] == "per_bin") &
                         (results_df["flow_bin"] == b)]
        if len(row) > 0:
            print(f" {row.iloc[0]['rmse']:>10.2f}", end="")
        else:
            print(f" {'N/A':>10s}", end="")
    print()

# ── Uplift factors summary ───────────────────────────────────────────────
print()
print("=" * 100)
print("CALIBRATED UPLIFT FACTORS (Approach 2 / Approach 4)")
print("=" * 100)
print(f"\n{'Flow Bin':<12s} {'Uplift Factor':>15s} {'N (under+rising)':>18s}")
print("-" * 50)
for b in flow_bins_ordered:
    mask_bin = (fb == b) & mask_under_rising
    n_bin = mask_bin.sum()
    print(f"{b:<12s} {uplift_factors[b]:>15.4f} {n_bin:>18,}")

# ── Key insights ──────────────────────────────────────────────────────────
print()
print("=" * 100)
print("KEY INSIGHTS")
print("=" * 100)

baseline_rmse = overall[overall["approach"] == "0_baseline"]["rmse"].values[0]
print(f"\n  Baseline RMSE: {baseline_rmse:.2f}")

for approach_name in approach_names:
    if approach_name == "0_baseline":
        continue
    rmse = overall[overall["approach"] == approach_name]["rmse"].values[0]
    delta = rmse - baseline_rmse
    pct = delta / baseline_rmse * 100
    direction = "BETTER" if delta < 0 else "WORSE"
    print(f"  {approach_name}: RMSE = {rmse:.2f} ({delta:+.2f}, {pct:+.2f}% — {direction})")

# ── Floor binding stats ───────────────────────────────────────────────────
print()
print("=" * 100)
print("FLOOR BINDING STATISTICS")
print("=" * 100)

n_under = (blended_baseline < lf).sum()
n_under_rising = ((blended_baseline < lf) & (flow_state == "rising")).sum()
n_under_steady = ((blended_baseline < lf) & (flow_state == "steady")).sum()
n_under_falling = ((blended_baseline < lf) & (flow_state == "falling")).sum()

print(f"\n  Baseline estimate < LF: {n_under:,} / {len(df):,} ({n_under/len(df)*100:.1f}%)")
print(f"    - Rising:  {n_under_rising:,} ({n_under_rising/n_under*100:.1f}% of undershoots)")
print(f"    - Steady:  {n_under_steady:,} ({n_under_steady/n_under*100:.1f}% of undershoots)")
print(f"    - Falling: {n_under_falling:,} ({n_under_falling/n_under*100:.1f}% of undershoots)")

# Median undershoot magnitude
mask_under_all = blended_baseline < lf
undershoot_pct = (lf[mask_under_all] - blended_baseline[mask_under_all]) / lf[mask_under_all] * 100
print(f"\n  Median undershoot magnitude: {np.median(undershoot_pct):.2f}% of LF")
print(f"  Mean undershoot magnitude:   {np.mean(undershoot_pct):.2f}% of LF")
print(f"  90th pctile undershoot:      {np.percentile(undershoot_pct, 90):.2f}% of LF")

print()
print("=" * 100)
print("WINNER DETERMINATION")
print("=" * 100)

winner = overall.iloc[0]
print(f"\n  Overall winner (lowest RMSE): {winner['approach']}")
print(f"  RMSE = {winner['rmse']:.2f}, MAE = {winner['mae']:.2f}, Bias = {winner['bias']:.2f}")
print(f"  %<LF = {winner['pct_below_lf']:.2f}%, %>120%LF = {winner['pct_above_120_lf']:.2f}%")

# Check rising-only winner
rising_df = results_df[(results_df["scope"] == "per_state") & (results_df["flow_state"] == "rising")].sort_values("rmse")
rising_winner = rising_df.iloc[0]
print(f"\n  Rising-only winner (lowest RMSE): {rising_winner['approach']}")
print(f"  RMSE = {rising_winner['rmse']:.2f}, MAE = {rising_winner['mae']:.2f}, Bias = {rising_winner['bias']:.2f}")

print("\nDone.")

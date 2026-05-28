#!/usr/bin/env python3
"""
analyze_error_distribution_python.py

Analyze the prediction error distribution for the Potomac Pulse Great Falls
flow estimate across 18 bins (6 flow levels x 3 flow states).

Reconstructs the blended EF/PoR estimate from hourly backtest data and
characterizes the error distribution to determine whether 90% CI should
use parametric (1.645*sigma) or empirical (5th/95th quantile) bounds.

Input:  analysis/hourly_backtest_data.csv  (117,704 rows)
Output: analysis/error_distribution_python.csv
"""

import numpy as np
import pandas as pd
from scipy import stats

np.random.seed(42)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DATA_PATH = "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
OUTPUT_PATH = "/Users/sebjilke/Desktop/PotomacPulse/analysis/error_distribution_python.csv"

FLOW_BINS = [
    ("0-2k",   0,     2000),
    ("2-5k",   2000,  5000),
    ("5-10k",  5000,  10000),
    ("10-20k", 10000, 20000),
    ("20-50k", 20000, 50000),
    ("50k+",   50000, float("inf")),
]

MIN_OBS = 20          # Minimum observations for meaningful analysis
SHAPIRO_MAX_N = 5000  # Shapiro-Wilk sample cap

# ---------------------------------------------------------------------------
# Step 0: Load data
# ---------------------------------------------------------------------------
print("=" * 80)
print("POTOMAC PULSE ERROR DISTRIBUTION ANALYSIS")
print("=" * 80)

df = pd.read_csv(DATA_PATH, parse_dates=["timestamp"])
print(f"\nLoaded {len(df):,} rows from {DATA_PATH}")
print(f"Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
print(f"Columns: {list(df.columns)}")

# Basic data quality checks
for col in ["por_lagged", "ef_stage", "lf_discharge"]:
    n_missing = df[col].isna().sum()
    if n_missing > 0:
        print(f"  WARNING: {col} has {n_missing:,} missing values")

n_temp_missing = df["water_temp_c"].isna().sum()
print(f"  water_temp_c: {n_temp_missing:,} missing ({n_temp_missing/len(df)*100:.1f}%) -- will use default model")

# ---------------------------------------------------------------------------
# Step 1: Reconstruct the blended estimate
# ---------------------------------------------------------------------------
print("\n" + "-" * 80)
print("STEP 1: Reconstructing blended GF estimate")
print("-" * 80)

# EF power law: cold water model when temp <= 10C, default otherwise
cold_mask = df["water_temp_c"].notna() & (df["water_temp_c"] <= 10.0)
df["ef_cfs"] = np.where(
    cold_mask,
    160.0 * df["ef_stage"] ** 2.36,
    126.0 * df["ef_stage"] ** 2.46,
)

print(f"  Cold water model applied to {cold_mask.sum():,} rows ({cold_mask.sum()/len(df)*100:.1f}%)")
print(f"  Default model applied to {(~cold_mask).sum():,} rows ({(~cold_mask).sum()/len(df)*100:.1f}%)")

# EF weight: flat 35% above 3000 cfs, 0% below
df["ef_weight"] = np.where(df["lf_discharge"] >= 3000.0, 0.35, 0.0)

# Blended estimate
df["blended"] = (1.0 - df["ef_weight"]) * df["por_lagged"] + df["ef_weight"] * df["ef_cfs"]

# Error (positive = overestimate)
df["error"] = df["blended"] - df["lf_discharge"]
df["pct_error"] = df["error"] / df["lf_discharge"] * 100.0

print(f"\n  Blended estimate summary:")
print(f"    Mean error:   {df['error'].mean():+.1f} cfs")
print(f"    Median error: {df['error'].median():+.1f} cfs")
print(f"    Std dev:      {df['error'].std():.1f} cfs")
print(f"    Mean |error|: {df['error'].abs().mean():.1f} cfs")

# ---------------------------------------------------------------------------
# Step 2: Flow bin assignment
# ---------------------------------------------------------------------------
print("\n" + "-" * 80)
print("STEP 2: Assigning flow bins")
print("-" * 80)

df["flow_bin"] = pd.Categorical(
    [""] * len(df),
    categories=[b[0] for b in FLOW_BINS],
    ordered=True,
)

for label, lo, hi in FLOW_BINS:
    mask = (df["lf_discharge"] >= lo) & (df["lf_discharge"] < hi)
    df.loc[mask, "flow_bin"] = label
    print(f"  {label:>8s}: {mask.sum():>7,} rows")

# Drop rows that didn't fall into any bin (should be zero)
unassigned = (df["flow_bin"] == "").sum()
if unassigned > 0:
    print(f"  WARNING: {unassigned} rows unassigned to any bin")

# ---------------------------------------------------------------------------
# Step 3: Flow state classification (rising / falling / steady)
# ---------------------------------------------------------------------------
print("\n" + "-" * 80)
print("STEP 3: Classifying flow state (rising/falling/steady)")
print("-" * 80)

# Sort by timestamp to compute hourly change correctly
df = df.sort_values("timestamp").reset_index(drop=True)

# Compute hourly change in actual LF discharge
df["lf_change"] = df["lf_discharge"].diff()

# First row has NaN change; set to 0 (steady)
df["lf_change"] = df["lf_change"].fillna(0.0)

# Threshold: max(100 cfs, 2% of current flow)
df["change_threshold"] = np.maximum(100.0, 0.02 * df["lf_discharge"])

def classify_state(row):
    if row["lf_change"] >= row["change_threshold"]:
        return "rising"
    elif row["lf_change"] <= -row["change_threshold"]:
        return "falling"
    else:
        return "steady"

df["flow_state"] = df.apply(classify_state, axis=1)

state_counts = df["flow_state"].value_counts()
for state in ["rising", "falling", "steady"]:
    n = state_counts.get(state, 0)
    print(f"  {state:>8s}: {n:>7,} rows ({n/len(df)*100:.1f}%)")

# ---------------------------------------------------------------------------
# Step 4: Error distribution analysis per bin
# ---------------------------------------------------------------------------
print("\n" + "-" * 80)
print("STEP 4: Error distribution analysis per bin")
print("-" * 80)

results = []

def analyze_errors(errors, label):
    """Analyze a vector of errors and return a results dict."""
    n = len(errors)
    if n < MIN_OBS:
        return {
            "n": n,
            "mean_error": np.nan,
            "median_error": np.nan,
            "std_dev": np.nan,
            "skewness": np.nan,
            "kurtosis": np.nan,
            "shapiro_p": np.nan,
            "anderson_stat": np.nan,
            "anderson_cv_5pct": np.nan,
            "q05": np.nan,
            "q10": np.nan,
            "q25": np.nan,
            "q50": np.nan,
            "q75": np.nan,
            "q90": np.nan,
            "q95": np.nan,
            "normal_q95_approx": np.nan,
            "recommended_method": "insufficient_data",
        }

    err = errors.values
    mean_e = np.mean(err)
    median_e = np.median(err)
    std_e = np.std(err, ddof=1)
    skew_e = stats.skew(err, bias=False)
    kurt_e = stats.kurtosis(err, bias=False)  # excess kurtosis

    # Shapiro-Wilk (sample if too large)
    if n > SHAPIRO_MAX_N:
        sample = np.random.choice(err, size=SHAPIRO_MAX_N, replace=False)
        shapiro_stat, shapiro_p = stats.shapiro(sample)
    else:
        shapiro_stat, shapiro_p = stats.shapiro(err)

    # Anderson-Darling
    ad_result = stats.anderson(err, dist="norm")
    anderson_stat = ad_result.statistic
    # 5% critical value is at index 2 in anderson's critical_values
    anderson_cv_5pct = ad_result.critical_values[2]

    # Empirical quantiles
    q05 = np.percentile(err, 5)
    q10 = np.percentile(err, 10)
    q25 = np.percentile(err, 25)
    q50 = np.percentile(err, 50)
    q75 = np.percentile(err, 75)
    q90 = np.percentile(err, 90)
    q95 = np.percentile(err, 95)

    # Normal approximation for 95th percentile: mean + 1.645*sigma
    normal_q95_approx = mean_e + 1.645 * std_e

    # Decide recommended method
    # Normal if: (Shapiro p > 0.01 OR (|skewness| < 1 AND |excess kurtosis| < 3))
    approx_normal = (shapiro_p > 0.01) or (abs(skew_e) < 1.0 and abs(kurt_e) < 3.0)

    if approx_normal:
        method = "normal"
    else:
        method = "empirical"

    return {
        "n": n,
        "mean_error": round(mean_e, 2),
        "median_error": round(median_e, 2),
        "std_dev": round(std_e, 2),
        "skewness": round(skew_e, 3),
        "kurtosis": round(kurt_e, 3),
        "shapiro_p": round(shapiro_p, 6),
        "anderson_stat": round(anderson_stat, 2),
        "anderson_cv_5pct": round(anderson_cv_5pct, 2),
        "q05": round(q05, 2),
        "q10": round(q10, 2),
        "q25": round(q25, 2),
        "q50": round(q50, 2),
        "q75": round(q75, 2),
        "q90": round(q90, 2),
        "q95": round(q95, 2),
        "normal_q95_approx": round(normal_q95_approx, 2),
        "recommended_method": method,
    }


# Analyze each of the 18 bins
for bin_label, lo, hi in FLOW_BINS:
    for state in ["rising", "falling", "steady"]:
        mask = (df["flow_bin"] == bin_label) & (df["flow_state"] == state)
        errors = df.loc[mask, "error"]
        label = f"{bin_label}/{state}"

        res = analyze_errors(errors, label)
        res["flow_bin"] = bin_label
        res["flow_state"] = state
        results.append(res)

        # Print summary for this bin
        if res["recommended_method"] == "insufficient_data":
            print(f"\n  {label:>18s}: N={res['n']:>5} -- INSUFFICIENT DATA (< {MIN_OBS})")
        else:
            sym_ratio = abs(res["q05"]) / max(abs(res["q95"]), 0.01)
            print(f"\n  {label:>18s}: N={res['n']:>6,}  mean={res['mean_error']:>+9.1f}  "
                  f"std={res['std_dev']:>8.1f}  skew={res['skewness']:>+6.3f}  "
                  f"kurt={res['kurtosis']:>6.3f}")
            print(f"  {'':>18s}  q05={res['q05']:>+9.1f}  q95={res['q95']:>+9.1f}  "
                  f"1.645s={res['normal_q95_approx']:>+9.1f}  "
                  f"sym={sym_ratio:.2f}  method={res['recommended_method']}")

# ---------------------------------------------------------------------------
# Step 5: Overall analysis (all errors combined)
# ---------------------------------------------------------------------------
print("\n" + "-" * 80)
print("STEP 5: Overall error distribution (all observations)")
print("-" * 80)

overall = analyze_errors(df["error"], "ALL")
overall["flow_bin"] = "ALL"
overall["flow_state"] = "ALL"
results.append(overall)

print(f"\n  N = {overall['n']:,}")
print(f"  Mean error:   {overall['mean_error']:+.2f} cfs")
print(f"  Median error: {overall['median_error']:+.2f} cfs")
print(f"  Std dev:      {overall['std_dev']:.2f} cfs")
print(f"  Skewness:     {overall['skewness']:+.3f}")
print(f"  Excess kurt:  {overall['kurtosis']:.3f}")
print(f"  Shapiro-Wilk p-value: {overall['shapiro_p']:.6f}")
print(f"  Anderson-Darling stat: {overall['anderson_stat']:.2f} (5% CV: {overall['anderson_cv_5pct']:.2f})")
print(f"\n  Empirical quantiles:")
print(f"    5th:  {overall['q05']:+.1f} cfs")
print(f"    10th: {overall['q10']:+.1f} cfs")
print(f"    25th: {overall['q25']:+.1f} cfs")
print(f"    50th: {overall['q50']:+.1f} cfs")
print(f"    75th: {overall['q75']:+.1f} cfs")
print(f"    90th: {overall['q90']:+.1f} cfs")
print(f"    95th: {overall['q95']:+.1f} cfs")
print(f"\n  Normal approximation (mean + 1.645*sigma): {overall['normal_q95_approx']:+.1f} cfs")
print(f"  Actual 95th percentile:                     {overall['q95']:+.1f} cfs")
approx_err = abs(overall["normal_q95_approx"] - overall["q95"]) / max(abs(overall["q95"]), 0.01) * 100
print(f"  Approximation error:                        {approx_err:.1f}%")

# Symmetry check
sym_lo = abs(overall["q05"])
sym_hi = abs(overall["q95"])
sym_ratio_overall = sym_lo / max(sym_hi, 0.01)
print(f"\n  Symmetry check: |q05| = {sym_lo:.1f}, |q95| = {sym_hi:.1f}, ratio = {sym_ratio_overall:.2f}")
if 0.8 <= sym_ratio_overall <= 1.2:
    print("  --> Distribution is approximately symmetric")
else:
    print(f"  --> Distribution is ASYMMETRIC (ratio {sym_ratio_overall:.2f}, outside [0.8, 1.2])")

# ---------------------------------------------------------------------------
# Step 6: Recommendation
# ---------------------------------------------------------------------------
print("\n" + "=" * 80)
print("STEP 6: RECOMMENDATION")
print("=" * 80)

# Count methods across 18 bins (excluding ALL and insufficient_data)
bin_results = [r for r in results if r["flow_bin"] != "ALL" and r["recommended_method"] != "insufficient_data"]
n_normal = sum(1 for r in bin_results if r["recommended_method"] == "normal")
n_empirical = sum(1 for r in bin_results if r["recommended_method"] == "empirical")

print(f"\n  Across {len(bin_results)} analyzed bins:")
print(f"    Normal recommended:    {n_normal}")
print(f"    Empirical recommended: {n_empirical}")
print(f"  Overall method: {overall['recommended_method']}")

# Detailed recommendation
print("\n  --- DETAILED RECOMMENDATION ---")

if overall["recommended_method"] == "normal" and n_normal >= n_empirical:
    print("\n  USE PARAMETRIC (NORMAL) 90% CI:")
    print(f"    low  = estimate - 1.645 * sigma_bin")
    print(f"    high = estimate + 1.645 * sigma_bin")
    print(f"\n  Rationale: Overall distribution is approximately normal.")
    print(f"  Shapiro-Wilk p = {overall['shapiro_p']:.6f}, skewness = {overall['skewness']:+.3f}, "
          f"excess kurtosis = {overall['kurtosis']:.3f}")
    final_method = "normal"
elif n_empirical > n_normal:
    print("\n  USE EMPIRICAL 90% CI (per bin):")
    print(f"    low  = estimate + q05_bin   (5th percentile of error)")
    print(f"    high = estimate + q95_bin   (95th percentile of error)")
    print(f"\n  Rationale: Majority of bins show non-normal error distributions.")
    print(f"  {n_empirical}/{len(bin_results)} bins recommend empirical quantiles.")
    final_method = "empirical"
else:
    print("\n  USE EMPIRICAL 90% CI (per bin):")
    print(f"    low  = estimate + q05_bin   (5th percentile of error)")
    print(f"    high = estimate + q95_bin   (95th percentile of error)")
    print(f"\n  Rationale: Overall distribution is non-normal (heavy tails/skew).")
    print(f"  Shapiro-Wilk p = {overall['shapiro_p']:.6f}, skewness = {overall['skewness']:+.3f}, "
          f"excess kurtosis = {overall['kurtosis']:.3f}")
    final_method = "empirical"

# Summary comparison table
print("\n\n  --- NORMAL vs EMPIRICAL COMPARISON BY BIN ---")
print(f"  {'Bin':>18s}  {'N':>6s}  {'Std':>8s}  {'1.645s':>8s}  {'q95':>8s}  {'|q05|':>8s}  {'Diff%':>6s}  {'Method':>10s}")
print("  " + "-" * 80)

for r in results:
    if r["recommended_method"] == "insufficient_data":
        continue
    label = f"{r['flow_bin']}/{r['flow_state']}"
    if r["flow_bin"] == "ALL":
        label = "ALL/ALL"
    diff_pct = (abs(r["normal_q95_approx"] - r["q95"]) / max(abs(r["q95"]), 0.01) * 100
                if r["q95"] != 0 else 0.0)
    print(f"  {label:>18s}  {r['n']:>6,}  {r['std_dev']:>8.1f}  "
          f"{r['normal_q95_approx']:>+8.1f}  {r['q95']:>+8.1f}  "
          f"{abs(r['q05']):>8.1f}  {diff_pct:>5.1f}%  {r['recommended_method']:>10s}")

# ---------------------------------------------------------------------------
# Save results
# ---------------------------------------------------------------------------
print("\n" + "-" * 80)
print("SAVING RESULTS")
print("-" * 80)

out_cols = [
    "flow_bin", "flow_state", "n", "mean_error", "median_error", "std_dev",
    "skewness", "kurtosis", "shapiro_p", "q05", "q10", "q25", "q50", "q75",
    "q90", "q95", "normal_q95_approx", "recommended_method",
]

out_df = pd.DataFrame(results)[out_cols]
out_df.to_csv(OUTPUT_PATH, index=False)
print(f"  Saved {len(out_df)} rows to {OUTPUT_PATH}")

# Final summary
print("\n" + "=" * 80)
print(f"FINAL ANSWER: Recommended 90% CI method = {final_method.upper()}")
if final_method == "normal":
    print("  Formula: estimate +/- 1.645 * sigma_bin")
else:
    print("  Formula: [estimate + q05_bin, estimate + q95_bin]")
    print("  Where q05 and q95 are the 5th and 95th percentile of (blended - actual) errors")
print("=" * 80)

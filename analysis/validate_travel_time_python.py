#!/usr/bin/env python3
"""
validate_travel_time_python.py

Validates the 0.80 Searcy travel time correction factor using 117,704 hourly
observations of Point of Rocks (PoR) and Little Falls (LF) discharge.

Searcy (1961) original model: T = 5174 * Q^(-0.5963) hours
Current app correction:       T = 4139 * Q^(-0.5963)  (i.e., 0.80 * 5174 = 4139)

Method:
  1. Cross-correlation by flow regime to find empirical travel times
  2. Power-law fit to derive empirical coefficient and exponent
  3. Regime-level bootstrap for 95% CI on the correction factor
"""

import numpy as np
import pandas as pd
from scipy.stats import pearsonr
import sys
import os

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SEARCY_A = 5174.0
SEARCY_B = -0.5963
CURRENT_CORRECTION = 0.80
CURRENT_A = SEARCY_A * CURRENT_CORRECTION  # 4139.2

DATA_PATH = os.path.join(os.path.dirname(__file__), "hourly_backtest_data.csv")
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "validate_travel_time_python.csv")

# Flow regimes: (lower_bound, upper_bound) in cfs
# None means unbounded
REGIMES = [
    (0, 2000),
    (2000, 5000),
    (5000, 10000),
    (10000, 20000),
    (20000, 50000),
    (50000, 100000),
    (100000, None),
]

# Regime labels for display
REGIME_LABELS = [
    "<2000",
    "2000-5000",
    "5000-10000",
    "10000-20000",
    "20000-50000",
    "50000-100000",
    ">100000",
]

# Cross-correlation lag range (hours)
LAG_MIN = 4
LAG_MAX = 50

# Bootstrap parameters
N_BOOTSTRAP = 1000
BOOTSTRAP_SEED = 42

# Midpoint for unbounded upper regime
UNBOUNDED_UPPER_MIDPOINT = 150000.0

# Minimum pairs warning threshold
MIN_PAIRS_WARN = 200


def compute_regime_midpoint(lower, upper):
    """Geometric mean of bin edges. Special cases for unbounded bins."""
    if upper is None:
        return UNBOUNDED_UPPER_MIDPOINT
    if lower == 0:
        return 1000.0  # Use 1000 cfs for the <2000 bin (avoid sqrt(0))
    return np.sqrt(lower * upper)


def searcy_travel_time(q):
    """Original Searcy predicted travel time in hours."""
    return SEARCY_A * (q ** SEARCY_B)


def load_and_prepare_data(path):
    """Load CSV and build timestamp-indexed lookup arrays."""
    print(f"Loading data from: {path}")
    df = pd.read_csv(path, parse_dates=["timestamp"])

    print(f"  Total rows loaded: {len(df):,}")

    # Filter to valid positive readings
    mask = (df["por_now"] > 0) & (df["lf_discharge"] > 0)
    df = df[mask].copy()
    print(f"  Valid rows (por_now > 0 and lf_discharge > 0): {len(df):,}")

    # Sort by timestamp and check for duplicates
    df = df.sort_values("timestamp").reset_index(drop=True)
    n_dup = df["timestamp"].duplicated().sum()
    if n_dup > 0:
        print(f"  WARNING: {n_dup} duplicate timestamps found, keeping first occurrence")
        df = df.drop_duplicates(subset="timestamp", keep="first").reset_index(drop=True)

    # Build timestamp-indexed Series for fast lookup
    por_series = pd.Series(df["por_now"].values, index=df["timestamp"])
    lf_series = pd.Series(df["lf_discharge"].values, index=df["timestamp"])

    # Compute first differences (Δ) for cross-correlation
    # First-differencing removes shared baseflow signal and isolates wave propagation
    df["por_diff"] = df["por_now"].diff()
    df["lf_diff"] = df["lf_discharge"].diff()
    por_diff_series = pd.Series(df["por_diff"].values, index=df["timestamp"])
    lf_diff_series = pd.Series(df["lf_diff"].values, index=df["timestamp"])

    print(f"  Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
    print(f"  PoR flow range: {df['por_now'].min():.0f} - {df['por_now'].max():.0f} cfs")
    print(f"  LF flow range: {df['lf_discharge'].min():.0f} - {df['lf_discharge'].max():.0f} cfs")
    print()

    return df, por_series, lf_series, por_diff_series, lf_diff_series


def cross_correlate_regime(df, por_diff_series, lf_diff_series, lower, upper, label):
    """
    For a given flow regime, compute cross-correlation of FIRST DIFFERENCES
    at each lag and return the optimal lag and associated statistics.

    Using first differences (Δ discharge) rather than raw levels because:
    - Raw levels are dominated by shared baseflow, biasing toward short lags
    - First differences isolate the wave propagation "pulse" signal
    - This is the standard hydrological approach for travel time estimation
    """
    # Select PoR readings in this flow regime (based on raw flow level)
    if upper is None:
        mask = df["por_now"] >= lower
    else:
        mask = (df["por_now"] >= lower) & (df["por_now"] < upper)

    # Also require valid first differences
    mask = mask & df["por_diff"].notna() & (df["por_diff"] != 0)
    regime_df = df[mask]
    n_regime = len(regime_df)

    if n_regime < 30:
        print(f"  {label}: only {n_regime} observations with nonzero changes, SKIPPING")
        return None

    print(f"  {label}: {n_regime:,} PoR observations with flow changes in regime")

    # For each lag, compute correlation between Δ(PoR)(t) and Δ(LF)(t + lag)
    best_lag = None
    best_corr = -np.inf
    best_n_pairs = 0
    all_lags = []

    regime_timestamps = regime_df["timestamp"].values
    regime_por_diff = regime_df["por_diff"].values

    for lag_h in range(LAG_MIN, LAG_MAX + 1):
        lag_td = pd.Timedelta(hours=lag_h)

        # Look up Δ(LF) at t + lag for each Δ(PoR) at t
        future_timestamps = regime_timestamps + lag_td

        # Find which future timestamps exist in LF diff series
        valid_mask = np.isin(future_timestamps, lf_diff_series.index)
        n_valid = valid_mask.sum()

        if n_valid < 30:
            continue

        por_diffs = regime_por_diff[valid_mask]
        lf_diffs = lf_diff_series.loc[future_timestamps[valid_mask]].values

        # Filter out NaN LF diffs
        both_valid = ~np.isnan(lf_diffs)
        if both_valid.sum() < 30:
            continue

        por_diffs_clean = por_diffs[both_valid]
        lf_diffs_clean = lf_diffs[both_valid]

        # Pearson correlation of first differences
        corr, _ = pearsonr(por_diffs_clean, lf_diffs_clean)
        all_lags.append((lag_h, corr, both_valid.sum()))

        if corr > best_corr:
            best_corr = corr
            best_lag = lag_h
            best_n_pairs = both_valid.sum()

    if best_lag is None:
        print(f"    No valid lag found for regime {label}")
        return None

    if best_n_pairs < MIN_PAIRS_WARN:
        print(f"    WARNING: Only {best_n_pairs} pairs at optimal lag (threshold: {MIN_PAIRS_WARN})")

    # Print top-5 lags for this regime
    sorted_lags = sorted(all_lags, key=lambda x: x[1], reverse=True)[:5]
    print(f"    Optimal lag: {best_lag}h, r = {best_corr:.4f}, n_pairs = {best_n_pairs:,}")
    print(f"    Top-5 lags: {[(l, f'{r:.4f}') for l, r, n in sorted_lags]}")

    return {
        "label": label,
        "lower": lower,
        "upper": upper,
        "n_regime": n_regime,
        "optimal_lag_h": best_lag,
        "peak_correlation": best_corr,
        "n_pairs": best_n_pairs,
    }


def fit_power_law(flow_midpoints, travel_times):
    """
    Fit T = A * Q^B via log-linear OLS.
    Returns A, B, R-squared.
    """
    log_q = np.log(flow_midpoints)
    log_t = np.log(travel_times)

    # OLS: log_t = log_a + b * log_q
    n = len(log_q)
    sum_x = np.sum(log_q)
    sum_y = np.sum(log_t)
    sum_xy = np.sum(log_q * log_t)
    sum_x2 = np.sum(log_q ** 2)

    b = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x ** 2)
    log_a = (sum_y - b * sum_x) / n
    a = np.exp(log_a)

    # R-squared
    y_hat = log_a + b * log_q
    ss_res = np.sum((log_t - y_hat) ** 2)
    ss_tot = np.sum((log_t - np.mean(log_t)) ** 2)
    r_squared = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0

    return a, b, r_squared


def bootstrap_correction_factor(flow_midpoints, travel_times, n_iter=N_BOOTSTRAP, seed=BOOTSTRAP_SEED):
    """
    Regime-level bootstrap: resample the 7 regime-level (flow, travel_time)
    points with replacement, refit power law each time.
    Returns array of correction factors (A / SEARCY_A).
    """
    rng = np.random.RandomState(seed)
    n = len(flow_midpoints)
    correction_factors = np.empty(n_iter)

    for i in range(n_iter):
        idx = rng.choice(n, size=n, replace=True)
        boot_flows = flow_midpoints[idx]
        boot_times = travel_times[idx]

        # Need at least 2 unique points to fit a line
        if len(np.unique(idx)) < 2:
            correction_factors[i] = np.nan
            continue

        a_boot, _, _ = fit_power_law(boot_flows, boot_times)
        correction_factors[i] = a_boot / SEARCY_A

    # Drop NaN
    correction_factors = correction_factors[~np.isnan(correction_factors)]
    return correction_factors


def main():
    print("=" * 80)
    print("TRAVEL TIME CORRECTION FACTOR VALIDATION")
    print("Searcy (1961): T = 5174 * Q^(-0.5963)")
    print(f"Current app:   T = {CURRENT_A:.0f} * Q^(-0.5963)  (correction = {CURRENT_CORRECTION})")
    print("=" * 80)
    print()

    # ------------------------------------------------------------------
    # Step 1: Load and prepare data
    # ------------------------------------------------------------------
    df, por_series, lf_series, por_diff_series, lf_diff_series = load_and_prepare_data(DATA_PATH)

    # ------------------------------------------------------------------
    # Step 2: Cross-correlation by flow regime (using first differences)
    # ------------------------------------------------------------------
    print("-" * 80)
    print("CROSS-CORRELATION BY FLOW REGIME (first differences)")
    print("Using Δ(PoR) vs Δ(LF) to isolate wave propagation signal")
    print(f"Lag range: {LAG_MIN}h to {LAG_MAX}h in 1h steps")
    print("-" * 80)

    results = []
    for (lower, upper), label in zip(REGIMES, REGIME_LABELS):
        res = cross_correlate_regime(df, por_diff_series, lf_diff_series, lower, upper, label)
        if res is not None:
            midpoint = compute_regime_midpoint(lower, upper)
            res["flow_midpoint_cfs"] = midpoint
            res["searcy_predicted_h"] = searcy_travel_time(midpoint)
            res["ratio"] = res["optimal_lag_h"] / res["searcy_predicted_h"]
            res["pct_difference"] = (res["ratio"] - 1.0) * 100.0
            results.append(res)
    print()

    if len(results) < 2:
        print("ERROR: Fewer than 2 valid regimes. Cannot fit power law.")
        sys.exit(1)

    # ------------------------------------------------------------------
    # Step 3: Fit power law
    # ------------------------------------------------------------------
    flow_midpoints = np.array([r["flow_midpoint_cfs"] for r in results])
    travel_times = np.array([r["optimal_lag_h"] for r in results], dtype=float)

    fitted_a, fitted_b, r_squared = fit_power_law(flow_midpoints, travel_times)
    correction_factor = fitted_a / SEARCY_A

    print("-" * 80)
    print("POWER-LAW FIT: T = A * Q^B")
    print("-" * 80)
    print(f"  Fitted A:           {fitted_a:.1f}")
    print(f"  Fitted B:           {fitted_b:.4f}")
    print(f"  R-squared:          {r_squared:.4f}")
    print(f"  Searcy A:           {SEARCY_A:.0f}")
    print(f"  Searcy B:           {SEARCY_B:.4f}")
    print(f"  Correction factor:  {correction_factor:.4f}  (fitted A / Searcy A)")
    print(f"  Current app factor: {CURRENT_CORRECTION:.2f}")
    print(f"  Exponent diff:      {fitted_b - SEARCY_B:.4f}  (fitted B - Searcy B)")
    print()

    # ------------------------------------------------------------------
    # Step 4: Bootstrap 95% CI on correction factor
    # ------------------------------------------------------------------
    print("-" * 80)
    print(f"BOOTSTRAP 95% CI ON CORRECTION FACTOR ({N_BOOTSTRAP} iterations)")
    print("-" * 80)

    boot_factors = bootstrap_correction_factor(flow_midpoints, travel_times)
    ci_lower = np.percentile(boot_factors, 2.5)
    ci_upper = np.percentile(boot_factors, 97.5)
    boot_mean = np.mean(boot_factors)
    boot_std = np.std(boot_factors)

    print(f"  Bootstrap mean:     {boot_mean:.4f}")
    print(f"  Bootstrap std:      {boot_std:.4f}")
    print(f"  95% CI:             [{ci_lower:.4f}, {ci_upper:.4f}]")
    print(f"  Current 0.80 in CI: {'YES' if ci_lower <= 0.80 <= ci_upper else 'NO'}")
    print()

    # ------------------------------------------------------------------
    # Step 5: Summary comparison table
    # ------------------------------------------------------------------
    print("-" * 80)
    print("REGIME-LEVEL COMPARISON TABLE")
    print("-" * 80)
    header = (
        f"{'Regime':<15s} {'Midpoint':>10s} {'N pairs':>8s} "
        f"{'Emp lag':>8s} {'r':>7s} {'Searcy':>8s} {'Ratio':>7s} {'%Diff':>7s}"
    )
    print(header)
    print("-" * len(header))

    for r in results:
        warn = " *" if r["n_pairs"] < MIN_PAIRS_WARN else ""
        print(
            f"{r['label']:<15s} {r['flow_midpoint_cfs']:>10.0f} {r['n_pairs']:>8,d} "
            f"{r['optimal_lag_h']:>8d} {r['peak_correlation']:>7.4f} "
            f"{r['searcy_predicted_h']:>8.1f} {r['ratio']:>7.3f} {r['pct_difference']:>+7.1f}%{warn}"
        )

    print()
    print("  * = fewer than 200 cross-correlation pairs (interpret with caution)")
    print()

    # ------------------------------------------------------------------
    # Step 6: Fitted vs Searcy comparison at each regime midpoint
    # ------------------------------------------------------------------
    print("-" * 80)
    print("FITTED MODEL vs SEARCY at regime midpoints")
    print("-" * 80)
    print(f"  {'Flow (cfs)':<12s} {'Searcy (h)':<12s} {'Fitted (h)':<12s} {'Empirical (h)':<14s}")
    print("  " + "-" * 50)
    for r in results:
        q = r["flow_midpoint_cfs"]
        searcy_t = searcy_travel_time(q)
        fitted_t = fitted_a * (q ** fitted_b)
        emp_t = r["optimal_lag_h"]
        print(f"  {q:<12.0f} {searcy_t:<12.1f} {fitted_t:<12.1f} {emp_t:<14d}")
    print()

    # ------------------------------------------------------------------
    # Step 7: Save CSV output
    # ------------------------------------------------------------------
    print("-" * 80)
    print(f"SAVING RESULTS TO: {OUTPUT_PATH}")
    print("-" * 80)

    rows = []
    for r in results:
        rows.append({
            "regime": r["label"],
            "flow_midpoint_cfs": round(r["flow_midpoint_cfs"], 1),
            "n_pairs": r["n_pairs"],
            "optimal_lag_h": r["optimal_lag_h"],
            "peak_correlation": round(r["peak_correlation"], 6),
            "searcy_predicted_h": round(r["searcy_predicted_h"], 2),
            "ratio_empirical_to_searcy": round(r["ratio"], 4),
            "pct_difference": round(r["pct_difference"], 2),
        })

    # Summary row
    rows.append({
        "regime": "SUMMARY",
        "flow_midpoint_cfs": None,
        "n_pairs": None,
        "optimal_lag_h": None,
        "peak_correlation": None,
        "searcy_predicted_h": None,
        "ratio_empirical_to_searcy": None,
        "pct_difference": None,
        "fitted_A": round(fitted_a, 2),
        "fitted_B": round(fitted_b, 6),
        "correction_factor": round(correction_factor, 6),
        "ci_lower": round(ci_lower, 6),
        "ci_upper": round(ci_upper, 6),
        "r_squared": round(r_squared, 6),
    })

    out_df = pd.DataFrame(rows)
    out_df.to_csv(OUTPUT_PATH, index=False)
    print(f"  Saved {len(rows)} rows ({len(results)} regimes + 1 summary)")
    print()

    # ------------------------------------------------------------------
    # Final verdict
    # ------------------------------------------------------------------
    print("=" * 80)
    print("VERDICT")
    print("=" * 80)
    print(f"  Empirical correction factor: {correction_factor:.4f}")
    print(f"  95% CI:                      [{ci_lower:.4f}, {ci_upper:.4f}]")
    print(f"  Current app value:           {CURRENT_CORRECTION:.2f}")
    in_ci = ci_lower <= CURRENT_CORRECTION <= ci_upper
    print(f"  Current value in 95% CI:     {'YES' if in_ci else 'NO'}")
    if in_ci:
        print(f"  --> The 0.80 correction factor is SUPPORTED by the empirical data.")
    else:
        if CURRENT_CORRECTION < ci_lower:
            print(f"  --> The 0.80 factor is BELOW the CI. Empirical data suggests a higher value.")
        else:
            print(f"  --> The 0.80 factor is ABOVE the CI. Empirical data suggests a lower value.")
    print(f"  Exponent comparison: Searcy B = {SEARCY_B:.4f}, Fitted B = {fitted_b:.4f}")
    if abs(fitted_b - SEARCY_B) < 0.05:
        print(f"  --> Exponents agree within 0.05; Searcy's flow-speed relationship is confirmed.")
    else:
        print(f"  --> Exponents differ by {abs(fitted_b - SEARCY_B):.4f}; flow-speed relationship may differ.")
    print("=" * 80)


if __name__ == "__main__":
    main()

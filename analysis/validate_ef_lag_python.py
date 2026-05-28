#!/usr/bin/env python3
"""
validate_ef_lag_python.py
=========================
Determines whether adding a time lag to Edwards Ferry (EF) stage readings
improves Great Falls flow predictions in the Potomac Pulse blended model.

EF is ~2 miles upstream of GF. Water takes ~1-2h to travel that distance
at typical flows. Currently EF is used synchronously (lag=0). This script
tests lags 0-12h to see if a non-zero lag improves predictions.

Three analyses:
  Part A: Direct EF->LF cross-correlation by flow regime and lag
  Part B: Impact on blended GF estimate RMSE (the real decision metric)
  Part C: Summary comparison and recommendation

Input:  analysis/hourly_backtest_data.csv  (117,704 hourly observations)
Output: analysis/validate_ef_lag_python.csv
"""

import numpy as np
import pandas as pd
from scipy.stats import pearsonr
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
np.random.seed(42)

DATA_PATH = Path(__file__).parent / "hourly_backtest_data.csv"
OUTPUT_PATH = Path(__file__).parent / "validate_ef_lag_python.csv"

# Power-law model parameters (v29.0)
DEFAULT_COEF = 126.0
DEFAULT_EXP = 2.46
COLD_COEF = 160.0
COLD_EXP = 2.36
COLD_THRESHOLD_C = 10.0  # water temp threshold for cold model

# Blending parameters
EF_WEIGHT = 0.35
FLOW_THRESHOLD_CFS = 3000.0

# Lag range to test (hours)
LAGS = list(range(0, 13))  # 0 through 12 inclusive

# Flow regimes for Part A
FLOW_REGIMES = [
    ("< 3k", 0, 3000),
    ("3k-10k", 3000, 10000),
    ("10k-25k", 10000, 25000),
    ("25k-50k", 25000, 50000),
    ("> 50k", 50000, np.inf),
]

# Decision threshold
RMSE_IMPROVEMENT_THRESHOLD_PCT = 2.0


def ef_to_cfs(ef_stage, water_temp_c):
    """
    Convert EF stage (ft) to LF-equivalent CFS using the v29.0 power-law.

    Uses cold-water model (160 * EF^2.36) when water_temp_c <= 10,
    default model (126 * EF^2.46) otherwise or when temp is missing.

    Parameters
    ----------
    ef_stage : np.ndarray or pd.Series
        Edwards Ferry stage readings in feet.
    water_temp_c : np.ndarray or pd.Series
        Water temperature in Celsius. NaN treated as non-cold.

    Returns
    -------
    np.ndarray
        Estimated CFS values.
    """
    ef_stage = np.asarray(ef_stage, dtype=np.float64)
    water_temp_c = np.asarray(water_temp_c, dtype=np.float64)

    cfs = np.full_like(ef_stage, np.nan)

    # Cold water: temp <= 10 and not NaN
    cold_mask = (~np.isnan(water_temp_c)) & (water_temp_c <= COLD_THRESHOLD_C)
    default_mask = ~cold_mask

    cfs[cold_mask] = COLD_COEF * np.power(ef_stage[cold_mask], COLD_EXP)
    cfs[default_mask] = DEFAULT_COEF * np.power(ef_stage[default_mask], DEFAULT_EXP)

    return cfs


def load_data():
    """Load and prepare the hourly backtest data."""
    print("=" * 80)
    print("LOADING DATA")
    print("=" * 80)

    df = pd.read_csv(DATA_PATH, parse_dates=["timestamp"])
    print(f"  Raw rows: {len(df):,}")
    print(f"  Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
    print(f"  Columns: {list(df.columns)}")

    # Filter to valid EF and LF readings
    valid_mask = (df["ef_stage"] > 0) & (df["lf_discharge"] > 0)
    df_valid = df[valid_mask].copy()
    print(f"  Valid rows (ef_stage > 0 & lf_discharge > 0): {len(df_valid):,}")
    print(f"  Dropped: {len(df) - len(df_valid):,}")

    # Set timestamp as index for efficient time-based lookups
    df_valid = df_valid.set_index("timestamp").sort_index()

    # Check for duplicates in the index
    n_dupes = df_valid.index.duplicated().sum()
    if n_dupes > 0:
        print(f"  WARNING: {n_dupes} duplicate timestamps found, keeping first")
        df_valid = df_valid[~df_valid.index.duplicated(keep="first")]

    # Verify hourly frequency
    time_diffs = pd.Series(df_valid.index).diff().dropna()
    median_diff = time_diffs.median()
    print(f"  Median time step: {median_diff}")
    print(f"  Index range: {df_valid.index.min()} to {df_valid.index.max()}")
    print()

    # Summary statistics
    print("  Summary statistics:")
    for col in ["ef_stage", "lf_discharge", "por_lagged", "water_temp_c"]:
        series = df_valid[col]
        print(
            f"    {col:20s}: n={series.notna().sum():>7,}  "
            f"mean={series.mean():>10.1f}  "
            f"min={series.min():>10.1f}  "
            f"max={series.max():>10.1f}"
        )
    print()

    # Flow regime distribution
    print("  Flow regime distribution:")
    for name, lo, hi in FLOW_REGIMES:
        mask = (df_valid["lf_discharge"] >= lo) & (df_valid["lf_discharge"] < hi)
        print(f"    {name:>10s}: {mask.sum():>7,} rows ({mask.sum()/len(df_valid)*100:.1f}%)")
    print()

    return df_valid


def get_lagged_ef(df, lag_hours):
    """
    For each row at time t, look up EF stage at time (t - lag_hours).

    Parameters
    ----------
    df : pd.DataFrame
        DataFrame with DatetimeIndex and 'ef_stage' column.
    lag_hours : int
        Number of hours to lag (0 = synchronous, no change).

    Returns
    -------
    pd.Series
        EF stage values shifted backward by lag_hours. NaN where lookup fails.
    """
    if lag_hours == 0:
        return df["ef_stage"].copy()

    # Shift forward by lag_hours: for each time t, this gives us the value
    # from time (t - lag_hours). pandas shift(n) shifts the data DOWN by n,
    # so shift(lag_hours) at row t contains the value from (t - lag_hours).
    # This requires a regular hourly index.
    shifted = df["ef_stage"].shift(lag_hours)
    return shifted


def part_a_cross_correlation(df):
    """
    Part A: Direct EF->LF cross-correlation by flow regime and lag.

    For each flow regime and each lag (0-12h):
      - Look up EF at (t - lag)
      - Convert to CFS using power law
      - Compute Pearson correlation with actual LF discharge

    Returns
    -------
    pd.DataFrame
        Results with columns: analysis, regime, lag_h, correlation, n_pairs, rmse,
        rmse_pct_change_vs_lag0
    """
    print("=" * 80)
    print("PART A: DIRECT EF -> LF CROSS-CORRELATION BY FLOW REGIME")
    print("=" * 80)
    print()

    results = []

    for regime_name, flow_lo, flow_hi in FLOW_REGIMES:
        # Identify rows in this flow regime
        regime_mask = (df["lf_discharge"] >= flow_lo) & (df["lf_discharge"] < flow_hi)
        n_regime = regime_mask.sum()
        print(f"  Regime {regime_name} ({n_regime:,} rows):")

        lag0_rmse = None

        for lag in LAGS:
            # Get lagged EF
            ef_lagged = get_lagged_ef(df, lag)

            # Convert to CFS
            ef_cfs_lagged = ef_to_cfs(ef_lagged, df["water_temp_c"])

            # Build analysis DataFrame for this lag
            valid = regime_mask & (~np.isnan(ef_cfs_lagged)) & (df["lf_discharge"].notna())
            n_pairs = valid.sum()

            if n_pairs < 10:
                results.append({
                    "analysis": "direct_correlation",
                    "regime": regime_name,
                    "lag_h": lag,
                    "correlation": np.nan,
                    "n_pairs": n_pairs,
                    "rmse": np.nan,
                    "rmse_pct_change_vs_lag0": np.nan,
                })
                print(f"    lag={lag:>2d}h: n={n_pairs:>6,}  (too few pairs)")
                continue

            actual_lf = df.loc[valid, "lf_discharge"].values
            predicted_cfs = np.asarray(ef_cfs_lagged[valid])

            # Pearson correlation
            corr, _ = pearsonr(predicted_cfs, actual_lf)

            # RMSE (direct EF prediction, not blended)
            rmse = np.sqrt(np.mean((predicted_cfs - actual_lf) ** 2))

            if lag == 0:
                lag0_rmse = rmse

            # Pct change vs lag=0
            if lag0_rmse is not None and lag0_rmse > 0:
                pct_change = ((rmse - lag0_rmse) / lag0_rmse) * 100.0
            else:
                pct_change = np.nan

            results.append({
                "analysis": "direct_correlation",
                "regime": regime_name,
                "lag_h": lag,
                "correlation": round(corr, 6),
                "n_pairs": n_pairs,
                "rmse": round(rmse, 2),
                "rmse_pct_change_vs_lag0": round(pct_change, 4),
            })

            marker = " <-- lag=0 (current)" if lag == 0 else ""
            print(
                f"    lag={lag:>2d}h: n={n_pairs:>6,}  r={corr:.4f}  "
                f"RMSE={rmse:>9.1f}{marker}"
            )

        # Find optimal lag for this regime
        regime_results = [r for r in results
                         if r["regime"] == regime_name
                         and r["analysis"] == "direct_correlation"
                         and not np.isnan(r.get("correlation", np.nan))]
        if regime_results:
            best = max(regime_results, key=lambda x: x["correlation"])
            print(
                f"    --> Best lag: {best['lag_h']}h (r={best['correlation']:.4f}, "
                f"RMSE={best['rmse']:.1f})"
            )
        print()

    return pd.DataFrame(results)


def part_b_blended_rmse(df):
    """
    Part B: Impact of EF lag on blended GF estimate RMSE.

    blended = (1 - ef_weight) * por_lagged + ef_weight * ef_cfs
    where ef_weight = 0.35 when lf_discharge >= 3000, else 0.0.

    Since ef_weight = 0 below 3000 cfs, lag only matters for flows >= 3000.
    We compute RMSE over all rows with lf_discharge >= 3000.

    Returns
    -------
    pd.DataFrame
        Results with columns: analysis, regime, lag_h, correlation, n_pairs,
        rmse, rmse_pct_change_vs_lag0
    """
    print("=" * 80)
    print("PART B: BLENDED GF ESTIMATE RMSE (lf_discharge >= 3000 cfs)")
    print("=" * 80)
    print()
    print(f"  Blend formula: blended = {1 - EF_WEIGHT:.2f} * por_lagged + "
          f"{EF_WEIGHT:.2f} * ef_cfs")
    print(f"  EF weight applied only when lf_discharge >= {FLOW_THRESHOLD_CFS:.0f} cfs")
    print()

    # Filter to rows where EF weight is active
    active_mask = (
        (df["lf_discharge"] >= FLOW_THRESHOLD_CFS)
        & (df["por_lagged"].notna())
        & (df["lf_discharge"].notna())
    )
    n_active = active_mask.sum()
    print(f"  Rows with lf_discharge >= {FLOW_THRESHOLD_CFS:.0f} and valid por_lagged: "
          f"{n_active:,}")
    print()

    results = []
    lag0_rmse = None

    for lag in LAGS:
        # Get lagged EF
        ef_lagged = get_lagged_ef(df, lag)

        # Convert to CFS
        ef_cfs_lagged = ef_to_cfs(ef_lagged, df["water_temp_c"])

        # Valid rows: active AND lagged EF is available
        valid = active_mask & (~np.isnan(ef_cfs_lagged))
        n_pairs = valid.sum()

        if n_pairs < 10:
            results.append({
                "analysis": "blended_rmse",
                "regime": "overall_ge3k",
                "lag_h": lag,
                "correlation": np.nan,
                "n_pairs": n_pairs,
                "rmse": np.nan,
                "rmse_pct_change_vs_lag0": np.nan,
            })
            print(f"  lag={lag:>2d}h: n={n_pairs:>6,}  (too few pairs)")
            continue

        por_vals = df.loc[valid, "por_lagged"].values
        ef_cfs_vals = np.asarray(ef_cfs_lagged[valid])
        actual_lf = df.loc[valid, "lf_discharge"].values

        # Blended estimate
        blended = (1.0 - EF_WEIGHT) * por_vals + EF_WEIGHT * ef_cfs_vals

        # RMSE
        rmse = np.sqrt(np.mean((blended - actual_lf) ** 2))

        # Correlation of blended estimate with actual
        corr, _ = pearsonr(blended, actual_lf)

        if lag == 0:
            lag0_rmse = rmse

        # Pct change vs lag=0
        if lag0_rmse is not None and lag0_rmse > 0:
            pct_change = ((rmse - lag0_rmse) / lag0_rmse) * 100.0
        else:
            pct_change = np.nan

        results.append({
            "analysis": "blended_rmse",
            "regime": "overall_ge3k",
            "lag_h": lag,
            "correlation": round(corr, 6),
            "n_pairs": n_pairs,
            "rmse": round(rmse, 2),
            "rmse_pct_change_vs_lag0": round(pct_change, 4),
        })

        marker = " <-- lag=0 (current)" if lag == 0 else ""
        print(
            f"  lag={lag:>2d}h: n={n_pairs:>6,}  r={corr:.4f}  "
            f"RMSE={rmse:>9.1f}  ({pct_change:>+.2f}% vs lag=0){marker}"
        )

    print()

    return pd.DataFrame(results)


def part_c_summary(df_a, df_b):
    """
    Part C: Summary comparison and recommendation.

    Compares lag=0 (current implementation) vs optimal lag found in Part B.
    Decision threshold: >2% RMSE improvement to recommend implementing lag.
    """
    print("=" * 80)
    print("PART C: SUMMARY AND RECOMMENDATION")
    print("=" * 80)
    print()

    # --- Part A summary: optimal lag per regime ---
    print("  Part A: Optimal EF lag per flow regime (direct correlation):")
    print(f"  {'Regime':>10s}  {'Best Lag':>8s}  {'r':>8s}  {'RMSE':>10s}  "
          f"{'vs lag=0':>10s}")
    print("  " + "-" * 56)

    for regime_name, _, _ in FLOW_REGIMES:
        regime_rows = df_a[
            (df_a["regime"] == regime_name)
            & (df_a["correlation"].notna())
        ]
        if regime_rows.empty:
            print(f"  {regime_name:>10s}  {'N/A':>8s}")
            continue

        best_idx = regime_rows["correlation"].idxmax()
        best = regime_rows.loc[best_idx]
        lag0 = regime_rows[regime_rows["lag_h"] == 0]

        if not lag0.empty:
            lag0_rmse = lag0.iloc[0]["rmse"]
            lag0_corr = lag0.iloc[0]["correlation"]
        else:
            lag0_rmse = np.nan
            lag0_corr = np.nan

        pct = best["rmse_pct_change_vs_lag0"]
        pct_str = f"{pct:>+.2f}%" if not np.isnan(pct) else "N/A"

        print(
            f"  {regime_name:>10s}  {int(best['lag_h']):>6d}h  "
            f"{best['correlation']:>8.4f}  {best['rmse']:>10.1f}  "
            f"{pct_str:>10s}"
        )
        if not np.isnan(lag0_corr):
            print(
                f"  {'(lag=0)':>10s}  {'0':>6s}h  "
                f"{lag0_corr:>8.4f}  {lag0_rmse:>10.1f}  {'baseline':>10s}"
            )

    print()

    # --- Part B summary: blended RMSE ---
    print("  Part B: Blended estimate RMSE (lf_discharge >= 3000 cfs):")
    blended = df_b[df_b["rmse"].notna()].copy()

    if blended.empty:
        print("  No valid blended RMSE results.")
        print()
        return

    lag0_row = blended[blended["lag_h"] == 0]
    best_idx = blended["rmse"].idxmin()
    best_row = blended.loc[best_idx]

    if not lag0_row.empty:
        lag0_rmse = lag0_row.iloc[0]["rmse"]
        lag0_n = int(lag0_row.iloc[0]["n_pairs"])
    else:
        lag0_rmse = np.nan
        lag0_n = 0

    best_lag = int(best_row["lag_h"])
    best_rmse = best_row["rmse"]
    best_n = int(best_row["n_pairs"])

    print(f"    Current (lag=0):    RMSE = {lag0_rmse:>10.2f}  (n={lag0_n:,})")
    print(f"    Best    (lag={best_lag}h):  RMSE = {best_rmse:>10.2f}  (n={best_n:,})")

    if not np.isnan(lag0_rmse) and lag0_rmse > 0:
        improvement_pct = ((lag0_rmse - best_rmse) / lag0_rmse) * 100.0
        print(f"    Improvement:        {improvement_pct:>+.4f}%")
    else:
        improvement_pct = 0.0
        print("    Improvement:        N/A (lag=0 baseline missing)")

    print()

    # --- Decision ---
    print("  DECISION:")
    print(f"    Threshold for implementation: >{RMSE_IMPROVEMENT_THRESHOLD_PCT:.1f}% "
          f"RMSE improvement")

    if improvement_pct > RMSE_IMPROVEMENT_THRESHOLD_PCT:
        print(f"    RECOMMENDATION: IMPLEMENT lag={best_lag}h for EF readings")
        print(f"    Improvement ({improvement_pct:.2f}%) exceeds threshold "
              f"({RMSE_IMPROVEMENT_THRESHOLD_PCT:.1f}%)")
    elif improvement_pct > 0:
        print(f"    RECOMMENDATION: KEEP lag=0 (current)")
        print(f"    Improvement ({improvement_pct:.4f}%) is below threshold "
              f"({RMSE_IMPROVEMENT_THRESHOLD_PCT:.1f}%)")
        print(f"    Lag={best_lag}h is marginally better but not worth the complexity")
    else:
        print(f"    RECOMMENDATION: KEEP lag=0 (current)")
        print(f"    Lag=0 is already optimal or tied for best")

    print()

    # --- Full table for reference ---
    print("  Full blended RMSE table:")
    print(f"  {'Lag':>5s}  {'N':>7s}  {'r':>8s}  {'RMSE':>10s}  {'vs lag=0':>12s}")
    print("  " + "-" * 48)
    for _, row in blended.iterrows():
        pct = row["rmse_pct_change_vs_lag0"]
        pct_str = f"{pct:>+.4f}%" if not np.isnan(pct) else "baseline"
        marker = " *" if row["lag_h"] == best_lag and best_lag != 0 else ""
        if row["lag_h"] == 0:
            marker = " (current)"
        print(
            f"  {int(row['lag_h']):>4d}h  {int(row['n_pairs']):>7,}  "
            f"{row['correlation']:>8.4f}  {row['rmse']:>10.2f}  "
            f"{pct_str:>12s}{marker}"
        )

    print()


def main():
    print()
    print("*" * 80)
    print("  VALIDATE EF LAG — Python Analysis")
    print("  Does time-lagging Edwards Ferry stage improve GF predictions?")
    print("*" * 80)
    print()

    # Load data
    df = load_data()

    # Part A: Direct cross-correlation
    df_a = part_a_cross_correlation(df)

    # Part B: Blended RMSE
    df_b = part_b_blended_rmse(df)

    # Combine results
    df_out = pd.concat([df_a, df_b], ignore_index=True)

    # Save output CSV
    df_out.to_csv(OUTPUT_PATH, index=False)
    print(f"Results saved to: {OUTPUT_PATH}")
    print(f"  Total rows: {len(df_out)}")
    print()

    # Part C: Summary and recommendation
    part_c_summary(df_a, df_b)

    print("*" * 80)
    print("  ANALYSIS COMPLETE")
    print("*" * 80)
    print()


if __name__ == "__main__":
    main()

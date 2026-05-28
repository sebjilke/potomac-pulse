#!/usr/bin/env python3
"""
Potomac Pulse Phase 3 Task 4: Validate Tributary Timing Calculations

Compares current (no time-shift) vs time-shifted tributary contributions
for Monocacy River and Goose Creek to the GF blended estimate.

Cross-correlates each tributary with LF discharge using first-differences
to isolate wave propagation signal, then computes practical RMSE impact.
"""

import numpy as np
import pandas as pd
import requests
import time
from datetime import datetime, timedelta
from io import StringIO

np.random.seed(42)

# =============================================================================
# Configuration
# =============================================================================
ANALYSIS_DIR = "/Users/sebjilke/Desktop/PotomacPulse/analysis"
BACKTEST_FILE = f"{ANALYSIS_DIR}/hourly_backtest_data.csv"
OUTPUT_FILE = f"{ANALYSIS_DIR}/validate_tributary_timing_python.csv"
TRIBUTARY_FILE = f"{ANALYSIS_DIR}/tributary_hourly_data.csv"

# USGS sites
SITES = {
    "monocacy": "01643000",   # Monocacy River near Frederick, MD
    "goose":    "01644000",   # Goose Creek near Leesburg, VA
    "lf":       "01646500",   # Little Falls
    "por":      "01638500",   # Point of Rocks
}

# Date range matching hourly_backtest_data.csv
START_DATE = "2011-12-01"
END_DATE = "2026-02-19"

# Tributary contribution fractions (from current model)
MONOCACY_FRAC = 0.071
GOOSE_FRAC = 0.030

# Lag search ranges (hours)
MONOCACY_LAGS = np.arange(0, 12.5, 0.5)  # 0-12h in 0.5h steps
GOOSE_LAGS = np.arange(0, 6.5, 0.5)      # 0-6h in 0.5h steps

# Flow regimes at LF (cfs)
FLOW_REGIMES = {
    "<5k":    (0, 5000),
    "5-15k":  (5000, 15000),
    "15-50k": (15000, 50000),
    ">50k":   (50000, float("inf")),
}


# =============================================================================
# USGS Data Fetching
# =============================================================================
def fetch_usgs_iv(site_id, param_cd, start_dt, end_dt, chunk_days=90):
    """
    Fetch USGS instantaneous values in chunks (API limit ~120 days).
    Returns DataFrame with columns: [timestamp, value].
    """
    all_records = []
    current_start = datetime.strptime(start_dt, "%Y-%m-%d")
    final_end = datetime.strptime(end_dt, "%Y-%m-%d")
    chunk_num = 0

    while current_start < final_end:
        chunk_end = min(current_start + timedelta(days=chunk_days), final_end)
        s_str = current_start.strftime("%Y-%m-%d")
        e_str = chunk_end.strftime("%Y-%m-%d")
        chunk_num += 1

        url = (
            f"https://nwis.waterservices.usgs.gov/nwis/iv/"
            f"?format=json&sites={site_id}&parameterCd={param_cd}"
            f"&startDT={s_str}&endDT={e_str}"
        )

        for attempt in range(5):
            try:
                resp = requests.get(url, timeout=120)
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as e:
                if attempt < 4:
                    wait = 5 * (attempt + 1)
                    print(f"    Retry {attempt+1}/4 for {site_id} chunk {chunk_num} "
                          f"({s_str} to {e_str}): {e}. Waiting {wait}s...")
                    time.sleep(wait)
                else:
                    print(f"    FAILED after 5 attempts for {site_id} chunk {chunk_num}")
                    current_start = chunk_end
                    continue

        # Parse JSON response
        try:
            ts_list = data["value"]["timeSeries"]
            if len(ts_list) == 0:
                print(f"    No timeSeries for {site_id} chunk {chunk_num}")
                current_start = chunk_end
                continue
            values = ts_list[0]["values"][0]["value"]
            for v in values:
                dt_str = v["dateTime"]
                val = v["value"]
                try:
                    val_float = float(val)
                    # USGS uses -999999 or similar for missing
                    if val_float < 0:
                        val_float = np.nan
                except (ValueError, TypeError):
                    val_float = np.nan
                all_records.append({"timestamp": dt_str, "value": val_float})
        except (KeyError, IndexError) as e:
            print(f"    Parse error for {site_id} chunk {chunk_num}: {e}")

        current_start = chunk_end
        # Brief pause to be respectful to USGS servers
        time.sleep(0.5)

    if not all_records:
        return pd.DataFrame(columns=["timestamp", "value"])

    df = pd.DataFrame(all_records)
    # Parse timestamps, convert to UTC-naive hourly
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    # Convert to US/Eastern then drop timezone for consistency
    df["timestamp"] = df["timestamp"].dt.tz_convert("US/Eastern").dt.tz_localize(None)
    # Round to nearest hour
    df["timestamp"] = df["timestamp"].dt.round("h")
    # Average if multiple readings per hour (15-min data -> hourly)
    df = df.groupby("timestamp", as_index=False)["value"].mean()
    df = df.sort_values("timestamp").reset_index(drop=True)
    # Remove duplicates
    df = df.drop_duplicates(subset="timestamp", keep="first").reset_index(drop=True)

    return df


def fetch_all_tributaries():
    """Fetch Monocacy and Goose Creek discharge data."""
    print("=" * 70)
    print("FETCHING USGS TRIBUTARY DATA")
    print("=" * 70)

    results = {}
    for name, site_id in [("monocacy", SITES["monocacy"]),
                           ("goose", SITES["goose"])]:
        print(f"\nFetching {name} ({site_id}): {START_DATE} to {END_DATE}...")
        df = fetch_usgs_iv(site_id, "00060", START_DATE, END_DATE)
        print(f"  Retrieved {len(df):,} hourly records")
        if len(df) > 0:
            print(f"  Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
            print(f"  Non-null values: {df['value'].notna().sum():,}")
            print(f"  Value range: {df['value'].min():.1f} - {df['value'].max():.1f} cfs")
        results[name] = df

    return results


# =============================================================================
# Cross-Correlation Analysis
# =============================================================================
def cross_correlate_first_diff(trib_series, lf_series, lags_hours, freq_hours=1):
    """
    Cross-correlate first-differences of tributary and LF discharge.
    Positive lag means tributary leads LF (water arrives later at LF).
    Returns dict of {lag_h: correlation}.
    """
    # First differences
    d_trib = trib_series.diff()
    d_lf = lf_series.diff()

    # Drop NaN from differencing
    valid = d_trib.notna() & d_lf.notna()
    d_trib = d_trib[valid]
    d_lf = d_lf[valid]

    correlations = {}
    for lag_h in lags_hours:
        lag_steps = int(lag_h / freq_hours)
        if lag_steps == 0:
            t = d_trib
            l = d_lf
        else:
            # Shift tributary backward (tributary leads LF)
            t = d_trib.iloc[:-lag_steps] if lag_steps > 0 else d_trib
            l = d_lf.iloc[lag_steps:] if lag_steps > 0 else d_lf

        # Align indices
        t = t.reset_index(drop=True)
        l = l.reset_index(drop=True)
        min_len = min(len(t), len(l))
        t = t.iloc[:min_len]
        l = l.iloc[:min_len]

        # Drop any remaining NaN
        mask = t.notna() & l.notna()
        t = t[mask]
        l = l[mask]

        if len(t) < 100:
            correlations[lag_h] = np.nan
            continue

        # Pearson correlation
        corr = np.corrcoef(t.values, l.values)[0, 1]
        correlations[lag_h] = corr

    return correlations


# =============================================================================
# RMSE Impact Analysis
# =============================================================================
def compute_rmse(actual, predicted):
    """Compute RMSE, ignoring NaN."""
    mask = np.isfinite(actual) & np.isfinite(predicted)
    if mask.sum() < 10:
        return np.nan
    return np.sqrt(np.mean((actual[mask] - predicted[mask]) ** 2))


def compute_blended_estimate(por_lagged, mono_q, goose_q):
    """
    Compute blended GF estimate:
    blended = por_lagged + mono_q * 0.071 + goose_q * 0.030
    """
    return por_lagged + mono_q * MONOCACY_FRAC + goose_q * GOOSE_FRAC


# =============================================================================
# Main Analysis
# =============================================================================
def main():
    print("=" * 70)
    print("POTOMAC PULSE PHASE 3 TASK 4")
    print("Validate Tributary Timing Calculations")
    print("=" * 70)
    print()

    # ------------------------------------------------------------------
    # 1. Load existing backtest data
    # ------------------------------------------------------------------
    print("Loading backtest data...")
    bt = pd.read_csv(BACKTEST_FILE, parse_dates=["timestamp"])
    print(f"  Backtest rows: {len(bt):,}")
    print(f"  Date range: {bt['timestamp'].min()} to {bt['timestamp'].max()}")
    print(f"  Columns: {list(bt.columns)}")
    print()

    # ------------------------------------------------------------------
    # 2. Fetch tributary data
    # ------------------------------------------------------------------
    trib_data = fetch_all_tributaries()
    mono_df = trib_data["monocacy"].rename(columns={"value": "monocacy_q"})
    goose_df = trib_data["goose"].rename(columns={"value": "goose_q"})

    # Save tributary data for R script
    print(f"\nSaving tributary data to {TRIBUTARY_FILE}...")
    trib_merged = pd.merge(mono_df, goose_df, on="timestamp", how="outer")
    trib_merged = trib_merged.sort_values("timestamp").reset_index(drop=True)
    trib_merged.to_csv(TRIBUTARY_FILE, index=False)
    print(f"  Saved {len(trib_merged):,} rows")

    # ------------------------------------------------------------------
    # 3. Merge tributaries with backtest data
    # ------------------------------------------------------------------
    print("\nMerging tributary data with backtest...")
    merged = bt.copy()
    merged = pd.merge(merged, mono_df, on="timestamp", how="left")
    merged = pd.merge(merged, goose_df, on="timestamp", how="left")

    n_mono = merged["monocacy_q"].notna().sum()
    n_goose = merged["goose_q"].notna().sum()
    print(f"  Monocacy matched: {n_mono:,} / {len(merged):,} "
          f"({100*n_mono/len(merged):.1f}%)")
    print(f"  Goose matched:    {n_goose:,} / {len(merged):,} "
          f"({100*n_goose/len(merged):.1f}%)")

    # Need all key columns present
    valid = merged.dropna(subset=["por_lagged", "lf_discharge", "monocacy_q", "goose_q"])
    print(f"  Fully complete rows: {len(valid):,}")
    print()

    # ------------------------------------------------------------------
    # 4. Cross-Correlation Analysis
    # ------------------------------------------------------------------
    print("=" * 70)
    print("CROSS-CORRELATION ANALYSIS (First-Differences)")
    print("=" * 70)

    results = []

    for trib_name, trib_col, lags in [
        ("monocacy", "monocacy_q", MONOCACY_LAGS),
        ("goose", "goose_q", GOOSE_LAGS),
    ]:
        print(f"\n--- {trib_name.upper()} ---")

        # Overall cross-correlation
        print(f"\n  Overall ({len(valid):,} obs):")
        corrs = cross_correlate_first_diff(
            valid[trib_col], valid["lf_discharge"], lags
        )
        if corrs:
            best_lag = max(corrs, key=lambda k: corrs[k] if not np.isnan(corrs[k]) else -999)
            print(f"    Optimal lag: {best_lag:.1f}h (r = {corrs[best_lag]:.4f})")
            for lag_h in sorted(corrs.keys()):
                marker = " <-- best" if lag_h == best_lag else ""
                print(f"    Lag {lag_h:5.1f}h: r = {corrs[lag_h]:.4f}{marker}")

        # By flow regime
        for regime_name, (lo, hi) in FLOW_REGIMES.items():
            mask = (valid["lf_discharge"] >= lo) & (valid["lf_discharge"] < hi)
            subset = valid[mask]
            n_regime = len(subset)

            if n_regime < 200:
                print(f"\n  Flow regime {regime_name}: {n_regime} obs (too few, skipping)")
                results.append({
                    "tributary": trib_name,
                    "flow_regime": regime_name,
                    "optimal_lag_h": np.nan,
                    "peak_correlation": np.nan,
                    "rmse_current": np.nan,
                    "rmse_shifted": np.nan,
                    "rmse_change_pct": np.nan,
                    "n_obs": n_regime,
                    "recommendation": "insufficient_data",
                })
                continue

            print(f"\n  Flow regime {regime_name} ({n_regime:,} obs):")
            corrs = cross_correlate_first_diff(
                subset[trib_col], subset["lf_discharge"], lags
            )

            if not corrs or all(np.isnan(v) for v in corrs.values()):
                print(f"    No valid correlations")
                results.append({
                    "tributary": trib_name,
                    "flow_regime": regime_name,
                    "optimal_lag_h": np.nan,
                    "peak_correlation": np.nan,
                    "rmse_current": np.nan,
                    "rmse_shifted": np.nan,
                    "rmse_change_pct": np.nan,
                    "n_obs": n_regime,
                    "recommendation": "no_valid_correlations",
                })
                continue

            best_lag = max(corrs, key=lambda k: corrs[k] if not np.isnan(corrs[k]) else -999)
            best_corr = corrs[best_lag]
            print(f"    Optimal lag: {best_lag:.1f}h (r = {best_corr:.4f})")

            # Top 5 lags
            sorted_lags = sorted(corrs.items(), key=lambda x: x[1] if not np.isnan(x[1]) else -999, reverse=True)
            for i, (lag_h, r) in enumerate(sorted_lags[:5]):
                print(f"    #{i+1} Lag {lag_h:.1f}h: r = {r:.4f}")

            # ----------------------------------------------------------
            # RMSE Impact: current vs time-shifted
            # ----------------------------------------------------------
            optimal_lag_steps = int(best_lag)  # integer hours for shifting

            # Current approach: use current tributary readings (no shift)
            current_mono = subset["monocacy_q"].values
            current_goose = subset["goose_q"].values

            # Time-shifted approach: shift tributary backward by optimal lag
            # For the tributary being tested, apply its optimal lag
            # For the other tributary, keep current (we test one at a time)
            if trib_name == "monocacy" and optimal_lag_steps > 0:
                # Shift monocacy: use reading from `optimal_lag_steps` hours ago
                shifted_mono = subset["monocacy_q"].shift(optimal_lag_steps).values
                shifted_goose = current_goose
            elif trib_name == "goose" and optimal_lag_steps > 0:
                shifted_mono = current_mono
                shifted_goose = subset["goose_q"].shift(optimal_lag_steps).values
            else:
                shifted_mono = current_mono
                shifted_goose = current_goose

            por_comp = subset["por_lagged"].values
            lf_actual = subset["lf_discharge"].values

            # Blended estimates
            est_current = compute_blended_estimate(por_comp, current_mono, current_goose)
            est_shifted = compute_blended_estimate(por_comp, shifted_mono, shifted_goose)

            rmse_current = compute_rmse(lf_actual, est_current)
            rmse_shifted = compute_rmse(lf_actual, est_shifted)

            if rmse_current > 0 and not np.isnan(rmse_shifted):
                rmse_change_pct = (rmse_shifted - rmse_current) / rmse_current * 100
            else:
                rmse_change_pct = np.nan

            print(f"    RMSE current:  {rmse_current:.1f} cfs")
            print(f"    RMSE shifted:  {rmse_shifted:.1f} cfs")
            if not np.isnan(rmse_change_pct):
                direction = "improvement" if rmse_change_pct < 0 else "degradation"
                print(f"    RMSE change:   {rmse_change_pct:+.2f}% ({direction})")

            # Recommendation
            if np.isnan(rmse_change_pct):
                rec = "insufficient_data"
            elif rmse_change_pct < -1.0:
                rec = "implement"
            elif rmse_change_pct < 0:
                rec = "marginal_improvement"
            else:
                rec = "no_improvement"

            results.append({
                "tributary": trib_name,
                "flow_regime": regime_name,
                "optimal_lag_h": best_lag,
                "peak_correlation": best_corr,
                "rmse_current": round(rmse_current, 2) if not np.isnan(rmse_current) else np.nan,
                "rmse_shifted": round(rmse_shifted, 2) if not np.isnan(rmse_shifted) else np.nan,
                "rmse_change_pct": round(rmse_change_pct, 2) if not np.isnan(rmse_change_pct) else np.nan,
                "n_obs": n_regime,
                "recommendation": rec,
            })

    # ------------------------------------------------------------------
    # 5. Combined Impact (both tributaries shifted simultaneously)
    # ------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("COMBINED IMPACT (Both Tributaries Shifted)")
    print("=" * 70)

    # Find best overall lags for each tributary
    mono_results = [r for r in results if r["tributary"] == "monocacy"
                    and not np.isnan(r.get("optimal_lag_h", np.nan))]
    goose_results = [r for r in results if r["tributary"] == "goose"
                     and not np.isnan(r.get("optimal_lag_h", np.nan))]

    # Weighted average optimal lag (weighted by n_obs)
    if mono_results:
        mono_total_n = sum(r["n_obs"] for r in mono_results)
        mono_best_overall = sum(r["optimal_lag_h"] * r["n_obs"] for r in mono_results) / mono_total_n
        print(f"\nMonocacy weighted-average optimal lag: {mono_best_overall:.1f}h")
    else:
        mono_best_overall = 0
        print("\nMonocacy: no valid lag estimates")

    if goose_results:
        goose_total_n = sum(r["n_obs"] for r in goose_results)
        goose_best_overall = sum(r["optimal_lag_h"] * r["n_obs"] for r in goose_results) / goose_total_n
        print(f"Goose weighted-average optimal lag:    {goose_best_overall:.1f}h")
    else:
        goose_best_overall = 0
        print("Goose: no valid lag estimates")

    # Round to nearest integer for practical shifting
    mono_shift = int(round(mono_best_overall))
    goose_shift = int(round(goose_best_overall))
    print(f"\nPractical shifts: Monocacy={mono_shift}h, Goose={goose_shift}h")

    # Compute combined RMSE by flow regime
    for regime_name, (lo, hi) in FLOW_REGIMES.items():
        mask = (valid["lf_discharge"] >= lo) & (valid["lf_discharge"] < hi)
        subset = valid[mask]
        if len(subset) < 200:
            print(f"\n  {regime_name}: {len(subset)} obs (skipping)")
            continue

        por_comp = subset["por_lagged"].values
        lf_actual = subset["lf_discharge"].values

        # Current
        est_current = compute_blended_estimate(
            por_comp, subset["monocacy_q"].values, subset["goose_q"].values
        )

        # Both shifted
        shifted_mono = subset["monocacy_q"].shift(mono_shift).values if mono_shift > 0 else subset["monocacy_q"].values
        shifted_goose = subset["goose_q"].shift(goose_shift).values if goose_shift > 0 else subset["goose_q"].values
        est_combined = compute_blended_estimate(por_comp, shifted_mono, shifted_goose)

        rmse_curr = compute_rmse(lf_actual, est_current)
        rmse_comb = compute_rmse(lf_actual, est_combined)
        if rmse_curr > 0:
            pct = (rmse_comb - rmse_curr) / rmse_curr * 100
            print(f"\n  {regime_name} ({len(subset):,} obs):")
            print(f"    RMSE current:  {rmse_curr:.1f} cfs")
            print(f"    RMSE combined: {rmse_comb:.1f} cfs")
            print(f"    Change:        {pct:+.2f}%")

    # ------------------------------------------------------------------
    # 6. Save results
    # ------------------------------------------------------------------
    results_df = pd.DataFrame(results)
    results_df = results_df[["tributary", "flow_regime", "optimal_lag_h",
                              "peak_correlation", "rmse_current", "rmse_shifted",
                              "rmse_change_pct", "n_obs", "recommendation"]]
    results_df.to_csv(OUTPUT_FILE, index=False)
    print(f"\nResults saved to {OUTPUT_FILE}")
    print(f"Tributary data saved to {TRIBUTARY_FILE}")

    # ------------------------------------------------------------------
    # 7. Summary
    # ------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(results_df.to_string(index=False))

    # Overall recommendation
    implement_count = sum(1 for r in results if r["recommendation"] == "implement")
    marginal_count = sum(1 for r in results if r["recommendation"] == "marginal_improvement")
    no_improve_count = sum(1 for r in results if r["recommendation"] == "no_improvement")

    print(f"\n  Implement (>1% improvement): {implement_count} regime(s)")
    print(f"  Marginal (<1% improvement):  {marginal_count} regime(s)")
    print(f"  No improvement:              {no_improve_count} regime(s)")

    if implement_count > 0:
        print("\n  RECOMMENDATION: Time-shifting tributaries shows meaningful "
              "improvement in some flow regimes. Consider implementing.")
    else:
        print("\n  RECOMMENDATION: Time-shifting tributaries does NOT show "
              "meaningful (>1%) RMSE improvement. Current approach is adequate.")

    print("\nDone.")


if __name__ == "__main__":
    main()

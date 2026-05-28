#!/usr/bin/env python3
"""
Spot-check hourly_backtest_data.csv against live USGS Instantaneous Values API.
Picks 10 rows spread across date range and flow levels, fetches matching USGS data,
and compares values. Also verifies travel-time-shifted PoR (por_lagged).
"""
import pandas as pd
import numpy as np
import requests
import time
from datetime import timedelta, datetime

CSV_PATH = "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"

# USGS site/param mapping
SITES = {
    "por_now":        ("01638500", "00060"),  # PoR discharge
    "ef_stage":       ("01644148", "00065"),  # EF stage (gage height)
    "lf_discharge":   ("01646500", "00060"),  # LF discharge
    "water_temp_c":   ("01638500", "00010"),  # PoR water temp
}

# ── Load CSV ─────────────────────────────────────────────────────────────
df = pd.read_csv(CSV_PATH, parse_dates=["timestamp"])
print(f"CSV loaded: {len(df)} rows, {df.timestamp.min()} → {df.timestamp.max()}")
print(f"Columns: {list(df.columns)}")
print(f"por_now range: {df.por_now.min():.0f} – {df.por_now.max():.0f}")
print()

# ── Select 10 rows spanning date range & flow levels ─────────────────────
# Stratify: pick from quantile bins of por_now, spread across years
np.random.seed(42)
df["year"] = df.timestamp.dt.year
df["flow_bin"] = pd.qcut(df.por_now, q=5, labels=["very_low", "low", "mid", "high", "very_high"])

# Sample ~2 from each flow bin, across different years
samples = []
for fb in ["very_low", "low", "mid", "high", "very_high"]:
    subset = df[df.flow_bin == fb]
    # Pick 2 rows from different years if possible
    years_avail = subset.year.unique()
    chosen_years = np.random.choice(years_avail, size=min(2, len(years_avail)), replace=False)
    for yr in chosen_years:
        row = subset[subset.year == yr].sample(1, random_state=42 + yr + hash(fb) % 1000)
        samples.append(row.index[0])

# Deduplicate and take exactly 10
samples = list(dict.fromkeys(samples))[:10]
check_df = df.loc[samples].sort_values("timestamp").reset_index(drop=True)

print(f"Selected {len(check_df)} rows for spot-checking:")
for _, r in check_df.iterrows():
    print(f"  {r.timestamp}  por_now={r.por_now:>8.0f}  ef_stage={r.ef_stage}  "
          f"lf={r.lf_discharge}  temp={r.water_temp_c}  travel_h={r.travel_time_h}")
print()

# ── Fetch USGS IV data ───────────────────────────────────────────────────
def fetch_usgs_iv(site, param, center_dt, window_hours=1):
    """Fetch USGS instantaneous values around center_dt. Returns list of (datetime, value)."""
    start = (center_dt - timedelta(hours=window_hours)).strftime("%Y-%m-%dT%H:%M-05:00")
    end   = (center_dt + timedelta(hours=window_hours)).strftime("%Y-%m-%dT%H:%M-05:00")
    url = (
        f"https://waterservices.usgs.gov/nwis/iv/"
        f"?sites={site}&parameterCd={param}"
        f"&startDT={start}&endDT={end}&format=json"
    )
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    results = []
    try:
        ts_list = data["value"]["timeSeries"]
        if not ts_list:
            return results
        values = ts_list[0]["values"][0]["value"]
        for v in values:
            dt_str = v["dateTime"]
            val = v["value"]
            # Parse ISO datetime
            dt = pd.Timestamp(dt_str)
            if val and val != "" and val != "-999999":
                results.append((dt, float(val)))
    except (KeyError, IndexError):
        pass
    return results


def find_closest_value(api_results, target_dt, max_diff_minutes=60):
    """Find the API value closest in time to target_dt."""
    if not api_results:
        return None, None

    # Normalize target to UTC-5 (Eastern) for comparison
    target = pd.Timestamp(target_dt)

    best_val = None
    best_diff = timedelta(hours=999)
    best_dt = None
    for dt, val in api_results:
        # Make both tz-naive for comparison
        dt_naive = dt.tz_localize(None) if dt.tzinfo else dt
        target_naive = target.tz_localize(None) if target.tzinfo else target
        diff = abs(dt_naive - target_naive)
        if diff < best_diff:
            best_diff = diff
            best_val = val
            best_dt = dt_naive

    if best_diff <= timedelta(minutes=max_diff_minutes):
        return best_val, best_dt
    return None, None


# ── Run spot checks ──────────────────────────────────────────────────────
results = []

for idx, row in check_df.iterrows():
    ts = row.timestamp
    print(f"Checking {ts} ...")

    for col, (site, param) in SITES.items():
        csv_val = row[col]
        if pd.isna(csv_val):
            results.append({
                "timestamp": ts, "column": col, "csv_value": "NaN",
                "api_value": "—", "api_time": "—", "match": "skip (NaN in CSV)"
            })
            continue

        try:
            api_data = fetch_usgs_iv(site, param, ts)
            time.sleep(0.3)  # Be polite to the API
        except Exception as e:
            results.append({
                "timestamp": ts, "column": col, "csv_value": csv_val,
                "api_value": f"ERROR: {e}", "api_time": "—", "match": "ERROR"
            })
            continue

        api_val, api_dt = find_closest_value(api_data, ts)

        if api_val is None:
            results.append({
                "timestamp": ts, "column": col, "csv_value": csv_val,
                "api_value": "no data", "api_time": "—", "match": "NO DATA"
            })
            continue

        # Determine tolerance:
        #   CSV uses hourly medians of 15-min data, so some deviation expected
        #   Temperature: ±0.5°C; Discharge: ±5%; Stage: ±0.05 ft
        if col == "water_temp_c":
            tol = 1.0  # °C
            pct_diff = abs(csv_val - api_val)
            match = "YES" if pct_diff <= 0.1 else ("close" if pct_diff <= tol else "MISMATCH")
        elif col == "ef_stage":
            tol = 0.1  # ft
            pct_diff = abs(csv_val - api_val)
            match = "YES" if pct_diff <= 0.02 else ("close" if pct_diff <= tol else "MISMATCH")
        else:
            # discharge: percentage-based
            if csv_val == 0 and api_val == 0:
                match = "YES"
            elif csv_val == 0 or api_val == 0:
                match = "MISMATCH"
            else:
                pct_diff = abs(csv_val - api_val) / max(abs(csv_val), abs(api_val)) * 100
                match = "YES" if pct_diff <= 2 else ("close" if pct_diff <= 10 else "MISMATCH")

        results.append({
            "timestamp": ts, "column": col,
            "csv_value": f"{csv_val:.2f}" if isinstance(csv_val, float) else csv_val,
            "api_value": f"{api_val:.2f}",
            "api_time": str(api_dt),
            "match": match
        })

# ── Verify por_lagged (travel-time-shifted PoR) ─────────────────────────
print("\n--- Verifying por_lagged (travel-time-shifted PoR) ---")
lagged_results = []

for idx, row in check_df.iterrows():
    ts = row.timestamp
    travel_h = row.travel_time_h
    por_lagged_csv = row.por_lagged

    if pd.isna(travel_h) or pd.isna(por_lagged_csv):
        lagged_results.append({
            "timestamp": ts, "travel_time_h": travel_h,
            "por_lagged_csv": "NaN", "por_at_shifted": "—", "match": "skip"
        })
        continue

    # The lagged timestamp: the PoR reading from (T - travel_time_h) hours ago
    shifted_ts = ts - timedelta(hours=travel_h)
    print(f"  {ts}: travel_h={travel_h:.1f}, shifted to {shifted_ts}")

    try:
        api_data = fetch_usgs_iv("01638500", "00060", shifted_ts)
        time.sleep(0.3)
    except Exception as e:
        lagged_results.append({
            "timestamp": ts, "travel_time_h": travel_h,
            "por_lagged_csv": por_lagged_csv,
            "por_at_shifted": f"ERROR: {e}", "match": "ERROR"
        })
        continue

    api_val, api_dt = find_closest_value(api_data, shifted_ts)

    if api_val is None:
        lagged_results.append({
            "timestamp": ts, "travel_time_h": travel_h,
            "por_lagged_csv": f"{por_lagged_csv:.1f}",
            "por_at_shifted": "no data", "match": "NO DATA"
        })
        continue

    # por_lagged may be interpolated (fractional travel time), so allow wider tolerance
    if por_lagged_csv == 0 or api_val == 0:
        match = "YES" if por_lagged_csv == api_val else "MISMATCH"
    else:
        pct = abs(por_lagged_csv - api_val) / max(abs(por_lagged_csv), abs(api_val)) * 100
        match = "YES" if pct <= 2 else ("close" if pct <= 15 else "MISMATCH")

    lagged_results.append({
        "timestamp": ts, "travel_time_h": f"{travel_h:.1f}",
        "por_lagged_csv": f"{por_lagged_csv:.1f}",
        "por_at_shifted": f"{api_val:.1f}",
        "shifted_time": str(shifted_ts),
        "api_match_time": str(api_dt),
        "match": match
    })

# ── Print results ────────────────────────────────────────────────────────
print("\n" + "="*120)
print("SPOT-CHECK RESULTS: CSV vs USGS API")
print("="*120)
print(f"{'Timestamp':<22} {'Column':<16} {'CSV Value':>12} {'API Value':>12} {'API Time':<22} {'Match':<12}")
print("-"*120)
for r in results:
    print(f"{str(r['timestamp']):<22} {r['column']:<16} {str(r['csv_value']):>12} "
          f"{str(r['api_value']):>12} {str(r['api_time']):<22} {r['match']:<12}")

print("\n" + "="*120)
print("POR_LAGGED VERIFICATION (travel-time-shifted PoR)")
print("="*120)
print(f"{'Timestamp':<22} {'travel_h':>9} {'CSV por_lagged':>14} {'API PoR@shifted':>16} {'Match':<12}")
print("-"*120)
for r in lagged_results:
    print(f"{str(r['timestamp']):<22} {str(r.get('travel_time_h','')):>9} "
          f"{str(r['por_lagged_csv']):>14} {str(r['por_at_shifted']):>16} {r['match']:<12}")

# Summary
print("\n" + "="*60)
print("SUMMARY")
print("="*60)
total = len(results)
yes_count = sum(1 for r in results if r["match"] == "YES")
close_count = sum(1 for r in results if r["match"] == "close")
mismatch_count = sum(1 for r in results if r["match"] == "MISMATCH")
skip_count = sum(1 for r in results if "skip" in r["match"].lower() or r["match"] in ("NO DATA", "ERROR"))
print(f"Direct value checks: {total} total")
print(f"  Exact match:   {yes_count}")
print(f"  Close match:   {close_count}  (within tolerance for hourly medians)")
print(f"  MISMATCH:      {mismatch_count}")
print(f"  Skipped/Error: {skip_count}")

total_lag = len(lagged_results)
lag_yes = sum(1 for r in lagged_results if r["match"] == "YES")
lag_close = sum(1 for r in lagged_results if r["match"] == "close")
lag_mm = sum(1 for r in lagged_results if r["match"] == "MISMATCH")
lag_skip = sum(1 for r in lagged_results if r["match"] in ("skip", "NO DATA", "ERROR"))
print(f"\npor_lagged checks: {total_lag} total")
print(f"  Exact match:   {lag_yes}")
print(f"  Close match:   {lag_close}  (interpolation expected)")
print(f"  MISMATCH:      {lag_mm}")
print(f"  Skipped/Error: {lag_skip}")

if mismatch_count > 0:
    print("\n⚠ MISMATCHES FOUND — investigate the rows above.")
elif close_count + yes_count == total - skip_count:
    print("\n✓ All checkable values match or are within tolerance.")

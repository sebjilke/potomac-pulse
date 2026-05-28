#!/usr/bin/env python3
"""
Fetch hourly USGS instantaneous data for comprehensive backtest.

Gauges:
  - 01638500 (Point of Rocks): discharge (00060) + water temp (00010)
  - 01644148 (Edwards Ferry): gage height (00065)
  - 01646500 (Little Falls): discharge (00060)

Period: 2011-12-01 to 2026-02-19 (~14 years, limited by EF IV data start ~Dec 2011)
Resamples 15-min data to hourly medians, then computes travel-time-shifted PoR.

Output: analysis/hourly_backtest_data.csv
"""

import requests
import csv
import os
import time
import math
from datetime import datetime, timedelta
from collections import defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(SCRIPT_DIR, "hourly_backtest_data.csv")

# USGS IV API
IV_URL = "https://waterservices.usgs.gov/nwis/iv/"

# Gauge/param combinations
FETCHES = [
    ("01638500", "00060", "por_discharge"),  # PoR discharge
    ("01638500", "00010", "por_temp"),        # PoR water temp
    ("01644148", "00065", "ef_stage"),        # EF gage height
    ("01646500", "00060", "lf_discharge"),    # LF discharge
]

START_DATE = "2011-12-01"
END_DATE = "2026-02-19"


def fetch_iv_chunk(site_id, param_code, start, end):
    """Fetch one chunk of USGS IV data (max ~120 days recommended)."""
    params = {
        "sites": site_id,
        "parameterCd": param_code,
        "startDT": start,
        "endDT": end,
        "format": "json",
        "siteStatus": "all",
    }
    resp = requests.get(IV_URL, params=params, timeout=120)
    resp.raise_for_status()
    return resp.json()


def parse_iv_json(data):
    """Parse USGS IV JSON → list of (datetime_str, float_value)."""
    records = []
    if not data or "value" not in data:
        return records
    ts_list = data.get("value", {}).get("timeSeries", [])
    if not ts_list:
        return records
    for ts in ts_list:
        values = ts.get("values", [{}])[0].get("value", [])
        for v in values:
            try:
                dt_str = v["dateTime"]  # ISO 8601
                val = float(v["value"])
                if val > -999990:
                    records.append((dt_str, val))
            except (ValueError, KeyError, TypeError):
                continue
    return records


def fetch_full_series(site_id, param_code, label):
    """Fetch full date range in 90-day chunks with rate limiting."""
    all_records = []
    start = datetime.strptime(START_DATE, "%Y-%m-%d")
    end = datetime.strptime(END_DATE, "%Y-%m-%d")
    chunk_days = 90

    current = start
    chunk_num = 0
    while current < end:
        chunk_end = min(current + timedelta(days=chunk_days), end)
        s_str = current.strftime("%Y-%m-%d")
        e_str = chunk_end.strftime("%Y-%m-%d")
        chunk_num += 1
        print(f"  [{label}] chunk {chunk_num}: {s_str} → {e_str} ...", end=" ", flush=True)

        try:
            data = fetch_iv_chunk(site_id, param_code, s_str, e_str)
            recs = parse_iv_json(data)
            all_records.extend(recs)
            print(f"{len(recs)} records")
        except Exception as e:
            print(f"ERROR: {e}")

        current = chunk_end + timedelta(days=1)
        time.sleep(0.5)  # rate limiting

    print(f"  [{label}] total: {len(all_records)} records\n")
    return all_records


def resample_to_hourly(records):
    """
    Resample 15-min records to hourly medians.
    Input: list of (ISO datetime string, float value)
    Output: dict of {datetime_hour: median_value}
    """
    from statistics import median

    hourly_bins = defaultdict(list)
    for dt_str, val in records:
        # Parse ISO 8601: "2021-01-01T00:00:00.000-05:00"
        # Truncate to hour
        try:
            dt = datetime.fromisoformat(dt_str)
            hour_key = dt.replace(minute=0, second=0, microsecond=0)
            hourly_bins[hour_key].append(val)
        except (ValueError, TypeError):
            continue

    result = {}
    for hour_key, vals in hourly_bins.items():
        result[hour_key] = median(vals)
    return result


def compute_travel_time_hours(lf_cfs):
    """
    Searcy power law: T_total = 4139 * Q^(-0.5963) hours
    PoR→GF = 75% of total travel time
    """
    if lf_cfs <= 0:
        return 24.0  # fallback
    total_h = 4139.0 * (lf_cfs ** -0.5963)
    por_to_gf_h = total_h * 0.75
    # Clamp to reasonable range (2-48 hours)
    return max(2.0, min(48.0, por_to_gf_h))


def interpolate_por(por_hourly, target_dt):
    """
    Interpolate PoR discharge at a fractional hour.
    Returns None if target is outside data range.
    """
    # Find the two bracketing hours
    hour_floor = target_dt.replace(minute=0, second=0, microsecond=0)
    hour_ceil = hour_floor + timedelta(hours=1)

    v_floor = por_hourly.get(hour_floor)
    v_ceil = por_hourly.get(hour_ceil)

    if v_floor is not None and v_ceil is not None:
        frac = (target_dt - hour_floor).total_seconds() / 3600.0
        return v_floor + (v_ceil - v_floor) * frac
    elif v_floor is not None:
        return v_floor
    elif v_ceil is not None:
        return v_ceil
    return None


def main():
    print("=" * 60)
    print("Fetching hourly USGS IV data for comprehensive backtest")
    print(f"Period: {START_DATE} to {END_DATE}")
    print("=" * 60)

    # Step 1: Fetch all raw 15-min data
    raw_data = {}
    for site_id, param_code, label in FETCHES:
        print(f"\nFetching {label} ({site_id}/{param_code})...")
        raw_data[label] = fetch_full_series(site_id, param_code, label)

    # Step 2: Resample to hourly
    print("Resampling to hourly medians...")
    hourly = {}
    for label in ["por_discharge", "por_temp", "ef_stage", "lf_discharge"]:
        hourly[label] = resample_to_hourly(raw_data[label])
        print(f"  {label}: {len(hourly[label])} hourly values")

    # Step 3: Build merged dataset with travel-time-shifted PoR
    print("\nBuilding merged dataset with travel-time-shifted PoR...")

    # Get sorted list of all hours where we have LF discharge
    lf_hours = sorted(hourly["lf_discharge"].keys())
    por_hours_set = set(hourly["por_discharge"].keys())

    rows_out = []
    skipped_no_ef = 0
    skipped_no_por = 0
    skipped_no_lagged = 0

    for t in lf_hours:
        lf_val = hourly["lf_discharge"].get(t)
        ef_val = hourly["ef_stage"].get(t)
        por_now = hourly["por_discharge"].get(t)
        temp_val = hourly["por_temp"].get(t)

        if lf_val is None or lf_val <= 0:
            continue
        if ef_val is None or ef_val <= 0:
            skipped_no_ef += 1
            continue
        if por_now is None or por_now <= 0:
            skipped_no_por += 1
            continue

        # Compute travel time and look up lagged PoR
        travel_h = compute_travel_time_hours(lf_val)
        lagged_dt = t - timedelta(hours=travel_h)
        por_lagged = interpolate_por(hourly["por_discharge"], lagged_dt)

        if por_lagged is None or por_lagged <= 0:
            skipped_no_lagged += 1
            continue

        rows_out.append({
            "timestamp": t.strftime("%Y-%m-%d %H:%M"),
            "por_now": round(por_now, 1),
            "por_lagged": round(por_lagged, 1),
            "ef_stage": round(ef_val, 2),
            "lf_discharge": round(lf_val, 1),
            "water_temp_c": round(temp_val, 1) if temp_val is not None else "",
            "travel_time_h": round(travel_h, 1),
        })

    print(f"\nMerged rows: {len(rows_out)}")
    print(f"Skipped (no EF): {skipped_no_ef}")
    print(f"Skipped (no PoR current): {skipped_no_por}")
    print(f"Skipped (no PoR lagged): {skipped_no_lagged}")

    # Step 4: Write CSV
    fieldnames = ["timestamp", "por_now", "por_lagged", "ef_stage",
                   "lf_discharge", "water_temp_c", "travel_time_h"]
    with open(OUT_PATH, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows_out)

    print(f"\nData written to {OUT_PATH}")

    # Basic stats
    if rows_out:
        lf_vals = [r["lf_discharge"] for r in rows_out]
        por_vals = [r["por_now"] for r in rows_out]
        print(f"\nDate range: {rows_out[0]['timestamp']} to {rows_out[-1]['timestamp']}")
        print(f"LF discharge: min={min(lf_vals):.0f}, max={max(lf_vals):.0f}, "
              f"mean={sum(lf_vals)/len(lf_vals):.0f} cfs")
        print(f"PoR discharge: min={min(por_vals):.0f}, max={max(por_vals):.0f}, "
              f"mean={sum(por_vals)/len(por_vals):.0f} cfs")

        # Count with temp data
        temp_count = sum(1 for r in rows_out if r["water_temp_c"] != "")
        print(f"Rows with water temp: {temp_count} ({100*temp_count/len(rows_out):.1f}%)")

    print("\nDone!")


if __name__ == "__main__":
    main()

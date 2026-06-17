#!/usr/bin/env python3
"""
Fetch hourly USGS instantaneous data for the v36.1 corrected-residual CI backtest.

This is the v36.1 successor to fetch_hourly_backtest_data.py. It adds the model
inputs the production GF model actually consumes but the original CSV omitted, so a
backtest harness can run the REAL makeGFPrediction() faithfully (see
analysis/ci_v36.1_backtest_plan.md).

Gauges (site / param) — IDs verified against scheduled-update.js:167-173 `gauges`:
  - 01638500 Point of Rocks : discharge 00060 (por_now), water temp 00010 (water_temp_c)
  - 01643000 Monocacy       : discharge 00060   [NEW]
  - 01644000 Goose Creek     : discharge 00060   [NEW]
  - 01644280 Broad Run       : discharge 00060   [NEW, gauge IV record is shallow]
  - 01645000 Seneca Creek    : discharge 00060   [NEW]
  - 01644148 Edwards Ferry   : gage height 00065 (ef_stage)
  - 01646500 Little Falls    : discharge 00060 (lf_discharge), gage height 00065 (lf_stage) [stage NEW]

Differences from the original (all per the audited plan §4 / §12):
  - Adds the 4 tributaries + LF stage (lf_stage; needed for the validation anomaly
    HARD gates: stage-discharge & low-flow/high-stage, scheduled-update.js:966-982).
  - EF is now OPTIONAL: rows are NOT dropped when EF is missing (the model falls back
    to a PoR-only estimate). Original :208-210 dropped them.
  - Row driver is the UNION of PoR-discharge and LF-discharge hours (not LF-only), so
    the harness can build a dense porHistory (PoR lookback ~19-33h) and always find
    LF at a validation-due hour. A row is emitted if por_now OR lf_discharge is present.
  - Tributaries/LF-stage/EF/temp are written where available, BLANK otherwise. The
    harness passes blank -> null -> the model's TRIB_FALLBACK / default-EF / no-temp
    paths, exactly as production behaves when a real-time gauge is unavailable.
  - Window extended to 2026-06-15 to capture the spring-2026 freshet (high-flow cells).
  - por_lagged / travel_time_h are kept for PROVENANCE only; the harness ignores them
    (the real model does its own travel-time lookup off porHistory).

Output: analysis/hourly_backtest_data_v361.csv   (does NOT overwrite the original)
Provenance: this script is the sole generator; it prints per-series coverage and
per-tributary availability spans for the analysis-verification audit.
"""

import requests
import csv
import os
import time
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from statistics import median

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(SCRIPT_DIR, "hourly_backtest_data_v361.csv")

IV_URL = "https://waterservices.usgs.gov/nwis/iv/"

# (site_id, param_code, label)
FETCHES = [
    ("01638500", "00060", "por_discharge"),
    ("01638500", "00010", "por_temp"),
    ("01643000", "00060", "monocacy"),
    ("01644000", "00060", "goose"),
    ("01644280", "00060", "broad_run"),
    ("01645000", "00060", "seneca"),
    ("01644148", "00065", "ef_stage"),
    ("01646500", "00060", "lf_discharge"),
    ("01646500", "00065", "lf_stage"),
]

START_DATE = "2011-12-01"   # limited by EF IV record start (~Dec 2011)
END_DATE = "2026-06-15"     # extended past the original 2026-02-19 for spring-2026 high flow


# Accept-Encoding: identity avoids a gzip-decode failure seen on this LibreSSL/urllib3 stack
# under rapid successive requests; a descriptive User-Agent reduces USGS throttling/blocking.
REQUEST_HEADERS = {
    "Accept-Encoding": "identity",
    "User-Agent": "PotomacPulse-backtest/v36.1 (hydrology research; contact via github.com/sebjilke)",
}


def fetch_iv_chunk(site_id, param_code, start, end, retries=5):
    """Fetch one chunk of USGS IV data, retrying transient failures (provenance: no silent chunk loss)."""
    params = {
        "sites": site_id,
        "parameterCd": param_code,
        "startDT": start,
        "endDT": end,
        "format": "json",
        "siteStatus": "all",
    }
    last_err = None
    for attempt in range(retries):
        try:
            resp = requests.get(IV_URL, params=params, headers=REQUEST_HEADERS, timeout=120)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            last_err = e
            time.sleep(2.0 * (attempt + 1))
    raise RuntimeError(f"chunk failed after {retries} retries: {last_err}")


def parse_iv_json(data):
    """Parse USGS IV JSON -> list of (datetime_str, float_value), dropping the -999999 no-data sentinel."""
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
                dt_str = v["dateTime"]
                val = float(v["value"])
                if val > -999990:
                    records.append((dt_str, val))
            except (ValueError, KeyError, TypeError):
                continue
    return records


def fetch_full_series(site_id, param_code, label):
    """Fetch the full date range in 90-day chunks with rate limiting. Returns (records, failed_chunks)."""
    all_records = []
    failed_chunks = []
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
        print(f"  [{label}] chunk {chunk_num}: {s_str} -> {e_str} ...", end=" ", flush=True)
        try:
            data = fetch_iv_chunk(site_id, param_code, s_str, e_str)
            recs = parse_iv_json(data)
            all_records.extend(recs)
            print(f"{len(recs)} records")
        except Exception as e:
            print(f"ERROR: {e}")
            failed_chunks.append((s_str, e_str, str(e)))
        current = chunk_end + timedelta(days=1)
        time.sleep(0.5)

    print(f"  [{label}] total: {len(all_records)} records, {len(failed_chunks)} failed chunks\n")
    return all_records, failed_chunks


def resample_to_hourly(records):
    """Resample (ISO datetime str, value) records to hourly medians keyed by UTC truncated-hour.

    USGS IV timestamps are tz-aware (carry the gauge's local offset, -05:00/-04:00). We convert
    to UTC *before* truncating so the hourly bins are DST-free and uniformly 1h apart: local-clock
    truncation would gap at spring-forward (no 02:00) and produce duplicate hour labels at fall-back
    (01:00 twice). The harness parses the output 'timestamp' column as UTC. (Plan §12, Open risk 5.)
    """
    hourly_bins = defaultdict(list)
    for dt_str, val in records:
        try:
            dt = datetime.fromisoformat(dt_str)
            if dt.tzinfo is not None:
                dt = dt.astimezone(timezone.utc)
            hour_key = dt.replace(minute=0, second=0, microsecond=0)
            hourly_bins[hour_key].append(val)
        except (ValueError, TypeError):
            continue
    return {hk: median(vals) for hk, vals in hourly_bins.items()}


def compute_travel_time_hours(lf_cfs):
    """Searcy power law (PROVENANCE column only): T_total = 4139*Q^-0.5963 h, PoR->GF = 75% of total."""
    if lf_cfs is None or lf_cfs <= 0:
        return None
    total_h = 4139.0 * (lf_cfs ** -0.5963)
    return max(2.0, min(48.0, total_h * 0.75))


def interpolate_por(por_hourly, target_dt):
    """Linear interpolation of PoR discharge at a fractional hour (provenance por_lagged only)."""
    hour_floor = target_dt.replace(minute=0, second=0, microsecond=0)
    hour_ceil = hour_floor + timedelta(hours=1)
    v_floor = por_hourly.get(hour_floor)
    v_ceil = por_hourly.get(hour_ceil)
    if v_floor is not None and v_ceil is not None:
        frac = (target_dt - hour_floor).total_seconds() / 3600.0
        return v_floor + (v_ceil - v_floor) * frac
    if v_floor is not None:
        return v_floor
    if v_ceil is not None:
        return v_ceil
    return None


def _cell(v, ndigits):
    """Round a value, or '' if None (blank -> harness null)."""
    return round(v, ndigits) if v is not None else ""


def main():
    print("=" * 64)
    print("Fetching hourly USGS IV data for the v36.1 corrected-residual CI backtest")
    print(f"Period: {START_DATE} to {END_DATE}")
    print("=" * 64)

    # Step 1: fetch raw
    raw_data = {}
    failures = {}
    for site_id, param_code, label in FETCHES:
        print(f"\nFetching {label} ({site_id}/{param_code})...")
        recs, failed = fetch_full_series(site_id, param_code, label)
        raw_data[label] = recs
        failures[label] = failed

    # Step 2: resample to hourly medians
    print("Resampling to hourly medians...")
    hourly = {}
    for _, _, label in FETCHES:
        hourly[label] = resample_to_hourly(raw_data[label])
        print(f"  {label}: {len(hourly[label])} hourly values")

    # Step 3: merge on the UNION of PoR-discharge and LF-discharge hours
    print("\nBuilding merged dataset (row driver = PoR-discharge UNION LF-discharge hours)...")
    all_hours = sorted(set(hourly["por_discharge"].keys()) | set(hourly["lf_discharge"].keys()))

    rows_out = []
    n_por_only = 0   # has PoR, no LF (porHistory-only rows; no scoreable prediction)
    n_lf_only = 0    # has LF, no PoR (validation-target rows; no prediction)
    n_both = 0
    for t in all_hours:
        por_now = hourly["por_discharge"].get(t)
        lf_val = hourly["lf_discharge"].get(t)
        has_por = por_now is not None and por_now > 0
        has_lf = lf_val is not None and lf_val > 0
        if not has_por and not has_lf:
            continue
        if has_por and has_lf:
            n_both += 1
        elif has_por:
            n_por_only += 1
        else:
            n_lf_only += 1

        travel_h = compute_travel_time_hours(lf_val) if has_lf else None
        por_lagged = None
        if travel_h is not None:
            pl = interpolate_por(hourly["por_discharge"], t - timedelta(hours=travel_h))
            por_lagged = pl if (pl is not None and pl > 0) else None

        rows_out.append({
            "timestamp": t.strftime("%Y-%m-%d %H:%M"),
            "por_now": _cell(por_now, 1) if has_por else "",
            "por_lagged": _cell(por_lagged, 1),
            "ef_stage": _cell(hourly["ef_stage"].get(t), 2),
            "lf_discharge": _cell(lf_val, 1) if has_lf else "",
            "lf_stage": _cell(hourly["lf_stage"].get(t), 2),
            "water_temp_c": _cell(hourly["por_temp"].get(t), 1),
            "monocacy": _cell(hourly["monocacy"].get(t), 1),
            "goose": _cell(hourly["goose"].get(t), 1),
            "broad_run": _cell(hourly["broad_run"].get(t), 1),
            "seneca": _cell(hourly["seneca"].get(t), 1),
            "travel_time_h": _cell(travel_h, 1),
        })

    # Step 4: write CSV
    fieldnames = ["timestamp", "por_now", "por_lagged", "ef_stage", "lf_discharge",
                  "lf_stage", "water_temp_c", "monocacy", "goose", "broad_run",
                  "seneca", "travel_time_h"]
    with open(OUT_PATH, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows_out)
    print(f"\nData written to {OUT_PATH}")
    print(f"Rows: {len(rows_out)}  (both PoR+LF: {n_both}, PoR-only: {n_por_only}, LF-only: {n_lf_only})")

    # Step 5: provenance report — per-column coverage + per-tributary availability span
    if rows_out:
        print(f"\nDate range: {rows_out[0]['timestamp']} to {rows_out[-1]['timestamp']}")
        print("\nPer-column non-blank coverage (of merged rows):")
        for col in fieldnames:
            if col == "timestamp":
                continue
            nonblank = sum(1 for r in rows_out if r[col] != "")
            print(f"  {col:14s}: {nonblank:7d} ({100*nonblank/len(rows_out):5.1f}%)")

        print("\nTributary / LF-stage availability span (first..last non-blank, fallback fraction):")
        for col in ["monocacy", "goose", "broad_run", "seneca", "lf_stage", "ef_stage"]:
            present = [r["timestamp"] for r in rows_out if r[col] != ""]
            if present:
                blank_frac = 100 * (len(rows_out) - len(present)) / len(rows_out)
                print(f"  {col:14s}: {present[0]} .. {present[-1]}  (blank/fallback {blank_frac:.1f}%)")
            else:
                print(f"  {col:14s}: NO DATA")

    # Step 6: surface any failed chunks (no silent gaps)
    any_fail = False
    for label, failed in failures.items():
        if failed:
            any_fail = True
            print(f"\n!! {label}: {len(failed)} FAILED chunks (gaps possible):")
            for s, e, err in failed:
                print(f"     {s}..{e}: {err}")
    if not any_fail:
        print("\nAll chunks fetched cleanly (no gaps from fetch failures).")

    print("\nDone.")


if __name__ == "__main__":
    main()

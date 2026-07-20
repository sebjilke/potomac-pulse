#!/usr/bin/env python3
"""
Build hourly_backtest_data_v38.csv for the v38.0 EF divergence gate (plan v3 SS3).

  v38 CSV = frozen v361 rows + appended [--start, --end] window (default
  2026-06-14 -> 2026-07-20), fetched fresh from USGS IV.

Rules (plan v3 SS3, external review E10):
  - v361 is FROZEN and is never modified. Its rows always win: freshly fetched
    rows are appended ONLY at timestamps not present in v361.
  - The overlap (timestamps present in both) is DIFFED and reported, not merged -
    a fetch-consistency check on provisional-data drift.
  - The GOES-outage gap (Jul 15-16) stays as missing rows; the harness tolerates gaps.
  - Provenance (fetch date, window, diff summary) goes to a SIDECAR file
    (hourly_backtest_data_v38.PROVENANCE.txt), not a CSV header comment, so the
    CSV stays parseable by the harness and R/Python readers unchanged.

Coverage precondition (plan v3 SS3 - must pass before any replay): per-day
non-blank counts of por_now / ef_stage / lf_discharge over 2026-07-09 -> 2026-07-20
are printed; both July episodes must be covered.

Fetch/resample machinery is identical to fetch_hourly_backtest_data_v361.py
(UTC-truncated hourly medians; union row driver; blank cells for missing series).
"""

import argparse
import csv
import os
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import median

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
V361_PATH = os.path.join(SCRIPT_DIR, "hourly_backtest_data_v361.csv")
OUT_PATH = os.path.join(SCRIPT_DIR, "hourly_backtest_data_v38.csv")
PROV_PATH = os.path.join(SCRIPT_DIR, "hourly_backtest_data_v38.PROVENANCE.txt")

IV_URL = "https://waterservices.usgs.gov/nwis/iv/"
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
FIELDNAMES = ["timestamp", "por_now", "por_lagged", "ef_stage", "lf_discharge",
              "lf_stage", "water_temp_c", "monocacy", "goose", "broad_run",
              "seneca", "travel_time_h"]

REQUEST_HEADERS = {
    "Accept-Encoding": "identity",
    "User-Agent": "PotomacPulse-backtest/v38 (hydrology research; contact via github.com/sebjilke)",
}


def fetch_iv(site_id, param_code, start, end, retries=5):
    params = {"sites": site_id, "parameterCd": param_code, "startDT": start, "endDT": end,
              "format": "json", "siteStatus": "all"}
    last_err = None
    for attempt in range(retries):
        try:
            resp = requests.get(IV_URL, params=params, headers=REQUEST_HEADERS, timeout=120)
            resp.raise_for_status()
            data = resp.json()
            records = []
            for ts in data.get("value", {}).get("timeSeries", []):
                for v in ts.get("values", [{}])[0].get("value", []):
                    try:
                        val = float(v["value"])
                        if val > -999990:
                            records.append((v["dateTime"], val))
                    except (ValueError, KeyError, TypeError):
                        continue
            return records
        except Exception as e:
            last_err = e
            time.sleep(2.0 * (attempt + 1))
    raise RuntimeError(f"{site_id}/{param_code} failed after {retries} retries: {last_err}")


def resample_to_hourly(records):
    bins = defaultdict(list)
    for dt_str, val in records:
        try:
            dt = datetime.fromisoformat(dt_str)
            if dt.tzinfo is not None:
                dt = dt.astimezone(timezone.utc)
            bins[dt.replace(minute=0, second=0, microsecond=0)].append(val)
        except (ValueError, TypeError):
            continue
    return {k: median(v) for k, v in bins.items()}


def compute_travel_time_hours(lf_cfs):
    if lf_cfs is None or lf_cfs <= 0:
        return None
    total_h = 4139.0 * (lf_cfs ** -0.5963)
    return max(2.0, min(48.0, total_h * 0.75))


def interpolate_por(por_hourly, target_dt):
    hour_floor = target_dt.replace(minute=0, second=0, microsecond=0)
    hour_ceil = hour_floor + timedelta(hours=1)
    v_floor, v_ceil = por_hourly.get(hour_floor), por_hourly.get(hour_ceil)
    if v_floor is not None and v_ceil is not None:
        frac = (target_dt - hour_floor).total_seconds() / 3600.0
        return v_floor + (v_ceil - v_floor) * frac
    return v_floor if v_floor is not None else v_ceil


def _cell(v, nd):
    return round(v, nd) if v is not None else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2026-06-14")
    ap.add_argument("--end", default="2026-07-20")
    args = ap.parse_args()

    print(f"Fetching append window {args.start} -> {args.end} (9 series)...")
    hourly = {}
    for site, param, label in FETCHES:
        recs = fetch_iv(site, param, args.start, args.end)
        hourly[label] = resample_to_hourly(recs)
        print(f"  [{label}] {len(recs)} records -> {len(hourly[label])} hourly")
        time.sleep(0.5)

    all_hours = sorted(set(hourly["por_discharge"].keys()) | set(hourly["lf_discharge"].keys()))
    fetched_rows = {}
    for t in all_hours:
        por_now = hourly["por_discharge"].get(t)
        lf_val = hourly["lf_discharge"].get(t)
        has_por = por_now is not None and por_now > 0
        has_lf = lf_val is not None and lf_val > 0
        if not has_por and not has_lf:
            continue
        travel_h = compute_travel_time_hours(lf_val) if has_lf else None
        por_lagged = None
        if travel_h is not None:
            pl = interpolate_por(hourly["por_discharge"], t - timedelta(hours=travel_h))
            por_lagged = pl if (pl is not None and pl > 0) else None
        fetched_rows[t.strftime("%Y-%m-%d %H:%M")] = {
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
        }
    print(f"Fetched {len(fetched_rows)} merged rows for the append window.")

    # Merge: v361 rows verbatim (they win); fetched rows appended only at new timestamps.
    v361_rows = []
    v361_ts = set()
    with open(V361_PATH) as f:
        for r in csv.DictReader(f):
            v361_rows.append(r)
            v361_ts.add(r["timestamp"])

    overlap_diffs = []
    appended = []
    for ts_key in sorted(fetched_rows):
        if ts_key in v361_ts:
            old = next(r for r in v361_rows if r["timestamp"] == ts_key)
            new = fetched_rows[ts_key]
            diffs = [f"{c}: {old[c]!r} -> {new[c]!r}" for c in FIELDNAMES[1:]
                     if old[c] != str(new[c]) and not (old[c] == "" and new[c] == "")]
            if diffs:
                overlap_diffs.append((ts_key, diffs))
        else:
            appended.append(fetched_rows[ts_key])

    with open(OUT_PATH, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        w.writerows(v361_rows)
        w.writerows(appended)
    print(f"\n{OUT_PATH}: {len(v361_rows)} frozen v361 rows + {len(appended)} appended "
          f"= {len(v361_rows) + len(appended)} rows")

    # Coverage precondition: per-day non-blank counts Jul 9-20
    print("\nCoverage precondition (2026-07-09 -> 2026-07-20, non-blank hours/day):")
    cov = defaultdict(lambda: defaultdict(int))
    for row in appended:
        d = row["timestamp"][:10]
        if "2026-07-09" <= d <= "2026-07-20":
            for c in ("por_now", "ef_stage", "lf_discharge"):
                if row[c] != "":
                    cov[d][c] += 1
    cov_lines = []
    for d in sorted(cov):
        line = (f"  {d}: por {cov[d]['por_now']:2d}  ef {cov[d]['ef_stage']:2d}  "
                f"lf {cov[d]['lf_discharge']:2d}")
        cov_lines.append(line)
        print(line)

    with open(PROV_PATH, "w") as f:
        f.write(f"hourly_backtest_data_v38.csv provenance\n"
                f"Generated: {datetime.now(timezone.utc).isoformat()}\n"
                f"Generator: fetch_hourly_backtest_data_v38.py --start={args.start} --end={args.end}\n"
                f"Base: hourly_backtest_data_v361.csv ({len(v361_rows)} rows, FROZEN, rows win on overlap)\n"
                f"Appended: {len(appended)} rows ({args.start}..{args.end}, July 2026 values PROVISIONAL)\n"
                f"Overlap timestamps with differing values (NOT merged; v361 kept): {len(overlap_diffs)}\n")
        for ts_key, diffs in overlap_diffs[:200]:
            f.write(f"  {ts_key}: {'; '.join(diffs)}\n")
        f.write("\nCoverage precondition (per-day non-blank hours, 2026-07-09..20):\n")
        f.write("\n".join(cov_lines) + "\n")
    print(f"\nProvenance sidecar: {PROV_PATH}")
    print(f"Overlap rows with drift vs frozen v361: {len(overlap_diffs)} (v361 kept; see sidecar)")
    print("Done.")


if __name__ == "__main__":
    main()

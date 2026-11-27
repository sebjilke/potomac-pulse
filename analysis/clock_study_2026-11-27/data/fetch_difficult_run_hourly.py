#!/usr/bin/env python3
"""
Build difficult_run_hourly.csv: hourly record of USGS 01646000 (Difficult Run near Great Falls, VA),
discharge (parameter 00060), in the convention of hourly_backtest_data_v39.csv.

Stamps are YYYY-MM-DD HH:MM, UTC, start of the hour. Value = median of all readings in [T, T+1h),
no dedupe across returned timeSeries (same rule as resample_to_hourly in
fetch_hourly_backtest_data_v39.py), rounded to 1 decimal. Empty field when the hour has no reading.
Grid: every hour 2011-12-01 05:00 .. 2026-11-09 23:00.

Public service, no key, no custom headers. Raw answers are cached under raw/ (a re-run fetches nothing).

Run:  python3 -I fetch_difficult_run_hourly.py
"""
import csv
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from statistics import median

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(HERE, "raw")
OUT_PATH = os.path.join(HERE, "difficult_run_hourly.csv")

SITE, PARAM = "01646000", "00060"
FETCH_START = datetime(2011, 12, 1, 5, tzinfo=timezone.utc)
FETCH_END = datetime(2026, 11, 10, 0, tzinfo=timezone.utc)      # exclusive
LAST_STAMP = datetime(2026, 11, 9, 23, tzinfo=timezone.utc)
CHUNK_DAYS = 30
PAUSE_S = 1.0
IV_URL = "https://waterservices.usgs.gov/nwis/iv/"


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%MZ")


def chunks():
    s = FETCH_START
    while s < FETCH_END:
        e = min(s + timedelta(days=CHUNK_DAYS), FETCH_END)
        yield s, e
        s = e


def get_raw(s, e):
    q = {"sites": SITE, "parameterCd": PARAM, "startDT": iso(s),
         "endDT": iso(e - timedelta(minutes=1)), "format": "json"}
    url = IV_URL + "?" + urllib.parse.urlencode(q)
    path = os.path.join(RAW_DIR, f"{SITE}_{PARAM}_{s:%Y%m%d}_{e:%Y%m%d}.json")
    fetched = False
    if not os.path.exists(path):
        last = None
        for attempt in range(5):
            try:
                with urllib.request.urlopen(urllib.request.Request(url), timeout=120) as r:
                    body = r.read()
                json.loads(body)
                with open(path, "wb") as f:
                    f.write(body)
                fetched = True
                time.sleep(PAUSE_S)
                break
            except Exception as ex:  # noqa
                last = ex
                time.sleep(2.0 * (attempt + 1))
        else:
            raise RuntimeError(f"{url} failed: {last}")
    with open(path, "rb") as f:
        return json.loads(f.read()), url, fetched


def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    bins = defaultdict(list)
    n_req = n_net = 0
    n_missing = n_unparsable = n_readings = 0
    quals = Counter()
    nonpos = Counter()
    nseries = Counter()
    for s, e in chunks():
        data, url, fetched = get_raw(s, e)
        n_req += 1
        n_net += fetched
        tss = data.get("value", {}).get("timeSeries", [])
        nseries[len(tss)] += 1
        for ts in tss:
            nodata = ts.get("variable", {}).get("noDataValue")
            for v in ts.get("values", [{}])[0].get("value", []):
                try:
                    val = float(v["value"])
                except (ValueError, KeyError, TypeError):
                    n_unparsable += 1
                    continue
                if val <= -999990 or (nodata is not None and val == float(nodata)):
                    n_missing += 1
                    continue
                n_readings += 1
                for qc in v.get("qualifiers", []):
                    quals[qc] += 1
                if val <= 0:
                    nonpos["zero" if val == 0 else "negative"] += 1
                dt = datetime.fromisoformat(v["dateTime"])
                if dt.tzinfo is not None:
                    dt = dt.astimezone(timezone.utc)
                bins[dt.replace(minute=0, second=0, microsecond=0, tzinfo=None)].append(val)
    hourly = {k: median(v) for k, v in bins.items()}

    t = FETCH_START.replace(tzinfo=None)
    last = LAST_STAMP.replace(tzinfo=None)
    rows = 0
    with open(OUT_PATH, "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["timestamp", "dr_discharge"])
        while t <= last:
            v = hourly.get(t)
            w.writerow([t.strftime("%Y-%m-%d %H:%M"), round(v, 1) if v is not None else ""])
            rows += 1
            t += timedelta(hours=1)

    outside = [k for k in hourly if k < FETCH_START.replace(tzinfo=None) or k > last]
    per_year = Counter(k.year for k in hourly if k not in outside)
    per_hour_n = defaultdict(Counter)
    for k, v in bins.items():
        per_hour_n[k.year][len(v)] += 1
    # gaps
    gaps, cur, st = [], 0, None
    t = FETCH_START.replace(tzinfo=None)
    while t <= last:
        if t in hourly:
            if cur:
                gaps.append((st, cur))
            cur = 0
        else:
            if cur == 0:
                st = t
            cur += 1
        t += timedelta(hours=1)
    if cur:
        gaps.append((st, cur))
    gaps.sort(key=lambda g: (-g[1], g[0]))
    h = hashlib.sha256(open(OUT_PATH, "rb").read()).hexdigest()
    print(f"requests {n_req} (network this run {n_net}); series per answer {dict(nseries)}")
    print(f"rows {rows}; hours with value {len(hourly) - len(outside)}; outside grid {len(outside)}")
    print(f"readings kept {n_readings}; missing-flag readings dropped {n_missing}; unparsable {n_unparsable}")
    print("qualifiers", dict(quals), "nonpositive", dict(nonpos))
    print("per year", dict(sorted(per_year.items())))
    for y in sorted(per_hour_n):
        print("readings-per-hour", y, dict(sorted(per_hour_n[y].items())))
    print("gap runs", len(gaps), "top5", [(g[0].strftime("%Y-%m-%d %H:%M"), g[1]) for g in gaps[:5]])
    print("sha256", h, "bytes", os.path.getsize(OUT_PATH))


if __name__ == "__main__":
    sys.exit(main())

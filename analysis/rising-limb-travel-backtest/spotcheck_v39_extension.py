#!/usr/bin/env python3
"""Independent spot check of hourly_backtest_data_v39.csv against FRESH USGS IV queries (no cache use).
Rows are drawn with random.Random(20261112) from the appended period; 2026-10-14 12:00 and
2026-10-14 18:00 are forced. For each row and each of 5 series, one fresh GET for [T, T+1h) UTC,
median of the readings, compared with the CSV cell. Prints a table; deterministic given USGS state."""
import csv, json, os, random, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from statistics import median
from zoneinfo import ZoneInfo
HERE = os.path.dirname(os.path.abspath(__file__))
SER = [("por_now", "01638500", "00060"), ("lf_discharge", "01646500", "00060"),
       ("monocacy", "01643000", "00060"), ("ef_stage", "01644148", "00065"), ("lf_stage", "01646500", "00065")]
rows = {r["timestamp"]: r for r in csv.DictReader(open(os.path.join(HERE, "hourly_backtest_data_v39.csv")))}
cand = sorted(k for k in rows if k >= "2026-07-21 00:00")
rng = random.Random(20261112)
pick = ["2026-10-14 12:00", "2026-10-14 18:00"] + sorted(rng.sample(cand, 6))
bad = 0
for ts in pick:
    t = datetime.strptime(ts, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    out = []
    for col, site, par in SER:
        # USGS startDT/endDT with Z or offsets is applied 1 h early during DST (observed 2026-11-10), so query
        # bare site-local clock time (America/New_York) over a wide window, then filter to [T, T+1h) UTC here.
        lo = (t - timedelta(hours=1)).astimezone(ZoneInfo("America/New_York")).strftime("%Y-%m-%dT%H:%M")
        hi = (t + timedelta(hours=2)).astimezone(ZoneInfo("America/New_York")).strftime("%Y-%m-%dT%H:%M")
        q = {"sites": site, "parameterCd": par, "startDT": lo, "endDT": hi, "format": "json", "siteStatus": "all"}
        u = "https://waterservices.usgs.gov/nwis/iv/?" + urllib.parse.urlencode(q)
        d = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "PotomacPulse-backtest/v39 (hydrology research)"}), timeout=60).read())
        vals = [float(v["value"]) for s in d["value"]["timeSeries"] for v in s["values"][0]["value"]
                if float(v["value"]) > -999990 and t <= datetime.fromisoformat(v["dateTime"]).astimezone(timezone.utc) < t + timedelta(hours=1)]
        live = median(vals) if vals else None
        csvv = float(rows[ts][col]) if rows[ts][col] != "" else None
        ok = (live is None and csvv is None) or (live is not None and csvv is not None and abs(live - csvv) <= max(0.01 * abs(live), 0.011))
        bad += not ok
        out.append(f"{col}: csv={csvv} live={live} n={len(vals)} {'OK' if ok else 'DIFF'}")
        time.sleep(0.5)
    print(ts, " | ".join(out))
print("rows checked:", len(pick), "cell mismatches (>1%):", bad)

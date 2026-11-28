#!/usr/bin/env python3
"""
Fetch the 15-minute USGS readings for the event of 24 to 28 November 2026 and write one tidy file.

Public USGS service, no key, no custom header. One request per gauge and parameter; each request
carries only sites, parameterCd, startDT and format (endDT is left out, so the answer runs to the
latest reading). At most one request per second. Raw answers are saved under raw/ with the fetch
time in the file name (a re-run fetches again and never overwrites an earlier file).
Output: event_15min.csv with columns time_utc, site, parameter, value, qualifier.

Run:  python3 -I fetch_event.py
"""
import csv
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(HERE, "raw")
OUT_PATH = os.path.join(HERE, "event_15min.csv")
IV_URL = "https://waterservices.usgs.gov/nwis/iv/"
START = "2026-11-24T00:00Z"
PAUSE_S = 1.0

# (site, parameter, label)
SERIES = [
    ("01646500", "00060", "Little Falls flow"),
    ("01646500", "00065", "Little Falls stage"),
    ("01646000", "00060", "Difficult Run flow"),
    ("01638500", "00060", "Point of Rocks flow"),
    ("01644148", "00065", "Edwards Ferry stage"),
    ("01643000", "00060", "Monocacy flow"),
    ("01644000", "00060", "Goose Creek flow"),
    ("01644280", "00060", "Broad Run flow"),
    ("01645000", "00060", "Seneca Creek flow"),
    ("01646305", "00060", "Dead Run at Whann Avenue flow"),
]


def fetch(site, param):
    q = {"sites": site, "parameterCd": param, "startDT": START, "format": "json"}
    url = IV_URL + "?" + urllib.parse.urlencode(q)
    last = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url), timeout=120) as r:
                body = r.read()
            json.loads(body)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            path = os.path.join(RAW_DIR, f"{site}_{param}_from20261124_fetched{stamp}.json")
            with open(path, "xb") as f:
                f.write(body)
            time.sleep(PAUSE_S)
            return path, url
        except Exception as ex:  # noqa
            last = ex
            time.sleep(2.0 * (attempt + 1))
    raise RuntimeError(f"{url} failed: {last}")


def newest_raw(site, param):
    pre = f"{site}_{param}_from20261124_fetched"
    names = sorted(n for n in os.listdir(RAW_DIR) if n.startswith(pre) and n.endswith(".json"))
    return os.path.join(RAW_DIR, names[-1]) if names else None


def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    for site, param, label in SERIES:
        path, url = fetch(site, param)
        print("fetched", label, url, "->", os.path.basename(path))
    rows = []
    for site, param, label in SERIES:
        path = newest_raw(site, param)
        with open(path, "rb") as f:
            data = json.loads(f.read())
        tss = data.get("value", {}).get("timeSeries", [])
        print(label, "series in answer:", len(tss))
        for ts in tss:
            nodata = ts.get("variable", {}).get("noDataValue")
            for v in ts.get("values", [{}])[0].get("value", []):
                dt = datetime.fromisoformat(v["dateTime"])
                if dt.tzinfo is not None:
                    dt = dt.astimezone(timezone.utc)
                t = dt.strftime("%Y-%m-%d %H:%M")
                raw = v.get("value")
                try:
                    x = float(raw)
                    if nodata is not None and x == float(nodata):
                        x = None
                except (TypeError, ValueError):
                    x = None
                rows.append((t, site, param, raw if x is not None else "", ";".join(v.get("qualifiers", []))))
    rows.sort(key=lambda r: (r[1], r[2], r[0]))
    with open(OUT_PATH, "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["time_utc", "site", "parameter", "value", "qualifier"])
        w.writerows(rows)
    print("rows", len(rows), "->", OUT_PATH)


if __name__ == "__main__":
    sys.exit(main())

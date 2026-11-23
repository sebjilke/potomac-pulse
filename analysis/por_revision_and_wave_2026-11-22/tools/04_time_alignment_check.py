#!/usr/bin/env python3
"""Time-alignment check of the old-service archive against USGS's current record.

Why: the data builder found that old-service files with -04:00 timestamps start one hour before
the requested window. Either the old service shifted its window (labels right), or the -04:00
labels are an hour off. That cannot be settled from the old files alone.

How: for series that are expected to be unrevised (water level and tributary flow), count how
many old-archive values equal the current-record value at the identical UTC timestamp (shift 0)
and at the timestamp one hour earlier or later. If the labels are right, shift 0 wins clearly.

Written and run by the orchestrator on 2026-11-22 as a data-integrity check (it is not a study
result and it does not touch Point of Rocks flow). The tool auditor re-verifies it.

Usage (from the study folder):  python3 tools/04_time_alignment_check.py
Reads:  data/tidy/readings_old_archive.csv, readings_current_model.csv, readings_current_census.csv
Writes: tools/04_time_alignment_check.OUTPUT.txt
"""
import collections
import csv
import datetime as dt
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TIDY = os.path.join(HERE, "..", "data", "tidy")
FMT = "%Y-%m-%dT%H:%M:%SZ"

SERIES = [
    ("01646500", "00065", "Little Falls level"),
    ("01646500", "00060", "Little Falls flow"),
    ("01643000", "00060", "Monocacy flow"),
    ("01644148", "00065", "Edwards Ferry level"),
]
PERIODS = [
    ("old files stamped -04:00 (12 Jun to 31 Oct)", "2026-06-12", "2026-11-01T05"),
    ("old files stamped -05:00 (1 to 9 Nov)", "2026-11-01T07", "2026-11-10"),
]


def load(name, want):
    out = collections.defaultdict(dict)
    with open(os.path.join(TIDY, name), newline="") as f:
        for r in csv.DictReader(f):
            k = (r["gauge"], r["parameter"])
            if k in want and r["value"] != "":
                out[k][r["time_utc"]] = float(r["value"])
    return out


def shifted(t, minutes):
    return (dt.datetime.strptime(t, FMT) + dt.timedelta(minutes=minutes)).strftime(FMT)


def main():
    want = {(g, p) for g, p, _ in SERIES}
    old = load("readings_old_archive.csv", want)
    cur = load("readings_current_model.csv", want)
    census = load("readings_current_census.csv", want)
    for k, v in census.items():          # Little Falls flow lives in the census table
        cur[k].update(v)
    lines = []
    for g, p, label in SERIES:
        k = (g, p)
        for plabel, lo, hi in PERIODS:
            parts = []
            for m in (-60, 0, 60):
                n = eq = 0
                for t, v in old[k].items():
                    if not (lo <= t < hi):
                        continue
                    t2 = shifted(t, m)
                    if t2 in cur[k]:
                        n += 1
                        eq += v == cur[k][t2]
                pct = 100.0 * eq / n if n else float("nan")
                parts.append(f"shift {m:+d} min: {eq}/{n} equal ({pct:.1f}%)")
            lines.append(f"{label} ({g} {p}), {plabel}: " + " | ".join(parts))
    text = "\n".join(lines) + "\n"
    with open(os.path.join(HERE, "04_time_alignment_check.OUTPUT.txt"), "w") as f:
        f.write(text)
    print(text, end="")


if __name__ == "__main__":
    main()

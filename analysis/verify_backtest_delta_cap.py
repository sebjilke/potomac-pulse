#!/usr/bin/env python3
"""
Independent verification of backtest_delta_cap.py results.
Written from scratch — does NOT import or reference the main backtest script.

Verifies two configurations:
  1. Winner: decay_cap=0.50, ceiling_ratio=1.10
  2. Baseline: decay_cap=0.75, no ceiling

Expected results from main script:
  Winner:   Overall RMSE ≈ 1353.2, Rising RMSE ≈ 1849.9, Rising Bias ≈ -4.8
  Baseline: Overall RMSE ≈ 2977.5, Rising RMSE ≈ 4638.8, Rising Bias ≈ +1175.8
"""

import csv
import math
import os
from datetime import date as dt

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(SCRIPT_DIR, "ef_lf_daily_longterm.csv")

# Model constants
COEFF = 126.0
EXPONENT = 2.46
STALE_H = 20
TRAVEL_H = 20

# Gradient anchors (v27.0)
ANCHORS_FLOW = [0, 3000, 6000, 10000, 15000, 25000, 50000]
ANCHORS_WT   = [0.0, 0.0, 0.1, 0.4, 0.4, 0.4, 0.4]


def gradient_weight(q):
    if q <= 0:
        return 0.0
    if q >= 50000:
        return 0.4
    for k in range(1, len(ANCHORS_FLOW)):
        if q <= ANCHORS_FLOW[k]:
            f0, w0 = ANCHORS_FLOW[k-1], ANCHORS_WT[k-1]
            f1, w1 = ANCHORS_FLOW[k], ANCHORS_WT[k]
            return w0 + (w1 - w0) * (q - f0) / (f1 - f0)
    return 0.4


def power_law(stage):
    return COEFF * (stage ** EXPONENT)


def compute_estimate(por_yesterday, por_today, ef_stg, lf_today, d_cap, c_ratio):
    ef_cfs = power_law(ef_stg)
    base = por_yesterday

    # PoR-delta correction
    if por_yesterday > 0:
        change = (por_today / por_yesterday - 1.0) * 100.0
        if abs(change) > 5.0:
            frac = min(1.0, STALE_H / TRAVEL_H)
            decay = min(d_cap, math.sqrt(frac))
            ratio = por_today / por_yesterday
            applied = 1.0 + (ratio - 1.0) * decay
            base = por_yesterday * applied

    # Blend
    w = gradient_weight(base)
    est = (1.0 - w) * base + w * ef_cfs

    # Ceiling
    if c_ratio is not None and lf_today > 0 and est > lf_today * c_ratio:
        est = lf_today * c_ratio

    return est


# Load & deduplicate
rows = []
seen_dates = set()
with open(DATA_FILE) as fh:
    for rec in csv.DictReader(fh):
        d = rec["date"]
        if d in seen_dates:
            continue
        seen_dates.add(d)
        try:
            s = float(rec["ef_stage"])
            q = float(rec["lf_discharge"])
        except (ValueError, KeyError):
            continue
        if s > 0 and q > 0:
            rows.append((d, s, q))

rows.sort(key=lambda x: x[0])
print(f"Loaded {len(rows)} unique rows")

# Build consecutive-day pairs
pairs = []
for i in range(1, len(rows)):
    d0 = rows[i-1][0]
    d1 = rows[i][0]
    date0 = dt(int(d0[:4]), int(d0[5:7]), int(d0[8:10]))
    date1 = dt(int(d1[:4]), int(d1[5:7]), int(d1[8:10]))
    if (date1 - date0).days == 1:
        pairs.append((rows[i-1], rows[i]))

print(f"Built {len(pairs)} consecutive-day pairs\n")

# Two configs to verify
configs = [
    ("Winner (0.50, 110%)", 0.50, 1.10),
    ("Baseline (0.75, none)", 0.75, None),
]

for label, dcap, cratio in configs:
    errs_all, errs_rise, errs_fall, errs_steady = [], [], [], []

    for (d0, s0, q0), (d1, s1, q1) in pairs:
        est = compute_estimate(q0, q1, s1, q1, dcap, cratio)
        err = est - q1

        errs_all.append(err)
        if q1 > q0 * 1.05:
            errs_rise.append(err)
        elif q1 < q0 * 0.95:
            errs_fall.append(err)
        else:
            errs_steady.append(err)

    def rmse(e):
        return math.sqrt(sum(x**2 for x in e) / len(e)) if e else float('nan')

    def bias(e):
        return sum(e) / len(e) if e else float('nan')

    print(f"=== {label} ===")
    print(f"  Overall RMSE:  {rmse(errs_all):.1f}  (n={len(errs_all)})")
    print(f"  Rising RMSE:   {rmse(errs_rise):.1f}  (n={len(errs_rise)})")
    print(f"  Falling RMSE:  {rmse(errs_fall):.1f}  (n={len(errs_fall)})")
    print(f"  Steady RMSE:   {rmse(errs_steady):.1f}  (n={len(errs_steady)})")
    print(f"  Overall Bias:  {bias(errs_all):+.1f}")
    print(f"  Rising Bias:   {bias(errs_rise):+.1f}")
    print()

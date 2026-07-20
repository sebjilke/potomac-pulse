#!/usr/bin/env python3
"""
Below-PoR-dominated event census (v38.0 gate, plan v3 SS4 / external review E2).

Reproduces, as a versioned artifact, the census that fixed the v38 gate's a-priori
event windows (previously chat-only). Two earlier definitions were tried and
rejected (documented for the verdict):
  - level-based daily share with lag-1 PoR: false-flags the rising limb of every
    basin-wide flood (PoR wave not yet arrived) and misses recession divergence;
  - pure hourly-balance share >= 0.5: flags ~111 events/14.5y - every storm's
    rising limb qualifies because ungauged area responds fastest.

THE census definition (hybrid - each criterion kills a distinct false-positive
class):

  1. EVENT DETECTION (daily-mean USGS DV data): day t is an event peak iff LF(t)
     is a local max over [t-2, t+2], dLF = LF(t) - min LF over [t-6, t-1] >= 800 cfs,
     and dLF / lf_base >= 0.40.
  2. NOT PoR-DOMINATED (daily rise decomposition; kills basin-wide storms):
       por_contrib = max(0, max PoR over [t-3, t] - min PoR over [t-7, t-2]) / dLF
     must be < 0.40.
  3. UNGAUGED-DOMINATED (hourly water balance from the harness CSV; kills
     trib-dominated events):
       day_share(d) = sum_h(LF - por_lagged - tribSum) / sum_h(LF - por_lagged)
       over hours of day d with LF - por_lagged > 0 (por_lagged = travel-shifted
       PoR from the CSV; missing trib -> production ratio x por_lagged)
     max day_share over [t-1, t+1] must be >= 0.50.

  Flagged peaks <= 3 days apart merge into one event.

Usage: python3 census_below_por_events.py [--hourly=hourly_backtest_data_v361.csv]
  (rerun with --hourly=hourly_backtest_data_v38.csv once the appended dataset
   exists to cover the 2026 episodes)

Output: analysis/below_por_event_census.csv (all detected event peaks with all
three criteria's values, flagged or not). Provenance: sole generator.

The frozen gate windows (plan v3 SS4) are PRE-REGISTERED AND CANNOT MOVE; the
reconciliation table below documents, for each, whether this versioned census
reproduces it. The two 2026 episodes were selected as observed production
failures, NOT by census (plan v3 states this openly).
"""

import csv
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(SCRIPT_DIR, "below_por_event_census.csv")

DV_URL = "https://waterservices.usgs.gov/nwis/dv/"
START_DATE = "2011-01-01"
END_DATE = "2026-07-20"

SITES = {
    "por": "01638500",
    "lf": "01646500",
    "monocacy": "01643000",
    "goose": "01644000",
    "broad_run": "01644280",
    "seneca": "01645000",
}
TRIB_FALLBACK = {"monocacy": 0.071, "goose": 0.030, "broad_run": 0.0066, "seneca": 0.0087}

RISE_MIN_CFS = 800.0
RISE_MIN_FRAC = 0.40
POR_CONTRIB_MAX = 0.40
SHARE_MIN = 0.50
MERGE_GAP_DAYS = 3

DRAINAGE = {
    "lf": 11560.0, "por": 9651.0,
    "monocacy": 817.0, "goose": 332.0, "seneca": 101.0, "broad_run": 50.0,
}

REQUEST_HEADERS = {
    "Accept-Encoding": "identity",
    "User-Agent": "PotomacPulse-backtest/v38 (hydrology research; contact via github.com/sebjilke)",
}

FROZEN_HISTORICAL = ["2012-07-10", "2014-08-12", "2019-07-24", "2019-10-17", "2019-10-21",
                     "2022-07-09", "2022-08-05"]
EPISODES_2026 = [("2026-07-09", "2026-07-12"), ("2026-07-17", "2026-07-20")]


def fetch_dv(site_id, label, retries=5):
    params = {
        "sites": site_id, "parameterCd": "00060", "statCd": "00003",
        "startDT": START_DATE, "endDT": END_DATE, "format": "json", "siteStatus": "all",
    }
    last_err = None
    for attempt in range(retries):
        try:
            resp = requests.get(DV_URL, params=params, headers=REQUEST_HEADERS, timeout=120)
            resp.raise_for_status()
            data = resp.json()
            out = {}
            for ts in data.get("value", {}).get("timeSeries", []):
                for v in ts.get("values", [{}])[0].get("value", []):
                    try:
                        val = float(v["value"])
                        if val > -999990:
                            out[v["dateTime"][:10]] = val
                    except (ValueError, KeyError, TypeError):
                        continue
            print(f"  [{label}] {len(out)} daily values")
            return out
        except Exception as e:
            last_err = e
            time.sleep(2.0 * (attempt + 1))
    raise RuntimeError(f"{label} fetch failed after {retries} retries: {last_err}")


def load_hourly_day_shares(path):
    """Hourly water-balance ungauged share per calendar day, from the harness CSV."""
    acc = defaultdict(lambda: [0.0, 0.0, 0])  # exc_sum, ung_sum, n_hours
    with open(path) as f:
        for r in csv.DictReader(f):
            lf_s, pl_s = r["lf_discharge"], r["por_lagged"]
            if not lf_s or not pl_s:
                continue
            lf, pl = float(lf_s), float(pl_s)
            tribs = 0.0
            for trib, ratio in TRIB_FALLBACK.items():
                v = r[trib]
                tribs += float(v) if v else ratio * pl
            d = r["timestamp"][:10]
            ex = lf - pl
            if ex > 0:
                acc[d][0] += ex
                acc[d][1] += ex - tribs
            acc[d][2] += 1
    return {d: (ung / exc if exc > 0 else None)
            for d, (exc, ung, n) in acc.items() if n >= 12}


def dstr(d):
    return d.strftime("%Y-%m-%d")


def wvals(ser, center, lo, hi):
    return [ser[dstr(center + timedelta(days=k))] for k in range(lo, hi + 1)
            if dstr(center + timedelta(days=k)) in ser]


def main():
    hourly_path = os.path.join(SCRIPT_DIR, "hourly_backtest_data_v361.csv")
    for a in sys.argv[1:]:
        if a.startswith("--hourly="):
            hourly_path = os.path.join(SCRIPT_DIR, a.split("=", 1)[1])

    print("=" * 64)
    print(f"Below-PoR event census: {START_DATE} -> {END_DATE}")
    print(f"Hourly balance source: {os.path.basename(hourly_path)}")
    print("=" * 64)
    series = {label: fetch_dv(site, label) for label, site in SITES.items()}
    day_share = load_hourly_day_shares(hourly_path)
    print(f"  [hourly] {len(day_share)} day-shares computed")

    lf, por = series["lf"], series["por"]
    candidates = []
    d = datetime.strptime(START_DATE, "%Y-%m-%d") + timedelta(days=7)
    end = datetime.strptime(END_DATE, "%Y-%m-%d")
    while d <= end:
        day = dstr(d)
        v = lf.get(day)
        if v is not None:
            neigh = wvals(lf, d, -2, 2)
            base_w = wvals(lf, d, -6, -1)
            if neigh and v >= max(neigh) and base_w:
                lf_base = min(base_w)
                dLF = v - lf_base
                if dLF >= RISE_MIN_CFS and lf_base > 0 and dLF / lf_base >= RISE_MIN_FRAC:
                    por_peak_w = wvals(por, d, -3, 0)
                    por_base_w = wvals(por, d, -7, -2)
                    if por_peak_w and por_base_w:
                        dPoR = max(0.0, max(por_peak_w) - min(por_base_w))
                        por_c = dPoR / dLF
                        shares = [day_share.get(dstr(d + timedelta(days=k)))
                                  for k in (-1, 0, 1)]
                        shares = [s for s in shares if s is not None]
                        peak_share = max(shares) if shares else None
                        flagged = (por_c < POR_CONTRIB_MAX and peak_share is not None
                                   and peak_share >= SHARE_MIN)
                        candidates.append({
                            "peak_date": day, "lf_peak": round(v, 1),
                            "lf_base": round(lf_base, 1), "dLF": round(dLF, 1),
                            "por_contrib": round(por_c, 3),
                            "hourly_peak_share": round(peak_share, 3) if peak_share is not None else "",
                            "flagged": int(flagged),
                        })
        d += timedelta(days=1)

    with open(OUT_PATH, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(candidates[0].keys()))
        w.writeheader()
        w.writerows(candidates)
    print(f"\nEvent-peak census written: {OUT_PATH} ({len(candidates)} candidates)")

    flagged = [c for c in candidates if c["flagged"]]
    events = []
    for c in flagged:
        d0 = datetime.strptime(c["peak_date"], "%Y-%m-%d")
        if events and (d0 - datetime.strptime(events[-1][-1]["peak_date"], "%Y-%m-%d")).days <= MERGE_GAP_DAYS:
            events[-1].append(c)
        else:
            events.append([c])

    print(f"\n{len(flagged)} flagged peaks -> {len(events)} events "
          f"(rise>={RISE_MIN_CFS:.0f}cfs & >={RISE_MIN_FRAC:.0%}, PoR-contrib<{POR_CONTRIB_MAX}, "
          f"hourly peak-day share>={SHARE_MIN}):\n")
    print(f"{'peak(s)':26s} {'LF peak':>8s} {'dLF':>7s} {'PoR':>6s} {'share':>6s}")
    for ev in events:
        peak = max(ev, key=lambda c: c["lf_peak"])
        span = ev[0]["peak_date"] if len(ev) == 1 else f"{ev[0]['peak_date']}..{ev[-1]['peak_date']}"
        print(f"{span:26s} {peak['lf_peak']:8.0f} {peak['dLF']:7.0f} "
              f"{peak['por_contrib']:6.2f} {peak['hourly_peak_share']:6.2f}")

    print("\nReconciliation vs frozen historical flagged days (windows CANNOT move):")
    cand_by_day = {c["peak_date"]: c for c in candidates}
    flag_days = {c["peak_date"] for c in flagged}
    for day in FROZEN_HISTORICAL:
        near = sorted(dd for dd in flag_days
                      if abs((datetime.strptime(dd, "%Y-%m-%d") - datetime.strptime(day, "%Y-%m-%d")).days) <= 2)
        if near:
            print(f"  {day}: REPRODUCED {near}")
        else:
            c = cand_by_day.get(day)
            detail = (f"candidate: PoR {c['por_contrib']}, share {c['hourly_peak_share']}"
                      if c else "no daily event candidate")
            print(f"  {day}: NOT FLAGGED (+/-2d) - {detail}")

    print("\n2026 episodes (selected as observed failures, not by census):")
    for start, endd in EPISODES_2026:
        d0, d1 = (datetime.strptime(x, "%Y-%m-%d") for x in (start, endd))
        found = False
        k = d0
        while k <= d1:
            day = dstr(k)
            if day in cand_by_day:
                c = cand_by_day[day]
                mark = " <- meets census criteria" if c["flagged"] else ""
                print(f"  {day}: dLF {c['dLF']:.0f}, PoR {c['por_contrib']:.2f}, "
                      f"share {c['hourly_peak_share'] or 'n/a'}{mark}")
                found = True
            elif day in day_share and day_share[day] is not None:
                print(f"  {day}: hourly share {day_share[day]:.2f} (no daily peak candidate)")
                found = True
            k += timedelta(days=1)
        if not found:
            print(f"  {start}..{endd}: not covered by hourly source "
                  f"(rerun with --hourly=hourly_backtest_data_v38.csv)")

    gauged = sum(DRAINAGE[k] for k in ("por", "monocacy", "goose", "seneca", "broad_run"))
    print(f"\nIntervening ungauged drainage: LF {DRAINAGE['lf']:.0f} - gauged {gauged:.0f} "
          f"= {DRAINAGE['lf'] - gauged:.0f} mi^2 (Broad Run DA approximate)")
    print("\nDone.")


if __name__ == "__main__":
    main()

#!/usr/bin/python3
"""Auditor check 8: live USGS spot check (plan section 9). 8 RL ticks drawn with default_rng(20261116):
2 of event 53's scored RL ticks (tick order), then 6 of the other 20 GATE events' scored RL ticks (tick order).
For each: PoR (01638500) stamp = tick - 2 h - por_carry_h, LF (01646500) stamp = tick - 1 h - lf_carry_h;
compare por_view / lf_view with the median of live IV readings in [stamp, stamp+1h) UTC (filtered on each
reading's own timestamp from a wide request window). Raw responses archived in usgs_raw/.
Use --offline to recompute the table from the archived responses only."""
import os, sys, json, time, urllib.request, urllib.parse
from datetime import datetime, timedelta, timezone
from statistics import median
import numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__)); A6 = os.path.dirname(HERE)
BT = os.path.abspath(os.path.join(A6, "..", "rising-limb-travel-backtest")); RAW = os.path.join(HERE, "usgs_raw")
OFF = "--offline" in sys.argv
COLS = ["tick_utc", "arm", "in_scoring", "mask", "has_pred", "rl_event", "lf_view", "por_view", "lf_carry_h", "por_carry_h"]
S = pd.concat([c[c.arm == "base"] for c in pd.read_csv(os.path.join(BT, "rising_limb_ticks.csv"), usecols=COLS, dtype=str, keep_default_na=False, chunksize=250000)], ignore_index=True)
ev = pd.read_csv(os.path.join(BT, "rising_limb_events_python_v39.csv"), dtype=str, keep_default_na=False)
G = set(int(x) for x in ev[(ev.event_row == "1") & (ev.kept == "1") & (ev.event_class == "GATE")].event_id); assert len(G) == 21
mask = S["mask"] == "1"; mask[S.tick_utc == "2026-11-09T12:00:00.000Z"] = False
sc = (S.in_scoring == "1") & mask & (S.has_pred == "1")
rl = S.rl_event.map(lambda x: int(x) if x else -1)
i53 = np.where(sc & (rl == 53))[0]; irest = np.where(sc & rl.isin(G - {53}))[0]
rng = np.random.default_rng(20261116)
a = rng.choice(len(i53), 2, replace=False); b = rng.choice(len(irest), 6, replace=False)
picks = [int(i53[k]) for k in a] + [int(irest[k]) for k in b]
def fetch(site, stamp):
    fn = os.path.join(RAW, "%s_%s.json" % (site, stamp.strftime("%Y%m%dT%H%MZ")))
    if not os.path.exists(fn):
        if OFF: raise SystemExit("missing archive " + fn)
        q = {"sites": site, "parameterCd": "00060", "format": "json", "siteStatus": "all",
             "startDT": (stamp - timedelta(hours=4)).strftime("%Y-%m-%dT%H:%MZ"), "endDT": (stamp + timedelta(hours=5)).strftime("%Y-%m-%dT%H:%MZ")}
        u = "https://waterservices.usgs.gov/nwis/iv/?" + urllib.parse.urlencode(q)
        body = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "python-urllib/3 research-client"}), timeout=60).read()
        open(fn, "wb").write(body); time.sleep(0.5)
    d = json.loads(open(fn, "rb").read())
    vals, quals = [], set()
    for s in d["value"]["timeSeries"]:
        for v in s["values"][0]["value"]:
            t = datetime.fromisoformat(v["dateTime"]).astimezone(timezone.utc)
            if stamp <= t < stamp + timedelta(hours=1) and float(v["value"]) > -999990:
                vals.append(float(v["value"])); quals.update(v.get("qualifiers", []))
    return (median(vals) if vals else None), len(vals), "".join(sorted(quals))
rows = []
for i in picks:
    r = S.iloc[i]; tick = datetime.fromisoformat(r.tick_utc.replace("Z", "+00:00"))
    for name, site, lag, view, carry in [("PoR", "01638500", 2, r.por_view, r.por_carry_h), ("LF", "01646500", 1, r.lf_view, r.lf_carry_h)]:
        stamp = tick - timedelta(hours=lag + int(carry))
        live, n, q = fetch(site, stamp)
        val = float(view)
        rel = None if live is None else (val - live) / live
        prov = "P" in q
        verdict = "NO_DATA" if live is None else ("OK" if abs(rel) <= 0.01 else ("PROVISIONAL_DIFF" if prov else "FAIL"))
        rows.append(dict(tick=r.tick_utc, event=int(r.rl_event), gauge=name, site=site, stamp=stamp.strftime("%Y-%m-%dT%H:%MZ"),
                         carry_h=int(carry), file_value=val, live_median=live, n_readings=n, qualifiers=q, rel_diff=rel, verdict=verdict))
out = pd.DataFrame(rows); out.to_csv(os.path.join(HERE, "a8_spotcheck.csv"), index=False); print(out.to_string())

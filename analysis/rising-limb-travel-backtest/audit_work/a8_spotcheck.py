"""Auditor check 8: live USGS IV spot checks (plan s7 sampling rule, D-9).
Sampling, with ONE generator numpy.random.default_rng(20261112), in this order:
  1. two ticks from the October 2026 pool  = scored RL ticks (in_scoring=1, mask=1, D-8 tick excluded) of the October event (id 53)
  2. one tick from the early pool          = scored RL ticks of KEPT events of either class with t0 in 2012-2014 (D-9; events 7 and 9 exist)
  3. five ticks from the remaining pool    = scored RL ticks of the other kept GATE events (non-October)
  each via rng.choice(len(pool), size=k, replace=False) on the pool sorted by tick time.
For each sampled tick t, every gauge's stamp s is the stamp the lag view used (PoR, Broad Run, EF: t-2 h; LF, Monocacy, Goose, Seneca:
t-1 h; carried back up to 3 h if blank). CSV value vs median of live IV readings with timestamp in [s, s+1h) UTC.
Tolerance 1 percent for approved data; stamps after 2026-06-14 are provisional (flag only, D-3). Raw JSON saved to audit_work/usgs_raw/."""
import os, json, time, urllib.request, numpy as np, pandas as pd
D = os.path.dirname(os.path.abspath(__file__)); P = os.path.dirname(D); RAWD = os.path.join(D, "usgs_raw"); os.makedirs(RAWD, exist_ok=True)
ev = pd.read_csv(os.path.join(P,"rising_limb_events_python_v39.csv"), dtype=str, keep_default_na=False); ev = ev[(ev.event_row=="1")&(ev.kept=="1")]
t = pd.read_csv(os.path.join(P,"rising_limb_ticks.csv"), usecols=["tick_utc","arm","in_scoring","mask","rl_event"], dtype={"rl_event":"Int64"})
t = t[(t.arm=="base")&(t.in_scoring==1)&(t["mask"]==1)&t.rl_event.notna()&(t.tick_utc!="2026-11-09T12:00:00.000Z")]
gate_ids = set(int(x) for x in ev[ev.event_class=="GATE"].event_id); oct_ids = set(int(x) for x in ev[ev.oct=="1"].event_id)
early_ids = set(int(x) for x in ev[(ev.event_t0>="2012")&(ev.event_t0<"2015")].event_id)
pool_oct = t[t.rl_event.isin(oct_ids)].sort_values("tick_utc").tick_utc.tolist()
pool_early = t[t.rl_event.isin(early_ids)].sort_values("tick_utc").tick_utc.tolist()
pool_rest = t[t.rl_event.isin(gate_ids - oct_ids)].sort_values("tick_utc").tick_utc.tolist()
print("pools: oct", len(pool_oct), "early (events", sorted(early_ids), ")", len(pool_early), "rest", len(pool_rest))
rng = np.random.default_rng(20261112)
picks = [("oct", pool_oct[i]) for i in rng.choice(len(pool_oct), 2, replace=False)] + \
        [("early", pool_early[i]) for i in rng.choice(len(pool_early), 1, replace=False)] + \
        [("rest", pool_rest[i]) for i in rng.choice(len(pool_rest), 5, replace=False)]
raw = pd.read_csv(os.path.join(P,"hourly_backtest_data_v39.csv")); raw["ts"] = pd.to_datetime(raw.timestamp, utc=True); raw = raw.set_index("ts")
G = [("PoR","01638500","00060","por_now",2),("LF","01646500","00060","lf_discharge",1),("Monocacy","01643000","00060","monocacy",1),
     ("Goose","01644000","00060","goose",1),("BroadRun","01644280","00060","broad_run",2),("Seneca","01645000","00060","seneca",1),
     ("EF_stage","01644148","00065","ef_stage",2),("LF_stage","01646500","00065","lf_stage",1)]
def fetch(sites, pc, a, b):
    fn = os.path.join(RAWD, f"{pc}_{a.strftime('%Y%m%dT%H%M')}.json")
    if not os.path.exists(fn):
        url = f"https://waterservices.usgs.gov/nwis/iv/?format=json&sites={','.join(sites)}&parameterCd={pc}&startDT={a.strftime('%Y-%m-%dT%H:%MZ')}&endDT={b.strftime('%Y-%m-%dT%H:%MZ')}"
        req = urllib.request.Request(url, headers={"User-Agent": "generic-audit-client/1.0"})
        open(fn, "wb").write(urllib.request.urlopen(req, timeout=60).read()); time.sleep(1)
    js = json.load(open(fn)); out = {}
    for ts in js["value"]["timeSeries"]:
        site = ts["sourceInfo"]["siteCode"][0]["value"]; vals = []
        for blk in ts["values"]:
            for v in blk["value"]:
                vals.append((pd.Timestamp(v["dateTime"]).tz_convert("UTC"), float(v["value"]), ",".join(v.get("qualifiers", []))))
        out[site] = out.get(site, []) + vals
    return out
rows = []
for kind, tick in picks:
    T = pd.Timestamp(tick)
    a, b = T - pd.Timedelta(hours=8), T + pd.Timedelta(hours=2)   # wide request; readings are filtered by their own UTC timestamps (the service returned a window shifted from the requested Z times)
    data = {pc: fetch(sorted({g[1] for g in G if g[2]==pc}), pc, a, b) for pc in ("00060","00065")}
    for name, site, pc, col, lag in G:
        s = None
        for c in range(4):
            cand = T - pd.Timedelta(hours=lag+c)
            if cand in raw.index and pd.notna(raw.loc[cand, col]): s = cand; break
        if s is None: rows.append(dict(kind=kind, tick=tick, gauge=name, stamp="", csv="", live_median="", n_live=0, rel_diff="", status="CSV blank")); continue
        cv = float(raw.loc[s, col])
        live = [(x, v, q) for x, v, q in data[pc].get(site, []) if s <= x < s + pd.Timedelta(hours=1) and v > -999]
        prov = s >= pd.Timestamp("2026-06-14", tz="UTC")
        if not live: rows.append(dict(kind=kind, tick=tick, gauge=name, stamp=str(s), csv=cv, live_median="", n_live=0, rel_diff="", status="no live data", provisional=prov)); continue
        med = float(np.median([v for _, v, _ in live])); rd = (cv - med) / med if med else np.nan
        quals = sorted({q for _, _, q in live})
        st = ("PROVISIONAL (flag only)" if prov or any("P" in q.split(",") for q in quals) else ("OK" if abs(rd) <= 0.01 else "FAIL >1%"))
        rows.append(dict(kind=kind, tick=tick, gauge=name, stamp=str(s), csv=cv, live_median=med, n_live=len(live), rel_diff=rd, qualifiers="|".join(quals), status=st, provisional=prov))
R = pd.DataFrame(rows); R.to_csv(os.path.join(D, "a8_spotcheck.csv"), index=False)
pd.set_option("display.width", 220); pd.set_option("display.max_rows", 200); print(R.to_string())

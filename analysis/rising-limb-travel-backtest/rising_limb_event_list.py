#!/usr/bin/env python3
"""
Frozen event list for the rising-limb travel backtest (plan A7, section 3 + section 2 lag view + section 4 truth rule).
Written from the plan text (analysis/rising-limb-travel-backtest-plan-2026-11-10.md). Gauge records only: the
model (makeGFPrediction) and every arm are NOT used here; no prediction error of any kind is computed.
X3 needs the arm-independent reference travel time tau_ref, which uses only the three travel helpers
(getFlowMultiplier, getGFtoLFTravelTime, getPoRRiseRateFromHistory/getFlowState) re-implemented below.

Usage:  python3 rising_limb_event_list.py <data.csv> <tag> [--sens-fill2] [--sens-search-time]
Outputs (tag e.g. v39): rising_limb_events_python_<tag>.csv, rising_limb_event_summary_<tag>.md/.json
Python standard library only. Deterministic.

Interpretations the plan leaves implicit (all logged in STEP_1_2_LOG.md):
  I1 "gap of 3 h or less" = a run of at most 3 consecutive missing hourly stamps (same unit as X2's "6 consecutive").
  I2 a stamp is missing if the CSV has no row for it or the cell is blank.
  I3 each stamp satisfying the onset test is an onset; the E_end search takes the first stamp after t0 with filled LF <= 6000.
  I4 X1 and X2 treat a stamp with no CSV row as blank/missing.
  I5 "search later ticks up to 2.5 h after it" counts from the tick found (offsets 0,1,2 h), not from the fractional time.
  I6 PoR history window is s' in [t-72h, t-2h] inclusive.
  I7 "contains 2026-10-14T12:00Z" means t0 <= stamp <= tend of the (merged) event.
"""
import csv
import hashlib
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- constants frozen by the plan ----
ONSET_LEVEL = 6000.0
PRIOR_MAX = 4500.0
GATE_PEAK = 12000.0
STRATUM_PEAK = 8000.0
FILL_MAX = 3
E_END_DAYS = 30
TP_CAP_H = 240
TEND_CAP_H = 240
MERGE_H = 48
RL_LEAD = 12
RL_TAIL = 24
EW_TAIL = 24
FLOOR = 15
OCT_STAMP = datetime(2026, 10, 14, 12)
BURN_IN = datetime(2012, 12, 1, 0)
# travel helpers (netlify/functions/shared/model.js constants)
TRAVEL_COEF, TRAVEL_EXP, MEDIAN_TRAVEL, GF_LF_BASE = 4139.0, -0.5963, 25.8, 6.5

FIELDS = ["timestamp", "por_now", "por_lagged", "ef_stage", "lf_discharge", "lf_stage", "water_temp_c",
          "monocacy", "goose", "broad_run", "seneca", "travel_time_h"]


def fmt(dt):
    return dt.strftime("%Y-%m-%d %H:%M") if dt else ""


class Data:
    def __init__(self, path):
        rows = {}
        with open(path, newline="") as f:
            for r in csv.DictReader(f):
                rows[r["timestamp"]] = r
        keys = sorted(rows)
        self.t_first = datetime.strptime(keys[0], "%Y-%m-%d %H:%M")
        self.t_last = datetime.strptime(keys[-1], "%Y-%m-%d %H:%M")
        n = int((self.t_last - self.t_first).total_seconds() // 3600) + 1
        self.n = n

        def col(name):
            a = [None] * n
            for k, r in rows.items():
                v = r[name]
                if v != "":
                    i = int((datetime.strptime(k, "%Y-%m-%d %H:%M") - self.t_first).total_seconds() // 3600)
                    a[i] = float(v)
            return a
        self.lf = col("lf_discharge")
        self.por = col("por_now")
        self.temp = col("water_temp_c")
        self.nrows = len(rows)
        # filled detector series (I1)
        self.lff = self.fill(self.lf, FILL_MAX)

    @staticmethod
    def fill(a, maxgap):
        out = list(a)
        n = len(a)
        i = 0
        while i < n:
            if a[i] is None:
                j = i
                while j < n and a[j] is None:
                    j += 1
                if i > 0 and j < n and (j - i) <= maxgap:
                    for k in range(i, j):
                        out[k] = a[i - 1] + (a[j] - a[i - 1]) * (k - (i - 1)) / (j - (i - 1))
                i = j
            else:
                i += 1
        return out

    def idx(self, dt):
        return int((dt - self.t_first).total_seconds() // 3600)

    def dt(self, i):
        return self.t_first + timedelta(hours=i)


# ---------- lag view (plan section 2) ----------
def view(a, i, lag, carry=3):
    """stamp s = i - lag; blank -> carry the latest non-blank within 3 h; else None (missing)."""
    for c in range(0, carry + 1):
        j = i - lag - c
        if 0 <= j < len(a) and a[j] is not None:
            return a[j]
    return None


def flow_mult(q):
    return TRAVEL_COEF * (max(q, 1000.0) ** TRAVEL_EXP) / MEDIAN_TRAVEL


def get_flow_state(hist, cur):
    """shared/model.js getFlowState with Date.now = t. hist = [(ts_hours_rel_to_t, cfs)], ascending."""
    if len(hist) < 8:
        return "steady"
    past = None
    for ts, c in hist:
        if ts <= -6.0:
            past = (ts, c)
    if past is None:
        return "steady"
    change = cur - past[1]
    thr = max(100.0, cur * 0.02)
    if abs(change) >= thr:
        return "rising" if change > 0 else "falling"
    return "steady"


def rise_rate(d, i):
    """getPoRRiseRateFromHistory on the lag-view history at tick i (I6)."""
    hist = []
    for j in range(i - 72, i - 2 + 1):          # s' in [t-72h, t-2h]
        if 0 <= j < d.n and d.por[j] is not None:
            hist.append(((j - i) + 0.5, d.por[j]))   # timestamp s'+30min, relative to t in hours
    if len(hist) < 4:
        return None
    cur = hist[-1]
    past = None
    for ts, c in hist:
        if ts <= -6.0:
            past = (ts, c)
    if past is None:
        return None
    hd = cur[0] - past[0]
    if hd <= 0:
        return None
    rate = ((cur[1] - past[1]) / past[1]) * 100.0 / hd
    return {"rate": rate, "state": get_flow_state(hist, cur[1])}


def gf_lf_travel(mult, rr):
    base = GF_LF_BASE * mult
    if rr and rr["state"] == "rising" and rr["rate"] > 0:
        return base * (1 - min(0.30, rr["rate"] * 0.02))
    return base


def lf_view_at_time(d, i, h, sens_time=False):
    """LF view read at the first tick at or after fractional time (tick index i + h hours); retry later
    ticks over offsets 0,1,2 h (I5) if missing. Returns (value, tick_index) or (None, None)."""
    u0 = i + math.ceil(h - 1e-12)
    for off in (0, 1, 2):
        if sens_time:
            if (u0 + off) - (i + h) > 2.5 + 1e-9:
                break
        u = u0 + off
        v = view(d.lf, u, 1)
        if v is not None and u - 1 < d.n:
            return v, u
    return None, None


def tau_ref(d, i, sens_time=False):
    """Returns (tau_ref, converged_flag, status). status 'ok' or 'lf_missing'."""
    rr = rise_rate(d, i)
    tau = 6.5
    conv = False
    for k in range(3):
        v, _ = lf_view_at_time(d, i, tau, sens_time)
        if v is None:
            return None, False, "lf_missing"
        new = gf_lf_travel(flow_mult(v), rr)
        if abs(new - tau) < 0.5:
            tau, conv = new, True
            break
        tau = new
    return tau, conv, "ok"


def scored_tick(d, i, sens_time=False):
    """Common-mask test at tick i: PoR (lag 2) and LF (lag 1) views present and truth exists."""
    if view(d.por, i, 2) is None or view(d.lf, i, 1) is None:
        return False, "no_input", False
    tau, conv, st = tau_ref(d, i, sens_time)
    if tau is None:
        return False, "tau_lf_missing", False
    truth, _ = lf_view_at_time(d, i, tau, sens_time)
    if truth is None:
        return False, "no_truth", not conv
    return True, "ok", not conv


# ---------- events ----------
def detect(d, sens_fill=None):
    lff = d.lff
    on = []
    for i in range(1, d.n):
        if lff[i] is None or lff[i] < ONSET_LEVEL:
            continue
        if lff[i - 1] is None or lff[i - 1] >= ONSET_LEVEL:
            continue
        pw = [lff[j] for j in range(max(0, i - 48), i) if lff[j] is not None]
        if not pw or min(pw) > PRIOR_MAX:
            continue
        on.append(i)
    out = []
    for i in on:
        lim = min(i + E_END_DAYS * 24, d.n - 1)
        e_end, e_end_found = None, False
        for j in range(i + 1, lim + 1):
            if lff[j] is not None and lff[j] <= ONSET_LEVEL:
                e_end, e_end_found = j, True
                break
        if not e_end_found:
            e_end = i + E_END_DAYS * 24
        hi = min(e_end, i + TP_CAP_H)           # [t0, hi)
        tp, best = None, None
        for j in range(i, min(hi, d.n)):
            if lff[j] is not None and (best is None or lff[j] > best):
                best, tp = lff[j], j
        tend = min(e_end, tp + TEND_CAP_H)
        cls = "GATE" if best >= GATE_PEAK else ("STRATUM" if best >= STRATUM_PEAK else "BELOW")
        out.append({"t0": i, "e_end": e_end, "tp": tp, "tend": tend, "peak": best, "cls": cls})
    return out


def build_events(d, onsets):
    qual = [o for o in onsets if o["cls"] != "BELOW"]
    events = []
    for o in qual:
        if events and 0 <= o["t0"] - events[-1]["tend"] <= MERGE_H:
            ev = events[-1]
            ev["comps"].append(o)
            ev["tend"] = o["tend"]
            hi = min(ev["tend"], d.n - 1)
            best, tp = None, None
            for j in range(ev["t0"], hi + 1):
                if d.lff[j] is not None and (best is None or d.lff[j] > best):
                    best, tp = d.lff[j], j
            ev["tp"], ev["peak"] = tp, best
            ev["cls"] = "GATE" if best >= GATE_PEAK else "STRATUM"
            if any(c["cls"] == "GATE" for c in ev["comps"]):
                ev["cls"] = "GATE"          # higher class
        else:
            events.append({"t0": o["t0"], "tp": o["tp"], "tend": o["tend"], "peak": o["peak"],
                           "cls": o["cls"], "comps": [o]})
    return events


def longest_run(flags):
    best = cur = 0
    for f in flags:
        cur = cur + 1 if f else 0
        best = max(best, cur)
    return best


def exclusions(d, ev, sens_time=False):
    t0, tp, tend = ev["t0"], ev["tp"], ev["tend"]
    r = {}
    rl_start = t0 - RL_LEAD
    r["x0"] = int(d.t_first + timedelta(hours=rl_start) < BURN_IN)
    # X1 (I4): stamps in [t0-24h, tend]; months 12,1,2,3 UTC with PoR temperature <= 5 C or blank
    n = risk = 0
    for j in range(t0 - 24, tend + 1):
        n += 1
        dt = d.dt(j)
        if dt.month in (12, 1, 2, 3):
            tv = d.temp[j] if 0 <= j < d.n else None
            if tv is None or tv <= 5.0:
                risk += 1
    r["x1_n"], r["x1_risk"], r["x1_share"], r["x1"] = n, risk, risk / n if n else 0.0, int(risk > 0)
    # X2 on raw readings, per gauge (I4)
    n2 = tend - rl_start + 1
    for name, arr in (("por", d.por), ("lf", d.lf)):
        miss = [(0 <= j < d.n and arr[j] is None) or not (0 <= j < d.n) for j in range(rl_start, tend + 1)]
        r[f"x2_{name}_miss"] = sum(miss)
        r[f"x2_{name}_share"] = sum(miss) / n2
        r[f"x2_{name}_maxrun"] = longest_run(miss)
    r["x2_n"] = n2
    r["x2"] = int(r["x2_por_maxrun"] >= 6 or r["x2_lf_maxrun"] >= 6 or r["x2_por_share"] > 0.10 or r["x2_lf_share"] > 0.10)
    # X3
    rl_end = min(t0 + RL_TAIL, tp)
    nrl = rl_end - rl_start + 1
    scored = nonconv = 0
    why = {}
    for j in range(rl_start, rl_end + 1):
        if j < 0 or j >= d.n:
            why["out_of_range"] = why.get("out_of_range", 0) + 1
            continue
        ok, reason, nc = scored_tick(d, j, sens_time)
        if ok:
            scored += 1
            nonconv += int(nc)
        else:
            why[reason] = why.get(reason, 0) + 1
    r["x3_rl_ticks"], r["x3_scored"], r["x3_nonconv_flagged"] = nrl, scored, nonconv
    r["x3_fail_reasons"] = ";".join(f"{k}={v}" for k, v in sorted(why.items()))
    r["x3"] = int(scored < 6)
    # X4
    r["x4"] = int(tend > d.n - 1)
    return r


def rec_window(d, ev):
    """REC stamps (M1), from LF only."""
    t0, tp, tend = ev["t0"], ev["tp"], ev["tend"]
    if tp == t0 + 239:
        return []
    peak = d.lff[tp]
    rcut = None
    for j in range(tp + 1, min(tend, d.n - 1) + 1):
        if d.lff[j] is not None and d.lff[j] > peak:
            rcut = j
            break
    end = (rcut - 1) if rcut is not None else tend
    stamps = set(range(tp + 1, min(end, tend) + 1))
    for c in ev["comps"][1:]:
        for j in range(c["t0"] - RL_LEAD, c["tp"] + 1):
            stamps.discard(j)
    return sorted(stamps)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    data_path, tag = args[0], args[1]
    sens_fill2 = "--sens-fill2" in sys.argv
    sens_time = "--sens-search-time" in sys.argv
    sfx = ("_sensfill2" if sens_fill2 else "") + ("_senstime" if sens_time else "")
    global FILL_MAX
    if sens_fill2:
        FILL_MAX = 2
    d = Data(data_path)
    onsets = detect(d)
    events = build_events(d, onsets)
    for k, ev in enumerate(events, 1):
        ev["id"] = k
        ev["x"] = exclusions(d, ev, sens_time)
        x = ev["x"]
        ev["excl"] = [n for n in ("x0", "x1", "x2", "x3", "x4") if x[n]]
        ev["kept"] = int(not ev["excl"])
        ev["oct"] = int(ev["cls"] == "GATE" and ev["kept"] == 1 and
                        ev["t0"] <= d.idx(OCT_STAMP) <= ev["tend"] and d.t_first <= OCT_STAMP <= d.t_last)
        ev["rec"] = rec_window(d, ev)
    kept_gate_nonoct = [e for e in events if e["cls"] == "GATE" and e["kept"] and not e["oct"]]
    nh = -(-len(kept_gate_nonoct) // 5)
    hold_ids = {e["id"] for e in kept_gate_nonoct[len(kept_gate_nonoct) - nh:]} if nh else set()

    # ---- write event file: one row per onset ----
    out_csv = os.path.join(HERE, f"rising_limb_events_python_{tag}{sfx}.csv")
    cols = ["onset_no", "onset_t0", "onset_e_end", "onset_tp", "onset_tend", "onset_peak_lf", "onset_class",
            "event_id", "event_row", "merged_n_components", "event_t0", "event_tp", "event_tend", "event_peak_lf",
            "event_class", "rl_start", "rl_end", "rlx_end", "ew_start", "ew_end", "rec_start", "rec_end", "rec_n_stamps",
            "x0_burnin", "x0_rl_start",
            "x1_ice_risk", "x1_risk_stamps", "x1_stamps", "x1_share",
            "x2_outage", "x2_por_missing", "x2_por_share", "x2_por_maxrun", "x2_lf_missing", "x2_lf_share", "x2_lf_maxrun", "x2_stamps",
            "x3_few_ticks", "x3_rl_ticks", "x3_scored_rl_ticks", "x3_nonconverged_tau_ticks", "x3_unscored_reasons",
            "x4_tend_beyond_data", "exclusion_reasons", "kept", "oct", "holdout"]
    ev_of = {}
    for ev in events:
        for c in ev["comps"]:
            ev_of[c["t0"]] = ev
    with open(out_csv, "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(cols)
        for n, o in enumerate(onsets, 1):
            ev = ev_of.get(o["t0"])
            base = [n, fmt(d.dt(o["t0"])), fmt(d.dt(o["e_end"])) if o["e_end"] < d.n else f"{fmt(d.dt(0) + timedelta(hours=o['e_end']))}(beyond data)",
                    fmt(d.dt(o["tp"])), fmt(d.dt(o["tend"])) if o["tend"] < d.n else "beyond_data", o["peak"], o["cls"]]
            if ev is None:
                w.writerow(base + [""] * (len(cols) - len(base)))
                continue
            x = ev["x"]
            first = ev["comps"][0]["t0"] == o["t0"]
            rec = ev["rec"]
            tend_s = fmt(d.t_first + timedelta(hours=ev["tend"]))
            w.writerow(base + [
                ev["id"], int(first), len(ev["comps"]),
                fmt(d.t_first + timedelta(hours=ev["t0"])), fmt(d.t_first + timedelta(hours=ev["tp"])), tend_s, ev["peak"], ev["cls"],
                fmt(d.dt(ev["t0"] - RL_LEAD)), fmt(d.dt(min(ev["t0"] + RL_TAIL, ev["tp"]))), fmt(d.dt(ev["tp"])),
                fmt(d.dt(ev["t0"] - RL_LEAD)), fmt(d.t_first + timedelta(hours=ev["tend"] + EW_TAIL)),
                fmt(d.dt(rec[0])) if rec else "", fmt(d.dt(rec[-1])) if rec else "", len(rec),
                x["x0"], fmt(d.dt(ev["t0"] - RL_LEAD)),
                x["x1"], x["x1_risk"], x["x1_n"], f"{x['x1_share']:.4f}",
                x["x2"], x["x2_por_miss"], f"{x['x2_por_share']:.4f}", x["x2_por_maxrun"],
                x["x2_lf_miss"], f"{x['x2_lf_share']:.4f}", x["x2_lf_maxrun"], x["x2_n"],
                x["x3"], x["x3_rl_ticks"], x["x3_scored"], x["x3_nonconv_flagged"], x["x3_fail_reasons"],
                x["x4"], "+".join(ev["excl"]), ev["kept"], ev["oct"], int(ev["id"] in hold_ids)])
    out_sha = hashlib.sha256(open(out_csv, "rb").read()).hexdigest()

    # ---- summary ----
    def cnt(pred, evs=events):
        return sum(1 for e in evs if pred(e))
    summ = {"data_file": os.path.basename(data_path), "data_rows": d.nrows, "data_first": fmt(d.t_first), "data_last": fmt(d.t_last),
            "onsets": len(onsets),
            "onset_class": {c: sum(1 for o in onsets if o["cls"] == c) for c in ("GATE", "STRATUM", "BELOW")},
            "merges": sum(len(e["comps"]) - 1 for e in events),
            "events_after_merge": len(events),
            "events_class": {c: cnt(lambda e: e["cls"] == c) for c in ("GATE", "STRATUM")}}
    for c in ("GATE", "STRATUM"):
        evs = [e for e in events if e["cls"] == c]
        summ[c] = {"events": len(evs),
                   "X0": cnt(lambda e: e["x"]["x0"], evs), "X1": cnt(lambda e: e["x"]["x1"], evs),
                   "X2": cnt(lambda e: e["x"]["x2"], evs), "X3": cnt(lambda e: e["x"]["x3"], evs),
                   "X4": cnt(lambda e: e["x"]["x4"], evs),
                   "sequential_after_X0": cnt(lambda e: not e["x"]["x0"], evs),
                   "sequential_after_X1": cnt(lambda e: not (e["x"]["x0"] or e["x"]["x1"]), evs),
                   "sequential_after_X2": cnt(lambda e: not (e["x"]["x0"] or e["x"]["x1"] or e["x"]["x2"]), evs),
                   "sequential_after_X3": cnt(lambda e: not (e["x"]["x0"] or e["x"]["x1"] or e["x"]["x2"] or e["x"]["x3"]), evs),
                   "kept": cnt(lambda e: e["kept"], evs)}
    oct_ev = [e for e in events if e["t0"] <= d.idx(OCT_STAMP) <= e["tend"]] if d.t_first <= OCT_STAMP <= d.t_last else []
    summ["october"] = [{"event_id": e["id"], "class": e["cls"], "t0": fmt(d.dt(e["t0"])), "tp": fmt(d.dt(e["tp"])),
                        "tend": fmt(d.t_first + timedelta(hours=e["tend"])), "peak": e["peak"], "excluded_by": e["excl"],
                        "kept": e["kept"], "oct_flag": e["oct"]} for e in oct_ev]
    n_gate_kept = summ["GATE"]["kept"]
    n_nonoct = len(kept_gate_nonoct)
    summ.update({"gate_kept_total": n_gate_kept, "gate_kept_nonoct": n_nonoct, "floor": FLOOR,
                 "holdout_n": nh, "holdout_event_ids": sorted(hold_ids),
                 "verdict": "PROCEED" if n_nonoct >= FLOOR else "FAIL-INSUFFICIENT",
                 "events_file": os.path.basename(out_csv), "events_file_sha256": out_sha,
                 "sensitivity": {"fill_max": FILL_MAX, "search_from_time": sens_time}})
    json.dump(summ, open(os.path.join(HERE, f"rising_limb_event_summary_{tag}{sfx}.json"), "w"), indent=1)
    with open(os.path.join(HERE, f"rising_limb_event_summary_{tag}{sfx}.md"), "w") as f:
        W = f.write
        W(f"# Event-list summary ({tag}{sfx})\n\nData: {summ['data_file']} ({d.nrows} rows, {summ['data_first']} .. {summ['data_last']})\n")
        W(f"Events file: {summ['events_file']}  sha256 {out_sha}\n\n")
        W(f"- Onsets: {summ['onsets']} (GATE {summ['onset_class']['GATE']}, STRATUM {summ['onset_class']['STRATUM']}, below 8,000 {summ['onset_class']['BELOW']})\n")
        W(f"- Merges: {summ['merges']}; events after merge: {summ['events_after_merge']} (GATE {summ['events_class']['GATE']}, STRATUM {summ['events_class']['STRATUM']})\n")
        for c in ("GATE", "STRATUM"):
            s = summ[c]
            W(f"- {c}: {s['events']} events; flagged X0 {s['X0']}, X1 {s['X1']}, X2 {s['X2']}, X3 {s['X3']}, X4 {s['X4']} (overlapping); "
              f"sequential remaining after X0/X1/X2/X3: {s['sequential_after_X0']}/{s['sequential_after_X1']}/{s['sequential_after_X2']}/{s['sequential_after_X3']}; KEPT {s['kept']}\n")
        W(f"- October 2026 event(s) containing 2026-10-14T12:00Z: {json.dumps(summ['october'])}\n")
        W(f"- GATE kept: {n_gate_kept}; GATE kept non-October: {n_nonoct}; floor {FLOOR}; holdout size {nh}\n")
        W(f"- VERDICT: {summ['verdict']}\n")
    print(json.dumps({k: summ[k] for k in ("onsets", "onset_class", "merges", "events_class", "GATE", "STRATUM", "october",
                                            "gate_kept_nonoct", "verdict", "events_file_sha256")}, indent=1))


if __name__ == "__main__":
    main()

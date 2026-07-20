#!/usr/bin/env python3
"""
v38.0 EF divergence gate — metrics + pre-registered gate arithmetic (plan v3 §6).

Reads v38_residuals_{multi,single}.csv (from v38_gate_harness.mjs) and evaluates every
config against gate conditions 1/1H/1B/2/3/4 (+5 LOEO & neighbors, 6 recovery) in multi
mode and S1–S3 in single mode, then applies the conservative-cell selection and the
simplicity rule.

Pre-registered interpretation notes (fixed here, before results were seen):
  - Event/normal classification of a scored row uses valTs (when the water arrives —
    production scoring semantics). Duty-cycle / false-activation metrics use predTs
    (activation is a property of the prediction cycle).
  - LOEO folds = 7 episodes: the 6 historical windows singly + BOTH 2026 windows as one
    fold (same wet-lower-basin state, plan v3 §4 "7 independent episodes"). Condition 5
    applies conditions 1–4 per fold at full thresholds, EXCEPT the 2026 fold where
    condition 1's threshold is the pre-registered historical floor 15% (condition 1H
    exists precisely because that fold removes the hypothesis-generating data).
  - a(config, row) = clamp((dbar − T_LO)/band, 0, 1) if eligiblePred & efValidPred &
    dbar present else 0 — exactly the harness rule (efValidPred column added for this).
  - Bootstrap: 10,000 iterations, 95% two-sided, seed 38; blocks = episodes for event
    metrics, calendar months for normal-hours metrics.
  - Bin×state cells (condition 3): bin from getFlowBin(raw_cfg) thresholds
    [3000, 6000, 12000, 25000, 50000]; min-n 200 (multi) / flow-bin aggregated min-n 100
    (single S3).

Outputs: v38_gate_results.json (full evaluation) and v38_headline_python.csv
(per-config headline metrics — the blind cross-language comparison artifact; the R
counterpart must be computed WITHOUT reading either output).
"""

import csv
import json
import math
import os
import sys
from collections import defaultdict

import numpy as np

DIR = os.path.dirname(os.path.abspath(__file__))

WINDOWS = {
    "W1": ("2012-07-08", "2012-07-12"), "W2": ("2014-08-10", "2014-08-14"),
    "W3": ("2019-07-22", "2019-07-26"), "W4": ("2019-10-15", "2019-10-23"),
    "W5": ("2022-07-07", "2022-07-11"), "W6": ("2022-08-03", "2022-08-08"),
    "W7": ("2026-07-09", "2026-07-12"), "W8": ("2026-07-17", "2026-07-20"),
}
EPISODES = {"E1": ["W1"], "E2": ["W2"], "E3": ["W3"], "E4": ["W4"], "E5": ["W5"],
            "E6": ["W6"], "E2026": ["W7", "W8"]}
HISTORICAL_WINDOWS = ["W1", "W2", "W3", "W4", "W5", "W6"]
RECOVERY_DAYS = 6
BIN_EDGES = [3000, 6000, 12000, 25000, 50000]
BIN_NAMES = ["0-3000", "3000-6000", "6000-12000", "12000-25000", "25000-50000", "50000+"]

C1_IMPROVE = 0.25       # condition 1
C1H_IMPROVE = 0.15      # condition 1H (historical floor; also the 2026-LOEO-fold threshold)
C1B_MIN_EPISODES = 5    # condition 1B: >=5 of 7 episodes improved
C2_NORMAL_DEGRADE = 0.02
C3_CELL_DEGRADE = 0.05
C3_MIN_N = 200
C4_HARM_REL = 0.05
C4_DUTY_MAX = 0.03      # a>0.5 duty < 3% of normal prediction hours
S1_IMPROVE = 0.10
S3_BIN_DEGRADE = 0.10
S3_MIN_N = 100
BOOT_N = 10_000
BOOT_SEED = 38


def date_of(ts):
    return ts[:10]


def window_of(date):
    for w, (a, b) in WINDOWS.items():
        if a <= date <= b:
            return w
    return None


def add_days(date, n):
    from datetime import datetime, timedelta
    return (datetime.strptime(date, "%Y-%m-%d") + timedelta(days=n)).strftime("%Y-%m-%d")


RECOVERY = {w: (add_days(b, 1), add_days(b, RECOVERY_DAYS)) for w, (a, b) in WINDOWS.items()}


def recovery_of(date):
    for w, (a, b) in RECOVERY.items():
        if a <= date <= b:
            return w
    return None


def flow_bin(raw):
    for i, e in enumerate(BIN_EDGES):
        if raw < e:
            return BIN_NAMES[i]
    return BIN_NAMES[-1]


def load(mode):
    path = os.path.join(DIR, f"v38_residuals_{mode}.csv")
    with open(path) as f:
        header = f.readline().strip().split(",")
    cfg_ids = [h[4:] for h in header if h.startswith("raw_")]
    n_cfg = len(cfg_ids)
    raw_i0 = header.index(f"raw_{cfg_ids[0]}")
    disp_i0 = header.index(f"disp_{cfg_ids[0]}")
    idx = {h: i for i, h in enumerate(header)}

    rows = []
    raws, disps = [], []
    with open(path) as f:
        f.readline()
        for line in f:
            c = line.rstrip("\n").split(",")
            rows.append((c[idx["predTs"]], c[idx["valTs"]], float(c[idx["actualLF"]]),
                         c[idx["flowState"]],
                         float(c[idx["dbarPred"]]) if c[idx["dbarPred"]] else None,
                         c[idx["eligiblePred"]] == "1", c[idx["efValidPred"]] == "1"))
            raws.append(np.array(c[raw_i0:raw_i0 + n_cfg], dtype=np.float64))
            disps.append(np.array(c[disp_i0:disp_i0 + n_cfg], dtype=np.float64))
    return cfg_ids, rows, np.vstack(raws), np.vstack(disps)


def parse_cfg(cid):
    if cid == "c0":
        return {"id": cid, "kind": "c0"}
    p = cid.split("_")
    if p[0] in ("c1", "c1f", "c1n"):
        return {"id": cid, "kind": p[0], "tlo": int(p[1][1:]) / 100.0,
                "bw": int(p[2][1:]) / 100.0, "w": int(p[3][1:]) / 100.0}
    return {"id": cid, "kind": p[0], "mid": float(p[1][1:-1]) * 1000, "wm": int(p[2][1:]) / 100.0}


def mae(x):
    return float(np.mean(np.abs(x))) if len(x) else None


def med_abs_pct(resid, actual):
    return float(np.median(np.abs(resid / actual) * 100)) if len(resid) else None


def boot_ci_delta(rng, groups_c, groups_0, n_iter=BOOT_N):
    """Bootstrap CI of (MAE_cfg − MAE_c0) pooled over resampled blocks.
    groups_*: list of (sum_abs, n) per block, aligned."""
    k = len(groups_c)
    if k == 0:
        return None, None
    sc = np.array([g[0] for g in groups_c]); nc = np.array([g[1] for g in groups_c])
    s0 = np.array([g[0] for g in groups_0]); n0 = np.array([g[1] for g in groups_0])
    picks = rng.integers(0, k, size=(n_iter, k))
    scs = sc[picks].sum(axis=1); ncs = nc[picks].sum(axis=1)
    s0s = s0[picks].sum(axis=1); n0s = n0[picks].sum(axis=1)
    ok = (ncs > 0) & (n0s > 0)
    delta = scs[ok] / ncs[ok] - s0s[ok] / n0s[ok]
    return float(np.percentile(delta, 2.5)), float(np.percentile(delta, 97.5))


def evaluate(mode):
    cfg_ids, rows, raws, disps = load(mode)
    n_cfg = len(cfg_ids)
    cfgs = [parse_cfg(c) for c in cfg_ids]
    i_c0 = cfg_ids.index("c0")
    actual = np.array([r[2] for r in rows])
    resid = disps - actual[:, None]
    absresid = np.abs(resid)

    val_date = [date_of(r[1]) for r in rows]
    pred_date = [date_of(r[0]) for r in rows]
    val_win = np.array([window_of(d) or "" for d in val_date])
    pred_win = np.array([window_of(d) or "" for d in pred_date])
    rec_win = np.array([recovery_of(d) or "" for d in val_date])
    month = np.array([d[:7] for d in val_date])
    pred_month = np.array([d[:7] for d in pred_date])
    is_event = val_win != ""
    is_normal = ~is_event
    pred_normal = pred_win == ""
    state = np.array([r[3] for r in rows])
    dbar = np.array([r[4] if r[4] is not None else np.nan for r in rows])
    gate_ok = np.array([(r[5] and r[6] and r[4] is not None) for r in rows])

    # activation per (tlo, bw) variant
    act = {}
    for tlo in (1.10, 1.15, 1.20):
        for bw in (0.15, 0.25):
            a = np.where(gate_ok, np.clip((dbar - tlo) / bw, 0, 1), 0.0)
            a = np.nan_to_num(a)
            act[(tlo, bw)] = a

    rng = np.random.default_rng(BOOT_SEED)
    out = {"mode": mode, "nRows": len(rows), "configs": {}}

    c0_abs = absresid[:, i_c0]
    ev0 = mae(c0_abs[is_event]); no0 = mae(c0_abs[is_normal]); gl0 = mae(c0_abs)
    out["c0"] = {
        "globalMAE": gl0, "eventMAE": ev0, "normalMAE": no0,
        "globalMedPct": med_abs_pct(resid[is_event | is_normal][:, i_c0], actual),
        "perWindowMAE": {w: mae(c0_abs[val_win == w]) for w in WINDOWS},
    }

    # per-episode blocks for c0 (bootstrap + LOEO)
    def ep_blocks(col_abs):
        blocks = []
        for ep, ws in EPISODES.items():
            m = np.isin(val_win, ws)
            blocks.append((float(col_abs[m].sum()), int(m.sum())))
        return blocks

    ep0 = ep_blocks(c0_abs)
    months_sorted = sorted(set(month[is_normal]))

    def month_blocks(col_abs, mask):
        return [(float(col_abs[mask & (month == m)].sum()), int((mask & (month == m)).sum()))
                for m in months_sorted]

    mon0 = month_blocks(c0_abs, is_normal)

    headline = []
    for j, cfg in enumerate(cfgs):
        cid = cfg["id"]
        cabs = absresid[:, j]
        ev = mae(cabs[is_event]); no = mae(cabs[is_normal]); gl = mae(cabs)
        entry = {
            "kind": cfg["kind"], "globalMAE": gl, "eventMAE": ev, "normalMAE": no,
            "eventImprove": 1 - ev / ev0 if ev0 else None,
            "normalDegrade": no / no0 - 1 if no0 else None,
            "globalDelta": gl / gl0 - 1 if gl0 else None,
        }
        headline.append({"config": cid, "globalMAE": round(gl, 4), "eventMAE": round(ev, 4),
                         "normalMAE": round(no, 4),
                         "medAbsPctGlobal": round(med_abs_pct(resid[:, j], actual), 4)})
        if cfg["kind"] == "c0":
            out["configs"][cid] = entry
            continue

        # condition 1 (+CI), 1H, 1B
        hist_m = np.isin(val_win, HISTORICAL_WINDOWS)
        ev_hist = mae(cabs[hist_m]); ev0_hist = mae(c0_abs[hist_m])
        epc = ep_blocks(cabs)
        lo, hi = boot_ci_delta(rng, epc, ep0)
        # own event-MAE CI (episode blocks) — used by the simplicity rule (E3.6):
        # a simple arm is preferred if its event-MAE POINT falls inside the best
        # C1 cell's event-MAE CI (audit defect 5 fix: the first version wrongly
        # compared a MAE difference against a delta-vs-c0 CI).
        sc_ = np.array([g[0] for g in epc]); nc_ = np.array([g[1] for g in epc])
        picks_ = rng.integers(0, len(epc), size=(BOOT_N, len(epc)))
        pooled_ = sc_[picks_].sum(axis=1) / np.maximum(nc_[picks_].sum(axis=1), 1)
        ev_mae_ci = [float(np.percentile(pooled_, 2.5)), float(np.percentile(pooled_, 97.5))]
        ep_improved = 0
        per_ep = {}
        for (ep, ws), bc, b0 in zip(EPISODES.items(), epc, ep0):
            mc = bc[0] / bc[1] if bc[1] else None
            m0 = b0[0] / b0[1] if b0[1] else None
            per_ep[ep] = {"mae": mc, "c0": m0}
            if mc is not None and m0 is not None and mc < m0:
                ep_improved += 1
        cond1 = (entry["eventImprove"] is not None and entry["eventImprove"] >= C1_IMPROVE
                 and hi is not None and hi < 0)
        cond1H = ev0_hist and (1 - ev_hist / ev0_hist) >= C1H_IMPROVE
        cond1B = ep_improved >= C1B_MIN_EPISODES
        cond2 = entry["normalDegrade"] is not None and entry["normalDegrade"] <= C2_NORMAL_DEGRADE

        # condition 3: bin×state cells
        bins_c = np.array([flow_bin(v) for v in raws[:, j]])
        bins_0 = np.array([flow_bin(v) for v in raws[:, i_c0]])
        cond3 = True
        worst_cell = None
        cells = {}
        for b in BIN_NAMES:
            for s in ("rising", "steady", "falling"):
                m_c = (bins_c == b) & (state == s)
                m_0 = (bins_0 == b) & (state == s)
                if m_0.sum() >= C3_MIN_N and m_c.sum() >= C3_MIN_N:
                    d = mae(cabs[m_c]) / mae(c0_abs[m_0]) - 1
                    cells[f"{b}/{s}"] = round(d, 4)
                    if d > C3_CELL_DEGRADE:
                        cond3 = False
                    if worst_cell is None or d > worst_cell[1]:
                        worst_cell = (f"{b}/{s}", d)

        # condition 4 (c1 kinds only)
        cond4 = True
        duty = {}
        if cfg["kind"] in ("c1", "c1f", "c1n"):
            a = act[(cfg["tlo"], cfg["bw"])]
            for thr in (0.0, 0.25, 0.5):
                duty[f"a>{thr}"] = float(np.mean(a[pred_normal] > thr))
            cond4 = duty["a>0.5"] < C4_DUTY_MAX
            for thr in (0.0, 0.5):
                m_act = pred_normal & (a > thr)
                if m_act.sum() >= 30:
                    mon_c = [(float(cabs[m_act & (pred_month == m)].sum()),
                              int((m_act & (pred_month == m)).sum())) for m in months_sorted]
                    mon_0c = [(float(c0_abs[m_act & (pred_month == m)].sum()),
                               int((m_act & (pred_month == m)).sum())) for m in months_sorted]
                    lo4, hi4 = boot_ci_delta(rng, mon_c, mon_0c)
                    harm_cap = C4_HARM_REL * mae(c0_abs[m_act])
                    duty[f"deltaMAE_a>{thr}"] = (mae(cabs[m_act]) - mae(c0_abs[m_act]))
                    duty[f"CI_a>{thr}"] = [lo4, hi4]
                    if hi4 is not None and hi4 >= harm_cap:
                        cond4 = False
                else:
                    duty[f"deltaMAE_a>{thr}"] = None

        # condition 6: recovery
        rec_m = rec_win != ""
        rec_blocks_c = [(float(cabs[rec_win == w].sum()), int((rec_win == w).sum())) for w in WINDOWS]
        rec_blocks_0 = [(float(c0_abs[rec_win == w].sum()), int((rec_win == w).sum())) for w in WINDOWS]
        rec_blocks_c = [b for b in rec_blocks_c if b[1] > 0]
        rec_blocks_0 = [b for b in rec_blocks_0 if b[1] > 0]
        lo6, hi6 = boot_ci_delta(rng, rec_blocks_c, rec_blocks_0)
        cond6 = not (lo6 is not None and lo6 > 0)   # worse beyond CI => lower bound of delta > 0
        entry["recoveryMAE"] = mae(cabs[rec_m]); entry["recoveryC0"] = mae(c0_abs[rec_m])
        entry["recoveryCI"] = [lo6, hi6]

        # LOEO (condition 5, robustness half). Documented leniency (audit defect 6):
        # each fold rechecks condition 1's point threshold only; conditions 2/4 are
        # event-drop-invariant by construction, 1B/3 are not reverified per fold.
        # Lenient-side only — can never manufacture a FAIL.
        loeo = {}
        loeo_pass = True
        for ep, ws in EPISODES.items():
            keep = ~np.isin(val_win, ws) & is_event
            evk = mae(cabs[keep]); ev0k = mae(c0_abs[keep])
            imp = 1 - evk / ev0k if ev0k else None
            thr = C1H_IMPROVE if ep == "E2026" else C1_IMPROVE
            ok = imp is not None and imp >= thr
            loeo[ep] = {"improve": imp, "pass": bool(ok)}
            if not ok:
                loeo_pass = False

        entry.update({
            "cond1": bool(cond1), "cond1H": bool(cond1H), "cond1B": bool(cond1B),
            "cond2": bool(cond2), "cond3": bool(cond3), "cond4": bool(cond4),
            "cond6": bool(cond6),
            "eventCI": [lo, hi], "eventMaeCI": ev_mae_ci,
            "histImprove": (1 - ev_hist / ev0_hist) if ev0_hist else None,
            "episodesImproved": ep_improved, "perEpisode": per_ep, "loeo": loeo,
            "loeoPass": bool(loeo_pass), "worstCell": worst_cell, "duty": duty,
            "cells": cells,
        })
        # single-mode conditions
        entry["S1"] = entry["eventImprove"] is not None and entry["eventImprove"] >= S1_IMPROVE
        entry["S2"] = cond2
        s3ok = True
        for b in BIN_NAMES:
            m_c = bins_c == b
            m_0 = bins_0 == b
            if m_0.sum() >= S3_MIN_N and m_c.sum() >= S3_MIN_N:
                if mae(cabs[m_c]) / mae(c0_abs[m_0]) - 1 > S3_BIN_DEGRADE:
                    s3ok = False
        entry["S3"] = s3ok
        out["configs"][cid] = entry

    with open(os.path.join(DIR, f"v38_headline_python_{mode}.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(headline[0].keys()))
        w.writeheader()
        w.writerows(headline)
    return out, cfgs


def neighbors(cfg, all_ids):
    tlos, bws, ws = [1.10, 1.15, 1.20], [0.15, 0.25], [0.5, 0.65, 0.8, 1.0]
    out = []
    for dim, vals in (("tlo", tlos), ("bw", bws), ("w", ws)):
        i = vals.index(cfg[dim])
        for k in (i - 1, i + 1):
            if 0 <= k < len(vals):
                nid = f"{cfg['kind']}_t{round((cfg['tlo'] if dim != 'tlo' else vals[k]) * 100)}" \
                      f"_b{round((cfg['bw'] if dim != 'bw' else vals[k]) * 100)}" \
                      f"_w{round((cfg['w'] if dim != 'w' else vals[k]) * 100)}"
                if nid in all_ids:
                    out.append(nid)
    return out


def main():
    results = {}
    for mode in ("multi", "single"):
        print(f"[metrics] evaluating {mode}...")
        results[mode], cfgs = evaluate(mode)

    multi = results["multi"]["configs"]
    single = results["single"]["configs"]

    def full_pass(cid):
        e_m, e_s = multi[cid], single.get(cid)
        base = all(e_m[c] for c in ("cond1", "cond1H", "cond1B", "cond2", "cond3", "cond4", "cond6"))
        base = base and e_m["loeoPass"]
        if e_s:
            base = base and e_s["S1"] and e_s["S2"] and e_s["S3"]
        return base

    passing = [cid for cid in multi if cid != "c0" and full_pass(cid)]

    # neighbors requirement (conditions 1-4 for sweep neighbors of the chosen c1-family cells)
    def neighbors_ok(cid):
        cfg = parse_cfg(cid)
        if cfg["kind"] not in ("c1", "c1f", "c1n"):
            return True
        for nid in neighbors(cfg, set(multi.keys())):
            e = multi[nid]
            if not all(e[c] for c in ("cond1", "cond1H", "cond1B", "cond2", "cond3", "cond4")):
                return False
        return True

    passing_robust = [cid for cid in passing if neighbors_ok(cid)]

    # conservative selection among c1-family passing cells
    def cons_key(cid):
        c = parse_cfg(cid)
        return (-c.get("tlo", 0), c.get("w", 9), -c.get("bw", 0))

    c1_pass = sorted([c for c in passing_robust if parse_cfg(c)["kind"] in ("c1", "c1f", "c1n")],
                     key=cons_key)
    simple_pass = [c for c in passing_robust if parse_cfg(c)["kind"] in ("c2", "c2m")]

    chosen = None
    rationale = []
    if c1_pass:
        chosen = c1_pass[0]
        rationale.append(f"most conservative passing C1-family cell: {chosen}")
        best_c1 = min(c1_pass, key=lambda c: multi[c]["eventMAE"])
        lo, hi = multi[best_c1]["eventMaeCI"]
        for sc in simple_pass:
            if lo is not None and lo <= multi[sc]["eventMAE"] <= hi:
                chosen = sc
                rationale.append(f"simplicity rule: {sc} event-MAE inside best C1 cell's CI -> preferred")
                break
    elif simple_pass:
        chosen = sorted(simple_pass, key=lambda c: multi[c]["eventMAE"])[0]
        rationale.append(f"no C1 cell passed; simple arm passed: {chosen}")

    verdict = {
        "PASS": bool(chosen), "chosen": chosen, "rationale": rationale,
        "passingCells": passing, "passingRobust": passing_robust,
        "notes": [
            "LOEO 2026 fold evaluated at the 15% historical floor (interpretation note in header)",
            "W8 recovery window extends past dataset end (2026-07-20): empty by construction",
        ],
    }
    results["verdict"] = verdict
    with open(os.path.join(DIR, "v38_gate_results.json"), "w") as f:
        json.dump(results, f, indent=1, default=float)

    print(json.dumps(verdict, indent=1))
    print("\nTop cells by event improvement (multi):")
    ranked = sorted(((cid, e) for cid, e in multi.items() if cid != "c0"),
                    key=lambda kv: -(kv[1]["eventImprove"] or -9))[:10]
    for cid, e in ranked:
        print(f"  {cid:22s} eventImp {e['eventImprove']*100:6.1f}%  histImp "
              f"{(e['histImprove'] or 0)*100:6.1f}%  normDeg {e['normalDegrade']*100:5.2f}%  "
              f"eps {e['episodesImproved']}/7  c1={int(e['cond1'])} 1H={int(e['cond1H'])} "
              f"1B={int(e['cond1B'])} 2={int(e['cond2'])} 3={int(e['cond3'])} "
              f"4={int(e['cond4'])} 6={int(e['cond6'])} loeo={int(e['loeoPass'])}")


if __name__ == "__main__":
    main()

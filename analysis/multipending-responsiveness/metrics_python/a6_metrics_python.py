#!/usr/bin/python3
"""A6 multi-pending validation: blind Python metric analysis.

Implements analysis/multipending-responsiveness-plan-2026-11-11.md (v2, frozen; incl. 16b and D-1):
checksums (A0), assertions A1 to A9, band check, P-MECH, then the section 10 rows (+ 16b REP_START).

Usage:
  /usr/bin/python3 a6_metrics_python.py               # checks, then all metrics -> a6_metrics_python.csv
  /usr/bin/python3 a6_metrics_python.py --assert-only # checks and P-MECH only (run=check rows)

Reads only base rows of the two tick files (pandas chunked read, filter arm == base, all text).
"""
import argparse
import csv
import hashlib
import math
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
A6DIR = os.path.normpath(os.path.join(HERE, ".."))
ANALYSIS = os.path.normpath(os.path.join(A6DIR, ".."))
BT = os.path.join(ANALYSIS, "rising-limb-travel-backtest")
REPO = os.path.normpath(os.path.join(ANALYSIS, ".."))

F_SINGLE = os.path.join(BT, "rising_limb_ticks.csv")
F_MULTI = os.path.join(BT, "rising_limb_ticks_multi.csv")
F_EVENTS = os.path.join(BT, "rising_limb_events_python_v39.csv")
F_BOOT = os.path.join(BT, "rising_limb_bootstrap_indices.csv")
F_MIDX = os.path.join(A6DIR, "a6_month_block_indices.csv")
F_MLIST = os.path.join(A6DIR, "a6_month_list.csv")
F_CITABLE = os.path.join(REPO, "netlify", "functions", "shared", "ci-table.js")
OUT_CSV = os.path.join(HERE, "a6_metrics_python.csv")

SHA = {
    F_SINGLE: "8d841145905de1f6b6d217835c65229862ec6e115f33823c9472ffcfbfca0a6f",
    F_MULTI: "c99c4b56e3ae3edc47cda561a7322174d6797709e509ea63f8e0106e17064778",
    F_EVENTS: "978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44",
    F_BOOT: "7eff92a751fd9cc0c6f8e0220998e98788cc2f293b5437088bf9376e1dd96519",
    F_MIDX: "bfce274c4aa0b72713dc4e38bd0a9245e13c0907987210b8beff04e056aba8a9",
    F_MLIST: "c647b7e820b1eb81e2d3c0198146e031b95dee51532ef001b32da8cbbc78b6cb",
}

N_ROWS = 523948
N_TICKS = 130987
N_INSCORING = 122208
WIN_MS = 9000000
HOUR_MS = 3600000
D8_TICK = "2026-11-09T12:00:00.000Z"
LABEL_TRUTH_LIMIT = "2026-11-09T23:00:00.000Z"
T80_TEXT = "2024-01-26T14:00:00.000Z"
HOLDOUT = [47, 48, 49, 51]
OCT_ID = 53

TICK_COLS = ["tick_utc", "in_scoring", "mask", "mask_why", "tau_ref", "tau_converged", "truth",
             "truth_tick_utc", "rl_event", "rlx_event", "rec_event", "ew_any", "normal", "lf_view",
             "por_view", "lf_carry_h", "por_carry_h"]
MODEL_COLS = ["has_pred", "raw", "raw_unc", "flow_bin", "flow_state", "rst", "rate", "stop",
              "nonconverged", "lookup_fail", "it", "travel_por_gf", "travel_gf_lf", "b_active",
              "delta_on", "pct", "base_rst", "base_stop", "base_flow_bin", "base_flow_state",
              "truth_basehz", "truth_basehz_tick", "truth_own", "truth_own_tick"]

# bandFor table, transcribed from netlify/functions/shared/ci-table.js (verified against file text below)
CI90 = {
    '0-3000': {'rising': (-547, 369), 'steady': (-271, 250), 'falling': (-315, 336), 'all': (-309, 284)},
    '3000-6000': {'rising': (-676, 535), 'steady': (-327, 287), 'falling': (-391, 361), 'all': (-425, 356)},
    '6000-12000': {'rising': (-1650, 1046), 'steady': (-404, 320), 'falling': (-451, 359), 'all': (-628, 506)},
    '12000-25000': {'rising': (-2384, 1543), 'steady': (-549, 425), 'falling': (-514, 464), 'all': (-884, 741)},
    '25000-50000': {'rising': (-3851, 2860), 'steady': (-2013, 1844), 'falling': (-1068, 1059), 'all': (-2402, 1899)},
    '50000+': {'rising': (-7354, 5519), 'steady': (-5858, 6410), 'falling': (-4099, 6429), 'all': (-5858, 6410)},
}

ROWS = []
ASSERT_ONLY = False  # in --assert-only mode nothing is written (the full CSV is never overwritten)


def add(run, crit, mode, subset, stat, key, value):
    ROWS.append((run, crit, mode, subset, stat, "" if key is None else str(key), fmt(value)))


def fmt(v):
    if v is None:
        return "NA"
    if isinstance(v, (bool, np.bool_)):
        return "1" if v else "0"
    if isinstance(v, (int, np.integer)):
        return str(int(v))
    if isinstance(v, str):
        return v
    v = float(v)
    if math.isnan(v):
        return "NA"
    if math.isinf(v):
        return "Inf" if v > 0 else "-Inf"
    return repr(v)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def js_round(x):
    return math.floor(x + 0.5)


def iso_to_ms(series):
    t = pd.to_datetime(series, utc=True, format="ISO8601")
    return t.values.astype("datetime64[ms]").astype(np.int64)


def evtime_to_ms(text):
    return int(pd.Timestamp(text + "Z" if not text.endswith("Z") else text).value // 1000000)


def load_base(path):
    with open(path, "r") as f:
        header = f.readline().rstrip("\n").split(",")
    arms, parts, n = [], [], 0
    for ch in pd.read_csv(path, dtype=str, keep_default_na=False, chunksize=200000):
        arms.append(ch["arm"].to_numpy(copy=True))
        n += len(ch)
        parts.append(ch.loc[ch["arm"] == "base"].copy())
        del ch
    df = pd.concat(parts, ignore_index=True)
    return header, n, np.concatenate(arms), df


def fnum(series):
    """Parse text to float; blank -> nan. Python float() on the string (round trip)."""
    return np.array([float(x) if x != "" else np.nan for x in series], dtype=np.float64)


def check_rows(crit, n_checked, n_fail):
    add("check", crit, "both", "all", "n_checked", "", int(n_checked))
    add("check", crit, "both", "all", "n_fail", "", int(n_fail))
    add("check", crit, "both", "all", "pass", "", int(n_fail == 0))
    return n_fail == 0


def write_csv():
    if ASSERT_ONLY:
        for r in ROWS:
            if r[1] != "PMECH" or r[4] == "pass":
                print("  " + ",".join(r))
        return
    with open(OUT_CSV, "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["run", "criterion", "mode", "subset", "stat", "key", "value"])
        for r in ROWS:
            w.writerow(r)


def stop(msg):
    write_csv()
    print("STOP: " + msg)
    sys.exit(2)


def pct(a, q):
    return float(np.percentile(np.asarray(a, dtype=np.float64), q))


def main():
    np.seterr(divide="ignore", invalid="ignore")
    ap = argparse.ArgumentParser()
    ap.add_argument("--assert-only", action="store_true")
    args = ap.parse_args()
    global ASSERT_ONLY
    ASSERT_ONLY = args.assert_only

    # ---------------------------------------------------------------- A0 checksums
    n_bad = 0
    for p, h in SHA.items():
        got = sha256(p)
        print("sha256", os.path.basename(p), got, "OK" if got == h else "MISMATCH")
        n_bad += int(got != h)
    if not check_rows("A0", len(SHA), n_bad):
        stop("A0 checksum mismatch")

    # ci-table transcription check: every (q05, q95) literal present in the JS file text
    js = open(F_CITABLE).read()
    for b, d in CI90.items():
        for st, (q05, q95) in d.items():
            if ("%s: { q05: %d, q95: %d }" % (st, q05, q95)) not in js:
                stop("ci-table transcription mismatch %s %s" % (b, st))

    # ---------------------------------------------------------------- load
    hS, nS, armS, S = load_base(F_SINGLE)
    hM, nM, armM, M = load_base(F_MULTI)
    print("loaded", nS, nM, len(S), len(M))

    # ---------------------------------------------------------------- A1
    exp_arm = np.array(["base", "A", "B", "C"])
    fails = 0
    for n, arms in ((nS, armS), (nM, armM)):
        if n != N_ROWS or len(arms) % 4 != 0:
            fails += 1
        else:
            fails += int((arms.reshape(-1, 4) != exp_arm).sum())
    fails += int(hS != hM) + int(len(hS) != 50)
    fails += int(len(S) != N_TICKS) + int(len(M) != N_TICKS)
    tS = iso_to_ms(S["tick_utc"])
    tM = iso_to_ms(M["tick_utc"])
    fails += int(not np.all(np.diff(tS) == HOUR_MS)) + int(not np.all(np.diff(tM) == HOUR_MS))
    fails += int(S["tick_utc"].iloc[0] != "2011-12-01T05:00:00.000Z") + int(S["tick_utc"].iloc[-1] != "2026-11-09T23:00:00.000Z")
    n_insc_S = int((S["in_scoring"] == "1").sum())
    n_insc_M = int((M["in_scoring"] == "1").sum())
    fails += int(n_insc_S != N_INSCORING) + int(n_insc_M != N_INSCORING)
    a1 = check_rows("A1", nS + nM, fails)
    add("check", "A1", "both", "all", "n_in_scoring", "", n_insc_S)
    del armS, armM
    if not a1:
        stop("A1 failed (n_fail=%d)" % fails)

    T = tS  # tick ms, identical in both

    # ---------------------------------------------------------------- A2
    bad = np.zeros(N_TICKS, dtype=bool)
    for c in TICK_COLS:
        bad |= (S[c].to_numpy() != M[c].to_numpy())
    bad |= (M["mask_why"].to_numpy() == "view_input_missing")
    if not check_rows("A2", N_TICKS, int(bad.sum())):
        stop("A2 failed: %d ticks; first %s" % (bad.sum(), list(S["tick_utc"][bad][:5])))

    # ---------------------------------------------------------------- A3
    bad = np.zeros(N_TICKS, dtype=bool)
    for c in MODEL_COLS:
        bad |= (S[c].to_numpy() != M[c].to_numpy())
    if not check_rows("A3", N_TICKS, int(bad.sum())):
        stop("A3 failed (possible VOID): %d ticks; first %s" % (bad.sum(), list(S["tick_utc"][bad][:5])))

    # ---------------------------------------------------------------- A4
    valS = (S["validated"] == "1").to_numpy()
    valM = (M["validated"] == "1").to_numpy()
    first_val = min(np.argmax(valS) if valS.any() else N_TICKS, np.argmax(valM) if valM.any() else N_TICKS)
    cols_ex_slot = [c for c in hS if c != "slot"]
    bad_pre = np.zeros(first_val, dtype=bool)
    for c in cols_ex_slot:
        bad_pre |= (S[c].to_numpy()[:first_val] != M[c].to_numpy()[:first_val])
    hp = (M["has_pred"] == "1").to_numpy()
    slotM = M["slot"].to_numpy()
    bad_slot = np.where(hp, slotM != "stored", ~np.isin(slotM, ["", "no_prediction"]))
    a4_fail = int(bad_pre.sum()) + int(bad_slot.sum())
    print("A4 first validation index", first_val, S["tick_utc"].iloc[first_val])
    if not check_rows("A4", first_val + N_TICKS, a4_fail):
        stop("A4 failed: pre %d slot %d" % (bad_pre.sum(), bad_slot.sum()))

    # ---------------------------------------------------------------- A5 (D-8 override)
    d8 = np.where(S["tick_utc"].to_numpy() == D8_TICK)[0]
    a5_fail = 0
    n_a5 = 0
    if len(d8) != 1:
        a5_fail += 1
    else:
        i8 = d8[0]
        for D in (S, M):
            n_a5 += 1
            ok = (D["mask"].iloc[i8] == "1" and D["normal"].iloc[i8] == "1" and D["rl_event"].iloc[i8] == ""
                  and D["rlx_event"].iloc[i8] == "" and D["rec_event"].iloc[i8] == "")
            a5_fail += int(not ok)
    labeled = ((S["rl_event"] != "") | (S["rlx_event"] != "") | (S["rec_event"] != "")).to_numpy()
    tt = S["truth_tick_utc"].to_numpy()
    tt_nonblank = labeled & (tt != "")
    tt_ms = np.full(N_TICKS, np.iinfo(np.int64).min, dtype=np.int64)
    tt_ms[tt_nonblank] = iso_to_ms(pd.Series(tt[tt_nonblank]))
    lim = int(iso_to_ms(pd.Series([LABEL_TRUTH_LIMIT]))[0])
    late = tt_nonblank & (tt_ms > lim)
    a5_fail += int(late.sum())
    n_a5 += int(labeled.sum())
    if not check_rows("A5", n_a5, a5_fail):
        stop("A5 failed: %d" % a5_fail)
    mask_file = (S["mask"] == "1").to_numpy()
    mask = mask_file.copy()
    mask[d8[0]] = False

    # ---------------------------------------------------------------- shared arrays
    lfv = fnum(S["lf_view"])  # equal in both files (A2)
    lf_valid = ~np.isnan(lfv) & (lfv != 0) & (lfv >= 500) & (lfv <= 500000)
    has_pred = (S["has_pred"] == "1").to_numpy()
    travel = fnum(S["travel_gf_lf"])  # equal in both files (A3)
    hardS = (S["hard_flag"] == "1").to_numpy()
    hardM = (M["hard_flag"] == "1").to_numpy()
    # next index j >= i with valid LF (N_TICKS if none)
    nxt = np.full(N_TICKS + 1, N_TICKS, dtype=np.int64)
    for i in range(N_TICKS - 1, -1, -1):
        nxt[i] = i if lf_valid[i] else nxt[i + 1]

    def due_ms(s):
        return math.trunc(int(T[s]) + travel[s] * 60 * 60 * 1000)

    def first_due_valid(s):
        """First tick index v > s with T[v] >= due(s) and valid LF; returns (v or None, due)."""
        d = due_ms(s)
        k = -((int(T[0]) - d) // HOUR_MS)  # integer ceil of (d - T0) / 1 h
        k = max(k, s + 1)
        if k >= N_TICKS:
            return None, d
        v = int(nxt[k])
        return (None if v >= N_TICKS else v), d

    # ---------------------------------------------------------------- A6 single chain
    stored = np.where((S["slot"] == "stored").to_numpy())[0]
    vS = np.where(valS)[0]
    a6_fail = 0
    pairsS = []  # (s, v)
    pos = np.searchsorted(stored, vS, side="left") - 1
    for v, p in zip(vS, pos):
        if p < 0:
            a6_fail += 1
            continue
        s = int(stored[p])
        d = due_ms(s)
        if not (int(T[v]) >= d and int(T[v]) - d <= WIN_MS):
            a6_fail += 1
        pairsS.append((s, int(v)))
    matched = {v: s for s, v in pairsS}
    a6_comp_fail = 0
    for s in stored:
        if np.isnan(travel[s]):
            a6_comp_fail += 1
            continue
        v, d = first_due_valid(int(s))
        if v is not None and int(T[v]) - d <= WIN_MS:
            if not (valS[v] and matched.get(v) == int(s)):
                a6_comp_fail += 1
    a6 = check_rows("A6", len(vS) + len(stored), a6_fail + a6_comp_fail)
    add("check", "A6", "single", "all", "n_validations", "", len(pairsS))
    print("A6 consistency fails", a6_fail, "completeness fails", a6_comp_fail)
    if not a6:
        stop("A6 failed: consistency %d completeness %d" % (a6_fail, a6_comp_fail))

    # ---------------------------------------------------------------- A7 multi chain
    pairsM = []
    n_val = np.zeros(N_TICKS, dtype=np.int64)
    a7_extra = 0
    for s in np.where(has_pred)[0]:
        s = int(s)
        if np.isnan(travel[s]):
            a7_extra += 1
            continue
        v, d = first_due_valid(s)
        if v is not None and int(T[v]) - d <= WIN_MS:
            pairsM.append((s, v))
            n_val[v] += 1
    recon = n_val > 0
    a7_mis = int((recon != valM).sum()) + a7_extra
    a7 = check_rows("A7", N_TICKS, a7_mis)
    add("check", "A7", "multi", "all", "n_validations", "", len(pairsM))
    if not a7:
        bad_t = list(S["tick_utc"].to_numpy()[recon != valM][:5])
        stop("A7 failed: %d ticks differ; first %s" % (a7_mis, bad_t))

    # ---------------------------------------------------------------- events
    ev = pd.read_csv(F_EVENTS, dtype=str, keep_default_na=False)
    ev = ev[ev["event_row"] == "1"]
    gate = ev[(ev["event_class"] == "GATE") & (ev["kept"] == "1")].sort_values("event_t0")
    strat = ev[(ev["event_class"] == "STRATUM") & (ev["kept"] == "1")].sort_values("event_t0")
    GATE_IDS = [int(x) for x in gate["event_id"]]
    STR_IDS = [int(x) for x in strat["event_id"]]
    assert len(GATE_IDS) == 21 and len(STR_IDS) == 15
    assert int(gate.loc[gate["event_id"] == str(OCT_ID), "oct"].iloc[0]) == 1
    assert sorted(int(x) for x in gate.loc[gate["holdout"] == "1", "event_id"]) == HOLDOUT
    EV = {}
    for _, r in ev.iterrows():
        if r["kept"] != "1":
            continue
        e = int(r["event_id"])
        EV[e] = dict(r_ms=evtime_to_ms(r["rl_start"]), t0_ms=evtime_to_ms(r["event_t0"]),
                     tend_ms=evtime_to_ms(r["event_tend"]), x3=int(r["x3_scored_rl_ticks"]))

    def lab(col):
        a = S[col].to_numpy()
        return np.array([int(x) if x != "" else -1 for x in a], dtype=np.int64)
    rl = lab("rl_event")
    rlx = lab("rlx_event")
    rec = lab("rec_event")

    # ---------------------------------------------------------------- A8
    setM = set(pairsM)
    a8_fail = 0
    for s, v in pairsS:
        if (s, v) not in setM or hardS[v] != hardM[v]:
            a8_fail += 1

    def resp(pairs, hard, e, ref_ms=None):
        """D (h) from ref (default r_e) using validations with s >= ref, v <= tend, not hard; and K."""
        info = EV[e]
        ref = info["r_ms"] if ref_ms is None else ref_ms
        first = None
        K = 0
        for s, v in pairs:
            if int(T[s]) >= ref and int(T[v]) <= info["tend_ms"] and not hard[v]:
                if first is None or v < first:
                    first = v
                if ref_ms is None and rl[v] == e:
                    K += 1
        D = math.inf if first is None else (int(T[first]) - ref) / HOUR_MS
        return D, K, first

    RESP = {}
    for e in GATE_IDS:
        Ds, Ks, fs = resp(pairsS, hardS, e)
        Dm, Km, fm = resp(pairsM, hardM, e)
        RESP[e] = (Ds, Dm, Ks, Km, fs, fm)
        if math.isfinite(Ds) and not math.isfinite(Dm):
            a8_fail += 1
    if not check_rows("A8", len(pairsS) + len(GATE_IDS), a8_fail):
        stop("A8 failed: %d" % a8_fail)

    # ---------------------------------------------------------------- A9
    capS = (S["ceiling_applied"] == "1").to_numpy()
    capM = (M["ceiling_applied"] == "1").to_numpy()
    both_cap = capS & capM
    a9_fail = int((S["disp"].to_numpy()[both_cap] != M["disp"].to_numpy()[both_cap]).sum())
    if not check_rows("A9", int(both_cap.sum()), a9_fail):
        stop("A9 failed: %d" % a9_fail)

    # ---------------------------------------------------------------- scored set and band check
    insc = (S["in_scoring"] == "1").to_numpy()
    scored = insc & mask & has_pred
    truth = fnum(S["truth"])
    dispS = fnum(S["disp"])
    dispM = fnum(M["disp"])

    def band(disp, fb, fs):
        out_lo = np.full(N_TICKS, np.nan)
        out_hi = np.full(N_TICKS, np.nan)
        nnull = 0
        for i in np.where(scored)[0]:
            x = disp[i]
            d = CI90.get(fb[i])
            if not np.isfinite(x) or d is None:
                nnull += 1
                continue
            q05, q95 = d.get(fs[i], d["all"])
            out_lo[i] = max(0, js_round(x - q95))
            out_hi[i] = js_round(x - q05)
        return out_lo, out_hi, nnull
    loS, hiS, nnS = band(dispS, S["flow_bin"].to_numpy(), S["flow_state"].to_numpy())
    loM, hiM, nnM = band(dispM, M["flow_bin"].to_numpy(), M["flow_state"].to_numpy())
    if not check_rows("BAND", 2 * int(scored.sum()), nnS + nnM):
        stop("BAND null band: %d" % (nnS + nnM))

    # schema rule 2 (extra check): masked ticks have a prediction; scored ticks have truth, disp, unc
    uncS = fnum(S["unc"])
    uncM = fnum(M["unc"])
    m_in = insc & mask
    xbad = int((m_in & ~has_pred).sum())
    xbad += int(np.isnan(truth[scored]).sum() + np.isnan(dispS[scored]).sum() + np.isnan(dispM[scored]).sum()
                + np.isnan(uncS[scored]).sum() + np.isnan(uncM[scored]).sum())
    xbad += int((truth[scored] <= 0).sum())
    if not check_rows("SCHEMA_MASKPRED", int(m_in.sum()), xbad):
        stop("schema mask/has_pred or blank values on scored ticks: %d" % xbad)

    # extra check: GATE scored RL tick count equals the frozen event file's x3_scored_rl_ticks
    gate_rl = scored & np.isin(rl, GATE_IDS)
    n727 = sum(EV[e]["x3"] for e in GATE_IDS)
    xf = 0
    for e in GATE_IDS:
        xf += int(int((scored & (rl == e)).sum()) != EV[e]["x3"])
    check_rows("RLCOUNT", len(GATE_IDS), xf)
    add("check", "RLCOUNT", "both", "RL21", "n_ticks", "", int(gate_rl.sum()))
    if xf:
        stop("RL tick counts differ from event file x3_scored_rl_ticks (%d events; file total %d, here %d)"
             % (xf, n727, int(gate_rl.sum())))

    # T80
    G = n_insc_S
    t80_idx = (8 * G) // 10
    t80_ms = int(iso_to_ms(pd.Series(["2012-12-01T00:00:00.000Z"]))[0]) + t80_idx * HOUR_MS
    t80_expect = int(iso_to_ms(pd.Series([T80_TEXT]))[0])
    add("check", "N3", "both", "NORM_T80", "t80_index", T80_TEXT, t80_idx)
    if t80_idx != 97766 or t80_ms != t80_expect:
        stop("T80 mismatch")

    # ---------------------------------------------------------------- P-MECH
    dD = []
    for e in GATE_IDS:
        Ds, Dm = RESP[e][0], RESP[e][1]
        if math.isinf(Ds) and math.isinf(Dm):
            dD.append(0.0)
        else:
            dD.append(Ds - Dm)  # inf - finite = inf
    med = sorted(dD)[10]
    sKs = sum(RESP[e][2] for e in GATE_IDS)
    sKm = sum(RESP[e][3] for e in GATE_IDS)
    if sKs == 0:
        ratio = math.inf if sKm > 0 else math.nan
    else:
        ratio = sKm / sKs
    pm = (med > 0) and (not math.isnan(ratio)) and ratio > 1.5
    add("check", "PMECH", "both", "RL21", "median_dD_h", "", med)
    add("check", "PMECH", "single", "RL21", "sum_K", "", sKs)
    add("check", "PMECH", "multi", "RL21", "sum_K", "", sKm)
    add("check", "PMECH", "both", "RL21", "K_ratio", "", ratio)
    add("check", "PMECH", "both", "RL21", "pass", "", int(pm))
    print("PMECH", "pass" if pm else "FAIL")
    if not pm:
        stop("STOP-MECH: P-MECH failed")
    if args.assert_only:
        write_csv()
        print("assert-only: all checks passed")
        return

    # ================================================================ METRICS
    eS = dispS - truth
    eM = dispM - truth
    euS = uncS - truth
    euM = uncM - truth
    aS, aM = np.abs(eS), np.abs(eM)
    pS = (100.0 * eS) / truth
    pM = (100.0 * eM) / truth
    urS = (100.0 * (dispS - truth)) / truth <= -15
    urM = (100.0 * (dispM - truth)) / truth <= -15
    covS = (loS <= truth) & (truth <= hiS)
    covM = (loM <= truth) & (truth <= hiM)
    normal_col = (S["normal"] == "1").to_numpy()

    def mae(a, sel):
        n = int(sel.sum())
        return float(a[sel].sum()) / n if n else None

    def gain(sel, A_s=aS, A_m=aM):
        ss = float(A_s[sel].sum())
        return 1.0 - float(A_m[sel].sum()) / ss if ss != 0 else None

    def rel(sel, A_s=aS, A_m=aM):
        ss = float(A_s[sel].sum())
        return float(A_m[sel].sum()) / ss - 1.0 if ss != 0 else None

    # bootstrap event order and per-event sums
    boot = np.loadtxt(F_BOOT, delimiter=",", dtype=np.int64)
    assert boot.shape == (10000, 21)
    ORD = GATE_IDS  # sorted by event_t0

    def per_event(vals, base_sel, lab_arr):
        return np.array([float(vals[base_sel & (lab_arr == e)].sum()) for e in ORD], dtype=np.float64)

    def per_event_n(base_sel, lab_arr):
        return np.array([int((base_sel & (lab_arr == e)).sum()) for e in ORD], dtype=np.int64)

    def boot_sum(per_ev):
        return per_ev[boot].sum(axis=1)

    gate_rec = scored & np.isin(rec, GATE_IDS)

    # ------------------------------------------------ R2 (and U_R2)
    def r2_block(run, crit, As, Am, threshold_pass=True):
        Ss = per_event(As, scored, rl)
        Sm = per_event(Am, scored, rl)
        point = 1.0 - Sm.sum() / Ss.sum()
        gb = 1.0 - boot_sum(Sm) / boot_sum(Ss)
        lo, hi = pct(gb, 2.5), pct(gb, 97.5)
        add(run, crit, "single", "RL21", "mae", "", mae(As, gate_rl))
        add(run, crit, "multi", "RL21", "mae", "", mae(Am, gate_rl))
        add(run, crit, "diff", "RL21", "point", "", point)
        add(run, crit, "diff", "RL21", "ci_lo", "", lo)
        add(run, crit, "diff", "RL21", "ci_hi", "", hi)
        add(run, crit, "both", "RL21", "n_ticks", "", int(gate_rl.sum()))
        ok = (point >= 0.05) and (lo > 0)
        add(run, crit, "both", "RL21", "pass", "", int(ok))
        return ok, Ss, Sm
    passR2, SsE, SmE = r2_block("gate", "R2", aS, aM)

    # ------------------------------------------------ R3
    n_imp = 0
    improved = {}
    for i, e in enumerate(ORD):
        imp = SmE[i] < SsE[i]
        improved[e] = imp
        n_imp += int(imp)
        add("gate", "R3", "single", "RLev", "sum_abs", e, SsE[i])
        add("gate", "R3", "multi", "RLev", "sum_abs", e, SmE[i])
        add("gate", "R3", "diff", "RLev", "improved", e, int(imp))
    add("gate", "R3", "both", "RL21", "n_improved", "", n_imp)
    passR3 = n_imp * 100 >= 65 * 21
    add("gate", "R3", "both", "RL21", "pass", "", int(passR3))

    # ------------------------------------------------ B1
    rl20 = scored & np.isin(rl, [e for e in GATE_IDS if e != OCT_ID])
    b1 = gain(rl20)
    add("gate", "B1", "single", "RL20", "mae", "", mae(aS, rl20))
    add("gate", "B1", "multi", "RL20", "mae", "", mae(aM, rl20))
    add("gate", "B1", "diff", "RL20", "point", "", b1)
    add("gate", "B1", "both", "RL20", "n_ticks", "", int(rl20.sum()))
    passB1 = b1 > 0
    add("gate", "B1", "both", "RL20", "pass", "", int(passB1))

    # ------------------------------------------------ B2
    pts = []
    for e in GATE_IDS:
        sel = scored & np.isin(rl, [x for x in GATE_IDS if x != e])
        g = gain(sel)
        pts.append(g)
        add("gate", "B2", "diff", "RLdrop", "point", e, g)
    add("gate", "B2", "diff", "RLdrop", "min_point", "", min(pts))
    passB2 = all(p > 0 for p in pts)
    add("gate", "B2", "both", "RLdrop", "pass", "", int(passB2))

    # ------------------------------------------------ B3
    rlh = scored & np.isin(rl, HOLDOUT)
    b3 = gain(rlh)
    add("gate", "B3", "single", "RLH", "mae", "", mae(aS, rlh))
    add("gate", "B3", "multi", "RLH", "mae", "", mae(aM, rlh))
    add("gate", "B3", "diff", "RLH", "point", "", b3)
    add("gate", "B3", "both", "RLH", "n_ticks", "", int(rlh.sum()))
    passB3 = b3 > 0
    add("gate", "B3", "both", "RLH", "pass", "", int(passB3))

    # ------------------------------------------------ month blocks
    mlist = pd.read_csv(F_MLIST, header=None, dtype=str, keep_default_na=False)
    assert list(mlist[0].astype(int)) == list(range(len(mlist)))
    MONTHS = list(mlist[1])
    midx = np.loadtxt(F_MIDX, delimiter=",", dtype=np.int64)
    assert midx.shape == (10000, len(MONTHS))
    month_of = pd.to_datetime(S["tick_utc"], utc=True, format="ISO8601").dt.strftime("%Y-%m").to_numpy()
    mpos = {m: i for i, m in enumerate(MONTHS)}
    month_i = np.array([mpos.get(m, -1) for m in month_of], dtype=np.int64)
    cellkey = (S["base_flow_bin"] + "|" + S["base_flow_state"]).to_numpy()

    def month_sums(vals, sel):
        out = np.zeros(len(MONTHS))
        np.add.at(out, month_i[sel], vals[sel])
        return out

    def month_counts(sel):
        out = np.zeros(len(MONTHS), dtype=np.int64)
        np.add.at(out, month_i[sel], 1)
        return out

    def norm_block(run, crit, mask_arr):
        norm = insc & mask_arr & has_pred & normal_col
        months_here = set(np.unique(month_i[norm]))
        if -1 in months_here or len(months_here) != len(MONTHS):
            stop("month list does not match the months of scored normal ticks (%s)" % crit)
        # N1
        point = rel(norm)
        ms, mm = month_sums(aS, norm), month_sums(aM, norm)
        bs, bm = ms[midx].sum(axis=1), mm[midx].sum(axis=1)
        okb = bs != 0
        rb = bm[okb] / bs[okb] - 1.0
        lo, hi = pct(rb, 2.5), pct(rb, 97.5)
        n1 = "N1" + crit[1:]
        n2 = "N2" + crit[1:]
        add(run, n1, "single", "NORM", "mae", "", mae(aS, norm))
        add(run, n1, "multi", "NORM", "mae", "", mae(aM, norm))
        add(run, n1, "diff", "NORM", "point", "", point)
        add(run, n1, "diff", "NORM", "ci_lo", "", lo)
        add(run, n1, "diff", "NORM", "ci_hi", "", hi)
        add(run, n1, "both", "NORM", "n_ticks", "", int(norm.sum()))
        add(run, n1, "both", "NORM", "n_res_used", "", int(okb.sum()))
        p1 = (point <= 0.01) and (hi <= 0.02)
        add(run, n1, "both", "NORM", "pass", "", int(p1))
        # N2
        cells = sorted(set(cellkey[norm]))
        ncell, nfail, cells_used = 0, 0, []
        for c in cells:
            sel = norm & (cellkey == c)
            n = int(sel.sum())
            if n < 200:
                continue
            ncell += 1
            cells_used.append(c)
            point_c = rel(sel)
            cs, cm, cn = month_sums(aS, sel), month_sums(aM, sel), month_counts(sel)
            bs_c, bm_c, bn_c = cs[midx].sum(axis=1), cm[midx].sum(axis=1), cn[midx].sum(axis=1)
            okc = (bn_c > 0) & (bs_c != 0)
            rc = bm_c[okc] / bs_c[okc] - 1.0
            lo_c = pct(rc, 2.5) if okc.any() else None
            hi_c = pct(rc, 97.5) if okc.any() else None
            fail_c = ((point_c > 0.03) and (lo_c is not None and lo_c > 0)) or ((point_c > 0.05) and n >= 2000)
            nfail += int(fail_c)
            add(run, n2, "both", "NORMcell", "n_ticks", c, n)
            add(run, n2, "single", "NORMcell", "mae", c, mae(aS, sel))
            add(run, n2, "multi", "NORMcell", "mae", c, mae(aM, sel))
            add(run, n2, "diff", "NORMcell", "point", c, point_c)
            add(run, n2, "diff", "NORMcell", "ci_lo", c, lo_c)
            add(run, n2, "diff", "NORMcell", "ci_hi", c, hi_c)
            add(run, n2, "both", "NORMcell", "n_res_dropped", c, int((~okc).sum()))
            add(run, n2, "both", "NORMcell", "cell_fail", c, int(fail_c))
        add(run, n2, "both", "NORMcell", "n_cells", "", ncell)
        add(run, n2, "both", "NORMcell", "n_cells_failed", "", nfail)
        p2 = nfail == 0
        add(run, n2, "both", "NORMcell", "pass", "", int(p2))
        return p1, p2, norm, cells_used

    passN1, passN2, NORM, CELLS = norm_block("gate", "N", mask)
    norm_block("edge", "N_edge", mask_file)

    # ------------------------------------------------ N3
    n3sel = NORM & (T >= t80_expect)
    n3 = rel(n3sel)
    add("gate", "N3", "single", "NORM_T80", "mae", "", mae(aS, n3sel))
    add("gate", "N3", "multi", "NORM_T80", "mae", "", mae(aM, n3sel))
    add("gate", "N3", "diff", "NORM_T80", "point", "", n3)
    add("gate", "N3", "both", "NORM_T80", "n_ticks", "", int(n3sel.sum()))
    passN3 = n3 <= 0.02
    add("gate", "N3", "both", "NORM_T80", "pass", "", int(passN3))

    # ------------------------------------------------ D1 (and U_D1)
    def d1_block(run, crit, PS, PM, point_only=False):
        es, em = per_event(PS, scored, rec), per_event(PM, scored, rec)
        en = per_event_n(scored, rec)
        n = int(en.sum())
        bias_s = es.sum() / n
        bias_m = em.sum() / n
        point = abs(bias_m) - abs(bias_s)
        add(run, crit, "single", "REC21", "bias_pp", "", bias_s)
        add(run, crit, "multi", "REC21", "bias_pp", "", bias_m)
        add(run, crit, "diff", "REC21", "point", "", point)
        if point_only:
            add(run, crit, "both", "REC21", "n_ticks", "", n)
            return None
        bn = en[boot].sum(axis=1)
        ok = bn > 0
        bbs = es[boot].sum(axis=1)[ok] / bn[ok]
        bbm = em[boot].sum(axis=1)[ok] / bn[ok]
        db = np.abs(bbm) - np.abs(bbs)
        lo, hi = pct(db, 2.5), pct(db, 97.5)
        add(run, crit, "diff", "REC21", "ci_lo", "", lo)
        add(run, crit, "diff", "REC21", "ci_hi", "", hi)
        add(run, crit, "both", "REC21", "n_ticks", "", n)
        add(run, crit, "both", "REC21", "n_res_dropped", "", int((~ok).sum()))
        p = (point <= 0.5) and (hi <= 1.0)
        add(run, crit, "both", "REC21", "pass", "", int(p))
        return p
    passD1 = d1_block("gate", "D1", pS, pM)

    # ------------------------------------------------ C1, C2, C3
    def cov_block(crit, sel, subset, rule):
        n = int(sel.sum())
        cs, cm = int(covS[sel].sum()), int(covM[sel].sum())
        add("gate", crit, "single", subset, "cov", "", cs / n)
        add("gate", crit, "multi", subset, "cov", "", cm / n)
        add("gate", crit, "both", subset, "n_ticks", "", n)
        if rule == "C1":
            p = abs(100 * cm - 90 * n) <= max(4 * n, abs(100 * cs - 90 * n))
        else:
            p = 100 * cm >= 100 * cs - 2 * n
        add("gate", crit, "both", subset, "pass", "", int(p))
        return p
    passC1 = cov_block("C1", NORM, "NORM", "C1")
    passC2 = cov_block("C2", gate_rl, "RL21", "C2")
    passC3 = cov_block("C3", gate_rec, "REC21", "C3")

    # ------------------------------------------------ S1, S2
    def s_block(crit, lab_arr, subset):
        sel = scored & np.isin(lab_arr, GATE_IDS)
        n = int(sel.sum())
        Us, Um = int(urS[sel].sum()), int(urM[sel].sum())
        us_e = per_event(urS.astype(np.float64), scored, lab_arr)
        um_e = per_event(urM.astype(np.float64), scored, lab_arr)
        n_e = per_event_n(scored, lab_arr)
        bn = n_e[boot].sum(axis=1)
        ok = bn > 0
        db = (um_e[boot].sum(axis=1)[ok] - us_e[boot].sum(axis=1)[ok]) / bn[ok]
        lo, hi = pct(db, 2.5), pct(db, 97.5)
        point = (Um - Us) / n
        add("gate", crit, "single", subset, "share", "", Us / n)
        add("gate", crit, "multi", subset, "share", "", Um / n)
        add("gate", crit, "diff", subset, "point", "", point)
        add("gate", crit, "diff", subset, "ci_lo", "", lo)
        add("gate", crit, "diff", subset, "ci_hi", "", hi)
        add("gate", crit, "both", subset, "n_res_dropped", "", int((~ok).sum()))
        p = (100 * (Um - Us) <= n) and (hi <= 0.030)
        add("gate", crit, "both", subset, "pass", "", int(p))
        return p
    passS1 = s_block("S1", rl, "RL21")
    passS2 = s_block("S2", rec, "REC21")

    allp = [passR2, passR3, passB1, passB2, passB3, passN1, passN2, passN3, passD1,
            passC1, passC2, passC3, passS1, passS2]
    add("gate", "GATE", "both", "all", "n_rows_pass", "", int(sum(bool(x) for x in allp)))
    add("gate", "GATE", "both", "all", "pass", "", int(all(allp)))

    # ================================================================ REPORT
    r2_block("report", "U_R2", np.abs(euS), np.abs(euM))
    d1_block("report", "U_D1", (100.0 * euS) / truth, (100.0 * euM) / truth, point_only=True)

    def simple(crit, sel, subset):
        add("report", crit, "single", subset, "mae", "", mae(aS, sel))
        add("report", crit, "multi", subset, "mae", "", mae(aM, sel))
        add("report", crit, "diff", subset, "point", "", gain(sel))
    simple("RLX", scored & np.isin(rlx, GATE_IDS), "RLX21")
    t0_arr = np.full(N_TICKS, np.iinfo(np.int64).max, dtype=np.int64)
    for e in GATE_IDS + STR_IDS:
        t0_arr[rl == e] = EV[e]["t0_ms"]
    simple("F24", gate_rl & (T >= t0_arr), "F24_21")
    strsel = scored & np.isin(rl, STR_IDS)
    simple("STR", strsel, "RLstr15")
    n_imp_str = 0
    for e in STR_IDS:
        sel = scored & (rl == e)
        n_imp_str += int(float(aM[sel].sum()) < float(aS[sel].sum()))
    add("report", "STR", "both", "RLstr15", "n_improved", "", n_imp_str)

    # EV
    for e in GATE_IDS:
        sel = scored & (rl == e)
        add("report", "EV", "single", "RLev", "mae", e, mae(aS, sel))
        add("report", "EV", "multi", "RLev", "mae", e, mae(aM, sel))
        add("report", "EV", "diff", "RLev", "point", e, gain(sel))
        add("report", "EV", "diff", "RLev", "mae_diff", e, mae(aM, sel) - mae(aS, sel))
        add("report", "EV", "both", "RLev", "n_ticks", e, int(sel.sum()))

    # SPLIT at v1_e (first multi event-created learned validation)
    bef_all = np.zeros(N_TICKS, dtype=bool)
    aft_all = np.zeros(N_TICKS, dtype=bool)
    for e in GATE_IDS:
        sel = scored & (rl == e)
        fm = RESP[e][5]
        v1 = np.iinfo(np.int64).max if fm is None else int(T[fm])
        b, a = sel & (T < v1), sel & (T >= v1)
        bef_all |= b
        aft_all |= a
        for nm, ss in (("RLbefore", b), ("RLafter", a)):
            add("report", "SPLIT", "single", nm, "mae", e, mae(aS, ss))
            add("report", "SPLIT", "multi", nm, "mae", e, mae(aM, ss))
            add("report", "SPLIT", "both", nm, "n_ticks", e, int(ss.sum()))
    for nm, ss in (("RLbefore", bef_all), ("RLafter", aft_all)):
        add("report", "SPLIT", "single", nm, "mae", "", mae(aS, ss))
        add("report", "SPLIT", "multi", nm, "mae", "", mae(aM, ss))
        add("report", "SPLIT", "both", nm, "n_ticks", "", int(ss.sum()))

    # CAP
    for subset, sel in (("RL21", gate_rl), ("REC21", gate_rec), ("NORM", NORM)):
        n = int(sel.sum())
        add("report", "CAP", "single", subset, "cap_rate", "", int(capS[sel].sum()) / n)
        add("report", "CAP", "multi", subset, "cap_rate", "", int(capM[sel].sum()) / n)

    # CAP4 on RL21
    for nm, cs in (("cap_both", capS & capM), ("cap_single_only", capS & ~capM),
                   ("cap_multi_only", ~capS & capM), ("cap_neither", ~capS & ~capM)):
        sel = gate_rl & cs
        n = int(sel.sum())
        add("report", "CAP4", "both", nm, "n_ticks", "", n)
        add("report", "CAP4", "single", nm, "mae", "", mae(aS, sel))
        add("report", "CAP4", "multi", nm, "mae", "", mae(aM, sel))
        add("report", "CAP4", "single", nm, "mean_signed", "", mae(eS, sel))
        add("report", "CAP4", "multi", nm, "mean_signed", "", mae(eM, sel))

    # CELLCOV
    for c in CELLS:
        sel = NORM & (cellkey == c)
        n = int(sel.sum())
        add("report", "CELLCOV", "single", "NORMcell", "cov", c, int(covS[sel].sum()) / n)
        add("report", "CELLCOV", "multi", "NORMcell", "cov", c, int(covM[sel].sum()) / n)

    # BIAS
    for subset, sel in (("RL21", gate_rl), ("REC21", gate_rec), ("NORM", NORM)):
        add("report", "BIAS", "single", subset, "mean_signed", "", mae(eS, sel))
        add("report", "BIAS", "multi", subset, "mean_signed", "", mae(eM, sel))

    # UR
    for subset, sel in (("RL21", gate_rl), ("REC21", gate_rec)):
        add("report", "UR", "single", subset, "mean_signed_under", "", mae(eS, sel & urS))
        add("report", "UR", "multi", subset, "mean_signed_under", "", mae(eM, sel & urM))
    for e in GATE_IDS:
        sel = scored & (rl == e)
        add("report", "UR", "single", "RLev", "worst_pct", e, float(pS[sel].min()))
        add("report", "UR", "multi", "RLev", "worst_pct", e, float(pM[sel].min()))

    # FLAGS over in_scoring == 1
    for mode, D in (("single", S), ("multi", M)):
        add("report", "FLAGS", mode, "SCORING", "n_validated_ticks", "", int(((D["validated"] == "1").to_numpy() & insc).sum()))
        add("report", "FLAGS", mode, "SCORING", "n_hard_ticks", "", int(((D["hard_flag"] == "1").to_numpy() & insc).sum()))
        add("report", "FLAGS", mode, "SCORING", "n_soft_ticks", "", int(((D["soft_flag"] == "1").to_numpy() & insc).sum()))

    # VPT
    nv = n_val[insc]
    for k in range(int(nv.max()) + 1):
        add("report", "VPT", "multi", "SCORING", "n_ticks_with_nval", k, int((nv == k).sum()))

    # RESP
    lfv_arr = lfv
    for e in GATE_IDS:
        Ds, Dm, Ks, Km, fs, fm = RESP[e]
        add("report", "RESP", "single", "RLev", "D_h", e, Ds)
        add("report", "RESP", "multi", "RLev", "D_h", e, Dm)
        dde = 0.0 if (math.isinf(Ds) and math.isinf(Dm)) else Ds - Dm
        add("report", "RESP", "diff", "RLev", "dD_h", e, dde)
        add("report", "RESP", "single", "RLev", "K", e, Ks)
        add("report", "RESP", "multi", "RLev", "K", e, Km)
        add("report", "RESP", "single", "RLev", "D_t0_h", e, resp(pairsS, hardS, e, EV[e]["t0_ms"])[0])
        add("report", "RESP", "multi", "RLev", "D_t0_h", e, resp(pairsM, hardM, e, EV[e]["t0_ms"])[0])
    t0o = EV[OCT_ID]["t0_ms"]
    i_t0 = int(np.searchsorted(T, t0o))
    below = np.where((T < t0o) & ~np.isnan(lfv_arr) & (lfv_arr < 3000))[0]
    ref_i = int(below[-1]) + 1
    ref_ms = int(T[ref_i])
    add("report", "RESP", "single", "RLev", "D_lf3000_h", OCT_ID, resp(pairsS, hardS, OCT_ID, ref_ms)[0])
    add("report", "RESP", "multi", "RLev", "D_lf3000_h", OCT_ID, resp(pairsM, hardM, OCT_ID, ref_ms)[0])
    print("Oct LF3000 reference tick", S["tick_utc"].iloc[ref_i], "t0 index", i_t0)

    # BINM
    fbS = S["flow_bin"].to_numpy()
    fsS = S["flow_state"].to_numpy()
    fbM = M["flow_bin"].to_numpy()
    fsM = M["flow_state"].to_numpy()

    def binm(pairs, hard, fb, fs):
        tot = 0
        idxs = np.where(gate_rl)[0]
        for e in GATE_IDS:
            info = EV[e]
            ec = [(s, v) for s, v in pairs if int(T[s]) >= info["r_ms"] and int(T[v]) <= info["tend_ms"] and not hard[v]]
            for t in idxs[rl[idxs] == e]:
                tot += sum(1 for s, v in ec if v <= t and fb[s] == fb[t] and fs[s] == fs[t])
        return tot / len(idxs)
    add("report", "BINM", "single", "RL21", "mean_matched", "", binm(pairsS, hardS, fbS, fsS))
    add("report", "BINM", "multi", "RL21", "mean_matched", "", binm(pairsM, hardM, fbM, fsM))

    # REP_START (plan 16b)
    starts = {}
    for e in GATE_IDS:
        r_i = int(np.searchsorted(T, EV[e]["r_ms"]))
        assert T[r_i] == EV[e]["r_ms"]
        rl_idx = np.where(rl == e)[0]
        L = None
        for i in range(r_i, int(rl_idx.max()) + 1):
            if S["lf_view"].iloc[i] != "":
                L = lfv_arr[i]
                break
        starts[e] = L
        add("report", "REP_START", "both", "RL_lowstart" if (L is not None and L < 3000) else "RL_highstart",
            "start_lf", e, L)
    for nm, grp in (("RL_lowstart", [e for e in GATE_IDS if starts[e] is not None and starts[e] < 3000]),
                    ("RL_highstart", [e for e in GATE_IDS if starts[e] is not None and starts[e] >= 3000])):
        sel = scored & np.isin(rl, grp)
        add("report", "REP_START", "both", nm, "n_events", "", len(grp))
        add("report", "REP_START", "both", nm, "n_ticks", "", int(sel.sum()))
        add("report", "REP_START", "multi", nm, "mae_multi", "", mae(aM, sel))
        add("report", "REP_START", "single", nm, "mae_single", "", mae(aS, sel))
        add("report", "REP_START", "diff", nm, "gain", "", gain(sel) if sel.any() else None)
        add("report", "REP_START", "both", nm, "improved", "", int(sum(int(improved[e]) for e in grp)))

    write_csv()
    print("done", len(ROWS), "rows")


def self_check(assert_only=False):
    """List missing or duplicate required keys (plan section 10 + 16b)."""
    rows = list(csv.reader(open(OUT_CSV)))[1:]
    keys = [tuple(r[:6]) for r in rows]
    seen, dup = set(), []
    for k in keys:
        if k in seen:
            dup.append(k)
        seen.add(k)
    ev = pd.read_csv(F_EVENTS, dtype=str, keep_default_na=False)
    ev = ev[(ev["event_row"] == "1") & (ev["kept"] == "1")]
    G = [r for r in ev.loc[ev["event_class"] == "GATE", "event_id"]]
    req = []
    R = lambda *a: req.append(tuple(a))
    for c in ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "BAND"]:
        for st in ("n_checked", "n_fail", "pass"):
            R("check", c, "both", "all", st, "")
    R("check", "A6", "single", "all", "n_validations", "")
    R("check", "A7", "multi", "all", "n_validations", "")
    R("check", "A1", "both", "all", "n_in_scoring", "")
    R("check", "N3", "both", "NORM_T80", "t80_index", "2024-01-26T14:00:00.000Z")
    R("check", "PMECH", "both", "RL21", "median_dD_h", "")
    R("check", "PMECH", "single", "RL21", "sum_K", "")
    R("check", "PMECH", "multi", "RL21", "sum_K", "")
    R("check", "PMECH", "both", "RL21", "K_ratio", "")
    R("check", "PMECH", "both", "RL21", "pass", "")
    if not assert_only:
        g = "gate"
        def ci_rows(run, c, sub, mae_stat="mae", ci=True):
            R(run, c, "single", sub, mae_stat, ""); R(run, c, "multi", sub, mae_stat, "")
            R(run, c, "diff", sub, "point", "")
            if ci:
                R(run, c, "diff", sub, "ci_lo", ""); R(run, c, "diff", sub, "ci_hi", "")
        ci_rows(g, "R2", "RL21"); R(g, "R2", "both", "RL21", "n_ticks", ""); R(g, "R2", "both", "RL21", "pass", "")
        for e in G:
            R(g, "R3", "single", "RLev", "sum_abs", e); R(g, "R3", "multi", "RLev", "sum_abs", e); R(g, "R3", "diff", "RLev", "improved", e)
        R(g, "R3", "both", "RL21", "n_improved", ""); R(g, "R3", "both", "RL21", "pass", "")
        for c, sub in (("B1", "RL20"), ("B3", "RLH")):
            ci_rows(g, c, sub, ci=False); R(g, c, "both", sub, "n_ticks", ""); R(g, c, "both", sub, "pass", "")
        for e in G:
            R(g, "B2", "diff", "RLdrop", "point", e)
        R(g, "B2", "diff", "RLdrop", "min_point", ""); R(g, "B2", "both", "RLdrop", "pass", "")
        cells = {}
        for run, n1, n2 in (("gate", "N1", "N2"), ("edge", "N1_edge", "N2_edge")):
            ci_rows(run, n1, "NORM")
            for st in ("n_ticks", "n_res_used", "pass"):
                R(run, n1, "both", "NORM", st, "")
            cl = sorted(set(k[5] for k in keys if k[0] == run and k[1] == n2 and k[3] == "NORMcell" and k[5] != ""))
            cells[run] = cl
            for c in cl:
                R(run, n2, "both", "NORMcell", "n_ticks", c); R(run, n2, "single", "NORMcell", "mae", c)
                R(run, n2, "multi", "NORMcell", "mae", c); R(run, n2, "diff", "NORMcell", "point", c)
                R(run, n2, "diff", "NORMcell", "ci_lo", c); R(run, n2, "diff", "NORMcell", "ci_hi", c)
                R(run, n2, "both", "NORMcell", "n_res_dropped", c); R(run, n2, "both", "NORMcell", "cell_fail", c)
            for st in ("n_cells", "n_cells_failed", "pass"):
                R(run, n2, "both", "NORMcell", st, "")
        ci_rows(g, "N3", "NORM_T80", ci=False); R(g, "N3", "both", "NORM_T80", "n_ticks", ""); R(g, "N3", "both", "NORM_T80", "pass", "")
        ci_rows(g, "D1", "REC21", mae_stat="bias_pp")
        for st in ("n_ticks", "n_res_dropped", "pass"):
            R(g, "D1", "both", "REC21", st, "")
        for c, sub in (("C1", "NORM"), ("C2", "RL21"), ("C3", "REC21")):
            R(g, c, "single", sub, "cov", ""); R(g, c, "multi", sub, "cov", "")
            R(g, c, "both", sub, "n_ticks", ""); R(g, c, "both", sub, "pass", "")
        for c, sub in (("S1", "RL21"), ("S2", "REC21")):
            ci_rows(g, c, sub, mae_stat="share")
            R(g, c, "both", sub, "n_res_dropped", ""); R(g, c, "both", sub, "pass", "")
        R(g, "GATE", "both", "all", "n_rows_pass", ""); R(g, "GATE", "both", "all", "pass", "")
        r = "report"
        ci_rows(r, "U_R2", "RL21"); R(r, "U_R2", "both", "RL21", "n_ticks", ""); R(r, "U_R2", "both", "RL21", "pass", "")
        ci_rows(r, "U_D1", "REC21", mae_stat="bias_pp", ci=False)
        for c, sub in (("RLX", "RLX21"), ("F24", "F24_21"), ("STR", "RLstr15")):
            ci_rows(r, c, sub, ci=False)
        R(r, "STR", "both", "RLstr15", "n_improved", "")
        for e in G:
            R(r, "EV", "single", "RLev", "mae", e); R(r, "EV", "multi", "RLev", "mae", e)
            R(r, "EV", "diff", "RLev", "point", e); R(r, "EV", "both", "RLev", "n_ticks", e)
        for k in G + [""]:
            for sub in ("RLbefore", "RLafter"):
                R(r, "SPLIT", "single", sub, "mae", k); R(r, "SPLIT", "multi", sub, "mae", k); R(r, "SPLIT", "both", sub, "n_ticks", k)
        for sub in ("RL21", "REC21", "NORM"):
            for m in ("single", "multi"):
                R(r, "CAP", m, sub, "cap_rate", ""); R(r, "BIAS", m, sub, "mean_signed", "")
        for cc in ("cap_both", "cap_single_only", "cap_multi_only", "cap_neither"):
            R(r, "CAP4", "both", cc, "n_ticks", "")
            for m in ("single", "multi"):
                R(r, "CAP4", m, cc, "mae", ""); R(r, "CAP4", m, cc, "mean_signed", "")
        for c in cells["gate"]:
            R(r, "CELLCOV", "single", "NORMcell", "cov", c); R(r, "CELLCOV", "multi", "NORMcell", "cov", c)
        for m in ("single", "multi"):
            for sub in ("RL21", "REC21"):
                R(r, "UR", m, sub, "mean_signed_under", "")
            for e in G:
                R(r, "UR", m, "RLev", "worst_pct", e)
            for st in ("n_validated_ticks", "n_hard_ticks", "n_soft_ticks"):
                R(r, "FLAGS", m, "SCORING", st, "")
            for e in G:
                R(r, "RESP", m, "RLev", "D_h", e); R(r, "RESP", m, "RLev", "K", e); R(r, "RESP", m, "RLev", "D_t0_h", e)
            R(r, "RESP", m, "RLev", "D_lf3000_h", "53")
            R(r, "BINM", m, "RL21", "mean_matched", "")
        for e in G:
            R(r, "RESP", "diff", "RLev", "dD_h", e)
        vk = sorted(int(k[5]) for k in keys if k[1] == "VPT")
        if not vk or vk != list(range(vk[-1] + 1)) or "0" not in [k[5] for k in keys if k[1] == "VPT"]:
            req.append(("report", "VPT", "multi", "SCORING", "n_ticks_with_nval", "<contiguous 0..max>"))
        for sub in ("RL_lowstart", "RL_highstart"):
            R(r, "REP_START", "both", sub, "n_events", ""); R(r, "REP_START", "both", sub, "n_ticks", "")
            R(r, "REP_START", "multi", sub, "mae_multi", ""); R(r, "REP_START", "single", sub, "mae_single", "")
            R(r, "REP_START", "diff", sub, "gain", ""); R(r, "REP_START", "both", sub, "improved", "")
        sl = [k for k in keys if k[1] == "REP_START" and k[4] == "start_lf"]
        if sorted(k[5] for k in sl) != sorted(G):
            req.append(("report", "REP_START", "both", "RL_*start", "start_lf", "<one per GATE id>"))
    missing = [k for k in req if k not in seen]
    print("SELF-CHECK: required %d, present rows %d, missing %d, duplicate %d" % (len(req), len(keys), len(missing), len(dup)))
    for k in missing:
        print("  MISSING", k)
    for k in dup:
        print("  DUPLICATE", k)
    return len(missing) == 0 and len(dup) == 0


if __name__ == "__main__":
    main()
    if "--assert-only" not in sys.argv:
        sys.exit(0 if self_check() else 3)

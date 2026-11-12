#!/usr/bin/python3
"""Auditor check 6 (independent recomputation, own code) + P-MECH under both K_e readings
+ per-tick n_val comparison (analyst dumps vs third implementation vs my own reconstruction).
Reads base rows only. Writes a6_recompute.csv and a6_recompute.out.txt."""
import os, math, re, json
import numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__)); A6 = os.path.dirname(HERE)
BT = os.path.abspath(os.path.join(A6, "..", "rising-limb-travel-backtest"))
REPO = os.path.abspath(os.path.join(A6, "..", ".."))
COLS = ["tick_utc", "arm", "in_scoring", "mask", "has_pred", "normal", "rl_event", "rec_event", "truth", "disp", "unc",
        "ceiling_applied", "flow_bin", "flow_state", "base_flow_bin", "base_flow_state", "lf_view", "travel_gf_lf",
        "validated", "hard_flag", "slot"]
def base(path):
    parts = [c[c["arm"] == "base"] for c in pd.read_csv(path, usecols=COLS, dtype=str, keep_default_na=False, chunksize=250000)]
    return pd.concat(parts, ignore_index=True)
S = base(os.path.join(BT, "rising_limb_ticks.csv")); M = base(os.path.join(BT, "rising_limb_ticks_multi.csv"))
assert len(S) == len(M) == 130987 and (S.tick_utc.values == M.tick_utc.values).all()
for c in ["in_scoring", "mask", "has_pred", "normal", "rl_event", "rec_event", "truth", "lf_view", "travel_gf_lf", "base_flow_bin", "base_flow_state"]:
    assert (S[c].values == M[c].values).all(), c
N = len(S)
T = (pd.to_datetime(S.tick_utc, utc=True).astype("int64") // 10**6).to_numpy() if pd.to_datetime(S.tick_utc, utc=True).dtype.unit == "ns" else None
T = np.array([int(pd.Timestamp(x).value // 10**6) for x in S.tick_utc]) if T is None else T
assert (np.diff(T) == 3600000).all()
f = lambda s: np.array([float(x) if x != "" else np.nan for x in s])
mask = (S["mask"] == "1").to_numpy().copy()
d8 = np.where(S.tick_utc.to_numpy() == "2026-11-09T12:00:00.000Z")[0]; assert len(d8) == 1
mask_file = mask.copy(); mask[d8[0]] = False
insc = (S.in_scoring == "1").to_numpy(); hp = (S.has_pred == "1").to_numpy()
scored = insc & mask & hp; scored_edge = insc & mask_file & hp
truth = f(S.truth); dS = f(S.disp); dM = f(M.disp); uS = f(S.unc); uM = f(M.unc)
assert not np.isnan(truth[scored]).any() and not np.isnan(dS[scored]).any() and not np.isnan(dM[scored]).any()
eS = dS - truth; eM = dM - truth
lab = lambda col: np.array([int(x) if x else -1 for x in S[col]])
rl = lab("rl_event"); rec = lab("rec_event")
ev = pd.read_csv(os.path.join(BT, "rising_limb_events_python_v39.csv"), dtype=str, keep_default_na=False)
ev = ev[(ev.event_row == "1") & (ev.kept == "1")]
g = ev[ev.event_class == "GATE"].copy(); g["t0ms"] = [int(pd.Timestamp(x + "Z").value // 10**6) for x in g.event_t0]
g = g.sort_values("t0ms"); G = [int(x) for x in g.event_id]; assert len(G) == 21
EVT = {int(r.event_id): dict(r=int(pd.Timestamp(r.rl_start + "Z").value // 10**6), rl_end=int(pd.Timestamp(r.rl_end + "Z").value // 10**6),
       t0=int(pd.Timestamp(r.event_t0 + "Z").value // 10**6), tend=int(pd.Timestamp(r.event_tend + "Z").value // 10**6)) for r in g.itertuples()}
H = [47, 48, 49, 51]; OCT = 53
B = np.loadtxt(os.path.join(BT, "rising_limb_bootstrap_indices.csv"), delimiter=",", dtype=np.int64); assert B.shape == (10000, 21)
RES = []; LOG = []
def put(crit, mode, subset, stat, key, v): RES.append((crit, mode, subset, stat, key, v))
inRL = scored & np.isin(rl, G); inREC = scored & np.isin(rec, G)
# --- per-event sums
def evsum(x, sel, labarr): return np.array([x[sel & (labarr == e)].sum() for e in G])
SaS = evsum(np.abs(eS), inRL, rl); SaM = evsum(np.abs(eM), inRL, rl)
# R2
pt = 1 - SaM.sum() / SaS.sum()
gb = 1 - SaM[B].sum(1) / SaS[B].sum(1)
put("R2", "single", "RL21", "mae", "", np.abs(eS[inRL]).mean()); put("R2", "multi", "RL21", "mae", "", np.abs(eM[inRL]).mean())
put("R2", "diff", "RL21", "point", "", pt); put("R2", "diff", "RL21", "ci_lo", "", np.percentile(gb, 2.5)); put("R2", "diff", "RL21", "ci_hi", "", np.percentile(gb, 97.5))
put("R2", "both", "RL21", "n_ticks", "", int(inRL.sum()))
# R3
imp = SaM < SaS; put("R3", "both", "RL21", "n_improved", "", int(imp.sum()))
for e, a, b_, i in zip(G, SaS, SaM, imp): put("R3", "diff", "RLev", "improved", e, int(i))
# B1, B2, B3
idx = {e: k for k, e in enumerate(G)}
def gain_on(ids): k = [idx[e] for e in ids]; return 1 - SaM[k].sum() / SaS[k].sum()
put("B1", "diff", "RL20", "point", "", gain_on([e for e in G if e != OCT]))
drops = {e: gain_on([x for x in G if x != e]) for e in G}
put("B2", "diff", "RLdrop", "min_point", "", min(drops.values()))
put("B3", "diff", "RLH", "point", "", gain_on(H))
# Normal hours: N1, N2, N3 with month blocks
mlist = [l.strip().split(",")[1] for l in open(os.path.join(A6, "a6_month_list.csv"))]
MB = np.loadtxt(os.path.join(A6, "a6_month_block_indices.csv"), delimiter=",", dtype=np.int64)
month = np.array([x[:7] for x in S.tick_utc]); mpos = {m: i for i, m in enumerate(mlist)}
norm_all = (S.normal == "1").to_numpy()
def norm_block(sc, tag):
    nm = sc & norm_all
    mi = np.array([mpos.get(m, -1) for m in month])
    assert (mi[nm] >= 0).all()
    def msum(x, sel): return np.bincount(mi[sel], weights=x[sel], minlength=len(mlist))
    aS, aM = np.abs(eS), np.abs(eM)
    sS, sM = msum(aS, nm), msum(aM, nm)
    point = sM.sum() / sS.sum() - 1
    cS = sS[MB].sum(1); cM = sM[MB].sum(1); ok = cS > 0
    rb = cM[ok] / cS[ok] - 1
    put("N1" + tag, "diff", "NORM", "point", "", point); put("N1" + tag, "diff", "NORM", "ci_hi", "", np.percentile(rb, 97.5))
    put("N1" + tag, "diff", "NORM", "ci_lo", "", np.percentile(rb, 2.5)); put("N1" + tag, "both", "NORM", "n_ticks", "", int(nm.sum()))
    cells = {}
    cellkey = np.array([a + "|" + b for a, b in zip(S.base_flow_bin, S.base_flow_state)])
    nfail = 0
    for c in sorted(set(cellkey[nm])):
        sel = nm & (cellkey == c); n = int(sel.sum())
        if n < 200: continue
        sS_, sM_ = msum(aS, sel), msum(aM, sel)
        p = sM_.sum() / sS_.sum() - 1
        cS_ = sS_[MB].sum(1); cM_ = sM_[MB].sum(1); okc = cS_ > 0   # zero ticks => zero single sum
        rb_ = cM_[okc] / cS_[okc] - 1; lo = np.percentile(rb_, 2.5)
        fail = (p > 0.03 and lo > 0) or (p > 0.05 and n >= 2000)
        nfail += fail
        cells[c] = (n, p, lo, np.percentile(rb_, 97.5), int((~okc).sum()), int(fail))
        put("N2" + tag, "diff", "NORMcell", "point", c, p); put("N2" + tag, "diff", "NORMcell", "ci_lo", c, lo)
        put("N2" + tag, "both", "NORMcell", "cell_fail", c, int(fail)); put("N2" + tag, "both", "NORMcell", "n_ticks", c, n)
    put("N2" + tag, "both", "NORMcell", "n_cells", "", len(cells)); put("N2" + tag, "both", "NORMcell", "n_cells_failed", "", nfail)
    return nm, cells
nm, CELLS = norm_block(scored, ""); norm_block(scored_edge, "_edge")
t80 = int(pd.Timestamp("2024-01-26T14:00:00Z").value // 10**6)
assert t80 == int(pd.Timestamp("2012-12-01T00:00:00Z").value // 10**6) + (8 * 122208 // 10) * 3600000
n3 = nm & (T >= t80)
put("N3", "diff", "NORM_T80", "point", "", np.abs(eM[n3]).sum() / np.abs(eS[n3]).sum() - 1); put("N3", "both", "NORM_T80", "n_ticks", "", int(n3.sum()))
# D1
pS = 100 * eS / truth; pM = 100 * eM / truth
PS = evsum(pS, inREC, rec); PM = evsum(pM, inREC, rec); NR = np.array([int((inREC & (rec == e)).sum()) for e in G])
bS, bM = PS.sum() / NR.sum(), PM.sum() / NR.sum()
nb = NR[B].sum(1); okb = nb > 0
Db = np.abs(PM[B].sum(1)[okb] / nb[okb]) - np.abs(PS[B].sum(1)[okb] / nb[okb])
put("D1", "single", "REC21", "bias_pp", "", bS); put("D1", "multi", "REC21", "bias_pp", "", bM)
put("D1", "diff", "REC21", "point", "", abs(bM) - abs(bS)); put("D1", "diff", "REC21", "ci_lo", "", np.percentile(Db, 2.5))
put("D1", "diff", "REC21", "ci_hi", "", np.percentile(Db, 97.5)); put("D1", "both", "REC21", "n_ticks", "", int(NR.sum())); put("D1", "both", "REC21", "n_res_dropped", "", int((~okb).sum()))
# Coverage (own parse of ci-table.js)
js = open(os.path.join(REPO, "netlify", "functions", "shared", "ci-table.js")).read()
tab = {}
for m_ in re.finditer(r"'([0-9+\-]+)':\s*\{(.*?)\}\s*\}", js):
    tab[m_.group(1)] = {st: (int(a), int(b)) for st, a, b in re.findall(r"(\w+): \{ q05: (-?\d+), q95: (-?\d+) \}", m_.group(2) + "}")}
assert len(tab) == 6 and all(len(v) == 4 for v in tab.values()), tab
jsround = lambda x: math.floor(x + 0.5)
def covered(disp, D):
    out = np.zeros(N, dtype=bool)
    for i in np.where(scored)[0]:
        t = tab[D.flow_bin.iat[i]]; q05, q95 = t.get(D.flow_state.iat[i], t["all"])
        lo = max(0, jsround(disp[i] - q95)); hi = jsround(disp[i] - q05)
        out[i] = lo <= truth[i] <= hi
    return out
cvS = covered(dS, S); cvM = covered(dM, M)
for crit, sel, sub in [("C1", nm, "NORM"), ("C2", inRL, "RL21"), ("C3", inREC, "REC21")]:
    n = int(sel.sum()); cs = int(cvS[sel].sum()); cm = int(cvM[sel].sum())
    put(crit, "single", sub, "c", "", cs); put(crit, "multi", sub, "c", "", cm); put(crit, "both", sub, "n_ticks", "", n)
    if crit == "C1": ok = abs(100 * cm - 90 * n) <= max(4 * n, abs(100 * cs - 90 * n))
    else: ok = 100 * cm >= 100 * cs - 2 * n
    put(crit, "both", sub, "pass", "", int(ok))
# S1 / S2
urS = pS <= -15; urM = pM <= -15
for crit, sel, labarr, sub in [("S1", inRL, rl, "RL21"), ("S2", inREC, rec, "REC21")]:
    n = int(sel.sum()); US = int(urS[sel].sum()); UM = int(urM[sel].sum())
    uS_e = evsum(urS.astype(float), sel, labarr); uM_e = evsum(urM.astype(float), sel, labarr); n_e = np.array([int((sel & (labarr == e)).sum()) for e in G])
    nb = n_e[B].sum(1); okb = nb > 0
    db = (uM_e[B].sum(1)[okb] - uS_e[B].sum(1)[okb]) / nb[okb]
    put(crit, "both", sub, "U_single", "", US); put(crit, "both", sub, "U_multi", "", UM); put(crit, "both", sub, "n", "", n)
    put(crit, "diff", sub, "point", "", (UM - US) / n); put(crit, "diff", sub, "ci_lo", "", np.percentile(db, 2.5)); put(crit, "diff", sub, "ci_hi", "", np.percentile(db, 97.5))
    put(crit, "both", sub, "pass", "", int(100 * (UM - US) <= n and np.percentile(db, 97.5) <= 0.030))
# ---------------- own chain reconstruction (A6 single, A7 multi) and P-MECH under two K readings
lfv = f(S.lf_view); lfok = ~np.isnan(lfv) & (lfv >= 500) & (lfv <= 500000)
trav = f(S.travel_gf_lf)
valid_idx = np.where(lfok)[0]
def first_valid_due(s):
    due = math.trunc(int(T[s]) + trav[s] * 60 * 60 * 1000)
    k0 = s + 1 + max(0, -(-(due - int(T[s + 1 if s + 1 < N else s])) // 3600000)) if s + 1 < N else N
    # first tick index with T >= due and > s
    k = max(s + 1, int(math.ceil((due - int(T[0])) / 3600000)))
    while k < N and T[k] < due: k += 1
    j = np.searchsorted(valid_idx, k)
    if j >= len(valid_idx): return None, due
    return int(valid_idx[j]), due
pairsM = []
nval = np.zeros(N, dtype=np.int64)
for s in np.where(hp)[0]:
    v, due = first_valid_due(int(s))
    if v is not None and T[v] - due <= 9000000: pairsM.append((int(s), v)); nval[v] += 1
stored = np.where((S.slot == "stored").to_numpy())[0]
vS = np.where((S.validated == "1").to_numpy())[0]
pairsS = [(int(stored[np.searchsorted(stored, v) - 1]), int(v)) for v in vS]
hardS = (S.hard_flag == "1").to_numpy(); hardM = (M.hard_flag == "1").to_numpy()
LOG.append("own reconstruction: multi pairs %d, ticks with >=1 %d, equals file validated set: %s" %
           (len(pairsM), int((nval > 0).sum()), bool(((nval > 0) == (M.validated == "1").to_numpy()).all())))
LOG.append("single pairs %d; A8 every single pair in multi pairs: %s" % (len(pairsS), set(pairsS) <= set(pairsM)))
def resp(pairs, hard, e, reading):
    E = EVT[e]; first = None; K = 0
    for s, v in pairs:
        if T[s] >= E["r"] and T[v] <= E["tend"] and not hard[v]:
            first = v if first is None or v < first else first
            if reading == "label" and rl[v] == e: K += 1
            if reading == "time" and E["r"] <= T[v] <= E["rl_end"]: K += 1
    return (math.inf if first is None else (T[first] - E["r"]) / 3600000), K
for reading in ("label", "time"):
    dd = []; KS = KM = 0
    for e in G:
        Ds, ks = resp(pairsS, hardS, e, reading); Dm, km = resp(pairsM, hardM, e, reading)
        KS += ks; KM += km
        dd.append(0.0 if (math.isinf(Ds) and math.isinf(Dm)) else Ds - Dm)
        if reading == "label": put("RESP", "single", "RLev", "D_h", e, Ds); put("RESP", "multi", "RLev", "D_h", e, Dm); put("RESP", "single", "RLev", "K", e, ks); put("RESP", "multi", "RLev", "K", e, km)
    med = sorted(dd)[10]; ratio = math.inf if KS == 0 and KM > 0 else KM / KS
    put("PMECH_" + reading, "both", "RL21", "median_dD_h", "", med); put("PMECH_" + reading, "single", "RL21", "sum_K", "", KS)
    put("PMECH_" + reading, "multi", "RL21", "sum_K", "", KM); put("PMECH_" + reading, "both", "RL21", "K_ratio", "", ratio)
    put("PMECH_" + reading, "both", "RL21", "pass", "", int(med > 0 and ratio > 1.5))
# rl_end check: is the time window [r, rl_end] identical to the label set on all ticks?
mism = 0
for e in G:
    E = EVT[e]; tw = (T >= E["r"]) & (T <= E["rl_end"]); mism += int((tw != (rl == e)).sum())
LOG.append("ticks where RL time window [rl_start, rl_end] and rl_event label disagree (21 GATE events): %d" % mism)
# n_val comparison: third implementation, analyst dumps
tc = pd.read_csv(os.path.join(A6, "model_check_multi", "a6_multi_validation_counts.csv"), dtype=str)
assert (tc.tick_utc.values == S.tick_utc.values).all()
tn = tc.n_val.astype(int).to_numpy()
pyn = np.loadtxt(os.path.join(HERE, "py_copy", "py_nval_multi.txt"), dtype=np.int64)
rn = np.loadtxt(os.path.join(HERE, "r_copy", "r_nval_multi.txt"), dtype=np.int64)
LOG.append("per-tick multi n_val: third-impl vs python analyst differ at %d ticks; vs R analyst %d; vs auditor %d; totals %d/%d/%d/%d" %
           (int((tn != pyn).sum()), int((tn != rn).sum()), int((tn != nval).sum()), tn.sum(), pyn.sum(), rn.sum(), nval.sum()))
ts = pd.read_csv(os.path.join(A6, "model_check_multi", "a6_single_validation_counts.csv"), dtype=str).n_val.astype(int).to_numpy()
pys = np.loadtxt(os.path.join(HERE, "py_copy", "py_single_pairs.txt"), dtype=np.int64, delimiter=",")
rs = np.loadtxt(os.path.join(HERE, "r_copy", "r_single_pairs.txt"), dtype=np.int64, delimiter=",")
def cnt(vs, off=0):
    c = np.zeros(N, dtype=np.int64); np.add.at(c, vs - off, 1); return c
LOG.append("per-tick single n_val: third-impl vs python %d ticks differ; vs R (1-based) %d; vs auditor %d; R pairs (s,v) equal python pairs: %s" %
           (int((ts != cnt(pys[:, 1])).sum()), int((ts != cnt(rs[:, 1], 1)).sum()), int((ts != cnt(np.array([v for _, v in pairsS]))).sum()),
            bool(((rs - 1) == pys).all())))
tcM = tc.astype({c: int for c in tc.columns if c != "tick_utc"})
LOG.append("third-impl multi: hard validations at ticks where file hard_flag=0: %d; ticks with n_hard>0 and hard_flag=0: %d" %
           (int(tcM.n_hard[~hardM].sum()), int(((tcM.n_hard > 0) & ~hardM).sum())))
# event 51 (identical RL sums): cap status
sel51 = inRL & (rl == 51)
cS_ = (S.ceiling_applied == "1").to_numpy(); cM_ = (M.ceiling_applied == "1").to_numpy()
LOG.append("event 51 RL ticks %d, capped both %d, disp equal %d" % (int(sel51.sum()), int((sel51 & cS_ & cM_).sum()), int((dS[sel51] == dM[sel51]).sum())))
# base-only / differing columns check
diffcols = {}
for c in ["disp", "unc", "ceiling_applied", "flow_bin", "flow_state", "validated", "hard_flag", "slot"]:
    diffcols[c] = int((S[c].values != M[c].values).sum())
LOG.append("ticks differing between files by column (of those read): %s" % diffcols)
# under-read ticks on RL by cap cell, for context
out = pd.DataFrame(RES, columns=["criterion", "mode", "subset", "stat", "key", "value"])
out["value"] = [repr(float(v)) if isinstance(v, (float, np.floating)) else str(v) for v in out.value]
out.to_csv(os.path.join(HERE, "a6_recompute.csv"), index=False)
open(os.path.join(HERE, "a6_recompute.out.txt"), "w").write("\n".join(LOG) + "\n")
print("\n".join(LOG))

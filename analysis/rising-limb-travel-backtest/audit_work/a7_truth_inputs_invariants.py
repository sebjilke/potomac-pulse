"""Auditor checks 7 and 10 on the primary tick file, own code:
(a) model inputs lf_view/por_view equal the raw CSV at stamp t-1h / t-2h with <=3 h carry (no future read);
(b) truth equals the LF view at truth_tick_utc, truth tick is the first tick >= t+tau_ref or at most 2 later, every masked tick;
(c) common mask identical across arms; (d) cross-arm invariants visible in the tick file; (e) edge ticks with truth reads past the grid."""
import os, numpy as np, pandas as pd
D = os.path.dirname(os.path.abspath(__file__)); P = os.path.dirname(D)
raw = pd.read_csv(os.path.join(P,"hourly_backtest_data_v39.csv"))
raw["ts"] = pd.to_datetime(raw.timestamp, utc=True)
first = raw.ts.iloc[0]; n = int((raw.ts.iloc[-1]-first)/pd.Timedelta(hours=1))+1
idx = ((raw.ts-first)/pd.Timedelta(hours=1)).astype(int).values
def arr(c):
    a = np.full(n, np.nan); a[idx] = raw[c].values; return a
LF, POR = arr("lf_discharge"), arr("por_now")
def view(a, i, lag):
    for c in range(4):
        j = i-lag-c
        if 0 <= j < n and not np.isnan(a[j]): return a[j]
    return np.nan
cols = ["tick_utc","arm","mask","in_scoring","lf_view","por_view","tau_ref","truth","truth_tick_utc","truth_basehz_tick","truth_own_tick","raw","travel_gf_lf","travel_por_gf","b_active","delta_on","rl_event","rlx_event","rec_event","normal"]
t = pd.read_csv(os.path.join(P,"rising_limb_ticks.csv"), usecols=cols, dtype={"truth_tick_utc":str,"truth_basehz_tick":str,"truth_own_tick":str})
b = t[t.arm=="base"].reset_index(drop=True)
assert len(b)==n, (len(b), n)
lv = np.array([view(LF,i,1) for i in range(n)]); pv = np.array([view(POR,i,2) for i in range(n)])
def eqnan(x,y): return ((np.isnan(x)&np.isnan(y)) | (x==y))
print("lf_view equals CSV lag-1 view on all ticks:", eqnan(b.lf_view.values, lv).all())
print("por_view equals CSV lag-2 view on all ticks:", eqnan(b.por_view.values, pv).all())
# (b) truth
m = b[b["mask"]==1]
ti = ((pd.to_datetime(m.truth_tick_utc, utc=True)-first)/pd.Timedelta(hours=1)).round().astype(int).values
i0 = m.index.values
u0 = i0 + np.ceil(m.tau_ref.values - 1e-12).astype(int)
ok_off = (ti>=u0)&(ti<=u0+2)
lvx = np.array([view(LF,u,1) if u < n+1 else np.nan for u in ti])
print("masked ticks:", len(m), "truth tick within [first tick >= t+tau, +2]:", ok_off.all(), " truth == LF view at truth tick:", np.allclose(m.truth.values, lvx, equal_nan=False))
# first non-missing: no earlier candidate tick had a view
earlier_avail = [any(not np.isnan(view(LF,u,1)) for u in range(a_, c_)) for a_, c_ in zip(u0, ti)]
print("truth uses the first available tick (no earlier candidate had LF):", not any(earlier_avail))
print("truth tick strictly after the tick (no same-tick truth):", (ti > i0).all(), " min tau_ref:", m.tau_ref.min(), " max:", m.tau_ref.max())
# (c) mask common across arms
M = t.pivot(index="tick_utc", columns="arm", values="mask")
print("mask identical across arms:", (M.nunique(axis=1)==1).all())
# (d) invariants visible in the tick file
W = {a: t[t.arm==a].reset_index(drop=True) for a in ["base","A","B","C"]}
def same(x,y,sel): 
    xs, ys = x.raw[sel].values, y.raw[sel].values; return int(sel.sum()), int((~eqnan(xs.astype(float), ys.astype(float))).sum())
nb = W["base"].b_active==0
print("B raw == base raw where b_active==0 (checked, fail):", same(W["B"],W["base"], nb & W["base"].raw.notna()))
doff = (W["base"].delta_on!=1)
print("A raw == base raw where base delta off/no hist:", same(W["A"],W["base"], doff & W["base"].raw.notna()))
print("C raw == A raw where b_active==0:", same(W["C"],W["A"], nb & W["A"].raw.notna()))
print("C raw == B raw where B delta off:", same(W["C"],W["B"], (W["B"].delta_on!=1) & W["B"].raw.notna()))
for x,y in (("A","base"),("C","B")):
    s = W[y].travel_gf_lf.notna()
    print(f"{x} travel_gf_lf == {y}:", eqnan(W[x].travel_gf_lf[s].values, W[y].travel_gf_lf[s].values).all(), " travel_por_gf:", eqnan(W[x].travel_por_gf[s].values, W[y].travel_por_gf[s].values).all())
print("b_active equal across arms:", (W["A"].b_active.fillna(-1)==W["base"].b_active.fillna(-1)).all() and (W["B"].b_active.fillna(-1)==W["base"].b_active.fillna(-1)).all())
# (e) edge ticks
END = "2026-11-09T23:00:00.000Z"
for c in ["truth_tick_utc","truth_basehz_tick","truth_own_tick"]:
    e = t[t[c].notna() & (t[c] > END)]
    print(c, "after grid end:", sorted(set(zip(e.tick_utc, e.arm, e["mask"], e.rl_event.fillna(-1), e.rlx_event.fillna(-1), e.rec_event.fillna(-1), e.normal))))

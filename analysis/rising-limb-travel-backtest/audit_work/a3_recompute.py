"""Auditor check 3: independent recomputation of every gate criterion from the primary tick file, the frozen event file
and the bootstrap index files (TICK_SCHEMA rules 1-3, D-5 H6/H8/H14, D-8 override). Own code; reads no analyst code.
Usage: /usr/bin/python3 a3_recompute.py [ticks_csv]   (default: primary file). Writes a3_recompute_<name>.csv."""
import os, sys, numpy as np, pandas as pd
D = os.path.dirname(os.path.abspath(__file__)); P = os.path.dirname(D)
tf = sys.argv[1] if len(sys.argv) > 1 else os.path.join(P, "rising_limb_ticks.csv")
cols = ["tick_utc","arm","in_scoring","has_pred","raw","unc","disp","ceiling_applied","stop","base_rst","base_flow_bin","base_flow_state",
        "mask","truth","truth_tick_utc","truth_basehz","truth_own","rl_event","rlx_event","rec_event","normal","b_active","delta_on","travel_gf_lf"]
t = pd.read_csv(tf, usecols=cols, dtype={"rl_event":"Int64","rlx_event":"Int64","rec_event":"Int64","stop":str,"base_rst":str,
        "base_flow_bin":str,"base_flow_state":str,"truth_tick_utc":str})
ev = pd.read_csv(os.path.join(P,"rising_limb_events_python_v39.csv"), dtype=str, keep_default_na=False)
ev = ev[(ev.event_row=="1")]
G = ev[(ev.event_class=="GATE")&(ev.kept=="1")].sort_values("event_t0")
ids = [int(x) for x in G.event_id]; octid = [int(x) for x in G[G.oct=="1"].event_id]; nonoct = [i for i in ids if i not in octid]
H = [int(x) for x in G[G.holdout=="1"].event_id]
print("GATE kept", len(ids), "oct", octid, "nonOct", len(nonoct), "holdout", H)
# rules: burn-in, mask, D-8 override
EDGE = "2026-11-09T12:00:00.000Z"
n_edge = ((t.tick_utc==EDGE)&(t["mask"]==1)).sum()
print("D-8 tick rows with mask==1 in file:", n_edge, "its truth tick:", t.loc[t.tick_utc==EDGE,"truth_tick_utc"].iloc[0], "rl/rec labels:", t.loc[t.tick_utc==EDGE,["rl_event","rec_event","normal"]].iloc[0].tolist())
late = t[(t.truth_tick_utc.notna())&(t.truth_tick_utc > "2026-11-09T23:00:00.000Z")]
print("ticks with truth_tick after grid end:", late.tick_utc.unique().tolist())
t["m"] = (t.in_scoring==1)&(t["mask"]==1)
t_edge = t.copy()
t.loc[t.tick_utc==EDGE, "m"] = False
s = t[t.m].copy()
assert (s.has_pred==1).all(), "has_pred fails on mask"
for c in ["e_unc","e_raw","e_disp"]: pass
s["e_unc"] = s.unc - s.truth; s["e_raw"] = s.raw - s.truth; s["e_disp"] = s.disp - s.truth
W = {a: s[s.arm==a].set_index("tick_utc") for a in ["base","A","B","C"]}
for a in "ABC": assert W[a].index.equals(W["base"].index)
b = W["base"]
out = []
def put(crit, arm, stat, val): out.append((crit, arm, stat, val))
bootA = np.loadtxt(os.path.join(P,"rising_limb_bootstrap_indices.csv"), delimiter=",", dtype=int)
bootN = np.loadtxt(os.path.join(P,"rising_limb_bootstrap_indices_nonoct.csv"), delimiter=",", dtype=int)
q = lambda x, p: float(np.percentile(x, p))  # numpy default linear = R type 7
def evsums(df, win, col, evlist):
    g = df[df[win].isin(evlist)].groupby(win)[col]
    return g.apply(lambda x: x.abs().sum()).reindex(evlist).fillna(0).values, g.size().reindex(evlist).fillna(0).values
rl = lambda df, L: df[df.rl_event.isin(L)]
for a in "ABC":
    x = W[a]
    # G1a / G1b
    for crit, L, B, thr in (("G1a", ids, bootA, .15), ("G1b", nonoct, bootN, .10)):
        sa, _ = evsums(x, "rl_event", "e_unc", L); sb, n = evsums(b, "rl_event", "e_unc", L)
        g = 1 - sa.sum()/sb.sum(); bs = 1 - sa[B].sum(1)/sb[B].sum(1)
        lo, hi = q(bs, 2.5), q(bs, 97.5)
        put(crit,a,"gain",g); put(crit,a,"ci_lo",lo); put(crit,a,"ci_hi",hi); put(crit,a,"n_ticks",int(n.sum())); put(crit,a,"pass",int(g>=thr and lo>0))
    # G2
    sa, _ = evsums(x, "rl_event", "e_unc", ids); sb, _ = evsums(b, "rl_event", "e_unc", ids)
    imp = int((sa < sb).sum()); put("G2",a,"improved",imp); put("G2",a,"share",imp/len(ids)); put("G2",a,"pass",int(imp*100 >= 65*len(ids)))
    # G3a / G3b
    def recstats(df):
        r = df[df.rec_event.isin(ids)]; v = 100*r.e_raw/r.truth
        return v.groupby(r.rec_event).sum().reindex(ids).fillna(0).values, v.groupby(r.rec_event).size().reindex(ids).fillna(0).values
    va, na = recstats(x); vb, nb = recstats(b)
    ba, bb = va.sum()/na.sum(), vb.sum()/nb.sum(); d = abs(ba)-abs(bb)
    with np.errstate(invalid="ignore", divide="ignore"):
        bsd = np.abs(va[bootA].sum(1)/na[bootA].sum(1)) - np.abs(vb[bootA].sum(1)/nb[bootA].sum(1))
    nan_res = int(np.isnan(bsd).sum())
    lo, hi = np.nanpercentile(bsd, 2.5), np.nanpercentile(bsd, 97.5)
    put("G3a",a,"bias_arm",ba); put("G3a",a,"bias_base",bb); put("G3a",a,"d_bias",d); put("G3a",a,"ci_lo",lo); put("G3a",a,"ci_hi",hi); put("G3a",a,"n_ticks",int(na.sum())); put("G3a",a,"nan_resamples",nan_res)
    put("G3a",a,"pass",int(d<=0 and hi<=1.0)); put("G3b",a,"abs_bias_arm",abs(ba)); put("G3b",a,"pass",int(abs(ba)<=1.6))
    # G4a / G4b (and edge versions with file mask)
    for crit, df_b, df_a in (("G4a", b, x),):
        nb_ = df_b[df_b.normal==1]; na_ = df_a[df_a.normal==1]
        rc = na_.e_disp.abs().mean()/nb_.e_disp.abs().mean() - 1
        put("G4a",a,"rel_change",rc); put("G4a",a,"n_ticks",len(nb_)); put("G4a",a,"pass",int(rc<=0.02))
        cells = nb_.groupby(["base_flow_bin","base_flow_state"]).size(); cells = cells[cells>=200]
        worst = -9; wc = None
        for (fb, fs), _n in cells.items():
            mb = nb_[(nb_.base_flow_bin==fb)&(nb_.base_flow_state==fs)].e_disp.abs().mean()
            ma = na_[(na_.base_flow_bin==fb)&(na_.base_flow_state==fs)].e_disp.abs().mean()
            r_ = ma/mb-1
            if r_ > worst: worst, wc = r_, f"{fb}_{fs}"
        put("G4b",a,"n_cells",len(cells)); put("G4b",a,"worst_rel_change",worst); put("G4b",a,"worst_cell",wc); put("G4b",a,"pass",int(worst<=0.05))
    # G5 / G7e (rising = base_rst rising, on RL GATE ticks, mask)
    for nm, L in (("all", ids), ("nooct", nonoct)):
        ra, rb = rl(x, L), rl(b, L); ra = ra[ra.base_rst=="rising"]; rb = rb[rb.base_rst=="rising"]
        sha = (ra.stop=="max_iter").mean(); shb = (rb.stop=="max_iter").mean()
        put("G5",a,f"n_rising_{nm}",len(ra)); put("G5",a,f"share_arm_{nm}",sha); put("G5",a,f"share_base_{nm}",shb)
        if nm=="all":
            put("G7e",a,"share_arm",ra.stop.isin(["no_hist","hist_lost"]).mean()); put("G7e",a,"share_base",rb.stop.isin(["no_hist","hist_lost"]).mean())
    # G6a
    sa, _ = evsums(x, "rl_event", "e_unc", ids); sb, _ = evsums(b, "rl_event", "e_unc", ids)
    ok_i = True; ming_i = 9
    for k, e in enumerate(ids):
        keep = [j for j in range(len(ids)) if j != k]
        g = 1 - sa[keep].sum()/sb[keep].sum(); imp = int((sa[keep] < sb[keep]).sum())
        thr = .10 if e in octid else .15; ming_i = min(ming_i, g)
        ok_i &= (g >= thr) and imp*100 >= 65*len(keep)
    son, _ = evsums(x, "rl_event", "e_unc", nonoct); sbn, _ = evsums(b, "rl_event", "e_unc", nonoct)
    ok_ii = True; ming_ii = 9
    for k in range(len(nonoct)):
        keep = [j for j in range(len(nonoct)) if j != k]
        g = 1 - son[keep].sum()/sbn[keep].sum(); imp = int((son[keep] < sbn[keep]).sum()); ming_ii = min(ming_ii, g)
        ok_ii &= (g >= .10) and imp*100 >= 65*len(keep)
    put("G6a",a,"min_gain_i",ming_i); put("G6a",a,"min_gain_ii",ming_ii); put("G6a",a,"pass",int(ok_i and ok_ii))
    # G6b
    sh, _ = evsums(x, "rl_event", "e_unc", H); sbh, _ = evsums(b, "rl_event", "e_unc", H)
    g = 1 - sh.sum()/sbh.sum(); imp = int((sh < sbh).sum())
    put("G6b",a,"gain",g); put("G6b",a,"improved",imp); put("G6b",a,"pass",int(g>=.10 and imp*100>=65*len(H)))
    # G7a, G7b, G7c, G7f
    xa, xb = rl(x, ids), rl(b, ids)
    v = 1 - xa.e_raw.abs().mean()/xb.e_raw.abs().mean(); put("G7a",a,"value",v); put("G7a",a,"pass",int(v>0))
    v = 1 - (100*xa.e_unc.abs()/xa.truth).mean()/(100*xb.e_unc.abs()/xb.truth).mean(); put("G7b",a,"value",v); put("G7b",a,"pass",int(v>0))
    ca, cb = x[x.rlx_event.isin(ids)], b[b.rlx_event.isin(ids)]
    v = 1 - ca.e_unc.abs().mean()/cb.e_unc.abs().mean(); put("G7c",a,"value",v); put("G7c",a,"pass",int(v>=0))
    v = 1 - xa.e_disp.abs().mean()/xb.e_disp.abs().mean(); put("G7f",a,"value",v); put("G7f",a,"pass",int(v>=0))
    put("G7f",a,"cap_bind_arm",xa.ceiling_applied.mean()); put("G7f",a,"cap_bind_base",xb.ceiling_applied.mean())
    put("G7f",a,"mean_signed_unc_arm",xa.e_unc.mean()); put("G7f",a,"mean_signed_unc_base",xb.e_unc.mean())
    put("G7f",a,"mean_signed_disp_arm",xa.e_disp.mean()); put("G7f",a,"mean_signed_disp_base",xb.e_disp.mean())
    # G7d
    sel = xa.truth_basehz.notna() & xa.truth_own.notna() & xb.truth_basehz.notna()
    A_, B_ = xa[sel], xb[sel]
    gb = 1 - (A_.unc - A_.truth_basehz).abs().sum()/(B_.unc - B_.truth_basehz).abs().sum()
    go = 1 - (A_.unc - A_.truth_own).abs().sum()/(B_.unc - B_.truth_own).abs().sum()
    put("G7d",a,"gain_basehz",gb); put("G7d",a,"gain_own",go); put("G7d",a,"n_ticks",int(sel.sum())); put("G7d",a,"pass",int(gb>=0 and go>=0))
# P3 and G5 pass flags
o = b[b.rl_event.isin(octid)]; o = o[o.base_rst=="rising"]
put("P3","base","n_rising",len(o)); put("P3","base","n_nonconv",int((o.stop=="max_iter").sum())); put("P3","base","share",(o.stop=="max_iter").mean())
R = pd.DataFrame(out, columns=["criterion","arm","stat","value"])
name = os.path.basename(tf).replace(".csv","")
R.to_csv(os.path.join(D, f"a3_recompute_{name}.csv"), index=False)
pd.set_option("display.width",200); pd.set_option("display.max_rows",500)
print(R.to_string())
# G4a/G4b with the file mask as written (edge versions)
se = t_edge[t_edge.m].copy(); se["e_disp"] = se.disp - se.truth
for a in "ABC":
    nb_ = se[(se.arm=="base")&(se.normal==1)]; na_ = se[(se.arm==a)&(se.normal==1)]
    print("G4a_edge", a, na_.e_disp.abs().mean()/nb_.e_disp.abs().mean()-1, len(nb_))

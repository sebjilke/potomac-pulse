"""Auditor: builds the gate table (markdown) from BOTH metric files, primary run only, and checks every pass flag against the
plan section 5 threshold applied by the auditor to the analysts' values. Prints the table and any flag disagreement."""
import os, pandas as pd
P = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def load(f):
    d = pd.read_csv(os.path.join(P, f), keep_default_na=False); return d[(d.run=="primary")&(d.key=="")]
py, r = load("metrics_python/rising_limb_metrics_python.csv"), load("metrics_R/rising_limb_metrics_R.csv")
def g(d, c, a, s, sub=None):
    x = d[(d.criterion==c)&(d.arm==a)&(d.stat==s)]
    if sub is not None: x = x[x.subset==sub]
    assert len(x)==1, (c,a,s,sub,len(x)); return float(x.value.iloc[0])
pct = lambda v: f"{100*v:+.2f}%"
rows, bad = [], []
for a in "ABC":
    def both(fmt, c, s, sub=None): return fmt(g(py,c,a,s,sub)), fmt(g(r,c,a,s,sub))
    def flag(c, sub=None): return int(g(py,c,a,"pass",sub)), int(g(r,c,a,"pass",sub))
    def add(cid, desc, vals, thr, mine, pf):
        if pf[0]!=pf[1] or pf[0]!=int(mine): bad.append((cid,a,pf,mine))
        rows.append(f"| {cid} | {a} | {desc} | {vals[0]} | {vals[1]} | {thr} | {'pass' if mine else 'FAIL'} |")
    # G1a/G1b
    for c, thr in (("G1a",.15),("G1b",.10)):
        gp, lo = g(py,c,a,"gain"), g(py,c,a,"ci_lo")
        add(c, "gain [95% CI]", tuple(f"{pct(g(d,c,a,'gain'))} [{pct(g(d,c,a,'ci_lo'))}, {pct(g(d,c,a,'ci_hi'))}]" for d in (py,r)),
            f">= {int(thr*100)}% and CI lo > 0", gp>=thr and lo>0, flag(c))
    imp, n = g(py,"G2",a,"improved"), g(py,"G2",a,"n_events")
    add("G2", "improved / N", tuple(f"{int(g(d,'G2',a,'improved'))}/{int(g(d,'G2',a,'n_events'))} ({100*g(d,'G2',a,'share'):.1f}%)" for d in (py,r)), "improved x100 >= 65 x N", imp*100>=65*n, flag("G2"))
    db, hi = g(py,"G3a",a,"d_bias"), g(py,"G3a",a,"ci_hi")
    add("G3a", "D_bias pp [95% CI]", tuple(f"{g(d,'G3a',a,'d_bias'):+.3f} [{g(d,'G3a',a,'ci_lo'):+.3f}, {g(d,'G3a',a,'ci_hi'):+.3f}]" for d in (py,r)), "<= 0 and CI hi <= +1.0 pp", db<=0 and hi<=1.0, flag("G3a"))
    ab = g(py,"G3b",a,"abs_bias_arm")
    add("G3b", "abs bias pp", tuple(f"{g(d,'G3b',a,'abs_bias_arm'):.3f}" for d in (py,r)), "<= 1.6 pp", ab<=1.6, flag("G3b"))
    rc = g(py,"G4a",a,"rel_change")
    add("G4a", "rel change normal MAE", tuple(pct(g(d,'G4a',a,'rel_change')) for d in (py,r)), "<= +2%", rc<=0.02, flag("G4a"))
    wc = g(py,"G4b",a,"worst_rel_change")
    add("G4b", "worst cell rel change", tuple(f"{pct(g(d,'G4b',a,'worst_rel_change'))} ({int(g(d,'G4b',a,'n_cells'))} cells)" for d in (py,r)), "every cell <= +5%", wc<=0.05, flag("G4b"))
    if a in "BC":
        sa, sn = g(py,"G5a",a,"share","RL_rising_all"), g(py,"G5a",a,"share","RL_rising_nooct")
        add("G5a", "non-converged share all / noOct", tuple(f"{pct(g(d,'G5a',a,'share','RL_rising_all'))} / {pct(g(d,'G5a',a,'share','RL_rising_nooct'))}" for d in (py,r)), "< 5% in both", sa<.05 and sn<.05, flag("G5a",""))
    else:
        dd = py[(py.criterion=="G5b")&(py.arm=="A")&(py.stat=="diff")].value.astype(float)
        add("G5b", "share(A) - share(base) all / noOct", tuple(" / ".join(pct(v) for v in d[(d.criterion=='G5b')&(d.arm=='A')&(d.stat=='diff')].value.astype(float)) for d in (py,r)), "<= 0 in both", (dd<=0).all(), flag("G5b"))
    mi, mii = g(py,"G6a",a,"min_gain","LOEO_all"), g(py,"G6a",a,"min_gain","LOEO_nooct")
    add("G6a", "min LOEO gain (i) / (ii)", tuple(f"{pct(g(d,'G6a',a,'min_gain','LOEO_all'))} / {pct(g(d,'G6a',a,'min_gain','LOEO_nooct'))}" for d in (py,r)), "(i) >=15% (Oct drop 10%), (ii) >=10%, breadth >=65% every drop", bool(g(py,"G6a",a,"pass","")), flag("G6a",""))
    gh, ih = g(py,"G6b",a,"gain"), g(py,"G6b",a,"improved")
    add("G6b", "holdout gain, improved/4", tuple(f"{pct(g(d,'G6b',a,'gain'))}, {int(g(d,'G6b',a,'improved'))}/4" for d in (py,r)), ">= 10% and >= 65% (3 of 4)", gh>=.10 and ih*100>=65*4, flag("G6b"))
    for c, desc, thr, fn in (("G7a","raw MAE gain","> 0",lambda v: v>0),("G7b","MAPE gain","> 0",lambda v: v>0),("G7c","RLX gain",">= 0",lambda v: v>=0),("G7f","displayed-error gain",">= 0",lambda v: v>=0)):
        v = g(py,c,a,"value"); add(c, desc, tuple(pct(g(d,c,a,'value')) for d in (py,r)), thr, fn(v), flag(c))
        if c=="G7c":
            b_, o_ = g(py,"G7d",a,"gain_basehz"), g(py,"G7d",a,"gain_own")
            add("G7d","gain base hz / own hz", tuple(f"{pct(g(d,'G7d',a,'gain_basehz'))} / {pct(g(d,'G7d',a,'gain_own'))}" for d in (py,r)), "both >= 0", b_>=0 and o_>=0, flag("G7d"))
            sa_, sb_ = g(py,"G7e",a,"share_arm"), g(py,"G7e",a,"share_base")
            add("G7e","lookup-fail share arm / base", tuple(f"{pct(g(d,'G7e',a,'share_arm'))} / {pct(g(d,'G7e',a,'share_base'))}" for d in (py,r)), "not above base", sa_<=sb_, flag("G7e"))
print("| Id | Arm | Quantity | Python | R | Threshold | Auditor |\n|---|---|---|---|---|---|---|")
print("\n".join(rows))
print("\nflag disagreements (analyst flags vs auditor's threshold test):", bad)

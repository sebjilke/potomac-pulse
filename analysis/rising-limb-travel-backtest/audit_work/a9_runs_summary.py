"""Auditor: per-run (primary decides; S2, S3, multi report-only) summary of headline values and failed criteria, from the Python
metrics file (identical to R within 1e-10, see a2). Also lists every pass flag of the primary run per criterion and arm."""
import os, pandas as pd
P = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = pd.read_csv(os.path.join(P,"metrics_python/rising_limb_metrics_python.csv"), keep_default_na=False)
d = d[d.key==""]
def v(run, c, a, s, sub=None):
    x = d[(d.run==run)&(d.criterion==c)&(d.arm==a)&(d.stat==s)]
    if sub: x = x[x.subset==sub]
    return x.value.iloc[0] if len(x) else None
crit = ["G1a","G1b","G2","G3a","G3b","G4a","G4b","G5a","G5b","G6a","G6b","G7a","G7b","G7c","G7d","G7e","G7f"]
for run in ["primary","S2","S3","multi"]:
    for a in "ABC":
        fails = []
        for c in crit:
            x = d[(d.run==run)&(d.criterion==c)&(d.arm==a)&(d.stat=="pass")]
            if len(x) and (x.value==0).any(): fails.append(c)
        print(f"{run:8s} {a} G1a={v(run,'G1a',a,'gain'):.4f} G1b={v(run,'G1b',a,'gain'):.4f} G2={v(run,'G2',a,'share'):.3f} G4a={v(run,'G4a',a,'rel_change'):+.4f} "
              f"G4b_worst={v(run,'G4b',a,'worst_rel_change'):+.4f} G7f={v(run,'G7f',a,'value'):+.4f} all_pass={int(v(run,'ARM',a,'all_pass'))} failed={fails}")
print(d[(d.run=="primary")&(d.stat=="pass")][["criterion","arm","subset","value"]].to_string())

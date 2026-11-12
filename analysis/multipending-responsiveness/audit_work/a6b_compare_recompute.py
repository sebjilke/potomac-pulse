#!/usr/bin/python3
"""Compare auditor recomputation (a6_recompute.csv) with both analysts' rows where the key maps directly."""
import os, csv, math
HERE = os.path.dirname(os.path.abspath(__file__)); A6 = os.path.dirname(HERE)
def load(p, has_run=True):
    d = {}
    for r in csv.DictReader(open(p)):
        d[(r["criterion"], r["mode"], r["subset"], r["stat"], r["key"]) if not has_run else (r["run"], r["criterion"], r["mode"], r["subset"], r["stat"], r["key"])] = r["value"]
    return d
P = load(os.path.join(A6, "metrics_python", "a6_metrics_python.csv")); R = load(os.path.join(A6, "metrics_R", "a6_metrics_R.csv"))
A = load(os.path.join(HERE, "a6_recompute.csv"), False)
def num(v): return math.inf if v == "Inf" else float(v)
lines = []; worst = 0.0
for (c, m, sub, st, key), v in sorted(A.items()):
    run, crit = "gate", c
    if c.endswith("_edge"): run = "edge"
    if c == "RESP": run = "report"
    if c.startswith("PMECH"):
        if c != "PMECH_label": continue
        run, crit = "check", "PMECH"
    k = (run, crit, m, sub, st, key)
    if k not in P:
        continue
    a, p, r = num(v), num(P[k]), num(R[k])
    d = max(abs(a - p) if not (math.isinf(a) or math.isinf(p)) else (0 if a == p else math.inf),
            abs(a - r) if not (math.isinf(a) or math.isinf(r)) else (0 if a == r else math.inf))
    worst = max(worst, d)
    lines.append("%s\tauditor=%s\tpy=%s\tR=%s\tmaxdiff=%.3g" % ("|".join(k), v, P[k], R[k], d))
lines.insert(0, "rows compared %d, worst abs diff %.3g" % (len(lines), worst))
open(os.path.join(HERE, "a6b_compare_recompute.out.txt"), "w").write("\n".join(lines) + "\n"); print("\n".join(lines))

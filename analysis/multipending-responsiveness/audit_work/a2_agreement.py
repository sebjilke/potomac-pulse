#!/usr/bin/python3
"""Auditor check 2: Python vs R row-by-row agreement on (run, criterion, mode, subset, stat, key)."""
import os, math, csv
HERE = os.path.dirname(os.path.abspath(__file__)); A6 = os.path.dirname(HERE)
def load(p):
    d = {}; dup = []
    with open(p, newline="") as f:
        for r in csv.DictReader(f):
            k = (r["run"], r["criterion"], r["mode"], r["subset"], r["stat"], r["key"])
            if k in d: dup.append(k)
            d[k] = r["value"]
    return d, dup
P, dp = load(os.path.join(A6, "metrics_python", "a6_metrics_python.csv"))
R, dr = load(os.path.join(A6, "metrics_R", "a6_metrics_R.csv"))
def num(v):
    if v in ("NA", ""): return None
    if v == "Inf": return math.inf
    if v == "-Inf": return -math.inf
    return float(v)
COUNT_STATS = {"n_checked","n_fail","pass","n_validations","n_in_scoring","t80_index","sum_K","n_ticks","n_improved",
               "improved","n_res_used","n_res_dropped","cell_fail","n_cells","n_cells_failed","n_rows_pass","K",
               "n_validated_ticks","n_hard_ticks","n_soft_ticks","n_ticks_with_nval","n_events"}
HOUR_STATS = {"median_dD_h","D_h","dD_h","D_t0_h","D_lf3000_h"}
CFS_STATS = {"mae","sum_abs","mean_signed","mean_signed_under","mae_multi","mae_single","mae_diff","start_lf"}
def tol(k):
    st = k[4]
    if st in COUNT_STATS or st in HOUR_STATS: return 0.0
    if st in CFS_STATS: return 0.01
    return 1e-6   # fractions, pp, gains, ratios, cov, share, point, ci
rows = []; nexact = 0
for k in sorted(set(P) & set(R)):
    a, b = num(P[k]), num(R[k])
    if a is None or b is None:
        ok = (a is None and b is None); d = None if ok else "NA-mismatch"
    elif math.isinf(a) or math.isinf(b):
        ok = a == b; d = 0 if ok else "inf-mismatch"
    else:
        d = abs(a - b); ok = d <= tol(k)
    if not ok: rows.append(("DIVERGE", k, P[k], R[k], d))
    else: nexact += 1
maxdiff = {}
for k in set(P) & set(R):
    a, b = num(P[k]), num(R[k])
    if a is not None and b is not None and not (math.isinf(a) or math.isinf(b)):
        t = k[0]; maxdiff[t] = max(maxdiff.get(t, 0.0), abs(a - b))
with open(os.path.join(HERE, "a2_agreement.out.txt"), "w") as fo:
    def w(s): print(s); fo.write(s + "\n")
    w("python rows %d, R rows %d, dup python %d, dup R %d, common %d, agree %d, diverge %d" %
      (len(P), len(R), len(dp), len(dr), len(set(P) & set(R)), nexact, len(rows)))
    w("max abs diff on agreeing numeric rows by run: %r" % maxdiff)
    for r in rows: w("%s\t%s\tpy=%s\tR=%s\tdiff=%s" % r)
    w("--- only in python")
    for k in sorted(set(P) - set(R)): w("%s\t%s" % ("|".join(k), P[k]))
    w("--- only in R")
    for k in sorted(set(R) - set(P)): w("%s\t%s" % ("|".join(k), R[k]))

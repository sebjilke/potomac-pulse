#!/usr/bin/python3
"""Auditor check 7: gate arithmetic from both analysts' values, re-deciding each row from the section 7
threshold text, with margins (row's own unit) and narrow flags. Writes a7_gate_table.md and a7_gate_table.csv."""
import os, csv, math
HERE = os.path.dirname(os.path.abspath(__file__)); A6 = os.path.dirname(HERE)
def load(p): return {(r["run"], r["criterion"], r["mode"], r["subset"], r["stat"], r["key"]): r["value"] for r in csv.DictReader(open(p))}
P = load(os.path.join(A6, "metrics_python", "a6_metrics_python.csv")); R = load(os.path.join(A6, "metrics_R", "a6_metrics_R.csv"))
A = {(r["criterion"], r["mode"], r["subset"], r["stat"], r["key"]): float(r["value"]) for r in csv.DictReader(open(os.path.join(HERE, "a6_recompute.csv")))}
def g(D, c, m, s, st, k="", run="gate"): return float(D[(run, c, m, s, st, k)])
rows = []
def row(id_, grp, pyv, rv, thr, conds, file_pass_py, file_pass_r):
    # conds: list of (label, ok, margin, unit)  margin>0 means on the passing side
    ok = all(c[1] for c in conds)
    narrow = ok and any(c[2] < 1.0 for c in conds)
    rows.append(dict(id=id_, group=grp, python=pyv, R=rv, threshold=thr, auditor_pass=int(ok),
                     python_flag=int(file_pass_py), R_flag=int(file_pass_r),
                     margins="; ".join("%s %s %.4g %s" % (c[0], "ok" if c[1] else "FAILS", c[2], c[3]) for c in conds),
                     narrow="narrow" if narrow else ""))
for D, tag in ((P, "py"), (R, "R")): pass
def both(c, m, s, st, k="", run="gate"): return g(P, c, m, s, st, k, run), g(R, c, m, s, st, k, run)
flag = lambda c, s: (g(P, c, "both", s, "pass"), g(R, c, "both", s, "pass"))
fmt = lambda a, b: ("%.10g" % a, "%.10g" % b)
# R2
pp, pr = both("R2", "diff", "RL21", "point"); lp, lr = both("R2", "diff", "RL21", "ci_lo")
row("R2", "deciding", "point %.6f; CI lo %.6f" % (pp, lp), "point %.6f; CI lo %.6f" % (pr, lr), "point >= 0.05 AND CI lo > 0",
    [("point", pp >= 0.05, (pp - 0.05) / 0.01, "pp"), ("CI lo", lp > 0, lp / 0.01, "pp")], *flag("R2", "RL21"))
ni = both("R3", "both", "RL21", "n_improved")
row("R3", "deciding", "%d of 21" % ni[0], "%d of 21" % ni[1], ">= 14 of 21 (100*imp >= 65*21)", [("events", 100 * ni[0] >= 65 * 21, ni[0] - 14, "events")], *flag("R3", "RL21"))
b1 = both("B1", "diff", "RL20", "point")
row("B1", "deciding", "%.6f" % b1[0], "%.6f" % b1[1], "point > 0", [("point", b1[0] > 0, b1[0] / 0.01, "pp")], *flag("B1", "RL20"))
ids = [k[5] for k in P if k[:5] == ("gate", "B2", "diff", "RLdrop", "point")]
drops_p = {i: g(P, "B2", "diff", "RLdrop", "point", i) for i in ids}; drops_r = {i: g(R, "B2", "diff", "RLdrop", "point", i) for i in ids}
npos = sum(v > 0 for v in drops_p.values())
row("B2", "robustness", "min %.6f (drop %s); max %.6f; %d of 21 drops > 0" % (min(drops_p.values()), min(drops_p, key=drops_p.get), max(drops_p.values()), npos),
    "min %.6f; max %.6f" % (min(drops_r.values()), max(drops_r.values())), "every drop point > 0",
    [("min drop", min(drops_p.values()) > 0, min(drops_p.values()) / 0.01, "pp")], *flag("B2", "RLdrop"))
b3 = both("B3", "diff", "RLH", "point")
row("B3", "robustness", "%.6f" % b3[0], "%.6f" % b3[1], "point > 0", [("point", b3[0] > 0, b3[0] / 0.01, "pp")], *flag("B3", "RLH"))
n1 = both("N1", "diff", "NORM", "point"); n1h = both("N1", "diff", "NORM", "ci_hi")
row("N1", "guard", "point %.6f; CI hi %.6f" % (n1[0], n1h[0]), "point %.6f; CI hi %.6f" % (n1[1], n1h[1]), "point <= 0.01 AND CI hi <= 0.02",
    [("point", n1[0] <= 0.01, (0.01 - n1[0]) / 0.01, "pp"), ("CI hi", n1h[0] <= 0.02, (0.02 - n1h[0]) / 0.01, "pp")], *flag("N1", "NORM"))
cells = sorted(k[5] for k in P if k[:5] == ("gate", "N2", "both", "NORMcell", "n_ticks"))
conds = []; failed = []
for c in cells:
    n = g(P, "N2", "both", "NORMcell", "n_ticks", c); p = g(P, "N2", "diff", "NORMcell", "point", c); lo = g(P, "N2", "diff", "NORMcell", "ci_lo", c)
    f1 = p > 0.03 and lo > 0; f2 = p > 0.05 and n >= 2000
    if f1 or f2: failed.append("%s (n %d, point %.4f, CI lo %.4f, %s)" % (c, n, p, lo, "+".join(x for x, y in (("cond1", f1), ("cond2", f2)) if y)))
    # margin of a passing cell: distance to the nearer failing condition (point to 0.03 if lo>0, else lo to 0; and point to 0.05 if n>=2000)
    m1 = max((0.03 - p) / 0.01, -lo / 0.01) if True else None
    m2 = (0.05 - p) / 0.01 if n >= 2000 else math.inf
    conds.append((c, not (f1 or f2), min(m1, m2), "pp"))
nf = both("N2", "both", "NORMcell", "n_cells_failed")
passing_narrow = [c[0] for c in conds if c[1] and c[2] < 1.0]
rows.append(dict(id="N2", group="guard", python="%d of %d cells fail" % (nf[0], len(cells)), R="%d of %d cells fail" % (nf[1], len(cells)),
                 threshold="cell fails if (point > 0.03 AND CI lo > 0) OR (point > 0.05 AND n >= 2000)", auditor_pass=int(not failed),
                 python_flag=int(g(P, "N2", "both", "NORMcell", "pass")), R_flag=int(g(R, "N2", "both", "NORMcell", "pass")),
                 margins="failed: " + "; ".join(failed) + ". Passing cells within 1 pp of a fail condition: " + (", ".join(passing_narrow) or "none"), narrow=""))
n3 = both("N3", "diff", "NORM_T80", "point")
row("N3", "guard", "%.6f" % n3[0], "%.6f" % n3[1], "point <= 0.02", [("point", n3[0] <= 0.02, (0.02 - n3[0]) / 0.01, "pp")], *flag("N3", "NORM_T80"))
d1 = both("D1", "diff", "REC21", "point"); d1h = both("D1", "diff", "REC21", "ci_hi")
row("D1", "guard", "point %.4f pp; CI hi %.4f pp" % (d1[0], d1h[0]), "point %.4f pp; CI hi %.4f pp" % (d1[1], d1h[1]), "point <= +0.5 pp AND CI hi <= +1.0 pp",
    [("point", d1[0] <= 0.5, (0.5 - d1[0]) / 1.0, "x 1.0 pp"), ("CI hi", d1h[0] <= 1.0, (1.0 - d1h[0]) / 1.0, "x 1.0 pp")], *flag("D1", "REC21"))
for cid, sub, src in (("C1", "NORM", "NORM"), ("C2", "RL21", "RL21"), ("C3", "REC21", "REC21")):
    n = int(A[(cid, "both", sub, "n_ticks", "")]); cs = int(A[(cid, "single", sub, "c", "")]); cm = int(A[(cid, "multi", sub, "c", "")])
    covp = (g(P, cid, "single", src, "cov"), g(P, cid, "multi", src, "cov")); covr = (g(R, cid, "single", src, "cov"), g(R, cid, "multi", src, "cov"))
    assert abs(covp[0] - cs / n) < 1e-12 and abs(covp[1] - cm / n) < 1e-12
    if cid == "C1":
        lhs = abs(100 * cm - 90 * n); rhs = max(4 * n, abs(100 * cs - 90 * n)); ok = lhs <= rhs; marg = (rhs - lhs) / n
        thr = "|100 c_m - 90 n| <= max(4 n, |100 c_s - 90 n|)"
        extra = " (|miss| multi %.3f pp vs allowed %.3f pp)" % (lhs / n, rhs / n)
    else:
        ok = 100 * cm >= 100 * cs - 2 * n; marg = (100 * cm - (100 * cs - 2 * n)) / n; thr = "100 c_m >= 100 c_s - 2 n"; extra = ""
    row(cid, "guard", "single %.6f (%d/%d), multi %.6f (%d)%s" % (covp[0], cs, n, covp[1], cm, extra), "single %.6f, multi %.6f" % covr, thr,
        [("coverage", ok, marg, "pp")], *flag(cid, sub))
for sid, sub in (("S1", "RL21"), ("S2", "REC21")):
    n = int(A[(sid, "both", sub, "n", "")]); US = int(A[(sid, "both", sub, "U_single", "")]); UM = int(A[(sid, "both", sub, "U_multi", "")])
    pp_ = both(sid, "diff", sub, "point"); hi = both(sid, "diff", sub, "ci_hi")
    assert abs(pp_[0] - (UM - US) / n) < 1e-12
    row(sid, "guard", "point %.6f (U_s %d, U_m %d, n %d); CI hi %.6f" % (pp_[0], US, UM, n, hi[0]), "point %.6f; CI hi %.6f" % (pp_[1], hi[1]),
        "100 (U_m - U_s) <= n AND CI hi <= 0.030",
        [("point", 100 * (UM - US) <= n, (n - 100 * (UM - US)) / n, "pp"), ("CI hi", hi[0] <= 0.030, (0.030 - hi[0]) / 0.01, "pp")], *flag(sid, sub))
with open(os.path.join(HERE, "a7_gate_table.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
md = ["| Row | Group | Python | R | Threshold | Pass | File flags py/R | Margins (positive = passing side) | Narrow |", "|---|---|---|---|---|---|---|---|---|"]
for r in rows:
    md.append("| %s | %s | %s | %s | %s | %s | %d/%d | %s | %s |" % (r["id"], r["group"], r["python"], r["R"], r["threshold"], "PASS" if r["auditor_pass"] else "FAIL", r["python_flag"], r["R_flag"], r["margins"], r["narrow"]))
md.append(""); md.append("Rows passing: %d of %d. Auditor decision equals both file flags on every row: %s" %
          (sum(r["auditor_pass"] for r in rows), len(rows), all(r["auditor_pass"] == r["python_flag"] == r["R_flag"] for r in rows)))
open(os.path.join(HERE, "a7_gate_table.md"), "w").write("\n".join(md) + "\n"); print("\n".join(md))

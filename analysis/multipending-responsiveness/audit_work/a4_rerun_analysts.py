#!/usr/bin/python3
"""Auditor checks 4 and 5: run COPIES of both analyst scripts (output paths redirected into audit_work)
 (a) --assert-only, (b) full run, compare CSV sha256 with the committed outputs,
 (c) a dump variant that writes the per-tick reconstructed n_val (multi) and single validation ticks
     right after A7 and exits; compared later with the third implementation."""
import os, subprocess, hashlib, sys
HERE = os.path.dirname(os.path.abspath(__file__)); A6 = os.path.dirname(HERE)
PY = os.path.join(A6, "metrics_python", "a6_metrics_python.py"); RS = os.path.join(A6, "metrics_R", "a6_metrics_R.R")
def sha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()
out = []
# ---- python copies
pyd = os.path.join(HERE, "py_copy"); os.makedirs(pyd, exist_ok=True)
src = open(PY).read()
old = 'A6DIR = os.path.normpath(os.path.join(HERE, ".."))'; assert src.count(old) == 1
src = src.replace(old, "A6DIR = %r" % A6)
open(os.path.join(pyd, "a6_metrics_python.py"), "w").write(src)
anchor = "    recon = n_val > 0\n"; assert src.count(anchor) == 1
dump = src.replace(anchor, anchor + "    np.savetxt(os.path.join(HERE, 'py_nval_multi.txt'), n_val, fmt='%d')\n"
                   "    np.savetxt(os.path.join(HERE, 'py_single_pairs.txt'), np.array(pairsS, dtype=np.int64), fmt='%d', delimiter=',')\n"
                   "    sys.exit(0)\n")
open(os.path.join(pyd, "a6_metrics_python_dump.py"), "w").write(dump)
# ---- R copies
rd = os.path.join(HERE, "r_copy"); os.makedirs(rd, exist_ok=True)
rs = open(RS).read()
old = 'OUTD <- file.path(A6D, "metrics_R")'; assert rs.count(old) == 1
rs = rs.replace(old, 'OUTD <- %s' % ('"' + rd + '"'))
open(os.path.join(rd, "a6_metrics_R.R"), "w").write(rs)
anchor = "n_val <- tabulate(pairs_m$v, nbins = N_TICKS)\n"; assert rs.count(anchor) == 1
rdump = rs.replace(anchor, anchor + 'writeLines(as.character(n_val), file.path(OUTD, "r_nval_multi.txt")); '
                   'write.table(pairs_s, file.path(OUTD, "r_single_pairs.txt"), sep=",", row.names=FALSE, col.names=FALSE); quit(status = 0)\n')
open(os.path.join(rd, "a6_metrics_R_dump.R"), "w").write(rdump)
which = sys.argv[1:] or ["assert", "full", "dump"]
if "assert" in which:
    r = subprocess.run(["/usr/bin/python3", "a6_metrics_python.py", "--assert-only"], cwd=pyd, capture_output=True, text=True)
    open(os.path.join(HERE, "a4_py_assert_only.log"), "w").write(r.stdout + r.stderr); out.append("py assert-only exit %d" % r.returncode)
    r = subprocess.run(["Rscript", "a6_metrics_R.R", "--assert-only"], cwd=rd, capture_output=True, text=True)
    open(os.path.join(HERE, "a4_r_assert_only.log"), "w").write(r.stdout + r.stderr); out.append("R assert-only exit %d" % r.returncode)
if "full" in which:
    r = subprocess.run(["/usr/bin/python3", "a6_metrics_python.py"], cwd=pyd, capture_output=True, text=True)
    out.append("py full exit %d; csv %s" % (r.returncode, "IDENTICAL" if sha(os.path.join(pyd, "a6_metrics_python.csv")) == sha(os.path.join(A6, "metrics_python", "a6_metrics_python.csv")) else "DIFFERENT"))
    r = subprocess.run(["Rscript", "a6_metrics_R.R"], cwd=rd, capture_output=True, text=True)
    out.append("R full exit %d; csv %s" % (r.returncode, "IDENTICAL" if sha(os.path.join(rd, "a6_metrics_R.csv")) == sha(os.path.join(A6, "metrics_R", "a6_metrics_R.csv")) else "DIFFERENT"))
if "dump" in which:
    r = subprocess.run(["/usr/bin/python3", "a6_metrics_python_dump.py"], cwd=pyd, capture_output=True, text=True); out.append("py dump exit %d" % r.returncode)
    r = subprocess.run(["Rscript", "a6_metrics_R_dump.R"], cwd=rd, capture_output=True, text=True); out.append("R dump exit %d %s" % (r.returncode, r.stderr[-300:]))
open(os.path.join(HERE, "a4_rerun_analysts.out.txt"), "a").write("\n".join(out) + "\n"); print("\n".join(out))

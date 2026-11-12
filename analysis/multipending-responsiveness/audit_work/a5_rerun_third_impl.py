#!/usr/bin/python3
"""Auditor check 5: rerun the third implementation from a copy (BT path patched only) and compare outputs by sha256."""
import os, subprocess, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); A6 = os.path.dirname(HERE)
MC = os.path.join(A6, "model_check_multi"); OUT = os.path.join(HERE, "mc_rerun"); os.makedirs(OUT, exist_ok=True)
BT = os.path.abspath(os.path.join(A6, "..", "rising-limb-travel-backtest"))
src = open(os.path.join(MC, "a6_multi_model_check_python.py")).read()
old = "BT = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'rising-limb-travel-backtest')"
assert src.count(old) == 1
open(os.path.join(OUT, "a6_multi_model_check_python.py"), "w").write(src.replace(old, "BT = %r" % BT))
r = subprocess.run(["/usr/bin/python3", "a6_multi_model_check_python.py"], cwd=OUT, capture_output=True, text=True)
def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()
with open(os.path.join(HERE, "a5_rerun_third_impl.out.txt"), "w") as fo:
    fo.write("exit %d\n" % r.returncode)
    for f in ["a6_multi_model_check.csv", "a6_multi_validation_counts.csv", "a6_single_validation_counts.csv", "a6_totals.json"]:
        a, b = sha(os.path.join(MC, f)), sha(os.path.join(OUT, f))
        fo.write("%s\t%s\n" % (f, "IDENTICAL" if a == b else "DIFFERENT %s %s" % (a, b)))
print(open(os.path.join(HERE, "a5_rerun_third_impl.out.txt")).read())

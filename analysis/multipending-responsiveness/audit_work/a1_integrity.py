#!/usr/bin/python3
"""Auditor check 1: sha256 of all inputs, and regeneration of the month-block files
from a COPY of make_month_block_indices.py (written into audit_work/regen/)."""
import hashlib, os, subprocess, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__))
A6 = os.path.dirname(HERE)
BT = os.path.join(A6, "..", "rising-limb-travel-backtest")
def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()
expected = {
 os.path.join(BT, "rising_limb_ticks.csv"): "8d841145905de1f6b6d217835c65229862ec6e115f33823c9472ffcfbfca0a6f",
 os.path.join(BT, "rising_limb_ticks_multi.csv"): "c99c4b56e3ae3edc47cda561a7322174d6797709e509ea63f8e0106e17064778",
 os.path.join(BT, "rising_limb_events_python_v39.csv"): "978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44",
 os.path.join(BT, "rising_limb_bootstrap_indices.csv"): "7eff92a751fd9cc0c6f8e0220998e98788cc2f293b5437088bf9376e1dd96519",
 os.path.join(BT, "rising_limb_run_log.json"): "f5622d46f5a7f86deaa6fe49505da24112820b7319a344c9a13bfa456173164e",
 os.path.join(A6, "a6_month_list.csv"): "c647b7e820b1eb81e2d3c0198146e031b95dee51532ef001b32da8cbbc78b6cb",
 os.path.join(A6, "a6_month_block_indices.csv"): "bfce274c4aa0b72713dc4e38bd0a9245e13c0907987210b8beff04e056aba8a9",
 os.path.join(A6, "make_month_block_indices.py"): "2f634ee36872fa216e4556b7264a6066073722a0f22539a350dcf65c2b6dcb53",
}
out = []
for p, e in expected.items():
    s = sha(p); out.append((os.path.basename(p), s == e, s))
for line in open(os.path.join(A6, "STEP_2_3_OUTPUTS.sha256.txt")):
    e, rel = line.split()
    s = sha(os.path.join(A6, rel)); out.append((rel, s == e, s))
# regenerate month blocks from a copy whose HERE points at regen/, BT patched to the real folder
regen = os.path.join(HERE, "regen"); os.makedirs(regen, exist_ok=True)
src = open(os.path.join(A6, "make_month_block_indices.py")).read()
src = src.replace('BT = os.path.join(HERE, "..", "rising-limb-travel-backtest")',
                  'BT = %r' % os.path.abspath(BT))
assert os.path.abspath(BT) in src
open(os.path.join(regen, "make_month_block_indices_copy.py"), "w").write(src)
r = subprocess.run(["/usr/bin/python3", os.path.join(regen, "make_month_block_indices_copy.py")], capture_output=True, text=True)
out.append(("regen stdout", r.returncode == 0, r.stdout.strip()))
for f, e in [("a6_month_list.csv", expected[os.path.join(A6, "a6_month_list.csv")]),
             ("a6_month_block_indices.csv", expected[os.path.join(A6, "a6_month_block_indices.csv")])]:
    s = sha(os.path.join(regen, f)); out.append(("regen " + f, s == e, s))
with open(os.path.join(HERE, "a1_integrity.out.txt"), "w") as fo:
    for r_ in out:
        line = "%s\t%s\t%s" % (r_[0], "MATCH" if r_[1] else "MISMATCH", r_[2]); print(line); fo.write(line + "\n")

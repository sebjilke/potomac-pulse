#!/usr/bin/env python3
"""Bootstrap index matrices (plan section 4, Uncertainty / M4). Needs numpy (run with /usr/bin/python3 here).
Reads the event list written by rising_limb_event_list.py; N = kept GATE events (incl. October), N_nonOct = kept
GATE events without the October flag. Events are sorted by t0; indices are 0-based positions in that order,
files have NO header, 10,000 rows x N columns:
  numpy.random.default_rng(20261110).integers(0, N, size=(10000, N))
  numpy.random.default_rng(20261110).integers(0, N_nonOct, size=(10000, N_nonOct))
Usage: make_bootstrap_indices.py <events_csv>   (writes rising_limb_bootstrap_indices[_nonoct].csv + .sha256.txt)"""
import csv, hashlib, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
R = [r for r in csv.DictReader(open(sys.argv[1])) if r["event_row"] == "1" and r["event_class"] == "GATE" and r["kept"] == "1"]
R.sort(key=lambda r: r["event_t0"])
N, NN = len(R), sum(1 for r in R if r["oct"] != "1")
log = [f"numpy {np.__version__}; events file {os.path.basename(sys.argv[1])} sha256 {hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest()}",
       f"N={N} N_nonOct={NN}; event order (t0): " + ", ".join(r["event_t0"][:10] for r in R)]
for name, n in (("rising_limb_bootstrap_indices.csv", N), ("rising_limb_bootstrap_indices_nonoct.csv", NN)):
    m = np.random.default_rng(20261110).integers(0, n, size=(10000, n))
    p = os.path.join(HERE, name)
    np.savetxt(p, m, fmt="%d", delimiter=",")
    log.append(f"{name}: shape {m.shape}, sha256 {hashlib.sha256(open(p,'rb').read()).hexdigest()}")
open(os.path.join(HERE, "rising_limb_bootstrap_indices.sha256.txt"), "w").write("\n".join(log) + "\n")
print("\n".join(log))

"""Auditor check 1: regenerate both bootstrap index matrices from the seeds into audit_work/ and compare sha256."""
import csv, hashlib, os, sys
import numpy as np
D = os.path.dirname(os.path.abspath(__file__)); P = os.path.dirname(D)
ev = [r for r in csv.DictReader(open(os.path.join(P, "rising_limb_events_python_v39.csv"))) if r["event_row"]=="1" and r["event_class"]=="GATE" and r["kept"]=="1"]
N = len(ev); NN = sum(r["oct"]!="1" for r in ev)
print("numpy", np.__version__, "N", N, "N_nonOct", NN)
for name, n in (("rising_limb_bootstrap_indices.csv", N), ("rising_limb_bootstrap_indices_nonoct.csv", NN)):
    m = np.random.default_rng(20261110).integers(0, n, size=(10000, n))
    out = os.path.join(D, "regen_" + name); np.savetxt(out, m, fmt="%d", delimiter=",")
    a = hashlib.sha256(open(out,"rb").read()).hexdigest(); b = hashlib.sha256(open(os.path.join(P,name),"rb").read()).hexdigest()
    print(name, m.shape, a, "MATCH" if a==b else "MISMATCH " + b)

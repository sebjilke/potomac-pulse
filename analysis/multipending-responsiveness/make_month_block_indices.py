#!/usr/bin/python3
"""A6 month-block bootstrap indices (plan section 6). Results-blind: reads only
tick_utc, arm, in_scoring, mask, normal, has_pred of base rows of the single tick file."""
import hashlib, os, re, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.join(HERE, "..", "rising-limb-travel-backtest")
TICKS = os.path.join(BT, "rising_limb_ticks.csv")
MANIFEST = os.path.join(BT, "GATE_RUN_MANIFEST.txt")
COLS = ["tick_utc", "arm", "in_scoring", "mask", "normal", "has_pred"]
D8_TICK = "2026-11-09T12:00Z"

def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()

expected = None
for line in open(MANIFEST):
    parts = line.split()
    if len(parts) >= 3 and parts[2] == "rising_limb_ticks.csv":
        expected = parts[0]
        break
if expected is None or sha(TICKS) != expected:
    sys.exit("STOP: tick file sha256 mismatch or not in manifest")

chunks = []
for ch in pd.read_csv(TICKS, usecols=COLS, dtype=str, keep_default_na=False, chunksize=100000):
    chunks.append(ch[ch["arm"] == "base"])
df = pd.concat(chunks, ignore_index=True)
n_base = len(df)

# D-8 override: mask 0 at 2026-11-09T12:00Z (match on normalised timestamp text)
is_d8 = pd.to_datetime(df["tick_utc"], utc=True) == pd.Timestamp("2026-11-09T12:00:00Z")
assert is_d8.sum() == 1, "D-8 tick not found exactly once"
mask = df["mask"].where(~is_d8, "0")

scored = (df["in_scoring"] == "1") & (mask == "1") & (df["has_pred"] == "1") & (df["normal"] == "1")
n_scored = int(scored.sum())
months = pd.to_datetime(df.loc[scored, "tick_utc"], utc=True).dt.strftime("%Y-%m")
month_list = sorted(set(months))
M = len(month_list)
assert M <= 168

with open(os.path.join(HERE, "a6_month_list.csv"), "w", newline="") as f:
    for i, m in enumerate(month_list):
        f.write("%d,%s\n" % (i, m))
rng = np.random.default_rng(20261115)
idx = rng.integers(0, M, size=(10000, M))
np.savetxt(os.path.join(HERE, "a6_month_block_indices.csv"), idx, fmt="%d", delimiter=",")
print(n_base, n_scored, M, month_list[0], month_list[-1], idx.shape, int(is_d8.sum()))

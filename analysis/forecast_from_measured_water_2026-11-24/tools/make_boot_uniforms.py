#!/usr/bin/env python3
"""Shared resampling numbers for the block bootstrap (ANALYSIS_SPEC.md, section 9).

Writes tools/boot_uniforms.csv next to this script: header u1..u175, then 10,000 rows. Every cell is a
12-digit zero-padded INTEGER n in 0 .. 999999999999 (it stands for the uniform number n / 10**12).
Integers are used so that Python and R turn a draw into a block index with exact arithmetic and cannot
disagree through decimal parsing: block index (0-based) = (n * B) // 10**12, B = number of blocks
(B <= 175). n * B < 1.75e14 < 2**53, so the product is exact in R doubles too.

Seed 20261124 (Mersenne Twister, Python's random.Random). One row per resample, one column per draw.
A rerun reproduces the file byte for byte on any Python 3. Standard library only.
Written by the specification writer on 2026-11-24, before any result existed. The generator needs
only the number of resamples and the maximum number of blocks; it reads no data.

Usage (from the study folder):  python3 -I tools/make_boot_uniforms.py
"""
import os
import random

SEED = 20261124
ROWS = 10000
COLS = 175
SCALE = 10 ** 12

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "boot_uniforms.csv")


def main():
    rng = random.Random(SEED)
    with open(OUT, "w", newline="\n") as f:
        f.write(",".join("u%d" % k for k in range(1, COLS + 1)) + "\n")
        for _ in range(ROWS):
            f.write(",".join("%012d" % rng.randrange(SCALE) for _ in range(COLS)) + "\n")
    print("wrote %s: %d rows x %d columns, seed %d" % (OUT, ROWS, COLS, SEED))


if __name__ == "__main__":
    main()

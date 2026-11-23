#!/usr/bin/env python3
"""Shared resampling numbers for the day-block intervals (ANALYSIS_SPEC_COMMON.md, section 4).

Writes data/tidy/boot_uniforms.csv: 2,000 rows, columns u1..u120, numbers in [0, 1) with 12
decimals. Both languages read the same decimals, so floor(u * D) is identical in Python and R.
Fixed seed; a rerun reproduces the file byte for byte. Written by the orchestrator on 2026-11-23,
before any study result existed.

Usage (from the study folder):  python3 -I tools/08_make_boot_uniforms.py
"""
import os
import random

SEED = 20261123
ROWS = 2000
COLS = 120

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "tidy", "boot_uniforms.csv")


def main():
    rng = random.Random(SEED)
    with open(OUT, "w", newline="\n") as f:
        f.write(",".join(f"u{k}" for k in range(1, COLS + 1)) + "\n")
        for _ in range(ROWS):
            row = []
            for _ in range(COLS):
                u = rng.random()
                s = f"{u:.12f}"
                if s.startswith("1."):          # guard against rounding up to 1.0
                    s = "0.999999999999"
                row.append(s)
            f.write(",".join(row) + "\n")
    print(f"wrote {OUT}: {ROWS} rows x {COLS} columns, seed {SEED}")


if __name__ == "__main__":
    main()

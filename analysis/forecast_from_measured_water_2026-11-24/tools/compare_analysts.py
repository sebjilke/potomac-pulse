#!/usr/bin/env python3
"""Mechanical comparison of the two blind analysts' output files (ANALYSIS_SPEC.md, section 12, version 1.1).

Usage (from the study folder):  python3 -I tools/compare_analysts.py PY_DIR R_DIR [--max N]

Required on both sides: metrics.csv, counts.csv, intervals.csv, verdicts.csv, q4.csv, checks.csv, forecasts_A.csv
(missing on either side, or on both, is a difference). forecasts_B.csv is compared if present on either side.
Both folders must exist and be non-empty. Per file: header, row keys, ORDER of the key sequence, text fields,
numeric fields (difference above 0.01 is a difference). Two numbers within 0.01 with the same SHAPE (same
number of decimals) agree whatever their digits; if the shape differs (different number of decimals, or a decimal point on one side only,
e.g. 7 against 7.000000) it is a FORMAT mismatch: printed, counted separately, and also gives DIFFER.
At most N lines per file are printed (default 200; 0 = no limit). Last line AGREE or DIFFER. Exit status 0 only
for AGREE; 1 for DIFFER; 2 for wrong usage. Nothing else is printed or interpreted. Standard library only.
"""
import csv
import os
import sys

TOL = 0.01
REQUIRED = [
    ("metrics.csv", 6, False),
    ("counts.csv", 3, False),
    ("intervals.csv", 6, False),
    ("verdicts.csv", 1, False),
    ("q4.csv", 1, False),
    ("checks.csv", 2, False),
    ("forecasts_A.csv", 3, True),
]
OPTIONAL = [("forecasts_B.csv", 3, True)]


def num(s):
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    if v != v or v in (float("inf"), float("-inf")):
        return None
    return v


def shape(t):
    """Number of decimals (0 if no decimal point); other notations (exponent etc.) get their own shape."""
    t = t.strip()
    body = t[1:] if t[:1] in "+-" else t
    parts = body.split(".")
    if all(p.isdigit() or p == "" for p in parts) and len(parts) <= 2 and body != ".":
        return len(parts[1]) if len(parts) == 2 else -1
    return "other:" + t


class Out:
    def __init__(self, limit):
        self.limit = limit
        self.total = 0      # differences (incl. format)
        self.fmt = 0
        self.printed = 0

    def line(self, fname, msg):
        self.total += 1
        if self.limit == 0 or self.printed < self.limit:
            self.printed += 1
            print("%s: %s" % (fname, msg))


def cmp_fields(fname, header, ra, rb, out, key):
    for j, col in enumerate(header):
        a = ra[j] if j < len(ra) else None
        b = rb[j] if j < len(rb) else None
        if a == b and a is not None:
            continue
        x, y = num(a), num(b)
        if a is not None and b is not None and x is not None and y is not None and abs(x - y) <= TOL:
            if shape(a) != shape(b):
                out.fmt += 1
                out.line(fname, "FORMAT key=%s col=%s py=%r r=%r" % ("|".join(key), col, a, b))
            # same shape and within 0.01: agree, whatever the digits
        else:
            out.line(fname, "key=%s col=%s py=%r r=%r" % ("|".join(key), col, a, b))
    if len(ra) != len(header) or len(rb) != len(header):
        out.line(fname, "key=%s wrong field count py=%d r=%d" % ("|".join(key), len(ra), len(rb)))


def read_all(path):
    with open(path, newline="") as f:
        return list(csv.reader(f))


def compare_small(fname, pa, pb, nkey, out):
    A, B = read_all(pa), read_all(pb)
    if not A or not B or A[0] != B[0]:
        out.line(fname, "header differs: py=%s r=%s" % (A[0] if A else None, B[0] if B else None))
        return
    header = A[0]
    ka = [tuple(r[:nkey]) for r in A[1:]]
    kb = [tuple(r[:nkey]) for r in B[1:]]
    for k_, side in ((ka, "py"), (kb, "r")):
        if len(set(k_)) != len(k_):
            out.line(fname, "duplicate row keys on %s side" % side)
    da, db = dict(zip(ka, A[1:])), dict(zip(kb, B[1:]))
    for k in ka:
        if k not in db:
            out.line(fname, "key only in py: %s" % "|".join(k))
    for k in kb:
        if k not in da:
            out.line(fname, "key only in r: %s" % "|".join(k))
    common_a = [k for k in ka if k in db]
    common_b = [k for k in kb if k in da]
    if common_a != common_b:
        i = next((n for n, (x, y) in enumerate(zip(common_a, common_b)) if x != y), 0)
        out.line(fname, "row ORDER differs (first at common row %d: py=%s r=%s)" % (
            i + 1, "|".join(common_a[i]), "|".join(common_b[i])))
    for k in common_a:
        cmp_fields(fname, header, da[k], db[k], out, k)


def compare_stream(fname, pa, pb, nkey, out):
    with open(pa, newline="") as fa, open(pb, newline="") as fb:
        ra, rb = csv.reader(fa), csv.reader(fb)
        ha, hb = next(ra, None), next(rb, None)
        if ha != hb:
            out.line(fname, "header differs: py=%s r=%s" % (ha, hb))
            return
        i = 0
        while True:
            a, b = next(ra, None), next(rb, None)
            if a is None and b is None:
                break
            i += 1
            if a is None:
                out.line(fname, "row %d only in r: %s" % (i, "|".join(b[:nkey])))
            elif b is None:
                out.line(fname, "row %d only in py: %s" % (i, "|".join(a[:nkey])))
            elif a[:nkey] != b[:nkey]:
                out.line(fname, "row %d key/order differs: py=%s r=%s" % (i, "|".join(a[:nkey]), "|".join(b[:nkey])))
            elif a != b:
                cmp_fields(fname, ha, a, b, out, a[:nkey])


def main(argv):
    args = list(argv[1:])
    limit = 200
    if "--max" in args:
        k = args.index("--max")
        try:
            limit = int(args[k + 1])
        except (IndexError, ValueError):
            print("usage: compare_analysts.py PY_DIR R_DIR [--max N]")
            return 2
        del args[k:k + 2]
    if len(args) != 2:
        print("usage: compare_analysts.py PY_DIR R_DIR [--max N]")
        return 2
    dirs = args
    total = 0
    fmt = 0
    bad_dir = False
    for d, side in zip(dirs, ("py", "r")):
        if not os.path.isdir(d):
            print("folder %s does not exist: %s" % (side, d))
            bad_dir = True
        elif not os.listdir(d):
            print("folder %s is empty: %s" % (side, d))
            bad_dir = True
    if bad_dir:
        print("DIFFER")
        return 1
    todo = [(f, n, b, True) for f, n, b in REQUIRED] + [(f, n, b, False) for f, n, b in OPTIONAL]
    for fname, nkey, big, required in todo:
        pa, pb = os.path.join(dirs[0], fname), os.path.join(dirs[1], fname)
        ea, eb = os.path.isfile(pa), os.path.isfile(pb)
        out = Out(limit)
        if not ea and not eb:
            if required:
                out.line(fname, "required file missing on both sides")
        elif ea != eb:
            out.line(fname, "file only in %s" % ("py" if ea else "r"))
        elif big:
            compare_stream(fname, pa, pb, nkey, out)
        else:
            compare_small(fname, pa, pb, nkey, out)
        if out.total > out.printed:
            print("%s: ... and %d more differences not printed" % (fname, out.total - out.printed))
        total += out.total
        fmt += out.fmt
    if fmt:
        print("format mismatches (also counted as differences): %d" % fmt)
    print("DIFFER" if total else "AGREE")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

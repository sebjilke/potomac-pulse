#!/usr/bin/env python3
"""Cell-by-cell comparison of two blind analysts' outputs (Python against R) for one part.

Rule (ANALYSIS_SPEC_COMMON.md, section 5): text, timestamps, counts and labels must be equal;
numbers must agree within 0.01 in the unit of the column, and within 0.0001 for ratios and
correlations. This tool reports, per table: whether the columns are the same, which row keys
exist on one side only, how many cells differ beyond 0.01, how many differ beyond 0.0001, the
largest difference per column, and the first differing cells. It decides nothing.

Usage (from the study folder):
    python3 -I tools/09_compare_analysts.py py_R r_R COMPARE_R.txt
    python3 -I tools/09_compare_analysts.py py_W r_W COMPARE_W.txt
Written by the orchestrator on 2026-11-23, before any analyst's output was opened.
"""
import csv
import os
import sys

TOL = 0.01
TOL_FINE = 0.0001
MAX_LIST = 25


def read(path):
    with open(path, newline="") as f:
        rows = list(csv.reader(f))
    if not rows:
        return [], []
    return rows[0], rows[1:]


def num(s):
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    if v != v or v in (float("inf"), float("-inf")):
        return None
    return v


def norm_key(s):
    s = (s or "").strip()
    v = num(s)
    if v is not None:
        return f"{v:.6f}".rstrip("0").rstrip(".")
    low = s.lower()
    if low in ("true", "false"):
        return "1" if low == "true" else "0"
    return s


def norm_text(s):
    s = (s or "").strip()
    if s in ("NA", "NaN", "nan", "NULL"):
        return ""
    low = s.lower()
    if low in ("true", "false"):
        return "1" if low == "true" else "0"
    return s


def key_columns(header, rows):
    """Smallest leading set of columns whose values identify every row."""
    for n in range(1, len(header) + 1):
        seen = set()
        ok = True
        for r in rows:
            k = tuple(norm_key(c) for c in r[:n])
            if k in seen:
                ok = False
                break
            seen.add(k)
        if ok:
            return n
    return len(header)


def compare_table(name, pa, pb, out):
    ha, ra = read(pa)
    hb, rb = read(pb)
    out.append(f"\n=== {name} ===")
    out.append(f"rows: A {len(ra)}  B {len(rb)}")
    if ha != hb:
        out.append("COLUMNS DIFFER")
        out.append(f"  only in A: {[c for c in ha if c not in hb]}")
        out.append(f"  only in B: {[c for c in hb if c not in ha]}")
        if [c for c in ha if c in hb] != [c for c in hb if c in ha]:
            out.append("  (shared columns are in a different order)")
    shared = [c for c in ha if c in hb]
    if not shared:
        return {"table": name, "status": "no shared columns"}
    ia = [ha.index(c) for c in shared]
    ib = [hb.index(c) for c in shared]
    A = [[r[i] if i < len(r) else "" for i in ia] for r in ra]
    B = [[r[i] if i < len(r) else "" for i in ib] for r in rb]
    nk = max(key_columns(shared, A) if A else 1, key_columns(shared, B) if B else 1)
    out.append(f"key columns: {shared[:nk]}")
    da = {tuple(norm_key(c) for c in r[:nk]): r for r in A}
    db = {tuple(norm_key(c) for c in r[:nk]): r for r in B}
    only_a = [k for k in da if k not in db]
    only_b = [k for k in db if k not in da]
    if only_a:
        out.append(f"keys only in A: {len(only_a)}  e.g. {only_a[:5]}")
    if only_b:
        out.append(f"keys only in B: {len(only_b)}  e.g. {only_b[:5]}")
    n_cells = n_bad = n_fine = n_text = n_blank = 0
    maxdiff = {}
    listed = []
    for k in da:
        if k not in db:
            continue
        for j in range(nk, len(shared)):
            a, b = norm_text(da[k][j]), norm_text(db[k][j])
            n_cells += 1
            if a == "" and b == "":
                continue
            if (a == "") != (b == ""):
                n_blank += 1
                if len(listed) < MAX_LIST:
                    listed.append(f"  blank on one side  {k}  {shared[j]}: A='{a}' B='{b}'")
                continue
            va, vb = num(a), num(b)
            if va is not None and vb is not None:
                d = abs(va - vb)
                if d > maxdiff.get(shared[j], 0.0):
                    maxdiff[shared[j]] = d
                if d > TOL:
                    n_bad += 1
                    if len(listed) < MAX_LIST:
                        listed.append(f"  number  {k}  {shared[j]}: A={a} B={b} diff={d:.6g}")
                elif d > TOL_FINE:
                    n_fine += 1
            elif a != b:
                n_text += 1
                if len(listed) < MAX_LIST:
                    listed.append(f"  text    {k}  {shared[j]}: A='{a}' B='{b}'")
    out.append(f"cells compared: {n_cells}; numbers beyond {TOL}: {n_bad}; "
               f"numbers between {TOL_FINE} and {TOL}: {n_fine}; text differences: {n_text}; "
               f"blank on one side: {n_blank}")
    big = sorted(((d, c) for c, d in maxdiff.items() if d > TOL_FINE), reverse=True)[:12]
    if big:
        out.append("largest difference per column (beyond 0.0001): "
                   + ", ".join(f"{c}={d:.6g}" for d, c in big))
    out.extend(listed)
    clean = (ha == hb and not only_a and not only_b and n_bad == 0 and n_text == 0 and n_blank == 0)
    return {"table": name, "clean": clean, "bad": n_bad, "fine": n_fine, "text": n_text,
            "blank": n_blank, "only_a": len(only_a), "only_b": len(only_b), "cols": ha == hb}


def main():
    a, b, report = sys.argv[1], sys.argv[2], sys.argv[3]
    out = [f"Comparison of {a} (A) with {b} (B). Tolerance {TOL} (fine: {TOL_FINE})."]
    ta = {f[:-4] for f in os.listdir(os.path.join(a, "tables")) if f.endswith(".csv")}
    tb = {f[:-4] for f in os.listdir(os.path.join(b, "tables")) if f.endswith(".csv")}
    out.append(f"tables: A {len(ta)}  B {len(tb)}")
    if ta - tb:
        out.append(f"tables only in A: {sorted(ta - tb)}")
    if tb - ta:
        out.append(f"tables only in B: {sorted(tb - ta)}")
    results = []
    for name in sorted(ta & tb):
        results.append(compare_table(name, os.path.join(a, "tables", name + ".csv"),
                                     os.path.join(b, "tables", name + ".csv"), out))
    ma, mb = os.path.join(a, "metrics.csv"), os.path.join(b, "metrics.csv")
    if os.path.exists(ma) and os.path.exists(mb):
        results.append(compare_table("metrics", ma, mb, out))
    head = ["", "SUMMARY"]
    for r in results:
        if r.get("status"):
            head.append(f"  {r['table']}: {r['status']}")
            continue
        state = "CLEAN" if r["clean"] else "DIFFERS"
        head.append(f"  {state:8s}{r['table']}: beyond {TOL}: {r['bad']}, fine: {r['fine']}, "
                    f"text: {r['text']}, blank-one-side: {r['blank']}, keys only A/B: "
                    f"{r['only_a']}/{r['only_b']}, same columns: {r['cols']}")
    n_clean = sum(1 for r in results if r.get("clean"))
    head.append(f"  {n_clean} of {len(results)} compared files are clean")
    text = "\n".join(out[:4] + head + out[4:]) + "\n"
    with open(report, "w") as f:
        f.write(text)
    print("\n".join(out[:4] + head))


if __name__ == "__main__":
    main()

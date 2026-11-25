#!/usr/bin/env python3
"""Mechanical comparison of the two blind analysts' output files (ANALYSIS_SPEC.md version 1.1, sections 12 and 14).

Usage (from the study folder):  python3 -I tools/compare_analysts.py PY_DIR R_DIR [--max N]

Compares the 13 required .csv files of section 12, file by file and value by value:
  - both folders must exist and be non-empty;
  - every required file must exist on BOTH sides and be non-empty (more than zero bytes, at least one data row);
  - header equal, as exact text, to the expected header of section 12 (on both sides);
  - no double-quote character anywhere in the raw bytes (on either side);
  - every non-key field has the format of its column (section 11/12): integer ^-?[0-9]+$, decimal
    ^-?[0-9]+[.][0-9]{6}$, blank only where allowed; "-0.000000" is a difference (section 11 writes 0.000000);
  - EXACTLY the expected number of data rows; the fixed key columns equal the expected keys in the
    expected order (section 12), on both sides;
  - every other field: equal text, or two numbers within 0.01; for mstar.csv, decision_inputs.csv and decision.csv
    the text must be exactly equal (tolerance 0);
  - a number written with a different number of decimals on the two sides is a FORMAT difference (also DIFFER);
  - a missing-value token (NA, NaN, -nan, nan(ind), inf, ...), exponent form (1e+05), a leading or trailing space,
    a leading plus sign, a CR character, a missing final newline, a byte-order mark, bytes that are not UTF-8,
    or a row with the wrong number of fields is a difference, also when it occurs on both sides;
  - a .csv file of another name present on one side only is a difference; other file types are ignored.
Prints, before the last line, whether the files are byte-identical. Last line: AGREE or DIFFER.
Exit status 0 only for AGREE, 1 for DIFFER, 2 for wrong usage. At most N lines per file are printed
(default 200; 0 = no limit). Standard library only.
"""
import csv
import os
import re
import sys

TOL = 0.01

CHECKS = ["C01_rows_fields", "C02_header", "C03_predTs_form", "C04_hour_grid", "C05_numbers_parse",
          "C06_needed_nonblank", "C07_truth_positive", "C08_corr_of_state", "C09_shown_recomputed",
          "C10_err_corr", "C11_err_raw", "C12_ratio_ge_1", "C13_weights_range", "C14_unchanged_outside",
          "C15_parse_margin", "C16_blocks_cover"]
UNITS = ["unit_round", "unit_key", "unit_rule", "unit_groups", "unit_spell", "unit_percentile",
         "unit_periods", "unit_boot_index"]
CELLS = ["0-3000", "3000-6000", "6000-12000", "12000-25000"]
LPOPS = ["R", "R_half1", "R_half2", "R_eel", "R_noneel"] + ["R_cell_" + c for c in CELLS] + [
    "R_affected", "R_raised", "R_lowered", "R_before1008", "R_from1008", "R_span_usual", "scored_all"]
FPOPS = ["R", "R_affected", "R_span_usual", "scored_all"]
RULES8 = ["production", "handover_m1.5", "handover_m2", "handover_m3", "handover_m5", "half_half",
          "mean_of_three", "steady_always"]
RG = ["1-1.5", "1.5-2", "2-3", "3-5", "5-10", "10+", "all"]
SPLITS = [("all", ["all"]), ("corr", ["R_larger", "R_not_larger"]), ("flowbin", CELLS),
          ("spell", ["1", "2", "3", "4-6", "7-12", "13+"]), ("ageR", ["lt1d", "1-7d", "7-30d", "gt30d", "blank"])]
POPN = (["scored", "scored_design", "scored_test", "R_design", "R_test", "R_design_span_unusual",
         "R_test_span_unusual", "span_usual_value", "R_test_half1", "R_test_half2", "R_test_eel", "R_test_noneel"]
        + ["R_test_cell_" + c for c in CELLS]
        + ["R_test_before1008", "R_test_from1008", "rising_high_test", "falling_low_test",
           "blocks_months", "blocks_quarters"])


def _intervals():
    rows = [("I01", "L", "R", "d", "months"), ("I02", "L", "R", "d", "quarters")]
    pops = ["scored_all", "R_affected", "R_half1", "R_half2", "R_eel", "R_noneel"] + ["R_cell_" + c for c in CELLS] + [
        "R_raised", "R_lowered", "R_before1008", "R_from1008"]
    for k, p in enumerate(pops):
        rows.append(("I%02d" % (3 + k), "L", p, "d", "months"))
    rows += [("I17", "L", "R", "dHH", "months"), ("I18", "L", "R", "dHH", "quarters"),
             ("I19", "L", "R_span_usual", "d", "months"), ("I20", "L", "R_span_usual", "d", "quarters"),
             ("I21", "F", "R", "d", "months"), ("I22", "F", "R", "d", "quarters"),
             ("I23", "F", "R_span_usual", "d", "months"), ("I24", "F", "R_span_usual", "d", "quarters")]
    for k, p in enumerate(pops):
        rows.append(("I%02d" % (25 + k), "L", p, "d", "quarters"))
    return rows


EXP = {
    "checks.csv": [(u, "-") for u in UNITS] + [(c, a) for c in CHECKS for a in ("L", "F")],
    "row_accounting.csv": [(a, str(i), n) for a in ("L", "F") for i, n in enumerate(
        ["read", "status_not_predicted", "burn_in", "truth_dependent_hard", "truth_out_of_range", "blank_error"])],
    "populations.csv": [(a, p) for a in ("L", "F") for p in POPN],
    "a1_tables.csv": [(t, lv, g) for t, lvs in SPLITS for lv in lvs for g in RG],
    "a2_pick.csv": [("production", "baseline")] + [(r, "candidate") for r in RULES8[1:5]] + [
        (r, "control") for r in RULES8[5:]],
    "mstar.csv": [(k,) for k in ["m_star", "m_best", "m_second", "mae_best", "mae_second", "gap_best_second",
                                 "tie_rule_used", "mae_production", "beats_production"]],
    "stepb_main.csv": [("L", "handover_mstar", p) for p in LPOPS] + [("F", "handover_mstar", p) for p in FPOPS],
    "stepb_rules.csv": [(r, "R_test") for r in RULES8],
    "both_sides.csv": [("both_sides", p) for p in ["B_all", "B_eel", "B_noneel", "B_falling", "B_falling_eel",
                                                    "B_falling_noneel"]],
    "step_at_25000.csv": [(k,) for k in ["n_rising_high", "n_small_rise", "mean_corrR_minus_corrS", "n_hyp_changed",
                                         "mean_abs_hyp_change_cfs", "mean_abs_hyp_change_pct"]],
    "intervals.csv": _intervals(),
    "decision_inputs.csv": [(k,) for k in (
        ["m_star", "beats_production", "R_mean_d", "R_ci_lo", "R_ci_hi", "half1_mean_d", "half2_mean_d",
         "eel_mean_d", "noneel_mean_d"]
        + [x for c in CELLS for x in ("cell_%s_rel" % c, "cell_%s_ci_lo" % c)]
        + ["lowered_n", "lowered_mean_d", "lowered_below15_diff", "R_below15_diff", "R_above15_diff",
           "hh_est", "hh_ci_hi", "F_mean_d"])],
    "decision.csv": [(k,) for k in ["crit1_size", "crit2_no_harm_by_cell", "crit3_stable_time", "crit4_stable_season",
                                    "crit5_lowered", "crit6_large_errors", "crit7_tied_to_rise", "crit8_timing",
                                    "flag_unclear_cell", "flag_not_supported", "flag_fail", "verdict"]],
}
MEAS = ["n", "n_affected", "n_raised", "n_lowered", "mean_d", "mean_d_affected", "mean_abs_change_cfs",
        "mean_signed_change_cfs", "mean_abs_change_pct", "mae_prod", "mae_rule", "bias_prod", "bias_rule",
        "below15_prod", "below15_rule", "above15_prod", "above15_rule", "rel_mae_diff"]
HDR = {
    "checks.csv": ["check", "arm", "n_checked", "n_violations"],
    "row_accounting.csv": ["arm", "step", "condition", "rows_in", "rows_dropped", "rows_left"],
    "populations.csv": ["arm", "population", "n"],
    "a1_tables.csv": ["table", "split", "rgroup", "n", "mean_signed_raw", "mean_abs_raw", "mean_signed_prod",
                      "mean_abs_prod", "mean_signed_steady", "mean_abs_steady"],
    "a2_pick.csv": ["rule", "role", "n", "mae", "mean_signed", "mae_rank"],
    "mstar.csv": ["key", "value"],
    "stepb_main.csv": ["arm", "rule", "population"] + MEAS,
    "stepb_rules.csv": ["rule", "population"] + MEAS,
    "both_sides.csv": ["rule", "population"] + MEAS,
    "step_at_25000.csv": ["key", "value"],
    "intervals.csv": ["id", "arm", "population", "x", "blocks", "n", "est", "lo", "hi", "n_valid", "n_skipped"],
    "decision_inputs.csv": ["name", "value"],
    "decision.csv": ["item", "result"],
}
VERDICTS = {"PASS", "GAIN_WITHOUT_ONSET", "FAIL", "NOT_SUPPORTED", "UNCLEAR"}
RE_INT = re.compile(r"^-?[0-9]+$")
RE_DEC = re.compile(r"^-?[0-9]+\.[0-9]{6}$")


def col_type(fname, key, col):
    """Type of a non-key field: I integer, D decimal, Ib/Db the same but blank allowed, V verdict word, B flag 0/1."""
    if fname in ("checks.csv", "row_accounting.csv", "populations.csv"):
        return "I"
    if fname == "a1_tables.csv":
        return "I" if col == "n" else "Db"
    if fname == "a2_pick.csv":
        return {"n": "I", "mae_rank": "Ib"}.get(col, "Db")
    if fname in ("stepb_main.csv", "stepb_rules.csv", "both_sides.csv"):
        return "I" if col in ("n", "n_affected", "n_raised", "n_lowered") else "Db"
    if fname == "intervals.csv":
        return "I" if col in ("n", "n_valid", "n_skipped") else "Db"
    k = key[0]
    if fname == "mstar.csv":
        return "I" if k in ("tie_rule_used", "beats_production") else "D"
    if fname == "step_at_25000.csv":
        return "I" if k in ("n_rising_high", "n_small_rise", "n_hyp_changed") else "Db"
    if fname == "decision_inputs.csv":
        if k in ("beats_production", "lowered_n"):
            return "I"
        return "D" if k == "m_star" else "Db"
    if fname == "decision.csv":
        return "V" if k == "verdict" else "B"
    return "I"


def format_problem(fname, key, col, v):
    t = col_type(fname, key, col)
    if v == "":
        return None if t in ("Ib", "Db") else "blank not allowed"
    if t in ("I", "Ib"):
        return None if RE_INT.match(v) else "not an integer"
    if t in ("D", "Db"):
        if not RE_DEC.match(v):
            return "not a decimal with exactly 6 decimals"
        return "negative zero (must be written 0.000000)" if v == "-0.000000" else None
    if t == "B":
        return None if v in ("0", "1") else "not 0 or 1"
    if t == "V":
        return None if v in VERDICTS else "not a verdict word"
    return None


EXPECTED_ROWS = {"checks.csv": 40, "row_accounting.csv": 12, "populations.csv": 44, "a1_tables.csv": 126,
                 "a2_pick.csv": 8, "mstar.csv": 9, "stepb_main.csv": 20, "stepb_rules.csv": 8, "both_sides.csv": 6,
                 "step_at_25000.csv": 6, "intervals.csv": 38, "decision_inputs.csv": 25, "decision.csv": 12}
for _f, _k in EXP.items():
    assert len(_k) == EXPECTED_ROWS[_f], (_f, len(_k))
    assert len(_k[0]) < len(HDR[_f]), _f
# (file name, number of leading key columns, exact text only)
REQUIRED = [(f, len(EXP[f][0]), f in ("mstar.csv", "decision_inputs.csv", "decision.csv")) for f in EXPECTED_ROWS]
BAD_TOKENS = {"na", "nan", "-nan", "+nan", "nan(ind)", "-nan(ind)", "inf", "-inf", "+inf", "infinity", "-infinity",
              "+infinity", "null", "none", "n/a"}


def num(s):
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    if v != v or v in (float("inf"), float("-inf")):
        return None
    return v


def shape(t):
    """Number of decimals (-1 if no decimal point); anything unusual gets its own shape."""
    t = t.strip()
    body = t[1:] if t[:1] in "+-" else t
    parts = body.split(".")
    if len(parts) <= 2 and all(p.isdigit() or p == "" for p in parts) and body != ".":
        return len(parts[1]) if len(parts) == 2 else -1
    return "other:" + t


class Out:
    def __init__(self, limit):
        self.limit = limit
        self.total = 0
        self.fmt = 0
        self.printed = 0

    def line(self, fname, msg):
        self.total += 1
        if self.limit == 0 or self.printed < self.limit:
            self.printed += 1
            print("%s: %s" % (fname, msg))


def read_rows(path, fname, side, out):
    """Return list of rows (lists) or None if unreadable/empty. Reports format problems."""
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError as e:
        out.line(fname, "cannot read %s file: %s" % (side, e))
        return None
    if len(raw) == 0:
        out.line(fname, "%s file is empty (0 bytes)" % side)
        return None
    if raw.startswith(b"\xef\xbb\xbf"):
        out.line(fname, "%s file starts with a byte-order mark" % side)
    if b'"' in raw:
        out.line(fname, "%s file contains a double-quote character (fields must be unquoted)" % side)
    if b"\r" in raw:
        out.line(fname, "%s file contains a CR character (line endings must be LF)" % side)
    if not raw.endswith(b"\n"):
        out.line(fname, "%s file has no final newline" % side)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        out.line(fname, "%s file is not valid UTF-8" % side)
        return None
    rows = list(csv.reader(text.splitlines(), strict=False))
    if len(rows) < 2:
        out.line(fname, "%s file has no data row (header only or blank)" % side)
        return None
    return rows


def field_problems(v):
    """Format problems of one field (independent of the other side)."""
    out = []
    if v != v.strip():
        out.append("leading or trailing space")
    t = v.strip()
    if t.lower() in BAD_TOKENS:
        out.append("missing-value token")
    elif t[:1] == "+" and num(t) is not None:
        out.append("leading plus sign")
    elif num(t) is not None and ("e" in t.lower()):
        out.append("exponent form")
    return out


def compare_file(fname, nkey, exact, pa, pb, out):
    A = read_rows(pa, fname, "py", out)
    B = read_rows(pb, fname, "r", out)
    if A is None or B is None:
        return
    if A[0] != B[0]:
        out.line(fname, "header differs: py=%s r=%s" % (",".join(A[0]), ",".join(B[0])))
        return
    header = A[0]
    if header != HDR[fname]:
        out.line(fname, "header is not the expected one: got %s, expected %s" % (",".join(header), ",".join(HDR[fname])))
        return
    exp = EXP[fname]
    for rows, side in ((A, "py"), (B, "r")):
        if len(rows) - 1 != len(exp):
            out.line(fname, "%s file has %d data rows, expected %d" % (side, len(rows) - 1, len(exp)))
        for i in range(1, min(len(rows) - 1, len(exp)) + 1):
            if tuple(rows[i][:nkey]) != exp[i - 1]:
                out.line(fname, "%s row %d key is %s, expected %s" % (side, i, "|".join(rows[i][:nkey]), "|".join(exp[i - 1])))
                break
        for i in range(1, len(rows)):
            if len(rows[i]) != len(header):
                out.line(fname, "%s row %d wrong field count %d (expected %d)" % (side, i, len(rows[i]), len(header)))
                continue
            for j, v in enumerate(rows[i]):
                for p in field_problems(v):
                    out.line(fname, "%s row %d col=%s %s: %r" % (side, i, header[j], p, v))
                if j >= nkey:
                    fp = format_problem(fname, tuple(rows[i][:nkey]), header[j], v)
                    if fp:
                        out.line(fname, "%s row %d col=%s format: %s: %r" % (side, i, header[j], fp, v))
    for i in range(1, min(len(A), len(B))):
        ra, rb = A[i], B[i]
        if len(ra) != len(header) or len(rb) != len(header):
            continue
        if ra[:nkey] != rb[:nkey]:
            out.line(fname, "row %d key or order differs: py=%s r=%s" % (i, "|".join(ra[:nkey]), "|".join(rb[:nkey])))
            continue
        key = "|".join(ra[:nkey])
        for j, col in enumerate(header):
            a, b = ra[j], rb[j]
            if a == b:
                continue
            x, y = num(a), num(b)
            if (not exact) and x is not None and y is not None and j >= nkey and abs(x - y) <= TOL:
                if shape(a) != shape(b):
                    out.fmt += 1
                    out.line(fname, "FORMAT row %d key=%s col=%s py=%r r=%r" % (i, key, col, a, b))
            else:
                out.line(fname, "row %d key=%s col=%s py=%r r=%r%s" % (i, key, col, a, b, " (exact text required)" if exact else ""))


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
    bad = False
    for d, side in zip(dirs, ("py", "r")):
        if not os.path.isdir(d):
            print("folder %s does not exist: %s" % (side, d))
            bad = True
        elif not os.listdir(d):
            print("folder %s is empty: %s" % (side, d))
            bad = True
    if bad:
        print("DIFFER")
        return 1
    total = 0
    fmt = 0
    identical = []
    differing = []
    names = set(f for f, _, _ in REQUIRED)
    for fname, nkey, exact in REQUIRED:
        pa, pb = os.path.join(dirs[0], fname), os.path.join(dirs[1], fname)
        ea, eb = os.path.isfile(pa), os.path.isfile(pb)
        out = Out(limit)
        if not ea and not eb:
            out.line(fname, "required file missing on both sides")
        elif ea != eb:
            out.line(fname, "required file missing on the %s side" % ("r" if ea else "py"))
        else:
            compare_file(fname, nkey, exact, pa, pb, out)
            with open(pa, "rb") as fa, open(pb, "rb") as fb:
                da, db = fa.read(), fb.read()
            if da == db and len(da) > 0:
                identical.append(fname)
            else:
                differing.append(fname)
        if out.total > out.printed:
            print("%s: ... and %d more differences not printed" % (fname, out.total - out.printed))
        total += out.total
        fmt += out.fmt
    # csv files outside the required list: only a one-sided presence is a difference
    lists = []
    for d in dirs:
        lists.append(set(f for f in os.listdir(d) if f.endswith(".csv") and f not in names))
    for f in sorted(lists[0] ^ lists[1]):
        print("%s: extra .csv file on the %s side only" % (f, "py" if f in lists[0] else "r"))
        total += 1
    if fmt:
        print("format mismatches (also counted as differences): %d" % fmt)
    if not differing and len(identical) == len(REQUIRED):
        print("BYTE-IDENTICAL: yes (%d of %d files)" % (len(identical), len(REQUIRED)))
    else:
        print("BYTE-IDENTICAL: no (%d of %d files identical)" % (len(identical), len(REQUIRED)))
    print("DIFFER" if total else "AGREE")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

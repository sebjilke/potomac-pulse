#!/usr/bin/env python3
"""Mechanical comparison of the two blind analysts' output files of the clock study
(ANALYSIS_SPEC.md version 1.2, sections 16, 17 and 19).

Usage (from the study folder):
    python3 -I tools/compare_analysts.py [PY_DIR R_DIR]      (defaults: py r)
    python3 -I tools/compare_analysts.py --selftest

Reads ONLY the 15 output .csv files of section 17 in the two folders. It never reads input data, plans or reviews.
Per file: presence on both sides, empty file, raw-byte guards (no BOM, no quote, no CR, final newline, UTF-8), header,
data-row count (fixed, derived from another output file of the same side, or "the two sides agree"), field count,
key columns (expected values and order, or the stated structure), format guards on every numeric cell (blank or
^-?[0-9]+(\\.[0-9]{6})?$, never -0.000000, no NA/NaN/inf/exponent/plus sign), then exact text equality; where the text
differs the per-cell comparison: integers and text exact, decimals within 0.01 (blank against anything else differs).
Five files must be equal as text (tolerance 0). Either run having stopped early (a missing or header-only file, a unit
test or stopping check with violations in checks.csv) gives DIFFER. Output: one line per file (IDENTICAL,
WITHIN_TOLERANCE, DIFFER), then "BYTE-IDENTICAL: yes|no", then the last line exactly AGREE or DIFFER.
Exit status 0 for AGREE, 1 for DIFFER, 2 for usage. Standard library only.
"""
import io
import os
import re
import sys
import tempfile
import contextlib

TOL_MICRO = 10000   # 0.01 in units of 1e-6
RE_INT = re.compile(r"^-?[0-9]+$")
RE_DEC = re.compile(r"^-?[0-9]+\.[0-9]{6}$")
RE_NUM = re.compile(r"^-?[0-9]+(\.[0-9]{6})?$")
BAD_TOKENS = {"na", "nan", "-nan", "+nan", "nan(ind)", "inf", "-inf", "+inf", "infinity", "-infinity", "+infinity",
              "null", "n/a"}
MAXPRINT = 10

# ---------------------------------------------------------------- expected structure (section 17)
VERS = ["LOW_P", "LOW_A", "LOW_B", "UPP", "WHO"]
UNITS23 = ["unit_key", "unit_weeks", "unit_stats", "unit_corr", "unit_xc", "unit_parabola", "unit_start", "unit_parts",
           "unit_bumps", "unit_thin", "unit_creek", "unit_theilsen", "unit_circ", "unit_lcg", "unit_detrend",
           "unit_days", "unit_range", "unit_verdict", "unit_dr", "unit_mic", "unit_cluster", "unit_draw", "unit_use"]
CHECKS_C = ["C00_inputs_sha", "C01_hourly_file", "C02_events_file", "C03_replay_file", "C04_dr_file",
            "C05_row_accounting", "C06_unit_sanity", "C07_lag_sanity", "C08_week_sanity"]
CHECKS_M = ["M1_gate_margin", "M2_creek_margin", "M3_tie_margin", "M4_floor"]
ACC_ITEMS = (["hourly_rows", "hourly_span", "hourly_missing", "events_rows", "event_rows_with_class", "event_units",
              "small_onsets", "unit_no_start", "small_no_peak", "small_under30", "rise_units", "bump_candidates",
              "bump_drop_overlap", "bump_drop_spacing", "bump_units", "recession_windows", "recession_cut",
              "weeks_complete", "weeks_drop_lf_coverage", "weeks_drop_median", "weeks_drop_overlap", "weeks_low_water",
              "weeks_lt1500", "weeks_1500_2000", "weeks_2000_3000", "small_joined", "clusters_event", "clusters_small",
              "clusters_bump", "clusters_total", "replay_rows", "replay_predicted", "replay_with_clock"]
             + ["used_%s_%s" % (v, k) for v in VERS for k in ("rise", "bump", "recession")]
             + ["weeks_used_%s" % v for v in VERS] + ["dr_present"])
GROUPS = ["event", "small", "bump", "all_rise", "recession"]
CLASSES = ["all", "lt3000", "3000-6000", "6000-12000", "12000-25000", "ge25000"]
WCLASSES = ["lt1500", "1500-2000", "2000-3000"]
FLOWIDS = ["g1500", "g2000", "g3000", "g5000", "g7500", "g10000", "g15000", "g25000", "g50000", "cell1", "cell2", "cell3"]
GRID = ["1500.000000", "2000.000000", "3000.000000", "5000.000000", "7500.000000", "10000.000000", "15000.000000",
        "25000.000000", "50000.000000"]
CELLS = ["rising_lt6000", "rising_6000_12000", "rising_ge12000", "low_water"]
DR_NAMES = ["dr_present", "nonpositive_hours", "candidates", "separate", "fail_lf", "fail_rise10", "fail_ef",
            "fail_creek", "pass_conditions", "selected", "used", "n_pass_gate", "valid", "median_scaled", "q25_scaled",
            "q75_scaled", "share_fallback", "dr_sha256"]
DEC_NAMES = ["nq", "nlong", "nshort", "ninside", "dr_present", "dr_valid", "verdict"]

# columns that are text (section 19 item 4); every other column is numeric
TEXT_COLS = {"check", "item", "unit_id", "kind", "event_id", "cluster", "qclass", "period", "version", "status",
             "creek", "parts_status", "group", "class", "flow_id", "source", "week_id", "row_type", "reason", "cell",
             "name"}
# rows of a key-value file whose value is text
TEXT_VALUE_ROWS = {"dr_sha256", "verdict"}

HEADERS = {
    "checks.csv": ["check", "n_checked", "n_violations"],
    "row_accounting.csv": ["item", "n", "expected"],
    "units.csv": ["unit_id", "kind", "event_id", "cluster", "onset_key", "peak_key", "start_key", "a", "b", "n_hours",
                  "q", "qclass", "period", "lf_start", "lf_peak", "share_lower", "share_upper", "share_whole",
                  "dr_fallback"],
    "unit_lags.csv": ["unit_id", "version", "used", "n_both", "status", "s_best", "n_pairs", "r", "delta", "lag",
                      "g40", "g50", "g60", "g70", "share", "creek", "parts_status", "lag10", "lag50", "lag90",
                      "lagcrest"],
    "bumps.csv": ["peak_key", "start_key", "a", "b", "lf_peak", "lf_base", "status"],
    "class_summary.csv": ["version", "group", "class", "n_units", "n_used", "n_ok", "n_g40", "n_g50", "n_g60", "n_g70",
                          "n_g60_heavy", "n_g60_unknown", "n_g60_clean", "med_g40", "med_g50", "med_g60", "med_g70",
                          "q1_g60", "q3_g60", "med_g60_all", "share_whole_g60", "n_parts", "med_lag10", "med_lag50",
                          "med_lag90", "med_lagcrest"],
    "fits.csv": ["version", "period", "n_points", "n_clusters", "qmin", "qmax", "n_floor", "nslopes", "B", "A",
                 "n_valid", "n_skipped", "B_lo", "B_hi"],
    "fit_at_flows.csv": ["version", "flow_id", "flow", "usable", "lag", "lo", "hi"],
    "clock_grid.csv": ["flow", "source", "L", "lo", "hi", "cover_both", "long_end", "central", "short_end", "dr_used"],
    "lowwater_weeks.csv": ["week_id", "version", "start_key", "q", "class", "used", "n_both", "status", "s_best",
                           "n_pairs", "r", "delta", "phase", "gate50"],
    "lowwater_summary.csv": ["row_type", "version", "class", "n_weeks", "n_gate", "phase", "spread", "n_bumps",
                             "bump_median", "k", "lag", "lag_lo", "lag_hi", "chain_sum", "chain_whole", "chain_diff",
                             "chain_pass"],
    "dr_units.csv": ["unit_id", "peak_key", "rank", "rise", "lf_day", "ef_rel_range", "seneca_rise", "broad_run_rise",
                     "used", "status", "s_best", "n_pairs", "r", "delta", "lag", "lag_scaled", "pass"],
    "dr_summary.csv": ["name", "value"],
    "cells.csv": ["cell", "n_units", "median_q", "qual", "reason", "n_app_rows", "app_value", "formula_value", "L", "lo",
                  "hi", "cover_both", "long_end", "central", "short_end", "dr_used", "status"],
    "decision.csv": ["item", "value"],
}
KEYCOLS = {"checks.csv": ["check"], "row_accounting.csv": ["item"], "units.csv": ["unit_id"],
           "unit_lags.csv": ["unit_id", "version"], "bumps.csv": ["peak_key"],
           "class_summary.csv": ["version", "group", "class"], "fits.csv": ["version", "period"],
           "fit_at_flows.csv": ["version", "flow_id"], "clock_grid.csv": ["flow"],
           "lowwater_weeks.csv": ["week_id", "version"], "lowwater_summary.csv": ["row_type", "version", "class"],
           "dr_units.csv": ["unit_id"], "dr_summary.csv": ["name"], "cells.csv": ["cell"], "decision.csv": ["item"]}
EXACT = {"checks.csv", "row_accounting.csv", "units.csv", "bumps.csv", "decision.csv"}
ORDER = ["checks.csv", "row_accounting.csv", "units.csv", "unit_lags.csv", "bumps.csv", "class_summary.csv",
         "fits.csv", "fit_at_flows.csv", "clock_grid.csv", "lowwater_weeks.csv", "lowwater_summary.csv",
         "dr_units.csv", "dr_summary.csv", "cells.csv", "decision.csv"]
assert sorted(ORDER) == sorted(HEADERS) == sorted(KEYCOLS)

# fixed key lists (tuples over the key columns)
FIXED = {
    "checks.csv": [(c,) for c in UNITS23 + CHECKS_C + CHECKS_M],
    "row_accounting.csv": [(c,) for c in ACC_ITEMS],
    "class_summary.csv": [(v, g, c) for v in VERS for g in GROUPS for c in CLASSES],
    "fits.csv": [(v, p) for v in VERS for p in ("all", "pre2020", "from2020")],
    "fit_at_flows.csv": [(v, f) for v in VERS for f in FLOWIDS],
    "clock_grid.csv": [(f,) for f in GRID],
    "lowwater_summary.csv": ([("phase", v, c) for v in VERS for c in WCLASSES]
                             + [("lag", v, c) for v in ("LOW_P", "UPP", "WHO") for c in WCLASSES]
                             + [("chain", "", c) for c in WCLASSES]),
    "dr_summary.csv": [(n,) for n in DR_NAMES],
    "cells.csv": [(c,) for c in CELLS],
    "decision.csv": [(n,) for n in DEC_NAMES],
}
FIXED_ROWS = {f: len(k) for f, k in FIXED.items()}
FIXED_ROWS.update({"units.csv": 225, "bumps.csv": 103, "lowwater_weeks.csv": 500})
assert FIXED_ROWS["checks.csv"] == 36 and FIXED_ROWS["row_accounting.csv"] == 54
assert FIXED_ROWS["class_summary.csv"] == 150 and FIXED_ROWS["fit_at_flows.csv"] == 60
assert FIXED_ROWS["lowwater_summary.csv"] == 27 and FIXED_ROWS["dr_summary.csv"] == 18
# unit_lags.csv: 5 x the units of the same side (1,125); dr_units.csv: from dr_present of the same side


# ---------------------------------------------------------------- cell helpers
def micro(s):
    neg = s.startswith("-")
    a, b = s.lstrip("-").split(".")
    v = int(a) * 1000000 + int(b)
    return -v if neg else v


def cell_kind(v):
    if v == "":
        return "B"
    if RE_DEC.match(v):
        return "D"
    if RE_INT.match(v):
        return "I"
    return "T"


def is_numeric_cell(fname, col, rowkey_first):
    if col in TEXT_COLS:
        return False
    if col == "value" and rowkey_first in TEXT_VALUE_ROWS:
        return False
    return True


def guard(v):
    """Format problem of one numeric cell, or None."""
    if v == "":
        return None
    if v == "-0.000000":
        return "negative zero (-0.000000)"
    if RE_NUM.match(v):
        return None
    if v.lower() in BAD_TOKENS:
        return "missing-value token"
    return "numeric cell is not blank, an integer or %.6f (exponent, plus sign, wrong decimals, text)"


class Report:
    def __init__(self):
        self.probs = []
        self.ndiff = 0
        self.maxdiff = 0

    def add(self, rowkey, col, a, b, msg):
        self.probs.append((rowkey, col, a, b, msg))


def read_side(path, side, rep):
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError as e:
        rep.add("-", "-", "", "", "cannot read %s file: %s" % (side, e))
        return None, b""
    if len(raw) == 0:
        rep.add("-", "-", "", "", "%s file is empty" % side)
        return None, raw
    if raw.startswith(b"\xef\xbb\xbf"):
        rep.add("-", "-", "", "", "%s file starts with a byte-order mark" % side)
    if b'"' in raw:
        rep.add("-", "-", "", "", "%s file contains a quote character" % side)
    if b"\r" in raw:
        rep.add("-", "-", "", "", "%s file contains a CR character" % side)
    if not raw.endswith(b"\n"):
        rep.add("-", "-", "", "", "%s file has no final newline" % side)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        rep.add("-", "-", "", "", "%s file is not valid UTF-8" % side)
        return None, raw
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return [ln.split(",") for ln in lines], raw


def quiet_read(folder, fname):
    """Rows of another output file of the same side, for cross-file structure; None if unreadable."""
    try:
        with open(os.path.join(folder, fname), "rb") as f:
            t = f.read().decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    lines = t.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return [ln.split(",") for ln in lines]


def side_context(folder):
    """dr_present of the side (from dr_summary.csv) and the unit ids (from units.csv); None when unreadable."""
    ctx = {"dr_present": None, "units": None}
    rows = quiet_read(folder, "dr_summary.csv")
    if rows and rows[0] == HEADERS["dr_summary.csv"]:
        for r in rows[1:]:
            if len(r) == 2 and r[0] == "dr_present" and r[1] in ("0", "1"):
                ctx["dr_present"] = int(r[1])
    rows = quiet_read(folder, "units.csv")
    if rows and rows[0] == HEADERS["units.csv"]:
        ctx["units"] = [r[0] for r in rows[1:] if len(r) == len(HEADERS["units.csv"])]
    return ctx


# ---------------------------------------------------------------- structure per file
def expected_row_count(fname, ctx):
    """int, or None when only agreement of the two sides is required."""
    if fname == "unit_lags.csv":
        return 5 * len(ctx["units"]) if ctx["units"] is not None else 1125
    if fname == "dr_units.csv":
        return 1 if ctx["dr_present"] == 0 else None
    return FIXED_ROWS[fname]


def key_problems(fname, data, header, ctx):
    """{row number (1-based): expected-key description} for rows whose key is not as expected."""
    kc = [header.index(c) for c in KEYCOLS[fname]]
    out = {}
    rows = [r for r in data if len(r) == len(header)]
    if len(rows) != len(data):
        return out
    if fname in FIXED:
        for i, r in enumerate(data):
            if i < len(FIXED[fname]):
                exp = FIXED[fname][i]
                if tuple(r[j] for j in kc) != exp:
                    out[i + 1] = "|".join(exp)
        return out
    if fname == "units.csv":
        seen = set()
        for i, r in enumerate(data):
            d = dict(zip(header, r))
            if i < 53:
                kind, pre = "event", "E"
            elif i < 86:
                kind, pre = "small", "S"
            elif i < 172:
                kind, pre = "bump", "B"
            else:
                kind, pre = "recession", "R"
            bad = d["kind"] != kind or not re.match("^%s[0-9]+$" % pre, d["unit_id"]) or d["unit_id"] in seen
            if kind == "recession" and i < len(data) and 0 <= i - 172 < 53:
                ev = data[i - 172]
                if len(ev) == len(header):
                    bad = bad or d["event_id"] != ev[2] or d["unit_id"] != "R" + ev[2]
            if kind == "event" and d["event_id"] == "":
                bad = True
            seen.add(d["unit_id"])
            if bad:
                out[i + 1] = "unit_id %s<digits>, unique, kind %s (units: 53 event, 33 small, 86 bump, 53 recession in " \
                             "that order; recession id = R + the event_id of the matching event)" % (pre, kind)
        return out
    if fname == "unit_lags.csv":
        ids = ctx["units"]
        for i, r in enumerate(data):
            if ids is not None and i < 5 * len(ids):
                exp = (ids[i // 5], VERS[i % 5])
            elif ids is None:
                exp = None
            else:
                exp = ("<beyond the units of units.csv>", "")
            if exp is None:
                if r[1] != VERS[i % 5]:
                    out[i + 1] = "version " + VERS[i % 5]
            elif tuple(r[j] for j in kc) != exp:
                out[i + 1] = "|".join(exp)
        return out
    if fname == "bumps.csv":
        prev = None
        for i, r in enumerate(data):
            ok = bool(re.match("^[0-9]+$", r[0]))
            if ok and prev is not None and int(r[0]) <= prev:
                ok = False
            if not ok:
                out[i + 1] = "peak_key integer, strictly above the previous row's"
            elif True:
                prev = int(r[0])
        return out
    if fname == "lowwater_weeks.csv":
        prevw = None
        for i, r in enumerate(data):
            exp_v = VERS[i % 5]
            ok = r[1] == exp_v and bool(re.match("^W[0-9]+$", r[0]))
            if ok:
                w = int(r[0][1:])
                if i % 5 == 0:
                    ok = prevw is None or w > prevw
                    prevw = w
                else:
                    ok = w == prevw
            if not ok:
                out[i + 1] = "week_id W<digits>, five rows per week in version order, weeks ascending; version " + exp_v
        return out
    if fname == "dr_units.csv":
        if ctx["dr_present"] == 0:
            for i, r in enumerate(data):
                ok = i == 0 and r[0] == "ABSENT" and all(v == "" for v in r[1:])
                if not ok:
                    out[i + 1] = "ABSENT marker row with every other field blank (dr_present is 0)"
        elif ctx["dr_present"] == 1:
            for i, r in enumerate(data):
                if i >= 40 or not re.match("^D[0-9]+$", r[0]) or r[2] != str(i + 1):
                    out[i + 1] = "unit_id D<digits>, rank %d, at most 40 rows (dr_present is 1)" % (i + 1)
        return out
    return out


def check_side(fname, rows, side, rep, ctx, kp):
    header = HEADERS[fname]
    if rows[0] != header:
        rep.add("-", "header", ",".join(rows[0]), ",".join(header), "%s header is not the expected one" % side)
        return False
    data = rows[1:]
    exp_n = expected_row_count(fname, ctx)
    if exp_n is not None and len(data) != exp_n:
        rep.add("-", "rows", str(len(data)), str(exp_n), "%s file has the wrong number of data rows" % side)
    if fname == "dr_units.csv" and ctx["dr_present"] is None:
        rep.add("-", "dr_present", "", "", "%s dr_summary.csv gives no readable dr_present (0 or 1)" % side)
    if fname == "dr_units.csv" and ctx["dr_present"] == 1 and not (1 <= len(data) <= 40):
        rep.add("-", "rows", str(len(data)), "1 to 40", "%s dr_units.csv row count not in 1 to 40" % side)
    ok = True
    for i, r in enumerate(data):
        if len(r) != len(header):
            rep.add("row %d" % (i + 1), "-", str(len(r)), str(len(header)), "%s wrong field count" % side)
            ok = False
            continue
        key = "|".join(r[header.index(c)] for c in KEYCOLS[fname])
        for j, v in enumerate(r):
            if v != v.strip():
                rep.add(key, header[j], v, "", "%s leading or trailing space" % side)
            if is_numeric_cell(fname, header[j], r[0]):
                g = guard(v)
                if g:
                    rep.add(key, header[j], v, "", "%s format: %s" % (side, g))
    if ok:
        kp.update(key_problems(fname, data, header, ctx))
    if ok and fname == "dr_summary.csv" and ctx["dr_present"] == 0:
        for r in data:
            if r[0] != "dr_present" and r[1] != "":
                rep.add(r[0], "value", r[1], "", "%s must be blank when dr_present is 0" % side)
    if ok and fname == "decision.csv" and ctx["dr_present"] is not None:
        for r in data:
            if r[0] == "dr_present" and r[1] != str(ctx["dr_present"]):
                rep.add("dr_present", "value", r[1], str(ctx["dr_present"]), "%s decision.csv disagrees with dr_summary.csv" % side)
    if ok and fname == "checks.csv":
        for r in data:
            if not r[0].startswith("M") and r[2] != "0":
                rep.add(r[0], "n_violations", r[2], "0", "%s a unit test or stopping check reports violations (run stopped or failed)" % side)
    return ok


def compare_cells(fname, A, B, rep):
    header = HEADERS[fname]
    kidx = [header.index(c) for c in KEYCOLS[fname]]
    for i in range(1, min(len(A), len(B))):
        ra, rb = A[i], B[i]
        if len(ra) != len(header) or len(rb) != len(header):
            continue
        key = "|".join(ra[j] for j in kidx)
        for j, col in enumerate(header):
            a, b = ra[j], rb[j]
            if a == b:
                continue
            if j in kidx:
                rep.add("row %d" % i, col, a, b, "key differs between the two sides")
                continue
            ka, kb = cell_kind(a), cell_kind(b)
            if fname in EXACT:
                rep.add(key, col, a, b, "text must be equal (tolerance 0)")
            elif ka == "D" and kb == "D":
                d = abs(micro(a) - micro(b))
                if d <= TOL_MICRO:
                    rep.ndiff += 1
                    rep.maxdiff = max(rep.maxdiff, d)
                else:
                    rep.add(key, col, a, b, "decimals differ by more than 0.01")
            elif {ka, kb} == {"D", "I"}:
                rep.add(key, col, a, b, "FORMAT difference (decimal against integer)")
            else:
                rep.add(key, col, a, b, "values differ (%s vs %s; integers, text and blanks must be equal)" % (ka, kb))


def compare_file(fname, da, db):
    rep = Report()
    pa, pb = os.path.join(da, fname), os.path.join(db, fname)
    ea, eb = os.path.isfile(pa), os.path.isfile(pb)
    if not ea or not eb:
        side = "both sides" if not ea and not eb else ("the second folder" if ea else "the first folder")
        rep.add("-", "-", "", "", "required file missing on " + side)
        return "DIFFER", rep, False
    A, rawa = read_side(pa, "first folder", rep)
    B, rawb = read_side(pb, "second folder", rep)
    if A is None or B is None:
        return "DIFFER", rep, False
    ca, cb = side_context(da), side_context(db)
    kpa, kpb = {}, {}
    oka = check_side(fname, A, "first folder", rep, ca, kpa)
    okb = check_side(fname, B, "second folder", rep, cb, kpb)
    if kpa or kpb:
        header = HEADERS[fname]
        kcols = [header.index(c) for c in KEYCOLS[fname]]

        def rk(rows, i):
            return "|".join(rows[i][j] for j in kcols) if i < len(rows) and len(rows[i]) == len(header) else "<missing>"
        for i in sorted(set(kpa) | set(kpb)):
            ka, kb = rk(A, i), rk(B, i)
            sides = [n for n, d in (("first folder", kpa), ("second folder", kpb)) if i in d]
            rep.add("row %d" % i, "key", ka, kb,
                    "key not as expected (%s); expected key %r; the two folders %s"
                    % (" and ".join(sides), kpa.get(i) or kpb.get(i),
                       "AGREE with each other" if ka == kb else "DIFFER from each other"))
    if len(A) != len(B):
        rep.add("-", "rows", str(len(A) - 1), str(len(B) - 1), "the two sides have different numbers of data rows")
    elif oka and okb:
        compare_cells(fname, A, B, rep)
    same = rawa == rawb
    if rep.probs:
        return "DIFFER", rep, same
    if same:
        return "IDENTICAL", rep, True
    if rep.ndiff == 0:
        rep.add("-", "-", "", "", "files differ as bytes but no cell differs")
        return "DIFFER", rep, False
    return "WITHIN_TOLERANCE", rep, False


def run(da, db):
    bad = False
    for d, side in ((da, "first"), (db, "second")):
        if not os.path.isdir(d):
            print("%s folder does not exist: %s" % (side, d))
            bad = True
    if bad:
        print("BYTE-IDENTICAL: no")
        print("DIFFER")
        return 1
    allok = True
    allsame = True
    for fname in ORDER:
        status, rep, same = compare_file(fname, da, db)
        allsame = allsame and same and status == "IDENTICAL"
        if status == "IDENTICAL":
            print("%s: IDENTICAL" % fname)
        elif status == "WITHIN_TOLERANCE":
            print("%s: WITHIN_TOLERANCE (%d differing cells, largest absolute difference %.6f)"
                  % (fname, rep.ndiff, rep.maxdiff / 1e6))
        else:
            allok = False
            print("%s: DIFFER (%d problems; first %d)" % (fname, len(rep.probs), min(MAXPRINT, len(rep.probs))))
            for rowkey, col, a, b, msg in rep.probs[:MAXPRINT]:
                print("    file=%s row=%s column=%s first_folder=%r second_folder=%r : %s" % (fname, rowkey, col, a, b, msg))
    names = set(ORDER)
    one = [set(f for f in os.listdir(d) if f.endswith(".csv") and f not in names) for d in (da, db)]
    for f in sorted(one[0] ^ one[1]):
        allok = False
        print("%s: extra .csv file on the %s folder only" % (f, "first" if f in one[0] else "second"))
    print("BYTE-IDENTICAL: %s" % ("yes" if allsame else "no"))
    print("AGREE" if allok else "DIFFER")
    return 0 if allok else 1


# ---------------------------------------------------------------- self test
DECS = {"q", "r", "delta", "lag", "med_g60", "B", "A", "app_value", "L", "lf_peak", "lf_base", "lf_start", "flow",
        "share_lower"}


def made_up_rows(fname, dr_present=0):
    header = HEADERS[fname]
    rows = []

    def fill(keyvals, special=None):
        out = []
        for c in header:
            if c in keyvals:
                out.append(keyvals[c])
            elif special and c in special:
                out.append(special[c])
            elif c in TEXT_COLS:
                out.append("ok")
            else:
                out.append("0.500000" if c in DECS else "1")
        return out
    if fname == "units.csv":
        ev = [str(k + 1) for k in range(53)]
        for i in range(225):
            if i < 53:
                kv = {"unit_id": "E" + ev[i], "kind": "event", "event_id": ev[i]}
            elif i < 86:
                kv = {"unit_id": "S%d" % (i - 52), "kind": "small", "event_id": ""}
            elif i < 172:
                kv = {"unit_id": "B%d" % (400000 + i * 100), "kind": "bump", "event_id": ""}
            else:
                kv = {"unit_id": "R" + ev[i - 172], "kind": "recession", "event_id": ev[i - 172]}
            rows.append(fill(kv, {"qclass": "lt3000", "period": "pre2020", "cluster": "E1"}))
    elif fname == "unit_lags.csv":
        for u in [r[0] for r in made_up_rows("units.csv")]:
            for v in VERS:
                rows.append(fill({"unit_id": u, "version": v}, {"status": "ok", "creek": "clean", "parts_status": "ok"}))
    elif fname == "bumps.csv":
        for i in range(103):
            rows.append(fill({"peak_key": str(400000 + i * 100), "status": "kept"}))
    elif fname == "lowwater_weeks.csv":
        for w in range(100):
            for v in VERS:
                rows.append(fill({"week_id": "W%d" % (2000 + w), "version": v}, {"class": "lt1500", "status": "ok"}))
    elif fname == "dr_units.csv":
        if dr_present == 0:
            rows.append(["ABSENT"] + [""] * (len(header) - 1))
        else:
            for i in range(5):
                rows.append(fill({"unit_id": "D%d" % (410000 + i), "rank": str(i + 1)}, {"status": "ok"}))
    elif fname == "dr_summary.csv":
        for n in DR_NAMES:
            v = "" if n != "dr_present" else str(dr_present)
            if dr_present == 1:
                v = {"dr_present": "1", "dr_sha256": "abcd"}.get(n, "1")
            rows.append([n, v])
    elif fname == "decision.csv":
        for n in DEC_NAMES:
            rows.append([n, {"verdict": "MIXED", "dr_present": str(dr_present)}.get(n, "0")])
    elif fname == "row_accounting.csv":
        for n in ACC_ITEMS:
            rows.append([n, "1", ""])
    else:
        for key in FIXED[fname]:
            kv = dict(zip(KEYCOLS[fname], key))
            sp = {"source": "rising_fit", "status": "INSIDE", "reason": "ok"}
            if fname == "checks.csv":
                sp = {"n_checked": "1", "n_violations": "0"}
            rows.append(fill(kv, sp))
    return rows


def make_folder(d, dr_present=0):
    os.makedirs(d, exist_ok=True)
    for fname in ORDER:
        rows = made_up_rows(fname, dr_present)
        with open(os.path.join(d, fname), "w", encoding="utf-8", newline="") as f:
            f.write(",".join(HEADERS[fname]) + "\n")
            for r in rows:
                f.write(",".join(r) + "\n")


def edit(path, fn):
    with open(path, encoding="utf-8", newline="") as f:
        lines = f.read().split("\n")
    fn(lines)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write("\n".join(lines))


def set_cell(path, row, colname, value):
    fname = os.path.basename(path)
    ci = HEADERS[fname].index(colname)

    def fn(lines):
        p = lines[row].split(",")
        p[ci] = value
        lines[row] = ",".join(p)
    edit(path, fn)


def selftest():
    fails = 0
    with tempfile.TemporaryDirectory() as tmp:
        counter = [0]

        def case(name, setup, want_code, want_in_output, dr=0):
            nonlocal fails
            counter[0] += 1
            a, b = os.path.join(tmp, "a%d" % counter[0]), os.path.join(tmp, "b%d" % counter[0])
            make_folder(a, dr)
            make_folder(b, dr)
            setup(a, b)
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                code = run(a, b)
            out = buf.getvalue()
            ok = code == want_code and all(w in out for w in want_in_output)
            print("%-62s %s" % (name, "ok" if ok else "FAILED"))
            if not ok:
                fails += 1
                print(out)

        P = lambda d, f: os.path.join(d, f)
        lag_row = 7  # a row of unit_lags.csv (line index; header is line 0)
        case("identical files", lambda a, b: None, 0, ["BYTE-IDENTICAL: yes", "AGREE"])
        case("identical files, Difficult Run present", lambda a, b: None, 0, ["BYTE-IDENTICAL: yes", "AGREE"], dr=1)
        case("0.004 difference in a decimal cell",
             lambda a, b: set_cell(P(b, "unit_lags.csv"), lag_row, "lag", "0.504000"), 0,
             ["unit_lags.csv: WITHIN_TOLERANCE (1 differing cells, largest absolute difference 0.004000)",
              "BYTE-IDENTICAL: no", "AGREE"])
        case("0.02 difference in a decimal cell",
             lambda a, b: set_cell(P(b, "unit_lags.csv"), lag_row, "lag", "0.520000"), 1,
             ["unit_lags.csv: DIFFER", "decimals differ by more than 0.01"])
        case("integer off by 1", lambda a, b: set_cell(P(b, "unit_lags.csv"), lag_row, "s_best", "2"), 1,
             ["unit_lags.csv: DIFFER", "integers, text and blanks must be equal"])
        case("changed key (second folder)",
             lambda a, b: set_cell(P(b, "class_summary.csv"), 5, "class", "lt9999"), 1,
             ["class_summary.csv: DIFFER", "key not as expected", "expected key"])

        def shared_wrong(a, b):
            for d in (a, b):
                set_cell(P(d, "fits.csv"), 3, "period", "pre2021")
        case("key shared by both sides but not the expected one", shared_wrong, 1,
             ["first_folder='LOW_P|pre2021'", "second_folder='LOW_P|pre2021'", "expected key 'LOW_P|from2020'",
              "AGREE with each other"])
        case("missing file", lambda a, b: os.remove(P(b, "cells.csv")), 1, ["cells.csv: DIFFER", "required file missing"])
        case("exponent-form number", lambda a, b: set_cell(P(b, "unit_lags.csv"), lag_row, "lag", "1e-05"), 1,
             ["unit_lags.csv: DIFFER", "numeric cell is not blank"])
        case("NA in a numeric cell", lambda a, b: set_cell(P(b, "unit_lags.csv"), lag_row, "lag", "NA"), 1,
             ["unit_lags.csv: DIFFER", "missing-value token"])
        case("plus sign", lambda a, b: set_cell(P(b, "unit_lags.csv"), lag_row, "lag", "+0.500000"), 1,
             ["unit_lags.csv: DIFFER", "numeric cell is not blank"])
        case("blank against zero", lambda a, b: set_cell(P(b, "unit_lags.csv"), lag_row, "n_pairs", ""), 1,
             ["unit_lags.csv: DIFFER", "blanks must be equal"])
        case("decimal against integer", lambda a, b: set_cell(P(b, "unit_lags.csv"), lag_row, "lag", "1"), 1,
             ["unit_lags.csv: DIFFER", "FORMAT difference"])
        case("negative zero", lambda a, b: set_cell(P(b, "unit_lags.csv"), lag_row, "lag", "-0.000000"), 1,
             ["negative zero"])
        case("exact-text file with a 0.004 difference",
             lambda a, b: set_cell(P(b, "units.csv"), 3, "q", "0.504000"), 1,
             ["units.csv: DIFFER", "tolerance 0"])
        case("header only (run stopped early)",
             lambda a, b: (edit(P(a, "cells.csv"), lambda L: L.__setitem__(slice(2, None), [""])),
                           edit(P(b, "cells.csv"), lambda L: L.__setitem__(slice(2, None), [""]))), 1,
             ["cells.csv: DIFFER", "wrong number of data rows"])
        case("failed unit test on both sides (run stopped)",
             lambda a, b: (set_cell(P(a, "checks.csv"), 4, "n_violations", "1"),
                           set_cell(P(b, "checks.csv"), 4, "n_violations", "1")), 1,
             ["checks.csv: DIFFER", "reports violations"])
        case("dr_units marker row with Difficult Run absent but a unit listed",
             lambda a, b: edit(P(b, "dr_units.csv"), lambda L: L.insert(2, "D410000,1,1,1,1,1,1,1,1,ok,1,1,0.5,0.5,0.5,0.5,1")), 1,
             ["dr_units.csv: DIFFER"])
        case("dr_present differs between the two sides",
             lambda a, b: (make_folder(b, 1)), 1, ["dr_summary.csv: DIFFER", "dr_units.csv: DIFFER"])
        case("unit_lags keys follow units.csv",
             lambda a, b: set_cell(P(b, "unit_lags.csv"), 11, "unit_id", "E999"), 1,
             ["unit_lags.csv: DIFFER", "expected key"])
        case("CR in a file", lambda a, b: edit(P(b, "bumps.csv"), lambda L: L.__setitem__(2, L[2] + "\r")), 1,
             ["carriage" if False else "CR character"])
    print("SELFTEST " + ("PASSED" if fails == 0 else "FAILED (%d)" % fails))
    return 0 if fails == 0 else 1


def main(argv):
    args = argv[1:]
    if args == ["--selftest"]:
        return selftest()
    if len(args) == 0:
        args = ["py", "r"]
    if len(args) != 2:
        print("usage: compare_analysts.py [PY_DIR R_DIR] | --selftest")
        return 2
    return run(args[0], args[1])


if __name__ == "__main__":
    sys.exit(main(sys.argv))

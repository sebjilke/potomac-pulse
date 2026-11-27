#!/usr/bin/env python3
"""Mechanical comparison of the two blind analysts' output files of the cap study
(ANALYSIS_SPEC.md, sections 16, 17 and 19).

Usage (from the study folder):
    python3 -I tools/compare_analysts.py [PY_DIR R_DIR]      (defaults: py r)
    python3 -I tools/compare_analysts.py --selftest

Reads ONLY the 14 output .csv files of section 17 in the two folders. It never reads input data, the events file or any plan.
Per file: presence on both sides, empty file, raw-byte guards (no BOM, no quote, no CR, final newline, UTF-8), header,
exact data-row count, field count, key columns (expected values and order), format guards on every cell (no leading or
trailing space; numeric cells empty or ^-?[0-9]+(\\.[0-9]{6})?$ and never -0.000000; no NA/NaN/inf/exponent/plus sign),
then exact text equality; where the text differs the per-cell comparison: integers and text exact, decimals within 0.01.
Six files must be equal as text (tolerance 0). Output: one line per file (IDENTICAL, WITHIN_TOLERANCE, DIFFER), then
"BYTE-IDENTICAL: yes|no", then the last line exactly AGREE or DIFFER. Exit status 0 for AGREE, 1 for DIFFER, 2 for usage.
Standard library only.
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
BAD_TOKENS = {"na", "nan", "-nan", "+nan", "nan(ind)", "-nan(ind)", "inf", "-inf", "+inf", "infinity", "-infinity",
              "+infinity", "null", "n/a"}
MAXPRINT = 10

# ---------------------------------------------------------------- expected structure (section 17)
POPS = (["all", "rising", "lf_rising", "capped", "capped_rising", "capped_notrising", "rl_large", "rl_large_upstream",
         "rl_large_lfled", "rl_large_notclassed"]
        + ["bin_" + b for b in ["0-3000", "3000-6000", "6000-12000", "12000-25000", "25000-50000", "50000+"]]
        + ["high_water", "low_water"])
CANDS = ["F135", "F150", "F200", "LF3", "LF6", "MR", "UP", "RIS", "ICE", "N"]
RULES18 = ["P"] + CANDS + ["T110", "F125", "F130", "F140", "F175", "ICE-T", "P_icet_hours"]
UNITS = ["unit_round", "unit_key", "unit_time", "unit_rules", "unit_fallbacks", "unit_error", "unit_measures",
         "unit_pick", "unit_verdict", "unit_labels", "unit_percentile", "unit_periods", "unit_boot_index",
         "unit_truth", "unit_mic"]
C12 = ["C01_rows_fields", "C02_header", "C03_predTs_form", "C04_hour_grid", "C05_numbers_parse", "C06_needed_nonblank",
       "C07_truth_positive", "C08_lfcap_lfq", "C09_shown_recomputed", "C10_err_corr", "C11_time_forms", "C12_blocks_cover"]
MROWS = ["M1_err15_margin", "M1x_err15_exact", "M2_cap_margin", "M3_lfrise_margin", "M4_floor_margin", "M4x_floor_exact"]
GROUPS6 = ["all", "capped", "capped_rising", "capped_notrising", "lf_rising", "rl_large"]
CLASSES = ["low", "within", "high"]
PICK_ITEMS = ["c1_off_diff_rising", "c1_ci_lo", "c1_ci_hi", "c2_mean_d_all", "c3_high_diff_all", "c4_high_diff_rising",
              "c5_n_rl", "c5_off_diff_rl", "c5_rel_mae_rl", "c6_off_diff_half1", "c6_off_diff_half2",
              "c7_off_diff_rising_F", "c8_rel_mae_high", "c9_rel_mae_low"]
CONDS = ["cond1_rising_off", "cond2_overall", "cond3_high_all", "cond4_high_rising", "cond5_large_rises",
         "cond6_halves", "cond7_timing_arm_F", "cond8_high_water", "cond9_low_water"]
SHIFTS = ["-1", "1", "2"]


def _checks_keys():
    k = [(u, "-") for u in UNITS] + [("C00_inputs_sha", "-")]
    k += [(c, a) for c in C12 for a in ("L", "F")]
    k += [("C13_hourly_file", "-"), ("C14_events_file", "-"), ("C15_expected_counts", "L")]
    k += [(c, a) for c in ("C16_truth_rebuilt", "C17_monotone") for a in ("L", "F")]
    k += [(c, a) for c in MROWS for a in ("L", "F")] + [("M5_pick_margin", "L")]
    return k


def _interval_keys():
    """(id, period, population, x, rule) with rule None for S rows (checked against the pick)."""
    rows = []
    n = 1
    for per in ("design", "test"):
        for g in GROUPS6:
            rows.append(("I%02d" % n, per, g, "d", "N"))
            n += 1
    for c in CANDS:
        rows.append(("I%02d" % n, "test", "rising", "off_diff", c)); n += 1
        rows.append(("I%02d" % n, "test", "all", "d", c)); n += 1
    for i, s in enumerate(("m1", "p1", "p2")):
        rows.append(("S%02d" % (i + 1), "test", "rising", "off_diff_shift_" + s, None))
    return rows


def _gate_keys():
    k = ["gate_n_checked", "gate_n_failing", "gate_passed"] + ["gate_fail_%d" % i for i in range(1, 11)]
    for pre in ("shift_", "shiftF_"):
        for s in ("m1", "p1", "p2"):
            for w in ("n_missing", "n_range", "n_left"):
                k.append("%s%s_%s" % (pre, s, w))
    return k + ["timing_flag"]


DEC_INPUTS = None
INPUT_NAMES = ["pick", "n_qualifiers", "leader", "leader_off_rising_design", "P_off_rising_design", "P_c_off_rising",
               "pick_off_rising_design", "pick_mean_d_all_design", "c1_off_diff_rising", "c1_ci_lo", "c1_ci_hi",
               "c2_mean_d_all", "c3_high_diff_all", "c4_high_diff_rising", "c5_n_rl", "c5_off_diff_rl",
               "c5_rel_mae_rl", "c6_off_diff_half1", "c6_off_diff_half2", "c7_off_diff_rising_F", "c8_rel_mae_high",
               "c9_rel_mae_low"]

# file -> dict(header, keycols (names), keys (expected tuples in order), types (non-key col -> I D T K), exact)
SPEC = {
    "checks.csv": dict(header=["check", "arm", "n_checked", "n_violations"], keycols=["check", "arm"],
                       keys=_checks_keys(), types={"n_checked": "I", "n_violations": "I"}, exact=True),
    "row_accounting.csv": dict(
        header=["arm", "step", "condition", "rows_in", "rows_dropped", "rows_left"], keycols=["arm", "step", "condition"],
        keys=[(a, str(i), c) for a in ("L", "F") for i, c in enumerate(
            ["read", "status_not_predicted", "burn_in", "truth_dependent_hard", "truth_out_of_range", "blank_error"])],
        types={"rows_in": "I", "rows_dropped": "I", "rows_left": "I"}, exact=True),
    "populations.csv": dict(
        header=["arm", "period", "item", "n"], keycols=["arm", "period", "item"],
        keys=[(a, p, i) for a in ("L", "F") for p in ("design", "test") for i in [
            "scored", "capped", "rising", "capped_rising", "lf_rising", "lf_rising_capped", "rl_hours", "rl_rises",
            "rl_capped", "d6_blank", "span_zero", "mr_fallback", "mr_differs", "up_fallback", "lf3_fallback",
            "lf6_fallback", "icet_hours", "icet_temp_blank", "blocks"]],
        types={"n": "I"}, exact=True),
    "rule_tables.csv": dict(
        header=["arm", "period", "population", "rule", "n", "mae", "bias", "off", "low", "high", "mean_d", "off_diff",
                "low_diff", "high_diff", "mae_rel", "n_differ"],
        keycols=["arm", "period", "population", "rule"],
        keys=[(a, p, q, r) for a in ("L", "F") for p in ("design", "test", "test_half1", "test_half2")
              for q in POPS for r in RULES18],
        types=dict({"n": "I", "n_differ": "I"}, **{c: "D" for c in [
            "mae", "bias", "off", "low", "high", "mean_d", "off_diff", "low_diff", "high_diff", "mae_rel"]}),
        exact=False),
    "cap_description.csv": dict(
        header=["period", "group", "n", "mean_d", "lo", "hi", "label"], keycols=["period", "group"],
        keys=[(p, g) for p in ("design", "test") for g in GROUPS6],
        types={"n": "I", "mean_d": "D", "lo": "D", "hi": "D", "label": "T"}, exact=False),
    "cap_classes.csv": dict(
        header=["period", "item", "n", "share"], keycols=["period", "item"],
        keys=[(p, i) for p in ("design", "test") for i in
              ["no_%s__cap_%s" % (a, b) for a in CLASSES for b in CLASSES]
              + ["reach_rising_low_P", "reach_rising_low_P_capped"]],
        types={"n": "I", "share": "D"}, exact=False),
    "intervals.csv": dict(
        header=["id", "period", "rule", "population", "x", "n", "est", "lo", "hi", "n_valid", "n_skipped"],
        keycols=["id", "period", "population", "x"], keys=None,   # built from _interval_keys (rule handled apart)
        types={"n": "I", "est": "D", "lo": "D", "hi": "D", "n_valid": "I", "n_skipped": "I", "rule": "T"}, exact=False),
    "pick_design.csv": dict(
        header=["rule", "tie_order", "mean_d_all", "off_rising", "c_off_rising", "n_rising", "mean_d_sign", "qualifies",
                "is_leader", "is_tied", "is_first_tied"], keycols=["rule", "tie_order"],
        keys=[(c, str(["F135", "F150", "LF6", "LF3", "MR", "UP", "RIS", "F200", "ICE", "N"].index(c) + 1)) for c in CANDS],
        types={"mean_d_all": "D", "off_rising": "D", "c_off_rising": "I", "n_rising": "I", "mean_d_sign": "I",
               "qualifies": "I", "is_leader": "I", "is_tied": "I", "is_first_tied": "I"}, exact=False),
    "decision_inputs.csv": dict(header=["name", "value"], keycols=["name"], keys=[(n,) for n in INPUT_NAMES],
                                types={"value": "K"}, exact=True),
    "decision.csv": dict(header=["item", "result"], keycols=["item"], keys=[(n,) for n in CONDS + ["verdict"]],
                         types={"result": "K"}, exact=True),
    "rises_test.csv": dict(
        header=["event_id", "event_t0", "rule", "n", "mae", "lower_than_P"], keycols=["event_id", "event_t0", "rule"],
        keys=None, types={"n": "I", "mae": "D", "lower_than_P": "I"}, exact=False),
    "timing_gate.csv": dict(header=["key", "value"], keycols=["key"], keys=[(k,) for k in _gate_keys()],
                            types={"value": "K"}, exact=True),
    "timing_candidates.csv": dict(
        header=["shift", "rule", "n_all", "mean_d_all", "n_rising", "off_diff_rising", "n_rl", "off_diff_rl",
                "mae_rel_rl"], keycols=["shift", "rule"], keys=[(s, c) for s in SHIFTS for c in CANDS],
        types={"n_all": "I", "mean_d_all": "D", "n_rising": "I", "off_diff_rising": "D", "n_rl": "I",
               "off_diff_rl": "D", "mae_rel_rl": "D"}, exact=False),
    "timing_pick.csv": dict(header=["shift", "item", "value"], keycols=["shift", "item"],
                            keys=[(s, i) for s in SHIFTS for i in PICK_ITEMS + CONDS + ["verdict"]],
                            types={"value": "K"}, exact=False),
}
ORDER = ["checks.csv", "row_accounting.csv", "populations.csv", "rule_tables.csv", "cap_description.csv",
         "cap_classes.csv", "intervals.csv", "pick_design.csv", "decision_inputs.csv", "decision.csv",
         "rises_test.csv", "timing_gate.csv", "timing_candidates.csv", "timing_pick.csv"]
ROWS = {"checks.csv": 60, "row_accounting.csv": 12, "populations.csv": 76, "rule_tables.csv": 2592,
        "cap_description.csv": 12, "cap_classes.csv": 22, "intervals.csv": 35, "pick_design.csv": 10,
        "decision_inputs.csv": 22, "decision.csv": 10, "rises_test.csv": 153, "timing_gate.csv": 32,
        "timing_candidates.csv": 30, "timing_pick.csv": 72}
assert sorted(ORDER) == sorted(SPEC) == sorted(ROWS)
for _f in ORDER:
    if SPEC[_f]["keys"] is not None:
        assert len(SPEC[_f]["keys"]) == ROWS[_f], (_f, len(SPEC[_f]["keys"]))
assert len(_interval_keys()) == ROWS["intervals.csv"]
SPEC["intervals.csv"]["keys"] = [k[:4] for k in _interval_keys()]
INTERVAL_RULES = [k[4] for k in _interval_keys()]
RISE_RULES = ["P"] + CANDS


# ---------------------------------------------------------------- cell helpers
def micro(s):
    neg = s.startswith("-")
    a, b = s.lstrip("-").split(".")
    v = int(a) * 1000000 + int(b)
    return -v if neg else v


def looks_numeric(t):
    try:
        float(t)
        return True
    except ValueError:
        return False


def cell_kind(spec_type, v):
    """Kind of a cell from its text: D decimal, I integer, B blank, T text."""
    if v == "":
        return "B"
    if RE_DEC.match(v):
        return "D"
    if RE_INT.match(v):
        return "I"
    return "T"


def guard(spec_type, v):
    """Format problem of one non-key cell, or None."""
    if v == "":
        return None
    if spec_type == "K":
        if RE_DEC.match(v) or RE_INT.match(v):
            return "negative zero (-0.000000)" if v == "-0.000000" else None
        if v.lower() in BAD_TOKENS:
            return "missing-value token"
        if looks_numeric(v):
            return "number not written as integer or %.6f (exponent, plus sign, wrong decimals)"
        return None
    if spec_type == "I":
        return None if RE_INT.match(v) else "not an integer"
    if spec_type == "D":
        if v == "-0.000000":
            return "negative zero (-0.000000)"
        return None if RE_DEC.match(v) else "not a decimal with exactly 6 decimals"
    return None


class Report:
    def __init__(self):
        self.probs = []      # (rowkey, col, a, b, msg)
        self.ndiff = 0
        self.maxdiff = 0

    def add(self, rowkey, col, a, b, msg):
        self.probs.append((rowkey, col, a, b, msg))


# ---------------------------------------------------------------- file reading
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


def expected_keys(fname, rows_a, rows_b):
    """Expected key tuples; for rises_test.csv built from the file itself (event_id, event_t0 may vary by rise)."""
    return SPEC[fname]["keys"]


def check_side(fname, rows, side, rep, pick, kp):
    """Structure, keys and format guards of one side. Returns True if the cells can be compared."""
    sp = SPEC[fname]
    header = sp["header"]
    if rows[0] != header:
        rep.add("-", "header", ",".join(rows[0]), ",".join(header), "%s header is not the expected one" % side)
        return False
    data = rows[1:]
    if len(data) != ROWS[fname]:
        rep.add("-", "rows", str(len(data)), str(ROWS[fname]), "%s file has the wrong number of data rows" % side)
    ok = True
    kidx = [header.index(c) for c in sp["keycols"]]
    for i, r in enumerate(data):
        if len(r) != len(header):
            rep.add("row %d" % (i + 1), "-", str(len(r)), str(len(header)), "%s wrong field count" % side)
            ok = False
            continue
        for j, v in enumerate(r):
            if v != v.strip():
                rep.add("row %d" % (i + 1), header[j], v, "", "%s leading or trailing space" % side)
        key = "|".join(r[j] for j in kidx)
        if fname != "rises_test.csv":
            if i < len(sp["keys"]):
                exp = sp["keys"][i]
                if tuple(r[j] for j in kidx) != exp:
                    kp[i + 1] = "|".join(exp)
        for j, v in enumerate(r):
            if j in kidx:
                continue
            t = sp["types"].get(header[j], "T")
            g = guard(t, v)
            if g:
                rep.add(key, header[j], v, "", "%s format: %s" % (side, g))
    if fname == "intervals.csv":
        ri = header.index("rule")
        for i, r in enumerate(data):
            if len(r) != len(header) or i >= len(INTERVAL_RULES):
                continue
            exp = INTERVAL_RULES[i]
            if exp is None:
                exp = "" if pick in (None, "none", "") else pick
            if r[ri] != exp:
                rep.add(r[0], "rule", r[ri], exp, "%s rule of an interval row is not the expected one" % side)
    if fname == "rises_test.csv":
        for i, r in enumerate(data[:ROWS[fname]]):
            if len(r) != len(header):
                continue
            if i < 143:
                exp_rule = RISE_RULES[i % 11]
                grp = data[(i // 11) * 11]
                if r[2] != exp_rule or r[0] != grp[0] or r[1] != grp[1] or r[0] in ("", "COUNT") or r[1] == "":
                    kp[i + 1] = exp_rule + " (rule; event_id and event_t0 constant within the block)"
            else:
                exp = ("COUNT", "", CANDS[i - 143])
                if tuple(r[:3]) != exp:
                    kp[i + 1] = "|".join(exp)
    if fname == "checks.csv":
        for i, r in enumerate(data):
            if len(r) == 4 and not r[0].startswith("M") and r[3] != "0":
                rep.add(r[0] + "|" + r[1], "n_violations", r[3], "0", "%s a stopping check or unit test reports violations" % side)
    return ok


def compare_cells(fname, A, B, rep):
    sp = SPEC[fname]
    header = sp["header"]
    kidx = [header.index(c) for c in sp["keycols"]]
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
                rep.add(key, col, a, b, "key differs between the two sides")
                continue
            t = sp["types"].get(col, "T")
            ka, kb = cell_kind(t, a), cell_kind(t, b)
            if sp["exact"]:
                rep.add(key, col, a, b, "text must be equal (tolerance 0)")
            elif ka == "D" and kb == "D":
                d = abs(micro(a) - micro(b))
                if d <= TOL_MICRO:
                    rep.ndiff += 1
                    rep.maxdiff = max(rep.maxdiff, d)
                else:
                    rep.add(key, col, a, b, "decimals differ by more than 0.01")
            else:
                rep.add(key, col, a, b, "values differ (%s vs %s; integers and text must be equal)" % (ka, kb))


def compare_file(fname, da, db):
    """Returns (status, detail lines, byte_identical)."""
    rep = Report()
    pa, pb = os.path.join(da, fname), os.path.join(db, fname)
    ea, eb = os.path.isfile(pa), os.path.isfile(pb)
    if not ea or not eb:
        side = "both sides" if not ea and not eb else ("the r side" if ea else "the py side")
        rep.add("-", "-", "", "", "required file missing on " + side)
        return "DIFFER", rep, False
    A, rawa = read_side(pa, "py", rep)
    B, rawb = read_side(pb, "r", rep)
    if A is None or B is None:
        return "DIFFER", rep, False
    pick = {}
    for nm, rows in (("py", A), ("r", B)):
        pick[nm] = None
    if fname == "intervals.csv":
        # pick row of decision_inputs.csv, per side
        for nm, d in (("py", da), ("r", db)):
            try:
                with open(os.path.join(d, "decision_inputs.csv"), "r", encoding="utf-8") as f:
                    for ln in f.read().split("\n")[1:]:
                        p = ln.split(",")
                        if p[0] == "pick" and len(p) == 2:
                            pick[nm] = p[1]
            except OSError:
                pick[nm] = None
    kpa, kpb = {}, {}
    oka = check_side(fname, A, "py", rep, pick["py"], kpa)
    okb = check_side(fname, B, "r", rep, pick["r"], kpb)
    if kpa or kpb:
        kcols = [SPEC[fname]["header"].index(c) for c in SPEC[fname]["keycols"]]
        for i in sorted(set(kpa) | set(kpb)):
            def rk(rows):
                return "|".join(rows[i][j] for j in kcols) if i < len(rows) and len(rows[i]) > max(kcols) else "<missing>"
            ka, kb = rk(A), rk(B)
            sides = [n for n, d in (("first folder", kpa), ("second folder", kpb)) if i in d]
            rep.add("row %d" % i, "key", ka, kb, "key not as expected (%s); expected key %r; the two folders %s"
                    % (" and ".join(sides), kpa.get(i) or kpb.get(i), "AGREE with each other" if ka == kb else "DIFFER from each other"))
    if oka and okb:
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
    """Print the report; return exit status."""
    bad = False
    for d, side in ((da, "py"), (db, "r")):
        if not os.path.isdir(d):
            print("folder %s does not exist: %s" % (side, d))
            bad = True
    if bad:
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
    # a .csv of another name on one side only is a difference; a .csv on both sides not in section 17 is ignored
    names = set(ORDER)
    one = [set(f for f in os.listdir(d) if f.endswith(".csv") and f not in names) for d in (da, db)]
    for f in sorted(one[0] ^ one[1]):
        allok = False
        print("%s: extra .csv file on the %s side only" % (f, "py" if f in one[0] else "r"))
    print("BYTE-IDENTICAL: %s" % ("yes" if allsame else "no"))
    print("AGREE" if allok else "DIFFER")
    return 0 if allok else 1


# ---------------------------------------------------------------- self test
def make_folder(d):
    """Write 14 valid made-up output files with the expected shapes."""
    os.makedirs(d, exist_ok=True)
    for fname in ORDER:
        sp = SPEC[fname]
        header = sp["header"]
        rows = []
        if fname == "rises_test.csv":
            for r in range(13):
                for rule in RISE_RULES:
                    rows.append(["%d" % (11 + r), "2020-01-%02d 00:00" % (r + 1), rule, "7",
                                 "0.500000", "" if rule == "P" else "1"])
            for i, c in enumerate(CANDS):
                rows.append(["COUNT", "", c, "5", "", ""])
        else:
            for i, key in enumerate(sp["keys"]):
                row = list(key)
                for col in header[len(sp["keycols"]):] if fname != "intervals.csv" else header:
                    pass
                full = []
                for c in header:
                    if c in sp["keycols"]:
                        full.append(key[sp["keycols"].index(c)])
                    elif fname == "intervals.csv" and c == "rule":
                        full.append(INTERVAL_RULES[i] or "")
                    else:
                        t = sp["types"].get(c, "T")
                        if fname == "decision_inputs.csv":
                            full.append({"pick": "none", "leader": "none"}.get(key[0], "" if key[0].startswith(("pick_", "c")) else "0"))
                        elif fname == "decision.csv":
                            full.append("KEEP" if key[0] == "verdict" else "not_applicable")
                        elif fname == "timing_gate.csv":
                            full.append("" if key[0].startswith("gate_fail") or key[0] == "timing_flag" else "0")
                        elif fname == "timing_pick.csv":
                            full.append("KEEP" if key[1] == "verdict" else ("not_applicable" if key[1].startswith("cond") else ""))
                        elif fname == "cap_description.csv" and c == "label":
                            full.append("unclear")
                        elif fname == "checks.csv":
                            full.append("5" if c == "n_checked" else "0")
                        elif t == "I":
                            full.append("1")
                        else:
                            full.append("0.500000")
                rows.append(full)
        with open(os.path.join(d, fname), "w", encoding="utf-8", newline="") as f:
            f.write(",".join(header) + "\n")
            for r in rows:
                f.write(",".join(r) + "\n")


def edit(path, fn):
    with open(path, encoding="utf-8", newline="") as f:
        lines = f.read().split("\n")
    fn(lines)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write("\n".join(lines))


def selftest():
    fails = 0
    with tempfile.TemporaryDirectory() as tmp:
        def fresh(name):
            a, b = os.path.join(tmp, name + "_py"), os.path.join(tmp, name + "_r")
            make_folder(a)
            make_folder(b)
            return a, b

        def go(a, b):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                code = run(a, b)
            return code, buf.getvalue()

        def case(name, setup, want_code, want_in_output):
            nonlocal fails
            a, b = fresh(name.split(":")[0].replace(" ", "_"))
            setup(a, b)
            code, out = go(a, b)
            ok = code == want_code and all(w in out for w in want_in_output)
            print("%-60s %s" % (name, "ok" if ok else "FAILED"))
            if not ok:
                fails += 1
                print(out)
            return out

        rt = lambda d: os.path.join(d, "rule_tables.csv")
        def set_cell(path, row, col_index, value):
            def fn(lines):
                p = lines[row].split(",")
                p[col_index] = value
                lines[row] = ",".join(p)
            edit(path, fn)

        case("identical files", lambda a, b: None, 0, ["BYTE-IDENTICAL: yes", "AGREE"])
        case("0.004 difference in a decimal cell",
             lambda a, b: set_cell(rt(b), 5, 5, "0.504000"), 0,
             ["rule_tables.csv: WITHIN_TOLERANCE (1 differing cells, largest absolute difference 0.004000)", "BYTE-IDENTICAL: no", "AGREE"])
        case("0.02 difference in a decimal cell",
             lambda a, b: set_cell(rt(b), 5, 5, "0.520000"), 1, ["rule_tables.csv: DIFFER", "decimals differ by more than 0.01", "DIFFER"])
        case("integer differing by 1 (n)",
             lambda a, b: set_cell(rt(b), 5, 4, "2"), 1, ["rule_tables.csv: DIFFER", "integers and text must be equal"])
        case("changed key",
             lambda a, b: set_cell(rt(b), 5, 3, "F999"), 1, ["rule_tables.csv: DIFFER", "key differs"])
        def both_key(a, b):
            for d in (a, b):
                edit(os.path.join(d, "checks.csv"), lambda L: L.__setitem__(
                    43, L[43].replace("C15_expected_counts,L", "C15_expected_counts,-")))
        case("key shared by both sides but not the expected one", both_key, 1,
             ["first_folder='C15_expected_counts|-'", "second_folder='C15_expected_counts|-'",
              "expected key 'C15_expected_counts|L'", "AGREE with each other"])
        case("missing file",
             lambda a, b: os.remove(os.path.join(b, "cap_classes.csv")), 1, ["cap_classes.csv: DIFFER", "required file missing", "DIFFER"])
        case("exponent-form number",
             lambda a, b: set_cell(rt(b), 5, 5, "1e+05"), 1, ["rule_tables.csv: DIFFER", "not a decimal with exactly 6 decimals"])
        case("exponent-form number on both sides",
             lambda a, b: (set_cell(rt(a), 5, 5, "1e+05"), set_cell(rt(b), 5, 5, "1e+05")), 1, ["rule_tables.csv: DIFFER"])
        case("exact-text file with 0.004 difference",
             lambda a, b: set_cell(os.path.join(b, "decision_inputs.csv"), 9, 1, "0.504000") or set_cell(os.path.join(a, "decision_inputs.csv"), 9, 1, "0.500000"),
             1, ["decision_inputs.csv: DIFFER", "tolerance 0"])
        case("negative zero",
             lambda a, b: set_cell(rt(b), 5, 5, "-0.000000"), 1, ["negative zero"])
        case("header only file (run stopped early)",
             lambda a, b: (edit(os.path.join(a, "intervals.csv"), lambda L: L.__setitem__(slice(2, None), [""])),
                           edit(os.path.join(b, "intervals.csv"), lambda L: L.__setitem__(slice(2, None), [""]))), 1, ["intervals.csv: DIFFER"])
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

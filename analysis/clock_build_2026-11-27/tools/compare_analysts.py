#!/usr/bin/env python3
"""Mechanical comparison of the two analysts' output files of the measured-clock build
(ANALYSIS_SPEC.md version 1.2, section 15, with the file list of section 13).

Usage:
    python3 -I tools/compare_analysts.py [PY_DIR R_DIR]      (defaults: ../py and ../r next to this tools/ folder)
    python3 -I tools/compare_analysts.py --self-test

Looks at the 11 .csv files of 13.2 in the two folders (other files are ignored; a .csv of another name on one side
only is a difference). Per file: presence, empty file, raw-byte guards (no BOM, no quote, no CR, final newline, UTF-8),
header, number of data rows, field count, key columns (expected values in the expected order, both sides), format guards
on every numeric cell (blank, or ^-?[0-9]+(\\.[0-9]{6})?$, never -0.000000, no leading/trailing space), then the
comparison: five files must be equal as text (tolerance 0); the other six compare integer and text columns as text and
%.6f columns within 0.01 absolute (a different number of decimals is a FORMAT difference, a blank against a number a
difference). In learning_health.csv the `value` cell is typed by its text.
Per file one line: IDENTICAL (byte for byte) | EQUAL WITHIN TOLERANCE | DIFFER, each with "BYTE-IDENTICAL: yes|no";
then a SUMMARY line; the last line is exactly AGREE or DIFFER. Exit status 0 only for AGREE, 1 for DIFFER, 2 for usage.
Standard library only.
"""
import argparse
import contextlib
import io
import os
import re
import sys
import tempfile

TOL_MICRO = 10000   # 0.01 in units of 1e-6
RE_INT = re.compile(r"^-?[0-9]+$")
RE_DEC = re.compile(r"^-?[0-9]+\.[0-9]{6}$")
RE_NUM = re.compile(r"^-?[0-9]+(\.[0-9]{6})?$")
RE_NEGZERO = re.compile(r"(?<![0-9.])-0\.000000(?![0-9])")
BAD_TOKENS = {"na", "nan", "-nan", "+nan", "nan(ind)", "inf", "-inf", "+inf", "infinity", "-infinity", "+infinity",
              "null", "n/a"}
MAXPRINT = 8

# ---------------------------------------------------------------- expected structure (sections 13.2, 13.3, 14, 3.2)
PERIODS = ["design", "test"]
G10 = ["all", "lf_rising", "rl_rises", "rl_rises_bump", "low_water", "high_12_20", "high_20plus", "rl_large",
       "rl_large_creekfed", "rl_large_notcreek"]
G11 = G10 + ["rl_large_shareunk"]
TRUTHS = ["central", "long", "short"]
RUNS = ["OLD", "NEW"]
COMPS = ["cap", "Y0", "Y1"]

LH_BLOCK1 = ["slots_stored", "slot_blocked_hours", "learn_validations", "learned", "hard_skipped", "retries",
             "dropped_missed_window", "pending_at_end", "rate_missed_window", "rate_retries", "rate_hard_skipped"]
LH_BLOCK2 = ["n_learn_rows", "n_learned", "n_hard_skipped", "n_clamped"]
LH_BLOCK3 = ["n_est_hours", "n_capped", "capped_share", "n_capped_lf_rising", "capped_lf_rising_share",
             "n_corr_steps", "corr_jump_p95", "corr_jump_p99", "n_jumps_ge5"]
# integer-valued `value` metrics of learning_health.csv (13.1); used by the self-test generator only
LH_INT_METRICS = {"slots_stored", "slot_blocked_hours", "learn_validations", "learned", "hard_skipped", "retries",
                  "dropped_missed_window", "pending_at_end", "n_learn_rows", "n_learned", "n_hard_skipped",
                  "n_clamped", "n_est_hours", "n_capped", "n_capped_lf_rising", "n_corr_steps", "n_jumps_ge5"}

CHECK_IDS = (["U01_round", "U02_key", "U03_time", "U04_percentile", "U05_mic", "U06_truth", "U07_boot_index",
              "U08_periods", "U09_error", "U10_cap", "U11_clock", "U12_due", "U13_band", "U14_yard", "U15_move",
              "U16_labels", "U17_reading", "U18_jump"]
             + ["S01_sha_shadow_OLD", "S02_sha_learn_OLD", "S03_sha_counts_OLD", "S04_sha_bins_OLD", "S05_sha_hourly",
                "S06_sha_events", "S07_sha_units", "S08_sha_boot", "S09_sha_shadow_NEW", "S10_sha_learn_NEW",
                "S11_sha_counts_NEW", "S12_sha_bins_NEW",
                "S13_rows", "S14_fields", "S15_header_grid", "S16_other_rows"]
             + ["G%02d_%s_%s" % (i + 1, p, g) for i, (p, g) in enumerate((p, g) for p in PERIODS for g in G11)]
             + ["G23_rises", "G24_limb_overlap",
                "B01_inputs_wellformed", "B02_same_hours", "B03_raw_same", "B04_clock_cols", "B05_new_own_truth",
                "B06_old_own_truth", "B07_shown_recomputed", "B08_own_truth_rebuilt", "B09_counts_file",
                "B11_common_fixed", "B10a_mae_all", "B10b_mae_lf_rising", "B10c_mae_low_water",
                "H01_pending_end", "H02_rates", "H03_jump_p99", "H04_jumps_ge5",
                "I01_design_mae_all", "I01_design_mae_lf_rising", "I01_design_mae_low_water",
                "I02_new_travel_same", "I03_clockq_lfcap", "I04_hard_in_common", "I05_unjoined",
                "M01_err15_margin", "M02_err15_exact", "M03_cap_margin", "M04_lfrise_margin", "M05_due_knife",
                "M06_floor_margin", "M07_jump_margin"])

ACC_STEPS = [("movement", ["read", "no_estimate", "burn_in", "old_nonpositive"])]
for _s in ("common_central", "common_long", "common_short"):
    ACC_STEPS.append((_s, ["read", "no_estimate", "burn_in", "truth_missing", "truth_out_of_range",
                           "hard_flag_either"]))
ACC_STEPS.append(("two_by_two", ["read", "no_estimate_either", "burn_in", "truth_missing_either",
                                 "status_not_predicted_either", "hard_flag_either", "truth_out_of_range_either",
                                 "blank_error_either"]))
for _s in ("self_OLD", "self_NEW"):
    ACC_STEPS.append((_s, ["read", "hard_skipped", "burn_in", "no_shadow_estimate", "truth_missing"]))


def _lh_keys():
    out = []
    for run in RUNS:
        out += [(run, "whole_run", m) for m in LH_BLOCK1]
        # ORDER ASSUMPTION (spec 10 does not say period-major or metric-major): period outer, metric inner
        out += [(run, p, m) for p in ("burnin", "design", "test") for m in LH_BLOCK2]
        out += [(run, p, m) for p in PERIODS for m in LH_BLOCK3]
    return out


FILES = {
    "badly_low_rising.csv": dict(
        header="period,truth,run,n,n_low,low_share", keycols=["period", "truth", "run"], nrows=18, exact=True,
        keys=[(p, t, r) for p in PERIODS for t in TRUTHS for r in ("OLD", "NEW", "NEW_minus_OLD")]),
    "movement.csv": dict(
        header="period,group,n,n_excluded,mean,median,p05,p95,share_ge5,n_up,n_down,n_same,direction_by_count",
        keycols=["period", "group"], nrows=20, exact=False, keys=[(p, g) for p in PERIODS for g in G10]),
    "groups.csv": dict(
        header="period,group,n,n_central,n_long,n_short,n_two_by_two", keycols=["period", "group"], nrows=22,
        exact=True, keys=[(p, g) for p in PERIODS for g in G11]),
    "two_by_two.csv": dict(
        header="period,group,run,truth,n,mae,bias,off,low,high", keycols=["period", "group", "run", "truth"],
        nrows=80, exact=False,
        keys=[(p, g, r, t) for p in PERIODS for g in G10 for r in RUNS for t in ("own", "other")]),
    "common_truth_errors.csv": dict(
        header="period,group,truth,run,n,mae,bias,off,low,high", keycols=["period", "group", "truth", "run"],
        nrows=120, exact=False, keys=[(p, g, t, r) for p in PERIODS for g in G10 for t in TRUTHS for r in RUNS]),
    "new_cap_yardsticks.csv": dict(
        header="period,group,truth,comparison,n,mae_app,mae_other,n_low_app,n_low_other,mean_d,lo,hi,n_valid,"
               "n_skipped,label",
        keycols=["period", "group", "truth", "comparison"], nrows=180, exact=False,
        keys=[(p, g, t, c) for p in PERIODS for g in G10 for t in TRUTHS for c in COMPS]),
    "new_readings.csv": dict(
        header="period,group,comparison,label_central,label_long,label_short,reading,holds",
        keycols=["period", "group", "comparison"], nrows=60, exact=True,
        keys=[(p, g, c) for p in PERIODS for g in G10 for c in COMPS]),
    "self_report.csv": dict(
        header="period,run,n_rows,n_learned,n_joined,n_unjoined,validations_per_day,learned_per_day,n_low15,"
               "low15_share,n_inband,inband_share",
        keycols=["period", "run"], nrows=4, exact=False, keys=[(p, r) for p in PERIODS for r in RUNS]),
    "learning_health.csv": dict(
        header="run,period,metric,value,source", keycols=["run", "period", "metric"], nrows=82, exact=False,
        keys=_lh_keys()),
    "checks.csv": dict(
        header="id,description,expected,got,result", keycols=["id"], nrows=89, exact=True,
        keys=[(i,) for i in CHECK_IDS]),
    "row_accounting.csv": dict(
        header="scope,step,condition,rows_in,rows_dropped,rows_left", keycols=["scope", "step"], nrows=40,
        exact=True, keys=[(s, str(i)) for s, names in ACC_STEPS for i in range(len(names))]),
}
ORDER = ["badly_low_rising.csv", "movement.csv", "groups.csv", "two_by_two.csv", "common_truth_errors.csv",
         "new_cap_yardsticks.csv", "new_readings.csv", "self_report.csv", "learning_health.csv", "checks.csv",
         "row_accounting.csv"]
assert sorted(ORDER) == sorted(FILES)
for _f, _d in FILES.items():
    _d["cols"] = _d["header"].split(",")
    assert len(_d["keys"]) == _d["nrows"], (_f, len(_d["keys"]), _d["nrows"])
    assert len(set(_d["keys"])) == len(_d["keys"]), _f
    assert all(len(k) == len(_d["keycols"]) for k in _d["keys"]), _f
assert [len(FILES[f]["keys"]) for f in ORDER] == [18, 20, 22, 80, 120, 180, 60, 4, 82, 89, 40]
# step texts of row_accounting (condition column), per key order
ACC_CONDITIONS = [n for _s, names in ACC_STEPS for n in names]

# section 15 item 2a: text columns; integer columns per 13.1; every other column is a %.6f decimal
TEXT_COLS = {"period", "group", "run", "truth", "comparison", "label", "label_central", "label_long", "label_short",
             "reading", "direction_by_count", "metric", "source", "scope", "condition", "id", "description",
             "expected", "got", "result"}
INT_PLAIN = {"n", "step", "rows_in", "rows_dropped", "rows_left", "holds"}


def col_type(col):
    """'text', 'int', 'dec' or 'value' (learning_health.value, typed by its text)."""
    if col in TEXT_COLS:
        return "text"
    if col == "value":
        return "value"
    if col in INT_PLAIN or col.startswith("n_"):
        return "int"
    return "dec"


for _f, _d in FILES.items():
    for _c in _d["cols"]:
        assert col_type(_c) in ("text", "int", "dec", "value")


# ---------------------------------------------------------------- cell helpers
def micro(s):
    neg = s.startswith("-")
    a, b = s.lstrip("-").split(".")
    v = int(a) * 1000000 + int(b)
    return -v if neg else v


def kind(v):
    if v == "":
        return "blank"
    if RE_DEC.match(v):
        return "dec"
    if RE_INT.match(v):
        return "int"
    return "text"


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
    return "numeric cell is not blank, an integer or %.6f (exponent, plus sign, wrong number of decimals, text)"


def read_raw(path, side, probs):
    """Rows (list of field lists) of one side, or None when unusable. Adds raw-byte problems to probs."""
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError as e:
        probs.append(("-", "-", "", "", "cannot read %s file: %s" % (side, e)))
        return None, b""
    if len(raw) == 0:
        probs.append(("-", "-", "", "", "%s file is empty" % side))
        return None, raw
    if raw.startswith(b"\xef\xbb\xbf"):
        probs.append(("-", "-", "", "", "%s file starts with a byte-order mark" % side))
    if b'"' in raw:
        probs.append(("-", "-", "", "", "%s file contains a quote character" % side))
    if b"\r" in raw:
        probs.append(("-", "-", "", "", "%s file contains a CR character" % side))
    if not raw.endswith(b"\n"):
        probs.append(("-", "-", "", "", "%s file has no final newline" % side))
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        probs.append(("-", "-", "", "", "%s file is not valid UTF-8" % side))
        return None, raw
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return [ln.split(",") for ln in lines], raw


def check_side(fname, rows, side, probs, keyprobs):
    """Header, row count, field count, key and format guards of one side. True when cells can be compared."""
    spec = FILES[fname]
    header = spec["cols"]
    if rows[0] != header:
        probs.append(("-", "header", ",".join(rows[0]), ",".join(header),
                      "%s file has a different header than expected" % side))
        return False
    data = rows[1:]
    if len(data) != spec["nrows"]:
        probs.append(("-", "rows", str(len(data)), str(spec["nrows"]),
                      "%s file has %d data rows, %d expected" % (side, len(data), spec["nrows"])))
    ok = True
    kidx = [header.index(c) for c in spec["keycols"]]
    for i, r in enumerate(data):
        if len(r) != len(header):
            probs.append(("row %d" % (i + 1), "-", str(len(r)), str(len(header)),
                          "%s wrong number of fields" % side))
            ok = False
            continue
        key = "|".join(r[j] for j in kidx)
        for j, v in enumerate(r):
            col = header[j]
            if v != v.strip():
                probs.append((key, col, v, "", "%s leading or trailing space" % side))
            if RE_NEGZERO.search(v):
                probs.append((key, col, v, "", "%s negative zero (-0.000000)" % side))
            elif col_type(col) != "text":
                g = guard(v)
                if g:
                    probs.append((key, col, v, "", "%s format: %s" % (side, g)))
        if i < len(spec["keys"]):
            exp = spec["keys"][i]
            if tuple(r[j] for j in kidx) != exp:
                keyprobs.setdefault(i + 1, []).append((side, "|".join(r[j] for j in kidx), "|".join(exp)))
        else:
            keyprobs.setdefault(i + 1, []).append((side, "|".join(r[j] for j in kidx), "<no row expected>"))
    return ok


def compare_cells(fname, A, B, probs, diffcols):
    spec = FILES[fname]
    header = spec["cols"]
    kidx = [header.index(c) for c in spec["keycols"]]
    for i in range(1, min(len(A), len(B))):
        ra, rb = A[i], B[i]
        key = "|".join(ra[j] for j in kidx)
        for j, col in enumerate(header):
            a, b = ra[j], rb[j]
            if a == b:
                continue
            ct = col_type(col)
            ka, kb = kind(a), kind(b)
            if "blank" in (ka, kb):
                probs.append((key, col, a, b, "blank against a value"))
            elif {ka, kb} == {"dec", "int"}:
                probs.append((key, col, a, b, "FORMAT difference (different number of decimals)"))
            elif spec["exact"]:
                probs.append((key, col, a, b, "must be equal as text (tolerance 0)"))
            elif ct == "text" or ct == "int" or ka != "dec" or kb != "dec":
                probs.append((key, col, a, b, "%s column must be equal as text" % ("text" if ct == "text" else
                                                                                 "integer" if ct == "int" else
                                                                                 "integer-typed value")))
            else:
                d = abs(micro(a) - micro(b))
                if d <= TOL_MICRO:
                    c = diffcols.setdefault(col, [0, 0, ""])
                    c[0] += 1
                    if d > c[1] or not c[2]:
                        c[1], c[2] = d, key
                else:
                    probs.append((key, col, a, b, "decimals differ by %.6f, more than 0.01" % (d / 1e6)))


def compare_file(fname, da, db):
    """(status, probs, diffcols, byte_identical); status in IDENTICAL, WITHIN, DIFFER."""
    probs, diffcols = [], {}
    pa, pb = os.path.join(da, fname), os.path.join(db, fname)
    ea, eb = os.path.isfile(pa), os.path.isfile(pb)
    if not ea or not eb:
        side = "both folders" if not ea and not eb else ("the second folder" if ea else "the first folder")
        probs.append(("-", "-", "", "", "file missing in " + side))
        return "DIFFER", probs, diffcols, False
    A, rawa = read_raw(pa, "first-folder", probs)
    B, rawb = read_raw(pb, "second-folder", probs)
    if A is None or B is None:
        return "DIFFER", probs, diffcols, False
    kpa, kpb = {}, {}
    oka = check_side(fname, A, "first-folder", probs, kpa)
    okb = check_side(fname, B, "second-folder", probs, kpb)
    for i in sorted(set(kpa) | set(kpb)):
        for side, found, exp in kpa.get(i, []) + kpb.get(i, []):
            probs.append(("row %d" % i, "key", found, exp, "%s key is not the expected key (expected order of 13.2)" % side))
    if len(A) != len(B):
        probs.append(("-", "rows", str(len(A) - 1), str(len(B) - 1), "the two files have different numbers of data rows"))
    elif oka and okb and not kpa and not kpb:
        compare_cells(fname, A, B, probs, diffcols)
    same = rawa == rawb
    if probs:
        return "DIFFER", probs, diffcols, same
    if same:
        return "IDENTICAL", probs, diffcols, True
    if not diffcols:
        probs.append(("-", "-", "", "", "files differ as bytes but no cell differs"))
        return "DIFFER", probs, diffcols, False
    return "WITHIN", probs, diffcols, False


def run(da, db):
    bad = False
    for d, side in ((da, "first"), (db, "second")):
        if not os.path.isdir(d):
            print("%s folder does not exist: %s" % (side, d))
            bad = True
    if bad:
        print("SUMMARY: folder missing")
        print("DIFFER")
        return 1
    n_ident = n_within = n_differ = 0
    for fname in ORDER:
        status, probs, diffcols, same = compare_file(fname, da, db)
        byte = "BYTE-IDENTICAL: %s" % ("yes" if same else "no")
        if status == "IDENTICAL":
            n_ident += 1
            print("%s: IDENTICAL (byte for byte)  %s" % (fname, byte))
        elif status == "WITHIN":
            n_within += 1
            cnt = sum(v[0] for v in diffcols.values())
            colname, (_, mx, mk) = max(diffcols.items(), key=lambda kv: kv[1][1])
            print("%s: EQUAL WITHIN TOLERANCE (%d decimal cells differ, columns %s; largest absolute difference "
                  "%.6f in column %s at key %s)  %s"
                  % (fname, cnt, ",".join(c for c in FILES[fname]["cols"] if c in diffcols), mx / 1e6, colname, mk,
                     byte))
        else:
            n_differ += 1
            print("%s: DIFFER (%d problem(s), first %d shown)  %s"
                  % (fname, len(probs), min(MAXPRINT, len(probs)), byte))
            for rowkey, col, a, b, msg in probs[:MAXPRINT]:
                print("    key=%s column=%s first=%r second=%r : %s" % (rowkey, col, a, b, msg))
    names = set(ORDER)
    one = [set(f for f in os.listdir(d) if f.endswith(".csv") and f not in names and os.path.isfile(os.path.join(d, f)))
           for d in (da, db)]
    extra = sorted(one[0] ^ one[1])
    for f in extra:
        print("%s: DIFFER (a .csv file of another name on the %s folder only)" % (f, "first" if f in one[0] else "second"))
    allok = n_differ == 0 and not extra
    print("SUMMARY: %d files: %d IDENTICAL, %d EQUAL WITHIN TOLERANCE, %d DIFFER; %d extra .csv on one side only"
          % (len(ORDER), n_ident, n_within, n_differ, len(extra)))
    print("AGREE" if allok else "DIFFER")
    return 0 if allok else 1


# ---------------------------------------------------------------- self test
def synth_rows(fname):
    spec = FILES[fname]
    header = spec["cols"]
    rows = []
    for i, key in enumerate(spec["keys"]):
        kv = dict(zip(spec["keycols"], key))
        r = []
        for c in header:
            if c in kv:
                r.append(kv[c])
                continue
            t = col_type(c)
            if fname == "learning_health.csv":
                if c == "value":
                    r.append("1" if kv["metric"] in LH_INT_METRICS else "0.500000")
                else:
                    r.append("counts_file")
            elif fname == "row_accounting.csv" and c == "condition":
                r.append(ACC_CONDITIONS[i])
            elif fname == "checks.csv":
                r.append(key[0] if c == "description" else {"expected": "0", "got": "0", "result": "P"}[c])
            elif t == "text":
                r.append({"reading": "unclear", "direction_by_count": "equal"}.get(c, "unclear"))
            elif t == "int":
                r.append("1")
            else:
                r.append("0.500000")
        rows.append(r)
    if fname == "new_cap_yardsticks.csv":   # one empty-set row: blanks on both sides must compare equal
        for c in ("mae_app", "mae_other", "mean_d", "lo", "hi"):
            rows[0][header.index(c)] = ""
    return rows


def make_folder(d):
    os.makedirs(d, exist_ok=True)
    for fname in ORDER:
        with open(os.path.join(d, fname), "w", encoding="utf-8", newline="") as f:
            f.write(",".join(FILES[fname]["cols"]) + "\n")
            for r in synth_rows(fname):
                f.write(",".join(r) + "\n")


def edit_lines(path, fn):
    with open(path, encoding="utf-8", newline="") as f:
        lines = f.read().split("\n")
    fn(lines)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write("\n".join(lines))


def set_cell(path, line, col, value):
    ci = FILES[os.path.basename(path)]["cols"].index(col)

    def fn(lines):
        p = lines[line].split(",")
        p[ci] = value
        lines[line] = ",".join(p)
    edit_lines(path, fn)


def self_test():
    fails = 0
    ncase = 0
    # structural sanity of the tables against the contract
    assert FILES["learning_health.csv"]["keys"][0] == ("OLD", "whole_run", "slots_stored")
    assert FILES["checks.csv"]["keys"][-1] == ("M07_jump_margin",) and len(CHECK_IDS) == 89
    assert FILES["row_accounting.csv"]["keys"][4] == ("common_central", "0")
    with tempfile.TemporaryDirectory() as tmp:
        def case(name, setup, want_code, want_in_output, not_in_output=()):
            nonlocal fails, ncase
            ncase += 1
            a, b = os.path.join(tmp, "a%d" % ncase), os.path.join(tmp, "b%d" % ncase)
            make_folder(a)
            make_folder(b)
            setup(a, b)
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                code = run(a, b)
            out = buf.getvalue()
            ok = (code == want_code and all(w in out for w in want_in_output)
                  and not any(w in out for w in not_in_output)
                  and out.rstrip("\n").split("\n")[-1] == ("AGREE" if want_code == 0 else "DIFFER"))
            print("%-70s %s" % (name, "ok" if ok else "FAILED"))
            if not ok:
                fails += 1
                print("  expected code %d, wanted %r; got code %d:\n%s" % (want_code, list(want_in_output), code, out))

        P = os.path.join
        L = 3   # a data line (header is line 0)
        Z = 1   # all-ones file position used for exact files

        case("identical files", lambda a, b: None, 0,
             ["BYTE-IDENTICAL: yes", "SUMMARY: 11 files: 11 IDENTICAL, 0 EQUAL WITHIN TOLERANCE, 0 DIFFER"],
             ["BYTE-IDENTICAL: no"])
        case("decimal difference 0.004 inside tolerance",
             lambda a, b: set_cell(P(b, "movement.csv"), L, "mean", "0.504000"), 0,
             ["movement.csv: EQUAL WITHIN TOLERANCE (1 decimal cells differ, columns mean; largest absolute "
              "difference 0.004000 in column mean", "BYTE-IDENTICAL: no", "1 EQUAL WITHIN TOLERANCE"])
        case("decimal difference exactly 0.01 inside tolerance",
             lambda a, b: set_cell(P(b, "common_truth_errors.csv"), L, "mae", "0.510000"), 0,
             ["common_truth_errors.csv: EQUAL WITHIN TOLERANCE", "0.010000"])
        case("negative decimals inside tolerance (-0.495 vs -0.5)",
             lambda a, b: (set_cell(P(a, "two_by_two.csv"), L, "bias", "-0.500000"),
                           set_cell(P(b, "two_by_two.csv"), L, "bias", "-0.495000")), 0,
             ["two_by_two.csv: EQUAL WITHIN TOLERANCE", "0.005000"])
        case("two columns inside tolerance, largest reported",
             lambda a, b: (set_cell(P(b, "movement.csv"), L, "p05", "0.502000"),
                           set_cell(P(b, "movement.csv"), L + 1, "p95", "0.508000")), 0,
             ["columns p05,p95", "0.008000 in column p95"])
        case("decimal difference 0.010001 outside tolerance",
             lambda a, b: set_cell(P(b, "movement.csv"), L, "mean", "0.510001"), 1,
             ["movement.csv: DIFFER", "more than 0.01", "key=design|rl_rises", "first='0.500000' second='0.510001'"])
        case("decimal difference 0.02 outside tolerance",
             lambda a, b: set_cell(P(b, "self_report.csv"), 2, "low15_share", "0.520000"), 1,
             ["self_report.csv: DIFFER", "more than 0.01"])
        case("integer column differs by 1 (tolerance file)",
             lambda a, b: set_cell(P(b, "movement.csv"), L, "n_up", "2"), 1,
             ["movement.csv: DIFFER", "integer column must be equal as text"])
        case("text difference (direction_by_count)",
             lambda a, b: set_cell(P(b, "movement.csv"), L, "direction_by_count", "lower"), 1,
             ["movement.csv: DIFFER", "text column must be equal as text"])
        case("text difference (label)",
             lambda a, b: set_cell(P(b, "new_cap_yardsticks.csv"), L, "label", "cap_closer"), 1,
             ["new_cap_yardsticks.csv: DIFFER", "text column"])
        case("blank against a number (decimal column)",
             lambda a, b: set_cell(P(b, "movement.csv"), L, "mean", ""), 1,
             ["movement.csv: DIFFER", "blank against a value"])
        case("number against a blank (decimal column)",
             lambda a, b: set_cell(P(a, "movement.csv"), L, "median", ""), 1, ["blank against a value"])
        case("blank against an integer",
             lambda a, b: set_cell(P(b, "self_report.csv"), 1, "n_rows", ""), 1, ["self_report.csv: DIFFER", "blank against"])
        case("blank on both sides is equal (empty-set row)", lambda a, b: None, 0, ["new_cap_yardsticks.csv: IDENTICAL"])
        case("FORMAT difference: decimal against integer text",
             lambda a, b: set_cell(P(b, "movement.csv"), L, "mean", "1"), 1, ["FORMAT difference"])
        case("FORMAT difference: count written as %.6f in value cell",
             lambda a, b: set_cell(P(b, "learning_health.csv"), 2, "value", "1.000000"), 1,
             ["learning_health.csv: DIFFER", "FORMAT difference"])
        case("learning_health value: decimal typed by text, 0.004 inside tolerance",
             lambda a, b: set_cell(P(b, "learning_health.csv"), 9, "value", "0.504000"), 0,
             ["learning_health.csv: EQUAL WITHIN TOLERANCE", "0.004000"])
        case("learning_health value: decimal 0.02 outside tolerance",
             lambda a, b: set_cell(P(b, "learning_health.csv"), 9, "value", "0.520000"), 1,
             ["learning_health.csv: DIFFER", "more than 0.01"])
        case("learning_health value: integer count off by 1 is exact",
             lambda a, b: set_cell(P(b, "learning_health.csv"), 2, "value", "2"), 1,
             ["learning_health.csv: DIFFER", "integer-typed value column must be equal as text"])
        case("exact file (badly_low_rising) with 0.004 difference",
             lambda a, b: set_cell(P(b, "badly_low_rising.csv"), L, "low_share", "0.504000"), 1,
             ["badly_low_rising.csv: DIFFER", "tolerance 0"])
        case("exact file (checks) text difference",
             lambda a, b: set_cell(P(b, "checks.csv"), 40, "got", "1"), 1, ["checks.csv: DIFFER", "tolerance 0"])
        case("exact file (groups) integer difference",
             lambda a, b: set_cell(P(b, "groups.csv"), 5, "n", "2"), 1, ["groups.csv: DIFFER", "tolerance 0"])
        case("exact file (row_accounting) integer difference",
             lambda a, b: set_cell(P(b, "row_accounting.csv"), 5, "rows_left", "2"), 1,
             ["row_accounting.csv: DIFFER", "tolerance 0"])
        case("exact file (new_readings) text difference",
             lambda a, b: set_cell(P(b, "new_readings.csv"), 5, "reading", "mixed"), 1,
             ["new_readings.csv: DIFFER", "tolerance 0"])
        case("negative n_low (NEW_minus_OLD) written the same is fine",
             lambda a, b: (set_cell(P(a, "badly_low_rising.csv"), 3, "n_low", "-4"),
                           set_cell(P(b, "badly_low_rising.csv"), 3, "n_low", "-4")), 0, ["badly_low_rising.csv: IDENTICAL"])
        case("missing file (second folder)", lambda a, b: os.remove(P(b, "self_report.csv")), 1,
             ["self_report.csv: DIFFER", "file missing in the second folder"])
        case("missing file (first folder)", lambda a, b: os.remove(P(a, "groups.csv")), 1,
             ["groups.csv: DIFFER", "file missing in the first folder"])
        case("missing file on both sides", lambda a, b: (os.remove(P(a, "groups.csv")), os.remove(P(b, "groups.csv"))), 1,
             ["file missing in both folders"])
        case("run stopped after checks.csv (other files missing)",
             lambda a, b: [os.remove(P(d, f)) for d in (a, b) for f in ORDER if f != "checks.csv"], 1,
             ["badly_low_rising.csv: DIFFER", "checks.csv: IDENTICAL", "10 DIFFER"])
        case("extra .csv on one side only",
             lambda a, b: open(P(b, "scratch.csv"), "w").close(), 1,
             ["scratch.csv: DIFFER (a .csv file of another name on the second folder only)", "1 extra .csv"])
        case("extra .csv on the first side only",
             lambda a, b: open(P(a, "old_copy.csv"), "w").close(), 1, ["on the first folder only"])
        case("extra .csv on both sides and a non-csv file are ignored",
             lambda a, b: (open(P(a, "x.csv"), "w").close(), open(P(b, "x.csv"), "w").close(),
                           open(P(b, "notes.txt"), "w").close()), 0, ["0 extra .csv"])
        case("empty file", lambda a, b: open(P(b, "movement.csv"), "w").close(), 1, ["movement.csv: DIFFER", "is empty"])

        def swap_rows(a, b):
            edit_lines(P(b, "movement.csv"), lambda L_: L_.__setitem__(slice(2, 4), [L_[3], L_[2]]))
        case("different row order (two rows swapped)", swap_rows, 1,
             ["movement.csv: DIFFER", "key is not the expected key"])
        case("different row order in an exact file", lambda a, b: edit_lines(
            P(b, "groups.csv"), lambda L_: L_.__setitem__(slice(1, 3), [L_[2], L_[1]])), 1,
             ["groups.csv: DIFFER", "key is not the expected key"])

        def shared_wrong_key(a, b):
            for d in (a, b):
                set_cell(P(d, "movement.csv"), 5, "group", "low_water_x")
        case("key wrong on both sides (they agree with each other)", shared_wrong_key, 1,
             ["movement.csv: DIFFER", "expected order"])
        case("different header (renamed column)",
             lambda a, b: edit_lines(P(b, "movement.csv"), lambda L_: L_.__setitem__(0, L_[0].replace("median", "med"))), 1,
             ["movement.csv: DIFFER", "different header"])
        case("different header (columns swapped, both sides)",
             lambda a, b: [edit_lines(P(d, "groups.csv"), lambda L_: L_.__setitem__(
                 0, "period,group,n,n_long,n_central,n_short,n_two_by_two")) for d in (a, b)], 1,
             ["groups.csv: DIFFER", "different header"])
        case("different number of data rows (last row dropped, one side)",
             lambda a, b: edit_lines(P(b, "self_report.csv"), lambda L_: (L_.pop(-1), L_.pop(-1))) or
             edit_lines(P(b, "self_report.csv"), lambda L_: L_.append("")), 1,
             ["self_report.csv: DIFFER", "different numbers of data rows", "3 data rows, 4 expected"])
        case("extra data row (one side)",
             lambda a, b: edit_lines(P(b, "self_report.csv"), lambda L_: L_.insert(-1, "test,NEW,1,1,1,1,0.5,0.5,1,0.5,1,0.5")), 1,
             ["self_report.csv: DIFFER", "different numbers of data rows"])
        case("header only (run stopped early), both sides",
             lambda a, b: [edit_lines(P(d, "checks.csv"), lambda L_: L_.__setitem__(slice(1, None), [""])) for d in (a, b)], 1,
             ["checks.csv: DIFFER", "0 data rows, 89 expected"])
        case("wrong field count", lambda a, b: edit_lines(P(b, "movement.csv"), lambda L_: L_.__setitem__(3, L_[3] + ",1")), 1,
             ["movement.csv: DIFFER", "wrong number of fields"])
        case("exponent notation", lambda a, b: set_cell(P(b, "movement.csv"), L, "mean", "1e-05"), 1,
             ["movement.csv: DIFFER", "numeric cell is not blank"])
        case("NA in a numeric cell", lambda a, b: set_cell(P(b, "movement.csv"), L, "mean", "NA"), 1,
             ["missing-value token"])
        case("NaN and Inf", lambda a, b: (set_cell(P(a, "movement.csv"), L, "mean", "NaN"),
                                          set_cell(P(b, "movement.csv"), L, "mean", "Inf")), 1,
             ["missing-value token"])
        case("plus sign", lambda a, b: set_cell(P(b, "movement.csv"), L, "mean", "+0.500000"), 1, ["numeric cell is not blank"])
        case("wrong number of decimals (0.5000), both sides",
             lambda a, b: [set_cell(P(d, "movement.csv"), L, "mean", "0.5000") for d in (a, b)], 1,
             ["movement.csv: DIFFER", "numeric cell is not blank"])
        case("negative zero in a decimal cell",
             lambda a, b: set_cell(P(b, "movement.csv"), L, "mean", "-0.000000"), 1, ["negative zero"])
        case("negative zero on both sides (identical bytes still fail)",
             lambda a, b: [set_cell(P(d, "movement.csv"), L, "mean", "-0.000000") for d in (a, b)], 1,
             ["movement.csv: DIFFER", "negative zero"], ["movement.csv: IDENTICAL"])
        case("negative zero inside a text cell of checks.csv",
             lambda a, b: [set_cell(P(d, "checks.csv"), 40, "got", "-0.000000:0.5") for d in (a, b)], 1,
             ["checks.csv: DIFFER", "negative zero"])
        case("BOM", lambda a, b: [edit_lines(P(d, "groups.csv"), lambda L_: L_.__setitem__(0, "\ufeff" + L_[0])) for d in (a, b)], 1,
             ["groups.csv: DIFFER", "byte-order mark"])
        case("quote character", lambda a, b: set_cell(P(b, "checks.csv"), 3, "description", '"U03_time"'), 1,
             ["quote character"])
        case("CR character", lambda a, b: edit_lines(P(b, "groups.csv"), lambda L_: L_.__setitem__(2, L_[2] + "\r")), 1,
             ["CR character"])
        case("no final newline", lambda a, b: edit_lines(P(b, "groups.csv"), lambda L_: L_.pop()), 1, ["no final newline"])
        case("trailing space in a cell", lambda a, b: set_cell(P(b, "movement.csv"), L, "direction_by_count", "equal "), 1,
             ["leading or trailing space"])
        case("leading space in a number", lambda a, b: set_cell(P(b, "movement.csv"), L, "mean", " 0.500000"), 1,
             ["leading or trailing space"])
        case("invalid UTF-8", lambda a, b: open(P(b, "groups.csv"), "ab").write(b"\xff\xfe\n"), 1, ["not valid UTF-8"])
        case("one file within tolerance and one differing: overall DIFFER, summary counts",
             lambda a, b: (set_cell(P(b, "movement.csv"), L, "mean", "0.504000"),
                           set_cell(P(b, "groups.csv"), 5, "n", "9")), 1,
             ["movement.csv: EQUAL WITHIN TOLERANCE", "groups.csv: DIFFER", "9 IDENTICAL, 1 EQUAL WITHIN TOLERANCE, 1 DIFFER"])
        case("tolerance-only differences in several files agree (exit 0)",
             lambda a, b: (set_cell(P(b, "movement.csv"), L, "mean", "0.504000"),
                           set_cell(P(b, "two_by_two.csv"), L, "mae", "0.499000"),
                           set_cell(P(b, "self_report.csv"), 1, "inband_share", "0.500001")), 0,
             ["8 IDENTICAL, 3 EQUAL WITHIN TOLERANCE, 0 DIFFER"])
        case("DIFFER lists at most the first cells with keys",
             lambda a, b: [set_cell(P(b, "common_truth_errors.csv"), i, "mae", "9.000000") for i in range(1, 30)], 1,
             ["29 problem(s), first 8 shown", "key=design|all|central|OLD"])

        # command line behaviour without touching any real folder
        buf = io.StringIO()
        ncase += 1
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            c1 = main(["prog", "only_one_folder"])
            c2 = run(os.path.join(tmp, "no_such_a"), os.path.join(tmp, "no_such_b"))
        dflt = default_dirs()
        ok = (c1 == 2 and c2 == 1 and dflt[0].endswith(os.path.join("clock_build_2026-11-27", "py"))
              and dflt[1].endswith(os.path.join("clock_build_2026-11-27", "r")))
        print("%-70s %s" % ("usage error exits 2, missing folder exits 1, default folders py and r", "ok" if ok else "FAILED"))
        fails += 0 if ok else 1
    print("SELFTEST %d cases, %s" % (ncase, "ALL PASSED" if fails == 0 else "%d FAILED" % fails))
    return 0 if fails == 0 else 1


def default_dirs():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, "py"), os.path.join(base, "r")


def main(argv):
    ap = argparse.ArgumentParser(prog="compare_analysts.py", add_help=True,
                                 usage="python3 -I compare_analysts.py [PY_DIR R_DIR] | --self-test")
    ap.add_argument("folders", nargs="*")
    ap.add_argument("--self-test", action="store_true")
    try:
        args = ap.parse_args(argv[1:])
    except SystemExit as e:
        return 2 if e.code else 0
    if args.self_test:
        return 2 if args.folders else self_test()
    if len(args.folders) == 0:
        return run(*default_dirs())
    if len(args.folders) != 2:
        print("usage: python3 -I compare_analysts.py [PY_DIR R_DIR] | --self-test")
        return 2
    return run(args.folders[0], args.folders[1])


if __name__ == "__main__":
    sys.exit(main(sys.argv))

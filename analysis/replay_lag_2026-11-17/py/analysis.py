#!/usr/bin/env python3
"""Python analyst: implements ANALYSIS_SPEC.md with the standard library only (no pandas/numpy installed)."""
import csv, math, os, sys, bisect, statistics
from collections import Counter
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.dirname(HERE)
OUT = []        # (population, metric, value)
TEXT = []       # string-valued extras
BURN = "2011-12-04T05:00:00.000Z"
ERA2 = "2019-01-01T00:00:00.000Z"
MO12 = "2012-12-01T05:00:00.000Z"

def out(pop, met, val):
    OUT.append((pop, met, val))

def fnum(x):
    return float(x) if x != "" else None

def pct7(sorted_vals, q):
    n = len(sorted_vals)
    h = (n - 1) * q
    lo = math.floor(h)
    hi = min(lo + 1, n - 1)
    return sorted_vals[lo] + (h - lo) * (sorted_vals[hi] - sorted_vals[lo])

def med(v):
    return statistics.median(v)

def mean(v):
    return math.fsum(v) / len(v)

SHADOW_COLS = ["predTs", "status", "rawFinalCFS", "flowBin", "flowState", "age_por_h", "truthFlow",
               "truthInProdRange", "errPctRaw", "errPctCorr", "truthDependentHard", "predictedCFS",
               "porQ", "porSrcTs", "efStage", "efSrcTs", "gooseQ", "gooseSrcTs", "lfQ", "lfSrcTs"]

def load(path, cols=SHADOW_COLS):
    with open(path, newline="") as f:
        r = csv.reader(f)
        hdr = next(r)
        ix = [hdr.index(c) for c in cols]
        rows = {}
        order = []
        for line in r:
            d = {c: line[i] for c, i in zip(cols, ix)}
            rows[d["predTs"]] = d
            order.append(d["predTs"])
    return rows, order

# ---------- bootstrap indices (parsed once) ----------
months = [l.strip() for l in open(os.path.join(D, "months.csv")) if l.strip()][1:]
midx = {m: i for i, m in enumerate(months)}
BOOT = []
with open(os.path.join(D, "bootstrap_indices.csv"), newline="") as f:
    r = csv.reader(f)
    hdr = next(r)
    for line in r:
        c = Counter(midx[x] for x in line[1:])
        BOOT.append(list(c.items()))
print("bootstrap rows:", len(BOOT), "months:", len(months))

def boot_ci(pairs):
    sums = [0.0] * len(months)
    cnts = [0] * len(months)
    for p in pairs:
        sums[p["mi"]] += p["dc"]
        cnts[p["mi"]] += 1
    res = []
    skipped = 0
    for items in BOOT:
        s = 0.0; c = 0
        for i, m in items:
            if cnts[i]:
                s += m * sums[i]; c += m * cnts[i]
        if c == 0:
            skipped += 1
        else:
            res.append(s / c)
    res.sort()
    return pct7(res, 0.025), pct7(res, 0.975), skipped

def build_pairs(fpath, lpath, label, countpop=None):
    F, ordF = load(fpath)
    L, ordL = load(lpath)
    print(f"[{label}] rows F={len(F)} L={len(L)} common predTs={sum(1 for k in F if k in L)}")
    pairs = []
    n_both = 0
    for ts in ordF:
        f = F[ts]; l = L.get(ts)
        if l is None or f["status"] != "predicted" or l["status"] != "predicted":
            continue
        n_both += 1
        pairs.append((f, l))
    cnt = {"n_both_predicted": n_both}
    s = [(f, l) for f, l in pairs if f["predTs"] >= BURN]
    cnt["excl_burnin"] = len(pairs) - len(s); pairs = s
    s = [(f, l) for f, l in pairs if not (f["truthDependentHard"] == "1" or l["truthDependentHard"] == "1")]
    cnt["excl_hard"] = len(pairs) - len(s); pairs = s
    s = [(f, l) for f, l in pairs if not (f["truthInProdRange"] == "0" or l["truthInProdRange"] == "0")]
    cnt["excl_range"] = len(pairs) - len(s); pairs = s
    s = [(f, l) for f, l in pairs if f["errPctCorr"] != "" and f["errPctRaw"] != "" and l["errPctCorr"] != "" and l["errPctRaw"] != ""]
    cnt["excl_blank"] = len(pairs) - len(s); pairs = s
    cnt["n_scored"] = len(pairs)
    print(f"[{label}] counts:", cnt)
    if countpop:
        for k, v in cnt.items():
            out(countpop, k, v)
    recs = []
    for f, l in pairs:
        eFc, eLc = float(f["errPctCorr"]), float(l["errPctCorr"])
        eFr, eLr = float(f["errPctRaw"]), float(l["errPctRaw"])
        rf, rl = float(f["rawFinalCFS"]), float(l["rawFinalCFS"])
        state_diff = f["flowState"] != l["flowState"]
        bin_diff = f["flowBin"] != l["flowBin"]
        affected = (abs(rf - rl) / rl >= 0.01) or state_diff or bin_diff
        rising = f["flowState"] == "rising" or l["flowState"] == "rising"
        falling = (not rising) and (f["flowState"] == "falling" or l["flowState"] == "falling")
        steady = f["flowState"] == "steady" and l["flowState"] == "steady"
        flood = float(f["truthFlow"]) >= 50000 or float(l["truthFlow"]) >= 50000
        ts = f["predTs"]
        recs.append(dict(ts=ts, mo=ts[:7], mi=midx[ts[:7]], dc=abs(eFc) - abs(eLc), dr=abs(eFr) - abs(eLr),
                         aF=abs(eFc), aL=abs(eLc), sF=eFc, sL=eLc, aff=affected, sd=state_diff, bd=bin_diff,
                         ris=rising, fal=falling, st=steady, fl=flood, era2=ts >= ERA2,
                         ageF=fnum(f["age_por_h"]), ageL=fnum(l["age_por_h"])))
    return recs

def measures(pop, recs, extra_ci=True):
    n = len(recs)
    out(pop, "n_pairs", n)
    out(pop, "n_months", len(set(r["mo"] for r in recs)))
    if n == 0:
        print("  empty population", pop); return
    out(pop, "mean_d_corr", mean([r["dc"] for r in recs]))
    out(pop, "median_d_corr", med([r["dc"] for r in recs]))
    out(pop, "mean_d_raw", mean([r["dr"] for r in recs]))
    out(pop, "mean_abs_F", mean([r["aF"] for r in recs]))
    out(pop, "mean_abs_L", mean([r["aL"] for r in recs]))
    out(pop, "median_abs_F", med([r["aF"] for r in recs]))
    out(pop, "median_abs_L", med([r["aL"] for r in recs]))
    out(pop, "bias_F", mean([r["sF"] for r in recs]))
    out(pop, "bias_L", mean([r["sL"] for r in recs]))
    out(pop, "big25_F", 100.0 * sum(r["aF"] > 25 for r in recs) / n)
    out(pop, "big25_L", 100.0 * sum(r["aL"] > 25 for r in recs) / n)
    lo, hi, sk = boot_ci(recs)
    out(pop, "ci_lo", lo); out(pop, "ci_hi", hi); out(pop, "boot_skipped", sk)
    print(f"  {pop}: n={n} mean_d_corr={mean([r['dc'] for r in recs]):.6f} ci=({lo:.6f},{hi:.6f}) skipped={sk}")

def pops(recs):
    return {
        "all": recs,
        "affected": [r for r in recs if r["aff"]],
        "affected_rising": [r for r in recs if r["aff"] and r["ris"]],
        "affected_falling": [r for r in recs if r["aff"] and r["fal"]],
        "affected_flood": [r for r in recs if r["aff"] and r["fl"]],
        "flood_all": [r for r in recs if r["fl"]],
        "rising_any": [r for r in recs if r["ris"]],
        "steady_both": [r for r in recs if r["st"]],
        "affected_rising_era1": [r for r in recs if r["aff"] and r["ris"] and not r["era2"]],
        "affected_rising_era2": [r for r in recs if r["aff"] and r["ris"] and r["era2"]],
    }

# ---------- main + sensitivities ----------
main = build_pairs(os.path.join(D, "shadow_F.csv"), os.path.join(D, "shadow_L.csv"), "main", "counts")
n = len(main)
out("all", "share_affected", 100.0 * sum(r["aff"] for r in main) / n)
out("all", "share_state_differs", 100.0 * sum(r["sd"] for r in main) / n)
out("all", "share_bin_differs", 100.0 * sum(r["bd"] for r in main) / n)
for name, recs in pops(main).items():
    measures(name, recs)

def sens(name, recs):
    p = pops(recs)
    for k in ("affected_rising", "affected_flood"):
        measures(f"{name}.{k}", p[k])

sens("sens_F0L0", build_pairs(os.path.join(D, "shadow_F0.csv"), os.path.join(D, "shadow_L0.csv"), "F0L0"))
rest = [r for r in main if not ((r["ageF"] is not None and r["ageF"] > 1) or (r["ageL"] is not None and r["ageL"] > 2))]
print(f"[sens_age] scored {len(main)} -> {len(rest)}")
sens("sens_age", rest)
rest = [r for r in main if r["ts"] >= MO12]
print(f"[sens_12mo] scored {len(main)} -> {len(rest)}")
sens("sens_12mo", rest)
sens("sens_gateold", build_pairs(os.path.join(D, "shadow_F_gateold.csv"), os.path.join(D, "shadow_L_gateold.csv"), "gateold"))

# ---------- source data ----------
src = {}
with open(os.path.join(D, "..", "hourly_backtest_data_v361.csv"), newline="") as f:
    r = csv.DictReader(f)
    SRC_COLS = r.fieldnames
    for row in r:
        src[row["timestamp"]] = row
print("source columns:", SRC_COLS, "rows:", len(src))
TS_COL, POR_COL, LF_COL, EF_COL, GOOSE_COL = "timestamp", "por_now", "lf_discharge", "ef_stage", "goose"
T0 = datetime(2011, 12, 1, 5, 0)
def parse_src(t):
    return datetime.strptime(t, "%Y-%m-%d %H:%M")
def fmt_src(dt):
    return dt.strftime("%Y-%m-%d %H:%M")
def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
def parse_iso(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.000Z")
def srcval(dt, col):
    row = src.get(fmt_src(dt))
    if row is None or row[col] == "": return None
    return float(row[col])

# ---------- section 8 transient ----------
def lf_at(dt):
    return srcval(dt, LF_COL)
rowtimes = sorted(parse_src(t) for t in src)
events = []
last_flood = None
for t in rowtimes:
    v = lf_at(t)
    if v is not None and v >= 50000:
        if last_flood is None or (t - last_flood) >= timedelta(hours=169):
            events.append(t)
        last_flood = t
n_events_all = len(events)
events = [e for e in events if iso(e) >= MO12]
n_events = len(events)
print("events total", n_events_all, "kept", n_events)

# scored-set pairs of F (rows) with flowState/flowBin/raw
F, ordF = load(os.path.join(D, "shadow_F.csv"))
scored_ts = {r["ts"] for r in main}
scored_F = [F[ts] for ts in ordF if ts in scored_ts]
scored_keys = [f["predTs"] for f in scored_F]

def load_bins(path):
    d = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            d.setdefault(row["cell"], []).append((row["ts"], float(row["emaMeanError"])))
    return d
binsF = load_bins(os.path.join(D, "bins_F.csv"))
binsL = load_bins(os.path.join(D, "bins_L.csv"))
def bin_at(bins, cell, S):
    lst = bins.get(cell)
    if not lst: return None
    keys = [x[0] for x in lst]
    i = bisect.bisect_right(keys, S)
    return lst[i - 1][1] if i else None

n_norise = n_nobin = n_nopair = 0
offs = []
for E in events:
    S = None
    for k in range(0, 169):
        h = E - timedelta(hours=168) + timedelta(hours=k)   # earliest first
        p1 = srcval(h, POR_COL); p0 = srcval(h - timedelta(hours=1), POR_COL)
        if p1 is None or p0 is None or p1 <= 0 or p0 <= 0: continue
        if (p1 - p0) / p0 >= 0.02:
            S = h - timedelta(hours=24); break
    if S is None:
        n_norise += 1; continue
    Si = iso(S)
    i = bisect.bisect_left(scored_keys, Si)
    row = None
    while i < len(scored_F):
        if scored_F[i]["flowState"] == "rising":
            row = scored_F[i]; break
        i += 1
    if row is None:
        n_nopair += 1; continue
    cell = row["flowBin"] + "_" + row["flowState"]
    eF, eL = bin_at(binsF, cell, Si), bin_at(binsL, cell, Si)
    if eF is None or eL is None:
        n_nobin += 1; continue
    offs.append((eL - eF) / float(row["rawFinalCFS"]) * 100.0)
out("transient", "n_events", n_events)
out("transient", "n_events_norise", n_norise)
out("transient", "n_events_nobin", n_nobin)
out("transient", "n_events_nopair", n_nopair)
out("transient", "n_events_used", len(offs))
print("transient: events", n_events, "norise", n_norise, "nopair", n_nopair, "nobin", n_nobin, "used", len(offs))
for k in (1, 3, 6):
    sc = 0.7 ** (k - 1)
    o = [x * sc for x in offs]
    a = sorted(abs(x) for x in o)
    if not o: continue
    out("transient", f"median_abs_offset_k{k}_pct", med(a))
    out("transient", f"median_signed_offset_k{k}_pct", med(o))
    out("transient", f"p90_abs_offset_k{k}_pct", pct7(a, 0.9))

for date in ("2015-01-01", "2019-01-01", "2023-01-01"):
    sw, _ = load(os.path.join(D, f"switch_{date}.csv"))
    _, ordS = load(os.path.join(D, f"switch_{date}.csv"))
    rows = [(sw[ts], F[ts]) for ts in ordS if ts in F and sw[ts]["status"] == "predicted"
            and F[ts]["status"] == "predicted" and sw[ts]["flowState"] == "rising"]
    print(f"switch {date}: qualifying rows {len(rows)}")
    out("transient", f"n_switch_rows_{date}", len(rows))
    if not rows: continue
    real = [(float(s["predictedCFS"]) - float(f["predictedCFS"])) / float(f["rawFinalCFS"]) * 100.0 for s, f in rows]
    out("transient", f"realized_first_pct_{date}", real[0])
    TEXT.append(("transient", f"realized_first_predTs_{date}", rows[0][0]["predTs"]))
    S = datetime.strptime(date, "%Y-%m-%d"); Si = iso(S)
    s0 = rows[0][0]
    cell = s0["flowBin"] + "_" + s0["flowState"]
    eF, eL = bin_at(binsF, cell, Si), bin_at(binsL, cell, Si)
    if eF is not None and eL is not None:
        out("transient", f"formula_first_pct_{date}", (eL - eF) / float(s0["rawFinalCFS"]) * 100.0)
    else:
        print("  no bin for formula", date, cell, eF, eL)
    out("transient", f"realized_median_abs_first10_{date}", med([abs(x) for x in real[:10]]))
    out("transient", f"realized_median_abs_last10_{date}", med([abs(x) for x in real[-10:]]))

# ---------- section 9 lag check ----------
Ls, _ = load(os.path.join(D, "shadow_L.csv"))
checks = [("por", "porQ", "porSrcTs", POR_COL), ("ef", "efStage", "efSrcTs", EF_COL),
          ("goose", "gooseQ", "gooseSrcTs", GOOSE_COL), ("lf", "lfQ", "lfSrcTs", LF_COL)]
HRS = {"F": {"por": 1, "ef": 1, "goose": 1, "lf": 1}, "L": {"por": 2, "ef": 2, "goose": 2, "lf": 1}}
tot_rows = 0
mm_val = Counter(); mm_ts = Counter(); n_ts = Counter()
for arm, S_ in (("F", F), ("L", Ls)):
    nrows = 0
    for ts, d in S_.items():
        if d["status"] != "predicted": continue
        nrows += 1
        for name, vc, sc, col in checks:
            sts, v = d[sc], d[vc]
            if sts == "" and v == "":
                pass
            else:
                srow = None
                if sts != "":
                    srow = src.get(fmt_src(parse_iso(sts)))
                sv = srow[col] if srow else ""
                ok = (sv != "" and v != "" and math.isclose(float(sv), float(v), rel_tol=1e-9, abs_tol=1e-9))
                if not ok:
                    mm_val[(name, arm)] += 1
            nom = parse_iso(ts) - timedelta(hours=HRS[arm][name])
            if srcval(nom, col) is not None:
                n_ts[(name, arm)] += 1
                if sts != iso(nom):
                    mm_ts[(name, arm)] += 1
    out("lagcheck", f"lag_rows_{arm}", nrows)
    tot_rows += nrows
out("lagcheck", "lag_rows", tot_rows)
for name, vc, sc, col in checks:
    for arm in ("F", "L"):
        out("lagcheck", f"lag_mismatch_{vc}_{arm}", mm_val[(name, arm)])
        out("lagcheck", f"lag_mismatch_ts_{name}_{arm}", mm_ts[(name, arm)])
        out("lagcheck", f"lag_ts_rows_{name}_{arm}", n_ts[(name, arm)])
    out("lagcheck", f"lag_mismatch_{vc}", mm_val[(name, "F")] + mm_val[(name, "L")])
    out("lagcheck", f"lag_mismatch_ts_{name}", mm_ts[(name, "F")] + mm_ts[(name, "L")])
print("lag rows", tot_rows, dict(mm_val), dict(mm_ts))

with open(os.path.join(HERE, "metrics_python.csv"), "w", newline="") as f:
    w = csv.writer(f); w.writerow(["population", "metric", "value"])
    for p, m, v in OUT:
        w.writerow([p, m, repr(float(v)) if isinstance(v, float) else v])
with open(os.path.join(HERE, "metrics_python_text.csv"), "w", newline="") as f:
    w = csv.writer(f); w.writerow(["population", "metric", "value"])
    for r_ in TEXT: w.writerow(r_)
print("wrote", len(OUT), "metrics")

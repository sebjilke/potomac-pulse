#!/usr/bin/env python3
"""
Empirical backtest statistics for the dual-arm (single- vs multi-pending) learning
correction. Pure Python / numpy implementation. Deterministic point metrics are
designed to match a parallel R implementation to <0.01.

INPUT : analysis/multipending_residuals.csv
OUTPUT: analysis/multipending_metrics_python.csv  (one row per scope)
        + diagnostic printout to stdout
"""

import csv
import os
from datetime import datetime, timezone

import numpy as np

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IN_CSV = os.path.join(ROOT, "analysis", "multipending_residuals.csv")
OUT_CSV = os.path.join(ROOT, "analysis", "multipending_metrics_python.csv")

B_PRIMARY = 30
G_SECONDS = 24 * 3600          # event gap threshold
N_BOOT = 20000                 # bootstrap resamples
BOOT_SEED = 12345

STORM_BINS = {"12000-25000", "25000-50000", "50000+"}

# 18 cells = flowBin x flowState. We discover them from the data but keep a
# stable ordering: sorted by (flowBin, flowState).


# ----------------------------------------------------------------------------
# Load + parse
# ----------------------------------------------------------------------------
def parse_valts_epoch(s):
    """valTs is 'YYYY-MM-DD HH:MM' in UTC -> epoch seconds (append :00, treat UTC)."""
    dt = datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    return dt.timestamp()


def load_rows(path):
    rows = []
    with open(path, newline="") as fh:
        reader = csv.DictReader(fh)
        for r in reader:
            rec = {
                "valTs": r["valTs"],
                "valEpoch": parse_valts_epoch(r["valTs"]),
                "flowBin": r["flowBin"],
                "flowState": r["flowState"],
                "cell": r["flowBin"] + "_" + r["flowState"],
                "actualLF": float(r["actualLF"]),
                "resSingle": float(r["resSingle"]),
                "resMulti": float(r["resMulti"]),
                "rawResidual": float(r["rawResidual"]),
                "binCountSingleAtPred": float(r["binCountSingleAtPred"]),
                "binCountMultiAtPred": float(r["binCountMultiAtPred"]),
            }
            rec["minBinCount"] = min(
                rec["binCountSingleAtPred"], rec["binCountMultiAtPred"]
            )
            rec["aS"] = abs(rec["resSingle"])
            rec["aM"] = abs(rec["resMulti"])
            rec["delta"] = rec["aS"] - rec["aM"]  # positive => multi better
            rows.append(rec)
    return rows


# ----------------------------------------------------------------------------
# Filtering + event assignment
# ----------------------------------------------------------------------------
def filter_burnin(rows, B):
    return [r for r in rows if r["minBinCount"] >= B]


def assign_events(rows, G=G_SECONDS):
    """Sort by valTs epoch ascending, assign event_id starting at 0, increment
    whenever gap from previous row exceeds G. Mutates rows in place (event_id)."""
    srt = sorted(rows, key=lambda r: r["valEpoch"])
    eid = 0
    prev = None
    for r in srt:
        if prev is not None and (r["valEpoch"] - prev) > G:
            eid += 1
        r["event_id"] = eid
        prev = r["valEpoch"]
    return srt


# ----------------------------------------------------------------------------
# Per-scope deterministic metrics + bootstrap CI
# ----------------------------------------------------------------------------
def scope_metrics(scope_rows, rng):
    n = len(scope_rows)
    out = {"n_rows": n}
    if n == 0:
        # Degenerate scope: emit NaNs so the CSV row still exists.
        for k in [
            "mae_single", "mae_multi", "mae_delta", "median_single",
            "median_multi", "bias_single", "bias_multi", "pct_single",
            "pct_multi", "delta_ci_lo", "delta_ci_hi",
        ]:
            out[k] = float("nan")
        out["n_events"] = 0
        out["underpowered"] = 1
        return out

    aS = np.array([r["aS"] for r in scope_rows], dtype=float)
    aM = np.array([r["aM"] for r in scope_rows], dtype=float)
    resS = np.array([r["resSingle"] for r in scope_rows], dtype=float)
    resM = np.array([r["resMulti"] for r in scope_rows], dtype=float)
    actual = np.array([r["actualLF"] for r in scope_rows], dtype=float)

    out["mae_single"] = float(np.mean(aS))
    out["mae_multi"] = float(np.mean(aM))
    out["mae_delta"] = out["mae_single"] - out["mae_multi"]
    out["median_single"] = float(np.median(aS))
    out["median_multi"] = float(np.median(aM))
    out["bias_single"] = float(np.mean(resS))
    out["bias_multi"] = float(np.mean(resM))
    out["pct_single"] = float(np.mean(aS / actual) * 100.0)
    out["pct_multi"] = float(np.mean(aM / actual) * 100.0)

    # Event-level structure.
    ev_ids = sorted({r["event_id"] for r in scope_rows})
    n_events = len(ev_ids)
    out["n_events"] = n_events
    out["underpowered"] = 1 if n_events < 15 else 0

    # Event-level deltas (mean delta within each event).
    ev_delta = []
    by_event = {}
    for r in scope_rows:
        by_event.setdefault(r["event_id"], []).append(r["delta"])
    for eid in ev_ids:
        ev_delta.append(float(np.mean(by_event[eid])))
    ev_delta = np.array(ev_delta, dtype=float)

    # Percentile bootstrap on event_deltas.
    if n_events >= 1:
        idx = rng.integers(0, n_events, size=(N_BOOT, n_events))
        boot_means = ev_delta[idx].mean(axis=1)
        out["delta_ci_lo"] = float(np.percentile(boot_means, 2.5))
        out["delta_ci_hi"] = float(np.percentile(boot_means, 97.5))
    else:
        out["delta_ci_lo"] = float("nan")
        out["delta_ci_hi"] = float("nan")

    return out


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main():
    rows_all = load_rows(IN_CSV)

    # Primary B=30 filter + global event assignment on filtered rows.
    filt = filter_burnin(rows_all, B_PRIMARY)
    assign_events(filt, G_SECONDS)  # adds event_id to each filtered row

    # Build scopes ----------------------------------------------------------
    scopes = []  # list of (scope_name, rows)

    # (1) pooled
    scopes.append(("pooled", filt))

    # (2) 18 cells (sorted by (flowBin, flowState))
    cells = sorted({(r["flowBin"], r["flowState"]) for r in filt})
    for fb, fs in cells:
        name = fb + "_" + fs
        cell_rows = [r for r in filt if r["flowBin"] == fb and r["flowState"] == fs]
        scopes.append((name, cell_rows))

    # (3) storm_pooled
    storm_rows = [
        r for r in filt
        if r["flowState"] == "rising" and r["flowBin"] in STORM_BINS
    ]
    scopes.append(("storm_pooled", storm_rows))

    # Compute metrics per scope. Fresh RNG seeded once -> reproducible.
    rng = np.random.default_rng(BOOT_SEED)
    results = []
    for name, srows in scopes:
        m = scope_metrics(srows, rng)
        m["scope"] = name
        results.append(m)

    # ----------------------------------------------------------------------
    # Write CSV
    # ----------------------------------------------------------------------
    cols = [
        "scope", "n_rows", "n_events", "underpowered",
        "mae_single", "mae_multi", "mae_delta",
        "median_single", "median_multi",
        "bias_single", "bias_multi",
        "pct_single", "pct_multi",
        "delta_ci_lo", "delta_ci_hi",
    ]
    float_cols = {
        "mae_single", "mae_multi", "mae_delta", "median_single",
        "median_multi", "bias_single", "bias_multi", "pct_single",
        "pct_multi", "delta_ci_lo", "delta_ci_hi",
    }

    def fmt(col, val):
        if col in float_cols:
            return "" if val != val else f"{round(val, 4):.4f}"  # NaN check
        return val

    with open(OUT_CSV, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for m in results:
            w.writerow([fmt(c, m[c]) for c in cols])

    # ----------------------------------------------------------------------
    # Stdout: pooled + storm_pooled rows in full
    # ----------------------------------------------------------------------
    by_name = {m["scope"]: m for m in results}

    def print_full(name):
        m = by_name[name]
        print(f"=== {name} ===")
        for c in cols:
            v = m[c]
            if c in float_cols and v == v:
                print(f"  {c:14s} = {round(v, 4):.4f}")
            else:
                print(f"  {c:14s} = {v}")
        print()

    print("############################################################")
    print("# FULL SCOPE ROWS")
    print("############################################################\n")
    print_full("pooled")
    print_full("storm_pooled")

    # ----------------------------------------------------------------------
    # B-SWEEP: pooled mae_delta for B in {20,30,50,75}
    # ----------------------------------------------------------------------
    print("############################################################")
    print("# B-SWEEP (pooled mae_delta)")
    print("############################################################")
    for B in (20, 30, 50, 75):
        fr = filter_burnin(rows_all, B)
        aS = np.array([r["aS"] for r in fr], dtype=float)
        aM = np.array([r["aM"] for r in fr], dtype=float)
        md = float(np.mean(aS) - np.mean(aM))
        print(f"  B={B:3d}  n_rows={len(fr):7d}  pooled_mae_delta={round(md,4):.4f}")
    print()

    # ----------------------------------------------------------------------
    # TEMPORAL HOLDOUT: first 80% / last 20% chronological on B=30 rows
    # ----------------------------------------------------------------------
    print("############################################################")
    print("# TEMPORAL HOLDOUT (last 20% by valTs, B=30)")
    print("############################################################")
    srt = sorted(filt, key=lambda r: r["valEpoch"])
    n = len(srt)
    cut = int(np.floor(n * 0.8))  # first 80% are indices [0, cut)
    last20 = srt[cut:]
    aS = np.array([r["aS"] for r in last20], dtype=float)
    aM = np.array([r["aM"] for r in last20], dtype=float)
    n_ev_h = len({r["event_id"] for r in last20})
    mae_s = float(np.mean(aS))
    mae_m = float(np.mean(aM))
    print(f"  n_rows      = {len(last20)}")
    print(f"  n_events    = {n_ev_h}")
    print(f"  mae_single  = {round(mae_s,4):.4f}")
    print(f"  mae_multi   = {round(mae_m,4):.4f}")
    print(f"  mae_delta   = {round(mae_s - mae_m,4):.4f}")
    print()

    # ----------------------------------------------------------------------
    # RAW BASELINE sanity: mean(abs(rawResidual)) over B=30 filtered rows
    # ----------------------------------------------------------------------
    print("############################################################")
    print("# RAW BASELINE sanity (shared model error, B=30)")
    print("############################################################")
    raw = np.array([abs(r["rawResidual"]) for r in filt], dtype=float)
    print(f"  mean_abs_rawResidual = {round(float(np.mean(raw)),4):.4f}")
    print()

    # ----------------------------------------------------------------------
    # Plain reading
    # ----------------------------------------------------------------------
    pooled = by_name["pooled"]
    storm = by_name["storm_pooled"]
    overall_better = pooled["mae_delta"] > 0
    storm_better = storm["mae_delta"] > 0
    storm_up = storm["underpowered"] == 1

    print("############################################################")
    print("# PLAIN READING")
    print("############################################################")
    s1 = (
        f"Overall, multi {'reduces' if overall_better else 'does NOT reduce'} "
        f"corrected MAE (pooled mae_delta = {round(pooled['mae_delta'],4):.4f}, "
        f"95% CI [{round(pooled['delta_ci_lo'],4):.4f}, "
        f"{round(pooled['delta_ci_hi'],4):.4f}]); "
        f"in the storm cells it {'reduces' if storm_better else 'does NOT reduce'} "
        f"corrected MAE (storm mae_delta = {round(storm['mae_delta'],4):.4f}, "
        f"95% CI [{round(storm['delta_ci_lo'],4):.4f}, "
        f"{round(storm['delta_ci_hi'],4):.4f}])."
    )
    s2 = (
        f"The storm cells ARE underpowered (n_events = {storm['n_events']} < 15), "
        f"so the storm result is not reliable."
        if storm_up else
        f"The storm cells are adequately powered (n_events = {storm['n_events']} >= 15)."
    )
    print(s1)
    print(s2)


if __name__ == "__main__":
    main()

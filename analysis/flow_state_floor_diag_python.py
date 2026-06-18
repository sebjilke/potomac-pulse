#!/usr/bin/env python3
"""
Flow-state floor leverage diagnostic (Python implementation, blind dual-language).

Provenance: generating script for `flow_state_floor_diag_python.csv`.

Spec: analysis/flow-state-floor-diagnostic-spec-2026-06-18.md
Parent: analysis/flow-state-floor-methodology-2026-06-18.md (Tier 0 #0a)

READ-ONLY leverage diagnostic. No model/source file is modified. Implemented
INDEPENDENTLY from the spec + raw data only -- no R script, no *_R.csv, no other
agent output is read or reconciled.

Q1 -- floor-bite on the PoR state classifier (`getFlowState`, replicated exactly
       from netlify/functions/shared/model.js:173-199).
Q2 -- do low-flow correction bins differ by state (read-out of the existing raw
       residual log ci_residuals_v361_multi.csv; no model re-run).

Determinism: no randomness used.
"""

import os
import numpy as np
import pandas as pd

# ----------------------------------------------------------------------------
# Paths
# ----------------------------------------------------------------------------
ANALYSIS_DIR = "/Users/sebjilke/Desktop/PotomacPulse/analysis"
HOURLY_CSV = os.path.join(ANALYSIS_DIR, "hourly_backtest_data_v361.csv")
CI_CSV = os.path.join(ANALYSIS_DIR, "ci_residuals_v361_multi.csv")
OUT_CSV = os.path.join(ANALYSIS_DIR, "flow_state_floor_diag_python.csv")

SIX_H = np.timedelta64(6, "h")

LOW_FLOW = 6000.0      # PoR < 6000 == low flow (0-3000 + 3000-6000 bins)
FLOOR_BINDS = 5000.0   # 100-cfs floor binds for PoR < 5000 (100 > 0.02*current)
ABS_FLOOR = 100.0      # the floor (minAbsChange)
PCT = 0.02             # minPctChange

# ============================================================================
# Q1 -- replicate getFlowState EXACTLY on the PoR series.
#
# Live getFlowState (shared/model.js:173-199):
#   if (!history?.length || history.length < 8) return 'steady';
#   sixHoursAgo = now - 6h;  pastReading = last r in history with r.ts <= sixHoursAgo
#   if (!pastReading) return 'steady';
#   change = currentCFS - pastReading.cfs;
#   threshold = max(100, currentCFS * 0.02);    (Rule A -- live, with floor)
#   |change| >= threshold -> rising(change>0)/falling(change<0) else steady.
#
# In the backtest each row t plays the role of "now": currentCFS = por_now[t],
# history = all rows with ts <= t, and the 6h lookback is TIME-based (the data
# has non-1h gaps -- 'past' is the most recent row at-or-before t-6h, NOT index
# t-6). At-or-before selection technique mirrors the vetted flow_state_step1.py.
#
# Rule B (no floor): threshold = currentCFS * 0.02 only.
# ============================================================================

# Load PoR series; parse timestamps UTC, drop blank/NaN por_now, sort ascending.
series = pd.read_csv(HOURLY_CSV)
n_data_rows = len(series)
series["ts"] = pd.to_datetime(series["timestamp"], utc=True, format="%Y-%m-%d %H:%M")
series = series.dropna(subset=["por_now"]).copy()
series = series.sort_values("ts").reset_index(drop=True)

ts_arr = series["ts"].values.astype("datetime64[ns]")
por_arr = series["por_now"].values.astype(float)
N_SERIES = len(ts_arr)

# Vectorized classifier over every row index t (t serves as "now").
# n_hist = number of rows with ts <= t  == t + 1 (sorted, unique-enough). Use
# searchsorted(side='right') to honor any duplicate timestamps exactly.
t_times = ts_arr                                   # ref time for each row = its own ts
n_hist = np.searchsorted(ts_arr, t_times, side="right")     # rows with ts <= t
past_ref = t_times - SIX_H
n_past = np.searchsorted(ts_arr, past_ref, side="right")     # rows with ts <= t-6h

current = por_arr                                  # por_now[t]
# guard masks
guard_hist = n_hist >= 8                           # >= 8 prior history rows
guard_past = n_past >= 1                           # a row exists at-or-before t-6h
classifiable = guard_hist & guard_past

# past por_now at index n_past-1 (only valid where guard_past); use safe index
past_idx = np.where(guard_past, n_past - 1, 0)
past = por_arr[past_idx]
change = current - past
abs_change = np.abs(change)

thr_A = np.maximum(ABS_FLOOR, current * PCT)       # Rule A -- live (floor)
thr_B = current * PCT                              # Rule B -- relative-only (no floor)


def classify(abs_chg, chg, thr, ok):
    """Vectorized -> array of 'rising'/'falling'/'steady'. ok=False -> 'steady'."""
    out = np.full(len(chg), "steady", dtype=object)
    directional = ok & (abs_chg >= thr)
    out[directional & (chg > 0)] = "rising"
    out[directional & (chg < 0)] = "falling"
    # non-classifiable rows (guards fail) stay 'steady' -- but we only REPORT
    # over classifiable rows; the guards' 'steady' default matches the live code.
    return out


state_A = classify(abs_change, change, thr_A, classifiable)
state_B = classify(abs_change, change, thr_B, classifiable)

# PoR-keyed flow bin from `current` (LABELED as a PoR-keyed proxy, not the live
# GF-keyed getFlowBin(rawFinalUnclipped)).
def por_bin(c):
    if c < 3000:
        return "0-3000"
    if c < 6000:
        return "3000-6000"
    return "6000+"


por_bin_arr = np.array([por_bin(c) for c in current], dtype=object)

# Restrict to classifiable rows for all reporting.
cl = classifiable
cur_cl = current[cl]
sA = state_A[cl]
sB = state_B[cl]
absch_cl = abs_change[cl]
bin_cl = por_bin_arr[cl]

n_classifiable_total = int(cl.sum())

# --- Low-flow subsets ---
low_mask = cur_cl < LOW_FLOW          # PoR < 6000
floor_mask = cur_cl < FLOOR_BINDS     # PoR < 5000 (floor strictly binds)


def q1_block(sub_mask, label):
    """Compute floor-masked + false-flip fractions over a low-flow subset."""
    a = sA[sub_mask]
    b = sB[sub_mask]
    ac = absch_cl[sub_mask]
    n = len(a)
    if n == 0:
        return None
    # floor-masked directionality: A == steady but B in {rising,falling}
    masked = (a == "steady") & np.isin(b, ["rising", "falling"])
    masked_rising = (a == "steady") & (b == "rising")
    masked_falling = (a == "steady") & (b == "falling")
    n_masked = int(masked.sum())
    n_mr = int(masked_rising.sum())
    n_mf = int(masked_falling.sum())
    # false-flip companion: B yields rising/falling but |change| < 100 (the
    # no-floor rule mints a directional label that the floor suppresses --
    # the v35.0 noise concern). |change| < ABS_FLOOR captures exactly the
    # cases the floor (max(100,...)) would re-call steady at PoR < 5000;
    # at 5000<=PoR<6000 the floor never binds so B>=thr_B implies |chg|>=100.
    false_flip = np.isin(b, ["rising", "falling"]) & (ac < ABS_FLOOR)
    n_ff = int(false_flip.sum())
    return dict(
        subset=label,
        n_lowflow_classifiable=n,
        floor_masked_frac=n_masked / n,
        masked_rising_frac=n_mr / n,
        masked_falling_frac=n_mf / n,
        false_flip_frac=n_ff / n,
        n_floor_masked=n_masked,
        n_masked_rising=n_mr,
        n_masked_falling=n_mf,
        n_false_flip=n_ff,
    )


q1_lowflow = q1_block(low_mask, "por_now<6000")
q1_floorband = q1_block(floor_mask, "por_now<5000")

low_flow_share = q1_lowflow["n_lowflow_classifiable"] / n_classifiable_total

# --- State distribution under A vs B, por<6000, by PoR-keyed flow bin ---
dist_rows = []
for bin_label in ["0-3000", "3000-6000"]:
    bmask = low_mask & (bin_cl == bin_label)
    a = sA[bmask]
    b = sB[bmask]
    for rule_name, st in [("A_live", a), ("B_nofloor", b)]:
        dist_rows.append(dict(
            por_keyed_bin_proxy=bin_label,
            rule=rule_name,
            n=int(bmask.sum()),
            rising=int((st == "rising").sum()),
            steady=int((st == "steady").sum()),
            falling=int((st == "falling").sum()),
        ))

# ============================================================================
# Q2 -- do low-flow correction bins differ by state.
# Read-out of ci_residuals_v361_multi.csv. Group by (flowBin, flowState).
# Report mean RAW residual (what the learn-on-raw EMA converges to), SE
# (sd/sqrt(n), sample sd ddof=1), and count n. Q2 bins are GF-keyed (real
# makeGFPrediction output) -- correct by construction, NOT the PoR proxy.
# Bar (per-bin, pre-registered): max|state-mean - steady-mean| > 100 cfs AND
# > that bin's SE AND the differing directional state has n >= 30.
# ============================================================================
ci = pd.read_csv(CI_CSV)
LOW_BINS = ["0-3000", "3000-6000"]
STATES = ["rising", "steady", "falling"]

q2_cell_rows = []
q2_bin_verdicts = []
for bin_label in LOW_BINS:
    sub = ci[ci["flowBin"] == bin_label]
    cell_stats = {}
    for st in STATES:
        g = sub[sub["flowState"] == st]["rawResidual"].astype(float)
        n = int(g.shape[0])
        mean = float(g.mean()) if n > 0 else np.nan
        sd = float(g.std(ddof=1)) if n > 1 else np.nan
        se = float(sd / np.sqrt(n)) if n > 1 else np.nan
        cell_stats[st] = dict(mean=mean, sd=sd, se=se, n=n)
        q2_cell_rows.append(dict(
            flow_bin=bin_label, flow_state=st,
            mean_raw_residual=mean, se=se, sd=sd, n=n,
        ))
    # per-bin decision: compare rising & falling against steady
    steady_mean = cell_stats["steady"]["mean"]
    steady_n = cell_stats["steady"]["n"]
    diffs = {}
    for st in ["rising", "falling"]:
        m = cell_stats[st]["mean"]
        diffs[st] = abs(m - steady_mean) if (not np.isnan(m) and not np.isnan(steady_mean)) else np.nan
    # which state has the max |diff|
    valid_diffs = {k: v for k, v in diffs.items() if not np.isnan(v)}
    if valid_diffs:
        diff_state = max(valid_diffs, key=valid_diffs.get)
        max_abs_diff = valid_diffs[diff_state]
    else:
        diff_state = None
        max_abs_diff = np.nan
    # The bar uses "that bin's standard error". The most defensible per-cell SE
    # is the differing state's own SE (the cell whose mean is being contrasted).
    # We require the differing state itself to have n >= 30.
    diff_se = cell_stats[diff_state]["se"] if diff_state else np.nan
    diff_n = cell_stats[diff_state]["n"] if diff_state else 0
    pass_gt100 = bool(max_abs_diff > 100.0) if not np.isnan(max_abs_diff) else False
    pass_gtse = bool(max_abs_diff > diff_se) if (not np.isnan(max_abs_diff) and not np.isnan(diff_se)) else False
    pass_n30 = bool(diff_n >= 30)
    verdict = pass_gt100 and pass_gtse and pass_n30
    q2_bin_verdicts.append(dict(
        flow_bin=bin_label,
        steady_mean=steady_mean, steady_n=steady_n,
        max_abs_diff=max_abs_diff, differing_state=diff_state,
        differing_state_se=diff_se, differing_state_n=diff_n,
        pass_gt_100cfs=pass_gt100, pass_gt_se=pass_gtse, pass_n_ge_30=pass_n30,
        bin_clears_bar=verdict,
    ))

# ============================================================================
# Write tidy CSV capturing Q1 fractions + Q2 per-cell stats.
# ============================================================================
tidy = []

# Q1 floor-bite fractions (both low-flow subsets)
for blk in [q1_lowflow, q1_floorband]:
    tidy.append(dict(
        section="Q1_floor_bite", metric="floor_masked_frac",
        subset=blk["subset"], flow_bin="", flow_state="",
        value=blk["floor_masked_frac"], n=blk["n_lowflow_classifiable"],
        extra=f"n_masked={blk['n_floor_masked']}",
    ))
    tidy.append(dict(
        section="Q1_floor_bite", metric="masked_rising_frac",
        subset=blk["subset"], flow_bin="", flow_state="",
        value=blk["masked_rising_frac"], n=blk["n_lowflow_classifiable"],
        extra=f"n={blk['n_masked_rising']}",
    ))
    tidy.append(dict(
        section="Q1_floor_bite", metric="masked_falling_frac",
        subset=blk["subset"], flow_bin="", flow_state="",
        value=blk["masked_falling_frac"], n=blk["n_lowflow_classifiable"],
        extra=f"n={blk['n_masked_falling']}",
    ))
    tidy.append(dict(
        section="Q1_floor_bite", metric="false_flip_frac",
        subset=blk["subset"], flow_bin="", flow_state="",
        value=blk["false_flip_frac"], n=blk["n_lowflow_classifiable"],
        extra=f"n={blk['n_false_flip']}",
    ))

tidy.append(dict(
    section="Q1_coverage", metric="low_flow_share_of_classifiable",
    subset="por_now<6000", flow_bin="", flow_state="",
    value=low_flow_share, n=n_classifiable_total,
    extra=f"n_lowflow={q1_lowflow['n_lowflow_classifiable']}",
))
tidy.append(dict(
    section="Q1_coverage", metric="n_classifiable_total",
    subset="all", flow_bin="", flow_state="",
    value=n_classifiable_total, n=N_SERIES,
    extra=f"data_rows={n_data_rows}; nonblank_por={N_SERIES}",
))

# Q1 state distribution under A vs B (PoR-keyed proxy bins)
for d in dist_rows:
    tidy.append(dict(
        section="Q1_state_dist_PoRkeyedPROXY", metric="rising_steady_falling",
        subset=d["rule"], flow_bin=d["por_keyed_bin_proxy"], flow_state="",
        value=np.nan, n=d["n"],
        extra=f"rising={d['rising']};steady={d['steady']};falling={d['falling']}",
    ))

# Q2 per-cell stats (GF-keyed real bins)
for c in q2_cell_rows:
    tidy.append(dict(
        section="Q2_cell_GFkeyed", metric="mean_raw_residual",
        subset="", flow_bin=c["flow_bin"], flow_state=c["flow_state"],
        value=c["mean_raw_residual"], n=c["n"],
        extra=f"se={c['se']:.4f};sd={c['sd']:.4f}" if not np.isnan(c["se"]) else "se=NA",
    ))

# Q2 per-bin verdicts
for v in q2_bin_verdicts:
    tidy.append(dict(
        section="Q2_bin_verdict", metric="bin_clears_bar",
        subset="", flow_bin=v["flow_bin"], flow_state=v["differing_state"],
        value=int(v["bin_clears_bar"]), n=v["differing_state_n"],
        extra=(f"max_abs_diff={v['max_abs_diff']:.2f};steady_mean={v['steady_mean']:.2f};"
               f"diff_se={v['differing_state_se']:.2f};"
               f">100={v['pass_gt_100cfs']};>SE={v['pass_gt_se']};n>=30={v['pass_n_ge_30']}"),
    ))

tidy_df = pd.DataFrame(tidy, columns=[
    "section", "metric", "subset", "flow_bin", "flow_state", "value", "n", "extra"])
tidy_df.to_csv(OUT_CSV, index=False)

# ============================================================================
# stdout summary
# ============================================================================
pct = lambda x: f"{100*x:.2f}%"
print("=" * 74)
print("FLOW-STATE FLOOR LEVERAGE DIAGNOSTIC (Python) -- read-only, ice-inclusive")
print("=" * 74)
print(f"Hourly data rows                : {n_data_rows}")
print(f"Non-blank por_now rows          : {N_SERIES}")
print(f"Classifiable hours (guards pass): {n_classifiable_total}")
print(f"  (guard: >=8 history rows AND a row at-or-before t-6h)")
print("NOTE: hourly file has no ice column -> Q1 is ICE-INCLUSIVE (no ice filter invented).")
print()
print("---- Q1: floor-bite on the PoR state classifier ----")
for blk in [q1_lowflow, q1_floorband]:
    print(f"\n  [{blk['subset']}]  low-flow classifiable hours = {blk['n_lowflow_classifiable']}")
    print(f"    floor-masked directionality (A=steady, B=rising/falling): "
          f"{pct(blk['floor_masked_frac'])}  (n={blk['n_floor_masked']})")
    print(f"      - masked-rising : {pct(blk['masked_rising_frac'])}  (n={blk['n_masked_rising']})")
    print(f"      - masked-falling: {pct(blk['masked_falling_frac'])}  (n={blk['n_masked_falling']})")
    print(f"    false-flip companion (B directional but |change|<100): "
          f"{pct(blk['false_flip_frac'])}  (n={blk['n_false_flip']})")
print()
print(f"  Low-flow (por_now<6000) share of ALL classifiable hours: {pct(low_flow_share)} "
      f"({q1_lowflow['n_lowflow_classifiable']}/{n_classifiable_total})")
print()
print("  State distribution under A (live) vs B (no floor), por_now<6000")
print("  -- PoR-keyed flow bin is a PROXY (NOT the live GF-keyed getFlowBin):")
hdr = f"    {'bin (PoR proxy)':<16}{'rule':<12}{'n':>8}{'rising':>9}{'steady':>9}{'falling':>9}"
print(hdr)
for d in dist_rows:
    print(f"    {d['por_keyed_bin_proxy']:<16}{d['rule']:<12}{d['n']:>8}"
          f"{d['rising']:>9}{d['steady']:>9}{d['falling']:>9}")
print()
print("---- Q2: do low-flow correction bins differ by state ----")
print("  (GF-keyed real flowBin from ci_residuals_v361_multi.csv; mean RAW residual)")
print(f"    {'flow_bin':<12}{'state':<9}{'mean_raw':>12}{'SE':>10}{'n':>8}")
for c in q2_cell_rows:
    se_s = f"{c['se']:.2f}" if not np.isnan(c['se']) else "NA"
    mn_s = f"{c['mean_raw_residual']:.2f}" if not np.isnan(c['mean_raw_residual']) else "NA"
    print(f"    {c['flow_bin']:<12}{c['flow_state']:<9}{mn_s:>12}{se_s:>10}{c['n']:>8}")
print()
print("  Per-bin Q2 verdict (bar: max|state-steady| > 100 cfs AND > SE AND diff-state n>=30):")
for v in q2_bin_verdicts:
    print(f"    {v['flow_bin']}: max|diff|={v['max_abs_diff']:.2f} cfs (state={v['differing_state']}, "
          f"n={v['differing_state_n']}, SE={v['differing_state_se']:.2f})")
    print(f"        >100cfs={v['pass_gt_100cfs']}  >SE={v['pass_gt_se']}  n>=30={v['pass_n_ge_30']}  "
          f"=> bin clears bar: {v['bin_clears_bar']}")
print()
any_clear = any(v["bin_clears_bar"] for v in q2_bin_verdicts)
n_clear = sum(v["bin_clears_bar"] for v in q2_bin_verdicts)
print("---- Combined leverage read ----")
q1_pass = q1_lowflow["floor_masked_frac"] >= 0.05
print(f"  Q1 sanity floor (floor-masked >= 5%): {'PASS' if q1_pass else 'FAIL'} "
      f"({pct(q1_lowflow['floor_masked_frac'])})")
if n_clear == 0:
    q2_read = "NO low-flow bin clears the bar -> close 0a as LOW-LEVERAGE."
elif n_clear == len(q2_bin_verdicts):
    q2_read = "BOTH low-flow bins clear the bar."
else:
    cleared = [v["flow_bin"] for v in q2_bin_verdicts if v["bin_clears_bar"]]
    q2_read = f"PARTIAL / concentrated leverage -- clears in: {', '.join(cleared)}."
print(f"  Q2 (decisive, per-bin): {q2_read}")
print()
print(f"Output written: {OUT_CSV}")

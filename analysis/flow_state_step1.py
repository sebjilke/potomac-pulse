#!/usr/bin/env python3
"""
Step-1 Label-Only Diagnostic (Python implementation, blind dual-language).

Provenance: this is the generating script for `flow_state_step1_python.csv`.

Spec: analysis/flow-state-step1-diagnostic-spec.md
Question: does the parcel-aligned flow-state label explain more raw-residual
variance / yield tighter within-bin residuals than the current-T0 label, under
a lag-sensitivity sweep?

Inputs (read-only):
  - analysis/hourly_backtest_data_v361.csv  (hourly series, UTC)
  - analysis/ci_residuals_v361_multi.csv    (one row per validated prediction)

Implemented INDEPENDENTLY from the spec + raw data only. No R script, no
*_R.csv, no other agent output is read.

Deterministic; seed = 20260617 for the block bootstrap.
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
OUT_CSV = os.path.join(ANALYSIS_DIR, "flow_state_step1_python.csv")

SEED = 20260617
B = 1000
BLOCK = 48
HOUR = np.timedelta64(1, "h")
SIX_H = np.timedelta64(6, "h")

# ----------------------------------------------------------------------------
# Load series. Parse timestamps as UTC, drop blank por_now, sort ascending.
# ----------------------------------------------------------------------------
series = pd.read_csv(HOURLY_CSV)
series["ts"] = pd.to_datetime(series["timestamp"], utc=True, format="%Y-%m-%d %H:%M")
series = series.dropna(subset=["por_now"]).copy()
series = series.sort_values("ts").reset_index(drop=True)

# Numpy arrays for fast searchsorted. datetime64[ns] for the timestamps.
ts_arr = series["ts"].values.astype("datetime64[ns]")
por_arr = series["por_now"].values.astype(float)
N_SERIES = len(ts_arr)

# Map predTs -> travel_time_h (per-hour PoR->GF lag). Use the floored-hour join
# on the FULL hourly table (travel_time_h may exist on rows where por_now is
# blank, but the series we classify against is the por_now series; the lag value
# itself is a property of the prediction hour). Build lookup on full table.
full = pd.read_csv(HOURLY_CSV)
full["ts"] = pd.to_datetime(full["timestamp"], utc=True, format="%Y-%m-%d %H:%M")
tt_lookup = dict(zip(full["ts"].values.astype("datetime64[ns]"),
                     full["travel_time_h"].values.astype(float)))


# ----------------------------------------------------------------------------
# Classifier: flowStateAsOf(series, refTime)
#   hist = series rows with ts <= refTime
#   if len(hist) < 8: 'steady'
#   current = por_now of largest ts <= refTime
#   past    = por_now of largest ts <= refTime - 6h
#   if past is None: 'steady'
#   change = current - past ; thr = max(100, 0.02*current)
#   abs(change) >= thr -> 'rising' if change>0 else 'falling'; else 'steady'
# 6h is by TIME not index. Use searchsorted on the sorted ts array.
# ----------------------------------------------------------------------------
def flow_state_as_of(ref_time_ns):
    """ref_time_ns: numpy datetime64[ns]. Returns 'rising'/'steady'/'falling'."""
    # number of rows with ts <= refTime: index of first ts > refTime (side='right')
    n_hist = np.searchsorted(ts_arr, ref_time_ns, side="right")
    if n_hist < 8:
        return "steady"
    # current = nearest on-or-before refTime -> row at n_hist - 1
    cur_idx = n_hist - 1
    current = por_arr[cur_idx]
    # past = nearest on-or-before refTime - 6h
    past_ref = ref_time_ns - SIX_H
    n_past = np.searchsorted(ts_arr, past_ref, side="right")
    if n_past < 1:
        return "steady"  # no row on-or-before refTime-6h -> past is None
    past = por_arr[n_past - 1]
    change = current - past
    thr = max(100.0, 0.02 * current)
    if abs(change) >= thr:
        return "rising" if change > 0 else "falling"
    return "steady"


# Vectorized batch classifier over an array of refTimes (datetime64[ns]).
def classify_batch(ref_times_ns):
    """ref_times_ns: 1-D np.datetime64[ns] array (may contain NaT). Returns list of states."""
    out = np.empty(len(ref_times_ns), dtype=object)
    # n_hist for current
    n_hist = np.searchsorted(ts_arr, ref_times_ns, side="right")
    # n_past for refTime - 6h
    past_ref = ref_times_ns - SIX_H
    n_past = np.searchsorted(ts_arr, past_ref, side="right")
    for i in range(len(ref_times_ns)):
        rt = ref_times_ns[i]
        if np.isnat(rt):
            out[i] = "steady"  # undefined refTime -> default (see assumptions)
            continue
        nh = n_hist[i]
        if nh < 8:
            out[i] = "steady"
            continue
        current = por_arr[nh - 1]
        npst = n_past[i]
        if npst < 1:
            out[i] = "steady"
            continue
        past = por_arr[npst - 1]
        change = current - past
        thr = 100.0 if 0.02 * current < 100.0 else 0.02 * current
        if abs(change) >= thr:
            out[i] = "rising" if change > 0 else "falling"
        else:
            out[i] = "steady"
    return out


# ----------------------------------------------------------------------------
# Load predictions. Parse predTs as UTC.
# ----------------------------------------------------------------------------
ci = pd.read_csv(CI_CSV)
ci["predTs"] = pd.to_datetime(ci["predTs"], utc=True)
# Sort by predTs to define "consecutive" 48-row blocks (~2 days) by time.
ci = ci.sort_values("predTs").reset_index(drop=True)

predTs_ns = ci["predTs"].values.astype("datetime64[ns]")
r = ci["rawResidual"].values.astype(float)
flowBin = ci["flowBin"].values
logged_state = ci["flowState"].values
N = len(ci)

# travel_time_h per prediction row, via floored-hour join. predTs are already
# on the hour; lookup directly.
tt = np.array([tt_lookup.get(t, np.nan) for t in predTs_ns], dtype=float)

# ----------------------------------------------------------------------------
# Build arm labelings.
# ----------------------------------------------------------------------------
ARMS = []  # (arm_name, lag_h, refTimes_ns)

# A_current: refTime = predTs
ARMS.append(("A_current", 0.0, predTs_ns.copy()))

# Parcel_L{k}
for k in (6, 12, 18, 24, 30, 36):
    ref = predTs_ns - np.timedelta64(k, "h")
    ARMS.append((f"Parcel_L{k}", float(k), ref))

# Parcel_model: refTime = predTs - travel_time_h(predTs) h.
# travel_time may be fractional hours -> use float hours -> ns offset.
# If travel_time is NaN -> NaT refTime -> classify_batch returns 'steady'.
tt_offset_ns = np.where(np.isnan(tt), np.timedelta64("NaT"),
                        (tt * 3600.0 * 1e9).astype("timedelta64[ns]"))
# Build refTimes; NaT where tt is nan
ref_model = np.empty(N, dtype="datetime64[ns]")
for i in range(N):
    if np.isnan(tt[i]):
        ref_model[i] = np.datetime64("NaT")
    else:
        ref_model[i] = predTs_ns[i] - np.timedelta64(int(round(tt[i] * 3600.0 * 1e9)), "ns")
# Use the mean travel_time as the reported "lag_h" for Parcel_model (nominal).
ARMS.append(("Parcel_model", float(np.nanmean(tt)), ref_model))

# Classify all arms.
arm_states = {}
for name, lag, ref in ARMS:
    arm_states[name] = classify_batch(ref)

# ----------------------------------------------------------------------------
# label_match_rate: A_current reimplemented vs logged flowState.
# ----------------------------------------------------------------------------
a_current = arm_states["A_current"]
label_match_rate = float(np.mean(a_current == logged_state))


# ----------------------------------------------------------------------------
# Metric helpers. KEY = (flowBin, state).
# ----------------------------------------------------------------------------
def group_means(states):
    """Return array of group_mean for each row, where group = (flowBin, state)."""
    df = pd.DataFrame({"bin": flowBin, "state": states, "r": r})
    gm = df.groupby(["bin", "state"])["r"].transform("mean")
    return gm.values


def compute_deterministic(states):
    gm = group_means(states)
    grand = r.mean()
    ss_total = np.sum((r - grand) ** 2)
    ss_within = np.sum((r - gm) ** 2)
    eta2_full = 1.0 - ss_within / ss_total
    within_var = ss_within / N

    # within_bin_state_eta2: hold flowBin fixed.
    # Sum_bin SS_between_states / Sum_bin SS_total_bin
    df = pd.DataFrame({"bin": flowBin, "state": states, "r": r})
    num = 0.0  # Sum_bin SS_between_states
    den = 0.0  # Sum_bin SS_total_bin
    for b, gb in df.groupby("bin"):
        rb = gb["r"].values
        bin_mean = rb.mean()
        ss_total_bin = np.sum((rb - bin_mean) ** 2)
        # SS_between_states within this bin = Sum_state n_s*(state_mean - bin_mean)^2
        ss_between = 0.0
        for s, gs in gb.groupby("state"):
            rs = gs["r"].values
            ss_between += len(rs) * (rs.mean() - bin_mean) ** 2
        num += ss_between
        den += ss_total_bin
    within_bin_state_eta2 = num / den if den > 0 else np.nan

    # occupancy
    rising_n = int(np.sum(states == "rising"))
    steady_n = int(np.sum(states == "steady"))
    falling_n = int(np.sum(states == "falling"))
    rising_mask = states == "rising"
    rising_mean_resid = float(r[rising_mask].mean()) if rising_n > 0 else np.nan

    return dict(
        eta2_full=eta2_full,
        within_var=within_var,
        within_bin_state_eta2=within_bin_state_eta2,
        rising_n=rising_n,
        steady_n=steady_n,
        falling_n=falling_n,
        rising_mean_resid=rising_mean_resid,
        gm=gm,  # group means per row (for bootstrap d_i)
    )


det = {name: compute_deterministic(arm_states[name]) for name, _, _ in ARMS}

# ----------------------------------------------------------------------------
# Block bootstrap (per parcel arm vs A_current).
# d_i = (r_i - groupmean_A(i))^2 - (r_i - groupmean_arm(i))^2
# Non-overlapping consecutive 48-row blocks; resample block indices with
# replacement; B=1000; seed=20260617; report mean and 2.5/97.5 pctiles.
# delta_within_var = within_var[A_current] - within_var[arm]  (mean of d_i).
# ----------------------------------------------------------------------------
gm_A = det["A_current"]["gm"]
sq_A = (r - gm_A) ** 2

# Build non-overlapping blocks over the (predTs-sorted) sample.
# Block j covers rows [j*48 : (j+1)*48]. Last block may be shorter (kept).
n_blocks = int(np.ceil(N / BLOCK))
block_slices = []
for j in range(n_blocks):
    lo = j * BLOCK
    hi = min((j + 1) * BLOCK, N)
    block_slices.append((lo, hi))


def block_bootstrap(d):
    """d: per-row contribution array. Returns (mean_d, ci_lo, ci_hi)."""
    rng = np.random.default_rng(SEED)
    # Precompute per-block sums and counts of d for speed.
    block_sums = np.array([d[lo:hi].sum() for (lo, hi) in block_slices])
    block_counts = np.array([hi - lo for (lo, hi) in block_slices])
    boot = np.empty(B, dtype=float)
    for b in range(B):
        idx = rng.integers(0, n_blocks, size=n_blocks)  # resample block indices
        tot = block_sums[idx].sum()
        cnt = block_counts[idx].sum()
        boot[b] = tot / cnt
    mean_d = float(d.mean())
    ci_lo = float(np.percentile(boot, 2.5))
    ci_hi = float(np.percentile(boot, 97.5))
    return mean_d, ci_lo, ci_hi, boot.mean()


# ----------------------------------------------------------------------------
# Assemble output rows.
# ----------------------------------------------------------------------------
rows = []
for name, lag, _ in ARMS:
    d = det[name]
    row = dict(
        arm=name,
        lag_h=lag,
        n=N,
        eta2_full=d["eta2_full"],
        within_var=d["within_var"],
        within_bin_state_eta2=d["within_bin_state_eta2"],
        rising_n=d["rising_n"],
        steady_n=d["steady_n"],
        falling_n=d["falling_n"],
        rising_mean_resid=d["rising_mean_resid"],
        label_match_rate=label_match_rate if name == "A_current" else np.nan,
        delta_within_var=np.nan,
        boot_mean_d=np.nan,
        boot_ci_lo=np.nan,
        boot_ci_hi=np.nan,
    )
    if name != "A_current":
        gm_arm = d["gm"]
        sq_arm = (r - gm_arm) ** 2
        d_i = sq_A - sq_arm  # d_i; mean(d_i) == within_var[A] - within_var[arm]
        delta_within_var = det["A_current"]["within_var"] - d["within_var"]
        mean_d, ci_lo, ci_hi, boot_mean = block_bootstrap(d_i)
        row["delta_within_var"] = delta_within_var
        row["boot_mean_d"] = boot_mean  # bootstrap mean of resampled means
        row["boot_ci_lo"] = ci_lo
        row["boot_ci_hi"] = ci_hi
        # sanity: mean_d (observed) should equal delta_within_var
        row["_observed_mean_d"] = mean_d
    rows.append(row)

out = pd.DataFrame(rows)

# Column order per spec.
cols = ["arm", "lag_h", "n", "eta2_full", "within_var", "within_bin_state_eta2",
        "rising_n", "steady_n", "falling_n", "rising_mean_resid",
        "label_match_rate", "delta_within_var", "boot_mean_d",
        "boot_ci_lo", "boot_ci_hi"]
out_csv = out[cols].copy()
out_csv.to_csv(OUT_CSV, index=False)

# ----------------------------------------------------------------------------
# stdout summary.
# ----------------------------------------------------------------------------
pd.set_option("display.width", 200)
pd.set_option("display.max_columns", 50)
print("=== Step-1 Label-Only Diagnostic (Python) ===")
print(f"Joined sample N = {N}")
print(f"label_match_rate (A_current vs logged flowState) = {label_match_rate:.6f}")
print()
print(out[cols].to_string(index=False))
print()
print("--- Summary ---")
print(f"Match rate {label_match_rate:.4f}.")
for name, lag, _ in ARMS:
    if name == "A_current":
        continue
    rr = out[out["arm"] == name].iloc[0]
    reduces = rr["delta_within_var"] > 0
    wins = rr["boot_ci_lo"] > 0  # parcel wins iff CI strictly above 0
    if rr["boot_ci_hi"] < 0:
        ci_verdict = "EXCLUDES 0 on the LOSING side (parcel worse)"
    elif wins:
        ci_verdict = "EXCLUDES 0 (parcel wins)"
    else:
        ci_verdict = "straddles 0 (inconclusive)"
    print(f"{name}: delta_within_var={rr['delta_within_var']:.4f} "
          f"({'reduces' if reduces else 'does NOT reduce'} within_var vs A_current); "
          f"boot CI [{rr['boot_ci_lo']:.4f}, {rr['boot_ci_hi']:.4f}] {ci_verdict}.")
print()
print(f"Output written: {OUT_CSV}")

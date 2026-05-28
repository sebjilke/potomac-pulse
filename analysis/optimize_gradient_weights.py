#!/usr/bin/env python3
"""
optimize_gradient_weights.py
Piecewise-linear (gradient) EF weight optimization for Potomac Pulse.

Replaces hard step-function cutoffs with smooth interpolation between anchor
points. Uses iterative coordinate descent + refinement to find optimal weights
at each anchor, enforcing monotonicity throughout.

Data: ef_lf_daily_longterm.csv — 5,220 deduplicated daily obs (2011-2026)
Model: ensemble = (1-w)*yesterday_lf + w * (126 * ef_stage^2.46)
"""

import numpy as np
import pandas as pd

# ── Configuration ──────────────────────────────────────────────────────────
ANCHOR_FLOWS = np.array([0, 3000, 6000, 10000, 15000, 25000, 50000], dtype=float)
INITIAL_WEIGHTS = np.array([0.1, 0.1, 0.1, 0.2, 0.7, 0.7, 0.7])
W_MIN, W_MAX = 0.0, 0.80
COARSE_STEP = 0.05
FINE_RADIUS = 0.05
FINE_STEP = 0.01
N_PASSES = 5

# Current step-function weights for comparison
STEP_THRESHOLDS = [3000, 6000, 15000]
STEP_WEIGHTS = [0.10, 0.10, 0.20, 0.70]  # <3k, 3-6k, 6-15k, >15k

DATA_PATH = "/Users/sebjilke/Desktop/PotomacPulse/analysis/ef_lf_daily_longterm.csv"
OUT_CSV = "/Users/sebjilke/Desktop/PotomacPulse/analysis/gradient_weights_python.csv"

# ── Flow regime bins for RMSE breakdown ────────────────────────────────────
REGIME_BINS = [
    ("<3k", 0, 3000),
    ("3-6k", 3000, 6000),
    ("6-10k", 6000, 10000),
    ("10-15k", 10000, 15000),
    ("15-25k", 15000, 25000),
    ("25-50k", 25000, 50000),
    (">50k", 50000, np.inf),
]


def load_and_prepare():
    """Load CSV, deduplicate, sort, compute EF predicted, build consecutive pairs."""
    df = pd.read_csv(DATA_PATH, parse_dates=["date"])
    df = df.drop_duplicates(subset="date", keep="first").sort_values("date").reset_index(drop=True)
    print(f"Loaded {len(df)} unique daily observations")
    print(f"Date range: {df['date'].min().date()} to {df['date'].max().date()}")

    # EF power-law prediction
    df["ef_predicted"] = 126.0 * df["ef_stage"] ** 2.46

    # Build consecutive-day pairs
    dates = df["date"].values
    ef_pred = df["ef_predicted"].values
    lf_q = df["lf_discharge"].values

    actual_list = []
    yesterday_list = []
    ef_p_list = []

    for i in range(1, len(df)):
        gap = (dates[i] - dates[i - 1]) / np.timedelta64(1, "D")
        if gap == 1.0:
            actual_list.append(lf_q[i])
            yesterday_list.append(lf_q[i - 1])
            ef_p_list.append(ef_pred[i])

    actual = np.array(actual_list)
    yesterday = np.array(yesterday_list)
    ef_p = np.array(ef_p_list)

    print(f"Consecutive-day pairs: {len(actual)}")
    return actual, yesterday, ef_p


def interpolate_weight(flow, anchor_flows, anchor_weights):
    """Piecewise-linear interpolation of weight at a given flow level."""
    if flow <= anchor_flows[0]:
        return anchor_weights[0]
    if flow >= anchor_flows[-1]:
        return anchor_weights[-1]
    idx = np.searchsorted(anchor_flows, flow, side="right") - 1
    f0, f1 = anchor_flows[idx], anchor_flows[idx + 1]
    w0, w1 = anchor_weights[idx], anchor_weights[idx + 1]
    t = (flow - f0) / (f1 - f0)
    return w0 + (w1 - w0) * t


def interpolate_weights_vectorized(flows, anchor_flows, anchor_weights):
    """Vectorized piecewise-linear interpolation for an array of flows."""
    weights = np.empty(len(flows), dtype=float)
    for i in range(len(flows)):
        weights[i] = interpolate_weight(flows[i], anchor_flows, anchor_weights)
    return weights


def compute_rmse(actual, yesterday, ef_pred, weights_vec):
    """Compute RMSE of blended ensemble given per-observation weights."""
    ensemble = (1.0 - weights_vec) * yesterday + weights_vec * ef_pred
    return np.sqrt(np.mean((ensemble - actual) ** 2))


def compute_rmse_for_anchors(actual, yesterday, ef_pred, anchor_flows, anchor_weights):
    """Compute overall RMSE for a given set of anchor weights."""
    w_vec = interpolate_weights_vectorized(actual, anchor_flows, anchor_weights)
    return compute_rmse(actual, yesterday, ef_pred, w_vec)


def enforce_monotonicity(weights):
    """Enforce non-decreasing constraint (returns new array)."""
    w = weights.copy()
    for i in range(1, len(w)):
        if w[i] < w[i - 1]:
            w[i] = w[i - 1]
    return w


def step_function_weight(flow):
    """Current step-function weight for comparison."""
    if flow < STEP_THRESHOLDS[0]:
        return STEP_WEIGHTS[0]
    elif flow < STEP_THRESHOLDS[1]:
        return STEP_WEIGHTS[1]
    elif flow < STEP_THRESHOLDS[2]:
        return STEP_WEIGHTS[2]
    else:
        return STEP_WEIGHTS[3]


def rmse_by_regime(actual, yesterday, ef_pred, weight_func):
    """Compute RMSE breakdown by flow regime."""
    results = []
    for label, lo, hi in REGIME_BINS:
        mask = (actual >= lo) & (actual < hi)
        n = mask.sum()
        if n == 0:
            results.append((label, n, np.nan))
            continue
        w_vec = np.array([weight_func(f) for f in actual[mask]])
        ensemble = (1.0 - w_vec) * yesterday[mask] + w_vec * ef_pred[mask]
        rmse = np.sqrt(np.mean((ensemble - actual[mask]) ** 2))
        results.append((label, n, rmse))
    return results


def optimize():
    """Main optimization routine."""
    actual, yesterday, ef_pred = load_and_prepare()

    # ── Step-function baseline ─────────────────────────────────────────────
    step_w = np.array([step_function_weight(f) for f in actual])
    step_rmse = compute_rmse(actual, yesterday, ef_pred, step_w)
    print(f"\n{'='*70}")
    print(f"CURRENT STEP-FUNCTION BASELINE")
    print(f"  Weights: <3k=0.10, 3-6k=0.10, 6-15k=0.20, >15k=0.70")
    print(f"  Overall RMSE: {step_rmse:.1f} cfs")

    # ── Coordinate descent — coarse ───────────────────────────────────────
    print(f"\n{'='*70}")
    print("COORDINATE DESCENT — COARSE (step=0.05, 5 passes)")
    weights = INITIAL_WEIGHTS.copy()
    coarse_grid = np.arange(W_MIN, W_MAX + COARSE_STEP / 2, COARSE_STEP)

    for pass_num in range(1, N_PASSES + 1):
        for a in range(len(ANCHOR_FLOWS)):
            best_w = weights[a]
            best_rmse = np.inf
            for candidate in coarse_grid:
                trial = weights.copy()
                trial[a] = candidate
                trial = enforce_monotonicity(trial)
                rmse = compute_rmse_for_anchors(actual, yesterday, ef_pred, ANCHOR_FLOWS, trial)
                if rmse < best_rmse:
                    best_rmse = rmse
                    best_w = candidate
            weights[a] = best_w
            weights = enforce_monotonicity(weights)
        rmse_now = compute_rmse_for_anchors(actual, yesterday, ef_pred, ANCHOR_FLOWS, weights)
        print(f"  Pass {pass_num}: RMSE={rmse_now:.1f}  weights={np.round(weights, 2)}")

    # ── Coordinate descent — fine ─────────────────────────────────────────
    print(f"\nCOORDINATE DESCENT — FINE (step=0.01, +/-0.05)")
    for pass_num in range(1, 4):
        for a in range(len(ANCHOR_FLOWS)):
            lo = max(W_MIN, weights[a] - FINE_RADIUS)
            hi = min(W_MAX, weights[a] + FINE_RADIUS)
            fine_grid = np.arange(lo, hi + FINE_STEP / 2, FINE_STEP)
            best_w = weights[a]
            best_rmse = np.inf
            for candidate in fine_grid:
                trial = weights.copy()
                trial[a] = round(candidate, 4)
                trial = enforce_monotonicity(trial)
                rmse = compute_rmse_for_anchors(actual, yesterday, ef_pred, ANCHOR_FLOWS, trial)
                if rmse < best_rmse:
                    best_rmse = rmse
                    best_w = round(candidate, 4)
            weights[a] = best_w
            weights = enforce_monotonicity(weights)
        rmse_now = compute_rmse_for_anchors(actual, yesterday, ef_pred, ANCHOR_FLOWS, weights)
        print(f"  Fine pass {pass_num}: RMSE={rmse_now:.1f}  weights={np.round(weights, 2)}")

    # ── Round to 1 decimal ────────────────────────────────────────────────
    weights_rounded = np.round(weights, 1)
    weights_rounded = enforce_monotonicity(weights_rounded)
    rmse_rounded = compute_rmse_for_anchors(actual, yesterday, ef_pred, ANCHOR_FLOWS, weights_rounded)

    # ── Final results ─────────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print("FINAL OPTIMIZED GRADIENT WEIGHTS (rounded to 0.1)")
    print(f"{'='*70}")
    print(f"{'Anchor Flow (cfs)':>20s} {'Weight':>10s}")
    print(f"{'-'*32}")
    for f, w in zip(ANCHOR_FLOWS, weights_rounded):
        print(f"{f:>20,.0f} {w:>10.1f}")

    print(f"\n  Gradient RMSE (rounded):  {rmse_rounded:.1f} cfs")
    print(f"  Step-function RMSE:       {step_rmse:.1f} cfs")
    diff = step_rmse - rmse_rounded
    pct = diff / step_rmse * 100
    if diff > 0:
        print(f"  Improvement:              {diff:.1f} cfs ({pct:.1f}% reduction)")
    else:
        print(f"  Difference:               {-diff:.1f} cfs worse ({-pct:.1f}%)")

    # ── RMSE by flow regime ───────────────────────────────────────────────
    def gradient_weight_func(flow):
        return interpolate_weight(flow, ANCHOR_FLOWS, weights_rounded)

    print(f"\n{'='*70}")
    print("RMSE BY FLOW REGIME")
    print(f"{'='*70}")
    print(f"{'Regime':>10s} {'N pairs':>10s} {'Step RMSE':>12s} {'Gradient RMSE':>15s} {'Change':>10s}")
    print(f"{'-'*60}")

    regime_step = rmse_by_regime(actual, yesterday, ef_pred, step_function_weight)
    regime_grad = rmse_by_regime(actual, yesterday, ef_pred, gradient_weight_func)

    for (label, n_s, rmse_s), (_, n_g, rmse_g) in zip(regime_step, regime_grad):
        if n_s == 0:
            print(f"{label:>10s} {n_s:>10d} {'n/a':>12s} {'n/a':>15s} {'':>10s}")
        else:
            chg = rmse_g - rmse_s
            sign = "+" if chg > 0 else ""
            print(f"{label:>10s} {n_s:>10d} {rmse_s:>12.1f} {rmse_g:>15.1f} {sign}{chg:>9.1f}")

    # ── Per-anchor local stats (for CSV) ──────────────────────────────────
    anchor_stats = []
    for idx_a, (af, aw) in enumerate(zip(ANCHOR_FLOWS, weights_rounded)):
        if idx_a == 0:
            lo_bound = 0
        else:
            lo_bound = (ANCHOR_FLOWS[idx_a - 1] + af) / 2
        if idx_a == len(ANCHOR_FLOWS) - 1:
            hi_bound = np.inf
        else:
            hi_bound = (af + ANCHOR_FLOWS[idx_a + 1]) / 2

        mask = (actual >= lo_bound) & (actual < hi_bound)
        n_nearby = mask.sum()
        if n_nearby > 0:
            w_local = np.full(n_nearby, aw)
            ens = (1.0 - w_local) * yesterday[mask] + w_local * ef_pred[mask]
            rmse_local = np.sqrt(np.mean((ens - actual[mask]) ** 2))
        else:
            rmse_local = np.nan
        anchor_stats.append((af, aw, n_nearby, round(rmse_local, 1) if not np.isnan(rmse_local) else np.nan))

    # ── Save CSV ──────────────────────────────────────────────────────────
    out_df = pd.DataFrame(anchor_stats, columns=["anchor_flow", "optimal_weight", "n_obs_nearby", "rmse_local"])
    out_df.to_csv(OUT_CSV, index=False)
    print(f"\nSaved: {OUT_CSV}")

    # ── Print for code integration ────────────────────────────────────────
    w_str = ", ".join([f"{w:.1f}" for w in weights_rounded])
    a_str = ", ".join([f"{int(a)}" for a in ANCHOR_FLOWS])
    print(f"\nFor code:")
    print(f"  Anchors: [{a_str}]")
    print(f"  Weights: [{w_str}]")

    return weights_rounded, rmse_rounded


if __name__ == "__main__":
    optimize()

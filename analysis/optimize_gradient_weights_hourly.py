#!/usr/bin/env python3
"""
optimize_gradient_weights_hourly.py
Piecewise-linear (gradient) EF weight optimization using HOURLY travel-time-shifted data.

Unlike the daily version (optimize_gradient_weights.py) which uses lag-1 actual LF
as a proxy for PoR, this script uses the actual travel-time-shifted PoR readings
from the hourly dataset — a more realistic representation of the information
available at prediction time.

Data: hourly_backtest_data.csv — ~42,838 hourly observations (2021-2026)
Model: GF = (1 - w) * por_shifted_cfs + w * ef_cfs
  where ef_cfs = 126 * ef_stage^2.46 (default) or 160 * ef_stage^2.36 (cold, <=10°C)
  and w is piecewise-linear interpolated from anchor points based on por_shifted_cfs
"""

import numpy as np
import pandas as pd

# ── Configuration ──────────────────────────────────────────────────────────
ANCHOR_FLOWS = np.array([0, 3000, 6000, 10000, 15000, 25000, 50000], dtype=float)
CURRENT_WEIGHTS = np.array([0.0, 0.0, 0.1, 0.4, 0.4, 0.4, 0.4])  # v28.0 daily-optimized
INITIAL_WEIGHTS = CURRENT_WEIGHTS.copy()
W_MIN, W_MAX = 0.0, 0.80
COARSE_STEP = 0.05
FINE_RADIUS = 0.05
FINE_STEP = 0.01
N_COARSE_PASSES = 5
N_FINE_PASSES = 3

DATA_PATH = "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
OUT_CSV = "/Users/sebjilke/Desktop/PotomacPulse/analysis/gradient_weights_hourly_python.csv"

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
    """Load hourly CSV, filter valid rows, compute EF predicted."""
    df = pd.read_csv(DATA_PATH, parse_dates=["timestamp"])
    print(f"Loaded {len(df)} hourly observations")
    print(f"Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")

    # Column mapping: por_lagged = travel-time-shifted PoR, lf_discharge = ground truth
    # Rename for clarity
    df = df.rename(columns={
        "por_lagged": "por_shifted_cfs",
        "lf_discharge": "lf_cfs",
    })

    # Filter: only rows where por_shifted > 0 AND ef_stage > 0 AND lf_cfs > 0
    mask = (df["por_shifted_cfs"] > 0) & (df["ef_stage"] > 0) & (df["lf_cfs"] > 0)
    df = df[mask].reset_index(drop=True)
    print(f"Valid rows after filtering (por_shifted>0, ef_stage>0, lf_cfs>0): {len(df)}")

    # EF power-law prediction: cold-water vs default
    has_temp = df["water_temp_c"].notna()
    cold = has_temp & (df["water_temp_c"] <= 10.0)

    # Default model
    df["ef_cfs"] = 126.0 * df["ef_stage"] ** 2.46
    # Cold-water model where applicable
    df.loc[cold, "ef_cfs"] = 160.0 * df.loc[cold, "ef_stage"] ** 2.36

    n_cold = cold.sum()
    n_default = len(df) - n_cold
    print(f"EF model: {n_default} rows default (126×EF^2.46), {n_cold} rows cold-water (160×EF^2.36)")

    por_shifted = df["por_shifted_cfs"].values
    ef_cfs = df["ef_cfs"].values
    lf_actual = df["lf_cfs"].values

    return por_shifted, ef_cfs, lf_actual


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
    # Use numpy interp for speed — clamps at edges automatically
    return np.interp(flows, anchor_flows, anchor_weights)


def compute_rmse(lf_actual, por_shifted, ef_cfs, weights_vec):
    """Compute RMSE of blended estimate: GF = (1-w)*por_shifted + w*ef_cfs."""
    estimated = (1.0 - weights_vec) * por_shifted + weights_vec * ef_cfs
    return np.sqrt(np.mean((estimated - lf_actual) ** 2))


def compute_rmse_for_anchors(lf_actual, por_shifted, ef_cfs, anchor_flows, anchor_weights):
    """Compute overall RMSE for a given set of anchor weights.
    Weight interpolation is based on por_shifted_cfs (the flow proxy available at prediction time)."""
    w_vec = interpolate_weights_vectorized(por_shifted, anchor_flows, anchor_weights)
    return compute_rmse(lf_actual, por_shifted, ef_cfs, w_vec)


def enforce_monotonicity(weights):
    """Enforce non-decreasing constraint (returns new array)."""
    w = weights.copy()
    for i in range(1, len(w)):
        if w[i] < w[i - 1]:
            w[i] = w[i - 1]
    return w


def rmse_by_regime(lf_actual, por_shifted, ef_cfs, weight_func):
    """Compute RMSE breakdown by flow regime (using por_shifted as regime indicator)."""
    results = []
    for label, lo, hi in REGIME_BINS:
        mask = (por_shifted >= lo) & (por_shifted < hi)
        n = mask.sum()
        if n == 0:
            results.append((label, n, np.nan))
            continue
        w_vec = np.array([weight_func(f) for f in por_shifted[mask]])
        estimated = (1.0 - w_vec) * por_shifted[mask] + w_vec * ef_cfs[mask]
        rmse = np.sqrt(np.mean((estimated - lf_actual[mask]) ** 2))
        results.append((label, n, rmse))
    return results


def optimize():
    """Main optimization routine."""
    por_shifted, ef_cfs, lf_actual = load_and_prepare()
    n_valid = len(lf_actual)
    print(f"\nNumber of valid rows used: {n_valid}")

    # ── Current daily-optimized weights baseline ───────────────────────────
    current_rmse = compute_rmse_for_anchors(
        lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, CURRENT_WEIGHTS
    )
    print(f"\n{'='*70}")
    print("CURRENT DAILY-OPTIMIZED WEIGHTS (v28.0) ON HOURLY DATA")
    print(f"  Weights: {CURRENT_WEIGHTS}")
    print(f"  Overall RMSE: {current_rmse:.1f} cfs")

    # ── Coordinate descent — coarse ───────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"COORDINATE DESCENT — COARSE (step={COARSE_STEP}, {N_COARSE_PASSES} passes)")
    weights = INITIAL_WEIGHTS.copy()
    coarse_grid = np.arange(W_MIN, W_MAX + COARSE_STEP / 2, COARSE_STEP)

    for pass_num in range(1, N_COARSE_PASSES + 1):
        for a in range(len(ANCHOR_FLOWS)):
            best_w = weights[a]
            best_rmse = np.inf
            for candidate in coarse_grid:
                trial = weights.copy()
                trial[a] = candidate
                trial = enforce_monotonicity(trial)
                rmse = compute_rmse_for_anchors(
                    lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, trial
                )
                if rmse < best_rmse:
                    best_rmse = rmse
                    best_w = candidate
            weights[a] = best_w
            weights = enforce_monotonicity(weights)
        rmse_now = compute_rmse_for_anchors(
            lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, weights
        )
        print(f"  Pass {pass_num}: RMSE={rmse_now:.1f}  weights={np.round(weights, 2)}")

    # ── Coordinate descent — fine ─────────────────────────────────────────
    print(f"\nCOORDINATE DESCENT — FINE (step={FINE_STEP}, +/-{FINE_RADIUS})")
    for pass_num in range(1, N_FINE_PASSES + 1):
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
                rmse = compute_rmse_for_anchors(
                    lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, trial
                )
                if rmse < best_rmse:
                    best_rmse = rmse
                    best_w = round(candidate, 4)
            weights[a] = best_w
            weights = enforce_monotonicity(weights)
        rmse_now = compute_rmse_for_anchors(
            lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, weights
        )
        print(f"  Fine pass {pass_num}: RMSE={rmse_now:.1f}  weights={np.round(weights, 2)}")

    # ── Round to 1 decimal ────────────────────────────────────────────────
    weights_rounded = np.round(weights, 1)
    weights_rounded = enforce_monotonicity(weights_rounded)
    rmse_rounded = compute_rmse_for_anchors(
        lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, weights_rounded
    )

    # ── Final results ─────────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print("FINAL OPTIMIZED HOURLY GRADIENT WEIGHTS (rounded to 0.1)")
    print(f"{'='*70}")
    print(f"{'Anchor Flow (cfs)':>20s} {'Hourly Weight':>15s} {'Daily Weight':>15s} {'Change':>10s}")
    print(f"{'-'*62}")
    for f, wh, wd in zip(ANCHOR_FLOWS, weights_rounded, CURRENT_WEIGHTS):
        diff = wh - wd
        sign = "+" if diff > 0 else ""
        chg_str = f"{sign}{diff:.1f}" if diff != 0 else "—"
        print(f"{f:>20,.0f} {wh:>15.1f} {wd:>15.1f} {chg_str:>10s}")

    print(f"\n  Hourly-optimized RMSE:    {rmse_rounded:.1f} cfs")
    print(f"  Daily-optimized RMSE:     {current_rmse:.1f} cfs  (current v28.0 weights on hourly data)")
    diff = current_rmse - rmse_rounded
    pct = diff / current_rmse * 100
    if diff > 0:
        print(f"  Improvement:              {diff:.1f} cfs ({pct:.1f}% reduction)")
    elif diff < 0:
        print(f"  Difference:               {-diff:.1f} cfs worse ({-pct:.1f}%)")
    else:
        print(f"  Difference:               identical")

    # ── RMSE by flow regime ───────────────────────────────────────────────
    def hourly_weight_func(flow):
        return interpolate_weight(flow, ANCHOR_FLOWS, weights_rounded)

    def current_weight_func(flow):
        return interpolate_weight(flow, ANCHOR_FLOWS, CURRENT_WEIGHTS)

    print(f"\n{'='*70}")
    print("RMSE BY FLOW REGIME (por_shifted_cfs)")
    print(f"{'='*70}")
    print(f"{'Regime':>10s} {'N rows':>10s} {'Daily RMSE':>12s} {'Hourly RMSE':>13s} {'Change':>10s}")
    print(f"{'-'*58}")

    regime_current = rmse_by_regime(lf_actual, por_shifted, ef_cfs, current_weight_func)
    regime_hourly = rmse_by_regime(lf_actual, por_shifted, ef_cfs, hourly_weight_func)

    for (label, n_c, rmse_c), (_, n_h, rmse_h) in zip(regime_current, regime_hourly):
        if n_c == 0:
            print(f"{label:>10s} {n_c:>10d} {'n/a':>12s} {'n/a':>13s} {'':>10s}")
        else:
            chg = rmse_h - rmse_c
            sign = "+" if chg > 0 else ""
            print(f"{label:>10s} {n_c:>10d} {rmse_c:>12.1f} {rmse_h:>13.1f} {sign}{chg:>9.1f}")

    # ── Summary comparison table ──────────────────────────────────────────
    print(f"\n{'='*70}")
    print("COMPARISON: CURRENT vs HOURLY-OPTIMIZED WEIGHTS")
    print(f"{'='*70}")
    current_str = ", ".join([f"{w:.1f}" for w in CURRENT_WEIGHTS])
    hourly_str = ", ".join([f"{w:.1f}" for w in weights_rounded])
    print(f"  Current daily-optimized weights: [{current_str}]")
    print(f"  New hourly-optimized weights:    [{hourly_str}]")
    print(f"  Anchors:                         {[int(a) for a in ANCHOR_FLOWS]}")
    print(f"  N valid hourly rows:             {n_valid}")

    # ── Save CSV ──────────────────────────────────────────────────────────
    out_df = pd.DataFrame({
        "anchor_flow": ANCHOR_FLOWS.astype(int),
        "optimal_weight": weights_rounded,
    })
    out_df.to_csv(OUT_CSV, index=False)
    print(f"\nSaved: {OUT_CSV}")

    # ── Print for code integration ────────────────────────────────────────
    a_str = ", ".join([f"{int(a)}" for a in ANCHOR_FLOWS])
    print(f"\nFor code:")
    print(f"  Anchors: [{a_str}]")
    print(f"  Weights: [{hourly_str}]")

    return weights_rounded, rmse_rounded


if __name__ == "__main__":
    optimize()

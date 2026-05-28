#!/usr/bin/env python3
"""
optimize_gradient_weights_hourly_v2.py
Re-optimized piecewise-linear (gradient) EF weights on HOURLY data with:
  - ZERO initialization (not from current weights) to avoid local-minimum trapping
  - W_MAX = 0.80 (each anchor free to reach ceiling independently)
  - 2-decimal-place rounding (finer resolution than v1's 1-decimal)
  - Leave-one-year-out cross-validation
  - Rising-event RMSE by flow regime

Addresses audit finding that previous optimization hit a binding constraint.

Data: hourly_backtest_data.csv — ~42,838 hourly observations (2021-2026)
Model: GF = (1 - w) * por_lagged + w * ef_cfs
  where ef_cfs = 126 * ef_stage^2.46 (default) or 160 * ef_stage^2.36 (cold, <=10C)
  and w is piecewise-linear interpolated from anchor points based on por_lagged
"""

import numpy as np
import pandas as pd
import sys

# ── Configuration ──────────────────────────────────────────────────────────
ANCHOR_FLOWS = np.array([0, 3000, 6000, 10000, 15000, 25000, 50000], dtype=float)

# KEY CHANGE 1: Initialize from ALL ZEROS
INITIAL_WEIGHTS = np.array([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])

W_MIN, W_MAX = 0.0, 0.80
COARSE_STEP = 0.05
FINE_RADIUS = 0.05
FINE_STEP = 0.01
N_COARSE_PASSES = 5
N_FINE_PASSES = 3

# KEY CHANGE 2: Round to 2 decimal places, not 1
ROUND_DECIMALS = 2

# Comparison baselines
CURRENT_WEIGHTS = np.array([0.0, 0.0, 0.1, 0.4, 0.4, 0.4, 0.4])  # v28.0 daily-optimized
PREVIOUS_HOURLY_WEIGHTS = np.array([0.0, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4])  # previous hourly run (hit binding constraint)

DATA_PATH = "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
OUT_CSV = "/Users/sebjilke/Desktop/PotomacPulse/analysis/gradient_weights_hourly_v2_python.csv"

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

# Rising-event threshold: por_lagged > previous por_lagged by >5%
RISING_THRESHOLD = 0.05


def load_and_prepare():
    """Load hourly CSV, filter valid rows, compute EF predicted."""
    df = pd.read_csv(DATA_PATH, parse_dates=["timestamp"])
    print(f"Loaded {len(df)} hourly observations")
    print(f"Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")

    # Filter: only rows where por_lagged > 0 AND ef_stage > 0 AND lf_discharge > 0
    mask = (df["por_lagged"] > 0) & (df["ef_stage"] > 0) & (df["lf_discharge"] > 0)
    df = df[mask].reset_index(drop=True)
    print(f"Valid rows after filtering (por_lagged>0, ef_stage>0, lf_discharge>0): {len(df)}")

    # EF power-law prediction: cold-water vs default
    has_temp = df["water_temp_c"].notna()
    cold = has_temp & (df["water_temp_c"] <= 10.0)

    # Default model
    df["ef_cfs"] = 126.0 * df["ef_stage"] ** 2.46
    # Cold-water model where applicable
    df.loc[cold, "ef_cfs"] = 160.0 * df.loc[cold, "ef_stage"] ** 2.36

    n_cold = cold.sum()
    n_default = len(df) - n_cold
    print(f"EF model: {n_default} rows default (126*EF^2.46), {n_cold} rows cold-water (160*EF^2.36)")

    # Extract year for cross-validation
    df["year"] = df["timestamp"].dt.year

    # Identify rising events: por_lagged at current row > por_lagged at previous row by >5%
    por_vals = df["por_lagged"].values
    rising = np.zeros(len(df), dtype=bool)
    for i in range(1, len(df)):
        if por_vals[i - 1] > 0:
            if (por_vals[i] - por_vals[i - 1]) / por_vals[i - 1] > RISING_THRESHOLD:
                rising[i] = True
    df["rising"] = rising

    print(f"Rising events (>5% increase): {rising.sum()} rows ({rising.sum()/len(df)*100:.1f}%)")

    return df


def interpolate_weights_vectorized(flows, anchor_flows, anchor_weights):
    """Vectorized piecewise-linear interpolation using np.interp."""
    return np.interp(flows, anchor_flows, anchor_weights)


def compute_rmse(lf_actual, por_shifted, ef_cfs, weights_vec):
    """Compute RMSE of blended estimate: GF = (1-w)*por_shifted + w*ef_cfs."""
    estimated = (1.0 - weights_vec) * por_shifted + weights_vec * ef_cfs
    return np.sqrt(np.mean((estimated - lf_actual) ** 2))


def compute_rmse_for_anchors(lf_actual, por_shifted, ef_cfs, anchor_flows, anchor_weights):
    """Compute overall RMSE for a given set of anchor weights."""
    w_vec = interpolate_weights_vectorized(por_shifted, anchor_flows, anchor_weights)
    return compute_rmse(lf_actual, por_shifted, ef_cfs, w_vec)


def enforce_monotonicity(weights):
    """Enforce non-decreasing constraint (returns new array)."""
    w = weights.copy()
    for i in range(1, len(w)):
        if w[i] < w[i - 1]:
            w[i] = w[i - 1]
    return w


def interpolate_weight_scalar(flow, anchor_flows, anchor_weights):
    """Scalar piecewise-linear interpolation."""
    if flow <= anchor_flows[0]:
        return anchor_weights[0]
    if flow >= anchor_flows[-1]:
        return anchor_weights[-1]
    idx = np.searchsorted(anchor_flows, flow, side="right") - 1
    f0, f1 = anchor_flows[idx], anchor_flows[idx + 1]
    w0, w1 = anchor_weights[idx], anchor_weights[idx + 1]
    t = (flow - f0) / (f1 - f0)
    return w0 + (w1 - w0) * t


def rmse_by_regime(lf_actual, por_shifted, ef_cfs, anchor_flows, anchor_weights, mask_extra=None):
    """Compute RMSE breakdown by flow regime. Optional extra mask for rising events."""
    results = []
    for label, lo, hi in REGIME_BINS:
        regime_mask = (por_shifted >= lo) & (por_shifted < hi)
        if mask_extra is not None:
            regime_mask = regime_mask & mask_extra
        n = regime_mask.sum()
        if n == 0:
            results.append((label, n, np.nan))
            continue
        w_vec = interpolate_weights_vectorized(por_shifted[regime_mask], anchor_flows, anchor_weights)
        estimated = (1.0 - w_vec) * por_shifted[regime_mask] + w_vec * ef_cfs[regime_mask]
        rmse = np.sqrt(np.mean((estimated - lf_actual[regime_mask]) ** 2))
        results.append((label, n, rmse))
    return results


def coordinate_descent(lf_actual, por_shifted, ef_cfs, initial_weights,
                       anchor_flows=ANCHOR_FLOWS, verbose=True):
    """Run full coordinate descent (coarse + fine) and return optimized weights."""
    weights = initial_weights.copy()
    coarse_grid = np.arange(W_MIN, W_MAX + COARSE_STEP / 2, COARSE_STEP)

    # Coarse passes
    for pass_num in range(1, N_COARSE_PASSES + 1):
        for a in range(len(anchor_flows)):
            best_w = weights[a]
            best_rmse = np.inf
            for candidate in coarse_grid:
                trial = weights.copy()
                trial[a] = candidate
                trial = enforce_monotonicity(trial)
                rmse = compute_rmse_for_anchors(
                    lf_actual, por_shifted, ef_cfs, anchor_flows, trial
                )
                if rmse < best_rmse:
                    best_rmse = rmse
                    best_w = candidate
            weights[a] = best_w
            weights = enforce_monotonicity(weights)
        if verbose:
            rmse_now = compute_rmse_for_anchors(lf_actual, por_shifted, ef_cfs, anchor_flows, weights)
            print(f"  Coarse pass {pass_num}: RMSE={rmse_now:.1f}  weights={np.round(weights, 2)}")

    # Fine passes
    for pass_num in range(1, N_FINE_PASSES + 1):
        for a in range(len(anchor_flows)):
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
                    lf_actual, por_shifted, ef_cfs, anchor_flows, trial
                )
                if rmse < best_rmse:
                    best_rmse = rmse
                    best_w = round(candidate, 4)
            weights[a] = best_w
            weights = enforce_monotonicity(weights)
        if verbose:
            rmse_now = compute_rmse_for_anchors(lf_actual, por_shifted, ef_cfs, anchor_flows, weights)
            print(f"  Fine pass {pass_num}: RMSE={rmse_now:.2f}  weights={np.round(weights, 2)}")

    # Round to ROUND_DECIMALS decimal places
    weights_rounded = np.round(weights, ROUND_DECIMALS)
    weights_rounded = enforce_monotonicity(weights_rounded)
    return weights_rounded


def optimize():
    """Main optimization routine."""
    df = load_and_prepare()
    n_valid = len(df)

    por_shifted = df["por_lagged"].values
    ef_cfs = df["ef_cfs"].values
    lf_actual = df["lf_discharge"].values
    rising_mask = df["rising"].values
    years = df["year"].values

    print(f"\nNumber of valid rows used: {n_valid}")

    # ── Baseline RMSEs ─────────────────────────────────────────────────────
    current_rmse = compute_rmse_for_anchors(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, CURRENT_WEIGHTS)
    prev_hourly_rmse = compute_rmse_for_anchors(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, PREVIOUS_HOURLY_WEIGHTS)

    print(f"\n{'='*70}")
    print("BASELINES ON HOURLY DATA")
    print(f"  Current v28.0 weights   {CURRENT_WEIGHTS}:  RMSE={current_rmse:.1f} cfs")
    print(f"  Previous hourly weights {PREVIOUS_HOURLY_WEIGHTS}:  RMSE={prev_hourly_rmse:.1f} cfs")

    # ── Coordinate descent from ZEROS ──────────────────────────────────────
    print(f"\n{'='*70}")
    print("COORDINATE DESCENT — ZERO-INITIALIZED, W_MAX=0.80")
    print(f"  Initial weights: {INITIAL_WEIGHTS}")
    print(f"  Coarse: {N_COARSE_PASSES} passes, step={COARSE_STEP}")
    print(f"  Fine:   {N_FINE_PASSES} passes, step={FINE_STEP}, radius=+/-{FINE_RADIUS}")
    print(f"  Rounding: {ROUND_DECIMALS} decimal places")

    weights_new = coordinate_descent(lf_actual, por_shifted, ef_cfs, INITIAL_WEIGHTS, verbose=True)

    new_rmse = compute_rmse_for_anchors(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, weights_new)

    # ── Output 1: Optimal weights at each anchor ──────────────────────────
    print(f"\n{'='*70}")
    print(f"OPTIMAL WEIGHTS (rounded to {ROUND_DECIMALS} decimal places)")
    print(f"{'='*70}")
    print(f"{'Anchor Flow (cfs)':>20s} {'New Weight':>12s} {'Current':>10s} {'Prev Hourly':>13s}")
    print(f"{'-'*58}")
    for f, wn, wc, wp in zip(ANCHOR_FLOWS, weights_new, CURRENT_WEIGHTS, PREVIOUS_HOURLY_WEIGHTS):
        print(f"{f:>20,.0f} {wn:>12.2f} {wc:>10.2f} {wp:>13.2f}")

    # ── Output 2: Overall RMSE comparison ─────────────────────────────────
    print(f"\n{'='*70}")
    print("OVERALL RMSE COMPARISON")
    print(f"{'='*70}")
    print(f"  New unconstrained (v2):         {new_rmse:.1f} cfs")
    print(f"  Current v28.0 weights:          {current_rmse:.1f} cfs")
    print(f"  Previous hourly (binding):      {prev_hourly_rmse:.1f} cfs")

    diff_vs_current = current_rmse - new_rmse
    pct_vs_current = diff_vs_current / current_rmse * 100
    diff_vs_prev = prev_hourly_rmse - new_rmse
    pct_vs_prev = diff_vs_prev / prev_hourly_rmse * 100

    if diff_vs_current > 0:
        print(f"  vs current: -{diff_vs_current:.1f} cfs ({pct_vs_current:.1f}% improvement)")
    else:
        print(f"  vs current: +{-diff_vs_current:.1f} cfs ({-pct_vs_current:.1f}% worse)")
    if diff_vs_prev > 0:
        print(f"  vs prev hourly: -{diff_vs_prev:.1f} cfs ({pct_vs_prev:.1f}% improvement)")
    else:
        print(f"  vs prev hourly: +{-diff_vs_prev:.1f} cfs ({-pct_vs_prev:.1f}% worse)")

    # ── Output 3: RMSE by flow regime ─────────────────────────────────────
    print(f"\n{'='*70}")
    print("RMSE BY FLOW REGIME (por_lagged)")
    print(f"{'='*70}")
    print(f"{'Regime':>10s} {'N':>8s} {'New':>10s} {'Current':>10s} {'PrevHr':>10s} {'New-Cur':>10s}")
    print(f"{'-'*62}")

    regime_new = rmse_by_regime(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, weights_new)
    regime_cur = rmse_by_regime(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, CURRENT_WEIGHTS)
    regime_prev = rmse_by_regime(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, PREVIOUS_HOURLY_WEIGHTS)

    for (label, n_n, r_n), (_, n_c, r_c), (_, n_p, r_p) in zip(regime_new, regime_cur, regime_prev):
        if n_n == 0:
            print(f"{label:>10s} {n_n:>8d} {'n/a':>10s} {'n/a':>10s} {'n/a':>10s} {'':>10s}")
        else:
            chg = r_n - r_c
            sign = "+" if chg > 0 else ""
            print(f"{label:>10s} {n_n:>8d} {r_n:>10.1f} {r_c:>10.1f} {r_p:>10.1f} {sign}{chg:>9.1f}")

    # ── Output 4: Rising-event RMSE by flow regime ────────────────────────
    print(f"\n{'='*70}")
    print("RISING-EVENT RMSE BY FLOW REGIME (por_lagged increased >5% vs previous row)")
    print(f"{'='*70}")
    print(f"{'Regime':>10s} {'N rise':>8s} {'New':>10s} {'Current':>10s} {'PrevHr':>10s} {'New-Cur':>10s}")
    print(f"{'-'*62}")

    regime_new_r = rmse_by_regime(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, weights_new, mask_extra=rising_mask)
    regime_cur_r = rmse_by_regime(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, CURRENT_WEIGHTS, mask_extra=rising_mask)
    regime_prev_r = rmse_by_regime(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, PREVIOUS_HOURLY_WEIGHTS, mask_extra=rising_mask)

    for (label, n_n, r_n), (_, n_c, r_c), (_, n_p, r_p) in zip(regime_new_r, regime_cur_r, regime_prev_r):
        if n_n == 0:
            print(f"{label:>10s} {n_n:>8d} {'n/a':>10s} {'n/a':>10s} {'n/a':>10s} {'':>10s}")
        else:
            chg = r_n - r_c
            sign = "+" if chg > 0 else ""
            print(f"{label:>10s} {n_n:>8d} {r_n:>10.1f} {r_c:>10.1f} {r_p:>10.1f} {sign}{chg:>9.1f}")

    # ── Output 5: Leave-one-year-out cross-validation ─────────────────────
    print(f"\n{'='*70}")
    print("LEAVE-ONE-YEAR-OUT CROSS-VALIDATION")
    print(f"{'='*70}")
    print(f"{'Holdout':>10s} {'N train':>10s} {'N test':>10s} {'New RMSE':>10s} {'Cur RMSE':>10s} {'Diff':>10s}")
    print(f"{'-'*62}")

    unique_years = sorted(np.unique(years))
    cv_results = []

    for holdout_year in unique_years:
        train_mask = years != holdout_year
        test_mask = years == holdout_year

        n_train = train_mask.sum()
        n_test = test_mask.sum()

        if n_test == 0:
            continue

        # Train: optimize weights on training data
        cv_weights = coordinate_descent(
            lf_actual[train_mask], por_shifted[train_mask], ef_cfs[train_mask],
            INITIAL_WEIGHTS, verbose=False
        )

        # Test: evaluate on holdout year
        cv_rmse = compute_rmse_for_anchors(
            lf_actual[test_mask], por_shifted[test_mask], ef_cfs[test_mask],
            ANCHOR_FLOWS, cv_weights
        )
        cur_test_rmse = compute_rmse_for_anchors(
            lf_actual[test_mask], por_shifted[test_mask], ef_cfs[test_mask],
            ANCHOR_FLOWS, CURRENT_WEIGHTS
        )

        diff_cv = cv_rmse - cur_test_rmse
        sign = "+" if diff_cv > 0 else ""
        print(f"{holdout_year:>10d} {n_train:>10d} {n_test:>10d} {cv_rmse:>10.1f} {cur_test_rmse:>10.1f} {sign}{diff_cv:>9.1f}")
        cv_results.append((holdout_year, n_train, n_test, cv_rmse, cur_test_rmse, cv_weights))

    # Average CV RMSE
    if cv_results:
        avg_new = np.mean([r[3] for r in cv_results])
        avg_cur = np.mean([r[4] for r in cv_results])
        diff_avg = avg_new - avg_cur
        sign = "+" if diff_avg > 0 else ""
        print(f"{'-'*62}")
        print(f"{'Average':>10s} {'':>10s} {'':>10s} {avg_new:>10.1f} {avg_cur:>10.1f} {sign}{diff_avg:>9.1f}")

    # Print CV-fold weights for transparency
    print(f"\nCV-fold optimized weights:")
    for holdout_year, n_train, n_test, cv_rmse, cur_test_rmse, cv_w in cv_results:
        w_str = ", ".join([f"{w:.2f}" for w in cv_w])
        print(f"  Holdout {holdout_year}: [{w_str}]")

    # ── Output 6: Summary ─────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print("SUMMARY")
    print(f"{'='*70}")
    print(f"  Valid hourly rows used: {n_valid}")
    print(f"  Rising events: {rising_mask.sum()} ({rising_mask.sum()/n_valid*100:.1f}%)")

    # ── Output 7: Comparison table ────────────────────────────────────────
    print(f"\n{'='*70}")
    print("COMPARISON TABLE: CURRENT vs PREVIOUS HOURLY vs NEW UNCONSTRAINED")
    print(f"{'='*70}")
    print(f"{'Anchor':>10s} {'Current':>10s} {'PrevHr':>10s} {'New v2':>10s} {'New-Cur':>10s} {'New-Prev':>10s}")
    print(f"{'-'*55}")
    for f, wc, wp, wn in zip(ANCHOR_FLOWS, CURRENT_WEIGHTS, PREVIOUS_HOURLY_WEIGHTS, weights_new):
        dc = wn - wc
        dp = wn - wp
        sc = "+" if dc > 0 else ""
        sp = "+" if dp > 0 else ""
        print(f"{f:>10,.0f} {wc:>10.2f} {wp:>10.2f} {wn:>10.2f} {sc}{dc:>9.2f} {sp}{dp:>9.2f}")
    print(f"{'-'*55}")
    print(f"{'RMSE':>10s} {current_rmse:>10.1f} {prev_hourly_rmse:>10.1f} {new_rmse:>10.1f} ", end="")
    d1 = new_rmse - current_rmse
    d2 = new_rmse - prev_hourly_rmse
    s1 = "+" if d1 > 0 else ""
    s2 = "+" if d2 > 0 else ""
    print(f"{s1}{d1:>9.1f} {s2}{d2:>9.1f}")

    # ── Save CSV ──────────────────────────────────────────────────────────
    out_df = pd.DataFrame({
        "anchor_flow": ANCHOR_FLOWS.astype(int),
        "optimal_weight_v2": weights_new,
        "current_weight": CURRENT_WEIGHTS,
        "prev_hourly_weight": PREVIOUS_HOURLY_WEIGHTS,
    })
    out_df.to_csv(OUT_CSV, index=False)
    print(f"\nSaved: {OUT_CSV}")

    # ── Print for code integration ────────────────────────────────────────
    a_str = ", ".join([f"{int(a)}" for a in ANCHOR_FLOWS])
    w_str = ", ".join([f"{w:.2f}" for w in weights_new])
    print(f"\nFor code:")
    print(f"  Anchors: [{a_str}]")
    print(f"  Weights: [{w_str}]")

    return weights_new, new_rmse


if __name__ == "__main__":
    optimize()

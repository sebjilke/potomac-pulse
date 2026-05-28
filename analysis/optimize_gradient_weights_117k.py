#!/usr/bin/env python3
"""
Gradient weight optimization for EF blending on expanded 117,704-row hourly dataset.
Blind Python agent — no access to R results or previous optimization outputs.

Objective: minimize RMSE of blended GF estimate vs LF actual discharge.
  GF = (1-w) * por_lagged + w * ef_estimate
  w = piecewise-linear interpolation of anchor weights at flow breakpoints.

Coordinate descent with monotonicity constraint (w[i] >= w[i-1]).
Zero-initialized to avoid warm-start bias.

v2: Fixed sweep logic to properly explore coarse grid before fine-tuning.
"""

import numpy as np
import pandas as pd
import time

# ── Configuration ──────────────────────────────────────────────────────────
ANCHORS = np.array([0, 3000, 6000, 10000, 15000, 25000, 50000], dtype=float)
W_MIN = 0.00
W_MAX = 0.80
COARSE_STEP = 0.05
FINE_STEP = 0.01
COARSE_SWEEPS = 5
FINE_SWEEPS = 3
N_ANCHORS = len(ANCHORS)

DATA_PATH = "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
OUTPUT_PATH = "/Users/sebjilke/Desktop/PotomacPulse/analysis/gradient_weights_117k_python.csv"

# ── Load & prepare data ───────────────────────────────────────────────────
print("=" * 72)
print("GRADIENT WEIGHT OPTIMIZATION — 117k HOURLY DATASET (PYTHON)")
print("=" * 72)
t0 = time.time()

df = pd.read_csv(DATA_PATH, parse_dates=["timestamp"])
print(f"\nLoaded {len(df):,} rows from {DATA_PATH}")
print(f"Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
print(f"Columns: {list(df.columns)}")

# ── Compute EF estimate ──────────────────────────────────────────────────
cold_mask = df["water_temp_c"].notna() & (df["water_temp_c"] <= 10.0)
df["ef_estimate"] = np.where(
    cold_mask,
    160.0 * np.power(df["ef_stage"], 2.36),
    126.0 * np.power(df["ef_stage"], 2.46),
)
print(f"\nEF estimate computed:")
print(f"  Cold-water rows (temp <= 10C): {cold_mask.sum():,}")
print(f"  Default rows: {(~cold_mask).sum():,}")

# ── Filter to valid rows ─────────────────────────────────────────────────
valid = (
    df["por_lagged"].notna()
    & df["ef_stage"].notna()
    & df["lf_discharge"].notna()
    & (df["ef_stage"] > 0)
    & df["ef_estimate"].notna()
)
df_valid = df[valid].copy()
print(f"\nValid rows for optimization: {len(df_valid):,} of {len(df):,}")

por_lagged = df_valid["por_lagged"].values.astype(np.float64)
ef_estimate = df_valid["ef_estimate"].values.astype(np.float64)
lf_actual = df_valid["lf_discharge"].values.astype(np.float64)
n = len(por_lagged)


# ── Piecewise-linear weight interpolation ─────────────────────────────────
def get_weights_vectorized(flows, anchor_weights):
    """Interpolate weights for an array of flows using anchor points."""
    return np.interp(flows, ANCHORS, anchor_weights)


def compute_rmse(weights, por, ef_est, lf_act):
    """Compute RMSE for given anchor weights."""
    w = get_weights_vectorized(por, weights)
    blended = (1.0 - w) * por + w * ef_est
    return np.sqrt(np.mean((blended - lf_act) ** 2))


# ── Coordinate descent optimization ──────────────────────────────────────
def optimize_coordinate_descent(por, ef_est, lf_act, verbose=True):
    """
    Run coordinate descent with forward-only monotonicity: w[i] >= w[i-1].

    For each anchor i, sweep from the allowed minimum (max of w[i-1], search lo)
    to the allowed maximum (min of w[i+1], W_MAX, search hi).
    This properly enforces monotonicity in both directions.
    """
    weights = np.zeros(N_ANCHORS)  # Zero-init
    best_rmse = compute_rmse(weights, por, ef_est, lf_act)

    if verbose:
        print(f"\n--- Coarse pass (step={COARSE_STEP}, {COARSE_SWEEPS} sweeps) ---")
        print(f"Initial RMSE (all zeros): {best_rmse:.2f} cfs")

    # Coarse pass
    for sweep in range(COARSE_SWEEPS):
        improved = False
        for i in range(N_ANCHORS):
            # Monotonicity bounds
            lo = weights[i - 1] if i > 0 else W_MIN
            hi = weights[i + 1] if i < N_ANCHORS - 1 else W_MAX
            hi = max(hi, lo)  # in case bounds are inverted

            best_wi = weights[i]
            candidates = np.arange(lo, hi + COARSE_STEP / 2, COARSE_STEP)
            candidates = np.clip(candidates, lo, hi)
            candidates = np.unique(np.round(candidates, 2))

            for c in candidates:
                weights[i] = c
                rmse = compute_rmse(weights, por, ef_est, lf_act)
                if rmse < best_rmse - 1e-10:
                    best_rmse = rmse
                    best_wi = c
                    improved = True
            weights[i] = best_wi

        if verbose:
            print(f"  Sweep {sweep + 1}: RMSE={best_rmse:.4f}, "
                  f"weights={[f'{w:.2f}' for w in weights]}")
        if not improved:
            if verbose:
                print(f"  Converged at sweep {sweep + 1}")
            break

    if verbose:
        print(f"\n--- Fine pass (step={FINE_STEP}, {FINE_SWEEPS} sweeps) ---")

    # Fine pass: search +-0.05 around current value, respecting monotonicity
    for sweep in range(FINE_SWEEPS):
        improved = False
        for i in range(N_ANCHORS):
            # Monotonicity bounds
            lo = weights[i - 1] if i > 0 else W_MIN
            hi = weights[i + 1] if i < N_ANCHORS - 1 else W_MAX
            hi = max(hi, lo)

            # Fine search range: +-0.05 from current, clipped to mono bounds
            search_lo = max(lo, weights[i] - 0.05)
            search_hi = min(hi, weights[i] + 0.05)

            best_wi = weights[i]
            candidates = np.arange(search_lo, search_hi + FINE_STEP / 2, FINE_STEP)
            candidates = np.clip(candidates, lo, hi)
            candidates = np.unique(np.round(candidates, 2))

            for c in candidates:
                weights[i] = c
                rmse = compute_rmse(weights, por, ef_est, lf_act)
                if rmse < best_rmse - 1e-10:
                    best_rmse = rmse
                    best_wi = c
                    improved = True
            weights[i] = best_wi

        if verbose:
            print(f"  Sweep {sweep + 1}: RMSE={best_rmse:.4f}, "
                  f"weights={[f'{w:.2f}' for w in weights]}")
        if not improved:
            if verbose:
                print(f"  Converged at sweep {sweep + 1}")
            break

    return weights, best_rmse


# ── Run optimization ─────────────────────────────────────────────────────
print("\n" + "=" * 72)
print("FULL DATASET OPTIMIZATION")
print("=" * 72)
opt_weights, opt_rmse = optimize_coordinate_descent(por_lagged, ef_estimate, lf_actual)


# ── Current v29.0 baseline ────────────────────────────────────────────────
def v29_weights(flows):
    """v29.0: 0% below 3k, 35% above 3k (flat step)."""
    return np.where(flows < 3000, 0.0, 0.35)


w_v29 = v29_weights(por_lagged)
blended_v29 = (1.0 - w_v29) * por_lagged + w_v29 * ef_estimate
rmse_v29 = np.sqrt(np.mean((blended_v29 - lf_actual) ** 2))

# Also compute pure por_lagged baseline (w=0 everywhere)
rmse_por_only = np.sqrt(np.mean((por_lagged - lf_actual) ** 2))

print(f"\n{'=' * 72}")
print("RESULTS SUMMARY")
print(f"{'=' * 72}")
print(f"\nOptimal weights at anchor flows:")
for i in range(N_ANCHORS):
    print(f"  {int(ANCHORS[i]):>6,} cfs: w = {opt_weights[i]:.2f}")

print(f"\nOverall RMSE comparison:")
print(f"  PoR-only (w=0):       {rmse_por_only:.2f} cfs")
print(f"  v29.0 flat 35%:       {rmse_v29:.2f} cfs")
print(f"  New optimized:        {opt_rmse:.2f} cfs")
print(f"  vs v29.0:             {opt_rmse - rmse_v29:+.2f} cfs ({(opt_rmse - rmse_v29) / rmse_v29 * 100:+.2f}%)")
print(f"  vs PoR-only:          {opt_rmse - rmse_por_only:+.2f} cfs ({(opt_rmse - rmse_por_only) / rmse_por_only * 100:+.2f}%)")

# ── RMSE by flow regime ──────────────────────────────────────────────────
flow_bins = [
    ("<3k", 0, 3000),
    ("3-6k", 3000, 6000),
    ("6-10k", 6000, 10000),
    ("10-15k", 10000, 15000),
    ("15-25k", 15000, 25000),
    ("25-50k", 25000, 50000),
    (">50k", 50000, np.inf),
]

w_opt_all = get_weights_vectorized(por_lagged, opt_weights)
blended_opt = (1.0 - w_opt_all) * por_lagged + w_opt_all * ef_estimate

print(f"\n{'Label':<10} {'N':>8} {'RMSE_PoR':>10} {'RMSE_v29':>10} {'RMSE_new':>10} {'vs v29':>10}")
print("-" * 62)
for label, lo, hi in flow_bins:
    mask = (por_lagged >= lo) & (por_lagged < hi)
    n_bin = mask.sum()
    if n_bin == 0:
        print(f"{label:<10} {0:>8}")
        continue
    rmse_por = np.sqrt(np.mean((por_lagged[mask] - lf_actual[mask]) ** 2))
    rmse_old = np.sqrt(np.mean((blended_v29[mask] - lf_actual[mask]) ** 2))
    rmse_new = np.sqrt(np.mean((blended_opt[mask] - lf_actual[mask]) ** 2))
    change = rmse_new - rmse_old
    print(f"{label:<10} {n_bin:>8,} {rmse_por:>10.1f} {rmse_old:>10.1f} {rmse_new:>10.1f} {change:>+10.1f}")

# ── Bias analysis ────────────────────────────────────────────────────────
print(f"\nBias analysis (mean error = blended - actual):")
bias_v29 = np.mean(blended_v29 - lf_actual)
bias_opt = np.mean(blended_opt - lf_actual)
print(f"  v29.0:     {bias_v29:+.1f} cfs")
print(f"  Optimized: {bias_opt:+.1f} cfs")

# ── Leave-one-year-out cross-validation ──────────────────────────────────
print(f"\n{'=' * 72}")
print("LEAVE-ONE-YEAR-OUT CROSS-VALIDATION")
print(f"{'=' * 72}")

df_valid["year"] = df_valid["timestamp"].dt.year
years = sorted(df_valid["year"].unique())
cv_years = [y for y in years if 2012 <= y <= 2025]

print(f"\nCV years: {[int(y) for y in cv_years]}")
print(f"Skipping: 2011 (partial Dec only), 2026 (partial)")

cv_results = []
print(f"\n{'Year':<6} {'N_train':>8} {'N_test':>8} {'RMSE_v29':>10} {'RMSE_opt':>10} "
      f"{'Improv':>10} {'Weights (0/3k/6k/10k/15k/25k/50k)'}")
print("-" * 110)

for test_year in cv_years:
    train_mask = df_valid["year"] != test_year
    test_mask = df_valid["year"] == test_year

    por_train = por_lagged[train_mask]
    ef_train = ef_estimate[train_mask]
    lf_train = lf_actual[train_mask]

    por_test = por_lagged[test_mask]
    ef_test = ef_estimate[test_mask]
    lf_test = lf_actual[test_mask]

    n_train = int(train_mask.sum())
    n_test = int(test_mask.sum())

    if n_test < 10:
        print(f"{int(test_year):<6} {n_train:>8,} {n_test:>8,}  (too few test obs)")
        continue

    # Optimize on training set (quiet)
    cv_w, _ = optimize_coordinate_descent(por_train, ef_train, lf_train, verbose=False)

    # Evaluate on test set
    w_test = get_weights_vectorized(por_test, cv_w)
    blended_test = (1.0 - w_test) * por_test + w_test * ef_test
    rmse_test_opt = np.sqrt(np.mean((blended_test - lf_test) ** 2))

    # v29 on test set
    w_test_v29 = v29_weights(por_test)
    blended_test_v29 = (1.0 - w_test_v29) * por_test + w_test_v29 * ef_test
    rmse_test_v29 = np.sqrt(np.mean((blended_test_v29 - lf_test) ** 2))

    improvement = rmse_test_v29 - rmse_test_opt
    cv_results.append({
        "year": int(test_year),
        "n_train": n_train,
        "n_test": n_test,
        "rmse_v29": rmse_test_v29,
        "rmse_opt": rmse_test_opt,
        "improvement": improvement,
        "weights": cv_w.tolist(),
    })
    w_str = " / ".join([f"{w:.2f}" for w in cv_w])
    print(f"{int(test_year):<6} {n_train:>8,} {n_test:>8,} {rmse_test_v29:>10.1f} "
          f"{rmse_test_opt:>10.1f} {improvement:>+10.1f}  [{w_str}]")

# CV summary
if cv_results:
    cv_df = pd.DataFrame(cv_results)
    mean_v29 = cv_df["rmse_v29"].mean()
    mean_opt = cv_df["rmse_opt"].mean()
    print(f"\nCV Summary:")
    print(f"  Mean RMSE (v29.0):     {mean_v29:.1f} cfs")
    print(f"  Mean RMSE (optimized): {mean_opt:.1f} cfs")
    print(f"  Mean Improvement:      {mean_v29 - mean_opt:+.1f} cfs ({(mean_v29 - mean_opt)/mean_v29*100:+.1f}%)")
    n_improved = (cv_df["improvement"] > 0).sum()
    n_total = len(cv_df)
    print(f"  Years where optimized beats v29: {n_improved}/{n_total}")

# ── Save results ─────────────────────────────────────────────────────────
results_df = pd.DataFrame({
    "anchor_flow_cfs": ANCHORS.astype(int),
    "optimal_weight": np.round(opt_weights, 2),
})
results_df.to_csv(OUTPUT_PATH, index=False)
print(f"\nResults saved to {OUTPUT_PATH}")

# ── Verify saved file ────────────────────────────────────────────────────
verify = pd.read_csv(OUTPUT_PATH)
print(f"\nVerification — re-read {OUTPUT_PATH}:")
print(verify.to_string(index=False))

elapsed = time.time() - t0
print(f"\nTotal runtime: {elapsed:.1f} seconds")
print(f"\n{'=' * 72}")
print("PYTHON OPTIMIZATION COMPLETE")
print(f"{'=' * 72}")

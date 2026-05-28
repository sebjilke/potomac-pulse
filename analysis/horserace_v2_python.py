#!/usr/bin/env python3
"""
GF Estimation Horse Race v2 — Python Blind Subagent
====================================================
Compares 7 approaches for estimating Great Falls (GF) discharge on the Potomac
River, evaluated against Little Falls (LF) actual discharge (USGS 01646500).

Approaches:
  0 - Baseline (v29.0 production model, with tributaries)
  1 - PoR Ratio Scaler (continuous interpolation)
  2 - Actual Tributary Addback (with ungauged scaling)
  3 - Regression Ensemble (log-linear Ridge)
  4 - Combined Ratio + Tributaries
  5 - EF-Dominant (logistic weight function)
  6 - EF Power-Law Refit (direct LF prediction)

Evaluation: Leave-One-Year-Out CV (14 folds, 2012-2025), 48h buffer.
Output:     analysis/horserace_v2_python.csv
"""

import numpy as np
import pandas as pd
import warnings
import time
import os

warnings.filterwarnings("ignore")
np.random.seed(42)

t0 = time.time()

# ============================================================================
# PATHS
# ============================================================================
BASE_DIR = "/Users/sebjilke/Desktop/PotomacPulse/analysis"
DATA_PATH = os.path.join(BASE_DIR, "hourly_backtest_data.csv")
TRIB_PATH = os.path.join(BASE_DIR, "tributary_hourly_data.csv")
OUTPUT_PATH = os.path.join(BASE_DIR, "horserace_v2_python.csv")

# ============================================================================
# CONSTANTS
# ============================================================================
FLOW_BINS = [0, 2000, 5000, 10000, 20000, 50000, np.inf]
FLOW_BIN_LABELS = ["0-2k", "2-5k", "5-10k", "10-20k", "20-50k", "50k+"]
CV_YEARS = list(range(2012, 2026))  # 14 folds
BUFFER_HOURS = 48

# Approach names
APPROACH_NAMES = [
    "0_baseline", "1_ratio_scaler", "2_trib_addback",
    "3_regression", "4_combined", "5_ef_dominant", "6_ef_refit",
]

# ============================================================================
# DATA LOADING
# ============================================================================
print("=" * 80)
print("GF ESTIMATION HORSE RACE v2 — PYTHON")
print("=" * 80)

print("\n--- Loading main data ---")
df = pd.read_csv(DATA_PATH, parse_dates=["timestamp"])
df = df.sort_values("timestamp").reset_index(drop=True)
print(f"  Rows: {len(df):,}")
print(f"  Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
print(f"  Columns: {list(df.columns)}")
print(f"  water_temp_c NaN: {df['water_temp_c'].isna().sum():,} "
      f"({df['water_temp_c'].isna().mean()*100:.1f}%)")

print("\n--- Loading tributary data ---")
trib = pd.read_csv(TRIB_PATH, parse_dates=["timestamp"])
print(f"  Rows: {len(trib):,}")
print(f"  Date range: {trib['timestamp'].min()} to {trib['timestamp'].max()}")

# Merge tributaries
df = pd.merge(df, trib, on="timestamp", how="left")
n_mono = df["monocacy_q"].notna().sum()
n_goose = df["goose_q"].notna().sum()
print(f"  Monocacy matched: {n_mono:,} / {len(df):,} ({100*n_mono/len(df):.1f}%)")
print(f"  Goose matched:    {n_goose:,} / {len(df):,} ({100*n_goose/len(df):.1f}%)")

# Tributary fallback: NaN -> LF * fraction
lf_vals = df["lf_discharge"].values.astype(np.float64)
df["monocacy_flow"] = df["monocacy_q"].fillna(df["lf_discharge"] * 0.071)
df["goose_flow"] = df["goose_q"].fillna(df["lf_discharge"] * 0.030)

print(f"  Monocacy NaN after fallback: {df['monocacy_flow'].isna().sum()}")
print(f"  Goose NaN after fallback:    {df['goose_flow'].isna().sum()}")

# ============================================================================
# DERIVED COLUMNS
# ============================================================================
print("\n--- Computing derived columns ---")

# Year and month
df["year"] = df["timestamp"].dt.year
df["month"] = df["timestamp"].dt.month

# EF power law (with seasonal proxy for pre-2021)
ef_stage = df["ef_stage"].values.astype(np.float64)
water_temp = df["water_temp_c"].values.astype(np.float64)
year_arr = df["year"].values
month_arr = df["month"].values

# Cold detection: use actual temp if available, else seasonal proxy for pre-2021
cold_mask = np.zeros(len(df), dtype=bool)
has_temp = ~np.isnan(water_temp)
cold_mask[has_temp] = water_temp[has_temp] <= 10.0
# Seasonal proxy for pre-2021 with missing temp
no_temp_pre2021 = (~has_temp) & (year_arr < 2021)
cold_months = np.isin(month_arr, [12, 1, 2, 3])
cold_mask[no_temp_pre2021] = cold_months[no_temp_pre2021]

df["ef_cfs"] = np.where(cold_mask, 160.0 * ef_stage**2.36, 126.0 * ef_stage**2.46)
print(f"  Cold-water obs: {cold_mask.sum():,} ({cold_mask.mean()*100:.1f}%)")
print(f"    From actual temp: {(has_temp & cold_mask).sum():,}")
print(f"    From seasonal proxy: {(no_temp_pre2021 & cold_mask).sum():,}")

# Flow state classification
hourly_change = np.zeros(len(df))
hourly_change[1:] = lf_vals[1:] - lf_vals[:-1]
threshold = np.maximum(100.0, 0.02 * lf_vals)
flow_state = np.where(
    hourly_change >= threshold, "rising",
    np.where(hourly_change <= -threshold, "falling", "steady")
)
df["flow_state"] = flow_state
print(f"  Flow states: rising={np.sum(flow_state=='rising'):,}, "
      f"falling={np.sum(flow_state=='falling'):,}, "
      f"steady={np.sum(flow_state=='steady'):,}")

# Flow bins
df["flow_bin"] = pd.cut(df["lf_discharge"], bins=FLOW_BINS,
                         labels=FLOW_BIN_LABELS, right=False)

# Valid mask (all key columns present)
valid_mask = (
    df["por_lagged"].notna() & df["por_now"].notna() &
    df["ef_stage"].notna() & (df["ef_stage"] > 0) &
    df["lf_discharge"].notna() & df["travel_time_h"].notna() &
    (df["travel_time_h"] > 0) & df["monocacy_flow"].notna() &
    df["goose_flow"].notna()
)
dv = df[valid_mask].copy().reset_index(drop=True)
print(f"\n  Valid observations: {len(dv):,} / {len(df):,}")
print(f"  Year range: {dv['year'].min()} to {dv['year'].max()}")

# Pre-extract arrays for performance
por_lagged = dv["por_lagged"].values.astype(np.float64)
por_now = dv["por_now"].values.astype(np.float64)
ef_stage_v = dv["ef_stage"].values.astype(np.float64)
ef_cfs = dv["ef_cfs"].values.astype(np.float64)
lf = dv["lf_discharge"].values.astype(np.float64)
travel_time = dv["travel_time_h"].values.astype(np.float64)
mono_flow = dv["monocacy_flow"].values.astype(np.float64)
goose_flow = dv["goose_flow"].values.astype(np.float64)
mono_actual = dv["monocacy_q"].values.astype(np.float64)
goose_actual = dv["goose_q"].values.astype(np.float64)
water_temp_v = dv["water_temp_c"].values.astype(np.float64)
year_v = dv["year"].values
month_v = dv["month"].values
flow_state_v = dv["flow_state"].values
flow_bin_v = dv["flow_bin"].values
timestamps = dv["timestamp"].values


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def compute_metrics(estimate, actual, baseline_mse=None):
    """Compute all evaluation metrics."""
    n = len(estimate)
    if n == 0:
        return {"n": 0, "rmse": np.nan, "mae": np.nan, "bias": np.nan,
                "pct_bias": np.nan, "mdape": np.nan, "skill_score": np.nan,
                "undershoot_pct": np.nan}
    err = estimate - actual
    abs_err = np.abs(err)
    rmse = np.sqrt(np.mean(err**2))
    mae = np.mean(abs_err)
    bias = np.mean(err)
    # Pct_Bias: mean of (error / actual * 100)
    safe_actual = np.where(actual > 0, actual, np.nan)
    pct_bias = np.nanmean(err / safe_actual * 100)
    # MdAPE: median absolute percentage error
    mdape = np.nanmedian(abs_err / safe_actual * 100)
    # Skill score
    mse = np.mean(err**2)
    if baseline_mse is not None and baseline_mse > 0:
        skill_score = 1.0 - mse / baseline_mse
    else:
        skill_score = 0.0
    # Undershoot %
    undershoot_pct = np.mean(estimate < actual) * 100.0
    return {
        "n": int(n),
        "rmse": round(rmse, 2),
        "mae": round(mae, 2),
        "bias": round(bias, 2),
        "pct_bias": round(pct_bias, 4),
        "mdape": round(mdape, 4),
        "skill_score": round(skill_score, 6),
        "undershoot_pct": round(undershoot_pct, 4),
    }


def baseline_estimate(por_lag, por_n, ef, lf_val, tt, mono, goose,
                      decay_cap=0.50):
    """
    Compute v29.0 baseline estimate (vectorized).
    CRITICAL: includes tributaries in base estimate.
    """
    # Base = time-shifted PoR + tributaries
    base = por_lag + mono + goose

    # PoR-delta correction
    por_change_ratio = np.where(por_lag > 0, por_n / por_lag, 1.0)
    por_change_pct = (por_change_ratio - 1.0) * 100.0
    staleness = 1.0  # hourly data: 1 hour since last reading
    frac_elapsed = np.minimum(1.0, staleness / np.maximum(1.0, tt))
    decay_factor = np.minimum(decay_cap, np.sqrt(frac_elapsed))
    applied_ratio = 1.0 + (por_change_ratio - 1.0) * decay_factor
    mask_correct = np.abs(por_change_pct) > 5.0
    base = np.where(mask_correct, base * applied_ratio, base)

    # EF weight: 0% below 3k cfs, 35% at or above 3k cfs
    ef_weight = np.where(lf_val >= 3000.0, 0.35, 0.0)

    # Discrepancy guard
    discrepancy = np.where(base > 0, np.abs(ef - base) / base, 999.0)
    blended = np.where(
        discrepancy > 0.50,
        base,
        (1.0 - ef_weight) * base + ef_weight * ef
    )

    # Soft LF ceiling (120%)
    blended = np.where(lf_val > 0, np.minimum(blended, lf_val * 1.20), blended)

    return blended


def apply_por_delta_correction(base, por_lag, por_n, tt, decay_cap=0.50):
    """Apply PoR-delta correction to a base estimate (vectorized)."""
    por_change_ratio = np.where(por_lag > 0, por_n / por_lag, 1.0)
    por_change_pct = (por_change_ratio - 1.0) * 100.0
    staleness = 1.0
    frac_elapsed = np.minimum(1.0, staleness / np.maximum(1.0, tt))
    decay_factor = np.minimum(decay_cap, np.sqrt(frac_elapsed))
    applied_ratio = 1.0 + (por_change_ratio - 1.0) * decay_factor
    mask_correct = np.abs(por_change_pct) > 5.0
    return np.where(mask_correct, base * applied_ratio, base)


def standard_blend(base_est, ef_est, lf_val, use_discrepancy_guard=True):
    """Apply standard EF blending + ceiling."""
    ef_weight = np.where(lf_val >= 3000.0, 0.35, 0.0)
    if use_discrepancy_guard:
        discrepancy = np.where(base_est > 0,
                               np.abs(ef_est - base_est) / base_est, 999.0)
        blended = np.where(
            discrepancy > 0.50,
            base_est,
            (1.0 - ef_weight) * base_est + ef_weight * ef_est
        )
    else:
        blended = (1.0 - ef_weight) * base_est + ef_weight * ef_est
    # Ceiling
    blended = np.where(lf_val > 0, np.minimum(blended, lf_val * 1.20), blended)
    return blended


def get_cv_masks(ts_array, years, cv_year, buffer_h=48):
    """
    Return (train_mask, eval_mask) for LOYO-CV.
    Eval = held-out year minus 48h buffer at start and end (timestamp-based).
    Train = everything except the held-out year.
    Uses timestamp-based buffering (not index-based) to match R implementation.
    """
    is_year = years == cv_year
    if not is_year.any():
        return np.zeros(len(years), dtype=bool), np.zeros(len(years), dtype=bool)

    # Year boundaries
    year_start = np.datetime64(f"{cv_year}-01-01T00:00")
    year_end = np.datetime64(f"{cv_year + 1}-01-01T00:00")

    # 48-hour buffer: exclude first/last 48 hours from evaluation
    eval_start = year_start + np.timedelta64(buffer_h, 'h')
    eval_end = year_end - np.timedelta64(buffer_h, 'h')
    eval_mask = (ts_array >= eval_start) & (ts_array < eval_end) & is_year

    train_mask = ~is_year
    return train_mask, eval_mask


def compute_ef_cfs_custom(ef_stg, cold_msk):
    """Compute EF cfs with custom cold mask."""
    return np.where(cold_msk, 160.0 * ef_stg**2.36, 126.0 * ef_stg**2.46)


# ============================================================================
# APPROACH IMPLEMENTATIONS
# ============================================================================

def approach_0_baseline(idx):
    """Baseline v29.0 — no calibration needed."""
    return baseline_estimate(
        por_lagged[idx], por_now[idx], ef_cfs[idx], lf[idx],
        travel_time[idx], mono_flow[idx], goose_flow[idx]
    )


# ── Approach 1: PoR Ratio Scaler ──────────────────────────────────────────

def calibrate_approach_1(train_idx):
    """Calibrate ratio anchors on training data."""
    anchors = np.array([1500, 3500, 7500, 15000, 35000, 75000], dtype=np.float64)
    base_with_tribs = por_lagged[train_idx] + mono_flow[train_idx] + goose_flow[train_idx]
    lf_train = lf[train_idx]
    ratios = np.ones(len(anchors))
    for i, anchor in enumerate(anchors):
        lo = anchor * 0.50
        hi = anchor * 1.50
        mask = (base_with_tribs >= lo) & (base_with_tribs <= hi) & (base_with_tribs > 0)
        if mask.sum() >= 20:
            ratios[i] = np.median(lf_train[mask] / base_with_tribs[mask])
        else:
            ratios[i] = 1.0
    return anchors, ratios


def apply_approach_1(idx, anchors, ratios):
    """Apply ratio scaler approach."""
    base_with_tribs = por_lagged[idx] + mono_flow[idx] + goose_flow[idx]
    correction = np.interp(base_with_tribs, anchors, ratios)
    por_adjusted = base_with_tribs * correction
    # Apply PoR-delta correction on the adjusted base
    por_adjusted = apply_por_delta_correction(
        por_adjusted, por_lagged[idx], por_now[idx], travel_time[idx])
    return standard_blend(por_adjusted, ef_cfs[idx], lf[idx])


# ── Approach 2: Actual Tributary Addback ──────────────────────────────────

UNGAUGED_AREA_RATIO = 1752.0 / (817.0 + 350.0)  # = 1.50

def calibrate_approach_2(train_idx):
    """Grid search for UNGAUGED_SCALE."""
    # Only use obs with actual tributary data
    has_actual = (~np.isnan(mono_actual[train_idx])) & (~np.isnan(goose_actual[train_idx]))
    t_idx = train_idx[has_actual]
    if len(t_idx) < 100:
        return 1.0

    actual_tribs = mono_actual[t_idx] + goose_actual[t_idx]
    pl = por_lagged[t_idx]
    pn = por_now[t_idx]
    tt_t = travel_time[t_idx]
    ef_t = ef_cfs[t_idx]
    lf_t = lf[t_idx]

    best_scale = 1.0
    best_rmse = np.inf
    scales = np.arange(0.0, 2.05, 0.05)

    for scale in scales:
        ungauged = actual_tribs * UNGAUGED_AREA_RATIO * scale
        gf_base = pl + actual_tribs + ungauged
        gf_base = apply_por_delta_correction(gf_base, pl, pn, tt_t)
        est = standard_blend(gf_base, ef_t, lf_t)
        rmse = np.sqrt(np.mean((est - lf_t)**2))
        if rmse < best_rmse:
            best_rmse = rmse
            best_scale = scale

    return best_scale


def apply_approach_2(idx, ungauged_scale, baseline_est):
    """Apply actual tributary addback. Fall back to baseline for missing data."""
    has_actual = (~np.isnan(mono_actual[idx])) & (~np.isnan(goose_actual[idx]))
    result = baseline_est.copy()

    if has_actual.sum() > 0:
        ai = np.where(has_actual)[0]
        actual_tribs = mono_actual[idx[ai]] + goose_actual[idx[ai]]
        ungauged = actual_tribs * UNGAUGED_AREA_RATIO * ungauged_scale
        gf_base = por_lagged[idx[ai]] + actual_tribs + ungauged
        gf_base = apply_por_delta_correction(
            gf_base, por_lagged[idx[ai]], por_now[idx[ai]], travel_time[idx[ai]])
        est = standard_blend(gf_base, ef_cfs[idx[ai]], lf[idx[ai]])
        result[ai] = est

    return result


# ── Approach 3: Regression Ensemble ──────────────────────────────────────

def calibrate_approach_3(train_idx):
    """Fit Ridge regression on log-transformed features."""
    try:
        from sklearn.linear_model import Ridge, RidgeCV
    except ImportError:
        return None, None, None

    pl = por_lagged[train_idx]
    ef_t = ef_cfs[train_idx]
    mono_t = mono_flow[train_idx]
    goose_t = goose_flow[train_idx]
    pn_t = por_now[train_idx]
    lf_t = lf[train_idx]

    # Filter: all features > 0 for log transform
    valid = (pl > 0) & (ef_t > 0) & (mono_t > 0) & (goose_t > 0) & (lf_t > 0) & (pn_t > 0)
    if valid.sum() < 100:
        return None, None, None

    pl_v = pl[valid]
    ef_v = ef_t[valid]
    mono_v = mono_t[valid]
    goose_v = goose_t[valid]
    por_ratio_v = pn_t[valid] / pl_v
    lf_v = lf_t[valid]

    X = np.column_stack([
        np.log(pl_v),
        np.log(ef_v),
        np.log(mono_v),
        np.log(goose_v),
        por_ratio_v,
    ])
    y = np.log(lf_v)

    # Inner 2-fold CV for alpha selection
    alphas = [0.01, 0.1, 1.0, 10.0, 100.0]
    model = RidgeCV(alphas=alphas, cv=2)
    model.fit(X, y)

    # Duan smearing correction
    residuals = y - model.predict(X)
    smearing_factor = np.mean(np.exp(residuals))

    # VIF diagnostic (informational)
    try:
        from numpy.linalg import inv
        corr = np.corrcoef(X.T)
        vif = np.diag(inv(corr))
        feature_names = ["log(por_lagged)", "log(ef_cfs)", "log(monocacy)",
                        "log(goose)", "por_change_ratio"]
        print(f"    Ridge alpha: {model.alpha_}")
        print(f"    Coefficients: {np.round(model.coef_, 4)}")
        print(f"    Intercept: {model.intercept_:.4f}")
        print(f"    Smearing factor: {smearing_factor:.4f}")
        print(f"    VIFs: {dict(zip(feature_names, np.round(vif, 2)))}")
    except Exception:
        pass

    return model, smearing_factor, valid.sum()


def apply_approach_3(idx, model, smearing_factor):
    """Apply Ridge regression estimate."""
    if model is None:
        return baseline_estimate(
            por_lagged[idx], por_now[idx], ef_cfs[idx], lf[idx],
            travel_time[idx], mono_flow[idx], goose_flow[idx])

    pl = por_lagged[idx]
    ef_t = ef_cfs[idx]
    mono_t = mono_flow[idx]
    goose_t = goose_flow[idx]
    pn_t = por_now[idx]

    valid = (pl > 0) & (ef_t > 0) & (mono_t > 0) & (goose_t > 0) & (pn_t > 0)
    result = baseline_estimate(
        por_lagged[idx], por_now[idx], ef_cfs[idx], lf[idx],
        travel_time[idx], mono_flow[idx], goose_flow[idx])

    if valid.sum() > 0:
        vi = np.where(valid)[0]
        X = np.column_stack([
            np.log(pl[vi]),
            np.log(ef_t[vi]),
            np.log(mono_t[vi]),
            np.log(goose_t[vi]),
            pn_t[vi] / pl[vi],
        ])
        log_pred = model.predict(X)
        pred = np.exp(log_pred) * smearing_factor
        # Apply ceiling
        pred = np.minimum(pred, lf[idx[vi]] * 1.20)
        result[vi] = pred

    return result


# ── Approach 4: Combined Ratio + Tributaries ──────────────────────────────

def calibrate_approach_4(train_idx):
    """Jointly optimize UNGAUGED_SCALE and ratio anchors."""
    # Step 1: find best ungauged scale (same as Approach 2)
    ungauged_scale = calibrate_approach_2(train_idx)

    # Step 2: calibrate residual ratio after adding actual tribs
    has_actual = (~np.isnan(mono_actual[train_idx])) & (~np.isnan(goose_actual[train_idx]))
    t_idx = train_idx[has_actual]

    anchors = np.array([1500, 3500, 7500, 15000, 35000, 75000], dtype=np.float64)
    residual_ratios = np.ones(len(anchors))

    if len(t_idx) < 100:
        return ungauged_scale, anchors, residual_ratios

    actual_tribs = mono_actual[t_idx] + goose_actual[t_idx]
    ungauged = actual_tribs * UNGAUGED_AREA_RATIO * ungauged_scale
    gf_base = por_lagged[t_idx] + actual_tribs + ungauged
    lf_t = lf[t_idx]

    for i, anchor in enumerate(anchors):
        lo = anchor * 0.50
        hi = anchor * 1.50
        mask = (gf_base >= lo) & (gf_base <= hi) & (gf_base > 0)
        if mask.sum() >= 20:
            residual_ratios[i] = np.median(lf_t[mask] / gf_base[mask])
        else:
            residual_ratios[i] = 1.0

    return ungauged_scale, anchors, residual_ratios


def apply_approach_4(idx, ungauged_scale, anchors, residual_ratios, baseline_est):
    """Apply combined ratio + tributaries."""
    has_actual = (~np.isnan(mono_actual[idx])) & (~np.isnan(goose_actual[idx]))
    result = baseline_est.copy()

    if has_actual.sum() > 0:
        ai = np.where(has_actual)[0]
        actual_tribs = mono_actual[idx[ai]] + goose_actual[idx[ai]]
        ungauged = actual_tribs * UNGAUGED_AREA_RATIO * ungauged_scale
        gf_base = por_lagged[idx[ai]] + actual_tribs + ungauged
        # Residual ratio correction
        correction = np.interp(gf_base, anchors, residual_ratios)
        gf_adjusted = gf_base * correction
        # PoR-delta
        gf_adjusted = apply_por_delta_correction(
            gf_adjusted, por_lagged[idx[ai]], por_now[idx[ai]], travel_time[idx[ai]])
        est = standard_blend(gf_adjusted, ef_cfs[idx[ai]], lf[idx[ai]])
        result[ai] = est

    return result


# ── Approach 5: EF-Dominant (Logistic Weight) ─────────────────────────────

def calibrate_approach_5(train_idx):
    """Grid search for logistic weight parameters."""
    w_max_vals = np.arange(0.30, 0.85, 0.05)
    k_vals = np.arange(0.5, 5.5, 0.5)
    midpoint_vals = np.array([2000, 3000, 4000, 5000, 6000, 8000, 10000],
                             dtype=np.float64)

    pl = por_lagged[train_idx]
    pn = por_now[train_idx]
    ef_t = ef_cfs[train_idx]
    lf_t = lf[train_idx]
    tt_t = travel_time[train_idx]
    mono_t = mono_flow[train_idx]
    goose_t = goose_flow[train_idx]

    # Pre-compute base with PoR-delta correction
    base = pl + mono_t + goose_t
    base = apply_por_delta_correction(base, pl, pn, tt_t)

    best_params = (0.35, 2.0, 5000.0)
    best_rmse = np.inf

    log_lf = np.log(np.maximum(lf_t, 1.0))

    for w_max in w_max_vals:
        for k in k_vals:
            for midpoint in midpoint_vals:
                log_mid = np.log(midpoint)
                ef_weight = w_max / (1.0 + np.exp(-k * (log_lf - log_mid)))
                ef_weight = np.clip(ef_weight, 0.0, w_max)
                # No discrepancy guard for Approach 5
                blended = (1.0 - ef_weight) * base + ef_weight * ef_t
                blended = np.where(lf_t > 0,
                                   np.minimum(blended, lf_t * 1.20), blended)
                rmse = np.sqrt(np.mean((blended - lf_t)**2))
                if rmse < best_rmse:
                    best_rmse = rmse
                    best_params = (w_max, k, midpoint)

    return best_params, best_rmse


def apply_approach_5(idx, params):
    """Apply EF-dominant with logistic weights."""
    w_max, k, midpoint = params
    pl = por_lagged[idx]
    pn = por_now[idx]
    ef_t = ef_cfs[idx]
    lf_t = lf[idx]
    tt_t = travel_time[idx]
    mono_t = mono_flow[idx]
    goose_t = goose_flow[idx]

    base = pl + mono_t + goose_t
    base = apply_por_delta_correction(base, pl, pn, tt_t)

    log_lf = np.log(np.maximum(lf_t, 1.0))
    log_mid = np.log(midpoint)
    ef_weight = w_max / (1.0 + np.exp(-k * (log_lf - log_mid)))
    ef_weight = np.clip(ef_weight, 0.0, w_max)

    # No discrepancy guard
    blended = (1.0 - ef_weight) * base + ef_weight * ef_t
    blended = np.where(lf_t > 0, np.minimum(blended, lf_t * 1.20), blended)
    return blended


# ── Approach 6: EF Power-Law Refit ────────────────────────────────────────

def calibrate_approach_6(train_idx):
    """Refit EF power-law to predict LF directly."""
    ef_t = ef_stage_v[train_idx]
    lf_t = lf[train_idx]
    temp_t = water_temp_v[train_idx]
    year_t = year_v[train_idx]
    month_t = month_v[train_idx]

    # Cold mask (same logic as main)
    cold = np.zeros(len(train_idx), dtype=bool)
    has_temp = ~np.isnan(temp_t)
    cold[has_temp] = temp_t[has_temp] <= 10.0
    no_temp_pre2021 = (~has_temp) & (year_t < 2021)
    cold_months = np.isin(month_t, [12, 1, 2, 3])
    cold[no_temp_pre2021] = cold_months[no_temp_pre2021]

    results = {}
    for label, mask in [("warm", ~cold), ("cold", cold)]:
        valid = mask & (ef_t > 0) & (lf_t > 0)
        if valid.sum() < 50:
            results[label] = (126.0, 2.46) if label == "warm" else (160.0, 2.36)
            continue
        log_ef = np.log(ef_t[valid])
        log_lf = np.log(lf_t[valid])
        # log(lf) = log(a) + b * log(ef)
        b, log_a = np.polyfit(log_ef, log_lf, 1)
        a = np.exp(log_a)
        results[label] = (a, b)

    return results


def apply_approach_6(idx, params):
    """Apply refit EF power-law, blend with por_lagged + tribs as baseline."""
    warm_a, warm_b = params["warm"]
    cold_a, cold_b = params["cold"]

    ef_t = ef_stage_v[idx]
    temp_t = water_temp_v[idx]
    year_t = year_v[idx]
    month_t = month_v[idx]

    # Cold mask
    cold = np.zeros(len(idx), dtype=bool)
    has_temp = ~np.isnan(temp_t)
    cold[has_temp] = temp_t[has_temp] <= 10.0
    no_temp_pre2021 = (~has_temp) & (year_t < 2021)
    cold_months = np.isin(month_t, [12, 1, 2, 3])
    cold[no_temp_pre2021] = cold_months[no_temp_pre2021]

    # Refit EF estimate
    ef_cfs_new = np.where(cold,
                          cold_a * ef_t**cold_b,
                          warm_a * ef_t**warm_b)

    # Base = por_lagged + tributaries (SAME as baseline)
    base = por_lagged[idx] + mono_flow[idx] + goose_flow[idx]
    base = apply_por_delta_correction(
        base, por_lagged[idx], por_now[idx], travel_time[idx])

    # Standard blend with SAME weights but new EF estimate
    return standard_blend(base, ef_cfs_new, lf[idx])


# ============================================================================
# CROSS-VALIDATION ENGINE
# ============================================================================
print("\n" + "=" * 80)
print("CROSS-VALIDATION (Leave-One-Year-Out, 14 folds)")
print("=" * 80)

all_results = []
all_indices = np.arange(len(dv))

# Storage for fold-level estimates (for aggregated OOS metrics)
oos_estimates = {name: np.full(len(dv), np.nan) for name in APPROACH_NAMES}
oos_mask_all = np.zeros(len(dv), dtype=bool)

# ── In-sample: compute baseline on all data ───────────────────────────────
print("\n--- Computing in-sample baseline on all data ---")
baseline_all = approach_0_baseline(all_indices)
baseline_mse_all = np.mean((baseline_all - lf)**2)
print(f"  Baseline in-sample RMSE: {np.sqrt(baseline_mse_all):.2f}")

# Store in-sample estimates
insample_estimates = {name: np.full(len(dv), np.nan) for name in APPROACH_NAMES}
insample_estimates["0_baseline"] = baseline_all

# ── Calibrate each approach on ALL data for in-sample metrics ─────────────
print("\n--- Calibrating approaches on all data (in-sample) ---")

print("  Approach 1: PoR Ratio Scaler")
a1_anchors_all, a1_ratios_all = calibrate_approach_1(all_indices)
insample_estimates["1_ratio_scaler"] = apply_approach_1(
    all_indices, a1_anchors_all, a1_ratios_all)
print(f"    Ratios at anchors: {dict(zip(a1_anchors_all.astype(int), np.round(a1_ratios_all, 4)))}")

print("  Approach 2: Actual Tributary Addback")
a2_scale_all = calibrate_approach_2(all_indices)
insample_estimates["2_trib_addback"] = apply_approach_2(
    all_indices, a2_scale_all, baseline_all)
print(f"    UNGAUGED_SCALE: {a2_scale_all:.2f}")

print("  Approach 3: Regression Ensemble")
a3_model_all, a3_smear_all, a3_n = calibrate_approach_3(all_indices)
insample_estimates["3_regression"] = apply_approach_3(
    all_indices, a3_model_all, a3_smear_all)

print("  Approach 4: Combined Ratio + Tributaries")
a4_scale_all, a4_anchors_all, a4_ratios_all = calibrate_approach_4(all_indices)
insample_estimates["4_combined"] = apply_approach_4(
    all_indices, a4_scale_all, a4_anchors_all, a4_ratios_all, baseline_all)
print(f"    UNGAUGED_SCALE: {a4_scale_all:.2f}")
print(f"    Residual ratios: {dict(zip(a4_anchors_all.astype(int), np.round(a4_ratios_all, 4)))}")

print("  Approach 5: EF-Dominant (Logistic Weight)")
a5_params_all, a5_rmse = calibrate_approach_5(all_indices)
insample_estimates["5_ef_dominant"] = apply_approach_5(all_indices, a5_params_all)
print(f"    w_max={a5_params_all[0]:.2f}, k={a5_params_all[1]:.1f}, "
      f"midpoint={a5_params_all[2]:.0f}, train_RMSE={a5_rmse:.2f}")

print("  Approach 6: EF Power-Law Refit")
a6_params_all = calibrate_approach_6(all_indices)
insample_estimates["6_ef_refit"] = apply_approach_6(all_indices, a6_params_all)
print(f"    Warm: a={a6_params_all['warm'][0]:.2f}, b={a6_params_all['warm'][1]:.4f}")
print(f"    Cold: a={a6_params_all['cold'][0]:.2f}, b={a6_params_all['cold'][1]:.4f}")

# ── LOYO Cross-Validation ─────────────────────────────────────────────────
print("\n--- Running LOYO cross-validation ---")

fold_calibrations = {}

for fold_i, cv_year in enumerate(CV_YEARS):
    t_fold = time.time()
    train_mask, test_mask = get_cv_masks(timestamps, year_v, cv_year, BUFFER_HOURS)

    n_train = train_mask.sum()
    n_test = test_mask.sum()
    if n_test < 10:
        print(f"  Fold {fold_i+1:2d}/{len(CV_YEARS)} (year={cv_year}): "
              f"SKIP ({n_test} test obs)")
        continue

    train_idx = np.where(train_mask)[0]
    test_idx = np.where(test_mask)[0]

    # Mark OOS observations
    oos_mask_all[test_idx] = True

    # ── Approach 0: Baseline (no calibration) ─────────────────────────────
    base_test = approach_0_baseline(test_idx)
    oos_estimates["0_baseline"][test_idx] = base_test
    baseline_mse_fold = np.mean((base_test - lf[test_idx])**2)

    # ── Approach 1 ─────────────────────────────────────────────────────────
    anch1, rat1 = calibrate_approach_1(train_idx)
    oos_estimates["1_ratio_scaler"][test_idx] = apply_approach_1(
        test_idx, anch1, rat1)

    # ── Approach 2 ─────────────────────────────────────────────────────────
    scale2 = calibrate_approach_2(train_idx)
    oos_estimates["2_trib_addback"][test_idx] = apply_approach_2(
        test_idx, scale2, base_test)

    # ── Approach 3 ─────────────────────────────────────────────────────────
    model3, smear3, _ = calibrate_approach_3(train_idx)
    oos_estimates["3_regression"][test_idx] = apply_approach_3(
        test_idx, model3, smear3)

    # ── Approach 4 ─────────────────────────────────────────────────────────
    sc4, an4, rr4 = calibrate_approach_4(train_idx)
    oos_estimates["4_combined"][test_idx] = apply_approach_4(
        test_idx, sc4, an4, rr4, base_test)

    # ── Approach 5 ─────────────────────────────────────────────────────────
    params5, _ = calibrate_approach_5(train_idx)
    oos_estimates["5_ef_dominant"][test_idx] = apply_approach_5(
        test_idx, params5)

    # ── Approach 6 ─────────────────────────────────────────────────────────
    params6 = calibrate_approach_6(train_idx)
    oos_estimates["6_ef_refit"][test_idx] = apply_approach_6(
        test_idx, params6)

    # Store calibrated params for reporting
    fold_calibrations[cv_year] = {
        "a1_ratios": rat1,
        "a2_scale": scale2,
        "a3_alpha": model3.alpha_ if model3 is not None else None,
        "a4_scale": sc4,
        "a5_params": params5,
        "a6_warm": a6_params_all["warm"],
        "a6_cold": a6_params_all["cold"],
    }

    elapsed = time.time() - t_fold
    base_rmse_fold = np.sqrt(baseline_mse_fold)
    print(f"  Fold {fold_i+1:2d}/{len(CV_YEARS)} (year={cv_year}): "
          f"train={n_train:,}, test={n_test:,}, "
          f"base_RMSE={base_rmse_fold:.1f}, "
          f"time={elapsed:.1f}s")

print(f"\nTotal OOS observations: {oos_mask_all.sum():,}")


# ============================================================================
# METRIC COLLECTION
# ============================================================================
print("\n" + "=" * 80)
print("COMPUTING METRICS")
print("=" * 80)

results_rows = []


def collect_metrics_for_scope(estimates_dict, lf_arr, flow_bins_arr,
                              flow_states_arr, eval_type, subset_mask=None):
    """Collect metrics for all approaches, scopes, and subsets."""
    rows = []
    if subset_mask is None:
        subset_mask = np.ones(len(lf_arr), dtype=bool)

    for approach_name in APPROACH_NAMES:
        est = estimates_dict[approach_name]
        # Skip if all NaN
        valid_est = ~np.isnan(est) & subset_mask
        if valid_est.sum() == 0:
            continue

        # Baseline MSE for skill score (using same subset)
        base_est = estimates_dict["0_baseline"]
        base_mse = np.mean((base_est[valid_est] - lf_arr[valid_est])**2)

        # Overall
        idx_overall = valid_est
        m = compute_metrics(est[idx_overall], lf_arr[idx_overall], base_mse)
        m.update({"approach": approach_name, "eval_type": eval_type,
                  "scope": "overall", "flow_bin": "all", "flow_state": "all"})
        rows.append(m)

        # Per flow bin
        for bname in FLOW_BIN_LABELS:
            idx_bin = valid_est & (flow_bins_arr == bname)
            if idx_bin.sum() > 0:
                base_mse_bin = np.mean(
                    (base_est[idx_bin] - lf_arr[idx_bin])**2)
                m = compute_metrics(est[idx_bin], lf_arr[idx_bin], base_mse_bin)
                m.update({"approach": approach_name, "eval_type": eval_type,
                          "scope": "per_bin", "flow_bin": bname,
                          "flow_state": "all"})
                rows.append(m)

        # Per flow state (rising and steady only per spec)
        for state in ["rising", "steady"]:
            idx_state = valid_est & (flow_states_arr == state)
            if idx_state.sum() > 0:
                base_mse_st = np.mean(
                    (base_est[idx_state] - lf_arr[idx_state])**2)
                m = compute_metrics(est[idx_state], lf_arr[idx_state],
                                    base_mse_st)
                m.update({"approach": approach_name, "eval_type": eval_type,
                          "scope": "per_state", "flow_bin": "all",
                          "flow_state": state})
                rows.append(m)

    return rows


# In-sample metrics
print("  Computing in-sample metrics...")
results_rows.extend(collect_metrics_for_scope(
    insample_estimates, lf, flow_bin_v, flow_state_v, "insample"))

# OOS metrics
print("  Computing OOS metrics...")
results_rows.extend(collect_metrics_for_scope(
    oos_estimates, lf, flow_bin_v, flow_state_v, "oos", oos_mask_all))


# ============================================================================
# SAVE OUTPUT CSV
# ============================================================================
results_df = pd.DataFrame(results_rows)
cols = ["approach", "eval_type", "scope", "flow_bin", "flow_state",
        "n", "rmse", "mae", "bias", "pct_bias", "mdape",
        "skill_score", "undershoot_pct"]
results_df = results_df[cols]
results_df.to_csv(OUTPUT_PATH, index=False)
print(f"\nSaved {len(results_df)} rows to {OUTPUT_PATH}")


# ============================================================================
# CONSOLE OUTPUT
# ============================================================================
print("\n" + "=" * 80)
print("OVERALL COMPARISON — OUT-OF-SAMPLE (Primary)")
print("=" * 80)

oos_overall = results_df[
    (results_df["eval_type"] == "oos") & (results_df["scope"] == "overall")
].copy()
oos_overall = oos_overall.sort_values("skill_score", ascending=False)

print(f"\n{'Approach':<20s} {'N':>8s} {'RMSE':>10s} {'MAE':>10s} {'Bias':>10s} "
      f"{'Pct_Bias':>10s} {'MdAPE':>8s} {'Skill':>10s} {'Under%':>8s}")
print("-" * 100)
for _, row in oos_overall.iterrows():
    skill_str = f"{row['skill_score']:>10.4f}" if row['approach'] != "0_baseline" else f"{'(ref)':>10s}"
    print(f"{row['approach']:<20s} {row['n']:>8,} {row['rmse']:>10.2f} "
          f"{row['mae']:>10.2f} {row['bias']:>+10.2f} {row['pct_bias']:>+10.4f} "
          f"{row['mdape']:>8.2f} {skill_str} {row['undershoot_pct']:>8.2f}")


# ── Per-flow-bin comparison for top 3 approaches ─────────────────────────
print("\n" + "=" * 80)
print("PER-FLOW-BIN COMPARISON — TOP 3 APPROACHES (OOS RMSE)")
print("=" * 80)

top3 = oos_overall.head(3)["approach"].tolist()
if "0_baseline" not in top3:
    top3 = ["0_baseline"] + top3[:2]

oos_bin = results_df[
    (results_df["eval_type"] == "oos") & (results_df["scope"] == "per_bin")
].copy()

print(f"\n{'Approach':<20s}", end="")
for b in FLOW_BIN_LABELS:
    print(f" {b:>10s}", end="")
print(f" {'OVERALL':>10s}")
print("-" * (20 + 11 * (len(FLOW_BIN_LABELS) + 1)))

for approach_name in top3:
    print(f"{approach_name:<20s}", end="")
    for b in FLOW_BIN_LABELS:
        r = oos_bin[(oos_bin["approach"] == approach_name) &
                    (oos_bin["flow_bin"] == b)]
        if len(r) > 0:
            print(f" {r.iloc[0]['rmse']:>10.1f}", end="")
        else:
            print(f" {'N/A':>10s}", end="")
    # Overall
    r = oos_overall[oos_overall["approach"] == approach_name]
    if len(r) > 0:
        print(f" {r.iloc[0]['rmse']:>10.1f}", end="")
    print()


# ── Per-flow-bin Skill Score ──────────────────────────────────────────────
print(f"\n{'Approach':<20s}", end="")
for b in FLOW_BIN_LABELS:
    print(f" {b:>10s}", end="")
print(f" {'OVERALL':>10s}  (Skill Score)")
print("-" * (20 + 11 * (len(FLOW_BIN_LABELS) + 1) + 16))

for approach_name in APPROACH_NAMES:
    if approach_name == "0_baseline":
        continue
    print(f"{approach_name:<20s}", end="")
    for b in FLOW_BIN_LABELS:
        r = oos_bin[(oos_bin["approach"] == approach_name) &
                    (oos_bin["flow_bin"] == b)]
        if len(r) > 0:
            ss = r.iloc[0]["skill_score"]
            print(f" {ss:>+10.4f}", end="")
        else:
            print(f" {'N/A':>10s}", end="")
    r = oos_overall[oos_overall["approach"] == approach_name]
    if len(r) > 0:
        print(f" {r.iloc[0]['skill_score']:>+10.4f}", end="")
    print()


# ── Rising-state comparison ──────────────────────────────────────────────
print("\n" + "=" * 80)
print("RISING-STATE COMPARISON (OOS)")
print("=" * 80)

oos_rising = results_df[
    (results_df["eval_type"] == "oos") &
    (results_df["scope"] == "per_state") &
    (results_df["flow_state"] == "rising")
].copy()
oos_rising = oos_rising.sort_values("skill_score", ascending=False)

print(f"\n{'Approach':<20s} {'N':>8s} {'RMSE':>10s} {'MAE':>10s} {'Bias':>10s} "
      f"{'Skill':>10s} {'Under%':>8s}")
print("-" * 70)
for _, row in oos_rising.iterrows():
    skill_str = f"{row['skill_score']:>10.4f}" if row['approach'] != "0_baseline" else f"{'(ref)':>10s}"
    print(f"{row['approach']:<20s} {row['n']:>8,} {row['rmse']:>10.2f} "
          f"{row['mae']:>10.2f} {row['bias']:>+10.2f} {skill_str} "
          f"{row['undershoot_pct']:>8.2f}")


# ── Steady-state comparison ──────────────────────────────────────────────
print("\n" + "=" * 80)
print("STEADY-STATE COMPARISON (OOS)")
print("=" * 80)

oos_steady = results_df[
    (results_df["eval_type"] == "oos") &
    (results_df["scope"] == "per_state") &
    (results_df["flow_state"] == "steady")
].copy()
oos_steady = oos_steady.sort_values("skill_score", ascending=False)

print(f"\n{'Approach':<20s} {'N':>8s} {'RMSE':>10s} {'MAE':>10s} {'Bias':>10s} "
      f"{'Skill':>10s} {'Under%':>8s}")
print("-" * 70)
for _, row in oos_steady.iterrows():
    skill_str = f"{row['skill_score']:>10.4f}" if row['approach'] != "0_baseline" else f"{'(ref)':>10s}"
    print(f"{row['approach']:<20s} {row['n']:>8,} {row['rmse']:>10.2f} "
          f"{row['mae']:>10.2f} {row['bias']:>+10.2f} {skill_str} "
          f"{row['undershoot_pct']:>8.2f}")


# ── In-sample vs OOS comparison ──────────────────────────────────────────
print("\n" + "=" * 80)
print("IN-SAMPLE vs OUT-OF-SAMPLE COMPARISON (Overfitting Check)")
print("=" * 80)

is_overall = results_df[
    (results_df["eval_type"] == "insample") & (results_df["scope"] == "overall")
].set_index("approach")

oos_overall_idx = results_df[
    (results_df["eval_type"] == "oos") & (results_df["scope"] == "overall")
].set_index("approach")

print(f"\n{'Approach':<20s} {'IS_RMSE':>10s} {'OOS_RMSE':>10s} {'Overfit%':>10s}")
print("-" * 55)
for name in APPROACH_NAMES:
    if name in is_overall.index and name in oos_overall_idx.index:
        is_rmse = is_overall.loc[name, "rmse"]
        oos_rmse = oos_overall_idx.loc[name, "rmse"]
        overfit = (oos_rmse - is_rmse) / is_rmse * 100
        print(f"{name:<20s} {is_rmse:>10.2f} {oos_rmse:>10.2f} {overfit:>+10.2f}%")


# ── Calibrated parameters (all-data fit) ─────────────────────────────────
print("\n" + "=" * 80)
print("CALIBRATED PARAMETERS (All-Data Fit)")
print("=" * 80)

print("\n  Approach 1 (PoR Ratio Scaler):")
for a, r in zip(a1_anchors_all.astype(int), a1_ratios_all):
    print(f"    Anchor {a:>6,} cfs: ratio = {r:.4f}")

print(f"\n  Approach 2 (Trib Addback): UNGAUGED_SCALE = {a2_scale_all:.2f}")

if a3_model_all is not None:
    print(f"\n  Approach 3 (Ridge Regression):")
    print(f"    Alpha: {a3_model_all.alpha_}")
    names = ["log(por_lagged)", "log(ef_cfs)", "log(monocacy)",
             "log(goose)", "por_change_ratio"]
    for n, c in zip(names, a3_model_all.coef_):
        print(f"    {n:<20s}: {c:+.4f}")
    print(f"    {'Intercept':<20s}: {a3_model_all.intercept_:.4f}")
    print(f"    Smearing factor:    {a3_smear_all:.4f}")

print(f"\n  Approach 4 (Combined):")
print(f"    UNGAUGED_SCALE = {a4_scale_all:.2f}")
for a, r in zip(a4_anchors_all.astype(int), a4_ratios_all):
    print(f"    Anchor {a:>6,} cfs: residual ratio = {r:.4f}")

print(f"\n  Approach 5 (EF-Dominant Logistic):")
print(f"    w_max = {a5_params_all[0]:.2f}")
print(f"    k = {a5_params_all[1]:.1f}")
print(f"    midpoint = {a5_params_all[2]:.0f} cfs")

print(f"\n  Approach 6 (EF Refit):")
print(f"    Warm: LF = {a6_params_all['warm'][0]:.2f} * EF^{a6_params_all['warm'][1]:.4f}")
print(f"    Cold: LF = {a6_params_all['cold'][0]:.2f} * EF^{a6_params_all['cold'][1]:.4f}")
print(f"    (v29.0: Warm = 126 * EF^2.46, Cold = 160 * EF^2.36)")


# ── Winner determination ──────────────────────────────────────────────────
print("\n" + "=" * 80)
print("WINNER DETERMINATION")
print("=" * 80)

# Best OOS overall RMSE
best_oos = oos_overall.iloc[0]
print(f"\n  Best OOS overall RMSE: {best_oos['approach']}")
print(f"    RMSE = {best_oos['rmse']:.2f}, MAE = {best_oos['mae']:.2f}, "
      f"Bias = {best_oos['bias']:+.2f}")
print(f"    Skill Score = {best_oos['skill_score']:.4f}, "
      f"Undershoot = {best_oos['undershoot_pct']:.2f}%")

# Best OOS rising RMSE
if len(oos_rising) > 0:
    best_rising = oos_rising.iloc[0]
    print(f"\n  Best OOS rising RMSE: {best_rising['approach']}")
    print(f"    RMSE = {best_rising['rmse']:.2f}, Bias = {best_rising['bias']:+.2f}")

# Improvement over baseline
base_row = oos_overall[oos_overall["approach"] == "0_baseline"]
if len(base_row) > 0:
    base_rmse = base_row.iloc[0]["rmse"]
    print(f"\n  Baseline OOS RMSE: {base_rmse:.2f}")
    for _, row in oos_overall.iterrows():
        if row["approach"] == "0_baseline":
            continue
        delta = row["rmse"] - base_rmse
        pct = delta / base_rmse * 100
        label = "BETTER" if delta < 0 else "WORSE"
        print(f"    {row['approach']:<20s}: {row['rmse']:.2f} "
              f"({delta:+.2f} cfs, {pct:+.2f}% — {label})")


# ── Runtime ──────────────────────────────────────────────────────────────
elapsed_total = time.time() - t0
print(f"\n{'='*80}")
print(f"Total runtime: {elapsed_total:.1f}s ({elapsed_total/60:.1f} min)")
print(f"Output: {OUTPUT_PATH}")
print(f"{'='*80}")
print("HORSE RACE v2 COMPLETE")
print(f"{'='*80}")

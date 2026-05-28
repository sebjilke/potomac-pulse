#!/usr/bin/env python3
"""
EF High-Flow Weight Analysis
=============================
Empirically tests whether Edwards Ferry (EF) should get >50% weight at high flows
(>15k cfs) in the Potomac Pulse flow estimation ensemble.

Four approaches:
  A) EF-only accuracy metrics at high flows
  B) Leave-one-out cross-validation of the power-law model
  C) Residual analysis (autocorrelation, bias patterns, rate-of-change sensitivity)
  D) Information content — partial R² vs naive "yesterday's LF" model
"""

import numpy as np
import pandas as pd
from scipy import stats, optimize
import warnings
warnings.filterwarnings('ignore')

# ─────────────────────────────────────────────────────────────────────────────
# 1. Load and prepare data
# ─────────────────────────────────────────────────────────────────────────────
DATA_PATH = '/Users/sebjilke/Desktop/PotomacPulse/analysis/ef_lf_daily_longterm.csv'
OUTPUT_PATH = '/Users/sebjilke/Desktop/PotomacPulse/analysis/ef_high_flow_test_python.csv'

df = pd.read_csv(DATA_PATH, parse_dates=['date'])

# Deduplicate by date: mean ef_stage, first lf_discharge
df = df.groupby('date').agg({'ef_stage': 'mean', 'lf_discharge': 'first'}).reset_index()
df = df.sort_values('date').reset_index(drop=True)
df = df.dropna(subset=['ef_stage', 'lf_discharge'])

print(f"Total observations after dedup: {len(df)}")
print(f"Date range: {df['date'].min().date()} to {df['date'].max().date()}")

# Filter to high flows
HIGH_FLOW_THRESHOLD = 15000
hf = df[df['lf_discharge'] >= HIGH_FLOW_THRESHOLD].copy()
print(f"High-flow days (>= {HIGH_FLOW_THRESHOLD} cfs): {len(hf)}")
print(f"  EF stage range: {hf['ef_stage'].min():.2f} - {hf['ef_stage'].max():.2f}")
print(f"  LF discharge range: {hf['lf_discharge'].min():.0f} - {hf['lf_discharge'].max():.0f}")
print()

# Compute EF prediction using the current power-law model
# Current model: 126 * ef_stage^2.46
A_DEFAULT, B_DEFAULT = 126.0, 2.46
hf['ef_predicted'] = A_DEFAULT * hf['ef_stage'] ** B_DEFAULT
hf['residual'] = hf['ef_predicted'] - hf['lf_discharge']

# Also compute rate of change for approach C
hf['lf_change'] = hf['lf_discharge'].diff()
hf['lf_pct_change'] = hf['lf_discharge'].pct_change() * 100

# ─────────────────────────────────────────────────────────────────────────────
# APPROACH A: EF-Only Accuracy at High Flows
# ─────────────────────────────────────────────────────────────────────────────
print("=" * 70)
print("APPROACH A: EF-Only Accuracy at High Flows")
print("=" * 70)

actual = hf['lf_discharge'].values
predicted = hf['ef_predicted'].values
residuals = hf['residual'].values

rmse = np.sqrt(np.mean(residuals**2))
mae = np.mean(np.abs(residuals))
mape = np.mean(np.abs(residuals) / actual) * 100
bias = np.mean(residuals)
bias_pct = (bias / np.mean(actual)) * 100

ss_res = np.sum(residuals**2)
ss_tot = np.sum((actual - np.mean(actual))**2)
r_squared = 1 - ss_res / ss_tot

corr_r, corr_p = stats.pearsonr(actual, predicted)

print(f"  N observations:      {len(hf)}")
print(f"  Mean actual flow:    {np.mean(actual):,.0f} cfs")
print(f"  Mean predicted flow: {np.mean(predicted):,.0f} cfs")
print(f"  RMSE:                {rmse:,.0f} cfs")
print(f"  MAE:                 {mae:,.0f} cfs")
print(f"  MAPE:                {mape:.1f}%")
print(f"  Bias (mean error):   {bias:+,.0f} cfs ({bias_pct:+.1f}%)")
print(f"  R-squared:           {r_squared:.4f}")
print(f"  Pearson r:           {corr_r:.4f} (p={corr_p:.2e})")

# Breakdown by flow magnitude
print("\n  Accuracy by flow bracket:")
brackets = [(15000, 25000), (25000, 50000), (50000, 100000), (100000, np.inf)]
for lo, hi in brackets:
    mask = (hf['lf_discharge'] >= lo) & (hf['lf_discharge'] < hi)
    sub = hf[mask]
    if len(sub) < 3:
        print(f"    {lo/1000:.0f}k-{hi/1000:.0f}k cfs: n={len(sub)} (too few)")
        continue
    sub_rmse = np.sqrt(np.mean(sub['residual']**2))
    sub_mape = np.mean(np.abs(sub['residual']) / sub['lf_discharge']) * 100
    sub_bias = np.mean(sub['residual'])
    label = f"{lo/1000:.0f}k-{hi/1000:.0f}k" if hi < np.inf else f">{lo/1000:.0f}k"
    print(f"    {label:>12s} cfs: n={len(sub):3d}, RMSE={sub_rmse:>8,.0f}, "
          f"MAPE={sub_mape:>5.1f}%, Bias={sub_bias:>+9,.0f}")

print()

# ─────────────────────────────────────────────────────────────────────────────
# APPROACH B: Leave-One-Out Cross-Validation
# ─────────────────────────────────────────────────────────────────────────────
print("=" * 70)
print("APPROACH B: Leave-One-Out Cross-Validation of Power-Law")
print("=" * 70)

def fit_power_law(ef_stages, lf_discharges):
    """Fit lf = a * ef^b using log-linear regression."""
    log_ef = np.log(ef_stages)
    log_lf = np.log(lf_discharges)
    slope, intercept, _, _, _ = stats.linregress(log_ef, log_lf)
    a = np.exp(intercept)
    b = slope
    return a, b

loo_predictions = np.zeros(len(hf))
loo_a_values = []
loo_b_values = []

ef_vals = hf['ef_stage'].values
lf_vals = hf['lf_discharge'].values

for i in range(len(hf)):
    # Hold out observation i
    mask = np.ones(len(hf), dtype=bool)
    mask[i] = False
    train_ef = ef_vals[mask]
    train_lf = lf_vals[mask]

    a_loo, b_loo = fit_power_law(train_ef, train_lf)
    loo_a_values.append(a_loo)
    loo_b_values.append(b_loo)
    loo_predictions[i] = a_loo * ef_vals[i] ** b_loo

loo_residuals = loo_predictions - lf_vals
loo_rmse = np.sqrt(np.mean(loo_residuals**2))
loo_mape = np.mean(np.abs(loo_residuals) / lf_vals) * 100
loo_r2 = 1 - np.sum(loo_residuals**2) / np.sum((lf_vals - np.mean(lf_vals))**2)

# Compare to in-sample fit on high-flow data only
a_full, b_full = fit_power_law(ef_vals, lf_vals)
full_pred = a_full * ef_vals ** b_full
full_residuals = full_pred - lf_vals
full_rmse = np.sqrt(np.mean(full_residuals**2))
full_r2 = 1 - np.sum(full_residuals**2) / np.sum((lf_vals - np.mean(lf_vals))**2)

print(f"  High-flow-only power-law fit: a={a_full:.1f}, b={b_full:.3f}")
print(f"  (vs default model:            a={A_DEFAULT}, b={B_DEFAULT})")
print()
print(f"  In-sample RMSE:  {full_rmse:>10,.0f} cfs   R²={full_r2:.4f}")
print(f"  LOO-CV RMSE:     {loo_rmse:>10,.0f} cfs   R²={loo_r2:.4f}")
print(f"  Default model:   {rmse:>10,.0f} cfs   R²={r_squared:.4f}")
print()
print(f"  LOO coefficient stability:")
print(f"    a: mean={np.mean(loo_a_values):.1f}, std={np.std(loo_a_values):.1f}, "
      f"CV={np.std(loo_a_values)/np.mean(loo_a_values)*100:.1f}%")
print(f"    b: mean={np.mean(loo_b_values):.3f}, std={np.std(loo_b_values):.3f}, "
      f"CV={np.std(loo_b_values)/np.mean(loo_b_values)*100:.1f}%")

# Overfitting check
overfit_ratio = loo_rmse / full_rmse
print(f"\n  Overfitting ratio (LOO/in-sample RMSE): {overfit_ratio:.3f}")
if overfit_ratio < 1.05:
    print("  => Minimal overfitting — model generalizes well")
elif overfit_ratio < 1.15:
    print("  => Moderate overfitting — model generalizes reasonably")
else:
    print("  => Significant overfitting — model may not generalize well")

print()

# ─────────────────────────────────────────────────────────────────────────────
# APPROACH C: Residual Analysis
# ─────────────────────────────────────────────────────────────────────────────
print("=" * 70)
print("APPROACH C: Residual Analysis")
print("=" * 70)

# C1: Autocorrelation of residuals
print("\n  C1. Autocorrelation of residuals:")
# We need consecutive days for meaningful autocorrelation
hf_sorted = hf.sort_values('date').copy()
hf_sorted['date_diff'] = hf_sorted['date'].diff().dt.days

# Find runs of consecutive days
consecutive_mask = hf_sorted['date_diff'] == 1
n_consecutive = consecutive_mask.sum()
print(f"      Consecutive day-pairs in high-flow set: {n_consecutive}")

# Compute lag-1 autocorrelation using only consecutive pairs
if n_consecutive >= 10:
    resid_series = hf_sorted['residual'].values
    date_diffs = hf_sorted['date_diff'].values

    lag1_pairs_x = []
    lag1_pairs_y = []
    for i in range(1, len(hf_sorted)):
        if date_diffs[i] == 1:
            lag1_pairs_x.append(resid_series[i-1])
            lag1_pairs_y.append(resid_series[i])

    if len(lag1_pairs_x) >= 10:
        lag1_r, lag1_p = stats.pearsonr(lag1_pairs_x, lag1_pairs_y)
        print(f"      Lag-1 autocorrelation: r={lag1_r:.3f} (p={lag1_p:.3e})")
        if abs(lag1_r) > 0.5:
            print("      => STRONG autocorrelation — consecutive errors are correlated")
            print("         This means PoR tracking WOULD add value by following these patterns")
        elif abs(lag1_r) > 0.3:
            print("      => MODERATE autocorrelation — some temporal error structure")
        else:
            print("      => WEAK autocorrelation — errors are mostly random (good for EF)")
    else:
        print("      Not enough consecutive pairs for lag-1 analysis")
        lag1_r = np.nan
else:
    print("      Not enough consecutive days for autocorrelation analysis")
    lag1_r = np.nan

# C2: Residual vs. actual flow (systematic bias?)
print("\n  C2. Residual vs. actual flow level:")
slope_resid, intercept_resid, r_resid, p_resid, _ = stats.linregress(
    hf['lf_discharge'].values, hf['residual'].values)
print(f"      Regression: residual = {slope_resid:.4f} * actual + {intercept_resid:+,.0f}")
print(f"      R={r_resid:.3f}, p={p_resid:.3e}")
if abs(r_resid) > 0.3:
    print("      => Bias changes systematically with flow level")
    if slope_resid > 0:
        print("         EF over-predicts more as flow increases → PoR helps at extreme highs")
    else:
        print("         EF under-predicts more as flow increases → PoR helps at extreme highs")
else:
    print("      => No strong systematic bias with flow level (good for EF)")

# C3: Residual vs. rate of change
print("\n  C3. Residual magnitude vs. rate of change:")
hf_roc = hf.dropna(subset=['lf_change'])
abs_resid = np.abs(hf_roc['residual'].values)
abs_change = np.abs(hf_roc['lf_change'].values)

if len(hf_roc) >= 10:
    roc_r, roc_p = stats.pearsonr(abs_change, abs_resid)
    print(f"      Correlation(|rate_of_change|, |residual|): r={roc_r:.3f} (p={roc_p:.3e})")
    if roc_r > 0.3:
        print("      => EF errors grow on rapidly-changing days")
        print("         PoR (which tracks momentum) would help here")
    else:
        print("      => No strong link between rate-of-change and EF error")

    # Also check: is EF late? (residual correlated with sign of change)
    signed_change = hf_roc['lf_change'].values
    signed_resid = hf_roc['residual'].values
    lag_r, lag_p = stats.pearsonr(signed_change, signed_resid)
    print(f"      Correlation(signed_change, signed_residual): r={lag_r:.3f} (p={lag_p:.3e})")
    if lag_r < -0.2:
        print("      => EF tends to lag: under-predicts on rising days, over-predicts on falling")
    elif lag_r > 0.2:
        print("      => EF tends to lead: over-predicts on rising days")
    else:
        print("      => No systematic lag/lead pattern")
else:
    print("      Not enough data for rate-of-change analysis")
    roc_r = np.nan

# C4: Distribution of residuals
print("\n  C4. Residual distribution:")
print(f"      Mean:    {np.mean(residuals):>+10,.0f} cfs")
print(f"      Median:  {np.median(residuals):>+10,.0f} cfs")
print(f"      Std:     {np.std(residuals):>10,.0f} cfs")
print(f"      Skew:    {stats.skew(residuals):>10.2f}")
print(f"      Kurtosis:{stats.kurtosis(residuals):>10.2f}")

# Normality test
if len(residuals) >= 20:
    _, shapiro_p = stats.shapiro(residuals[:5000])  # shapiro limited to 5000
    print(f"      Shapiro-Wilk p-value: {shapiro_p:.4f}")
    if shapiro_p < 0.05:
        print("      => Residuals are NOT normally distributed")
    else:
        print("      => Residuals appear approximately normal")

print()

# ─────────────────────────────────────────────────────────────────────────────
# APPROACH D: Information Content — Partial R² vs Naive Models
# ─────────────────────────────────────────────────────────────────────────────
print("=" * 70)
print("APPROACH D: Information Content — Partial R² vs Naive Models")
print("=" * 70)

# Build a dataset of consecutive-day high-flow observations
hf_d = hf_sorted.copy()
hf_d['yesterday_lf'] = hf_d['lf_discharge'].shift(1)
hf_d['yesterday_valid'] = hf_d['date_diff'] == 1
hf_consec = hf_d[hf_d['yesterday_valid']].dropna(subset=['yesterday_lf']).copy()

print(f"\n  Consecutive high-flow day-pairs: {len(hf_consec)}")

if len(hf_consec) >= 20:
    y_actual = hf_consec['lf_discharge'].values
    x_yesterday = hf_consec['yesterday_lf'].values
    x_ef = hf_consec['ef_predicted'].values

    # Model 1: Yesterday's LF only (persistence model / proxy for PoR)
    ss_tot_d = np.sum((y_actual - np.mean(y_actual))**2)

    resid_yesterday = y_actual - x_yesterday
    ss_yesterday = np.sum(resid_yesterday**2)
    r2_yesterday = 1 - ss_yesterday / ss_tot_d
    rmse_yesterday = np.sqrt(np.mean(resid_yesterday**2))

    print(f"\n  Model 1 — Yesterday's LF (persistence/PoR proxy):")
    print(f"    R²={r2_yesterday:.4f}, RMSE={rmse_yesterday:,.0f} cfs")

    # Model 2: EF prediction only
    resid_ef = y_actual - x_ef
    ss_ef = np.sum(resid_ef**2)
    r2_ef = 1 - ss_ef / ss_tot_d
    rmse_ef = np.sqrt(np.mean(resid_ef**2))

    print(f"\n  Model 2 — EF prediction only:")
    print(f"    R²={r2_ef:.4f}, RMSE={rmse_ef:,.0f} cfs")

    # Model 3: Combined (multiple regression)
    X_combined = np.column_stack([x_yesterday, x_ef])
    X_with_const = np.column_stack([np.ones(len(y_actual)), X_combined])
    beta, ss_resid_combined, _, _ = np.linalg.lstsq(X_with_const, y_actual, rcond=None)
    y_hat_combined = X_with_const @ beta
    resid_combined = y_actual - y_hat_combined
    ss_combined = np.sum(resid_combined**2)
    r2_combined = 1 - ss_combined / ss_tot_d
    rmse_combined = np.sqrt(np.mean(resid_combined**2))

    print(f"\n  Model 3 — Combined (yesterday_LF + EF):")
    print(f"    R²={r2_combined:.4f}, RMSE={rmse_combined:,.0f} cfs")
    print(f"    Coefficients: intercept={beta[0]:,.0f}, "
          f"w_yesterday={beta[1]:.3f}, w_ef={beta[2]:.3f}")

    # Partial R² of EF beyond yesterday's LF
    partial_r2_ef = (ss_yesterday - ss_combined) / ss_yesterday
    print(f"\n  Partial R² of EF (beyond yesterday's LF): {partial_r2_ef:.4f}")
    print(f"    => EF explains {partial_r2_ef*100:.1f}% of the variance "
          f"that yesterday's LF does NOT")

    # Partial R² of yesterday's LF beyond EF
    partial_r2_yesterday = (ss_ef - ss_combined) / ss_ef
    print(f"  Partial R² of yesterday's LF (beyond EF): {partial_r2_yesterday:.4f}")
    print(f"    => Yesterday's LF explains {partial_r2_yesterday*100:.1f}% of the variance "
          f"that EF does NOT")

    # F-test for EF contribution
    n_obs = len(y_actual)
    df_full = n_obs - 3  # combined model (intercept + 2 predictors)
    df_reduced = n_obs - 2  # yesterday-only (intercept + 1 predictor)
    f_stat = ((ss_yesterday - ss_combined) / 1) / (ss_combined / df_full)
    f_pval = 1 - stats.f.cdf(f_stat, 1, df_full)
    print(f"\n  F-test for EF's marginal contribution:")
    print(f"    F={f_stat:.2f}, p={f_pval:.4e}")
    if f_pval < 0.01:
        print("    => EF provides statistically significant independent information (p<0.01)")
    elif f_pval < 0.05:
        print("    => EF provides marginally significant independent information (p<0.05)")
    else:
        print("    => EF does NOT provide statistically significant independent info (p>=0.05)")

    # Optimal blend weight via regression
    # Reframe: actual = w * ef_pred + (1-w) * yesterday_lf
    # actual - yesterday_lf = w * (ef_pred - yesterday_lf)
    # Simple regression through origin
    delta_ef = x_ef - x_yesterday
    delta_actual = y_actual - x_yesterday
    w_optimal = np.sum(delta_ef * delta_actual) / np.sum(delta_ef**2)
    w_optimal_clipped = np.clip(w_optimal, 0, 1)

    print(f"\n  Optimal EF weight (regression-based): {w_optimal:.3f}")
    print(f"    Clipped to [0,1]: {w_optimal_clipped:.3f}")

    # Test different weights
    print("\n  Blended model performance across EF weights:")
    print(f"    {'Weight':>8s}  {'RMSE':>10s}  {'MAE':>10s}  {'R²':>8s}")
    best_w, best_rmse_w = 0, np.inf
    for w in np.arange(0, 1.05, 0.05):
        blend = (1 - w) * x_yesterday + w * x_ef
        blend_resid = y_actual - blend
        w_rmse = np.sqrt(np.mean(blend_resid**2))
        w_mae = np.mean(np.abs(blend_resid))
        w_r2 = 1 - np.sum(blend_resid**2) / ss_tot_d
        marker = " <-- current" if abs(w - 0.50) < 0.01 else ""
        if abs(w - w_optimal_clipped) < 0.025:
            marker = " <-- optimal"
        print(f"    {w:>8.2f}  {w_rmse:>10,.0f}  {w_mae:>10,.0f}  {w_r2:>8.4f}{marker}")
        if w_rmse < best_rmse_w:
            best_rmse_w = w_rmse
            best_w = w

    print(f"\n  Best weight by RMSE: {best_w:.2f} (RMSE={best_rmse_w:,.0f})")

    # Improvement from current 50% to optimal
    blend_50 = 0.5 * x_yesterday + 0.5 * x_ef
    rmse_50 = np.sqrt(np.mean((y_actual - blend_50)**2))
    blend_opt = (1 - w_optimal_clipped) * x_yesterday + w_optimal_clipped * x_ef
    rmse_opt = np.sqrt(np.mean((y_actual - blend_opt)**2))
    improvement = (rmse_50 - rmse_opt) / rmse_50 * 100

    print(f"\n  RMSE at 50% EF weight: {rmse_50:,.0f} cfs")
    print(f"  RMSE at optimal ({w_optimal_clipped:.0%}) EF weight: {rmse_opt:,.0f} cfs")
    print(f"  Improvement: {improvement:.1f}%")

else:
    print("  Not enough consecutive high-flow day-pairs for information content analysis")
    w_optimal_clipped = np.nan
    partial_r2_ef = np.nan
    partial_r2_yesterday = np.nan
    r2_yesterday = np.nan
    r2_ef = np.nan
    r2_combined = np.nan

print()

# ─────────────────────────────────────────────────────────────────────────────
# SYNTHESIS
# ─────────────────────────────────────────────────────────────────────────────
print("=" * 70)
print("SYNTHESIS: Should EF Get >50% Weight at High Flows?")
print("=" * 70)

# Build synthesis strings to avoid f-string formatting issues
ef_quality = 'excellent' if r_squared > 0.95 else ('good' if r_squared > 0.9 else 'moderate')
cv_quality = 'generalizes well' if overfit_ratio < 1.05 else ('shows some overfitting' if overfit_ratio < 1.15 else 'may overfit')
lag1_str = 'N/A' if np.isnan(lag1_r) else f'{lag1_r:.3f}'
lag1_interp = ('Residuals are correlated day-to-day -> PoR tracking adds value'
               if not np.isnan(lag1_r) and abs(lag1_r) > 0.3
               else 'Residuals are relatively independent -> EF captures most signal')
bias_interp = ('Systematic bias -> PoR helps at extremes' if abs(r_resid) > 0.3
               else 'No systematic bias -> EF is reliable across flow range')
pr2_ef_str = f'{partial_r2_ef:.4f}' if not np.isnan(partial_r2_ef) else 'N/A'
pr2_yest_str = f'{partial_r2_yesterday:.4f}' if not np.isnan(partial_r2_yesterday) else 'N/A'
wopt_str = f'{w_optimal_clipped:.0%}' if not np.isnan(w_optimal_clipped) else 'N/A'

print(f"""
  Dataset: {len(hf)} high-flow days (>= {HIGH_FLOW_THRESHOLD} cfs)

  APPROACH A -- EF Accuracy:
    R2={r_squared:.4f}, MAPE={mape:.1f}%, Bias={bias:+,.0f} cfs
    EF is {ef_quality} at predicting high flows on its own.

  APPROACH B -- Cross-Validation:
    LOO-CV R2={loo_r2:.4f}, Overfitting ratio={overfit_ratio:.3f}
    The power-law model {cv_quality}.

  APPROACH C -- Residual Structure:
    Lag-1 autocorrelation: r={lag1_str}
    {lag1_interp}
    Bias-vs-flow r={r_resid:.3f}: {bias_interp}

  APPROACH D -- Information Content:
    EF partial R2 (beyond persistence): {pr2_ef_str}
    Persistence partial R2 (beyond EF): {pr2_yest_str}
    Optimal EF weight: {wopt_str}
""")

# Decision
if not np.isnan(w_optimal_clipped):
    if w_optimal_clipped > 0.55:
        verdict = "YES — increase EF weight above 50%"
        rec_weight = min(round(w_optimal_clipped * 20) / 20, 0.75)  # round to 5%, cap at 75%
        explanation = (f"EF provides substantial independent information at high flows. "
                       f"Recommended weight: {rec_weight:.0%}")
    elif w_optimal_clipped > 0.45:
        verdict = "NO — 50% is approximately optimal"
        rec_weight = 0.50
        explanation = "The current 50% weight is close to optimal. No change needed."
    else:
        verdict = "NO — EF should actually get LESS than 50%"
        rec_weight = max(round(w_optimal_clipped * 20) / 20, 0.25)
        explanation = (f"Persistence (PoR) captures more signal than EF at high flows. "
                       f"Consider reducing to {rec_weight:.0%}")
else:
    verdict = "INCONCLUSIVE — not enough consecutive high-flow data"
    rec_weight = 0.50
    explanation = "Insufficient consecutive high-flow days for robust analysis."

print(f"  VERDICT: {verdict}")
print(f"  {explanation}")
print()

# ─────────────────────────────────────────────────────────────────────────────
# Save results
# ─────────────────────────────────────────────────────────────────────────────
results = {
    'metric': [
        'n_high_flow_days',
        'ef_only_rmse',
        'ef_only_mape_pct',
        'ef_only_bias',
        'ef_only_r_squared',
        'loo_cv_rmse',
        'loo_cv_r_squared',
        'overfit_ratio',
        'high_flow_fit_a',
        'high_flow_fit_b',
        'residual_lag1_autocorr',
        'residual_vs_flow_r',
        'residual_vs_rateofchange_r',
        'persistence_r_squared',
        'ef_r_squared',
        'combined_r_squared',
        'ef_partial_r_squared',
        'persistence_partial_r_squared',
        'optimal_ef_weight',
        'recommended_ef_weight',
    ],
    'value': [
        len(hf),
        round(rmse, 1),
        round(mape, 2),
        round(bias, 1),
        round(r_squared, 4),
        round(loo_rmse, 1),
        round(loo_r2, 4),
        round(overfit_ratio, 4),
        round(a_full, 1),
        round(b_full, 4),
        round(lag1_r, 4) if not np.isnan(lag1_r) else 'N/A',
        round(r_resid, 4),
        round(roc_r, 4) if not np.isnan(roc_r) else 'N/A',
        round(r2_yesterday, 4) if not np.isnan(r2_yesterday) else 'N/A',
        round(r2_ef, 4) if not np.isnan(r2_ef) else 'N/A',
        round(r2_combined, 4) if not np.isnan(r2_combined) else 'N/A',
        round(partial_r2_ef, 4) if not np.isnan(partial_r2_ef) else 'N/A',
        round(partial_r2_yesterday, 4) if not np.isnan(partial_r2_yesterday) else 'N/A',
        round(w_optimal_clipped, 4) if not np.isnan(w_optimal_clipped) else 'N/A',
        rec_weight,
    ]
}

results_df = pd.DataFrame(results)
results_df.to_csv(OUTPUT_PATH, index=False)
print(f"Results saved to: {OUTPUT_PATH}")

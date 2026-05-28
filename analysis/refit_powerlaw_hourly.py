#!/usr/bin/env python3
"""
EF Power-Law Refit with Autocorrelation Diagnostics — 117k Hourly Dataset (Python)
Step 3 of the Potomac Pulse re-estimation pipeline.
"""
import numpy as np, pandas as pd, time
from scipy import stats
import statsmodels.api as sm
from statsmodels.stats.diagnostic import acorr_ljungbox
from statsmodels.regression.linear_model import OLS, GLS
from statsmodels.stats.stattools import durbin_watson
from statsmodels.tsa.stattools import acf

t0 = time.time()
DATA = "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
OUT = "/Users/sebjilke/Desktop/PotomacPulse/analysis/powerlaw_refit_python.csv"

print("=" * 80)
print("EF POWER-LAW REFIT WITH AUTOCORRELATION DIAGNOSTICS (PYTHON)")
print("=" * 80)

df = pd.read_csv(DATA, parse_dates=["timestamp"])
print(f"\nLoaded {len(df):,} rows | {df['timestamp'].min()} to {df['timestamp'].max()}")

# Filter: need ef_stage > 0 and lf_discharge > 0
valid = df["ef_stage"].notna() & (df["ef_stage"] > 0) & df["lf_discharge"].notna() & (df["lf_discharge"] > 0)
dv = df[valid].copy()
print(f"Valid rows (EF>0, LF>0): {len(dv):,}")

cold_mask = dv["water_temp_c"].notna() & (dv["water_temp_c"] <= 10.0)
print(f"Cold-water rows (<=10C): {cold_mask.sum():,}")
print(f"Default rows: {(~cold_mask).sum():,}")
print(f"Temp-unknown rows: {dv['water_temp_c'].isna().sum():,}")

def fit_and_report(log_ef, log_lf, label, n_obs):
    """Fit power-law via OLS on log-transformed data, run diagnostics."""
    print(f"\n{'='*80}")
    print(f"  {label} (n={n_obs:,})")
    print(f"{'='*80}")
    
    # --- 1. OLS ---
    X = sm.add_constant(log_ef)
    model = OLS(log_lf, X).fit()
    intercept, slope = model.params
    coef = np.exp(intercept)
    exp = slope
    r2 = model.rsquared
    
    predicted = coef * np.exp(log_ef) ** exp
    actual = np.exp(log_lf)
    residuals_real = predicted - actual
    rmse = np.sqrt(np.mean(residuals_real**2))
    pct_err = np.abs(residuals_real) / actual * 100
    median_err = np.median(pct_err)
    
    ci = model.conf_int().values  # 2×2 array: [[lo_int, hi_int], [lo_slp, hi_slp]]
    print(f"\n  OLS: LF = {coef:.1f} × EF^{exp:.4f}")
    print(f"  R² = {r2:.4f}, RMSE = {rmse:.1f} cfs, Median error = {median_err:.1f}%")
    print(f"  95% CI coef: [{np.exp(ci[0][0]):.1f}, {np.exp(ci[0][1]):.1f}]")
    print(f"  95% CI exp:  [{ci[1][0]:.4f}, {ci[1][1]:.4f}]")
    
    # --- 2. Autocorrelation diagnostics ---
    resid = model.resid
    dw = durbin_watson(resid)
    print(f"\n  Durbin-Watson: {dw:.4f} (2.0 = no autocorrelation, <1 = strong positive)")
    
    # ACF at specific lags
    max_lag = min(200, len(resid) // 2)
    acf_vals = acf(resid, nlags=max_lag, fft=True)
    lags_to_show = [1, 2, 6, 12, 24, 48, 168]
    print(f"  ACF values:")
    for lag in lags_to_show:
        if lag < len(acf_vals):
            print(f"    lag {lag:>3}: {acf_vals[lag]:.4f}")
    
    # Ljung-Box at key lags
    for lb_lag in [1, 24, 168]:
        if lb_lag < len(resid):
            lb = acorr_ljungbox(resid, lags=[lb_lag], return_df=True)
            stat = lb['lb_stat'].values[0]
            pval = lb['lb_pvalue'].values[0]
            print(f"  Ljung-Box(lag={lb_lag}): stat={stat:.1f}, p={pval:.2e} {'***' if pval < 0.001 else ''}")
    
    results = [{"model": label, "method": "OLS", "coef": round(coef,2), "exp": round(exp,4),
                "r2": round(r2,4), "rmse": round(rmse,1), "median_err_pct": round(median_err,1),
                "ci_coef_lo": round(np.exp(ci[0][0]),2),
                "ci_coef_hi": round(np.exp(ci[0][1]),2),
                "ci_exp_lo": round(ci[1][0],4),
                "ci_exp_hi": round(ci[1][1],4),
                "n": n_obs, "dw": round(dw,4)}]
    
    # --- 3. Newey-West HAC ---
    nw_model = model.get_robustcov_results(cov_type='HAC', maxlags=50)
    nw_ci_raw = nw_model.conf_int()
    nw_ci = nw_ci_raw.values if hasattr(nw_ci_raw, 'values') else nw_ci_raw  # handle both DataFrame and ndarray
    print(f"\n  Newey-West HAC (bandwidth=50):")
    print(f"  Same point estimates: coef={coef:.1f}, exp={exp:.4f}")
    print(f"  HAC 95% CI coef: [{np.exp(nw_ci[0][0]):.1f}, {np.exp(nw_ci[0][1]):.1f}]")
    print(f"  HAC 95% CI exp:  [{nw_ci[1][0]:.4f}, {nw_ci[1][1]:.4f}]")

    results.append({"model": label, "method": "Newey-West HAC", "coef": round(coef,2), "exp": round(exp,4),
                    "r2": round(r2,4), "rmse": round(rmse,1), "median_err_pct": round(median_err,1),
                    "ci_coef_lo": round(np.exp(nw_ci[0][0]),2), "ci_coef_hi": round(np.exp(nw_ci[0][1]),2),
                    "ci_exp_lo": round(nw_ci[1][0],4), "ci_exp_hi": round(nw_ci[1][1],4),
                    "n": n_obs, "dw": round(dw,4)})
    
    # --- 4. GLS with AR(1) ---
    try:
        rho = acf_vals[1]  # AR(1) coefficient from ACF
        # Build AR(1) covariance matrix for GLS (use Prais-Winsten approach)
        n = len(log_lf)
        # Cochrane-Orcutt transformation
        y_co = log_lf.values[1:] - rho * log_lf.values[:-1]
        x_co = X.values[1:] - rho * X.values[:-1]
        gls_model = OLS(y_co, x_co).fit()
        gls_intercept = gls_model.params[0] / (1 - rho)  # adjust intercept
        gls_slope = gls_model.params[1]
        gls_coef = np.exp(gls_intercept)
        gls_exp = gls_slope
        
        # Compute R² on original scale
        gls_pred = gls_coef * np.exp(log_ef) ** gls_exp
        gls_resid = gls_pred - actual
        gls_rmse = np.sqrt(np.mean(gls_resid**2))
        gls_pct = np.abs(gls_resid) / actual * 100
        gls_median = np.median(gls_pct)
        ss_res = np.sum((log_lf - (gls_intercept + gls_slope * log_ef))**2)
        ss_tot = np.sum((log_lf - log_lf.mean())**2)
        gls_r2 = 1 - ss_res / ss_tot
        
        # CI for GLS (approximate via Cochrane-Orcutt)
        gls_ci_raw = gls_model.conf_int()
        gls_ci = gls_ci_raw.values if hasattr(gls_ci_raw, 'values') else gls_ci_raw
        gls_ci_intercept_lo = gls_ci[0][0] / (1 - rho)
        gls_ci_intercept_hi = gls_ci[0][1] / (1 - rho)

        print(f"\n  GLS Cochrane-Orcutt (rho={rho:.4f}):")
        print(f"  LF = {gls_coef:.1f} × EF^{gls_exp:.4f}")
        print(f"  R² = {gls_r2:.4f}, RMSE = {gls_rmse:.1f} cfs, Median error = {gls_median:.1f}%")
        print(f"  CI coef: [{np.exp(gls_ci_intercept_lo):.1f}, {np.exp(gls_ci_intercept_hi):.1f}]")
        print(f"  CI exp:  [{gls_ci[1][0]:.4f}, {gls_ci[1][1]:.4f}]")

        results.append({"model": label, "method": "GLS AR(1)", "coef": round(gls_coef,2), "exp": round(gls_exp,4),
                        "r2": round(gls_r2,4), "rmse": round(gls_rmse,1), "median_err_pct": round(gls_median,1),
                        "ci_coef_lo": round(np.exp(gls_ci_intercept_lo),2), "ci_coef_hi": round(np.exp(gls_ci_intercept_hi),2),
                        "ci_exp_lo": round(gls_ci[1][0],4), "ci_exp_hi": round(gls_ci[1][1],4),
                        "n": n_obs, "dw": round(dw,4)})
    except Exception as e:
        print(f"\n  GLS AR(1) FAILED: {e}")
    
    # --- 5. Subsampling (every 24th obs) ---
    for step, name in [(24, "Subsample-24h"), (168, "Subsample-168h")]:
        idx = np.arange(0, len(log_ef), step)
        if len(idx) < 10:
            print(f"\n  {name}: too few obs ({len(idx)}), skipping")
            continue
        sub_X = sm.add_constant(log_ef.values[idx])
        sub_model = OLS(log_lf.values[idx], sub_X).fit()
        sub_coef = np.exp(sub_model.params[0])
        sub_exp = sub_model.params[1]
        sub_r2 = sub_model.rsquared
        sub_pred = sub_coef * np.exp(log_ef.values[idx]) ** sub_exp
        sub_actual = np.exp(log_lf.values[idx])
        sub_rmse = np.sqrt(np.mean((sub_pred - sub_actual)**2))
        sub_pct = np.abs(sub_pred - sub_actual) / sub_actual * 100
        sub_ci_raw = sub_model.conf_int()
        sub_ci = sub_ci_raw.values if hasattr(sub_ci_raw, 'values') else sub_ci_raw

        print(f"\n  {name} (n={len(idx):,}):")
        print(f"  LF = {sub_coef:.1f} × EF^{sub_exp:.4f}")
        print(f"  R² = {sub_r2:.4f}, RMSE = {sub_rmse:.1f}, Median error = {np.median(sub_pct):.1f}%")
        print(f"  CI coef: [{np.exp(sub_ci[0][0]):.1f}, {np.exp(sub_ci[0][1]):.1f}]")
        print(f"  CI exp:  [{sub_ci[1][0]:.4f}, {sub_ci[1][1]:.4f}]")

        # DW on subsample
        sub_dw = durbin_watson(sub_model.resid)
        print(f"  DW on subsample: {sub_dw:.4f}")

        results.append({"model": label, "method": name, "coef": round(sub_coef,2), "exp": round(sub_exp,4),
                        "r2": round(sub_r2,4), "rmse": round(sub_rmse,1), "median_err_pct": round(np.median(sub_pct),1),
                        "ci_coef_lo": round(np.exp(sub_ci[0][0]),2), "ci_coef_hi": round(np.exp(sub_ci[0][1]),2),
                        "ci_exp_lo": round(sub_ci[1][0],4), "ci_exp_hi": round(sub_ci[1][1],4),
                        "n": len(idx), "dw": round(sub_dw,4)})
    
    return results

# === DEFAULT MODEL (all obs, or temp > 10 or unknown) ===
log_ef_all = np.log(dv["ef_stage"].values)
log_lf_all = np.log(dv["lf_discharge"].values)
all_results = fit_and_report(pd.Series(log_ef_all), pd.Series(log_lf_all), "Default (all obs)", len(dv))

# === COLD-WATER MODEL (temp <= 10) ===
dv_cold = dv[cold_mask]
if len(dv_cold) > 100:
    log_ef_cold = np.log(dv_cold["ef_stage"].values)
    log_lf_cold = np.log(dv_cold["lf_discharge"].values)
    all_results.extend(fit_and_report(pd.Series(log_ef_cold), pd.Series(log_lf_cold), "Cold water (<=10C)", len(dv_cold)))

# === COMPARISON WITH v29.0 ===
print(f"\n{'='*80}")
print("COMPARISON WITH CURRENT v29.0")
print(f"{'='*80}")
print(f"  v29.0 Default: LF = 126 × EF^2.46 (R²=0.91)")
print(f"  v29.0 Cold:    LF = 160 × EF^2.36 (R²=0.96)")

rdf = pd.DataFrame(all_results)
print(f"\n{'='*80}")
print("SUMMARY TABLE")
print(f"{'='*80}")
print(rdf[["model","method","coef","exp","r2","rmse","n","dw","ci_exp_lo","ci_exp_hi"]].to_string(index=False))

rdf.to_csv(OUT, index=False)
print(f"\nSaved to {OUT}")
print(f"Runtime: {time.time()-t0:.1f}s")
print(f"\n{'='*80}\nPYTHON POWER-LAW REFIT COMPLETE\n{'='*80}")

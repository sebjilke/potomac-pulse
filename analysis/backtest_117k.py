#!/usr/bin/env python3
"""
Ceiling/Decay Grid Search — 117k Hourly Dataset (Python Blind Subagent)
Step 2 of the Potomac Pulse re-estimation pipeline.
Tests 25 configs (5 decay caps × 5 ceiling ratios) on 117,704 hourly obs.
"""
import numpy as np, pandas as pd, time
t0 = time.time()
DATA_PATH = "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
OUTPUT_PATH = "/Users/sebjilke/Desktop/PotomacPulse/analysis/backtest_117k_hourly_python.csv"
DECAY_CAPS = [0.30, 0.40, 0.50, 0.60, 0.75]
CEILING_RATIOS = [None, 1.05, 1.10, 1.15, 1.20]

print("=" * 72)
print("CEILING/DECAY GRID SEARCH — 117k HOURLY DATASET (PYTHON)")
print("=" * 72)

df = pd.read_csv(DATA_PATH, parse_dates=["timestamp"])
print(f"\nLoaded {len(df):,} rows | {df['timestamp'].min()} to {df['timestamp'].max()}")

cold_mask = df["water_temp_c"].notna() & (df["water_temp_c"] <= 10.0)
df["ef_estimate"] = np.where(cold_mask, 160.0 * df["ef_stage"]**2.36, 126.0 * df["ef_stage"]**2.46)
print(f"Cold={cold_mask.sum():,}, Default={(~cold_mask).sum():,}")

valid = (df["por_lagged"].notna() & df["por_now"].notna() & df["ef_stage"].notna() &
         (df["ef_stage"] > 0) & df["lf_discharge"].notna() & df["ef_estimate"].notna() &
         df["travel_time_h"].notna() & (df["travel_time_h"] > 0))
dv = df[valid].copy().reset_index(drop=True)
print(f"Valid: {len(dv):,}")

td = dv["timestamp"].diff().dt.total_seconds() / 3600.0
consec = (td > 0) & (td <= 2.0)
pidx = np.where(consec.values)[0]
print(f"Pairs: {len(pidx):,}")

pl = dv["por_lagged"].values.astype(np.float64)
pn = dv["por_now"].values.astype(np.float64)
ef = dv["ef_estimate"].values.astype(np.float64)
lf = dv["lf_discharge"].values.astype(np.float64)
tt = dv["travel_time_h"].values.astype(np.float64)

pr = pn[pidx] / pn[pidx - 1]
rising = pr > 1.05; falling = pr < 0.95; steady = ~rising & ~falling
print(f"Rising={rising.sum():,}, Falling={falling.sum():,}, Steady={steady.sum():,}")

results = []
print(f"\n{'Decay':>6} {'Ceil':>6} {'RMSE':>10} {'Bias':>10} {'MAPE':>8} {'Rise_RMSE':>10} {'Rise_Bias':>10} {'Fall_RMSE':>10} {'Ceil_N':>8}")
print("-" * 82)

for dc in DECAY_CAPS:
    for cr in CEILING_RATIOS:
        ic, ip = pidx, pidx - 1
        w = np.where(pl[ic] >= 3000, 0.35, 0.0)
        base = (1.0 - w) * pl[ic] + w * ef[ic]
        pc = pn[ic] / np.maximum(pn[ip], 100.0)
        stale = 1.0 / np.maximum(tt[ic], 1.0)
        decay = np.minimum(dc, np.sqrt(stale))
        ar = 1.0 + (pc - 1.0) * decay
        corr = base * ar
        ct = 0
        if cr is not None:
            mx = lf[ic] * cr; vc = lf[ic] > 0; oc = vc & (corr > mx)
            ct = int(oc.sum()); final = np.where(oc, mx, corr)
        else:
            final = corr.copy()
        err = final - lf[ic]
        pce = np.abs(err) / np.maximum(lf[ic], 1.0) * 100
        rmse = np.sqrt(np.mean(err**2)); bias = np.mean(err); mape = np.mean(pce)
        rr = np.sqrt(np.mean(err[rising]**2)) if rising.sum() > 0 else np.nan
        rb = np.mean(err[rising]) if rising.sum() > 0 else np.nan
        fr = np.sqrt(np.mean(err[falling]**2)) if falling.sum() > 0 else np.nan
        fb = np.mean(err[falling]) if falling.sum() > 0 else np.nan
        sr = np.sqrt(np.mean(err[steady]**2)) if steady.sum() > 0 else np.nan
        sb = np.mean(err[steady]) if steady.sum() > 0 else np.nan
        cl = f"{cr:.2f}" if cr else "None"
        print(f"{dc:>6.2f} {cl:>6} {rmse:>10.1f} {bias:>+10.1f} {mape:>8.1f}% {rr:>10.1f} {rb:>+10.1f} {fr:>10.1f} {ct:>8,}")
        results.append({"decay_cap":dc,"ceiling_ratio":cl,"rmse":round(rmse,2),"bias":round(bias,2),
            "mape":round(mape,2),"rising_rmse":round(rr,2),"rising_bias":round(rb,2),
            "falling_rmse":round(fr,2),"falling_bias":round(fb,2) if not np.isnan(fb) else np.nan,
            "steady_rmse":round(sr,2),"steady_bias":round(sb,2) if not np.isnan(sb) else np.nan,
            "ceiling_triggers":ct,"n_pairs":len(pidx),"n_rising":int(rising.sum()),
            "n_falling":int(falling.sum()),"n_steady":int(steady.sum())})

rdf = pd.DataFrame(results); rdf.to_csv(OUTPUT_PATH, index=False)
print(f"\nSaved to {OUTPUT_PATH}")
bo = rdf.loc[rdf["rmse"].idxmin()]
print(f"\n{'='*72}\nBEST CONFIGS\n{'='*72}")
print(f"\nBest overall RMSE: decay={bo['decay_cap']}, ceil={bo['ceiling_ratio']}, RMSE={bo['rmse']:.1f}, Bias={bo['bias']:+.1f}, RiseBias={bo['rising_bias']:+.1f}")
br = rdf.loc[rdf["rising_rmse"].idxmin()]
print(f"Best rising RMSE: decay={br['decay_cap']}, ceil={br['ceiling_ratio']}, RMSE={br['rmse']:.1f}, RiseRMSE={br['rising_rmse']:.1f}, RiseBias={br['rising_bias']:+.1f}")
rdf["arb"] = rdf["rising_bias"].abs()
bb = rdf.loc[rdf["arb"].idxmin()]
print(f"Best |rise bias|: decay={bb['decay_cap']}, ceil={bb['ceiling_ratio']}, RMSE={bb['rmse']:.1f}, RiseBias={bb['rising_bias']:+.1f}")
rdf["rr"] = rdf["rmse"].rank(); rdf["br"] = rdf["arb"].rank(); rdf["cr"] = 0.5*rdf["rr"]+0.5*rdf["br"]
bc = rdf.loc[rdf["cr"].idxmin()]
print(f"Best combined: decay={bc['decay_cap']}, ceil={bc['ceiling_ratio']}, RMSE={bc['rmse']:.1f}, Bias={bc['bias']:+.1f}, RiseBias={bc['rising_bias']:+.1f}")
v28 = rdf[(rdf["decay_cap"]==0.50)&(rdf["ceiling_ratio"]=="1.20")]
if len(v28)>0:
    v=v28.iloc[0]; print(f"\nCurrent (decay=0.50, ceil=1.20): RMSE={v['rmse']:.1f}, Bias={v['bias']:+.1f}, RiseBias={v['rising_bias']:+.1f}, Triggers={v['ceiling_triggers']:,}")
print(f"\nRuntime: {time.time()-t0:.1f}s\n{'='*72}\nPYTHON GRID SEARCH COMPLETE\n{'='*72}")

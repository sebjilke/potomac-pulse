#!/usr/bin/env python3
"""
C45 v3 gate metrics — computed in Python (pandas + scipy) from the CSV only.

v3 variant: the interp arm blends ONLY within +/-12% flow of the LOW/MID
boundaries 3000/6000/12000; the 25000 & 50000 boundaries are hard steps, and
all mid-bin obs keep their exact binned correction.

All distance metrics (median|err|, MAE, RMSE) are computed on the UNCLIPPED
(PRE-ceiling) residual estimates: resUnclBinned and resUnclInterp.
rel% convention: positive => interp WORSE than binned.

Outputs analysis/c45_gate_metrics_v3_python.json with 4 significant figures.
"""

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

CSV = Path("/Users/sebjilke/Desktop/PotomacPulse/analysis/c45_gate_residuals_v3.csv")
OUT_JSON = Path("/Users/sebjilke/Desktop/PotomacPulse/analysis/c45_gate_metrics_v3_python.json")

# Canonical flowBin order (low -> high)
BIN_ORDER = ["0-3000", "3000-6000", "6000-12000", "12000-25000", "25000-50000", "50000+"]


def sig4(x):
    """Round to 4 significant figures; pass through None/NaN as None."""
    if x is None:
        return None
    if isinstance(x, (int, np.integer)):
        return int(x)
    xf = float(x)
    if math.isnan(xf):
        return None
    if xf == 0.0:
        return 0.0
    return float(f"{xf:.4g}")


def med_abs(err):
    return float(np.median(np.abs(err)))


def mae(err):
    return float(np.mean(np.abs(err)))


def rmse(err):
    return float(np.sqrt(np.mean(np.square(err))))


def rel_pct(interp, binned):
    """Percent change of interp relative to binned. Positive => interp worse."""
    if binned == 0:
        return None
    return (interp - binned) / binned * 100.0


def main():
    df = pd.read_csv(CSV)

    n_obs = len(df)

    # Unclipped (pre-ceiling) residual estimates
    rb = df["resUnclBinned"].to_numpy(dtype=float)
    ri = df["resUnclInterp"].to_numpy(dtype=float)

    abs_rb = np.abs(rb)
    abs_ri = np.abs(ri)

    # ---- (1) OVERALL pooled, unclipped ----
    b_med = med_abs(rb)
    i_med = med_abs(ri)
    b_mae = mae(rb)
    i_mae = mae(ri)
    b_rmse = rmse(rb)
    i_rmse = rmse(ri)

    overall = {
        "binnedMedAbsErr": sig4(b_med),
        "interpMedAbsErr": sig4(i_med),
        "medAbsErrRelPct": sig4(rel_pct(i_med, b_med)),
        "medAbsErrAbsCfs": sig4(i_med - b_med),
        "binnedMAE": sig4(b_mae),
        "interpMAE": sig4(i_mae),
        "maeRelPct": sig4(rel_pct(i_mae, b_mae)),
        "maeAbsCfs": sig4(i_mae - b_mae),
        "binnedRMSE": sig4(b_rmse),
        "interpRMSE": sig4(i_rmse),
        "rmseRelPct": sig4(rel_pct(i_rmse, b_rmse)),
        "rmseAbsCfs": sig4(i_rmse - b_rmse),
    }

    # ---- (2) PER flowBin ----
    per_bin = []
    present_bins = [b for b in BIN_ORDER if b in set(df["flowBin"].unique())]
    # include any unexpected bins at end, preserving appearance order
    for b in df["flowBin"].unique():
        if b not in present_bins:
            present_bins.append(b)

    for b in present_bins:
        sub = df[df["flowBin"] == b]
        srb = sub["resUnclBinned"].to_numpy(dtype=float)
        sri = sub["resUnclInterp"].to_numpy(dtype=float)

        bb_med = med_abs(srb)
        ii_med = med_abs(sri)
        bb_rmse = rmse(srb)
        ii_rmse = rmse(sri)

        per_bin.append({
            "flowBin": b,
            "n": int(len(sub)),
            "binnedMedAbsErr": sig4(bb_med),
            "interpMedAbsErr": sig4(ii_med),
            "medRelPct": sig4(rel_pct(ii_med, bb_med)),
            "binnedRMSE": sig4(bb_rmse),
            "interpRMSE": sig4(ii_rmse),
            "rmseRelPct": sig4(rel_pct(ii_rmse, bb_rmse)),
        })

    # ---- (3) PAIRED Wilcoxon signed-rank on |resUnclBinned| vs |resUnclInterp| ----
    # Two-sided. Pairs where the two arms are identical contribute zero
    # differences; use zero_method='wilcox' (drop zeros) which is the standard
    # paired test. Report direction = whether interp has lower error.
    diff = abs_ri - abs_rb
    n_nonzero = int(np.sum(diff != 0))
    if n_nonzero > 0:
        # 'wilcox' drops zero-differences (standard). Two-sided.
        w_stat, w_p = stats.wilcoxon(abs_rb, abs_ri, zero_method="wilcox",
                                     alternative="two-sided", mode="auto")
        w_stat = float(w_stat)
        w_p = float(w_p)
    else:
        w_stat, w_p = float("nan"), float("nan")

    # Direction: does interp have lower error than binned?
    median_diff = float(np.median(diff))          # interp - binned over all pairs
    mean_diff = float(np.mean(diff))
    interp_lower_err = bool(mean_diff < 0)

    wilcoxon = {
        "statistic": sig4(w_stat),
        "pValue": sig4(w_p),
        "nNonZeroPairs": n_nonzero,
        "meanAbsErrDiff_interp_minus_binned": sig4(mean_diff),
        "medianAbsErrDiff_interp_minus_binned": sig4(median_diff),
        "interpLowerErr": interp_lower_err,
        "direction": "interp lower error" if interp_lower_err else "binned lower error",
    }

    # ---- (4) Descriptive ----
    # Clipped (post-ceiling, rounded) MAE binned vs interp
    cb = df["resClipBinned"].to_numpy(dtype=float)
    ci = df["resClipInterp"].to_numpy(dtype=float)
    clip_mae_binned = mae(cb)
    clip_mae_interp = mae(ci)

    # Ceiling-flip rate: obs where ceiling-applied flag differs between arms
    ceil_b = df["ceilBinned"].to_numpy()
    ceil_i = df["ceilInterp"].to_numpy()
    n_ceil_flip = int(np.sum(ceil_b != ceil_i))
    ceiling_flip_rate = n_ceil_flip / n_obs

    # nChanged: obs where the two arms differ (unclipped residual estimates)
    n_changed = int(np.sum(rb != ri))

    descriptive = {
        "clipMAEBinned": sig4(clip_mae_binned),
        "clipMAEInterp": sig4(clip_mae_interp),
        "clipMAERelPct": sig4(rel_pct(clip_mae_interp, clip_mae_binned)),
        "ceilingFlipCount": n_ceil_flip,
        "ceilingFlipRate": sig4(ceiling_flip_rate),
        "nChanged": n_changed,
        "nChangedPct": sig4(n_changed / n_obs * 100.0),
    }

    result = {
        "language": "python",
        "tooling": {
            "pandas": pd.__version__,
            "scipy": __import__("scipy").__version__,
            "numpy": np.__version__,
        },
        "variant": "v3",
        "csv": str(CSV),
        "nObs": n_obs,
        "residualBasis": "unclipped (pre-ceiling): resUnclBinned vs resUnclInterp",
        "relPctConvention": "positive => interp WORSE than binned",
        "overall": overall,
        "perBin": per_bin,
        "wilcoxon": wilcoxon,
        "descriptive": descriptive,
    }

    OUT_JSON.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

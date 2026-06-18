#!/usr/bin/env python3
"""
C45 NARROW-BAND gate metrics (Python / pandas + scipy).

Computes accuracy metrics comparing the BINNED arm (mid-bin obs keep their exact
binned correction) vs the NARROW-BAND INTERP arm (blends only within +/-12% flow
of each bin boundary) for the C45 gate residuals.

Input : analysis/c45_gate_residuals_nb.csv  (110,548 data rows)
Output: analysis/c45_gate_metrics_nb_python.json

Conventions:
  - Gated accuracy metrics use the UNCLIPPED (pre-ceiling) residual estimates
    resUnclBinned / resUnclInterp (signed, est - actual).
  - rel% = (interp - binned) / binned * 100   (positive => interp WORSE).
  - Clipped MAE (descriptive) uses POST-ceiling rounded residuals
    resClipBinned / resClipInterp.
  - All reported numbers rounded to 4 significant figures.
"""

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

CSV_PATH = Path("/Users/sebjilke/Desktop/PotomacPulse/analysis/c45_gate_residuals_nb.csv")
OUT_PATH = Path("/Users/sebjilke/Desktop/PotomacPulse/analysis/c45_gate_metrics_nb_python.json")

# Bin order: ascending by flow magnitude.
BIN_ORDER = [
    "0-3000",
    "3000-6000",
    "6000-12000",
    "12000-25000",
    "25000-50000",
    "50000+",
]


def sigfig(x, sig=4):
    """Round to `sig` significant figures; return native float (or None for NaN)."""
    if x is None:
        return None
    if isinstance(x, (np.floating, np.integer)):
        x = float(x)
    if not isinstance(x, float):
        return x
    if math.isnan(x) or math.isinf(x):
        return None
    if x == 0.0:
        return 0.0
    return float(round(x, -int(math.floor(math.log10(abs(x)))) + (sig - 1)))


def med_abs(res):
    return float(np.median(np.abs(res)))


def mae(res):
    return float(np.mean(np.abs(res)))


def rmse(res):
    return float(np.sqrt(np.mean(np.square(res))))


def rel_pct(interp, binned):
    """(interp - binned) / binned * 100; positive => interp worse."""
    if binned == 0:
        return None
    return (interp - binned) / binned * 100.0


def main():
    df = pd.read_csv(CSV_PATH)
    n_obs = int(len(df))

    rb = df["resUnclBinned"].to_numpy(dtype=float)   # binned, pre-ceiling
    ri = df["resUnclInterp"].to_numpy(dtype=float)   # interp, pre-ceiling

    # ---- 1. OVERALL pooled (unclipped) ----
    b_med, i_med = med_abs(rb), med_abs(ri)
    b_mae, i_mae = mae(rb), mae(ri)
    b_rmse, i_rmse = rmse(rb), rmse(ri)

    overall = {
        "binnedMedAbsErr": sigfig(b_med),
        "interpMedAbsErr": sigfig(i_med),
        "medAbsErrRelPct": sigfig(rel_pct(i_med, b_med)),
        "medAbsErrDeltaCfs": sigfig(i_med - b_med),
        "binnedMAE": sigfig(b_mae),
        "interpMAE": sigfig(i_mae),
        "maeRelPct": sigfig(rel_pct(i_mae, b_mae)),
        "maeDeltaCfs": sigfig(i_mae - b_mae),
        "binnedRMSE": sigfig(b_rmse),
        "interpRMSE": sigfig(i_rmse),
        "rmseRelPct": sigfig(rel_pct(i_rmse, b_rmse)),
        "rmseDeltaCfs": sigfig(i_rmse - b_rmse),
    }

    # ---- 2. PER flowBin (all 6) ----
    per_bin = []
    present = list(df["flowBin"].unique())
    ordered = [b for b in BIN_ORDER if b in present] + [b for b in present if b not in BIN_ORDER]
    for b in ordered:
        sub = df[df["flowBin"] == b]
        srb = sub["resUnclBinned"].to_numpy(dtype=float)
        sri = sub["resUnclInterp"].to_numpy(dtype=float)
        bm, im = med_abs(srb), med_abs(sri)
        br, ir = rmse(srb), rmse(sri)
        per_bin.append({
            "flowBin": b,
            "n": int(len(sub)),
            "binnedMedAbsErr": sigfig(bm),
            "interpMedAbsErr": sigfig(im),
            "medRelPct": sigfig(rel_pct(im, bm)),
            "binnedRMSE": sigfig(br),
            "interpRMSE": sigfig(ir),
            "rmseRelPct": sigfig(rel_pct(ir, br)),
        })

    # ---- 3. PAIRED Wilcoxon signed-rank on |binned| vs |interp| ----
    abs_b = np.abs(rb)
    abs_i = np.abs(ri)
    diff = abs_b - abs_i
    n_nonzero = int(np.count_nonzero(diff))
    # Default scipy handling: zero-differences dropped (zero_method='wilcox').
    wstat, wp = stats.wilcoxon(abs_b, abs_i, alternative="two-sided")
    # Direction: which arm has lower |error| on average.
    interp_lower = bool(np.mean(abs_i) < np.mean(abs_b))
    wilcoxon = {
        "statistic": sigfig(float(wstat)),
        "pValue": sigfig(float(wp)),
        "nNonzeroDiff": n_nonzero,
        "interpLowerErr": interp_lower,
        "direction": "interp has lower |error|" if interp_lower else "binned has lower |error|",
    }

    # ---- 4. DESCRIPTIVE ----
    cb = df["resClipBinned"].to_numpy(dtype=float)
    ci = df["resClipInterp"].to_numpy(dtype=float)
    clip_mae_b = mae(cb)
    clip_mae_i = mae(ci)

    ceil_b = df["ceilBinned"].to_numpy()
    ceil_i = df["ceilInterp"].to_numpy()
    ceiling_flip_rate = float(np.mean(ceil_b != ceil_i))

    # Obs where interp differs from binned at all (the near-boundary obs).
    differs = (df["resUnclBinned"] != df["resUnclInterp"]).to_numpy()
    n_changed = int(np.count_nonzero(differs))
    frac_changed = float(n_changed / n_obs)

    descriptive = {
        "clipMAEBinned": sigfig(clip_mae_b),
        "clipMAEInterp": sigfig(clip_mae_i),
        "clipMAERelPct": sigfig(rel_pct(clip_mae_i, clip_mae_b)),
        "ceilingFlipRate": sigfig(ceiling_flip_rate),
        "nChanged": n_changed,
        "fracChanged": sigfig(frac_changed),
    }

    result = {
        "language": "python",
        "variant": "narrow-band (+/-12% flow of bin boundary; mid-bin keeps binned correction)",
        "inputCsv": str(CSV_PATH),
        "nObs": n_obs,
        "residualBasis": "unclipped (pre-ceiling) for gated accuracy metrics",
        "overall": overall,
        "perBin": per_bin,
        "wilcoxon": wilcoxon,
        "descriptive": descriptive,
        # Top-level mirrors for the structured-output schema.
        "ceilingFlipRate": sigfig(ceiling_flip_rate),
        "nChanged": n_changed,
        "notes": (
            "Narrow-band interp blends only within +/-12% flow of each bin boundary; "
            "mid-bin obs keep their exact binned correction, so interp == binned for "
            f"{n_obs - n_changed} of {n_obs} obs. rel% = (interp-binned)/binned*100, "
            "positive => interp WORSE. Gated accuracy metrics use UNCLIPPED residuals "
            "(resUncl*); clipped MAE is descriptive only. Wilcoxon is paired two-sided "
            "on |resUnclBinned| vs |resUnclInterp| with zero-diff pairs dropped "
            "(scipy default zero_method='wilcox'). All values rounded to 4 sig figs."
        ),
    }

    OUT_PATH.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

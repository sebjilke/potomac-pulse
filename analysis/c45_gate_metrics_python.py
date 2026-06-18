#!/usr/bin/env python3
"""
C45 gate metrics, computed in Python (pandas + scipy) directly from the CSV.

Gated accuracy metrics use the UNCLIPPED residuals (resUnclBinned / resUnclInterp)
because the 120%-LF ceiling masks the largest correction differences at high flow.
Clipped residuals are used only for the descriptive clipped-MAE figures.

Outputs:
  - analysis/c45_gate_metrics_python.json  (machine-readable metrics)

All reported numbers rounded to 4 significant figures.
"""

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import wilcoxon

CSV = Path("/Users/sebjilke/Desktop/PotomacPulse/analysis/c45_gate_residuals_multi.csv")
OUT_JSON = Path("/Users/sebjilke/Desktop/PotomacPulse/analysis/c45_gate_metrics_python.json")

# Canonical flowBin order (low -> high flow)
FLOW_BIN_ORDER = [
    "0-3000",
    "3000-6000",
    "6000-12000",
    "12000-25000",
    "25000-50000",
    "50000+",
]


def sig4(x):
    """Round to 4 significant figures; pass through None/NaN as None."""
    if x is None:
        return None
    if isinstance(x, float) and math.isnan(x):
        return None
    if x == 0:
        return 0.0
    from decimal import Decimal
    d = round(x, -int(math.floor(math.log10(abs(x)))) + 3)
    return float(d)


def rel_pct(interp, binned):
    """Relative % delta: (interp - binned) / binned * 100. Positive => interp WORSE."""
    if binned == 0:
        return None
    return (interp - binned) / binned * 100.0


def main():
    df = pd.read_csv(CSV)

    cols = ["flowBin", "resUnclBinned", "resUnclInterp",
            "resClipBinned", "resClipInterp", "ceilBinned", "ceilInterp"]
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise SystemExit(f"Missing expected columns: {missing}")

    n_obs = int(len(df))

    # Absolute unclipped residuals (the gated accuracy basis)
    abs_b = df["resUnclBinned"].abs()
    abs_i = df["resUnclInterp"].abs()

    # ---- 1. OVERALL pooled (binned vs interp) ----
    def metrics(res, ares):
        return {
            "medAbs": float(ares.median()),
            "mae": float(ares.mean()),
            "rmse": float(np.sqrt((res ** 2).mean())),
        }

    m_b = metrics(df["resUnclBinned"], abs_b)
    m_i = metrics(df["resUnclInterp"], abs_i)

    overall = {
        "binnedMedAbsErr": sig4(m_b["medAbs"]),
        "interpMedAbsErr": sig4(m_i["medAbs"]),
        "medAbsErrRelPct": sig4(rel_pct(m_i["medAbs"], m_b["medAbs"])),
        "medAbsErrAbsCfs": sig4(m_i["medAbs"] - m_b["medAbs"]),

        "binnedMAE": sig4(m_b["mae"]),
        "interpMAE": sig4(m_i["mae"]),
        "maeRelPct": sig4(rel_pct(m_i["mae"], m_b["mae"])),
        "maeAbsCfs": sig4(m_i["mae"] - m_b["mae"]),

        "binnedRMSE": sig4(m_b["rmse"]),
        "interpRMSE": sig4(m_i["rmse"]),
        "rmseRelPct": sig4(rel_pct(m_i["rmse"], m_b["rmse"])),
        "rmseAbsCfs": sig4(m_i["rmse"] - m_b["rmse"]),
    }

    # ---- 2. PER flowBin ----
    per_bin = []
    bins_present = list(df["flowBin"].unique())
    ordered = [b for b in FLOW_BIN_ORDER if b in bins_present]
    # append any unexpected bins at the end so nothing is silently dropped
    ordered += [b for b in bins_present if b not in FLOW_BIN_ORDER]

    for b in ordered:
        sub = df[df["flowBin"] == b]
        ab = sub["resUnclBinned"].abs()
        ai = sub["resUnclInterp"].abs()
        med_b = float(ab.median())
        med_i = float(ai.median())
        rmse_b = float(np.sqrt((sub["resUnclBinned"] ** 2).mean()))
        rmse_i = float(np.sqrt((sub["resUnclInterp"] ** 2).mean()))
        per_bin.append({
            "flowBin": b,
            "n": int(len(sub)),
            "binnedMedAbsErr": sig4(med_b),
            "interpMedAbsErr": sig4(med_i),
            "medRelPct": sig4(rel_pct(med_i, med_b)),
            "binnedRMSE": sig4(rmse_b),
            "interpRMSE": sig4(rmse_i),
            "rmseRelPct": sig4(rel_pct(rmse_i, rmse_b)),
        })

    # ---- 3. PAIRED Wilcoxon signed-rank on |resUnclBinned| vs |resUnclInterp| ----
    # Two-sided; drop zero-difference pairs (scipy default zero_method="wilcox").
    diff = abs_b - abs_i
    n_zero = int((diff == 0).sum())
    n_nonzero = int((diff != 0).sum())
    w_stat, w_p = wilcoxon(abs_b, abs_i, alternative="two-sided")
    # Sign: is interp's |err| distribution lower than binned's?
    # median of (binned - interp): positive => binned larger => interp lower (better)
    med_diff = float(diff.median())
    mean_diff = float(diff.mean())
    interp_lower = mean_diff > 0  # mean(|binned| - |interp|) > 0 => interp smaller errors

    wilcox = {
        "statistic": sig4(float(w_stat)),
        "pValue": float(w_p),  # keep full precision for p
        "nPairs": n_obs,
        "nZeroDiffDropped": n_zero,
        "nNonzeroPairs": n_nonzero,
        "medianDiffBinnedMinusInterp": sig4(med_diff),
        "meanDiffBinnedMinusInterp": sig4(mean_diff),
        "interpLowerErr": bool(interp_lower),
    }

    # ---- 4. DESCRIPTIVE: clipped MAE + ceiling-flip rate ----
    clipped_mae = {
        "binnedClippedMAE": sig4(float(df["resClipBinned"].abs().mean())),
        "interpClippedMAE": sig4(float(df["resClipInterp"].abs().mean())),
    }
    clipped_mae["clippedMaeRelPct"] = sig4(
        rel_pct(clipped_mae["interpClippedMAE"], clipped_mae["binnedClippedMAE"])
    )
    clipped_mae["clippedMaeAbsCfs"] = sig4(
        clipped_mae["interpClippedMAE"] - clipped_mae["binnedClippedMAE"]
    )

    ceiling_flip_rate = float((df["ceilBinned"] != df["ceilInterp"]).mean())
    ceil_extra = {
        "ceilBinnedRate": sig4(float(df["ceilBinned"].mean())),
        "ceilInterpRate": sig4(float(df["ceilInterp"].mean())),
    }

    result = {
        "language": "python",
        "nObs": n_obs,
        "overall": overall,
        "perBin": per_bin,
        "wilcoxon": wilcox,
        "clippedMAE": {**clipped_mae, **ceil_extra},
        "ceilingFlipRate": sig4(ceiling_flip_rate),
        "notes": (
            "Gated accuracy metrics (overall, per-bin, Wilcoxon) use UNCLIPPED residuals "
            "(resUncl*) because the 120%-LF ceiling masks the largest correction "
            "differences at high flow. Clipped MAE and ceiling-flip rate are descriptive only. "
            "Relative % = (interp - binned)/binned*100; positive = interp WORSE. "
            "Wilcoxon two-sided, paired, zero-diff pairs dropped (scipy default). "
            "interpLowerErr = mean(|binned| - |interp|) > 0. "
            "All numbers rounded to 4 sig figs except p-value (full precision)."
        ),
    }

    OUT_JSON.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

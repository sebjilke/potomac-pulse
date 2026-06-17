#!/usr/bin/env python3
"""
v36.1 corrected-residual CI derivation — PYTHON implementation.

Implements analysis/ci_v361_derivation_spec.md end-to-end, results-blind
(independent of the parallel R implementation).

Key correctness points:
  - The quantity quantiled is the `residual` column (= predictedCFS - actualLF,
    the CORRECTED, post-ceiling residual). NOT rawResidual.
  - Quantiles use numpy default method='linear' (type-7 / linear interpolation),
    so the independent R run (quantile type=7) matches within <0.01.
  - Burn-in keeps rows with binCountAtPred >= B (primary B=30).
  - Cells = 18 (flowBin x flowState) + 6 pooled `all`-state per flowBin = 24 rows.
  - Fallback (MIN_OBS=250): cell -> bin-all -> insufficient; NEVER borrow a
    global pool for a high-flow cell.
  - Ceiling sensitivity: n_ceiling, q95_noceiling (q95 on ceilingApplied==0 subset).
  - Moving-block bootstrap (L=24, Bboot=1000, seed=12345) for q05/q95 CIs
    (diagnostic, NOT agreement-gated). Rows ordered by predTs within each cell.
  - Era buckets for rolling: predTs split into three ~equal-width calendar spans.
"""

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
MULTI_PATH = "analysis/ci_residuals_v361_multi.csv"
SINGLE_PATH = "analysis/ci_residuals_v361_single.csv"

OUT_PRIMARY = "analysis/ci_v361_python.csv"
OUT_SENS = "analysis/ci_v361_python_sensitivity.csv"
OUT_SINGLE = "analysis/ci_v361_python_single.csv"
OUT_ROLLING = "analysis/ci_v361_python_rolling.csv"

B_PRIMARY = 30
B_SENS = [20, 30, 50, 75]
MIN_OBS = 250

L_BLOCK = 24
BBOOT = 1000
SEED = 12345

# Canonical ordering for the 24-row table: each flowBin in ascending flow order,
# and within each bin: rising, steady, falling, all.
FLOWBIN_ORDER = ["0-3000", "3000-6000", "6000-12000",
                 "12000-25000", "25000-50000", "50000+"]
STATE_ORDER = ["rising", "steady", "falling", "all"]

QUANTILE_LEVELS = {
    "q05": 0.05, "q10": 0.10, "q25": 0.25, "q50": 0.50,
    "q75": 0.75, "q90": 0.90, "q95": 0.95,
}

# numpy 2.x renamed the keyword `interpolation` -> `method`; method='linear'
# is the default and equals R quantile type=7. We pass it explicitly to be safe.
QMETHOD = "linear"


def q(values, p):
    """Quantile with explicit linear interpolation (type-7). Returns NaN if empty."""
    arr = np.asarray(values, dtype=float)
    if arr.size == 0:
        return np.nan
    return float(np.quantile(arr, p, method=QMETHOD))


# ---------------------------------------------------------------------------
# Cell-level statistics on the CORRECTED residual
# ---------------------------------------------------------------------------
def cell_stats(sub):
    """Compute deterministic stats for one cell's rows (a DataFrame slice)."""
    r = sub["residual"].to_numpy(dtype=float)
    out = {
        "n": int(r.size),
        "mean": float(np.mean(r)) if r.size else np.nan,
        "median": float(np.median(r)) if r.size else np.nan,
    }
    for name, p in QUANTILE_LEVELS.items():
        out[name] = q(r, p)
    # Ceiling sensitivity
    n_ceiling = int((sub["ceilingApplied"] == 1).sum())
    noceil = sub.loc[sub["ceilingApplied"] == 0, "residual"].to_numpy(dtype=float)
    out["n_ceiling"] = n_ceiling
    out["q95_noceiling"] = q(noceil, 0.95)
    return out


# ---------------------------------------------------------------------------
# Moving-block bootstrap for q05/q95 CIs (diagnostic, not gated)
# ---------------------------------------------------------------------------
def block_bootstrap_ci(sub):
    """
    Moving-block bootstrap on the corrected residual, ordered by predTs.
    L=24 consecutive rows, Bboot=1000 resamples, seed=12345.
    Returns (q05_lo, q05_hi, q95_lo, q95_hi, eff_n).
    """
    ordered = sub.sort_values("predTs", kind="mergesort")
    r = ordered["residual"].to_numpy(dtype=float)
    n = r.size
    eff_n = n // L_BLOCK
    if n == 0:
        return (np.nan, np.nan, np.nan, np.nan, 0)

    rng = np.random.default_rng(SEED)
    # All possible block start positions (overlapping moving blocks).
    n_starts = n - L_BLOCK + 1
    if n_starts < 1:
        # Fewer rows than one full block: a single block is the whole series.
        n_starts = 1
        block_len = n
    else:
        block_len = L_BLOCK
    # Number of blocks needed to cover ~n rows.
    n_blocks = int(np.ceil(n / block_len))

    q05_samples = np.empty(BBOOT)
    q95_samples = np.empty(BBOOT)
    for b in range(BBOOT):
        starts = rng.integers(0, n_starts, size=n_blocks)
        idx = (starts[:, None] + np.arange(block_len)[None, :]).ravel()
        idx = idx[idx < n][:n]
        resample = r[idx]
        q05_samples[b] = np.quantile(resample, 0.05, method=QMETHOD)
        q95_samples[b] = np.quantile(resample, 0.95, method=QMETHOD)

    return (
        float(np.quantile(q05_samples, 0.025, method=QMETHOD)),
        float(np.quantile(q05_samples, 0.975, method=QMETHOD)),
        float(np.quantile(q95_samples, 0.025, method=QMETHOD)),
        float(np.quantile(q95_samples, 0.975, method=QMETHOD)),
        int(eff_n),
    )


# ---------------------------------------------------------------------------
# Build the per-cell raw stats dict keyed by (flowBin, flowState) including 'all'
# ---------------------------------------------------------------------------
def compute_raw_cells(dfb, with_bootstrap=False):
    """
    dfb = burn-in-filtered DataFrame.
    Returns a dict keyed (flowBin, flowState) -> stats dict, for all 18
    (bin,state) cells + 6 (bin,'all') pooled cells. Missing combinations get
    an n=0 entry so the table always has 24 rows.
    """
    cells = {}
    for fb in FLOWBIN_ORDER:
        bin_df = dfb[dfb["flowBin"] == fb]
        # The six (bin, state) cells
        for st in ["rising", "steady", "falling"]:
            sub = bin_df[bin_df["flowState"] == st]
            stats = cell_stats(sub)
            if with_bootstrap:
                lo5, hi5, lo95, hi95, eff = block_bootstrap_ci(sub)
                stats.update(q05_ci_lo=lo5, q05_ci_hi=hi5,
                             q95_ci_lo=lo95, q95_ci_hi=hi95, eff_n=eff)
            cells[(fb, st)] = stats
        # The pooled (bin, 'all') cell
        stats_all = cell_stats(bin_df)
        if with_bootstrap:
            lo5, hi5, lo95, hi95, eff = block_bootstrap_ci(bin_df)
            stats_all.update(q05_ci_lo=lo5, q05_ci_hi=hi5,
                             q95_ci_lo=lo95, q95_ci_hi=hi95, eff_n=eff)
        cells[(fb, "all")] = stats_all
    return cells


# ---------------------------------------------------------------------------
# Apply fallback (source) logic and assemble the final 24-row table
# ---------------------------------------------------------------------------
def assemble_table(cells, with_bootstrap=False):
    """
    cells = dict from compute_raw_cells. Applies S-F9 fallback:
      - (bin,state): n>=250 -> 'cell'; elif bin-'all' n>=250 -> 'bin-all'; else 'insufficient'.
      - (bin,'all'): always 'cell'.
    For 'bin-all' fallback, the reported deterministic quantile/stat columns are
    BORROWED from the bin-'all' row; n and the ceiling counts stay the cell's own
    (they describe the actual cell), per spec which only redirects the *quantiles*.
    Returns a DataFrame in canonical order.
    """
    # Columns whose values are the quantile lookup (borrowed under bin-all fallback).
    QUANT_COLS = ["mean", "median", "q05", "q10", "q25", "q50",
                  "q75", "q90", "q95", "q95_noceiling"]
    boot_cols = ["q05_ci_lo", "q05_ci_hi", "q95_ci_lo", "q95_ci_hi", "eff_n"]

    rows = []
    for fb in FLOWBIN_ORDER:
        bin_all = cells[(fb, "all")]
        for st in STATE_ORDER:
            cell = cells[(fb, st)]
            n = cell["n"]
            if st == "all":
                source = "cell"
                quant_src = cell
            else:
                if n >= MIN_OBS:
                    source = "cell"
                    quant_src = cell
                elif bin_all["n"] >= MIN_OBS:
                    source = "bin-all"
                    quant_src = bin_all
                else:
                    source = "insufficient"
                    quant_src = cell  # report own quantiles for reference; flagged

            row = {
                "flowBin": fb,
                "flowState": st,
                "n": n,
                "source": source,
            }
            for c in QUANT_COLS:
                row[c] = quant_src[c]
            # n_ceiling describes the actual cell, not the borrowed source.
            row["n_ceiling"] = cell["n_ceiling"]
            if with_bootstrap:
                # Bootstrap CIs are diagnostic and describe the cell's own data.
                for c in boot_cols:
                    row[c] = cell[c]
            rows.append(row)

    df = pd.DataFrame(rows)
    # Reorder columns to spec.
    base = ["flowBin", "flowState", "n", "source", "mean", "median",
            "q05", "q10", "q25", "q50", "q75", "q90", "q95",
            "n_ceiling", "q95_noceiling"]
    if with_bootstrap:
        base += ["q05_ci_lo", "q05_ci_hi", "q95_ci_lo", "q95_ci_hi", "eff_n"]
    return df[base]


# ---------------------------------------------------------------------------
# Era-bucketed rolling stability (q05/q95 over three equal-width predTs spans)
# ---------------------------------------------------------------------------
def compute_rolling(dfb):
    """
    Split predTs into three ~equal-width calendar spans (equal time-width, not
    equal-count). For each (bin,state) and (bin,'all') cell, report n/q05/q95
    per era.
    """
    ts = pd.to_datetime(dfb["predTs"], utc=True)
    tmin, tmax = ts.min(), ts.max()
    edges = [tmin + (tmax - tmin) * frac for frac in (0.0, 1 / 3, 2 / 3, 1.0)]
    era_label = pd.Series(index=dfb.index, dtype=object)
    # Era 1: [e0,e1), Era 2: [e1,e2), Era 3: [e2,e3] (inclusive top edge).
    era_label[(ts >= edges[0]) & (ts < edges[1])] = "era1"
    era_label[(ts >= edges[1]) & (ts < edges[2])] = "era2"
    era_label[(ts >= edges[2]) & (ts <= edges[3])] = "era3"

    era_bounds = {
        "era1": (edges[0], edges[1]),
        "era2": (edges[1], edges[2]),
        "era3": (edges[2], edges[3]),
    }

    work = dfb.copy()
    work["era"] = era_label.values

    rows = []
    for fb in FLOWBIN_ORDER:
        bin_df = work[work["flowBin"] == fb]
        for st in STATE_ORDER:
            sub = bin_df if st == "all" else bin_df[bin_df["flowState"] == st]
            for era in ("era1", "era2", "era3"):
                esub = sub[sub["era"] == era]
                r = esub["residual"].to_numpy(dtype=float)
                rows.append({
                    "flowBin": fb,
                    "flowState": st,
                    "era": era,
                    "era_start": era_bounds[era][0].isoformat(),
                    "era_end": era_bounds[era][1].isoformat(),
                    "n": int(r.size),
                    "q05": q(r, 0.05),
                    "q50": q(r, 0.50),
                    "q95": q(r, 0.95),
                })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Sensitivity table: cells x B in {20,30,50,75}, columns q05,q95,n
# ---------------------------------------------------------------------------
def compute_sensitivity(df_full):
    rows = []
    for B in B_SENS:
        dfb = df_full[df_full["binCountAtPred"] >= B]
        cells = compute_raw_cells(dfb, with_bootstrap=False)
        for fb in FLOWBIN_ORDER:
            for st in STATE_ORDER:
                c = cells[(fb, st)]
                rows.append({
                    "burn_in": B,
                    "flowBin": fb,
                    "flowState": st,
                    "n": c["n"],
                    "q05": c["q05"],
                    "q95": c["q95"],
                })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------
def process_file(path, label, B, with_bootstrap):
    df_full = pd.read_csv(path)
    n_total = len(df_full)
    dfb = df_full[df_full["binCountAtPred"] >= B].copy()
    n_burn = len(dfb)
    print(f"[{label}] total rows: {n_total}")
    print(f"[{label}] after burn-in (binCountAtPred >= {B}): {n_burn} "
          f"(dropped {n_total - n_burn})")
    cells = compute_raw_cells(dfb, with_bootstrap=with_bootstrap)
    table = assemble_table(cells, with_bootstrap=with_bootstrap)
    return df_full, dfb, table


def main():
    print("=" * 78)
    print("v36.1 corrected-residual CI — PYTHON")
    print(f"Quantile method: numpy method='{QMETHOD}' (type-7 / linear interpolation)")
    print("Quantity quantiled: `residual` (= predictedCFS - actualLF, CORRECTED)")
    print("=" * 78)

    # ---- PRIMARY: multi, B=30, with bootstrap ----
    print("\n--- PRIMARY (multi-pending, B=30) ---")
    df_multi_full, df_multi_b, primary = process_file(
        MULTI_PATH, "multi", B_PRIMARY, with_bootstrap=True)
    primary.to_csv(OUT_PRIMARY, index=False)
    print(f"Wrote {OUT_PRIMARY}")

    # ---- SENSITIVITY: multi, B in {20,30,50,75} ----
    print("\n--- SENSITIVITY (multi, B in {20,30,50,75}) ---")
    sens = compute_sensitivity(df_multi_full)
    sens.to_csv(OUT_SENS, index=False)
    print(f"Wrote {OUT_SENS}  ({len(sens)} rows)")

    # ---- SINGLE: single-pending, B=30, with bootstrap ----
    print("\n--- SINGLE (single-pending, B=30) ---")
    df_single_full, df_single_b, single = process_file(
        SINGLE_PATH, "single", B_PRIMARY, with_bootstrap=True)
    single.to_csv(OUT_SINGLE, index=False)
    print(f"Wrote {OUT_SINGLE}")

    # ---- ROLLING: era buckets on multi B=30 ----
    print("\n--- ROLLING (era buckets, multi B=30) ---")
    rolling = compute_rolling(df_multi_b)
    rolling.to_csv(OUT_ROLLING, index=False)
    print(f"Wrote {OUT_ROLLING}  ({len(rolling)} rows)")

    # ---- stdout summary ----
    print("\n" + "=" * 78)
    print("PRIMARY 24-ROW TABLE (multi, B=30)")
    print("=" * 78)
    show = primary[["flowBin", "flowState", "n", "source", "mean",
                    "q05", "q50", "q95", "n_ceiling", "q95_noceiling"]].copy()
    with pd.option_context("display.max_rows", None, "display.width", 200,
                           "display.float_format", lambda v: f"{v:,.1f}"):
        print(show.to_string(index=False))

    insufficient = primary[primary["source"] == "insufficient"]
    binall = primary[primary["source"] == "bin-all"]
    print("\n--- Fallback summary ---")
    if len(binall):
        print("source='bin-all' cells:")
        print(binall[["flowBin", "flowState", "n"]].to_string(index=False))
    else:
        print("source='bin-all' cells: none")
    if len(insufficient):
        print("source='insufficient' cells:")
        print(insufficient[["flowBin", "flowState", "n"]].to_string(index=False))
    else:
        print("source='insufficient' cells: none")

    # ---- Sanity checks ----
    print("\n--- Sanity checks ---")
    # q05 < q50 < q95 in every cell (using reported quantiles)
    ok_order = ((primary["q05"] <= primary["q50"]) &
                (primary["q50"] <= primary["q95"])).all()
    print(f"q05<=q50<=q95 in every row: {ok_order}")
    # steady-cell means near zero, rising/falling non-zero
    print("Per (bin,state) corrected-residual means (should be ~0 for steady, "
          "non-zero for rising/falling):")
    means = primary[primary["flowState"].isin(["rising", "steady", "falling"])]
    print(means.pivot(index="flowBin", columns="flowState",
                      values="mean").reindex(FLOWBIN_ORDER)
          [["rising", "steady", "falling"]]
          .to_string(float_format=lambda v: f"{v:,.1f}"))

    # ---- Single vs multi high-flow deltas ----
    print("\n--- Single vs multi high-flow q05/q95 deltas ---")
    for fb in ["25000-50000", "50000+"]:
        for st in ["rising", "steady", "falling", "all"]:
            pm = primary[(primary.flowBin == fb) & (primary.flowState == st)].iloc[0]
            ps = single[(single.flowBin == fb) & (single.flowState == st)].iloc[0]
            print(f"{fb:>12}/{st:<8} "
                  f"multi q05={pm.q05:>10,.1f} q95={pm.q95:>10,.1f} (n={pm.n}, src={pm.source}) | "
                  f"single q05={ps.q05:>10,.1f} q95={ps.q95:>10,.1f} (n={ps.n}, src={ps.source}) | "
                  f"dq05={pm.q05-ps.q05:>+9,.1f} dq95={pm.q95-ps.q95:>+9,.1f}")


if __name__ == "__main__":
    main()

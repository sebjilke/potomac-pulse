# v36.1 corrected-residual CI — derivation spec (shared by the blind Python & R implementations)

Both the Python and R implementations follow THIS spec exactly and independently (results-blind).
The deterministic outputs must agree across languages within **< 0.01** absolute (fail-fast otherwise).

## Inputs
- Primary: `analysis/ci_residuals_v361_multi.csv` (multi-pending; the shippable table).
- Guardrail: `analysis/ci_residuals_v361_single.csv` (single-pending; S-F3 comparison).
Both have the SAME columns (one row per validated, non-hard-flagged prediction):
`predTs,valTs,rawFinalCFS,predictedCFS,correction,flowBin,flowState,actualLF,residual,rawResidual,ceilingApplied,isSoftFlagged,binCountAtPred`

- **`residual` = predictedCFS − actualLF** = the CORRECTED residual `r` (post-ceiling; what is displayed). THIS is the quantity we take quantiles of.
- `flowBin` ∈ {`0-3000`,`3000-6000`,`6000-12000`,`12000-25000`,`25000-50000`,`50000+`}; `flowState` ∈ {`rising`,`steady`,`falling`}. These are the MODEL'S OWN output — the exact lookup key the application uses.
- `binCountAtPred` = how many obs the correction bin had learned when this prediction was made (for burn-in).
- `ceilingApplied` ∈ {0,1}; `isSoftFlagged` ∈ {0,1}.

## Process each input file independently and emit a table

### 1. Burn-in filter (primary B = 30)
Keep rows with `binCountAtPred >= 30`. (The correction applied was under-converged below this; excluding trims the prequential transient.) Also emit the table for B ∈ {20, 50, 75} as a sensitivity (a `burn_in` column or one file per B — your choice, but label clearly).

### 2. Cells
The 18 cells = every (`flowBin`,`flowState`) pair, PLUS 6 pooled `all`-state rows per `flowBin` (flowState label = `all`, pooling that bin's rising+steady+falling after burn-in). 24 rows total per table.

### 3. Quantiles (deterministic — these are the agreement-gated numbers)
For each cell, on the `residual` values, compute: **q05, q10, q25, q50, q75, q90, q95**, plus `mean`, `median`, `n`.
- **Quantile method: linear interpolation = numpy `method='linear'` (the default) = R `quantile(..., type = 7)` (the default).** State this explicitly. Both languages MUST use type-7/linear so they match.

### 4. Fallback source (MIN_OBS = 250) — S-F9
- If a (bin,state) cell has `n >= 250` → `source = "cell"`, use its own quantiles.
- Else if that bin's pooled `all` row has `n >= 250` → `source = "bin-all"`, use the bin-`all` quantiles for that cell.
- Else → `source = "insufficient"` (report the cell's own quantiles for reference but DO NOT borrow the global pool — high-flow scale differs by orders of magnitude). Flag it.
- The `all` rows themselves always use their own quantiles (`source = "cell"`).

### 5. Ceiling sensitivity (S-F5)
For each cell also report: `n_ceiling` (count of rows with `ceilingApplied==1`), and **`q95_noceiling`** = q95 computed on the subset with `ceilingApplied==0`. (The ceiling censors overestimates → may bias q95.)

### 6. Block bootstrap on q05 & q95 (S-F1) — diagnostic, NOT agreement-gated
Hourly residuals are autocorrelated; i.i.d. quantile CIs understate uncertainty. Use a **moving-block bootstrap**: block length **L = 24** consecutive rows (in `predTs` order within the cell), resamples **Bboot = 1000**, seed = 12345. Report `q05_ci_lo,q05_ci_hi,q95_ci_lo,q95_ci_hi` = the 2.5/97.5 percentiles of the bootstrap quantile distribution. Also report `eff_n = floor(n / L)` (a crude effective-sample-size proxy). (RNG differs across languages → bootstrap columns are NOT part of the <0.01 check, but should be broadly similar.)

### 7. Diagnostics (report, not gated)
- Per-cell `mean`, `median` already included (S-F2 — confirm the residuals are NOT mean-zero in transient cells).
- Rolling stability (S-F8): for each cell, q05/q95 computed on three ~equal-width `predTs` era buckets (e.g. 2011–2016, 2016–2021, 2021–2026). Emit to a separate `*_rolling.csv`. If a cell's eras swing wildly, note it.

## Outputs (write all to analysis/)
- `ci_v361_python.csv` / `ci_v361_R.csv` — the PRIMARY (multi, B=30) table: columns
  `flowBin,flowState,n,source,mean,median,q05,q10,q25,q50,q75,q90,q95,n_ceiling,q95_noceiling,q05_ci_lo,q05_ci_hi,q95_ci_lo,q95_ci_hi,eff_n`.
- `ci_v361_python_sensitivity.csv` / `_R_sensitivity.csv` — same cells × B ∈ {20,30,50,75} (q05,q95,n only).
- `ci_v361_python_single.csv` / `_R_single.csv` — the single-pending table (multi-format, B=30) for the S-F3 comparison.
- `ci_v361_python_rolling.csv` / `_R_rolling.csv` — the era-bucketed q05/q95.
- Print to stdout a compact summary: rows, the primary 24-row table, and any `insufficient` cells.

## Hard rules
- No silent row drops beyond the explicit burn-in / hard-flag(already excluded upstream) filters. Report counts at each filter step.
- Deterministic columns (n, mean, median, all q*, q95_noceiling, n_ceiling) must match Python vs R < 0.01. If they don't, STOP and report the discrepancy — do not paper over it.

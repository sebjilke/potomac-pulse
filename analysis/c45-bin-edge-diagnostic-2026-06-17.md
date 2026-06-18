# C45 Bin-Edge Discontinuity Diagnostic

**Date:** 2026-06-17
**Status:** Diagnostic only (read-only). NOT a design or plan for the C45 fix — that stays deferred to a
dedicated session under the full plan-first + independent-auditor cycle. This document is the *input* to
that plan.
**Verification:** Live data pulled from production Supabase; jump table computed **blind in Python and R**
(agreement exact, max discrepancy 0.0 cfs); independent auditor re-derived ≥8 cells by hand — verdict
**PASS**. Provenance in the last section.

## 1. What was measured and why

The learned EMA correction is applied as a **step function**:

```
correctedEstimate = rawEstimate − getGFCorrection(correctionBins, flowBin, flowState)
```

`flowBin` comes from hard cutoffs (3k / 6k / 12k / 25k / 50k cfs) and `flowState` is a 3-way categorical
(rising / steady / falling). Both are discrete, so the applied correction — and therefore the *displayed*
estimate — jumps discontinuously whenever the model crosses a flow-bin edge or flips trend state. C45 is
the proposal to smooth those jumps.

The display discontinuity at any edge equals the **difference in effective corrections** across it
(`rawEstimate` is ~continuous at the edge). "Effective correction" = the value `getGFCorrection` actually
returns, i.e. *after* the hierarchical fallback (count ≥ 5 → raw EMA; count < 5 → `(count/5)·ownEMA +
(1−count/5)·fallback`, where fallback = in-bin count-weighted mean of cells with count ≥ 5, else a
neighbor-bin same-state/steady cell, else 0). Measuring the raw EMAs alone would misstate what users see.

## 2. Live learning state (snapshot 2026-06-17, 145 total obs)

Only **13 of 18** (bin × state) cells exist; **7** have count ≥ 5 (the threshold for a cell to be used
directly without fallback blending). Missing: `0-3000_falling`, `12000-25000_steady`, and the **entire
`50000+` bin** (all three states).

### Effective corrections (cfs subtracted from the raw estimate)

| flow bin | rising | steady | falling |
|---|---|---|---|
| 0–3000 | 120.0 ᶠ (c1) | 450.0 ᶠ (c2) | 356.8 ᶠ (c0→steady) |
| 3000–6000 | 741.4 ᶠ (c4) | **600.5** (c27) | **445.1** (c13) |
| 6000–12000 | **−694.1** ᶠ (c3) | 423.7 ᶠ (c1) | **401.2** (c17) |
| 12000–25000 | 218.8 ᶠ (c2) | 208.7 ᶠ (c0) | **208.7** (c18) |
| 25000–50000 | **3272.8** (c13) | **2335.9** (c15) | **184.6** (c29) |
| 50000+ | 3272.8 ᶠ (c0) | 2335.9 ᶠ (c0) | 184.6 ᶠ (c0) |

Bold = cell has count ≥ 5 (well-learned, used directly). ᶠ = fallback/blend was used (own count < 5).
`cN` = the cell's own observation count. The `50000+` row is inherited wholesale from `25000-50000` via
neighbor fallback (its own bin is empty).

## 3. Discontinuity tables

### Flow-bin edge jumps `|corr(below) − corr(above)|`

| boundary | rising | steady | falling |
|---|---|---|---|
| 3000 | 621.4 | 150.5 | 88.3 |
| 6000 | **1435.5** | 176.8 | 43.9 ✓ |
| 12000 | 912.9 | 215.0 | 192.4 ✓ |
| 25000 | **3054.0** | **2127.1** | 24.2 ✓ |
| 50000 | 0.0 | 0.0 | 0.0 |

✓ = both sides count ≥ 5 (a real jump between two learned corrections). All un-ticked values have a
sparse/fallback cell on at least one side.

### Trend state-flip jumps within a bin

| flow bin | rising↔steady | steady↔falling | rising↔falling |
|---|---|---|---|
| 0–3000 | 330.0 | 93.3 | 236.8 |
| 3000–6000 | 140.9 | 155.4 | 296.3 |
| 6000–12000 | 1117.8 | 22.6 | 1095.2 |
| 12000–25000 | 10.1 | 0.0 | 10.1 |
| 25000–50000 | **937.0** ✓ | **2151.3** ✓ | **3088.3** ✓ |
| 50000+ | 937.0 | 2151.3 | 3088.3 |

### Top 10 discontinuities (either kind), ranked

| # | kind | where | jump (cfs) | data-backed |
|---|---|---|---|---|
| 1 | state flip | 25000–50000 rising↔falling | 3088.3 | **yes** |
| 2 | state flip | 50000+ rising↔falling (inherited) | 3088.3 | no |
| 3 | flow edge | 25000, rising (218.8 vs 3272.8) | 3054.0 | no |
| 4 | state flip | 25000–50000 steady↔falling | 2151.3 | **yes** |
| 5 | state flip | 50000+ steady↔falling (inherited) | 2151.3 | no |
| 6 | flow edge | 25000, steady (208.7 vs 2335.9) | 2127.1 | no |
| 7 | flow edge | 6000, rising (741.4 vs −694.1) | 1435.5 | no |
| 8 | state flip | 6000–12000 rising↔steady | 1117.8 | no |
| 9 | state flip | 6000–12000 rising↔falling | 1095.2 | no |
| 10 | state flip | 25000–50000 rising↔steady | 937.0 | **yes** |

Only **3** of the top 10 are data-backed — all three are the trend-state flips inside `25000-50000`.

## 4. Findings (descriptive — no fix proposed)

1. **The biggest current discontinuity is ~3,090 cfs, not ~1,400.** The handoff's motivating "~1,400 cfs"
   figure maps specifically to the **6000-boundary rising edge (1435.5 cfs)** — but that one is a
   **fallback artifact**: both adjacent rising cells have count < 5 (4 and 3), and the high side carries
   the dataset's only negative EMA (`6000-12000_rising = −1424.2`, from just 3 samples, blended to −694.1).
   It is real in today's output but is driven by a 3-sample cell, not a stable learned correction.

2. **The only large, well-learned discontinuities are trend-state flips in the high-flow bin
   (`25000-50000`).** Rising corrects +3272.8, steady +2335.9, falling +184.6 — all backed by ≥13 obs.
   This is a genuine learned signal: at high flow the raw model's bias depends strongly on whether the
   river is rising vs falling. Jumps of 3088 / 2151 / 937 cfs between those states are real.

3. **Data-backed *flow-edge* jumps are all small (≤ 192 cfs).** Every flow-bin boundary jump where both
   sides have count ≥ 5 is tiny: 6000-falling 43.9, 12000-falling 192.4, 25000-falling 24.2. The large
   edge jumps (6000-rising 1435, 25000-rising 3054, 25000-steady 2127) all have a sparse/fallback cell on
   one side — they are artifacts of one side falling back to a neighbor while the other carries a real
   large EMA, **not** discontinuities between two well-learned bins.

4. **`50000+` is empty and inherits `25000-50000` wholesale.** This makes the 50000 boundary perfectly
   seamless (all jumps 0.0) and produces duplicate state-flip entries (3088/2151/937) that are *not*
   independently data-backed. Don't double-count them as evidence.

### What this implies for the C45 design session

C45 as currently framed — "smooth the applied correction *between* existing flow/state bins" — targets
flow-bin **edge** jumps. But under current data the data-backed edge jumps are negligible (≤ 192 cfs); the
large edge jumps are a **data-sparsity** symptom, which interpolation would paper over rather than fix
(more obs or a better fallback would address it). Meanwhile the genuinely large, real discontinuities live
on the **trend-state axis** (rising/steady/falling within a bin), which between-flow-bin smoothing does not
touch — and which a naive smoother could *blur*, destroying the real high-flow trend signal. The future
plan should decide deliberately which axis to smooth and protect the data-backed `25000-50000` state
dependence. This is a flag, not a recommendation.

## 5. Caveats

- **Snapshot in time.** 145 obs as of 2026-06-17; 5 cells empty, 6 more have count < 5. The picture will
  shift as bins fill — re-run this diagnostic before the C45 plan if significant time has passed.
- The `usedFallback` flag is on the cell's **own** count, so cells that internally substituted the steady
  cell (e.g. `0-3000_falling`) are flagged fallback even though they blended a real steady value.
- The `6000-12000_rising = −1424.2` cell is sign-opposite to every other correction and rests on 3
  samples; it alone drives 4 of the top-9 jumps. Treat it as a likely transient outlier, not structure.

## 6. Provenance

- **Live data:** `select gauge_id, data from potomac_observations where observation_type =
  'gf_correction_bin'` — Supabase project "potomac forecast" (`sabbonifrduiunuebxzf`). 24 rows (13 GF
  correction cells + 11 `stage_*` cells, the latter excluded).
- **Computation:** blind dual-language workflow (run `wf_2f785fa5-9e5`): Python (`/tmp/c45_jump.py`) and R
  (`/tmp/c45.R`) independently reimplemented `getGFCorrection` from spec; agreement exact (max discrepancy
  0.0 cfs). Independent auditor re-derived 8 cells by hand against raw values — verdict PASS.
- **Mechanism source:** `src/model/shared-model.js` (`getGFFlowBin`, `getGFCorrection`,
  `getFallbackCorrection`, `applyGFCorrection`); byte-identical server copy in
  `netlify/functions/shared/model.js`.

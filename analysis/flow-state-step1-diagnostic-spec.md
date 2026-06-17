# Step-1 Label-Only Diagnostic — Spec (blind dual-language)

**Date:** 2026-06-17
**Parent plan:** `analysis/flow-state-gate-redesign-plan-2026-06-17.md` §9.2 Step 1.
**Purpose:** Answer ONE question, cheaply and with NO model change, before any A/B:
**does the parcel-aligned flow-state label explain more raw-residual variance / yield tighter
within-bin residuals than the current-T0 label the model uses today?** Under a lag-sensitivity
sweep (so a wrong travel time cannot fake or hide the effect).

This is an identifiability check (audit F1) with travel-time robustness built in (audit F2). It is
implemented **blind** in Python and R; the deterministic metrics must agree < 0.01 or we fail-fast.

---

## Inputs (read-only; provenance)

1. `analysis/hourly_backtest_data_v361.csv` — hourly series, UTC. Columns used:
   `timestamp` ("YYYY-MM-DD HH:MM", UTC), `por_now` (current PoR cfs), `travel_time_h` (per-hour
   PoR→GF lag). 126,916 rows. Some `por_now` may be blank → drop those rows for the series.
2. `analysis/ci_residuals_v361_multi.csv` — one row per validated backtest prediction (110,290).
   Columns used: `predTs` (ISO UTC "…Z"), `rawResidual` (= rawFinalCFS − actualLF; the model's RAW
   error — the learning target), `flowBin`, `flowState` (the CURRENT-T0 label the model used).

Join key: floor both timestamps to the UTC hour. `predTs` "2011-12-01T05:00:00.000Z" ↔ series
`timestamp` "2011-12-01 05:00".

## Classifier — reimplement EXACTLY the server `getFlowState` (shared/model.js:114-140)

```
flowStateAsOf(series, refTime):
    hist   = series rows with ts <= refTime, ascending           # the available history "as of" refTime
    if len(hist) < 8: return 'steady'
    current = por_now of the row with the largest ts <= refTime   # nearest on-or-before
    past    = por_now of the row with the largest ts <= refTime - 6h
    if past is None: return 'steady'
    change = current - past
    thr    = max(100, 0.02 * current)
    if abs(change) >= thr: return 'rising' if change > 0 else 'falling'
    return 'steady'
```

Use the full `por_now` series (sorted, blanks dropped). 6h = 6 hourly steps by TIME, not by index
(use the timestamp, not row offset — there are DST/gap irregularities).

## Arms (labelings of each prediction row)

- `A_current`   = flowStateAsOf(series, predTs)
- `Parcel_L{k}` for k ∈ {6, 12, 18, 24, 30, 36} = flowStateAsOf(series, predTs − k h)
- `Parcel_model` = flowStateAsOf(series, predTs − travel_time_h(predTs) h)   # data-provenanced nominal lag

## Self-validation (classifier faithfulness)

Report `label_match_rate` = fraction of rows where `A_current` (reimplemented) == logged `flowState`.
Expect high (≥ ~0.95). If low, the reimplementation is wrong — STOP and report, do not proceed to
conclusions. (This is the guard that the parcel labels are computed by a faithful classifier.)

## Metrics (on `rawResidual` r over the joined sample)

For a labeling, KEY = (flowBin, state). Deterministic metrics (THE agreement gate):

1. `eta2_full`  = 1 − SS_within/SS_total. SS_total = Σ(r−mean r)²; SS_within = Σ_groups Σ(r−group_mean)².
2. `within_var` = SS_within / N  (mean squared within-group residual — what the EMA fits against; LOWER is better).
3. `within_bin_state_eta2` = variance explained by STATE *within* flowBin, pooled across flowBins
   (hold flowBin fixed: Σ_bin SS_between_states / Σ_bin SS_total_bin).
4. Occupancy: n per state (rising/steady/falling) and `rising_mean_resid` (mean r among rising-labeled rows).

Primary comparison — `A_current` vs each parcel arm:
- `delta_within_var` = within_var[A_current] − within_var[arm]   (> 0 ⇒ parcel labeling tightens residuals ⇒ better).
- Block bootstrap (robustness, autocorrelation-aware): d_i = (r_i − groupmean_A(i))² − (r_i − groupmean_arm(i))².
  Non-overlapping consecutive 48-row blocks (≈2 days), resample block indices with replacement,
  B=1000, **seed = 20260617**. Report `boot_mean_d`, `boot_ci_lo`, `boot_ci_hi` (2.5/97.5 pctile).
  "Parcel wins" ⇔ ci_lo > 0.

## Output (each language writes its OWN file; do NOT read the other's)

`analysis/flow_state_step1_python.csv` and `analysis/flow_state_step1_R.csv`, one row per arm:
`arm, lag_h, n, eta2_full, within_var, within_bin_state_eta2, rising_n, steady_n, falling_n,
rising_mean_resid, label_match_rate, delta_within_var, boot_mean_d, boot_ci_lo, boot_ci_hi`
(`label_match_rate` only on A_current; `delta_*`/`boot_*` only on parcel arms.)

Also print a one-paragraph stdout summary: match rate, and for each parcel arm whether it reduces
within_var vs A_current and whether the bootstrap CI excludes 0.

## Agreement gate (fail-fast)

Deterministic metrics (`eta2_full`, `within_var`, `within_bin_state_eta2`, occupancy, `rising_mean_resid`,
`label_match_rate`, `delta_within_var`) must agree between Python and R to < 0.01 (absolute for
eta2/rates; relative for variances). Bootstrap CIs are stochastic — only the QUALITATIVE verdict
(CI excludes 0 or not) must match. If deterministic metrics diverge ≥ 0.01, STOP and investigate.

## Interpretation (decided AFTER results, not here)

- Parcel labeling **materially** reduces within_var (CI excludes 0) across a BROAD lag range ⇒ the
  misalignment matters; proceed to Step 2 (source-seam A/B).
- Effect only at a knife-edge lag, or CI includes 0, or |Δ| is trivially small ⇒ **null**: record that
  the misalignment is empirically immaterial at realized lags; do NOT build the A/B.

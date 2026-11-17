# Analysis specification for the two blind analysts (Python and R)

Written by the orchestrator on 2026-11-18 (UTC), after the tool audit (`TOOL_AUDIT.md`) and BEFORE any result
was computed or seen. It makes the pre-registration in `PLAN.md` operational. Both analysts work from this file
only. Neither sees the other's code or output. Neither applies the decision rule; they report numbers.

All input files are in this folder and are read-only for you: `shadow_F.csv`, `shadow_L.csv`, `shadow_F0.csv`,
`shadow_L0.csv`, `shadow_F_gateold.csv`, `shadow_L_gateold.csv`, `bins_F.csv`, `bins_L.csv`,
`switch_2015-01-01.csv`, `switch_2019-01-01.csv`, `switch_2023-01-01.csv`, `bootstrap_indices.csv`, `months.csv`,
and the source data `../hourly_backtest_data_v361.csv`. Column lists are in `README.md`. CSVs are unquoted;
booleans are 1/0; times are ISO UTC ending in `.000Z`; blank means missing.

## 1. Pairing and exclusions (apply in this order, report the count removed at each step)

1. Pair `shadow_F` with `shadow_L` on `predTs`. Keep pairs with `status == "predicted"` in BOTH files. Report `n_both_predicted`.
2. Burn-in: drop pairs with `predTs` earlier than `2011-12-04T05:00:00.000Z`. Report `excl_burnin`.
3. Drop pairs with `truthDependentHard == 1` in EITHER file. Report `excl_hard`. Never use `hardFlag`, `softFlag`, `chk4_largeerr`, `chk5_outlier` or `outlierZ` for exclusion.
4. Drop pairs with `truthInProdRange == 0` in EITHER file. Report `excl_range`.
5. Drop pairs with a blank `errPctCorr` or `errPctRaw` in either file (should be none; report `excl_blank`).
The result is the SCORED SET; report `n_scored`.

## 2. Definitions (inputs only, never outcomes)

- `affected`: `abs(rawFinalCFS_F - rawFinalCFS_L) / rawFinalCFS_L >= 0.01` OR `flowState_F != flowState_L` OR `flowBin_F != flowBin_L`.
- `rising`: `flowState == "rising"` in at least one file. `falling`: `"falling"` in at least one file and not `rising`. `steady_both`: `"steady"` in both.
- `flood`: `truthFlow >= 50000` in at least one file.
- Month of a pair: the first 7 characters of `predTs`.
- Era 1: `predTs < 2019-01-01T00:00:00.000Z`; era 2: the rest.

## 3. Quantities per pair

- `d_corr = abs(errPctCorr_F) - abs(errPctCorr_L)` (negative means the fresh arm has the smaller error).
- `d_raw = abs(errPctRaw_F) - abs(errPctRaw_L)`.

## 4. Populations

`all` (the scored set), `affected`, `affected_rising` (PRIMARY), `affected_falling`, `affected_flood`,
`flood_all`, `rising_any` (rising, affected or not), `steady_both`, `affected_rising_era1`, `affected_rising_era2`.

## 5. Measures per population (metric keys)

`n_pairs`, `n_months` (months with at least one pair), `mean_d_corr`, `median_d_corr`, `mean_d_raw`,
`mean_abs_F`, `mean_abs_L`, `median_abs_F`, `median_abs_L` (of `abs(errPctCorr)`), `bias_F`, `bias_L`
(mean of signed `errPctCorr`), `big25_F`, `big25_L` (percent of pairs with `abs(errPctCorr) > 25`),
`ci_lo`, `ci_hi` (see section 6, for `mean_d_corr`).

Also, once, for the scored set: `share_affected`, `share_state_differs`, `share_bin_differs` (percent of pairs).

## 6. Bootstrap interval for `mean_d_corr`

`bootstrap_indices.csv` has 10,000 rows; columns `m1` to `m175` hold month labels drawn with replacement. For each
row: take every pair of the population whose month equals a drawn label, counting a month's pairs once for every
time the label was drawn; compute the pooled mean of `d_corr` over all of them. A drawn month without pairs
contributes nothing. If a resample contains no pair at all, skip it and report the number skipped
(`boot_skipped`). `ci_lo` and `ci_hi` are the 2.5th and 97.5th percentiles of the resample means with linear
interpolation between order statistics (numpy `percentile` default; R `quantile` type 7).

## 7. Sensitivity runs (each: the measures of section 5 for `affected_rising` and `affected_flood` only)

- `sens_F0L0`: sections 1 to 6 with `shadow_F0.csv` and `shadow_L0.csv` in place of F and L.
- `sens_age`: the main scored set minus pairs with `age_por_h > 1` in F or `age_por_h > 2` in L.
- `sens_12mo`: the main scored set minus pairs with `predTs < 2012-12-01T05:00:00.000Z`.
- `sens_gateold`: sections 1 to 6 with the two `_gateold` files (same exclusion rules).
Population names become e.g. `sens_F0L0.affected_rising`.

## 8. Transient

Flood events, from `../hourly_backtest_data_v361.csv` (find the Little Falls flow and Point of Rocks flow columns
and the timestamp column from the header and say which you used): an event starts at the first hour with Little
Falls flow >= 50,000 after at least 168 consecutive hours (rows present or not; count clock hours) in which no
present row had Little Falls flow >= 50,000. Drop events starting before `2012-12-01T05:00:00.000Z`. Report
`n_events`.

Rise start of an event starting at E: the EARLIEST hour h with E - 168 h <= h <= E for which rows h and h - 1 h are
both present with positive Point of Rocks flow and `(por(h) - por(h-1)) / por(h-1) >= 0.02`. Switch anchor
`S = h - 24 h`. Events without such an hour are skipped (`n_events_norise`).

For each event: find in `shadow_F.csv` (scored-set pairs only) the first row with `predTs >= S` and
`flowState == "rising"`; call its cell `c = flowBin + "|" + flowState` as the bins files write it (check the exact
`cell` format in `bins_F.csv` and say what you matched on), its `rawFinalCFS` r. The bin state of an arm at S is the
last row of that arm's bins file for cell c with `ts <= S` (if an arm has no row for the cell yet, the event is
skipped: `n_events_nobin`). `offset_k1_pct = (ema_L(S) - ema_F(S)) / r * 100`, where ema is `emaMeanError`.
Report `n_events_used`, `median_abs_offset_k1_pct`, `median_signed_offset_k1_pct`, `p90_abs_offset_k1_pct`
(type 7), and the same three for k = 3 and k = 6 using `offset_k = offset_k1 * 0.7^(k-1)`.

Branched check, for each `switch_<date>.csv`: join its rows to `shadow_F.csv` on `predTs`; take rows that are
`predicted` in both and `rising` in the switch file; `realized_pct = (predictedCFS_switch - predictedCFS_F) /
rawFinalCFS_F * 100`. Report for the first such row: `realized_first_pct_<date>`, its `predTs`, and
`formula_first_pct_<date>` computed as above with S = the switch time and that row's cell and `rawFinalCFS`.
Also report `realized_median_abs_first10_<date>` and `realized_median_abs_last10_<date>` (first and last ten such rows).

## 9. Lag check (data transformation check)

From `shadow_F.csv`, `shadow_L.csv` and the source data, for ALL rows with `status == "predicted"`: confirm that
`porQ` equals the Point of Rocks flow of the source row whose timestamp is `porSrcTs`, that `efStage`, `gooseQ`
and `lfQ` equal the source values at `efSrcTs`, `gooseSrcTs`, `lfSrcTs`, and that for rows where the source row
exactly at the nominal lag exists and is non-blank, the source timestamps are `predTs - 1 h` for every input in F,
and in L `predTs - 2 h` for Point of Rocks, Edwards Ferry and Goose and `predTs - 1 h` for Little Falls. Report the
number of rows checked and the number of mismatches per check (`lag_rows`, `lag_mismatch_<name>`).

## 10. Output

- Your script(s) and a `README` of how to run them, in your own subfolder (`py/` or `r/`). Do not write anywhere else.
- `metrics_python.csv` or `metrics_R.csv` in your subfolder: three columns `population,metric,value`, one row per
  number, using exactly the names above (transient and lag-check numbers use population `transient` and `lagcheck`;
  section 1 counts use population `counts`). Values as plain decimals with at least 6 significant digits.
- A short report as your final message: what you ran, row counts at each step, any ambiguity you had to resolve
  and how, and the table of the primary population. State no opinion on what the result means for the decision.

Rules: read-only on everything outside your subfolder; no network; no installs beyond what is already on this
machine (if a package is missing, use base functionality and say so); do not open the other analyst's subfolder;
do not read `metrics_*` files that are not yours.

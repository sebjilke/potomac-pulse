# Analysis specification, Part R: the USGS revision of Point of Rocks flow

Read `ANALYSIS_SPEC_COMMON.md` first. Written on 2026-11-23 before any result existed. Output folder: `py_R/`
(Python) or `r_R/` (R). Each question below names its tables (exact columns, key columns first) and its single
numbers (`metrics.csv`, `question` = the heading's code).

Shorthand: PoR = Point of Rocks `01638500`; LF = Little Falls `01646500`. "Old" = `readings_old_archive.csv`;
"current" as defined in the common part. `lm` = `last_modified_utc` of the current record.

## R1. Anatomy of the revision

1. **Pairs.** Inner join old and current PoR flow on `time_utc`, both non-blank. Add the current PoR level at
   the same `time_utc` (blank if none), and `lm` of the current flow. `changed` = 1 if old != current.
2. **Rewrite groups.** For changed pairs, group by `lm` truncated to the minute.
   Table `R1_rewrite_groups`: `lm_minute, n_pairs, first_time_utc, last_time_utc, mean_ratio, min_ratio,
   max_ratio` (ratio = current / old).
3. **REV13** = changed pairs whose `lm` lies in `[2026-11-13T19:41:00Z, 2026-11-13T19:42:00Z)`.
   Metrics: `n_pairs_all`, `n_changed_all`, `n_rev13`, `rev13_first_time_utc`, `rev13_last_time_utc`,
   `n_unchanged_inside_rev13_span` (unchanged pairs between those two times),
   `n_current_stamped_1941` (all current PoR flow readings, in the whole census table, with `lm` in that
   minute) and `earliest_time_stamped_1941`, `latest_time_stamped_1941`.
4. **By day.** Table `R1_by_day`: `day_utc, n_pairs, n_changed, n_rev13, mean_old, mean_current,
   mean_ratio_rev13, mean_diff_rev13_cfs` for every UTC day with pairs from `2026-08-01` on.
5. **By level.** For REV13 pairs with a level: table `R1_by_level`: `level_ft` (0.01 ft), `n, mean_old,
   mean_current, mean_ratio, mean_diff_cfs, n_distinct_old, n_distinct_current`.
   Table `R1_by_level_band`: bands of 0.25 ft (`[0.75,1.00)`, `[1.00,1.25)`, ...; `band_lo` as key):
   `band_lo, n, mean_ratio, sd_ratio, mean_diff_cfs, sd_diff_cfs`.
6. **Which description fits best.** On REV13 pairs with a level: (i) ratio `r`; (ii) difference `q` =
   current - old (cfs); (iii) level shift `s`: build the old lookup `L(h)` = median old flow of REV13 pairs at
   level `h` (0.01 ft), make it non-decreasing in `h` by a running maximum, and for each pair find by linear
   interpolation the level `h*` at which `L(h*)` equals the pair's current flow (undefined if outside the
   range of `L`; count); `s = h* - h`. Metrics: for each of r, q, s: `mean`, `sd`, `cv` (= sd / abs(mean)),
   `n`; and `n_shift_undefined`.
7. **Does it change over time.** For REV13 pairs in the level bands `[1.00,1.10)`, `[1.10,1.20)`,
   `[1.20,1.30)` ft: table `R1_ratio_day_band`: `band_lo, day_utc, n, mean_ratio`; and per band with at least
   5 days: least-squares slope of the daily mean ratio on the day number (days since the band's first day),
   metric `slope_ratio_per_day_<band_lo>` with `n_days_<band_lo>`.
8. **The two old copies.** For every `(gauge, parameter)` present in both old tables, join on `time_utc`:
   table `R1_old_copies`: `gauge, parameter, n_shared, n_equal, n_different, max_abs_diff`.
9. **The job log's old readings.** For used runs with `labels.cur_label = old`: `runs.in_por_q` against the
   current PoR flow at `runs.in_por_qT_utc`. Table `R1_log_pairs`: `seq, in_por_qT_utc, in_por_h, logged_q,
   current_q, ratio`. Metrics: `n`, `mean_ratio`, `min_ratio`, `max_ratio`.

## R2. Was anything else revised?

For every `(gauge, parameter)` of the old archive except PoR flow: inner join with the current record on
`time_utc`, both non-blank. Table `R2_series`: `gauge, parameter, n_pairs, n_equal, n_changed,
first_changed_time_utc, last_changed_time_utc, max_abs_diff, n_distinct_lm_minutes_of_changed`.
PoR level: `readings_old_octpull.csv` (PoR `00065`) against the current level: same columns, table
`R2_por_level_octpull`. Job log: for all used runs, `runs.in_por_h` against the current PoR level at
`runs.in_por_hT_utc`: metrics `n`, `n_equal`, and table `R2_por_level_log_mismatch`: `seq, in_por_hT_utc,
logged_h, current_h`.

## R3. USGS's own account

1. **Visits.** `field_measurements.csv`, gauges PoR and LF. Drop rows that duplicate another row in every
   column except `feature_id` and `source_file` (count them). Pair the flow row (`00060`) and the level row
   (`00065`) of the same `field_visit_id`. Table `R3_visits`: `gauge, visit_time_utc, field_visit_id,
   level_ft, flow_cfs, control_condition, measurement_rated, observing_procedure, last_modified`.
   Metrics per gauge: visits per calendar year for 2021 to 2026 (`visits_<gauge>_<year>`), median days between
   consecutive visits from 2021-01-01 on.
2. **Measured against published**, PoR visits from 2025-01-01 on that have a flow: the current published flow
   at the reading nearest in time within 15 minutes (earlier one on a tie), and, where the old archive has a
   reading within 15 minutes, the old published flow. Table `R3_measured_vs_published`: `visit_time_utc,
   level_ft, measured_cfs, measurement_rated, control_condition, current_cfs, old_cfs,
   pct_current_vs_measured, pct_old_vs_measured` (pct = (published - measured) / measured * 100).
3. **Census of rewrites.** For PoR flow and LF flow in the census table: group readings by `lm` truncated to
   the minute; a "bulk rewrite" is a group with at least 96 readings. Table `R3_bulk_rewrites`: `gauge,
   lm_minute, n_readings, first_time_utc, last_time_utc, span_days, days_since_last_visit` (days from the most
   recent visit of that gauge at or before `lm_minute`; blank if none). Metrics per gauge: `n_bulk`,
   `share_of_readings_in_bulk`, `n_bulk_within_7_days_after_a_visit`, `longest_span_days`. These counts are a
   lower bound: only the latest rewrite of each reading is visible.

## R4. Which record is closer to the river?

Rating bands, fixed: a measurement rated "Excellent" +/-2%, "Good" +/-5%, "Fair" +/-8%, "Poor" +/-15%,
anything else +/-15%.

**(0) Hand measurements.** From `R3_measured_vs_published`, visits from 2026-06-12 on: add `band_pct` (from
the rating), `current_inside_band`, `old_inside_band` (1/0, blank if no old value). For the visit of
2026-11-10 the old archive has no reading; use instead `f_old_values.csv` (nearest stamp within 15 minutes),
columns for rule A, B and C. Table `R4_0_por`: the columns above plus `f_old_A, f_old_B, f_old_C,
pct_f_old_A_vs_measured, pct_f_old_B_vs_measured, pct_f_old_C_vs_measured`. Upstream gauges: every visit
from 2026-09-01 on with a flow, against that gauge's current flow nearest within 15 minutes: table
`R4_0_upstream`: `gauge, visit_time_utc, level_ft, measured_cfs, measurement_rated, current_cfs, pct,
band_pct, inside_band`.

**(a) Upstream water balance.** Day means (common part, step 4) of: PoR old (archive), PoR current, and
`U` = Shepherdstown + Millville + Antietam + Catoctin (current; a day is used only if all four exist). A day
is "steady" if it is not an event day at PoR (flow, current record) nor at Shepherdstown nor at Millville.
For lag `g` in {0, 1, 2} days: `ratio_old(D) = PoR_old(D) / U(D - g)`, `ratio_new(D) = PoR_current(D) /
U(D - g)`. Days from 2026-09-03 to 2026-11-09. A day is "revised" if any PoR pair of that day is in REV13,
else "unrevised". Table `R4_a_days`: `day_utc, steady, revised, por_old, por_current, u_lag0, u_lag1,
u_lag2`. For each lag: `c` = median of `ratio_new` over steady unrevised days (if fewer than 10 such days,
`c = 1.03`; report which); band = `[c / 1.113, c * 1.113]`; over steady revised days: `median_ratio_old`,
`median_ratio_new`, `n_days`, `old_inside_band`, `new_inside_band`, and `verdict` = "B supported" if new
inside and old outside, "A supported" if old inside and new outside, else "undetermined". Lag 1 is the main
result; lags 0 and 2 are sensitivities. Metrics with `group` = `lag0`, `lag1`, `lag2`.

**(b) Balance at Little Falls with withdrawals.** `data/tidy/withdrawals_coop.csv` (one row per report page;
assert that every `withdrawal_date` occurs once and stop if not; ignore the `..._flag` columns except to count
the flagged values you used; do not use `special_conditions_text`, `lf_prev_day_cfs`, `por_prev_day_cfs` or
the `coop_flow_...` columns): `W(D)` = `total_net_potomac_withdrawal_mgd` * 1.547229 for `withdrawal_date` =
D (blank if missing). Tributaries
`T(D)` = day means of Monocacy + Goose + Broad Run + Seneca (current). For lag `g` in {1, 2, 3} days:
`resid_old(D) = LF(D) - (PoR_old(D - g) + T(D - g) - W(D))`, `resid_new(D)` the same with PoR current. Days:
2026-09-01 to the cutoff with `W` and all flows defined, not an event day at PoR (day D - g) nor at LF (day
D). PoR old exists to 2026-11-09 only; later days have `resid_new` only. Table `R4_b_days`: `day_utc, lag,
revised` (of day D - g), `lf, por_old, por_current, trib, w_cfs, resid_old, resid_new`. For each lag, over
days where both residuals exist, separately for revised and unrevised PoR days: `n_days`, medians and means
of `resid_old` and `resid_new` in cfs and as percent of the median LF; band = 11.3% of the median LF of those
days; `verdict` over revised days = "B supported" if `abs(median resid_new) <= band` and `abs(median
resid_old) > band`, mirror for A, else "undetermined". Also `median_resid_new_after_nov9` and `n` for days
after 2026-11-09. Lag 2 is the main result.

**(c) The estimate against Little Falls plus withdrawals.** Used runs with T1: `raw` = S0 logged `raw_cfs`;
`W` of the UTC date of the run's `due_utc` (run dropped from this item if `W` is missing; count).
`e_raw = (raw - T1) / T1 * 100`; `e_adj = (raw - (T1 + W)) / (T1 + W) * 100`. Table `R4_c_runs`: `seq,
at_utc, phase, gate_miss, raw_cfs, t1, w_cfs, e_raw, e_adj`. Per phase: `n`, `mean_e_raw`, `mean_e_adj`,
`mean_abs_e_raw`, `mean_abs_e_adj`, each with its day-block interval. Day to day, phase NEW only: per UTC day
of `due_utc`, `m(D)` = mean of `raw - T1` (cfs) over that day's runs; Pearson correlation and least-squares
slope of `m(D)` on `W(D)`, with `n_days`, `sd_w_cfs`, `sd_m_cfs`.

## R5. Passage through the model

Per-run table `R5_runs` (used runs): `seq, at_utc, phase, gate_miss, ver, src`, the three label columns of
`labels.csv`, then for S0 logged and for each replayed scenario (`S-old-A`, `S-old-B`, `S-old-C`, `S-new`):
`raw_cfs, due_utc, t1, e_raw` (suffix `_s0`, `_oldA`, `_oldB`, `_oldC`, `_new`), and `t1_s0`-based errors of
the scenario estimates (`e_raw_<scn>_commondue` = scenario raw against the T1 of `(seq, S0)`).

**Three-term split**, for each old rule X in {A, B, C}, per run: `term1 = e_raw_oldX`; `term2 = e_raw_new -
e_raw_oldX`; `term3 = e_raw_s0 - e_raw_new`. Runs lacking any of the needed T1 values are dropped (count).
Table `R5_split`: `old_rule, due_basis, set, phase, n, mean_term1, lo_term1, hi_term1, mean_term2, lo_term2,
hi_term2, mean_term3, lo_term3, hi_term3, mean_e_s0, mean_abs_e_s0, mean_abs_e_old, mean_abs_e_new` where
`due_basis` is `own` (each estimate against the T1 of its own due time; the main result) or `common` (all
against the T1 of `(seq, S0)`), `set` is `all` or `without_212_217`, `phase` is OLD, TRANS, NEW or ALL, and
lo/hi are day-block intervals. Also table `R5_split_by_day`: `old_rule, day_utc, n, mean_term1, mean_term2,
mean_term3` (`due_basis = own`, `set = all`).

**Extrapolation share.** From `replay_runs.csv`, per scenario S-old-A/B/C and phase: `n_runs`, share of runs
whose `cur_extrap_flag`, `back6_extrap_flag` or `hist_extrap_flag` is not `observed` and not blank
(`share_any_extrapolated`), and the same for `hist_extrap_flag` alone. Table `R5_extrapolation`.

**The chain by phase.** Table `R5_chain`: `source` (S0 logged, or a replayed scenario), `phase`, `n`, then
the means of: `trv_t`, `trv_gf2lf`, `hist_ago`, `hist_cfs`, `pre_cfs`, `delta_ratio` (over runs where it is
non-blank; also `n_delta_ratio`), `raw_cfs`, `corr_c`, `final_cfs`, share of `ceil_bound = 1`, share of each
`corr_st` value (`share_rising`, `share_steady`, `share_falling`), share at the iteration limit (S0 logged:
`trv_stop = max_iter`).

## R6. How the learned corrections responded

Table `R6_checks` (all 20 checks, by `created_at_utc`): `seq_check, predTs_utc, run_seq` (blank if none),
`phase` (of the run), `bin, st, rawCFS, corrApplied, corrCFS, actualCFS, errRawCFS, errPctRaw, errPctCorr,
binBefore_n, binBefore_ema, binAfter_count, binAfter_emaMeanError, ceilBound, soft, hard`.
Per bin key (`bin` + `_` + `st`) table `R6_bins`: `bin_key, n_checks, n_checks_OLD, n_checks_TRANS,
n_checks_NEW, ema_before_first_check, ema_after_last_check, mean_errRawCFS_last3_NEW` (mean over the last up
to three checks whose run is in NEW; blank if none), `gap_open_cfs` (= that mean minus
`ema_after_last_check`), `checks_per_day_NEW` (NEW checks divided by the days from the first NEW check to the
cutoff), `days_to_close_90pct` (= 7 / `checks_per_day_NEW`; 7 is the number of updates at which 0.7^k falls
below 0.1).

## R7. The other flow ranges

For REV13 pairs, by range of the OLD flow (`[0,3000)`, `[3000,6000)`, `[6000,12000)`, `[12000,25000)`,
`[25000,50000)`, `[50000,inf)`): table `R7_ranges`: `range_lo, n, mean_ratio, min_ratio, max_ratio,
mean_diff_cfs, min_level_ft, max_level_ft`. From `bins.csv`, rows with `source` of the live bins
(`gf_correction_bin`; see the dictionary): table `R7_bins`: `bin_key, n, ema, mean, sd`, plus
`last_check_in_window_utc` (latest `checks.created_at_utc` for that bin key, blank if none).

## R8. Other breaks inside the window

**(a) The switch of data source.** For used runs, compare each logged current reading with the current record
at its logged reading time: `in_lf_q` (LF `00060` at `in_lf_qT_utc`), `in_lf_h`, `in_mono_q`, `in_goose_q`,
`in_sen_q`, `in_br_q`, `in_ef_h`, `in_por_h`, and `in_por_q` for runs with `cur_label = new` only. Table
`R8_inputs`: `field, src_group` (`old_service` if `runs.src` is blank or not `new`, else `new_service`),
`n, n_equal, n_different, max_abs_diff`. Error: in phase NEW, `e_raw_s0` of runs before the switch against
runs after it: `n_before`, `n_after`, `mean_before`, `mean_after`, `diff` with a day-block interval (two
groups), and the same for `term1` under rule B and for `e_raw_new`.
**(b) The falling river.** Table `R8_daily`: `day_utc, n_runs, mean_term1_B, mean_e_raw_s0, lf_day_mean,
por_level_day_mean, lf_change_24h_pct` (= LF day mean against the previous day's, percent). In phase OLD and
in phase NEW separately: least-squares slope and Pearson correlation of the daily `mean_term1_B` on
`lf_change_24h_pct`, with `n_days`.

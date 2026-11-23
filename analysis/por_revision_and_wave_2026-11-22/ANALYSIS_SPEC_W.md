# Analysis specification, Part W: the daily wave

Read `ANALYSIS_SPEC_COMMON.md` first. Written on 2026-11-23 before any result existed. Output folder: `py_W/`
(Python) or `r_W/` (R). Each question names its tables (exact columns, key columns first) and its single
numbers (`metrics.csv`, `question` = the heading's code).

Shorthand: PoR = Point of Rocks `01638500`; EF = Edwards Ferry `01644148`; LF = Little Falls `01646500`.
All series are the CURRENT record. Wave window: `2026-09-01T00:00:00Z` to the cutoff. Series preparation,
wave sizes (a) and (b), crest and trough times, event days and circular means are defined in the common part,
section 3; use them exactly.

Fixed calendar periods (by UTC day; chosen without looking at the data): P1 = 1 to 14 Sep; P2 = 15 Sep to
11 Oct; P3 = 12 to 21 Oct; P4 = 22 to 31 Oct; P5 = 1 to 9 Nov; P6 = 10 to 13 Nov; P7 = 14 to 22 Nov.

## W1. Description at the model's gauges

Series: PoR level, PoR flow, EF level, LF level, LF flow.
Table `W1_daily`: `gauge, parameter, day_utc, step_min, n_present, day_mean, A_a, A_a_rel, A_b, phi_b_utc_h,
crest_utc_h, crest_local_h, trough_utc_h, trough_local_h, event_day, weekday_utc` (0 = Monday).
Table `W1_periods`: `gauge, parameter, period, n_days, n_non_event, median_A_a, median_A_a_rel, median_A_b,
crest_utc_h_circmean, crest_local_h_circmean, trough_utc_h_circmean, trough_local_h_circmean` over non-event
days with a defined `A_a`.
Table `W1_weekday`: `gauge, parameter, window, weekday_utc, n_days, median_A_a` for the windows `P2` and
`P5toP7` (1 to 22 Nov), non-event days.
Metrics: for LF flow in 10 to 22 Nov, `lf_flow_step_cfs` = the median difference between consecutive distinct
values of the sorted set of distinct flows; and `lf_median_A_a_in_steps` = median `A_a` of that window divided
by it.

## W2. Origin

The same `W2_daily` and `W2_periods` tables (same columns) for the upstream gauges: flow and level of
Shepherdstown, Hancock, Paw Paw, Millville, Antietam, Conococheague, Opequon, Catoctin.

**Clock test.** For every level series of W1 and W2 (plus LF flow and PoR flow): non-event days of the windows
`before` = 22 to 31 Oct and `after` = 2 to 11 Nov. `shift_crest` = circular mean of `crest_utc_h` in `after`
minus that in `before`, taken into `(-12, 12]`; the same for the trough. Day-block interval with the two
groups resampled separately (common part, section 4). Label: "follows the clock" if the whole interval of the
shift lies in `[0.5, 1.5]`; "does not" if it lies in `[-0.5, 0.5]`; otherwise "undetermined".
Table `W2_clock`: `gauge, parameter, n_before, n_after, crest_before, crest_after, shift_crest, lo, hi,
label_crest, trough_before, trough_after, shift_trough, lo_t, hi_t, label_trough`.

**Weekdays against weekends.** Table `W2_weekend`: `gauge, parameter, window, median_A_a_weekdays,
median_A_a_weekend, n_weekdays, n_weekend, ratio` for the windows `P2` and `P5toP7`; weekend = `weekday_utc`
5 or 6.

**Instrument test at Point of Rocks.** Detrended PoR level and detrended PoR water temperature (`00010`), on
the common 5-minute grid, non-event days of 1 to 22 Nov. Pearson correlation at lag 0, and for lags from -12 h
to +12 h in steps of 15 minutes (positive lag = temperature later) the lag with the largest absolute
correlation. Metrics: `r_lag0`, `lag_of_max_abs_r_h`, `max_abs_r`, `n_points`. Also the median `A_a` of the
temperature series (deg C) in P5, P6, P7.

**Passage upstream to Point of Rocks.** For each upstream level series against PoR level, non-event days of
1 to 22 Nov: cross-correlation of the detrended series for lags 0 to 72 h in steps of 15 minutes (positive lag
= PoR later; each series at its own grid, the other interpolated linearly to it only within 30 minutes).
Table `W2_xcorr_upstream`: `gauge, lag_h_of_max_r, max_r, lag_h_mod_24, n_points`, and the list of local
maxima with `r >= 0.3` in table `W2_xcorr_upstream_maxima`: `gauge, lag_h, r`.

## W3. Travel and damping, Point of Rocks to Little Falls

Level series of PoR, EF and LF.

**(2) Legs by cross-correlation.** Pairs PoR to EF, EF to LF, PoR to LF; detrended level; lags 0 to 72 h in
steps of 5 minutes (positive = downstream gauge later); windows `nov_all` (1 to 22 Nov), `nov_pre` (1 to
13 Nov), `nov_post` (14 to 22 Nov); non-event days. Table `W3_xcorr`: `pair, window, lag_h_of_max_r, max_r,
lag_h_mod_24, n_points`. Table `W3_xcorr_maxima`: `pair, window, lag_h, r` for every local maximum with
`r >= 0.3`. Metric `legs_add_up_h` = (PoR to EF `lag_h_mod_24` + EF to LF `lag_h_mod_24`) mod 24 minus (PoR to
LF `lag_h_mod_24`), into `(-12, 12]`, for `nov_all`.

**(3) Individual crests.** For every day of 1 to 22 Nov that is a non-event day at both gauges of a pair:
`crest_utc_h` downstream minus upstream, mod 24 into `[0, 24)`. Table `W3_crests`: `pair, n_days, circmean_h,
circ_sd_h` (circular standard deviation: `sqrt(-2 ln R) * 24 / (2*pi)`, R = mean resultant length).

**(1) Day-to-day changes of size.** Daily `A_a` of PoR level and LF level (and EF level), 15 Sep to 22 Nov,
non-event days. For `k` = 0, 1, 2, 3, 4 days: Pearson correlation of `A_a(PoR, D)` with `A_a(LF, D + k)`.
Table `W3_size_lag`: `pair, k_days, r, n_days`. A "weak day" at a gauge: `A_a(D)` below 60% of the median of
`A_a` over the up to six days D-3..D-1 and D+1..D+3 that are non-event and defined (at least four of them
needed). Table `W3_weak_days`: `gauge, day_utc, A_a, neighbour_median`. For each PoR weak day list the LF weak
days within D..D+4: table `W3_weak_matches`: `por_day, lf_day, k_days`. Metric `size_method_decisive` = 1 if
at least two PoR weak days have a match and all matches share one `k_days`, else 0; `size_method_k_days` if
decisive.

**(4) Non-periodic disturbances.** Whole 5-minute record of PoR level and LF level from 2026-06-12. An onset
at a gauge is the first grid time `t` at which `MA(t + 24 h) - MA(t) >= 0.10` ft, with no onset in the
preceding 72 hours. Match each PoR onset with the first LF onset in the following 0 to 96 hours. Table
`W3_onsets`: `por_onset_utc, lf_onset_utc, lag_h, por_ma_level_ft, lf_ma_level_ft, lf_ma_flow_cfs` (LF flow MA
at the LF onset). Metrics: `n_matched`, `median_lag_h`, and the same restricted to `lf_ma_flow_cfs < 3000`.

**Decision, mechanical.** `hours_within_day` = PoR to LF `lag_h_mod_24` of `nov_all` if it agrees with the
`circmean_h` of (3) within 2 hours (circular), else "disagree". `whole_days`: from (1) if decisive
(`size_method_k_days`); from (4) = `floor(median_lag_h / 24)` if at least three matched onsets below 3,000
cfs exist; "resolved" if both exist and are equal or only one exists; otherwise "unresolved". Report all of
it; do not choose.

**The model's assumed times**, from `runs.csv` used runs by phase: means of `trv_t`, `trv_gf2lf`, their sum,
and `hist_ago`. Table `W3_model_times`: `phase, n, mean_trv_t, mean_trv_gf2lf, mean_total, mean_hist_ago`.

**Damping.** Per period P4 to P7, non-event days at both gauges: median of `A_a_rel(LF flow)`,
median of `A_a_rel(PoR flow)` and their ratio; median `A_a` of the three level series. Table `W3_damping`.

## W4. How the model passes the wave on

Used runs with T1 for `(seq, S0)`. `e_raw` and `e_final` from S0 logged `raw_cfs` and `final_cfs`.
`hour_due` = local hour (integer 0 to 23) of `due_utc`; `hour_run` = local hour of `at_utc`.
Table `W4_runs`: `seq, at_utc, due_utc, phase, gate_miss, hour_run, hour_due, raw_cfs, final_cfs, corr_c,
corr_st, ceil_bound, t1, e_raw, e_final`.
Table `W4_error_by_hour`: `phase, hour_due, n, mean_e_raw, mean_e_final` (hours with at least 3 runs are
"valid").
Per phase, table `W4_cycle`: `phase, quantity, n, mean, cycle_size, crest_hour, share_of_variance_by_hour,
sd_remainder` for the quantities `e_raw` and `e_final`, where `cycle_size` = half the range of the hourly
means over valid hours, `crest_hour` = the valid hour with the largest mean, `share_of_variance_by_hour` =
1 - (sum of squared deviations from the run's hourly mean) / (sum of squared deviations from the phase mean),
`sd_remainder` = standard deviation of the deviations from the hourly means. Day-block intervals for
`cycle_size` of `e_raw` and `e_final` in each phase, and for the difference NEW minus OLD (two groups).

**Components.** For phase OLD and phase NEW, by `hour_run`: means of `pre_cfs`, `delta_ratio` (non-blank),
`raw_cfs`, `corr_c`, `final_cfs`, `ceil_lim` (S0 logged), and of T1 by `hour_due`. Table `W4_components`:
`phase, quantity, hour, n, mean`. Table `W4_component_cycles`: `phase, quantity, mean, cycle_size,
cycle_size_pct_of_mean, crest_hour` (valid hours only).

## W5. Candidate explanations

All in phase NEW unless stated; errors against the estimate's own truth; `MAE` = mean absolute error;
`cycle` = `cycle_size` of the error by `hour_due` as in W4. Every difference gets a day-block interval and a
label (common part, section 4): the label uses the difference in MAE (points) and the difference in cycle as a
share of the cycle of `e_raw` (S0 logged, NEW).
Table `W5_candidates`: `candidate, old_rule, quantity, value_a, value_b, diff, lo, hi, label` with one row per
line below (`old_rule` blank where not applicable).

- **H1, which reading is picked** (`replay_2x2x2.csv`, for `old_rule` A, B, C): a = cell
  (`flow_numbers = new, reading_pick_from = new, due_from = new`), b = cell (`new, old, new`); quantities `MAE`
  and `cycle`. Also, same table, the mirrored pair with old numbers: a = (`old, new, old`), b = (`old, old,
  old`). And the mean of `trv_t_of_pick_h` in cells a and b.
- **H7, the due time**: a = cell (`new, new, new`), b = cell (`new, new, old`); `MAE` and `cycle`.
- **H3, the rise/fall factor**: a = S0 logged raw; b = the estimate without the factor, `raw_cfs /
  delta_ratio` where `delta_ratio` is non-blank, else `raw_cfs`; `MAE` and `cycle`. Repeat in phase OLD.
- **H4, switching between corrections**: a = `e_final`; b = the error of `min(raw_cfs - m, ceil_lim)` where
  `m` is the mean of `corr_c` over the phase's runs (check first on all runs that `final_cfs` equals
  `min(raw_cfs - corr_c, ceil_lim)` within 1 cfs and report the count that do not); `MAE` and `cycle`.
  Also a = cycle of `e_final`, b = cycle of `e_raw`.
- **H6, the 120% cap**: a = `e_final`; b = the error of `raw_cfs - corr_c` (no cap); `MAE` and `cycle`; and the
  share of runs with `ceil_bound = 1` in each phase.
- **H8, changes of flow state**: per UTC day, the number of changes of `corr_st` between consecutive used runs
  of that day. a = mean per day in `S-new` (from `replay_runs.csv`), b = mean per day in `S-old-B` (and A, C),
  over the days of phase NEW; the same over the days of phase OLD; and S0 logged for both phases.
- **H2, the wave itself**: a = median `A_a` in P7, b = median `A_a` in P5 and P6 together, for PoR level, PoR
  flow, LF level, LF flow (non-event days), with the ratio a / b; interval for the difference (two groups).
- **H5, too few checks**: the difference in `cycle` of `e_raw` between phase NEW and phase OLD, with its
  interval, for S0 logged, for `S-new` and for `S-old-B`, each scenario's estimates against its own truth.
- **H9, pumping**: no test is possible with these data. Report only: median `A_a` of EF level and of LF level
  in P7 and their ratio.

## W6. What the job's own checks see

Table `W6_checks` (20 checks): `seq_check, run_seq, phase, bin, st, hour_pred` (local hour of `predTs_utc`),
`hour_due` (of `dueAt_utc`), `hour_check` (of `valAt_utc`), `delayMin, errPctRaw, errPctCorr`.
Table `W6_by_bin`: `bin_key, n, hours_pred` (sorted, `|`-joined), `hours_due`.
Metrics, phase NEW: `mean_e_raw_all_runs` (W4), `mean_e_raw_at_check_hours` = the mean over the NEW-phase
checks of the W4 hourly mean of `e_raw` at each check's `hour_due` (valid hours only), and
`n_distinct_hours_due`.

## W7. Is this a recurring pattern? (2011 to 2026)

**(a)** `hourly_backtest_data_v39.csv` (hourly; `timestamp` is UTC): series `por_now` and `lf_discharge`. Use
the common recipe with a 60-minute step (interpolation only across a single missing hour; MA over
`[t - 12 h, t + 12 h]`, 25 points, at least 95% present). A day is a "wave day" at a gauge if it is not an
event day and `A_a_rel >= 0.03`. Table `W7_year_month`: `year, month, n_days, n_non_event_por, n_wave_por,
n_non_event_lf, n_wave_lf, median_A_a_rel_por, median_A_a_rel_lf`. Table `W7_flow_class`: by the day mean of
`lf_discharge` (`<2000`, `2000-3000`, `3000-6000`, `>=6000`): `class, n_days, n_non_event_por, n_wave_por,
share_wave_por, n_wave_lf`.
**(b)** `shadow_F.csv` (hourly estimates of the production model, 2011 to 2026): rows with `status =
predicted`, `truthDependentHard = 0`, `truthInProdRange = 1`, non-blank `errPctRaw` and `errPctCorr`, and
`predTs` at or after `2011-12-04T05:00:00.000Z`. Join each row to the UTC day of `predTs` in (a). Keep days
that are not event days at PoR and rows with `truthFlow < 3000`. Classes of that day's `A_a_rel` at PoR:
`<0.01`, `0.01-0.03`, `0.03-0.06`, `>=0.06`. Table `W7_error_by_wave`: `class, n_rows, n_days,
mean_abs_errPctRaw, mean_abs_errPctCorr, median_abs_errPctCorr`.

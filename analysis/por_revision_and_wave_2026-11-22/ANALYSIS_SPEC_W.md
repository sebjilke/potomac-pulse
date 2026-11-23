# Analysis specification, Part W: the daily wave

Version 2 (works in the auditor's review of version 1; all changes are wording that removes ambiguity).
Read `ANALYSIS_SPEC_COMMON.md` first. Written on 2026-11-23 before any result existed. Output folder: `py_W/`
(Python) or `r_W/` (R). Each question names its tables (exact columns, key columns first) and its single
numbers (`metrics.csv`, `question` = the heading's code).

Shorthand: PoR = Point of Rocks `01638500`; EF = Edwards Ferry `01644148`; LF = Little Falls `01646500`.
All series are the CURRENT record. Series preparation, wave sizes (a) and (b), crest and trough times, event
days, circular statistics and lagged correlations are defined in the common part, section 3; use them
exactly. Each series is prepared once over the Part W window (`2026-09-01T00:00:00Z` to the cutoff), except
where a question names another window.

Fixed calendar periods (by UTC day, both ends inclusive; fixed by the orchestrator from the calendar and from
outside information, without looking at these data): P1 = 1 to 14 Sep; P2 = 15 Sep to 11 Oct; P3 = 12 to
21 Oct; P4 = 22 to 31 Oct; P5 = 1 to 9 Nov; P6 = 10 to 13 Nov; P7 = 14 to 22 Nov. `P5toP7` = 1 to 22 Nov.
"Non-event days" of a period are the days of that period that are not event days at the gauge of the series
and have a defined `A_a`.

## W1. Description at the model's gauges

Series: PoR level, PoR flow, EF level, LF level, LF flow.
Table `W1_daily`: `gauge, parameter, day_utc, step_min, n_present, day_mean, A_a, A_a_rel, A_b, phi_b_utc_h,
crest_utc_h, crest_local_h, trough_utc_h, trough_local_h, event_day, weekday_utc` (0 = Monday; one row per
series and UTC day of the window; `n_present` = non-missing grid points of the day).
Table `W1_periods`: `gauge, parameter, period, n_days, n_non_event, median_A_a, median_A_a_rel, median_A_b,
crest_utc_h_circmean, crest_local_h_circmean, trough_utc_h_circmean, trough_local_h_circmean` over the
non-event days of the period (`n_days` = days of the period).
Table `W1_weekday`: `gauge, parameter, window, weekday_utc, n_days, median_A_a` for the windows `P2` and
`P5toP7`, non-event days.
Metrics: `lf_flow_step_cfs` = the median difference between consecutive distinct values of the sorted set of
distinct LF flow values among the raw readings (not the grid) of 10 to 22 Nov; `lf_median_A_a_in_steps` =
median `A_a` of LF flow over the non-event days of 10 to 22 Nov divided by it.
The dates on which the wave starts, weakens or strengthens are not computed by a rule; the report reads them
off `W1_daily`.

## W2. Origin

The same two tables, named `W2_daily` and `W2_periods` (same columns), for the upstream gauges: flow and level
of Shepherdstown, Hancock, Paw Paw, Millville, Antietam, Conococheague, Opequon, Catoctin.

**Clock test.** For every level series of W1 and W2, plus LF flow and PoR flow: non-event days of the windows
`before` = 22 to 31 Oct and `after` = 2 to 11 Nov. `shift_crest` = circular mean of `crest_utc_h` in `after`
minus that in `before`, taken into `(-12, 12]`; the same for the trough. Day-block interval with the two
groups resampled separately (common part, section 4); in each resample the difference is again taken into
`(-12, 12]`. Label: "follows the clock" if the whole interval lies in `[0.5, 1.5]`; "does not" if it lies in
`[-0.5, 0.5]`; otherwise "undetermined" (also if the interval is blank or either window has fewer than 4
days). Table `W2_clock`: `gauge, parameter, n_before, n_after, crest_before, crest_after, shift_crest, lo, hi,
label_crest, trough_before, trough_after, shift_trough, lo_t, hi_t, label_trough`.

**Weekdays against weekends.** Table `W2_weekend`: `gauge, parameter, window, median_A_a_weekdays,
median_A_a_weekend, n_weekdays, n_weekend, ratio` (`ratio` = weekend / weekdays) for every series of W1 and
W2 and the windows `P2` and `P5toP7`, non-event days; weekend = `weekday_utc` 5 or 6.

**Instrument test at Point of Rocks.** x = detrended PoR level, y = detrended PoR water temperature
(`00010`), analysis window `P5toP7`. Lagged correlation (common part, point 10) for lags from -12 h to +12 h
in steps of 15 minutes on the 5-minute grid (positive lag = temperature later). Metrics: `r_lag0`,
`lag_of_max_abs_r_h` (ties to the smallest absolute lag, then the non-negative one), `max_abs_r`,
`n_points_lag0`. Also the median `A_a` of the temperature series (deg C) over the non-event days of P5, P6
and P7 (`group` = the period).

**Passage upstream to Point of Rocks.** For each upstream LEVEL series as x and PoR level as y, analysis
window `P5toP7`: lagged correlation for lags 0 to 72 h in steps of 15 minutes. Table `W2_xcorr_upstream`:
`gauge, lag_h_of_max_r, max_r, lag_h_mod_24, n_points`. Table `W2_xcorr_upstream_maxima`: `gauge, lag_h, r`
for every local maximum with `r >= 0.3`.

## W3. Travel and damping, Point of Rocks to Little Falls

Level series of PoR, EF and LF. Pairs, always upstream first: `PoR-EF`, `EF-LF`, `PoR-LF`.

**(2) Legs by lagged correlation.** For each pair: lags 0 to 72 h in steps of 5 minutes (EF is interpolated to
the 5-minute grid as the common part says); analysis windows `nov_all` (1 to 22 Nov), `nov_pre` (1 to
13 Nov), `nov_post` (14 to 22 Nov). Table `W3_xcorr`: `pair, window, lag_h_of_max_r, max_r, lag_h_mod_24,
n_points`. Table `W3_xcorr_maxima`: `pair, window, lag_h, r` for every local maximum with `r >= 0.3`. Metric
`legs_add_up_h` = (PoR-EF `lag_h_mod_24` + EF-LF `lag_h_mod_24`) mod 24 minus (PoR-LF `lag_h_mod_24`), taken
into `(-12, 12]`, for `nov_all`.

**(3) Individual crests.** For each pair and every day of 1 to 22 Nov that is a non-event day with a defined
crest at both gauges: `crest_utc_h` downstream minus upstream, mod 24 into `[0, 24)`. Table `W3_crests`:
`pair, n_days, circmean_h, circ_sd_h`.

**(1) Day-to-day changes of size.** Daily `A_a` of the level series, 15 Sep to 22 Nov. For each pair and `k`
= 0, 1, 2, 3, 4 days: Pearson correlation of `A_a(upstream, D)` with `A_a(downstream, D + k)` over the days D
where both are defined, D is a non-event day at the upstream gauge and D + k a non-event day at the
downstream gauge, both inside the window. Table `W3_size_lag`: `pair, k_days, r, n_days`. A "weak day" at a
gauge: a non-event day with `A_a(D)` below 60% of the median of `A_a` over those of the six days D-3..D-1 and
D+1..D+3 that are non-event with a defined `A_a` (at least four of them needed, else D is not classified).
Table `W3_weak_days`: `gauge, day_utc, A_a, neighbour_median` (the three level gauges). For each PoR weak day
list the LF weak days within D..D+4: table `W3_weak_matches`: `por_day, lf_day, k_days`. Metric
`size_method_decisive` = 1 if at least two PoR weak days have a match and all matches share one `k_days`,
else 0; `size_method_k_days` if decisive.

**(4) Non-periodic disturbances.** PoR level and LF level prepared over the W3(4) window (from
`2026-06-12T00:00:00Z`); LF flow likewise. An onset at a gauge is a grid time `t` with `MA(t)` and
`MA(t + 24 h)` defined and `MA(t + 24 h) - MA(t) >= 0.10` ft, such that no earlier grid time within the
preceding 72 hours (`[t - 72 h, t)`) satisfies the same condition; scan in time order. Match each PoR onset
with the first LF onset `t'` with `0 <= t' - t <= 96 h`. Table `W3_onsets`: `por_onset_utc, lf_onset_utc,
lag_h, por_ma_level_ft, lf_ma_level_ft, lf_ma_flow_cfs` (the MA values at the respective onset times; LF flow
MA at the LF onset; unmatched PoR onsets are listed with blanks). Metrics: `n_por_onsets`, `n_matched`,
`median_lag_h`, and `n_matched_below_3000`, `median_lag_h_below_3000` for matches with `lf_ma_flow_cfs <
3000`.

**Decision, mechanical.** `hours_within_day` = PoR-LF `lag_h_mod_24` of `nov_all` if it agrees with the
`circmean_h` of (3) for PoR-LF within 2 hours (difference taken into `(-12, 12]`), else the text `disagree`.
Let `h` = `hours_within_day` if it is a number, else the PoR-LF `lag_h_mod_24` of `nov_all`. From (1), if
decisive: `n1 = k_days` if `h < 12`, else `k_days - 1`. From (4), if `n_matched_below_3000 >= 3`: `n4 =
round((median_lag_h_below_3000 - h) / 24)`. `whole_days_status` = `resolved` if `n1` and `n4` both exist and
are equal, or exactly one exists; otherwise `unresolved`. `whole_days` = that number when resolved.
`total_delay_h = 24 * whole_days + h` when resolved. Report `h`, `n1`, `n4`, `whole_days_status`,
`whole_days`, `total_delay_h` as metrics; do not choose anything beyond this rule.

**The model's assumed times**, S0 logged, used runs by phase: table `W3_model_times`: `phase, n, mean_trv_t,
mean_trv_gf2lf, mean_total` (mean of `trv_t + trv_gf2lf`), `mean_hist_ago`.

**Damping.** Per period P4 to P7, over days that are non-event at both PoR and LF with the quantities
defined: table `W3_damping`: `period, n_days, median_A_a_rel_lf_flow, median_A_a_rel_por_flow,
ratio_lf_over_por, median_A_a_por_level, median_A_a_ef_level, median_A_a_lf_level` (the EF median over the
same days where EF is also non-event).

## W4. How the model passes the wave on

Used runs with a T1 for S0 logged. `e_raw` and `e_final` from S0 logged `raw_cfs` and `final_cfs`.
`hour_due` = local hour (integer 0 to 23) of `runs.due_utc`; `hour_run` = local hour of `at_utc`.
Table `W4_runs`: `seq, at_utc, due_utc, phase, gate_miss, hour_run, hour_due, raw_cfs, final_cfs, corr_c,
corr_st, ceil_bound, t1, e_raw, e_final`.
Table `W4_error_by_hour`: `phase, hour_due, n, mean_e_raw, mean_e_final`. An hour is "valid" for a phase if
it has at least 3 runs of that phase.
Per phase, table `W4_cycle`: `phase, quantity, n, mean, cycle_size, lo, hi, crest_hour,
share_of_variance_by_hour, sd_remainder` for the quantities `e_raw` and `e_final`: `n` and `mean` over all
runs of the phase; `cycle_size` = half the range of the hourly means over valid hours (blank if fewer than
two valid hours), with its day-block interval `lo, hi`; `crest_hour` = the valid hour with the largest mean
(ties to the earliest hour); over the runs in valid hours only, `share_of_variance_by_hour` = 1 - (sum of
squared deviations from the run's hourly mean) / (sum of squared deviations from the mean of those runs), and
`sd_remainder` = standard deviation of the deviations from the hourly means. Also, as metrics, the difference
in `cycle_size` NEW minus OLD for `e_raw` and for `e_final`, each with a two-group day-block interval.

**Components.** For phase OLD and phase NEW, by `hour_run`: means of `pre_cfs`, `delta_ratio` (non-blank),
`raw_cfs`, `corr_c`, `final_cfs`, `ceil_lim` (S0 logged); and of T1 by `hour_due`. Table `W4_components`:
`phase, quantity, hour, n, mean`. Table `W4_component_cycles`: `phase, quantity, mean, cycle_size,
cycle_size_pct_of_mean, crest_hour` (`mean` over all runs of the phase with the quantity; cycle over valid
hours as above).

## W5. Candidate explanations

All in phase NEW unless stated; errors against the estimate's own truth; `cycle` = `cycle_size` of the error
by `hour_due` as in W4 (`hour_due` from the estimate's own due time). Every difference `diff = value_a -
value_b` gets a day-block interval and, unless stated, a label (common part, section 4).
Table `W5_candidates`: `candidate, variant, old_rule, quantity, value_a, value_b, diff, lo, hi, share_p,
lo_p, hi_p, label` with one row per line below and quantity (`old_rule` blank where not applicable; `share_p`
columns only on cycle rows).

- **H1, which reading is picked** (`replay_2x2x2.csv`; `old_rule` B is the main one, A and C sensitivities):
  variant `new_numbers`: a = cell (`flow_numbers = new, reading_pick_from = new, due_from = new`), b = cell
  (`new, old, new`); variant `old_numbers`: a = (`old, new, old`), b = (`old, old, old`); quantities `MAE` and
  `cycle`. Also quantity `mean_delay_h` (no label) = mean of `trv_t_of_pick_h + gf2lf_h` over the runs of
  cell a and of cell b.
  **H1 verdict** (metric `h1_verdict`, per `old_rule`): take `total_delay_h` from your own W3 decision. If W3
  is resolved: "supported" if `total_delay_h` is closer to the `mean_delay_h` of one of the two `new_numbers`
  cells than to the other by at least 2 hours and that cell has the smaller `MAE`; "not supported" if it is
  closer by at least 2 hours to the cell with the larger `MAE`; otherwise, or if W3 is unresolved,
  "undetermined".
- **H7, the due time** (`old_rule` B, A, C): a = cell (`new, new, new`), b = cell (`new, new, old`); `MAE` and
  `cycle`.
- **H3, the rise/fall factor**: a = S0 logged raw; b = the estimate without the factor, `raw_cfs /
  delta_ratio` where `delta_ratio` is non-blank, else `raw_cfs`; `MAE` and `cycle`. Variants `NEW` and `OLD`
  (the phase).
- **H4, switching between corrections**: first check on all used runs that `final_cfs` equals `min(raw_cfs -
  corr_c, ceil_lim)` within 1 cfs and report the count that do not (metric `h4_formula_mismatches`). Variant
  `mean_correction`: a = `e_final`; b = the error of `min(raw_cfs - m, ceil_lim)` where `m` is the mean of
  `corr_c` over the phase's runs (recomputed in each resample); `MAE` and `cycle`. Variant `final_vs_raw`: a =
  `e_final`, b = `e_raw`; `cycle` only.
- **H6, the 120% cap**: a = `e_final`; b = the error of `raw_cfs - corr_c` (no cap); `MAE` and `cycle`. Also,
  as metrics, the share of runs with `ceil_bound = 1` in each phase.
- **H8, changes of flow state** (no label): per UTC day, the number of changes of `corr_st` between
  consecutive used runs of that day (runs of one phase only; days with at least 3 runs of the phase).
  Quantity `flips_per_day`: a = mean per day in `S-new` (from `replay_runs.csv`), b = mean per day in
  `S-old-B` (A and C as sensitivities, in `old_rule`), variants `NEW` and `OLD` (the phase of the days). Also
  the S0 logged mean per day for both phases, as metrics.
- **H2, the wave itself** (no label): quantity `median_A_a`: a = over the non-event days of P7, b = over the
  non-event days of P5 and P6 together, for PoR level, PoR flow, LF level, LF flow (`variant` = the series),
  with `diff`, its two-group interval, and the ratio a / b as a metric.
- **H5, too few checks**: quantity `cycle`: a = phase NEW, b = phase OLD, of `e_raw`, with a two-group
  interval; variants `S0_logged`, `S-new`, `S-old-B` (and `S-old-A`, `S-old-C`), each scenario's estimates
  against its own truth and its own `hour_due`. The label uses `share_p` with `c_ref` as defined.
- **H9, pumping** (no label, no test possible with these data): quantity `median_A_a`: a = EF level, b = LF
  level, over the days of P7 that are non-event at both; ratio a / b as a metric.

## W6. What the job's own checks see

Table `W6_checks` (20 checks, by `created_at_utc`): `seq_check, run_seq, phase, bin, st, hour_pred` (local
hour of `predTs_utc`), `hour_due` (of `dueAt_utc`), `hour_check` (of `valAt_utc`), `delayMin, errPctRaw,
errPctCorr` (`run_seq` and `phase` blank for the check without a run).
Table `W6_by_bin`: `bin_key, n, hours_pred` (sorted ascending, `|`-joined), `hours_due`.
Metrics, phase NEW: `mean_e_raw_all_runs` (W4 `mean` of `e_raw`), `mean_e_raw_at_check_hours` = the mean,
over the checks whose run is in phase NEW, of the W4 hourly mean of `e_raw` at each check's `hour_due` (checks
at a non-valid hour are skipped and counted), and `n_distinct_hours_due`.

## W7. Is this a recurring pattern? (2011 to 2026)

**(a)** `hourly_backtest_data_v39.csv` (hourly; `timestamp` is UTC in the form `2011-12-01 05:00`, without a
`Z`): series `por_now` and `lf_discharge`, prepared over the whole file with a 60-minute step as the common
part says. A day is a "wave day" at a gauge if it is not an event day there and `A_a_rel >= 0.03`. Table
`W7_year_month`: `year, month, n_days, n_non_event_por, n_wave_por, n_non_event_lf, n_wave_lf,
median_A_a_rel_por, median_A_a_rel_lf` (medians over non-event days with a defined value). Table
`W7_flow_class`: by the day mean of `lf_discharge`, classes half-open `[0,2000)`, `[2000,3000)`,
`[3000,6000)`, `[6000,inf)` (`class_lo` as key; days without a day mean are left out): `class_lo, n_days,
n_non_event_por, n_wave_por, share_wave_por, n_non_event_lf, n_wave_lf`.
**(b)** `shadow_F.csv` (hourly estimates of the production model, 2011 to 2026): rows with `status =
predicted`, `truthDependentHard = 0`, `truthInProdRange = 1`, non-blank `errPctRaw` and `errPctCorr`, and
`predTs` at or after `2011-12-04T05:00:00.000Z`. Join each row to the UTC day of `predTs` in (a). Keep rows
whose day is not an event day at PoR and has a defined `A_a_rel` at PoR, and with `truthFlow < 3000`. Classes
of that day's `A_a_rel` at PoR, half-open: `[0,0.01)`, `[0.01,0.03)`, `[0.03,0.06)`, `[0.06,inf)`. Table
`W7_error_by_wave`: `class_lo, n_rows, n_days, mean_abs_errPctRaw, mean_abs_errPctCorr,
median_abs_errPctCorr`.

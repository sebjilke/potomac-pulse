# Part W report (Python)

Run: `python3 -I py_W/run_all.py` from the study folder. All questions W1 to W7 were run; every named table and metric was produced (some cells blank, see below). Blindness: I read only the two spec files, `data/tidy/DICTIONARY.md`, `replay/out/OUT_DICTIONARY.md`, the tidy and replay tables, and the two W7 files (headers and rows). I did not open any forbidden file, and not `withdrawals_coop.csv`.

## Row counts of the tables (data rows)
- W1_daily: 415
- W1_periods: 35
- W1_weekday: 70
- W2_clock: 13
- W2_daily: 1328
- W2_periods: 112
- W2_weekend: 42
- W2_xcorr_upstream: 8
- W2_xcorr_upstream_maxima: 16
- W3_crests: 3
- W3_damping: 4
- W3_model_times: 3
- W3_onsets: 7
- W3_size_lag: 15
- W3_weak_days: 8
- W3_weak_matches: 0
- W3_xcorr: 9
- W3_xcorr_maxima: 39
- W4_component_cycles: 14
- W4_components: 335
- W4_cycle: 6
- W4_error_by_hour: 70
- W4_runs: 261
- W5_candidates: 49
- W6_by_bin: 3
- W6_checks: 20
- W7_error_by_wave: 4
- W7_flow_class: 4
- W7_year_month: 180

Metrics file: 88 rows. Series preparation counts (step, readings, grid, present, filled, missing): `prep_counts.csv` and `run_log.txt`. W7: both series step 60 min; por_now grid 130,987 present 127,571 filled 147 missing 3,269; lf_discharge present 128,887 filled 521 missing 1,579.

## Facts requested by the spec
- Phases (S0 logged, used runs): OLD n=71 seq 1 to 71; NEW n=169 seq 107 to 305; TRANS n=35 seq 72 to 106 (metrics, question W3).
- T1 of seq 212 (S0 logged): at `runs.due_utc` 2026-11-19T00:54:28.766Z my own interpolation gives 1600.0 cfs; `truth.csv` (replayed due 2026-11-19T00:50:32.261Z) gives 1600.000. Same value.
- My interpolation rule reproduces `truth.csv` T1 of all other S0 rows to within 0.0005 cfs (n=260).
- W4 set: 261 used runs with a T1; dropped for blank T1: seq 292 to 305 (14). In S-new 261 of 275 have a T1, in S-old-A/B/C 259.
- Check without a run in the log: seq_check 1 (predTs 2026-11-10T19:01:02.131Z). All other 19 checks match exactly one used run.
- W4 cycle interval for phase TRANS is blank: 452 of 2000 resamples undefined (more than 5%). Other skip counts: `boot_skips.csv`.
- W3 results that are blank by rule: n_matched_below_3000 = 2 (less than 3) so n4 is blank; size method not decisive (4 PoR weak days, 0 LF weak days, `W3_weak_matches` has no rows) so n1 is blank; whole_days_status = unresolved, so whole_days and total_delay_h are blank and all three `h1_verdict` values are "undetermined".
- `h4_formula_mismatches` = 0.

## Could not do as specified
- W1: "dates on which the wave starts, weakens or strengthens" are read off W1_daily by the report, not computed; I did not read them off (no interpretation).
- `W4_cycle` TRANS lo/hi blank (see above).
- W3 n1, n4, whole_days, total_delay_h blank (see above); W3_weak_matches empty (a result, not a failure).
- Nothing else was blocked.

## Ambiguities and how I resolved them
1. Readings used for grid and neighbours are those inside the preparation window only (not readings before its start). Grid value at an exact reading time = that reading ("present"); otherwise linear interpolation if neighbour gap <= 30 min (120 min for W7), else missing. Step = most frequent consecutive difference, ties to the smaller. For W7 the window is first to last timestamp of the file.
2. Thresholds of "at least 95% / 90%" computed as integer comparisons count*100 >= 95*points. For partial days (1 Sep has no MA before 12:00, 22 Nov ends 10:00) the day's grid points are the points that exist on the grid. The 22 Nov row exists in the daily tables.
3. Day mean denominators, A_a, crest/trough use the grid points of the UTC day; crest/trough smoothed values may use d of adjacent days. Local hour-of-day of crest/trough = local conversion of the UTC time of the grid point (rule of the common spec by UTC time), not of the UTC hour-of-day.
4. A_b window must have start >= window start and end <= window end; fit with centred linear term (changes only the intercept).
5. `day_utc` is written as YYYY-MM-DD. `gate_miss` blank when none.
6. Event flag: flow series by its own MA; level and PoR temperature use the same gauge's flow series; EF its own level rule (> 0.10 ft). Undefined MA = event day. "Non-event days" of a period require not-event and a defined A_a. `median_A_b` and crest/trough circular means use those days with the value defined.
7. W1_weekday lists all 7 weekdays per series and window, blank median when n_days = 0. W2_weekend ratio blank if weekday median is blank or zero.
8. W2 clock test uses `crest_utc_h` / `trough_utc_h`; windows before/after exactly as given; resample draws use u1.. for before and u61.. for after; a statistic is always defined when both groups are non-empty.
9. Lagged correlation: pairs also require both days inside the analysis window; arrays are trimmed to the window days; lag grid step = 5 min if both series are 5 min, else 15 min (W3 forces 5 min and interpolates the 15-min EF d to 5 min between non-missing neighbours); r undefined if fewer than 3 pairs or zero variance; local maxima require defined neighbours; ties for max go to the smallest lag (abs lag, then non-negative first for the instrument test). `lag_h_mod_24` = lag hours mod 24. n_points is that of the reported lag.
10. Instrument test metric names I chose: r_lag0, n_points_lag0, lag_of_max_abs_r_h, max_abs_r, median_A_a_temp_c (group = P5, P6, P7), plus n_non_event_temp.
11. W3 (1) and weak days: the daily A_a series and the neighbours are restricted to 15 Sep to 22 Nov; D and D+k both inside; weak-day classification only for non-event days with defined A_a; neighbours counted only if non-event with defined A_a and inside the range. Decisive: at least two distinct PoR weak days with a match and all matches share one k_days.
12. W3 onsets: the "same condition" for the 72-hour exclusion is the condition MA(t+24h) - MA(t) >= 0.10 ft (any earlier grid time satisfying it, onset or not). LF onset matched to a PoR onset may repeat across PoR onsets (first LF onset within 0 to 96 h). Unmatched PoR onsets listed with blanks.
13. W3 decision: h equals the PoR-LF lag_h_mod_24 of nov_all in both branches; round half away from zero; "agree within 2 hours" is <= 2. Metrics hours_within_day, h, n1, n4, whole_days_status, whole_days, total_delay_h.
14. W3_damping day set: days of the period that are non-event at PoR flow and LF flow, with A_a_rel defined at both flows and A_a defined at PoR level and LF level; EF median over those days where EF is non-event with a defined A_a.
15. W3_model_times uses S0 logged runs of all used runs by phase (including phase TRANS), all 275, blanks skipped in means.
16. W4 and W5 use the set of used runs with a T1 (261). Phase TRANS rows are included in W4_runs, W4_error_by_hour and W4_cycle (three phases). W4_error_by_hour lists every hour with at least one run (valid hours are those with n >= 3). W4_component_cycles `cycle_size_pct_of_mean` = 100 * cycle_size / mean (signed mean). Component hour is hour_run except T1 (hour_due).
17. Bootstrap blocks: UTC day of at_utc, universe = days with at least one row of the phase in the statistic (identical universes for all single-group NEW candidates, checked). Percentile interval skips undefined resamples; blank when more than 5% skipped. For single-group statistics draws use u1..; second group u61...
18. W5 cell comparisons: each cell's errors use that cell's raw_cfs against T1 of its due_from scenario and the hour of the cell's own due_utc; runs with blank T1 dropped per cell (a and b may then differ in run set). `mean_delay_h` is over all NEW-phase runs of the cell with both fields present (no T1 needed) and carries a diff and interval, no label. H1 `old_rule` rows A, B, C; H7 rows B, A, C.
19. H3 OLD variant: the share p uses c_ref from the NEW phase drawn as a second group (columns u61 onward). H5 `old_rule` left blank (variant carries the scenario). H4 `mean_correction` m = mean of corr_c over the drawn NEW-phase runs of the W4 set; min with ceil_lim when present. H6 share of runs with ceil_bound = 1 uses all used runs per phase (metrics h6_share_ceil_bound_1, h6_n_runs_ceil_bound_1, groups NEW, OLD, TRANS).
20. H8: runs of one phase per UTC day in order of at_utc, days with >= 3 runs of that phase, all used runs (no T1 needed); S-new/S-old values from replay_runs `corr_st`; S0 logged from runs.csv (metrics h8_s0_logged_flips_per_day, h8_s0_logged_n_days).
21. H2 medians in raw A_a units (flow in cfs, level in ft), variants por_level, por_flow, lf_level, lf_flow; metric h2_ratio_a_over_b (group = variant) plus day counts. H9 over days of P7 non-event at EF (own rule) and LF flow, with diff and interval; metric h9_ratio_a_over_b.
22. W6: join on all rows of runs.csv (each matched exactly one used run); `bin_key` = bin + "_" + st (as in bins.csv); hours lists sorted ascending joined with "|"; phase NEW metrics also give counts of checks in the mean and skipped (0 skipped).
23. W7: n_days counts the UTC days of the file's grid in the month (first and last days partial); n_non_event counts non-event days regardless of whether A_a_rel is defined; share_wave_por = n_wave_por / n_non_event_por. shadow_F has one arm only (F); truthFlow must be non-blank and < 3000; all rows with predTs >= the stated bound; filters compared as strings ('0', '1').
24. Extra metric rows beyond those the spec names are context counts (names contain n_ or similar).

## Addendum 2.1

Applied A1 to A6 in `ppw.py` (rnd9, crest/trough, crest_hour_of) and in `q_w12.py`, `q_w456.py`. Previous results are kept in `tables_v2/` and `metrics_v2.csv`. Two reruns of `python3 -I py_W/run_all.py` gave byte-identical tables and metrics. This addendum supersedes the earlier ambiguity items 8 (clock groups), 16 (pct of mean), 18 and 19 where they differ.

Applied: A1 smoothed values, hourly means (W4 `crest_hour`, W4 component `crest_hour`) and lagged-correlation r (for the maximum, rounded key then the tie rule) rounded to 9 decimals half away from zero. A2 clock test now has a = after (u1 onward), b = before (u61 onward); the other two-group statistics already had a on u1. A3 uses abs(mean). A4 paired rows (H1, H3, H4, H6, H7) use the intersection of runs with non-blank estimate and truth for both; H1 `mean_delay_h` uses the runs of the MAE row of the same variant and rule. A5 was already as written (H3 OLD draws c_ref as second group on the NEW days from u61; H5 from group a). A6 names already as written. Nothing in A1 to A6 could not be applied.

Cells changed against `tables_v2/` (tables not listed: 0 changed; metrics.csv: no value changed, only the `w5_n_runs` rows were added):
- W1_daily 2 cells (trough_utc_h, trough_local_h)
- W1_periods 2 (trough_utc_h_circmean, trough_local_h_circmean)
- W2_daily 22 (crest_utc_h, crest_local_h, trough_utc_h, trough_local_h)
- W2_periods 16 (crest and trough circmeans, utc and local)
- W2_clock 58 (crest_before, shift_crest, lo, hi, trough_before, trough_after, shift_trough, lo_t, hi_t)
- W4_component_cycles 1 (cycle_size_pct_of_mean)
- W5_candidates 42 cells in 9 of 49 rows (value_a, value_b, diff, lo, hi)
- All other tables 0.

`w5_n_runs` (group candidate|variant|old_rule|quantity; in metrics.csv): H1 new_numbers 155 (all rules and quantities), H1 old_numbers 153; H7 153; H3 NEW 155, H3 OLD 71; H4 mean_correction 155, final_vs_raw 155; H6 155; H8 8 days (NEW) and 4 days (OLD); H2 por_level 20, por_flow 20, lf_level 18, lf_flow 18 (days of both groups together); H9 7 days; H5 S0_logged 226, S-new 226, S-old-A/B/C 224 (NEW plus OLD runs). Counts for H2, H8, H9 are days, not runs.

A7 diagnostic, Catoctin 01637500 level 00065, 2026-10-26: step 15 min; 288 grid points in the window 2026-10-25T00:00Z to 2026-10-28T00:00Z (exclusive); 288 non-missing. Fitted a = 1.56, b = -4.35593987948e-18, c = -7.87737571652e-17, s = -1.67170282204e-16; A_b = 1.84800454735e-16; phi_b_utc_h = 16.3179540954. Method: normal equations (4x4) accumulated in floating point and solved by Gaussian elimination with partial pivoting, no library; tau = hours since the window start (2026-10-25T00:00Z) for the cosine and sine terms; the linear regressor is (tau - 36) and the reported a is the intercept converted back to tau (a = a_centred - 36 b), which changes neither b, c nor s. This is the recipe of the common part, point 6; no departure found, method unchanged. (The W2_daily row shows A_b 1.8480045473452726e-16 and a day mean 1.5599999999999998.)

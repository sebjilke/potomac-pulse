# Part R, Python analyst: report

No file outside the allowed list was opened. Withdrawals file was read (Part R uses it); the free-text column was not used. No other analyst's folder was seen.

## What ran
`python3 -I py_R/run_all.py` (about 10 s). Questions R1 to R8 all complete. A second run from scratch gave identical md5 for every table and metrics.csv.
Self-check: my own linear interpolation of Little Falls flow (census table) reproduces `truth.csv` `t1_lf_cfs_interpolated` for all 1,299 non-blank (seq, scenario) rows within 0.0006.

## Row counts (data rows, without header)
R1_rewrite_groups 1; R1_by_day 101; R1_by_level 576; R1_by_level_band 25; R1_ratio_day_band 31; R1_old_copies 9; R1_log_pairs 71;
R2_series 8; R2_por_level_octpull 1; R2_por_level_log_mismatch 1;
R3_visits 1000; R3_measured_vs_published 13; R3_bulk_rewrites 20;
R4_0_por 5; R4_0_upstream 8; R4_a_days 68; R4_a_verdicts 12; R4_b_days 74; R4_b_verdicts 12; R4_c_runs 165;
R5_runs 275; R5_split 48; R5_split_by_day 36; R5_extrapolation 9; R5_chain 15;
R6_checks 20; R6_bins 3; R7_ranges 6; R7_bins 14; R8_inputs 18; R8_daily 15; metrics.csv 279 rows.

## Counts at steps
- R1: 43,500 pairs (old archive PoR flow x census PoR flow, both non-blank); no old value is 0. Changed 9,214; REV13 9,214; current census readings stamped in the 19:41 minute 10,306.
- Readings: rows with a blank value are skipped (5 in archive, 2 in census PoR/LF, 5 in model); no duplicate keys; no row after the cutoff.
- R3: 2 duplicate rows dropped (both PoR); 2,472 rows kept; visits with more than one Discharge or MeanGageHeight row: PoR 7, LF 17.
- Series preparation (R4 window 2026-08-31 to cutoff): steps and counts present/filled/missing are in `metrics.csv` (question R4, group `series_<name>`) and `run_log.txt`. No step ties. No gap filled using a neighbour outside the window.
- R4(a): 68 days (2026-09-03 to 2026-11-09), 38 steady, 21 steady revised, 17 steady unrevised.
- R4(c): 275 used runs; 14 dropped for blank T1; 96 dropped for missing W (due date after the last withdrawal date); 165 kept (OLD 32, TRANS 35, NEW 98).
- R5: phases OLD 71 runs (seq 1 to 71), TRANS 35 (72 to 106), NEW 169 (107 to 305). Dropped for a missing T1 in the three-term split: own basis 16 per rule, common basis 14 per rule.
- R6: the check without a run in the log is seq_check 1, predTs_utc 2026-11-10T19:01:02.131Z.
- Seq 212: T1 of S0 logged computed at runs.due_utc (2026-11-19T00:54:28.766Z) = 1600 cfs; T1 of the replayed S0 row (due 2026-11-19T00:50:32.261Z) = 1600 cfs (also in metrics.csv, R4).

## Could not do as specified
- R7_bins: the spec says 18 flow bins; `bins.csv` has 14 `gf_correction_bin` rows without the `stage_` prefix (the other 14 rows are stage bins). 14 rows written. The four flow-bin keys absent from the file (12000-25000_steady and the three 50000+ keys) were not computed.
- R7_ranges: the range `[50000, inf)` has no REV13 pair; row written with n = 0 and blanks.
- R4_0_por: f_old values exist only from 2026-11-10; for the four visits before that, the f_old columns are blank. old_inside_band for the 2026-11-10 visit is blank (no old reading; the f_old columns carry that comparison).
- R4(a): `b_u` equals 0.15 (the largest band of the four U gauges on 2026-11-22); not a failure, noted for completeness. The empirical centre was computable for lags 0, 1, 2 (16, 17, 16 steady unrevised days with a ratio).
- R4(c) day-to-day (phase NEW): only 5 days have W for the due date; statistics are on 5 days.
- Intervals: no resample was skipped anywhere (means are always defined).

## Ambiguities and how I resolved them
1. Series preparation neighbours: neighbours for interpolation are all non-blank readings of the series up to the cutoff, not only those in the preparation window (no gap used one).
2. Day mean of a partial day (2026-11-22, grid ends 10:00): the 90% rule is applied to the grid points that exist that day; the day is therefore defined if the partial day is complete enough.
3. Event day uses grid MA at D 00:00 and D+1 00:00; MA(2026-11-22 00:00) is undefined (needs 12:00 on the cutoff day), so 2026-11-21 is an event day by the rule.
4. 95% / 90% thresholds are integer tests (100*count >= 95*N, 100*count >= 90*N).
5. R1 rewrite group key = `lm` truncated to the minute. Level (R1) keyed on round(level*100) half away from zero; `level_ft` written as hundredths/100; bands on the integer, half-open, 25 per band.
6. R1.6 lookup L(h): median (type 7) of old flow of REV13 pairs per level, running maximum, interpolation between adjacent levels present in the file; `s` in feet.
7. R1.7: `n_days_<band_lo>` written for all three bands (also those with fewer than 5 days); slope only with at least 5 days. Metric keys use band_lo with two decimals (1.00, 1.10, 1.20).
8. R1.8: join uses non-blank values on both sides; `n_shared` counts those.
9. R1.9: ratio = current / logged. Metrics have blank group.
10. R2: "current record" for each old series = model table, except Little Falls flow = census. n_pairs etc. count both-non-blank pairs. R2_por_level_octpull has the columns gauge, parameter plus the listed ones.
11. R3.1: duplicate rows keep the first row in file order. `last_modified` is written as ISO with `Z` instead of `+00:00`. `n_reference_rows` = rows with reading_type ReferencePrimary. `visit_time_utc` of a visit without Discharge = earliest of its rows. Visit year for the per-year counts = year of `visit_time_utc`. Median days between visits: metric `median_days_between_visits`, group = gauge (also `n_intervals_...`).
12. R3.3: `share_of_readings_in_bulk` = readings in bulk groups / non-blank census readings of the gauge; `days_since_last_visit` uses visits with a discharge at or before `lm_minute`.
13. R3.2 and R4(0): nearest reading within 15 minutes inclusive, earlier on tie; old values from the archive; current PoR from census.
14. R4 bands: Unspecified, blank, any other rating = 0.15. "Latest visit with a discharge on or before that day" = visit time before the end of that UTC day.
15. R4(0) upstream: visits with no current reading within 15 minutes would be kept with blanks (none occurred).
16. R4(a): median ratios and n_days are over steady revised days where PoR old, PoR current and U(D-g) all exist. Empirical centre = median of ratio_new over steady unrevised days of the same lag. Table rows sorted lag, centre_kind, band_kind; `c` is the last column. For band_kind `fixed_0113`, b_por and b_u are still reported as computed, `b` = 0.113.
17. R4(b): `b_PoR` and `b_LF` for each set are taken at the set's days D (the `day_utc` of the rows). I also computed the PoR band at D-g; it never differed (a note would be in run_log.txt; none is there). Percent-of-median-LF values are in metrics.csv (question R4, group `lag<g>_<set>`). "after Nov 9" = day_utc > 2026-11-09, any set; metrics `median_resid_new_after_nov9` and `n_after_nov9`, group `lag<g>`. Rows of the verdict table with no days have only n_days = 0.
18. R4(b/c) flagged withdrawal values used: 0 (metrics `n_flagged_w_values_used_b`, `_c`).
19. R4(c): day blocks for the intervals = UTC day of `at_utc`; per-phase metrics are written to metrics.csv (group = phase; `_lo`/`_hi` suffix for the interval). Phases OLD, TRANS, NEW only. Day-to-day: group `day_to_day_NEW`.
20. R5_runs "the three label columns": I used `label_flow_state_rise_rate`, `label_time_shift`, `label_delta_correction`. If `cur_label`, `back6_label`, `hist_label` were meant, they are in `replay/out/labels.csv` and not in my table.
21. R5_runs: `at_utc` and `due_utc_*` are the original strings of the source tables; `due_utc_s0` = `runs.due_utc`; `t1_s0` of seq 212 = my own interpolation.
22. R5_split: `phase` ALL included; sort order is text order of the key columns (old_rule, due_basis, set, phase). Intervals = day-block bootstrap of the mean of the pooled rows of the cell. Under `common`, `e_new` = scenario S-new raw against T1 of (seq, S0).
23. R5_extrapolation and R5_chain: phases OLD, TRANS, NEW only (no ALL). Shares are over all runs of the phase (n); means over non-blank values only.
24. R6: checks joined to all 305 run rows by `final_ts_utc`; every match was a used run. R6_bins keys = `bin_st`; sort by created_at_utc; `checks_per_day_NEW` uses the cutoff 2026-11-22T10:00:00Z.
25. R7_bins: `last_check_in_window_utc` is the original `created_at_utc` text of the latest check of that bin key.
26. R8_inputs: `n` counts comparisons with both values present (none skipped); rows only for field/group pairs with n > 0.
27. R8 error comparison: `diff` = mean_after minus mean_before (the spec does not fix the sign). Quantities: `e_raw_s0`, `term1` (group = rule B, A, C), `e_raw_new`; metric names `<quantity>_n_before`, `_n_after`, `_mean_before`, `_mean_after`, `_diff`, `_diff_lo`, `_diff_hi`. Own-basis values, phase NEW, both groups' day blocks resampled independently (u1 onward for before, u61 onward for after). `term1` runs must have all three T1 values (same as the R5 split); `e_raw_s0` and `e_raw_new` need only their own T1.
28. R8_daily: n_runs counts all used runs of the day and phase; means of term1 use runs valid in the split (own basis); LF change uses the previous day's mean (series prepared over the R4 window); the 2026-11-22 day is partial. Slope/Pearson over days with at least 3 runs of the phase, defined term1 and defined change; group = `<phase>_<rule>`.
29. Phase counts and first/last seq are in metrics.csv under question R5, group `phase_<name>`.

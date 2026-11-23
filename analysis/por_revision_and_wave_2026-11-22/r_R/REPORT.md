# REPORT, Part R, R implementation

Run: `Rscript r_R/run_all.R` from the study folder (about 20 s). Two complete runs from scratch gave byte-identical
tables and metrics. `check_tables.R` reports: required columns and order present in 30 of the 31 tables (`R5_runs` is not covered by the script), key sort order
holds, no `NA`/`NaN`/`Inf` tokens, no scientific notation. 31 tables written, all named in the spec.
`metrics.csv`: 365 rows (includes extra count metrics beyond those named).

Files read: this spec pair, `data/tidy/` (DICTIONARY.md and the CSVs), `replay/out/` (OUT_DICTIONARY.md, labels, truth, replay_runs),
`replay/f_old/f_old_values.csv`. Nothing else was opened. Scratch R files were written to `/tmp` during development (outside my
folder) and deleted before finishing.

## Questions complete
R1, R2, R3, R4 (0, a, b, c), R5, R6, R7, R8 (a, b): all tables produced. Gaps are listed under "could not do as specified".

## Input row counts (after cutoff filter; no row was after the cutoff)
census 271,042; model 375,865; upstream 126,281; old archive 303,659 (84 rows earlier than 2026-06-12, 12 of them PoR flow); old octpull 57,135.
Blank values: census 2 (LF flow 2026-11-07T19:50Z and 20:40Z), model 5, old archive 5. runs 305 (used 275); labels 275; truth 1,375;
replay_runs 1,375; checks 20; bins 364; field_measurements 2,474 (PoR+LF 2,095 rows, 2 duplicates dropped, both PoR); withdrawals 50 rows
(every `withdrawal_date` unique; 4 blank `total_net` values, all carrying a flag; 0 flagged values used); f_old_values 3,576.

## Row counts of every table
R1_rewrite_groups 1; R1_by_day 101; R1_by_level 576; R1_by_level_band 25; R1_ratio_day_band 31; R1_old_copies 9; R1_log_pairs 71;
R2_series 8; R2_por_level_octpull 1; R2_por_level_log_mismatch 1; R3_visits 1000; R3_measured_vs_published 13; R3_bulk_rewrites 20;
R4_0_por 5; R4_0_upstream 8; R4_a_days 68; R4_a_verdicts 12; R4_b_days 74; R4_b_verdicts 12; R4_c_runs 165;
R5_runs 275; R5_split 48; R5_split_by_day 36; R5_extrapolation 9; R5_chain 15; R6_checks 20; R6_bins 3; R7_ranges 6; R7_bins 14;
R8_inputs 18; R8_daily 15. (Also in `rowcounts.csv`.)

## Counts at steps
- R1: pairs 43,500; changed 9,214; REV13 9,214 (all changed pairs fall in the 2026-11-13T19:41 minute; one rewrite group); REV13 pairs with a level 9,214;
  shift undefined 25. Pairs if the archive were restricted to 2026-06-12 on: 43,488 (metric `n_pairs_all_if_archive_restricted_from_2026-06-12`).
- R3.1 per gauge, duplicate rows dropped: PoR 2, LF 0. Visits with more than one Discharge or MeanGageHeight row: PoR 7, LF 17. All visits: PoR 586, LF 414.
- R3.3 bulk groups (>= 96 readings): PoR 11, LF 9.
- Truth: own linear interpolation reproduces `truth.csv` `t1_lf_cfs_interpolated` on all 1,375 rows within 0.001 (truth.csv is rounded to 3 decimals).
  S0 T1 blank for 14 used runs (dropped). Seq 212, S0 logged T1 computed at `runs.due_utc` (2026-11-19T00:54:28.766Z): 1600.000; truth.csv value at its replayed due time: 1600.000.
- Phases (by `label_all_three`): OLD 71 runs (seq 1 to 71); TRANS 35 (72 to 106); NEW 169 (107 to 305); ALL 275 (1 to 305).
- R4(c): runs with T1 261; dropped for blank W: 96 (withdrawals end 2026-11-19); table rows 165 (OLD 32, TRANS 35, NEW 98).
- R5 dropped for missing T1: own basis 16 (rules A, B, C each, set all); common basis 14. Without 212 and 217 the same counts (neither run is among the dropped).
- Bootstrap: no resample was skipped anywhere; no interval is blank.
- Series preparation (R4 window 2026-08-31T00:00Z to cutoff, one preparation per series): step and counts are in `metrics.csv`, question `PREP_R4`, group = series
  (por_old, por_cur, lf, shep, mill, ant, cat, mono, goose, br, sen, por_lev).

## Ambiguities and how I resolved them
1. Old archive rows before 2026-06-12 (the extra hour): kept for R1/R2 (no window is named there). Alternative count given above.
2. Rows with a blank value are not readings: excluded from pairs, joins, and from the R3.3 groups and its denominator (LF census readings 160,041; PoR 110,999).
   `n_current_stamped_1941` counts all PoR census rows in that minute (PoR has no blank rows).
3. R1.6 metric names: `mean_r, sd_r, cv_r, n_r, mean_q, ..., mean_s, ..., n_shift_undefined` (group blank). `s` statistics use the pairs where it is defined.
4. R1.8 `n_shared` = shared times with both values non-blank (no blank pairs occur). R1.9 ratio = current / logged.
5. R1.7 `band_lo` metric suffix is written `1.00`, `1.10`, `1.20`; `n_days_<band>` is reported for every band, slope only if >= 5 days.
6. R3.1: `n_rows` counts rows after removing duplicates; `n_reference_rows` counts rows of reading type ReferencePrimary. Latest-`last_modified` rule applied by parsed time to the microsecond, then largest `feature_id` in text order.
   Median-gap metric name: `median_days_between_visits_<gauge>`; visits before 2021-01-01 are excluded before differencing. Extra count metrics are in group = gauge.
7. R3.2/R4: "nearest within 15 minutes" is inclusive of exactly 15 minutes; earlier reading on a tie. R4 `band_pct` is in percent (2, 5, 8, 15) from the visit's own rating; inside = `abs(pct) <= band_pct`.
8. R4(0): f_old columns are filled for every visit that has an `f_old_values.csv` stamp within 15 minutes; only the 2026-11-10 visit qualifies.
9. R4 bands "on a day": latest visit with a discharge whose visit time is before the end of that day; `b_por` = largest of the per-day bands over the days used for that lag (R4a) or over days D-g (R4b);
   `b_lf` over days D. `b_u` = largest band of the four U gauges on 2026-11-22. A band that cannot be determined would be blank; none occurred.
10. R4(a): `n_days` = steady revised days where both ratios exist for that lag. Event flag used for "steady" is that of day D itself. Empirical centre rows exist (>= 10 steady unrevised days for every lag: 16, 17, 16).
11. R4(b): the percent-of-median-LF values and band components are in `metrics.csv` (question R4, group `lag<g>_<set>`) because the table columns are fixed. `median_resid_new_after_nov9` / `n_after_nov9` pool revised and unrevised days with resid_new defined (group `lag<g>`).
12. R4(c)/R5 T1 of seq 212: my interpolated value is used for S0 logged, including as the common T1 (`..._commondue` columns, `due_basis = common`).
13. R5_runs: "the three label columns" of labels.csv is ambiguous; I included `cur_label, back6_label, hist_label` and the four component labels (`label_flow_state_rise_rate, label_time_shift, label_delta_correction, label_all_three`).
14. R5_split: `mean_abs_e_old` = mean of abs(term1 estimate error) for rule X, `mean_abs_e_new` = mean abs error of S-new, same runs, same basis. R5_extrapolation and R5_chain list phases OLD, TRANS, NEW only (no ALL).
15. R8(a): group 1 (before the switch) uses uniform columns u1 onward, group 2 (after) u61 onward; `diff` = mean_after - mean_before. Metric names `<quantity>_n_before ... _diff, _diff_lo, _diff_hi, _diff_nskip`, quantity `e_raw_s0`, `term1` (group = rule A/B/C), `e_raw_new`.
    R8(b): `n_runs` counts all used runs of the day and phase; means are over runs with a value; regression uses days with n_runs >= 3 and both quantities defined; groups `OLD_B`, `NEW_B`, etc.
16. Series preparation: readings used for the step and as interpolation neighbours are those inside the preparation window; ties for the most frequent step go to the smaller step (none occurred: 5 and 15 minutes).
17. R6: join to ALL 305 runs by `final_ts_utc`; the unmatched check is `seq_check` 1 (predTs 2026-11-10T19:01:02.131Z), also in metrics. `ema_after_last_check` = `binAfter_emaMeanError` of the chronologically last check; `ema_before_first_check` = `binBefore_ema` of the first.
18. Sorting: text keys are sorted alphabetically in the C locale (for example `empirical` before `fixed`, `common` before `own`, `ALL, NEW, OLD, TRANS`), numeric keys numerically.
19. Numbers are written with 15 significant digits; `band_lo` and `level_ft` are numbers (so `1` not `1.00`).

## Could not do as specified
- R7_bins: `bins.csv` has only 14 of the 18 flow-bin keys among the live `gf_correction_bin` rows (no `12000-25000_steady`, no `50000+` bins). Table has 14 rows; nothing invented.
- R7_ranges: range `[50000,inf)` has no REV13 pair (n = 0, other cells blank).
- No other recipe failed. Items that cannot be confirmed from data alone: none flagged beyond the ambiguities above.

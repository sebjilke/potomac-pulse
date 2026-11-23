<!-- Saved by the orchestrator on 2026-11-23 from the R analyst's final message, by script, unedited. The analyst could not write this file itself (its file tool refused report files). -->

# Part W (R, base R only): final report

**Status.** W1 to W7 are all complete. The scripts are in `r_W/`.
- Every table has the exact columns and order from the spec. `r_W/check_tables.R` confirms all 29 headers.
- Two full runs from scratch gave byte-identical tables and metrics.
- **`r_W/REPORT.md` was NOT written.** The Write tool refused the file ("subagents should return findings as text"). I did not work around it. The report content is below and is the content of REPORT.md.
- `r_W/README.md` exists (written before the refusal).

**Run command** (from the study folder, about 40 s): `Rscript r_W/run_all.R`. Header check: `Rscript r_W/check_tables.R`.

**Files.**
- Code: `lib.R` (all shared recipes), `q_W12.R`, `q_runs.R`, `q_W3.R`, `q_W456.R`, `q_W7.R`, `run_all.R`, `check_tables.R`.
- `r_W/tables/*.csv` and `r_W/metrics.csv` (127 rows).
- Two extra tables not in the spec: `tables/series_prep.csv` (step and present/filled/missing counts per prepared series) and `tables/boot_skipped.csv` (skipped resamples per interval).

## Row counts per table
| table | rows | table | rows |
|---|---|---|---|
| W1_daily | 415 | W4_runs | 261 |
| W1_periods | 35 | W4_error_by_hour | 70 |
| W1_weekday | 70 | W4_cycle | 6 |
| W2_daily | 1328 | W4_components | 335 |
| W2_periods | 112 | W4_component_cycles | 14 |
| W2_clock | 13 | W5_candidates | 49 |
| W2_weekend | 42 | W6_checks | 20 |
| W2_xcorr_upstream | 8 | W6_by_bin | 3 |
| W2_xcorr_upstream_maxima | 16 | W7_year_month | 180 |
| W3_xcorr | 9 | W7_flow_class | 4 |
| W3_xcorr_maxima | 39 | W7_error_by_wave | 4 |
| W3_crests | 3 | series_prep (extra) | 27 |
| W3_size_lag | 15 | boot_skipped (extra) | 102 |
| W3_weak_days | 8 | | |
| W3_weak_matches | 0 | | |
| W3_onsets | 7 | | |
| W3_model_times | 3 | | |
| W3_damping | 4 | | |

## Could not do as specified
- **W4_cycle, phase TRANS:** `lo` and `hi` are blank. 452 of 2,000 resamples had fewer than two valid hours, which is more than the 5 % limit.
- **W5_candidates, H3 variant OLD, row `cycle`:** `lo_p` and `hi_p` are blank, so the label is "undetermined". `c_ref` (S0 logged `e_raw`, phase NEW) is undefined in all 2,000 resamples, because the drawn OLD days contain too few NEW runs.
- **W3 mechanical decision:** `n1`, `n4`, `whole_days` and `total_delay_h` are blank. The rules give no value: there are no LF weak days, so `size_method_decisive = 0`, and fewer than 3 matches fall below 3000 cfs. `whole_days_status = unresolved`, so the H1 verdict is "undetermined" for old rules A, B and C.
- **W3_weak_matches:** 0 rows, because no LF weak day exists.
- Nothing else was left blank for lack of data.

## Data facts
- **T1 for seq 212.**
  - Own interpolation at `runs.due_utc` (2026-11-19T00:54:28.766Z): 1600.
  - `truth.csv` value at its replayed due (2026-11-19T00:50:32.261Z): 1600.
- **Dropped runs.** 14 used runs (seq 292 to 305) have a blank T1 and are dropped. That leaves 261 runs: OLD 71, NEW 155, TRANS 35.
- **Phases over all 275 used runs.**
  - OLD: 71 runs, seq 1 to 71.
  - NEW: 169 runs, seq 107 to 305.
  - TRANS: 35 runs, seq 72 to 106.
- **Own checks.**
  - The moving average at one index and one lagged correlation (PoR-LF, nov_all) match a brute-force `mean`/`cor` to 1e-14.
  - My LF-flow interpolation reproduces `truth.csv` for all 1,299 non-blank cells, maximum difference 0.0005 cfs.
  - `truth.csv` and `replay_runs.csv` have identical `due_utc` in every row.
- **Series steps.** The 5-minute series are PoR flow, level and temperature, LF flow and level, Broad Run and Seneca. The 15-minute series are EF level, Monocacy, Goose and all 16 upstream series. The two W7 series are 60 minutes (window 2011-12-01T05:00Z to 2026-11-09T23:00Z). Counts per series are in `series_prep.csv`.

## Blindness
- I did not open `withdrawals_coop.csv`, any PLAN or AUDIT file, `research/`, any other `.md` file, any other analyst's folder, or anything in `replay/f_old/`.
- I ran name-only directory listings of the study folder, `replay/out`, `replay/f_old`, `data/tidy`, the parent `analysis/` folder, `../rising-limb-travel-backtest | head` and `../replay_lag_2026-11-17`. No file in them was opened except the two allowed W7 files.

## Ambiguities resolved (the spec is silent or ambiguous; plain reading chosen)
1. **Grid step and neighbours.** Step is the mode of consecutive differences inside the window; ties would go to the smallest. Interpolation neighbours are all non-blank readings up to the cutoff, including those before the window start.
2. **Partial days.** The 90 % and 95 % rules use the grid points of that day that exist in the grid (288 for a full 5-minute day, 121 for 22 Nov, 19 for the first W7 day). Thresholds are `count >= p * n` in real arithmetic.
3. **Wave size (b).** The window must satisfy `D-1 00:00 >= window start` and `D+2 00:00 <= window end`. It covers grid points `[D-1 00:00, D+2 00:00)`.
4. **Event flags.**
   - Level and temperature take the same gauge's flow flag; EF uses level with `> 0.10 ft`.
   - Days where either end MA is undefined are event days. This includes 1 Sep, 21 Nov and 22 Nov.
5. **Periods and weekday tables.**
   - W1_periods lists P1 to P7 only, not P5toP7.
   - Medians and circular means are over non-event days with a defined `A_a`.
   - W1_weekday lists weekdays 0 to 6 even when `n_days = 0` (blank median).
6. **Clock test.**
   - The statistic is after minus before. Group 1 (u1 to u60) is after; group 2 (u61 onward) is before.
   - Intervals are computed when both groups have at least 1 day. The label is "undetermined" if either window has fewer than 4 days.
7. **Lagged correlation.**
   - r is defined when there are at least 3 pairs and both variances are positive.
   - "Both days in window" means the UTC day of t and the UTC day of t+L each lie in the window.
   - On the 15-minute grid, 5-minute series are used at multiples of 15 minutes.
   - EF is interpolated to 5 minutes only for W3(2).
   - Largest r means largest signed r.
   - The instrument test uses the largest |r|, ties to the smallest absolute lag then non-negative. `max_abs_r` is the absolute value; the signed r is in metrics as `r_at_max_abs_lag`.
8. **W3(1) weak days.** Weak days and their neighbour sets are taken inside the daily series 15 Sep to 22 Nov.
9. **W3(4) onsets.** Each PoR onset is matched independently, so an LF onset can be matched twice. `lf_ma_flow_cfs` is the LF flow MA at the LF onset time.
10. **W3 decision.** `hours_within_day` agrees if `abs(diff12(lag_mod_24 - circmean)) <= 2`. `h` is the PoR-LF nov_all `lag_h_mod_24` in both cases.
11. **W4 universe.**
    - It is the 261 used runs with a T1; components use the same runs.
    - W4_cycle is written for NEW, OLD and TRANS.
    - W4_error_by_hour lists every hour with n >= 1; validity (n >= 3) is applied inside the cycle statistics.
    - `cycle_size_pct_of_mean` = 100 * cycle / abs(mean).
12. **Two-group statistics.** Group 1 is the first-named group (NEW, or P7); group 2 is OLD, or P5 and P6 together.
13. **One-group paired comparisons (H1, H3, H4, H6, H7, H8, H9).**
    - a and b are computed on the same runs. A run with a blank T1 or blank estimate in either member is dropped, and the counts are in metrics.
    - The block set is the days of the retained runs.
    - `c_ref` is the NEW-phase S0 logged `e_raw` cycle recomputed on the drawn blocks. `share_p` of the point estimate uses the full-sample `c_ref` of 6.10507...
14. **H1 and H7.** T1 is chosen by `due_from`. `hour_due` is the local hour of the cell's own `due_utc`. Runs are S0 phase NEW.
15. **H4 and H6.**
    - H4 `m` is the resample-weighted mean of `corr_c` over the retained NEW runs.
    - The H4 formula-mismatch count is over all 275 used runs.
    - The H6 `ceil_bound` share is reported over all used runs and over the 261 W4 runs, per phase.
16. **H5.** The scenario goes in `variant` and `old_rule` is blank. Each scenario uses its own estimate, T1 and `hour_due`. Phase comes from the S0 labels.
17. **H8.** Runs are ordered by `seq` within phase and day, and only days with at least 3 runs of the phase count. S0 logged uses `runs.csv`; the scenarios use `replay_runs.csv`.
18. **W6.**
    - `bin_key` is `bin` and `st` joined by `_`, as in `bins.csv`.
    - `phase` comes from the matched used run (all 19 matched runs are used runs); check 1 has no run.
    - `n_distinct_hours_due` counts distinct `hour_due` among the 12 NEW-phase checks.
19. **Local hour.** Floor of the clock hour from the fixed rule (UTC-4 before 2026-11-01T06:00Z, else UTC-5).
20. **W7.**
    - The window is the file's first to last timestamp.
    - `n_days` is the number of UTC days of the grid in the year-month.
    - `n_non_event_*` counts days with event flag 0 whether or not `A_a_rel` is defined.
    - A wave day is non-event with `A_a_rel >= 0.03`.
    - The shadow filters are applied in the order given, with counts in metrics.

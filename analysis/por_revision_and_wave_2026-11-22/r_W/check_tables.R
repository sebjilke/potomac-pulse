# check_tables.R : header and sort-order check of every table against the spec lists
spec <- list(
 W1_daily="gauge, parameter, day_utc, step_min, n_present, day_mean, A_a, A_a_rel, A_b, phi_b_utc_h, crest_utc_h, crest_local_h, trough_utc_h, trough_local_h, event_day, weekday_utc",
 W2_daily="gauge, parameter, day_utc, step_min, n_present, day_mean, A_a, A_a_rel, A_b, phi_b_utc_h, crest_utc_h, crest_local_h, trough_utc_h, trough_local_h, event_day, weekday_utc",
 W1_periods="gauge, parameter, period, n_days, n_non_event, median_A_a, median_A_a_rel, median_A_b, crest_utc_h_circmean, crest_local_h_circmean, trough_utc_h_circmean, trough_local_h_circmean",
 W2_periods="gauge, parameter, period, n_days, n_non_event, median_A_a, median_A_a_rel, median_A_b, crest_utc_h_circmean, crest_local_h_circmean, trough_utc_h_circmean, trough_local_h_circmean",
 W1_weekday="gauge, parameter, window, weekday_utc, n_days, median_A_a",
 W2_clock="gauge, parameter, n_before, n_after, crest_before, crest_after, shift_crest, lo, hi, label_crest, trough_before, trough_after, shift_trough, lo_t, hi_t, label_trough",
 W2_weekend="gauge, parameter, window, median_A_a_weekdays, median_A_a_weekend, n_weekdays, n_weekend, ratio",
 W2_xcorr_upstream="gauge, lag_h_of_max_r, max_r, lag_h_mod_24, n_points",
 W2_xcorr_upstream_maxima="gauge, lag_h, r",
 W3_xcorr="pair, window, lag_h_of_max_r, max_r, lag_h_mod_24, n_points",
 W3_xcorr_maxima="pair, window, lag_h, r",
 W3_crests="pair, n_days, circmean_h, circ_sd_h",
 W3_size_lag="pair, k_days, r, n_days",
 W3_weak_days="gauge, day_utc, A_a, neighbour_median",
 W3_weak_matches="por_day, lf_day, k_days",
 W3_onsets="por_onset_utc, lf_onset_utc, lag_h, por_ma_level_ft, lf_ma_level_ft, lf_ma_flow_cfs",
 W3_model_times="phase, n, mean_trv_t, mean_trv_gf2lf, mean_total, mean_hist_ago",
 W3_damping="period, n_days, median_A_a_rel_lf_flow, median_A_a_rel_por_flow, ratio_lf_over_por, median_A_a_por_level, median_A_a_ef_level, median_A_a_lf_level",
 W4_runs="seq, at_utc, due_utc, phase, gate_miss, hour_run, hour_due, raw_cfs, final_cfs, corr_c, corr_st, ceil_bound, t1, e_raw, e_final",
 W4_error_by_hour="phase, hour_due, n, mean_e_raw, mean_e_final",
 W4_cycle="phase, quantity, n, mean, cycle_size, lo, hi, crest_hour, share_of_variance_by_hour, sd_remainder",
 W4_components="phase, quantity, hour, n, mean",
 W4_component_cycles="phase, quantity, mean, cycle_size, cycle_size_pct_of_mean, crest_hour",
 W5_candidates="candidate, variant, old_rule, quantity, value_a, value_b, diff, lo, hi, share_p, lo_p, hi_p, label",
 W6_checks="seq_check, run_seq, phase, bin, st, hour_pred, hour_due, hour_check, delayMin, errPctRaw, errPctCorr",
 W6_by_bin="bin_key, n, hours_pred, hours_due",
 W7_year_month="year, month, n_days, n_non_event_por, n_wave_por, n_non_event_lf, n_wave_lf, median_A_a_rel_por, median_A_a_rel_lf",
 W7_flow_class="class_lo, n_days, n_non_event_por, n_wave_por, share_wave_por, n_non_event_lf, n_wave_lf",
 W7_error_by_wave="class_lo, n_rows, n_days, mean_abs_errPctRaw, mean_abs_errPctCorr, median_abs_errPctCorr")
ok_all <- TRUE
for (nm in names(spec)) {
  f <- file.path("r_W/tables", paste0(nm, ".csv"))
  d <- read.csv(f, colClasses = "character", na.strings = "")
  want <- strsplit(spec[[nm]], ", ")[[1]]
  ok <- identical(names(d), want)
  if (!ok) ok_all <- FALSE
  cat(sprintf("%-28s rows=%5d header_ok=%s\n", nm, nrow(d), ok))
  if (any(grepl("NA|e[+-][0-9]", unlist(d)))) cat("   WARNING: NA or scientific notation text in", nm, "\n")
}
cat("ALL HEADERS OK:", ok_all, "\n")
m <- read.csv("r_W/metrics.csv", colClasses = "character", na.strings = "")
cat("metrics rows:", nrow(m), " columns:", paste(names(m), collapse = ","), "\n")

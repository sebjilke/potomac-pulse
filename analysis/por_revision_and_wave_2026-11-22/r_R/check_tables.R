# Checks required columns and sort order of every table. Run: Rscript r_R/check_tables.R
farg <- sub("^--file=", "", commandArgs(trailingOnly = FALSE)[grep("^--file=", commandArgs(trailingOnly = FALSE))])
here <- dirname(normalizePath(farg[1])); TAB <- file.path(here, "tables")
spec <- list(
 R1_rewrite_groups = "lm_minute,n_pairs,first_time_utc,last_time_utc,mean_ratio,min_ratio,max_ratio",
 R1_by_day = "day_utc,n_pairs,n_changed,n_rev13,mean_old,mean_current,mean_ratio_rev13,mean_diff_rev13_cfs",
 R1_by_level = "level_ft,n,mean_old,mean_current,mean_ratio,mean_diff_cfs,n_distinct_old,n_distinct_current",
 R1_by_level_band = "band_lo,n,mean_ratio,sd_ratio,mean_diff_cfs,sd_diff_cfs",
 R1_ratio_day_band = "band_lo,day_utc,n,mean_ratio",
 R1_old_copies = "gauge,parameter,n_shared,n_equal,n_different,max_abs_diff",
 R1_log_pairs = "seq,in_por_qT_utc,in_por_h,logged_q,current_q,ratio",
 R2_series = "gauge,parameter,n_pairs,n_equal,n_changed,first_changed_time_utc,last_changed_time_utc,max_abs_diff,n_distinct_lm_minutes_of_changed",
 R2_por_level_octpull = "gauge,parameter,n_pairs,n_equal,n_changed,first_changed_time_utc,last_changed_time_utc,max_abs_diff,n_distinct_lm_minutes_of_changed",
 R2_por_level_log_mismatch = "seq,in_por_hT_utc,logged_h,current_h",
 R3_visits = "gauge,visit_time_utc,field_visit_id,level_ft,flow_cfs,control_condition,measurement_rated,observing_procedure,last_modified,n_rows,n_reference_rows",
 R3_measured_vs_published = "visit_time_utc,level_ft,measured_cfs,measurement_rated,control_condition,current_cfs,old_cfs,pct_current_vs_measured,pct_old_vs_measured",
 R3_bulk_rewrites = "gauge,lm_minute,n_readings,first_time_utc,last_time_utc,span_days,days_since_last_visit",
 R4_0_por = "visit_time_utc,level_ft,measured_cfs,measurement_rated,control_condition,current_cfs,old_cfs,pct_current_vs_measured,pct_old_vs_measured,band_pct,current_inside_band,old_inside_band,f_old_A,f_old_B,f_old_C,pct_f_old_A_vs_measured,pct_f_old_B_vs_measured,pct_f_old_C_vs_measured",
 R4_0_upstream = "gauge,visit_time_utc,level_ft,measured_cfs,measurement_rated,current_cfs,pct,band_pct,inside_band",
 R4_a_days = "day_utc,steady,revised,por_old,por_current,u_lag0,u_lag1,u_lag2",
 R4_a_verdicts = "lag,centre_kind,band_kind,median_ratio_old,median_ratio_new,n_days,b_por,b_u,b,old_inside_band,new_inside_band,verdict,c",
 R4_b_days = "day_utc,lag,revised,lf,por_old,por_current,trib,w_cfs,resid_old,resid_new",
 R4_b_verdicts = "lag,set,band_kind,n_days,median_lf,median_resid_old,median_resid_new,mean_resid_old,mean_resid_new,b,band_cfs,verdict",
 R4_c_runs = "seq,at_utc,phase,gate_miss,raw_cfs,t1,w_cfs,e_raw,e_adj",
 R5_split = "old_rule,due_basis,set,phase,n,mean_term1,lo_term1,hi_term1,mean_term2,lo_term2,hi_term2,mean_term3,lo_term3,hi_term3,mean_e_s0,mean_abs_e_s0,mean_abs_e_old,mean_abs_e_new",
 R5_split_by_day = "old_rule,day_utc,n,mean_term1,mean_term2,mean_term3",
 R5_extrapolation = "scenario,phase,n_runs,share_any_extrapolated,share_hist_extrapolated,share_any_oct_knot",
 R5_chain = "source,phase,n,approx_final,mean_trv_t,mean_trv_gf2lf,mean_hist_ago,mean_hist_cfs,mean_pre_cfs,mean_delta_ratio,n_delta_ratio,mean_raw_cfs,mean_corr_c,mean_final_cfs,share_ceil_bound,share_rising,share_steady,share_falling,share_iteration_limit",
 R6_checks = "seq_check,predTs_utc,run_seq,phase,bin,st,rawCFS,corrApplied,corrCFS,actualCFS,errRawCFS,errPctRaw,errPctCorr,binBefore_n,binBefore_ema,binAfter_count,binAfter_emaMeanError,ceilBound,soft,hard",
 R6_bins = "bin_key,n_checks,n_checks_OLD,n_checks_TRANS,n_checks_NEW,ema_before_first_check,ema_after_last_check,mean_errRawCFS_last3_NEW,gap_open_cfs,checks_per_day_NEW,days_to_close_90pct",
 R7_ranges = "range_lo,n,mean_ratio,min_ratio,max_ratio,mean_diff_cfs,min_level_ft,max_level_ft",
 R7_bins = "bin_key,n,ema,mean,sd,last_check_in_window_utc",
 R8_inputs = "field,src_group,n,n_equal,n_different,max_abs_diff",
 R8_daily = "day_utc,phase,n_runs,mean_term1_A,mean_term1_B,mean_term1_C,mean_e_raw_s0,lf_day_mean,por_level_day_mean,lf_change_24h_pct")
keys <- list(R1_rewrite_groups = 1, R1_by_day = 1, R1_by_level = 1, R1_by_level_band = 1, R1_ratio_day_band = 1:2, R1_old_copies = 1:2, R1_log_pairs = 1,
 R2_series = 1:2, R3_visits = 1:2, R3_measured_vs_published = 1, R3_bulk_rewrites = 1:2, R4_0_por = 1, R4_0_upstream = 1:2, R4_a_days = 1, R4_a_verdicts = 1:3,
 R4_b_days = 1:2, R4_b_verdicts = 1:3, R4_c_runs = 1, R5_split = 1:4, R5_split_by_day = 1:2, R5_extrapolation = 1:2, R5_chain = 1:2, R6_checks = 1, R6_bins = 1,
 R7_ranges = 1, R7_bins = 1, R8_inputs = 1:2, R8_daily = 1:2)
ok <- TRUE
for (nm in names(spec)) {
  f <- file.path(TAB, paste0(nm, ".csv"))
  if (!file.exists(f)) { cat("MISSING", nm, "\n"); ok <- FALSE; next }
  hdr <- readLines(f, n = 1)
  if (hdr != spec[[nm]]) { cat("COLUMN MISMATCH", nm, "\n"); ok <- FALSE }
  d <- read.csv(f, colClasses = "character", na.strings = "", check.names = FALSE)
  if (any(sapply(d, function(x) any(x %in% c("NA", "NaN", "Inf", "-Inf"), na.rm = TRUE)))) { cat("BAD TOKEN", nm, "\n"); ok <- FALSE }
  if (any(sapply(d, function(x) any(grepl("^-?[0-9.]+e[+-][0-9]+$", x))))) { cat("SCI NOTATION", nm, "\n"); ok <- FALSE }
  k <- keys[[nm]]
  if (!is.null(k) && nrow(d) > 1) {
    kk <- lapply(k, function(j) { x <- d[[j]]; n <- suppressWarnings(as.numeric(x)); if (all(is.na(n) == is.na(x))) n else x })
    o <- do.call(order, c(kk, list(method = "radix")))
    if (!identical(o, seq_len(nrow(d)))) { cat("NOT SORTED", nm, "\n"); ok <- FALSE }
  }
  cat(sprintf("%-28s %5d rows\n", nm, nrow(d)))
}
m <- read.csv(file.path(here, "metrics.csv"), colClasses = "character", na.strings = "")
stopifnot(identical(names(m), c("question", "group", "metric", "value")))
cat(sprintf("metrics.csv: %d rows\n", nrow(m)))
cat(if (ok) "ALL TABLE CHECKS PASSED\n" else "CHECKS FAILED\n")

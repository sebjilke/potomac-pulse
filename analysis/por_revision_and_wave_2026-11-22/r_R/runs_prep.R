cat("runs prep\n")
lfc <- getser("census", G$lf, "00060"); lfc <- lfc[!is.na(lfc$v), ]
interp_lf <- function(tau) {
  out <- rep(NA_real_, length(tau))
  for (j in seq_along(tau)) {
    if (is.na(tau[j])) next
    i <- findInterval(tau[j], lfc$t)
    if (i < 1) next
    if (lfc$t[i] == tau[j]) { out[j] <- lfc$v[i]; next }
    if (i >= nrow(lfc)) next
    out[j] <- lfc$v[i] + (lfc$v[i + 1] - lfc$v[i]) * (tau[j] - lfc$t[i]) / (lfc$t[i + 1] - lfc$t[i])
  }
  out
}
phase_of <- function(l) ifelse(l == "old", "OLD", ifelse(l == "new", "NEW", "TRANS"))
RT <- data.frame(seq = num(RUNS$seq), at_utc = RUNS$at_utc, ver = RUNS$ver, src = RUNS$src, stringsAsFactors = FALSE)
li <- match(RT$seq, num(LAB$seq))
RT$phase <- phase_of(LAB$label_all_three[li]); RT$gate_miss <- LAB$gate_miss[li]
for (cc in c("cur_label", "back6_label", "hist_label", "label_flow_state_rise_rate", "label_time_shift", "label_delta_correction", "label_all_three")) RT[[cc]] <- LAB[[cc]][li]
RT$day <- day_of(RT$at_utc)
RT$raw_s0 <- num(RUNS$raw_cfs); RT$due_s0 <- RUNS$due_utc
# truth check: recompute T1 against truth.csv for every (seq, scenario)
tk <- paste(TRU$seq, TRU$scenario)
mine <- interp_lf(tsec(TRU$due_utc)); theirs <- num(TRU$t1_lf_cfs_interpolated)
d <- abs(mine - theirs); bad <- which((is.na(mine) != is.na(theirs)) | (!is.na(d) & d > 1e-3))
cat(sprintf("  own interpolation vs truth.csv: %d rows, %d disagree\n", nrow(TRU), length(bad)))
TRUTH_CHECK_BAD <- TRU[bad, c("seq", "scenario", "due_utc", "t1_lf_cfs_interpolated")]; TRUTH_CHECK_BAD$mine <- mine[bad]
getT1 <- function(scn) theirs[match(paste(RT$seq, scn), tk)]
scn_map <- c(oldA = "S-old-A", oldB = "S-old-B", oldC = "S-old-C", new = "S-new")
RT$t1_s0_truthcsv <- getT1("S0")
RT$t1_s0 <- RT$t1_s0_truthcsv
i212 <- which(RT$seq == 212)
t1_212_mine <- interp_lf(tsec(RT$due_s0[i212]))
RT$t1_s0[i212] <- t1_212_mine
RT$e_raw_s0 <- (RT$raw_s0 - RT$t1_s0) / RT$t1_s0 * 100
for (nm in names(scn_map)) {
  rr <- match(paste(RT$seq, scn_map[nm]), paste(RPR$seq, RPR$scenario))
  RT[[paste0("raw_", nm)]] <- num(RPR$raw_cfs[rr]); RT[[paste0("due_", nm)]] <- RPR$due_utc[rr]
  RT[[paste0("t1_", nm)]] <- getT1(scn_map[nm])
  RT[[paste0("e_raw_", nm)]] <- (RT[[paste0("raw_", nm)]] - RT[[paste0("t1_", nm)]]) / RT[[paste0("t1_", nm)]] * 100
  RT[[paste0("e_raw_", nm, "_commondue")]] <- (RT[[paste0("raw_", nm)]] - RT$t1_s0) / RT$t1_s0 * 100
}
RT$term1_A <- RT$e_raw_oldA; RT$term1_B <- RT$e_raw_oldB; RT$term1_C <- RT$e_raw_oldC
cat(sprintf("  seq 212: T1 own %.6f vs truth.csv S0 %.6f\n", t1_212_mine, RT$t1_s0_truthcsv[i212]))
addm("COMMON", NA, "t1_s0_seq212_computed_at_runs_due_utc", t1_212_mine)
addm("COMMON", NA, "t1_s0_seq212_truth_csv", RT$t1_s0_truthcsv[i212])
addm("COMMON", NA, "truth_csv_rows_where_own_interpolation_differs", length(bad))
for (p in c("OLD", "TRANS", "NEW", "ALL")) {
  s <- if (p == "ALL") RT$seq else RT$seq[RT$phase == p]
  addm("COMMON", p, "n_runs", length(s)); addm("COMMON", p, "first_seq", min(s)); addm("COMMON", p, "last_seq", max(s))
}
addm("COMMON", NA, "n_S0_t1_blank_dropped", sum(is.na(RT$t1_s0)))
wd_key <- WD$withdrawal_date
stopifnot(!anyDuplicated(wd_key))
WDAY <- data.frame(day = WD$withdrawal_date, w_cfs = num(WD$total_net_potomac_withdrawal_mgd) * 1.547229,
                   flag = WD$total_net_potomac_withdrawal_flag, stringsAsFactors = FALSE)

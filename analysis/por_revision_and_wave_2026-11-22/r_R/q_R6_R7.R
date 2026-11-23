cat("R6\n")
CK <- CHK[order(tsec(CHK$created_at_utc)), ]
rm_ <- match(CK$predTs_utc, RUNS_ALL$final_ts_utc)
CK$run_seq <- num(RUNS_ALL$seq[rm_])
CK$phase <- RT$phase[match(CK$run_seq, RT$seq)]
CK$bin_key <- paste(CK$bin, CK$st, sep = "_")
out <- data.frame(seq_check = num(CK$seq), predTs_utc = CK$predTs_utc, run_seq = CK$run_seq, phase = CK$phase, bin = CK$bin, st = CK$st,
  rawCFS = num(CK$rawCFS), corrApplied = num(CK$corrApplied), corrCFS = num(CK$corrCFS), actualCFS = num(CK$actualCFS), errRawCFS = num(CK$errRawCFS),
  errPctRaw = num(CK$errPctRaw), errPctCorr = num(CK$errPctCorr), binBefore_n = num(CK$binBefore_n), binBefore_ema = num(CK$binBefore_ema),
  binAfter_count = num(CK$binAfter_count), binAfter_emaMeanError = num(CK$binAfter_emaMeanError), ceilBound = num(CK$ceilBound), soft = num(CK$soft), hard = num(CK$hard))
wtab(out, "R6_checks")
addm("R6", NA, "n_checks", nrow(CK))
addm("R6", NA, "n_checks_without_run", sum(is.na(CK$run_seq)))
addm("R6", NA, "check_without_run_seq_check", paste(num(CK$seq)[is.na(CK$run_seq)], collapse = ";"))
addm("R6", NA, "check_without_run_predTs_utc", paste(CK$predTs_utc[is.na(CK$run_seq)], collapse = ";"))
bk <- sort(unique(CK$bin_key)); rows <- list()
ct <- tsec(CK$created_at_utc)
for (k in bk) {
  i <- which(CK$bin_key == k); i <- i[order(ct[i])]
  nw <- i[!is.na(CK$phase[i]) & CK$phase[i] == "NEW"]
  mean3 <- if (length(nw)) mean(num(CK$errRawCFS[tail(nw, 3)])) else NA_real_
  after_last <- num(CK$binAfter_emaMeanError[tail(i, 1)])
  cpd <- if (length(nw)) length(nw) / ((CUT - ct[nw[1]]) / 86400) else NA_real_
  rows[[length(rows) + 1]] <- data.frame(bin_key = k, n_checks = length(i), n_checks_OLD = sum(CK$phase[i] == "OLD", na.rm = TRUE),
    n_checks_TRANS = sum(CK$phase[i] == "TRANS", na.rm = TRUE), n_checks_NEW = length(nw), ema_before_first_check = num(CK$binBefore_ema[i[1]]),
    ema_after_last_check = after_last, mean_errRawCFS_last3_NEW = mean3, gap_open_cfs = mean3 - after_last, checks_per_day_NEW = cpd, days_to_close_90pct = 7 / cpd)
}
wtab(do.call(rbind, rows), "R6_bins")

cat("R7\n")
rg <- c(0, 3000, 6000, 12000, 25000, 50000, Inf); R13 <- P[P$rev13, ]; rr <- list()
for (j in 1:6) {
  x <- R13[R13$old >= rg[j] & R13$old < rg[j + 1], ]
  rr[[j]] <- data.frame(range_lo = rg[j], n = nrow(x), mean_ratio = if (nrow(x)) mean(x$ratio) else NA_real_, min_ratio = if (nrow(x)) min(x$ratio) else NA_real_,
    max_ratio = if (nrow(x)) max(x$ratio) else NA_real_, mean_diff_cfs = if (nrow(x)) mean(x$diff) else NA_real_,
    min_level_ft = if (any(!is.na(x$level))) min(x$level, na.rm = TRUE) else NA_real_, max_level_ft = if (any(!is.na(x$level))) max(x$level, na.rm = TRUE) else NA_real_)
}
wtab(do.call(rbind, rr), "R7_ranges")
B <- BINS[BINS$source == "gf_correction_bin" & !grepl("^stage_", BINS$bin_key), ]
B <- B[order(B$bin_key), ]
n <- num(B$n); s <- num(B$sum); sq <- num(B$sum_sq)
lastchk <- sapply(B$bin_key, function(k) { i <- which(CK$bin_key == k); if (!length(i)) NA_character_ else CK$created_at_utc[i[which.max(ct[i])]] })
wtab(data.frame(bin_key = B$bin_key, n = n, ema = num(B$ema), mean = num(B$mean), sd = ifelse(n >= 2, sqrt((sq - s^2 / n) / (n - 1)), NA_real_),
                last_check_in_window_utc = unname(lastchk)), "R7_bins")
flush_metrics()

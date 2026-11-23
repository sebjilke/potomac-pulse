cat("R8\n")
RT$src_group <- ifelse(!is.na(RT$src) & RT$src == "new", "new_service", "old_service")
spec <- list(
  list("in_lf_q", "in_lf_qT_utc", "census", G$lf, "00060"), list("in_lf_h", "in_lf_hT_utc", "model", G$lf, "00065"),
  list("in_mono_q", "in_mono_qT_utc", "model", G$mono, "00060"), list("in_goose_q", "in_goose_qT_utc", "model", G$goose, "00060"),
  list("in_sen_q", "in_sen_qT_utc", "model", G$sen, "00060"), list("in_br_q", "in_br_qT_utc", "model", G$br, "00060"),
  list("in_ef_h", "in_ef_hT_utc", "model", G$ef, "00065"), list("in_por_h", "in_por_hT_utc", "model", G$por, "00065"),
  list("in_por_q", "in_por_qT_utc", "census", G$por, "00060"))
curlab <- LAB$cur_label[match(num(RUNS$seq), num(LAB$seq))]
rows <- list(); sg <- ifelse(!is.na(RUNS$src) & RUNS$src == "new", "new_service", "old_service")
for (s in spec) {
  d <- getser(s[[3]], s[[4]], s[[5]]); d <- d[!is.na(d$v), ]
  logged <- num(RUNS[[s[[1]]]]); cur <- d$v[match(RUNS[[s[[2]]]], d$time_utc)]
  use <- rep(TRUE, nrow(RUNS)); if (s[[1]] == "in_por_q") use <- curlab == "new"
  for (g in c("new_service", "old_service")) {
    k <- use & sg == g & !is.na(logged) & !is.na(cur)
    df <- abs(logged[k] - cur[k])
    rows[[length(rows) + 1]] <- data.frame(field = s[[1]], src_group = g, n = sum(k), n_equal = sum(df == 0), n_different = sum(df != 0), max_abs_diff = if (sum(k)) max(df) else NA_real_)
    addm("R8", paste(s[[1]], g, sep = "_"), "n_runs_in_scope_without_logged_or_current_value", sum(use & sg == g & !(!is.na(logged) & !is.na(cur))))
  }
}
R8i <- do.call(rbind, rows); R8i <- R8i[order(R8i$field, R8i$src_group), ]
wtab(R8i, "R8_inputs")

N <- RT[RT$phase == "NEW", ]
two <- function(x, label, group) {
  ok <- !is.na(x); b <- ok & N$src_group == "old_service"; a <- ok & N$src_group == "new_service"
  ci <- boot_diff(N$day[b], x[b], N$day[a], x[a])
  pre <- if (is.na(group)) label else label
  addm("R8", group, paste0(pre, "_n_before"), sum(b)); addm("R8", group, paste0(pre, "_n_after"), sum(a))
  addm("R8", group, paste0(pre, "_mean_before"), mean(x[b])); addm("R8", group, paste0(pre, "_mean_after"), mean(x[a]))
  addm("R8", group, paste0(pre, "_diff"), mean(x[a]) - mean(x[b])); addm("R8", group, paste0(pre, "_diff_lo"), ci[1]); addm("R8", group, paste0(pre, "_diff_hi"), ci[2])
  addm("R8", group, paste0(pre, "_diff_nskip"), ci[3])
}
two(N$e_raw_s0, "e_raw_s0", NA)
for (r in c("B", "A", "C")) two(N[[paste0("term1_", r)]], "term1", r)
two(N$e_raw_new, "e_raw_new", NA)

# (b) falling river
dk <- unique(RT[, c("day", "phase")]); dk <- dk[order(dk$day, dk$phase), ]
rows <- list()
for (i in seq_len(nrow(dk))) {
  x <- RT[RT$day == dk$day[i] & RT$phase == dk$phase[i], ]
  dn <- dnum(dk$day[i])
  lfm <- dget("lf", dn); lfp <- dget("lf", dn - 1)
  rows[[i]] <- data.frame(day_utc = dk$day[i], phase = dk$phase[i], n_runs = nrow(x), mean_term1_A = mean_na(x$term1_A), mean_term1_B = mean_na(x$term1_B),
    mean_term1_C = mean_na(x$term1_C), mean_e_raw_s0 = mean_na(x$e_raw_s0), lf_day_mean = lfm, por_level_day_mean = dget("por_lev", dn),
    lf_change_24h_pct = (lfm / lfp - 1) * 100)
}
R8d <- do.call(rbind, rows)
wtab(R8d, "R8_daily")
for (ph in c("OLD", "NEW")) for (r in c("B", "A", "C")) {
  x <- R8d[R8d$phase == ph & R8d$n_runs >= 3 & !is.na(R8d[[paste0("mean_term1_", r)]]) & !is.na(R8d$lf_change_24h_pct), ]
  g <- paste(ph, r, sep = "_")
  addm("R8", g, "slope", slope2(x$lf_change_24h_pct, x[[paste0("mean_term1_", r)]]))
  addm("R8", g, "corr", cor_na(x$lf_change_24h_pct, x[[paste0("mean_term1_", r)]]))
  addm("R8", g, "n_days", nrow(x))
}
flush_metrics()

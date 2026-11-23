cat("R5\n")
# per-run table
ren <- c(raw = "raw_cfs", due = "due_utc", t1 = "t1", e_raw = "e_raw")
R5 <- RT[, c("seq", "at_utc", "phase", "gate_miss", "ver", "src", "cur_label", "back6_label", "hist_label",
             "label_flow_state_rise_rate", "label_time_shift", "label_delta_correction", "label_all_three")]
R5$raw_cfs_s0 <- RT$raw_s0; R5$due_utc_s0 <- RT$due_s0; R5$t1_s0 <- RT$t1_s0; R5$e_raw_s0 <- RT$e_raw_s0
for (nm in names(scn_map)) {
  R5[[paste0("raw_cfs_", nm)]] <- RT[[paste0("raw_", nm)]]; R5[[paste0("due_utc_", nm)]] <- RT[[paste0("due_", nm)]]
  R5[[paste0("t1_", nm)]] <- RT[[paste0("t1_", nm)]]; R5[[paste0("e_raw_", nm)]] <- RT[[paste0("e_raw_", nm)]]
}
for (nm in names(scn_map)) R5[[paste0("e_raw_", nm, "_commondue")]] <- RT[[paste0("e_raw_", nm, "_commondue")]]
R5 <- R5[order(R5$seq), ]
wtab(R5, "R5_runs")

# three-term split
srows <- list(); drows <- list()
for (rule in c("A", "B", "C")) for (basis in c("own", "common")) for (set in c("all", "without_212_217")) {
  if (basis == "own") { e1 <- RT[[paste0("e_raw_old", rule)]]; e2 <- RT$e_raw_new } else { e1 <- RT[[paste0("e_raw_old", rule, "_commondue")]]; e2 <- RT$e_raw_new_commondue }
  e3 <- RT$e_raw_s0
  ok <- !is.na(e1) & !is.na(e2) & !is.na(e3)
  if (set == "without_212_217") ok <- ok & !(RT$seq %in% c(212, 217))
  base_n <- if (set == "all") nrow(RT) else sum(!(RT$seq %in% c(212, 217)))
  addm("R5", sprintf("%s_%s_%s", rule, basis, set), "n_dropped_missing_t1", base_n - sum(ok))
  for (ph in c("OLD", "TRANS", "NEW", "ALL")) {
    k <- ok & (ph == "ALL" | RT$phase == ph)
    if (!any(k)) { srows[[length(srows) + 1]] <- data.frame(old_rule = rule, due_basis = basis, set = set, phase = ph, n = 0); next }
    t1 <- e1[k]; t2 <- e2[k] - e1[k]; t3 <- e3[k] - e2[k]
    ci <- boot_means(RT$day[k], cbind(t1, t2, t3))
    srows[[length(srows) + 1]] <- data.frame(old_rule = rule, due_basis = basis, set = set, phase = ph, n = sum(k),
      mean_term1 = mean(t1), lo_term1 = ci[1, 1], hi_term1 = ci[1, 2], mean_term2 = mean(t2), lo_term2 = ci[2, 1], hi_term2 = ci[2, 2],
      mean_term3 = mean(t3), lo_term3 = ci[3, 1], hi_term3 = ci[3, 2], mean_e_s0 = mean(e3[k]), mean_abs_e_s0 = mean(abs(e3[k])),
      mean_abs_e_old = mean(abs(e1[k])), mean_abs_e_new = mean(abs(e2[k])))
    if (any(ci[, 3] > 0)) addm("R5", sprintf("%s_%s_%s_%s", rule, basis, set, ph), "bootstrap_resamples_skipped", max(ci[, 3]))
  }
  if (basis == "own" && set == "all") {
    for (d in sort(unique(RT$day[ok]))) { k <- ok & RT$day == d
      drows[[length(drows) + 1]] <- data.frame(old_rule = rule, day_utc = d, n = sum(k), mean_term1 = mean(e1[k]), mean_term2 = mean(e2[k] - e1[k]), mean_term3 = mean(e3[k] - e2[k])) }
  }
}
SP <- do.call(rbind, srows); SP <- SP[order(SP$old_rule, SP$due_basis, SP$set, SP$phase), ]
wtab(SP, "R5_split")
wtab(do.call(rbind, drows), "R5_split_by_day")

# extrapolation share
er <- list()
RPR$phase <- RT$phase[match(num(RPR$seq), RT$seq)]
ext <- function(f) !is.na(f) & f %in% c("extrapolated_low", "extrapolated_high")
for (sc in c("S-old-A", "S-old-B", "S-old-C")) for (ph in c("OLD", "TRANS", "NEW")) {
  x <- RPR[RPR$scenario == sc & RPR$phase == ph, ]
  er[[length(er) + 1]] <- data.frame(scenario = sc, phase = ph, n_runs = nrow(x),
    share_any_extrapolated = mean(ext(x$cur_extrap_flag) | ext(x$back6_extrap_flag) | ext(x$hist_extrap_flag)),
    share_hist_extrapolated = mean(ext(x$hist_extrap_flag)),
    share_any_oct_knot = mean((!is.na(x$cur_extrap_flag) & x$cur_extrap_flag == "observed_oct_knot") | (!is.na(x$back6_extrap_flag) & x$back6_extrap_flag == "observed_oct_knot") | (!is.na(x$hist_extrap_flag) & x$hist_extrap_flag == "observed_oct_knot")))
}
er <- do.call(rbind, er); er <- er[order(er$scenario, er$phase), ]
wtab(er, "R5_extrapolation")

# chain by phase
chain_row <- function(source, ph, n, af, trv_t, gf2lf, hago, hcfs, pre, dr, raw, cc, fin, cb, st, itl) {
  data.frame(source = source, phase = ph, n = n, approx_final = af, mean_trv_t = mean_na(trv_t), mean_trv_gf2lf = mean_na(gf2lf), mean_hist_ago = mean_na(hago),
    mean_hist_cfs = mean_na(hcfs), mean_pre_cfs = mean_na(pre), mean_delta_ratio = mean_na(dr), n_delta_ratio = sum(!is.na(dr)), mean_raw_cfs = mean_na(raw),
    mean_corr_c = mean_na(cc), mean_final_cfs = mean_na(fin), share_ceil_bound = mean(cb == 1), share_rising = mean(st == "rising"), share_steady = mean(st == "steady"),
    share_falling = mean(st == "falling"), share_iteration_limit = mean(itl == 1))
}
ch <- list()
RUNS$phase <- RT$phase[match(num(RUNS$seq), RT$seq)]
for (ph in c("OLD", "TRANS", "NEW")) {
  x <- RUNS[RUNS$phase == ph, ]
  ch[[length(ch) + 1]] <- chain_row("S0_logged", ph, nrow(x), 0, num(x$trv_t), num(x$trv_gf2lf), num(x$hist_ago), num(x$hist_cfs), num(x$pre_cfs), num(x$delta_ratio),
    num(x$raw_cfs), num(x$corr_c), num(x$final_cfs), num(x$ceil_bound), x$corr_st, as.integer(x$trv_stop == "max_iter"))
}
for (sc in c("S-new", "S-old-A", "S-old-B", "S-old-C")) for (ph in c("OLD", "TRANS", "NEW")) {
  x <- RPR[RPR$scenario == sc & RPR$phase == ph, ]
  ch[[length(ch) + 1]] <- chain_row(sc, ph, nrow(x), 1, num(x$trv_t_h), num(x$trv_gf2lf_h), num(x$hist_ago_h), num(x$hist_cfs), num(x$pre_cfs), num(x$delta_ratio),
    num(x$raw_cfs), num(x$corr_c), num(x$final_cfs), num(x$ceil_bound), x$corr_st, num(x$iteration_limit))
}
ch <- do.call(rbind, ch); ch <- ch[order(ch$source, ch$phase), ]
wtab(ch, "R5_chain")
flush_metrics()

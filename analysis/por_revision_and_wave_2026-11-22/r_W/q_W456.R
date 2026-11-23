# q_W456.R : W4, W5, W6 (sourced after q_runs.R and q_W3.R; needs RU, RW, DAILY, DECISION)
wmae <- function(e, w) { ok <- !is.na(e); s <- sum(w[ok]); if (s == 0) NA_real_ else sum(w[ok] * abs(e[ok])) / s }
wmean <- function(e, w) { ok <- !is.na(e); s <- sum(w[ok]); if (s == 0) NA_real_ else sum(w[ok] * e[ok]) / s }
wmedian <- function(x, w) { v <- rep(x, w); if (length(v) == 0) NA_real_ else median(v) }

## ======================================================== W4
RW <- RW[order(RW$seq), ]
w4 <- RW[, c("seq", "at_utc", "due_utc", "phase", "gate_miss", "hour_run", "hour_due", "raw_cfs", "final_cfs", "corr_c",
             "corr_st", "ceil_bound", "t1", "e_raw", "e_final")]
wtab(w4, "W4_runs")

PHASES <- c("NEW", "OLD", "TRANS")
rows <- list()
for (ph in PHASES) {
  z <- RW[RW$phase == ph, ]
  for (h in sort(unique(z$hour_due))) {
    zz <- z[z$hour_due == h, ]
    rows[[length(rows) + 1]] <- data.frame(phase = ph, hour_due = h, n = nrow(zz), mean_e_raw = mean(zz$e_raw), mean_e_final = mean(zz$e_final), stringsAsFactors = FALSE)
  }
}
W4_BYH <- do.call(rbind, rows)
W4_BYH <- W4_BYH[order(W4_BYH$phase, W4_BYH$hour_due, method = "radix"), ]
wtab(W4_BYH, "W4_error_by_hour")

# one-group cycle with day-block interval, per phase and quantity
cyc_block_ci <- function(day, e, hr) {
  blocks <- sort(unique(day)); blk <- match(day, blocks); H <- make_H(hr)
  stat <- function(w1, w2) cycle_stats(e, H, w1[blk])$cycle
  ci <- boot_ci(boot_matrix(length(blocks), stat)[, 1]); ci
}
rows <- list()
W4_STAT <- list()
for (ph in PHASES) for (qn in c("e_raw", "e_final")) {
  z <- RW[RW$phase == ph, ]; e <- z[[qn]]; H <- make_H(z$hour_due)
  cs <- cycle_stats(e, H, rep(1, nrow(z)))
  ci <- if (nrow(z) > 0) cyc_block_ci(z$day, e, z$hour_due) else c(NA, NA, NA)
  if (!is.na(cs$cycle)) note_skips("W4_cycle", paste(ph, qn), "cycle_size", ci[3])
  inv <- cs$valid[z$hour_due + 1]
  ev <- e[inv]; hm <- cs$mu[z$hour_due[inv] + 1]
  share <- if (length(ev) > 1) 1 - sum((ev - hm)^2) / sum((ev - mean(ev))^2) else NA_real_
  sdr <- if (length(ev) > 1) sd(ev - hm) else NA_real_
  rows[[length(rows) + 1]] <- data.frame(phase = ph, quantity = qn, n = nrow(z), mean = mean(e), cycle_size = cs$cycle,
    lo = if (is.na(cs$cycle)) NA_real_ else ci[1], hi = if (is.na(cs$cycle)) NA_real_ else ci[2], crest_hour = cs$crest,
    share_of_variance_by_hour = share, sd_remainder = sdr, stringsAsFactors = FALSE)
  W4_STAT[[paste(ph, qn)]] <- list(mean = mean(e), cycle = cs$cycle, crest = cs$crest, mu = cs$mu, valid = cs$valid)
}
W4C <- do.call(rbind, rows); W4C <- W4C[order(W4C$phase, W4C$quantity, method = "radix"), ]
wtab(W4C, "W4_cycle")

# two-group difference NEW minus OLD (group 1 = NEW)
for (qn in c("e_raw", "e_final")) {
  zn <- RW[RW$phase == "NEW", ]; zo <- RW[RW$phase == "OLD", ]
  bn <- sort(unique(zn$day)); bo <- sort(unique(zo$day))
  kn <- match(zn$day, bn); ko <- match(zo$day, bo); Hn <- make_H(zn$hour_due); Ho <- make_H(zo$hour_due)
  stat <- function(w1, w2) cycle_stats(zn[[qn]], Hn, w1[kn])$cycle - cycle_stats(zo[[qn]], Ho, w2[ko])$cycle
  est <- W4_STAT[[paste("NEW", qn)]]$cycle - W4_STAT[[paste("OLD", qn)]]$cycle
  ci <- boot_ci(boot_matrix(length(bn), stat, length(bo))[, 1])
  note_skips("W4_metrics", qn, "cycle_diff_new_minus_old", ci[3])
  M("W4", qn, "cycle_size_diff_new_minus_old", est); M("W4", qn, "cycle_size_diff_new_minus_old_lo", ci[1]); M("W4", qn, "cycle_size_diff_new_minus_old_hi", ci[2])
}

# components
COMP_Q <- c("pre_cfs", "delta_ratio", "raw_cfs", "corr_c", "final_cfs", "ceil_lim")
rows <- list(); rowsc <- list()
for (ph in c("OLD", "NEW")) {
  z <- RW[RW$phase == ph, ]
  for (qn in c(COMP_Q, "t1")) {
    hrv <- if (qn == "t1") z$hour_due else z$hour_run
    v <- z[[qn]]; ok <- !is.na(v)
    hv <- hrv[ok]; vv <- v[ok]
    for (h in sort(unique(hv))) rows[[length(rows) + 1]] <- data.frame(phase = ph, quantity = qn, hour = h, n = sum(hv == h), mean = mean(vv[hv == h]), stringsAsFactors = FALSE)
    cs <- cycle_stats(vv, make_H(hv), rep(1, length(vv)))
    mu <- mean(vv)
    rowsc[[length(rowsc) + 1]] <- data.frame(phase = ph, quantity = qn, mean = mu, cycle_size = cs$cycle,
      cycle_size_pct_of_mean = if (is.na(cs$cycle) || mu == 0) NA_real_ else 100 * cs$cycle / abs(mu),
      crest_hour = cs$crest, stringsAsFactors = FALSE)
  }
}
df <- do.call(rbind, rows); df <- df[order(df$phase, df$quantity, df$hour, method = "radix"), ]; wtab(df, "W4_components")
df <- do.call(rbind, rowsc); df <- df[order(df$phase, df$quantity, method = "radix"), ]; wtab(df, "W4_component_cycles")
write_metrics()

## ======================================================== W5
rr <- rrun; rr$seq <- as.integer(rr$seq)
for (cn in c("raw_cfs", "delta_ratio", "final_cfs", "corr_c", "ceil_lim")) rr[[cn]] <- as.numeric(rr[[cn]])
rr$due_m <- tmin(rr$due_utc)
xx <- read.csv("replay/out/replay_2x2x2.csv", colClasses = "character", na.strings = "", stringsAsFactors = FALSE)
xx$seq <- as.integer(xx$seq)
for (cn in c("raw_cfs", "trv_t_of_pick_h", "gf2lf_h")) xx[[cn]] <- as.numeric(xx[[cn]])
xx$due_m <- tmin(xx$due_utc)

# check: truth.csv due_utc equals replay_runs due_utc
tk <- paste(tru$seq, tru$scenario); rk <- paste(rr$seq, rr$scenario)
M("W5", "", "n_truth_due_differs_from_replay_runs_due", sum(tru$due_m[match(rk, tk)] != rr$due_m, na.rm = TRUE))

scen_t1 <- function(scen, seqs) { z <- tru[tru$scenario == scen, ]; z$t1[match(seqs, z$seq)] }
pct_err <- function(E, T) (E - T) / T * 100

# the c_ref table: S0 logged e_raw of phase NEW (W4 universe)
CZ <- RW[RW$phase == "NEW", ]
CREF_E <- CZ$e_raw; CREF_H <- make_H(CZ$hour_due); CREF_DAY <- CZ$day
CREF_FULL <- cycle_stats(CREF_E, CREF_H, rep(1, nrow(CZ)))$cycle
M("W5", "", "c_ref_cycle_e_raw_S0_NEW", CREF_FULL)

W5 <- list()
add_row <- function(candidate, variant, old_rule, quantity, a, b, d, lo, hi, sp, lop, hip, label) {
  W5[[length(W5) + 1]] <<- data.frame(candidate = candidate, variant = variant, old_rule = old_rule, quantity = quantity,
    value_a = a, value_b = b, diff = d, lo = lo, hi = hi, share_p = sp, lo_p = lop, hi_p = hip, label = label, stringsAsFactors = FALSE)
}

# generic one-group paired comparison. ea_f, eb_f: function(row weights) -> error vector (NA allowed -> row dropped by caller)
paired_rows <- function(candidate, variant, old_rule, day, ea_f, hra, eb_f, hrb, quantities = c("MAE", "cycle"), delay = NULL, cref_g2 = FALSE) {
  blocks <- sort(unique(day)); blk <- match(day, blocks); D <- length(blocks)
  Ha <- make_H(hra); Hb <- make_H(hrb)
  blocks_c <- sort(unique(CREF_DAY))
  blk_c <- if (cref_g2) match(CREF_DAY, blocks_c) else match(CREF_DAY, blocks)
  stat <- function(w1, w2) {
    wr <- w1[blk]; wc <- if (cref_g2) w2[blk_c] else w1[blk_c]; wc[is.na(wc)] <- 0
    ea <- ea_f(wr); eb <- eb_f(wr)
    ma <- wmae(ea, wr); mb <- wmae(eb, wr)
    ca <- cycle_stats(ea, Ha, wr)$cycle; cb <- cycle_stats(eb, Hb, wr)$cycle
    cref <- cycle_stats(CREF_E, CREF_H, wc)$cycle
    dl <- if (!is.null(delay)) c(wmean(delay$a, wr), wmean(delay$b, wr)) else c(NA_real_, NA_real_)
    c(ma, mb, ma - mb, ca, cb, ca - cb, cref, if (is.na(cref) || cref == 0) NA_real_ else (ca - cb) / cref, dl, dl[1] - dl[2])
  }
  pt <- stat(rep(1L, D), if (cref_g2) rep(1L, length(blocks_c)) else NULL)
  pt_cref <- CREF_FULL; pt_p <- if (is.na(pt_cref) || pt_cref == 0) NA_real_ else pt[6] / pt_cref
  bm <- if (cref_g2) boot_matrix(D, stat, length(blocks_c)) else boot_matrix(D, stat)
  key_ <- paste(candidate, variant, old_rule)
  for (qq in c(quantities, if (!is.null(delay)) "mean_delay_h")) M("W5", paste(candidate, variant, old_rule, qq, sep = "|"), "w5_n_runs", length(day))
  if ("MAE" %in% quantities) {
    ci <- boot_ci(bm[, 3]); note_skips("W5_candidates", key_, "MAE_diff", ci[3])
    add_row(candidate, variant, old_rule, "MAE", pt[1], pt[2], pt[3], ci[1], ci[2], NA, NA, NA, label_interval(ci[1], ci[2], 0.5, 1.0))
  }
  if ("cycle" %in% quantities) {
    ci <- boot_ci(bm[, 6]); cp <- boot_ci(bm[, 8]); note_skips("W5_candidates", key_, "cycle_diff", ci[3]); note_skips("W5_candidates", key_, "cycle_share_p", cp[3])
    add_row(candidate, variant, old_rule, "cycle", pt[4], pt[5], pt[6], ci[1], ci[2], pt_p, cp[1], cp[2], label_interval(cp[1], cp[2], 0.05, 0.10))
  }
  if (!is.null(delay)) {
    ci <- boot_ci(bm[, 11]); note_skips("W5_candidates", key_, "mean_delay_diff", ci[3])
    add_row(candidate, variant, old_rule, "mean_delay_h", pt[9], pt[10], pt[11], ci[1], ci[2], NA, NA, NA, "")
  }
  invisible(pt)
}
const_f <- function(v) function(wr) v

## ---- H1 and H7 (2x2x2)
cell <- function(rule, fn, rp, df_) {
  z <- xx[xx$old_rule == rule & xx$flow_numbers == fn & xx$reading_pick_from == rp & xx$due_from == df_, ]
  z[order(z$seq), ]
}
H1_INFO <- list()
for (rule in c("A", "B", "C")) {
  scen_old <- paste0("S-old-", rule)
  mk <- function(z, df_) { t1 <- scen_t1(if (df_ == "old") scen_old else "S-new", z$seq); z$t1 <- t1; z$e <- pct_err(z$raw_cfs, t1); z$hr <- local_hour_int(z$due_m); z }
  nseq <- RU$seq[RU$phase == "NEW"]
  # H1
  for (var in c("new_numbers", "old_numbers")) {
    fn <- if (var == "new_numbers") "new" else "old"
    dfv <- fn
    za <- mk(cell(rule, fn, "new", dfv), dfv); zb <- mk(cell(rule, fn, "old", dfv), dfv)
    za <- za[match(nseq, za$seq), ]; zb <- zb[match(nseq, zb$seq), ]
    ok <- !is.na(za$e) & !is.na(zb$e)
    M("W5", paste0("H1_", var, "_", rule), "n_new_runs_dropped_blank_T1", sum(!ok))
    za <- za[ok, ]; zb <- zb[ok, ]
    day <- RU$day[match(za$seq, RU$seq)]
    pt <- paired_rows("H1", var, rule, day, const_f(za$e), za$hr, const_f(zb$e), zb$hr,
                      delay = list(a = za$trv_t_of_pick_h + za$gf2lf_h, b = zb$trv_t_of_pick_h + zb$gf2lf_h))
    if (var == "new_numbers") H1_INFO[[rule]] <- list(mae_a = pt[1], mae_b = pt[2], da = pt[9], db = pt[10])
  }
  # H7
  za <- mk(cell(rule, "new", "new", "new"), "new"); zb <- mk(cell(rule, "new", "new", "old"), "old")
  za <- za[match(nseq, za$seq), ]; zb <- zb[match(nseq, zb$seq), ]
  ok <- !is.na(za$e) & !is.na(zb$e)
  M("W5", paste0("H7_", rule), "n_new_runs_dropped_blank_T1", sum(!ok))
  za <- za[ok, ]; zb <- zb[ok, ]
  paired_rows("H7", "", rule, RU$day[match(za$seq, RU$seq)], const_f(za$e), za$hr, const_f(zb$e), zb$hr)
}
# H1 verdict
for (rule in c("A", "B", "C")) {
  I <- H1_INFO[[rule]]; Tt <- DECISION$total_delay_h
  v <- "undetermined"
  if (DECISION$resolved) {
    dA <- abs(Tt - I$da); dB <- abs(Tt - I$db)
    if (dB - dA >= 2) v <- if (I$mae_a < I$mae_b) "supported" else "not supported"
    else if (dA - dB >= 2) v <- if (I$mae_b < I$mae_a) "supported" else "not supported"
  }
  M("W5", rule, "h1_verdict", v)
}

## ---- H3, H4, H6 (S0 logged, W4 universe, phase NEW or OLD)
for (ph in c("NEW", "OLD")) {
  z <- RW[RW$phase == ph, ]
  eb <- pct_err(ifelse(is.na(z$delta_ratio), z$raw_cfs, z$raw_cfs / z$delta_ratio), z$t1)
  paired_rows("H3", ph, "", z$day, const_f(z$e_raw), z$hour_due, const_f(eb), z$hour_due, cref_g2 = (ph == "OLD"))
}
mm <- sum(abs(RU$final_cfs - pmin(RU$raw_cfs - RU$corr_c, RU$ceil_lim)) > 1)
M("W5", "", "h4_formula_mismatches", mm)
M("W5", "", "h4_formula_n_runs_checked", nrow(RU))
z <- RW[RW$phase == "NEW", ]
eb_f <- function(wr) { m <- wmean(z$corr_c, wr); pct_err(pmin(z$raw_cfs - m, z$ceil_lim), z$t1) }
paired_rows("H4", "mean_correction", "", z$day, const_f(z$e_final), z$hour_due, eb_f, z$hour_due)
paired_rows("H4", "final_vs_raw", "", z$day, const_f(z$e_final), z$hour_due, const_f(z$e_raw), z$hour_due, quantities = "cycle")
paired_rows("H6", "", "", z$day, const_f(z$e_final), z$hour_due, const_f(pct_err(z$raw_cfs - z$corr_c, z$t1)), z$hour_due)
for (ph in PHASES) M("W5", ph, "h6_share_ceil_bound_1_all_used_runs", mean(RU$ceil_bound[RU$phase == ph]))
for (ph in PHASES) M("W5", ph, "h6_share_ceil_bound_1_W4_runs", mean(RW$ceil_bound[RW$phase == ph]))

## ---- H8 flips per day
flips_days <- function(st, seqv, phv, dayv, ph) {
  keep <- phv == ph; st <- st[keep]; seqv <- seqv[keep]; dayv <- dayv[keep]
  o <- order(dayv, seqv); st <- st[o]; dayv <- dayv[o]
  ud <- sort(unique(dayv)); res <- data.frame(day = ud, n = NA_integer_, flips = NA_integer_)
  for (i in seq_along(ud)) { s <- st[dayv == ud[i]]; res$n[i] <- length(s); res$flips[i] <- sum(s[-1] != s[-length(s)]) }
  res[res$n >= 3, ]
}
for (ph in c("NEW", "OLD")) {
  s0 <- flips_days(RU$corr_st, RU$seq, RU$phase, RU$day, ph)
  M("W5", ph, "h8_s0_logged_flips_per_day", mean(s0$flips)); M("W5", ph, "h8_s0_logged_n_days", nrow(s0))
  for (rule in c("A", "B", "C")) {
    sn <- rr[rr$scenario == "S-new", ]; so <- rr[rr$scenario == paste0("S-old-", rule), ]
    ph_n <- RU$phase[match(sn$seq, RU$seq)]; day_n <- RU$day[match(sn$seq, RU$seq)]
    fa <- flips_days(sn$corr_st, sn$seq, ph_n, day_n, ph)
    ph_o <- RU$phase[match(so$seq, RU$seq)]; day_o <- RU$day[match(so$seq, RU$seq)]
    fb <- flips_days(so$corr_st, so$seq, ph_o, day_o, ph)
    stopifnot(identical(fa$day, fb$day))
    D <- nrow(fa)
    stat <- function(w1, w2) { a <- sum(w1 * fa$flips) / sum(w1); b <- sum(w1 * fb$flips) / sum(w1); c(a, b, a - b) }
    pt <- stat(rep(1L, D), NULL); ci <- boot_ci(boot_matrix(D, stat)[, 3]); note_skips("W5_candidates", paste("H8", ph, rule), "diff", ci[3])
    M("W5", paste("H8", ph, rule, "flips_per_day", sep = "|"), "w5_n_runs", sum(fa$n)); add_row("H8", ph, rule, "flips_per_day", pt[1], pt[2], pt[3], ci[1], ci[2], NA, NA, NA, "")
  }
}

## ---- H2 the wave itself
H2S <- list(por_level = key("01638500", "00065"), por_flow = key("01638500", "00060"),
            lf_level = key("01646500", "00065"), lf_flow = key("01646500", "00060"))
P7r <- perd("P7"); P5r <- perd("P5"); P6r <- perd("P6")
for (vn in names(H2S)) {
  dd <- DAILY[[H2S[[vn]]]]
  ga <- nonevent_days(dd, P7r[1], P7r[2])
  gb <- rbind(nonevent_days(dd, P5r[1], P5r[2]), nonevent_days(dd, P6r[1], P6r[2]))
  xa <- ga$A_a; xb <- gb$A_a
  stat <- function(w1, w2) { a <- wmedian(xa, w1); b <- wmedian(xb, w2); c(a, b, a - b) }
  pt <- stat(rep(1L, length(xa)), rep(1L, length(xb)))
  ci <- boot_ci(boot_matrix(length(xa), stat, length(xb))[, 3]); note_skips("W5_candidates", paste("H2", vn), "diff", ci[3])
  M("W5", paste("H2", vn, "", "median_A_a", sep = "|"), "w5_n_runs", length(xa) + length(xb)); add_row("H2", vn, "", "median_A_a", pt[1], pt[2], pt[3], ci[1], ci[2], NA, NA, NA, "")
  M("W5", vn, "h2_ratio_a_over_b", pt[1] / pt[2]); M("W5", vn, "h2_n_days_a", length(xa)); M("W5", vn, "h2_n_days_b", length(xb))
}

## ---- H5 too few checks: cycle of e_raw, NEW minus OLD (group 1 = NEW)
scen_tab <- list(S0_logged = NULL)
h5 <- function(variant, df_) {   # df_: data frame with columns day, phase, e, hr
  zn <- df_[df_$phase == "NEW" & !is.na(df_$e), ]; zo <- df_[df_$phase == "OLD" & !is.na(df_$e), ]
  bn <- sort(unique(zn$day)); bo <- sort(unique(zo$day))
  kn <- match(zn$day, bn); ko <- match(zo$day, bo); Hn <- make_H(zn$hr); Ho <- make_H(zo$hr)
  kc <- match(CREF_DAY, bn)
  stat <- function(w1, w2) {
    cn <- cycle_stats(zn$e, Hn, w1[kn])$cycle; co <- cycle_stats(zo$e, Ho, w2[ko])$cycle
    wc <- w1[kc]; wc[is.na(wc)] <- 0
    cref <- cycle_stats(CREF_E, CREF_H, wc)$cycle
    c(cn, co, cn - co, cref, if (is.na(cref) || cref == 0) NA_real_ else (cn - co) / cref)
  }
  pt <- stat(rep(1L, length(bn)), rep(1L, length(bo)))
  bm <- boot_matrix(length(bn), stat, length(bo))
  ci <- boot_ci(bm[, 3]); cp <- boot_ci(bm[, 5]); note_skips("W5_candidates", paste("H5", variant), "diff", ci[3]); note_skips("W5_candidates", paste("H5", variant), "share_p", cp[3])
  sp <- if (is.na(CREF_FULL) || CREF_FULL == 0) NA_real_ else pt[3] / CREF_FULL
  M("W5", paste("H5", variant, "", "cycle", sep = "|"), "w5_n_runs", nrow(zn) + nrow(zo))
  add_row("H5", variant, "", "cycle", pt[1], pt[2], pt[3], ci[1], ci[2], sp, cp[1], cp[2], label_interval(cp[1], cp[2], 0.05, 0.10))
}
h5("S0_logged", data.frame(day = RW$day, phase = RW$phase, e = RW$e_raw, hr = RW$hour_due))
for (sc in c("S-new", "S-old-A", "S-old-B", "S-old-C")) {
  z <- rr[rr$scenario == sc, ]
  t1 <- scen_t1(sc, z$seq)
  h5(sc, data.frame(day = RU$day[match(z$seq, RU$seq)], phase = RU$phase[match(z$seq, RU$seq)], e = pct_err(z$raw_cfs, t1), hr = local_hour_int(z$due_m)))
}

## ---- H9 pumping: EF level vs LF level, P7, non-event at both
dE <- DAILY[[key("01644148", "00065")]]; dL <- DAILY[[key("01646500", "00065")]]
D9 <- P7r[1]:P7r[2]; iE <- match(D9, dE$day); iL <- match(D9, dL$day)
ok <- dE$event_day[iE] == 0 & dL$event_day[iL] == 0 & !is.na(dE$A_a[iE]) & !is.na(dL$A_a[iL])
xe <- dE$A_a[iE][ok]; xl <- dL$A_a[iL][ok]
stat <- function(w1, w2) { a <- wmedian(xe, w1); b <- wmedian(xl, w1); c(a, b, a - b) }
pt <- stat(rep(1L, length(xe)), NULL); ci <- boot_ci(boot_matrix(length(xe), stat)[, 3]); note_skips("W5_candidates", "H9", "diff", ci[3])
M("W5", "H9|||median_A_a", "w5_n_runs", length(xe)); add_row("H9", "", "", "median_A_a", pt[1], pt[2], pt[3], ci[1], ci[2], NA, NA, NA, "")
M("W5", "", "h9_ratio_a_over_b", pt[1] / pt[2]); M("W5", "", "h9_n_days", length(xe))

W5T <- do.call(rbind, W5)
W5T <- W5T[order(W5T$candidate, W5T$variant, W5T$old_rule, W5T$quantity, method = "radix"), ]
wtab(W5T, "W5_candidates")
write_metrics()

## ======================================================== W6
ck <- read.csv(file.path(SD, "checks.csv"), colClasses = "character", na.strings = "", stringsAsFactors = FALSE)
ck <- ck[order(ck$created_at_utc), ]
im <- match(ck$predTs_utc, runs_all$final_ts_utc)
run_seq <- as.integer(runs_all$seq[im])
ph_c <- RU$phase[match(run_seq, RU$seq)]
W6 <- data.frame(seq_check = as.integer(ck$seq), run_seq = run_seq, phase = ph_c, bin = ck$bin, st = ck$st,
  hour_pred = local_hour_int(tmin(ck$predTs_utc)), hour_due = local_hour_int(tmin(ck$dueAt_utc)), hour_check = local_hour_int(tmin(ck$valAt_utc)),
  delayMin = as.numeric(ck$delayMin), errPctRaw = as.numeric(ck$errPctRaw), errPctCorr = as.numeric(ck$errPctCorr), stringsAsFactors = FALSE)
wtab(W6, "W6_checks")
M("W6", "", "check_without_run_seq_check", paste(W6$seq_check[is.na(W6$run_seq)], collapse = "|"))
W6$bin_key <- paste(W6$bin, W6$st, sep = "_")
rows <- list()
for (bk in sort(unique(W6$bin_key), method = "radix")) {
  z <- W6[W6$bin_key == bk, ]
  rows[[length(rows) + 1]] <- data.frame(bin_key = bk, n = nrow(z), hours_pred = paste(sort(z$hour_pred), collapse = "|"),
                                          hours_due = paste(sort(z$hour_due), collapse = "|"), stringsAsFactors = FALSE)
}
wtab(do.call(rbind, rows), "W6_by_bin")
meanall <- W4_STAT[["NEW e_raw"]]$mean
M("W6", "NEW", "mean_e_raw_all_runs", meanall)
cn <- W6[!is.na(W6$phase) & W6$phase == "NEW", ]
mu <- W4_STAT[["NEW e_raw"]]$mu; vd <- W4_STAT[["NEW e_raw"]]$valid
hv <- ifelse(vd[cn$hour_due + 1], mu[cn$hour_due + 1], NA)
M("W6", "NEW", "n_checks_phase_NEW", nrow(cn))
M("W6", "NEW", "mean_e_raw_at_check_hours", omean(hv))
M("W6", "NEW", "n_checks_skipped_nonvalid_hour", sum(is.na(hv)))
M("W6", "NEW", "n_distinct_hours_due", length(unique(cn$hour_due)))
write_metrics()
cat("W4/W5/W6 done\n")

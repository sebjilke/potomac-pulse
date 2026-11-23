cat("R4\n")
WS4 <- tsec("2026-08-31T00:00:00Z")
PS <- list(); DM <- list()
mk <- function(name, src, g, p, old = FALSE) {
  d <- getser(src, g, p)
  ps <- prep_series(d$t, d$v, WS4, CUT)
  PS[[name]] <<- ps; DM[[name]] <<- day_means(ps)
  addm("PREP_R4", name, "step_minutes", ps$step / 60); addm("PREP_R4", name, "n_grid", ps$n_grid)
  addm("PREP_R4", name, "n_present", ps$n_present); addm("PREP_R4", name, "n_filled", ps$n_filled); addm("PREP_R4", name, "n_missing", ps$n_missing)
}
mk("por_old", "old", G$por, "00060"); mk("por_cur", "census", G$por, "00060"); mk("lf", "census", G$lf, "00060")
mk("shep", "up", G$shep, "00060"); mk("mill", "up", G$mill, "00060"); mk("ant", "up", G$ant, "00060"); mk("cat", "up", G$cat, "00060")
mk("mono", "model", G$mono, "00060"); mk("goose", "model", G$goose, "00060"); mk("br", "model", G$br, "00060"); mk("sen", "model", G$sen, "00060")
mk("por_lev", "model", G$por, "00065")
dnum <- function(s) tsec(paste0(s, "T00:00:00Z")) / 86400
dget <- function(name, dn) DM[[name]]$mean[match(dn, DM[[name]]$dn)]
sum4 <- function(nms, dn) { m <- sapply(nms, function(n) dget(n, dn)); if (is.null(dim(m))) m <- matrix(m, nrow = length(dn)); ifelse(rowSums(is.na(m)) == 0, rowSums(m), NA_real_) }
U_fun <- function(dn) sum4(c("shep", "mill", "ant", "cat"), dn)
T_fun <- function(dn) sum4(c("mono", "goose", "br", "sen"), dn)
rev_days <- unique(P$day[P$rev13])
is_rev <- function(dn) day_str(dn) %in% rev_days

# ratings bands from the visits of ALL gauges
band_on <- function(g, dn_vec) {   # band at the end of each day, latest visit with discharge
  v <- VIS[[g]]; v <- v[!is.na(v$flow_cfs), ]; v <- v[order(v$t), ]
  sapply(dn_vec, function(dn) { k <- which(v$t < (dn + 1) * 86400); if (!length(k)) NA_real_ else band_of_rating(v$measurement_rated[max(k)]) })
}
band_max <- function(g, dn_vec) { b <- band_on(g, dn_vec); if (!length(b) || any(is.na(b))) NA_real_ else max(b) }

# ---------- (0) hand measurements ----------
mv <- MV[tsec(MV$visit_time_utc) >= tsec("2026-06-12T00:00:00Z"), ]
mv$band_pct <- band_of_rating(mv$measurement_rated) * 100
mv$current_inside_band <- as.integer(abs(mv$pct_current_vs_measured) <= mv$band_pct)
mv$old_inside_band <- ifelse(is.na(mv$old_cfs), NA_integer_, as.integer(abs(mv$pct_old_vs_measured) <= mv$band_pct))
fo <- FOLDV; fo$t <- tsec(fo$time_utc)
fo <- fo[order(fo$t), ]
nearest_idx <- function(tq, tr) {
  out <- rep(NA_integer_, length(tq)); i <- findInterval(tq, tr); n <- length(tr)
  for (j in seq_along(tq)) { cand <- c(i[j], i[j] + 1); cand <- cand[cand >= 1 & cand <= n]; if (!length(cand)) next
    d <- abs(tr[cand] - tq[j]); if (min(d) <= 900) out[j] <- cand[which.min(d)] }
  out
}
fi <- nearest_idx(tsec(mv$visit_time_utc), fo$t)
mv$f_old_A <- num(fo$f_old_rule_A_cfs[fi]); mv$f_old_B <- num(fo$f_old_rule_B_cfs[fi]); mv$f_old_C <- num(fo$f_old_rule_C_cfs[fi])
for (r in c("A", "B", "C")) mv[[paste0("pct_f_old_", r, "_vs_measured")]] <- (mv[[paste0("f_old_", r)]] - mv$measured_cfs) / mv$measured_cfs * 100
wtab(mv, "R4_0_por")
up <- list()
for (g in UPSTREAM) {
  v <- VIS[[g]]; v <- v[!is.na(v$flow_cfs) & v$visit_time_utc >= "2026-09-01T00:00:00Z", ]
  if (!nrow(v)) next
  d <- getser("up", g, "00060"); d <- d[!is.na(d$v), ]
  cu <- nearest15(v$t, d$t, d$v)
  up[[length(up) + 1]] <- data.frame(gauge = g, visit_time_utc = v$visit_time_utc, level_ft = v$level_ft, measured_cfs = v$flow_cfs,
        measurement_rated = v$measurement_rated, current_cfs = cu, pct = (cu - v$flow_cfs) / v$flow_cfs * 100,
        band_pct = band_of_rating(v$measurement_rated) * 100, stringsAsFactors = FALSE)
}
up <- do.call(rbind, up); up$inside_band <- as.integer(abs(up$pct) <= up$band_pct)
up <- up[order(up$gauge, tsec(up$visit_time_utc)), ]
wtab(up, "R4_0_upstream")

# ---------- (a) water balance ----------
d0 <- dnum("2026-09-03"); d1 <- dnum("2026-11-09"); dns <- d0:d1
ev_por <- event_flag(PS$por_cur, dns); ev_sh <- event_flag(PS$shep, dns); ev_mi <- event_flag(PS$mill, dns)
A <- data.frame(day_utc = day_str(dns), steady = as.integer(!ev_por & !ev_sh & !ev_mi), revised = as.integer(is_rev(dns)),
                por_old = dget("por_old", dns), por_current = dget("por_cur", dns),
                u_lag0 = U_fun(dns), u_lag1 = U_fun(dns - 1), u_lag2 = U_fun(dns - 2))
wtab(A, "R4_a_days")
addm("R4", NA, "n_days_R4a", nrow(A)); addm("R4", NA, "n_steady_days_R4a", sum(A$steady)); addm("R4", NA, "n_steady_revised_days_R4a", sum(A$steady == 1 & A$revised == 1))
bU <- max(sapply(c(G$shep, G$mill, G$ant, G$cat), function(g) band_on(g, dnum("2026-11-22"))))
addm("R4", NA, "b_u_2026-11-22", bU)
vr <- list()
for (lag in 0:2) {
  u <- A[[paste0("u_lag", lag)]]
  ro <- A$por_old / u; rn <- A$por_current / u
  sr <- A$steady == 1 & A$revised == 1 & !is.na(ro) & !is.na(rn)
  su <- A$steady == 1 & A$revised == 0 & !is.na(rn)
  n_su <- sum(su); c_emp <- if (n_su >= 10) median(rn[su]) else NA_real_
  addm("R4", paste0("lag", lag), "n_steady_unrevised_days", n_su)
  bP <- if (any(sr)) band_max_days <- max(sapply(dns[sr], function(dn) band_on(G$por, dn))) else NA_real_
  for (ck in c("fixed", "empirical")) {
    cc <- if (ck == "fixed") 1.03 else c_emp
    for (bk in c("ratings", "fixed_0113")) {
      b <- if (bk == "ratings") sqrt(bP^2 + bU^2) else 0.113
      mo <- med(ro[sr]); mn <- med(rn[sr])
      if (is.na(cc) || !any(sr)) { vr[[length(vr) + 1]] <- data.frame(lag = lag, centre_kind = ck, band_kind = bk, median_ratio_old = mo, median_ratio_new = mn, n_days = sum(sr),
          b_por = bP, b_u = bU, b = b, old_inside_band = NA_integer_, new_inside_band = NA_integer_, verdict = NA_character_, c = cc); next }
      lo <- cc / (1 + b); hi <- cc * (1 + b)
      oi <- as.integer(mo >= lo & mo <= hi); ni <- as.integer(mn >= lo & mn <= hi)
      vd <- if (ni == 1 && oi == 0) "B supported" else if (oi == 1 && ni == 0) "A supported" else "undetermined"
      vr[[length(vr) + 1]] <- data.frame(lag = lag, centre_kind = ck, band_kind = bk, median_ratio_old = mo, median_ratio_new = mn, n_days = sum(sr),
          b_por = bP, b_u = bU, b = b, old_inside_band = oi, new_inside_band = ni, verdict = vd, c = cc)
    }
  }
}
vr <- do.call(rbind, vr); vr <- vr[order(vr$lag, vr$centre_kind, vr$band_kind), ]
wtab(vr, "R4_a_verdicts")

# ---------- (b) balance at Little Falls with withdrawals ----------
dB <- dnum("2026-09-01"):floor(CUT / 86400)
Wd <- WDAY$w_cfs[match(day_str(dB), WDAY$day)]
brows <- list(); used_w_days <- character()
for (lag in 1:3) {
  Dd <- dB; Dp <- dB - lag
  lf <- dget("lf", Dd); pc <- dget("por_cur", Dp); po <- dget("por_old", Dp); tr <- T_fun(Dp); w <- Wd
  evP <- event_flag(PS$por_cur, Dp); evL <- event_flag(PS$lf, Dd)
  ok <- !is.na(w) & !is.na(lf) & !is.na(pc) & !is.na(tr) & !evP & !evL
  x <- data.frame(day_utc = day_str(Dd), lag = lag, revised = as.integer(is_rev(Dp)), lf = lf, por_old = po, por_current = pc, trib = tr, w_cfs = w,
                  resid_old = lf - (po + tr - w), resid_new = lf - (pc + tr - w), dn = Dd, dnp = Dp)
  brows[[lag]] <- x[ok, ]
  used_w_days <- c(used_w_days, x$day_utc[ok])
}
B <- do.call(rbind, brows); B <- B[order(B$day_utc, B$lag), ]
wtab(B[, c("day_utc", "lag", "revised", "lf", "por_old", "por_current", "trib", "w_cfs", "resid_old", "resid_new")], "R4_b_days")
uw <- unique(used_w_days)
addm("R4", NA, "n_withdrawal_values_used_with_flag", sum(!is.na(WDAY$flag[match(uw, WDAY$day)])))
addm("R4", NA, "n_withdrawal_days_used", length(uw))
bv <- list()
for (lag in 1:3) {
  for (st in c("revised", "unrevised")) {
    x <- B[B$lag == lag & B$revised == ifelse(st == "revised", 1, 0) & !is.na(B$resid_old) & !is.na(B$resid_new), ]
    for (bk in c("ratings", "fixed_0113")) {
      if (!nrow(x)) { bv[[length(bv) + 1]] <- data.frame(lag = lag, set = st, band_kind = bk, n_days = 0, median_lf = NA_real_, median_resid_old = NA_real_, median_resid_new = NA_real_,
          mean_resid_old = NA_real_, mean_resid_new = NA_real_, b = NA_real_, band_cfs = NA_real_, verdict = NA_character_); next }
      ml <- median(x$lf)
      bP <- max(sapply(x$dnp, function(dn) band_on(G$por, dn))); bL <- max(sapply(x$dn, function(dn) band_on(G$lf, dn)))
      b <- if (bk == "ratings") sqrt(bP^2 + bL^2) else 0.113
      band <- b * ml
      mo <- median(x$resid_old); mn <- median(x$resid_new)
      vd <- NA_character_
      if (st == "revised") { ni <- abs(mn) <= band; oi <- abs(mo) <= band
        vd <- if (ni && !oi) "B supported" else if (oi && !ni) "A supported" else "undetermined" }
      bv[[length(bv) + 1]] <- data.frame(lag = lag, set = st, band_kind = bk, n_days = nrow(x), median_lf = ml, median_resid_old = mo, median_resid_new = mn,
          mean_resid_old = mean(x$resid_old), mean_resid_new = mean(x$resid_new), b = b, band_cfs = band, verdict = vd)
      if (bk == "ratings") {
        g <- sprintf("lag%d_%s", lag, st)
        addm("R4", g, "median_resid_old_pct_of_median_lf", mo / ml * 100); addm("R4", g, "median_resid_new_pct_of_median_lf", mn / ml * 100)
        addm("R4", g, "mean_resid_old_pct_of_median_lf", mean(x$resid_old) / ml * 100); addm("R4", g, "mean_resid_new_pct_of_median_lf", mean(x$resid_new) / ml * 100)
        addm("R4", g, "b_por", bP); addm("R4", g, "b_lf", bL)
      }
    }
  }
  xa <- B[B$lag == lag & B$day_utc > "2026-11-09" & !is.na(B$resid_new), ]
  addm("R4", paste0("lag", lag), "median_resid_new_after_nov9", med(xa$resid_new)); addm("R4", paste0("lag", lag), "n_after_nov9", nrow(xa))
}
bv <- do.call(rbind, bv); bv <- bv[order(bv$lag, bv$set, bv$band_kind), ]
wtab(bv, "R4_b_verdicts")

# ---------- (c) estimate against LF plus withdrawals ----------
RT$due_day <- day_of(RT$due_s0)
RT$w_cfs <- WDAY$w_cfs[match(RT$due_day, WDAY$day)]
cr <- RT[!is.na(RT$t1_s0), ]
addm("R4", NA, "c_runs_with_t1", nrow(cr)); addm("R4", NA, "c_runs_dropped_t1_blank", sum(is.na(RT$t1_s0)))
addm("R4", NA, "c_runs_dropped_w_missing", sum(is.na(cr$w_cfs)))
cr <- cr[!is.na(cr$w_cfs), ]
cr$e_raw <- (cr$raw_s0 - cr$t1_s0) / cr$t1_s0 * 100
cr$e_adj <- (cr$raw_s0 - (cr$t1_s0 + cr$w_cfs)) / (cr$t1_s0 + cr$w_cfs) * 100
cr <- cr[order(cr$seq), ]
wtab(data.frame(seq = cr$seq, at_utc = cr$at_utc, phase = cr$phase, gate_miss = cr$gate_miss, raw_cfs = cr$raw_s0, t1 = cr$t1_s0, w_cfs = cr$w_cfs,
                e_raw = cr$e_raw, e_adj = cr$e_adj), "R4_c_runs")
for (p in c("OLD", "TRANS", "NEW")) {
  x <- cr[cr$phase == p, ]
  X <- cbind(e_raw = x$e_raw, e_adj = x$e_adj, a_raw = abs(x$e_raw), a_adj = abs(x$e_adj))
  ci <- boot_means(x$day, X)
  addm("R4", p, "n", nrow(x))
  for (j in 1:4) { nm <- c("mean_e_raw", "mean_e_adj", "mean_abs_e_raw", "mean_abs_e_adj")[j]
    addm("R4", p, nm, mean(X[, j])); addm("R4", p, paste0(nm, "_lo"), ci[j, 1]); addm("R4", p, paste0(nm, "_hi"), ci[j, 2]); addm("R4", p, paste0(nm, "_nskip"), ci[j, 3]) }
}
x <- cr[cr$phase == "NEW", ]
dd <- sort(unique(x$due_day))
md <- sapply(dd, function(d) mean(x$raw_s0[x$due_day == d] - x$t1_s0[x$due_day == d]))
wd <- WDAY$w_cfs[match(dd, WDAY$day)]
addm("R4", "NEW", "daily_n_days", length(dd))
addm("R4", "NEW", "daily_corr_m_on_w", cor_na(wd, md)); addm("R4", "NEW", "daily_slope_m_on_w", slope2(wd, md))
addm("R4", "NEW", "daily_sd_w_cfs", sd_na(wd)); addm("R4", "NEW", "daily_sd_m_cfs", sd_na(md))
flush_metrics()

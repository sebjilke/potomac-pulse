# q_W3.R : travel and damping (sourced after q_W12.R and q_runs.R)
pair_def <- list(`PoR-EF` = c("01638500", "01644148"), `EF-LF` = c("01644148", "01646500"), `PoR-LF` = c("01638500", "01646500"))
kLvl <- function(g) key(g, "00065")
WIN <- list(nov_all = c(dnum("2026-11-01"), dnum("2026-11-22")), nov_pre = c(dnum("2026-11-01"), dnum("2026-11-13")),
            nov_post = c(dnum("2026-11-14"), dnum("2026-11-22")))

# ---- (2) legs by lagged correlation
lags5 <- seq(0, 72 * 60, by = 5)
rows <- list(); rowsm <- list(); XC <- list()
for (pn in names(pair_def)) {
  gx <- pair_def[[pn]][1]; gy <- pair_def[[pn]][2]
  dx <- master_d(kLvl(gx), interp15 = (SER[[kLvl(gx)]]$step == 15))
  dy <- master_d(kLvl(gy), interp15 = (SER[[kLvl(gy)]]$step == 15))
  for (wn in names(WIN)) {
    w <- WIN[[wn]]
    res <- lagcorr(dx, dy, ok_mask(gx, w[1], w[2]), ok_mask(gy, w[1], w[2]), lags5, 5)
    mx <- max_lag(res); XC[[paste(pn, wn)]] <- mx
    rows[[length(rows) + 1]] <- data.frame(pair = pn, window = wn, lag_h_of_max_r = mx$lag_min / 60, max_r = mx$r,
      lag_h_mod_24 = mod24(mx$lag_min / 60), n_points = mx$n, stringsAsFactors = FALSE)
    lm_ <- local_maxima(res, 5, 0.3)
    if (nrow(lm_) > 0) rowsm[[length(rowsm) + 1]] <- data.frame(pair = pn, window = wn, lag_h = lm_$lag_min / 60, r = lm_$r, stringsAsFactors = FALSE)
  }
}
df <- do.call(rbind, rows); df <- df[order(df$pair, df$window, method = "radix"), ]; wtab(df, "W3_xcorr")
XCT <- df
df <- do.call(rbind, rowsm); df <- df[order(df$pair, df$window, df$lag_h, method = "radix"), ]; wtab(df, "W3_xcorr_maxima")
lm24 <- function(pn, wn) XCT$lag_h_mod_24[XCT$pair == pn & XCT$window == wn]
legs <- diff12(((lm24("PoR-EF", "nov_all") + lm24("EF-LF", "nov_all")) %% 24) - lm24("PoR-LF", "nov_all"))
M("W3", "", "legs_add_up_h", legs)

# ---- (3) individual crests
rows <- list()
for (pn in names(pair_def)) {
  du <- DAILY[[kLvl(pair_def[[pn]][1])]]; dd <- DAILY[[kLvl(pair_def[[pn]][2])]]
  lo <- dnum("2026-11-01"); hi <- dnum("2026-11-22")
  du <- du[du$day >= lo & du$day <= hi, ]; dd <- dd[match(du$day, dd$day), ]
  ok <- du$event_day == 0 & dd$event_day == 0 & !is.na(du$crest_utc_h) & !is.na(dd$crest_utc_h)
  lagh <- mod24(dd$crest_utc_h[ok] - du$crest_utc_h[ok])
  rows[[length(rows) + 1]] <- data.frame(pair = pn, n_days = sum(ok), circmean_h = circ_mean(lagh), circ_sd_h = circ_sd(lagh), stringsAsFactors = FALSE)
}
df <- do.call(rbind, rows); df <- df[order(df$pair, method = "radix"), ]; wtab(df, "W3_crests")
CRESTS <- df

# ---- (1) day-to-day changes of size
SZ_LO <- dnum("2026-09-15"); SZ_HI <- dnum("2026-11-22")
rows <- list()
for (pn in names(pair_def)) {
  du <- DAILY[[kLvl(pair_def[[pn]][1])]]; dd <- DAILY[[kLvl(pair_def[[pn]][2])]]
  for (k in 0:4) {
    D <- SZ_LO:(SZ_HI - k)
    iu <- match(D, du$day); id <- match(D + k, dd$day)
    ok <- du$event_day[iu] == 0 & dd$event_day[id] == 0 & !is.na(du$A_a[iu]) & !is.na(dd$A_a[id])
    n <- sum(ok)
    r <- if (n >= 3 && sd(du$A_a[iu][ok]) > 0 && sd(dd$A_a[id][ok]) > 0) cor(du$A_a[iu][ok], dd$A_a[id][ok]) else NA_real_
    rows[[length(rows) + 1]] <- data.frame(pair = pn, k_days = k, r = r, n_days = n, stringsAsFactors = FALSE)
  }
}
df <- do.call(rbind, rows); df <- df[order(df$pair, df$k_days, method = "radix"), ]; wtab(df, "W3_size_lag")

weak_rows <- list()
for (g in c("01638500", "01644148", "01646500")) {
  dd <- DAILY[[kLvl(g)]]
  dd <- dd[dd$day >= SZ_LO & dd$day <= SZ_HI, ]
  good <- dd$event_day == 0 & !is.na(dd$A_a)
  for (i in which(good)) {
    nb <- c(-3:-1, 1:3) + i
    nb <- nb[nb >= 1 & nb <= nrow(dd)]
    nb <- nb[good[nb]]
    if (length(nb) < 4) next
    med <- median(dd$A_a[nb])
    if (dd$A_a[i] < 0.6 * med)
      weak_rows[[length(weak_rows) + 1]] <- data.frame(gauge = g, day = dd$day[i], day_utc = dd$day_utc[i], A_a = dd$A_a[i], neighbour_median = med, stringsAsFactors = FALSE)
  }
}
WEAK <- if (length(weak_rows)) do.call(rbind, weak_rows) else data.frame(gauge = character(), day = numeric(), day_utc = character(), A_a = numeric(), neighbour_median = numeric())
WEAK <- WEAK[order(WEAK$gauge, WEAK$day, method = "radix"), ]
wtab(WEAK, "W3_weak_days", c("gauge", "day_utc", "A_a", "neighbour_median"))
pw <- WEAK[WEAK$gauge == "01638500", ]; lw <- WEAK[WEAK$gauge == "01646500", ]
mrows <- list()
for (i in seq_len(nrow(pw))) for (k in 0:4) {
  j <- which(lw$day == pw$day[i] + k)
  if (length(j)) mrows[[length(mrows) + 1]] <- data.frame(por_day = pw$day_utc[i], lf_day = lw$day_utc[j], k_days = k, stringsAsFactors = FALSE)
}
MATCH <- if (length(mrows)) do.call(rbind, mrows) else data.frame(por_day = character(), lf_day = character(), k_days = integer())
MATCH <- MATCH[order(MATCH$por_day, MATCH$lf_day, method = "radix"), ]
wtab(MATCH, "W3_weak_matches")
n_por_weak_with_match <- length(unique(MATCH$por_day))
decisive <- as.integer(n_por_weak_with_match >= 2 && length(unique(MATCH$k_days)) == 1)
M("W3", "", "n_por_weak_days", nrow(pw)); M("W3", "", "n_lf_weak_days", nrow(lw))
M("W3", "", "n_por_weak_days_with_match", n_por_weak_with_match)
M("W3", "", "size_method_decisive", decisive)
size_k <- if (decisive == 1) MATCH$k_days[1] else NA
if (decisive == 1) M("W3", "", "size_method_k_days", size_k)

# ---- (4) non-periodic disturbances
cat("== W3(4) preparation\n")
sP <- build(mod, "01638500", "00065", start = START_W34, tag = "W34")
sL <- build(mod, "01646500", "00065", start = START_W34, tag = "W34")
sF <- build(cen, "01646500", "00060", start = START_W34, tag = "W34")
onsets <- function(s) {
  n <- s$n; lead <- round(1440 / s$step); back <- round(4320 / s$step)
  ma <- s$MA
  cond <- rep(FALSE, n)
  i <- seq_len(n - lead)
  cond[i] <- !is.na(ma[i]) & !is.na(ma[i + lead]) & (ma[i + lead] - ma[i] >= 0.10)
  cs <- c(0, cumsum(cond))   # cs[k+1] = sum cond[1..k]
  idx <- which(cond)
  on <- logical(n)
  for (j in idx) {
    lo <- max(1, j - back)
    prev <- if (j > lo) cs[j] - cs[lo] else 0   # cond in [j-back, j-1]
    if (prev == 0) on[j] <- TRUE
  }
  which(on)
}
onP <- onsets(sP); onL <- onsets(sL)
tP <- sP$g[onP]; tL <- sL$g[onL]
ma_at <- function(s, t) { i <- round((t - s$start) / s$step) + 1; ok <- abs((t - s$start) / s$step - round((t - s$start) / s$step)) < 1e-9 & i >= 1 & i <= s$n; out <- rep(NA_real_, length(t)); out[ok] <- s$MA[i[ok]]; out }
rows <- list()
for (i in seq_along(tP)) {
  cand <- tL[tL >= tP[i] & tL - tP[i] <= 96 * 60]
  tl <- if (length(cand)) cand[1] else NA_real_
  rows[[i]] <- data.frame(por_onset_utc = fmt_iso(tP[i]), lf_onset_utc = fmt_iso(tl), lag_h = (tl - tP[i]) / 60,
    por_ma_level_ft = ma_at(sP, tP[i]), lf_ma_level_ft = if (is.na(tl)) NA_real_ else ma_at(sL, tl),
    lf_ma_flow_cfs = if (is.na(tl)) NA_real_ else ma_at(sF, tl), stringsAsFactors = FALSE)
}
ONS <- do.call(rbind, rows)
wtab(ONS, "W3_onsets")
mt <- !is.na(ONS$lag_h)
M("W3", "", "n_por_onsets", nrow(ONS)); M("W3", "", "n_lf_onsets", length(tL)); M("W3", "", "n_matched", sum(mt))
M("W3", "", "median_lag_h", omedian(ONS$lag_h))
b3 <- mt & !is.na(ONS$lf_ma_flow_cfs) & ONS$lf_ma_flow_cfs < 3000
M("W3", "", "n_matched_below_3000", sum(b3)); M("W3", "", "median_lag_h_below_3000", omedian(ONS$lag_h[b3]))
M("W3", "", "n_matched_flow_ma_undefined", sum(mt & is.na(ONS$lf_ma_flow_cfs)))
M("W3", "", "lf_flow_step_min_W34", sF$step)

# ---- decision (mechanical)
h <- lm24("PoR-LF", "nov_all")
cm <- CRESTS$circmean_h[CRESTS$pair == "PoR-LF"]
hwd <- if (!is.na(cm) && abs(diff12(h - cm)) <= 2) h else "disagree"
n1 <- if (decisive == 1) (if (h < 12) size_k else size_k - 1) else NA
n4 <- if (sum(b3) >= 3) rhaz((omedian(ONS$lag_h[b3]) - h) / 24) else NA
ex1 <- !is.na(n1); ex4 <- !is.na(n4)
resolved <- (ex1 && ex4 && n1 == n4) || (xor(ex1, ex4))
whole <- if (resolved) (if (ex1) n1 else n4) else NA
total_delay_h <- if (resolved) 24 * whole + h else NA_real_
M("W3", "", "hours_within_day", hwd)
M("W3", "", "h", h); M("W3", "", "n1", n1); M("W3", "", "n4", n4)
M("W3", "", "whole_days_status", if (resolved) "resolved" else "unresolved")
M("W3", "", "whole_days", whole); M("W3", "", "total_delay_h", total_delay_h)
DECISION <- list(resolved = resolved, total_delay_h = total_delay_h)

# ---- the model's assumed times (S0 logged, used runs by phase)
rows <- list()
for (ph in c("NEW", "OLD", "TRANS")) {
  z <- RU[RU$phase == ph, ]
  rows[[length(rows) + 1]] <- data.frame(phase = ph, n = nrow(z), mean_trv_t = mean(z$trv_t), mean_trv_gf2lf = mean(z$trv_gf2lf),
    mean_total = mean(z$trv_t + z$trv_gf2lf), mean_hist_ago = mean(z$hist_ago), stringsAsFactors = FALSE)
}
wtab(do.call(rbind, rows), "W3_model_times")

# ---- damping
rows <- list()
dpf <- DAILY[[key("01638500", "00060")]]; dlf <- DAILY[[key("01646500", "00060")]]
dpl <- DAILY[[key("01638500", "00065")]]; dll <- DAILY[[key("01646500", "00065")]]; def <- DAILY[[key("01644148", "00065")]]
for (p in paste0("P", 4:7)) {
  r <- perd(p); D <- r[1]:r[2]
  ip <- match(D, dpf$day); il <- match(D, dlf$day); ipl <- match(D, dpl$day); ill <- match(D, dll$day); ie <- match(D, def$day)
  ok <- dpf$event_day[ip] == 0 & dlf$event_day[il] == 0 & !is.na(dlf$A_a_rel[il]) & !is.na(dpf$A_a_rel[ip]) & !is.na(dpl$A_a[ipl]) & !is.na(dll$A_a[ill])
  oke <- ok & def$event_day[ie] == 0 & !is.na(def$A_a[ie])
  mlf <- omedian(dlf$A_a_rel[il][ok]); mpo <- omedian(dpf$A_a_rel[ip][ok])
  rows[[length(rows) + 1]] <- data.frame(period = p, n_days = sum(ok), median_A_a_rel_lf_flow = mlf, median_A_a_rel_por_flow = mpo,
    ratio_lf_over_por = if (is.na(mlf) || is.na(mpo)) NA_real_ else mlf / mpo, median_A_a_por_level = omedian(dpl$A_a[ipl][ok]),
    median_A_a_ef_level = omedian(def$A_a[ie][oke]), median_A_a_lf_level = omedian(dll$A_a[ill][ok]), stringsAsFactors = FALSE)
}
wtab(do.call(rbind, rows), "W3_damping")
write_metrics()
cat("W3 done\n")

# q_W12.R : series preparation, W1 and W2 (sourced by run_all.R after lib.R)
cat("== reading tables\n")
mod <- read_readings("readings_current_model.csv")
ups <- read_readings("readings_current_upstream.csv")
cen <- read_readings("readings_current_census.csv")
cat("rows: model", nrow(mod), "upstream", nrow(ups), "census", nrow(cen), "\n")

GAUGE_NAME <- c("01638500" = "PoR", "01644148" = "EF", "01646500" = "LF", "01643000" = "Monocacy",
                "01618000" = "Shepherdstown", "01613000" = "Hancock", "01610000" = "PawPaw",
                "01636500" = "Millville", "01619500" = "Antietam", "01614500" = "Conococheague",
                "01616500" = "Opequon", "01637500" = "Catoctin")
UP_G <- c("01618000", "01613000", "01610000", "01636500", "01619500", "01614500", "01616500", "01637500")

SER <- list(); PREP_LOG <- list()
build <- function(src, gauge, param, start = START_W, end = CUTOFF, maxgap = 30, tag = "W") {
  r <- series_readings(src, gauge, param)
  s <- prepare_series(r$rt, r$rv, start, end, maxgap)
  s$n_dup <- r$n_dup
  s$n_raw <- length(r$rt)
  PREP_LOG[[length(PREP_LOG) + 1]] <<- data.frame(
    gauge = gauge, parameter = param, window = tag, window_start_utc = fmt_iso(start), window_end_utc = fmt_iso(end),
    step_min = s$step, n_grid = s$n, n_present = s$n_present, n_filled = s$n_filled, n_missing = s$n_missing,
    n_raw_readings_le_cutoff = length(r$rt), n_duplicate_times_dropped = r$n_dup, stringsAsFactors = FALSE)
  s
}
key <- function(g, p) paste(g, p, sep = "|")
cat("== preparing series (Part W window)\n")
SER[[key("01638500", "00060")]] <- build(cen, "01638500", "00060")
SER[[key("01646500", "00060")]] <- build(cen, "01646500", "00060")
for (gp in list(c("01638500", "00065"), c("01644148", "00065"), c("01646500", "00065"), c("01638500", "00010")))
  SER[[key(gp[1], gp[2])]] <- build(mod, gp[1], gp[2])
for (g in UP_G) for (p in c("00060", "00065")) SER[[key(g, p)]] <- build(ups, g, p)
# monocacy flow is not needed by the spec for Part W

# ---- event-day flags per gauge (flow series), all days of the window
DAYS_W <- floor(START_W / 1440):floor(CUTOFF / 1440)
FLAG <- list()
for (g in c("01638500", "01646500", UP_G)) FLAG[[g]] <- event_flags(SER[[key(g, "00060")]], DAYS_W, "rel")
FLAG[["01644148"]] <- event_flags(SER[[key("01644148", "00065")]], DAYS_W, "abs")

# ---- daily tables
DAILY <- list()
for (k in names(SER)) {
  gp <- strsplit(k, "\\|")[[1]]
  if (gp[2] == "00010") next
  DAILY[[k]] <- daily_table(SER[[k]], gp[1], gp[2], FLAG[[gp[1]]], gp[2] == "00060")
}
DAILY[[key("01638500", "00010")]] <- daily_table(SER[[key("01638500", "00010")]], "01638500", "00010", FLAG[["01638500"]], FALSE)

W1_KEYS <- c(key("01638500", "00060"), key("01638500", "00065"), key("01644148", "00065"),
             key("01646500", "00060"), key("01646500", "00065"))
W2_KEYS <- as.vector(t(outer(UP_G, c("00060", "00065"), key)))
srt <- function(keys) { gp <- do.call(rbind, strsplit(keys, "\\|")); keys[order(gp[, 1], gp[, 2], method = "radix")] }
W1_KEYS <- srt(W1_KEYS); W2_KEYS <- srt(W2_KEYS)

DAILY_COLS <- c("gauge", "parameter", "day_utc", "step_min", "n_present", "day_mean", "A_a", "A_a_rel", "A_b",
                "phi_b_utc_h", "crest_utc_h", "crest_local_h", "trough_utc_h", "trough_local_h", "event_day", "weekday_utc")
out_daily <- function(keys, name) {
  df <- do.call(rbind, DAILY[keys])
  df <- df[order(df$gauge, df$parameter, df$day, method = "radix"), ]
  wtab(df, name, DAILY_COLS)
}
out_daily(W1_KEYS, "W1_daily")
out_daily(W2_KEYS, "W2_daily")

# ---- periods
PER <- list(P1 = c("2026-09-01", "2026-09-14"), P2 = c("2026-09-15", "2026-10-11"), P3 = c("2026-10-12", "2026-10-21"),
            P4 = c("2026-10-22", "2026-10-31"), P5 = c("2026-11-01", "2026-11-09"), P6 = c("2026-11-10", "2026-11-13"),
            P7 = c("2026-11-14", "2026-11-22"), P5toP7 = c("2026-11-01", "2026-11-22"))
perd <- function(p) c(dnum(PER[[p]][1]), dnum(PER[[p]][2]))
nonevent_days <- function(dd, lo, hi) dd[dd$day >= lo & dd$day <= hi & dd$event_day == 0 & !is.na(dd$A_a), ]
PERIOD_COLS <- c("gauge", "parameter", "period", "n_days", "n_non_event", "median_A_a", "median_A_a_rel", "median_A_b",
                 "crest_utc_h_circmean", "crest_local_h_circmean", "trough_utc_h_circmean", "trough_local_h_circmean")
out_periods <- function(keys, name) {
  rows <- list()
  for (k in keys) {
    dd <- DAILY[[k]]
    for (p in paste0("P", 1:7)) {
      r <- perd(p); ne <- nonevent_days(dd, r[1], r[2])
      rows[[length(rows) + 1]] <- data.frame(
        gauge = dd$gauge[1], parameter = dd$parameter[1], period = p, n_days = r[2] - r[1] + 1, n_non_event = nrow(ne),
        median_A_a = omedian(ne$A_a), median_A_a_rel = omedian(ne$A_a_rel), median_A_b = omedian(ne$A_b),
        crest_utc_h_circmean = circ_mean(ne$crest_utc_h), crest_local_h_circmean = circ_mean(ne$crest_local_h),
        trough_utc_h_circmean = circ_mean(ne$trough_utc_h), trough_local_h_circmean = circ_mean(ne$trough_local_h),
        stringsAsFactors = FALSE)
    }
  }
  df <- do.call(rbind, rows)
  df <- df[order(df$gauge, df$parameter, df$period, method = "radix"), ]
  wtab(df, name, PERIOD_COLS)
}
out_periods(W1_KEYS, "W1_periods")
out_periods(W2_KEYS, "W2_periods")

# ---- weekday tables
rows <- list()
for (k in W1_KEYS) {
  dd <- DAILY[[k]]
  for (w in c("P2", "P5toP7")) {
    r <- perd(w); ne <- nonevent_days(dd, r[1], r[2])
    for (wd in 0:6) {
      x <- ne$A_a[ne$weekday_utc == wd]
      rows[[length(rows) + 1]] <- data.frame(gauge = dd$gauge[1], parameter = dd$parameter[1], window = w,
                                              weekday_utc = wd, n_days = length(x), median_A_a = omedian(x), stringsAsFactors = FALSE)
    }
  }
}
df <- do.call(rbind, rows); df <- df[order(df$gauge, df$parameter, df$window, df$weekday_utc, method = "radix"), ]
wtab(df, "W1_weekday")

# ---- W1 metrics
lfr <- cen[cen$gauge == "01646500" & cen$parameter == "00060" & !is.na(cen$v) & cen$tm >= tmin("2026-11-10T00:00:00Z") & cen$tm <= CUTOFF, ]
dv <- sort(unique(lfr$v))
step_cfs <- median(diff(dv))
M("W1", "", "lf_flow_step_cfs", step_cfs)
M("W1", "", "lf_flow_n_distinct_values_10_22_nov", length(dv))
M("W1", "", "lf_flow_n_raw_readings_10_22_nov", nrow(lfr))
ne <- nonevent_days(DAILY[[key("01646500", "00060")]], dnum("2026-11-10"), dnum("2026-11-22"))
M("W1", "", "lf_median_A_a_cfs_10_22_nov", omedian(ne$A_a))
M("W1", "", "lf_n_non_event_days_10_22_nov", nrow(ne))
M("W1", "", "lf_median_A_a_in_steps", omedian(ne$A_a) / step_cfs)

# ---- W2 weekend
rows <- list()
for (k in c(W1_KEYS, W2_KEYS)) {
  dd <- DAILY[[k]]
  for (w in c("P2", "P5toP7")) {
    r <- perd(w); ne <- nonevent_days(dd, r[1], r[2])
    wk <- ne$A_a[!(ne$weekday_utc %in% c(5, 6))]; we <- ne$A_a[ne$weekday_utc %in% c(5, 6)]
    mw <- omedian(wk); me <- omedian(we)
    rows[[length(rows) + 1]] <- data.frame(gauge = dd$gauge[1], parameter = dd$parameter[1], window = w,
      median_A_a_weekdays = mw, median_A_a_weekend = me, n_weekdays = length(wk), n_weekend = length(we),
      ratio = if (is.na(mw) || is.na(me) || mw == 0) NA_real_ else me / mw, stringsAsFactors = FALSE)
  }
}
df <- do.call(rbind, rows); df <- df[order(df$gauge, df$parameter, df$window, method = "radix"), ]
wtab(df, "W2_weekend")

# ---- W2 clock test
cw <- function(a, b) c(dnum(a), dnum(b))
BEF <- cw("2026-10-22", "2026-10-31"); AFT <- cw("2026-11-02", "2026-11-11")
clock_keys <- srt(c(key("01638500", "00065"), key("01644148", "00065"), key("01646500", "00065"),
                    as.vector(outer(UP_G, "00065", key)), key("01646500", "00060"), key("01638500", "00060")))
wmean_circ <- function(h, w) {
  mod24(atan2(sum(w * sin(2 * pi * h / 24)) / sum(w), sum(w * cos(2 * pi * h / 24)) / sum(w)) * 24 / (2 * pi))
}
rows <- list()
for (k in clock_keys) {
  dd <- DAILY[[k]]
  b <- nonevent_days(dd, BEF[1], BEF[2]); a <- nonevent_days(dd, AFT[1], AFT[2])
  b <- b[!is.na(b$crest_utc_h), ]; a <- a[!is.na(a$crest_utc_h), ]
  nb <- nrow(b); na_ <- nrow(a)
  cb <- circ_mean(b$crest_utc_h); ca <- circ_mean(a$crest_utc_h)
  tb <- circ_mean(b$trough_utc_h); ta <- circ_mean(a$trough_utc_h)
  sc <- diff12(ca - cb); st <- diff12(ta - tb)
  lo <- hi <- lo_t <- hi_t <- NA_real_
  if (nb >= 1 && na_ >= 1) {
    # group 1 = after (minuend), group 2 = before
    stat <- function(w1, w2) c(diff12(wmean_circ(a$crest_utc_h, w1) - wmean_circ(b$crest_utc_h, w2)),
                               diff12(wmean_circ(a$trough_utc_h, w1) - wmean_circ(b$trough_utc_h, w2)))
    bm <- boot_matrix(na_, stat, nb)
    ci1 <- boot_ci(bm[, 1]); ci2 <- boot_ci(bm[, 2])
    lo <- ci1[1]; hi <- ci1[2]; lo_t <- ci2[1]; hi_t <- ci2[2]
    note_skips("W2_clock", k, "shift_crest", ci1[3]); note_skips("W2_clock", k, "shift_trough", ci2[3])
  }
  lab <- function(l, h) {
    if (is.na(l) || is.na(h) || nb < 4 || na_ < 4) return("undetermined")
    if (l >= 0.5 && h <= 1.5) "follows the clock" else if (l >= -0.5 && h <= 0.5) "does not" else "undetermined"
  }
  rows[[length(rows) + 1]] <- data.frame(gauge = dd$gauge[1], parameter = dd$parameter[1], n_before = nb, n_after = na_,
    crest_before = cb, crest_after = ca, shift_crest = sc, lo = lo, hi = hi, label_crest = lab(lo, hi),
    trough_before = tb, trough_after = ta, shift_trough = st, lo_t = lo_t, hi_t = hi_t, label_trough = lab(lo_t, hi_t),
    stringsAsFactors = FALSE)
}
df <- do.call(rbind, rows); df <- df[order(df$gauge, df$parameter, method = "radix"), ]
wtab(df, "W2_clock")

# ---- master 5-minute grid helpers for lagged correlations
MASTER_G <- START_W + 5 * (0:(floor((CUTOFF - START_W) / 5)))
MASTER_DAY <- floor(MASTER_G / 1440)
master_d <- function(k, interp15 = FALSE) {
  s <- SER[[k]]
  stopifnot(s$start == START_W)
  v <- rep(NA_real_, length(MASTER_G))
  v[round((s$g - START_W) / 5) + 1] <- s$d
  if (interp15) v <- interp15_to5(v)
  v
}
ok_mask <- function(gauge, lo, hi) {
  fl <- FLAG[[gauge]][match(MASTER_DAY, DAYS_W)]
  fl == 0 & MASTER_DAY >= lo & MASTER_DAY <= hi
}

# ---- instrument test at Point of Rocks
P57 <- perd("P5toP7")
kl <- key("01638500", "00065"); kt <- key("01638500", "00010")
stopifnot(SER[[kl]]$step == 5, SER[[kt]]$step == 5)
lags <- seq(-720, 720, by = 15)
res <- lagcorr(master_d(kl), master_d(kt), ok_mask("01638500", P57[1], P57[2]), ok_mask("01638500", P57[1], P57[2]), lags, 5)
j0 <- which(lags == 0)
ord <- order(abs(lags), lags < 0)
jm <- ord[which.max(round9(abs(res$r[ord])))]
M("W2", "", "r_lag0", res$r[j0])
M("W2", "", "lag_of_max_abs_r_h", lags[jm] / 60)
M("W2", "", "max_abs_r", abs(res$r[jm]))
M("W2", "", "r_at_max_abs_lag", res$r[jm])
M("W2", "", "n_points_lag0", res$n[j0])
for (p in c("P5", "P6", "P7")) {
  r <- perd(p); ne <- nonevent_days(DAILY[[kt]], r[1], r[2])
  M("W2", p, "median_A_a_temp_degC", omedian(ne$A_a))
  M("W2", p, "n_non_event_days_temp", nrow(ne))
}

# ---- passage upstream to PoR (level -> PoR level)
rows <- list(); rowsm <- list()
lags <- seq(0, 72 * 60, by = 15)
for (g in UP_G) {
  kx <- key(g, "00065"); ky <- key("01638500", "00065")
  es <- if (SER[[kx]]$step == 5 && SER[[ky]]$step == 5) 5 else 15
  res <- lagcorr(master_d(kx), master_d(ky), ok_mask(g, P57[1], P57[2]), ok_mask("01638500", P57[1], P57[2]), lags, es)
  mx <- max_lag(res)
  rows[[length(rows) + 1]] <- data.frame(gauge = g, lag_h_of_max_r = mx$lag_min / 60, max_r = mx$r,
                                         lag_h_mod_24 = mod24(mx$lag_min / 60), n_points = mx$n, stringsAsFactors = FALSE)
  lm_ <- local_maxima(res, 15, 0.3)
  if (nrow(lm_) > 0) rowsm[[length(rowsm) + 1]] <- data.frame(gauge = g, lag_h = lm_$lag_min / 60, r = lm_$r, stringsAsFactors = FALSE)
}
df <- do.call(rbind, rows); df <- df[order(df$gauge, method = "radix"), ]; wtab(df, "W2_xcorr_upstream")
df <- if (length(rowsm)) do.call(rbind, rowsm) else data.frame(gauge = character(), lag_h = numeric(), r = numeric())
df <- df[order(df$gauge, df$lag_h, method = "radix"), ]; wtab(df, "W2_xcorr_upstream_maxima")

write_metrics()
cat("W1/W2 done\n")

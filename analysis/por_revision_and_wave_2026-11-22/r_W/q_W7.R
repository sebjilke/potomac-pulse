# q_W7.R : recurring pattern 2011 to 2026 (sourced after lib.R; independent of the other scripts)
cat("== W7 (a)\n")
f7 <- "../rising-limb-travel-backtest/hourly_backtest_data_v39.csv"
h7 <- read.csv(f7, colClasses = c("character", "numeric", "NULL", "NULL", "numeric", rep("NULL", 7)), na.strings = "", stringsAsFactors = FALSE)
h7$tm <- tmin_space(h7$timestamp)
stopifnot(!anyNA(h7$tm), !is.unsorted(h7$tm), !anyDuplicated(h7$tm))
h7 <- h7[h7$tm <= CUTOFF, ]
W7_START <- min(h7$tm); W7_END <- max(h7$tm)
M("W7", "", "file_rows", nrow(h7)); M("W7", "", "window_start_utc", fmt_iso(W7_START)); M("W7", "", "window_end_utc", fmt_iso(W7_END))
prep7 <- function(col, gname) {
  ok <- !is.na(h7[[col]])
  s <- prepare_series(h7$tm[ok], h7[[col]][ok], W7_START, W7_END, maxgap = 120)
  PREP_LOG[[length(PREP_LOG) + 1]] <<- data.frame(gauge = gname, parameter = col, window = "W7", window_start_utc = fmt_iso(W7_START),
    window_end_utc = fmt_iso(W7_END), step_min = s$step, n_grid = s$n, n_present = s$n_present, n_filled = s$n_filled, n_missing = s$n_missing,
    n_raw_readings_le_cutoff = sum(ok), n_duplicate_times_dropped = 0, stringsAsFactors = FALSE)
  days <- floor(W7_START / 1440):floor(W7_END / 1440)
  fl <- event_flags(s, days, "rel")
  daily_table(s, gname, col, fl, TRUE)
}
dP <- prep7("por_now", "por_now"); dL <- prep7("lf_discharge", "lf_discharge")
stopifnot(identical(dP$day, dL$day))
dP$year <- as.integer(substr(dP$day_utc, 1, 4)); dP$month <- as.integer(substr(dP$day_utc, 6, 7))
wave <- function(dd) dd$event_day == 0 & !is.na(dd$A_a_rel) & dd$A_a_rel >= 0.03
rows <- list()
for (ym in unique(paste(dP$year, dP$month))) {
  i <- which(paste(dP$year, dP$month) == ym)
  nep <- dP$event_day[i] == 0; nel <- dL$event_day[i] == 0
  rows[[length(rows) + 1]] <- data.frame(year = dP$year[i[1]], month = dP$month[i[1]], n_days = length(i),
    n_non_event_por = sum(nep), n_wave_por = sum(wave(dP[i, ])), n_non_event_lf = sum(nel), n_wave_lf = sum(wave(dL[i, ])),
    median_A_a_rel_por = omedian(dP$A_a_rel[i][nep]), median_A_a_rel_lf = omedian(dL$A_a_rel[i][nel]), stringsAsFactors = FALSE)
}
df <- do.call(rbind, rows); df <- df[order(df$year, df$month), ]
wtab(df, "W7_year_month")
M("W7", "", "n_days_total", nrow(dP))
M("W7", "por", "n_non_event_days", sum(dP$event_day == 0)); M("W7", "por", "n_wave_days", sum(wave(dP)))
M("W7", "lf", "n_non_event_days", sum(dL$event_day == 0)); M("W7", "lf", "n_wave_days", sum(wave(dL)))

brk <- c(0, 2000, 3000, 6000, Inf)
cl <- findInterval(dL$day_mean, brk, left.open = FALSE)   # [lo, hi) classes; NA day_mean -> excluded
rows <- list()
for (k in 1:4) {
  i <- which(!is.na(dL$day_mean) & dL$day_mean >= brk[k] & dL$day_mean < brk[k + 1])
  nep <- dP$event_day[i] == 0
  rows[[k]] <- data.frame(class_lo = brk[k], n_days = length(i), n_non_event_por = sum(nep), n_wave_por = sum(wave(dP[i, ])),
    share_wave_por = if (sum(nep) > 0) sum(wave(dP[i, ])) / sum(nep) else NA_real_,
    n_non_event_lf = sum(dL$event_day[i] == 0), n_wave_lf = sum(wave(dL[i, ])), stringsAsFactors = FALSE)
}
wtab(do.call(rbind, rows), "W7_flow_class")
M("W7", "", "n_days_without_lf_day_mean", sum(is.na(dL$day_mean)))

cat("== W7 (b)\n")
f <- "../replay_lag_2026-11-17/shadow_F.csv"
hd <- strsplit(readLines(f, n = 1), ",")[[1]]
need <- c("predTs", "status", "truthDependentHard", "truthInProdRange", "errPctRaw", "errPctCorr", "truthFlow")
sf <- read.csv(f, colClasses = ifelse(hd %in% need, "character", "NULL"), na.strings = "", stringsAsFactors = FALSE)
M("W7", "", "shadow_rows_total", nrow(sf))
sf$tm <- tmin(sf$predTs)
k1 <- sf$status == "predicted" & !is.na(sf$status)
k2 <- k1 & sf$truthDependentHard == "0" & !is.na(sf$truthDependentHard)
k3 <- k2 & sf$truthInProdRange == "1" & !is.na(sf$truthInProdRange)
k4 <- k3 & !is.na(sf$errPctRaw) & !is.na(sf$errPctCorr)
k5 <- k4 & sf$tm >= tmin("2011-12-04T05:00:00.000Z")
M("W7", "", "shadow_rows_predicted", sum(k1)); M("W7", "", "shadow_rows_after_truthDependentHard0", sum(k2))
M("W7", "", "shadow_rows_after_truthInProdRange1", sum(k3)); M("W7", "", "shadow_rows_after_nonblank_errors", sum(k4))
M("W7", "", "shadow_rows_after_predTs_filter", sum(k5))
z <- sf[k5, ]
z$day <- floor(z$tm / 1440)
z$truthFlow <- as.numeric(z$truthFlow); z$er <- as.numeric(z$errPctRaw); z$ec <- as.numeric(z$errPctCorr)
ip <- match(z$day, dP$day)
M("W7", "", "shadow_rows_day_not_in_a", sum(is.na(ip)))
keep <- !is.na(ip) & dP$event_day[ip] == 0 & !is.na(dP$A_a_rel[ip]) & !is.na(z$truthFlow) & z$truthFlow < 3000
M("W7", "", "shadow_rows_kept", sum(keep))
z <- z[keep, ]; z$rel <- dP$A_a_rel[match(z$day, dP$day)]
brk <- c(0, 0.01, 0.03, 0.06, Inf)
rows <- list()
for (k in 1:4) {
  i <- z$rel >= brk[k] & z$rel < brk[k + 1]
  rows[[k]] <- data.frame(class_lo = brk[k], n_rows = sum(i), n_days = length(unique(z$day[i])),
    mean_abs_errPctRaw = if (any(i)) mean(abs(z$er[i])) else NA_real_, mean_abs_errPctCorr = if (any(i)) mean(abs(z$ec[i])) else NA_real_,
    median_abs_errPctCorr = if (any(i)) median(abs(z$ec[i])) else NA_real_, stringsAsFactors = FALSE)
}
wtab(do.call(rbind, rows), "W7_error_by_wave")
write_metrics()
cat("W7 done\n")

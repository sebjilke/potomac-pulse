#!/usr/bin/env Rscript
# LF-residual advisory backtest — blind R replication from spec.
# Inputs (read-only): v38_residuals_single.csv, hourly_backtest_data_v38.csv
# Output: lf_residual_advisory_backtest_R.csv

options(stringsAsFactors = FALSE)

DIR <- "/Users/sebjilke/Desktop/PotomacPulse/analysis"

## ---------- 1. Load pairs ----------
res <- read.csv(file.path(DIR, "v38_residuals_single.csv"),
                colClasses = "character")
res <- res[, c("predTs", "valTs", "actualLF", "disp_c0")]
res$actualLF <- as.numeric(res$actualLF)
res$disp_c0  <- as.numeric(res$disp_c0)

n_raw <- nrow(res)

predSec <- as.numeric(as.POSIXct(res$predTs, tz = "UTC",
                                 format = "%Y-%m-%dT%H:%M:%OSZ"))
valSec  <- as.numeric(as.POSIXct(res$valTs, tz = "UTC",
                                 format = "%Y-%m-%d %H:%M"))
res$predSec <- predSec
res$valSec  <- valSec

bad_parse <- is.na(res$predSec) | is.na(res$valSec)
bad_num   <- is.na(res$actualLF) | is.na(res$disp_c0)
bad_lf    <- !bad_num & res$actualLF <= 0
res <- res[!bad_parse & !bad_num & !bad_lf, ]

res$err      <- (res$disp_c0 - res$actualLF) / res$actualLF   # fraction
res$predHour <- floor(res$predSec / 3600)
res$valHour  <- floor(res$valSec  / 3600)

# Sort by valTs then predTs ascending
res <- res[order(res$valSec, res$predSec), ]
row.names(res) <- NULL
n_pairs <- nrow(res)

## ---------- 2. Load hourly grid ----------
hb <- read.csv(file.path(DIR, "hourly_backtest_data_v38.csv"),
               colClasses = "character")
hb <- hb[, c("timestamp", "lf_discharge")]
hb$lf_discharge <- suppressWarnings(as.numeric(hb$lf_discharge))
hb <- hb[!is.na(hb$lf_discharge), ]           # non-empty lf_discharge only

gridSec <- as.numeric(as.POSIXct(hb$timestamp, tz = "UTC",
                                 format = "%Y-%m-%d %H:%M"))
stopifnot(!any(is.na(gridSec)))
grid <- data.frame(hour = floor(gridSec / 3600), lf = hb$lf_discharge)
grid <- grid[order(grid$hour), ]
row.names(grid) <- NULL
n_grid <- nrow(grid)

## ---------- 3. Date / month helpers (UTC) ----------
hourDate  <- function(h) as.Date(floor(h / 24), origin = "1970-01-01")
hourMonth <- function(h) as.integer(format(hourDate(h), "%m"))

grid$date  <- hourDate(grid$hour)
grid$month <- hourMonth(grid$hour)

res$predDate <- hourDate(res$predHour)
res$valDate  <- hourDate(res$valHour)

## ---------- 4. Event windows ----------
windows <- list(
  W1 = c("2012-07-08", "2012-07-12"),
  W2 = c("2014-08-10", "2014-08-14"),
  W3 = c("2019-07-22", "2019-07-26"),
  W4 = c("2019-10-15", "2019-10-23"),
  W5 = c("2022-07-07", "2022-07-11"),
  W6 = c("2022-08-03", "2022-08-08"),
  W7 = c("2026-07-09", "2026-07-12"),
  W8 = c("2026-07-17", "2026-07-20")
)
windows <- lapply(windows, function(w) as.Date(w))

inAnyWindow <- function(d) {
  out <- rep(FALSE, length(d))
  for (w in windows) out <- out | (d >= w[1] & d <= w[2])
  out
}

grid$inWin <- inAnyWindow(grid$date)
res$pairInWin <- inAnyWindow(res$predDate) | inAnyWindow(res$valDate)

## ---------- 5. Rules ----------
rules <- list(
  list(name = "R1_on10_off5",   on = -0.10, off = -0.05,  consec = 1L),
  list(name = "R2_on15_off7.5", on = -0.15, off = -0.075, consec = 1L),
  list(name = "R3_2x8_off4",    on = -0.08, off = -0.04,  consec = 2L),
  list(name = "R4_on25_off10",  on = -0.25, off = -0.10,  consec = 1L)
)

STALE_H <- 12L

## ---------- 6. Per-pair state scan ----------
# Pairs are consumed in global sort order regardless of grid-hour boundaries,
# so the latch state after each pair can be precomputed once per rule; grid
# hours then sample the state of the last pair with valHour <= h.
runRule <- function(on_thr, off_thr, consec) {
  n <- nrow(res)
  latchAfter <- logical(n)
  counter <- 0L
  latch <- FALSE
  err <- res$err
  for (i in seq_len(n)) {
    e <- err[i]
    if (e <= on_thr) {
      counter <- counter + 1L
      if (counter >= consec) latch <- TRUE
    } else if (e > off_thr) {
      counter <- 0L
      latch <- FALSE
    }
    latchAfter[i] <- latch
  }

  # Effective state at each grid hour
  idx <- findInterval(grid$hour, res$valHour)      # last pair with valHour <= h
  eff <- idx > 0L
  eff[eff] <- latchAfter[idx[eff]] &
              (grid$hour[eff] - res$valHour[idx[eff]]) <= STALE_H

  # Effective state at each pair's predTs hour (only if predHour in grid)
  gpos <- match(res$predHour, grid$hour)
  pairEff <- rep(NA, nrow(res))                    # NA = predHour not in grid
  pairEff[!is.na(gpos)] <- eff[gpos[!is.na(gpos)]]

  list(eff = eff, pairEff = pairEff)
}

pct <- function(x) 100 * mean(x)

evalRule <- function(rule) {
  st <- runRule(rule$on, rule$off, rule$consec)
  eff <- st$eff
  pairEff <- st$pairEff

  out <- list(rule = rule$name)

  # a. duty
  out$duty_pct <- pct(eff)

  # b. JJA & lf_discharge < 3000
  sel <- grid$month %in% c(6L, 7L, 8L) & grid$lf < 3000
  out$jja_0_3k_duty_pct <- if (any(sel)) pct(eff[sel]) else NA_real_

  # c. windows
  for (wn in names(windows)) {
    w <- windows[[wn]]
    inw <- grid$date >= w[1] & grid$date <= w[2]
    if (!any(inw)) {
      out[[paste0(wn, "_cov_pct")]] <- NA_real_
      out[[paste0(wn, "_lag_h")]]   <- NA_real_
      next
    }
    out[[paste0(wn, "_cov_pct")]] <- pct(eff[inw])
    onh <- grid$hour[inw & eff]
    out[[paste0(wn, "_lag_h")]] <-
      if (length(onh)) min(onh) - min(grid$hour[inw]) else NA_real_
  }

  # d. conditional stats on NON-window pairs (predHour must be in grid)
  usable <- !is.na(pairEff) & !res$pairInWin
  for (state in c("ON", "OFF")) {
    s <- usable & (if (state == "ON") pairEff == TRUE else pairEff == FALSE)
    e <- res$err[s]
    p <- tolower(state)
    out[[paste0("cond_", p, "_n")]]              <- sum(s)
    out[[paste0("cond_", p, "_median_abs_err_pct")]] <-
      if (length(e)) 100 * median(abs(e)) else NA_real_
    out[[paste0("cond_", p, "_pct_le_m25")]] <-
      if (length(e)) pct(e <= -0.25) else NA_real_
    out[[paste0("cond_", p, "_mean_err_pct")]] <-
      if (length(e)) 100 * mean(e) else NA_real_
  }

  # e. harm coverage over ALL pairs whose predHour is in grid (windows included)
  ing <- !is.na(pairEff)
  for (thr in c(-0.15, -0.25)) {
    h <- ing & res$err <= thr
    nm <- paste0("harm_cov_le_m", sprintf("%g", abs(thr) * 100), "_pct")
    out[[nm]] <- if (any(h)) pct(pairEff[h] == TRUE) else NA_real_
  }

  # f. truthfulness: of all pairs ON at predHour, % with err <= -0.10
  onp <- ing & pairEff == TRUE
  out$truthfulness_pct <- if (any(onp)) pct(res$err[onp] <= -0.10) else NA_real_

  out
}

rows <- lapply(rules, evalRule)
resTab <- do.call(rbind, lapply(rows, function(r) as.data.frame(r, check.names = FALSE)))

num <- vapply(resTab, is.numeric, logical(1))
resTab[num] <- lapply(resTab[num], function(x) round(x, 4))

outFile <- file.path(DIR, "lf_residual_advisory_backtest_R.csv")
write.csv(resTab, outFile, row.names = FALSE, na = "")

## ---------- 7. Readable summary ----------
cat("LF-residual advisory backtest (R replication)\n")
cat(sprintf("Pairs: raw=%d, dropped(parse=%d, missing=%d, actualLF<=0=%d) -> used=%d\n",
            n_raw, sum(bad_parse), sum(bad_num & !bad_parse),
            sum(bad_lf & !bad_parse), n_pairs))
cat(sprintf("Grid hours (lf_discharge non-empty): %d\n\n", n_grid))

for (i in seq_len(nrow(resTab))) {
  r <- resTab[i, ]
  cat(sprintf("== %s ==\n", r$rule))
  cat(sprintf("  duty %.2f%% | JJA<3k duty %.2f%%\n", r$duty_pct, r$jja_0_3k_duty_pct))
  for (wn in names(windows)) {
    cov <- r[[paste0(wn, "_cov_pct")]]
    lag <- r[[paste0(wn, "_lag_h")]]
    cat(sprintf("  %s cov %6.2f%%  lag %s h\n", wn, cov,
                if (is.na(lag)) "--" else sprintf("%g", lag)))
  }
  cat(sprintf("  ON : n=%d  med|err|=%.2f%%  %%<=-25=%.2f%%  mean=%.2f%%\n",
              r$cond_on_n, r$cond_on_median_abs_err_pct,
              r$cond_on_pct_le_m25, r$cond_on_mean_err_pct))
  cat(sprintf("  OFF: n=%d  med|err|=%.2f%%  %%<=-25=%.2f%%  mean=%.2f%%\n",
              r$cond_off_n, r$cond_off_median_abs_err_pct,
              r$cond_off_pct_le_m25, r$cond_off_mean_err_pct))
  cat(sprintf("  harm cov: <=-15%%: %.2f%%  <=-25%%: %.2f%% | truthfulness %.2f%%\n\n",
              r$harm_cov_le_m15_pct, r$harm_cov_le_m25_pct, r$truthfulness_pct))
}
cat(sprintf("Wrote %s\n", outFile))

#!/usr/bin/env Rscript
# Independent R verification of comprehensive backtest results.
# Verifies BOTH daily AND hourly backtests against Python output.
#
# Grid: 5 decay caps x 5 ceiling ratios = 25 configurations
# Uses v27.0 gradient EF weight function.

library(stats)

SCRIPT_DIR <- tryCatch({
  dirname(normalizePath(sys.frame(1)$ofile, mustWork = FALSE))
}, error = function(e) {
  # When run via Rscript, use commandArgs to find script path
  args <- commandArgs(trailingOnly = FALSE)
  file_arg <- grep("^--file=", args, value = TRUE)
  if (length(file_arg) > 0) {
    dirname(normalizePath(sub("^--file=", "", file_arg[1])))
  } else {
    "/Users/sebjilke/Desktop/PotomacPulse/analysis"
  }
})

DAILY_PATH  <- file.path(SCRIPT_DIR, "ef_lf_daily_longterm.csv")
HOURLY_PATH <- file.path(SCRIPT_DIR, "hourly_backtest_data.csv")

# Python results for comparison
PY_DAILY_PATH  <- file.path(SCRIPT_DIR, "backtest_comprehensive_daily.csv")
PY_HOURLY_PATH <- file.path(SCRIPT_DIR, "backtest_comprehensive_hourly.csv")

OUT_DAILY  <- file.path(SCRIPT_DIR, "backtest_comprehensive_daily_R.csv")
OUT_HOURLY <- file.path(SCRIPT_DIR, "backtest_comprehensive_hourly_R.csv")

# ── Constants ──────────────────────────────────────────────────────────────────
EF_COEFF <- 126.0
EF_EXP   <- 2.46
EF_COEFF_COLD <- 160.0
EF_EXP_COLD   <- 2.36
COLD_THRESH_C  <- 10.0
STALENESS_HOURS <- 20
TRAVEL_TIME_H   <- 20

DECAY_CAPS     <- c(0.30, 0.40, 0.50, 0.60, 0.75)
CEILING_RATIOS <- c(NA, 1.05, 1.10, 1.15, 1.20)

# v27.0 gradient anchors
ANCHOR_FLOW <- c(0, 3000, 6000, 10000, 15000, 25000, 50000)
ANCHOR_WT   <- c(0.0, 0.0, 0.1, 0.4, 0.4, 0.4, 0.4)

# ── Helper functions ──────────────────────────────────────────────────────────

get_ef_weight <- function(flow) {
  if (flow <= 0) return(0.0)
  if (flow >= 50000) return(0.4)
  for (i in 2:length(ANCHOR_FLOW)) {
    if (flow <= ANCHOR_FLOW[i]) {
      f0 <- ANCHOR_FLOW[i - 1]; w0 <- ANCHOR_WT[i - 1]
      f1 <- ANCHOR_FLOW[i];     w1 <- ANCHOR_WT[i]
      return(w0 + (w1 - w0) * (flow - f0) / (f1 - f0))
    }
  }
  return(0.4)
}

ef_estimate <- function(stage, temp_c = NA) {
  if (!is.na(temp_c) && temp_c <= COLD_THRESH_C) {
    return(EF_COEFF_COLD * stage^EF_EXP_COLD)
  }
  EF_COEFF * stage^EF_EXP
}

estimate_gf <- function(por_old, por_new, ef_stg, lf_actual,
                         dcap, cratio, stale_h, travel_h, temp_c = NA) {
  ef_est <- ef_estimate(ef_stg, temp_c)
  base <- por_old

  # PoR-delta correction
  if (por_old > 0) {
    ratio <- por_new / por_old
    change_pct <- (ratio - 1.0) * 100.0
    if (abs(change_pct) > 5.0) {
      frac <- min(1.0, stale_h / max(1, travel_h))
      decay <- min(dcap, sqrt(frac))
      applied <- 1.0 + (ratio - 1.0) * decay
      base <- por_old * applied
    }
  }

  # EF blend
  w <- get_ef_weight(base)
  est <- (1.0 - w) * base + w * ef_est

  # Soft ceiling
  if (!is.na(cratio) && lf_actual > 0 && est > lf_actual * cratio) {
    est <- lf_actual * cratio
  }

  est
}

classify_regime <- function(current, previous) {
  if (current > previous * 1.05) return("rising")
  if (current < previous * 0.95) return("falling")
  "steady"
}

calc_rmse <- function(e) {
  if (length(e) == 0) return(NaN)
  sqrt(mean(e^2))
}

calc_bias <- function(e) {
  if (length(e) == 0) return(NaN)
  mean(e)
}

calc_mape <- function(e, a) {
  idx <- a > 0
  if (sum(idx) == 0) return(NaN)
  mean(abs(e[idx]) / a[idx] * 100)
}

# ── Run grid search ──────────────────────────────────────────────────────────

run_grid <- function(dataset_name, n_pairs, get_data_fn) {
  configs <- expand.grid(dcap = DECAY_CAPS, cratio = CEILING_RATIOS)
  n_configs <- nrow(configs)

  # Accumulators
  errs <- vector("list", n_configs)
  acts <- vector("list", n_configs)
  regimes_list <- vector("list", n_configs)
  ceil_trigs <- integer(n_configs)

  for (ci in 1:n_configs) {
    errs[[ci]] <- numeric(n_pairs)
    acts[[ci]] <- numeric(n_pairs)
    regimes_list[[ci]] <- character(n_pairs)
    ceil_trigs[ci] <- 0L
  }

  for (pi in 1:n_pairs) {
    d <- get_data_fn(pi)
    por_old <- d$por_old; por_new <- d$por_new
    ef_stg <- d$ef_stage; lf_actual <- d$lf_actual
    lf_yesterday <- d$lf_yesterday
    stale_h <- d$stale_h; travel_h <- d$travel_h
    temp_c <- d$temp_c

    regime <- classify_regime(lf_actual, lf_yesterday)

    for (ci in 1:n_configs) {
      dcap <- configs$dcap[ci]
      cratio <- configs$cratio[ci]

      est <- estimate_gf(por_old, por_new, ef_stg, lf_actual,
                          dcap, cratio, stale_h, travel_h, temp_c)
      err <- est - lf_actual

      errs[[ci]][pi] <- err
      acts[[ci]][pi] <- lf_actual
      regimes_list[[ci]][pi] <- regime

      # Ceiling trigger
      if (!is.na(cratio) && lf_actual > 0) {
        est_nc <- estimate_gf(por_old, por_new, ef_stg, lf_actual,
                               dcap, NA, stale_h, travel_h, temp_c)
        if (est_nc > lf_actual * cratio) {
          ceil_trigs[ci] <- ceil_trigs[ci] + 1L
        }
      }
    }
  }

  # Build results
  results <- data.frame(
    config = character(n_configs),
    decay_cap = numeric(n_configs),
    ceiling_ratio = character(n_configs),
    overall_rmse = numeric(n_configs),
    rising_rmse = numeric(n_configs),
    falling_rmse = numeric(n_configs),
    steady_rmse = numeric(n_configs),
    overall_bias = numeric(n_configs),
    rising_bias = numeric(n_configs),
    overall_mape = numeric(n_configs),
    ceiling_triggers = integer(n_configs),
    n_rising = integer(n_configs),
    n_falling = integer(n_configs),
    n_steady = integer(n_configs),
    n_overall = integer(n_configs),
    stringsAsFactors = FALSE
  )

  for (ci in 1:n_configs) {
    dcap <- configs$dcap[ci]
    cratio <- configs$cratio[ci]
    cr_str <- ifelse(is.na(cratio), "none", paste0(as.integer(cratio * 100), "%"))
    name <- sprintf("decay=%.2f_ceil=%s", dcap, cr_str)

    e <- errs[[ci]]
    a <- acts[[ci]]
    r <- regimes_list[[ci]]

    rise_idx <- r == "rising"
    fall_idx <- r == "falling"
    steady_idx <- r == "steady"

    results$config[ci] <- name
    results$decay_cap[ci] <- dcap
    results$ceiling_ratio[ci] <- cr_str
    results$overall_rmse[ci] <- round(calc_rmse(e), 1)
    results$rising_rmse[ci]  <- round(calc_rmse(e[rise_idx]), 1)
    results$falling_rmse[ci] <- round(calc_rmse(e[fall_idx]), 1)
    results$steady_rmse[ci]  <- round(calc_rmse(e[steady_idx]), 1)
    results$overall_bias[ci] <- round(calc_bias(e), 1)
    results$rising_bias[ci]  <- round(calc_bias(e[rise_idx]), 1)
    results$overall_mape[ci] <- round(calc_mape(e, a), 2)
    results$ceiling_triggers[ci] <- ceil_trigs[ci]
    results$n_rising[ci]  <- sum(rise_idx)
    results$n_falling[ci] <- sum(fall_idx)
    results$n_steady[ci]  <- sum(steady_idx)
    results$n_overall[ci] <- length(e)
  }

  cat(sprintf("\n%s RESULTS (%d pairs)\n", dataset_name, n_pairs))
  cat(sprintf("%-32s %13s %13s %14s %13s %13s %13s\n",
              "Configuration", "Overall RMSE", "Rising RMSE", "Falling RMSE",
              "Steady RMSE", "Overall Bias", "Rising Bias"))
  cat(strrep("-", 120), "\n")
  for (i in 1:nrow(results)) {
    cat(sprintf("%-32s %13.1f %13.1f %14.1f %13.1f %+13.1f %+13.1f\n",
                results$config[i], results$overall_rmse[i], results$rising_rmse[i],
                results$falling_rmse[i], results$steady_rmse[i],
                results$overall_bias[i], results$rising_bias[i]))
  }

  # Best
  best_idx <- which.min(results$overall_rmse)
  cat(sprintf("\n  Best: %s -> RMSE=%.1f, Rising Bias=%+.1f\n",
              results$config[best_idx], results$overall_rmse[best_idx],
              results$rising_bias[best_idx]))

  results
}


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

cat("=" , rep("=", 69), "\n", sep = "")
cat("R INDEPENDENT VERIFICATION: Comprehensive Backtest\n")
cat(rep("=", 70), "\n", sep = "")

# ── Daily backtest ────────────────────────────────────────────────────────────

cat("\n--- Loading daily data ---\n")
daily_raw <- read.csv(DAILY_PATH, stringsAsFactors = FALSE)

# Deduplicate
daily_raw <- daily_raw[!duplicated(daily_raw$date), ]
daily_raw <- daily_raw[daily_raw$ef_stage > 0 & daily_raw$lf_discharge > 0, ]
daily_raw <- daily_raw[complete.cases(daily_raw$ef_stage, daily_raw$lf_discharge), ]
daily_raw <- daily_raw[order(daily_raw$date), ]
cat(sprintf("Daily: %d unique rows\n", nrow(daily_raw)))

# Build consecutive-day pairs
daily_dates <- as.Date(daily_raw$date)
consec <- which(diff(daily_dates) == 1)
n_daily_pairs <- length(consec)
cat(sprintf("Daily: %d consecutive-day pairs\n", n_daily_pairs))

daily_get_data <- function(pi) {
  i0 <- consec[pi]
  i1 <- i0 + 1
  list(
    por_old = daily_raw$lf_discharge[i0],
    por_new = daily_raw$lf_discharge[i1],
    ef_stage = daily_raw$ef_stage[i1],
    lf_actual = daily_raw$lf_discharge[i1],
    lf_yesterday = daily_raw$lf_discharge[i0],
    stale_h = STALENESS_HOURS,
    travel_h = TRAVEL_TIME_H,
    temp_c = NA
  )
}

daily_results <- run_grid("DAILY (R)", n_daily_pairs, daily_get_data)
write.csv(daily_results, OUT_DAILY, row.names = FALSE)
cat(sprintf("\nDaily R results written to %s\n", OUT_DAILY))

# ── Cross-verify daily ────────────────────────────────────────────────────────

if (file.exists(PY_DAILY_PATH)) {
  cat("\n--- Cross-verifying daily results (Python vs R) ---\n")
  py_daily <- read.csv(PY_DAILY_PATH, stringsAsFactors = FALSE)

  # Compare each config
  all_ok <- TRUE
  for (i in 1:nrow(daily_results)) {
    r_row <- daily_results[i, ]
    py_row <- py_daily[py_daily$config == r_row$config, ]
    if (nrow(py_row) == 0) {
      cat(sprintf("  WARNING: config %s not found in Python results\n", r_row$config))
      all_ok <- FALSE
      next
    }
    py_row <- py_row[1, ]

    diffs <- c(
      abs(r_row$overall_rmse - py_row$overall_rmse),
      abs(r_row$rising_rmse - py_row$rising_rmse),
      abs(r_row$falling_rmse - py_row$falling_rmse),
      abs(r_row$steady_rmse - py_row$steady_rmse),
      abs(r_row$overall_bias - py_row$overall_bias),
      abs(r_row$rising_bias - py_row$rising_bias)
    )

    max_diff <- max(diffs)
    if (max_diff > 0.5) {
      cat(sprintf("  MISMATCH: %s max_diff=%.1f\n", r_row$config, max_diff))
      cat(sprintf("    R:  RMSE=%.1f, Rise=%.1f, Bias=%+.1f\n",
                  r_row$overall_rmse, r_row$rising_rmse, r_row$rising_bias))
      cat(sprintf("    Py: RMSE=%.1f, Rise=%.1f, Bias=%+.1f\n",
                  py_row$overall_rmse, py_row$rising_rmse, py_row$rising_bias))
      all_ok <- FALSE
    }
  }
  if (all_ok) {
    cat("  All 25 daily configs match within tolerance (0.5 cfs)\n")
  }
} else {
  cat("\n  Python daily results not found — skipping cross-verification\n")
}

# ── Hourly backtest ──────────────────────────────────────────────────────────

if (file.exists(HOURLY_PATH)) {
  cat("\n--- Loading hourly data ---\n")
  hourly_raw <- read.csv(HOURLY_PATH, stringsAsFactors = FALSE)
  hourly_raw <- hourly_raw[hourly_raw$por_now > 0 & hourly_raw$por_lagged > 0 &
                             hourly_raw$ef_stage > 0 & hourly_raw$lf_discharge > 0, ]
  cat(sprintf("Hourly: %d rows\n", nrow(hourly_raw)))

  n_hourly_pairs <- nrow(hourly_raw) - 1
  cat(sprintf("Hourly: %d consecutive-hour pairs\n", n_hourly_pairs))

  hourly_get_data <- function(pi) {
    i_prev <- pi
    i_curr <- pi + 1
    temp_c <- hourly_raw$water_temp_c[i_curr]
    if (is.na(temp_c) || temp_c == "" || temp_c == "NA") temp_c <- NA
    else temp_c <- as.numeric(temp_c)

    list(
      por_old = hourly_raw$por_lagged[i_curr],
      por_new = hourly_raw$por_now[i_curr],
      ef_stage = hourly_raw$ef_stage[i_curr],
      lf_actual = hourly_raw$lf_discharge[i_curr],
      lf_yesterday = hourly_raw$lf_discharge[i_prev],
      stale_h = hourly_raw$travel_time_h[i_curr],
      travel_h = hourly_raw$travel_time_h[i_curr],
      temp_c = temp_c
    )
  }

  hourly_results <- run_grid("HOURLY (R)", n_hourly_pairs, hourly_get_data)
  write.csv(hourly_results, OUT_HOURLY, row.names = FALSE)
  cat(sprintf("\nHourly R results written to %s\n", OUT_HOURLY))

  # Cross-verify hourly
  if (file.exists(PY_HOURLY_PATH)) {
    cat("\n--- Cross-verifying hourly results (Python vs R) ---\n")
    py_hourly <- read.csv(PY_HOURLY_PATH, stringsAsFactors = FALSE)

    all_ok <- TRUE
    for (i in 1:nrow(hourly_results)) {
      r_row <- hourly_results[i, ]
      py_row <- py_hourly[py_hourly$config == r_row$config, ]
      if (nrow(py_row) == 0) {
        cat(sprintf("  WARNING: config %s not found in Python results\n", r_row$config))
        all_ok <- FALSE
        next
      }
      py_row <- py_row[1, ]

      diffs <- c(
        abs(r_row$overall_rmse - py_row$overall_rmse),
        abs(r_row$rising_rmse - py_row$rising_rmse),
        abs(r_row$falling_rmse - py_row$falling_rmse),
        abs(r_row$steady_rmse - py_row$steady_rmse),
        abs(r_row$overall_bias - py_row$overall_bias),
        abs(r_row$rising_bias - py_row$rising_bias)
      )

      max_diff <- max(diffs)
      if (max_diff > 0.5) {
        cat(sprintf("  MISMATCH: %s max_diff=%.1f\n", r_row$config, max_diff))
        all_ok <- FALSE
      }
    }
    if (all_ok) {
      cat("  All 25 hourly configs match within tolerance (0.5 cfs)\n")
    }
  }
} else {
  cat("\n  Hourly data not found — skipping hourly backtest\n")
}

cat("\n", rep("=", 70), "\n", sep = "")
cat("R verification complete!\n")

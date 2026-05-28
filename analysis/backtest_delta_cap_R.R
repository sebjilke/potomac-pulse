#!/usr/bin/env Rscript
# backtest_delta_cap_R.R
# Independent R replication of Python PoR-delta decay cap backtest
# Verifies: decay=0.50 / ceiling=110% vs baseline decay=0.75 / no ceiling

cat("=== PoR-Delta Decay Cap Backtest -- R Independent Verification ===

")

# -- 1. Load data --
df <- read.csv("/Users/sebjilke/Desktop/PotomacPulse/analysis/ef_lf_daily_longterm.csv",
               stringsAsFactors = FALSE)
df$date <- as.Date(df$date)
cat(sprintf("Raw rows loaded: %d
", nrow(df)))

# -- 2. Deduplicate, filter, sort --
df <- df[!duplicated(df$date), ]
df <- df[df$ef_stage > 0 & df$lf_discharge > 0, ]
df <- df[order(df$date), ]
cat(sprintf("After dedup + filter: %d rows
", nrow(df)))
cat(sprintf("Date range: %s to %s

", min(df$date), max(df$date)))

# -- 3. Build consecutive-day pairs --
n <- nrow(df)
idx_today    <- 2:n
idx_yesterday <- 1:(n - 1)

gaps <- as.numeric(df$date[idx_today] - df$date[idx_yesterday])
keep <- which(gaps == 1)

pairs <- data.frame(
  date_today     = df$date[idx_today[keep]],
  ef_stage_today = df$ef_stage[idx_today[keep]],
  lf_today       = df$lf_discharge[idx_today[keep]],
  lf_yesterday   = df$lf_discharge[idx_yesterday[keep]]
)
cat(sprintf("Consecutive-day pairs: %d

", nrow(pairs)))

# -- 4. Gradient EF weight (piecewise-linear) --
gradient_weight <- function(lf) {
  anchors_x <- c(0, 3000, 6000, 10000, 15000, 25000, 50000)
  anchors_y <- c(0.0, 0.0, 0.1,  0.4,   0.4,   0.4,   0.4)
  approx(anchors_x, anchors_y, xout = lf, rule = 2)$y
}

# -- 5. GF estimator --
estimate_gf <- function(ef_stage, lf_yesterday, lf_today, decay_cap, ceiling_ratio) {
  por_time_shifted <- lf_yesterday
  por_current      <- lf_today
  ef_estimate <- 126.0 * ef_stage^2.46
  base_estimate <- por_time_shifted

  if (por_time_shifted > 0) {
    ratio <- por_current / por_time_shifted
    pct_change <- abs(ratio - 1.0)
    if (pct_change > 0.05) {
      fraction_elapsed <- min(1.0, 20.0 / 20.0)
      decay_factor     <- min(decay_cap, sqrt(fraction_elapsed))
      applied_ratio    <- 1.0 + (ratio - 1.0) * decay_factor
      base_estimate    <- base_estimate * applied_ratio
    }
  }

  w <- gradient_weight(base_estimate)
  blended <- (1.0 - w) * base_estimate + w * ef_estimate

  if (!is.null(ceiling_ratio)) {
    cap_val <- lf_today * ceiling_ratio
    if (blended > cap_val) {
      blended <- cap_val
    }
  }

  return(blended)
}

# -- 6. Run backtest for a given configuration --
run_backtest <- function(pairs, decay_cap, ceiling_ratio, label) {
  n <- nrow(pairs)
  estimates <- numeric(n)

  for (i in seq_len(n)) {
    estimates[i] <- estimate_gf(
      ef_stage     = pairs$ef_stage_today[i],
      lf_yesterday = pairs$lf_yesterday[i],
      lf_today     = pairs$lf_today[i],
      decay_cap    = decay_cap,
      ceiling_ratio = ceiling_ratio
    )
  }

  errors <- estimates - pairs$lf_today

  regime <- ifelse(
    pairs$lf_today > pairs$lf_yesterday * 1.05, "rising",
    ifelse(pairs$lf_today < pairs$lf_yesterday * 0.95, "falling", "steady")
  )

  rmse_all  <- sqrt(mean(errors^2))
  bias_all  <- mean(errors)

  idx_r <- regime == "rising"
  rmse_rising <- sqrt(mean(errors[idx_r]^2))
  bias_rising <- mean(errors[idx_r])
  n_rising    <- sum(idx_r)

  idx_f <- regime == "falling"
  rmse_falling <- sqrt(mean(errors[idx_f]^2))
  bias_falling <- mean(errors[idx_f])
  n_falling    <- sum(idx_f)

  idx_s <- regime == "steady"
  rmse_steady <- sqrt(mean(errors[idx_s]^2))
  bias_steady <- mean(errors[idx_s])
  n_steady    <- sum(idx_s)

  cat(sprintf("-- %s --
", label))
  cat(sprintf("  Overall  RMSE: %10.1f  Bias: %10.1f  (n=%d)
", rmse_all, bias_all, n))
  cat(sprintf("  Rising   RMSE: %10.1f  Bias: %10.1f  (n=%d)
", rmse_rising, bias_rising, n_rising))
  cat(sprintf("  Falling  RMSE: %10.1f  Bias: %10.1f  (n=%d)
", rmse_falling, bias_falling, n_falling))
  cat(sprintf("  Steady   RMSE: %10.1f  Bias: %10.1f  (n=%d)

", rmse_steady, bias_steady, n_steady))

  return(list(
    rmse_all = rmse_all, bias_all = bias_all,
    rmse_rising = rmse_rising, bias_rising = bias_rising,
    rmse_falling = rmse_falling, bias_falling = bias_falling,
    rmse_steady = rmse_steady, bias_steady = bias_steady,
    n_total = n, n_rising = n_rising, n_falling = n_falling, n_steady = n_steady
  ))
}

# -- 7. Run both configurations --
cat("Running backtests...

")

winner   <- run_backtest(pairs, decay_cap = 0.50, ceiling_ratio = 1.10,
                         label = "Winner: decay=0.50, ceiling=110%")
baseline <- run_backtest(pairs, decay_cap = 0.75, ceiling_ratio = NULL,
                         label = "Baseline: decay=0.75, no ceiling")

# -- 8. Comparison with Python results --
cat("=== Comparison with Python Results ===

")

py_winner_overall  <- 1353.2
py_winner_rising   <- 1849.9
py_winner_rbias    <- -4.8
py_base_overall    <- 2977.5
py_base_rising     <- 4638.8
py_base_rbias      <- 1175.8

check <- function(label, r_val, py_val, tol_pct = 1.0) {
  diff_pct <- abs(r_val - py_val) / max(abs(py_val), 1e-6) * 100
  status   <- ifelse(diff_pct < tol_pct, "PASS", "FAIL")
  cat(sprintf("  %s: R=%.1f  Python=%.1f  diff=%.2f%%  [%s]
",
              label, r_val, py_val, diff_pct, status))
  return(status == "PASS")
}

all_pass <- TRUE
all_pass <- check("Winner Overall RMSE ", winner$rmse_all,    py_winner_overall) & all_pass
all_pass <- check("Winner Rising RMSE  ", winner$rmse_rising, py_winner_rising)  & all_pass
all_pass <- check("Winner Rising Bias  ", winner$bias_rising, py_winner_rbias)   & all_pass
all_pass <- check("Baseline Overall RMSE", baseline$rmse_all,    py_base_overall)  & all_pass
all_pass <- check("Baseline Rising RMSE ", baseline$rmse_rising, py_base_rising)   & all_pass
all_pass <- check("Baseline Rising Bias ", baseline$bias_rising, py_base_rbias)    & all_pass

cat(sprintf("
=== OVERALL VERIFICATION: %s ===
",
            ifelse(all_pass, "ALL CHECKS PASSED", "SOME CHECKS FAILED")))

# -- 9. Improvement summary --
cat(sprintf("
Improvement (Winner vs Baseline):
"))
cat(sprintf("  Overall RMSE: %.1f -> %.1f  (%.1f%% reduction)
",
            baseline$rmse_all, winner$rmse_all,
            (1 - winner$rmse_all / baseline$rmse_all) * 100))
cat(sprintf("  Rising RMSE:  %.1f -> %.1f  (%.1f%% reduction)
",
            baseline$rmse_rising, winner$rmse_rising,
            (1 - winner$rmse_rising / baseline$rmse_rising) * 100))
cat(sprintf("  Rising Bias:  %+.1f -> %+.1f
",
            baseline$bias_rising, winner$bias_rising))

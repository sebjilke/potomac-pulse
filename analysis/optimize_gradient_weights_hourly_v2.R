#!/usr/bin/env Rscript
# optimize_gradient_weights_hourly_v2.R
# Independent R cross-verification of Python gradient weight optimization
# on hourly dataset. Wider search space, zero-initialized, forward-only monotonicity.
# 2026-02-19

cat("=== EF Gradient Weight Optimization (Hourly, v2) ===\n")
cat("Independent R cross-verification\n")
cat("Zero-initialized, W_MAX=0.80, forward-only monotonicity\n\n")

# ---- Load data ----
data_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
df <- read.csv(data_path, stringsAsFactors = FALSE)
cat(sprintf("Raw rows loaded: %d\n", nrow(df)))

# ---- Filter valid rows ----
df <- df[!is.na(df$por_lagged) & !is.na(df$ef_stage) & !is.na(df$lf_discharge), ]
df <- df[df$por_lagged > 0 & df$ef_stage > 0 & df$lf_discharge > 0, ]
cat(sprintf("Valid rows after filtering (por_lagged>0, ef_stage>0, lf_discharge>0): %d\n\n", nrow(df)))

# ---- EF model ----
# Default: 126 * ef_stage^2.46
# Cold water (water_temp_c <= 10 AND not NA): 160 * ef_stage^2.36
df$ef_cfs <- ifelse(
  !is.na(df$water_temp_c) & df$water_temp_c <= 10,
  160 * df$ef_stage^2.36,
  126 * df$ef_stage^2.46
)

cold_count <- sum(!is.na(df$water_temp_c) & df$water_temp_c <= 10)
cat(sprintf("Cold-water rows (temp <= 10C): %d (%.1f%%)\n", cold_count, 100 * cold_count / nrow(df)))
cat(sprintf("Default model rows: %d\n\n", nrow(df) - cold_count))

# ---- Anchor points ----
anchors <- c(0, 3000, 6000, 10000, 15000, 25000, 50000)
n_anchors <- length(anchors)

# ---- Piecewise-linear interpolation function ----
pw_interp <- function(x, anchors, weights) {
  # Vectorized piecewise-linear interpolation
  n <- length(anchors)
  result <- numeric(length(x))

  # Below first anchor
  result[x <= anchors[1]] <- weights[1]
  # Above last anchor
  result[x >= anchors[n]] <- weights[n]

  # Between anchors
  for (i in 1:(n - 1)) {
    mask <- x > anchors[i] & x < anchors[i + 1]
    if (any(mask)) {
      frac <- (x[mask] - anchors[i]) / (anchors[i + 1] - anchors[i])
      result[mask] <- weights[i] + frac * (weights[i + 1] - weights[i])
    }
    # Exactly at anchor
    mask_eq <- x == anchors[i + 1]
    result[mask_eq] <- weights[i + 1]
  }
  # Exactly at first anchor
  result[x == anchors[1]] <- weights[1]

  return(result)
}

# ---- RMSE function ----
calc_rmse <- function(weights, por_lagged, ef_cfs, lf_discharge) {
  w <- pw_interp(por_lagged, anchors, weights)
  estimated <- (1 - w) * por_lagged + w * ef_cfs
  sqrt(mean((estimated - lf_discharge)^2))
}

# ---- Enforce forward-only monotonicity ----
enforce_mono_forward <- function(weights) {
  for (i in 2:length(weights)) {
    if (weights[i] < weights[i - 1]) {
      weights[i] <- weights[i - 1]
    }
  }
  return(weights)
}

# ---- Coordinate descent optimization ----
optimize_weights <- function(por_lagged, ef_cfs, lf_discharge,
                              init_weights = rep(0.0, n_anchors),
                              w_max = 0.80, verbose = TRUE) {

  weights <- init_weights
  weights <- enforce_mono_forward(weights)

  best_rmse <- calc_rmse(weights, por_lagged, ef_cfs, lf_discharge)
  if (verbose) cat(sprintf("Initial RMSE: %.2f cfs\n", best_rmse))

  # Phase 1: Coarse sweep (0.00 to 0.80 in 0.05 steps), 5 passes
  if (verbose) cat("Phase 1: Coarse sweep (0.00-0.80, step 0.05, 5 passes)\n")
  for (pass in 1:5) {
    improved <- FALSE
    for (i in 1:n_anchors) {
      best_w <- weights[i]
      best_local_rmse <- calc_rmse(weights, por_lagged, ef_cfs, lf_discharge)

      candidates <- seq(0.00, w_max, by = 0.05)
      for (cand in candidates) {
        test_weights <- weights
        test_weights[i] <- cand
        test_weights <- enforce_mono_forward(test_weights)

        rmse_val <- calc_rmse(test_weights, por_lagged, ef_cfs, lf_discharge)
        if (rmse_val < best_local_rmse) {
          best_local_rmse <- rmse_val
          best_w <- cand
          improved <- TRUE
        }
      }
      weights[i] <- best_w
      weights <- enforce_mono_forward(weights)
    }
    current_rmse <- calc_rmse(weights, por_lagged, ef_cfs, lf_discharge)
    if (verbose) cat(sprintf("  Pass %d: RMSE = %.2f cfs | weights = [%s]\n",
                              pass, current_rmse,
                              paste(sprintf("%.2f", weights), collapse = ", ")))
    if (!improved) {
      if (verbose) cat("  Converged early (no improvement)\n")
      break
    }
  }

  # Phase 2: Fine refinement (±0.05 in 0.01 steps), 3 passes
  if (verbose) cat("Phase 2: Fine refinement (±0.05, step 0.01, 3 passes)\n")
  for (pass in 1:3) {
    improved <- FALSE
    for (i in 1:n_anchors) {
      best_w <- weights[i]
      best_local_rmse <- calc_rmse(weights, por_lagged, ef_cfs, lf_discharge)

      lo <- max(0.00, weights[i] - 0.05)
      hi <- min(w_max, weights[i] + 0.05)
      candidates <- seq(lo, hi, by = 0.01)

      for (cand in candidates) {
        test_weights <- weights
        test_weights[i] <- cand
        test_weights <- enforce_mono_forward(test_weights)

        rmse_val <- calc_rmse(test_weights, por_lagged, ef_cfs, lf_discharge)
        if (rmse_val < best_local_rmse) {
          best_local_rmse <- rmse_val
          best_w <- cand
          improved <- TRUE
        }
      }
      weights[i] <- best_w
      weights <- enforce_mono_forward(weights)
    }
    current_rmse <- calc_rmse(weights, por_lagged, ef_cfs, lf_discharge)
    if (verbose) cat(sprintf("  Pass %d: RMSE = %.2f cfs | weights = [%s]\n",
                              pass, current_rmse,
                              paste(sprintf("%.2f", weights), collapse = ", ")))
    if (!improved) {
      if (verbose) cat("  Converged early (no improvement)\n")
      break
    }
  }

  # Round to 2 decimal places
  weights <- round(weights, 2)
  weights <- enforce_mono_forward(weights)
  final_rmse <- calc_rmse(weights, por_lagged, ef_cfs, lf_discharge)
  if (verbose) cat(sprintf("Final RMSE (rounded): %.2f cfs\n", final_rmse))

  return(list(weights = weights, rmse = final_rmse))
}

# ---- Run optimization ----
cat("\n--- FULL OPTIMIZATION ---\n")
result <- optimize_weights(df$por_lagged, df$ef_cfs, df$lf_discharge,
                           init_weights = rep(0.0, n_anchors))

new_weights <- result$weights
new_rmse <- result$rmse

# ---- Comparison weights ----
current_weights <- c(0.0, 0.0, 0.10, 0.40, 0.40, 0.40, 0.40)  # current v28.0
prev_hourly_weights <- c(0.0, 0.40, 0.40, 0.40, 0.40, 0.40, 0.40)  # previous hourly

current_rmse <- calc_rmse(current_weights, df$por_lagged, df$ef_cfs, df$lf_discharge)
prev_hourly_rmse <- calc_rmse(prev_hourly_weights, df$por_lagged, df$ef_cfs, df$lf_discharge)

# ---- Print results ----
cat("\n\n========================================\n")
cat("         RESULTS SUMMARY\n")
cat("========================================\n\n")

cat("1. OPTIMAL WEIGHTS (2 decimal places)\n")
cat("   Anchor (cfs)  |  Weight\n")
cat("   --------------|--------\n")
for (i in 1:n_anchors) {
  cat(sprintf("   %13s  |  %.2f\n", format(anchors[i], big.mark = ","), new_weights[i]))
}

cat(sprintf("\n2. OVERALL RMSE COMPARISON\n"))
cat(sprintf("   New unconstrained (zero-init):  %.2f cfs\n", new_rmse))
cat(sprintf("   Current v28.0 weights:          %.2f cfs\n", current_rmse))
cat(sprintf("   Previous hourly weights:        %.2f cfs\n", prev_hourly_rmse))
cat(sprintf("   Improvement vs current:         %.1f%% (%.0f cfs)\n",
            100 * (current_rmse - new_rmse) / current_rmse,
            current_rmse - new_rmse))
cat(sprintf("   Improvement vs prev hourly:     %.1f%% (%.0f cfs)\n",
            100 * (prev_hourly_rmse - new_rmse) / prev_hourly_rmse,
            prev_hourly_rmse - new_rmse))

# ---- RMSE by flow regime ----
cat("\n3. RMSE BY FLOW REGIME\n")
flow_bins <- list(
  "<3k"    = c(0, 3000),
  "3-6k"   = c(3000, 6000),
  "6-10k"  = c(6000, 10000),
  "10-15k" = c(10000, 15000),
  "15-25k" = c(15000, 25000),
  "25-50k" = c(25000, 50000),
  ">50k"   = c(50000, Inf)
)

cat(sprintf("   %-8s | %6s | %10s | %10s | %10s\n", "Regime", "N", "New", "Current", "PrevHourly"))
cat("   ---------|--------|------------|------------|------------\n")

for (regime_name in names(flow_bins)) {
  lo <- flow_bins[[regime_name]][1]
  hi <- flow_bins[[regime_name]][2]

  if (lo == 0) {
    mask <- df$por_lagged < hi
  } else if (is.infinite(hi)) {
    mask <- df$por_lagged >= lo
  } else {
    mask <- df$por_lagged >= lo & df$por_lagged < hi
  }

  n_rows <- sum(mask)
  if (n_rows > 0) {
    sub <- df[mask, ]
    rmse_new <- calc_rmse(new_weights, sub$por_lagged, sub$ef_cfs, sub$lf_discharge)
    rmse_cur <- calc_rmse(current_weights, sub$por_lagged, sub$ef_cfs, sub$lf_discharge)
    rmse_prev <- calc_rmse(prev_hourly_weights, sub$por_lagged, sub$ef_cfs, sub$lf_discharge)
    cat(sprintf("   %-8s | %6d | %8.0f   | %8.0f   | %8.0f\n",
                regime_name, n_rows, rmse_new, rmse_cur, rmse_prev))
  } else {
    cat(sprintf("   %-8s | %6d |     --     |     --     |     --\n", regime_name, n_rows))
  }
}

# ---- Rising-event RMSE by flow regime ----
cat("\n4. RISING-EVENT RMSE BY FLOW REGIME\n")
cat("   (Rising = por_lagged > previous por_lagged by >5%)\n")

# Identify rising events
df$is_rising <- FALSE
if (nrow(df) > 1) {
  ratio <- df$por_lagged[2:nrow(df)] / df$por_lagged[1:(nrow(df) - 1)]
  df$is_rising[2:nrow(df)] <- ratio > 1.05
}

rising_df <- df[df$is_rising, ]
cat(sprintf("   Total rising-event rows: %d (%.1f%% of valid)\n\n",
            nrow(rising_df), 100 * nrow(rising_df) / nrow(df)))

cat(sprintf("   %-8s | %6s | %10s | %10s | %10s\n", "Regime", "N", "New", "Current", "PrevHourly"))
cat("   ---------|--------|------------|------------|------------\n")

for (regime_name in names(flow_bins)) {
  lo <- flow_bins[[regime_name]][1]
  hi <- flow_bins[[regime_name]][2]

  if (lo == 0) {
    mask <- rising_df$por_lagged < hi
  } else if (is.infinite(hi)) {
    mask <- rising_df$por_lagged >= lo
  } else {
    mask <- rising_df$por_lagged >= lo & rising_df$por_lagged < hi
  }

  n_rows <- sum(mask)
  if (n_rows > 0) {
    sub <- rising_df[mask, ]
    rmse_new <- calc_rmse(new_weights, sub$por_lagged, sub$ef_cfs, sub$lf_discharge)
    rmse_cur <- calc_rmse(current_weights, sub$por_lagged, sub$ef_cfs, sub$lf_discharge)
    rmse_prev <- calc_rmse(prev_hourly_weights, sub$por_lagged, sub$ef_cfs, sub$lf_discharge)
    cat(sprintf("   %-8s | %6d | %8.0f   | %8.0f   | %8.0f\n",
                regime_name, n_rows, rmse_new, rmse_cur, rmse_prev))
  } else {
    cat(sprintf("   %-8s | %6d |     --     |     --     |     --\n", regime_name, n_rows))
  }
}

# ---- Leave-one-year-out cross-validation ----
cat("\n5. LEAVE-ONE-YEAR-OUT CROSS-VALIDATION\n")

df$year <- as.integer(substr(df$timestamp, 1, 4))
years <- sort(unique(df$year))
cat(sprintf("   Years in data: %s\n\n", paste(years, collapse = ", ")))

cat(sprintf("   %-6s | %6s | %6s | %10s | %10s | %10s | %s\n",
            "Holdout", "Train", "Test", "New(test)", "Cur(test)", "PrevH(test)", "Holdout Weights"))
cat("   -------|--------|--------|------------|------------|------------|------------------------------------\n")

cv_new_rmses <- c()
cv_cur_rmses <- c()
cv_prev_rmses <- c()

for (yr in years) {
  train <- df[df$year != yr, ]
  test <- df[df$year == yr, ]

  if (nrow(test) < 10) next

  # Optimize on training set
  cv_result <- optimize_weights(train$por_lagged, train$ef_cfs, train$lf_discharge,
                                 init_weights = rep(0.0, n_anchors), verbose = FALSE)

  cv_weights <- cv_result$weights

  # Evaluate on test set
  test_rmse_new <- calc_rmse(cv_weights, test$por_lagged, test$ef_cfs, test$lf_discharge)
  test_rmse_cur <- calc_rmse(current_weights, test$por_lagged, test$ef_cfs, test$lf_discharge)
  test_rmse_prev <- calc_rmse(prev_hourly_weights, test$por_lagged, test$ef_cfs, test$lf_discharge)

  cv_new_rmses <- c(cv_new_rmses, test_rmse_new)
  cv_cur_rmses <- c(cv_cur_rmses, test_rmse_cur)
  cv_prev_rmses <- c(cv_prev_rmses, test_rmse_prev)

  cat(sprintf("   %4d   | %6d | %6d | %8.0f   | %8.0f   | %8.0f   | [%s]\n",
              yr, nrow(train), nrow(test), test_rmse_new, test_rmse_cur, test_rmse_prev,
              paste(sprintf("%.2f", cv_weights), collapse = ", ")))
}

cat(sprintf("   %-6s | %6s | %6s | %8.0f   | %8.0f   | %8.0f\n",
            "MEAN", "--", "--", mean(cv_new_rmses), mean(cv_cur_rmses), mean(cv_prev_rmses)))

cat(sprintf("\n   CV improvement vs current:      %.1f%%\n",
            100 * (mean(cv_cur_rmses) - mean(cv_new_rmses)) / mean(cv_cur_rmses)))
cat(sprintf("   CV improvement vs prev hourly:  %.1f%%\n",
            100 * (mean(cv_prev_rmses) - mean(cv_new_rmses)) / mean(cv_prev_rmses)))

# ---- Row counts ----
cat(sprintf("\n6. VALID ROWS USED: %d\n", nrow(df)))

# ---- Comparison table ----
cat("\n7. WEIGHT COMPARISON TABLE\n")
cat(sprintf("   %-13s | %-12s | %-12s | %-12s\n",
            "Anchor (cfs)", "Current v28", "Prev Hourly", "New (v2)"))
cat("   --------------|--------------|--------------|-------------\n")
for (i in 1:n_anchors) {
  cat(sprintf("   %13s | %10.2f   | %10.2f   | %10.2f\n",
              format(anchors[i], big.mark = ","),
              current_weights[i], prev_hourly_weights[i], new_weights[i]))
}
cat(sprintf("   %13s | %8.0f     | %8.0f     | %8.0f\n",
            "RMSE (cfs)", current_rmse, prev_hourly_rmse, new_rmse))

# ---- Save results CSV ----
output_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/gradient_weights_hourly_v2_R.csv"
results_df <- data.frame(
  anchor_cfs = anchors,
  weight_new_v2 = new_weights,
  weight_current_v28 = current_weights,
  weight_prev_hourly = prev_hourly_weights
)
write.csv(results_df, output_path, row.names = FALSE)
cat(sprintf("\nResults saved to: %s\n", output_path))

cat("\n=== Optimization complete ===\n")

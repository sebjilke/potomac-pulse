#!/usr/bin/env Rscript
# optimize_gradient_weights_hourly.R
# Independent cross-language verification of EF gradient weight optimization
# using HOURLY travel-time-shifted PoR data.
#
# Mirrors the Python coordinate descent approach but uses actual shifted PoR
# readings (por_lagged) rather than daily lag-1 proxies.
#
# Author: Claude (cross-language verification)
# Date: 2026-02-19

cat("=============================================================\n")
cat("EF Gradient Weight Optimization — HOURLY Data (R)\n")
cat("Cross-language verification of Python optimization\n")
cat("=============================================================\n\n")

# ── 1. Load and prepare data ──────────────────────────────────────────────

data_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
df <- read.csv(data_path, stringsAsFactors = FALSE)

cat(sprintf("Raw data: %d rows, %d columns\n", nrow(df), ncol(df)))
cat(sprintf("Columns: %s\n", paste(names(df), collapse = ", ")))
cat(sprintf("Date range: %s to %s\n", min(df$timestamp), max(df$timestamp)))
cat("\n")

# Map column names to expected names
# por_lagged = travel-time-shifted PoR (what PoR read T hours ago)
# lf_discharge = Little Falls actual (ground truth)
df$por_shifted_cfs <- df$por_lagged
df$lf_cfs <- df$lf_discharge

# Filter: por_shifted_cfs > 0, ef_stage > 0, lf_cfs > 0
# Also need non-NA values
valid <- !is.na(df$por_shifted_cfs) & !is.na(df$ef_stage) & !is.na(df$lf_cfs) &
         df$por_shifted_cfs > 0 & df$ef_stage > 0 & df$lf_cfs > 0

df_valid <- df[valid, ]
cat(sprintf("After filtering (por_shifted > 0, ef_stage > 0, lf > 0): %d rows\n", nrow(df_valid)))
cat(sprintf("Rows removed: %d (%.1f%%)\n",
            nrow(df) - nrow(df_valid),
            100 * (nrow(df) - nrow(df_valid)) / nrow(df)))
cat("\n")

# ── 2. EF power-law model ────────────────────────────────────────────────

compute_ef_cfs <- function(ef_stage, water_temp_c) {
  # Default: 126 * ef_stage^2.46

# Cold water (<=10C): 160 * ef_stage^2.36
  cold <- !is.na(water_temp_c) & water_temp_c <= 10
  ef_cfs <- ifelse(cold,
                   160 * ef_stage^2.36,
                   126 * ef_stage^2.46)
  return(ef_cfs)
}

df_valid$ef_cfs <- compute_ef_cfs(df_valid$ef_stage, df_valid$water_temp_c)

cat("EF CFS summary:\n")
cat(sprintf("  Mean: %.1f, Median: %.1f, Min: %.1f, Max: %.1f\n",
            mean(df_valid$ef_cfs), median(df_valid$ef_cfs),
            min(df_valid$ef_cfs), max(df_valid$ef_cfs)))

cold_count <- sum(!is.na(df_valid$water_temp_c) & df_valid$water_temp_c <= 10)
default_count <- nrow(df_valid) - cold_count
cat(sprintf("  Cold-water model rows: %d (%.1f%%)\n", cold_count, 100 * cold_count / nrow(df_valid)))
cat(sprintf("  Default model rows: %d (%.1f%%)\n", default_count, 100 * default_count / nrow(df_valid)))
cat("\n")

# ── 3. Piecewise-linear weight interpolation ─────────────────────────────

anchor_flows <- c(0, 3000, 6000, 10000, 15000, 25000, 50000)

interpolate_weight <- function(por_cfs, weights) {
  # Piecewise-linear interpolation between anchor points
  # por_cfs: scalar or vector of PoR flow values
  # weights: vector of 7 weights at anchor points
  n <- length(por_cfs)
  w <- numeric(n)

  for (i in seq_len(n)) {
    flow <- por_cfs[i]
    if (flow <= anchor_flows[1]) {
      w[i] <- weights[1]
    } else if (flow >= anchor_flows[7]) {
      w[i] <- weights[7]
    } else {
      # Find bracketing anchors
      for (j in 1:6) {
        if (flow >= anchor_flows[j] & flow < anchor_flows[j + 1]) {
          frac <- (flow - anchor_flows[j]) / (anchor_flows[j + 1] - anchor_flows[j])
          w[i] <- weights[j] + frac * (weights[j + 1] - weights[j])
          break
        }
      }
    }
  }
  return(w)
}

# ── 4. RMSE computation ─────────────────────────────────────────────────

compute_rmse <- function(weights, por_shifted, ef_cfs, lf_cfs) {
  w <- interpolate_weight(por_shifted, weights)
  estimated <- (1 - w) * por_shifted + w * ef_cfs
  errors <- estimated - lf_cfs
  return(sqrt(mean(errors^2)))
}

# ── 5. Coordinate descent optimization ──────────────────────────────────

por_shifted <- df_valid$por_shifted_cfs
ef_cfs_vals <- df_valid$ef_cfs
lf_cfs_vals <- df_valid$lf_cfs

# Current daily-optimized weights
current_weights <- c(0.0, 0.0, 0.1, 0.4, 0.4, 0.4, 0.4)
current_rmse <- compute_rmse(current_weights, por_shifted, ef_cfs_vals, lf_cfs_vals)
cat(sprintf("Current daily-optimized weights: %s\n",
            paste(sprintf("%.2f", current_weights), collapse = ", ")))
cat(sprintf("Current weights RMSE on hourly data: %.1f cfs\n\n", current_rmse))

# Initialize with current weights
weights <- current_weights

cat("── Coarse Pass (0.05 steps, 5 sweeps) ──\n")
for (sweep in 1:5) {
  for (a in 1:7) {
    best_w <- weights[a]
    best_rmse <- compute_rmse(weights, por_shifted, ef_cfs_vals, lf_cfs_vals)

    for (candidate in seq(0.00, 0.80, by = 0.05)) {
      test_weights <- weights
      test_weights[a] <- candidate

      # Enforce monotonicity (non-decreasing)
      for (k in 2:7) {
        if (test_weights[k] < test_weights[k - 1]) {
          test_weights[k] <- test_weights[k - 1]
        }
      }
      # Also enforce backwards (if lowering an anchor, push earlier ones down)
      for (k in 6:1) {
        if (test_weights[k] > test_weights[k + 1]) {
          test_weights[k] <- test_weights[k + 1]
        }
      }

      rmse <- compute_rmse(test_weights, por_shifted, ef_cfs_vals, lf_cfs_vals)
      if (rmse < best_rmse) {
        best_rmse <- rmse
        best_w <- candidate
        weights <- test_weights
      }
    }
    weights[a] <- best_w
    # Re-enforce monotonicity after final assignment
    for (k in 2:7) {
      if (weights[k] < weights[k - 1]) weights[k] <- weights[k - 1]
    }
    for (k in 6:1) {
      if (weights[k] > weights[k + 1]) weights[k] <- weights[k + 1]
    }
  }
  rmse_now <- compute_rmse(weights, por_shifted, ef_cfs_vals, lf_cfs_vals)
  cat(sprintf("  Sweep %d: RMSE = %.1f cfs | weights = [%s]\n",
              sweep, rmse_now,
              paste(sprintf("%.2f", weights), collapse = ", ")))
}

cat("\n── Fine Pass (0.01 steps, 3 sweeps) ──\n")
for (sweep in 1:3) {
  for (a in 1:7) {
    best_w <- weights[a]
    best_rmse <- compute_rmse(weights, por_shifted, ef_cfs_vals, lf_cfs_vals)

    lo <- max(0.00, weights[a] - 0.05)
    hi <- min(0.80, weights[a] + 0.05)

    for (candidate in seq(lo, hi, by = 0.01)) {
      test_weights <- weights
      test_weights[a] <- candidate

      # Enforce monotonicity
      for (k in 2:7) {
        if (test_weights[k] < test_weights[k - 1]) {
          test_weights[k] <- test_weights[k - 1]
        }
      }
      for (k in 6:1) {
        if (test_weights[k] > test_weights[k + 1]) {
          test_weights[k] <- test_weights[k + 1]
        }
      }

      rmse <- compute_rmse(test_weights, por_shifted, ef_cfs_vals, lf_cfs_vals)
      if (rmse < best_rmse) {
        best_rmse <- rmse
        best_w <- candidate
        weights <- test_weights
      }
    }
    weights[a] <- best_w
    for (k in 2:7) {
      if (weights[k] < weights[k - 1]) weights[k] <- weights[k - 1]
    }
    for (k in 6:1) {
      if (weights[k] > weights[k + 1]) weights[k] <- weights[k + 1]
    }
  }
  rmse_now <- compute_rmse(weights, por_shifted, ef_cfs_vals, lf_cfs_vals)
  cat(sprintf("  Sweep %d: RMSE = %.1f cfs | weights = [%s]\n",
              sweep, rmse_now,
              paste(sprintf("%.2f", weights), collapse = ", ")))
}

# Round to 1 decimal place
weights_final <- round(weights, 1)

# Re-enforce monotonicity after rounding
for (k in 2:7) {
  if (weights_final[k] < weights_final[k - 1]) weights_final[k] <- weights_final[k - 1]
}

final_rmse <- compute_rmse(weights_final, por_shifted, ef_cfs_vals, lf_cfs_vals)

cat("\n=============================================================\n")
cat("RESULTS\n")
cat("=============================================================\n\n")

cat("Optimal weights (hourly data, rounded to 1 decimal):\n")
for (i in 1:7) {
  cat(sprintf("  %6d cfs -> weight = %.1f\n", anchor_flows[i], weights_final[i]))
}
cat("\n")

cat(sprintf("Valid rows used: %d\n\n", nrow(df_valid)))

cat("─── RMSE Comparison ───\n")
cat(sprintf("  Current daily-optimized weights: %.1f cfs  [%s]\n",
            current_rmse,
            paste(sprintf("%.1f", current_weights), collapse = ", ")))
cat(sprintf("  New hourly-optimized weights:    %.1f cfs  [%s]\n",
            final_rmse,
            paste(sprintf("%.1f", weights_final), collapse = ", ")))
improvement <- current_rmse - final_rmse
pct_improvement <- 100 * improvement / current_rmse
cat(sprintf("  Improvement: %.1f cfs (%.1f%%)\n\n", improvement, pct_improvement))

# ── 6. RMSE by flow regime ──────────────────────────────────────────────

cat("─── RMSE by Flow Regime ───\n")
cat(sprintf("%-12s %8s %8s %8s %8s\n", "Regime", "N", "Current", "New", "Delta"))
cat(paste(rep("-", 48), collapse = ""), "\n")

regimes <- list(
  list(name = "<3k",    lo = 0,     hi = 3000),
  list(name = "3-6k",   lo = 3000,  hi = 6000),
  list(name = "6-10k",  lo = 6000,  hi = 10000),
  list(name = "10-15k", lo = 10000, hi = 15000),
  list(name = "15-25k", lo = 15000, hi = 25000),
  list(name = "25-50k", lo = 25000, hi = 50000),
  list(name = ">50k",   lo = 50000, hi = Inf)
)

for (r in regimes) {
  mask <- por_shifted >= r$lo & por_shifted < r$hi
  n <- sum(mask)
  if (n == 0) {
    cat(sprintf("%-12s %8d %8s %8s %8s\n", r$name, 0, "N/A", "N/A", "N/A"))
    next
  }

  # Current weights
  w_curr <- interpolate_weight(por_shifted[mask], current_weights)
  est_curr <- (1 - w_curr) * por_shifted[mask] + w_curr * ef_cfs_vals[mask]
  rmse_curr <- sqrt(mean((est_curr - lf_cfs_vals[mask])^2))

  # New weights
  w_new <- interpolate_weight(por_shifted[mask], weights_final)
  est_new <- (1 - w_new) * por_shifted[mask] + w_new * ef_cfs_vals[mask]
  rmse_new <- sqrt(mean((est_new - lf_cfs_vals[mask])^2))

  delta <- rmse_curr - rmse_new
  cat(sprintf("%-12s %8d %8.1f %8.1f %+8.1f\n", r$name, n, rmse_curr, rmse_new, delta))
}

# ── 7. Comparison table ─────────────────────────────────────────────────

cat("\n─── Weight Comparison (Daily vs Hourly) ───\n")
cat(sprintf("%-12s %12s %12s %8s\n", "Anchor", "Daily", "Hourly", "Diff"))
cat(paste(rep("-", 46), collapse = ""), "\n")
for (i in 1:7) {
  diff <- weights_final[i] - current_weights[i]
  cat(sprintf("%-12s %12.1f %12.1f %+8.1f\n",
              paste0(anchor_flows[i], " cfs"),
              current_weights[i], weights_final[i], diff))
}

# ── 8. Save results ─────────────────────────────────────────────────────

output_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/gradient_weights_hourly_R.csv"
output_df <- data.frame(
  anchor_flow = anchor_flows,
  optimal_weight = weights_final
)
write.csv(output_df, output_path, row.names = FALSE)
cat(sprintf("\nResults saved to: %s\n", output_path))

# ── 9. Additional diagnostics ───────────────────────────────────────────

cat("\n─── Additional Diagnostics ───\n")

# Bias
w_new_all <- interpolate_weight(por_shifted, weights_final)
est_new_all <- (1 - w_new_all) * por_shifted + w_new_all * ef_cfs_vals
errors_new <- est_new_all - lf_cfs_vals
cat(sprintf("  Mean bias (new weights): %+.1f cfs\n", mean(errors_new)))

w_curr_all <- interpolate_weight(por_shifted, current_weights)
est_curr_all <- (1 - w_curr_all) * por_shifted + w_curr_all * ef_cfs_vals
errors_curr <- est_curr_all - lf_cfs_vals
cat(sprintf("  Mean bias (current weights): %+.1f cfs\n", mean(errors_curr)))

# MAE
cat(sprintf("  MAE (new weights): %.1f cfs\n", mean(abs(errors_new))))
cat(sprintf("  MAE (current weights): %.1f cfs\n", mean(abs(errors_curr))))

# Correlation
cat(sprintf("  Correlation(estimated, actual) new: %.4f\n", cor(est_new_all, lf_cfs_vals)))
cat(sprintf("  Correlation(estimated, actual) current: %.4f\n", cor(est_curr_all, lf_cfs_vals)))

# Temperature data availability
temp_avail <- sum(!is.na(df_valid$water_temp_c))
cat(sprintf("  Water temp available: %d / %d rows (%.1f%%)\n",
            temp_avail, nrow(df_valid), 100 * temp_avail / nrow(df_valid)))

cat("\n=============================================================\n")
cat("Optimization complete.\n")
cat("=============================================================\n")

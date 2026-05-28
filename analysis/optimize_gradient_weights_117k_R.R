#!/usr/bin/env Rscript
# =============================================================================
# Gradient Weight Optimization for Potomac Pulse v29 -> v30
# Independent R blind analysis on expanded 117,704-row hourly dataset
# =============================================================================

cat("=== R Gradient Weight Optimization (117k hourly dataset) ===\n")
cat("Started:", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "\n\n")

# ---- 1. Load data -----------------------------------------------------------
data_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
df <- read.csv(data_path, stringsAsFactors = FALSE)
cat("Loaded", nrow(df), "rows,", ncol(df), "columns\n")
cat("Columns:", paste(names(df), collapse = ", "), "\n")

# Parse timestamp and extract year
df$timestamp <- as.POSIXct(df$timestamp, format = "%Y-%m-%d %H:%M", tz = "UTC")
df$year <- as.integer(format(df$timestamp, "%Y"))

cat("Date range:", format(min(df$timestamp, na.rm=TRUE)), "to", format(max(df$timestamp, na.rm=TRUE)), "\n")
cat("Years present:", paste(sort(unique(df$year)), collapse = ", "), "\n\n")

# ---- 2. Compute EF estimate -------------------------------------------------
df$ef_estimate <- ifelse(
  !is.na(df$water_temp_c) & df$water_temp_c <= 10,
  160 * df$ef_stage^2.36,   # cold water model
  126 * df$ef_stage^2.46    # default model
)

cat("EF estimate summary:\n")
print(summary(df$ef_estimate))
cat("Cold water rows:", sum(!is.na(df$water_temp_c) & df$water_temp_c <= 10), "\n")
cat("Default model rows:", sum(is.na(df$water_temp_c) | df$water_temp_c > 10), "\n\n")

# ---- 3. Filter valid rows ---------------------------------------------------
valid <- !is.na(df$por_lagged) & !is.na(df$ef_estimate) & !is.na(df$lf_discharge) &
         !is.na(df$ef_stage) & df$ef_stage > 0
df_valid <- df[valid, ]
cat("Valid rows after filtering:", nrow(df_valid), "of", nrow(df), "\n\n")

# ---- 4. Define optimization functions ----------------------------------------
ANCHORS <- c(0, 3000, 6000, 10000, 15000, 25000, 50000)
N_ANCHORS <- length(ANCHORS)
W_MIN <- 0.00
W_MAX <- 0.80

# Piecewise-linear interpolation of weight given por_lagged
get_weight <- function(flow, weights) {
  if (flow <= ANCHORS[1]) return(weights[1])
  if (flow >= ANCHORS[N_ANCHORS]) return(weights[N_ANCHORS])

  for (i in 2:N_ANCHORS) {
    if (flow <= ANCHORS[i]) {
      frac <- (flow - ANCHORS[i-1]) / (ANCHORS[i] - ANCHORS[i-1])
      return(weights[i-1] + frac * (weights[i] - weights[i-1]))
    }
  }
  return(weights[N_ANCHORS])
}

# Vectorized weight computation for speed
get_weights_vec <- function(flows, weights) {
  w <- numeric(length(flows))
  for (i in seq_along(flows)) {
    w[i] <- get_weight(flows[i], weights)
  }
  w
}

# Compute RMSE for given weights on a dataset
compute_rmse <- function(weights, data) {
  w <- get_weights_vec(data$por_lagged, weights)
  blended <- (1 - w) * data$por_lagged + w * data$ef_estimate
  residuals <- blended - data$lf_discharge
  sqrt(mean(residuals^2))
}

# ---- 5. Coordinate descent optimization -------------------------------------
cat("=== Coordinate Descent Optimization ===\n")
cat("Anchors:", paste(ANCHORS, collapse = ", "), "\n")
cat("W_MIN:", W_MIN, " W_MAX:", W_MAX, "\n")
cat("Initialization: all zeros (no warm-start bias)\n\n")

# Initialize all weights to 0
weights <- rep(0.0, N_ANCHORS)
best_rmse <- compute_rmse(weights, df_valid)
cat("Initial RMSE (all zeros):", sprintf("%.2f", best_rmse), "cfs\n\n")

# --- Coarse pass: 0.00-0.80 in 0.05 steps, 5 sweeps ---
cat("--- Coarse pass (step=0.05, 5 sweeps) ---\n")
coarse_step <- 0.05
coarse_grid <- seq(W_MIN, W_MAX, by = coarse_step)

for (sweep in 1:5) {
  improved <- FALSE
  for (j in 1:N_ANCHORS) {
    best_wj <- weights[j]
    best_rmse_j <- best_rmse

    for (candidate in coarse_grid) {
      test_weights <- weights
      test_weights[j] <- candidate

      # Enforce forward-only monotonicity: w[i] >= w[i-1]
      valid_mono <- TRUE
      for (k in 2:N_ANCHORS) {
        if (test_weights[k] < test_weights[k-1]) {
          valid_mono <- FALSE
          break
        }
      }
      if (!valid_mono) next

      rmse_test <- compute_rmse(test_weights, df_valid)
      if (rmse_test < best_rmse_j) {
        best_rmse_j <- rmse_test
        best_wj <- candidate
        improved <- TRUE
      }
    }
    weights[j] <- best_wj
    best_rmse <- best_rmse_j
  }
  cat(sprintf("  Sweep %d: RMSE=%.2f  weights=[%s]\n",
              sweep, best_rmse, paste(sprintf("%.2f", weights), collapse=", ")))
  if (!improved) {
    cat("  No improvement in sweep", sweep, "- stopping coarse pass early\n")
    break
  }
}

cat("\nCoarse result:", paste(sprintf("%.2f", weights), collapse=", "), "\n")
cat("Coarse RMSE:", sprintf("%.2f", best_rmse), "\n\n")

# --- Fine pass: ±0.05 in 0.01 steps, 3 sweeps ---
cat("--- Fine pass (step=0.01, ±0.05 range, 3 sweeps) ---\n")
fine_step <- 0.01

for (sweep in 1:3) {
  improved <- FALSE
  for (j in 1:N_ANCHORS) {
    lo <- max(W_MIN, weights[j] - 0.05)
    hi <- min(W_MAX, weights[j] + 0.05)
    fine_grid <- seq(lo, hi, by = fine_step)

    best_wj <- weights[j]
    best_rmse_j <- best_rmse

    for (candidate in fine_grid) {
      candidate <- round(candidate, 2)  # ensure 2 decimal precision
      test_weights <- weights
      test_weights[j] <- candidate

      # Enforce forward-only monotonicity
      valid_mono <- TRUE
      for (k in 2:N_ANCHORS) {
        if (test_weights[k] < test_weights[k-1]) {
          valid_mono <- FALSE
          break
        }
      }
      if (!valid_mono) next

      rmse_test <- compute_rmse(test_weights, df_valid)
      if (rmse_test < best_rmse_j) {
        best_rmse_j <- rmse_test
        best_wj <- candidate
        improved <- TRUE
      }
    }
    weights[j] <- best_wj
    best_rmse <- best_rmse_j
  }
  cat(sprintf("  Sweep %d: RMSE=%.2f  weights=[%s]\n",
              sweep, best_rmse, paste(sprintf("%.2f", weights), collapse=", ")))
  if (!improved) {
    cat("  No improvement in sweep", sweep, "- stopping fine pass early\n")
    break
  }
}

cat("\n=== OPTIMAL WEIGHTS ===\n")
for (i in 1:N_ANCHORS) {
  cat(sprintf("  %6d cfs: w = %.2f\n", ANCHORS[i], weights[i]))
}
cat(sprintf("  Optimized RMSE: %.2f cfs\n\n", best_rmse))

# ---- 6. Compare with v29.0 flat 35% ----------------------------------------
cat("=== Comparison with v29.0 (flat 35% above 3k) ===\n")
v29_weights <- c(0.00, 0.00, 0.35, 0.35, 0.35, 0.35, 0.35)  # 0% at 0 and 3k, 35% at 6k+
# Actually v29 is: 0% below 3k, 35% above 3k (step function)
# With piecewise linear on these anchors: w=0 at 0, w=0 at 3000, w=0.35 at 6000...
# Wait - v29 is flat step: 0% below 3k, 35% above 3k
# With anchor interpolation: 0 at 0, 0 at 3000 (still below), then jump to 35% at 6000+
# But actually in v29, the step is AT 3k, so need to model it as:
# 0 at 0, step to 0.35 at 3000, stays 0.35
# With our anchor system, closest is: [0, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35]
# which gives 0 at flow=0, linearly ramping to 0.35 at flow=3000, then flat 0.35
v29_step <- function(flow) {
  ifelse(flow < 3000, 0.0, 0.35)
}

# Compute v29 RMSE directly with step function
w_v29 <- v29_step(df_valid$por_lagged)
blended_v29 <- (1 - w_v29) * df_valid$por_lagged + w_v29 * df_valid$ef_estimate
rmse_v29 <- sqrt(mean((blended_v29 - df_valid$lf_discharge)^2))

cat(sprintf("v29.0 flat 35%% RMSE: %.2f cfs\n", rmse_v29))
cat(sprintf("New optimized RMSE:  %.2f cfs\n", best_rmse))
cat(sprintf("Improvement: %.2f cfs (%.1f%%)\n\n", rmse_v29 - best_rmse,
            100 * (rmse_v29 - best_rmse) / rmse_v29))

# Also compute PoR-only baseline (w=0 everywhere)
w_zero <- rep(0, nrow(df_valid))
blended_zero <- df_valid$por_lagged
rmse_zero <- sqrt(mean((blended_zero - df_valid$lf_discharge)^2))
cat(sprintf("PoR-only baseline RMSE: %.2f cfs\n\n", rmse_zero))

# ---- 7. RMSE by flow regime -------------------------------------------------
cat("=== RMSE by Flow Regime ===\n")
regimes <- list(
  "<3k"    = df_valid$por_lagged < 3000,
  "3-6k"   = df_valid$por_lagged >= 3000 & df_valid$por_lagged < 6000,
  "6-10k"  = df_valid$por_lagged >= 6000 & df_valid$por_lagged < 10000,
  "10-15k" = df_valid$por_lagged >= 10000 & df_valid$por_lagged < 15000,
  "15-25k" = df_valid$por_lagged >= 15000 & df_valid$por_lagged < 25000,
  "25-50k" = df_valid$por_lagged >= 25000 & df_valid$por_lagged < 50000,
  ">50k"   = df_valid$por_lagged >= 50000
)

cat(sprintf("%-10s %8s %12s %12s %12s %10s\n", "Regime", "N", "RMSE_new", "RMSE_v29", "RMSE_PoR", "Improv%"))
cat(paste(rep("-", 70), collapse=""), "\n")

for (name in names(regimes)) {
  mask <- regimes[[name]]
  n <- sum(mask)
  if (n == 0) {
    cat(sprintf("%-10s %8d %12s %12s %12s %10s\n", name, 0, "N/A", "N/A", "N/A", "N/A"))
    next
  }
  sub <- df_valid[mask, ]

  # New optimized
  w_new <- get_weights_vec(sub$por_lagged, weights)
  blend_new <- (1 - w_new) * sub$por_lagged + w_new * sub$ef_estimate
  rmse_new <- sqrt(mean((blend_new - sub$lf_discharge)^2))

  # v29
  w_v29_sub <- v29_step(sub$por_lagged)
  blend_v29 <- (1 - w_v29_sub) * sub$por_lagged + w_v29_sub * sub$ef_estimate
  rmse_v29_sub <- sqrt(mean((blend_v29 - sub$lf_discharge)^2))

  # PoR only
  rmse_por <- sqrt(mean((sub$por_lagged - sub$lf_discharge)^2))

  improv <- 100 * (rmse_v29_sub - rmse_new) / rmse_v29_sub

  cat(sprintf("%-10s %8d %12.2f %12.2f %12.2f %9.1f%%\n",
              name, n, rmse_new, rmse_v29_sub, rmse_por, improv))
}

# ---- 8. Leave-one-year-out cross-validation ----------------------------------
cat("\n=== Leave-One-Year-Out Cross-Validation ===\n")
cv_years <- 2012:2025  # Skip 2026 partial

cat(sprintf("%-6s %8s %12s %12s %12s %10s\n", "Year", "N_test", "RMSE_cv", "RMSE_v29", "RMSE_PoR", "Improv%"))
cat(paste(rep("-", 65), collapse=""), "\n")

cv_rmses <- numeric(0)
cv_v29_rmses <- numeric(0)
cv_ns <- numeric(0)

for (yr in cv_years) {
  train <- df_valid[df_valid$year != yr, ]
  test <- df_valid[df_valid$year == yr, ]

  if (nrow(test) == 0) {
    cat(sprintf("%-6d %8d %12s\n", yr, 0, "SKIP (no data)"))
    next
  }

  # Re-optimize on training set
  cv_weights <- rep(0.0, N_ANCHORS)
  cv_best_rmse <- compute_rmse(cv_weights, train)

  # Coarse pass
  for (sweep in 1:5) {
    for (j in 1:N_ANCHORS) {
      best_wj <- cv_weights[j]
      best_rmse_j <- cv_best_rmse
      for (candidate in coarse_grid) {
        test_w <- cv_weights
        test_w[j] <- candidate
        ok <- TRUE
        for (k in 2:N_ANCHORS) {
          if (test_w[k] < test_w[k-1]) { ok <- FALSE; break }
        }
        if (!ok) next
        r <- compute_rmse(test_w, train)
        if (r < best_rmse_j) { best_rmse_j <- r; best_wj <- candidate }
      }
      cv_weights[j] <- best_wj
      cv_best_rmse <- best_rmse_j
    }
  }

  # Fine pass
  for (sweep in 1:3) {
    for (j in 1:N_ANCHORS) {
      lo <- max(W_MIN, cv_weights[j] - 0.05)
      hi <- min(W_MAX, cv_weights[j] + 0.05)
      fg <- seq(lo, hi, by = fine_step)
      best_wj <- cv_weights[j]
      best_rmse_j <- cv_best_rmse
      for (candidate in fg) {
        candidate <- round(candidate, 2)
        test_w <- cv_weights
        test_w[j] <- candidate
        ok <- TRUE
        for (k in 2:N_ANCHORS) {
          if (test_w[k] < test_w[k-1]) { ok <- FALSE; break }
        }
        if (!ok) next
        r <- compute_rmse(test_w, train)
        if (r < best_rmse_j) { best_rmse_j <- r; best_wj <- candidate }
      }
      cv_weights[j] <- best_wj
      cv_best_rmse <- best_rmse_j
    }
  }

  # Evaluate on held-out year
  w_cv <- get_weights_vec(test$por_lagged, cv_weights)
  blend_cv <- (1 - w_cv) * test$por_lagged + w_cv * test$ef_estimate
  rmse_cv <- sqrt(mean((blend_cv - test$lf_discharge)^2))

  # v29 on test
  w_v29_test <- v29_step(test$por_lagged)
  blend_v29_test <- (1 - w_v29_test) * test$por_lagged + w_v29_test * test$ef_estimate
  rmse_v29_test <- sqrt(mean((blend_v29_test - test$lf_discharge)^2))

  # PoR only on test
  rmse_por_test <- sqrt(mean((test$por_lagged - test$lf_discharge)^2))

  improv <- 100 * (rmse_v29_test - rmse_cv) / rmse_v29_test

  cat(sprintf("%-6d %8d %12.2f %12.2f %12.2f %9.1f%%  w=[%s]\n",
              yr, nrow(test), rmse_cv, rmse_v29_test, rmse_por_test, improv,
              paste(sprintf("%.2f", cv_weights), collapse=",")))

  cv_rmses <- c(cv_rmses, rmse_cv)
  cv_v29_rmses <- c(cv_v29_rmses, rmse_v29_test)
  cv_ns <- c(cv_ns, nrow(test))
}

# Weighted average CV RMSE
cv_total_n <- sum(cv_ns)
cv_weighted_rmse <- sqrt(sum(cv_ns * cv_rmses^2) / cv_total_n)
cv_weighted_v29 <- sqrt(sum(cv_ns * cv_v29_rmses^2) / cv_total_n)
cat(sprintf("\nWeighted avg CV RMSE (new): %.2f cfs\n", cv_weighted_rmse))
cat(sprintf("Weighted avg CV RMSE (v29): %.2f cfs\n", cv_weighted_v29))
cat(sprintf("CV improvement: %.2f cfs (%.1f%%)\n\n",
            cv_weighted_v29 - cv_weighted_rmse,
            100 * (cv_weighted_v29 - cv_weighted_rmse) / cv_weighted_v29))

# ---- 9. Save results --------------------------------------------------------
output_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/gradient_weights_117k_R.csv"

results <- data.frame(
  anchor_flow = ANCHORS,
  optimal_weight = weights,
  stringsAsFactors = FALSE
)

# Add metadata as attributes in comments
cat("=== Saving results to", output_path, "===\n")
write.csv(results, output_path, row.names = FALSE)

# Also save a comprehensive summary
summary_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/gradient_weights_117k_R_summary.txt"
sink(summary_path)
cat("Gradient Weight Optimization Results (R, 117k hourly dataset)\n")
cat("==============================================================\n")
cat("Date:", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "\n")
cat("Dataset:", data_path, "\n")
cat("Total rows:", nrow(df), "\n")
cat("Valid rows:", nrow(df_valid), "\n")
cat("Date range:", format(min(df$timestamp, na.rm=TRUE)), "to", format(max(df$timestamp, na.rm=TRUE)), "\n\n")

cat("OPTIMAL WEIGHTS:\n")
for (i in 1:N_ANCHORS) {
  cat(sprintf("  %6d cfs: w = %.2f\n", ANCHORS[i], weights[i]))
}
cat(sprintf("\nOverall RMSE (optimized): %.2f cfs\n", best_rmse))
cat(sprintf("Overall RMSE (v29 flat 35%%): %.2f cfs\n", rmse_v29))
cat(sprintf("Overall RMSE (PoR-only): %.2f cfs\n", rmse_zero))
cat(sprintf("Improvement over v29: %.2f cfs (%.1f%%)\n", rmse_v29 - best_rmse,
            100 * (rmse_v29 - best_rmse) / rmse_v29))
cat(sprintf("\nCV weighted RMSE (optimized): %.2f cfs\n", cv_weighted_rmse))
cat(sprintf("CV weighted RMSE (v29): %.2f cfs\n", cv_weighted_v29))
cat(sprintf("CV improvement: %.2f cfs (%.1f%%)\n",
            cv_weighted_v29 - cv_weighted_rmse,
            100 * (cv_weighted_v29 - cv_weighted_rmse) / cv_weighted_v29))
sink()

cat("\nResults saved to:", output_path, "\n")
cat("Summary saved to:", summary_path, "\n")
cat("\n=== DONE ===\n")
cat("Finished:", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "\n")

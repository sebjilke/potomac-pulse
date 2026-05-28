#!/usr/bin/env Rscript
# validate_travel_time_R.R
# ---------------------------------------------------------
# Validate the 0.80 Searcy travel-time correction factor
# using 117,704 hourly observations of PoR and LF discharge.
#
# Searcy (1961) original model:
#   T_original = 5174 * Q^(-0.5963)  [hours]
#
# Current app correction (0.80):
#   T_corrected = 4139 * Q^(-0.5963)
#
# This script uses cross-correlation by flow regime to
# empirically determine actual travel times, then fits a
# power law to derive a correction factor with bootstrap CI.
# ---------------------------------------------------------

set.seed(42)

# =========================================================
# 1. Load data
# =========================================================
cat("=" , rep("=", 69), "\n", sep = "")
cat("TRAVEL TIME VALIDATION — R\n")
cat("=" , rep("=", 69), "\n\n", sep = "")

data_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
cat("Loading data from:", data_path, "\n")
df <- read.csv(data_path, stringsAsFactors = FALSE)
cat("  Raw rows:", nrow(df), "\n")
cat("  Columns:", paste(names(df), collapse = ", "), "\n\n")

# Parse timestamps — try multiple formats
raw_ts <- df$timestamp
df$timestamp <- as.POSIXct(raw_ts, format = "%Y-%m-%d %H:%M", tz = "UTC")
if (all(is.na(df$timestamp))) {
  df$timestamp <- as.POSIXct(raw_ts, format = "%Y-%m-%d %H:%M:%S", tz = "UTC")
}
if (all(is.na(df$timestamp))) {
  df$timestamp <- as.POSIXct(raw_ts, format = "%Y-%m-%dT%H:%M:%S", tz = "UTC")
}
cat("  Parsed timestamps, NA count:", sum(is.na(df$timestamp)), "\n")

# Filter to valid rows
valid <- !is.na(df$por_now) & !is.na(df$lf_discharge) &
         df$por_now > 0 & df$lf_discharge > 0 & !is.na(df$timestamp)
df <- df[valid, ]
cat("  Valid rows (por_now > 0 & lf_discharge > 0):", nrow(df), "\n\n")

# Sort by timestamp
df <- df[order(df$timestamp), ]

# =========================================================
# 2. Check regularity of hourly spacing
# =========================================================
cat("Checking timestamp regularity...\n")
diffs_sec <- as.numeric(diff(df$timestamp), units = "secs")
unique_diffs <- sort(unique(diffs_sec))
cat("  Unique time differences (seconds):", head(unique_diffs, 20), "\n")
cat("  Number of 3600s (1h) gaps:", sum(diffs_sec == 3600), "\n")
cat("  Number of non-3600s gaps:", sum(diffs_sec != 3600), "\n")

# Determine if we can use simple index arithmetic
use_index_arithmetic <- all(diffs_sec == 3600)
if (use_index_arithmetic) {
  cat("  --> Data is perfectly regular hourly. Using index arithmetic.\n\n")
} else {
  cat("  --> Data has gaps. Using timestamp-based matching.\n\n")
  # Build a lookup: timestamp -> row index
  ts_strings <- format(df$timestamp, "%Y-%m-%d %H:%M:%S")
  ts_to_idx <- setNames(seq_len(nrow(df)), ts_strings)
}

# =========================================================
# 3. Define flow regimes
# =========================================================
regimes <- list(
  list(name = "<2000",        lo = 0,      hi = 2000,   midpoint = 1000),
  list(name = "2000-5000",    lo = 2000,   hi = 5000,   midpoint = sqrt(2000 * 5000)),
  list(name = "5000-10000",   lo = 5000,   hi = 10000,  midpoint = sqrt(5000 * 10000)),
  list(name = "10000-20000",  lo = 10000,  hi = 20000,  midpoint = sqrt(10000 * 20000)),
  list(name = "20000-50000",  lo = 20000,  hi = 50000,  midpoint = sqrt(20000 * 50000)),
  list(name = "50000-100000", lo = 50000,  hi = 100000, midpoint = sqrt(50000 * 100000)),
  list(name = ">100000",      lo = 100000, hi = Inf,    midpoint = 150000)
)

# Searcy original model
searcy_A <- 5174
searcy_B <- -0.5963
searcy_travel <- function(Q) searcy_A * Q^searcy_B

# Lag range to search
lag_min <- 4
lag_max <- 50
lags <- seq(lag_min, lag_max, by = 1)

# =========================================================
# 4. Cross-correlation by flow regime
# =========================================================
cat("Computing cross-correlations by flow regime...\n")
cat("  Lag range: ", lag_min, " to ", lag_max, " hours\n\n", sep = "")

# Compute first differences to isolate wave propagation signal
# Raw cross-correlation of discharge levels is dominated by shared baseflow
# First-differencing removes baseflow and highlights the pulse/wave arrival
df$por_diff <- c(NA, diff(df$por_now))
df$lf_diff  <- c(NA, diff(df$lf_discharge))

por_vals    <- df$por_now
por_diffs   <- df$por_diff
lf_diffs    <- df$lf_diff
n_total     <- nrow(df)

cat("Using first differences (delta discharge) for cross-correlation\n")
cat("This isolates wave propagation signal from shared baseflow\n\n")

results <- data.frame(
  regime            = character(),
  flow_midpoint_cfs = numeric(),
  n_pairs           = integer(),
  optimal_lag_h     = integer(),
  peak_correlation  = numeric(),
  searcy_predicted_h = numeric(),
  ratio_empirical_to_searcy = numeric(),
  pct_difference    = numeric(),
  stringsAsFactors  = FALSE
)

for (reg in regimes) {
  cat(sprintf("  Regime: %s cfs\n", reg$name))

  # Select indices where PoR flow is in this regime AND has nonzero first diff
  if (is.finite(reg$hi)) {
    regime_mask <- por_vals >= reg$lo & por_vals < reg$hi &
                   !is.na(por_diffs) & por_diffs != 0
  } else {
    regime_mask <- por_vals >= reg$lo &
                   !is.na(por_diffs) & por_diffs != 0
  }
  regime_indices <- which(regime_mask)
  cat(sprintf("    PoR readings with flow changes: %d\n", length(regime_indices)))

  if (length(regime_indices) < 30) {
    cat("    WARNING: Too few observations, skipping.\n\n")
    next
  }

  best_lag  <- NA
  best_corr <- -Inf
  best_n    <- 0
  all_lags  <- list()

  for (lag in lags) {
    if (use_index_arithmetic) {
      shifted_indices <- regime_indices + lag
      valid_pairs <- shifted_indices <= n_total
      por_subset <- por_diffs[regime_indices[valid_pairs]]
      lf_subset  <- lf_diffs[shifted_indices[valid_pairs]]
    } else {
      target_times <- df$timestamp[regime_indices] + lag * 3600
      target_strings <- format(target_times, "%Y-%m-%d %H:%M:%S")
      matched_idx <- ts_to_idx[target_strings]
      valid_pairs <- !is.na(matched_idx)
      por_subset <- por_diffs[regime_indices[valid_pairs]]
      lf_subset  <- lf_diffs[as.integer(matched_idx[valid_pairs])]
    }

    # Filter NAs
    both_valid <- !is.na(por_subset) & !is.na(lf_subset)
    n_pairs <- sum(both_valid)
    if (n_pairs < 20) next

    r <- cor(por_subset[both_valid], lf_subset[both_valid], use = "complete.obs")
    all_lags[[length(all_lags) + 1]] <- c(lag = lag, r = r, n = n_pairs)
    if (!is.na(r) && r > best_corr) {
      best_corr <- r
      best_lag  <- lag
      best_n    <- n_pairs
    }
  }

  if (is.na(best_lag)) {
    cat("    No valid lag found, skipping.\n\n")
    next
  }

  searcy_pred <- searcy_travel(reg$midpoint)
  ratio <- best_lag / searcy_pred
  pct_diff <- (best_lag - searcy_pred) / searcy_pred * 100

  # Print top-5 lags
  all_lags_df <- do.call(rbind, all_lags)
  top5 <- head(all_lags_df[order(-all_lags_df[, "r"]), , drop = FALSE], 5)
  cat(sprintf("    Optimal lag: %d h  (r = %.4f, n = %d)\n", best_lag, best_corr, best_n))
  cat(sprintf("    Top-5 lags: %s\n",
      paste(sprintf("%dh(%.4f)", top5[, "lag"], top5[, "r"]), collapse = ", ")))
  cat(sprintf("    Searcy predicted: %.1f h\n", searcy_pred))
  cat(sprintf("    Ratio (empirical/Searcy): %.3f\n", ratio))
  cat(sprintf("    Pct difference: %+.1f%%\n\n", pct_diff))

  results <- rbind(results, data.frame(
    regime            = reg$name,
    flow_midpoint_cfs = reg$midpoint,
    n_pairs           = best_n,
    optimal_lag_h     = best_lag,
    peak_correlation  = round(best_corr, 6),
    searcy_predicted_h = round(searcy_pred, 2),
    ratio_empirical_to_searcy = round(ratio, 4),
    pct_difference    = round(pct_diff, 2),
    stringsAsFactors  = FALSE
  ))
}

cat("=" , rep("=", 69), "\n", sep = "")
cat("REGIME RESULTS SUMMARY\n")
cat("=" , rep("=", 69), "\n")
print(results, row.names = FALSE)
cat("\n")

# =========================================================
# 5. Fit power law: T = A * Q^B via log-linear OLS
# =========================================================
cat("=" , rep("=", 69), "\n", sep = "")
cat("POWER LAW FIT\n")
cat("=" , rep("=", 69), "\n\n", sep = "")

log_flow <- log(results$flow_midpoint_cfs)
log_time <- log(results$optimal_lag_h)

fit <- lm(log_time ~ log_flow)
s <- summary(fit)

fitted_logA <- coef(fit)[1]
fitted_B    <- coef(fit)[2]
fitted_A    <- exp(fitted_logA)
r_squared   <- s$r.squared

correction_factor <- fitted_A / searcy_A

cat(sprintf("  Fitted model: T = %.2f * Q^(%.4f)\n", fitted_A, fitted_B))
cat(sprintf("  Searcy model: T = %.2f * Q^(%.4f)\n", searcy_A, searcy_B))
cat(sprintf("  R-squared: %.4f\n", r_squared))
cat(sprintf("  Correction factor (A / %d): %.4f\n", searcy_A, correction_factor))
cat(sprintf("  Exponent comparison: fitted B = %.4f vs Searcy B = %.4f\n", fitted_B, searcy_B))
cat(sprintf("  Exponent difference: %+.4f\n\n", fitted_B - searcy_B))

# Print OLS details
cat("  OLS regression details:\n")
cat(sprintf("    log(A) = %.4f (SE = %.4f)\n", fitted_logA, s$coefficients[1, 2]))
cat(sprintf("    B      = %.4f (SE = %.4f)\n", fitted_B, s$coefficients[2, 2]))
cat(sprintf("    Residual SE = %.4f on %d df\n\n", s$sigma, s$df[2]))

# =========================================================
# 6. Bootstrap 95% CI on correction factor
# =========================================================
cat("=" , rep("=", 69), "\n", sep = "")
cat("BOOTSTRAP 95% CI (1000 iterations, regime-level resample)\n")
cat("=" , rep("=", 69), "\n\n", sep = "")

n_boot <- 1000
n_regimes <- nrow(results)
boot_corrections <- numeric(n_boot)
boot_A <- numeric(n_boot)
boot_B <- numeric(n_boot)

for (b in seq_len(n_boot)) {
  idx <- sample(seq_len(n_regimes), n_regimes, replace = TRUE)
  boot_logflow <- log(results$flow_midpoint_cfs[idx])
  boot_logtime <- log(results$optimal_lag_h[idx])

  # Check for degenerate samples (all same point)
  if (length(unique(idx)) < 2) {
    boot_corrections[b] <- NA
    boot_A[b] <- NA
    boot_B[b] <- NA
    next
  }

  boot_fit <- lm(boot_logtime ~ boot_logflow)
  bA <- exp(coef(boot_fit)[1])
  bB <- coef(boot_fit)[2]
  boot_A[b] <- bA
  boot_B[b] <- bB
  boot_corrections[b] <- bA / searcy_A
}

# Remove NAs from degenerate samples
valid_boot <- !is.na(boot_corrections)
cat(sprintf("  Valid bootstrap samples: %d / %d\n", sum(valid_boot), n_boot))

ci <- quantile(boot_corrections[valid_boot], probs = c(0.025, 0.975))
ci_lower <- ci[1]
ci_upper <- ci[2]
boot_mean <- mean(boot_corrections[valid_boot])
boot_median <- median(boot_corrections[valid_boot])

cat(sprintf("  Bootstrap correction factor:\n"))
cat(sprintf("    Mean:   %.4f\n", boot_mean))
cat(sprintf("    Median: %.4f\n", boot_median))
cat(sprintf("    95%% CI: [%.4f, %.4f]\n\n", ci_lower, ci_upper))

ci_B <- quantile(boot_B[valid_boot], probs = c(0.025, 0.975))
cat(sprintf("  Bootstrap exponent B:\n"))
cat(sprintf("    Mean:   %.4f\n", mean(boot_B[valid_boot])))
cat(sprintf("    95%% CI: [%.4f, %.4f]\n\n", ci_B[1], ci_B[2]))

# =========================================================
# 7. Interpretation
# =========================================================
cat("=" , rep("=", 69), "\n", sep = "")
cat("INTERPRETATION\n")
cat("=" , rep("=", 69), "\n\n", sep = "")

cat(sprintf("  The empirical correction factor is %.4f\n", correction_factor))
cat(sprintf("  The app currently uses 0.80\n"))
if (ci_lower <= 0.80 && 0.80 <= ci_upper) {
  cat("  --> 0.80 is WITHIN the 95%% bootstrap CI.\n")
  cat("  --> The current correction factor is empirically supported.\n\n")
} else if (0.80 < ci_lower) {
  cat(sprintf("  --> 0.80 is BELOW the 95%% CI [%.4f, %.4f].\n", ci_lower, ci_upper))
  cat("  --> Empirical data suggests a LARGER correction (closer to 1.0).\n\n")
} else {
  cat(sprintf("  --> 0.80 is ABOVE the 95%% CI [%.4f, %.4f].\n", ci_lower, ci_upper))
  cat("  --> Empirical data suggests a SMALLER correction.\n\n")
}

# Compare exponents
cat(sprintf("  Exponent check:\n"))
cat(sprintf("    Searcy B  = %.4f\n", searcy_B))
cat(sprintf("    Fitted B  = %.4f\n", fitted_B))
cat(sprintf("    If B is similar, the Searcy functional form is valid and only\n"))
cat(sprintf("    the coefficient (speed) needs adjustment.\n\n"))

# =========================================================
# 8. Save results to CSV
# =========================================================
output_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/validate_travel_time_R.csv"

# Regime-level rows
out_df <- results

# Add summary row
summary_row <- data.frame(
  regime            = "SUMMARY",
  flow_midpoint_cfs = NA,
  n_pairs           = sum(results$n_pairs),
  optimal_lag_h     = NA,
  peak_correlation  = NA,
  searcy_predicted_h = NA,
  ratio_empirical_to_searcy = round(correction_factor, 4),
  pct_difference    = NA,
  stringsAsFactors  = FALSE
)
out_df <- rbind(out_df, summary_row)

# Add metadata columns for the summary row
# We store fitted_A, fitted_B, correction_factor, ci_lower, ci_upper, r_squared
# in additional columns that are NA for regime rows
out_df$fitted_A           <- NA
out_df$fitted_B           <- NA
out_df$correction_factor  <- NA
out_df$ci_lower           <- NA
out_df$ci_upper           <- NA
out_df$r_squared          <- NA

summary_idx <- nrow(out_df)
out_df$fitted_A[summary_idx]          <- round(fitted_A, 4)
out_df$fitted_B[summary_idx]          <- round(fitted_B, 4)
out_df$correction_factor[summary_idx] <- round(correction_factor, 4)
out_df$ci_lower[summary_idx]          <- round(ci_lower, 4)
out_df$ci_upper[summary_idx]          <- round(ci_upper, 4)
out_df$r_squared[summary_idx]         <- round(r_squared, 4)

write.csv(out_df, output_path, row.names = FALSE)
cat(sprintf("Results saved to: %s\n\n", output_path))

# =========================================================
# 9. Final summary table (stdout)
# =========================================================
cat("=" , rep("=", 69), "\n", sep = "")
cat("FINAL SUMMARY TABLE\n")
cat("=" , rep("=", 69), "\n\n", sep = "")

cat(sprintf("%-16s %10s %8s %8s %8s %10s %8s %8s\n",
            "Regime", "Midpoint", "N_pairs", "Emp_lag", "Corr",
            "Searcy_T", "Ratio", "Pct_diff"))
cat(sprintf("%-16s %10s %8s %8s %8s %10s %8s %8s\n",
            "----------------", "----------", "--------", "--------", "--------",
            "----------", "--------", "--------"))

for (i in seq_len(nrow(results))) {
  r <- results[i, ]
  cat(sprintf("%-16s %10.0f %8d %8d %8.4f %10.2f %8.4f %+7.1f%%\n",
              r$regime, r$flow_midpoint_cfs, r$n_pairs, r$optimal_lag_h,
              r$peak_correlation, r$searcy_predicted_h,
              r$ratio_empirical_to_searcy, r$pct_difference))
}

cat("\n")
cat(sprintf("Power law fit:  T = %.2f * Q^(%.4f)   R² = %.4f\n", fitted_A, fitted_B, r_squared))
cat(sprintf("Searcy model:   T = %.2f * Q^(%.4f)\n", searcy_A, searcy_B))
cat(sprintf("Correction factor (A/5174): %.4f   95%% CI: [%.4f, %.4f]\n",
            correction_factor, ci_lower, ci_upper))
cat(sprintf("Current app value: 0.80\n"))
cat(sprintf("Validation: %s\n\n",
            ifelse(ci_lower <= 0.80 && 0.80 <= ci_upper,
                   "0.80 is WITHIN the 95% CI — SUPPORTED",
                   "0.80 is OUTSIDE the 95% CI — REVIEW NEEDED")))

cat("Done.\n")

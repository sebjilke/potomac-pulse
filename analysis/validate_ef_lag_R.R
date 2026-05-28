#!/usr/bin/env Rscript
# =============================================================================
# validate_ef_lag_R.R
#
# Determines whether adding a time lag to Edwards Ferry (EF) stage readings
# improves Great Falls (GF) flow predictions in the Potomac Pulse model.
#
# EF is ~2 miles upstream of GF. Water takes ~1-2h to cover that distance at
# typical flows. Currently, EF readings are used synchronously (zero lag).
# This script tests lags 0-12h across five flow regimes.
#
# Data: /Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv
#   - 117,704 hourly observations (2011-12 to 2026-02)
#   - Columns: timestamp, por_now, por_lagged, ef_stage, lf_discharge,
#              water_temp_c, travel_time_h
#
# Model: v29.0 power-law EF->CFS conversion
#   Default:    LF = 126 * EF^2.46
#   Cold water: LF = 160 * EF^2.36  (water_temp_c <= 10)
#
# Output: /Users/sebjilke/Desktop/PotomacPulse/analysis/validate_ef_lag_R.csv
#
# Author: Automated analysis for Potomac Pulse
# Date: 2026-02-19
# =============================================================================

set.seed(42)

# =============================================================================
# 1. LOAD AND PREPARE DATA
# =============================================================================

cat("=" , rep("=", 79), "\n", sep = "")
cat("EF LAG VALIDATION ANALYSIS (R)\n")
cat("=", rep("=", 79), "\n\n", sep = "")

data_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
output_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/validate_ef_lag_R.csv"

cat("Loading data from:", data_path, "\n")
raw <- read.csv(data_path, stringsAsFactors = FALSE)
cat("Raw rows loaded:", nrow(raw), "\n")
cat("Columns:", paste(names(raw), collapse = ", "), "\n\n")

# Parse timestamps
raw$ts <- as.POSIXct(raw$timestamp, format = "%Y-%m-%d %H:%M", tz = "UTC")

# Quick data summary
cat("Timestamp range:", format(min(raw$ts, na.rm = TRUE), "%Y-%m-%d %H:%M"),
    "to", format(max(raw$ts, na.rm = TRUE), "%Y-%m-%d %H:%M"), "\n")
cat("Total rows:", nrow(raw), "\n")
cat("Rows with ef_stage > 0:", sum(raw$ef_stage > 0, na.rm = TRUE), "\n")
cat("Rows with lf_discharge > 0:", sum(raw$lf_discharge > 0, na.rm = TRUE), "\n")
cat("Rows with non-NA water_temp_c:", sum(!is.na(raw$water_temp_c)), "\n")
cat("Rows with NA water_temp_c:", sum(is.na(raw$water_temp_c)), "\n\n")

# =============================================================================
# 2. BUILD TIMESTAMP-INDEXED EF LOOKUP
# =============================================================================

# Because there are gaps (~1,104 non-hourly gaps), we use timestamp matching
# rather than index arithmetic. Build a named vector keyed by timestamp string.

cat("Building timestamp-indexed EF stage lookup...\n")

# Create lookup key: character timestamp for exact matching
raw$ts_key <- format(raw$ts, "%Y-%m-%d %H:%M")

# Named vectors for fast lookup
ef_stage_lookup <- setNames(raw$ef_stage, raw$ts_key)
water_temp_lookup <- setNames(raw$water_temp_c, raw$ts_key)

cat("Lookup table size:", length(ef_stage_lookup), "entries\n\n")

# =============================================================================
# 3. HELPER FUNCTIONS
# =============================================================================

# Convert EF stage to LF-equivalent CFS using v29.0 power law
ef_to_cfs <- function(ef_stage, water_temp_c) {
  # Default model: 126 * EF^2.46
  # Cold water model (temp <= 10C): 160 * EF^2.36
  cold <- !is.na(water_temp_c) & water_temp_c <= 10
  cfs <- ifelse(cold, 160 * ef_stage^2.36, 126 * ef_stage^2.46)
  return(cfs)
}

# Look up EF stage at (timestamp - lag_hours), return NA if not found
get_lagged_ef <- function(timestamps_posix, lag_hours, ef_lookup) {
  # Shift timestamps back by lag_hours
  lagged_ts <- timestamps_posix - lag_hours * 3600  # seconds
  lagged_keys <- format(lagged_ts, "%Y-%m-%d %H:%M")

  # Look up in the named vector
  result <- ef_lookup[lagged_keys]
  names(result) <- NULL
  return(result)
}

# Similarly look up water temp at lagged timestamp
get_lagged_temp <- function(timestamps_posix, lag_hours, temp_lookup) {
  lagged_ts <- timestamps_posix - lag_hours * 3600
  lagged_keys <- format(lagged_ts, "%Y-%m-%d %H:%M")

  result <- temp_lookup[lagged_keys]
  names(result) <- NULL
  return(result)
}

# Compute RMSE
rmse <- function(predicted, actual) {
  valid <- !is.na(predicted) & !is.na(actual)
  if (sum(valid) == 0) return(NA_real_)
  sqrt(mean((predicted[valid] - actual[valid])^2))
}

# =============================================================================
# 4. DEFINE FLOW REGIMES
# =============================================================================

regime_labels <- c("<3000", "3000-10000", "10000-25000", "25000-50000", ">50000")
regime_lower  <- c(   -Inf,         3000,          10000,          25000,   50000)
regime_upper  <- c(   3000,        10000,          25000,          50000,     Inf)

# Assign regime to each row
assign_regime <- function(lf) {
  regime <- character(length(lf))
  for (i in seq_along(regime_labels)) {
    mask <- !is.na(lf) & lf >= regime_lower[i] & lf < regime_upper[i]
    regime[mask] <- regime_labels[i]
  }
  # Handle exact upper boundary for last regime
  regime[!is.na(lf) & lf >= 50000] <- ">50000"
  regime[is.na(lf) | regime == ""] <- NA_character_
  return(regime)
}

# Filter to valid rows for analysis
valid_mask <- !is.na(raw$ef_stage) & raw$ef_stage > 0 &
              !is.na(raw$lf_discharge) & raw$lf_discharge > 0
df <- raw[valid_mask, ]
cat("Valid rows (ef_stage > 0 AND lf_discharge > 0):", nrow(df), "\n")

df$regime <- assign_regime(df$lf_discharge)

cat("\nFlow regime distribution:\n")
regime_counts <- table(df$regime)
for (r in regime_labels) {
  ct <- ifelse(r %in% names(regime_counts), regime_counts[r], 0)
  cat(sprintf("  %-15s : %7d rows\n", r, ct))
}
cat("\n")

# Lags to test: 0 through 12 hours, 1-hour steps
lags <- 0:12

# =============================================================================
# 5. PART A: DIRECT EF->LF CROSS-CORRELATION BY FLOW REGIME
# =============================================================================

cat("=", rep("=", 79), "\n", sep = "")
cat("PART A: Direct EF->LF Cross-Correlation by Flow Regime\n")
cat("=", rep("=", 79), "\n\n")

results_a <- data.frame(
  analysis = character(),
  regime = character(),
  lag_h = integer(),
  correlation = numeric(),
  n_pairs = integer(),
  rmse = numeric(),
  rmse_pct_change_vs_lag0 = numeric(),
  stringsAsFactors = FALSE
)

for (r in regime_labels) {
  cat(sprintf("--- Regime: %s ---\n", r))

  regime_mask <- df$regime == r & !is.na(df$regime)
  regime_df <- df[regime_mask, ]

  if (nrow(regime_df) == 0) {
    cat("  No data in this regime. Skipping.\n\n")
    next
  }

  lag0_rmse <- NA_real_

  for (lag in lags) {
    # Look up EF at (t - lag)
    lagged_ef <- get_lagged_ef(regime_df$ts, lag, ef_stage_lookup)
    lagged_temp <- get_lagged_temp(regime_df$ts, lag, water_temp_lookup)

    # Convert to CFS
    lagged_cfs <- ef_to_cfs(lagged_ef, lagged_temp)

    # Valid pairs: both lagged_cfs and lf_discharge available
    valid <- !is.na(lagged_cfs) & lagged_cfs > 0 &
             !is.na(regime_df$lf_discharge) & regime_df$lf_discharge > 0
    n_valid <- sum(valid)

    if (n_valid < 10) {
      cat(sprintf("  Lag %2dh: insufficient pairs (%d). Skipping.\n", lag, n_valid))
      results_a <- rbind(results_a, data.frame(
        analysis = "cross_correlation",
        regime = r,
        lag_h = lag,
        correlation = NA_real_,
        n_pairs = n_valid,
        rmse = NA_real_,
        rmse_pct_change_vs_lag0 = NA_real_,
        stringsAsFactors = FALSE
      ))
      next
    }

    corr <- cor(lagged_cfs[valid], regime_df$lf_discharge[valid])
    this_rmse <- rmse(lagged_cfs[valid], regime_df$lf_discharge[valid])

    if (lag == 0) {
      lag0_rmse <- this_rmse
    }

    pct_change <- ifelse(!is.na(lag0_rmse) & lag0_rmse > 0,
                         (this_rmse - lag0_rmse) / lag0_rmse * 100,
                         NA_real_)

    cat(sprintf("  Lag %2dh: r=%.4f  RMSE=%8.1f  n=%6d  pct_vs_lag0=%+.2f%%\n",
                lag, corr, this_rmse, n_valid, ifelse(is.na(pct_change), 0, pct_change)))

    results_a <- rbind(results_a, data.frame(
      analysis = "cross_correlation",
      regime = r,
      lag_h = lag,
      correlation = round(corr, 6),
      n_pairs = n_valid,
      rmse = round(this_rmse, 2),
      rmse_pct_change_vs_lag0 = round(pct_change, 4),
      stringsAsFactors = FALSE
    ))
  }
  cat("\n")
}

# Summary of Part A: Optimal lag per regime
cat("\n--- Part A Summary: Optimal Lag per Regime (by highest correlation) ---\n")
cat(sprintf("%-15s  %8s  %10s  %10s  %8s\n",
            "Regime", "Best Lag", "Best Corr", "Lag0 Corr", "N pairs"))

for (r in regime_labels) {
  sub <- results_a[results_a$regime == r & !is.na(results_a$correlation), ]
  if (nrow(sub) == 0) {
    cat(sprintf("%-15s  %8s\n", r, "NO DATA"))
    next
  }
  best_idx <- which.max(sub$correlation)
  lag0_row <- sub[sub$lag_h == 0, ]
  lag0_corr <- ifelse(nrow(lag0_row) > 0, lag0_row$correlation, NA_real_)
  cat(sprintf("%-15s  %5dh     %8.4f    %8.4f   %7d\n",
              r, sub$lag_h[best_idx], sub$correlation[best_idx],
              ifelse(is.na(lag0_corr), NA_real_, lag0_corr),
              sub$n_pairs[best_idx]))
}
cat("\n")

# =============================================================================
# 6. PART B: IMPACT ON BLENDED GF ESTIMATE RMSE
# =============================================================================

cat("=", rep("=", 79), "\n", sep = "")
cat("PART B: Impact on Blended GF Estimate RMSE\n")
cat("=", rep("=", 79), "\n\n")

# The blend formula:
#   blended = (1 - ef_weight) * por_lagged + ef_weight * ef_cfs
# where ef_weight = 0.35 when lf_discharge >= 3000, else 0.0
#
# We only evaluate where lf_discharge >= 3000 (where EF has nonzero weight)

blend_mask <- valid_mask & !is.na(raw$lf_discharge) & raw$lf_discharge >= 3000 &
              !is.na(raw$por_lagged)
blend_df <- raw[blend_mask, ]
cat("Rows for blended RMSE analysis (lf_discharge >= 3000, valid por_lagged):",
    nrow(blend_df), "\n\n")

EF_WEIGHT <- 0.35

results_b <- data.frame(
  analysis = character(),
  regime = character(),
  lag_h = integer(),
  correlation = numeric(),
  n_pairs = integer(),
  rmse = numeric(),
  rmse_pct_change_vs_lag0 = numeric(),
  stringsAsFactors = FALSE
)

lag0_blend_rmse <- NA_real_

for (lag in lags) {
  # Look up EF at (t - lag)
  lagged_ef <- get_lagged_ef(blend_df$ts, lag, ef_stage_lookup)
  lagged_temp <- get_lagged_temp(blend_df$ts, lag, water_temp_lookup)

  # Convert to CFS
  lagged_cfs <- ef_to_cfs(lagged_ef, lagged_temp)

  # Compute blended estimate
  blended <- (1 - EF_WEIGHT) * blend_df$por_lagged + EF_WEIGHT * lagged_cfs

  # Valid: need both blended and actual
  valid <- !is.na(blended) & !is.na(blend_df$lf_discharge)
  n_valid <- sum(valid)

  if (n_valid < 10) {
    cat(sprintf("  Lag %2dh: insufficient valid pairs (%d). Skipping.\n", lag, n_valid))
    results_b <- rbind(results_b, data.frame(
      analysis = "blended_rmse",
      regime = "all_ge3000",
      lag_h = lag,
      correlation = NA_real_,
      n_pairs = n_valid,
      rmse = NA_real_,
      rmse_pct_change_vs_lag0 = NA_real_,
      stringsAsFactors = FALSE
    ))
    next
  }

  corr <- cor(blended[valid], blend_df$lf_discharge[valid])
  this_rmse <- rmse(blended[valid], blend_df$lf_discharge[valid])

  if (lag == 0) {
    lag0_blend_rmse <- this_rmse
  }

  pct_change <- ifelse(!is.na(lag0_blend_rmse) & lag0_blend_rmse > 0,
                       (this_rmse - lag0_blend_rmse) / lag0_blend_rmse * 100,
                       NA_real_)

  cat(sprintf("  Lag %2dh: RMSE=%8.1f  r=%.4f  n=%6d  pct_vs_lag0=%+.2f%%\n",
              lag, this_rmse, corr, n_valid, ifelse(is.na(pct_change), 0, pct_change)))

  results_b <- rbind(results_b, data.frame(
    analysis = "blended_rmse",
    regime = "all_ge3000",
    lag_h = lag,
    correlation = round(corr, 6),
    n_pairs = n_valid,
    rmse = round(this_rmse, 2),
    rmse_pct_change_vs_lag0 = round(pct_change, 4),
    stringsAsFactors = FALSE
  ))
}

# Also break blended RMSE down by flow regime (for >= 3000 regimes only)
cat("\n--- Blended RMSE by Flow Regime ---\n\n")

blend_df$regime <- assign_regime(blend_df$lf_discharge)
blend_regimes <- regime_labels[regime_labels != "<3000"]  # Only >= 3000

for (r in blend_regimes) {
  cat(sprintf("--- Regime: %s ---\n", r))

  regime_mask_b <- blend_df$regime == r & !is.na(blend_df$regime)
  regime_blend <- blend_df[regime_mask_b, ]

  if (nrow(regime_blend) == 0) {
    cat("  No data in this regime. Skipping.\n\n")
    next
  }

  lag0_regime_rmse <- NA_real_

  for (lag in lags) {
    lagged_ef <- get_lagged_ef(regime_blend$ts, lag, ef_stage_lookup)
    lagged_temp <- get_lagged_temp(regime_blend$ts, lag, water_temp_lookup)
    lagged_cfs <- ef_to_cfs(lagged_ef, lagged_temp)

    blended <- (1 - EF_WEIGHT) * regime_blend$por_lagged + EF_WEIGHT * lagged_cfs

    valid <- !is.na(blended) & !is.na(regime_blend$lf_discharge)
    n_valid <- sum(valid)

    if (n_valid < 10) {
      results_b <- rbind(results_b, data.frame(
        analysis = "blended_rmse",
        regime = r,
        lag_h = lag,
        correlation = NA_real_,
        n_pairs = n_valid,
        rmse = NA_real_,
        rmse_pct_change_vs_lag0 = NA_real_,
        stringsAsFactors = FALSE
      ))
      next
    }

    corr <- cor(blended[valid], regime_blend$lf_discharge[valid])
    this_rmse <- rmse(blended[valid], regime_blend$lf_discharge[valid])

    if (lag == 0) {
      lag0_regime_rmse <- this_rmse
    }

    pct_change <- ifelse(!is.na(lag0_regime_rmse) & lag0_regime_rmse > 0,
                         (this_rmse - lag0_regime_rmse) / lag0_regime_rmse * 100,
                         NA_real_)

    cat(sprintf("  Lag %2dh: RMSE=%8.1f  r=%.4f  n=%6d  pct_vs_lag0=%+.2f%%\n",
                lag, this_rmse, corr, n_valid,
                ifelse(is.na(pct_change), 0, pct_change)))

    results_b <- rbind(results_b, data.frame(
      analysis = "blended_rmse",
      regime = r,
      lag_h = lag,
      correlation = round(corr, 6),
      n_pairs = n_valid,
      rmse = round(this_rmse, 2),
      rmse_pct_change_vs_lag0 = round(pct_change, 4),
      stringsAsFactors = FALSE
    ))
  }
  cat("\n")
}

# =============================================================================
# 7. PART C: COMPARISON AND DECISION
# =============================================================================

cat("=", rep("=", 79), "\n", sep = "")
cat("PART C: Comparison and Decision\n")
cat("=", rep("=", 79), "\n\n")

# Overall blended RMSE summary
overall_blend <- results_b[results_b$regime == "all_ge3000" & !is.na(results_b$rmse), ]

if (nrow(overall_blend) > 0) {
  lag0_row <- overall_blend[overall_blend$lag_h == 0, ]
  best_idx <- which.min(overall_blend$rmse)
  best_row <- overall_blend[best_idx, ]

  cat("BLENDED GF ESTIMATE (all flows >= 3000 CFS):\n")
  cat(sprintf("  Current (lag=0):  RMSE = %.1f CFS  (r = %.4f, n = %d)\n",
              lag0_row$rmse, lag0_row$correlation, lag0_row$n_pairs))
  cat(sprintf("  Optimal (lag=%dh): RMSE = %.1f CFS  (r = %.4f, n = %d)\n",
              best_row$lag_h, best_row$rmse, best_row$correlation, best_row$n_pairs))

  if (!is.na(best_row$rmse_pct_change_vs_lag0)) {
    cat(sprintf("  RMSE change: %+.2f%%\n", best_row$rmse_pct_change_vs_lag0))
  }

  cat("\n")

  # Decision
  THRESHOLD <- 2.0  # % RMSE improvement threshold
  improvement <- ifelse(!is.na(best_row$rmse_pct_change_vs_lag0),
                        -best_row$rmse_pct_change_vs_lag0, 0)

  cat(sprintf("Decision threshold: >%.1f%% RMSE improvement required\n", THRESHOLD))
  cat(sprintf("Best improvement found: %.2f%%\n", improvement))

  if (improvement > THRESHOLD) {
    cat(sprintf("\n>>> RECOMMENDATION: IMPLEMENT lag of %d hours.\n", best_row$lag_h))
    cat(sprintf("    %.2f%% RMSE improvement exceeds %.1f%% threshold.\n",
                improvement, THRESHOLD))
  } else {
    cat("\n>>> RECOMMENDATION: KEEP current zero-lag configuration.\n")
    if (improvement > 0) {
      cat(sprintf("    %.2f%% improvement does NOT exceed %.1f%% threshold.\n",
                  improvement, THRESHOLD))
    } else {
      cat("    No improvement found from adding lag.\n")
    }
  }
} else {
  cat("ERROR: No valid blended RMSE results to compare.\n")
}

# Per-regime blended summary
cat("\n\n--- Per-Regime Blended RMSE Summary ---\n")
cat(sprintf("%-15s  %8s  %10s  %10s  %12s\n",
            "Regime", "Best Lag", "Best RMSE", "Lag0 RMSE", "Improvement"))

for (r in blend_regimes) {
  sub <- results_b[results_b$regime == r & !is.na(results_b$rmse), ]
  if (nrow(sub) == 0) {
    cat(sprintf("%-15s  %8s\n", r, "NO DATA"))
    next
  }
  best_idx <- which.min(sub$rmse)
  lag0_row <- sub[sub$lag_h == 0, ]
  lag0_rmse_val <- ifelse(nrow(lag0_row) > 0, lag0_row$rmse, NA_real_)

  imp <- ifelse(!is.na(lag0_rmse_val) & lag0_rmse_val > 0 & !is.na(sub$rmse[best_idx]),
                (lag0_rmse_val - sub$rmse[best_idx]) / lag0_rmse_val * 100, NA_real_)

  cat(sprintf("%-15s  %5dh     %8.1f    %8.1f     %+.2f%%\n",
              r, sub$lag_h[best_idx], sub$rmse[best_idx],
              ifelse(is.na(lag0_rmse_val), NA_real_, lag0_rmse_val),
              ifelse(is.na(imp), 0, imp)))
}

# =============================================================================
# 8. PART A OPTIMAL LAG PER REGIME (by lowest RMSE)
# =============================================================================

cat("\n\n--- Part A: Optimal Lag per Regime (by lowest RMSE) ---\n")
cat(sprintf("%-15s  %8s  %10s  %10s  %12s\n",
            "Regime", "Best Lag", "Best RMSE", "Lag0 RMSE", "Improvement"))

for (r in regime_labels) {
  sub <- results_a[results_a$regime == r & !is.na(results_a$rmse), ]
  if (nrow(sub) == 0) {
    cat(sprintf("%-15s  %8s\n", r, "NO DATA"))
    next
  }
  best_idx <- which.min(sub$rmse)
  lag0_row <- sub[sub$lag_h == 0, ]
  lag0_rmse_val <- ifelse(nrow(lag0_row) > 0, lag0_row$rmse, NA_real_)

  imp <- ifelse(!is.na(lag0_rmse_val) & lag0_rmse_val > 0 & !is.na(sub$rmse[best_idx]),
                (lag0_rmse_val - sub$rmse[best_idx]) / lag0_rmse_val * 100, NA_real_)

  cat(sprintf("%-15s  %5dh     %8.1f    %8.1f     %+.2f%%\n",
              r, sub$lag_h[best_idx], sub$rmse[best_idx],
              ifelse(is.na(lag0_rmse_val), NA_real_, lag0_rmse_val),
              ifelse(is.na(imp), 0, imp)))
}

# =============================================================================
# 9. COMBINE AND SAVE OUTPUT CSV
# =============================================================================

cat("\n\n")
cat("=", rep("=", 79), "\n", sep = "")
cat("SAVING RESULTS\n")
cat("=", rep("=", 79), "\n\n")

all_results <- rbind(results_a, results_b)

cat("Total result rows:", nrow(all_results), "\n")
cat("Output file:", output_path, "\n")

write.csv(all_results, output_path, row.names = FALSE, quote = FALSE)

cat("Results saved successfully.\n\n")

# =============================================================================
# 10. FINAL DIAGNOSTICS
# =============================================================================

cat("=", rep("=", 79), "\n", sep = "")
cat("DIAGNOSTIC CHECKS\n")
cat("=", rep("=", 79), "\n\n")

# Check: How many lookups fail per lag?
cat("Lookup success rate by lag (on full valid dataset, n =", nrow(df), "):\n")
for (lag in c(0, 1, 2, 3, 6, 12)) {
  lagged <- get_lagged_ef(df$ts, lag, ef_stage_lookup)
  n_found <- sum(!is.na(lagged))
  pct <- n_found / nrow(df) * 100
  cat(sprintf("  Lag %2dh: %6d / %6d found (%.1f%%)\n",
              lag, n_found, nrow(df), pct))
}

cat("\n")

# Check: Sanity on EF->CFS conversion at sample points
cat("EF->CFS conversion sanity check:\n")
test_stages <- c(2.0, 4.0, 6.0, 8.0, 10.0, 12.0)
for (s in test_stages) {
  default_cfs <- 126 * s^2.46
  cold_cfs <- 160 * s^2.36
  cat(sprintf("  EF=%.1f ft: default=%7.0f CFS, cold=%7.0f CFS\n",
              s, default_cfs, cold_cfs))
}

cat("\n--- Analysis complete. ---\n")

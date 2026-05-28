#!/usr/bin/env Rscript
# ============================================================================
# analyze_error_distribution_R.R
#
# Analyzes the prediction error distribution for Potomac Pulse v29.0.
# Reconstructs the blended GF estimate from hourly backtest data, computes
# errors (blended - LF actual), and characterizes the distribution by flow
# bin and flow state (rising/steady/falling).
#
# Purpose: Determine whether errors are approximately normal (supporting a
# simple +/- z*sigma CI) or whether empirical quantiles are needed to
# upgrade the app from +/-1sigma (68%) to 90% CI.
#
# Input:  analysis/hourly_backtest_data.csv  (117,704 hourly obs, 2011-2026)
# Output: analysis/error_distribution_R.csv  (per-bin summary statistics)
#
# Dependencies: base R + stats only (no extra packages)
# ============================================================================

set.seed(42)

# ---------- helper: paste without separator ---------------------------------
`%s%` <- function(a, b) paste0(a, b)

cat("=" %s% rep("=", 72) %s% "\n")
cat("Potomac Pulse v29.0 — Error Distribution Analysis (R)\n")
cat("=" %s% rep("=", 72) %s% "\n\n")

# ---------- manual skewness (Fisher) ----------------------------------------
calc_skewness <- function(x) {
  n <- length(x)
  m <- mean(x)
  s <- sd(x)
  if (s == 0 || n < 3) return(NA_real_)
  mean(((x - m) / s)^3)
}

# ---------- manual excess kurtosis ------------------------------------------
calc_kurtosis <- function(x) {
  n <- length(x)
  m <- mean(x)
  s <- sd(x)
  if (s == 0 || n < 3) return(NA_real_)
  mean(((x - m) / s)^4) - 3
}

# ============================================================================
# 1. LOAD DATA
# ============================================================================

data_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
cat("Loading data from:", data_path, "\n")
df <- read.csv(data_path, stringsAsFactors = FALSE)
cat("  Rows loaded:", nrow(df), "\n")
cat("  Columns:", paste(names(df), collapse = ", "), "\n")

# Parse timestamps
df$timestamp <- as.POSIXct(df$timestamp, format = "%Y-%m-%d %H:%M", tz = "UTC")
cat("  Date range:", format(min(df$timestamp, na.rm = TRUE), "%Y-%m-%d"),
    "to", format(max(df$timestamp, na.rm = TRUE), "%Y-%m-%d"), "\n\n")

# ============================================================================
# 2. RECONSTRUCT BLENDED ESTIMATE (v29.0 algorithm)
# ============================================================================

cat("Reconstructing v29.0 blended estimate...\n")

# EF power law: cold-water model when temp <= 10C, default otherwise
df$ef_cfs <- ifelse(!is.na(df$water_temp_c) & df$water_temp_c <= 10,
                    160 * df$ef_stage^2.36,
                    126 * df$ef_stage^2.46)

# EF weight: flat 35% above 3000 cfs, 0% below
df$ef_weight <- ifelse(df$lf_discharge >= 3000, 0.35, 0)

# Blended estimate
df$blended <- (1 - df$ef_weight) * df$por_lagged + df$ef_weight * df$ef_cfs

# Error: positive = overestimate
df$error <- df$blended - df$lf_discharge

# Drop rows where error cannot be computed
valid_mask <- !is.na(df$error) & !is.na(df$lf_discharge)
cat("  Valid observations (non-NA error):", sum(valid_mask), "of", nrow(df), "\n")
df <- df[valid_mask, ]

cat("  Error range: [", round(min(df$error), 1), ",",
    round(max(df$error), 1), "] cfs\n")
cat("  Mean error:", round(mean(df$error), 1), "cfs\n")
cat("  Median error:", round(median(df$error), 1), "cfs\n")
cat("  Std dev:", round(sd(df$error), 1), "cfs\n\n")

# ============================================================================
# 3. FLOW BINS (6 bins matching app)
# ============================================================================

bin_breaks <- c(0, 2000, 5000, 10000, 20000, 50000, Inf)
bin_labels <- c("0-2k", "2-5k", "5-10k", "10-20k", "20-50k", "50k+")
df$flow_bin <- cut(df$lf_discharge,
                   breaks = bin_breaks,
                   labels = bin_labels,
                   right = FALSE,
                   include.lowest = TRUE)

cat("Flow bin distribution:\n")
bin_table <- table(df$flow_bin)
for (i in seq_along(bin_table)) {
  cat(sprintf("  %-8s: %6d obs (%5.1f%%)\n",
              names(bin_table)[i],
              bin_table[i],
              100 * bin_table[i] / nrow(df)))
}
cat("\n")

# ============================================================================
# 4. FLOW STATE CLASSIFICATION (rising / steady / falling)
# ============================================================================

cat("Classifying flow states...\n")

# Change from previous hour
df$lf_change <- c(NA, diff(df$lf_discharge))

# Adaptive threshold: max(100, 2% of current flow)
df$threshold <- pmax(100, df$lf_discharge * 0.02)

# Classify
df$flow_state <- ifelse(is.na(df$lf_change), NA_character_,
                        ifelse(df$lf_change >= df$threshold, "rising",
                               ifelse(df$lf_change <= -df$threshold, "falling",
                                      "steady")))

state_table <- table(df$flow_state, useNA = "ifany")
cat("  Flow state distribution:\n")
for (i in seq_along(state_table)) {
  cat(sprintf("    %-8s: %6d obs (%5.1f%%)\n",
              names(state_table)[i],
              state_table[i],
              100 * state_table[i] / nrow(df)))
}
cat("\n")

# ============================================================================
# 5. PER-BIN ANALYSIS (6 flow x 3 state = up to 18 bins)
# ============================================================================

cat("Analyzing error distribution per bin...\n\n")

# Prepare output data frame
results <- data.frame(
  flow_bin        = character(),
  flow_state      = character(),
  n               = integer(),
  mean_error      = numeric(),
  median_error    = numeric(),
  std_error       = numeric(),
  skewness        = numeric(),
  excess_kurtosis = numeric(),
  shapiro_w       = numeric(),
  shapiro_p       = numeric(),
  q05             = numeric(),
  q10             = numeric(),
  q25             = numeric(),
  q50             = numeric(),
  q75             = numeric(),
  q90             = numeric(),
  q95             = numeric(),
  ci90_gaussian   = numeric(),
  ci90_empirical  = numeric(),
  symmetry_ratio  = numeric(),
  normal_plausible = character(),
  stringsAsFactors = FALSE
)

# Also collect "all states" aggregates per flow bin
flow_states_to_analyze <- c("rising", "steady", "falling", "all")

min_obs <- 20

for (fb in bin_labels) {
  for (fs in flow_states_to_analyze) {
    # Subset
    if (fs == "all") {
      mask <- df$flow_bin == fb & !is.na(df$error)
    } else {
      mask <- df$flow_bin == fb & df$flow_state == fs & !is.na(df$flow_state) & !is.na(df$error)
    }
    errs <- df$error[mask]
    n <- length(errs)

    if (n < min_obs) {
      cat(sprintf("  [SKIP] %-8s / %-7s : n=%d (< %d)\n", fb, fs, n, min_obs))
      next
    }

    # Basic statistics
    mu     <- mean(errs)
    med    <- median(errs)
    sigma  <- sd(errs)
    skew   <- calc_skewness(errs)
    kurt   <- calc_kurtosis(errs)

    # Shapiro-Wilk (max 5000 obs)
    if (n <= 5000) {
      sw <- shapiro.test(errs)
    } else {
      sw_sample <- sample(errs, 5000)
      sw <- shapiro.test(sw_sample)
    }

    # Empirical quantiles
    qs <- quantile(errs, probs = c(0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95),
                   names = FALSE)

    # Gaussian 90% CI half-width (1.645 * sigma)
    ci90_gauss <- 1.645 * sigma

    # Empirical 90% CI half-width: max(|5th|, |95th|)
    ci90_emp <- max(abs(qs[1]), abs(qs[7]))

    # Symmetry ratio: |5th percentile| / 95th percentile
    # Values near 1 indicate symmetric tails
    sym_ratio <- if (abs(qs[7]) > 0) abs(qs[1]) / abs(qs[7]) else NA_real_

    # Normality assessment
    # Plausible if: |skew| < 0.5, |kurt| < 1.0, Shapiro p > 0.01,
    #   and Gaussian vs empirical 90% within 15%
    gauss_emp_ratio <- if (ci90_emp > 0) ci90_gauss / ci90_emp else NA_real_
    normal_ok <- (!is.na(skew) && abs(skew) < 0.5 &&
                  !is.na(kurt) && abs(kurt) < 1.0 &&
                  sw$p.value > 0.01 &&
                  !is.na(gauss_emp_ratio) && abs(gauss_emp_ratio - 1) < 0.15)
    normal_label <- ifelse(normal_ok, "yes", "no")

    # Append row
    row <- data.frame(
      flow_bin        = fb,
      flow_state      = fs,
      n               = n,
      mean_error      = round(mu, 2),
      median_error    = round(med, 2),
      std_error       = round(sigma, 2),
      skewness        = round(skew, 4),
      excess_kurtosis = round(kurt, 4),
      shapiro_w       = round(sw$statistic, 6),
      shapiro_p       = signif(sw$p.value, 4),
      q05             = round(qs[1], 2),
      q10             = round(qs[2], 2),
      q25             = round(qs[3], 2),
      q50             = round(qs[4], 2),
      q75             = round(qs[5], 2),
      q90             = round(qs[6], 2),
      q95             = round(qs[7], 2),
      ci90_gaussian   = round(ci90_gauss, 2),
      ci90_empirical  = round(ci90_emp, 2),
      symmetry_ratio  = round(sym_ratio, 4),
      normal_plausible = normal_label,
      stringsAsFactors = FALSE
    )
    results <- rbind(results, row)
  }
}

# ============================================================================
# 6. PRINT SUMMARY TABLES
# ============================================================================

cat("\n")
cat("=" %s% rep("=", 72) %s% "\n")
cat("SUMMARY: Error Distribution by Flow Bin (All States Combined)\n")
cat("=" %s% rep("=", 72) %s% "\n\n")

all_states <- results[results$flow_state == "all", ]

cat(sprintf("%-8s %6s %9s %9s %9s %8s %8s %8s %7s\n",
            "Bin", "N", "Mean", "Median", "StdDev",
            "Skew", "Kurt", "Shap.p", "Normal?"))
cat(paste(rep("-", 78), collapse = ""), "\n")
for (i in seq_len(nrow(all_states))) {
  r <- all_states[i, ]
  cat(sprintf("%-8s %6d %9.1f %9.1f %9.1f %8.3f %8.3f %8s %7s\n",
              r$flow_bin, r$n, r$mean_error, r$median_error, r$std_error,
              r$skewness, r$excess_kurtosis,
              formatC(r$shapiro_p, format = "e", digits = 1),
              r$normal_plausible))
}

cat("\n")
cat(sprintf("%-8s %9s %9s %9s %9s %9s\n",
            "Bin", "Q05", "Q50", "Q95", "Gauss90", "Empir90"))
cat(paste(rep("-", 56), collapse = ""), "\n")
for (i in seq_len(nrow(all_states))) {
  r <- all_states[i, ]
  cat(sprintf("%-8s %9.1f %9.1f %9.1f %9.1f %9.1f\n",
              r$flow_bin, r$q05, r$q50, r$q95,
              r$ci90_gaussian, r$ci90_empirical))
}

cat("\n")
cat("=" %s% rep("=", 72) %s% "\n")
cat("SUMMARY: Error Distribution by Flow Bin x Flow State\n")
cat("=" %s% rep("=", 72) %s% "\n\n")

by_state <- results[results$flow_state != "all", ]

cat(sprintf("%-8s %-7s %6s %9s %9s %8s %8s %9s %9s %7s\n",
            "Bin", "State", "N", "Mean", "StdDev",
            "Skew", "Kurt", "Gauss90", "Empir90", "Normal?"))
cat(paste(rep("-", 92), collapse = ""), "\n")
for (i in seq_len(nrow(by_state))) {
  r <- by_state[i, ]
  cat(sprintf("%-8s %-7s %6d %9.1f %9.1f %8.3f %8.3f %9.1f %9.1f %7s\n",
              r$flow_bin, r$flow_state, r$n, r$mean_error, r$std_error,
              r$skewness, r$excess_kurtosis,
              r$ci90_gaussian, r$ci90_empirical,
              r$normal_plausible))
}

# ============================================================================
# 7. SYMMETRY ANALYSIS
# ============================================================================

cat("\n")
cat("=" %s% rep("=", 72) %s% "\n")
cat("SYMMETRY ANALYSIS: |Q05| vs Q95 (ratio near 1.0 = symmetric)\n")
cat("=" %s% rep("=", 72) %s% "\n\n")

cat(sprintf("%-8s %-7s %9s %9s %9s %s\n",
            "Bin", "State", "|Q05|", "Q95", "Ratio", "Assessment"))
cat(paste(rep("-", 62), collapse = ""), "\n")
for (i in seq_len(nrow(results))) {
  r <- results[i, ]
  assess <- if (is.na(r$symmetry_ratio)) {
    "N/A"
  } else if (abs(r$symmetry_ratio - 1) < 0.2) {
    "symmetric"
  } else if (r$symmetry_ratio > 1) {
    "left-heavy (overest.)"
  } else {
    "right-heavy (underest.)"
  }
  cat(sprintf("%-8s %-7s %9.1f %9.1f %9.3f %s\n",
              r$flow_bin, r$flow_state,
              abs(r$q05), abs(r$q95), r$symmetry_ratio, assess))
}

# ============================================================================
# 8. GAUSSIAN vs EMPIRICAL COMPARISON
# ============================================================================

cat("\n")
cat("=" %s% rep("=", 72) %s% "\n")
cat("GAUSSIAN vs EMPIRICAL 90% CI HALF-WIDTH\n")
cat("=" %s% rep("=", 72) %s% "\n\n")

cat(sprintf("%-8s %-7s %9s %9s %9s %s\n",
            "Bin", "State", "Gauss90", "Empir90", "Ratio", "Implication"))
cat(paste(rep("-", 65), collapse = ""), "\n")
for (i in seq_len(nrow(results))) {
  r <- results[i, ]
  ratio <- if (r$ci90_empirical > 0) r$ci90_gaussian / r$ci90_empirical else NA_real_
  impl <- if (is.na(ratio)) {
    "N/A"
  } else if (ratio > 1.10) {
    "Gaussian OVERESTIMATES uncertainty"
  } else if (ratio < 0.90) {
    "Gaussian UNDERESTIMATES uncertainty"
  } else {
    "Gaussian adequate"
  }
  cat(sprintf("%-8s %-7s %9.1f %9.1f %9.3f %s\n",
              r$flow_bin, r$flow_state,
              r$ci90_gaussian, r$ci90_empirical,
              ifelse(is.na(ratio), NA_real_, round(ratio, 3)),
              impl))
}

# ============================================================================
# 9. OVERALL RECOMMENDATION
# ============================================================================

cat("\n")
cat("=" %s% rep("=", 72) %s% "\n")
cat("OVERALL RECOMMENDATION\n")
cat("=" %s% rep("=", 72) %s% "\n\n")

# Count how many "all states" bins pass normality
n_bins_all <- nrow(all_states)
n_normal_all <- sum(all_states$normal_plausible == "yes")

cat(sprintf("Normality check (all-states bins): %d / %d pass\n",
            n_normal_all, n_bins_all))

# Count across all 18 cells
n_total <- nrow(results)
n_normal_total <- sum(results$normal_plausible == "yes")
cat(sprintf("Normality check (all cells):       %d / %d pass\n",
            n_normal_total, n_total))

# Assess worst-case Gaussian vs empirical divergence
all_ratios <- ifelse(results$ci90_empirical > 0,
                     results$ci90_gaussian / results$ci90_empirical,
                     NA_real_)
worst_under <- min(all_ratios, na.rm = TRUE)
worst_over  <- max(all_ratios, na.rm = TRUE)

cat(sprintf("Gaussian/Empirical ratio range:     %.3f to %.3f\n",
            worst_under, worst_over))
cat("\n")

if (n_normal_all == n_bins_all && worst_under >= 0.85) {
  cat("RECOMMENDATION: Errors are approximately normal across all flow bins.\n")
  cat("  -> A Gaussian 90%% CI (mean +/- 1.645*sigma) is adequate.\n")
  cat("  -> Bin-specific sigma values should be used for flow-dependent CIs.\n")
} else if (worst_under >= 0.80) {
  cat("RECOMMENDATION: Errors show moderate departures from normality.\n")
  cat("  -> Gaussian CI is a reasonable approximation but not exact.\n")
  cat("  -> Consider using empirical quantiles for the most skewed bins.\n")
  cat("  -> At minimum, use bin-specific sigma with Gaussian assumption.\n")
} else {
  cat("RECOMMENDATION: Errors show significant departures from normality.\n")
  cat("  -> Empirical quantiles (5th/95th percentiles) should be used for 90%% CI.\n")
  cat("  -> Gaussian assumption would mis-specify uncertainty, especially in\n")
  cat("     bins where the ratio is far from 1.0.\n")
  cat("  -> Store per-bin empirical quantiles in the app and look up by flow level.\n")
}

cat("\n")
cat("For 90%% CI implementation, the app should use:\n")
cat("  Lower bound = blended_estimate + Q05(bin)\n")
cat("  Upper bound = blended_estimate + Q95(bin)\n")
cat("  where Q05/Q95 are the 5th/95th percentiles of the error distribution\n")
cat("  in the relevant flow bin (and optionally flow state).\n")

# ============================================================================
# 10. SAVE OUTPUT CSV
# ============================================================================

out_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/error_distribution_R.csv"
write.csv(results, file = out_path, row.names = FALSE, quote = TRUE)
cat("\nResults saved to:", out_path, "\n")
cat("  Rows:", nrow(results), "\n")
cat("  Columns:", paste(names(results), collapse = ", "), "\n")

cat("\nDone.\n")

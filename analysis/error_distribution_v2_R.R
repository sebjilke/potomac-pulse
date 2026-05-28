#!/usr/bin/env Rscript
# =============================================================================
# Blind Error Distribution Analysis for Potomac Pulse GF Estimation (v30.0+)
# Computes empirical 90% CI quantiles (q05, q95) across 18 bins + aggregates
# Generated: 2026-02-26
# =============================================================================

set.seed(42)

# Manual skewness (type 2 = sample skewness with bias correction, matches e1071)
calc_skewness <- function(x) {
  n <- length(x)
  m <- mean(x)
  s <- sd(x)
  m3 <- mean((x - m)^3)
  g1 <- m3 / s^3
  sqrt(n * (n - 1)) / (n - 2) * g1
}

# Manual excess kurtosis (type 2, matches e1071)
calc_kurtosis <- function(x) {
  n <- length(x)
  m <- mean(x)
  s <- sd(x)
  m4 <- mean((x - m)^4)
  g2 <- m4 / (sd(x)^4 * ((n - 1) / n)^2) - 3
  ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 + 6)
}

# --- Load data ---------------------------------------------------------------
data_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
df <- read.csv(data_path, stringsAsFactors = FALSE)
cat(sprintf("Loaded %d rows, %d columns\n", nrow(df), ncol(df)))
cat(sprintf("Columns: %s\n", paste(names(df), collapse = ", ")))

# --- Basic data checks -------------------------------------------------------
cat(sprintf("Missing por_lagged: %d\n", sum(is.na(df$por_lagged))))
cat(sprintf("Missing ef_stage: %d\n", sum(is.na(df$ef_stage))))
cat(sprintf("Missing lf_discharge: %d\n", sum(is.na(df$lf_discharge))))
cat(sprintf("Missing water_temp_c: %d\n", sum(is.na(df$water_temp_c))))

# Drop rows with missing essential columns
df <- df[!is.na(df$por_lagged) & !is.na(df$ef_stage) & !is.na(df$lf_discharge), ]
cat(sprintf("After dropping NAs in essential columns: %d rows\n", nrow(df)))

# --- Step 1: EF Power-Law estimation ----------------------------------------
# Default: ef_cfs = 126 * ef_stage^2.46
# Cold water (water_temp_c <= 10): ef_cfs = 160 * ef_stage^2.36
# Use default when temp is missing
is_cold <- !is.na(df$water_temp_c) & df$water_temp_c <= 10.0

df$ef_cfs <- ifelse(is_cold,
                    160 * df$ef_stage^2.36,
                    126 * df$ef_stage^2.46)

cat(sprintf("Cold water observations: %d (%.1f%%)\n",
            sum(is_cold), 100 * mean(is_cold)))

# --- Step 2: EF Weight (logistic ramp) --------------------------------------
# ef_weight = 0.40 / (1 + exp(-5.0 * (log(lf_discharge) - log(10000))))
df$ef_weight <- 0.40 / (1 + exp(-5.0 * (log(df$lf_discharge) - log(10000))))

cat(sprintf("EF weight range: [%.4f, %.4f], mean=%.4f\n",
            min(df$ef_weight), max(df$ef_weight), mean(df$ef_weight)))

# --- Step 3: Blended estimate ------------------------------------------------
df$blended <- (1 - df$ef_weight) * df$por_lagged + df$ef_weight * df$ef_cfs

# --- Step 4: Error -----------------------------------------------------------
df$error <- df$blended - df$lf_discharge

cat(sprintf("Error range: [%.1f, %.1f], mean=%.1f, median=%.1f\n",
            min(df$error), max(df$error), mean(df$error), median(df$error)))

# --- Step 5: Flow bins -------------------------------------------------------
bin_breaks <- c(0, 3000, 6000, 12000, 25000, 50000, Inf)
bin_labels <- c("0-3000", "3000-6000", "6000-12000", "12000-25000",
                "25000-50000", "50000+")

df$flow_bin <- cut(df$lf_discharge,
                   breaks = bin_breaks,
                   labels = bin_labels,
                   right = FALSE,
                   include.lowest = TRUE)

cat("\nFlow bin distribution:\n")
print(table(df$flow_bin))

# --- Step 6: Flow state classification ---------------------------------------
df <- df[order(df$timestamp), ]
df$lf_change <- c(0, diff(df$lf_discharge))
df$threshold <- pmax(100, 0.02 * df$lf_discharge)
df$flow_state <- ifelse(df$lf_change >= df$threshold, "rising",
                 ifelse(df$lf_change <= -df$threshold, "falling",
                        "steady"))

cat("\nFlow state distribution:\n")
print(table(df$flow_state))
cat("\nCross-tabulation (flow_bin x flow_state):\n")
print(table(df$flow_bin, df$flow_state))

# --- Step 7: Compute statistics per bin --------------------------------------
analyze_bin <- function(errors, fb, fs) {
  n <- length(errors)

  if (n < 20) {
    return(data.frame(
      flow_bin = fb, flow_state = fs, n = n,
      mean_error = NA, median_error = NA, std_dev = NA,
      skewness = NA, kurtosis = NA, shapiro_p = NA,
      q05 = NA, q10 = NA, q25 = NA, q50 = NA,
      q75 = NA, q90 = NA, q95 = NA,
      normal_q95_approx = NA,
      recommended_method = "insufficient_data",
      stringsAsFactors = FALSE
    ))
  }

  mn <- mean(errors)
  md <- median(errors)
  sd_val <- sd(errors)
  sk <- calc_skewness(errors)
  ku <- calc_kurtosis(errors)

  # Shapiro-Wilk: sample 5000 if n > 5000
  if (n > 5000) {
    set.seed(42)
    sw <- shapiro.test(sample(errors, 5000))
  } else {
    sw <- shapiro.test(errors)
  }

  qs <- quantile(errors, probs = c(0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95),
                 type = 7)

  nq95 <- mn + 1.645 * sd_val
  rec <- ifelse(sw$p.value < 0.05, "empirical", "normal")

  data.frame(
    flow_bin = fb, flow_state = fs, n = n,
    mean_error = round(mn, 2), median_error = round(md, 2),
    std_dev = round(sd_val, 2), skewness = round(sk, 4),
    kurtosis = round(ku, 4), shapiro_p = signif(sw$p.value, 4),
    q05 = round(qs[1], 2), q10 = round(qs[2], 2),
    q25 = round(qs[3], 2), q50 = round(qs[4], 2),
    q75 = round(qs[5], 2), q90 = round(qs[6], 2),
    q95 = round(qs[7], 2),
    normal_q95_approx = round(nq95, 2),
    recommended_method = rec,
    stringsAsFactors = FALSE
  )
}

# Collect results
results <- data.frame()

# 18 bins: 6 flow levels x 3 flow states
for (fb in bin_labels) {
  for (fs in c("rising", "falling", "steady")) {
    m <- df$flow_bin == fb & df$flow_state == fs
    results <- rbind(results, analyze_bin(df$error[m], fb, fs))
  }
}

# 6 "all" aggregates: per flow_bin with flow_state = "all"
for (fb in bin_labels) {
  m <- df$flow_bin == fb
  results <- rbind(results, analyze_bin(df$error[m], fb, "all"))
}

cat(sprintf("\nTotal result rows: %d\n", nrow(results)))

# --- Step 8: Write output ----------------------------------------------------
out_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/error_distribution_v2_R.csv"
write.csv(results, out_path, row.names = FALSE)
cat(sprintf("\nResults written to: %s\n", out_path))

# --- Step 9: Print summary table ---------------------------------------------
cat("\n", strrep("=", 100), "\n")
cat("SUMMARY: Empirical 90% CI (q05, q95) per bin\n")
cat(strrep("=", 100), "\n")
cat(sprintf("%-15s %-10s %7s %10s %10s %10s %10s %12s\n",
            "flow_bin", "flow_state", "n", "mean_err", "q05", "q95",
            "norm_q95", "method"))
cat(strrep("-", 100), "\n")

for (i in 1:nrow(results)) {
  r <- results[i, ]
  if (is.na(r$q05)) {
    cat(sprintf("%-15s %-10s %7d %10s %10s %10s %10s %12s\n",
                r$flow_bin, r$flow_state, r$n,
                "N/A", "N/A", "N/A", "N/A", "insuff"))
  } else {
    cat(sprintf("%-15s %-10s %7d %10.1f %10.1f %10.1f %10.1f %12s\n",
                r$flow_bin, r$flow_state, r$n, r$mean_error,
                r$q05, r$q95, r$normal_q95_approx, r$recommended_method))
  }
}
cat(strrep("=", 100), "\n")

# --- Step 10: Key diagnostics ------------------------------------------------
cat("\nKey diagnostics:\n")
cat(sprintf("  Total observations analyzed: %d\n", nrow(df)))
cat(sprintf("  Bins with sufficient data (n>=20): %d / %d\n",
            sum(!is.na(results$q05)), nrow(results)))

valid <- results[!is.na(results$q95) & !is.na(results$normal_q95_approx), ]
cat(sprintf("  Max |normal_q95 - empirical_q95|: %.1f cfs\n",
            max(abs(valid$normal_q95_approx - valid$q95))))
cat(sprintf("  Bins rejecting normality (p<0.05): %d / %d\n",
            sum(valid$shapiro_p < 0.05), nrow(valid)))

cat("\nDone.\n")

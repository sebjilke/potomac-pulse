#!/usr/bin/env Rscript
# v29.0 Verification Script (R)
# Independent verification of EF weight change from graduated to flat step

cat("=== v29.0 EF Weight Verification (R) ===\n\n")

# Load data
df <- read.csv("/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv",
               stringsAsFactors = FALSE)

cat(sprintf("Loaded %d rows from hourly_backtest_data.csv\n", nrow(df)))
cat(sprintf("Columns: %s\n", paste(names(df), collapse=", ")))
cat(sprintf("Date range: %s to %s\n", min(df$timestamp), max(df$timestamp)))
cat(sprintf("  por_lagged range: %.1f to %.1f\n", min(df$por_lagged, na.rm=TRUE), max(df$por_lagged, na.rm=TRUE)))
cat(sprintf("  ef_stage range: %.2f to %.2f\n", min(df$ef_stage, na.rm=TRUE), max(df$ef_stage, na.rm=TRUE)))
cat(sprintf("  lf_discharge range: %.1f to %.1f\n", min(df$lf_discharge, na.rm=TRUE), max(df$lf_discharge, na.rm=TRUE)))
cat(sprintf("  water_temp_c: %d non-NA values out of %d\n",
            sum(!is.na(df$water_temp_c)), nrow(df)))
cat("\n")

# ---- Define weight functions ----

# OLD: Piecewise-linear (graduated) with 7 anchor points
getEFWeight_old <- function(estimatedFlow) {
  anchors_flow <- c(0, 3000, 6000, 10000, 15000, 25000, 50000)
  anchors_wt   <- c(0.0, 0.0, 0.1, 0.4, 0.4, 0.4, 0.4)

  sapply(estimatedFlow, function(f) {
    if (f <= anchors_flow[1]) return(anchors_wt[1])
    if (f >= anchors_flow[length(anchors_flow)]) return(anchors_wt[length(anchors_wt)])
    # Find segment
    for (i in 1:(length(anchors_flow) - 1)) {
      if (f >= anchors_flow[i] && f < anchors_flow[i + 1]) {
        # Linear interpolation
        frac <- (f - anchors_flow[i]) / (anchors_flow[i + 1] - anchors_flow[i])
        return(anchors_wt[i] + frac * (anchors_wt[i + 1] - anchors_wt[i]))
      }
    }
    return(anchors_wt[length(anchors_wt)])  # fallback
  })
}

# NEW: Flat step (v29.0)
getEFWeight_new <- function(estimatedFlow) {
  ifelse(estimatedFlow < 3000, 0.0, 0.35)
}

# ---- Verify weight function behavior ----
cat("--- Weight Function Spot Checks ---\n")
test_flows <- c(0, 1000, 2999, 3000, 3001, 4500, 6000, 8000, 10000, 15000, 25000, 50000, 80000)
for (f in test_flows) {
  old_w <- getEFWeight_old(f)
  new_w <- getEFWeight_new(f)
  cat(sprintf("  Flow=%6d: OLD=%.4f  NEW=%.4f\n", f, old_w, new_w))
}
cat("\n")

# Verify new function returns exactly 0.0 and 0.35
stopifnot(getEFWeight_new(0) == 0.0)
stopifnot(getEFWeight_new(2999) == 0.0)
stopifnot(getEFWeight_new(2999.99) == 0.0)
stopifnot(getEFWeight_new(3000) == 0.35)
stopifnot(getEFWeight_new(100000) == 0.35)
cat("PASS: New weight function returns 0.0 for flow < 3000 and 0.35 for flow >= 3000\n\n")

# ---- Compute EF estimates and blended GF ----

# EF power-law estimate
ef_estimate <- ifelse(!is.na(df$water_temp_c) & df$water_temp_c <= 10,
                      160 * (df$ef_stage ^ 2.36),   # cold water model
                      126 * (df$ef_stage ^ 2.46))    # default model

cat(sprintf("EF estimates: %d default, %d cold-water\n",
            sum(is.na(df$water_temp_c) | df$water_temp_c > 10),
            sum(!is.na(df$water_temp_c) & df$water_temp_c <= 10)))

# Compute weights
w_old <- getEFWeight_old(df$por_lagged)
w_new <- getEFWeight_new(df$por_lagged)

# Blended estimates: GF = (1 - w) * por_lagged + w * ef_estimate
gf_old <- (1 - w_old) * df$por_lagged + w_old * ef_estimate
gf_new <- (1 - w_new) * df$por_lagged + w_new * ef_estimate

# Actual
actual <- df$lf_discharge

# Filter to complete cases
valid <- !is.na(gf_old) & !is.na(gf_new) & !is.na(actual)
cat(sprintf("Valid rows for RMSE: %d out of %d\n", sum(valid), nrow(df)))

# ---- Compute RMSE ----
rmse_old <- sqrt(mean((gf_old[valid] - actual[valid])^2))
rmse_new <- sqrt(mean((gf_new[valid] - actual[valid])^2))
pct_change <- (rmse_new - rmse_old) / rmse_old * 100

cat(sprintf("\n=== RMSE Results ===\n"))
cat(sprintf("  OLD (graduated piecewise-linear): %.1f cfs\n", rmse_old))
cat(sprintf("  NEW (flat 35%% step at 3k):        %.1f cfs\n", rmse_new))
cat(sprintf("  Change: %+.1f%% (%s)\n", pct_change,
            ifelse(pct_change < 0, "IMPROVEMENT", "WORSE")))
cat("\n")

# ---- Check against expected values ----
cat("--- Expected Value Checks ---\n")
cat(sprintf("  Expected NEW RMSE ~ 1,676 cfs, got %.1f cfs (delta=%.1f)\n",
            rmse_new, abs(rmse_new - 1676)))
cat(sprintf("  Expected OLD RMSE ~ 1,757 cfs, got %.1f cfs (delta=%.1f)\n",
            rmse_old, abs(rmse_old - 1757)))

if (abs(rmse_new - 1676) < 50) {
  cat("  PASS: NEW RMSE within 50 cfs of expected 1,676\n")
} else {
  cat("  WARN: NEW RMSE differs from expected 1,676 by more than 50 cfs\n")
}

if (abs(rmse_old - 1757) < 50) {
  cat("  PASS: OLD RMSE within 50 cfs of expected 1,757\n")
} else {
  cat("  WARN: OLD RMSE differs from expected 1,757 by more than 50 cfs\n")
}

cat("\n")

# ---- Flow-bin breakdown ----
cat("--- RMSE by Flow Bin ---\n")
bins <- c(0, 3000, 6000, 12000, 25000, 50000, Inf)
bin_labels <- c("0-3k", "3k-6k", "6k-12k", "12k-25k", "25k-50k", "50k+")

for (i in 1:(length(bins) - 1)) {
  mask <- valid & df$por_lagged >= bins[i] & df$por_lagged < bins[i + 1]
  n <- sum(mask)
  if (n > 0) {
    r_old <- sqrt(mean((gf_old[mask] - actual[mask])^2))
    r_new <- sqrt(mean((gf_new[mask] - actual[mask])^2))
    pct <- (r_new - r_old) / r_old * 100
    cat(sprintf("  %8s (n=%5d): OLD=%7.1f  NEW=%7.1f  (%+.1f%%)\n",
                bin_labels[i], n, r_old, r_new, pct))
  }
}

cat("\n=== Verification Complete ===\n")

#!/usr/bin/env Rscript
# =============================================================================
# EF High-Flow Weight Analysis
# Question: Should EF weight at >15k cfs be increased beyond 50%?
# =============================================================================

suppressPackageStartupMessages({
  library(lmtest)  # for dwtest
})

cat("=" , rep("=", 70), "\n", sep="")
cat("  EF HIGH-FLOW WEIGHT ANALYSIS\n")
cat("  Testing whether EF deserves >50% weight at high flows (>15k cfs)\n")
cat("=" , rep("=", 70), "\n\n", sep="")

# -----------------------------------------------------------------------------
# 1. Load and prepare data
# -----------------------------------------------------------------------------
raw <- read.csv("/Users/sebjilke/Desktop/PotomacPulse/analysis/ef_lf_daily_longterm.csv",
                stringsAsFactors = FALSE)
raw$date <- as.Date(raw$date)

cat("Raw data: ", nrow(raw), " rows, date range: ",
    as.character(min(raw$date)), " to ", as.character(max(raw$date)), "\n", sep="")

# Deduplicate by date: mean ef_stage, first lf_discharge
dedup <- aggregate(cbind(ef_stage, lf_discharge) ~ date, data = raw,
                   FUN = function(x) x[1])
# Override ef_stage with mean
ef_means <- aggregate(ef_stage ~ date, data = raw, FUN = mean)
dedup$ef_stage <- ef_means$ef_stage[match(dedup$date, ef_means$date)]
dedup <- dedup[order(dedup$date), ]
rownames(dedup) <- NULL

cat("After dedup: ", nrow(dedup), " unique dates\n\n", sep="")

# Compute EF prediction for ALL data
dedup$ef_predicted <- 126 * dedup$ef_stage^2.46

# -----------------------------------------------------------------------------
# 2. Full-dataset accuracy (baseline comparison)
# -----------------------------------------------------------------------------
cat("-" , rep("-", 70), "\n", sep="")
cat("  (a) EF MODEL ACCURACY\n")
cat("-" , rep("-", 70), "\n\n")

compute_metrics <- function(actual, predicted, label) {
  resid <- predicted - actual
  n <- length(actual)
  rmse <- sqrt(mean(resid^2))
  mae <- mean(abs(resid))
  mape <- mean(abs(resid) / actual) * 100
  bias <- mean(resid)
  bias_pct <- mean(resid / actual) * 100
  ss_res <- sum(resid^2)
  ss_tot <- sum((actual - mean(actual))^2)
  r2 <- 1 - ss_res / ss_tot
  cor_val <- cor(actual, predicted)

  cat(sprintf("  %-25s (n = %d)\n", label, n))
  cat(sprintf("    RMSE:        %10.0f cfs\n", rmse))
  cat(sprintf("    MAE:         %10.0f cfs\n", mae))
  cat(sprintf("    MAPE:        %10.1f%%\n", mape))
  cat(sprintf("    Bias:        %10.0f cfs  (%+.1f%%)\n", bias, bias_pct))
  cat(sprintf("    R-squared:   %10.4f\n", r2))
  cat(sprintf("    Correlation: %10.4f\n\n", cor_val))

  return(data.frame(subset = label, n = n, rmse = rmse, mae = mae,
                    mape = mape, bias = bias, bias_pct = bias_pct,
                    r2 = r2, correlation = cor_val))
}

metrics_full <- compute_metrics(dedup$lf_discharge, dedup$ef_predicted, "FULL dataset")

# Filter to high flows
high <- dedup[dedup$lf_discharge >= 15000, ]
cat(sprintf("High-flow observations (>= 15k cfs): %d  (%.1f%% of data)\n\n",
            nrow(high), 100 * nrow(high) / nrow(dedup)))

metrics_high <- compute_metrics(high$lf_discharge, high$ef_predicted, "HIGH FLOW (>=15k)")

# Also split within high flows for later
high_mid <- high[high$lf_discharge >= 15000 & high$lf_discharge < 30000, ]
high_top <- high[high$lf_discharge >= 30000, ]

metrics_mid <- compute_metrics(high_mid$lf_discharge, high_mid$ef_predicted, "  15k-30k cfs")
metrics_top <- compute_metrics(high_top$lf_discharge, high_top$ef_predicted, "  >30k cfs")

# -----------------------------------------------------------------------------
# 3. (b) Persistence baseline comparison
# -----------------------------------------------------------------------------
cat("-" , rep("-", 70), "\n", sep="")
cat("  (b) PERSISTENCE BASELINE (lag-1)\n")
cat("-" , rep("-", 70), "\n\n")

# Need consecutive days — work on sorted high-flow data
high$lag1_lf <- c(NA, high$lf_discharge[-nrow(high)])
# Check if dates are consecutive
high$date_diff <- c(NA, diff(high$date))
# Only use where previous day is also in dataset (consecutive)
high_consec <- high[!is.na(high$lag1_lf) & high$date_diff == 1, ]

cat(sprintf("  Consecutive high-flow day-pairs: %d\n\n", nrow(high_consec)))

# Persistence RMSE
persist_resid <- high_consec$lf_discharge - high_consec$lag1_lf
persist_rmse <- sqrt(mean(persist_resid^2))
persist_mape <- mean(abs(persist_resid) / high_consec$lf_discharge) * 100

# EF RMSE on same subset
ef_resid_consec <- high_consec$ef_predicted - high_consec$lf_discharge
ef_rmse_consec <- sqrt(mean(ef_resid_consec^2))
ef_mape_consec <- mean(abs(ef_resid_consec) / high_consec$lf_discharge) * 100

cat(sprintf("  Persistence (yesterday's actual) RMSE: %10.0f cfs  (MAPE: %.1f%%)\n",
            persist_rmse, persist_mape))
cat(sprintf("  EF model RMSE (same subset):           %10.0f cfs  (MAPE: %.1f%%)\n",
            ef_rmse_consec, ef_mape_consec))
cat(sprintf("  EF / Persistence RMSE ratio:           %10.3f\n", ef_rmse_consec / persist_rmse))

if (ef_rmse_consec < persist_rmse) {
  cat("  >> EF BEATS persistence — the model adds genuine predictive value\n\n")
} else {
  cat("  >> EF LOSES to persistence — much of the correlation is autocorrelation\n\n")
}

# Also on full consecutive dataset for context
dedup$lag1_lf <- c(NA, dedup$lf_discharge[-nrow(dedup)])
dedup$date_diff <- c(NA, diff(dedup$date))
full_consec <- dedup[!is.na(dedup$lag1_lf) & dedup$date_diff == 1, ]

persist_rmse_full <- sqrt(mean((full_consec$lf_discharge - full_consec$lag1_lf)^2))
ef_rmse_full_consec <- sqrt(mean((full_consec$ef_predicted - full_consec$lf_discharge)^2))
cat(sprintf("  For context — FULL dataset:\n"))
cat(sprintf("    Persistence RMSE: %10.0f cfs\n", persist_rmse_full))
cat(sprintf("    EF model RMSE:    %10.0f cfs\n\n", ef_rmse_full_consec))

# -----------------------------------------------------------------------------
# 4. (c) Residual diagnostics
# -----------------------------------------------------------------------------
cat("-" , rep("-", 70), "\n", sep="")
cat("  (c) RESIDUAL DIAGNOSTICS\n")
cat("-" , rep("-", 70), "\n\n")

high_resid <- high$ef_predicted - high$lf_discharge

# ACF of residuals
acf_vals <- acf(high_resid, lag.max = 10, plot = FALSE)
cat("  ACF of EF residuals (high flow):\n")
for (i in 1:min(6, length(acf_vals$acf))) {
  lag_i <- acf_vals$lag[i]
  val_i <- acf_vals$acf[i]
  bar <- paste(rep("|", max(1, round(abs(val_i) * 40))), collapse="")
  cat(sprintf("    Lag %d: %+.4f  %s\n", lag_i, val_i, bar))
}

cat(sprintf("\n  >> Lag-1 ACF = %.4f", acf_vals$acf[2]))
if (abs(acf_vals$acf[2]) > 0.5) {
  cat(" — STRONG autocorrelation in errors (>0.5)\n")
  cat("     This means PoR (which tracks actual flow) adds substantial value\n")
} else if (abs(acf_vals$acf[2]) > 0.3) {
  cat(" — MODERATE autocorrelation (0.3-0.5)\n")
} else {
  cat(" — WEAK autocorrelation (<0.3)\n")
}

# Durbin-Watson test (need a linear model context)
# Use a simple model: ef_predicted ~ lf_discharge for residual structure
dw_model <- lm(lf_discharge ~ ef_predicted, data = high)
dw_result <- dwtest(dw_model)
cat(sprintf("\n  Durbin-Watson statistic: %.4f  (p-value: %.4e)\n",
            dw_result$statistic, dw_result$p.value))
cat(sprintf("    (DW < 2 indicates positive autocorrelation; ideal = 2)\n"))
if (dw_result$statistic < 1.5) {
  cat("    >> Significant positive autocorrelation in residuals\n\n")
} else {
  cat("    >> Moderate or weak autocorrelation\n\n")
}

# Residual stats
cat(sprintf("  Residual summary (ef_predicted - actual):\n"))
cat(sprintf("    Mean:   %+10.0f cfs\n", mean(high_resid)))
cat(sprintf("    Median: %+10.0f cfs\n", median(high_resid)))
cat(sprintf("    SD:     %10.0f cfs\n", sd(high_resid)))
cat(sprintf("    Min:    %+10.0f cfs  Max: %+10.0f cfs\n\n", min(high_resid), max(high_resid)))

# Day-over-day change analysis
high$dod_change <- c(NA, diff(high$lf_discharge))
high_dod <- high[!is.na(high$dod_change) & !is.na(high$date_diff) & high$date_diff == 1, ]
high_dod$resid <- high_dod$ef_predicted - high_dod$lf_discharge

cor_resid_dod <- cor(abs(high_dod$resid), abs(high_dod$dod_change), use = "complete.obs")
cat(sprintf("  Correlation of |residual| with |day-over-day change|: %.4f\n", cor_resid_dod))
if (cor_resid_dod > 0.3) {
  cat("    >> EF errors are LARGER when flow is changing rapidly\n")
  cat("       This is where PoR (capturing tributaries) adds most value\n\n")
} else {
  cat("    >> EF errors are NOT strongly linked to rapid flow changes\n\n")
}

# Quantile breakdown of residuals by change magnitude
cat("  EF absolute error by day-over-day change magnitude:\n")
change_breaks <- quantile(abs(high_dod$dod_change), probs = c(0, 0.25, 0.5, 0.75, 1), na.rm=TRUE)
high_dod$change_bin <- cut(abs(high_dod$dod_change), breaks = change_breaks, include.lowest = TRUE)
if (any(!is.na(high_dod$change_bin))) {
  agg <- aggregate(abs(high_dod$resid), by = list(change_bin = high_dod$change_bin),
                   FUN = function(x) c(mean = mean(x), median = median(x), n = length(x)))
  for (i in 1:nrow(agg)) {
    cat(sprintf("    %-25s  mean |error|: %8.0f cfs  median: %8.0f cfs  (n=%d)\n",
                as.character(agg$change_bin[i]), agg$x[i, "mean"], agg$x[i, "median"], agg$x[i, "n"]))
  }
}
cat("\n")

# -----------------------------------------------------------------------------
# 5. (d) Optimal weight grid search
# -----------------------------------------------------------------------------
cat("-" , rep("-", 70), "\n", sep="")
cat("  (d) OPTIMAL WEIGHT GRID SEARCH\n")
cat("      Blending: ensemble = (1-w)*lag1_actual + w*ef_predicted\n")
cat("      (Using lag-1 actual as PoR proxy)\n")
cat("-" , rep("-", 70), "\n\n")

# Use high-flow consecutive data
hc <- high_consec

weights <- seq(0, 1, by = 0.05)
grid_results <- data.frame(weight = weights, rmse = NA, mape = NA, mae = NA, bias = NA)

for (i in seq_along(weights)) {
  w <- weights[i]
  ensemble <- (1 - w) * hc$lag1_lf + w * hc$ef_predicted
  resid_e <- ensemble - hc$lf_discharge
  grid_results$rmse[i] <- sqrt(mean(resid_e^2))
  grid_results$mape[i] <- mean(abs(resid_e) / hc$lf_discharge) * 100
  grid_results$mae[i]  <- mean(abs(resid_e))
  grid_results$bias[i] <- mean(resid_e)
}

cat("  Weight    RMSE (cfs)    MAPE (%)    MAE (cfs)    Bias (cfs)\n")
cat("  ------    ----------    --------    ---------    ----------\n")
for (i in seq_along(weights)) {
  marker <- ""
  if (grid_results$rmse[i] == min(grid_results$rmse)) marker <- "  <-- OPTIMAL (RMSE)"
  if (weights[i] == 0.50) marker <- paste0(marker, "  <-- CURRENT")
  cat(sprintf("   %4.2f     %10.0f     %6.1f     %9.0f     %+9.0f%s\n",
              grid_results$weight[i], grid_results$rmse[i], grid_results$mape[i],
              grid_results$mae[i], grid_results$bias[i], marker))
}

opt_idx <- which.min(grid_results$rmse)
opt_w <- grid_results$weight[opt_idx]
opt_rmse <- grid_results$rmse[opt_idx]
current_rmse <- grid_results$rmse[grid_results$weight == 0.50]

cat(sprintf("\n  >> Optimal EF weight (by RMSE): %.2f\n", opt_w))
cat(sprintf("     RMSE at optimal:  %.0f cfs\n", opt_rmse))
cat(sprintf("     RMSE at w=0.50:   %.0f cfs\n", current_rmse))
cat(sprintf("     Improvement:      %.0f cfs (%.1f%%)\n\n",
            current_rmse - opt_rmse,
            100 * (current_rmse - opt_rmse) / current_rmse))

# Also find optimal by MAPE
opt_mape_idx <- which.min(grid_results$mape)
cat(sprintf("  >> Optimal EF weight (by MAPE): %.2f\n\n", grid_results$weight[opt_mape_idx]))

# -----------------------------------------------------------------------------
# 6. (e) Flow-regime split within high flows
# -----------------------------------------------------------------------------
cat("-" , rep("-", 70), "\n", sep="")
cat("  (e) FLOW-REGIME SPLIT WITHIN HIGH FLOWS\n")
cat("-" , rep("-", 70), "\n\n")

run_grid_search <- function(df, label) {
  df$lag1_lf <- c(NA, df$lf_discharge[-nrow(df)])
  df$date_diff <- c(NA, diff(df$date))
  dc <- df[!is.na(df$lag1_lf) & df$date_diff == 1, ]

  if (nrow(dc) < 5) {
    cat(sprintf("  %s: Too few consecutive pairs (%d) for grid search\n\n", label, nrow(dc)))
    return(data.frame(regime = label, n = nrow(dc), optimal_w = NA, rmse_optimal = NA, rmse_w50 = NA))
  }

  ws <- seq(0, 1, by = 0.05)
  rmses <- sapply(ws, function(w) {
    ens <- (1 - w) * dc$lag1_lf + w * dc$ef_predicted
    sqrt(mean((ens - dc$lf_discharge)^2))
  })

  opt_i <- which.min(rmses)
  rmse_50 <- rmses[ws == 0.50]

  cat(sprintf("  %s (n=%d consecutive pairs):\n", label, nrow(dc)))
  cat(sprintf("    Optimal weight: %.2f  (RMSE: %.0f cfs)\n", ws[opt_i], rmses[opt_i]))
  cat(sprintf("    Current w=0.50:         (RMSE: %.0f cfs)\n", rmse_50))
  cat(sprintf("    Improvement:  %.0f cfs (%.1f%%)\n\n",
              rmse_50 - rmses[opt_i], 100 * (rmse_50 - rmses[opt_i]) / rmse_50))

  return(data.frame(regime = label, n = nrow(dc), optimal_w = ws[opt_i],
                    rmse_optimal = rmses[opt_i], rmse_w50 = rmse_50))
}

regime_mid <- run_grid_search(high_mid, "15k-30k cfs")
regime_top <- run_grid_search(high_top, ">30k cfs")

# -----------------------------------------------------------------------------
# 7. Save summary results
# -----------------------------------------------------------------------------
summary_df <- rbind(
  data.frame(metric = "n_high_flow", value = nrow(high), note = "observations >= 15k cfs"),
  data.frame(metric = "ef_rmse_high", value = round(metrics_high$rmse), note = "EF model RMSE at high flows"),
  data.frame(metric = "ef_mape_high", value = round(metrics_high$mape, 1), note = "EF model MAPE at high flows"),
  data.frame(metric = "ef_r2_high", value = round(metrics_high$r2, 4), note = "EF model R-squared at high flows"),
  data.frame(metric = "ef_bias_high", value = round(metrics_high$bias), note = "EF model bias (cfs)"),
  data.frame(metric = "persist_rmse_high", value = round(persist_rmse), note = "Persistence RMSE at high flows"),
  data.frame(metric = "ef_beats_persistence", value = as.numeric(ef_rmse_consec < persist_rmse), note = "1=yes, 0=no"),
  data.frame(metric = "lag1_acf_residuals", value = round(acf_vals$acf[2], 4), note = "Lag-1 ACF of EF residuals"),
  data.frame(metric = "durbin_watson", value = round(dw_result$statistic, 4), note = "DW statistic"),
  data.frame(metric = "optimal_weight_rmse", value = opt_w, note = "Optimal EF weight by RMSE"),
  data.frame(metric = "optimal_weight_mape", value = grid_results$weight[opt_mape_idx], note = "Optimal EF weight by MAPE"),
  data.frame(metric = "rmse_at_optimal", value = round(opt_rmse), note = "RMSE at optimal weight"),
  data.frame(metric = "rmse_at_w50", value = round(current_rmse), note = "RMSE at current w=0.50"),
  data.frame(metric = "rmse_improvement_pct", value = round(100 * (current_rmse - opt_rmse) / current_rmse, 1), note = "% RMSE improvement"),
  data.frame(metric = "regime_15_30k_optimal_w", value = regime_mid$optimal_w, note = "Optimal weight for 15-30k regime"),
  data.frame(metric = "regime_30k_plus_optimal_w", value = regime_top$optimal_w, note = "Optimal weight for >30k regime"),
  data.frame(metric = "corr_resid_vs_dod_change", value = round(cor_resid_dod, 4), note = "Correlation |residual| vs |day-over-day change|")
)

write.csv(summary_df, "/Users/sebjilke/Desktop/PotomacPulse/analysis/ef_high_flow_test_R.csv",
          row.names = FALSE)
cat("Results saved to: analysis/ef_high_flow_test_R.csv\n\n")

# -----------------------------------------------------------------------------
# 8. Final verdict
# -----------------------------------------------------------------------------
cat("=" , rep("=", 70), "\n", sep="")
cat("  FINAL VERDICT\n")
cat("=" , rep("=", 70), "\n\n")

cat(sprintf("  1. EF model at high flows: RMSE = %.0f cfs, MAPE = %.1f%%, R2 = %.4f\n",
            metrics_high$rmse, metrics_high$mape, metrics_high$r2))
cat(sprintf("     (vs full dataset:       RMSE = %.0f cfs, MAPE = %.1f%%, R2 = %.4f)\n\n",
            metrics_full$rmse, metrics_full$mape, metrics_full$r2))

if (ef_rmse_consec < persist_rmse) {
  cat("  2. EF BEATS persistence at high flows — it has genuine predictive\n")
  cat("     power beyond autocorrelation.\n\n")
} else {
  cat("  2. EF LOSES TO persistence at high flows — the 0.98 correlation\n")
  cat("     is largely autocorrelation. PoR (which tracks actual flow) is needed.\n\n")
}

cat(sprintf("  3. Residual autocorrelation: lag-1 ACF = %.3f, DW = %.3f\n",
            acf_vals$acf[2], dw_result$statistic))
if (abs(acf_vals$acf[2]) > 0.5) {
  cat("     Strong error autocorrelation means blending with PoR helps correct\n")
  cat("     systematic day-to-day error patterns.\n\n")
} else {
  cat("     Moderate error autocorrelation.\n\n")
}

cat(sprintf("  4. Optimal EF weight (grid search): %.0f%% (vs current 50%%)\n", opt_w * 100))
if (opt_w > 0.50) {
  cat(sprintf("     >> YES — data supports INCREASING EF weight to ~%.0f%%\n", opt_w * 100))
  cat(sprintf("        RMSE improvement: %.0f cfs (%.1f%%)\n\n",
              current_rmse - opt_rmse, 100 * (current_rmse - opt_rmse) / current_rmse))
} else if (opt_w == 0.50) {
  cat("     >> CURRENT 50% weight is already optimal.\n\n")
} else {
  cat(sprintf("     >> NO — data suggests DECREASING EF weight to ~%.0f%%\n", opt_w * 100))
  cat(sprintf("        RMSE improvement: %.0f cfs (%.1f%%)\n\n",
              current_rmse - opt_rmse, 100 * (current_rmse - opt_rmse) / current_rmse))
}

cat(sprintf("  5. Regime split:\n"))
cat(sprintf("     15k-30k: optimal w = %.2f\n", regime_mid$optimal_w))
cat(sprintf("     >30k:    optimal w = %.2f\n", regime_top$optimal_w))
if (!is.na(regime_top$optimal_w) && !is.na(regime_mid$optimal_w) &&
    abs(regime_top$optimal_w - regime_mid$optimal_w) > 0.10) {
  cat("     >> Regime-dependent weighting may be warranted.\n\n")
} else {
  cat("     >> Similar across regimes — a single weight is fine.\n\n")
}

cat("  RECOMMENDATION:\n")
if (opt_w >= 0.55) {
  cat(sprintf("  Increase EF weight at >15k cfs from 50%% to %.0f%%.\n", min(opt_w * 100, 70)))
  cat("  The EF power-law captures the high-flow stage-discharge relationship well,\n")
  cat("  and the data supports giving it more influence in the ensemble.\n")
} else if (opt_w >= 0.45 && opt_w <= 0.55) {
  cat("  Keep EF weight at 50%. The current weight is near-optimal.\n")
  cat("  The EF model performs well at high flows but the ensemble already\n")
  cat("  captures the right balance.\n")
} else {
  cat(sprintf("  Consider REDUCING EF weight to ~%.0f%%.\n", max(opt_w * 100, 25)))
  cat("  Despite the high correlation, persistence/PoR-based estimates\n")
  cat("  contribute substantially to accuracy at high flows.\n")
}
cat("\n")

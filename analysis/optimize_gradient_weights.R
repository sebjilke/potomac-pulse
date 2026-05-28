#!/usr/bin/env Rscript
# =============================================================================
# optimize_gradient_weights.R
# Piecewise-linear (gradient) EF weight optimization via coordinate descent
# Potomac Pulse — v26.0
# =============================================================================

cat("=============================================================
")
cat("  Gradient EF Weight Optimization (Piecewise-Linear)
")
cat("  Potomac Pulse — Coordinate Descent Method
")
cat("=============================================================

")

# --- 1. Load and prepare data ------------------------------------------------
data_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/ef_lf_daily_longterm.csv"
df <- read.csv(data_path, stringsAsFactors = FALSE)
cat(sprintf("Raw data loaded: %d rows
", nrow(df)))

# Parse dates
df$date <- as.Date(df$date)

# Deduplicate by date (keep first occurrence)
df <- df[!duplicated(df$date), ]
df <- df[order(df$date), ]
cat(sprintf("After dedup by date: %d rows
", nrow(df)))

# Remove NA rows
df <- df[complete.cases(df), ]
cat(sprintf("After removing NAs: %d rows
", nrow(df)))

# --- 2. Compute EF predicted -------------------------------------------------
df$ef_predicted <- 126 * df$ef_stage^2.46
cat(sprintf("EF predicted range: %.0f - %.0f cfs
",
            min(df$ef_predicted), max(df$ef_predicted)))
cat(sprintf("LF discharge range: %.0f - %.0f cfs

",
            min(df$lf_discharge), max(df$lf_discharge)))

# --- 3. Build consecutive-day pairs ------------------------------------------
n <- nrow(df)
day_gap <- as.numeric(diff(df$date))
consec <- which(day_gap == 1)

pairs <- data.frame(
  actual       = df$lf_discharge[consec + 1],
  yesterday_lf = df$lf_discharge[consec],
  ef_pred      = df$ef_predicted[consec + 1],
  flow_level   = df$lf_discharge[consec + 1]
)

cat(sprintf("Consecutive-day pairs: %d

", nrow(pairs)))

# --- 4. Define anchor points and helper functions -----------------------------
anchors <- c(0, 3000, 6000, 10000, 15000, 25000, 50000)
n_anchors <- length(anchors)

interpolate_weight_vec <- function(flow, anchor_flows, anchor_weights) {
  n_a <- length(anchor_flows)
  w <- rep(anchor_weights[1], length(flow))
  above <- flow >= anchor_flows[n_a]
  w[above] <- anchor_weights[n_a]
  for (j in 1:(n_a - 1)) {
    in_range <- flow > anchor_flows[j] & flow < anchor_flows[j + 1]
    if (any(in_range)) {
      frac <- (flow[in_range] - anchor_flows[j]) /
              (anchor_flows[j + 1] - anchor_flows[j])
      w[in_range] <- anchor_weights[j] +
                     (anchor_weights[j + 1] - anchor_weights[j]) * frac
    }
    at_anchor <- flow == anchor_flows[j + 1]
    w[at_anchor] <- anchor_weights[j + 1]
  }
  return(w)
}

compute_rmse <- function(anchor_weights, pairs_df, anchor_flows) {
  w <- interpolate_weight_vec(pairs_df$flow_level, anchor_flows, anchor_weights)
  ensemble <- (1 - w) * pairs_df$yesterday_lf + w * pairs_df$ef_pred
  rmse <- sqrt(mean((ensemble - pairs_df$actual)^2))
  return(rmse)
}

enforce_monotonic <- function(weights) {
  for (i in 2:length(weights)) {
    if (weights[i] < weights[i - 1]) {
      weights[i] <- weights[i - 1]
    }
  }
  return(weights)
}

# --- 5. Current step-function RMSE (baseline) --------------------------------
cat("--- Current Step-Function Baseline ---
")
step_weights_at_obs <- function(flow) {
  ifelse(flow < 3000, 0.1,
    ifelse(flow < 6000, 0.1,
      ifelse(flow < 15000, 0.2,
        0.7)))
}
w_step <- step_weights_at_obs(pairs$flow_level)
ensemble_step <- (1 - w_step) * pairs$yesterday_lf + w_step * pairs$ef_pred
rmse_step <- sqrt(mean((ensemble_step - pairs$actual)^2))
cat(sprintf("Step-function overall RMSE: %.1f cfs

", rmse_step))

# --- 6. Coordinate descent optimization (coarse) -----------------------------
cat("--- Coordinate Descent Optimization (Coarse: step 0.05) ---
")
current_weights <- c(0.1, 0.1, 0.1, 0.2, 0.7, 0.7, 0.7)
coarse_grid <- seq(0.00, 0.80, by = 0.05)
best_rmse <- compute_rmse(current_weights, pairs, anchors)
cat(sprintf("Initial RMSE: %.1f cfs
", best_rmse))

for (pass in 1:5) {
  improved <- FALSE
  for (a in 1:n_anchors) {
    best_w_for_anchor <- current_weights[a]
    best_rmse_for_anchor <- best_rmse
    for (w_candidate in coarse_grid) {
      trial_weights <- current_weights
      trial_weights[a] <- w_candidate
      trial_weights <- enforce_monotonic(trial_weights)
      trial_rmse <- compute_rmse(trial_weights, pairs, anchors)
      if (trial_rmse < best_rmse_for_anchor) {
        best_rmse_for_anchor <- trial_rmse
        best_w_for_anchor <- w_candidate
      }
    }
    if (best_rmse_for_anchor < best_rmse) {
      current_weights[a] <- best_w_for_anchor
      current_weights <- enforce_monotonic(current_weights)
      best_rmse <- best_rmse_for_anchor
      improved <- TRUE
    }
  }
  cat(sprintf("  Pass %d: RMSE = %.2f cfs | Weights = [%s]
",
              pass, best_rmse,
              paste(sprintf("%.2f", current_weights), collapse = ", ")))
  if (!improved) {
    cat("  Converged (no improvement).
")
    break
  }
}
cat(sprintf("
Coarse result RMSE: %.2f cfs
", best_rmse))
cat(sprintf("Coarse weights: [%s]

",
            paste(sprintf("%.2f", current_weights), collapse = ", ")))

# --- 7. Fine refinement (step 0.01) ------------------------------------------
cat("--- Fine Refinement (step 0.01, +/- 0.05 around coarse) ---
")
for (pass in 1:5) {
  improved <- FALSE
  for (a in 1:n_anchors) {
    lo <- max(0.00, current_weights[a] - 0.05)
    hi <- min(0.80, current_weights[a] + 0.05)
    fine_grid <- seq(lo, hi, by = 0.01)
    best_w_for_anchor <- current_weights[a]
    best_rmse_for_anchor <- best_rmse
    for (w_candidate in fine_grid) {
      trial_weights <- current_weights
      trial_weights[a] <- w_candidate
      trial_weights <- enforce_monotonic(trial_weights)
      trial_rmse <- compute_rmse(trial_weights, pairs, anchors)
      if (trial_rmse < best_rmse_for_anchor) {
        best_rmse_for_anchor <- trial_rmse
        best_w_for_anchor <- w_candidate
      }
    }
    if (best_rmse_for_anchor < best_rmse) {
      current_weights[a] <- best_w_for_anchor
      current_weights <- enforce_monotonic(current_weights)
      best_rmse <- best_rmse_for_anchor
      improved <- TRUE
    }
  }
  cat(sprintf("  Refine pass %d: RMSE = %.4f cfs | Weights = [%s]
",
              pass, best_rmse,
              paste(sprintf("%.2f", current_weights), collapse = ", ")))
  if (!improved) {
    cat("  Converged (no improvement).
")
    break
  }
}

# --- 8. Round to 1 decimal (0.1 precision) -----------------------------------
cat("
--- Rounding to 0.1 precision ---
")
rounded_weights <- round(current_weights, 1)
rounded_weights <- enforce_monotonic(rounded_weights)
rmse_rounded <- compute_rmse(rounded_weights, pairs, anchors)
cat(sprintf("Rounded weights: [%s]
",
            paste(sprintf("%.1f", rounded_weights), collapse = ", ")))
cat(sprintf("Rounded RMSE: %.2f cfs

", rmse_rounded))

# --- 9. Detailed results table ------------------------------------------------
cat("=============================================================
")
cat("  RESULTS: Optimal Piecewise-Linear (Gradient) EF Weights
")
cat("=============================================================

")
regime_labels <- c("< 3k", "3k-6k", "6k-10k", "10k-15k", "15k-25k", "25k-50k", "> 50k")
regime_lo <- c(0, 3000, 6000, 10000, 15000, 25000, 50000)
regime_hi <- c(3000, 6000, 10000, 15000, 25000, 50000, Inf)
cat(sprintf("%-12s | %-8s | %-8s | %-12s | %-12s | %-12s
",
            "Flow Regime", "Wt(mid)", "N obs", "RMSE Grad.", "RMSE Step", "Improvement"))
cat(paste(rep("-", 78), collapse = ""), "
")

for (r in seq_along(regime_labels)) {
  in_regime <- pairs$flow_level >= regime_lo[r] & pairs$flow_level < regime_hi[r]
  n_regime <- sum(in_regime)
  if (n_regime > 0) {
    w_grad <- interpolate_weight_vec(pairs$flow_level[in_regime], anchors, rounded_weights)
    ens_grad <- (1 - w_grad) * pairs$yesterday_lf[in_regime] +
                w_grad * pairs$ef_pred[in_regime]
    rmse_grad_r <- sqrt(mean((ens_grad - pairs$actual[in_regime])^2))
    w_s <- step_weights_at_obs(pairs$flow_level[in_regime])
    ens_s <- (1 - w_s) * pairs$yesterday_lf[in_regime] +
             w_s * pairs$ef_pred[in_regime]
    rmse_step_r <- sqrt(mean((ens_s - pairs$actual[in_regime])^2))
    pct_change <- (rmse_grad_r - rmse_step_r) / rmse_step_r * 100
    mid_flow <- (regime_lo[r] + min(regime_hi[r], 60000)) / 2
    mid_w <- interpolate_weight_vec(mid_flow, anchors, rounded_weights)
    cat(sprintf("%-12s | %-8.2f | %-8d | %-12.1f | %-12.1f | %+.1f%%
",
                regime_labels[r], mid_w, n_regime,
                rmse_grad_r, rmse_step_r, pct_change))
  } else {
    cat(sprintf("%-12s | %-8s | %-8d | %-12s | %-12s | %s
",
                regime_labels[r], "N/A", 0, "N/A", "N/A", "N/A"))
  }
}
cat(paste(rep("-", 78), collapse = ""), "
")
cat(sprintf("
%-12s | %-8s | %-8d | %-12.1f | %-12.1f | %+.1f%%
",
            "OVERALL", "", nrow(pairs), rmse_rounded, rmse_step,
            (rmse_rounded - rmse_step) / rmse_step * 100))
cat(sprintf("
Total consecutive-day pairs used: %d
", nrow(pairs)))

# --- 10. Weight comparison table ----------------------------------------------
cat("
=============================================================
")
cat("  Weight Comparison: Step vs Gradient
")
cat("=============================================================

")
cat(sprintf("%-14s | %-14s | %-14s
",
            "Anchor (cfs)", "Step Weight", "Gradient Weight"))
cat(paste(rep("-", 48), collapse = ""), "
")
step_anchor_weights <- c(0.1, 0.1, 0.1, 0.2, 0.7, 0.7, 0.7)
for (a in 1:n_anchors) {
  cat(sprintf("%-14s | %-14.1f | %-14.1f
",
              formatC(anchors[a], format = "d", big.mark = ","),
              step_anchor_weights[a], rounded_weights[a]))
}

# --- 11. Save CSV output ------------------------------------------------------
out_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/gradient_weights_R.csv"
local_rmse <- numeric(n_anchors)
local_n <- numeric(n_anchors)
for (a in 1:n_anchors) {
  if (a == 1) {
    lo_bound <- 0
  } else {
    lo_bound <- (anchors[a] + anchors[a - 1]) / 2
  }
  if (a == n_anchors) {
    hi_bound <- Inf
  } else {
    hi_bound <- (anchors[a] + anchors[a + 1]) / 2
  }
  in_band <- pairs$flow_level >= lo_bound & pairs$flow_level < hi_bound
  local_n[a] <- sum(in_band)
  if (local_n[a] > 0) {
    w_local <- interpolate_weight_vec(pairs$flow_level[in_band], anchors, rounded_weights)
    ens_local <- (1 - w_local) * pairs$yesterday_lf[in_band] +
                 w_local * pairs$ef_pred[in_band]
    local_rmse[a] <- sqrt(mean((ens_local - pairs$actual[in_band])^2))
  } else {
    local_rmse[a] <- NA
  }
}
out_df <- data.frame(
  anchor_flow    = anchors,
  optimal_weight = rounded_weights,
  n_obs_nearby   = local_n,
  rmse_local     = round(local_rmse, 1)
)
write.csv(out_df, out_path, row.names = FALSE)
cat(sprintf("
Results saved to: %s
", out_path))

# --- 12. Summary -------------------------------------------------------------
cat("
=============================================================
")
cat("  SUMMARY
")
cat("=============================================================
")
cat(sprintf("  Step-function RMSE:       %.1f cfs
", rmse_step))
cat(sprintf("  Gradient (fine) RMSE:     %.4f cfs
", best_rmse))
cat(sprintf("  Gradient (rounded) RMSE:  %.1f cfs
", rmse_rounded))
cat(sprintf("  Improvement (rounded):    %+.1f%% vs step function
",
            (rmse_rounded - rmse_step) / rmse_step * 100))
cat(sprintf("  N observations used:      %d consecutive-day pairs
", nrow(pairs)))
cat(sprintf("  Anchor points:            %d
", n_anchors))
cat(sprintf("  Final weights:            [%s]
",
            paste(sprintf("%.1f", rounded_weights), collapse = ", ")))
cat("=============================================================
")

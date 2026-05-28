#!/usr/bin/env Rscript
# =============================================================================
# GF Estimation Horse Race v2 — R Verification Script
# =============================================================================
# Independent R implementation of 7 estimation approaches for Great Falls (GF)
# discharge, evaluated via Leave-One-Year-Out cross-validation on 117k hourly obs.
#
# Output: analysis/horserace_v2_R.csv
# =============================================================================

set.seed(42)
options(warn = 1)  # print warnings as they occur

suppressPackageStartupMessages({
  library(readr)
  library(dplyr)
})

cat("=== GF Estimation Horse Race v2 (R) ===\n")
cat("Started:", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "\n\n")
t_start <- proc.time()

# =============================================================================
# SECTION 1: Load and Merge Data
# =============================================================================
cat("[1/8] Loading data...\n")

main_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
trib_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/tributary_hourly_data.csv"

main <- read_csv(main_path, show_col_types = FALSE)
trib <- read_csv(trib_path, show_col_types = FALSE)

cat("  Main data:", nrow(main), "rows\n")
cat("  Tributary data:", nrow(trib), "rows\n")

# Parse timestamps consistently
main$timestamp <- as.POSIXct(main$timestamp, format = "%Y-%m-%d %H:%M", tz = "UTC")
trib$timestamp <- as.POSIXct(trib$timestamp, format = "%Y-%m-%d %H:%M:%S", tz = "UTC")

# Left join tributaries
df <- merge(main, trib, by = "timestamp", all.x = TRUE)
df <- df[order(df$timestamp), ]

# Fill missing tributaries with LF-based fallback
df$monocacy_q_raw <- df$monocacy_q
df$goose_q_raw <- df$goose_q
df$monocacy_flow <- ifelse(is.na(df$monocacy_q), df$lf_discharge * 0.071, df$monocacy_q)
df$goose_flow    <- ifelse(is.na(df$goose_q),    df$lf_discharge * 0.030, df$goose_q)

# Derived columns
df$year  <- as.integer(format(df$timestamp, "%Y"))
df$month <- as.integer(format(df$timestamp, "%m"))

# Cold-water flag: use water_temp_c if available, else seasonal proxy
df$is_cold <- ifelse(!is.na(df$water_temp_c),
                     df$water_temp_c <= 10,
                     df$month %in% c(12, 1, 2, 3))

# EF power-law (v29.0 baseline)
df$ef_cfs <- ifelse(df$is_cold,
                    160 * df$ef_stage^2.36,
                    126 * df$ef_stage^2.46)

# Hourly LF change for flow state
df$hourly_change <- c(0, diff(df$lf_discharge))
df$threshold     <- pmax(100, 0.02 * df$lf_discharge)
df$flow_state    <- ifelse(df$hourly_change >= df$threshold, "rising",
                    ifelse(df$hourly_change <= -df$threshold, "falling", "steady"))

# Flow bins based on lf_discharge
df$flow_bin <- cut(df$lf_discharge,
                   breaks = c(-Inf, 2000, 5000, 10000, 20000, 50000, Inf),
                   labels = c("0-2k", "2-5k", "5-10k", "10-20k", "20-50k", "50k+"),
                   right = FALSE)

cat("  Merged data:", nrow(df), "rows\n")
cat("  Years:", paste(sort(unique(df$year)), collapse = ", "), "\n")
cat("  Tributary coverage:", sum(!is.na(df$monocacy_q_raw)), "/", nrow(df),
    sprintf("(%.1f%%)\n", 100 * sum(!is.na(df$monocacy_q_raw)) / nrow(df)))
cat("\n")

# =============================================================================
# SECTION 2: Helper Functions
# =============================================================================
cat("[2/8] Defining helpers...\n")

# --- Baseline estimation (Approach 0) ---
compute_baseline <- function(d) {
  # Base estimate with tributaries
  base_est <- d$por_lagged + d$monocacy_flow + d$goose_flow

  # PoR-delta correction
  por_change_ratio <- d$por_now / d$por_lagged
  por_change_pct   <- (por_change_ratio - 1) * 100
  staleness        <- 1.0
  frac_elapsed     <- pmin(1.0, staleness / pmax(1, d$travel_time_h))
  decay_factor     <- pmin(0.50, sqrt(frac_elapsed))
  applied_ratio    <- 1 + (por_change_ratio - 1) * decay_factor
  base_est         <- ifelse(abs(por_change_pct) > 5,
                             base_est * applied_ratio,
                             base_est)

  # EF weight and blending
  ef_weight    <- ifelse(d$lf_discharge >= 3000, 0.35, 0.0)
  discrepancy  <- ifelse(base_est > 0, abs(d$ef_cfs - base_est) / base_est, 999)
  blended      <- ifelse(discrepancy > 0.50,
                         base_est,
                         (1 - ef_weight) * base_est + ef_weight * d$ef_cfs)
  estimate     <- pmin(blended, d$lf_discharge * 1.20)

  return(estimate)
}

# --- PoR-delta correction (shared sub-function) ---
apply_por_delta <- function(base_est, por_now, por_lagged, travel_time_h) {
  por_change_ratio <- por_now / por_lagged
  por_change_pct   <- (por_change_ratio - 1) * 100
  staleness        <- 1.0
  frac_elapsed     <- pmin(1.0, staleness / pmax(1, travel_time_h))
  decay_factor     <- pmin(0.50, sqrt(frac_elapsed))
  applied_ratio    <- 1 + (por_change_ratio - 1) * decay_factor
  ifelse(abs(por_change_pct) > 5, base_est * applied_ratio, base_est)
}

# --- Standard blending (with discrepancy guard) ---
blend_standard <- function(base_est, ef_cfs, lf_discharge) {
  ef_weight   <- ifelse(lf_discharge >= 3000, 0.35, 0.0)
  discrepancy <- ifelse(base_est > 0, abs(ef_cfs - base_est) / base_est, 999)
  blended     <- ifelse(discrepancy > 0.50,
                        base_est,
                        (1 - ef_weight) * base_est + ef_weight * ef_cfs)
  pmin(blended, lf_discharge * 1.20)
}

# --- Metrics computation ---
compute_metrics <- function(actual, predicted, baseline_mse = NULL) {
  err   <- predicted - actual
  n     <- length(actual)
  rmse  <- sqrt(mean(err^2))
  mae   <- mean(abs(err))
  bias  <- mean(err)
  # Pct_Bias: mean percentage error (signed)
  pct_err  <- ifelse(actual > 0, err / actual * 100, NA)
  pct_bias <- mean(pct_err, na.rm = TRUE)
  # MdAPE: median absolute percentage error
  ape   <- ifelse(actual > 0, abs(err) / actual * 100, NA)
  mdape <- median(ape, na.rm = TRUE)
  # Skill score vs baseline
  mse   <- mean(err^2)
  skill <- if (!is.null(baseline_mse) && baseline_mse > 0) 1 - mse / baseline_mse else NA
  # Undershoot percentage
  undershoot_pct <- mean(predicted < actual) * 100

  data.frame(n = n, rmse = rmse, mae = mae, bias = bias,
             pct_bias = pct_bias, mdape = mdape,
             skill_score = skill, undershoot_pct = undershoot_pct,
             stringsAsFactors = FALSE)
}

# --- Collect metrics across scopes ---
collect_all_metrics <- function(actual, predicted, flow_bin, flow_state,
                                baseline_mse_overall = NULL,
                                baseline_mse_by_bin = NULL,
                                baseline_mse_by_state = NULL) {
  results <- list()

  # Overall
  m <- compute_metrics(actual, predicted, baseline_mse_overall)
  m$scope <- "overall"; m$flow_bin <- "all"; m$flow_state <- "all"
  results[[length(results) + 1]] <- m

  # Per flow bin
  for (b in levels(flow_bin)) {
    idx <- flow_bin == b
    if (sum(idx) < 5) next
    bm <- if (!is.null(baseline_mse_by_bin)) baseline_mse_by_bin[[b]] else NULL
    m <- compute_metrics(actual[idx], predicted[idx], bm)
    m$scope <- "per_bin"; m$flow_bin <- b; m$flow_state <- "all"
    results[[length(results) + 1]] <- m
  }

  # Per flow state (rising, steady only)
  for (s in c("rising", "steady")) {
    idx <- flow_state == s
    if (sum(idx) < 5) next
    sm <- if (!is.null(baseline_mse_by_state)) baseline_mse_by_state[[s]] else NULL
    m <- compute_metrics(actual[idx], predicted[idx], sm)
    m$scope <- "per_state"; m$flow_bin <- "all"; m$flow_state <- s
    results[[length(results) + 1]] <- m
  }

  do.call(rbind, results)
}

# --- Baseline MSE helper ---
compute_baseline_mses <- function(actual, predicted, flow_bin, flow_state) {
  err <- predicted - actual
  overall <- mean(err^2)

  by_bin <- list()
  for (b in levels(flow_bin)) {
    idx <- flow_bin == b
    if (sum(idx) >= 5) by_bin[[b]] <- mean(err[idx]^2)
  }

  by_state <- list()
  for (s in c("rising", "steady")) {
    idx <- flow_state == s
    if (sum(idx) >= 5) by_state[[s]] <- mean(err[idx]^2)
  }

  list(overall = overall, by_bin = by_bin, by_state = by_state)
}

cat("  Done.\n\n")

# =============================================================================
# SECTION 3: Define All 7 Approaches
# =============================================================================
cat("[3/8] Defining approaches...\n")

# --- Approach 0: Baseline (v29.0 with tributaries) ---
approach_0 <- function(train, test) {
  # No calibrated parameters — just apply the baseline formula
  compute_baseline(test)
}

# --- Approach 1: PoR Ratio Scaler (Continuous Interpolation) ---
approach_1 <- function(train, test) {
  anchors <- c(1500, 3500, 7500, 15000, 35000, 75000)

  # Compute base_with_tribs on training data
  train_base <- train$por_lagged + train$monocacy_flow + train$goose_flow

  # Calibrate ratios at each anchor
  ratios <- sapply(anchors, function(a) {
    lo <- a * 0.5
    hi <- a * 1.5
    idx <- train_base >= lo & train_base <= hi
    if (sum(idx) < 20) return(1.0)
    median(train$lf_discharge[idx] / train_base[idx], na.rm = TRUE)
  })

  # Apply to test data
  test_base <- test$por_lagged + test$monocacy_flow + test$goose_flow
  interp_ratio <- approx(anchors, ratios, xout = test_base, rule = 2)$y
  por_adjusted <- test_base * interp_ratio

  # PoR-delta correction
  por_adjusted <- apply_por_delta(por_adjusted, test$por_now, test$por_lagged, test$travel_time_h)

  # Standard blending
  blend_standard(por_adjusted, test$ef_cfs, test$lf_discharge)
}

# --- Approach 2: Actual Tributary Addback ---
approach_2 <- function(train, test) {
  # Grid search for UNGAUGED_SCALE on training data (only where tributaries are available)
  has_trib_train <- !is.na(train$monocacy_q_raw) & !is.na(train$goose_q_raw)
  scales <- seq(0.0, 2.0, by = 0.05)

  best_scale <- 1.0
  best_rmse  <- Inf

  if (sum(has_trib_train) >= 50) {
    tr_sub <- train[has_trib_train, ]
    actual_tribs_tr <- tr_sub$monocacy_q_raw + tr_sub$goose_q_raw

    for (s in scales) {
      ungauged  <- actual_tribs_tr * 1.50 * s
      gf_base   <- tr_sub$por_lagged + actual_tribs_tr + ungauged
      gf_base   <- apply_por_delta(gf_base, tr_sub$por_now, tr_sub$por_lagged, tr_sub$travel_time_h)
      est       <- blend_standard(gf_base, tr_sub$ef_cfs, tr_sub$lf_discharge)
      rmse_val  <- sqrt(mean((est - tr_sub$lf_discharge)^2))
      if (rmse_val < best_rmse) {
        best_rmse  <- rmse_val
        best_scale <- s
      }
    }
  }

  # Apply to test
  has_trib_test <- !is.na(test$monocacy_q_raw) & !is.na(test$goose_q_raw)
  estimate <- rep(NA_real_, nrow(test))

  # Where tributaries available
  if (sum(has_trib_test) > 0) {
    ts <- test[has_trib_test, ]
    actual_tribs <- ts$monocacy_q_raw + ts$goose_q_raw
    ungauged     <- actual_tribs * 1.50 * best_scale
    gf_base      <- ts$por_lagged + actual_tribs + ungauged
    gf_base      <- apply_por_delta(gf_base, ts$por_now, ts$por_lagged, ts$travel_time_h)
    estimate[has_trib_test] <- blend_standard(gf_base, ts$ef_cfs, ts$lf_discharge)
  }

  # Fallback to baseline where tributaries missing
  if (sum(!has_trib_test) > 0) {
    estimate[!has_trib_test] <- compute_baseline(test[!has_trib_test, ])
  }

  estimate
}

# --- Approach 3: Regression Ensemble (Log-Linear Ridge) ---
approach_3 <- function(train, test) {
  # Features: log(por_lagged), log(ef_cfs), log(monocacy_flow), log(goose_flow), por_change_ratio
  # Target: log(lf_discharge)

  build_features <- function(d) {
    # Protect against log(0) or log(negative)
    safe_log <- function(x) log(pmax(x, 1))
    por_ratio <- d$por_now / d$por_lagged
    cbind(
      log_por     = safe_log(d$por_lagged),
      log_ef      = safe_log(d$ef_cfs),
      log_mono    = safe_log(d$monocacy_flow),
      log_goose   = safe_log(d$goose_flow),
      por_ratio   = por_ratio
    )
  }

  X_train <- build_features(train)
  y_train <- log(pmax(train$lf_discharge, 1))

  X_test <- build_features(test)

  # Remove any rows with NA/NaN/Inf
  valid_train <- complete.cases(X_train) & is.finite(y_train)
  X_tr <- X_train[valid_train, , drop = FALSE]
  y_tr <- y_train[valid_train]

  # Manual Ridge regression: beta = (X'X + lambda*I)^{-1} X'y
  # Center and scale features for stability
  x_means <- colMeans(X_tr)
  x_sds   <- apply(X_tr, 2, sd)
  x_sds[x_sds == 0] <- 1  # avoid division by zero

  X_tr_s <- scale(X_tr, center = x_means, scale = x_sds)
  y_mean <- mean(y_tr)
  y_tr_c <- y_tr - y_mean

  # Cross-validate lambda on training set (5-fold)
  n_tr <- nrow(X_tr_s)
  p    <- ncol(X_tr_s)
  lambdas <- 10^seq(-2, 4, length.out = 25)
  fold_ids <- sample(rep(1:5, length.out = n_tr))

  cv_mse <- sapply(lambdas, function(lam) {
    fold_mses <- sapply(1:5, function(f) {
      tr_idx <- fold_ids != f
      va_idx <- fold_ids == f
      XtX <- crossprod(X_tr_s[tr_idx, ])
      Xty <- crossprod(X_tr_s[tr_idx, ], y_tr_c[tr_idx])
      beta <- solve(XtX + lam * diag(p), Xty)
      # Project to non-negative (soft constraint for interpretability)
      beta <- pmax(beta, 0)
      pred_c <- X_tr_s[va_idx, ] %*% beta
      mean((y_tr_c[va_idx] - pred_c)^2)
    })
    mean(fold_mses)
  })

  best_lam <- lambdas[which.min(cv_mse)]

  # Fit on full training set
  XtX  <- crossprod(X_tr_s)
  Xty  <- crossprod(X_tr_s, y_tr_c)
  beta <- solve(XtX + best_lam * diag(p), Xty)
  beta <- pmax(beta, 0)

  # Training residuals for Duan smearing
  pred_train_c <- X_tr_s %*% beta
  resid_train  <- y_tr_c - pred_train_c
  smear_factor <- mean(exp(resid_train))

  # Predict on test set
  X_te_s  <- scale(X_test, center = x_means, scale = x_sds)
  pred_c  <- X_te_s %*% beta
  log_hat <- pred_c + y_mean
  lf_hat  <- exp(log_hat) * smear_factor

  # Apply LF ceiling
  estimate <- pmin(as.numeric(lf_hat), test$lf_discharge * 1.20)
  estimate
}

# --- Approach 4: Combined Ratio + Tributaries ---
approach_4 <- function(train, test) {
  # Step 1: Calibrate UNGAUGED_SCALE on training (same as Approach 2)
  has_trib_train <- !is.na(train$monocacy_q_raw) & !is.na(train$goose_q_raw)
  scales <- seq(0.0, 2.0, by = 0.05)

  best_scale <- 1.0
  best_rmse  <- Inf

  if (sum(has_trib_train) >= 50) {
    tr_sub <- train[has_trib_train, ]
    actual_tribs_tr <- tr_sub$monocacy_q_raw + tr_sub$goose_q_raw

    for (s in scales) {
      ungauged <- actual_tribs_tr * 1.50 * s
      gf_base  <- tr_sub$por_lagged + actual_tribs_tr + ungauged
      est      <- gf_base  # quick metric for scale selection
      rmse_val <- sqrt(mean((est - tr_sub$lf_discharge)^2))
      if (rmse_val < best_rmse) {
        best_rmse  <- rmse_val
        best_scale <- s
      }
    }
  }

  # Step 2: Compute base with actual tribs + ungauged on training
  # For ratio calibration, use all training rows (fill missing tribs with LF-based)
  train_actual_tribs <- ifelse(!is.na(train$monocacy_q_raw) & !is.na(train$goose_q_raw),
                               train$monocacy_q_raw + train$goose_q_raw,
                               train$monocacy_flow + train$goose_flow)
  train_ungauged <- train_actual_tribs * 1.50 * best_scale
  train_base     <- train$por_lagged + train_actual_tribs + train_ungauged

  # Calibrate residual ratio at anchors
  anchors <- c(1500, 3500, 7500, 15000, 35000, 75000)
  ratios <- sapply(anchors, function(a) {
    lo <- a * 0.5
    hi <- a * 1.5
    idx <- train_base >= lo & train_base <= hi
    if (sum(idx) < 20) return(1.0)
    median(train$lf_discharge[idx] / train_base[idx], na.rm = TRUE)
  })

  # Step 3: Apply to test
  test_actual_tribs <- ifelse(!is.na(test$monocacy_q_raw) & !is.na(test$goose_q_raw),
                              test$monocacy_q_raw + test$goose_q_raw,
                              test$monocacy_flow + test$goose_flow)
  test_ungauged <- test_actual_tribs * 1.50 * best_scale
  test_base     <- test$por_lagged + test_actual_tribs + test_ungauged

  # Apply ratio interpolation
  interp_ratio <- approx(anchors, ratios, xout = test_base, rule = 2)$y
  adjusted     <- test_base * interp_ratio

  # PoR-delta correction
  adjusted <- apply_por_delta(adjusted, test$por_now, test$por_lagged, test$travel_time_h)

  # Standard blending
  blend_standard(adjusted, test$ef_cfs, test$lf_discharge)
}

# --- Approach 5: EF-Dominant (Logistic Weight Function) ---
approach_5 <- function(train, test) {
  # Grid search over w_max, k, midpoint
  w_max_vals    <- seq(0.30, 0.80, by = 0.05)
  k_vals        <- seq(0.5, 5.0, by = 0.5)
  midpoint_vals <- seq(2000, 10000, by = 1000)

  # Pre-compute training base with PoR-delta
  train_base <- train$por_lagged + train$monocacy_flow + train$goose_flow
  train_base <- apply_por_delta(train_base, train$por_now, train$por_lagged, train$travel_time_h)

  log_lf_train <- log(pmax(train$lf_discharge, 1))

  best_rmse <- Inf
  best_params <- c(w_max = 0.5, k = 2.0, midpoint = 5000)

  for (wm in w_max_vals) {
    for (kk in k_vals) {
      for (mp in midpoint_vals) {
        ew <- wm / (1 + exp(-kk * (log_lf_train - log(mp))))
        # NO discrepancy guard
        blended <- (1 - ew) * train_base + ew * train$ef_cfs
        est     <- pmin(blended, train$lf_discharge * 1.20)
        rmse_val <- sqrt(mean((est - train$lf_discharge)^2))
        if (rmse_val < best_rmse) {
          best_rmse <- rmse_val
          best_params <- c(w_max = wm, k = kk, midpoint = mp)
        }
      }
    }
  }

  # Apply to test
  test_base <- test$por_lagged + test$monocacy_flow + test$goose_flow
  test_base <- apply_por_delta(test_base, test$por_now, test$por_lagged, test$travel_time_h)

  log_lf_test <- log(pmax(test$lf_discharge, 1))
  ew <- best_params["w_max"] / (1 + exp(-best_params["k"] * (log_lf_test - log(best_params["midpoint"]))))
  blended <- (1 - ew) * test_base + ew * test$ef_cfs
  pmin(blended, test$lf_discharge * 1.20)
}

# --- Approach 6: EF Power-Law Refit ---
approach_6 <- function(train, test) {
  # Fit log(lf_discharge) = log(a) + b * log(ef_stage) separately for cold/warm
  # on training data

  fit_powerlaw <- function(ef_stage, lf_q) {
    valid <- ef_stage > 0 & lf_q > 0
    if (sum(valid) < 30) return(c(a = 126, b = 2.46))  # fallback
    fit <- lm(log(lf_q[valid]) ~ log(ef_stage[valid]))
    cf <- unname(coef(fit))
    c(a = exp(cf[1]), b = cf[2])
  }

  # Cold observations
  cold_idx <- train$is_cold
  warm_idx <- !train$is_cold

  cold_params <- fit_powerlaw(train$ef_stage[cold_idx], train$lf_discharge[cold_idx])
  warm_params <- fit_powerlaw(train$ef_stage[warm_idx], train$lf_discharge[warm_idx])

  # New EF estimate on test data
  ef_cfs_new <- ifelse(test$is_cold,
                       cold_params["a"] * test$ef_stage^cold_params["b"],
                       warm_params["a"] * test$ef_stage^warm_params["b"])

  # Everything else same as baseline, but using ef_cfs_new
  base_est <- test$por_lagged + test$monocacy_flow + test$goose_flow
  base_est <- apply_por_delta(base_est, test$por_now, test$por_lagged, test$travel_time_h)

  # Same blending with SAME ef_weight as baseline
  ef_weight   <- ifelse(test$lf_discharge >= 3000, 0.35, 0.0)
  discrepancy <- ifelse(base_est > 0, abs(ef_cfs_new - base_est) / base_est, 999)
  blended     <- ifelse(discrepancy > 0.50,
                        base_est,
                        (1 - ef_weight) * base_est + ef_weight * ef_cfs_new)
  pmin(blended, test$lf_discharge * 1.20)
}

approach_list <- list(approach_0, approach_1, approach_2, approach_3,
                      approach_4, approach_5, approach_6)
approach_names <- paste0("approach_", 0:6)

cat("  7 approaches defined.\n\n")

# =============================================================================
# SECTION 4: In-Sample Evaluation (Full Dataset)
# =============================================================================
cat("[4/8] Running in-sample evaluation...\n")

insample_results <- list()

# Run baseline first to get MSE denominators
baseline_pred <- approach_0(df, df)
baseline_mses <- compute_baseline_mses(df$lf_discharge, baseline_pred, df$flow_bin, df$flow_state)

for (i in seq_along(approach_list)) {
  aname <- approach_names[i]
  cat("  ", aname, "... ")

  pred <- approach_list[[i]](df, df)
  metrics <- collect_all_metrics(
    df$lf_discharge, pred, df$flow_bin, df$flow_state,
    baseline_mses$overall, baseline_mses$by_bin, baseline_mses$by_state
  )
  metrics$approach  <- aname
  metrics$eval_type <- "insample"
  insample_results[[i]] <- metrics

  cat(sprintf("RMSE=%.1f\n", metrics$rmse[metrics$scope == "overall"]))
}

insample_df <- do.call(rbind, insample_results)
cat("  In-sample done.\n\n")

# =============================================================================
# SECTION 5: Leave-One-Year-Out Cross-Validation
# =============================================================================
cat("[5/8] Running LOYO cross-validation...\n")

# CV folds: 2012-2025 (14 folds)
# 2011 partial + 2026 partial = training only
cv_years <- 2012:2025
buffer_hours <- 48

oos_predictions <- rep(NA_real_, nrow(df))  # store per-approach later
all_oos_results <- list()

for (ai in seq_along(approach_list)) {
  aname <- approach_names[ai]
  cat("  ", aname, ": ")

  # Collect predictions across folds
  fold_preds <- rep(NA_real_, nrow(df))

  for (y in cv_years) {
    cat(y %% 100, " ", sep = "")

    # Define held-out year boundaries
    year_start <- as.POSIXct(paste0(y, "-01-01 00:00"), tz = "UTC")
    year_end   <- as.POSIXct(paste0(y + 1, "-01-01 00:00"), tz = "UTC")

    # Training = everything outside held-out year
    test_mask  <- df$timestamp >= year_start & df$timestamp < year_end
    train_mask <- !test_mask

    # 48-hour buffer: exclude first/last 48 hours from evaluation
    eval_start <- year_start + buffer_hours * 3600
    eval_end   <- year_end - buffer_hours * 3600
    eval_mask  <- df$timestamp >= eval_start & df$timestamp < eval_end & test_mask

    train_data <- df[train_mask, ]
    test_data  <- df[test_mask, ]

    # Get predictions for test fold
    preds <- tryCatch(
      approach_list[[ai]](train_data, test_data),
      error = function(e) {
        warning(sprintf("  [%s fold %d] Error: %s", aname, y, e$message))
        rep(NA_real_, sum(test_mask))
      }
    )

    # Store only eval-eligible predictions (within buffer)
    eval_within_fold <- df$timestamp[test_mask] >= eval_start &
                        df$timestamp[test_mask] < eval_end
    fold_preds[test_mask][eval_within_fold] <- preds[eval_within_fold]
  }
  cat("\n")

  # Evaluate OOS predictions
  valid_oos <- !is.na(fold_preds) & !is.na(df$lf_discharge)

  if (sum(valid_oos) < 100) {
    warning(sprintf("  [%s] Only %d valid OOS predictions!", aname, sum(valid_oos)))
    next
  }

  # Baseline OOS MSEs for skill score
  if (ai == 1) {
    # For approach_0 (baseline), store OOS predictions for skill denominators
    baseline_oos_preds <- fold_preds
    baseline_oos_valid <- valid_oos
    baseline_oos_mses <- compute_baseline_mses(
      df$lf_discharge[valid_oos], fold_preds[valid_oos],
      df$flow_bin[valid_oos], df$flow_state[valid_oos]
    )
  }

  # Compute metrics on common valid set (intersection with baseline valid)
  common_valid <- valid_oos & baseline_oos_valid

  metrics <- collect_all_metrics(
    df$lf_discharge[common_valid], fold_preds[common_valid],
    df$flow_bin[common_valid], df$flow_state[common_valid],
    baseline_oos_mses$overall, baseline_oos_mses$by_bin, baseline_oos_mses$by_state
  )
  metrics$approach  <- aname
  metrics$eval_type <- "oos"
  all_oos_results[[ai]] <- metrics
}

oos_df <- do.call(rbind, all_oos_results)
cat("  Cross-validation done.\n\n")

# =============================================================================
# SECTION 6: Combine Results
# =============================================================================
cat("[6/8] Combining results...\n")

all_results <- rbind(insample_df, oos_df)

# Order columns for output
all_results <- all_results[, c("approach", "eval_type", "scope", "flow_bin",
                                "flow_state", "n", "rmse", "mae", "bias",
                                "pct_bias", "mdape", "skill_score", "undershoot_pct")]

# Sort for readability
all_results <- all_results[order(all_results$approach, all_results$eval_type,
                                  all_results$scope, all_results$flow_bin,
                                  all_results$flow_state), ]
rownames(all_results) <- NULL

cat("  Total result rows:", nrow(all_results), "\n\n")

# =============================================================================
# SECTION 7: Save Output
# =============================================================================
cat("[7/8] Saving output...\n")

out_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/horserace_v2_R.csv"
write_csv(all_results, out_path)
cat("  Saved to:", out_path, "\n\n")

# =============================================================================
# SECTION 8: Summary
# =============================================================================
cat("[8/8] Summary\n")
cat("=" , rep("=", 79), "\n", sep = "")

# Print OOS overall comparison
oos_overall <- all_results[all_results$eval_type == "oos" & all_results$scope == "overall", ]
cat("\nOOS Overall Comparison:\n")
cat(sprintf("  %-15s  %8s  %8s  %8s  %8s  %8s\n",
            "Approach", "RMSE", "MAE", "Bias", "MdAPE%", "Skill"))
cat("  ", strrep("-", 65), "\n", sep = "")
for (i in seq_len(nrow(oos_overall))) {
  r <- oos_overall[i, ]
  cat(sprintf("  %-15s  %8.1f  %8.1f  %8.1f  %7.1f%%  %7.3f\n",
              r$approach, r$rmse, r$mae, r$bias, r$mdape, r$skill_score))
}

# Print insample overall comparison
is_overall <- all_results[all_results$eval_type == "insample" & all_results$scope == "overall", ]
cat("\nInsample Overall Comparison:\n")
cat(sprintf("  %-15s  %8s  %8s  %8s  %8s  %8s\n",
            "Approach", "RMSE", "MAE", "Bias", "MdAPE%", "Skill"))
cat("  ", strrep("-", 65), "\n", sep = "")
for (i in seq_len(nrow(is_overall))) {
  r <- is_overall[i, ]
  cat(sprintf("  %-15s  %8.1f  %8.1f  %8.1f  %7.1f%%  %7.3f\n",
              r$approach, r$rmse, r$mae, r$bias, r$mdape, r$skill_score))
}

elapsed <- (proc.time() - t_start)["elapsed"]
cat(sprintf("\nCompleted in %.1f minutes.\n", elapsed / 60))
cat("=== Done ===\n")

#!/usr/bin/env Rscript
# optimize_gradient_weights_hourly_v2_verify.R
# Independent R verification of Python hourly v2 gradient weight optimization.
# Cross-language replication per CLAUDE.md analysis verification requirements.

cat(paste(rep("=", 70), collapse=""), "\n")
cat("R VERIFICATION: optimize_gradient_weights_hourly_v2\n")
cat(paste(rep("=", 70), collapse=""), "\n\n")

# ── Configuration ──────────────────────────────────────────────────────────
ANCHOR_FLOWS <- c(0, 3000, 6000, 10000, 15000, 25000, 50000)
INITIAL_WEIGHTS <- c(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)  # Zero init
W_MIN <- 0.0
W_MAX <- 0.80
COARSE_STEP <- 0.05
FINE_RADIUS <- 0.05
FINE_STEP <- 0.01
N_COARSE_PASSES <- 5
N_FINE_PASSES <- 3
ROUND_DECIMALS <- 2

CURRENT_WEIGHTS <- c(0.0, 0.0, 0.1, 0.4, 0.4, 0.4, 0.4)
PREVIOUS_HOURLY_WEIGHTS <- c(0.0, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4)

DATA_PATH <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
OUT_CSV <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/gradient_weights_hourly_v2_R.csv"

REGIME_BINS <- list(
  list(label="<3k", lo=0, hi=3000),
  list(label="3-6k", lo=3000, hi=6000),
  list(label="6-10k", lo=6000, hi=10000),
  list(label="10-15k", lo=10000, hi=15000),
  list(label="15-25k", lo=15000, hi=25000),
  list(label="25-50k", lo=25000, hi=50000),
  list(label=">50k", lo=50000, hi=Inf)
)

RISING_THRESHOLD <- 0.05

# ── Load data ──────────────────────────────────────────────────────────────
df <- read.csv(DATA_PATH, stringsAsFactors = FALSE)
df$timestamp <- as.POSIXct(df$timestamp, format="%Y-%m-%d %H:%M")
cat(sprintf("Loaded %d hourly observations\n", nrow(df)))
cat(sprintf("Date range: %s to %s\n", min(df$timestamp), max(df$timestamp)))

# Filter valid rows
mask <- (df$por_lagged > 0) & (df$ef_stage > 0) & (df$lf_discharge > 0)
df <- df[mask, ]
cat(sprintf("Valid rows after filtering: %d\n", nrow(df)))

# EF power-law prediction
has_temp <- !is.na(df$water_temp_c)
cold <- has_temp & (df$water_temp_c <= 10.0)

df$ef_cfs <- 126.0 * df$ef_stage^2.46
df$ef_cfs[cold] <- 160.0 * df$ef_stage[cold]^2.36

n_cold <- sum(cold)
n_default <- nrow(df) - n_cold
cat(sprintf("EF model: %d rows default, %d rows cold-water\n", n_default, n_cold))

# Extract year
df$year <- as.integer(format(df$timestamp, "%Y"))

# Rising events
por_vals <- df$por_lagged
rising <- rep(FALSE, nrow(df))
for (i in 2:nrow(df)) {
  if (por_vals[i-1] > 0) {
    if ((por_vals[i] - por_vals[i-1]) / por_vals[i-1] > RISING_THRESHOLD) {
      rising[i] <- TRUE
    }
  }
}
df$rising <- rising
cat(sprintf("Rising events: %d (%.1f%%)\n", sum(rising), sum(rising)/nrow(df)*100))

# Extract arrays
por_shifted <- df$por_lagged
ef_cfs <- df$ef_cfs
lf_actual <- df$lf_discharge
years <- df$year

# ── Helper functions ───────────────────────────────────────────────────────
interpolate_weights <- function(flows, anchor_flows, anchor_weights) {
  approx(anchor_flows, anchor_weights, xout=flows, rule=2)$y
}

compute_rmse <- function(lf_actual, por_shifted, ef_cfs, anchor_flows, anchor_weights) {
  w_vec <- interpolate_weights(por_shifted, anchor_flows, anchor_weights)
  estimated <- (1 - w_vec) * por_shifted + w_vec * ef_cfs
  sqrt(mean((estimated - lf_actual)^2))
}

enforce_monotonicity <- function(weights) {
  w <- weights
  for (i in 2:length(w)) {
    if (w[i] < w[i-1]) w[i] <- w[i-1]
  }
  w
}

coordinate_descent <- function(lf_actual, por_shifted, ef_cfs, initial_weights, verbose=TRUE) {
  weights <- initial_weights
  coarse_grid <- seq(W_MIN, W_MAX, by=COARSE_STEP)

  # Coarse passes
  for (pass_num in 1:N_COARSE_PASSES) {
    for (a in 1:length(ANCHOR_FLOWS)) {
      best_w <- weights[a]
      best_rmse <- Inf
      for (candidate in coarse_grid) {
        trial <- weights
        trial[a] <- candidate
        trial <- enforce_monotonicity(trial)
        rmse <- compute_rmse(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, trial)
        if (rmse < best_rmse) {
          best_rmse <- rmse
          best_w <- candidate
        }
      }
      weights[a] <- best_w
      weights <- enforce_monotonicity(weights)
    }
    if (verbose) {
      rmse_now <- compute_rmse(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, weights)
      cat(sprintf("  Coarse pass %d: RMSE=%.1f  weights=[%s]\n", pass_num, rmse_now,
                  paste(round(weights, 2), collapse=", ")))
    }
  }

  # Fine passes
  for (pass_num in 1:N_FINE_PASSES) {
    for (a in 1:length(ANCHOR_FLOWS)) {
      lo <- max(W_MIN, weights[a] - FINE_RADIUS)
      hi <- min(W_MAX, weights[a] + FINE_RADIUS)
      fine_grid <- seq(lo, hi, by=FINE_STEP)
      best_w <- weights[a]
      best_rmse <- Inf
      for (candidate in fine_grid) {
        trial <- weights
        trial[a] <- round(candidate, 4)
        trial <- enforce_monotonicity(trial)
        rmse <- compute_rmse(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, trial)
        if (rmse < best_rmse) {
          best_rmse <- rmse
          best_w <- round(candidate, 4)
        }
      }
      weights[a] <- best_w
      weights <- enforce_monotonicity(weights)
    }
    if (verbose) {
      rmse_now <- compute_rmse(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, weights)
      cat(sprintf("  Fine pass %d: RMSE=%.2f  weights=[%s]\n", pass_num, rmse_now,
                  paste(round(weights, 2), collapse=", ")))
    }
  }

  weights_rounded <- round(weights, ROUND_DECIMALS)
  weights_rounded <- enforce_monotonicity(weights_rounded)
  weights_rounded
}

# ── Run optimization ──────────────────────────────────────────────────────
cat(sprintf("\nN valid rows: %d\n", nrow(df)))

# Baselines
current_rmse <- compute_rmse(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, CURRENT_WEIGHTS)
prev_hourly_rmse <- compute_rmse(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, PREVIOUS_HOURLY_WEIGHTS)

cat(sprintf("\nBaselines:\n"))
cat(sprintf("  Current v28.0:     RMSE=%.1f cfs\n", current_rmse))
cat(sprintf("  Previous hourly:   RMSE=%.1f cfs\n", prev_hourly_rmse))

cat(sprintf("\nCoordinate descent (zero-init):\n"))
weights_new <- coordinate_descent(lf_actual, por_shifted, ef_cfs, INITIAL_WEIGHTS, verbose=TRUE)

new_rmse <- compute_rmse(lf_actual, por_shifted, ef_cfs, ANCHOR_FLOWS, weights_new)

cat(sprintf("\n%s\n", paste(rep("=", 70), collapse="")))
cat(sprintf("R RESULTS\n"))
cat(sprintf("%s\n", paste(rep("=", 70), collapse="")))
cat(sprintf("Optimal weights: [%s]\n", paste(sprintf("%.2f", weights_new), collapse=", ")))
cat(sprintf("New RMSE:        %.1f cfs\n", new_rmse))
cat(sprintf("Current RMSE:    %.1f cfs\n", current_rmse))
cat(sprintf("Prev hourly RMSE:%.1f cfs\n", prev_hourly_rmse))
cat(sprintf("Improvement vs current: %.1f cfs (%.1f%%)\n",
            current_rmse - new_rmse, (current_rmse - new_rmse)/current_rmse*100))

# ── RMSE by flow regime ──────────────────────────────────────────────────
cat(sprintf("\nRMSE by flow regime:\n"))
cat(sprintf("%10s %8s %10s %10s %10s\n", "Regime", "N", "New", "Current", "Diff"))

for (bin in REGIME_BINS) {
  mask <- (por_shifted >= bin$lo) & (por_shifted < bin$hi)
  n <- sum(mask)
  if (n == 0) {
    cat(sprintf("%10s %8d %10s %10s %10s\n", bin$label, n, "n/a", "n/a", ""))
  } else {
    w_new <- interpolate_weights(por_shifted[mask], ANCHOR_FLOWS, weights_new)
    est_new <- (1 - w_new) * por_shifted[mask] + w_new * ef_cfs[mask]
    r_new <- sqrt(mean((est_new - lf_actual[mask])^2))

    w_cur <- interpolate_weights(por_shifted[mask], ANCHOR_FLOWS, CURRENT_WEIGHTS)
    est_cur <- (1 - w_cur) * por_shifted[mask] + w_cur * ef_cfs[mask]
    r_cur <- sqrt(mean((est_cur - lf_actual[mask])^2))

    cat(sprintf("%10s %8d %10.1f %10.1f %+10.1f\n", bin$label, n, r_new, r_cur, r_new - r_cur))
  }
}

# ── Leave-one-year-out CV ────────────────────────────────────────────────
cat(sprintf("\nLeave-one-year-out CV:\n"))
cat(sprintf("%10s %10s %10s %10s %10s %10s\n", "Holdout", "N_train", "N_test", "New", "Current", "Diff"))

unique_years <- sort(unique(years))
cv_new_list <- c()
cv_cur_list <- c()

for (holdout in unique_years) {
  train_mask <- years != holdout
  test_mask <- years == holdout
  n_train <- sum(train_mask)
  n_test <- sum(test_mask)

  if (n_test == 0) next

  cv_w <- coordinate_descent(lf_actual[train_mask], por_shifted[train_mask],
                             ef_cfs[train_mask], INITIAL_WEIGHTS, verbose=FALSE)

  cv_rmse <- compute_rmse(lf_actual[test_mask], por_shifted[test_mask],
                          ef_cfs[test_mask], ANCHOR_FLOWS, cv_w)
  cur_rmse <- compute_rmse(lf_actual[test_mask], por_shifted[test_mask],
                           ef_cfs[test_mask], ANCHOR_FLOWS, CURRENT_WEIGHTS)

  cv_new_list <- c(cv_new_list, cv_rmse)
  cv_cur_list <- c(cv_cur_list, cur_rmse)

  cat(sprintf("%10d %10d %10d %10.1f %10.1f %+10.1f\n",
              holdout, n_train, n_test, cv_rmse, cur_rmse, cv_rmse - cur_rmse))
}

avg_new <- mean(cv_new_list)
avg_cur <- mean(cv_cur_list)
cat(sprintf("%10s %10s %10s %10.1f %10.1f %+10.1f\n", "Average", "", "", avg_new, avg_cur, avg_new - avg_cur))

# ── Save CSV ─────────────────────────────────────────────────────────────
out_df <- data.frame(
  anchor_flow = as.integer(ANCHOR_FLOWS),
  optimal_weight_v2_R = weights_new,
  current_weight = CURRENT_WEIGHTS,
  prev_hourly_weight = PREVIOUS_HOURLY_WEIGHTS
)
write.csv(out_df, OUT_CSV, row.names=FALSE)
cat(sprintf("\nSaved: %s\n", OUT_CSV))

# ── Cross-check with Python results ─────────────────────────────────────
python_csv <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/gradient_weights_hourly_v2_python.csv"
if (file.exists(python_csv)) {
  py_df <- read.csv(python_csv)
  cat(sprintf("\n%s\n", paste(rep("=", 70), collapse="")))
  cat("CROSS-LANGUAGE VERIFICATION\n")
  cat(sprintf("%s\n", paste(rep("=", 70), collapse="")))

  max_diff <- max(abs(py_df$optimal_weight_v2 - weights_new))
  cat(sprintf("Max weight difference (Python vs R): %.4f\n", max_diff))

  if (max_diff < 0.02) {
    cat("PASS: Weights match within tolerance (0.02)\n")
  } else {
    cat("FAIL: Weights differ beyond tolerance!\n")
    cat(sprintf("  Python: [%s]\n", paste(sprintf("%.2f", py_df$optimal_weight_v2), collapse=", ")))
    cat(sprintf("  R:      [%s]\n", paste(sprintf("%.2f", weights_new), collapse=", ")))
  }

  rmse_diff <- abs(new_rmse - 1675.6)  # Python RMSE
  cat(sprintf("RMSE difference: %.1f cfs\n", rmse_diff))
  if (rmse_diff < 1.0) {
    cat("PASS: RMSE matches within 1.0 cfs\n")
  } else {
    cat(sprintf("WARNING: RMSE differs by %.1f cfs\n", rmse_diff))
  }
} else {
  cat("Python CSV not found — run Python script first for cross-check.\n")
}

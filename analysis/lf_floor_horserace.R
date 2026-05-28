#!/usr/bin/env Rscript
# LF Floor Horserace: Compare 5 approaches for handling GF < LF
# Independent R verification of Python analysis
set.seed(42)

cat("================================================================================\n")
cat("LF Floor Horserace: Comparing 5 Approaches (R)\n")
cat("================================================================================\n\n")

# ── Load data ──────────────────────────────────────────────────────────────
data_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv"
df <- read.csv(data_path, stringsAsFactors = FALSE)
df$timestamp <- as.POSIXct(df$timestamp, format = "%Y-%m-%d %H:%M")

cat(sprintf("Loaded %d observations (%s to %s)\n",
            nrow(df),
            format(min(df$timestamp, na.rm = TRUE), "%Y-%m-%d"),
            format(max(df$timestamp, na.rm = TRUE), "%Y-%m-%d")))
cat(sprintf("Columns: %s\n", paste(names(df), collapse = ", ")))
cat(sprintf("NA in water_temp_c: %d (%.1f%%)\n\n",
            sum(is.na(df$water_temp_c)),
            100 * mean(is.na(df$water_temp_c))))

# ── Helpers ────────────────────────────────────────────────────────────────
get_flow_bin <- function(q) {
  cut(q, breaks = c(0, 2000, 5000, 10000, 20000, 50000, Inf),
      labels = c("0-2k", "2-5k", "5-10k", "10-20k", "20-50k", "50k+"),
      right = FALSE)
}

compute_baseline <- function(d, decay_cap = 0.50) {
  ef_cfs <- ifelse(!is.na(d$water_temp_c) & d$water_temp_c <= 10,
                   160 * d$ef_stage^2.36,
                   126 * d$ef_stage^2.46)
  base_estimate <- d$por_lagged
  por_change_ratio <- d$por_now / d$por_lagged
  por_change_pct <- (por_change_ratio - 1) * 100
  staleness <- d$travel_time_h
  fraction_elapsed <- pmin(1.0, staleness / pmax(1, d$travel_time_h))
  decay_factor <- pmin(decay_cap, sqrt(fraction_elapsed))
  applied_ratio <- 1 + (por_change_ratio - 1) * decay_factor
  base_estimate <- ifelse(abs(por_change_pct) > 5,
                          base_estimate * applied_ratio,
                          base_estimate)
  hourly_change <- c(0, diff(d$lf_discharge))  # Use 0 for first obs (match Python)
  threshold <- pmax(100, 0.02 * d$lf_discharge)
  flow_state <- ifelse(hourly_change >= threshold, "rising",
                ifelse(hourly_change <= -threshold, "falling", "steady"))
  ef_weight <- ifelse(d$lf_discharge >= 3000, 0.35, 0.0)
  discrepancy <- ifelse(base_estimate > 0,
                        abs(ef_cfs - base_estimate) / base_estimate,
                        999.0)
  blended <- ifelse(discrepancy > 0.50,
                    base_estimate,
                    (1 - ef_weight) * base_estimate + ef_weight * ef_cfs)
  blended <- ifelse(d$lf_discharge > 0,
                    pmin(blended, d$lf_discharge * 1.20),
                    blended)
  list(blended = blended, ef_cfs = ef_cfs, flow_state = flow_state)
}

compute_metrics <- function(estimate, actual) {
  err <- estimate - actual
  n <- length(err)
  rmse <- sqrt(mean(err^2, na.rm = TRUE))
  mae  <- mean(abs(err), na.rm = TRUE)
  bias <- mean(err, na.rm = TRUE)
  pct_err <- ifelse(actual > 0, abs(err / actual) * 100, NA)
  mdape <- median(pct_err, na.rm = TRUE)
  pct_below <- 100 * mean(estimate < actual, na.rm = TRUE)
  pct_above_120 <- 100 * mean(estimate > 1.20 * actual, na.rm = TRUE)
  data.frame(n = n, rmse = round(rmse, 2), mae = round(mae, 2),
             bias = round(bias, 2), mdape = round(mdape, 4),
             pct_below_lf = round(pct_below, 4),
             pct_above_120_lf = round(pct_above_120, 4),
             stringsAsFactors = FALSE)
}

# ── Approach 0: Baseline ──────────────────────────────────────────────────
cat("Computing Approach 0: Baseline\n")
bl <- compute_baseline(df, decay_cap = 0.50)
df$blended <- bl$blended
df$flow_state <- bl$flow_state
df$flow_bin <- get_flow_bin(df$lf_discharge)
lf <- df$lf_discharge

# ── Approach 1: Simple LF Floor ──────────────────────────────────────────
cat("Computing Approach 1: Simple LF Floor\n")
est_1 <- pmax(df$blended, lf)

# ── Approach 2: LF-Anchored Rising Correction ────────────────────────────
cat("Computing Approach 2: LF-Anchored Rising Correction\n")
bins_ordered <- c("0-2k", "2-5k", "5-10k", "10-20k", "20-50k", "50k+")
mask_under_rising <- (df$blended < lf) & (df$flow_state == "rising")

uplift_factors <- setNames(rep(1.0, 6), bins_ordered)
cat("  Calibrating uplift factors:\n")
for (b in bins_ordered) {
  mask <- mask_under_rising & (df$flow_bin == b)
  n_bin <- sum(mask, na.rm = TRUE)
  if (n_bin > 0) {
    ratios <- lf[mask] / df$blended[mask]
    med_ratio <- median(ratios, na.rm = TRUE)
    uplift <- max(1.0, min(1.20, med_ratio))
    uplift_factors[b] <- uplift
    cat(sprintf("    %8s: median=%.4f, capped=%.4f, n=%d\n", b, med_ratio, uplift, n_bin))
  } else {
    cat(sprintf("    %8s: no obs, uplift=1.0\n", b))
  }
}

est_2 <- df$blended
mask_under <- df$blended < lf
mask_rising <- df$flow_state == "rising"
for (b in bins_ordered) {
  mask <- mask_under & mask_rising & (df$flow_bin == b)
  est_2[mask] <- lf[mask] * uplift_factors[b]
}

# ── Approach 3: Raised Decay Cap (0.75) ──────────────────────────────────
cat("Computing Approach 3: Raised Decay Cap (0.75)\n")
bl_075 <- compute_baseline(df, decay_cap = 0.75)
est_3 <- bl_075$blended

# ── Approach 4: Hybrid (Floor + Rising Uplift) ───────────────────────────
cat("Computing Approach 4: Hybrid\n")
est_4 <- pmax(df$blended, lf)
floor_binding <- df$blended < lf
for (b in bins_ordered) {
  mask <- floor_binding & mask_rising & (df$flow_bin == b)
  est_4[mask] <- lf[mask] * uplift_factors[b]
}

# ── Compute metrics ──────────────────────────────────────────────────────
cat("\nComputing metrics...\n")
approaches <- c("0_baseline", "1_lf_floor", "2_rising_uplift", "3_decay_075", "4_hybrid")
estimates <- list(df$blended, est_1, est_2, est_3, est_4)
names(estimates) <- approaches

results <- data.frame()
for (i in seq_along(approaches)) {
  a <- approaches[i]
  est <- estimates[[i]]

  # Overall
  m <- compute_metrics(est, lf)
  m$approach <- a; m$scope <- "overall"; m$flow_bin <- "all"; m$flow_state <- "all"
  results <- rbind(results, m)

  # Per bin
  for (b in bins_ordered) {
    mask <- df$flow_bin == b
    if (sum(mask) > 0) {
      m <- compute_metrics(est[mask], lf[mask])
      m$approach <- a; m$scope <- "per_bin"; m$flow_bin <- b; m$flow_state <- "all"
      results <- rbind(results, m)
    }
  }

  # Per state
  for (s in c("rising", "falling", "steady")) {
    mask <- df$flow_state == s
    if (sum(mask) > 0) {
      m <- compute_metrics(est[mask], lf[mask])
      m$approach <- a; m$scope <- "per_state"; m$flow_bin <- "all"; m$flow_state <- s
      results <- rbind(results, m)
    }
  }

  # Per bin x state
  for (b in bins_ordered) {
    for (s in c("rising", "falling", "steady")) {
      mask <- (df$flow_bin == b) & (df$flow_state == s)
      if (sum(mask) > 0) {
        m <- compute_metrics(est[mask], lf[mask])
        m$approach <- a; m$scope <- "per_bin_state"; m$flow_bin <- b; m$flow_state <- s
        results <- rbind(results, m)
      }
    }
  }
}

# Reorder columns
results <- results[, c("approach", "scope", "flow_bin", "flow_state",
                        "n", "rmse", "mae", "bias", "mdape",
                        "pct_below_lf", "pct_above_120_lf")]

# ── Save CSV ─────────────────────────────────────────────────────────────
out_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/lf_floor_horserace_R.csv"
write.csv(results, out_path, row.names = FALSE)
cat(sprintf("\nResults saved to: %s\n", out_path))
cat(sprintf("Total rows: %d\n\n", nrow(results)))

# ── Summary ──────────────────────────────────────────────────────────────
cat("================================================================================\n")
cat("OVERALL COMPARISON\n")
cat("================================================================================\n")
overall <- results[results$scope == "overall", ]
overall <- overall[order(overall$rmse), ]
for (i in seq_len(nrow(overall))) {
  r <- overall[i, ]
  cat(sprintf("  %-20s N=%d  RMSE=%.2f  MAE=%.2f  Bias=%.2f  MdAPE=%.4f  %%<LF=%.2f  %%>120%%=%.2f\n",
              r$approach, r$n, r$rmse, r$mae, r$bias, r$mdape, r$pct_below_lf, r$pct_above_120_lf))
}

baseline_rmse <- overall$rmse[overall$approach == "0_baseline"]
cat(sprintf("\nBaseline RMSE: %.2f\n", baseline_rmse))
for (a in approaches) {
  if (a == "0_baseline") next
  rmse_a <- overall$rmse[overall$approach == a]
  delta <- rmse_a - baseline_rmse
  pct <- delta / baseline_rmse * 100
  cat(sprintf("  %s: RMSE=%.2f (%+.2f, %+.2f%%)\n", a, rmse_a, delta, pct))
}

cat("\n================================================================================\n")
cat("PER FLOW STATE\n")
cat("================================================================================\n")
for (s in c("rising", "falling", "steady")) {
  cat(sprintf("\n  %s:\n", toupper(s)))
  ss <- results[results$scope == "per_state" & results$flow_state == s, ]
  ss <- ss[order(ss$rmse), ]
  for (i in seq_len(nrow(ss))) {
    r <- ss[i, ]
    cat(sprintf("    %-20s RMSE=%.2f MAE=%.2f Bias=%.2f %%<LF=%.2f\n",
                r$approach, r$rmse, r$mae, r$bias, r$pct_below_lf))
  }
}

cat("\n================================================================================\n")
cat("UPLIFT FACTORS\n")
cat("================================================================================\n")
for (b in bins_ordered) {
  n_b <- sum(mask_under_rising & (df$flow_bin == b), na.rm = TRUE)
  cat(sprintf("  %8s: %.4f (n=%d)\n", b, uplift_factors[b], n_b))
}

cat("\n================================================================================\n")
cat("FLOOR BINDING STATS\n")
cat("================================================================================\n")
n_under <- sum(df$blended < lf)
n_under_rising <- sum((df$blended < lf) & (df$flow_state == "rising"))
n_under_steady <- sum((df$blended < lf) & (df$flow_state == "steady"))
n_under_falling <- sum((df$blended < lf) & (df$flow_state == "falling"))
cat(sprintf("  Baseline < LF: %d / %d (%.1f%%)\n", n_under, nrow(df), 100*n_under/nrow(df)))
cat(sprintf("    Rising:  %d (%.1f%%)\n", n_under_rising, 100*n_under_rising/n_under))
cat(sprintf("    Steady:  %d (%.1f%%)\n", n_under_steady, 100*n_under_steady/n_under))
cat(sprintf("    Falling: %d (%.1f%%)\n", n_under_falling, 100*n_under_falling/n_under))

undershoot <- (lf[df$blended < lf] - df$blended[df$blended < lf]) / lf[df$blended < lf] * 100
cat(sprintf("\n  Median undershoot: %.2f%% of LF\n", median(undershoot)))
cat(sprintf("  Mean undershoot:   %.2f%% of LF\n", mean(undershoot)))
cat(sprintf("  90th pctile:       %.2f%% of LF\n", quantile(undershoot, 0.90)))

winner <- overall[1, ]
cat(sprintf("\n  WINNER: %s (RMSE=%.2f)\n", winner$approach, winner$rmse))
cat("\nDone.\n")

#!/usr/bin/env Rscript
# multipending_metrics_R.R
# Empirical backtest statistics for dual-arm (single- vs multi-pending) learning.
# Deterministic point metrics are designed to match a parallel Python implementation
# to <0.01. Bootstrap CIs are stochastic and reported for consistency only.

# ---------------------------------------------------------------------------
# Load data
# ---------------------------------------------------------------------------
in_path  <- "analysis/multipending_residuals.csv"
out_path <- "analysis/multipending_metrics_R.csv"

df <- read.csv(in_path, stringsAsFactors = FALSE, check.names = FALSE)

# ---------------------------------------------------------------------------
# Derived columns
# ---------------------------------------------------------------------------
df$cell <- paste0(df$flowBin, "_", df$flowState)

# Parse valTs "YYYY-MM-DD HH:MM" as UTC -> epoch seconds
df$valEpoch <- as.numeric(
  as.POSIXct(df$valTs, format = "%Y-%m-%d %H:%M", tz = "UTC")
)

# ---------------------------------------------------------------------------
# Helper: filter to burn-in B and compute pooled mae_delta (used in B-sweep)
# ---------------------------------------------------------------------------
filter_B <- function(data, B) {
  data[pmin(data$binCountSingleAtPred, data$binCountMultiAtPred) >= B, , drop = FALSE]
}

pooled_mae_delta <- function(data) {
  aS <- abs(data$resSingle)
  aM <- abs(data$resMulti)
  mean(aS) - mean(aM)
}

# ---------------------------------------------------------------------------
# Primary B = 30 filtered frame, with abs residuals + delta + event ids
# ---------------------------------------------------------------------------
B_primary <- 30
fdf <- filter_B(df, B_primary)

fdf$aS    <- abs(fdf$resSingle)
fdf$aM    <- abs(fdf$resMulti)
fdf$delta <- fdf$aS - fdf$aM          # positive => multi better

# Global event assignment: sort by valEpoch ascending, gap threshold G = 24h.
G <- 24 * 3600
ord <- order(fdf$valEpoch)
fdf <- fdf[ord, , drop = FALSE]

n <- nrow(fdf)
event_id <- integer(n)
if (n > 0) {
  event_id[1] <- 0L
  if (n > 1) {
    for (i in 2:n) {
      gap <- fdf$valEpoch[i] - fdf$valEpoch[i - 1]
      if (gap > G) {
        event_id[i] <- event_id[i - 1] + 1L
      } else {
        event_id[i] <- event_id[i - 1]
      }
    }
  }
}
fdf$event_id <- event_id

# ---------------------------------------------------------------------------
# Per-scope metric computation
# ---------------------------------------------------------------------------
compute_scope <- function(rows, scope_name) {
  n_rows <- nrow(rows)
  if (n_rows == 0) {
    return(data.frame(
      scope = scope_name, n_rows = 0L, n_events = 0L, underpowered = 1L,
      mae_single = NA, mae_multi = NA, mae_delta = NA,
      median_single = NA, median_multi = NA,
      bias_single = NA, bias_multi = NA,
      pct_single = NA, pct_multi = NA,
      delta_ci_lo = NA, delta_ci_hi = NA,
      stringsAsFactors = FALSE
    ))
  }

  aS <- rows$aS
  aM <- rows$aM

  mae_single <- mean(aS)
  mae_multi  <- mean(aM)
  mae_delta  <- mae_single - mae_multi

  median_single <- median(aS)
  median_multi  <- median(aM)

  bias_single <- mean(rows$resSingle)
  bias_multi  <- mean(rows$resMulti)

  pct_single <- mean(aS / rows$actualLF) * 100
  pct_multi  <- mean(aM / rows$actualLF) * 100

  # Event-level structure for this scope
  ev_ids <- unique(rows$event_id)
  n_events <- length(ev_ids)
  underpowered <- as.integer(n_events < 15)

  # Event-level deltas (mean of delta within each event)
  event_delta <- tapply(rows$delta, rows$event_id, mean)
  event_delta <- as.numeric(event_delta)

  # Percentile bootstrap CI on mae_delta via event resampling
  n_boot <- 20000
  set.seed(12345)
  k <- length(event_delta)
  if (k >= 1) {
    boot_means <- numeric(n_boot)
    for (b in seq_len(n_boot)) {
      idx <- sample.int(k, size = k, replace = TRUE)
      boot_means[b] <- mean(event_delta[idx])
    }
    ci <- quantile(boot_means, probs = c(0.025, 0.975), names = FALSE, type = 7)
    delta_ci_lo <- ci[1]
    delta_ci_hi <- ci[2]
  } else {
    delta_ci_lo <- NA
    delta_ci_hi <- NA
  }

  data.frame(
    scope = scope_name, n_rows = n_rows, n_events = n_events,
    underpowered = underpowered,
    mae_single = mae_single, mae_multi = mae_multi, mae_delta = mae_delta,
    median_single = median_single, median_multi = median_multi,
    bias_single = bias_single, bias_multi = bias_multi,
    pct_single = pct_single, pct_multi = pct_multi,
    delta_ci_lo = delta_ci_lo, delta_ci_hi = delta_ci_hi,
    stringsAsFactors = FALSE
  )
}

# ---------------------------------------------------------------------------
# Build scopes
# ---------------------------------------------------------------------------
results <- list()

# (1) pooled
results[["pooled"]] <- compute_scope(fdf, "pooled")

# (2) 18 cells — fixed ordering (flowBin x flowState) for stable output
flow_bins   <- c("0-3000", "3000-6000", "6000-12000",
                 "12000-25000", "25000-50000", "50000+")
flow_states <- c("rising", "steady", "falling")

# Use only cells that actually exist in the data to define the canonical set,
# but iterate in a deterministic, documented order. We enumerate all 18 from
# the spec; cells absent from data yield an empty (underpowered) row.
present_cells <- unique(fdf$cell)

cell_order <- character(0)
for (fb in flow_bins) {
  for (fs in flow_states) {
    cell_order <- c(cell_order, paste0(fb, "_", fs))
  }
}
# Keep spec ordering but guard against any unexpected cell labels in data
extra_cells <- setdiff(present_cells, cell_order)
cell_order  <- c(cell_order, sort(extra_cells))

for (cl in cell_order) {
  rows <- fdf[fdf$cell == cl, , drop = FALSE]
  results[[cl]] <- compute_scope(rows, cl)
}

# (3) storm_pooled
storm_bins <- c("12000-25000", "25000-50000", "50000+")
storm_rows <- fdf[fdf$flowState == "rising" & fdf$flowBin %in% storm_bins, ,
                  drop = FALSE]
results[["storm_pooled"]] <- compute_scope(storm_rows, "storm_pooled")

# Assemble in order: pooled, 18 cells, storm_pooled
res_df <- do.call(rbind, c(
  list(results[["pooled"]]),
  lapply(cell_order, function(cl) results[[cl]]),
  list(results[["storm_pooled"]])
))
rownames(res_df) <- NULL

# ---------------------------------------------------------------------------
# Round floats to 4 decimals and write CSV
# ---------------------------------------------------------------------------
float_cols <- c("mae_single", "mae_multi", "mae_delta",
                "median_single", "median_multi",
                "bias_single", "bias_multi",
                "pct_single", "pct_multi",
                "delta_ci_lo", "delta_ci_hi")
out_df <- res_df
for (cn in float_cols) {
  out_df[[cn]] <- round(out_df[[cn]], 4)
}
write.csv(out_df, out_path, row.names = FALSE)

# ---------------------------------------------------------------------------
# Console reporting
# ---------------------------------------------------------------------------
fmt_row <- function(r) {
  cat(sprintf(
    paste0(
      "  scope=%s\n",
      "  n_rows=%d  n_events=%d  underpowered=%d\n",
      "  mae_single=%.4f  mae_multi=%.4f  mae_delta=%.4f\n",
      "  median_single=%.4f  median_multi=%.4f\n",
      "  bias_single=%.4f  bias_multi=%.4f\n",
      "  pct_single=%.4f  pct_multi=%.4f\n",
      "  delta_ci_lo=%.4f  delta_ci_hi=%.4f\n"
    ),
    r$scope, r$n_rows, r$n_events, r$underpowered,
    r$mae_single, r$mae_multi, r$mae_delta,
    r$median_single, r$median_multi,
    r$bias_single, r$bias_multi,
    r$pct_single, r$pct_multi,
    r$delta_ci_lo, r$delta_ci_hi
  ))
}

cat("==================================================================\n")
cat("POOLED ROW\n")
cat("==================================================================\n")
fmt_row(res_df[res_df$scope == "pooled", ])

cat("\n==================================================================\n")
cat("STORM_POOLED ROW\n")
cat("==================================================================\n")
fmt_row(res_df[res_df$scope == "storm_pooled", ])

# B-SWEEP -------------------------------------------------------------------
cat("\n==================================================================\n")
cat("B-SWEEP: pooled mae_delta for B in {20,30,50,75}\n")
cat("==================================================================\n")
for (B in c(20, 30, 50, 75)) {
  sub <- filter_B(df, B)
  md  <- pooled_mae_delta(sub)
  cat(sprintf("  B=%-3d  n_rows=%d  pooled_mae_delta=%.4f\n",
              B, nrow(sub), md))
}

# TEMPORAL HOLDOUT ----------------------------------------------------------
cat("\n==================================================================\n")
cat("TEMPORAL HOLDOUT: last 20% (chronological) of B=30 filtered rows\n")
cat("==================================================================\n")
# fdf is already sorted by valEpoch ascending.
n_all <- nrow(fdf)
cut_idx <- floor(0.80 * n_all)          # first 80% are rows 1..cut_idx
hold <- fdf[(cut_idx + 1):n_all, , drop = FALSE]
h_aS <- hold$aS
h_aM <- hold$aM
h_mae_single <- mean(h_aS)
h_mae_multi  <- mean(h_aM)
h_mae_delta  <- h_mae_single - h_mae_multi
h_n_events   <- length(unique(hold$event_id))
cat(sprintf("  n_rows=%d  n_events=%d\n", nrow(hold), h_n_events))
cat(sprintf("  mae_single=%.4f  mae_multi=%.4f  mae_delta=%.4f\n",
            h_mae_single, h_mae_multi, h_mae_delta))

# RAW BASELINE --------------------------------------------------------------
cat("\n==================================================================\n")
cat("RAW BASELINE sanity (B=30 filtered rows)\n")
cat("==================================================================\n")
raw_mae <- mean(abs(fdf$rawResidual))
cat(sprintf("  mean(abs(rawResidual)) = %.4f\n", raw_mae))

# PLAIN READING -------------------------------------------------------------
pooled_r <- res_df[res_df$scope == "pooled", ]
storm_r  <- res_df[res_df$scope == "storm_pooled", ]

overall_dir <- if (pooled_r$mae_delta > 0) "reduces" else if (pooled_r$mae_delta < 0) "increases" else "does not change"
storm_dir   <- if (storm_r$mae_delta > 0) "reduces" else if (storm_r$mae_delta < 0) "increases" else "does not change"

# storm-cell underpowered status: check the three storm cells individually
storm_cells <- c("12000-25000_rising", "25000-50000_rising", "50000+_rising")
storm_cell_rows <- res_df[res_df$scope %in% storm_cells, ]
n_under_storm <- sum(storm_cell_rows$underpowered == 1)

cat("\n==================================================================\n")
cat("PLAIN READING\n")
cat("==================================================================\n")
cat(sprintf(
  paste0(
    "  Overall, multi-pending learning %s corrected MAE (pooled mae_delta=%.4f). ",
    "In the storm cells (rising, high-flow) multi %s corrected MAE ",
    "(storm_pooled mae_delta=%.4f); the storm cells are %s underpowered ",
    "(%d of %d storm cells have n_events<15; storm_pooled n_events=%d, underpowered=%d).\n"
  ),
  overall_dir, pooled_r$mae_delta,
  storm_dir, storm_r$mae_delta,
  if (n_under_storm > 0) "largely" else "not",
  n_under_storm, length(storm_cells),
  storm_r$n_events, storm_r$underpowered
))

cat(sprintf("\nCSV written to: %s\n", out_path))

#!/usr/bin/env Rscript
# flow_state_step1.R
# Provenance: generating script for analysis/flow_state_step1_R.csv
# Step-1 Label-Only Diagnostic (blind R implementation).
# Spec: analysis/flow-state-step1-diagnostic-spec.md
#
# Implemented independently from spec + raw data only (blind to Python).
# Deterministic; all timestamps parsed as UTC.

suppressWarnings(suppressMessages({
  options(stringsAsFactors = FALSE)
}))

ANALYSIS_DIR <- "/Users/sebjilke/Desktop/PotomacPulse/analysis"
SERIES_PATH  <- file.path(ANALYSIS_DIR, "hourly_backtest_data_v361.csv")
RESID_PATH   <- file.path(ANALYSIS_DIR, "ci_residuals_v361_multi.csv")
OUT_PATH     <- file.path(ANALYSIS_DIR, "flow_state_step1_R.csv")

# ---------------------------------------------------------------------------
# 1. Load series; parse timestamps UTC; drop blank por_now; sort ascending.
# ---------------------------------------------------------------------------
series <- read.csv(SERIES_PATH, colClasses = "character", check.names = FALSE)

# timestamp format "YYYY-MM-DD HH:MM" (UTC)
series_ts <- as.POSIXct(series$timestamp, format = "%Y-%m-%d %H:%M", tz = "UTC")
por_now   <- suppressWarnings(as.numeric(series$por_now))

# Drop rows with blank/NA por_now or unparseable timestamp
keep <- !is.na(por_now) & !is.na(series_ts)
series_ts <- series_ts[keep]
por_now   <- por_now[keep]

# Sort ascending by timestamp (stable)
ord       <- order(series_ts)
series_ts <- series_ts[ord]
por_now   <- por_now[ord]

# Numeric timestamp vector (seconds since epoch) for fast findInterval lookups.
series_tnum <- as.numeric(series_ts)
n_series    <- length(series_tnum)

cat(sprintf("Series rows after dropping blank por_now: %d\n", n_series))

# ---------------------------------------------------------------------------
# 2. flowStateAsOf classifier (vectorized over many refTimes).
#    For each refTime t:
#      hist = rows with ts <= t. If count(hist) < 8 -> 'steady'
#      current = por_now at largest ts <= t  (nearest on-or-before)
#      past    = por_now at largest ts <= t - 6h (by TIME)
#      if past is None -> 'steady'
#      change = current - past
#      thr = max(100, 0.02*current)
#      if abs(change) >= thr: 'rising' if change>0 else 'falling'
#      else 'steady'
#
#  findInterval(x, vec): largest index i with vec[i] <= x (vec sorted ascending).
#  count(ts <= t) == that index (since vec sorted ascending, index = #(<= t)).
# ---------------------------------------------------------------------------
SIX_H_SECS <- 6 * 3600

flowStateAsOf_vec <- function(ref_tnum) {
  # ref_tnum: numeric vector of reference times (seconds since epoch, UTC).
  out <- rep("steady", length(ref_tnum))

  # idx_cur: largest series index with series_tnum <= ref. Also == # history rows (hist count).
  idx_cur <- findInterval(ref_tnum, series_tnum)
  # idx_past: largest series index with series_tnum <= ref - 6h
  idx_past <- findInterval(ref_tnum - SIX_H_SECS, series_tnum)

  # History gate: hist count (= idx_cur) must be >= 8. If < 8 -> steady (already default).
  # Also need idx_cur >= 1 (a current row exists on-or-before). If idx_cur==0, no current
  # -> hist count 0 < 8 -> steady. Covered by the >=8 gate.
  ok_hist <- idx_cur >= 8

  # past is None when idx_past == 0 (no row on-or-before ref-6h). -> steady.
  ok_past <- idx_past >= 1

  active <- ok_hist & ok_past
  if (any(active)) {
    ci <- idx_cur[active]
    pi <- idx_past[active]
    cur  <- por_now[ci]
    past <- por_now[pi]
    change <- cur - past
    thr <- pmax(100, 0.02 * cur)
    st <- rep("steady", length(change))
    rising  <- (abs(change) >= thr) & (change > 0)
    falling <- (abs(change) >= thr) & (change <= 0)  # change>0 -> rising else falling; ties (==0) cannot reach thr>=100
    st[rising]  <- "rising"
    st[falling] <- "falling"
    out[active] <- st
  }
  out
}

# ---------------------------------------------------------------------------
# 3. Load predictions; parse predTs UTC; build arms.
# ---------------------------------------------------------------------------
pred <- read.csv(RESID_PATH, colClasses = "character", check.names = FALSE)

# predTs ISO UTC "2011-12-01T05:00:00.000Z"
predTs <- as.POSIXct(pred$predTs, format = "%Y-%m-%dT%H:%M:%OS", tz = "UTC")
stopifnot(!any(is.na(predTs)))

rawResidual   <- as.numeric(pred$rawResidual)
flowBin       <- pred$flowBin
flowState_log <- pred$flowState
predTs_num    <- as.numeric(predTs)

N_pred <- length(predTs_num)
cat(sprintf("Prediction rows: %d\n", N_pred))

# travel_time_h for Parcel_model: per the join, look up travel_time_h on the series at
# predTs (floor to hour join). The series travel_time_h column is per-hour PoR->GF lag.
# We join predTs (floored to UTC hour) to series timestamp. But the SERIES we kept dropped
# blank por_now rows; travel_time lookup should use the original full series travel_time.
# Spec: Parcel_model = flowStateAsOf(series, predTs - travel_time_h(predTs) h).
# travel_time_h(predTs): the travel_time at the prediction's hour.
series_full <- read.csv(SERIES_PATH, colClasses = "character", check.names = FALSE)
sf_ts  <- as.POSIXct(series_full$timestamp, format = "%Y-%m-%d %H:%M", tz = "UTC")
sf_tt  <- suppressWarnings(as.numeric(series_full$travel_time_h))
sf_tnum <- as.numeric(sf_ts)

# Floor predTs to hour for the join (predTs already on the hour, but be safe).
pred_hour_num <- floor(predTs_num / 3600) * 3600
sf_hour_num   <- floor(sf_tnum / 3600) * 3600
# Map: hour -> travel_time. Use match on floored hour.
tt_map_idx <- match(pred_hour_num, sf_hour_num)
travel_tt  <- sf_tt[tt_map_idx]
cat(sprintf("Parcel_model: predTs hours matched to series travel_time: %d / %d (NA tt: %d)\n",
            sum(!is.na(tt_map_idx)), N_pred, sum(is.na(travel_tt))))

# Build arm reference times.
arm_specs <- list(
  list(arm = "A_current",   lag_h = 0,  ref = predTs_num),
  list(arm = "Parcel_L6",   lag_h = 6,  ref = predTs_num - 6 * 3600),
  list(arm = "Parcel_L12",  lag_h = 12, ref = predTs_num - 12 * 3600),
  list(arm = "Parcel_L18",  lag_h = 18, ref = predTs_num - 18 * 3600),
  list(arm = "Parcel_L24",  lag_h = 24, ref = predTs_num - 24 * 3600),
  list(arm = "Parcel_L30",  lag_h = 30, ref = predTs_num - 30 * 3600),
  list(arm = "Parcel_L36",  lag_h = 36, ref = predTs_num - 36 * 3600),
  list(arm = "Parcel_model", lag_h = NA, ref = predTs_num - travel_tt * 3600)
)

# Compute label vectors per arm.
labels <- list()
for (s in arm_specs) {
  labels[[s$arm]] <- flowStateAsOf_vec(s$ref)
}
# Parcel_model: where travel_tt is NA, ref is NA -> findInterval(NA) returns NA.
# Handle: an NA ref means we cannot place it; treat as 'steady' (no current row resolvable).
# But spec assumes travel_time present. Check NA labels.
for (s in arm_specs) {
  na_lab <- sum(is.na(labels[[s$arm]]))
  if (na_lab > 0) {
    cat(sprintf("WARNING arm %s has %d NA labels (NA ref times) -> set to 'steady'\n", s$arm, na_lab))
    labels[[s$arm]][is.na(labels[[s$arm]])] <- "steady"
  }
}

# ---------------------------------------------------------------------------
# 4. Self-validation: label_match_rate (A_current vs logged flowState).
# ---------------------------------------------------------------------------
label_match_rate <- mean(labels[["A_current"]] == flowState_log)
cat(sprintf("label_match_rate (A_current vs logged): %.10f\n", label_match_rate))

# ---------------------------------------------------------------------------
# 5. Metrics helpers.
#    KEY = (flowBin, state). group means on rawResidual r.
# ---------------------------------------------------------------------------
r      <- rawResidual
N      <- length(r)
mean_r <- mean(r)
SS_total <- sum((r - mean_r)^2)

# group_means_for(state_vec): returns per-row group mean using KEY=(flowBin,state).
group_means_for <- function(state_vec) {
  key <- paste(flowBin, state_vec, sep = "")
  gm  <- ave(r, key, FUN = mean)
  gm
}

# Metric set for one labeling.
compute_metrics <- function(state_vec) {
  gm <- group_means_for(state_vec)
  SS_within <- sum((r - gm)^2)
  eta2_full <- 1 - SS_within / SS_total
  within_var <- SS_within / N

  # within_bin_state_eta2: hold flowBin fixed.
  # Sum over bins of SS_between_states / Sum over bins of SS_total_bin.
  # SS_between_states (within a bin) = SS_total_bin - SS_within_states_bin.
  # Equivalent: numerator = Sum_bin [ SS_total_bin - Sum_state (r - state_mean_in_bin)^2 ].
  # SS_total_bin = Sum_{rows in bin} (r - bin_mean)^2.
  bin_mean <- ave(r, flowBin, FUN = mean)
  SS_total_bin_total <- sum((r - bin_mean)^2)        # Sum_bin SS_total_bin
  # SS_within_states across bins == SS_within using KEY (bin,state) = SS_within already.
  SS_within_states_total <- SS_within
  SS_between_states_total <- SS_total_bin_total - SS_within_states_total
  within_bin_state_eta2 <- SS_between_states_total / SS_total_bin_total

  # Occupancy + rising mean resid.
  rising_n  <- sum(state_vec == "rising")
  steady_n  <- sum(state_vec == "steady")
  falling_n <- sum(state_vec == "falling")
  rising_mean_resid <- if (rising_n > 0) mean(r[state_vec == "rising"]) else NA_real_

  list(
    eta2_full = eta2_full,
    within_var = within_var,
    within_bin_state_eta2 = within_bin_state_eta2,
    rising_n = rising_n, steady_n = steady_n, falling_n = falling_n,
    rising_mean_resid = rising_mean_resid,
    group_means = gm,
    SS_within = SS_within
  )
}

metrics_by_arm <- list()
for (s in arm_specs) {
  metrics_by_arm[[s$arm]] <- compute_metrics(labels[[s$arm]])
}

# ---------------------------------------------------------------------------
# 6. Bootstrap (parcel arms vs A_current).
#    d_i = (r_i - gm_A(i))^2 - (r_i - gm_arm(i))^2.
#    Non-overlapping consecutive 48-row blocks, resample block indices w/ replacement,
#    B=1000, seed=20260617. boot_mean_d, boot_ci_lo/hi = 2.5/97.5 pctile of block-resampled mean(d).
#    delta_within_var = within_var[A_current] - within_var[arm].
#    NOTE: row order for blocks = the row order of the joined sample (file order of predictions),
#    which is chronological by predTs (verified ascending). Blocks are consecutive rows.
# ---------------------------------------------------------------------------
BLOCK <- 48
B <- 1000
SEED <- 20260617

gm_A <- metrics_by_arm[["A_current"]]$group_means
sq_A <- (r - gm_A)^2

# Partition rows into non-overlapping consecutive 48-row blocks.
# Last partial block (if N not divisible by 48) is kept as a shorter block.
n_blocks <- ceiling(N / BLOCK)
block_id <- ((seq_len(N) - 1L) %/% BLOCK) + 1L   # 1..n_blocks

# Precompute, per block: vector of d-values is needed; for resampling efficiency we
# precompute per-block sum(d) and length, then bootstrap mean = sum(selected sums)/sum(selected lens).
# This gives the resampled mean of d exactly (mean over all rows in the resampled blocks).

run_bootstrap <- function(arm_state_vec, arm_within_var) {
  gm_arm <- group_means_for(arm_state_vec)
  d <- sq_A - (r - gm_arm)^2
  delta_within_var <- metrics_by_arm[["A_current"]]$within_var - arm_within_var

  # Per-block sum(d) and length.
  block_sum_d <- tapply(d, block_id, sum)
  block_len   <- tapply(rep(1L, N), block_id, sum)
  block_sum_d <- as.numeric(block_sum_d)
  block_len   <- as.numeric(block_len)
  nb <- length(block_sum_d)

  boot_means <- numeric(B)
  for (b in seq_len(B)) {
    sel <- sample.int(nb, size = nb, replace = TRUE)
    boot_means[b] <- sum(block_sum_d[sel]) / sum(block_len[sel])
  }
  boot_mean_d <- mean(boot_means)
  ci <- quantile(boot_means, probs = c(0.025, 0.975), names = FALSE, type = 7)
  list(delta_within_var = delta_within_var,
       boot_mean_d = boot_mean_d,
       boot_ci_lo = ci[1], boot_ci_hi = ci[2])
}

# ---------------------------------------------------------------------------
# 7. Assemble output table (one row per arm). Seed reset before bootstrap loop
#    so the full sequence of parcel arms is deterministic.
# ---------------------------------------------------------------------------
set.seed(SEED)

rows <- list()
for (s in arm_specs) {
  m <- metrics_by_arm[[s$arm]]
  is_current <- s$arm == "A_current"
  lag_out <- if (is.na(s$lag_h)) NA_real_ else s$lag_h

  if (is_current) {
    boot <- list(delta_within_var = NA_real_, boot_mean_d = NA_real_,
                 boot_ci_lo = NA_real_, boot_ci_hi = NA_real_)
    lmr <- label_match_rate
  } else {
    boot <- run_bootstrap(labels[[s$arm]], m$within_var)
    lmr <- NA_real_
  }

  rows[[length(rows) + 1]] <- data.frame(
    arm = s$arm,
    lag_h = lag_out,
    n = N,
    eta2_full = m$eta2_full,
    within_var = m$within_var,
    within_bin_state_eta2 = m$within_bin_state_eta2,
    rising_n = m$rising_n,
    steady_n = m$steady_n,
    falling_n = m$falling_n,
    rising_mean_resid = m$rising_mean_resid,
    label_match_rate = lmr,
    delta_within_var = boot$delta_within_var,
    boot_mean_d = boot$boot_mean_d,
    boot_ci_lo = boot$boot_ci_lo,
    boot_ci_hi = boot$boot_ci_hi,
    stringsAsFactors = FALSE
  )
}

out <- do.call(rbind, rows)

# Write with full precision.
write.csv(out, OUT_PATH, row.names = FALSE)
cat(sprintf("Wrote %s\n", OUT_PATH))

# ---------------------------------------------------------------------------
# 8. Stdout summary.
# ---------------------------------------------------------------------------
cat("\n================ RESULTS (full precision) ================\n")
print(format(out, digits = 12, scientific = FALSE), row.names = FALSE)

cat("\n================ SUMMARY ================\n")
cat(sprintf("label_match_rate = %.6f\n", label_match_rate))
for (i in seq_len(nrow(out))) {
  if (out$arm[i] == "A_current") next
  reduces <- out$delta_within_var[i] > 0
  parcel_wins <- out$boot_ci_lo[i] > 0          # spec: "Parcel wins" <=> ci_lo > 0
  ci_excludes0 <- (out$boot_ci_lo[i] > 0) | (out$boot_ci_hi[i] < 0)
  cat(sprintf("%-13s lag=%s: within_var=%.4f delta_wv=%.4f (%s within_var); boot_mean_d=%.4f CI[%.4f, %.4f] %s; parcel_wins=%s\n",
              out$arm[i],
              ifelse(is.na(out$lag_h[i]), "model", as.character(out$lag_h[i])),
              out$within_var[i], out$delta_within_var[i],
              ifelse(reduces, "REDUCES", "increases"),
              out$boot_mean_d[i], out$boot_ci_lo[i], out$boot_ci_hi[i],
              ifelse(ci_excludes0, "[CI excludes 0]", "[CI includes 0]"),
              ifelse(parcel_wins, "YES", "NO")))
}

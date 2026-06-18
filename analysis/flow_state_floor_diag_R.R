#!/usr/bin/env Rscript
# flow_state_floor_diag_R.R
# Provenance: generating script for analysis/flow_state_floor_diag_R.csv
# Flow-state floor — Step-1 leverage diagnostic (blind R implementation).
# Spec: analysis/flow-state-floor-diagnostic-spec-2026-06-18.md
#
# READ-ONLY leverage diagnostic. No model/source file is modified.
# Implemented strictly from the spec; blind to the Python implementation.
# Deterministic; all timestamps parsed as UTC.
#
# Q1 — floor-bite on the PoR state classifier (getFlowState, shared/model.js:173-199).
# Q2 — do low-flow correction bins differ by state (raw residual the EMA converges to).

suppressWarnings(suppressMessages({
  options(stringsAsFactors = FALSE)
}))

ANALYSIS_DIR <- "/Users/sebjilke/Desktop/PotomacPulse/analysis"
SERIES_PATH  <- file.path(ANALYSIS_DIR, "hourly_backtest_data_v361.csv")
RESID_PATH   <- file.path(ANALYSIS_DIR, "ci_residuals_v361_multi.csv")
OUT_PATH     <- file.path(ANALYSIS_DIR, "flow_state_floor_diag_R.csv")

SIX_H_SECS <- 6 * 3600

# ===========================================================================
# Q1 — Floor-bite on the PoR state classifier
# ===========================================================================
# Data: hourly_backtest_data_v361.csv; columns timestamp, por_now.
# Drop rows with blank/NA por_now (or unparseable timestamp).
# NOTE: no ice column in this file -> Q1 is ICE-INCLUSIVE (no ice filter invented).

series <- read.csv(SERIES_PATH, colClasses = "character", check.names = FALSE)

series_ts <- as.POSIXct(series$timestamp, format = "%Y-%m-%d %H:%M", tz = "UTC")
por_now   <- suppressWarnings(as.numeric(series$por_now))

keep      <- !is.na(por_now) & !is.na(series_ts)
series_ts <- series_ts[keep]
por_now   <- por_now[keep]

# Sort ascending by timestamp (stable order).
ord       <- order(series_ts)
series_ts <- series_ts[ord]
por_now   <- por_now[ord]

series_tnum <- as.numeric(series_ts)
n_series    <- length(series_tnum)

cat(sprintf("[Q1] Series rows after dropping blank por_now: %d\n", n_series))

# --- getFlowState replication, EXACT live semantics ----------------------
# For each row t (current = por_now[t], the row's own value):
#   - history gate: count(rows with ts <= t) < 8  -> 'steady'
#       (live: history.length < 8; history includes the current reading,
#        so the count of rows at-or-before t must be >= 8.)
#   - past = por_now at the most recent row with ts <= t - 6h (TIME-based
#       at-or-before pick). If none -> 'steady'.
#   - change = current - past
#   - Rule A (live):       threshold = max(100, current * 0.02)
#   - Rule B (no floor):   threshold = current * 0.02
#   - |change| >= threshold -> rising (change>0) / falling (change<0), else steady.
#
# findInterval(x, vec): for sorted ascending vec, returns the largest index i
# with vec[i] <= x. Since vec is sorted ascending, that index also equals the
# count of rows with ts <= x.

n <- n_series
idx_t    <- seq_len(n)                                   # current row index = t
# count of rows with ts <= t == idx_t (vector sorted ascending). History gate.
hist_count <- idx_t
# largest index with ts <= t - 6h (time-based at-or-before). 0 if none.
idx_past <- findInterval(series_tnum - SIX_H_SECS, series_tnum)

ok_hist <- hist_count >= 8     # < 8 prior history -> steady
ok_past <- idx_past >= 1       # no row at-or-before t-6h -> steady
classifiable <- ok_hist & ok_past

current <- por_now                                       # por_now[t]
past    <- rep(NA_real_, n)
past[classifiable] <- por_now[idx_past[classifiable]]
change  <- current - past                                # NA where not classifiable
abs_change <- abs(change)

thrA <- pmax(100, current * 0.02)                        # Rule A (floor)
thrB <- current * 0.02                                   # Rule B (no floor)

classify <- function(thr) {
  st <- rep("steady", n)
  st[!classifiable] <- NA_character_
  rising  <- classifiable & (abs_change >= thr) & (change > 0)
  falling <- classifiable & (abs_change >= thr) & (change < 0)
  st[rising]  <- "rising"
  st[falling] <- "falling"
  st
}

stateA <- classify(thrA)
stateB <- classify(thrB)

# --- Low-flow restriction (PoR-keyed proxy) ------------------------------
low_flow   <- classifiable & (current < 6000)            # 0-3000 + 3000-6000
floor_band <- classifiable & (current < 5000)            # sub-band where the floor binds

n_classifiable     <- sum(classifiable)
n_lowflow          <- sum(low_flow)
n_floorband        <- sum(floor_band)
lowflow_share      <- n_lowflow / n_classifiable         # fraction of ALL classifiable hours that are low flow

# Floor-masked directionality: A == steady but B in {rising, falling}.
# Restricted to low-flow classifiable hours; denominator = low-flow classifiable hours.
masked_mask    <- low_flow & (stateA == "steady") & (stateB %in% c("rising", "falling"))
masked_rising  <- low_flow & (stateA == "steady") & (stateB == "rising")
masked_falling <- low_flow & (stateA == "steady") & (stateB == "falling")

q1_lf_floor_masked      <- sum(masked_mask)    / n_lowflow
q1_lf_masked_rising     <- sum(masked_rising)  / n_lowflow
q1_lf_masked_falling    <- sum(masked_falling) / n_lowflow

# False-flip companion: B yields rising/falling but |change| < 100.
falseflip_mask <- low_flow & (stateB %in% c("rising", "falling")) & (abs_change < 100)
q1_lf_false_flip <- sum(falseflip_mask) / n_lowflow

# Same metrics for the floor-binding sub-band (por_now < 5000).
masked_mask_fb    <- floor_band & (stateA == "steady") & (stateB %in% c("rising", "falling"))
masked_rising_fb  <- floor_band & (stateA == "steady") & (stateB == "rising")
masked_falling_fb <- floor_band & (stateA == "steady") & (stateB == "falling")
falseflip_fb      <- floor_band & (stateB %in% c("rising", "falling")) & (abs_change < 100)

q1_fb_floor_masked   <- sum(masked_mask_fb)    / n_floorband
q1_fb_masked_rising  <- sum(masked_rising_fb)  / n_floorband
q1_fb_masked_falling <- sum(masked_falling_fb) / n_floorband
q1_fb_false_flip     <- sum(falseflip_fb)      / n_floorband

# --- State distribution under A vs B, por_now<6000, by PoR-keyed flow bin -
# LABELED explicitly as a PoR-keyed proxy (getFlowBin(por_now)),
# NOT the live GF-keyed bin getFlowBin(rawFinalUnclipped).
por_bin <- rep(NA_character_, n)
por_bin[classifiable & current < 3000]                   <- "0-3000"
por_bin[classifiable & current >= 3000 & current < 6000] <- "3000-6000"

state_dist <- function(state_vec, bin_label) {
  # por_bin is NA for non-classifiable rows; %in% never returns NA, so the
  # mask is strictly logical (no NA propagation into the sums/indexing).
  m <- classifiable & (por_bin %in% bin_label)
  c(rising  = sum(state_vec[m] == "rising"),
    steady  = sum(state_vec[m] == "steady"),
    falling = sum(state_vec[m] == "falling"))
}

distA_0_3000   <- state_dist(stateA, "0-3000")
distB_0_3000   <- state_dist(stateB, "0-3000")
distA_3000_6000 <- state_dist(stateA, "3000-6000")
distB_3000_6000 <- state_dist(stateB, "3000-6000")

cat("\n[Q1] ============ FLOOR-BITE ON PoR STATE CLASSIFIER ============\n")
cat(sprintf("[Q1] Total classifiable hours (all flows):       %d\n", n_classifiable))
cat(sprintf("[Q1] Classifiable LOW-FLOW hours (por_now<6000):  %d\n", n_lowflow))
cat(sprintf("[Q1] Low-flow share of all classifiable hours:    %.6f (%.3f%%)\n",
            lowflow_share, 100 * lowflow_share))
cat(sprintf("[Q1] Floor-binding sub-band hours (por_now<5000): %d\n", n_floorband))
cat("\n[Q1] --- LOW FLOW (por_now < 6000) ---\n")
cat(sprintf("[Q1]   floor-masked directionality: %.6f (%.3f%%)\n",
            q1_lf_floor_masked, 100 * q1_lf_floor_masked))
cat(sprintf("[Q1]     masked-rising:             %.6f (%.3f%%)\n",
            q1_lf_masked_rising, 100 * q1_lf_masked_rising))
cat(sprintf("[Q1]     masked-falling:            %.6f (%.3f%%)\n",
            q1_lf_masked_falling, 100 * q1_lf_masked_falling))
cat(sprintf("[Q1]   false-flip companion:        %.6f (%.3f%%)\n",
            q1_lf_false_flip, 100 * q1_lf_false_flip))
cat("\n[Q1] --- FLOOR-BINDING SUB-BAND (por_now < 5000) ---\n")
cat(sprintf("[Q1]   floor-masked directionality: %.6f (%.3f%%)\n",
            q1_fb_floor_masked, 100 * q1_fb_floor_masked))
cat(sprintf("[Q1]     masked-rising:             %.6f (%.3f%%)\n",
            q1_fb_masked_rising, 100 * q1_fb_masked_rising))
cat(sprintf("[Q1]     masked-falling:            %.6f (%.3f%%)\n",
            q1_fb_masked_falling, 100 * q1_fb_masked_falling))
cat(sprintf("[Q1]   false-flip companion:        %.6f (%.3f%%)\n",
            q1_fb_false_flip, 100 * q1_fb_false_flip))

cat("\n[Q1] --- STATE DISTRIBUTION por_now<6000 (PoR-KEYED PROXY bins, NOT live GF bin) ---\n")
fmt_dist <- function(lbl, d) cat(sprintf("[Q1]   %-22s rising=%d steady=%d falling=%d\n",
                                         lbl, d["rising"], d["steady"], d["falling"]))
fmt_dist("0-3000   Rule A", distA_0_3000)
fmt_dist("0-3000   Rule B", distB_0_3000)
fmt_dist("3000-6000 Rule A", distA_3000_6000)
fmt_dist("3000-6000 Rule B", distB_3000_6000)
cat("[Q1] NOTE: Q1 is ICE-INCLUSIVE (no ice column in the data; no ice filter applied).\n")

# ===========================================================================
# Q2 — Do low-flow correction bins differ by state
# ===========================================================================
# Data: ci_residuals_v361_multi.csv. Columns identified from header:
#   flowBin (col 6, GF-keyed live bin), flowState (col 7), rawResidual (col 10).
# The raw residual is what the learn-on-raw EMA converges to (mean per bin x state).
# Group by (flowBin, flowState); for low-flow bins 0-3000 and 3000-6000 x
# {rising, steady, falling}: mean RAW residual, SE = sd/sqrt(n), count n.

resid <- read.csv(RESID_PATH, colClasses = "character", check.names = FALSE)

rawResidual <- as.numeric(resid$rawResidual)
flowBin     <- resid$flowBin
flowState   <- resid$flowState

cat(sprintf("\n[Q2] Residual rows: %d\n", length(rawResidual)))

LOW_BINS <- c("0-3000", "3000-6000")
STATES   <- c("rising", "steady", "falling")

cell_stat <- function(bin, state) {
  m <- (flowBin == bin) & (flowState == state)
  x <- rawResidual[m]
  nn <- length(x)
  mn <- if (nn > 0) mean(x) else NA_real_
  se <- if (nn > 1) sd(x) / sqrt(nn) else NA_real_
  list(n = nn, mean = mn, se = se)
}

q2_rows <- list()
for (bin in LOW_BINS) {
  for (st in STATES) {
    cs <- cell_stat(bin, st)
    q2_rows[[length(q2_rows) + 1]] <- data.frame(
      flowBin = bin, flowState = st,
      n = cs$n, mean_raw_residual = cs$mean, se = cs$se,
      stringsAsFactors = FALSE
    )
  }
}
q2_tbl <- do.call(rbind, q2_rows)

# Per low-flow bin: max|state-mean - steady-mean|; pass iff that gap
#   > 100 cfs AND > that bin's SE AND the differing state has n >= 30.
# "that bin's SE": evaluated as the SE of the differing (max-gap) state cell.
q2_bin_eval <- list()
for (bin in LOW_BINS) {
  steady <- cell_stat(bin, "steady")
  gaps <- list()
  for (st in c("rising", "falling")) {
    cs <- cell_stat(bin, st)
    gap <- if (!is.na(cs$mean) && !is.na(steady$mean)) abs(cs$mean - steady$mean) else NA_real_
    gaps[[st]] <- list(state = st, gap = gap, n = cs$n, se = cs$se)
  }
  # pick the differing state with the maximum gap
  gvals <- sapply(gaps, function(g) ifelse(is.na(g$gap), -Inf, g$gap))
  which_max <- names(which.max(gvals))
  best <- gaps[[which_max]]
  max_gap     <- best$gap
  diff_state  <- best$state
  diff_n      <- best$n
  diff_se     <- best$se
  pass <- (!is.na(max_gap)) && (max_gap > 100) &&
          (!is.na(diff_se)) && (max_gap > diff_se) &&
          (diff_n >= 30)
  q2_bin_eval[[length(q2_bin_eval) + 1]] <- data.frame(
    flowBin = bin,
    steady_mean = steady$mean, steady_n = steady$n,
    differing_state = diff_state, max_abs_gap = max_gap,
    differing_state_n = diff_n, differing_state_se = diff_se,
    gap_gt_100 = (!is.na(max_gap)) && (max_gap > 100),
    gap_gt_se  = (!is.na(max_gap)) && (!is.na(diff_se)) && (max_gap > diff_se),
    n_ge_30    = diff_n >= 30,
    pass = pass,
    stringsAsFactors = FALSE
  )
}
q2_eval_tbl <- do.call(rbind, q2_bin_eval)

cat("\n[Q2] ============ LOW-FLOW CORRECTION BINS BY STATE ============\n")
cat("[Q2] flowBin is the LIVE GF-keyed bin from ci_residuals_v361_multi.csv.\n")
cat("[Q2] mean RAW residual = the value the learn-on-raw EMA converges to.\n\n")
for (i in seq_len(nrow(q2_tbl))) {
  cat(sprintf("[Q2]   %-10s %-8s n=%-6d mean=%9.3f  SE=%8.3f\n",
              q2_tbl$flowBin[i], q2_tbl$flowState[i], q2_tbl$n[i],
              q2_tbl$mean_raw_residual[i], q2_tbl$se[i]))
}
cat("\n[Q2] --- Per-bin pass/fail vs the bar (>100 cfs AND >SE AND diff-state n>=30) ---\n")
for (i in seq_len(nrow(q2_eval_tbl))) {
  e <- q2_eval_tbl[i, ]
  cat(sprintf("[Q2]   %-10s steady_mean=%9.3f (n=%d) | diff=%s gap=%.3f (n=%d, SE=%.3f) | >100:%s >SE:%s n>=30:%s => %s\n",
              e$flowBin, e$steady_mean, e$steady_n, e$differing_state, e$max_abs_gap,
              e$differing_state_n, e$differing_state_se,
              e$gap_gt_100, e$gap_gt_se, e$n_ge_30,
              ifelse(e$pass, "PASS (states differ)", "FAIL (low leverage)")))
}

# ===========================================================================
# Write tidy CSV: Q1 fractions + Q2 per-cell stats (+ Q2 per-bin evaluation).
# ===========================================================================
# Long/tidy: one row per (section, metric/cell), with consistent value columns.
out_rows <- list()
addrow <- function(section, key, band, flowBin = NA, flowState = NA,
                   metric = NA, value = NA, n = NA, se = NA, note = NA) {
  out_rows[[length(out_rows) + 1]] <<- data.frame(
    section = section, key = key, band = band,
    flowBin = flowBin, flowState = flowState,
    metric = metric, value = value, n = n, se = se, note = note,
    stringsAsFactors = FALSE
  )
}

# Q1 fractions (low flow <6000)
addrow("Q1", "floor_masked_directionality", "por_now<6000", metric = "fraction",
       value = q1_lf_floor_masked, n = n_lowflow, note = "A=steady & B in {rising,falling}")
addrow("Q1", "masked_rising", "por_now<6000", metric = "fraction",
       value = q1_lf_masked_rising, n = n_lowflow)
addrow("Q1", "masked_falling", "por_now<6000", metric = "fraction",
       value = q1_lf_masked_falling, n = n_lowflow)
addrow("Q1", "false_flip", "por_now<6000", metric = "fraction",
       value = q1_lf_false_flip, n = n_lowflow, note = "B rising/falling but |change|<100")
# Q1 fractions (floor-binding sub-band <5000)
addrow("Q1", "floor_masked_directionality", "por_now<5000", metric = "fraction",
       value = q1_fb_floor_masked, n = n_floorband)
addrow("Q1", "masked_rising", "por_now<5000", metric = "fraction",
       value = q1_fb_masked_rising, n = n_floorband)
addrow("Q1", "masked_falling", "por_now<5000", metric = "fraction",
       value = q1_fb_masked_falling, n = n_floorband)
addrow("Q1", "false_flip", "por_now<5000", metric = "fraction",
       value = q1_fb_false_flip, n = n_floorband, note = "B rising/falling but |change|<100")
# Q1 counts / shares
addrow("Q1", "n_classifiable_all", "all_flows", metric = "count", value = n_classifiable)
addrow("Q1", "n_classifiable_lowflow", "por_now<6000", metric = "count", value = n_lowflow)
addrow("Q1", "lowflow_share_of_classifiable", "por_now<6000", metric = "fraction",
       value = lowflow_share, n = n_classifiable)
# Q1 state distribution (PoR-keyed proxy bins)
add_dist <- function(rule, bin, d) {
  for (st in c("rising", "steady", "falling")) {
    addrow("Q1", paste0("state_dist_", rule), "por_now<6000",
           flowBin = bin, flowState = st, metric = "count", value = d[st],
           note = "PoR-keyed proxy bin (getFlowBin(por_now)), NOT live GF bin")
  }
}
add_dist("ruleA", "0-3000",    distA_0_3000)
add_dist("ruleB", "0-3000",    distB_0_3000)
add_dist("ruleA", "3000-6000", distA_3000_6000)
add_dist("ruleB", "3000-6000", distB_3000_6000)

# Q2 per-cell stats
for (i in seq_len(nrow(q2_tbl))) {
  addrow("Q2", "cell_mean_raw_residual", "low_flow",
         flowBin = q2_tbl$flowBin[i], flowState = q2_tbl$flowState[i],
         metric = "mean_raw_residual", value = q2_tbl$mean_raw_residual[i],
         n = q2_tbl$n[i], se = q2_tbl$se[i])
}
# Q2 per-bin evaluation
for (i in seq_len(nrow(q2_eval_tbl))) {
  e <- q2_eval_tbl[i, ]
  addrow("Q2", "bin_eval_max_abs_gap", "low_flow",
         flowBin = e$flowBin, flowState = e$differing_state,
         metric = "max_abs_gap_vs_steady", value = e$max_abs_gap,
         n = e$differing_state_n, se = e$differing_state_se,
         note = sprintf("steady_mean=%.3f; >100=%s >SE=%s n>=30=%s; pass=%s",
                        e$steady_mean, e$gap_gt_100, e$gap_gt_se, e$n_ge_30, e$pass))
}

out <- do.call(rbind, out_rows)
write.csv(out, OUT_PATH, row.names = FALSE)
cat(sprintf("\nWrote %s (%d rows)\n", OUT_PATH, nrow(out)))

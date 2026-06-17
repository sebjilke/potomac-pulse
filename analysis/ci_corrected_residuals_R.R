#!/usr/bin/env Rscript
# ci_corrected_residuals_R.R
# v36.1 corrected-residual CI derivation — R implementation (results-blind).
# Follows analysis/ci_v361_derivation_spec.md EXACTLY.
#
# Quantity quantiled: the `residual` column (= predictedCFS - actualLF, the
# CORRECTED residual). NOT rawResidual.
#
# Quantile method: R quantile(..., type = 7) — the DEFAULT, type-7 / linear
# interpolation. This equals numpy method='linear' so the independent Python
# run matches within < 0.01.
#
# Base R + stats only (no exotic packages).

suppressWarnings(suppressMessages({}))

# ---------------------------------------------------------------------------
# Constants (from spec)
# ---------------------------------------------------------------------------
B_PRIMARY   <- 30                 # primary burn-in
B_SENS      <- c(20, 30, 50, 75)  # sensitivity burn-ins
MIN_OBS     <- 250                # S-F9 fallback threshold
PROBS       <- c(0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95)
PROB_NAMES  <- c("q05", "q10", "q25", "q50", "q75", "q90", "q95")
BLOCK_L     <- 24                 # moving-block bootstrap block length
BBOOT       <- 1000               # bootstrap resamples
BOOT_SEED   <- 12345

FLOW_BINS   <- c("0-3000", "3000-6000", "6000-12000",
                 "12000-25000", "25000-50000", "50000+")
FLOW_STATES <- c("rising", "steady", "falling")

ANALYSIS_DIR <- "analysis"  # run from repo root /Users/sebjilke/Desktop/PotomacPulse
if (!dir.exists(ANALYSIS_DIR)) {
  # Allow running from inside analysis/ too.
  if (file.exists("ci_residuals_v361_multi.csv")) ANALYSIS_DIR <- "."
}
inpath  <- function(f) file.path(ANALYSIS_DIR, f)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Type-7 / linear-interpolation quantile (R default). Returns named vector.
q7 <- function(x, probs = PROBS, names_out = PROB_NAMES) {
  out <- as.numeric(quantile(x, probs = probs, type = 7, names = FALSE))
  names(out) <- names_out
  out
}

# Single type-7 quantile, NA-safe for empty/all-NA input.
q7one <- function(x, p) {
  x <- x[!is.na(x)]
  if (length(x) == 0L) return(NA_real_)
  as.numeric(quantile(x, probs = p, type = 7, names = FALSE))
}

# ---------------------------------------------------------------------------
# Moving-block bootstrap on q05 & q95 (S-F1) — diagnostic, NOT agreement-gated.
# Rows are ordered by predTs within the cell before blocking (caller's job).
# Returns named vector q05_ci_lo, q05_ci_hi, q95_ci_lo, q95_ci_hi, eff_n.
# ---------------------------------------------------------------------------
block_bootstrap <- function(resid_ordered, L = BLOCK_L, Bboot = BBOOT) {
  n <- length(resid_ordered)
  eff_n <- floor(n / L)
  out <- c(q05_ci_lo = NA_real_, q05_ci_hi = NA_real_,
           q95_ci_lo = NA_real_, q95_ci_hi = NA_real_, eff_n = eff_n)
  if (n < L) return(out)  # too few rows to form even one full block

  # Number of blocks needed to cover ~n observations.
  nblocks <- ceiling(n / L)
  # Valid block start indices: 1 .. (n - L + 1)
  max_start <- n - L + 1L

  q05boot <- numeric(Bboot)
  q95boot <- numeric(Bboot)
  for (b in seq_len(Bboot)) {
    starts <- sample.int(max_start, size = nblocks, replace = TRUE)
    # Build resampled series by concatenating blocks, trim to length n.
    idx <- unlist(lapply(starts, function(s) s:(s + L - 1L)), use.names = FALSE)
    idx <- idx[seq_len(n)]
    samp <- resid_ordered[idx]
    q05boot[b] <- as.numeric(quantile(samp, 0.05, type = 7, names = FALSE))
    q95boot[b] <- as.numeric(quantile(samp, 0.95, type = 7, names = FALSE))
  }
  out["q05_ci_lo"] <- as.numeric(quantile(q05boot, 0.025, type = 7, names = FALSE))
  out["q05_ci_hi"] <- as.numeric(quantile(q05boot, 0.975, type = 7, names = FALSE))
  out["q95_ci_lo"] <- as.numeric(quantile(q95boot, 0.025, type = 7, names = FALSE))
  out["q95_ci_hi"] <- as.numeric(quantile(q95boot, 0.975, type = 7, names = FALSE))
  out
}

# ---------------------------------------------------------------------------
# Compute the deterministic per-cell stats for a given residual vector and
# the matching ceilingApplied vector (same order/length).
# Returns a one-row data.frame fragment (n, mean, median, q*, n_ceiling,
# q95_noceiling). No source/bootstrap here.
# ---------------------------------------------------------------------------
cell_stats <- function(resid, ceiling) {
  n <- length(resid)
  qs <- q7(resid)
  no_ceil <- resid[ceiling == 0]
  data.frame(
    n            = n,
    mean         = mean(resid),
    median       = as.numeric(median(resid)),
    q05 = qs["q05"], q10 = qs["q10"], q25 = qs["q25"], q50 = qs["q50"],
    q75 = qs["q75"], q90 = qs["q90"], q95 = qs["q95"],
    n_ceiling    = sum(ceiling == 1),
    q95_noceiling = q7one(no_ceil, 0.95),
    stringsAsFactors = FALSE, row.names = NULL
  )
}

# ---------------------------------------------------------------------------
# Build the 24-cell list (18 bin×state + 6 bin-all). Each entry holds the
# subset rows (already burn-in filtered) ordered by predTs for bootstrap.
# ---------------------------------------------------------------------------
build_cells <- function(df) {
  # df is burn-in-filtered, ordered by predTs (global order preserved within
  # any subset since we subset by logical index).
  cells <- list()
  i <- 0
  # bin × state cells
  for (fb in FLOW_BINS) {
    for (fs in FLOW_STATES) {
      i <- i + 1
      sel <- df$flowBin == fb & df$flowState == fs
      cells[[i]] <- list(flowBin = fb, flowState = fs,
                         resid = df$residual[sel],
                         ceiling = df$ceilingApplied[sel])
    }
  }
  # bin-all pooled cells
  for (fb in FLOW_BINS) {
    i <- i + 1
    sel <- df$flowBin == fb
    cells[[i]] <- list(flowBin = fb, flowState = "all",
                       resid = df$residual[sel],
                       ceiling = df$ceilingApplied[sel])
  }
  cells
}

# ---------------------------------------------------------------------------
# Assemble the full primary table for a burn-in-filtered, predTs-ordered df.
# Includes source/fallback (S-F9) and block bootstrap (S-F1).
# ---------------------------------------------------------------------------
build_table <- function(df, do_bootstrap = TRUE) {
  cells <- build_cells(df)

  # First pass: deterministic stats + n per cell, keyed for fallback lookup.
  stat_list <- vector("list", length(cells))
  for (k in seq_along(cells)) {
    cl <- cells[[k]]
    if (length(cl$resid) == 0L) {
      st <- data.frame(n = 0L, mean = NA_real_, median = NA_real_,
                       q05 = NA_real_, q10 = NA_real_, q25 = NA_real_,
                       q50 = NA_real_, q75 = NA_real_, q90 = NA_real_,
                       q95 = NA_real_, n_ceiling = 0L, q95_noceiling = NA_real_,
                       stringsAsFactors = FALSE, row.names = NULL)
    } else {
      st <- cell_stats(cl$resid, cl$ceiling)
    }
    st$flowBin   <- cl$flowBin
    st$flowState <- cl$flowState
    stat_list[[k]] <- st
  }

  # Lookup of bin-all n for fallback decisions.
  binall_n <- sapply(FLOW_BINS, function(fb) {
    idx <- which(sapply(cells, function(c) c$flowBin == fb && c$flowState == "all"))
    length(cells[[idx]]$resid)
  })
  names(binall_n) <- FLOW_BINS

  # Index of bin-all stat rows for borrowing quantiles.
  binall_stat_idx <- sapply(FLOW_BINS, function(fb) {
    which(sapply(stat_list, function(s) s$flowBin == fb && s$flowState == "all"))
  })
  names(binall_stat_idx) <- FLOW_BINS

  # Determine source + (for bin×state) possibly borrow bin-all quantiles.
  det_cols <- c("mean","median","q05","q10","q25","q50","q75","q90","q95",
                "n_ceiling","q95_noceiling")
  rows <- vector("list", length(cells))
  for (k in seq_along(cells)) {
    cl <- cells[[k]]
    st <- stat_list[[k]]
    n  <- st$n

    if (cl$flowState == "all") {
      source <- "cell"  # all rows always use their own quantiles
    } else if (n >= MIN_OBS) {
      source <- "cell"
    } else if (binall_n[[cl$flowBin]] >= MIN_OBS) {
      source <- "bin-all"
      # Borrow the bin-all deterministic stats EXCEPT n (keep cell's own n),
      # and keep n_ceiling/q95_noceiling from the bin-all pool too (those are
      # part of the borrowed quantile set). Spec: "use the bin-all quantiles
      # for that cell". We report the cell's own n but bin-all's quantiles.
      ball <- stat_list[[ binall_stat_idx[[cl$flowBin]] ]]
      for (cc in det_cols) st[[cc]] <- ball[[cc]]
    } else {
      source <- "insufficient"  # report own quantiles, do NOT borrow global
    }
    st$source <- source
    rows[[k]] <- st
  }

  tab <- do.call(rbind, rows)

  # Block bootstrap (diagnostic). Uses the cell's OWN ordered residuals
  # regardless of source (it's a CI on the cell's data).
  if (do_bootstrap) {
    set.seed(BOOT_SEED)  # single global seed = 12345; cells run in order.
    boot_rows <- vector("list", length(cells))
    for (k in seq_along(cells)) {
      r <- cells[[k]]$resid  # already in predTs order (df ordered upstream)
      boot_rows[[k]] <- block_bootstrap(r, L = BLOCK_L, Bboot = BBOOT)
    }
    bmat <- do.call(rbind, boot_rows)
    tab$q05_ci_lo <- bmat[, "q05_ci_lo"]
    tab$q05_ci_hi <- bmat[, "q05_ci_hi"]
    tab$q95_ci_lo <- bmat[, "q95_ci_lo"]
    tab$q95_ci_hi <- bmat[, "q95_ci_hi"]
    tab$eff_n     <- as.integer(bmat[, "eff_n"])
  } else {
    tab$q05_ci_lo <- NA_real_; tab$q05_ci_hi <- NA_real_
    tab$q95_ci_lo <- NA_real_; tab$q95_ci_hi <- NA_real_
    tab$eff_n <- as.integer(floor(tab$n / BLOCK_L))
  }

  # Final column order per spec Outputs.
  tab <- tab[, c("flowBin","flowState","n","source","mean","median",
                 "q05","q10","q25","q50","q75","q90","q95",
                 "n_ceiling","q95_noceiling",
                 "q05_ci_lo","q05_ci_hi","q95_ci_lo","q95_ci_hi","eff_n")]
  rownames(tab) <- NULL

  # Order rows: each flowBin's three states then its all row, bins in canonical
  # order. (Cells already built in that order; keep as-is.)
  tab
}

# ---------------------------------------------------------------------------
# Era-bucketed q05/q95 rolling stability (S-F8).
# Split predTs into three ~equal-width CALENDAR spans (equal time width).
# ---------------------------------------------------------------------------
build_rolling <- function(df) {
  # Parse predTs (ISO8601, UTC) to numeric time.
  t <- as.POSIXct(df$predTs, format = "%Y-%m-%dT%H:%M:%OS", tz = "UTC")
  tmin <- min(t); tmax <- max(t)
  # Three equal-width spans by calendar time.
  breaks <- seq(as.numeric(tmin), as.numeric(tmax), length.out = 4)
  # Assign era 1..3; rightmost edge inclusive.
  era <- findInterval(as.numeric(t), breaks, rightmost.closed = TRUE)
  era[era < 1] <- 1; era[era > 3] <- 3

  # Era label = calendar span (year range) for readability.
  era_bounds <- as.POSIXct(breaks, origin = "1970-01-01", tz = "UTC")
  era_label <- sapply(1:3, function(e) {
    paste0(format(era_bounds[e], "%Y-%m-%d"), "_to_",
           format(era_bounds[e + 1], "%Y-%m-%d"))
  })

  out <- list()
  i <- 0
  add <- function(fb, fs, sel_bin_state) {
    for (e in 1:3) {
      sel <- sel_bin_state & era == e
      r <- df$residual[sel]
      i_local <<- i_local + 1
      out[[i_local]] <<- data.frame(
        flowBin = fb, flowState = fs, era = e, era_span = era_label[e],
        n = length(r),
        q05 = if (length(r)) q7one(r, 0.05) else NA_real_,
        q50 = if (length(r)) q7one(r, 0.50) else NA_real_,
        q95 = if (length(r)) q7one(r, 0.95) else NA_real_,
        stringsAsFactors = FALSE, row.names = NULL)
    }
  }
  i_local <- 0
  for (fb in FLOW_BINS) {
    for (fs in FLOW_STATES) {
      sel <- df$flowBin == fb & df$flowState == fs
      add(fb, fs, sel)
    }
    sel <- df$flowBin == fb
    add(fb, "all", sel)
  }
  do.call(rbind, out)
}

# ---------------------------------------------------------------------------
# Sensitivity table: cells × B in {20,30,50,75}, columns q05,q95,n only.
# ---------------------------------------------------------------------------
build_sensitivity <- function(raw) {
  rows <- list(); i <- 0
  for (B in B_SENS) {
    sub <- raw[raw$binCountAtPred >= B, , drop = FALSE]
    sub <- sub[order(sub$predTs), , drop = FALSE]
    cells <- build_cells(sub)
    for (cl in cells) {
      r <- cl$resid
      i <- i + 1
      rows[[i]] <- data.frame(
        burn_in = B, flowBin = cl$flowBin, flowState = cl$flowState,
        n = length(r),
        q05 = if (length(r)) q7one(r, 0.05) else NA_real_,
        q95 = if (length(r)) q7one(r, 0.95) else NA_real_,
        stringsAsFactors = FALSE, row.names = NULL)
    }
  }
  do.call(rbind, rows)
}

# ---------------------------------------------------------------------------
# Driver for one input file: read, report filter counts, build primary table.
# ---------------------------------------------------------------------------
process_file <- function(csv, label) {
  raw <- read.csv(csv, check.names = FALSE, stringsAsFactors = FALSE)
  cat(sprintf("\n=== %s (%s) ===\n", label, csv))
  cat(sprintf("  rows total                : %d\n", nrow(raw)))

  # Hard rule: residual must equal predictedCFS - actualLF; quantity = residual.
  # (No mutation; we trust the precomputed residual column per spec.)

  sub <- raw[raw$binCountAtPred >= B_PRIMARY, , drop = FALSE]
  cat(sprintf("  rows after burn-in (B>=%d) : %d\n", B_PRIMARY, nrow(sub)))

  # Order by predTs for the block bootstrap (within-cell order is inherited).
  sub <- sub[order(sub$predTs), , drop = FALSE]

  list(raw = raw, sub = sub)
}

# ===========================================================================
# MAIN
# ===========================================================================

multi_csv  <- inpath("ci_residuals_v361_multi.csv")
single_csv <- inpath("ci_residuals_v361_single.csv")

cat("v36.1 corrected-residual CI — R implementation\n")
cat("Quantile method: R quantile(type=7) = linear interpolation (numpy 'linear').\n")
cat("Quantity quantiled: `residual` column (predictedCFS - actualLF, corrected).\n")

# --- PRIMARY (multi, B=30) -------------------------------------------------
m <- process_file(multi_csv, "MULTI (primary)")
primary <- build_table(m$sub, do_bootstrap = TRUE)

write.csv(primary, inpath("ci_v361_R.csv"), row.names = FALSE, na = "")

# --- SENSITIVITY (multi, B in {20,30,50,75}) -------------------------------
sens <- build_sensitivity(m$raw)
write.csv(sens, inpath("ci_v361_R_sensitivity.csv"), row.names = FALSE, na = "")

# --- ROLLING (multi, B=30, era-bucketed) -----------------------------------
rolling <- build_rolling(m$sub)
write.csv(rolling, inpath("ci_v361_R_rolling.csv"), row.names = FALSE, na = "")

# --- SINGLE (single-pending, B=30, multi-format) ---------------------------
s <- process_file(single_csv, "SINGLE (guardrail)")
single_tab <- build_table(s$sub, do_bootstrap = TRUE)
write.csv(single_tab, inpath("ci_v361_R_single.csv"), row.names = FALSE, na = "")

# ---------------------------------------------------------------------------
# STDOUT summary
# ---------------------------------------------------------------------------
fmt <- function(x, d = 1) ifelse(is.na(x), "NA", formatC(x, format = "f", digits = d))

cat("\n=== PRIMARY 24-row table (multi, B=30) ===\n")
disp <- primary[, c("flowBin","flowState","n","source","mean",
                     "q05","q50","q95","q95_noceiling")]
disp$mean          <- fmt(disp$mean, 1)
disp$q05           <- fmt(disp$q05, 1)
disp$q50           <- fmt(disp$q50, 1)
disp$q95           <- fmt(disp$q95, 1)
disp$q95_noceiling <- fmt(disp$q95_noceiling, 1)
print(disp, row.names = FALSE)

cat("\n=== Cells with source != 'cell' ===\n")
nonself <- primary[primary$source != "cell", c("flowBin","flowState","n","source")]
if (nrow(nonself) == 0) cat("  (none)\n") else print(nonself, row.names = FALSE)

# Sanity checks
cat("\n=== Sanity checks ===\n")
ok_order <- with(primary, all(q05 <= q50 & q50 <= q95, na.rm = TRUE))
cat(sprintf("  q05<=q50<=q95 in every cell: %s\n", ok_order))
steady <- primary[primary$flowState == "steady", c("flowBin","mean")]
cat("  steady-cell means (expect near 0):\n")
print(data.frame(flowBin = steady$flowBin, mean = round(steady$mean, 1)),
      row.names = FALSE)

# High-flow single-vs-multi delta (S-F3)
cat("\n=== High-flow single vs multi (q05/q95 deltas) ===\n")
for (fb in c("25000-50000", "50000+")) {
  for (fs in FLOW_STATES) {
    mp <- primary[primary$flowBin == fb & primary$flowState == fs, ]
    sp <- single_tab[single_tab$flowBin == fb & single_tab$flowState == fs, ]
    cat(sprintf("  %-12s/%-7s  multi n=%-5d q05=%s q95=%s | single n=%-5d q05=%s q95=%s\n",
                fb, fs, mp$n, fmt(mp$q05,1), fmt(mp$q95,1),
                sp$n, fmt(sp$q05,1), fmt(sp$q95,1)))
  }
}

cat("\nWrote:\n")
cat("  ", inpath("ci_v361_R.csv"), "\n")
cat("  ", inpath("ci_v361_R_sensitivity.csv"), "\n")
cat("  ", inpath("ci_v361_R_single.csv"), "\n")
cat("  ", inpath("ci_v361_R_rolling.csv"), "\n")
cat("\nDONE\n")

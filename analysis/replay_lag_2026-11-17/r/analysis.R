# Replay-lag analysis, R implementation of ANALYSIS_SPEC.md (base R only).
# Run: cd analysis/replay_lag_2026-11-17 && Rscript r/analysis.R
options(stringsAsFactors = FALSE, digits = 15, scipen = 999)
args <- commandArgs(FALSE)
fa <- sub("^--file=", "", args[grepl("^--file=", args)])
here <- if (length(fa)) normalizePath(dirname(fa)) else normalizePath("r")
D <- normalizePath(file.path(here, ".."))
OUT <- file.path(here, "metrics_R.csv")
res <- list()
add <- function(pop, metric, value) {
  res[[length(res) + 1]] <<- data.frame(population = pop, metric = metric, value = as.numeric(value))
}
say <- function(...) cat(..., "\n", sep = "")

rd <- function(f, chr, num) {
  hdr <- names(read.csv(file.path(D, f), nrows = 1, colClasses = "character"))
  cc <- rep("NULL", length(hdr)); names(cc) <- hdr
  cc[chr] <- "character"; cc[num] <- "numeric"
  read.csv(file.path(D, f), colClasses = cc, na.strings = "")
}
CH <- c("predTs", "status", "flowBin", "flowState")
NU <- c("rawFinalCFS", "truthDependentHard", "truthInProdRange", "truthFlow", "errPctRaw", "errPctCorr",
        "age_por_h")
BURN <- "2011-12-04T05:00:00.000Z"

pair_set <- function(fF, fL, verbose = TRUE) {
  F <- rd(fF, CH, NU); L <- rd(fL, CH, NU)
  stopifnot(!anyDuplicated(F$predTs), !anyDuplicated(L$predTs))
  i <- match(F$predTs, L$predTs)
  keep <- !is.na(i)
  F <- F[keep, ]; L <- L[i[keep], ]
  cnt <- list()
  ok <- (F$status == "predicted") & (L$status == "predicted"); ok[is.na(ok)] <- FALSE
  n0 <- sum(ok); cnt$n_both_predicted <- n0
  F <- F[ok, ]; L <- L[ok, ]
  b <- F$predTs < BURN; cnt$excl_burnin <- sum(b); F <- F[!b, ]; L <- L[!b, ]
  h <- (F$truthDependentHard %in% 1) | (L$truthDependentHard %in% 1)
  cnt$excl_hard <- sum(h); F <- F[!h, ]; L <- L[!h, ]
  r <- (F$truthInProdRange %in% 0) | (L$truthInProdRange %in% 0)
  cnt$excl_range <- sum(r); F <- F[!r, ]; L <- L[!r, ]
  bl <- is.na(F$errPctCorr) | is.na(F$errPctRaw) | is.na(L$errPctCorr) | is.na(L$errPctRaw)
  cnt$excl_blank <- sum(bl); F <- F[!bl, ]; L <- L[!bl, ]
  cnt$n_scored <- nrow(F)
  if (verbose) for (k in names(cnt)) say("  ", k, " = ", cnt[[k]])
  list(F = F, L = L, cnt = cnt)
}

derive <- function(P) {
  F <- P$F; L <- P$L
  d <- data.frame(predTs = F$predTs, month = substr(F$predTs, 1, 7))
  d$d_corr <- abs(F$errPctCorr) - abs(L$errPctCorr)
  d$d_raw <- abs(F$errPctRaw) - abs(L$errPctRaw)
  d$aF <- abs(F$errPctCorr); d$aL <- abs(L$errPctCorr)
  d$sF <- F$errPctCorr; d$sL <- L$errPctCorr
  stateDiff <- (F$flowState != L$flowState) | (is.na(F$flowState) != is.na(L$flowState))
  binDiff <- (F$flowBin != L$flowBin) | (is.na(F$flowBin) != is.na(L$flowBin))
  stateDiff[is.na(stateDiff)] <- FALSE; binDiff[is.na(binDiff)] <- FALSE
  cfsDiff <- abs(F$rawFinalCFS - L$rawFinalCFS) / L$rawFinalCFS >= 0.01
  cfsDiff[is.na(cfsDiff)] <- FALSE
  d$stateDiff <- stateDiff; d$binDiff <- binDiff
  d$affected <- cfsDiff | stateDiff | binDiff
  d$rising <- (F$flowState %in% "rising") | (L$flowState %in% "rising")
  d$falling <- ((F$flowState %in% "falling") | (L$flowState %in% "falling")) & !d$rising
  d$steady_both <- (F$flowState %in% "steady") & (L$flowState %in% "steady")
  d$flood <- (!is.na(F$truthFlow) & F$truthFlow >= 50000) | (!is.na(L$truthFlow) & L$truthFlow >= 50000)
  d$era1 <- d$predTs < "2019-01-01T00:00:00.000Z"
  d$ageF <- F$age_por_h; d$ageL <- L$age_por_h
  d
}

pops <- function(d) {
  list(all = rep(TRUE, nrow(d)), affected = d$affected,
       affected_rising = d$affected & d$rising, affected_falling = d$affected & d$falling,
       affected_flood = d$affected & d$flood, flood_all = d$flood, rising_any = d$rising,
       steady_both = d$steady_both,
       affected_rising_era1 = d$affected & d$rising & d$era1,
       affected_rising_era2 = d$affected & d$rising & !d$era1)
}

MONTHS <- read.csv(file.path(D, "months.csv"), colClasses = "character")$month
BI <- as.matrix(read.csv(file.path(D, "bootstrap_indices.csv"), colClasses = "character", header = TRUE)[, -1])
BIDX <- matrix(match(BI, MONTHS), nrow = nrow(BI))
stopifnot(!anyNA(BIDX))
NB <- nrow(BIDX); NM <- length(MONTHS)
say("bootstrap rows = ", NB, ", months = ", NM)
CMAT <- matrix(tabulate((row(BIDX) - 1L) * NM + BIDX, nbins = NB * NM), nrow = NB, ncol = NM, byrow = TRUE)

measures <- function(prefix, d, sel) {
  x <- d[sel, ]
  n <- nrow(x)
  add(prefix, "n_pairs", n)
  add(prefix, "n_months", length(unique(x$month)))
  m <- function(v) if (n) mean(v) else NA_real_
  md <- function(v) if (n) median(v) else NA_real_
  add(prefix, "mean_d_corr", m(x$d_corr)); add(prefix, "median_d_corr", md(x$d_corr))
  add(prefix, "mean_d_raw", m(x$d_raw))
  add(prefix, "mean_abs_F", m(x$aF)); add(prefix, "mean_abs_L", m(x$aL))
  add(prefix, "median_abs_F", md(x$aF)); add(prefix, "median_abs_L", md(x$aL))
  add(prefix, "bias_F", m(x$sF)); add(prefix, "bias_L", m(x$sL))
  add(prefix, "big25_F", m(100 * (x$aF > 25))); add(prefix, "big25_L", m(100 * (x$aL > 25)))
  if (n) {
    mi <- match(x$month, MONTHS)
    S <- tapply(x$d_corr, factor(mi, levels = seq_len(NM)), sum); S[is.na(S)] <- 0
    N <- tabulate(mi, nbins = NM)
    num <- as.vector(CMAT %*% as.numeric(S)); den <- as.vector(CMAT %*% as.numeric(N))
    okb <- den > 0
    bm <- num[okb] / den[okb]
    q <- quantile(bm, c(0.025, 0.975), type = 7, names = FALSE)
    add(prefix, "ci_lo", q[1]); add(prefix, "ci_hi", q[2]); add(prefix, "boot_skipped", sum(!okb))
  } else { add(prefix, "ci_lo", NA); add(prefix, "ci_hi", NA); add(prefix, "boot_skipped", NA) }
}

# ---- main ----
say("== Section 1: main (shadow_F, shadow_L)")
P <- pair_set("shadow_F.csv", "shadow_L.csv")
for (k in names(P$cnt)) add("counts", k, P$cnt[[k]])
d <- derive(P)
add("all", "share_affected", 100 * mean(d$affected))
add("all", "share_state_differs", 100 * mean(d$stateDiff))
add("all", "share_bin_differs", 100 * mean(d$binDiff))
pp <- pops(d)
for (nm in names(pp)) { measures(nm, d, pp[[nm]]); say("  pop ", nm, " n=", sum(pp[[nm]])) }
SCORED_P <- P

# ---- sensitivity ----
sens <- function(tag, d) {
  p <- pops(d)
  for (nm in c("affected_rising", "affected_flood")) measures(paste0(tag, ".", nm), d, p[[nm]])
}
say("== sens_F0L0")
P0 <- pair_set("shadow_F0.csv", "shadow_L0.csv")
for (k in names(P0$cnt)) add("counts_sens_F0L0", k, P0$cnt[[k]])
sens("sens_F0L0", derive(P0))
say("== sens_age")
ka <- !((!is.na(d$ageF) & d$ageF > 1) | (!is.na(d$ageL) & d$ageL > 2))
say("  rows kept ", sum(ka), " of ", nrow(d)); add("counts_sens_age", "n_scored", sum(ka))
sens("sens_age", d[ka, ])
say("== sens_12mo")
k12 <- d$predTs >= "2012-12-01T05:00:00.000Z"
say("  rows kept ", sum(k12), " of ", nrow(d)); add("counts_sens_12mo", "n_scored", sum(k12))
sens("sens_12mo", d[k12, ])
say("== sens_gateold")
PG <- pair_set("shadow_F_gateold.csv", "shadow_L_gateold.csv")
for (k in names(PG$cnt)) add("counts_sens_gateold", k, PG$cnt[[k]])
sens("sens_gateold", derive(PG))

# ---- Section 8 ----
say("== Section 8: transient")
src <- read.csv(file.path(D, "..", "hourly_backtest_data_v361.csv"), colClasses = "character")
say("  source cols used: timestamp, por_now (Point of Rocks flow), lf_discharge (Little Falls flow)")
src_iso <- paste0(sub(" ", "T", src$timestamp), ":00.000Z")
src_hr <- as.numeric(as.POSIXct(src$timestamp, format = "%Y-%m-%d %H:%M", tz = "UTC")) / 3600
por <- suppressWarnings(as.numeric(src$por_now)); lf <- suppressWarnings(as.numeric(src$lf_discharge))
stopifnot(!anyNA(src_hr), !anyDuplicated(src_hr))
o <- order(src_hr); src_hr <- src_hr[o]; por <- por[o]; lf <- lf[o]; src_iso <- src_iso[o]
fh <- src_hr[!is.na(lf) & lf >= 50000]
prev <- c(-Inf, head(fh, -1))
ev <- fh[(fh - prev) >= 169]
hr_of_iso <- function(s) as.numeric(as.POSIXct(sub("Z$", "", sub("T", " ", s)), format = "%Y-%m-%d %H:%M:%S", tz = "UTC")) / 3600
E0 <- hr_of_iso("2012-12-01T05:00:00.000Z")
ev <- ev[ev >= E0]
n_events <- length(ev); add("transient", "n_events", n_events); say("  n_events = ", n_events)
porAt <- function(h) { i <- match(h, src_hr); ifelse(is.na(i), NA, por[i]) }
iso_of_hr <- function(h) format(as.POSIXct(h * 3600, origin = "1970-01-01", tz = "UTC"), "%Y-%m-%dT%H:%M:%S.000Z", tz = "UTC")
riseS <- rep(NA_real_, n_events)
for (j in seq_len(n_events)) {
  hs <- (ev[j] - 168):ev[j]
  p1 <- porAt(hs); p0 <- porAt(hs - 1)
  okh <- !is.na(p1) & !is.na(p0) & p1 > 0 & p0 > 0 & (p1 - p0) / p0 >= 0.02
  if (any(okh)) riseS[j] <- hs[which(okh)[1]] - 24
}
add("transient", "n_events_norise", sum(is.na(riseS))); say("  n_events_norise = ", sum(is.na(riseS)))

Fs <- rd("shadow_F.csv", c("predTs", "flowBin", "flowState"), "rawFinalCFS")
Fsc <- Fs[match(P$F$predTs, Fs$predTs), ]   # scored-set pairs only
Fsc_hr <- hr_of_iso(Fsc$predTs)
binsF <- read.csv(file.path(D, "bins_F.csv"), colClasses = c("character", "character", "character", "numeric", "numeric", "numeric"))
binsL <- read.csv(file.path(D, "bins_L.csv"), colClasses = c("character", "character", "character", "numeric", "numeric", "numeric"))
binsF$hr <- hr_of_iso(binsF$ts); binsL$hr <- hr_of_iso(binsL$ts)
ema_at <- function(B, cell, Shr) {
  s <- B[B$cell == cell & B$hr <= Shr, ]
  if (!nrow(s)) return(NA_real_)
  # last row (file order, stable) among rows at or before S
  s$emaMeanError[which.max(s$hr + seq_len(nrow(s)) * 1e-9)]
}
offs <- numeric(0); nobin <- 0; nopair <- 0
for (j in seq_len(n_events)) {
  if (is.na(riseS[j])) next
  S <- riseS[j]
  w <- which(Fsc_hr >= S & Fsc$flowState %in% "rising")
  if (!length(w)) { nopair <- nopair + 1; next }
  w <- w[1]
  cell <- paste0(Fsc$flowBin[w], "_", Fsc$flowState[w]); r <- Fsc$rawFinalCFS[w]
  eL <- ema_at(binsL, cell, S); eF <- ema_at(binsF, cell, S)
  if (is.na(eL) || is.na(eF)) { nobin <- nobin + 1; next }
  offs <- c(offs, (eL - eF) / r * 100)
}
add("transient", "n_events_nobin", nobin); add("transient", "n_events_nopair", nopair)
add("transient", "n_events_used", length(offs))
say("  n_events_nobin = ", nobin, "; no rising scored row found = ", nopair, "; used = ", length(offs))
for (k in c(1, 3, 6)) {
  o_k <- offs * 0.7^(k - 1)
  add("transient", paste0("median_abs_offset_k", k, "_pct"), median(abs(o_k)))
  add("transient", paste0("median_signed_offset_k", k, "_pct"), median(o_k))
  add("transient", paste0("p90_abs_offset_k", k, "_pct"), quantile(abs(o_k), 0.9, type = 7, names = FALSE))
}
# branched
FsAll <- rd("shadow_F.csv", c("predTs", "status", "flowBin", "flowState"), c("rawFinalCFS", "predictedCFS"))
for (dt in c("2015-01-01", "2019-01-01", "2023-01-01")) {
  sw <- rd(paste0("switch_", dt, ".csv"), c("predTs", "status", "flowBin", "flowState"), c("rawFinalCFS", "predictedCFS"))
  i <- match(sw$predTs, FsAll$predTs)
  okr <- !is.na(i) & sw$status == "predicted" & FsAll$status[i] == "predicted" & sw$flowState %in% "rising"
  okr[is.na(okr)] <- FALSE
  s2 <- sw[okr, ]; f2 <- FsAll[i[okr], ]
  real <- (s2$predictedCFS - f2$predictedCFS) / f2$rawFinalCFS * 100
  say("  switch ", dt, ": rising joined rows = ", length(real))
  add("transient", paste0("n_switch_rows_", dt), length(real))
  if (length(real)) {
    add("transient", paste0("realized_first_pct_", dt), real[1])
    add("transient", paste0("realized_first_predTs_hr_", dt), hr_of_iso(s2$predTs[1]))
    cat("  first predTs ", dt, ": ", s2$predTs[1], "\n", sep = "")
    Shr <- hr_of_iso(paste0(dt, "T00:00:00.000Z"))
    cell <- paste0(f2$flowBin[1], "_", f2$flowState[1])
    form <- (ema_at(binsL, cell, Shr) - ema_at(binsF, cell, Shr)) / f2$rawFinalCFS[1] * 100
    add("transient", paste0("formula_first_pct_", dt), form)
    add("transient", paste0("realized_median_abs_first10_", dt), median(abs(head(real, 10))))
    add("transient", paste0("realized_median_abs_last10_", dt), median(abs(tail(real, 10))))
  }
}

# ---- Section 9 ----
say("== Section 9: lag check")
CHK <- c("predTs", "status", "porQ", "porSrcTs", "efStage", "efSrcTs", "gooseQ", "gooseSrcTs", "lfQ", "lfSrcTs")
sidx <- function(iso) match(iso, src_iso)
srcval <- function(col) { v <- suppressWarnings(as.numeric(src[[col]]))[o]; v }
vals <- list(por = por, ef = srcval("ef_stage"), goose = srcval("goose"), lf = lf)
tot <- 0
for (arm in c("F", "L")) {
  X <- rd(paste0("shadow_", arm, ".csv"), CHK, character(0))
  X <- X[X$status %in% "predicted", ]
  X[c("porQ", "efStage", "gooseQ", "lfQ")] <- lapply(X[c("porQ", "efStage", "gooseQ", "lfQ")], function(z) NA_real_)
  Xn <- rd(paste0("shadow_", arm, ".csv"), c("predTs", "status"), c("porQ", "efStage", "gooseQ", "lfQ"))
  Xn <- Xn[Xn$status %in% "predicted", ]
  stopifnot(identical(Xn$predTs, X$predTs))
  nrows <- nrow(X); tot <- tot + nrows
  add("lagcheck", paste0("lag_rows_", arm), nrows); say("  arm ", arm, " rows = ", nrows)
  thr <- hr_of_iso(X$predTs)
  inputs <- list(por = c("porQ", "porSrcTs", 2), ef = c("efStage", "efSrcTs", 2),
                 goose = c("gooseQ", "gooseSrcTs", 2), lf = c("lfQ", "lfSrcTs", 1))
  for (nm in names(inputs)) {
    vc <- inputs[[nm]][1]; tc <- inputs[[nm]][2]
    lag <- if (arm == "F") 1 else as.numeric(inputs[[nm]][3])
    si <- sidx(X[[tc]])
    sv <- vals[[nm]][si]
    given <- Xn[[vc]]
    # value check: equal to source value at the source timestamp (NA vs NA counts as match only if both blank)
    bad_val <- ifelse(is.na(si), !(is.na(X[[tc]]) & is.na(given)), ifelse(is.na(sv) | is.na(given), !(is.na(sv) & is.na(given)), abs(sv - given) > 1e-9 * pmax(1, abs(sv))))
    # timestamp check where nominal-lag source row exists and is non-blank
    nom_iso <- iso_of_hr(thr - lag)
    ni <- sidx(nom_iso)
    exists_nb <- !is.na(ni) & !is.na(vals[[nm]][ni])
    bad_ts <- exists_nb & (is.na(X[[tc]]) | X[[tc]] != nom_iso)
    add("lagcheck", paste0("lag_mismatch_", arm, "_", vc, "_value"), sum(bad_val))
    add("lagcheck", paste0("lag_mismatch_", arm, "_", nm, "_ts_nominal"), sum(bad_ts))
    add("lagcheck", paste0("lag_nominal_rows_", arm, "_", nm), sum(exists_nb))
    say("   ", nm, ": value mismatches=", sum(bad_val), "; nominal-lag rows=", sum(exists_nb), " ts mismatches=", sum(bad_ts))
  }
}
add("lagcheck", "lag_rows", tot)

M <- do.call(rbind, res)
M$value <- ifelse(is.na(M$value), NA, M$value)
M$value <- vapply(M$value, function(v) if (is.na(v)) "" else sprintf("%.10g", v), "")
write.csv(M, OUT, row.names = FALSE, quote = FALSE)
say("wrote ", OUT, " (", nrow(M), " rows)")

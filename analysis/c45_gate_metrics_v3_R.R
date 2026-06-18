#!/usr/bin/env Rscript
# C45 v3 gate metrics — computed in R, working ONLY from the CSV.
#
# v3 variant: interp arm blends ONLY within +/-12% flow of the LOW/MID boundaries
# 3000/6000/12000; the 25000 & 50000 boundaries are hard steps; all mid-bin obs
# keep their exact binned correction.
#
# All metrics on UNCLIPPED residuals (resUnclBinned, resUnclInterp), which are the
# PRE-ceiling corrected residual estimates (est - actual).
#
# Output: analysis/c45_gate_metrics_v3_R.json (4 significant figures).

suppressWarnings(suppressMessages({
  library(jsonlite)
}))

sig4 <- function(x) signif(x, 4)

csv_path  <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/c45_gate_residuals_v3.csv"
json_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/c45_gate_metrics_v3_R.json"

df <- read.csv(csv_path, stringsAsFactors = FALSE, check.names = FALSE)

# --- Pull the columns we need ------------------------------------------------
flowBin       <- as.character(df[["flowBin"]])
resUnclBinned <- as.numeric(df[["resUnclBinned"]])
resUnclInterp <- as.numeric(df[["resUnclInterp"]])
resClipBinned <- as.numeric(df[["resClipBinned"]])
resClipInterp <- as.numeric(df[["resClipInterp"]])
ceilBinned    <- as.numeric(df[["ceilBinned"]])
ceilInterp    <- as.numeric(df[["ceilInterp"]])

nObs <- nrow(df)

# Absolute UNCLIPPED errors
absB <- abs(resUnclBinned)
absI <- abs(resUnclInterp)

# Helper metric functions (population RMSE = sqrt(mean(x^2)))
mae  <- function(a) mean(abs(a))
rmse <- function(a) sqrt(mean(a^2))
medabs <- function(a) median(abs(a))

# relative %: positive => interp WORSE than binned
relpct <- function(interp_val, binned_val) {
  if (binned_val == 0) return(NA_real_)
  100 * (interp_val - binned_val) / binned_val
}

# ============================================================================
# (1) OVERALL pooled metrics
# ============================================================================
binnedMedAbsErr <- medabs(resUnclBinned)
interpMedAbsErr <- medabs(resUnclInterp)
binnedMAE  <- mae(resUnclBinned)
interpMAE  <- mae(resUnclInterp)
binnedRMSE <- rmse(resUnclBinned)
interpRMSE <- rmse(resUnclInterp)

overall <- list(
  binnedMedAbsErr = sig4(binnedMedAbsErr),
  interpMedAbsErr = sig4(interpMedAbsErr),
  medAbsErrRelPct = sig4(relpct(interpMedAbsErr, binnedMedAbsErr)),
  medAbsErrAbsCfs = sig4(interpMedAbsErr - binnedMedAbsErr),
  binnedMAE = sig4(binnedMAE),
  interpMAE = sig4(interpMAE),
  maeRelPct = sig4(relpct(interpMAE, binnedMAE)),
  maeAbsCfs = sig4(interpMAE - binnedMAE),
  binnedRMSE = sig4(binnedRMSE),
  interpRMSE = sig4(interpRMSE),
  rmseRelPct = sig4(relpct(interpRMSE, binnedRMSE)),
  rmseAbsCfs = sig4(interpRMSE - binnedRMSE)
)

# ============================================================================
# (2) PER flowBin (6 bins): n, binned & interp median|err| + rel%, RMSE + rel%
# ============================================================================
binOrder <- c("0-3000", "3000-6000", "6000-12000",
              "12000-25000", "25000-50000", "50000+")
# Restrict to bins actually present, in canonical order
binLevels <- binOrder[binOrder %in% unique(flowBin)]

perBin <- lapply(binLevels, function(b) {
  idx <- flowBin == b
  rb <- resUnclBinned[idx]
  ri <- resUnclInterp[idx]
  mb <- medabs(rb); mi <- medabs(ri)
  rb_rmse <- rmse(rb); ri_rmse <- rmse(ri)
  list(
    flowBin            = b,
    n                  = sum(idx),
    binnedMedAbsErr    = sig4(mb),
    interpMedAbsErr    = sig4(mi),
    medRelPct          = sig4(relpct(mi, mb)),
    binnedRMSE         = sig4(rb_rmse),
    interpRMSE         = sig4(ri_rmse),
    rmseRelPct         = sig4(relpct(ri_rmse, rb_rmse))
  )
})

# ============================================================================
# (3) PAIRED Wilcoxon signed-rank: |resUnclBinned| vs |resUnclInterp| two-sided
# ============================================================================
wt <- suppressWarnings(
  wilcox.test(absB, absI, paired = TRUE, alternative = "two.sided",
              exact = FALSE, correct = TRUE)
)
# Direction: is interp the lower-error arm? Compare medians of paired diffs
# diff = |binned| - |interp|; positive median => interp lower error
pairedDiff <- absB - absI
nonzero    <- pairedDiff[pairedDiff != 0]
medianDiff <- median(pairedDiff)
interpLowerErr <- (median(absI) < median(absB))

wilcoxon <- list(
  statistic      = sig4(unname(wt$statistic)),
  pValue         = sig4(wt$p.value),
  medianPairedDiff_BinnedMinusInterp = sig4(medianDiff),
  interpLowerErr = interpLowerErr,
  direction      = if (medianDiff > 0) {
                     "interp lower abs error (binned - interp > 0)"
                   } else if (medianDiff < 0) {
                     "binned lower abs error (binned - interp < 0)"
                   } else {
                     "no difference in medians"
                   }
)

# ============================================================================
# (4) Descriptive: clipped MAE binned vs interp; ceiling-flip rate; nChanged
# ============================================================================
clipMAEbinned <- mae(resClipBinned)
clipMAEinterp <- mae(resClipInterp)

# ceiling-flip rate: share of obs where the ceiling decision differs between arms
ceilFlip    <- (ceilBinned != ceilInterp)
ceilFlipRate <- mean(ceilFlip)

# nChanged: obs where the two arms differ. Defined on the UNCLIPPED corrected
# residual estimate (the quantity the gate operates on pre-ceiling).
nChanged <- sum(resUnclBinned != resUnclInterp)

descriptive <- list(
  clipMAEbinned = sig4(clipMAEbinned),
  clipMAEinterp = sig4(clipMAEinterp),
  clipMAERelPct = sig4(relpct(clipMAEinterp, clipMAEbinned)),
  ceilFlipRate  = sig4(ceilFlipRate),
  ceilFlipCount = sum(ceilFlip),
  nChanged      = nChanged
)

# ============================================================================
# Assemble & write JSON
# ============================================================================
out <- list(
  language        = "R",
  source          = csv_path,
  rVersion        = paste(R.version$major, R.version$minor, sep = "."),
  variant         = "v3",
  nObs            = nObs,
  nChanged        = nChanged,
  ceilingFlipRate = sig4(ceilFlipRate),
  overall         = overall,
  perBin          = perBin,
  wilcoxon        = wilcoxon,
  descriptive     = descriptive,
  notes           = paste(
    "Metrics on UNCLIPPED residuals (est-actual), pre-ceiling.",
    "RMSE = sqrt(mean(x^2)) population form.",
    "rel% positive => interp WORSE.",
    "Wilcoxon: paired signed-rank on |resUnclBinned| vs |resUnclInterp|,",
    "two-sided, normal approx (exact=FALSE) with continuity correction",
    "(n too large for exact).",
    "nChanged = obs where resUnclBinned != resUnclInterp.",
    "ceiling-flip = ceilBinned != ceilInterp."
  )
)

writeLines(toJSON(out, auto_unbox = TRUE, pretty = TRUE, na = "null"), json_path)

cat("Wrote", json_path, "\n")
cat("nObs =", nObs, " nChanged =", nChanged,
    " ceilFlipRate =", sig4(ceilFlipRate), "\n")

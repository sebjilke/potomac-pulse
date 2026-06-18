#!/usr/bin/env Rscript
# C45 NARROW-BAND gate metrics (NB interpolation variant)
# Works ONLY from analysis/c45_gate_residuals_nb.csv. No Python output consulted.
#
# NB variant: interp arm blends only within +/-12% flow of each bin boundary;
# mid-bin obs keep their exact binned correction (so resUnclBinned==resUnclInterp there).
#
# Gated accuracy metrics use UNCLIPPED residuals (resUnclBinned / resUnclInterp).
# Descriptive section uses CLIPPED (post-ceiling) residuals + ceiling flags.

suppressWarnings(suppressMessages({
  library(jsonlite)
}))

sig4 <- function(x) {
  # round to 4 significant figures; preserve NA / non-finite
  ifelse(is.finite(x), signif(x, 4), x)
}

csv_path  <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/c45_gate_residuals_nb.csv"
json_path <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/c45_gate_metrics_nb_R.json"

d <- read.csv(csv_path, stringsAsFactors = FALSE, check.names = FALSE)

# --- required columns ---
req <- c("flowBin", "resUnclBinned", "resUnclInterp",
         "resClipBinned", "resClipInterp", "ceilBinned", "ceilInterp")
missing <- setdiff(req, names(d))
if (length(missing)) stop(paste("Missing columns:", paste(missing, collapse = ", ")))

# numeric coercion for residual / ceiling columns
for (cc in c("resUnclBinned", "resUnclInterp", "resClipBinned",
             "resClipInterp", "ceilBinned", "ceilInterp")) {
  d[[cc]] <- as.numeric(d[[cc]])
}

nObs <- nrow(d)

# ---- metric helpers ----
med_abs <- function(x) median(abs(x))
mae     <- function(x) mean(abs(x))
rmse    <- function(x) sqrt(mean(x^2))
relpct  <- function(interp, binned) (interp - binned) / binned * 100  # positive = interp WORSE

# =====================================================================
# 1. OVERALL pooled (UNCLIPPED)
# =====================================================================
rb <- d$resUnclBinned
ri <- d$resUnclInterp

binnedMedAbsErr <- med_abs(rb); interpMedAbsErr <- med_abs(ri)
binnedMAE       <- mae(rb);     interpMAE       <- mae(ri)
binnedRMSE      <- rmse(rb);    interpRMSE      <- rmse(ri)

overall <- list(
  binnedMedAbsErr = sig4(binnedMedAbsErr),
  interpMedAbsErr = sig4(interpMedAbsErr),
  medAbsErrRelPct = sig4(relpct(interpMedAbsErr, binnedMedAbsErr)),
  medAbsErrDeltaCfs = sig4(interpMedAbsErr - binnedMedAbsErr),
  binnedMAE = sig4(binnedMAE),
  interpMAE = sig4(interpMAE),
  maeRelPct = sig4(relpct(interpMAE, binnedMAE)),
  maeDeltaCfs = sig4(interpMAE - binnedMAE),
  binnedRMSE = sig4(binnedRMSE),
  interpRMSE = sig4(interpRMSE),
  rmseRelPct = sig4(relpct(interpRMSE, binnedRMSE)),
  rmseDeltaCfs = sig4(interpRMSE - binnedRMSE)
)

# =====================================================================
# 2. PER flowBin (all 6) (UNCLIPPED)
# =====================================================================
# stable ascending order by lower edge of bin
bins <- unique(d$flowBin)
lower_edge <- function(b) {
  num <- sub("([0-9]+).*", "\\1", b)
  suppressWarnings(as.numeric(num))
}
bins <- bins[order(sapply(bins, lower_edge))]

perBin <- lapply(bins, function(b) {
  sub  <- d[d$flowBin == b, ]
  rb_b <- sub$resUnclBinned
  ri_b <- sub$resUnclInterp
  bMed <- med_abs(rb_b); iMed <- med_abs(ri_b)
  bR   <- rmse(rb_b);    iR   <- rmse(ri_b)
  list(
    flowBin         = b,
    n               = nrow(sub),
    binnedMedAbsErr = sig4(bMed),
    interpMedAbsErr = sig4(iMed),
    medRelPct       = sig4(relpct(iMed, bMed)),
    binnedRMSE      = sig4(bR),
    interpRMSE      = sig4(iR),
    rmseRelPct      = sig4(relpct(iR, bR))
  )
})

# =====================================================================
# 3. PAIRED Wilcoxon signed-rank: |resUnclBinned| vs |resUnclInterp|
# =====================================================================
abs_b <- abs(rb)
abs_i <- abs(ri)
wt <- suppressWarnings(wilcox.test(abs_b, abs_i, paired = TRUE,
                                   alternative = "two.sided", exact = FALSE))
# direction: is interp lower error than binned? compare summed/median abs error
interpLowerErr <- mean(abs_i) < mean(abs_b)
direction <- if (mean(abs_i) < mean(abs_b)) {
  "interp lower |error| than binned"
} else if (mean(abs_i) > mean(abs_b)) {
  "interp higher |error| than binned"
} else {
  "no difference in mean |error|"
}

wilcoxon <- list(
  statistic      = sig4(unname(wt$statistic)),
  pValue         = sig4(unname(wt$p.value)),
  interpLowerErr = interpLowerErr,
  direction      = direction
)

# =====================================================================
# 4. DESCRIPTIVE (CLIPPED residuals + ceiling flags)
# =====================================================================
clipMAEbinned <- mae(d$resClipBinned)
clipMAEinterp <- mae(d$resClipInterp)
ceilingFlipRate <- mean(d$ceilBinned != d$ceilInterp)

# obs where interp differs from binned at all (near-boundary obs)
diffMask  <- d$resUnclBinned != d$resUnclInterp
nChanged  <- sum(diffMask)
fracChanged <- nChanged / nObs

descriptive <- list(
  clipMAEbinned   = sig4(clipMAEbinned),
  clipMAEinterp   = sig4(clipMAEinterp),
  clipMAERelPct   = sig4(relpct(clipMAEinterp, clipMAEbinned)),
  ceilingFlipRate = sig4(ceilingFlipRate),
  nChanged        = nChanged,
  fracChanged     = sig4(fracChanged)
)

# =====================================================================
# assemble + write
# =====================================================================
out <- list(
  variant       = "narrow-band (+/-12% flow of each bin boundary; mid-bin keeps exact binned correction)",
  language      = "R",
  rVersion      = paste(R.version$major, R.version$minor, sep = "."),
  csvPath       = csv_path,
  nObs          = nObs,
  residualBasis = "UNCLIPPED (resUnclBinned/resUnclInterp) for gated accuracy; CLIPPED for descriptive",
  overall       = overall,
  perBin        = perBin,
  wilcoxon      = wilcoxon,
  descriptive   = descriptive
)

write_json(out, json_path, pretty = TRUE, auto_unbox = TRUE, digits = NA, na = "null")

cat("nObs:", nObs, "\n")
cat("OVERALL (UNCLIPPED):\n")
cat(sprintf("  med|res|  binned=%.4g interp=%.4g rel%%=%.4g\n",
            binnedMedAbsErr, interpMedAbsErr, relpct(interpMedAbsErr, binnedMedAbsErr)))
cat(sprintf("  MAE       binned=%.4g interp=%.4g rel%%=%.4g\n",
            binnedMAE, interpMAE, relpct(interpMAE, binnedMAE)))
cat(sprintf("  RMSE      binned=%.4g interp=%.4g rel%%=%.4g\n",
            binnedRMSE, interpRMSE, relpct(interpRMSE, binnedRMSE)))
cat("PER BIN:\n")
for (pb in perBin) {
  cat(sprintf("  %-12s n=%-6d med b=%.4g i=%.4g (%.3g%%)  rmse b=%.4g i=%.4g (%.3g%%)\n",
              pb$flowBin, pb$n, pb$binnedMedAbsErr, pb$interpMedAbsErr, pb$medRelPct,
              pb$binnedRMSE, pb$interpRMSE, pb$rmseRelPct))
}
cat(sprintf("WILCOXON V=%.6g p=%.4g  %s\n", wt$statistic, wt$p.value, direction))
cat(sprintf("DESCRIPTIVE clipMAE b=%.4g i=%.4g  flipRate=%.4g  nChanged=%d frac=%.4g\n",
            clipMAEbinned, clipMAEinterp, ceilingFlipRate, nChanged, fracChanged))
cat("JSON written to:", json_path, "\n")

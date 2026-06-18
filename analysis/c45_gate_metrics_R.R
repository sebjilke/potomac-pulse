#!/usr/bin/env Rscript
# C45 gate metrics computed purely from the residuals CSV.
# Gated accuracy metrics use the UNCLIPPED (pre-ceiling) residuals.
# Output: analysis/c45_gate_metrics_R.json and analysis/c45_gate_metrics_R.csv

suppressWarnings(suppressMessages({
  # base R only; no external deps required
}))

infile  <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/c45_gate_residuals_multi.csv"
outjson <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/c45_gate_metrics_R.json"
outcsv  <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/c45_gate_metrics_R.csv"

df <- read.csv(infile, stringsAsFactors = FALSE, check.names = FALSE)

needed <- c("flowBin", "resUnclBinned", "resUnclInterp",
            "resClipBinned", "resClipInterp", "ceilBinned", "ceilInterp")
stopifnot(all(needed %in% names(df)))

# coerce numeric columns
numcols <- c("resUnclBinned", "resUnclInterp", "resClipBinned", "resClipInterp",
             "ceilBinned", "ceilInterp")
for (c in numcols) df[[c]] <- as.numeric(df[[c]])

# drop rows with NA in the unclipped residuals (gated accuracy metrics)
ok <- !(is.na(df$resUnclBinned) | is.na(df$resUnclInterp))
df <- df[ok, , drop = FALSE]
nObs <- nrow(df)

# round to 4 significant figures
sf4 <- function(x) signif(x, 4)

# ---- metric helpers (on unclipped residuals) ----
med_abs <- function(r) median(abs(r))
mae     <- function(r) mean(abs(r))
rmse    <- function(r) sqrt(mean(r^2))

rel_pct <- function(interp, binned) (interp - binned) / binned * 100
abs_d   <- function(interp, binned) interp - binned

# ============================================================
# 1. OVERALL pooled (unclipped)
# ============================================================
b_med <- med_abs(df$resUnclBinned); i_med <- med_abs(df$resUnclInterp)
b_mae <- mae(df$resUnclBinned);     i_mae <- mae(df$resUnclInterp)
b_rms <- rmse(df$resUnclBinned);    i_rms <- rmse(df$resUnclInterp)

overall <- list(
  binnedMedAbsErr = sf4(b_med),
  interpMedAbsErr = sf4(i_med),
  medAbsErrRelPct = sf4(rel_pct(i_med, b_med)),
  medAbsErrAbsCfs = sf4(abs_d(i_med, b_med)),

  binnedMAE = sf4(b_mae),
  interpMAE = sf4(i_mae),
  maeRelPct = sf4(rel_pct(i_mae, b_mae)),
  maeAbsCfs = sf4(abs_d(i_mae, b_mae)),

  binnedRMSE = sf4(b_rms),
  interpRMSE = sf4(i_rms),
  rmseRelPct = sf4(rel_pct(i_rms, b_rms)),
  rmseAbsCfs = sf4(abs_d(i_rms, b_rms))
)

# ============================================================
# 2. PER flowBin (all 6, fixed order)
# ============================================================
binOrder <- c("0-3000", "3000-6000", "6000-12000",
              "12000-25000", "25000-50000", "50000+")

perBin <- list()
perBinRows <- data.frame()
for (fb in binOrder) {
  sub <- df[df$flowBin == fb, , drop = FALSE]
  n   <- nrow(sub)
  if (n == 0) {
    bm <- NA; im <- NA; mrp <- NA; brm <- NA; irm <- NA; rrp <- NA
  } else {
    bm  <- med_abs(sub$resUnclBinned)
    im  <- med_abs(sub$resUnclInterp)
    mrp <- rel_pct(im, bm)
    brm <- rmse(sub$resUnclBinned)
    irm <- rmse(sub$resUnclInterp)
    rrp <- rel_pct(irm, brm)
  }
  perBin[[length(perBin) + 1]] <- list(
    flowBin         = fb,
    n               = n,
    binnedMedAbsErr = sf4(bm),
    interpMedAbsErr = sf4(im),
    medRelPct       = sf4(mrp),
    binnedRMSE      = sf4(brm),
    interpRMSE      = sf4(irm),
    rmseRelPct      = sf4(rrp)
  )
  perBinRows <- rbind(perBinRows, data.frame(
    flowBin = fb, n = n,
    binnedMedAbsErr = sf4(bm), interpMedAbsErr = sf4(im), medRelPct = sf4(mrp),
    binnedRMSE = sf4(brm), interpRMSE = sf4(irm), rmseRelPct = sf4(rrp),
    stringsAsFactors = FALSE
  ))
}

# ============================================================
# 3. PAIRED Wilcoxon signed-rank: |resUnclBinned| vs |resUnclInterp|
#    two-sided, paired; zero-difference pairs dropped (default)
# ============================================================
ab <- abs(df$resUnclBinned)
ai <- abs(df$resUnclInterp)
wt <- suppressWarnings(wilcox.test(ab, ai, paired = TRUE,
                                   alternative = "two.sided", exact = FALSE))
# median of paired differences (binned - interp); >0 means interp smaller |err|
medDiff <- median(ab - ai)
interpLowerErr <- (median(ai) < median(ab))

wilcoxon <- list(
  statistic      = sf4(unname(wt$statistic)),
  pValue         = sf4(wt$p.value),
  interpLowerErr = interpLowerErr,
  medianDiffBinnedMinusInterp = sf4(medDiff),
  nNonZeroPairs  = sum((ab - ai) != 0)
)

# ============================================================
# 4. DESCRIPTIVE: clipped MAE; ceiling-flip rate
# ============================================================
okc <- !(is.na(df$resClipBinned) | is.na(df$resClipInterp))
clippedMAE <- list(
  binned = sf4(mean(abs(df$resClipBinned[okc]))),
  interp = sf4(mean(abs(df$resClipInterp[okc]))),
  nObs   = sum(okc)
)
okf <- !(is.na(df$ceilBinned) | is.na(df$ceilInterp))
ceilingFlipRate <- sf4(mean(df$ceilBinned[okf] != df$ceilInterp[okf]))

# ============================================================
# Assemble + write JSON (manual, base R) and CSV
# ============================================================
jnum <- function(x) {
  if (is.null(x) || (length(x) == 1 && is.na(x))) return("null")
  if (is.logical(x)) return(if (x) "true" else "false")
  format(x, scientific = FALSE, trim = TRUE)
}
jstr <- function(x) paste0("\"", x, "\"")

# overall block
ov_keys <- names(overall)
ov_lines <- paste0("    ", jstr(ov_keys), ": ", sapply(overall, jnum))
ov_block <- paste0("  \"overall\": {\n", paste(ov_lines, collapse = ",\n"), "\n  }")

# perBin block
pb_objs <- sapply(perBin, function(p) {
  ks <- names(p)
  vals <- sapply(ks, function(k) {
    v <- p[[k]]
    if (k == "flowBin") jstr(v) else jnum(v)
  })
  paste0("    {\n", paste0("      ", jstr(ks), ": ", vals, collapse = ",\n"), "\n    }")
})
pb_block <- paste0("  \"perBin\": [\n", paste(pb_objs, collapse = ",\n"), "\n  ]")

# wilcoxon block
wx_keys <- names(wilcoxon)
wx_lines <- paste0("    ", jstr(wx_keys), ": ", sapply(wilcoxon, jnum))
wx_block <- paste0("  \"wilcoxon\": {\n", paste(wx_lines, collapse = ",\n"), "\n  }")

# clippedMAE block
cm_keys <- names(clippedMAE)
cm_lines <- paste0("    ", jstr(cm_keys), ": ", sapply(clippedMAE, jnum))
cm_block <- paste0("  \"clippedMAE\": {\n", paste(cm_lines, collapse = ",\n"), "\n  }")

notes <- paste0(
  "Computed in R (base) from CSV only; no Python output consulted. ",
  "Gated accuracy metrics use UNCLIPPED residuals (resUncl*). ",
  "Wilcoxon: paired signed-rank on |resUnclBinned| vs |resUnclInterp|, two-sided, ",
  "normal approx (exact=FALSE due to ties/n), zero-diff pairs dropped. ",
  "All reported numbers rounded to 4 significant figures."
)

json <- paste0(
  "{\n",
  "  \"language\": \"R\",\n",
  "  \"nObs\": ", nObs, ",\n",
  ov_block, ",\n",
  pb_block, ",\n",
  wx_block, ",\n",
  cm_block, ",\n",
  "  \"ceilingFlipRate\": ", jnum(ceilingFlipRate), ",\n",
  "  \"notes\": ", jstr(notes), "\n",
  "}\n"
)
writeLines(json, outjson)
write.csv(perBinRows, outcsv, row.names = FALSE)

cat("nObs =", nObs, "\n")
cat("Wrote:", outjson, "\n")
cat("Wrote:", outcsv, "\n")
print(overall)
print(perBinRows)
print(wilcoxon)
print(clippedMAE)
cat("ceilingFlipRate =", ceilingFlipRate, "\n")

# v38.0 gate — BLIND R headline metrics (plan v3 §6 verification protocol).
# Independent implementation: reads ONLY v38_residuals_{mode}.csv and the plan's window
# constants; must NOT read any Python output. Emits v38_headline_R_{mode}.csv for the
# cross-language comparison (agreement < 0.01).

suppressWarnings(suppressMessages({
  args <- commandArgs(trailingOnly = TRUE)
}))

windows <- list(
  c("2012-07-08", "2012-07-12"), c("2014-08-10", "2014-08-14"),
  c("2019-07-22", "2019-07-26"), c("2019-10-15", "2019-10-23"),
  c("2022-07-07", "2022-07-11"), c("2022-08-03", "2022-08-08"),
  c("2026-07-09", "2026-07-12"), c("2026-07-17", "2026-07-20")
)

dir <- dirname(sub("--file=", "", grep("--file=", commandArgs(FALSE), value = TRUE)[1]))

for (mode in c("multi", "single")) {
  path <- file.path(dir, sprintf("v38_residuals_%s.csv", mode))
  df <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  valDate <- substr(df$valTs, 1, 10)
  inEvent <- rep(FALSE, nrow(df))
  for (w in windows) inEvent <- inEvent | (valDate >= w[1] & valDate <= w[2])

  dispCols <- grep("^disp_", names(df), value = TRUE)
  out <- data.frame(config = sub("^disp_", "", dispCols),
                    globalMAE = NA_real_, eventMAE = NA_real_, normalMAE = NA_real_,
                    medAbsPctGlobal = NA_real_)
  for (i in seq_along(dispCols)) {
    resid <- df[[dispCols[i]]] - df$actualLF
    out$globalMAE[i] <- mean(abs(resid))
    out$eventMAE[i] <- mean(abs(resid[inEvent]))
    out$normalMAE[i] <- mean(abs(resid[!inEvent]))
    out$medAbsPctGlobal[i] <- median(abs(resid / df$actualLF) * 100)
  }
  out[, 2:5] <- round(out[, 2:5], 4)
  outPath <- file.path(dir, sprintf("v38_headline_R_%s.csv", mode))
  write.csv(out, outPath, row.names = FALSE, quote = FALSE)
  cat(sprintf("[R] %s: %d rows, %d configs -> %s\n", mode, nrow(df), length(dispCols),
              basename(outPath)))
}

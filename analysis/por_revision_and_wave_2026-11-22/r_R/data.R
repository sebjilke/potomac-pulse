# Loads all inputs once
cat("loading data\n")
load_readings <- function(path) {
  d <- rd(path, c("gauge", "parameter", "time_utc", "value", "last_modified_utc"))
  d$t <- tsec(d$time_utc); d$v <- num(d$value)
  d$value <- NULL
  n0 <- nrow(d); d <- d[!is.na(d$t) & d$t <= CUT, ]
  attr(d, "n_after_cutoff") <- n0 - nrow(d)
  d$key <- paste(d$gauge, d$parameter, sep = "|")
  d
}
RD <- list(census = load_readings(file.path(TIDY, "readings_current_census.csv")),
           model = load_readings(file.path(TIDY, "readings_current_model.csv")),
           up = load_readings(file.path(TIDY, "readings_current_upstream.csv")),
           old = load_readings(file.path(TIDY, "readings_old_archive.csv")),
           oct = load_readings(file.path(TIDY, "readings_old_octpull.csv")))
for (nm in names(RD)) {
  d <- RD[[nm]]
  stopifnot(!anyDuplicated(paste(d$key, d$time_utc)))
  cat(sprintf("  %s: %d rows kept (dropped after cutoff: %d)\n", nm, nrow(d), attr(d, "n_after_cutoff")))
}
getser <- function(src, g, p) {
  d <- RD[[src]]; d <- d[d$key == paste(g, p, sep = "|"), ]
  d <- d[order(d$t), ]
  d
}
G <- list(por = "01638500", lf = "01646500", mono = "01643000", goose = "01644000", br = "01644280",
          sen = "01645000", ef = "01644148", shep = "01618000", hanc = "01613000", paw = "01610000",
          mill = "01636500", ant = "01619500", cono = "01614500", opeq = "01616500", cat = "01637500")
UPSTREAM <- c("01618000", "01613000", "01610000", "01636500", "01619500", "01614500", "01616500", "01637500")

RUNS_ALL <- rd(file.path(TIDY, "runs.csv"))
RUNS <- RUNS_ALL[RUNS_ALL$used == "1", ]
RUNS <- RUNS[order(num(RUNS$seq)), ]
LAB <- rd(file.path(RPL, "labels.csv"))
TRU <- rd(file.path(RPL, "truth.csv"))
RPR <- rd(file.path(RPL, "replay_runs.csv"))
CHK <- rd(file.path(TIDY, "checks.csv"))
BINS <- rd(file.path(TIDY, "bins.csv"))
FM <- rd(file.path(TIDY, "field_measurements.csv"))
WD <- rd(file.path(TIDY, "withdrawals_coop.csv"))
FOLDV <- rd(file.path(FOLD, "f_old_values.csv"))
cat(sprintf("  runs %d (used %d), labels %d, truth %d, replay %d, checks %d, bins %d, fm %d, wd %d, fold %d\n",
            nrow(RUNS_ALL), nrow(RUNS), nrow(LAB), nrow(TRU), nrow(RPR), nrow(CHK), nrow(BINS), nrow(FM), nrow(WD), nrow(FOLDV)))

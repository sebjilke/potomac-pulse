# q_runs.R : used runs, phases, truth for S0 logged (sourced after q_W12.R; needs `cen`)
runs_all <- read.csv(file.path(SD, "runs.csv"), colClasses = "character", na.strings = "", stringsAsFactors = FALSE)
lab <- read.csv("replay/out/labels.csv", colClasses = "character", na.strings = "", stringsAsFactors = FALSE)
tru <- read.csv("replay/out/truth.csv", colClasses = "character", na.strings = "", stringsAsFactors = FALSE)
rrun <- read.csv("replay/out/replay_runs.csv", colClasses = "character", na.strings = "", stringsAsFactors = FALSE)

RU <- runs_all[runs_all$used == "1", ]
RU$seq <- as.integer(RU$seq)
RU <- RU[order(RU$seq), ]
stopifnot(nrow(RU) == 275)
for (cn in c("raw_cfs", "final_cfs", "corr_c", "ceil_lim", "ceil_bound", "delta_ratio", "pre_cfs", "trv_t", "trv_gf2lf", "hist_ago"))
  RU[[cn]] <- as.numeric(RU[[cn]])
RU$at_m <- tmin(RU$at_utc); RU$due_m <- tmin(RU$due_utc)
lab$seq <- as.integer(lab$seq)
li <- match(RU$seq, lab$seq)
RU$label_all_three <- lab$label_all_three[li]
RU$gate_miss <- lab$gate_miss[li]
RU$phase <- ifelse(RU$label_all_three == "old", "OLD", ifelse(RU$label_all_three == "new", "NEW", "TRANS"))
RU$day <- floor(RU$at_m / 1440)
RU$hour_run <- local_hour_int(RU$at_m)
RU$hour_due <- local_hour_int(RU$due_m)

tru$seq <- as.integer(tru$seq)
tru$t1 <- as.numeric(tru$t1_lf_cfs_interpolated)
tru$due_m <- tmin(tru$due_utc)
t1_of <- function(scen) { z <- tru[tru$scenario == scen, ]; z$t1[match(RU$seq, z$seq)] }
RU$t1 <- t1_of("S0")

# own linear interpolation of LF flow (census table) at a time (minutes)
lfr <- series_readings(cen, "01646500", "00060")
t1_own <- function(tm) {
  i <- findInterval(tm, lfr$rt)
  out <- rep(NA_real_, length(tm))
  for (j in seq_along(tm)) {
    if (i[j] < 1) next
    if (lfr$rt[i[j]] == tm[j]) { out[j] <- lfr$rv[i[j]]; next }
    if (i[j] >= length(lfr$rt)) next
    a <- i[j]; b <- a + 1
    out[j] <- lfr$rv[a] + (lfr$rv[b] - lfr$rv[a]) * (tm[j] - lfr$rt[a]) / (lfr$rt[b] - lfr$rt[a])
  }
  out
}
# sanity check of the interpolation rule against truth.csv (its own due times, all scenarios)
chk <- t1_own(tru$due_m)
okc <- !is.na(chk) & !is.na(tru$t1)
M("common", "", "t1_interp_check_n_compared_with_truth_csv", sum(okc))
M("common", "", "t1_interp_check_max_abs_diff_cfs", max(abs(chk[okc] - tru$t1[okc])))
M("common", "", "t1_interp_check_n_truth_blank_but_own_defined", sum(is.na(tru$t1) & !is.na(chk)))
M("common", "", "t1_interp_check_n_truth_defined_but_own_blank", sum(!is.na(tru$t1) & is.na(chk)))
i212 <- which(RU$seq == 212)
t1_truthcsv_212 <- RU$t1[i212]
t1_own_212 <- t1_own(RU$due_m[i212])
M("common", "", "t1_seq212_truth_csv_replayed_due", t1_truthcsv_212)
M("common", "", "t1_seq212_own_at_runs_due_utc", t1_own_212)
RU$t1[i212] <- t1_own_212

M("common", "", "n_used_runs", nrow(RU))
M("common", "", "n_used_runs_blank_T1_S0_dropped", sum(is.na(RU$t1)))
for (ph in c("OLD", "NEW", "TRANS")) {
  M("common", ph, "n_runs", sum(RU$phase == ph))
  M("common", ph, "first_seq", min(RU$seq[RU$phase == ph]))
  M("common", ph, "last_seq", max(RU$seq[RU$phase == ph]))
}
RU$e_raw <- (RU$raw_cfs - RU$t1) / RU$t1 * 100
RU$e_final <- (RU$final_cfs - RU$t1) / RU$t1 * 100
RW <- RU[!is.na(RU$t1), ]     # W4 universe: used runs with a T1 for S0 logged
M("common", "", "n_W4_runs_with_T1", nrow(RW))
for (ph in c("OLD", "NEW", "TRANS")) M("common", ph, "n_runs_with_T1", sum(RW$phase == ph))

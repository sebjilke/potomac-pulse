invisible(Sys.setlocale("LC_COLLATE", "C"))
T0 <- Sys.time()
OUT <- "r/"
source("r/lib.R")
source("r/unit_tests.R")

# ---------- output helpers ----------
write_lines_lf <- function(lines, path) {
  con <- file(path, open = "wb"); on.exit(close(con))
  writeLines(lines, con, sep = "\n", useBytes = TRUE)
}
write_df <- function(df, name) {
  for (j in seq_along(df)) { df[[j]] <- as.character(df[[j]]); df[[j]][is.na(df[[j]])] <- "" }
  lines <- c(paste(names(df), collapse = ","), if (nrow(df) > 0) do.call(paste, c(unname(as.list(df)), sep = ",")))
  write_lines_lf(lines, paste0(OUT, name))
}
CHECK_NAMES <- character(0); CHECK_N <- numeric(0); CHECK_V <- numeric(0)
add_check <- function(name, n, v) { CHECK_NAMES <<- c(CHECK_NAMES, name); CHECK_N <<- c(CHECK_N, n); CHECK_V <<- c(CHECK_V, v) }
write_checks <- function() write_df(data.frame(check = CHECK_NAMES, n_checked = I0(CHECK_N), n_violations = I0(CHECK_V)), "checks.csv")
stop_run <- function(msg) { write_checks(); cat("STOP:", msg, "\n"); quit(save = "no", status = 1) }

# ---------- 14: unit tests ----------
for (nm in names(UNIT_TESTS)) {
  res <- tryCatch(isTRUE(UNIT_TESTS[[nm]]()), error = function(e) { cat("unit test error", nm, conditionMessage(e), "\n"); FALSE })
  add_check(nm, 1, if (res) 0 else 1)
  if (!res) stop_run(paste("unit test failed:", nm))
}
cat("unit tests passed\n")

# ---------- C00 ----------
P_HOURLY <- "../rising-limb-travel-backtest/hourly_backtest_data_v39.csv"
P_RISE <- "../rising-limb-travel-backtest/rising_limb_events_python_v39.csv"
P_REPLAY <- "../onset_correction_2026-11-25/replay_L/shadow_L.csv"
P_DR <- "data/difficult_run_hourly.csv"
DR_SHA <- "fc35a7fc5440823b04cfb287e52d212cc48eef6e7b69489ec8901f1cea17f4e0"
files <- list(list(P_HOURLY, 10133893, "d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f"),
              list(P_RISE, 24205, "978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44"),
              list(P_REPLAY, 109952178, "dcc63931841b537a834962b9a7c60e6edfd3b72b8bd491b43af89bbba0ba5aba"))
DR_PRESENT <- file.exists(P_DR)
if (DR_PRESENT) files[[4]] <- list(P_DR, 2879671, DR_SHA)
c00v <- 0
for (f in files) {
  sh <- unname(tools::sha256sum(f[[1]])); sz <- file.size(f[[1]])
  if (is.na(sh) || sh != f[[3]] || sz != f[[2]]) { c00v <- c00v + 1; cat("C00 mismatch", f[[1]], sh, sz, "\n") }
  if (f[[1]] == P_DR) DR_SHA_ACTUAL <- sh
}
add_check("C00_inputs_sha", length(files), c00v)
if (c00v > 0) stop_run("C00")

# ---------- reading ----------
split_lines <- function(path) {
  lines <- readLines(path, warn = FALSE)
  lines <- sub("\r$", "", lines)
  parts <- strsplit(paste0(lines, ",#"), ",", fixed = TRUE)
  nf <- lengths(parts) - 1L
  list(lines = lines, parts = parts, nf = nf)
}
to_matrix <- function(sp, ncol_) {
  if (any(sp$nf != ncol_)) return(NULL)
  matrix(unlist(sp$parts), ncol = ncol_ + 1, byrow = TRUE)[, seq_len(ncol_), drop = FALSE]
}

# --- hourly (C01) ---
hs <- split_lines(P_HOURLY)
hh <- hs$parts[[1]]; hh <- hh[-length(hh)]
NUMCOLS <- c("por_now", "ef_stage", "lf_discharge", "lf_stage", "monocacy", "goose", "broad_run", "seneca")
c01v <- 0
need <- c("timestamp", NUMCOLS)
if (!all(vapply(need, function(n) sum(hh == n) == 1, logical(1)))) c01v <- c01v + 1
nlines <- length(hs$lines) - 1L
dl_nf <- hs$nf[-1]
c01v <- c01v + sum(dl_nf != 12)
if (any(hs$nf != 12)) {
  add_check("C01_hourly_file", nlines, c01v + 1); stop_run("C01 field counts")
}
HM <- to_matrix(hs, 12); colnames(HM) <- hh
HM <- HM[-1, , drop = FALSE]
ts <- HM[, "timestamp"]
okform <- grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:00$", ts)
mo <- suppressWarnings(as.integer(substr(ts, 6, 7))); dd <- suppressWarnings(as.integer(substr(ts, 9, 10))); hr <- suppressWarnings(as.integer(substr(ts, 12, 13)))
okrng <- okform & !is.na(mo) & mo >= 1 & mo <= 12 & dd >= 1 & dd <= 31 & hr >= 0 & hr <= 23
c01v <- c01v + sum(!okrng)
if (any(!okrng)) { add_check("C01_hourly_file", nlines, c01v); stop_run("C01 timestamps") }
HK <- hkey(ts)
c01v <- c01v + sum(diff(HK) <= 0)
for (cn in NUMCOLS) {
  x <- HM[, cn]; nb <- x != ""
  bad <- nb & !grepl("^[0-9]+(\\.[0-9]+)?$", x)
  c01v <- c01v + sum(bad)
  xv <- suppressWarnings(as.numeric(x[nb & !bad]))
  c01v <- c01v + sum(xv <= 0)
}
K0 <- 367421; K1 <- 498407; NH <- K1 - K0 + 1
c01v <- c01v + (nlines != 130416) + (HK[1] != K0) + (HK[length(HK)] != K1)
add_check("C01_hourly_file", nlines, c01v)
if (c01v > 0) stop_run("C01")

dense <- function(col) { x <- rep(NA_real_, NH); x[HK - K0 + 1] <- as.numeric(HM[, col]); x }
RAW <- lapply(setNames(NUMCOLS, NUMCOLS), dense)
S_ef <- mkser(RAW$ef_stage, K0); S_lfs <- mkser(RAW$lf_stage, K0); S_lf <- mkser(RAW$lf_discharge, K0)
S_por <- mkser(RAW$por_now, K0)
S_efq <- smap(S_ef, function(v) 126.0 * v^2.46)
S_lnef <- smap(S_ef, log); S_lnlf <- smap(S_lf, log)
CR <- list(sen = mkser(RAW$seneca, K0), brun = mkser(RAW$broad_run, K0), mono = mkser(RAW$monocacy, K0), goose = mkser(RAW$goose, K0), dr = NULL)

# --- rise list (C02) ---
rs_ <- split_lines(P_RISE)
rh <- rs_$parts[[1]]; rh <- rh[-length(rh)]
c02v <- 0
needr <- c("onset_no", "onset_t0", "onset_tp", "event_id", "event_t0", "event_tp", "event_class")
if (!all(vapply(needr, function(n) sum(rh == n) >= 1, logical(1)))) c02v <- c02v + 1
c02v <- c02v + sum(rs_$nf[-1] != 47)
if (any(rs_$nf != 47)) { add_check("C02_events_file", length(rs_$lines) - 1L, c02v + 1); stop_run("C02 field counts") }
RM <- to_matrix(rs_, 47); colnames(RM) <- rh; RM <- RM[-1, , drop = FALSE]
nR <- nrow(RM)
evc <- RM[, "event_class"]; is_small <- evc == ""
tform <- function(x) grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:00$", x)
c02v <- c02v + sum(!tform(RM[is_small, "onset_t0"])) + sum(!tform(RM[is_small, "onset_tp"])) +
  sum(!tform(RM[!is_small, "event_t0"])) + sum(!tform(RM[!is_small, "event_tp"]))
ev_idx <- which(!is_small)
ev_ids <- unique(RM[ev_idx, "event_id"])
ev_first <- ev_idx[match(ev_ids, RM[ev_idx, "event_id"])]
c02v <- c02v + (nR != 87) + (length(ev_idx) != 54) + (length(ev_ids) != 53) + (sum(is_small) != 33)
for (id in ev_ids) {
  rr <- ev_idx[RM[ev_idx, "event_id"] == id]
  if (length(unique(RM[rr, "event_t0"])) > 1 || length(unique(RM[rr, "event_tp"])) > 1) c02v <- c02v + 1
}
add_check("C02_events_file", nR, c02v)
if (c02v > 0) stop_run("C02")

# --- replay (C03) ---
rhead <- strsplit(readLines(P_REPLAY, n = 1, warn = FALSE), ",", fixed = TRUE)[[1]]
nfr <- count.fields(P_REPLAY, sep = ",", quote = "", comment.char = "", blank.lines.skip = FALSE)
c03v <- sum(nfr[-1] != 87)
usedR <- c("predTs", "status", "travelGFtoLF")
if (!all(vapply(usedR, function(n) sum(rhead == n) == 1, logical(1)))) c03v <- c03v + 1
cc <- ifelse(rhead %in% usedR, "character", "NULL")
RP <- read.csv(P_REPLAY, header = TRUE, colClasses = cc, quote = "", comment.char = "", na.strings = character(0),
               stringsAsFactors = FALSE, check.names = FALSE)
nrp <- nrow(RP)
rform <- grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:00:00\\.000Z$", RP$predTs)
c03v <- c03v + sum(!rform)
if (any(!rform)) { add_check("C03_replay_file", nrp, c03v); stop_run("C03 predTs") }
RK <- hkey(RP$predTs)
c03v <- c03v + sum(RK != (K0 + seq_len(nrp) - 1))
c03v <- c03v + sum(!(RP$status %in% c("predicted", "no_por", "no_truth", "no_lf")))
has_clock <- RP$status %in% c("predicted", "no_truth")
tnum <- grepl("^-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?$", RP$travelGFtoLF)
c03v <- c03v + sum(has_clock & (RP$travelGFtoLF == "" | !tnum))
c03v <- c03v + (nrp != 130987)
add_check("C03_replay_file", nrp, c03v)
if (c03v > 0) stop_run("C03")
RP_trav <- rep(NA_real_, nrp)
usev <- has_clock & RP$travelGFtoLF != ""
RP_trav[usev] <- as.numeric(RP$travelGFtoLF[usev])
APP_OK <- usev & !is.na(RP_trav)
n_replay_pred <- sum(RP$status == "predicted"); n_with_clock <- sum(APP_OK)
rm(RP); invisible(gc(verbose = FALSE))

# --- Difficult Run (C04) ---
NONPOS <- NA; DR_NPRES <- NA
if (DR_PRESENT) {
  ds <- split_lines(P_DR)
  c04v <- 0
  if (!identical(ds$lines[1], "timestamp,dr_discharge")) c04v <- c04v + 1
  nd <- length(ds$lines) - 1L
  c04v <- c04v + sum(ds$nf[-1] != 2)
  if (any(ds$nf != 2)) { add_check("C04_dr_file", nd, c04v + 1); stop_run("C04 fields") }
  DM <- to_matrix(ds, 2)[-1, , drop = FALSE]
  dform <- tform(DM[, 1]); c04v <- c04v + sum(!dform)
  if (any(!dform)) { add_check("C04_dr_file", nd, c04v); stop_run("C04 stamps") }
  DK <- hkey(DM[, 1])
  c04v <- c04v + sum(diff(DK) != 1) + (DK[1] != hkey("2011-12-01 05:00")) + (nd != 130987)
  nbk <- DM[, 2] != ""
  badv <- nbk & !grepl("^-?[0-9]+(\\.[0-9]+)?$", DM[, 2])
  c04v <- c04v + sum(badv)
  add_check("C04_dr_file", nd, c04v)
  if (c04v > 0) stop_run("C04")
  drv <- rep(NA_real_, NH); drv[DK - K0 + 1] <- as.numeric(DM[, 2])
  NONPOS <- sum(!is.na(drv) & drv <= 0)
  drv[!is.na(drv) & drv <= 0] <- NA
  DR_NPRES <- sum(!is.na(drv))
  S_dr <- mkser(drv, K0)
  CR$dr <- S_dr
} else add_check("C04_dr_file", 0, 0)
cat("data read; elapsed", format(Sys.time() - T0), "\n")

# ---------- units ----------
LF <- function(h) sat(S_lf, h)
Qof <- function(a, b) { x <- sslice(S_lf, a, b); x <- x[!is.na(x)]; if (length(x) == 0) NA_real_ else med(x) }
n_no_start <- 0; n_small_no_peak <- 0; n_small_under30 <- 0
EV <- data.frame(id = character(0), eid = character(0), o = numeric(0), p = numeric(0), s = numeric(0), stringsAsFactors = FALSE)
for (r in ev_first) {
  o <- hkey(RM[r, "event_t0"]); p <- hkey(RM[r, "event_tp"]); s <- start_of(S_lf, o)
  if (is.na(s)) { n_no_start <- n_no_start + 1; next }
  EV[nrow(EV) + 1, ] <- list(paste0("E", RM[r, "event_id"]), RM[r, "event_id"], o, p, s)
}
SM <- data.frame(id = character(0), no = character(0), o = numeric(0), p = numeric(0), s = numeric(0), stringsAsFactors = FALSE)
for (r in which(is_small)) {
  o <- hkey(RM[r, "onset_t0"]); p <- hkey(RM[r, "onset_tp"]); s <- start_of(S_lf, o)
  if (is.na(s)) { n_no_start <- n_no_start + 1; next }
  lp <- LF(p)
  if (is.na(lp)) { n_small_no_peak <- n_small_no_peak + 1; next }
  if (!(lp >= 1.3 * LF(s))) { n_small_under30 <- n_small_under30 + 1; next }
  SM[nrow(SM) + 1, ] <- list(paste0("S", RM[r, "onset_no"]), RM[r, "onset_no"], o, p, s)
}
EV$a <- EV$s - 6; EV$b <- EV$p + 6; SM$a <- SM$s - 6; SM$b <- SM$p + 6
n_event_units <- nrow(EV); n_small_units <- nrow(SM)
n_small_onsets <- sum(is_small)

# bumps
BC <- bump_cands(S_lf, K0, K1)
rise_a <- c(EV$a, SM$a); rise_b <- c(EV$b, SM$b)
ovl <- vapply(seq_len(nrow(BC)), function(i) any(BC$a[i] <= rise_b & rise_a <= BC$b[i]), logical(1))
BC$status <- ifelse(ovl, "overlap", NA_character_)
rem <- which(!ovl)
keep <- thin(BC$p[rem], BC$v[rem], 96)
BC$status[rem] <- ifelse(keep, "kept", "spacing")
BU <- BC[BC$status == "kept", ]

# recessions (event order)
RC <- data.frame(id = paste0("R", EV$eid), eid = EV$eid, p = EV$p, a = EV$p - 6, b = EV$p + 72, stringsAsFactors = FALSE)
allstarts <- c(EV$a, SM$a, BU$a)
for (i in seq_len(nrow(RC))) {
  cand <- allstarts[allstarts > RC$p[i] - 6]
  if (length(cand) > 0) RC$b[i] <- min(RC$b[i], min(cand) - 1)
}
n_rec_cut <- sum(RC$b < RC$p + 72)

# low-water weeks
wlo <- wk(K0) - 2; whi <- wk(K1) + 2
wall <- wlo:whi
wall <- wall[wstart(wall) >= K0 & wstart(wall) + 167 <= K1]
n_weeks_complete <- length(wall)
win_a <- c(EV$a, SM$a, BU$a, RC$a); win_b <- c(EV$b, SM$b, BU$b, RC$b)
wk_keep <- logical(length(wall)); drop_cov <- 0; drop_med <- 0; drop_ovl <- 0; WQ <- rep(NA_real_, length(wall))
for (i in seq_along(wall)) {
  ws <- wstart(wall[i]); x <- sslice(S_lf, ws, ws + 167); x <- x[!is.na(x)]
  if (length(x) < 152) { drop_cov <- drop_cov + 1; next }
  m <- med(x)
  if (!(m < 3000)) { drop_med <- drop_med + 1; next }
  if (any(ws <= win_b & win_a <= ws + 167)) { drop_ovl <- drop_ovl + 1; next }
  wk_keep[i] <- TRUE; WQ[i] <- m
}
WK <- data.frame(w = wall[wk_keep], ws = wstart(wall[wk_keep]), Q = WQ[wk_keep])
WK$id <- paste0("W", WK$w); WK$cls <- wclass(WK$Q)
nW <- nrow(WK)

# clusters
SM$cl <- NA_character_; n_joined <- 0
for (i in seq_len(nrow(SM))) {
  j <- assign_cluster(SM$a[i], SM$b[i], EV$a, EV$b)
  if (j == 0) SM$cl[i] <- SM$id[i] else { SM$cl[i] <- EV$id[j]; n_joined <- n_joined + 1 }
}
standalone <- data.frame(cl = c(SM$cl[SM$cl == SM$id], paste0("B", BU$p)), a = c(SM$a[SM$cl == SM$id], BU$a), stringsAsFactors = FALSE)
standalone <- standalone[order(standalone$a, standalone$cl, method = "radix"), ]
CL_ORDER <- c(EV$id, standalone$cl)

# unit table (events, small, bumps, recessions)
U <- data.frame(
  id = c(EV$id, SM$id, paste0("B", BU$p), RC$id),
  kind = c(rep("event", nrow(EV)), rep("small", nrow(SM)), rep("bump", nrow(BU)), rep("recession", nrow(RC))),
  eid = c(EV$eid, rep("", nrow(SM)), rep("", nrow(BU)), RC$eid),
  cluster = c(EV$id, SM$cl, paste0("B", BU$p), rep("", nrow(RC))),
  o = c(EV$o, SM$o, rep(NA_real_, nrow(BU) + nrow(RC))),
  p = c(EV$p, SM$p, BU$p, RC$p),
  s = c(EV$s, SM$s, BU$s, rep(NA_real_, nrow(RC))),
  a = c(EV$a, SM$a, BU$a, RC$a), b = c(EV$b, SM$b, BU$b, RC$b), stringsAsFactors = FALSE)
nU <- nrow(U)
U$nh <- U$b - U$a + 1
U$Q <- vapply(seq_len(nU), function(i) Qof(U$a[i], U$b[i]), numeric(1))
U$qcls <- qclass(U$Q)
U$period <- ifelse(U$a < 438288, "pre2020", "from2020")
isrec <- U$kind == "recession"
U$lf_s <- ifelse(isrec, NA_real_, sat(S_lf, U$s))
U$lf_p <- ifelse(isrec, NA_real_, sat(S_lf, U$p))
# creek shares
U$sh_lower <- NA_real_; U$sh_upper <- NA_real_; U$sh_whole <- NA_real_
U$st_lower <- "na"; U$st_upper <- "na"; U$st_whole <- "na"; U$fb <- 0L
for (i in which(!isrec)) {
  r <- creek_share(U$a[i], U$b[i], S_lf, CR, DR_PRESENT)
  U$sh_lower[i] <- r$lower$share; U$sh_upper[i] <- r$upper$share; U$sh_whole[i] <- r$whole$share
  U$st_lower[i] <- r$lower$status; U$st_upper[i] <- r$upper$status; U$st_whole[i] <- r$whole$status
  U$fb[i] <- r$fb
}
cat("units built:", nU, "\n")

# ---------- versions ----------
VN <- c("LOW_P", "LOW_A", "LOW_B", "UPP", "WHO")
VUP <- list(LOW_P = S_ef, LOW_A = S_efq, LOW_B = S_lnef, UPP = S_por, WHO = S_por)
VDN <- list(LOW_P = S_lfs, LOW_A = S_lf, LOW_B = S_lnlf, UPP = S_efq, WHO = S_lf)
VUPc <- lapply(VUP, mkchg); VDNc <- lapply(VDN, mkchg)
VLEG <- c(LOW_P = "lower", LOW_A = "lower", LOW_B = "lower", UPP = "upper", WHO = "whole")

# use counts needed for C05 (non-UPP, units and weeks)
kinds_rise <- U$kind %in% c("event", "small")
use_cnt <- function(ver, sel) {
  sum(vapply(which(sel), function(i) use_rule(VUP[[ver]], VDN[[ver]], U$a[i], U$b[i])$used, logical(1)))
}
USED <- list()
for (ver in c("LOW_P", "LOW_A", "LOW_B", "WHO")) {
  USED[[paste0("used_", ver, "_rise")]] <- use_cnt(ver, kinds_rise)
  USED[[paste0("used_", ver, "_bump")]] <- use_cnt(ver, U$kind == "bump")
  USED[[paste0("used_", ver, "_recession")]] <- use_cnt(ver, U$kind == "recession")
}
WUSED <- list()
for (ver in VN) WUSED[[ver]] <- sum(vapply(seq_len(nW), function(i) use_rule(VUP[[ver]], VDN[[ver]], WK$ws[i], WK$ws[i] + 167)$used, logical(1)))

# ---------- C05 ----------
ACC_ITEMS <- c("hourly_rows", "hourly_span", "hourly_missing", "events_rows", "event_rows_with_class", "event_units", "small_onsets",
  "unit_no_start", "small_no_peak", "small_under30", "rise_units", "bump_candidates", "bump_drop_overlap", "bump_drop_spacing",
  "bump_units", "recession_windows", "recession_cut", "weeks_complete", "weeks_drop_lf_coverage", "weeks_drop_median",
  "weeks_drop_overlap", "weeks_low_water", "weeks_lt1500", "weeks_1500_2000", "weeks_2000_3000", "small_joined", "clusters_event",
  "clusters_small", "clusters_bump", "clusters_total", "replay_rows", "replay_predicted", "replay_with_clock")
ACC_VAL <- c(nlines, NH, NH - nlines, nR, length(ev_idx), n_event_units, n_small_onsets, n_no_start, n_small_no_peak, n_small_under30,
  n_event_units + n_small_units, nrow(BC), sum(BC$status == "overlap"), sum(BC$status == "spacing"), nrow(BU), nrow(RC), n_rec_cut,
  n_weeks_complete, drop_cov, drop_med, drop_ovl, nW, sum(WK$cls == "lt1500"), sum(WK$cls == "1500-2000"), sum(WK$cls == "2000-3000"),
  n_joined, n_event_units, sum(SM$cl == SM$id), nrow(BU), length(CL_ORDER), nrp, n_replay_pred, n_with_clock)
ACC_EXP <- c(130416, 130987, 571, 87, 54, 53, 33, 0, 0, 0, 86, 103, 1, 16, 86, 53, 0, 779, 37, 567, 75, 100, 17, 30, 53, 6, 53, 27, 86, 166,
  130987, 128595, 129534)
used_items <- c(); used_exp <- c()
EXP_USED <- c(LOW_P_rise = 81, LOW_P_bump = 75, LOW_P_recession = 53, LOW_A_rise = 81, LOW_A_bump = 74, LOW_A_recession = 53,
  LOW_B_rise = 81, LOW_B_bump = 74, LOW_B_recession = 53, UPP_rise = NA, UPP_bump = NA, UPP_recession = NA,
  WHO_rise = 76, WHO_bump = 69, WHO_recession = 48)
EXP_WUSED <- c(LOW_P = 93, LOW_A = 93, LOW_B = 93, UPP = 92, WHO = 99)
c05_checked <- 0; c05_viol <- 0
for (k in seq_along(ACC_ITEMS)) { c05_checked <- c05_checked + 1; if (ACC_VAL[k] != ACC_EXP[k]) { c05_viol <- c05_viol + 1; cat("C05 mismatch", ACC_ITEMS[k], ACC_VAL[k], ACC_EXP[k], "\n") } }
for (nm in names(EXP_USED)) if (!is.na(EXP_USED[[nm]])) {
  c05_checked <- c05_checked + 1; got <- USED[[paste0("used_", nm)]]
  if (got != EXP_USED[[nm]]) { c05_viol <- c05_viol + 1; cat("C05 mismatch used_", nm, got, EXP_USED[[nm]], "\n") }
}
for (nm in names(EXP_WUSED)) if (nm != "UPP" || TRUE) {
  c05_checked <- c05_checked + 1
  if (WUSED[[nm]] != EXP_WUSED[[nm]]) { c05_viol <- c05_viol + 1; cat("C05 mismatch weeks_used_", nm, WUSED[[nm]], EXP_WUSED[[nm]], "\n") }
}
add_check("C05_row_accounting", c05_checked, c05_viol)
if (c05_viol > 0) stop_run("C05")
cat("C05 ok (n_checked", c05_checked, ")\n")

# ---------- lags and parts ----------
NR <- nU * 5
L <- data.frame(unit_id = rep(U$id, each = 5), version = rep(VN, nU), stringsAsFactors = FALSE)
L$used <- 0L; L$n_both <- NA_real_; L$status <- "data"; L$s_best <- NA_real_; L$n_pairs <- NA_real_; L$r <- NA_real_
L$delta <- NA_real_; L$lag <- NA_real_; L$g40 <- NA_integer_; L$g50 <- NA_integer_; L$g60 <- NA_integer_; L$g70 <- NA_integer_
L$share <- NA_real_; L$creek <- "na"; L$parts_status <- "no_xc"; L$lag10 <- NA_real_; L$lag50 <- NA_real_; L$lag90 <- NA_real_; L$lagcrest <- NA_real_
L$smax <- NA_real_; L$n_elig <- NA_real_; L$r_top1 <- NA_real_; L$r_top2 <- NA_real_
for (u in seq_len(nU)) {
  a <- U$a[u]; b <- U$b[u]
  lowp_ok <- FALSE; lowp_sb <- NA_real_
  for (vi in 1:5) {
    ver <- VN[vi]; row <- (u - 1) * 5 + vi
    smax <- if (U$kind[u] == "bump" || ver == "WHO") 72 else 48
    L$smax[row] <- smax
    if (!isrec[u]) {
      lg <- VLEG[[ver]]
      L$share[row] <- U[[paste0("sh_", lg)]][u]; L$creek[row] <- U[[paste0("st_", lg)]][u]
    }
    aw <- a; bw <- b
    if (ver == "UPP") {
      if (!lowp_ok) { L$used[row] <- 0L; L$status[row] <- "data"; next }
      aw <- a - lowp_sb; bw <- b - lowp_sb
    }
    ur <- use_rule(VUP[[ver]], VDN[[ver]], aw, bw)
    L$n_both[row] <- ur$cb
    if (!ur$used) next
    L$used[row] <- 1L
    x <- xc(VUPc[[ver]], VDNc[[ver]], aw, bw, 0, smax)
    L$status[row] <- x$status
    L$n_elig[row] <- x$n_elig
    if (x$n_elig >= 2) { rr <- sort(x$rs[!is.na(x$rs)], decreasing = TRUE); L$r_top1[row] <- rr[1]; L$r_top2[row] <- rr[2] }
    if (x$status %in% c("end", "neighbour", "ok")) { L$s_best[row] <- x$sb; L$n_pairs[row] <- x$n; L$r[row] <- x$r }
    if (x$status == "ok") {
      L$delta[row] <- x$delta; L$lag[row] <- x$lag
      L$g40[row] <- as.integer(x$r >= 0.4); L$g50[row] <- as.integer(x$r >= 0.5)
      L$g60[row] <- as.integer(x$r >= 0.6); L$g70[row] <- as.integer(x$r >= 0.7)
      pp <- parts_pair(VDN[[ver]], VUP[[ver]], aw, bw, x$sb)
      L$parts_status[row] <- pp$status
      if (pp$status == "ok") { L$lag10[row] <- pp$lag10; L$lag50[row] <- pp$lag50; L$lag90[row] <- pp$lag90; L$lagcrest[row] <- pp$lagcrest }
    }
    if (ver == "LOW_P" && x$status == "ok") { lowp_ok <- TRUE; lowp_sb <- x$sb }
  }
}
cat("lags done; elapsed", format(Sys.time() - T0), "\n")
for (v in VN) for (k in c("rise", "bump", "recession")) {
  sel <- L$version == v & (if (k == "rise") U$kind[match(L$unit_id, U$id)] %in% c("event", "small") else U$kind[match(L$unit_id, U$id)] == k)
  if (v == "UPP") USED[[paste0("used_UPP_", k)]] <- sum(L$used[sel])
}

# ---------- C06, C07 ----------
c06v <- 0
c06v <- c06v + sum(duplicated(U$id))
ri <- U$kind %in% c("event", "small", "bump")
c06v <- c06v + sum(ri & U$s > U$p) + sum(U$a > U$b) + sum(ri & U$nh < 16) + sum(is.na(U$Q) | !(U$Q > 0)) + sum(isrec & U$b < U$p - 6)
add_check("C06_unit_sanity", nU, c06v)
if (c06v > 0) stop_run("C06")
okrows <- which(L$status == "ok")
c07v <- 0
for (i in okrows) {
  sm <- L$smax[i]
  if (L$s_best[i] <= 0 || L$s_best[i] >= sm) c07v <- c07v + 1
  if (abs(L$r[i]) > 1 + 1e-9) c07v <- c07v + 1
  if (!(L$lag[i] > 0 && L$lag[i] < sm)) c07v <- c07v + 1
  if ((L$g70[i] == 1 && L$g60[i] == 0) || (L$g60[i] == 1 && L$g50[i] == 0) || (L$g50[i] == 1 && L$g40[i] == 0)) c07v <- c07v + 1
}
c07v <- c07v + (nrow(L) != 1125)
add_check("C07_lag_sanity", length(okrows), c07v)
if (c07v > 0) stop_run("C07")

# ---------- low water: phases ----------
DET_UP <- lapply(VUP, detrend); DET_DN <- lapply(VDN, detrend)
LW <- data.frame(week_id = rep(WK$id, each = 5), version = rep(VN, nW), start_key = rep(WK$ws, each = 5), q = rep(WK$Q, each = 5),
                 cls = rep(WK$cls, each = 5), stringsAsFactors = FALSE)
LW$used <- 0L; LW$n_both <- NA_real_; LW$status <- "data"; LW$s_best <- NA_real_; LW$n_pairs <- NA_real_; LW$r <- NA_real_
LW$delta <- NA_real_; LW$phase <- NA_real_; LW$gate50 <- 0L
for (i in seq_len(nW)) for (vi in 1:5) {
  ver <- VN[vi]; row <- (i - 1) * 5 + vi; ws <- WK$ws[i]
  ur <- use_rule(VUP[[ver]], VDN[[ver]], ws, ws + 167)
  LW$n_both[row] <- ur$cb
  if (!ur$used) next
  LW$used[row] <- 1L
  ph <- week_phase(DET_UP[[ver]], DET_DN[[ver]], ws)
  LW$status[row] <- ph$status
  if (ph$status %in% c("neighbour", "ok")) { LW$s_best[row] <- ph$sb; LW$n_pairs[row] <- ph$n; LW$r[row] <- ph$r }
  if (ph$status == "ok") { LW$delta[row] <- ph$delta; LW$phase[row] <- ph$phase; LW$gate50[row] <- as.integer(ph$r >= 0.5) }
}
c08v <- sum(((WK$ws %/% 24) + 3) %% 7 != 0) + sum(WK$Q >= 3000)
okw <- LW$status == "ok"
c08v <- c08v + sum(LW$phase[okw] < 0 | LW$phase[okw] >= 24) + (nW != 100)
add_check("C08_week_sanity", nW, c08v)
if (c08v > 0) stop_run("C08")

# M rows
mg <- 0; mn <- 0
gates <- c(0.4, 0.5, 0.6, 0.7)
for (r in c(L$r[L$status == "ok"], LW$r[LW$status == "ok"])) { mn <- mn + 1; if (any(abs(r - gates) > 0 & abs(r - gates) < 1e-9)) mg <- mg + 1 }
M1 <- c(mn, mg)
hasS <- !is.na(L$share)
M2 <- c(sum(hasS), sum(abs(L$share[hasS] - 0.15) > 0 & abs(L$share[hasS] - 0.15) < 1e-9))
m3 <- !is.na(L$n_elig) & L$n_elig >= 2
M3 <- c(sum(m3), sum(L$r_top1[m3] - L$r_top2[m3] < 1e-12))

# ---------- class summary ----------
L$kind <- U$kind[match(L$unit_id, U$id)]; L$qcls <- U$qcls[match(L$unit_id, U$id)]
L$clean <- L$creek %in% c("clean", "na"); L$heavy <- L$creek == "heavy"; L$unk <- L$creek == "unknown"
GROUPS <- c("event", "small", "bump", "all_rise", "recession")
CLASSES <- c("all", "lt3000", "3000-6000", "6000-12000", "12000-25000", "ge25000")
cs_rows <- list(); k <- 0
for (ver in VN) for (grp in GROUPS) for (cl in CLASSES) {
  sel <- L$version == ver & (if (grp == "all_rise") L$kind %in% c("event", "small", "bump") else L$kind == grp)
  if (cl != "all") sel <- sel & L$qcls == cl
  d <- L[sel, ]
  ok <- d$status == "ok"
  g60 <- ok & d$g60 == 1 & !is.na(d$g60)
  fl <- function(g) ok & d[[g]] == 1 & !is.na(d[[g]])
  lagv <- function(m) if (any(m)) med(d$lag[m]) else NA_real_
  cg60 <- g60 & d$clean
  q1 <- if (any(cg60)) pct(d$lag[cg60], 0.25) else NA_real_
  q3 <- if (any(cg60)) pct(d$lag[cg60], 0.75) else NA_real_
  sw <- if (any(cg60)) sum(abs(d$lag[cg60] - floor(d$lag[cg60] + 0.5)) <= 0.1) / sum(cg60) else NA_real_
  pm <- cg60 & d$parts_status == "ok"
  k <- k + 1
  cs_rows[[k]] <- list(version = ver, group = grp, class = cl, n_units = nrow(d), n_used = sum(d$used == 1), n_ok = sum(ok),
    n_g40 = sum(fl("g40")), n_g50 = sum(fl("g50")), n_g60 = sum(g60), n_g70 = sum(fl("g70")),
    n_g60_heavy = sum(g60 & d$heavy), n_g60_unknown = sum(g60 & d$unk), n_g60_clean = sum(cg60),
    med_g40 = lagv(fl("g40") & d$clean), med_g50 = lagv(fl("g50") & d$clean), med_g60 = lagv(cg60), med_g70 = lagv(fl("g70") & d$clean),
    q1_g60 = q1, q3_g60 = q3, med_g60_all = lagv(g60), share_whole_g60 = sw, n_parts = sum(pm),
    med_lag10 = if (any(pm)) med(d$lag10[pm]) else NA_real_, med_lag50 = if (any(pm)) med(d$lag50[pm]) else NA_real_,
    med_lag90 = if (any(pm)) med(d$lag90[pm]) else NA_real_, med_lagcrest = if (any(pm)) med(d$lagcrest[pm]) else NA_real_)
}
CS <- do.call(rbind, lapply(cs_rows, function(x) as.data.frame(x, stringsAsFactors = FALSE)))
cat("class summary done\n")

# ---------- fits ----------
CELLFLOW_NAMES <- c("cell1", "cell2", "cell3")
GRID <- c(1500, 2000, 3000, 5000, 7500, 10000, 15000, 25000, 50000)
FLOW_IDS <- c(paste0("g", GRID), CELLFLOW_NAMES)
pts_of <- function(ver) {
  idx <- which(L$version == ver & L$kind %in% c("event", "small", "bump") & L$status == "ok" & L$g60 == 1 & L$creek == "clean")
  um <- match(L$unit_id[idx], U$id)
  data.frame(lag = L$lag[idx], Q = U$Q[um], cl = U$cluster[um], period = U$period[um], stringsAsFactors = FALSE)
}
PTS <- lapply(setNames(VN, VN), pts_of)
pp <- PTS$LOW_P
CELLQ <- c(if (any(pp$Q < 6000)) med(pp$Q[pp$Q < 6000]) else NA_real_,
           if (any(pp$Q >= 6000 & pp$Q < 12000)) med(pp$Q[pp$Q >= 6000 & pp$Q < 12000]) else NA_real_,
           if (any(pp$Q >= 12000)) med(pp$Q[pp$Q >= 12000]) else NA_real_)
FLOWS <- c(GRID, CELLQ)
STREAM <- NULL
FITS <- list(); BOOT <- list()
fit_rows <- list(); k <- 0
for (ver in VN) {
  pts <- PTS[[ver]]
  for (per in c("all", "pre2020", "from2020")) {
    d <- if (per == "all") pts else pts[pts$period == per, ]
    n <- nrow(d)
    xy <- if (n > 0) prep_xy(d$Q, d$lag) else NULL
    fit <- if (n > 0) ts_fit(d$Q, xy$x, xy$y) else NULL
    row <- list(version = ver, period = per, n_points = n, n_clusters = length(unique(d$cl)),
                qmin = if (n >= 1) min(d$Q) else NA_real_, qmax = if (n >= 1) max(d$Q) else NA_real_,
                n_floor = if (n > 0) xy$nfloor else 0, nslopes = if (!is.null(fit)) fit$nslopes else NA_real_,
                B = if (!is.null(fit)) fit$B else NA_real_, A = if (!is.null(fit)) fit$A else NA_real_,
                n_valid = NA_real_, n_skipped = NA_real_, B_lo = NA_real_, B_hi = NA_real_)
    if (per == "all") {
      FITS[[ver]] <- list(fit = fit, qmin = row$qmin, qmax = row$qmax)
      BOOT[[ver]] <- list(lo = rep(NA_real_, 12), hi = rep(NA_real_, 12))
      if (!is.null(fit)) {
        cl <- CL_ORDER[CL_ORDER %in% d$cl]; m <- length(cl)
        cidx <- match(d$cl, cl)
        ptlist <- lapply(seq_len(m), function(j) which(cidx == j))
        if (is.null(STREAM)) STREAM <- lcg_stream(10000 * length(CL_ORDER))
        idxall <- (STREAM[seq_len(10000 * m)] * m) %/% 2147483647
        Bd <- rep(NA_real_, 10000); Fd <- matrix(NA_real_, 10000, 12)
        lnF <- log(FLOWS)
        for (dd in 1:10000) {
          ii <- idxall[((dd - 1) * m + 1):(dd * m)]
          pi_ <- draw_points(ii, ptlist)
          if (length(pi_) < 5) next
          f <- ts_fit(d$Q[pi_], xy$x[pi_], xy$y[pi_])
          if (is.null(f)) next
          Bd[dd] <- f$B
          Fd[dd, ] <- exp(f$A + f$B * lnF)
        }
        valid <- !is.na(Bd)
        row$n_valid <- sum(valid); row$n_skipped <- 10000 - sum(valid)
        if (row$n_skipped <= 500) {
          row$B_lo <- pct(Bd[valid], 0.025); row$B_hi <- pct(Bd[valid], 0.975)
          for (fi in 1:12) if (!is.na(FLOWS[fi])) {
            BOOT[[ver]]$lo[fi] <- pct(Fd[valid, fi], 0.025); BOOT[[ver]]$hi[fi] <- pct(Fd[valid, fi], 0.975)
          }
        }
      }
    }
    k <- k + 1; fit_rows[[k]] <- row
  }
}
FT <- do.call(rbind, lapply(fit_rows, function(x) as.data.frame(x, stringsAsFactors = FALSE)))
cat("fits done; elapsed", format(Sys.time() - T0), "\n")
M4 <- c(sum(vapply(PTS, nrow, numeric(1))), sum(vapply(PTS, function(d) sum(d$lag <= 0.05), numeric(1))))

# fit at flows
FAF <- list(); k <- 0
for (ver in VN) {
  ft <- FITS[[ver]]
  for (fi in 1:12) {
    F <- FLOWS[fi]
    usable <- !is.null(ft$fit) && !is.na(F) && ft$qmin <= F && F <= ft$qmax
    k <- k + 1
    FAF[[k]] <- list(version = ver, flow_id = FLOW_IDS[fi], flow = F, usable = as.integer(usable),
      lag = if (usable) exp(ft$fit$A + ft$fit$B * log(F)) else NA_real_,
      lo = if (usable) BOOT[[ver]]$lo[fi] else NA_real_, hi = if (usable) BOOT[[ver]]$hi[fi] else NA_real_)
  }
}
FAF <- do.call(rbind, lapply(FAF, function(x) as.data.frame(x, stringsAsFactors = FALSE)))
faf_get <- function(ver, fi) FAF[FAF$version == ver & FAF$flow_id == FLOW_IDS[fi], ]

# ---------- low-water summary ----------
WCL <- c("lt1500", "1500-2000", "2000-3000")
PH <- list()  # [[ver]][[cls]] = list(n_weeks, n_gate, phase, spread)
for (ver in VN) { PH[[ver]] <- list(); for (cl in WCL) {
  sel <- LW$version == ver & LW$cls == cl
  pass <- sel & LW$gate50 == 1
  cm <- if (sum(pass) >= 5) circ(LW$phase[pass]) else list(median = NA_real_, spread = NA_real_)
  PH[[ver]][[cl]] <- list(n_weeks = sum(sel), n_gate = sum(pass), phase = cm$median, spread = cm$spread)
} }
BUMPK <- list()
for (ver in c("LOW_P", "UPP", "WHO")) {
  sel <- L$version == ver & L$kind == "bump" & L$status == "ok" & L$g60 == 1 & L$creek == "clean"
  nb <- sum(sel); Mb <- if (nb >= 3) med(L$lag[sel]) else NA_real_
  BUMPK[[ver]] <- list(nb = nb, Mb = Mb)
}
LAGW <- list()
for (ver in c("LOW_P", "UPP", "WHO")) { LAGW[[ver]] <- list(); for (cl in WCL) {
  ph <- PH[[ver]][[cl]]; Mb <- BUMPK[[ver]]$Mb
  e <- list(k = NA_real_, L = NA_real_, lo = NA_real_, hi = NA_real_)
  if (!is.na(ph$phase) && !is.na(Mb)) {
    kk <- whole_days(ph$phase, Mb); LL <- ph$phase + 24.0 * kk
    e <- list(k = kk, L = LL, lo = max(0.0, LL - ph$spread), hi = LL + ph$spread)
  }
  LAGW[[ver]][[cl]] <- e
} }
CHAIN <- list()
for (cl in WCL) {
  lp <- LAGW$LOW_P[[cl]]$L; lu <- LAGW$UPP[[cl]]$L; lw <- LAGW$WHO[[cl]]$L
  if (!is.na(lp) && !is.na(lu) && !is.na(lw)) {
    sm <- lu + lp; df <- abs(sm - lw)
    CHAIN[[cl]] <- list(sum = sm, whole = lw, diff = df, pass = as.integer(mic(F6(df)) <= 3000000))
  } else CHAIN[[cl]] <- list(sum = NA_real_, whole = NA_real_, diff = NA_real_, pass = NA_integer_)
}
settled <- function(cl) !is.na(CHAIN[[cl]]$pass) && CHAIN[[cl]]$pass == 1

# ---------- Difficult Run (section 11) ----------
DR_SUM <- list(); DRU <- NULL; DRvalid <- 0; DRQ25 <- NA_real_
if (DR_PRESENT) {
  cd_ <- dr_cands(S_dr, K0, K1)
  sep <- thin(cd_$p, cd_$rise, 48)
  # order for acceptance is by rise desc, ties p asc; keep acceptance order
  ordr <- order(-cd_$rise, cd_$p)
  accepted <- ordr[sep[ordr]]
  SEP <- cd_[accepted, ]
  f_lf <- 0; f_r10 <- 0; f_ef <- 0; f_cr <- 0
  passes <- list()
  for (i in seq_len(nrow(SEP))) {
    p <- SEP$p[i]; rise <- SEP$rise[i]
    lfd <- sslice(S_lf, p - 47, p - 24); lfd <- lfd[!is.na(lfd)]
    lfday <- if (length(lfd) >= 12) med(lfd) else NA_real_
    if (is.na(lfday) || !(lfday < 6000)) { f_lf <- f_lf + 1; next }
    if (!(rise >= 0.1 * lfday)) { f_r10 <- f_r10 + 1; next }
    ef <- dr_cond_ef(sslice(S_ef, p - 24, p + 12))
    if (!ef$pass) { f_ef <- f_ef + 1; next }
    sr <- dr_creek_rise(sslice(CR$sen, p - 24, p + 12)); br <- dr_creek_rise(sslice(CR$brun, p - 24, p + 12))
    if (is.na(sr) || is.na(br) || !(sr < 0.25 * rise) || !(br < 0.25 * rise)) { f_cr <- f_cr + 1; next }
    passes[[length(passes) + 1]] <- list(p = p, rise = rise, lfday = lfday, efrel = ef$rel, sr = sr, br = br)
  }
  nsel <- min(40, length(passes))
  rows <- list()
  for (i in seq_len(nsel)) {
    q <- passes[[i]]; a <- q$p - 12; b <- q$p + 36
    ur <- use_rule(S_dr, S_lf, a, b)
    row <- list(unit_id = paste0("D", q$p), peak_key = q$p, rank = i, rise = q$rise, lf_day = q$lfday, ef_rel_range = q$efrel,
      seneca_rise = q$sr, broad_run_rise = q$br, used = as.integer(ur$used), status = "data", s_best = NA_real_, n_pairs = NA_real_,
      r = NA_real_, delta = NA_real_, lag = NA_real_, lag_scaled = NA_real_, pass = 0L)
    if (ur$used) {
      x <- xc(mkchg(S_dr), mkchg(S_lf), a, b, 0, 24)
      row$status <- x$status
      if (x$status %in% c("end", "neighbour", "ok")) { row$s_best <- x$sb; row$n_pairs <- x$n; row$r <- x$r }
      if (x$status == "ok") { row$delta <- x$delta; row$lag <- x$lag; row$lag_scaled <- x$lag * (9.1 / 7.4); row$pass <- as.integer(x$r >= 0.6) }
    }
    rows[[i]] <- row
  }
  DRU <- do.call(rbind, lapply(rows, function(x) as.data.frame(x, stringsAsFactors = FALSE)))
  npass <- sum(DRU$pass)
  DRvalid <- as.integer(npass >= 10)
  ls <- DRU$lag_scaled[DRU$pass == 1]
  DRQ25 <- if (length(ls) > 0) pct(ls, 0.25) else NA_real_
  DR_SUM <- list(dr_present = 1, nonpositive_hours = NONPOS, candidates = nrow(cd_), separate = nrow(SEP), fail_lf = f_lf, fail_rise10 = f_r10,
    fail_ef = f_ef, fail_creek = f_cr, pass_conditions = length(passes), selected = nsel, used = sum(DRU$used), n_pass_gate = npass,
    valid = DRvalid, median_scaled = if (length(ls) > 0) med(ls) else NA_real_, q25_scaled = DRQ25,
    q75_scaled = if (length(ls) > 0) pct(ls, 0.75) else NA_real_, share_fallback = sum(U$fb[ri]))
}
cat("DR done; elapsed", format(Sys.time() - T0), "\n")

# ---------- clock ----------
cs_get <- function(ver, cl) CS[CS$version == ver & CS$group == "all_rise" & CS$class == cl, ]
rising_range <- function(fi) {
  F <- FLOWS[fi]
  blank <- list(ok = FALSE, L = NA_real_, lo = NA_real_, hi = NA_real_, cover = NA_integer_)
  if (is.na(F)) return(blank)
  P <- faf_get("LOW_P", fi)
  if (P$usable != 1) return(blank)
  cl <- qclass(F)
  csP <- cs_get("LOW_P", cl)
  sw <- c(LOW_A = FALSE, LOW_B = FALSE)
  for (v in c("LOW_A", "LOW_B")) {
    csV <- cs_get(v, cl); fv <- faf_get(v, fi)
    sw[[v]] <- fv$usable == 1 && switch_in(csP$n_g60_clean, csV$n_g60_clean, csP$med_g60, csV$med_g60)
  }
  cover <- as.integer(any(sw))
  lo <- P$lo; hi <- P$hi
  if (cover == 1) {
    A <- faf_get("LOW_A", fi); B <- faf_get("LOW_B", fi)
    bb <- cover_bounds(c(P$lo, P$hi), c(A$lo, A$hi), c(B$lo, B$hi), sw[["LOW_A"]], sw[["LOW_B"]])
    lo <- bb[1]; hi <- bb[2]
  }
  list(ok = TRUE, L = P$lag, lo = lo, hi = hi, cover = cover)
}
lowwater_range <- function(F) {
  if (is.na(F) || !(F < 3000)) return(list(ok = FALSE, L = NA_real_, lo = NA_real_, hi = NA_real_))
  cl <- wclass(F)
  if (!settled(cl)) return(list(ok = FALSE, L = NA_real_, lo = NA_real_, hi = NA_real_))
  e <- LAGW$LOW_P[[cl]]
  list(ok = TRUE, L = e$L, lo = e$lo, hi = e$hi)
}
GR <- list()
for (fi in 1:9) {
  F <- FLOWS[fi]
  rr <- rising_range(fi)
  if (rr$ok) { src <- "rising_fit"; Lv <- rr$L; lo <- rr$lo; hi <- rr$hi; cv <- rr$cover }
  else { lw <- lowwater_range(F)
    if (lw$ok) { src <- "low_water"; Lv <- lw$L; lo <- lw$lo; hi <- lw$hi; cv <- NA_integer_ }
    else { src <- "none"; Lv <- NA_real_; lo <- NA_real_; hi <- NA_real_; cv <- NA_integer_ } }
  e <- if (src == "none") c(long = NA_real_, central = NA_real_, short = NA_real_) else clock_ends(Lv, lo, hi, DRvalid == 1, DRQ25)
  if (src == "none") { Lv <- lo <- hi <- NA_real_ }
  GR[[fi]] <- list(flow = F, source = src, L = Lv, lo = lo, hi = hi, cover_both = cv, long_end = e[["long"]], central = e[["central"]],
                   short_end = e[["short"]], dr_used = DRvalid)
}
GR <- do.call(rbind, lapply(GR, function(x) as.data.frame(x, stringsAsFactors = FALSE)))

# ---------- cells ----------
CELLN <- c("rising_lt6000", "rising_6000_12000", "rising_ge12000", "low_water")
cover_mask <- function(a, b) { m <- rep(FALSE, nrp); for (i in seq_along(a)) { lo <- max(a[i], K0); hi <- min(b[i], K1); if (lo <= hi) m[(lo - K0 + 1):(hi - K0 + 1)] <- TRUE }; m }
cell_rows <- list()
pPts <- PTS$LOW_P
pPts_units <- {
  idx <- which(L$version == "LOW_P" & L$kind %in% c("event", "small", "bump") & L$status == "ok" & L$g60 == 1 & L$creek == "clean")
  match(L$unit_id[idx], U$id)
}
for (ci in 1:4) {
  if (ci <= 3) {
    sel <- if (ci == 1) pPts$Q < 6000 else if (ci == 2) pPts$Q >= 6000 & pPts$Q < 12000 else pPts$Q >= 12000
    n_units <- sum(sel); mq <- CELLQ[ci]
    wa <- U$a[pPts_units[sel]]; wb <- U$b[pPts_units[sel]]
    rr <- rising_range(9 + ci)
    Lv <- rr$L; lo <- rr$lo; hi <- rr$hi; cv <- rr$cover
    e <- clock_ends(Lv, lo, hi, DRvalid == 1, DRQ25)
    qual <- as.integer(n_units >= 5 && !is.na(Lv) && !is.na(lo) && !is.na(hi) && !is.na(e[["long"]]) && !is.na(e[["short"]]))
    reason <- if (n_units < 5) "few_units" else if (!qual) "no_range" else "ok"
  } else {
    gp <- which(LW$version == "LOW_P" & LW$gate50 == 1)
    n_units <- length(gp); mq <- if (n_units > 0) med(LW$q[gp]) else NA_real_
    wa <- LW$start_key[gp]; wb <- LW$start_key[gp] + 167
    mcl <- if (!is.na(mq)) wclass(mq) else NA_character_
    lw <- lowwater_range(mq)
    Lv <- lw$L; lo <- lw$lo; hi <- lw$hi; cv <- NA_integer_
    e <- clock_ends(Lv, lo, hi, DRvalid == 1, DRQ25)
    qual <- as.integer(n_units >= 20 && !is.na(mcl) && settled(mcl))
    reason <- if (n_units < 20) "few_weeks"
      else if (is.na(mcl) || is.na(PH$LOW_P[[mcl]]$phase)) "no_phase"
      else if (any(vapply(c("LOW_P", "UPP", "WHO"), function(v) is.na(BUMPK[[v]]$Mb), logical(1)))) "no_bumps"
      else if (!settled(mcl)) "chain" else "ok"
  }
  msk <- cover_mask(wa, wb) & APP_OK
  napp <- sum(msk); appv <- if (napp > 0) med(RP_trav[msk]) else NA_real_
  fv <- if (!is.na(mq)) formula_val(mq) else NA_real_
  st <- cell_status_str(qual, F6(appv), F6(e[["long"]]), F6(e[["short"]]))
  cell_rows[[ci]] <- list(cell = CELLN[ci], n_units = n_units, median_q = mq, qual = qual, reason = reason, n_app_rows = napp,
    app_value = appv, formula_value = fv, L = Lv, lo = lo, hi = hi, cover_both = cv, long_end = e[["long"]], central = e[["central"]],
    short_end = e[["short"]], dr_used = DRvalid, status = st)
}
CELLS <- do.call(rbind, lapply(cell_rows, function(x) as.data.frame(x, stringsAsFactors = FALSE)))
nq <- sum(CELLS$qual == 1); nlong <- sum(CELLS$status == "TOO LONG"); nshort <- sum(CELLS$status == "TOO SHORT"); nin <- sum(CELLS$status == "INSIDE")
VERDICT <- verdict_of(CELLS$status)

# ---------- write outputs ----------
# row_accounting
used_vals <- c(); used_names <- c()
for (v in VN) for (kd in c("rise", "bump", "recession")) { used_names <- c(used_names, paste0("used_", v, "_", kd)); used_vals <- c(used_vals, USED[[paste0("used_", v, "_", kd)]]) }
wu_names <- paste0("weeks_used_", VN); wu_vals <- unlist(WUSED[VN])
exp_used <- unname(c(EXP_USED)); exp_w <- unname(EXP_WUSED)
RA <- data.frame(item = c(ACC_ITEMS, used_names, wu_names, "dr_present"),
  n = I0(c(ACC_VAL, used_vals, wu_vals, as.integer(DR_PRESENT))),
  expected = I0(c(ACC_EXP, exp_used, exp_w, NA)), stringsAsFactors = FALSE)
write_df(RA, "row_accounting.csv")

# units.csv
UO <- data.frame(unit_id = U$id, kind = U$kind, event_id = U$eid, cluster = U$cluster, onset_key = I0(U$o),
  peak_key = I0(U$p), start_key = I0(U$s), a = I0(U$a), b = I0(U$b), n_hours = I0(U$nh), q = F6(U$Q), qclass = U$qcls, period = U$period,
  lf_start = F6(U$lf_s), lf_peak = F6(U$lf_p), share_lower = F6(U$sh_lower), share_upper = F6(U$sh_upper), share_whole = F6(U$sh_whole),
  dr_fallback = I0(ifelse(isrec, 0, U$fb)), stringsAsFactors = FALSE)
write_df(UO, "units.csv")

# unit_lags.csv
LO <- data.frame(unit_id = L$unit_id, version = L$version, used = I0(L$used), n_both = I0(L$n_both), status = L$status,
  s_best = I0(L$s_best), n_pairs = I0(L$n_pairs), r = F6(L$r), delta = F6(L$delta), lag = F6(L$lag), g40 = I0(L$g40), g50 = I0(L$g50),
  g60 = I0(L$g60), g70 = I0(L$g70), share = F6(L$share), creek = L$creek, parts_status = L$parts_status, lag10 = F6(L$lag10),
  lag50 = F6(L$lag50), lag90 = F6(L$lag90), lagcrest = I0(L$lagcrest), stringsAsFactors = FALSE)
write_df(LO, "unit_lags.csv")

# bumps.csv
write_df(data.frame(peak_key = I0(BC$p), start_key = I0(BC$s), a = I0(BC$a), b = I0(BC$b), lf_peak = F6(BC$v), lf_base = F6(BC$m), status = BC$status,
  stringsAsFactors = FALSE), "bumps.csv")

# class_summary.csv
cnt <- c("n_units", "n_used", "n_ok", "n_g40", "n_g50", "n_g60", "n_g70", "n_g60_heavy", "n_g60_unknown", "n_g60_clean", "n_parts")
CSO <- CS
for (cn in names(CSO)) if (cn %in% cnt) CSO[[cn]] <- I0(CSO[[cn]]) else if (!(cn %in% c("version", "group", "class"))) CSO[[cn]] <- F6(CSO[[cn]])
write_df(CSO, "class_summary.csv")

# fits.csv
FTO <- FT
for (cn in names(FTO)) if (cn %in% c("n_points", "n_clusters", "n_floor", "nslopes", "n_valid", "n_skipped")) FTO[[cn]] <- I0(FTO[[cn]]) else if (!(cn %in% c("version", "period"))) FTO[[cn]] <- F6(FTO[[cn]])
write_df(FTO, "fits.csv")

# fit_at_flows.csv
write_df(data.frame(version = FAF$version, flow_id = FAF$flow_id, flow = F6(FAF$flow), usable = I0(FAF$usable), lag = F6(FAF$lag), lo = F6(FAF$lo),
  hi = F6(FAF$hi), stringsAsFactors = FALSE), "fit_at_flows.csv")

# clock_grid.csv
write_df(data.frame(flow = F6(GR$flow), source = GR$source, L = F6(GR$L), lo = F6(GR$lo), hi = F6(GR$hi), cover_both = I0(GR$cover_both),
  long_end = F6(GR$long_end), central = F6(GR$central), short_end = F6(GR$short_end), dr_used = I0(GR$dr_used), stringsAsFactors = FALSE), "clock_grid.csv")

# lowwater_weeks.csv
write_df(data.frame(week_id = LW$week_id, version = LW$version, start_key = I0(LW$start_key), q = F6(LW$q), class = LW$cls, used = I0(LW$used),
  n_both = I0(LW$n_both), status = LW$status, s_best = I0(LW$s_best), n_pairs = I0(LW$n_pairs), r = F6(LW$r), delta = F6(LW$delta),
  phase = F6(LW$phase), gate50 = I0(LW$gate50), stringsAsFactors = FALSE), "lowwater_weeks.csv")

# lowwater_summary.csv
LS <- list(); k <- 0
blankrow <- function() list(row_type = "", version = "", class = "", n_weeks = "", n_gate = "", phase = "", spread = "", n_bumps = "", bump_median = "",
  k = "", lag = "", lag_lo = "", lag_hi = "", chain_sum = "", chain_whole = "", chain_diff = "", chain_pass = "")
for (ver in VN) for (cl in WCL) {
  r <- blankrow(); ph <- PH[[ver]][[cl]]
  r$row_type <- "phase"; r$version <- ver; r$class <- cl; r$n_weeks <- I0(ph$n_weeks); r$n_gate <- I0(ph$n_gate); r$phase <- F6(ph$phase); r$spread <- F6(ph$spread)
  k <- k + 1; LS[[k]] <- r
}
for (ver in c("LOW_P", "UPP", "WHO")) for (cl in WCL) {
  r <- blankrow(); ph <- PH[[ver]][[cl]]; e <- LAGW[[ver]][[cl]]
  r$row_type <- "lag"; r$version <- ver; r$class <- cl; r$n_bumps <- I0(BUMPK[[ver]]$nb); r$bump_median <- F6(BUMPK[[ver]]$Mb)
  r$k <- I0(e$k); r$lag <- F6(e$L); r$lag_lo <- F6(e$lo); r$lag_hi <- F6(e$hi); r$phase <- F6(ph$phase); r$spread <- F6(ph$spread)
  k <- k + 1; LS[[k]] <- r
}
for (cl in WCL) {
  r <- blankrow(); ch <- CHAIN[[cl]]
  r$row_type <- "chain"; r$class <- cl; r$chain_sum <- F6(ch$sum); r$chain_whole <- F6(ch$whole); r$chain_diff <- F6(ch$diff); r$chain_pass <- I0(ch$pass)
  k <- k + 1; LS[[k]] <- r
}
write_df(do.call(rbind, lapply(LS, function(x) as.data.frame(x, stringsAsFactors = FALSE))), "lowwater_summary.csv")

# dr files
if (DR_PRESENT) {
  write_df(data.frame(unit_id = DRU$unit_id, peak_key = I0(DRU$peak_key), rank = I0(DRU$rank), rise = F6(DRU$rise), lf_day = F6(DRU$lf_day),
    ef_rel_range = F6(DRU$ef_rel_range), seneca_rise = F6(DRU$seneca_rise), broad_run_rise = F6(DRU$broad_run_rise), used = I0(DRU$used),
    status = DRU$status, s_best = I0(DRU$s_best), n_pairs = I0(DRU$n_pairs), r = F6(DRU$r), delta = F6(DRU$delta), lag = F6(DRU$lag),
    lag_scaled = F6(DRU$lag_scaled), pass = I0(DRU$pass), stringsAsFactors = FALSE), "dr_units.csv")
  dv <- c(I0(1), I0(DR_SUM$nonpositive_hours), I0(DR_SUM$candidates), I0(DR_SUM$separate), I0(DR_SUM$fail_lf), I0(DR_SUM$fail_rise10),
    I0(DR_SUM$fail_ef), I0(DR_SUM$fail_creek), I0(DR_SUM$pass_conditions), I0(DR_SUM$selected), I0(DR_SUM$used), I0(DR_SUM$n_pass_gate),
    I0(DR_SUM$valid), F6(DR_SUM$median_scaled), F6(DR_SUM$q25_scaled), F6(DR_SUM$q75_scaled), I0(DR_SUM$share_fallback), DR_SHA_ACTUAL)
} else {
  write_df(data.frame(unit_id = "ABSENT", peak_key = "", rank = "", rise = "", lf_day = "", ef_rel_range = "", seneca_rise = "", broad_run_rise = "",
    used = "", status = "", s_best = "", n_pairs = "", r = "", delta = "", lag = "", lag_scaled = "", pass = "", stringsAsFactors = FALSE), "dr_units.csv")
  dv <- c("0", rep("", 17))
}
write_df(data.frame(name = c("dr_present", "nonpositive_hours", "candidates", "separate", "fail_lf", "fail_rise10", "fail_ef", "fail_creek",
  "pass_conditions", "selected", "used", "n_pass_gate", "valid", "median_scaled", "q25_scaled", "q75_scaled", "share_fallback", "dr_sha256"),
  value = dv, stringsAsFactors = FALSE), "dr_summary.csv")

# cells.csv, decision.csv
CO <- data.frame(cell = CELLS$cell, n_units = I0(CELLS$n_units), median_q = F6(CELLS$median_q), qual = I0(CELLS$qual), reason = CELLS$reason,
  n_app_rows = I0(CELLS$n_app_rows), app_value = F6(CELLS$app_value), formula_value = F6(CELLS$formula_value), L = F6(CELLS$L), lo = F6(CELLS$lo),
  hi = F6(CELLS$hi), cover_both = I0(CELLS$cover_both), long_end = F6(CELLS$long_end), central = F6(CELLS$central), short_end = F6(CELLS$short_end),
  dr_used = I0(CELLS$dr_used), status = CELLS$status, stringsAsFactors = FALSE)
write_df(CO, "cells.csv")
write_df(data.frame(item = c("nq", "nlong", "nshort", "ninside", "dr_present", "dr_valid", "verdict"),
  value = c(I0(nq), I0(nlong), I0(nshort), I0(nin), I0(as.integer(DR_PRESENT)), I0(DRvalid), VERDICT), stringsAsFactors = FALSE), "decision.csv")

# checks.csv (M rows last)
add_check("M1_gate_margin", M1[1], M1[2]); add_check("M2_creek_margin", M2[1], M2[2])
add_check("M3_tie_margin", M3[1], M3[2]); add_check("M4_floor", M4[1], M4[2])
write_checks()
cat("DONE; elapsed", format(Sys.time() - T0), "\n")

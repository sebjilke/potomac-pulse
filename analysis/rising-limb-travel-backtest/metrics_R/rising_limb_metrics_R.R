# Blind R metrics analyst (plan step 5), rising-limb travel backtest.
# Plan: analysis/rising-limb-travel-backtest-plan-2026-11-10.md (sections 2-7, deviations D-1..D-7)
# Schema: analysis/rising-limb-travel-backtest/TICK_SCHEMA.md
# Run from anywhere:  Rscript rising_limb_metrics_R.R [assert_only]
# Order (D-7 E8): checksums -> arm-independent truth/label assertions -> metrics -> report-only.
# Writes only into metrics_R/.

suppressMessages({ library(readr); library(dplyr); library(jsonlite) })
options(digits = 17, scipen = 0)

args <- commandArgs(trailingOnly = TRUE)
ASSERT_ONLY <- "assert_only" %in% args

BT  <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/rising-limb-travel-backtest"
OUT <- file.path(BT, "metrics_R")
f_ev   <- file.path(BT, "rising_limb_events_python_v39.csv")
f_raw  <- file.path(BT, "hourly_backtest_data_v39.csv")
f_b21  <- file.path(BT, "rising_limb_bootstrap_indices.csv")
f_b20  <- file.path(BT, "rising_limb_bootstrap_indices_nonoct.csv")
RUNS <- c(primary = "rising_limb_ticks.csv", S2 = "rising_limb_ticks_S2.csv",
          S3 = "rising_limb_ticks_S3.csv", multi = "rising_limb_ticks_multi.csv")

say <- function(...) cat(format(Sys.time(), "%H:%M:%S"), ..., "\n")

# ------------------------------------------------------------------ 1. checksums
expected <- c(
  "rising_limb_ticks.csv"       = "8d841145905de1f6b6d217835c65229862ec6e115f33823c9472ffcfbfca0a6f",
  "rising_limb_ticks_S2.csv"    = "0407062ba39f5bb3381fab77b7418fbef984ab4c2de423a6b636d04b8079b0f4",
  "rising_limb_ticks_S3.csv"    = "33af47ce920bea6a51956e2e2deb06ff6a1d79d06cdb13f05e19f65e1f844f26",
  "rising_limb_ticks_multi.csv" = "c99c4b56e3ae3edc47cda561a7322174d6797709e509ea63f8e0106e17064778",
  "rising_limb_events_python_v39.csv" = "978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44",
  "rising_limb_bootstrap_indices.csv" = "7eff92a751fd9cc0c6f8e0220998e98788cc2f293b5437088bf9376e1dd96519",
  "rising_limb_bootstrap_indices_nonoct.csv" = "c1f50235edf229d65f8dcd0432f0a9699c752e3a67f7fac27e597c040a29ff5c",
  "hourly_backtest_data_v39.csv" = "d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f")
# cross-check the expected values against the manifest files themselves
man <- readLines(file.path(BT, "GATE_RUN_MANIFEST.txt"))
bsh <- readLines(file.path(BT, "rising_limb_bootstrap_indices.sha256.txt"))
for (nm in names(expected)[1:4]) stopifnot(any(grepl(paste0("^", expected[[nm]], " .*", nm), man)))
for (nm in names(expected)[6:7]) stopifnot(any(grepl(paste0(nm, ".*", expected[[nm]]), bsh)))
for (nm in names(expected)) {
  h <- strsplit(system2("shasum", c("-a", "256", shQuote(file.path(BT, nm))), stdout = TRUE), " +")[[1]][1]
  if (h != expected[[nm]]) stop("SHA256 MISMATCH (STOP): ", nm, " ", h)
}
say("checksums OK (8 files)")

# ------------------------------------------------------------------ helpers
T0 <- as.POSIXct("2011-12-01 05:00", tz = "UTC")
idx_of <- function(s) {  # "YYYY-MM-DD HH:MM" or ISO with T/Z -> 1-based hour index
  s <- sub("T", " ", substr(s, 1, 16))
  as.integer(round(as.numeric(difftime(as.POSIXct(s, format = "%Y-%m-%d %H:%M", tz = "UTC"), T0, units = "hours")))) + 1L
}
iso_of <- function(i) format(T0 + (i - 1) * 3600, "%Y-%m-%dT%H:%M:%S.000Z", tz = "UTC")
N <- idx_of("2026-11-09 23:00")   # D-5 H1
stopifnot(N == 130987L)
SCORE_START <- idx_of("2012-12-01 00:00")
OVR <- idx_of("2026-11-09 12:00")   # D-8 override tick (see assert_run)
num <- function(x) as.numeric(ifelse(is.na(x) | x == "", NA, x))

# ------------------------------------------------------------------ raw data, lag views
raw <- read_csv(f_raw, col_types = cols(.default = col_character()), na = character())
ri <- idx_of(raw$timestamp)
stopifnot(!anyDuplicated(ri), min(ri) == 1L, max(ri) == N)
series <- function(col) { x <- rep(NA_real_, N); x[ri] <- num(raw[[col]]); x }
POR <- series("por_now"); LF <- series("lf_discharge")

view <- function(x, L, M = N) {  # value + carry hours of the stamp s = t - L, carried up to 3 h (D-5 H2); M > N = view at hours after the last tick
  val <- rep(NA_real_, M); car <- rep(NA_integer_, M)
  for (c in 0:3) {
    j <- seq_len(M) - L - c
    v <- rep(NA_real_, M); ok <- j >= 1 & j <= N; v[ok] <- x[j[ok]]
    put <- is.na(val) & !is.na(v); val[put] <- v[put]; car[put] <- c
  }
  list(val = val, car = car)
}
LFV <- view(LF, 1L); PORV <- view(POR, 2L)   # primary lag view

# PoR history at tick i: non-blank PoR stamps s' in [i-72, i-2], timestamps s'+30 min (D-5 H3)
nonNA <- !is.na(POR)
cs <- c(0L, cumsum(nonNA))                 # cs[j+1] = count of non-NA in 1..j
cnt_upto <- function(j) { j <- pmin(pmax(j, 0L), N); cs[j + 1L] }
lastidx <- integer(N); last <- 0L
for (j in seq_len(N)) { if (nonNA[j]) last <- j; lastidx[j] <- last }
last_upto <- function(j) { out <- rep(0L, length(j)); ok <- j >= 1; out[ok] <- lastidx[pmin(j[ok], N)]; out }
ii <- seq_len(N)
h_n   <- cnt_upto(ii - 2L) - cnt_upto(ii - 73L)
h_cur <- last_upto(ii - 2L); h_cur[h_cur < ii - 72L] <- 0L
h_past <- last_upto(ii - 7L); h_past[h_past < ii - 72L] <- 0L   # s'+0.5 <= t-6 <=> s' <= t-7
# getPoRRiseRateFromHistory (shared/model.js): null if n<4 or no past
rr_ok <- h_n >= 4L & h_cur > 0L & h_past > 0L
cur_q <- ifelse(h_cur > 0L, POR[pmax(h_cur, 1L)], NA); past_q <- ifelse(h_past > 0L, POR[pmax(h_past, 1L)], NA)
hdiff <- (h_cur - h_past)                   # hours
rr_ok <- rr_ok & hdiff > 0
rr_rate <- ifelse(rr_ok, (((cur_q - past_q) / past_q) * 100) / hdiff, NA)
# getFlowState(history, current.cfs): <8 entries -> steady
fs_change <- cur_q - past_q
fs_thr <- pmax(100, cur_q * 0.02)
rr_state <- ifelse(!rr_ok, NA_character_,
             ifelse(h_n < 8L, "steady",
              ifelse(abs(fs_change) >= fs_thr & fs_change > 0, "rising",
               ifelse(abs(fs_change) >= fs_thr & fs_change < 0, "falling", "steady"))))
rr_rising <- !is.na(rr_state) & rr_state == "rising" & !is.na(rr_rate) & rr_rate > 0

# getFlowMultiplier / getGFtoLFTravelTime (shared/model.js)
TRAVEL_COEF <- 4139; TRAVEL_EXP <- -0.5963; MEDIAN_TRAVEL <- 25.8; TRAVEL_GF_LF_BASELINE <- 6.5
flow_mult <- function(lf) { flow <- pmax(lf, 1000); (TRAVEL_COEF * flow^TRAVEL_EXP) / MEDIAN_TRAVEL }
gf_lf_travel <- function(mult, rising, rate) {
  b <- TRAVEL_GF_LF_BASELINE * mult
  ifelse(rising, b * (1 - pmin(0.30, rate * 0.02)), b)
}
# LF view at time t+h: first tick v >= t+h (offset ceil(h - 1e-12)), trying v, v+1, v+2
lf_at <- function(i, h) {
  v0 <- i + ceiling(h - 1e-12)
  val <- rep(NA_real_, length(i)); vt <- rep(NA_integer_, length(i))
  for (k in 0:2) {
    # Literal reading (ASSUMPTIONS.md A1): v must be a tick of the grid, and the grid ends at
    # 2026-11-09T23:00Z (D-5 H1; TICK_SCHEMA s.0). A truth tick after the last tick does not exist.
    v <- v0 + k; ok <- is.na(val) & v >= 1 & v <= N
    got <- rep(NA_real_, length(i)); got[ok] <- LFV$val[v[ok]]
    put <- is.na(val) & !is.na(got); val[put] <- got[put]; vt[put] <- v[put]
  }
  list(val = val, tick = vt)
}

# ------------------------------------------------------------------ truth rule (plan s.4, PA-6, M5)
has_in <- !is.na(PORV$val) & !is.na(LFV$val)
tau <- rep(NA_real_, N); conv <- rep(NA_integer_, N); why <- rep("no_input", N)
act <- which(has_in); tprev <- rep(6.5, length(act)); done <- rep(FALSE, length(act)); fail <- rep(FALSE, length(act))
tcur <- rep(NA_real_, length(act)); cvd <- rep(0L, length(act))
for (k in 1:3) {
  w <- which(!done & !fail)
  if (!length(w)) break
  l <- lf_at(act[w], tprev[w])
  miss <- is.na(l$val); fail[w[miss]] <- TRUE
  w2 <- w[!miss]; lv <- l$val[!miss]
  tk <- gf_lf_travel(flow_mult(lv), rr_rising[act[w2]], rr_rate[act[w2]])
  st <- abs(tk - tprev[w2]) < 0.5
  tcur[w2] <- tk
  done[w2[st]] <- TRUE; cvd[w2[st]] <- 1L
  tprev[w2] <- tk
}
ok <- !fail
tau[act[ok]] <- tcur[ok]; conv[act[ok]] <- cvd[ok]
why[act[fail]] <- "tau_lf_missing"
tr <- lf_at(which(!is.na(tau)), tau[!is.na(tau)])
TRUTH <- rep(NA_real_, N); TRUTH_T <- rep(NA_integer_, N)
TRUTH[!is.na(tau)] <- tr$val; TRUTH_T[!is.na(tau)] <- tr$tick
why[!is.na(tau) & is.na(TRUTH)] <- "no_truth"
why[!is.na(TRUTH)] <- "ok"
MASK <- as.integer(!is.na(TRUTH))
say("truth rebuilt: masked ticks", sum(MASK), "tau nonconverged", sum(conv == 0, na.rm = TRUE))

# ------------------------------------------------------------------ events and window labels (plan s.3)
ev_all <- read_csv(f_ev, col_types = cols(.default = col_character()), na = character())
ev <- ev_all[ev_all$event_row == "1", ]
comp <- ev_all[ev_all$event_class != "", ]          # components of detected events (GATE/STRATUM onsets)
ev <- ev %>% mutate(id = as.integer(event_id), t0 = idx_of(event_t0), tp = idx_of(event_tp), tend = idx_of(event_tend),
                    kept = as.integer(kept), oct = as.integer(oct), holdout = as.integer(holdout), cls = event_class)
stopifnot(nrow(ev) == 53, !anyDuplicated(ev$id))
# filled LF (gaps of <= 3 consecutive missing stamps, interior, linear) (PA-2, D-1 C1)
LFF <- LF; r <- rle(is.na(LF)); ends <- cumsum(r$lengths); starts <- ends - r$lengths + 1
for (g in which(r$values)) {
  a <- starts[g]; b <- ends[g]
  if (r$lengths[g] <= 3 && a > 1 && b < N) LFF[a:b] <- LF[a - 1] + (LF[b + 1] - LF[a - 1]) * (seq_len(b - a + 1)) / (b - a + 2)
}
lab_rl <- rep(NA_integer_, N); lab_rlx <- lab_rl; lab_rec <- lab_rl; ew <- rep(0L, N)
lab_err <- 0L
rec_sets <- list(); win_check <- 0L
for (e in seq_len(nrow(ev))) {
  E <- ev[e, ]
  rl <- (E$t0 - 12L):min(E$t0 + 24L, E$tp); rlx <- (E$t0 - 12L):E$tp; ewr <- (E$t0 - 12L):min(E$tend + 24L, N)
  # REC (M1)
  rec <- integer(0)
  if (E$tp != E$t0 + 239L && E$tend > E$tp) {
    cand <- (E$tp + 1L):E$tend
    above <- which(!is.na(LFF[(E$tp + 1L):N]) & LFF[(E$tp + 1L):N] > LFF[E$tp])
    rcut <- if (length(above)) E$tp + above[1] else NA
    rec <- if (is.na(rcut)) cand else cand[cand < rcut]
    cps <- comp[comp$event_id == E$event_id, ]
    if (nrow(cps) > 1) for (k in seq_len(nrow(cps))) {
      ct0 <- idx_of(cps$onset_t0[k]); ctp <- idx_of(cps$onset_tp[k])
      if (ct0 > E$t0) rec <- setdiff(rec, (ct0 - 12L):ctp)
    }
  }
  rec_sets[[as.character(E$id)]] <- rec
  # cross-check derived bounds against the event file's own columns
  chk <- c(idx_of(E$rl_start) == min(rl), idx_of(E$rl_end) == max(rl), idx_of(E$rlx_end) == max(rlx),
           idx_of(E$ew_start) == E$t0 - 12L, idx_of(E$ew_end) == E$tend + 24L,
           as.integer(E$rec_n_stamps) == length(rec))
  if (length(rec)) chk <- c(chk, idx_of(E$rec_start) == min(rec), idx_of(E$rec_end) == max(rec))
  if (!all(chk)) { win_check <- win_check + 1L; say("event-file window column disagreement, event", E$id) }
  ew[ewr] <- 1L
  if (E$kept == 1L) {
    if (any(!is.na(lab_rl[rl])) || any(!is.na(lab_rlx[rlx])) || any(!is.na(lab_rec[rec]))) lab_err <- lab_err + 1L
    lab_rl[rl] <- E$id; lab_rlx[rlx] <- E$id; lab_rec[rec] <- E$id
  }
}
NORMAL <- 1L - ew
say("labels derived; overlapping-label conflicts:", lab_err, "event-file window disagreements:", win_check)

# S2 / S3 views (only for the mask of those files, D-5 H12)
VIEWS <- list(primary = list(lf = LFV, por = PORV), multi = list(lf = LFV, por = PORV),
              S2 = list(lf = view(LF, 0L), por = view(POR, 0L)), S3 = list(lf = view(LF, 1L), por = view(POR, 1L)))

# ------------------------------------------------------------------ tick-file reader and assertions
TICKCOLS <- c("in_scoring","has_pred","raw","unc","disp","ceiling_applied","stop","nonconverged","lookup_fail",
              "travel_gf_lf","lf_view","por_view","base_rst","base_flow_bin","base_flow_state","mask","mask_why",
              "tau_ref","tau_converged","truth","truth_tick_utc","truth_basehz","truth_own","rl_event","rlx_event",
              "rec_event","ew_any","normal","flow_bin","flow_state","rst","b_active","validated","corr","truth_basehz_tick","truth_own_tick","base_stop","lf_carry_h","por_carry_h","rate","delta_on","pct")
read_ticks <- function(run) {
  d <- read_csv(file.path(BT, RUNS[[run]]), col_types = cols(.default = col_character()), na = character(), progress = FALSE)
  stopifnot(nrow(d) == 4L * N, ncol(d) == 50L)
  d
}
same4 <- function(x) { m <- matrix(x, nrow = 4); all(m[1, ] == m[2, ] & m[1, ] == m[3, ] & m[1, ] == m[4, ]) }
assert_run <- function(run, d) {
  res <- list()
  # (c) layout: four arm rows per tick in order, tick times in sequence
  stopifnot(all(d$arm == rep(c("base","A","B","C"), N)))
  tk <- d$tick_utc[seq(1, 4L * N, 4)]
  stopifnot(same4(d$tick_utc), all(tk == iso_of(seq_len(N))))
  tick_level <- c("in_scoring","lf_view","por_view","lf_carry_h","por_carry_h","base_rst","base_stop","base_flow_bin","base_flow_state",
                  "mask","mask_why","tau_ref","tau_converged","truth","truth_tick_utc","truth_basehz","truth_basehz_tick",
                  "rl_event","rlx_event","rec_event","ew_any","normal")
  bad_tl <- tick_level[!vapply(tick_level, function(v) same4(d[[v]]), logical(1))]
  if (length(bad_tl)) stop("tick-level column differs across arm rows (STOP): ", paste(bad_tl, collapse = ","))
  b <- d[seq(1, 4L * N, 4), ]
  # base-copy columns equal the base arm's own value
  stopifnot(all(b$base_rst == b$rst), all(b$base_stop == b$stop), all(b$base_flow_bin == b$flow_bin),
            all(b$base_flow_state == b$flow_state), all(b$truth_basehz == b$truth_own))
  stopifnot(all(as.integer(b$in_scoring) == as.integer(seq_len(N) >= SCORE_START)))
  # has_pred on masked rows
  hp_bad <- sum(d$mask == "1" & d$has_pred != "1")
  if (hp_bad > 0) stop("has_pred != 1 on ", hp_bad, " masked rows (STOP)")
  # (a) truth
  V <- VIEWS[[run]]
  f_mask <- as.integer(b$mask); f_tau <- num(b$tau_ref); f_conv <- suppressWarnings(as.integer(b$tau_converged))
  f_truth <- num(b$truth); f_tt <- ifelse(b$truth_tick_utc == "", NA, b$truth_tick_utc)
  my_tt <- ifelse(is.na(TRUTH_T), NA, iso_of(TRUTH_T))
  my_mask <- MASK
  my_why <- why
  if (run %in% c("S2","S3")) {
    vi <- !is.na(V$lf$val) & !is.na(V$por$val)
    my_why[my_mask == 1L & !vi] <- "view_input_missing"
    my_mask <- as.integer(my_mask == 1L & vi)
  }
  eqna <- function(a, b) (is.na(a) & is.na(b)) | (!is.na(a) & !is.na(b) & a == b)
  taud <- abs(f_tau - tau); taud_max <- max(taud, na.rm = TRUE)
  mm <- !(eqna(f_mask, my_mask) & eqna(f_truth, TRUTH) & eqna(f_tt, my_tt) & eqna(f_conv, conv) &
          ((is.na(f_tau) & is.na(tau)) | (!is.na(f_tau) & !is.na(tau) & taud <= 1e-9)) & eqna(b$mask_why, my_why))
  # lag-view columns of this file's view
  lvm <- !(eqna(num(b$lf_view), V$lf$val) & eqna(num(b$por_view), V$por$val) &
           eqna(suppressWarnings(as.integer(b$lf_carry_h)), V$lf$car) & eqna(suppressWarnings(as.integer(b$por_carry_h)), V$por$car))
  # (b) labels
  lab <- function(x) suppressWarnings(as.integer(ifelse(x == "", NA, x)))
  lm <- !(eqna(lab(b$rl_event), lab_rl) & eqna(lab(b$rlx_event), lab_rlx) & eqna(lab(b$rec_event), lab_rec) &
          eqna(as.integer(b$normal), NORMAL) & eqna(as.integer(b$ew_any), ew))
  # D-8 override: the tick 2026-11-09T12:00Z has a truth in the file read at 2026-11-10T00:00Z, after the
  # last grid tick. Ruling D-8: literal reading stands, that tick has no truth and is mask 0 in all four runs.
  # It must be the ONLY mismatching tick, and the mismatch must be exactly file mask 1 / rebuilt mask 0.
  mmw <- which(mm)
  ovr_ok <- length(mmw) == 0L || (identical(mmw, OVR) && f_mask[OVR] == 1L && my_mask[OVR] == 0L &&
                                  identical(f_tt[OVR], "2026-11-10T00:00:00.000Z"))
  if (!ovr_ok) stop("truth/mask mismatch beyond the D-8 override tick (STOP): ", paste(head(iso_of(mmw), 10), collapse = ", "))
  # D-8 assertion: no RL/RLX/REC-labelled tick reads any truth after the last grid tick (all arm rows)
  LASTISO <- iso_of(N)
  labd <- d$rl_event != "" | d$rlx_event != "" | d$rec_event != ""
  late <- labd & ((d$truth_tick_utc != "" & d$truth_tick_utc > LASTISO) | (d$truth_basehz_tick != "" & d$truth_basehz_tick > LASTISO) |
                  (d$truth_own_tick != "" & d$truth_own_tick > LASTISO))
  if (any(late)) stop("labelled tick reads a truth after the grid end (STOP): ", sum(late), " rows")
  res$truth_ticks_compared <- N
  res$truth_mismatches <- sum(mm)
  res$truth_mismatches_after_override <- sum(mm[-OVR])
  res$labelled_rows_truth_after_grid_end <- sum(late)
  res$tau_max_abs_diff <- taud_max
  res$label_mismatches <- sum(lm)
  res$view_mismatches <- sum(lvm)
  # mask after the override equals my rebuilt mask (asserted above)
  res$n_tau_nonconverged_masked <- sum(my_mask == 1L & seq_len(N) >= SCORE_START & conv == 0L, na.rm = TRUE)
  if (sum(mm)) { w <- head(which(mm), 5); print(data.frame(tick = iso_of(w), f_mask = f_mask[w], my_mask = my_mask[w], f_why = b$mask_why[w], my_why = my_why[w],
                                                          f_tau = f_tau[w], my_tau = tau[w], f_truth = f_truth[w], my_truth = TRUTH[w], f_tt = f_tt[w], my_tt = my_tt[w])) }
  if (sum(lm)) { w <- head(which(lm), 5); print(data.frame(tick = iso_of(w), f_rl = b$rl_event[w], my_rl = lab_rl[w], f_rlx = b$rlx_event[w], my_rlx = lab_rlx[w],
                                                          f_rec = b$rec_event[w], my_rec = lab_rec[w], f_n = b$normal[w], my_n = NORMAL[w])) }
  if (sum(lvm)) { w <- head(which(lvm), 5); print(data.frame(tick = iso_of(w), f_lf = b$lf_view[w], my_lf = V$lf$val[w], f_por = b$por_view[w], my_por = V$por$val[w])) }
  say(run, ": truth mismatches", sum(mm), "label mismatches", sum(lm), "view mismatches", sum(lvm), "tau max abs diff", taud_max)
  res
}

# ------------------------------------------------------------------ 2. assertions on all four runs (before any arm metric)
lab_int <- function(x) suppressWarnings(as.integer(ifelse(x == "", NA, x)))
reduce_run <- function(d) {
  keep <- d$in_scoring == "1" & d$mask == "1"     # file mask; the D-8 tick is flagged (ovr) and dropped later, kept for G4*_edge
  x <- d[keep, ]
  i <- idx_of(x$tick_utc)
  data.frame(i = i, arm = x$arm,
             raw = num(x$raw), unc = num(x$unc), disp = num(x$disp), truth = num(x$truth),
             truth_basehz = num(x$truth_basehz), truth_own = num(x$truth_own),
             stop = x$stop, base_rst = x$base_rst, base_flow_bin = x$base_flow_bin, base_flow_state = x$base_flow_state,
             rl = lab_int(x$rl_event), rlx = lab_int(x$rlx_event), rec = lab_int(x$rec_event), normal = as.integer(x$normal),
             ceiling_applied = lab_int(x$ceiling_applied), travel_gf_lf = num(x$travel_gf_lf), travel_por_gf = num(x$travel_por_gf),
             b_active = lab_int(x$b_active), ovr = i == OVR, stringsAsFactors = FALSE)
}
CHECK <- list(); DATA <- list()
for (run in names(RUNS)) {
  say("reading", run)
  d <- read_ticks(run)
  CHECK[[run]] <- assert_run(run, d)
  DATA[[run]] <- reduce_run(d)
  rm(d); invisible(gc())
}
stop_now <- any(vapply(CHECK, function(r) r$truth_mismatches_after_override + r$label_mismatches + r$view_mismatches +
                         r$labelled_rows_truth_after_grid_end, numeric(1)) > 0) || lab_err > 0 || win_check > 0
if (stop_now) stop("ASSERTION MISMATCH: STOP before any arm metric")
say("all assertions passed (D-8 override tick is the only truth/mask difference)")
if (ASSERT_ONLY) quit(save = "no", status = 0)

# ------------------------------------------------------------------ 3. gate metrics
ARMS <- c("base", "A", "B", "C"); CMP <- c("A", "B", "C")
evs <- ev[order(ev$t0), ]
GATE  <- evs$id[evs$cls == "GATE" & evs$kept == 1L]
OCT   <- evs$id[evs$cls == "GATE" & evs$kept == 1L & evs$oct == 1L]
NOOCT <- setdiff(GATE, OCT)
HOLD  <- evs$id[evs$cls == "GATE" & evs$kept == 1L & evs$holdout == 1L]
STRAT <- evs$id[evs$cls == "STRATUM" & evs$kept == 1L]
stopifnot(length(GATE) == 21L, length(OCT) == 1L, length(NOOCT) == 20L,
          identical(HOLD, tail(NOOCT, ceiling(0.20 * length(NOOCT)))))   # holdout = last ceil(0.2 N_nonOct)
B21 <- as.matrix(read.csv(f_b21, header = FALSE)); B20 <- as.matrix(read.csv(f_b20, header = FALSE))
stopifnot(all(dim(B21) == c(10000, 21)), all(dim(B20) == c(10000, 20)), all(B21 %in% 0:20), all(B20 %in% 0:19))
counts <- function(B, n) {      # resample x event multiplicity (0-based indices -> +1)
  C <- matrix(0, nrow(B), n); r <- seq_len(nrow(B))
  for (k in seq_len(ncol(B))) { ix <- cbind(r, B[, k] + 1L); C[ix] <- C[ix] + 1 }
  C
}
C21 <- counts(B21, 21L); C20 <- counts(B20, 20L)
qci <- function(x) quantile(x, c(0.025, 0.975), type = 7, names = FALSE)
BOOT_NAN <- 0L

wide <- function(D) {
  out <- lapply(ARMS, function(a) { x <- D[D$arm == a, ]; x[order(x$i), ] }); names(out) <- ARMS
  for (a in ARMS) stopifnot(identical(out[[a]]$i, out$base$i))
  out
}
evsum <- function(v, lab, ids) vapply(ids, function(e) sum(v[!is.na(lab) & lab == e]), numeric(1))
ROWS <- list()
add <- function(run, crit, arm, subset, stat, value, key = "") {
  ROWS[[length(ROWS) + 1L]] <<- data.frame(run = run, criterion = crit, arm = arm, subset = subset, stat = stat,
                                           key = as.character(key), value = as.numeric(value), stringsAsFactors = FALSE)
}

g4 <- function(run, W, crit_a, crit_b, PASS) {
  b <- W$base; sel <- b$normal == 1L
  cell <- paste(b$base_flow_bin, b$base_flow_state, sep = "|")
  ct <- table(cell[sel]); cells <- sort(names(ct)[ct >= 200])
  mb <- mean(abs(b$disp[sel] - b$truth[sel]))
  for (a in CMP) {
    x <- W[[a]]; ma <- mean(abs(x$disp[sel] - x$truth[sel])); rel <- ma / mb - 1
    add(run, crit_a, a, "NORMAL", "mae_arm", ma); add(run, crit_a, a, "NORMAL", "mae_base", mb)
    add(run, crit_a, a, "NORMAL", "rel_change", rel); add(run, crit_a, a, "NORMAL", "n_ticks", sum(sel))
    add(run, crit_a, a, "NORMAL", "pass", rel <= 0.02)
    rels <- numeric(0)
    for (cc in cells) {
      s <- sel & cell == cc
      r <- sum(abs(x$disp[s] - x$truth[s])) / sum(abs(b$disp[s] - b$truth[s])) - 1
      rels <- c(rels, r)
      add(run, crit_b, a, "NORMAL", "n_ticks", sum(s), cc); add(run, crit_b, a, "NORMAL", "rel_change", r, cc)
    }
    add(run, crit_b, a, "NORMAL", "n_cells", length(cells)); add(run, crit_b, a, "NORMAL", "worst_rel_change", max(rels))
    add(run, crit_b, a, "NORMAL", "pass", all(rels <= 0.05))
    if (!is.null(PASS)) { PASS[[a]]["G4a"] <- rel <= 0.02; PASS[[a]]["G4b"] <- all(rels <= 0.05) }
  }
  PASS
}

gate_run <- function(run) {
  D <- DATA[[run]]
  W  <- wide(D[!D$ovr, ])       # D-8: override tick excluded from every criterion
  WE <- wide(D)                 # file mask as written (G4a_edge, G4b_edge only)
  b <- W$base
  PASS <- setNames(lapply(CMP, function(a) logical(0)), CMP)
  e_unc  <- lapply(W, function(x) abs(x$unc - x$truth))
  S_unc  <- lapply(e_unc, function(v) evsum(v, b$rl, GATE))
  N_rl   <- evsum(rep(1, nrow(b)), b$rl, GATE)
  names(N_rl) <- GATE; for (a in ARMS) names(S_unc[[a]]) <- GATE
  stopifnot(all(N_rl >= 6))
  # G1a, G1b
  for (a in CMP) for (sub in c("RL_all", "RL_nooct")) {
    ids <- if (sub == "RL_all") GATE else NOOCT; C <- if (sub == "RL_all") C21 else C20
    crit <- if (sub == "RL_all") "G1a" else "G1b"; thr <- if (sub == "RL_all") 0.15 else 0.10
    sa <- S_unc[[a]][as.character(ids)]; sb <- S_unc$base[as.character(ids)]; nt <- sum(N_rl[as.character(ids)])
    ma <- sum(sa) / nt; mb <- sum(sb) / nt; gain <- 1 - ma / mb
    bs <- 1 - as.vector(C %*% sa) / as.vector(C %*% sb); BOOT_NAN <<- BOOT_NAN + sum(!is.finite(bs))
    ci <- qci(bs[is.finite(bs)]); pass <- gain >= thr && ci[1] > 0
    for (st in c("mae_arm","mae_base","gain","ci_lo","ci_hi","n_ticks","n_events","pass"))
      add(run, crit, a, sub, st, switch(st, mae_arm = ma, mae_base = mb, gain = gain, ci_lo = ci[1], ci_hi = ci[2],
                                        n_ticks = nt, n_events = sum(N_rl[as.character(ids)] > 0), pass = pass))
    PASS[[a]][crit] <- pass
  }
  # G2
  for (a in CMP) {
    sa <- S_unc[[a]]; sb <- S_unc$base; imp <- sum(sa < sb); n <- length(GATE)
    for (k in seq_along(GATE)) {
      add(run, "G2", a, "RL_all", "sum_abs_arm", sa[k], GATE[k]); add(run, "G2", a, "RL_all", "sum_abs_base", sb[k], GATE[k])
      add(run, "G2", a, "RL_all", "n_ticks", N_rl[k], GATE[k])
    }
    pass <- imp * 100 >= 65 * n
    add(run, "G2", a, "RL_all", "improved", imp); add(run, "G2", a, "RL_all", "n_events", n)
    add(run, "G2", a, "RL_all", "share", imp / n); add(run, "G2", a, "RL_all", "pass", pass)
    PASS[[a]]["G2"] <- pass
  }
  # G3a, G3b (e_raw, REC)
  pb <- lapply(W, function(x) 100 * (x$raw - x$truth) / x$truth)
  S_b <- lapply(pb, function(v) evsum(v, b$rec, GATE)); N_rec <- evsum(rep(1, nrow(b)), b$rec, GATE)
  bias_b <- sum(S_b$base) / sum(N_rec)
  bb_boot <- as.vector(C21 %*% S_b$base) / as.vector(C21 %*% N_rec)
  for (a in CMP) {
    bias_a <- sum(S_b[[a]]) / sum(N_rec); d <- abs(bias_a) - abs(bias_b)
    ba_boot <- as.vector(C21 %*% S_b[[a]]) / as.vector(C21 %*% N_rec)
    ds <- abs(ba_boot) - abs(bb_boot); BOOT_NAN <<- BOOT_NAN + sum(!is.finite(ds))
    ci <- qci(ds[is.finite(ds)]); pass <- d <= 0 && ci[2] <= 1.0
    for (st in c("bias_arm","bias_base","d_bias","ci_lo","ci_hi","n_ticks","pass"))
      add(run, "G3a", a, "REC_all", st, switch(st, bias_arm = bias_a, bias_base = bias_b, d_bias = d, ci_lo = ci[1], ci_hi = ci[2],
                                               n_ticks = sum(N_rec), pass = pass))
    add(run, "G3b", a, "REC_all", "abs_bias_arm", abs(bias_a)); add(run, "G3b", a, "REC_all", "pass", abs(bias_a) <= 1.6)
    PASS[[a]]["G3a"] <- pass; PASS[[a]]["G3b"] <- abs(bias_a) <= 1.6
  }
  # G4a, G4b (+ edge sensitivity, report-only)
  PASS <- g4(run, W, "G4a", "G4b", PASS)
  g4(run, WE, "G4a_edge", "G4b_edge", NULL)
  # G5a, G5b, G7e, P3: rising ticks = RL tick of a kept GATE event with base_rst == rising (D-5 H8)
  ris_all <- !is.na(b$rl) & b$rl %in% GATE & b$base_rst == "rising"
  ris_no  <- !is.na(b$rl) & b$rl %in% NOOCT & b$base_rst == "rising"
  sh <- list()
  for (a in ARMS) for (sub in c("RL_rising_all", "RL_rising_nooct")) {
    r <- if (sub == "RL_rising_all") ris_all else ris_no
    nn <- sum(W[[a]]$stop[r] == "max_iter")
    add(run, "G5a", a, sub, "n_rising", sum(r)); add(run, "G5a", a, sub, "n_nonconverged", nn); add(run, "G5a", a, sub, "share", nn / sum(r))
    sh[[a]][sub] <- nn / sum(r)
  }
  for (a in c("B", "C")) { p <- all(sh[[a]] < 0.05); add(run, "G5a", a, "", "pass", p); PASS[[a]]["G5a"] <- p }
  dA <- sh$A - sh$base
  add(run, "G5b", "A", "RL_rising_all", "diff", dA["RL_rising_all"]); add(run, "G5b", "A", "RL_rising_nooct", "diff", dA["RL_rising_nooct"])
  add(run, "G5b", "A", "", "pass", all(dA <= 0)); PASS$A["G5b"] <- all(dA <= 0)
  lk <- function(a) mean(W[[a]]$stop[ris_all] %in% c("no_hist", "hist_lost"))
  for (a in CMP) {
    p <- lk(a) <= lk("base")
    add(run, "G7e", a, "RL_rising_all", "share_arm", lk(a)); add(run, "G7e", a, "RL_rising_all", "share_base", lk("base"))
    add(run, "G7e", a, "RL_rising_all", "pass", p); PASS[[a]]["G7e"] <- p
  }
  ro <- !is.na(b$rl) & b$rl == OCT & b$base_rst == "rising"; no <- sum(b$stop[ro] == "max_iter")
  add(run, "P3", "base", "OCT_RL_rising", "n_rising", sum(ro)); add(run, "P3", "base", "OCT_RL_rising", "n_nonconverged", no)
  add(run, "P3", "base", "OCT_RL_rising", "share", no / sum(ro)); add(run, "P3", "base", "OCT_RL_rising", "pass", no / sum(ro) >= 0.20)
  # G6a, G6b
  for (a in CMP) {
    sa <- S_unc[[a]]; sb <- S_unc$base
    oks <- c()
    for (sub in c("LOEO_all", "LOEO_nooct")) {
      ids <- as.character(if (sub == "LOEO_all") GATE else NOOCT); gains <- c(); okv <- c()
      for (e in ids) {
        rem <- setdiff(ids, e); g <- 1 - sum(sa[rem]) / sum(sb[rem]); imp <- sum(sa[rem] < sb[rem]); n <- length(rem)
        thr <- if (sub == "LOEO_all" && e != as.character(OCT)) 0.15 else 0.10
        ok <- g >= thr && imp * 100 >= 65 * n
        add(run, "G6a", a, sub, "gain", g, e); add(run, "G6a", a, sub, "improved", imp, e); add(run, "G6a", a, sub, "n_events", n, e)
        add(run, "G6a", a, sub, "threshold_gain", thr, e); add(run, "G6a", a, sub, "ok", ok, e)
        gains <- c(gains, g); okv <- c(okv, ok)
      }
      add(run, "G6a", a, sub, "min_gain", min(gains)); add(run, "G6a", a, sub, "pass", all(okv)); oks <- c(oks, all(okv))
    }
    add(run, "G6a", a, "", "pass", all(oks)); PASS[[a]]["G6a"] <- all(oks)
    h <- as.character(HOLD); g <- 1 - sum(sa[h]) / sum(sb[h]); imp <- sum(sa[h] < sb[h]); n <- length(h)
    p <- g >= 0.10 && imp * 100 >= 65 * n
    add(run, "G6b", a, "RL_H", "gain", g); add(run, "G6b", a, "RL_H", "improved", imp); add(run, "G6b", a, "RL_H", "n_events", n)
    add(run, "G6b", a, "RL_H", "pass", p); PASS[[a]]["G6b"] <- p
  }
  # G7a, G7b, G7c, G7d, G7f
  rl <- !is.na(b$rl) & b$rl %in% GATE; rlx <- !is.na(b$rlx) & b$rlx %in% GATE
  for (a in CMP) {
    x <- W[[a]]
    ra <- mean(abs(x$raw[rl] - x$truth[rl])); rb <- mean(abs(b$raw[rl] - b$truth[rl])); v <- 1 - ra / rb
    add(run, "G7a", a, "RL_all", "rawmae_arm", ra); add(run, "G7a", a, "RL_all", "rawmae_base", rb)
    add(run, "G7a", a, "RL_all", "value", v); add(run, "G7a", a, "RL_all", "pass", v > 0); PASS[[a]]["G7a"] <- v > 0
    ma <- mean(100 * abs(x$unc[rl] - x$truth[rl]) / x$truth[rl]); mb <- mean(100 * abs(b$unc[rl] - b$truth[rl]) / b$truth[rl]); v <- 1 - ma / mb
    add(run, "G7b", a, "RL_all", "mape_arm", ma); add(run, "G7b", a, "RL_all", "mape_base", mb)
    add(run, "G7b", a, "RL_all", "value", v); add(run, "G7b", a, "RL_all", "pass", v > 0); PASS[[a]]["G7b"] <- v > 0
    v <- 1 - sum(abs(x$unc[rlx] - x$truth[rlx])) / sum(abs(b$unc[rlx] - b$truth[rlx]))
    add(run, "G7c", a, "RLX_all", "value", v); add(run, "G7c", a, "RLX_all", "pass", v >= 0); PASS[[a]]["G7c"] <- v >= 0
    s <- rl & !is.na(b$truth_basehz) & !is.na(x$truth_own)
    gbh <- 1 - sum(abs(x$unc[s] - b$truth_basehz[s])) / sum(abs(b$unc[s] - b$truth_basehz[s]))
    gow <- 1 - sum(abs(x$unc[s] - x$truth_own[s])) / sum(abs(b$unc[s] - b$truth_own[s]))
    add(run, "G7d", a, "RL_all", "gain_basehz", gbh); add(run, "G7d", a, "RL_all", "gain_own", gow)
    add(run, "G7d", a, "RL_all", "n_ticks", sum(s)); add(run, "G7d", a, "RL_all", "pass", gbh >= 0 && gow >= 0)
    PASS[[a]]["G7d"] <- gbh >= 0 && gow >= 0
    v <- 1 - sum(abs(x$disp[rl] - x$truth[rl])) / sum(abs(b$disp[rl] - b$truth[rl]))
    add(run, "G7f", a, "RL_all", "value", v); add(run, "G7f", a, "RL_all", "pass", v >= 0); PASS[[a]]["G7f"] <- v >= 0
  }
  # ARM: every applicable criterion of plan s.5
  for (a in CMP) {
    crits <- c("G1a","G1b","G2","G3a","G3b","G4a","G4b", if (a == "A") "G5b" else "G5a", "G6a","G6b","G7a","G7b","G7c","G7d","G7e","G7f")
    stopifnot(all(crits %in% names(PASS[[a]])))
    failed <- crits[!PASS[[a]][crits]]
    add(run, "ARM", a, "", "all_pass", length(failed) == 0)
    add(run, "ARM", a, "", "n_failed", length(failed), paste(failed, collapse = ";"))
  }
  # CHECK
  ck <- CHECK[[run]]
  for (st in c("truth_ticks_compared","truth_mismatches","truth_mismatches_after_override","tau_max_abs_diff","label_mismatches"))
    add(run, "CHECK", "", "", st, ck[[st]])
  add(run, "CHECK", "", "", "n_gate_events", length(GATE)); add(run, "CHECK", "", "", "n_gate_events_nooct", length(NOOCT))
  add(run, "CHECK", "", "", "n_holdout", length(HOLD)); add(run, "CHECK", "", "", "n_tau_nonconverged_masked", ck$n_tau_nonconverged_masked)
  add(run, "CHECK", "", "", "view_mismatches", ck$view_mismatches)
  add(run, "CHECK", "", "", "labelled_rows_truth_after_grid_end", ck$labelled_rows_truth_after_grid_end)
  invisible(NULL)
}
for (run in names(RUNS)) { say("metrics", run); gate_run(run) }
say("bootstrap resamples with a non-finite statistic (dropped):", BOOT_NAN)
RES <- do.call(rbind, ROWS)
fmt <- function(v) ifelse(is.na(v), "", sprintf("%.17g", v))
write_long <- function(R, path) {
  out <- R; out$value <- fmt(R$value)
  write.csv(out, path, row.names = FALSE, quote = FALSE, na = "")
}
stopifnot(!any(grepl(",", c(RES$key, RES$subset))))
write_long(RES, file.path(OUT, "rising_limb_metrics_R.csv"))
# nested JSON: run -> criterion -> arm -> subset -> stat -> value | {key: value}; blank arm/subset = "_"
nest <- function(R) {
  out <- list()
  for (k in seq_len(nrow(R))) {
    r <- R[k, ]; a <- if (r$arm == "") "_" else r$arm; s <- if (r$subset == "") "_" else r$subset
    v <- structure(fmt(r$value), class = "json")
    if (r$key == "") out[[r$run]][[r$criterion]][[a]][[s]][[r$stat]] <- v
    else out[[r$run]][[r$criterion]][[a]][[s]][[r$stat]][[r$key]] <- v
  }
  out
}
writeLines(toJSON(nest(RES), auto_unbox = TRUE, json_verbatim = TRUE, pretty = TRUE), file.path(OUT, "rising_limb_metrics_R.json"))
say("wrote rising_limb_metrics_R.csv/json, rows:", nrow(RES))

# ------------------------------------------------------------------ 4. report-only items (plan s.3 "Report-only strata", s.4 "Report-only diagnostics")
# Nothing below decides anything. Layout: run,item,arm,subset,stat,key,value. See REPORT_ONLY_README.md.
RO <- list()
addr <- function(run, item, arm, subset, stat, value, key = "") {
  RO[[length(RO) + 1L]] <<- data.frame(run = run, item = item, arm = arm, subset = subset, stat = stat,
                                       key = as.character(key), value = as.numeric(value), stringsAsFactors = FALSE)
}
EVK <- evs[evs$kept == 1L, ]
evrow <- function(id) EVK[EVK$id == id, ]
# event-level classifications (arm- and run-independent)
season_of <- function(m) c("DJF","DJF","MAM","MAM","MAM","JJA","JJA","JJA","SON","SON","SON","DJF")[m]
EVK$month <- as.integer(format(T0 + (EVK$t0 - 1) * 3600, "%m", tz = "UTC"))
EVK$year  <- as.integer(format(T0 + (EVK$t0 - 1) * 3600, "%Y", tz = "UTC"))
EVK$season <- season_of(EVK$month)
EVK$peak <- as.numeric(EVK$event_peak_lf)
EVK$peakcls <- ifelse(EVK$peak >= 25000, "25k+", ifelse(EVK$peak >= 12000, "12k-25k", "below12k"))
EVK$por_t0 <- POR[EVK$t0]; EVK$lf_t0 <- LF[EVK$t0]
EVK$led <- ifelse(is.na(EVK$por_t0) | is.na(EVK$lf_t0), "unknown", ifelse(EVK$por_t0 < 0.5 * EVK$lf_t0, "LF-led", "PoR-led"))
# PoR onset: first stamp s in [t0-72 h, tp] with raw PoR >= 6000 and PoR(s-1) present and < 6000 (ASSUMPTIONS R5)
EVK$por_onset_lead_h <- vapply(seq_len(nrow(EVK)), function(k) {
  s <- (EVK$t0[k] - 72L):EVK$tp[k]; s <- s[s >= 2]
  hit <- s[!is.na(POR[s]) & POR[s] >= 6000 & !is.na(POR[s - 1L]) & POR[s - 1L] < 6000]
  if (length(hit)) EVK$t0[k] - hit[1] else NA_real_
}, numeric(1))
# observed PoR-to-LF lag: lag 0..48 h maximising cor(dLF(s), dPoR(s-lag)) over s in [t0-12 h, t0+36 h]
EVK$obs_lag_h <- vapply(seq_len(nrow(EVK)), function(k) {
  s <- (EVK$t0[k] - 12L):(EVK$t0[k] + 36L); best <- NA_real_; bc <- -Inf
  dLF <- LF[s] - LF[s - 1L]
  for (L in 0:48) {
    dP <- POR[s - L] - POR[s - L - 1L]; ok <- !is.na(dLF) & !is.na(dP)
    if (sum(ok) < 10 || sd(dLF[ok]) == 0 || sd(dP[ok]) == 0) next
    cc <- cor(dLF[ok], dP[ok]); if (cc > bc) { bc <- cc; best <- L }
  }
  best
}, numeric(1))
for (k in seq_len(nrow(EVK))) {
  e <- EVK$id[k]; cl <- EVK$cls[k]
  addr("event", "EVENT_INFO", "", cl, "por_onset_lead_h", EVK$por_onset_lead_h[k], e)
  addr("event", "EVENT_INFO", "", cl, "observed_por_lf_lag_h", EVK$obs_lag_h[k], e)
  addr("event", "EVENT_INFO", "", cl, "lf_led", EVK$led[k] == "LF-led", e)
  addr("event", "EVENT_INFO", "", cl, "por_t0", EVK$por_t0[k], e); addr("event", "EVENT_INFO", "", cl, "lf_t0", EVK$lf_t0[k], e)
  addr("event", "EVENT_INFO", "", cl, "peak_lf", EVK$peak[k], e)
}

rl_block <- function(run, item, subset, W, ids, key = "") {   # pooled RL gain, breadth, MAE on e_unc for an event set
  b <- W$base; if (!length(ids)) return(invisible())
  sb <- evsum(abs(b$unc - b$truth), b$rl, ids); nt <- evsum(rep(1, nrow(b)), b$rl, ids)
  for (a in CMP) {
    x <- W[[a]]; sa <- evsum(abs(x$unc - x$truth), b$rl, ids)
    addr(run, item, a, subset, "gain", 1 - sum(sa) / sum(sb), key); addr(run, item, a, subset, "improved", sum(sa < sb), key)
    addr(run, item, a, subset, "n_events", sum(nt > 0), key); addr(run, item, a, subset, "n_ticks", sum(nt), key)
    addr(run, item, a, subset, "mae_arm", sum(sa) / sum(nt), key); addr(run, item, a, subset, "mae_base", sum(sb) / sum(nt), key)
  }
}
report_run <- function(run) {
  D <- DATA[[run]]; W <- wide(D[!D$ovr, ]); b <- W$base
  # STRATUM class: same RL metrics plus REC bias
  rl_block(run, "STRATUM_RL", "RL_stratum", W, STRAT)
  nrec <- evsum(rep(1, nrow(b)), b$rec, STRAT)
  bb <- sum(evsum(100 * (b$raw - b$truth) / b$truth, b$rec, STRAT)) / sum(nrec)
  for (a in CMP) {
    x <- W[[a]]; ba <- sum(evsum(100 * (x$raw - x$truth) / x$truth, b$rec, STRAT)) / sum(nrec)
    addr(run, "STRATUM_REC", a, "REC_stratum", "bias_arm", ba); addr(run, "STRATUM_REC", a, "REC_stratum", "bias_base", bb)
    addr(run, "STRATUM_REC", a, "REC_stratum", "d_bias", abs(ba) - abs(bb)); addr(run, "STRATUM_REC", a, "REC_stratum", "n_ticks", sum(nrec))
  }
  G <- EVK[EVK$id %in% GATE, ]
  for (g in sort(unique(G$led)))    rl_block(run, "STRATA_LED", "RL_all", W, G$id[G$led == g], g)
  for (g in sort(unique(G$season))) rl_block(run, "STRATA_SEASON", "RL_all", W, G$id[G$season == g], g)
  for (g in sort(unique(G$peakcls))) rl_block(run, "STRATA_PEAK", "RL_all", W, G$id[G$peakcls == g], g)
  for (g in sort(unique(G$year)))   rl_block(run, "PER_YEAR_RL", "RL_all", W, G$id[G$year == g], g)
  rl <- !is.na(b$rl) & b$rl %in% GATE
  # per-event modelled PoR-to-LF travel (mean over scored RL ticks of travel_por_gf + travel_gf_lf)
  for (a in ARMS) for (e in GATE) {
    s <- rl & b$rl == e
    addr(run, "TRAVEL_MODELLED", a, "RL_all", "mean_por_lf_travel_h", mean(W[[a]]$travel_por_gf[s] + W[[a]]$travel_gf_lf[s]), e)
  }
  # PoR crest to LF crest ticks, arm B (B switches off when PoR is steady at its crest)
  for (e in GATE) {
    E <- EVK[EVK$id == e, ]; s0 <- (E$t0 - 12L):E$tp; pc <- s0[which.max(replace(POR[s0], is.na(POR[s0]), -Inf))]
    s <- b$i > pc & b$i <= E$tp
    addr(run, "POR_CREST_TO_LF_CREST", "B", "", "por_crest_to_tp_h", E$tp - pc, e)
    addr(run, "POR_CREST_TO_LF_CREST", "B", "", "n_ticks", sum(s), e)
    addr(run, "POR_CREST_TO_LF_CREST", "B", "", "n_b_active", sum(W$B$b_active[s] == 1L), e)
    if (sum(s)) {
      addr(run, "POR_CREST_TO_LF_CREST", "B", "", "mae_arm", mean(abs(W$B$unc[s] - W$B$truth[s])), e)
      addr(run, "POR_CREST_TO_LF_CREST", "B", "", "mae_base", mean(abs(b$unc[s] - b$truth[s])), e)
    }
  }
  # literal brief window [t0, t0+24 h], kept GATE events
  bw <- rep(NA_integer_, nrow(b))
  for (e in GATE) { E <- EVK[EVK$id == e, ]; bw[b$i >= E$t0 & b$i <= E$t0 + 24L] <- e }
  for (a in CMP) {
    s <- !is.na(bw); x <- W[[a]]
    addr(run, "BRIEF_WINDOW", a, "t0_to_t0p24_all", "gain", 1 - sum(abs(x$unc[s] - x$truth[s])) / sum(abs(b$unc[s] - b$truth[s])))
    addr(run, "BRIEF_WINDOW", a, "t0_to_t0p24_all", "n_ticks", sum(s))
  }
  # event-equal-weighted gain
  nt <- evsum(rep(1, nrow(b)), b$rl, GATE); sb <- evsum(abs(b$unc - b$truth), b$rl, GATE)
  for (a in CMP) {
    sa <- evsum(abs(W[[a]]$unc - W[[a]]$truth), b$rl, GATE)
    addr(run, "EVENT_EQUAL_GAIN", a, "RL_all", "gain_mean_of_event_mae", 1 - mean(sa / nt) / mean(sb / nt))
    addr(run, "EVENT_EQUAL_GAIN", a, "RL_all", "mean_of_event_gains", mean(1 - sa / sb))
  }
  # cap-bind rate
  for (a in ARMS) {
    addr(run, "CAP_BIND", a, "RL_all", "rate", mean(W[[a]]$ceiling_applied[rl] == 1L))
    addr(run, "CAP_BIND", a, "NORMAL", "rate", mean(W[[a]]$ceiling_applied[b$normal == 1L] == 1L))
  }
  # per-bin tables (base flow bin): RL gain on e_unc, normal-hours relative MAE change on e_disp
  for (bin in sort(unique(b$base_flow_bin[rl]))) for (a in CMP) {
    s <- rl & b$base_flow_bin == bin; x <- W[[a]]
    addr(run, "PER_BIN_RL", a, "RL_all", "gain", 1 - sum(abs(x$unc[s] - x$truth[s])) / sum(abs(b$unc[s] - b$truth[s])), bin)
    addr(run, "PER_BIN_RL", a, "RL_all", "n_ticks", sum(s), bin)
  }
  nm <- b$normal == 1L
  for (bin in sort(unique(b$base_flow_bin[nm]))) for (a in CMP) {
    s <- nm & b$base_flow_bin == bin; x <- W[[a]]
    addr(run, "PER_BIN_NORMAL", a, "NORMAL", "rel_change", sum(abs(x$disp[s] - x$truth[s])) / sum(abs(b$disp[s] - b$truth[s])) - 1, bin)
    addr(run, "PER_BIN_NORMAL", a, "NORMAL", "n_ticks", sum(s), bin)
  }
  yr <- as.integer(format(T0 + (b$i - 1) * 3600, "%Y", tz = "UTC"))
  for (y in sort(unique(yr[nm]))) for (a in CMP) {
    s <- nm & yr == y; x <- W[[a]]
    addr(run, "PER_YEAR_NORMAL", a, "NORMAL", "rel_change", sum(abs(x$disp[s] - x$truth[s])) / sum(abs(b$disp[s] - b$truth[s])) - 1, y)
    addr(run, "PER_YEAR_NORMAL", a, "NORMAL", "n_ticks", sum(s), y)
  }
  # excluded GATE-class events (X0-X4), sensitivity: RL windows from the event file, scored ticks only
  EX <- evs[evs$cls == "GATE" & evs$kept == 0L, ]
  lx <- rep(NA_integer_, nrow(b))
  for (k in seq_len(nrow(EX))) { E <- EX[k, ]; lx[b$i >= E$t0 - 12L & b$i <= min(E$t0 + 24L, E$tp)] <- E$id }
  for (a in CMP) {
    x <- W[[a]]; sa <- evsum(abs(x$unc - x$truth), lx, EX$id); sb2 <- evsum(abs(b$unc - b$truth), lx, EX$id); n2 <- evsum(rep(1, nrow(b)), lx, EX$id)
    addr(run, "EXCLUDED_GATE_RL", a, "RL_excluded", "gain", 1 - sum(sa) / sum(sb2))
    addr(run, "EXCLUDED_GATE_RL", a, "RL_excluded", "improved", sum(sa[n2 > 0] < sb2[n2 > 0]))
    addr(run, "EXCLUDED_GATE_RL", a, "RL_excluded", "n_events", sum(n2 > 0)); addr(run, "EXCLUDED_GATE_RL", a, "RL_excluded", "n_ticks", sum(n2))
  }
  # normal-hours calendar-month block bootstrap (seed 20261111, primary only, D-7 E3)
  if (run == "primary") {
    ym <- format(T0 + (b$i[nm] - 1) * 3600, "%Y-%m", tz = "UTC"); months <- sort(unique(ym)); K <- length(months)
    mi <- match(ym, months)
    sbm <- as.vector(tapply(abs(b$disp[nm] - b$truth[nm]), factor(mi, levels = 1:K), sum))
    set.seed(20261111)
    IDX <- matrix(sample.int(K, 10000L * K, replace = TRUE), nrow = 10000L, byrow = TRUE)
    CM <- counts(IDX - 1L, K)
    for (a in CMP) {
      sam <- as.vector(tapply(abs(W[[a]]$disp[nm] - W[[a]]$truth[nm]), factor(mi, levels = 1:K), sum))
      bs <- as.vector(CM %*% sam) / as.vector(CM %*% sbm) - 1; ci <- qci(bs)
      addr(run, "NORMAL_MONTH_BOOT", a, "NORMAL", "rel_change", sum(sam) / sum(sbm) - 1)
      addr(run, "NORMAL_MONTH_BOOT", a, "NORMAL", "ci_lo", ci[1]); addr(run, "NORMAL_MONTH_BOOT", a, "NORMAL", "ci_hi", ci[2])
      addr(run, "NORMAL_MONTH_BOOT", a, "NORMAL", "n_months", K)
    }
  }
}
for (run in names(RUNS)) { say("report-only", run); report_run(run) }
ROR <- do.call(rbind, RO)
stopifnot(!any(grepl(",", c(ROR$key, ROR$subset))))
out <- ROR; out$value <- fmt(ROR$value)
write.csv(out, file.path(OUT, "rising_limb_report_only_R.csv"), row.names = FALSE, quote = FALSE, na = "")
say("wrote rising_limb_report_only_R.csv, rows:", nrow(ROR))

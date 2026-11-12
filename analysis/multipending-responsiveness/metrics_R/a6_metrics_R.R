# A6 multi-pending validation -- blind R analyst.
# Plan: analysis/multipending-responsiveness-plan-2026-11-11.md (frozen v2 + 16b + D-1).
# Usage (from any directory):
#   Rscript a6_metrics_R.R            full run: checksums, A0-A9, BAND, P-MECH, then metrics -> a6_metrics_R.csv
#   Rscript a6_metrics_R.R --assert-only   stops after A0-A9, BAND and P-MECH; prints pass/fail only, writes nothing
# Reads only base rows of the two tick files (arm filtered inside the chunk callback; only the `arm`
# column of other rows is kept, as a code, for the A1 order check).
suppressPackageStartupMessages({ library(readr); library(dplyr) })
options(warn = 1)

args <- commandArgs(trailingOnly = TRUE)
ASSERT_ONLY <- "--assert-only" %in% args

ROOT <- "/Users/sebjilke/Desktop/PotomacPulse"
RLD  <- file.path(ROOT, "analysis/rising-limb-travel-backtest")
A6D  <- file.path(ROOT, "analysis/multipending-responsiveness")
OUTD <- file.path(A6D, "metrics_R")
F_SINGLE <- file.path(RLD, "rising_limb_ticks.csv")
F_MULTI  <- file.path(RLD, "rising_limb_ticks_multi.csv")
F_EVENTS <- file.path(RLD, "rising_limb_events_python_v39.csv")
F_BOOT   <- file.path(RLD, "rising_limb_bootstrap_indices.csv")
F_MBLK   <- file.path(A6D, "a6_month_block_indices.csv")
F_MLIST  <- file.path(A6D, "a6_month_list.csv")
F_CI     <- file.path(ROOT, "netlify/functions/shared/ci-table.js")
OUT_CSV  <- file.path(OUTD, "a6_metrics_R.csv")

msg <- function(...) cat(format(Sys.time(), "%H:%M:%S"), ..., "\n")

# ---------------------------------------------------------------- output rows
ROWS <- list()
fmtv <- function(x) {
  if (is.character(x)) return(x)
  if (length(x) != 1) stop("value must be scalar")
  if (is.logical(x)) x <- as.integer(x)
  if (is.na(x)) return("NA")
  if (is.infinite(x)) return(if (x > 0) "Inf" else "-Inf")
  if (is.integer(x)) return(as.character(x))
  format(x, digits = 17)
}
add <- function(run, criterion, mode, subset, stat, key = "", value) {
  ROWS[[length(ROWS) + 1]] <<- data.frame(run = run, criterion = criterion, mode = mode,
    subset = subset, stat = stat, key = as.character(key), value = fmtv(value), stringsAsFactors = FALSE)
}
write_rows <- function() {
  out <- bind_rows(ROWS)
  write.table(out, OUT_CSV, sep = ",", row.names = FALSE, col.names = TRUE, quote = FALSE, na = "NA")
  msg("wrote", nrow(out), "rows to", OUT_CSV)
  out
}
CHECK <- list()
check <- function(id, n_checked, n_fail) {
  CHECK[[id]] <<- c(n_checked = n_checked, n_fail = n_fail)
  add("check", id, "both", "all", "n_checked", "", as.integer(n_checked))
  add("check", id, "both", "all", "n_fail", "", as.integer(n_fail))
  add("check", id, "both", "all", "pass", "", as.integer(n_fail == 0))
  msg(sprintf("%-5s n_checked=%d n_fail=%d %s", id, n_checked, n_fail, if (n_fail == 0) "PASS" else "FAIL"))
}

# ---------------------------------------------------------------- A0 checksums
EXPECT <- c(
  single = "8d841145905de1f6b6d217835c65229862ec6e115f33823c9472ffcfbfca0a6f",
  multi  = "c99c4b56e3ae3edc47cda561a7322174d6797709e509ea63f8e0106e17064778",
  events = "978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44",
  boot   = "7eff92a751fd9cc0c6f8e0220998e98788cc2f293b5437088bf9376e1dd96519",
  mblk   = "bfce274c4aa0b72713dc4e38bd0a9245e13c0907987210b8beff04e056aba8a9",
  mlist  = "c647b7e820b1eb81e2d3c0198146e031b95dee51532ef001b32da8cbbc78b6cb")
FILES <- c(single = F_SINGLE, multi = F_MULTI, events = F_EVENTS, boot = F_BOOT, mblk = F_MBLK, mlist = F_MLIST)
sha <- vapply(FILES, function(f) {
  o <- system2("shasum", c("-a", "256", shQuote(f)), stdout = TRUE)
  strsplit(o, " +")[[1]][1]
}, "")
for (k in names(FILES)) msg("sha256", k, sha[k], if (sha[k] == EXPECT[k]) "ok" else "MISMATCH")
check("A0", length(FILES), sum(sha != EXPECT))

# ---------------------------------------------------------------- read base rows
read_base <- function(path) {
  arm_codes <- list(); base <- list(); nrow_all <- 0L
  cb <- function(x, pos) {
    arm_codes[[length(arm_codes) + 1]] <<- match(x$arm, c("base", "A", "B", "C"))
    nrow_all <<- nrow_all + nrow(x)
    base[[length(base) + 1]] <<- x[x$arm == "base", , drop = FALSE]   # other arms dropped here
  }
  read_csv_chunked(path, SideEffectChunkCallback$new(cb), chunk_size = 100000,
                   col_types = cols(.default = col_character()), na = character(),
                   quoted_na = FALSE, trim_ws = FALSE, progress = FALSE, skip_empty_rows = FALSE)
  list(base = as.data.frame(bind_rows(base), stringsAsFactors = FALSE),
       arm = unlist(arm_codes), n = nrow_all,
       header = strsplit(readLines(path, n = 1), ",", fixed = TRUE)[[1]])
}
msg("reading single"); RS <- read_base(F_SINGLE)
msg("reading multi");  RM <- read_base(F_MULTI)
S <- RS$base; M <- RM$base
msg("base rows single", nrow(S), "multi", nrow(M))

# ---------------------------------------------------------------- A1
N_TICKS <- 130987L
nfail <- 0L; nchk <- 0L
fail_if <- function(cond, what) { nchk <<- nchk + 1L; if (!isTRUE(cond)) { nfail <<- nfail + 1L; msg("A-fail:", what) } }
fail_if(RS$n == 523948L && RM$n == 523948L, sprintf("data rows %d %d", RS$n, RM$n))
fail_if(length(RS$header) == 50 && identical(RS$header, RM$header), "header")
fail_if(identical(names(S), RS$header) && identical(names(M), RM$header), "parsed names")
pat <- rep(1:4, length.out = 523948L)
fail_if(length(RS$arm) == 523948L && !anyNA(RS$arm) && all(RS$arm == pat), "arm order single")
fail_if(length(RM$arm) == 523948L && !anyNA(RM$arm) && all(RM$arm == pat), "arm order multi")
fail_if(nrow(S) == N_TICKS && nrow(M) == N_TICKS, "base rows")
tparse <- function(x) {
  ok <- grepl("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.000Z$", x)
  p <- as.POSIXct(substr(x, 1, 19), format = "%Y-%m-%dT%H:%M:%S", tz = "UTC")
  r <- as.numeric(p) * 1000; r[!ok] <- NA; r
}
t_ms <- tparse(S$tick_utc)
T0_MS <- as.numeric(as.POSIXct("2011-12-01 05:00:00", tz = "UTC")) * 1000
fail_if(!anyNA(t_ms) && all(t_ms == T0_MS + (0:(N_TICKS - 1)) * 3600000), "single base ticks hourly from 2011-12-01T05Z")
fail_if(identical(S$tick_utc, M$tick_utc), "multi base tick_utc == single")
fail_if(S$tick_utc[N_TICKS] == "2026-11-09T23:00:00.000Z", "last tick")
n_insc <- sum(S$in_scoring == "1")
fail_if(n_insc == 122208L && sum(M$in_scoring == "1") == 122208L, sprintf("in_scoring %d", n_insc))
fail_if(all(S$in_scoring %in% c("0", "1")), "in_scoring values")
check("A1", nchk, nfail)
add("check", "A1", "both", "all", "n_in_scoring", "", as.integer(n_insc))
rm(RS, RM); invisible(gc())

# ---------------------------------------------------------------- A2
A2C <- c("tick_utc", "in_scoring", "mask", "mask_why", "tau_ref", "tau_converged", "truth", "truth_tick_utc",
         "rl_event", "rlx_event", "rec_event", "ew_any", "normal", "lf_view", "por_view", "lf_carry_h", "por_carry_h")
a2f <- sum(vapply(A2C, function(c) sum(S[[c]] != M[[c]]), 0))
a2f_by <- vapply(A2C, function(c) sum(S[[c]] != M[[c]]), 0); if (a2f > 0) print(a2f_by[a2f_by > 0])
a2v <- sum(M$mask_why == "view_input_missing")
check("A2", N_TICKS * length(A2C) + N_TICKS, a2f + a2v)

# ---------------------------------------------------------------- A3
A3C <- c("has_pred", "raw", "raw_unc", "flow_bin", "flow_state", "rst", "rate", "stop", "nonconverged", "lookup_fail",
         "it", "travel_por_gf", "travel_gf_lf", "b_active", "delta_on", "pct", "base_rst", "base_stop", "base_flow_bin",
         "base_flow_state", "truth_basehz", "truth_basehz_tick", "truth_own", "truth_own_tick")
a3f_by <- vapply(A3C, function(c) sum(S[[c]] != M[[c]]), 0)
if (sum(a3f_by) > 0) { print(a3f_by[a3f_by > 0]); msg("A3 first mismatching ticks:"); print(head(S$tick_utc[Reduce(`|`, lapply(A3C, function(c) S[[c]] != M[[c]]))], 5)) }
check("A3", N_TICKS * length(A3C), sum(a3f_by))

# ---------------------------------------------------------------- A4
first_val <- min(which(S$validated == "1"), which(M$validated == "1"))
pre <- seq_len(first_val - 1)
cols_ns <- setdiff(names(S), "slot")
a4f_by <- vapply(cols_ns, function(c) sum(S[[c]][pre] != M[[c]][pre]), 0)
if (sum(a4f_by) > 0) print(a4f_by[a4f_by > 0])
slot_bad <- sum(ifelse(M$has_pred == "1", M$slot != "stored", !(M$slot %in% c("", "no_prediction"))))
msg("A4 first validated tick:", S$tick_utc[first_val], "index", first_val)
check("A4", length(pre) * length(cols_ns) + N_TICKS, sum(a4f_by) + slot_bad)

# ---------------------------------------------------------------- A5
D8 <- which(S$tick_utc == "2026-11-09T12:00:00.000Z")
a5 <- 0L; a5n <- 0L
for (X in list(S, M)) {
  a5n <- a5n + 1L
  if (!(length(D8) == 1 && X$mask[D8] == "1" && X$normal[D8] == "1" && X$rl_event[D8] == "" &&
        X$rlx_event[D8] == "" && X$rec_event[D8] == "")) a5 <- a5 + 1L
}
mask_file <- S$mask                    # as written (equal in both files by A2)
mask_a5 <- mask_file; mask_a5[D8] <- "0"
lab <- S$rl_event != "" | S$rlx_event != "" | S$rec_event != ""
lab_m <- M$rl_event != "" | M$rlx_event != "" | M$rec_event != ""
TT_LIM <- as.numeric(as.POSIXct("2026-11-09 23:00:00", tz = "UTC")) * 1000
tt_s <- tparse(S$truth_tick_utc[lab & S$truth_tick_utc != ""]); tt_m <- tparse(M$truth_tick_utc[lab_m & M$truth_tick_utc != ""])
n_after <- sum(is.na(tt_s) | tt_s > TT_LIM) + sum(is.na(tt_m) | tt_m > TT_LIM)
check("A5", a5n + sum(lab & S$truth_tick_utc != "") + sum(lab_m & M$truth_tick_utc != ""), a5 + n_after)

# ---------------------------------------------------------------- shared numeric helpers
num <- function(x) { y <- suppressWarnings(as.numeric(x)); y[x == ""] <- NA_real_; bad <- is.na(y) & x != ""; if (any(bad)) stop("unparseable number: ", x[bad][1]); y }
lfq <- num(S$lf_view)
lf_valid <- !(is.na(lfq) | lfq == 0 | lfq < 500 | lfq > 500000)
# next tick index (>= i) with a valid LF
nextValid <- rep(NA_integer_, N_TICKS + 1)
for (i in N_TICKS:1) nextValid[i] <- if (lf_valid[i]) i else nextValid[i + 1]
due_of <- function(X, s) {
  travel <- num(X$travel_gf_lf[s])
  if (anyNA(travel)) stop("missing travel_gf_lf at a stored tick")
  trunc(t_ms[s] + travel * 60 * 60 * 1000)
}
first_due_idx <- function(due) {
  j <- ceiling((due - T0_MS) / 3600000) + 1
  j <- pmax(j, 1)
  ok <- j <= N_TICKS
  jj <- j[ok]
  stopifnot(all(t_ms[jj] >= due[ok]), all(jj == 1 | t_ms[pmax(jj - 1, 1)] < due[ok]))
  j[!ok] <- NA; as.integer(j)
}
WIN <- 9000000

# ---------------------------------------------------------------- A6 single chain
Sset <- which(S$slot == "stored")
stopifnot(all(S$has_pred[Sset] == "1"))
dueS <- due_of(S, Sset)
Vs <- which(S$validated == "1")
k <- findInterval(Vs - 1, Sset)            # index into Sset of the latest store strictly before v
a6f_cons <- 0L
s_of_v <- rep(NA_integer_, length(Vs))
for (i in seq_along(Vs)) {
  if (k[i] == 0) { a6f_cons <- a6f_cons + 1L; next }
  s_of_v[i] <- Sset[k[i]]; d <- dueS[k[i]]; v <- Vs[i]
  if (!(t_ms[v] >= d && t_ms[v] - d <= WIN)) a6f_cons <- a6f_cons + 1L
}
match_s_at <- rep(NA_integer_, N_TICKS); match_s_at[Vs] <- s_of_v
j0 <- first_due_idx(dueS)
vstar <- ifelse(is.na(j0), NA_integer_, nextValid[pmax(j0, 1)])
appl <- !is.na(vstar) & (t_ms[pmax(vstar, 1)] - dueS) <= WIN
ok_c <- S$validated[vstar[appl]] == "1" & !is.na(match_s_at[vstar[appl]]) & match_s_at[vstar[appl]] == Sset[appl]
a6f_comp <- sum(!(ok_c %in% TRUE))
msg("A6: validations", length(Vs), "consistency fails", a6f_cons, "completeness applicable", sum(appl), "fails", a6f_comp,
    "| s matched twice:", sum(duplicated(s_of_v[!is.na(s_of_v)])))
if (a6f_comp > 0) { bad <- which(appl)[!(ok_c %in% TRUE)]; print(head(S$tick_utc[Sset[bad]])) }
check("A6", length(Vs) + sum(appl), a6f_cons + a6f_comp)
add("check", "A6", "single", "all", "n_validations", "", length(Vs))
pairs_s <- data.frame(s = s_of_v, v = Vs)

# ---------------------------------------------------------------- A7 multi chain
Pm <- which(M$has_pred == "1")
dueM <- due_of(M, Pm)
j0m <- first_due_idx(dueM)
vm <- ifelse(is.na(j0m), NA_integer_, nextValid[pmax(j0m, 1)])
valm <- !is.na(vm) & (t_ms[pmax(vm, 1)] - dueM) <= WIN
pairs_m <- data.frame(s = Pm[valm], v = vm[valm])
n_val <- tabulate(pairs_m$v, nbins = N_TICKS)
rec_set <- which(n_val > 0); file_set <- which(M$validated == "1")
a7f <- length(setdiff(rec_set, file_set)) + length(setdiff(file_set, rec_set))
msg("A7: pendings", length(Pm), "validations", nrow(pairs_m), "dropped(missed window)", sum(!is.na(vm) & !valm),
    "never-reached", sum(is.na(vm)), "ticks with val", length(rec_set), "file", length(file_set))
if (a7f > 0) { print(head(S$tick_utc[setdiff(rec_set, file_set)])); print(head(S$tick_utc[setdiff(file_set, rec_set)])) }
check("A7", length(union(rec_set, file_set)), a7f)
add("check", "A7", "multi", "all", "n_validations", "", nrow(pairs_m))
multi_v_of_s <- rep(NA_integer_, N_TICKS); multi_v_of_s[pairs_m$s] <- pairs_m$v

# ---------------------------------------------------------------- A8
okp <- !is.na(pairs_s$s) & !is.na(multi_v_of_s[pairs_s$s]) & multi_v_of_s[pairs_s$s] == pairs_s$v
a8f <- sum(!(okp %in% TRUE)) + sum(S$hard_flag[pairs_s$v] != M$hard_flag[pairs_s$v])

# events (needed for the A8 corollary)
EV <- read_csv(F_EVENTS, col_types = cols(.default = col_character()), na = character(), progress = FALSE)
EV <- EV[EV$event_row == "1" & EV$kept == "1", ]
ptime <- function(x) as.numeric(as.POSIXct(x, format = "%Y-%m-%d %H:%M", tz = "UTC")) * 1000
EV$id <- as.integer(EV$event_id)
EV$t0 <- ptime(EV$event_t0); EV$tp <- ptime(EV$event_tp); EV$tend <- ptime(EV$event_tend); EV$r <- ptime(EV$rl_start)
G <- EV[EV$event_class == "GATE", ]; G <- G[order(G$t0), ]
STR <- EV[EV$event_class == "STRATUM", ]
stopifnot(nrow(G) == 21, nrow(STR) == 15, sum(G$oct == "1") == 1, G$id[G$oct == "1"] == 53,
          !anyNA(c(G$t0, G$tp, G$tend, G$r)))
GID <- G$id; HOLD <- c(47L, 48L, 49L, 51L); stopifnot(all(sort(G$id[G$holdout == "1"]) == HOLD))

hardS <- S$hard_flag == "1"; hardM <- M$hard_flag == "1"
rl_id <- suppressWarnings(as.integer(S$rl_event)); rlx_id <- suppressWarnings(as.integer(S$rlx_event)); rec_id <- suppressWarnings(as.integer(S$rec_event))
resp <- function(pairs, hard) {
  lapply(seq_len(nrow(G)), function(i) {
    r <- G$r[i]; te <- G$tend[i]
    ok <- t_ms[pairs$s] >= r & t_ms[pairs$v] <= te & !hard[pairs$v]
    p <- pairs[ok, , drop = FALSE]
    v1 <- if (nrow(p)) min(p$v) else NA_integer_
    list(D = if (is.na(v1)) Inf else (t_ms[v1] - r) / 3600000,
         v1 = v1, K = sum(rl_id[p$v] %in% G$id[i]), pairs = p)
  })
}
RESP_S <- resp(pairs_s, hardS); RESP_M <- resp(pairs_m, hardM)
D_s <- vapply(RESP_S, `[[`, 0, "D"); D_m <- vapply(RESP_M, `[[`, 0, "D")
a8c <- sum(is.finite(D_s) & is.infinite(D_m))
check("A8", nrow(pairs_s) * 2 + nrow(G), a8f + a8c)

# ---------------------------------------------------------------- A9
cb <- S$ceiling_applied == "1" & M$ceiling_applied == "1"
check("A9", sum(cb), sum(S$disp[cb] != M$disp[cb]))

# ---------------------------------------------------------------- BAND
ci_lines <- readLines(F_CI)
ci_lines <- ci_lines[grepl("^\\s*'[0-9+-]+'\\s*:\\s*\\{", ci_lines)]
CI <- list()
for (ln in ci_lines) {
  bin <- sub("^\\s*'([^']+)'.*$", "\\1", ln)
  for (st in c("rising", "steady", "falling", "all")) {
    m <- regmatches(ln, regexec(paste0(st, ":\\s*\\{\\s*q05:\\s*(-?[0-9]+),\\s*q95:\\s*(-?[0-9]+)\\s*\\}"), ln))[[1]]
    CI[[paste(bin, st, sep = "|")]] <- c(q05 = as.numeric(m[2]), q95 = as.numeric(m[3]))
  }
}
stopifnot(length(CI) == 24, !anyNA(unlist(CI)))
BINS <- unique(sub("\\|.*", "", names(CI)))
band <- function(disp, bin, st) {   # returns lo, hi (NA where bandFor returns null)
  st2 <- ifelse(st %in% c("rising", "steady", "falling"), st, "all")
  key <- paste(bin, st2, sep = "|")
  okb <- bin %in% BINS & is.finite(disp)
  q05 <- q95 <- rep(NA_real_, length(disp))
  q05[okb] <- vapply(CI[key[okb]], `[`, 0, "q05"); q95[okb] <- vapply(CI[key[okb]], `[`, 0, "q95")
  jsround <- function(x) floor(x + 0.5)
  list(lo = pmax(0, jsround(disp - q95)), hi = jsround(disp - q05))
}
scored <- S$in_scoring == "1" & mask_a5 == "1" & S$has_pred == "1"
scored_edge <- S$in_scoring == "1" & mask_file == "1" & S$has_pred == "1"
truth <- num(S$truth)
disp_s <- num(S$disp); disp_m <- num(M$disp)
B_s <- band(disp_s, S$flow_bin, S$flow_state); B_m <- band(disp_m, M$flow_bin, M$flow_state)
sc_any <- scored | scored_edge
nb <- sum(is.na(B_s$lo[sc_any]) | is.na(B_s$hi[sc_any])) + sum(is.na(B_m$lo[sc_any]) | is.na(B_m$hi[sc_any]))
check("BAND", 2 * sum(sc_any), nb)

# ---------------------------------------------------------------- T80 (check row)
T80_STR <- "2024-01-26T14:00:00.000Z"
t80_idx <- floor(8 * n_insc / 10)
t80_ms <- as.numeric(as.POSIXct("2012-12-01 00:00:00", tz = "UTC")) * 1000 + t80_idx * 3600000
stopifnot(t80_idx == 97766, format(as.POSIXct(t80_ms / 1000, origin = "1970-01-01", tz = "UTC"), "%Y-%m-%dT%H:%M:%S.000Z") == T80_STR)
add("check", "N3", "both", "NORM_T80", "t80_index", T80_STR, as.integer(t80_idx))

ALLPASS <- all(vapply(CHECK, function(x) x[["n_fail"]] == 0, TRUE))
if (!ALLPASS) {
  msg("ASSERTION FAILURE -> STOP (no P-MECH, no metric)")
  if (!ASSERT_ONLY) write_rows()
  quit(status = 2)
}

# ---------------------------------------------------------------- P-MECH
dD <- ifelse(is.infinite(D_s) & is.infinite(D_m), 0, D_s - D_m)
K_s <- vapply(RESP_S, `[[`, 0L, "K"); K_m <- vapply(RESP_M, `[[`, 0L, "K")
med_dD <- sort(dD)[11]
K_ratio <- if (sum(K_s) == 0) { if (sum(K_m) > 0) Inf else NA_real_ } else sum(K_m) / sum(K_s)
pmech <- isTRUE(med_dD > 0) && isTRUE(K_ratio > 1.5)
add("check", "PMECH", "both", "RL21", "median_dD_h", "", med_dD)
add("check", "PMECH", "single", "RL21", "sum_K", "", as.integer(sum(K_s)))
add("check", "PMECH", "multi", "RL21", "sum_K", "", as.integer(sum(K_m)))
add("check", "PMECH", "both", "RL21", "K_ratio", "", K_ratio)
add("check", "PMECH", "both", "RL21", "pass", "", as.integer(pmech))
msg("PMECH", if (pmech) "PASS" else "FAIL")

# RESP report rows (reported in all cases, plan section 3)
D_t0_s <- ifelse(is.na(vapply(RESP_S, `[[`, 0L, "v1")), Inf, (t_ms[vapply(RESP_S, `[[`, 0L, "v1")] - G$t0) / 3600000)
D_t0_m <- ifelse(is.na(vapply(RESP_M, `[[`, 0L, "v1")), Inf, (t_ms[vapply(RESP_M, `[[`, 0L, "v1")] - G$t0) / 3600000)
emit_resp <- function() {
  for (i in seq_len(nrow(G))) {
    id <- G$id[i]
    add("report", "RESP", "single", "RLev", "D_h", id, D_s[i]); add("report", "RESP", "multi", "RLev", "D_h", id, D_m[i])
    add("report", "RESP", "diff", "RLev", "dD_h", id, dD[i])
    add("report", "RESP", "single", "RLev", "K", id, as.integer(K_s[i])); add("report", "RESP", "multi", "RLev", "K", id, as.integer(K_m[i]))
    add("report", "RESP", "single", "RLev", "D_t0_h", id, D_t0_s[i]); add("report", "RESP", "multi", "RLev", "D_t0_h", id, D_t0_m[i])
  }
  io <- which(G$id == 53)
  before_t0 <- which(t_ms < G$t0[io] & !is.na(lfq) & lfq < 3000)
  ref <- max(before_t0) + 1L
  for (md in c("single", "multi")) {
    v1 <- if (md == "single") RESP_S[[io]]$v1 else RESP_M[[io]]$v1
    add("report", "RESP", md, "RLev", "D_lf3000_h", 53, if (is.na(v1)) Inf else (t_ms[v1] - t_ms[ref]) / 3600000)
  }
  msg("October LF<3000 reference tick:", S$tick_utc[ref])
}
emit_resp()

if (ASSERT_ONLY) { msg("assert-only mode: stopping after checks (nothing written)"); quit(status = 0) }
if (!pmech) { msg("STOP-MECH: no gate metric computed"); write_rows(); quit(status = 3) }

# ================================================================ METRICS
e_s <- disp_s - truth; e_m <- disp_m - truth
u_s <- num(S$unc) - truth; u_m <- num(M$unc) - truth
stopifnot(!anyNA(e_s[scored]), !anyNA(e_m[scored]), !anyNA(u_s[scored]), !anyNA(u_m[scored]), all(truth[scored] > 0))
pct_s <- 100 * e_s / truth; pct_m <- 100 * e_m / truth
upct_s <- 100 * u_s / truth; upct_m <- 100 * u_m / truth
under_s <- pct_s <= -15; under_m <- pct_m <= -15
cov_s <- B_s$lo <= truth & truth <= B_s$hi; cov_m <- B_m$lo <= truth & truth <= B_m$hi
cap_s <- S$ceiling_applied == "1"; cap_m <- M$ceiling_applied == "1"
normal <- S$normal == "1"
cell <- paste(S$base_flow_bin, S$base_flow_state, sep = "|")
month <- substr(S$tick_utc, 1, 7)

RL <- scored & rl_id %in% GID
REC <- scored & rec_id %in% GID
NORM <- scored & normal
NORM_E <- scored_edge & normal
NORM_T80 <- NORM & t_ms >= t80_ms

gain <- function(idx, a = e_s, b = e_m) 1 - sum(abs(b[idx])) / sum(abs(a[idx]))
mae <- function(idx, e) if (sum(idx) == 0) NA_real_ else mean(abs(e[idx]))
q <- function(x) quantile(x, c(0.025, 0.975), type = 7, names = FALSE)

BOOT <- as.matrix(read.csv(F_BOOT, header = FALSE)) + 1L
stopifnot(dim(BOOT) == c(10000, 21), min(BOOT) >= 1, max(BOOT) <= 21)
MB <- as.matrix(read.csv(F_MBLK, header = FALSE)) + 1L
ML <- read.csv(F_MLIST, header = FALSE, colClasses = "character")
stopifnot(nrow(ML) == 168, all(as.integer(ML[[1]]) == 0:167), dim(MB) == c(10000, 168), min(MB) >= 1, max(MB) <= 168)
MONTHS <- ML[[2]]
# check month list = months with >= 1 scored normal tick (after A5)
stopifnot(identical(sort(unique(month[NORM])), MONTHS))
month_i <- match(month, MONTHS)

ev_sum <- function(idx, x) vapply(GID, function(id) sum(x[idx & rl_id %in% id]), 0)
ev_sum_rec <- function(idx, x) vapply(GID, function(id) sum(x[idx & rec_id %in% id]), 0)
bsum <- function(v) { m <- matrix(v[BOOT], nrow = nrow(BOOT)); rowSums(m) }

# ---- R2 (and U_R2)
r2_rows <- function(run, crit, es, em) {
  Ss <- ev_sum(RL, abs(es)); Sm <- ev_sum(RL, abs(em))
  pt <- 1 - sum(abs(em[RL])) / sum(abs(es[RL]))
  gb <- 1 - bsum(Sm) / bsum(Ss); ci <- q(gb)
  add(run, crit, "single", "RL21", "mae", "", mae(RL, es)); add(run, crit, "multi", "RL21", "mae", "", mae(RL, em))
  add(run, crit, "diff", "RL21", "point", "", pt); add(run, crit, "diff", "RL21", "ci_lo", "", ci[1]); add(run, crit, "diff", "RL21", "ci_hi", "", ci[2])
  add(run, crit, "both", "RL21", "n_ticks", "", sum(RL))
  p <- pt >= 0.05 && ci[1] > 0
  add(run, crit, "both", "RL21", "pass", "", as.integer(p)); p
}
GATE <- list()
GATE$R2 <- r2_rows("gate", "R2", e_s, e_m)

# ---- R3
Ss_ev <- ev_sum(RL, abs(e_s)); Sm_ev <- ev_sum(RL, abs(e_m)); impr <- Sm_ev < Ss_ev
for (i in seq_along(GID)) {
  add("gate", "R3", "single", "RLev", "sum_abs", GID[i], Ss_ev[i]); add("gate", "R3", "multi", "RLev", "sum_abs", GID[i], Sm_ev[i])
  add("gate", "R3", "diff", "RLev", "improved", GID[i], as.integer(impr[i]))
}
add("gate", "R3", "both", "RL21", "n_improved", "", sum(impr))
GATE$R3 <- sum(impr) * 100 >= 65 * 21
add("gate", "R3", "both", "RL21", "pass", "", as.integer(GATE$R3))

# ---- B1
RL20 <- RL & rl_id != 53L
b1 <- gain(RL20)
add("gate", "B1", "single", "RL20", "mae", "", mae(RL20, e_s)); add("gate", "B1", "multi", "RL20", "mae", "", mae(RL20, e_m))
add("gate", "B1", "diff", "RL20", "point", "", b1); add("gate", "B1", "both", "RL20", "n_ticks", "", sum(RL20))
GATE$B1 <- b1 > 0; add("gate", "B1", "both", "RL20", "pass", "", as.integer(GATE$B1))

# ---- B2
b2 <- vapply(GID, function(id) gain(RL & rl_id != id), 0)
for (i in seq_along(GID)) add("gate", "B2", "diff", "RLdrop", "point", GID[i], b2[i])
add("gate", "B2", "diff", "RLdrop", "min_point", "", min(b2))
GATE$B2 <- all(b2 > 0); add("gate", "B2", "both", "RLdrop", "pass", "", as.integer(GATE$B2))

# ---- B3
RLH <- RL & rl_id %in% HOLD
b3 <- gain(RLH)
add("gate", "B3", "single", "RLH", "mae", "", mae(RLH, e_s)); add("gate", "B3", "multi", "RLH", "mae", "", mae(RLH, e_m))
add("gate", "B3", "diff", "RLH", "point", "", b3); add("gate", "B3", "both", "RLH", "n_ticks", "", sum(RLH))
GATE$B3 <- b3 > 0; add("gate", "B3", "both", "RLH", "pass", "", as.integer(GATE$B3))

# ---- N1 / N2 (and edge versions)
month_sums <- function(idx, x) { s <- numeric(168); a <- tapply(x[idx], month_i[idx], sum); s[as.integer(names(a))] <- a; s }
mb_sum <- function(v) rowSums(matrix(v[MB], nrow = nrow(MB)))
CELLS <- local({ tb <- table(cell[NORM]); sort(names(tb)[tb >= 200]) })
n1n2 <- function(run, c1, c2, NM) {
  stopifnot(all(!is.na(month_i[NM])))
  ms <- month_sums(NM, abs(e_s)); mm <- month_sums(NM, abs(e_m))
  bs <- mb_sum(ms); bm <- mb_sum(mm); use <- bs > 0
  rel <- bm[use] / bs[use] - 1; ci <- q(rel)
  pt <- sum(abs(e_m[NM])) / sum(abs(e_s[NM])) - 1
  add(run, c1, "single", "NORM", "mae", "", mae(NM, e_s)); add(run, c1, "multi", "NORM", "mae", "", mae(NM, e_m))
  add(run, c1, "diff", "NORM", "point", "", pt); add(run, c1, "diff", "NORM", "ci_lo", "", ci[1]); add(run, c1, "diff", "NORM", "ci_hi", "", ci[2])
  add(run, c1, "both", "NORM", "n_ticks", "", sum(NM)); add(run, c1, "both", "NORM", "n_res_used", "", sum(use))
  p1 <- pt <= 0.01 && ci[2] <= 0.02
  add(run, c1, "both", "NORM", "pass", "", as.integer(p1))
  nfailc <- 0L
  for (cl in CELLS) {
    ix <- NM & cell == cl
    cs <- month_sums(ix, abs(e_s)); cm <- month_sums(ix, abs(e_m)); cn <- month_sums(ix, rep(1, N_TICKS))
    bs <- mb_sum(cs); bm <- mb_sum(cm); bn <- mb_sum(cn)
    keep <- bn > 0 & bs > 0
    ci <- q(bm[keep] / bs[keep] - 1)
    pt <- sum(abs(e_m[ix])) / sum(abs(e_s[ix])) - 1
    n <- sum(ix)
    cf <- (pt > 0.03 && ci[1] > 0) || (pt > 0.05 && n >= 2000)
    nfailc <- nfailc + cf
    add(run, c2, "both", "NORMcell", "n_ticks", cl, n)
    add(run, c2, "single", "NORMcell", "mae", cl, mae(ix, e_s)); add(run, c2, "multi", "NORMcell", "mae", cl, mae(ix, e_m))
    add(run, c2, "diff", "NORMcell", "point", cl, pt); add(run, c2, "diff", "NORMcell", "ci_lo", cl, ci[1]); add(run, c2, "diff", "NORMcell", "ci_hi", cl, ci[2])
    add(run, c2, "both", "NORMcell", "n_res_dropped", cl, sum(!keep)); add(run, c2, "both", "NORMcell", "cell_fail", cl, as.integer(cf))
  }
  add(run, c2, "both", "NORMcell", "n_cells", "", length(CELLS)); add(run, c2, "both", "NORMcell", "n_cells_failed", "", nfailc)
  add(run, c2, "both", "NORMcell", "pass", "", as.integer(nfailc == 0))
  c(p1, nfailc == 0)
}
nn <- n1n2("gate", "N1", "N2", NORM); GATE$N1 <- nn[1]; GATE$N2 <- nn[2]
invisible(n1n2("edge", "N1_edge", "N2_edge", NORM_E))
{ tbE <- table(cell[NORM_E]); msg("edge cell set equals A5 cell set:", identical(sort(names(tbE)[tbE >= 200]), CELLS)) }

# ---- N3
n3 <- sum(abs(e_m[NORM_T80])) / sum(abs(e_s[NORM_T80])) - 1
add("gate", "N3", "single", "NORM_T80", "mae", "", mae(NORM_T80, e_s)); add("gate", "N3", "multi", "NORM_T80", "mae", "", mae(NORM_T80, e_m))
add("gate", "N3", "diff", "NORM_T80", "point", "", n3); add("gate", "N3", "both", "NORM_T80", "n_ticks", "", sum(NORM_T80))
GATE$N3 <- n3 <= 0.02; add("gate", "N3", "both", "NORM_T80", "pass", "", as.integer(GATE$N3))

# ---- D1 (and U_D1)
d1_rows <- function(run, crit, ps, pm, point_only = FALSE) {
  bs <- mean(ps[REC]); bm <- mean(pm[REC]); pt <- abs(bm) - abs(bs)
  add(run, crit, "single", "REC21", "bias_pp", "", bs); add(run, crit, "multi", "REC21", "bias_pp", "", bm)
  add(run, crit, "diff", "REC21", "point", "", pt)
  if (point_only) { add(run, crit, "both", "REC21", "n_ticks", "", sum(REC)); return(invisible(NULL)) }
  Ss <- ev_sum_rec(REC, ps); Sm <- ev_sum_rec(REC, pm); Sn <- ev_sum_rec(REC, rep(1, N_TICKS))
  ns <- bsum(Sn); keep <- ns > 0
  db <- abs(bsum(Sm)[keep] / ns[keep]) - abs(bsum(Ss)[keep] / ns[keep]); ci <- q(db)
  add(run, crit, "diff", "REC21", "ci_lo", "", ci[1]); add(run, crit, "diff", "REC21", "ci_hi", "", ci[2])
  add(run, crit, "both", "REC21", "n_ticks", "", sum(REC)); add(run, crit, "both", "REC21", "n_res_dropped", "", sum(!keep))
  p <- pt <= 0.5 && ci[2] <= 1.0
  add(run, crit, "both", "REC21", "pass", "", as.integer(p)); p
}
GATE$D1 <- d1_rows("gate", "D1", pct_s, pct_m)

# ---- C1-C3
cov_rows <- function(crit, sub, idx, rule) {
  n <- sum(idx); cs <- sum(cov_s[idx]); cm <- sum(cov_m[idx])
  add("gate", crit, "single", sub, "cov", "", cs / n); add("gate", crit, "multi", sub, "cov", "", cm / n)
  add("gate", crit, "both", sub, "n_ticks", "", n)
  p <- rule(cs, cm, n); add("gate", crit, "both", sub, "pass", "", as.integer(p)); p
}
GATE$C1 <- cov_rows("C1", "NORM", NORM, function(cs, cm, n) abs(100 * cm - 90 * n) <= max(4 * n, abs(100 * cs - 90 * n)))
GATE$C2 <- cov_rows("C2", "RL21", RL, function(cs, cm, n) 100 * cm >= 100 * cs - 2 * n)
GATE$C3 <- cov_rows("C3", "REC21", REC, function(cs, cm, n) 100 * cm >= 100 * cs - 2 * n)

# ---- S1, S2
s_rows <- function(crit, sub, idx, evs) {
  n <- sum(idx); Us <- sum(under_s[idx]); Um <- sum(under_m[idx])
  add("gate", crit, "single", sub, "share", "", Us / n); add("gate", crit, "multi", sub, "share", "", Um / n)
  add("gate", crit, "diff", sub, "point", "", (Um - Us) / n)
  es <- evs(idx, as.numeric(under_s)); em <- evs(idx, as.numeric(under_m)); en <- evs(idx, rep(1, N_TICKS))
  nb <- bsum(en); keep <- nb > 0
  ci <- q((bsum(em)[keep] - bsum(es)[keep]) / nb[keep])
  add("gate", crit, "diff", sub, "ci_lo", "", ci[1]); add("gate", crit, "diff", sub, "ci_hi", "", ci[2])
  add("gate", crit, "both", sub, "n_res_dropped", "", sum(!keep))
  p <- (100 * (Um - Us) <= n) && ci[2] <= 0.030
  add("gate", crit, "both", sub, "pass", "", as.integer(p)); p
}
GATE$S1 <- s_rows("S1", "RL21", RL, ev_sum)
GATE$S2 <- s_rows("S2", "REC21", REC, ev_sum_rec)

stopifnot(length(GATE) == 14)
add("gate", "GATE", "both", "all", "n_rows_pass", "", sum(unlist(GATE)))
add("gate", "GATE", "both", "all", "pass", "", as.integer(all(unlist(GATE))))

# ================================================================ REPORT
invisible(r2_rows("report", "U_R2", u_s, u_m))
d1_rows("report", "U_D1", upct_s, upct_m, point_only = TRUE)

simple3 <- function(crit, sub, idx) {
  add("report", crit, "single", sub, "mae", "", mae(idx, e_s)); add("report", crit, "multi", sub, "mae", "", mae(idx, e_m))
  add("report", crit, "diff", sub, "point", "", gain(idx))
}
simple3("RLX", "RLX21", scored & rlx_id %in% GID)
t0_of <- setNames(G$t0, G$id)
F24 <- RL & !is.na(rl_id) & t_ms >= ifelse(is.na(rl_id), Inf, t0_of[as.character(rl_id)])
simple3("F24", "F24_21", F24)
RLS <- scored & rl_id %in% STR$id
simple3("STR", "RLstr15", RLS)
add("report", "STR", "both", "RLstr15", "n_improved", "",
    sum(vapply(STR$id, function(id) sum(abs(e_m[RLS & rl_id == id])) < sum(abs(e_s[RLS & rl_id == id])), TRUE)))

for (id in GID) {
  ix <- RL & rl_id == id
  add("report", "EV", "single", "RLev", "mae", id, mae(ix, e_s)); add("report", "EV", "multi", "RLev", "mae", id, mae(ix, e_m))
  add("report", "EV", "diff", "RLev", "point", id, gain(ix)); add("report", "EV", "both", "RLev", "n_ticks", id, sum(ix))
}

# SPLIT at v1_e (first multi event-created learned validation)
v1m <- vapply(RESP_M, `[[`, 0L, "v1")
v1_ms <- setNames(ifelse(is.na(v1m), Inf, t_ms[pmax(v1m, 1)]), G$id)
v1_tick <- ifelse(is.na(rl_id), NA_real_, v1_ms[as.character(rl_id)])
BEF <- RL & t_ms < v1_tick; AFT <- RL & t_ms >= v1_tick
split_rows <- function(key, ib, ia) {
  add("report", "SPLIT", "single", "RLbefore", "mae", key, mae(ib, e_s)); add("report", "SPLIT", "multi", "RLbefore", "mae", key, mae(ib, e_m))
  add("report", "SPLIT", "single", "RLafter", "mae", key, mae(ia, e_s)); add("report", "SPLIT", "multi", "RLafter", "mae", key, mae(ia, e_m))
  add("report", "SPLIT", "both", "RLbefore", "n_ticks", key, sum(ib)); add("report", "SPLIT", "both", "RLafter", "n_ticks", key, sum(ia))
}
for (id in GID) split_rows(id, BEF & rl_id == id, AFT & rl_id == id)
split_rows("", BEF, AFT)
stopifnot(sum(BEF) + sum(AFT) == sum(RL))

for (sb in list(list("RL21", RL), list("REC21", REC), list("NORM", NORM))) {
  add("report", "CAP", "single", sb[[1]], "cap_rate", "", mean(cap_s[sb[[2]]])); add("report", "CAP", "multi", sb[[1]], "cap_rate", "", mean(cap_m[sb[[2]]]))
}
for (cc in list(list("cap_both", cap_s & cap_m), list("cap_single_only", cap_s & !cap_m),
                list("cap_multi_only", !cap_s & cap_m), list("cap_neither", !cap_s & !cap_m))) {
  ix <- RL & cc[[2]]
  add("report", "CAP4", "both", cc[[1]], "n_ticks", "", sum(ix))
  add("report", "CAP4", "single", cc[[1]], "mae", "", mae(ix, e_s)); add("report", "CAP4", "multi", cc[[1]], "mae", "", mae(ix, e_m))
  add("report", "CAP4", "single", cc[[1]], "mean_signed", "", if (sum(ix)) mean(e_s[ix]) else NA_real_)
  add("report", "CAP4", "multi", cc[[1]], "mean_signed", "", if (sum(ix)) mean(e_m[ix]) else NA_real_)
}
for (cl in CELLS) {
  ix <- NORM & cell == cl
  add("report", "CELLCOV", "single", "NORMcell", "cov", cl, mean(cov_s[ix])); add("report", "CELLCOV", "multi", "NORMcell", "cov", cl, mean(cov_m[ix]))
}
for (sb in list(list("RL21", RL), list("REC21", REC), list("NORM", NORM))) {
  add("report", "BIAS", "single", sb[[1]], "mean_signed", "", mean(e_s[sb[[2]]])); add("report", "BIAS", "multi", sb[[1]], "mean_signed", "", mean(e_m[sb[[2]]]))
}
for (sb in list(list("RL21", RL), list("REC21", REC))) {
  ix <- sb[[2]]
  add("report", "UR", "single", sb[[1]], "mean_signed_under", "", if (sum(ix & under_s)) mean(e_s[ix & under_s]) else NA_real_)
  add("report", "UR", "multi", sb[[1]], "mean_signed_under", "", if (sum(ix & under_m)) mean(e_m[ix & under_m]) else NA_real_)
}
for (id in GID) {
  ix <- RL & rl_id == id
  add("report", "UR", "single", "RLev", "worst_pct", id, min(pct_s[ix])); add("report", "UR", "multi", "RLev", "worst_pct", id, min(pct_m[ix]))
}
INS <- S$in_scoring == "1"
for (md in list(list("single", S), list("multi", M))) {
  X <- md[[2]]
  add("report", "FLAGS", md[[1]], "SCORING", "n_validated_ticks", "", sum(INS & X$validated == "1"))
  add("report", "FLAGS", md[[1]], "SCORING", "n_hard_ticks", "", sum(INS & X$hard_flag == "1"))
  add("report", "FLAGS", md[[1]], "SCORING", "n_soft_ticks", "", sum(INS & X$soft_flag == "1"))
}
vt <- tabulate(n_val[INS] + 1L)
for (k in seq_along(vt) - 1L) add("report", "VPT", "multi", "SCORING", "n_ticks_with_nval", k, vt[k + 1])

# BINM: per scored RL tick, event-created learned validations with v <= tick whose (flow_bin, flow_state) at s == tick's own
binm <- function(RESP, X) {
  key <- paste(X$flow_bin, X$flow_state, sep = "|")
  tot <- 0; n <- 0
  for (i in seq_along(GID)) {
    p <- RESP[[i]]$pairs; ticks <- which(RL & rl_id == GID[i])
    for (t in ticks) { tot <- tot + sum(p$v <= t & key[p$s] == key[t]); n <- n + 1 }
  }
  tot / n
}
add("report", "BINM", "single", "RL21", "mean_matched", "", binm(RESP_S, S))
add("report", "BINM", "multi", "RL21", "mean_matched", "", binm(RESP_M, M))

# REP_START (section 16b)
Le <- vapply(seq_along(GID), function(i) {
  r_idx <- which(t_ms == G$r[i])
  if (length(r_idx) == 1 && !is.na(lfq[r_idx])) return(lfq[r_idx])
  w <- which(rl_id == GID[i] & t_ms > G$r[i] & !is.na(lfq))
  if (length(w)) lfq[min(w)] else NA_real_
}, 0)
stopifnot(!anyNA(Le))
for (grp in c("RL_lowstart", "RL_highstart")) {
  ids <- if (grp == "RL_lowstart") GID[Le < 3000] else GID[Le >= 3000]
  ix <- RL & rl_id %in% ids
  add("report", "REP_START", "both", grp, "n_events", "", length(ids))
  add("report", "REP_START", "both", grp, "n_ticks", "", sum(ix))
  add("report", "REP_START", "multi", grp, "mae_multi", "", mae(ix, e_m))
  add("report", "REP_START", "single", grp, "mae_single", "", mae(ix, e_s))
  add("report", "REP_START", "diff", grp, "gain", "", if (sum(ix)) gain(ix) else NA_real_)
  add("report", "REP_START", "both", grp, "improved", "", sum(impr[GID %in% ids]))
  for (id in ids) add("report", "REP_START", "both", grp, "start_lf", id, Le[GID == id])
}

out <- write_rows()

# ---------------------------------------------------------------- self-check of required rows
req <- list()
R <- function(run, crit, mode, sub, stat, key = "") req[[length(req) + 1]] <<- c(run, crit, mode, sub, stat, key)
for (a in c(paste0("A", 0:9), "BAND")) for (st in c("n_checked", "n_fail", "pass")) R("check", a, "both", "all", st)
R("check", "A6", "single", "all", "n_validations"); R("check", "A7", "multi", "all", "n_validations")
R("check", "A1", "both", "all", "n_in_scoring"); R("check", "N3", "both", "NORM_T80", "t80_index", T80_STR)
R("check", "PMECH", "both", "RL21", "median_dD_h"); R("check", "PMECH", "single", "RL21", "sum_K"); R("check", "PMECH", "multi", "RL21", "sum_K")
R("check", "PMECH", "both", "RL21", "K_ratio"); R("check", "PMECH", "both", "RL21", "pass")
r2req <- function(run, cr) { R(run, cr, "single", "RL21", "mae"); R(run, cr, "multi", "RL21", "mae"); for (s in c("point", "ci_lo", "ci_hi")) R(run, cr, "diff", "RL21", s); R(run, cr, "both", "RL21", "n_ticks"); R(run, cr, "both", "RL21", "pass") }
r2req("gate", "R2")
for (id in GID) { R("gate", "R3", "single", "RLev", "sum_abs", id); R("gate", "R3", "multi", "RLev", "sum_abs", id); R("gate", "R3", "diff", "RLev", "improved", id) }
R("gate", "R3", "both", "RL21", "n_improved"); R("gate", "R3", "both", "RL21", "pass")
for (cs in list(c("B1", "RL20"), c("B3", "RLH"))) { R("gate", cs[1], "single", cs[2], "mae"); R("gate", cs[1], "multi", cs[2], "mae"); R("gate", cs[1], "diff", cs[2], "point"); R("gate", cs[1], "both", cs[2], "n_ticks"); R("gate", cs[1], "both", cs[2], "pass") }
for (id in GID) R("gate", "B2", "diff", "RLdrop", "point", id); R("gate", "B2", "diff", "RLdrop", "min_point"); R("gate", "B2", "both", "RLdrop", "pass")
nreq <- function(run, c1, c2) {
  R(run, c1, "single", "NORM", "mae"); R(run, c1, "multi", "NORM", "mae"); for (s in c("point", "ci_lo", "ci_hi")) R(run, c1, "diff", "NORM", s)
  for (s in c("n_ticks", "n_res_used", "pass")) R(run, c1, "both", "NORM", s)
  for (cl in CELLS) { R(run, c2, "both", "NORMcell", "n_ticks", cl); R(run, c2, "single", "NORMcell", "mae", cl); R(run, c2, "multi", "NORMcell", "mae", cl)
    for (s in c("point", "ci_lo", "ci_hi")) R(run, c2, "diff", "NORMcell", s, cl); R(run, c2, "both", "NORMcell", "n_res_dropped", cl); R(run, c2, "both", "NORMcell", "cell_fail", cl) }
  for (s in c("n_cells", "n_cells_failed", "pass")) R(run, c2, "both", "NORMcell", s)
}
nreq("gate", "N1", "N2"); nreq("edge", "N1_edge", "N2_edge")
R("gate", "N3", "single", "NORM_T80", "mae"); R("gate", "N3", "multi", "NORM_T80", "mae"); R("gate", "N3", "diff", "NORM_T80", "point"); R("gate", "N3", "both", "NORM_T80", "n_ticks"); R("gate", "N3", "both", "NORM_T80", "pass")
R("gate", "D1", "single", "REC21", "bias_pp"); R("gate", "D1", "multi", "REC21", "bias_pp"); for (s in c("point", "ci_lo", "ci_hi")) R("gate", "D1", "diff", "REC21", s)
for (s in c("n_ticks", "n_res_dropped", "pass")) R("gate", "D1", "both", "REC21", s)
for (cs in list(c("C1", "NORM"), c("C2", "RL21"), c("C3", "REC21"))) { R("gate", cs[1], "single", cs[2], "cov"); R("gate", cs[1], "multi", cs[2], "cov"); R("gate", cs[1], "both", cs[2], "n_ticks"); R("gate", cs[1], "both", cs[2], "pass") }
for (cs in list(c("S1", "RL21"), c("S2", "REC21"))) { R("gate", cs[1], "single", cs[2], "share"); R("gate", cs[1], "multi", cs[2], "share"); for (s in c("point", "ci_lo", "ci_hi")) R("gate", cs[1], "diff", cs[2], s); R("gate", cs[1], "both", cs[2], "n_res_dropped"); R("gate", cs[1], "both", cs[2], "pass") }
R("gate", "GATE", "both", "all", "n_rows_pass"); R("gate", "GATE", "both", "all", "pass")
r2req("report", "U_R2")
R("report", "U_D1", "single", "REC21", "bias_pp"); R("report", "U_D1", "multi", "REC21", "bias_pp"); R("report", "U_D1", "diff", "REC21", "point")
for (cs in list(c("RLX", "RLX21"), c("F24", "F24_21"), c("STR", "RLstr15"))) { R("report", cs[1], "single", cs[2], "mae"); R("report", cs[1], "multi", cs[2], "mae"); R("report", cs[1], "diff", cs[2], "point") }
R("report", "STR", "both", "RLstr15", "n_improved")
for (id in GID) { R("report", "EV", "single", "RLev", "mae", id); R("report", "EV", "multi", "RLev", "mae", id); R("report", "EV", "diff", "RLev", "point", id); R("report", "EV", "both", "RLev", "n_ticks", id) }
for (key in c(GID, "")) for (sb in c("RLbefore", "RLafter")) { R("report", "SPLIT", "single", sb, "mae", key); R("report", "SPLIT", "multi", sb, "mae", key); R("report", "SPLIT", "both", sb, "n_ticks", key) }
for (sb in c("RL21", "REC21", "NORM")) for (md in c("single", "multi")) { R("report", "CAP", md, sb, "cap_rate"); R("report", "BIAS", md, sb, "mean_signed") }
for (cc in c("cap_both", "cap_single_only", "cap_multi_only", "cap_neither")) { R("report", "CAP4", "both", cc, "n_ticks"); for (md in c("single", "multi")) { R("report", "CAP4", md, cc, "mae"); R("report", "CAP4", md, cc, "mean_signed") } }
for (cl in CELLS) for (md in c("single", "multi")) R("report", "CELLCOV", md, "NORMcell", "cov", cl)
for (md in c("single", "multi")) { for (sb in c("RL21", "REC21")) R("report", "UR", md, sb, "mean_signed_under"); for (id in GID) R("report", "UR", md, "RLev", "worst_pct", id)
  for (s in c("n_validated_ticks", "n_hard_ticks", "n_soft_ticks")) R("report", "FLAGS", md, "SCORING", s) }
for (k in seq_along(vt) - 1L) R("report", "VPT", "multi", "SCORING", "n_ticks_with_nval", k)
for (id in GID) { for (md in c("single", "multi")) { R("report", "RESP", md, "RLev", "D_h", id); R("report", "RESP", md, "RLev", "K", id); R("report", "RESP", md, "RLev", "D_t0_h", id) }; R("report", "RESP", "diff", "RLev", "dD_h", id) }
for (md in c("single", "multi")) { R("report", "RESP", md, "RLev", "D_lf3000_h", 53); R("report", "BINM", md, "RL21", "mean_matched") }
for (grp in c("RL_lowstart", "RL_highstart")) { R("report", "REP_START", "both", grp, "n_events"); R("report", "REP_START", "both", grp, "n_ticks")
  R("report", "REP_START", "multi", grp, "mae_multi"); R("report", "REP_START", "single", grp, "mae_single"); R("report", "REP_START", "diff", grp, "gain"); R("report", "REP_START", "both", grp, "improved") }
reqk <- vapply(req, paste, "", collapse = "\r")
outk <- do.call(paste, c(out[, c("run", "criterion", "mode", "subset", "stat", "key")], sep = "\r"))
missing <- setdiff(reqk, outk); dup <- outk[duplicated(outk)]
n_startlf <- sum(out$criterion == "REP_START" & out$stat == "start_lf")
msg("SELF-CHECK: required", length(reqk), "missing", length(missing), "duplicate keys", length(dup), "start_lf rows", n_startlf)
if (length(missing)) print(gsub("\r", " | ", head(missing, 20)))
if (length(dup)) print(gsub("\r", " | ", head(dup, 20)))
print(table(out$run))
if (length(missing) || length(dup) || n_startlf != 21) quit(status = 4)
msg("done")

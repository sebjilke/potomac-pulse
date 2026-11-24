# Blind R analyst, Stage 1: can water measured upstream improve the Great Falls forecast?
# Specification: ANALYSIS_SPEC.md version 1.2. Base R only. Run: Rscript r/run_all.R (from the study folder).

t_start <- Sys.time()
options(warn = 1, stringsAsFactors = FALSE, scipen = 999)
args_all <- commandArgs(FALSE)
fa <- sub("^--file=", "", args_all[grep("^--file=", args_all)])
script_dir <- dirname(normalizePath(fa[1]))
study <- normalizePath(file.path(script_dir, ".."))
OUT <- file.path(study, "r")
P <- function(...) file.path(study, ...)

fail <- function(msg) stop(msg, call. = FALSE)
HS <- c(6, 12, 24, 48)
STATUS <- c("ISSUE_NOT_PREDICTED", "ISSUE_LF_MISSING", "TARGET_NO_ROW", "TARGET_NOT_PREDICTED",
            "TARGET_TRUTH_MISSING", "TARGET_HARD_FLAG", "TARGET_OUT_OF_RANGE", "NO_TIMESHIFT",
            "ISSUE_FIELD_MISSING", "Q_USTAR_MISSING", "Q_ULF_MISSING", "Q_NONPOSITIVE", "SCORED")
ARMS <- c("P-LF", "R-LF", "R-LFm", "REF_NOW", "REF_HELD")
LEADS <- c("all", "inside", "beyond")

# ---------------------------------------------------------------- formatting helpers
f6 <- function(x) { o <- sprintf("%.6f", x); o[is.na(x)] <- ""; o }
fi <- function(x) { o <- sprintf("%.0f", x); o[is.na(x)] <- ""; o }
num <- function(x) suppressWarnings(as.numeric(x))   # "" -> NA

# ---------------------------------------------------------------- time keys
key_replay <- function(x) {
  out <- rep(NA_real_, length(x)); ok <- x != ""
  if (any(ok)) out[ok] <- as.numeric(as.POSIXct(substr(x[ok], 1, 13), format = "%Y-%m-%dT%H", tz = "UTC")) / 3600
  out
}
key_hourly <- function(x) {
  out <- rep(NA_real_, length(x)); ok <- x != ""
  if (any(ok)) out[ok] <- as.numeric(as.POSIXct(x[ok], format = "%Y-%m-%d %H:%M", tz = "UTC")) / 3600
  out
}
ts_fmt <- function(k) {
  o <- rep("", length(k)); ok <- !is.na(k)
  if (any(ok)) {
    u <- unique(k[ok])
    s <- format(as.POSIXct(u * 3600, origin = "1970-01-01", tz = "UTC"), "%Y-%m-%dT%H:00:00.000Z", tz = "UTC")
    o[ok] <- s[match(k[ok], u)]
  }
  o
}
RT_fun <- function(x) floor(x + 0.5)
isT <- function(x) !is.na(x) & x
nv <- function(ok) sum(!isT(ok))
RE_REP <- "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:00:00\\.000Z$"
RE_HRL <- "^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:00$"

# ---------------------------------------------------------------- statistics helpers
q7 <- function(x, p) {   # x sorted ascending, 1-based storage; type 7 by hand
  m <- length(x); pos <- (m - 1) * p; lo <- floor(pos); fr <- pos - lo
  if (lo + 1 > m - 1) x[lo + 1] else x[lo + 1] + fr * (x[lo + 2] - x[lo + 1])
}
idx_map <- function(n, B) (n * B) %/% 1e12
med_hand <- function(x) {
  x <- sort(x); n <- length(x)
  if (n == 0) return(NA_real_)
  if (n %% 2 == 1) x[(n + 1) / 2] else (x[n / 2] + x[n / 2 + 1]) / 2
}
err_fun <- function(F, truth) 100 * (F - truth) / truth

# ---------------------------------------------------------------- the forecast function
# Receives ONLY the issue row's lfQ and the two hourly flows. No truth, no target row.
forecast_fn <- function(lfQ, qstar, qlf) {
  list(pLF = lfQ, rLF = lfQ + qstar - qlf, rLFm = lfQ * qstar / qlf)
}

# ---------------------------------------------------------------- cases for one horizon
# R: list of replay vectors (all rows of the file); Qk, Qv: hourly key / value (NA = blank);
# widx: row indices of the issue rows (window); h: horizon
compute_cases <- function(R, Qk, Qv, widx, h) {
  t <- R$key[widx]
  lfQ <- R$lfQ[widx]
  hist <- R$hist[widx]; por <- R$por[widx]; lfs <- R$lfs[widx]; Tgl <- R$T[widx]
  ageLf <- t - lfs
  RT <- RT_fun(Tgl)
  ustar <- pmin(hist + h, por)
  ulf <- hist - RT - ageLf
  inside <- as.integer(hist + h <= por)
  qs <- Qv[match(ustar, Qk)]
  ql <- Qv[match(ulf, Qk)]
  tg <- match(t + h, R$key)
  # forecasts first (no truth)
  fc <- forecast_fn(lfQ, qs, ql)
  # status
  tstat <- R$status[tg]
  truth <- R$truth[tg]
  uts <- R$uts[widx]
  conds <- list(
    R$status[widx] != "predicted",
    is.na(lfQ) | lfQ <= 0,
    is.na(tg),
    isT(tstat != "predicted"),
    is.na(truth) | truth <= 0,
    isT(R$hardT[tg] == 1),
    isT(R$inprod[tg] == 0),
    is.na(uts) | (!is.na(uts) & uts != 1) | is.na(hist),
    is.na(por) | is.na(lfs) | is.na(Tgl),
    is.na(qs),
    is.na(ql),
    isT(qs <= 0) | isT(ql <= 0))
  st <- rep(13L, length(t))
  for (r in 12:1) st[isT(conds[[r]])] <- r
  # errors (truth read only now)
  ge8 <- st >= 8; sc <- st == 13
  errP <- ifelse(ge8, err_fun(fc$pLF, truth), NA_real_)
  errR <- ifelse(sc, err_fun(fc$rLF, truth), NA_real_)
  errRm <- ifelse(sc, err_fun(fc$rLFm, truth), NA_real_)
  refNow <- ifelse(sc, R$pred[tg], NA_real_)
  refHeld <- ifelse(sc, R$pred[widx], NA_real_)
  errNow <- err_fun(refNow, truth); errHeld <- err_fun(refHeld, truth)
  list(h = h, ii = seq_along(widx), widx = widx, t = t, tg = tg, status = st, lfQ = lfQ, truth = truth,
       hist = hist, por = por, lfs = lfs, ageLf = ageLf, Tgl = Tgl, RT = RT, ustar = ustar, ulf = ulf,
       inside = inside, qs = qs, ql = ql, pLF = fc$pLF, rLF = ifelse(sc, fc$rLF, NA_real_),
       rLFm = ifelse(sc, fc$rLFm, NA_real_), refNow = refNow, refHeld = refHeld,
       errP = errP, errR = errR, errRm = errRm, errNow = errNow, errHeld = errHeld)
}

# ---------------------------------------------------------------- arm statistics on a case selection
arm_list <- function(cs, idx) list(cs$errP[idx], cs$errR[idx], cs$errRm[idx], cs$errNow[idx], cs$errHeld[idx])
arm_stats <- function(e) {
  e <- e[!is.na(e)]; n <- length(e)
  if (n == 0) return(list(n = 0, mae = NA_real_, medae = NA_real_, signed = NA_real_, share = NA_real_))
  a <- abs(e)
  list(n = n, mae = mean(a), medae = med_hand(a), signed = mean(e), share = 100 * sum(a > 25) / n)
}

# ================================================================ PHASE 1: synthetic and unit tests
synth <- function(series) {
  base <- 438288; i <- 0:95; n <- 96
  Qk <- base + 0:95
  Qv <- switch(series, S0 = rep(1000, 96), S1 = ifelse(0:95 < 60, 1000, 1500),
               S2 = { q <- ifelse(0:95 < 60, 1000, 1500); q[51] <- NA; q[4] <- 0; q })
  R <- list(key = base + i, status = rep("predicted", n), uts = rep(1, n), lfQ = rep(2000, n),
            lfs = base + i - 1, T = rep(2.5, n), por = base + i - 2, hist = base + i - 20,
            pred = 1000 + 10 * i, truth = 2000 + 20 * (i %% 5), inprod = rep(1, n),
            hardT = rep(0, n), hardF = rep(0, n), flowBin = rep("0-3000", n), flowState = rep("steady", n))
  r5 <- 6
  R$status[r5] <- "no_por"
  for (nm in c("uts", "lfQ", "lfs", "T", "por", "hist", "pred", "truth", "inprod", "hardT", "hardF")) R[[nm]][r5] <- NA
  R$flowBin[r5] <- ""; R$flowState[r5] <- ""
  R$uts[8] <- 0; R$hist[8] <- NA
  R$lfQ[13] <- NA
  R$por[15] <- NA
  R$hardT[21] <- 1; R$hardF[21] <- 1
  R$status[31] <- "no_truth"; R$truth[31] <- NA
  R$truth[32] <- NA
  R$inprod[91] <- 0
  list(base = base, R = R, Qk = Qk, Qv = Qv)
}

EX1 <- rbind(c(2,2,2,2), c(1,1,1,1), c(6,12,24,48), c(1,1,1,0), c(1,1,1,0), c(1,1,0,0), c(1,1,1,1),
             c(1,1,0,1), c(0,1,1,1), c(11,6,2,2), c(9,11,17,18), c(0,0,0,0), c(62,58,46,22))
EX2 <- EX1; EX2[10, ] <- c(12,7,3,2); EX2[11, ] <- c(10,12,17,18); EX2[12, ] <- c(1,1,1,1); EX2[13, ] <- c(59,55,44,21)

run_synth <- function(series) {
  problems <- character(0)
  bad <- function(msg) problems <<- c(problems, msg)
  S <- synth(series); base <- S$base
  widx <- seq_along(S$R$key)
  css <- lapply(HS, function(h) compute_cases(S$R, S$Qk, S$Qv, widx, h))
  ex <- if (series == "S2") EX2 else EX1
  for (j in 1:4) {
    cnt <- as.numeric(table(factor(css[[j]]$status, levels = 1:13)))
    if (!all(cnt == ex[, j])) bad(sprintf("status counts h=%d: got %s", HS[j], paste(cnt, collapse = " ")))
  }
  for (j in 1:4) {
    cs <- css[[j]]; sc <- cs$status == 13; ti <- cs$t - base
    if (series == "S0") {
      if (!all(cs$rLF[sc] == 2000 & cs$rLFm[sc] == 2000 & cs$pLF[sc] == 2000)) bad("S0 arms not all 2000")
    }
    if (series == "S1") {
      set <- switch(j, 74:83, setdiff(68:83, 78), setdiff(62:71, 66), integer(0))
      exp5 <- ifelse(ti %in% set, 500, 0)
      d1 <- cs$rLF - cs$pLF; d2 <- cs$rLFm - cs$pLF
      if (!all(d1[sc] == exp5[sc])) bad(sprintf("S1 R-LF step h=%d", HS[j]))
      if (!all(d2[sc] == 2 * exp5[sc])) bad(sprintf("S1 R-LFm step h=%d", HS[j]))
      # metrics lead all
      ins <- sc & isT(cs$inside == 1)
      exin <- c(62, 58, 0, 0)[j]
      if (sum(ins) != exin) bad(sprintf("S1 inside count h=%d", HS[j]))
      idx <- which(sc)
      a <- arm_list(cs, idx)
      st <- lapply(a, arm_stats)
      expn <- c(62, 58, 46, 22)[j]
      if (st[[1]]$n != expn) bad("S1 n")
      EM <- list(rbind(c(2.0040, -2.0040), c(5.3315, 1.9500), c(9.2854, 5.9040)),
                 rbind(c(1.9751, -1.9751), c(7.3106, 4.3649), c(13.6506, 10.7048)),
                 rbind(c(1.9630, -1.9630), c(5.9045, 2.8227), c(10.6902, 7.6085)),
                 rbind(c(2.0293, -2.0293), c(2.0293, -2.0293), c(2.0293, -2.0293)))[[j]]
      for (a3 in 1:3) {
        if (abs(st[[a3]]$mae - EM[a3, 1]) > 5e-5 || abs(st[[a3]]$signed - EM[a3, 2]) > 5e-5)
          bad(sprintf("S1 metrics arm %d h=%d: %.4f %.4f", a3, HS[j], st[[a3]]$mae, st[[a3]]$signed))
      }
      if (abs(st[[4]]$mae - c(19.8798, 18.8969, 15.9488, 10.1355)[j]) > 5e-5) bad(sprintf("S1 REF_NOW mae h=%d", HS[j]))
      if (abs(st[[5]]$mae - c(22.8197, 24.7784, 27.7132, 33.6484)[j]) > 5e-5) bad(sprintf("S1 REF_HELD mae h=%d", HS[j]))
    }
  }
  if (series == "S1") {
    chk <- function(t, h, us, ul, ins, p, r, rm, rn, rh, tr) {
      cs <- css[[match(h, HS)]]; k <- which(cs$t - base == t)
      if (length(k) != 1 || cs$status[k] != 13) { bad(sprintf("explicit row t=%d h=%d not scored", t, h)); return() }
      got <- c(cs$ustar[k] - base, cs$ulf[k] - base, cs$inside[k], cs$pLF[k], cs$rLF[k], cs$rLFm[k],
               cs$refNow[k], cs$refHeld[k], cs$truth[k])
      if (!all(got == c(us, ul, ins, p, r, rm, rn, rh, tr))) bad(sprintf("explicit row t=%d h=%d: %s", t, h, paste(got, collapse = " ")))
    }
    chk(80, 6, 66, 56, 1, 2000, 2500, 3000, 1860, 1800, 2020)
    chk(70, 24, 68, 46, 0, 2000, 2500, 3000, 1940, 1700, 2080)
    chk(40, 12, 32, 16, 1, 2000, 2000, 2000, 1520, 1400, 2040)
  }
  problems
}

run_unit_round_key <- function() {
  p <- character(0)
  v <- c(0.5, 2.4, 2.5, 2.6, 8.49, 8.5); e <- c(1, 2, 3, 3, 8, 9)
  if (!all(RT_fun(v) == e)) p <- c(p, "RT")
  if (key_replay("2020-01-01T00:00:00.000Z") != 438288) p <- c(p, "k1")
  if (key_hourly("2020-01-01 00:00") != 438288) p <- c(p, "k2")
  if (key_replay("2026-06-16T03:00:00.000Z") != 494883) p <- c(p, "k3")
  if (key_hourly("2026-06-16 03:00") != 494883) p <- c(p, "k4")
  p
}
run_percentile <- function() {
  x <- as.numeric(1:10000)
  p <- character(0)
  if (abs(q7(x, 0.025) - 250.975) > 1e-9) p <- c(p, "lo")
  if (abs(q7(x, 0.975) - 9750.025) > 1e-9) p <- c(p, "hi")
  p
}
run_bootmap <- function() {
  p <- character(0)
  if (idx_map(999999999999, 163) != 162) p <- c(p, "a")
  if (idx_map(0, 163) != 0) p <- c(p, "b")
  if (idx_map(500000000000, 7) != 3) p <- c(p, "c")
  if (idx_map(192517163266, 163) != 31) p <- c(p, "d")
  p
}

checks <- data.frame(check = character(0), period = character(0), n_checked = numeric(0), n_violations = numeric(0))
add_check <- function(check, period, n, v) checks[nrow(checks) + 1, ] <<- list(check, period, n, v)
synth_msgs <- list()
for (s in c("S0", "S1", "S2")) {
  pr <- run_synth(s); synth_msgs[[s]] <- pr
  add_check(paste0("synthetic_", s), "-", 1, if (length(pr)) 1 else 0)
}
pr <- run_unit_round_key(); synth_msgs$unit <- pr; add_check("unit_round_key", "-", 1, if (length(pr)) 1 else 0)
pr <- run_percentile(); synth_msgs$pct <- pr; add_check("percentile_t7", "-", 1, if (length(pr)) 1 else 0)
pr <- run_bootmap(); synth_msgs$boot <- pr; add_check("boot_index_map", "-", 1, if (length(pr)) 1 else 0)
if (any(checks$n_violations > 0)) {
  write.csv(checks, file.path(OUT, "checks.csv"), row.names = FALSE, quote = FALSE)
  fail(paste("Synthetic/unit tests FAILED before real data were read:", paste(unlist(synth_msgs), collapse = " | ")))
}
cat("synthetic and unit tests passed\n")

# ================================================================ PHASE 2: real data
need_rep <- c("predTs", "status", "useTimeShifted", "predictedCFS", "flowBin", "flowState", "histSrcTs", "porSrcTs",
              "travelGFtoLF", "lfQ", "lfSrcTs", "truthFlow", "truthInProdRange", "truthDependentHard", "hardFlag",
              "porQ", "historicPorCFS")
read_header <- function(path) sub("\r$", "", strsplit(readLines(path, n = 1), ",", fixed = TRUE)[[1]])
read_sel <- function(path, need, nrows) {
  hdr <- read_header(path)
  if (!all(need %in% hdr)) fail(paste("missing columns in", path))
  cc <- setNames(ifelse(hdr %in% need, "character", "NULL"), hdr)
  read.csv(path, colClasses = cc, quote = "", comment.char = "", na.strings = character(0),
           stringsAsFactors = FALSE, nrows = nrows)
}
read_replay <- function(path, nrows) {
  d <- read_sel(path, need_rep, nrows)
  list(predTs = d$predTs, status = d$status, key = key_replay(d$predTs), uts = num(d$useTimeShifted),
       pred = num(d$predictedCFS), flowBin = d$flowBin, flowState = d$flowState,
       histS = d$histSrcTs, porS = d$porSrcTs, lfsS = d$lfSrcTs,
       hist = key_replay(d$histSrcTs), por = key_replay(d$porSrcTs), lfs = key_replay(d$lfSrcTs),
       T = num(d$travelGFtoLF), lfQ = num(d$lfQ), truth = num(d$truthFlow), inprod = num(d$truthInProdRange),
       hardT = num(d$truthDependentHard), hardF = num(d$hardFlag), porQ = num(d$porQ), hpc = num(d$historicPorCFS))
}
read_hourly <- function(path, nrows) {
  hdr <- read_header(path)
  need <- c("timestamp", "por_now")
  cc <- setNames(ifelse(hdr %in% need, "character", "NULL"), hdr)
  d <- read.csv(path, colClasses = cc, quote = "", comment.char = "", na.strings = character(0),
                stringsAsFactors = FALSE, nrows = nrows)
  ts <- sub("\r$", "", d$timestamp); pn <- sub("\r$", "", d$por_now)
  list(ts = ts, key = key_hourly(ts), q = num(pn))
}

f_repA <- P("..", "replay_lag_2026-11-17", "shadow_L.csv")
f_hrA <- P("..", "hourly_backtest_data_v361.csv")
f_repB <- P("replay_B", "shadow_L.csv")
f_hrB <- P("..", "rising-limb-travel-backtest", "hourly_backtest_data_v39.csv")
f_ev <- P("..", "rising-limb-travel-backtest", "rising_limb_events_python_v39.csv")
f_boot <- P("tools", "boot_uniforms.csv")

cat("reading period A\n")
RA <- read_replay(f_repA, 127463)
if (length(RA$key) != 127463) fail("A replay row count")
HA <- read_hourly(f_hrA, 126916)
if (length(HA$key) != 126916) fail("A hourly row count")
stat_chk <- function(R, exp) { tb <- table(R$status); for (nm in names(exp)) if (as.numeric(tb[nm]) != exp[[nm]]) fail(paste("status count", nm)) }
stat_chk(RA, list(predicted = 125099, no_por = 1014, no_truth = 911, no_lf = 439))
if (sum(is.na(HA$q)) != 2845) fail("A hourly blank por_now count")

# events
evd <- read.csv(f_ev, colClasses = "character", quote = "", comment.char = "", na.strings = character(0), stringsAsFactors = FALSE)
evk <- evd[evd$kept == "1" & evd$event_class == "GATE", ]
if (nrow(evk) != 21) fail("events kept != 21")
ev_t0 <- key_hourly(evk$event_t0); ev_tp <- key_hourly(evk$event_tp)
ev_viol <- sum(!grepl(RE_HRL, c(evk$event_t0, evk$event_tp))) + sum(is.na(ev_t0)) + sum(is.na(ev_tp))

# bootstrap draws
cat("reading bootstrap draws\n")
ub <- read.csv(f_boot, colClasses = "character", quote = "", comment.char = "", na.strings = character(0), stringsAsFactors = FALSE)
if (nrow(ub) != 10000 || ncol(ub) != 175 || !identical(names(ub), paste0("u", 1:175))) fail("boot_uniforms shape")
U <- matrix(as.numeric(unlist(ub, use.names = FALSE)), nrow = 10000, ncol = 175)
rm(ub)
if (U[1, 1] != 192517163266) fail("boot first cell")
if (idx_map(U[1, 1], 163) != 31) fail("boot first cell index")

# period B
period_B <- TRUE; B_reason <- ""
if (!file.exists(f_repB) || !file.exists(f_hrB)) { period_B <- FALSE; B_reason <- "file missing" } else {
  if (!identical(read_header(f_repB), read_header(f_repA))) { period_B <- FALSE; B_reason <- "header differs" }
}
if (period_B) {
  cat("reading period B\n")
  RB <- read_replay(f_repB, 130987)
  if (length(RB$key) != 130987) fail("B replay row count")
  HB <- read_hourly(f_hrB, 130416)
  if (length(HB$key) != 130416) fail("B hourly row count")
  stat_chk(RB, list(predicted = 128595, no_por = 1014, no_truth = 939, no_lf = 439))
}

# ---------------------------------------------------------------- dims for a window
make_dims <- function(R, widx, ev_t0, ev_tp) {
  t <- R$key[widx]; n <- length(t)
  lt <- as.POSIXlt(t * 3600, origin = "1970-01-01", tz = "UTC")
  yr <- lt$year + 1900; md <- 100 * (lt$mon + 1) + lt$mday
  lrw <- rep(FALSE, n)
  for (e in seq_along(ev_t0)) lrw <- lrw | (t >= ev_t0[e] - 48 & t <= ev_tp[e])
  seas <- md >= 915 & md <= 1215
  low <- R$lfQ[widx] < 3000
  fb <- R$flowBin[widx]; fs <- R$flowState[widx]
  D <- list()
  add <- function(dim, level, mask) D[[length(D) + 1]] <<- list(dim = dim, level = level, mask = isT(mask))
  add("all", "all", rep(TRUE, n))
  for (l in c("0-3000", "3000-6000", "6000-12000", "12000-25000", "25000-50000", "50000+")) add("flowBin", l, fb == l)
  for (l in c("rising", "steady", "falling")) add("flowState", l, fs == l)
  add("largeRise", "in_window", lrw); add("largeRise", "out_window", !lrw)
  add("season", "in_season", seas); add("season", "out_season", !seas)
  add("seasonLow", "in_season_lf_lt3000", seas & low); add("seasonLow", "out_season_lf_lt3000", !seas & low)
  add("era", "2012_2018", yr >= 2012 & yr <= 2018); add("era", "2019_2026", yr >= 2019 & yr <= 2026)
  list(D = D, lrw = lrw, seas = seas, low = low, md = md, yr = yr, lt = lt)
}

# ---------------------------------------------------------------- one period
run_period <- function(per, R, H, wstart, blockkind, expect) {
  cat("period", per, "\n")
  Qk <- H$key; Qv <- H$q
  widx <- which(R$key >= wstart)
  n <- length(widx)
  if (n != expect$n || sum(R$status[widx] == "predicted") != expect$npred) fail(paste("window rows", per))
  D <- make_dims(R, widx, ev_t0, ev_tp)
  # blocks
  if (blockkind == "month") {
    lab <- sprintf("%04d-%02d", D$lt$year + 1900, D$lt$mon + 1)
  } else {
    day <- (R$key[widx] %/% 24)
    lab <- sprintf("%08d", (day + 3) %/% 7)
  }
  ul <- sort(unique(lab)); B <- length(ul)
  if (B != expect$B) fail(paste("block count", per, B))
  if (B > 175) fail("B > 175")
  blk <- match(lab, ul)
  # resample count matrix
  Ib <- (U[, 1:B, drop = FALSE] * B) %/% 1e12 + 1
  M <- matrix(0, nrow(U), B)
  for (r in seq_len(nrow(U))) M[r, ] <- tabulate(Ib[r, ], B)
  css <- lapply(HS, function(h) compute_cases(R, Qk, Qv, widx, h))
  # ---- checks
  chk <- list()
  isq <- function(cs) cs$status >= 10
  c1 <- c(0, 0); c2 <- c(0, 0); c3 <- c(0, 0); c4 <- c(0, 0); c5 <- c(0, 0); c6 <- c(0, 0); c7 <- c(0, 0)
  for (cs in css) {
    k <- which(cs$status >= 10)
    c1 <- c1 + c(length(k), nv((cs$por[k] <= cs$t[k] - 2)))
    c2 <- c2 + c(length(k), nv((cs$lfs[k] <= cs$t[k] - 1 & cs$ageLf[k] >= 1)))
    c3 <- c3 + c(length(k), nv((cs$hist[k] <= cs$por[k])))
    c4 <- c4 + c(length(k), nv((cs$ustar[k] == pmin(cs$hist[k] + cs$h, cs$por[k]) & cs$ustar[k] >= cs$hist[k] & cs$ustar[k] <= cs$por[k])))
    c5 <- c5 + c(length(k), nv((cs$ulf[k] == cs$hist[k] - RT_fun(cs$Tgl[k]) - cs$ageLf[k] & cs$ulf[k] <= cs$hist[k])))
    k6 <- which(cs$status %in% c(12, 13))
    c6 <- c6 + c(length(k6), nv((cs$ustar[k6] <= cs$por[k6] & cs$ulf[k6] <= cs$por[k6])))
    k7 <- which(cs$status == 13)
    c7 <- c7 + c(length(k7), nv((R$key[cs$tg[k7]] == cs$t[k7] + cs$h)))
  }
  pr <- which(R$status == "predicted")
  c8v <- sum(is.na(R$hardF[pr]) != is.na(R$hardT[pr]) | (!is.na(R$hardF[pr]) & !is.na(R$hardT[pr]) & R$hardF[pr] != R$hardT[pr]))
  src <- c(R$histS[widx][R$status[widx] == "predicted"], R$porS[widx][R$status[widx] == "predicted"],
           R$lfsS[widx][R$status[widx] == "predicted"])
  src <- src[src != ""]
  c9v <- sum(!grepl(RE_REP, R$predTs)) + sum(!grepl(RE_HRL, H$ts)) + sum(!grepl(RE_REP, src)) + ev_viol
  c9n <- length(R$key) + length(H$key)
  c10v <- nv((diff(R$key) > 0)) + sum(is.na(R$key))
  c11v <- nv((diff(H$key) > 0)) + sum(is.na(H$key))
  qp <- Qv[match(R$por[pr], Qk)]
  v1 <- is.na(R$por[pr]) | is.na(qp) | is.na(R$porQ[pr]) | qp != R$porQ[pr]
  hh <- R$hist[pr]; qh <- Qv[match(hh, Qk)]
  v2 <- !is.na(hh) & (is.na(qh) | is.na(R$hpc[pr]) | abs(qh - R$hpc[pr]) > 0.5)
  c12v <- sum(v1 | v2)
  chk <- list(c("C1_por_age", c1), c("C2_lf_age", c2), c("C3_hist_le_por", c3), c("C4_ustar_rule", c4),
              c("C5_ulf_rule", c5), c("C6_q_hours_known", c6), c("C7_target_hour", c7),
              c("C8_hard_equal", c(length(pr), c8v)), c("C9_whole_hours", c(c9n, c9v)),
              c("C10_shadow_sorted_unique", c(length(R$key), c10v)), c("C11_hourly_sorted_unique", c(length(H$key), c11v)),
              c("C12_clock_alignment", c(length(pr), c12v)))
  for (cc in chk) add_check(cc[1], per, as.numeric(cc[2]), as.numeric(cc[3]))
  extra <- list(n_c12_half = sum(!is.na(hh) & !is.na(qh) & !is.na(R$hpc[pr]) & abs(qh - R$hpc[pr]) == 0.5))

  # ---- counts
  cnt_lines <- character(0)
  for (j in 1:4) {
    cs <- css[[j]]
    tb <- as.numeric(table(factor(cs$status, levels = 1:13)))
    sc <- cs$status == 13
    vals <- c(tb, n, sum(sc & isT(cs$inside == 1)), sum(sc & isT(cs$inside == 0)), sum(cs$status >= 8))
    nm <- c(STATUS, "TOTAL", "SCORED_INSIDE", "SCORED_BEYOND", "Q4_SET")
    cnt_lines <- c(cnt_lines, paste(per, HS[j], nm, fi(vals), sep = ","))
  }

  # ---- metrics and intervals
  met_lines <- character(0); int_lines <- character(0)
  cellstat <- list(); cellint <- list()
  cell_pairs <- list()
  bsum <- function(x, bi) { r <- numeric(B); s <- rowsum(x, bi); r[as.integer(rownames(s))] <- s[, 1]; r }
  for (j in 1:4) {
    cs <- css[[j]]; h <- HS[j]
    sc <- cs$status == 13
    for (lead in LEADS) {
      lm <- sc & switch(lead, all = TRUE, inside = isT(cs$inside == 1), beyond = isT(cs$inside == 0))
      for (dm in D$D) {
        idx <- which(lm & dm$mask)
        al <- arm_list(cs, idx)
        st <- lapply(al, arm_stats)
        key <- paste(h, lead, dm$dim, dm$level, sep = "|")
        cellstat[[key]] <- st
        for (a in 1:5) {
          s <- st[[a]]
          met_lines <- c(met_lines, paste(per, h, lead, dm$dim, dm$level, ARMS[a], fi(s$n), f6(s$mae), f6(s$medae),
                                          f6(s$signed), f6(s$share), sep = ","))
        }
        # intervals
        nn <- length(idx)
        eP <- cs$errP[idx]; eR <- cs$errR[idx]; eRm <- cs$errRm[idx]
        sAP <- sum(abs(eP)); sAR <- sum(abs(eR)); sARm <- sum(abs(eRm)); sEP <- sum(eP); sER <- sum(eR)
        est <- if (nn > 0) c((sAP - sAR) / nn, (sAP - sARm) / nn, (sER - sEP) / nn) else rep(NA_real_, 3)
        lo <- hi <- rep(NA_real_, 3); nskip <- 10000; nvalid <- 0
        if (nn > 0) {
          bi <- blk[cs$ii[idx]]
          X <- cbind(tabulate(bi, B), bsum(abs(eP), bi), bsum(abs(eR), bi), bsum(abs(eRm), bi), bsum(eP, bi), bsum(eR, bi))
          Z <- M %*% X
          ok <- Z[, 1] > 0
          nskip <- sum(!ok); nvalid <- 10000 - nskip
          if (nskip <= 500) {
            nr <- Z[ok, 1]
            vals <- list((Z[ok, 2] - Z[ok, 3]) / nr, (Z[ok, 2] - Z[ok, 4]) / nr, (Z[ok, 6] - Z[ok, 5]) / nr)
            for (s3 in 1:3) { x <- sort(vals[[s3]]); lo[s3] <- q7(x, 0.025); hi[s3] <- q7(x, 0.975) }
          }
        }
        stn <- c("D_PR", "D_PRm", "S_RP")
        for (s3 in 1:3) {
          int_lines <- c(int_lines, paste(per, h, lead, dm$dim, dm$level, stn[s3], fi(nn), f6(est[s3]), f6(lo[s3]), f6(hi[s3]),
                                          fi(nvalid), fi(nskip), sep = ","))
          cellint[[paste(key, stn[s3], sep = "|")]] <- list(est = est[s3], lo = lo[s3], hi = hi[s3], n = nn)
        }
      }
    }
  }
  # ---- forecasts file lines
  fc_lines <- character(4 * n)
  seas_i <- as.numeric(D$seas); lrw_i <- as.numeric(D$lrw); low_i <- as.numeric(D$low)
  for (j in 1:4) {
    cs <- css[[j]]; st <- cs$status; ii <- cs$ii
    g1 <- st >= 8; g2 <- st >= 10; g3 <- st == 13
    mk <- function(x, mask) { x[!mask] <- ""; x }
    cols <- list(
      rep(per, n), ts_fmt(cs$t), fi(rep(cs$h, n)), STATUS[st], ts_fmt(cs$t + cs$h),
      mk(R$flowBin[widx], g1), mk(R$flowState[widx], g1), mk(fi(lrw_i), g1), mk(fi(seas_i), g1), mk(fi(low_i), g1),
      mk(f6(cs$lfQ), g1), mk(f6(cs$truth), g1), mk(f6(cs$pLF), g1), mk(f6(cs$errP), g1),
      mk(ts_fmt(cs$lfs), g2), mk(fi(cs$ageLf), g2), mk(f6(cs$Tgl), g2), mk(fi(cs$RT), g2), mk(ts_fmt(cs$hist), g2),
      mk(ts_fmt(cs$por), g2), mk(ts_fmt(cs$ustar), g2), mk(ts_fmt(cs$ulf), g2), mk(f6(cs$qs), g2), mk(f6(cs$ql), g2),
      mk(fi(cs$inside), g2),
      mk(f6(cs$rLF), g3), mk(f6(cs$rLFm), g3), mk(f6(cs$refNow), g3), mk(f6(cs$refHeld), g3),
      mk(f6(cs$errR), g3), mk(f6(cs$errRm), g3), mk(f6(cs$errNow), g3), mk(f6(cs$errHeld), g3))
    lines_h <- do.call(paste, c(cols, sep = ","))
    fc_lines[seq(j, by = 4, length.out = n)] <- lines_h
  }
  list(met = met_lines, int = int_lines, cnt = cnt_lines, fc = fc_lines, cellstat = cellstat, cellint = cellint,
       css = css, B = B, n = n, extra = extra)
}

wA <- key_replay("2012-12-01T00:00:00.000Z")
resA <- run_period("A", RA, HA, wA, "month", list(n = 118684, npred = 116348, B = 163))
resB <- NULL
if (period_B) {
  wB <- key_replay("2026-08-28T00:00:00.000Z")
  resB <- run_period("B", RB, HB, wB, "week", list(n = 1776, npred = 1763, B = 12))
}

# ---------------------------------------------------------------- verdicts (period A)
toint <- function(s) if (is.na(s) || s == "") NA_real_ else as.numeric(sub(".", "", s, fixed = TRUE))
ci_get <- function(res, h, lead, dim, level, stat) res$cellint[[paste(h, lead, dim, level, stat, sep = "|")]]
cs_get <- function(res, h, lead, dim, level) res$cellstat[[paste(h, lead, dim, level, sep = "|")]]
vlines <- character(0); verd <- character(0)
for (h in c(6, 12, 24)) {
  ci <- ci_get(resA, h, "inside", "all", "all", "D_PR")
  n_in <- ci$n
  Dest <- f6(ci$est); Dlo <- f6(ci$lo); Dhi <- f6(ci$hi)
  cond1 <- as.integer(isT(toint(Dlo) >= 1000000))
  rs <- cs_get(resA, h, "inside", "flowState", "rising")
  rn <- rs[[1]]$n
  if (rn > 0) {
    rwb <- f6(rs[[2]]$mae - rs[[1]]$mae); sR <- f6(rs[[2]]$signed); sP <- f6(rs[[1]]$signed)
    cond2 <- as.integer(toint(rwb) <= 500000); cond3 <- as.integer(toint(sR) >= toint(sP))
  } else { rwb <- ""; sR <- ""; sP <- ""; cond2 <- 0L; cond3 <- 0L }
  if (h == 24) {
    ci4 <- ci_get(resA, 24, "inside", "season", "out_season", "D_PR")
    c4lo <- f6(ci4$lo); cond4 <- as.integer(isT(toint(c4lo) >= 1000000)); app <- 1L
  } else { c4lo <- ""; cond4 <- NA; app <- 0L }
  if (cond1 == 1 && cond2 == 1 && cond3 == 1 && (app == 0 || cond4 == 1)) v <- "ADDS_INFORMATION"
  else if (Dhi != "" && toint(Dhi) < 500000) v <- "ADDS_NOTHING" else v <- "UNCLEAR"
  verd <- c(verd, v)
  vlines <- c(vlines, paste(h, fi(n_in), Dest, Dlo, Dhi, cond1, fi(rn), rwb, cond2, sR, sP, cond3, app, c4lo,
                            if (is.na(cond4)) "" else cond4, v, sep = ","))
}
overall <- if (verd[2] == "ADDS_INFORMATION" || verd[3] == "ADDS_INFORMATION") "PROPOSE_STAGE2" else
  if (all(verd == "ADDS_NOTHING")) "STOP_IDEA_CLOSED" else "REPORT_OWNER_DECIDES"
vlines <- c(vlines, paste("overall", paste(rep("", 13), collapse = ","), overall, sep = ","))
# overall row: only horizon and verdict filled: 16 columns -> horizon + 14 blanks + verdict
vlines[length(vlines)] <- paste0("overall", strrep(",", 15), overall)

# ---------------------------------------------------------------- q4 (period B)
q4_lines <- character(0)
if (period_B) {
  stored_f <- c(10.0, 11.3, 13.8, 17.1); stored_n <- c(12.6, 16.7, 25.3, 39.9)
  for (j in 1:4) {
    cs <- resB$css[[j]]; h <- HS[j]
    k <- which(cs$status >= 8); nq <- length(k)
    maeP <- if (nq > 0) mean(abs(cs$errP[k])) else NA_real_
    rel <- abs(maeP - stored_n[j]) / stored_n[j]
    comp <- as.integer(isT(rel <= 0.2))
    pc <- cs_get(resB, h, "all", "all", "all")
    npairs <- pc[[1]]$n; mP <- pc[[1]]$mae; mR <- pc[[2]]$mae
    skR <- if (comp == 1) 1 - mR / mP else NA_real_
    skT <- if (comp == 1) 1 - stored_f[j] / stored_n[j] else NA_real_
    q4_lines <- c(q4_lines, paste(h, "ANSWERED", fi(nq), f6(maeP), f6(stored_n[j]), f6(rel), comp, f6(stored_f[j]), f6(skT),
                                  fi(npairs), f6(mP), f6(mR), f6(skR), sep = ","))
  }
} else {
  q4_lines <- paste(HS, "NOT_ANSWERED", paste(rep("", 11), collapse = ","), sep = ",")
  q4_lines <- paste0(HS, ",NOT_ANSWERED", strrep(",", 11))
}

# ---------------------------------------------------------------- write outputs
w <- function(name, header, lines) {
  con <- file(file.path(OUT, name), "wb")
  writeLines(c(header, lines), con, sep = "\n", useBytes = TRUE)
  close(con)
}
w("metrics.csv", "period,h,lead,dim,level,arm,n,mae,medae,mean_signed,share_gt25", c(resA$met, resB$met))
w("counts.csv", "period,h,status,n", c(resA$cnt, resB$cnt))
w("intervals.csv", "period,h,lead,dim,level,stat,n,est,lo,hi,n_valid,n_skipped", c(resA$int, resB$int))
w("verdicts.csv", "horizon,n_inside,D_est,D_lo,D_hi,cond1,rising_n,rising_worse_by,cond2,rising_signed_R,rising_signed_P,cond3,cond4_applicable,cond4_D_lo,cond4,verdict", vlines)
w("q4.csv", "h,state,n_q4,mae_pLF,stored_nochange,rel_diff,comparable,stored_forecast,skill_today,n_pairs,mae_pLF_pairs,mae_RLF_pairs,skill_RLF", q4_lines)
w("checks.csv", "check,period,n_checked,n_violations", paste(checks$check, checks$period, fi(checks$n_checked), fi(checks$n_violations), sep = ","))
FCH <- "period,issueTs,h,status,targetTs,flowBin,flowState,lrWindow,season,lfLt3000,lfQ,truth,pLF,errP,lfSrcTs,ageLf,travelGFtoLF,rtGL,histSrcTs,porSrcTs,uStarTs,uLfTs,qStar,qLf,inside,rLF,rLFm,refNow,refHeld,errR,errRm,errRefNow,errRefHeld"
w("forecasts_A.csv", FCH, resA$fc)
if (period_B) w("forecasts_B.csv", FCH, resB$fc)

# ---------------------------------------------------------------- REPORT.md
elapsed <- as.numeric(difftime(Sys.time(), t_start, units = "secs"))
nviol <- sum(checks$n_violations)
rep_lines <- c(
  "# REPORT, blind R analyst (specification version 1.2)", "",
  "## What was run", "",
  "Command, from the study folder: `Rscript r/run_all.R`. Base R 4.5.2 only. The script runs the made-up-data and unit tests first (before any real file is read), then reads the real files and writes every output file into `r/`.",
  sprintf("Run time of the run that wrote this file: %.0f seconds.", elapsed), "",
  "Design requirement (section 5): the forecasts come from `forecast_fn(lfQ, qstar, qlf)`, a function whose only arguments are the issue row's `lfQ` and the two hourly flows; it has no access to the target row or the truth. `truthFlow` is read in `compute_cases` only after `forecast_fn` has returned, to build the errors. The case status needs the target row but does not enter the forecast.", "",
  "## Row counts", "",
  sprintf("- Period A replay rows read: %d; window rows (issue rows): %d (predicted: %d); blocks (months): %d; hourly rows: %d.",
          length(RA$key), resA$n, sum(RA$status[RA$key >= wA] == "predicted"), resA$B, length(HA$key)),
  if (period_B) sprintf("- Period B replay rows read: %d; window rows: %d (predicted: %d); blocks (weeks): %d; hourly rows: %d.",
          length(RB$key), resB$n, sum(RB$status[RB$key >= wB] == "predicted"), resB$B, length(HB$key)) else "- Period B not built.",
  sprintf("- Events kept (kept == 1 and event_class == GATE): %d.", nrow(evk)),
  "- SHA-256 of the input files was not computed inside R (no base SHA-256); the row counts and status counts of section 1 were asserted. The analyst also compared the SHA-256 of all six input files with section 1 from the shell (all equal).", "",
  "## Judgment calls", "",
  "1. (2.1/11.3) Output of `n` for interval rows is the cell's case count; `n_valid`/`n_skipped` for an empty cell are written as 0 and 10000 as the specification says.",
  "2. (11.7, G2) The group G2 is filled for statuses 10 to 13 only (status 8 and 9 have no complete set of source fields to use); within it `qStar`, `qLf` are blank when the hourly value does not exist. Statuses 10 to 12 also carry `uStarTs`, `uLfTs`, `inside`, `rtGL`, `ageLf` etc.",
  "3. (11.7, G1) For statuses 8 to 13, `pLF` and `errP` are filled; for 8 and 9 the group G1 is filled too (flowBin, flowState, lrWindow, season, lfLt3000, lfQ, truth). `lfLt3000` is 1 iff `lfQ < 3000`.",
  "4. (11.4) For `overall` the row is `overall` followed by 14 commas and the verdict (all 16 columns, only horizon and verdict filled). Where a cell used by a condition has `n = 0` or a blank bound, that condition is 0 and its inputs are blank; `cond4` is blank for h = 6, 12 and 0 (not blank) for h = 24 if its input is blank. `ADDS_NOTHING` requires a non-blank `D_hi` below 500000 (integer units of 1e-6).",
  "5. (9.4) `D_est` is the cell's full-data statistic written with `%.6f`; `cond1` and `ADDS_NOTHING` use the written `D_lo` and `D_hi`; `cond3` compares the written signed values as integers.",
  "6. (9.1) Period A block label is the UTC `YYYY-MM` of `predTs`; period B blocks are sorted by `w = (K %/% 24 + 3) %/% 7`.",
  "7. (10, C9) The C9 violation count adds the replay timestamps, the hourly timestamps, the non-blank source timestamps of the predicted window rows and the event timestamps (t0, tp) of the 21 kept events; `n_checked` is the replay rows plus the hourly rows. (10, C10/C11) A violation is a key that is not strictly greater than its predecessor, or a key that failed to parse.",
  "8. (10, C12) `Q[K(porSrcTs)] == porQ` is tested with exact double equality on the numbers parsed by `as.numeric` from the same strings; the half-unit test uses `abs(diff) <= 0.5` literally.",
  "9. (10, C1 to C7) All case-level checks run on the four horizons and are summed; C1 to C5 on statuses 10 to 13, C6 on statuses 12 and 13, C7 on status 13.",
  "10. (9.5) `mae_pLF` is the mean of `|errP|` over all period B cases with status 8 to 13; the stored constants are written with `%.6f`.",
  "11. (2.2) The hour key is `as.numeric(as.POSIXct(substr(x, 1, 13), format = \"%Y-%m-%dT%H\", tz = \"UTC\")) / 3600` for the replay format and `format = \"%Y-%m-%d %H:%M\"` for the hourly and event format; minute 00 is asserted by regular expression in C9, not by the parser.",
  "12. (7) A case whose issue `lfQ` is blank is in no level of `seasonLow` (the status excludes it from scoring anyway); an issue year outside 2012 to 2026 is in no `era` level (none occurs).",
  "13. (9.2) The first cell of the first data row of `boot_uniforms.csv` was also asserted to be 192517163266 on the real file.", "",
  "## Deviations from the specification", "",
  "None.", "",
  "## Checks", "",
  sprintf("Total violations in `checks.csv`: %d. %s", nviol, if (nviol == 0) "All synthetic tests, unit tests and checks C1 to C12 passed." else "AT LEAST ONE CHECK FAILED; see checks.csv; the run exits non-zero."),
  sprintf("C12: %d rows in A differ by exactly 0.5 between `Q[K(histSrcTs)]` and `historicPorCFS`%s.", resA$extra$n_c12_half,
          if (period_B) sprintf("; %d in B", resB$extra$n_c12_half) else ""), "",
  "## Period B", "",
  if (period_B) "Built." else paste("PERIOD_B_NOT_ANSWERED:", B_reason))
writeLines(rep_lines, file.path(OUT, "REPORT.md"))
cat(sprintf("done in %.0f s; violations %d\n", elapsed, nviol))
if (nviol > 0) quit(status = 1)

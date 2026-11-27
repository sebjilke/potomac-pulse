Sys.setlocale("LC_COLLATE", "C")
options(stringsAsFactors = FALSE, warn = 1)
T_START <- Sys.time()
if (!dir.exists("r")) stop("run from the study folder: Rscript --vanilla r/run_all.R")
OUT <- "r"

## ============================================================ constants
CAND <- c("F135", "F150", "F200", "LF3", "LF6", "MR", "UP", "RIS", "ICE", "N")
DESC <- c("T110", "F125", "F130", "F140", "F175", "ICE-T")
RULES17 <- c("P", CAND, DESC)
RULES18 <- c(RULES17, "P_icet_hours")
X15 <- c(CAND, "F125", "F130", "F140", "F175", "ICE-T")
TIE_ORDER <- c("F135", "F150", "LF6", "LF3", "MR", "UP", "RIS", "F200", "ICE", "N")
BINS <- c("0-3000", "3000-6000", "6000-12000", "12000-25000", "25000-50000", "50000+")
POPS <- c("all", "rising", "lf_rising", "capped", "capped_rising", "capped_notrising",
          "rl_large", "rl_large_upstream", "rl_large_lfled", "rl_large_notclassed",
          paste0("bin_", BINS), "high_water", "low_water")
PERIODS <- c("design", "test", "test_half1", "test_half2")
T_DESIGN0 <- "2012-12-01T00:00:00.000Z"
T_TEST0 <- "2020-01-01T00:00:00.000Z"
T_HALF <- "2023-06-01T00:00:00.000Z"
T_ICET <- "2021-05-07T00:00:00.000Z"
COLS22 <- c("predTs", "status", "flowBin", "flowState", "truthFlow", "truthInProdRange",
            "truthDependentHard", "errPctRaw", "errPctCorr", "predictedCFS", "rawUnc",
            "corrUsed", "d6", "span_h", "lfCap", "lfQ", "lfSrcTs", "age_lf_h",
            "travelGFtoLF", "porQ", "tempC", "tauTs")
NUMC <- c("truthFlow", "predictedCFS", "rawUnc", "corrUsed", "d6", "span_h", "lfCap",
          "lfQ", "age_lf_h", "travelGFtoLF", "porQ", "tempC", "errPctCorr")
HOUR <- 3600000
CENTER <- 1350000
SENT <- "\001"
RE_PTS <- "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):00:00\\.000Z$"
RE_TIME <- "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.000Z$"
RE_NUM <- "^-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?$"
RE_HTS <- "^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:00$"

P <- list(
  L = "../onset_correction_2026-11-25/replay_L/shadow_L.csv",
  F = "../onset_correction_2026-11-25/replay_F/shadow_F.csv",
  boot = "../onset_correction_2026-11-25/tools/boot_uniforms.csv",
  hourly = "../rising-limb-travel-backtest/hourly_backtest_data_v39.csv",
  events = "../rising-limb-travel-backtest/rising_limb_events_python_v39.csv")
SHA <- c(L = "dcc63931841b537a834962b9a7c60e6edfd3b72b8bd491b43af89bbba0ba5aba",
         F = "7fb8072237cd21c99d196a7b2c1525f4aa850885638e4f06321617cdcf2a63a3",
         boot = "71d75af9b10c1ba4d3d9492f0e07d17497a35e01d3568d9b3ed8ab8fe528d515",
         hourly = "d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f",
         events = "978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44")
SIZE <- c(L = 109952178, F = 110149295, boot = 13000392, hourly = 10133893, events = 24205)

## ============================================================ helpers
numq <- function(x) suppressWarnings(as.numeric(x))
nsub <- function(s, a, b) numq(substr(s, a, b))

days_from_civil <- function(Y, M, D) {
  y <- Y - ifelse(M <= 2, 1, 0)
  era <- y %/% 400
  yoe <- y - era * 400
  doy <- (153 * (M + ifelse(M > 2, -3, 9)) + 2) %/% 5 + D - 1
  doe <- yoe * 365 + yoe %/% 4 - yoe %/% 100 + doy
  era * 146097 + doe - 719468
}
days_of <- function(s) days_from_civil(nsub(s, 1, 4), nsub(s, 6, 7), nsub(s, 9, 10))
K_of <- function(ts) days_of(ts) * 24 + nsub(ts, 12, 13)
S_of <- function(ts) days_of(ts) * 86400 + nsub(ts, 12, 13) * 3600 + nsub(ts, 15, 16) * 60 + nsub(ts, 18, 19)
epoch_ms <- function(s) {
  ss <- ifelse(nchar(s) >= 19, nsub(s, 18, 19), 0)
  mm <- ifelse(nchar(s) >= 23, nsub(s, 21, 23), 0)
  (days_of(s) * 86400 + nsub(s, 12, 13) * 3600 + nsub(s, 15, 16) * 60 + ss) * 1000 + mm
}
conv_ev <- function(s) paste0(sub(" ", "T", s, fixed = TRUE), ":00.000Z")

split_lines <- function(lines) {
  sp <- strsplit(paste0(lines, SENT), ",", fixed = TRUE)
  lapply(sp, function(v) { v[length(v)] <- substr(v[length(v)], 1L, nchar(v[length(v)]) - 1L); v })
}

fmt6 <- function(x) {
  out <- character(length(x))
  na <- is.na(x)
  if (any(!na & !is.finite(x))) stop("non-finite number to write")
  s <- sprintf("%.6f", x[!na])
  s[s == "-0.000000"] <- "0.000000"
  out[!na] <- s
  out
}
fmti <- function(x) {
  out <- character(length(x))
  na <- is.na(x)
  out[!na] <- sprintf("%d", x[!na])
  out
}
mic <- function(s) {
  if (is.na(s) || s == "") return(NA_real_)
  if (s == "-0.000000") s <- "0.000000"
  numq(sub(".", "", s, fixed = TRUE))
}

pctile <- function(xs, p) {
  m <- length(xs)
  pos <- (m - 1) * p
  i <- floor(pos)
  frac <- pos - i
  if (i + 1 > m - 1) xs[i + 1] else xs[i + 1] + frac * (xs[i + 2] - xs[i + 1])
}

truth_fun <- function(tau, mk, mv) {
  lo0 <- ((tau - CENTER) %/% HOUR) * HOUR
  cLo <- lo0 + CENTER
  cHi <- lo0 + HOUR + CENTER
  ilo <- match(lo0, mk)
  ihi <- match(lo0 + HOUR, mk)
  lo <- mv[ilo]
  hi <- mv[ihi]
  haslo <- !is.na(ilo)
  hashi <- !is.na(ihi)
  v <- rep(NA_real_, length(tau))
  b <- haslo & hashi
  v[b] <- lo[b] + (hi[b] - lo[b]) * ((tau[b] - cLo[b]) / HOUR)
  c2 <- !b & haslo & ((tau - cLo) <= HOUR)
  v[c2] <- lo[c2]
  c3 <- !b & !c2 & hashi & ((cHi - tau) <= HOUR)
  v[c3] <- hi[c3]
  v
}
in_range <- function(v) v >= 500.0 & v <= 500000.0

## ============================================================ rules
## tb: list of vectors over rows: ts, kk, flowState, tempC, d6, span, porQ, lfCap,
##     srcS (seconds of lfSrcTs, NA if blank), Tt (travelGFtoLF), a (age_lf_h), rawUnc, corrUsed
lf_lim <- function(k, tb, idx, L, PROD) {
  Tt <- tb$Tt[idx]; a <- tb$a[idx]
  r <- match(tb$kk[idx] - k, tb$kk)
  fb <- is.na(Tt) | is.na(a) | is.na(r)
  r0 <- r; r0[is.na(r0)] <- 1L
  Lk <- tb$lfCap[r0]; sk <- tb$srcS[r0]; si <- tb$srcS[idx]
  fb <- fb | is.na(Lk) | is.na(sk) | is.na(si)
  e <- (si - sk) / 3600.0
  fb <- fb | (!is.na(e) & e <= 0)
  lim <- PROD
  ok <- !fb
  g <- L[ok] + (((L[ok] - Lk[ok]) * (Tt[ok] + a[ok])) / e[ok])
  m <- pmax(L[ok], g)
  lim[ok] <- pmin(2.0 * L[ok], 1.2 * m)
  list(lim = lim, fb = fb)
}
mr_lim <- function(tb, idx, L, PROD, u) {
  n <- length(idx)
  Tt <- tb$Tt[idx]; a <- tb$a[idx]
  ok <- !(is.na(Tt) | is.na(a))
  h <- rep(NA_real_, n)
  h[ok] <- floor((Tt[ok] + a[ok]) + 0.5)
  ok <- ok & !(!is.na(h) & h <= 0)
  r <- rep(NA_integer_, n)
  r[ok] <- match(tb$kk[idx][ok] - h[ok], tb$kk)
  ok <- ok & !is.na(r)
  noest <- rep(FALSE, n)
  noest[ok] <- is.na(tb$rawUnc[r[ok]]) | is.na(tb$corrUsed[r[ok]])
  ok <- ok & !noest
  uh <- rep(NA_real_, n)
  uh[ok] <- tb$rawUnc[r[ok]] - tb$corrUsed[r[ok]]
  ok <- ok & !(!is.na(uh) & uh <= 0)
  lim <- PROD
  ratio <- u[ok] / uh[ok]
  lim[ok] <- pmin(2.0, 1.2 * pmax(1.0, ratio)) * L[ok]
  list(lim = lim, fb = !ok)
}
up_lim <- function(tb, idx, L, PROD) {
  n <- length(idx)
  Tt <- tb$Tt[idx]; a <- tb$a[idx]
  d6 <- tb$d6[idx]; sp <- tb$span[idx]; pq <- tb$porQ[idx]
  fb <- is.na(Tt) | is.na(a)
  fb <- fb | is.na(d6) | (!is.na(d6) & d6 <= 0)
  fb <- fb | is.na(sp) | (!is.na(sp) & sp <= 0)
  fb <- fb | is.na(pq)
  ok <- !fb
  pd <- rep(NA_real_, n)
  pd[ok] <- pq[ok] - d6[ok]
  fb <- fb | (ok & pd <= 0)
  ok <- !fb
  lim <- PROD
  p <- ((d6[ok] / (pq[ok] - d6[ok])) * (Tt[ok] + a[ok])) / sp[ok]
  lim[ok] <- pmin(2.0, 1.2 * (1.0 + p)) * L[ok]
  list(lim = lim, fb = fb)
}
ice_lim <- function(ts, PROD) {
  M <- as.integer(substr(ts, 6, 7))
  ifelse(M %in% c(11L, 12L, 1L, 2L, 3L), PROD, Inf)
}
MULT <- c(F135 = 1.35, F150 = 1.5, F200 = 2.0, T110 = 1.1, F125 = 1.25, F130 = 1.3,
          F140 = 1.4, F175 = 1.75)
rule_calc <- function(rule, tb, idx) {
  L <- tb$lfCap[idx]
  PROD <- 1.2 * L
  u <- tb$rawUnc[idx] - tb$corrUsed[idx]
  fb <- rep(FALSE, length(idx))
  defined <- rep(TRUE, length(idx))
  if (rule == "P") lim <- PROD
  else if (rule %in% names(MULT)) lim <- MULT[[rule]] * L
  else if (rule == "LF3") { z <- lf_lim(3, tb, idx, L, PROD); lim <- z$lim; fb <- z$fb }
  else if (rule == "LF6") { z <- lf_lim(6, tb, idx, L, PROD); lim <- z$lim; fb <- z$fb }
  else if (rule == "MR") { z <- mr_lim(tb, idx, L, PROD, u); lim <- z$lim; fb <- z$fb }
  else if (rule == "UP") { z <- up_lim(tb, idx, L, PROD); lim <- z$lim; fb <- z$fb }
  else if (rule == "RIS") lim <- ifelse(tb$flowState[idx] == "rising", Inf, PROD)
  else if (rule == "ICE") lim <- ice_lim(tb$ts[idx], PROD)
  else if (rule == "N") lim <- rep(Inf, length(idx))
  else if (rule == "ICE-T") {
    defined <- tb$ts[idx] >= T_ICET
    tc <- tb$tempC[idx]
    lim <- ifelse(is.na(tc), ice_lim(tb$ts[idx], PROD), ifelse(tc <= 5.0, PROD, Inf))
    lim[!defined] <- NA_real_
  } else stop("unknown rule ", rule)
  v <- pmin(u, lim)
  list(lim = lim, shown = floor(v + 0.5), z = v + 0.5, fb = fb, defined = defined, u = u)
}

## ============================================================ errors and measures
make_D <- function(shown, truth) {
  nm <- names(shown)
  mk <- function() setNames(vector("list", length(nm)), nm)
  err <- mk(); ae <- mk(); off <- mk(); low <- mk(); high <- mk(); differs <- mk(); d <- mk()
  for (r in nm) {
    e <- ((shown[[r]] - truth) / truth) * 100.0
    err[[r]] <- e; ae[[r]] <- abs(e)
    off[[r]] <- abs(e) >= 15; low[[r]] <- e <= -15; high[[r]] <- e >= 15
  }
  for (r in nm) {
    differs[[r]] <- shown[[r]] != shown$P
    d[[r]] <- ae[[r]] - ae$P
  }
  list(shown = shown, err = err, ae = ae, off = off, low = low, high = high,
       differs = differs, d = d)
}
cls_of <- function(e) ifelse(e <= -15, "low", ifelse(e >= 15, "high", "within"))

meas <- function(D, H, rule) {
  base <- if (rule == "P_icet_hours") "P" else rule
  isP <- base == "P"
  n <- length(H)
  res <- list(n = n, mae = NA_real_, bias = NA_real_, off = NA_real_, low = NA_real_,
              high = NA_real_, mean_d = NA_real_, off_diff = NA_real_, low_diff = NA_real_,
              high_diff = NA_real_, mae_rel = NA_real_, n_differ = 0,
              cOff = 0, cLow = 0, cHigh = 0, cOffP = 0, cLowP = 0, cHighP = 0)
  if (n == 0) return(res)
  mae <- sum(D$ae[[base]][H]) / n
  bias <- sum(D$err[[base]][H]) / n
  cOff <- sum(D$off[[base]][H]); cLow <- sum(D$low[[base]][H]); cHigh <- sum(D$high[[base]][H])
  maeP <- sum(D$ae$P[H]) / n
  cOffP <- sum(D$off$P[H]); cLowP <- sum(D$low$P[H]); cHighP <- sum(D$high$P[H])
  res$mae <- mae; res$bias <- bias
  res$off <- (100.0 * cOff) / n; res$low <- (100.0 * cLow) / n; res$high <- (100.0 * cHigh) / n
  res$cOff <- cOff; res$cLow <- cLow; res$cHigh <- cHigh
  res$cOffP <- cOffP; res$cLowP <- cLowP; res$cHighP <- cHighP
  if (isP) {
    res$mean_d <- 0; res$off_diff <- 0; res$low_diff <- 0; res$high_diff <- 0
    res$mae_rel <- if (maeP == 0) NA_real_ else 0
    res$n_differ <- 0
  } else {
    res$mean_d <- sum(D$d[[base]][H]) / n
    res$off_diff <- (100.0 * (cOff - cOffP)) / n
    res$low_diff <- (100.0 * (cLow - cLowP)) / n
    res$high_diff <- (100.0 * (cHigh - cHighP)) / n
    res$mae_rel <- if (maeP == 0) NA_real_ else (mae - maeP) / maeP
    res$n_differ <- sum(D$differs[[base]][H])
  }
  res
}
## RS: run set (D, pop, per, icet, blk)
cell_H <- function(RS, period, popname, rule) {
  m <- RS$per[[period]] & RS$pop[[popname]]
  if (rule %in% c("ICE-T", "P_icet_hours")) m <- m & RS$icet
  which(m)
}
cell <- function(RS, period, popname, rule) meas(RS$D, cell_H(RS, period, popname, rule), rule)

## ============================================================ pick, decision, labels
do_pick <- function(mean_d, c_off, n_r, cP) {
  qual <- mean_d <= 0
  nq <- sum(qual)
  leader <- NA_character_
  tied <- rep(FALSE, length(CAND)); names(tied) <- CAND
  first <- NA_character_
  pick <- NA_character_
  if (nq > 0) {
    cq <- c_off; cq[!qual] <- Inf
    leader <- CAND[which.min(cq)]
    tied <- qual & (1000 * (c_off - c_off[[leader]]) <= n_r)
    for (r in TIE_ORDER) if (tied[[r]]) { first <- r; break }
    if (!is.na(first) && c_off[[first]] < cP) pick <- first
  }
  list(qual = qual, nq = nq, leader = leader, tied = tied, first = first, pick = pick)
}
COND_NAMES <- c("cond1_rising_off", "cond2_overall", "cond3_high_all", "cond4_high_rising",
                "cond5_large_rises", "cond6_halves", "cond7_timing_arm_F", "cond8_high_water",
                "cond9_low_water")
decide <- function(inp, has_pick) {
  if (!has_pick) return(list(conds = setNames(rep("not_applicable", 9), COND_NAMES), verdict = "KEEP"))
  m <- function(nm) mic(inp[[nm]])
  pf <- function(x) if (isTRUE(x)) "pass" else "fail"
  conds <- c(
    pf(m("c1_off_diff_rising") <= -1000000 && m("c1_ci_hi") < 0),
    pf(m("c2_mean_d_all") <= 50000),
    pf(m("c3_high_diff_all") <= 500000),
    pf(m("c4_high_diff_rising") <= 1500000),
    pf(m("c5_off_diff_rl") <= 0 && m("c5_rel_mae_rl") <= 50000),
    pf(m("c6_off_diff_half1") < 0 && m("c6_off_diff_half2") < 0),
    pf(m("c7_off_diff_rising_F") < 0),
    pf(m("c8_rel_mae_high") <= 50000),
    pf(m("c9_rel_mae_low") <= 50000))
  names(conds) <- COND_NAMES
  hi <- m("c1_ci_hi")
  verdict <- if (all(conds == "pass")) "BETTER_RULE_FOUND"
             else if (is.na(hi) || hi >= 0) "KEEP" else "UNCLEAR"
  list(conds = conds, verdict = verdict)
}
label_of <- function(lo, hi) {
  if (is.na(lo) || lo == "" || is.na(hi) || hi == "") return("unclear")
  if (mic(lo) > 0) "good_job" else if (mic(hi) < 0) "harm" else "unclear"
}

## ============================================================ unit tests
make_U <- function() {
  k <- 0:12
  tb <- list()
  tb$ts <- sprintf("2020-12-01T%02d:00:00.000Z", k)
  tb$status <- rep("predicted", 13)
  tb$flowState <- rep("steady", 13); tb$flowState[13] <- "rising"
  tb$Tt <- rep(4.5, 13); tb$a <- rep(1, 13)
  tb$tempC <- rep(NA_real_, 13); tb$d6 <- rep(NA_real_, 13)
  tb$span <- rep(NA_real_, 13); tb$porQ <- rep(NA_real_, 13)
  tb$rawUnc <- rep(2100, 13); tb$corrUsed <- rep(100, 13)
  tb$rawUnc[13] <- 2600; tb$d6[13] <- 400; tb$porQ[13] <- 2000; tb$span[13] <- 4
  tb$lfCap <- c(1000, 1000, 1000, 1000, 1050, 1100, 1200, 1250, 1300, 1350, 1400, 1450, 1500)
  tb$lfSrcTs <- c("2020-11-30T23:00:00.000Z", sprintf("2020-12-01T%02d:00:00.000Z", 0:11))
  tb$lfSrcTs[7] <- "2020-12-01T04:30:00.000Z"
  tb$base <- k == 12
  fin_U(tb)
}
fin_U <- function(tb) {
  tb$kk <- K_of(tb$ts)
  tb$srcS <- ifelse(tb$lfSrcTs == "", NA_real_, S_of(tb$lfSrcTs))
  tb
}
del_row <- function(tb, k) {
  keep <- setdiff(seq_along(tb$ts), k + 1)
  for (nm in names(tb)) tb[[nm]] <- tb[[nm]][keep]
  tb
}
near <- function(a, b, tol = 1e-9) isTRUE(abs(a - b) <= tol)

unit_tests <- function() {
  res <- list()
  run <- function(name, f) { ok <- tryCatch(isTRUE(f()), error = function(e) FALSE); res[[name]] <<- if (ok) 0L else 1L }
  U <- make_U()
  ev <- function(tb, rule) rule_calc(rule, tb, which(tb$base))
  run("unit_round", function() {
    fl <- function(x) floor(x + 0.5)
    fl(0.5) == 1 && fl(2.4) == 2 && fl(2.5) == 3 && fl(-0.5) == 0 && fl(-1.5) == -1 &&
      fl(8.49) == 8 && fl(8.5) == 9
  })
  run("unit_key", function() {
    K_of("2020-01-01T00:00:00.000Z") == 438288 && K_of("2012-12-01T00:00:00.000Z") == 376200 &&
      K_of("2019-12-31T23:00:00.000Z") == 438287 && K_of("2026-11-09T23:00:00.000Z") == 498407 &&
      K_of("1970-01-01T00:00:00.000Z") == 0
  })
  run("unit_time", function() {
    S_of("2020-12-01T11:00:36.000Z") - S_of("2020-12-01T08:00:00.000Z") == 10836 &&
      epoch_ms("2012-01-01 00:00") == 1325376000000 && epoch_ms("1970-01-01 00:30") == 1800000 &&
      epoch_ms("2013-06-01T05:49:00.000Z") == 1370065740000 &&
      epoch_ms("2013-06-01T05:49:00.000Z") == epoch_ms("2013-06-01 05:49") &&
      conv_ev("2015-06-20 12:00") == "2015-06-20T12:00:00.000Z" &&
      K_of(conv_ev("2015-06-20 12:00")) == 398556
  })
  run("unit_rules", function() {
    ok <- TRUE
    ex <- function(c) if (!isTRUE(c)) ok <<- FALSE
    chk <- function(tb, rule, lim, shown, tol = 0) {
      rc <- ev(tb, rule)
      okl <- if (is.infinite(lim)) is.infinite(rc$lim) else if (tol > 0) near(rc$lim, lim, tol) else isTRUE(rc$lim == lim)
      ex(okl && isTRUE(rc$shown == shown))
    }
    chk(U, "P", 1800, 1800)
    chk(U, "F135", 2025, 2025, 1e-9); chk(U, "F150", 2250, 2250); chk(U, "F200", 3000, 2500)
    chk(U, "T110", 1650, 1650, 1e-9); chk(U, "F125", 1875, 1875); chk(U, "F130", 1950, 1950)
    chk(U, "F140", 2100, 2100); chk(U, "F175", 2625, 2500)
    chk(U, "LF3", 2130, 2130)
    chk(U, "LF6", 2104.6153846153843, 2105, 1e-9)
    chk(U, "MR", 2250, 2250)
    chk(U, "UP", 2418.75, 2419)
    chk(U, "RIS", Inf, 2500); chk(U, "ICE", 1800, 1800); chk(U, "N", Inf, 2500)
    ## LF3 with row 9 lfCap 1600
    t <- U; t$lfCap[10] <- 1600; chk(t, "LF3", 1800, 1800)
    t <- U; t$lfSrcTs[13] <- "2020-12-01T11:00:36.000Z"; t <- fin_U(t)
    chk(t, "LF3", 2128.9036544850496, 2129, 1e-9)
    ## ceiling
    t <- U; t$rawUnc[13] <- 3600
    chk(t, "F200", 3000, 3000); chk(t, "N", Inf, 3500); chk(t, "P", 1800, 1800)
    t2 <- t; t2$lfCap[10] <- 100; chk(t2, "LF3", 3000, 3000)
    t2 <- t; t2$lfCap[7] <- 100; chk(t2, "LF6", 3000, 3000)
    t2 <- t; t2$rawUnc[7] <- 130; chk(t2, "MR", 3000, 3000)
    t2 <- t; t2$d6[13] <- 1200; chk(t2, "UP", 3000, 3000)
    ## MR variants
    t <- U; t$Tt[13] <- 5.5; t$rawUnc[6] <- 2300; chk(t, "MR", 2045.4545454545457, 2045, 1e-9)
    t <- U; t$Tt[13] <- 4.0; t$a[13] <- 0.5; t$rawUnc[8] <- 2300; chk(t, "MR", 2045.4545454545457, 2045, 1e-9)
    t <- U; t$status[7] <- "no_truth"; chk(t, "MR", 2250, 2250)
    t <- U; t$status[7] <- "no_por"; chk(t, "MR", 2250, 2250)
    ## rounding half up
    t <- U; t$lfCap[13] <- 1501; t$rawUnc[13] <- 3100
    chk(t, "P", 1801.2, 1801, 1e-9); chk(t, "F150", 2251.5, 2252); chk(t, "N", Inf, 3000)
    t <- U; t$lfCap[13] <- 1500; t$rawUnc[13] <- 1700.5; t$corrUsed[13] <- 0; chk(t, "N", Inf, 1701)
    ## ICE
    ice_case <- function(ts, lim, shown) { t <- U; t$ts[13] <- ts; t <- fin_U(t); chk(t, "ICE", lim, shown) }
    ice_case("2021-03-31T23:00:00.000Z", 1800, 1800); ice_case("2021-04-01T00:00:00.000Z", Inf, 2500)
    ice_case("2021-10-31T23:00:00.000Z", Inf, 2500); ice_case("2021-11-01T00:00:00.000Z", 1800, 1800)
    ice_case("2022-01-15T05:00:00.000Z", 1800, 1800)
    ## ICE-T
    icet_case <- function(ts, temp, lim, shown) {
      t <- U; t$ts[13] <- ts; t$tempC[13] <- temp; t <- fin_U(t); chk(t, "ICE-T", lim, shown)
    }
    icet_case("2021-05-07T00:00:00.000Z", 5, 1800, 1800)
    icet_case("2021-07-07T00:00:00.000Z", 5.0000001, Inf, 2500)
    icet_case("2021-12-07T00:00:00.000Z", NA_real_, 1800, 1800)
    icet_case("2021-07-07T00:00:00.000Z", NA_real_, Inf, 2500)
    icet_case("2021-07-07T00:00:00.000Z", -1, 1800, 1800)
    icet_case("2021-12-07T00:00:00.000Z", 20, Inf, 2500)
    icet_case("2021-12-07T00:00:00.000Z", 4.9, 1800, 1800)
    t <- U; t$ts[13] <- "2021-05-06T23:00:00.000Z"; t <- fin_U(t)
    ex(!ev(t, "ICE-T")$defined)
    ok
  })
  run("unit_fallbacks", function() {
    ok <- TRUE
    ex <- function(c) if (!isTRUE(c)) ok <<- FALSE
    fbc <- function(tb, rule, expect_fb = TRUE) {
      rc <- rule_calc(rule, tb, which(tb$base))
      ex(isTRUE(rc$lim == 1800) && isTRUE(rc$shown == 1800) && identical(as.logical(rc$fb), expect_fb))
    }
    t <- del_row(U, 9); fbc(t, "LF3")
    t <- del_row(U, 6); fbc(t, "LF6"); fbc(t, "MR")
    t <- U; t$lfCap[10] <- NA; fbc(t, "LF3")
    t <- U; t$lfSrcTs[10] <- "2020-12-01T11:00:00.000Z"; t <- fin_U(t); fbc(t, "LF3")
    t <- U; t$lfSrcTs[10] <- "2020-12-01T12:00:00.000Z"; t <- fin_U(t); fbc(t, "LF3")
    t <- U; t$lfSrcTs[10] <- ""; t <- fin_U(t); fbc(t, "LF3")
    t <- U; t$lfSrcTs[13] <- ""; t <- fin_U(t); fbc(t, "LF3"); fbc(t, "LF6")
    t <- U; t$a[13] <- NA; for (r in c("LF3", "LF6", "MR", "UP")) fbc(t, r)
    t <- U; t$Tt[13] <- NA; for (r in c("LF3", "LF6", "MR", "UP")) fbc(t, r)
    t <- U; t$rawUnc[7] <- NA; fbc(t, "MR")
    t <- U; t$corrUsed[7] <- NA; fbc(t, "MR")
    t <- U; t$rawUnc[7] <- 100; t$corrUsed[7] <- 100; fbc(t, "MR")
    t <- U; t$rawUnc[7] <- 100; t$corrUsed[7] <- 105; fbc(t, "MR")
    t <- U; t$rawUnc[7] <- 5100; fbc(t, "MR", expect_fb = FALSE)
    t <- U; t$d6[13] <- NA; fbc(t, "UP")
    t <- U; t$d6[13] <- 0; fbc(t, "UP")
    t <- U; t$d6[13] <- -50; fbc(t, "UP")
    t <- U; t$span[13] <- NA; fbc(t, "UP")
    t <- U; t$span[13] <- 0; fbc(t, "UP")
    t <- U; t$span[13] <- -1; fbc(t, "UP")
    t <- U; t$porQ[13] <- NA; fbc(t, "UP")
    t <- U; t$porQ[13] <- 400; fbc(t, "UP")
    t <- U; t$porQ[13] <- 300; fbc(t, "UP")
    t <- U; t$flowState[13] <- "steady"; fbc(t, "RIS", expect_fb = FALSE)
    ok
  })
  run("unit_error", function() {
    ok <- TRUE
    ex <- function(c) if (!isTRUE(c)) ok <<- FALSE
    e1 <- ((850 - 1000) / 1000) * 100.0
    e2 <- ((1150 - 1000) / 1000) * 100.0
    e3 <- ((17 - 20) / 20) * 100.0
    e4 <- ((1149 - 1000) / 1000) * 100.0
    ex(e1 == -15 && abs(e1) >= 15 && e1 <= -15 && !(e1 >= 15))
    ex(e2 == 15 && abs(e2) >= 15 && e2 >= 15 && !(e2 <= -15))
    ex(e3 == -15 && e3 <= -15)
    ex(near(e4, 14.9) && !(abs(e4) >= 15))
    D <- make_D(list(P = 850, X = 1100), 1000)
    ex(near(D$d$X, -5))
    ex(identical(cls_of(c(-15, -14.9, 14.9, 15)), c("low", "within", "within", "high")))
    ok
  })
  run("unit_measures", function() {
    D <- make_D(list(P = c(850, 1000, 1160, 1000), X = c(1000, 1000, 1000, 1200)), rep(1000, 4))
    m <- meas(D, 1:4, "X"); mp <- meas(D, 1:4, "P")
    near(m$n, 4) && near(mp$mae, 7.75) && near(m$mae, 5) && near(mp$bias, 0.25) && near(m$bias, 5) &&
      near(mp$off, 50) && near(m$off, 25) && near(mp$low, 25) && near(m$low, 0) &&
      near(mp$high, 25) && near(m$high, 25) && near(m$mean_d, -2.75) && near(m$off_diff, -25) &&
      near(m$low_diff, -25) && near(m$high_diff, 0) && near(m$mae_rel, -0.3548387096774194) &&
      near(m$n_differ, 3)
  })
  run("unit_pick", function() {
    ok <- TRUE
    ex <- function(c) if (!isTRUE(c)) ok <<- FALSE
    mk <- function(md, co) list(md = setNames(md, CAND), co = setNames(co, CAND))
    t1 <- mk(c(-0.1, -0.2, -0.3, 0.5, 0.0, 0.0000001, -1.0, 0.3, 0.0, 1.0),
             c(1900, 1893, 1950, 1000, 1890, 500, 1885, 500, 1894, 100))
    p <- do_pick(t1$md, t1$co, 10000, 2000)
    ex(identical(names(which(p$qual)), c("F135", "F150", "F200", "LF6", "UP", "ICE")))
    ex(p$nq == 6 && p$leader == "UP")
    ex(identical(names(which(p$tied)), c("F150", "LF6", "UP", "ICE")))
    ex(p$first == "F150" && identical(p$pick, "F150"))
    ex(sign(t1$md[["MR"]]) == 1)
    ex(is.na(do_pick(t1$md, t1$co, 10000, 1893)$pick))
    ex(is.na(do_pick(t1$md, t1$co, 10000, 1890)$pick))
    ex(is.na(do_pick(t1$md, t1$co, 10000, 1800)$pick))
    t2 <- mk(rep(1, 10), rep(100, 10)); p2 <- do_pick(t2$md, t2$co, 10000, 5000)
    ex(p2$nq == 0 && is.na(p2$pick) && is.na(p2$leader))
    md3 <- rep(1.0, 10); co3 <- rep(100, 10); names(md3) <- CAND; names(co3) <- CAND
    md3[c("LF3", "MR", "UP")] <- -0.1; co3[c("LF3", "MR", "UP")] <- c(1500, 1505, 1496)
    p3 <- do_pick(md3, co3, 10000, 3000)
    ex(p3$leader == "UP" && sum(p3$tied) == 3 && p3$first == "LF3" && identical(p3$pick, "LF3"))
    md4 <- rep(1.0, 10); co4 <- rep(100, 10); names(md4) <- CAND; names(co4) <- CAND
    md4[c("UP", "F135", "F150")] <- -0.1; co4[c("UP", "F135", "F150")] <- c(1000, 1010, 1011)
    p4 <- do_pick(md4, co4, 10000, 2000)
    ex(p4$leader == "UP" && p4$tied[["F135"]] && !p4$tied[["F150"]] && identical(p4$pick, "F135"))
    ok
  })
  run("unit_verdict", function() {
    ok <- TRUE
    ex <- function(c) if (!isTRUE(c)) ok <<- FALSE
    A <- list(c1_off_diff_rising = "-1.500000", c1_ci_lo = "-2.000000", c1_ci_hi = "-0.500000",
              c2_mean_d_all = "0.010000", c3_high_diff_all = "0.100000", c4_high_diff_rising = "0.200000",
              c5_off_diff_rl = "0.000000", c5_rel_mae_rl = "0.040000", c6_off_diff_half1 = "-1.000000",
              c6_off_diff_half2 = "-2.000000", c7_off_diff_rising_F = "-0.500000",
              c8_rel_mae_high = "0.000000", c9_rel_mae_low = "0.050000")
    chg <- function(...) { x <- A; a <- list(...); for (n in names(a)) x[[n]] <- a[[n]]; x }
    r <- decide(A, TRUE); ex(all(r$conds == "pass") && r$verdict == "BETTER_RULE_FOUND")
    r <- decide(chg(c1_ci_hi = "0.000000"), TRUE); ex(r$conds[[1]] == "fail" && r$verdict == "KEEP")
    r <- decide(chg(c1_ci_lo = "0.100000", c1_ci_hi = "0.900000"), TRUE); ex(r$conds[[1]] == "fail" && r$verdict == "KEEP")
    r <- decide(chg(c1_ci_hi = ""), TRUE); ex(r$conds[[1]] == "fail" && r$verdict == "KEEP")
    r <- decide(chg(c1_off_diff_rising = "-1.000000"), TRUE); ex(r$conds[[1]] == "pass")
    r <- decide(chg(c1_off_diff_rising = "-0.999999"), TRUE); ex(r$conds[[1]] == "fail" && r$verdict == "UNCLEAR")
    r <- decide(chg(c2_mean_d_all = "0.050000"), TRUE); ex(r$conds[[2]] == "pass")
    r <- decide(chg(c2_mean_d_all = "0.050001"), TRUE); ex(r$conds[[2]] == "fail" && r$verdict == "UNCLEAR")
    r <- decide(chg(c3_high_diff_all = "0.500000"), TRUE); ex(r$conds[[3]] == "pass")
    r <- decide(chg(c3_high_diff_all = "0.500001"), TRUE); ex(r$conds[[3]] == "fail")
    r <- decide(chg(c4_high_diff_rising = "1.500000"), TRUE); ex(r$conds[[4]] == "pass")
    r <- decide(chg(c4_high_diff_rising = "1.500001"), TRUE); ex(r$conds[[4]] == "fail")
    r <- decide(chg(c5_off_diff_rl = "0.000001"), TRUE); ex(r$conds[[5]] == "fail")
    r <- decide(chg(c5_rel_mae_rl = "0.050000"), TRUE); ex(r$conds[[5]] == "pass")
    r <- decide(chg(c5_rel_mae_rl = "0.050001"), TRUE); ex(r$conds[[5]] == "fail")
    r <- decide(chg(c6_off_diff_half1 = "-0.000001"), TRUE); ex(r$conds[[6]] == "pass")
    r <- decide(chg(c6_off_diff_half1 = "0.000000"), TRUE); ex(r$conds[[6]] == "fail" && r$verdict == "UNCLEAR")
    r <- decide(chg(c7_off_diff_rising_F = "0.000000"), TRUE); ex(r$conds[[7]] == "fail")
    r <- decide(chg(c8_rel_mae_high = "0.050001"), TRUE); ex(r$conds[[8]] == "fail")
    r <- decide(chg(c9_rel_mae_low = ""), TRUE); ex(r$conds[[9]] == "fail")
    r <- decide(A, FALSE); ex(all(r$conds == "not_applicable") && r$verdict == "KEEP")
    ok
  })
  run("unit_labels", function() {
    label_of("0.100000", "0.300000") == "good_job" && label_of("-0.300000", "-0.100000") == "harm" &&
      label_of("-0.100000", "0.200000") == "unclear" && label_of("0.000000", "0.200000") == "unclear" &&
      label_of("-0.200000", "0.000000") == "unclear" && label_of("", "0.200000") == "unclear" &&
      label_of("0.000001", "0.200000") == "good_job"
  })
  run("unit_percentile", function() {
    x <- as.numeric(1:10000)
    near(pctile(x, 0.025), 250.975) && near(pctile(x, 0.975), 9750.025)
  })
  run("unit_periods", function() {
    per <- function(ts) if (ts >= T_TEST0) "test" else if (ts >= T_DESIGN0) "design" else "burn"
    ym <- function(ts) nsub(ts, 1, 4) * 12 + nsub(ts, 6, 7)
    per("2019-12-31T23:00:00.000Z") == "design" && per("2020-01-01T00:00:00.000Z") == "test" &&
      per("2012-11-30T23:00:00.000Z") == "burn" && per("2012-12-01T00:00:00.000Z") == "design" &&
      ("2023-05-31T23:00:00.000Z" < T_HALF) && !("2023-06-01T00:00:00.000Z" < T_HALF) &&
      ym("2012-12") - (2012 * 12 + 12) == 0 && ym("2019-12") - (2012 * 12 + 12) == 84 &&
      ym("2020-01") - (2020 * 12 + 1) == 0 && ym("2026-11") - (2020 * 12 + 1) == 82
  })
  run("unit_boot_index", function() {
    bi <- function(n, B) (n * B) %/% 1e12
    ok <- bi(0, 85) == 0 && bi(999999999999, 85) == 84 && bi(0, 83) == 0 &&
      bi(999999999999, 83) == 82 && bi(500000000000, 7) == 3
    l2 <- readLines(P$boot, n = 2L, warn = FALSE)
    f1 <- numq(strsplit(l2[2], ",", fixed = TRUE)[[1]][1])
    ok && f1 == 343638232196 && bi(f1, 85) == 29 && bi(f1, 83) == 28
  })
  run("unit_truth", function() {
    ok <- TRUE
    ex <- function(c) if (!isTRUE(c)) ok <<- FALSE
    mk <- c(0, 3600000, 10800000); mv <- c(1000, 2000, 4000)
    tf <- function(tau) truth_fun(tau, mk, mv)
    ex(tf(2250000) == 1250); ex(tf(1350000) == 1000); ex(tf(3150000) == 1500)
    ex(tf(1349999) == 1000); ex(tf(5400000) == 2000); ex(tf(8551000) == 4000)
    ex(is.na(tf(18000000 + 1350000 + 5)))
    ex(in_range(500.0) && !in_range(499.9) && in_range(500000.0) && !in_range(500000.1))
    ok
  })
  run("unit_mic", function() {
    mic("0.500000") == 500000 && mic("-0.020000") == -20000 && mic("10.000000") == 10000000 &&
      mic("-1.000000") == -1000000 && fmt6(-0.0000001) == "0.000000" && mic(fmt6(-0.0000001)) == 0
  })
  res
}
UNIT_NAMES <- c("unit_round", "unit_key", "unit_time", "unit_rules", "unit_fallbacks", "unit_error",
                "unit_measures", "unit_pick", "unit_verdict", "unit_labels", "unit_percentile",
                "unit_periods", "unit_boot_index", "unit_truth", "unit_mic")

## ============================================================ output helpers
wr <- function(name, header, lines) {
  con <- file(file.path(OUT, name), "wb")
  writeLines(c(paste(header, collapse = ","), lines), con, sep = "\n", useBytes = TRUE)
  close(con)
}
CHK <- new.env()
add_chk <- function(name, arm, n, v) assign(paste(name, arm, sep = "|"), c(n, v), envir = CHK)
CHK_ORDER <- function(full = FALSE) {
  o <- c(paste0(UNIT_NAMES, "|-"), "C00_inputs_sha|-")
  c12 <- c("C01_rows_fields", "C02_header", "C03_predTs_form", "C04_hour_grid", "C05_numbers_parse",
           "C06_needed_nonblank", "C07_truth_positive", "C08_lfcap_lfq", "C09_shown_recomputed",
           "C10_err_corr", "C11_time_forms", "C12_blocks_cover")
  for (nm in c12) o <- c(o, paste0(nm, "|L"), paste0(nm, "|F"))
  o <- c(o, "C13_hourly_file|-", "C14_events_file|-", "C15_expected_counts|L",
         "C16_truth_rebuilt|L", "C16_truth_rebuilt|F", "C17_monotone|L", "C17_monotone|F")
  if (full) {
    for (nm in c("M1_err15_margin", "M1x_err15_exact", "M2_cap_margin", "M3_lfrise_margin",
                 "M4_floor_margin", "M4x_floor_exact")) o <- c(o, paste0(nm, "|L"), paste0(nm, "|F"))
    o <- c(o, "M5_pick_margin|L")
  }
  o
}
write_checks <- function(full = FALSE) {
  o <- CHK_ORDER(full)
  o <- o[vapply(o, function(k) exists(k, envir = CHK, inherits = FALSE), TRUE)]
  lines <- vapply(o, function(k) {
    p <- strsplit(k, "|", fixed = TRUE)[[1]]
    v <- get(k, envir = CHK)
    paste(p[1], p[2], sprintf("%d", v[1]), sprintf("%d", v[2]), sep = ",")
  }, "")
  wr("checks.csv", c("check", "arm", "n_checked", "n_violations"), unname(lines))
}
stop_run <- function(msg) {
  write_checks(FALSE)
  cat("STOP:", msg, "\n")
  quit(save = "no", status = 1)
}

## ============================================================ 1. unit tests
UT <- unit_tests()
for (nm in UNIT_NAMES) add_chk(nm, "-", 1, if (is.null(UT[[nm]])) 1L else UT[[nm]])
if (any(vapply(UNIT_NAMES, function(nm) get(paste0(nm, "|-"), envir = CHK)[2], 0) > 0))
  stop_run("a unit test failed")
cat("unit tests passed\n")

## ============================================================ 2. C00
shas <- tools::sha256sum(unlist(P))
names(shas) <- names(P)
c00v <- 0L
for (nm in names(P)) {
  if (!identical(unname(shas[[nm]]), unname(SHA[[nm]])) || file.size(P[[nm]]) != SIZE[[nm]]) c00v <- c00v + 1L
}
add_chk("C00_inputs_sha", "-", 5L, c00v)
if (c00v > 0) stop_run("C00 input files differ from the specification")
cat("C00 ok\n")

## ============================================================ 3. hourly file, truth map, C13
hl <- readLines(P$hourly, warn = FALSE)
hl <- hl[nzchar(hl) | seq_along(hl) < length(hl)]  # a blank last line is whitespace
hsp <- split_lines(hl)
hh <- hsp[[1]]
hd <- hsp[-1]
nfh <- lengths(hd)
c13v <- sum(nfh != 12)
c13v <- c13v + (length(hd) != 130416) + !(length(hh) >= 5 && hh[1] == "timestamp" && hh[5] == "lf_discharge")
good <- which(nfh == 12)
H_ts <- vapply(hd[good], function(v) v[1], "")
H_lf <- vapply(hd[good], function(v) v[5], "")
c13v <- c13v + sum(!grepl(RE_HTS, H_ts))
H_ep <- epoch_ms(H_ts)
if (length(H_ep) > 1) c13v <- c13v + sum(is.na(diff(H_ep)) | diff(H_ep) <= 0)
nb <- H_lf != ""
c13v <- c13v + sum(nb & !grepl(RE_NUM, H_lf))
lfv <- numq(H_lf)
c13v <- c13v + sum(nb & grepl(RE_NUM, H_lf) & !(lfv > 0))
add_chk("C13_hourly_file", "-", length(hd), as.integer(c13v))
mkeys <- H_ep[nb]
mvals <- lfv[nb]
dd <- !duplicated(mkeys, fromLast = TRUE)
HM <- list(k = mkeys[dd], v = mvals[dd])
cat("hourly map entries:", length(HM$k), "\n")

## ============================================================ 4. events
el <- readLines(P$events, warn = FALSE)
esp <- split_lines(el)
eh <- esp[[1]]
ed <- esp[-1]
c14v <- sum(lengths(ed) != 47)
need_e <- c("event_id", "event_t0", "event_class", "rl_start", "rl_end", "kept")
c14v <- c14v + sum(!(need_e %in% eh))
if (any(!(need_e %in% eh))) stop_run("events header lacks a required column")
efield <- function(nm) vapply(ed, function(v) if (length(v) >= 47) v[match(nm, eh)] else NA_character_, "")
e_id <- efield("event_id"); e_t0 <- efield("event_t0"); e_cl <- efield("event_class")
e_rs <- efield("rl_start"); e_re <- efield("rl_end"); e_kp <- efield("kept")
selr <- which(e_cl == "GATE" & e_kp == "1")
EV <- list(nsel = length(selr), id = e_id[selr], t0 = e_t0[selr], rs0 = e_rs[selr], re0 = e_re[selr])
c14v <- c14v + sum(!grepl(RE_HTS, EV$t0)) + sum(!grepl(RE_HTS, EV$rs0)) + sum(!grepl(RE_HTS, EV$re0))
EV$rs <- conv_ev(EV$rs0); EV$re <- conv_ev(EV$re0)
EV$per <- ifelse(EV$t0 < "2020-01-01 00:00", "design", "test")
EV$t0key <- K_of(conv_ev(EV$t0))
c14v <- c14v + (EV$nsel != 21) + (sum(EV$per == "design") != 8) + (sum(EV$per == "test") != 13)
cat("selected rises:", EV$nsel, "\n")

## ============================================================ 5. arms
read_arm <- function(arm) {
  path <- P[[arm]]
  hdr <- split_lines(readLines(path, n = 1L, warn = FALSE))[[1]]
  occ <- vapply(COLS22, function(nm) sum(hdr == nm), 0)
  c02 <- sum(occ != 1)
  add_chk("C02_header", arm, 22L, c02)
  if (c02 > 0) stop_run(paste("header problem in arm", arm))
  cc <- ifelse(hdr %in% COLS22, "character", "NULL")
  df <- read.csv(path, header = TRUE, colClasses = cc, quote = "", comment.char = "",
                 na.strings = character(0), stringsAsFactors = FALSE, check.names = FALSE)
  cf <- count.fields(path, sep = ",", quote = "", comment.char = "", blank.lines.skip = FALSE)
  nf <- cf[-1]
  add_chk("C01_rows_fields", arm, length(nf), as.integer(sum(nf != 87) + (length(nf) != 130987)))
  df
}

build_arm <- function(arm, EV) {
  df <- read_arm(arm)
  N <- nrow(df)
  ts <- df$predTs; status <- df$status; flowBin <- df$flowBin; flowState <- df$flowState
  tip <- df$truthInProdRange; tdh <- df$truthDependentHard
  lfSrcTs <- df$lfSrcTs; tauTs <- df$tauTs; erRaw <- df$errPctRaw; erCorrS <- df$errPctCorr
  nu <- lapply(setNames(NUMC, NUMC), function(cn) numq(df[[cn]]))
  ## C05
  n5 <- 0; v5 <- 0
  for (cn in NUMC) {
    nbk <- df[[cn]] != ""
    n5 <- n5 + sum(nbk)
    v5 <- v5 + sum(!grepl(RE_NUM, df[[cn]][nbk]))
  }
  add_chk("C05_numbers_parse", arm, n5, as.integer(v5))
  ## C03, C04
  ok03 <- grepl(RE_PTS, ts)
  add_chk("C03_predTs_form", arm, N, as.integer(sum(!ok03)))
  kk <- K_of(ts)
  dk <- kk[-1] - kk[-N]
  add_chk("C04_hour_grid", arm, N - 1L, as.integer(sum(is.na(dk) | dk != 1)))
  ## C11 (lfSrcTs part)
  nbl <- lfSrcTs != ""
  c11n <- sum(nbl); c11v <- sum(!grepl(RE_TIME, lfSrcTs[nbl]))
  ## scored hours
  alive <- rep(TRUE, N)
  conds <- list(status_not_predicted = status != "predicted", burn_in = ts < T_DESIGN0,
                truth_dependent_hard = tdh == "1", truth_out_of_range = tip == "0",
                blank_error = (erCorrS == "" | erRaw == ""))
  acc_rows <- c(N, 0, N)
  acc <- list(c(N, 0, N))
  for (cn in names(conds)) {
    rin <- sum(alive)
    dr <- alive & conds[[cn]]
    alive <- alive & !conds[[cn]]
    acc[[length(acc) + 1]] <- c(rin, sum(dr), sum(alive))
  }
  sc <- which(alive)
  nsc <- length(sc)
  ## C06
  blk <- is.na(nu$predictedCFS[sc]) | flowBin[sc] == "" | flowState[sc] == "" | is.na(nu$truthFlow[sc]) |
    tip[sc] == "" | tdh[sc] == "" | is.na(nu$rawUnc[sc]) | is.na(nu$corrUsed[sc]) |
    is.na(nu$lfCap[sc]) | is.na(nu$lfQ[sc]) | is.na(nu$age_lf_h[sc]) | is.na(nu$travelGFtoLF[sc]) |
    lfSrcTs[sc] == "" | tauTs[sc] == "" | erRaw[sc] == "" | is.na(nu$errPctCorr[sc])
  bad6 <- blk | !(flowState[sc] %in% c("rising", "steady", "falling")) | !(flowBin[sc] %in% BINS)
  add_chk("C06_needed_nonblank", arm, nsc, as.integer(sum(bad6)))
  ## truth
  tau0 <- epoch_ms(tauTs[sc])
  tr <- truth_fun(tau0, HM$k, HM$v)
  add_chk("C07_truth_positive", arm, nsc, as.integer(sum(!is.na(tr) & tr <= 0)))
  tf <- nu$truthFlow[sc]
  c16 <- abs(tr - tf) > 1e-6 * pmax(1.0, abs(tf))
  c16 <- is.na(tr) | is.na(tf) | is.na(c16) | c16
  add_chk("C16_truth_rebuilt", arm, nsc, as.integer(sum(c16)))
  c08 <- !(nu$lfCap[sc] == nu$lfQ[sc]) | !(nu$lfCap[sc] > 0)
  add_chk("C08_lfcap_lfq", arm, nsc, as.integer(sum(is.na(c08) | c08)))
  nt <- tauTs[sc]; nbt <- nt != ""
  c11n <- c11n + sum(nbt); c11v <- c11v + sum(!grepl(RE_TIME, nt[nbt]))
  add_chk("C11_time_forms", arm, c11n, as.integer(c11v))
  ## periods and blocks
  ts_s <- ts[sc]
  per <- list(design = ts_s >= T_DESIGN0 & ts_s < T_TEST0, test = ts_s >= T_TEST0)
  per$test_half1 <- per$test & ts_s < T_HALF
  per$test_half2 <- per$test & ts_s >= T_HALF
  ym <- nsub(ts_s, 1, 4) * 12 + nsub(ts_s, 6, 7)
  bi_d <- ym - (2012 * 12 + 12); bi_t <- ym - (2020 * 12 + 1)
  blkidx <- ifelse(per$design, bi_d, bi_t)
  c12 <- (per$design & !(bi_d >= 0 & bi_d <= 84)) | (per$test & !(bi_t >= 0 & bi_t <= 82)) |
    (!per$design & !per$test)
  add_chk("C12_blocks_cover", arm, nsc, as.integer(sum(is.na(c12) | c12)))
  fatal <- any(vapply(c("C06_needed_nonblank", "C16_truth_rebuilt", "C12_blocks_cover", "C07_truth_positive"),
                      function(k) get(paste(k, arm, sep = "|"), envir = CHK)[2], 0) > 0)
  if (fatal) {
    for (k in c("C09_shown_recomputed", "C10_err_corr", "C17_monotone")) add_chk(k, arm, 0L, 0L)
    return(list(fatal = TRUE, arm = arm, acc = acc))
  }
  ## table of all rows
  tb <- list(ts = ts, kk = kk, flowState = flowState, tempC = nu$tempC, d6 = nu$d6, span = nu$span_h,
             porQ = nu$porQ, lfCap = nu$lfCap,
             srcS = ifelse(lfSrcTs == "", NA_real_, S_of(lfSrcTs)),
             Tt = nu$travelGFtoLF, a = nu$age_lf_h, rawUnc = nu$rawUnc, corrUsed = nu$corrUsed)
  Ls <- nu$lfCap[sc]; us <- nu$rawUnc[sc] - nu$corrUsed[sc]
  ## rules
  shown <- setNames(vector("list", length(RULES17)), RULES17)
  fbs <- list(); zs <- list()
  for (r in RULES17) {
    rc <- rule_calc(r, tb, sc)
    shown[[r]] <- rc$shown; fbs[[r]] <- rc$fb; zs[[r]] <- rc$z
  }
  D <- make_D(shown, tr)
  c09 <- shown$P != nu$predictedCFS[sc]
  add_chk("C09_shown_recomputed", arm, nsc, as.integer(sum(is.na(c09) | c09)))
  c10 <- abs(D$err$P - nu$errPctCorr[sc]) > 1e-9
  add_chk("C10_err_corr", arm, nsc, as.integer(sum(is.na(c10) | c10)))
  ## populations
  rising <- flowState[sc] == "rising"
  capped <- us > 1.2 * Ls
  r3 <- match(kk[sc] - 3, kk)
  L3 <- nu$lfCap[r3]
  lfr <- !is.na(L3) & (Ls >= 1.02 * L3)
  rid <- integer(nsc); nin <- integer(nsc)
  for (j in seq_len(EV$nsel)) {
    inr <- ts_s >= EV$rs[j] & ts_s <= EV$re[j]
    nin <- nin + inr
    rid[inr & rid == 0L] <- j
  }
  cls_rise <- vapply(seq_len(EV$nsel), function(j) {
    r <- match(EV$t0key[j], kk)
    if (is.na(r) || is.na(nu$porQ[r]) || is.na(nu$lfCap[r])) "notclassed"
    else if (nu$porQ[r] < 0.5 * nu$lfCap[r]) "lfled" else "upstream"
  }, "")
  rl <- rid > 0L
  rcls <- character(nsc); rcls[rl] <- cls_rise[rid[rl]]
  hper <- ifelse(ts_s < T_TEST0, "design", "test")
  c14_arm <- sum(nin > 1L) + sum(rl & hper != EV$per[pmax(rid, 1L)])
  fb_bin <- flowBin[sc]
  pop <- list(all = rep(TRUE, nsc), rising = rising, lf_rising = lfr, capped = capped,
              capped_rising = capped & rising, capped_notrising = capped & !rising,
              rl_large = rl, rl_large_upstream = rl & rcls == "upstream",
              rl_large_lfled = rl & rcls == "lfled", rl_large_notclassed = rl & rcls == "notclassed")
  for (b in BINS) pop[[paste0("bin_", b)]] <- fb_bin == b
  pop$high_water <- fb_bin %in% c("25000-50000", "50000+")
  pop$low_water <- fb_bin == "0-3000"
  pop <- pop[POPS]
  icet <- ts_s >= T_ICET
  RS <- list(D = D, pop = pop, per = per, icet = icet, blk = blkidx)
  ## tables
  cache <- new.env()
  tl <- vector("list", 4 * 18 * 18); ti <- 0
  c17n <- 0; c17v <- 0
  for (pr in PERIODS) for (pp in POPS) {
    Hb <- which(per[[pr]] & pop[[pp]])
    Hi <- Hb[icet[Hb]]
    for (r in RULES18) {
      H <- if (r %in% c("ICE-T", "P_icet_hours")) Hi else Hb
      m <- meas(D, H, r)
      assign(paste(pr, pp, r, sep = "|"), m, envir = cache)
      ti <- ti + 1
      tl[[ti]] <- c(pr, pp, r, fmti(m$n), fmt6(m$mae), fmt6(m$bias), fmt6(m$off), fmt6(m$low),
                    fmt6(m$high), fmt6(m$mean_d), fmt6(m$off_diff), fmt6(m$low_diff),
                    fmt6(m$high_diff), fmt6(m$mae_rel), fmti(m$n_differ))
      if (r %in% X15 && m$n > 0) {
        c17n <- c17n + 1
        if (m$cLow > m$cLowP || m$cHigh < m$cHighP) c17v <- c17v + 1
      }
    }
  }
  ## C17 pairs
  for (r in X15) {
    def <- which(!is.na(shown[[r]]))
    c17n <- c17n + length(def)
    c17v <- c17v + sum(shown[[r]][def] < shown$P[def]) + sum(D$differs[[r]][def] & !capped[def])
  }
  ## cap classes
  ccl <- list();
  for (pr in c("design", "test")) {
    Hc <- which(per[[pr]] & pop$capped)
    cn <- cls_of(D$err$N[Hc]); cp <- cls_of(D$err$P[Hc])
    cells <- list(); nm <- character(0); vals <- numeric(0)
    for (a in c("low", "within", "high")) for (b in c("low", "within", "high")) {
      nm <- c(nm, paste0("no_", a, "__cap_", b)); vals <- c(vals, sum(cn == a & cp == b))
    }
    Hr <- which(per[[pr]] & pop$rising)
    rl_low <- Hr[D$err$P[Hr] <= -15]
    nm <- c(nm, "reach_rising_low_P", "reach_rising_low_P_capped")
    vals <- c(vals, length(rl_low), sum(capped[rl_low]))
    ccl[[pr]] <- list(item = nm, n = vals, ncap = length(Hc))
  }
  if (arm == "L") {
    c17n <- c17n + 6
    for (pr in c("design", "test")) for (it in c("no_low__cap_within", "no_low__cap_high", "no_within__cap_high")) {
      if (ccl[[pr]]$n[match(it, ccl[[pr]]$item)] > 0) c17v <- c17v + 1
    }
  }
  add_chk("C17_monotone", arm, c17n, as.integer(c17v))
  ## M rows
  m1n <- 0; m1 <- 0; m1x <- 0; m4 <- 0; m4x <- 0
  for (r in RULES17) {
    ae <- D$ae[[r]]; def <- !is.na(ae)
    m1n <- m1n + sum(def)
    dd1 <- abs(ae - 15.0)
    m1 <- m1 + sum(def & dd1 > 0 & dd1 < 1e-9)
    m1x <- m1x + sum(def & ae == 15.0)
    z <- zs[[r]]; fz <- abs(z - floor(z + 0.5))
    m4 <- m4 + sum(!is.na(z) & fz > 0 & fz < 1e-9)
    m4x <- m4x + sum(!is.na(z) & z == floor(z + 0.5))
  }
  add_chk("M1_err15_margin", arm, m1n, as.integer(m1))
  add_chk("M1x_err15_exact", arm, m1n, as.integer(m1x))
  d2 <- abs(us - 1.2 * Ls)
  add_chk("M2_cap_margin", arm, nsc, as.integer(sum(d2 > 0 & d2 < 1e-9 * pmax(1.0, abs(us)))))
  has3 <- !is.na(L3)
  d3 <- abs(Ls - 1.02 * L3)
  add_chk("M3_lfrise_margin", arm, sum(has3), as.integer(sum(has3 & d3 > 0 & d3 < 1e-9 * pmax(1.0, abs(Ls)))))
  add_chk("M4_floor_margin", arm, m1n, as.integer(m4))
  add_chk("M4x_floor_exact", arm, m1n, as.integer(m4x))
  ## populations.csv items
  popl <- character(0)
  for (pr in c("design", "test")) {
    pm <- per[[pr]]
    items <- c(
      scored = sum(pm), capped = sum(pm & capped), rising = sum(pm & rising),
      capped_rising = sum(pm & capped & rising), lf_rising = sum(pm & lfr),
      lf_rising_capped = sum(pm & lfr & capped), rl_hours = sum(pm & rl),
      rl_rises = sum(EV$per == pr), rl_capped = sum(pm & rl & capped),
      d6_blank = sum(pm & is.na(nu$d6[sc])),
      span_zero = sum(pm & !is.na(nu$span_h[sc]) & nu$span_h[sc] == 0),
      mr_fallback = sum(pm & fbs$MR), mr_differs = sum(pm & D$differs$MR),
      up_fallback = sum(pm & fbs$UP), lf3_fallback = sum(pm & fbs$LF3), lf6_fallback = sum(pm & fbs$LF6),
      icet_hours = sum(pm & icet), icet_temp_blank = sum(pm & icet & is.na(nu$tempC[sc])),
      blocks = if (pr == "design") 85 else 83)
    popl <- c(popl, paste(arm, pr, names(items), fmti(items), sep = ","))
  }
  ## C15 counts (design, test)
  c15 <- list()
  for (pr in c("design", "test")) {
    pm <- per[[pr]]
    c15[[pr]] <- c(sum(pm), sum(pm & capped), sum(pm & rising), sum(pm & capped & rising), sum(pm & lfr),
                   sum(pm & lfr & capped), sum(pm & rl), sum(EV$per == pr), sum(pm & rl & capped),
                   sum(pm & is.na(nu$d6[sc])), sum(pm & !is.na(nu$span_h[sc]) & nu$span_h[sc] == 0),
                   sum(pm & fbs$MR), sum(pm & D$differs$MR))
  }
  list(fatal = FALSE, arm = arm, acc = acc, RS = RS, shown = shown, tau0 = tau0, cache = cache,
       tl = tl, ccl = ccl, popl = popl, c15 = c15, c14 = c14_arm, rid = rid, pop = pop, per = per,
       nsc = nsc)
}

A <- list()
for (arm in c("L", "F")) {
  cat("arm", arm, "...\n")
  A[[arm]] <- build_arm(arm, EV)
}
c14v <- c14v + A$L$c14 + A$F$c14
add_chk("C14_events_file", "-", length(ed), as.integer(c14v))
if (A$L$fatal || A$F$fatal) stop_run("an arm failed a data check (C06/C07/C12/C16)")

## C15
exp15 <- c(59999, 2137, 9272, 1238, 9885, 1296, 275, 8, 140, 498, 593, 120, 1903,
           59448, 2511, 9059, 1302, 10302, 1257, 452, 13, 240, 0, 81, 0, 2122)
exp15 <- c(59999, 59448, 2137, 2511, 9272, 9059, 1238, 1302, 9885, 10302, 1296, 1257, 275, 452,
           8, 13, 140, 240, 498, 0, 593, 81, 120, 0, 1903, 2122)
got15 <- as.vector(rbind(A$L$c15$design, A$L$c15$test))
add_chk("C15_expected_counts", "L", 26L, as.integer(sum(got15 != exp15)))

## stop if any C row has a violation
cnames <- CHK_ORDER(FALSE)
cnames <- cnames[grepl("^C", cnames)]
viol <- vapply(cnames, function(k) if (exists(k, envir = CHK, inherits = FALSE)) get(k, envir = CHK)[2] else 0, 0)
if (any(viol > 0)) {
  cat("violations:", paste(names(viol)[viol > 0], collapse = "; "), "\n")
  cat("C15 got:", got15, "\n")
  stop_run("a check has a violation")
}
cat("all stopping checks passed\n")

## ============================================================ 6. bootstrap setup
bu <- read.csv(P$boot, header = TRUE, colClasses = "numeric", check.names = FALSE)
cnt_mat <- function(B) {
  U <- as.matrix(bu[, paste0("u", seq_len(B))])
  J <- (U * B) %/% 1e12
  Cm <- matrix(0, nrow = nrow(U), ncol = B)
  for (r in seq_len(nrow(U))) Cm[r, ] <- tabulate(J[r, ] + 1, nbins = B)
  Cm
}
CM <- list("85" = cnt_mat(85), "83" = cnt_mat(83))

boot_iv <- function(x, blk, B) {
  n <- length(x)
  Cm <- CM[[as.character(B)]]
  S <- numeric(B); Nn <- numeric(B)
  if (n > 0) {
    sp <- split(x, factor(blk, levels = 0:(B - 1)))
    S <- vapply(sp, function(v) { s <- 0.0; if (length(v)) s <- sum(v); s }, 0.0, USE.NAMES = FALSE)
    Nn <- vapply(sp, length, 0, USE.NAMES = FALSE)
  }
  num <- numeric(nrow(Cm)); den <- numeric(nrow(Cm))
  for (j in seq_len(B)) { num <- num + Cm[, j] * S[j]; den <- den + Cm[, j] * Nn[j] }
  okd <- den > 0
  nskip <- sum(!okd)
  stat <- num[okd] / den[okd]
  est <- if (n > 0) sum(x) / n else NA_real_
  lo <- NA_real_; hi <- NA_real_
  if (!(nskip > 500 || n == 0)) {
    xs <- sort(stat)
    lo <- pctile(xs, 0.025); hi <- pctile(xs, 0.975)
  }
  list(n = n, est = est, lo = lo, hi = hi, nv = length(stat), ns = nskip)
}
iv_x <- function(RS, H, rule, xt) {
  if (xt == "d") RS$D$d[[rule]][H]
  else 100.0 * (as.numeric(RS$D$off[[rule]][H]) - as.numeric(RS$D$off$P[H]))
}
iv_row <- function(RS, period, rule, popname, xt) {
  H <- which(RS$per[[period]] & RS$pop[[popname]])
  B <- if (period == "design") 85 else 83
  boot_iv(iv_x(RS, H, rule, xt), RS$blk[H], B)
}

RL <- A$L$RS
GRP <- c("all", "capped", "capped_rising", "capped_notrising", "lf_rising", "rl_large")
ivs <- list()
add_iv <- function(id, period, rule, popname, xlab, res) {
  ivs[[length(ivs) + 1]] <<- list(id = id, period = period, rule = rule, pop = popname, x = xlab, r = res)
}
k <- 0
for (pr in c("design", "test")) for (g in GRP) {
  k <- k + 1
  add_iv(sprintf("I%02d", k), pr, "N", g, "d", iv_row(RL, pr, "N", g, "d"))
}
for (r in CAND) {
  k <- k + 1; add_iv(sprintf("I%02d", k), "test", r, "rising", "off_diff", iv_row(RL, "test", r, "rising", "off_diff"))
  k <- k + 1; add_iv(sprintf("I%02d", k), "test", r, "all", "d", iv_row(RL, "test", r, "all", "d"))
}

## ============================================================ 7. pick
Hr <- which(RL$per$design & RL$pop$rising)
n_r <- length(Hr)
c_off <- vapply(c("P", CAND), function(r) sum(RL$D$off[[r]][Hr]), 0)
md_all <- vapply(CAND, function(r) cell(RL, "design", "all", r)$mean_d, 0)
pk <- do_pick(md_all, c_off[CAND], n_r, c_off[["P"]])
pick <- pk$pick
has_pick <- !is.na(pick)
M5 <- sum(abs(md_all) > 0 & abs(md_all) < 1e-9)
add_chk("M5_pick_margin", "L", 10L, as.integer(M5))
pd_lines <- vapply(seq_along(CAND), function(i) {
  r <- CAND[i]
  paste(r, match(r, TIE_ORDER), fmt6(md_all[[r]]), fmt6((100.0 * c_off[[r]]) / n_r), fmti(c_off[[r]]),
        fmti(n_r), fmti(sign(md_all[[r]])), fmti(as.integer(pk$qual[[r]])),
        fmti(as.integer(!is.na(pk$leader) && pk$leader == r)),
        fmti(as.integer(pk$tied[[r]])), fmti(as.integer(!is.na(pk$first) && pk$first == r)), sep = ",")
}, "")
cat("pick:", if (has_pick) pick else "none", "\n")

## ============================================================ 8. timing runs
shift_rs <- function(Aa, s) {
  sel0 <- which(Aa$per$test)
  tau <- Aa$tau0[sel0] + s * 3600000
  v <- truth_fun(tau, HM$k, HM$v)
  miss <- is.na(v)
  outr <- !miss & !in_range(v)
  keep <- !miss & !outr
  sel <- sel0[keep]
  shown <- lapply(Aa$shown, function(x) x[sel])
  D <- make_D(shown, v[keep])
  list(RS = list(D = D, pop = lapply(Aa$pop, function(m) m[sel]), per = lapply(Aa$per, function(m) m[sel]),
                 icet = Aa$RS$icet[sel], blk = Aa$RS$blk[sel]),
       nm = sum(miss), nr = sum(outr), nl = length(sel))
}
SH <- c(-1, 1, 2); SHN <- c("m1", "p1", "p2")
SR <- list(L = list(), F = list())
for (arm in c("L", "F")) for (i in 1:3) SR[[arm]][[i]] <- shift_rs(A[[arm]], SH[i])

## S intervals
sivs <- list()
for (i in 1:3) {
  xl <- c("off_diff_shift_m1", "off_diff_shift_p1", "off_diff_shift_p2")[i]
  if (has_pick) sivs[[i]] <- iv_row(SR$L[[i]]$RS, "test", pick, "rising", "off_diff") else sivs[[i]] <- NULL
}

## ============================================================ 9. inputs and decisions
iv_find <- function(rule, popname, period = "test") {
  for (v in ivs) if (v$period == period && v$rule == rule && v$pop == popname) return(v$r)
  NULL
}
get_inputs <- function(RSL, RSF, ci) {
  m <- function(period, popname) cell(RSL, period, popname, pick)
  list(
    c1_off_diff_rising = fmt6(m("test", "rising")$off_diff),
    c1_ci_lo = fmt6(ci$lo), c1_ci_hi = fmt6(ci$hi),
    c2_mean_d_all = fmt6(m("test", "all")$mean_d),
    c3_high_diff_all = fmt6(m("test", "all")$high_diff),
    c4_high_diff_rising = fmt6(m("test", "rising")$high_diff),
    c5_n_rl = fmti(m("test", "rl_large")$n),
    c5_off_diff_rl = fmt6(m("test", "rl_large")$off_diff),
    c5_rel_mae_rl = fmt6(m("test", "rl_large")$mae_rel),
    c6_off_diff_half1 = fmt6(m("test_half1", "rising")$off_diff),
    c6_off_diff_half2 = fmt6(m("test_half2", "rising")$off_diff),
    c7_off_diff_rising_F = fmt6(cell(RSF, "test", "rising", pick)$off_diff),
    c8_rel_mae_high = fmt6(m("test", "high_water")$mae_rel),
    c9_rel_mae_low = fmt6(m("test", "low_water")$mae_rel))
}
INP_ORDER <- c("c1_off_diff_rising", "c1_ci_lo", "c1_ci_hi", "c2_mean_d_all", "c3_high_diff_all",
               "c4_high_diff_rising", "c5_n_rl", "c5_off_diff_rl", "c5_rel_mae_rl",
               "c6_off_diff_half1", "c6_off_diff_half2", "c7_off_diff_rising_F",
               "c8_rel_mae_high", "c9_rel_mae_low")
if (has_pick) {
  ci_main <- iv_find(pick, "rising")
  inp_main <- get_inputs(RL, A$F$RS, ci_main)
} else inp_main <- setNames(as.list(rep("", 14)), INP_ORDER)
dec <- decide(inp_main, has_pick)

## decision_inputs
di_names <- c("pick", "n_qualifiers", "leader", "leader_off_rising_design", "P_off_rising_design",
              "P_c_off_rising", "pick_off_rising_design", "pick_mean_d_all_design", INP_ORDER)
di_vals <- c(if (has_pick) pick else "none", fmti(pk$nq), if (is.na(pk$leader)) "none" else pk$leader,
             if (is.na(pk$leader)) "" else fmt6((100.0 * c_off[[pk$leader]]) / n_r),
             fmt6((100.0 * c_off[["P"]]) / n_r), fmti(c_off[["P"]]),
             if (has_pick) fmt6((100.0 * c_off[[pick]]) / n_r) else "",
             if (has_pick) fmt6(md_all[[pick]]) else "",
             unlist(inp_main[INP_ORDER], use.names = FALSE))
## timing tables
tp_lines <- character(0)
tflag_inputs <- list()
for (i in 1:3) {
  if (has_pick) {
    inp <- get_inputs(SR$L[[i]]$RS, SR$F[[i]]$RS, list(lo = sivs[[i]]$lo, hi = sivs[[i]]$hi))
  } else inp <- setNames(as.list(rep("", 14)), INP_ORDER)
  dd <- decide(inp, has_pick)
  tflag_inputs[[i]] <- inp
  vals <- c(unlist(inp[INP_ORDER], use.names = FALSE), unname(dd$conds), dd$verdict)
  items <- c(INP_ORDER, COND_NAMES, "verdict")
  tp_lines <- c(tp_lines, paste(sprintf("%d", SH[i]), items, vals, sep = ","))
}
tcand <- character(0)
for (i in 1:3) for (r in CAND) {
  RSs <- SR$L[[i]]$RS
  a <- cell(RSs, "test", "all", r); b <- cell(RSs, "test", "rising", r); cc <- cell(RSs, "test", "rl_large", r)
  tcand <- c(tcand, paste(sprintf("%d", SH[i]), r, fmti(a$n), fmt6(a$mean_d), fmti(b$n), fmt6(b$off_diff),
                          fmti(cc$n), fmt6(cc$off_diff), fmt6(cc$mae_rel), sep = ","))
}
## timing gate
tg_keys <- c("gate_n_checked", "gate_n_failing", "gate_passed", paste0("gate_fail_", 1:10))
tg_vals <- c(fmti(A$L$nsc), "0", "1", rep("", 10))
for (arm in c("L", "F")) for (i in 1:3) {
  pre <- if (arm == "L") "shift_" else "shiftF_"
  tg_keys <- c(tg_keys, paste0(pre, SHN[i], c("_n_missing", "_n_range", "_n_left")))
  tg_vals <- c(tg_vals, fmti(SR[[arm]][[i]]$nm), fmti(SR[[arm]][[i]]$nr), fmti(SR[[arm]][[i]]$nl))
}
tflag <- ""
if (has_pick) {
  s1 <- tflag_inputs[[1]]$c1_off_diff_rising
  if (s1 != "") {
    mm <- mic(inp_main$c1_off_diff_rising); ms <- mic(s1)
    tflag <- fmti(as.integer(isTRUE(mm < 0 && ms >= 0)))
  }
}
tg_keys <- c(tg_keys, "timing_flag"); tg_vals <- c(tg_vals, tflag)

## ============================================================ 10. other output tables
## row accounting
ra <- character(0)
stepn <- c("read", "status_not_predicted", "burn_in", "truth_dependent_hard", "truth_out_of_range", "blank_error")
for (arm in c("L", "F")) for (i in 1:6)
  ra <- c(ra, paste(arm, i - 1, stepn[i], fmti(A[[arm]]$acc[[i]][1]), fmti(A[[arm]]$acc[[i]][2]),
                    fmti(A[[arm]]$acc[[i]][3]), sep = ","))
## rule tables
rt <- character(0)
for (arm in c("L", "F")) rt <- c(rt, vapply(A[[arm]]$tl, function(v) paste(c(arm, v), collapse = ","), ""))
## cap description
cdl <- character(0)
iv_by_id <- function(id) for (v in ivs) if (v$id == id) return(v)
k <- 0
for (pr in c("design", "test")) for (g in GRP) {
  k <- k + 1
  v <- iv_by_id(sprintf("I%02d", k))
  m <- A$L$cache[[paste(pr, g, "N", sep = "|")]]
  lo <- fmt6(v$r$lo); hi <- fmt6(v$r$hi)
  cdl <- c(cdl, paste(pr, g, fmti(m$n), fmt6(m$mean_d), lo, hi, label_of(lo, hi), sep = ","))
}
## cap classes
ccs <- character(0)
for (pr in c("design", "test")) {
  cc <- A$L$ccl[[pr]]
  for (i in 1:9) ccs <- c(ccs, paste(pr, cc$item[i], fmti(cc$n[i]),
                                     if (cc$ncap > 0) fmt6((100.0 * cc$n[i]) / cc$ncap) else "", sep = ","))
  ccs <- c(ccs, paste(pr, cc$item[10], fmti(cc$n[10]), "", sep = ","))
  ccs <- c(ccs, paste(pr, cc$item[11], fmti(cc$n[11]),
                      if (cc$n[10] > 0) fmt6((100.0 * cc$n[11]) / cc$n[10]) else "", sep = ","))
}
## intervals
ivl <- vapply(ivs, function(v) {
  r <- v$r
  paste(v$id, v$period, v$rule, v$pop, v$x, fmti(r$n), fmt6(r$est), fmt6(r$lo), fmt6(r$hi),
        fmti(r$nv), fmti(r$ns), sep = ",")
}, "")
for (i in 1:3) {
  xl <- c("off_diff_shift_m1", "off_diff_shift_p1", "off_diff_shift_p2")[i]
  if (has_pick) {
    r <- sivs[[i]]
    ivl <- c(ivl, paste(sprintf("S%02d", i), "test", pick, "rising", xl, fmti(r$n), fmt6(r$est),
                        fmt6(r$lo), fmt6(r$hi), fmti(r$nv), fmti(r$ns), sep = ","))
  } else ivl <- c(ivl, paste(sprintf("S%02d", i), "test", "", "rising", xl, "", "", "", "", "", "", sep = ","))
}
## rises_test
rtl <- character(0)
tr_idx <- which(EV$per == "test")
RULES11 <- c("P", CAND)
cnt <- setNames(numeric(length(CAND)), CAND)
for (j in tr_idx) {
  Hj <- which(A$L$rid == j)
  n <- length(Hj)
  maes <- vapply(RULES11, function(r) if (n > 0) sum(RL$D$ae[[r]][Hj]) / n else NA_real_, 0)
  for (r in RULES11) {
    lt <- if (r == "P" || n == 0) NA_real_ else as.numeric(maes[[r]] < maes[["P"]])
    if (!is.na(lt) && lt == 1) cnt[[r]] <- cnt[[r]] + 1
    rtl <- c(rtl, paste(EV$id[j], EV$t0[j], r, fmti(n), fmt6(maes[[r]]), fmti(lt), sep = ","))
  }
}
for (r in CAND) rtl <- c(rtl, paste("COUNT", "", r, fmti(cnt[[r]]), "", "", sep = ","))

## ============================================================ 11. write everything
wr("checks.csv", c("check", "arm", "n_checked", "n_violations"), character(0))  # placeholder, rewritten below
write_checks(TRUE)
wr("row_accounting.csv", c("arm", "step", "condition", "rows_in", "rows_dropped", "rows_left"), ra)
wr("populations.csv", c("arm", "period", "item", "n"),
   unlist(lapply(c("L", "F"), function(arm) {
     x <- A[[arm]]$popl
     vapply(strsplit(x, ",", fixed = TRUE), function(v) paste(v, collapse = ","), "")
   })))
wr("rule_tables.csv", c("arm", "period", "population", "rule", "n", "mae", "bias", "off", "low", "high",
                        "mean_d", "off_diff", "low_diff", "high_diff", "mae_rel", "n_differ"), rt)
wr("cap_description.csv", c("period", "group", "n", "mean_d", "lo", "hi", "label"), cdl)
wr("cap_classes.csv", c("period", "item", "n", "share"), ccs)
wr("intervals.csv", c("id", "period", "rule", "population", "x", "n", "est", "lo", "hi", "n_valid", "n_skipped"), ivl)
wr("pick_design.csv", c("rule", "tie_order", "mean_d_all", "off_rising", "c_off_rising", "n_rising",
                        "mean_d_sign", "qualifies", "is_leader", "is_tied", "is_first_tied"), pd_lines)
wr("decision_inputs.csv", c("name", "value"), paste(di_names, di_vals, sep = ","))
wr("decision.csv", c("item", "result"), c(paste(COND_NAMES, dec$conds, sep = ","), paste("verdict", dec$verdict, sep = ",")))
wr("rises_test.csv", c("event_id", "event_t0", "rule", "n", "mae", "lower_than_P"), rtl)
wr("timing_gate.csv", c("key", "value"), paste(tg_keys, tg_vals, sep = ","))
wr("timing_candidates.csv", c("shift", "rule", "n_all", "mean_d_all", "n_rising", "off_diff_rising",
                              "n_rl", "off_diff_rl", "mae_rel_rl"), tcand)
wr("timing_pick.csv", c("shift", "item", "value"), tp_lines)
el_s <- as.numeric(difftime(Sys.time(), T_START, units = "secs"))
cat(sprintf("done in %.1f s\n", el_s))

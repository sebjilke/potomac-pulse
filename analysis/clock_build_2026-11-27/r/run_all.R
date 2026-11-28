Sys.setlocale("LC_COLLATE", "C")
options(warn = 1)
T_START <- Sys.time()

args_all <- commandArgs(FALSE)
fa <- sub("^--file=", "", args_all[grep("^--file=", args_all)])
if (length(fa) == 1 && nzchar(fa)) setwd(dirname(dirname(normalizePath(fa))))

OUT_FILES <- c("badly_low_rising.csv", "movement.csv", "groups.csv", "two_by_two.csv",
               "common_truth_errors.csv", "new_cap_yardsticks.csv", "new_readings.csv",
               "self_report.csv", "learning_health.csv", "checks.csv", "row_accounting.csv")
dir.create("r", showWarnings = FALSE)
unlink(file.path("r", OUT_FILES))

HOUR <- 3600000
CENTER <- 1350000
TAU_BEFORE <- 660000
DESIGN_START <- "2012-12-01T00:00:00.000Z"
TEST_START <- "2020-01-01T00:00:00.000Z"

## ---------------------------------------------------------------- basic functions
ssum <- function(x) { s <- 0.0; for (v in x) s <- s + v; s }
num <- function(s) suppressWarnings(as.numeric(s))
fl_half <- function(x) floor(x + 0.5)
fmt6 <- function(x) { s <- sprintf("%.6f", x); s[s == "-0.000000"] <- "0.000000"; s[is.na(x)] <- ""; s }
fmti <- function(x) { s <- sprintf("%d", as.integer(x)); s[is.na(x)] <- ""; s }
mic <- function(s) { if (is.na(s) || s == "") return(NA_real_); as.numeric(sub(".", "", s, fixed = TRUE)) }

days_from_civil <- function(y, m, d) {
  y <- y - ifelse(m <= 2, 1, 0)
  era <- y %/% 400
  yoe <- y - era * 400
  doy <- (153 * (m + ifelse(m > 2, -3, 9)) + 2) %/% 5 + d - 1
  doe <- yoe * 365 + yoe %/% 4 - yoe %/% 100 + doy
  era * 146097 + doe - 719468
}
hour_key <- function(s) {
  days_from_civil(as.numeric(substr(s, 1, 4)), as.numeric(substr(s, 6, 7)), as.numeric(substr(s, 9, 10))) * 24 +
    as.numeric(substr(s, 12, 13))
}
epoch_ms <- function(s) {
  days <- days_from_civil(as.numeric(substr(s, 1, 4)), as.numeric(substr(s, 6, 7)), as.numeric(substr(s, 9, 10)))
  hh <- as.numeric(substr(s, 12, 13)); mi <- as.numeric(substr(s, 15, 16))
  ss <- ifelse(nchar(s) >= 19, as.numeric(substr(s, 18, 19)), 0)
  mmm <- ifelse(nchar(s) >= 23, as.numeric(substr(s, 21, 23)), 0)
  (days * 86400 + hh * 3600 + mi * 60 + ss) * 1000 + mmm
}
evt_to_pred <- function(s) paste0(substr(s, 1, 10), "T", substr(s, 12, 13), ":00:00.000Z")
design_month <- function(s) as.numeric(substr(s, 1, 4)) * 12 + as.numeric(substr(s, 6, 7)) - (2012 * 12 + 12)
test_month <- function(s) as.numeric(substr(s, 1, 4)) * 12 + as.numeric(substr(s, 6, 7)) - (2020 * 12 + 1)
period_of <- function(s) ifelse(s < DESIGN_START, "burnin", ifelse(s < TEST_START, "design", "test"))

pctl <- function(x, p) {
  x <- sort(x); m <- length(x)
  pos <- (m - 1) * p; i <- floor(pos); fr <- pos - i
  if (i + 1 > m - 1) x[i + 1] else x[i + 1] + fr * (x[i + 2] - x[i + 1])
}
med <- function(x) {
  x <- sort(x); n <- length(x)
  if (n %% 2 == 1) x[(n - 1) / 2 + 1] else (x[n / 2] + x[n / 2 + 1]) / 2.0
}

look <- function(hm, idx) {
  out <- rep(NA_real_, length(idx))
  ok <- !is.na(idx) & idx >= 1 & idx <= length(hm)
  out[ok] <- hm[idx[ok]]
  out
}
truth_fn <- function(tau, hm, k0h) {
  na <- is.na(tau); t2 <- tau; t2[na] <- 0
  fl <- floor((t2 - CENTER) / HOUR)
  cLo <- fl * HOUR + CENTER
  cHi <- (fl + 1) * HOUR + CENTER
  lo <- look(hm, fl - k0h + 1)
  hi <- look(hm, fl + 1 - k0h + 1)
  v <- rep(NA_real_, length(t2))
  both <- !is.na(lo) & !is.na(hi)
  v[both] <- lo[both] + (hi[both] - lo[both]) * ((t2[both] - cLo[both]) / HOUR)
  c2 <- !both & !is.na(lo) & ((t2 - cLo) <= HOUR)
  v[c2] <- lo[c2]
  c3 <- !both & !c2 & !is.na(hi) & ((cHi - t2) <= HOUR)
  v[c3] <- hi[c3]
  v[na] <- NA_real_
  v
}
in_range <- function(v) !is.na(v) & v >= 500.0 & v <= 500000.0
clock_fn <- function(q) { qc <- pmin(pmax(q, 1400.0), 20000.0); 98.2 * qc^-0.3935 }
err_fn <- function(shown, truth) ((shown - truth) / truth) * 100.0
lagidx <- function(K, k, K0, n) { i <- (K - k) - K0 + 1; i[i < 1 | i > n] <- NA; i }

BINS <- c("0-3000", "3000-6000", "6000-12000", "12000-25000", "25000-50000", "50000+")
STATES <- c("rising", "steady", "falling", "all")
Q05 <- matrix(c(-547, -271, -315, -309,
                -676, -327, -391, -425,
                -1650, -404, -451, -628,
                -2384, -549, -514, -884,
                -3851, -2013, -1068, -2402,
                -7354, -5858, -4099, -5858), ncol = 4, byrow = TRUE)
Q95 <- matrix(c(369, 250, 336, 284,
                535, 287, 361, 356,
                1046, 320, 359, 506,
                1543, 425, 464, 741,
                2860, 1844, 1059, 1899,
                5519, 6410, 6429, 6410), ncol = 4, byrow = TRUE)
band_fn <- function(bin, state, est) {
  bi <- match(bin, BINS); si <- match(state, STATES); si[is.na(si)] <- 4
  q05 <- Q05[cbind(bi, si)]; q95 <- Q95[cbind(bi, si)]
  list(lo = pmax(0, est - q95), hi = est - q05)
}
y0_fn <- function(L) floor(L + 0.5)
y1_fn <- function(L, L3, a, clock) {
  y0 <- y0_fn(L)
  g <- ((L - L3) / 3.0) * (clock + a)
  r <- floor(L + pmax(0.0, g) + 0.5)
  ifelse(is.na(L3) | is.na(a), y0, r)
}
label_fn <- function(lo, hi, kind) {
  mlo <- mic(lo); mhi <- mic(hi)
  if (is.na(mlo) || is.na(mhi)) return("unclear")
  if (kind == "cap") {
    if (mlo > 0) "cap_closer" else if (mhi < 0) "cap_farther" else "unclear"
  } else {
    if (mlo > 0) "app_closer" else if (mhi < 0) "yardstick_closer" else "unclear"
  }
}
HOLD_LABELS <- c("cap_closer", "cap_farther", "app_closer", "yardstick_closer")
reading_fn <- function(l1, l2, l3) {
  r <- if (l1 == l2 && l2 == l3) l1 else "mixed"
  list(reading = r, holds = if (r %in% HOLD_LABELS) 1L else 0L)
}
jumps_fn <- function(K, raw, corr, est, K0) {
  n <- length(K)
  ip <- lagidx(K, 1, K0, n)
  prev_est <- rep(FALSE, n); has <- !is.na(ip); prev_est[has] <- est[ip[has]]
  step <- est & prev_est & !is.na(raw) & (raw > 0)
  step[is.na(step)] <- FALSE
  jump <- rep(NA_real_, n)
  jump[step] <- (100.0 * abs(corr[step] - corr[ip[step]])) / raw[step]
  jump
}
mv_fn <- function(o, n) {
  keep <- o > 0
  list(m = ((n[keep] - o[keep]) / o[keep]) * 100.0, excl = sum(!keep))
}

## ---------------------------------------------------------------- checks machinery
CHK <- new.env(); CHK$rows <- character(0)
write_checks <- function() writeLines(c("id,description,expected,got,result", CHK$rows), file.path("r", "checks.csv"), useBytes = TRUE)
add_check <- function(id, expected, got, result) {
  CHK$rows <- c(CHK$rows, paste(id, id, expected, got, result, sep = ","))
  if (result == "F") {
    write_checks()
    message("STOP: check ", id, " failed: expected ", expected, " got ", got)
    quit(save = "no", status = 1)
  }
}
add_viol <- function(id, count) add_check(id, "0", fmti(count), if (count == 0) "P" else "F")
stop_run <- function(msg) { write_checks(); message("STOP: ", msg); quit(save = "no", status = 2) }

## ---------------------------------------------------------------- unit tests
vi <- 0L
ck <- function(ok) { if (!isTRUE(ok)) vi <<- vi + 1L }
near <- function(a, b, tol) isTRUE(abs(a - b) <= tol)
tick <- function() { v <- vi; vi <<- 0L; v }

ck(fl_half(0.5) == 1); ck(fl_half(2.4) == 2); ck(fl_half(2.5) == 3); ck(fl_half(-0.5) == 0)
ck(fl_half(-1.5) == -1); ck(fl_half(8.49) == 8); ck(fl_half(8.5) == 9)
add_viol("U01_round", tick())

ck(hour_key("2020-01-01T00:00:00.000Z") == 438288); ck(hour_key("2012-12-01T00:00:00.000Z") == 376200)
ck(hour_key("2019-12-31T23:00:00.000Z") == 438287); ck(hour_key("2026-11-09T23:00:00.000Z") == 498407)
ck(hour_key("1970-01-01T00:00:00.000Z") == 0)
add_viol("U02_key", tick())

ck(epoch_ms("2012-01-01 00:00") == 1325376000000); ck(epoch_ms("1970-01-01 00:30") == 1800000)
ck(epoch_ms("2013-06-01T05:49:00.000Z") == 1370065740000); ck(epoch_ms("2013-06-01 05:49") == 1370065740000)
ck(epoch_ms("2020-06-01T05:00:00.000Z") == 1590987600000)
ck(evt_to_pred("2015-06-20 12:00") == "2015-06-20T12:00:00.000Z"); ck(hour_key(evt_to_pred("2015-06-20 12:00")) == 398556)
add_viol("U03_time", tick())

x <- as.numeric(1:10000)
ck(near(pctl(x, 0.025), 250.975, 1e-9)); ck(near(pctl(x, 0.975), 9750.025, 1e-9))
x <- as.numeric(1:11)
ck(near(pctl(x, 0.05), 1.5, 1e-9)); ck(near(pctl(x, 0.95), 10.5, 1e-9)); ck(med(x) == 6)
ck(med(c(1, 2, 3, 4)) == 2.5)
add_viol("U04_percentile", tick())

ck(mic("0.500000") == 500000); ck(mic("-0.020000") == -20000); ck(mic("10.000000") == 10000000)
ck(mic("-1.000000") == -1000000); ck(fmt6(-0.0000001) == "0.000000"); ck(mic(fmt6(-0.0000001)) == 0)
add_viol("U05_mic", tick())

hm_t <- c(1000, 2000, NA, 4000)
tt <- function(tau) truth_fn(tau, hm_t, 0)
ck(tt(2250000) == 1250); ck(tt(1350000) == 1000); ck(tt(3150000) == 1500); ck(tt(1349999) == 1000)
ck(tt(5400000) == 2000); ck(tt(8551000) == 4000); ck(is.na(tt(18000000 + 1350000 + 5)))
ck(near(tt(2250000.5), 1250.000138888889, 1e-9))
ck(in_range(500.0)); ck(!in_range(499.9)); ck(in_range(500000.0)); ck(!in_range(500000.1))
add_viol("U06_truth", tick())

boot_j <- function(n, B) (n * B) %/% 1e12
ck(boot_j(0, 85) == 0); ck(boot_j(999999999999, 85) == 84); ck(boot_j(0, 83) == 0); ck(boot_j(999999999999, 83) == 82)
ck(boot_j(500000000000, 7) == 3)
bl2 <- readLines("../onset_correction_2026-11-25/tools/boot_uniforms.csv", n = 2)
c1 <- strsplit(bl2[2], ",", fixed = TRUE)[[1]][1]
ck(as.numeric(c1) == 343638232196); ck(boot_j(as.numeric(c1), 85) == 29); ck(boot_j(as.numeric(c1), 83) == 28)
add_viol("U07_boot_index", tick())

ck(period_of("2019-12-31T23:00:00.000Z") == "design"); ck(period_of("2020-01-01T00:00:00.000Z") == "test")
ck(period_of("2012-11-30T23:00:00.000Z") == "burnin"); ck(period_of("2012-12-01T00:00:00.000Z") == "design")
ck(design_month("2012-12-01T00:00:00.000Z") == 0); ck(design_month("2019-12-01T00:00:00.000Z") == 84)
ck(test_month("2020-01-01T00:00:00.000Z") == 0); ck(test_month("2026-11-01T00:00:00.000Z") == 82)
add_viol("U08_periods", tick())

e <- err_fn(850, 1000); ck(e == -15 && e <= -15 && abs(e) >= 15)
e <- err_fn(1150, 1000); ck(e == 15 && e >= 15 && abs(e) >= 15)
ck(err_fn(17, 20) == -15); ck(near(err_fn(1149, 1000), 14.9, 1e-9) && abs(err_fn(1149, 1000)) < 15)
add_viol("U09_error", tick())

cap_test <- function(raw, corr, L) { u <- raw - corr; list(P = floor(min(u, 1.2 * L) + 0.5), N = floor(u + 0.5), capped = u > 1.2 * L) }
r <- cap_test(2600, 100, 1500); ck(r$P == 1800 && r$N == 2500 && r$capped)
r <- cap_test(1900, 100, 1500); ck(!r$capped && r$P == 1800)
r <- cap_test(1901, 100, 1500); ck(r$capped && r$P == 1800 && r$N == 1801)
r <- cap_test(1700.5, 0, 1500); ck(r$N == 1701)
add_viol("U10_cap", tick())

ck(near(clock_fn(1000), 5.676885120152289, 1e-9)); ck(near(clock_fn(1400), 5.676885120152289, 1e-9))
ck(near(clock_fn(3000), 4.205951632159436, 1e-9)); ck(near(clock_fn(5000), 3.440066128281308, 1e-9))
ck(near(clock_fn(10000), 2.6188552085600927, 1e-9)); ck(near(clock_fn(20000), 1.9936833617872496, 1e-9))
ck(near(clock_fn(50000), 1.9936833617872496, 1e-9))
ck(near(1.23 * clock_fn(3000), 5.173320507556106, 1e-9)); ck(near(0.30 * clock_fn(3000), 1.2617854896478307, 1e-9))
add_viol("U11_clock", tick())

t0 <- 1590987600000
ck(t0 == epoch_ms("2020-06-01T05:00:00.000Z"))
ck(near(t0 + 4.2 * 3600000.0, 1591002720000, 1e-3))
stair <- function(h) { due <- t0 + h * 3600000.0; Tv <- ceiling(due / 3600000.0) * 3600000.0; c(Tv, Tv - TAU_BEFORE) }
s <- stair(4.2); ck(s[1] == 1591005600000 && s[2] == 1591004940000)
s <- stair(4.0); ck(s[1] == 1591002000000 && s[2] == 1591001340000)
s <- stair(0.5981050085361749); ck(s[1] == 1590991200000)
add_viol("U12_due", tick())

b <- band_fn("3000-6000", "rising", 4000); ck(b$lo == 3465 && b$hi == 4676)
ck(3465 >= b$lo && 3465 <= b$hi); ck(!(3464 >= b$lo && 3464 <= b$hi)); ck(4676 >= b$lo && 4676 <= b$hi); ck(!(4677 >= b$lo && 4677 <= b$hi))
b <- band_fn("0-3000", "steady", 300); ck(b$lo == 50 && b$hi == 571)
b <- band_fn("0-3000", "steady", 100); ck(b$lo == 0 && b$hi == 371)
b <- band_fn("50000+", "falling", 60000); ck(b$lo == 53571 && b$hi == 64099)
b <- band_fn("6000-12000", "weird", 8000); ck(b$lo == 7494 && b$hi == 8628)
add_viol("U13_band", tick())

ck(y1_fn(1000, 910, 1.0, 4.0) == 1150); ck(y1_fn(1000, 1100, 1.0, 4.0) == 1000)
ck(y1_fn(1000, NA_real_, 1.0, 4.0) == 1000); ck(y1_fn(1000, 910, NA_real_, 4.0) == 1000)
ck(y0_fn(1000.4) == 1000); ck(y0_fn(1000.5) == 1001)
add_viol("U14_yard", tick())

mm <- mv_fn(c(1000, 1000, 0), c(950, 1049, 5))
ck(mm$m[1] == -5 && abs(mm$m[1]) >= 5 && mm$m[1] < 0); ck(near(mm$m[2], 4.9, 1e-9) && !(abs(mm$m[2]) >= 5)); ck(mm$excl == 1 && length(mm$m) == 2)
add_viol("U15_move", tick())

ck(label_fn("0.100000", "0.300000", "cap") == "cap_closer"); ck(label_fn("-0.300000", "-0.100000", "cap") == "cap_farther")
ck(label_fn("-0.100000", "0.200000", "cap") == "unclear"); ck(label_fn("0.000000", "0.200000", "cap") == "unclear")
ck(label_fn("-0.200000", "0.000000", "cap") == "unclear"); ck(label_fn("", "0.200000", "cap") == "unclear")
ck(label_fn("0.000001", "0.200000", "cap") == "cap_closer")
ck(label_fn("0.100000", "0.300000", "y") == "app_closer"); ck(label_fn("-0.300000", "-0.100000", "y") == "yardstick_closer")
ck(label_fn("-0.100000", "0.200000", "y") == "unclear"); ck(label_fn("", "", "y") == "unclear")
add_viol("U16_labels", tick())

rr <- reading_fn("cap_closer", "cap_closer", "cap_closer"); ck(rr$reading == "cap_closer" && rr$holds == 1)
rr <- reading_fn("cap_closer", "unclear", "cap_closer"); ck(rr$reading == "mixed" && rr$holds == 0)
rr <- reading_fn("unclear", "unclear", "unclear"); ck(rr$reading == "unclear" && rr$holds == 0)
rr <- reading_fn("app_closer", "app_closer", "app_closer"); ck(rr$reading == "app_closer" && rr$holds == 1)
rr <- reading_fn("cap_farther", "cap_closer", "cap_farther"); ck(rr$reading == "mixed" && rr$holds == 0)
rr <- reading_fn("yardstick_closer", "yardstick_closer", "yardstick_closer"); ck(rr$reading == "yardstick_closer" && rr$holds == 1)
add_viol("U17_reading", tick())

jj <- jumps_fn(1:3, c(1000, 1000, 1000), c(100, 160, 100), rep(TRUE, 3), 1)
ck(is.na(jj[1]) && jj[2] == 6 && jj[3] == 6 && sum(jj >= 5.0, na.rm = TRUE) == 2)
jj <- jumps_fn(1:3, c(1000, 1000, 1000), c(100, 104, 100), rep(TRUE, 3), 1)
ck(near(jj[2], 0.4, 1e-9) && near(jj[3], 0.4, 1e-9) && sum(jj >= 5.0, na.rm = TRUE) == 0)
add_viol("U18_jump", tick())

## ---------------------------------------------------------------- file checks S01..S12
PATHS <- list(
  shadow_OLD = "../onset_correction_2026-11-25/replay_L/shadow_L.csv",
  learn_OLD = "../onset_correction_2026-11-25/replay_L/learn_L.csv",
  counts_OLD = "../onset_correction_2026-11-25/replay_L/counts_L.txt",
  bins_OLD = "../onset_correction_2026-11-25/replay_L/bins_L.csv",
  hourly = "../rising-limb-travel-backtest/hourly_backtest_data_v39.csv",
  events = "../rising-limb-travel-backtest/rising_limb_events_python_v39.csv",
  units = "../clock_study_2026-11-27/py/units.csv",
  boot = "../onset_correction_2026-11-25/tools/boot_uniforms.csv",
  shadow_NEW = "replay_NEW/shadow_L.csv",
  learn_NEW = "replay_NEW/learn_L.csv",
  counts_NEW = "replay_NEW/counts_L.txt",
  bins_NEW = "replay_NEW/bins_L.csv")
SHA <- c(
  "dcc63931841b537a834962b9a7c60e6edfd3b72b8bd491b43af89bbba0ba5aba:109952178",
  "be9c95c12ebb8dbf622f6ae1859830f63326bf026fdf31078e210e16c198b3e6:5197278",
  "2413d7da60ef9445959e75316e6868de6945678836c63ccf22675fde3a7dde7e:1200",
  "ad2a48e19344468d5960492a3d95a5d936ead578789388b4b2fc30f331978eea:1658625",
  "d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f:10133893",
  "978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44:24205",
  "9f912c545d4645b870749a1169dc82a8b08984e412d863a74fd368738040b883:27619",
  "71d75af9b10c1ba4d3d9492f0e07d17497a35e01d3568d9b3ed8ab8fe528d515:13000392",
  "e0111ffcae8ffe135921fccc5db9a26e5d49e12ef9230f43b23dab489fdb9cc3:113025453",
  "cebe8e728d7ba2ec669d5b00c63479cf62d4d01c81e7dadaa7651d5fc9f29750:8299789",
  "ecb415ca3ccb62b1fe3068a51455eea3f2785a0711989db51b6d89e49e43eed8:1200",
  "e6d95c886cd9060a4710da8294a252971b15e8f8935a7148c965b79d1b9678b1:2656268")
SIDS <- c("S01_sha_shadow_OLD", "S02_sha_learn_OLD", "S03_sha_counts_OLD", "S04_sha_bins_OLD", "S05_sha_hourly",
          "S06_sha_events", "S07_sha_units", "S08_sha_boot", "S09_sha_shadow_NEW", "S10_sha_learn_NEW",
          "S11_sha_counts_NEW", "S12_sha_bins_NEW")
for (i in 1:12) {
  p <- PATHS[[i]]
  got <- paste0(unname(tools::sha256sum(p)), ":", sprintf("%.0f", file.info(p)$size))
  add_check(SIDS[i], SHA[i], got, if (got == SHA[i]) "P" else "F")
}

## ---------------------------------------------------------------- read shadow files
cat("reading shadow files\n")
WANT19 <- c("predTs", "status", "flowBin", "flowState", "predictedCFS", "rawFinalCFS", "rawUnc", "corrUsed", "lfCap",
            "lfQ", "age_lf_h", "travelPoRtoGF", "travelGFtoLF", "valHourTs", "tauTs", "truthFlow", "truthInProdRange",
            "truthDependentHard", "errPctCorr")
NAMES19 <- WANT19[WANT19 != "travelPoRtoGF"]
read_shadow <- function(path, want) {
  hdr <- strsplit(readLines(path, n = 1), ",", fixed = TRUE)[[1]]
  cc <- rep("NULL", length(hdr)); names(cc) <- hdr
  cc[intersect(want, hdr)] <- "character"
  df <- read.csv(path, header = TRUE, colClasses = cc, quote = "", comment.char = "", na.strings = character(0),
                 stringsAsFactors = FALSE)
  list(df = df, hdr = hdr)
}
rdO <- read_shadow(PATHS$shadow_OLD, WANT19)
rdN <- read_shadow(PATHS$shadow_NEW, c(WANT19, "clockQ", "clockHrs"))
O <- as.list(rdO$df); N <- as.list(rdN$df)
nO <- length(O$predTs); nN <- length(N$predTs)
add_check("S13_rows", "130987:130987", paste0(nO, ":", nN), if (nO == 130987 && nN == 130987) "P" else "F")

cfO <- count.fields(PATHS$shadow_OLD, sep = ",", quote = "", comment.char = "", blank.lines.skip = FALSE)
cfN <- count.fields(PATHS$shadow_NEW, sep = ",", quote = "", comment.char = "", blank.lines.skip = FALSE)
add_viol("S14_fields", sum(cfO[-1] != 87) + sum(cfN[-1] != 89) + (length(cfO) - 1 != nO) + (length(cfN) - 1 != nN))

form_re <- "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):00:00\\.000Z$"
n_names_bad <- function(hdr, want) sum(vapply(want, function(w) sum(hdr == w) != 1, TRUE))
v15 <- n_names_bad(rdO$hdr, NAMES19) + n_names_bad(rdN$hdr, c(NAMES19, "clockQ", "clockHrs"))
v15 <- v15 + (paste(rdN$hdr, collapse = ",") != paste0(paste(rdO$hdr, collapse = ","), ",clockQ,clockHrs"))
KO <- hour_key(O$predTs); KN <- hour_key(N$predTs)
v15 <- v15 + sum(!grepl(form_re, O$predTs)) + sum(!grepl(form_re, N$predTs))
v15 <- v15 + sum(diff(KO) != 1) + sum(diff(KN) != 1) + (KO[1] != 367421) + (KO[nO] != 498407) + (KN[1] != 367421) + (KN[nN] != 498407)
add_viol("S15_header_grid", v15)
K <- KO; K0 <- K[1]; nrow_ <- nO
t_ms <- K * 3600000.0

## ---------------------------------------------------------------- read the small files
split_csv <- function(lines) strsplit(paste0(lines, "#"), ",", fixed = TRUE)
to_matrix <- function(parts, nc) {
  m <- matrix(unlist(parts), ncol = nc, byrow = TRUE)
  m[, nc] <- substr(m[, nc], 1, nchar(m[, nc]) - 1)
  m
}
read_lines_trim <- function(p) { x <- readLines(p); while (length(x) > 0 && grepl("^\\s*$", x[length(x)])) x <- x[-length(x)]; x }

hl <- read_lines_trim(PATHS$hourly)
hparts <- split_csv(hl[-1]); h_len <- lengths(hparts)
ev <- read_lines_trim(PATHS$events); evparts <- split_csv(ev[-1]); ev_len <- lengths(evparts)
un <- read_lines_trim(PATHS$units); unparts <- split_csv(un[-1]); un_len <- lengths(unparts)
bo <- read_lines_trim(PATHS$boot); boparts <- strsplit(bo[-1], ",", fixed = TRUE); bo_len <- lengths(boparts)
LHDR <- "predTs,valHourTs,dueTs,tauTs,arm,inputArm,cell,outcome,learned,clamped,softFlagged,rawResidualCFS,learningErrorCFS,emaBefore,countBefore,emaAfter,countAfter,chk1_ef,chk2_stage,chk3_lowflow_ice,chk4_largeerr,chk5_outlier,truthDependentHard"
lo_l <- read_lines_trim(PATHS$learn_OLD); ln_l <- read_lines_trim(PATHS$learn_NEW)
loparts <- split_csv(lo_l[-1]); lnparts <- split_csv(ln_l[-1])

v16 <- 0
v16 <- v16 + (length(hparts) != 130416) + sum(h_len != 12)
if (sum(h_len != 12) == 0) {
  hmat <- to_matrix(hparts, 12)
  h_ts <- hmat[, 1]; h_lf <- hmat[, 5]
  v16 <- v16 + sum(!grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:00$", h_ts))
  h_ms <- epoch_ms(h_ts)
  v16 <- v16 + sum(diff(h_ms) <= 0)
  nbh <- h_lf != ""
  hv <- num(h_lf[nbh]); v16 <- v16 + sum(is.na(hv) | hv <= 0)
}
evhdr <- strsplit(ev[1], ",", fixed = TRUE)[[1]]
v16 <- v16 + (length(evparts) != 87) + sum(ev_len != 47) + (length(evhdr) != 47) +
  sum(!(c("event_id", "event_t0", "event_class", "rl_start", "rl_end", "kept") %in% evhdr))
UHDR <- "unit_id,kind,event_id,cluster,onset_key,peak_key,start_key,a,b,n_hours,q,qclass,period,lf_start,lf_peak,share_lower,share_upper,share_whole,dr_fallback"
v16 <- v16 + (length(unparts) != 225) + sum(un_len != 19) + (un[1] != UHDR)
if (sum(un_len != 19) == 0) {
  umat0 <- to_matrix(unparts, 19)
  kc <- table(umat0[, 2])
  v16 <- v16 + (unname(kc["event"]) != 53 | is.na(kc["event"])) + (is.na(kc["small"]) | unname(kc["small"]) != 33) +
    (is.na(kc["bump"]) | unname(kc["bump"]) != 86) + (is.na(kc["recession"]) | unname(kc["recession"]) != 53)
}
v16 <- v16 + (length(boparts) != 10000) + sum(bo_len != 100) +
  (bo[1] != paste0("u", 1:100, collapse = ","))
v16 <- v16 + (length(loparts) != 23688) + (length(lnparts) != 37913) + (lo_l[1] != LHDR) + (ln_l[1] != LHDR) +
  sum(lengths(loparts) != 23) + sum(lengths(lnparts) != 23)
add_viol("S16_other_rows", v16)

## hourly map
hk <- h_ms / 3600000
HK0 <- hk[1]
HM <- rep(NA_real_, hk[length(hk)] - HK0 + 1)
HM[hk[nbh] - HK0 + 1] <- hv
truth_at <- function(tau) truth_fn(tau, HM, HK0)

## events and units
evmat <- to_matrix(evparts, 47); colnames(evmat) <- evhdr
umat <- umat0; colnames(umat) <- strsplit(UHDR, ",", fixed = TRUE)[[1]]
u_kind <- umat[, "kind"]; u_a <- num(umat[, "a"]); u_b <- num(umat[, "b"])
u_start <- num(umat[, "start_key"]); u_peak <- num(umat[, "peak_key"]); u_share <- umat[, "share_lower"]
if (any(is.na(u_a) | is.na(u_b)) || any(u_kind != "recession" & (is.na(u_start) | is.na(u_peak))))
  stop_run("units.csv: a blank or non-numeric window or limb key where one is required")

## shadow numeric arrays
prep <- function(D) {
  D$est <- D$predictedCFS != "" & D$rawUnc != "" & D$corrUsed != ""
  D$pred <- num(D$predictedCFS); D$raw <- num(D$rawUnc); D$corr <- num(D$corrUsed)
  D$L <- num(D$lfCap); D$u <- D$raw - D$corr
  D$age <- num(D$age_lf_h)
  D
}
O <- prep(O); N <- prep(N)
N$clockQn <- num(N$clockQ); N$clockHn <- num(N$clockHrs)
O$trav <- num(O$travelGFtoLF)
est_o <- O$est; est_n <- N$est
isb <- est_o & O$predTs >= DESIGN_START
pm <- list(design = isb & O$predTs < TEST_START, test = isb & O$predTs >= TEST_START)

## ---------------------------------------------------------------- groups
Lg <- O$L
lf6 <- Lg[lagidx(K, 6, K0, nrow_)]
G <- list()
G$all <- isb
G$lf_rising <- isb & !is.na(lf6) & (Lg >= 1.10 * lf6)
m1 <- rep(FALSE, nrow_); m2 <- rep(FALSE, nrow_); mw <- rep(FALSE, nrow_)
for (i in seq_along(u_kind)) {
  if (u_kind[i] %in% c("event", "small")) m1 <- m1 | (K >= u_start[i] & K <= u_peak[i])
  if (u_kind[i] %in% c("event", "small", "bump")) m2 <- m2 | (K >= u_start[i] & K <= u_peak[i])
  mw <- mw | (K >= u_a[i] & K <= u_b[i])
}
G$rl_rises <- isb & m1
G$rl_rises_bump <- isb & m2
G$low_water <- isb & (Lg < 3000.0) & !mw
G$high_12_20 <- isb & Lg >= 12000.0 & Lg < 20000.0
G$high_20plus <- isb & Lg >= 20000.0
sel <- which(evmat[, "event_class"] == "GATE" & evmat[, "kept"] == "1")
rl_s <- evt_to_pred(evmat[sel, "rl_start"]); rl_e <- evt_to_pred(evmat[sel, "rl_end"])
rise_t0 <- evmat[sel, "event_t0"]
rise_status <- character(length(sel))
for (j in seq_along(sel)) {
  ui <- which(umat[, "unit_id"] == paste0("E", evmat[sel[j], "event_id"]))
  if (length(ui) != 1 || u_share[ui] == "") rise_status[j] <- "unknown" else {
    sh <- as.numeric(u_share[ui])
    rise_status[j] <- if (sh > 0.15) "creek" else "notcreek"
  }
}
cnt <- rep(0, nrow_); rl_status <- rep("", nrow_)
for (j in seq_along(sel)) {
  inl <- O$predTs >= rl_s[j] & O$predTs <= rl_e[j]
  cnt <- cnt + inl
  rl_status[inl] <- rise_status[j]
}
G$rl_large <- isb & cnt >= 1
G$rl_large_creekfed <- isb & cnt >= 1 & rl_status == "creek"
G$rl_large_notcreek <- isb & cnt >= 1 & rl_status == "notcreek"
G$rl_large_shareunk <- isb & cnt >= 1 & rl_status == "unknown"
GN <- c("all", "lf_rising", "rl_rises", "rl_rises_bump", "low_water", "high_12_20", "high_20plus", "rl_large",
        "rl_large_creekfed", "rl_large_notcreek", "rl_large_shareunk")
GN10 <- GN[1:10]
PER <- c("design", "test"); TRU <- c("central", "long", "short")
EXPG <- list(design = c(60663, 4428, 2220, 3256, 10381, 10858, 11643, 275, 167, 108, 0),
             test = c(60120, 4514, 2975, 4488, 16140, 7271, 4480, 452, 159, 293, 0))
gi <- 0
for (p in PER) for (g in seq_along(GN)) {
  gi <- gi + 1
  got <- sum(G[[GN[g]]] & pm[[p]])
  add_check(sprintf("G%02d_%s_%s", gi, p, GN[g]), fmti(EXPG[[p]][g]), fmti(got), if (got == EXPG[[p]][g]) "P" else "F")
}
rd <- rise_t0 < "2020-01-01 00:00"
g23 <- paste(sum(rd), sum(!rd), sum(rd & rise_status == "creek"), sum(!rd & rise_status == "creek"),
             sum(rd & rise_status == "notcreek"), sum(!rd & rise_status == "notcreek"),
             sum(rd & rise_status == "unknown"), sum(!rd & rise_status == "unknown"), sep = ":")
add_check("G23_rises", "8:13:5:5:3:8:0:0", g23, if (g23 == "8:13:5:5:3:8:0:0") "P" else "F")
add_viol("G24_limb_overlap", sum(isb & cnt >= 2))

## ---------------------------------------------------------------- B01..B09
b01 <- function(D, isnew) {
  e <- D$est
  bad <- e & (D$lfCap == "" | D$lfQ == "" | D$age_lf_h == "" | D$flowBin == "" | D$flowState == "" |
                D$travelGFtoLF == "" | D$valHourTs == "" | D$tauTs == "" |
                !(D$flowState %in% c("rising", "steady", "falling")) | !(D$flowBin %in% BINS) |
                is.na(D$L) | !(D$L > 0) | is.na(D$pred) | !(D$pred > 0))
  if (isnew) bad <- bad | (e & (D$clockQ == "" | D$clockHrs == ""))
  bad <- bad | (!e & D$status %in% c("predicted", "no_truth"))
  bad[is.na(bad)] <- TRUE
  sum(bad)
}
add_viol("B01_inputs_wellformed", b01(O, FALSE) + b01(N, TRUE))
add_viol("B02_same_hours", sum(est_o != est_n))
b03_cols <- c("rawUnc", "rawFinalCFS", "flowBin", "flowState", "lfCap", "lfQ", "age_lf_h", "travelPoRtoGF", "travelGFtoLF")
diffh <- rep(FALSE, nrow_)
for (cn in b03_cols) diffh <- diffh | (O[[cn]] != N[[cn]])
add_viol("B03_raw_same", sum(est_o & diffh))
clk_n <- clock_fn(N$clockQn)
add_viol("B04_clock_cols", sum(est_n & (is.na(abs(N$clockHn - clk_n)) | abs(N$clockHn - clk_n) > 1e-9)))

own_check <- function(D, h, est) {
  due <- t_ms + h * 3600000.0
  Tv <- ceiling(due / 3600000.0) * 3600000.0
  tau <- Tv - TAU_BEFORE
  tr <- truth_at(tau)
  tf <- num(D$truthFlow)
  pres <- !is.na(tr)
  v <- is.na(epoch_ms(D$tauTs)) | epoch_ms(D$tauTs) != tau | is.na(epoch_ms(D$valHourTs)) | epoch_ms(D$valHourTs) != Tv |
    (pres != (D$truthFlow != "")) |
    (pres & !is.na(tf) & abs(tr - tf) > 1e-6 * pmax(1.0, abs(tf)))
  v[is.na(v)] <- TRUE
  sum(est & v)
}
add_viol("B05_new_own_truth", own_check(N, N$clockHn, est_n))
add_viol("B06_old_own_truth", own_check(O, O$trav, est_o))
shownP <- function(D) floor(pmin(D$u, 1.2 * D$L) + 0.5)
b07 <- function(D) { v <- shownP(D) != D$pred; v[is.na(v)] <- TRUE; sum(D$est & v) }
add_viol("B07_shown_recomputed", b07(O) + b07(N))
own_o <- truth_at(epoch_ms(O$tauTs)); own_n <- truth_at(epoch_ms(N$tauTs))
b08 <- function(D, own) {
  tf <- num(D$truthFlow)
  v <- is.na(own) | is.na(tf) | abs(own - tf) > 1e-6 * pmax(1.0, abs(tf))
  sum(D$est & D$truthFlow != "" & v)
}
add_viol("B08_own_truth_rebuilt", b08(O, own_o) + b08(N, own_n))

## counts files
parse_counts <- function(path) {
  ln <- sub("^ +", "", readLines(path))
  getp <- function(prefix) {
    m <- ln[startsWith(ln, prefix)]
    if (length(m) != 1) stop_run(paste0("counts file ", path, ": prefix '", prefix, "' matched ", length(m), " lines"))
    substring(m, nchar(prefix) + 1)
  }
  sl <- getp("learning track: slots stored ")
  slots <- as.numeric(sub(";.*$", "", sl))
  blocked <- as.numeric(sub("^.*; hours a new prediction found the slot occupied ", "", sl))
  r <- c(slots_stored = slots, slot_blocked_hours = blocked,
         learn_validations = as.numeric(getp("validations (truth found, in production range): ")),
         learned = as.numeric(getp("learned: ")),
         hard_skipped = as.numeric(getp("hard-skipped (excluded from learning): ")),
         retries = as.numeric(getp("retries (no truth or truth out of production range at the validation hour): ")),
         dropped_missed_window = as.numeric(getp("dropped, missed 2.5 h window: ")),
         pending_at_end = as.numeric(getp("slot still pending at end of run: ")))
  if (any(is.na(r))) stop_run(paste0("counts file ", path, ": a value did not parse"))
  r
}
CNT <- list(OLD = parse_counts(PATHS$counts_OLD), NEW = parse_counts(PATHS$counts_NEW))
lmat <- list(OLD = to_matrix(loparts, 23), NEW = to_matrix(lnparts, 23))
LR <- list()
for (r in c("OLD", "NEW")) {
  m <- lmat[[r]]
  LR[[r]] <- list(predTs = m[, 1], tauTs = m[, 4], outcome = m[, 8], clamped = m[, 10])
  LR[[r]]$per <- period_of(LR[[r]]$predTs)
}
b09 <- 0
for (r in c("OLD", "NEW")) {
  c_ <- CNT[[r]]; l <- LR[[r]]
  b09 <- b09 + (length(l$predTs) != c_["learn_validations"]) + (c_["learned"] + c_["hard_skipped"] != c_["learn_validations"]) +
    (sum(l$outcome == "learned") != c_["learned"]) + (sum(l$outcome == "hard_skipped") != c_["hard_skipped"]) +
    ((sum(l$per == "burnin") + sum(l$per == "design") + sum(l$per == "test")) != c_["learn_validations"])
}
add_viol("B09_counts_file", b09)

## B11
b11_hours <- c("2013-10-07T10:00:00.000Z", "2015-12-26T11:00:00.000Z", "2019-12-04T05:00:00.000Z",
               "2023-09-24T13:00:00.000Z", "2020-06-01T05:00:00.000Z", "2026-07-20T18:00:00.000Z")
b11_q <- c(1370, 20450, 3750, 5945, 11150, 2960)
b11_exp <- list(c(1517.829896030, 1703.794713267, 1370.000000000), c(20800.0, 20800.0, 20566.931502563),
                c(3830.0, 3830.0, 3750.0), c(6210.0, 6365.964228735, 6345.617093952),
                c(11200.0, 11200.0, 11150.0), c(NA, NA, NA))
MULT <- c(central = 1.0, long = 1.23, short = 0.30)
common_truth <- function(rows) {
  cl <- clock_fn(N$clockQn[rows])
  res <- list()
  for (tr in TRU) res[[tr]] <- truth_at(t_ms[rows] + (MULT[[tr]] * cl) * 3600000.0)
  res
}
bi <- match(b11_hours, N$predTs)
v11 <- 0
if (any(is.na(bi))) v11 <- 99 else {
  ct <- common_truth(bi)
  for (i in 1:6) for (k in 1:3) {
    got <- ct[[TRU[k]]][i]; ex <- b11_exp[[i]][k]
    if (is.na(ex)) { if (!is.na(got)) v11 <- v11 + 1 } else if (is.na(got) || abs(got - ex) > 1e-6) v11 <- v11 + 1
  }
  ## also the clockQ listed must equal the file's value
  v11 <- v11 + sum(N$clockQn[bi] != b11_q)
}
add_viol("B11_common_fixed", v11)

## ---------------------------------------------------------------- common truths for the base set
cat("common truths\n")
bidx <- which(isb)
TC <- list()
for (tr in TRU) {
  v <- rep(NA_real_, nrow_)
  cl <- clock_fn(N$clockQn[bidx])
  v[bidx] <- truth_at(t_ms[bidx] + (MULT[[tr]] * cl) * 3600000.0)
  TC[[tr]] <- v
}
hard_either <- O$truthDependentHard == "1" | N$truthDependentHard == "1"
V <- list()
for (tr in TRU) V[[tr]] <- isb & !is.na(TC[[tr]]) & in_range(TC[[tr]]) & !hard_either

## row accounting
ACC <- character(0)
acc_add <- function(scope, step, cond, rin, rleft) ACC <<- c(ACC, paste(scope, fmti(step), cond, fmti(rin), fmti(rin - rleft), fmti(rleft), sep = ","))
acc_chain <- function(scope, conds, masks, total) {
  # masks: list of logical vectors "kept after step k" (k = 1..); step 0 = read
  acc_add(scope, 0, "read", total, total)
  prev <- total
  for (k in seq_along(conds)) { left <- sum(masks[[k]]); acc_add(scope, k, conds[k], prev, left); prev <- left }
}
{
  a1 <- est_o; a2 <- a1 & O$predTs >= DESIGN_START; a3 <- a2 & !(O$pred <= 0)
  acc_chain("movement", c("no_estimate", "burn_in", "old_nonpositive"), list(a1, a2, a3), nrow_)
}
for (tr in TRU) {
  a1 <- est_o; a2 <- a1 & O$predTs >= DESIGN_START
  a3 <- a2 & !is.na(TC[[tr]] | rep(NA_real_, nrow_)) ; a3 <- a2 & !is.na(TC[[tr]])
  a4 <- a3 & in_range(TC[[tr]]); a5 <- a4 & !hard_either
  acc_chain(paste0("common_", tr), c("no_estimate", "burn_in", "truth_missing", "truth_out_of_range", "hard_flag_either"),
            list(a1, a2, a3, a4, a5), nrow_)
}
{
  a1 <- est_o & est_n; a2 <- a1 & O$predTs >= DESIGN_START
  a3 <- a2 & O$truthFlow != "" & N$truthFlow != "" & !is.na(own_o) & !is.na(own_n)
  a4 <- a3 & O$status == "predicted" & N$status == "predicted"
  a5 <- a4 & !hard_either
  a6 <- a5 & O$truthInProdRange != "0" & N$truthInProdRange != "0"
  a7 <- a6 & O$errPctCorr != "" & N$errPctCorr != ""
  acc_chain("two_by_two", c("no_estimate_either", "burn_in", "truth_missing_either", "status_not_predicted_either",
                            "hard_flag_either", "truth_out_of_range_either", "blank_error_either"),
            list(a1, a2, a3, a4, a5, a6, a7), nrow_)
  TBT <- a7
}

## groups.csv
GROUPS_ROWS <- character(0)
for (p in PER) for (g in GN) {
  m <- G[[g]] & pm[[p]]
  GROUPS_ROWS <- c(GROUPS_ROWS, paste(p, g, fmti(sum(m)), fmti(sum(m & V$central)), fmti(sum(m & V$long)),
                                      fmti(sum(m & V$short)), fmti(sum(m & TBT)), sep = ","))
}

## ---------------------------------------------------------------- measures
meas <- function(e) {
  n <- length(e)
  if (n == 0) return(c("0", "", "", "", "", ""))
  ae <- abs(e)
  c(fmti(n), fmt6(ssum(ae) / n), fmt6(ssum(e) / n), fmt6((100.0 * sum(ae >= 15)) / n),
    fmt6((100.0 * sum(e <= -15)) / n), fmt6((100.0 * sum(e >= 15)) / n))
}
EO <- list(); EN <- list()
for (tr in TRU) { EO[[tr]] <- err_fn(O$pred, TC[[tr]]); EN[[tr]] <- err_fn(N$pred, TC[[tr]]) }

## badly_low_rising
BLR <- character(0)
for (p in PER) for (tr in TRU) {
  ids <- which(G$lf_rising & pm[[p]] & V[[tr]])
  n <- length(ids)
  nlo <- sum(EO[[tr]][ids] <= -15); nln <- sum(EN[[tr]][ids] <= -15)
  sh <- function(x) if (n == 0) "" else fmt6((100.0 * x) / n)
  BLR <- c(BLR, paste(p, tr, "OLD", fmti(n), fmti(nlo), sh(nlo), sep = ","),
           paste(p, tr, "NEW", fmti(n), fmti(nln), sh(nln), sep = ","),
           paste(p, tr, "NEW_minus_OLD", fmti(n), fmti(nln - nlo), sh(nln - nlo), sep = ","))
}

## movement
MOV <- character(0)
for (p in PER) for (g in GN10) {
  ids <- which(G[[g]] & pm[[p]])
  mm <- mv_fn(O$pred[ids], N$pred[ids]); m <- mm$m; n <- length(m)
  if (n == 0) {
    MOV <- c(MOV, paste(p, g, "0", fmti(mm$excl), "", "", "", "", "", "", "", "", "", sep = ","))
  } else {
    nup <- sum(m > 0); ndn <- sum(m < 0); nsm <- sum(m == 0)
    dirn <- if (ndn > nup) "lower" else if (nup > ndn) "higher" else "equal"
    MOV <- c(MOV, paste(p, g, fmti(n), fmti(mm$excl), fmt6(ssum(m) / n), fmt6(med(m)), fmt6(pctl(m, 0.05)),
                        fmt6(pctl(m, 0.95)), fmt6((100.0 * sum(abs(m) >= 5.0)) / n), fmti(nup), fmti(ndn), fmti(nsm),
                        dirn, sep = ","))
  }
}

## two_by_two
TBTR <- character(0)
for (p in PER) for (g in GN10) {
  ids <- which(G[[g]] & pm[[p]] & TBT)
  sets <- list(list("OLD", "own", err_fn(O$pred[ids], own_o[ids])), list("OLD", "other", err_fn(O$pred[ids], own_n[ids])),
               list("NEW", "own", err_fn(N$pred[ids], own_n[ids])), list("NEW", "other", err_fn(N$pred[ids], own_o[ids])))
  for (s in sets) TBTR <- c(TBTR, paste(p, g, s[[1]], s[[2]], paste(meas(s[[3]]), collapse = ","), sep = ","))
}

## common_truth_errors
CTE <- character(0); CTE_MAE <- list()
for (p in PER) for (g in GN10) for (tr in TRU) for (r in c("OLD", "NEW")) {
  ids <- which(G[[g]] & pm[[p]] & V[[tr]])
  e <- if (r == "OLD") EO[[tr]][ids] else EN[[tr]][ids]
  mres <- meas(e)
  CTE <- c(CTE, paste(p, g, tr, r, paste(mres, collapse = ","), sep = ","))
  CTE_MAE[[paste(p, g, tr, r, sep = "|")]] <- mres[2]
}

## ---------------------------------------------------------------- bootstrap
cat("bootstrap\n")
bootm <- matrix(as.numeric(unlist(boparts)), ncol = 100, byrow = TRUE)
make_C <- function(B) {
  C <- matrix(0, 10000, B)
  rr <- 1:10000
  for (k in 1:B) {
    j <- (bootm[, k] * B) %/% 1e12
    ix <- cbind(rr, j + 1)
    C[ix] <- C[ix] + 1
  }
  C
}
CM <- list(design = make_C(85), test = make_C(83))
BB <- list(design = 85, test = 83)
interval_fn <- function(d, blk, p) {
  n <- length(d)
  if (n == 0) return(list(lo = "", hi = "", nvalid = 0, nskip = 10000))
  B <- BB[[p]]; C <- CM[[p]]
  sp <- split(d, factor(blk, levels = 0:(B - 1)))
  S <- vapply(sp, ssum, 0.0); Nj <- as.numeric(lengths(sp))
  num_ <- numeric(10000); den <- numeric(10000)
  for (j in 1:B) { num_ <- num_ + C[, j] * S[j]; den <- den + C[, j] * Nj[j] }
  ok <- den != 0
  nskip <- sum(!ok)
  if (nskip > 500) return(list(lo = "", hi = "", nvalid = 10000 - nskip, nskip = nskip))
  st <- num_[ok] / den[ok]
  list(lo = fmt6(pctl(st, 0.025)), hi = fmt6(pctl(st, 0.975)), nvalid = 10000 - nskip, nskip = nskip)
}
Pn <- N$pred; Nn <- floor(N$u + 0.5); Y0 <- y0_fn(N$L)
L3 <- N$L[lagidx(K, 3, K0, nrow_)]
Y1 <- y1_fn(N$L, L3, N$age, clk_n)
blk_of <- list(design = design_month(O$predTs), test = test_month(O$predTs))
CMP <- c("cap", "Y0", "Y1"); OTH <- list(cap = Nn, Y0 = Y0, Y1 = Y1)
NCY <- character(0); LAB <- list()
for (p in PER) for (g in GN10) for (tr in TRU) for (cmp in CMP) {
  ids <- which(G[[g]] & pm[[p]] & V[[tr]])
  n <- length(ids)
  if (n == 0) {
    NCY <- c(NCY, paste(p, g, tr, cmp, "0", "", "", "0", "0", "", "", "", "0", "10000", "unclear", sep = ","))
    LAB[[paste(p, g, tr, cmp, sep = "|")]] <- "unclear"
    next
  }
  eP <- err_fn(Pn[ids], TC[[tr]][ids]); eX <- err_fn(OTH[[cmp]][ids], TC[[tr]][ids])
  d <- abs(eX) - abs(eP)
  itv <- interval_fn(d, blk_of[[p]][ids], p)
  lab <- label_fn(itv$lo, itv$hi, if (cmp == "cap") "cap" else "y")
  LAB[[paste(p, g, tr, cmp, sep = "|")]] <- lab
  NCY <- c(NCY, paste(p, g, tr, cmp, fmti(n), fmt6(ssum(abs(eP)) / n), fmt6(ssum(abs(eX)) / n), fmti(sum(eP <= -15)),
                      fmti(sum(eX <= -15)), fmt6(ssum(d) / n), itv$lo, itv$hi, fmti(itv$nvalid), fmti(itv$nskip), lab, sep = ","))
}
NRD <- character(0)
for (p in PER) for (g in GN10) for (cmp in CMP) {
  l1 <- LAB[[paste(p, g, "central", cmp, sep = "|")]]; l2 <- LAB[[paste(p, g, "long", cmp, sep = "|")]]
  l3 <- LAB[[paste(p, g, "short", cmp, sep = "|")]]
  rr <- reading_fn(l1, l2, l3)
  NRD <- c(NRD, paste(p, g, cmp, l1, l2, l3, rr$reading, fmti(rr$holds), sep = ","))
}

## ---------------------------------------------------------------- self report
cat("self report\n")
DAYS <- c(design = 2587.0, test = 2505.0)
SELFD <- list(); N_UNJ <- list()
SELFACC <- list()
for (r in c("OLD", "NEW")) {
  D <- if (r == "OLD") O else N
  l <- LR[[r]]
  nl <- length(l$predTs)
  learned <- l$outcome == "learned"
  nb <- l$per != "burnin"
  Kl <- hour_key(l$predTs)
  si <- Kl - K0 + 1; si[si < 1 | si > nrow_] <- NA
  sest <- rep(FALSE, nl); okk <- !is.na(si); sest[okk] <- D$est[si[okk]]
  trl <- truth_at(epoch_ms(l$tauTs))
  tr_ok <- !is.na(trl) & trl > 0
  s1 <- learned; s2 <- s1 & nb; s3 <- s2 & sest; s4 <- s3 & tr_ok
  SELFACC[[r]] <- list(s1, s2, s3, s4)
  acc_chain(paste0("self_", r), c("hard_skipped", "burn_in", "no_shadow_estimate", "truth_missing"), list(s1, s2, s3, s4), nl)
  for (p in PER) {
    inp <- l$per == p
    n_rows <- sum(inp); n_learned <- sum(inp & learned)
    jr <- which(inp & s4)
    n_joined <- length(jr)
    n_unj <- n_learned - n_joined
    N_UNJ[[paste(r, p)]] <- n_unj
    si_j <- si[jr]
    shown <- D$pred[si_j]; tru <- trl[jr]
    e <- err_fn(shown, tru)
    nlow <- sum(e <= -15)
    bd <- band_fn(D$flowBin[si_j], D$flowState[si_j], shown)
    nin <- sum(bd$lo <= tru & tru <= bd$hi)
    SELFD[[paste(p, r)]] <- (paste(p, r, fmti(n_rows), fmti(n_learned), fmti(n_joined), fmti(n_unj),
                          fmt6(n_rows / DAYS[[p]]), fmt6(n_learned / DAYS[[p]]), fmti(nlow),
                          if (n_joined == 0) "" else fmt6((100.0 * nlow) / n_joined), fmti(nin),
                          if (n_joined == 0) "" else fmt6((100.0 * nin) / n_joined), sep = ","))
  }
}
SELF <- c(SELFD[["design OLD"]], SELFD[["design NEW"]], SELFD[["test OLD"]], SELFD[["test NEW"]])

## ---------------------------------------------------------------- learning health
cat("learning health\n")
LH <- character(0); LHV <- list()
for (r in c("OLD", "NEW")) {
  D <- if (r == "OLD") O else N
  c_ <- CNT[[r]]; l <- LR[[r]]
  cn <- c("slots_stored", "slot_blocked_hours", "learn_validations", "learned", "hard_skipped", "retries",
          "dropped_missed_window", "pending_at_end")
  for (m in cn) LH <- c(LH, paste(r, "whole_run", m, fmti(c_[[m]]), "counts_file", sep = ","))
  rate <- function(x) if (c_[["slots_stored"]] == 0) "" else fmt6((100.0 * x) / c_[["slots_stored"]])
  LH <- c(LH, paste(r, "whole_run", "rate_missed_window", rate(c_[["dropped_missed_window"]]), "counts_file", sep = ","),
          paste(r, "whole_run", "rate_retries", rate(c_[["retries"]]), "counts_file", sep = ","),
          paste(r, "whole_run", "rate_hard_skipped", rate(c_[["hard_skipped"]]), "counts_file", sep = ","))
  for (p in c("burnin", "design", "test")) {
    inp <- l$per == p
    vals <- c(n_learn_rows = sum(inp), n_learned = sum(inp & l$outcome == "learned"),
              n_hard_skipped = sum(inp & l$outcome == "hard_skipped"), n_clamped = sum(inp & l$clamped == "1"))
    for (m in names(vals)) LH <- c(LH, paste(r, p, m, fmti(vals[[m]]), "learn_file", sep = ","))
  }
  jump <- jumps_fn(K, D$raw, D$corr, D$est, K0)
  for (p in PER) {
    inp <- D$est & D$predTs >= DESIGN_START & (if (p == "design") D$predTs < TEST_START else D$predTs >= TEST_START)
    nest <- sum(inp)
    ncap <- sum(inp & (D$u > 1.2 * D$L))
    ncaplf <- sum(inp & (D$u > 1.2 * D$L) & G$lf_rising)
    nlf <- sum(G$lf_rising & pm[[p]])
    jv <- jump[inp & !is.na(jump)]
    nst <- length(jv)
    LH <- c(LH,
            paste(r, p, "n_est_hours", fmti(nest), "shadow_file", sep = ","),
            paste(r, p, "n_capped", fmti(ncap), "shadow_file", sep = ","),
            paste(r, p, "capped_share", if (nest == 0) "" else fmt6((100.0 * ncap) / nest), "shadow_file", sep = ","),
            paste(r, p, "n_capped_lf_rising", fmti(ncaplf), "shadow_file", sep = ","),
            paste(r, p, "capped_lf_rising_share", if (nlf == 0) "" else fmt6((100.0 * ncaplf) / nlf), "shadow_file", sep = ","),
            paste(r, p, "n_corr_steps", fmti(nst), "shadow_file", sep = ","),
            paste(r, p, "corr_jump_p95", if (nst == 0) "" else fmt6(pctl(jv, 0.95)), "shadow_file", sep = ","),
            paste(r, p, "corr_jump_p99", if (nst == 0) "" else fmt6(pctl(jv, 0.99)), "shadow_file", sep = ","),
            paste(r, p, "n_jumps_ge5", fmti(sum(jv >= 5.0)), "shadow_file", sep = ","))
    LHV[[paste(r, p, "p99")]] <- if (nst == 0) "" else fmt6(pctl(jv, 0.99))
    LHV[[paste(r, p, "ge5")]] <- sum(jv >= 5.0)
    LHV[[paste(r, p, "nsteps")]] <- nst
    LHV[[paste(r, p, "stepsM07")]] <- sum(abs(jv - 5.0) < 1e-9)
  }
}

## ---------------------------------------------------------------- B10, H, I, M rows
get_mae <- function(p, g, r) CTE_MAE[[paste(p, g, "central", r, sep = "|")]]
b10 <- function(id, p, g, stop_) {
  mn <- get_mae(p, g, "NEW"); mo <- get_mae(p, g, "OLD")
  a <- mic(mn); b <- mic(mo)
  ok <- !is.na(a) && !is.na(b) && a <= b
  got <- paste0(mn, ":", mo)
  if (stop_) add_check(id, "NEW<=OLD", got, if (ok) "P" else "F")
  else add_check(id, "", got, "I")
}
b10("B10a_mae_all", "test", "all", TRUE)
b10("B10b_mae_lf_rising", "test", "lf_rising", TRUE)
b10("B10c_mae_low_water", "test", "low_water", TRUE)
add_check("H01_pending_end", "0:0", paste0(fmti(CNT$OLD[["pending_at_end"]]), ":", fmti(CNT$NEW[["pending_at_end"]])),
          if (CNT$OLD[["pending_at_end"]] == 0 && CNT$NEW[["pending_at_end"]] == 0) "P" else "F")
h02 <- 0
for (x in c("dropped_missed_window", "retries", "hard_skipped"))
  if (!(2 * CNT$NEW[[x]] * CNT$OLD[["slots_stored"]] <= 3 * CNT$OLD[[x]] * CNT$NEW[["slots_stored"]])) h02 <- h02 + 1
add_viol("H02_rates", h02)
pn <- mic(LHV[["NEW test p99"]]); po <- mic(LHV[["OLD test p99"]])
add_viol("H03_jump_p99", if (is.na(pn) || is.na(po) || !(2 * pn <= 3 * po)) 1 else 0)
add_viol("H04_jumps_ge5", if (2 * LHV[["NEW test ge5"]] <= 3 * LHV[["OLD test ge5"]]) 0 else 1)
b10("I01_design_mae_all", "design", "all", FALSE)
b10("I01_design_mae_lf_rising", "design", "lf_rising", FALSE)
b10("I01_design_mae_low_water", "design", "low_water", FALSE)
add_check("I02_new_travel_same", "", fmti(sum(est_o & (O$travelGFtoLF != N$travelGFtoLF))), "I")
add_check("I03_clockq_lfcap", "", fmti(sum(est_n & (abs(N$clockQn - N$L) > 1e-9 * pmax(1.0, abs(N$L))))), "I")
tdt <- isb & pm$test & !is.na(TC$central) & in_range(TC$central) & hard_either
add_check("I04_hard_in_common", "", paste0(sum(tdt & O$truthDependentHard == "1"), ":", sum(tdt & N$truthDependentHard == "1")), "I")
add_check("I05_unjoined", "", paste0(N_UNJ[["OLD design"]] + N_UNJ[["OLD test"]], ":", N_UNJ[["NEW design"]] + N_UNJ[["NEW test"]]), "I")
m01 <- 0; m02 <- 0
for (tr in TRU) for (E in list(EO[[tr]], EN[[tr]])) {
  ee <- E[V[[tr]]]; dd <- abs(abs(ee) - 15.0)
  m01 <- m01 + sum(dd > 0 & dd < 1e-9); m02 <- m02 + sum(abs(ee) == 15.0)
}
add_check("M01_err15_margin", "", fmti(m01), "I")
add_check("M02_err15_exact", "", fmti(m02), "I")
m03 <- function(D) sum(D$est & (abs(D$u - 1.2 * D$L) > 0) & (abs(D$u - 1.2 * D$L) < 1e-9 * pmax(1.0, abs(D$u))), na.rm = TRUE)
add_check("M03_cap_margin", "", paste0(m03(O), ":", m03(N)), "I")
m04v <- !is.na(lf6) & !is.na(Lg) & isb & (abs(Lg - 1.10 * lf6) > 0) & (abs(Lg - 1.10 * lf6) < 1e-9 * pmax(1.0, abs(Lg)))
add_check("M04_lfrise_margin", "", fmti(sum(m04v, na.rm = TRUE)), "I")
m05f <- function(D, h) {
  due <- t_ms + h * 3600000.0
  sum(D$est & (abs(due - 3600000.0 * floor(due / 3600000.0 + 0.5)) < 1.0), na.rm = TRUE)
}
m05 <- m05f(O, O$trav) + m05f(N, N$clockHn)
add_check("M05_due_knife", "0", fmti(m05), if (m05 == 0) "P" else "F")
m06 <- function(D) { x <- D$u + 0.5; sum(D$est & (abs(x - floor(x + 0.5)) < 1e-9), na.rm = TRUE) }
add_check("M06_floor_margin", "", paste0(m06(O), ":", m06(N)), "I")
add_check("M07_jump_margin", "", paste0(LHV[["OLD design stepsM07"]] + LHV[["OLD test stepsM07"]], ":",
                                         LHV[["NEW design stepsM07"]] + LHV[["NEW test stepsM07"]]), "I")

## ---------------------------------------------------------------- write outputs
RA <- c("scope,step,condition,rows_in,rows_dropped,rows_left", ACC)
wr <- function(name, hdr, rows) writeLines(c(hdr, rows), file.path("r", name), useBytes = TRUE)
wr("badly_low_rising.csv", "period,truth,run,n,n_low,low_share", BLR)
wr("movement.csv", "period,group,n,n_excluded,mean,median,p05,p95,share_ge5,n_up,n_down,n_same,direction_by_count", MOV)
wr("groups.csv", "period,group,n,n_central,n_long,n_short,n_two_by_two", GROUPS_ROWS)
wr("two_by_two.csv", "period,group,run,truth,n,mae,bias,off,low,high", TBTR)
wr("common_truth_errors.csv", "period,group,truth,run,n,mae,bias,off,low,high", CTE)
wr("new_cap_yardsticks.csv", "period,group,truth,comparison,n,mae_app,mae_other,n_low_app,n_low_other,mean_d,lo,hi,n_valid,n_skipped,label", NCY)
wr("new_readings.csv", "period,group,comparison,label_central,label_long,label_short,reading,holds", NRD)
wr("self_report.csv", "period,run,n_rows,n_learned,n_joined,n_unjoined,validations_per_day,learned_per_day,n_low15,low15_share,n_inband,inband_share", SELF)
wr("learning_health.csv", "run,period,metric,value,source", LH)
write_checks()
wr("row_accounting.csv", "scope,step,condition,rows_in,rows_dropped,rows_left", ACC)
cat("done in ", format(as.numeric(difftime(Sys.time(), T_START, units = "secs"))), " s\n")

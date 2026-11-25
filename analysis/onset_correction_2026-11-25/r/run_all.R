Sys.setlocale("LC_COLLATE", "C")
options(warn = 1, scipen = 0)
T0 <- Sys.time()

OUT <- "r"
if (!file.exists("ANALYSIS_SPEC.md")) stop("run from the study folder")
if (!dir.exists(OUT)) dir.create(OUT)

## ---------------------------------------------------------------- helpers
fmt6 <- function(x) {
  if (length(x) != 1) stop("fmt6 needs a scalar")
  if (is.na(x) && !is.nan(x)) return("")
  if (is.nan(x) || is.infinite(x)) stop("non-finite value to write")
  s <- sprintf("%.6f", x)
  if (s == "-0.000000") s <- "0.000000"
  s
}
fmti <- function(x) {
  if (length(x) != 1) stop("fmti needs a scalar")
  if (is.na(x)) return("")
  sprintf("%d", as.integer(x))
}
mic_str <- function(s) {
  if (is.na(s) || s == "") return(NA_real_)
  if (s == "-0.000000") s <- "0.000000"
  as.numeric(sub(".", "", s, fixed = TRUE))
}
mic <- function(x) mic_str(fmt6(x))
ssum <- function(x) { s <- 0.0; for (v in x) s <- s + v; s }
mean_or_na <- function(x) if (length(x) == 0) NA_real_ else ssum(x) / length(x)
wr <- function(name, lines) {
  writeLines(lines, file.path(OUT, name), useBytes = TRUE)
}
wcsv <- function(name, header, rows) {
  wr(name, c(paste(header, collapse = ","), vapply(rows, paste, "", collapse = ",")))
}
num <- function(x) suppressWarnings(as.numeric(x))

## ---------------------------------------------------------------- core arithmetic
CAP <- 1.2
shown_of <- function(rawUnc, corr, lfCap) {
  v <- rawUnc - corr
  cp <- CAP * lfCap
  v <- ifelse(lfCap > 0, pmin(v, cp), v)
  floor(v + 0.5)
}
hw <- function(d6, thr6, m) ifelse(d6 == thr6, 0, pmin(1, (d6 / thr6 - 1) / (m - 1)))
hwf <- function(d6, thr6, m) ifelse((0 - d6) == thr6, 0, pmin(1, (((0 - d6) / thr6) - 1) / (m - 1)))
blend <- function(w, corrS, corrR) (1.0 - w) * corrS + w * corrR
err_of <- function(shown, truth) (shown - truth) / truth * 100

days_from_civil <- function(Y, M, D) {
  y <- Y - ifelse(M <= 2, 1, 0)
  era <- y %/% 400
  yoe <- y - era * 400
  doy <- (153 * (M + ifelse(M > 2, -3, 9)) + 2) %/% 5 + D - 1
  doe <- yoe * 365 + yoe %/% 4 - yoe %/% 100 + doy
  era * 146097 + doe - 719468
}
key_of <- function(ts) {
  Y <- as.numeric(substr(ts, 1, 4)); M <- as.numeric(substr(ts, 6, 7))
  D <- as.numeric(substr(ts, 9, 10)); H <- as.numeric(substr(ts, 12, 13))
  days_from_civil(Y, M, D) * 24 + H
}

T_DESIGN_START <- "2012-12-01T00:00:00.000Z"
T_TEST_START <- "2020-01-01T00:00:00.000Z"
T_HALF2 <- "2023-06-01T00:00:00.000Z"
T_1008 <- "2026-10-08T00:00:00.000Z"
is_design <- function(ts) ts >= T_DESIGN_START & ts < T_TEST_START
is_test <- function(ts) ts >= T_TEST_START
is_half1 <- function(ts) is_test(ts) & ts < T_HALF2
is_half2 <- function(ts) is_test(ts) & ts >= T_HALF2
md_of <- function(ts) 100 * as.numeric(substr(ts, 6, 7)) + as.numeric(substr(ts, 9, 10))
is_eel <- function(ts) { md <- md_of(ts); md >= 915 & md <= 1215 }
is_from1008 <- function(ts) ts >= T_1008
qlabel <- function(ml) paste0(substr(ml, 1, 4), "Q", ((as.numeric(substr(ml, 6, 7)) - 1) %/% 3) + 1)
MONTHS <- character(0)
for (y in 2020:2026) for (mm in 1:12) {
  if (y == 2026 && mm > 11) next
  MONTHS <- c(MONTHS, sprintf("%04d-%02d", y, mm))
}
QUARTERS <- character(0)
for (y in 2020:2026) for (q in 1:4) QUARTERS <- c(QUARTERS, sprintf("%dQ%d", y, q))
if (length(MONTHS) != 83 || length(QUARTERS) != 28) stop("block lists")

LOW4 <- c("0-3000", "3000-6000", "6000-12000", "12000-25000")
SIX <- c(LOW4, "25000-50000", "50000+")

rgroup <- function(r) ifelse(r < 1.5, "1-1.5", ifelse(r < 2, "1.5-2", ifelse(r < 3, "2-3",
  ifelse(r < 5, "3-5", ifelse(r < 10, "5-10", "10+")))))
spgroup <- function(k) ifelse(k <= 1, "1", ifelse(k == 2, "2", ifelse(k == 3, "3",
  ifelse(k <= 6, "4-6", ifelse(k <= 12, "7-12", "13+")))))
agegroup <- function(a) ifelse(is.na(a), "blank", ifelse(a < 24, "lt1d", ifelse(a < 168, "1-7d",
  ifelse(a < 720, "7-30d", "gt30d"))))

spell_age <- function(K, state) {
  n <- length(K); k <- rep(NA_real_, n)
  rising <- state == "rising"
  for (i in seq_len(n)) {
    if (rising[i]) {
      k[i] <- if (i > 1 && rising[i - 1] && (K[i] - K[i - 1]) == 1) k[i - 1] + 1 else 1
    }
  }
  k
}

pct_val <- function(x, p) {
  m <- length(x)
  pos <- (m - 1) * p
  i <- floor(pos)
  frac <- pos - i
  if (i + 1 > m - 1) x[i + 1] else x[i + 1] + frac * (x[i + 2] - x[i + 1])
}

## ---------------------------------------------------------------- unit tests
unit_results <- list()
ufail <- 0
expect <- function(ok) { if (!isTRUE(ok)) ufail <<- ufail + 1 }
run_unit <- function(name, f) {
  ufail <<- 0
  f()
  unit_results[[name]] <<- c(1, ufail)
}

run_unit("unit_round", function() {
  fl <- function(x) floor(x + 0.5)
  expect(fl(0.5) == 1); expect(fl(2.4) == 2); expect(fl(2.5) == 3); expect(fl(-0.5) == 0)
  expect(fl(-1.5) == -1); expect(fl(8.49) == 8); expect(fl(8.5) == 9)
})
run_unit("unit_key", function() {
  expect(key_of("2020-01-01T00:00:00.000Z") == 438288)
  expect(key_of("2012-12-01T00:00:00.000Z") == 376200)
  expect(key_of("2026-11-09T23:00:00.000Z") == 498407)
  expect(key_of("1970-01-01T00:00:00.000Z") == 0)
})
run_unit("unit_rule", function() {
  rawUnc <- 3000.4; cS <- 100; cR <- 300; cF <- -50
  sh <- function(corr, cap = 3300) shown_of(rep(rawUnc, length(corr)), corr, rep(cap, length(corr)))
  # basic
  w <- hw(150, 100, 2); c1 <- blend(w, cS, cR); expect(w == 0.5); expect(c1 == 200); expect(sh(c1) == 2800)
  w <- hw(100, 100, 2); c1 <- blend(w, cS, cR); expect(w == 0); expect(c1 == 100); expect(sh(c1) == 2900)
  w <- hw(400, 100, 3); c1 <- blend(w, cS, cR); expect(w == 1); expect(c1 == 300); expect(sh(c1) == 2700)
  c1 <- blend(0.5, cS, cR)
  expect(sh(c1, 2000) == 2400)
  expect(sh(c1, 0) == 2800)
  m3 <- ((cR + cS) + cF) / 3
  expect(abs(m3 - 116.66666666666667) < 1e-12); expect(sh(m3) == 2884)
  expect(sh(blend(0, cS, cR)) == 2900)
  w <- hwf(-250, 100, 3); expect(w == 0.75)
  c1 <- blend(w, cS, cF); expect(c1 == -12.5); expect(sh(c1) == 3013)
  # r exactly m
  for (m in c(1.5, 2, 3, 5)) { w <- hw(100 * m, 100, m); expect(w == 1); expect(sh(blend(w, cS, cR)) == 2700) }
  # d6 = 125
  ms <- c(1.5, 2, 3, 5)
  w <- hw(rep(125, 4), rep(100, 4), ms); expect(all(w == c(0.5, 0.25, 0.125, 0.0625)))
  c1 <- blend(w, cS, cR); expect(all(c1 == c(200, 150, 125, 112.5)))
  expect(all(sh(c1) == c(2800, 2850, 2875, 2888)))
  # d6 = 300, thr6 = 120
  w <- hw(rep(300, 4), rep(120, 4), ms); expect(all(w == c(1, 1, 0.75, 0.375)))
  expect(all(sh(blend(w, cS, cR)) == c(2700, 2700, 2750, 2825)))
  # exact halves
  expect(shown_of(3000.5, 100, 3300) == 2901)
  expect(shown_of(99.5, 100, 3300) == 0)
  expect(shown_of(98.5, 100, 3300) == -1)
  # cap under one rule and not another
  expect(sh(blend(0, cS, cR), 2400) == 2880)
  expect(sh(blend(1, cS, cR), 2400) == 2700)
  expect(sh(blend(1, cS, cR), -5) == 2700)
  # negative correction
  c1 <- blend(0.5, -200, 100); expect(c1 == -50); expect(sh(c1) == 3050)
  # both sides falling tie and far fall
  w <- hwf(-100, 100, 3); expect(w == 0); expect(sh(blend(w, cS, cF)) == 2900)
  w <- hwf(-400, 100, 3); c1 <- blend(w, cS, cF); expect(w == 1); expect(c1 == -50); expect(sh(c1) == 3050)
  # error boundary
  expect((850 - 1000) / 1000 * 100 == -15)
  expect((1150 - 1000) / 1000 * 100 == 15)
  expect((17 - 20) / 20 * 100 == -15)
  expect((850 - 1000) / 1000 * 100 <= -15)
  expect((1150 - 1000) / 1000 * 100 >= 15)
  expect((17 - 20) / 20 * 100 <= -15)
})
run_unit("unit_groups", function() {
  expect(rgroup(1.5) == "1.5-2"); expect(rgroup(10) == "10+"); expect(rgroup(1) == "1-1.5")
  expect(rgroup(4.999) == "3-5")
  expect(identical(spgroup(c(3, 4, 6, 7, 12, 13)), c("3", "4-6", "4-6", "7-12", "7-12", "13+")))
  expect(identical(agegroup(c(23, 24, 167, 168, 719, 720, NA)),
                   c("lt1d", "1-7d", "1-7d", "7-30d", "7-30d", "gt30d", "blank")))
})
run_unit("unit_spell", function() {
  K <- c(0, 1, 2, 3, 4, 5, 6, 8, 9)
  st <- c("steady", "rising", "rising", "rising", "", "rising", "rising", "rising", "rising")
  k <- spell_age(K, st)
  expect(identical(k, c(NA, 1, 2, 3, NA, 1, 2, 1, 2)))
})
run_unit("unit_percentile", function() {
  x <- as.numeric(1:10000)
  expect(abs(pct_val(x, 0.025) - 250.975) < 1e-9)
  expect(abs(pct_val(x, 0.975) - 9750.025) < 1e-9)
})
run_unit("unit_periods", function() {
  expect(is_design("2019-12-31T23:00:00.000Z") && !is_test("2019-12-31T23:00:00.000Z"))
  expect(is_test("2020-01-01T00:00:00.000Z") && !is_design("2020-01-01T00:00:00.000Z"))
  expect(is_half1("2023-05-31T23:00:00.000Z") && !is_half2("2023-05-31T23:00:00.000Z"))
  expect(is_half2("2023-06-01T00:00:00.000Z") && !is_half1("2023-06-01T00:00:00.000Z"))
  expect(!is_eel("2025-09-14T23:00:00.000Z")); expect(is_eel("2025-09-15T00:00:00.000Z"))
  expect(is_eel("2025-12-15T23:00:00.000Z")); expect(!is_eel("2025-12-16T00:00:00.000Z"))
  expect(!is_from1008("2026-10-07T23:00:00.000Z")); expect(is_from1008("2026-10-08T00:00:00.000Z"))
  expect(qlabel("2020-03") == "2020Q1"); expect(qlabel("2020-04") == "2020Q2"); expect(qlabel("2026-11") == "2026Q4")
  expect(match("2020-01", MONTHS) - 1 == 0); expect(match("2026-11", MONTHS) - 1 == 82)
  expect(match("2026Q4", QUARTERS) - 1 == 27)
})

## ---------------------------------------------------------------- inputs: hashes
exp_hash <- c(
  "replay_L/shadow_L.csv" = "dcc63931841b537a834962b9a7c60e6edfd3b72b8bd491b43af89bbba0ba5aba",
  "replay_F/shadow_F.csv" = "7fb8072237cd21c99d196a7b2c1525f4aa850885638e4f06321617cdcf2a63a3",
  "tools/boot_uniforms.csv" = "71d75af9b10c1ba4d3d9492f0e07d17497a35e01d3568d9b3ed8ab8fe528d515")
exp_size <- c("replay_L/shadow_L.csv" = 109952178, "replay_F/shadow_F.csv" = 110149295,
              "tools/boot_uniforms.csv" = 13000392)
for (p in names(exp_hash)) {
  h <- unname(tools::sha256sum(p))
  if (h != exp_hash[[p]]) stop("SHA-256 mismatch: ", p)
  if (file.size(p) != exp_size[[p]]) stop("size mismatch: ", p)
}
if (unname(tools::sha256sum("ANALYSIS_SPEC.md")) !=
    "8485759c0586114eb0c6b8d37e2e83d2f4850a56518753cfb5133fc4a5b10d11") stop("spec hash")

## ---------------------------------------------------------------- boot uniforms
bhdr <- strsplit(readLines("tools/boot_uniforms.csv", n = 1L), ",", fixed = TRUE)[[1]]
if (!identical(bhdr, paste0("u", 1:100))) stop("boot header")
bcc <- c(rep("character", 83), rep("NULL", 17)); names(bcc) <- bhdr
bdf <- read.csv("tools/boot_uniforms.csv", header = TRUE, colClasses = bcc, quote = "",
                comment.char = "", na.strings = character(0), stringsAsFactors = FALSE)
if (nrow(bdf) != 10000 || ncol(bdf) != 83) stop("boot dims")
U <- matrix(0, 10000, 83)
for (j in 1:83) {
  if (any(nchar(bdf[[j]]) != 12)) stop("boot cell width")
  U[, j] <- as.numeric(bdf[[j]])
}
first_cell <- bdf[[1]][1]
run_unit("unit_boot_index", function() {
  bi <- function(n, B) (n * B) %/% 1e12
  expect(bi(0, 83) == 0); expect(bi(999999999999, 83) == 82); expect(bi(500000000000, 7) == 3)
  expect(first_cell == "343638232196")
  expect(bi(U[1, 1], 83) == 28); expect(bi(U[1, 1], 28) == 9)
})
CM <- list()
for (B in c(83, 28)) {
  jm <- (U[, 1:B, drop = FALSE] * B) %/% 1e12
  if (any(jm < 0 | jm > B - 1)) stop("block index range")
  M <- matrix(0, 10000, B)
  for (r in 1:10000) M[r, ] <- tabulate(jm[r, ] + 1, B)
  CM[[as.character(B)]] <- M
}

unit_order <- c("unit_round", "unit_key", "unit_rule", "unit_groups", "unit_spell",
                "unit_percentile", "unit_periods", "unit_boot_index")
unit_rows <- lapply(unit_order, function(nm) c(nm, "-", fmti(unit_results[[nm]][1]), fmti(unit_results[[nm]][2])))
if (any(vapply(unit_results, function(z) z[2], 0) > 0)) {
  wcsv("checks.csv", c("check", "arm", "n_checked", "n_violations"), unit_rows)
  stop("unit test failed")
}

## ---------------------------------------------------------------- arm loading
USED <- c("predTs", "status", "rawFinalCFS", "predictedCFS", "flowBin", "flowState", "truthFlow",
          "truthInProdRange", "truthDependentHard", "errPctRaw", "errPctCorr", "rawUnc", "corrUsed",
          "corrR", "corrS", "corrF", "d6", "thr6", "span_h", "lfCap", "ageR_h")
NUMCOLS <- c("rawFinalCFS", "predictedCFS", "truthFlow", "errPctRaw", "errPctCorr", "rawUnc", "corrUsed",
             "corrR", "corrS", "corrF", "d6", "thr6", "span_h", "lfCap", "ageR_h")
NUMRE <- "^-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?$"

rule_corr <- function(a, rule, m = NA) {
  switch(rule,
    production = a$corrUsed,
    handover = ifelse(a$R, blend(hw(a$d6, a$thr6, m), a$corrS, a$corrR), a$corrUsed),
    half_half = ifelse(a$R, blend(0.5, a$corrS, a$corrR), a$corrUsed),
    mean_of_three = ifelse(a$R, ((a$corrR + a$corrS) + a$corrF) / 3, a$corrUsed),
    steady_always = ifelse(a$R, blend(0, a$corrS, a$corrR), a$corrUsed),
    both_sides = ifelse(a$R, blend(hw(a$d6, a$thr6, m), a$corrS, a$corrR),
                        ifelse(a$fl, blend(hwf(a$d6, a$thr6, m), a$corrS, a$corrF), a$corrUsed)),
    stop("rule"))
}
rule_inset <- function(a, rule) {
  switch(rule, production = rep(FALSE, a$n), both_sides = a$R | a$fl, a$R)
}
get_rule <- function(a, rule, m = NA) {
  corr <- rule_corr(a, rule, m)
  sh <- shown_of(a$rawUnc, corr, a$lfCap)
  list(shown = sh, err = err_of(sh, a$truth))
}

load_arm <- function(arm, path) {
  hdr <- strsplit(readLines(path, n = 1L), ",", fixed = TRUE)[[1]]
  cf <- count.fields(path, sep = ",", quote = "", comment.char = "", blank.lines.skip = FALSE)
  nrows <- length(cf) - 1
  chk <- list()
  chk$C01 <- c(nrows, sum(cf[-1] != 87) + as.numeric(nrows != 130987))
  cnt <- vapply(USED, function(nm) sum(hdr == nm), 0)
  chk$C02 <- c(21, sum(cnt != 1))
  if (any(cnt != 1) || length(hdr) != 87) stop("header problem in arm ", arm)
  cc <- ifelse(hdr %in% USED, "character", "NULL"); names(cc) <- hdr
  df <- read.csv(path, header = TRUE, colClasses = cc, quote = "", comment.char = "",
                 na.strings = character(0), stringsAsFactors = FALSE)
  if (nrow(df) != nrows) stop("read.csv row count differs from count.fields in arm ", arm)
  n <- nrows
  ts <- df$predTs
  ok <- nchar(ts) == 24 & grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:00:00\\.000Z$", ts)
  Mo <- suppressWarnings(as.integer(substr(ts, 6, 7))); Dd <- suppressWarnings(as.integer(substr(ts, 9, 10)))
  Hh <- suppressWarnings(as.integer(substr(ts, 12, 13)))
  bad <- !ok | is.na(Mo) | Mo < 1 | Mo > 12 | is.na(Dd) | Dd < 1 | Dd > 31 | is.na(Hh) | Hh < 0 | Hh > 23
  chk$C03 <- c(n, sum(bad))
  K <- key_of(ts)
  dk <- diff(K)
  chk$C04 <- c(n - 1, sum(is.na(dk) | dk != 1))
  # spell age on all rows
  kall <- spell_age(K, df$flowState)
  # scoring
  alive <- rep(TRUE, n)
  acc <- list(c("read", n, 0, n))
  conds <- list(
    status_not_predicted = df$status != "predicted",
    burn_in = ts < T_DESIGN_START,
    truth_dependent_hard = df$truthDependentHard == "1",
    truth_out_of_range = df$truthInProdRange == "0",
    blank_error = df$errPctCorr == "" | df$errPctRaw == "")
  for (nm in names(conds)) {
    rin <- sum(alive)
    drop <- alive & conds[[nm]]
    alive <- alive & !drop
    acc[[length(acc) + 1]] <- c(nm, rin, sum(drop), sum(alive))
  }
  s <- which(alive)
  ns <- length(s)
  S <- function(col) df[[col]][s]
  # C05
  n5 <- 0; v5 <- 0
  for (cn in NUMCOLS) {
    x <- S(cn); nb <- x != ""
    n5 <- n5 + sum(nb); v5 <- v5 + sum(!grepl(NUMRE, x[nb]))
  }
  chk$C05 <- c(n5, v5)
  # C06
  need <- c("rawFinalCFS", "predictedCFS", "flowBin", "flowState", "truthFlow", "truthInProdRange",
            "truthDependentHard", "rawUnc", "corrUsed", "corrR", "corrS", "corrF", "lfCap", "thr6",
            "errPctRaw", "errPctCorr")
  v6 <- rep(FALSE, ns)
  for (cn in need) v6 <- v6 | (S(cn) == "")
  fs <- S("flowState"); fb <- S("flowBin")
  v6 <- v6 | !(fs %in% c("rising", "steady", "falling")) | !(fb %in% SIX) |
    (fs %in% c("rising", "falling") & (S("d6") == "" | S("span_h") == ""))
  chk$C06 <- c(ns, sum(v6))
  a <- list(arm = arm, n = ns, ts = S("predTs"), flowBin = fb, flowState = fs,
            truth = num(S("truthFlow")), rawFinal = num(S("rawFinalCFS")), predicted = num(S("predictedCFS")),
            errPctRaw = num(S("errPctRaw")), errPctCorr = num(S("errPctCorr")),
            rawUnc = num(S("rawUnc")), corrUsed = num(S("corrUsed")), corrR = num(S("corrR")),
            corrS = num(S("corrS")), corrF = num(S("corrF")), d6 = num(S("d6")), thr6 = num(S("thr6")),
            span_h = num(S("span_h")), lfCap = num(S("lfCap")), ageR_h = num(S("ageR_h")),
            k = kall[s])
  a$low4 <- fb %in% LOW4
  a$R <- fs == "rising" & a$low4
  a$fl <- fs == "falling" & a$low4
  a$test <- is_test(a$ts); a$design <- is_design(a$ts)
  a$eel <- is_eel(a$ts)
  chk$C07 <- c(ns, sum(a$truth <= 0, na.rm = TRUE))
  ctext <- ifelse(fs == "rising", S("corrR"), ifelse(fs == "steady", S("corrS"),
            ifelse(fs == "falling", S("corrF"), NA_character_)))
  chk$C08 <- c(ns, sum(is.na(ctext) | S("corrUsed") != ctext))
  prod <- get_rule(a, "production")
  chk$C09 <- c(ns, sum(prod$shown != a$predicted, na.rm = TRUE))
  chk$C10 <- c(ns, sum(abs(prod$err - a$errPctCorr) > 1e-9, na.rm = TRUE))
  chk$C11 <- c(ns, sum(abs(err_of(a$rawFinal, a$truth) - a$errPctRaw) > 1e-9, na.rm = TRUE))
  ris <- fs == "rising"; fal <- fs == "falling"
  v12 <- (ris & (a$thr6 <= 0 | a$d6 < a$thr6)) | (fal & (a$thr6 <= 0 | (0 - a$d6) < a$thr6))
  chk$C12 <- c(sum(ris | fal), sum(v12, na.rm = TRUE))
  MS <- c(1.5, 2, 3, 5)
  v13 <- 0
  for (m in MS) {
    w <- hw(a$d6, a$thr6, m)[a$R]; v13 <- v13 + sum(!(w >= 0 & w <= 1))
    w <- hwf(a$d6, a$thr6, m)[a$fl]; v13 <- v13 + sum(!(w >= 0 & w <= 1))
  }
  w <- rep(0.5, sum(a$R)); v13 <- v13 + sum(!(w >= 0 & w <= 1))
  chk$C13 <- c(5 * sum(a$R) + 4 * sum(a$fl), v13)
  variants <- list(list("handover", 1.5), list("handover", 2), list("handover", 3), list("handover", 5),
                   list("half_half", NA), list("mean_of_three", NA), list("steady_always", NA),
                   list("both_sides", 1.5), list("both_sides", 2), list("both_sides", 3), list("both_sides", 5))
  v14 <- 0; v15 <- sum(abs(prod$err + 15) < 1e-9 | abs(prod$err - 15) < 1e-9, na.rm = TRUE)
  for (vv in variants) {
    r <- get_rule(a, vv[[1]], vv[[2]])
    ins <- rule_inset(a, vv[[1]])
    v14 <- v14 + sum(!ins & r$shown != prod$shown)
    v15 <- v15 + sum(abs(r$err + 15) < 1e-9 | abs(r$err - 15) < 1e-9, na.rm = TRUE)
  }
  chk$C14 <- c(11 * ns, v14)
  a$rh <- fs == "rising" & !a$low4 & a$test
  ratio <- a$d6 / a$thr6
  for (m in MS) v15 <- v15 + sum(a$rh & abs(ratio - m) < 1e-9 * m & ratio != m, na.rm = TRUE)
  chk$C15 <- c(12 * ns + 4 * sum(a$rh), v15)
  tt <- which(a$test)
  ml <- substr(a$ts[tt], 1, 7)
  okb <- ml %in% MONTHS & qlabel(ml) %in% QUARTERS
  chk$C16 <- c(length(tt), sum(!okb))
  a$mi <- ifelse(a$test, match(substr(a$ts, 1, 7), MONTHS) - 1, NA_real_)
  a$qi <- ifelse(a$test, match(qlabel(substr(a$ts, 1, 7)), QUARTERS) - 1, NA_real_)
  list(a = a, chk = chk, acc = acc, prod = prod)
}

LA <- load_arm("L", "replay_L/shadow_L.csv")
FA <- load_arm("F", "replay_F/shadow_F.csv")

CHK_NAMES <- c(C01 = "C01_rows_fields", C02 = "C02_header", C03 = "C03_predTs_form", C04 = "C04_hour_grid",
               C05 = "C05_numbers_parse", C06 = "C06_needed_nonblank", C07 = "C07_truth_positive",
               C08 = "C08_corr_of_state", C09 = "C09_shown_recomputed", C10 = "C10_err_corr",
               C11 = "C11_err_raw", C12 = "C12_ratio_ge_1", C13 = "C13_weights_range",
               C14 = "C14_unchanged_outside", C15 = "C15_parse_margin", C16 = "C16_blocks_cover")
chk_rows <- unit_rows
stop_run <- FALSE
for (id in names(CHK_NAMES)) {
  for (ar in list(list("L", LA), list("F", FA))) {
    z <- ar[[2]]$chk[[id]]
    chk_rows[[length(chk_rows) + 1]] <- c(CHK_NAMES[[id]], ar[[1]], fmti(z[1]), fmti(z[2]))
    if (id != "C15" && z[2] > 0) stop_run <- TRUE
  }
}
wcsv("checks.csv", c("check", "arm", "n_checked", "n_violations"), chk_rows)
if (stop_run) stop("a stopping check has violations; see r/checks.csv")

## ---------------------------------------------------------------- row accounting, populations
rows <- list()
for (ar in list(list("L", LA), list("F", FA))) {
  for (i in seq_along(ar[[2]]$acc)) {
    z <- ar[[2]]$acc[[i]]
    rows[[length(rows) + 1]] <- c(ar[[1]], fmti(i - 1), z[1], fmti(as.numeric(z[2])), fmti(as.numeric(z[3])), fmti(as.numeric(z[4])))
  }
}
wcsv("row_accounting.csv", c("arm", "step", "condition", "rows_in", "rows_dropped", "rows_left"), rows)

arm_pops <- function(a, U) {
  Rt <- a$R & a$test
  list(
    scored = rep(TRUE, a$n), scored_design = a$design, scored_test = a$test,
    R_design = a$R & a$design, R_test = Rt,
    R_test_half1 = Rt & is_half1(a$ts), R_test_half2 = Rt & is_half2(a$ts),
    R_test_eel = Rt & a$eel, R_test_noneel = Rt & !a$eel,
    cells = lapply(LOW4, function(b) Rt & a$flowBin == b),
    R_test_before1008 = Rt & !is_from1008(a$ts), R_test_from1008 = Rt & is_from1008(a$ts))
}
Uval <- c(L = 4, F = 5)
rows <- list()
for (ar in list(list("L", LA$a), list("F", FA$a))) {
  a <- ar[[2]]; nm <- ar[[1]]; P <- arm_pops(a, Uval[[nm]])
  add <- function(p, n) rows[[length(rows) + 1]] <<- c(nm, p, fmti(n))
  add("scored", a$n); add("scored_design", sum(a$design)); add("scored_test", sum(a$test))
  add("R_design", sum(P$R_design)); add("R_test", sum(P$R_test))
  add("R_design_span_unusual", sum(P$R_design & a$span_h != Uval[[nm]]))
  add("R_test_span_unusual", sum(P$R_test & a$span_h != Uval[[nm]]))
  add("span_usual_value", Uval[[nm]])
  add("R_test_half1", sum(P$R_test_half1)); add("R_test_half2", sum(P$R_test_half2))
  add("R_test_eel", sum(P$R_test_eel)); add("R_test_noneel", sum(P$R_test_noneel))
  for (i in 1:4) add(paste0("R_test_cell_", LOW4[i]), sum(P$cells[[i]]))
  add("R_test_before1008", sum(P$R_test_before1008)); add("R_test_from1008", sum(P$R_test_from1008))
  add("rising_high_test", sum(a$rh)); add("falling_low_test", sum(a$fl & a$test))
  add("blocks_months", length(MONTHS)); add("blocks_quarters", length(QUARTERS))
}
wcsv("populations.csv", c("arm", "population", "n"), rows)

## ---------------------------------------------------------------- Step A1 (arm L)
a <- LA$a
Rd <- a$R & a$design
errRaw <- err_of(a$rawFinal, a$truth)
RP <- get_rule(a, "production"); RS <- get_rule(a, "steady_always")
rr <- a$d6 / a$thr6
rg <- rgroup(rr)
A1_levels <- list(
  all = list(all = rep(TRUE, a$n)),
  corr = list(R_larger = a$corrR > a$corrS, R_not_larger = a$corrR <= a$corrS),
  flowbin = setNames(lapply(LOW4, function(b) a$flowBin == b), LOW4),
  spell = list(`1` = spgroup(a$k) == "1", `2` = spgroup(a$k) == "2", `3` = spgroup(a$k) == "3",
               `4-6` = spgroup(a$k) == "4-6", `7-12` = spgroup(a$k) == "7-12", `13+` = spgroup(a$k) == "13+"),
  ageR = list(lt1d = agegroup(a$ageR_h) == "lt1d", `1-7d` = agegroup(a$ageR_h) == "1-7d",
              `7-30d` = agegroup(a$ageR_h) == "7-30d", gt30d = agegroup(a$ageR_h) == "gt30d",
              blank = agegroup(a$ageR_h) == "blank"))
RGS <- c("1-1.5", "1.5-2", "2-3", "3-5", "5-10", "10+", "all")
rows <- list()
for (tb in names(A1_levels)) {
  for (lv in names(A1_levels[[tb]])) {
    lm <- A1_levels[[tb]][[lv]]
    for (g in RGS) {
      idx <- which(Rd & lm & (g == "all" | rg == g))
      n <- length(idx)
      f <- function(e) if (n == 0) "" else fmt6(ssum(e[idx]) / n)
      fa <- function(e) if (n == 0) "" else fmt6(ssum(abs(e[idx])) / n)
      rows[[length(rows) + 1]] <- c(tb, lv, g, fmti(n), f(errRaw), fa(errRaw), f(RP$err), fa(RP$err),
                                    f(RS$err), fa(RS$err))
    }
  }
}
wcsv("a1_tables.csv", c("table", "split", "rgroup", "n", "mean_signed_raw", "mean_abs_raw", "mean_signed_prod",
                        "mean_abs_prod", "mean_signed_steady", "mean_abs_steady"), rows)

## ---------------------------------------------------------------- Step A2
RULES8 <- list(list("production", "production", NA, "baseline"),
               list("handover_m1.5", "handover", 1.5, "candidate"),
               list("handover_m2", "handover", 2, "candidate"),
               list("handover_m3", "handover", 3, "candidate"),
               list("handover_m5", "handover", 5, "candidate"),
               list("half_half", "half_half", NA, "control"),
               list("mean_of_three", "mean_of_three", NA, "control"),
               list("steady_always", "steady_always", NA, "control"))
rule_res <- list()
for (rl in RULES8) rule_res[[rl[[1]]]] <- get_rule(a, rl[[2]], rl[[3]])
nd <- sum(Rd)
a2 <- list()
for (rl in RULES8) {
  e <- rule_res[[rl[[1]]]]$err[Rd]
  a2[[rl[[1]]]] <- c(n = nd, mae = ssum(abs(e)) / nd, ms = ssum(e) / nd)
}
cand <- c("handover_m1.5", "handover_m2", "handover_m3", "handover_m5")
candm <- c(1.5, 2, 3, 5)
cmic <- vapply(cand, function(x) mic(a2[[x]][["mae"]]), 0)
ord <- order(cmic, candm)
rank <- integer(4); rank[ord] <- 1:4
b1 <- ord[1]; b2 <- ord[2]
P0 <- mic(a2[["production"]][["mae"]])
beats <- as.numeric(cmic[b1] < P0)
if (beats == 0) {
  mstar <- candm[b1]
} else if (candm[b2] < candm[b1] && (cmic[b2] - cmic[b1]) <= 20000 && cmic[b2] < P0) {
  mstar <- candm[b2]
} else mstar <- candm[b1]
tie_used <- as.numeric(mstar != candm[b1])
rows <- list(); k <- 0
for (rl in RULES8) {
  nm <- rl[[1]]
  rk <- if (nm %in% cand) fmti(rank[match(nm, cand)]) else ""
  rows[[length(rows) + 1]] <- c(nm, rl[[4]], fmti(a2[[nm]][["n"]]), fmt6(a2[[nm]][["mae"]]), fmt6(a2[[nm]][["ms"]]), rk)
}
wcsv("a2_pick.csv", c("rule", "role", "n", "mae", "mean_signed", "mae_rank"), rows)
mae_best <- a2[[cand[b1]]][["mae"]]; mae_second <- a2[[cand[b2]]][["mae"]]
wcsv("mstar.csv", c("key", "value"), list(
  c("m_star", fmt6(mstar)), c("m_best", fmt6(candm[b1])), c("m_second", fmt6(candm[b2])),
  c("mae_best", fmt6(mae_best)), c("mae_second", fmt6(mae_second)),
  c("gap_best_second", fmt6(mae_second - mae_best)), c("tie_rule_used", fmti(tie_used)),
  c("mae_production", fmt6(a2[["production"]][["mae"]])), c("beats_production", fmti(beats))))

## ---------------------------------------------------------------- Step B
ms_lines <- readLines(file.path(OUT, "mstar.csv"))
MSTAR <- as.numeric(strsplit(ms_lines[2], ",", fixed = TRUE)[[1]][2])
BEATS <- as.numeric(strsplit(ms_lines[10], ",", fixed = TRUE)[[1]][2])
if (MSTAR != mstar || BEATS != beats) stop("mstar read-back")

MEAS_COLS <- c("n", "n_affected", "n_raised", "n_lowered", "mean_d", "mean_d_affected", "mean_abs_change_cfs",
               "mean_signed_change_cfs", "mean_abs_change_pct", "mae_prod", "mae_rule", "bias_prod", "bias_rule",
               "below15_prod", "below15_rule", "above15_prod", "above15_rule", "rel_mae_diff")
meas <- function(P, eP, eX, sP, sX, truth) {
  idx <- which(P); n <- length(idx)
  r <- setNames(rep(NA_real_, length(MEAS_COLS)), MEAS_COLS)
  r[["n"]] <- n
  r[["n_affected"]] <- 0; r[["n_raised"]] <- 0; r[["n_lowered"]] <- 0
  if (n == 0) return(r)
  eP <- eP[idx]; eX <- eX[idx]; sP <- sP[idx]; sX <- sX[idx]; truth <- truth[idx]
  d <- abs(eX) - abs(eP)
  aff <- sX != sP
  r[["n_affected"]] <- sum(aff); r[["n_raised"]] <- sum(sX > sP); r[["n_lowered"]] <- sum(sX < sP)
  r[["mean_d"]] <- ssum(d) / n
  if (sum(aff) > 0) {
    ia <- which(aff); na <- length(ia)
    chg <- sX[ia] - sP[ia]
    chgpct <- abs(sX[ia] - sP[ia]) / truth[ia] * 100
    r[["mean_d_affected"]] <- ssum(d[ia]) / na
    r[["mean_abs_change_cfs"]] <- ssum(abs(chg)) / na
    r[["mean_signed_change_cfs"]] <- ssum(chg) / na
    r[["mean_abs_change_pct"]] <- ssum(chgpct) / na
  }
  r[["mae_prod"]] <- ssum(abs(eP)) / n; r[["mae_rule"]] <- ssum(abs(eX)) / n
  r[["bias_prod"]] <- ssum(eP) / n; r[["bias_rule"]] <- ssum(eX) / n
  r[["below15_prod"]] <- 100 * sum(eP <= -15) / n; r[["below15_rule"]] <- 100 * sum(eX <= -15) / n
  r[["above15_prod"]] <- 100 * sum(eP >= 15) / n; r[["above15_rule"]] <- 100 * sum(eX >= 15) / n
  if (!is.na(r[["mae_prod"]]) && r[["mae_prod"]] != 0)
    r[["rel_mae_diff"]] <- (r[["mae_rule"]] - r[["mae_prod"]]) / r[["mae_prod"]]
  r
}
meas_row <- function(r) {
  out <- character(length(MEAS_COLS))
  for (i in seq_along(MEAS_COLS)) out[i] <- if (i <= 4) fmti(r[[i]]) else fmt6(r[[i]])
  out
}

arm_stepb <- function(a, U, m) {
  prod <- get_rule(a, "production")
  X <- get_rule(a, "handover", m)
  Rt <- a$R & a$test
  d <- abs(X$err) - abs(prod$err)
  aff <- X$shown != prod$shown
  P <- list(
    R = Rt, R_half1 = Rt & is_half1(a$ts), R_half2 = Rt & is_half2(a$ts), R_eel = Rt & a$eel,
    R_noneel = Rt & !a$eel,
    `R_cell_0-3000` = Rt & a$flowBin == "0-3000", `R_cell_3000-6000` = Rt & a$flowBin == "3000-6000",
    `R_cell_6000-12000` = Rt & a$flowBin == "6000-12000", `R_cell_12000-25000` = Rt & a$flowBin == "12000-25000",
    R_affected = Rt & aff, R_raised = Rt & (X$shown > prod$shown), R_lowered = Rt & (X$shown < prod$shown),
    R_before1008 = Rt & !is_from1008(a$ts), R_from1008 = Rt & is_from1008(a$ts),
    R_span_usual = Rt & a$span_h == U, scored_all = a$test)
  list(prod = prod, X = X, d = d, P = P, Rt = Rt)
}
SL <- arm_stepb(LA$a, 4, MSTAR)
SF <- arm_stepb(FA$a, 5, MSTAR)
POPS_L <- c("R", "R_half1", "R_half2", "R_eel", "R_noneel", "R_cell_0-3000", "R_cell_3000-6000",
            "R_cell_6000-12000", "R_cell_12000-25000", "R_affected", "R_raised", "R_lowered",
            "R_before1008", "R_from1008", "R_span_usual", "scored_all")
POPS_F <- c("R", "R_affected", "R_span_usual", "scored_all")
rows <- list(); MAIN <- list()
for (pn in POPS_L) {
  r <- meas(SL$P[[pn]], SL$prod$err, SL$X$err, SL$prod$shown, SL$X$shown, LA$a$truth)
  MAIN[[paste0("L|", pn)]] <- r
  rows[[length(rows) + 1]] <- c("L", "handover_mstar", pn, meas_row(r))
}
for (pn in POPS_F) {
  r <- meas(SF$P[[pn]], SF$prod$err, SF$X$err, SF$prod$shown, SF$X$shown, FA$a$truth)
  MAIN[[paste0("F|", pn)]] <- r
  rows[[length(rows) + 1]] <- c("F", "handover_mstar", pn, meas_row(r))
}
wcsv("stepb_main.csv", c("arm", "rule", "population", MEAS_COLS), rows)

# stepb_rules
a <- LA$a
rows <- list()
for (rl in RULES8) {
  X <- get_rule(a, rl[[2]], rl[[3]])
  r <- meas(SL$Rt, SL$prod$err, X$err, SL$prod$shown, X$shown, a$truth)
  rows[[length(rows) + 1]] <- c(rl[[1]], "R_test", meas_row(r))
}
wcsv("stepb_rules.csv", c("rule", "population", MEAS_COLS), rows)

# both_sides
BS <- get_rule(a, "both_sides", MSTAR)
flt <- a$fl & a$test
Ball <- SL$Rt | flt
bp <- list(B_all = Ball, B_eel = Ball & a$eel, B_noneel = Ball & !a$eel, B_falling = flt,
           B_falling_eel = flt & a$eel, B_falling_noneel = flt & !a$eel)
rows <- list()
for (pn in names(bp)) {
  r <- meas(bp[[pn]], SL$prod$err, BS$err, SL$prod$shown, BS$shown, a$truth)
  rows[[length(rows) + 1]] <- c("both_sides", pn, meas_row(r))
}
wcsv("both_sides.csv", c("rule", "population", MEAS_COLS), rows)

# step at 25000
rh <- which(a$rh)
rr_h <- a$d6[rh] / a$thr6[rh]
sm <- rh[rr_h < MSTAR]
nsm <- length(sm)
w_h <- hw(a$d6[sm], a$thr6[sm], MSTAR)
hyp <- shown_of(a$rawUnc[sm], blend(w_h, a$corrS[sm], a$corrR[sm]), a$lfCap[sm])
ps <- SL$prod$shown[sm]
chgh <- hyp - ps
rows <- list(
  c("n_rising_high", fmti(length(rh))), c("n_small_rise", fmti(nsm)),
  c("mean_corrR_minus_corrS", if (nsm == 0) "" else fmt6(ssum(a$corrR[sm] - a$corrS[sm]) / nsm)),
  c("n_hyp_changed", fmti(sum(hyp != ps))),
  c("mean_abs_hyp_change_cfs", if (nsm == 0) "" else fmt6(ssum(abs(chgh)) / nsm)),
  c("mean_abs_hyp_change_pct", if (nsm == 0) "" else fmt6(ssum(abs(hyp - ps) / a$truth[sm] * 100) / nsm)))
wcsv("step_at_25000.csv", c("key", "value"), rows)

## ---------------------------------------------------------------- bootstrap
interval <- function(P, x, bi, B) {
  idx <- which(P); n <- length(idx)
  S <- numeric(B); N <- numeric(B)
  blk <- bi[idx] + 1
  for (t in seq_len(n)) { j <- blk[t]; S[j] <- S[j] + x[idx[t]]; N[j] <- N[j] + 1 }
  est <- if (n == 0) NA_real_ else ssum(x[idx]) / n
  M <- CM[[as.character(B)]]
  num <- numeric(10000); den <- numeric(10000)
  for (j in 1:B) { cj <- M[, j]; num <- num + cj * S[j]; den <- den + cj * N[j] }
  valid <- den != 0
  nsk <- sum(!valid); nv <- 10000 - nsk
  lo <- NA_real_; hi <- NA_real_
  if (!(nsk > 500 || n == 0)) {
    st <- sort(num[valid] / den[valid])
    lo <- pct_val(st, 0.025); hi <- pct_val(st, 0.975)
  }
  list(n = n, est = est, lo = lo, hi = hi, n_valid = nv, n_skipped = nsk)
}
aL <- LA$a; aF <- FA$a
dHH <- abs(SL$X$err) - abs(get_rule(aL, "half_half")$err)
spec <- list(
  list("I01", "L", "R", "d", "months"), list("I02", "L", "R", "d", "quarters"),
  list("I03", "L", "scored_all", "d", "months"), list("I04", "L", "R_affected", "d", "months"),
  list("I05", "L", "R_half1", "d", "months"), list("I06", "L", "R_half2", "d", "months"),
  list("I07", "L", "R_eel", "d", "months"), list("I08", "L", "R_noneel", "d", "months"),
  list("I09", "L", "R_cell_0-3000", "d", "months"), list("I10", "L", "R_cell_3000-6000", "d", "months"),
  list("I11", "L", "R_cell_6000-12000", "d", "months"), list("I12", "L", "R_cell_12000-25000", "d", "months"),
  list("I13", "L", "R_raised", "d", "months"), list("I14", "L", "R_lowered", "d", "months"),
  list("I15", "L", "R_before1008", "d", "months"), list("I16", "L", "R_from1008", "d", "months"),
  list("I17", "L", "R", "dHH", "months"), list("I18", "L", "R", "dHH", "quarters"),
  list("I19", "L", "R_span_usual", "d", "months"), list("I20", "L", "R_span_usual", "d", "quarters"),
  list("I21", "F", "R", "d", "months"), list("I22", "F", "R", "d", "quarters"),
  list("I23", "F", "R_span_usual", "d", "months"), list("I24", "F", "R_span_usual", "d", "quarters"))
q_of <- c("I03", "I04", "I05", "I06", "I07", "I08", "I09", "I10", "I11", "I12", "I13", "I14", "I15", "I16")
for (i in seq_along(q_of)) {
  src <- spec[[which(vapply(spec, function(z) z[[1]], "") == q_of[i])]]
  spec[[length(spec) + 1]] <- list(sprintf("I%02d", 24 + i), src[[2]], src[[3]], "d", "quarters")
}
if (length(spec) != 38) stop("interval spec")
rows <- list(); INT <- list()
for (sp in spec) {
  if (sp[[2]] == "L") { S <- SL; a_ <- aL } else { S <- SF; a_ <- aF }
  x <- if (sp[[4]] == "d") S$d else dHH
  B <- if (sp[[5]] == "months") 83 else 28
  bi <- if (B == 83) a_$mi else a_$qi
  r <- interval(S$P[[sp[[3]]]], x, bi, B)
  INT[[sp[[1]]]] <- r
  rows[[length(rows) + 1]] <- c(sp[[1]], sp[[2]], sp[[3]], sp[[4]], sp[[5]], fmti(r$n), fmt6(r$est),
                                fmt6(r$lo), fmt6(r$hi), fmti(r$n_valid), fmti(r$n_skipped))
}
wcsv("intervals.csv", c("id", "arm", "population", "x", "blocks", "n", "est", "lo", "hi", "n_valid", "n_skipped"), rows)

## ---------------------------------------------------------------- decision
mL <- function(p, col) MAIN[[paste0("L|", p)]][[col]]
low <- MAIN[["L|R_lowered"]]
lowered_diff <- if (low[["n"]] == 0) NA_real_ else low[["below15_rule"]] - low[["below15_prod"]]
Rm <- MAIN[["L|R"]]
vals <- list(
  m_star = fmt6(MSTAR), beats_production = fmti(beats),
  R_mean_d = fmt6(Rm[["mean_d"]]), R_ci_lo = fmt6(INT$I01$lo), R_ci_hi = fmt6(INT$I01$hi),
  half1_mean_d = fmt6(mL("R_half1", "mean_d")), half2_mean_d = fmt6(mL("R_half2", "mean_d")),
  eel_mean_d = fmt6(mL("R_eel", "mean_d")), noneel_mean_d = fmt6(mL("R_noneel", "mean_d")),
  `cell_0-3000_rel` = fmt6(mL("R_cell_0-3000", "rel_mae_diff")), `cell_0-3000_ci_lo` = fmt6(INT$I09$lo),
  `cell_3000-6000_rel` = fmt6(mL("R_cell_3000-6000", "rel_mae_diff")), `cell_3000-6000_ci_lo` = fmt6(INT$I10$lo),
  `cell_6000-12000_rel` = fmt6(mL("R_cell_6000-12000", "rel_mae_diff")), `cell_6000-12000_ci_lo` = fmt6(INT$I11$lo),
  `cell_12000-25000_rel` = fmt6(mL("R_cell_12000-25000", "rel_mae_diff")), `cell_12000-25000_ci_lo` = fmt6(INT$I12$lo),
  lowered_n = fmti(low[["n"]]), lowered_mean_d = fmt6(low[["mean_d"]]),
  lowered_below15_diff = fmt6(lowered_diff),
  R_below15_diff = fmt6(Rm[["below15_rule"]] - Rm[["below15_prod"]]),
  R_above15_diff = fmt6(Rm[["above15_rule"]] - Rm[["above15_prod"]]),
  hh_est = fmt6(INT$I17$est), hh_ci_hi = fmt6(INT$I17$hi),
  F_mean_d = fmt6(MAIN[["F|R"]][["mean_d"]]))
if (length(vals) != 25) stop("decision inputs count")
wcsv("decision_inputs.csv", c("name", "value"), lapply(names(vals), function(nm) c(nm, vals[[nm]])))

mv <- function(nm) mic_str(vals[[nm]])
T_ <- function(x) isTRUE(x)
crit1 <- T_(mv("R_mean_d") <= -250000 && mv("R_ci_hi") < 0)
cells <- c("0-3000", "3000-6000", "6000-12000", "12000-25000")
c2_ok <- TRUE; unclear <- FALSE
for (cc in cells) {
  pm <- MAIN[[paste0("L|R_cell_", cc)]]
  if (pm[["n"]] == 0 || isTRUE(pm[["mae_prod"]] == 0)) { c2_ok <- FALSE; next }
  above <- T_(mv(paste0("cell_", cc, "_rel")) > 20000)
  lo_s <- vals[[paste0("cell_", cc, "_ci_lo")]]
  fail <- above && lo_s != "" && T_(mv(paste0("cell_", cc, "_ci_lo")) > 0)
  if (fail) c2_ok <- FALSE
  if (above && !fail) unclear <- TRUE
}
crit2 <- c2_ok
crit3 <- T_(mv("half1_mean_d") < 0 && mv("half2_mean_d") < 0)
crit4 <- T_(mv("eel_mean_d") <= 0 && mv("noneel_mean_d") <= 0)
crit5 <- if (low[["n"]] == 0) TRUE else T_(mv("lowered_mean_d") <= 0 && mv("lowered_below15_diff") <= 0)
crit6 <- T_(mv("R_below15_diff") <= 0 && mv("R_above15_diff") <= 500000)
crit7 <- T_(mv("hh_est") < 0 && mv("hh_ci_hi") < 0)
crit8 <- T_(mv("F_mean_d") < 0)
flag_ns <- beats == 0
flag_fail <- vals$R_ci_lo == "" || vals$R_ci_hi == "" || T_(mv("R_ci_lo") <= 0 && 0 <= mv("R_ci_hi")) ||
  T_(mv("R_mean_d") > -100000)
verdict <- if (flag_ns) "NOT_SUPPORTED" else if (flag_fail) "FAIL" else
  if (crit1 && crit2 && crit3 && crit4 && crit5 && crit6 && crit7 && crit8 && !unclear) "PASS" else
  if (crit1 && crit2 && crit3 && crit4 && crit5 && crit6 && crit8 && !crit7 && !unclear) "GAIN_WITHOUT_ONSET" else "UNCLEAR"
b <- function(x) fmti(as.numeric(x))
wcsv("decision.csv", c("item", "result"), list(
  c("crit1_size", b(crit1)), c("crit2_no_harm_by_cell", b(crit2)), c("crit3_stable_time", b(crit3)),
  c("crit4_stable_season", b(crit4)), c("crit5_lowered", b(crit5)), c("crit6_large_errors", b(crit6)),
  c("crit7_tied_to_rise", b(crit7)), c("crit8_timing", b(crit8)), c("flag_unclear_cell", b(unclear)),
  c("flag_not_supported", b(flag_ns)), c("flag_fail", b(flag_fail)), c("verdict", verdict)))

cat("done in", format(round(as.numeric(difftime(Sys.time(), T0, units = "secs")), 1)), "s\n")

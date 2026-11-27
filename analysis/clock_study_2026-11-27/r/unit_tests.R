# The 23 unit tests of section 14. Each returns TRUE (pass) or FALSE.
near <- function(a, b, tol = 1e-9) length(a) == 1 && length(b) == 1 && !is.na(a) && !is.na(b) && abs(a - b) <= tol

ut_key <- function() {
  all(hkey("1970-01-01 00:00") == 0, hkey("2020-01-01 00:00") == 438288, hkey("2012-12-01 00:00") == 376200,
      hkey("2019-12-31 23:00") == 438287, hkey("2026-11-09 23:00") == 498407, hkey("2011-12-01 05:00") == 367421,
      hkey("2015-06-20 12:00") == 398556, hkey("2015-06-20T12:00:00.000Z") == 398556)
}
ut_weeks <- function() {
  k <- hkey("2020-01-06 00:00")
  all(wk(k) == 2610, wstart(2610) == 438408, k == 438408, wk(hkey("2020-01-05 23:00")) == 2609,
      hkey("2020-01-05 23:00") == 438407, wk(hkey("2020-01-12 23:00")) == 2610, hkey("2020-01-12 23:00") == 438575,
      wk(hkey("2020-01-13 00:00")) == 2611, wk(0) == 0, wstart(0) == -72, wk(-72) == 0)
}
ut_stats <- function() {
  all(med(c(3, 1, 2)) == 2, med(c(4, 1, 3, 2)) == 2.5, near(pct(1:5, 0.25), 2.0), near(pct(1:10, 0.25), 3.25),
      near(pct(1:10000, 0.025), 250.975), near(pct(1:10000, 0.975), 9750.025))
}
ut_corr <- function() {
  near(pearson(c(1, 2, 3, 4, 5), c(2, 4, 5, 4, 5)), 0.7745966692414834) && is.na(pearson(c(1, 1, 1), c(1, 2, 3)))
}
ut_xc <- function() {
  tab <- c(0, 1, 3, 7, 12, 20, 25, 22, 15, 9, 5, 2, 1, 0)
  uf <- function(h) { r <- rep(0, length(h)); i <- h >= 30 & h <= 43; r[i] <- tab[h[i] - 29]; r }
  Hu <- -200:300; Hd <- -100:300
  upv <- uf(Hu); dnv <- 0.8 * uf(Hd - 5) + 0.2 * uf(Hd - 6)
  U <- mkchg(mkser(upv, -200)); D <- mkchg(mkser(dnv, -100))
  ok <- TRUE
  r1 <- xc(U, D, 20, 70, 0, 12)
  ok <- ok && r1$status == "ok" && r1$sb == 5 && r1$ns[6] == 50 && near(r1$rs[6], 0.9912981076214433) &&
    near(r1$rs[5], 0.7098083831168271) && near(r1$rs[7], 0.8501476405787828) && near(r1$lag, 5.166026871401152) &&
    r1$r >= 0.6 && r1$r >= 0.7
  r2 <- xc(U, D, 20, 70, 0, 5); ok <- ok && r2$status == "end" && r2$sb == 5
  r3 <- xc(U, D, 20, 70, 6, 12); ok <- ok && r3$status == "end" && r3$sb == 6
  r4 <- xc(U, D, 20, 40, 0, 12); ok <- ok && r4$status == "no_eligible" && r4$ns[1] == 20
  U0 <- mkchg(mkser(rep(0, length(Hu)), -200))
  r5 <- xc(U0, D, 20, 70, 0, 12); ok <- ok && r5$status == "no_eligible"
  dnv2 <- dnv; dnv2[Hd == 35] <- NA
  D2 <- mkchg(mkser(dnv2, -100))
  r6 <- xc(U, D2, 20, 70, 0, 12)
  ok && r6$ns[1] == 48 && r6$ns[6] == 48 && r6$status == "ok" && r6$sb == 5 && near(r6$lag, 5.166653914337471)
}
ut_parabola <- function() {
  near(parab(0.5, 0.9, 0.7), 0.1666666666666666) && parab(0.5, 0.5, 0.5) == 0 && parab(0.9, 0.9, 0.5) == -0.5 &&
    parab(0.5, 0.9, 0.9) == 0.5 && {
      # phase refinement with wrap, as in 9.2
      ph <- function(sb, rm, r0, rp) { p <- sb + parab(rm, r0, rp); if (p < 0) p <- p + 24; if (p >= 24) p <- p - 24; p }
      near(ph(0, 0.80, 0.90, 0.60), 23.75) && near(ph(23, 0.6, 0.9, 0.8), 23.25)
    }
}
ut_start <- function() {
  mk <- function(h, base, ex) { v <- rep(base, length(h)); names(v) <- h; for (n in names(ex)) v[n] <- ex[[n]]; mkser(v, h[1]) }
  a <- mk(100:140, 600, list("110" = 500, "120" = 500, "130" = 700))
  b <- mk(90:140, 600, list("92" = 100, "93" = 500))
  cc <- mk(50:92, 600, list())
  start_of(a, 140) == 120 && start_of(b, 140) == 93 && is.na(start_of(cc, 140)) && start_of(cc, 100) == 92
}
ut_parts <- function() {
  s <- crossings(10:17, c(100, 100, 112, 140, 185, 200, 200, 190))
  ok <- s$ok && near(s$rise, 100) && near(s$t[1], 11.833333333333334) && near(s$t[2], 13.222222222222221) &&
    near(s$t[3], 14.333333333333334) && s$crest == 15
  g <- crossings(c(10, 12, 14, 16), c(100, 112, 185, 200))
  ok && g$ok && near(g$rise, 100) && near(g$t[1], 11.666666666666666) && near(g$t[2], 13.04109589041096) &&
    near(g$t[3], 14.666666666666666) && g$crest == 16
}
ut_bumps <- function() {
  h <- 0:229; v <- rep(1000.0, 230)
  i <- 100:110; v[i + 1] <- 1000 + 50 * (i - 100)
  i <- 111:120; v[i + 1] <- 1500 - 50 * (i - 110)
  i <- 160:165; v[i + 1] <- 1000 + 70 * (i - 160)
  i <- 166:170; v[i + 1] <- 1350 - 70 * (i - 165)
  c <- bump_cands(mkser(v, 0), 0, 229)
  nrow(c) == 1 && c$p == 110 && c$s == 100 && c$v == 1500 && c$m == 1000 && c$a == 94 && c$b == 116
}
ut_thin <- function() {
  k1 <- thin(c(1000, 1050, 1100, 1200), c(5000, 4500, 3000, 3500), 96)
  k2 <- thin(c(1000, 1096), c(5000, 4000), 96)
  k3 <- thin(c(1000, 1095), c(5000, 4000), 96)
  identical(k1, c(TRUE, FALSE, TRUE, TRUE)) && all(k2) && identical(k3, c(TRUE, FALSE))
}
ut_creek <- function() {
  lf <- mkser(c(100, 110, 130, 120, 115), 0)
  cr <- list(sen = mkser(c(10, 12, 20, 15, 10), 0), brun = mkser(c(5, 5, 5, 6, 5), 0),
             dr = mkser(c(2, 3, 8, 5, 2), 0), mono = NULL, goose = NULL)
  ok <- TRUE
  crn <- cr; crn$dr <- NULL
  r <- creek_share(0, 4, lf, crn, FALSE)
  ok <- ok && near(S_sum(lf, 0, 4)$S, 75.0) && near(r$lower$share, 0.5827216261998871) && r$lower$status == "heavy" && r$fb == 0
  r <- creek_share(0, 4, lf, cr, TRUE)
  ok <- ok && near(r$lower$share, 0.6834113807293885) && r$fb == 0
  c2 <- cr; c2$sen <- mkser(c(NA, 12, 20, 15, 10), 0)
  r <- creek_share(0, 4, lf, c2, TRUE); ok <- ok && r$lower$status == "unknown" && is.na(r$lower$share)
  c3 <- cr; c3$dr <- mkser(c(NA, NA, 8, 5, 2), 0)
  r <- creek_share(0, 4, lf, c3, TRUE)
  ok <- ok && near(r$lower$share, 0.5827216261998871) && r$lower$status == "heavy" && r$fb == 1
  c4 <- c3; c4$sen <- mkser(c(NA, 12, 20, 15, 10), 0)
  r <- creek_share(0, 4, lf, c4, TRUE); ok && r$lower$status == "unknown"
}
ut_theilsen <- function() {
  Q <- c(1000, 2000, 4000, 8000, 8000, 3000); lag <- c(10, 7.1, 5, 3.6, 3.7, 6)
  xy <- prep_xy(Q, lag); f <- ts_fit(Q, xy$x, xy$y)
  ok <- !is.null(f) && f$nslopes == 14 && near(f$B, -0.49061072757099455) && near(f$A, 5.690876476384307)
  xy2 <- prep_xy(c(1000, 1000), c(3, 4)); ok <- ok && is.null(ts_fit(c(1000, 1000), xy2$x, xy2$y))
  Q3 <- c(1000, 2000, 3000, 4000, 5000); xy3 <- prep_xy(Q3, c(0.04, 5, 4, 3, 2)); f3 <- ts_fit(Q3, xy3$x, xy3$y)
  ok && xy3$nfloor == 1 && near(xy3$y[1], -2.995732273553991) && !is.null(f3) && f3$nslopes == 10 &&
    near(f3$B, -0.6436526536897076) && near(f3$A, 6.437099349353944)
}
ut_circ <- function() {
  a <- circ(c(1, 2, 23, 22, 12)); b <- circ(c(0, 12)); c3 <- circ(c(10, 10, 11))
  a$median == 1 && a$spread == 2 && b$median == 0 && b$spread == 6 && c3$median == 10 && c3$spread == 0 && near(cdist(0.5, 23.5), 1.0)
}
ut_lcg <- function() {
  s <- lcg_stream(1000)
  all(s[1:5] == c(919802032, 539484947, 1091173115, 686024196, 876128376)) && s[1000] == 251994556 &&
    (919802032 * 7) %/% 2147483647 == 2
}
ut_detrend <- function() {
  h <- 0:40; x <- (h * h) %% 17; x[h %in% c(10, 11, 20)] <- NA
  d <- detrend(mkser(x, 0))
  near(sat(d, 15), -5.136363636363637) && near(sat(d, 24), 7.916666666666667) && near(sat(d, 30), 8.40909090909091) &&
    is.na(sat(d, 3)) && is.na(sat(d, 10)) && is.na(sat(d, 0))
}
ut_days <- function() {
  k <- function(phi, Mb) whole_days(phi, Mb)
  k(3.0, 26.5) == 1 && near(3.0 + 24 * k(3.0, 26.5), 27.0) && k(0.0, 12.0) == 0 && k(20.0, 3.0) == 0 && k(5.0, 100.0) == 2
}
ut_range <- function() {
  e <- clock_ends(10, 8, 12, FALSE, NA); e2 <- clock_ends(10, 8, 12, TRUE, 2.0); e3 <- clock_ends(10, 8, 12, TRUE, 3.0)
  ok <- near(e[["long"]], 4.4399999999999995) && near(e[["central"]], 3.5999999999999996) && near(e[["short"]], 1.088) &&
    near(e2[["short"]], 2.0) && near(e3[["short"]], 2.7)
  sw <- function(m, n = c(5, 5, 5)) c(switch_in(n[1], n[2], m[1], m[2]), switch_in(n[1], n[3], m[1], m[3]))
  ok <- ok && identical(sw(c(10.0, 9.2, 10.9)), c(FALSE, FALSE)) && identical(sw(c(10.0, 11.0, 10.0)), c(FALSE, FALSE)) &&
    identical(sw(c(10.0, 11.000001, 10.0)), c(TRUE, FALSE)) && identical(sw(c(10.0, 9.2, 8.9)), c(FALSE, TRUE)) &&
    identical(sw(c(10.0, 12.0, 10.0), c(5, 2, 5)), c(FALSE, FALSE))
  bP <- c(8, 12); bA <- c(9, 13); bB <- c(7, 15)
  ok && identical(cover_bounds(bP, bA, bB, FALSE, TRUE), c(7, 15)) && identical(cover_bounds(bP, bA, bB, TRUE, FALSE), c(8, 13)) &&
    identical(cover_bounds(bP, bA, bB, TRUE, TRUE), c(7, 15)) && identical(cover_bounds(bP, bA, bB, FALSE, FALSE), c(8, 12)) &&
    near(formula_val(5000), 6.493715588514094) && near(formula_val(500), 16.954659687540097)
}
ut_verdict <- function() {
  v <- function(...) verdict_of(c(...))
  ok <- v("TOO LONG", "TOO LONG", "INSIDE", "not_qualified") == "TOO LONG" &&
    v("TOO LONG", "TOO SHORT", "TOO LONG", "INSIDE") == "MIXED" &&
    v("INSIDE", "INSIDE", "INSIDE", "INSIDE") == "ABOUT RIGHT" &&
    v("INSIDE", "not_qualified", "not_qualified", "not_qualified") == "NOT DECIDED" &&
    v("TOO LONG", "not_qualified", "not_qualified", "not_qualified") == "NOT DECIDED" &&
    v("INSIDE", "TOO LONG", "not_qualified", "not_qualified") == "MIXED" &&
    v("TOO SHORT", "TOO SHORT", "INSIDE", "INSIDE") == "MIXED"
  ok && cell_status_str(1, "6.000000", "5.999999", "1.000000") == "TOO LONG" &&
    cell_status_str(1, "5.999999", "5.999999", "1.000000") == "INSIDE" &&
    cell_status_str(1, "0.999999", "5.999999", "1.000000") == "TOO SHORT" &&
    cell_status_str(1, "1.000000", "5.999999", "1.000000") == "INSIDE"
}
ut_dr <- function() {
  mkdr <- function(mod) {
    v <- rep(100.0, 301)
    v[(98:101) + 1] <- c(200, 300, 400, 300); v[(129:131) + 1] <- c(250, 350, 250)
    v[(199:201) + 1] <- c(150, 180, 150); v[(249:251) + 1] <- c(120, 140, 120)
    if (mod) { v[60 + 1] <- -5; v[150 + 1] <- 0; v[151 + 1] <- -2 }
    v
  }
  chk <- function(v) {
    npos <- sum(v <= 0); v2 <- v; v2[v2 <= 0] <- NA
    c <- dr_cands(mkser(v2, 0), 0, 300)
    list(c = c, npos = npos, npres = sum(!is.na(v2)))
  }
  a <- chk(mkdr(FALSE))
  ok <- nrow(a$c) == 3 && identical(a$c$p, c(100, 130, 200)) && identical(a$c$rise, c(300, 250, 80))
  sep <- thin(a$c$p, a$c$rise, 48)
  ok <- ok && identical(a$c$p[sep], c(100, 200))
  ok <- ok && (300 >= 0.1 * 2000) && !(80 >= 0.1 * 2000)
  e1 <- dr_cond_ef(c(5.0, 5.2, rep(5.1, 35))); e2 <- dr_cond_ef(c(5.0, 5.25, rep(5.1, 35)))
  ok <- ok && e1$pass && !e2$pass
  cs <- function(v) { r <- dr_creek_rise(v); !is.na(r) && r < 0.25 * 300 }
  s1 <- rep(10.0, 37); s1[20] <- 84.5; s2 <- rep(10.0, 37); s2[20] <- 85.0
  s3 <- c(rep(100.0, 24), rep(40.0, 13)); s4 <- s1; s4[1] <- NA; s4[2] <- 20.0
  ok <- ok && cs(s1) && !cs(s2) && cs(s3) && near(dr_creek_rise(s1), 74.5) && near(dr_creek_rise(s2), 75.0) &&
    near(dr_creek_rise(s3), 0.0) && near(dr_creek_rise(s4), 64.5)
  b <- chk(mkdr(TRUE))
  ok && b$npos == 3 && b$npres == 298 && identical(b$c$p, c(100, 130, 200)) && near(3.0 * (9.1 / 7.4), 3.6891891891891886)
}
ut_mic <- function() {
  mic("0.500000") == 500000 && mic("-0.020000") == -20000 && mic("10.000000") == 10000000 && mic("-1.000000") == -1000000 &&
    F6(-0.0000001) == "0.000000" && mic(F6(-0.0000001)) == 0
}
ut_cluster <- function() {
  ea <- c(0, 90); eb <- c(100, 200)
  assign_cluster(95, 120, ea, eb) == 2 && assign_cluster(95, 104, ea, eb) == 2 && assign_cluster(300, 320, ea, eb) == 0
}
ut_draw <- function() {
  s <- lcg_stream(6); m <- 3
  idx <- (s * m) %/% 2147483647
  pl <- list(c(1, 2), 3, 4)
  identical(as.numeric(idx[1:3]), c(1, 0, 1)) && identical(as.numeric(draw_points(idx[1:3], pl)), c(3, 1, 2, 3)) &&
    identical(as.numeric(idx[4:6]), c(0, 1, 1)) && identical(as.numeric(draw_points(idx[4:6], pl)), c(1, 2, 3, 3))
}
ut_use <- function() {
  up <- rep(1.0, 30); up[1:3] <- NA; dn <- rep(1.0, 30); dn[4:6] <- NA
  r1 <- use_rule(mkser(up, 0), mkser(dn, 0), 0, 29)
  up2 <- rep(1.0, 30); up2[1:4] <- NA; dn2 <- rep(1.0, 30); dn2[5:7] <- NA
  r2 <- use_rule(mkser(up2, 0), mkser(dn2, 0), 0, 29)
  r1$used && r1$cb == 24 && !r2$used
}

UNIT_TESTS <- list(unit_key = ut_key, unit_weeks = ut_weeks, unit_stats = ut_stats, unit_corr = ut_corr, unit_xc = ut_xc,
  unit_parabola = ut_parabola, unit_start = ut_start, unit_parts = ut_parts, unit_bumps = ut_bumps, unit_thin = ut_thin,
  unit_creek = ut_creek, unit_theilsen = ut_theilsen, unit_circ = ut_circ, unit_lcg = ut_lcg, unit_detrend = ut_detrend,
  unit_days = ut_days, unit_range = ut_range, unit_verdict = ut_verdict, unit_dr = ut_dr, unit_mic = ut_mic,
  unit_cluster = ut_cluster, unit_draw = ut_draw, unit_use = ut_use)

# Function library for the clock study analysis (base R only). Sourced by run_all.R.

PAD <- 300L

# ---------- number formatting ----------
F6 <- function(x) {
  x <- as.numeric(x)
  if (any(!is.na(x) & !is.finite(x))) stop("non-finite value in F6")
  s <- sprintf("%.6f", x)
  s[s == "-0.000000"] <- "0.000000"
  s[is.na(x)] <- ""
  s
}
I0 <- function(x) {
  x <- as.numeric(x)
  s <- character(length(x))
  ok <- !is.na(x)
  if (any(x[ok] != floor(x[ok]))) stop("non-whole value in I0")
  s[ok] <- sprintf("%d", as.integer(x[ok]))
  s
}
# decision on a written string: integer in units of 1e-6
mic <- function(s) {
  if (length(s) == 0 || is.na(s) || s == "") return(NA_real_)
  if (s == "-0.000000") s <- "0.000000"
  as.numeric(sub(".", "", s, fixed = TRUE))
}

# ---------- time ----------
days_from_civil <- function(Y, M, D) {
  y <- Y - ifelse(M <= 2, 1, 0)
  era <- y %/% 400
  yoe <- y - era * 400
  doy <- (153 * (M + ifelse(M > 2, -3, 9)) + 2) %/% 5 + D - 1
  doe <- yoe * 365 + yoe %/% 4 - yoe %/% 100 + doy
  era * 146097 + doe - 719468
}
hkey <- function(s) {
  Y <- as.numeric(substr(s, 1, 4)); M <- as.numeric(substr(s, 6, 7))
  D <- as.numeric(substr(s, 9, 10)); H <- as.numeric(substr(s, 12, 13))
  days_from_civil(Y, M, D) * 24 + H
}
wk <- function(h) ((h %/% 24) + 3) %/% 7
wstart <- function(w) (7 * w - 3) * 24

# ---------- statistics ----------
med <- function(x) {
  x <- sort(x); n <- length(x)
  if (n == 0) return(NA_real_)
  if (n %% 2 == 1) x[(n + 1) / 2] else (x[n / 2] + x[n / 2 + 1]) / 2
}
pct <- function(x, p) {
  x <- sort(x); m <- length(x)
  if (m == 0) return(NA_real_)
  pos <- (m - 1) * p
  i <- floor(pos)
  fr <- pos - i
  if (i + 1 > m - 1) x[i + 1] else x[i + 1] + fr * (x[i + 2] - x[i + 1])
}
pearson <- function(x, y) {
  n <- length(x)
  mx <- sum(x) / n; my <- sum(y) / n
  dx <- x - mx; dy <- y - my
  sxx <- sum(dx * dx); syy <- sum(dy * dy); sxy <- sum(dx * dy)
  if (sxx <= 0 || syy <= 0) return(NA_real_)
  sxy / sqrt(sxx * syy)
}
parab <- function(rm, r0, rp) {
  den <- (rm - 2 * r0) + rp
  d <- if (den == 0) 0 else (0.5 * (rm - rp)) / den
  max(-0.5, min(0.5, d))
}

# ---------- padded series objects ----------
mkser <- function(vals, h0) {
  list(v = c(rep(NA_real_, PAD), as.numeric(vals), rep(NA_real_, PAD)), off = PAD - h0 + 1)
}
sat <- function(ser, h) {
  i <- h + ser$off
  ok <- !is.na(i) & i >= 1 & i <= length(ser$v)
  out <- rep(NA_real_, length(h))
  out[ok] <- ser$v[i[ok]]
  out
}
sslice <- function(ser, from, to) {
  i1 <- from + ser$off; i2 <- to + ser$off
  if (i1 >= 1 && i2 <= length(ser$v)) return(ser$v[i1:i2])
  sat(ser, from:to)
}
mkchg <- function(ser) {
  v <- ser$v
  ser$v <- c(NA_real_, v[-1] - v[-length(v)])
  ser
}
smap <- function(ser, f) { ser$v <- f(ser$v); ser }

use_rule <- function(up, dn, a, b) {
  n <- b - a + 1
  u <- sslice(up, a, b); d <- sslice(dn, a, b)
  cu <- sum(!is.na(u)); cd <- sum(!is.na(d)); cb <- sum(!is.na(u) & !is.na(d))
  list(used = (10 * cu >= 9 * n) && (10 * cd >= 9 * n) && cb >= 24, cb = cb)
}

# ---------- XC ----------
xc <- function(upc, dnc, a, b, smin, smax) {
  cd <- sslice(dnc, a + 1, b)
  pd <- !is.na(cd)
  nS <- smax - smin + 1
  rs <- rep(NA_real_, nS); ns <- integer(nS)
  for (k in seq_len(nS)) {
    s <- smin + k - 1
    cu <- sslice(upc, a + 1 - s, b - s)
    both <- pd & !is.na(cu)
    n <- sum(both)
    ns[k] <- n
    if (n >= 24) rs[k] <- pearson(cu[both], cd[both])
  }
  elig <- !is.na(rs)
  res <- list(rs = rs, ns = ns, smin = smin, smax = smax, n_elig = sum(elig),
              status = NA_character_, sb = NA_real_, n = NA_real_, r = NA_real_,
              delta = NA_real_, lag = NA_real_)
  if (!any(elig)) { res$status <- "no_eligible"; return(res) }
  best <- NA_integer_; bv <- -Inf
  for (k in which(elig)) if (rs[k] > bv) { bv <- rs[k]; best <- k }
  sb <- smin + best - 1
  res$sb <- sb; res$n <- ns[best]; res$r <- rs[best]
  if (sb == smin || sb == smax) { res$status <- "end"; return(res) }
  if (!elig[best - 1] || !elig[best + 1]) { res$status <- "neighbour"; return(res) }
  res$delta <- parab(rs[best - 1], rs[best], rs[best + 1])
  res$lag <- sb + res$delta
  res$status <- "ok"
  res
}

# ---------- start of limb, bumps ----------
start_of <- function(lf, o) {
  hrs <- (o - 47):o
  v <- sat(lf, hrs)
  pres <- !is.na(v)
  if (!any(pres)) return(NA_real_)
  m <- min(v[pres])
  max(hrs[pres & v == m])
}
bump_cands <- function(lf, k0, k1) {
  vv <- sat(lf, k0:k1)
  cand <- which(!is.na(vv) & vv < 6000)
  P <- numeric(0); S <- numeric(0); V <- numeric(0); M <- numeric(0)
  for (idx in cand) {
    p <- k0 + idx - 1; v <- vv[idx]
    prev <- sslice(lf, p - 24, p - 1)
    if (any(prev >= v, na.rm = TRUE)) next
    nxt <- sslice(lf, p + 1, p + 24)
    if (any(nxt > v, na.rm = TRUE)) next
    w48 <- sslice(lf, p - 47, p)
    if (sum(!is.na(w48)) < 36) next
    s <- start_of(lf, p)
    m <- sat(lf, s)
    if (!(m < 3000)) next
    if (!(v >= 1.4 * m)) next
    P <- c(P, p); S <- c(S, s); V <- c(V, v); M <- c(M, m)
  }
  data.frame(p = P, s = S, v = V, m = M, a = S - 6, b = P + 6)
}
thin <- function(p, v, gap) {
  ord <- order(-v, p)
  keep <- rep(FALSE, length(p)); acc <- numeric(0)
  for (i in ord) {
    if (all(abs(p[i] - acc) >= gap)) { keep[i] <- TRUE; acc <- c(acc, p[i]) }
  }
  keep
}
qclass <- function(Q) {
  ifelse(Q < 3000, "lt3000", ifelse(Q < 6000, "3000-6000", ifelse(Q < 12000, "6000-12000",
         ifelse(Q < 25000, "12000-25000", "ge25000"))))
}
wclass <- function(Q) ifelse(Q < 1500, "lt1500", ifelse(Q < 2000, "1500-2000", "2000-3000"))

assign_cluster <- function(a, b, ea, eb) {
  if (length(ea) == 0) return(0L)
  ov <- pmax(0, pmin(b, eb) - pmax(a, ea) + 1)
  if (max(ov) <= 0) return(0L)
  which(ov == max(ov))[1]
}

# ---------- creek share ----------
S_sum <- function(ser, a, b) {
  if (is.null(ser)) return(list(S = 0, cnt = 0L))
  x <- sslice(ser, a, b); pres <- !is.na(x)
  if (!any(pres)) return(list(S = 0, cnt = 0L))
  x0 <- x[which(pres)[1]]
  list(S = sum(pmax(0.0, x[pres] - x0)), cnt = sum(pres))
}
G_LOWER_NODR <- 101.0 + 76.1
G_LOWER_DR <- (101.0 + 76.1) + 57.8
G_UPPER <- 817.0 + 332.0
G_WHOLE_NODR <- ((817.0 + 332.0) + 101.0) + 76.1
G_WHOLE_DR <- (((817.0 + 332.0) + 101.0) + 76.1) + 57.8
leg_share <- function(base, has_dr, local, g_nodr, g_dr, S, lfS, nh) {
  enough <- function(cnt) 10 * cnt >= 9 * nh
  unk <- list(share = NA_real_, status = "unknown", fb = 0L)
  if (!enough(lfS$cnt) || !(lfS$S > 0)) return(unk)
  for (nm in base) if (!enough(S[[nm]]$cnt)) return(unk)
  use_dr <- has_dr; fb <- 0L
  if (has_dr && !enough(S$dr$cnt)) { use_dr <- FALSE; fb <- 1L }
  nms <- if (use_dr) c(base, "dr") else base
  sc <- 0.0
  for (nm in nms) sc <- sc + S[[nm]]$S
  gauged <- if (use_dr) g_dr else g_nodr
  share <- (sc * (local / gauged)) / lfS$S
  list(share = share, status = if (share > 0.15) "heavy" else "clean", fb = fb)
}
creek_share <- function(a, b, lf, cr, dr_present) {
  nh <- b - a + 1
  lfS <- S_sum(lf, a, b)
  S <- list(sen = S_sum(cr$sen, a, b), brun = S_sum(cr$brun, a, b), dr = S_sum(cr$dr, a, b),
            mono = S_sum(cr$mono, a, b), goose = S_sum(cr$goose, a, b))
  lower <- if (dr_present) leg_share(c("sen", "brun"), TRUE, 430.0, G_LOWER_NODR, G_LOWER_DR, S, lfS, nh)
           else leg_share(c("sen", "brun"), FALSE, 430.0, G_LOWER_NODR, G_LOWER_NODR, S, lfS, nh)
  upper <- leg_share(c("mono", "goose"), FALSE, 1479.0, G_UPPER, G_UPPER, S, lfS, nh)
  whole <- if (dr_present) leg_share(c("mono", "goose", "sen", "brun"), TRUE, 1909.0, G_WHOLE_NODR, G_WHOLE_DR, S, lfS, nh)
           else leg_share(c("mono", "goose", "sen", "brun"), FALSE, 1909.0, G_WHOLE_NODR, G_WHOLE_NODR, S, lfS, nh)
  list(lower = lower, upper = upper, whole = whole,
       fb = as.integer(lower$fb == 1L || whole$fb == 1L),
       screeks_lower = NA)
}

# ---------- parts of a rise ----------
crossings <- function(hs, vs) {
  v0 <- vs[1]; mx <- max(vs); rise <- mx - v0
  if (!(rise > 0)) return(list(rise = rise, ok = FALSE))
  fs <- c(0.1, 0.5, 0.9); tc <- numeric(3)
  for (i in 1:3) {
    lev <- v0 + fs[i] * rise
    if (vs[1] >= lev) tc[i] <- hs[1] else {
      j <- which(vs[-1] >= lev)[1] + 1
      tc[i] <- hs[j - 1] + ((lev - vs[j - 1]) / (vs[j] - vs[j - 1])) * (hs[j] - hs[j - 1])
    }
  }
  crest <- hs[which(vs == mx)[1]]
  list(rise = rise, ok = TRUE, t = tc, crest = crest)
}
parts_pair <- function(dn, up, aD, bD, sb) {
  nh <- bD - aD + 1
  dv <- sslice(dn, aD, bD); uv <- sslice(up, aD - sb, bD - sb)
  dp <- !is.na(dv); upp <- !is.na(uv)
  if (!(10 * sum(dp) >= 9 * nh && 10 * sum(upp) >= 9 * nh)) return(list(status = "data"))
  hd <- (aD:bD)[dp]; hu <- ((aD - sb):(bD - sb))[upp]
  cd <- crossings(hd, dv[dp]); cu <- crossings(hu, uv[upp])
  if (!cd$ok || !cu$ok) return(list(status = "no_rise"))
  list(status = "ok", lag10 = cd$t[1] - cu$t[1], lag50 = cd$t[2] - cu$t[2],
       lag90 = cd$t[3] - cu$t[3], lagcrest = cd$crest - cu$crest)
}

# ---------- Theil and Sen ----------
prep_xy <- function(Q, lag) {
  lagp <- ifelse(lag > 0.05, lag, 0.05)
  list(x = log(Q), y = log(lagp), nfloor = sum(lag <= 0.05))
}
ts_fit <- function(Q, x, y) {
  n <- length(Q)
  if (n < 5) return(NULL)
  dy <- outer(y, y, "-"); dx <- outer(x, x, "-"); neq <- outer(Q, Q, "!=")
  ut <- upper.tri(dx) & neq
  if (!any(ut)) return(NULL)
  sl <- dy[ut] / dx[ut]
  B <- med(sl)
  A <- med(y - B * x)
  list(B = B, A = A, n = n, nslopes = length(sl))
}
lcg_stream <- function(n, seed = 20261127) {
  out <- numeric(n); x <- seed
  for (i in seq_len(n)) { x <- (48271 * x) %% 2147483647; out[i] <- x }
  out
}
draw_points <- function(idx0, ptlist) unlist(ptlist[idx0 + 1])

# ---------- circular ----------
cdist <- function(a, b) { d <- abs(a - b); min(d, 24.0 - d) }
circ <- function(ph) {
  ph <- sort(ph)
  D <- numeric(length(ph))
  for (i in seq_along(ph)) { s <- 0.0; for (q in ph) s <- s + cdist(ph[i], q); D[i] <- s }
  best <- ph[1]; Db <- D[1]
  for (i in seq_along(ph)) if (i > 1 && D[i] < Db - 1e-9) { best <- ph[i]; Db <- D[i] }
  sp <- med(vapply(ph, function(q) cdist(q, best), numeric(1)))
  list(median = best, spread = sp)
}
whole_days <- function(phi, Mb) {
  ks <- 0:2
  d <- abs((phi + 24.0 * ks) - Mb)
  ks[which.min(d)]
}
detrend <- function(ser) {
  v <- ser$v; L <- length(v)
  acc <- numeric(L); cnt <- integer(L)
  for (k in -12:12) {
    idx <- seq_len(L) + k
    sh <- rep(NA_real_, L); ok <- idx >= 1 & idx <= L; sh[ok] <- v[idx[ok]]
    pr <- !is.na(sh)
    acc <- acc + ifelse(pr, sh, 0)
    cnt <- cnt + pr
  }
  ser$v <- ifelse(!is.na(v) & cnt >= 19, v - acc / cnt, NA_real_)
  ser
}
week_phase <- function(upd, dnd, ws) {
  rs <- rep(NA_real_, 24); ns <- integer(24)
  dd <- sslice(dnd, ws, ws + 167); pd <- !is.na(dd)
  for (s in 0:23) {
    du <- sslice(upd, ws - s, ws + 167 - s)
    both <- pd & !is.na(du)
    n <- sum(both); ns[s + 1] <- n
    if (n >= 24) rs[s + 1] <- pearson(du[both], dd[both])
  }
  elig <- !is.na(rs)
  out <- list(status = NA_character_, sb = NA_real_, n = NA_real_, r = NA_real_, delta = NA_real_, phase = NA_real_)
  if (!any(elig)) { out$status <- "no_eligible"; return(out) }
  best <- NA_integer_; bv <- -Inf
  for (k in which(elig)) if (rs[k] > bv) { bv <- rs[k]; best <- k }
  sb <- best - 1
  out$sb <- sb; out$n <- ns[best]; out$r <- rs[best]
  nm <- (sb - 1) %% 24; np <- (sb + 1) %% 24
  if (!elig[nm + 1] || !elig[np + 1]) { out$status <- "neighbour"; return(out) }
  out$delta <- parab(rs[nm + 1], rs[sb + 1], rs[np + 1])
  ph <- sb + out$delta
  if (ph < 0) ph <- ph + 24
  if (ph >= 24) ph <- ph - 24
  out$phase <- ph; out$status <- "ok"
  out
}

# ---------- clock ----------
clock_ends <- function(L, lo, hi, drvalid, drq25) {
  if (is.na(L) || is.na(lo) || is.na(hi)) return(c(long = NA_real_, central = NA_real_, short = NA_real_))
  long <- 0.37 * hi; central <- 0.36 * L
  short <- if (!drvalid) (0.4 * 0.34) * lo else if (is.na(drq25)) NA_real_ else min((0.75 * 0.36) * L, drq25)
  c(long = long, central = central, short = short)
}
switch_in <- function(nP, nV, medP, medV) {
  if (is.na(nP) || is.na(nV) || nP < 3 || nV < 3 || is.na(medP) || is.na(medV)) return(FALSE)
  abs(mic(F6(medV)) - mic(F6(medP))) > 1000000
}
cover_bounds <- function(bP, bA, bB, swA, swB) {
  los <- numeric(0); his <- numeric(0)
  add <- function(b) if (!any(is.na(b))) { los <<- c(los, b[1]); his <<- c(his, b[2]) }
  add(bP); if (swA) add(bA); if (swB) add(bB)
  if (length(los) == 0) return(c(NA_real_, NA_real_))
  c(min(los), max(his))
}
formula_val <- function(Q) (6.5 * (4139.0 * (max(Q, 1000.0) ^ -0.5963))) / 25.8
cell_status_str <- function(qual, app_s, long_s, short_s) {
  if (qual == 0) return("not_qualified")
  a <- mic(app_s); l <- mic(long_s); s <- mic(short_s)
  if (isTRUE(a > l)) return("TOO LONG")
  if (isTRUE(a < s)) return("TOO SHORT")
  "INSIDE"
}
verdict_of <- function(st) {
  nq <- sum(st != "not_qualified"); nlong <- sum(st == "TOO LONG")
  nshort <- sum(st == "TOO SHORT"); nin <- sum(st == "INSIDE")
  if (nq < 2) "NOT DECIDED" else if (nlong >= 2 && nshort == 0) "TOO LONG"
  else if (nin == nq) "ABOUT RIGHT" else "MIXED"
}

# ---------- Difficult Run ----------
dr_cands <- function(dr, k0, k1) {
  vv <- sat(dr, k0:k1)
  P <- numeric(0); RS <- numeric(0)
  for (idx in which(!is.na(vv))) {
    p <- k0 + idx - 1; v <- vv[idx]
    prev <- sslice(dr, p - 24, p - 1)
    if (any(prev >= v, na.rm = TRUE)) next
    nxt <- sslice(dr, p + 1, p + 24)
    if (any(nxt > v, na.rm = TRUE)) next
    pp <- prev[!is.na(prev)]
    if (length(pp) < 18) next
    rise <- v - min(pp)
    if (!(rise >= 50.0)) next
    P <- c(P, p); RS <- c(RS, rise)
  }
  data.frame(p = P, rise = RS)
}
dr_cond_ef <- function(vals37) {
  pr <- vals37[!is.na(vals37)]
  if (length(pr) < 30) return(list(pass = FALSE, rel = NA_real_))
  rel <- (max(pr) - min(pr)) / min(pr)
  list(pass = rel < 0.05, rel = rel)
}
dr_creek_rise <- function(vals37) {
  pr <- vals37[!is.na(vals37)]
  if (length(pr) < 30) return(NA_real_)
  max(0.0, max(pr) - pr[1])
}

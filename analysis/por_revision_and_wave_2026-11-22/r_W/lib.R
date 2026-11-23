# lib.R : all shared functions for Part W (base R only). Run from the study folder.
options(digits = 15, scipen = 999, stringsAsFactors = FALSE, warn = 1)

SD   <- "data/tidy/"
OUT  <- "r_W/"
TAB  <- "r_W/tables/"
dir.create(TAB, recursive = TRUE, showWarnings = FALSE)

## ---------------------------------------------------------------- time helpers
# ISO string (Z) -> minutes since epoch (fraction kept for ms)
tmin <- function(s) {
  s <- as.character(s)
  out <- rep(NA_real_, length(s))
  ok <- !is.na(s) & nzchar(s)
  if (any(ok)) {
    x <- s[ok]
    base <- as.numeric(as.POSIXct(substr(x, 1, 19), format = "%Y-%m-%dT%H:%M:%S", tz = "UTC"))
    fr <- rep(0, length(x))
    has <- nchar(x) > 20 & substr(x, 20, 20) == "."
    if (any(has)) fr[has] <- as.numeric(paste0("0.", sub("^.{20}([0-9]+).*$", "\\1", x[has])))
    out[ok] <- (base + fr) / 60
  }
  out
}
# "YYYY-MM-DD HH:MM" (W7 file) -> minutes
tmin_space <- function(s) {
  as.numeric(as.POSIXct(paste0(s, ":00"), format = "%Y-%m-%d %H:%M:%S", tz = "UTC")) / 60
}
fmt_iso <- function(m, ms = FALSE) {
  ok <- !is.na(m)
  out <- rep("", length(m))
  if (any(ok)) {
    sec <- m[ok] * 60
    out[ok] <- format(as.POSIXct(sec, origin = "1970-01-01", tz = "UTC"), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
  }
  out
}
dnum <- function(date_str) floor(tmin(paste0(date_str, "T00:00:00Z")) / 1440)   # day number since epoch
day_str <- function(d) format(as.Date(d, origin = "1970-01-01"), "%Y-%m-%d")
weekday_of <- function(d) (d + 3) %% 7     # 0 = Monday (1970-01-01 was Thursday)

DST_END <- tmin("2026-11-01T06:00:00Z")
local_offset_h <- function(m) ifelse(m < DST_END, -4, -5)
local_hour_int <- function(m) floor(((m / 60) + local_offset_h(m)) %% 24 + 1e-12) # integer hour 0..23
mod24 <- function(x) { r <- x - 24 * floor(x / 24); r[!is.na(r) & r >= 24] <- 0; r }
diff12 <- function(x) { r <- mod24(x); ifelse(!is.na(r) & r > 12, r - 24, r) }  # into (-12, 12]

START_W <- tmin("2026-09-01T00:00:00Z")
CUTOFF  <- tmin("2026-11-22T10:00:00Z")
START_W34 <- tmin("2026-06-12T00:00:00Z")

## ---------------------------------------------------------------- output helpers
fmtnum <- function(v) {
  if (is.na(v)) return("")
  if (is.character(v)) return(v)
  format(v, digits = 15, scientific = FALSE, trim = TRUE)
}
tochar <- function(col) {
  if (is.character(col)) { col[is.na(col)] <- ""; return(col) }
  if (is.logical(col)) col <- as.integer(col)
  vapply(col, fmtnum, "")
}
wtab <- function(df, name, cols = names(df)) {
  df <- df[, cols, drop = FALSE]
  out <- as.data.frame(lapply(df, tochar), stringsAsFactors = FALSE)
  names(out) <- cols
  write.table(out, file.path(TAB, paste0(name, ".csv")), sep = ",", row.names = FALSE,
              quote = FALSE, na = "", col.names = TRUE)
  cat(sprintf("table %s: %d rows\n", name, nrow(df)))
  TABLE_ROWS[[name]] <<- nrow(df)
  invisible(df)
}
TABLE_ROWS <- list()
METRICS <- data.frame(question = character(), group = character(), metric = character(),
                      value = character(), stringsAsFactors = FALSE)
M <- function(q, group, metric, value) {
  v <- if (length(value) == 0 || is.na(value)) "" else if (is.character(value)) value else fmtnum(value)
  METRICS[nrow(METRICS) + 1, ] <<- list(q, if (is.na(group)) "" else group, metric, v)
}
write_metrics <- function() {
  write.table(METRICS, file.path(OUT, "metrics.csv"), sep = ",", row.names = FALSE, quote = FALSE, na = "")
}
BOOT_SKIPPED <- data.frame(table = character(), key = character(), statistic = character(),
                           n_skipped = integer(), stringsAsFactors = FALSE)

omedian <- function(x) { x <- x[!is.na(x)]; if (length(x) == 0) NA_real_ else median(x) }
omean   <- function(x) { x <- x[!is.na(x)]; if (length(x) == 0) NA_real_ else mean(x) }
rhaz <- function(x) ifelse(is.na(x), NA, sign(x) * floor(abs(x) + 0.5))   # round half away from zero

circ_mean <- function(h) {
  h <- h[!is.na(h)]
  if (length(h) == 0) return(NA_real_)
  mod24(atan2(mean(sin(2 * pi * h / 24)), mean(cos(2 * pi * h / 24))) * 24 / (2 * pi))
}
circ_sd <- function(h) {
  h <- h[!is.na(h)]
  if (length(h) == 0) return(NA_real_)
  R <- sqrt(mean(sin(2 * pi * h / 24))^2 + mean(cos(2 * pi * h / 24))^2)
  R <- min(R, 1)
  sqrt(-2 * log(R)) * 24 / (2 * pi)
}

## ---------------------------------------------------------------- reading tables
read_readings <- function(file, gauges = NULL) {
  d <- read.csv(file.path(SD, file),
                colClasses = c("character", "character", "character", "character", rep("NULL", 5)),
                na.strings = "", stringsAsFactors = FALSE)
  d$tm <- tmin(d$time_utc)
  d$v <- suppressWarnings(as.numeric(d$value))
  d
}
# non-blank, <= cutoff, unique on time (first kept), sorted
series_readings <- function(d, gauge, param) {
  s <- d[d$gauge == gauge & d$parameter == param & !is.na(d$v) & !is.na(d$tm) & d$tm <= CUTOFF, c("tm", "v")]
  s <- s[order(s$tm), ]
  dup <- duplicated(s$tm)
  list(rt = s$tm[!dup], rv = s$v[!dup], n_dup = sum(dup))
}

## ---------------------------------------------------------------- series preparation (spec section 3)
mode_step <- function(rt, start, end) {
  w <- rt[rt >= start & rt <= end]
  df <- diff(w)
  tb <- table(df)
  as.numeric(names(tb)[which.max(tb)])   # ties -> smallest difference (table is sorted ascending)
}
prepare_series <- function(rt, rv, start, end, maxgap = 30, step = NULL) {
  if (is.null(step)) step <- mode_step(rt, start, end)
  n <- floor((end - start) / step + 1e-9) + 1
  g <- start + step * (0:(n - 1))
  x <- rep(NA_real_, n)
  m <- match(g, rt)
  pres <- !is.na(m)
  x[pres] <- rv[m[pres]]
  ip <- findInterval(g, rt)
  fillable <- !pres & ip >= 1 & ip < length(rt)
  filled <- rep(FALSE, n)
  if (any(fillable)) {
    i <- which(fillable)
    a <- ip[i]; b <- a + 1
    ok <- (rt[b] - rt[a]) <= maxgap
    i <- i[ok]; a <- a[ok]; b <- b[ok]
    x[i] <- rv[a] + (rv[b] - rv[a]) * (g[i] - rt[a]) / (rt[b] - rt[a])
    filled[i] <- TRUE
  }
  half <- as.integer(round(720 / step))
  npts <- 2 * half + 1
  # moving average by running sums (centred for numerical stability)
  ctr <- if (any(!is.na(x))) mean(x, na.rm = TRUE) else 0
  xz <- ifelse(is.na(x), 0, x - ctr)
  cs <- c(0, cumsum(xz)); cn <- c(0, cumsum(!is.na(x)))
  MA <- rep(NA_real_, n)
  if (n >= npts) {
    i <- (half + 1):(n - half)
    cnt <- cn[i + half + 1] - cn[i - half]
    sm <- cs[i + half + 1] - cs[i - half]
    ok <- cnt >= 0.95 * npts
    MA[i[ok]] <- sm[ok] / cnt[ok] + ctr
  }
  d <- x - MA
  list(g = g, x = x, MA = MA, d = d, step = step, n = n, start = start, end = end, half = half,
       n_present = sum(pres), n_filled = sum(filled), n_missing = sum(is.na(x)),
       dayno = floor(g / 1440))
}

# centred mean over k points, defined where all k points exist
smooth_k <- function(d, k) {
  n <- length(d); h <- (k - 1) / 2
  out <- rep(NA_real_, n)
  if (n < k) return(out)
  ctr <- mean(d, na.rm = TRUE)
  dz <- ifelse(is.na(d), 0, d - ctr)
  cs <- c(0, cumsum(dz)); cn <- c(0, cumsum(!is.na(d)))
  i <- (h + 1):(n - h)
  cnt <- cn[i + h + 1] - cn[i - h]
  sm <- cs[i + h + 1] - cs[i - h]
  ok <- cnt == k
  out[i[ok]] <- sm[ok] / k + ctr
  out
}
SMOOTH_K <- c(`5` = 13, `15` = 5, `60` = 3)

# event-day flag per day (vector aligned with `days`). type "rel": relative 10 %, "abs": 0.10 ft
event_flags <- function(s, days, type = "rel") {
  ma_at <- function(t) {
    i <- (t - s$start) / s$step + 1
    out <- rep(NA_real_, length(t))
    ok <- i >= 1 & i <= s$n & abs(i - round(i)) < 1e-9
    out[ok] <- s$MA[round(i[ok])]
    out
  }
  m0 <- ma_at(days * 1440); m1 <- ma_at((days + 1) * 1440)
  if (type == "rel") ev <- abs(m1 - m0) / m0 > 0.10 else ev <- abs(m1 - m0) > 0.10
  ev[is.na(ev)] <- TRUE
  as.integer(ev)
}

# daily table of one series. `flag` = event flag vector aligned with the days of the series.
daily_table <- function(s, gauge, param, flag, is_flow) {
  days <- (floor(s$start / 1440)):(floor(s$end / 1440))
  nd <- length(days)
  sm <- smooth_k(s$d, SMOOTH_K[as.character(s$step)])
  res <- data.frame(gauge = gauge, parameter = param, day = days, day_utc = day_str(days),
                    step_min = s$step, n_present = NA_integer_, day_mean = NA_real_, A_a = NA_real_,
                    A_a_rel = NA_real_, A_b = NA_real_, phi_b_utc_h = NA_real_, crest_utc_h = NA_real_,
                    crest_local_h = NA_real_, trough_utc_h = NA_real_, trough_local_h = NA_real_,
                    event_day = flag, weekday_utc = weekday_of(days), stringsAsFactors = FALSE)
  first <- 1
  idxs <- split(seq_len(s$n), factor(s$dayno, levels = days))
  for (k in seq_len(nd)) {
    D <- days[k]; idx <- idxs[[k]]
    if (length(idx) == 0) { res$n_present[k] <- 0L; next }
    xv <- s$x[idx]; dv <- s$d[idx]
    npd <- length(idx)
    res$n_present[k] <- sum(!is.na(xv))
    if (sum(!is.na(xv)) >= 0.9 * npd) res$day_mean[k] <- mean(xv, na.rm = TRUE)
    if (sum(!is.na(dv)) >= 0.95 * npd) {
      res$A_a[k] <- (max(dv, na.rm = TRUE) - min(dv, na.rm = TRUE)) / 2
      if (is_flow && !is.na(res$day_mean[k])) res$A_a_rel[k] <- res$A_a[k] / res$day_mean[k]
      sv <- sm[idx]
      if (any(!is.na(sv))) {
        ic <- which.max(sv); it <- which.min(sv)
        tc <- s$g[idx[ic]]; tt <- s$g[idx[it]]
        res$crest_utc_h[k] <- (tc - D * 1440) / 60
        res$trough_utc_h[k] <- (tt - D * 1440) / 60
        res$crest_local_h[k] <- mod24(res$crest_utc_h[k] + local_offset_h(tc))
        res$trough_local_h[k] <- mod24(res$trough_utc_h[k] + local_offset_h(tt))
      }
    }
    ws <- (D - 1) * 1440; we <- (D + 2) * 1440
    if (ws >= s$start && we <= s$end) {
      i1 <- round((ws - s$start) / s$step) + 1
      i2 <- round((we - s$start) / s$step)
      ii <- i1:i2
      yy <- s$x[ii]
      ok <- !is.na(yy)
      if (sum(ok) >= 0.9 * length(ii)) {
        tau <- (s$g[ii] - ws) / 60
        X <- cbind(1, tau, cos(2 * pi * tau / 24), sin(2 * pi * tau / 24))[ok, , drop = FALSE]
        co <- lm.fit(X, yy[ok])$coefficients
        res$A_b[k] <- sqrt(co[3]^2 + co[4]^2)
        res$phi_b_utc_h[k] <- mod24(atan2(co[4], co[3]) * 24 / (2 * pi))
      }
    }
  }
  res
}

## ---------------------------------------------------------------- lagged correlation (section 3 point 10)
# series on the 5-minute master grid of the common window: vectors dmaster (detrended, NA where none)
to_master5 <- function(s, master_start, master_n) {
  out <- rep(NA_real_, master_n)
  i <- round((s$g - master_start) / 5) + 1
  out[i] <- s$d
  out
}
# interpolate a 15-minute detrended vector (on the 5-min master) to every 5-minute point between two
# non-missing neighbours 15 minutes apart
interp15_to5 <- function(dm) {
  n <- length(dm); out <- dm
  a <- which(!is.na(dm[seq_len(n - 3)]) & !is.na(dm[4:n]))
  for (j in 1:2) {
    i <- a + j
    out[i] <- dm[a] + (dm[a + 3] - dm[a]) * j / 3
  }
  out
}
# x, y: detrended values on the master 5-min grid; okx, oky: logical per master point (day is a non-event
# day for the gauge and the day lies inside the window). eval_step in minutes (5 or 15); lags in minutes.
lagcorr <- function(x, y, okx, oky, lags_min, eval_step) {
  n5 <- length(x)
  sub <- if (eval_step == 5) seq_len(n5) else seq(1, n5, by = eval_step / 5)
  xs <- x[sub]; ys <- y[sub]
  mx <- (!is.na(xs)) & okx[sub]; my <- (!is.na(ys)) & oky[sub]
  cx <- if (any(mx)) mean(xs[mx]) else 0; cy <- if (any(my)) mean(ys[my]) else 0
  xz <- ifelse(mx, xs - cx, 0); yz <- ifelse(my, ys - cy, 0)
  mxn <- as.numeric(mx); myn <- as.numeric(my)
  xz2 <- xz * xz; yz2 <- yz * yz
  m <- length(xs)
  r <- rep(NA_real_, length(lags_min)); np <- integer(length(lags_min))
  for (j in seq_along(lags_min)) {
    k <- as.integer(round(lags_min[j] / eval_step))
    if (k >= 0) { ix <- seq_len(m - k) } else { ix <- (1 - k):m }
    if (length(ix) < 3) { next }
    iy <- ix + k
    a_m <- mxn[ix]; b_m <- myn[iy]
    nn <- sum(a_m * b_m)
    np[j] <- nn
    if (nn < 3) next
    sx <- sum(xz[ix] * b_m); sy <- sum(a_m * yz[iy]); sxy <- sum(xz[ix] * yz[iy])
    sxx <- sum(xz2[ix] * b_m); syy <- sum(a_m * yz2[iy])
    vx <- sxx - sx * sx / nn; vy <- syy - sy * sy / nn
    if (vx > 0 && vy > 0) r[j] <- (sxy - sx * sy / nn) / sqrt(vx * vy)
  }
  list(lags = lags_min, r = r, n = np)
}
local_maxima <- function(res, step_min, thr = 0.3) {
  r <- res$r; J <- length(r)
  if (J < 3) return(data.frame(lag_min = numeric(), r = numeric()))
  j <- 2:(J - 1)
  ok <- !is.na(r[j]) & !is.na(r[j - 1]) & !is.na(r[j + 1]) & r[j] > r[j - 1] & r[j] >= r[j + 1] & r[j] >= thr
  data.frame(lag_min = res$lags[j[ok]], r = r[j[ok]])
}
max_lag <- function(res) {   # largest r, ties -> smallest lag
  if (all(is.na(res$r))) return(NULL)
  j <- which.max(res$r)
  list(lag_min = res$lags[j], r = res$r[j], n = res$n[j])
}

## ---------------------------------------------------------------- bootstrap (section 4)
U <- NULL
load_U <- function() {
  if (is.null(U)) U <<- as.matrix(read.csv(file.path(SD, "boot_uniforms.csv"), colClasses = "numeric"))
  U
}
BOOT_B <- 2000
# stat(w1, w2): w1 = integer draw counts over blocks of group 1 (length D1), w2 likewise (or NULL).
# returns numeric vector (NA = undefined). Result: matrix B x k.
boot_matrix <- function(D1, stat, D2 = NULL) {
  Um <- load_U()
  stopifnot(D1 <= 60, is.null(D2) || D2 <= 60)
  out <- NULL
  for (b in seq_len(BOOT_B)) {
    w1 <- tabulate(floor(Um[b, seq_len(D1)] * D1) + 1L, D1)
    w2 <- if (!is.null(D2)) tabulate(floor(Um[b, 60 + seq_len(D2)] * D2) + 1L, D2) else NULL
    v <- stat(w1, w2)
    if (is.null(out)) out <- matrix(NA_real_, BOOT_B, length(v))
    out[b, ] <- v
  }
  out
}
# interval from a column of resampled values: c(lo, hi, n_skipped)
boot_ci <- function(vals) {
  ok <- is.finite(vals)
  sk <- sum(!ok)
  if (sk > 0.05 * length(vals) || sum(ok) == 0) return(c(NA_real_, NA_real_, sk))
  q <- quantile(vals[ok], c(0.025, 0.975), type = 7, names = FALSE)
  c(q[1], q[2], sk)
}
note_skips <- function(tab, key, stat, n) {
  BOOT_SKIPPED[nrow(BOOT_SKIPPED) + 1, ] <<- list(tab, key, stat, as.integer(n))
}
label_interval <- function(lo, hi, thr_small, thr_big) {
  if (is.na(lo) || is.na(hi)) return("undetermined")
  if ((lo > 0 && hi > 0) || (lo < 0 && hi < 0)) { ml <- min(abs(lo), abs(hi)); mh <- max(abs(lo), abs(hi)) }
  else { ml <- 0; mh <- max(abs(lo), abs(hi)) }
  if (ml >= thr_big) "matters"
  else if (mh < thr_small) "does not matter"
  else if (ml >= thr_small && mh < thr_big) "small"
  else "undetermined"
}

## ---------------------------------------------------------------- hourly cycle (weighted)
# H: n x 24 indicator matrix of the hour of each row; e values; w row weights (non-negative counts)
make_H <- function(hr) { H <- matrix(0, length(hr), 24); H[cbind(seq_along(hr), hr + 1)] <- 1; H }
cycle_stats <- function(e, H, w, minrun = 3) {
  ok <- !is.na(e) & w > 0
  cnt <- as.vector(crossprod(H, w))
  sm  <- as.vector(crossprod(H, ifelse(is.na(e), 0, e) * w))
  valid <- cnt >= minrun
  mu <- ifelse(cnt > 0, sm / pmax(cnt, 1), NA_real_)
  nv <- sum(valid)
  cyc <- if (nv >= 2) (max(mu[valid]) - min(mu[valid])) / 2 else NA_real_
  crest <- if (nv >= 1) { hv <- which(valid); hv[which.max(mu[hv])] - 1 } else NA_real_
  list(cycle = cyc, crest = crest, mu = mu, cnt = cnt, valid = valid)
}

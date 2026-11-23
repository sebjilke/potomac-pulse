# Common helpers for Part R (base R only)
options(stringsAsFactors = FALSE, scipen = 999, warn = 1)
invisible(Sys.setlocale("LC_COLLATE", "C"))
Sys.setenv(TZ = "UTC")

args_all <- commandArgs(trailingOnly = FALSE)
farg <- sub("^--file=", "", args_all[grep("^--file=", args_all)])
SCRIPT_DIR <- if (length(farg)) dirname(normalizePath(farg[1])) else normalizePath("r_R")
STUDY <- dirname(SCRIPT_DIR)
OUT <- SCRIPT_DIR
TAB <- file.path(OUT, "tables")
dir.create(TAB, showWarnings = FALSE, recursive = TRUE)
TIDY <- file.path(STUDY, "data", "tidy")
RPL <- file.path(STUDY, "replay", "out")
FOLD <- file.path(STUDY, "replay", "f_old")

# ---------- reading ----------
rd <- function(path, keep = NULL) {
  hdr <- names(read.csv(path, nrows = 1, colClasses = "character", check.names = FALSE))
  cc <- rep("character", length(hdr)); names(cc) <- hdr
  if (!is.null(keep)) cc[setdiff(hdr, keep)] <- "NULL"
  read.csv(path, colClasses = cc, na.strings = "", stringsAsFactors = FALSE,
           check.names = FALSE, comment.char = "")
}
num <- function(x) suppressWarnings(as.numeric(x))

# ---------- time ----------
tsec <- function(x) {
  x <- as.character(x); out <- rep(NA_real_, length(x))
  ok <- !is.na(x) & nzchar(x)
  if (any(ok)) {
    xo <- x[ok]
    s <- as.numeric(as.POSIXct(substr(xo, 1, 19), format = "%Y-%m-%dT%H:%M:%S", tz = "UTC"))
    fr <- sub("^.{19}\\.?([0-9]*).*$", "\\1", xo)
    fr <- ifelse(nzchar(fr), suppressWarnings(as.numeric(paste0("0.", fr))), 0)
    out[ok] <- s + fr
  }
  out
}
tiso <- function(s) {
  out <- rep(NA_character_, length(s)); ok <- !is.na(s)
  out[ok] <- format(as.POSIXct(round(s[ok]), origin = "1970-01-01", tz = "UTC"), "%Y-%m-%dT%H:%M:%SZ")
  out
}
day_of <- function(x) substr(x, 1, 10)                 # from ISO string
dayn_of <- function(s) floor(s / 86400)                 # from seconds
day_str <- function(dn) tiso(dn * 86400) |> substr(1, 10)
min_trunc <- function(x) ifelse(is.na(x), NA_character_, paste0(substr(x, 1, 16), ":00Z"))
CUT <- tsec("2026-11-22T10:00:00Z")

# ---------- numerics ----------
rnd_half_away <- function(x) sign(x) * floor(abs(x) + 0.5)
q7 <- function(x, p) { x <- x[!is.na(x)]; if (!length(x)) return(NA_real_); as.numeric(quantile(x, p, type = 7, names = FALSE)) }
med <- function(x) { x <- x[!is.na(x)]; if (!length(x)) NA_real_ else median(x) }
mean_na <- function(x) { x <- x[!is.na(x)]; if (!length(x)) NA_real_ else mean(x) }
sd_na <- function(x) { x <- x[!is.na(x)]; if (length(x) < 2) NA_real_ else sd(x) }
cor_na <- function(x, y) { k <- !is.na(x) & !is.na(y); if (sum(k) < 3) return(NA_real_)
  if (sd(x[k]) == 0 || sd(y[k]) == 0) return(NA_real_); cor(x[k], y[k]) }
slope_na <- function(x, y) { k <- !is.na(x) & !is.na(y); if (sum(k) < 3) return(NA_real_)
  if (sd(x[k]) == 0) return(NA_real_); xm <- mean(x[k]); sum((x[k]-xm)*(y[k]-mean(y[k]))) / sum((x[k]-xm)^2) }
# plain ordinary least squares slope of y on x needs >= 2 points; keep >=3 guard out for tiny groups:
slope2 <- function(x, y) { k <- !is.na(x) & !is.na(y); if (sum(k) < 2) return(NA_real_)
  xm <- mean(x[k]); d <- sum((x[k]-xm)^2); if (d == 0) return(NA_real_); sum((x[k]-xm)*(y[k]-mean(y[k]))) / d }

# ---------- output ----------
fnum <- function(x) {
  out <- rep("", length(x)); ok <- !is.na(x) & is.finite(x)
  if (any(ok)) out[ok] <- vapply(x[ok], function(v) format(v, digits = 15, scientific = FALSE, trim = TRUE), "")
  out
}
qcsv <- function(s) {
  s[is.na(s)] <- ""
  need <- grepl("[\",\n\r]", s)
  s[need] <- paste0("\"", gsub("\"", "\"\"", s[need]), "\"")
  s
}
wcsv <- function(df, name, dir = TAB) {
  cols <- lapply(df, function(col) {
    if (is.logical(col)) col <- ifelse(is.na(col), NA, as.integer(col))
    if (is.numeric(col)) fnum(col) else qcsv(as.character(col))
  })
  m <- do.call(cbind, cols)
  if (is.null(m)) m <- matrix("", 0, 0)
  if (nrow(df) == 0) m <- matrix("", 0, ncol(df))
  lines <- c(paste(names(df), collapse = ","), if (nrow(df)) apply(m, 1, paste, collapse = ","))
  writeLines(lines, file.path(dir, paste0(name, ".csv")), useBytes = TRUE)
  cat(sprintf("  wrote %s (%d rows)\n", name, nrow(df)))
  invisible(nrow(df))
}
# row counts register
ROWCOUNTS <- list()
wtab <- function(df, name) { ROWCOUNTS[[name]] <<- wcsv(df, name); invisible(df) }

# ---------- metrics ----------
MET <- list()
addm <- function(question, group, metric, value) {
  if (length(value) != 1) stop("metric needs one value: ", metric)
  v <- if (is.na(value)) "" else if (is.numeric(value)) fnum(value) else as.character(value)
  MET[[length(MET) + 1]] <<- c(question, if (is.na(group)) "" else group, metric, v)
}
flush_metrics <- function() {
  if (!length(MET)) return(invisible())
  m <- do.call(rbind, MET)
  df <- data.frame(question = m[, 1], group = m[, 2], metric = m[, 3], value = m[, 4])
  lines <- c("question,group,metric,value", paste(qcsv(df$question), qcsv(df$group), qcsv(df$metric), qcsv(df$value), sep = ","))
  writeLines(lines, file.path(OUT, "metrics.csv"), useBytes = TRUE)
}

# ---------- phases / bands ----------
band_of_rating <- function(r) {
  out <- rep(0.15, length(r))
  out[!is.na(r) & r == "Excellent"] <- 0.02
  out[!is.na(r) & r == "Good"] <- 0.05
  out[!is.na(r) & r == "Fair"] <- 0.08
  out[!is.na(r) & r == "Poor"] <- 0.15
  out
}

# ---------- bootstrap ----------
U <- as.matrix(read.csv(file.path(TIDY, "boot_uniforms.csv"), colClasses = "numeric"))
stopifnot(nrow(U) == 2000, ncol(U) == 120)
NB <- 2000
ci_from <- function(vals) {   # vals: numeric vector length NB with NA for undefined
  nskip <- sum(is.na(vals))
  if (nskip / NB > 0.05) return(c(NA_real_, NA_real_, nskip))
  c(q7(vals, 0.025), q7(vals, 0.975), nskip)
}
# one group: day = block ids per row, X = matrix rows x stats; statistic = mean of non-NA of each column over pooled rows
boot_means <- function(day, X) {
  X <- as.matrix(X)
  blocks <- sort(unique(day)); D <- length(blocks); stopifnot(D <= 60, D >= 1)
  bi <- match(day, blocks)
  S <- rowsum(ifelse(is.na(X), 0, X), bi, reorder = TRUE)
  N <- rowsum((!is.na(X)) * 1, bi, reorder = TRUE)
  res <- matrix(NA_real_, NB, ncol(X))
  for (b in 1:NB) {
    w <- tabulate(floor(U[b, 1:D] * D) + 1, nbins = D)
    s <- as.vector(w %*% S); n <- as.vector(w %*% N)
    res[b, ] <- ifelse(n > 0, s / n, NA_real_)
  }
  t(apply(res, 2, ci_from))   # k x 3: lo, hi, nskip
}
# two groups: statistic = mean(B) - mean(A)
boot_diff <- function(dayA, xA, dayB, xB) {
  bA <- sort(unique(dayA)); bB <- sort(unique(dayB)); DA <- length(bA); DB <- length(bB)
  stopifnot(DA <= 60, DB <= 60, DA >= 1, DB >= 1)
  kA <- !is.na(xA); kB <- !is.na(xB)
  SA <- rowsum(ifelse(kA, xA, 0), match(dayA, bA), reorder = TRUE); NA_ <- rowsum(kA * 1, match(dayA, bA), reorder = TRUE)
  SB <- rowsum(ifelse(kB, xB, 0), match(dayB, bB), reorder = TRUE); NB_ <- rowsum(kB * 1, match(dayB, bB), reorder = TRUE)
  res <- rep(NA_real_, NB)
  for (b in 1:NB) {
    wA <- tabulate(floor(U[b, 1:DA] * DA) + 1, nbins = DA)
    wB <- tabulate(floor(U[b, 60 + (1:DB)] * DB) + 1, nbins = DB)
    nA <- sum(wA * NA_); nB <- sum(wB * NB_)
    if (nA > 0 && nB > 0) res[b] <- sum(wB * SB) / nB - sum(wA * SA) / nA
  }
  ci_from(res)
}

# ---------- series preparation ----------
prep_series <- function(t, v, ws, we) {
  k <- !is.na(v) & !is.na(t) & t >= ws & t <= we
  t <- t[k]; v <- v[k]; o <- order(t); t <- t[o]; v <- v[o]
  stopifnot(!anyDuplicated(t))
  dt <- diff(t); u <- sort(unique(dt)); cnt <- tabulate(match(dt, u)); step <- u[which.max(cnt)]
  ngrid <- floor((we - ws) / step) + 1
  grid <- ws + step * (0:(ngrid - 1))
  m <- match(grid, t); x <- v[m]; present <- !is.na(x)
  miss <- which(!present); filled <- 0
  if (length(miss)) {
    i <- findInterval(grid[miss], t); n <- length(t)
    ok <- i >= 1 & i < n
    ii <- pmin(pmax(i, 1), n - 1)
    gap <- t[ii + 1] - t[ii]
    fl <- ok & gap <= 1800
    val <- v[ii] + (v[ii + 1] - v[ii]) * (grid[miss] - t[ii]) / gap
    x[miss[fl]] <- val[fl]
    filled <- sum(fl)
  }
  H <- 43200 / step
  cs <- cumsum(c(0, ifelse(is.na(x), 0, x))); cn <- cumsum(c(0, !is.na(x)))
  MA <- rep(NA_real_, ngrid)
  if (ngrid >= 2 * H + 1) {
    kk <- (H + 1):(ngrid - H)
    s <- cs[kk + H + 1] - cs[kk - H]; c_ <- cn[kk + H + 1] - cn[kk - H]
    npts <- 2 * H + 1
    ok <- c_ >= 0.95 * npts
    MA[kk[ok]] <- s[ok] / c_[ok]
  }
  list(grid = grid, x = x, MA = MA, step = step, ws = ws, we = we, H = H,
       n_present = sum(present), n_filled = filled, n_missing = ngrid - sum(present) - filled, n_grid = ngrid)
}
ma_at <- function(ps, t) {
  i <- (t - ps$ws) / ps$step + 1
  out <- rep(NA_real_, length(t))
  ok <- !is.na(i) & i >= 1 & i <= ps$n_grid & abs(i - round(i)) < 1e-9
  out[ok] <- ps$MA[round(i[ok])]
  out
}
day_means <- function(ps) {
  dn <- floor(ps$grid / 86400)
  npts <- tapply(rep(1, length(dn)), dn, sum)
  good <- tapply(!is.na(ps$x), dn, sum)
  sm <- tapply(ifelse(is.na(ps$x), 0, ps$x), dn, sum)
  mean <- ifelse(good >= 0.9 * npts, sm / good, NA_real_)
  data.frame(dn = as.numeric(names(npts)), mean = as.numeric(mean), npts = as.numeric(npts), good = as.numeric(good))
}
# event-day flag for a flow series for day numbers dn (vector); TRUE if undefined
event_flag <- function(ps, dn) {
  a <- ma_at(ps, dn * 86400); b <- ma_at(ps, (dn + 1) * 86400)
  ev <- abs(b - a) / a > 0.10
  ev[is.na(ev)] <- TRUE
  ev
}
dm_lookup <- function(dmdf, dn) { r <- dmdf$mean[match(dn, dmdf$dn)]; r }

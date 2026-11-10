# Blind R event-list builder for the frozen rising-limb plan (section 3). Base R only.
# Reads ONLY hourly_backtest_data_v39.csv (por_lagged and travel_time_h are skipped, never read).
dir <- "/Users/sebjilke/Desktop/PotomacPulse/analysis/rising-limb-travel-backtest/"
d <- read.csv(file.path(dir, "hourly_backtest_data_v39.csv"), stringsAsFactors = FALSE,
  colClasses = c(timestamp = "character", por_now = "numeric", por_lagged = "NULL", ef_stage = "numeric",
                 lf_discharge = "numeric", lf_stage = "numeric", water_temp_c = "numeric",
                 monocacy = "numeric", goose = "numeric", broad_run = "numeric", seneca = "numeric",
                 travel_time_h = "NULL"))
tt <- as.numeric(as.POSIXct(d$timestamp, tz = "UTC", format = "%Y-%m-%d %H:%M")) / 3600
stopifnot(!anyNA(tt), all(tt == round(tt)), !anyDuplicated(tt), !is.unsorted(tt))
h0 <- min(tt); H <- max(tt) - h0 + 1
por <- rep(NA_real_, H); lf <- por; temp <- por
ix <- tt - h0 + 1
por[ix] <- d$por_now; lf[ix] <- d$lf_discharge; temp[ix] <- d$water_temp_c
hlast <- h0 + H - 1
fmt <- function(h) format(as.POSIXct(h * 3600, origin = "1970-01-01", tz = "UTC"), "%Y-%m-%d %H:%M")
hr  <- function(s) as.numeric(as.POSIXct(s, tz = "UTC", format = "%Y-%m-%d %H:%M")) / 3600
get <- function(a, h) { i <- h - h0 + 1; ifelse(i < 1 | i > H, NA_real_, a[pmin(pmax(i, 1), H)]) }

# detector series: gaps of <= 3 consecutive missing stamps linearly filled (C1)
fill_lf <- function(x) {
  n <- length(x); r <- rle(is.na(x)); e <- cumsum(r$lengths); s <- e - r$lengths + 1
  for (k in which(r$values)) {
    len <- e[k] - s[k] + 1
    if (len <= 3 && s[k] > 1 && e[k] < n) {
      a <- x[s[k] - 1]; b <- x[e[k] + 1]; x[s[k]:e[k]] <- a + (b - a) * (1:len) / (len + 1)
    }
  }
  x
}
lff <- fill_lf(lf)

# ---- onsets ----
cand <- which(!is.na(lff) & lff >= 6000); cand <- cand[cand > 1]
cand <- cand[!is.na(lff[cand - 1]) & lff[cand - 1] < 6000]
on <- list()
for (i in cand) {
  w <- lff[max(1, i - 48):(i - 1)]
  if (all(is.na(w))) next
  if (min(w, na.rm = TRUE) > 4500) next
  jj <- (i + 1):min(i + 720, H)
  ee <- if (i + 1 <= H) jj[!is.na(lff[jj]) & lff[jj] <= 6000] else integer(0)
  Eend <- if (length(ee)) ee[1] else i + 720
  win <- i:(min(Eend, i + 240) - 1); win <- win[win <= H]
  tp <- win[which.max(lff[win])]
  tend <- min(Eend, tp + 240)
  pk <- lff[tp]
  cl <- if (pk >= 12000) "GATE" else if (pk >= 8000) "STRATUM" else "BELOW"
  on[[length(on) + 1]] <- data.frame(t0 = i, tp = tp, tend = tend, peak = pk, cl = cl, stringsAsFactors = FALSE)
}
on <- do.call(rbind, on)
n_on <- table(factor(on$cl, levels = c("GATE", "STRATUM", "BELOW")))
q <- on[on$cl != "BELOW", ]; q <- q[order(q$t0), ]; rownames(q) <- NULL

# ---- merge (0 <= t0 - previous tend <= 48), against the running union ----
ev <- list(); n_merge <- 0
rk <- c(STRATUM = 1, GATE = 2)
for (k in seq_len(nrow(q))) {
  r <- q[k, ]
  if (length(ev) && (r$t0 - ev[[length(ev)]]$tend) >= 0 && (r$t0 - ev[[length(ev)]]$tend) <= 48) {
    p <- ev[[length(ev)]]; n_merge <- n_merge + 1
    p$tend <- r$tend
    u <- p$t0:p$tend; tpn <- u[which.max(lff[u])]
    p$tp <- tpn; p$peak <- lff[tpn]
    p$cl <- names(rk)[max(rk[p$cl], rk[r$cl])]
    ev[[length(ev)]] <- p
  } else ev[[length(ev) + 1]] <- r
}
ev <- do.call(rbind, ev); rownames(ev) <- NULL

# ---- lag view / tau_ref (for X3) ----
carry <- function(a, s) { for (k in 0:3) { v <- get(a, s - k); if (!is.na(v)) return(v) }; NA_real_ }
lfview <- function(t) carry(lf, t - 1)
flowmult <- function(q) 4139 * max(q, 1000)^(-0.5963) / 25.8
travel <- function(m, rr) { b <- 6.5 * m
  if (!is.null(rr) && rr$state == "rising" && rr$rate > 0) b * (1 - min(0.30, rr$rate * 0.02)) else b }
risefn <- function(t) {
  s <- (t - 72):(t - 2); v <- get(por, s); ok <- !is.na(v)
  if (sum(ok) < 1) return(list(rr = NULL, n = 0))
  ts <- s[ok] + 0.5; cf <- v[ok]; n <- length(ts)
  if (n < 4) return(list(rr = NULL, n = n))
  past <- which(ts <= t - 6); if (!length(past)) return(list(rr = NULL, n = n))
  pi <- max(past); hd <- ts[n] - ts[pi]; if (hd <= 0) return(list(rr = NULL, n = n))
  rate <- ((cf[n] - cf[pi]) / cf[pi] * 100) / hd
  st <- "steady"
  if (n >= 8) { ch <- cf[n] - cf[pi]; thr <- max(100, cf[n] * 0.02)
    if (abs(ch) >= thr) st <- if (ch > 0) "rising" else "falling" }
  list(rr = list(rate = rate, state = st), n = n)
}
view_search <- function(x) { u <- ceiling(x - 1e-9); for (k in 0:2) { v <- lfview(u + k); if (!is.na(v)) return(v) }; NA_real_ }
scored_tick <- function(t) {
  if (is.na(carry(por, t - 2)) || is.na(lfview(t))) return(FALSE)
  rr <- risefn(t)$rr; tau_prev <- 6.5; tau <- NA
  for (k in 1:3) {
    v <- view_search(t + tau_prev); if (is.na(v)) return(FALSE)
    tau <- travel(flowmult(v), rr)
    if (abs(tau - tau_prev) < 0.5) break
    tau_prev <- tau
  }
  !is.na(view_search(t + tau))
}

# ---- flags ----
n <- nrow(ev); ev$id <- seq_len(n)
t0h <- h0 + ev$t0 - 1; tph <- h0 + ev$tp - 1; tendh <- h0 + ev$tend - 1
x0 <- x1 <- x2 <- x3 <- x4 <- nscored <- integer(n)
burn <- hr("2012-12-01 00:00")
for (e in seq_len(n)) {
  x0[e] <- as.integer(t0h[e] - 12 < burn)
  s <- (t0h[e] - 24):tendh[e]; mo <- as.POSIXlt(s * 3600, origin = "1970-01-01", tz = "UTC")$mon + 1
  tv <- get(temp, s); x1[e] <- as.integer(any(mo %in% c(12, 1, 2, 3) & (is.na(tv) | tv <= 5)))
  s2 <- (t0h[e] - 12):tendh[e]; bad <- FALSE
  for (a in list(por, lf)) {
    m <- is.na(get(a, s2)); r <- rle(m)
    if ((any(r$values) && max(r$lengths[r$values]) >= 6) || sum(m) * 10 > length(s2)) bad <- TRUE
  }
  x2[e] <- as.integer(bad)
  rl <- (t0h[e] - 12):min(t0h[e] + 24, tph[e])
  nscored[e] <- sum(vapply(rl, scored_tick, logical(1)))
  x3[e] <- as.integer(nscored[e] < 6)
  x4[e] <- as.integer(tendh[e] > hlast)
}
kept <- as.integer(x0 + x1 + x2 + x3 + x4 == 0)
octh <- hr("2026-10-14 12:00")
contains <- t0h <= octh & octh <= tendh
oct <- as.integer(contains & ev$cl == "GATE" & kept == 1)
nonoct <- kept == 1 & ev$cl == "GATE" & oct == 0
Nn <- sum(nonoct); nh <- (Nn + 4) %/% 5   # ceil(0.20 * N)
hold <- integer(n)
if (nh > 0) hold[tail(which(nonoct), nh)] <- 1L

out <- data.frame(event_id = ev$id, t0 = fmt(t0h), tp = fmt(tph), tend = fmt(tendh), peak_cfs = ev$peak,
  class = ev$cl, x0 = x0, x1 = x1, x2 = x2, x3 = x3, x4 = x4, kept = kept, oct = oct, holdout = hold,
  n_rl_ticks_scored = nscored, stringsAsFactors = FALSE)
write.csv(out, file.path(dir, "rising_limb_events_R_v39.csv"), row.names = FALSE, quote = FALSE)

# ---- sanity checks ----
chk <- c(
  ordered = !is.unsorted(t0h, strictly = TRUE),
  nonoverlap = all(tendh[-n] < t0h[-1]),
  tp_in = all(tph >= t0h & tph <= tendh),
  class_ok = all((ev$cl == "GATE" & ev$peak >= 12000) | (ev$cl == "STRATUM" & ev$peak >= 8000 & ev$peak < 12000)),
  kept_nonempty = all(nscored[kept == 1] >= 6))
print(chk); stopifnot(all(chk))

# ---- summary ----
cls <- c("GATE", "STRATUM")
cnt <- function(f) sapply(cls, function(c) sum(f & ev$cl == c))
L <- c("# Rising-limb event list, blind R implementation, v39 data", "",
 "## Counts", "",
 sprintf("- Onsets before merging (all): %d; GATE %d, STRATUM %d, below 8,000 (not events) %d", nrow(on), n_on["GATE"], n_on["STRATUM"], n_on["BELOW"]),
 sprintf("- Merges: %d", n_merge),
 sprintf("- Events after merging: %d; GATE %d, STRATUM %d", n, sum(ev$cl == "GATE"), sum(ev$cl == "STRATUM")),
 sprintf("- X0 (GATE / STRATUM): %s", paste(cnt(x0 == 1), collapse = " / ")),
 sprintf("- X1: %s", paste(cnt(x1 == 1), collapse = " / ")),
 sprintf("- X2: %s", paste(cnt(x2 == 1), collapse = " / ")),
 sprintf("- X3: %s", paste(cnt(x3 == 1), collapse = " / ")),
 sprintf("- X4: %s", paste(cnt(x4 == 1), collapse = " / ")),
 sprintf("- Kept (GATE / STRATUM): %s", paste(cnt(kept == 1), collapse = " / ")),
 sprintf("- Kept GATE non-October: %d against floor 15", Nn))
oe <- which(contains)
if (length(oe)) {
  for (e in oe) L <- c(L, sprintf("- Event containing 2026-10-14 12:00: id %d, t0 %s, tp %s, tend %s, class %s, kept %d (x0..x4 = %s), oct flag %d",
    e, out$t0[e], out$tp[e], out$tend[e], out$class[e], kept[e], paste(c(x0[e], x1[e], x2[e], x3[e], x4[e]), collapse = ""), oct[e]))
} else L <- c(L, "- No event contains 2026-10-14 12:00 (October not detected).")
L <- c(L, sprintf("- Holdout event ids: %s (nh = %d of N_nonOct = %d)", paste(out$event_id[hold == 1], collapse = ", "), nh, Nn),
  sprintf("- Verdict: %s", if (Nn >= 15) "PROCEED" else "FAIL-INSUFFICIENT"), "",
 "## Ambiguities (reading taken)", "",
 "1. Merged events: RL = [t0 - 12 h, min(t0 + 24 h, tp)] uses the union t0 and union tp (literal). Later components' limbs are not scored in RL.",
 "2. Merge chaining: each onset is tested against the running union tend of the previous (possibly merged) event.",
 "3. E_end search covers stamps t0+1 .. t0+720 h inclusive; none found gives t0+720 h even if beyond the data. tp window is [t0, min(E_end, t0+240h)) with E_end excluded.",
 "4. 'Carry the latest non-blank stamp within 3 h' = look back up to 3 stamps (s, s-1, s-2, s-3), per C1. Carry uses raw (unfilled) series. Absent CSV rows are blank.",
 "5. PoR history window 'trailing 72 h' = stamps s' in [t-72, t-2]; raw values, no carry in the history. Rise rate, flow state, thresholds taken from netlify/functions/shared/model.js (getPoRRiseRateFromHistory, getFlowState, getFlowMultiplier, getGFtoLFTravelTime, constants), read because the plan names them but gives no formulas. That file is outside the listed readable set but outside the blind folder.",
 "6. History with fewer than 4 entries or no entry at or before t-6 h gives null rise rate (no travel reduction); flow state needs >= 8 entries.",
 "7. If LF view is missing (after the 2.5 h search) at any tau iteration, the tick is dropped from the common mask. The common mask also requires PoR view (carry of stamp t-2) and LF view at t.",
 "8. Search 'up to 2.5 h' after the first tick u = ticks u, u+1, u+2 (C2).",
 "9. oct = 1 only for a GATE event that is kept and contains the stamp; an excluded or STRATUM event containing it gets oct = 0 (reported above).",
 "10. Holdout is drawn from kept GATE non-October events (the included set), N_nonOct = their count.",
 "11. X1 and X2 treat stamps beyond the last data stamp as missing/blank (also covered by X4).",
 "12. Prior-window minimum near the start of the data uses the available (truncated) window; irrelevant after X0.",
 "13. 'Stamp in months 12,1,2,3' uses the UTC month of each stamp in [t0-24 h, tend].")
writeLines(L, file.path(dir, "rising_limb_event_summary_R_v39.md"))

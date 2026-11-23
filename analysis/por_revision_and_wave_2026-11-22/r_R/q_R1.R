cat("R1\n")
po <- getser("old", G$por, "00060"); po <- po[!is.na(po$v), ]
pc <- getser("census", G$por, "00060"); pc_all <- pc; pc <- pc[!is.na(pc$v), ]
pl <- getser("model", G$por, "00065"); pl <- pl[!is.na(pl$v), ]
mi <- match(po$time_utc, pc$time_utc); k <- !is.na(mi)
P <- data.frame(time_utc = po$time_utc[k], t = po$t[k], old = po$v[k], cur = pc$v[mi[k]],
                lm = pc$last_modified_utc[mi[k]], stringsAsFactors = FALSE)
P$level <- pl$v[match(P$time_utc, pl$time_utc)]
P$changed <- as.integer(P$old != P$cur)
P$lm_min <- min_trunc(P$lm)
P$ratio <- P$cur / P$old
P$diff <- P$cur - P$old
P$rev13 <- P$changed == 1 & !is.na(P$lm_min) & P$lm_min == "2026-11-13T19:41:00Z"
P$day <- day_of(P$time_utc)
P <- P[order(P$t), ]
cat(sprintf("  pairs %d, changed %d, rev13 %d, old rows before 2026-06-12: %d\n", nrow(P), sum(P$changed), sum(P$rev13), sum(P$time_utc < "2026-06-12T00:00:00Z")))
stopifnot(sum(P$changed == 1 & is.na(P$lm_min)) == 0)

# 2. rewrite groups
C <- P[P$changed == 1, ]
if (nrow(C)) {
  gl <- sort(unique(C$lm_min))
  rg <- do.call(rbind, lapply(gl, function(g) { x <- C[C$lm_min == g, ]
    data.frame(lm_minute = g, n_pairs = nrow(x), first_time_utc = x$time_utc[which.min(x$t)], last_time_utc = x$time_utc[which.max(x$t)],
               mean_ratio = mean(x$ratio), min_ratio = min(x$ratio), max_ratio = max(x$ratio)) }))
} else rg <- data.frame(lm_minute = character(), n_pairs = integer(), first_time_utc = character(), last_time_utc = character(), mean_ratio = numeric(), min_ratio = numeric(), max_ratio = numeric())
wtab(rg, "R1_rewrite_groups")

# 3. REV13 metrics
R13 <- P[P$rev13, ]
addm("R1", NA, "n_pairs_all", nrow(P)); addm("R1", NA, "n_changed_all", sum(P$changed)); addm("R1", NA, "n_rev13", nrow(R13))
f13 <- R13$time_utc[which.min(R13$t)]; l13 <- R13$time_utc[which.max(R13$t)]
addm("R1", NA, "rev13_first_time_utc", f13); addm("R1", NA, "rev13_last_time_utc", l13)
addm("R1", NA, "n_unchanged_inside_rev13_span", sum(P$changed == 0 & P$t >= tsec(f13) & P$t <= tsec(l13)))
st <- pc_all[!is.na(pc_all$last_modified_utc) & min_trunc(pc_all$last_modified_utc) == "2026-11-13T19:41:00Z", ]
addm("R1", NA, "n_current_stamped_1941", nrow(st))
addm("R1", NA, "earliest_time_stamped_1941", st$time_utc[which.min(st$t)]); addm("R1", NA, "latest_time_stamped_1941", st$time_utc[which.max(st$t)])
addm("R1", NA, "n_pairs_all_if_archive_restricted_from_2026-06-12", sum(P$time_utc >= "2026-06-12T00:00:00Z"))

# 4. by day
Pd <- P[P$day >= "2026-08-01", ]
days <- sort(unique(Pd$day))
bd <- do.call(rbind, lapply(days, function(d) { x <- Pd[Pd$day == d, ]; r <- x[x$rev13, ]
  data.frame(day_utc = d, n_pairs = nrow(x), n_changed = sum(x$changed), n_rev13 = nrow(r), mean_old = mean(x$old), mean_current = mean(x$cur),
             mean_ratio_rev13 = if (nrow(r)) mean(r$ratio) else NA_real_, mean_diff_rev13_cfs = if (nrow(r)) mean(r$diff) else NA_real_) }))
wtab(bd, "R1_by_day")

# 5. by level
RL <- R13[!is.na(R13$level), ]
RL$h100 <- rnd_half_away(RL$level * 100)
lv <- sort(unique(RL$h100))
bl <- do.call(rbind, lapply(lv, function(h) { x <- RL[RL$h100 == h, ]
  data.frame(level_ft = h / 100, n = nrow(x), mean_old = mean(x$old), mean_current = mean(x$cur), mean_ratio = mean(x$ratio), mean_diff_cfs = mean(x$diff),
             n_distinct_old = length(unique(x$old)), n_distinct_current = length(unique(x$cur))) }))
wtab(bl, "R1_by_level")
RL$band <- floor(RL$h100 / 25) * 25
bands <- sort(unique(RL$band))
bb <- do.call(rbind, lapply(bands, function(b) { x <- RL[RL$band == b, ]
  data.frame(band_lo = b / 100, n = nrow(x), mean_ratio = mean(x$ratio), sd_ratio = sd_na(x$ratio), mean_diff_cfs = mean(x$diff), sd_diff_cfs = sd_na(x$diff)) }))
wtab(bb, "R1_by_level_band")
addm("R1", NA, "n_rev13_with_level", nrow(RL))

# 6. description
Lh <- tapply(RL$old, RL$h100, median); lev <- as.numeric(names(Lh)); Lm <- cummax(as.numeric(Lh))
o <- order(lev); lev <- lev[o]; Lm <- Lm[o]
cc <- RL$cur
ii <- findInterval(cc, Lm, left.open = TRUE) + 1
hstar <- rep(NA_real_, nrow(RL))
for (j in seq_along(cc)) {
  i <- ii[j]
  if (i > length(Lm)) next
  if (Lm[i] == cc[j]) hstar[j] <- lev[i]
  else if (i == 1) next
  else hstar[j] <- lev[i - 1] + (cc[j] - Lm[i - 1]) / (Lm[i] - Lm[i - 1]) * (lev[i] - lev[i - 1])
}
RL$s <- (hstar - RL$h100) / 100
for (nm in c("r", "q", "s")) {
  v <- switch(nm, r = RL$ratio, q = RL$diff, s = RL$s); v <- v[!is.na(v)]
  addm("R1", NA, paste0("mean_", nm), mean(v)); addm("R1", NA, paste0("sd_", nm), sd(v))
  addm("R1", NA, paste0("cv_", nm), sd(v) / abs(mean(v))); addm("R1", NA, paste0("n_", nm), length(v))
}
addm("R1", NA, "n_shift_undefined", sum(is.na(RL$s)))

# 7. over time
rows <- list(); 
for (b in c(100, 110, 120)) {
  x <- RL[RL$h100 >= b & RL$h100 < b + 10, ]
  dd <- sort(unique(x$day))
  tb <- do.call(rbind, lapply(dd, function(d) { y <- x[x$day == d, ]; data.frame(band_lo = b / 100, day_utc = d, n = nrow(y), mean_ratio = mean(y$ratio)) }))
  rows[[length(rows) + 1]] <- tb
  lab <- format(b / 100, nsmall = 2)
  addm("R1", NA, paste0("n_days_", lab), nrow(tb))
  if (nrow(tb) >= 5) {
    dn <- as.numeric(as.Date(tb$day_utc)) - as.numeric(as.Date(tb$day_utc[1]))
    addm("R1", NA, paste0("slope_ratio_per_day_", lab), slope2(dn, tb$mean_ratio))
  }
}
wtab(do.call(rbind, rows), "R1_ratio_day_band")

# 8. old copies
a <- RD$old; b <- RD$oct
oc <- list()
for (k in sort(intersect(unique(a$key), unique(b$key)))) {
  x <- a[a$key == k, ]; y <- b[b$key == k, ]
  m <- intersect(x$time_utc, y$time_utc)
  xx <- x$v[match(m, x$time_utc)]; yy <- y$v[match(m, y$time_utc)]; kk <- !is.na(xx) & !is.na(yy)
  d <- abs(xx[kk] - yy[kk])
  gp <- strsplit(k, "|", fixed = TRUE)[[1]]
  oc[[length(oc) + 1]] <- data.frame(gauge = gp[1], parameter = gp[2], n_shared = sum(kk), n_equal = sum(d == 0), n_different = sum(d != 0),
                                     max_abs_diff = if (length(d)) max(d) else NA_real_)
}
wtab(do.call(rbind, oc), "R1_old_copies")

# 9. job log pairs
lab_old <- LAB$seq[LAB$cur_label == "old"]
ru <- RUNS[RUNS$seq %in% lab_old, ]
cq <- pc$v[match(ru$in_por_qT_utc, pc$time_utc)]
lp <- data.frame(seq = num(ru$seq), in_por_qT_utc = ru$in_por_qT_utc, in_por_h = num(ru$in_por_h), logged_q = num(ru$in_por_q), current_q = cq)
lp$ratio <- lp$current_q / lp$logged_q
lp <- lp[order(lp$seq), ]
wtab(lp, "R1_log_pairs")
addm("R1", NA, "n", sum(!is.na(lp$ratio))); addm("R1", NA, "mean_ratio", mean_na(lp$ratio))
addm("R1", NA, "min_ratio", min(lp$ratio, na.rm = TRUE)); addm("R1", NA, "max_ratio", max(lp$ratio, na.rm = TRUE))
addm("R1", NA, "n_log_runs_old_label", nrow(lp))
flush_metrics()

cat("R2\n")
cmp_series <- function(old, cur) {
  old <- old[!is.na(old$v), ]; cur <- cur[!is.na(cur$v), ]
  m <- match(old$time_utc, cur$time_utc); k <- !is.na(m)
  o <- old[k, ]; c_ <- cur[m[k], ]
  ch <- o$v != c_$v
  d <- abs(o$v - c_$v)
  tt <- o$t[ch]
  list(n_pairs = nrow(o), n_equal = sum(!ch), n_changed = sum(ch),
       first = if (any(ch)) o$time_utc[ch][which.min(tt)] else NA_character_,
       last = if (any(ch)) o$time_utc[ch][which.max(tt)] else NA_character_,
       maxd = if (nrow(o)) max(d) else NA_real_,
       nlm = length(unique(min_trunc(c_$last_modified_utc[ch]))))
}
rows <- list()
for (k in sort(unique(RD$old$key))) {
  if (k == paste(G$por, "00060", sep = "|")) next
  gp <- strsplit(k, "|", fixed = TRUE)[[1]]
  src <- if (k == paste(G$lf, "00060", sep = "|")) "census" else "model"
  r <- cmp_series(getser("old", gp[1], gp[2]), getser(src, gp[1], gp[2]))
  rows[[length(rows) + 1]] <- data.frame(gauge = gp[1], parameter = gp[2], n_pairs = r$n_pairs, n_equal = r$n_equal, n_changed = r$n_changed,
    first_changed_time_utc = r$first, last_changed_time_utc = r$last, max_abs_diff = r$maxd, n_distinct_lm_minutes_of_changed = r$nlm)
}
wtab(do.call(rbind, rows), "R2_series")
r <- cmp_series(getser("oct", G$por, "00065"), getser("model", G$por, "00065"))
wtab(data.frame(gauge = G$por, parameter = "00065", n_pairs = r$n_pairs, n_equal = r$n_equal, n_changed = r$n_changed,
    first_changed_time_utc = r$first, last_changed_time_utc = r$last, max_abs_diff = r$maxd, n_distinct_lm_minutes_of_changed = r$nlm), "R2_por_level_octpull")

pl <- getser("model", G$por, "00065"); pl <- pl[!is.na(pl$v), ]
cur_h <- pl$v[match(RUNS$in_por_hT_utc, pl$time_utc)]
lg <- num(RUNS$in_por_h)
both <- !is.na(cur_h) & !is.na(lg)
eq <- both & cur_h == lg
addm("R2", NA, "n", sum(both)); addm("R2", NA, "n_equal", sum(eq))
addm("R2", NA, "n_used_runs", nrow(RUNS)); addm("R2", NA, "n_runs_without_both_values", sum(!both))
mm <- both & !eq
wtab(data.frame(seq = num(RUNS$seq)[mm], in_por_hT_utc = RUNS$in_por_hT_utc[mm], logged_h = lg[mm], current_h = cur_h[mm]), "R2_por_level_log_mismatch")
flush_metrics()

cat("R3\n")
# visit builder (R3.1 rule) for any gauge in field_measurements
pick_latest <- function(x) {   # x: rows of one kind; latest last_modified, then largest feature_id (text order)
  if (nrow(x) == 1) return(1L)
  sec <- tsec(x$last_modified); fr <- sub("^.{19}\\.?([0-9]*).*$", "\\1", x$last_modified)
  fr <- formatC(as.numeric(ifelse(nzchar(fr), substr(paste0(fr, "000000000"), 1, 9), "0")), width = 9, flag = "0", format = "d")
  key <- paste(formatC(sec, width = 15, flag = "0", format = "d"), fr, x$feature_id)
  # largest key: sec (numeric, can be negative only for ancient dates) then frac then feature_id
  o <- order(sec, fr, x$feature_id, decreasing = TRUE, method = "radix")
  o[1]
}
build_visits <- function(g) {
  f <- FM[FM$gauge == g, ]
  cols <- setdiff(names(f), c("feature_id", "source_file"))
  dup <- duplicated(f[, cols]); f <- f[!dup, ]
  ids <- unique(f$field_visit_id)
  sp <- split(seq_len(nrow(f)), factor(f$field_visit_id, levels = ids))
  nmulti <- 0L
  rows <- lapply(sp, function(ix) {
    x <- f[ix, ]
    d <- x[x$parameter_code == "00060" & x$reading_type == "Discharge", ]
    h <- x[x$parameter_code == "00065" & x$reading_type == "MeanGageHeight", ]
    multi <- (nrow(d) > 1) || (nrow(h) > 1)
    dr <- if (nrow(d)) d[pick_latest(d), ] else NULL
    hr <- if (nrow(h)) h[pick_latest(h), ] else NULL
    vt <- if (!is.null(dr)) dr$visit_time_utc else { tt <- x$visit_time_utc[!is.na(x$visit_time_utc)]; if (length(tt)) tt[which.min(tsec(tt))] else NA_character_ }
    data.frame(gauge = g, visit_time_utc = vt, field_visit_id = x$field_visit_id[1],
               level_ft = if (!is.null(hr)) num(hr$value) else NA_real_, flow_cfs = if (!is.null(dr)) num(dr$value) else NA_real_,
               control_condition = if (!is.null(dr)) dr$control_condition else NA_character_,
               measurement_rated = if (!is.null(dr)) dr$measurement_rated else NA_character_,
               observing_procedure = if (!is.null(dr)) dr$observing_procedure else NA_character_,
               last_modified = if (!is.null(dr)) dr$last_modified else NA_character_,
               n_rows = nrow(x), n_reference_rows = sum(x$reading_type == "ReferencePrimary"), multi = multi, stringsAsFactors = FALSE)
  })
  v <- do.call(rbind, rows)
  v$t <- tsec(v$visit_time_utc)
  v <- v[order(v$t, v$field_visit_id), ]
  attr(v, "n_dup") <- sum(dup)
  v
}
VIS <- list()
for (g in sort(unique(FM$gauge))) VIS[[g]] <- build_visits(g)

# R3.1 table
vt <- do.call(rbind, lapply(c(G$por, G$lf), function(g) VIS[[g]]))
vt <- vt[order(vt$gauge, vt$t, vt$field_visit_id), ]
wtab(vt[, c("gauge", "visit_time_utc", "field_visit_id", "level_ft", "flow_cfs", "control_condition", "measurement_rated",
            "observing_procedure", "last_modified", "n_rows", "n_reference_rows")], "R3_visits")
for (g in c(G$por, G$lf)) {
  v <- VIS[[g]]
  addm("R3", g, "n_duplicate_rows_dropped", attr(v, "n_dup"))
  addm("R3", g, "n_visits_with_multiple_rows_of_a_kind", sum(v$multi))
  addm("R3", g, "n_visits_all", nrow(v)); addm("R3", g, "n_visits_without_discharge", sum(is.na(v$flow_cfs)))
  addm("R3", g, "n_reference_rows", sum(v$n_reference_rows))
  yr <- as.integer(substr(v$visit_time_utc, 1, 4))
  for (y in 2021:2026) {
    addm("R3", NA, sprintf("visits_%s_%d", g, y), sum(yr == y, na.rm = TRUE))
    addm("R3", NA, sprintf("visits_with_flow_%s_%d", g, y), sum(yr == y & !is.na(v$flow_cfs), na.rm = TRUE))
  }
  s <- sort(v$t[v$t >= tsec("2021-01-01T00:00:00Z")])
  addm("R3", NA, sprintf("median_days_between_visits_%s", g), if (length(s) >= 2) median(diff(s) / 86400) else NA_real_)
}

# R3.2 measured vs published
nearest15 <- function(tq, tr, vr) {   # nearest reading within 900 s, earlier on tie; returns value
  out <- rep(NA_real_, length(tq))
  i <- findInterval(tq, tr); n <- length(tr)
  for (j in seq_along(tq)) {
    cand <- c(i[j], i[j] + 1); cand <- cand[cand >= 1 & cand <= n]
    if (!length(cand)) next
    d <- abs(tr[cand] - tq[j]); b <- cand[which.min(d)]   # which.min picks first (earlier) on tie
    if (min(d) <= 900) out[j] <- vr[b]
  }
  out
}
pc <- getser("census", G$por, "00060"); pc <- pc[!is.na(pc$v), ]
po <- getser("old", G$por, "00060"); po <- po[!is.na(po$v), ]
v <- VIS[[G$por]]; v <- v[!is.na(v$flow_cfs) & v$visit_time_utc >= "2025-01-01T00:00:00Z", ]
mv <- data.frame(visit_time_utc = v$visit_time_utc, level_ft = v$level_ft, measured_cfs = v$flow_cfs, measurement_rated = v$measurement_rated,
                 control_condition = v$control_condition, current_cfs = nearest15(v$t, pc$t, pc$v), old_cfs = nearest15(v$t, po$t, po$v))
mv$pct_current_vs_measured <- (mv$current_cfs - mv$measured_cfs) / mv$measured_cfs * 100
mv$pct_old_vs_measured <- (mv$old_cfs - mv$measured_cfs) / mv$measured_cfs * 100
mv <- mv[order(tsec(mv$visit_time_utc)), ]
wtab(mv, "R3_measured_vs_published")
MV <- mv

# R3.3 bulk rewrites
brows <- list()
for (g in c(G$por, G$lf)) {
  d <- getser("census", g, "00060"); d <- d[!is.na(d$v) & !is.na(d$last_modified_utc), ]
  d$lmm <- min_trunc(d$last_modified_utc)
  tb <- table(d$lmm); big <- names(tb)[tb >= 96]
  vv <- VIS[[g]]; vv <- vv[!is.na(vv$flow_cfs), ]
  rr <- lapply(sort(big), function(m) { x <- d[d$lmm == m, ]
    ms <- tsec(m); pv <- vv$t[vv$t <= ms]
    data.frame(gauge = g, lm_minute = m, n_readings = nrow(x), first_time_utc = x$time_utc[which.min(x$t)], last_time_utc = x$time_utc[which.max(x$t)],
               span_days = (max(x$t) - min(x$t)) / 86400, days_since_last_visit = if (length(pv)) (ms - max(pv)) / 86400 else NA_real_) })
  b <- if (length(rr)) do.call(rbind, rr) else NULL
  brows[[length(brows) + 1]] <- b
  addm("R3", g, "n_bulk", length(big))
  addm("R3", g, "share_of_readings_in_bulk", if (length(big)) sum(tb[big]) / nrow(d) else 0)
  addm("R3", g, "n_bulk_within_7_days_after_a_visit", if (!is.null(b)) sum(!is.na(b$days_since_last_visit) & b$days_since_last_visit <= 7) else 0)
  addm("R3", g, "longest_span_days", if (!is.null(b)) max(b$span_days) else NA_real_)
  addm("R3", g, "n_readings_total_census", nrow(d)); addm("R3", g, "n_distinct_lm_minutes", length(tb))
}
bk <- do.call(rbind, brows); bk <- bk[order(bk$gauge, bk$lm_minute), ]
wtab(bk, "R3_bulk_rewrites")
flush_metrics()

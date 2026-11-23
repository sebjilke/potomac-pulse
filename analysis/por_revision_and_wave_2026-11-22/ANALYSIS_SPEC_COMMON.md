# Analysis specification, common part (read this first)

Version 2, 2026-11-23 (UTC). Written by the orchestrator after the tool audit and BEFORE any study result was
computed or seen by the orchestrator; version 2 works in the independent auditor's review of version 1 (28
points, all wording; `TOOL_AUDIT.md`, which analysts do not read). Four blind analysts work from it: Python and
R on Part R (`ANALYSIS_SPEC_R.md`), Python and R on Part W (`ANALYSIS_SPEC_W.md`). No analyst sees another's
code or output. Analysts report numbers and tables. They state no opinion on what a number means.

One fact is already known and is disclosed here so that nobody "discovers" it: an earlier integrity check
showed that Little Falls flow and level, Monocacy flow and Edwards Ferry level are identical in the old archive
and in the current record from 12 Jun to 9 Nov 2026 at identical timestamps. Part R still computes this itself.

## 1. What you may read, and what you may not

Study folder: `/Users/sebjilke/Desktop/PotomacPulse/analysis/por_revision_and_wave_2026-11-22/` (called `S/`).

You MAY read: this file and your part's spec; `S/data/tidy/` (all tables and `DICTIONARY.md`);
`S/replay/out/` (all tables and `OUT_DICTIONARY.md`); `S/replay/f_old/f_old_values.csv` and
`lookup_by_day.csv`; and, for question W7 only,
`S/../rising-limb-travel-backtest/hourly_backtest_data_v39.csv` and `S/../replay_lag_2026-11-17/shadow_F.csv`
with `S/../replay_lag_2026-11-17/README.md` (column lists only).

Part W analysts additionally MUST NOT open `S/data/tidy/withdrawals_coop.csv` (Part W does not use it, and one
of its columns is free text written by an agency about river conditions).

You MUST NOT open: any `PLAN*.md`, `PLAN_AUDIT.md`, `TOOL_AUDIT.md`, anything in `S/research/`, any other
`.md` file under `S/replay/` or `S/tools/`, any other analyst's folder, any output that is not yours, and
nothing else in the repository. They contain other people's first guesses. If you opened one by mistake, say so
in your report.

No network. No installs. **Python: standard library only (numpy and pandas are not installed). R: base R only
(no data.table, no tidyverse).** If you need something that is missing, write it yourself and say so. Run
Python as `python3 -I`. Compute every moving average with a running sum, not by rescanning its window.

Everything outside your own output folder is read-only. No git commands that change anything.

## 2. Conventions

- **Times** are UTC, ISO 8601 ending in `Z`. Day blocks are UTC days. Cutoff of the study window:
  `2026-11-22T10:00:00Z` (readings after it, if any, are ignored).
- **Local time** (only where a spec asks for it): local = UTC minus 4 hours if the UTC time is before
  `2026-11-01T06:00:00Z`, otherwise UTC minus 5 hours. Use this rule; do not use a time-zone library.
- **CSV**: blank = missing; booleans 1/0; a few text fields are quoted because they contain commas; parse with
  a real CSV reader. Never treat a blank as zero.
- **Gauges** (column `gauge`): Point of Rocks `01638500`, Little Falls `01646500`, Monocacy `01643000`, Goose
  `01644000`, Broad Run `01644280`, Seneca `01645000`, Edwards Ferry `01644148`; upstream: Shepherdstown
  `01618000`, Hancock `01613000`, Paw Paw `01610000`, Millville `01636500`, Antietam `01619500`, Conococheague
  `01614500`, Opequon `01616500`, Catoctin `01637500`. **Parameters**: `00060` flow (cfs), `00065` water level
  (ft), `00010` water temperature (deg C).
- **Which readings table.** "Current" Point of Rocks flow and Little Falls flow: `readings_current_census.csv`
  (it spans 24 months and repeats rows of the model table; never union it with `readings_current_model.csv`
  without removing duplicates on `gauge, parameter, time_utc`). All other current series of the model gauges:
  `readings_current_model.csv`. Upstream gauges: `readings_current_upstream.csv`. "Old" values:
  `readings_old_archive.csv` (12 Jun to 9 Nov 23:55; it starts at 11 Jun 23:00; select by UTC time) and
  `readings_old_octpull.csv`. Within one table `gauge, parameter, time_utc` is unique.
- **Levels as integers.** Wherever levels are grouped or compared (bands, lookups), work with
  `round(level * 100)` as an integer number of hundredths of a foot; bands are half-open on those integers.
- **Runs.** `data/tidy/runs.csv`, rows with `used = 1` (275 rows), key `seq`. The values that actually ran are
  the logged ones in this table (`raw_cfs`, `final_cfs`, `corr_c`, `corr_st`, `corr_bin`, `ceil_lim`,
  `ceil_bound`, `delta_ratio`, `pre_cfs`, `trv_t`, `trv_gf2lf`, `trv_stop`, `hist_ago`, `hist_cfs`, `due_utc`,
  `at_utc`, `ver`, `src`). **"S0 logged" always means these columns of `runs.csv`.**
  `replay/out/replay_runs.csv` holds the replays, key `(seq, scenario)`, scenarios `S0`, `S-old-A`, `S-old-B`,
  `S-old-C`, `S-new`; there the same quantities are named `trv_t_h`, `trv_gf2lf_h`, `hist_ago_h`, and
  `iteration_limit` (1 = the travel-time loop ended at its limit, which in `runs.csv` is `trv_stop =
  max_iter`). Use the `S0` rows of the replay table only where a spec says "S0 replayed".
- **The flagged runs**: `gate_miss` exists only in the replay tables; take it from `labels.csv` by `seq`. It
  is non-blank for the used runs seq 136 (`temp_only`), 212 (`por_reading_rewritten`) and 217
  (`rise_rate_only`); a fourth flagged run, seq 147, is not a used run. For these runs USGS rewrote an input
  minutes after the job read it. Keep them in every analysis. Wherever a spec says "also without the two
  runs", repeat without seq 212 and 217. For seq 212 and 217 the `S0` rows of `replay_runs.csv` hold the
  replayed chain (from the rewritten reading); what actually ran is in `runs.csv`. Carry a `gate_miss` column
  in every per-run table you write.
- **Truth.** `replay/out/truth.csv`, key `(seq, scenario)`, column `t1_lf_cfs_interpolated` (called T1). The
  truth of an estimate is T1 of the same `(seq, scenario)`; for S0 logged use the row `(seq, S0)`.
  **Exception:** for seq 212 compute T1 of S0 logged yourself at `runs.due_utc`, by linear interpolation
  between the neighbouring non-blank Little Falls flow readings of `readings_current_census.csv` (the rule
  `truth.csv` uses), because its replayed due time differs from the one that ran; report both values in
  `REPORT.md`. Rows with a blank T1 (due time after the last frozen reading) are dropped and counted. For a
  cell of `replay_2x2x2.csv` with `old_rule = X`: T1 of `(seq, S-old-X)` if `due_from = old`, of `(seq,
  S-new)` if `due_from = new`.
- **Error** of an estimate E against truth T: `e = (E - T) / T * 100` (percent; positive = too high). Absolute
  error = `abs(e)`. `MAE` = mean absolute error.
- **Phases**, from `replay/out/labels.csv` (key `seq`), by the run that made the estimate, never by the time it
  was checked: `OLD` if `label_all_three = old`; `NEW` if `label_all_three = new`; `TRANS` otherwise. Report the
  number of runs and the first and last `seq` of each phase. The day of a run is the UTC day of its `at_utc`.
  A daily mean for a phase uses only that phase's runs; a day enters a per-phase regression or per-phase daily
  statistic only if it has at least 3 runs of that phase.
- **Checks** join to runs by `checks.predTs_utc = runs.final_ts_utc` (not by `at`). One check has no run in the
  log; list it.
- **Quantiles and medians**: linear interpolation between order statistics (R `quantile(type = 7)`; write the
  same rule in Python). Standard deviation: sample (n - 1). Rounding "half away from zero" where a spec says
  round.
- **Unit**: 1 MGD = 1.547229 cfs.
- **Least squares** means ordinary least squares with an intercept unless stated.

## 3. Series preparation (used by both parts)

For a series (one gauge, one parameter):

1. **Grid.** Prepare each series ONCE, over its preparation window: Part W, `2026-09-01T00:00:00Z` to
   `2026-11-22T10:00:00Z`; W3(4), `2026-06-12T00:00:00Z` to the cutoff; R4, `2026-08-31T00:00:00Z` to the
   cutoff; W7, the whole file. Select days or points from the prepared series afterwards; never re-prepare on
   a sub-window. The step is the most frequent difference between consecutive non-blank readings of the series
   inside the window (5, 15 or 60 minutes). The grid starts at the window start and includes every multiple of
   the step up to and including the window end (all grids are therefore anchored at 00:00 UTC). A grid point
   without a reading is filled by linear interpolation in time only if the gap between its neighbouring
   non-blank readings is at most 30 minutes (W7: at most 120 minutes, that is a single missing hour);
   otherwise it stays missing. Readings that are not on the grid are used only as neighbours for that
   interpolation. Report the step and the counts (present, filled, missing).
2. **Moving average** `MA(t)`: defined only if `t - 12 h` and `t + 12 h` both lie inside the preparation
   window and at least 95% of the grid points in the closed interval `[t - 12 h, t + 12 h]` (289 points at 5
   minutes, 97 at 15 minutes, 25 at 60 minutes) are non-missing; then the mean of the non-missing ones.
3. **Detrended series** `d(t) = x(t) - MA(t)`, where both exist.
4. **Day mean** of UTC day D: mean of the non-missing grid values with `D 00:00 <= t < D+1 00:00`, defined if
   at least 90% of the day's grid points are non-missing.
5. **Wave size (a)** of day D: `A_a(D) = (max d - min d) / 2` over the grid points of day D, defined if at
   least 95% of the day's `d` values exist. Relative size `A_a_rel = A_a / day mean` (flow series only;
   defined if both are).
6. **Wave size (b)** of day D: over the 72-hour window `[D-1 00:00, D+2 00:00)`, least-squares fit
   `x = a + b*tau + c*cos(2*pi*tau/24) + s*sin(2*pi*tau/24)` on the non-missing grid values, `tau` = hours
   since the window start, defined if at least 90% of the window's grid values are non-missing and the window
   lies inside the preparation window. `A_b = sqrt(c^2 + s^2)`; crest time of the fitted wave in UTC hours
   `phi_b = (atan2(s, c) * 24 / (2*pi)) mod 24` (result in `[0, 24)`).
7. **Crest and trough time** of day D, defined only if `A_a(D)` is defined: smooth `d` with a centred mean
   over 13 grid points if the step is 5 minutes, 5 points if it is 15 minutes, 3 points if it is 60 minutes
   (defined where all points exist); the crest is the time of the largest smoothed value among the grid points
   of day D, the trough the time of the smallest; ties go to the earliest. Give both as UTC hour-of-day
   (decimal hours) and as local hour-of-day.
8. **Event day** at a gauge: for a flow series, day D is an event day if
   `abs(MA(D+1 00:00) - MA(D 00:00)) / MA(D 00:00) > 0.10`; if either MA is undefined the day is treated as an
   event day. Level and temperature series take the flag of the same gauge's flow series; Edwards Ferry (level
   only) uses `abs(MA(D+1 00:00) - MA(D 00:00)) > 0.10` ft. "Non-event" below always means not an event day
   at the gauge of the series. A comparison between two gauges leaves out a day that is an event day at
   either.
9. **Circular mean** of hour-of-day values `h_i`: `(atan2(mean sin(2*pi*h_i/24), mean cos(2*pi*h_i/24)) * 24 /
   (2*pi)) mod 24`. A difference of two hours-of-day is taken into `(-12, 12]`. Circular standard deviation:
   `sqrt(-2 ln R) * 24 / (2*pi)`, R = the mean resultant length.
10. **Lagged correlation** `r(L)` of series x (upstream, or first-named) and y (downstream, or second-named),
    lag `L >= 0` meaning y later (a spec may also ask for negative lags): evaluate on the 5-minute grid if
    both series are 5-minute, otherwise on the 15-minute grid (every 15-minute grid point is also a 5-minute
    grid point; no interpolation between series). Where a spec asks for a lag step of 5 minutes with a
    15-minute series, first interpolate that series' detrended values linearly to the 5-minute grid between
    two non-missing neighbours 15 minutes apart, never across a missing value. The pairs used at lag L are all
    grid times `t` with `d_x(t)` and `d_y(t + L)` non-missing, the UTC day of `t` a non-event day for x and the
    UTC day of `t + L` a non-event day for y, and both days inside the analysis window named by the spec.
    `r(L)` is the Pearson correlation of those pairs, with means and standard deviations recomputed for each
    L; `n_points` is their number at the reported lag. A local maximum is an interior lag with
    `r(L) > r(L - step)` and `r(L) >= r(L + step)`; the two end lags are never local maxima. Ties for the
    largest r go to the smallest lag (smallest absolute lag where negative lags are asked, then the
    non-negative one).

## 4. Uncertainty

`S/data/tidy/boot_uniforms.csv`: 2,000 rows, columns `u1` to `u120`, numbers in `[0, 1)`. For a set of D
day-blocks sorted by date (assert D at most 60), resample `b` draws, for `k = 1..D`, the block with 0-based
index `floor(u_k * D)` using row `b`; a block drawn m times counts m times. For a second, separate group of D2
blocks in the same statistic (a difference between two groups; assert D2 at most 60), use columns `u61`
onward in the same way. In a two-group statistic the blocks of each group are the UTC days that contain at
least one row of that group; a drawn block contributes only that group's rows. The statistic is recomputed on
the pooled rows of the drawn blocks; validity thresholds (for example "hours with at least 3 runs") are
re-applied inside each resample. The interval is the 2.5th and 97.5th percentile (type 7) of the resampled
values; a resample whose statistic is undefined is skipped and counted, and if more than 5% are skipped the
interval is reported as blank together with the count. The block of a run is the UTC day of its `at_utc`; of
a day-level quantity, that day.

**Labels** (only where a spec asks for one). Let `[lo, hi]` be the interval of a difference `x` in points of
error. Its magnitude interval is `[min(abs lo, abs hi), max(abs lo, abs hi)]` if lo and hi have the same sign,
else `[0, max(abs lo, abs hi)]`. For a cycle row, the share `p = diff / c_ref`, where `c_ref` is the cycle of
`e_raw` of S0 logged in phase NEW, recomputed in the same resample (ratio per resample; resamples with `c_ref
= 0` are undefined); the magnitude interval of p is built the same way from its own `[lo, hi]`. A row is
labelled from its own quantity only (MAE rows from x, cycle rows from p): "matters" if the magnitude interval
lies at or above 1.0 point (MAE) or 10% (cycle); "does not matter" if it lies below 0.5 point or 5%; "small"
if it lies within `[0.5, 1.0)` or `[5%, 10%)`; otherwise "undetermined". A blank interval gives
"undetermined". Report the estimate and the interval in every case.

## 5. What you deliver

Your own folder under `S/`: `py_R/`, `r_R/`, `py_W/` or `r_W/`. In it:

- your scripts and a `README` saying how to run them from the study folder (one command);
- every table your spec names, as `tables/<name>.csv`, with exactly the columns listed, rows sorted by the key
  columns listed first, numbers written with at least 8 significant digits, no rounding of your own, times as
  ISO UTC, blank for undefined;
- `metrics.csv` with columns `question,group,metric,value` for every single number your spec names (`group`
  blank unless the spec names one);
- `REPORT.md`: what you ran, the row counts at every step, every ambiguity you met and how you resolved it,
  every place you could not do what the spec says. No interpretation.

Two analysts' tables are compared cell by cell: text, timestamps, counts and labels must be equal; numbers
must agree within 0.01 in the unit of the column (within 0.0001 for ratios and correlations). So follow the
recipes literally, and where a recipe is silent, choose the plainest reading and write it down.

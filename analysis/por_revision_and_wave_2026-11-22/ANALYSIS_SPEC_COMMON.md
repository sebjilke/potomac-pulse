# Analysis specification, common part (read this first)

Written by the orchestrator on 2026-11-23 (UTC), after the tool audit and BEFORE any study result was computed
or seen by the orchestrator. Four blind analysts work from it: Python and R on Part R (`ANALYSIS_SPEC_R.md`),
Python and R on Part W (`ANALYSIS_SPEC_W.md`). No analyst sees another's code or output. Analysts report
numbers and tables. They state no opinion on what a number means.

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
`.md` file under `S/replay/` or `S/tools/`, any other analyst's folder, any `*_python.*` or `*_R.*` output that
is not yours, and nothing else in the repository. They contain other people's first guesses. If you opened one
by mistake, say so in your report.

No network. No installs. **Python: standard library only (numpy and pandas are not installed). R: base R only
(no data.table, no tidyverse).** If you need something that is missing, write it yourself and say so. Run
Python as `python3 -I`.

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
- **Runs.** `data/tidy/runs.csv`, rows with `used = 1` (275 rows), key `seq`. The values that actually ran are
  the logged ones in this table (`raw_cfs`, `final_cfs`, `corr_c`, `corr_st`, `corr_bin`, `ceil_lim`,
  `ceil_bound`, `delta_ratio`, `pre_cfs`, `trv_t`, `trv_gf2lf`, `hist_ago`, `hist_cfs`, `due_utc`, `at_utc`,
  `ver`, `src`). **"S0 logged" always means these columns of `runs.csv`.** `replay/out/replay_runs.csv` holds
  the replays, key `(seq, scenario)`, scenarios `S0`, `S-old-A`, `S-old-B`, `S-old-C`, `S-new`. Use its `S0`
  rows only where a spec says "S0 replayed".
- **The flagged runs**: column `gate_miss` in the replay tables is non-blank for the used runs seq 136
  (`temp_only`), 212 (`por_reading_rewritten`) and 217 (`rise_rate_only`); a fourth flagged run, seq 147, is
  not a used run. For these runs USGS rewrote an input minutes after the job read it. Keep them in every
  analysis. Wherever a spec says "also without the two runs", repeat without seq 212 and 217. For seq 212 and
  217 the `S0` rows of `replay_runs.csv` hold the replayed chain (from the rewritten reading); what actually
  ran is in `runs.csv`. Carry a `gate_miss` column in every per-run table you write.
- **Truth.** `replay/out/truth.csv`, key `(seq, scenario)`, column `t1_lf_cfs_interpolated` (called T1). The
  truth of an estimate is T1 of the same `(seq, scenario)`; for S0 logged use the row `(seq, S0)`. Rows with a
  blank T1 (due time after the last frozen reading) are dropped and counted. For a cell of
  `replay_2x2x2.csv` with `old_rule = X`: T1 of `(seq, S-old-X)` if `due_from = old`, of `(seq, S-new)` if
  `due_from = new`.
- **Error** of an estimate E against truth T: `e = (E - T) / T * 100` (percent; positive = too high). Absolute
  error = `abs(e)`.
- **Phases**, from `replay/out/labels.csv` (key `seq`), by the run that made the estimate, never by the time it
  was checked: `OLD` if `label_all_three = old`; `NEW` if `label_all_three = new`; `TRANS` otherwise. Report the
  number of runs and the first and last `seq` of each phase.
- **Checks** join to runs by `checks.predTs_utc = runs.final_ts_utc` (not by `at`). One check has no run in the
  log; list it.
- **Quantiles and medians**: linear interpolation between order statistics (R `quantile(type = 7)`; write the
  same rule in Python). Standard deviation: sample (n - 1).
- **Unit**: 1 MGD = 1.547229 cfs.
- **Least squares** means ordinary least squares with an intercept unless stated.

## 3. Series preparation (used by both parts)

For a series (one gauge, one parameter) over a window:

1. **Grid.** Find the series' usual step: the most frequent difference between consecutive timestamps in the
   window (5 or 15 minutes). Build the regular grid of that step over the window. A grid point without a
   reading is filled by linear interpolation in time only if the gap between the neighbouring readings is at
   most 30 minutes; otherwise it stays missing. Report the step and the counts (present, filled, missing).
2. **Moving average** `MA(t)`: mean of the grid values with timestamps in the closed interval
   `[t - 12 h, t + 12 h]`. Defined only if at least 95% of the grid points in that interval are non-missing.
3. **Detrended series** `d(t) = x(t) - MA(t)`, where both exist.
4. **Day mean** of UTC day D: mean of the grid values with `D 00:00 <= t < D+1 00:00`, defined if at least 90%
   are non-missing.
5. **Wave size (a)** of day D: `A_a(D) = (max d - min d) / 2` over the grid points of day D, defined if at
   least 95% of the day's `d` values exist. Relative size `A_a_rel = A_a / day mean` (flow series only).
6. **Wave size (b)** of day D: over the 72-hour window `[D-1 00:00, D+2 00:00)`, least-squares fit
   `x = a + b*tau + c*cos(2*pi*tau/24) + s*sin(2*pi*tau/24)`, `tau` = hours since the window start, defined if
   at least 90% of the window's grid values exist. `A_b = sqrt(c^2 + s^2)`; crest time of the fitted wave in
   UTC hours `phi_b = (atan2(s, c) * 24 / (2*pi)) mod 24`.
7. **Crest and trough time** of day D: smooth `d` with a centred mean over 13 grid points if the step is 5
   minutes, 5 points if it is 15 minutes (defined where all points exist); the crest is the time of the largest
   smoothed value in day D, the trough the time of the smallest; ties go to the earliest. Give both as UTC
   hour-of-day (decimal) and as local hour-of-day.
8. **Event day** at a gauge: for a flow series, day D is an event day if
   `abs(MA(D+1 00:00) - MA(D 00:00)) / MA(D 00:00) > 0.10`; if either MA is undefined the day is "unknown" and
   is treated as an event day. Level series take the flag of the same gauge's flow series; Edwards Ferry (level
   only) uses `abs(MA(D+1 00:00) - MA(D 00:00)) > 0.10` ft. A comparison between two gauges leaves out a day
   that is an event day at either.
9. **Circular mean** of hour-of-day values `h_i`: `atan2(mean sin(2*pi*h_i/24), mean cos(2*pi*h_i/24)) * 24 /
   (2*pi) mod 24`. A difference of two hours-of-day is taken into `(-12, 12]`.

## 4. Uncertainty

`S/data/tidy/boot_uniforms.csv`: 2,000 rows, columns `u1` to `u120`, numbers in `[0, 1)`. For a set of D
day-blocks sorted by date (D at most 60), resample `b` draws, for `k = 1..D`, the block with 0-based index
`floor(u_k * D)` using row `b`; a block drawn m times counts m times. For a second, separate group of D2 blocks
in the same statistic (a difference between two groups), use columns `u61` onward in the same way. The
statistic is recomputed on the pooled rows of the drawn blocks. The interval is the 2.5th and 97.5th percentile
(type 7) of the 2,000 values; resamples where the statistic is undefined are skipped and counted. The block of
a run is the UTC day of its `at_utc`; of a day-level quantity, that day.

**Labels** (only where a spec asks for one), for a difference `x` in points of percent error, or a share `p` of
the daily error cycle's size: "matters" if the whole interval of `abs(x)` lies at or above 1.0 point, or the
whole interval of `p` at or above 10%; "does not matter" if the whole interval of `abs(x)` lies below 0.5 point
and that of `p` below 5%; "small" if the whole interval lies between those; otherwise "undetermined". Report
the estimate and the interval in every case.

## 5. What you deliver

Your own folder under `S/`: `py_R/`, `r_R/`, `py_W/` or `r_W/`. In it:

- your scripts and a `README` saying how to run them from the study folder (one command);
- every table your spec names, as `tables/<name>.csv`, with exactly the columns listed, rows sorted by the key
  columns listed first, numbers written with at least 8 significant digits, no rounding of your own, times as
  ISO UTC, blank for undefined;
- `metrics.csv` with columns `question,group,metric,value` for every single number your spec names;
- `REPORT.md`: what you ran, the row counts at every step, every ambiguity you met and how you resolved it,
  every place you could not do what the spec says. No interpretation.

Two analysts' tables are compared cell by cell: text, timestamps, counts and labels must be equal; numbers
must agree within 0.01 in the unit of the column (within 0.0001 for ratios and correlations). So follow the
recipes literally, and where a recipe is silent, choose the plainest reading and write it down.

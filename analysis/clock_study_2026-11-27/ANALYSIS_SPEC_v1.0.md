# Analysis specification: the clock study (version 1.0)

Version 1.0, 2026-11-27, written BEFORE any analyst started and before any lag, correlation or share was computed on the real data.
It turns the method of the study into exact arithmetic. Two analysts, one in Python and one in R, work from THIS FILE and the data files named in section 1 ONLY. They cannot see each other. The aim is output files that are byte for byte identical. Every number must agree within 0.01.

**Blindness.** Do NOT read any other file in the study folder `analysis/clock_study_2026-11-27/` except this one and the data file named in 1.4, nor any other study folder, nor the other analyst's folder. Nothing in this file is a result or an expectation. You state no opinion on what any number means. The cells and the verdict (section 13) are computed mechanically and written to files. The counts named "expected" in sections 5, 15 and 17 are counts of how many rows or units a rule yields; they are checks on your reading of the rules, not findings.

If this file is silent or unclear on a point, do not guess in your own way: make the most literal and simplest choice, and write it in your `REPORT.md` under "Judgment calls".

## 0. Environment

- Python: Python 3.14 (as installed), standard library only (no numpy, no pandas). Run every script as `python3 -I script.py`. `-I` removes the script's folder from the import path: use one single-file script, or insert the folder in `sys.path` yourself. Never use `sum()`, `math.fsum` or `statistics.*` (see 3.1).
- R: R 4.5.2, base R only (packages base, stats, utils; the package `tools` only for the one call `tools::sha256sum`). Run as `Rscript --vanilla r/run_all.R`. First line of the script: `Sys.setlocale("LC_COLLATE", "C")`.
- Write ONLY into your own folder inside the study folder `analysis/clock_study_2026-11-27/`: `py/` (Python) or `r/` (R). Everything else is read-only. No network. No installs.
- Read only: this file and the input files of section 1.
- Do not use `round()` in either language anywhere in the rules (R rounds halves to even). The only rounding is `floor(x + 0.5)` where a rule asks for it.
- Read every input file as TEXT first and convert numbers yourself (Python `float(s)`, R `as.numeric(s)`); a blank field (the empty string) is missing and never becomes 0. The files are unquoted and no field contains a comma.
  - Python: the `csv` module with `newline=''`; strip a trailing `\r` if present (the files use `\n`).
  - R: read the hourly file, the rise list and the Difficult Run file with `readLines` and split each line with `strsplit(line, ",", fixed = TRUE)` after appending one sentinel character to the line (`strsplit` drops a trailing empty field), or any equivalent way; a blank field must stay a blank field and the field count must be exact. Read the replay file `shadow_L.csv` (110 MB) with `read.csv(header = TRUE, colClasses = <"character" for the 3 columns of 1.3, "NULL" for all others>, quote = "", comment.char = "", na.strings = character(0), stringsAsFactors = FALSE)`; to count its fields per line use `count.fields(path, sep = ",", quote = "", comment.char = "", blank.lines.skip = FALSE)` (it includes the header line, which is not a data row). Use vectors, not row loops over a data frame.
- **R index trap.** A vector index of 0 or a negative index does not mean "missing" in R. Every look-up of a series at an hour key goes through ONE function that returns missing for a key outside the array (2.3). Pad the arrays with 300 missing hours on each side, or test the bounds.
- **Speed.** The study has about 225 windows, 5 versions and up to 73 shifts: some 100,000 small correlations. In R build the dense arrays and the change arrays ONCE (2.3, 3.4), then for one window and one shift cut two vectors by index arithmetic and call `sum()` on plain double vectors. Do not loop over a data frame, do not rebuild anything per shift, and do not call `cor()` or `lm()`. The Theil and Sen bootstrap (section 10) is 5 fits times 10,000 draws; in R build the pairwise differences of a draw with `outer()` and keep the upper triangle; in Python use two nested loops over lists. Expected run time: under 30 minutes in each language.
- One command rebuilds all your outputs from the raw files: `python3 -I py/run_all.py` or `Rscript --vanilla r/run_all.R`, run from the study folder. Put a short `README.md` in your folder.
- Also write `REPORT.md` in your folder with the headings: `## What was run`, `## Row counts`, `## Judgment calls`, `## Deviations from the specification`, `## Checks`. No opinion on what the numbers mean.

## 1. Inputs

### 1.1 Files (paths relative to the study folder `analysis/clock_study_2026-11-27/`)

| Role | Path | Facts |
|---|---|---|
| Hourly record | `../rising-limb-travel-backtest/hourly_backtest_data_v39.csv` | 130,416 data rows, 12 columns, LF line ends, 10,133,893 bytes. SHA-256 `d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f`. Header `timestamp,por_now,por_lagged,ef_stage,lf_discharge,lf_stage,water_temp_c,monocacy,goose,broad_run,seneca,travel_time_h`. Not a complete hourly grid. |
| Rise list | `../rising-limb-travel-backtest/rising_limb_events_python_v39.csv` | 87 data rows, 47 columns, LF line ends, 24,205 bytes. SHA-256 `978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44` |
| Replay of the app | `../onset_correction_2026-11-25/replay_L/shadow_L.csv` | 130,987 data rows, 87 columns, LF line ends, 109,952,178 bytes. SHA-256 `dcc63931841b537a834962b9a7c60e6edfd3b72b8bd491b43af89bbba0ba5aba` |
| Difficult Run record | `data/difficult_run_hourly.csv` | see 1.4. May be absent. |

Python analyst: compute the SHA-256 (`hashlib`) of each file that exists and stop on a mismatch. R analyst: `tools::sha256sum`; also check the byte sizes. Both: check the row counts (checks C01 to C04 of section 15).

### 1.2 Columns used

- Hourly record: `timestamp, por_now, ef_stage, lf_discharge, lf_stage, monocacy, goose, broad_run, seneca` (9 columns). `por_lagged`, `water_temp_c`, `travel_time_h` are not used. Header names exact, case sensitive, each exactly once.
- Rise list: `onset_no, onset_t0, onset_tp, event_id, event_t0, event_tp, event_class` (7 columns; the other 40 are not used).

### 1.3 Replay file

Three columns are used: `predTs` (text, fixed form `YYYY-MM-DDTHH:00:00.000Z`, 24 characters), `status` (text) and `travelGFtoLF` (number, parsed as a 64-bit floating point number). No other column is used.

### 1.4 The Difficult Run record (the contract)

`data/difficult_run_hourly.csv` is built by another process. Its contract:

- Header exactly `timestamp,dr_discharge`.
- A complete hourly grid: 130,987 data rows, the stamps `YYYY-MM-DD HH:MM` in UTC (minutes `00`) from `2011-12-01 05:00` to `2026-11-09 23:00`, one row per hour, each stamp exactly one hour after the previous one (hour keys 367,421 to 498,407, 2.1).
- `dr_discharge` is empty (no reading) or a number matching `^[0-9]+(\.[0-9]+)?$` (cubic feet per second, zero or above).
- LF line ends, no quotes.

`DR_SHA256: <<PLACEHOLDER: the orchestrator writes the SHA-256 of the file here before the analysts start>>`

**If the file is absent** (the path does not exist): the Difficult Run check and the creek's part in the creek share are dropped. Concretely: (a) section 11 is not run and `dr_units.csv` holds one marker row (section 17); (b) in section 6 the lower leg uses Seneca and Broad Run only, with gauged drainage `101.0 + 76.1` (177.1), and the whole reach uses Monocacy, Goose Creek, Seneca and Broad Run with gauged drainage `((817.0 + 332.0) + 101.0) + 76.1`; (c) the short end of the clock never uses the Difficult Run rule (section 12); (d) `dr_present` is 0 in `row_accounting.csv`, `dr_summary.csv` and `decision.csv`; (e) check C04 has `n_checked` 0 and `n_violations` 0. Nothing else changes.
**If the file is present**, it must meet the contract above and its SHA-256 must equal the value written on the line above; a placeholder never matches, so a present file with a placeholder line stops the run at C00 (write `checks.csv` as in section 15). A present file that violates the contract stops the run at C04.

## 2. Parsing, time, arrays

### 2.1 Hour key, weeks, periods

All times are UTC. The **hour key** of a stamp `YYYY-MM-DD HH:MM` (hourly, rise-list and Difficult Run files; minutes must be `00`) or of `YYYY-MM-DDTHH:00:00.000Z` (replay `predTs`) is `K = days_from_civil(Y, M, D) * 24 + HH`, all integers, with this integer algorithm (floor division on integers; Python `//`, R `%/%`):
`y = Y - (M <= 2 ? 1 : 0); era = y // 400; yoe = y - era * 400; doy = (153 * (M + (M > 2 ? -3 : 9)) + 2) // 5 + D - 1; doe = yoe * 365 + yoe // 4 - yoe // 100 + doy; days = era * 146097 + doe - 719468`.
No library time function is used. Test values: `K(1970-01-01 00:00) = 0`, `K(2020-01-01 00:00) = 438288`, `K(2012-12-01 00:00) = 376200`, `K(2019-12-31 23:00) = 438287`, `K(2026-11-09 23:00) = 498407`, `K(2011-12-01 05:00) = 367421`, `K(2015-06-20 12:00) = 398556`. The replay form `2015-06-20T12:00:00.000Z` has the same key as `2015-06-20 12:00`.

A lag is a number of hours. The hourly values of all gauges stand for the same part of their hour; no half-hour correction is applied anywhere.

**Week of an hour.** Weeks run Monday 00:00 to Sunday 23:00 UTC. For an hour key `h` (integer, any sign): week index `w(h) = ((h // 24) + 3) // 7` (floor division) and week start `ws(w) = (7 * w - 3) * 24`; the week of index `w` is the 168 hours `ws(w)` to `ws(w) + 167`. (1970-01-01 was a Thursday; index 0 is the week starting Monday 1969-12-29, key -72.) Test values in section 14.

**Periods.** A unit belongs to `pre2020` when its window start `a` (5.2) is below 438288, else to `from2020`.

### 2.2 The hourly record

Parse every data line (12 fields, blank stays blank). `K` of column `timestamp`. The record spans keys `K0 = 367421` to `K1 = 498407` (130,987 hours); 130,416 of them have a row, the others are gaps. Check C01.

### 2.3 Dense arrays

For each column used (and for the Difficult Run flow when present) build an array of 130,987 doubles indexed by `h - K0`, missing where the hour has no row or the field is blank. The function `val(series, h)` returns the value, or missing for `h < K0` or `h > K1`. "Present" means not missing. Every look-up in this study uses `val`.

### 2.4 The rise list

Parse every data line (47 fields). A row is a **small onset** when its `event_class` is the empty string (33 rows expected); other rows belong to an **event**. Events: the distinct values of `event_id` over the rows whose `event_class` is not empty (53 expected; one event has two rows). The event's row is its FIRST row in file order; take `event_t0` and `event_tp` from it (check C02: every row of the same `event_id` has the same `event_t0` and `event_tp`). All time columns used (`onset_t0`, `onset_tp` of small onsets; `event_t0`, `event_tp` of events) have the form `YYYY-MM-DD HH:00`.

### 2.5 The replay file

Only `predTs`, `status` and `travelGFtoLF`. `K(predTs)` of every row; the keys must be exactly `K0, K0 + 1, ..., K1` in file order (C03).

## 3. Basic functions (the same in both languages; made-up tests in section 14)

### 3.1 Sums, medians, percentiles

- **Sums** are plain left-to-right loops: `s = 0.0`, then `s = s + x` for each term in the stated order. Python: an explicit loop. R: an explicit loop or `sum()` on a plain double vector in that order. A mean is that sum divided by the count. Never `mean()`, `fsum`, `%*%`, `crossprod`, `colSums`.
- **Median** of a list of `n >= 1` numbers: sort ascending `x[0..n-1]`; odd `n`: `x[(n-1)/2]`; even `n`: `(x[n/2 - 1] + x[n/2]) / 2.0`.
- **Percentile** `p` of `m >= 1` numbers (used for the 25th and 75th percentile and for the bootstrap): sort ascending `x[0..m-1]`; `pos = (m - 1) * p` (double), `i = floor(pos)`, `frac = pos - i`, value = `x[i] + frac * (x[i + 1] - x[i])`; if `i + 1 > m - 1` the value is `x[i]`. By hand in both languages (no `quantile`).

### 3.2 Correlation

`pearson(xs, ys)` of two equal-length lists in a given order, `n` = their length: `mx = Sx / n`, `my = Sy / n` (sums as in 3.1); `sxx` = sum of `dx * dx`, `syy` = sum of `dy * dy`, `sxy` = sum of `dx * dy`, where `dx = x - mx`, `dy = y - my`; if `sxx <= 0.0` or `syy <= 0.0` the correlation is undefined; else `r = sxy / sqrt(sxx * syy)`. Two passes, never the one-pass shortcut.

### 3.3 The parabola

For a best shift `s` with neighbours `r_m` (at `s - 1`), `r_0` (at `s`), `r_p` (at `s + 1`): `den = (r_m - 2.0 * r_0) + r_p`; if `den == 0.0` then `delta = 0.0`, else `delta = (0.5 * (r_m - r_p)) / den`; then clip: `delta = max(-0.5, min(0.5, delta))`. The refined lag is `s + delta`.

### 3.4 Changes and the lag of a window (XC)

Series are the version series of section 4. The **change** of a series at hour `t` is `x(t) - x(t - 1)`, present only when both hours are present; no gap is filled.

`XC(up, down, a, b, smin, smax)`: for every integer shift `s` from `smin` to `smax`, in ascending order, take the pairs `(cu, cd)` for every hour `t = a + 1, ..., b` (ascending) at which the change of `down` at `t` and the change of `up` at `t - s` are both present: `cd` = change of `down` at `t`, `cu` = change of `up` at `t - s`. `n(s)` = number of pairs. The shift is **eligible** if `n(s) >= 24` and `pearson` (of the `cu` list against the `cd` list, in `t` order) is defined; its correlation is `r(s)`. (The upstream hours `t - s` and `t - s - 1` may lie before the window: the window is the downstream window and the upstream series is shifted, not the window.)
- If no shift is eligible: status `no_eligible`.
- **Best shift** `sb`: the eligible shift with the highest `r(s)`; scan the shifts in ascending order and replace the best only when `r(s)` is strictly greater (ties: the smallest shift).
- If `sb == smin` or `sb == smax`: status `end` (the maximum is at an end of the range).
- Else if shift `sb - 1` or `sb + 1` is not eligible: status `neighbour`.
- Else status `ok`: `delta` by 3.3 from `r(sb - 1)`, `r(sb)`, `r(sb + 1)`; `lag = sb + delta`; `r = r(sb)`; `npairs = n(sb)`.
- **Gates.** A unit with status `ok` passes the gate `g` (0.4, 0.5, 0.6, 0.7) when `r >= g` (the unrounded double against the literal). Flags `g40, g50, g60, g70`. The clock uses `g60`.
- **Whole-hour closeness.** A lag is within a tenth of a whole hour when `abs(lag - floor(lag + 0.5)) <= 0.1`.

## 4. Series, pairs and versions

Define these hourly series from the dense arrays (missing in, missing out):
- `EFQ(h) = 126.0 * ef_stage(h) ^ 2.46` (Python `126.0 * (ef ** 2.46)`; R `126 * ef^2.46`), present when `ef_stage` is present.
- `LNEF(h) = ln(ef_stage(h))`, `LNLF(h) = ln(lf_discharge(h))` (natural logarithm; every present value is above 0, check C01).

The five **versions** (order fixed; `up` is the upstream series, `down` the downstream one):

| id | pair | up | down | leg for the creek share |
|---|---|---|---|---|
| `LOW_P` | Edwards Ferry to Little Falls, primary: stage, raw | `ef_stage` | `lf_stage` | lower |
| `LOW_A` | same pair, sensitivity A: flows | `EFQ` | `lf_discharge` | lower |
| `LOW_B` | same pair, sensitivity B: natural logs | `LNEF` | `LNLF` | lower |
| `UPP` | Point of Rocks to Edwards Ferry | `por_now` | `EFQ` | upper |
| `WHO` | Point of Rocks to Little Falls | `por_now` | `lf_discharge` | whole |

Shift range of a window: `smin = 0`; `smax = 72` when the window is a bump window or the version is `WHO`, else `smax = 48`.

## 5. Units and windows

### 5.1 Start of the rising limb

`LF(h)` always means `val(lf_discharge, h)`. For an onset hour `o`: look at the hours `o - 47, ..., o` (the 48 hours ending at `o`, both ends included); keep those where `LF` is present; if none, the start is undefined; else `m` = the minimum of those values and the start `s` = the LAST (largest) hour among them whose value equals `m` exactly.

### 5.2 Rise units

1. **Event units** (53 expected): one per event, in file order of the events' first rows. Onset `o = K(event_t0)`, peak `p = K(event_tp)`. Id `E<event_id>`.
2. **Small-onset units**: one per small-onset row, in file order. Onset `o = K(onset_t0)`, peak `p = K(onset_tp)`. Id `S<onset_no>` (text as written). A small onset is KEPT only under the 30% rule: its start `s` is defined, `LF(p)` is present, and `LF(p) >= 1.3 * LF(s)` (the product first, then the comparison). Small onsets that fail are dropped and counted (`small_no_peak` when `LF(p)` is missing, `small_under30` when the rule fails; an undefined start is counted in `unit_no_start`).
3. For every unit the start `s` is by 5.1 with its onset `o`. An event unit whose start is undefined is dropped and counted in `unit_no_start`. Check C06: `s <= p`.
4. **Window** (downstream time): `a = s - 6`, `b = p + 6`, `n_hours = b - a + 1`.
5. **Flow of a unit** `Q` = the median (3.1) of the present values of `LF(h)` for `h = a, ..., b`. **Flow class**: `lt3000` if `Q < 3000`; `3000-6000` if `Q < 6000`; `6000-12000` if `Q < 12000`; `12000-25000` if `Q < 25000`; else `ge25000` (each class includes its lower edge).
6. The units that remain are the **rise units**, kind `event` or `small` (86 expected: 53 and 33).

### 5.3 Bumps (low-flow rises found in the hourly record)

One deterministic scan of the Little Falls series `LF`.

1. **Candidate peaks.** For every hour `p` from `K0` to `K1` (ascending) with `LF(p)` present, `v = LF(p)`, all of these:
   a. `v < 6000`.
   b. `p` is the first hour of a local maximum over 24 hours each side: every present `LF(q)` with `q = p - 24, ..., p - 1` is `< v` (strict), and every present `LF(q)` with `q = p + 1, ..., p + 24` is `<= v`. (Missing hours are skipped; a flat top counts at its first hour.)
   c. At least 36 of the 48 hours `p - 47, ..., p` have `LF` present.
   d. The start `s` by 5.1 with onset `p` (defined by c); the base `m = LF(s)`; `m < 3000`.
   e. `v >= 1.4 * m` (the product first, then the comparison).
   A candidate has the window `a = s - 6`, `b = p + 6`. Candidates in ascending `p`. (103 expected.)
2. **Overlap rule.** A candidate is dropped (reason `overlap`) when its window `[a, b]` shares at least one hour with the window of any rise unit of 5.2 (all event units and all kept small-onset units). (1 expected.) This is done BEFORE the spacing rule, so a dropped candidate never suppresses a neighbour.
3. **Spacing rule** (keep the higher peak). Take the remaining candidates, sort by value `v` descending, ties by `p` ascending; go through them in that order and accept a candidate only if its `p` differs by at least 96 hours (`abs(p - q) >= 96`) from the `p` of every candidate already accepted; otherwise drop it (reason `spacing`). (16 expected.)
4. The accepted candidates are the **bump units** (86 expected), in ascending `p`. Id `B<p>`; kind `bump`; onset = peak = `p`; start `s`; window `a, b`; `Q` and flow class as in 5.2 point 5.

`bumps.csv` lists all 103 candidates with their status (`kept`, `overlap`, `spacing`).

### 5.4 Recession windows (description only)

One per EVENT unit (53 expected), id `R<event_id>`, kind `recession`: `a = p - 6`; `b = p + 72`; let `nx` be the smallest window start `a'` among all rise units and all bump units with `a' > p - 6`; if one exists, `b = min(b, nx - 1)`. `Q` and class as in 5.2 point 5. (`recession_cut` in section 17 counts windows with `b < p + 72`; 0 expected.) Recessions have no start, no onset, no creek share and no cluster.

### 5.5 Low-water weeks

Take every week index `w` with `ws(w) >= K0` and `ws(w) + 167 <= K1` (complete weeks inside the record; 779 expected). In this order, drop a week (and count by reason) when:
1. fewer than 152 of its 168 hours have `LF` present (`lf_coverage`; 37 expected);
2. the median (3.1) of its present `LF` values is not below 3000 (`median`; 567 expected);
3. its 168 hours share at least one hour with the window of any rise unit, any bump unit or any recession window (`overlap`; 75 expected).
The rest are the **low-water weeks** (100 expected), id `W<w>`, with `Q` = that median. Week class: `lt1500` if `Q < 1500`; `1500-2000` if `Q < 2000`; else `2000-3000` (17, 30 and 53 expected).

### 5.6 Use of a window for a version

For a window `[a, b]` with `n = b - a + 1` hours and a version with series `up`, `down`: `cu` = number of hours `h` in the window with `up(h)` present; `cd` = same for `down`; `cb` = number of hours with both present. The window is **used** for the version when `10 * cu >= 9 * n` and `10 * cd >= 9 * n` and `cb >= 24`. A window that is not used has status `data`. For a low-water week the same with `n = 168`. `n_both = cb`.

### 5.7 Clusters (for the bootstrap)

Cluster of each unit of 5.2 and 5.3 (recessions and weeks have none):
- an event unit: its own cluster (`E<event_id>`);
- a kept small-onset unit: the event unit whose window shares the most hours with its window (hours in common: `max(0, min(b, b') - max(a, a') + 1)`; ties: the earlier event in the order of 5.2); if the most is 0 it is its own cluster (`S<onset_no>`);
- a bump: its own cluster (`B<p>`).
Cluster order (fixed): the 53 event clusters in event order, then the singleton clusters (small-onset units that joined no event, and bumps) sorted by `a` ascending, ties by id text in C locale. Expected: 6 small onsets join an event, 27 stand alone, 86 bumps: 166 clusters.

## 6. Creek share (rise units and bump units only)

Gauged creek series (hourly record columns): Seneca `seneca` 101.0 sq mi, Broad Run `broad_run` 76.1, Difficult Run `dr_discharge` 57.8 (only when the Difficult Run file is present), Monocacy `monocacy` 817.0, Goose Creek `goose` 332.0.
Legs: **lower** = Seneca, Broad Run, Difficult Run; local drainage 430.0. **Upper** = Monocacy, Goose Creek; local drainage 1479.0. **Whole** = all five; local drainage 1909.0. Gauged drainage of a leg = the sum of its creeks in the order listed (lower `(101.0 + 76.1) + 57.8`; upper `817.0 + 332.0`; whole `(((817.0 + 332.0) + 101.0) + 76.1) + 57.8`; without Difficult Run see 1.4).

For a unit with window `[a, b]` and a leg:
- `Slf` = the sum, over the hours `h = a, ..., b` at which `LF(h)` is present, of `max(0.0, LF(h) - LF(h0))`, where `h0` is the first hour of the window with `LF` present.
- For each creek of the leg the same sum `Sc` with its own series and its own first present hour `h0`. `Screeks` = the sum of the `Sc` in the order listed above.
- A series has **enough data** when 90% of the window hours are present (`10 * count >= 9 * n_hours`). If any creek of the leg, or `LF`, lacks enough data, or `Slf <= 0.0`, the share is undefined: creek status `unknown`.
- Else `share = (Screeks * (local / gauged)) / Slf` (the division local / gauged first, then the product, then the division), and the creek status is `heavy` if `share > 0.15`, else `clean`.
A version uses the share of its leg (section 4). Recession windows and weeks have creek status `na` (counted as clean in the summaries). The three shares of a unit are written in `units.csv`.

## 7. The lag of a unit and its parts

### 7.1 XC of a unit

For every window of 5.2, 5.3 and 5.4 (rise, bump, recession; not weeks) and every version in order: if not used (5.6) status `data`; else `XC(up, down, a, b, 0, smax)` of 3.4. Result fields: `status` (`data`, `no_eligible`, `end`, `neighbour`, `ok`), `s_best` (`sb`; also given for `end` and `neighbour`, blank for `data` and `no_eligible`), `n_pairs`, `r`, `delta`, `lag` (blank unless `ok`), flags `g40..g70` (blank unless `ok`).

### 7.2 The parts of a rise (unit-versions with status `ok` only)

`sb` = the integer best shift (not the refined lag). The **downstream window** is `[a, b]` on `down`; the **upstream window** is `[a - sb, b - sb]` on `up`. For a series and its window: `hs` = the ascending present hours, `vs` their values; the parts are computed only when both windows have enough data (`10 * count >= 9 * n_hours`), else parts status `data`. `v0` = the value at the first present hour; `mx` = the maximum of `vs`; **rise in the window** = `mx - v0`; if either rise is `<= 0.0` parts status `no_rise`. Otherwise for `f` in 0.1, 0.5, 0.9: `level = v0 + f * rise`; find the first index `j >= 1` with `vs[j] >= level`; the **crossing time** is `hs[j-1] + ((level - vs[j-1]) / (vs[j] - vs[j-1])) * (hs[j] - hs[j-1])` (linear between consecutive PRESENT hours, even across a gap); if `vs[0] >= level` the crossing time is `hs[0]`. The **crest** is the first hour of the maximum (scan ascending, replace only when strictly greater). Times are absolute hour keys (the upstream times are read as they are, not moved forward). `lag10 = down10 - up10`, `lag50`, `lag90` likewise; `lagcrest = down crest - up crest` (an integer). Parts status `ok` when all are defined. Parts are computed for every `ok` unit-version whatever its gate; the summaries use them only for units that pass `g60` and are clean.

## 8. Class summaries (`class_summary.csv`)

Groups (in order): `event`, `small`, `bump`, `all_rise` (the three together), `recession`. Classes (in order): `all`, `lt3000`, `3000-6000`, `6000-12000`, `12000-25000`, `ge25000` (class of the unit's `Q`; `all` = every class). For each version in order, each group, each class (5 x 5 x 6 = 150 rows), over the units of that group and class:
- `n_units`: units in the group and class (before any use rule); `n_used`: status not `data`; `n_ok`: status `ok`.
- `n_g40, n_g50, n_g60, n_g70`: units with status `ok` and that gate flag 1.
- A unit is **clean** when its creek status for the version's leg is `clean` or `na`; **heavy** when `heavy`; **unknown** when `unknown`.
- `n_g60_heavy`, `n_g60_unknown`, `n_g60_clean`: the `g60` units by creek status.
- `med_g40, med_g50, med_g60, med_g70`: median (3.1) of `lag` over the clean units that pass that gate.
- `q1_g60, q3_g60`: 25th and 75th percentile (3.1) of `lag` over the clean `g60` units.
- `med_g60_all`: median of `lag` over all `g60` units whatever their creek status ("without the cut").
- `share_whole_g60`: among the clean `g60` units, `count / n_g60_clean` (`%.6f`) of those whose `lag` is within a tenth of a whole hour (3.4).
- `n_parts`, `med_lag10, med_lag50, med_lag90, med_lagcrest`: over the clean `g60` units whose parts status is `ok`: their count and the medians of the four part lags.
A statistic over an empty set is blank.

## 9. Low water

### 9.1 Detrended levels

For a series `x` (a version's `up` or `down`, over the whole record, not clipped to a week): `det(h)` = `x(h) - mean`, where `mean` is the sum (3.1, hours ascending) of the present values of `x(q)` for `q = h - 12, ..., h + 12` divided by their count; `det(h)` is missing when `x(h)` is missing or fewer than 19 of those 25 hours are present. Build the `det` arrays once.

### 9.2 Phase of a week

For each low-water week and each version (5.5; 100 x 5 = 500 rows, weeks ascending, versions in order): if the week is not used for the version (5.6 with `n = 168`, on the raw series) status `data`. Else for each shift `s = 0, ..., 23`: the pairs are, for every `t = ws, ..., ws + 167` (ascending) with `det_down(t)` and `det_up(t - s)` both present, `(det_up(t - s), det_down(t))`; the shift is eligible when there are at least 24 pairs and `pearson` is defined (levels, not changes). Best shift `sb` = the eligible shift with the highest correlation (ascending scan, replace only on strictly greater). No eligible shift: status `no_eligible`. The neighbours are `(sb - 1) mod 24` and `(sb + 1) mod 24` (wrap-around, non-negative `mod`); if either is not eligible: status `neighbour`. Else status `ok`: `delta` by 3.3 with `r_m = r((sb - 1) mod 24)`, `r_0`, `r_p = r((sb + 1) mod 24)`, and `phase = sb + delta`; if `phase < 0` add 24; if `phase >= 24` subtract 24. `gate50 = 1` when status is `ok` and `r >= 0.5`, else 0: the week **passes**.

### 9.3 Class phase

For each version and each week class (`lt1500`, `1500-2000`, `2000-3000`): the weeks of that class that pass. If there are at least 5: the **circular median** and **circular spread** of their phases, else both blank.
Circular distance `cd(a, b) = min(abs(a - b), 24.0 - abs(a - b))`. Circular median: sort the phases ascending; for each phase `c` in that order `D(c)` = the sum (3.1, in the sorted order) of `cd(c, phase)` over all phases; `best` = the first phase, `Dbest = D(first)`; for each next `c`: if `D(c) < Dbest - 1e-9` then `best = c`, `Dbest = D(c)`. Circular spread: the median (3.1) of `cd(phase, best)` over all phases.

### 9.4 Whole days from the bumps, the low-water lag, the chain check

For each of the three pairs `LOW_P`, `UPP`, `WHO` (the primary version of each pair): `nb` = the number of bump units whose status for that version is `ok`, that pass `g60` and are clean; `Mb` = the median of their `lag` when `nb >= 3`, else blank. For each week class where the circular median `phi` is defined and `Mb` is defined: `k` = the whole number in {0, 1, 2} that minimises `abs((phi + 24.0 * k) - Mb)` (ties: the smaller `k`); low-water lag `L = phi + 24.0 * k`; bounds `lo = max(0.0, L - spread)`, `hi = L + spread`. Otherwise `k`, `L`, `lo`, `hi` are blank.
**Chain check** per week class: defined when `L` is defined for `LOW_P`, `UPP` and `WHO`: `sum = L(UPP) + L(LOW_P)`; `diff = abs(sum - L(WHO))`; `pass = 1` when `mic(diff) <= 3000000` (the written form of `diff`, section 16), else 0. When not defined, blank.
The low-water lag of a class is **settled** (for `LOW_P`) when the chain check of that class has `pass = 1`.

## 10. Lag against flow

### 10.1 Points

For each version, the **points** of a fit are the units of kind `event`, `small` or `bump` with status `ok`, flag `g60 = 1` and clean creek status for that version's leg. For each point: `Q` (5.2 point 5), `x = ln(Q)`, and `y = ln(lag')` where `lag' = lag` if `lag > 0.05` else `0.05`; `n_floor` counts the points where `lag <= 0.05`. Each point has its cluster (5.7) and its period (2.1). A fit uses the points of one period: `all` (every point), `pre2020`, `from2020`. `qmin`, `qmax` = the smallest and the largest `Q` among the points of the fit. Points are kept in the unit order of `units.csv`.

### 10.2 Theil and Sen

`TS(points)`: `n` = number of points; the slopes are `(y_j - y_i) / (x_j - x_i)` for every pair `i < j` (point order) whose `Q` values are different as doubles (pairs with equal `Q` are skipped; the test is on `Q`, before the logarithm); if `n < 5` or there is no slope, the fit is blank. `B` = the median (3.1) of the slopes. `A` = the median of `y_i - B * x_i` over all the points. The fitted lag at a flow `F` is `exp(A + B * ln(F))`. `nslopes` = number of slopes.

### 10.3 Bootstrap over clusters (all-years fits only)

For each version, one bootstrap of the `all` fit. `m` = the number of clusters (in the fixed cluster order of 5.7) that have at least one point of this fit; `cl[0..m-1]` that ordered list. Generator (an integer recurrence, exact in doubles): `x = 20261127`; this seed is used afresh at the start of each fit's bootstrap. For draw `d = 1, ..., 10000` and for `j = 1, ..., m`: `x = (48271 * x) mod 2147483647` (`48271 * x < 2^53`, so it is exact in Python integers and in R doubles; R `%%`), `idx = (x * m) // 2147483647` (R `%/%`; an integer from 0 to `m - 1`). The draw is the list of points of the clusters `cl[idx_1], ..., cl[idx_m]` (each time a cluster is drawn all its points are taken, in unit order). A draw is **skipped** (counted in `n_skipped`) when it has fewer than 5 points or no slope. Otherwise compute `B_d`, `A_d` by 10.2. Record for each valid draw `B_d` and, for each flow `F` of the list in 10.4, `exp(A_d + B_d * ln(F))`. `n_valid = 10000 - n_skipped`. If `n_skipped > 500` or the full-data fit is blank, every bound is blank. Otherwise each bound is the percentile 0.025 (`lo`) or 0.975 (`hi`) of the valid values (3.1).

### 10.4 The fit at flows (`fit_at_flows.csv`)

The 12 flows, in this order: the nine grid flows `1500, 2000, 3000, 5000, 7500, 10000, 15000, 25000, 50000` (ids `g1500`, ..., `g50000`), then the three cell flows `cell1`, `cell2`, `cell3`: the medians (3.1) of `Q` over the `LOW_P` all-years points with `Q < 6000`, with `6000 <= Q < 12000`, with `Q >= 12000` (blank when a cell has no point; the same three numbers for every version). For each version and flow (5 x 12 = 60 rows): `usable = 1` when the all-years fit is not blank, the flow is not blank and `qmin <= F <= qmax`; then `lag = exp(A + B * ln(F))` and `lo, hi` from 10.3 (blank when the bounds are blank); when not usable all of `lag, lo, hi` are blank.

### 10.5 The fits table (`fits.csv`)

For each version and period (5 x 3 = 15 rows): `n_points`, `n_clusters` (clusters with a point), `qmin`, `qmax`, `n_floor`, `nslopes`, `B`, `A`, and for the `all` period `n_valid`, `n_skipped`, `B_lo`, `B_hi` (percentiles of `B_d`; blank for the two half periods, which have no bootstrap). Blank when the fit is blank.

## 11. The Difficult Run check (only when the file is present)

`DR(h) = val(dr_discharge, h)`.

1. **Candidate peaks.** For every hour `p` (ascending) with `DR(p)` present, `v = DR(p)`: every present `DR(q)` with `q = p - 24, ..., p - 1` is `< v`; every present `DR(q)` with `q = p + 1, ..., p + 24` is `<= v`; at least 18 of the 24 hours `p - 24, ..., p - 1` are present; `rise = v - (minimum of those present values)`; `rise >= 50.0`.
2. **Separate peaks.** Sort the candidates by `rise` descending, ties by `p` ascending; accept one only if its `p` differs by at least 48 hours from every accepted one.
3. **Conditions**, tested in this order on each separate peak (the first that fails is its reason; a peak that passes all is a **pass**):
   a. `lf`: `LFday` = the median (3.1) of the present `LF(h)` for `h = p - 47, ..., p - 24`, defined when at least 12 are present, and `LFday < 6000`.
   b. `rise10`: `rise >= 0.1 * LFday`.
   c. `ef`: at least 30 of the 37 hours `p - 24, ..., p + 12` have `ef_stage` present, and `(max - min) / min < 0.05` over those present values.
   d. `creek`: for Seneca and for Broad Run: at least 30 of those 37 hours present, and `max - min < 0.25 * rise` over the present values.
4. The passes, kept in the order of step 2 (largest rise first); the first 40 are the **selected** units (rank 1 to 40), id `D<p>`.
5. **Lag.** For each selected unit: window `a = p - 12`, `b = p + 36`; the use rule of 5.6 with `up = DR`, `down = lf_discharge`, `n = 49`; if used, `XC(DR, lf_discharge, a, b, 0, 24)` (3.4). `lag_scaled = lag * (9.1 / 7.4)` (status `ok` only). **Pass** = status `ok` and `r >= 0.6`.
6. **Valid** when at least 10 selected units pass. The summary: the count at every step, `n_pass_gate`, `valid`, and over the passing units the median (3.1), the 25th and the 75th percentile (3.1) of `lag_scaled` (blank when none).

## 12. The clock and its range

Constants: long end factor 0.37; central factor 0.36; short end factor `0.4 * 0.34`; Difficult Run factor `0.75 * 0.36`. `DRQ25` = the 25th percentile of `lag_scaled` of 11 step 6 and `DRvalid` its validity (absent when the file is absent: `DRvalid = 0`).

For a **lag with bounds** `(L, lo, hi)`:
- `long_end = 0.37 * hi`
- `central = 0.36 * L`
- `short_end = (0.4 * 0.34) * lo` when `DRvalid = 0`; when `DRvalid = 1`: `min((0.75 * 0.36) * L, DRQ25)`.
All blank when `L`, `lo` or `hi` is blank (and `short_end` blank when `DRvalid = 1` and `DRQ25` is blank).

**Rising-water range at a flow `F`** (grid flows and cell flows): take the rows of `fit_at_flows.csv` of `LOW_P`, `LOW_A`, `LOW_B` for that flow. `L, lo, hi` are those of `LOW_P`. `cover_both = 1` when at least two of the three versions are usable and `max - min > 1.0` over the `lag` values of the usable versions; then `lo` = the minimum and `hi` = the maximum over the usable versions that have bounds. Else `cover_both = 0`. When `LOW_P` is not usable, everything is blank.

**Low-water range at a flow `F`** (below 3000 only): the week class of `F` (the edges of 5.5); if the `LOW_P` low-water lag of that class is settled (9.4), `(L, lo, hi)` are those of 9.4 for `LOW_P`; `cover_both` is blank.

**Grid** (`clock_grid.csv`, 9 rows, flows in order): `source` = `rising_fit` when `LOW_P` is usable at `F`; else `low_water` when `F < 3000` and the low-water range is defined; else `none` (all value columns blank). Columns in section 17.

## 13. Cells and verdict

### 13.1 Cells (`cells.csv`, 4 rows)

Cells in order: `rising_lt6000`, `rising_6000_12000`, `rising_ge12000`, `low_water`.
- **Units of a rising cell**: the `LOW_P` all-years points (10.1) with `Q < 6000`, with `6000 <= Q < 12000`, with `Q >= 12000`. `n_units` their count; `median_q` the median of their `Q` (the cell flow `cell1`, `cell2`, `cell3` of 10.4).
- **Units of the low-water cell**: the low-water weeks that pass (`gate50 = 1`) for `LOW_P`; `n_units` their count; `median_q` the median of their `Q`.
- **Qualifies** (`qual`): rising cell: `n_units >= 5` and the range of section 12 at the cell flow has `L, lo, hi, long_end, short_end` all defined. Low-water cell: `n_units >= 20`, and the week class of `median_q` has a settled `LOW_P` low-water lag (9.4). `reason`, tests in this order: rising cell `few_units` (fewer than 5), `no_range` (range not defined), else `ok`; low-water cell `few_weeks` (fewer than 20), `no_phase` (the class phase of `LOW_P` undefined), `no_bumps` (`Mb` undefined for any of the three pairs), `chain` (chain check not defined or not passed), else `ok`.
- **Windows of a cell**: the windows `[a, b]` of its units (for weeks the 168 hours).
- **App value** `app_value`: the median (3.1) of `travelGFtoLF` over the replay rows with `status == "predicted"` and a non-blank `travelGFtoLF` whose `K(predTs)` lies in at least one window of the cell (a row counts once per cell); `n_app_rows` their count (blank `app_value` when none).
- **Formula value** `formula_value` = `(6.5 * (4139.0 * (max(Q, 1000.0) ^ -0.5963))) / 25.8` at `Q = median_q` (the product `6.5 * (...)` first, then the division).
- **Range**: `L, lo, hi, cover_both, long_end, central, short_end` as in section 12, at the cell flow for rising cells and at `median_q` for the low-water cell (low-water rule of section 12, which needs `median_q < 3000`); `dr_used` = 1 when `DRvalid`.
- **Cell status** (`status`), decided on the WRITTEN `%.6f` strings turned into `mic` integers (section 16): `not_qualified` when `qual = 0`; else `TOO LONG` if `mic(app_value) > mic(long_end)`; else `TOO SHORT` if `mic(app_value) < mic(short_end)`; else `INSIDE`.

### 13.2 Verdict (`decision.csv`)

`nq` = number of cells with `qual = 1`; `nlong`, `nshort`, `ninside` the numbers of cells with those statuses. First hit wins:
1. `NOT DECIDED` if `nq < 2`.
2. `TOO LONG` if `nlong >= 2` and `nshort = 0`.
3. `ABOUT RIGHT` if `ninside = nq`.
4. `MIXED` otherwise.
The analysts compute and write this; they state no opinion on it.

## 14. Unit tests on made-up numbers (run FIRST, before any input file is read; a failure stops the run)

Each is one row in `checks.csv` with `n_checked = 1`; `n_violations` is 0 or 1 (1 if any assertion of the test fails). The functions tested must be the SAME functions the real run uses. Where a value is marked "(1e-9)" compare to within 1e-9; every other value exactly. A failure of any unit test stops the run: `checks.csv` is written with the unit rows reached and nothing else.

1. `unit_key`: the test values of 2.1.
2. `unit_weeks`: `w(K(2020-01-06 00:00)) = 2610` and `ws(2610) = 438408 = K(2020-01-06 00:00)`; `w(K(2020-01-05 23:00)) = 2609` (the key is 438407); `w(K(2020-01-12 23:00)) = 2610` (key 438575); `w(K(2020-01-13 00:00)) = 2611`; `w(0) = 0`, `ws(0) = -72`, `w(-72) = 0`.
3. `unit_stats`: `median(3, 1, 2) = 2`; `median(4, 1, 3, 2) = 2.5`; percentile 0.25 of `1,2,3,4,5` is `2.0`; of `1..10` is `3.25`; of `1..10000` at 0.025 is `250.975` and at 0.975 is `9750.025` (each 1e-9).
4. `unit_corr`: `pearson([1,2,3,4,5], [2,4,5,4,5]) = 0.7745966692414834` (1e-9); `pearson([1,1,1], [1,2,3])` is undefined.
5. `unit_xc`: made-up series on the integer hours: `up(h) = 0.0` for every `h` except `up(30..43) = 0,1,3,7,12,20,25,22,15,9,5,2,1,0` (14 values, `h = 30` first); `down(h) = 0.8 * up(h - 5) + 0.2 * up(h - 6)` for every `h`. Window `a = 20`, `b = 70`.
   - `XC(up, down, 20, 70, 0, 12)`: status `ok`, `sb = 5`, `n(5) = 50`, `r(5) = 0.9912981076214433`, `r(4) = 0.7098083831168271`, `r(6) = 0.8501476405787828`, `lag = 5.166026871401152` (each 1e-9), `g60 = 1`, `g70 = 1`.
   - `XC(..., 0, 5)`: status `end`, `sb = 5`. `XC(..., 6, 12)`: status `end`, `sb = 6`.
   - Window `a = 20`, `b = 40`, range 0 to 12: status `no_eligible` (20 pairs).
   - `up(h) = 0.0` for every `h`, same `down`: status `no_eligible` (variance 0).
   - Same series but `down(35)` missing: `n(0) = 48` and `n(5) = 48` (the changes at hours 35 and 36 need `down(35)`), status `ok`, `sb = 5`, `lag = 5.166653914337471` (1e-9).
6. `unit_parabola`: `delta(r_m, r_0, r_p)`: `(0.5, 0.9, 0.7)` gives `0.1666666666666666` (1e-9); `(0.5, 0.5, 0.5)` gives `0.0` (`den == 0`); `(0.9, 0.9, 0.5)` gives `-0.5`; `(0.5, 0.9, 0.9)` gives `0.5`. Phase refinement with wrap (9.2): `sb = 0`, `r(23) = 0.80`, `r(0) = 0.90`, `r(1) = 0.60` gives `phase = 23.75`; `sb = 23`, `r(22) = 0.6`, `r(23) = 0.9`, `r(0) = 0.8` gives `phase = 23.25` (each 1e-9).
7. `unit_start`: start of the limb (5.1): (a) `LF(h) = 600.0` for `h = 100..140` except `LF(110) = 500.0`, `LF(120) = 500.0`, `LF(130) = 700.0`; onset 140: start 120. (b) `LF(h) = 600.0` for `h = 90..140` except `LF(92) = 100.0`, `LF(93) = 500.0`; onset 140: start 93 (hour 92 lies outside the 48 hours). (c) `LF(h) = 600.0` for `h = 50..92` only: onset 140: undefined; onset 100: start 92.
8. `unit_parts`: series `s(10..17) = 100, 100, 112, 140, 185, 200, 200, 190`, window `10..17`: rise 100, crossing times `11.833333333333334, 13.222222222222221, 14.333333333333334` (1e-9), crest 15. Series with gaps `s(10) = 100, s(12) = 112, s(14) = 185, s(16) = 200` (other hours missing), same window: rise 100, times `11.666666666666666, 13.04109589041096, 14.666666666666666` (1e-9), crest 16.
9. `unit_bumps`: `LF(h) = 1000.0` for `h = 0..229` except: `LF(h) = 1000 + 50 * (h - 100)` for `h = 100..110`; `LF(h) = 1500 - 50 * (h - 110)` for `h = 111..120`; `LF(h) = 1000 + 70 * (h - 160)` for `h = 160..165`; `LF(h) = 1350 - 70 * (h - 165)` for `h = 166..170`. The candidate scan of 5.3 step 1 gives exactly one candidate: `p = 110`, `s = 100`, `v = 1500`, `m = 1000`, `a = 94`, `b = 116` (hour 0 fails test c, the peak 1350 at hour 165 fails test e, flat hours fail test b).
10. `unit_thin`: spacing rule (5.3 step 3) on candidate `(p, v)` lists: `(1000, 5000), (1050, 4500), (1100, 3000), (1200, 3500)` keeps `1000, 1100, 1200`; `(1000, 5000), (1096, 4000)` keeps both; `(1000, 5000), (1095, 4000)` keeps `1000` only.
11. `unit_creek`: hours 0 to 4 (window `a = 0`, `b = 4`): `LF = 100,110,130,120,115`; Seneca `10,12,20,15,10`; Broad Run `5,5,5,6,5`; Difficult Run `2,3,8,5,2`. Without Difficult Run, local 430.0, gauged `101.0 + 76.1`: `Slf = 75.0`, `Screeks = 18.0`, `share = 0.5827216261998871` (1e-9), status `heavy`. With Difficult Run, gauged `(101.0 + 76.1) + 57.8`: `Screeks = 28.0`, `share = 0.6834113807293885` (1e-9). With Seneca missing at hour 0 (4 of 5 present): status `unknown`.
12. `unit_theilsen`: `Q = 1000, 2000, 4000, 8000, 8000, 3000`, `lag = 10, 7.1, 5, 3.6, 3.7, 6`: `nslopes = 14`, `B = -0.49061072757099455`, `A = 5.690876476384307` (1e-9). `Q = 1000, 1000`, `lag = 3, 4`: blank (fewer than 5 points). A `lag` of 0.04 enters the fit as 0.05 and counts one floor.
13. `unit_circ`: phases `1, 2, 23, 22, 12`: median 1.0, spread 2.0 (the candidates 1 and 23 tie at `D = 17`; the smaller wins). `0, 12`: median 0.0, spread 6.0. `10, 10, 11`: median 10.0, spread 0.0. `cd(0.5, 23.5) = 1.0`.
14. `unit_lcg`: from `x = 20261127` the recurrence of 10.3 gives, in order, `919802032, 539484947, 1091173115, 686024196, 876128376`; after 1000 steps `251994556`; the index for `x = 919802032` and `m = 7` is `(919802032 * 7) // 2147483647 = 2`.
15. `unit_detrend`: `x(h) = (h * h) mod 17` as a double for `h = 0..40`, except hours 10, 11 and 20 missing: `det(15) = -5.136363636363637`, `det(24) = 7.916666666666667`, `det(30) = 8.40909090909091` (1e-9); `det(3)`, `det(10)`, `det(0)` missing.
16. `unit_days`: whole days (9.4): `(phi, Mb) = (3.0, 26.5)` gives `k = 1`, `L = 27.0`; `(0.0, 12.0)` gives `k = 0` (tie); `(20.0, 3.0)` gives `k = 0`; `(5.0, 100.0)` gives `k = 2`.
17. `unit_range`: `(L, lo, hi) = (10.0, 8.0, 12.0)`: `long_end = 4.4399999999999995`, `central = 3.5999999999999996`, `short_end = 1.088` without Difficult Run (1e-9); with `DRvalid = 1`, `DRQ25 = 2.0`: `short_end = 2.0`; with `DRQ25 = 3.0`: `2.7` (1e-9). Cover both: usable lags `10.0, 10.5, 11.4` give `cover_both = 1`; `10.0, 10.5, 10.9` give 0 (difference 0.9); with lows `8, 9, 7` and highs `12, 13, 15` and `cover_both = 1`: `lo = 7`, `hi = 15`. The formula value at `Q = 5000` is `6.493715588514094` and at `Q = 500` it is `16.954659687540097` (1e-9).
18. `unit_verdict`: cell statuses (cells in order) and verdict: `TOO LONG, TOO LONG, INSIDE, not_qualified` gives `TOO LONG`; `TOO LONG, TOO SHORT, TOO LONG, INSIDE` gives `MIXED`; `INSIDE, INSIDE, INSIDE, INSIDE` gives `ABOUT RIGHT`; `INSIDE, not_qualified, not_qualified, not_qualified` gives `NOT DECIDED`; `TOO LONG, not_qualified, not_qualified, not_qualified` gives `NOT DECIDED`; `INSIDE, TOO LONG, not_qualified, not_qualified` gives `MIXED`; `TOO SHORT, TOO SHORT, INSIDE, INSIDE` gives `MIXED`. Cell status on written strings: `app 6.000000, long 5.999999, short 1.000000` gives `TOO LONG`; `app 5.999999, long 5.999999, short 1.000000` gives `INSIDE`; `app 0.999999, long 5.999999, short 1.000000` gives `TOO SHORT`; `app 1.000000, long 5.999999, short 1.000000` gives `INSIDE`.
19. `unit_dr`: made-up `DR(h) = 100.0` for `h = 0..300` except `DR(98..101) = 200, 300, 400, 300`, `DR(129..131) = 250, 350, 250`, `DR(199..201) = 150, 180, 150`, `DR(249..251) = 120, 140, 120`: the candidates of step 1 are `(p, rise) = (100, 300), (130, 250), (200, 80)` (hour 250 has `rise` 40, below 50; hour 0 has too few hours before it; flat hours are never a strict maximum); after step 2: `(100, 300), (200, 80)`. Condition `rise10`: `LFday = 2000` passes `rise 300` and fails `rise 80`. Condition `ef`: values with min 5.0 and max 5.2 pass (0.04 is below 0.05), min 5.0 and max 5.25 fail. Condition `creek`: a range of 74.5 passes for `rise 300`, a range of 75.0 fails (`0.25 * 300 = 75`). `3.0 * (9.1 / 7.4) = 3.6891891891891886` (1e-9).
20. `unit_mic`: `mic("0.500000") = 500000`, `mic("-0.020000") = -20000`, `mic("10.000000") = 10000000`, `mic("-1.000000") = -1000000`; the written form of `-0.0000001` is `0.000000` (not `-0.000000`) with `mic = 0`.

## 15. Checks on the real data (after the unit tests; a mismatch stops the run and is reported, never worked around)

Order of work: unit tests; then C00 (on a violation write `checks.csv` with the unit rows and the C00 row, and stop); read the files, C01 to C04; build units, windows, bumps, weeks, clusters and the counts for C05; lags and parts, C06 to C08; the M rows (never stop); then the other files. On a violation of C01 to C08 write `checks.csv` with the unit rows and every C row reached, and stop (no other file is written). `n_checked` and `n_violations` are integers; violations are counted.

| Check | Tested on | Violation |
|---|---|---|
| `C00_inputs_sha` | the three input files plus the Difficult Run file when present (`n_checked` 3 or 4) | a SHA-256 or byte size different from 1.1, or a Difficult Run file present whose SHA-256 differs from the line in 1.4 (one violation per file) |
| `C01_hourly_file` | every data line of the hourly file | a line without exactly 12 fields; a `timestamp` not of the form `dddd-dd-dd dd:00` with month 01-12, day 01-31, hour 00-23; a key not strictly above the previous line's; a non-blank value in the 8 numeric columns used (`por_now, ef_stage, lf_discharge, lf_stage, monocacy, goose, broad_run, seneca`) not matching `^[0-9]+(\.[0-9]+)?$` or not above 0; plus one violation each if the data lines are not 130,416, the first key is not 367,421, the last key is not 498,407, or the header fields are not as in 1.2 |
| `C02_events_file` | every data line of the rise list | a line without exactly 47 fields; a header lacking a column of 1.2; a used time not of the form `dddd-dd-dd dd:00`; plus one violation each if the rows are not 87, the rows with non-empty `event_class` are not 54, the distinct `event_id` are not 53, the rows with empty `event_class` are not 33, or two rows of one event differ in `event_t0` or `event_tp` |
| `C03_replay_file` | every data line of the replay | a line without exactly 87 fields; a header lacking `predTs`, `status` or `travelGFtoLF` exactly once; a `predTs` not of the form `dddd-dd-ddTdd:00:00.000Z`; the keys not `K0, K0+1, ...` in order; a `status` not one of `predicted, no_por, no_truth, no_lf`; a `predicted` row whose `travelGFtoLF` is blank or not matching `^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$`; plus one violation if the rows are not 130,987 |
| `C04_dr_file` | every data line of the Difficult Run file (`n_checked` = its lines; 0 when absent) | the contract of 1.4: a wrong header, a line without exactly 2 fields, a stamp not of the form `dddd-dd-dd dd:00` or not exactly one hour after the previous one, the first stamp not `2011-12-01 05:00`, a non-blank value not matching the pattern of 1.4; plus one violation if the lines are not 130,987 |
| `C05_row_accounting` | the 52 rows of `row_accounting.csv` that have an expected value (`n_checked` 52) | a computed count different from the expected value of section 17 |
| `C06_unit_sanity` | the 225 units of `units.csv` | a duplicate unit id; `s > p` on a rise or bump unit; `a > b`; `n_hours < 16` on a rise or bump unit; `Q` blank or not above 0; a recession window with `b < p - 6` |
| `C07_lag_sanity` | every row of `unit_lags.csv` with status `ok` | `s_best <= smin` or `s_best >= smax` of its window; `abs(r) > 1 + 1e-9`; `lag` outside the open interval `(smin, smax)`; a gate flag set while a lower gate flag is 0 (`g70` needs `g60`, `g60` needs `g50`, `g50` needs `g40`); plus one violation if `unit_lags.csv` does not have 225 x 5 = 1,125 rows |
| `C08_week_sanity` | the 100 weeks | a week start whose `((start // 24) + 3) mod 7` is not 0; a week with `Q >= 3000`; a `phase` outside `[0, 24)` on an `ok` row; plus one violation if the weeks are not 100 |

**M rows (never stop the run; counts of near misses that could differ between languages, reported as information):**
- `M1_gate_margin`: `n_checked` = rows of `unit_lags.csv` and `lowwater_weeks.csv` with status `ok`; `n_violations` = those with `0 < abs(r - g) < 1e-9` for some `g` in 0.4, 0.5, 0.6, 0.7.
- `M2_creek_margin`: `n_checked` = rows of `unit_lags.csv` with a defined share; `n_violations` = those with `0 < abs(share - 0.15) < 1e-9`.
- `M3_tie_margin`: `n_checked` = the unit-version windows with at least two eligible shifts; `n_violations` = those where the two highest eligible `r` values differ by less than `1e-12` (an exact tie counts).
- `M4_floor`: `n_checked` = points of all `all`-period fits; `n_violations` = points with `lag <= 0.05`.
Both analysts report the M counts under "Checks" in `REPORT.md`; a DIFFER in a lag or a gate flag is first explained by `M1` to `M3`.

Total rows of `checks.csv` after a complete run: 20 unit tests + 9 (`C00` to `C08`) + 4 (M) = 33.

## 16. Number format and file conventions

- UTF-8 without BOM, `\n` line endings, a final newline, comma separated, no quotes, header line first.
- Decimal numbers: `%.6f` (Python `"%.6f" % x`; R `sprintf("%.6f", x)`). If the result is the string `-0.000000`, write `0.000000`. Never `NA`, `NaN`, `Inf`, or exponent notation.
- Counts, hour keys, 0/1 flags: plain integers (no decimal point). Missing value: the empty field. R: write every integer with `sprintf("%d", x)` (x a whole number) and every decimal with `sprintf("%.6f", x)`; never through `paste`, `as.character`, `format`, `write.csv` or `cat` of a number.
- Text values exactly as spelled in this file.
- **`mic`** (used for the cell status, the chain check and the unit tests): a decision on a number is made on its WRITTEN `%.6f` string turned into an integer in units of 1e-6: remove the decimal point and read it as an integer (`"0.500000"` gives 500000, `"-0.020000"` gives -20000; a written `-0.000000` is first normalised to `0.000000`). In R read the digit string with `as.numeric`, not `as.integer`. A blank value makes every comparison that uses it false (the cell is not qualified, the chain check is blank).
- Integer columns (everything else numeric is `%.6f`): `n_*`, `s_best`, `n_pairs`, `k`, `rank`, hour keys (`a, b, onset_key, peak_key, start_key`), `used`, `nslopes`, `usable`, `qual`, `dr_used`, `cover_both`, `lagcrest`, 0/1 flags (`g40, g50, g60, g70, gate50, pass, chain_pass`), and in key-value files the value is an integer where the item is a count. `event_id`, `cluster`, `unit_id` are text.
- Row order and keys as in section 17. Every listed row is written, also when its values are blank.

## 17. Output files (identical names in `py/` and `r/`; 15 files)

Data rows per file (header not counted): `checks.csv` 33; `row_accounting.csv` 53; `units.csv` 225; `unit_lags.csv` 1,125; `bumps.csv` 103; `class_summary.csv` 150; `fits.csv` 15; `fit_at_flows.csv` 60; `clock_grid.csv` 9; `lowwater_weeks.csv` 500; `lowwater_summary.csv` 27; `dr_units.csv` (rows = selected units, at most 40; 1 marker row when the file is absent); `dr_summary.csv` 16; `cells.csv` 4; `decision.csv` 7.

1. `checks.csv`: `check,n_checked,n_violations`. The 20 unit tests (`unit_key, unit_weeks, unit_stats, unit_corr, unit_xc, unit_parabola, unit_start, unit_parts, unit_bumps, unit_thin, unit_creek, unit_theilsen, unit_circ, unit_lcg, unit_detrend, unit_days, unit_range, unit_verdict, unit_dr, unit_mic`), then `C00_inputs_sha` to `C08_week_sanity`, then `M1_gate_margin, M2_creek_margin, M3_tie_margin, M4_floor`. Written first.
2. `row_accounting.csv`: `item,n,expected`. The 53 items, in this order, with the expected value (blank where none): `hourly_rows` 130416; `hourly_span` 130987; `hourly_missing` 571; `events_rows` 87; `event_rows_with_class` 54; `event_units` 53; `small_onsets` 33; `unit_no_start` 0; `small_no_peak` 0; `small_under30` 0; `rise_units` 86; `bump_candidates` 103; `bump_drop_overlap` 1; `bump_drop_spacing` 16; `bump_units` 86; `recession_windows` 53; `recession_cut` 0; `weeks_complete` 779; `weeks_drop_lf_coverage` 37; `weeks_drop_median` 567; `weeks_drop_overlap` 75; `weeks_low_water` 100; `weeks_lt1500` 17; `weeks_1500_2000` 30; `weeks_2000_3000` 53; `small_joined` 6; `clusters_event` 53; `clusters_small` 27; `clusters_bump` 86; `clusters_total` 166; `replay_rows` 130987; `replay_predicted` 128595; then the windows used (5.6) by version and kind (`rise` = event and small units together, `bump`, `recession`), versions in order: `used_LOW_P_rise` 81, `used_LOW_P_bump` 75, `used_LOW_P_recession` 53, `used_LOW_A_rise` 81, `used_LOW_A_bump` 74, `used_LOW_A_recession` 53, `used_LOW_B_rise` 81, `used_LOW_B_bump` 74, `used_LOW_B_recession` 53, `used_UPP_rise` 76, `used_UPP_bump` 68, `used_UPP_recession` 48, `used_WHO_rise` 76, `used_WHO_bump` 69, `used_WHO_recession` 48; then the weeks used (9.2) by version: `weeks_used_LOW_P` 93, `weeks_used_LOW_A` 93, `weeks_used_LOW_B` 93, `weeks_used_UPP` 92, `weeks_used_WHO` 99; then `dr_present` (0 or 1, expected blank). That is 32 + 15 + 5 + 1 = 53 rows; `C05` tests the 52 with an expected value.
3. `units.csv`: `unit_id,kind,event_id,cluster,onset_key,peak_key,start_key,a,b,n_hours,q,qclass,period,lf_start,lf_peak,share_lower,share_upper,share_whole`. 225 rows: the 53 event units (file order), the 33 small-onset units (file order), the 86 bump units (ascending `p`), the 53 recession windows (event order). `kind` is `event`, `small`, `bump` or `recession`. `event_id` is blank except for events and recessions. `cluster` blank for recessions. `onset_key` blank for bumps and recessions; `start_key`, `lf_start`, `lf_peak` blank for recessions; `peak_key` is `p` (for a recession the event's peak). `lf_start = LF(s)`, `lf_peak = LF(p)` (blank when missing). `q`, `qclass` of 5.2 point 5. `period` of 2.1. The three shares are blank when undefined and for recessions.
4. `unit_lags.csv`: `unit_id,version,used,n_both,status,s_best,n_pairs,r,delta,lag,g40,g50,g60,g70,share,creek,parts_status,lag10,lag50,lag90,lagcrest`. 1,125 rows: the units in the order of `units.csv`, each with the five versions in order. `used` 0/1; `n_both` = `cb` of 5.6; `status` as 7.1; `share` = the share of the version's leg (blank when undefined and for recessions); `creek` = `heavy`, `clean`, `unknown` or `na`; `parts_status` as 7.2 (`ok`, `data`, `no_rise`, or `no_xc` when the status is not `ok`); part lags blank unless parts status `ok`.
5. `bumps.csv`: `peak_key,start_key,a,b,lf_peak,lf_base,status`. 103 rows, ascending `peak_key`; `status` is `kept`, `overlap` or `spacing`.
6. `class_summary.csv`: `version,group,class,n_units,n_used,n_ok,n_g40,n_g50,n_g60,n_g70,n_g60_heavy,n_g60_unknown,n_g60_clean,med_g40,med_g50,med_g60,med_g70,q1_g60,q3_g60,med_g60_all,share_whole_g60,n_parts,med_lag10,med_lag50,med_lag90,med_lagcrest`. 150 rows in the order of section 8.
7. `fits.csv`: `version,period,n_points,n_clusters,qmin,qmax,n_floor,nslopes,B,A,n_valid,n_skipped,B_lo,B_hi`. 15 rows: versions in order, periods `all`, `pre2020`, `from2020`.
8. `fit_at_flows.csv`: `version,flow_id,flow,usable,lag,lo,hi`. 60 rows: versions in order, the 12 flows in order (`g1500, g2000, g3000, g5000, g7500, g10000, g15000, g25000, g50000, cell1, cell2, cell3`).
9. `clock_grid.csv`: `flow,source,L,lo,hi,cover_both,long_end,central,short_end,dr_used`. 9 rows (the nine grid flows). For `source` `rising_fit` the columns are those of the rising range of section 12; for `low_water` those of the low-water range; for `none` blank. `dr_used` is 1 when `DRvalid`, else 0, on every row.
10. `lowwater_weeks.csv`: `week_id,version,start_key,q,class,used,n_both,status,s_best,n_pairs,r,delta,phase,gate50`. 500 rows: weeks ascending, versions in order. `start_key` = `ws(w)`. `status` as 9.2 (`data`, `no_eligible`, `neighbour`, `ok`). `gate50` 0/1 (0 for any status other than `ok`).
11. `lowwater_summary.csv`: `row_type,version,class,n_weeks,n_gate,phase,spread,n_bumps,bump_median,k,lag,lag_lo,lag_hi,chain_sum,chain_whole,chain_diff,chain_pass`. 27 rows: first 15 rows `row_type = phase`: versions in order, classes `lt1500, 1500-2000, 2000-3000` (`n_weeks` = low-water weeks of that class, `n_gate` = those that pass, `phase`, `spread` of 9.3; other columns blank); then 9 rows `row_type = lag`: versions `LOW_P, UPP, WHO` in that order, the three classes (`n_bumps` = `nb`, `bump_median` = `Mb`, `k`, `lag` = `L`, `lag_lo`, `lag_hi` of 9.4; `phase` and `spread` repeated from the matching phase row); then 3 rows `row_type = chain`: version blank, the three classes (`chain_sum`, `chain_whole`, `chain_diff`, `chain_pass` of 9.4). Blank where undefined.
12. `dr_units.csv`: `unit_id,peak_key,rank,rise,lf_day,ef_rel_range,seneca_range,broad_run_range,used,status,s_best,n_pairs,r,delta,lag,lag_scaled,pass`. One row per selected unit, in rank order (`ef_rel_range` = `(max - min) / min` of condition c; `seneca_range`, `broad_run_range` = `max - min` of condition d). When the file is absent: one row with `unit_id` = `ABSENT` and every other field blank.
13. `dr_summary.csv`: `name,value`. 16 rows in this order: `dr_present`, `candidates`, `separate`, `fail_lf`, `fail_rise10`, `fail_ef`, `fail_creek`, `pass_conditions`, `selected`, `used`, `n_pass_gate`, `valid`, `median_scaled`, `q25_scaled`, `q75_scaled`, `dr_sha256` (the SHA-256 text). With the file absent: `dr_present` 0 and every other value blank. (`valid` is 0 or 1.)
14. `cells.csv`: `cell,n_units,median_q,qual,reason,n_app_rows,app_value,formula_value,L,lo,hi,cover_both,long_end,central,short_end,dr_used,status`. 4 rows (13.1).
15. `decision.csv`: `item,value`. 7 rows in this order: `nq, nlong, nshort, ninside, dr_present, dr_valid, verdict` (integers, then the verdict word).

## 18. Floating point: where the two languages can differ

Identical output files are the aim. Agreement of every number within 0.01 is the requirement.

- **Sums.** Section 3.1 fixes the order of every sum. Python's `sum()` is compensated since Python 3.12 and R's `mean()` adds a correction pass, so neither is used. The study runs on one arm64 machine (R's `sum()` has no extended precision there); do not assume this elsewhere.
- **Parsing.** The hourly, rise-list and Difficult Run values are short decimals; both languages parse them to the same doubles. The replay's `travelGFtoLF` has long decimals: R's `as.numeric` can differ from Python's `float` in the last bit on some rows; it enters only a median, written to six decimals. Do not turn it into text and back.
- **Library functions.** `exp`, `log`, `sqrt` and the powers `^ 2.46` and `^ -0.5963` come from the same C library in both languages on one machine; a last-bit difference is possible. It can move a written sixth decimal; it cannot move a count unless a knife edge below is within a last bit.
- **Knife edges** decided on unrounded doubles: the gates `r >= g`; `share > 0.15`; `LF(p) >= 1.3 * LF(s)` and `v >= 1.4 * m` (the product first, then the comparison); `lag <= 0.05`; the tie rules of the best shift and the circular median. The cell status and the chain check are decided on written strings. `M1` to `M4` count the near misses; a DIFFER in a gate flag, a status or a shift is first explained by them.
- **Operation order** is as written: `0.8 * up(h - 5) + 0.2 * up(h - 6)` in the unit test, `(0.4 * 0.34) * lo`, `(0.75 * 0.36) * L`, `lag * (9.1 / 7.4)`, `(Screeks * (local / gauged)) / Slf`, `exp(A + B * ln(F))`, `y - B * x`, `(6.5 * (4139.0 * (max(Q, 1000.0) ^ -0.5963))) / 25.8`.
- **Sorting** for medians and percentiles: near-equal values cannot change a result beyond 1e-13.

## 19. Compare tool (contract)

`tools/compare_analysts.py` (standard library; written separately from this file; run from the study folder as `python3 -I tools/compare_analysts.py py r`).
1. It looks at the 15 `.csv` files of section 17 (a `.csv` of another name on one side only is ignored). A file missing on a side, empty, or with a different header is a difference. The expected header is that of section 17; the expected number of data rows is that of section 17 (for `dr_units.csv` the two sides must agree). The key columns of each file, which must be equal on the two sides row by row in the same order, are: `checks.csv` `check`; `row_accounting.csv` `item`; `units.csv` `unit_id`; `unit_lags.csv` `unit_id,version`; `bumps.csv` `peak_key`; `class_summary.csv` `version,group,class`; `fits.csv` `version,period`; `fit_at_flows.csv` `version,flow_id`; `clock_grid.csv` `flow`; `lowwater_weeks.csv` `week_id,version`; `lowwater_summary.csv` `row_type,version,class`; `dr_units.csv` `unit_id`; `dr_summary.csv` `name`; `cells.csv` `cell`; `decision.csv` `item`.
2. Step 1, exact text: for each file it states whether the two files are byte for byte equal. `checks.csv`, `row_accounting.csv`, `units.csv`, `bumps.csv` and `decision.csv` must be equal as text (tolerance 0), or the result is `DIFFER`.
3. Step 2, numeric fall-back for the other files: every cell is typed by its text: a cell matching `^-?[0-9]+\.[0-9]{6}$` is a decimal (tolerance 0.01 absolute), a cell matching `^-?[0-9]+$` is an integer (exact), the empty cell is blank (blank against non-blank is a difference), anything else is text (exact). A decimal on one side and an integer on the other is a FORMAT difference.
4. Format guards (on both sides, any file): no leading or trailing space, no quote character in the raw bytes, no CR, no BOM, a final newline; a numeric cell never contains `NA`, `NaN`, `inf`, an exponent or a leading plus sign, and `-0.000000` is a violation (checked as a literal string). The guards apply to numeric cells only, not to text such as `LOW_P` or `TOO LONG`.
5. It prints one line per file, then `BYTE-IDENTICAL: yes` if all 15 are byte equal (else `no`), and as the last line `AGREE` only when every file passes steps 1 to 4, otherwise `DIFFER`. Exit status 0 only for AGREE. If the run stopped after `checks.csv`, the other files are missing and the result is `DIFFER`.
If the analysts differ: stop and find the cause; never average or pick one.

## 20. Rulings on the points the plan left open

Final statements. The analysts must not read the plan, the audit or the review (section 0).

From the orchestrator:
1. **Time.** Stamps are UTC hour starts; integer hour keys everywhere; a lag is a number of hours; no half-hour correction (2.1).
2. **Units and windows** as in the plan: one rise unit per event (first onset, the event's peak); small onsets under the 30% rule; the start of the rising limb is the last hour at or before the onset at which Little Falls flow equals its minimum over the 48 hours ending at the onset (5.1); a unit without a start is dropped and counted; bumps by one scan (5.3); recession windows (5.4); low-water weeks by integer week arithmetic (2.1, 5.5).
3. **Series by pair and version** (section 4): lower leg primary stage against stage, sensitivities A and B; upper leg and whole reach in flows.
4. **The lag (XC)** (3.4): changes of consecutive hours, at least 24 pairs, ties to the smallest shift, parabola with the clip, not at either end, gates 0.4, 0.5, 0.6, 0.7.
5. **Parts of a rise** (7.2): rise in the window = maximum minus the first present value; crossings by linear interpolation between consecutive present hours; crest = first hour of the maximum; the upstream window is the unit window shifted back by the unit's own integer best shift.
6. **Creek share** (section 6) with the stated drainage areas; without Difficult Run the lower leg uses Seneca and Broad Run with 177.1.
7. **Low water** (section 9): 25-hour detrending with at least 19 hours; phase on levels from 0 to 23 with wrap-around; circular median and spread by one stated algorithm; whole days in {0, 1, 2} from the bumps; chain check within 3 hours.
8. **Lag against flow** (section 10): Theil and Sen on `(ln Q, ln lag)`; lags of 0.05 or less set to 0.05 and counted; bootstrap over events (clusters) with 10,000 draws and an integer generator needing no file (10.3).
9. **The clock and its range** on the grid 1,500; 2,000; 3,000; 5,000; 7,500; 10,000; 15,000; 25,000; 50,000 cfs (section 12).
10. **Difficult Run check** (section 11), scaled by 9.1 / 7.4.
11. **The verdict** (section 13): the app's value is the median of `travelGFtoLF` over the predicted replay rows whose hour lies in a window of a unit of the cell, each row once per cell; the bare formula beside it; four words.
12. **Outputs**: the 15 files of section 17 with identical names in `py/` and `r/`.
13. **Run time**: dense arrays, vector slices and no data-frame loops (section 0).

Decisions of the specification writer on points the plan and the rulings left open (each is a literal rule above; none was chosen by looking at a result):
14. **Window overlap order for bumps**: the overlap with event and small-onset windows is applied BEFORE the 96-hour spacing, so a candidate that overlaps never suppresses a neighbour (5.3).
15. **Bump peak**: a local maximum over 24 hours each side (first hour of a flat top), at least 36 of the 48 hours ending at the peak present; the base is the flow at the limb's start by 5.1 (the 48 hours include the peak hour itself; it cannot be the minimum when the rise is 40%).
16. **Window for the upper leg and the whole reach**: the same window as the Little Falls rise (5.2), for every version; the upstream series is shifted, the window is not.
17. **Use rule** (5.6): 90% of the window hours present on each series without any shift, and at least 24 hours with both present; the 24-pair rule of XC is separate.
18. **Recession windows** exist for events only; the next unit whose window start cuts is any rise or bump unit whose window starts after `p - 6` (5.4); no creek share, no clean/heavy cut, no cluster.
19. **Low-water weeks** are complete weeks inside the record with at least 152 of 168 Little Falls hours, median below 3,000, and no overlap with any rise, bump or recession window (the order of the drops is the order of the counts); bumps count as rise windows here.
20. **Creek status `unknown`** (a creek or Little Falls lacking 90% of the window hours, or no rise of Little Falls): not clean; such units stay out of the clock sets and are counted.
21. **Low-water lag bounds**: `L - spread` and `L + spread` with the circular spread (median of circular distances to the circular median); this is a spread of weeks, not a bootstrap interval (9.4). The class used by the low-water cell and by a grid flow is the week class of that flow.
22. **Cover both versions** (12): decided at the flow by the three fitted lags (`max - min > 1.0` among the usable ones), and then the bounds are the widest of the usable versions; the class medians of the three versions are reported in `class_summary.csv`.
23. **Cell flows** are the medians of `Q` of the `LOW_P` points of the cell; the low-water cell uses the weeks that pass for `LOW_P`.
24. **Verdict order**: `NOT DECIDED` first (fewer than two qualifying cells), then `TOO LONG`, `ABOUT RIGHT`, `MIXED`.
25. **Difficult Run selection**: "separate peaks" are local maxima over 24 hours each side with a rise (peak minus the minimum of the 24 hours before it) of at least 50 cfs, 48 hours apart, largest first; the plan's conditions are then applied in the order a, b, c, d of section 11 and the first 40 passes are taken.
26. **Bootstrap clusters** are those of 5.7 (events; small onsets join the event they overlap most; bumps alone); the bootstrap resamples the clusters that have at least one point of the fit being bootstrapped.
27. **Quartiles and percentiles** use the linear rule of 3.1; medians use the mean of the two middle values.
28. **Written strings decide** the cell statuses and the chain check; gates and bounds are decided on unrounded doubles.

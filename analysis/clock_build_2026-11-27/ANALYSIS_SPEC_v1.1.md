# Analysis specification: the measured clock, replay description (version 1.1)

Version 1.1, 2026-11-27, written BEFORE any analyst started and before any comparison of OLD against NEW was made. Version 1.0 is kept as `ANALYSIS_SPEC_v1.0.md`; the changes are listed in section 18 (from the independent review `SPEC_REVIEW.md`, all findings accepted by the orchestrator). Nothing in this file is a result. It defines computations; it states no expectation about what any number will show.

Authority: `PLAN.md` of this folder (version 2), sections 2, 3 (3.2, 3.3, 3.4) and the rulings of section 9. Group counts come from `PLAN_AUDIT.md`. This file adds no analysis that the plan does not name, except the checks that keep the machinery sound.

Two analysts, one in Python and one in R, work from THIS FILE and the data files named in section 1 ONLY. They cannot see each other. The aim is output files that are byte for byte identical. Every number must agree within 0.01.

There is NO verdict. No pass or fail of the change is computed anywhere. The only things that can stop a run are the checks of section 14, which test the machinery, and the health stop rules H01 to H04 of 10.1, which are the plan's stop rule for the health of the learning (plan 3.4 item 6).

Where a rule below is copied from an earlier specification it is marked `[source: ...]`. The analysts cannot read the earlier files; the text here is the whole rule. `cap` = `analysis/cap_study_2026-11-26/ANALYSIS_SPEC.md` (v1.2), `clk` = `analysis/clock_study_2026-11-27/ANALYSIS_SPEC.md` (v1.2), `ons` = `analysis/onset_correction_2026-11-25/ANALYSIS_SPEC.md`.

**Known property, stated up front (the report leads with it).** Each run's OWN truth is on a staircase: the replay tool reads Little Falls at the first whole hour at or after the due time, minus 11 minutes. The lag actually scored is therefore always a whole number of hours plus 0.817 h, between 0.18 h earlier and 0.82 h later than the clock's formula. The three COMMON truths of section 4 are NOT on the staircase: they read Little Falls at the exact time `t + h`. They stand for three physical travel times.

**Known property 2:** on all three common truths run NEW has an advantage built into the replay. Its corrections learned against a truth within -0.18 to +0.82 hours of the central truth. OLD's corrections learned against a later and higher river on rises, and all three truths lie on NEW's side of OLD's clock on all but 109 test hours. In `badly_low_rising.csv` and `common_truth_errors.csv` a lower value for NEW is therefore expected and shows nothing about which clock is right. A higher value for NEW would be informative. The three truths protect only the readings inside run NEW (section 8).

## 0. Conduct (rules for the analysts)

1. Read only: this file and the input files of section 1.1. Do NOT read `PLAN.md`, `PLAN_v1.md`, `PLAN_AUDIT.md`, `FACTS.md`, in particular NOT the section of the plan that lists expected outcomes, nor any other file in the folder `analysis/clock_build_2026-11-27/` except this one and the files of the folder `replay_NEW/` named in 1.1 (not its README). Do not read anything in the other analyst's folder (`py/` or `r/`). Do not read the replay tool or any other tool, and no other study folder except the input files named in 1.1.
2. Write ONLY into your own folder: `analysis/clock_build_2026-11-27/py/` (Python) or `analysis/clock_build_2026-11-27/r/` (R). No network. No installs.
3. If a definition does not compute (a column is missing, a count differs, a rule is silent or contradicts itself), STOP and report. Do not improvise. Where this file is silent on a small point, make the most literal and simplest choice and write it in `REPORT.md` under "Judgment calls". A check that fails stops the run (section 14); never work around it, never bend a rule to make a number come out.
4. You state no opinion on what any number means. Every number is computed mechanically and written to a file.
5. Write `REPORT.md` in your folder with the headings `## What was run`, `## Row counts`, `## Judgment calls`, `## Deviations from the specification`, `## Checks`; and a short `README.md`.
6. One command rebuilds all your outputs from the raw files: `python3 -I py/run_all.py` or `Rscript --vanilla r/run_all.R`, run from the folder `analysis/clock_build_2026-11-27/`. One driver script each: `py/run_all.py` (a single file; `-I` removes the script's folder from the import path) and `r/run_all.R`.

## 1. Environment and inputs

### 1.0 Environment [source: cap section 0]
- Python 3 (as installed), standard library only (no numpy, no pandas), run as `python3 -I script.py`. Never `sum()`, `math.fsum`, `statistics.*` (see 2.2).
- R 4.5.2 (`/opt/homebrew/bin/Rscript`), base R only (packages base, stats, utils; the package `tools` only for the call `tools::sha256sum`). Run as `Rscript --vanilla r/run_all.R`. First line of the script: `Sys.setlocale("LC_COLLATE", "C")`.
- Do not use `round()` in either language anywhere in the rules (R rounds halves to even). The only rounding is `floor(x + 0.5)`.
- Python reads CSV with the `csv` module and `newline=''`; strip a trailing `\r` if present (the files use `\n`). R reads each shadow file with `read.csv(header = TRUE, colClasses = <named vector: "character" for the columns of 1.3, "NULL" for all others>, quote = "", comment.char = "", na.strings = character(0), stringsAsFactors = FALSE)`, then converts numbers itself with `as.numeric`. Use vectors, not row loops over a data frame. To count the fields per line use `count.fields(path, sep = ",", quote = "", comment.char = "", blank.lines.skip = FALSE)` (it includes the header line, which is not a data row); `read.csv` pads short rows silently. Read the other CSV files and the counts files with `readLines`; split a CSV line with `strsplit(line, ",", fixed = TRUE)` after appending one sentinel character to the line (`strsplit` drops a trailing empty field); a blank field must stay a blank field and the field count must be exact.
- Blank = the empty string = missing. Never turn a blank into 0. Files are unquoted; no field contains a comma.
- **R index trap:** a vector index of 0 or a negative index does not mean "missing" in R. Every look-up of the row `k` hours earlier goes through ONE function that returns "absent" when the key is outside the array.
- In R every hour key, epoch millisecond, `tau`, `lo0` and `dueMs` is a double (exact below 2^53); never `as.integer` or the `L` suffix for them. The hourly map is a numeric vector indexed by `epoch_ms / 3600000 - K0h + 1` (with `K0h` the first hour key of the hourly file), never a named vector or an environment keyed by `as.character`.

### 1.1 Input files (paths relative to `analysis/clock_build_2026-11-27/`)

SHA-256 and byte size, checked FIRST by both analysts (checks S01 to S12): stop on any difference.

| Id | Role | Path | Bytes | SHA-256 |
|---|---|---|---|---|
| shadow_OLD | OLD run, shadow | `../onset_correction_2026-11-25/replay_L/shadow_L.csv` | 109952178 | `dcc63931841b537a834962b9a7c60e6edfd3b72b8bd491b43af89bbba0ba5aba` |
| learn_OLD | OLD run, learning track | `../onset_correction_2026-11-25/replay_L/learn_L.csv` | 5197278 | `be9c95c12ebb8dbf622f6ae1859830f63326bf026fdf31078e210e16c198b3e6` |
| counts_OLD | OLD run, counts | `../onset_correction_2026-11-25/replay_L/counts_L.txt` | 1200 | `2413d7da60ef9445959e75316e6868de6945678836c63ccf22675fde3a7dde7e` |
| bins_OLD | OLD run, bins (NOT read; checksum for the record) | `../onset_correction_2026-11-25/replay_L/bins_L.csv` | 1658625 | `ad2a48e19344468d5960492a3d95a5d936ead578789388b4b2fc30f331978eea` |
| hourly | hourly record | `../rising-limb-travel-backtest/hourly_backtest_data_v39.csv` | 10133893 | `d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f` |
| events | rise list | `../rising-limb-travel-backtest/rising_limb_events_python_v39.csv` | 24205 | `978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44` |
| units | clock study units | `../clock_study_2026-11-27/py/units.csv` | 27619 | `9f912c545d4645b870749a1169dc82a8b08984e412d863a74fd368738040b883` |
| boot | bootstrap draws | `../onset_correction_2026-11-25/tools/boot_uniforms.csv` | 13000392 | `71d75af9b10c1ba4d3d9492f0e07d17497a35e01d3568d9b3ed8ab8fe528d515` |
| shadow_NEW | NEW run, shadow | `replay_NEW/shadow_L.csv` | 113025453 | `e0111ffcae8ffe135921fccc5db9a26e5d49e12ef9230f43b23dab489fdb9cc3` |
| learn_NEW | NEW run, learning track | `replay_NEW/learn_L.csv` | 8299789 | `cebe8e728d7ba2ec669d5b00c63479cf62d4d01c81e7dadaa7651d5fc9f29750` |
| counts_NEW | NEW run, counts | `replay_NEW/counts_L.txt` | 1200 | `ecb415ca3ccb62b1fe3068a51455eea3f2785a0711989db51b6d89e49e43eed8` |
| bins_NEW | NEW run, bins (NOT read; checksum for the record) | `replay_NEW/bins_L.csv` | 2656268 | `e6d95c886cd9060a4710da8294a252971b15e8f8935a7148c965b79d1b9678b1` |

(The NEW checksums were filled in by the orchestrator from the files on disk and confirmed by the tool audit; the writer of this specification read the NEW header and the counts file only, and analysed nothing.) Inside `replay_NEW/` the files have the same names as in the OLD folder. In this file `OLD` and `NEW` name the two runs.

Facts of the files. Shadow OLD: 130,987 data rows, 87 columns, LF line ends. Shadow NEW: 130,987 data rows, 89 columns: the 87 columns of OLD in the same order, then `clockQ` and `clockHrs`. In NEW the column `travelGFtoLF` still holds the production (old) clock; the new clock is `clockHrs` only. Learn files: header `predTs,valHourTs,dueTs,tauTs,arm,inputArm,cell,outcome,learned,clamped,softFlagged,rawResidualCFS,learningErrorCFS,emaBefore,countBefore,emaAfter,countAfter,chk1_ef,chk2_stage,chk3_lowflow_ice,chk4_largeerr,chk5_outlier,truthDependentHard`; OLD has 23,688 data rows, NEW 37,913. Hourly record: 130,416 data rows, 12 columns, header `timestamp,por_now,por_lagged,ef_stage,lf_discharge,lf_stage,water_temp_c,monocacy,goose,broad_run,seneca,travel_time_h`. Rise list: 87 data rows, 47 columns. Units: 225 data rows, header `unit_id,kind,event_id,cluster,onset_key,peak_key,start_key,a,b,n_hours,q,qclass,period,lf_start,lf_peak,share_lower,share_upper,share_whole,dr_fallback`. Boot: 10,000 data rows, columns `u1`..`u100`, every cell a 12-digit zero-padded integer.

Between the runs, the columns that are read at the validation hour differ (`status`, `truthInProdRange`, the check flags, Edwards Ferry stage and temperature at validation). Columns of the model's inputs and the raw estimate (`rawFinalCFS`, `rawUnc`, `travelGFtoLF`, `flowBin`, `flowState`, all inputs) are identical on every row (check B03).

### 1.2 Replay constants (facts of the replay tool, restated; the analysts do not read the tool)
- `HOUR = 3600000` ms. `CENTER = 1350000` ms (an hourly median is placed at the start of the hour plus 22.5 minutes). `TAU_BEFORE = 660000` ms (11 minutes).
- **The staircase (a run's OWN truth).** A prediction made at the whole hour `t` (epoch ms) with a clock of `h` hours is due at `dueMs = t + h * 3600000.0`. The validation hour is `Tv = ceil(dueMs / 3600000.0) * 3600000.0` (the first whole hour at or after `dueMs`; an exact whole hour is its own). The truth instant is `tau = Tv - 660000`. The own truth is `truth(tau)` of 2.3. For OLD `h` is `travelGFtoLF`; for NEW `h` is `clockHrs`. `ceil` is Python `math.ceil` (then `float`) or R `ceiling`.
- **The common truths do NOT use `ceil` or the 11 minutes** (section 4).

### 1.3 Columns used
- Shadow files (header names exact, case sensitive, each exactly once): `predTs, status, flowBin, flowState, predictedCFS, rawFinalCFS, rawUnc, corrUsed, lfCap, lfQ, age_lf_h, travelPoRtoGF, travelGFtoLF, valHourTs, tauTs, truthFlow, truthInProdRange, truthDependentHard, errPctCorr` (19 columns); NEW additionally `clockQ, clockHrs`.
  - Text (compared as strings): `predTs, status, flowBin, flowState, valHourTs, tauTs, truthInProdRange, truthDependentHard`; and, for check B03 only, `rawFinalCFS, rawUnc, lfCap, lfQ, age_lf_h, travelPoRtoGF, travelGFtoLF` as text.
  - Numbers (64-bit floating point; Python `float(s)`, R `as.numeric(s)`): `predictedCFS, rawFinalCFS, rawUnc, corrUsed, lfCap, lfQ, age_lf_h, travelGFtoLF, truthFlow, errPctCorr`; NEW `clockQ, clockHrs`.
- Learn files: `predTs, tauTs, outcome, clamped` (text; `clamped` compared to the text `1`).
- Hourly record: column 0 `timestamp` (form `YYYY-MM-DD HH:MM`, minutes `00`) and column 4 `lf_discharge`.
- Rise list: `event_id, event_t0, event_class, rl_start, rl_end, kept` (names exact).
- Units: `unit_id, kind, start_key, peak_key, a, b, share_lower`.

## 2. Basic functions

### 2.1 Time [source: cap 1.4]
All times are UTC. `predTs` has the fixed form `YYYY-MM-DDTHH:00:00.000Z` (24 characters). **Period tests use string comparison** with the boundary strings of 2.4.
- **Hour key** `K(predTs) = days_from_civil(Y, M, D) * 24 + HH`, integers: `y = Y - (M <= 2 ? 1 : 0); era = y // 400; yoe = y - era * 400; doy = (153 * (M + (M > 2 ? -3 : 9)) + 2) // 5 + D - 1; doe = yoe * 365 + yoe // 4 - yoe // 100 + doy; days = era * 146097 + doe - 719468` (floor division on integers; Python `//`, R `%/%`). No library time function. Test values: `K(2020-01-01T00) = 438288`, `K(2012-12-01T00) = 376200`, `K(2019-12-31T23) = 438287`, `K(2026-11-09T23) = 498407`, `K(1970-01-01T00) = 0`.
- **Epoch milliseconds** of a time string `YYYY-MM-DDTHH:MM:SS.mmmZ` or `YYYY-MM-DD HH:MM` = `(days * 86400 + HH * 3600 + MM * 60 + SS) * 1000 + mmm` (integer; the form `YYYY-MM-DD HH:MM` has `SS = 0`, `mmm = 0`). Epoch ms of `predTs` = `K * 3600000`.
- **Events file times** have the form `YYYY-MM-DD HH:MM`; convert to the `predTs` form by replacing the space with `T` and appending `:00:00.000Z` after the hour digits: `2015-06-20 12:00` becomes `2015-06-20T12:00:00.000Z`. Hour key = `K` of the converted string.
- **Month label** of an hour = `predTs[0:7]`. Design month index = `(Y * 12 + M) - (2012 * 12 + 12)` (0 to 84, `B = 85`); test month index = `(Y * 12 + M) - (2020 * 12 + 1)` (0 to 82, `B = 83`).

### 2.2 Sums, means, medians, percentiles
- **Sums** [source: cap 7.1]: `s = 0.0`, then `s = s + x` for each term in the stated order (hours in file order unless said otherwise). Python: explicit loop. R: explicit loop, or `sum()` on a plain double vector in that order (never `mean()`, `%*%`, `crossprod`, `colSums`, `rowSums`). This holds on arm64 macOS, where R's `sum()` accumulates in plain doubles; on another machine use the loop. A mean is that sum divided by the count. Counts are exact integers. A measure over an empty set is blank.
- **Median** [source: clk 3.1] of `n >= 1` numbers: sort ascending `x[0..n-1]`; odd `n`: `x[(n-1)/2]`; even `n`: `(x[n/2 - 1] + x[n/2]) / 2.0`.
- **Percentile** `p` [source: clk 3.1 and cap 13.3] of `m >= 1` numbers: sort ascending `x[0..m-1]`; `pos = (m - 1) * p` (double), `i = floor(pos)`, `frac = pos - i`, value = `x[i] + frac * (x[i + 1] - x[i])`; if `i + 1 > m - 1` the value is `x[i]`. By hand in both languages (no `quantile`, no `numpy.percentile`). The percentiles used: `p = 0.05, 0.95` (movement), `0.95, 0.99` (correction steps), `0.025, 0.975` (bootstrap). The literals are parsed by the language.

### 2.3 The truth read from the hourly record [source: cap 12.1, ons; the replay tool's `interpAt`]
Parse the hourly file: read the whole file as text, remove leading and trailing whitespace, split on `\n`, first line header, split every line on `,` (12 fields). For every data line with a non-blank `lf_discharge`: `map[epoch ms of timestamp] = float(lf_discharge)`. Blank values are not in the map (no gap is filled; this is the tool's rule when a neighbour is missing, below). Then for a time `tau` in epoch ms (a whole number for the own truths; any double for the common truths):
```
lo0 = floor((tau - CENTER) / HOUR) * HOUR      (for whole-number tau use integer floor division, R: %/%; for other tau the double floor of the double quotient; both languages agree)
cLo = lo0 + CENTER ; cHi = lo0 + HOUR + CENTER
lo = map[lo0] (or missing) ; hi = map[lo0 + HOUR] (or missing)
if lo and hi present:                         v = lo + (hi - lo) * ((tau - cLo) / HOUR)
else if lo present and (tau - cLo) <= HOUR:   v = lo
else if hi present and (cHi - tau) <= HOUR:   v = hi
else:                                         missing
```
(`HOUR` and `CENTER` as doubles.) Hourly values are placed at the start of the hour plus 22.5 minutes; between two present neighbours the value is linear; with one neighbour missing the other is used if it lies within one hour of `tau`; with none the truth is missing. The truth is **in range** when `v >= 500.0` and `v <= 500000.0` (the production range).

### 2.4 Periods
By `predTs` of the hour of the estimate:

| Name | Condition | Hours of the fixed span | Days |
|---|---|---|---|
| burnin | `predTs < "2012-12-01T00:00:00.000Z"` | not used | |
| design | `"2012-12-01T00:00:00.000Z" <= predTs < "2020-01-01T00:00:00.000Z"` (2012-12 to 2019) | 62,088 | 2,587.0 |
| test | `predTs >= "2020-01-01T00:00:00.000Z"` (the file ends 2026-11-09T23) | 60,120 | 2,505.0 |

Hours of the fixed span = `K(last hour) - K(first hour) + 1`; days = that number divided by `24.0`. Every table has a `period` column with the value `design` or `test`; the design rows are the "beside" tables and are labelled by that column. Burn-in hours are dropped everywhere (the replay's bins start empty).

### 2.5 Shown value, error, classes [source: cap 4.1, 5]
- `u = rawUnc - corrUsed` (the estimate before the cap, one subtraction); `L = lfCap`.
- The shown value without the cap (rule `N`): `shownN = floor(u + 0.5)`. The shown value with the cap (production, rule `P`): `shownP = floor(min(u, 1.2 * L) + 0.5)` (`1.2 * L` is one multiplication of the literal by `L`). The hour is **capped** when `u > 1.2 * L` (strict). `shownP` must equal `predictedCFS` on every estimate hour (check B07, exact number equality); the analysis then uses `predictedCFS` itself as "the shown number" of a run (what the page would show, after the correction and the cap).
- `error = ((shown - truth) / truth) * 100.0` (percent; "points" are percentage points). `abs()` is the absolute value.
- **Badly off**: `abs(error) >= 15`. **Badly low**: `error <= -15`. **Badly high**: `error >= 15`. "Within" is neither.
- `floor(x + 0.5)` is the only rounding (halves go up, negative halves too: `-0.5` gives `0`).

### 2.6 Parsing note (the two languages)
R's `as.numeric` is not correctly rounded for long decimals: on the shadow files `rawUnc`, `corrUsed`, `travelGFtoLF`, `errPctCorr` and `truthFlow` can differ by one unit in the last place from Python. Therefore: (a) every error uses `predictedCFS` and a truth from the hourly record, EXCEPT the no-cap value `N` (8), the cap flag and the correction jumps (10), which use `rawUnc` and `corrUsed`. Their near misses are counted in M03, M06 (estimate hours with `abs((u + 0.5) - floor((u + 0.5) + 0.5)) < 1e-9`, 0 included: `u + 0.5` within 1e-9 of a whole number) and M07 (steps of block 3 with `abs(jump - 5.0) < 1e-9`, 0 included). `truthFlow` and `errPctCorr` enter only checks; (b) the staircase due time uses `travelGFtoLF` of OLD and `clockHrs` of NEW (long decimals) only inside the own-truth checks B05, B06, B08 and the stopping guard M05, where a knife-edge difference shows as a failed check, never silently; (c) the near-miss counts M01 to M07 show where a last-digit difference could matter. Use exactly the expressions written here in the order written.

## 3. Rows, sets and groups

### 3.1 Rows
Both shadow files have the rows `K0 = 367421` (2011-12-01T05) to `K1 = 498407` in file order, one per hour (check S15). The row `k` hours earlier, `Row(k)`, is the row of the SAME file whose hour key is `K - k`; found by key, never by position; if no such row exists it is "absent" [source: cap 4.2].

**Has an estimate** (an "estimate hour"): `predictedCFS`, `rawUnc` and `corrUsed` are all non-blank (status `predicted` or `no_truth`; rows with status `no_por`, `no_lf` or `other` have none). 129,534 rows of each file have an estimate; in the test years 60,120 (OLD: 59,746 `predicted` plus 374 `no_truth`; the status of a row can differ between the runs because it depends on each run's own truth).

The **base set** is the estimate hours of the periods design and test, in file order. Every group is a subset of the base set; the period of an hour is its own. The base set is the same in both runs (check B02).

### 3.2 The groups (A of the plan, section 3.3)
Group membership is decided on the OLD shadow file (the model's inputs are identical in NEW, check B03). `L = lfCap` of the hour. Ten groups in this order (an eleventh, `rl_large_shareunk`, appears only in `groups.csv`):

| # | Name | Rule |
|---|---|---|
| 1 | `all` | every hour of the base set |
| 2 | `lf_rising` | Little Falls rising: `Row(6)` exists, its `lfCap` is non-blank, and `L >= 1.10 * lfCap(Row(6))` (the product first, then the comparison; the literal `1.10`) |
| 3 | `rl_rises` | the hour key lies in `[start_key, peak_key]` (both ends included) of at least one row of `units.csv` with `kind` equal to `event` or `small` |
| 4 | `rl_rises_bump` | as 3, with `kind` equal to `event`, `small` or `bump` |
| 5 | `low_water` | `L < 3000.0` and the hour key lies in NO window `[a, b]` (both ends included) of any of the 225 rows of `units.csv` (all four kinds: `event`, `small`, `bump`, `recession`). Hours that are Little Falls rising are NOT excluded |
| 6 | `high_12_20` | `L >= 12000.0` and `L < 20000.0` |
| 7 | `high_20plus` | `L >= 20000.0` |
| 8 | `rl_large` | the hour lies in the rising limb of a selected large rise (3.2.1) |
| 9 | `rl_large_creekfed` | as 8, and the creek share of that rise is above 0.15 (3.2.2) |
| 10 | `rl_large_notcreek` | as 8, and the creek share of that rise is defined and not above 0.15 |
| (11) | `rl_large_shareunk` | as 8, and the creek share of that rise is blank or the rise has no unit |

Units are read from `units.csv`: `a, b, start_key, peak_key` are integers and are hour keys `K` of 2.1 (`start_key` is blank only for `recession` rows, which have no limb).

#### 3.2.1 Selected large rises [source: cap 6.1]
The rows of the rise list with `event_class == "GATE"` and `kept == "1"` (exact strings). 21 rows are expected; 8 belong to the design period (`event_t0 < "2020-01-01 00:00"`, string comparison) and 13 to the test period. An estimate hour is in the rising limb of a rise when `rl_start <= predTs <= rl_end` after converting `rl_start` and `rl_end` to the `predTs` form (2.1); both ends included. The period of the hour is its own, not the rise's. No hour may lie in two limbs (check G24).

#### 3.2.2 The creek share of a rise
The clock study's creek share of the rise. The unit of a selected rise is the row of `units.csv` whose `unit_id` equals the text `E` followed by the rise's `event_id`. The share used is the column **`share_lower`** (the creek share of the lower leg, Edwards Ferry to Little Falls, the leg of the measured clock), as written in `units.csv` (6 decimals), parsed as a number. A rise is **creek-fed** when `share_lower > 0.15` (strict), **not creek-fed** when it is defined and `<= 0.15`, and **unknown** when it has no unit or `share_lower` is blank.

### 3.3 Expected group counts
Checks G01 to G24 (section 14) compare these counts with the specification writer's counts; a different count STOPS the run (do not bend a rule to match). The test-year counts are those of the plan (`PLAN.md` 3.3, with "about" resolved by the writer's count); the design-year counts are the writer's.

| Group | design | test | Plan's number |
|---|---|---|---|
| `all` | 60,663 | 60,120 | 60,120 |
| `lf_rising` | 4,428 | 4,514 | about 4,500 |
| `rl_rises` | 2,220 | 2,975 | 2,975 |
| `rl_rises_bump` | 3,256 | 4,488 | 4,488 |
| `low_water` | 10,381 | 16,140 | about 16,100 |
| `high_12_20` | 10,858 | 7,271 | 7,271 |
| `high_20plus` | 11,643 | 4,480 | 4,480 |
| `rl_large` | 275 | 452 | 452 |
| `rl_large_creekfed` | 167 | 159 | not in the plan |
| `rl_large_notcreek` | 108 | 293 | not in the plan |
| `rl_large_shareunk` | 0 | 0 | not in the plan |
| selected rises | 8 | 13 | 13 |
| of which creek-fed | 5 | 5 | not in the plan |
| of which not creek-fed | 3 | 8 | not in the plan |
| unit rows by kind (all 225) | event 53, small 33, bump 86, recession 53 | | |

## 4. The three common truths

A common truth applies to every estimate hour of the base set, in both runs identically. It uses `clockQ` of the NEW shadow file at that hour (the Little Falls flow the model holds, cfs) and the new clock, and reads Little Falls at the EXACT time `t + h`, with no rounding up to a whole hour and no 11 minutes:

```
Qc    = min(max(clockQ, 1400.0), 20000.0)
clock = 98.2 * pow(Qc, -0.3935)            hours   (Python: 98.2 * (Qc ** -0.3935); R: 98.2 * Qc^-0.3935)
central: h = clock ;  long: h = 1.23 * clock ;  short: h = 0.30 * clock
tau   = t + h * 3600000.0                  (t = epoch ms of predTs; a double, not rounded)
truth_c = truth(tau)  (2.3, with the placement of the hourly values at the start of the hour plus 22.5 minutes and the tool's rule when a neighbour is missing)
```
Ids: `central`, `long`, `short`, in that order. The clock is computed by the analyst from `clockQ`; it is never taken from `clockHrs` (check B04 compares them within 1e-9 hours on every estimate hour). An hour is **valid for truth c** when `truth_c` is present and in range (2.3) and the hour is not hard-flagged in either file (below). The set of an analysis on truth c is the hours of the group valid for c, identical for both runs. An hour with `truthDependentHard == "1"` in EITHER file is not valid for any common truth (symmetric in the two runs; the app never scores a hard-flagged pair). Row accounting: a step `hard_flag_either` after `truth_out_of_range` in each `common_*` scope (6 rows each, 18 in all; `row_accounting.csv` then has 40 rows). I04 then counts these hours (test, central): `got` `<OLD>:<NEW>`. Known property: the own truths (7.1) are on the staircase of 1.2 and the common truths are not; a run's error on its own truth and on a common truth differ for that reason alone as well.

## 5. Report item 1: movement of the shown number (`movement.csv`)

For each period in the order `design, test` and each of the ten groups: the hours of the group in the base set. Per hour, with `shownOLD` = `predictedCFS` of the OLD file and `shownNEW` = `predictedCFS` of the NEW file at the same hour:
`m = ((shownNEW - shownOLD) / shownOLD) * 100.0` (percent of OLD's shown number). An hour with `shownOLD <= 0` is excluded and counted in `n_excluded` (none is expected).
Columns: `period,group,n,n_excluded,mean,median,p05,p95,share_ge5,n_up,n_down,n_same,direction_by_count`.
- `n` hours used; `mean` = sum of `m` (file order) / `n`; `median` (2.2); `p05`, `p95` percentiles (2.2); `share_ge5 = (100.0 * count of hours with abs(m) >= 5.0) / n`; `n_up` = count with `m > 0`, `n_down` = count with `m < 0`, `n_same` = count with `m == 0`; `direction_by_count` = `lower` if `n_down > n_up`, `higher` if `n_up > n_down`, `equal` otherwise; the direction counts hours, not sizes; read it with `mean` and `median`. The direction on rising water is read from the rows `lf_rising`, `rl_rises`, `rl_rises_bump`, `rl_large`, `rl_large_creekfed`, `rl_large_notcreek`.
- Empty set: `n 0`, other value columns blank (`direction_by_count` blank). 20 rows. This table needs no truth.

## 6. Report item 2: badly low on Little Falls rising hours (`badly_low_rising.csv`, FIRST data file)

Group `lf_rising` only. For each period (`design, test`), each truth (`central, long, short`) and each run (`OLD, NEW`): the hours of `lf_rising` valid for that truth (so both runs use the same hours); error of the run's `predictedCFS` against that truth (2.5); `n` hours, `n_low` = count of badly low hours, `low_share = (100.0 * n_low) / n`. Then, after the two run rows of each (period, truth), a third row `run = NEW_minus_OLD`: `n` as before, `n_low = n_low_NEW - n_low_OLD` (an integer, possibly negative), `low_share = (100.0 * (n_low_NEW - n_low_OLD)) / n`.
Columns: `period,truth,run,n,n_low,low_share`. Order: period, truth (central, long, short), run (OLD, NEW, NEW_minus_OLD). 18 rows.

Known property 2: on all three common truths run NEW has an advantage built into the replay. Its corrections learned against a truth within -0.18 to +0.82 hours of the central truth. OLD's corrections learned against a later and higher river on rises, and all three truths lie on NEW's side of OLD's clock on all but 109 test hours. In `badly_low_rising.csv` and `common_truth_errors.csv` a lower value for NEW is therefore expected and shows nothing about which clock is right. A higher value for NEW would be informative. The three truths protect only the readings inside run NEW (section 8).

## 7. Report item 3: the two-by-two table and errors on the common truths

### 7.1 Own truths (`two_by_two.csv`)
The own truth of a run at an hour is the truth on that run's staircase: `truth(epoch ms of the run's tauTs)` (2.3); it must equal `truthFlow` of that file within `1e-6 * max(1.0, abs(truthFlow))` (check B08), and the `tauTs` itself is rebuilt from the run's own clock (checks B05, B06).
**Paired comparisons of OLD and NEW on each run's own truth use only hours that have a truth in BOTH runs.** The **two-by-two set** of an hour: it has an estimate in both files; `truthFlow` is non-blank in both files and the rebuilt own truths are present; `status == "predicted"` in both files; `truthDependentHard` is not `"1"` in either file; `truthInProdRange` is not `"0"` in either file; `errPctCorr` is non-blank in both files [source: cap 2]. The steps, with the number of hours dropped at each, are written in `row_accounting.csv` (scope `two_by_two`; step 3 is the hours dropped because a truth is missing in one run or both).
- Columns: `period,group,run,truth,n,mae,bias,off,low,high`. Per period, per group (ten), four rows in this order: (`OLD`, `own`), (`OLD`, `other`), (`NEW`, `own`), (`NEW`, `other`). `own` for a run is that run's own truth, `other` is the other run's own truth. The shown number is always the run's own `predictedCFS`. Measures over the hours of the group in the two-by-two set: `n`; `mae` = sum of `abs(error)` / `n`; `bias` = sum of `error` / `n`; `off = (100.0 * count badly off) / n`; `low`, `high` likewise. 80 rows. (Description only: each run looks best on its own truth by construction.)

### 7.2 Common truths (`common_truth_errors.csv`)
Columns `period,group,truth,run,n,mae,bias,off,low,high`. Per period, per group (ten), per truth (`central, long, short`), per run (`OLD, NEW`): the hours of the group valid for that truth; measures as in 7.1. 120 rows.

Known property 2: on all three common truths run NEW has an advantage built into the replay. Its corrections learned against a truth within -0.18 to +0.82 hours of the central truth. OLD's corrections learned against a later and higher river on rises, and all three truths lie on NEW's side of OLD's clock on all but 109 test hours. In `badly_low_rising.csv` and `common_truth_errors.csv` a lower value for NEW is therefore expected and shows nothing about which clock is right. A higher value for NEW would be informative. The three truths protect only the readings inside run NEW (section 8).

## 8. Report item 4: inside run NEW only (`new_cap_yardsticks.csv`, `new_readings.csv`)

Uses the NEW shadow file only, on each of the three common truths, on the ten groups, both periods.
Per hour (valid for truth c, in the group): `P` = `predictedCFS` (the app as shown); `N` = `shownN` (2.5, no cap); the yardsticks (both rounded with `floor(x + 0.5)`):
- `Y0` ("Great Falls equals Little Falls now"): `floor(L + 0.5)`, `L = lfCap`.
- `Y1` ("Little Falls now plus its rise of the last 3 hours carried over the clock"): with `L3` = `lfCap` of `Row(3)` and `a = age_lf_h`: if `Row(3)` is absent, or `L3` or `a` is blank, `Y1 = Y0`. Else `h` = `clock` of section 4 (the NEW clock at this hour), the same on all three truths, so that `Y1` is one fixed estimator judged on three truths. `Y1 = floor(L + max(0.0, ((L - L3) / 3.0) * (clock + a)) + 0.5)` (never below `Y0`). The 3 hours are fixed at `3.0`, not the elapsed time of the readings. After a gap the held reading can be up to 48 hours old (`age_lf_h` above 1), and `Row(3)` can hold the same stale reading, so the "3 hours" are not 3 hours of readings. The rule is applied as written also after a gap; it is a known limit.
Errors by 2.5 against the truth of the row. For each hour and comparison in the order `cap`, `Y0`, `Y1`: `d = abs(error of the other) - abs(error of P)` with other = `N` for `cap`, `Y0` for `Y0`, `Y1` for `Y1` (positive: the app as shown is closer to the truth).

### 8.1 Interval and label
Per row (period, group, truth, comparison): `n` = hours; `mae_app` = sum of `abs(error of P)` / `n`; `mae_other` = sum of `abs(error of other)` / `n`; `n_low_app` = hours with error of `P` `<= -15`; `n_low_other` = the same for the other (integers, written on every row; part of "the cap against no cap" of plan 3.4 item 4, an addition approved by the orchestrator); `mean_d` = sum of `d` / `n`; `lo`, `hi` from 8.2. When `n = 0`: `mae_app`, `mae_other`, `mean_d`, `lo`, `hi` blank, `n_low_app` 0, `n_low_other` 0, `n_valid` 0, `n_skipped` 10000, `label` `unclear`. Labels are computed on the WRITTEN strings of `lo` and `hi` turned into integers in units of 1e-6 (`mic`: remove the decimal point from the written string and read it as an integer; `"0.500000"` gives 500000, `"-0.020000"` gives -20000; a written `-0.000000` is first normalised to `0.000000`; in R read the digit string with `as.numeric`, not `as.integer`). A blank `lo` or `hi` gives `unclear`.
- comparison `cap` [source: cap 8.1, labels renamed]: `cap_closer` if `mic(lo) > 0`; else `cap_farther` if `mic(hi) < 0`; else `unclear`.
- comparison `Y0` and `Y1`: `app_closer` if `mic(lo) > 0`; else `yardstick_closer` if `mic(hi) < 0`; else `unclear`.
Columns of `new_cap_yardsticks.csv`: `period,group,truth,comparison,n,mae_app,mae_other,n_low_app,n_low_other,mean_d,lo,hi,n_valid,n_skipped,label`. Order: period, group (ten), truth (central, long, short), comparison (cap, Y0, Y1). 180 rows.

### 8.2 Resampling over calendar months [source: cap 13.1 to 13.3; ons]
Month blocks only. Design rows use the 85 design months (`B = 85`, columns `u1..u85` of the boot file), test rows the 83 test months (`B = 83`, columns `u1..u83`); all of the same 10,000 rows. The block of an hour is the month index (2.1) of its `predTs`. A block with no hour of the set contributes nothing. Draws: `boot_uniforms.csv` data row `r` (1..10000, file order) is draw `r`; the cell `n` in column `uk` is an exact integer (read as a number); for `k = 1..B` the `k`-th drawn block (0-based) is `j = (n * B) // 10^12` (Python integers; R `(n * B) %/% 1e12`, exact since `n * B < 1e14 < 2^53`). Build per draw the counts `c_j` (how many times block `j` was drawn). Per interval row, once before the draws: `S_j` = sum of `d` over the hours of the set in block `j` (file order), `N_j` = their count. For a draw: `num` and `den` start at 0 and add `c_j * S_j` and `c_j * N_j` for `j = 0, 1, ..., B-1`, EVERY `j` included (plain loop, that order). Allowed and identical: hold the counts as a 10,000 x B matrix `C` and compute `num <- 0; den <- 0; for (j in 1:B) { num <- num + C[, j] * S[j]; den <- den + C[, j] * N[j] }` (vectorised over draws, blocks in order). Not allowed: `%*%`, `rowSums`, `crossprod`. Statistic = `num / den`. If `den == 0` the draw is skipped (counted in `n_skipped`); `n_valid = 10000 - n_skipped`. If `n_skipped > 500` or `n = 0`, `lo` and `hi` are blank. Otherwise sort the valid values ascending and take the percentiles `p = 0.025` and `0.975` by 2.2: `lo` is the 0.025 value, `hi` the 0.975 value. The point estimate `mean_d` is the plain mean (sum over the set in file order divided by `n`). Differences between two rules are formed inside the hour, never between intervals.

### 8.3 The reading (`new_readings.csv`)
Per period, group, comparison: `label_central`, `label_long`, `label_short` are the `label` of the three truths. `reading` = that label if all three labels are equal, else `mixed`. `holds` = 1 if `reading` is one of `cap_closer`, `cap_farther`, `app_closer`, `yardstick_closer`, else 0 (so `unclear` on all three, and `mixed`, do not hold). A reading is reported as holding only if `holds` is 1.

Known property: the short-end truth lies 0.6 to 1.7 hours ahead, so persistence (`Y0`) and the cap have a built-in advantage on it. A reading of `cap_farther` or `app_closer` can hold on all three truths only rarely. A reading that does not hold is not evidence for the other side.
Columns: `period,group,comparison,label_central,label_long,label_short,reading,holds`. Order: period, group, comparison (cap, Y0, Y1). 60 rows.

## 9. Report item 5: what the app would have said about itself (`self_report.csv`)

Each run under its OWN scoring, the learning track: the file `learn_OLD` for OLD, `learn_NEW` for NEW (one row per validation of the single pending estimate; `predTs` is the hour of the estimate). Per run and period (`design`, `test`; the period of a learn row is that of its `predTs`; rows before the burn-in end are dropped):
- `n_rows` = learn rows in the period (all outcomes); `n_learned` = rows with `outcome == "learned"` (hard-skipped rows are not scored); `validations_per_day = n_rows / days`, `learned_per_day = n_learned / days` (days of 2.4: 2587.0 and 2505.0).
- **Join.** For each learn row with `outcome == "learned"`, look up the row of the SAME run's shadow file with the same `predTs`. The row is **joined** when that shadow row exists, has an estimate, and the truth rebuilt at the learn row's own `tauTs` (`truth(epoch ms of tauTs)`, 2.3) is present and above 0. Otherwise it is **unjoined** and counted in `n_unjoined` (steps 3 and 4 of the scope `self_<run>` in `row_accounting.csv`). `n_joined = n_learned - n_unjoined`.
- On a joined row: `shown` = `predictedCFS` of the shadow row, `truth` = the rebuilt truth at the learn row's `tauTs` (the run's own staircase truth at the row's actual validation hour, so a retried row is scored against its later truth), `error` by 2.5. `low15` = `error <= -15`. The shown 90% band is built from the shadow row by 9.1 and `inband` is `band_lo <= truth` and `truth <= band_hi` (both ends included).
- `n_low15`, `low15_share = (100.0 * n_low15) / n_joined`; `n_inband`, `inband_share = (100.0 * n_inband) / n_joined`; blank when `n_joined` is 0.
Columns: `period,run,n_rows,n_learned,n_joined,n_unjoined,validations_per_day,learned_per_day,n_low15,low15_share,n_inband,inband_share`. Order: period (design, test), run (OLD, NEW). 4 rows. (This is each run under its own scoring; the two are not paired.)

### 9.1 The shown 90% band (how the page builds it)
(Sources, for the record only; the analysts do not read them.) `netlify/functions/shared/ci-table.js` `bandFor`, `src/model/constants.js` `EMPIRICAL_CI_90`, `src/estimation/great-falls.js` (`getGFUncertainty`, `computeUncertaintyBand`, `applyGFCorrection` in `shared-model.js`).
- **Which flow picks the cell:** the bin of the RAW UNCLIPPED final estimate (before the correction and before the cap), not the bin of the shown value. In the shadow file this is the column `flowBin` of the hour (and `flowState` the state). The cell is `table[flowBin][flowState]`; an unknown state falls back to `all` (none occurs: check B01 requires `rising`, `steady` or `falling`).
- **Which value the band is placed around:** the shown value after the correction and the cap, rounded: `est = predictedCFS` (an integer).
- **Band:** `band_lo = max(0, est - q95)` and `band_hi = est - q05` (the page rounds with `Math.round`, which is inert because every number is an integer).
- **When the cap applies:** nothing changes except that `est` is the capped value: the band is placed around the capped value, with the cell of the uncapped raw bin. The page marks the band "around the capped value"; no other rule.
Table `(q05, q95)` per bin and state:

| flowBin | rising | steady | falling | all |
|---|---|---|---|---|
| `0-3000` | -547, 369 | -271, 250 | -315, 336 | -309, 284 |
| `3000-6000` | -676, 535 | -327, 287 | -391, 361 | -425, 356 |
| `6000-12000` | -1650, 1046 | -404, 320 | -451, 359 | -628, 506 |
| `12000-25000` | -2384, 1543 | -549, 425 | -514, 464 | -884, 741 |
| `25000-50000` | -3851, 2860 | -2013, 1844 | -1068, 1059 | -2402, 1899 |
| `50000+` | -7354, 5519 | -5858, 6410 | -4099, 6429 | -5858, 6410 |

## 10. Report item 6: health of the learning (`learning_health.csv`)

Columns `run,period,metric,value,source`. Order: run (`OLD`, `NEW`); within a run the three blocks below in this order. `value` is an integer for counts and `%.6f` for the others.

**Block 1, `source = counts_file`, `period = whole_run`** (the counts file `counts_<run>`; the whole replay, not split by period). Read the lines by this rule: remove leading spaces; a line is selected when it starts with the stated prefix; the integer is the rest of the line after the prefix (for the first line see below). Exactly one line must match each prefix, else stop. Metrics in order:
1. `slots_stored`: prefix `learning track: slots stored `, integer up to the `;`.
2. `slot_blocked_hours`: the same line, the integer after `; hours a new prediction found the slot occupied `.
3. `learn_validations`: prefix `validations (truth found, in production range): `.
4. `learned`: prefix `learned: `.
5. `hard_skipped`: prefix `hard-skipped (excluded from learning): `.
6. `retries`: prefix `retries (no truth or truth out of production range at the validation hour): `.
7. `dropped_missed_window`: prefix `dropped, missed 2.5 h window: `.
8. `pending_at_end`: prefix `slot still pending at end of run: `.
9. `rate_missed_window` = `(100.0 * dropped_missed_window) / slots_stored`; 10. `rate_retries` = `(100.0 * retries) / slots_stored`; 11. `rate_hard_skipped` = `(100.0 * hard_skipped) / slots_stored` (`%.6f`, for the record; computed from metrics 1, 5, 6, 7; blank if `slots_stored` is 0).
(Missed windows, retries, slots and blocked hours exist only here; the learn file has no row for them.)

**Block 2, `source = learn_file`, periods `burnin`, `design`, `test` in that order** (period of the learn row's `predTs`; `burnin` = `predTs < "2012-12-01T00:00:00.000Z"`, kept only so the whole run reconciles). Metrics in order: `n_learn_rows` (all rows), `n_learned` (`outcome == "learned"`), `n_hard_skipped` (`outcome == "hard_skipped"`: estimates skipped by the data checks), `n_clamped` (rows with `clamped == "1"`: values held by the outlier guard).

**Block 3, `source = shadow_file`, periods `design`, `test`.** Over the base set of the run's OWN shadow file. Let `u = rawUnc - corrUsed`, `L = lfCap`. Metrics, in order:
1. `n_est_hours`: estimate hours in the period.
2. `n_capped`: hours with `u > 1.2 * L` (strict); 3. `capped_share = (100.0 * n_capped) / n_est_hours`: how often the cap binds.
4. `n_capped_lf_rising`: capped hours that are in the group `lf_rising` of 3.2; 5. `capped_lf_rising_share = (100.0 * n_capped_lf_rising) / (n of lf_rising)`.
6. `n_corr_steps`: the number of hours `t` in the period with an estimate such that `Row(1)` exists and has an estimate and `rawUnc(t) > 0`. For each: `jump = (100.0 * abs(corrUsed(t) - corrUsed(Row(1)))) / rawUnc(t)`: the hour-to-hour change of the applied correction as a percent of the uncorrected estimate (the previous hour may lie in another period; the hour `t` decides the period). The correction is `corrUsed`, the unrounded value subtracted from `rawUnc`; a change of state or bin between the two hours counts.
7. `corr_jump_p95`, 8. `corr_jump_p99`: percentiles `0.95`, `0.99` (2.2) of the `jump` values (blank when `n_corr_steps` is 0).
9. `n_jumps_ge5`: count of `jump >= 5.0`.
The metric names written in block 3 are exactly: `n_est_hours, n_capped, capped_share, n_capped_lf_rising, capped_lf_rising_share, n_corr_steps, corr_jump_p95, corr_jump_p99, n_jumps_ge5`. Rows per run: 11 + 12 + 18 = 41; 82 in all.

### 10.1 Health stop rules (checks H01 to H04, stopping)
H01: `pending_at_end` is 0 in both runs. H02: for each `x` of `dropped_missed_window`, `retries` and `hard_skipped` (counts file), the rate per stored slot of NEW is at most 1.5 times OLD's, tested on exact integers: `2 * x_NEW * slots_stored_OLD <= 3 * x_OLD * slots_stored_NEW`. H03: test period, `2 * mic(corr_jump_p99 NEW) <= 3 * mic(corr_jump_p99 OLD)` on the written strings (8.1). H04: test period, `2 * n_jumps_ge5(NEW) <= 3 * n_jumps_ge5(OLD)` (integers). The rates `(100.0 * x) / slots_stored` are written in `learning_health.csv` block 1 as metrics `rate_missed_window`, `rate_retries`, `rate_hard_skipped` (`%.6f`), for the record. A failure writes `checks.csv` only and is investigated (plan 3.4 item 6). The factor 1.5 comes from the plan audit (F6); the limits were fixed by the orchestrator before any analyst ran. If a blank value makes a test undefined (a blank `corr_jump_p99`), the check fails.

## 11. Report item 7: checks that must come out as construction says
On the central common truth, test period, from `common_truth_errors.csv`: for the groups `all`, `lf_rising` and `low_water`, `mae(NEW) <= mae(OLD)` on the WRITTEN strings turned into `mic` (8.1). These are the checks B10a, B10b, B10c; the same three for the design period are information rows I01 (result letter `I`, never stopping). A failure of B10a to B10c stops the analyst: write `checks.csv` only (section 14) and report. "Rising hours" means the group `lf_rising`. 'Mean error' of the plan is read as the mean absolute error `mae`. Read as the signed bias, 'not above' would reward reading low, the dangerous side, which cannot be what a construction check means.

## 12. Groups table (`groups.csv`)
Columns `period,group,n,n_central,n_long,n_short,n_two_by_two`. Per period (design, test), per group in the order of 3.2 including the eleventh (`rl_large_shareunk`): `n` = hours of the group in the base set; `n_central`, `n_long`, `n_short` = those valid for that truth (4); `n_two_by_two` = those in the two-by-two set (7.1). 22 rows.

## 13. Output files, formats, order

### 13.1 Number format and file conventions [source: cap 16]
UTF-8 without BOM, `\n` line endings, a final newline, comma separated, no quotes, header first. Decimals `%.6f` (Python `"%.6f" % x`; R `sprintf("%.6f", x)`); if the result is `-0.000000` write `0.000000`. Never `NA`, `NaN`, `Inf`, exponent notation. Counts and flags: plain integers (R: `sprintf("%d", x)` for whole numbers; never `paste`, `as.character`, `format`, `write.csv`, `cat` of a number). Missing: the empty field. Text exactly as spelled here. Integer columns: `n`, `n_*`, `step`, `rows_in`, `rows_dropped`, `rows_left`, `holds`, and in `learning_health.csv` the `value` of count metrics (`slots_stored`, `slot_blocked_hours`, `learn_validations`, `learned`, `hard_skipped`, `retries`, `dropped_missed_window`, `pending_at_end`, `n_learn_rows`, `n_learned`, `n_hard_skipped`, `n_clamped`, `n_est_hours`, `n_capped`, `n_capped_lf_rising`, `n_corr_steps`, `n_jumps_ge5`); all other numbers `%.6f`. `n_low` in `badly_low_rising.csv` is an integer (negative allowed). Rows are written in the stated order (all orders are fixed lists), also when a set is empty (counts 0, other values blank).

### 13.2 Files (identical names in `py/` and `r/`; 11 files), in this output order
1. `badly_low_rising.csv` (section 6): `period,truth,run,n,n_low,low_share`; 18 rows.
2. `movement.csv` (5): `period,group,n,n_excluded,mean,median,p05,p95,share_ge5,n_up,n_down,n_same,direction_by_count`; 20 rows.
3. `groups.csv` (12): `period,group,n,n_central,n_long,n_short,n_two_by_two`; 22 rows.
4. `two_by_two.csv` (7.1): `period,group,run,truth,n,mae,bias,off,low,high`; 80 rows.
5. `common_truth_errors.csv` (7.2): `period,group,truth,run,n,mae,bias,off,low,high`; 120 rows.
6. `new_cap_yardsticks.csv` (8.1): `period,group,truth,comparison,n,mae_app,mae_other,n_low_app,n_low_other,mean_d,lo,hi,n_valid,n_skipped,label`; 180 rows.
7. `new_readings.csv` (8.3): `period,group,comparison,label_central,label_long,label_short,reading,holds`; 60 rows.
8. `self_report.csv` (9): `period,run,n_rows,n_learned,n_joined,n_unjoined,validations_per_day,learned_per_day,n_low15,low15_share,n_inband,inband_share`; 4 rows.
9. `learning_health.csv` (10): `run,period,metric,value,source`; 82 rows.
10. `checks.csv` (14): `id,description,expected,got,result`; 89 rows after a complete run.
11. `row_accounting.csv` (13.3): `scope,step,condition,rows_in,rows_dropped,rows_left`; 40 rows.
Data rows are counted without the header. If a stopping check fails, only `checks.csv` is written (all rows computed so far, with result `F` on the failing rows; rows not reached are absent) and the run exits with a non-zero status.

### 13.3 `row_accounting.csv` (every row kept or dropped, with the reason)
Per scope the steps in order; each row meeting a condition is dropped, later conditions see only the rows left; `rows_in` of step `k` is `rows_left` of step `k-1`; step 0 has `rows_dropped = 0`. `condition` is the name below.
- `movement` (rows of the shadow files): 0 `read` (130,987); 1 `no_estimate`; 2 `burn_in`; 3 `old_nonpositive` (`predictedCFS` of OLD `<= 0`). 4 rows.
- `common_central`, `common_long`, `common_short`: 0 `read`; 1 `no_estimate`; 2 `burn_in`; 3 `truth_missing`; 4 `truth_out_of_range` (present, outside 500 to 500,000); 5 `hard_flag_either` (`truthDependentHard == "1"` in either file). 6 rows each, 18 in all.
- `two_by_two`: 0 `read`; 1 `no_estimate_either`; 2 `burn_in`; 3 `truth_missing_either` (`truthFlow` blank in either file, or a rebuilt own truth missing: the hours dropped because a truth is missing in one run or both); 4 `status_not_predicted_either`; 5 `hard_flag_either` (`truthDependentHard == "1"` in either); 6 `truth_out_of_range_either` (`truthInProdRange == "0"` in either); 7 `blank_error_either` (`errPctCorr` blank in either). 8 rows.
- `self_OLD`, `self_NEW` (rows of the learn file): 0 `read`; 1 `hard_skipped` (`outcome != "learned"`); 2 `burn_in`; 3 `no_shadow_estimate` (no shadow row with the `predTs`, or it has no estimate); 4 `truth_missing` (rebuilt truth at `tauTs` missing, blank `tauTs`, or `<= 0`). 5 rows each, 10 in all.
Rows: 4 + 18 + 8 + 10 = 40. The `self_*` step 4 `rows_left` equals `n_joined` of `self_report.csv` summed over the periods.

## 14. Checks (`checks.csv`) and the order of work

Columns `id,description,expected,got,result`. `result` is one letter: `P` pass, `F` fail (stops the run), `I` information (never stops; its `expected` is blank). For a check that counts violations `expected` is `0` and `got` the count; for a check of a number `expected` and `got` are the two numbers (integers as integers; sha rows `<sha256>:<bytes>`); for the B10 rows `expected` is `NEW<=OLD` and `got` is `<mae NEW written>:<mae OLD written>`. `description` is the id itself, character for character (for example `U01_round`, `S01_sha_shadow_OLD`, `G12_test_all`, `I01_design_mae_all`). No other text is written in this column. Order of work: unit tests (U), then the file checks S01 to S12 (a mismatch stops), then read the files, then S13 onward and the B, G checks (B11 after B09), then the tables, then B10, the health stop rules H01 to H04 and the information rows. M rows have result `I`, except M05, which has result `P` or `F`. Any `F` stops (write `checks.csv` only).

Row list, in this order (89 rows):

| Id | Test (violations unless said) | Expected |
|---|---|---|
| U01_round | `floor(x + 0.5)`: `0.5 -> 1`, `2.4 -> 2`, `2.5 -> 3`, `-0.5 -> 0`, `-1.5 -> -1`, `8.49 -> 8`, `8.5 -> 9` | 0 |
| U02_key | the five `K` values of 2.1 | 0 |
| U03_time | epoch ms of `"2012-01-01 00:00"` is `1325376000000`; of `"1970-01-01 00:30"` is `1800000`; of `"2013-06-01T05:49:00.000Z"` is `1370065740000` and equals that of `"2013-06-01 05:49"`; of `"2020-06-01T05:00:00.000Z"` is `1590987600000`; the event form `"2015-06-20 12:00"` converts to `"2015-06-20T12:00:00.000Z"` with key `398556` | 0 |
| U04_percentile | rule 2.2 on `x = 1, 2, ..., 10000`: `p = 0.025` gives `250.975`, `0.975` gives `9750.025` (1e-9); on `x = 1, ..., 11`: `p = 0.05` gives `1.5`, `0.95` gives `10.5`, median `6`; median of `1, 2, 3, 4` is `2.5` | 0 |
| U05_mic | `mic("0.500000") = 500000`, `mic("-0.020000") = -20000`, `mic("10.000000") = 10000000`, `mic("-1.000000") = -1000000`; the written form of `-0.0000001` is `0.000000` with `mic = 0` | 0 |
| U06_truth | map `{0: 1000.0, 3600000: 2000.0, 10800000: 4000.0}`: `truth(2250000) = 1250`; `truth(1350000) = 1000`; `truth(3150000) = 1500`; `truth(1349999) = 1000`; `truth(5400000) = 2000`; `truth(8551000) = 4000`; `truth(18000000 + 1350000 + 5)` missing; a non-whole time: `truth(2250000.5)` is `1250.000138888889` (1e-9); range: 500.0 in, 499.9 out, 500000.0 in, 500000.1 out | 0 |
| U07_boot_index | `(n * B) // 10^12`: `B = 85, n = 0 -> 0`; `B = 85, n = 999999999999 -> 84`; `B = 83, n = 0 -> 0`; `B = 83, n = 999999999999 -> 82`; `B = 7, n = 500000000000 -> 3`; the first cell of the first data row of `boot` is `343638232196`, index `29` for `B = 85` and `28` for `B = 83` | 0 |
| U08_periods | `2019-12-31T23:00:00.000Z` is design and `2020-01-01T00:00:00.000Z` is test; `2012-11-30T23:00:00.000Z` is burn-in and `2012-12-01T00:00:00.000Z` is design; design month index of `2012-12` is 0 and of `2019-12` is 84; test month index of `2020-01` is 0 and of `2026-11` is 82 | 0 |
| U09_error | `((850 - 1000) / 1000) * 100.0` equals `-15` exactly (badly low and off); `((1150 - 1000) / 1000) * 100.0` equals `15` exactly (badly high and off); `((17 - 20) / 20) * 100.0` equals `-15` exactly; `((1149 - 1000) / 1000) * 100.0` is `14.9` within 1e-9 (within) | 0 |
| U10_cap | `L = 1500`, `rawUnc = 2600`, `corrUsed = 100` (`u = 2500`): `shownP = 1800`, `shownN = 2500`, capped; `rawUnc = 1900`, `corrUsed = 100` (`u = 1800`, exactly `1.2 * L`): not capped, `shownP = 1800`; `rawUnc = 1901` (`u = 1801`): capped, `shownP = 1800`, `shownN = 1801`; `L = 1500`, `rawUnc = 1700.5`, `corrUsed = 0`: `shownN = 1701` | 0 |
| U11_clock | `clock(Q)` with `Qc = min(max(Q, 1400), 20000)`: `Q = 1000` and `1400` give `5.676885120152289`; `3000` gives `4.205951632159436`; `5000` gives `3.440066128281308`; `10000` gives `2.6188552085600927`; `20000` and `50000` give `1.9936833617872496` (each 1e-9); at `Q = 3000` the long end `1.23 * clock` is `5.173320507556106` and the short end `0.30 * clock` is `1.2617854896478307` (1e-9) | 0 |
| U12_due | `t` = epoch ms of `2020-06-01T05:00:00.000Z` (`1590987600000`). Common truth time: `h = 4.2` gives `tau = t + 4.2 * 3600000.0 = 1591002720000` (within 1e-3 ms; no rounding up, no 11 minutes). Staircase (own truth): `h = 4.2` gives `Tv = 1591005600000` (`2020-06-01T10:00`) and `tau = 1591004940000`; `h = 4.0` gives `Tv = 1591002000000` and `tau = 1591001340000`; `h = 0.5981050085361749` gives `Tv = 1590991200000` | 0 |
| U13_band | bin `3000-6000`, state `rising`, `est = 4000`: `band_lo = 3465`, `band_hi = 4676`; truth 3465 inside, 3464 outside, 4676 inside, 4677 outside; bin `0-3000`, `steady`, `est = 300`: `50`, `571`; `est = 100`: `0`, `371`; bin `50000+`, `falling`, `est = 60000`: `53571`, `64099`; an unknown state `weird` in bin `6000-12000`, `est = 8000` falls back to `all`: `7494`, `8628` | 0 |
| U14_yard | `L = 1000`, `L3 = 910`, `a = 1.0`, `clock = 4.0`: `Y1 = floor(1000 + 150 + 0.5) = 1150` (`g = (90 / 3.0) * 5.0 = 150`); `L3 = 1100`: `g < 0`, `Y1 = 1000`; `Row(3)` absent or `a` blank: `Y1 = Y0 = 1000`; `L = 1000.4`: `Y0 = 1000`; `L = 1000.5`: `Y0 = 1001` | 0 |
| U15_move | `((950 - 1000) / 1000) * 100.0` is `-5` exactly (counts in `share_ge5` and `n_down`); `((1049 - 1000) / 1000) * 100.0` is `4.9` within 1e-9 (does not count); `shownOLD = 0` is excluded | 0 |
| U16_labels | cap: (`0.100000`, `0.300000`) gives `cap_closer`; (`-0.300000`, `-0.100000`) `cap_farther`; (`-0.100000`, `0.200000`) `unclear`; (`0.000000`, `0.200000`) `unclear`; (`-0.200000`, `0.000000`) `unclear`; (blank, `0.200000`) `unclear`; (`0.000001`, `0.200000`) `cap_closer`. Yardstick: (`0.100000`, `0.300000`) `app_closer`; (`-0.300000`, `-0.100000`) `yardstick_closer`; (`-0.100000`, `0.200000`) `unclear`; (blank, blank) `unclear` | 0 |
| U17_reading | (`cap_closer`, `cap_closer`, `cap_closer`): `cap_closer`, holds 1; (`cap_closer`, `unclear`, `cap_closer`): `mixed`, 0; (`unclear`, `unclear`, `unclear`): `unclear`, 0; (`app_closer` x3): `app_closer`, 1; (`cap_farther`, `cap_closer`, `cap_farther`): `mixed`, 0; (`yardstick_closer` x3): `yardstick_closer`, 1 | 0 |
| U18_jump | `corrUsed = 100, 160, 100`, `rawUnc = 1000, 1000, 1000` on three consecutive hours: two steps, `jump = 6` and `6` (exact), `n_jumps_ge5 = 2`; with `corrUsed = 100, 104, 100`: jumps `0.4`, `0.4` (1e-9), count 0 | 0 |
| S01_sha_shadow_OLD, S02_sha_learn_OLD, S03_sha_counts_OLD, S04_sha_bins_OLD, S05_sha_hourly, S06_sha_events, S07_sha_units, S08_sha_boot, S09_sha_shadow_NEW, S10_sha_learn_NEW, S11_sha_counts_NEW, S12_sha_bins_NEW | one row per file of table 1.1 in table order: SHA-256 and bytes `<sha>:<bytes>` | table 1.1 |
| S13_rows | shadow data rows: `got` `<OLD>:<NEW>` | `130987:130987` |
| S14_fields | every data row of OLD has exactly 87 fields, of NEW exactly 89; violations | 0 |
| S15_header_grid | each of the 19 (OLD) and 21 (NEW) names of 1.3 occurs exactly once; the NEW header equals the OLD header followed by `,clockQ,clockHrs`; `predTs` of every row has the form `dddd-dd-ddTdd:00:00.000Z` (month 01-12, day 01-31, hour 00-23) and `K` is the previous row's plus 1, first row `367421`, last `498407`, in both files; violations | 0 |
| S16_other_rows | hourly 130,416 data lines each with exactly 12 fields, timestamp form `dddd-dd-dd dd:00` strictly increasing, non-blank `lf_discharge` a number above 0; events 87 data lines, 47 fields, header has the six names of 1.3; units 225 data lines with the header of 1.1 and kinds event 53, small 33, bump 86, recession 53; boot 10,000 data rows and 100 columns; learn_OLD 23,688 data rows and learn_NEW 37,913; violations | 0 |
| G01 to G22 (G01_design_all ... G11_design_rl_large_shareunk, G12_test_all ... G22_test_rl_large_shareunk) | the 22 counts of `groups.csv` column `n` (design then test, groups in the order of 3.2 with the eleventh) against section 3.3; `got` the count, `expected` the table's | table 3.3 |
| G23_rises | selected rises: design 8, test 13; creek-fed: design 5, test 5; not creek-fed: design 3, test 8; unknown 0 and 0 (`got` is `8:13:5:5:3:8:0:0`) | `8:13:5:5:3:8:0:0` |
| G24_limb_overlap | estimate hours lying in the limbs of two selected rises | 0 |
| B01_inputs_wellformed | on every estimate hour of both files: `predictedCFS`, `rawUnc`, `corrUsed`, `lfCap`, `lfQ`, `age_lf_h`, `flowBin`, `flowState`, `travelGFtoLF`, `valHourTs`, `tauTs` non-blank, `flowState` one of `rising, steady, falling`, `flowBin` one of the six strings of the table of 9.1, `lfCap > 0`, `predictedCFS > 0`; NEW also `clockQ` and `clockHrs` non-blank; no row without estimate has status `predicted` or `no_truth`; violations (one per hour and file) | 0 |
| B02_same_hours | OLD and NEW have an estimate at exactly the same hours (rows aligned by key; an hour where only one file has an estimate counts); violations | 0 |
| B03_raw_same | on every row with an estimate the raw estimate before any correction and the inputs are identical: the TEXT of `rawUnc`, `rawFinalCFS`, `flowBin`, `flowState`, `lfCap`, `lfQ`, `age_lf_h`, `travelPoRtoGF`, `travelGFtoLF` is equal in OLD and NEW; violations (one per hour) | 0 |
| B04_clock_cols | NEW, every estimate hour: `abs(clockHrs - clock) > 1e-9` where `clock` is computed from `clockQ` (section 4); violations | 0 |
| B05_new_own_truth | NEW, every estimate hour, the own truth rebuilt on the staircase from NEW's own clock (`h = clockHrs`, 1.2: `dueMs`, `Tv`, `tau`): the epoch ms of `tauTs` equals `tau`, the epoch ms of `valHourTs` equals `Tv`, `truth(tau)` is present iff `truthFlow` is non-blank, and when present `abs(truth(tau) - truthFlow) <= 1e-6 * max(1.0, abs(truthFlow))`; violations. Burn-in hours are included. (NEW's column `travelGFtoLF` is the old clock and is not used here.) This proves the analyst's interpolation before the common truths use it | 0 |
| B06_old_own_truth | OLD, every estimate hour: the same test with `h = travelGFtoLF` of OLD; violations | 0 |
| B07_shown_recomputed | both files, every estimate hour: `shownP` of 2.5 differs from `predictedCFS` (number equality); violations | 0 |
| B08_own_truth_rebuilt | both files, every estimate hour with non-blank `truthFlow`: `truth(epoch ms of tauTs)` missing or differing from `truthFlow` by more than `1e-6 * max(1.0, abs(truthFlow))`; violations | 0 |
| B09_counts_file | for each run, the counts file against the learn file: (data rows of the learn file = `learn_validations`) and (`learned` + `hard_skipped` = `learn_validations`) and (rows with `outcome == "learned"` = `learned`) and (rows with `outcome == "hard_skipped"` = `hard_skipped`) and (the sum over burnin, design, test of `n_learn_rows` = `learn_validations`); violations (five tests per run, ten in all) | 0 |
| B11_common_fixed | the common truths at the exact time (no ceil, no 11 minutes), tolerance `1e-6` absolute, "none" means missing; violations over the 6 x 3 values: `predTs` / `clockQ` / central / long / short: `2013-10-07T10:00:00.000Z` / 1370 / 1517.829896030 / 1703.794713267 / 1370.000000000; `2015-12-26T11:00:00.000Z` / 20450 / 20800.000000000 / 20800.000000000 / 20566.931502563; `2019-12-04T05:00:00.000Z` / 3750 / 3830.000000000 / 3830.000000000 / 3750.000000000; `2023-09-24T13:00:00.000Z` / 5945 / 6210.000000000 / 6365.964228735 / 6345.617093952; `2020-06-01T05:00:00.000Z` / 11150 / 11200.000000000 / 11200.000000000 / 11150.000000000; `2026-07-20T18:00:00.000Z` / 2960 / none / none / none. (Computed with the rule of section 4 and 2.3 on these hours of the NEW file; on the staircase the first row would give 1542.2917, which is `truthFlow`, so the check separates the two readings. The hours are tested on the common-truth function only, before the hard-flag rule.) | 0 |
| B10a_mae_all | test, central common truth, group `all`: `mae(NEW) <= mae(OLD)` on written values | `NEW<=OLD` |
| B10b_mae_lf_rising | the same for `lf_rising` | `NEW<=OLD` |
| B10c_mae_low_water | the same for `low_water` | `NEW<=OLD` |
| H01_pending_end | health stop rule 10.1: `pending_at_end` is 0 in both runs; `got` `<OLD>:<NEW>` | `0:0` |
| H02_rates | health stop rule 10.1: for `x` in `dropped_missed_window`, `retries`, `hard_skipped`: `2 * x_NEW * slots_stored_OLD <= 3 * x_OLD * slots_stored_NEW`; violations (0 to 3) | 0 |
| H03_jump_p99 | health stop rule 10.1: test period, `2 * mic(corr_jump_p99 NEW) <= 3 * mic(corr_jump_p99 OLD)`; violations | 0 |
| H04_jumps_ge5 | health stop rule 10.1: test period, `2 * n_jumps_ge5(NEW) <= 3 * n_jumps_ge5(OLD)`; violations | 0 |
| I01_design_mae_all, I01_design_mae_lf_rising, I01_design_mae_low_water | information: the three comparisons of B10 for the design period (`got` as in B10, result `I`) | |
| I02_new_travel_same | information: count of estimate hours where the text of `travelGFtoLF` differs between OLD and NEW (B03 already requires 0) | |
| I03_clockq_lfcap | information: count of estimate hours where `abs(clockQ - lfCap) > 1e-9 * max(1.0, abs(lfCap))` | |
| I04_hard_in_common | information: test hours with the central truth present and in range that are left out by the `hard_flag_either` rule, counted by flag in OLD and in NEW (`got` `<OLD>:<NEW>`) | |
| I05_unjoined | information: `n_unjoined` of OLD and NEW over both periods (`got` `<OLD>:<NEW>`) | |
| M01_err15_margin | information: pairs (hour, truth, run) over the three common truths and both runs on valid hours with `0 < abs(abs(error) - 15.0) < 1e-9` | |
| M02_err15_exact | information: the same pairs with `abs(error) == 15.0` exactly | |
| M03_cap_margin | information: estimate hours with `0 < abs(u - 1.2 * L) < 1e-9 * max(1.0, abs(u))`, OLD and NEW (`got` `<OLD>:<NEW>`) | |
| M04_lfrise_margin | information: hours with `Row(6)` non-blank and `0 < abs(L - 1.10 * L6) < 1e-9 * max(1.0, abs(L))` | |
| M05_due_knife | STOPPING, expected 0: estimate hours of OLD (`h = travelGFtoLF`) or NEW (`h = clockHrs`) with `abs(dueMs - 3600000.0 * floor(dueMs / 3600000.0 + 0.5)) < 1.0` (milliseconds, 0 included); `got` is the total. A one-unit difference in the last place of `h` moves `dueMs` by less than 0.001 ms, so when M05 is 0 the validation hour of B05 and B06 is the same in Python and R. If M05 is not 0, stop and report the hours; do not change B05 or B06. Result `P` or `F` | 0 |
| M06_floor_margin | information: estimate hours with `abs((u + 0.5) - floor((u + 0.5) + 0.5)) < 1e-9` (0 included), OLD and NEW (`got` `<OLD>:<NEW>`) | |
| M07_jump_margin | information: steps of block 3 with `abs(jump - 5.0) < 1e-9` (0 included), OLD and NEW (`got` `<OLD>:<NEW>`) | |

Count of rows: U 18, S01 to S12 12, S13 to S16 4, G01 to G22 22, G23 and G24 2, B01 to B09 9, B11 1, B10a to B10c 3, H01 to H04 4, I01 x3 3, I02 to I05 4, M01 to M07 7: 89.
Stopping checks: every row with result `F` (the H rows and M05 included). Information rows (result `I`) never stop. A tolerance is applied exactly as written.

## 15. Compare tool (contract) [source: cap 19, ons]
`compare_analysts.py` (standard library; written separately from this file, placed in this folder). After both analysts finish, from this folder: `python3 -I compare_analysts.py py r`.
1. It looks at the 11 `.csv` files of 13.2 (other files are ignored; a `.csv` of another name on one side only, or a file missing, empty or with another header on one side, is a difference). Expected headers and numbers of data rows are those of 13.2 (`checks.csv` 89, `row_accounting.csv` 40, `learning_health.csv` 82).
2. Key columns, which must equal the expected values in the expected order on both sides: `badly_low_rising.csv` `period,truth,run`; `movement.csv` `period,group`; `groups.csv` `period,group`; `two_by_two.csv` `period,group,run,truth`; `common_truth_errors.csv` `period,group,truth,run`; `new_cap_yardsticks.csv` `period,group,truth,comparison`; `new_readings.csv` `period,group,comparison`; `self_report.csv` `period,run`; `learning_health.csv` `run,period,metric`; `checks.csv` `id`; `row_accounting.csv` `scope,step`. Integer columns and text columns are compared as text.
2a. Column types. Text: `period, group, run, truth, comparison, label, label_central, label_long, label_short, reading, direction_by_count, metric, source, scope, condition, id, description, expected, got, result`. Integer: as 13.1. Decimal (`%.6f`): every other column. The format guard applies to integer and decimal columns only, and in `learning_health.csv` to `value` by its own regex. `checks.csv` is compared as text first, so its mixed `expected` and `got` cells need no typing. Exit status 0 only for AGREE.
3. Step 1, exact text: for each file whether the two are byte for byte equal. `checks.csv`, `row_accounting.csv`, `groups.csv`, `badly_low_rising.csv`, `new_readings.csv` must be equal as text (tolerance 0), or the result is `DIFFER`.
4. Step 2, numeric fall-back for the others: every integer and text column equal as text; every `%.6f` column within 0.01 (absolute); a number written with a different number of decimals is a FORMAT difference; a blank against a number is a difference. In `learning_health.csv` the `value` cell is typed by its text: matching `^-?[0-9]+\.[0-9]{6}$` is a decimal (tolerance 0.01), matching `^-?[0-9]+$` an integer (exact).
5. Format guards on both sides: no leading or trailing space, no quote, no CR, no BOM, a final newline; every numeric cell is empty or matches `^-?[0-9]+(\.[0-9]{6})?$`; the literal `-0.000000` is never present.
6. It prints one line per file, `BYTE-IDENTICAL: yes|no`, and as the last line `AGREE` only if every file passes steps 1 to 5, else `DIFFER`. If the run stopped after `checks.csv`, the other files are missing and the result is `DIFFER`. If the analysts differ, stop and find the cause; never average or pick one.

## 16. Open points for the orchestrator

Choices between two readings of the plan, and counts, in the order of the specification.

0. **Corrected by the orchestrator after the tool audit (section 4, checks B05 and B06, 7.1, 13.3).** The first instruction made the common truths read Little Falls at the first whole hour at or after the due time minus 11 minutes. It was wrong. Following plan 3.2 literally, the common truths read Little Falls at the exact time `t + h` (no rounding up, no 11 minutes); the staircase applies to each run's OWN truth only, and the built-in check (i) is now: each run's own truth rebuilt with the staircase from its own clock (NEW: `clockHrs`; OLD: `travelGFtoLF`) must equal that run's `truthFlow` (B05, B06). Also added on the orchestrator's word: paired comparisons on own truths use only hours with a truth in both runs, with the dropped hours in the row accounting (step 3 of `two_by_two`).
1. **Hours with an estimate (60,120).** The plan's number counts `status` `predicted` (59,746) plus `no_truth` (374) in OLD. I define "has an estimate" by non-blank `predictedCFS`, `rawUnc`, `corrUsed`. The cap study's "scored hours" (59,448 test hours) is a different, smaller set (own truth required, hard flags dropped); I use the larger set for groups and movement and require a truth only where an error is computed.
2. **Low water (about 16,100).** Rule: `lfCap < 3000` and outside the analysis window `[a, b]` of every one of the 225 units (events, kept small onsets, bumps, recessions). It gives 16,140 (the plan audit's own count for this reading). Using the rising limbs instead of the windows gives 16,682; using the windows of events and small onsets only gives 17,745. Hours that are Little Falls rising are NOT excluded from low water (the audit, F4, suggested excluding them; plan 3.3 does not; excluding them would give 15,497). Groups therefore overlap (643 test hours are both low water and Little Falls rising, and they enter B10c). The reviewer's ruling stands: the plan's text and its number decide.
3. **Little Falls rising (about 4,500).** `lfCap` of the hour at least 1.10 times `lfCap` six hours EARLIER: 4,514 in the test years (design 4,428). The audit's count (also 4,514) looked forward (`LF(t+6) >= 1.10 LF(t)`). The plan's words are backward; I follow the words. (The audit's forward set on hour `t` is the backward set on hour `t + 6`, so the count is the same: the same pairs moved six hours.)
4. **Rising limbs of rises (2,975 and 4,488).** Limb = `[start_key, peak_key]` of `units.csv`; `event` plus `small` give 2,975 and with `bump` 4,488, both exact. All 225 units count, including units that failed the clock study's 0.6 gate or the creek cut.
5. **High water.** `lfCap` in [12,000, 20,000) is 7,271 and `lfCap >= 20,000` is 4,480, both exact. The flow measure is `lfCap`, not `flowBin` and not the shown value.
6. **Hard flags (changed in 1.1, review F8).** An hour hard-flagged (`truthDependentHard == "1"`) in EITHER run is left out of every common truth, for both runs alike: checks 2 and 3 flag a Little Falls reading that is physically suspect, it sits within an hour of the common truth, and the app never scores such a pair. The two-by-two set already uses "either". The learning-track scoring uses `learned` rows only (hard-skipped rows left out, as the app's accuracy does). I04 counts the hours left out.
7. **Creek share.** The plan says "the clock study's creek share of each rise"; the clock study writes three shares (lower, upper, whole). I use `share_lower` (Edwards Ferry to Little Falls, the leg the clock is measured on). With `share_whole` almost all rises would be creek-fed. Cut: `> 0.15` on the written six-decimal value; rise 34 sits at 0.155605. Limit, for the report: the lower leg includes Seneca and Broad Run, which join above Great Falls and which the model gauges, so "creek-fed" here is not the same as "fed below Great Falls". Split of the 13 test rises: 5 creek-fed (28, 30, 34, 39, 53), 8 not; 159 and 293 hours.
8. **Movement is relative to OLD's shown number** (`(NEW - OLD) / OLD`), in percent. "Direction on rising water" is the label `lower`, `higher` or `equal` from the counts of hours moving down and up.
9. **Item 2** is reported for the group `lf_rising` only, on valid hours, with the NEW-minus-OLD difference as a third row. No other group and no bootstrap interval were added.
10. **Two-by-two.** The set is the intersection of both runs' own scored sets (truth present, status `predicted`, no hard flag, truth in production range, in both runs), so the four cells use the same hours. `other` means the other run's own truth rebuilt at the other run's `tauTs`.
11. **`common_truth_errors.csv`** (errors of each run on each common truth, per group) is an addition needed for item 7 and for items 2 and 3; it is a table of the same measures, not a new analysis.
12. **Yardsticks (changed in 1.1, review F5).** `Y1 = floor(L + max(0.0, ((L - L3) / 3.0) * (clock + a)) + 0.5)` with `clock` the NEW clock of section 4 on all three truths, `a = age_lf_h`; the 3 hours are fixed. Both yardsticks and the no-cap value are rounded with `floor(x + 0.5)`. This overrides the last clause of plan audit F14 ("it must use the clock of each truth"), by the orchestrator's ruling: with the clock of each truth `Y1` would become a different estimator on each truth and "holds on all three" would stop protecting. "The clock" is the term of plan section 2, `clock(Q)`.
13. **Interval labels (renamed in 1.1, review F3).** `cap`: as the cap study (`d = |error without cap| - |error with cap|`, `cap_closer` if the lower bound is above 0). Yardsticks use the same sign: `app_closer` if the lower bound of `|error yardstick| - |error app|` is above 0. "Holds only if the same on all three truths" is `reading != mixed` and not `unclear` (`holds`). An all-`unclear` triple is not a finding. The rule is one-sided in effect (a built-in lean of the short-end truth, 8.3) and the report must say so; the two columns `n_low_app` and `n_low_other` show the badly-low counts beside the label.
14. **Intervals are also computed for the design period** (85 months) and for every group, including the small groups `rl_large_creekfed` and `rl_large_notcreek` (a handful of rises). With so few rises many such intervals will be wide or blank. Nothing is thinned.
15. **Self-assessment (item 5)** uses the learning track only, on `learned` rows (hard-skipped rows are not scored, as the app's accuracy leaves them out; the app's notice does count hard-flagged pairs, so the real notice duty differs a little). A learn row is scored against its own truth at its own `tauTs` (retried rows get a later truth). The learning track is a subsample steered by the clock (a blocked slot is never scored); the plan names this track, so the shadow track is not used. Scored per day uses fixed spans (62,088 and 60,120 hours).
16. **Health of the correction (item 6)** uses `corrUsed` (unrounded) as the applied correction and `rawUnc` as the uncorrected estimate; `correctionApplied` and `rawFinalCFS` in the file are rounded integers and are not used. This departs from plan audit F6, which divided `correctionApplied` by `predictedCFS`: `rawUnc` is identical in both runs (B03), so the jump differs between the runs only because the correction differs, and `corrUsed` avoids the rounding steps. Steps include a change of cell or state between two hours. Only consecutive hours both with an estimate count.
17. **Cap binding** is the cap study's definition `u > 1.2 * L`, computed on each run's own `u`.
18. **Common truths versus own truths.** See open point 0. The central common truth is therefore NOT NEW's learning truth; the difference (a whole number of hours plus 0.817 h on the staircase against the exact time) is a known property, stated up front.
19. **Clock computed from `clockQ`, never read from `clockHrs`, for the common truths.** B04 requires them equal within 1e-9 hours. The own-truth checks B05, B06 and M05 read the long decimals `clockHrs` and `travelGFtoLF`; M05 (stopping, 1.1) guards the one case where a last-digit parsing difference in R could move a due time across an hour boundary, so that when M05 is 0 the validation hour is the same in both languages. `pow` was tested equal in Python and R for seven flows.
20. **Which `L` defines the groups.** OLD's `lfCap`; B03 requires `lfCap` identical in NEW. `clockQ` is expected to equal `lfCap` (information row I03 only).
21. **Status differs by run.** `no_truth` and `status` depend on the run's own clock and truth, so B02 compares estimate hours, not status.
22. **B05 and B06 include burn-in hours.** Checked by the reviewer on both runs including burn-in: 0 violations (closed in 1.1, review F15).
23. **Check 7 (B10)** is a stopping check on the test period only. The design period is information.
24. **Counts the writer made but the plan does not give:** the design-year counts, the creek split (159 and 293 hours test; 167 and 108 design), the rise counts. They are checks on the analysts' reading of the rules (a mismatch stops), not findings.
25. **R speed.** The bootstrap has 180 interval rows times 10,000 draws; aggregate once per interval row to blocks (`S_j`, `N_j`) as written.
26. **Compare tool** is to be written from section 15 and placed in this folder before the analysts finish.
27. **Counts that did not reproduce:** none. Every count of the plan is reproduced exactly (60,120; 2,975; 4,488; 7,271; 4,480; 452); the two "about" numbers come out as 4,514 and 16,140. See 3.3.

## 17. The report to the owner (order and limits)

The report to the owner (written by the orchestrator after the third auditor, not by the analysts) opens in this order: (1) the staircase property; (2) Known property 2 (F4); (3) `badly_low_rising.csv`, test rows, both runs, three common truths, with the design rows beside; (4) movement on rising water; then items 3 to 6 in plan order; (5) at the end, what the replay cannot show: PLAN section 6, TOOL_AUDIT "What this replay cannot show" 1 to 7, and that no verdict is computed.

## 18. Changes from 1.0 to 1.1

| Finding | What changed | Section |
|---|---|---|
| F1 (blocker) | `description` of `checks.csv` is the id itself | 14 |
| F2 | health stop rules H01 to H04 added with the plan audit's 1.5 and exact integer tests; three rate metrics; `checks.csv` 89 rows (with F6, F9, F10), `learning_health.csv` 82 rows | 10, 10.1, 13.2, 14 |
| F3 | labels `cap_closer`, `cap_farther`, `app_closer`, `yardstick_closer`; columns `n_low_app`, `n_low_other`; short-end known property | 8.1, 8.3, 13.2, 14 (U16, U17), 16 |
| F4 | Known property 2 at the top and at the end of sections 6 and 7.2 | preamble, 6, 7.2 |
| F5 | `Y1` uses the NEW clock on all three truths | 8, 14 (U14), 16 (12) |
| F6 | check B11 with six fixed hours | 14 |
| F7 | report order and what the replay cannot show | 17 |
| F8 | hours hard-flagged in either run left out of the common truths; row accounting 40 rows; I04 | 4, 13.3, 14, 16 (6) |
| F9 | M05 a stopping check in milliseconds, 0 included | 14, 2.6, 16 (19) |
| F10 | 2.6 (a) corrected; M06 and M07 added | 2.6, 14 |
| F11 | R doubles and the hourly map as a numeric vector | 1.0 |
| F12 | `sum()` caveat; vectorised bootstrap loop allowed | 2.2, 8.2 |
| F13 | empty-set values; M rows result `I`; "mean error" read as `mae`; `direction_by_count`; sources note; `units.csv` fields are hour keys; `Y1` gap limit | 8.1, 14, 11, 5, 9.1, 3.2, 8 |
| F14 | column types and exit status of the compare tool | 15 |
| F15 | open point 22 closed | 16 |

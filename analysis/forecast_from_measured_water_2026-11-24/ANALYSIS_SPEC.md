# Analysis specification, Stage 1: can water already measured upstream improve the Great Falls forecast? (version 1.2)

## Changes in version 1.2 (2026-11-24, by the orchestrator, from the reviewer's second pass in `SPEC_REVIEW.md`; before any analyst started)

- Section 10, check C12: the 11 rows that differ by exactly 0.5 occur in BOTH whole files, not only in A (the reviewer's correction of his own figure). Not a violation.
- Section 12, review finding 12: the compare tool counts a FORMAT mismatch only when the shape of two numbers differs; numbers of the same shape within 0.01 agree.

## Changes in version 1.1 (2026-11-24; version 1 is kept as `ANALYSIS_SPEC_v1.md`; source: `SPEC_REVIEW.md` and the orchestrator's rulings)

- Review finding 1 (MUST): new check `C12_clock_alignment` (section 10) ties the hourly file's clock to the replay's clock; `porQ`, `historicPorCFS` added to the columns read (2.1); explicit UTC parsing rules for both languages (2.2).
- Finding 2: condition 4 ruled by the orchestrator, date only, recorded before any run (9.4, 13 item 16, section 14).
- Finding 3: `est` is blank only when the cell's `n = 0` (9.3, 11.3).
- Finding 4: decision tests use the values as written with `%.6f`, compared as integers in units of 1e-6, with a worked example (9.4).
- Finding 5: `tools/compare_analysts.py` fixed: required files, folder checks, row-order check, formatting mismatches counted separately, non-zero exit (section 12).
- Finding 6: skill values computed exactly, written `%.6f` (9.5).
- Finding 9 (partly): the made-up data set is unchanged; unit assertions for the rounding function and the hour-key parser added (section 8).
- Finding 10: item 4 of section 13 reconciled with section 4; C7 is now a design statement, not a mechanical check; notes on `python3 -I` imports and on R (`match()`, same `read.csv` settings).
- Finding 8: noted that nothing may rely on exact equality of doubles between the languages (section 0).


Written 2026-11-24 by the specification writer, BEFORE any result was computed or seen. It makes sections 4 to 8
of `PLAN.md` (version 2, binding) operational. Two blind analysts, one in Python and one in R, work from THIS FILE
and the data files named in section 1 only. Neither sees the other's code or output. If this file is silent or
contradicts itself on a point, do not guess: write the point into your `REPORT.md` under "Judgment calls" and make
the most literal choice. Nothing in this file is a result.

## 0. Environment (hard constraints)

- Python analyst: Python 3, standard library only (no numpy, no pandas). Run every script as `python3 -I script.py`.
- R analyst: R 4.5.2, base R only (packages base, stats, utils; no `tools`, no other library). Run as `Rscript`.
- Write only into your own folder: `py/` (Python) or `r/` (R), inside the study folder
  `analysis/forecast_from_measured_water_2026-11-24/`. Never read or list the other folder. Never write elsewhere.
  Everything else is read-only. No network. No installs.
- Read nothing from the study folder except: this file, `replay_B/shadow_L.csv`, `tools/boot_uniforms.csv` (and
  `tools/make_boot_uniforms.py` if you wish to see how it was made).
- Files are large (`shadow_L.csv` is 88 to 91 MB, 73 columns). Read it once, keep only the columns listed in
  section 2.1. In R, read the header line first, then call `read.csv` with `colClasses` (a vector named by the header:
  `"character"` for the needed columns, `"NULL"` for all others), `quote = ""`, `comment.char = ""`,
  `na.strings = character(0)`, `stringsAsFactors = FALSE`; convert to numbers yourself. In Python use the `csv` module
  with `newline=''`.
- Nothing may rely on exact equality of doubles between the two languages: R and Python parse some long decimals one unit in the last place apart (harmless: the comparison tolerance is 0.01 and the block mapping uses integers).
- Python: `python3 -I` removes the script's own folder from the import path. Use a single-file script, or add the path explicitly (`sys.path.insert(0, <folder of the script>)`) before importing a sibling module.
- R: look rows up by key with `match()` on vectors, and compute cases as vectors; never loop row by row over a data.frame for the roughly 475,000 cases. Use the SAME `read.csv` settings (character columns, `na.strings = character(0)`, `quote = ""`, `comment.char = ""`) for the replay files, the hourly files and the event file (a default read turns `kept` into integers with NA for blanks), and convert yourself.
- One command must rebuild all of your outputs from the raw files: `python3 -I py/run_all.py` or
  `Rscript r/run_all.R`, run from the study folder. Put a short `README.md` for it in your folder.

## 1. Input files (paths relative to the study folder `analysis/forecast_from_measured_water_2026-11-24/`)

| Role | Path | Facts (checked on 2026-11-24, counts only) |
|---|---|---|
| Period A replay | `../replay_lag_2026-11-17/shadow_L.csv` | 127,463 data rows, one per whole UTC hour 2011-12-01T05 to 2026-06-16T03, no duplicates, ascending. SHA-256 `b6a917c0a7092d36594a7ee1de44f05df6ad1d70626eefe6aba2fb2e23011e1d`. Status counts: predicted 125,099; no_por 1,014; no_truth 911; no_lf 439. |
| Period A hourly flows | `../hourly_backtest_data_v361.csv` | 126,916 data rows, 2011-12-01 05:00 to 2026-06-16 03:00. **Line endings are CRLF** (strip a trailing `\r` if your reader keeps it). `por_now` is blank on 2,845 rows, never zero or negative (minimum 788). SHA-256 `b247c0be5f8c3c15a64a4c2e58b0bfb1097711c6f2da3c98b767fbea1e6941d3`. |
| Period B replay | `replay_B/shadow_L.csv` | 130,987 data rows, same 73 columns in the same order as period A, last `predTs` 2026-11-09T23:00:00.000Z. SHA-256 `549f200645b4bb9b2a6a43ee4bee00a84903726ceefdce259f73c54bed6b0d99`. Status counts: predicted 128,595; no_por 1,014; no_truth 939; no_lf 439. |
| Period B hourly flows | `../rising-limb-travel-backtest/hourly_backtest_data_v39.csv` | 130,416 data rows, to 2026-11-09 23:00. LF line endings. SHA-256 `d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f`. |
| Large rises | `../rising-limb-travel-backtest/rising_limb_events_python_v39.csv` | Keep rows with `kept == 1` AND `event_class == GATE`: exactly 21 rows (assert). SHA-256 `978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44`. Columns used: `event_id`, `event_t0`, `event_tp` (format `YYYY-MM-DD HH:MM`, minute always 00, same clock as the hourly files, UTC). 20 events lie in period A, 1 (`event_id` 53) in period B. |
| Bootstrap draws | `tools/boot_uniforms.csv` | 10,000 data rows, columns `u1`..`u175`, every cell a 12-digit zero-padded integer. 22,750,767 bytes. SHA-256 `4d5f1fcdfa5999864f21aae19480691b6fcb1e6cf239b32323e050c7f3bd4c38`. Made by `tools/make_boot_uniforms.py` (seed 20261124). |

Compute the SHA-256 of the files you can (Python: `hashlib`; R has no base SHA-256: skip it and assert the row counts
above instead). A mismatch stops the run.

**If period B cannot be built** (file `replay_B/shadow_L.csv` missing, unreadable, or its header line not identical to
period A's header line, or the v39 hourly file missing): write NO period B rows or files, write the line
`PERIOD_B_NOT_ANSWERED` and the reason into `REPORT.md`, and write `q4.csv` as described in section 11.6. Period A is
unaffected. (At the time of writing, period B exists.)

## 2. Parsing, time, keys, joins

### 2.1 Columns used from the replay files (header names exact, case sensitive)

`predTs, status, useTimeShifted, predictedCFS, flowBin, flowState, histSrcTs, porSrcTs, travelGFtoLF, lfQ, lfSrcTs,
truthFlow, truthInProdRange, truthDependentHard, hardFlag, porQ, historicPorCFS` (`porQ` and `historicPorCFS` are used only by check C12). Blank cell = missing. Numbers are plain decimals
(`travelGFtoLF` has up to 16 significant digits: read it as a double). Booleans are `1`/`0`.

From the hourly files: `timestamp` and `por_now` only. From the event file: `event_id, event_t0, event_tp, kept,
event_class`.

### 2.2 Timestamps and the hour key

- Time zone: everything is UTC, in ALL files including the hourly files' `YYYY-MM-DD HH:MM`. Never use local time.
  Python: parse the fields as integers and use `calendar.timegm` (or `datetime(..., tzinfo=timezone.utc)`); never `time.mktime` or a naive `datetime.timestamp()`.
  R: always `as.POSIXct(x, format = ..., tz = "UTC")`, never without `tz = "UTC"` (default is the local zone, which shifts every key by 4 or 5 hours); then `as.numeric(.) / 3600`. Check C12 detects a shift.
- Replay timestamps (`predTs`, `histSrcTs`, `porSrcTs`, `lfSrcTs`): `YYYY-MM-DDTHH:00:00.000Z`.
  Hourly and event timestamps: `YYYY-MM-DD HH:MM` (hour start, minute 00).
- **Hour key** `K(ts)` = the whole number of hours from 1970-01-01 00:00 UTC to that timestamp (an integer). The two
  formats of the same instant give the same key. Assert that every timestamp you parse has minute 00 (and, for the
  replay format, seconds 00 and `.000Z`); a violation is counted in check C9 (section 10).
- Literal tests of the parser (part of the unit assertions, section 8): `2020-01-01T00:00:00.000Z` and `2020-01-01 00:00` both give 438288; `2026-06-16T03:00:00.000Z` and `2026-06-16 03:00` both give 494883.
- Output timestamps are always written in the replay format `YYYY-MM-DDTHH:00:00.000Z`.
- `t` = the issue hour = `K(predTs)` of the issue row. `s = t + h` = the target hour.
- **Rows** are looked up by key: `R[k]` = the replay row with `K(predTs) = k`; `Q[k]` = `por_now` of the hourly row with
  `K(timestamp) = k` (blank = missing; absent row = missing). `Q(u)` in the plan is `Q[u]`.
- Join: the target row of an issue row is `R[t + h]` of the SAME replay file. No other join exists. The hourly file
  of a period is the one in section 1 for that period (A: v361; B: v39). Period A and period B never mix files.

### 2.3 Whole hours (checked)

On all predicted rows of both replay files `histSrcTs` (where non-blank), `porSrcTs` and `lfSrcTs` are exact whole hours,
and `histSrcTs <= porSrcTs`. `histSrcTs` is blank exactly when `useTimeShifted = 0` (1,641 predicted rows in A).
Observed ages: `t - porSrcTs` is at least 2 hours, `t - lfSrcTs` at least 1 hour. Therefore no rounding of hour
timestamps is ever needed; the checks of section 10 assert it on every forecast.

## 3. The variables of plan section 4 (all from the issue row at `t` unless stated)

| Plan symbol | Definition (exact column) |
|---|---|
| `LF(t)` | `lfQ` (double). Must be > 0. |
| `lfs` | `K(lfSrcTs)` |
| `ageLf` | `t - lfs`, in whole hours (integer difference of keys; no rounding) |
| `T_GL` | `travelGFtoLF` (hours, double) |
| `RT` = `round(T_GL)` | `floor(T_GL + 0.5)`, i.e. halves round UP. **Do not use R's `round()`** (it rounds halves to even) and do not use Python's `round()`. (On both real files no value lies closer than 0.0001 to a half, so the rule never decides a real case; the synthetic data of section 8 test it.) |
| `hist` | `K(histSrcTs)` |
| `por` | `K(porSrcTs)` |
| `u*` | `min(hist + h, por)` |
| `u_LF` | `hist - RT - ageLf` |
| `Q(u*)`, `Q(u_LF)` | `Q[u*]`, `Q[u_LF]` from the period's hourly file |
| `inside` | `1` if `hist + h <= por`, else `0` (then `u* = hist + h`); `0` means beyond the lead (then `u* = por`) |

## 4. Issue rows, burn-in, statuses

**Issue rows.** Every row of the period's replay file with `K(predTs)` inside the period window, whatever its `status`:
- Period A: `predTs >= 2012-12-01T00:00:00.000Z` (burn-in is everything earlier). No upper limit (the file ends
  2026-06-16T03:00). Expected: 118,684 issue rows (116,348 with status `predicted`), 163 calendar months.
- Period B: `predTs >= 2026-08-28T00:00:00.000Z` (file ends 2026-11-09T23:00). Expected: 1,776 issue rows (1,763 predicted),
  12 weeks.

Each issue row is combined with each `h` in {6, 12, 24, 48}: one **forecast case** `(t, h)`. Every case gets exactly ONE
status, the first rule below that applies (order of precedence = order of the list). The status of a case does not
depend on the arm.

| # | Status code | Rule |
|---|---|---|
| 1 | `ISSUE_NOT_PREDICTED` | issue row `status != "predicted"` |
| 2 | `ISSUE_LF_MISSING` | `lfQ` blank or `<= 0` |
| 3 | `TARGET_NO_ROW` | no replay row with key `t + h` |
| 4 | `TARGET_NOT_PREDICTED` | target row `status != "predicted"` (this includes `no_truth`, `no_por`, `no_lf`) |
| 5 | `TARGET_TRUTH_MISSING` | target `truthFlow` blank or `<= 0` |
| 6 | `TARGET_HARD_FLAG` | target `truthDependentHard == 1` |
| 7 | `TARGET_OUT_OF_RANGE` | target `truthInProdRange == 0` |
| 8 | `NO_TIMESHIFT` | issue `useTimeShifted != 1` or `histSrcTs` blank |
| 9 | `ISSUE_FIELD_MISSING` | issue `porSrcTs`, `lfSrcTs` or `travelGFtoLF` blank |
| 10 | `Q_USTAR_MISSING` | `Q[u*]` missing (absent hourly row or blank `por_now`) |
| 11 | `Q_ULF_MISSING` | `Q[u_LF]` missing |
| 12 | `Q_NONPOSITIVE` | `Q[u*] <= 0` or `Q[u_LF] <= 0` |
| 13 | `SCORED` | none of the above |

Notes.
- `truthDependentHard` is the hard flag (checks 2 and 3 of the replay). In both replay files it equals `hardFlag` on
  every predicted row (check C8). Never use `softFlag`, `chk*` or `outlierZ`.
- Rule 12 applies to all arms: if `Q(u_LF)` is zero or negative the proportional arm R-LFm is undefined, and so that
  every arm stays on the same cases the case is dropped for ALL arms (counted, not hidden). A non-positive `Q(u*)` is
  treated the same way (a flow cannot be non-positive). On the real files this never occurs (minimum 788); the
  synthetic data test it.
- Rules 1 to 7 are about the issue row, the target and the truth; rules 8 to 12 about the measured-water arms. So the
  cases of status 8 to 13 (the **Q4 set**) are exactly those on which P-LF (which needs only `lfQ`, the target and
  its truth) can be scored. The **pairing set** (section 6) is `SCORED` only.
- Per period and horizon report the number of cases with each status (section 11.2). The burn-in rows are not cases.

## 5. Arms, reference levels, truth and errors

For a `SCORED` case, with `F` = forecast and `truth` = `truthFlow` of the target row `R[t + h]`:

| Arm | Forecast |
|---|---|
| `P-LF` ("no change", baseline) | `lfQ` |
| `R-LF` (measured water, primary) | `lfQ + Q[u*] - Q[u_LF]` |
| `R-LFm` (proportional, sensitivity) | `lfQ * Q[u*] / Q[u_LF]` |
| `REF_NOW` (reference, descriptive) | `predictedCFS` of the target row `R[t + h]` |
| `REF_HELD` (reference, descriptive) | `predictedCFS` of the issue row `R[t]` |

- No clipping or flooring: a forecast may be negative; it is scored as it is. No rounding before the error.
- Signed error (percent): `err = 100 * (F - truth) / truth`. Absolute error `|err|`. "Points" = percentage points of
  error.
- The reference levels are scored on the pairing set only. They are NOT part of the pairing rule: a missing
  `predictedCFS` (it is never blank on predicted rows, checked) would only remove that case from that reference's own
  metrics (its `n` is reported per arm), never from any other arm. P-LF, R-LF and R-LFm are always scored on exactly
  the same cases.
- The target's `truthFlow` is used only to score. Forecasts are computed first, by a function that receives only the
  issue row and the hourly flows (design requirement; state in `REPORT.md` how you ensured it).
- Q4 only: P-LF is also scored on every case of the Q4 set (status 8 to 13), period B (section 9.5).

## 6. Metrics, pairing

A **metric cell** is `(period, h, lead, dim, level)` (section 7) and an arm. On the pairing set restricted to the cell,
for each arm with `n` cases:
- `n`
- `mae` = mean of `|err|`
- `medae` = median of `|err|` (sort; odd `n`: the middle value; even `n`: mean of the two middle values)
- `mean_signed` = mean of `err`
- `share_gt25` = `100 * (number of cases with |err| > 25) / n` (strict inequality), a percentage.

Arms in this order: `P-LF, R-LF, R-LFm, REF_NOW, REF_HELD`. A cell with `n = 0` has blank `mae, medae, mean_signed,
share_gt25`.

Differences between arms: `D_PR = mae(P-LF) - mae(R-LF)` and `D_PRm = mae(P-LF) - mae(R-LFm)` (positive = the measured-water
arm has the smaller error), and `S_RP = mean_signed(R-LF) - mean_signed(P-LF)`.

## 7. Subsets (fixed in advance), all by the ISSUE row

`lead` (3 values, in this order): `all` = every scored case; `inside` = scored with `inside = 1`; `beyond` = scored with
`inside = 0`.

Dimensions and levels (every dimension is crossed with every `lead`; no other crossing exists). Order of dims and
levels as listed:

| `dim` | `level` values (this order) | Rule |
|---|---|---|
| `all` | `all` | every case |
| `flowBin` | `0-3000`, `3000-6000`, `6000-12000`, `12000-25000`, `25000-50000`, `50000+` | issue-row `flowBin` (the production flow ranges at issue, the replay's own label) |
| `flowState` | `rising`, `steady`, `falling` | issue-row `flowState` |
| `largeRise` | `in_window`, `out_window` | `in_window` if for any of the 21 events `K(event_t0) - 48 <= t <= K(event_tp)` (inclusive both ends; the union of the windows; a case counts once); else `out_window` |
| `season` | `in_season`, `out_season` | by the UTC date of `predTs`: with `md = 100*month + day`, `in_season` if `915 <= md <= 1215` (15 September to 15 December inclusive, all 24 hours of both end dates), else `out_season` |
| `seasonLow` | `in_season_lf_lt3000`, `out_season_lf_lt3000` | the `season` rule AND `lfQ < 3000` (strict) at issue; cases with `lfQ >= 3000` are in no level of this dimension |
| `era` | `2012_2018`, `2019_2026` | UTC year of `predTs`: 2012 to 2018, or 2019 to 2026 |

That is 18 levels x 3 leads x 4 horizons = 216 metric cells per period. Every cell is written, also when `n = 0`.
(Period B: `era 2012_2018` is always empty and `largeRise in_window` can hold only the October 2026 rise.)

The decision rule (section 9.4) uses exactly these cells: `(h, inside, all, all)`, `(h, inside, flowState, rising)`,
`(24, inside, season, out_season)`. Everything else is descriptive (Q2: `inside` against `beyond`; Q3: the dimensions).

## 8. Check on made-up data (must pass BEFORE the real data are touched)

Both analysts build this tiny data set in memory with their own code and assert the expected values. Failure stops the
run (before any real file is read) and is reported in `REPORT.md`; the pass is recorded in `checks.csv` (section 10).

**Hours.** `i = 0..95`; `hour(i)` = `2020-01-01T00:00:00Z + i hours`. (`hour(i)` for `i < 0` is the earlier hour; it simply
has no replay or hourly row.) Use the same code path as for real data (the hour key, the statuses, the arms), applied to this
in-memory data with the window = all rows.

**Hourly flows** `Q(u)`, `u = 0..95`, three series:
- S0 (constant): `Q = 1000` for all `u`.
- S1 (step): `Q = 1000` for `u < 60`, `Q = 1500` for `u >= 60`.
- S2: S1, but `Q(50)` is blank (missing) and `Q(3) = 0`.

**Replay rows** `i = 0..95`. Defaults for every row:
`status = predicted`, `useTimeShifted = 1`, `lfQ = 2000`, `lfSrcTs = hour(i-1)`, `travelGFtoLF = 2.5`,
`porSrcTs = hour(i-2)`, `histSrcTs = hour(i-20)`, `predictedCFS = 1000 + 10*i`, `truthFlow = 2000 + 20*(i mod 5)`,
`truthInProdRange = 1`, `truthDependentHard = 0`, `hardFlag = 0`, `flowBin = 0-3000`, `flowState = steady`.
Exceptions:
- row 5: `status = no_por`, all other fields blank.
- row 7: `useTimeShifted = 0`, `histSrcTs` blank.
- row 12: `lfQ` blank.
- row 14: `porSrcTs` blank.
- row 20: `truthDependentHard = 1`, `hardFlag = 1`.
- row 30: `status = no_truth`, `truthFlow` blank.
- row 31: `truthFlow` blank (status stays `predicted`).
- row 90: `truthInProdRange = 0`.

No rows exist for `i >= 96`.

Consequences: `RT = floor(2.5 + 0.5) = 3` (an R `round(2.5)` would give 2: the test catches it), `ageLf = 1`,
`u_LF = (i-20) - 3 - 1 = i - 24`, `u* = min(i - 20 + h, i - 2)`, `inside` is 1 for `h` = 6 and 12 and 0 for `h` = 24 and 48.

**Expected, S0 (constant Point of Rocks):** on every scored case `R-LF = R-LFm = P-LF = 2000` exactly (difference 0).

**Expected status counts** (cases, per horizon; S0 and S1 are identical):

| status | h=6 | h=12 | h=24 | h=48 |
|---|---:|---:|---:|---:|
| ISSUE_NOT_PREDICTED | 2 | 2 | 2 | 2 |
| ISSUE_LF_MISSING | 1 | 1 | 1 | 1 |
| TARGET_NO_ROW | 6 | 12 | 24 | 48 |
| TARGET_NOT_PREDICTED | 1 | 1 | 1 | 0 |
| TARGET_TRUTH_MISSING | 1 | 1 | 1 | 0 |
| TARGET_HARD_FLAG | 1 | 1 | 0 | 0 |
| TARGET_OUT_OF_RANGE | 1 | 1 | 1 | 1 |
| NO_TIMESHIFT | 1 | 1 | 0 | 1 |
| ISSUE_FIELD_MISSING | 0 | 1 | 1 | 1 |
| Q_USTAR_MISSING | 11 | 6 | 2 | 2 |
| Q_ULF_MISSING | 9 | 11 | 17 | 18 |
| Q_NONPOSITIVE | 0 | 0 | 0 | 0 |
| SCORED | 62 | 58 | 46 | 22 |

(Each column sums to 96.) For **S2** the counts differ from S1 only here (h = 6, 12, 24, 48): `Q_USTAR_MISSING` 12, 7, 3, 2;
`Q_ULF_MISSING` 10, 12, 17, 18; `Q_NONPOSITIVE` 1, 1, 1, 1; `SCORED` 59, 55, 44, 21.

**Expected, S1 (step), scored cases:**
- `R-LF - P-LF` is exactly +500 and `R-LFm - P-LF` exactly +1000 on the scored cases with `t` in
  `[74, 83]` (h=6), `[68, 83]` except 78 (h=12), `[62, 71]` except 66 (h=24); and exactly 0 on every other scored case
  (h=48: none differ). So the step appears once, with its full size, and only at the hours these rules give. (The
  `t` values left out are cases removed by status; e.g. `t = 78, h = 12` has target row 90.)
- Explicit rows (S1):

  | t | h | `u*` | `u_LF` | inside | P-LF | R-LF | R-LFm | REF_NOW | REF_HELD | truth |
  |---|---|---|---|---|---|---|---|---|---|---|
  | 80 | 6 | 66 | 56 | 1 | 2000 | 2500 | 3000 | 1860 | 1800 | 2020 |
  | 70 | 24 | 68 | 46 | 0 | 2000 | 2500 | 3000 | 1940 | 1700 | 2080 |
  | 40 | 12 | 32 | 16 | 1 | 2000 | 2000 | 2000 | 1520 | 1400 | 2040 |

- Metrics on the S1 scored set, `lead = all`, `dim = all` (n; `mae` and `mean_signed` of each arm, to 0.0001):

  | h | n | P-LF mae / signed | R-LF mae / signed | R-LFm mae / signed | REF_NOW mae | REF_HELD mae |
  |---|---:|---|---|---|---:|---:|
  | 6 | 62 | 2.0040 / -2.0040 | 5.3315 / 1.9500 | 9.2854 / 5.9040 | 19.8798 | 22.8197 |
  | 12 | 58 | 1.9751 / -1.9751 | 7.3106 / 4.3649 | 13.6506 / 10.7048 | 18.8969 | 24.7784 |
  | 24 | 46 | 1.9630 / -1.9630 | 5.9045 / 2.8227 | 10.6902 / 7.6085 | 15.9488 | 27.7132 |
  | 48 | 22 | 2.0293 / -2.0293 | 2.0293 / -2.0293 | 2.0293 / -2.0293 | 10.1355 | 33.6484 |

  The `inside` count is 62, 58, 0, 0 for h = 6, 12, 24, 48.

**Unit assertions for the rounding function and the hour-key parser (check `unit_round_key`):**
- `RT(x) = floor(x + 0.5)`: 0.5 gives 1; 2.4 gives 2; 2.5 gives 3; 2.6 gives 3; 8.49 gives 8; 8.5 gives 9.
- Hour key: see the four literal timestamps in 2.2 (two per format).

**Two further assertions (checks `percentile_t7`, `boot_index_map`):**
- Percentile rule (section 9.3) on `x = 1, 2, ..., 10000`: 2.5th percentile = 250.975, 97.5th = 9750.025 (within 1e-9).
- Draw to block: with `B = 163`, `n = 999999999999` gives index 162; `n = 0` gives 0; `n = 500000000000` with `B = 7` gives 3;
  `n = 192517163266` with `B = 163` gives 31 (the first cell of the first data row of `tools/boot_uniforms.csv`).

## 9. Uncertainty and the decision rule

### 9.1 Blocks

Blocks are formed from the ISSUE hour of every issue row of the period window (any status), so the block set is the
same for every horizon, lead and subset.
- Period A: calendar month of `predTs` (UTC), label `YYYY-MM`. Expected 163 blocks.
- Period B: ISO week (Monday 00:00 UTC to Sunday 23:00). Compute it as `w = (D + 3) // 7` (integer division, `D` =
  `K // 24` = whole days since 1970-01-01; 1970-01-01 was a Thursday). Expected 12 blocks.

Sort the blocks ascending (months by label, weeks by `w`); block `j` (0-based) is the `j`-th in that order. `B` = the number of
blocks; assert `B <= 175`.

### 9.2 Resampling (10,000 resamples, the SAME draws in both languages)

`tools/boot_uniforms.csv`: data row `r` (r = 1..10000, in file order) is resample `r`; its cell in column `uk` is an
integer `n` (read it as an integer, in R as a double: it is below 2^40 and exact). For `k = 1..B` the `k`-th drawn block has
0-based index `j = (n * B) // 10^12` using EXACT integer arithmetic (Python ints; in R `(n * B) %/% 1e12` on doubles, exact
because `n * B < 1.75e14 < 2^53`). A block drawn `m` times counts `m` times. Period B uses the same rows and columns `u1..uB`.

### 9.3 Statistics, interval, percentile rule

For each metric cell (section 7; all 216 per period) and each of three statistics, the statistic of a resample is
recomputed from the per-block sums of the cell: per block `n`, `sum |err|` of P-LF, R-LF, R-LFm, and `sum err` of P-LF and R-LF,
combined with the draw counts. Statistics (differences are taken inside the resample, never between intervals):
- `D_PR = (sum|err|_P - sum|err|_R) / n`
- `D_PRm = (sum|err|_P - sum|err|_Rm) / n`
- `S_RP = (sum err_R - sum err_P) / n`

where the sums run over the drawn blocks with their multiplicities. A resample in which the cell has `n = 0` is skipped
(for all three statistics); count `n_skipped`. If `n_skipped > 500` (more than 5%) or the cell's full-data `n = 0`, `lo` and `hi`
are blank. Otherwise sort the `m = 10000 - n_skipped` valid values ascending (`x[0..m-1]`) and for `p` = 0.025 and 0.975:
`pos = (m - 1) * p` (double arithmetic), `lo_i = floor(pos)`, `frac = pos - lo_i`, value `= x[lo_i] + frac * (x[lo_i + 1] - x[lo_i])`
(if `lo_i + 1 > m - 1` the value is `x[lo_i]`). This is the type 7 quantile; implement it by hand in both languages
(do not call `quantile()` or `numpy.percentile`). `lo` is the value at 0.025, `hi` at 0.975.
`est` is the same statistic on the full data (not the bootstrap mean). `est` is blank only when the cell's full-data `n = 0`; otherwise it is written, also when `lo` and `hi` are blank.

### 9.4 Decision rule (plan section 8), period A only

Every quantity used in a condition (`D_lo`, `D_hi`, `rising_worse_by`, `rising_signed_R`, `rising_signed_P`, `cond4_D_lo`) is first
computed at full precision (`rising_worse_by` = full-precision `mae(R-LF) - mae(P-LF)`, not the difference of two written values), then written with
`%.6f`. Each condition is then evaluated on those WRITTEN strings, converted to integers in units of 1e-6 (the string without its decimal point, as an
integer: `"0.500000"` gives 500000, `"-0.020000"` gives -20000). Thresholds become 1000000 (1.0 point) and 500000 (0.5 point); `>=`, `<=`, `<` exactly as
written. Worked example: full-precision `mae(R-LF) = 3.2345676` and `mae(P-LF) = 2.7345672` give `rising_worse_by = 0.5000004`, written `0.500000`, integer 500000;
`cond2` (`<= 500000`) is 1. A difference of two written values (3.234568 - 2.734567 = 0.500001) is NOT used. All thresholds are in points of error.

For each `h` in {6, 12, 24}:
1. `D(h)` = `D_PR` of cell `(h, inside, all, all)`, with `D_lo`, `D_hi` from its interval.
   - `cond1` = `D_lo >= 1.0`.
2. `rising_worse_by` = `mae(R-LF) - mae(P-LF)` in cell `(h, inside, flowState, rising)`.
   - `cond2` = `rising_worse_by <= 0.5`.
3. `cond3` = `mean_signed(R-LF) >= mean_signed(P-LF)` in the same cell.
4. For `h = 24` only (ruling of the orchestrator, section 14): `cond4` = condition 1 recomputed on forecasts inside the lead whose UTC issue date lies OUTSIDE 15 September to 15 December, all flows: `D_lo >= 1.0` (integer 1000000) of the `D_PR` interval of cell `(24, inside, season, out_season)`. Not applicable for `h` = 6, 12.

- If any cell used has `n = 0` or a blank bound, the condition using it is 0 (not satisfied) and its inputs are written blank.
  There is no minimum `n`.
- `ADDS_INFORMATION` if `cond1`, `cond2`, `cond3` are 1 and (`cond4` is 1 or not applicable).
- Else `ADDS_NOTHING` if `D_hi < 0.5` (`D_hi` not blank).
- Else `UNCLEAR`.

Overall (`horizon = overall`): `PROPOSE_STAGE2` if `ADDS_INFORMATION` at 12 or at 24; else `STOP_IDEA_CLOSED` if all three
horizons are `ADDS_NOTHING`; else `REPORT_OWNER_DECIDES`. The 48 hour horizon and period B are reported, never judged.
The analysts compute and write this file; they state no opinion on what it means.

### 9.5 Q4 comparability (period B, descriptive; no decision rests on it)

Constants, read from the app on 2026-11-24 (percent of mean absolute error):

| h | stored forecast | stored "no change" |
|---|---:|---:|
| 6 | 10.0 | 12.6 |
| 12 | 11.3 | 16.7 |
| 24 | 13.8 | 25.3 |
| 48 | 17.1 | 39.9 |

Per horizon, period B:
- `n_q4` = number of cases with status 8 to 13; `mae_pLF` = mean `|err|` of P-LF on them.
- `rel_diff = |mae_pLF - stored_nochange| / stored_nochange`. `comparable = 1` if `rel_diff <= 0.2` (differ by more than a fifth
  = not comparable), else 0.
- Pairing-set figures: `n_pairs`, `mae_pLF_pairs`, `mae_RLF_pairs` (cell `(h, all, all, all)`).
- Only if `comparable = 1`: `skill_RLF = 1 - mae_RLF_pairs / mae_pLF_pairs` and `skill_today = 1 - stored_forecast / stored_nochange`
  (fractions, not percent; computed at full precision from the constants and the full-precision maes, written `%.6f` like every other number). If `comparable = 0` both are blank (withheld).

## 10. No look-ahead: the per-forecast file and the checks

Each analyst writes, per period, a full per-forecast file (section 11.7) and the file `checks.csv`. The checks below are
tested by your code in the run. Any violation makes the run end with a non-zero exit status AFTER all files are written
(the violation count in `checks.csv` is then non-zero). Counts are summed over the four horizons.

| Check | Rows tested (`n_checked`) | Assertion |
|---|---|---|
| `C1_por_age` | cases with status 10, 11, 12 or 13 | `por <= t - 2` |
| `C2_lf_age` | same | `lfs <= t - 1` and `ageLf >= 1` |
| `C3_hist_le_por` | same | `hist <= por` |
| `C4_ustar_rule` | same | `u* = min(hist + h, por)`, `u* >= hist`, `u* <= por` |
| `C5_ulf_rule` | same | `u_LF = hist - RT - ageLf` and `u_LF <= hist` |
| `C6_q_hours_known` | cases with status 12 or 13 | the hours of both hourly values used (`u*`, `u_LF`) are `<= por` |
| `C7_target_hour` | `SCORED` cases | the target row used has key `t + h` (mechanical). That `truth` is read only after the forecasts of the case exist is a DESIGN STATEMENT, not checkable from the outputs: both analysts report 0 violations; the third auditor checks it by reading the code. |
| `C8_hard_equal` | every replay row of the file with `status = predicted` (whole file, not only the window) | `hardFlag == truthDependentHard` |
| `C9_whole_hours` | every replay row of the file plus every hourly row of the period's hourly file | the timestamp has minute 00 (replay format: seconds 00 and `.000Z`); the source timestamps of the issue rows you use are tested too (not counted in `n_checked`) |
| `C10_shadow_sorted_unique` | every replay row of the file | keys strictly ascending, no duplicates |
| `C11_hourly_sorted_unique` | every row of the hourly file | keys strictly ascending, no duplicates |
| `C12_clock_alignment` | every replay row of the file with `status = predicted` (whole file) | `Q[K(porSrcTs)]` exists and equals `porQ` exactly; where `histSrcTs` is non-blank, `Q[K(histSrcTs)]` exists and `abs(Q[K(histSrcTs)] - historicPorCFS) <= 0.5` |

Expected on the real files (verified by the reviewer): `C12_clock_alignment` has `n_checked` 125,099 (A) and 128,595 (B) and 0 violations. In A and in B (whole files), 11 rows each have `|Q[K(histSrcTs)] - historicPorCFS|` equal to exactly 0.5 (the same 2023 hours; the replay trace rounds values such as 1001.5). Not a violation; no row exceeds 0.5. A timestamp shift of one hour or more breaks the `porQ` equality on most rows. C12 is the check that ties the hourly file's clock to the replay's; the in-memory made-up data cannot test the parser. A violation ends the run non-zero like the others.

Plus the synthetic and unit tests (in the order below): `synthetic_S0`, `synthetic_S1`, `synthetic_S2`, `unit_round_key`, `percentile_t7`, `boot_index_map`
(each is one test: `n_checked = 1`; pass = 0 violations).

`checks.csv` columns: `check,period,n_checked,n_violations`; one row per check per period (`A`, `B`; the synthetic and unit tests use
period `-`), in the order: the six synthetic/unit rows first (period `-`), then C1 to C12 for `A`, then C1 to C12 for `B`.

## 11. Output files (all in your own folder: `py/` or `r/`; same names in both)

General: UTF-8, `\n` line endings, comma separated, no quotes (no field contains a comma), header line first. Blank
= empty field (never `NA`, `NaN`, `inf`). Decimal numbers are written `%.6f` (fixed 6 decimals: Python `"%.6f" % x`; R
`sprintf("%.6f", x)`); counts, `h` and 0/1 flags as plain integers. Timestamps in the replay format. Text values exactly as
spelled here. Period A rows before period B rows.

### 11.1 `metrics.csv`
Columns: `period,h,lead,dim,level,arm,n,mae,medae,mean_signed,share_gt25`.
Row order: period (`A`, `B`), `h` (6, 12, 24, 48), `lead` (`all, inside, beyond`), `dim`/`level` (order of section 7), `arm`
(`P-LF, R-LF, R-LFm, REF_NOW, REF_HELD`). 1,080 rows per period.

### 11.2 `counts.csv`
Columns: `period,h,status,n`. Row order: period, `h`, then the 13 status codes in the order of section 4, then `TOTAL` (cases = issue rows
of the window), `SCORED_INSIDE`, `SCORED_BEYOND`, `Q4_SET` (cases with status 8 to 13). 17 rows per `(period, h)`.

### 11.3 `intervals.csv`
Columns: `period,h,lead,dim,level,stat,n,est,lo,hi,n_valid,n_skipped`.
Row order: as `metrics.csv` for period, `h`, `lead`, `dim`/`level`; then `stat` in the order `D_PR, D_PRm, S_RP`. `n` = cases of the cell.
`n_valid = 10000 - n_skipped`. 648 rows per period. (`lo`, `hi` blank as in section 9.3; `est` blank only when `n = 0`; `n_valid` and `n_skipped` are
integers, written even when the interval is blank; for a cell with `n = 0` they are 0 and 10000.)

### 11.4 `verdicts.csv` (period A only)
Columns: `horizon,n_inside,D_est,D_lo,D_hi,cond1,rising_n,rising_worse_by,cond2,rising_signed_R,rising_signed_P,cond3,cond4_applicable,cond4_D_lo,cond4,verdict`.
Rows: `horizon` = `6`, `12`, `24`, then `overall`. For `overall` only `horizon` and `verdict` are filled. `cond*` are 1/0 (blank if
not applicable: `cond4` when `cond4_applicable = 0`); `cond4_applicable` is 1 for `24`, else 0. `n_inside` = `n` of cell
`(h, inside, all, all)`; `rising_n` = `n` of `(h, inside, flowState, rising)`. `verdict` values: `ADDS_INFORMATION`, `ADDS_NOTHING`,
`UNCLEAR` per horizon; `PROPOSE_STAGE2`, `STOP_IDEA_CLOSED`, `REPORT_OWNER_DECIDES` for `overall`. `cond4_D_lo` is blank for `6`, `12`.

### 11.5 `checks.csv`: section 10.

### 11.6 `q4.csv` (period B)
Columns: `h,state,n_q4,mae_pLF,stored_nochange,rel_diff,comparable,stored_forecast,skill_today,n_pairs,mae_pLF_pairs,mae_RLF_pairs,skill_RLF`.
Rows `h` = 6, 12, 24, 48. `state` = `ANSWERED` (stored constants written with `%.6f`, e.g. `12.600000`). If period B cannot be built: `state` =
`NOT_ANSWERED` and every other field blank. `skill_today`, `skill_RLF` blank when `comparable = 0`.

### 11.7 `forecasts_A.csv`, `forecasts_B.csv` (FULL, not sampled; B only if period B is built)
One row per forecast case `(t, h)`: every issue row of the window x every horizon, ordered by `issueTs` ascending then `h` ascending.
Columns in this order, filled by group (blank if the group does not apply to the case's status):

| Group | Filled when status is | Columns |
|---|---|---|
| G0 | always | `period, issueTs, h, status, targetTs` (`targetTs` = hour of `t + h`) |
| G1 | 8 to 13 | `flowBin, flowState, lrWindow, season, lfLt3000, lfQ, truth, pLF, errP` |
| G2 | 10 to 13 (`qStar`, `qLf`: whenever the value exists) | `lfSrcTs, ageLf, travelGFtoLF, rtGL, histSrcTs, porSrcTs, uStarTs, uLfTs, qStar, qLf, inside` |
| G3 | 13 | `rLF, rLFm, refNow, refHeld, errR, errRm, errRefNow, errRefHeld` |

`lrWindow` (1 = `largeRise` in_window), `season` (1 = in_season), `lfLt3000` (1 = `lfQ < 3000`) are 0/1. `ageLf`, `rtGL`, `inside` are integers;
`uStarTs`, `uLfTs`, `lfSrcTs`, `histSrcTs`, `porSrcTs` timestamps; `errP, errR, errRm, errRefNow, errRefHeld` are the signed percent errors; all other
numbers `%.6f`. Full column list, in order:

`period,issueTs,h,status,targetTs,flowBin,flowState,lrWindow,season,lfLt3000,lfQ,truth,pLF,errP,lfSrcTs,ageLf,travelGFtoLF,rtGL,histSrcTs,porSrcTs,uStarTs,uLfTs,qStar,qLf,inside,rLF,rLFm,refNow,refHeld,errR,errRm,errRefNow,errRefHeld`

(Expected size: period A about 475,000 rows; the files are not for git.)

### 11.8 `REPORT.md` (a short report per analyst, no opinion on what the numbers mean)
Required headings: `## What was run` (commands, run time); `## Row counts` (replay rows read, window rows, hourly rows, events kept); `## Judgment calls`
(EVERY choice you had to make that this file did not settle, even if small; write "none" only if there truly was none); `## Deviations from the specification`
(none, or each one); `## Checks` (did all of `checks.csv` pass?); `## Period B` (built, or `PERIOD_B_NOT_ANSWERED` with the reason). Do not state
what the results mean for the plan.

## 12. Compare tool

`tools/compare_analysts.py` (standard library). After both analysts finish: `python3 -I tools/compare_analysts.py py r` from the study folder.
- Both folders must exist and contain at least one file; otherwise a difference is printed.
- Required on both sides: `metrics.csv, counts.csv, intervals.csv, verdicts.csv, q4.csv, checks.csv, forecasts_A.csv`. A missing one (also missing on both sides) is a
  difference. `forecasts_B.csv` is compared if present on either side; if present on one side only it is a difference; absent on both is accepted only
  because period B may legitimately be `NOT_ANSWERED` (then `q4.csv` says so).
- Per file: a different header, a row key on one side only, the key SEQUENCES in a different order (section 11 fixes the row order of every file), a text or
  timestamp field that is not equal, or a numeric field differing by more than 0.01, each printed on one line.
- A formatting mismatch is counted only when the SHAPE of two numbers differs: a different number of decimals, or a decimal point on one side only (for example `7` against `7.000000`). It is counted separately, printed as a `FORMAT` line, and also leads to `DIFFER`. Two numbers of the same shape that are within 0.01 agree, whatever their digits (for example `1.000000` and `1.000001`, or `-0.000000` and `0.000000`).
- At most 200 lines per file are printed (`--max N` changes this; `--max 0` = no limit), then the count of the rest. The last line is `AGREE` or `DIFFER`; the exit
  status is 0 only for `AGREE`, 1 for `DIFFER` (including any missing file or folder), 2 for wrong usage. It prints and interprets nothing else.
If the analysts differ: stop and investigate; never average or pick one (plan section 10).

## 13. Choices closed by this specification (the plan left them open) and why

1. **Time and key.** Hour key = whole hours since the epoch, UTC. One integer comparison replaces any string or rounding logic; no time zone can creep in.
2. **`round(T_GL)` = `floor(x + 0.5)`.** Halves up, language independent (R's `round` and Python's are half-even). Never decides a real case (the closest value to a half is 0.0001 away) but it is tested synthetically.
3. **`t - lfSrcTs` = integer difference of keys.** The source hours are whole hours on every row, so no rounding is needed (checked on both real files).
4. **Issue rows** are enumerated from every replay row in the window (so every row gets a status), but a case is scored only if the issue row has `status == predicted` (status rule 1); `no_truth` is not a prediction here (it has an estimate but no truth). The target row must be `predicted` too (rule 4).
5. **Precedence of statuses:** issue-row and target-truth reasons first (rules 1 to 7), measured-water reasons last (8 to 12). Reason: the cases where P-LF alone can be scored (the Q4 set, plan section 8) are then exactly those with status 8 to 13, and the pairing set is `SCORED`.
6. **Hard flag = `truthDependentHard`** of the target row (equal to `hardFlag` in these files; asserted). It is the flag the replay's own scoring rule excludes on; the replay-lag analysis used the same.
7. **`Q(u*)` or `Q(u_LF)` non-positive** drops the case for all arms (`Q_NONPOSITIVE`). One pairing set for all arms; never occurs on real data.
8. **Reference levels are outside the pairing rule.** They exist for every scored case (target and issue rows are predicted); if one did not, only its own `n` would shrink. So P-LF against R-LF never loses cases to a reference level.
9. **Counts "per arm, horizon and reason" (plan section 4):** reported per horizon and reason only, since all arms share one status per case.
10. **Truth and error:** `truthFlow` of the target row; `err = 100 (F - truth) / truth`; no clipping of forecasts.
11. **Share off by more than 25 percent:** `|err| > 25`, strict.
12. **Burn-in:** period A issue hours from 2012-12-01 00:00 UTC; period B from 2026-08-28 00:00 UTC to the end of the file; no other trimming. Period B's replay starts in 2011 like A's, so its learned corrections are mature, and R-LF uses none anyway.
13. **Flow range at issue = replay `flowBin`; state at issue = replay `flowState`** (both of the issue row), not recomputed.
14. **Large-rise window:** `[K(event_t0) - 48, K(event_tp)]` inclusive, union of the 21 windows; event clock taken as UTC like the hourly file (the events were derived from it).
15. **Wave season by UTC issue date, 15 September to 15 December inclusive; "Little Falls below 3,000" = `lfQ < 3000` at issue (strict).** The `season` dimension (all flows) feeds condition 4; `seasonLow` is the plan's section 7 subset; both are tabulated.
16. **Condition 4 (24 h, "outside the daily-wave season") uses the date rule only, inside the lead, all flows (ruled by the orchestrator on 2026-11-24, before any run; section 14).** The plan does not say whether a flow limit also applies; inside the lead at 24 h already confines it to about 3,060 cfs and below.
17. **Eras by UTC issue year.**
18. **Crossing:** every dimension x {`all`, `inside`, `beyond`} and nothing else; 216 cells per period, all with intervals. This covers Q2, Q3 and the decision rule without a combinatorial table.
19. **Bootstrap blocks** built from the issue hours of ALL issue rows (any status), so every horizon and subset share one block set; empty blocks contribute zero.
20. **Draws as 12-digit integers, block = `(n * B) // 10^12`.** Exact integer arithmetic in both languages; decimal parsing in R can differ in the last bit, which could flip a block index.
21. **Percentile:** type 7, hand-implemented. R's `quantile()` and numpy's `percentile` agree in theory, but a hand formula removes any version difference.
22. **Skipped resamples:** a resample in which the cell is empty is skipped; more than 5% skipped = blank interval (precedent: the 2026-11-22 study).
23. **Period B weeks** = Monday-start weeks computed from day numbers (equal to ISO weeks), not from a library.
24. **Decision rule as computations:** thresholds applied to 6-decimal rounded values; `cond2` is "worse by at most 0.5"; `cond3` is "R-LF mean signed error greater than or equal to P-LF's"; a condition whose cell is empty is not satisfied; no minimum `n`; `ADDS_NOTHING` is tested only if `ADDS_INFORMATION` fails.
25. **Overall verdict labels:** `PROPOSE_STAGE2`, `STOP_IDEA_CLOSED`, `REPORT_OWNER_DECIDES`, in the plan's order ("ADDS INFORMATION at 12 or 24" before "ADDS NOTHING at all three").
26. **Q4:** "differ by more than a fifth" = relative to the stored "no change" value, `rel_diff > 0.2`; `skill_RLF` is measured against P-LF on the pairing set; `skill_today` is computed at full precision from the stored constants and written `%.6f` (the plan's 20%, 32%, 45%, 57% are these values truncated: 20.6%, 32.3%, 45.5%, 57.1%). Skills are withheld (blank) when not comparable; everything else in the row stays visible.
27. **Per-forecast file is FULL** (all cases, all statuses), so the third auditor and the compare tool can check every status and every no-look-ahead rule mechanically. The compare tool streams it row by row.
28. **If period B cannot be built:** no B rows or files; `q4.csv` carries `NOT_ANSWERED` (plan section 3).
29. **Checks that stop the run:** violations are counted and written, then the run exits non-zero (plan section 5 rule 4).

## 14. Rulings and open points

- **Ruled by the orchestrator on 2026-11-24, before any run:** condition 4 uses date only. For `h = 24`, condition 1 is recomputed on forecasts inside the lead
  whose UTC issue date lies outside 15 September to 15 December, all flows; its lower bound must also be at least 1.0 point (cell `(24, inside, season, out_season)`).
- Noted, no ruling needed: plan section 8's "20%, 32%, 45% and 57%" are truncated values of the stored totals (item 26); the specification uses the exact values.

**Needs a ruling:** none.

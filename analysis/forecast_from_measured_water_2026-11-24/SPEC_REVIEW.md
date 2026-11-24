# Review of ANALYSIS_SPEC.md (Stage 1, forecast from measured water)

Reviewer: independent, did not write the plan or the specification. 2026-11-24.
No forecast error of any arm was computed on real data, and no arms were compared. On real data I only read
headers, counted rows and statuses, checked timestamps and checked that values agree between files. All test
code is under `/private/tmp/specrev/`.

## Verdict

GO WITH CHANGES. Make one change before the analysts start (finding 1, a clock check). Five smaller fixes
should go in at the same time.

## Findings, most serious first

### 1. MUST. No check ties the hourly file's clock to the replay's clock, so a look-ahead from a parsing shift would pass every check.

Evidence. Checks C1 to C6 compare hour keys that were all derived inside the analyst's own code. Say an analyst
parses `YYYY-MM-DD HH:MM` in the hourly file as local time. In R that is easy to do with `as.POSIXct` without
`tz = "UTC"`. Every `Q[u]` would then be 4 or 5 hours off. C1 to C11 would still pass. If the shift is in the
late direction, the forecast uses Point of Rocks water from after `t`. That is exactly what plan section 5 rule 4
must stop. The made-up-data test runs on data held in memory, so it never tests the parser. The dual-language
comparison only catches the shift if one of the two analysts gets it wrong.

There is a cheap check that ties the two clocks together, and it holds on the real files. I verified it:
- `Q[K(porSrcTs)] == porQ` exactly on every `predicted` row: 125,099 rows in A and 128,595 in B, 0 mismatches.
- `|Q[K(histSrcTs)] - historicPorCFS| <= 0.5` on every predicted row where `histSrcTs` is not blank. There are 0
  mismatches in B. In A, 11 rows differ by exactly 0.5, because the replay trace rounds values like 1001.5 to 1002.

Change. In section 10, add after `C11_hourly_sorted_unique`:

> | `C12_clock_alignment` | every replay row of the file with `status = predicted` | `Q[K(porSrcTs)]` exists and equals `porQ` exactly; where `histSrcTs` is non-blank, `Q[K(histSrcTs)]` exists and `abs(Q[K(histSrcTs)] - historicPorCFS) <= 0.5` |

Also add `porQ, historicPorCFS` to the column list in 2.1. In `checks.csv`, put C12 after C11. A shift of one
hour or more breaks the `porQ` equality on most rows.

### 2. SHOULD. Condition 4 (24 h, outside the wave season) needs a written ruling before the start, not after.

Evidence. Plan section 7 defines the wave-season subset "at Little Falls below 3,000 cfs". Plan section 8,
condition 4, says only "outside the daily-wave season". The specification adds a `season` dimension that is
not in the plan (date only, all flows) and makes it the decision cell. It also flags this itself in item 16 and
section 14. The difference is small, because inside the lead at 24 h almost always means a flow below about
3,060 cfs. But it is a decision cell, and the plan says rules are not changed after results are seen.

Change. Before the analysts start, the orchestrator writes into section 14: "Ruling (orchestrator, date):
condition 4 uses cell `(24, inside, season, out_season)` [or: `(24, inside, seasonLow, out_season_lf_lt3000)`]."
I lean to the date-only reading, because the plan defines the season by dates and the flow clause belongs to
the comparison subset. Either choice is fine, as long as it is recorded first.

### 3. SHOULD. When `est` is blank is not defined. This will very likely produce a cross-language difference.

Evidence. Section 11.3 says "(Blank `lo`, `hi`, `est` as in section 9.3 ...)". Section 9.3 only blanks `lo` and
`hi`, either when `n_skipped > 500` or when the full-data `n = 0`. It never says when `est` is blank. In a cell
with `n > 0` and more than 500 skipped resamples, one analyst will write `est` and the other will leave it blank.
This can happen in period B, where `largeRise in_window` covers one or two of the 12 weeks.

Change. In 9.3, after "`est` is the same statistic on the full data (not the bootstrap mean).", add: "`est` is
blank only when the cell's full-data `n = 0`; otherwise it is written, also when `lo` and `hi` are blank." In
11.3, replace "(Blank `lo`, `hi`, `est` as in section 9.3;" with "(`lo`, `hi` blank as in section 9.3; `est`
blank only when `n = 0`;".

### 4. SHOULD. The arithmetic of the decision tests on rounded values is not fixed.

Evidence. 9.4 says "All comparisons below use values rounded to 6 decimals (as written to the files)". It does
not say whether `rising_worse_by` is (a) the difference of the two written `mae` values or (b) the full-precision
difference, then rounded. In double arithmetic (a) can land just above the threshold. One case:
`3.234568 - 2.734568 = 0.5000000000000004`, and then `cond2` fails although the written difference is 0.500000.
It is improbable, but it sits on the decision path, and it is cheap to remove.

Change. In 9.4, replace the first sentence with: "Every quantity used in a condition (`D_lo`, `D_hi`,
`rising_worse_by`, `rising_signed_R`, `rising_signed_P`, `cond4_D_lo`) is first computed at full precision, then
written with `%.6f`. Each condition is then evaluated on those written strings, converted to integers in units
of 1e-6 (`round(value * 1e6)` on the 6-decimal string). Thresholds become 1000000 and 500000."

### 5. SHOULD. The compare tool says AGREE when it compares nothing, and it does not check row order in the small files.

Evidence. I tested `tools/compare_analysts.py` on made-up files.
- Caught: a value 1.000000 against 1.020000; a blank against `0.000000`; a row missing on one side (in both the
  small files and the streamed file); two swapped rows in `forecasts_*.csv`; a blank against a number in the
  forecast file. Exit status 1 with `DIFFER`.
- Not caught, so a wrong `AGREE` with exit status 0:
  - two empty folders;
  - two folders that do not exist (a typo in the path);
  - a file missing on BOTH sides. For example, if both analysts forget `forecasts_A.csv`, the tool skips the
    file silently.
  - Rows in a different order in `metrics.csv`, `counts.csv`, `intervals.csv` and so on. These are compared by
    key, but section 11 fixes their row order.
  - `7` against `7.000000`. These compare as equal numbers, so formatting rules for integers are not enforced.
- A difference of exactly 0.010000 is flagged, because `abs(1.01 - 1.0) = 0.010000000000000009`. This is harmless.

Change. Do this before the compare is run; it does not block the analysts.
- The tool must require `metrics.csv, counts.csv, intervals.csv, verdicts.csv, q4.csv, checks.csv,
  forecasts_A.csv` on both sides. A missing one counts as a difference.
- It must fail if a folder does not exist.
- It must report a row-order difference in the small files: compare the key sequences as lists.

Section 12 should say this.

### 6. SHOULD. The format of `skill_RLF` and `skill_today` contradicts itself.

Evidence. 9.5 says "(fractions, not percent; exact, not rounded)". Section 11 says every decimal number is
written `%.6f`.

Change. In 9.5, replace "(fractions, not percent; exact, not rounded)" with "(fractions, not percent; computed at
full precision from the constants and the full-precision maes, written `%.6f` like every other number)".

### 7. NOTE. The primary arm: the formula for `u_LF` is right. There is no off-by-one and no sign error.

The time accounting, in hour-key units. A replay or hourly row with key `k` stands for hour start `k`. The replay
places its centre at `k + 22.5 min`.

1. The estimate at `t` uses Point of Rocks hour `hist`, chosen as about `t - travelPoRtoGF`. In the time-shifted
   rows of window A, `(t - travelPoRtoGF) - hist` lies in [-0.5, 0.5) on 98.7% of rows. So the water read at
   Point of Rocks hour `hist` is at Great Falls at about `t`.
2. Truth of target `s`: `dueTs = s + T_GL(s)`. I confirmed on a sample row that `dueTs - predTs = travelGFtoLF`.
   Little Falls is read at `tau = ceil_hour(dueTs) - 11 min`. In key units that is
   `s + ceil(T_GL) - 0.558`. That water passed Great Falls at about `s`, and Point of Rocks at about
   `hist(s) ≈ hist(t) + h`. So `u* = hist + h` is the right hour, capped at `por`.
3. The Little Falls reading has key `t - ageLf`. That water passed Great Falls `T_GL` earlier and Point of Rocks a
   further `travelPoRtoGF` earlier: `t - ageLf - T_GL - travelPoRtoGF ≈ hist - T_GL - ageLf`. Rounded, that is
   `hist - round(T_GL) - ageLf`. This is the plan's formula. Both quantities are subtracted, as they should be.
4. Window length: `u* - u_LF = h + ageLf + round(T_GL)` (inside the lead). The ideal length, from the reading to
   the truth instant, is `h + ageLf + ceil(T_GL) - 0.558`. The mismatch is a sub-hour one: -0.442 h when
   `frac(T_GL) < 0.5`, and +0.558 h when `frac(T_GL) >= 0.5` (or is 0). The mean is about +0.06 h. Neither case
   is a whole hour. Using `floor(T_GL)` would make it a constant -0.442 h. That is not clearly better, and it is
   not worth a change of the plan.
5. Rounding twice (`hist` is already rounded, then `round(T_GL)`) differs by one hour from a single rounding of
   `t - ageLf - T_GL - travelPoRtoGF` on 31% of rows (35,557 of 114,762 in A). This is not an error. Anchoring
   both `u*` and `u_LF` on `hist` makes the rounding residual of `hist` cancel in `Q(u*) - Q(u_LF)`, so the
   window length stays consistent.
6. `u_LF <= hist <= u*` always holds, because `RT >= 0`, `ageLf >= 1` and `hist <= por` (verified: 0 rows with
   `hist > por`). C5 asserts it. The earliest `u_LF` in window A is in late November 2012, a year after the data
   start. It cannot fall before the data on real files.
7. Two known approximations. They are the plan's own and are stated here for the report:
   - Both formulas use the travel times of row `t`, not those at the moments the water actually moves.
   - About 1.3% of time-shifted rows (1,539 in window A) have a `hist` that is 1 to 17 hours away from
     `t - travelPoRtoGF`, because the model fell back to an older or newer reading. R-LF inherits that offset,
     because the plan defines `u*` from `hist`. This is legitimate under the plan ("the Point of Rocks hour the
     estimate at t used").

Look-ahead. Point of Rocks hour `por <= t - 2` summarises readings up to about `t - 1 h 15 min`. Little Falls hour
`t - 1` summarises readings up to about `t - 15 min`. Nothing used by P-LF, R-LF or R-LFm comes from after `t`,
provided the clocks line up (finding 1). `REF_NOW` uses row `s` by design. It is labelled a reference and enters
no decision.

### 8. NOTE. R and Python parse some long decimals 1 ulp apart. This is harmless here, but nothing may rely on exact equality of doubles across the two languages.

Evidence. I parsed `truthFlow, lfQ, travelGFtoLF, predictedCFS` of period-A `shadow_L.csv` with `read.csv`
(character) plus `as.numeric` in R, and with `float` in Python, and printed both with `%.17g`. Results:
- 11,494 `travelGFtoLF` values and 324 `truthFlow` values differ, each by 1 ulp. The largest relative difference
  is 2.2e-16.
- `RT` cannot change, because the closest value is 1.1e-4 from a half.
- The effect on any written number is far below 0.01.
- It could matter only for an exact tie at a 6-decimal threshold.
The block index mapping is not affected: R and Python give identical block indices for all 1,750,000 cells, for
B = 163 and B = 12.

### 9. NOTE. The made-up-data test has blind spots. Cross-language agreement covers them.

- With `travelGFtoLF = 2.5`, `ceil(T_GL)` also gives 3. So an analyst who used ceil would pass the test and then
  be wrong on about half of the real rows.
- `ageLf` is 1 on every row. Code that hard-codes 1 would pass.
- The parsing path is not exercised (see finding 1).

Optional fix: give a few rows `travelGFtoLF = 2.4` or `3.6` and `lfSrcTs = hour(i-2)`. If you do, the expected
values must be re-derived independently. They are not re-derived here.

### 10. NOTE. Smaller wording points.

- Section 13 item 4 says "Issue row = any replay row in the window, `status == predicted` required". Section 4
  says issue rows are taken "whatever its `status`". The status rules make the meaning clear, but item 4 should
  read "a case is scored only if the issue row has `status == predicted` (status rule 1)".
- C7 ("truth is read ... only after the forecasts of the case exist") cannot be checked from the outputs. Both
  analysts will report 0 violations whatever their code does. Keep it, but call it a design statement, checked by
  the third auditor reading the code.
- `python3 -I` removes the script's own folder from `sys.path`, so `py/run_all.py` cannot import a sibling module
  without adding the path itself. Tell the Python analyst.
- R: tell the analyst to look up rows by key with `match()` and to compute cases as vectors. A loop that indexes a
  `data.frame` row by row over about 475,000 cases can take a very long time.
- For the event file and the hourly files, tell the R analyst to use the same `read.csv` settings as for the
  replay. A default read turns `kept` into integers with NA for blanks.

### 11. NOTE. Runtime is fine.

- A plain-Python bootstrap that loops over 163 draws times 6 sums took 0.44 s per cell in my test, so about
  100 s for 216 cells.
- R with a 10,000 x B count matrix times the block sums takes seconds.
- Reading the 90 MB replay with `colClasses` in R takes seconds. I timed the uniforms file at 2.8 s.
- Writing 475,000 rows is not a problem in either language.
- No instruction forces a per-case loop inside the bootstrap. Section 9.3 already says to work from block sums.

## Fidelity to plan sections 3 to 8

Nothing in the plan is dropped. The specification adds the following. Each is a legitimate closing of an open
choice, except where marked.

- Thirteen statuses with a fixed order of precedence (the plan names three reasons). Legitimate. The Q4 set
  (status 8 to 13) and the pairing set (`SCORED`) follow from them. A case is never scored by one arm and not by
  another.
- Counts per horizon and reason, not per arm. Legitimate, because the status does not depend on the arm.
- `TARGET_HARD_FLAG` uses `truthDependentHard`, which equals `hardFlag` (asserted). Matches plan 6.
- Reference levels scored on the pairing set only. Legitimate.
- Burn-in starts at 2012-12-01 00:00 UTC (an older study used 05:00). This is the literal reading of the plan.
- The `season` dimension (date only, all flows), added and used for condition 4. This needs the recorded ruling
  of finding 2.
- `cond2` on the point estimate, `cond3` as `>=`, an empty cell = condition not met, no minimum `n`. Literal
  readings. Legitimate.
- Bootstrap from a uniforms file mapped to block indices, rather than an "index file". This is the same thing in
  substance. Legitimate.
- Crossing every dimension with `all/inside/beyond` gives 216 cells per period. That is more than the plan asks,
  but the decision cells are fixed in 7 and 9.4 before any result. So there is no room to pick a result
  afterwards. Every other cell must be presented as descriptive.
- "Flow range at issue" = the replay's `flowBin`. Labels verified: exactly the six listed, none other.

## Statuses and pairing (counts only, my own code, no errors computed)

Status counts per horizon (h = 6, 12, 24, 48). This is an independent cross-check for the third auditor, not for
the analysts. Statuses not listed are 0 at every horizon.

| status | A | B |
|---|---|---|
| ISSUE_NOT_PREDICTED | 2336 each | 13 each |
| TARGET_NO_ROW | 0, 4, 16, 40 | 0, 0, 11, 35 |
| TARGET_NOT_PREDICTED | 425, 401, 673, 983 | 6, 12, 13, 13 |
| TARGET_HARD_FLAG | 301, 329, 337, 333 | 0 |
| TARGET_OUT_OF_RANGE | 41 each | 0 |
| NO_TIMESHIFT | 1293, 1302, 1235, 1255 | 0 |
| Q_USTAR_MISSING | 452, 143, 74, 0 | 0 |
| Q_ULF_MISSING | 452, 737, 740, 753 | 0 |
| SCORED | 113384, 113391, 113232, 112943 | 1757, 1751, 1739, 1715 |

Scored inside the lead:
- A: 102,991 / 72,706 / 29,356 / 95
- B: 1,754 / 1,678 / 1,276 / 0

Each horizon accounts for all 118,684 cases in A and all 1,776 in B. Missing Point of Rocks hours remove 0.4 to
0.7% of cases in A. That is small, but those hours may cluster in winter, so the report should state the count.

## Facts in the specification that I re-checked (all correct)

- SHA-256 of all six input files and of `tools/boot_uniforms.csv` match section 1.
- Running `tools/make_boot_uniforms.py` again in a scratch folder reproduces `4d5f1fcd...4c38` byte for byte.
- Period A window: 118,684 issue rows, 116,348 predicted, 163 months.
- Period B window: 1,776 issue rows, 1,763 predicted, 12 weeks with `w = (D+3)//7`.
- Exactly 21 events with `kept == 1` and `GATE`, event 53 being in period B.
- `histSrcTs` is blank exactly when `useTimeShifted = 0` (1,641 rows in A).
- `t - porSrcTs >= 2`, `t - lfSrcTs >= 1`, `histSrcTs <= porSrcTs`, `hardFlag == truthDependentHard`.
- `predictedCFS` is never blank on predicted rows. No quotes appear in any file. Every line has 73 fields.
- R reads the CRLF hourly file with no stray `\r`.
- `travelGFtoLF` is never closer than 1.1e-4 to a half.
- Block mapping: `n = 192517163266`, `B = 163` gives 31; `999999999999` gives 162; `500000000000` with `B = 7`
  gives 3. R and Python agree on every cell of the file.
- The type 7 percentile on 1..10000 gives 250.975 and 9750.025 by hand in both languages. It also matches R's
  `quantile`.

## Made-up-data test: my independent values

I wrote my own code from the specification's description in section 8, without the writer's code. Every value
matches the specification exactly.
- Status counts for S0 and S1, per horizon: every row of the table matches. Each column sums to 96.
- S2 differences:
  - `Q_USTAR_MISSING` 12, 7, 3, 2
  - `Q_ULF_MISSING` 10, 12, 17, 18
  - `Q_NONPOSITIVE` 1, 1, 1, 1
  - `SCORED` 59, 55, 44, 21

  All match.
- S0: R-LF = R-LFm = P-LF = 2000 on every scored case. Matches.
- S1: the step (+500 for R-LF, +1000 for R-LFm) appears at these issue hours, and the difference is 0 everywhere
  else:

  | h | issue hours `t` |
  |---|---|
  | 6 | 74 to 83 |
  | 12 | 68 to 83 except 78 |
  | 24 | 62 to 71 except 66 |
  | 48 | none |

  Matches.
- The three explicit rows match: (80, 6), (70, 24), (40, 12). That covers `u*`, `u_LF`, `inside`, the five arms
  and the truth.
- Metrics, to 0.0001. All match.

  | h | n | P-LF mae / signed | R-LF mae / signed | R-LFm mae / signed | REF_NOW mae | REF_HELD mae |
  |---|---:|---|---|---|---:|---:|
  | 6 | 62 | 2.0040 / -2.0040 | 5.3315 / 1.9500 | 9.2854 / 5.9040 | 19.8798 | 22.8197 |
  | 12 | 58 | 1.9751 / -1.9751 | 7.3106 / 4.3649 | 13.6506 / 10.7048 | 18.8969 | 24.7784 |
  | 24 | 46 | 1.9630 / -1.9630 | 5.9045 / 2.8227 | 10.6902 / 7.6085 | 15.9488 | 27.7132 |
  | 48 | 22 | 2.0293 / -2.0293 | 2.0293 / -2.0293 | 2.0293 / -2.0293 | 10.1355 | 33.6484 |

- Cases inside the lead: 62, 58, 0, 0 for h = 6, 12, 24, 48. Matches.

## What I could not check

- How `makeGFPrediction` picks `histSrcTs`. I inferred "nearest to `t - travelPoRtoGF`" from the data (98.7% of
  rows) and did not read the model code.
- That `event_t0` and `event_tp` are UTC. I only confirmed that their format matches the hourly files.
- A full run of either language, and so whether the two will really agree within 0.01. Only the pieces were
  tested: parsing, block mapping and the percentile.
- Whether the bootstrap statistics agree, beyond the reasoning that order of summation changes values by about
  1e-12.
- Anything against the live USGS service. That is the third auditor's job.
- Whether the plan's travel times are right. That is out of scope (plan section 11).

## Second pass, version 1.1

Same limits as before. No forecast error of any arm was computed on real data and no arms were compared. I read
the whole of `ANALYSIS_SPEC.md` version 1.1 from top to bottom. `ANALYSIS_SPEC_v1.md` is kept.

### 1. Status of each finding

| # | Status | Where checked | Comment |
|---|---|---|---|
| 1 C12 clock check | RESOLVED, with one wrong expected value | 2.1, 2.2, 10 | C12 is in the table, the columns are added to 2.1, and the UTC parsing rules are explicit. The sentence below the table is partly wrong (point 2 below). |
| 2 condition 4 | RESOLVED | 9.4 item 4, 13 item 16, 14 | Date only, recorded as ruled before any run. Consistent with plan section 8. The decision cells in section 7 are unchanged. |
| 3 `est` blank | RESOLVED | 9.3, 11.3 | |
| 4 decision arithmetic | RESOLVED | 9.4 | Integers in units of 1e-6, taken from the written strings. I checked the worked example: 3.2345676 - 2.7345672 = 0.5000004, written `0.500000`. The written maes are `3.234568` and `2.734567`. `"-0.020000"` gives -20000. |
| 5 compare tool | RESOLVED | 12, `tools/compare_analysts.py` | See the tests in point 4. One new point, finding 12 below. |
| 6 skill format | RESOLVED | 9.5, 13 item 26 | |
| 7 `u_LF` time accounting | RESOLVED | 3 | No change was needed. The formula is unchanged. |
| 8 1-ulp parsing | RESOLVED (noted) | 0 | |
| 9 made-up-data blind spots | PARTIAL, acceptable | 8, 2.2 | `RT(2.4) = 2` now catches a ceil bug, and the literal hour keys together with C12 catch parser shifts. The Little Falls age is still always 1 in the made-up data. Cross-language agreement covers that. |
| 10 wording and analyst notes | RESOLVED | 0, 10 (C7), 13 item 4 | |

### 2. Read end to end: consistency

Consistent with itself and with `PLAN.md`. The edits broke no cross-reference I could find:
- 2.2 points to the unit assertions in section 8. Section 8 names `unit_round_key`, and section 10 lists it in the
  stated order.
- `checks.csv` order is: `synthetic_S0, synthetic_S1, synthetic_S2, unit_round_key, percentile_t7, boot_index_map`
  with period `-`, then C1 to C12 for A, then C1 to C12 for B. That is 30 rows, and sections 8, 10 and 11.5 agree.
- The decision cells of section 7 match 9.4 and 14.
- The column list, groups and row orders of section 11 are unchanged.
- The change list at the top points to the right sections.

One factual error:

- **Section 10, sentence under the check table:** "In A, 11 rows have `|Q[K(histSrcTs)] - historicPorCFS|` equal
  to exactly 0.5 (the replay trace rounds values such as 1001.5); in B none."
  - This is false for C12 as now defined, on the whole file. I verified that the whole period B replay file also
    has exactly 11 such rows. They are the same 2023 hours, because B's replay repeats A's history.
  - My first report said "0 in B" for the period B window only. That is where the error comes from.
  - It is not a violation, because the limit is `<= 0.5`, and no row in either file exceeds 0.5.
  - `porQ`: 0 mismatches on the whole file in A and in B. This is confirmed again.

  An analyst who sees 11 in B would log a judgment call against the specification. Fix the sentence (point 5).

A small point, no change needed: in R, turn the 6-decimal string into a number with `as.numeric`, not
`as.integer`. `as.integer` overflows above 2147.483647 points. Values that large are not plausible here.

### 3. Constants and rounding

- 2020-01-01 00:00 UTC gives 438288. 2026-06-16 03:00 UTC gives 494883. Python (`calendar.timegm`) and R
  (`as.POSIXct(..., tz = "UTC")`) agree, for both formats each. Correct.
- `floor(x + 0.5)` for 0.5, 2.4, 2.5, 2.6, 8.49 and 8.5 gives 1, 2, 3, 3, 8, 9 in both languages. Correct.

### 4. `tools/compare_analysts.py`: exit codes on made-up files

| Case | Output | Exit |
|---|---|---:|
| identical folders | AGREE | 0 |
| empty folders | "folder ... is empty", DIFFER | 1 |
| missing folders | "folder ... does not exist", DIFFER | 1 |
| required file (`q4.csv`) missing on both sides | "required file missing on both sides", DIFFER | 1 |
| reordered rows in a small file (`counts.csv`) | "row ORDER differs", DIFFER | 1 |
| `5` against `5.000000` | FORMAT line, DIFFER | 1 |
| 0.02 difference in a large file | difference line, DIFFER | 1 |
| optional `forecasts_B.csv` on one side only | "file only in py", DIFFER | 1 |
| extra: a row missing at the end of a large file | "row 2 only in py", DIFFER | 1 |
| extra: wrong usage | usage line | 2 |
| extra: `1.000000` against `1.000001` | FORMAT line, DIFFER | 1 |

**Finding 12 (SHOULD, does not block the start).** The FORMAT rule flags ANY textual difference within 0.01,
including a legitimate difference in the last decimal (`1.000000` against `1.000001`, or `-0.000000` against
`0.000000`). In effect it demands that the text be identical, while plan section 10 asks for agreement within
0.01. This errs on the safe side: it can stop the study without need, but it cannot pass a real difference.

Fix before the compare is run: count a mismatch as FORMAT only when the shape differs. That is a different number
of digits after the decimal point, or a decimal point on one side only. Treat `-0.000000` against `0.000000`, and
any other difference of 0.01 or less with the same shape, as agreement.

### 5. Final verdict

NOT YET. Change one sentence in section 10 first. Replace

> "In A, 11 rows have `|Q[K(histSrcTs)] - historicPorCFS|` equal to exactly 0.5 (the replay trace rounds values such as 1001.5); in B none. Not a violation."

with

> "In A and in B (whole files), 11 rows each have `|Q[K(histSrcTs)] - historicPorCFS|` equal to exactly 0.5 (the same 2023 hours; the replay trace rounds values such as 1001.5). Not a violation; no row exceeds 0.5."

After that, the analysts may start. Finding 12 only needs to be fixed before the compare is run.

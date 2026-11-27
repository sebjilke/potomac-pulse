PASS WITH NOTES

# Results audit of the clock study (third auditor)

Date 2026-11-27. Auditor: a fresh agent that wrote none of the study. Scope: tasks 1 to 8 of the brief. Everything below was run by me unless it says otherwise. Scratch work: `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/clock_results_audit/` (`mine.py` my implementation, `mine_out/` its 14 files, `cmp_mine.py`, `m3.py`, `sens.py`, `ambig.py`, `scripts15/` the 15-minute scripts, `raw15/` the raw USGS answers, `run15.txt`, `md5_before.txt`, `md5_after.txt`, `rerun_py.log`, `rerun_r.log`). In the repository I changed nothing except this file and the in-place rerun of the two analysts' commands.

**Short version.** The numbers are right and the verdict TOO LONG is the correct mechanical result. My own Python implementation, written from `ANALYSIS_SPEC.md` before I opened either analyst's code (I did not open their code afterwards either), reproduces every written cell of 14 of the 15 files exactly (largest difference 0). The verdict is not a knife edge: in every qualifying cell the app's clock is 1.7 to 1.9 times the long end, it stays above the long end under all 24 variants of gate, creek cut and series version I tried, and it stays above even when the longest single unit lag of the cell replaces the fitted upper bound. For the cells to come out INSIDE, the 9.1 miles below Great Falls would have to take 62 to 69% of the time of the whole 25.7-mile leg. The 15-minute re-measurement of seven rises agrees with the hourly lag within 0.2 hours where the method is stable. The notes are about reading: the low-water "chain check" is close to true by construction and so does not settle the low-water lag; the parts of a rise (10%, 50%, 90%, crest) do not tell the story the plan expected and are unusable on long event windows; high water is not measured; the Difficult Run check is not valid; and the rise of 26 and 27 November is creek-led and would not have entered the clock set at all.

## Findings

| # | Severity | Finding |
|---|---|---|
| F1 | MAJOR (reading) | **The chain check at low water is nearly true by construction; "settled" does not mean the low-water lag is a travel time.** The three phases are phase differences of daily waves at three gauges. (LF minus EF) plus (EF minus PoR) equals (LF minus PoR) modulo 24 for any three waves of the same period, whether the wave travels or is made locally (for example by the utilities' withdrawals between Edwards Ferry and Little Falls). So the check can only fail through noise or through the whole-day choice. In all three classes it passed with k = 0 for `LOW_P` and `UPP` and k = 1 for `WHO` (`lowwater_summary.csv`: chain_diff 0.291, 2.486, 1.818). The `WHO` whole-day choice was near a coin toss in two classes: lt1500 distance to the bump median 11.26 h (k = 1) against 12.74 h (k = 0); 1500-2000 10.78 against 13.22. In 2000-3000, the class the low-water cell uses, it was clear (3.24 against 20.76). The real support for the low-water lag of about 15 h at about 2,000 cfs is elsewhere: the rising-water lags at that flow (fit at 2,160 cfs about 13.3 h; clean bumps below 3,000 cfs median 15.03 h, n = 3; all_rise lt3000 median 13.49 h, n = 5). The withdrawal bias named in the plan (4.6) is not tested by anything in the study. |
| F2 | MAJOR (reading) | **The parts of a rise do not support the plan's expectation, and on event windows they are often meaningless.** `LOW_P`, all_rise, clean g60, 31 units (`class_summary.csv`): lag10 11.70, lag50 10.38, lag90 9.43, crest 7.00, against XC 9.83. The start arrives LATER than the middle and the crest earliest: the opposite of plan section 8. Events alone: lag10 2.48, lag50 6.54, lag90 6.62, crest 5.5 (XC 7.84); bumps alone: 14.25, 12.92, 12.64, 11.0 (XC 12.93). Single units show why: E49 lag90 175.8 h, E40 lag50 -26.9 h, E15 lag10 36.1 h, E32 lag10 -15.5 h. Event windows run from the limb's start to the event's peak, often days with several pulses (E49 is 11 days), so "10% of the window's rise" picks unrelated features at the two gauges. Only the bumps (one clean pulse each) give a coherent picture: all four parts within about 2 h of XC, the crest about 2 h earlier. |
| F3 | MAJOR (reading) | **High water is not measured.** The cell from 12,000 cfs has 4 units and does not qualify. Class medians do not shorten above 6,000 cfs: 6000-12000 6.65 h (n = 5), 12000-25000 7.02 h (n = 4), ge25000 no clean unit. The fit at 15,000 cfs (6.20 h) carries the slope fitted mostly on lower flows; the grid at 25,000 and 50,000 is `none`. Recessions (description only) do shorten: 9.24, 8.31, 6.25, 4.79 h from 3,000-6,000 up to 25,000 cfs and above. The app's value in the high cell (3.77 h) is above its long end (2.79 h), but the cell is not qualified and the report must not say the clock is too long at high water. |
| F4 | MINOR | **Thin sample at the gate.** Of 172 rise and bump units, 156 are used for `LOW_P`, 145 have status ok, 41 pass 0.6, 31 pass and are clean: 18% feed the clock. The middle cell has exactly 5 units (the qualifying minimum). The verdict does not depend on it: without that cell, `rising_lt6000` and `low_water` are two TOO LONG cells and none is TOO SHORT. |
| F5 | MINOR | **Difficult Run check not valid, and its lags are not shorter than the split.** 585 separate peaks, 10 pass all conditions, 9 used, 4 pass the gate (`dr_summary.csv`). Scaled lags of the 4: 1.16, 4.00, 4.12, 4.29 h (median 4.06, lower quartile 3.29). At the Little Falls flows of those days (2,070 to 3,980 cfs) the central split value is about 3.8 to 4.9 h. So as far as 4 pulses go, Difficult Run sits AT the split, not below it. 4 of the 10 have their best shift at 0 (status `end`): Little Falls responds at once, which fits the named weakness (Cabin John Creek and local rain). Not used in the clock (`dr_used` 0). Plan section 8 expected "valid, and shorter than the split"; neither holds. |
| F6 | MINOR (reading) | **The range is a confidence band of the fitted line, not the spread of single rises.** At the lowest cell flow the band is 10.37 to 12.60 h, while the 22 cell units range from 5.26 to 17.83 h (3000-6000 class quartiles 9.24 to 11.44). Readers will take the band as "the lag varies between these". The verdict does not depend on it: with the longest unit of each cell the long end is 0.37 x 17.83 = 6.60 h (app 7.86), 0.37 x 8.40 = 3.11 h (app 6.14), and at low water 0.37 x 20.42 = 7.56 h with the lt1500 class (app 10.57). |
| F7 | MINOR | **Switching in a sensitivity version at 6,000 to 12,000 cfs is decided by 0.038 h and changes nothing.** `LOW_A` 7.691341 against `LOW_P` 6.653328 (difference 1.038, above 1.0): switched in at 7,500, 10,000 and the middle cell flow (`cover_both` 1). Its bounds lie inside `LOW_P`'s at those flows (cell2: 6.77 to 8.43 against 6.62 to 8.89), so `lo` and `hi` are unchanged. `LOW_B` differs by 0.98 h with 4 units; had it been switched in, hi would be 9.60 and the long end 3.55 h, still below the app's 6.14. Plan 4.1 also asks the report to SAY where a class differs by more than 1 hour: that is 6000-12000 for `LOW_A`. |
| F8 | MINOR | **XC can find a second, unphysical maximum on long multi-pulse windows.** E47 (August 2024): hourly r(5) = 0.891, r(43) = 0.890; on 15-minute readings the 43 h peak wins (0.885 against 0.868). Among the 31 clean gated `LOW_P` units, 2 have a second peak at least 6 h away within 0.05 of the best (E47; S59, r 0.764 at 11 against 0.752 at 39). The hourly run picked the physical one in both, so no result changes; the shift range of 0 to 48 h on windows of up to 11 days allows this. |
| F9 | MINOR | **Plan text inconsistencies, none changing a conclusion.** (a) `PLAN.md` 13 point 2 says Great Falls to Little Falls is "at most 36%"; 4.9 and the specification use 0.37 for the long end (more lenient to the app by 3%). (b) 2.5 puts Difficult Run at milepost about 12.5 and Little Falls at 5.2 (7.3 miles) but uses 7.4; it moves the Difficult Run scale by 1.4%, and that check is not used. See section 4 for the full list. |
| F10 | MINOR (reading) | **The grid at 1,500 and 2,000 cfs rests on the rising fit's low tail.** `qmin` is 1,400 cfs from one unit (B400888); the next lowest point is at 1,720. The low-water lags in those classes are longer (19.6 h below 1,500, 17.1 h at 1,500 to 2,000) than the fit (15.3 h and 13.7 h). The spec's rule (rising fit wherever it is usable) is followed, but a reader comparing the grid with the low-water cell will see two different lags at the same flow. |
| F11 | INFO | `M3_tie_margin` 1: bump B491262, `LOW_P`, shifts 13 and 14 tie (stage steps of 0.01 ft at 3,120 cfs). The lag is 13.5 either way (the parabola clips to +0.5 from 13 or -0.5 from 14); only `s_best` and the `UPP` window (moved by 13 instead of 14) depend on the tie rule. M1, M2, M4: 0. |
| F12 | INFO | **The rise of 26 and 27 November 2026 is creek-led.** Lower-leg creek share 0.82 on provisional readings (Seneca, Broad Run, Difficult Run, 15-minute public data); Little Falls started rising about 3 h before Edwards Ferry. Hourly XC by the study's rule: best shift 5, r 0.385 (fails the 0.6 gate; shift 0 has 0.383). It would have been excluded twice (gate and creek cut). See section 5. |

## 1. Agreement and reproducibility

- `python3 -I tools/compare_analysts.py py r`: 15 of 15 `IDENTICAL`, `BYTE-IDENTICAL: yes`, `AGREE`.
- `cmp py/<f> r/<f>` on all 15 files: no difference.
- md5 of all 30 files recorded (`md5_before.txt`), then `python3 -I py/run_all.py` (14.8 s, exit 0) and `Rscript --vanilla r/run_all.R` (21.1 s, exit 0) rerun in place from the study folder. All 30 md5 unchanged (`diff md5_before.txt md5_after.txt` empty). Examples: `cells.csv` 4b491126adb7daf3652c3def47eb2219, `decision.csv` 8ebbe61b1759b17a5289dc8b3d885109, `unit_lags.csv` eb849819cb1ade3c0272af8f7ab04934, `class_summary.csv` e4df37e070fda70623d802c8a0396bc8. The scripts were not changed by the rerun (md5 checked).
- SHA-256 prefixes at the time of audit: `ANALYSIS_SPEC.md` f494ffe93fa9b6af5c33, `PLAN.md` 2dadf25bffb74b003767, `py/run_all.py` a1779d3fdd00dd422069, `r/run_all.R` 8579da3ff7c8fbe59635, `tools/compare_analysts.py` 403677f8036aa5f1ffa7.

## 2. My own implementation

`mine.py` (Python, standard library, about 22 s). Written from the specification only. It computes all of it: units, small onsets, bumps (scan, overlap, spacing), recessions, weeks, clusters, the creek shares of the three legs with the Difficult Run fall-back, all five versions with the `UPP` window moved by the `LOW_P` best shift, the parts, the class summaries, the detrended levels and week phases, circular medians, whole days, the chain check, the five Theil and Sen fits for three periods with the cluster bootstrap, the fits at flows, the Difficult Run selection and lags, the switching in, the grid, the replay's app value, the cells and the verdict. Not rebuilt: `checks.csv` (I recomputed only M3), and 11 counts of `row_accounting.csv` that are pure file counts (hourly rows and gaps, replay rows, cluster subcounts, `dr_present`; the analysts' values equal the expected values).

Cell-by-cell comparison with the analysts' files (`cmp_mine.py`; the analysts' two arms are byte-identical, so one comparison covers both):

| File | Rows compared | Cells compared | Largest absolute difference | Text differences |
|---|---|---|---|---|
| row_accounting.csv | 43 of 54 | 86 | 0 | 0 |
| units.csv | 225 | 4,275 | 0 | 0 |
| unit_lags.csv | 1,125 | 23,625 | 0 | 0 |
| bumps.csv | 103 | 721 | 0 | 0 |
| class_summary.csv | 150 | 3,900 | 0 | 0 |
| fits.csv | 15 | 210 | 0 | 0 |
| fit_at_flows.csv | 60 | 420 | 0 | 0 |
| clock_grid.csv | 9 | 90 | 0 | 0 |
| lowwater_weeks.csv | 500 | 7,000 | 0 | 0 |
| lowwater_summary.csv | 27 | 459 | 0 | 0 |
| dr_units.csv | 10 | 170 | 0 | 0 |
| dr_summary.csv | 15 of 18 | 30 | 0 | 0 |
| cells.csv | 4 | 68 | 0 | 0 |
| decision.csv | 7 | 14 | 0 | 0 |

No difference above 1e-6 anywhere, so nothing needed a root-cause explanation. The known edge (bump 477632, `1.4 * m = 2029.9999999999998`) is kept in my run too.

**Judgment calls where the two REPORTs differ or name a branch, and whether it fired on the real data:**

| Branch | Fired? |
|---|---|
| Bounds when a sensitivity is switched in but a version has no bounds (Python 8, R 4) | No. Every bootstrap had `n_skipped` 0, so every usable flow has bounds. |
| Range columns written for a cell that does not qualify (Python 9, R 3) | Yes, `rising_ge12000`; both write them, identical. |
| Qualifying cell with blank `app_value` would be INSIDE (Python 9) | No. All four app values are defined (675 to 7,894 rows). |
| Switching in requires the sensitivity to be usable at F (R 5) | Never decisive: `LOW_A` and `LOW_B` have the same flow range as `LOW_P` (1,400 to 20,000). |
| `chain` reason also covers an undefined chain (R 6) | No. The chain is defined in all three classes. |
| Bootstrap values recorded for non-usable flows (Python 7) | No effect on any written value. |
| What M1 and M3 count (Python 11, R 1 and 2) | Both count the same sets (1,405; 992), same results. |

## 3. Cells and verdict, recomputed

From the files by hand (`cells.csv`, `clock_grid.csv`, `fit_at_flows.csv`, spec 12 and 13; `DRvalid` 0 so short end = 0.136 x lo):

| Cell | n | median Q | L, lo, hi | long end = 0.37 hi | central = 0.36 L | short end | app | status |
|---|---|---|---|---|---|---|---|---|
| rising_lt6000 | 22 | 3,415 | 11.097, 10.365, 12.603 | 4.663 | 3.995 | 1.410 | 7.860 | 7.860 > 4.663: TOO LONG |
| rising_6000_12000 | 5 | 8,550 | 7.733, 6.620, 8.893 (cover_both 1, bounds still `LOW_P`'s) | 3.290 | 2.784 | 0.900 | 6.143 | TOO LONG |
| rising_ge12000 | 4 | 13,750 | 6.414, 5.203, 7.552 | 2.794 | 2.309 | 0.708 | 3.769 | few_units: not_qualified |
| low_water | 47 weeks | 2,160 (class 2000-3000) | 14.980, 14.132, 15.827 (phase 14.98, k 0, spread 0.85) | 5.856 | 5.393 | 1.922 | 10.566 | chain pass: TOO LONG |

nq 3, nlong 3, nshort 0, ninside 0: rule 2 gives **TOO LONG**. My own run gives the same cells and verdict independently (all 68 cells of `cells.csv` equal).

Margins: app over long end 1.69, 1.87 and 1.80 times; app over central 1.97, 2.21 and 1.96 times. The app's clock equals 62%, 69% and 67% of the measured upper bound of the WHOLE Edwards Ferry to Little Falls lag.

Robustness (`sens.py`, my own refits, no bootstrap): Theil and Sen of `LOW_P`, `LOW_A`, `LOW_B` with gate 0.4, 0.5, 0.6, 0.7, with and without the creek cut (24 fits, 22 to 115 points): the fitted lag at 3,415 cfs lies between 11.10 and 12.11 h and at 8,550 cfs between 7.18 and 8.57 h; 0.37 times these is at most 4.48 and 3.17 h, far below 7.86 and 6.14. Slopes from -0.32 to -0.49.

## 4. Specification and outputs against `PLAN.md` (sections 2.5, 2.6, 3, 4, 13)

| Plan | Specification / outputs | Could it change a conclusion? |
|---|---|---|
| 2.5 distances, share 0.36 (0.34 to 0.37), Difficult Run 7.4 | 0.37, 0.36, 0.34 and 9.1 / 7.4 as stated. Plan's own mileposts give 7.3 for Difficult Run | No (check not valid) |
| 2.6 hourly medians standing for the hour's centre | No half-hour correction; same convention on every gauge, so it cancels in a lag | No |
| 4.1 primary and sensitivities; "report says so and range covers both" when a class median differs by more than 1 h | Implemented as switching in, on clean gated medians with at least 3 units, bounds = widest bootstrap bounds. Classes with fewer than 3 units are never tested | No (F7) |
| 4.2 limb start "before the onset" | Spec includes the onset hour itself (o - 47 to o) | No |
| 4.2 bumps "not inside the window" of an event | Any overlap drops the bump (stricter) | No |
| 4.2 low-water weeks overlap "no rise or recession window" | Spec also drops weeks overlapping a bump window (ruling 19): 75 dropped for overlap | No; it removes the least steady weeks |
| 4.3 gate 0.6, not at an end | Plus the `neighbour` status; as planned otherwise | No |
| 4.4 creek cut 15%, lags with and without the cut | `med_g60_all` reported; fits only with the cut | No (sens.py: without the cut the fit is within 0.4 h) |
| 4.6 withdrawals named as a bias | Named only; nothing in the computation tests it; the chain check cannot detect it | Yes for how firm the low-water lag is (F1); not for the cell status (see 6c) |
| 4.7 "95% interval" of `lag = A Q^B` | Bootstrap percentile band of the fitted line; used as the clock's lo and hi | No (F6) |
| 4.7 "not used outside its range; below it the low-water lag applies" | Followed; the range reaches down to 1,400 on one unit | No (F10) |
| 4.8 Difficult Run selection and validity | As planned; 10 pass the conditions, 4 the gate: not valid | No |
| 4.9 long end 0.37 x upper bound; 13.2 "at most 36%" | Spec uses 0.37 | No (F9) |
| 4.10 app value over the hours of the cell's units | Spec includes `no_truth` rows (ruling on review finding 11) | No |
| 13 owner's three points | Scope (measurement only), the split, the numbers 0.6 / 15% / four cells: all as confirmed | No |

## 5. Re-measurement on 15-minute readings (USGS public service)

Requests: `waterservices.usgs.gov/nwis/iv/` (historic periods redirect to `nwis.waterservices.usgs.gov`, followed), carrying only `sites`, `parameterCd`, `startDT`, `endDT`, `format=json`. No key, no header, no credentials, no environment variable. Readings selected by their own time stamps (converted to UTC). Every hourly value of the input file in each window (Edwards Ferry over the window moved back by the unit's best shift) was compared with the median of the 15-minute readings of that hour.

**Hourly values checked: 1,941 (647 per gauge series over the 7 rises). Every Little Falls flow is identical; every stage equals the 15-minute median rounded to 2 decimals (largest raw difference 0.005 ft, the rounding of an even-count median).**

Methods at 15 minutes: (1) XC as in the specification, on 1-hour changes sampled every 15 minutes, shift 0 to 48 h in 15-minute steps, parabola refinement; on stage (as `LOW_P`) and on flow (as `LOW_A`). (2) Half rise: time of the first crossing of 50% of the window's rise at each gauge (Edwards Ferry window moved back by the hourly best shift). (3) Steepest hour: the centre of the largest 1-hour rise at Little Falls in the window, and of Edwards Ferry in the 36 hours before it.

| Rise (window in UTC) | Flow Q | Pair | Hourly lag (study, `LOW_P`; `LOW_A`) | 15-min XC stage (r) | 15-min XC flow (r) | Half rise | Steepest hour | Readings (hourly values checked) |
|---|---|---|---|---|---|---|---|---|
| E1, 2012-09-18 01:00 to 09-20 12:00 | 2,425 | EF stage / LF stage | 12.07; 11.54 | 12.04 (0.885) | 11.54 (0.896) | 10.94 | 12.0 | 721 per series (180) |
| E12, 2015-09-29 00:00 to 10-06 16:00 | 11,700 | same | 8.40; 8.15 | 8.38 (0.883) | 8.18 (0.906) | 7.97 | 8.25 | 1,200 (555) |
| E22, 2017-10-29 01:00 to 11-01 09:00 | 4,430 | same | 7.67; 7.05 | 7.62 (0.935) | 7.07 (0.961) | 7.52 | 8.0 | 817 (243) |
| B451751, 2021-07-14 05:00 to 07-15 05:00 | 3,520 | same | 12.90; 12.80 | 12.75 (0.922) | 12.75 (0.924) | 13.17 | 12.75 | 528 (75) |
| E41, 2022-11-11 22:00 to 11-15 06:00 | 3,545 | same | 9.24; 8.82 | 9.09 (0.936) | 8.94 (0.950) | 9.88 | 9.0 | 815 (243) |
| E47, 2024-08-07 08:00 to 08-11 03:00 | 7,453 | same | 5.26; 4.42 | 43.18 (0.885); at 5 h r 0.868 | 43.30 (0.938) | 5.45 | 5.0 | 815 (276) |
| E48, 2024-09-28 17:00 to 10-03 19:00 | 20,000 | same | 7.05; 5.96 | 7.09 (0.934) | 5.75 (0.950) | 7.44 | 7.0 | 961 (369) |
| **26-27 Nov 2026** (beside the study, not in any fit), 2026-11-26 02:00 to 11-27 20:00 | about 3,000 median; 1,480 to 10,100 | same | not in the study; my hourly XC by the spec rule: sb 5, r 0.385 (fails the gate), lag 5.13 | 5.02 (0.372) | 6.31 (0.603) | 2.11 | 0.75 | 760 EF, 2,275 LF; crest lag 6.2 h (EF crest 5.49 ft at 13:30, LF 10,100 cfs at 19:40, LF may still be at its top at 21:50) |

Reading: where the correlation peak is unique the 15-minute XC agrees with the hourly lag within 0.15 h (stage) and 0.21 h (flow), and the two independent ideas agree within about 1.1 h (half rise) and 0.35 h (steepest hour). The hourly lag is therefore not an artefact of hourly sampling. E47 shows the second-peak weakness of F8 (the half rise and the steepest hour both give about 5 h). On 26 and 27 November the lower-leg creek share was 0.82 (Seneca 8,422, Broad Run 32,090, Difficult Run 17,134 against Little Falls 129,225 cfs-hours above their starts, with 430 / 234.9), Little Falls began rising at about 12:00 UTC on the 26th before Edwards Ferry moved, and the half rise (2.1 h) and steepest hour (0.75 h) describe creek water arriving, not a wave from Edwards Ferry. The 6.2 h crest lag is the only main-stem number, and it is one rise on provisional data. These readings are provisional; the 2026 values may be revised.

## 6. What the results support

**(a) Edwards Ferry to Little Falls on rising water (`LOW_P`, all_rise, clean, gate 0.6).**
- Below 3,000 cfs: median 13.49 h, n 5 (quartiles 12.07 to 16.56). 3,000 to 6,000: 11.15 h, n 17 (9.24 to 11.44). 6,000 to 12,000: 6.65 h, n 5 (6.56 to 8.00). 12,000 to 25,000: 7.02 h, n 4 (6.37 to 7.19). From 25,000: no clean unit.
- Units passing: 41 of 145 ok (172 units, 156 used) pass 0.6; 31 are clean. Gates 0.4 / 0.5 / 0.6 / 0.7: 77 / 58 / 41 / 21 pass, clean medians 11.04 / 10.23 / 9.83 / 9.28 h (the stricter gate keeps faster rises, as plan 7 warned; part of it is the flow mix).
- Versions: all-class medians 9.83 (stage), 9.44 (flows), 11.17 h (logs). Fitted lag at 3,415 cfs 11.10 / 11.19 / 11.45 h; at 8,550 cfs 7.73 / 7.55 / 8.40 h.
- Fitted relation: lag = exp(5.6085) x Q^-0.3935 (about 273 x Q^-0.394), 31 points in 31 clusters, Q 1,400 to 20,000; slope 95% band -0.531 to -0.297; halves -0.353 (before 2020, 13 points) and -0.425 (from 2020, 18 points). Lags: 15.3 h at 1,500, 11.7 at 3,000, 9.6 at 5,000, 8.1 at 7,500, 7.3 at 10,000, 6.2 at 15,000 cfs.

**(b) Start, middle, top, crest.** May say only: on single clean pulses (bumps) the four times agree with XC within about 2 h, the crest about 2 h earlier. May NOT say the start of a rise arrives sooner than its middle or the crest later (F2).

**(c) Low water.** Phases (`LOW_P`): 19.62 h below 1,500 cfs (8 of 17 weeks pass, spread 0.81), 17.10 h at 1,500 to 2,000 (13 of 30, spread 2.17), 14.98 h at 2,000 to 3,000 (26 of 53, spread 0.85). Whole days k = 0 from the bump median 12.93 h (11 bumps), so the low-water lags are the phases. Upper leg 14.17 / 13.44 / 12.32 h; whole reach 33.50 / 33.02 / 25.48 h (k = 1). Chain check passed in all three classes (diff 0.29, 2.49, 1.82 h). Firmness: the phase itself is well defined in two classes (spread under 1 h) and fits the rising-water lags at the same flows, but the chain check adds little (F1) and withdrawals are untested. The cell status is safe even if the low-water lag were the slowest class (20.4 h upper bound gives a long end of 7.56 h, below 10.57); it would only flip if the true lag were a full day longer (about 39 h), which the bumps and the rising fit exclude.

**(d) Difficult Run.** 10 pulses pass the selection, 9 used, 4 pass the gate; not valid (needs 10). Scaled lags 1.16, 4.00, 4.12, 4.29 h. They sit at, not below, the split by distance (F5). Nothing from Difficult Run enters the clock.

**(e) Clock from Great Falls to Little Falls (`clock_grid.csv`; long end / central / short end, hours).**
1,500: 6.79 / 5.52 / 1.89. 2,000: 5.92 / 4.93 / 1.72. 3,000: 4.92 / 4.20 / 1.49. 5,000: 4.05 / 3.44 / 1.18. 7,500: 3.46 / 2.93 / 0.96. 10,000: 3.12 / 2.62 / 0.83. 15,000: 2.72 / 2.23 / 0.68. 25,000 and 50,000: not measured. Low water at 2,160 cfs: 5.86 / 5.39 / 1.92. **All of these rest on the split by distance**; the central value is the long side of what is plausible only if the stretch below Great Falls is at least as fast per mile as the leg as a whole (the 4 Difficult Run pulses give no sign that it is faster).

**(f) The app's clock.** Median `travelGFtoLF` over the hours of the cell's units: 7.86 h (cell below 6,000; bare formula 8.15), 6.14 h (6,000 to 12,000; formula 4.72), 3.77 h (from 12,000, not qualified; formula 3.55), 10.57 h (low water; formula 10.71). Bare formula on the grid: 13.31, 11.21, 8.81, 6.49, 5.10, 4.30, 3.37, 2.49, 1.65 h.

**(g) Cells and verdict.** TOO LONG, TOO LONG, not_qualified, TOO LONG; verdict TOO LONG (section 3).

**Statements the report may make (with these numbers):**
1. On rising water the change takes about 11 h from Edwards Ferry to Little Falls at 3,000 to 6,000 cfs (median 11.15, n 17) and about 6.5 to 8 h at 6,000 to 12,000 (median 6.65, n 5; fit 7.7 at 8,550); lag falls as about Q^-0.39 (band -0.53 to -0.30).
2. The answer barely depends on the gate, the creek cut or the series version (24 variants: 11.1 to 12.1 h at 3,415 cfs, 7.2 to 8.6 h at 8,550).
3. The two legs add up on rising water: Point of Rocks to Edwards Ferry plus Edwards Ferry to Little Falls equals Point of Rocks to Little Falls within 0.4 h at every grid flow from 1,500 to 15,000 cfs (for example 9.10 + 9.55 = 18.65 against 18.84 at 5,000); recessions add up as well (6.25 + 7.20 = 13.45 against 13.23 at 12,000 to 25,000).
4. At low water the daily wave puts Edwards Ferry to Little Falls at about 15 h near 2,000 to 3,000 cfs and 17 to 20 h below 2,000, consistent with the bumps (12.9 h) and the rising fit (about 13 to 15 h) at those flows; withdrawals may shift it and are not tested.
5. The app's clock is above the long end of the measured range in all three qualifying cells, by 1.7 to 1.9 times; the verdict is TOO LONG.
6. For the app's clock to be right, the 9.1 miles below Great Falls would have to take 62 to 69% of the time of the 25.7-mile leg.
7. Verified at 15-minute resolution on 7 rises (2012 to 2024, 2,425 to 20,000 cfs): the hourly lag holds within 0.2 h (one rise, E47, needs the second-peak caveat of F8).

**Statements the report may NOT make:**
1. Anything about the clock at high water (12,000 cfs and above): not qualified, not measured from 25,000 (F3).
2. That the start of a rise arrives before its steepest part, or the crest after it (F2).
3. That the chain check "confirms" the low-water lag, or that withdrawals were ruled out (F1).
4. That Difficult Run shows the stretch below Great Falls to be faster, or that it narrows the range (F5).
5. That the true Great Falls to Little Falls time is the central value; it is an assumption (split by distance), bounded on one side only by argument, not by data.
6. That the study explains the error on 26 and 27 November: that rise was creek-led (share 0.82) and is outside the population the clock was measured on (F12). One may say the app logged 9 to 14 h that night (first look, not verified here) against a measured main-stem crest lag of 6.2 h for the whole 25.7-mile leg.
7. That the plan's expectations (section 8) held: the lower leg is longer than expected at 3,000 to 6,000 cfs (11 h, not 7 to 9), Difficult Run is not valid, and the parts go the other way. Only the verdict matches.
8. The range lo to hi as a spread of single rises (F6).

**What rests on the split by distance:** every number in (e), every long end, central value and short end, every cell status and the verdict. What does not: (a), (c), (d), the fitted relation, the additivity of the legs, and the comparison "the app's 7.9 h for Great Falls to Little Falls is 71% of the 11.1 h measured for the whole Edwards Ferry to Little Falls leg at the same flows".

**Where the first look stands** (`analysis/clock_first_look_2026-11-27/README.md`): its "about 8 h at 5,000 to 10,000 cfs" fits the study (fit 9.6 to 7.3 h over that range); its "about 3 h, likely 2 to 4" for Great Falls to Little Falls fits the central values 3.4 to 2.6 h. Its distances (25.8 and 9.3 miles) differ slightly from the plan's (25.7 and 9.1). Its night-of-26-November numbers were not checked here.

## 7. Is the measurement sound?

- **Shortens with flow:** yes. Slope -0.39 (band -0.53 to -0.30) is close to the -0.4 expected for a flood wave in a wide channel (wave speed about Q^0.4); the app's exponent is -0.596. Recessions shorten steadily with flow. Rising class medians stop shortening above 6,000 cfs (F3), on 4 and 5 units.
- **Legs add up:** yes, within 0.4 h on rising water and recessions (statement 3), and phases add modulo 24 at low water (which is weaker evidence, F1).
- **Lower leg faster per mile than the upper leg:** 25.7 miles in 9.55 h (2.7 mph) against 17.3 miles in 9.10 h (1.9 mph) at 5,000 cfs. This fits the plan's statement that the river below Edwards Ferry is steeper and supports the split by distance as the long side of plausible, though it says nothing about Great Falls itself.
- **Parts:** do not tell a consistent story on events (F2).
- **Creek-heavy units:** shorter as expected on the upper leg and whole reach at 3,000 to 6,000 cfs (8.59 against 10.42 h; 18.60 against 20.64), mixed on the lower leg (3,000 to 6,000: 10.28 heavy against 11.15 clean, expected; below 3,000: 19.88 against 13.49 and 6,000 to 12,000: 7.73 against 6.65, not expected; n 4 to 10).
- **Second maxima:** occasional on long windows (F8).
- **Stage quantisation:** Little Falls stage moves in 0.01 ft steps; at low flow this makes exact ties possible (F11). Flows (`LOW_A`) give the same answers within about 0.5 h.

## 8. Limits beyond `PLAN.md` section 7

1. The clock is measured on main-stem rises that pass a correlation gate and a creek cut. Creek-led rises like 26 and 27 November, where the app's score is most visibly off, are outside that population; the clock says when a wave from Edwards Ferry reaches Little Falls, not when creek water does.
2. The range is a band for the median relation, not for a single rise (F6).
3. Event windows of several days mix pulses; XC copes (one physical peak wins), parts do not (F2, F8).
4. The low-water lag cannot be separated from the timing of withdrawals by this design (F1).
5. The app's value is a median over many hours of each cell; per hour the app's clock varies with its own flow lookup and the rise reduction, which the study does not resolve.

## What I could not check

- The true time from Great Falls to Little Falls (no gauge). The split by distance cannot be tested with these data.
- The app's logged clock on 26 and 27 November (`tick_log`): not read; I report only the first look's 9 to 14 h as its claim.
- The 2026 readings are provisional and may be revised; the November creek share uses provisional Seneca, Broad Run and Difficult Run readings.
- I did not rebuild `checks.csv` as a file (unit tests and C00 to C08) and did not recount the 11 pure file counts of `row_accounting.csv`; the analysts' values equal the expected values there. I recomputed M3 only.
- Withdrawal records were not looked at.

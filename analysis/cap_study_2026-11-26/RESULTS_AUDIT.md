PASS WITH NOTES

# Results audit of the cap study (third auditor)

Date 2026-11-27. Auditor: a fresh agent that wrote none of the study. Scope: tasks 1 to 8 of the brief. Everything below was run by me unless it says otherwise. Scratch work: `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/cap_results_audit/` (`audit.mjs` my implementation, `mine/` its 13 output files, `cmp_mine.py`, `cmp_usgs.py`, `usgs/` the raw USGS answers, `md5_before.txt`, `md5_after.txt`, `rerun_py.log`, `rerun_r.log`, `run_out.txt`, `extra_out.txt`, `mut/` compare-tool mutation copies). In the repository I changed nothing except this file and the in-place rerun of the two analysts' commands.

**Short version.** The numbers are right and the verdict KEEP is the correct mechanical result. My own Node.js implementation, written from `ANALYSIS_SPEC.md` before I opened either analyst's code (I did not open it afterwards either), reproduces 13 of the 14 output files byte for byte, both arms. The verdict is not a knife edge: no candidate qualifies, and even with the qualifying step removed no candidate has fewer badly-off rising design hours than production, and every candidate fails condition 1 in the test years with its whole interval above 0. The notes are about reading: the data point the other way from the owner's premise, the large-rise numbers rest on few independent months, one subgroup is a single rise on revised readings, and the loss shrinks (and for LF3 and LF6 turns slightly into a gain) when the truth is taken 2 hours later.

## Findings

| # | Severity | Finding |
|---|---|---|
| F1 | MAJOR (reading) | **Every looser rule is MORE often badly off on rising water, in both periods.** Test years, badly-off share difference on rising hours: +1.24 (LF3) to +3.51 (RIS, N) points, every interval above 0 (`intervals.csv` I13 to I31). Design years: +0.66 (LF6) to +2.81 points (`rule_tables.csv`); my own design intervals (not in the study files) are all above 0, the lowest LF6 [+0.07, +1.31]. The report must say this directly, not only "no rule qualified". On rising hours the cap stops more badly-high readings than it creates badly-low ones. |
| F2 | MAJOR (reading) | **The tighter description rule T110 beats production on the two headline measures, but it was never a candidate and has no interval in the study files.** T110 test: mean `d` all -0.156, badly-off rising -2.61 points; design -0.119 and -2.18 (`rule_tables.csv`). My own intervals (auditor's, same draws and method, not part of the study): test rising off_diff [-3.91, -1.41], all `d` [-0.217, -0.099]. It is worse on the large rises (test `rl_large` mean `d` +1.66, my interval [+0.52, +2.89]; badly-low share 52.2% against 43.1%) and more biased low (-0.94 against -0.38 overall). The report may describe this; it must not say "a tighter cap is better". That needs its own pre-registered study (plan section 13: no tuning). A reader will ask, so the report should name it. |
| F3 | MINOR (reading) | **The cap is not what makes rising hours read badly low.** Only 185 of the 926 badly-low rising test hours are capped (19.98%; design 190 of 870, 21.84%). On the 1,302 capped rising test hours, removing the cap takes 131 hours out of badly low (185 to 54) and puts 449 into badly high (317 to 766) (from the `low` and `high` shares of `capped_rising`, P against N). The owner's observation is real on those 185 hours; most badly-low rising hours are out of reach of any cap rule. One-directional quantities (see section 7). |
| F4 | MINOR | **Large-rise intervals rest on few independent months.** `rl_large` is 8 rises (about 10 calendar months) in the design years and 13 rises (about 14 months) in the test years; month-block percentile intervals with that few non-empty blocks are fragile and tend to be too narrow. The design label is `unclear` ([-1.32, +16.41]); the test label `good_job` ([+4.87, +24.49]) should be quoted with this caveat. |
| F5 | MINOR | **The Little-Falls-led split is one rise (2026-10-12, 37 hours) on readings USGS has since revised.** It lies after 2026-10-08. Its striking numbers (F135 badly-off -29.7 points, mean `d` -3.75) must not be quoted. The same 37 hours are 8% of the 452 test `rl_large` hours. |
| F6 | MINOR | **The size of the loss depends on truth timing; for LF3 and LF6 it turns into a small gain at +2 hours.** `timing_candidates.csv`: at -1 hour every candidate is worse than at 0 (LF3 rising +2.39, all +0.091); at +1 hour LF3's overall `d` is +0.0018; at +2 hours LF3 and LF6 have mean `d` -0.030 and -0.024 and badly-off rising -0.33 points each, all other candidates stay worse. No interval exists for these (the S rows are only for a pick). `timing_flag` is blank (no pick). The report can say the conclusion holds for truth up to 1 hour later; it cannot say it holds whatever the timing. |
| F7 | MINOR | **USGS: 18 of 21 readings match exactly; three Little Falls readings of the 2026-05-23 rise are 0.8 to 1.0% higher in the input than today's approved record** (6,555 against 6,490; 8,760 against 8,690; 9,435 against 9,360). These are before the stated 2026-10-08 boundary. Like the earlier audit's 2026-10-01 note, the 2026 input is not identical to today's approved data earlier in 2026 either. The cap's reading and the truth of that rise both sit about 0.8% high, so the percent error barely moves; no effect on any conclusion. |
| F8 | MINOR (documentation) | `r/REPORT.md`, section "Checks", still prints `C15_expected_counts,-,26,0`, the label before the correction; `checks.csv` says `L`. The text should be corrected (no output changes). |
| F9 | INFO | Departures of the specification from `PLAN.md` (section 4 below): none could change a conclusion. |
| F10 | INFO | The pick path (a non-empty pick: S01 to S03, `timing_pick.csv` values, `timing_flag`) was exercised by nobody on real data, only by unit tests (and a throwaway run of the Python analyst). Irrelevant to this verdict; relevant if the code is reused. |

## 1. Agreement and reproducibility

- `python3 -I tools/compare_analysts.py py r`: 14 of 14 `IDENTICAL`, `BYTE-IDENTICAL: yes`, `AGREE`, exit 0.
- `cmp py/<f> r/<f>` on all 14 files: no output (identical).
- md5 of all 28 files recorded, then `python3 -I py/run_all.py` (31.7 s, exit 0) and `Rscript --vanilla r/run_all.R` (23.1 s, exit 0, "pick: none") rerun in place from the study folder. The files were rewritten (new modification times) and all 28 md5 are unchanged (`diff md5_before.txt md5_after.txt` empty). Examples: `decision.csv` 44f23d319bf700312fcb13264f00b42c, `intervals.csv` 6d7e010eab440ae51b9e5b871797dcd0, `rule_tables.csv` 88f6905d2d35bf7879f6b5512f6a0c37, `pick_design.csv` e90362871e7f7dcb95aa3e3ef2c2d421.
- The compare tool works: on scratch copies a changed verdict word gives `DIFFER`; a 0.01 change in an interval is `WITHIN_TOLERANCE` as section 19 says (the byte-identity line would then say `no`).
- SHA-256 at the time of audit: `ANALYSIS_SPEC.md` `f11496dbf257097afad5cb0fd06f97e4c4b09a9fefe5a85c1d40bac77edf73eb`; `PLAN.md` `17e59341c9fba6a4451bdbc2164fb491c8fd548d3383c6607a832440e6f8cb58`; `py/run_all.py` `ffbd6f48...16d0fd`; `r/run_all.R` `b60495d3...0377ec`; `tools/compare_analysts.py` `33b53d7c...322940`.

## 2. My own implementation

`audit.mjs` (Node.js 24, no libraries; a third language, so neither analyst's parser or formatter is shared). Written from the specification only. It computes, for both arms: the row accounting, the scored hours, the rebuilt truth, all 18 rules' limits and shown values with every fall-back, errors and classes, all 18 populations, the full `rule_tables.csv` (2,592 rows), `populations.csv`, the description (`cap_description.csv`, `cap_classes.csv`), all 35 interval rows with the shared draws, the pick, the decision inputs, the decision, the per-rise table, and the three shifted runs for both arms (`timing_candidates.csv`, `timing_gate.csv`, `timing_pick.csv`). `%.6f` is my own exact decimal conversion of the double (round half to even on exact binary ties, as C's printf), with `-0.000000` normalised.

Cell-by-cell comparison with the analysts' files (`cmp_mine.py`):

| File | Rows | Largest absolute difference | Byte-identical |
|---|---|---|---|
| row_accounting.csv | 12 | 0 | yes |
| populations.csv | 76 | 0 | yes |
| rule_tables.csv | 2,592 | 0 | yes |
| cap_description.csv | 12 | 0 | yes |
| cap_classes.csv | 22 | 0 | yes |
| intervals.csv | 35 | 0 | yes |
| pick_design.csv | 10 | 0 | yes |
| decision_inputs.csv | 22 | 0 | yes |
| decision.csv | 10 | 0 | yes |
| rises_test.csv | 153 | 0 | yes |
| timing_gate.csv | 32 | 0 | yes |
| timing_candidates.csv | 30 | 0 | yes |
| timing_pick.csv | 72 | 0 | yes |
| checks.csv | 60 | not rebuilt as a file | see below |

`checks.csv`: I recomputed C09 (0 of 119,447 / 119,464), C10 (0 / 0), C16 (0 / 0; the rebuilt truth equals the parsed `truthFlow` exactly, maximum difference 0, in both arms, so using either truth changes no class), C17 (0 violations; `n_checked` 1,720,878 for L and 1,721,113 for F, equal to the file) and the C15 counts (through `populations.csv`, identical). No difference above 1e-6 anywhere, so nothing needed a root-cause explanation.

### Headline quantities, mine against the analysts'

| Quantity | Analysts | Mine |
|---|---|---|
| Scored hours L design / test | 59,999 / 59,448 | same |
| Rising hours design `n_r` / P badly-off count | 9,272 / 1,321 (14.247196%) | same |
| Design mean `d` all: F135, F150, F200, LF3, LF6, MR, UP, RIS, ICE, N | 0.105178, 0.165740, 0.285480, 0.046404, 0.046596, 0.232940, 0.132899, 0.222938, 0.212006, 0.350174 | same |
| Design badly-off rising counts (same order) | 1479, 1538, 1582, 1397, 1382, 1564, 1546, 1581, 1506, 1581 | same |
| Qualifiers / leader / pick | 0 / none / none | same |
| N against P, test all: mean `d` [lo, hi] | 0.395885 [0.253795, 0.567843] | same |
| N against P, test rl_large | 14.515907 [4.871760, 24.491185] | same |
| Reach test / design | 185 of 926 (19.978402%) / 190 of 870 (21.839080%) | same |
| Shift -1: n missing / out of range / left (L) | 143 / 3 / 59,302 | same |
| Verdict | KEEP | KEEP |

## 3. Pick and verdict recomputed

From `pick_design.csv` by hand: every `mean_d_all` is positive (smallest LF3 +0.046404, `mean_d_sign` 1 for all ten; M5 near misses 0). Section 9: nobody qualifies, so there is no leader, no tie, no pick. Section 10.3: with no pick all nine conditions are `not_applicable` and the verdict is `KEEP` (rule 1). `decision_inputs.csv` shows `pick none`, `n_qualifiers 0`, `leader none`, `P_off_rising_design 14.247196`, `P_c_off_rising 1321`, the rest blank, as 10.2 requires. `decision.csv` matches.

From my own numbers: identical.

Robustness (mine, description only): if the qualifying step were dropped, the smallest badly-off count is LF6's 1,382, still above production's 1,321, so the pick rule would still give no pick. If any candidate were forced as the pick, every one gets `KEEP` from rule 3 (condition 1 interval upper bound above 0); LF3 and LF6 would pass conditions 2, 3, 8 and 9 and fail 1, 4, 5, 6 and 7.

## 4. The computed study against the confirmed plan

Checked against `PLAN.md` sections 3 to 8, 17 and 18.

| Point | Plan | Specification and outputs | Could it change a conclusion? |
|---|---|---|---|
| Rules (4.1, 4.2) | as listed | same arithmetic; extra fall-backs to production in LF3/LF6 (row absent, `lfSrcTs` blank, `T` or `a` blank) and MR (`T` or `a` blank, row absent) that the plan's text implies but does not list | No: `T` and `a` are never blank on a scored hour (C06); LF3/LF6/MR fall back on few hours (`populations.csv`) |
| MR "no estimate" | plan 4.1 counts 120/70 fall-backs, 1,903/2,121 differ | follows the rule's words (18.1): 120/0 and 1,903/2,122 | No; recorded in 18.1. The plan's 4.1 counts must not be quoted |
| Truth (3.3) | `truthFlow` | rebuilt `truth(tau0)` (18.2) | No: identical to `truthFlow` on every scored hour of both arms (my check, max difference 0) |
| Gate failure | drop only the timing tables | stop the whole run (18.2) | No: 0 failing hours |
| Shifted runs | leave out hours with no shifted truth | also leaves out hours outside 500 to 500,000 cfs (3, 4, 7 hours) | No |
| Arm F in the timing tables | "computed three more times" | shifted too (18.3) | Not used (no pick) |
| Periods, populations, measures (5) | as listed | same, including both ends of each limb, the class split, the six bins | No |
| Description reading (6) | good job if mean `d` > 0 and whole interval > 0 | `good_job` if the written lower bound > 0 | No: every `good_job` row has mean `d` > 0 |
| Pick (7) | qualify at mean `d` <= 0.00, ties within 0.1 points, tie order | same, on exact counts (18.4) | No |
| Nine conditions and thresholds (8, 17) | 1.0, 0.05, 0.5, 1.5 points, 5% | -1000000, 50000, 500000, 1500000 micro-units, `mae_rel` <= 0.05 | No: identical thresholds |
| Verdict wording (8) | KEEP if no pick or interval includes 0 or lies above | rule 1 and rule 3 of 10.3 | No |
| Truth-timing reading (8) | timing effect flag | `timing_flag`, blank with no pick | No |
| Mix left out (17.3) | left out | left out | No |

Structural facts in the real results (my own count, both arms):
- Shown value of every rule except T110 at least production's: 0 violations in 1,719,898 (L) and 1,720,139 (F) hour-rule pairs; a rule differs from production only on capped hours (0 exceptions).
- Badly-low count never above production's and badly-high count never below, in every one of the 974 non-empty table rows per arm: 0 violations.
- Fixed caps nested, hour by hour, T110 <= P <= F125 <= F130 <= F135 <= F140 <= F150 <= F175 <= F200 <= N: 0 violations; the low and high counts are monotone along that ladder in every table row: 0 violations.
- The three zero cells of `cap_classes.csv` are 0 in both periods.

## 5. Data integrity and provenance

- SHA-256 and byte sizes of the five inputs equal section 1.1 of the specification (shadow_L dcc63931...ba5aba, 109,952,178; shadow_F 7fb80722...2a63a3, 110,149,295; boot_uniforms 71d75af9...d515, 13,000,392; hourly d1d3f6a5...c8c4f, 10,133,893; events 978c6c2f...7cac44, 24,205).
- Every one of the 14 CSV files in each folder is written by that folder's one script and was rebuilt by the one command (task 1).
- Row accounting sums at every step. Arm L: 130,987 read; 2,392 not predicted; 8,751 burn-in; 356 hard flag; 41 out of range; 0 blank error; 119,447 scored. Arm F: 2,374; 8,753; 355; 41; 0; 119,464. Identical to my own count. No silent drop; `blank_error` drops nothing.

## 6. Readings against USGS

Request form, as in the earlier audit: `https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items?monitoring_location_id=USGS-<site>&parameter_code=00060&time=<start>/<end>`. No key, no header, nothing but the gauge, the parameter and the times. All answers HTTP 200. The input's hourly value at stamp T is the median of the readings in [T, T+1h); I compared it with the median of today's readings in that hour. The first request for each 2026 hour came back paged (10 of 12 five-minute readings, a `next` link); I did not follow the link (it carries a server cursor) and instead asked for the two half hours separately, which returned all 12. All chosen hours are the cap's reading (Little Falls) or the Point of Rocks input of capped rising hours inside large rises, plus two hours that make up the truth of one such hour (2021-09-23 22:00 and 23:00 for the estimate of 16:00) and three 2025 to 2026 hours I added after the first mismatch.

| Gauge | Hour (UTC) | Readings | File value | USGS median now | Difference |
|---|---|---|---|---|---|
| Little Falls 01646500 | 2015-06-20 05:00 | 4 | 5,570 | 5,570 | 0 |
| Point of Rocks 01638500 | 2015-06-20 04:00 | 4 | 3,710 | 3,710 | 0 |
| Little Falls | 2017-07-29 13:00 | 4 | 16,750 | 16,750 | 0 |
| Point of Rocks | 2017-07-29 12:00 | 4 | 7,590 | 7,590 | 0 |
| Little Falls | 2019-11-01 06:00 | 4 | 9,545 | 9,545 | 0 |
| Point of Rocks | 2019-11-01 05:00 | 4 | 6,135 | 6,135 | 0 |
| Little Falls | 2021-09-23 15:00 | 4 | 10,350 | 10,350 | 0 |
| Point of Rocks | 2021-09-23 14:00 | 4 | 11,450 | 11,450 | 0 |
| Little Falls | 2021-09-23 22:00 | 4 | 15,400 | 15,400 | 0 |
| Little Falls | 2021-09-23 23:00 | 4 | 17,400 | 17,400 | 0 |
| Little Falls | 2024-09-29 17:00 | 4 | 8,340 | 8,340 | 0 |
| Point of Rocks | 2024-09-29 16:00 | 4 | 22,150 | 22,150 | 0 |
| Little Falls | 2025-05-04 07:00 | 4 | 4,500 | 4,500 | 0 |
| Little Falls | 2025-11-15 12:00 | 12 | 1,460 | 1,460 | 0 |
| Little Falls | 2026-02-15 12:00 | 1 | 2,070 | 2,070 | 0 |
| Point of Rocks | 2026-05-23 22:00 | 12 | 6,800 | 6,800 | 0 |
| Little Falls | 2026-05-23 23:00 | 12 | 6,555 | 6,490 | +65 (+1.0%) |
| Little Falls | 2026-05-24 06:00 | 12 | 8,760 | 8,690 | +70 (+0.8%) |
| Little Falls | 2026-05-24 07:00 | 12 | 9,435 | 9,360 | +75 (+0.8%) |

All readings are "Approved" today. 21 readings, 6 before 2020, 15 from 2020 to 2026, none after 2026-10-07. 18 match exactly. The three mismatches are one rise (finding F7). None after 2026-10-07 was checked, as the brief required.

## 7. What the results support

**(a) The cap against no cap** (`cap_description.csv`; mean `d` of N against P, points; positive means the cap lowers the error):

| Group | Design | Test |
|---|---|---|
| all | +0.350 [+0.238, +0.476] good_job | +0.396 [+0.254, +0.568] good_job |
| capped | +9.83 [+7.32, +12.55] good_job | +9.37 [+6.38, +12.71] good_job |
| capped rising | +10.80 [+7.81, +13.79] good_job | +13.71 [+8.81, +19.68] good_job |
| capped not rising | +8.49 [+4.15, +14.05] good_job | +4.70 [+1.95, +7.70] good_job |
| Little Falls rising | +1.07 [+0.64, +1.54] good_job | +0.95 [+0.53, +1.48] good_job |
| large rises (rl_large) | +6.66 [-1.32, +16.41] unclear | +14.52 [+4.87, +24.49] good_job (F4) |

On capped test hours (2,511): the cap turns 627 badly-high hours into within 15% and 76 into badly low; it turns 215 within hours into badly low; 163 are badly low either way, 575 badly high either way, 855 within either way (`cap_classes.csv`).

**(b) Pick and verdict.** No candidate qualified (all ten have mean `d` over all design hours above 0, smallest LF3 +0.046 and LF6 +0.047). No pick. Verdict KEEP. Robust (section 3).

**(c) Each candidate in the test years, description, not a test** (badly-off share difference on rising hours [95% interval]; mean `d` over all scored hours [interval]):

| Rule | Rising badly-off difference | Mean `d`, all |
|---|---|---|
| F135 | +2.41 [+1.58, +3.39] | +0.126 [+0.086, +0.170] |
| F150 | +2.93 [+1.92, +4.08] | +0.189 [+0.132, +0.249] |
| F200 | +3.48 [+2.37, +4.74] | +0.295 [+0.207, +0.389] |
| LF3 | +1.24 [+0.64, +1.93] | +0.044 [+0.022, +0.068] |
| LF6 | +1.30 [+0.70, +2.02] | +0.046 [+0.023, +0.071] |
| MR | +2.84 [+1.90, +3.93] | +0.270 [+0.195, +0.349] |
| UP | +3.27 [+2.21, +4.49] | +0.201 [+0.141, +0.268] |
| RIS | +3.51 [+2.40, +4.78] | +0.300 [+0.177, +0.461] |
| ICE | +2.48 [+1.46, +3.67] | +0.306 [+0.169, +0.472] |
| N | +3.51 [+2.40, +4.78] | +0.396 [+0.254, +0.568] |

Every interval lies above 0. RIS and N are identical on rising hours by construction (RIS is no cap on rising hours); they are one result, not two. Arm F agrees in sign (rising badly-off +1.13 to +3.26).

**(d) Truth timing.** Gate passed (0 of 119,447 failing). Left out: 146, 136, 281 hours (L, shifts -1, +1, +2; F 146, 138, 282). With truth 1 hour earlier every candidate is worse than at 0; 1 hour later still worse but less; 2 hours later LF3 and LF6 show small gains (finding F6), the other eight stay worse. No timing flag (no pick).

**(e) Reach.** 185 of 926 badly-low rising test hours are capped (19.98%); design 190 of 870 (21.84%). About 80% of the badly-low rising hours cannot be touched by any cap rule. One-directional.

**(f) Large rises** (test, 452 hours, 13 rises). Production is badly low on 43.1% and badly high on 3.5% of them; without the cap 26.5% and 30.3%. F135 and LF3 have a slightly lower mean absolute error than production (mean `d` -0.37 and -0.30) but a higher badly-off share (+1.33, +2.21 points); no interval exists for candidates on this group. Lower per-rise MAE than production on 8 of 13 rises for F135 and LF3, 7 for LF6, 5 for F150, 4 for F200, 3 for UP, 2 for MR, RIS, ICE and N. Plan section 12: these rises were known when the rules were shaped, so this is not an independent test.

**Statements the report may make (with these numbers):**
1. The cap does a good job on all six groups in the test years and on five of six in the design years; on the design large rises the reading is unclear (table under (a)).
2. Without the cap the error on capped hours would be about 9 to 10 points larger on average (design +9.83, test +9.37).
3. No looser candidate qualified; there is no pick; the verdict is KEEP; this does not depend on the qualifying line (section 3).
4. Each of the ten listed looser rules is more often badly off on rising test hours than production, by 1.2 to 3.5 points, every interval above 0 (table under (c)); in the design years too (+0.66 to +2.81).
5. On capped rising test hours the cap moves more hours out of badly high (449) than into badly low (131) (F3).
6. Only about one in five badly-low rising hours is capped; most low readings on rising water are not the cap's doing (reach).
7. On the large rises production reads badly low on 43% of hours; removing the cap would trade that for 30% badly high and a higher mean error (+14.5 points).
8. The conclusion is the same with the truth one hour earlier or one hour later; at two hours later LF3 and LF6 show small gains (no interval).
9. As description only: the 110% cap has lower error overall and on rising hours, and higher error on the large rises; it was not tested (F2).

**Statements the report may NOT make:**
1. "A tighter cap would be better" or "110% is better" (never a candidate, no pre-registered test; F2).
2. "No cap rule can help on rising water" in general: only the ten listed rules were tested.
3. "The cap causes the app to read low on rises" (80% of badly-low rising hours are uncapped).
4. Anything from the Little-Falls-led split (one rise, on revised readings; F5).
5. "Loosening helps on large rises" from the per-rise counts or the slightly negative mean `d` of F135 and LF3 (no interval; badly-off share up; condition 5 is not independent).
6. "The result does not depend on truth timing" (F6).
7. Low- or high-share differences, the reach or the class table as a benefit or harm of any rule: they are one-directional by construction (every rule except T110 can only raise the shown value).
8. The plan's section 4.1 counts for MR (70, 2,121), or any claim about the live app's cap (the replay's Little Falls reading is one hour old).

**Numbers a reader is likely to misread.**
- Mean `d` over all hours (+0.35 / +0.40) looks negligible; it is diluted by the 96% of hours the cap never touches. Per capped hour it is about 9.4 to 9.8 points.
- `off_diff` is a difference in percentage points of hours, not of error.
- `mae_rel` is a fraction (0.05 means 5%).
- ICE-T and `P_icet_hours` are on 47,640 test hours only, not 59,448.
- Arm F has more rising test hours (10,332) than arm L (9,059), because the state depends on input timing.

## 8. Limits beyond plan section 12

1. The study tests only loosening rules. It cannot say whether 120% is the best factor; the description suggests the overall optimum may lie below 120% and that the large rises pull the other way. That question was never posed.
2. Large-rise intervals have few effective blocks (F4); percentile intervals with 10 to 14 non-empty months tend to under-cover.
3. The badly-off line at 15% counts 90 (L) and 167 (F) hour-rule pairs that sit exactly on 15 (`M1x`); deterministic, but a different line could move small differences.
4. The 2026 input is not today's approved record even before 2026-10-08 (F7); and 37 large-rise hours are inside the revision window.
5. The timing tables do not recompute the hard flag (stated in the specification); they bound timing only for the hour set scored at the app's truth time.
6. Percent errors weight a 15% miss at 1,000 cfs the same as one at 50,000 cfs; the two flow-range conditions do not enter (no pick), so nothing here speaks to the cost in cfs.

## What I could not check

- I did not read either analyst's code (on purpose before my implementation, and not needed after a byte-identical match). So I cannot say how they implemented the unit tests; I rely on `checks.csv` (all 15 pass in both) and the specification review's own recomputation of the expected values.
- `checks.csv` was not rebuilt row by row; C09, C10, C15 (counts), C16 and C17 were.
- The pick path on real data (F10).
- Why the 2026-05 Little Falls values differ from today's record (provisional data at fetch time is the likely reason; not verified).
- Whether the truth's travel-time pairing matches the real arrival of water; the timing tables bound it, they do not check it.
- The app's own log and this week's rise (plan section 9).

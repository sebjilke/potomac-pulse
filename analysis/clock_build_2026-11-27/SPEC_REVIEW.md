# Review of `ANALYSIS_SPEC.md` (version 1.0), clock build step 1

Reviewer: independent (Opus), 2026-11-27. I did not write the specification, the plan or the tool. Read: `ANALYSIS_SPEC.md`, `PLAN.md` (sections 0 to 12), `PLAN_AUDIT.md`, `FACTS.md` section 1, `TOOL_AUDIT.md`, the cap study specification (sections 2, 6, 7, 8, 12, 13, 16 to 19), the clock study specification (sections 4 and 6), `scheduled-update.js` (the scored error and the notice input) and `shared/ci-table.js`. Every count and check below was recomputed with my own scripts from the input files (Python standard library, `python3 -I`; R 4.5.2 base for the cross-language tests). Scripts: `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/clock_spec_review/` (`rev.py`, `main.py` to `main4.py`, `units.py`, `knife.py`, `knife.R`, `parse.py`, `parse.R`, `fixed.py`, `capq.py`). Nothing in the repository was changed except this file.

## Verdict: READY AFTER CHANGES

The arithmetic of the specification is sound. Every group count reproduces exactly from the rule text, all 18 unit tests are right, all 12 checksums match, and both own-truth rebuilds (B05, B06, B08) give 0 violations on all 129,534 estimate hours of each run, burn-in included. R and Python give the same validation hour on every row of both runs.

What must change before the analysts start:
- one BLOCKER: a file that has to match byte for byte contains free text;
- six MAJOR findings. The plan's stop rule for learning health is missing. Three readings can mislead the owner because the way they are built pushes them one way: the cap label, the item 2 table on the common truths, and the "holds" rule. The trend yardstick changes with the truth it is judged on. No check tests the common-truth timing itself, so a misreading the two analysts share would pass unseen.

The minor findings are wording, R traps and the compare contract.

## Findings

### F1. BLOCKER. `checks.csv` must be equal as text, but its `description` column is free text
Quoted (section 14): "`description` is the id's text from the table (short)."
Evidence: section 15 point 3 makes `checks.csv` a tolerance-0 text file. The table texts are long sentences with backticks and commas (for example U03 and B05), and "short" does not say how to shorten them. Two blind analysts will write different strings, so the compare tool will report DIFFER whatever the numbers are. This is a check that fails for a reason that has nothing to do with the analysis.
Replacement text: "`description` is the id itself, character for character (for example `U01_round`, `S01_sha_shadow_OLD`, `G12_test_all`, `I01_design_mae_all`). No other text is written in this column."

### F2. MAJOR. Plan 3.4 item 6 ("a failure here stops the step and is investigated") is not implemented
Quoted (preamble): "The only things that can stop a run are the checks of section 14, which test the machinery." Section 10 only computes numbers.
Evidence: the plan names health measures whose failure stops step 1, but it gives no line, and the specification does not define one. So the stop rule exists only in the plan, and nobody can apply it mechanically. Raw counts are also a poor basis for such a rule, because NEW stores 60% more slots (38,046 against 23,764). Its 133 missed windows against OLD's 76 are 0.35% against 0.32% of stored slots, and its 396 retries against 222 are 1.04% against 0.93%. A rule on raw counts would stop the step for the cadence alone.
Replacement text (new section 10.1; the limits are the orchestrator's to set before the start, and the 1.5 is the only factor on record, from PLAN_AUDIT F6):
"10.1 Health stop rules (checks H01 to H04, stopping). H01: `pending_at_end` is 0 in both runs. H02: for each `x` of `dropped_missed_window`, `retries` and `hard_skipped` (counts file), the rate per stored slot of NEW is at most 1.5 times OLD's, tested on exact integers: `2 * x_NEW * slots_stored_OLD <= 3 * x_OLD * slots_stored_NEW`. H03: test period, `2 * mic(corr_jump_p99 NEW) <= 3 * mic(corr_jump_p99 OLD)` on the written strings (8.1). H04: test period, `2 * n_jumps_ge5(NEW) <= 3 * n_jumps_ge5(OLD)` (integers). The rates `(100.0 * x) / slots_stored` are written in `learning_health.csv` block 1 as metrics `rate_missed_window`, `rate_retries`, `rate_hard_skipped` (`%.6f`), for the record. A failure writes `checks.csv` only and is investigated (plan 3.4 item 6)." Add the four H rows to the list of section 14 and update the row counts (`checks.csv` 86, `learning_health.csv` 82).
If the orchestrator does not want limits, the plan's sentence must be changed by the orchestrator, not quietly dropped in the specification.

### F3. MAJOR. The cap label `good_job` can mislead the owner about reading low, and "harm" can hardly hold
Quoted (8.1): "comparison `cap` [source: cap 8.1]: `good_job` if `mic(lo) > 0`; else `harm` if `mic(hi) < 0`".
Evidence (computed by the reviewer on run NEW, test years; the numbers are under "Numbers seen by the reviewer"):
- The label is built on the mean difference in absolute error. The cap can only lower the number shown, so it can never remove a badly-low reading, only add some. On Little Falls rising hours with the cap binding, the central truth gives 80 badly-low hours with the cap and 11 without it. Even so, the label is `good_job` on all three truths.
- On the short-end truth (0.30 times the clock, 0.6 to 1.7 hours ahead) the river can hardly climb above 1.2 times the reading the model holds. The cap is farther from that truth on only 33 of 2,245 capped hours. So the short-end label is almost bound to come out `good_job`, and a `harm` reading can hold on all three truths only in theory.
- So `good_job` "holds" on every group in both periods. A reader will take that as "the cap is good" on rising water, where it adds badly-low readings, which is the owner's main concern.
Replacement text: (a) in 8.1 rename the labels for `cap` to `cap_closer` / `cap_farther` / `unclear`, and for the yardsticks to `app_closer` / `yardstick_closer` / `unclear`, defined exactly as now; (b) add two columns to `new_cap_yardsticks.csv`, `n_low_app` (hours with error of P `<= -15`) and `n_low_other` (the same for the other), integers, written on every row. This is part of "the cap against no cap" in plan 3.4 item 4, which names no measure. The orchestrator must approve it as an addition. (c) Add to 8.3: "Known property: the short-end truth lies 0.6 to 1.7 hours ahead, so persistence (`Y0`) and the cap have a built-in advantage on it. A reading of `cap_farther` or `app_closer` can hold on all three truths only rarely. A reading that does not hold is not evidence for the other side."

### F4. MAJOR. Item 2 (the owner's concern) and the common-truth tables lean toward NEW by the way they are built, and the specification does not say so
Quoted (section 6): the whole section; (7.2): "Columns `period,group,truth,run,...`"; (preamble): only the staircase is stated up front.
Evidence: PLAN_AUDIT F1 and answer 3: all three common truths lie on NEW's side of OLD's clock on all but 109 of 59,746 test hours. NEW's own truth lies between 0.18 hours before and 0.82 hours after the central truth (reviewer: median +0.277 hours). OLD learned against a truth several hours later. A lower badly-low share for NEW on these truths, and a lower MAE, are therefore what the way the replay is built predicts. They are not evidence that NEW is better. Plan 3.4 says only of item 4 that "here the three truths do protect". The specification states this for the two-by-two table (7.1) but not for item 2 or for `common_truth_errors.csv`, and item 2 is the first file the owner will read.
Replacement text, added under the "Known property" paragraph at the top and repeated at the end of sections 6 and 7.2: "Known property 2: on all three common truths run NEW has an advantage built into the replay. Its corrections learned against a truth within -0.18 to +0.82 hours of the central truth. OLD's corrections learned against a later and higher river on rises, and all three truths lie on NEW's side of OLD's clock on all but 109 test hours. In `badly_low_rising.csv` and `common_truth_errors.csv` a lower value for NEW is therefore expected and shows nothing about which clock is right. A higher value for NEW would be informative. The three truths protect only the readings inside run NEW (section 8)."

### F5. MAJOR. The trend yardstick `Y1` becomes a different estimator on each truth, so "holds on all three" stops protecting
Quoted (8): "`h` = the clock hours of THIS truth (`clock`, `1.23 * clock` or `0.30 * clock`, section 4)".
Evidence: the app `P`, the no-cap value `N` and `Y0` are the same on all three truths. Only `Y1` changes with the truth, because it is told each truth's horizon, which no estimator that could be shipped can know. Plan 3.4 item 4 asks that "a reading counts only if it is the same on all three". That protects only if the estimators being compared stay fixed while the truth moves. The plan's words are "carried over the clock", and "the clock" is the term defined in PLAN section 2, `clock(Q)`. In the reviewer's computation the choice changes 5 of the 60 per-truth labels of `Y1`, the `reading` in 4 of the 20 (period, group) rows and `holds` in one (test `rl_large_creekfed`: `mixed` with the truth's clock, `yardstick_beats` on all three with the central clock). One of the 5 is test `lf_rising`, short truth: `yardstick_beats` against `unclear`. PLAN_AUDIT F14 ("it must use the clock of each truth") points the other way. That clause came from the clock study, where the truth and the clock being tested were the same thing. It does not carry over to a fixed app judged on three truths.
Replacement text (8, bullet Y1): "`h` = `clock` of section 4 (the NEW clock at this hour), the same on all three truths, so that `Y1` is one fixed estimator judged on three truths. `Y1 = floor(L + max(0.0, ((L - L3) / 3.0) * (clock + a)) + 0.5)`." Open point 12 is changed to match. The orchestrator records this as a ruling against the last clause of PLAN_AUDIT F14, with the reason above.

### F6. MAJOR. No check tests the common-truth timing, so a misreading both analysts share would pass
Evidence: the common truths are the core of items 2, 4 and 7. The truth function is tested (U06, and by B05 and B06 on the staircase), and the clock is tested (U11, B04). Nothing tests that the analyst reads the common truth at `t + h` exactly. The orchestrator's first brief made exactly this mistake (open point 0). If both analysts slip back to the staircase, the compare tool says AGREE. This is the kind of check that cannot fail.
Replacement text, a new stopping check `B11_common_fixed` after B09 (violations; tolerance `1e-6` absolute; "none" means missing):

| predTs | clockQ | central | long | short |
|---|---|---|---|---|
| 2013-10-07T10:00:00.000Z | 1370 | 1517.829896030 | 1703.794713267 | 1370.000000000 |
| 2015-12-26T11:00:00.000Z | 20450 | 20800.000000000 | 20800.000000000 | 20566.931502563 |
| 2019-12-04T05:00:00.000Z | 3750 | 3830.000000000 | 3830.000000000 | 3750.000000000 |
| 2023-09-24T13:00:00.000Z | 5945 | 6210.000000000 | 6365.964228735 | 6345.617093952 |
| 2020-06-01T05:00:00.000Z | 11150 | 11200.000000000 | 11200.000000000 | 11150.000000000 |
| 2026-07-20T18:00:00.000Z | 2960 | none | none | none |

(Computed by the reviewer with the rule of section 4 and 2.3. On the staircase the first row would give 1542.2917, which is `truthFlow`, so the check separates the two readings.) Raise the count of `checks.csv` by one.

### F7. MAJOR. The report is not required to lead with item 2 and the staircase, and has no "what it cannot show" part
Quoted (preamble): "(the report leads with it)"; (6): "FIRST data file".
Evidence: plan 3.4 item 2 ("in front"), plan 12 ("to lead the report") and plan 3.5 ("The report states the description and what it cannot show"). The analysts' `REPORT.md` has no results section, and the specification never says who writes the owner's report or in what order. The order of the files does not decide what the owner reads first.
Replacement text, new section 17: "The report to the owner (written by the orchestrator after the third auditor, not by the analysts) opens in this order: (1) the staircase property; (2) Known property 2 (F4); (3) `badly_low_rising.csv`, test rows, both runs, three common truths, with the design rows beside; (4) movement on rising water; then items 3 to 6 in plan order; (5) at the end, what the replay cannot show: PLAN section 6, TOOL_AUDIT 'What this replay cannot show' 1 to 7, and that no verdict is computed."

### F8. MINOR. Hard flags on the common truths
Quoted (4): "No hard flag of the tool is applied to the common truths (open point 6)."
Ruling and replacement: see open point 6. Text: "An hour with `truthDependentHard == "1"` in EITHER file is not valid for any common truth (symmetric in the two runs; the app never scores a hard-flagged pair). Row accounting: a step `hard_flag_either` after `truth_out_of_range` in each `common_*` scope (6 rows each, 18 in all; `row_accounting.csv` then has 40 rows). I04 then counts these hours (test, central): `got` `<OLD>:<NEW>`." Expected effect: 233 (OLD flag) and 250 (NEW flag) of 59,708 test hours for the central truth, before taking the union.

### F9. MINOR. M05 leaves out exact whole hours, the one case where it matters, and measures in the wrong unit
Quoted (M05): "`0 < abs(x - floor(x + 0.5)) < 1e-9`".
Evidence: a due time that falls exactly on a whole hour is where a one-unit parse difference in R can move `ceil` to the next hour. `0 <` leaves that case out. The rule is also written in hours of a quotient, not in time. See section "Own-truth checks" for the risk itself, which is negligible on these files.
Replacement text: "M05_due_knife (STOPPING, expected 0): estimate hours of OLD (`h = travelGFtoLF`) or NEW (`h = clockHrs`) with `abs(dueMs - 3600000.0 * floor(dueMs / 3600000.0 + 0.5)) < 1.0` (milliseconds, 0 included); `got` is the total. A one-unit difference in the last place of `h` moves `dueMs` by less than 0.001 ms, so when M05 is 0 the validation hour of B05 and B06 is the same in Python and R. If M05 is not 0, stop and report the hours; do not change B05 or B06." The result letter of M05 is then P or F. The reviewer counts 0 on both runs (closest due time 32.3 ms from a whole hour in OLD, 53.4 ms in NEW).

### F10. MINOR. Section 2.6 (a) is not true for item 4 and the health block
Quoted (2.6): "(a) every error in this study uses `predictedCFS` (identical in both languages)".
Evidence: `N = floor(u + 0.5)` (item 4), the capped test `u > 1.2 * L` (block 3) and the jumps (block 3) use `rawUnc` and `corrUsed`, which are long decimals. I tested R `as.numeric` against Python `float`: `shownN`, the capped flag and `jump >= 5.0` are identical on every estimate hour of both runs (closest margins: `u + 0.5` 6.8e-6 from an integer, `jump` 0.00087 from 5.0, `u` 0.0206 cfs from `1.2 * L`). So there is no live problem, but the sentence is wrong and the near misses are not counted.
Replacement text: "(a) every error uses `predictedCFS` and a truth from the hourly record, EXCEPT the no-cap value `N` (8), the cap flag and the correction jumps (10), which use `rawUnc` and `corrUsed`. Their near misses are counted in M03, M06 (estimate hours with `abs((u + 0.5) - floor((u + 0.5) + 0.5)) < 1e-9`, 0 included: `u + 0.5` within 1e-9 of a whole number) and M07 (steps of block 3 with `abs(jump - 5.0) < 1e-9`, 0 included)." Add M06 and M07 as information rows (`<OLD>:<NEW>`).

### F11. MINOR. R traps not named: epoch milliseconds above 2^31, and number keys turned into text
Evidence: epoch ms here are about 1.6e12. R integers stop at 2,147,483,647 (`as.integer` gives NA with a warning). A map keyed by `names()` goes through `as.character`, which writes some round values like 1.5e12 in exponent form. The section says "integers" without saying what that means in R.
Replacement text (1.0, after the index trap): "In R every hour key, epoch millisecond, `tau`, `lo0` and `dueMs` is a double (exact below 2^53); never `as.integer` or the `L` suffix for them. The hourly map is a numeric vector indexed by `epoch_ms / 3600000 - K0h + 1` (with `K0h` the first hour key of the hourly file), never a named vector or an environment keyed by `as.character`."

### F12. MINOR. R `sum()` and the bootstrap loop
Quoted (2.2): "or `sum()` on a plain double vector in that order"; (8.2): "plain loop, that order".
Evidence: the cap study added "The study runs on one arm64 machine (R's `sum()` has no extended precision there)". That sentence was dropped here, and it is what makes `sum()` equal to the loop. The plain triple loop (180 rows x 10,000 draws x 85 blocks, about 150 million steps) is slow in R. Looping over blocks with the 10,000 draws as a vector keeps the same order of additions for every draw.
Replacement text: add to 2.2: "This holds on arm64 macOS, where R's `sum()` accumulates in plain doubles; on another machine use the loop." Add to 8.2: "Allowed and identical: hold the counts as a 10,000 x B matrix `C` and compute `num <- 0; den <- 0; for (j in 1:B) { num <- num + C[, j] * S[j]; den <- den + C[, j] * N[j] }` (vectorised over draws, blocks in order). Not allowed: `%*%`, `rowSums`, `crossprod`."

### F13. MINOR. Small gaps in the wording of the rules
- 8.1, empty set: "If `n_skipped > 500` or `n = 0`, `lo` and `hi` are blank" does not say what `n_valid` and `n_skipped` are when `n = 0` (computed: 0 and 10000; or blank, as 13.1's "counts 0, other values blank" suggests). Replacement: "When `n = 0`: `mae_app`, `mae_other`, `mean_d`, `lo`, `hi` blank, `n_valid` 0, `n_skipped` 10000, `label` `unclear`." (No group of the ten is empty on these files.)
- 14: the result letter of M rows is not stated. Replacement: "M rows have result `I` (M05 see F9)."
- 11, B10: "mean error" in plan 3.4 item 7 is read as MAE without saying so. Replacement in 11: "'Mean error' of the plan is read as the mean absolute error `mae`. Read as the signed bias, 'not above' would reward reading low, the dangerous side, which cannot be what a construction check means."
- 5, `direction`: decided by counts only, while the row also shows mean and median. Replacement: rename the column `direction_by_count` and add: "the direction counts hours, not sizes; read it with `mean` and `median`."
- 9.1, "Source:" names code files the analysts must not read (0.1). Replacement: "(Sources, for the record only; the analysts do not read them.)"
- 3.2: say that `start_key`, `peak_key`, `a`, `b` of `units.csv` are hour keys `K` of 2.1. The reviewer's counts confirm they are.
- 8, `Y1`: after a gap the held reading can be up to 48 hours old (`age_lf_h` is above 1 on about 1,600 estimate hours of the base set; tool audit: 1,588 over the whole run), and `Row(3)` can hold the same stale reading, so the "3 hours" are not 3 hours of readings. Add: "The rule is applied as written also after a gap; it is a known limit."

### F14. MINOR. The compare contract does not say which columns are decimals
Quoted (15.4): "every integer and text column equal as text; every `%.6f` column within 0.01".
Evidence: the tool needs a column type map. 13.1 lists the integer columns by name pattern and leaves text columns implicit. The format guard "every numeric cell is empty or matches ..." would flag `checks.csv` `expected` and `got` (`130987:130987`, sha strings, `NEW<=OLD`). No exit status is stated (the cap contract has "exit status 0 only for AGREE").
Replacement text (15, new point 2a): "Column types. Text: `period, group, run, truth, comparison, label, label_central, label_long, label_short, reading, direction, metric, source, scope, condition, id, description, expected, got, result`. Integer: as 13.1. Decimal (`%.6f`): every other column. The format guard applies to integer and decimal columns only, and in `learning_health.csv` to `value` by its own regex. Exit status 0 only for AGREE." Also state that `checks.csv` is compared as text first, so its mixed `expected`/`got` cells need no typing.

### F15. MINOR. Open point 22 can be closed
Quoted: "burn-in hours were not tried. B05 could not be tried".
Evidence: the reviewer ran B05 and B06 on every estimate hour of both files, burn-in included: 0 violations in `tauTs`, `valHourTs`, presence of a truth and value (1e-6 relative), and B08 0 in both. Replacement: "Checked by the reviewer on both runs including burn-in: 0 violations."

## Plan fidelity (task 1)

| Plan item | In the specification | Remark |
|---|---|---|
| 3.2 own truths | 1.2, 7.1, B05, B06, B08 | right |
| 3.2 three common truths at exact times, values placed as the tool places them | 4 | right; untested (F6) |
| 3.3 all hours 60,120 | 3.2 #1 | right |
| 3.3 LF rising (about 4,500) | #2, 4,514 | right (open point 3) |
| 3.3 limbs 2,975 / 4,488 | #3, #4 | right |
| 3.3 low water (about 16,100) | #5, 16,140 | right (open point 2) |
| 3.3 high water 7,271 / 4,480 | #6, #7 | right |
| 3.3 large-rise limbs 452 split by creek share | #8 to #10 | right (open point 7) |
| 3.3 design years beside | `period` column | right |
| 3.4.1 movement | 5 | right; `direction` wording (F13) |
| 3.4.2 badly low on LF rising, both runs, three common truths, in front | 6 | numbers right; "in front" not enforced (F7); built-in lean not stated (F4) |
| 3.4.3 two-by-two, per group, by construction | 7.1 | right |
| 3.4.4 cap and yardsticks inside NEW, "same on all three" | 8 | Y1 truth-dependent (F5); cap label misleads (F3) |
| 3.4.5 self-report under own scoring | 9 | right (open point 15) |
| 3.4.6 health; "a failure here stops the step" | 10 | measures present; stop rule MISSING (F2) |
| 3.4.7 checks by construction | 11, B10 | right; "mean error" reading unstated (F13) |
| 3.5 "what it cannot show" | absent | F7 |
| 12 F1 staircase leads | preamble | stated; not enforced (F7) |
| 12 F2 paired own-truth hours | 7.1 step 3 | right |

Additions beyond the plan:

| Addition | Judgment |
|---|---|
| `common_truth_errors.csv` (120 rows) | needed for item 7; backed by PLAN_AUDIT F1(c), accepted. Keep, with Known property 2 (F4) |
| `NEW_minus_OLD` row in item 2 | harmless; keep, under F4's text |
| `groups.csv`, `row_accounting.csv`, the U, S, G, B, I, M checks | needed |
| `rl_large_shareunk` group | harmless (0 hours) |
| intervals and readings for the design period | harmless |
| `slots_stored`, `slot_blocked_hours`, `pending_at_end` in health | harmless; needed if F2 is taken |
| `n_capped_lf_rising` and its share | harmless |
| `validations_per_day` next to `learned_per_day` | harmless |
| `n_up`, `n_down`, `n_same` | needed for the direction |

Nothing should be removed.

## Rulings on the open points (task 3)

- **0.** Agreed. Plan 3.2 and plan 12 put the common truths at exact times. Add F6 so that this is tested.
- **1.** Agreed (60,120 reproduces; 59,746 + 374 in OLD).
- **2. Low water.** The specification's reading stands: `lfCap < 3000` and outside every window `[a, b]` of all 225 units, LF-rising hours not taken out. Evidence: the plan's "about 16,100" matches 16,140 (with the rising hours taken out it would be 15,497), and plan 3.3 does not say to take them out. Note for the orchestrator: ruling F4 says "Accepted" while F4's text asked to take them out. The plan text and its number decide, but the orchestrator should record that this part of F4 was not taken. The overlap is 643 test hours, and they enter B10c. The reviewer did not recompute B10c without them; with them it passes by 0.38 points.
- **3. Little Falls rising.** Backward, as written: `L >= 1.10 * lfCap(Row(6))`. The plan text, which the owner confirmed, is backward ("at least 10% above the one 6 hours earlier"). The audit's forward count is also 4,514 because the forward set on hour t is the backward set on hour t+6: the same pairs moved six hours, not a coincidence. The backward group is six hours later in each rise. `lfCap` is blank on every row without an estimate (0 exceptions), so "Row(6) exists and lfCap non-blank" means Row(6) is an estimate hour.
- **4, 5.** Agreed (exact).
- **6. Hard flags.** Changed (F8). Common truths: an hour hard-flagged in EITHER run is left out of every common truth, for both runs alike. Reasons: checks 2 and 3 flag a Little Falls reading that is physically suspect (stage against discharge, ice). It sits within an hour of the common truth, so the common truth is suspect too. The app never scores such a pair. The two-by-two set already uses "either". The effect is small (233 and 250 of 59,708). Two-by-two: as written ("either"). Learning track: `learned` rows only, which leaves out the hard-skipped rows the way the app's accuracy does. Right.
- **7. Creek share.** `share_lower > 0.15` is right. In the clock study the 15% cut (section 6, "heavy if share > 0.15") is applied to the share of each version's own leg. The primary version that fixed the clock, `LOW_P` (Edwards Ferry to Little Falls), uses the lower leg. "The clock study's creek share" for the leg of this clock is therefore `share_lower`, and the cut applies to that column on the written six-decimal value. Recounted: test 5 creek-fed (28, 30, 34, 39, 53; 159 hours) and 8 not (293 hours); design 5 and 3 (167, 108). `share_whole` would make 11 of 13 test rises creek-fed (all but 41 and 48). Rise 34 sits at 0.155605, which is not a knife edge at 1e-9. Limit, for the report: the lower leg includes Seneca and Broad Run, which join above Great Falls and which the model gauges, so "creek-fed" here is not the same as "fed below Great Falls".
- **8.** Agreed; see F13 for the label.
- **9, 10.** Agreed.
- **11.** Agreed, with F4.
- **12. Yardstick with the trend.** Changed (F5): `Y1 = floor(L + max(0.0, ((L - L3) / 3.0) * (clock + a)) + 0.5)`, with `clock` the NEW clock of section 4 on all three truths and `a = age_lf_h`. The age term is right: it carries the trend from the time of the reading to the hour of the estimate, then over the clock to Little Falls. This matches "Little Falls now plus its rise of the last 3 hours carried over the clock", where "the clock" is plan section 2's term, the NEW clock. It also matches clock study audit F10's `T + age_lf_h` with `T` = the clock. The 3 hours fixed at 3.0: agreed. `Y0 = floor(L + 0.5)`: agreed.
- **13. "Holds".** The rule (all three labels equal and not `unclear`) is a fair reading of the plan, but it is not neutral in effect: see F3 and the short-end lean. Keep the rule and add the stated property of F3 (c).
- **14.** Agreed. Small groups do give wide intervals (test `rl_large_creekfed`: 68 draws skipped; design `rl_large_notcreek`: 51).
- **15. Self-report rows.** Agreed: the `learned` rows of the learning track, scored with `predictedCFS` (the app scores `predictedCFS`, the rounded, capped, corrected value: `scheduled-update.js:1243, 1247`) against the rebuilt truth at the row's own `tauTs`. This is the set the app's accuracy counts (hard-flagged pairs left out; soft-flagged and retried pairs in). The Little Falls notice also takes hard-flagged pairs (`scheduled-update.js:1993`). Including them moves the 15%-low share by at most 0.01 points in the reviewer's numbers. The open point's sentence already says this. The band rule of 9.1 matches `shared/ci-table.js` `bandFor`, and the table matches value for value. The bin is the raw unclipped bin (`applyGFCorrection` on `rawFinalUnclipped`).
- **16. Correction change.** Agreed: `jump = (100.0 * abs(corrUsed(t) - corrUsed(t-1))) / rawUnc(t)`. It departs from PLAN_AUDIT F6, which divided `correctionApplied` by `predictedCFS`, and the specification should say so. Reason to keep it: `rawUnc` is identical in both runs (B03), so the jump differs between the runs only because the correction differs. Dividing by `predictedCFS` would mix in each run's own capped output. `corrUsed` (unrounded) avoids the rounding steps of `correctionApplied`.
- **17 to 21, 23, 24, 27.** Agreed; all counts reproduce.
- **22.** Closed (F15).
- **25.** See F12.
- **26.** See F14.

## Recounts (task 4), from the rule text alone

| Group | design (spec) | design (reviewer) | test (spec) | test (reviewer) | plan |
|---|---|---|---|---|---|
| all | 60,663 | 60,663 | 60,120 | 60,120 | 60,120 |
| lf_rising | 4,428 | 4,428 | 4,514 | 4,514 | about 4,500 |
| rl_rises | 2,220 | 2,220 | 2,975 | 2,975 | 2,975 |
| rl_rises_bump | 3,256 | 3,256 | 4,488 | 4,488 | 4,488 |
| low_water | 10,381 | 10,381 | 16,140 | 16,140 | about 16,100 |
| high_12_20 | 10,858 | 10,858 | 7,271 | 7,271 | 7,271 |
| high_20plus | 11,643 | 11,643 | 4,480 | 4,480 | 4,480 |
| rl_large | 275 | 275 | 452 | 452 | 452 |
| rl_large_creekfed | 167 | 167 | 159 | 159 | |
| rl_large_notcreek | 108 | 108 | 293 | 293 | |
| rl_large_shareunk | 0 | 0 | 0 | 0 | |
| selected rises (creek / not) | 8 (5/3) | 8 (5/3) | 13 (5/8) | 13 (5/8) | 13 |

Other: estimate hours 129,534 in each file, same hours (B02 0); limb overlap (G24) 0; unit kinds 53/33/86/53; `lfCap` blank on all non-estimate rows; low water without LF-rising hours 15,497; forward LF rising 4,514. Every count reproduces.

Checks recomputed on the data: S01 to S12 all match; B01 0, B02 0, B03 0, B04 0, B05 0, B06 0, B07 0, B08 0 (both runs), I03 0, M05 0 (both). B10: see the numbers section (passes).

## Unit tests (task 5)

All 18 recomputed in Python; U01, U02, U03 (integer floor division), U07 and U11 also in R. All correct:

| Test | Reviewer's value | OK |
|---|---|---|
| U01 | 1, 2, 3, 0, -1, 8, 9 | yes |
| U02 | 438288, 376200, 438287, 498407, 0 | yes |
| U03 | 1325376000000; 1800000; 1370065740000 (both forms); 1590987600000; key 398556 | yes |
| U04 | 250.97500000000002, 9750.025; 1.5, 10.5; medians 6 and 2.5 | yes (1e-9) |
| U05 | `-0.000000` normalised to `0.000000` | yes |
| U06 | 1250, 1000, 1500, 1000, 2000, 4000, missing; 1250.0001388888888; range cases | yes |
| U07 | 0, 84, 0, 82, 3; first cell 343638232196 gives 29 and 28 | yes |
| U08 | periods and month indexes 0, 84, 0, 82 | yes |
| U09 | -15.0, 15.0, -15.0 exact; 14.899999999999999 | yes |
| U10 | 1800/2500 capped; 1800 not capped; 1800/1801 capped; 1701 | yes |
| U11 | 5.676885120152289 (1000, 1400), 4.205951632159436, 3.440066128281308, 2.6188552085600927, 1.9936833617872496 (20000, 50000); 5.173320507556106; 1.2617854896478307 (same digits in R at 17 significant) | yes |
| U12 | 1591002720000; Tv 1591005600000, tau 1591004940000; 1591002000000 and 1591001340000; 1590991200000 | yes |
| U13 | 3465/4676; 50/571; 0/371; 53571/64099; 7494/8628 | yes |
| U14 | 1150; 1000; 1000; 1000; 1001 | yes |
| U15 | -5.0 exact; 4.9 | yes |
| U16, U17 | as stated | yes |
| U18 | 6, 6; 0.4, 0.4 | yes |

Gap: no unit test covers the common-truth time on real data (F6).

## Own-truth checks and the parsing risk (task 6)

| Run | h column | estimate hours | `tauTs` wrong | `valHourTs` wrong | presence wrong | value off > 1e-6 rel | B08 | closest due time to a whole hour |
|---|---|---|---|---|---|---|---|---|
| OLD | `travelGFtoLF` | 129,534 | 0 | 0 | 0 | 0 | 0 | 32.3 ms |
| NEW | `clockHrs` | 129,534 | 0 | 0 | 0 | 0 | 0 | 53.4 ms |

No due time falls exactly on a whole hour in either run. R (`as.numeric`, `ceiling`) and Python (`float`, `math.ceil`) give the same validation hour on all 129,534 rows of each run (`knife.py`, `knife.R`). A one-unit change in `h` moves `dueMs` by under 0.001 ms, while the closest distance to an hour boundary is 32 ms. The risk the writer raised is real in principle and absent on these files. F9 turns it into a stopping guard with a stated millisecond tolerance, so that a future input cannot hit it silently.

## Construction checks (task 7)

With exact-time common truths, B10 is no longer guaranteed in the strict sense, because NEW's own truth is up to 0.82 hours away from the central truth. It is still strongly expected. The reviewer's run passes all three test checks and the three design information rows (numbers below), so no analyst would be stopped. The smallest margin is design `lf_rising`, 0.057 points, which is information only. The test margins are 0.26 to 0.38 points.

## Feasibility (task 10)

Python: the two shadow files load in about 3 s with the `csv` module, and the bootstrap of the full item 4 table (plus one variant) ran in a few minutes in plain Python. R: `read.csv` with `colClasses` "NULL" for the unused columns works on the 110 MB files (tested). `count.fields` is fine. `sprintf("%.6f")` and Python `"%.6f"` are both correctly rounded on macOS. No string sort is needed anywhere. Number sorts have no NaN. `%/%` on doubles is exact for the boot index. `pow` agrees at the five test flows. The open issues are R integer overflow and number keys turned into text (F11), and the `sum()` caveat and loop speed (F12).

---

## Numbers seen by the reviewer (not findings of the analysis)

Computed only where a check needed them. Not for the specification; not reviewed by a second person; not a result of step 1. Hard flags NOT applied to the common truths here (the specification's current rule).

**B10 (central common truth, MAE in points, written `%.6f`).** Test: all NEW 4.907027 vs OLD 5.183242; lf_rising 10.776853 vs 11.038402; low_water 6.212876 vs 6.596140. Design: 4.023260 vs 4.231298; 8.987550 vs 9.044626; 4.913691 vs 5.234072. All `NEW<=OLD`.

**Item 2 (badly low on `lf_rising`, share of valid hours, test).** Central: OLD 21.348566, NEW 20.542115 (n 4,464). Long: 22.319035, 21.514745 (4,476). Short: 19.194631, 17.404922 (4,470). Design: central 15.514905 / 15.627823; long 16.576332 / 17.005420; short 12.443541 / 12.533875.

**Movement (test, counts down / up / same).** all 22,614 / 35,128 / 2,378; lf_rising 2,047 / 1,794 / 673; rl_large 134 / 93 / 225; low_water 6,700 / 8,953 / 487.

**Inside NEW, labels on the three truths (central, long, short), test** (spec's Y1 rule; "Y1c" = F5's rule):
- cap: `good_job` x3 in every group, both periods, except design `rl_large_notcreek` (`unclear` x3).
- Y0: all `yardstick_beats` x3; lf_rising mixed (yb, unclear, yb); high_20plus mixed (app, app, yb); rl_large and its two halves mixed (unclear, unclear, yb).
- Y1: all yb x3; lf_rising mixed (unclear, app_beats, yb), Y1c mixed (unclear, app_beats, unclear); rl_large_creekfed Y1 mixed (yb, unclear, yb), Y1c yb x3.
- Capped hours, NEW, test, central / long / short: all 2,247 / 2,248 / 2,245 capped, cap farther from the truth on 216 / 318 / 33; badly low with cap 158 / 217 / 24, without 33 / 57 / 6. lf_rising: 691 capped, cap farther 117 / 168 / 17, badly low with cap 80 / 108 / 16, without 11 / 21 / 5.

**Health (block 3).** Test: capped share OLD 4.345, NEW 3.837; jump p95 OLD 3.5996, NEW 3.8418; p99 9.6768, 11.1161; jumps >= 5%: 2,043, 2,195. (With the F6 denominator `predictedCFS`: p99 10.7751, 12.4376; 2,276, 2,412.) Counts files: slots 23,764 / 38,046; missed 76 / 133; retries 222 / 396; hard-skipped 37 / 65; clamped 419 / 628; pending at end 0 / 0.

**Self-report (learning track, learned rows).** Test: OLD 9,809 joined, 15% low 3.364, in band 84.840; NEW 16,346, 2.998, 86.223. Design: OLD 12,231, 2.526, 84.605; NEW 18,925, 2.320, 85.295. Unjoined 0 in all four. With hard-skipped rows included the 15% low share moves by at most 0.01 points.

**Hard flags among central-valid test hours.** OLD flag 233, NEW flag 250.

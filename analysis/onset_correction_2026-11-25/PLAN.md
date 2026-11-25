# Onset study (TODO D20): does a gradual hand-over from the steady to the rising correction help at small rises?

Plan version 2, 2026-11-25. It replaces `PLAN_v1.md` (kept) after the independent audit in `PLAN_AUDIT.md`. The rulings on the audit are in section 16.

Started on the owner's word of 2026-11-25 ("study the onset"). **No analysis code is written before the owner confirms this method.** Owner's confirmation: given on 2026-11-25, after the short version of this plan with its weaknesses, the method, the pass conditions and the thresholds (pass at 0.25 points, fail under 0.10) was put to him. He quoted the recommendation "run it once" and wrote "do it". The method and the thresholds stand as written here.

## 0. What the owner should know first

- **The best case is small.** A full pass moves the app's headline error by about 0.04 points. The gain would sit in rising hours with a small rise, about 14% of all hours.
- **A pass does not lead to a build.** It leads to a check on the app's own log over the coming months (section 10).
- **The chance of a clean pass is about one in four** (section 14). Three earlier changes in this area failed.
- **The value of the study** is a clean answer to a question that has come up three times, and input for the eel-season check of 2026-12-16 (TODO D23).

## 1. The question

The Great Falls estimate is corrected with one of 18 learned values: 6 flow ranges × 3 states (rising, steady, falling). The state is decided by one comparison of the Point of Rocks flow now with an earlier reading. When the difference reaches the threshold, the estimate switches from the steady value to the rising value in one step.

Question 1 (description): in the hours called "rising" where the rise is small, is the shown estimate off in a systematic direction, and would the steady value have been closer? The question is two-sided: the rising value is not always the larger one (section 2, point 9).

Question 2 (test): does a gradual hand-over from the steady value to the rising value, by the size of the rise, lower the error of the shown estimate, without harm elsewhere, and is the gain tied to the size of the rise or would any blend of the two values do the same?

This study changes nothing in the app.

## 2. What is known

Read on 2026-11-25. "Code" means read in the source, "document" means read in a report, "audit" means computed by the plan auditor from the existing replay output (counts only, no error of any candidate rule).

1. **The state rule on the server** (code, `netlify/functions/shared/model.js:466-493`): `change = current − past reading`; `threshold = max(100 cfs, 2% of current)`; `|change| >= threshold` gives rising or falling, otherwise steady. The past reading is the last one at or before six hours ago. No memory of the previous state. **The browser does not use this function for its state**: it takes the state from its own rise-rate function (`src/estimation/great-falls.js:176-216`, `:464`), with a span of 3 to 9 hours, and falls back to the Weather Service trend when it has no history.
2. **The correction is a number in cfs**, the running average (alpha 0.3) of `raw estimate − Little Falls`. It is applied as `raw − correction`; the result is capped at 120% of the latest Little Falls reading and rounded (code, `model.js:705-721`, `scheduled-update.js:1104`).
3. **The state that picks the correction and the state that picks the cell to learn into are the same stored value** (code, `scheduled-update.js:1055`, `:1249`, `:1359`).
4. **Learning never reads what was applied** (code, `scheduled-update.js:1242-1245`, `:1329`; audit, question 9: no path found in production or in the replay tool, including the hybrid mode, the pending slot, the anomaly gates, the advisories and the cap).
5. **Smoothing across flow ranges exists** (v37.0: a band from B/1.12 to 1.12 × B around B = 3,000, 6,000 and 12,000 cfs; 25,000 and 50,000 stay steps). **Smoothing across states does not exist.** A cell with fewer than 5 observations falls back to an average over the states of its flow range.
6. **The finding behind D20** (document, `analysis/replay_lag_2026-11-17/replay_lag_FINAL.md`, `replay_lag_audit.md`): two replays over 2011 to 2026 whose upstream readings differ in age. They also learned their own cells separately, and their state rules span different lengths of time. In 2,987 hour pairs where the fresher version says rising and the other steady, the fresher one has an absolute error 1.83 points higher (interval 1.45 to 2.25); the rising value takes off 6.86% of the raw estimate, the steady value 5.24%. The loss sits where the upstream change since the time-shifted reading is slow.
7. **Limits of that finding** (same documents): a subset of a subset; the study's overall verdict passed by 0.01 point and read "inconclusive" in each half of the record alone; the scripts of the split are not kept; the remark that another onset rule "would probably erase or reverse the loss" is marked untested.
8. **The corrections today** (the app's endpoint, 2026-11-25; not checked by the auditor): 0 to 3,000 cfs rising +311, steady +337, falling +346. 3,000 to 6,000 cfs: +182, +28, −249. 25,000 to 50,000 cfs: +3,273, +2,336, +1,303.
9. **The rising value is not always the larger one** (audit): in the test years, using the steady value instead of the rising value raises the shown number in only 58% of rising hours below 25,000 cfs. At 0 to 3,000 cfs the steady value is usually the larger one.
10. **Each cell is a noisy number** (audit): with alpha 0.3 a cell carries about as much information as a mean of 6 observations. In the earlier replay the same cell stood at +571 in one arm and −602 in the other.
11. **In the replay, the state rule's "six-hour" change spans about four hours** (audit): in arm L the newest reading is two hours old and the past reading six, on 98.5% of hours. Production's span is about 4.9 hours, arm F's is 5 hours.
12. **How many hours** (audit): test years, 8,148 scored rising hours below 25,000 cfs (design years 7,052); 30.5% have a change between 1 and 1.5 times the threshold, 49% below 2 times. Hours whose shown value a candidate changes, test years, for m = 1.5 / 2 / 3 / 5: 3,386 / 4,514 / 5,733 / 6,643, in all 83 months. At m = 2 the value falls on 1,781 of the 4,514.

## 3. What was tried before, and what this study does not repeat

| Earlier work | What it tested | Result | Consequence here |
|---|---|---|---|
| State window, v35.0, 2026-05-06 | The look-back of the state rule, 2 h to 6 h | Shipped | The state rule has been changed once before; the threshold has not |
| Flow-state floor gate, 2026-06-18 (`analysis/flow-state-floor-gate-findings-2026-06-18.md`) | A lower threshold between 2,700 and 4,700 cfs: MORE hours called rising or falling | Rejected. Hours near the threshold are the noisiest; moving them into the rising cell made it worse | This study gives hours near the threshold LESS of the rising value and moves no hour into another cell |
| C45 phase 2, 2026-06-23 (TODO.md) | Smoothing across states | Not pursued, by argument, never tested. Re-open only "with a concrete blend design that provably preserves the high-flow signal; gate it with `analysis/c45_gate.mjs`" | The rule here is concrete and leaves every hour at 25,000 cfs and above untouched. It is tested with the later replay tool instead of `c45_gate.mjs`, because that tool has today's anomaly rules, an estimate for every hour and a byte-exact regression target |
| A7, 2026-11-11 and A6, 2026-11-12 | Travel time on a rising river; learning every hour | Both failed on the SHOWN value. The verdicts infer, without a test, that the 120% cap governs the number on a rising river | Every figure here is on the shown value, after the cap. Hours where a rule LOWERS the shown value on a rising river are guarded separately |
| TODO D23 (eel-season daily wave), parked | In 12 days of November 2026 the state changed about 3 times a day | No change; check from 2026-12-16 | All results are also given for 15 Sep to 15 Dec and for the rest of the year |

Not tested anywhere so far: fewer or later "rising" calls, a memory in the state rule, a blend of two state corrections.

## 4. Design in short

1. Two replays of the real model, unchanged, with extra columns: for every hour the correction each of the three states would give, unrounded, and what the state rule saw.
2. Because learning never reads what is applied, every hand-over rule is computed afterwards from these files. The learned values are the same under all rules.
3. The record is split. The design years are used to describe the problem and to pick one rule from a list frozen now. The test years are used once.
4. Two control rules that blend without looking at the size of the rise show whether a gain is an onset effect or plain averaging of two noisy numbers.
5. Everything is computed twice, blind, in Python and in R, and checked by a third auditor.

The study is "application only". A change of the state rule itself is not part of it (section 13).

## 5. Data and the replay

- **Input:** `analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv`, 130,416 hourly rows, 2011-12-01 to 2026-11-09 23:00 UTC. Values from 2026-10-08 on are as first published, before the USGS revision of 2026-11-13.
- **Tool:** a copy of `analysis/replay_lag_2026-11-17/ci_backtest_harness_lag.mjs` in this folder. It imports the production code and carries no copy of the rules. The copy adds columns and changes nothing else. It must be run with `--in=` set to the v39 file (the default is the older file).
- **Runs:** `--gate=new --mode=hybrid`, once with `--arm=L` (main run) and once with `--arm=F` (timing check).
  - Arm L: upstream readings about 97.5 minutes old; the state rule's change spans about 4 hours.
  - Arm F: readings one hour fresher; the span is 5 hours, close to production's 4.9.
  - Production lies between the two: its readings are about 66 minutes old at the top of the hour.
- **Added columns per hour:**
  - `rawUnc`: the raw estimate before rounding (`trace.rawUnc`); `corrUsed`: the correction the model applied, before rounding (`trace.corr`); `flowBin` as the model set it.
  - `corrR`, `corrS`, `corrF`: `getGFCorrectionInterpolated(bins, rawUnc, state)` for the three states, with the cells as they stand at that hour, unrounded.
  - `d6`: Point of Rocks flow now minus the past reading the state rule used; `thr6`: `max(100, 0.02 × flow now)`; `p6Ts`, `p6Cfs`: time and value of that past reading; `span_h`: hours between the two readings; a marker when the rule had too little history.
  - `lfCap`: the Little Falls reading used for the cap.
  - `ageR_h`, `ageS_h`: hours since the rising and the steady cell of this hour's flow range last learned.
- **Checks in the tool, on every predicted row; one failing row stops the study:**
  - (a) the state rebuilt from `d6` and `thr6` equals the model's state, and `p6Ts`, `p6Cfs` equal the reading found by a second, independent lookup in the history;
  - (b) the correction of the model's state among `corrR`, `corrS`, `corrF` equals `corrUsed` exactly;
  - (c) `floor(min(rawUnc − corrUsed, 1.2 × lfCap) + 0.5)` equals the model's shown value (without the cap when `lfCap` is not above 0).
- **Regression:** with the added columns removed, the arm L output equals `analysis/forecast_from_measured_water_2026-11-24/replay_B/shadow_L.csv` byte for byte, and the learning files are identical. For arm F the same comparison is made on the older input against the original tool's arm F output (regenerated with the original tool if the file is not on disk).
- **Scored hours:** the rules of `analysis/replay_lag_2026-11-17/ANALYSIS_SPEC.md`, section 1, for one arm: status "predicted", no hard flag that depends on the truth, truth inside the valid range, no blank error. Truth is the Little Falls flow one travel time after the estimate.
- **Burn-in:** hours before 2012-12-01 are not scored.
- **Design years:** 2012-12-01 to 2019-12-31. **Test years:** 2020-01-01 to 2026-11-09. The cells learn in time order and are never reset, so the test years use cells that learned through the design years; that is how the app works too.

## 6. The rules, frozen now

No rule is added or reshaped after any table of this study has been seen.

**Where a rule applies:** an hour whose state is rising and whose `flowBin` is below 25,000 cfs. All other hours are as in production under every rule.

```
r          = d6 / thr6                    (r >= 1 on every rising hour)
correction = (1 − w) × corrS + w × corrR   (unrounded)
shown      = floor( min( rawUnc − correction, 1.2 × lfCap ) + 0.5 )
error      = (shown − truth) / truth × 100
```

| Rule | w | Role |
|---|---|---|
| Production | 1 | Baseline. Defined by itself, not as a limit of the hand-over |
| Hand-over, m = 1.5, 2, 3, 5 | `min(1, (r − 1) / (m − 1))`; 0 when r = 1 | Candidates. One is picked in the design years |
| Half and half | 0.5 on every hour | Control: a blend that ignores the size of the rise |
| Mean of three | correction = `(corrR + corrS + corrF) / 3` | Control, reported only |
| Steady always | 0 | Reported only |
| Both sides | the picked m, also on falling hours with `corrF` and `|d6|` | Reported only, for the eel-season question |

Why below 25,000 cfs only: the differences between states at high flow were judged real (C45), and smoothing at 25,000 and 50,000 cfs made things worse in the earlier test. Side effect: for small rises the correction steps at 25,000 cfs. In the test years 148 rising hours at 25,000 cfs and above are small rises that keep the full rising value; the report gives the size of that step.

## 7. Step A, design years, main run only

**A1. Description.** Rising hours below 25,000 cfs, grouped by `r`: 1 to 1.5, 1.5 to 2, 2 to 3, 3 to 5, 5 to 10, above 10. For each group: number of hours; mean signed error and mean absolute error of the rounded raw estimate, of the shown estimate with the rising value (production), and of the shown estimate with the steady value. The same table:
- split by which value is larger (`corrR > corrS`, or not);
- by flow range (four ranges below 25,000 cfs);
- by hours since the rising spell began (1, 2, 3, 4 to 6, 7 to 12, more than 12);
- by `ageR_h` (under 1 day, 1 to 7 days, 7 to 30 days, more than 30 days).

**A2. Picking one rule.** `m*` is the candidate with the lowest mean absolute error of the shown estimate over all rising hours below 25,000 cfs in the design years. If the best two are within 0.02 points, the smaller `m`. If no candidate is better than production in the design years, the verdict is NOT SUPPORTED and step B is reported as description only.

## 8. Step B, test years, used once

Compared: the rule with `m*` against production, on the shown value.

- **Main population R:** scored rising hours below 25,000 cfs. It is the same for every `m`.
- **Per hour:** `d = |error of the rule| − |error of production|`, in points. Negative is better.
- **Measures on R:** mean `d`; mean absolute and mean signed error of each rule; the share of hours shown 15% or more below the truth, and 15% or more above. Also reported: mean `d` on the affected hours (the two shown values differ) with the mean size of the change, and mean `d` over all scored hours.
- **Uncertainty:** bootstrap over calendar months, 10,000 draws, 95% interval, one shared file of random numbers. Reported as well, not judged: the same with calendar quarters as blocks.
- **Splits:** the two halves of the test years (2020-01 to 2023-05, 2023-06 to 2026-11); 15 Sep to 15 Dec against the rest; the four rising cells; raised hours against lowered hours (does the rule raise or lower the shown value); with and without the hours from 2026-10-08.
- **Controls:** the rule against "half and half" on R, with its interval.
- **Timing check:** the arm F run, same `m*`, mean `d` on that run's R.
- **Also reported, not judged:** every candidate and every control in the test years.

## 9. The decision rule, fixed before any number is seen

All on the test years. PASS needs all eight:

1. **Size:** mean `d` on R is −0.25 points or better, and the whole 95% interval is below 0. (At m = 2 this is about −0.5 on the affected hours and about −0.04 over all hours.)
2. **No harm by cell:** no rising cell below 25,000 cfs has a mean absolute error more than 2% (relative) above production's with an interval of `d` wholly above 0. A cell above the 2% margin whose interval covers 0 does not fail the rule but makes the verdict UNCLEAR.
3. **Stable in time:** mean `d` on R is below 0 in each half of the test years.
4. **Stable by season:** mean `d` on R is not above 0 in the eel season, nor in the rest of the year.
5. **Lowered hours:** on the affected hours where the rule lowers the shown value, mean `d` is not above 0, and the share shown 15% or more below the truth is not higher than production's.
6. **Large errors:** on R, the share shown 15% or more below the truth is not higher than production's, and the share 15% or more above is not higher by more than 0.5 percentage points.
7. **Tied to the size of the rise:** on R, the rule's absolute error is lower than "half and half", with the whole interval of the difference below 0.
8. **Robust to timing:** in the arm F run, mean `d` on R is below 0.

Verdicts:
- **PASS:** all eight.
- **GAIN WITHOUT ONSET:** 1 to 6 and 8 hold, 7 does not. Blending helps, but not because of the size of the rise.
- **FAIL:** on R the interval of mean `d` includes 0, or mean `d` is above −0.10.
- **NOT SUPPORTED:** no candidate beats production in the design years.
- **UNCLEAR:** everything else.

Tool check, not evidence: every hour at 25,000 cfs or above has the same shown value under every rule.

The −0.25 and −0.10 points are the orchestrator's proposal. The owner may set other values before the run, not after.

## 10. What follows a verdict

- **PASS:** not a build. The hypothesis was formed on the same record that holds the test years, and the replay's time span differs from production's. So a pass leads to a check on the app's own log: rises after 2026-11-25, from `tick_log`, `validation_log` and `bin_snapshot`, with `m*` and the criteria frozen now, under its own short plan. Only after that a build could be proposed. It would be a MAJOR version, on the server and in the browser, with no reset of the corrections; the browser's own state path would need separate work.
- **GAIN WITHOUT ONSET:** the question becomes a general blend of state corrections (C45 phase 2). The owner decides whether that is worth a plan. Nothing is built from this study.
- **FAIL or NOT SUPPORTED:** D20 is closed as tested.
- **UNCLEAR:** the owner decides.

## 11. Verification

1. **Tool audit** by a fresh auditor: the regressions of section 5, the three row checks, a reading of the added lines.
2. **Specification** written from this plan by one agent, reviewed by another, before any analyst starts. It prescribes the rounding `floor(x + 0.5)`, the tie rule, and the exact population rules.
3. **Two blind analysts**, Python (`python3 -I`, standard library only) and R (base only). They see the specification and the data, not each other, and not this plan's expectations. Every number agrees within 0.01; the aim is identical output files.
4. **Third auditor**, who ran none of it: agreement of the two, the method against this plan, the row accounting, an own recomputation of the headline numbers, at least five readings checked against the USGS public service.
5. If the two analysts differ: stop and find the cause.

## 12. What this study cannot show

- The replay runs on hourly values and never resets the cells. Production reads every 15 minutes and had resets.
- The state rule's span is about 4 hours in the main run and about 4.9 hours in production. A given rise gives a ratio `r` about one fifth smaller in the replay, so `m*` does not carry over one to one. The arm F run and the later check on the app's own log are there for this.
- The browser decides its state by another route, with no `d6` in its fallback. That path is untested here.
- The truth is the Little Falls flow, as in every accuracy figure of this app.
- The form of the rule came from the D20 finding, which used the whole record. The split protects the choice of `m`, not the choice of the form.
- A cell is a noisy number. Part of any gain can be plain averaging; the "half and half" control measures that part.

## 13. Not in this plan

- A change of the state rule itself (a higher threshold, a memory, a minimum duration). It changes which cell learns, needs its own replays and, in production, a reset of the corrections.
- A hand-over by rate per hour instead of `r`. One family of rules is enough for a first test, and the question of the time span is answered by the arm F run and by the check on the app's own log.
- A one-sided rule that only ever raises the shown value. The hypothesis says nothing about the sign, so the rule stays two-sided and the lowered hours are guarded (criterion 5).

## 14. Expected outcomes, written before the run

- Step A: among rising hours with `r` below 2, the steady value is closer than the rising value where the rising value is the larger one; the picture is mixed where it is the smaller one. Above 5, the rising value is better.
- `m*` is 2 or 3.
- Step B: mean `d` on R between −0.1 and −0.4 points; under 0.05 points over all hours.
- The most likely verdicts, in this order: UNCLEAR, GAIN WITHOUT ONSET, FAIL, PASS. A clean PASS has a chance of about one in four.

## 15. Roles

Orchestrator: plan, rulings, synthesis. Tool builder, specification writer and both analysts: Sonnet. Plan auditor, tool auditor, specification reviewer, third auditor: Opus.

## 16. Rulings on the audit (`PLAN_AUDIT.md`, verdict "proceed after changes")

| Finding | Severity | Ruling | Where |
|---|---|---|---|
| F1. The run needs the unrounded raw estimate; with the rounded one, check (c) fails on 21.5% of hours | Major | Accepted in full | Section 5 |
| F2. Nothing separates an onset effect from plain averaging of two noisy cells | Major | Accepted: two controls, criterion 7, the verdict GAIN WITHOUT ONSET, the table by cell age | Sections 6, 7, 9 |
| F3. The rule lowers the shown value on 39% of affected hours | Major | Accepted: tables split by which value is larger, criterion 5, question 1 made two-sided. A one-sided rule is not added (section 13) | Sections 1, 7, 8, 9 |
| F4. The replay's "six-hour" change spans four hours; the browser uses another route | Major | Accepted, and made stricter: the arm F run is a criterion (8), not only a report. A hand-over by rate is not added (section 13) | Sections 2, 5, 9, 12 |
| F5. The hypothesis came from the record that holds the test years | Major | Accepted: a pass leads to a check on the app's own log, not to a build | Section 10 |
| F6. "Production equals m going to 1" fails at exact ties | Minor | Accepted: production defined by itself; ties get w = 0 | Section 6 |
| F7. Rounding differs between JavaScript, Python and R | Minor | Accepted: `floor(x + 0.5)` prescribed | Sections 6, 11 |
| F8. The size criterion depended on `m` and was diluted | Minor | Accepted: size is judged on the fixed population R | Section 9 |
| F9. "High water untouched" is true by construction | Minor | Accepted: now a tool check; the step at 25,000 cfs is reported | Sections 6, 9 |
| F10. The cell criterion used point estimates | Minor | Accepted: intervals per cell | Section 9 |
| F11. Check (a) only checked the state | Minor | Accepted: the past reading is logged and checked by a second lookup | Section 5 |
| F12. Freeze the list of rules before A1 | Minor | Accepted | Section 6 |
| F13. Bootstrap blocks: add quarters and rise episodes | Minor | Partly accepted: quarters added as a report. Episodes not added: a rising spell lasts hours to days and nearly always sits inside one month, so months already keep spells whole, and a definition of "episode" would be one more choice to defend | Section 8 |
| F14. Nine factual corrections | Minor | Accepted, all nine | Sections 2, 3, 5 |

The auditor's strongest argument against running the study (a small best case that does not carry over as measured, and a gap between the two values that is largely noise) is stated to the owner in section 0.

## 17. Notes added after the owner's confirmation

Nothing below changes the confirmed method or its thresholds. Each note is a ruling made before any outcome was computed.

**After the tool audit (`TOOL_AUDIT.md`, verdict "tool fit for use", five minor findings), 2026-11-25:**

| Finding | Ruling |
|---|---|
| T1. `span_h`, `ageR_h`, `ageS_h` have no row check, and `lfCap` is checked only where the cap binds | No change to the tool. The auditor recomputed all four columns on every row of both arms by an independent route, with no mismatch. That audit is their evidence |
| T2. The counts files name the original tool | Noted. Provenance only |
| T3. The copy's default input path does not exist | Noted. Every run passes the input path |
| T4. After gaps in the Point of Rocks record, a few rising hours have a state span far from the usual one (arm L: 91 of 16,153 rising hours below 25,000 cfs; arm F: 251 of 18,681) | These hours stay in every population: production behaves the same way on that history, and the rule is defined on the change as the model sees it. Their number is reported, and one sensitivity without them is reported, not judged |
| T5. The age columns describe only the cells of the hour's own flow range | A note under the table by cell age |

**Section 5, regression of the timing run:** the builder compared arm F with a fresh run of the original tool on the same new input. The tool auditor also ran the comparison on the older input against the stored arm F output, as section 5 says. Both are identical.

**Section 5, rows checked:** the three row checks ran on every hour for which the model gave an estimate (129,534 in arm L, 129,549 in arm F), which includes the hours later left out for lack of a truth value.

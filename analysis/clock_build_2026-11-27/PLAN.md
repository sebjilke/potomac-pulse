# Build plan: a measured clock for scoring the Great Falls estimate

Plan version 2, 2026-11-27. Version 1 is kept as `PLAN_v1.md`. The independent audit is `PLAN_AUDIT.md` (verdict "proceed after changes": 2 blockers, 7 major and 8 minor findings). Section 9 holds the ruling on each. Nothing is built and no replay is run before the owner's confirmation (section 10).

Follows the clock study (`analysis/clock_study_2026-11-27/REPORT.md`, verdict TOO LONG) on the owner's word of 2026-11-27. Facts: `FACTS.md` in this folder and the study's `FACTS.md`.

## 0. What the owner should know first

- **A replay cannot show that the new clock is better.** Every truth on which it could be scored lies on the new clock's side of the old one (the old clock is longer on all but 109 of 59,746 test hours). An estimate that learned against a truth sits closer to it. So version 1's "conditions for SHIP" were decided in advance, in favour of the change. They are gone. The case for the change is the clock study. The replay only shows **what the change does**.
- **The direction to know:** on rising water the shown number will read **lower** than today wherever the cap is not holding it. Today's corrections learned against a later, higher river. If the true travel time is near the long end of the measured range, the new clock is about an hour early at 3,000 to 5,000 cfs and the number reads somewhat low on a rise. Reading low is the dangerous side for a paddler.
- **More than one thing moves.** The due time feeds the corrections, how often an estimate is scored, the "trust it less" note, the accuracy line, the 90% band and more (section 4).
- **So the plan is now in steps, and the owner chooses after each.** Step 1 is a description by replay, with no risk to the app. Only then: a log-only release, the change itself, or nothing.
- **It does not fix a creek-fed rise** like 26 and 27 November.

## 1. The steps

1. **Step 1, now: describe by replay what the change would do.** How far the shown number moves and in which direction, by flow and state; how the scoring, the note and the band would read; whether the learning stays healthy. No verdict. (Sections 2 and 3.)
2. **Step 2, the owner's choice on that description:**
   - **(a) A log-only release (minor version):** the hourly job stores the new due time beside the old one and scores every estimate on both clocks. Nothing is learned from the new one and nothing shown changes. After some weeks, including the next rises, the live record shows the difference.
   - **(b) The change (major version):** section 5.
   - **(c) Nothing.**

## 2. The clock, as it would be built

- `clock(Q) = 98.2 × Qc^−0.3935` hours, with `Qc` the Little Falls flow the job holds at that run (`lf.q`, never the past Point of Rocks flow), **held inside the measured range**: below 1,400 cfs `Qc = 1,400`, above 20,000 cfs `Qc = 20,000`. So the clock runs from 5.7 hours (1,400 cfs and below) through 4.2 (3,000), 3.4 (5,000), 2.6 (10,000) to 2.0 hours (20,000 cfs and above). It is 36% (the share by distance) of the study's fitted lag from Edwards Ferry to Little Falls.
- **Known cost of holding it at 5.7 hours at the low end:** the study's low-water weeks suggest 7.1 hours below 1,500 cfs. A separate low-water value would need a rule for which hours are "low water", and the last such rule misplaced 42% of hours (clock study, plan audit F1). The owner may choose it anyway (section 10).
- **No extra shortening while the river rises.** The relation was measured on rising water.
- **The two ends of the range, as functions of flow** (they bracket the study's values at every measured flow): long end `1.23 × clock(Q)`, short end `0.30 × clock(Q)`.

## 3. Step 1: the description by replay

### 3.1 The runs
- The replay tool (`analysis/onset_correction_2026-11-25/tools/replay_onset.mjs`) is copied into this folder with one new option that replaces the due time at its line 607 by `t + clock(Q)`. An independent audit of the copy: the diff; a run without the option whose shadow, learning and cell files equal the existing ones byte for byte; ten due times checked by hand.
- **OLD:** the existing main run. **NEW:** the same with the option.

### 3.2 Truths
Each run has its own truth (the Little Falls value it was scored and trained against). For comparing the two runs there are also three common truths: Little Falls at the hour of the estimate plus `clock(Q)`, plus the long end, plus the short end, rebuilt from the hourly record with the hourly values placed as the replay tool places them.

### 3.3 Hours (test years 2020-01-01 to 2026-11-09; 2012-12 to 2019 reported beside)
- all hours with an estimate (60,120);
- **Little Falls rising:** the reading the model holds is at least 10% above the one 6 hours earlier (about 4,500 hours);
- the rising limbs of the clock study's rises (2,975 hours; 4,488 with the small low-flow rises), as a second view;
- **low water:** below 3,000 cfs and outside every rise and recession window (about 16,100);
- **high water:** 12,000 to 20,000 cfs (7,271), where the clock is measured, and 20,000 cfs and above (4,480), where it is held at 2.0 hours;
- the rising limbs of the 13 large rises of the test years (452 hours), split by the clock study's creek share of each rise (above 15%: creek-fed).

### 3.4 What is reported
1. **Movement of the shown number:** NEW minus OLD in percent, per group: mean, median, the 5th and 95th percentile, the share of hours that move by 5% or more, and the direction on rising water.
2. **The owner's concern, in front:** the share of hours that read badly low (15% or more) on Little Falls rising hours, for both runs, on each of the three common truths.
3. **A two-by-two table:** each run's error on its own truth and on the other run's truth, per group. Read as description: each run looks best on its own truth by construction.
4. **Inside run NEW only** (here the three truths do protect, and a reading counts only if it is the same on all three): the cap against no cap; and the app against two yardsticks, "Great Falls equals Little Falls now" and "Little Falls now plus its rise of the last 3 hours carried over the clock".
5. **What the app would have said about itself:** scored estimates per day; the share of scored estimates 15% or more low (the line at which the "trust it less" note switches on); the share of truths that fall inside the shown 90% band; each under the run's own scoring.
6. **Health of the learning** (a failure here stops the step and is investigated): estimates that missed their scoring window, retries, estimates skipped by the data checks, values held by the outlier guard; the hour-to-hour change of the applied correction (95th and 99th percentile, and the count of jumps of 5% or more); how often the cap binds.
7. **Checks that must come out as construction says** (if not, something is broken): on the central common truth NEW's mean error is not above OLD's overall, on rising hours and at low water.

### 3.5 Verification
Tool audit; specification and review; two blind analysts (Python, R); compare tool; third auditor. No verdict is computed. The report states the description and what it cannot show.

## 4. Everything the due time feeds, with a decision for each

| What | What happens with the new clock | Decision proposed |
|---|---|---|
| The learned corrections (flow cells) | learn against an earlier reading; on rises they push the estimate up less | the purpose of the change |
| The stage cells, the Edwards Ferry relation, the internal comparison of estimators | learn at the same moment, so they move too | reported in step 1; no separate action |
| How often an estimate is scored | about twice as often | reported; watched by the health measures |
| The "trust it less" note and its notch on the confidence label | its line (15% low) was tuned on old-clock errors; it will switch on less on rises and stay live more at low water | re-checked on run NEW in step 1; re-tuned only as its own later release |
| The accuracy line and the 7-day history | new scores look better on rises; lifetime totals mix both clocks for months | owner's choice: keep the mix with a dated note, or reset the accuracy counters at release (needs a small admin action that does not exist today) |
| The 90% band | derived on the old clock; probably too wide on rises | its coverage is measured in step 1; re-derived as its own later release |
| The pending estimate at release | scored at its stored due time; blocks the new clock for at most about 17 hours | no action |
| The 48 hour forecast and its scoring | unchanged; they keep the old offsets | not in this release; the header then shows the new time while "How it works" still describes the old shift: the texts are corrected in the same release |
| The time from Point of Rocks to Great Falls inside the estimate | unchanged; it shares a variable with the old clock and must not move | pinned by a test |

## 5. The code change, if the owner chooses 2(b)

By the project's protocol for code changes (this plan and its audit, implementation, a fresh audit of the diff).
- **Server:** a new pure function and its three constants (98.2, −0.3935, the two flow limits) in `netlify/functions/shared/model.js`, the constants also in `src/model/constants.js` as the parity rule requires; the due time at `scheduled-update.js:1117`; a new field for the scoring clock on the pending row, in `tick_log` and in `validation_log`, with the log's schema number raised, so that old-clock and new-clock rows can be told apart; `SERVER_VERSION`. The existing travel functions, their constants and the field `travelTimeGFtoLF` are not touched.
- **Browser:** the same function in `src/model/shared-model.js`; the header line, the inputs panel row and the countdown in the locked section show the new clock; the texts that describe the shift.
- **Tests added:** values and limits of the function; parity of its two copies and of the constants; the exact due time with a fixed clock; a case where the lookup of the past Point of Rocks reading does not converge (the due time must not depend on it); the time from Point of Rocks to Great Falls and the whole estimate object unchanged on the existing cases; edge inputs.
- **Tests changed on purpose, each named in the release notes:** `forecast-accuracy-row`, the pinned text in `map-removed`, `PENDING_KEYS`, and `forecast-validation-timing` (its guard against "a fourth Great Falls to Little Falls number").
- **Version:** major. The learned corrections are not reset and not edited.
- **After release:** a live check by a fresh verifier of the first scored estimates, and a second check after two weeks.

For 2(a), the log-only release, only the new function, the new log fields and a second, shadow scoring are added; the due time and everything learned stay as they are.

## 6. What this plan cannot settle

- Whether the new clock is better. That rests on the clock study, whose own weak spot is the split by distance.
- The true travel time below Great Falls; high water above 20,000 cfs; low water below 1,400 cfs.
- Creek-fed rises.
- The forecast's offsets and the time from Point of Rocks to Great Falls, which rest on the same 1961 formula.
- The replay holds hourly values with readings one to two hours old.

## 7. Expected outcomes of step 1, written before the run

- The shown number moves by less than 1% on most hours. On Little Falls rising hours without the cap it reads lower by a few percent; on recessions a little higher.
- The share of badly-low readings on rising hours goes up for NEW on the long-end truth and down on the central and short-end truths.
- NEW scores about twice as many estimates per day; the hour-to-hour change of the correction grows a little.
- Inside run NEW the cap does a good job on all three truths; the yardstick with the trend beats the app on Little Falls rising hours; over all hours the app beats both yardsticks.
- Under its own scoring NEW switches the "trust it less" line on less often, and more of its truths fall inside the band.

## 8. Roles and cost

Orchestrator: plan, rulings, synthesis. Tool change, specification, both analysts: Sonnet. Tool auditor, specification reviewer, third auditor: Opus. Step 1: about seven agents, a few hours, the laptop awake. A release under step 2 has its own agents and needs the owner's explicit word.

## 9. Rulings on the audit (`PLAN_AUDIT.md`)

| Finding | Ruling | Where |
|---|---|---|
| F1 (blocker): four of six ship conditions decided by construction | **Accepted.** No ship verdict from the replay; description, a two-by-two table, health measures, and checks that must come out as construction says | 0, 1, 3.4 |
| F2 (blocker): the two ends of the range undefined for 19% of hours | **Accepted.** Both ends as functions of flow | 2 |
| F3: "one thing changes" is wrong | **Accepted.** A table of everything the due time feeds, each with a decision | 0, 4 |
| F4: "rising" by rise windows leaves out most rising hours | **Accepted.** A group built from the record; the limbs as a second view; groups defined | 3.3 |
| F5: the relation used outside its measured range | **Accepted at the top and in principle:** held inside 1,400 to 20,000 cfs. The separate low-water value is offered as the owner's choice, not built in, for the reason given in section 2 | 2, 10 |
| F6: the measure of calm passes more easily when more is scored | **Accepted.** Per-hour percentiles and a count of jumps | 3.4 |
| F7: the high-water condition mislabelled | **Accepted.** Two high-water groups; nothing judged on the old truth | 3.3 |
| F8: tests and parity rules missing | **Accepted** | 5 |
| F9: two clocks in the stored rows with no marker | **Accepted.** A field and a schema number | 5 |
| F10 to F16 (minor: the flow used, the byte check of the tool, the placement of hourly values, cadence figures, yardstick and split definitions, the header and the texts, release protocol) | **Accepted** | 2, 3, 4, 5 |
| F17: name the direction for the owner | **Accepted.** It leads section 0 and item 2 of the description | 0, 3.4 |

The auditor's "smaller first step" is taken: step 1 is the description, and a log-only release is offered before the change itself.

## 10. For the owner to confirm before anything is run

1. **The order:** step 1 now (a description by replay, no risk to the app); then your choice between a log-only release, the change, or nothing.
2. **The clock rule:** the measured relation held inside its measured range (5.7 hours at most, 2.0 hours at least). The alternative: a separate, longer value at low water (7.1 hours below 1,500 cfs).
3. **What step 1 reports** (section 3.4), with the badly-low readings on rising water in front.

A plain yes confirms all three as written.

## 11. The owner's confirmation (2026-11-27, 9:40 pm Eastern)

The owner's word: "do both! yes to step 1, and look at the creeks! make sure not to make mistakes again."

- Read as a yes to the three points of section 10 as written: the order of the steps; the clock held inside its measured range (the separate low-water value was not chosen); what step 1 reports. This is the orchestrator's reading of "yes to step 1".
- Step 1 started at 9:46 pm Eastern. Nothing in the app changes in step 1. Step 2 stays the owner's choice after the report.
- "Look at the creeks" is a separate piece of work with its own folder, `analysis/creek_look_2026-11-27/`, its own plan and its own audit.
- On "no mistakes": no number from step 1 is reported as a finding before the tool audit, the two blind analysts and the third auditor agree on it.

## 12. Notes after the tool audit (2026-11-27, 9:57 pm Eastern)

- `TOOL_AUDIT.md`: tool fit for use, no blocker and no defect. Old mode reproduces the existing run byte for byte; the NEW run on disk is what the tool produces; all 129,534 due times, validation hours and truths match the auditor's own recomputation from the input file.
- **Finding F1, to lead the report:** in both runs the moment that is actually scored is a staircase. Estimates are made on whole hours and the truth is read 11 minutes before the first whole hour at or after the due time. So the scored lag is always a whole number of hours plus 0.82 hours: between 0.18 hours earlier and 0.82 hours later than the formula (0.28 hours later on average in NEW, 0.31 in OLD). This is the original tool's stand-in for the hourly job and is the same in both runs.
- **Consequence for section 3.2, and a correction of the orchestrator's own instruction:** the three common truths are read at the exact times (the hour of the estimate plus the clock, plus the long end, plus the short end), as section 3.2 says, not on the staircase. The orchestrator's first brief to the specification writer put them on the staircase; that was corrected before the specification was finished. Each run's own truth stays on the staircase and is rebuilt by the analysts as a check of their code.
- **Finding F2:** columns read at the validation hour differ between the runs, so a paired comparison on the runs' own truths uses only hours with a truth in both runs.
- **Counts from the tool, confirmed by the auditor** (description, no judgement yet): NEW stores 38,046 estimates for scoring and scores 37,913 (OLD 23,764 and 23,688); 133 miss their 2.5 hour window (OLD 76); 396 retries (OLD 222); 65 skipped by the data checks (OLD 37).

## 13. Notes after the specification review (2026-11-27, 10:21 pm Eastern)

`SPEC_REVIEW.md`: ready after changes (1 blocker, 6 major, 8 minor). All findings and all of the reviewer's rulings on open points were accepted; the specification is version 1.1 (`ANALYSIS_SPEC_v1.0.md` kept). What checked out in the review: every group count of section 3.3, all 18 unit tests, all checksums, and the rebuild of each run's own truth on all 129,534 estimate hours of both runs. Rulings that touch this plan:

1. **The health stop rule of 3.4 item 6 had no limit; it has one now.** Nothing may be pending at the end of a run; per stored estimate, NEW's rates of missed windows, retries and estimates skipped by the data checks are at most 1.5 times OLD's; in the test years NEW's 99th percentile of the hour-to-hour change of the correction, and its count of jumps of 5 points or more, are at most 1.5 times OLD's. The factor 1.5 is the one on record from version 1 and its audit (F6). Stated plainly: the orchestrator fixed these limits after seeing the counts files (the three rates are 0.35% against 0.32%, 1.04% against 0.93% and 0.17% against 0.16%) and before seeing any figure on the correction's jumps. A failure stops the step and is investigated; it is not a verdict on the change.
2. **The yardstick with the trend uses the new clock on all three truths.** Otherwise it is a different estimator on each truth and "the same on all three" protects nothing. This overrides the last clause of plan audit F14.
3. **Low water** follows the plan's wording (below 3,000 cfs and outside every rise and recession window; 16,140 test hours). Little Falls rising hours are not taken out of it; 643 hours are in both groups.
4. **The hour-to-hour change of the correction** is measured against the uncorrected estimate, which is the same in both runs (a departure from the denominator named in plan audit F6).
5. **The cap comparison gets neutral labels.** The cap can only lower the number, so it can never remove a reading that is too low; the report says so wherever the cap is discussed.
6. **A second known property, to stand beside the staircase:** the owner's main table (badly-low readings on rising water on the three common truths) leans toward NEW by the way it is built. NEW learned within 0.18 hours before to 0.82 hours after the central truth, and below 20,000 cfs all three truths lie on NEW's side of OLD's clock (item 9 gives the exception). The report says this in the same place as the table.
7. **The check of 3.4 item 7** (NEW not worse than OLD on the central truth) is no longer guaranteed by construction now that the common truths are read at exact times. It stays a stopping check.
8. **Hours flagged as corrupt data in either run** are left out of the common-truth statistics, the same hours for both runs.
9. **A correction to section 0, found by the reviewer's second pass.** Section 0 says the old clock is longer than the new one "on all but 109 of 59,746 test hours". That count was made on the formula before the clock was held at 2.0 hours above 20,000 cfs (section 2). For the clock as built, by the reviewer's count: the old clock is not longer than the central clock on 1,439 of the 60,120 test hours with an estimate, 1,433 of them at 20,000 cfs and above; it is not longer than the long end on 3,032 hours, 2,974 of them at 20,000 cfs and above; the short end is always shorter than the old clock. So the argument of section 0 holds below 20,000 cfs. At 20,000 cfs and above the two clocks are close and the new one is often the longer; the report treats that range separately (section 3.3 already has it as its own group).

## 14. Step 1 is done (2026-11-27)

The report is `REPORT.md`; the third audit is `RESULTS_AUDIT.md` (pass with notes). The owner's choice of step 2 is open. Eight of the expectations of section 7 did not hold; the report lists them (its section 8).

# Onset study (TODO D20): does the "rising" correction take off too much at a gentle rise, and would a softer hand-over help?

Plan version 1, 2026-11-25. Draft for the independent audit. No analysis code is written before the audit, the rulings on it, and the owner's confirmation of the method.

Started on the owner's word of 2026-11-25 ("study the onset").

## 1. The question

The Great Falls estimate is corrected with one of 18 learned values: 6 flow ranges × 3 states (rising, steady, falling). The state is decided by one comparison: the Point of Rocks flow now against the reading six hours ago. The moment the difference reaches the threshold, the estimate switches from the steady value to the rising value in one step.

Question 1 (description): in the hours where the river is called "rising" but the rise is small, does the shown estimate read too low, and would the steady value have been closer?

Question 2 (test): does a gradual hand-over from the steady value to the rising value, by the size of the six-hour rise, lower the error of the shown estimate, without harm elsewhere?

This study changes nothing in the app. A positive result leads to a proposal, not to a build.

## 2. What is known

All of this was read on 2026-11-25. "Code" means read in the source, "document" means read in a report.

1. **The state rule** (code, `netlify/functions/shared/model.js:466-493`, browser twin `src/model/shared-model.js`): `change = current − reading six hours ago`; `threshold = max(100 cfs, 2% of current)`; `|change| >= threshold` gives rising or falling, otherwise steady. No memory of the previous state. Fewer than 8 readings or no reading six hours back gives steady.
2. **The correction is a number in cfs**, the running average (alpha 0.3) of `raw estimate − Little Falls`. It is applied as `raw − correction`, then the result is capped at 120% of the latest Little Falls reading (code, `model.js:705-721`).
3. **The state that picks the correction and the state that picks the cell to learn into are the same stored value** (code, `scheduled-update.js:1055`, `:1249`, `:1359`).
4. **Learning uses the raw estimate only** (code, `scheduled-update.js:1242-1245`: `errorCFS = rawCFS − actualCFS`). The "large error" flag also uses the raw error (`:1329`). So what is applied does not feed back into what is learned.
5. **Smoothing across flow ranges exists** (v37.0: ±12% around 3,000, 6,000 and 12,000 cfs; 25,000 and 50,000 stay steps). **Smoothing across states does not exist.**
6. **The finding behind D20** (document, `analysis/replay_lag_2026-11-17/replay_lag_FINAL.md`, `replay_lag_audit.md`): two replays of the real model over 2011 to 2026 that differ only in how fresh the upstream readings are. In 2,987 hour pairs where the fresher version says rising and the other says steady, the fresher one has an absolute error 1.83 points higher (interval 1.45 to 2.25). The rising value takes off 6.86% of the raw estimate, the steady value 5.24%. The loss sits where the upstream change is slow; at fast rises there is none.
7. **Limits of that finding** (same documents): the 2,987 pairs are a subset of a subset; the overall verdict of that study passed by 0.01 point and failed in each half of the record alone; the scripts of the split are not kept in the repository; the auditor's remark that a different onset rule "would probably erase or reverse the loss" is marked as untested.
8. **The corrections today** (the app's own endpoint, 2026-11-25): at 3,000 to 6,000 cfs rising +182 cfs, steady +28, falling −249. At 0 to 3,000 cfs the three are close (+311, +337, +346). At 25,000 to 50,000 cfs they differ a lot (+3,273, +2,336, +1,303).

## 3. What was tried before, and what this study does not repeat

| Earlier work | What it tested | Result | Consequence here |
|---|---|---|---|
| Flow-state floor gate, 2026-06-18 (`analysis/flow-state-floor-gate-findings-2026-06-18.md`) | A lower threshold between 2,700 and 4,700 cfs: MORE hours called rising or falling | Rejected. The hours near the threshold are the noisiest; moving them into the rising cell made that cell worse | This study goes the other way: hours near the threshold get LESS of the rising value. It does not move any hour into another cell |
| C45 phase 2, 2026-06-23 (TODO.md) | Smoothing across states | Not pursued, by argument, never tested. Re-open only "with a concrete blend design that provably preserves the high-flow signal" | The rule below is such a design: it is concrete, and it leaves every hour at 25,000 cfs and above untouched |
| A7, 2026-11-11 and A6, 2026-11-12 | Travel time on a rising river; learning every hour | Both failed on the SHOWN value, because the 120% cap governs the number on a rising river | Every figure here is computed on the shown value, after the cap |
| TODO D23 (eel-season daily wave), parked | The wave flips the state about 3 times a day in autumn | No change; check from 2026-12-16 | All results are also given for 15 Sep to 15 Dec and for the rest of the year, so that this study serves that check |

Not tested anywhere so far: fewer or later "rising" calls, a memory in the state rule, a blend of two state corrections.

## 4. Design in short

1. One replay of the real model, unchanged, with extra columns: for every hour, the correction each of the three states would give, and the six-hour change the state rule saw.
2. Because learning never depends on what is applied (section 2, points 3 and 4), every hand-over rule can be computed afterwards from this one file. The learned values are identical under all rules.
3. The record is split in two. The first half (design years) is used to describe the problem and to pick one rule. The second half (test years) is used once, to test that one rule against a decision rule fixed now.
4. Everything is computed twice, blind, in Python and in R, and checked by a third auditor.

The study is "application only": it does not change which cell an hour belongs to. A change of the state rule itself (threshold, memory) would change the learning, would need its own replays and a reset of the corrections in production, and is not part of this plan (section 12).

## 5. Data and the replay

- **Input:** `analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv`, 130,416 hourly rows, 2011-12-01 to 2026-11-09 23:00 UTC. The values for 2026-10-08 onward are as first published, before the USGS revision of 2026-11-13; that is what the app saw.
- **Tool:** a copy of `analysis/replay_lag_2026-11-17/ci_backtest_harness_lag.mjs` in this folder. It imports the production code (`makeGFPrediction`, the correction helpers) and carries no copy of the rules. The copy adds columns and changes nothing else.
- **Run:** `--arm=L --gate=new --mode=hybrid`. Arm L gives the model the upstream readings about one hour old, as the hourly job at the top of the hour has them. `gate=new` uses today's anomaly rules. `hybrid` learns from one waiting estimate at a time, as production does, and writes an estimate for every hour that is never learned from.
- **Added columns per hour:**
  - `d6`: Point of Rocks flow now minus the reading the state rule used (cfs); `thr6`: `max(100, 0.02 × flow now)`; a marker when the rule had too little history.
  - `corrR`, `corrS`, `corrF`: the value of the production function `getGFCorrectionInterpolated(bins, raw, state)` for rising, steady and falling, with the cells as they stand at that hour. Sparse cells and the flow-range smoothing are therefore handled by the production code, not by a copy.
  - `lfCap`: the Little Falls reading used for the cap.
- **Checks built into the tool, on every row:** (a) the state recomputed from `d6` and `thr6` equals the model's state; (b) the correction of the model's state equals the correction the model applied; (c) `round(min(raw − correction, 1.2 × lfCap))` equals the model's shown value. One failing row stops the study.
- **Regression:** with the added columns removed, the output equals `analysis/forecast_from_measured_water_2026-11-24/replay_B/shadow_L.csv` byte for byte (SHA-256), and the learning files are identical.
- **Scored hours:** the rules of the earlier study (`analysis/replay_lag_2026-11-17/ANALYSIS_SPEC.md`, section 1) for one arm: status "predicted", no hard flag that depends on the truth, truth inside the valid range, no blank error. Truth is the Little Falls flow one travel time after the estimate.
- **Burn-in:** hours before 2012-12-01 are not scored (the cells start empty).
- **Design years:** 2012-12-01 to 2019-12-31. **Test years:** 2020-01-01 to 2026-11-09.

## 6. The rules to compare

For an hour whose state is rising and whose raw estimate is below 25,000 cfs:

```
w          = clamp( (d6 − thr6) / ((m − 1) × thr6), 0, 1 )
correction = (1 − w) × corrS + w × corrR
shown      = round( min( raw − correction, 1.2 × lfCap ) )
```

Every other hour is as in production. `m` is the multiple of the threshold at which the full rising value applies. Just above the threshold the hour still gets the steady value; from `m` times the threshold it gets the rising value as today.

| Rule | m | Role |
|---|---|---|
| Production | 1 (a step) | Baseline |
| Hand-over | 1.5, 2, 3, 5 | Candidates. One of them is picked in the design years |
| Steady always | no upper end | Reference only: the rising value is never used below 25,000 cfs |
| Both sides | the picked m, also on the falling side with `corrF` | Reference only, for the eel-season question |

Why below 25,000 cfs only: the differences between states at high flow are large and were judged real regime structure (C45), and the earlier test of smoothing at 25,000 and 50,000 cfs made things worse. A side effect: for small rises, the correction then steps at 25,000 cfs. The report says how many hours that touches.

## 7. Step A, design years only

**A1. Description.** Rising hours below 25,000 cfs, grouped by `d6 / thr6`: 1 to 1.5, 1.5 to 2, 2 to 3, 3 to 5, 5 to 10, above 10. For each group: number of hours; mean signed error and mean absolute error (percent of the truth) of the raw estimate, of the shown estimate with the rising value (production), and of the shown estimate with the steady value. The same table by flow range (0 to 3,000, 3,000 to 6,000, 6,000 to 12,000, 12,000 to 25,000 cfs) and by hours since the rising spell began (1, 2, 3, 4 to 6, 7 to 12, more than 12).

This answers question 1 inside one replay, without the comparison of two replays that D20 rests on.

**A2. Picking one rule.** `m*` is the candidate with the lowest mean absolute error of the shown estimate over all rising hours below 25,000 cfs in the design years. If the best two are within 0.02 points, the smaller `m` is taken. If no candidate is better than production in the design years, the verdict is NOT SUPPORTED and step B is reported as description only.

## 8. Step B, test years, used once

Compared: the rule with `m*` against production, both on the shown value.

- **Hours:** all scored hours; the affected hours (the two shown values differ); the rising hours below 25,000 cfs.
- **Per hour:** `d = |error of the rule| − |error of production|`, in points of percent error. Negative is better.
- **Measures:** mean `d`; mean absolute error and mean signed error of each; the share of hours shown 15% or more below the truth, and 15% or more above.
- **Uncertainty:** bootstrap over calendar months, 10,000 draws, 95% interval, one shared file of random numbers so both languages draw the same months.
- **Splits:** the two halves of the test years (2020-01 to 2023-05, 2023-06 to 2026-11); 15 Sep to 15 Dec against the rest of the year; the four flow ranges; with and without the hours from 2026-10-08.
- **Also reported, not judged:** all candidates and both references in the test years.

## 9. The decision rule, fixed before any number is seen

PASS needs all of these in the test years:

1. **Size:** on the affected hours, mean `d` is −0.50 points or better, and the whole 95% interval is below 0.
2. **No harm by cell:** in each of the four rising cells below 25,000 cfs with at least 300 hours, the rule's mean absolute error is not more than 2% (relative) above production's.
3. **Stable in time:** mean `d` on the affected hours is below 0 in each half of the test years.
4. **Stable by season:** mean `d` on the affected hours is not above 0 in the eel season, nor in the rest of the year.
5. **Not more low readings:** on the rising hours below 25,000 cfs, the share shown 15% or more below the truth is not higher than production's, and the share 15% or more above is not higher by more than 0.5 percentage points.
6. **High water untouched:** every hour at 25,000 cfs or above has the same shown value as production.

FAIL: on the affected hours the interval includes 0, or mean `d` is worse than −0.25.

UNCLEAR: everything else (for example a gain between 0.25 and 0.50 points, or the size is met but one of points 2 to 5 is not).

The 0.50 and 0.25 points are the orchestrator's proposal. The owner may set other values before the run, not after.

**What follows a verdict.** PASS: a proposal to build, with its own plan and audit. It would be a MAJOR version (the shown number changes for the same inputs), in the browser and on the server, with no reset of the corrections because the learning is unchanged. FAIL or NOT SUPPORTED: D20 is closed as tested. UNCLEAR: the owner decides whether the second stage (section 12) is worth a plan.

## 10. Verification

1. **Tool audit** (a fresh auditor): the regression of section 5, the three row checks, and a reading of the added lines.
2. **Specification** written from this plan by one agent and reviewed by another before any analyst starts.
3. **Two blind analysts**, Python (`python3 -I`, standard library only) and R (base only), who see the specification and the data, not each other and not this plan's expectations. Every number must agree within 0.01; the aim is identical output files.
4. **Third auditor**, who ran none of it: agreement of the two, the method against this plan, the row accounting, an own recomputation of the headline numbers, and at least five readings checked against the USGS public service.
5. If the two analysts differ: stop and find the cause. No averaging, no picking.

## 11. What this study cannot show

- The replay runs on hourly values and never resets the cells; production reads every 15 minutes and had resets.
- It is the server's model. The browser decides the state with a slightly different rise-rate input.
- The truth is the Little Falls flow, as in all accuracy figures of this app, not a measurement at Great Falls.
- The split into design and test years protects the choice of one number, `m`. It does not protect the choice of the rule's form, which was made from the D20 finding on the same record.
- A PASS says the shown number would have been closer in 2020 to 2026. It does not say how the rule behaves with the corrections as they stand in production today.

## 12. Not in this plan

A second stage that changes the state rule itself (a higher threshold, a memory, a minimum duration). It changes which cell learns, so each variant needs its own replay with a changed state function, and in production it needs a reset of the corrections. It would get its own plan, and only if step A shows a clear pattern that the hand-over rule cannot use.

## 13. Expected outcomes, written before the run

- Step A: among rising hours with a six-hour change below twice the threshold, the shown estimate reads low, and the steady value would have been closer. Above five times the threshold, the rising value is better.
- `m*` is 2 or 3.
- Step B: a gain of 0.3 to 1.5 points on the affected hours; below 0.1 point over all hours, because the affected hours are a small share.
- An honest chance of FAIL or UNCLEAR of about one in two. Three earlier changes in this area failed, and the D20 finding itself was not stable across the two halves of the record.

## 14. Roles

Orchestrator: plan, rulings, synthesis. Tool builder and both analysts: Sonnet. Plan auditor, tool auditor, specification reviewer, third auditor: Opus.

## 15. Questions put to the plan auditor

1. Is it true, in the production code and in the replay tool, that nothing in the learning depends on the applied correction, so that one replay serves all rules?
2. Can `d6`, `thr6` and the three corrections be logged exactly as the model sees them (same history, same clock)?
3. Is arm L the right stand-in for production?
4. Is the way `m*` is picked sound? Is the list of candidates right? Should "steady always" be a candidate?
5. Are the decision rule and its thresholds sensible? Which harm check is missing?
6. Will the affected hours be too few to decide anything?
7. Which approach is missing that should be in this stage?

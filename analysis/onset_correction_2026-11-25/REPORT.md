# Onset study (TODO D20): report

2026-11-25. Plan: `PLAN.md` (version 2 with section 17). Rules for the analysts: `ANALYSIS_SPEC.md` (version 1.2). Third audit: `RESULTS_AUDIT.md` (results verified, with caveats). Nothing in the app was changed.

## 1. The result

**Verdict by the rule fixed in advance: UNCLEAR.** Six of eight conditions are met, two are not.

A gradual hand-over from the steady to the rising correction lowers the error on rising hours below 25,000 cfs by 0.66 points in the test years (2020 to 2026). The gain is stable in time, by season, by flow range and under a second input timing. But a plain half-and-half mix of the two corrections, which ignores the size of the rise, delivers 86% of that gain, and the hand-over is not clearly better than it. So the gain is real in the replay, and it is mostly not an onset effect.

By the plan (section 10), an unclear verdict goes to the owner, and nothing is built from this study.

## 2. The eight conditions

Test years, main run. R is the 8,148 scored rising hours below 25,000 cfs (13.7% of the 59,448 scored test hours). `d` is the rule's absolute error minus production's, in points of percent error; negative is better. The picked rule is the hand-over that reaches the full rising correction at 5 times the threshold.

| # | Condition | Number | Met |
|---|---|---|---|
| 1 | Size: mean d on R at most −0.25, interval below 0 | −0.658, interval −0.941 to −0.376 | yes |
| 2 | No rising cell harmed | error lower in all four cells, by 5.0% to 8.9% | yes |
| 3 | Both halves of the test years | −0.727 and −0.588 | yes |
| 4 | Eel season and rest of the year | −0.667 and −0.653 | yes |
| 5 | Lowered hours: no worse on average AND not more hours 15% or more too low | mean d −1.175, but the share rises from 5.74% to 7.57% | **no** |
| 6 | Large errors on R not more frequent | 15% or more too low: 10.59% to 8.79%. 15% or more too high: 7.03% to 6.52% | yes |
| 7 | Better than "half and half", interval below 0 | −0.095, interval −0.222 to +0.030 | **no** |
| 8 | Second input timing (arm F) | −0.593, interval −0.834 to −0.371 | yes |

## 3. The numbers behind it

**Picking the rule (2012 to 2019, 7,052 rising hours below 25,000 cfs), mean absolute error:**

| Rule | Error |
|---|---|
| Production (today's step) | 8.508 |
| Hand-over, full rising value at 1.5 / 2 / 3 / 5 times the threshold | 8.101 / 7.899 / 7.708 / 7.602 |
| Half and half | 7.710 |
| Steady value always | 7.737 |
| Mean of the three states | 7.776 |

The widest candidate was picked mechanically. The third auditor looked beyond the list: the error is lowest near 7 to 10 times the threshold (7.579) and the curve is flat from 5 to 15. The best value lies outside the list that was fixed in advance.

**Test years, on R:**
- Error 8.980 with production, 8.322 with the picked rule (7.3% lower). Mean signed error from −1.315 to −0.107.
- Every test year is better: 2020 −0.62, 2021 −1.08, 2022 −0.41, 2023 −0.79, 2024 −0.89, 2025 −0.70, 2026 −0.14.
- Over all scored test hours the mean d is −0.090 (interval −0.128 to −0.052).
- With quarters as bootstrap blocks: interval −0.935 to −0.348. Without the 55 hours of unusual span: −0.646.

**Every rule against production, test years, on R:**

| Rule | Mean d | Hours changed | Raised / lowered |
|---|---|---|---|
| Hand-over at 1.5 | −0.290 | 2,363 | 1,472 / 891 |
| Hand-over at 2 | −0.456 | 3,781 | 2,392 / 1,389 |
| Hand-over at 3 | −0.601 | 5,363 | 3,425 / 1,938 |
| Hand-over at 5 (picked) | −0.658 | 6,516 | 4,232 / 2,284 |
| Half and half | −0.563 (interval −0.752 to −0.373) | 7,139 | 4,713 / 2,426 |
| Steady always | −0.434 | 7,211 | 4,715 / 2,496 |
| Mean of three | −0.421 | 7,105 | 5,173 / 1,932 |

## 4. What the gain is made of

- **Mostly blending.** Half and half gives −0.563 of the −0.658. Simply not using the rising value gives −0.434.
- **A part is tied to the size of the rise, but it is small and not clear of chance.** At a change of 1 to 1.5 times the threshold the hand-over beats half and half by 0.26 points. At 5 to 10 times, where the hand-over equals production, half and half is better by 0.24.
- **The steady value is closer only at small rises.** Design years, steady against rising value: better by 1.71 / 0.79 / 0.59 points at a ratio below 1.5 / 2 / 3, about level from 3 to 10, worse by 0.89 above 10. The test years show the same shape.
- **Three explanations overlap and this study cannot separate them:** a small rise, the first hours of a rise (first hour: 8.91 against 6.81; gone after 12 hours), and an old rising value. Production's error grows with the age of the rising cell:

| Age of the rising cell | Production | Steady value | Steady's lead |
|---|---|---|---|
| under 1 day | 6.59 | 6.54 | 0.05 |
| 1 to 7 days | 9.45 | 7.95 | 1.50 |
| 7 to 30 days | 11.25 | 9.32 | 1.93 |
| over 30 days | 12.50 | 11.44 | 1.06 |

  The raw error grows with the age as well, so old cells also mark harder conditions. The ages describe only the cells of the hour's own flow range.
- **Production overshoots in both directions.** Where the rising value is the larger one its bias is −3.56; where it is the smaller one, +3.49. That is what a noisy cell looks like.

## 5. The lowered hours (condition 5)

- On 2,284 hours the rule lowers the shown value, by 163 cfs on average. The mean error improves there (−1.175).
- 42 of these hours cross the line to "15% or more too low" (131 to 173 hours). Production had them 1.5% to 14.9% too low; the rule moved them to 17% too low on average. 19 of the 42 are in 2025.
- Over all of R the count of such hours falls, from 863 to 716: raised hours take 189 out, lowered hours add 42.
- **A weakness of the condition itself, found by the third auditor:** lowering a value can move an hour into that group and never out of it. As written, the share test could only be met if not one lowered hour crossed the line. The verdict stands as computed; the condition is not re-read after the result. With condition 5 met, the verdict would have been "gain without onset", which also leaves the decision to the owner and builds nothing.

## 6. Also found, reported and not judged

- **The falling side.** The same hand-over applied to falling hours below 25,000 cfs (12,925 hours) makes them slightly worse: +0.104 points (eel season +0.017, rest +0.140). On the falling side the state's own correction earns its place. This matters for the eel-season check of 2026-12-16 (TODO D23).
- **The step at 25,000 cfs.** 911 rising test hours are at 25,000 cfs or above; 469 of them are rises below 5 times the threshold and keep the full rising value. The rising value is 2,082 cfs larger than the steady value there on average; the rule, had it applied, would have moved the shown number by 2.5% of the truth.
- **Hours from 2026-10-08:** 174 hours, mean d −2.24, no interval, and inputs that USGS has since revised. Not to be quoted as a result.

## 7. What must not be claimed

1. That the gain is an onset effect or tied to the size of the rise. Condition 7 failed.
2. A pass, or "gain without onset". Condition 5 failed and is not re-read.
3. That the app's headline error would improve by 0.09 points. This is a replay on hourly values without resets; the state rule's change spans about 4 hours there and about 4.9 in the app; the browser decides "rising" by another route; the truth is the Little Falls flow.
4. That 5 times the threshold is the best width, or that it carries over to the app.
5. That lowered hours are unharmed. 42 were pushed past the 15% line.
6. That the steady value is better in general. From 3 times the threshold up it is equal or worse.
7. That this study confirms D20 independently. The form of the rule came from the whole record, test years included; the split protected only the choice of the width.
8. That small rises cause the problem. Small rise, start of a rise and old cell overlap.

## 8. Mistakes and weak points, the orchestrator's own

- **Condition 5 was badly built** (section 5). I wrote it after the plan audit asked for a guard on lowered hours and did not see that its share test can only move one way.
- **Two figures in the plan were wrong.** Section 2, point 12 gave the hours each candidate changes as 3,386 / 4,514 / 5,733 / 6,643 and 1,781 lowered at twice the threshold. The real figures are 2,363 / 3,781 / 5,363 / 6,516 and 1,389. They came from the plan audit, were not used in any condition, and I passed them on to the owner unchecked.
- **The candidate list stopped too early.** The best width lies beyond it.
- **My written expectations (plan section 14) against the outcome:** I expected a width of 2 or 3 (it was 5), a mean d of −0.1 to −0.4 (it was −0.66), and UNCLEAR as the most likely verdict (it was). I had put the best case for the headline at about 0.04 points; the replay gives 0.09.
- **An interim message to the owner went too far.** Before the third audit I wrote that the starting idea "looks wrong". The audit shows it is not wrong, only not separable from two other explanations.

## 9. Verification

- **Replay tool:** a copy of the earlier tool with 14 added columns. Its output without them equals the earlier replay byte for byte, in both input timings. Three checks ran on every hour (129,534 and 129,549), all passed. The tool auditor rebuilt the three corrections and the inputs of the state rule for every hour by a separate route: no mismatch (`TOOL_AUDIT.md`).
- **Specification:** reviewed in two passes, 20 findings, all applied (`SPEC_REVIEW.md`).
- **Two blind analysts:** Python and R, 13 output files each, byte-identical. All 40 check rows equal. The compare tool prints AGREE.
- **Third auditor:** an own implementation in a third language from the plan gives every input of the decision to the sixth decimal; the intervals with the shared random numbers match exactly, with own random numbers to about 0.005. No condition was computed on the wrong hours or number. The 146 hour-and-rule pairs on the 15% line (63 in the main run, 83 in the timing run; 13 and 18 distinct hours) are exact values and touch no share used in conditions 5 or 6.
- **Source data:** 11 of 11 USGS readings outside the revised period match the input exactly. From 2026-10-08 the Point of Rocks input lies below today's USGS values by up to 18.3%, as expected after the revision of 2026-11-13. One reading shortly before, 2026-10-01 12:00, differs by 0.4% and is unexplained.
- **Not verified:** the app after 2026-11-25. The travel-time pairing of the truth was not re-checked in this study.

## 10. What follows

By the plan, the owner decides. Nothing is built from this study.

**The orchestrator's recommendation: no change to the app, and no further replay study.** The reasons:
- The gain is not the onset effect the rule was designed for, so the designed rule has no footing.
- What remains is "lean less on the rising correction below 25,000 cfs". The half-and-half mix was fixed in advance without any tuned number and still gave −0.563 on the test years. That is the one robust finding here.
- A replay cannot settle whether it holds in the app (section 7, point 3).

**One thing worth keeping, at the owner's choice:** a later check of the half-and-half mix on the app's own log, with the rule and the conditions frozen in a short plan of its own before any log is read. The log keeps the raw estimate, the state, the applied correction and every learning step, so the mix should be computable for real hours; that check's own plan has to confirm it. The hourly log is kept for 180 days, so hours from today on would have to be read before about 2026-05-20. If the owner prefers to stop here, D20 is closed as tested.

## 11. Files

`PLAN.md`, `PLAN_v1.md`, `PLAN_AUDIT.md`; `tools/replay_onset.mjs`, `replay_README.md`, `TOOL_AUDIT.md`; `ANALYSIS_SPEC.md` (1.2), `ANALYSIS_SPEC_v1.1.md`, `ANALYSIS_SPEC_v1.md`, `SPEC_REVIEW.md`; `tools/make_boot_uniforms.py`, `tools/compare_analysts.py`; `py/`, `r/`; `RESULTS_AUDIT.md`; this report. The large replay outputs and the file of random numbers are rebuilt with the commands in `replay_README.md` and the specification.

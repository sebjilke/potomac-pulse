# Cap study: report

2026-11-27. Question of the owner (2026-11-26): does the 120% cap do a good job, and is there a better rule?

**Verdict: KEEP.** Computed mechanically by two blind analysts whose 14 output files are identical byte for byte, rebuilt by a third auditor (`RESULTS_AUDIT.md`: pass with notes). No change to the app follows.

**Note added later on 2026-11-27 (first look, not verified; see `analysis/clock_first_look_2026-11-27/README.md`).** Every figure in this report takes its truth on the app's own clock from Great Falls to Little Falls. On a rise that clock was found to run 9 to 14 hours where the record suggests about 3. If that holds, the verdict KEEP gets firmer (section 8: an earlier truth makes every looser rule look worse), but the figures for the large rises in items 3 and 4 below and in section 7 are probably far too pessimistic about the cap, and the reading by the owner's first weighing that was given to him in conversation is withdrawn. Nothing in this report has been recomputed.

**Second note, 2026-11-27 evening.** The clock study is done (`analysis/clock_study_2026-11-27/REPORT.md`): the app's clock is 1.7 to 1.9 times the longest value the measurement allows, in all three cases that could be judged (rising water below 12,000 cfs and low water; high water was not measured). So the first note stands. A replay on a corrected clock, planned with the build of that clock, will show how the figures of this report move.

## 0. In short

1. **The cap does a good job.** On every group of hours where the reading was fixed in advance, in 2020 to 2026, the error is lower with the cap than without it, with the whole interval on that side. In 2012 to 2019 the same holds on five of six groups; on the large rises of those years the reading is unclear.
2. **None of the ten looser rules is better. Each one is worse.** None passed the first hurdle (no loss in overall error in 2012 to 2019). Each is also more often badly off on rising water than today's cap, in both periods, with every interval on the wrong side. This includes both of the owner's ideas.
3. **The owner's observation is right, the cause is not the cap.** On the rising limbs of the large rises since 2020 the app reads badly low on 43% of hours. Without the cap it would read badly low on 27% and badly high on 30%, with a clearly larger error. The estimate itself is off on large rises; the cap only chooses which side the error falls on.
4. **Most low readings on rising water are not capped at all.** Of the rising hours that read badly low since 2020, one in five is capped. No cap rule can touch the other four.
5. **The weak spot of this result is the timing of the truth.** If the water reaches Little Falls two hours later than the app's travel time says, the two mildest rules come out slightly ahead of today's cap instead of slightly behind. With the truth one hour earlier or one hour later every rule stays worse.
6. **A fact that points the other way, as description only:** a tighter cap (110%) has a lower error overall and on rising water, and a higher error on the large rises. It was not a candidate and was not tested.

## 1. What was done

The replay of the onset study holds, for every hour from December 2012 to 9 November 2026, the estimate before the cap, the Little Falls reading the cap used, and what arrived at Little Falls one travel time later. Every cap rule was applied afterwards to that same estimate. Ten looser rules were candidates: fixed caps of 135, 150 and 200%; two that carry Little Falls' own rise of the last 3 or 6 hours forward (LF3, LF6); one that lets the cap grow with the model's own rise (MR); one by the rise at Point of Rocks (UP); no cap while the state is "rising" (RIS); a cap only from November to March (ICE); no cap at all (N). A rule had to show no loss in overall error in the design years (2012 to 2019) to be picked, and the pick would then have faced nine conditions in the test years (2020 to 2026). "Badly off" means the shown value is 15% or more away from the truth, too low or too high. The method is `PLAN.md` (version 2, confirmed by the owner); the exact arithmetic is `ANALYSIS_SPEC.md` (version 1.2).

## 2. How it was checked

- **Plan:** independent audit, 16 findings, all accepted. The first plan measured the benefit on the low side only, which no rule could fail; version 2 measures both sides.
- **Specification:** independent review and a re-check, 14 findings, all accepted. One count of the orchestrator was wrong and was corrected before anything was computed (`PLAN.md` section 18).
- **Two blind analysts** (Python, R), each from the specification alone: all 14 output files identical byte for byte. Both had first written one row label of the checks file differently from the specification; the compare tool caught it, both corrected it, no number changed.
- **Third auditor:** an own implementation in a third language reproduces 13 of the 14 files byte for byte (the 14th, the checks file, was rechecked in its main rows); both analysts' runs were repeated with unchanged files; the verdict was recomputed by hand; 21 readings were compared with the USGS public service: 18 identical, 3 differ by 0.8 to 1.0% (Little Falls, the rise of 2026-05-23, where the file holds values USGS has since adjusted). No conclusion depends on them.
- **Structure:** on every one of 1.72 million hour and rule pairs a candidate shows at least what production shows. So the share of badly-low hours can only fall and the share of badly-high hours can only rise under any candidate. These one-sided shares are description here, never a benefit.

## 3. Does the cap do a good job?

Reading fixed in advance: the cap does a good job on a group of hours if the error without it is higher, with the whole 95% interval above 0. Mean difference in absolute error, no cap minus cap, in points:

| Group of hours | 2012 to 2019 | 2020 to 2026 |
|---|---|---|
| all scored hours | +0.35 [0.24, 0.48] good job | +0.40 [0.25, 0.57] good job |
| capped hours | +9.83 [7.32, 12.55] good job | +9.37 [6.38, 12.71] good job |
| capped, rising | +10.80 [7.81, 13.79] good job | +13.71 [8.81, 19.68] good job |
| capped, not rising | +8.49 [4.15, 14.05] good job | +4.70 [1.95, 7.70] good job |
| Little Falls itself rising | +1.07 [0.64, 1.54] good job | +0.95 [0.53, 1.48] good job |
| rising limbs of the large rises | +6.66 [−1.32, 16.41] unclear | +14.52 [4.87, 24.49] good job |

The figure for all hours looks small because the cap binds on about 4% of hours. On the hours where it binds, the error without it would be 9 to 10 points higher.

What the cap does to the 2,511 capped hours of 2020 to 2026, by class with and without it:

| Without the cap | With the cap | Hours |
|---|---|---|
| within 15% | within 15% | 855 |
| badly high | within 15% | 627 |
| badly high | badly high | 575 |
| within 15% | badly low | 215 |
| badly low | badly low | 163 |
| badly high | badly low | 76 |

So the cap brings 627 hours into range and pushes 215 out of it: 412 fewer badly-off hours. The 215 are the owner's case: hours the cap makes read low. They are real, and they are outnumbered three to one.

## 4. Is there a better rule?

No. In the design years every candidate has a higher overall error than today's cap, so none qualified and none was picked. The verdict is KEEP.

| Rule | Overall error against the cap, design years (points) | Badly off on rising water, design years |
|---|---|---|
| today's cap | 0 | 14.25% (1,321 of 9,272 hours) |
| LF6 | +0.047 | 14.91% |
| LF3 | +0.046 | 15.07% |
| F135 | +0.105 | 15.95% |
| ICE | +0.212 | 16.24% |
| F150 | +0.166 | 16.59% |
| UP | +0.133 | 16.67% |
| MR | +0.233 | 16.87% |
| RIS, N | +0.223, +0.350 | 17.05% |
| F200 | +0.285 | 17.06% |

The verdict does not hang on the qualifying line: even without it, no candidate has fewer badly-off rising hours than the cap (the best, LF6, has 1,382 against 1,321).

## 5. The ten rules in the test years (description; nothing was picked, so this is not a test)

Change against today's cap, 2020 to 2026:

| Rule | Badly off on rising water (points) | Overall error (points) |
|---|---|---|
| LF3 | +1.24 [0.64, 1.93] | +0.044 [0.022, 0.068] |
| LF6 | +1.30 [0.70, 2.02] | +0.046 [0.023, 0.071] |
| F135 | +2.41 [1.58, 3.39] | +0.126 [0.086, 0.170] |
| ICE | +2.48 [1.46, 3.67] | +0.306 [0.169, 0.472] |
| MR | +2.84 [1.90, 3.93] | +0.270 [0.195, 0.349] |
| F150 | +2.93 [1.92, 4.08] | +0.189 [0.132, 0.249] |
| UP | +3.27 [2.21, 4.49] | +0.201 [0.141, 0.268] |
| F200 | +3.48 [2.37, 4.74] | +0.295 [0.207, 0.389] |
| RIS | +3.51 [2.40, 4.78] | +0.300 [0.177, 0.461] |
| N | +3.51 [2.40, 4.78] | +0.396 [0.254, 0.568] |

Every interval lies above 0. The run with the other input timing (arm F) agrees in sign for every rule. RIS and N are the same rule on rising hours, so they are one result there.

On rising water since 2020, removing the cap would take 131 hours out of "badly low" and put 449 into "badly high".

## 6. The owner's two ideas

- **"No cap unless ice is plausible" (ICE):** worse than today's cap overall and on rising water in both periods. The cap earns its keep in the warm months: almost all large rises fall between June and November, and there ICE is nearly the same as no cap. The temperature form of the idea (water at or below 5 °C, data from May 2021 only, description) is also worse than the cap on its hours (overall error +0.43 points, badly-off rising hours +3.7 points). The cap is not mainly an ice guard in what it does; it corrects the model's overshoot on rises.
- **"A threshold that depends on the speed of the rise" (LF3, LF6, MR, UP):** the two rules that use Little Falls' own recent rise are the best of the ten, and still slightly worse than today's cap (since 2020 about +0.05 points overall and +1.2 to +1.3 points more badly-off rising hours; before 2020 about +0.05 and +0.7 to +0.8). The two that follow the model's own rise or the rise at Point of Rocks are clearly worse: they loosen the cap exactly where the model overshoots.

## 7. The large rises

13 rises since 2020, 452 rising-limb hours. These rises were known when the rules were shaped, so this is not an independent test, and the intervals rest on few months.

| | Mean error | Reads badly low | Reads badly high |
|---|---|---|---|
| today's cap | 21.1%, on average 16.5% too low | 43.1% of hours | 3.5% |
| no cap | 35.6%, on average 11.7% too high | 26.5% | 30.3% |

The same picture in 2012 to 2019 (8 rises, 275 hours): 49.8% badly low with the cap; 30.9% badly low and 31.6% badly high without it.

A mild loosening (125 to 135%, or LF3) is close to a wash on these hours: since 2020 the mean error is 0.3 to 0.5 points lower than today's and the share of badly-off hours is the same or up to 2 points higher; before 2020 the differences are as small and go both ways. No interval exists for these figures. Anything looser is clearly worse. A looser cap does not fix the large rises; it moves hours from "too low" to "too high".

## 8. How much rests on the timing of the truth

The truth is the Little Falls flow one travel time after the estimate. On a steep rise a later truth is higher, which favours every looser rule. The whole comparison was repeated with the truth shifted:

| Truth taken | Badly off on rising water, change against the cap | Overall error, change |
|---|---|---|
| 1 hour earlier | +2.3 to +4.6 points, every rule worse | +0.09 to +0.50, every rule worse |
| as the app scores it | +1.2 to +3.5 | +0.04 to +0.40 |
| 1 hour later | +0.6 to +2.6, every rule worse | +0.002 to +0.29, every rule worse |
| 2 hours later | LF3 and LF6 −0.33; the other eight +0.8 to +1.4 | LF3 −0.030, LF6 −0.024; the other eight +0.04 to +0.20 |

So the disadvantage of the mild rules shrinks steadily as the truth is taken later, and at two hours it turns into a small advantage for LF3 and LF6 (no interval was computed for the shifted tables). On the large rises the same drift is stronger. If the app's travel time runs short on steep rises, which an earlier study suspected for October 2026, part of what is scored here as "too high" is "too early". This study bounds that effect; it does not measure the real arrival time.

## 9. A fact that points the other way (description only)

The 110% cap was in the study as a reference, never as a candidate. Against today's cap, 2020 to 2026: overall error −0.16 points [−0.22, −0.10]; badly off on rising water −2.6 points [−3.9, −1.4]; on the rising limbs of the large rises +1.7 points of error [0.5, 2.9] and 52% of hours badly low (intervals by the auditor). The design years show the same pattern. So on an average hour a tighter cap scores better, and on the large rises it scores worse. Nothing here was set up to test a tighter cap, and this report does not say a tighter cap is better.

## 10. What this study cannot show

- Only these ten looser rules were tested. It does not follow that no cap rule can help on rising water, nor that 120% is the best factor.
- The replay's Little Falls reading is one hour old; the app's is 10 to 70 minutes old. The live cap is a little fresher than the one studied.
- The Little-Falls-led rises: of the 21 large rises only one is of that kind (October 2026, 37 hours, on readings USGS has since revised). On that single rise the looser rules do score better than the cap. One rise on revised readings carries no conclusion and its numbers are not quoted here (auditor's ruling); it is named so that it is not hidden. It is also the rise that prompted the question.
- The large-rise intervals rest on about 10 and 14 months with data and are likely too narrow.
- Percent errors count a 15% miss at 1,000 cfs like one at 50,000 cfs.
- The timing tables keep the hours scored at the app's truth time and do not recompute the data-quality flags for a shifted truth.
- Some 2026 readings in the input are not today's approved record (section 2).

## 11. Expectations against outcomes

Written before the run (`PLAN.md` section 14): the cap does a good job on capped hours (it does); "unclear" on Little Falls rising hours and on the large rises (wrong for the first, right only for the design large rises); N, RIS, ICE and F200 do not qualify (right); quite possibly no candidate qualifies (right); KEEP the most likely verdict (right). Version 1 of the plan had expected "unclear" or "better rule found"; that expectation rested on the one-sided measure the plan audit removed.

Mistakes of the orchestrator in this study, all caught before any result: the one-sided benefit measure of plan version 1 (plan audit); a count for rule MR that was narrower than the rule's own words (specification review).

## 12. What follows

- **The cap stays as it is.** No build, no version.
- **Not recommended now:** a study of a tighter cap. The description suggests it would gain on average hours and lose on large rises, which are the hours the owner cares about.
- **Open, on the owner's word (already on the list):** score the rise that began on 2026-11-26 from the app's own log once it has passed. It would show, for one rise with a fresh Little Falls reading and a stored forecast, how the cap and these rules did. One rise is description.
- The lever for large rises is the estimate before the cap (its overshoot and its timing on rising limbs), which two earlier studies tried to improve without success. This study adds nothing to that question except the size of the problem: about 43% of rising-limb hours badly low with the cap, about 30% badly high without it.

## 13. Files

`PLAN.md` (version 2 with notes), `PLAN_v1.md`, `PLAN_AUDIT.md`; `ANALYSIS_SPEC.md` (1.2; 1.0 and 1.1 kept), `SPEC_REVIEW.md`; `py/` and `r/` (script, 14 output files, README and REPORT each); `tools/compare_analysts.py`; `RESULTS_AUDIT.md`; this report. Inputs: the two replay files of the onset study (rebuildable, see `analysis/onset_correction_2026-11-25/replay_README.md`), the replay's hourly input file and the rise list in `analysis/rising-limb-travel-backtest/`.

# Report: what the measured clock would do (step 1 of the clock build)

2026-11-27. A description by replay over 15 years. Nothing in the app was changed. Plan: `PLAN.md` (version 2, with the owner's yes in section 11). Verified: tool audit (`TOOL_AUDIT.md`), specification with two review passes (`ANALYSIS_SPEC.md` 1.2, `SPEC_REVIEW.md`), two analysts whose eleven output files are identical byte for byte (`py/`, `r/`), and a third auditor who rebuilt every table with his own code and matched 10 hourly Little Falls values against the public USGS service (`RESULTS_AUDIT.md`: pass with notes). Numbers below are for the test years 2020-01-01 to 2026-11-09 unless said.

## In one paragraph

Scoring the app at the measured travel time changes little of what the owner cares about. About one reading in five is badly low when Little Falls is rising, under today's clock and under the measured one. The shown number moves by less than half a percent on average. The learning stays healthy. So the clock is not the cure for readings that are too low on a rise. The replay did show something else, and it matters more: over all hours, simply showing the latest Little Falls reading would have scored closer than the app, and "Little Falls now plus its recent rise" cuts the badly-low readings on rising water from about one in five to about one in twenty-five. That is a description inside this replay, with a built-in advantage for anything based on Little Falls, and not a tested design.

## What this replay cannot show (read first)

1. **It cannot show that the new clock is better.** The plan said so before the run. The case for the measured clock is the clock study, not this replay.
2. **The staircase.** In both runs the moment actually scored sits on the replay's hourly grid: the scored lag is always a whole number of hours plus 0.82 hours, between 0.18 hours earlier and 0.82 hours later than the formula. The three "common truths" used to compare the runs do not have this; they are read at the exact times (the measured clock, its long end, its short end).
3. **The main table leans toward the new clock by the way it is built.** The new run learned against a truth that sits next to the central common truth. Below 20,000 cfs all three common truths lie on the new clock's side of today's clock.
4. **The truth is Little Falls itself, some hours later.** Anything that starts from the Little Falls reading has a built-in advantage against such a truth. Creek water that joins below Great Falls is in the reading and in the truth alike, although it never passed the falls. The creek look (`analysis/creek_look_2026-11-27/`) is about exactly this.
5. **Not covered:** creek-fed rises as such, flows above 20,000 cfs (the clock is held at 2.0 hours there and is often longer than today's), flows below 1,400 cfs. The replay uses hourly values with readings one to two hours old; the live job has fresher readings.

## 1. The owner's concern: readings that are badly low while Little Falls is rising

Badly low means 15% or more below the truth. Rising means the Little Falls reading the model holds is at least 10% above the one six hours earlier (about 4,400 hours in the test years).

| Truth | Today's clock | Measured clock | Difference | Interval of the difference |
|---|---|---|---|---|
| Central | 21.4% (943 of 4,397) | 20.6% (906) | −0.8 points | −2.0 to +0.2 |
| Long end | 22.5% (992 of 4,412) | 21.7% (956) | −0.8 points | −2.2 to +0.5 |
| Short end | 19.0% (837 of 4,403) | 17.3% (763) | −1.7 points | −3.0 to −0.4 |

- **The difference cannot be told apart from zero** on the central and long-end truths. Only on the short-end truth does the interval stay below zero. The intervals are the third auditor's addition (resampling of calendar months); the specification asked for none on this table.
- In the years 2012 to 2019 the share is about 15.6% for both runs (684 against 688 of 4,395 on the central truth; long end 731 against 749; short end 549 against 549).
- On a truth read at today's clock the difference is zero.
- **Reading:** the replay shows no clear reduction and no clear increase of badly-low readings on rising water.

## 2. How far the shown number moves

- All hours: +0.4% on average (median +0.3%); 90% of hours lie between −4.2% and +5.4%; 9.5% of hours move by 5% or more.
- Little Falls rising: no average shift (−0.01%); slightly more hours move down than up (2,047 against 1,794; 673 do not move, nearly all of them held by the cap in both runs); one hour in five moves by 5% or more, in either direction (−7.7% to +8.4%).
- Low water: +0.7% on average. High water: +0.2%, and under 3% of hours move by 5% or more.
- The rising limbs of the 13 large rises: −0.9% on average.
- The plan's expectation that the number would read "a few percent lower" on rising water did not come out.

## 3. Error against the common truths, all hours

Mean absolute error, today's clock against the measured one: 5.1% against 4.8% (central truth), 5.2% against 5.0% (long end), 5.2% against 4.7% (short end). The average signed error goes from −0.3% to 0.0%. This comparison carries the lean of point 3 above and is not evidence that the new clock is better. On the rising limbs of the large rises the new run is not better: badly-low readings are 24.8% against 25.2% (central), 29.4% against 29.9% (long end), 12.2% against 14.4% (short end).

## 4. What the app would say about itself

- **It scores itself more often:** 6.5 scored estimates a day against 3.9 (1.67 times, not twice).
- **The share of scored estimates that are 15% or more low** falls from 3.4% to 3.0%, but their number per day rises from 0.13 to 0.20, because more is scored. So it cannot be said that the "trust it less" note would switch on less often; its real rule was not replayed.
- **The 90% band** holds 86.2% of the truths against 84.8%. A shorter horizon is easier, so this says little about the band.

## 5. Health of the learning

All four stop rules pass with room (the largest ratio of the new run to today's is 1.15 against a limit of 1.5). Per stored estimate: missed scoring windows 0.35% against 0.32%, retries 1.04% against 0.93%, estimates skipped by the data checks 0.17% against 0.16%. The hour-to-hour change of the correction grows a little (99th percentile 11.1% against 9.7%; jumps of 5 points or more 2,195 against 2,043). The cap holds the number on 3.8% of hours against 4.3%. The limits of these rules were set by the orchestrator after the tool's counts were known (plan section 13).

## 6. The cap, inside the new run

In the test years the cap brings the shown number closer to the truth on every group and on all three truths (rising hours, central truth: mean absolute error 10.7% with the cap, 13.5% without). In 2012 to 2019 the same holds except at low water, where the reading is unclear on two of the three truths. **The cap can only lower the number, so it never removes a reading that is too low; it adds some:** 906 badly-low rising hours with the cap, 840 without.

## 7. The finding that matters more than the clock: two simple yardsticks against the app

Inside the new run the app was set beside two yardsticks: **"Little Falls now"** (Great Falls equals the latest Little Falls reading) and **"Little Falls now plus its rise"** (that reading plus its rise of the last three hours, carried forward over the travel time; never below the reading).

| Hours (test years, central truth) | App | Little Falls now | Little Falls now plus its rise |
|---|---|---|---|
| All hours, mean absolute error | 4.8% | 3.5% | 3.9% |
| All hours, badly-low readings (of 59,368) | 2,166 | 1,355 | 762 |
| Little Falls rising, mean absolute error | 10.7% | 9.7% | 12.2% |
| Little Falls rising, badly-low readings (of 4,397) | 906 | 608 | 157 |
| Rising limbs of all rises (2,948 hours), mean absolute error | 11.2% | 8.9% | 7.7% |
| Rising limbs of the large rises (452 hours), mean absolute error | 14.5% | 14.0% | 11.0% |
| 20,000 cfs and above (4,480 hours), mean absolute error | 2.5% | 3.6% | 2.9% |

- **Over all hours both yardsticks are closer than the app, on all three truths, in the test years and in 2012 to 2019.** The plan expected the reverse.
- **On rising water the yardstick with the rise almost removes the badly-low readings** (157 against 906 on the central truth; 203 against 956 on the long end; 34 against 763 on the short end). Its average error on rising hours is not smaller than the app's (12.2% against 10.7% on the central truth), because it overshoots. On the rising limbs of the rises it is closer than the app on all three truths.
- **Where the app is closer:** at 20,000 cfs and above, on the central and long-end truths.
- **The limits, which are large:** the truth is the same gauge a few hours later, so a yardstick built on that gauge starts with an advantage; creek water below the falls helps it further; the live readings are fresher than the replay's; and a yardstick in a description is not a tested design. This is a lead, not a result to build on yet.

## 8. Expectations written before the run that did not hold

"Moves less than 1% on most hours" (48.5% of hours in the test years). "Reads lower by a few percent on rising water" (no average shift). "Badly-low goes up on the long-end truth" (down, within noise). "About twice as many scored per day" (1.67 times). "The yardstick with the rise beats the app on rising hours" (mixed in the test years). "Over all hours the app beats both yardsticks" (the reverse). "The note switches on less often" (true as a share, false as a count). Held: higher on recessions; the correction's change grows a little; the cap is closer on all three truths; more truths inside the band.

## 9. What may not be said from this replay

That the new clock reduces badly-low readings; that it is better or more accurate; that the cap protects against reading low; that the note would switch on less often; that the band is better calibrated; that scoring doubles; that the number reads a few percent lower on rising water; anything about creek-fed rises, flows above 20,000 cfs or below 1,400 cfs.

## 10. The owner's choice (step 2 of the plan), with the orchestrator's recommendation

- **(a) A log-only release:** the hourly job stores and scores on both clocks; nothing shown changes. A minor version.
- **(b) The change itself:** a major version. The replay shows it is safe for the learning and moves the shown number little. Its real gain is that the app's own scoring would compare each estimate with the river at the right moment. It does not cure readings that are too low on a rise.
- **(c) Nothing.**

**Recommendation: decide after the creek look, and do not ship (b) as a fix for the low readings.** The reasons: the clock change does not move the owner's main concern; the lead of section 7 points to a different cure (leaning on Little Falls now and its rise), and whether that lead is real depends on how much of a rise at Little Falls never passed Great Falls, which is the creek look's question. If the creek look confirms the lead, the next step is a plan for a proper study of it, and a log-only release could then log everything needed in one go.

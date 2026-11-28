# Plan: creek-fed rises and the truth at Little Falls

Plan version 1, 2026-11-27. Draft for the independent audit. Nothing is computed before the audit, the rulings on it and the owner's confirmation of the method.

On the owner's word of 2026-11-27: "look at the creeks", and "make sure not to make mistakes again". Facts: `FACTS.md` in this folder (every number below that is called a fact comes from it).

## 0. What the owner should know first

- **The question.** The app is scored and trained against the Little Falls gauge. Creeks that join the river below Great Falls put water into Little Falls that never passed the falls. On a creek-fed rise Little Falls then reads above the river at Great Falls, and the app looks low even where it is right about the falls.
- **What this look gives.** A measurement with a range: how much of the Little Falls flow came in below the falls, on 26 and 27 November and over 15 years; and the app's number judged against Little Falls with that water taken off.
- **The weak spot, stated first.** There is no gauge at Great Falls. Of the land that drains to the river between the falls and the Little Falls gauge (at most 130 square miles), 46% is gauged: Difficult Run (57.8 square miles) and tiny Dead Run (2.05). Cabin John Creek (26), Rock Run, Scott's Run and the rest have no flow gauge. Their water is scaled from Difficult Run. So every result is a range, from "only the measured creek" to "all that land, scaled up", and it is only as good as that range.
- **Two kinds of creek water, not to be mixed.** (i) Below the falls: it spoils the truth, and the app is right to ignore it. This look measures it. (ii) Between Edwards Ferry and the falls, without a gauge (Sugarland Run, Muddy Branch, Watts Branch and others): it does pass the falls and the app cannot see it. This look does not measure it. What is left of the app's miss after (i) is taken off is the upper limit of (ii) and of everything else.
- **Nothing in the app changes.** No inflow term (the standing decision of 2026-07-10 and 2026-07-20 holds). Whether the app should later be scored against a truth without the creek water is a separate decision with its own plan (TODO row A5).
- **Not new ground.** A short check on 2026-11-10 found that taking Difficult Run off the truth moved the bias at the start of rises from about −31% to −22% (decision brief A5). This look does that properly, with the ungauged land, a range, and two analysts.

## 1. Questions

1. **The event.** Hour by hour on 25 to 28 November 2026: how much of the Little Falls flow came in below the falls, what was the flow at the falls (as a range), and how far was the app's shown number from it?
2. **How common.** Over the record (December 2012 to 9 November 2026): how large is the below-falls water as a share of Little Falls: on ordinary hours, on hours when Little Falls is rising, on creek-fed rises? How often is it 5%, 10%, 20% or more?
3. **Judging the app.** How does the app's record change when the truth is Little Falls minus the below-falls water? In front: the share of readings that are badly low on Little Falls rising hours. Of the hours that read badly low against Little Falls, how many are no longer badly low, and how many hours become badly high?

## 2. Definitions

**The below-falls water arriving at the Little Falls gauge at time τ:** `B(τ) = k × DR(τ − ℓ)`, with `DR` the flow at the Difficult Run gauge (USGS 01646000).

- **`k`, the scaling from Difficult Run's land to all the land below the falls.** Three values:
  - floor `k = 1.0`: only the measured creek. This part is certain.
  - central `k = 2.0`: about 116 square miles. The creeks with a known area sum to at least 95 (Difficult Run 57.8, Cabin John 26, Rock Run 4.8, Scott's Run 4.67, Dead Run 2.05, the last three at their gauges, so at the mouth they are larger); several small creeks and the gorge slopes have no known area; the ceiling is 130.
  - ceiling `k = 2.25`: 130 square miles, the area between the USGS point "Potomac River near Potomac, MD" (above the falls) and the Little Falls gauge. As an area this is an upper limit.
  - **The ceiling is a ceiling for area, not for runoff.** The creeks without a gauge are more built-up than Difficult Run and may shed more water per square mile. Check A3 below measures this on the event with Dead Run. If Dead Run sheds much more per square mile than Difficult Run, the report says that the ceiling may be too low.
- **`ℓ`, the time from the Difficult Run gauge to the Little Falls gauge:** 1, 3 and 5 hours, central 3. Basis: the clock study's four usable Difficult Run pulses reached Little Falls after 0.9, 3.3, 3.4 and 3.5 hours. The creeks nearer to Little Falls arrive sooner and peak earlier; the 1 hour value stands for that.
- **`c`, the time from Great Falls to Little Falls** (when the water the app describes reaches the gauge): the measured clock of the clock study, `clock(Q) = 98.2 × Qc^−0.3935` hours, with its long end (`1.23 ×`) and short end (`0.30 ×`), read at exact times, as in the clock build (plan section 12 there).
- **Two truths for an estimate made at hour t:** `T_LF = LF(t + c)`, and `T_falls = LF(t + c) − B(t + c)`. An hour without the needed Difficult Run value is dropped and counted. Hours where `B` is 90% or more of Little Falls are counted and listed, not hidden.
- **Cases:** central (`k` 2.0, `ℓ` 3, central clock); floor (`k` 1.0, `ℓ` 3, central clock); and the envelope: the smallest and largest value over all 27 combinations of `k`, `ℓ` and `c`. Every table gives floor, central and envelope.
- **The app's number.** For the record: the shown value (after the correction and the cap) of the replay of today's app, run OLD (`analysis/onset_correction_2026-11-25/replay_L/shadow_L.csv`). For the event: the value the hourly job logged at each run (`tick_log`, `final.cfs`), with the uncapped value, the cap and the Little Falls reading it held; extracted read-only by the orchestrator, with the query saved beside the file.
- **Errors:** percent error `(shown − truth) / truth × 100`; badly low at −15% or below; badly high at +15% or above (as in the cap study).
- **Hours and groups** (test years 2020-01-01 to 2026-11-09 in front; 2012-12 to 2019 beside): all hours with an estimate and a truth; Little Falls rising (the reading the model holds is at least 10% above the one 6 hours earlier, as in the clock build); the rising limbs of the large rises, split by the clock study's creek share; and "creek hours", where the central `B` is at least 10% of Little Falls at the truth time.

## 3. What is reported

**Part A, the event (5 and 15 minute public readings of 24 to 28 November, all provisional):**
- A1. One row per hourly run of the app from 25 November 18:00 UTC: Little Falls then and at `t + c`; Difficult Run; `B` (floor, central, ceiling) and its share of Little Falls; the flow at the falls it implies (range); the app's shown number; its error against Little Falls and against the flow at the falls (floor, central, envelope); whether the cap was holding the number.
- A2. By volume: of the rise at Little Falls (above its starting flow, 26 November 12:00 UTC to 28 November 00:00 UTC), the share that came in below the falls (floor, central, ceiling).
- A3. The check on `k`: water shed per square mile by Dead Run against Difficult Run over the storm.
- A4. Times of the peaks of each series.

**Part B, the record:**
- B1. The share `B / LF`: median, mean, 90th and 99th percentile, and the share of hours at 5%, 10%, 20% or more; per group; floor, central, ceiling.
- B2. The app against `T_LF` and against `T_falls`: mean absolute error, mean signed error, share badly low, share badly high; per group; floor, central, envelope; with intervals for the differences by resampling calendar months.
- B3. A transition table on Little Falls rising hours and on creek hours: of the hours badly low against Little Falls, how many stay badly low, come within 15%, or turn badly high against the flow at the falls; and of the hours within 15% against Little Falls, how many turn badly high.
- B4. The long-run level: the mean of `B / LF` over all hours, which is the average amount by which Little Falls overstates the falls and which the app's learned corrections already carry.
- B5. How common an event like 26 and 27 November is: the number of rises (the clock study's list) on which the central `B` makes up at least 10%, and at least 25%, of the volume of the rise.

## 4. How the result will be read (fixed before the numbers)

On Little Falls rising hours of the test years, take the hours that read badly low against Little Falls and ask what share of them is no longer badly low against the flow at the falls ("explained by water that never passed the falls"):
- **large** if that share is at least 25% in the floor case (measured creek only) on all three clocks;
- **small** if it is below 10% in the central case on all three clocks;
- **in between** otherwise, reported with its range and no label stronger than that.

The reading can come out any of the three ways. Whatever it is, the report also gives the other side in the same table: the hours that turn badly high.

## 5. What can make this wrong

1. `k` beyond the measured creek is an assumption, and one creek's rise stands for all the others. A storm cell can sit on Cabin John and miss Difficult Run, or the other way round. Over many storms this evens out; for one event it does not.
2. The ungauged creeks are smaller and more built-up, so they peak earlier and sharper than Difficult Run. The three values of `ℓ` cover part of this.
3. The Little Falls intake of the Washington Aqueduct (0 to about 43 cfs) lies between the falls and the gauge and is ignored. At 1,500 cfs that is up to 3%; at 5,000 cfs under 1%.
4. Hourly medians are used for the record; sharp creek peaks are flattened a little.
5. The event's readings are provisional and can be revised.
6. The app's corrections were learned against Little Falls with the creek water in it. Against the flow at the falls the app therefore leans slightly high at all times. B4 measures that lean.
7. The replay is not the live app (hourly values, readings one to two hours old).
8. This look says nothing about the app's blindness to ungauged creeks above the falls, and it is no test of any change to the app.

## 6. Expected outcomes, written before the run (guesses, to be compared afterwards)

- Over all hours the central `B` is 1 to 2% of Little Falls at the median, and 10% or more on a few percent of hours.
- On Little Falls rising hours below 6,000 cfs it is often 10% or more.
- 26 and 27 November: the central `B` peaks near 3,000 cfs around midnight UTC, a third to a half of Little Falls at that time. Against the flow at the falls the app's early misses shrink strongly, and some hours turn too high.
- In the record, the share of badly-low readings on Little Falls rising test hours falls by a fifth to a third in the central case; the reading of section 4 comes out "in between".

## 7. Data

- On hand: the hourly record (`analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv`); Difficult Run hourly, 2011-12 to 2026-11-09 (`analysis/clock_study_2026-11-27/data/difficult_run_hourly.csv`); the replay run OLD; the clock study's list of rises with creek shares (`py/units.csv`); the event pull of this folder (`data/event_15min.csv`, ten series, with its script and raw answers).
- To extract: the hourly job's log rows of 25 to 28 November (read-only, saved with the query).
- Not on hand and not planned: the long record of Dead Run (it would take hours to download and covers 2 square miles). No other creek below the falls has a flow gauge.

## 8. Verification and roles

Plan audit (independent). Rulings and plan version 2. The owner's confirmation of the method. Specification (with the definitions of the clock build's specification reused word for word where they apply) and its independent review. Two analysts who cannot see each other (Python, R); a compare tool; a third auditor with his own implementation of the central case and at least five readings checked against the public USGS service. Then the report, leading with the weak spot.

Orchestrator: plan, rulings, the log extract, synthesis. Specification and both analysts: Sonnet. Plan auditor, specification reviewer, third auditor: Opus.

## 9. Questions put to the plan auditor

1. Is `T_falls = LF(t + c) − k × DR(t + c − ℓ)` the right first-order construction? What does it miss (the intake, the flattening of a creek pulse on its way down, storage, anything else), and does any of it bias the result in one direction?
2. Are the three values of `k` defensible from the fact sheet? Is 130 square miles truly an upper limit for the land below the falls? Is the runoff-per-square-mile worry handled well enough by check A3, or should the long record of Dead Run be downloaded and used?
3. Are the three values of `ℓ` right, given four pulses and creeks that enter nearer to the gauge?
4. Is it right to time the truth with the measured clock and its two ends? Should the app's own clock be shown beside, since that is what the app's own scoring saw?
5. Is run OLD's shown value the right number to judge? Should the uncapped value be judged beside it?
6. Section 4: can the reading fail in every direction? Are 25% and 10% sensible, or is the rule better dropped in favour of numbers only?
7. The group "creek hours" is defined by `B` itself. Is anything circular in how it is used?
8. Could this look make the app appear better than it is? Name every route (a `k` that is too high hides real misses; the blindness above the falls stays), and say how the report must guard against each.
9. The overlap with the decision brief of 2026-11-10 (A5) and with the standing decision against an inflow term: is the scope right? Is there a smaller look that answers the owner's question, or something essential missing?
10. The strongest argument against doing this at all.

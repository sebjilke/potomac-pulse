# Plan: creek-fed rises and the truth at Little Falls

Plan version 2, 2026-11-27. Version 1 is kept as `PLAN_v1.md`. The independent audit is `PLAN_AUDIT.md` (verdict "proceed after changes": 2 blockers, 6 major and 3 minor findings). Section 10 holds the ruling on each. Nothing is computed before the owner's confirmation of the method (section 11).

On the owner's word of 2026-11-27: "look at the creeks", and "make sure not to make mistakes again". Facts: `FACTS.md` in this folder.

## 0. What the owner should know first

- **The question.** The app is scored and trained against the Little Falls gauge. Creeks that join the river below Great Falls put water into Little Falls that never passed the falls. On a creek-fed rise Little Falls then reads above the river at Great Falls, and the app looks low even where it is right about the falls.
- **What this look gives.** A measurement with scenarios: how much of the Little Falls flow came in below the falls, on 26 and 27 November and over 15 years; and the app's number judged against Little Falls with that water taken off.
- **The weak spot, stated first.** There is no gauge at Great Falls. Of the land that drains to the river between the falls and the Little Falls gauge (at most about 130 square miles), 46% is gauged: Difficult Run (57.8 square miles) and tiny Dead Run (2.05). Cabin John Creek (26), Rock Run, Scott's Run and the rest have no flow gauge. Their water is scaled from Difficult Run by area. **Area is a poor guide to water:** in the storm of 26 November neighbouring gauged creeks shed between 89 and 453 units of water per square mile, a fivefold spread (auditor's rough count). So the result that can be trusted most is the one from the measured creek alone. The scaled-up cases are scenarios, not bounds.
- **What version 1 got wrong, and the audit caught.** Scaling Difficult Run up by two and shifting it as one block gave a flow at the falls of about 900 to 1,100 cfs in the night of 26 to 27 November, below the 1,640 cfs the river carried before the storm, while every creek above the falls was rising. That cannot be. Version 2 has checks that can fail and that throw such a case out.
- **Two kinds of creek water, not to be mixed.** (i) Below the falls: it spoils the truth, and the app is right to ignore it. This look measures it. (ii) Between Edwards Ferry and the falls, without a gauge (Sugarland Run, Muddy Branch, Watts Branch and others): it does pass the falls and the app cannot see it. This look does not measure it. What is left of the app's miss after (i) is taken off is a residual. It contains (ii), errors of every other kind, and the error in (i) itself. It is not a bound on (ii).
- **Nothing in the app changes.** No `k`, lag or share from this look is a proposal for the estimate or the learning. The standing decision against an inflow term holds. This look does not choose the lag of TODO row A5, does not apply that row's proposed gate, and is not the A5 backtest (that needs a run trained against the new truth).
- **Not new ground.** A short check on 2026-11-10 found that taking Difficult Run off the truth moved the bias at the start of one rise, in October 2026, from about −31% to −22% (decision brief A5, a single event).

## 1. Questions

1. **The event.** Hour by hour on 25 to 28 November 2026: how much of the Little Falls flow came in below the falls, what was the flow at the falls (per scenario), and how far were the app's shown number and its number before the cap from it?
2. **How common.** Over the record (December 2012 to 9 November 2026): how large is the below-falls water as a share of Little Falls: on ordinary hours, on hours when Little Falls is rising, on creek-fed rises? How often is it 5%, 10%, 20% or more?
3. **Judging the app.** How does the app's record change when the truth is Little Falls minus the below-falls water? In front: the readings that are badly low on Little Falls rising hours. How many of them come within 15% of the flow at the falls, how many turn badly high, and how many hours that were fine turn badly high?

## 2. Definitions

**The below-falls water arriving at the Little Falls gauge at time τ, in two parts with their own timing:**

`B(τ) = DR(τ − ℓ_DR) + (k − 1) × N(τ − ℓ_N)`

- `DR` is the flow at the Difficult Run gauge (USGS 01646000): measured water.
- `N` stands for the creeks without a gauge. On the record `N` is Difficult Run's own flow. On the event there is a second view in which `N` has the shape of Dead Run (the only fast, built-up creek with readings), scaled so that its storm volume equals Difficult Run's.
- **Timing, tied to the clock:** `ℓ_DR = (7.3 / 9.1) × c` and `ℓ_N = (2.3 / 9.1) × c`, where `c` is the Great Falls to Little Falls time used for the truth (below), 9.1 miles is Great Falls to the gauge, 7.3 miles the mouth of Difficult Run to the gauge, and 2.3 miles the mouth of Cabin John Creek to the gauge (towpath mileposts, good to about half a mile).
- **`k`, three scenarios of area (not bounds on water):** floor `k = 1.0`, the measured creek alone, measured up to its timing; central `k = 2.0`, about 116 square miles; ceiling `k = 2.25`, 130 square miles, which includes some land above the falls and is good to about 10 square miles either way.
- **`c`, three clocks:** the measured clock of the clock study, `clock(Q) = 98.2 × Qc^−0.3935` hours (`Qc` = the Little Falls flow the estimate holds, kept inside 1,400 to 20,000 cfs), its long end (`1.23 ×`) and its short end (`0.30 ×`), read at exact times.
- **Sensitivity only:** the version 1 timing, one fixed lag of 1, 3 or 5 hours for all of `B`, at the central clock, for `k` 1.0 and 2.0.
- **Where a value sits in time.** Record: hourly medians are placed at the start of the hour plus 22.5 minutes and read by linear interpolation, with the replay tool's rule when a neighbour is missing (as in the clock build). This holds for Little Falls and for Difficult Run. Event: the 5 and 15 minute readings are read by linear interpolation at their own time stamps.
- **Two truths for an estimate made at time t:** `T_LF = LF(t + c)` and `T_falls = LF(t + c) − B(t + c)`.
- **Checks that can fail (they decide what may be reported):**
  - *Floor, per row:* `T_falls` must be at least the lowest Little Falls value of the 24 hours before the truth time. A row that breaks it is counted, listed, and can never count as "explained".
  - *Floor, event:* a scenario whose `T_falls` lies below the flow before the storm (Little Falls at 26 November 12:00 UTC) for more than 60 minutes in total between 26 November 12:00 and 28 November 00:00 UTC is reported as **refuted for the event** and is not part of any range.
  - *Volume, per rise:* over a rise, the volume of `B` must not exceed the volume of the Little Falls rise minus the volume of the gauged creeks above the falls (Seneca, Broad Run). Each volume is the sum over the window of the amount above the value at the window's first hour, never below zero, with no time shift. The number of rises that break it is reported per scenario.
  - *Impossible rows:* a row with `T_falls` at or below zero is left out of every error statistic and listed.
- **The app's number.** Record: the shown value (after the correction and the cap) of the replay of today's app, run OLD (`analysis/onset_correction_2026-11-25/replay_L/shadow_L.csv`), and beside it the value before the cap, as the cap study's specification defines it; hours where the cap holds are flagged. Event: from the hourly job's log, `final.cfs` (shown), `corr.unc` (before the cap), `ceil.lim` and `ceil.bound` (the cap and whether it holds), `in.lf.q` and its time, `in.dr.q` and its time, and `due` (the app's own scoring time). The extract is `data/tick_log_event.csv` (64 runs, 25 November 12:01 UTC to 28 November 03:01 UTC), saved with its query; its MD5 equals the one computed in the database.
- **Errors:** percent error `(number − truth) / truth × 100`; badly low at −15% or below; badly high at +15% or above; within otherwise.
- **Hours and groups** (by the time of the estimate; test years 2020-01-01 to 2026-11-09 in front, 2012-12 to 2019 beside): all hours with an estimate and both truths; **Little Falls rising** (the reading the model holds is at least 10% above the one 6 hours earlier); **falls rising** (the central `T_falls` is at least 10% above the central `T_falls` of the estimate 6 hours earlier), as a second view, because the first group is picked on a reading that the creek water itself raises; **creek hours** (`DR(τ − ℓ_DR) / LF(τ)` at least 5% at the central clock; free of `k`); the rising limbs of the large rises, split by the clock study's creek share.
- **The creek effect is always a paired difference at one clock:** the same hours, the same clock, against `T_falls` and against `T_LF`. A separate column, labelled "creek and clock together", gives the smallest and largest value of each reported statistic over the nine cases (three scenarios times three clocks).

## 3. What is reported

**Part A, the event (public readings of 24 to 28 November, all provisional; a later USGS revision can move every number):**
- A1. One row per hourly run of the app from 25 November 18:01 UTC, for each clock as far as the readings reach: Little Falls at the run and at `t + c`; Difficult Run; `B` per scenario and its share of Little Falls; the flow at the falls per scenario, with the floor flag; the app's shown number and its number before the cap, with the cap flag; the errors of both against Little Falls and against the flow at the falls; and, beside, the truth the app's own clock (`due`) would use. "Rising" on these rows: the Little Falls reading of the run is at least 10% above that of the run 6 hours earlier.
- A2. By volume: of the rise at Little Falls above its flow at 26 November 12:00 UTC, the share that came in below the falls, per scenario, for two window ends (27 November 12:00 and 28 November 00:00 UTC), because Little Falls was still high at the later end. Creek bases are their flows at 26 November 12:00 UTC.
- A3 (a footnote, not a result): water shed per square mile by Dead Run, Difficult Run, Seneca and Broad Run from 26 November 00:00 to 28 November 00:00 UTC, above their flows at the start.
- A4. Times of the peaks of each series.
- A5. Which scenarios are refuted for the event (the floor check), under the two-part timing and under the Dead Run shape.

**Part B, the record:**
- B1. The share `B / LF` at the truth time (central clock): median, mean, 90th and 99th percentile, and the share of hours at 5%, 10%, 20% or more; per group; floor, central, ceiling.
- B2. The app's shown number and its number before the cap, against `T_LF` and against `T_falls`: share badly low, share badly high, mean signed error; per group, scenario and clock. Intervals for the paired differences by resampling calendar months (2,000 resamples, 2.5th to 97.5th percentile, the shared-draws method of the earlier studies), for the floor and central scenarios at the central clock.
- B3. The transition table, per scenario and clock, on Little Falls rising hours, falls rising hours and creek hours: of the hours badly low against Little Falls, how many stay badly low, come within 15% and pass the floor ("explained"), come within 15% but break the floor, or turn badly high; and of the hours within 15% against Little Falls, how many turn badly high. On creek hours every table carries the line: "the change on these hours is large by construction; it shows how much, not whether."
- B4. The long-run level: the mean of `B / LF` over all hours, which is the average amount by which Little Falls overstates the falls and which the app's learned corrections already carry.
- B5. How common an event like 26 and 27 November is: the number of rises (the clock study's list, windows as given there) on which `B` makes up at least 10%, and at least 25%, of the volume of the rise, per scenario; and the number of rises that break the volume check.
- B6. Two placebos, to show how much of any share is not creek water at all: the same tables with Difficult Run replaced (P1) by its median over the 30 days before, and (P2) by its own value 14 days earlier.

## 4. How the result will be read (fixed before the numbers)

On Little Falls rising hours of the test years, at each clock, take the hours that read badly low against Little Falls. The **explained share** is the part of them that comes within 15% of the flow at the falls and passes the floor. The **net share** is the explained share minus the larger of the two placebo shares.

- **large** if the net share is at least 25% in the floor scenario (measured creek only) on all three clocks;
- **small** if the net share is below 10% in the central scenario on all three clocks;
- **in between** otherwise, reported with its numbers and no stronger label.

The thresholds are those of version 1; they were not moved after the audit's rough counts. Hours that turn badly high are their own row and never count as explained. The fixed-lag sensitivity (1, 3, 5 hours) is shown in the same table; if any of the three gives another label, the report says so in the same sentence as the label. The report gives the floor scenario first.

## 5. What can make this wrong

1. **The scaling beyond the measured creek cannot be tested by this look.** One creek's rise stands for all the others. A storm cell can sit on Cabin John and miss Difficult Run, or the other way round. Water per square mile varied fivefold between neighbouring creeks in one storm.
2. **Most of what the construction leaves out pushes one way: it makes the app look better on rising hours.** A pure shift of a sharp creek pulse puts too much water into the peak hours (the two-part timing and the floor check answer this in part); the 130 square miles include land above the falls; the Little Falls intake of the Washington Aqueduct, if it draws between the falls and the gauge, makes the computed falls flow slightly too low (0 to about 43 cfs; zero in autumn 2026).
3. The cap. Where the cap holds, the shown number is 120% of Little Falls and says nothing about the model; that is why the number before the cap is judged beside it.
4. Hourly medians flatten sharp creek peaks a little.
5. The event's readings are provisional.
6. On average the app leans slightly high against the flow at the falls, because its corrections were learned against Little Falls with the creek water in it. B4 measures that lean; the placebos take it out of the reading.
7. The replay is not the live app (hourly values, readings one to two hours old).
8. The Difficult Run gauge sits some way above the creek's mouth; that distance is ignored.
9. This look says nothing about the app's blindness to ungauged creeks above the falls, and it is no test of any change to the app.

## 6. Expected outcomes, as written in version 1 before the audit (frozen; not revised after the audit's rough counts)

- Over all hours the central `B` is 1 to 2% of Little Falls at the median, and 10% or more on a few percent of hours.
- On Little Falls rising hours below 6,000 cfs it is often 10% or more.
- 26 and 27 November: the central `B` peaks near 3,000 cfs around midnight UTC, a third to a half of Little Falls at that time. Against the flow at the falls the app's early misses shrink strongly, and some hours turn too high.
- In the record, the share of badly-low readings on Little Falls rising test hours falls by a fifth to a third in the central case; the reading of section 4 comes out "in between".

## 7. Data

- On hand: the hourly record (`analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv`); Difficult Run hourly, 2011-12 to 2026-11-09 (`analysis/clock_study_2026-11-27/data/difficult_run_hourly.csv`; no value missing at the needed times in the test years, about 600 hours missing before 2020 by the auditor's rough count); the replay run OLD; the clock study's list of rises with creek shares (`py/units.csv`); the event pull (`data/event_15min.csv`, ten series, with its script and raw answers); the log extract (`data/tick_log_event.csv` with `data/tick_log_event.sql`).
- Not on hand and not planned: the long record of Dead Run (2 square miles; small gain). No other creek below the falls has a flow gauge.

## 8. Verification and roles

Specification (the definitions of the clock build's specification reused word for word where they apply) and its independent review. Two analysts who cannot see each other (Python, R); a compare tool. A third auditor who: recomputes the floor scenario of A1 and the section 4 shares with his own code; checks that every refuted scenario is reported as refuted; checks the log extract against the event pull at five times (the Difficult Run and Little Falls readings the job held); and checks at least five readings against the public USGS service, among them two Difficult Run readings at the event's peak and two hourly medians of the record used by the floor scenario. Then the report, leading with the weak spot and the floor scenario.

The arithmetic is simple and two analysts will agree on it. The risk of this look lies in its assumptions; the checks that can fail (floor, volume, placebos) are the verification that matters, and the report shows their outcome before any result.

Orchestrator: plan, rulings, the log extract, synthesis. Specification and both analysts: Sonnet. Plan auditor, specification reviewer, third auditor: Opus.

## 9. What this look does not do

It does not change the app. It does not measure the creek water that enters above the falls. It does not decide whether the app should be scored against another truth. It does not test the scaling by area.

## 10. Rulings on the audit (`PLAN_AUDIT.md`)

| Finding | Ruling | Where |
|---|---|---|
| F1 (blocker): the scaled cases give an impossible flow at the falls on the event, and no check would notice | **Accepted.** A floor per row, a floor rule for the event that refutes a scenario, a volume check per rise, impossible rows left out and listed, and the two-part timing | 0, 2, 3 (A5, B5) |
| F2 (blocker): the reading rule counts hours that turn badly high as explained, has no placebo, hinges on the lag | **Accepted.** Explained means within 15% and above the floor; two placebos, and the rule runs on the net share; turned-high is its own row; the lag sensitivity is shown with the label. The thresholds are kept as written before the audit | 3 (B3, B6), 4 |
| F3: the range of `k` is a range of area, not of water | **Accepted.** "Scenarios of area"; the fivefold spread stated in section 0; the checks cap `k` from the data; the one-sided sentence about Dead Run is gone; the long Dead Run record is not fetched | 0, 2, 5, 7 |
| F4: one lag for all of `k × DR` mis-times both parts | **Accepted.** Two parts with timing tied to the clock; the Dead Run shape as a second view on the event; fixed lags as a sensitivity only | 2 |
| F5: the envelope mixes the clock with the creek | **Accepted.** The creek effect as a paired difference at one clock; a separate column for creek and clock together, defined on the reported statistics | 2 |
| F6: a false sentence about the residual | **Accepted.** Replaced by the auditor's wording | 0 |
| F7: the value before the cap must be judged beside the shown one; the log extract was unchecked | **Accepted.** Both numbers throughout; the fields named; the extract's MD5 equals the database's, and the third auditor checks it against the event pull; the app's own clock shown in A1 | 2, 3, 8 |
| F8: twelve definitions left to guess | **Accepted.** All twelve settled in sections 2 and 3 | 2, 3 |
| F9: "creek hours" are defined by the quantity under study | **Accepted.** Defined by Difficult Run over Little Falls, labelled as large by construction; a "falls rising" group added | 2, 3 |
| F10: wording and fact points | **Accepted**, including the freeze of section 6 | 0, 2, 5, 6 |
| F11: scope and the standing decisions | **Accepted.** The three statements are in section 0 | 0, 9 |
| The verification design (audit part C) | **Accepted.** The third auditor's tasks are extended; the resampling is limited to two scenarios at the central clock | 3 (B2), 8 |

The auditor's "strongest argument against" (the answer beyond Difficult Run rests on a scaling this look cannot test) is taken as the order of the report: the floor scenario first, the scaled cases plainly labelled as scenarios.

## 11. For the owner to confirm before anything is run

1. **The construction:** the flow at the falls is taken as Little Falls minus the creek water that joined below the falls; that water is Difficult Run as measured, plus the ungauged creeks scaled from it by area in three scenarios (measured creek only; about 116 square miles; 130 square miles).
2. **The order of trust:** the measured-creek result leads. The scaled scenarios are shown as scenarios, and any scenario that gives an impossible flow at the falls is thrown out and reported as refuted.
3. **The reading rule of section 4,** with its thresholds as written before the audit.
4. **Both numbers are judged:** what the app showed, and what it would have shown without the cap.

A plain yes confirms all four as written.

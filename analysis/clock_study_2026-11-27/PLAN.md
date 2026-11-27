# Clock study: how long does a change in flow take from Great Falls to Little Falls?

Plan version 2, 2026-11-27. Version 1 is kept as `PLAN_v1.md`. The independent audit is `PLAN_AUDIT.md` (verdict "proceed after changes": 2 blockers, 10 major and 5 minor findings). Section 12 holds the ruling on each. No analysis code is written before the owner's confirmation of the method (section 13).

Started on the owner's word of 2026-11-27 ("go"), after he said the app's number was off on the rise of 26 and 27 November, against the river itself and against the scoring in the locked section. Facts: `FACTS.md`. First look, not verified: `analysis/clock_first_look_2026-11-27/README.md`.

## 0. What the owner should know first

- **There is no gauge at Great Falls.** The time from Great Falls to Little Falls cannot be measured directly. This study measures the stretch that has a gauge at each end (Edwards Ferry to Little Falls, 25.7 miles, of which Great Falls to Little Falls is the last 9.1) and splits it by distance. **The split is an assumption. It is bounded here, not tested.** The stretch below Great Falls is steeper than the stretch above, so the split by distance gives the longest time that is plausible, and the true time is probably shorter.
- **One direct check on the ungauged stretch is added:** storm pulses of Difficult Run, which enters just below Great Falls.
- **The app's clock for this leg was never checked against data.** It is a 1961 dye measurement of how fast the water moves, times 0.80, with 25% of it assigned to this leg by assumption. A change in flow travels faster than the water.
- **The clock does not enter the number the app shows.** It decides when an estimate is scored and against which Little Falls reading, and so what the corrections learn from. It also sets the offset of the 48 hour forecast and a line in the header.
- **Changed from version 1: this study now only measures.** Scoring the app on the measured clock (the cap, the two yardsticks) moves into the build plan. Reason, from the audit: the estimates in the replay carry corrections learned on the old clock, and a shorter clock favours the cap and both yardsticks by construction. The build plan's replay learns on the new clock and can score all of them fairly (section 9).
- **A result here leads to a build plan, not to a build.**

## 1. Questions

1. How long does a change in flow take from Edwards Ferry to Little Falls, by flow, on rising water and at low water? As support: the same from Point of Rocks to Edwards Ferry and from Point of Rocks to Little Falls, and whether the two legs add up to the whole.
2. Is the time the same for the start of a rise, its steepest part and its crest?
3. What follows for Great Falls to Little Falls, with an honest range, and what does the direct check on Difficult Run say?
4. Is the app's clock too long, about right or too short?

## 2. What is known (sources in `FACTS.md`; distances from the plan audit)

1. **Where the clock is used.** `travelGFtoLF` sets `validationDue = now + travelGFtoLF` (`scheduled-update.js:972`, `:1117`). The truth is the last Little Falls reading at the first hourly run at or after the due time, if that run comes within 2.5 hours. The shown estimate does not depend on it.
2. **Which flow feeds it.** The multiplier starts from the current Little Falls flow. When the lookup of the past Point of Rocks reading does not converge (typical on a rise), it is replaced by the flow of that past reading. Up to 30% is taken off while Point of Rocks is rising.
3. **Where the numbers come from.** `T = 5174 × Q^−0.5963` hours for the reach from Point of Rocks to Little Falls (Searcy and Davis 1961, dye), times 0.80 since January 2026, 25% of it assigned to Great Falls to Little Falls ("an explicit unfalsifiable assumption", refit plan of June 2026).
4. **Earlier measurements, all on other pairs of gauges:** daily wave at about 1,500 cfs: 12.9 h from Point of Rocks to Edwards Ferry and 17.3 h from Edwards Ferry to Little Falls, where the app assumes 49 h for the whole reach; Edwards Ferry to Little Falls by levels: 12 h or more below 3,000 cfs, 7 h at 3,000 to 10,000, 4 h at 10,000 to 50,000; Point of Rocks to Little Falls: 38 to 7 h from lowest to highest flow against 60 to 6 h deployed; per rise mostly 8 to 17 h against 18 to 50 h modelled; first look: about 8 h from Edwards Ferry to Little Falls at 5,000 to 10,000 cfs.
5. **The river, by towpath mileposts and gauge positions** (plan audit, answer 1; lock mileposts sure, creek mouths within about half a mile): Point of Rocks gauge 48.2; Monocacy 42.2; Goose Creek about 31; **Edwards Ferry gauge 30.9**; Broad Run about 28 to 29; Seneca Creek 22.7; **Great Falls 14.3**; Difficult Run about 12.5; Cabin John Creek about 7.5; **Little Falls gauge about 5.2**. Legs: Point of Rocks to Edwards Ferry 17.3 miles; Edwards Ferry to Little Falls 25.7; Great Falls to Little Falls 9.1, a share of 0.36 (between 0.34 and 0.37); Difficult Run to Little Falls 7.4. Monocacy and Goose Creek enter above Edwards Ferry; 430 square miles drain in between Edwards Ferry and Little Falls, of which the gauged creeks cover 235 once Difficult Run is added.
6. **Data in hand.** The hourly record of 2011-12 to 2026-11-09 (`analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv`: hourly medians of the 15-minute readings, stamped at the start of the hour, standing for the hour's centre). The rise list (53 events, 33 small onsets). The replay's main run for the clock the app used hour by hour (`travelGFtoLF`).

## 3. Design in short

1. Step 0: fetch the Difficult Run record.
2. Measure the lag between two gauges unit by unit (a unit is one rise or one low-water week).
3. Relate the lag to flow, on all years; report the two halves of the record as a check of stability.
4. Split the lower leg by distance, with a one-sided range; narrow it with Difficult Run if that check is valid.
5. Compare with the clock the app used, by a rule fixed here.
6. Two blind analysts (Python, R), a compare tool, a third auditor who re-measures at least six rises, and the rise of 26 and 27 November, on 15-minute readings.

## 4. The measurement, frozen now

### 4.1 Series and pairs
- **Edwards Ferry to Little Falls (the pair the clock rests on):** Edwards Ferry stage against Little Falls stage, raw hourly values. Sensitivity: Edwards Ferry stage turned into a flow by the app's own relation (`126 × stage^2.46`) against Little Falls flow; and the logarithms of stage and flow.
- **Point of Rocks to Edwards Ferry, Point of Rocks to Little Falls (support):** flows (Edwards Ferry by the relation above).
- Hourly change = difference of two consecutive hours. Hours with a gap are left out; nothing is filled in.
- If the median lag of a flow class differs by more than 1 hour between the primary and a sensitivity version, the report says so and the range of the clock covers both.

### 4.2 Units
- **Start of a rising limb:** the last hour before the onset at which Little Falls is at its minimum of the 48 hours before the onset.
- **Rise units:** one per event of the rise list (its first onset, its peak). A small onset is a unit only if Little Falls rises by at least 30% from that start to its peak. Added for low flows: **bumps**, found in the hourly record by this rule: a Little Falls peak below 6,000 cfs that stands at least 40% above the minimum of the 48 hours before it, that minimum below 3,000 cfs, peaks at least 4 days apart, and not inside the window of an event or small onset.
- **Window of a rise unit,** in the downstream gauge's time: from 6 hours before the start to 6 hours after the peak. The upstream series is shifted, the window is not.
- **Recession windows:** from 6 hours before the Little Falls peak of an event to 72 hours after it, cut at the start of the next unit's window. Description only (4.5).
- **Low-water weeks:** calendar weeks (UTC, Monday to Sunday) with a median Little Falls flow below 3,000 cfs that overlap no rise or recession window.
- A unit is used for a pair when both series are present on at least 90% of its hours and at least 24 paired hours exist.
- For the bootstrap a unit belongs to one event: the one whose window it overlaps most.

### 4.3 The lag of a rise unit
- **Primary (XC):** the shift from 0 to 48 hours (0 to 72 for Point of Rocks to Little Falls and for bumps) at which the correlation between the upstream changes and the downstream changes is highest, refined by a parabola through that point and its two neighbours. The unit counts if the correlation is at least 0.6 and the maximum is not at either end of the range. Reported too: the share of units that pass, per class, and the class medians with the gate at 0.4, 0.5 and 0.7; and the share of lags within a tenth of an hour of a whole hour.
- **The parts of a rise:** the times at which each series first reaches 10%, 50% and 90% of its rise in the window (linear between hours), and the time of each crest. Lag = downstream minus upstream, for each. The clock stays on XC; the report says how far the start and the crest sit from it.

### 4.4 Rises fed by creeks
Creek share of a unit = (the sum over the window of each gauged creek's flow above its value at the window's start) × (local drainage ÷ gauged drainage), divided by the same sum for Little Falls. Lower leg: Seneca, Broad Run and Difficult Run, local drainage 430 square miles. Upper leg: Monocacy and Goose Creek, local drainage 1,479. Whole reach: all five. A unit is **creek-heavy** when the share is above 15%. The clock uses the units that are not creek-heavy. Lags are reported with and without the cut.

### 4.5 Recessions (description only)
The same XC on the recession windows. A recession is near to a smooth curve whose changes line up at many shifts, so this lag is weak. It is reported with the share of units that pass. No clock is built on it. The lag of the crests (4.3) is the better information on falling water.

### 4.6 Low water
- **The daily wave gives the phase only.** In each low-water week: each series minus its centred 25-hour mean; the shift from 0 to under 24 hours at which the two line up best (correlation at least 0.5). Per flow class (below 1,500; 1,500 to 2,000; 2,000 to 3,000 cfs): the circular median and spread of that phase. A daily wave cannot tell a lag from the same lag plus one or two days.
- **The whole days come from the bumps:** the low-water lag is the phase plus the number of whole days that brings it nearest to the median lag of the bumps of that pair.
- **Check:** Point of Rocks to Edwards Ferry plus Edwards Ferry to Little Falls must equal Point of Rocks to Little Falls within 3 hours. If not, the low-water lag is reported as not settled.
- **Named bias:** the water utilities take water out between Edwards Ferry and Little Falls on a daily pattern, a large share of the flow at 1,500 cfs. That shifts the phase at Little Falls.

### 4.7 Lag against flow
The flow of a unit is the median Little Falls flow in its window (for every pair). Per pair: the lags by flow class (below 3,000; 3,000 to 6,000; 6,000 to 12,000; 12,000 to 25,000; 25,000 cfs and above) with count, median and quartiles; and a fitted relation `lag = A × Q^B` (robust line through the logarithms, Theil and Sen) on all years, with a 95% interval from 10,000 bootstrap draws over events. The two halves (before 2020, from 2020) are fitted separately and reported. The relation is not used outside the range of flows of its units; below that range the low-water lag applies.

### 4.8 The direct check: Difficult Run
- **Step 0:** fetch the record of Difficult Run (USGS 01646000, public service, no key, only gauge number, parameter and dates in a request) as hourly medians for the span of the hourly file, by a script adapted from the one that built that file. The script and its output stay in this folder. If the record cannot be fetched, this check and the creek's part in 4.4 are dropped and the report says so.
- **Units:** separate Difficult Run peaks whose rise is at least 10% of the Little Falls flow of the day before, that flow below 6,000 cfs; Edwards Ferry stage varying by less than 5% of its value from 24 hours before the peak to 12 hours after; Seneca and Broad Run each rising by less than 25% of the Difficult Run rise (in cfs) over the same hours. All that pass, up to 40, largest first.
- **Lag:** XC of Difficult Run flow against Little Falls flow over 0 to 24 hours, scaled from 7.4 to 9.1 miles.
- **Valid** if at least 10 units pass the gate of 4.3. Known weakness: the same storm raises Cabin John Creek, 2 miles above the gauge, which pulls this lag short.

### 4.9 From the measured leg to the clock, with its range
For a flow Q on rising water, with `L(Q)` the fitted lag from Edwards Ferry to Little Falls:
- **Long end:** `0.37 × the upper bound of L(Q)`. No stretch below Great Falls is taken to be slower than the pooled river above it.
- **Central:** `0.36 × L(Q)`.
- **Short end:** `0.4 × 0.34 × the lower bound of L(Q)`. If the Difficult Run check is valid: the lower of `0.75 × 0.36 × L(Q)` and the lower quartile of the scaled Difficult Run lags.
- At low water the same with the low-water lag of 4.6.
- The report says in plain words: the split is an assumption, bounded, not tested; the central value is the long side of what is plausible.

### 4.10 Verdict on the clock, fixed in advance
Four cells: rising water below 6,000 cfs, at 6,000 to 12,000, at 12,000 cfs and above; and low water. All years. A cell qualifies with at least 5 units (low water: at least 20 weeks, the bumps and the check of 4.6 passed). **The app's value in a cell** is the median of the clock the app actually used in the replay (`travelGFtoLF`) over the hours of that cell's units; the bare formula at the cell's median flow is reported beside it.
- A cell is **TOO LONG** if the app's value lies above the long end of the measured range, **TOO SHORT** if below the short end, **INSIDE** otherwise.
- Verdict **TOO LONG** if at least two cells are TOO LONG and none is TOO SHORT. **ABOUT RIGHT** if every qualifying cell is INSIDE. **NOT DECIDED** if fewer than two cells qualify. **MIXED** otherwise.

## 5. What follows

- **TOO LONG:** a build plan for the scoring clock, with its own audits and a replay that learns on the new clock (section 9). A major version. A list of what else rests on the old clock: the forecast offsets in the browser and on the server, the header line, the truth of the earlier studies.
- **ABOUT RIGHT, MIXED or NOT DECIDED:** no change to the clock; the report says what the measurement does and does not settle about 26 and 27 November.
- The lags from Point of Rocks are reported. Whether the estimate should shift its inputs by them is a separate question and a separate decision.

## 6. Verification

Specification from this plan, reviewed before any analyst starts; two blind analysts (Python `python3 -I` standard library, base R) who do not see this plan's expectations; a compare tool; a third auditor with an own implementation, the row accounting, at least five readings against the USGS public service, and a re-measurement on 15-minute readings from that service of at least six rises plus the rise of 26 and 27 November (reported beside, never part of a fit). If the two analysts differ: stop and find the cause.

## 7. What this study cannot show

- The true time from Great Falls to Little Falls. It gives the longest plausible value, a floor, and one direct check with a known weakness.
- Hourly values limit a single lag to about half an hour; the parabola pulls toward whole hours.
- The gate at 0.6 keeps clean, larger rises, which are probably faster.
- At low water the whole days rest on the bumps, many of which are creek-led, and the phase is shifted by withdrawals.
- A change in flow flattens on its way; one number stands for its steepest part.
- The rise of 26 and 27 November is after the end of the hourly file; it enters only through the third auditor's 15-minute check.

## 8. Expected outcomes, written before the run

- Edwards Ferry to Little Falls on rising water: 7 to 9 hours at 3,000 to 12,000 cfs, 3 to 5 hours above 12,000. Low water: about 17 hours, the legs adding up to about 30.
- The start of a rise arrives a little sooner than the steepest part, the crest later.
- The clock, long end: about 6 hours at 1,500 cfs, 3 hours at 5,000 to 10,000, 1.5 hours above 12,000. The app used two to four times that below 12,000 cfs. Verdict TOO LONG, with the high-water cell INSIDE or close to it.
- Difficult Run: valid, and shorter than the split by distance.

## 9. Carried into the build plan (not part of this study)

Scoring the app on the measured clock, the cap against no cap, and the two yardsticks ("Great Falls equals Little Falls now"; "Little Falls now plus its rise of the last 3 hours carried over the clock"). Conditions from the plan audit that the build plan must meet: the state of an hour is set by rise and recession windows and by flow, not by a 2% change in 3 hours (finding 1); a reading counts only if it is the same at the central clock and at both ends of the range (finding 10); the truth is Little Falls at the hour of the estimate plus the clock, between hourly medians placed at their centres (finding 15); large rises are split into Point of Rocks led and Little Falls led.

## 10. Roles

Orchestrator: plan, rulings, synthesis. Fact gatherer, data fetch, specification writer and both analysts: Sonnet. Plan auditor, specification reviewer, third auditor: Opus.

## 11. Cost

About seven agents and a few hours. The laptop must stay awake.

## 12. Rulings on the audit (`PLAN_AUDIT.md`)

| Finding | Ruling | Where |
|---|---|---|
| F1 (blocker): the state rule of the scoring step gives 42% of hours a clock not measured for them | **Accepted by moving the scoring step out of this study**; the auditor's rule is a condition on the build plan | 0, 9 |
| F2 (blocker): the verdict could only come out "mixed", and ignored low water | **Accepted.** Four cells, all years, a "not decided" outcome, compared with the clock the app actually used | 4.10 |
| F3: recession lags cannot be found by lining up changes | **Accepted.** Recessions are description only, with the window moved to include the crest | 4.2, 4.5 |
| F4: the test of the split cannot detect a faster stretch below Great Falls | **Accepted.** The test is dropped; one-sided range | 0, 4.9 |
| F5: the Difficult Run selection left too few pulses | **Accepted** as worded by the auditor | 4.8 |
| F6: a daily wave cannot tell a lag from the lag plus a day | **Accepted.** Phase from the weeks, whole days from bumps, a check that the legs add up, withdrawals named | 4.6 |
| F7: the logarithm of a stage biases the lag | **Accepted.** Stage against stage as primary, two sensitivity versions | 4.1 |
| F8: the creek rule looked at the wrong hour and quantity | **Accepted** as worded by the auditor | 4.4 |
| F9: one number for start, steepest part and crest | **Accepted.** Times at 10%, 50% and 90% of the rise and of the crest | 4.3 |
| F10: the yardstick and cap readings lean with the clock's length | **Accepted by moving the scoring step out**; condition on the build plan | 9 |
| F11: the small onsets are mostly not rises; the limb's start was undefined | **Accepted.** Start defined; 30% rule; bumps added | 4.2 |
| F12: fitting before 2020 protects nothing and halves the units | **Accepted.** All years; halves as a stability check; bootstrap over events | 4.7 |
| F13: distances | **Accepted.** Little Falls gauge at 5.2, share 0.36 (0.34 to 0.37) | 2, 4.9 |
| F14: the gate selects clean rises | **Accepted.** Pass rates and other gates reported | 4.3, 7 |
| F15: building the truth | **Carried** to the build plan | 9 |
| F16: the rise that prompted the study is not in the data | **Accepted.** In the third auditor's 15-minute check | 6 |
| F17: details a specification writer would invent | **Accepted**; the specification settles each and lists it | 4 |

Nothing was rejected. The auditor's "strongest case against running it" is taken in part: the scoring step is not run here.

## 13. For the owner to confirm before anything is computed

1. **Scope:** this study measures the clock. Scoring the app on it (the cap, the two yardsticks) moves into the build plan, where the app can learn on the new clock first. The alternative: keep a quick scoring step here, as description, knowing it leans toward the cap and the yardsticks.
2. **The split:** Great Falls to Little Falls is taken as at most 36% of the measured time from Edwards Ferry to Little Falls, and at least 40% of that, unless Difficult Run narrows it.
3. **The rules with numbers:** a rise counts at a correlation of 0.6; a rise is creek-heavy above a share of 15%; the verdict by four cells as in 4.10.

A plain yes confirms all three as written.

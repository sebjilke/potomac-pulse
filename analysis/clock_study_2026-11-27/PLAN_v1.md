# Clock study: how long does a change in flow take from Great Falls to Little Falls?

Plan version 1, 2026-11-27. Draft for the independent audit. No analysis code is written before the audit, the rulings on it, and the owner's confirmation of the method.

Started on the owner's word of 2026-11-27 ("go"), after he said the app's number was off on the rise of 26 and 27 November, against the river itself and against the scoring in the locked section. Facts: `FACTS.md` in this folder. First look, not verified: `analysis/clock_first_look_2026-11-27/README.md`.

## 0. What the owner should know first

- **There is no gauge at Great Falls.** The time from Great Falls to Little Falls cannot be measured directly. This study measures the legs that have gauges at both ends (Point of Rocks to Edwards Ferry, Edwards Ferry to Little Falls), checks whether a change in flow moves at the same speed on both, and splits by river distance. One direct check on the ungauged reach is added (Difficult Run, section 4.6).
- **The app's clock was never checked against data for this leg.** It is a 1961 dye measurement of how fast the water moves from Point of Rocks to Little Falls, times 0.80, with 25% of it assigned to Great Falls to Little Falls by assumption. A change in flow travels faster than the water itself.
- **Five earlier looks in this repository already point the same way** (section 2), each on another pair of gauges and none followed up.
- **The clock does not enter the number the app shows.** It decides when an estimate is scored and against which Little Falls reading, and so what the corrections learn from. It also sets the offset of the 48 hour forecast and a line in the header.
- **A result here leads to a build plan, not to a build.**

## 1. Questions

1. How long does a change in flow take from Point of Rocks to Edwards Ferry, from Edwards Ferry to Little Falls and from Point of Rocks to Little Falls: by flow, on rising water, on falling water and at low water?
2. Does it move at the same speed on the two legs, so that splitting by distance is fair? What follows for Great Falls to Little Falls (and, as a by-product, for Edwards Ferry to Great Falls and Point of Rocks to Great Falls), with an honest range?
3. Judged on the measured clock: how accurate is the app as it is, what does the cap do, how large is the miss in the first hours of a rise, and does the app beat two plain yardsticks?

## 2. What is known (sources in `FACTS.md`)

1. **Where the clock is used.** `travelGFtoLF` sets `validationDue = now + travelGFtoLF` (`scheduled-update.js:972`, `:1116`). Nothing else on the server reads it except logs. The truth is the last Little Falls reading at the first hourly run at or after the due time, if that run comes within 2.5 hours. The shown estimate does not depend on it. The time from Point of Rocks to Great Falls does enter the estimate (which past reading is shifted in).
2. **Which flow feeds it.** The multiplier starts from the current Little Falls flow. When the lookup of the past Point of Rocks reading does not converge (typical on a rise; `trv.stop = max_iter`), it is replaced by the flow of that past reading. The forecast's scoring uses the current Little Falls flow with its own formula. (The first look said "always the past reading"; that holds only for runs that do not converge.)
3. **Where the numbers come from.** `T = 5174 × Q^−0.5963` hours for the 41 miles from Point of Rocks to Little Falls (Searcy and Davis 1961, dye). Times 0.80 since January 2026 (a cross-correlation whose scripts are not in the repository). 75% of it assigned to Point of Rocks to Great Falls, 25% to Great Falls to Little Falls, called "an explicit unfalsifiable assumption" in the refit plan of June 2026. Up to 30% less while Point of Rocks is rising (from the literature, no fit).
4. **Earlier measurements, all on other gauge pairs:**

| Source | Pair | Result | The app's formula |
|---|---|---|---|
| Daily wave study, November 2026, about 1,500 cfs | Point of Rocks to Edwards Ferry; Edwards Ferry to Little Falls | 12.9 h; 17.3 h (sum 30.2 h) | 49 h for the whole reach, 12.3 h for Great Falls to Little Falls |
| `validate_ef_lag`, February 2026 (levels) | Edwards Ferry to Little Falls | 12 h or more below 3,000 cfs; 7 h at 3,000 to 10,000; 4 h at 10,000 to 50,000; 3 h above | not compared |
| Refit plan, June 2026 | Point of Rocks to Little Falls | 38, 24, 19, 15, 9, 7 h from lowest to highest flow class | 60, 37, 26, 18, 9, 6 h |
| Rising-limb study, November 2026, report-only table | Point of Rocks to Little Falls, per rise | mostly 8 to 17 h | 18 to 50 h |
| First look, 27 November 2026 | Edwards Ferry to Little Falls, 31 rises | about 8 h at 5,000 to 10,000 cfs | not compared |

5. **The gauges** (USGS public record, read 2026-11-27): Point of Rocks 01638500; Edwards Ferry 01644148 (stage only; at Edwards Ferry near Poolesville, drainage 11,130 square miles, so Monocacy and Goose Creek enter above it); Little Falls 01646500 (11,560 square miles). Between Edwards Ferry and Little Falls only 430 square miles drain in (Broad Run, Seneca Creek, Difficult Run and small creeks). Two documents in the repository place Edwards Ferry "about 2 miles" above Great Falls; that is wrong.
6. **Distances** along the river by the towpath mileposts (orchestrator's figures, to be checked by the plan auditor against a public source): Point of Rocks 48.2, Edwards Ferry 30.8, Great Falls 14.3, Little Falls gauge about 5.7. Legs: Point of Rocks to Edwards Ferry 17.4 miles, Edwards Ferry to Little Falls 25.1, Great Falls to Little Falls 8.6 (34% of the lower leg), Edwards Ferry to Great Falls 16.5, Point of Rocks to Great Falls 33.9.
7. **Data in hand.** The hourly record of 2011-12 to 2026-11-09 (`analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv`: hourly medians of the 15-minute readings, stamped at the start of the hour; Edwards Ferry stage present on 97.5% of hours). The list of 87 rise onsets in 53 events plus 33 small onsets. The replay of the app (`analysis/onset_correction_2026-11-25/replay_L/shadow_L.csv`).

## 3. Design in short

1. Measure the lag between two gauges as the shift at which their hourly changes line up best, unit by unit (a unit is one rise, one recession, or one low-water week).
2. Relate the lag to flow. Fit that relation on the years before 2020 only.
3. Compare speeds on the two gauged legs; split the lower leg by distance; check the split on Difficult Run.
4. Score the app as it is, in 2020 to 2026, against Little Falls one measured travel time later.
5. Two blind analysts (Python, R), a compare tool, a third auditor who also re-measures some rises on 15-minute readings.

## 4. The measurement, frozen now

### 4.1 Series
Natural logarithm of each series: Point of Rocks flow, Edwards Ferry stage, Little Falls flow. Hourly change = difference of the logs of two consecutive hours. (With a power-law rating the log of a stage and the log of a flow differ by a factor only, so stage and flow can be compared.)

### 4.2 Units
- **Rises:** each of the 53 events and each of the 33 small onsets of the rise list (86 units). Window in the downstream gauge's time: from 6 hours before the start of the rising limb to 6 hours after the peak.
- **Recessions:** for each event, from 3 hours to 75 hours after the peak, cut at the start of the next unit.
- **Low-water weeks:** calendar weeks (UTC, Monday to Sunday) with a median Little Falls flow below 3,000 cfs that overlap no rise or recession window. Each log series has its centred 25-hour mean subtracted first, so that what is left is the daily wave.
- A unit is used for a pair of gauges when both series are present on at least 90% of its hours.

### 4.3 The lag of one unit
- **Primary (XC):** the shift from 0 to 48 hours (0 to 72 for Point of Rocks to Little Falls, and for every pair in low-water weeks) at which the correlation between the upstream changes and the downstream changes is highest, refined to a tenth of an hour by a parabola through the three highest neighbouring points. The unit counts only if that correlation is at least 0.6 (0.5 in low-water weeks), at least 24 paired hours exist and the maximum is not at either end of the range.
- **Low-water weeks only:** a week is set aside as ambiguous if a second local maximum at least 12 hours away comes within 0.05 of the highest correlation.
- **Secondary (STEEP):** the time between the steepest 3-hour change of the upstream series and that of the downstream series, each inside its own window. Reported beside XC, never used for the clock.

### 4.4 Rises fed by creeks
A rise that comes from creeks between the two gauges reaches the lower gauge without passing the upper one. A unit is flagged "creek-heavy" for a pair when, at the hour of the Little Falls peak, the gauged creeks entering between the two gauges (Seneca and Broad Run for the lower leg; Monocacy and Goose Creek for the upper leg; all four for the whole reach) carry more than 15% of the rise at Little Falls (peak minus the flow at the start of the limb). The clock uses the units that are not creek-heavy. All units are reported.

### 4.5 Lag against flow
The flow of a unit is the median Little Falls flow in its window. Per pair and state (rising, falling, low water): the lags by flow class (below 3,000; 3,000 to 6,000; 6,000 to 12,000; 12,000 to 25,000; 25,000 cfs and above) with count, median and quartiles; and a fitted relation `lag = A × Q^B` (robust line through the logs, Theil and Sen) with a 95% interval from 10,000 bootstrap draws over units. **The relation used for the clock is fitted on units before 2020-01-01.** The units from 2020 on show how well it holds.

### 4.6 The split, and a direct check
- **Speed on the two legs.** For every unit that passes on both legs: speed = miles divided by lag. Reading fixed in advance: splitting by distance is **supported** in a flow class if the median ratio of the two speeds lies between 0.75 and 1.33; otherwise **not supported** there.
- **The clock:** Great Falls to Little Falls = 34% of the fitted lag from Edwards Ferry to Little Falls. Range: that value divided and multiplied by 1.33 (or by the measured ratio of the two legs, if that is wider).
- **Direct check on the ungauged reach.** Difficult Run enters about 1.7 miles below Great Falls. When a local storm sends a pulse down Difficult Run while the Potomac is otherwise quiet, the time until Little Falls answers is the travel over about 6.9 of the 8.6 miles. Step 0 fetches the Difficult Run record (USGS 01646000, public service, no key) as hourly medians, by a script adapted from the one that built the hourly file. Units: the 40 largest separate Difficult Run peaks at which the Little Falls flow of the day before was below 6,000 cfs and Point of Rocks changed by less than 5% over the 48 hours around the peak. Lag by XC over 0 to 24 hours. Reading fixed in advance: the check **agrees** if the median, scaled to 8.6 miles, lies inside the range of the clock at that flow; otherwise the report gives both and widens the range to cover them. Known weakness: the same storm raises small creeks nearer Little Falls, which pulls this lag down. If the record cannot be fetched, the check is dropped and the report says so.

### 4.7 Verdict on the clock, fixed in advance
For rising water in the units from 2020 on, per flow class, compare the measured clock (central value) with the app's formula at the same flow (`6.5 × 4139 × Q^−0.5963 / 25.8` hours, its converged case). **TOO LONG** if the app's value is more than 1.5 times the measured one in at least three of the classes that hold at least five units, and the measured range lies wholly below the app's value in those classes. **ABOUT RIGHT** if the app's value lies inside the measured range in at least three such classes. **MIXED** otherwise.

## 5. The app scored on the measured clock, frozen now

- **Data:** the replay's main run. For every hour with an estimate (from 2012-12-01): the shown value, the estimate before the cap, the Little Falls reading the model held, and that reading 3 hours earlier.
- **State of the river for the clock:** rising when the Little Falls reading is at least 2% above the one 3 hours earlier, falling when at least 2% below, low water when neither and the reading is below 3,000 cfs, otherwise the rising relation.
- **New truth:** the Little Falls flow at the hour of the estimate plus the clock for that reading and state, rebuilt from the hourly record the way the replay tool does. An hour is scored when that value exists and lies between 500 and 500,000 cfs. Three clocks: central, short end and long end of the range. The replay's own truth (the app's clock) is the reference.
- **What is scored:** the app as shown (P); the estimate without the cap (N); as description a cap at 110% and at 150%; and two yardsticks: **Y0**, "Great Falls equals Little Falls now"; **Y1**, "Little Falls now plus its rise of the last 3 hours carried forward over the clock" (never less than Y0).
- **Hours:** all; Little Falls rising; state "rising" (Point of Rocks); capped hours; the rising limbs of the 21 large rises; **early rise** (the first 12 hours after each rise onset); low water in the eel season (15 September to 15 December, below 4,000 cfs).
- **Measures:** mean absolute error, mean signed error, share badly off (15% or more), badly low, badly high. Differences between two estimates are formed hour by hour, with a 95% interval from a bootstrap over calendar months.
- **Readings fixed in advance** (test years 2020 to 2026, central clock; design years and the two ends of the range reported beside):
  1. **Does the clock change the picture?** Mean absolute error of P on the large rises' rising limbs under the app's clock minus under the measured clock. "Yes" if the whole interval is above 0.
  2. **The cap:** good job, harm or unclear on each group, as in the cap study (error without the cap minus with it).
  3. **The yardsticks:** on each group, the app **beats** a yardstick if the whole interval of (app's absolute error minus yardstick's) is below 0, the yardstick **beats the app** if it is above 0, otherwise **unclear**.
- **Limit named now:** the corrections inside the replayed estimates were learned on the app's clock. This step judges the app as it is, not the app after a fix of the clock. What a fix does to the learning needs a new replay and belongs to the build plan.

## 6. What follows

- **TOO LONG:** a build plan for the scoring clock (its own plan, audits and a replay with the new clock), a major version. A list of everything else that rests on the old clock: the forecast offsets in the browser and on the server, the header line, the earlier studies' truth.
- **ABOUT RIGHT or MIXED:** no change to the clock; the report says what remains unexplained about 26 and 27 November.
- The lags for Point of Rocks to Great Falls and Edwards Ferry to Great Falls are reported. Whether the estimate should shift its inputs by them is a separate question and a separate decision.

## 7. Verification

Specification from this plan, reviewed before any analyst starts; two blind analysts (Python `python3 -I` standard library, base R) who do not see this plan's expectations; a compare tool; a third auditor with an own implementation, the row accounting, at least five readings against the USGS public service, and a re-measurement of at least six rises on 15-minute readings from that service. If the two analysts differ: stop and find the cause.

## 8. What this study cannot show

- The true time from Great Falls to Little Falls. It gives a split by distance, a check on most of the reach from one creek, and a range.
- The reach from Great Falls to Little Falls is steeper than the reach above it. A change in flow probably moves faster there, so the central value is more likely too long than too short.
- Hourly values limit a single lag to about half an hour.
- A change in flow flattens on its way and creeks add water; a lag is the timing of the bulk of the change, not of its first sign.
- At low water the daily wave repeats every 24 hours, so a week can fit two lags a day apart. Such weeks are set aside, which may bias what is left.
- The scoring step judges the app as it is today (section 5, last point).

## 9. Expected outcomes, written before the run

- Edwards Ferry to Little Falls on rising water: about 7 to 9 hours at 3,000 to 12,000 cfs, 3 to 5 hours above 12,000. At low water about 17 hours.
- The two legs move at about the same speed (ratio 0.8 to 1.2), so the split is supported.
- The clock: about 6 hours at 1,500 cfs, about 3 hours at 5,000 to 10,000, about 1.5 hours above 12,000. Verdict TOO LONG.
- Difficult Run: shorter than the clock, by the weakness named in 4.6.
- On the measured clock the app's error on large rises is much lower than on its own clock; the cap does a good job on every group; the yardstick Y1 beats the app on rising hours and in the early hours of a rise; on all hours the reading is open.

## 10. Roles

Orchestrator: plan, rulings, synthesis. Fact gatherer, specification writer, data fetch and both analysts: Sonnet. Plan auditor, specification reviewer, third auditor: Opus.

## 11. Questions put to the plan auditor

1. Check section 2 against `FACTS.md` and the code. Check the distances of point 6 against a public source (towpath mileposts or river miles) and say where Monocacy, Goose Creek, Broad Run, Seneca Creek, Difficult Run and Cabin John Creek enter relative to Edwards Ferry, Great Falls and the Little Falls gauge.
2. Is "the shift at which the hourly changes line up best" the right measure of the time a change in flow needs? What do the log, the hourly medians, the window and the gate at 0.6 do to it? Is there a bias on rising against falling water?
3. Is the split by distance defensible for this reach? Is the reading in 4.6 a fair test of it? Can the Difficult Run check work at all, and is its selection of units sound? Is there a better direct check on the ungauged reach that the data in hand allow (Seneca Creek, Broad Run)?
4. The low-water weeks: can the method tell a lag from the same lag plus 24 hours? Is setting ambiguous weeks aside a bias?
5. Is fitting the relation before 2020 and scoring from 2020 on a real protection here?
6. Section 5: is "Little Falls at the hour of the estimate plus the clock" the right truth for what the app shows, given that the replay's readings are one to two hours old? Are the yardsticks fair to the app (they see the same Little Falls reading the app holds)? Is any reading one-directional by construction?
7. Is the verdict rule of 4.7 sound, and can each of its three outcomes occur?
8. What is missing: a rule, a control, a lesson from the cap study or the onset study that is not applied?
9. The strongest argument that this study is not worth running, or that the first look already settles it.

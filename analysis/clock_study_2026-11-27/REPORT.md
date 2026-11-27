# Clock study: report

2026-11-27. Question: how long does a change in flow take from Great Falls to Little Falls, and is the clock the app uses for it right?

**Verdict: TOO LONG.** The clock the app used is 1.7 to 1.9 times the longest value the measurement allows, in all three cases that could be judged. Computed mechanically by two blind analysts whose 15 output files are identical byte for byte, rebuilt by a third auditor (`RESULTS_AUDIT.md`: pass with notes). No change to the app follows from this report alone; a build plan comes next.

## 0. In short

1. **The weak spot first: the time from Great Falls to Little Falls is still an assumption.** There is no gauge at Great Falls. The study measured the stretch from Edwards Ferry to Little Falls (25.7 miles) and took the last 9.1 miles as their share of it. The verdict does not need that share to be exact: for the app's clock to be right, the last 9.1 miles would have to take 62 to 69% of the time of the whole stretch.
2. **What was measured.** On rising water a change in flow takes about 11 hours from Edwards Ferry to Little Falls at 3,000 to 6,000 cfs and about 6.5 to 8 hours at 6,000 to 12,000. At low water it takes about 15 hours near 2,000 to 3,000 cfs and 17 to 20 hours below 2,000.
3. **What follows for Great Falls to Little Falls, at most:** about 6 to 7 hours at 1,500 to 2,000 cfs, 4 to 5 hours at 3,000 to 5,000, 3 to 3.5 hours at 7,500 to 10,000.
4. **What the app used in the same hours:** 10.6 hours at low water, 7.9 hours on rising water below 6,000 cfs, 6.1 hours at 6,000 to 12,000.
5. **Not measured: high water.** Above 12,000 cfs only 4 rises could be used, one short of the rule, and above 25,000 none. Nothing here says the clock is wrong there.
6. **The rise of 26 and 27 November is outside what this clock describes.** It was fed by creeks: Little Falls rose about 3 hours before Edwards Ferry moved. This study does not explain the app's error on those days.

## 1. What was done

The lag between two gauges was measured rise by rise as the shift at which their hourly changes line up best, on the hourly record of 2011 to 2026. Units: the 53 rises and 33 small onsets of the rise list, 86 small low-flow rises found in the record, 53 recessions (description only) and 100 quiet low-water weeks. A rise counted when the two gauges lined up at a correlation of 0.6 or more and when creeks between the gauges carried no more than 15% of the rise. The lag was related to flow by a robust fit with a bootstrap over events. At low water the daily wave gave the phase and the small rises the whole days. The stretch from Great Falls to Little Falls was taken as 36% of the lower leg by distance, with a range from 40% of that share to the full share. The verdict compares the clock the app actually used in the replay with the long end of that range, in four cells. Method: `PLAN.md` (version 2, confirmed by the owner). Exact arithmetic: `ANALYSIS_SPEC.md` (version 1.2).

## 2. How it was checked

- **Plan:** independent audit, 17 findings, all accepted. Among them: the first plan's test of the split could not have failed; its verdict rule could only come out "mixed"; its low-water method could not tell a lag from the lag plus a day.
- **Specification:** independent review and re-check, 17 findings, all accepted; every test value recomputed in Python and R; all expected counts reproduced from the text.
- **Two blind analysts** (Python, R), each from the specification alone: all 15 output files identical byte for byte on their first runs.
- **Third auditor:** an own implementation matches every written cell of 14 files exactly (the 15th, the checks file, in its main rows); both runs repeated with unchanged files; cells and verdict recomputed by hand.
- **Against USGS, at 15 minutes:** 1,941 hourly values of the input file checked against the 15-minute readings on seven rises from 2012 to 2024: every one agrees. The lag measured at 15 minutes agrees with the hourly lag within 0.2 hours. Two other ways of timing a rise (half of the rise, the steepest hour) agree within about an hour.
- **The Difficult Run record** built for this study: complete hourly grid, three hourly values recomputed by hand, five compared with a fresh request, all matching.

## 3. What was measured

**Edwards Ferry to Little Falls on rising water** (stage against stage; rises that pass the correlation of 0.6 and are not creek-fed):

| Flow at Little Falls | Median lag | Rises | Middle half |
|---|---|---|---|
| below 3,000 cfs | 13.5 h | 5 | 12.1 to 16.6 h |
| 3,000 to 6,000 | 11.2 h | 17 | 9.2 to 11.4 h |
| 6,000 to 12,000 | 6.7 h | 5 | 6.6 to 8.0 h |
| 12,000 to 25,000 | 7.0 h | 4 | 6.4 to 7.2 h |
| 25,000 and above | none | 0 | |

- **Fitted relation:** lag = 273 × Q^−0.394 hours (31 rises, 1,400 to 20,000 cfs; the exponent lies between −0.53 and −0.30). That gives 15.3 h at 1,500 cfs, 11.7 at 3,000, 9.6 at 5,000, 8.1 at 7,500, 7.3 at 10,000, 6.2 at 15,000. The exponent is close to what a flood wave in a wide channel should show (about −0.4). The app's formula uses −0.596, the exponent of a dye measurement.
- **It barely depends on the choices made.** Across 24 variants (four correlation gates, with and without the creek cut, three versions of the series) the fitted lag is 11.1 to 12.1 hours at 3,415 cfs and 7.2 to 8.6 hours at 8,550 cfs.
- **The legs add up.** Point of Rocks to Edwards Ferry plus Edwards Ferry to Little Falls equals Point of Rocks to Little Falls within 0.4 hours at every flow from 1,500 to 15,000 cfs (at 5,000 cfs: 9.1 + 9.6 = 18.7 against 18.8).
- **Few rises carry the result.** 31 of 172 units feed the fit. The cell at 6,000 to 12,000 cfs holds exactly 5 rises, the minimum. The verdict holds without that cell.

**Low water** (the daily wave, Edwards Ferry to Little Falls): 19.6 hours below 1,500 cfs, 17.1 hours at 1,500 to 2,000, 15.0 hours at 2,000 to 3,000. These agree with the small rises at low flow (median 12.9 hours) and with the fit at the same flows (13 to 15 hours). The check that the two legs add up to the whole reach passed, but a daily wave passes it almost by construction, so it adds little. The water utilities take water out along this stretch on a daily pattern; that could shift these numbers and was not examined.

**The direct check on the last stretch, Difficult Run: not valid.** 10 storm pulses met the conditions, 4 lined up well enough, 10 were required. Their lags, scaled to the full stretch from Great Falls, are 1.2, 4.0, 4.1 and 4.3 hours. Three of the four sit at the split by distance, not below it. Nothing from this check enters the clock.

**The parts of a rise** (start, middle, top, crest) could not be timed reliably on windows of several days and are not reported as a finding.

## 4. The clock from Great Falls to Little Falls

Every number in this table rests on the split by distance.

| Flow at Little Falls | Long end | Central | Short end | The app's formula at that flow |
|---|---|---|---|---|
| 1,500 cfs | 6.8 h | 5.5 h | 1.9 h | 13.3 h |
| 2,000 | 5.9 | 4.9 | 1.7 | 11.2 |
| 3,000 | 4.9 | 4.2 | 1.5 | 8.8 |
| 5,000 | 4.0 | 3.4 | 1.2 | 6.5 |
| 7,500 | 3.5 | 2.9 | 1.0 | 5.1 |
| 10,000 | 3.1 | 2.6 | 0.8 | 4.3 |
| 15,000 | 2.7 | 2.2 | 0.7 | 3.4 |
| 25,000 and above | not measured | | | 2.5 and less |

- **Long end:** the last 9.1 miles take their full share by distance of the upper bound of the measured lag. **Central:** their share of the fitted lag. **Short end:** 40% of that share, a floor set by judgment for a stretch that is steeper than the river above it.
- The four usable Difficult Run pulses give no sign that the last stretch is faster than its share. So the short end is probably too short, and the truth more likely lies between the central value and the long end. That is a reading of four pulses, not a result.
- The range is a band for the typical rise, not the spread of single rises. The verdict below survives even the longest single rise in each cell.

## 5. The app's clock, and the verdict

| Cell | Units | The app used (median) | Long end of the measured range | Status |
|---|---|---|---|---|
| rising water, below 6,000 cfs | 22 | 7.9 h | 4.7 h | TOO LONG |
| rising water, 6,000 to 12,000 | 5 | 6.1 h | 3.3 h | TOO LONG |
| rising water, 12,000 cfs and above | 4 | 3.8 h | 2.8 h | not judged (5 units required) |
| low water | 47 weeks | 10.6 h | 5.9 h | TOO LONG |

Three cells qualify, all three are too long, none is too short: **TOO LONG.**

Without the split by distance the same thing can be said this way: at 3,000 to 6,000 cfs the app allows 7.9 hours for the last 9.1 miles, which is 71% of the 11.1 hours measured for the whole 25.7 miles.

On a rise the app's clock can be longer still than these medians, because its lookup of the past Point of Rocks reading often does not settle and then uses that reading's low flow (`FACTS.md`). On the night of 26 November it logged 9 to 14 hours (first look, not part of this study).

## 6. What this means for 26 and 27 November, and what it does not

- **The rise was creek-led.** In the 15-minute readings Little Falls began to rise at about 12:00 UTC on the 26th, before Edwards Ferry moved. By volume, about four fifths of the rise at Little Falls came from the creeks between Edwards Ferry and Little Falls (estimated from Seneca Creek, Broad Run and Difficult Run, scaled up to the ungauged creeks; provisional readings).
- **So the measured clock does not apply to it.** It says when a change coming down the main river reaches Little Falls, not when creek water does. The only main-river number from that rise is the lag of the two crests, 6.2 hours for the whole stretch from Edwards Ferry.
- **This study therefore does not explain the app's error on those two days.** What it does show: the app's scoring compared each estimate with Little Falls 9 to 14 hours later, far longer than any travel time measured here.
- **A new point that needs its own look:** part of that creek water joined below Great Falls (Difficult Run and the creeks near Cabin John). Little Falls then carried water that never passed Great Falls. How much, and what it means for judging the app's number against the river at Great Falls, has not been worked out.

## 7. What this study cannot show

- The true time from Great Falls to Little Falls. The central value is an assumption, bounded on the long side by argument and one weak check, not by data.
- Anything about the clock at 12,000 cfs and above.
- Whether the start of a rise arrives sooner than its steepest part, or the crest later.
- That the low-water lag is free of the effect of withdrawals.
- How the app scores on a corrected clock, what the cap does on it, and whether a plain yardstick beats the app. That was moved out of this study on the plan audit's advice and belongs to the build plan's replay.
- How the finished studies (cap study, onset study, the two rising-limb studies) change. They all took their truth on the app's clock.

## 8. Expectations against outcomes

Written before the run (`PLAN.md` section 8). Right: the verdict; the low-water lag near 17 hours with the legs adding up to about 30. Not judged: the high-water cell, which the plan expected to come out inside the range or close to it. Wrong: the lower leg at 3,000 to 6,000 cfs is longer than expected (11 hours, not 7 to 9), so the clock there is 4 to 5 hours at most, not 3; Difficult Run was expected to be valid and shorter than the split and is neither; the parts of a rise were expected to line up and do not.

The first look of the same day (`analysis/clock_first_look_2026-11-27/README.md`) said "about 3 hours, likely 2 to 4" for a rise at 5,000 to 10,000 cfs. The study gives 2.6 to 3.4 hours as the central value and 3.1 to 4.0 as the long end there. Below 5,000 cfs the first look's 3 hours was too short. Its scoring of the night of 26 November rested on a clock that does not fit a creek-led rise and should be read with section 6.

## 9. What follows

1. **A build plan for the scoring clock** (its own plan, an independent audit, a replay that learns on the new clock, then the owner's word). Open points it must settle: which value inside the range to use; what to do at 12,000 cfs and above, where nothing is measured; the forecast's two offsets and the header line, which rest on the same formula; the conditions of `PLAN.md` section 9 for scoring the app, the cap and the yardsticks on the new clock.
2. **A separate question, not yet started: creek-led rises.** On 26 and 27 November most of the rise came from creeks, some of them below Great Falls. A clock cannot fix that. It needs its own first look: how much of Little Falls' flow on such a rise never passed Great Falls, and how the app's number should be judged then.
3. The cap stays as it is. The earlier studies are not recomputed until the build plan's replay exists.

## 10. Files

`FACTS.md`; `PLAN.md` (version 2), `PLAN_v1.md`, `PLAN_AUDIT.md`; `ANALYSIS_SPEC.md` (1.2; 1.0 and 1.1 kept), `SPEC_REVIEW.md`; `py/` and `r/` (code, 15 output files, README and REPORT each); `tools/compare_analysts.py`; `data/` (the Difficult Run record, its script and README); `RESULTS_AUDIT.md`; this report.

# Cap study: does the 120% cap do a good job, and is there a better rule?

Plan version 1, 2026-11-26. Draft for the independent audit. No analysis code is written before the audit, the rulings on it, and the owner's confirmation of the method.

Started on the owner's word of 2026-11-26 ("study the cap"). His doubt: on a fast rise the water at Great Falls reaches Little Falls hours later, so the true value can be far above 120% of the current Little Falls reading, and the cap then makes the app read low. His ideas: switch the cap off unless ice is plausible; or let the cap's threshold depend on how fast the river is predicted to rise.

## 0. What the owner should know first

- **The cap's original evidence does not answer his question.** The three searches of February 2026 that chose 120% set the cap at 120% of the same Little Falls value the estimate was scored against (`analysis/backtest_delta_cap.py:99-102,182`; `analysis/backtest_comprehensive.py`, `estimate_gf`). The real cap has only an earlier reading. Those searches never measured a cap that lags behind a rising river.
- **This study can.** It needs no new replay: the replay of the onset study holds, for every hour of 2012 to 2026, the estimate before the cap, the Little Falls reading the cap used, and what arrived at Little Falls one travel time later.
- **The cap binds on about 4% of hours** (2,137 of 59,999 scored hours in 2012 to 2019; 2,511 of 59,448 in 2020 to 2026). So the overall error can move only a little. The interest is in rising water and in large rises, where it binds much more often (52.5% of the rising-limb hours of the 21 large rises, by an earlier study).
- **A result here does not lead to a build.** It leads to a check on this week's rise from the app's own log, which is outside the replay data.

## 1. Questions

1. **Description:** what does the cap do as it is? Shown estimate with the cap against the same estimate without it, on all hours, on capped hours, on rising water and on large rises.
2. **Test:** is there a rule that reads less often badly low on rising water without making the overall error worse?

## 2. What is known

Read on 2026-11-26 by a fact gatherer; "code" means read in the source or the data, "document" means read in a report.

1. **The rule** (code, `netlify/functions/shared/model.js:705-721`, constant at `:502`): `corrected = raw − correction`; if `corrected > 1.20 × Little Falls reading` the shown value is `1.20 × that reading`. Nothing on the low side. The cap acts on the corrected value, so a large correction can keep it from binding.
2. **Learning never sees the cap** (code: the cells learn `raw − Little Falls`; `ceilingApplied` is never read in learning). So every cap rule can be computed afterwards from one replay.
3. **Which reading** (code): the latest Little Falls flow the job holds, with no age check. In production it is typically 10 to 70 minutes old. In the replay it is one hour old on 99% of hours (127,946 of 129,534).
4. **How 120% was chosen** (code and data, `analysis/backtest_comprehensive_combined.csv`, `backtest_117k_hourly_python.csv`): a grid of 5 ceilings (none, 105, 110, 115, 120%) and 5 decay caps on a daily set (5,208 pairs) and an hourly set (42,837 pairs), later re-run on 117,420 hourly pairs. In all of them the cap was computed from the truth value itself (section 0). By overall error the tighter caps won (105% best; the chosen setting ranks 16th of 25). The stated reason for 120% was a smaller low bias on rising water on the 42,837-pair set (−61 cfs at 120% against −509 at 110%). On the 117,420-pair set the bias on rising water was negative at every setting and least negative with no cap (−2,712; −2,912 at 120%). No selection rule fixed in advance was found. The changelog's figures "−29 against −476" are in no results file.
5. **October 2026** (document, `analysis/cap-mechanism-map-2026-11-10.md`): eight scored hours were capped. Their shown errors ran from −2,014 to +2,160 cfs; the model without the cap would have been +1,160 to +6,070 cfs too high (replayed values, one of them known to be understated). The cap "helped on the rise and peak and flipped the sign of the error at the onset" (flood audit).
6. **Two earlier studies on 21 large rises** (documents, `analysis/rising-limb-travel-verdict-2026-11-11.md`, `analysis/multipending-responsiveness-verdict-2026-11-12.md`): before the cap the model overestimates on rising-limb hours by +2,461 cfs on average; the cap binds on 52.5% of those hours; on the hours where it does not bind the shown estimate is already too low (−1,477 cfs on average). Both conclude that the cap governs the shown number on a rising river.
7. **Ice** (code, `model.js:146-165`): the app's ice rule (`isIcePlausible`: water temperature at Point of Rocks at or below 5 °C, or November to March when the temperature is unknown) guards one check during learning. It does not touch the cap. When a gauge is flagged as iced, no estimate is made at all.
8. **What the replay holds** (data, `analysis/onset_correction_2026-11-25/replay_L/shadow_L.csv`, `replay_F/shadow_F.csv`): 130,987 hourly rows each on a complete hourly grid; per hour the raw estimate before rounding (`rawUnc`), the correction applied (`corrUsed`), the Little Falls reading the cap used (`lfCap`) and its source time, the shown value, whether the cap bound, the truth and its hour, both travel times, the upstream change the state rule saw (`d6`, `thr6`, `span_h`), the state and the flow range. The Little Falls reading of earlier hours is the `lfCap` of earlier rows. Water temperature is blank before 2021-05-07.
9. **Counts, main run, scored hours** (data): capped hours by state, 2012 to 2019 and 2020 to 2026: rising 1,238 and 1,302; steady 596 and 714; falling 303 and 495. Most capped hours are capped by little: the estimate before the cap is within 10% of the limit on 1,118 and 1,286 of them, and more than 50% above it on 234 and 254.
10. **Large rises** (data, `analysis/rising-limb-travel-backtest/rising_limb_events_python_v39.csv`): 21 kept rises with a peak of 12,000 cfs or more at Little Falls, 8 before 2020 and 13 from 2020 on, almost all between June and November; each with the start and end of its rising limb.

## 3. Design in short

1. No new replay. The two replay files of the onset study are the data (main run arm L; arm F as a check on input timing).
2. Every rule changes only the limit. The estimate before the cap, `u = rawUnc − corrUsed`, is the same under all rules. `shown = floor(min(u, limit) + 0.5)`.
3. Truth is the Little Falls flow one travel time after the estimate, as in every accuracy figure of the app.
4. The record is split as in the onset study: design years 2012-12-01 to 2019-12-31, test years 2020-01-01 to 2026-11-09. One rule is picked in the design years by a rule fixed here and tested once in the test years.
5. Two blind analysts (Python, R), then a third auditor.

## 4. The rules, frozen now

`L` is the Little Falls reading the cap used at that hour (`lfCap`). `L3`, `L6` are the readings the model held 3 and 6 hours earlier (`lfCap` of the rows 3 and 6 hours before; when such a row has none, the rule falls back to production for that hour). `T` is the travel time from Great Falls to Little Falls in hours (`travelGFtoLF`).

| Rule | Limit | Idea |
|---|---|---|
| P, production | 1.20 × L | baseline |
| N, no cap | none | what the cap removes and what it costs |
| F135, F150, F200 | 1.35, 1.50, 2.00 × L | a looser fixed cap |
| T110 | 1.10 × L | reference only: the direction the February searches pointed to |
| RIS, no cap on rising water | none when the state is rising, 1.20 × L otherwise | the crudest form of "depends on the predicted rise" |
| UP, by the upstream rise | `min(2.00, 1.20 × (1 + p)) × L`, with `p = max(0, d6 / (porQ − d6)) × T / span_h` | the owner's idea, read as: the rise Point of Rocks is showing, scaled to the length of the travel time |
| LF3, LF6, by Little Falls' own rise | `min(2.00 × L, 1.20 × max(L, L + (L − Lk) × T / k))`, k = 3 or 6 | the owner's idea, read as: carry Little Falls' own recent rise forward over the travel time |
| ICE, only when ice is plausible | 1.20 × L when the app's ice rule says plausible, none otherwise | the owner's first idea. Before 2021-05-07 the temperature is unknown, so the rule there is "November to March" |

A third reading of the owner's idea, the rise the Weather Service forecasts for Little Falls, cannot be tested on past years (no forecasts were stored before 2026-11-25). It is part of the later check on this week's rise (section 9).

No rule is added or reshaped after any result of this study has been seen.

## 5. Measures and hours

Per hour and rule: `error = (shown − truth) / truth × 100`. Per hour: `d = |error of the rule| − |error of production|`; negative is better.

- **Mean absolute error** and **mean signed error**.
- **Badly low:** the share of hours shown 15% or more below the truth. **Badly high:** 15% or more above.
- **Hours:** all scored hours (S); rising hours (state rising); hours on which production's cap binds; the rising-limb hours of the kept large rises (from `rl_start` to `rl_end` in the events file); the six flow ranges.
- **Uncertainty:** bootstrap over calendar months, 10,000 draws, 95% interval, shared random numbers, as in the onset study.
- All conditions are on net shares over hours fixed in advance, never on a subset that a rule can only move one way. (Lesson of the onset study.)

## 6. Step A, design years: description and the pick

**A1. Description of production against no cap** on every group of hours of section 5: the two errors, the two shares, and how often the cap turns a too-high reading into a closer one, a too-high reading into a too-low one, and a correct reading into a too-low one.

**A2. The table of all rules** on all scored hours, on rising hours and on the large rises.

**A3. The pick.** The owner's concern is reading low on rising water. So:
- A rule qualifies if its mean absolute error over all scored design hours is not more than 0.05 points above production's.
- Among the qualifying rules other than production, the pick is the one with the lowest share of badly-low hours on rising water. Ties within 0.1 percentage points go to the rule earlier in this order: F135, F150, LF6, LF3, UP, RIS, F200, ICE, N (simpler and tighter first).
- If no rule qualifies, or the best qualifying rule is not below production on that share, the verdict is KEEP and step B is reported as description only.

**This weighing (fewer badly-low readings on rising water first, overall error as the limit) is the orchestrator's proposal. The owner may turn it around before the run: lowest overall error first, the badly-low share as the limit.**

## 7. Step B, test years, used once: the picked rule against production

All eight must hold for the verdict BETTER RULE FOUND:

1. **Fewer badly-low readings on rising water:** the share on rising hours falls by at least 1.0 percentage point, and the whole interval of the difference is below 0.
2. **No loss overall:** mean `d` over all scored hours is not above +0.05 points.
3. **Not many more badly-high readings:** the share over all scored hours does not rise by more than 0.5 percentage points.
4. **Large rises:** on the rising-limb hours of the kept large rises in the test years, the badly-low share is not higher than production's, and the mean absolute error is not more than 5% (relative) above production's.
5. **Both halves of the test years:** the difference of condition 1 is below 0 in each.
6. **Input timing:** in the arm F run the difference of condition 1 is below 0.
7. **High water:** at 25,000 cfs and above, the mean absolute error is not more than 5% (relative) above production's.
8. **Low water:** below 3,000 cfs, the same.

Verdicts: BETTER RULE FOUND (all eight); KEEP (step A found no rule, or in step B the interval of condition 1 includes 0); UNCLEAR (everything else).

The numbers 1.0, 0.05, 0.5 and 5% are the orchestrator's proposal; the owner may set others before the run.

## 8. What follows a verdict

- **BETTER RULE FOUND or UNCLEAR:** the rule and production are scored on this week's rise from the app's own log (section 9) before anything is proposed for the app.
- **KEEP:** the cap stays; the description of step A is the answer to "does it do a good job".
- A change of the cap changes the shown number, so any later build is a MAJOR version, in the browser and on the server, with its own plan and audits. It needs no reset of the corrections.

## 9. The later check on this week's rise (own short plan, after the rise has passed)

The rise that began on 2026-11-26 is outside the replay data. The app's hourly log holds what is needed for every run: the corrected value before the cap (`corr.unc`), the limit (`ceil.lim`), whether it bound, the shown value, the Little Falls reading and its time. The forecast archive holds the Weather Service's forecast for Little Falls for the same hours. So the rules of section 4 can be scored there, and also the third reading of the owner's idea: a limit of 120% of the forecast for the hour the water arrives. One rise is description, not a test.

## 10. Verification

Specification from this plan, reviewed before any analyst starts; two blind analysts, Python (`python3 -I`, standard library) and R (base), who do not see this plan's expectations; a compare tool; a third auditor with an own implementation, the row accounting, and at least five readings checked against the USGS public service. If the two analysts differ: stop and find the cause.

## 11. What this study cannot show

- The replay's Little Falls reading is one hour old; production's is 10 to 70 minutes old. The replay's cap is therefore a little staler than the real one, which makes the real cap slightly less harmful on rises than the replay shows.
- Hourly values, cells never reset, the server's model only.
- The truth is the Little Falls flow one travel time later. If the app's travel time is off on a steep rise, a correct estimate is scored against a too-early reading (the cap map raises this for October 2026).
- The rules were shaped knowing October 2026 and the general pattern; the split protects only the pick among them.
- The ICE rule can be judged on temperature only from 2021-05-07.
- The cap is studied with production's corrections. The half-and-half mix of the onset study is not combined with it here.

## 12. Expected outcomes, written before the run

- Step A1: without the cap the mean absolute error on capped hours is clearly higher (the model overshoots), and the badly-low share on rising hours is lower.
- N, ICE and RIS do not qualify (too much overall error).
- The pick is LF6 or F135.
- Step B: UNCLEAR is the most likely verdict, then BETTER RULE FOUND, then KEEP.

## 13. Roles

Orchestrator: plan, rulings, synthesis. Specification writer and both analysts: Sonnet. Plan auditor, specification reviewer, third auditor: Opus.

## 14. Questions put to the plan auditor

1. Does every statement of section 2 hold? In particular: do the February searches really build the cap from the truth value, and what does that do to their conclusions?
2. Is it true in production and in the replay tool that no cap rule can change what is learned, flagged or carried to the next hour?
3. Are the rules of section 4 well defined for every hour (missing earlier readings, a falling Little Falls, zero or negative quantities, the readings' real ages against the nominal 3 and 6 hours, rounding)? Is each a fair form of the idea it stands for? Is UP sound, or is it the wrong way to read "the speed of the predicted rise"?
4. Is the pick of section 6 sound, and is the order for ties defensible? What does the alternative weighing (overall error first) change?
5. Are the eight conditions of section 7 sensible, can each be met by a rule that helps, and is any of them one-directional by construction? Are the thresholds too soft or too hard given the counts in section 2?
6. Is the truth (Little Falls one travel time later) fit for judging a cap on a steep rise? What does the timing concern of the cap map imply for the reading of the results, and is there a sensitivity that would bound it (for example the truth one or two hours later)?
7. Which rule or control is missing? Which lesson of the onset study (`analysis/onset_correction_2026-11-25/REPORT.md`, section 8) is not applied?
8. The strongest argument that this study is not worth running.

# Report: can water already measured upstream improve the Great Falls forecast? (Stage 1)

2026-11-24. Written by the orchestrator for the owner. Plan: `PLAN.md` (version 2). Third auditor:
`RESULTS_AUDIT.md` (verdict: confirmed with caveats). No code of the app, the hourly job or the model was
changed.

## 1. In one minute

- **The question.** For some hours ahead, the water that will pass Great Falls has already passed the Point of
  Rocks gauge. Does a forecast that adds this measured change to the Little Falls reading beat "no change"?
- **The answer by the rule fixed in advance:** unclear at 6 hours, yes at 12 hours, no at 24 hours. By that
  rule the overall verdict is "propose Stage 2".
- **My recommendation is not to start Stage 2 now** (section 7). Three reasons, all required by the auditor to
  be stated:
  1. Inside the measured lead, the app's own estimate, simply held flat, scores as well or better. The
     measured water is information the app already uses. It is not new to the app.
  2. The one "yes" is thin. It clears the threshold by 0.14 point and fails in the recent years, in the
     daily-wave season and at low water.
  3. At 24 hours the forecast is worse than "no change", driven by September to December.
- **What this study cannot say:** whether any of this beats today's forecast. The check fixed in advance found
  the stored scores of today's forecast not comparable with an every-hour sample, at every horizon.

## 2. What was tested

- **The forecast tested ("measured water"):** Little Falls as it reads now, plus the change in the Point of
  Rocks flow between the water that is at Little Falls now and the water that will be there at the target hour.
  It uses the model's travel times and nothing else from the model.
- **The baseline ("no change"):** the Little Falls reading held. This is the app's own stored baseline.
- **Two reference levels, description only:** the app's estimate held flat, and the app's estimate at the
  target hour (the level a forecast cannot beat with this method).
- **Record:** forecasts issued every hour from 2012-12-01 to 2026-06-16 (118,684 issue hours, four horizons
  each), from the existing replay of the production model. A second, short period (28 August to 9 November
  2026) is description only.
- **"Inside the lead":** the target water had already passed Point of Rocks at issue time. That holds for
  102,991 forecasts at 6 hours, 72,706 at 12 hours and 29,356 at 24 hours.

## 3. Results by the rule (inside the lead, mean absolute error in percent)

| Hours ahead | "No change" | Measured water | Gain | 95% interval | Verdict |
|---|---|---|---|---|---|
| 6 | 7.94 | 6.89 | 1.05 | 0.70 to 1.40 | unclear |
| 12 | 10.34 | 8.87 | 1.47 | 1.14 to 1.80 | adds information |
| 24 | 13.43 | 14.00 | −0.56 | −1.15 to −0.01 | adds nothing |

- The rule asked for a lower bound of at least 1.0 point. At 6 hours the gain is real (the interval is above
  zero) but its lower bound is 0.70.
- On rising water the measured-water forecast is better at 6 and 12 hours (13.3 against 11.1; 16.5 against
  13.9) and reads less low than "no change", so the two safety conditions hold.
- The 48 hour horizon is outside the rule: Point of Rocks almost never reaches that far.

## 4. Three things the verdict does not mean

1. **It is not new information for the app.** On the same forecasts, inside the lead:

   | Hours ahead | "No change" | Measured water | App's estimate held flat |
   |---|---|---|---|
   | 6 | 7.94 | 6.89 | 6.47 |
   | 12 | 10.34 | 8.87 | 8.63 |
   | 24 | 13.43 | 14.00 | 11.77 |

   The estimate already contains the Point of Rocks water. Holding it is not a fair rival of "no change" (it
   has a shorter stretch of time to bridge), but it is a forecast the app could show today.
2. **The 12 hour "yes" is fragile.** The same test fails in 2019 to 2026 (lower bound 0.92), in the second
   half of the record (0.83) and in the daily-wave season (0.04). Below 3,000 cfs the forecast is worse than
   "no change" (−0.82). Leaving out any single year keeps the gain between 1.37 and 1.57. These subset results
   are exploratory.
3. **At 24 hours it is a loss, not a draw.** The whole interval is below zero. Outside the daily-wave season
   there is a gain (+1.18); inside it a loss (−2.01). By month: gains from May to August and in January, losses
   from September to December.

## 5. Where it helps and where it hurts (description)

- **By flow, 6 hours ahead, inside the lead:** below 3,000 cfs worse (8.4 becomes 10.9); 3,000 to 6,000 cfs
  equal (8.1 and 8.1); 6,000 to 12,000 cfs better (7.1 becomes 4.9); 12,000 to 25,000 cfs better (8.1 becomes
  4.0); 25,000 to 50,000 cfs better (15.3 becomes 9.7).
- **By state, 6 hours:** rising 13.3 becomes 11.1; falling 8.3 becomes 5.4; steady 6.6 becomes 6.5.
- **Daily-wave season, 6 hours:** worse inside the season (8.2 becomes 9.3), better outside it (7.9 becomes
  6.0).
- **Large rises, 6 hours:** 23.3 becomes 21.0; the estimate held flat scores 19.0.
- **All hours, inside and beyond the lead:** "no change" against measured water: 8.2 and 6.7 at 6 hours, 11.2
  and 8.2 at 12, 16.7 and 13.3 at 24, 25.8 and 22.6 at 48. The estimate held flat: 6.6, 9.2, 14.6, 24.2.
- **It reads low.** The mean signed error inside the lead is −1.4, −1.9 and −3.0 percent at 6, 12 and 24
  hours, in steady water too. The cause is unknown. Too low is the unsafe direction.
- **A likely cause of the low-water loss is timing** (the daily wave shifted by a travel time that the earlier
  study could not confirm). The auditor's exploratory test with a 24 hour mean of Point of Rocks removes most
  of the wave-season loss, and most of the gain with it. That fits a timing error; it does not prove one.

## 6. What I had expected, and what came out

Written in the plan before any result:

- Gains at 6 and 12 hours in rising and falling water, about equal in steady water: **held.**
- Little or no gain at 24 hours, possibly worse in the daily-wave season: **held, and stronger than expected.**
- Little or no gain beyond the lead: **wrong.** The largest gains are there. "Beyond the lead" turned out to
  mean "high flow", where the river moves and the upstream change tells a lot. Inside against beyond is a split
  by flow, not a test of the lead. The rule judged the forecast mostly where it is weakest; that is a weakness
  of the rule's design, and the rule stands as written.

## 7. Recommendation

- **Do not start Stage 2 now.** The rule's verdict allows proposing it. I do not propose it yet, because
  nothing in Stage 1 shows that a forecast from measured water would beat what the app already has, and
  Stage 2 (more gauges, a neural network as one candidate) would be much larger than Stage 1.
- **Build the forecast archive first** (`analysis/forecast-archive-plan-2026-11-24.md`, awaiting the owner's
  word). Only stored forecasts can show whether anything beats today's forecast.
- **Then one cheap comparison,** after some weeks that include at least one rise: today's forecast, the
  estimate held flat and the measured-water forecast, scored on the same hours. The formulas exist. Decide on
  Stage 2 after that.
- **On the owner's original hope, a better 48 hour forecast:** Stage 1 adds nothing in its favour. Point of
  Rocks does not reach that far, and the gains at 24 hours inside the lead are negative.

## 8. Limits

- The verdicts are about "better than Little Falls held", not about today's forecast.
- Inside against beyond the lead is mixed up with flow.
- Travel times at low water are unconfirmed.
- Every hourly value has about 22 minutes of look-ahead, the same for every forecast compared.
- The long record holds mostly approved values, not the values the app saw at the time.
- The second period is short (12 weeks), provisional and mostly low water. There the measured-water forecast
  is worse than "no change" at 6 hours (13.1 against 9.9). The loss lies before 8 October, so it does not come
  from the weeks USGS later revised, and it matches the long record's low-water, wave-season result.
- The stored scores of today's forecast differ from an every-hour sample by 22 to 36 percent in their
  "no change" value, so no side-by-side is shown.

## 9. How this was checked

- Plan, independent plan audit (four required changes, all made), the owner's confirmation.
- The existing replay tool reproduced its earlier output byte for byte before it was used again.
- Written instructions, independent review in two passes, with the test case derived a second time by hand.
- Two blind analysts, Python and R: all eight output files are byte-identical. Every check passed in both.
- Third auditor: recomputed every deciding number with his own code (equal to six decimals), redid the
  interval for 12 hours and nine more cells, regenerated both analyses from scratch (byte-identical), found no
  look-ahead in 481,840 forecast rows, and matched 8 of 8 hourly values against USGS's live record.
- Not checkable: whether the two analysts were blind while working. Their code is independent in structure.
  One sentence in the Python analyst's report is inaccurate (his forecast function is handed the whole issue
  row; it does not read the truth).

## 10. Where the numbers are

| Statement | File |
|---|---|
| Verdicts, gains, intervals | `py/verdicts.csv`, `r/verdicts.csv` |
| Errors by horizon, lead, flow, state, season, rises | `py/metrics.csv` |
| Intervals for every cell | `py/intervals.csv` |
| Counts and reasons for unscored forecasts | `py/counts.csv` |
| Comparability check with today's forecast | `py/q4.csv` |
| Subset fragility, months, the 24 hour mean test, signed error | `RESULTS_AUDIT.md` |
| Every single forecast (large, rebuilt by the scripts) | `py/forecasts_A.csv`, `py/forecasts_B.csv` |

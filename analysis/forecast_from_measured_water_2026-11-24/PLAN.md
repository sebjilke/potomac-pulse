# Study plan: can water already measured upstream improve the Great Falls forecast? (Stage 1)

Version 2, 2026-11-24. Plan only. No code is written and nothing in the app, the hourly job or the model changes
under this plan. Version 1 is kept as `PLAN_v1.md`. The independent plan audit is `PLAN_AUDIT.md` (verdict: GO
WITH CHANGES); the rulings on it are in section 15. **Confirmed by the owner on 2026-11-24: "run stage 1 and
store forecasts".** The thresholds stay at 1.0 and 0.5 point: he was told they stay unless he says otherwise,
and he did not change them. The storing of forecasts is a separate task with its own plan
(`analysis/forecast-archive-plan-2026-11-24.md`).

## 0. In one minute

- The owner hoped a neural network could improve the 48 hour forecast (2026-11-24).
- Today's forecast does not read the upstream gauges itself. It takes the Weather Service forecast for Little
  Falls, shifts it in time and corrects its offset (CLAUDE.md, "Forecast (48h)").
- For some hours ahead, the water that will pass Great Falls has already passed the Point of Rocks gauge. How
  many hours depends on flow (section 1).
- Stage 1 asks one narrow question with files that already exist: **does that measured water add information
  to a forecast, beyond "no change", and at which hours ahead and flows?** No new model, no large data pull, no
  neural network.
- Stage 1 cannot say whether such a forecast beats today's forecast (section 11). It can close the idea cheaply
  if the measured water adds nothing, and it says where a later stage should look if it adds something.
- Later stages, each with its own plan and confirmation (section 12): gauges above Point of Rocks with a
  learned combining rule, where a small neural network is one of two candidates (Stage 2), and a fair
  comparison with today's forecast (Stage 3).

## 1. Facts this plan rests on (verified by the plan auditor unless marked)

- Forecast horizons of the app: 6, 12, 24 and 48 hours ahead (`FORECAST_HORIZONS`, `src/model/constants.js`).
- Scores of today's forecast: running totals since the reset of 2026-08-28
  (`/api/sync?endpoint=forecast-accuracy`, read 2026-11-24, about 925 scored forecasts per horizon):

  | Hours ahead | Forecast, mean absolute error | "No change" (Little Falls held) |
  |---|---|---|
  | 6 | 10.0% | 12.6% |
  | 12 | 11.3% | 16.7% |
  | 24 | 13.8% | 25.3% |
  | 48 | 17.1% | 39.9% |

  These totals have no timestamps. They come from visitors' browsers: posted when a page is drawn, at most
  every 2 hours per open page, only when a Weather Service forecast is present, never while a gauge is iced.
  They are not an even sample over time.
- The single forecasts are not stored with their inputs (TODO A3f). Today's forecast cannot be replayed.
- The model's travel time from Point of Rocks to Great Falls, by flow at Little Falls (`getFlowMultiplier`,
  `getPoRtoGFTravelTime`): 50.6 h at 1,000 cfs, 38.2 h at 1,600, 33.5 h at 2,000, 26.3 h at 3,000, 19.4 h at
  5,000, 14.6 h at 8,000, 11.5 h at 12,000, 7.4 h at 25,000, 4.9 h at 50,000.
- Consequence, allowing for the age of the newest reading the hourly job has: 6 hours ahead is covered by
  measured water in 88% of hours of the long record, 12 hours in 60% (below about 8,600 cfs), 24 hours in 24%
  (below about 3,060 cfs), 48 hours almost never.
- Existing replay of the production model: `analysis/replay_lag_2026-11-17/shadow_L.csv` (one row per hour,
  2011-12-01 to 2026-06-16; arm L has production-like input ages, production's checks and production's
  learning rhythm; every predicted row has a truth value). In arm L the newest Point of Rocks value is 2 hours
  old (`age_por_h = 2` on 122,995 of 125,099 predicted rows) and the newest Little Falls value 1 hour.
  `predictedCFS` is the shown estimate (corrected and capped). `historicPorCFS` equals the hourly file's Point
  of Rocks value at `histSrcTs`. Tool: `ci_backtest_harness_lag.mjs`, audited, option `--in=`. The model files
  are unchanged since that replay was built.
- A longer hourly file: `analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv`, same columns,
  ends 2026-11-09 23:00, pulled on 2026-11-10 and therefore before USGS revised Point of Rocks on 2026-11-13.
  Its last months are provisional values as of 10 November, not exactly what the app saw hour by hour.
- The list of large rises: `analysis/rising-limb-travel-backtest/rising_limb_events_python_v39.csv`, rows with
  `kept == 1` and `event_class == GATE` (21 rises; 20 before June 2026, one in October 2026).
- The rise and fall factor inside the estimate (the "PoR-delta correction" in `makeGFPrediction`) adds half of
  the Point of Rocks change since the time-shifted reading whenever that change exceeds 5%. It is active on
  45.7% of hours.
- The study of the revision could not confirm the travel time at low water (30 or 54 hours to Little Falls).
  From mid September to mid December a daily wave of 7 to 12% runs down the river.
- Not verified, and important: the Weather Service forecast very likely already routes the measured upstream
  water at the moment it is issued. If so, the only edge of a forecast built here is freshness (every hour,
  against one or two issues a day) and local timing.
- The owner's thresholds from the previous study, reused unless he changes them: a difference "matters" from
  1.0 point of error, "does not matter" below 0.5 point.

## 2. Questions

- **Q1.** For forecasts issued every hour: how much lower is the error of a forecast that adds the measured
  upstream change, compared with "no change", at 6, 12, 24 and 48 hours ahead?
- **Q2.** How does that differ between targets inside the measured lead and beyond it?
- **Q3.** How does it differ by flow range, in rising, steady and falling water, in large rises, and in the
  season of the daily wave?
- **Q4, descriptive only:** how do these scores sit beside the stored totals of today's forecast? No decision
  rests on Q4 (section 8).

## 3. Data (existing files first; nothing is modified)

- **Period A, the long record:** `shadow_L.csv` with `analysis/hourly_backtest_data_v361.csv`. Forecasts issued
  from 2012-12-01 (the first year is burn-in for the learned corrections, as in the studies closed on
  2026-11-11 and 2026-11-12) to 2026-06-16.
- **Period B, descriptive:** 2026-08-28 to 2026-11-09. The existing, unmodified tool is run once with
  `--in=<v39 file> --arm=L --gate=new --mode=hybrid --outdir=<new folder>`. First a regression check: the same
  command on the v361 file must reproduce `shadow_L.csv` byte for byte. If the tool cannot read the v39 file
  without changes, period B is dropped and Q4 is reported as "not answered". The tool is not modified.
- All new files go to `analysis/forecast_from_measured_water_2026-11-24/`. Every file has a generating script.
  No row is dropped silently: every issue hour gets a status.
- Limits: hourly medians, not 15 minute readings; about 22 minutes of look-ahead in every hourly value, the
  same for every arm; mostly approved values in period A, provisional values in period B.

## 4. What is compared (arms)

Notation, all from the replay row at issue hour `t`: `LF(t)` = `lfQ`, known from hour `lfSrcTs(t)`; `T_GL` =
`travelGFtoLF`; `hist(t)` = `histSrcTs`, the Point of Rocks hour the estimate at `t` used; `por(t)` =
`porSrcTs`, the newest Point of Rocks hour known at `t`. `Q(u)` = Point of Rocks flow of hour `u` in the hourly
file. Hours ahead `h` in {6, 12, 24, 48}; target `s = t + h`.

- **P-LF, "no change" (the baseline):** forecast = `LF(t)`. This is the app's own stored baseline.
- **R-LF, measured water (primary):** forecast = `LF(t) + Q(u*) − Q(u_LF)`.
  - `u*` = `hist(t) + h`, but not later than `por(t)`: the Point of Rocks hour of the water that will pass
    Great Falls at the target, as far as it has been measured.
  - `u_LF` = `hist(t) − round(T_GL) − (t − lfSrcTs(t))`: the Point of Rocks hour of the water that the Little
    Falls reading shows now.
  - In words: Little Falls as it reads now, plus the change in the upstream water between what is at Little
    Falls now and what will be there at the target.
  - It uses no learned correction, no cap, no Edwards Ferry blend and no rise and fall factor, so nothing is
    counted twice. It has the same anchor as the baseline and the same shape as today's forecast (a reading at
    Little Falls plus a change).
- **R-LFm, proportional variant (sensitivity):** forecast = `LF(t) × Q(u*) / Q(u_LF)`.
- **Reference levels, descriptive only:** the "now" estimate at the target, `predictedCFS` of the row at `s`
  (the level a forecast cannot beat with this method), and the estimate held, `predictedCFS` of the row at `t`.
- **Inside or beyond the lead:** inside when `hist(t) + h ≤ por(t)`; beyond otherwise (then `u* = por(t)`: all
  measured water is used and the forecast is flat after it).
- Issue hours where the row is not a prediction, where the estimate used no time-shifted reading, or where
  `Q(u*)` or `Q(u_LF)` is missing get a status and are not scored. Counts are reported per arm, horizon and
  reason.
- Check on made-up data before the real run: with a constant Point of Rocks series R-LF equals P-LF exactly,
  and a step in Point of Rocks appears in R-LF at the hour these rules say and with its full size, once.

## 5. No look-ahead (checked on every forecast)

1. Every value used for a forecast issued at `t` comes from the replay row at `t` or from a Point of Rocks hour
   not later than `por(t)`.
2. Travel times are those of the row at `t`.
3. The truth of the target is used only for scoring.
4. The analysis writes the source hour of every value. A check fails the run if any source hour breaks rule 1.

## 6. Truth and scoring

- Truth of target `s`: `truthFlow` of the replay row at `s`. All arms share it. Targets whose row has a hard
  flag or `truthInProdRange = 0` are not scored (counted).
- Error: `(forecast − truth) / truth` in percent. Primary: mean absolute error, to match the app's stored
  scores. Also: median absolute error, mean signed error, share off by more than 25%.
- Pairing: all arms are scored on the same `(t, h)` pairs.
- Uncertainty: block bootstrap, calendar-month blocks in period A (10,000 resamples), calendar-week blocks in
  period B, from one fixed index file used by both languages. Differences between arms are taken inside each
  resample.

## 7. Subsets (fixed now)

- Inside the lead, beyond the lead, all.
- Flow range at issue (the six production ranges) and state at issue (rising, steady, falling).
- Large rises: the 21 rises of section 1; forecasts issued from 48 hours before `event_t0` to `event_tp` (the
  peak).
- Daily-wave season (15 September to 15 December) against the rest of the year, at Little Falls below 3,000
  cfs.
- Era: 2012 to 2018, 2019 to 2026.

## 8. Decision rule (fixed before any result; period A only)

For each horizon `h` in {6, 12, 24}, on forecasts inside the lead: `D(h)` = mean absolute error of P-LF minus
that of R-LF, with its 95% interval.

- **ADDS INFORMATION at `h`**, all of:
  1. the lower bound of `D(h)` is at least 1.0 point;
  2. on forecasts issued in rising water, R-LF is not worse than P-LF by more than 0.5 point of mean absolute
     error;
  3. on those forecasts the mean signed error of R-LF is not lower than that of P-LF (too low on a rise is the
     unsafe direction);
  4. for `h = 24` only: condition 1 also holds outside the daily-wave season.
- **ADDS NOTHING at `h`:** the upper bound of `D(h)` is below 0.5 point.
- **UNCLEAR at `h`:** anything else.
- **Overall:** ADDS INFORMATION at 12 or 24 hours: propose the Stage 2 plan and the storing of forecast rows
  (Stage 3). ADDS NOTHING at 6, 12 and 24 hours: stop and record the idea as closed. Otherwise: report, and the
  owner decides.
- What the verdict means: "the measured water carries information beyond no change at that horizon". It does
  not mean "better than today's forecast".
- The 48 hour horizon and period B are reported and not judged.
- No retuning: arms, rules for `u*` and `u_LF`, subsets and thresholds are not changed after results are seen.
  Anything added later is labelled "exploratory".

**Q4, descriptive.** Before any side-by-side: P-LF is scored on every hour of period B and set beside the
stored "no change" totals (12.6, 16.7, 25.3, 39.9%). If the two differ by more than a fifth at a horizon, the
visitors' sample is declared not comparable at that horizon and no side-by-side is shown for it. Where they
are comparable, the report shows the skill against "no change" of R-LF and of today's forecast (20%, 32%, 45%
and 57% from the stored totals), with the warning that the samples, the months and the truth times differ.

## 9. What I expect (written before any result; guesses, not findings)

- 6 and 12 hours, inside the lead: R-LF beats "no change" by more than 1 point in rising and falling water and
  is about equal in steady water.
- 24 hours: the lead exists only below about 3,000 cfs, where the river changes slowly. Gain under 1 point. In
  the daily-wave season R-LF may be worse than "no change", because a wave shifted by a wrong travel time lands
  at the wrong hour.
- Beyond the lead: little or no gain.
- Large rises: a gain at 6 hours, little at 12 and beyond.
- Beside today's forecast: I expect its skill at 24 and 48 hours to stay out of reach, because it contains the
  rain forecast, and because the Weather Service very likely routes the same measured water already. The
  realistic prize, if any, is the first 6 to 12 hours between Weather Service issues.

## 10. Verification (CLAUDE.md "Analysis Verification")

- The replay is not rebuilt: Stage 1 reads the output of the audited tool; the model files are unchanged since.
  Period B needs one run of the unmodified tool after the regression check of section 3.
- A written analysis specification (sections 4 to 8 with exact column names, rounding and status rules, every
  choice still open closed) is reviewed by a fresh auditor before any analyst starts.
- **Blind dual-language:** one Python and one R analyst, separate and results-blind, each compute the forecasts
  and all metrics from the files and the specification alone. Results must agree within 0.01. If they diverge:
  stop and investigate; never average or pick one.
- **Third auditor** (never ran the analysis): cross-language agreement, method against this plan, the
  no-look-ahead check, data integrity, and a spot-check of at least 5 hourly values against the live USGS
  service, taken from hours outside 8 October to 13 November 2026 (USGS rewrote those values).
- Models: the orchestrator plans and writes the report; Sonnet for the specification draft, the tool run and
  the two analysts; Opus for the specification review and the third audit.

## 11. What Stage 1 cannot answer

- Whether a measured-water forecast beats today's forecast. Only stored forecast rows or an archive of Weather
  Service forecasts can settle that (Stage 3).
- Anything about rain that has not yet reached a gauge.
- The 48 hour horizon.
- Whether the travel time at low water is right. A wrong travel time lowers the score of R-LF; the study
  measures the forecast as the model's travel times make it today, not the best possible one.
- Flood detail: hourly medians smooth the onset of a rise.
- How a forecast would behave on values as the app saw them at the time; period A holds mostly approved values.

## 12. Later stages (outline only; each needs its own plan, audit and confirmation)

- **Stage 2, more lead from gauges above Point of Rocks.** New data pulls: the Potomac at Shepherdstown and
  Hancock, the Shenandoah at Millville, perhaps the Monocacy, hourly, 15 years, from USGS's new service. Two
  candidates with identical inputs (the last 72 hours of each gauge): a weighted sum and a small neural
  network. Testing by leaving out one year at a time. Rule fixed in advance: the simplest candidate within 0.5
  point of the best is kept. Two notes for that plan: a network needs numerical software this Mac does not
  have (installing is the owner's decision), and training a network cannot be repeated bit for bit in two
  languages, so the two-language rule would apply to the scoring and not to the training; that deviation would
  need the owner's ruling.
- **Stage 3, a fair comparison with today's forecast, and the hand-over design.** Needs the single forecasts
  stored with their inputs (TODO A3f; a change to the app and the job under the code-change protocol) or an
  archive of Weather Service river forecasts.

## 13. Work and cost

- About six agents in sequence: specification draft, specification review, tool run with regression check,
  two blind analysts, third auditor. No tool is built and no large data are pulled.
- The Mac must stay awake for the runs (lid open).
- Output: `REPORT.md` in this folder, written for the owner, with the verdict per horizon.

## 14. Decisions for the owner

1. **Confirm Stage 1 as planned**, or change it.
2. **Thresholds:** keep 1.0 point ("matters") and 0.5 point ("does not matter")?
3. **Separate and optional: start storing the forecasts now** (TODO A3f). The plan auditor's point: only
   stored forecasts can ever show whether anything beats today's forecast, and every week without them is lost.
   It is a change to the app and the hourly job, with its own plan, audit and release. Recommendation: yes, as
   its own small task, whatever Stage 1 shows.

## 15. Rulings on the plan audit (`PLAN_AUDIT.md`, 2026-11-24)

Accepted, and worked into this version:

- **MUST 1, the first primary arm counted part of the change twice.** Version 1 added the upstream change to
  the shown estimate, which already holds half of that change through the rise and fall factor. Replaced by
  R-LF as the auditor proposed (anchored on the Little Falls reading); the two estimate-based arms are dropped.
  A check on made-up data is added.
- **MUST 2, the look-ahead rule was an hour too generous.** Arm L knows Point of Rocks 2 hours late, not 1.
  `u*` is now `hist(t) + h`, capped at `por(t)`, which also settles rounding.
- **MUST 3, the baseline gave the tested arm a head start.** Both arms now share one anchor and one distance to
  bridge. A signed-error condition in rising water is added.
- **MUST 4, the comparison with today's forecast cannot carry a decision.** Q4 is descriptive only, with a
  comparability check fixed in advance.
- **SHOULD:** burn-in from 2012-12-01; the correct file and filter for the 21 rises, with `event_t0` and
  `event_tp` as the window; the 24 hour verdict must also hold outside the wave season; spot-checks avoid the
  revised weeks; "as the app saw them" replaced by "provisional as of 10 November".
- **NOTE:** the shares of hours inside the lead are corrected (section 1); the storing of forecasts goes to
  the owner now (section 14); the likely routing of measured water inside the Weather Service forecast is
  stated as a limit (sections 1 and 9).

Not followed:

- **Dropping period B altogether** (the auditor: "may not be worth its risk once Q4 is descriptive"). Kept as
  descriptive, because the side-by-side with today's forecast is what the owner asked about, and the cost is
  one run of an existing tool with a regression check. It is dropped without replacement if that run needs any
  change to the tool.
- **Keeping a version of the estimate-based arm** (offered by the auditor as an alternative). Not kept: one
  primary arm and one variant are enough for the question, and earlier studies (TODO D19, A7) showed that gains
  routed through the estimate are absorbed by the learned corrections and the cap.

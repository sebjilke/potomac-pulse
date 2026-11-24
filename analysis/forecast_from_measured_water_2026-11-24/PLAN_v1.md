# Study plan: can water already measured upstream improve the Great Falls forecast? (Stage 1)

Draft v1, 2026-11-24. Plan only. No code is written and nothing in the app, the hourly job or the model changes
under this plan. It needs (1) an independent plan audit and (2) the owner's confirmation before any analysis
code is written (CLAUDE.md, "Empirical Analysis Planning Protocol" and "Scientific/Modeling Work").

## 0. In one minute

- The owner hoped a neural network could improve the 48 hour forecast (2026-11-24).
- Today's forecast does not use the upstream gauges. It takes the Weather Service forecast for Little Falls,
  shifts it in time and corrects its offset (CLAUDE.md, "Forecast (48h)").
- Yet the water that will pass Great Falls in the coming hours has, for a while ahead, already passed the Point
  of Rocks gauge. How long "a while" is depends on flow (section 1).
- Stage 1 asks one narrow question with data and replay outputs that already exist: **how good is a forecast
  built only from that measured water, by hours ahead and by flow?** It needs no new model, no new data pull of
  size, and no neural network.
- Only if Stage 1 is promising do later stages make sense: gauges above Point of Rocks with a learned combining
  rule, where a small neural network is one of two candidates (Stage 2), and a fair, paired comparison with
  today's forecast (Stage 3). Each later stage needs its own plan and confirmation (section 12).

## 1. Facts this plan rests on (read on 2026-11-24)

- Forecast horizons of the app: 6, 12, 24 and 48 hours ahead (`FORECAST_HORIZONS`, `src/model/constants.js`).
- Scores of today's forecast, totals since the reset of 2026-08-28 (`/api/sync?endpoint=forecast-accuracy`,
  about 925 scored forecasts per horizon, posted by visitors' browsers, so not an even sample over time):

  | Hours ahead | Forecast, mean absolute error | "No change" (Little Falls held) |
  |---|---|---|
  | 6 | 10.0% | 12.6% |
  | 12 | 11.3% | 16.7% |
  | 24 | 13.8% | 25.3% |
  | 48 | 17.1% | 39.9% |

- The single forecasts are not stored with their inputs, only these totals (TODO A3f). Today's forecast can
  therefore not be replayed over the past.
- The model's own travel time from Point of Rocks to Great Falls, by flow at Little Falls
  (`getFlowMultiplier`, `getPoRtoGFTravelTime` in `netlify/functions/shared/model.js`): 50.6 h at 1,000 cfs,
  38.2 h at 1,600, 33.5 h at 2,000, 26.3 h at 3,000, 19.4 h at 5,000, 14.6 h at 8,000, 11.5 h at 12,000, 7.4 h
  at 25,000, 4.9 h at 50,000.
- Consequence: 6 hours ahead is covered by measured water at almost every flow; 12 hours below about 11,000
  cfs; 24 hours only below about 3,400 cfs; 48 hours almost never. The 48 hour horizon cannot be answered from
  Point of Rocks alone.
- Existing replay of the production model over the long record: `analysis/replay_lag_2026-11-17/shadow_L.csv`
  (one row per hour, 2011-12-01 to 2026-06-16; arm L has production-like input ages and production's checks;
  columns include `predTs`, `status`, `predictedCFS` (the shown, corrected estimate), `rawFinalCFS`,
  `historicPorCFS`, `histSrcTs`, `travelPoRtoGF`, `travelGFtoLF`, `flowBin`, `flowState`, `lfQ`, `truthFlow`,
  `errPctCorr`, the check flags). Tool: `ci_backtest_harness_lag.mjs`, audited (`TOOL_AUDIT.md`), option `--in=`.
- A longer hourly file exists: `analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv`, pulled on
  2026-11-10, so before USGS revised Point of Rocks on 2026-11-13. For October and early November 2026 it holds
  the numbers as the app saw them.
- The study of the revision could not confirm the travel time at low water (30 or 54 hours to Little Falls;
  `analysis/por_revision_and_wave_2026-11-22/REPORT.md`, section 4). A forecast built on the time shift
  inherits that doubt. From mid September to mid December a daily wave of 7 to 12% runs down the river.
- The owner's thresholds from the previous study, reused here unless he changes them: a difference "matters"
  from 1.0 point of error, "does not matter" below 0.5 point.

## 2. Questions

- **Q1.** For forecasts issued every hour, how large is the error of a forecast built from measured water, by
  hours ahead (6, 12, 24, 48), compared with "no change"?
- **Q2.** How does that depend on whether the target hour is still inside the measured lead (the water has
  already passed Point of Rocks at issue time) or beyond it?
- **Q3.** How does it depend on flow range, on rising, steady and falling water, on large rises, and on the
  season of the daily wave?
- **Q4.** Rough only: set beside today's forecast over the same months, is the measured-water forecast plausibly
  better, about equal, or worse, at each horizon?
- Not a question of Stage 1: whether a neural network helps (Stage 2), and a paired, fair comparison with
  today's forecast (Stage 3).

## 3. Data (existing files first; nothing is modified)

- **Period A, the long record:** `replay_lag_2026-11-17/shadow_L.csv` and
  `analysis/hourly_backtest_data_v361.csv` (hash in that folder's README), 2011-12-01 to 2026-06-16. The first
  72 hours are burn-in, as in that study.
- **Period B, the months of today's forecast scores:** 2026-08-28 to the last hour of
  `hourly_backtest_data_v39.csv`. The existing, unmodified, audited tool is run once more with
  `--in=<v39 file> --arm=L --gate=new --mode=hybrid --outdir=<new folder>` to obtain the same kind of rows.
  A regression check comes first: the same command on the v361 file must reproduce `shadow_L.csv` byte for byte.
  If the v39 file cannot be read by the tool without changes, period B is dropped and Q4 is reported as "not
  answered"; the tool is not modified under this plan.
- All new files go to `analysis/forecast_from_measured_water_2026-11-24/`. Every file has a generating script.
  No row is dropped silently: every issue hour gets a status.
- Known limits of these files: hourly medians, not 15 minute readings; about 22 minutes of look-ahead in every
  hourly value (the same for every arm, so it does not favour one); mostly approved values in period A and
  as-seen values in period B.

## 4. What is compared (arms)

Definitions: issue time `t` (every full hour with a scored replay row), hours ahead `h` in {6, 12, 24, 48},
target time `s = t + h`. `E(t)` is the shown estimate at `t` (`predictedCFS` of the row at `t`). `tau(t)` is
the Point of Rocks to Great Falls travel time in the row at `t` (`travelPoRtoGF`). `Q(u)` is the hourly Point
of Rocks flow of hour `u` in the hourly file. `Qused(t)` is the time-shifted Point of Rocks value the estimate
at `t` used (`historicPorCFS`).

- **P-LF, "no change" at Little Falls:** forecast = Little Falls flow at `t` (`lfQ`). This is the app's own
  baseline.
- **P-NOW, "no change" of the estimate:** forecast = `E(t)`.
- **R-add, measured water, additive (primary):** forecast = `E(t) + [Q(u*) − Qused(t)]`, where `u*` is the hour
  nearest to `s − tau(t)` and not later than `t − 1 h`. In words: today's estimate plus the change in the water
  that is already on its way. It carries the learned correction, the tributaries and the withdrawals of the
  present estimate forward unchanged.
- **R-mult, measured water, proportional (sensitivity):** forecast = `E(t) × Q(u*) / Qused(t)`.
- **N0, the "now" estimate at the target (reference, not a forecast):** `E(s)`. It shows the level a forecast
  could reach at best with this method.
- **Inside or beyond the lead:** a forecast is "inside the lead" when `s − tau(t) ≤ t − 1 h`, so `u*` is the
  hour the method wants. Otherwise it is "beyond the lead" and `u* = t − 1 h` (all measured water is used, then
  the forecast is flat). Both groups are reported separately and together.
- Rows where `E(t)` used no time-shifted reading (`useTimeShifted = 0`), or where a needed value is missing,
  get a status and are not scored; counts are reported per arm, horizon and reason.
- No cap is applied to any forecast arm. The 120% display cap is tied to the Little Falls reading of the
  moment and would cut off a forecast rise. `E(t)` itself is the shown value, cap included; a variant with the
  uncapped estimate (`rawFinalCFS − correctionApplied`) in place of `E(t)` is reported as a sensitivity.

## 5. No look-ahead (rules checked on every forecast)

1. Every value used for a forecast issued at `t` comes from a replay row at or before `t`, or from an hourly
   Point of Rocks row at or before `t − 1 h` (the convention of arm L for "known at `t`").
2. The travel time is `tau(t)`, never `tau(s)`.
3. The truth of the target is used only for scoring.
4. The analysis writes, for every forecast, the source hour of each value. A check script fails the run if any
   source hour breaks rule 1.

## 6. Truth and scoring

- Truth of target `s`: `truthFlow` of the replay row at `s` (the Little Falls value the estimate made at `s`
  was scored against, at `s` plus the Great Falls to Little Falls travel time). All arms share it. Targets whose
  row has no truth, a hard flag or `truthInProdRange = 0` are not scored (counted).
- Error of a forecast: `(forecast − truth) / truth`, in percent. Reported: mean absolute error (primary, to
  match the app's stored scores), median absolute error, mean signed error, share of forecasts off by more than
  25%.
- Pairing: all arms are scored on the same set of `(t, h)` pairs, the pairs where every arm has a forecast and
  the target has a truth.
- Uncertainty: block bootstrap with calendar-month blocks in period A (10,000 resamples) and calendar-week
  blocks in period B, from one fixed index file used by both languages. Differences between arms are computed
  inside each resample.

## 7. Subsets (fixed now)

- Inside the lead, beyond the lead, all.
- Flow range at issue (the six production ranges) and state at issue (rising, steady, falling), from the row
  at `t`.
- Large rises: the event list of the study closed on 2026-11-12
  (`analysis/multipending-responsiveness-plan-2026-11-11.md`, 21 rises), forecasts issued from 48 hours before
  each onset to the peak. If that list cannot be reused as it stands, this subset is dropped, not redefined.
- Daily-wave season (15 September to 15 December) against the rest of the year, at Little Falls flows below
  3,000 cfs.
- Era: 2011 to 2018, 2019 to 2026.

## 8. Decision rule (fixed before any result)

For each horizon `h` in {6, 12, 24}:

- `D1(h)` = mean absolute error of P-LF minus that of R-add, period A, forecasts inside the lead, with its 95%
  interval.
- For period B, all forecasts (inside and beyond the lead): `S_app(h)` = skill of today's forecast against its
  own "no change" baseline from the stored totals (1 − 10.0/12.6, 1 − 11.3/16.7, 1 − 13.8/25.3). `E_adj(h)` =
  the every-hour error of P-LF in period B times `(1 − S_app(h))`: what today's forecast would score on every
  hour if its skill carried over. This step is an assumption, which is why Q4 is called rough.
- **PROMISING at `h`:** the lower bound of `D1(h)` is at least 1.0 point, AND R-add in period B is at least 1.0
  point below `E_adj(h)`, AND on forecasts issued in rising water (period A, inside the lead) R-add is not worse
  than P-LF by more than 0.5 point.
- **NOT PROMISING at `h`:** the upper bound of `D1(h)` is below 0.5 point, OR R-add in period B is not at least
  0.5 point below `E_adj(h)`.
- **UNCLEAR at `h`:** anything else.
- **Overall:** PROMISING at 12 or 24 hours: propose the Stage 2 plan. NOT PROMISING at 6, 12 and 24 hours: stop;
  record the idea as closed. Otherwise: report, and the owner decides.
- The 48 hour horizon is reported and not judged: Point of Rocks does not reach that far (section 1).
- No retuning: the arms, the rounding rule for `u*`, the subsets and the thresholds are not changed after
  results are seen. Anything added later is labelled "exploratory".

## 9. What I expect (written before any result; guesses, not findings)

- Inside the lead at 6 and 12 hours: R-add ends 1 to 3 points above the "now" level N0 and clearly beats "no
  change" in rising and falling water; about equal in steady water.
- At 24 hours the lead exists only at low flow, where the river changes slowly and "no change" is already
  good: gain under 1 point. In the daily-wave season R-add may be worse than "no change", because a wave that is
  shifted by the wrong travel time lands at the wrong hour.
- Beyond the lead: R-add equals P-NOW in effect; no gain.
- Large rises: a gain at 6 hours, little at 12 hours and beyond, because the lead shrinks to 5 to 12 hours at
  those flows.
- Against today's forecast (rough): better at 6 hours, about equal at 12, worse at 24 and 48, where the rain
  forecast inside the Weather Service forecast counts. If that is the result, the realistic prize is a forecast
  that uses measured water for the first 6 to 12 hours and the Weather Service after that.

## 10. Verification (CLAUDE.md "Analysis Verification")

- The replay itself is not rebuilt: Stage 1 reads the output of the audited tool. Period B needs one run of
  the unmodified tool, preceded by the byte-for-byte regression check of section 3.
- A written analysis specification (the formulas of sections 4 to 8 with exact column names, rounding and
  status rules) is reviewed by a fresh auditor before any analyst starts.
- **Blind dual-language:** one Python and one R analyst, separate, results-blind, each compute the forecasts and
  all metrics from the files and the specification alone. Results must agree within 0.01. If they diverge: stop
  and investigate; never average or pick one.
- **Third auditor** (never ran the analysis): cross-language agreement, method against this plan, the
  no-look-ahead check, data integrity, and a spot-check of at least 5 hourly values against the live USGS
  service.
- Models: the orchestrator plans and writes the report; Sonnet for the specification draft, the tool run and the
  two analysts; Opus for the plan audit, the specification review and the third audit.

## 11. What Stage 1 cannot answer

- Whether the measured-water forecast beats today's forecast. Q4 compares totals from different samples
  through an assumption. Only stored forecast rows or an archive of Weather Service forecasts can settle it
  (Stage 3).
- Anything about rain that has not yet reached a gauge. That is the Weather Service forecast's strength and it
  dominates in large rises and at 24 to 48 hours at normal and high flow.
- The 48 hour horizon.
- Whether the travel time at low water is right. A wrong travel time lowers the score of R-add; the study
  measures the forecast as the model would make it today, not the best possible one.
- Flood detail: hourly medians smooth the onset of a rise.
- Period B is short (about ten weeks) and holds one flood.

## 12. Later stages (outline only; each needs its own plan, audit and confirmation)

- **Stage 2, more lead from gauges above Point of Rocks.** New data pulls: the Potomac at Shepherdstown and
  Hancock, the Shenandoah at Millville, perhaps the Monocacy at Frederick, hourly, 15 years, from USGS's new
  service. Two candidates with identical inputs (the last 72 hours of each gauge): a weighted sum (the simple
  one) and a small neural network. Testing by leaving out one year at a time. Rule fixed in advance: the
  simplest candidate within 0.5 point of the best is kept. Two notes for that plan: a network needs numerical
  software this Mac does not have (installing is the owner's decision), and training a network cannot be
  repeated bit for bit in two languages, so the two-language rule would apply to the scoring and not to the
  training; that deviation would need the owner's ruling.
- **Stage 3, a fair comparison with today's forecast and the hand-over design.** Needs the single forecasts
  stored with their inputs (TODO A3f; a change to the app and the job under the code-change protocol) or an
  archive of Weather Service river forecasts. Storing could start early, so that rows accumulate while Stage 1
  and 2 run; it is a separate decision.

## 13. Work and cost

- Stage 1 uses about seven agents in sequence: specification draft, specification review, tool run and
  regression check, two blind analysts, third auditor, plus this plan's audit. It is smaller than the study of
  the Point of Rocks revision, because no tool is built and no large data are pulled.
- The Mac must stay awake for the runs (lid open).
- Output: `REPORT.md` in this folder, written for the owner, with the verdict per horizon.

## 14. Points the plan audit should attack

1. Is R-add the right way to "run the now method forward", or does adding the upstream change to the present
   estimate hide a flaw (for example the tributaries held fixed, or the rise and fall factor inside `E(t)`
   counting part of the coming change twice)?
2. Is the rule for `u*` free of look-ahead, given that hourly values are medians keyed by the hour start?
3. Is the truth of the target the right one, and are forecasts and truth independent enough (the estimate at
   `s` and its truth share a row)?
4. Is the step from the app's stored totals to `E_adj(h)` defensible as a rough screen, or should Q4 be
   dropped?
5. Are the thresholds and the three conditions of "PROMISING" sensible, and can the rule be gamed by the choice
   of subsets?
6. Is anything in the closed studies (`TODO.md`, the verdict files in `analysis/`) a reason not to run this at
   all?

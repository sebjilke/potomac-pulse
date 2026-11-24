# Plan audit: forecast from measured water, Stage 1 (PLAN.md draft v1)

Auditor: independent, did not write the plan. Date: 2026-11-24. Read-only. The only analysis I ran was counting
statuses and flags and checking that columns agree. I computed no error and compared no arms.

## Verdict

**GO WITH CHANGES.** The question can be answered cheaply from existing files. But the primary arm counts part of
the change twice. The lead rule uses Point of Rocks one hour fresher than arm L. And the decision rule rests on a
baseline the arm beats by construction, plus a Q4 step that cannot carry a verdict. Findings 1 to 4 must be fixed
before the specification is written.

## Findings (most serious first)

### 1. MUST: R-add counts part of the coming change twice (and scales the tributaries with it)

- **Evidence.** `makeGFPrediction`, `netlify/functions/scheduled-update.js` lines 1007 to 1023. When Point of Rocks
  has changed by more than 5% since the time-shifted reading, the Point of Rocks estimate becomes
  `(historicPoR + tributaries) × (1 + (por.q/historicPoR − 1) × decay)`. `fractionElapsed` is
  `histAgo / tau`, which is about 1 by construction, so `decay = min(0.50, sqrt(...)) = 0.50`.
- Counted in `shadow_L.csv` (predicted rows that used the time-shifted reading): `deltaOn = 1` on 56,476 of
  123,458 rows (45.7%). `decay` is exactly 0.50 on all 56,476.
- So on almost half the hours, `E(t)` already holds about half of `(porQ − Qused)`, multiplied by
  `(1 + tributaries/Qused)`. R-add then adds `Q(u*) − Qused(t)` in full. Beyond the lead, `Q(u*) = porQ`, so the
  forecast carries about 1.5 to 1.6 times the measured change. Inside the lead the overlap is partial. It also
  jumps when |pct| crosses 5%. R-mult has the same flaw.
- A7 found the same mechanism hurts on rising limbs: "Scaling the tributaries with the Point of Rocks change ...
  is the larger source of rising-limb overestimate in the uncapped number"
  (`analysis/rising-limb-travel-verdict-2026-11-11.md`).
- **Recommended primary arm: R-LF, anchored on observed Little Falls.**
  `F = lfQ(t) + Q(u*) − Q(u_LF)`. Here `u*` is the hour of the water that reaches Great Falls at `s` (below), and
  `u_LF = lfSrcTs(t) − travelGFtoLF(t) − tau(t)`, rounded to the hour, is the hour the water now at Little Falls
  passed Point of Rocks. Both values are known at `t` whenever `u*` is.
  - It needs none of `E(t)`'s machinery: no PoR-delta factor, no cap, no learned correction carried into a state
    it may leave, no Edwards Ferry blend.
  - It has the same anchor as P-LF, so `P-LF minus R-LF` isolates exactly what measured water adds.
  - It has the same shape as the app's forecast ("observed LF plus a predicted change", `great-falls-ui.js`
    lines 426 to 466), so a later Stage 3 compares like with like.
  - Cost: one more hourly lookup per forecast; no new data and no tool run.
  - Weakness: no tributary or withdrawal change is added. That is the same as R-add. State it.
- **If R-add is kept (as secondary):** build it from the estimate with the delta factor removed. Use the
  uncapped value `rawFinalCFS − correctionApplied`. Then subtract the part the delta factor added:
  `(1 − efWeight) × (porEstimateCFS − preCfs)`, where `preCfs = historicPorCFS + the four tributary flows`. The
  tributary flows include the model's fallbacks when a gauge is missing. `efWeight` is blank when Edwards Ferry
  was skipped; treat it as 0.
  - Pre-register whether the increment is the full `ΔQ` or `(1 − efWeight) × ΔQ`.
- **Add an identity check for every arm** (in the specification and the check script): at `h = 0` the forecast
  must equal its anchor exactly (`E(t)`, or the de-deltaed `E(t)`, or `lfQ(t)`).

### 2. MUST: the look-ahead rule uses Point of Rocks one hour fresher than arm L

- **Evidence.** Plan section 5 rule 1 says Point of Rocks rows "at or before `t − 1 h` (the convention of arm L for
  'known at `t`')". That is wrong. Arm L takes Point of Rocks, Edwards Ferry, Goose Creek and the water
  temperature from `t − 2 h`; only Little Falls and the other tributaries come from `t − 1 h`
  (`replay_lag_2026-11-17/README.md`, "What the replay does"). Counted in `shadow_L.csv`: `age_por_h = 2` on
  122,995 of 125,099 predicted rows (2, 3, 4, 5 h on the rest, from gap filling). In every row I looked at,
  `porSrcTs = predTs − 2 h`.
- The row at `t − 1 h` holds readings up to `t`. Production's Point of Rocks reading is about 66 minutes old
  (replay-lag `PLAN.md` section 2). So `u* = t − 1 h` gives the measured-water arms about an hour of water that
  production does not have. That favours exactly the arms under test, so the claim "the same for every arm" in
  section 3 does not hold for this rule.
- **Change.** Define `u* = histSrcTs(t) + h`, capped at `porSrcTs(t)`. This is the same hour grid and the same
  `tau(t)` the estimate used, so `h = 0` gives back `histSrcTs` exactly (see the identity check in finding 1).
  "Inside the lead" becomes `histSrcTs(t) + h ≤ porSrcTs(t)`. A missing hourly row at `u*` gets a status and is
  not filled.
- This also removes the open tie-breaking question of "nearest hour".
- Effect on the population (counts only, using the `tau − h` threshold): inside the lead falls from 91.3% to
  88.1% at 6 h, from 64.8% to 60.2% at 12 h, and from 26.1% to 23.6% at 24 h. At 48 h it is 0.1%.

### 3. MUST: the decision baseline gives any arm anchored on `E(t)` a free head start

- `E(t)` is scored against Little Falls at `t + g`, where `g` is the Great Falls to Little Falls travel time
  (`truthFlow` at `tauTs`). The target truth is Little Falls at `s + g`. So P-NOW has a gap of `h` hours to
  bridge. P-LF (`lfQ` from `t − 1 h`) has a gap of `h + g + 1` hours. `g` is 8.8 h at 3,000 cfs and 17.0 h at
  1,000 cfs (recomputed, below).
- `D1 = MAE(P-LF) − MAE(R-add)` therefore credits R-add with the nowcast's own head start, which has nothing to do
  with measured water reaching the target. Condition 1 of PROMISING is close to automatic. The rising-water
  condition ("R-add not worse than P-LF by more than 0.5") is close to vacuous, because P-LF ignores every rise.
- Result: the verdict is decided by Q4 alone (finding 4). A PROMISING result can be useless (R-add equal to
  P-NOW: no gain from measured water). A NOT PROMISING result can come from Q4's assumption alone.
- **Change.** Make the primary contrast "measured water against the same anchor without it":
  - with R-LF: `D1 = MAE(P-LF) − MAE(R-LF)`, inside the lead;
  - with R-add: `D2 = MAE(P-NOW) − MAE(R-add)`, inside the lead.
  - Require the lower bound of that contrast to be at least 1.0 point for PROMISING.
  - Do the rising-water check against the same anchor.
- **Add a safety check on direction**, the A7 lesson (too low on a rising river is the unsafe direction): on
  rising water, the mean signed error of the primary arm must not be more negative than its anchor's by more
  than a fixed margin.

### 4. MUST: Q4 and `E_adj` cannot carry decision weight

The step `E_adj(h) = MAE_P-LF,every hour,B × (1 − S_app(h))` assumes the app's skill ratio carries over from the
visitor sample to every hour. In this case the two samples differ in known, signed ways:

- **Different windows.** The stored totals are cumulative counters with no timestamps (live GET on 2026-11-24:
  929, 927, 926, 924 validations; 10.02/12.56, 11.32/16.71, 13.83/25.35, 17.07/39.91 per horizon). They cover
  2026-08-28 to 2026-11-24 and cannot be cut. The v39 file ends 2026-11-09 23:00 (130,416 rows; 1,776 hourly rows
  from 2026-08-28). Two of the roughly 12.5 weeks are not in period B.
- **Visitor timing.** Rows are posted at render time by browsers (`great-falls-ui.js` line 633), at most once per
  2 h per page session. The throttle lives in memory and resets on every page load (`gf-learning.js` line 162).
  - Only NWS-based rows are posted, and none while a critical gauge is iced (`gf-learning.js` lines 154 to 175).
  - The sample therefore leans to waking hours and to busy days, and many visitors in one hour post near-copies.
    The effective n is far below 929.
  - From mid September the daily wave gives a time-of-day error cycle of about 5 points
    (`por_revision_and_wave_2026-11-22/REPORT.md` section 4). A daytime-heavy sample sits on one phase of that
    cycle.
- **Different truth clock.** The app scores against `lf.q`, the latest reading at the first hourly run at least
  15 min after `targetTime + travel`. That travel is recomputed from Little Falls at validation time
  (`scheduled-update.js` lines 2148, 2215 to 2221, 2244). The replay scores at `tauTs`, with travel from the row
  at `s`. So P-LF in period B is not the stored "persistence", even on the same hours.
- **No interval.** The rule compares point values. Period B has one flood (Little Falls peak 24,300 cfs on
  2026-10-14; 12 to 19 October) and about ten weeks.
- **Change.**
  - Drop Q4 from both PROMISING and NOT PROMISING. Report it as a descriptive table only, labelled rough.
  - Pre-register one representativeness check: replay P-LF over period B against the stored persistence numbers,
    per horizon. If they differ by more than a fixed tolerance (say 3 points), print "Q4 not answered".
  - Optional and more costly: weight the issue hours of period B by GoatCounter hourly page views (needs an API
    token; an owner decision).
  - If Q4 becomes descriptive, the period B tool run becomes optional (see finding 12).

### 5. SHOULD: the base `E(t)` is the capped value

- The cap binds on 4,876 of 125,099 predicted rows (3.9%) overall. On rising limbs it bound on 52.5% of hours
  (A7 verdict). An increment added to a capped base mixes "the display cap at `t`" with "the forecast change".
- If R-add stays, its primary base should be the uncapped corrected value with the delta factor removed (finding
  1). Keep the capped `E(t)` as the sensitivity, the reverse of the plan.

### 6. SHOULD: the large-rise subset is cited wrongly and is not fully specified

- The list is not in `multipending-responsiveness-plan-2026-11-11.md`. It is the frozen file
  `analysis/rising-limb-travel-backtest/rising_limb_events_python_v39.csv`. I recomputed its SHA-256:
  `978c6c2f…cac44`, which equals the hash quoted in that plan's line 124. The 21 events are the rows with
  `kept == 1` and `event_class == GATE` (I counted 21).
- 20 of the 21 lie in period A. Event 53 (October 2026, `oct == 1`) lies only in period B.
- "Onset" is ambiguous: `event_t0` and `rl_start` differ by 12 h in every kept row I printed. "Peak" should be
  `event_tp`.
- **Change.** Name the file, the hash, the filter, the onset column and the peak column. State that the subset is
  20 events in period A and 1 in period B.
- The list is reusable as it stands: it is frozen and hashed, and it is an input selection, not a result of this
  study.

### 7. SHOULD: 72 hours of burn-in is too short for forecasts built on `E(t)`

- The bins start empty (`replay_lag` README, simplification 5). A6 and A7 used burn-in to 2012-12-01, and the
  event list already excludes earlier rises.
- **Change.** Use `predTs ≥ 2012-12-01` for period A. Report the 72 h version as a sensitivity, or drop it.
- This matters less for R-LF.

### 8. SHOULD: verification and data facts for period B need fixing

- **Spot-checks.** Live USGS Point of Rocks values from 8 October to 13 November were rewritten on 13 November,
  by up to 29% (REPORT.md section 3). A spot-check of period B Point of Rocks against the live service will fail
  by design.
  - Spot-check period B against the saved pre-revision copy (`rising-limb-travel-backtest/raw/`), or against
    Little Falls and the tributaries (not revised), or against dates before 8 October.
  - State which, in advance.
- **The v39 run has never been audited.** The third auditor should check the status counts, the `histSrcTs` and
  `historicPorCFS` identity (see "Verified"), and the 7-hour gap at 2026-07-20 16:00 to 2026-07-21 00:00.
- **Section 1 overstates the data.** "For October and early November 2026 it holds the numbers as the app saw
  them" is too strong.
  - The appended rows are provisional values as of the 2026-11-10 fetch (`hourly_backtest_data_v39.PROVENANCE.txt`).
    Between the v38 and v39 fetches, June and July Point of Rocks already moved by a median of −4.3%, so
    provisional values do change before a formal revision.
  - Reword it as "provisional values as of 2026-11-10, before the 2026-11-13 revision".
  - Also say that the replayed `E(t)` in period B is not the app's estimate: the bins are replayed from 2011,
    the data are hourly medians, and ice handling is not replayed.

### 9. SHOULD: the daily wave and the low-flow travel time hit exactly the 24 h lead population

- At 24 h, inside the lead means below about 3,060 cfs (with arm L's age). That is the regime where the travel
  time is in doubt (30 or 54 h to Little Falls; the model assumes about 49 h). It is also where, from mid
  September to mid December, Point of Rocks swings 7 to 12% while Little Falls swings only 3 to 6%.
- REPORT.md section 4 also says the PoR-delta factor "happens to cancel" the wave inside `E(t)`. R-add removes
  that cancellation and adds the unattenuated swing.
- **Change.** For a PROMISING verdict at 24 h, also require that it holds outside the wave season. This subset is
  already fixed in section 7, so it adds nothing after the fact.

### 10. NOTE: the lead figures in section 1 are optimistic

- Recomputed, steady state: travel equals 13 h at 9,770 cfs, 14 h at 8,630, 25 h at 3,260, 26 h at 3,060, 7 h at
  27,600 and 8 h at 22,050.
- With the plan's own 1 h rule, 12 h is covered below about 9,800 cfs, not 11,000. With arm L's 2 h age it is
  about 8,600 cfs. At 24 h the figures are about 3,260 and 3,060, not 3,400.
- On a rising river the travel time is cut by up to 30% (`getPoRtoGFTravelTime`), which shrinks the lead further.

### 11. NOTE: open choices to fix in the specification, not after the results

- The block of a forecast (issue month or target month).
- Which pairs feed P-LF in `E_adj`, if Q4 is kept.
- Comparisons at full precision.
- JavaScript round-half-up against Python and R rounding: the one `historicPorCFS` mismatch I found is 964.5
  against 965.
- `efWeight` blank.
- Whether the learned correction at `t` is carried at its value or as a share of the raw estimate. The rising
  bins subtract more than the steady bins (6.9% against 5.2%, `replay_lag_FINAL.md`), and the state at `s` may
  differ.
- Whether R-add's increment is full or `(1 − w)` (finding 1).

### 12. NOTE: scope

- If Q4 becomes descriptive, the period B tool run serves only that table and the one October event. That run is
  the step with the most risk: new data, an unaudited output, and spot-checks complicated by the revision.
  Consider dropping period B from Stage 1, or keeping it explicitly descriptive.
- R-LF needs no new tool run in period A.
- Truth coverage is not a real problem in period A: every `predicted` row in `shadow_L.csv` (125,099) has
  `truthFlow`. The non-scored hours are `no_por` 1,014, `no_truth` 911 and `no_lf` 439. Still report the
  dropped pairs by flow range and season, as a cheap representativeness check.

### 13. NOTE: prior work

- No closed study answers this question or makes it pointless.
- Two studies show that measured-water gains routed through `E(t)` get eaten by the state bins and the cap:
  - D19 / `replay_lag_FINAL.md`: a fresher Point of Rocks reading was 0.35 points worse on rising water, through
    the state classifier and the rising bins.
  - A7: a better raw estimate gave a worse displayed one, through the cap.
  - Both argue for the LF-anchored arm (finding 1).
- `ema_forecast_learning_plan.md` (forecast-based learning, rejected) does not bear on this.
- Unverified: the NWS Little Falls forecast probably already routes upstream observed flows. A PROMISING result
  against persistence would then say nothing about value beyond the app's forecast. Only stored forecasts (TODO
  A3f) settle that, and they take months to accumulate. The storage decision is the long pole and should be put
  to the owner now, not after Stage 1.

### 14. NOTE: verification section against CLAUDE.md

- "The replay is not rebuilt" is acceptable:
  - The tool was audited.
  - `git log 81c5c78..HEAD` (81c5c78 is the commit the replay was built at, per its README) is empty for
    `scheduled-update.js` and `shared/model.js`.
  - The byte-for-byte regression check on `shadow_L.csv` guards the rest.
- Missing items:
  - Name the output files per CLAUDE.md (`*_python.csv`, `*_R.csv`, `*_audit.md`).
  - Give every new CSV its generating script.
  - Make the plan's section 5 check script also verify the `h = 0` identity (finding 1).

## Facts in section 1 verified as correct

- `FORECAST_HORIZONS = [6, 12, 24, 48]` (`src/model/constants.js` line 153).
- The stored totals match the live endpoint (GET on 2026-11-24): 10.0/12.6, 11.3/16.7, 13.8/25.3, 17.1/39.9; 924
  to 929 validations per horizon. The rows are posted by browsers and deleted after scoring, so the single
  forecasts with their inputs are not stored.
- "Persistence" in the scores is the observed Little Falls flow at issue time (`great-falls-ui.js` line 525). It
  is scored against Little Falls at the first hourly run at or after `targetTime + travel + 15 min`, for NWS-path
  rows (`scheduled-update.js` lines 2215 to 2244, 2270 to 2274).
- Point of Rocks to Great Falls travel times, recomputed with `node` from `shared/model.js`: 50.6, 38.2, 33.5,
  26.3, 19.4, 14.6, 11.5, 7.4, 4.9 h at 1,000 to 50,000 cfs. Exact.
- Facts about `shadow_L.csv`:
  - The period is 2011-12-01T05:00Z to 2026-06-16T03:00Z (127,463 rows).
  - The statuses are `predicted`, `no_por`, `no_truth` and `no_lf`.
  - It was made with `--gate=new --mode=hybrid`.
  - `predictedCFS` is the corrected value after the cap (`makeGFPrediction` line 1101).
  - `travelPoRtoGF`, `historicPorCFS`, `histSrcTs` and `lfQ` exist.
  - `historicPorCFS` equals the rounded `por_now` of the hourly file at `histSrcTs` on 123,457 of 123,458 rows
    (the one exception is a rounding tie). So there is no unit or timing mismatch between `Q(u)` and `Qused`.
  - `porQ` equals `por_now` at `porSrcTs` on every row.
- "Hybrid" mode: one pending learning slot, as in production, plus an hourly shadow prediction with the bins as
  they stand, never learned from. Bins are learned per arm from empty.
- The v39 file has the same header as v361. The tool's loader reads columns by name, and `--in=` exists. So it can
  plausibly read v39 unchanged (not run, by instruction). The file was fetched on 2026-11-10, before the
  13 November revision.
- At 48 h the lead is essentially never available (0.1% of hours).

## What I could not check

- Whether the tool actually runs on v39 and reproduces `shadow_L.csv` byte for byte. Not run, by instruction.
- How the replayed `E(t)` in period B compares with the estimate the app actually showed.
- The NWS forecast's issue times and whether it routes upstream observations.
- GoatCounter hourly data (not accessed).
- The real distribution of visitor posting hours. No timestamps are kept with the totals.

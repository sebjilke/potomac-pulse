# Cap study: does the 120% cap do a good job, and is there a better rule?

Plan version 2, 2026-11-26 (written 2026-11-27 UTC). Version 1 is kept as `PLAN_v1.md`. The independent audit is `PLAN_AUDIT.md` (verdict "proceed after changes", 16 findings). Section 16 holds the ruling on each finding. No analysis code is written before the owner's confirmation of the method (section 17).

Started on the owner's word of 2026-11-26 ("study the cap"). His doubt: on a fast rise the water at Great Falls reaches Little Falls hours later, so the true value can be far above 120% of the current Little Falls reading, and the cap then makes the app read low. His ideas: switch the cap off unless ice is plausible; or let the cap's threshold depend on how fast the river is predicted to rise.

The owner's "no further replay study" of 2026-11-26 applies to the onset question (TODO D20). This study was started separately on his word of the same day. It needs no new replay.

## 0. What the owner should know first

- **The cap's original evidence does not answer his question.** The three searches of February 2026 that chose 120% set the cap at 120% of the same Little Falls value the estimate was scored against. With the cap built from the truth itself, a cap could never make an hour worse and could never produce a reading below the truth. Those searches could not see a cap that lags behind a rising river.
- **This study can.** The replay of the onset study holds, for every hour of 2012 to 2026, the estimate before the cap, the Little Falls reading the cap used, and what arrived at Little Falls one travel time later.
- **Every rule in this study only loosens the cap.** On every hour each rule's limit is at least as high as today's. So a rule can only raise a shown value. It can only take hours out of "reads badly low" and only put hours into "reads badly high". This is why the benefit is now measured on both sides at once (section 5). Version 1 measured it on the low side only, which no rule could fail.
- **The reach of any cap rule is small, and known before the run.** A rule can change only hours on which today's cap binds: about 4% of all hours (2,137 of 59,999 scored hours in 2012 to 2019; 2,511 of 59,448 in 2020 to 2026), and 14.4% of rising hours in 2020 to 2026 (1,302 of 9,059). A capped hour reads badly low today only if the truth is at least 1.41 times the Little Falls reading. A fixed cap of 135% can lift such an hour out of "badly low" only if the truth is below 1.59 times that reading; 150% below 1.76 times; 200% below 2.35 times. Rising hours on which the cap does not bind, and which an earlier study found already too low on large rises, are out of reach of every rule here.
- **A result here does not lead to a build.** It leads to a check on this week's rise from the app's own log, which is outside the replay data.

## 1. Questions

1. **Description:** what does the cap do as it is? The shown estimate with the cap against the same estimate without it, with a reading fixed in advance (section 6).
2. **Test:** is there a looser rule that is less often badly off on rising water without making the overall error worse?

## 2. What is known

Read on 2026-11-26 by a fact gatherer and re-read by the plan auditor; "code" means read in the source or the data, "document" means read in a report. Counts marked (checked) were counted a second time by the orchestrator with an own script on the main replay file; no estimate was compared with the truth in any of these counts.

1. **The rule** (code, `netlify/functions/shared/model.js:705-721`, constant at `:502`): `corrected = raw − correction`; if `corrected > 1.20 × Little Falls reading` the shown value is `1.20 × that reading`. Nothing on the low side. The cap acts on the corrected value, so a large correction can keep it from binding.
2. **What the cap touches and what it does not** (code): no cap rule changes the estimate, the cells, the flags or the pending slot. The cells learn `raw − Little Falls` (`scheduled-update.js:1242-1245`), the checks use the raw error, and the replay tool learns the same way. So every cap rule can be computed afterwards from one replay. The cap does change the corrected error, and that drives the headline accuracy, the 7-day validation history, the band, the 24-hour graph, and the Little Falls residual notice, which latches at −15%, the same line as "badly low" here (`scheduled-update.js:1993`, `:2313`; `model.js:271-305`). A looser cap would therefore also turn that notice on less often. None of these feeds the estimate.
3. **Which reading** (code): the latest Little Falls flow the job holds, with no age check. In production it is typically 10 to 70 minutes old. In the replay it is one hour old on 99% of hours (127,946 of 129,534).
4. **How 120% was chosen** (code and data, `analysis/backtest_comprehensive_combined.csv`, `backtest_117k_hourly_python.csv`, `backtest_delta_cap.py`, `backtest_comprehensive.py`, `backtest_117k.py`): a grid of 5 ceilings and 5 decay caps on a daily set (5,208 pairs) and an hourly set (42,837 pairs), later re-run on 117,420 hourly pairs. The ceilings were none, 105, 110, 114 and 120% on the first two sets and none, 105, 110, 115 and 120% on the third. In all of them the cap was computed from the truth value itself. On the daily set the Point of Rocks input was also taken from Little Falls (`backtest_delta_cap.py:186-188`). By overall error the tighter caps won (105% best; the chosen setting ranks 16th of 25 by combined root mean square error). The stated reason for 120% was a smaller low bias on rising water on the 42,837-pair set (−61 cfs at 120% against −509 at 110%). On the 117,420-pair set the bias on rising water was negative at every setting and least negative with no cap. No selection rule fixed in advance was found. The changelog's figures "−29 against −476" are in no results file.
5. **October 2026** (document, `analysis/cap-mechanism-map-2026-11-10.md`): eight scored hours were capped. Their shown errors ran from −2,014 to +2,160 cfs. The raw estimate (before correction and cap) was +1,160 to +7,435 cfs above the truth on those hours; the corrected value without the cap is not in that document. The cap "helped on the rise and peak and flipped the sign of the error at the onset" (flood audit).
6. **Two earlier studies on 21 large rises** (documents, `analysis/rising-limb-travel-verdict-2026-11-11.md`, `analysis/multipending-responsiveness-verdict-2026-11-12.md`): before the cap the model overestimates on rising-limb hours by +2,461 cfs on average; the cap binds on about half of those hours (52.5% there; 380 of 727, 52.3%, in this replay); on the hours where it does not bind the shown estimate is already too low (−1,477 cfs on average). Both conclude that the cap governs the shown number on a rising river.
7. **Ice** (code, `model.js:146-165`): the app's ice rule (`isIcePlausible`: water temperature at Point of Rocks at or below 5 °C, or November to March when the temperature is unknown) guards one check during learning. It does not touch the cap. When a gauge is flagged as iced, production makes no estimate at all; the replay does not model that skip.
8. **What the replay holds** (data, `analysis/onset_correction_2026-11-25/replay_L/shadow_L.csv`, `replay_F/shadow_F.csv`): 130,987 hourly rows each on a complete hourly grid (checked); per hour the raw estimate before rounding (`rawUnc`), the correction applied (`corrUsed`), the Little Falls reading the cap used (`lfCap`), its source time (`lfSrcTs`) and age (`age_lf_h`), the shown value (`predictedCFS`), the truth (`truthFlow`) and its time (`tauTs`), the travel time from Great Falls to Little Falls (`travelGFtoLF`), the upstream change the state rule saw (`d6`, `span_h`), the state (`flowState`) and the flow range (`flowBin`, the range of the raw estimate, not of the truth). On every scored hour `floor(min(rawUnc − corrUsed, 1.2 × lfCap) + 0.5)` equals the shown value (checked, no exception). Water temperature is blank before 2021-05-07.
9. **Counts, main run, scored hours** (checked), 2012 to 2019 and 2020 to 2026: scored 59,999 and 59,448; capped 2,137 and 2,511; state rising 9,272 and 9,059, of which capped 1,238 and 1,302. Capped hours by state: rising 1,238 and 1,302; steady 596 and 714; falling 303 and 495 (fact gatherer and auditor). Capped by flow range in 2020 to 2026: 615 below 3,000 cfs, 248 at 25,000 cfs and above (checked).
10. **Large rises** (data, `analysis/rising-limb-travel-backtest/rising_limb_events_python_v39.csv`, rows with `event_class == GATE` and `kept == 1`): 21 rises with a peak of 12,000 cfs or more at Little Falls, 8 before 2020 and 13 from 2020 on (checked). Their rising limbs (`rl_start` to `rl_end`, both ends included) hold 275 and 452 scored hours, of which 140 and 240 are capped, and 141 and 162 are not in the state "rising" (checked).
11. **"Rising" is the state of Point of Rocks.** On a rise that starts below Point of Rocks' reach (local rain), Little Falls rises while the state is steady or falling. Little Falls itself is rising (at least 2% above the reading the model held 3 hours earlier) on 9,885 and 10,302 scored hours, of which 1,296 and 1,257 are capped; only 4,308 and 3,689 of them are also in the state "rising" (checked).

## 3. Design in short

1. No new replay. The two replay files of the onset study are the data (main run arm L; arm F as a check on input timing).
2. Every rule changes only the limit. The estimate before the cap, `u = rawUnc − corrUsed`, is the same under all rules. `shown = floor(min(u, limit) + 0.5)`. A rule with no limit shows `floor(u + 0.5)`.
3. Truth is the Little Falls flow one travel time after the estimate (`truthFlow`), as in every accuracy figure of the app.
4. The record is split as in the onset study: design years 2012-12-01 to 2019-12-31, test years 2020-01-01 to 2026-11-09. One rule is picked in the design years by a rule fixed here and tested once in the test years.
5. Everything is computed in one run. The pick is mechanical and uses numbers of the design years only.
6. Two blind analysts (Python, R), then a third auditor.

## 4. The rules, frozen now

Notation, per hour: `L` = `lfCap`. `T` = `travelGFtoLF` in hours. `a` = `age_lf_h`, the age of `L` in hours at the hour of the estimate. `u` as in section 3. "Production for this hour" means the limit `1.20 × L`.

### 4.1 Candidates (one of these can be picked)

| Rule | Limit | Idea |
|---|---|---|
| F135, F150, F200 | `1.35`, `1.50`, `2.00 × L` | a looser fixed cap |
| LF3, LF6, by Little Falls' own rise (k = 3 or 6) | `Lk` = `lfCap` of the row k hours earlier; `e` = hours from that row's `lfSrcTs` to this row's `lfSrcTs`. If that row has no `lfCap`, or `e ≤ 0`: production for this hour. Else `min(2.00 × L, 1.20 × max(L, L + (L − Lk) × (T + a) / e))` | the owner's second idea, read as: carry Little Falls' own recent rise forward to the hour the water arrives |
| MR, by the model's own rise | `h = floor(T + a + 0.5)`; `u_h` = `rawUnc − corrUsed` of the row `h` hours earlier. If that row has no estimate, or `u_h ≤ 0`: production for this hour. Else `min(2.00, 1.20 × max(1, u / u_h)) × L` | the owner's second idea, read as: the water now at Little Falls passed Great Falls about `h` hours ago; let Little Falls grow by as much as the model says Great Falls has grown since |
| UP, by the upstream rise | If `d6` is blank or `≤ 0`, or `span_h` is blank or `≤ 0`, or `porQ − d6 ≤ 0`: production for this hour. Else `p = d6 / (porQ − d6) × (T + a) / span_h` and the limit is `min(2.00, 1.20 × (1 + p)) × L` | the owner's second idea, read as: the rise Point of Rocks is showing, scaled to the time until the water arrives |
| RIS, no cap on rising water | none when `flowState` is rising, `1.20 × L` otherwise | the crudest form of "depends on the rise" |
| ICE, only in the ice months | `1.20 × L` from November to March (UTC month of the hour), none otherwise, in all years | the owner's first idea, in the only form that is the same rule in every year |
| N, no cap | none | what the cap removes and what it costs |

P, production, `1.20 × L`, is the baseline.

Changes from version 1: UP and LF3/LF6 now use the real time to arrival (`T + a`, not `T`) and are defined for every hour; LF3/LF6 use the real hours between the two readings; ICE is the month rule in all years; MR is new. MR and these corrections were written after the audit's counts and before any error of any rule was computed.

Known before the run (counts only, checked): MR differs from production in the shown value on 1,903 design and 2,121 test hours and falls back to production on 120 and 70; UP has no usable upstream change on 1,091 and 81 hours (blank `d6` on 498, `span_h` of 0 on 593 and 81) and is also production on every hour with `d6 ≤ 0`; the two Little Falls readings of LF6 are 6 hours apart on 99.7% and 99.1% of hours and 0 hours apart on 57 and 11.

A weakness of UP known before the run: Point of Rocks' current change belongs to water that reaches Great Falls about a day later. An earlier study also found that scaling the tributaries with this same change is the larger source of the model's overshoot on rising limbs (`analysis/rising-limb-travel-verdict-2026-11-11.md`). So UP loosens the cap where the overshoot is largest. It stays in because it is the owner's idea in its plainest form.

### 4.2 Description only (never picked)

| Rule | Limit | Why |
|---|---|---|
| T110 | `1.10 × L` | the direction the February searches pointed to; the only rule tighter than production |
| F125, F130, F140, F175 | `1.25`, `1.30`, `1.40`, `1.75 × L` | so the curve of the error against the factor is visible between the candidates |
| ICE-T | from 2021-05-07 only: `1.20 × L` when `tempC ≤ 5`, the month rule when `tempC` is blank, none otherwise | the owner's first idea as the app's ice rule would apply it |

A third reading of the owner's second idea, the rise the Weather Service forecasts for Little Falls, cannot be tested on past years (no forecasts were stored before 2026-11-25). It is part of the later check on this week's rise (section 9).

No rule is added or reshaped after any result of this study has been seen.

## 5. Measures and hours

Per hour and rule: `error = (shown − truth) / truth × 100`. Per hour: `d = |error of the rule| − |error of production|`; negative is better.

- **Mean absolute error** and **mean signed error**.
- **Badly off:** the share of hours with `|error| ≥ 15`. This is the benefit measure. It is the sum of **badly low** (`error ≤ −15`) and **badly high** (`error ≥ +15`).
- Every rule except T110 has a limit at least as high as production's on every hour. A one-sided share (badly low, badly high) can therefore move only one way. It is reported in every table as description, marked as one-directional, and is never used as a benefit. Badly high is used only as a cost limit with a positive tolerance (conditions 3 and 4).
- **Hours, all fixed in advance:**
  - all scored hours (the scored-hour rule of the onset study's specification, section 2);
  - **rising hours:** scored hours with `flowState == rising`, every flow range (9,272 design, 9,059 test in the main run);
  - **Little Falls rising:** scored hours whose `lfCap` is at least 1.02 times the `lfCap` of the row 3 hours earlier (9,885 and 10,302); description only;
  - capped hours (`u > 1.20 × L`), and capped rising and capped not-rising hours;
  - the rising-limb hours of the 21 large rises (section 2 point 10), also split into upstream-led and Little-Falls-led rises (Little-Falls-led: at the rise's `event_t0` hour `porQ` is below 50% of `lfCap`; a rise whose row at that hour has no values is not classed), the split as description only;
  - the six flow ranges by `flowBin`.
- **Uncertainty:** bootstrap over calendar months, 10,000 draws, 95% interval, shared random numbers, as in the onset study.

## 6. Description: the cap against no cap (both periods, each on its own)

**Reading fixed in advance.** On a group of hours the cap **does a good job** if the mean `d` of N against P (the absolute error without the cap minus the absolute error with it) is above 0 and its whole 95% interval is above 0. It **does harm** if the whole interval is below 0. Otherwise the description for that group is **unclear**. Groups: all scored hours; capped hours; capped rising hours; capped not-rising hours; Little Falls rising hours; rising-limb hours of the large rises. Design years and test years separately.

Also reported:
- the two errors and the three shares of section 5 for P and N on each group;
- on capped hours, a three-by-three table: the class of the hour without the cap (badly low, within 15%, badly high) against its class with the cap;
- **the reach:** the share of production's badly-low rising hours that are capped. A cap rule cannot touch the rest.

## 7. Step A, design years: the table and the pick

**A1. The table of all rules** (candidates and description rules) on every group of hours of section 5.

**A2. The pick.** The owner's concern is rising water (his choice of 2026-11-26: rising water first, the overall error as the limit). Restated with the two-sided measure:
- A candidate **qualifies** if its mean `d` over all scored design hours is at most 0.00, that is, no loss in overall error against production.
- Among the qualifying candidates the one with the lowest badly-off share on rising design hours leads. All qualifying candidates within 0.1 percentage points of that lowest share are tied. Among the tied the pick is the earliest in this order: F135, F150, LF6, LF3, MR, UP, RIS, F200, ICE, N (tighter first, then the easier to build the same way in the browser and on the server).
- If no candidate qualifies, or the pick's badly-off share on rising design hours is not below production's, the verdict is KEEP and step B is reported as description only.
- T110 and the other rules of section 4.2 are never picked.

The qualifying line (0.00) is stricter than the test's (+0.05, condition 2) on purpose: a rule picked at the edge of a tolerance crosses the same tolerance in the test about as often as not.

**The owner may turn the weighing around before the run** (overall error first). Then: the pick is the candidate with the lowest mean `d` over all scored design hours, provided that mean is below 0 and its badly-off share on rising design hours is not higher than production's (ties within 0.01 points by the order above); in step B condition 1 becomes "mean `d` over all scored test hours is below 0, with the whole interval below 0", and condition 2 becomes "the badly-off share on rising hours is not higher than production's". Everything else stays.

## 8. Step B, test years, used once: the picked rule against production

All nine must hold for the verdict BETTER RULE FOUND. Counts are for the main run.

1. **Less often badly off on rising water:** the badly-off share on rising hours falls by at least 1.0 percentage point (about 91 of 9,059 hours, net of hours that become badly high), and the whole interval of the difference is below 0.
2. **No loss overall:** mean `d` over all scored hours is not above +0.05 points (2,972 points summed over 59,448 hours; about 1.2 points on each of the roughly 2,500 hours a rule can change).
3. **Not many more badly-high readings overall:** the share over all scored hours does not rise by more than 0.5 percentage points (297 hours). A cost limit; one-directional by construction.
4. **Not many more badly-high readings on rising water:** the share on rising hours does not rise by more than 1.5 percentage points (136 hours). A cost limit; one-directional by construction.
5. **Large rises:** on the 452 rising-limb hours of the 13 large rises of the test years, the badly-off share is not higher than production's, and the mean absolute error is not more than 5% (relative) above production's.
6. **Both halves of the test years** (before and from 2023-06-01): the difference of condition 1 is below 0 in each.
7. **Input timing:** in the arm F run the difference of condition 1 is below 0 (arm F's rising hours are its own: the state depends on input timing).
8. **High water:** on hours with `flowBin` at 25,000 cfs and above, the mean absolute error is not more than 5% (relative) above production's.
9. **Low water:** on hours with `flowBin` below 3,000 cfs, the same.

Verdicts: **BETTER RULE FOUND** (all nine). **KEEP** (step A picked no rule; or in step B the interval of condition 1 includes 0 or lies above it). **UNCLEAR** (everything else).

Reported with step B, as description: on how many of the 13 large rises the rule's mean absolute error over the rising limb is lower than production's; the upstream-led and Little-Falls-led split; Little Falls rising hours; all description rules.

**Truth timing, report only.** On a steep rise the truth is the least reliable number: the due hour depends on the app's travel time, and a later truth is higher. So the step B table is computed three more times, with the truth taken 1 hour earlier, 1 hour later and 2 hours later than `tauTs`. The shifted truth is rebuilt from the replay's input file (`analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv`) the way the replay tool builds it (linear between hourly medians placed at the hour start plus 22.5 minutes). Gate on this data step: the rebuilt truth at `tauTs` itself must equal `truthFlow` on every scored hour; if it does not, the three tables are not reported and the report says why. Hours with no shifted truth are left out of that table and counted. Reading fixed in advance: if the difference of condition 1 is below 0 at the app's truth time but not below 0 with the truth 1 hour earlier, the report says the gain may be a timing effect.

The numbers 1.0, 0.05, 0.5, 1.5 and 5% are the orchestrator's proposal; the owner may set others before the run.

## 9. The later check on this week's rise (own short plan, after the rise has passed)

The rise that began on 2026-11-26 is outside the replay data. The app's hourly log holds what is needed for every run: the corrected value before the cap (`corr.unc`), the limit (`ceil.lim`), whether it bound, the shown value, the Little Falls reading and its time. The forecast archive holds the Weather Service's forecast for Little Falls for the same hours. So the rules of section 4 can be scored there, and also the third reading of the owner's idea: a limit of 120% of the forecast for the hour the water arrives. One rise is description, not a test.

## 10. What follows a verdict

- **BETTER RULE FOUND or UNCLEAR:** the rule and production are scored on this week's rise from the app's own log (section 9) before anything is proposed for the app.
- **KEEP:** the cap stays; the description of section 6 is the answer to "does it do a good job".
- A change of the cap changes the shown number, so any later build is a MAJOR version, in the browser and on the server, with its own plan and audits. It needs no reset of the corrections. It would also change when the Little Falls residual notice turns on, the headline accuracy, the validation history, the band and the graph (section 2 point 2).
- A rule that depends on the state, on `d6` or on earlier estimates (RIS, UP, MR) needs a design that makes the browser and the server agree before any build: the browser computes the upstream rise by another route and does not keep earlier estimates before the cap. The fixed caps and LF3/LF6 need only the Little Falls history, which both sides hold.

## 11. Verification

Specification from this plan, reviewed before any analyst starts; two blind analysts, Python (`python3 -I`, standard library) and R (base), who do not see this plan's expectations; a compare tool; a third auditor with an own implementation, the row accounting, and at least five readings checked against the USGS public service. If the two analysts differ: stop and find the cause. The specification and the compare tool of the onset study are the models.

Points the specification reviewer must check by name: that every rule of section 4 is defined on every scored hour and both languages treat blanks alike; the place of MR in the order of section 7; the KEEP wording of section 8; the gate and the handling of missing hours in the truth-timing step.

## 12. What this study cannot show

- The replay's Little Falls reading is one hour old; production's is 10 to 70 minutes old. The replay's cap is therefore a little staler than the real one, which makes the real cap slightly less harmful on rises than the replay shows.
- Hourly values, cells never reset, the server's model only.
- The truth is the Little Falls flow one travel time later. If the app's travel time is off on a steep rise, a correct estimate is scored against a too-early reading. The truth-timing tables bound this; they do not remove it.
- On rises led by Little Falls the truth contains runoff that enters below Great Falls. LF3 and LF6 loosen on that same runoff and are favoured by it for a reason that has nothing to do with Great Falls.
- The test years are not fresh for the cap. Two earlier studies published the shown errors on capped and uncapped rising-limb hours of the same 21 rises, 13 of them in the test years, and the rules were shaped knowing them and October 2026. The split protects only the pick among the listed rules, not the choice of rules, and condition 5 is not an independent test.
- Production makes no estimate when a gauge is flagged as iced; the replay does not model that. The winter hours of every rule include hours production would not show. ICE can be judged on temperature only from 2021-05-07 (ICE-T, description).
- The cap is studied with production's corrections. The half-and-half mix of the onset study (frozen, to be checked on the app's own log in 2027) changes the estimate before the cap on rising hours below 25,000 cfs and so changes which hours are capped. It is not combined here. This is the orchestrator's proposal; the owner may ask for it as an added description.
- Some replay hours rest on readings USGS has since revised (from 2026-10-08).

## 13. Not in this plan

No change to the app. No change to the replay tool. No new rule after the results. No tuning of any factor: the fixed caps are a ladder to read, not a search.

## 14. Expected outcomes, written before the run

Version 1 expected "unclear, then better rule found, then keep". With the two-sided measure and the stricter qualifying line that changes:

- Section 6: on capped hours as a whole the cap does a good job in both periods (without it the model overshoots). On Little Falls rising hours and on the large rises the reading is open; "unclear" is the most likely.
- N, RIS, ICE and F200 do not qualify (overall error up).
- It is quite possible that no candidate qualifies. If one does, it is MR, LF6 or F135.
- Verdict: KEEP is the most likely, then UNCLEAR, then BETTER RULE FOUND.

## 15. Roles

Orchestrator: plan, rulings, synthesis. Specification writer and both analysts: Sonnet. Plan auditor, specification reviewer, third auditor: Opus.

## 16. Rulings on the audit (`PLAN_AUDIT.md`, verdict "proceed after changes")

| Finding | Ruling | Where |
|---|---|---|
| F1 (blocker): the benefit is a share every rule can only move one way | **Accepted.** The benefit is "badly off" (15% or more away on either side). Badly low and badly high are description, except badly high as a cost limit. | 0, 5, 7, 8 |
| F2: the pick sits on the edge of its own tolerance; tie window unclear; T110 not excluded | **Accepted.** Qualify at mean `d` ≤ 0.00; ties within 0.1 points of the lowest share; T110 never picked; the turned-around weighing restated. | 7 |
| F3: "rising" is Point of Rocks' state; many large-rise hours are not "rising" | **Accepted.** Rising hours defined exactly; Little Falls rising as a described group; upstream-led and Little-Falls-led split; the runoff limit named. | 2 point 11, 5, 12 |
| F4: UP undefined on about 1,400 hours and reads the wrong rise; add MR | **Accepted.** UP defined on every hour with the real time to arrival; MR added as a candidate; UP's weakness stated. Own addition: MR's place in the tie order (after LF3: it needs earlier estimates, which the browser does not keep). | 4.1, 7 |
| F5: LF3/LF6 use a nominal step and too short a horizon | **Accepted.** Real hours between the readings; horizon `T + a`; production when the gap is not positive. | 4.1 |
| F6: ICE is two different rules across the split | **Accepted.** Month rule in all years for the pick and the test; the temperature version from 2021-05-07 as description (ICE-T); the iced-gauge skip named as a limit. | 4.1, 4.2, 12 |
| F7: the cap does change what is carried (notice, accuracy, history) | **Accepted.** Section 2 point 2 rewritten; the notice named under what a build would change. | 2, 10 |
| F8: the description has no reading fixed in advance | **Accepted.** Good job, harm or unclear by the interval of N against P, per group and period; the reach reported. | 6 |
| F9: thresholds diluted by the hours no rule touches | **Accepted.** Thresholds also as counts; a limit on badly-high readings on rising hours (+1.5 points). | 8 |
| F10: the truth is least reliable on the hours in question | **Accepted.** Truth 1 hour earlier, 1 and 2 hours later, report only, with a fixed reading. Own addition: a gate on the rebuilt truth, and no report of the three tables if it fails. | 8 |
| F11: the reach of any rule is small and can be stated now | **Accepted.** | 0 |
| F12: the fixed ladder is coarse | **Accepted.** F125, F130, F140, F175 as description. | 4.2 |
| F13: wrong or loose statements | **Accepted.** 114% and 115%; rank by root mean square error; the daily set's input; October's figures; the large rises' filter; flow range by `flowBin`. | 2, 8 |
| F14: the browser cannot show some rules as the server would | **Accepted.** | 10 |
| F15: the test years are not fresh for the cap | **Accepted.** | 12 |
| F16: the onset decision; the mix | **Accepted.** One line in the header; the mix not combined, as a proposal the owner may change. | header, 12 |

Nothing was rejected. The audit's per-event count on the large rises (answer 7) is taken as description in section 8.

## 17. For the owner to confirm before anything is computed

1. **The benefit measure:** "badly off on rising water" (15% or more away from the truth, too low or too high) in place of "badly low", with rising water still first and the overall error as the limit. The alternative: overall error first (section 7, last paragraph).
2. **The thresholds** of section 8: 1.0, 0.05, 0.5, 1.5 points and 5%.
3. **The half-and-half mix is left out** of this study.

A plain yes confirms all three as written.

**Confirmed by the owner on 2026-11-26 (evening, Eastern; 2026-11-27 UTC):** "yes. but only update the plan. dont run yet." All three points stand as written: the benefit measure with rising water first, the thresholds, the mix left out. The method is frozen from here. **The run has not started. It starts only on the owner's word.**

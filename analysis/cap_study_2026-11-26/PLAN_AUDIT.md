PROCEED AFTER CHANGES

# Audit of the cap study plan (PLAN_v1.md), 2026-11-26

Auditor: independent, did not write the plan. Read in full: the plan; `CLAUDE.md` (planning protocol, verification, model mechanisms, parameters); `netlify/functions/shared/model.js` and `netlify/functions/scheduled-update.js` (cap, prediction, validation, learning, advisories); the replay files, README, tool and spec of the onset study; the February cap searches and their result files; the cap map, the October audit, the A6 and A7 verdicts, the event list and its plan; the onset report and its results audit.

No error of any estimate was computed. Truth values were read only to apply the scored-hour filter of `ANALYSIS_SPEC.md` section 2 and the timing of `tauTs`. All counts below come from two read-only scripts: `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/cap_plan_audit/counts.py` and `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/cap_plan_audit/extra.py` (outputs `counts_L.txt`, `counts_F.txt` in the same folder). The scripts check on every scored hour that `floor(min(rawUnc - corrUsed, 1.2 x lfCap) + 0.5)` equals `predictedCFS`; no hour failed.

## The one fact that shapes most findings

Every candidate rule except T110 gives a limit at least as high as production's, on every hour:
- F135, F150, F200, N: plainly.
- RIS and ICE: either production's limit or none.
- UP: `min(2.00, 1.20 x (1 + p))` with `p >= 0` is at least 1.20.
- LF3, LF6: `min(2.00 L, 1.20 x max(L, ...))` is at least `min(2.00 L, 1.20 L) = 1.20 L`.

So on every hour `shown(P) <= shown(rule) <= shown(N) = u` (rounding aside). Every rule is a partial give-back of what the cap cuts. Three consequences follow:
1. A looser rule can only raise a shown value. It can only take hours out of "badly low" and only put hours into "badly high". The badly-low share can never rise; the badly-high share can never fall.
2. The fixed caps are nested (P, F135, F150, F200, N). The badly-low share is non-increasing along that chain. N always has the lowest badly-low share of all rules.
3. N against P (the description, A1) is the envelope of every effect the study can find.

## Findings

### F1. BLOCKER: the benefit is measured by a share that every candidate can only move one way

Evidence: the fact above. The plan's own rule (section 5, last bullet) and the onset lesson (`onset_correction_2026-11-25/REPORT.md` section 8, first bullet; `RESULTS_AUDIT.md` line 14, F2) forbid exactly this. The plan applies the lesson to subsets of hours but not to the measure. Effects:
- Condition 1, interval part: the per-hour difference is never positive, so every month-block sum is at most 0 and the bootstrap upper bound is at most 0. "Whole interval below 0" only needs at least one changed hour in almost every resample. It is near-certain to hold. Only the 1.0 point threshold bites.
- Condition 4, first half ("badly-low share not higher than production's"): always true.
- Conditions 5 and 6 ("difference of condition 1 below 0" in each half and in arm F): true as soon as one hour leaves the badly-low group. Vacuous.
- The KEEP verdict "in step B the interval of condition 1 includes 0" can in practice not happen.
- Step A, last bullet ("the best qualifying rule is not below production on that share"): can only happen if a rule changes no hour.
- The pick (section 6, A3): "lowest badly-low share" rewards looseness and nothing else (see F2).
So four of eight conditions and one of the two KEEP routes test nothing. A rule that turns many fair readings into badly-high ones passes conditions 1, 4a, 5 and 6 for free.

Recommendation. Replace the one-sided benefit with a two-sided one, and keep the one-sided shares as description only:
- Define **badly off** = `|error| >= 15`. Condition 1 becomes: "On rising hours, the share of badly off hours falls by at least X points, and the whole 95% interval of the difference is below 0." The difference is then (hours leaving badly low) minus (hours entering badly high), which can go either way.
- Condition 4: "On the rising-limb hours of the large rises in the test years, the badly off share is not higher than production's, and the mean absolute error is not more than 5% (relative) above production's."
- Conditions 5 and 6: "the difference of condition 1 (badly off) is below 0" in each half and in arm F.
- Step A, last bullet: "If no rule qualifies, or the best qualifying rule is not below production on the badly-off share of rising design hours, the verdict is KEEP."
- Keep badly-low and badly-high separately in every table, labelled "one-directional by construction for every rule except T110; description only".
- Add one sentence to section 5: "Every rule except T110 has a limit at least as high as production's on every hour. A one-sided share (badly low, badly high) can therefore move only one way and is never used as a benefit."

### F2. MAJOR: the pick sits on the edge of its own tolerance and then meets the same tolerance in the test

Evidence: section 6 A3 qualifies a rule at "MAE not more than 0.05 above production" and then takes the lowest badly-low share. By the fact above that is "the loosest rule that still fits under +0.05". The pick therefore tends to land close to +0.05 in the design years. Condition 2 in the test years uses the same +0.05. A rule picked near the edge crosses it about as often as not, so UNCLEAR is built in. A small change in the design MAE flips the pick between rules that differ a lot (for example F150 against N, or LF6 against ICE). The tie window is also unclear: "ties within 0.1 percentage points" of what? And T110 is not in the tie order; the plan does not say it is excluded from the pick.

Recommendation:
- Use a tighter tolerance to qualify than to pass: "A rule qualifies if its mean d over all scored design hours is at most 0.00" (no loss in the design years), and keep "+0.05" in condition 2 of the test.
- Pick on the two-sided measure of F1: "Among qualifying rules other than P and T110, the pick is the rule with the lowest badly-off share on rising design hours. All qualifying rules whose share is within 0.1 points of that lowest share are tied; among them the pick is the one earliest in this order: F135, F150, LF6, LF3, UP, RIS, F200, ICE, N."
- State: "T110 is never picked."
- Alternative weighing (owner's option, MAE first): under F1's measure it becomes "lowest mean d over all scored design hours among the looser rules, with the badly-off share of rising design hours not higher than production's". It no longer needs a badly-low limit, which would be vacuous. Under MAE first, the tight caps that the February searches favoured are excluded only because T110 is excluded; say so.

### F3. MAJOR: "rising" is the state of Point of Rocks, not of the river at Great Falls; many large-rise hours are not "rising"

Evidence: the state comes from `getFlowState` on the PoR history (`model.js:466-492`). On the rising limbs of the 21 large rises (GATE class, kept), 162 of 452 test hours and 141 of 275 design hours are not in the state rising (RIS changes the limit on 290 and 134 of them). Example, event 47 (rising limb from 2024-08-08T16Z): at 2024-08-08T22Z Little Falls rises (3,010, 3,145, 3,715 cfs at t-6, t-3, t) while PoR falls (d6 = -765), so the state is falling. The estimate before the cap is 6,692 cfs, the production limit 4,458. RIS and UP leave that limit unchanged. Also: on LF-led rises the truth (Little Falls) includes runoff that enters below Great Falls, which favours any rule that loosens with Little Falls' own rise (LF3, LF6) for a reason that has nothing to do with Great Falls (see also the settled local-runoff finding of 2026-07-20).

Recommendation:
- Section 5, Hours: define "rising hours" exactly. If the onset study's R (rising and flow range below 25,000) is not meant, say "all hours with `flowState == rising`, every flow range (9,059 test hours, arm L)".
- Add a description population: "LF rising: `lfCap(t) >= 1.02 x lfCap(t-3)`". Report every rule on it.
- On the large rises, split the rising-limb hours into PoR-led and LF-led (the stratum of `rising-limb-travel-backtest-plan-2026-11-10.md` line 79: PoR now below 50% of LF at the start), report only.
- Section 11: add "On LF-led rises the truth contains runoff from below Great Falls. LF3 and LF6 loosen on the same runoff and are favoured by it."

### F4. MAJOR: UP is not defined on about 1,400 hours, and it reads the wrong rise

Evidence (arm L, scored hours):
- `span_h = 0` on 674 scored hours (883 of all predicted hours), and `d6 = 0` on all of them. Then `p = 0 x T / 0` is NaN in IEEE arithmetic. `min(2.00, NaN)` is NaN in JavaScript, and Python and R treat it differently. Undefined.
- `d6` blank on 498 scored hours (`histShort = 1`). No fallback is written for UP (the fallback sentence covers only missing earlier LF rows).
- `span_h` of 1 to 3 hours on 145 scored hours inflates `p` up to fourfold.
- UP loosens on steady hours too: its limit differs from production's on 19,920 test hours although only 9,059 are rising (a small positive `d6` below the threshold still gives `p > 0`).
- Dimension: `d6 / (porQ - d6)` is the fractional change over `span_h` hours; divided by `span_h` it is per hour; times `T` hours it is a dimensionless projected rise. So UP is dimensionally sound.
- Physics: it is the wrong rise. The water that reaches Little Falls between the cap's reading (about `t - 1`) and the truth (`t + T`) passed Great Falls between `t - 1 - T` and `t`. Point of Rocks' current change belongs to water that reaches Great Falls a day later (median PoR to GF travel about 19 h). It is also the signal that drives the PoR-delta correction, which A7 found to be the larger source of the rising-limb overestimate (`rising-limb-travel-verdict-2026-11-11.md`, "What the study did establish", third bullet). UP thus loosens the cap exactly where the estimate's known overshoot is largest.
- The horizon is `T`, but the cap's reading is older than the estimate's hour (one hour in the replay, 10 to 70 minutes in production), so the true gap is `T + age`.
- It saturates at 2.00 on steep PoR rises: at 2021-09-02T02Z, `d6 = 5,420` on 7,330 cfs, `p = 0.739 x 4.86 / 4 = 0.90`, `1.2 x 1.90 = 2.28`, held at 2.00.

Recommendation:
- Exact UP: "If `d6` is blank, or `span_h <= 0`, or `d6 <= 0`, then `p = 0`. Otherwise `p = d6 / (porQ - d6) x (T + age_lf_h) / span_h`."
- Add a fairer form of "the threshold depends on the speed of the predicted rise", named MR (the model's own predicted rise): `h = floor(T + age_lf_h + 0.5)`; `u_h` = `rawUnc - corrUsed` of the row `h` hours earlier; if that row has no prediction or `u_h <= 0`, fall back to production; else `limit = min(2.00, 1.20 x max(1, u / u_h)) x L`. Reading: allow Little Falls to grow over the gap by as much as the model says Great Falls grew over the same gap. It binds when `u_h > 1.2 x L` (when the rise is steady), i.e. when the estimate whose water has just reached Little Falls was more than 20% above what arrived. That is the like-for-like check the February searches tried to make with the truth itself. It is defined on every hour, uses one ratio, and the horizon is right. It is a rule for the owner's second idea, written before any result, so adding it now is allowed.
- Keep UP as written (with the exact definition above) so the owner's reading of his idea is still tested.

### F5. MAJOR: LF3 and LF6 use the wrong horizon and a nominal time step

Evidence:
- The time between the two readings is 6 h on 118,740 scored hours, but 0 h on 68 (the same reading held twice, so the rule sees no rise at all), and 4, 5, 7 or 8 h on 530. Production's readings are 10 to 70 minutes old, so the gap there varies more.
- The horizon is `T`; the real gap from the reading to the truth is `T + age_lf_h` (about 1.4 h more in the replay, `tauTs - predTs - T` lies between -0.2 and +0.8 h on the test hours). At `T = 6.5 h` that understates the extrapolation by about 20%.
- Little Falls' own rise includes local runoff. At 2021-09-01T14Z: `L = 10,000`, `L3 = 14,950`, `L6 = 3,845`. LF3 gives 1.20 x L, LF6 gives 2.00 x L, on the same hour.
- Using the reading the model held then is fair: it is exactly what production would have in memory, with its age. The fix is to measure elapsed time from the readings' own times, not to change which readings are used.

Recommendation: "`e` = hours between `lfSrcTs` of this row and `lfSrcTs` of the row k hours earlier. If that row has no `lfCap`, or `e <= 0`, the rule is production for this hour. Else `limit = min(2.00 x L, 1.20 x max(L, L + (L - Lk) x (T + age_lf_h) / e))`."

### F6. MAJOR: ICE is a different rule in the design years and in the test years

Evidence: before 2021-05-07 there is no temperature, so ICE caps November to March. After, it caps only at or below 5 C. ICE's limit differs from production's on 35,251 of 59,999 design hours (59%) and on 46,016 of 59,448 test hours (77%). A rule picked on the month version is tested in its temperature version. Also, ICE equals N on large rises: in the test years it changes the shown value on all 240 capped rising-limb hours, as N does. And production makes no estimate when a gauge is iced, but the replay does not model that skip (`rising-limb-travel-verdict-2026-11-11.md`, Limits, "Production's critical-ice skip is not modelled"), so ICE's winter hours include hours production would not show.

Recommendation: "ICE in the pick and in step B uses the month rule (November to March, UTC month of `predTs`) in all years. The temperature version (`tempC <= 5`, month rule when `tempC` is blank) is reported for 2021-05-07 onward as description." Add the iced-gauge skip to section 11.

### F7. MAJOR: section 2 point 2 and question 2: the cap does not touch learning, but it does change what is carried to the next hour

Evidence:
- Learning: the cells learn `rawCFS - actualCFS` (`scheduled-update.js:1242-1245`); Check 4 uses the raw error (`:1290-1295`); Check 5 calls `classifyOutlier(binData, errorCFS)` on the raw error. The replay learns on `p.rawFinalCFS - actualLF` (`replay_onset.mjs`, `runOrig`, and `validateAt` with `p.raw`). Which hour fills the single slot does not depend on the shown value. So no cap rule changes the estimate, the cells, the flags or the slot. That part holds.
- Carried: `pairs.push({ errPct: errorPercentCorrected })` (`scheduled-update.js:1993`) feeds `updateLfResidualAdvisory` (`:2313`), whose state latches ON when the corrected error is at or below -15% (`model.js:271-305`). That is exactly the plan's "badly low". So the cap decides whether the app's "reading low" notice turns on, and the state persists across hours. The cap also drives the headline accuracy (`:1777`), the 7-day validation history (`:1907`), the band (`bandFor(pred.predictedCFS, ...)`, `:2871`) and the 24-hour graph history (`storeGFHistory`, `:513-551`). None of these feeds the estimate.

Recommendation: rewrite section 2 point 2: "No cap rule changes the estimate, the cells, the flags or the pending slot (code lines). The cap does change the corrected error, which drives the headline accuracy, the validation history and the Little Falls residual notice (latched at -15%, the same line as 'badly low'). A looser cap therefore also turns that notice on less often." Add the notice to section 8 as something a build would change.

### F8. MAJOR: the description (question 1) has no reading fixed in advance

Evidence: section 6 A1 lists numbers but no rule for "does the cap do a good job". Since N against P is the envelope of every effect (fact above), A1 is the part of the study most likely to be quoted, and it is the part read after the results.

Recommendation, as a pre-set reading in section 6: "The cap does a good job on a group of hours if, on that group, mean d of N against P (N's absolute error minus P's) is above 0 and its whole 95% interval is above 0. It does harm if the interval is below 0. Otherwise the description is UNCLEAR for that group. Groups: all scored hours, capped hours, capped rising hours, capped non-rising hours, LF rising hours (F3), rising-limb hours of the large rises, test years and design years separately." Also give, as part of A1, the share of production's badly-low rising hours that are capped. A cap rule cannot reach the rest (F11).

### F9. MAJOR: the thresholds are diluted by the 96% of hours no rule touches

Evidence: on all scored test hours, 2,510 change under N and the fixed caps (table of question 10). Condition 2 (+0.05 over 59,448 hours) allows on average +1.18 points per changed hour (59,448 x 0.05 / 2,510). Condition 3 (+0.5 points over all hours) allows 297 new badly-high hours, i.e. 12% of all capped hours, and all of that may fall on rising hours, where it would be a rise of 3.3 points of the 9,059 rising hours.

Recommendation: state the thresholds also as counts in the plan ("+0.05 over all scored hours = 2,972 points summed, about 1.2 points per changed hour"). Add a guard on rising hours: "Condition 3b: on rising hours the badly-high share does not rise by more than 1.5 points." If F1 is adopted, condition 3 can stay as a cost guard; it is one-directional, which is acceptable for a cost guard with a positive tolerance, but say so.

### F10. MAJOR: the truth is least trustworthy exactly on the hours in question; give the sensitivity a fixed reading

Evidence: the cap map finds that on the October rising rows Little Falls reached the replayed raw value 4.7 to 26 h after the due time (`cap-mechanism-map-2026-11-10.md`, section 5, "A second reading"). The onset report says the travel-time pairing of the truth was not re-checked (`REPORT.md` section 9, last bullet). On a rise a later truth is higher, which favours every looser rule; on a recession the opposite.

Recommendation: add, report only, the whole step B table with the truth taken 1 h earlier, 1 h later and 2 h later (interpolated as `interpAt`, i.e. `tauTs` shifted). Pre-set reading: "If the condition 1 difference (F1) is below 0 at the app's truth time but not below 0 with the truth 1 h earlier, the report says the gain may be a timing effect." Since the shadow file holds only one truth, the spec must name the input series for the shifted truth (`hourly_backtest_data_v39.csv`, same hourly medians at hour start plus 22.5 min) and the analysts must rebuild it; this is a data step and needs its own check.

### F11. MINOR: the reach of any cap rule is small and can be stated before the run

Evidence: a cap rule can change only hours where production's cap binds: 1,302 of 9,059 rising test hours (14.4%). A capped hour is badly low under P only if the truth is at least `1.2 / 0.85 = 1.412 x L`. A fixed cap `c` can lift such an hour out of badly low only if the truth is below `c / 0.85 x L`: F135 below 1.588 L, F150 below 1.765 L, F200 below 2.353 L. The uncapped rising hours, where A7 found the shown value already too low (mean -1,477 cfs), are out of reach of every rule.

Recommendation: put these bounds in section 0 and in the report. Condition 1's threshold of 1.0 point needs about 91 rising test hours to change group (net), i.e. 7% of the capped rising hours.

### F12. MINOR: the fixed ladder is coarse (onset lesson 3)

Evidence: the onset study's best width lay outside its list (`REPORT.md` section 8, third bullet). Here the step from 1.20 to 1.35 is the first, and the pick will tend to the loosest qualifier (F2).

Recommendation: add F125, F130, F140 and F175 as description only (not in the pick), so the curve of mean d against the factor is visible.

### F13. MINOR: wrong or loose statements in section 2 and section 5

- Point 4: the 42,837-pair and daily sets used 114%, not 115% (`backtest_comprehensive_combined.csv`, row `decay=0.50_ceil=114%`); 115% is the 117k set. The rank "16th of 25" is by combined RMSE, not MAE (17th on the daily, 18th on the hourly RMSE). The daily set did not even have a PoR input: `por_current = lf_actual` and `por_time_shifted = lf_yesterday` (`backtest_delta_cap.py:180-182`), so that estimate was also built from the truth.
- Point 5: "+1,160 to +6,070 cfs too high without the cap" are raw residuals (before the correction), not the corrected value without the cap. And they cover the six learned rows; the two hard-flagged rows had LOGGED raw residuals of +7,435 and +4,320. Write: "the raw estimate (before correction and cap) was +1,160 to +7,435 cfs above the truth; the corrected value without the cap is not in the map".
- Point 10 and section 5: "kept large rises" must say "event_class GATE and kept = 1": the file has 37 rows with kept = 1, of which 16 are STRATUM. With GATE: 21 events, 275 design and 452 test rising-limb hours (727 in all, as in A6), 140 and 240 of them capped.
- Section 7, conditions 7 and 8: say by which number the flow range is set. The data has `flowBin`, which is the range of the raw estimate, not of the truth. Below 3,000 there are 615 capped test hours, at 25,000 and above 248.
- Section 0, "about 4%": confirmed (2,137 of 59,999; 2,511 of 59,448). Point 3 confirmed (127,946 of 129,534). Point 9 confirmed exactly.

### F14. MINOR: the browser cannot show some rules as the server would

Evidence: the browser computes the PoR rise by another route (`CLAUDE.md`, Nowcast: "the PoR rise-rate input stays deliberately divergent"; onset `REPORT.md` section 7, point 3). RIS and UP depend on the state and on `d6`; MR would need the uncapped estimate of earlier hours, which the browser does not keep. Since v36.0 the shown and the validated estimate must be equal.

Recommendation: section 8: "A rule that depends on the state, on `d6` or on earlier estimates needs a parity design for the browser before any build; the fixed caps and LF3/LF6 need only the Little Falls history, which both sides hold."

### F15. MINOR: the test years are not fresh for the cap

Evidence: A6 and A7 reported, on the same record and the same large rises (13 of them in the test years), how often the cap binds, the displayed error on capped and uncapped rising-limb hours, and the 42 hours lifted off the cap that then read far too low (`multipending-responsiveness-verdict-2026-11-12.md`, "Why"). The rules were shaped knowing this.

Recommendation: section 11, replace the fourth bullet with: "A6 and A7 published displayed errors on capped and uncapped rising-limb hours of the same 21 rises, 13 of them in the test years. The split protects only the pick among the listed rules, not the choice of rules, and condition 4 is not an independent test."

### F16. MINOR: the onset decision of 2026-11-26

Evidence: `onset_correction_2026-11-25/REPORT.md` section 12 records "no further replay study" for D20. The owner started this study the same day.

Recommendation: one line in the plan's header: "The owner's 'no further replay study' of 2026-11-26 applies to D20; this study was started separately on his word of the same day." Also say whether the half-and-half mix is to be reported as a sensitivity (it changes `u` on rising hours below 25,000 and so changes which hours are capped); the plan says not, which is acceptable if stated as an owner choice.

## Answers to the questions

**1. Does section 2 hold; did the February searches build the cap from the truth?**
Yes, with the corrections of F13. In `backtest_117k.py` the cap is `lf[ic] * cr` and the error `final - lf[ic]`, the same `lf[ic]`. In `backtest_comprehensive.py` `estimate_gf` caps at `lf_actual * ceiling_ratio` (`:100-101`) and scores `est - lf_actual` (`:226`). In `backtest_delta_cap.py` the cap uses `lf_actual` (`:99-102`), which is also the PoR proxy (`:180-182`). What this does: with the cap at `c x truth` and `c >= 1`, clipping an estimate above `c x truth` always brings it closer to the truth. The cap could never make any hour worse, could never produce a reading below the truth, and every tighter cap had to win on overall error (105% best). Bias could only become more negative with a tighter cap. So the searches could only trade overall error against bias; they carried no information on a cap that lags a rising river, and they could not see the owner's concern at all. Point 2 holds for learning but not for "carried" (F7).

**2. Can no cap rule change what is learned, flagged or carried?**
Learned and flagged: correct, in production and in the replay (F7 evidence). Carried: not correct. The Little Falls residual notice, the headline accuracy, the validation history, the band and the graph history all take the capped value. None feeds the estimate, so the replay study stays valid, but the plan's sentence must change (F7).

**3. Are the rules well defined and fair?**
P, N, F*, T110, RIS: yes. UP: no (NaN on 674 scored hours with `span_h = 0`; no fallback for 498 blank `d6`), and it reads the PoR rise of water a day away (F4). LF3/LF6: defined except the 68 hours with the same reading twice; nominal step and short horizon (F5). ICE: changes meaning at 2021-05-07 (F6). Rounding: fine; the limit is not rounded and shown is `floor(min(u, limit) + 0.5)`; on 3 of 2,137 capped design hours the shown value is the same under N because of rounding. Negative or zero quantities: `porQ - d6 = p6Cfs > 0` always; `lfCap > 0` on every predicted hour (production returns no estimate without LF). A falling Little Falls: LF3/LF6 fall back to 1.20 x L, as intended.

**4. Is the pick sound; the tie order; the alternative weighing?**
Not sound as written (F1, F2): it picks the loosest rule that fits under the tolerance, on a measure that only looseness can move. The tie order (tighter and simpler first) is defensible, but the tie window must be defined against the lowest share and T110 must be excluded explicitly. The alternative (MAE first) is the cleaner design once the badly-low limit is replaced by the two-sided measure: it asks "is there a looser rule with lower overall error", which can go either way.

**5. Are the conditions sensible, can a helpful rule meet them, is any one-directional?**
One-directional by construction: 1 (its interval), 4 (its badly-low half), 5, 6; and 3 in the other direction (acceptable for a cost guard). Two-directional: 2, 4 (MAE half), 7, 8. A helpful rule can meet all eight, but so can a harmful one on four of them. Thresholds: 1.0 point is reachable (F11, question 12); +0.05 and +0.5 are soft once spread over 59,448 hours (F9).

**6. Is the truth fit for a steep rise; is there a bounding sensitivity?**
It is the app's own truth, so it is the right primary. On a steep rise it is the least reliable number (cap map timing; LF local runoff). The sensitivity of F10 (truth 1 h earlier, 1 h and 2 h later, report only, with a pre-set reading) bounds it. Expect any looser rule to look better with a later truth and worse with an earlier one; a gain that disappears at 1 h earlier is a timing effect.

**7. Missing rules or controls; onset lessons not applied?**
Missing: MR, the model's own predicted rise (F4); the corrected forms of UP, LF3, LF6 (F4, F5); a finer fixed ladder, description only (F12); the LF rising population and the PoR-led/LF-led split (F3); a pre-set reading of the description (F8); per-event breadth on the large rises ("better in k of 13 test rises", as A6 and A7 reported). Onset lessons: lesson 1 (one-directional share) repeated in mirror form (F1); lesson 3 (list too short) partly (F12); "figures in the plan passed on unchecked": checked here, small errors in F13; "travel-time pairing not re-checked": F10.

**8. The strongest argument that this study is not worth running.**
Every rule lies between production and no cap on every hour. So the whole study is: on about 2,500 capped hours per period, how much of the cut should be given back. Three earlier studies already say what those hours look like: on rising limbs the estimate before the cap runs about +2,461 cfs high on average and the cap binds on about half the hours (A7), and the shown number already reads low on the uncapped hours, which no cap rule can reach. A looser cap will release mostly overestimate; the only gain is on capped hours whose truth is at least 1.41 times the cap's reading. Those are the hours whose truth is least reliable (timing, local runoff). And any result leads only to a description of one rise. Against this: the study is cheap (no new replay), and N against P on lagging truth has never been measured. The cap's original evidence is void (question 1), so the description alone is worth having. That is why the verdict is PROCEED AFTER CHANGES, not DO NOT PROCEED.

**9. Each rule on three concrete hours (arm L, all scored; L, L3, L6 in cfs; T in hours; `u` = estimate before the cap)**

(a) Quiet hour, 2021-07-15T12Z: steady, flow range 3,000 to 6,000, L 4,080, L3 4,235, L6 4,425, T 8.07, PoR 3,220, d6 -80, span 4, 28.1 C, u 3,758 (not capped).
Limits: P 4,896 (1.20 L); N none; F135 5,508; F150 6,120; F200 8,160; T110 4,488; RIS 4,896; UP 4,896 (p = 0); LF3 4,896 and LF6 4,896 (LF falling, floor); ICE none. The shown value is 3,758 under every rule. Every rule does what its idea says.

(b) Early in a steep rise. Two hours, because the rules split by who leads the rise.
- PoR-led, 2021-09-02T02Z (event 32): rising, flow range 25,000 to 50,000, L 7,930, L3 8,460, L6 9,330, T 4.86, PoR 12,750, d6 +5,420, span 4, u 42,726 (5.4 x L).
  Limits: P 9,516; N none; F135 10,706; F150 11,895; F200 15,860; T110 8,723; RIS none; UP 15,860 (saturated at 2.00); LF3 9,516 and LF6 9,516 (LF still falling after local runoff, floor); ICE none. LF3/LF6 do not see a rise that Point of Rocks shows; UP and the fixed caps do.
- LF-led, 2024-08-08T22Z (event 47): state falling (PoR d6 -765), flow range 6,000 to 12,000, L 3,715, L3 3,145, L6 3,010, T 9.86, u 6,692 (1.80 x L, capped).
  Limits: P 4,458; N none; F135 5,015; F150 5,572; F200 7,430; T110 4,087; RIS 4,458; UP 4,458; LF3 6,707 (1.81); LF6 5,849 (1.57); ICE none. RIS and UP do nothing on this rise (F3).
- Also 2024-08-09T08Z, same event, state rising, L 8,080, u 7,415: not capped (P 9,696), so no rule changes anything. This is the kind of rising hour A7 found already too low; no cap rule can reach it (F11).

(c) Recession, 2024-08-12T12Z: falling, flow range 12,000 to 25,000, L 22,750, L3 24,900, L6 27,150, T 2.63, d6 -1,500, u 21,041 (not capped).
Limits: P 27,300; RIS, UP, LF3, LF6 27,300 (all back to production); F135 30,713; F150 34,125; F200 45,500; T110 25,025; N and ICE none. The rise-dependent rules do what they say. The fixed caps, N and ICE loosen on recessions too, where loosening can only add error on the hours where they bind.

`UP`: dimensionally sound, physically the wrong rise (F4). Simpler and fairer: MR (F4). `LF3`/`LF6`: using the reading the model held then is fair; the elapsed time and the horizon must be the real ones (F5).

**10. Counts only: hours on which the limit, and the shown value, differ from production's (arm L, scored hours)**

| Rule | Limit differs, design (of 59,999) | Limit differs, test (of 59,448) | Shown differs, design | Shown differs, test | Shown differs, rising design (of 9,272) | Shown differs, rising test (of 9,059) | Shown differs, large-rise rising limbs design (of 275) | Shown differs, large-rise rising limbs test (of 452) |
|---|---|---|---|---|---|---|---|---|
| N | 59,999 | 59,448 | 2,134 | 2,510 | 1,238 | 1,302 | 140 | 240 |
| F135 | 59,999 | 59,448 | 2,134 | 2,510 | 1,238 | 1,302 | 140 | 240 |
| F150 | 59,999 | 59,448 | 2,134 | 2,510 | 1,238 | 1,302 | 140 | 240 |
| F200 | 59,999 | 59,448 | 2,134 | 2,510 | 1,238 | 1,302 | 140 | 240 |
| T110 | 59,999 | 59,448 | 5,022 | 5,743 | 2,648 | 2,580 | 171 | 306 |
| RIS | 9,272 | 9,059 | 1,238 | 1,302 | 1,238 | 1,302 | 87 | 168 |
| UP (blank d6 and span 0 as P) | 19,303 | 19,920 | 1,485 | 1,640 | 1,238 | 1,302 | 90 | 178 |
| LF3 | 17,736 | 17,081 | 1,530 | 1,545 | 952 | 921 | 127 | 209 |
| LF6 | 18,910 | 18,541 | 1,557 | 1,574 | 981 | 935 | 136 | 211 |
| ICE | 35,251 | 46,016 | 1,443 | 2,052 | 861 | 1,067 | 124 | 240 |

Production's cap binds on 2,137 design and 2,511 test hours; on rising hours 1,238 and 1,302; on the large-rise rising limbs (GATE, kept) 140 and 240. Rising below 25,000 cfs (the onset study's R): 7,052 and 8,148 hours, of which 991 and 1,104 capped. Fallbacks to production: UP 1,091 design and 81 test hours; LF3 53 and 0; LF6 95 and 0. Arm F: 2,220 and 2,578 capped hours; 10,555 and 10,332 rising hours (the state depends on input timing, so arm F's rising population differs from arm L's).

What this tells the plan: N and the three fixed caps change the very same hours and differ only in how far they lift them. Counts cannot tell them apart; only size can. On rising hours N, F*, RIS and UP all touch the same 1,302 test hours. Capped hours by how far the estimate exceeds the limit (test, rising): under 5% 351, 5 to 10% 232, 10 to 25% 378, 25 to 50% 188, 50 to 100% 106, 100% or more 47.

**11. Is the pick stable; is one rule to the test right?**
Not stable (F2): it is an argmin of a measure that only looseness moves, under a hard edge, so a small change near +0.05 can send a much looser rule. One rule to the test is fine once the pick is fixed as in F2, but the description must carry its own pre-set reading (F8), because N against P is the envelope of every effect and is what the owner asked first ("does it do a good job").

**12. With about 9,000 rising and about 2,500 capped test hours, what change is detectable; is 1.0 point reachable?**
Rising test hours 9,059; capped among them 1,302 (14.4%). The largest possible drop in the badly-low share is below 14.4 points. 1.0 point = about 91 hours = 7% of the capped rising hours, which is reachable in principle. Size of the interval: if a fraction q of capped rising hours changes group, and changes are spread over months in proportion to capped hours, the month-block standard error is about q x 1.54 points (computed from the 83 test months with rising hours, 64 with capped rising hours; top ten months hold 36% of the capped rising hours). At q = 0.07 that is about 0.11 points, so a 1.0 point change is clearly detectable, and the interval part of condition 1 is never the binding part. With the two-sided measure (F1) the variance is larger, but of the same order. This is an approximation; the real clustering is by event and is wider.

**13. Does the plan repeat a dead end?**
No, not directly. A6 and A7 changed the estimate or the learning and failed because the cap hid the gain; this study changes the cap itself, as A6's last sentence asks ("a future study should start from the displayed value on rising limbs"). The cap map's options (keep capped rows out of learning) are not repeated. Two partial repeats: UP leans on the PoR change that A7 found to be the source of the overestimate (F4), and the test years are not fresh for the cap (F15).

## What I could not check

- Whether the replay input (`hourly_backtest_data_v39.csv`) contains Little Falls or PoR readings that USGS marked as ice-affected, i.e. hours where production would make no estimate. The replay does not model that skip.
- The client side of any rule (parity, the browser's own LF reading and its LF-missing path); only read in the cap map.
- How much of each count above falls on hours that USGS has since revised (from 2026-10-08, PoR up to 18.3% different, onset `REPORT.md` section 9).
- The power figure in question 12 is an approximation that assumes changes spread like capped hours; the real spread depends on the truth, which I did not use.
- Whether the shifted truth of F10 can be rebuilt exactly as the tool did (the tool's `interpAt` on the hourly medians); I read the code but did not rebuild it.
- The A7 figure "52.5%": this replay gives 380 of 727 (52.3%) capped rising-limb hours; A7 used its own replay arm, which I did not open.

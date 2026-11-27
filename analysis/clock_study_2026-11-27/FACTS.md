# Fact sheet for the clock study (2026-11-27)

Read-only gathering. Facts only, each with a source. "GF" Great Falls, "LF" Little Falls, "PoR" Point of Rocks, "EF" Edwards Ferry. Paths are relative to `/Users/sebjilke/Desktop/PotomacPulse`. Line numbers are from the files as read on 2026-11-27 (v39.16).

## 1. Every use of the two travel times

### The formulas (one definition per runtime, kept in sync by tests)
- Server: `netlify/functions/shared/model.js:80-84` constants (`TRAVEL_COEF = 4139`, `TRAVEL_EXP = -0.5963`, `MEDIAN_TRAVEL = 25.8`, `TRAVEL_POR_GF_BASELINE = 19.4`, `TRAVEL_GF_LF_BASELINE = 6.5`); `getFlowMultiplier` `:367-371` returns `TRAVEL_COEF * flow^TRAVEL_EXP / MEDIAN_TRAVEL` with flow floored at 1,000 cfs (bare number); `getPoRtoGFTravelTime` `:385-392`; `getGFtoLFTravelTime` `:400-407`.
- Both helpers: `base = BASELINE * mult`; if `riseRate.flowState === 'rising' && riseRate.ratePerHour > 0`, result is `base * (1 - Math.min(0.30, riseRate.ratePerHour * 0.02))`.
- Rise rate: `getPoRRiseRateFromHistory` `model.js:525-540` = percent change of PoR between the latest history point and the latest point at or before 6 h ago, divided by the hours between them; flow state from `getFlowState` `:466-492` (6 h window, threshold max(100 cfs, 2%)).
- Browser copies: `src/model/shared-model.js:300-304` (`getFlowMultiplier` returns `{flow, mult, cond, travelHrs}`), `:319-326` (PoR to GF), `:334-341` (GF to LF); constants `src/model/constants.js:122-127`. Re-exported by `src/estimation/great-falls.js:13,31`.

### Server nowcast, `netlify/functions/scheduled-update.js`, function `makeGFPrediction` (starts `:925`)
- `:953` `let mult = getFlowMultiplier(lf.q);`  `:954` `let travelPoRtoGF = getPoRtoGFTravelTime(mult, porRiseRate);`
- Loop `:960-971` (3 passes max): `getPoRFromHistory(porHistory, travelPoRtoGF)`; `historicMult = getFlowMultiplier(historicPoR.cfs)`; `newTravelTime = getPoRtoGFTravelTime(historicMult, porRiseRate)`; if `|new - old| < 1.0` then `stop='converged'; break` (mult NOT updated); else `travelPoRtoGF = newTravelTime; mult = historicMult;`.
- `:972` `const travelGFtoLF = getGFtoLFTravelTime(mult, porRiseRate);` (after the loop).
- Uses of the PoR to GF time: (a) the estimate: it picks which past PoR reading is used (`historicPoR`, `:963`), which then enters `porEstimateCFS = historicPoR.cfs + monocacy + goose + broadRun + seneca` (`:1006`) and the PoR-delta decay `fractionElapsed = min(1, historicPoR.actualHoursAgo / max(1, travelPoRtoGF))` (`:1018`). (f) logs: `trace.t0/t` `:976-977`.
- Uses of the GF to LF time on the server:
  - (b) due time: `:1117` `validationDue: new Date(Date.now() + travelGFtoLF * 60 * 60 * 1000).toISOString(),` and `:1116` `travelTimeGFtoLF: travelGFtoLF,` stored on the pending row.
  - (f) logs: `trace.gf2lf = travelGFtoLF` `:982`; tick_log `trv: {... mult, nohist, gf2lf}` `:2853-2855`; `due: pred.validationDue` `:2869`; validation_log `dueAt` `:2901`; run summary `newPrediction.validationDue` `:3598`.
  - Nothing else in `makeGFPrediction` reads `travelGFtoLF` or `mult` after `:972` (searched lines 925 to 1130 for `mult` and `travelGFtoLF`).
- (d) 48 h forecast scoring, `validateForecastPredictions` (`:2128`): `:2152` `const forecastTravelHrs = getGFtoLFTravelTime(getFlowMultiplier(lf.q));` (no rise rate argument); `:2218-2219` `travelOffsetHrs = pred.data.travelApplied === true ? forecastTravelHrs : 0; dueTime = targetTime + travelOffsetHrs`; ripe when `now >= dueTime + 15 min` (`:2222`); stale limit `FORECAST_STALE_MAX_AGE_HRS = 90` (`:45`, `:2231`); truth `:2243` `const actualCFS = lf.q;`.
- (c) learning: `sync-learning.js:173` only range-checks `p.travelTimeGFtoLF` (0 to 72); `:550` copies it into a pending row. No caller of `action: 'storePrediction'` was found in `src/`. The travel time reaches learning only through the due time (which LF reading is paired with the stored estimate, see section 8).
- `netlify/functions/build-ef-correlation-advanced.js:65-86` has its own `estimateTravelTimeHours` (EF to LF: `1120 * flow^-0.5963`, clamped 1.5 to 5.0 h) for the EF correlation builder. Not the same function; listed because grep finds it.

### Browser, nowcast, `src/estimation/great-falls.js` function `estimateGreatFalls`
- `:385` `let mult = data._mult?.mult || 1.0;` where `data._mult` is set in `src/data/fetch.js:144-148` from the CURRENT LF flow (`getFlowMultiplier(data[LF.id]?.q || MEDIAN_FLOW)`).
- `:395` PoR to GF time; loop `:399-421` identical in logic to the server (converged: break without updating mult; else `mult = historicMult` `:420`); `:423` `const travelGFtoLF = getGFtoLFTravelTime(mult, riseRate);`.
- GF to LF time is returned only as `inputs.travelGFtoLF` (`:588`) and `validationCountdown: travelGFtoLF` (`:606`). It is not used in the estimate (searched `:340-610`; only `:423`, `:588`, `:606`, and the null placeholders at `:369,:376`).
- PoR to GF time in the estimate: selects the historic PoR (`:395-421`), time-shift decay denominator (`:439`).
- `getTravelTimeAwarePor` (`:234-285`, uses `TRAVEL_POR_GF_BASELINE * newMult`): defined and exported; no caller found in `src/` (grep).

### Browser display, `src/ui/great-falls-ui.js`
- (e) `:275-277` inputs panel: `gf-input-travel` = `inputs.travelPoRtoGF` (1 decimal), `gf-input-travel-gf-lf` = `inputs.travelGFtoLF`; `renderGfLfTravel(inputs.travelGFtoLF)` `:277`; function `:82-86` writes `'~' + Math.round(hrs) + ' hrs'` into `#gfLfTravelVal`. The header line in `index.html:83` reads `Great Falls to Little Falls: <span id="gfLfTravelVal">`.
- (e) `:324-326` locked tab: `learn-val-countdown` = `gfEstimate.validationCountdown` (the GF to LF time, 1 decimal).
- (d) 48 h forecast cards, `updateForecastPeriods` (`:347`): `:436` `const gfToLfTravel = TRAVEL_GF_LF_BASELINE * getFlowMultiplier(currentCFS).mult;` where `currentCFS = gfEst.cfs` (the estimate, `:354`); the NWS Little Falls forecast is read at `targetGFHrs + gfToLfTravel` (`getGFAtTime`, `:447-482`); `travelApplied: true` only on that path, false on the PoR fallbacks. No rise-rate reduction here (TODO row 24 says the same). Log text `:485`.
- (e) `:546` fallback extrapolation divides by `gfEst.inputs?.travelPoRtoGF || 8.5` (display of forecast cards when no NWS forecast).
- Header "Point of Rocks to Little Falls" (`index.html:82`, `#multVal`): `src/ui/gauges-ui.js:200-204` shows `Math.round(data._mult.travelHrs)` = `4139 * LF_now^-0.5963` (whole PoR to LF, current LF flow, no rise reduction). Learning tab tile `#dash-travel`: `src/ui/learning-ui.js:249-250` same value. Per-gauge arrival times `src/data/fetch.js:144-166` use `baseHrs * mult` (`baseHrs` per gauge in `src/model/constants.js:26-44`, PoR 26).
- `src/estimation/nws.js`: no travel-time use found (grep "travel" returns nothing).

### Plain answer
The GF to LF time does NOT enter the shown estimate, server or browser. It enters: the due time and thus the LF reading used for scoring and learning (server only), the 48 h forecast value (browser, own formula) and its scoring (server, own formula), and the display (header, inputs panel, locked tab). The PoR to GF time DOES enter the estimate (which PoR reading is time-shifted in, and the decay). The same `mult` that sets the PoR to GF lookup feeds the GF to LF time, so the estimate and the clock share an input, but the clock does not feed back.

## 2. Which flow feeds the multiplier at each use

| Use | Flow behind `mult` | Source |
|---|---|---|
| Server nowcast PoR to GF time, first pass | current LF flow `lf.q` (latest point of the USGS response) | `scheduled-update.js:953` |
| Server nowcast PoR to GF time, later passes | flow of the historic PoR reading found by the previous time | `:966` |
| Server nowcast GF to LF time (due time) | `mult` as left after the loop: the current LF flow if the first pass converged or no history was found; otherwise the historic PoR flow of the last non-converged pass (flow of a PoR reading roughly 5 to 50 h old) | `:953,:966-972` |
| Rise reduction in both | PoR rise rate over the last 6 h | `model.js:525-540` |
| Server forecast scoring offset | current LF flow now, no rise reduction | `scheduled-update.js:2152` |
| Browser nowcast | same logic as server; first `mult` from current LF flow (`fetch.js:145-148`) | `great-falls.js:385-423` |
| Browser 48 h forecast offset | the app's own GF estimate (`gfEst.cfs`) passed as if it were LF flow; no rise reduction | `great-falls-ui.js:354,436` |
| Header "Point of Rocks to Little Falls", `#dash-travel` | current LF flow, no rise reduction | `fetch.js:145-148`, `gauges-ui.js:200-204` |

- The nowcast scoring and the forecast scoring therefore differ: the nowcast due time is fixed when the estimate is made (from a PoR-lookup-driven `mult` plus rise reduction), the forecast scoring offset is recomputed every cron tick from current LF flow with no rise reduction (`scheduled-update.js:2128-2152`, comment `:2143-2147`: the value "was BUILT with the client's travel (from the GF estimate at creation) and is SCORED with the server's (from LF flow at validation)").
- The project note is right: the code comment (`:2142-2143`) says the offset is "Recomputed here from current LF flow rather than persisting the client's value".
- Nuance versus the 27 Nov first look ("mult comes from the Point of Rocks reading the model looked up about a day back"): true only when the loop does not converge on a pass; on a converged first pass `mult` stays the current-LF value. The log field `trv.stop` (`converged`, `max_iter`, `no_hist`, `hist_lost`, `:975-981`) records which case occurred on each tick. The rising-limb plan found non-convergence on 9 of 26 October rising hours (34.6%), baseline rising-hour share 7.8% overall (`analysis/rising-limb-travel-verdict-2026-11-11.md`).

## 3. Where the numbers came from

- Searcy and Davis (1961), USGS Circular 438: `src/assets/tech-appendix.md:83-92`: "measured mean water velocity vs. discharge at Point of Rocks and Little Falls using dye-tracer studies: V_avg = 0.0116 x Q^0.5963 (R² = 0.99)"; over "the 41-mile PoR to LF reach": `T_original = 5174 x Q^(-0.5963)`. Reference list `:830`. Exponent -0.5963 unchanged from Searcy (`model.js:81` "Searcy exponent (unchanged)").
- x 0.80: `tech-appendix.md:95-109`: "Cross-correlation analysis of modern USGS instantaneous data (6 months of 15-minute readings plus 2 years of daily data, January 2026) showed observed travel times are approximately 20% faster than Searcy's 1961 measurements. We apply a conservative 0.80 multiplier". Evidence listed: "Rising limb analysis: peak PoR to LF correlation at 24 hours (r = 0.958)"; "Empirical power-law fit: T = 2438 x Q^(-0.5491), R² = 0.908"; "Likely cause: changed channel conditions". CHANGELOG `src/assets/CHANGELOG.md:120`: "v20 | 2026-01-17 | Empirical travel time correction (x0.80) from cross-correlation analysis." The scripts and data of that January analysis: not found (searched `analysis/`, `scripts/`, repo-wide grep for `2438` and `0.5491`; hits are only prose in the appendix, the science review and the refit plan).
- `model.js:80-84` comments: 4139 "Adjusted (5174 x 0.80)"; 25.8 "(32.3 x 0.80)"; 19.4 "(24.3 x 0.80)"; 6.5 "(8.1 x 0.80)". Comment `:74-76`: "Searcy & Davis (1961) dye-tracer model x 0.80 empirical correction. Investigated via cross-correlation on 117k obs (travel_time_audit.md)."
- 19.4 and 6.5: `tech-appendix.md:125`: "The PoR to GF segment accounts for 75% of total travel time (slower pooled sections above the falls), while GF to LF accounts for 25% (faster flow through the gorge)." No data source for the split is given. Refit plan `analysis/travel-time-refit-plan-2026-06-17.md:38-42`: "GF has no gauge, so PoR to GF cannot be directly observed ... the 75/25 split is an assumption that the data can only constrain indirectly. This is the central methodological limit."; `:267-268` owner decision D2: "knows of no Great Falls ground truth ... the 75/25 PoR to GF split is held fixed, documented as an explicit unfalsifiable assumption". The 6.5 h median-flow figure and 8.1 (=1/4 of 32.3) follow arithmetically (24.3/32.3 = 0.75).
- Rising reduction `Math.min(0.30, ratePerHour * 0.02)`: `tech-appendix.md:156-170` "During rising flood events, the wave front travels faster than bulk water velocity (Fread, 1973)... 2% reduction per 1%/hr rise rate ... Maximum reduction: 30% (physics limit)". CHANGELOG `:117` "v23 | 2026-01-24 | Wave celerity adjustment: up to 30% travel time reduction during rising floods." Reference `tech-appendix.md:834` Fread (1973). No fit to data found for the 2% or the 30%; the appendix text calls the multipliers literature-informed. Not found in `analysis/` (grep "2% reduction", "ratePerHour * 0.02").
- Dye or flood wave: the project itself says the relation is a mislabelled wave-celerity time. `CHANGELOG.md:48` (v36.2): "the time-shift is a hydrograph wave-celerity (signal) propagation lag, faster than bulk water, not literal dye-tracer water-particle travel, with an explicit caveat that the low-flow lag is poorly constrained empirically." `tech-appendix.md:111` repeats it. Science review `analysis/science-review-2026-06-10.md:86,137` (C23): "overestimates the observed hydrograph lag by 10 to 16h (35 to 71%) for LF 1,400 to 4,000 cfs".

### Was GF to LF ever checked against data?
- Not directly. Every check in the repository is on PoR to LF (whole reach) or EF to LF; GF is ungauged (refit plan `:40`, `:267`). The only data-based statements about the whole PoR to LF time:
  - `analysis/travel_time_audit.md` (2026-02-19, Opus audit of `validate_travel_time_python.py`/`_R.R` on 117,704 hourly rows): first-difference cross-correlation of PoR vs LF; lags by regime 7, 26, 15, 12, 9, 7, 9 h (<2k, 2-5k, 5-10k, 10-20k, 20-50k, 50-100k, >100k); fit `T = 25.79 x Q^-0.09`, R² 0.1127; verdict section 6: "0.80 validated? INCONCLUSIVE"; method "valid at high flows (>20k), not at low"; at 20-50k empirical 9 h vs Searcy 10.7 h (ratio 0.84), 50-100k 7 h vs 6.6 h (1.05). Also states the app's use is a level lag, not a change lag (`:3.1`). Recommends event-based peak matching (`:5.2`).
  - `analysis/travel-time-refit-plan-2026-06-17.md` section 11 (run 2026-06-17, exploratory, single language, `hourly_backtest_data_v361.csv`, differenced, gauged tributaries subtracted): observed PoR to LF lag vs the deployed whole-reach time: 1,000-1,400 cfs obs 38 h (r 0.10) vs deployed 60.4; 1,400-4,000 obs 24 (r 0.11) vs 37.2; 4,000-6,000 obs 19 (r 0.21) vs 25.8; 6,000-12,000 obs 15 (r 0.30) vs 18.2; 12,000-50,000 obs 9 (r 0.67) vs 8.7; 50,000+ obs 7 (r 0.92) vs 5.9. Verdict "relation refit NOT worth building"; no refit done; "closed".
- The first look (`analysis/clock_first_look_2026-11-27/README.md`) is the first statement that puts GF to LF in doubt; scripts `lag.py`, `look*.py` are saved, no output files are saved in that folder. Its EF distance figures (25.8 and 9.3 miles) are not in the repository's documents (see section 5).

## 4. What earlier studies found about timing

### a) Rising-limb travel backtest (A7)
- Plan `analysis/rising-limb-travel-backtest-plan-2026-11-10.md`, verdict `analysis/rising-limb-travel-verdict-2026-11-11.md` (FAIL, nothing shipped, A7 closed, TODO A7).
- What was tested: A = delta correction on PoR only, B = travel lookup uses `max(LF, PoR)` flow while PoR is rising (`plan :32`), C = A+B. 21 kept rises with LF peak 12,000 cfs or more (13 more excluded in advance), hourly record Dec 2012 to Nov 2026.
- "Non-convergence" = the 3-pass PoR to GF lookup loop ends without a pass where `|new travel - old travel| < 1.0 h` (`plan :29` "converged = new travel within 1.0 h of old; a non-converged exit leaves `mult = historicMult`"; metric `trace.stop === 'max_iter'`, `plan :109`). Result: baseline fails to converge on 9 of 26 October rising hours (34.6%); B and C bring rising-hour non-convergence from 7.8% to 1.6% "but convergence alone buys little accuracy". B alone: rising-limb gain +6.0% against a 15% bar, fails 7 criteria. A and C pass the originally approved thresholds (+36.6%, +36.1%) but fail G7f (displayed value on rising limb gets 5.49% and 8.27% worse because "the 120 percent cap already hides most of the overestimate"). Shelved per plan: no retuning, no rerun on same data; a new idea needs a new plan and data after 2026-11-09.
- The study's scoring truth used the app's own formula: plan `:99` "tau_0 = 6.5 h; tau_k = getGFtoLFTravelTime(getFlowMultiplier(LF_view(t + tau_(k-1))), riseRate(t))", truth = LF view at first tick >= t + tau_ref (2.5 h search). So all A7 scores sit on the app's GF to LF clock (the plan `:11` holds "the truth" fixed as LF as reported).
- Report-only travel table (not part of the verdict): `analysis/rising-limb-travel-backtest/metrics_python/rising_limb_report_only_python.csv` (`TRAVEL` rows; column definition in `REPORT_ONLY_README.md:11-13`): per GATE event, observed lag (0 to 48 h that maximises correlation of hourly first differences of LF and PoR over [t0-12 h, t0+36 h]) vs modelled mean `travel_por_gf + travel_gf_lf` (whole PoR to LF) on scored ticks. Observed lag by event_id: 11:1, 12:9, 13:12, 16:17, 17:17, 21:8, 22:14, 25:4, 28:8, 30:14, 32:45, 34:14, 35:48, 39:14, 41:16, 43:0, 47:10, 48:15, 49:15, 51:13, 53:20 h (correlations 0.12 to 0.97). Modelled base mean for the same events 17.9 to 49.8 h (e.g. 12: 42.6, 17: 18.8, 22: 20.9, 30: 25.0, 47: 27.6, 48: 17.9, 51: 23.7). No one wrote a verdict on this table (not mentioned in the verdict file).
- Plan `:40`/`:49`: "PoR leads LF by about 13 h (BRIEF)" is the plan's own working figure; lag view: PoR and EF stage seen 2 h late, LF 1 h late (`plan :46-50`).

### b) Cap mechanism map (A4), `analysis/cap-mechanism-map-2026-11-10.md`, section 5
- Eight cap-bound validations 12 to 14 Oct 2026 (table section 4). Statement: "LF (USGS record) reached the replayed raw value 5.9 to 6.5 hours AFTER the validation due time on the last two rows (and 26 h, 12 h, 4.7 h after on the first three). On a steep rise a validation horizon that is too short scores a good 'now' estimate against a too-early LF. The bin cannot tell timing error from level error. One event cannot separate them." Flagged as "A second reading, not excluded", replayed (not logged) raw values, one event. Note: this says the clock was too SHORT on that rise; the 27 Nov first look says too LONG. Both are single-event readings.
- LF value used by the cap and by scoring: latest point of the USGS response, no age check; cron's LF was 10 min old on most ticks and 65 to 70 min old at three times (`:section 1`, REPLAY_NOTES line 50 cited there).
- Cap study `analysis/cap_study_2026-11-26/REPORT.md` section 8 (truth shifted): truth 1 h earlier: every looser rule worse (+2.3 to +4.6 points on rising water); 2 h later: LF3 and LF6 turn slightly better (-0.33). "This study bounds that effect; it does not measure the real arrival time." Note at top (`:7`) says its large-rise figures probably too pessimistic if the clock is too long.

### c) PoR revision and the daily wave (TODO D23, D24, D25)
- Report `analysis/por_revision_and_wave_2026-11-22/REPORT.md`; auditor `RESULTS_AUDIT.md`; wave tables `py_W/tables/W3_*.csv`; spec `ANALYSIS_SPEC_W.md` section W3. Low water (about 1,500 cfs in November 2026), level series of the daily wave (eel-season dam cycle), not rises.
- Lag of the daily wave (cross-correlation of level series, lags 0 to 72 h, `W3_xcorr.csv`, 1 to 22 Nov): PoR to EF 12.9 h (all), 12.8 h (1-13 Nov), 13.1 h (14-22 Nov), r 0.98; EF to LF 17.3 h (all, r 0.68), 17.1 (before), 18.1 (after, r 0.81); PoR to LF 30.4 h (r 0.63; mod 24 = 6.4 h), after the revision 31.1 h (r 0.81) vs 55.3 h (r 0.80). Crests day by day (`W3_crests.csv`): PoR to EF 13.1 h (circular sd 2.0), EF to LF 16.9 h (sd 2.8), PoR to LF 5.75 h mod 24 (sd 3.0). The legs add up within -0.17 h. Next maxima at 36.9/61.1 h (PoR to EF) and 42.2/67 h (EF to LF).
- Report `:137-139`: "The two legs via Edwards Ferry show the total is at least about 30 hours. So it is about 30 or about 54 hours. The data lean very slightly to 30 and do not decide. The model assumes about 49 hours now and assumed 54 before the revision." (`W3_model_times.csv`: mean total PoR to GF + GF to LF 49.2 h NEW, 54.1 h OLD; GF to LF part 12.3 h NEW, 13.6 h OLD.) Audit W-c: "6 h over about 45 river miles at 1,500 cfs is also physically implausible".
- Report `:123-124`: the wave appears "Point of Rocks 13 to 16 hours after the upstream gauges, Edwards Ferry 13 hours after Point of Rocks". Report `:116`: "Travel times at low water are unconfirmed" (in `forecast_from_measured_water_2026-11-24/REPORT.md:116`).
- Non-periodic onsets (`W3_onsets.csv`, July and August 2026): matched PoR to LF onsets 18.2 h and 81.7 h; audit says probably unrelated events, no information. Whole-day count "unresolved".
- TODO D24 text: "(b) whether the wave takes about 30 or about 54 hours to Little Falls".

### d) Other documents that measured a lag between two gauges
- `analysis/validate_ef_lag_python.py` / `_R.R` / `.csv` (2026-02; input `hourly_backtest_data.csv`, 117,704 rows; docstring: "EF is ~2 miles upstream of GF"): correlation of the EF-stage flow estimate with LF discharge at lags 0 to 12 h by flow regime, and blended-model RMSE by lag. Best-lag correlation: below 3k cfs lag 12 h (r 0.231 vs 0.220 at lag 0); 3k to 10k lag 7 h (r 0.757 vs 0.733); 10k to 25k lag 4 h (0.948 vs 0.917); 25k to 50k lag 4 h (0.960 vs 0.903); above 50k lag 3 h (0.980 vs 0.958). Blended RMSE (3k and up): best at lag 4 h, -3.2% vs lag 0 (threshold in script 2.0%). Levels not differences; EF to LF, not GF to LF. No written verdict found (no markdown names this script; CLAUDE.md, README, TODO, CHANGELOG searched).
- `analysis/travel_time_audit.md` and refit plan section 11: see section 3 above (PoR to LF).
- `analysis/forecast_from_measured_water_2026-11-24/REPORT.md:84-86`: "A likely cause of the low-water loss is timing (the daily wave shifted by a travel time that the earlier study could not confirm)". Auditor's exploratory 24 h mean of PoR "removes most of the wave-season loss". Not measured.
- `analysis/onset_correction_2026-11-25/REPORT.md:116`: "The travel-time pairing of the truth was not re-checked in this study."
- `analysis/forecast-validation-timing-fix-plan-2026-08-28.md:39-45`: table of the formula GF to LF time (9.18 h at 2,800 cfs; up to 16.95 h at 1,000 cfs). Formula output, not a measurement.
- `analysis/flow_state_window_diagnostic.md:83`: says "PoR to GF travel time is ~6 hours at median flow (varies 4 to 8 h)", contradicting the 19 h of the code (old text; the 6 h window for flow state was chosen on it).
- `analysis/replay_lag_2026-11-17/`: "lag" there means input-data timing lag, not river travel.
- `analysis/clock_first_look_2026-11-27/README.md`: first look, unverified: 31 past rises, EF and LF hourly changes line up at about 8 h lag (median 8 for 5,000 to 10,000 cfs rises, most 6 to 10); splits by distance to about 3 h for GF to LF. No result files saved, only scripts.

## 5. The gauges and the river (repository only)

| Name | USGS number | Source |
|---|---|---|
| Point of Rocks | 01638500 (Q, H, water temp) | `scheduled-update.js:349`, `src/model/constants.js:27` |
| Little Falls | 01646500 (Q, H) | `scheduled-update.js:350`, `constants.js:26` |
| Edwards Ferry | 01644148 (stage only, ft) | `scheduled-update.js:355` |
| Monocacy | 01643000 | `:351` |
| Goose Creek | 01644000 | `:352` |
| Broad Run | 01644280 | `:353` |
| Seneca Creek | 01645000 | `:354` |
| Difficult Run (audit log only; not in the model) | 01646000 | `scheduled-update.js:2555-2556`; `analysis/decision-brief-A5-A8-2026-11-10.md:18-20`: "Difficult Run joins between the two" (GF and LF) |
| Great Falls | no gauge | `analysis/travel-time-refit-plan-2026-06-17.md:40` "GF has no gauge" |

- Drainage areas (mi²): LF 11,560; PoR 9,651 (83.5%); EF 11,130 (96.3%); Monocacy 817 (7.1%); Goose 332 (3.0%); Broad Run 76; Seneca 101 (`constants.js:26-44`, `tech-appendix.md:38-50`).
- Distances stated (they disagree with each other):
  - PoR: "~34 river miles upstream" (`tech-appendix.md:13`, `README.md:89`, `index.html:248,313`) vs "Point of Rocks, 41 river miles upstream [of Little Falls]" (`tech-appendix.md:38`) and "41-mile PoR to LF reach" (`:83`; Searcy); audit `por_revision.../RESULTS_AUDIT.md` W-c says "about 45 river miles".
  - EF: "~16 river miles above the falls" (`tech-appendix.md:13`, `README.md:90`, `index.html:275,319`) vs "~2-3 miles upstream of Great Falls" (`tech-appendix.md:179`) vs "EF is ~2 miles upstream of GF" (`validate_ef_lag_python.py` docstring).
  - EF to LF travel "~7 hrs" at median flow (`tech-appendix.md:46` gauge table, "Travel to LF" column; by `baseHrs`).
  - GF to LF distance: not in the repository. The first look's "25.8 and 9.3 river miles" for EF and GF above the LF gauge: not in the repository.
  - River miles of Goose Creek, Broad Run, Monocacy: not in the repository.
- Entry points stated in the repository:
  - "Four tributaries enter the Potomac between Point of Rocks and Great Falls" (`index.html:319`); baseHrs to LF: Monocacy 14, Goose 10, Broad Run 8, Seneca 5 (`constants.js:38-41`, `tech-appendix.md:46-50`).
  - Seneca: "enters above GF, below EF" (`tech-appendix.md:50`), "enters below EF but above GF" (`:72`).
  - Monocacy, Goose Creek, Broad Run versus EF and GF: the repository says only "between Point of Rocks and Great Falls". Not stated relative to EF. Difficult Run joins between GF and LF (decision brief above).
  - "Catoctin Creek excluded (enters above PoR gauge)" (`CLAUDE.md:185`).
  - Withdrawals: Washington Aqueduct (at GF), WSSC (Swain's Lock), Fairfax Water (Seneca) "above the falls" (`tech-appendix.md:793`).
- Check of the GF to LF share: `tech-appendix.md:115-121` table at LF flows 1,000 / 2,000 / 5,000 / 15,000 / 50,000 cfs gives GF to LF 17 / 11 / 6.5 / 3.3 / 1.6 h.

## 6. The hourly input file `analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv`

- Built by `analysis/rising-limb-travel-backtest/fetch_hourly_backtest_data_v39.py` (run 2026-11-10): v38 rows verbatim (frozen) plus rows 2026-07-21 00:00 to 2026-11-09 23:00 from USGS IV. Chain: v39 = `analysis/hourly_backtest_data_v38.csv` (generator `analysis/fetch_hourly_backtest_data_v38.py`, 2026-07-20) = `hourly_backtest_data_v361.csv` (generator `analysis/fetch_hourly_backtest_data_v361.py`) plus 2026-06-14 to 2026-07-20. Provenance: `hourly_backtest_data_v39.PROVENANCE.txt`, `hourly_backtest_data_v39.MANIFEST.json` (130,416 rows, sha256 d1d3f6a5...).
- Stamp: `YYYY-MM-DD HH:MM`, UTC, start of the hour. Each value is the "UTC-truncated median of all 15-min readings in [T, T+1h)" (`PROVENANCE.txt:8`; v361 script converts to UTC before truncating `:152-169`). A row exists only if PoR>0 or LF>0 at that hour; other cells blank when missing. Values after 2026-06-14 are provisional USGS; the 864 v38 rows from 2026-06-14 on were re-fetched and differ in the v39 provenance diff but v38 values stay (rows win; "refetched ... differing" listed in provenance; median revision of por_now -4.3%, lf_discharge -1.9%).
- Columns: `timestamp`; `por_now` PoR discharge cfs (01638500, 00060); `por_lagged` PoR interpolated at `t - travel_time_h`, cfs, provenance only; `ef_stage` EF gauge height ft (01644148, 00065); `lf_discharge` LF cfs (01646500); `lf_stage` LF ft (00065); `water_temp_c` PoR water temperature C (00010, blank before 2021); `monocacy`, `goose`, `broad_run`, `seneca` cfs; `travel_time_h` = `max(2, min(48, 4139 * lf^-0.5963 * 0.75))` (`fetch_hourly_backtest_data_v39.py:149-153`; app-formula output, PoR to GF; the refit plan calls both circular, the A7 plan says they are never read, `plan :51`).
- First stamp 2011-12-01 05:00, last 2026-11-09 23:00; 130,416 rows on a grid of 130,987 hours.
- Non-blank hourly stamps per calendar year (counted with a stdlib script, counting only; 2011 is Dec only, 2026 ends 9 Nov; hours possible 8,760/8,784, 2026: 7,155 to 7,156):

| Year | por_now | ef_stage | lf_discharge | lf_stage | monocacy | goose | broad_run | seneca |
|---|---|---|---|---|---|---|---|---|
| 2011 | 739 | 739 | 739 | 739 | 739 | 739 | 739 | 737 |
| 2012 | 8712 | 8736 | 8780 | 8780 | 8736 | 8640 | 8736 | 8784 |
| 2013 | 8661 | 8734 | 8471 | 8495 | 8664 | 8760 | 8639 | 8760 |
| 2014 | 8013 | 8760 | 8496 | 8639 | 8448 | 8712 | 8639 | 8520 |
| 2015 | 8376 | 8688 | 8544 | 8688 | 8376 | 8425 | 8640 | 7534 |
| 2016 | 8400 | 8441 | 8616 | 8712 | 8447 | 7991 | 8712 | 8376 |
| 2017 | 8706 | 8723 | 8678 | 8678 | 8597 | 8544 | 8760 | 8712 |
| 2018 | 8291 | 8654 | 8593 | 8427 | 8488 | 8708 | 8760 | 8760 |
| 2019 | 8645 | 8495 | 8638 | 8536 | 8634 | 8565 | 8760 | 8727 |
| 2020 | 8770 | 8783 | 8773 | 8766 | 8671 | 8620 | 8784 | 8784 |
| 2021 | 8747 | 8753 | 8741 | 8758 | 8693 | 8760 | 8760 | 8724 |
| 2022 | 8685 | 8727 | 8669 | 8722 | 8669 | 8728 | 8728 | 8658 |
| 2023 | 8760 | 7077 | 8746 | 8732 | 8760 | 8760 | 8760 | 8760 |
| 2024 | 8722 | 8658 | 8681 | 8647 | 8667 | 8784 | 8784 | 8679 |
| 2025 | 8422 | 8651 | 8648 | 8686 | 8077 | 8623 | 8698 | 8223 |
| 2026 | 6922 | 7154 | 7074 | 7118 | 6730 | 7155 | 7155 | 7155 |
| total | 127571 | 127773 | 128887 | 129123 | 127396 | 128514 | 130054 | 127893 |

- Longest gap per column (consecutive hourly stamps with no non-blank value, counting absent rows as missing; first and last stamps are non-blank in every column, so no leading or trailing gap):
  - `por_now` 384 h, 2015-02-14 05:00 to 2015-03-02 04:00
  - `ef_stage` 1,184 h, 2023-02-13 20:00 to 2023-04-04 03:00 (about 49 days; explains 7,077 in 2023)
  - `lf_discharge` 168 h, 2013-10-10 05:00 to 2013-10-17 04:00
  - `lf_stage` 168 h, same span
  - `monocacy` 527 h, 2026-01-25 23:00 to 2026-02-16 21:00
  - `goose` 216 h, 2017-01-09 05:00 to 2017-01-18 04:00
  - `broad_run` 120 h, 2014-01-06 05:00 to 2014-01-11 04:00
  - `seneca` 960 h, 2015-07-17 05:00 to 2015-08-26 04:00
- Coverage of `ef_stage` in short: 127,773 of 130,987 grid hours (97.5%); every year 2012 to 2022 and 2024 to 2025 has 8,441 to 8,783 hours; 2023 has 7,077 because of the one 1,184 h gap; 2026 has 7,154 of 7,156.

## 7. The rise list `rising_limb_events_python_v39.csv`

- Script: `analysis/rising-limb-travel-backtest/rising_limb_event_list.py` (blind R twin `rising_limb_event_list.R`; lists agree on all 53 events, plan D-2 `plan :232`); definitions in plan section 3 (`plan :56-75`); summary `rising_limb_event_summary_v39.md`. sha256 978c6c2f...
- The file has 87 rows, one per onset (not per event). A merged event repeats on its component rows. Event ids run 1 to 53.
- Columns: `onset_no, onset_t0, onset_e_end, onset_tp, onset_tend, onset_peak_lf, onset_class` per onset; `event_id, event_row, merged_n_components` and `event_t0, event_tp, event_tend, event_peak_lf, event_class` per (merged) event; windows `rl_start, rl_end, rlx_end, ew_start, ew_end, rec_start, rec_end, rec_n_stamps`; exclusion columns `x0_*`..`x4_*` and `exclusion_reasons`; `kept`, `oct`, `holdout`.
- Meanings (plan section 3): onset t0 = first stamp with LF >= 6,000 after LF was <= 4,500 within the prior 48 h; tp = first LF maximum in [t0, min(E_end, t0+240 h)); tend = min(E_end, tp+240 h) where E_end = first later stamp with LF <= 6,000; class GATE if LF peak >= 12,000, STRATUM if 8,000 to 12,000 (reported separately, never counts), below 8,000 not an event; events within 48 h of the previous tend are merged. RL window = [t0 - 12 h, min(t0 + 24 h, tp)]; RLX = [t0 - 12 h, tp]; EW = [t0 - 12 h, tend + 24 h]; REC = recession stamps after tp. `oct` = contains 2026-10-14T12:00Z; `holdout` = events 47, 48, 49, 51.
- Rows by `event_class` and `kept` (counted): GATE kept 21, GATE not kept 13, STRATUM kept 16, STRATUM not kept 4, no class (below 8,000) 33 rows with blank class and blank kept. By event (summary file): GATE 34 events, 21 kept; STRATUM 19 events (20 rows because of one merge), 15 kept (16 rows). October event id 53 is kept, `oct=1`; 4 rows `holdout=1`; 53 rows `oct=0`.
- Exclusion flags (plan `:68-73`), applied in order: X0 burn-in (RL start before 2012-12-01 00:00); X1 ice risk (any stamp in [t0 - 24 h, tend] in Dec to Mar with PoR water temperature <= 5 C or blank); X2 outage (on raw readings, PoR or LF has a run of 6 or more consecutive missing hourly stamps or more than 10% missing in [t0 - 12 h, tend]); X3 fewer than 6 scored rising-limb ticks after the truth mask; X4 tend beyond the end of data. GATE flags counted in the summary: X0 2, X1 10, X2 4, X3 1, X4 0 (overlapping).

## 8. How scoring works around the due time (`netlify/functions/scheduled-update.js`)

- Cron: `netlify.toml:37-38` `schedule = "0 */1 * * *"` (hourly).
- Due time: set when the estimate is made, `:1117` `Date.now() + travelGFtoLF` hours (section 1). One row, `observation_type 'gf_prediction'`, `gauge_id 'pending'`.
- Truth: `:1236` `const actualCFS = lf.q;` where `lf.q` is the LAST value of the USGS IV response for LF at the time the cron runs (`:400-419`, `val > 0 && val < 9999999`; `qTime` recorded since v39.2 for the log only). No nearest-reading search, no interpolation, no window around the due time; `lf.q` is whatever LF reading USGS served last (cap map reports it was 10 min old on most ticks, 65 to 70 min old at times, `cap-mechanism-map-2026-11-10.md` section 1). Range guard `:1152` `lf.q < 500 || lf.q > 500000` skips all validation. Stage truth `lf.h` (`:1253`).
- Window: `:1223-1227` "v34.0: Reject validations >2.5h after due time"; `now >= validationDue && validationDelayMs <= VALIDATION_MAX_DELAY_MS` with `VALIDATION_MAX_DELAY_MS = 2.5 * 60 * 60 * 1000` (`shared/model.js:872`). With an hourly cron the normal delay is 0 to 1 h (comment `:1224`). A row that misses the window "remains pending until 48h stale cleanup" (`:1225`; `staleThreshold` `:1173`) or until a later `storePrediction` replaces it.
- Error and learning on validation: raw error `rawFinalCFS - lf.q` is the learning target; corrected error `predictedCFS - lf.q` is the headline (`:1236-1250`); stage error uses `lf.h`.
- Single slot: `storePrediction` (`:2013-2066`) reads the one pending row; if it exists and `!isExistingPredictionReplaceable(existing.data, Date.now())` it logs "Skipping new prediction, existing pending still in window" and returns `'skipped_in_window'` (`:2032-2034`, outcome stored in the tick log as `slot`). `isExistingPredictionReplaceable` (`shared/model.js:886-889`) = due date unparseable OR `now - due > 2.5 h`. Order in the handler: validation `:3454`, forecast validation `:3467`, store `:3567`. `sync-learning.js:523` uses the same rule. Consequence stated in the repo: one scored validation per travel time; October 2026: 26 hourly ticks gave one scored validation (`decision-brief-A5-A8-2026-11-10.md:43`); A6 (multi-pending) closed on a failed gate (TODO A6).
- 48 h forecast rows: separate rows `gf_forecast_pending` (cap 300 per read), ripe at `targetTime + offset + 15 min` (section 1), truth `lf.q` at the time of the cron run that finds them ripe, no 2.5 h limit (they live until 90 h old, `:45`, `:2231`).
- What the locked (admin) section shows (`index.html:444` `#learnUnlocked`, PIN in `src/ui/auth.js`; filled by `src/ui/learning-ui.js`):
  - "Validation Status": `learn-val-countdown` = `gfEstimate.validationCountdown` = the browser's GF to LF time, 1 decimal (`great-falls-ui.js:324-326`); `learn-val-last` text with pending count and validation totals (`learning-ui.js:26-34`).
  - Dashboard tiles (`index.html:444-460` area, `learning-ui.js:204-262`): current LF, GF estimate, PoR, EF stage, Monocacy, Goose, `dash-travel` (PoR to LF hours), "valid / total" validations, `dash-gf-error` = `meta.avgErrorPercent` (percent), hard/soft flag counts, runs, stage error clean (ft, n), bin writes.
  - "Prediction Accuracy (7d)" (`index.html:597`; `learning-ui.js:543-620`): SVG chart of predicted vs actual LF, one point per validation, data from `sync-learning?endpoint=validation-history`, stored by `storeValidationPair` (`scheduled-update.js:568-611`: `timestamp` = time of validation, `predictedCFS` corrected, `actualCFS` = `lf.q`, `errorPercent`, `flowBin`, `flowState`; 30 min dedupe, 7 day trim). Summary text `Avg error: +/-x% (n validations over Hh)`, hard-flagged points hollow and excluded from the average.
  - GF flow-bin corrections table, shadow-model horse race, system diagnostics, admin actions. The 48 h forecast accuracy line is shown from `gf_forecast_metadata` (not in the locked panel; not checked here).
  - The phrase "reading low" is not found in `src/` or `index.html` (grep); the "reading low" note named in TODO D28 may be a client string built elsewhere or an older label. Not found.

## Gaps and limits of this sheet
- Not read: `.claude/HANDOFF*.md`, `analysis/pulse-audit-2026-10/` (tick_log and validation_log extracts), live Supabase data. A direct count of how often `mult` came from the historic PoR flow versus current LF flow needs `tick_log` `trv.stop` and `trv.mult`, which this sheet did not query.
- The January 2026 cross-correlation behind the x 0.80 factor: scripts and data not found in the repository.
- Distances (miles) to Great Falls and Little Falls from EF: not in the repository; repository statements conflict (section 5).
- `src/ui/great-falls-ui.js` line numbers are from the current file; TODO rows 24 and 25 and the cap map cite older line numbers (`:407`, `:239`) that have moved.

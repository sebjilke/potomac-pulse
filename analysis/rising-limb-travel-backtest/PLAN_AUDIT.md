# Plan audit: A7 rising-limb travel and delta backtest (plan DRAFT v1, 2026-11-10)

Auditor: independent Opus agent, did not write the plan. Read-only. No arm was run and no error metric was computed. The only computation was the event detector on `hourly_backtest_data_v38.csv` (script: `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/a7/audit/events.py`).

**Verdict: APPROVE WITH CHANGES.** Five blockers. Three of them need an owner answer before any script runs (section 9).

## 1. Event count (run on v38; October 2026 not in the file)

Rule as written: LF crosses 6,000 from a 48 h minimum of 4,500 or less; peak 12,000 or more; LF gaps of 3 h or less filled.

- Detected over the whole file: 33 events. Per onset year: 2012 3, 2013 0, 2014 1, 2015 4, 2016 3, 2017 3, 2018 1, 2019 2, 2020 2, 2021 4, 2022 4, 2023 1, 2024 2, 2025 1, 2026 2. That is about 2.3 a year, not 3.
- After the burn-in (onset on or after 2012-12-01): 31.
- Excluded: X1 ice removes 10, X2 outage removes 6, X4 removes none. They overlap. **20 events are left**, plus October 2026 and any other rise between 2026-07-21 and 11-09 (not known until the v39 fetch).
- The brief's estimate of about 43 was wrong. **The plan's own floor (fewer than 30 non-October events means FAIL-INSUFFICIENT) ends the study before any arm runs.**
- Sensitivity, post-burn-in, kept after exclusions:

| Peak threshold | Kept events |
|---|---|
| 6k (any crossing) | 61 |
| 8k | 36 |
| 10k | 28 |
| 12k | 20 |
| 15k | 17 |

  With the 12k peak, moving the prior minimum to 5,000 gives about 25; moving it to 4,000 gives about 17. Without X1, 27 are left.
- Composition of the 20:
  - 17 are PoR-led. Only 3 are LF-led like October (PoR below 50 percent of LF at t0).
  - All but one fall in June to November. Winter and early-spring events are almost all removed by X1, because temperature is blank before 2021 and X1 then treats every December to March hour as ice risk.
  - The holdout H (last ceil(0.2 x 20) = 4 events) is 2024-08-09, 2024-09-29, 2025-05-04 and 2026-05-23. On 4 events, breadth of 65 percent means 3 of 4.

## 2. Code reading (scheduled-update.js 784-980; shared/model.js 371-406, 436-547, 759+)

- The plan's facts are right: the line numbers, the loop exits, the 30 percent cut, and the delta block scaling the whole sum at :875.
- A1 is a faithful reading of "stop scaling the tributaries".
- B2, worked through the loop. When rising, `historicMult = f(max(hist, por.q)) = f(por.q)` whenever the current flow is at or above the lagged one. That value does not depend on the lookup, so the loop converges on pass 1 or 2. Consequences:
  - G5 is passed almost mechanically by B and C. It is a sanity check, not evidence.
  - B shortens travelGFtoLF, so it moves validationDue. In single-slot learning it also frees the slot sooner.
  - B switches off when PoR goes steady at the crest. LF is still rising then, so base behaviour returns for the hours between the PoR crest and the LF crest, which fall inside RL. That is the owner's "when rising", so it stays (see PA-13).
- B uses PoR flow in a curve calibrated on LF flow (PoR is about 0.85 to 0.9 of LF). That makes B's travel slightly long. It is the same convention the base loop already uses for historicPoR, so no change.
- Constants were tuned on this same file in the base configuration (TRAVEL_COEF/EXP in the v36.2 refit, DECAY_CAP 0.50, ceiling 1.20). That is a home advantage for base. It is conservative, and it is stated as a limit.

## 3. Amendments (binding)

### PA-1 BLOCKER: event count against the floor of 30
- At 12k there are 20 non-October events, so the plan ends FAIL-INSUFFICIENT.
- Changing thresholds now is outcome-blind, because no arm has run. It is still a choice, so the owner makes it, once, before step 3:
  - (a) Keep peak 12k as approved and set the floor to 15 non-October events. Say plainly that the power is low and that the holdout is 4 events.
  - (b) Peak 8k: 36 events. The mechanism, base-flow reach-back, does not depend on peak size.
- Recommend (a), plus the 8k-to-12k rises as a pre-registered report-only stratum with the same RL metrics. Smaller rises matter to paddlers, and B acts on them.
- No other threshold may move.

### PA-2 BLOCKER: the event definition is circular
tp is defined on [t0, tend] and tend from tp, so two blind analysts can differ (P2). Replace it with:
- E_end = the first stamp after t0 with filled LF at or below 6,000, searching up to t0 + 30 d.
- tp = the first argmax of filled LF on [t0, min(E_end, t0 + 240 h)).
- tend = min(E_end, tp + 240 h).
- Qualify on LF(tp) >= 12,000 before merging. Then merge.
- LF(t0 minus 1 h) and the 48 h minimum use the filled series. A missing value at t0 minus 1 h means no onset.
- Without this rule, long high-water periods (for example 2012-12-21, where tp falls 1,020 h after t0) put REC in a different flood.

### PA-3 BLOCKER: learning cadence
- Primary = a single-slot prequential replay, with one independent pending chain per arm, in production order at each tick:
  1. Validate a due pending at the first tick at or after due, within 2.5 h. The LF guard [500, 500000] applies.
  2. If the pending missed its window, it stays until `isExistingPredictionReplaceable` lets it be replaced (due + 2.5 h); the 48 h stale cleanup also applies.
  3. Predict.
  4. Store only if the slot is free.
- Every tick's prediction is scored. Only stored predictions teach the bins.
- Multi-pending becomes report-only.
- Why:
  - Production has one slot. October gave 7 validations on 66 rising predictions.
  - The v38 precedent showed the two modes reach different conclusions (normal-hours degradation 1.66 percent multi against 11.4 percent single).
  - Faster bins absorb exactly the rising-limb residual under study.
- The single mode in `v38_gate_harness.mjs` shares one slot across configs. It must be per-arm here, because B changes due times.

### PA-4 BLOCKER: the ceiling masks the arms
- On the October rise every scored value was exactly 1.2 x stale LF. Displayed error there does not depend on the arm, and the plan's 1 h-lagged LF is staler than production's (about 10 min), so the cap binds more often in replay.
- G1, G2 and G6 use corrected UNCLIPPED error: `rawFinalCFS - correctionApplied`, which equals `trace.unc`.
- New G7f: displayed-error gain on RL >= 0 (point estimate).
- Raw error stays G7a.

### PA-5 BLOCKER: leakage in the 1 h view
- Stamp T is the median of [T, T+1h). The generating script `resample_to_hourly` confirms it: UTC truncation, median.
- With s = t minus 1 h, the PoR bucket holds readings up to t minus 15 min. The fitted PoR delivery lag is 55 min (Broad Run 50, EF 45). So the view is about 20 to 40 min fresher than the cron's for exactly the input that B uses as "current".
- The plan's claim that the 1 h view "errs on the side of not leaking" is false for those gauges.
- Fix: stamp lag 2 h for PoR (discharge and temperature), Broad Run and EF stage. Keep 1 h for LF, Monocacy, Goose and Seneca. History timestamps stay at the bucket centre s + 30 min.
- Report the uniform 1 h view as S3, report-only.
- Iterate over every UTC hour of the grid, not over CSV rows (the file has no row when both PoR and LF are missing).
- The `por_lagged` and `travel_time_h` columns must not be read.

### PA-6 SHOULD_FIX: the truth horizon
- The base horizon comes from the lagged low flow, which is the bug itself, so scoring at it is biased toward base. Each arm's own horizon is biased toward itself.
- Primary: an arm-independent horizon from the realised river.
  - tau_ref = `getGFtoLFTravelTime(getFlowMultiplier(LF_view(t + tau)), riseRate(t))`, with riseRate from the arm-independent PoR history.
  - Start at 6.5 h. Run up to 3 fixed-point passes, stopping when the change is under 0.5 h; otherwise keep the last value.
  - Truth = LF view at the first tick at or after t + tau_ref, within 2.5 h.
- G7d becomes: gain >= 0 under both the base horizon and the own horizon.
- Learning still uses each arm's own due time, as production does.

### PA-7 BLOCKER (spec): rewiring the learning gate
"Hard = Checks 2 and 3, outliers soft" is not enough. The clamp in `updateCorrectionBin` fires only when isSoftFlagged, and soft needs softScore >= 2. Port lines 1131-1262 exactly:
- Check 1: EF discrepancy > 0.25 against LF, cold or warm by temperature, scores +2.
- Check 2: `estimateLFFlowFromStage(h)` is more than 35 percent above q: hard.
- Check 3: q < 1500 and h > 2.45 and `isIcePlausible(temp, tickMs).plausible`: hard.
- Check 4: |raw err%| > 50 scores +1.
- Check 5: `classifyOutlier(preBin, err)` scores +2.
- Inputs are LF q and h, EF h and temperature from the lag view at the validation tick.
- Import every helper from shared/model.js. Add a text-drift test on the copied block, the same way as for the model.

### PA-8 SHOULD_FIX: variant guards beyond identity
- Run the base equality inside the harness on every tick, with live bins and the full return and trace. Zero tolerance; the v38 harness allowed 2 mismatches.
- Assert the structural invariants on every tick:
  - B equals base wherever `rising` is false.
  - A equals base wherever |pct| <= 5 or there is no history.
  - C equals A wherever B is inactive, and C equals B wherever the delta is off.
- Any violation stops the run.

### PA-9 SHOULD_FIX: independent re-implementation
- The Python check must build its own lag view and its own truth assignment from the raw CSV.
- It must replay the full single-slot chain (arm models, validation, gate, bins) for 3 whole events plus October and match the harness: raw within 1 cfs, bins within 0.5 cfs, chain stores exactly.
- The metric analysts must derive window membership from the frozen event file and assert it equals the harness labels. They must not trust the `ticks.csv` labels.
- No shared helper code between the Python and R analysts.

### PA-10 SHOULD_FIX: G5 and variant A
- The waiver "after seeing results" is a forking path. Remove it. The owner decides before step 5.
- Recommended option: G5 applies to arms that change the travel lookup (B, C). For A, require A's non-converged share to equal base's exactly, as a sanity check.
- The evident intent ("fall below 5 percent", October 41 percent) is a test of the travel fix. Flag this for the owner.
- If there is no answer, G5 applies to all arms as written.

### PA-11 SHOULD_FIX: G3 against the brief
- Brief item 3 is absolute: |raw recession bias| <= 0.6 + 1 = 1.6 pp. The plan's relative-only G3 can be looser.
- Add G3b: |bias_REC(arm)| <= 1.6 pp, pooled, unless the owner says "no worse than base" was the intent.
- Specify the bootstrap statistic for every CI: a ratio of sums per resample for G1, and a difference of |bias| for G3.
- Note: B's G3 point estimate sits on a knife-edge near 0 by construction.

### PA-12 SHOULD_FIX: rule when more than one variant passes
- If A passes and B or C also passes, the A < B < C rule ships A and leaves the travel bug (problem 3) in place, because a paired CI on about 20 events will rarely exclude 0.
- The owner chooses before the run (Q4).

### PA-13 MINOR: diagnostics and reporting
- Report-only diagnostics:
  - PoR-crest-to-LF-crest ticks for B.
  - The brief's literal window [t0, t0 + 24 h]. The plan's RL adds 12 h before t0, a deviation it should state.
  - Event-equal-weighted gain. The hour-pooled cfs MAE is dominated by the 2021-09, 2024-08 and 2025-05 floods.
  - Per-event PoR-onset timing relative to t0, taken from the data.
- The rising-tick denominator is base's `trace.rst`. It is arm-independent, so say so.
- X1 equals every December to March hour before 2021. State that.

### PA-14 MINOR: the live check
- `tick_log` stores no PoR history tail; it keeps only n, first and last times, and the selected historic reading. It does store each gauge's reading time (`qT`).
- Specify the check:
  - Rebuild the 15-minute history from USGS IV, using each tick's logged `qT` as the per-gauge cutoff.
  - Pass if base reproduces the logged raw within max(5 percent, 150 cfs) on at least 90 percent of RL ticks.
  - Pass if the variant's replayed RL raw MAE is below base's logged raw MAE, pooled.
  - Write the fail action now (revert, or do not ship).

### PA-15 MINOR: effort and limits
- Effort is realistically 7 to 9 agent-days with PA-3, PA-6 and PA-9, not 5 to 6.
- Section 8 should add these limits:
  - The kept events are almost all June to November.
  - Only 3 of the 20 are LF-led, as October was.
  - The constants were tuned on this file in the base configuration.

## 4. Other checks
- The data span (2011-12 to 2026-07) and coverage are adequate. The v39 extension is small and its precondition is well specified.
- USGS spot checks (8 rows) are adequate.
- Shared bootstrap indices are the right choice.
- The degrees-of-freedom list (plan section 6) is good once PA-2, PA-3, PA-5, PA-6 and PA-7 are written into it.
- H was not used for any design choice. Only the event counts in the brief touched it, and they are not outcomes.
- With the arms required to pass every criterion and thresholds this large, three arms are an acceptable multiplicity.
- G4b, G6a and G7a to G7e are warranted. G6b on 4 events is noisy but it is owner-approved. Keep it.

## 5. Owner questions (one line each)
1. Gate population: peak at least 12k (about 20 events, floor lowered to 15) or peak at least 8k (about 36)?
2. Does G5 (convergence) apply only to the arms that change travel (B, C)?
3. Recession bias: must it also stay within 1.6 pp absolute (the brief's wording), or only no worse than base?
4. If A and a travel-fixing arm both pass, ship A (simplest) or the travel fix?
5. Must the live check on 2 to 3 logged rises pass before shipping, or does it run after shipping?

# Rising-limb travel and delta backtest: final analysis plan (A7), 2026-11-10
Status: FROZEN on the commit that first adds this file to git. No arm may be run before that commit exists.
This file is the final specification (v3, sign-off edits applied; supersedes DRAFT v1 and v2). No analysis code exists or has run. The plan audit (approve_with_changes, PA-1 to PA-15), the owner decisions of 2026-11-10 and the independent sign-off review (M1 to M9, S1 to S7, minors) are folded in. Two blind analysts (Python, R) and a third implementer can work from this file alone. The only later change path is section 12 (Deviations).
Owner approval: decision-brief-A5-A8-2026-11-10.md section 4 (A7). Ship only if the gate in section 5 passes. A failed gate ends the item.
Precedence: owner decisions beat audit amendments; audit amendments beat the draft plan. Where an owner decision narrows an amendment, the plan says so.
Labels: CODE = read in the repo. BRIEF = from the decision brief or audit. INFERRED = reasoning, not tested.

## 0. Question and what is held fixed

Do any of three changes to the Great Falls raw estimator reduce rising-limb error without harming recessions or normal hours, over all large rises in the hourly record (not October 2026 alone)?
- Held fixed: the truth. Truth is Little Falls (LF) discharge 01646500 as reported, which includes ungauged inflow below Great Falls. Study A5 examines that truth. Every result is conditional on LF as truth. If A5 changes the truth, this study is not re-run silently; the owner decides.
- Held fixed: every constant, the ensemble, the correction bins, the 120 percent ceiling, the outlier rules. Only the lines named in section 1 differ between arms.

## 1. The variants as code changes

Baseline "base" = production v39.4 server path: the function that starts at the anchor `function makeGFPrediction(usgsData, porHistory, waterTempC = null, correctionBins = {}, trace = null) {` in `netlify/functions/scheduled-update.js`. The client mirror (`src/estimation/great-falls.js`) is out of scope.
Anchor rule (M2). Every code location below is defined by an anchor, not a line number. An anchor is the start of exactly one line of `scheduled-update.js` (leading whitespace trimmed; a trailing code comment is not part of the anchor). Each was verified to occur exactly once at commit 20ed8d8. Zero or two matches at run time is a STOP precondition. Numbers in brackets are hints at commit 20ed8d8 only. (The draft plan's numbers 784-980 were stale: the function is 797-993.)
Anchors used for the model:
- MODEL-START `function makeGFPrediction(` [797]; MODEL-END = the first following line that is exactly `}` in column 0 [993]. POR-START `function getPoRFromHistory(history, hoursAgo) {` [490]; POR-END = its first following line exactly `}` [504].
- R `const porRiseRate = getPoRRiseRateFromHistory(porHistory);` [817]
- H1 `let mult = getFlowMultiplier(lf.q);` [818]
- H2 `const historicMult = getFlowMultiplier(historicPoR.cfs);` [831]
- TRAVEL `const travelGFtoLF = getGFtoLFTravelTime(mult, porRiseRate);` [837]
- SUM `porEstimateCFS = historicPoR.cfs + monocacyFlow + gooseFlow + broadRunFlow + senecaFlow;` [871]
- TRIG `if (Math.abs(porChangePct) > 5) {` [882]
- H3 `porEstimateCFS = Math.round(porEstimateCFS * appliedRatio);` [888]
- DUE `validationDue: new Date(Date.now() + travelGFtoLF * 60 * 60 * 1000).toISOString(),` [982]
- TRACE `trace.rawUnc = rawFinalUnclipped;` and `trace.unc = correctedFinalUnclipped;` [955, 957]
Facts of the current code (CODE): H1 uses LF, which is still low on a rise. The loop (3 passes) contains H2; converged = new travel within 1.0 h of old; a non-converged exit leaves `mult = historicMult`. Travel = 19.4 x mult, cut by min(0.30, 0.02 x rate%/h) only when flowState is rising and rate > 0 (`shared/model.js`, `getPoRtoGFTravelTime` and `getGFtoLFTravelTime`). TRAVEL sets `validationDue` at DUE, so B also moves the validation time. SUM is the historic PoR plus four tributaries; if TRIG holds, H3 scales the whole sum by `1 + (ratio - 1) x min(0.50, sqrt(hoursAgo / travel))`. That scales the tributaries.

Variant A, "delta on Point of Rocks only" (choice A1). Replace the H3 line with `porEstimateCFS = Math.round(historicPoR.cfs * appliedRatio) + monocacyFlow + gooseFlow + broadRunFlow + senecaFlow;`. Unchanged: TRIG (5 percent), `fractionElapsed`, DECAY_CAP 0.50, the loop, travel, the no-history branch. A is not "no delta".
Variant B, "rise-aware travel multiplier" (choice B2). Directly after R insert `const rising = !!(porRiseRate && porRiseRate.flowState === 'rising' && porRiseRate.ratePerHour > 0);` (the exact condition of the 30 percent cut). H1 becomes `let mult = getFlowMultiplier(rising ? Math.max(lf.q, por.q) : lf.q);`. H2 becomes `const historicMult = getFlowMultiplier(rising ? Math.max(historicPoR.cfs, por.q) : historicPoR.cfs);`. When not rising, B equals base. B only ever shortens travel. Under B2 the loop converges on pass 1 or 2 by construction, so G5 is nearly mechanical for B and C (audit). B switches off when PoR goes steady at the crest although LF still rises (report-only diagnostic, section 4).
Variant C = A and B together. Nothing else.
Rejected readings (not tested): A2 skip delta on recessions only; A3 drop the delta; A4 change the decay; B1 initial mult only; B3 current PoR only; B4 fixed 9.4 h; B5 current LF. Cap-map variants are not reused.

Implementation without touching production: `analysis/rising_limb_model_variants.mjs` holds a verbatim copy of the MODEL block (MODEL-START to MODEL-END) and the POR block (POR-START to POR-END) with a `variant` argument in {base, A, B, C} and four marked hooks (`// VARIANT-HOOK`): the `rising` insertion after R, H1, H2 and H3. The drift test extracts the production text as whole lines between the anchors, strips only the hook lines, and requires an exact match. Helpers come from `shared/model.js` (all exported).

## 2. Data and the lag view

- Base file: `analysis/hourly_backtest_data_v38.csv`, 127,728 rows, 2011-12-01 05:00 to 2026-07-20 16:00 UTC, built by `fetch_hourly_backtest_data_v38.py` (provenance in `hourly_backtest_data_v38.PROVENANCE.txt`). October 2026 is not in it.
- New `analysis/fetch_hourly_backtest_data_v39.py` (copy of the v38 script, v38 untouched) appends 2026-07-21 00:00 to 2026-11-09 23:00 UTC. v38 rows are frozen and win; overlap is diffed, not merged. Output `hourly_backtest_data_v39.csv` plus `hourly_backtest_data_v39.PROVENANCE.txt`. Data after 2026-06-14 are provisional USGS values (stated, not corrected).
- Series: PoR 01638500 discharge and water temperature; Monocacy 01643000, Goose 01644000, Broad Run 01644280, Seneca 01645000 discharge; Edwards Ferry (EF) 01644148 stage; LF discharge and stage. Each stamp T is the UTC-truncated median of the 15-minute readings in [T, T+1h).
- Water temperature is blank before 2021, so the cold EF branch never runs before 2021 in any arm alike. Under X1 this makes every December to March hour before 2021 count as ice risk (stated; this is why winter events vanish).
- Coverage precondition (before any run): per-day non-blank counts for PoR, LF, EF and the four tributaries for 2026-10-05 to 2026-10-22; the October event (t0 minus 12 h to tend) must have no PoR or LF gap of 6 or more consecutive hours. If it does, October is excluded by X2. What follows from October being excluded, not detected, or in the STRATUM class is fixed in section 3 (October rule).

Primary lag view (PA-5). Ticks are every UTC hour boundary t of the full grid (not CSV rows; the file has no row when both PoR and LF are missing). The model clock is `Date.now = t`. For each gauge the view stamp is s = t minus L:
- L = 2 h: PoR discharge, PoR water temperature, Broad Run, EF stage.
- L = 1 h: LF discharge and stage, Monocacy, Goose, Seneca.
- If the stamp is blank, carry the latest non-blank stamp within 3 h; else the gauge is missing (PoR or LF missing: no prediction; tributary: drainage-area fallback; EF: null; temperature: null).
- PoR history passed to the model: all non-blank PoR stamps s' <= t minus 2 h in the trailing 72 h, each with timestamp s' + 30 min. Current PoR = last entry.
- The columns `por_lagged` and `travel_time_h` in the CSV are never read.
- Why: the fitted PoR delivery lag is 55 min (Broad Run 50, EF 45), so a 1 h stamp view is 20 to 40 min fresher than the cron's. Revisions cannot be observed (stated limit).
Report-only views: S2 = unlagged leaky view (stamp t, history timestamp s'); S3 = uniform 1 h lag on all gauges.

## 3. Events (frozen before any model run)

Detection uses only LF (stamp axis, no lag). Detector series: LF with gaps of 3 h or less linearly filled; longer gaps stay missing. All definitions below use the filled series (PA-2).
- Onset t0: the first stamp with LF >= 6,000, LF(t0 minus 1 h) present and below 6,000, and the minimum filled LF over the prior window [t0 minus 48 h, t0 minus 1 h] <= 4,500. If every value in the prior window is missing, there is no onset.
- E_end = first stamp after t0 with LF <= 6,000, searching to t0 + 30 d. If none by t0 + 30 d, E_end = t0 + 30 d.
- tp = first argmax of LF on [t0, min(E_end, t0 + 240 h)).
- tend = min(E_end, tp + 240 h).
- Classes (applied before merging): GATE if LF(tp) >= 12,000; STRATUM if 8,000 <= LF(tp) < 12,000 (reported separately, never counts toward the gate or the floor); below 8,000 it is not an event (hours stay normal hours).
- Merge test: an event is merged into the previous event when 0 <= t0 minus previous tend <= 48 h. Union = [first t0, later tend]; tp = first argmax of LF over the union; class = higher class. The components keep their own t0 and tp for the REC rule below.
- Windows (tick times): RL = [t0 minus 12 h, min(t0 + 24 h, tp)]. RLX = [t0 minus 12 h, tp]. EW = [t0 minus 12 h, tend + 24 h]. Normal hours = ticks outside every EW of every detected event (all classes, excluded events included).
- REC (M1): REC = the stamps after tp, up to and including tend, that come strictly before r, where r = the first stamp after tp with filled LF > LF(tp) (if none, no cut). REC is empty when tp = t0 + 239 h (the cap edge, where a later rise would otherwise be scored as recession; the 2025-05 event is the known case). For a merged event REC also excludes [t0_k minus 12 h, tp_k] of every later component k (their rising limbs).
- Why 12 h before t0: PoR leads LF by about 13 h (BRIEF) and the failing lookups occur before LF crosses 6,000. The brief's literal window [t0, t0 + 24 h] is a report-only diagnostic.
- Rising tick (convergence, G5, G7e) = an RL tick on the common mask where BASE `trace.rst` is `rising`. This is arm-independent (PA-13).
- Exclusions, applied before results, in this order:
  - X0 burn-in: the RL start (t0 minus 12 h) is before 2012-12-01 00:00.
  - X1 ice risk: any stamp in [t0 minus 24 h, tend] in UTC months 12, 1, 2, 3 with PoR water temperature <= 5 C or blank.
  - X2 outage (orchestrator ruling 2026-11-10, M7): computed on RAW (unfilled) readings, per gauge, PoR and LF separately. The event is excluded if either gauge has a run of 6 or more consecutive missing stamps, or more than 10 percent missing stamps, in [t0 minus 12 h, tend]. The denominator is the number of hourly stamps in that interval.
  - X3 fewer than 6 scored RL ticks after the truth mask. This uses the arm-independent mask, so the step-2 script must implement the section 2 lag view and the tau_ref truth rule of section 4.
  - X4 tend beyond the end of data.
  Excluded events are listed with reasons, reported as a sensitivity, never silently dropped.
- October rule (M8): October is TESTED only if a GATE-class event that survives X0 to X4 contains 2026-10-14T12:00Z (flag `oct = 1`; kept in the pooled arm, removed in the leave-out arm). If October is excluded, not detected, or falls in the STRATUM class: P3 is reported as not applicable; G1b is computed on the same set as G1a and reported as "identical to G1a, October not testable"; and the verdict text must state that the study does not cover the event that motivated it. No threshold changes.
- Count: the audit's 20 events were counted under the DRAFT rule on the v38 file and are NOT the frozen count. The brief's 43 was wrong. The frozen count comes only from step 2 (the event-list script under the final rule on the v39 file). Step 2's output decides PROCEED or FAIL-INSUFFICIENT against the floor before any arm is run, and the event list file is committed to git at that point, with the sha256 in the event-count log.
- Preliminary counts under the final rule (sign-off reviewer, v38 file, before the data extension; the frozen count comes from step 2): 86 onsets; 33 GATE, 20 STRATUM, 33 below 8,000; one merge (two STRATUM rises, 2019-08-07). GATE exclusions: 2 before burn-in, X1 removes 10, X2 removes 4 (raw readings, per gauge) (overlapping). Kept: 20 GATE, 15 STRATUM. Holdout H = 4.
- Floor (owner decision 1, see section 10): FAIL-INSUFFICIENT if fewer than 15 GATE-class non-October events remain after exclusions. No threshold may move to change the count.
- Report-only strata: STRATUM-class events (same RL metrics); LF-led (PoR now < 50 percent of LF at t0) versus PoR-led; season; peak class (12k to 25k, 25k and above); per-event PoR-onset timing relative to t0.

## 4. Evaluation design

Arms: base, A, B, C. Each arm has its own model output and its own correction bins and its own pending chain.

Primary run (PA-3): single-slot prequential replay reproducing production's cadence. One independent pending chain per arm; at each tick, in production order:
1. Validate a due pending at any tick in [due, due + 2.5 h] (`VALIDATION_MAX_DELAY_MS`), retrying at every such tick while LF is missing or out of range.
2. A pending that missed its window stays until `isExistingPredictionReplaceable` allows replacement (due + 2.5 h); the 48 h stale cleanup also applies.
3. Predict.
4. Store only if the slot is free.
Production details (S2), each checked against `validatePendingPredictions` and quoted by anchor: (a) retries: the row is acted on only under `if (now >= validationDue && validationDelayMs <= VALIDATION_MAX_DELAY_MS) {`, and the early returns at `console.log('No LF data for validation');` and `if (lf.q < 500 || lf.q > 500000) {` leave the row in place, so it is retried at the next tick. (b) A hard-flagged pending is still claimed: the claim `const { data: claimed, error: claimErr } = await client.from('potomac_observations')` (a delete) runs before the flags decide `skipLearning`, so the slot is freed and only learning is skipped. (c) Stale cleanup (`const staleThreshold = 48 * 60 * 60 * 1000; // 48 hours` and the loop under it) sits after both LF guards, so it does not run on ticks where LF is missing or out of range. (d) The bin key is ``const binKey = `${flowBin}_${flowState}`;`` with `const flowBin = pred.data.flowBin;`, i.e. the bin stored with the prediction at prediction time, not the bin at validation.
Every tick's prediction is scored. Only stored predictions teach the bins. The single mode in `v38_gate_harness.mjs` shares one slot across configs; here it is per arm (B moves due times). Multi-pending (a pending at every tick, as in the July harness) is a report-only secondary run.
Why: production has one slot (October: 7 validations on 66 rising predictions); v38 showed the modes disagree (normal-hours degradation 1.66 percent multi, 11.4 percent single); faster bins absorb exactly the residual under study.

Mechanics. `analysis/rising_limb_harness.mjs` is a copy of `v38_gate_harness.mjs` (original untouched). Reused: Date.now stub and console mute, per-tick call of the real model, `getFlowBin`, `getGFCorrectionInterpolated`, `updateCorrectionBin`, `applyGFCorrection`, display ceiling (CEILING_RATIO 1.20). Replaced: model call goes to the variants module; inputs go through the section 2 lag view; the config sweep is removed.
Learning gate (PA-7, S1): the ported block is defined by anchors. It is the whole lines of `validatePendingPredictions` from the start anchor `// Check 1: EF cross-check` [1150] through the end anchor `const binUpdate = updateCorrectionBin(binData, errorCFS, isSoftFlagged);` [1367], inclusive (so the guarded bin update is inside the drift test). The drift test extracts whole lines between the anchors and compares them with the ported text after stripping only the permitted hooks: the claim-delete statement (from the claim anchor `const { data: claimed, error: claimErr } = await client.from('potomac_observations')` to its closing `;`, replaced by the harness slot release) and the bin-read statement (from `const { data: existingBin, error: binReadErr } = await client` to `.single();`, replaced by the in-memory bin). If an anchor is missing or not unique at run time, that is a STOP precondition. Checks: Check 1 EF discrepancy > 0.25 against LF (cold or warm by temperature) scores +2; Check 2 `estimateLFFlowFromStage(h)` more than 35 percent above q is hard; Check 3 q < 1500 and h > 2.45 and `isIcePlausible(temp, tickMs).plausible` is hard; Check 4 |raw err%| > 50 scores +1; Check 5 `classifyOutlier(preBin, err)` scores +2. Soft flagged means softScore >= 2 (this alone triggers the clamp in `updateCorrectionBin`). Hard flags skip learning. Inputs: LF q and h, EF h and temperature from the lag view at the validation tick. All helpers are imported from `shared/model.js`. The other side-effect calls inside the block (`logValidationFate`, `insertObs`, `logCtx`) stay verbatim and run against no-op stubs.
Initial state: `buildCorrectionBins([])` at 2011-12-01 05:00 in all arms. Scoring starts 2012-12-01 00:00 (burn-in; arms learn through it).
Learning timing (M9): each arm validates at its own due time with its own `travelGFtoLF`. The learning error is computed as production does at `const errorCFS = rawCFS - actualCFS;`: the stored raw prediction minus the Little Falls view at the validation tick (production's `lf.q` at validation, here the 1 h lag view at that tick). It is never computed against the scoring truth below.

Truth (PA-6, M5). Primary scoring truth is arm-independent. Iteration: tau_0 = 6.5 h; tau_k = `getGFtoLFTravelTime(getFlowMultiplier(LF_view(t + tau_(k-1))), riseRate(t))`, riseRate from the arm-independent PoR history (production `getPoRRiseRateFromHistory`); at most 3 passes. Stop at the first k with |tau_k minus tau_(k-1)| < 0.5 h and keep tau_k (the last iterate). If no pass converges, keep tau_3 and flag the tick (count reported). LF_view at a time between hours is read at the first tick at or after that time. If the LF view is missing at that tick, search later ticks up to 2.5 h after it (mirroring production's retry window); if still missing, the tick is excluded from scoring for every arm. Truth = LF view at the first tick v >= t + tau_ref, with the same 2.5 h search. Common mask = ticks where PoR and LF are available and truth exists; all arms are scored on exactly this set. S1 (report and G7d) scores each arm at the base horizon and at its own horizon.

Metrics. Errors, all in cfs, scored on the common mask:
- e_unc = trace.unc minus truth, where trace.unc is the value the model returns (`trace.unc = correctedFinalUnclipped;`), not rounded and not recomputed as `rawFinalCFS - correctionApplied` (they can differ by up to 1 cfs) (corrected, before the 120 percent cap). Used in G1, G2, G6, G7b, G7c (PA-4).
- e_disp = displayed corrected CFS minus truth (after the cap). Used in G4 and G7f.
- e_raw = `rawFinalCFS` minus truth (unclipped). Used in G3, G7a.
- MAE_RL(arm) = sum over all RL ticks of all included events of |e_unc| divided by tick count (hour-pooled). Gain = 1 minus MAE_RL(arm) / MAE_RL(base).
- Event e improved if the sum of |e_unc| over its scored RL ticks is strictly less for the arm than for base (same ticks on the common mask, so this equals the MAE comparison); ties count as not improved. Every included event has at least 6 scored RL ticks (X3), so no event is scored on fewer. Breadth is an integer comparison: improved x 100 >= 65 x N.
- Recession bias = mean over REC ticks of 100 x e_raw / truth, hour-pooled. D_bias = |bias(arm)| minus |bias(base)|.
- Normal-hours MAE (e_disp, cfs) over normal common-mask ticks.
- Non-converged share = RL rising ticks (common mask) with `trace.stop === 'max_iter'` divided by RL rising ticks, per arm. Lookup failures = share with stop in {no_hist, hist_lost}, same denominator (reported; G7e). Both denominators are on the common mask (S7).
- Report-only diagnostics (PA-13): modelled PoR-to-LF travel versus observed per event (lag 0 to 48 h maximising correlation of hourly first differences over [t0 minus 12 h, t0 + 36 h]); PoR-crest-to-LF-crest ticks for B; literal brief window [t0, t0 + 24 h]; event-equal-weighted gain (hour-pooled MAE is dominated by 2021-09, 2024-08 and 2025-05); cap-bind rate; per-year and per-bin tables; bin EMA trajectories for 12k to 25k rising; S2, S3, multi-pending run.

Uncertainty. Event-level (cluster) bootstrap, 10,000 resamples with replacement, percentile 95 percent interval (linear interpolation, numpy default, R type 7). Two index matrices (M4), produced once by ONE script after the event file is frozen and shared by all implementations: `numpy.random.default_rng(20261110).integers(0, N, size=(10000, N))` for the all-events set, written to `rising_limb_bootstrap_indices.csv`; and `numpy.random.default_rng(20261110).integers(0, N_nonOct, size=(10000, N_nonOct))` for the non-October set, written to `rising_limb_bootstrap_indices_nonoct.csv`. Events are sorted by t0; each file has its sha256 in the event-count log; R reads the files (add 1). G1a and G3a use the all-events matrix; G1b uses the non-October matrix. Named statistics per resample: G1a, G1b: ratio of sums, 1 minus (sum |e_unc| arm / sum |e_unc| base) over the resampled events' RL ticks. G3a: the difference |bias(arm)| minus |bias(base)| recomputed on the resampled events' REC ticks. Normal-hours intervals: calendar-month block bootstrap, seed 20261111, report-only.
Holdout H = the last ceil(0.20 x N_nonOct) GATE-class non-October events by t0. It is a replication check, not a selection set.

## 5. The gate (final)

N = included GATE-class events. "no Oct" drops the October event. Every criterion that applies to an arm must hold for the arm to pass. "Point" means the point estimate decides; "CI" means the 95 percent bootstrap bound decides. Thresholds are exactly the approved ones (15, 10, 65, 2 percent, 5 percent, "no worse than baseline"); the only relaxation is the event floor (section 10).

| Id | Formula | Subset | Threshold | Decides | Arms |
|---|---|---|---|---|---|
| G1a | gain on e_unc | RL, all events | gain >= 15% and CI lower bound > 0 | point + CI | A B C |
| G1b | gain on e_unc | RL, no Oct | gain >= 10% and CI lower bound > 0 | point + CI | A B C |
| G2 | improved events / N, on e_unc | RL, all events | >= 65% | point | A B C |
| G3a | D_bias (e_raw) | REC, all events | D_bias <= 0 and CI upper bound <= +1.0 pp | point + CI | A B C |
| G3b | abs(bias(arm)) (e_raw) | REC, all events | <= 1.6 pp | point | A B C |
| G4a | MAE(arm)/MAE(base) - 1 on e_disp | normal ticks | <= +2% | point | A B C |
| G4b | same, per base-flow-bin x base-flowState cell with >= 200 scored normal ticks | normal ticks | each cell <= +5% | point | A B C |
| G5a | non-converged share (common mask) | RL rising, all events and no Oct | < 5% in both | point | B C |
| G5b | non-converged share(A) minus share(base) (common mask) | RL rising, all events and no Oct | <= 0 in both | point | A |
| G6a | pooled gain and breadth with each single event dropped in turn | (i) RL, all events; (ii) RL, no Oct | (i) every drop: gain >= 15% (10% when the dropped event is October) and breadth >= 65%; (ii) every drop: gain >= 10% and breadth >= 65% | point | A B C |
| G6b | gain and breadth on H | RL, H | gain >= 10% and breadth >= 65% | point | A B C |
| G7a | 1 - rawMAE(arm)/rawMAE(base), e_raw | RL, all events | > 0 | point | A B C |
| G7b | 1 - MAPE(arm)/MAPE(base), e_unc | RL, all events | > 0 | point | A B C |
| G7c | gain on e_unc | RLX, all events | >= 0 | point | A B C |
| G7d | G1a gain under the base horizon and under the arm's own horizon (S1) | RL, all events | both >= 0 | point | A B C |
| G7e | share of RL rising ticks (common mask) with stop in {no_hist, hist_lost} | RL rising | not above base | point | A B C |
| G7f | gain on e_disp | RL, all events | >= 0 | point | A B C |

Notes:
- G3a and G3b together are owner decision 3 (no worse than baseline AND within 1.6 pp absolute). G3a keeps the draft's +1.0 pp CI veto. B's G3a point estimate sits on a knife-edge near 0 by construction.
- G5a/G5b are owner decision 2. For A the loop is untouched, so G5b should hold trivially; a violation is a harness bug and stops the run.
- Rows G4b, G6, G7a to G7f only tighten; none loosens an approved threshold.
- G6a reading (S3). Brief section 4 (A7), item 6, says: "Leave-one-event-out and the last-20-percent holdout keep 1 and 2" (item 1 = 15 percent pooled and 10 percent without October; item 2 = 65 percent breadth). The stricter reading is implemented: dropping any single event must keep the 15 percent gain (all events) and 10 percent gain (no October) and 65 percent breadth, as point estimates. In (i), the drop of the October event is judged at 10 percent, so the approved 10 percent October-out threshold is not silently raised (orchestrator ruling 2026-11-10). G6b keeps the 10 percent holdout gain from the approved draft.

Outcomes (exhaustive):
- PASS: at least 15 GATE-class non-October events remain, all preconditions hold, and at least one arm meets every applicable criterion. The arm that ships is chosen by owner decision 4: C if C passes; otherwise B if B passes; A ships only if neither B nor C passes. The paired-CI simplicity rule of the draft and audit PA-12's options are replaced by this decision. Before the arm ships, the owner signs off the rollback rule of section 11, including its INCONCLUSIVE default (S6); shipping then needs the Code-Change Verification Protocol (server and client mirrors, parity tests).
- FAIL: at least 15 events remain and no arm passes. The item closes. No retuning of variants, windows, thresholds or exclusions, and no rerun on the same data. A new idea needs a new plan and new data (rises after 2026-11-09) or a separate audited design. The verdict names the binding criterion per arm.
- FAIL-INSUFFICIENT: fewer than 15 GATE-class non-October events after exclusions. The item closes; nothing is run.
- STOP (not a verdict): a failed precondition (P1 to P3), a Python/R disagreement, a failed invariant. Investigate; rerun only to fix a proven implementation bug, and log every run.

## 6. Frozen before any arm is run

Variants A1, B2, C; `rising` definition; max rule; anchors of section 1. Lags: 2 h (PoR q and temp, Broad Run, EF stage), 1 h (LF q and h, Monocacy, Goose, Seneca); carry-forward 3 h; history timestamp s' + 30 min; 72 h history. Ticks every UTC hour. Burn-in to 2012-12-01 00:00 (X0); empty initial bins. Single-slot primary; learning gate = production block between the section 4 anchors. Truth horizon tau_ref (start 6.5 h, 3 passes, 0.5 h stop, last iterate kept, 2.5 h search). Event rule: 6,000 / 4,500 over [t0-48 h, t0-1 h] / 12,000 gate peak / 8,000 stratum floor / 30 d E_end / 240 h caps / merge when 0 <= t0 minus tend <= 48 h / 3 h fill. Windows RL, RLX, REC (cut at the first LF above LF(tp); empty at tp = t0+239 h; later component limbs removed), EW. Exclusions X0 to X4, X2 on raw readings per gauge (ruling below), 6-tick minimum. October rule of section 3 (stamp 2026-10-14T12:00Z). Floor 15 GATE-class non-October events. Error definitions e_unc, e_disp, e_raw. Hour-pooled MAE (cfs) primary; strict-improvement tie rule; breadth = improved x 100 >= 65 x N; bias definition; non-converged = `max_iter` only. Bootstrap: 10,000 resamples, seeds 20261110 (events, two index files) and 20261111 (month blocks), percentile CI. Holdout = last ceil(0.20 x N_nonOct). Cells: base bin x base state, minimum 200. Spot-check seed 20261112. Agreement tolerance 0.01. Third-implementation tolerances: raw 1 cfs, travel 0.01 h, bins 0.5 cfs against the harness chain; 1e-6 cfs absolute for the empty-state bin rebuild. G6a (i) judges the October drop at 10 percent, other drops at 15 percent (orchestrator ruling 2026-11-10). Rollback rule (section 11). Files: section 9.
Orchestrator ruling 2026-11-10 (merge and class): events qualify individually at the 8,000 floor (PA-2: qualify before merge); onsets within 48 h after a previous tend are merged; the merged event takes the higher class. This is not circular because qualification uses only each event's own t0, tp and tend, which are defined from LF alone before any merge, and the merge then only unions those fixed intervals; class never feeds back into the definitions of t0, tp or tend.
Orchestrator ruling 2026-11-10 (X2, M7): outage shares are computed on RAW (unfilled) readings, per gauge (PoR and LF separately; either one exceeding the threshold excludes the event), with the denominator the number of hourly stamps in [t0 minus 12 h, tend].
Not allowed after seeing results: changing any of the above, adding or removing events, choosing another metric or truth, picking the best of primary/S1/S2/S3, dropping a year, adding an arm. Anything that looks wrong is a finding; the verdict stays as computed.

## 7. Verification

Preconditions (all before the single gate run; failure = STOP):
- P1 Guards (PA-8, M3). Variant `base` equals production `_test.makeGFPrediction` on every hourly input, run inside the harness on every tick with live bins, full return and `trace`, zero tolerance. Text-drift tests on the model blocks (MODEL, POR) and on the learning-gate block (copy minus permitted hooks equals production text). Cross-arm invariants are asserted every tick and compare ONLY `rawFinalCFS` and the `trace` fields up to and including `rawUnc` (everything after it depends on the arm's own bins, which differ across arms, so comparing corrected outputs would stop on the first tick): B equals base wherever `rising` is false; A equals base wherever |pct| <= 5 percent or there is no history; C equals A wherever B is inactive; C equals B wherever the delta is off. Any violation stops the run.
- P2 Event lists: Python and R analysts, blind to each other and to results, build the list from `hourly_backtest_data_v39.csv` and section 3. Lists must match exactly (t0, tp, tend, class, flags). The agreed list is frozen with its sha256 before any arm runs.
- P3 Mechanism reproduction: if October is tested (section 3 October rule), base on the October 2026 RL rising ticks shows non-converged share >= 20 percent (BRIEF: 41 percent, 22 of 54, under a finer lag model); if not, STOP and report the study as uninformative. If October is excluded, not detected, or STRATUM, P3 is reported as not applicable.
- P4 Fidelity, report only: base raw versus the 20 logged hard-flag raw values within max(5 percent, 150 cfs). The file is `out/replay/fidelity_table.csv` inside `analysis/pulse-audit-2026-10/audit_outputs.tar.gz`.

One gate run writes `rising_limb_ticks.csv` (tick, arm, outputs, rst, stop, travel times, raw, unc, displayed, truth, flags, event id, window labels) and a run log with input hashes.
Blind metrics (PA-9, S4, CLAUDE.md): fresh Python and R subagents, blind to results and to each other, share no helper code. Each computes every number in sections 4 and 5 from `rising_limb_ticks.csv`, the frozen event file and the bootstrap index files. Each derives window membership itself from the frozen event file and asserts it equals the harness labels. Each also recomputes the truth (lag view and tau_ref rule) from the raw CSV and asserts it equals the tick file's truth on all ticks. Outputs `rising_limb_metrics_python.csv/json`, `rising_limb_metrics_R.csv/json`. Agreement: all values within 0.01, counts and ids exact. Divergence = STOP.
Third implementation (PA-9, S5): a Python re-implementation of base, A, B, C written from section 1 (not from the JS) that builds its own lag view and its own truth assignment from the raw CSV. It replays the full single-slot chain (arm models, validation, learning gate, bins) for 3 whole events plus October 2026 (if tested) and must match the harness: raw within 1 cfs, travel 0.01 h, bins within 0.5 cfs, chain stores and validation times exactly. The 3 events are the first, the middle (position ceil(N/2)) and the last non-October GATE-class events by t0. Each window starts from the harness bin state AND the harness pending-slot state saved at t0 minus 72 h (stated limit: earlier state is not independently re-derived). Rounding follows JavaScript `Math.round` (halves toward +infinity): in Python use `math.floor(x + 0.5)`, never the built-in `round` (which rounds halves to even). Files `rising_limb_model_check_python.py`, `rising_limb_model_check.csv`. Addition: for ONE of its events, chosen by seed 20261112 (index = default_rng(20261112).integers(0, number of events checked)), the implementer also rebuilds the bins from an empty state by replaying the baseline arm from the start of the record to that event's snapshot time, and reports the difference from the harness snapshot bin by bin. A difference above 1e-6 cfs absolute is a STOP.
Independent auditor (Opus, a subagent that ran none of the above): checks cross-language agreement, the guards, the learning-gate diff, the gate arithmetic, regenerates both bootstrap index files from the seeds and checks their sha256, and spot-checks live USGS values. Sampling: 8 hourly rows drawn with seed 20261112 from RL tick inputs (2 forced from October 2026 if tested, 1 from 2012 to 2014). For each, compare the PoR/LF/tributary stamp value with the median of live IV 15-minute readings in [s, s+1h) UTC; tolerance 1 percent for approved data, provisional rows flagged. This also checks the bucket convention the lag view relies on. Output `rising_limb_audit.md`.

## 8. What a pass would NOT establish (limits, PA-15)

- Behaviour on real ticks: the cron saw delayed, 15-minute, per-gauge-lagged data; the backtest uses hourly medians and a 1 to 2 h lag view. The October ceiling effect (stale LF at 120 percent) is only roughly reproduced.
- Production learning speed is respected only by the single-slot primary; the multi-pending run is report-only.
- The client path and the 48 h forecast.
- Truth: gains are against LF, which includes ungauged inflow.
- Timing versus level: the study scores level at one arm-independent horizon and does not separate them.
- Selection: the variants were suggested by October 2026. LOEO, holdout and the leave-out arm reduce but do not remove this.
- Home advantage for base: the constants (TRAVEL_COEF/EXP, DECAY_CAP, ceiling) were tuned on this same file in the base configuration. This is conservative against the variants.
- Population: the kept events are almost all June to November (winter lost to X1). Only about 3 of 20 are LF-led like October. About 20 events and a holdout of about 4 give low power; 65 percent breadth on 4 events means 3 of 4.
- Small rises (8k to 12k) are a separate report-only stratum, not part of the gate.
- The third implementation verifies the bin state independently for one event only (see section 7); the other windows start from harness snapshots.
- Criterion G3a for arm B rests mostly on recession ticks where B is inactive, so it is a weak test for B.
- Arm B converges almost by construction, so G5a is weak evidence for B and C.
- Gate relaxation: the floor was lowered from 30 to 15 by the owner (section 10).

## 9. Execution order and outputs (all files in analysis/)

Effort: realistically 7 to 9 agent-days including audit cycles (PA-15).
1. Data extension. `fetch_hourly_backtest_data_v39.py`, `hourly_backtest_data_v39.csv`, `hourly_backtest_data_v39.PROVENANCE.txt`, plus the October coverage precondition result. Blind to: nothing.
2. Frozen event list. `rising_limb_events_python.csv` and `rising_limb_events_R.csv` (two blind analysts, blind to each other, to arms and to results; both implement the lag view and tau_ref for X3), then `rising_limb_events_frozen.csv`, `rising_limb_bootstrap_indices.csv`, `rising_limb_bootstrap_indices_nonoct.csv`, an event-count log with sha256s, produced by one script and committed BEFORE any arm is run. A FAIL-INSUFFICIENT count ends the study here.
3. Parameterised harness with guards. `rising_limb_model_variants.mjs`, `rising_limb_variants_tests.mjs` (identity, drift, invariants), `rising_limb_harness.mjs`. Blind to: metrics code (steps 4 to 6) and to all outcomes. P3 and P4 run here; then the single gate run writes `rising_limb_ticks.csv` and the run log.
4. Blind Python metrics: `rising_limb_metrics_python.csv/json`. Blind to step 5, to step 6 and to the harness source.
5. Blind R metrics: `rising_limb_metrics_R.csv/json`. Blind to step 4, to step 6 and to the harness source.
6. Independent third implementation: `rising_limb_model_check_python.py`, `rising_limb_model_check.csv`. Blind to the harness source and to steps 4 and 5 results; reads section 1, the raw CSV and the frozen event file only. It may run before the gate run, since it needs no outcomes.
7. Agreement check and independent auditor with live USGS spot checks: `rising_limb_audit.md`. Sees all of steps 1 to 6.
8. Gate table filled in and verdict: `rising-limb-travel-verdict-<date>.md`. Lists N, excluded events with reasons, every criterion value per arm, the binding criterion, outcome, and the shipped arm if PASS.
Every CSV has a generating script; no silent drops. If PASS, a separate Code-Change Verification Protocol follows. If FAIL, close A7 in TODO.md.

## 10. Owner decisions 2026-11-10

Given after seeing the audit's five questions; the owner adopted the orchestrator's recommendations.
1. Events that count toward the gate: Little Falls peaks of 12,000 cfs or more. The minimum number of non-October events for the study to proceed is lowered from 30 to 15. Rises peaking between 8,000 and 12,000 cfs are analysed and reported as a separate stratum that does NOT count toward the gate. This floor change is the one explicit relaxation of the originally approved gate. Reason: the real event count is about 20 (the brief's 43 was wrong), so a floor of 30 would end the study before any arm ran.
2. The convergence criterion (non-converged rising ticks under 5 percent) applies only to the arms that change the travel lookup (B and C). Arm A must show a non-converged share no worse than the baseline's. (This replaces PA-10's "equal exactly" with "no worse than"; the owner decision wins.)
3. Recession bias must satisfy BOTH: no worse than the baseline, AND within 1.6 percentage points in absolute terms. (Adopts PA-11's G3b and keeps the draft's relative test; both must hold.)
4. If more than one arm passes every criterion, the arm that fixes the travel lookup ships: C if C passes; otherwise B if B passes; A ships only if neither B nor C passes. (Replaces the draft's A < B < C rule; resolves PA-12.)
5. A live check on logged rises is NOT a precondition for shipping. An arm that passes the gate ships; the next real rises are then compared against the rollback rule in section 11, written now.
Nothing in these decisions loosens the originally approved thresholds (rising-limb error at least 15 percent better pooled and at least 10 percent better with October left out; better in at least 65 percent of events; normal hours at most 2 percent worse). Only the floor in decision 1 is relaxed.

## 11. Post-ship rollback rule (decision 5, PA-14)

Applies to the shipped arm S after release. Qualifying real rises: LF crosses 6,000 from a 48 h minimum of 4,500 or less, peak 12,000 or more (the section 3 rule on live data). Evaluate after each qualifying rise; decide on the pooled result after the first 2 rises, and again after the 3rd.
Compared (from `tick_log`, not `validation_log`, because single-slot learning gives few validations):
- Logged: `tick_log` raw (`raw`), travel-lookup trace fields (stop), and `in.lf`, on ticks inside the RL window (t0 minus 12 h to min(t0 + 24 h, tp)), where t0 and tp come from USGS LF. Edwards Ferry stage and water temperature for the replay are taken from the logged `in` fields.
- Replay of base: rebuild the 15-minute PoR, LF and tributary history from USGS IV, using each tick's logged per-gauge reading time `qT` as the cutoff (the log stores no PoR history tail). Replay the base model on those inputs.
- Truth: USGS instantaneous LF values (IV, as reported) at the first reading at or after t + tau_ref (section 4 rule).
- Replay validity: logged raw on rising ticks differs from base by design when S is B or C, so validity is checked on RL ticks where S equals base: for S = B, not rising; for S = A, delta off; for S = C, not rising AND delta off. The base replay must reproduce logged raw within max(5 percent, 150 cfs) on at least 90 percent of those ticks. The validity set needs at least 20 ticks pooled over the rise; if it has fewer, use the ticks in [t0 minus 48 h, tend] where S equals base (the same validity condition, not all ticks); if the fallback window has fewer than 20 such ticks, the rise is INCONCLUSIVE. If validity fails, the check is INCONCLUSIVE, not a pass; fix the replay, do not decide.
Threshold and action. ROLL BACK (revert S to base in a new minor version via the Code-Change Verification Protocol, record in TODO.md and the analysis log, and notify the owner) if either: (a) pooled logged raw MAE of S on RL ticks is not below base-replay raw MAE on the same ticks and truth; or (b) S is B or C and the logged non-converged share on rising RL ticks is 5 percent or more. No rollback and no further check if both hold across 3 rises. INCONCLUSIVE outcome (orchestrator default, owner to confirm before any arm ships; the owner signs it off as an explicit step before shipping, section 5): the shipped arm stays after the first inconclusive rise. After a second consecutive inconclusive rise the owner MUST decide keep or revert at a written review (what failed in the replay, a logging fix, a recommendation); there is no silent continuation.

## 12. Deviations

This is the only place a later change may be recorded. Each entry needs date, reason, who approved.

**D-1, 2026-11-10, wording clarifications, approved by the orchestrator before any arm was run or any error computed.** The plan text allowed two readings in five places. One reading was fixed for both event-list analysts:
- C1. "A gap of 3 h" means at most 3 consecutive missing hourly stamps.
- C2. A search "up to 2.5 h" after a tick is counted from the first tick found at or after the target time.
- C3. An hourly stamp with no row in the CSV counts as missing for X1 and X2.
- C4. An event "contains" a stamp when t0 <= stamp <= tend.
- C5. Section 2 appends from 2026-07-21 00:00, but the v38 file ends 2026-07-20 16:00. The seven stamps 2026-07-20 17:00 to 23:00 UTC are in neither file and are treated as missing stamps. No event is near them.
The Python analyst reported that the alternative readings of C1 and C2 give an identical event list (sensitivity files `_sensfill2`, `_senstime`).

**D-2, 2026-11-10, step 2 result and freeze of the event list (precondition P2), recorded by the orchestrator.** The Python list and the blind R list agree exactly on all 53 events: t0, tp, tend, class, X0 to X4, kept, oct, holdout, scored rising-limb ticks and peak (`compare_event_lists.py`, 0 differences). Frozen file: `analysis/rising-limb-travel-backtest/rising_limb_events_python_v39.csv`, sha256 978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44 (R copy: `rising_limb_events_R_v39.csv`, sha256 6faa963ffa08bde2b13c962a7adc2782d428a1f3572af44166d94806b586ef35). Counts: 87 onsets; 34 GATE, 20 STRATUM, 33 below 8,000; one merge (2019-08-07); 53 events; GATE kept 21 (20 non-October plus October 2026), STRATUM kept 15; holdout event ids 47, 48, 49, 51. Non-October GATE kept is 20 against the floor of 15: PROCEED. October 2026 is detected (t0 2026-10-12 02:00, tp 2026-10-14 15:00 at 24,300 cfs, tend 2026-10-19 15:00), GATE class, no exclusion, so P3 applies and G1b differs from G1a. Bootstrap index files: all events 10000 x 21, sha256 7eff92a751fd9cc0c6f8e0220998e98788cc2f293b5437088bf9376e1dd96519; non-October 10000 x 20, sha256 c1f50235edf229d65f8dcd0432f0a9699c752e3a67f7fac27e597c040a29ff5c. Not a change to the plan.

**D-3, 2026-11-10, data regime, recorded by the orchestrator as a limit, not a change.** Extended file `hourly_backtest_data_v39.csv`: 130,416 rows, 2011-12-01 05:00 to 2026-11-09 23:00, sha256 d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f (127,728 v38 rows kept byte for byte, 2,688 appended). Refetching the v38 overlap 2026-06-14 to 07-20 showed that USGS has revised its provisional data since the v38 fetch: all 864 overlapping rows differ (Point of Rocks median -4.3 percent, Little Falls median -1.9 percent). Per section 2 the v38 values are kept. The appended months are therefore on a later USGS revision state than the months just before them, and all of it differs from the provisional values the cron saw live. The October 2026 event lies wholly in the appended period. The final report must state this next to any October-specific number. A committed gzip of the extended file accompanies the manifest because the file cannot be regenerated exactly once USGS revises again.

**D-4, 2026-11-10, blindness note.** The R analyst read `netlify/functions/shared/model.js` for the travel functions the plan names without formulas (needed for X3). It did not read the Python script, its outputs, the preliminary counting scripts or the log.

**D-5, 2026-11-10, harness clarifications, approved by the orchestrator after an independent review of the harness and before any arm was run for scoring or any error computed.** The plan was silent or allowed two readings on the points below. None changes a threshold.
- H1. Ticks run hourly from 2011-12-01 05:00 to 2026-11-09 23:00 UTC (first to last CSV stamp).
- H2. Carry-forward uses stamps s, s-1 h, s-2 h, s-3 h, per gauge and per quantity independently.
- H3. Point of Rocks history at tick t is the non-blank stamps s' with t-72 h <= s' <= t-2 h, each given the timestamp s'+30 min.
- H4. Production's critical-ice skip is NOT modelled. The data file holds no ice qualifiers and sentinels are blank cells, so ice cannot be told from an outage. Limit: the harness validates when Point of Rocks is blank and Little Falls is present, and predicts and validates up to 3 h into a blank run, where production during ice would not. This mainly affects December to March normal hours (criterion G4) and the bin state carried out of winter, identically for all arms. Events with ice risk are already excluded by X1.
- H5. Arm-symmetric limits of the replay: a 3 h carry against production's 48 h (24 h for water temperature); hourly medians against 15 minute readings; the lag view is about 35 min staler than the fitted Point of Rocks delivery lag and about 20 min staler for Little Falls.
- H6. Criterion G7d and sensitivity S1: the base horizon is the baseline arm's `travel_gf_lf` at t, the own horizon is the arm's own. Truth at horizon h is the Little Falls view at the first tick v >= t+h, searching v to v+2 h. G7d is scored, for each arm-versus-baseline comparison, on the ticks where `mask==1`, `truth_basehz` is non-blank and the arm's `truth_own` is non-blank; both horizons use that same set.
- H7. Every metric uses only ticks with tick_utc >= 2012-12-01 00:00 (burn-in). The tick file carries an `in_scoring` column for this.
- H8. e_raw = `raw` (rawFinalCFS, rounded as production returns it) minus truth; e_unc = `unc` (`trace.unc` as returned) minus truth; e_disp = `disp` minus truth. A rising tick, for G5 and G7e, is a tick where the BASELINE flow state is rising (`base_rst == 'rising'`), for every arm.
- H9. Each window label holds one event id. A second id in a label is a STOP.
- H10. The drift test also covers the preamble of the learning gate, from `const actualCFS = lf.q;` (last occurrence inside the validation function) to the gate start.
- H11. Sensitivities S2, S3 and the multi-pending replay are produced in the SAME single gate run as the primary results, not after the primary results have been seen. The run also writes the bin and pending-slot snapshots at t0-72 h that the third implementation needs, and records the Node version.
- H12. Under S2 and S3 only the model inputs, the Point of Rocks history and the learning inputs change. Every truth column, tau_ref and the rise rate behind it use the PRIMARY lag view. The mask is the primary mask AND the view's Point of Rocks and Little Falls exist. The same rule applies to the multi-pending replay. (A sensitivity on the lag view changes only what the model sees; the river truth is held fixed.)
- H13. The snapshot for the third implementation holds each arm's bins and pending slot AFTER the full tick at t0-72 h (validate, predict, store). The third implementation resumes at the tick t0-71 h. The seeded rebuild replays the baseline from 2011-12-01 05:00 through the tick t0-72 h inclusive, then compares bin by bin. Bins never written are equivalent to empty bins (count 0).
- H14. For criterion G7b, MAPE is the hour-pooled mean of 100 x |e_unc| / truth over the rising-limb ticks.
- H15. The single gate run must be able to prove which code it ran: the harness, the tick schema and this plan are committed to git first; the run refuses to start if the harness folder has uncommitted changes; and its log records the sha256 of every harness source file, of the tick schema and of this plan, with the git commit.

## 13. Audit response (plan audit 2026-11-10: approve_with_changes)

All 15 amendments are ACCEPTED. None rejected.
- PA-1 ACCEPTED (blocker): floor and gate population decided by the owner, section 10.1; floor 15; 8k to 12k stratum report-only (sections 3, 5).
- PA-2 ACCEPTED (blocker): non-circular E_end, tp, tend, qualify-before-merge, filled series, section 3.
- PA-3 ACCEPTED (blocker): single-slot per-arm chain is primary, multi-pending report-only, section 4.
- PA-4 ACCEPTED (blocker): e_unc in G1, G2, G6; displayed-error check G7f; section 4 and 5.
- PA-5 ACCEPTED (blocker): 2 h lag for PoR, Broad Run, EF; 1 h others; S3 uniform 1 h; grid ticks; section 2.
- PA-6 ACCEPTED: tau_ref arm-independent horizon; G7d under both horizons; sections 4, 5.
- PA-7 ACCEPTED (blocker spec): exact production gate port with text-drift test, section 4 and P1.
- PA-8 ACCEPTED: in-harness zero-tolerance identity and four invariants, section 7 P1.
- PA-9 ACCEPTED: independent lag view and truth, 3 events plus October full chain, label assertion, no shared code, section 7.
- PA-10 ACCEPTED, narrowed by owner decision 2: G5a for B, C; G5b "no worse than base" for A; no post-hoc waiver; sections 5, 10.
- PA-11 ACCEPTED: G3b added (decision 3), named bootstrap statistics, section 4 and 5.
- PA-12 ACCEPTED, resolved by owner decision 4: travel-fixing arm ships, sections 5, 10.
- PA-13 ACCEPTED: report-only diagnostics, base `rst` denominator, X1 statement; sections 2, 3, 4.
- PA-14 ACCEPTED, with owner decision 5: live check is post-ship, design and fail action in section 11.
- PA-15 ACCEPTED: effort 7 to 9 days (section 9) and added limits (section 8).
Conflicts: PA-10 and PA-12 were overridden in detail by owner decisions 2 and 4; PA-1 was resolved by owner decision 1. Audit confirmations kept: shared bootstrap indices, 8-row USGS spot check, G4b, G6a, G7a to G7e, G6b on H.


## 14. Sign-off response (independent sign-off review, 2026-11-10)

All items ACCEPTED and implemented.
- M1 REC cut at the first LF above LF(tp), empty at tp = t0+239 h, later component limbs excluded: section 3 (REC), section 6.
- M2 anchors instead of line numbers, MODEL and POR drift blocks, stale numbers corrected: section 1 (anchor rule), section 7 P1.
- M3 cross-arm invariants compare `rawFinalCFS` and trace up to `rawUnc` only: section 7 P1.
- M4 second index matrix for the non-October set, one script, shared: section 4 (Uncertainty), section 9 step 2.
- M5 tau iteration, last iterate, between-hour reads, 2.5 h search, common-mask exclusion: section 4 (Truth).
- M6 X0 burn-in exclusion; X3 computed in step 2 so the step-2 script implements tau_ref: section 3, section 9 step 2.
- M7 X2 on raw readings per gauge, orchestrator ruling: section 3 (X2), section 6.
- M8 October-detected definition and the not-applicable rules for P3 and G1b: section 3 (October rule), section 7 P3, section 2.
- M9 learning error against the LF view at the validation tick: section 4 (Learning timing).
- S1 end anchor through the guarded `updateCorrectionBin` call, permitted hooks (claim-delete, bin-read), whole-line extraction: section 4 (Learning gate).
- S2 four single-slot production details quoted by anchor: section 4 (Production details).
- Last review round: G6a (i) October-drop at 10 percent (section 5 G6a, section 6); X2 preliminary count corrected to 4 (section 3); rollback fallback window keeps only validity ticks (section 11); e_unc = `trace.unc` as returned and no-op stubs for side-effect calls (section 4).
- S3 brief item 6 read ("keep 1 and 2"); stricter reading implemented in G6a: section 5 (G6a row and note).
- S4 metric analysts recompute truth from the raw CSV; auditor regenerates the indices and checks sha256: section 7.
- S5 pending-slot seeded at t0 minus 72 h, `Math.round` semantics, 1e-6 cfs absolute tolerance: section 7 (Third implementation), section 6.
- S6 rollback replay inputs, validity set for arm C, minimum ticks, IV truth, INCONCLUSIVE rule, owner sign-off step: section 11, section 5 (PASS).
- S7 G5 and G7e denominators on the common mask: section 4 (Metrics), section 5.
- Minor: duplicate status line removed (header); P4 file path (section 7 P4); breadth as integer comparison and the 6-tick minimum (section 4 Metrics); prior window, merge test, union spelled out (section 3); preliminary final-rule counts (section 3); G3a-for-B and G5a weakness limits (section 8).

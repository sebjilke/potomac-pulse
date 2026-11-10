# Audit item A4: how the 120% ceiling works, what it did in October, options

Repo: /Users/sebjilke/Desktop/PotomacPulse (HEAD 5d36cb5, v39.2). Read-only study.
Scratch files: this folder. Scripts: run/cf.cjs, run/cf2.cjs. Extracted audit data: out/, in/. Live bins fetched 2026-11-10: live_gf.json.

Labels used below: LOGGED = a number the cron or USGS recorded. REPLAYED = produced by the audit replay (analysis/pulse-audit-2026-10/REPLAY_NOTES.md). RECONSTRUCTED = my arithmetic on top of those.

## PART 1. MAP

### 1. Server: where the ceiling is computed

- Constant: `CEILING_RATIO = 1.20`, netlify/functions/shared/model.js:502. Client twin: src/model/constants.js:136.
- The one place it is applied: `applyGFCorrection`, model.js:705-721 (client twin src/model/shared-model.js:182-197). Logic, model.js:711-717:
  `correctedFinalUnclipped = rawFinalUnclipped - correction; if (lfCFS > 0) { max = lfCFS * 1.2; if (correctedFinal > max) { correctedFinal = max; ceilingApplied = true } }`.
  So the cap acts on the CORRECTED value (raw minus learned correction), not on the raw. It binds only if corrected > 1.2 x LF. A big positive correction can keep the cap from binding (see "Side effect" below).
- Caller: `makeGFPrediction`, scheduled-update.js:938 (`rawFinalUnclipped = estimatedCFS`, line 936). `lf.q` is passed as `lfCFS`.
- Which LF value: `data[gauges.lf].q`, the LAST point of the USGS instantaneous-values response, scheduled-update.js:268-281 (`qTime` = its timestamp, added in v39.2). There is no age check anywhere. The replay found the cron's LF view was 10 min old on most ticks and 65-70 min old at 10-14T09, 10-14T21, 10-15T09 (REPLAY_NOTES.md line 50, lf_overrides.csv). All 8 cap-bound scored rows equal 1.2 x a reading of that age.
- LF missing: `if (!lf?.q || !por?.q) { return null }`, scheduled-update.js:795-798. No prediction is made at all (tick_log `out: no_prediction`, `why: null_lf_or_por`, line 2656). The `lfCFS > 0` guard in the helper is therefore unreachable on the server. On the client it is reachable (see section 2).
- Fields that record it:
  - Pending prediction (whole `prediction` object inserted as `gf_prediction`/`pending`, scheduled-update.js:1894): `predictedCFS` (displayed, capped), `rawFinalCFS` (raw, before correction and cap, line 958), `correctionApplied` (line 959), `ceilingApplied` (line 977), `lfCFS` (LF used, rounded). The pending row is deleted at validation (delete-before-learn), so these live only until then. They are visible in the public API (`pendingPredictions`, confirmed on the live payload).
  - v39.2 tick_log (one row per run): `ceil: { lim, bound }` built at scheduled-update.js:2434 from trace `ceilLim = lf.q * 1.2` and `ceilBound` (lines 944-946). Also `raw {cfs, stage}`, `corr {bin, st, c, unc}` where `unc` is the corrected value BEFORE the cap, `final {cfs, stage, ts}`, `in.lf {q, qT, h, hT}`. Field list: src/assets/tech-appendix.md:532.
  - v39.2 validation_log (one row per fate): `ceilBound` (scheduled-update.js:1838, 2500), plus `rawCFS`, `corrCFS` (2464-2465), `errRawCFS`, `errPctCorr`, `actualCFS`, `lfAtPred`, `binBefore`/`binAfter`.
  - Console only: lines 949-952.

### 2. Client: the same ceiling, parity, and what the page shows

- The browser calls the same shared helper: src/estimation/great-falls.js:505-508, with `lfCFS: lf?.q || 0`. Then `estimatedCFS = Math.round(correctedFinal)` (line 514). Returned as `cfs` and `inputs.ceilingApplied` (line 597).
- Client LF is the latest discharge value from the browser's USGS fetch (src/data/fetch.js:195-205). It also stores `readTime` for LF (v39.1) but the estimate does not use or expose it. If LF is missing the client passes 0, the cap is silently off, and a number still shows (server would make no prediction).
- `estimateGreatFalls()` does NOT return the pre-cap value, the LF value, or the limit. `correctedFinalUnclipped` is returned by the helper but not destructured (great-falls.js:506). So today the page cannot say what the model said without a code change (additive).
- Parity tests: test/correction-parity.test.mjs (imports both copies; grid includes LF=2500 which forces the cap; lines 58, 85-110 assert `ceilingApplied` and `correctedFinal === lf x 1.2`). test/ensemble-parity.test.mjs:98 compares `ceilingApplied` client vs server. test/characterization/gf-characterization.test.mjs:47,65 snapshots `ceilingApplied` (it picks named fields only, so adding new fields to `inputs` does not change the snapshot). Client and server cannot drift on the cap without a test failing.
- What the visitor sees today (all places checked):
  - Great Falls card: big number `#gf-cfs` (index.html:113, set at great-falls-ui.js:118) with the label "cfs (LF scale)". No cap indicator. `#gf-ci-range` (index.html:121) exists but is always hidden.
  - Advisory boxes `#gf-divergence-advisory`, `#gf-residual-advisory` (index.html:127-139, rendered great-falls-ui.js:199-216). Nothing for the cap. During the flood the residual box was up while the cap bound; a third box would stack.
  - Confidence line (great-falls-ui.js:196): does not depend on the cap.
  - Inputs panel: "Learned correction" (index.html:206, great-falls-ui.js:247) shows the bin correction only; "90% CI" (great-falls-ui.js:251-255) is centred on the CAPPED number (great-falls.js:524, `est - q95 .. est - q05`). Neither says the cap is active.
  - Learning tab dashboard card `#dash-gf-cfs` (learning-ui.js:220) shows the same capped number, no indicator.
  - Forecast graph history: `recordGFEstimate(gfEstimate.cfs, ...)` (great-falls-ui.js:111) stores the capped value in localStorage, so the plotted history is 1.2 x LF on a rise. No indicator.
  - How It Works (index.html:333): "The estimate is also capped at 120% of the downstream gauge reading to prevent runaway overestimates during fast rises." Static text, true but says nothing about when it is active. Tech appendix: src/assets/tech-appendix.md:13, section 5.6 (lines 295-297), and the "estimand" note at line 402.
  - Tooltips: none mention the cap (grep of index.html and src/ui).

### 3. Learning: which error trains what

validatePendingPredictions, scheduled-update.js:
```
1095  const correctedCFS = pred.data.predictedCFS;            // displayed (capped)
1094  const rawCFS = pred.data.rawFinalCFS ?? pred.data.predictedCFS;
1097  const errorCFS = rawCFS - actualCFS;                     // LEARNING target (raw)
1099  const errorPercentCorrected = ((correctedCFS - actualCFS) / actualCFS) * 100;  // HEADLINE (corrected)
1252  classifyOutlier(binData, errorCFS)                       // outlier test on RAW residual
1354  updateCorrectionBin(binData, errorCFS, isSoftFlagged)    // bin learns RAW residual
1629  metaData.sumAbsErrorPercent += Math.abs(errorPercentCorrected)   // accuracy scores DISPLAYED residual
```
- Bin: learns `rawFinalCFS - actualLF`. `ceilingApplied` is never read in this function. The cap has no path into the learned value.
- Accuracy and the validation chart: score the displayed (capped) value. The cap changes only this and what the visitor sees.
- Stage bin uses `rawFinalStage` (1103), also raw.
- On a prediction with `ceilingApplied: true` today: it is validated like any other. It learns its raw residual, it is scored on its capped value, and it is only recorded as `ceilBound` in validation_log. Hard flags (Checks 2 and 3) skip learning; since v39.0 the statistical-outlier check is soft (learned through a clamp, and counted in accuracy).
- v36.0 changelog states the intent: "Ceiling no longer censors learning: it is a display-only guard on the corrected output; the EMA target is the unclipped raw."
- Bottom line: the cap cannot distort the value the bin learns. It distorts only what is scored and displayed. For cap-bound rows the displayed error is small by construction (October: -2,014 to +2,160 cfs) while the raw residual that was learned was +1,160 to +6,070 (replayed).
- Side effect worth knowing: the cap binds only if raw - correction > 1.2 x LF. With the bin now at +3,762, a rising-limb row like 10-13T07 (replayed raw 14,272, LF 11,000) gives 14,272 - 3,762 = 10,510, below the cap of 13,200. It would not be cap-bound, and it would display about 800 cfs BELOW LF. So any rule keyed on `ceilingApplied` depends on the bin in force, and the same weather will flag differently after the flood-born bins.

### 4. Evidence from the flood

Source: analysis/pulse-audit-2026-10/audit_outputs.tar.gz, out/out/learning/s1_validation_table.csv (41 validations, 2026-10-08 to 10-19) and out/out/replay/replay_hourly.csv. Cap-bound validations:

| created | validated | bin / state | LF seen (stale) | displayed (LOGGED) | actual LF at validation (LOGGED) | raw (REPLAYED unless noted) | raw residual that was learned | displayed - actual | learned? |
|---|---|---|---|---|---|---|---|---|---|
| 10-12T02 | 10-12T15 | 12k-25k rising | 6,080 | 7,296 | 9,310 | 12,012 | +2,702 | -2,014 | yes |
| 10-12T15 | 10-13T07 | 12k-25k steady (label wrong) | 9,310 | 11,172 | 11,000 | 16,401 | +5,401 replayed; +9,743 per the bin | +172 | yes, single obs |
| 10-13T07 | 10-13T14 | 12k-25k rising | 11,000 | 13,200 | 11,300 | 14,272 | +2,972 | +1,900 | yes |
| 10-13T14 | 10-13T23 | 12k-25k rising | 11,300 | 13,560 | 13,800 | 14,960 | +1,160 | -240 | yes |
| 10-13T23 | 10-14T02 | 12k-25k rising | 13,800 | 16,560 | 14,400 | 20,470 | +6,070 | +2,160 | yes |
| 10-14T02 | 10-14T06 | 12k-25k rising | 14,400 | 17,280 | 17,400 | 23,277 | +5,877 | -120 | yes |
| 10-14T06 | 10-14T09 | 25k-50k steady | 17,400 | 20,880 | 20,100 | 27,535 LOGGED | +7,435 | +780 | no (hard flag, pre-v39.0) |
| 10-14T09 | 10-14T12 | 25k-50k falling | 20,100 (70 min old) | 24,120 | 23,700 | 28,020 LOGGED | +4,320 | +420 | no (hard flag, pre-v39.0) |

Checks I did: every displayed value equals 1.2 x the LF in column 4 exactly (7,296; 11,172; 13,200; 13,560; 16,560; 17,280; 20,880; 24,120). The "actual" column is the cron's own LF at validation (LOGGED, matches USGS at the 10-minute lag). Learned rows are the 6 clean cap-bound rows (5 rising, 1 steady). Later cap-bound rows (10-14T12 onward) were not cap-bound.

What is logged and what is not:
- LOGGED: displayed value, LF at prediction, actual at validation, bin counts and EMAs on 10-15T16, 10-19T16 and today, and the raw values of the two hard-flagged rows (validation_failure records).
- NOT logged: the raw value of the 6 clean rows. The audit says no raw estimate exists between 10-11T12 and 10-14T06. Their raw numbers are REPLAYED. From the log alone one can only state a lower bound: raw >= displayed + correction in force, which says nothing about the sign of the raw residual.
- One direct test of the replay exists. The steady bin holds a single observation of +9,743 (bin file and analysis/bin-reset-2026-11-10-12000-25000-steady.json). That implies raw = 11,000 + 9,743 = 20,743 for the 10-12T15 row. The replay says 16,401. So on the one rising-limb row that can be checked against a logged constraint the replay UNDER-states the raw by about 4,340 cfs (21%). The other five rows cannot be checked this way.

Reconstruction of the rising bin (12,000-25,000 rising). Live bin today (also unchanged since 10-15T16): n=7, sumError 17,926, sumErrorSq 95,016,418, EMA +3,761.88 (live_gf.json). Method (run/cf.cjs): take the 5 replayed residuals in validation order (+2,702, +2,972, +1,160, +6,070, +5,877; sum 18,781; sum of squares 88,863,217), remove them from the logged sums, and run the real `updateCorrectionBin` from 573d8eb (the version that ran in October; `git show 573d8eb:netlify/functions/shared/model.js`, saved as model_573d8eb.js). Notes: that version has no pre-observation clamp and uses `emaMeanError || meanError`; the bin has n<10 so no clamp applies anyway. Result:
- Implied pre-flood bin: n=2, sumError -855, sumErrorSq 6,153,201 (feasible: two observations of about +1,274 and -2,129), EMA about +316.
- Consistency check: those two pre-flood observations, fed through the EMA in the order (+1,274, -2,129), give +253. The EMA derived from the other direction gave +316. They agree within about 60 cfs. That is a non-trivial check that the replayed residuals are about right as a set (three logged numbers, sum, sum of squares and EMA, against two unknowns).
- Sensitivity: scale all five residuals by 0.9 and the implied pre-flood EMA becomes +2,523; by 1.1, -1,891. So the counterfactual value is only good to about +/-2,000 cfs. It would be wrong to quote "+316" as measured.
- If those 5 rows had not been learned, the bin would be n=2, EMA about +316 (RECONSTRUCTED). Because n<5 the applied correction is blended with the pooled fallback (falling bin +81): about +175 cfs, instead of +3,762 (run/cf.cjs, using the current getGFCorrectionInterpolated).
- Live vs counterfactual applied correction by raw flow, rising state: raw 12,000: +1,371 vs -422. Raw 12,500: +2,233 vs -207. Raw 14,000 to 24,900: +3,762 vs +175. (The counterfactual is slightly negative just under 12,000 because of the 6,000-12,000 rising bin at -1,350 on n=4; that bin is not touched by cap-bound rows.)
- Steady bin: the +9,743 bin came only from a cap-bound row. It was deleted today (TODO A2), so it equals the counterfactual already. Applied at raw 16,000: +912 (reset) vs +2,678 (with it). Live API confirms count 0.
- 25,000-50,000 bins: not touched by cap-bound learned rows (the two cap-bound rows there were hard-flagged and never learned). Under today's v39.0 rules (soft outlier) those two would now be learned, with a clamp only when the bin already holds 10 or more observations.

### 5. Is the audit's claim right?

The audit says rows masked by the cap trained the bins, "which is how 12,000-25,000 rising reached +3,762".

My reading: the first half is literally true, the implied cause is not. The cap was not the cause.
- By code (high confidence, about 95%): the bin learns `rawFinalCFS - actualLF` (scheduled-update.js:1097, 1354). The cap is not an input. Remove the cap from the system and the same five residuals are learned in the same order. The +3,762 would be the same.
- What the cap did: it hid the error. Displayed errors on these rows were -2,014 to +2,160 while raw errors were +1,160 to +6,070, so the accuracy chart and the visitor never saw the over-read that was being learned. Cap-binding is a marker for "raw ran well ahead of the stale LF", so cap-bound rows are exactly the large positive raw residuals. That is selection, not causation.
- Does the raw model's over-read really exist (moderate confidence, about 70%)? Two logged anchors: the two hard-flagged cap-bound rows had LOGGED raw residuals of +7,435 and +4,320 (+37% and +18%). The bin's own logged sums (n=7, total +17,926) require most of the 5 flood rows to be strongly positive unless the two pre-flood observations were each far above +3,000. Against that: the replay under-states the one checkable row by 4.3k, so magnitudes are uncertain, and the replay raw values on this limb are unverified (REPLAY_NOTES.md limit 1).
- A second reading, not excluded: the last two rows are partly a timing effect. LF (USGS record, in/data) reached the replayed raw value 5.9 to 6.5 hours AFTER the validation due time on the last two rows (and 26 h, 12 h, 4.7 h after on the first three). On a steep rise a validation horizon that is too short scores a good "now" estimate against a too-early LF. The bin cannot tell timing error from level error. One event cannot separate them.
- Net: +3,762 is the learned raw residual of a model that ran ahead of Little Falls on a steep rise, whatever the cause. Keeping capped rows out would have left the bin near +300 (+/-2,000) on n=2. That is a real difference, but it comes from dropping the five largest residuals, not from removing a cap artefact.
- Confidence: code claim 95%; "bin would be near +300 to +1,000 without these rows" about 65%; "the cap inflated the bin" about 5%.

---

## PART 3. A4b OPTIONS (for the owner; not a design)

Decision frame. The correction is applied only where the cap does not bind on the displayed side (when it binds, the correction is invisible). So there is a population argument for training on the same population (rows where the cap did not bind). Against that, cap-binding depends on LF age and on the correction already in force, so the excluded set changes with the bin, and it removes exactly the rows with the largest raw residuals.

### Option 1. Exclude cap-bound rows from bin learning (`ceilingApplied` true, so no `updateCorrectionBin`, keep accuracy scoring)
- October result (RECONSTRUCTED): 12,000-25,000 rising stays n=2, EMA about +316 (+/-2,000), applied about +175 instead of +3,762. Steady +9,743 bin never created (already deleted by hand). No effect on 25,000-50,000 learned bins in October; under v39.0 rules it would also have kept two soft-outlier rows (+7,435, +4,320) out of 25,000-50,000.
- Risks: truncation bias. The retained sample is the rows where raw did not run ahead of the cap, so the bin tends to learn smaller corrections and the raw over-read stays unlearned on the next rise (still hidden by the cap, which is the stated purpose). Rising bins starve: only 2 of 7 observations would have survived, and bins under 5 observations fall back to the pooled falling/steady values. The rule is keyed on a flag that depends on the correction in force, so the filter is not stable across bin states. A positive feedback exists in the other direction: a large positive bin lifts the cap-bound test out of reach (raw - 3,762 < cap), so rows stop being excluded.
- Backtest needed: replay all hourly ticks of the 2026-10 flood and the prior large rises (the 117k-hour hourly set referenced at shared/model.js:500 is the natural base; I did not check it is still on disk) through the real `updateCorrectionBin` with and without the filter. Score displayed error by flow state, especially on non-cap-bound rising-limb ticks and the first 12 hours of a rise. Needs the v39.2 `validation_log` (has `ceilBound`, raw, bin before/after) to accumulate several real rises first. Pre-register: rising-limb MAE of displayed value, and bin value stability (run-to-run change per rise).

### Option 2. Keep learning but down-weight cap-bound rows
- Hypothetical, using half the EMA weight (alpha 0.15 instead of 0.3) on the 5 flood rows (run/cf.cjs): EMA about +2,407 (applied +2,407) instead of +3,762. Lifetime sums still take the raw error, so the bin's sigma would still jump.
- Risks: a weight is a free parameter to tune on one event. At 0.5 the bin is still large and positive, so it does not fix the harm the audit named. Pushing the weight near 0 is Option 1 with extra code. Changes the EMA recurrence in shared code that the CI harness and `updateCorrectionBin` tests pin (test/update-correction-bin.test.mjs, ci-harness-crosscheck.test.mjs).
- Backtest needed: same replay as Option 1, scanning weights (for example 0, 0.25, 0.5, 1). Choose by displayed rising-limb error and by stability.

### Option 3. Leave learning as is, fix the cause upstream (rising-limb travel lookup, PoR-delta; TODO A7)
- Hindsight check from the audit's own variants (analysis/pulse-audit-2026-10/audit_outputs.tar.gz, estimator/variants_hourly_chosen.csv, out/ in this folder). Residuals of the 5 rising rows against logged actual LF, and the bin EMA they would leave starting from the reconstructed pre-flood bin (n=2, +316):
  - base (what ran): +2,702, +2,972, +1,160, +6,070, +5,877 gives +3,762.
  - delta correction on PoR only: -893, -322, -2,370, +5,529, +5,471 gives +2,410.
  - fixed 9.4 h travel: +54, +2,417, +467, +5,966, +5,925 gives +3,405.
  - fixed travel plus delta on PoR only: -704, -54, +79, +5,378, +5,532 gives +2,797.
  - no delta correction: -1,391, -4,226, -8,110, +1,820, +1,982 gives -697 (and under-reads by 8,000 on the third row).
- Reading: none of the plausible upstream variants removes the +5,000 residuals on the two steepest rows, which dominate the EMA because they are the latest. Either those are timing (validation horizon) or something none of the variants addresses. In-sample oracle on one event, replay-based, not a result.
- Risks: A7 is large and the audit says it needs A3 data first. Until then the bins keep absorbing rising-limb error.
- Backtest needed: the audit's variant harness extended to a second event, plus a check of the validation horizon (does LF at due time understate the arrival of the water on rises; the five rows reached the replayed raw 5 to 26 hours after due).

### Recommendation (mine)
Do not exclude by `ceilingApplied` yet. Reasons: the cap is not the cause, the filter is keyed on a flag that moves with the bin, and it deletes the evidence of the largest misses. Ship A4a (visible flag) now. Collect the v39.2 `validation_log` rows (they now carry `ceilBound`, raw, bin before and after) over the next 2 or 3 real rises, then run the Option 1 / Option 2 replay on real raw values instead of replayed ones. If an interim guard is wanted, the lower-risk move is a one-time review of flood-born rising bins (today 12,000-25,000 rising +3,762 on n=7, 6,000-12,000 rising -1,350 on n=4), as was done for the steady bin, but that is an owner decision about data, not code. Confidence in this recommendation: moderate (about 65%); the Option 1 case rests on the population argument, which is sound in principle but untested.

Open items I could not resolve:
- Source of the 6,000-12,000 rising bin (-1,350, n=4). Not a cap-bound row; not examined.
- Why the replay misses the 10-12T15 raw by about 4,340 cfs.
- Whether the five learned residuals are level error or horizon error.

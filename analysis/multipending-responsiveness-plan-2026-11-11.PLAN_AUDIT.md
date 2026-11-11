# A6 multi-pending plan: independent plan audit (2026-11-11)

Auditor: a fresh subagent that did not draft the plan. Subject: `multipending-responsiveness-plan-2026-11-11.md` (DRAFT v1). Text as returned by the auditor, saved by the orchestrator. Nothing had been computed and no result file had been opened when this was written.

Orchestrator check of PA-1 (2026-11-11, from `shared/model.js` and the raw hourly file, no model result): the wait before a prediction is checked is 17.0 h at 1,000 cfs, 13.3 h at 1,500, 9.2 h at 2,800, 6.5 h at 5,000, 4.3 h at 10,000, 2.8 h at 20,000 (shorter by up to 30 percent while Point of Rocks rises fast). The median Little Falls flow in the record is 6,680 cfs (10th percentile 1,980, 25th 3,120). The A7 run log counts 23,609 single-slot validations against 127,714 multi-pending ones over about 127,900 scored hours, so the single slot learns about every 5.4 h on average. October 2026 began from a very low river, which is the worst case for the single slot.

---

**Verdict: approve_with_changes.** Do not freeze v1 as written. The three reasons that matter most:
1. **The timing premise is wrong at rise flows.** The plan's mechanism story, R1, the stage-2 constants and the arithmetic in sections 11 and 12 all assume a 13 to 19 h validation lag. That figure holds only near the low-flow floor. On rising limbs the lag is 1.3 to 7 h. The committed run log also shows that single learns about every 5.5 h, not every 13 to 19 h.
2. **A4 cannot pass.** It will STOP the study at the second tick of the record.
3. **The gate cannot tell "works" from "does not work".** Fifteen all-must-pass rows include a coin flip (D1 point <= 0) and several near-zero margins. Even if multi truly helps rises and does no harm, I put the chance of a FAIL at about 85 to 90 percent.

Separately, the multi chain has never been independently verified. Section 10's claim that A7 already verified it is false.

## Findings

**PA-1 (must-fix before freeze). The validation-lag numbers are wrong for rising limbs.**
- Evidence:
  - The due time is the Great Falls to Little Falls travel time: `travelGFtoLF = getGFtoLFTravelTime(mult, porRiseRate)` (scheduled-update.js:837), which is `TRAVEL_GF_LF_BASELINE * mult` with a cut of up to 30 percent while rising. The baseline is 6.5.
  - I computed it from the code. At 1,000 cfs it is 16.95 h. At 2,800 cfs, 9.2 h. At 5,000 cfs, 6.5 h (4.5 h when rising). At 10,000 cfs, 4.3 h (3.0 h). At 20,000 cfs, 2.8 h (2.0 h). At 40,000 cfs, 1.9 h (1.3 h).
  - The brief's "13 to 19 hours at current flows" means low autumn flows only. The GATE events start at about 4,500 to 6,000 cfs and peak at 12,000 to 87,000 cfs.
  - `rising_limb_run_log.json` (committed, holds no errors) gives base counters. Single: validated 23,609, hard 34, soft 2,313. Multi: validated 127,714, hard 316, soft 17,119. That is one single validation per 5.5 ticks on average, and multi has 5.4 times as many.
- Consequences:
  - **Section 0, "structural limit":** wrong. Both policies learn within a few hours once the river rises. The real responsiveness difference is at most about ceil(travel) hours, roughly 3 to 7 h. That points to small effects, which makes R2's 5 percent harder to reach, not easier.
  - **Section 11, EMA memory:**
    - Single's half-weight memory is about 11 h and its 90 percent memory about 38 h on average. The plan says 30 to 40 h and 4 to 6 days.
    - Matching single's memory needs alpha of about 1 - 0.7^(1/5.5), roughly 0.063, not 0.024.
    - "15 times faster" should be "about 5.4 times overall (ceil(travel) times locally)".
    - "Residuals from 13 to 26 h ago" should be "1 to 17 h ago, by flow".
  - **Section 12, live rows:** "up to about 50 rows live" is wrong. A row lives at most travel plus 2.5 h, so at most about 20 rows. `.limit(50)` is not exceeded. Fix "validation_log grows about 15 times" the same way.
  - **Section 9, stage 2:** see PA-7.
- Change:
  - Replace every 13 to 19 h figure with a per-flow table, giving the code anchor for `getGFtoLFTravelTime` and `TRAVEL_GF_LF_BASELINE = 6.5`.
  - Add the run-log counters to section 2 as a prior look (item 9: "base validation counts per mode were public in `rising_limb_run_log.json`").
  - Rewrite the section 0 mechanism paragraph accordingly.

**PA-2 (must-fix). A4 fails by construction.**
- In the single file, `slot` is `skipped_in_window` from the second tick after any store. In the multi file it is always `stored` (TICK_SCHEMA col 47; `MultiChain.store` returns 'stored'). The first validation comes at least 7 h later. So "every column is equal before the first validated tick" fails at tick 2, and that is a STOP.
- Change A4 to: "At every tick before the first `validated == 1` tick in either file, every column except `slot` is equal. In the multi file, `slot == 'stored'` on every row with `has_pred == 1` and `''` or `no_prediction` otherwise."

**PA-3 (must-fix). Rough false-fail risk, and deciding rows versus guard rows.**
- Rough per-row pass chances, assuming multi truly helps rises and does no real harm:
  - D1 point <= 0 pp: about 50 percent, since the true value is 0.
  - S1 and S2 at +0.5 pp: about 60 to 70 percent each. RL has 727 scored ticks, not about 780, so 0.5 pp is 3.6 ticks, and under-reads cluster within events.
  - N2 with a +5 percent point cap on cells of 200 or more autocorrelated ticks: about 70 percent.
  - C2 and C3: about 85 percent each.
  - N1, N3 and C1: about 85 to 95 percent each.
  - B3 (4 events): about 75 percent.
  - R1: about 50 percent (PA-4).
  - R3: about 50 to 60 percent.
- Rows are positively correlated, but the joint pass is still about 10 to 15 percent. A gate that fails a true improvement about 85 to 90 percent of the time is not a fair "no harm" test. The power note in section 7 calls this intended. It should not be.
- Change: split section 7.
  - **Deciding rows:**
    - R2: point >= 5 percent AND CI lower bound > 0.
    - R3: breadth >= 14 of 21.
    - B1: point > 0.
  - **Robustness rows:**
    - B2: every drop > 0.
    - B3: holdout > 0.
  - **Guard rows,** as non-inferiority judged on the CI with a margin:
    - N1: pooled point <= +1 percent AND month-block CI upper bound <= +2 percent.
    - N2: a cell fails if (point > +3 percent AND CI lower bound > 0) OR (point > +5 percent in a cell with at least 2,000 scored normal ticks).
    - N3: point <= +2 percent.
    - D1: point <= +0.5 pp AND CI upper bound <= +1.0 pp. This drops the zero-margin point.
    - C1, C2, C3: unchanged.
    - S1 and S2: point <= +1.0 pp AND event-bootstrap CI upper bound of the share difference <= +3.0 pp. This needs a named bootstrap statistic.
  - All rows still must hold, but the guards stop being coin flips.
  - State the drafter's and your estimate of the joint false-fail rate in the plan.

**PA-4 (must-fix). R1 tests mechanics, and its threshold sits on the mechanical expectation.**
- Single validates about once per ceil(travel) ticks: roughly 1/7 in the 12 h before onset and 1/2 to 1/4 in the rise. Multi validates about once per tick.
- Over a 37 h RL that is about 10 single against about 31 multi event-created validations, a ratio of about 3. So "ratio >= 3" can fail when the mechanism works perfectly, and a mechanics row would then decide a value question.
- Change:
  - Move R1 out of the gate into a precondition labelled P-MECH: "median dD_e > 0 h AND sum K_e(multi) / sum K_e(single) > 1.5".
  - If it fails, outcome STOP-MECH: investigate the harness, no verdict.
  - Report the ratio and dD_e report-only.
  - Note in section 11 that the brief's 8 h version is about ceil(travel(r_e))/2, a phase effect.

**PA-5 (must-fix). MultiChain has never been independently verified.**
- Evidence:
  - D-9: the third implementation "matches the harness on four events" starting from `rising_limb_snapshots_t0m72.json`. That file was written only by the primary single pass: `await pass('primary', H.PRIMARY, false, true)`, and the multi pass has `withSnaps = false`.
  - The seeded rebuild is of "the baseline", single.
  - MultiChain has one unit test (`tests/harness.test.mjs:193`).
  - Section 10 says "Stage 1 needs none, because its chains were already verified by A7's third implementation". That is false for MultiChain.
- The bins cannot be rebuilt from the tick file alone. The soft clamp depends on the EF stage, which is not a column, and on the per-validation outlier z, while `soft_flag` is the OR over validations.
- Change: add a stage-1 third implementation.
  - A Python rebuild of the multi base chain from empty bins over the full grid, from `hourly_backtest_data_v39.csv` and section 4's rules.
  - It must match `corr` on base rows of the multi file within 0.5 cfs on events 11, 30, 51 and 53, and the per-tick validation counts of A7 exactly.
  - Budget 4 to 8 h. Run it on Opus or an equivalent tier, as a verifier.
  - Correct the section 10 sentence.

**PA-6 (should-fix). The cap structure of the displayed value is not used.**
- When both files are capped, `disp = round(1.2 x lf_view)` in both, so the difference is exactly 0. Under single this is 52.5 percent of RL ticks (public). R2's 5 percent pooled therefore means roughly 10 percent on the remaining hours.
- Changes:
  - Add A9: "On base rows with `ceiling_applied == 1` in both files, `disp` is equal."
  - Report-only: RL MAE and signed mean e_disp split into four cells (capped in both, capped in single only, capped in multi only, capped in neither). Report the mean e_disp on ticks capped in neither as the direct analogue of A7's -1,477 to -1,811 finding.
  - State the dilution next to R2.
- I would not add another gate row (PA-3). S1, with the margin fixed, is the guard for the unsafe direction.

**PA-7 (must-fix). Drop stage 2. Do not keep it.**
- **Forking paths:** the trigger selects exactly the pattern (rise rows pass, calm rows fail) that the variant removes mechanically, on the same 21 events. Its rise behaviour lies between single and multi. A stage-2 pass is close to implied by a trigger, so the whole procedure is "R rows pass on multi" with the guards dropped. The live check after shipping does not fix this, because at about 3 rises a year it takes years to say anything.
- **The variant is mis-derived (PA-1):**
  - At RL flows above about 10,000 cfs, travel is 3 h or less. Each row validates before the 3 h spacing allows another, so rise-slots equals single exactly where large rises are.
  - The 4-row cap binds only when travel exceeds 9 h, which means flows under about 3,000 cfs with PoR rising at 1 percent per hour or more. That is rare, so the cap is inert.
  - The operative rule is "one extra row per 3 h during PoR rise mode, mostly below 10,000 cfs".
  - "4 x 3 h = 12 h, about the shortest due time" is wrong.
- **The harness test breaks blindness:** "reproduces the base rows of `rising_limb_ticks.csv` byte for byte" requires the developer to read a forbidden file.
- **Change:** delete section 9 and the stage-2 route in section 8. Record the rise-slots spec as a hypothesis for new data only.
- **If the owner keeps it,** at minimum:
  - (a) Define "newest row at least 3 h old" as `t - max(createdMs over P after step 1) >= 3 x 3,600,000` ms, and "fewer than 4" as counted after step 1.
  - (b) Step 4 returns the string `skipped_in_window`.
  - (c) Step 1 is exactly `isExistingPredictionReplaceable(row.data, t)`, applied whether or not LF is valid, to mirror `ArmChain.store`.
  - (d) The equivalence tests compare the whole-file sha256 of a regenerated 4-arm file to 8d8411... and c99c4b..., never by reading rows.
  - (e) Note that `rst` comes from `getPoRRiseRateFromHistory`, whose flowState is `getFlowState` on the history's last entry, not `flow_state`.
  - (f) The "3 times the flow-state threshold" equivalence holds only above 5,000 cfs. Below that, the 100 cfs floor dominates.

**PA-8 (should-fix). The FAIL consequence is broader than what is tested.**
- The plan tests multi at alpha 0.3, which cuts the EMA's time memory by about 5 times. The obvious shippable alternative is multi with alpha matched to single's memory. It is banned here (section 2) and never tested anywhere.
- Change the FAIL action to: "closes multi-pending at alpha 0.3, as replayed here, on this record. It does not test memory-matched alpha or per-hour weighting." Leave the alpha ban in place for this record.

**PA-9 (should-fix). Formulas two blind analysts could compute differently.**
- **T80:** write "G = number of grid ticks with `in_scoring == 1` (122,208 by my count, 2012-12-01T00Z to 2026-11-09T23Z); T80 = 2012-12-01T00:00Z + floor(0.8 x G) h (= 2024-01-26T14:00Z)", or say explicitly that "scored" means in_scoring AND mask AND has_pred AND normal, and give the index base.
- **Month block:** "per resample, relative change = sum |e_disp|multi / sum |e_disp|single - 1 over all scored normal ticks (per cell: of that cell) of the drawn months, counting multiplicity; months are taken from `tick_utc` in UTC; the month list is built from base rows of the single file after A5." Also say which columns the month script may read (tick_utc, in_scoring, mask, normal, has_pred only).
- **N2 cells:** the cell set is fixed from the full sample. A resample with zero ticks in a cell gives an undefined value; say that such resamples are dropped and counted.
- **D1:** per resample, compute bias per mode on the drawn REC ticks with multiplicity, then |bias multi| - |bias single|. Event 49 has 0 REC ticks.
- **dD_e median:** median of 21 values in the extended reals = the 11th order statistic. By A8, a finite D(single) with an infinite D(multi) cannot happen. Assert it.
- **B1:** "The non-October file serves B1" while B1 is point-only. Either delete the sentence or add a CI.
- **Ties:** state that Gain = 0 fails B1, B2 and B3, and that full precision comparison applies.

**PA-10 (should-fix). A6 checks consistency, not completeness.**
- Add: "and every stored single pending s whose first tick v >= due with a valid LF view has v - due <= 2.5 h is validated at v". Without this, a missed validation is not caught.
- Also state the LF guard exactly as code: `!lf_view || lf_view < 500 || lf_view > 500000` (blank = invalid). I confirmed that `lf_view` is the `lf.q` the guard uses (`inp.lfq` → `d[GAUGES.lf] = { q: nn(lfq) }`). This resolves the drafter's open point.

**PA-11 (should-fix). The outcome set has gaps.**
- FAIL-INSUFFICIENT cannot occur. All 20 non-October GATE events have 14 or more scored RL ticks in the frozen event file, and the A5 tick has no label.
- There is no outcome for:
  - (a) A3 failing because the design is invalid rather than because of a bug;
  - (b) a proven MultiChain bug, which needs a rerun of the multi pass at a fixed commit.
- Add:
  - "VOID: A3 fails for a non-bug reason. A6 cannot be answered from these files."
  - "RERUN: a proven MultiChain bug is fixed in a committed harness, the multi pass alone is regenerated from 17c6060 plus the fix by someone blind to results, new sha256 logged, analysts restart."

**PA-12 (should-fix). The direction of the prior is stated one-sidedly.**
- June found that multi reduced storm under-prediction (bias -297 to -251; 50k+ rising -424 to -279) and significantly helped the 25k to 50k and 50k-plus rising cells (findings lines 26 to 35).
- The plan's INFERRED story, that faster learning pushes the display lower, is plausible under v39 but conflicts with June's direction on v36.
- State both in section 0, and label the v39 mechanism as untested.

**PA-13 (should-fix). Section 12 corrections and omissions.**
- Live rows: at most about 20 (PA-1).
- `scripts/recover-bins.js:119` also reads `gauge_id = 'pending'`. It is missing from the list.
- The stage bins (`stage_${flowBin}_${flowState}`, scheduled-update.js:1387 to 1446) also learn on every validation, so stage learning changes too.
- The LF-residual advisory's freshness rule (newest pair at most 12 h old) would almost always be met, which changes its meaning, not only its latch cadence.
- `analyze-stage-errors.js` reads `gauge_id = 'validated'` (legacy), not pending. It is not affected.
- Netlify scheduled functions have a 30 s limit as far as I recall from Netlify's docs. I did not verify this here.

**PA-14 (note). Section 1 can be stated more strongly.** `git diff 17c6060 -- netlify/functions/shared/model.js netlify/functions/scheduled-update.js` is empty. The base arm is therefore the current production code. Replace "I did not diff the code" with this.

**PA-15 (note). "Count of soft-flagged validations by mode" cannot be computed from the multi file.** The outlier check is per validation, and `soft_flag` is ORed. Replace it with "ticks with `soft_flag == 1` by mode". Per-validation totals are in the run log, which is now a declared prior look.

**PA-16 (note). Section 11's clamp text is correct but incomplete.** The clamp acts only on soft-flagged observations: z > 3 (`softScore += 2`) or EF discrepancy over 25 percent. A sustained shift under z = 3 is unclamped under both policies. The `preCount >= 10` gate is also reached about 5 times sooner under multi.

**PA-17 (note). Seed 20261116 is used twice** (auditor spot-check and the stage-2 event pick). Use separate seeds.

## Code claims checked

| Claim | Result |
|---|---|
| `await pass('multi', H.PRIMARY, true, false);` in run_gate.mjs | Confirmed (both files from one run at 17c6060, per the manifest) |
| ArmChain tick order: validate, then predict, then store | Confirmed (`rising_limb_harness.mjs:216-221`) |
| MultiChain: pending at every tick; validate all due rows in creation order; drop on missed window; 48 h stale; LF guard skips all; `out.hard = out.hard \|\| res.isHardFlagged` | Confirmed (lines 321-339). The stale check comes before the due check; it cannot bind for validations because travel is at most 17 h |
| Hard flags depend only on validation-tick inputs (`stageDiscrepancy > 0.35`, `actualCFS < 1500 && actualStage > 2.45 && ice.plausible`) | Confirmed in production and in the ported gate. `isIcePlausible(waterTempC, now)` is also tick-level; `binReadFailed` is never true in the harness. All validations at one tick share hard status: confirmed. Soft status is NOT shared (outlier z is per validation) |
| Multi mask = primary mask AND view inputs, so identical under the primary view | Confirmed (harness:356-357, TICK_SCHEMA line 11) |
| Raw, flow_bin and travel do not depend on the bins | Consistent with the code: `flowBin = getFlowBin(rawFinalUnclipped)`; `travelGFtoLF` comes from `mult` and `porRiseRate` only. A3 is still needed |
| `lf_view` is the q used by the validation LF guard | Confirmed (`inp.lfq`) |
| `bandFor` lo/hi/fallback text | Confirmed (ci-table.js) |
| Clamp line and `const zScore = Math.abs(errorCFS - center) / sd;` (lifetime sigma) | Confirmed (model.js:775, 826) |
| `const threshold = Math.max(minAbsChange, currentCFS * minPctChange);` with 100 and 0.02 | Confirmed (model.js:485) |
| `isExistingPredictionReplaceable` | Confirmed (model.js:886-889) |
| Unique key comment `// Note: UPDATE to 'expired' hits the unique constraint, so we delete.` | Confirmed (scheduled-update.js:1054). The database constraint itself is not in the repo |
| Handler order: validate (step 4), predict (step 5), ping | Confirmed (lines 3021, 3049, 3180) |
| `DR_LATE_SKIP_MS = 20000` | Confirmed (line 2398) |
| `storeValidationPair` 30-min dedupe | Confirmed (line 456; line 395 is a different dedupe, in `storeGFHistory`) |
| sync-learning `.limit(50)` pending load and `.single()` | Confirmed (lines 370-372, 516) |
| `const pendingCount = ...` in the Learning tab | Confirmed (src/ui/learning-ui.js:28) |
| "13 to 19 h" validation lag | Wrong outside low flow (PA-1) |
| "Up to about 50 rows live" | Wrong: at most about 20 |
| "About 780 RL ticks" | 727 scored RL ticks (event file) |
| Stage-1 chains verified by the A7 third implementation | Wrong for MultiChain (PA-5) |
| About 12 sequential DB calls per validation | Not counted in detail |

## My estimate and worth

- **Chance of a pass:**
  - As written: about 3 to 6 percent. Part of that is the A4 STOP (fixable), the rest is the gate's false-fail rate.
  - After PA-2 to PA-4: about 8 to 12 percent.
- **The drafter's 10 to 15 percent:** reasonable for "multi really helps", too high for "this gate passes".
- **Cost:** the drafter's 21 to 34 agent-hours for stage 1 is plausible. With PA-5 it is 25 to 40. Dropping stage 2 saves 30 to 50.
- **Is it worth running:**
  - Only if the owner commits before freezing that a clean pass would actually trigger the 40 to 80 h, high-risk build.
  - If the owner would not build on a modest pass (likely, given the cap decides about half of RL hours), close A6 now. Write a one-page rationale: June, the A7 cap finding, PA-1's small responsiveness margin. That costs about 1 h and loses little.
  - If it does run: stage 1 only, with the fixes above.

## What I could not check

- I opened none of the forbidden files.
- A grep of `rising_limb_audit.md` for "multi" showed me line 148 ("S2, S3 and multi runs agree to the same order") and lines 304 to 308 (the within-multi arm-versus-base table already summarised in the verdict). Neither holds a multi-versus-single number.
- Whether the A7 audit sections the drafter read hold any base-multi figure. A results-blind person should grep them.
- The database unique constraint (only the code comment and owner memory), the Netlify time limit, Supabase latency, and the cadence on which the LF-residual advisory was backtested.
- Joint false-fail numbers are rough judgement, not simulation. A cheap simulation under the null on the single file is not possible without reading forbidden files.

Key files:
- /Users/sebjilke/Desktop/PotomacPulse/analysis/multipending-responsiveness-plan-2026-11-11.md
- /Users/sebjilke/Desktop/PotomacPulse/analysis/rising-limb-travel-backtest/rising_limb_harness.mjs
- /Users/sebjilke/Desktop/PotomacPulse/analysis/rising-limb-travel-backtest/rising_limb_run_log.json
- /Users/sebjilke/Desktop/PotomacPulse/netlify/functions/shared/model.js
- /Users/sebjilke/Desktop/PotomacPulse/netlify/functions/scheduled-update.js
- /Users/sebjilke/Desktop/PotomacPulse/scripts/recover-bins.js

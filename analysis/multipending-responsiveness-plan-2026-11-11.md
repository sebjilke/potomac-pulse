# A6 multi-pending validation: pre-registered analysis plan (v2, 2026-11-11)

Status: v2. It includes the independent plan audit (verdict approve_with_changes, PA-1 to PA-17) and the orchestrator's rulings on it. FROZEN: the owner approved the gate in section 7 on 2026-11-12 (about 00:02 UTC; "approve", after the orchestrator recommended approving the rules as written), and this commit records that approval. Nothing has been computed. No tick file has been opened. After the freeze, changes may only be recorded in section 17 (Deviations).
Owner decisions: "run A6" (2026-11-11), stage 1 only; the gate of section 7 approved as written (2026-11-12 UTC). There is no stage 2. Whether to build after a PASS is decided by the owner only after a written risk review.
Labels: CODE = read in the repo, with the anchor text given. BRIEF = taken from the decision brief, the June findings, the A7 documents, the plan audit or an orchestrator check, and not re-derived here. INFERRED = reasoning, not tested.
Terms used throughout:
- "single": the production one-slot policy.
- "multi": a pending prediction stored at every tick.
- "learned validation": a validated pending prediction that was not hard-flagged and so updated a bin.

## 0. Bottom line first

- **Decision taken:** the owner has decided to run stage 1. This plan specifies only stage 1.
- **Cost:** about 25 to 40 agent-hours. No model run is needed, because the tick files already exist.
- **What it settles:** two questions nobody has measured. Does faster learning change the DISPLAYED value early in a large rise? What does it cost ordinary hours, recessions and the band?
- **What a FAIL means:** "not demonstrated on this record". It closes multi-pending at alpha 0.3, as replayed here, on this record (section 8). The verdict says which group of rows failed. A failed guard row is evidence of harm. A failed deciding row with all guards passing means "no clear gain".
- **What a PASS means:** an honest, pre-specified measurement that did not contradict the idea. It does not by itself trigger a build (section 13).

**Prior, both directions (PA-12).**
- For multi (BRIEF, June study on v36.x): multi reduced storm under-prediction (bias -297 to -251 cfs; 50k-plus rising cell -424 to -279 cfs). It significantly helped the 25k to 50k and 50k-plus rising cells.
- Against multi (BRIEF): in June the pooled gain was not significant, all 7 everyday cells were worse (none significantly), and the out-of-time gain was half the in-sample gain. A7 found that the 120 percent cap binds on about 52.5 percent of base rising-limb ticks under single. Where it does not bind, the display already under-reads (mean displayed error -1,477 cfs on 342 ticks uncapped in base and arm A).
- A v39 mechanism that would make multi worse (INFERRED, untested): on rising limbs the bins learn a positive raw residual. Faster learning subtracts more, which lowers the uncapped value. Where the cap does not bind, that pushes the display further low, the unsafe direction. This conflicts with June's direction on v36. Neither is established for v39.
- My estimate that the revised gate passes: about 8 to 15 percent.

**Mechanism and timing (PA-1, rewritten).**
- A prediction is checked one Great Falls to Little Falls travel time after it is made. CODE: `const travelGFtoLF = getGFtoLFTravelTime(mult, porRiseRate);` and `validationDue: new Date(Date.now() + travelGFtoLF * 60 * 60 * 1000).toISOString(),` in `scheduled-update.js`. `getGFtoLFTravelTime` is `TRAVEL_GF_LF_BASELINE * mult` with `const TRAVEL_GF_LF_BASELINE = 6.5;`, cut by min(0.30, 0.02 x rate) when Point of Rocks is rising (`shared/model.js`).
- The wait, from `getGFtoLFTravelTime(getFlowMultiplier(q), ...)` (CODE; I recomputed every value):

| Flow q (cfs) | Calm (h) | Point of Rocks rising fast, 30 percent cut (h) |
|---|---|---|
| 1,000 | 17.0 | 11.9 |
| 1,500 | 13.3 | 9.3 |
| 2,000 | 11.2 | 7.9 |
| 2,800 | 9.2 | 6.4 |
| 4,000 | 7.4 | 5.2 |
| 5,000 | 6.5 | 4.5 |
| 7,000 | 5.3 | 3.7 |
| 10,000 | 4.3 | 3.0 |
| 20,000 | 2.8 | 2.0 |
| 40,000 | 1.9 | 1.3 |

- Little Falls flow in the record (BRIEF, orchestrator check of the raw hourly file): median 6,680 cfs, 10th percentile 1,980, 25th percentile 3,120.
- The wait is set by the flow the model uses at prediction time. That is the Little Falls reading, `let mult = getFlowMultiplier(lf.q);`. When the Point of Rocks loop does not converge on its first pass, it is an older Point of Rocks reading, `mult = historicMult;` (CODE). Both lag on a rise. Early in a rise, then, the wait depends on the river level BEFORE the event. October 2026 began from a very low river. It is the worst case for the single slot.
- How often each policy learns (CODE, `rising_limb_run_log.json`, base counters, whole grid): single validated 23,609 (hard 34, soft 2,313); multi validated 127,714 (hard 316, soft 17,119). There are 127,874 ticks with a prediction (multi `stored`). So single learns about once every 5.4 h on average, and multi has about 5.4 times as many validations.
- Consequence (INFERRED): once the river rises, both policies learn within a few hours. Single re-stores at the tick it validates, so the head start multi can gain is at most about one travel time. That is roughly 2 to 3 h at 20,000 cfs and 11 to 17 h only when a rise starts from a very low river. The expected effect is small for most of the 21 events and largest for October-like rises. That makes R2's 5 percent harder to reach, not easier.

**Gate quality (PA-3).** The audit put the false-fail rate of the v1 gate at about 85 to 90 percent. That is the chance of a FAIL even if multi truly helps rises and does no harm. My estimate for this v2 gate is in section 7.

### Gate in one page (for the owner)

Multi is accepted only if ALL 14 rules hold. Three rules decide whether it helps. Two check that the help is not a fluke. Nine guard against harm.

Rules that decide (multi must help):
1. **R2.** Early in big rises, the displayed number is on average at least 5 percent closer to the truth, and still above zero after allowing for luck in which floods occurred. *Protects against shipping for a gain that is not there.*
2. **R3.** It helps in at least 14 of the 21 floods. *Protects against one big flood carrying the result.*
3. **B1.** It still helps when October 2026 (the flood that prompted the study) is left out. *Protects against a result built on the motivating event.*

Rules that check robustness:
4. **B2.** Leaving out any one flood never turns the gain to zero or a loss. *Same protection as R3, one flood at a time.*
5. **B3.** It helps on the 4 most recent floods taken together. *Protects against a gain that only existed in older years.*

Rules that guard against harm:
6. **N1.** Ordinary hours are at most 1 percent worse, and, allowing for luck, at most 2 percent. *Protects the 90 percent of hours that are not floods.*
7. **N2.** No group of ordinary hours (by flow level and direction) is clearly more than 3 percent worse, and no large group is more than 5 percent worse. *Protects specific river levels a pooled number can hide.*
8. **N3.** Ordinary hours in the most recent fifth of the record are at most 2 percent worse. *Protects against harm that grew in recent years.*
9. **D1.** On falling rivers, the size of the average bias grows by at most 0.5 points (at most 1 point allowing for luck). *Protects recessions, October's worst problem.*
10. **C1.** On ordinary hours the 90 percent band still covers the truth about 90 percent of the time (within 4 points, or no further off than single already is). *Protects the band.*
11. **C2.** During rises, band coverage drops by at most 2 points. *Same, in floods.*
12. **C3.** On falling rivers, band coverage drops by at most 2 points. *Same, in recessions.*
13. **S1.** During rises, the share of hours where the number is 15 percent or more too low rises by at most 1 point (at most 3 allowing for luck). *Protects against the unsafe direction: telling paddlers the river is lower than it is.*
14. **S2.** The same on falling rivers.

Before the gate is read, a mechanical check (P-MECH) confirms that multi really did learn earlier and more often. If it did not, the harness is investigated and there is no verdict.
Any rule within 1 point of its threshold is flagged as a narrow pass. A narrow pass is reported as such, and building is decided only after a written risk review.

## 1. Question and what is held fixed

Question: compare multi with single for the unchanged production model. Does multi make the displayed estimate better early in large rises, without making ordinary hours, recessions or the band worse?

Held fixed:
- The model is the A7 `base` arm. CODE: `git diff 17c6060 -- netlify/functions/shared/model.js netlify/functions/scheduled-update.js netlify/functions/shared/ci-table.js` is empty, so the base arm is the current production server code.
- Truth is Little Falls as reported, which includes Difficult Run. A5 is open.
- Everything else is fixed too: the 18 bins, alpha 0.3, the 120 percent cap, the outlier rules, the lag view, the A7 truth rule (tau_ref), the frozen event list, and burn-in to 2012-12-01.
- Only the learning policy differs.

Why the design is not confounded: both tick files score EVERY tick under both policies, on the same raw value and the same truth. Only the bins differ. This is the June "common evaluation stream, two learners" design (BRIEF). It is not the rejected design that compares each policy's own validation set.

## 2. What has already been seen (declared before any computation)

1. **June study (2026-06-19, BRIEF).**
   - Design: multi against single, corrected MAE, 126,916 hours, 2011-12 to 2026-06, model v36.x. No lag view, no displayed-value scoring, no responsiveness measure.
   - Result: pooled 326.9 to 305.1 cfs, CI [-6.6, 26.8], not significant.
   - The 25k to 50k and 50k-plus rising cells were significantly better. Storm bias was -297 under single and -251 under multi.
   - All 7 everyday cells were worse, none significantly.
   - The out-of-time gain was half the in-sample gain.
   - About 95 percent of this record is the same data (INFERRED from the date spans).
2. **The v38 gate (July 2026) ran in single and multi modes.** The files `v38_headline_python_{single,multi}.csv`, `v38_headline_R_{single,multi}.csv`, `v38_summary_{single,multi}.json` and `v38_residuals_{single,multi}.csv` exist. Nobody working on A6 has opened them. A7 quotes only arm-against-baseline numbers from them ("normal-hours degradation 1.66 percent multi, 11.4 percent single").
3. **The v36.1 CI derivation compared per-cell residual tails under both modes.** `EMPIRICAL_CI_90` comes from multi residuals, and the high-flow cells use the wider of the two (CLAUDE.md). The residual files have not been opened.
4. **A7 baseline single-slot numbers are public** (BRIEF, verdict and audit section 5):
   - On RL ticks the mean signed corrected (uncapped) error is +2,461 cfs.
   - The cap binds on 52.5 percent of base RL ticks.
   - On 342 RL ticks where neither base nor arm A was capped, the mean displayed error is -1,477 cfs.
5. **A7 report-only multi table** (BRIEF, verdict summary): within the multi replay, arm A met all 17 criteria, with G7f at +2.9 percent. In the single replay A failed G7f at -5.49 percent. This compares arms within each mode, never multi against single. It is weak information on how multi interacts with the cap.
6. **A7's committed `metrics_python/`, `metrics_R/` and `audit_work/` hold baseline error values per replay.** The A7 analysts, the A7 auditor and the A7 third implementer have seen files in them or the tick files. None of them may work on A6.
7. **October audit (BRIEF):** 66 rising predictions, 7 validations, learning about 23 h late. Hourly scoring would have latched the residual banner about 2.5 h sooner. One event, a replay look.
8. **Thresholds.** The brief's six-part gate was written by someone who knew the June result. v1 and v2 adaptations were written by people who knew June and the A7 verdict. The brief's criterion 4 ("no cell worse by more than 2 percent with CI excluding 0") would have let June's everyday pattern through. N2 adds point caps against this.
9. **Run-log validation counters (new, PA-1).** Base validation counts per mode were public in `rising_limb_run_log.json`: single validated 23,609, hard 34, soft 2,313; multi validated 127,714, hard 316, soft 17,119, stale 48, stored 127,874. These are counts of learning events, not errors. While writing v2 the reviser also saw the arm A, B and C counters and the S2 and S3 counters (counts only), the per-event RL and REC tick counts in the frozen event file, and the source of `model_check/rising_limb_model_check_python.py`. No error value was seen.

**What this does to a PASS:** no gate on this record can be confirmatory. The hypothesis was tested in aggregate on the same years. The thresholds were set knowing related results, and some baseline quantities are public. A PASS moves belief modestly.

**Not to be tested on this record, now or later:**
- Multi combined with A7's arm A, B or C. The within-multi result for A is known.
- Any alpha other than 0.3 (the alpha ban stays, PA-8).
- Multi with a Difficult Run truth.
- Any choice among the A7 S2, S3 or multi runs.
- "Rise-only extra slots". This is recorded only as an untested hypothesis, for new data only (rises after 2026-11-09). Reason (PA-7): its trigger would select exactly the pattern the variant removes mechanically (rise rows pass, calm rows fail) on the same 21 events, so a pass would be close to implied by the trigger. The v1 constants were also mis-derived. Above about 10,000 cfs travel is 3 h or less, so the variant equals single where the large rises are, and its 4-row cap would almost never bind. Any future version must be re-derived from the travel table in section 0.
- Stage-1 analysts read only `arm == base` rows.

## 3. Data, comparability, assertions and precondition

Inputs (CODE, sha256 from `GATE_RUN_MANIFEST.txt` and A7 D-2):
- `rising_limb_ticks.csv` (single), sha256 8d841145905de1f6b6d217835c65229862ec6e115f33823c9472ffcfbfca0a6f.
- `rising_limb_ticks_multi.csv` (multi), sha256 c99c4b56e3ae3edc47cda561a7322174d6797709e509ea63f8e0106e17064778.
- The frozen event file `rising_limb_events_python_v39.csv`, sha256 978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44.
- The A7 all-events bootstrap index file `rising_limb_bootstrap_indices.csv` (10,000 x 21), sha256 7eff92a751fd9cc0c6f8e0220998e98788cc2f293b5437088bf9376e1dd96519. The non-October file is not used (B1 is point-only).
- The new month-block files `a6_month_block_indices.csv` and `a6_month_list.csv` (section 6). Their sha256 values are recorded in section 17 before the analysts start.
- `netlify/functions/shared/ci-table.js` (`bandFor`).

**Reading rule.** Every tick-file column is read as text (Python `dtype=str, keep_default_na=False`; R `col_types = cols(.default = col_character())`). Rows are filtered to `arm == 'base'` while reading, in chunks: in Python, `pd.read_csv(..., chunksize=...)` keeping `arm == 'base'`; in R, `readr::read_csv_chunked` with a callback that keeps `arm == "base"`. Values of other arms are never kept. Equality assertions compare the text. Numbers are parsed from text with round-trip precision: Python `float()` on the string, or pandas `float_precision='round_trip'`; R `as.numeric()` on the character column.

**Are the files comparable? (CODE: harness and schema)**
- Both came from the single A7 gate run at commit 17c6060.
- Both use the primary lag view (`await pass('multi', H.PRIMARY, true, false);` in `run_gate.mjs`).
- Truth, tau_ref and window labels always use the primary view (A7 D-5 H12).
- The multi mask is "primary mask AND the view's PoR and LF exist". Under the primary view the second part repeats the first.
- Raw does not depend on the bins (`flowBin = getFlowBin(rawFinalUnclipped)`; `travelGFtoLF` depends only on `mult` and `porRiseRate`). This is still asserted (A3).
- Columns that may legitimately differ: `corr`, `unc`, `disp`, `ceiling_applied`, `slot`, `validated`, `hard_flag`, `soft_flag`.

**Little Falls validity at tick v (PA-10), exactly as code.** The guard in `validatePendingPredictions` and in both harness chains is `!lf?.q || lf.q < 500 || lf.q > 500000`. `lf_view` is that `lf.q` (`inp.lfq`, BRIEF audit check). In the analyses, LF is invalid at v if `lf_view` is blank, or equals 0, or is below 500, or is above 500,000. Otherwise it is valid.

**Due time, exactly as code.** For a prediction made at tick s (epoch ms s_ms, an integer), due_ms(s) = trunc(s_ms + travel x 60 x 60 x 1000), with travel = `travel_gf_lf(s)` parsed as a double. The multiplication is evaluated left to right in double precision, (((travel x 60) x 60) x 1000), then added to s_ms, then truncated toward zero. This is what `new Date(Date.now() + travelGFtoLF * 60 * 60 * 1000)` does. "v is due" means v_ms >= due_ms(s). "Within the window" means v_ms - due_ms(s) <= 9,000,000 (2.5 h, `VALIDATION_MAX_DELAY_MS`). All comparisons are in integer ms.

**Assertions, in this order, before any metric.** Any failure is a STOP (section 8), except A3, which can be VOID. No metric is reported after a failure.
- **A0.** All sha256 values match: both tick files, the event file, the all-events index file, the month-block index file and the month list.
- **A1.** Both files have 523,948 data rows and the same 50-column header. Rows come in tick order, four per tick, with arms in the order base, A, B, C (checked on the `arm` column only). There are 130,987 base rows, one per tick, and 122,208 of them have `in_scoring == 1`.
- **A2.** On base rows, these tick-level columns are equal as text in both files at every tick: `tick_utc, in_scoring, mask, mask_why, tau_ref, tau_converged, truth, truth_tick_utc, rl_event, rlx_event, rec_event, ew_any, normal, lf_view, por_view, lf_carry_h, por_carry_h`. In the multi file, `mask_why` is never `view_input_missing`.
- **A3.** On base rows, these model columns are equal as text: `has_pred, raw, raw_unc, flow_bin, flow_state, rst, rate, stop, nonconverged, lookup_fail, it, travel_por_gf, travel_gf_lf, b_active, delta_on, pct, base_rst, base_stop, base_flow_bin, base_flow_state, truth_basehz, truth_basehz_tick, truth_own, truth_own_tick`. A failure means either a bug or that bins feed raw. The second makes the design invalid (VOID).
- **A4 (PA-2).** At every tick before the first `validated == 1` tick in either file, every column except `slot` is equal. In the multi file, `slot == 'stored'` on every row with `has_pred == 1`, and `''` or `no_prediction` otherwise.
- **A5. D-8 override.** For tick 2026-11-09T12:00Z:
  - Assert that it has `mask == 1`, `normal == 1` and no window label in both files as written.
  - Set its mask to 0 in both.
  - Assert that no tick with an RL, RLX or REC label has `truth_tick_utc` after 2026-11-09T23:00Z.
  - Report N1 and N2 with the file mask as written, as `N1_edge` and `N2_edge` (report-only).
  - Truth is NOT rebuilt (limit, section 12). A2 proves that truth is the same in both files.
- **A6. Single-chain reconstruction, consistency and completeness (PA-10).** Let S be the set of single base ticks with `slot == 'stored'` (stores after a replacement are also written `stored`, CODE `ArmChain.store`).
  - Consistency: for each tick v with `validated == 1`, the validated pending is the one stored at the latest s in S with s < v. Assert v_ms >= due_ms(s) and v_ms - due_ms(s) <= 9,000,000.
  - Completeness: for each s in S, let v* be the first tick after s that is due for s and has a valid LF. If v* exists and v*_ms - due_ms(s) <= 9,000,000, assert `validated == 1` at v* and that s is the pending matched to v* above.
  - Why this is exact (CODE, `ArmChain.validate` and `store`): within a tick the order is validate, predict, store. The slot is not overwritten while `isExistingPredictionReplaceable` is false. The 48 h stale rule cannot bind before a validation, because travel is at most 17 h.
- **A7. Multi-chain reconstruction.** A pending exists at every tick s with `has_pred == 1`. It is validated at the first tick v that is due for s and has a valid LF, if v_ms - due_ms(s) <= 9,000,000. Otherwise it is dropped at that tick. Assert that the set of ticks with at least one reconstructed validation equals the set with `validated == 1` in the multi file, exactly. Write n_val(v), the reconstructed number of validations at each tick.
  - Why this is exact (CODE): `MultiChain.validate` returns early when LF is invalid. It validates every due row in creation order, drops missed-window rows, and applies the 48 h stale rule, which cannot bind before a validation. Hard flags depend only on validation-tick inputs (`if (stageDiscrepancy > 0.35) {`, `if (actualCFS < 1500 && actualStage > 2.45 && ice.plausible) {`). So all validations at one tick share hard status, and the OR in `out.hard = out.hard || res.isHardFlagged` loses nothing. Soft status is per validation (`const isSoftFlagged = !isHardFlagged && softScore >= 2;`), so `soft_flag` is an OR and per-validation soft counts cannot be read from the file.
- **A8. Invariant.** Every single validation (s, v) from A6 is also a multi validation (s, v) from A7, with equal `hard_flag` at v in both files. Corollary: D_e(multi) <= D_e(single) for every event. Assert that no event has a finite D_e(single) and an infinite D_e(multi).
- **A9 (PA-6).** On base rows with `ceiling_applied == 1` in both files, `disp` is equal. Reason (CODE): `const maxEstimate = lfCFS * CEILING_RATIO;`, and when the cap binds, `disp = Math.round(lf_view x 1.2)`, where `lf_view` is equal by A2.
- **Band check.** On every scored tick `bandFor(disp, flow_bin, flow_state)` returns a band. A null band is a STOP.

**Precondition P-MECH (PA-4; not a gate row).** It is computed after A0 to A9 and before any metric. It uses no truth.
- Condition: the median over the 21 GATE events of dD_e is > 0 h, AND sum K_e(multi) / sum K_e(single) > 1.5. If sum K_e(single) = 0 and sum K_e(multi) > 0, the ratio is +infinity.
- If P-MECH fails, the outcome is STOP-MECH (section 8). The ratio and every dD_e are reported in all cases.

## 4. Definitions

**Events and windows (frozen A7 rule):**
- GATE events: the 21 kept GATE events (20 non-October plus October 2026, `oct == 1`, event id 53). STRATUM events: 15, report-only.
- RL = [t0 - 12 h, min(t0 + 24 h, tp)]. RLX = [t0 - 12 h, tp]. REC as in A7 section 3 (M1). Membership comes only from `rl_event`, `rlx_event` and `rec_event`, filtered to the class via the event file.
- F24 = [t0, min(t0 + 24 h, tp)], report-only.
- H = holdout events 47, 48, 49 and 51.
- "Scored" means `in_scoring == 1`, mask == 1 (after A5) and `has_pred == 1`. Every metric uses scored ticks only. In the frozen event file the 21 GATE events have 727 scored RL ticks in total (CODE, column `x3_scored_rl_ticks`). Event 49 has an empty REC window (`rec_n_stamps == 0`).

**Errors (cfs, estimate minus truth):**
- e_disp = `disp - truth` (primary).
- e_unc = `unc - truth` (report-only).
- e_raw is identical in both files and is not used.

**Responsiveness.** For event e, r_e = `rl_start` (t0 - 12 h). tend_e = `event_tend`.
- An event-created learned validation is a reconstructed validation (s, v) (A6 for single, A7 for multi) with s >= r_e, v <= tend_e and `hard_flag(v) == 0`.
- D_e(mode) = hours from r_e to the first such v. If there is none, D_e = +infinity.
- dD_e = D_e(single) - D_e(multi). Infinity minus a finite value is +infinity. Infinity minus infinity is 0. By A8, dD_e >= 0.
- The median of the 21 values of dD_e, in the extended reals, is the 11th order statistic.
- K_e(mode) = the number of event-created learned validations with v in RL_e. For multi it counts validations, not ticks, using n_val from A7.
- Report-only: D_e measured from t0. For October, also measured from its LF reference tick: the first tick after the last tick before t0 whose `lf_view` is below 3,000 cfs.

**Bin-matched learning (report-only):** for each scored RL tick, the number of event-created learned validations so far whose prediction's (`flow_bin`, `flow_state`) at s equals the tick's own.

**Band:** `bandFor(disp, flow_bin, flow_state)` exactly as in `shared/ci-table.js`. CODE: `lo: Math.max(0, Math.round(estimateCFS - stateCI.q95)),`, `hi: Math.round(estimateCFS - stateCI.q05),`, fallback `const stateCI = s || ciData.all;`. `disp` and the table entries are integers, so no rounding question arises. Covered means lo <= truth <= hi. Coverage = covered ticks / ticks, written as a fraction.

**Under-read:** a tick with 100 x (disp - truth) / truth <= -15, computed in double in that order. This is the LF-residual advisory's latch level (CODE `onPct: -15,` in `LF_RESIDUAL`).

## 5. Metrics

All metrics are hour-pooled within the stated subset, on scored ticks.
- MAE_W(mode) = mean |e_disp| over window W. Gain_W = 1 - MAE_W(multi) / MAE_W(single). On the same ticks this equals 1 - sum|e_disp|(multi) / sum|e_disp|(single).
- Event improved: the sum of |e_disp| over its scored RL ticks is strictly lower under multi. Ties count as not improved. Breadth passes if improved x 100 >= 65 x 21, which means at least 14 events.
- Recession bias(mode) = mean of 100 x e_disp / truth over REC ticks, in percentage points (pp). D_bias = |bias(multi)| - |bias(single)|.
- Normal-hours relative change = sum|e_disp|(multi) / sum|e_disp|(single) - 1 over scored ticks with `normal == 1`. It is computed pooled, and per cell (`base_flow_bin` x `base_flow_state`) for cells with at least 200 scored normal ticks. The cell set is fixed from the full sample after A5.
- T80 (PA-9): G = number of grid ticks with `in_scoring == 1` = 122,208 (from the grid definition alone: hourly ticks 2012-12-01T00:00Z to 2026-11-09T23:00Z inclusive; asserted in A1). T80 = 2012-12-01T00:00Z + floor(8 x G / 10) h = + 97,766 h = 2024-01-26T14:00:00.000Z. N3 uses scored normal ticks with `tick_utc` >= T80.
- Coverage on normal, RL and REC ticks, per mode.
- Under-read share on RL and on REC, per mode.

**Dilution next to R2 (PA-6).** On ticks capped in both files the difference is exactly 0 (A9). Under single about 52.5 percent of RL ticks are capped (BRIEF), so the share capped in both is at most that. Gain_RL is the gain on the other ticks, weighted by their share of single's absolute error. If about half of single's RL absolute error sits on ticks capped in both, R2's 5 percent pooled needs about 10 percent on the rest (INFERRED).

**Report-only:**
- The same RL metrics on e_unc.
- F24 and RLX.
- STRATUM events.
- Per GATE event, MAE per mode and the multi-minus-single change, with event 53 marked.
- The RL split at each event's first multi event-created learned validation v1_e: RL ticks with `tick_utc` < v1_e (before: carried-state effect only) and >= v1_e (after: responsiveness).
- Cap-bind rate (`ceiling_applied`) by mode on RL, REC and normal ticks.
- Four-cell cap split on RL (PA-6): capped in both, capped in single only, capped in multi only, capped in neither. For each: tick count, MAE per mode and mean signed e_disp per mode. The mean signed e_disp on ticks capped in neither is the direct analogue of A7's -1,477 cfs finding.
- Per-cell normal-hours coverage.
- Signed mean e_disp per mode on RL, REC and normal ticks.
- Mean e_disp of under-read ticks per mode (RL, REC), and the worst 100 x e_disp / truth per event per mode.
- Ticks with `soft_flag == 1`, `validated == 1` and `hard_flag == 1` by mode, over ticks with `in_scoring == 1` (PA-15). Per-validation soft totals exist only in the run log and the third implementation.
- Distribution of n_val per tick in multi over ticks with `in_scoring == 1`.
- K_e, D_e and dD_e per event; bin-matched learning.

## 6. Uncertainty

- **Events.** Use the A7 all-events index file unchanged. Events are sorted by `event_t0`, and indices are 0-based positions (R adds 1). There are 10,000 resamples. The interval is the 2.5th and 97.5th percentile (numpy default linear, R `quantile` type 7). For resample b, E_b is the multiset of 21 drawn events. Named statistics:
  - R2: Gain_b = 1 - sum over E_b of S_e(multi) / sum over E_b of S_e(single), where S_e = sum |e_disp| over e's scored RL ticks.
  - D1: bias_b(mode) = (sum over E_b of the sum over REC ticks of 100 x e_disp / truth) / (sum over E_b of the REC tick count). D_b = |bias_b(multi)| - |bias_b(single)|. Event 49 contributes 0 ticks. A resample with 0 REC ticks is dropped, and the drops are counted.
  - S1: diff_b = (U_b(multi) - U_b(single)) / n_b, where U_b is the number of under-read ticks and n_b the number of RL ticks over E_b, counting multiplicity. n_b is the same for both modes.
  - S2: as S1 on REC ticks, with the same drop rule as D1.
- **Normal hours: a new shared calendar-month block file.** It is produced before any metric by `analysis/multipending-responsiveness/make_month_block_indices.py`, written and run by a results-blind agent.
  - The script reads only the columns `tick_utc, arm, in_scoring, mask, normal, has_pred` of the base rows of the single file. It applies the A5 override, setting the mask of 2026-11-09T12:00Z to 0.
  - Months (UTC, from `tick_utc`) from 2012-12 to 2026-11 that contain at least one scored normal tick are sorted ascending. Call their number M (at most 168). The list is written to `a6_month_list.csv` (no header; one row per month; columns: 0-based index, `YYYY-MM`).
  - Indices: `numpy.random.default_rng(20261115).integers(0, M, size=(10000, M))`, written with `np.savetxt(fmt="%d", delimiter=",")`, no header, to `a6_month_block_indices.csv`. Both sha256 values go into section 17 before the analysts start.
  - Statistic per resample: the multiset of drawn months. rel_b = sum|e_disp|(multi) / sum|e_disp|(single) - 1 over all scored normal ticks of the drawn months, counting multiplicity. Per cell, the same restricted to that cell. If a resample has zero ticks in a cell, or a zero single sum, that resample is dropped for that cell and counted.
  - N1_edge and N2_edge use the same index file.
- **Seeds.** 20261115 for the month blocks and 20261116 for the auditor's spot check. A7's seed reaches this study only through the A7 index file. No other seed is used.

## 7. Gate (multi against single, base model, e_disp unless stated)

N = 21 GATE events. "Point" = the point estimate decides. "CI" = the 95 percent bootstrap bound decides. Every row must hold. Decisions use full double precision, nothing is rounded before comparison, and a value exactly at a strict threshold fails (for example Gain = 0 fails B1, B2 and B3, and a CI lower bound of exactly 0 fails R2). Rows marked "integer" are decided in integer arithmetic on counts (c = covered ticks, U = under-read ticks, n = ticks; n is equal across modes).

**Deciding rows**

| Id | Formula | Subset | Threshold | Reason |
|---|---|---|---|---|
| R2 | Gain_RL | RL, 21 events | point >= 0.05 AND event CI lower bound > 0 | Brief criterion 2, on what the visitor sees. See the dilution note in section 5. |
| R3 | breadth | RL, 21 events | improved x 100 >= 65 x 21, so at least 14 of 21 (integer) | Brief criterion 3: no single flood carries it. |
| B1 | Gain_RL | RL, 20 non-October events | point > 0 | Brief criterion 5: the sign survives without the motivating event. |

**Robustness rows**

| Id | Formula | Subset | Threshold | Reason |
|---|---|---|---|---|
| B2 | Gain_RL with each event dropped in turn | RL, 21 drops of 20 events | every drop point > 0 | Leave-one-out on the sign. |
| B3 | Gain_RL | RL, holdout H (47, 48, 49, 51) | point > 0 | Brief criterion 5: the most recent events. |

**Guard rows (non-inferiority with a margin)**

| Id | Formula | Subset | Threshold | Reason |
|---|---|---|---|---|
| N1 | pooled normal relative change | normal | point <= +0.01 AND month-block CI upper bound <= +0.02 | Brief criterion 4, pooled. |
| N2 | per-cell relative change | normal cells with >= 200 ticks | a cell fails if (point > +0.03 AND month-block CI lower bound > 0) OR (point > +0.05 AND the cell has >= 2,000 scored normal ticks); the row fails if any cell fails | Catches harm a pooled number hides, without a coin flip on small cells. |
| N3 | pooled normal relative change | normal, `tick_utc` >= T80 | point <= +0.02 | June's gain halved out of time. |
| D1 | D_bias (pp) | REC, 21 events | point <= +0.5 pp AND event CI upper bound <= +1.0 pp | Recession under-read was October's worst problem. |
| C1 | normal coverage | normal | abs(100 c_m - 90 n) <= max(4 n, abs(100 c_s - 90 n)) (integer) | Brief criterion 6; no fail for a miss single already has. |
| C2 | RL coverage | RL, 21 events | 100 c_m >= 100 c_s - 2 n (integer) | Band failures in events must not get worse. |
| C3 | REC coverage | REC, 21 events | 100 c_m >= 100 c_s - 2 n (integer) | Same for recessions. |
| S1 | under-read share difference | RL, 21 events | point: 100 (U_m - U_s) <= n (integer, = +1.0 pp) AND event CI upper bound of diff_b <= +0.030 | The unsafe direction. 1 pp is about 7 of 727 RL ticks. |
| S2 | under-read share difference | REC, 21 events | same as S1 on REC | Same on recessions. |

**Owner-set criteria:** all thresholds above. The owner approved them as written on 2026-11-12 UTC; they are frozen. The ones most open to judgement are R2's 5 percent, the N1 and N2 margins, D1's margins, the S1 and S2 definition (-15 percent) and margins, and the 2 pp in C2 and C3.

**Narrow pass.** For each condition of each passing row, the auditor computes the margin to the threshold in the row's own unit: 0.01 for fractions (1 percentage point), 1.0 pp for D1, 1 event for R3, and for N2 each cell's conditions. A margin below 1 unit marks the row "narrow". This does not change the outcome. It goes into the verdict and the risk review. D1 will almost always be marked narrow, because its whole margin is 0.5 pp.

**False-fail rate (judgement, not simulation; INFERRED).**
- Scenario as in the audit: multi truly improves pooled displayed RL error by about 10 percent, and does no real harm anywhere.
- v1 gate: about 85 to 90 percent false-fail (audit). The guards alone failed a harmless multi about 85 percent of the time, mainly through D1's zero-margin point (about 50 percent pass), S1 and S2 at 0.5 pp, and N2's point cap on small cells.
- v2 gate: about 65 to 80 percent false-fail overall. About 40 to 55 percent of that comes from the nine guard rows together. They are no longer coin flips (each passes about 88 to 95 percent of the time), and the comparisons are paired on identical ticks, so the noise is that of a difference. There are still nine of them. The rest comes from limited power in the deciding and robustness rows: R2 at a true 10 percent passes about 70 to 80 percent of the time, R3 about 55 to 65 percent, and B3 on 4 events about 75 percent.
- Consequence for reading the verdict: a PASS is hard to get even if multi works, so a FAIL on a deciding or robustness row alone is weak evidence that multi does not work. A FAIL on a guard row is direct evidence of harm on that measure.

## 8. Outcomes (exhaustive)

- **STOP (not a verdict).** Triggers: any failure of A0 to A2 or A4 to A9 or the band check; an A3 failure judged to be a bug; a failure of the multi third implementation (section 9); a Python/R disagreement beyond tolerance; any read of a forbidden file or of non-base values. Action: investigate blind. Rerun an analysis only to fix a proven implementation bug in that analysis, and log every run.
- **STOP-MECH (not a verdict).** Trigger: P-MECH fails. Action: investigate the harness's multi chain. No gate row is computed or read. The investigation can end in RERUN or VOID.
- **RERUN (not a verdict).** Trigger: a proven MultiChain bug, shown by the third implementation or the STOP-MECH investigation without any error value. Action: the bug is fixed in a committed harness. The multi pass alone is regenerated from 17c6060 plus the fix by someone blind to results. The single file is not regenerated. The new sha256 is logged in section 17. The third implementation must match the new file, and then the analysts restart from A0.
- **VOID.** Trigger: A3 fails for a reason that is not a bug (bins feed raw). Action: A6 cannot be answered from these files. The item closes with that statement.
- **PASS.** Trigger: all preconditions hold, the two analyses agree, the third implementation matches, and every row of section 7 holds. Action: nothing is built automatically. The verdict lists every margin and every narrow flag. The owner decides whether to build only after a written risk review (section 13). A build would follow the Code-Change Verification Protocol and be a MAJOR version.
- **FAIL.** Trigger: at least one row fails. The verdict names every failed row, grouped as deciding, robustness and guard. Action: this closes multi-pending at alpha 0.3, as replayed here, on this record (PA-8). It does not test a memory-matched alpha or per-hour weighting. The alpha ban on this record stays. There is no retuning and no rerun on this record. A new idea needs a new plan and new data.
- **FAIL-INSUFFICIENT.** Formal line only. It cannot occur: all 20 non-October GATE events have at least 14 scored RL ticks in the frozen event file (CODE), and the A5 tick has no window label.

## 9. Verification

**Blind Python and blind R metric analysts.**
- Fresh agents throughout: nobody who worked on A7's metrics, its audit or its third implementation, or on the June study. They are blind to each other and to all results.
- They read only: this plan, `TICK_SCHEMA.md`, the two tick files (base rows, read as in section 3), the event file, the all-events index file, the month-block index and month list, and `shared/ci-table.js`.
- They must not read: the A7 verdict and audit, any A7 metric or audit folder, `model_check/`, the June files, the v38 or CI residual files, the harness source, the run log, or another A6 subfolder.
- Order inside each analysis: checksums, then A0 to A9, the band check and P-MECH, then metrics.
- Each writes only inside its own subfolder (`metrics_python/`, `metrics_R/`), using the layout in section 10.
- Status rule: the analysts report to the orchestrator only their status, file checksums, assertion counts, P-MECH pass or fail, and any wording they found unclear. They report no metric value and no hint of the outcome.

**Tolerance between Python and R.** Counts, ids, hours (whole ticks) and pass flags must be exact. Fractions and pp must agree within 1e-6 absolute, and cfs within 0.01. The CIs use shared index files, so they are held to the same tolerance. Any divergence is a STOP. (A7 actually agreed to 5.5e-11.)

**Third implementation of the MULTI base chain (PA-5).** Run by a fresh agent on Opus or an equivalent tier, as a verifier, in `model_check_multi/`.
- Written in Python. It replays the multi base chain from empty bins over the full grid (130,987 ticks, 2011-12-01T05:00Z to 2026-11-09T23:00Z), from `hourly_backtest_data_v39.csv`, the production rules (`scheduled-update.js`, `shared/model.js`) and this plan.
- It may START from the source of `analysis/rising-limb-travel-backtest/model_check/rising_limb_model_check_python.py`, an independent Python port of the single chain that A7's audit confirmed reads no harness code (BRIEF). It may not read that folder's other files, the harness sources, the tests, `run_gate.mjs` or the snapshots.
- Chain rule, from production and section 3: a pending at every tick with a prediction. At each tick with a valid LF, rows older than 48 h are dropped first; due rows are then validated in creation order through the production learning gate; due rows outside the window are dropped. Then predict, then store. With an invalid LF nothing is validated or dropped.
- It reads, from the multi tick file only, base rows and only the columns `tick_utc, arm, has_pred, raw, corr, travel_por_gf, travel_gf_lf, slot, validated, hard_flag, soft_flag`. It reads no truth column and computes no error against truth.
- It compares on ALL base ticks: `corr` within 0.5 cfs, `raw` within 1 cfs, `travel_por_gf` and `travel_gf_lf` within 0.01 h, and `validated`, `hard_flag`, `soft_flag` and `slot` exactly. Blank must match blank. Python rounding follows JavaScript `Math.round` (`math.floor(x + 0.5)`).
- It writes its own per-tick counts `a6_multi_validation_counts.csv`, with columns `tick_utc, n_val, n_learned, n_hard, n_soft, n_dropped_missed, n_stale, n_pending_after`. It also writes whole-grid totals.
- It reports the comparison for the whole grid and separately for events 11, 30, 51 and 53 (ticks t0 - 71 h to tend + 24 h, as in A7 D-7 E5).
- Files: `a6_multi_model_check_python.py`, `a6_multi_model_check.csv` (one row per subset x field: n compared, n beyond tolerance, max absolute difference), `a6_multi_validation_counts.csv`, `NOTES.txt`.
- No seed is needed (no sampling).
- Any value beyond tolerance is a STOP. A proven harness bug leads to RERUN.
- It may run in parallel with the analysts, since it needs no outcome. It reports status and mismatch counts only.

**Independent auditor** (Opus, has run nothing, in `audit_work/`):
- Checks Python/R agreement row by row on the section 10 keys.
- Checks A0 to A9 and P-MECH in both analyses.
- Compares the analysts' per-tick reconstructed n_val (A7) with the third implementation's n_val, exactly.
- Compares the third implementation's whole-grid totals with the run-log counters: validated 127,714, hard 316, soft 17,119, stale 48, stored 127,874.
- Regenerates the month list and the index file from the script and seed and checks both sha256 values.
- Checks the gate arithmetic, computes the margins and narrow flags, and fills in the gate table.
- Spot check: 8 RL-tick inputs, drawn with `rng = numpy.random.default_rng(20261116)`. First `rng.choice(n53, 2, replace=False)` over event 53's scored RL ticks in tick order. Then `rng.choice(n_rest, 6, replace=False)` over the other 20 events' scored RL ticks in tick order. For each, compare the Point of Rocks and Little Falls stamp values behind `por_view` and `lf_view` (stamp = tick - lag - carry) with the median of live USGS IV 15-minute readings in [stamp, stamp + 1 h). Tolerance is 1 percent for approved data. Provisional data are flagged.
- The orchestrator writes the verdict from the audited table. The orchestrator stays blind until the auditor has compared the two analyses.

## 10. Output layout and required rows

Each analyst writes `a6_metrics_python.csv` or `a6_metrics_R.csv` with columns `run, criterion, mode, subset, stat, key, value`.
- `run`: `check` (assertions, P-MECH), `gate` (rows that decide), `report` (report-only), `edge` (A5 file-mask versions).
- `mode`: `single`, `multi`, `diff` (a multi-against-single statistic), `both` (counts, flags).
- `key`: an event id, a cell `<flow_bin>|<flow_state>`, a value label, or empty.
- `value` conventions: fractions as fractions, bias in pp, cfs in cfs, hours in hours, pass flags 1 or 0, full double precision (Python `repr`, R `format(x, digits = 17)`), +infinity written `Inf`, undefined written `NA`.
- Subset names: `RL21`, `RL20` (no event 53), `RLdrop` (key = dropped id), `RLH`, `RLev` (key = id), `REC21`, `NORM`, `NORM_T80`, `NORMcell` (key = cell). Report-only also: `RLX21`, `F24_21`, `RLstr15`, `RLbefore`, `RLafter`, `cap_both`, `cap_single_only`, `cap_multi_only`, `cap_neither`, `SCORING`.

Required rows (each line: criterion | mode | subset | stat | key):

run = check
- A0 to A9 and BAND, each: `both | all | n_checked | ""`, `both | all | n_fail | ""`, `both | all | pass | ""`.
- A6: `single | all | n_validations | ""`. A7: `multi | all | n_validations | ""`. A1: `both | all | n_in_scoring | ""`. N3: `both | NORM_T80 | t80_index | 2024-01-26T14:00:00.000Z` (value 97766).
- PMECH: `both | RL21 | median_dD_h | ""`; `single | RL21 | sum_K | ""`; `multi | RL21 | sum_K | ""`; `both | RL21 | K_ratio | ""`; `both | RL21 | pass | ""`.

run = gate
- R2: `single | RL21 | mae | ""`; `multi | RL21 | mae | ""`; `diff | RL21 | point | ""`; `diff | RL21 | ci_lo | ""`; `diff | RL21 | ci_hi | ""`; `both | RL21 | n_ticks | ""`; `both | RL21 | pass | ""`.
- R3: for each of the 21 ids: `single | RLev | sum_abs | id`, `multi | RLev | sum_abs | id`, `diff | RLev | improved | id`. Then `both | RL21 | n_improved | ""`, `both | RL21 | pass | ""`.
- B1: `single | RL20 | mae | ""`; `multi | RL20 | mae | ""`; `diff | RL20 | point | ""`; `both | RL20 | n_ticks | ""`; `both | RL20 | pass | ""`.
- B2: for each of the 21 ids, `diff | RLdrop | point | id`. Then `diff | RLdrop | min_point | ""`, `both | RLdrop | pass | ""`.
- B3: `single | RLH | mae | ""`; `multi | RLH | mae | ""`; `diff | RLH | point | ""`; `both | RLH | n_ticks | ""`; `both | RLH | pass | ""`.
- N1: `single | NORM | mae | ""`; `multi | NORM | mae | ""`; `diff | NORM | point | ""`; `diff | NORM | ci_lo | ""`; `diff | NORM | ci_hi | ""`; `both | NORM | n_ticks | ""`; `both | NORM | n_res_used | ""`; `both | NORM | pass | ""`.
- N2: for each cell with >= 200 ticks: `both | NORMcell | n_ticks | cell`, `single | NORMcell | mae | cell`, `multi | NORMcell | mae | cell`, `diff | NORMcell | point | cell`, `diff | NORMcell | ci_lo | cell`, `diff | NORMcell | ci_hi | cell`, `both | NORMcell | n_res_dropped | cell`, `both | NORMcell | cell_fail | cell`. Then `both | NORMcell | n_cells | ""`, `both | NORMcell | n_cells_failed | ""`, `both | NORMcell | pass | ""`.
- N3: `single | NORM_T80 | mae | ""`; `multi | NORM_T80 | mae | ""`; `diff | NORM_T80 | point | ""`; `both | NORM_T80 | n_ticks | ""`; `both | NORM_T80 | pass | ""`.
- D1: `single | REC21 | bias_pp | ""`; `multi | REC21 | bias_pp | ""`; `diff | REC21 | point | ""`; `diff | REC21 | ci_lo | ""`; `diff | REC21 | ci_hi | ""`; `both | REC21 | n_ticks | ""`; `both | REC21 | n_res_dropped | ""`; `both | REC21 | pass | ""`.
- C1 (NORM), C2 (RL21), C3 (REC21), each: `single | <subset> | cov | ""`; `multi | <subset> | cov | ""`; `both | <subset> | n_ticks | ""`; `both | <subset> | pass | ""`.
- S1 (RL21), S2 (REC21), each: `single | <subset> | share | ""`; `multi | <subset> | share | ""`; `diff | <subset> | point | ""`; `diff | <subset> | ci_lo | ""`; `diff | <subset> | ci_hi | ""`; `both | <subset> | n_res_dropped | ""`; `both | <subset> | pass | ""`.
- GATE: `both | all | n_rows_pass | ""`; `both | all | pass | ""`.

run = edge
- N1_edge and N2_edge: the same rows as N1 and N2, using the file mask as written.

run = report
- U_R2: as R2 on e_unc. U_D1: as D1 on e_unc (point only).
- RLX: `single|multi | RLX21 | mae | ""`, `diff | RLX21 | point | ""`. F24: the same with `F24_21`. STR: the same with `RLstr15`, plus `both | RLstr15 | n_improved | ""`.
- EV: for each of the 21 ids, `single|multi | RLev | mae | id`, `diff | RLev | point | id`, `both | RLev | n_ticks | id`.
- SPLIT: for each id and pooled (key ""), `single|multi | RLbefore | mae | key`, `single|multi | RLafter | mae | key`, `both | RLbefore|RLafter | n_ticks | key`.
- CAP: `single|multi | RL21|REC21|NORM | cap_rate | ""`.
- CAP4: for each of the four cap cells, `both | <cell> | n_ticks | ""`, `single|multi | <cell> | mae | ""`, `single|multi | <cell> | mean_signed | ""`.
- CELLCOV: for each N2 cell, `single|multi | NORMcell | cov | cell`.
- BIAS: `single|multi | RL21|REC21|NORM | mean_signed | ""`.
- UR: `single|multi | RL21|REC21 | mean_signed_under | ""`; for each id, `single|multi | RLev | worst_pct | id`.
- FLAGS: `single|multi | SCORING | n_validated_ticks | ""`, `n_hard_ticks`, `n_soft_ticks`.
- VPT: for k = 0 to the maximum, `multi | SCORING | n_ticks_with_nval | k`.
- RESP: for each id, `single|multi | RLev | D_h | id`, `diff | RLev | dD_h | id`, `single|multi | RLev | K | id`, `single|multi | RLev | D_t0_h | id`. October: `single|multi | RLev | D_lf3000_h | 53`.
- BINM: `single|multi | RL21 | mean_matched | ""`.

Each subfolder also has a `NOTES.txt` describing its files. There is no README.

## 11. Execution order and outputs (all in `analysis/multipending-responsiveness/`)

0. The owner approves the gate. The plan v2 and that approval are committed together; this freezes the plan.
0b. A results-blind agent greps the A7 audit and verdict text for any base-multi against base-single figure. It reports only whether one exists, with line numbers. Any such figure is added to section 2 as a prior look before step 1.
1. Month blocks: `make_month_block_indices.py`, `a6_month_list.csv`, `a6_month_block_indices.csv`, run by a results-blind agent. The sha256 values are recorded in section 17 and committed.
2. In parallel, fresh agents, blind to each other:
   - Python analyst in `metrics_python/` (`a6_metrics_python.py`, `a6_metrics_python.csv`, `NOTES.txt`).
   - R analyst in `metrics_R/` (`a6_metrics_R.R`, `a6_metrics_R.csv`, `NOTES.txt`).
   - Third implementer in `model_check_multi/` (section 9).
   Nobody reads another's subfolder before step 4.
3. Each reports status only (section 9). The outputs are committed before the auditor reads them.
4. Auditor in `audit_work/`: `a6_audit.md`, the agreement table, the spot-check table and the filled gate table.
5. Orchestrator: `multipending-responsiveness-verdict-<date>.md`, written from the audited table. It lists every row value, the margins, the narrow flags and the outcome.
6. After a PASS only: a written risk review, then the owner's build decision.

Tools as found, nothing installed: `/usr/bin/python3` 3.9.6 with numpy 2.0.2 and pandas 2.3.3; R 4.5.2 with readr, dplyr, vroom and jsonlite (no data.table).

## 12. Limits (what a PASS would not establish)

- **The replay's multi is not production's multi.**
  - The replay uses hourly medians and a 1 to 2 h lag view, not 15-minute data.
  - It has no missed cron runs, no database failures, no claim races and no time budget.
  - It validates every due row at every tick.
  - Production's ice skip is not modelled (A7 D-5 H4).
  - The cap uses the lag-view LF, not production's 10 to 70 min old reading.
- **Interaction with the v39.0 soft-outlier clamp (CODE, `updateCorrectionBin` and the checks in `validatePendingPredictions`).**
  - The clamp is `if (isSoftFlagged && preCount >= 10 && Number.isFinite(sdPre) && sdPre > 0 && Number.isFinite(center)) {`. It acts only on soft-flagged observations. An observation is soft-flagged when Check 5 finds z > 3 (`softScore += 2`) or Check 1 finds an EF discrepancy over 25 percent (`softScore += 2`). Check 4 (|error| over 50 percent) adds only 1.
  - z uses the lifetime sigma (`const zScore = Math.abs(errorCFS - center) / sd;`).
  - A sustained shift under z = 3 is unclamped under both policies.
  - The clamp limits each observation, not each hour. Under multi a sustained regime shift above z = 3 goes through at up to 0.6 sigma per hour. After a few hours the EMA centre has moved, so later residuals are no longer outliers (INFERRED).
  - Under multi the `preCount >= 10` gate is reached about 5 times sooner. Lifetime counts grow about 5.4 times faster overall, so a bin's sigma is set more by calm hours (INFERRED).
- **EMA memory with alpha 0.3 (arithmetic).**
  - The weight on the k-th latest observation is 0.3 x 0.7^k. Half the weight sits on the latest 2 observations, and 90 percent on the latest 7.
  - Under single (one learned validation about every 5.4 h on average): about 11 h for half the weight and about 38 h for 90 percent. Per bin it is longer when validations spread over several bins (INFERRED).
  - Under multi, in the active bin: about 2 h and about 7 h.
  - Each observation describes a prediction made one travel time earlier. So under multi the correction becomes a roughly 7-hour average of residuals from 1 to 17 h ago, depending on flow. That is a lagged persistence correction. It helps if residuals drift slowly and adds noise if they swing daily (INFERRED).
  - After an event, the carried bin state reflects the last few hours of the rise rather than the last day or two.
  - Keeping single's time memory under hourly updates would need alpha of about 1 - 0.7^(1/5.4), roughly 0.063 (0.064 with 5.4 h, 0.063 with 5.5 h). That is a different study, not allowed on this record (section 2).
- **The band table was derived on v36.1 multi residuals.** This is a home advantage for multi in C1 to C3. The model has changed since (v37.0 smoothing, v39.0 clamp), so the table is stale for both modes.
- **Truth includes Difficult Run.** Under multi, local storms teach the bins hourly. If A5 changes the truth, this result may not carry over.
- **Truth is not rebuilt.** A7's two analysts rebuilt it from raw data and matched all ticks but the D-8 tick (BRIEF, A7 D-8 and D-9). The D-8 override applies here. A6 relies on that and on A2.
- **The single chain was independently verified by A7 on four events and one empty-bin rebuild only** (BRIEF, A7 D-9). The multi chain is verified here over the full grid.
- **Population and data:**
  - 21 events, almost all June to November. Winter is lost to the X1 ice-risk exclusion.
  - The holdout is 4 events.
  - October 2026 and everything after 2026-06-14 is on a later USGS revision than the cron saw (A7 D-3).
- **Bin history:** the bins start empty in 2011 in both chains. Production's bins have their own history and resets. The result is about the policy in the long run, not the switch-over transient.
- **The brief's "at least 8 h earlier" version of R1** is about ceil(travel(r_e)) / 2, a phase effect of the single slot, not skill. It is therefore not a gate row (P-MECH replaces it).
- **Gate power:** see the false-fail estimate in section 7.

## 13. If it passes: what would have to be built (scope and risks, no code)

The owner decides only after a written risk review. The review covers every narrow flag and every item below.

**Storage.**
- The code comment says the unique key allows one `pending` row (CODE: `// Note: UPDATE to 'expired' hits the unique constraint, so we delete.`). The database constraint itself is not in the repo.
- New ids would look like `pending_<created ISO>`.
- Every reader of `.eq('gauge_id', 'pending')` changes (CODE):
  - `scheduled-update.js` validation load (`.order('created_at', { ascending: true })`) and `storePrediction` (`.single()`).
  - `sync-learning.js`: the learning load (`.limit(50)`), the `storePrediction` action (`.single()` and its delete; the client posting path is disabled but the code is live), and the reset.
  - `scripts/recover-bins.js` ("Step 4: Clean up stuck pending prediction").
  - `analyze-stage-errors.js` reads `gauge_id = 'validated'` (legacy) and is not affected.
- Live rows: a row lives at most travel plus 2.5 h, so at most about 20 rows (17 h + 2.5 h at the floor). `.limit(50)` is not exceeded in normal operation. Exception (INFERRED from the guard order): while LF is present but outside 500 to 500,000 cfs, predictions are still made and no row is validated or dropped, so rows accumulate until the 48 h stale rule.
- The old single row must be migrated.

**Validation loop and time budget.**
- Each validation makes a series of sequential database calls: the claim delete, the bin, the stage bin, EF correlation, metadata, `storeValidationPair` and the leaderboard. The number was not counted in detail.
- Validation runs BEFORE predict and before the success ping (CODE handler: `// 4. Validate pending predictions`, `// 5. Make new prediction`, then the heartbeat ping). More validations therefore delay the estimate and the ping.
- Normally there is about 1 validation per tick. Bursts happen when travel shortens on a rise and after missed runs (INFERRED).
- A per-tick cap on validations and a time stop would be needed, with leftover rows kept within their 2.5 h window.
- The Netlify limit for scheduled functions is not verified here (about 30 s as recalled, BRIEF). The post-ping Difficult Run fetch is skipped after 20 s (CODE `const DR_LATE_SKIP_MS = 20000;`), so it would be skipped more often.

**Side effects on other features.**
- Stage bins (CODE ``const stageBinKey = `stage_${flowBin}_${flowState}`;``) also learn on every validation, so stage learning changes too.
- `storeValidationPair`'s 30-minute dedupe (CODE `if (now - lastEntry.timestamp < 30 * 60 * 1000) {`) drops a second validation in the same tick from the history.
- LF-residual advisory: it receives every pair. Its freshness rule (CODE `signalStaleMs: 12 * 60 * 60 * 1000`) would almost always be met, which changes its meaning, not only its latch cadence. The latch thresholds were chosen on a cadence not checked here.
- Headline accuracy and the leaderboard become hourly-weighted, so their meaning changes. The page text would need to change too.

**Pruning and logs.**
- Missed-window rows are deleted at once.
- `validation_log` grows about 5.4 times: about 8,500 rows a year instead of about 1,600 (INFERRED from the run-log counts over 15 years; 730-day retention).
- `tick_log.val` fields change.

**Tests and client.**
- Characterization tests for the untested `validatePendingPredictions` sub-blocks come first (June finding).
- Claim-race tests for many rows.
- The Learning tab pending count (CODE `const pendingCount = gfLearningData.pendingPredictions?.length || 0;`), and the How It Works, Tech Appendix and CLAUDE.md texts.

**Versioning.** MAJOR.

**Live check (owner decision).** Keep a shadow single-slot bin set on the server. Compare the displayed error on the first 2 to 3 qualifying rises and roll back on a loss. This doubles bin writes.

**Effort.** About 40 to 80 agent-hours including the protocol and audits. Risk: high. This is the riskiest loop in the codebase (June findings).

## 14. Effort (agent-hours)

| Step | Agent-hours |
|---|---|
| Plan audit and revision (done) | 4-6 |
| Step 0b grep, month-block script | 1-2 |
| Python analyst 6-10 and R analyst 6-10 (in parallel) | 12-20 |
| Third implementation (multi, full grid) | 4-8 |
| Auditor | 5-7 |
| Verdict | 1-2 |
| **Stage 1 total** | **about 25-40** |
| Build after a PASS (section 13), only after the risk review | 40-80 |

## 15. Frozen before any computation; not allowed after results

**Frozen:**
- The files and sha256 values of section 3.
- The reading rule, the LF validity rule and the due-time rule.
- Assertions A0 to A9, the band check, P-MECH and the D-8 override.
- The definitions in section 4: r_e, the reconstruction, the band, under-read at -15 percent.
- Windows, the holdout H, and T80 = 2024-01-26T14:00Z.
- Every gate row, its threshold and its group.
- The bootstrap files, the named statistics, and the seeds 20261115 and 20261116.
- The output layout and the required rows.
- The tolerances.
- The outcome set.

**Not allowed after results:**
- Changing any of the above.
- Using A, B or C rows.
- Choosing another window, error or run.
- Dropping events or years.
- Testing any alpha, slot rule or rise-slot variant.
- Combining with any A7 arm.

## 16. Audit response (plan audit 2026-11-11: approve_with_changes)

All 17 findings are ACCEPTED, as ruled by the orchestrator. None is rejected.

| PA | Severity | Accepted | Where applied |
|---|---|---|---|
| PA-1 | must-fix | Yes | 0 (travel table, mechanism), 2 item 9, 12 (memory, alpha 0.063), 13 (about 20 live rows, log growth) |
| PA-2 | must-fix | Yes | 3 (A4) |
| PA-3 | must-fix | Yes | 7 (deciding, robustness and guard groups, margins, false-fail estimates), 0 (Gate in one page) |
| PA-4 | must-fix | Yes | 3 (P-MECH), 8 (STOP-MECH), 12 (8 h phase note) |
| PA-5 | must-fix | Yes | 9 (multi third implementation), 12 (corrected verification sentence) |
| PA-6 | should-fix | Yes | 3 (A9), 5 (four-cell split, dilution next to R2) |
| PA-7 | must-fix | Yes | Stage 2 removed; 2 (rise-slots as untested hypothesis, new data only) |
| PA-8 | should-fix | Yes | 8 (FAIL wording), 2 and 15 (alpha ban kept) |
| PA-9 | should-fix | Yes | 5 (T80), 6 (month-block statistic, permitted columns, dropped resamples, D1 statistic and event 49), 4 (median as the 11th order statistic), 3 (A8 corollary), 6 (non-October file sentence removed), 7 (ties, full precision) |
| PA-10 | should-fix | Yes | 3 (A6 completeness, LF guard as code) |
| PA-11 | should-fix | Yes | 8 (PASS, FAIL, VOID, RERUN, STOP, STOP-MECH; FAIL-INSUFFICIENT as a formal line) |
| PA-12 | should-fix | Yes | 0 (prior in both directions; v39 mechanism labelled untested) |
| PA-13 | should-fix | Yes | 13 (live rows, recover-bins.js, stage bins, advisory freshness, analyze-stage-errors, time limit unverified) |
| PA-14 | note | Yes | 1 (empty git diff from 17c6060) |
| PA-15 | note | Yes | 5 (ticks with `soft_flag == 1` by mode) |
| PA-16 | note | Yes | 12 (clamp acts only on soft-flagged observations; preCount gate sooner) |
| PA-17 | note | Yes (moot after PA-7) | 6 (20261115 month blocks, 20261116 spot check, no other seed) |

## 16b. Orchestrator additions before the freeze (2026-11-11)

These two points were added by the orchestrator after the revision and before the owner's approval. Nothing had been computed. They are part of the frozen plan.

1. **Report-only split by the river level at the start of each rise.** Reason: the owner pointed out on 2026-11-11 that the wait is 13 h right now because the river is very low, and section 0 says the possible gain is largest for rises that start from a low river. Definition: for each of the 21 GATE events, L_e = `lf_view` at the first tick of its RL window (r_e); if that value is blank, the first non-blank `lf_view` at a later tick of the same RL window. "Low start" means L_e < 3,000 cfs; "high start" means L_e >= 3,000 cfs. Both analysts emit, with `criterion = REP_START` and `subset = RL_lowstart` or `RL_highstart`, the stats `n_events, n_ticks, mae_multi, mae_single, gain, improved` on e_disp over the scored RL ticks of the events in each group, plus one row per event with `key = event_id`, `stat = start_lf`. This table never decides anything, is not a gate row, and is not a basis for a later test on this record. No other split of the events may be added after results.
2. **The third implementation also replays the SINGLE base chain over the full grid** from empty bins (the reviser's suggestion in its notes), and compares the same named columns against the base rows of `rising_limb_ticks.csv` with the same tolerances as for the multi file. Reason: A7 checked the single chain independently on four events and one rebuild only; a full-grid check costs little once the multi replay exists. A mismatch is handled like a multi mismatch (section 8, STOP, and RERUN only for a proven harness bug).

## 17. Deviations

Empty. Each entry needs a date, a reason and who approved it, and must state whether it was made blind. The first expected entries are the step 0b grep result and the sha256 values of `a6_month_list.csv` and `a6_month_block_indices.csv`.

---

# A6 multi-pending validation: pre-registered analysis plan (DRAFT v1, 2026-11-11)

Status: DRAFT for plan audit. Nothing has been computed. No tick file has been opened. Once the owner approves it, the plan is frozen on the commit that first adds it to git. After that, changes may only be recorded in section 15 (Deviations).
Labels: CODE = I read it in the repo; the anchor text is given. BRIEF = taken from the decision brief, the June findings or the A7 documents. INFERRED = my reasoning, not tested.
Terms used throughout:
- "single": the production one-slot policy.
- "multi": a pending prediction at every tick.
- "rise-slots": the stage-2 variant.
- "learned validation": a validated pending prediction that was not hard-flagged and so updated a bin.

## 0. Bottom line first

- **My recommendation:** run stage 1. Expect it to fail. Do not build anything on a narrow pass.
- **Cost:** stage 1 needs no model run and costs about 20 to 33 agent-hours.
- **What it settles:** two questions nobody has measured. Does faster learning change the DISPLAYED value early in a rise? And what does it cost ordinary hours?
- **What a FAIL does:** it closes A6 with evidence.

**My prior that stage 1 passes: about 10 to 15 percent.**
- June study (BRIEF): the pooled gain was not significant. All 7 everyday cells were worse. The 12k to 25k rising cell was a wash. The gain halved out of time.
- A7 verdict (BRIEF): the 120 percent cap binds on about 52.5 percent of rising-limb hours under single. Where it does not bind, the baseline display already under-reads. On rising limbs the bins learn a positive raw residual, so faster learning subtracts more. That lowers the uncapped value. On uncapped hours it pushes the display further low, which is the unsafe direction. This is the same mechanism that sank arm A (INFERRED).
- Structural limit (INFERRED from the CODE rules in section 4): a bin is chosen by the flow at prediction time and learns one travel time (13 to 19 h at low flow) later. Early in a rise the river crosses bins quickly. So the bin applied at a given hour has usually had no event-time validation yet, under either policy. Multi cannot learn the currently applied bin sooner than one travel time after the river enters it. Inside the 37-hour RL window only the later half can benefit.

**Prior that stage 2 is triggered: about 15 to 25 percent.** Given a trigger, it passes about half the time, because it is built to leave calm hours alone. Overall chance that anything ships: about 10 to 20 percent.

**Is it worth doing?**
- Stage 1: yes. It is cheap, it answers the October audit's open question, and a clean FAIL has value.
- Stage 2: only under the rule in section 8.
- Building full multi: only on a clear pass, given the build risk in section 12.

## 1. Question and what is held fixed

Question: compare multi with single for the unchanged production model. Does multi make the displayed estimate better early in large rises, without making ordinary hours, recessions or the band worse?

Held fixed:
- The model is the A7 `base` arm. That is the production v39.4 server path. Later releases up to v39.6 are logging-only, per CLAUDE.md (I did not diff the code).
- Truth is Little Falls as reported, including Difficult Run; A5 is open.
- Everything else is fixed: the 18 bins, alpha 0.3, the 120 percent cap, the outlier rules, the lag view, the A7 truth rule (tau_ref), the frozen event list, and burn-in to 2012-12-01.
- Only the learning policy differs.

Why this design is not confounded: both tick files score EVERY tick under both policies, on the same raw value and the same truth. Only the bins differ. This is the June "common evaluation stream, two learners" design (BRIEF, June plan section 2). It is not the rejected "compare the two policies' own validation sets" design.

## 2. What has already been seen (declared before any computation)

1. **June study (2026-06-19).**
   - Design: multi against single, corrected MAE, 126,916 hours, 2011-12 to 2026-06, model v36.x, no lag view, no displayed-value scoring, no responsiveness measure.
   - Result: pooled 326.9 to 305.1 cfs, CI [-6.6, 26.8] (not significant).
   - The 25k to 50k and 50k-plus rising cells were significantly better.
   - All 7 everyday cells were worse (none significant).
   - The out-of-time gain was half the in-sample gain.
   - Overlap: about 95 percent of this record is the same data (INFERRED from the date spans).
2. **The v38 gate (July 2026) ran single and multi modes.** These committed files exist: `v38_headline_python_{single,multi}.csv`, `v38_headline_R_{single,multi}.csv`, `v38_summary_{single,multi}.json`, `v38_residuals_{single,multi}.csv`.
   - They may hold baseline error by mode for an earlier model.
   - I have not opened them. A7 quotes only arm-against-baseline numbers from them ("normal-hours degradation 1.66 percent multi, 11.4 percent single").
3. **The v36.1 CI derivation compared per-cell residual tails under both modes.** Files: `ci_residuals_v361_{single,multi}.csv` and `ci_v361_*_single.csv`.
   - Its table, `EMPIRICAL_CI_90`, comes from multi residuals; the high-flow cells use the wider of the two (CLAUDE.md; `ci_v361_derivation_spec.md` line 7).
   - I have not opened the residual files.
4. **A7, baseline single-slot numbers now public** (verdict, and audit section 5, which I read):
   - On RL ticks the mean signed corrected (uncapped) error is +2,461 cfs.
   - The cap binds on 52.5 percent of base RL ticks.
   - On 342 RL ticks where neither base nor A was capped, mean displayed error is -1,477 cfs.
5. **A7, report-only multi table** (audit section 6, summarised in the verdict; I did not read section 6 or section 3): within the multi replay, arm A met all 17 criteria, with G7f at +2.9 percent. In the single replay A failed G7f at -5.49 percent.
   - This compares arms within each mode, never multi against single.
   - It does show that the displayed-value effect of a raw-model change depends on learning speed. That is weak information about how multi interacts with the cap.
6. **A7's committed `metrics_python/`, `metrics_R/` and `audit_work/` hold baseline error values per replay (single, S2, S3, multi).**
   - Neither the orchestrator nor I have read them.
   - The A7 analysts and the A7 auditor did. They must not work on A6.
7. **October audit:** 66 rising predictions, 7 validations, learning about 23 h late. Hourly scoring would have latched the residual banner about 2.5 h sooner. This is one event, a replay look.
8. **Thresholds.** The six-part gate in the brief was written by someone who knew the June result. My adaptations were written by someone who knew June and the A7 verdict.
   - Watch-out: brief criterion 4 ("no cell worse by more than 2 percent with CI excluding 0") would have let June's everyday pattern through, since all 7 cells were worse but none significantly. It is lenient exactly where the earlier evidence is negative. I add point caps (N1, N2) to counter this.

**What this does to a PASS:**
- No gate on this record can be confirmatory. The hypothesis was tested in aggregate on the same years.
- The thresholds were set knowing related results.
- Some baseline quantities are public.
- So a PASS means "an honest, pre-specified measurement that did not contradict the idea". It moves belief modestly.
- A FAIL is more informative, because the gate is not tilted against multi. The CI table even favours multi (section 11).

**Not to be tested on this record, now or later:**
- Multi (or rise-slots) combined with A7's arm A, B or C. The within-multi result for A is known.
- Any alpha other than 0.3.
- Any rise-slots setting other than the one fixed in section 9.
- Multi with a Difficult Run truth.
- Any choice among the A7 S2, S3 or multi runs.
- Stage-1 analysts read only `arm == base` rows.

## 3. Data, comparability and assertions (stage 1)

Inputs:
- The tick files `rising_limb_ticks.csv` (single) and `rising_limb_ticks_multi.csv` (multi), sha256 as in `GATE_RUN_MANIFEST.txt` (8d8411... and c99c4b...). Use base rows only.
- The frozen event file `rising_limb_events_python_v39.csv` (sha256 978c6c...).
- The A7 bootstrap index files (D-2 sha256 7eff92... for 10000 x 21, c1f502... for 10000 x 20).
- One new month-block index file (section 6).
- `netlify/functions/shared/ci-table.js` (`bandFor`) for the band.

**Are the files comparable? (CODE: harness and schema)**
- Both came from the single A7 gate run at commit 17c6060.
- Both use the primary lag view (`await pass('multi', H.PRIMARY, true, false);` in `run_gate.mjs`).
- Truth, tau_ref and window labels always use the primary view (D-5 H12).
- The schema defines the multi mask as "primary mask AND the view's PoR and LF exist". Under the primary view that second part repeats the first, so the masks should be identical.
- Raw does not depend on the bins: the June self-check found 0 mismatches (BRIEF). This must be asserted, not assumed.
- Columns that may legitimately differ: `corr`, `unc`, `disp`, `ceiling_applied`, `slot`, `validated`, `hard_flag`, `soft_flag`.

**Assertions before any metric.** Any failure is a STOP and no metric is reported.
- A0. All sha256 values match: tick files, event file, both A7 index files, the new month-block file.
- A1. Both files have 523,948 data rows, the same 50-column header, and the same tick order. Base rows are the 130,987 rows with `arm == base`, one per tick.
- A2. On base rows, these tick-level columns are equal in both files at every tick: `tick_utc, in_scoring, mask, mask_why, tau_ref, tau_converged, truth, truth_tick_utc, rl_event, rlx_event, rec_event, ew_any, normal, lf_view, por_view, lf_carry_h, por_carry_h`. In the multi file, `mask_why` is never `view_input_missing`.
- A3. On base rows, these model columns are equal: `has_pred, raw, raw_unc, flow_bin, flow_state, rst, rate, stop, nonconverged, lookup_fail, it, travel_por_gf, travel_gf_lf, b_active, delta_on, pct, base_*, truth_basehz, truth_basehz_tick, truth_own, truth_own_tick`. A failure means bins feed raw, and the design is void.
- A4. At every tick before the first `validated == 1` tick in either file, every column is equal.
- A5. **D-8 override.** Tick 2026-11-09T12:00Z:
  - Assert that it has `mask == 1`, `normal == 1` and no window label in both files as written.
  - Set its mask to 0 in both.
  - Assert that no tick with an RL, RLX or REC label has `truth_tick_utc` after 2026-11-09T23:00Z.
  - Report N1 and N2 with the file mask as `N1_edge` and `N2_edge` (report-only).
  - Truth is NOT rebuilt from the raw CSV. These are the same audited files whose truth A7's two analysts rebuilt independently (D-9). A2 proves the truth is the same in both.
- A6. **Single-chain reconstruction.** For each tick v with `validated == 1`, the validated pending is the one stored at the latest tick s < v with `slot == stored`. Assert v - s >= `travel_gf_lf(s)` - 1e-9 h, and v - (s + travel_gf_lf(s)) <= 2.5 h. Validation happens before storing within a tick (CODE, ArmChain `tick`: validate, then predict, then store).
- A7. **Multi-chain reconstruction.** A pending exists at every tick s with `has_pred == 1`, due at s + `travel_gf_lf(s)`. It is validated at the first tick v >= due with v - due <= 2.5 h, v - s <= 48 h, and an LF view in [500, 500000] at v. It is dropped at the first tick after due + 2.5 h on which the LF view is valid. Assert that the set of ticks with at least one reconstructed validation equals the set with `validated == 1`, exactly.
  - Why this is exact (CODE): hard flags depend only on validation-tick inputs: `if (stageDiscrepancy > 0.35) {` and `if (actualCFS < 1500 && actualStage > 2.45 && ice.plausible) {` in `validatePendingPredictions`. So all validations at one tick share hard status. The OR in `MultiChain.validate` (`out.hard = out.hard || res.isHardFlagged`) therefore loses nothing for the hard flag. The per-tick count comes from the reconstruction.
  - Edge: due times are ms-truncated ISO strings, so the analysts compare using the same `Date` arithmetic. If A7 fails only on the ms-truncation edge, the analyst reports it and STOPs; the orchestrator rules blind.
- A8. **Invariant.** Every single validation (tick v, creation s) is also a multi validation of the pending created at s at the same tick v, with equal `hard_flag`. Hence multi is never later than single.

## 4. Definitions

**Events and windows (frozen A7 rule, BRIEF A7 plan section 3):**
- GATE events: 21 kept (20 non-October plus October 2026, the row with `oct == 1`). STRATUM events: 15, report-only.
- RL = [t0 - 12 h, min(t0 + 24 h, tp)]. RLX = [t0 - 12 h, tp]. REC = recession as in A7 M1. Normal ticks: `normal == 1`.
- F24 = [t0, min(t0 + 24 h, tp)] is the literal "first 24 h". It is report-only.
- H = holdout events 47, 48, 49 and 51.
- Every metric uses `in_scoring == 1`, the mask (after A5) and `has_pred == 1`.

**Errors (cfs, estimate minus truth):**
- e_disp = `disp - truth` (primary).
- e_unc = `unc - truth` (secondary, report-only).
- e_raw is identical in both files and is not used.

**Responsiveness.** For event e, r_e = t0 - 12 h (RL start).
- An event-created learned validation is a reconstructed validation at tick v, with creation s >= r_e and `hard_flag(v) == 0`.
- D_e(mode) = hours from r_e to the first such v, searched to tend_e. If there is none, D_e is +infinity.
- dD_e = D_e(single) - D_e(multi). Infinity minus a finite value is +infinity; infinity minus infinity is 0.
- Also reported against t0, and for October against the moment LF first reached 3,000 cfs (as the October audit did).
- K_e(mode) = the number of event-created learned validations with v in RL_e. This is exact for multi through A7.

**Bin-matched learning (report-only):** for each RL tick, the number of event-created learned validations so far whose prediction's (`flow_bin`, `flow_state`) equals the tick's own.

**Band:** `bandFor(disp, flow_bin, flow_state)` exactly as in `shared/ci-table.js`.
- CODE: `lo: Math.max(0, Math.round(estimateCFS - stateCI.q95)),`, `hi: Math.round(estimateCFS - stateCI.q05),`, and the fallback `const stateCI = s || ciData.all;`.
- Covered means lo <= truth <= hi. Coverage = covered ticks / ticks, in percent.
- `flow_bin` and `flow_state` are equal in both files, so only `disp` moves the band.

**Under-read:** a tick with 100 x e_disp / truth <= -15.
- Reason: this is the LF-residual advisory's latch level (CLAUDE.md, v37.15), the point at which the app itself calls a miss an alarm.

## 5. Metrics

**Gate metrics (all hour-pooled within the stated subset):**
- MAE_W(mode) = mean |e_disp| over window W. Gain_W = 1 - MAE_W(multi) / MAE_W(single).
- Event improved = the sum of |e_disp| over its scored RL ticks is strictly lower under multi. Ties count as not improved.
- Breadth = improved x 100 >= 65 x N, as integers.
- Recession bias = mean of 100 x e_disp / truth over REC ticks. D_bias = |bias(multi)| - |bias(single)|.
- Normal-hours relative change = MAE_normal(multi) / MAE_normal(single) - 1. Computed pooled and per cell (`base_flow_bin` x `base_flow_state`) for cells with at least 200 scored normal ticks.
- Time holdout for normal hours: normal ticks at or after T80. T80 is the tick at index floor(0.8 x number of scored grid ticks) of the scoring grid, counting from 2012-12-01T00:00Z.
- Coverage on normal, RL and REC ticks.
- Under-read share on RL and on REC.

**Report-only:**
- The same metrics on e_unc.
- F24 and RLX.
- STRATUM events.
- Per event, the multi-minus-single change in e_disp MAE, with the October line flagged.
- The RL split at each event's first multi event-created learned validation (before: carried-state effect only; after: responsiveness).
- Cap-bind rate (`ceiling_applied`) by mode and window.
- Per-cell normal-hours tables and coverage per cell.
- Signed bias per window.
- Mean e_disp of under-read ticks, and the worst under-read per event.
- Count of soft-flagged validations by mode (clamp interaction).
- Distribution of validations per tick in multi.
- K_e and dD_e per event.

## 6. Uncertainty

- **Events:** use the A7 index files unchanged, with events sorted by t0. Use 10,000 resamples and a percentile interval at 2.5 and 97.5 (numpy default, R type 7).
  - Statistics: Gain_RL as a ratio of sums over the resampled events' RL ticks (counting multiplicity); D_bias recomputed on the resampled REC ticks.
  - The non-October file serves B1.
- **Normal hours:** a NEW shared calendar-month block index file. It is produced by one script before any metric:
  - Months (UTC) from 2012-12 to 2026-11 that contain at least one scored normal tick, sorted. Call their number M.
  - Indices: `numpy.random.default_rng(20261115).integers(0, M, size=(10000, M))`, written to `a6_month_block_indices.csv`, with its sha256 recorded in section 15 before the analysts start.
  - Statistics: the pooled and per-cell normal-hours relative change.
  - Unlike A7 (E3), this makes the N2 interval identical across languages.
- **Seeds:** 20261116 for the auditor's spot-check sampling. A7's seeds are reused only through the A7 index files.

## 7. Gate (stage 1: multi against single, base model, e_disp unless stated)

N = 21 GATE events. Point = the point estimate decides. CI = the 95 percent bootstrap bound decides. Every row must hold.

| Id | Formula | Subset | Threshold | Reason (one line) |
|---|---|---|---|---|
| R1 | mechanism check: median over events of dD_e; and sum of K_e(multi) / sum of K_e(single) | GATE events, RL | median dD_e > 0 h AND ratio >= 3 (point) | Confirms the extra validations exist where they should. Brief's "at least 8 h" version: see decisions. |
| R2 | Gain_RL | RL, all 21 | >= 5% AND CI lower bound > 0 | Brief criterion 2, applied to what the visitor sees. |
| R3 | breadth | RL, all 21 | >= 65% (14 of 21) | Brief criterion 3: no single flood carries it. |
| B1 | Gain_RL | RL, no October (20) | > 0 (point) | Brief criterion 5: the sign survives without the motivating event. |
| B2 | Gain_RL with each event dropped in turn | RL, 21 drops | every drop > 0 (point) | A7-style leave-one-out on the sign. |
| B3 | Gain_RL | RL, holdout H (4 events) | > 0 (point) | Brief criterion 5: the last 20 percent of events in time. |
| N1 | pooled normal-hours relative change | normal | <= +1% (point) | Brief criterion 4, pooled: ordinary hours no worse. |
| N2 | per-cell relative change | normal cells with >= 200 ticks | a cell fails if (> +2% AND month-block CI lower bound > 0) OR > +5% | Brief rule plus A7's G4b cap, because the brief rule alone would pass June's pattern. |
| N3 | pooled normal-hours relative change | normal, ticks >= T80 | <= +2% (point) | June's gain halved out of time; this guards against harm concentrated in recent years. Looser because it uses about one-fifth of the hours. |
| D1 | D_bias | REC, all 21 | <= 0 pp (point) AND CI upper bound <= +1.0 pp | Recession under-read was October's worst problem; A7 G3a analogue on the displayed value. |
| C1 | normal-hours coverage | normal | abs(cov(multi) - 90) <= max(4, abs(cov(single) - 90)) | Brief criterion 6; does not fail multi for a miss single already has. |
| C2 | RL coverage | RL | cov(multi) >= cov(single) - 2 pp | Band failure in events is the known problem; it must not get worse. |
| C3 | REC coverage | REC | cov(multi) >= cov(single) - 2 pp | Same for recessions (October: 14 misses in a row). |
| S1 | under-read share | RL | share(multi) <= share(single) + 0.5 pp | The unsafe direction; 0.5 pp is about 4 of about 780 RL ticks (INFERRED count). |
| S2 | under-read share | REC | share(multi) <= share(single) + 0.5 pp | Same, on recessions. |

**Owner-set criteria:** all thresholds above. The ones most open to judgement: the form of R1, R2's 5 percent, N1's 1 percent, the N2 rule, the S1/S2 definition (-15 percent) and margin (0.5 pp), and the 2 pp in C2/C3.

**Power note (INFERRED):** fifteen rows, each of which can fail on noise, make a PASS hard. This is intended for a "no harm" question.

Decisions use full precision; nothing is rounded before comparison.

## 8. Outcomes (exhaustive) and the stage-2 rule

**STOP (not a verdict).**
- Triggers: any A0 to A8 failure, a Python/R disagreement beyond tolerance, or any read of a forbidden file or of non-base rows.
- Action: investigate. Rerun only to fix a proven implementation bug, and log every run.

**FAIL-INSUFFICIENT.**
- Trigger: fewer than 15 non-October GATE events have at least 6 scored RL ticks after A5 (the A7 floor). This is not expected, since the frozen list has 20.
- Action: the item closes and nothing is computed further.

**PASS.**
- Trigger: every row of section 7 holds.
- Action: stage 2 is NOT run. The owner decides whether to build full multi (section 12), under the Code-Change Verification Protocol. It would be a MAJOR version, because the learned correction changes GF output. If built, it ships with the live check in section 12.

**FAIL.**
- Trigger: at least one row fails. The verdict names every failed row.
- Stage 2 runs if and only if ALL of these hold:
  - (a) R1, R2, R3, B1, B2, B3, C2 and S1 all pass, so the rise is helped.
  - (b) Every failed row is in {N1, N2, N3, C1, D1, C3, S2}, so the harm is in calm hours or recessions, where rise-slots are mostly inactive.
- Otherwise A6 closes. There is no retuning and no rerun on this record. A new idea needs a new plan and new data.
- Assumption behind (a) (INFERRED, stated as a choice): rise-slots add fewer validations during a rise than multi. So if multi does not help the rise, rise-slots are not expected to either.

No other route to stage 2 exists. In particular, "close to passing" does not count.

## 9. Stage 2: rise-slots (specified now, run only under section 8)

**Can it be specified honestly now?** Yes for the mechanics. Its evidential weight is lower than stage 1's, for two reasons:
- It is triggered by a stage-1 pattern on the same 21 events.
- Its rise-hour behaviour lies between single and multi, so it is correlated with stage 1.

The alternative, stage 2 on new data only, is not practical. About 3 qualifying rises a year (BRIEF, rough) means about 5 years to reach 15 events. So stage 2 runs on this record, fully pre-specified, and a pass ships only with the live check in section 12.

**Variant (base model, one pool of pending rows P):**
- Rise mode at tick t: the tick's own prediction trace has `rst == 'rising'` and `rate >= 1.0` (percent per hour).
  - That is a Point of Rocks rise of at least 6 percent over 6 h, three times the flow-state threshold (CODE `getFlowState`: `const threshold = Math.max(minAbsChange, currentCFS * minPctChange);` with 100 cfs and 0.02).
  - The threshold is a judgement. It is not tuned and no data was looked at.
  - It is causal: it uses only inputs at t.
- Store step at t, after predict:
  1. Remove from P every row that is replaceable (`isExistingPredictionReplaceable`, missed window or bad date).
  2. If P is empty, store. This is exactly single.
  3. Else, if rise mode holds, P has fewer than 4 rows, and the newest row in P is at least 3 h old, store as an extra row.
  4. Else skip.
- Why 4 and 3 h: 4 x 3 h = 12 h, about the shortest due time at low flow. So in a sustained rise one validation arrives about every 3 to 5 h, spread evenly instead of in a burst of correlated consecutive hours (the June autocorrelation concern).
- When extra slots stop: no extra row is stored once rise mode is false. Rows already stored stay and validate normally. Nothing is deleted early.
- Validate step: as in multi. Every row of P is validated when due, in creation order, with the 2.5 h window, the 48 h stale rule and the LF guard. Missed-window rows are dropped.

**Harness extension** (copy the A7 harness; originals untouched):
- A `RiseSlotChain` class.
- Extra tick columns: `n_val`, `n_learned`, `n_hard`, `n_pending`, `rise_mode`.
- Tests:
  - With rise mode forced false, `RiseSlotChain` reproduces the base rows of `rising_limb_ticks.csv` byte for byte on all 50 columns.
  - A fresh base-only rerun of `ArmChain` and `MultiChain` reproduces the base rows of both frozen files byte for byte.
  - Text-drift tests on the learning gate, as in A7.
- Committed before the run. The run refuses to start on a dirty tree and logs the sha256 values. One gate run only.
- The run also writes `RiseSlotChain` bin and pool snapshots at t0 - 72 h for the third implementation.

**Stage-2 gate:** the section 7 table with "multi" replaced by "rise-slots", against single from the frozen file, using the same assertions (A0 to A8 adapted; A7 replaced by agreement with `n_val`) and the same outcomes. Plus one extra outcome rule: PASS ships rise-slots, FAIL closes A6. There is no stage 3.

## 10. Verification (both stages)

**Blind Python and blind R metrics.**
- Use fresh agents that worked on neither A7 nor the June study, blind to each other and to all results.
- They read only: this plan, `TICK_SCHEMA.md`, the tick files (base rows), the event file, the index files and `shared/ci-table.js`.
- They must not read: the A7 verdict and audit, the A7 metric folders, the June files, the v38 or CI residual files, or the harness source.
- Order: checksums, then A0 to A8, then metrics.
- Output layout: A7 E2 (`run, criterion, mode, subset, stat, key, value`), each in its own subfolder.

**Tolerance.**
- Counts and ids: exact.
- Fractions and percentage points: absolute 1e-6.
- cfs: 0.01.
- Reason: CLAUDE.md's 0.01 applied to fractions would allow a 1-point gap next to a 5-percent threshold. A7 actually agreed to 5.5e-11.
- The CIs use shared indices, so they are held to the same tolerance.
- Any divergence is a STOP.

**Third implementation (stage 2 only).**
- A Python implementation of the pool rule, written from section 9 alone.
- Runs on A7's four events (ids 11, 30, 51, 53, from D-9) starting from the `RiseSlotChain` snapshots.
- Must match the stored, validated and pending counts exactly, and `corr` within 0.5 cfs.
- One seeded event (`default_rng(20261116).integers(0, 4)`) is rebuilt from empty bins and must match to 1e-6.
- Stage 1 needs none, because its chains were already verified by A7's third implementation and seeded rebuild (D-9).

**Independent auditor** (Opus, has run nothing):
- Checks agreement, A0 to A8, the gate arithmetic, and the month-block file (regenerated from its seed and checked against the sha256).
- Spot-checks at least 5 RL-tick inputs against live USGS IV medians (seed 20261116; tolerance 1 percent for approved data, provisional data flagged).
- Fills in the gate table. The orchestrator writes the verdict from it.

## 11. Limits (what a PASS would not establish)

- **The replay's multi is not production's multi.**
  - The replay uses hourly medians and a 1 to 2 h lag view, not 15-minute data.
  - It has no missed cron runs, no database failures, no claim races and no time budget.
  - It validates every due row at every tick.
  - Production's ice skip is not modelled (D-5 H4).
  - The cap uses the lag-view LF, not production's 10 to 70 min old reading.
- **Interaction with the v39.0 soft-outlier clamp (CODE, `updateCorrectionBin`):**
  - The clamp is `if (isSoftFlagged && preCount >= 10 && Number.isFinite(sdPre) && sdPre > 0 && Number.isFinite(center)) {`. Its sigma is the lifetime sigma (`classifyOutlier`: `const zScore = Math.abs(errorCFS - center) / sd;`).
  - The clamp limits each observation to 0.6 sigma, not each hour. Under multi a sustained regime shift goes through at about 0.6 sigma per hour, and after a few hours the EMA centre has moved, so later residuals are no longer outliers. Multi therefore removes most of the protection against a sustained wrong signal. The October recession was such a case, then via the pre-v39.0 lockout (INFERRED).
  - Lifetime counts also grow about 15 times faster, so a bin's sigma is set more by calm hours (INFERRED).
- **Autocorrelated errors in an EMA with alpha 0.3 (arithmetic):**
  - The weight on the k-th latest observation is 0.3 x 0.7^k. Half the weight sits on the latest 2 observations; 90 percent on the latest 7.
  - Under single (about one learned validation per 15 to 20 h): memory is about 30 to 40 h for half the weight and about 4 to 6 days for 90 percent.
  - Under multi, in the active bin: about 2 h and about 7 h.
  - Each observation describes a prediction made one travel time earlier. So in calm weather the correction becomes a roughly 7-hour average of residuals from 13 to 26 h ago. That is a lagged persistence correction. It helps if residuals drift slowly and adds noise if they swing daily (INFERRED).
  - After an event, the carried bin state reflects the last few hours of the rise instead of the last day or two. That makes the starting state for the next event noisier.
  - Keeping single's time memory under hourly updates would need alpha of about 1 - 0.7^(1/15), roughly 0.024. That is a different study, not allowed here (section 2).
- **The band table was derived on v36.1 multi residuals.**
  - This is a home advantage for multi in C1 to C3.
  - The model has changed since (v37.0 smoothing, v39.0 clamp), so the table is stale for both modes.
- **Truth includes Difficult Run.** Under multi, local storms teach the bins hourly. If A5 changes the truth, this result may not carry over.
- **Population and data:**
  - 21 events, almost all June to November. Winter is lost to the X1 ice-risk exclusion.
  - The holdout is 4 events.
  - October 2026 and everything after 2026-06-14 is on a later USGS revision than the cron saw (D-3).
- **Bin history:** the bins start empty in 2011 in both chains. Production's bins have their own history and resets. The result is about the policy in the long run, not the switch-over transient.
- **R1 is mostly mechanics.** The 8-hour figure in the brief is close to the expected phase of the single slot (about half a travel time), not a measure of skill.

## 12. If it passes: what would have to be built (scope and risks, no code)

**Storage.**
- The unique key on (`observation_type`, `gauge_id`) allows one `pending` row (CODE: `// Note: UPDATE to 'expired' hits the unique constraint, so we delete.`).
- New ids would look like `pending_<created ISO>`.
- Every reader of `.eq('gauge_id', 'pending')` changes: `validatePendingPredictions`, `storePrediction`, the `sync-learning.js` load (`.limit(50)`), its `storePrediction` action (`.single()`; the client posting path is disabled but the code is live), its reset, and `analyze-stage-errors.js` (reads `validated`; check it).
- At the 1,000-cfs floor the travel time is up to about 50 h, so up to about 50 rows are live. That exceeds `.limit(50)` (INFERRED).
- The old single row must be migrated.

**Validation loop and time budget.**
- Each validation makes about 12 sequential database calls (CODE: the awaits from the claim delete through bin, stage bin, EF correlation, metadata, `storeValidationPair` and the leaderboard).
- Validation runs BEFORE predict and before the success ping (CODE handler: steps 4 and 5, then the ping). More validations therefore delay the estimate and the ping.
- Normally there is 1 validation per tick. Bursts happen when travel shortens on a rise and after missed runs (INFERRED: 4 to 6 at once).
- A per-tick cap on validations and a time stop would be needed, with leftover rows kept within their 2.5 h window.
- I could not verify the 30 s limit. The post-ping Difficult Run fetch is skipped after 20 s (CODE `const DR_LATE_SKIP_MS = 20000;`), so it would be skipped more often.

**Side effects on other features.**
- `storeValidationPair`'s 30-minute dedupe (CODE `if (now - lastEntry.timestamp < 30 * 60 * 1000) {`) drops a second validation in the same tick from the history.
- The LF-residual advisory receives every pair. Its latch rules were chosen on a cadence I did not check, so it would need a re-check.
- Headline accuracy and the leaderboard become hourly-weighted, so their meaning changes. The page text would need to change too.

**Pruning and logs.**
- Missed-window rows are deleted at once.
- `validation_log` grows about 15 times (730-day retention; INFERRED about 9,000 rows a year).
- `tick_log.val` fields change.

**Tests and client.**
- Characterization tests for the untested `validatePendingPredictions` sub-blocks come first (June finding).
- Claim-race tests for many rows.
- The Learning tab pending count (CODE `const pendingCount = gfLearningData.pendingPredictions?.length || 0;`) and the How It Works, Tech Appendix and CLAUDE.md texts.

**Versioning.** MAJOR.

**Live check (owner decision).** Keep a shadow single-slot bin set on the server. Compare the displayed error on the first 2 to 3 qualifying rises and roll back on a loss. This doubles bin writes.

**Effort.** About 40 to 80 agent-hours including the protocol and audits. Risk: high. This is the riskiest loop in the codebase (June findings).

## 13. Effort (agent-hours, honest)

| Stage | Steps | Agent-hours |
|---|---|---|
| Stage 1 | plan audit and revision 3-5; month-block script 1; Python 6-10 and R 6-10 (in parallel); auditor 4-6; verdict 1-2 | 21-34 |
| Stage 2 | harness extension and tests 8-14; harness review 2-4; run under 1; third implementation 6-10; Python and R 3-6 each (scripts reused); auditor 4-6; verdict 1-2 | 30-50 |
| Build after a pass | section 12 | 40-80 |

## 14. Frozen before any computation; not allowed after results

**Frozen:**
- The files and sha256 values of section 3, assertions A0 to A8, and the D-8 override.
- The definitions in section 4: r_e, the responsiveness reconstruction, the band, under-read at -15 percent.
- Windows and the holdout H; T80.
- Every gate row and threshold.
- The bootstrap files and seeds 20261115 and 20261116.
- The tolerance.
- The stage-2 trigger, variant (rate >= 1.0 percent per hour, 4 rows, 3 h, the pool rule) and gate.

**Not allowed after results:**
- Changing any of the above.
- Using A/B/C rows.
- Choosing another window, error or run.
- Dropping events or years.
- Sweeping slots, spacing, trigger or alpha.
- Combining with any A7 arm.

## 15. Deviations

Empty. Each entry needs a date, a reason and who approved it, and must state whether it was made blind.

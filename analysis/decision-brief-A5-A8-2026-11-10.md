# Decision brief: audit items A5 to A8 (2026-11-10)

Read-only brief. No analysis was run for it. Numbers are quoted from the October audit
(`analysis/pulse-audit-2026-10/REPORT.md`, CRITIC.txt) and from earlier studies. "Inferred" marks my own reasoning.
Plain terms: "cfs" = cubic feet per second. "Bin" = a learned correction for one flow range and trend.
"Backtest" = replay of past river data through the real model. "Gate" = pass/fail numbers fixed before the run.

## 1. Summary (one decision each)

1. A5 Difficult Run: score against Little Falls minus Difficult Run, for display and accuracy only first. Recommend yes; learning change later.
2. A6 Multi-pending: do not build now. Recommend a narrow "rise-only extra slots" backtest, run after A7, with the gate in section 3.
3. A7 Rising-limb travel and delta fix: approve a gated backtest of "travel from current river, delta on Point of Rocks only". Ship only if the gate passes.
4. A8 Band and labels: drop the High/Medium/Low label now, keep the table band, and test a live-recalibrated band against a gate.
5. Order: A5 and A8 can start now; A7 backtest can start now but its live check waits for 2 to 3 real rises; A6 waits for A7.

## 2. A5. Difficult Run

**What is wrong.** The app scores its Great Falls estimate against Little Falls flow. Difficult Run joins between the two, so its flow counts as error. It peaked at 1,620 cfs on 2026-10-11 and explains about 65 to 100 percent of the onset residual (CRITIC.txt, G3). Scoring against Little Falls minus Difficult Run moved onset bias from about -31 to -22 percent (REPORT.md, problem 6).

**What the code does today.** The server validates at the due time and compares the estimate with the Little Falls reading alone (`scheduled-update.js:1088`, `actualCFS = lf.q`). The server never fetches Difficult Run (gauge 01646000). Only the browser does, for the Creeks tab (`src/data/fetch.js:319-379`, `src/model/constants.js:117`). The bin learns raw estimate minus that truth (`scheduled-update.js:1097`, `:1354`), so every local storm teaches the bin a creek that the estimate cannot see.

**Options.**
- **A. Subtract from truth.** Truth = Little Falls minus Difficult Run (read at the same time, maybe shifted 1 to 2 hours; the real lag is unknown). In October: onset bias -31 to -22 percent (quoted, single event, CRITIC.txt line 127). Risks: Difficult Run is only 58 square miles of a gauged part; other unmeasured inflow stays. If its gauge is missing at validation, fall back to plain Little Falls. Needs a new server fetch and a new field on the pending row. Effort: medium. Changes scoring AND learning (the bins learn the new truth).
- **B. Flag only.** When Difficult Run exceeds a share of Little Falls (for example 5 percent), mark the validation, show it, and skip bin learning for it. In October I infer it would have dropped the onset rows from learning (inferred). Risk: removes the biggest residuals again, the same truncation worry as the cap study (`cap-mechanism-map-2026-11-10.md`, option 1). Effort: small to medium. Changes learning.
- **C. Score both, change nothing.** Log Little Falls minus Difficult Run beside the old truth for a season. No estimate or learning change. Effort: small. Changes nothing but evidence.

**Recommendation.** C then A. Start with C (the log is cheap and gives live data), run the backtest below, and adopt A for scoring and learning only if it passes. B is the fallback if the Difficult Run history is too short.

**Backtest outline.**
- Data: hourly set `analysis/hourly_backtest_data_v38.csv` (2011-12 to 2026-07, 126,916 rows plus 812) has no Difficult Run column. Fetch USGS 01646000 hourly values for the same span. The gauge's record start is not checked here (unknown).
- Events: every Little Falls rise past 6,000 cfs (my rough count from that file: about 85 in 14.6 years, inferred), plus local storms where Difficult Run exceeds 5 percent of Little Falls.
- Metric: (1) share of Little Falls explained by Difficult Run by flow state; (2) prequential replay with the real `makeGFPrediction`, two arms (old truth, new truth), scored on the SAME new truth so arms are comparable; compare corrected MAE and bin stability.
- Baseline: current model and truth (v39.x).
- Proposed gate (not yet agreed by owner): ship A iff (a) pooled MAE on the new truth is no worse, CI excluding "worse by more than 1 percent"; (b) local-storm hours improve by at least 5 percent; (c) no flow-by-state cell with 200 or more hours worsens by more than 5 percent (same cell rule as the EF gate, `ef-divergence-gate-plan-v3-2026-07-20.md` section 6); (d) the sign survives dropping October 2026 and a last-20-percent time holdout. Reason: this change is about removing a known contaminant, so "no harm, small gain" is the right bar.
- Verification: blind Python and R, as in the June and July gates.

**Needs first.** The Difficult Run history pull. Live gauge outage rate (unknown). Nothing waits on new logs.

**Question for owner:** May I log "Little Falls minus Difficult Run" beside the current truth now, and run the backtest before switching the truth?

## 3. A6. Multi-pending validation

**What is wrong.** One pending prediction is held at a time. From 10-11T13 to 10-12T14, 26 hourly ticks produced one scored validation, and learning began about 23 hours after Little Falls passed 3,000 cfs (REPORT.md, problem 2). Scoring every tick would have latched the residual banner only about 2.5 hours sooner, so the cost is to learning, not the banner.

**What the code does today.** `storePrediction` reads the single row `gf_prediction/pending` and skips a new prediction while it is inside its window (`scheduled-update.js:1866-1888`). The due time is the Great Falls to Little Falls travel time, 13 to 19 hours at current flows (`:969`, TODO A3d). A late validation is accepted up to 2.5 hours (`shared/model.js:872`).

**Past work (the June rejection).** TODO.md row 14 and `analysis/multipending-learning-findings-2026-06-19.md`. Two-arm replay over 126,916 hours. Verdict: qualified pass, rejected on cost-benefit. Pooled gain 326.9 to 305.1 cfs MAE but not significant (CI -6.6 to 26.8). It helped 25-50k and 50k+ rising bins (CI excluded 0), made all 7 everyday cells worse (not significant each), did nothing for 12-25k rising, and the gain halved out of time. The findings state the missing piece: "a study of the responsiveness benefit". It was explicitly NOT tested.

**Options.**
- **A. Full multi-pending.** Store every hourly prediction. June evidence: everyday cells worse, flood tail better. Largest change: new multi-row storage, rework of `validatePendingPredictions`, which has untested sub-blocks (findings, Recommendation). Effort: large. Changes learning (and the live band, because the CI table was derived on multi-pending residuals, `ci_v36.1_backtest_plan.md` S-F3).
- **B. Rise-only extra slots.** Keep one slot in calm weather; allow up to N (say 4) slots only while Point of Rocks is rising past a threshold. In October: would have added scored rows during the 26 ticks (inferred; the mechanism is untested). It targets the flood tail where June showed the gain and avoids the everyday cells where June showed harm. Effort: medium-large. Changes learning.
- **C. Do nothing, fix upstream (A7).** The five rising rows that trained the 12k-25k rising bin were +1,160 to +6,070 cfs raw residuals (`cap-mechanism-map-2026-11-10.md` section 4). Faster learning of a biased signal could entrench it (inferred). Effort: none. No change.

**Recommendation.** C now, B as a backtest after A7. Reason: if the rising-limb residual is mostly a travel-time error, learning it faster is worse, not better. Also the cap study could not tell timing error from level error.

**Backtest outline.**
- Data: the 126,916-row hourly set, harness `analysis/multipending_gate.mjs` and `c45_gate.mjs` (they already run single and multi arms with the real model; `v38_gate_harness.mjs` is the newest). Gauges: Point of Rocks 01638500, Monocacy 01643000, Goose 01644000, Broad Run 01644280, Seneca 01645000, Edwards Ferry 01644148, Little Falls 01646500.
- Events: all rises with Little Falls crossing 3,000 and peak 12,000 or more (about 43 by my rough count, inferred; 25 reach 25,000).
- Arms: single (production), full multi, rise-only multi (B).
- New metrics the June study lacked: (1) hours from Little Falls crossing 3,000 to the first learned validation; (2) corrected MAE in the first 24 hours of each rise; plus the June metrics.
- Proposed gate for B (fixed in advance), ship iff ALL hold:
  1. Median delay to first learned validation falls by at least 8 hours (October was about 23). Reason: below that, the benefit is not worth a live-loop change.
  2. First-24-hour MAE on 12k+ rises improves at least 5 percent, event-block bootstrap 95 percent CI excluding 0 (the July gate used the same CI rule).
  3. Improves in at least 65 percent of events (about 28 of 43), so no single flood carries it.
  4. Pooled MAE no worse by more than 1 percent, and no flow-by-state cell worse by more than 2 percent with CI excluding 0 (June rule 4, carried over unchanged).
  5. Last-20-percent time holdout and dropping October 2026 both keep the sign of 1 and 2.
  6. Band coverage in the changed cells stays within 90 plus or minus 4 points (CI plan section 8).
  Reason for these numbers: June failed on thin, over-fit, flood-only gains, so the new gate requires breadth (3), time stability (5) and a responsiveness number (1).
- Verification: blind dual-language, third-agent audit, live fidelity check of the replay against `tick_log`.

**Needs first.** A7 decided (or its backtest finished). Harness reuse is ready. No new live data is required.

**Question for owner:** Do you want the rise-only multi-pending backtest queued behind A7, with the six-part gate above?

## 4. A7. Rising-limb travel lookup and delta correction

**What is wrong.** On the rise the model's Point of Rocks to Little Falls travel was 48 to 61 hours against about 13 observed; the loop failed to converge on 22 of 54 rising ticks (REPORT.md, problem 3). The delta correction scales the tributaries too and pushed the recession raw low (raw bias -4.3 percent with it, -0.6 without; problem 1). Rising-limb raw magnitudes were not logged and one check fails (replay 16,401 vs 20,743 implied), so magnitudes are unverified (REPORT.md limits).

**What the code does today.** The multiplier comes from the Little Falls flow (`scheduled-update.js:805`, `getFlowMultiplier(lf.q)`), which on a rise is still the low base flow. Travel = 19.4 hours times that multiplier, cut up to 30 percent when rising (`shared/model.js:385-391`). Three passes try to settle on a self-consistent lookup (`:812-825`). Then, if Point of Rocks differs by more than 5 percent from the looked-up reading, the whole sum (Point of Rocks plus four tributaries) is scaled by up to half the change (`:866-875`, `DECAY_CAP` 0.50).

**What existing evidence says.** `cap-mechanism-map-2026-11-10.md` Part 3, option 3, replays four variants on the five rising rows (one event, replayed raw values, in-sample, "not a result"). Residuals leave the 12k-25k rising bin at: base +3,762; delta on Point of Rocks only +2,410; fixed 9.4-hour travel +3,405; both +2,797; no delta -697 but under-reading by 8,000 on one row. None removes the +5,000 residuals on the two steepest rows. The author says they may be timing, not level.

**Options.**
- **A. Delta on Point of Rocks only.** Stop scaling the tributaries. In October: bin +3,762 to +2,410 (replayed, one event). Small code change. Changes the estimate.
- **B. Rise-aware travel multiplier.** Take the multiplier from the current Point of Rocks flow (or the larger of current and lagged) when rising. In October: with a fixed 9.4-hour travel the bin went to +3,405 (replayed). Changes the estimate; medium effort; must stay identical in the client mirror (parity tests exist: `test/correction-parity.test.mjs`).
- **C. A plus B.** +2,797 in the same replay. Largest change; effort medium-large; most to verify.
- **D. Wait for logs, then decide.** No change. Costs months of known bias on rises.

**Recommendation.** Run the backtest for C versus A and B separately. Do not decide on October alone; it cannot separate timing from level. If the gate passes, ship whichever passing arm is simplest (the project's simplicity rule, `ef-divergence-gate-plan-v3` section 6).

**Backtest outline.**
- Data: the same 126,916-row set (Point of Rocks, four tributaries, Edwards Ferry, Little Falls). Caveat (inferred): hourly values have no reading lag, so the 65 to 70 minute stale Little Falls reads of October are not reproduced.
- Events: all rises, Little Falls crossing 6,000 with peak at least 12,000 (about 43; rough count, inferred) and the whole recession after each.
- Arms: current, A, B, C. Real `makeGFPrediction` with the change under flag.
- Metrics: corrected MAE on rising ticks (first 24 hours after crossing 6,000); raw bias on recession ticks; share of rising ticks where travel lookup did not converge; modelled travel versus observed (observed from cross-correlation of Point of Rocks and Little Falls per event; a method to define).
- Proposed gate, ship iff ALL hold:
  1. Rising-limb MAE improves at least 15 percent pooled, event-block CI excluding 0; at least 10 percent with October 2026 dropped. Reason: this is the largest known raw error, so a bar lower than the EF gate's 25 percent is fair, but the historical floor stops an October-only pass.
  2. Improves in at least 65 percent of events.
  3. Recession raw bias magnitude not worse than -0.6 percent plus 1 point (the "no delta" level in October).
  4. Normal-hours MAE degrades at most 2 percent; no flow-by-state cell with 200+ hours degrades over 5 percent (EF gate rules).
  5. Non-convergent rising ticks fall below 5 percent (October 41 percent, 22 of 54).
  6. Leave-one-event-out and the last-20-percent holdout keep 1 and 2.
- Live fidelity check: on the next logged rise, the replay must reproduce `tick_log` raw within max(5 percent, 150 cfs), as in the July gate.
- Verification: blind Python and R, third-agent audit, Code-Change Verification Protocol before any edit.

**Needs first.** The backtest itself needs nothing new. The live check needs 2 to 3 logged rises (`tick_log` has 1 row today; `validation_log` has none; checked 2026-11-10). Rough frequency from the hourly file (my count, inferred): about 6 rises a year cross 6,000 from below 4,500, about 3 a year peak above 12,000, about 1.7 a year above 25,000. So 2 to 3 usable rises is roughly 4 to 12 months. Season mix and drought effects are unknown.

**Question for owner:** Approve the backtest of options A, B and C with the gate above (ship only on pass)?

## 5. A8. Confidence band and labels

**What is wrong.** The 90 percent band held the actual on 20 of 41 logged validations (49 percent). It comes from a fixed table and did not respond to anything learned. High, Medium and Low all had about 9 percent median error (9.4, 9.0, 9.0; labels reconstructed). Before the flood coverage was 69 of 72 ticks (REPORT.md, problem 7). So the band works in calm weather and fails in events, 14 misses in a row on the recession.

**What the code does today.**
- Band: a fixed table of lower and upper error quantiles for 6 flow ranges by 4 trends (`src/model/constants.js:95-105`, `EMPIRICAL_CI_90`), from a 126,916-hour replay (comment there; plan `ci_v36.1_backtest_plan.md`). The band is the estimate minus those quantiles (`src/estimation/great-falls.js:87-130`), centred on the capped number (cap study, Part 1 section 2). It does not use the learned error spread, although that is computed and returned.
- Label: purely rule-based, from whether real tributary readings and a time-shifted lookup exist, whether the Edwards Ferry blend is used, and whether its trend agrees (`great-falls.js:538-558`). It never looks at past error. The page lowers it one step when an advisory banner is up (`src/ui/great-falls-ui.js:205-217`).
- The label is not stored in `tick_log`, so label error stats cannot be rebuilt from new logs (checked tech-appendix field list; inferred absent). 

**Past work.** C2 / v36.1 (`ci_v36.1_backtest_plan.md`, `ci_v361_derivation_spec.md`): targets were global 90 plus or minus 4 points and equal tail misses (section 8). Its own amendment S-F3 warned the table comes from the faster-learning multi-pending path, so live bands could under-cover in transients. October is that case.

**Options.**
- **A. Drop the label, keep the table band** (and fix the page text that says 49 percent, `index.html:215`, TODO A9z). In October the label told nobody anything (9.0 to 9.4 percent). Effort: small. Changes display only.
- **B. Live-recalibrated band.** Widen the table band using recent validated misses (for example, scale so that the last 20 to 30 scored validations would have been 90 percent covered, with a floor at the table). In October (inferred, untested) it would have widened after the first misses, but on the rise validations arrive 13 to 16 hours apart, so it would have lagged. Effort: medium. Changes display only (not the estimate).
- **C. Honest states instead of numbers.** Show the band only for calm flow; in events show "range uncertain, river changing fast". Effort: small. Display only; loses the band when users want it most.

**Recommendation.** A now. Then test B against a gate. C is a reasonable fallback if B fails, since in events the band had no information.

**Backtest outline.**
- Data: prequential replay on the hourly set (as in C2), the table versus B, scored at validation time. Also the 41 October validations as a check, not as evidence.
- Metrics: coverage overall, in event windows (Little Falls above 6,000 and rising), and calm hours; mean band width; tail symmetry.
- Baseline: current table.
- Proposed gate (display only, so lighter): ship B iff (a) calm-hours coverage stays in 90 plus or minus 4 points; (b) event-window coverage at least 80 percent (October 49; table-in-event value in history is not known here); (c) mean calm band width grows at most 15 percent; (d) holds on the last-20-percent holdout and without October 2026. Labels: keep a label only if the rebuilt label's median error differs by at least 20 percent relative between levels in this replay; else drop.

**Needs first.** Nothing waits. The label rebuild needs the label logged (small change, display-adjacent) or recomputed from replay inputs.

**Question for owner:** May I remove the High/Medium/Low label and the 49-percent wording now, and queue the live-recalibrated band behind its gate?

## 6. Order and timing

- Start now, in parallel: A8 option A (small), A5 option C plus its Difficult Run history pull and backtest (medium), A7 backtest (large; reuse the v38 harness).
- Wait for data: A7 live check needs 2 to 3 rises (about 4 to 12 months, rough). A6 waits for the A7 result, then a medium backtest on the same harness.
- Rough effort: A8-A about half a day; A8-B and A5 backtest about 2 to 3 days each; A7 backtest and A6 backtest about 3 to 5 days each; each with dual-language verification and audit.
- Never run two model-changing releases at once. Ship A5, then A7, then A6, one verification cycle each.

## 7. What I could not establish

- When the Difficult Run gauge (01646000) record starts, and its outage rate. Not checked.
- The lag between Difficult Run's mouth and the Little Falls gauge.
- The true rate of rises: my count of 85 / 43 / 25 events came from a quick scan of the hourly file, not a defined event census; the file has gaps I did not check.
- Whether October's rising-limb residuals are level error or timing error (`cap-mechanism-map` open items). Raw rising-limb values are replayed, not logged.
- Whether the confidence label is recorded anywhere live; event-window coverage of the table in history; whether the 117k-hour harness still runs unchanged on v39.4.
- Production state: one `tick_log` row, no `validation_log` rows yet (2026-11-10 query), so nothing live is verified (A3a to A3d open).

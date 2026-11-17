# Replay analysis plan: does a fresher Point of Rocks reading improve the Great Falls estimate? (Step 3, option C)

Draft 2026-11-17. Plan only; no code written or run. Needs the independent plan audit (CLAUDE.md protocol step 2) before any code.

## 0. What the existing replay assumes (a finding in itself)

Facts read from `analysis/ci_backtest_harness.mjs` and the data:
- Data: `analysis/hourly_backtest_data_v361.csv`, 126,916 hourly UTC rows, 2011-12-01 05:00 to 2026-06-16 03:00. Generator: `fetch_hourly_backtest_data_v361.py` (frozen). It stores the hourly MEDIAN of the 15-minute readings inside [t, t+1h), keyed by the hour start (`resample_to_hourly`). Non-blank counts: por_now 124,071, ef_stage 124,274, lf_discharge 125,389, goose 125,014. There are 262 gaps (4 longer than 6 h). The v38 extension (to 2026-07-20, provisional) is not used.
- The harness feeds row t to the model as the "current" reading of every gauge, with the clock set to t (`buildUsgsData` lines 158-169, call at 236-241). It validates at the first row at or after the due time (189-227), against LF in that row.
- So row t's value is the median of readings t:00 to t:59, average reading time about t+22 min, treated as known at t. The existing replay therefore has look-ahead of about 22 min on every gauge, and Point of Rocks, Edwards Ferry and Goose are all "fresh" in it.
- Production today at :00 sees Point of Rocks 66 min old. Production at :10 would see it about 11 min old. The existing replay corresponds to neither. It is a better-than-fresh arm.
- Consequence, stated as an assumption to confirm in the run: the published `EMPIRICAL_CI_90` table (126,916-row replay, v36.1) was derived under an input-age assumption production did not meet. Production's corrected errors are probably wider than the table in rising and falling states. Section 6 of the results will say by how much (L versus F, in flow bin × state cells).
- The existing replay is also not fully production-faithful. Check 3 has no temperature gate, and Check 5 still hard-flags z > 3 (harness header lines 1-8; shared `isIcePlausible` is `model.js:159`, `classifyOutlier` is `model.js:819`). The replay also has hourly rather than 15-minute history, and the single-slot mode ignores production's cron minute.

## 1. Research questions

- **Q1.** Steady-state accuracy of the CORRECTED estimate, lagged (L) versus fresh (F), each arm learning its own 18 EMA bins from the first row.
- **Q2.** The same for the RAW estimate (`rawFinalCFS`), uncorrected.
- **Q3.** Transient: bins learned under L, inputs switch to fresh at a switch date S, learning continues. Size, sign and duration of the excess error, overall and in rising, falling and steady states.
- **Q4.** How often and when flow state and flow bin differ between L and F at the same timestamp. `getFlowState` (`model.js:466`) uses the newest reading against the last one at or before 6 h back. In the replay this is a 5 h span in L and 6 h in F (production: 4.9 versus 5.8 h). The classification and bin depend on inputs only, not on learned bins, so Q4 is computed without any learning.
- **Q5.** Which lag drives the effect. Arms: L0 (all lagged), A1 (Point of Rocks fresh), A2 (Point of Rocks and Edwards Ferry fresh), F (all three fresh), plus EF-only-fresh and Goose-only-fresh as single-gauge controls.

## 2. Arms and construction

- **Lag operator.** The lag is applied by TIMESTAMP (row at t−1 h), not row index, because of the 262 gaps. Lagged arm at row t: `por.q`, Edwards Ferry stage and Goose flow are the values at t−1 h; Point of Rocks water temperature moves with Point of Rocks (same station and batch; assumption). Missing at t−1 h means null, exactly as production treats a missing reading (no prediction without Point of Rocks, Edwards Ferry dropped to Point of Rocks only, Goose falls back to `TRIB_FALLBACK`).
- **Never shifted:** Little Falls flow and stage (truth, the 120% cap), Monocacy, Seneca, Broad Run (production reads them fresh), the sim clock, the validation due time.
- **History.** The rolling Point of Rocks history for the lagged arm contains rows up to t−1 h only. The first 72 h of the run are burn-in for both arms.
- **Validation inputs.** At validation, EF (Check 1) follows the arm. LF actual and LF stage never lag.
- **Missing and gap rows.** Not imputed and not dropped. Each row of each arm gets a status (predicted, no_por, no_lf, and so on) in a row-level file. Row counts are reported at each step.
- **Ice and cold water.** The CSV already drops `-999999` and has no qualifier, so ice periods appear as gaps. They are handled as production does: missing input, the (rewired) ice-plausibility gate, cold-water EF coefficients.
- **What "one hour" approximates.** Real lags are 66 and 76 min versus 11 and 21 min fresh, a 55 to 55 min difference. The replay's difference is exactly 60 min on hour-median data, so effect sizes are about 9% too large (scale 55/60) by first-order reasoning. Absolute ages are about 30 min too fresh in both arms because of the look-ahead in section 0. Hourly data cannot resolve more. Optional phase 2, only if the verdict is borderline: re-fetch 15-minute readings around about 10 floods and use realistic ages.
- **Gate rewire (builder task, required before any run).** Wire `isIcePlausible` and `classifyOutlier` into `scoreAnomalies`. Regression test first: with no lag and the OLD gate the modified harness must reproduce `ci_residuals_v361_multi.csv` and `_single.csv` byte for byte.

## 3. Transient design (rules fixed now)

- **Switch dates.** (a) Fixed: 1 Jan of 2013, 2015, 2017, 2019, 2021, 2023, 2025. (b) Flood-linked: events defined on the hourly Little Falls series as the first hour LF ≥ 50,000 cfs after at least 168 h below it. I counted 40 such events (2011-12-09 to 2025-05-15; 2,672 hours ≥ 50,000). S = 48 h before the event's first hour. Events in the first 12 months are excluded (bin burn-in). Fixed dates sit at an arbitrary phase and show the average transient; flood dates show the worst case.
- **Comparison arms per switch date.** S-arm (lagged until S, fresh after), F (fresh from start, own bins), L (lagged throughout, own bins). The S-arm is the lagged replay branched at S (snapshot the bins) and run to S + 30 days.
- **Excess error.** For each S-arm validation, excess = |err_S| − |err_F| (cost versus the fully re-learned state) and a second series |err_S| − |err_L| (realized change versus staying put). Indexed by k = number of kept validations since S that landed in the prediction's own (flowBin, flowState) cell (re-learning is per cell), and separately by calendar hours since S. Reported by state.
- **Production rhythm.** Run in both modes. Multi mode (every hour validated) gives power. Single mode (one pending slot, lines 237, 244) gives the transient duration in production's pace, about 2 validations a day (as the audit states), which is the number the owner cares about.

## 4. Evaluation

- **Metric.** Percent error against Little Falls at validation, (estimate − actual)/actual. Signed and absolute, median and mean, per flow bin (6) × flow state (3) cell, as production defines them; share inside the displayed 90% band (`EMPIRICAL_CI_90`; hits counted with the existing table, then re-derived per arm); rate of |error| > 25%; hard-flagged observations excluded from scoring as in the v36.1 harness.
- **Scoring population.** Every-hour scoring (multi mode) is the primary sample for Q1, Q2, Q4, Q5. Single mode is used only for Q3 timing and as a production-rhythm check of Q1.
- **Paired comparison.** Pair on predTs. Because travel time depends on rise rate, an arm's validation hour differs between arms. Primary: each arm vs its own truth (mirrors production). Secondary: both arms against the F arm's validation-hour LF value. Only predTs present in both arms are used; unpaired counts are reported.
- **Uncertainty.** Block bootstrap, 10,000 resamples, calendar-month blocks (residuals and bin state are correlated over travel time up to about 50 h, validation lags and EMA memory of days; a month is much longer). For rising-state and flood subsets use rise-event blocks (an event = start of a rising spell through 48 h after it ends), because those cells are rare and clustered. Switch-date summaries are bootstrapped over switch dates.
- **Subsets.** Rising, falling, steady; each flow bin; floods (LF ≥ 50,000 and ≥ 25,000 cfs); cold water (≤ 10 °C) and ice-plausible months handled by the gate; by era (2011-2018, 2019-2026).

## 5. Decision rule (before any result)

- Primary quantity D = F minus L in median |error| of the corrected estimate, paired, multi mode, with 95% block-bootstrap interval. **Floor = 0.5 percentage points**: Little Falls reports 3 significant figures, so its rounding step reaches 0.3% near 3,000 cfs and 1% at 10,000-10,999 cfs (assumption; check against the data); a gauge-rounding-sized difference is not meaningful.
- **MOVE**: D's upper bound < +0.5 pp; AND rising and falling state D upper bounds < +0.5 pp; AND flood (≥ 50,000) D upper bound < +0.5 pp; AND |>25%| rate increase < 1 pp; AND in the transient (mean over switch dates) excess |error| in the rising state ≤ 3 pp for the first 3 cell validations and ≤ 0.5 pp by the 6th (single mode).
- **MOVE WITH SAFEGUARD**: the steady-state conditions hold but the transient excess exceeds those limits, or it is positive-signed (over-prediction) at floods. Candidate safeguards (named, not designed): reset or damp the rising and falling bins at the changeover; a temporary higher alpha; a shadow log; a dated first-rise check.
- **DO NOT MOVE**: D's lower bound > +0.5 pp (fresh worse) overall or in rising, falling or flood subsets, or the large-miss rate rises by more than 1 pp.
- **INCONCLUSIVE**: the interval spans both −0.5 and +0.5 pp on D in rising or flood subsets. Then there is no accuracy case either way; the owner decides on the non-accuracy grounds already in the plan (late-batch misses at minute 5) and the dated first-rise check stays.

## 6. Expected outcomes (stated now)

- Raw model (Q2): F shows a positive shift versus L on rises (audit finding 3: about +2.6% at +5 %/h, about +9% at +15 %/h; about −0.8% on a recession at −2 %/h; about 0 steady). These are first-order and mostly in the 5% delta-correction gate (`scheduled-update.js:1010-1020`; `appliedRatio` at about 1020-1025).
- Corrected steady state (Q1): each arm's bins absorb its own mean bias, so overall median |error| differs by < 0.5 pp (the floor); the gain appears as a smaller spread and lower |>25%| rate in rising and falling cells.
- Q3: the S-arm over-predicts in rising cells right after S by about the Q2 shift (+2.6% typical, up to +9%), then decays as 0.7^n (about 34% left after 3, 12% after 6 validations). In calendar time that is several rise events under single mode.
- Q4: assumption: flow state differs at 3 to 8% of hours (mostly steady versus rising/falling, F leading by about 1 h). Of the hourly 1-hour Point of Rocks changes, 1,576 of 123,616 are ≥ +5% and 176 are ≥ +15%, so the effect lives in about 1.3% of hours.
- Q5: Point of Rocks dominates; Edwards Ferry adds only above about 10,000 cfs (blend weight up to 0.4); Goose is negligible (3% tributary).
- Against the existing CI table: L is wider than F in rising and falling cells.

## 7. Verification (CLAUDE.md "Analysis Verification")

- **Replay runs once, in the existing JavaScript tool.** Reason: it IMPORTS production `makeGFPrediction` and `updateCorrectionBin`, so it tests production code; a Python and an R re-implementation of the full model (travel curves, ensemble, interpolated bins, ceiling) would be two new models that test themselves, and any disagreement would be about the copies. v36.1 handled it the same way (replay once in JS, derivation dual-language). The risks are bugs in the lag construction and the replay harness, covered by: (1) byte-for-byte regression against the existing residual files with the old gate and no lag; (2) determinism (two runs, identical hash); (3) a narrow independent re-computation of the one step this question hinges on, the Point of Rocks delta (`pct`, decay, `appliedRatio`, `porEst`), in Python and R from the trace columns.
- **Lag construction check.** The harness writes per-row files with the exact input values and source timestamps each arm saw. Blind Python and blind R check from these files and the original CSV that every lagged value equals the original at t−1 h (by timestamp), that unshifted columns equal the original, and that row counts reconcile.
- **Metrics and bootstrap.** Computed blind and independently in Python and in R from the replay's output files only. Point estimates (percent) must agree within 0.01. To remove random-number differences the bootstrap block-index matrix is generated once (fixed seed, file `bootstrap_indices.csv`, by a neutral small script) and both languages read it; interval ends then also agree within 0.01.
- **Fail-fast.** Any disagreement above 0.01 stops the work; investigate; never average or pick.
- **Third auditor (Opus, fresh, never ran the analysis).** Checks cross-language agreement, the method against this plan, data integrity, and spot-checks at least 5 observations against the live USGS service `api.waterdata.usgs.gov` (new service; assumption: its continuous collection reaches the cells chosen, otherwise choose dates it covers): LF flow around 2024-01-11 03:00 UTC, Point of Rocks 2018-06-03 07:00, Edwards Ferry stage 2020-12-25 13:00, Goose 2025-05-15 03:00, and Point of Rocks, LF at 2012-03-02 16:00 (each: recompute the hourly median of readings t:00 to t:45 and compare; also confirm the lagged arm's value at those rows equals the hour before).

## 8. Provenance and files

New folder `analysis/replay_lag_2026-11-17/` (dated). Every file has a generating script, and no row is dropped silently.
- `ci_backtest_harness_lag.mjs` (the modified harness; `--lag=none|por|por_ef|all|ef|goose`, `--switch=ISO`, `--mode`).
- `rows_<arm>_<mode>.csv` (one line per sim hour with status and inputs), `resid_<arm>_<mode>.csv` (one line per validated prediction; extra columns versus the old file: `porQ`, `histCfs`, `pct`, `deltaOn`, `rate`, `efW`, `valHoursDelay`, flow state, bin, trace fields), `switch_<S>_<mode>.csv`, `counts_<run>.txt` (row counts per step).
- `metrics_python.csv`, `metrics_R.csv`, `bootstrap_indices.csv`, scripts `metrics_python.py`, `metrics_R.R`, `lagcheck_python.py`, `lagcheck_R.R`.
- `replay_lag_audit.md` (third auditor), `replay_lag_FINAL.md` (verdict).

## 9. Threats to validity

1. **Hourly resolution** and median smoothing: flood onsets are slower in the data than in production, so the rise-rate effect is probably understated (a +15 %/h hour-to-hour change may be steeper at 15 minutes).
2. **Look-ahead of about 22 min in both arms** and a 60 versus 55 min lag difference: effect sizes about 9% too large; both arms too fresh.
3. **Approved versus provisional data**: the CSV holds mostly approved Point of Rocks values (2026 provisional); production saw provisional data, which is revised later, so the replay is cleaner than production.
4. **Replay simplifications**: no `computeRunHealth`, no divergence or residual advisory (they don't feed the estimate), no cron minute, validation at first grid row at or after the due time, multi mode validates every hour (faster re-learning than production's single slot), hourly history, pre-v37.21 and pre-v39.0 gates (fixed by the rewire), tributaries missing in early years use fallback.
5. **Edwards Ferry record**: starts about Dec 2011 with 2,642 missing rows; early cells rely on Point of Rocks only; matters mostly at high flow, so Q5 is least certain for EF.
6. **The browser computes the displayed estimate** from its own fetch (about 35 min old on average) with the server's bins; the replay measures the server estimate only.
7. **Regime change over 15 years** (EF coefficients, tributary gauges, rating shifts): handled by era subsets; switch dates by calendar and flood spread over eras.

## 10. Work breakdown

- Sonnet builder: lag operator, gate rewire, regression and determinism tests, branching switch run, extended output files (about 1 day of agent time; replay runtime unmeasured, about 100 runs expected).
- Two blind Sonnet analysts (Python, R): lag check, metrics, bootstrap (parallel, about half a day each).
- Opus auditor: cross-language, method, data integrity, 5 live spot checks (about half a day).
- Owner sees: one table (D by state with intervals and the decision-rule verdict), one figure (excess |error| by validations since switch, by state, all switch dates plus mean), one recommendation (move, move with safeguard, do not move, or inconclusive).

## 11. Open questions

1. **Gate rewire.** Rewire the old gates to shared helpers (recommended; the regression test protects fidelity) versus keep them for comparability with the published table.
2. **Floor of 0.5 pp.** Recommended; owner may prefer 1 pp (ignoring flow-dependent rounding).
3. **Phase 2 at 15 minutes** around about 10 floods: recommended only if the verdict is borderline or inconclusive.

<!-- Drafted by a Sonnet drafter (read-only) on 2026-11-17; text extracted by script from its final report, not retyped. Owner's decision of 2026-11-17: option C (replay first). -->

---

# Rulings on the plan audit (orchestrator, 2026-11-17)

The audit is `PLAN_AUDIT.md` (one blocker, seven major findings). A ruling wins over the audit; the audit wins
over the plan. No analysis code is written before the owner has confirmed the pre-registration below.

| Finding | Ruling |
|---|---|
| 1 BLOCKER: the byte-for-byte regression against the June residual files cannot pass, because the production model has changed since (v36.4, v37.0, v39.0) | ACCEPTED. A new baseline is frozen from today's unmodified harness (hash recorded); the regression test is "no lag reproduces that baseline". Section 0's framing that this run corrects the published confidence table is withdrawn: that table describes neither current production nor this replay. That is recorded as its own open item (TODO A8), not solved here. |
| 2 The old outlier gate excludes predictions depending on each arm's own error (9.5% of predictions in multi mode), which removes the large flood misses from scoring | ACCEPTED. Gates are rewired to the shared production helpers first and used for every arm. Excluded from scoring: only the truth-dependent checks (Checks 2 and 3), computed once and applied identically to both arms. Old-gate results appear in an appendix only. |
| 3 The fresh arm would see about 22 minutes into the future | ACCEPTED. Primary arms: **F = row t-1, L = row t-2** for Point of Rocks (with its temperature), Edwards Ferry and Goose; Little Falls inputs (multiplier, cap, fallback) = row t-1 in both arms; history truncated at each arm's newest row. Both arms are then about 30 minutes staler than production with a 60 minute gap between them (production: 55), the conservative direction. A missing reading is replaced by the last available row at or before the lag, as production does, and its age is logged. Sensitivity run: the plan's original t / t-1. |
| 4 When the truth is read | ACCEPTED. Truth = Little Falls interpolated linearly between the hourly medians (each placed at its hour start plus 22.5 min) at the production validation instant, defined identically for both arms as the first whole hour at or after the due time, minus 11 minutes. If a neighbouring row is missing, the nearest row within one hour is used; otherwise no validation, and that is counted. |
| 5 Newest reading versus stored history | Confirmed faithful; the lag check asserts that `por.q` equals the last history entry. |
| 6 The primary endpoint was diluted | ACCEPTED. See the pre-registration. "Affected" is defined from inputs only: the two arms' raw estimates differ by at least 1%, or their flow state or flow bin differ. |
| 7 The estimand | ACCEPTED. One hybrid mode: the bins learn at production's single-slot rhythm, and a non-learning shadow prediction is scored every hour with the bins as they then stand, paired across arms by prediction time. |
| 8 The transient can be derived without branched runs | ACCEPTED. Both arms log their bins after every update; the offset after a switch at date S is (EMA_L(S) - EMA_F(S)) x 0.7^n per cell, evaluated at every date. Three dates are branched and replayed as a check of that formula (clamp episodes are the known exception). Flood anchor: S = 24 hours before the first hour in which Point of Rocks rises by at least 2 %/h ahead of each flood event; each is followed until six validations in the cell. |
| 9 The decision rule | ACCEPTED as rewritten in the pre-registration: it covers every outcome, the floor is stated as a practical choice (the rounding argument was wrong, since rounding of the truth cancels in a paired difference), and one transient condition replaces two. |
| 10 Data | Row counts by era are reported; the low coverage of water temperature (34.8%) and the absence of qualifiers are stated as limits. |
| 11 Verification | As planned (replay once in JavaScript with the production code; lag check, metrics and bootstrap blind in Python and in R; a third auditor), plus a spot check at a flood onset. R 4.x and Python 3 are available on this machine. |
| 12 Scope | Q5 (which gauge drives the effect) and the 15-minute phase 2 are optional and not part of the first delivery. Stage 1: Q4 and Q2 (no learning) and the bin trajectories of the two arms. Stage 2: the scored comparison and the transient. |

## Pre-registration (to be confirmed by the owner before any code)

- **Arms:** F = inputs from row t-1; L = Point of Rocks (with its temperature), Edwards Ferry and Goose from row t-2, everything else as F. Gates rewired. Hybrid mode.
- **Truth:** Little Falls interpolated at the production validation instant, same rule for both arms.
- **Primary measure:** mean of the paired differences in absolute percent error of the corrected estimate, F minus L, over affected predictions in which at least one arm's flow state is rising. Negative means fresh is better. 95% interval from a block bootstrap with calendar-month blocks, 10,000 resamples.
- **Reported alongside, not part of the rule except where named:** all affected predictions; falling state; floods (Little Falls at validation at least 50,000 cfs); the raw estimate; the share of misses beyond 25% in the rising state; how often state or bin differ.
- **Rule:**
  - MOVE if the primary interval's upper end is below +0.5 percentage points AND the flood interval's upper end is below +1 point.
  - DO NOT MOVE if the primary interval's lower end is above +0.5 points.
  - MOVE WITH A SAFEGUARD if MOVE holds but the offset at the first rising validation after a switch exceeds 3 points at the median flood onset.
  - INCONCLUSIVE otherwise; the owner then decides on the other grounds (late-batch misses), and the check at the first real rise stays.
- **Floor of 0.5 points:** a practical choice, smaller than any difference a user could notice on screen.

**Owner's confirmation: 2026-11-17, 23:2x UTC ("confirm").** The pre-registration above is frozen from this point;
it is not adjusted after results are seen.

Implementation details fixed at the same time, before any code (orchestrator):
- A paired prediction is excluded from scoring when a truth-dependent check (Check 2 or 3) fires for it in EITHER arm; the count is reported.
- Branched check dates for the transient formula: 2015-01-01, 2019-01-01, 2023-01-01 (00:00 UTC), each followed for 60 days.
- Flood events and switch anchors are computed independently by the Python and the R analyst from the data file, by the rule in ruling 8; the replay builder does not compute them.
- The builder of the replay tool reports row counts and statuses only. It does not compute, print or look at any comparison of errors between the arms; that is done blind by the two analysts.

---

# After the tool audit (orchestrator, 2026-11-18 UTC, before any result was computed)

The replay tool was built by a Sonnet builder and audited by a fresh Opus auditor (`TOOL_AUDIT.md`): no bug in the
mechanics; regression, determinism, the lag operator (0 mismatches on 2,000 random rows per arm plus one full
year), the truth rule, bin bookkeeping, gates and switch runs all check out. The builder reported three blindness
slips (counts of fired checks, three lines of one bins file), none a comparison between arms.

Rules written down now, as the auditor required before analysis (all operational in `ANALYSIS_SPEC.md`):
- **Affected:** |raw_F - raw_L| / raw_L >= 1%, or flow state differs, or flow bin differs.
- **Flood:** truth flow at least 50,000 cfs in either arm. **The flood quantity used by the decision rule is taken
  over affected flood pairs**; the figure over all flood pairs is reported beside it.
- **Excluded from scoring:** the first 72 hours; pairs with a truth-dependent hard flag in either arm; pairs whose
  truth lies outside the range production validates (500 to 500,000 cfs) in either arm.
- **Bootstrap:** month = UTC month of the prediction time; a drawn month without pairs contributes nothing; the
  statistic is the pooled mean; percentiles by linear interpolation.
- **Transient:** rise start = the earliest hour in the 168 hours before a flood event in which Point of Rocks rose
  by at least 2% in one hour; switch anchor 24 hours before it; offset at the first rising prediction after the
  anchor = (EMA of the lagged arm - EMA of the fresh arm) for that cell, as a percent of the raw estimate; the
  decision rule compares the MEDIAN ABSOLUTE offset over events with 3 points.

Limitations accepted without a re-run: (1) a bin updated at hour T with truth read 11 minutes before T is applied
to the prediction at T, a look-ahead of at most one hour through the bins, identical in every arm; (2) water
temperature is filled from up to 48 hours back where production uses 24 (27 and 28 predictions affected);
(3) the regression test covers the original code path only; the hybrid path was verified by the auditor's
independent recomputation; (4) ice periods are gaps in the data, not replayed as ice.

The large output files (574 MB) are not stored in the repository; `README.md` holds their SHA-256 hashes and
`run_all.sh` regenerates them byte for byte.

# Independent audit of the replay tool (before any analysis)

Auditor: a fresh subagent (Opus) that did not build the tool, read-only, blind to error comparisons, 2026-11-17. Text extracted by script from the auditor's final report, not retyped.

## Audit of the replay-lag tool (analysis/replay_lag_2026-11-17/)

I found no bugs in the tool's mechanics. What remains: four analysis rules the analysts need written down beforehand, plus small fidelity gaps. I made no comparison of errors between arms. All scratch work is in /private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/audit5/ (check.py, bincheck.mjs, gatecheck.mjs, sw.mjs).

### Checks that passed (with counts)
- **Regression:** I ran the unmodified `analysis/ci_backtest_harness.mjs` myself into scratch, and also `--arm=orig --gate=old`. Both give SHA-256 equal to the baseline (multi 9f970983…, single e265dbd2…). The console output is identical apart from the file name. `git diff HEAD` shows no change to the original tool, `netlify/` or the data file (hash b247c0be… unchanged).
- **Determinism:** I re-ran F, L and switch 2019 into scratch. Shadow, learn, bins and switch files are byte-identical to the shipped ones. There is no `Math.random` and no module-level model state; each arm runs in its own process. `selftest.mjs`: 51/51 pass.
- **Lag operator:** Checked on 2,000 random rows per arm (F, L, F0, L0), plus all 10,610 rows of 2015 in F and L (gap and blank-adjacent year). All 9 channels: value, source timestamp and age match my own timestamp-based recomputation with a 48 h fill window counted from t. **0 mismatches.**
  - Status `no_por`/`no_lf` logic: correct.
  - `histLastTs` equals `porSrcTs`, and `histLen` equals the count of PoR rows in [t−72h, newest]: correct. The assertion is at line 586; the history comes from `S.porObjs` (hour-start stamps).
  - The clock, due time and truth are not shifted. The model looks up history relative to the clock (`Date.now`), as production does.
- **Truth:** ~1,410 rows per arm (500 random plus every `no_truth` row). `dueTs`, `valHourTs`, `tauTs`, `truthFlow`, `truthStage`, `truthInProdRange`, the errors and `valEfStage` all match, **0 mismatches**. Truth reads `S.lf.map` only, so it depends on the arm only through the due time.
- **Bins:** 300 rows per arm (100 of them in the first 3 months, where the fallback is active). `correctionApplied` and `predictedCFS` (including the 120% cap) match production's correction functions within rounding. `learn_*` matches `bins_*` row for row, and the EMA recurrence is exact.
  - The slot never overlaps.
  - `hard_skipped` happens only when `truthDependentHard=1` (new gate).
  - 24–27 learn rows were validated later than their shadow row: these are legitimate retries.
- **Gates:** 400 rows each for F-new, L-new, L0-new and F-old (half of them rows where a check fired). All five check flags, hard, soft and z match an independent recomputation, with Check 5 rebuilt from the learn file. The new gate matches production lines 1258–1340.
- **Switch runs:** 1,441 rows each, `inputArm=F` throughout. All inputs, raw estimate, state, bin, due time and truth equal `shadow_F` exactly. The first correction at S equals the `bins_L` state, so bins are carried over. The row at S uses F inputs consistently.
- **Accounting:** one row per hour, contiguous from the first to the last data hour. Statuses sum to 127,463. Blank-column rules hold.
- **Bootstrap:** 10,000 × 175, labels valid, drawn with replacement, mulberry32 with seed 20261117 documented. All 175 months contain predicted rows in F and L.

### Findings
1. **MAJOR (write down before analysis): flood subset and "affected".** The arms have different validation hours and truths, so "LF at validation ≥ 50,000" is ambiguous. The "raw estimates differ by ≥1%" test also has no stated denominator. Fix: write into PLAN.md, for example flood = `truthFlow` ≥ 50,000 in either arm, and affected = |rawF − rawL| / rawL ≥ 0.01.
2. **MAJOR (write down): rows with truth outside 500–500,000 cfs.** 41 rows per arm have `truthInProdRange=0` but carry errors. Production never validates these. Fix: exclude them, and say so.
3. **MAJOR (write down): the 72 h burn-in is not marked.** PLAN §2 requires it. Fix: drop rows with `predTs` < 2011-12-04T05:00Z.
4. **MINOR: one-hour look-ahead through the bins.** Learning at hour T uses truth at T−11 min, interpolated from row T (readings T to T+59 min). The prediction at T then applies that bin. The leak is at most 0.44 × α 0.3 of one residual. It occurs in the same way in every arm, on ~23.3k learning validations. Fix: make each bin update visible from T+1 h, or disclose it.
5. **MINOR: temperature fill window.** Production's temperature fetch uses a 1-day window (P1D, `scheduled-update.js` lines 304–307), not 48 h. The README's "every channel incl. temperature" is therefore wrong for temperature. This affects 27 (F) and 28 (L) predicted rows. Fix: use 24 h for temperature, or disclose.
6. **MINOR: the regression test covers only `runOrig` (lines 228–340).** That is a separate code path, so the test says nothing about the hybrid path. My checks above cover that path instead.
7. **MINOR: stale filled inputs.** 1,382 (F) and 1,663 (L) predicted rows use a PoR reading older than 3 h. This comes from the 48 h fill and the 547 simulated hours with no data row. It is faithful to production but clusters at gaps. Fix: add a sensitivity check that excludes rows whose age exceeds the nominal lag in either arm.
8. **MINOR: empty months in the bootstrap.** The month list covers all rows, but the scored subset (affected and rising) will have empty months. Fix: state that the month = UTC month of `predTs`, a drawn empty month contributes zero pairs, and the statistic is the pooled mean.
9. **MINOR: old-gate appendix inputs.** It uses the arm-lagged Edwards Ferry stage and temperature for Checks 1 and 3; the original tool used the same row. Appendix only; disclose.
10. **MINOR: Checks 1 and 3 use each arm's own lagged Edwards Ferry stage and temperature.** That is what production would do under that arm. `truthDependentHard` can therefore differ between arms, through temperature and through the validation hour. Excluding a pair when either arm is flagged handles this, and the exclusion set never depends on prediction error. No leak.
11. **Note:** `regress.sh` and `determinism.sh` write `tmp_*` folders inside the repository folder. I reproduced both in scratch instead.

### Instructions the analysts need
- **Pairing:** key = `predTs`; keep rows where `status=="predicted"` in both arms. The F file is `shadow_F.csv`, the L file `shadow_L.csv`.
- **Measures:** `errPctCorr` (primary), `errPctRaw` (raw). Both are in percent.
- **Exclusions:**
  - `truthDependentHard==1` in either arm. Never use `hardFlag` (under `_gateold` it includes Check 5), `softFlag`, `chk4` or `chk5`.
  - `truthInProdRange==0` in either arm, and burn-in, as written down per findings 2 and 3.
  - Report the count for each exclusion.
- **State, bin and estimate columns:** `flowState` (`rising`/`steady`/`falling`), `flowBin`, `rawFinalCFS`.
- **Status traps:**
  - `no_truth` rows carry estimates but blank truth; `statusDetail=drain_end` marks rows whose validation hour fell beyond the end of the run.
  - Ages are measured from hour starts (F is 1 h, L is 2 h nominal).
- **Bins:** the state at time t = the last row with `ts` ≤ t, inclusive.
- **Switch files:** `arm` is `L>F`; there are no learn or bins files.
- **Format:** booleans are 1/0; `appliedRatio` is blank when the delta gate is off; CSVs are unquoted; ISO times end in `.000Z`.
- **Bootstrap:** map each pair by `predTs[:7]` to the labels in `bootstrap_indices.csv` (columns `m1`…`m175`).

### Verdict
Yes, the blind analyses may start on these files as they are, once findings 1–3 (and the rule in 8) are written into PLAN.md first. No regeneration is needed. Fixing findings 4 and 5 would need a re-run; otherwise both go into the limitations.

# Independent plan audit: replay analysis for Step 3

Auditor: a fresh subagent (Opus) that did not write the plan, read-only, 2026-11-17. Text extracted by script from the auditor's final report, not retyped.

## Audit: `analysis/replay_lag_2026-11-17/PLAN.md`

What I ran: the unmodified harness in both modes, writing only to `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/audit4/`. Each mode took under a second. I also ran Python one-liners over the CSV and made 2 keyless USGS GETs.

### Findings

**1. BLOCKER: the byte-for-byte regression cannot pass, even before any change.**
- Today's unmodified harness already differs from `ci_residuals_v361_single.csv` at line 580 and from `_multi.csv` at line 86.
- Multi mode gives 110,548 rows against the file's 110,290, and 7,348 predTs lines differ.
- Cause: the production model has changed since the files were written in June (v36.4 travel iteration, v37.0 interpolation, v39.0 clamp).
- Fix: freeze a new baseline from today's unmodified harness (record the hash). The regression test is then "lag=none reproduces that baseline".
- Also drop the framing in §0 that this run corrects the published table. That table already describes neither current production nor this replay.

**2. MAJOR: the old gate excludes errors depending on the outcome, so the gate rewire belongs in scope.**
- Hard-skipped predictions: 11,627 of 122,544 in multi mode (9.5%) and 1,615 of 23,182 in single mode. Most come from Check 5 (z > 3), which depends on each arm's own error and bins.
- This removes the large flood misses. Flood big-miss rate in single mode is 0.0%.
- Fix: rewire the gates first and use that for every arm. Exclude from scoring only Checks 2 and 3, which depend on the truth alone. Compute that exclusion set once and apply it to both arms. Show old-gate results in an appendix only.

**3. MAJOR: the fresh arm sees the future.**
- The §0 facts are right: the generator stores hourly medians keyed by hour start (lines 151-169), and the harness feeds row t at time t (158-169, 194).
- Live checks:
  - Little Falls 2012-03-02 16:00: readings 49,000 / 50,000 / 50,600 / 51,200 give a CSV value of 50,300, which is 2.7% above the :00 reading at a flood onset.
  - Point of Rocks 2018-06-03 07:00: readings 46,100 to 46,400 give 46,250. Both match the CSV.
- Row k represents roughly k + 22.5 min. Input ages, plan versus production:

| Arm | Plan's row | Age in the replay | Age in production |
|---|---|---|---|
| Fresh (F) | t | −22 min (future) | 11 min |
| Lagged (L) | t − 1 | +38 min | 66 min |

- Future information favours exactly the arm being tested, on rises.
- Primary arms instead: F = row t−1, L = row t−2. Little Falls inputs (`mult`, cap, fallback) = row t−1 in both arms. History is truncated at each arm's newest row. This keeps a 60-min gap (production: 55) and makes both arms about 30 min staler than production, which is the conservative direction. Keep the plan's t / t−1 as a sensitivity run.
- §2 is wrong that "missing means null, as production does". Production uses the last valid value in the 2-day window, whatever its age (`scheduled-update.js:398-417`). Use the last available row at or before the lag, and log its age.

**4. MAJOR: when the truth is read.**
- The replay validates at the first row at or after the due time, valued at about +22.5 min. On average that is about 52 min after due; production is about 20 min.
- When Little Falls is rising, its next-hour change has a median of 1.97% (n = 19,381). That gives about 1% truth bias on rises.
- There is also grid noise: travel time differs between arms, so their due times land on different rows.
- Fix: set the truth to Little Falls interpolated at each arm's production validation instant. Using later readings is harmless for the truth.

**5. OK: newest reading versus stored history.**
- `por.q` feeds `pct` / `appliedRatio` (1010-1020) and `getFlowState` (1052).
- The last history entry feeds the rise rate (`model.js:528`).
- The historic lookup is tied to the clock (`selectHistoricReading` at now − travel). Truncating history moves it only through travel time.
- The decay factor is pinned near the 0.5 cap.
- The plan's operator is faithful. Assert in the lag check that `por.q` equals the last history entry.
- Note the flow-state span: 5 vs 6 h here (4 vs 5 with my arms), against production's 4.9 vs 5.8 h.

**6. MAJOR: the primary endpoint is diluted, and "1.3% of hours" is wrong.**
- First-order shift in the Point of Rocks estimate between arms: above 1% in 12.7% of hours, above 2% in 8.2%, above 5% in 0.5%.
- Much of this is the ±5% gate switching between arms (a step of about 2.5%). The gate is on in 50% of hours.
- The median shift is 0, so median |error| over all hours gives D ≈ 0 by construction.
- Fix: as primary, take the paired mean |%err| difference over "affected" predictions. Define these from inputs only, before any outcome: raw estimates differ by at least 1%, or flow state or bin differ. Report the rising state separately.
- §5 should say "median of paired differences" or "difference of medians". It is ambiguous now.

**7. MAJOR: the estimand.**
- Multi mode learns every hour. With alpha 0.3 the bins remember about 3 hours, so they re-learn within one event and the transient disappears.
- Single mode makes about 4.1 validations a day (21,477 in 14.5 years), not 2. It has 4,204 rising validations in total.
- Single-mode arms cannot be paired: their slot times drift apart.
- Fix: one hybrid mode. Learn at production's single-slot rhythm, and score a non-learning shadow prediction every hour with the current bins, paired by predTs.

**8. MAJOR: the transient can be computed, without branched runs.**
- The raw estimate does not depend on the bins, so after the switch the S-arm sees exactly the F arm's errors.
- Its bin offset is therefore (EMA_L(S) − EMA_F(S)) · 0.7^n, apart from clamp episodes (`model.js:775-794`).
- Log both arms' bins after every update, and derive the transient at every date. Branch only about 3 dates as a check.
- The flood anchor is too close:
  - The first Point of Rocks hour rising ≥ 2 %/h comes a median 42 h before Little Falls reaches 50,000 cfs (10th percentile 20 h, 90th 84 h).
  - With S = 48 h before, the switch falls after the rise has started in about 40% of events.
  - Anchor S 24 h before the first rising hour at Point of Rocks instead. Follow each date until k = 6, not 30 days.

**9. MAJOR: the decision rule.**
- (a) It does not cover all outcomes. An overall D interval of [+0.1, +0.8] fits no verdict.
- (b) DO NOT MOVE fires on any one of 4 subsets, which inflates false alarms.
- (c) The flood subset has 2,407 validations in about 40 blocks. An upper bound below 0.5 pp is unlikely there, so MOVE is almost unreachable.
- (d) The rounding argument for the floor is wrong. Both arms are scored against the same truth reading, so its rounding cancels in a paired difference. Measured Little Falls rounding steps: 10 cfs at 2,000-4,000 cfs, 100 cfs at 10,000-11,000 cfs. The floor must be a practical choice.
- (e) A 1 pp large-miss limit is loose: the baseline is 0.32% (single) and 0.66% (multi). Make it relative, in the rising state.
- (f) The two transient limits are the same condition: under 0.7^n, 3 × 0.7^5 = 0.50. Keep one.

**10. MINOR: data.**
- The 262 gaps cover 547 missing hours.
- Edwards Ferry coverage is 81% in 2023.
- Water temperature is only 34.8% present, so the cold-water coefficients and the ice gate mostly use the month rule.
- There are no qualifiers, so ice and equipment-affected values enter as numbers.
- The data ends 2026-06-16. Report row counts by era.

**11. MINOR: verification.**
- Running the replay once in JavaScript, with the lag check, metrics and bootstrap done blind in Python and R, matches the v36.1 precedent. Acceptable.
- The new USGS service reaches back to 2012: both GETs matched the CSV exactly.
- Add a spot check at a flood onset.

**12. MINOR: scope.**
- Compute is trivial; the cost is the verification steps.
- Q5 and phase 2 are optional.
- A cheaper first stage: Q4 and Q2 (no learning) plus the bin-difference trajectory from 2 runs.

### Pre-register this
- **Arms:** F = row t−1; L = row t−2 (Point of Rocks with its temperature, Edwards Ferry, Goose); Little Falls inputs = row t−1 in both; gates rewired; hybrid mode. Sensitivity run: the plan's t / t−1.
- **Truth:** Little Falls interpolated at the production validation instant.
- **Primary endpoint:** paired mean |%err| of the corrected estimate, F − L, on input-defined affected predictions, rising state. Month blocks, 10,000 resamples.
- **Rule (all outcomes covered):**
  - MOVE if the primary upper bound is below +0.5 pp and the flood upper bound is below +1 pp.
  - DO NOT MOVE if the primary lower bound is above +0.5 pp.
  - MOVE WITH SAFEGUARD if MOVE holds but the k = 1 rising offset is above 3 pp at the median flood onset.
  - INCONCLUSIVE otherwise.

### Verdict
Do not write analysis code yet. The plan first needs findings 1, 2, 3, 6, 7 and 9 fixed; 4 and 8 are strongly recommended. After that and the orchestrator's rulings, building can start.

### Not checked
- Production bin values and `tick_log`.
- Whether R is available.
- How often flow state differs between arms (needs code changes).
- Little Falls, Edwards Ferry and Goose readings older than the 2 spot checks.

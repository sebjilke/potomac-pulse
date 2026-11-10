# Check 5 becomes a soft flag ("always-soft", option A) — plan

Date: 2026-11-09. Status: DRAFT, awaiting independent plan audit.
Decision: the user chose option A on 2026-11-09 from the "Open decision" section of
`analysis/anomaly-gate-rework-plan-2026-11-09.md` (read that file first: evidence, the first plan
audit's 15 findings, and why the 25 % hard-tier design was abandoned).
Proposed version: **v39.0 (MAJOR)** — reverses the v33.0 decision that made statistical outliers
hard flags (v33.0 and v34.0, the previous changes to learning admission, were MAJOR; "v38" is
skipped because the docs already use it for the failed estimator gate). Version level is the
user's to overrule before push.

## Change

Check 5 (`STATISTICAL_OUTLIER`) never hard-flags. A z > 3 observation takes the EXISTING soft-flag
path: learned through `updateCorrectionBin(binData, errorCFS, true)` (EMA step clamped to ±2 sd
around the EMA; lifetime sums take the raw value), counted in accuracy, written to validation
history, scored on the shadow leaderboard, stage bin learned with its own clamp.
Hard flags go back to meaning what the docs say: physical data corruption (Checks 2 and 3 only).

1. `netlify/functions/shared/model.js`: new pure helper
   `classifyOutlier(binData, errorCFS)` → `{ zScore: number|null, isOutlier: boolean }`
   - `binData.count < 10` → `{null, false}` (unchanged gate)
   - `sd = sqrt(max(0, sumErrorSq/count − meanError²))`; `!(sd > 0)` (zero, NaN, missing stats)
     → `{null, false}` (unchanged: the current code's `stdDev > 0` test already yields no flag)
   - `center = binData.emaMeanError ?? binData.meanError` — the SAME expression
     `updateCorrectionBin` clamps around (was: lifetime `meanError`)
   - `z = |errorCFS − center| / sd`; `isOutlier = z > OUTLIER.zThreshold` (3, strict, unchanged)
   - Note recorded in a comment: z mixes an EMA centre with an sd taken around the lifetime mean,
     which inflates z when the two diverge; this is consistent with the existing clamp.
   - `OUTLIER = { zThreshold: 3 }`. Export both.
2. `netlify/functions/scheduled-update.js`, Check 5 call site: on `isOutlier`,
   `softScore += 2` (was `hardScore += 2`) and push `OUTLIER_SOFT:z=<z.toFixed(1)>` (NEW string —
   `STATISTICAL_OUTLIER` keeps meaning "hard, mean-centred, pre-v39.0" in historical rows).
3. Persisted trace (additive metadata, so production behaviour can be verified):
   `softOutlierValidations` (counter), `lastSoftOutlier` (ISO time), `lastSoftOutlierReason`
   (the flag string). Written where the other flag counters are written. Also stamp
   `outlierZ` (number, one decimal) on the validation-history entry for soft outliers only.
4. `gateVersion` on `validation_failure` rows becomes `'v39.0'`.

## Not changed

Estimator, weights, correction formula and application, client model code, bin schema,
`updateCorrectionBin` itself, Checks 1–4, the claim-before-learn order, the v37.20
bin-read-failure guard (a failed read still skips learning AND accuracy before Check 5 matters),
the LF-residual advisory rule (it already consumes both paths).

## Consequences (to be stated in the changelog)

- No lockout is possible: every vetted observation moves its bin, by at most
  0.3 × 2 sd_post per observation (sd_post = sd after the observation's raw value enters the
  lifetime sums, as `updateCorrectionBin` computes it).
- Local-runoff misses now enter learning (clamped) and the headline. Example scale: the
  2026-10-12 miss (raw −70 %) in `0-3000_rising` (sd ≈ 394–436 cfs) would move that bin's EMA by
  up to ≈ 0.6 sd ≈ 250 cfs toward "model under-reads", decaying with the EMA's ~3-observation memory.
  That is real, bounded contamination; it is the accepted cost of option A.
- The headline accuracy will read worse for the same model: observations that were dropped
  (39 of 54 logged hard flags since 2026-06-22 were Check 5) are now counted. No reset. The
  hollow-ring markers in the 7-day chart will become solid points for these.
- Lifetime sd only ratchets up (stats are lifetime, not windowed), so clamp width — and the
  maximum single step — grows over time. Watch item, not fixed here.
- The stale `6000-12000_falling` (+401) and `12000-25000_falling` bins unlock on their next visit.
  Not hand-edited.
- Stage bins and `stageObsClean` now receive these observations too (same widened admission).
- `EMPIRICAL_CI_90` (v36.1) and every analysis harness were derived under the old gate: harness
  headers updated to say they replay pre-v39.0 gates; CI-band provenance gap filed in TODO.

## Tests

Unit (`test/anomaly-gates.test.mjs`, pure helper):
count 9 → not outlier; sd 0 → no; missing `sumErrorSq` / NaN stats → `{null,false}`; z exactly 3 →
no; z just over 3 → yes; centre is the EMA (bin where mean-centred z > 3 but EMA-centred z < 3, and
the reverse); `emaMeanError` undefined → falls back to mean; `emaMeanError === 0` honoured (`??`).

Replay (provenance: fixture produced by a committed script
`analysis/fetch_outlier_replay_fixture.mjs` that pulls `validation_failure` rows from the public
`/api/sync?endpoint=validation-failures` endpoint and writes `test/fixtures/outlier-replay-2026-10.json`):
- the ten 2026-10-16→18 `6000-12000_falling` rows against the frozen bin
  (count 17, meanError ≈ 231, emaMeanError ≈ 401, sd ≈ 174): every row `isOutlier` under the EMA centre;
- fed sequentially through `updateCorrectionBin(…, true)`: EMA strictly decreases from +401 on every
  step, each step ≤ 0.6 × sd_post, sd grows, and later rows may stop being outliers (assert
  monotone EMA and bounded step, not "always outlier").

Integration (`validatePendingPredictions`, existing mock-client patterns):
- z > 3 observation → NOT hard-flagged: correction bin written with a clamped EMA, stage bin
  written, validation-history entry written carrying `outlierZ`, `softFlaggedValidations` +1,
  `softOutlierValidations` +1, `lastSoftOutlierReason` set, `hardFlaggedValidations` unchanged,
  NO `validation_failure` row, accuracy sums include it.
- soft outlier + EF_DISCREPANCY together → still soft, `softFlaggedValidations` +1 exactly once.
- outlier + cold Check 3 (temp 1 °C, < 1,500 cfs, stage > 2.45) → hard (Check 3), one failure row
  with `gateVersion 'v39.0'`, no bin write.
- outlier + Check 2 (stage-discharge) in warm water → hard, failure row.
- bin-read failure → unchanged v37.20 behaviour (`binReadFailures`, no learning, no accuracy).
- raw error ≥ 50 % (LARGE_ERROR) + outlier → soft, clamped, learned.
- Existing tests that assert Check 5 hard-flags must be found by reading and rewritten to the new
  contract (list each in the report) — none may be deleted without a replacement.

Mutation checks (each must turn ≥ 1 test red; restore by re-applying original text, never git):
route outlier back to `hardScore`; centre `??` → `||`; centre EMA → `meanError`; z `>` → `>=`;
count gate 10 → 0; drop `softOutlierValidations` increment; drop `outlierZ` stamp.

`npm test` (798 before) green in `TZ=UTC` and one non-UTC zone; `npm run build` green.

## Docs (same commit)

`README.md` (version line, model header, anomaly bullet, history row, footer); `CLAUDE.md`
(version header; Two-Tier bullet: outliers are soft since v39.0, hard = Checks 2 and 3 only);
`src/assets/CHANGELOG.md` (top row incl. every consequence above and that `STATISTICAL_OUTLIER`
rows are pre-v39.0 only); `src/assets/tech-appendix.md` (§6.5 "Outlier Filtering" — no longer
"discarded"; §7.2 tables: move the outlier row from hard to soft; §7.3; §13 version + footer);
`index.html` (title; the How-It-Works sentence near line 333 saying an error far outside the normal
range is quarantined; the Last Flag tooltip near line 579 if it implies outliers); `TODO.md`
(close the "Check 5 rework ON HOLD" item; add: sd ratchet watch, CI-band provenance, soft-outlier
contamination watch with the first live examples to review); harness header notes.

## Risks

- R1 contamination by a transient (bounded, see Consequences).
- R2 a corrupt LF reading that passes Checks 2 and 3 used to be stopped by Check 5 and is now
  learned clamped. USGS ice qualifiers upstream and the ±2 sd clamp are the remaining guards.
- R3 headline discontinuity at deploy.
- R4 a second soft source means EF_DISCREPANCY and outlier share `softFlaggedValidations`;
  `softOutlierValidations` separates them.

## Verification path (stated before implementing)

1. Local: suite + mutation checks + build.
2. Fresh Opus auditor re-audits the diff against this plan, each plan-audit finding
   RESOLVED / PARTIAL / NOT RESOLVED.
3. Push only with the user's explicit approval.
4. Production, by a fresh subagent: deploy `ready` on the commit; next cron tick advances
   `lastPrediction`; `binWriteFailures` 0. **UNVERIFIED GAP until the river supplies a z > 3
   validation:** then `softOutlierValidations` ≥ 1, the bin's count +1, no new
   `validation_failure` row for it.

---

## Plan audit (independent Opus auditor, 2026-11-10) — PROCEED WITH CHANGES; implementation PAUSED

**BLOCKER, accepted: the contamination bound in "Consequences" and R1/R2 above is wrong.**
`updateCorrectionBin` adds the raw error to `sumErrorSq` BEFORE computing the clamp, so the clamp
width is 2·sd_post and sd_post includes the extreme observation itself. Measured with the real
function on live bins: the 2026-10-12 miss (errorCFS −4,275, `0-3000_rising`, n=22) moves the EMA
by **−603 cfs**, not ≈250; the step scales as ≈ 0.6·|e|/√(n+1) (−1,272 cfs for a −10k error) —
proportional to the error, not bounded. One such event raises the bin's lifetime sd ≈2.3×
(436 → 1,005), after which later misses in the same episode fall under z = 3 and are learned
UNCLAMPED. R2's "the clamp is a remaining guard against a corrupt LF reading" is false: a corrupt
reading widens its own clamp.

**Owner decision required before any code (option A was chosen on the wrong number):**
- A1 — always-soft, clamp computed from PRE-observation stats (sd_pre, EMA centre). Real bound:
  0.6·sd_pre per outlier (≈ 260 cfs for the example). Modifies `updateCorrectionBin` (also changes
  the EF_DISCREPANCY soft path, the harness cross-check, and needs its own tests/mutations).
  Lifetime sd still jumps once the raw value enters the sums.
- A2 — always-soft as originally written, accepting the corrected numbers.
- or fall back to B / C of the earlier plan.

Other findings accepted for whichever variant proceeds: replay assertions only on outlier rows
(only rows 1–2 of the ten stay outliers once the bin starts moving); zero/undefined-EMA exceptions
documented and tested; append-only `soft_outlier_event` row (not `validation_failure`) with
errorCFS, z, centre, sd_pre, sd_post, learningError, EMA before/after; `softOutlierValidations`
in the reset meta; hard+outlier rows keep a distinct string and do not touch soft counters; no
existing test asserts Check 5 hard-flags (zero coverage today); cross-check header claims
"bit-for-bit" and needs a documented-divergence case; 7-day chart y-domain will take soft outliers;
"Last Flag" tooltip; the v37.20 read-failure accuracy-exclusion rationale lapses (owner decision);
"sd only ratchets up" is wrong (it decays ~1/n; the issue is the jump); doc locations per the audit.
Replay data snapshot taken 2026-11-10 (`analysis/snapshot-2026-11-10-*.json`, local, gitignored)
because the frozen bin and the October rows are perishable.

---

## FINAL SPEC — option A1 (owner decision 2026-11-10: "do A1"). This section supersedes everything above where they differ.

Version: **v39.0 (MAJOR)** unless the owner overrules before push (v38 skipped: the label belongs
to the failed estimator gate). Unlike v37.21 ("no change to the estimate for a given set of
bins"), this changes how every soft-flagged observation moves a bin, i.e. the learning rule itself.

### 1. `updateCorrectionBin(binData, errorCFS, isSoftFlagged)` — clamp from PRE-observation stats
In `netlify/functions/shared/model.js`. Order of operations becomes:
1. Snapshot pre-state: `preCount = binData.count`; `preMean = binData.meanError`;
   `sdPre = sqrt(max(0, sumErrorSq/preCount − preMean²))` (only meaningful when preCount > 0);
   `center = binData.emaMeanError ?? preMean`.
2. Clamp iff `isSoftFlagged && preCount >= 10 && Number.isFinite(sdPre) && sdPre > 0 &&
   Number.isFinite(center)`: `maxDelta = 2·sdPre`,
   `learningError = clamp(errorCFS, center − maxDelta, center + maxDelta)`. Otherwise unclamped,
   `maxDelta = null`.
   - Gate is now on the PRE count (was post-increment `count >= 10`, i.e. pre ≥ 9), aligning it
     with Check 5's `count >= 10`. Documented one-observation shift for the EF_DISCREPANCY path.
   - `sdPre <= 0` or non-finite → NO clamp (a zero-width clamp would freeze a bin; NaN must not
     reach the EMA).
3. Accumulate lifetime sums with the RAW `errorCFS` (unchanged): count, sumError, sumErrorSq, meanError.
4. EMA: if `preCount === 0` → `emaMeanError = learningError`; else
   `emaMeanError = α·learningError + (1−α)·center` where `center` is the pre-state value from
   step 1 (replaces `emaMeanError || meanError`: honours an EMA of exactly 0 and never mixes in the
   post-update mean). For a bin with a numeric non-zero EMA and no clamp this is numerically
   identical to the old code.
5. Return `{ learningError, clamped, maxDelta, sdPre, center, emaBefore, emaAfter }`
   (`emaBefore` = pre `emaMeanError` or null).
Guaranteed bound for a clamped observation: `|emaAfter − center| ≤ α·2·sdPre = 0.6·sdPre`.

### 2. Stage bin (inline block in `scheduled-update.js`, "mirrors flow bin logic")
Same three changes: pre-observation sd and centre, pre-count gate `>= 10`, `sd > 0` finite guard,
EMA recurrence from the pre-state centre with `??`. No other change to stage accounting.

### 3. `classifyOutlier(binData, errorCFS)` + Check 5 call site
As specified in "Change" items 1–2 above, with these amendments:
- non-finite `errorCFS`, centre, or sd → `{ zScore: null, isOutlier: false }`.
- flag string is `OUTLIER:z=<z.toFixed(1)>` in all cases (neutral; distinct from the historical
  `STATISTICAL_OUTLIER`). `softScore += 2`.
- classifyOutlier is called on the bin BEFORE `updateCorrectionBin` mutates it (it already is:
  Check 5 precedes the learning block) and uses the same centre/sd definitions as step 1.

### 4. Persisted trace
- Metadata (only when the observation is NOT hard-flagged and the bin read succeeded):
  `softOutlierValidations` +1, `lastSoftOutlier` (ISO), `lastSoftOutlierReason`. Add
  `softOutlierValidations: 0` to the reset meta in `sync-learning.js` next to `softFlaggedValidations`.
- Append-only row, non-fatal, written like the failure log but with its OWN type
  `soft_outlier_event`, gauge_id `${Date.now()}_${pred.id}` (the table has no CHECK on
  observation_type — verified 2026-11-10): validatedAt, predictionId, flowBin, flowState,
  actualCFS, predictedCFS, rawPredictedCFS, errorCFS, errorPercentRaw, errorPercentCorrected,
  zScore, center, sdPre, learningError, clamped, emaBefore, emaAfter, binCountAfter,
  anomalyFlags, waterTempC, gateVersion. NEVER written to `validation_failure`
  (rows there == `hardFlaggedValidations`, and the client draws each as a hollow ring).
- `outlierZ` on the validation-history entry for soft outliers only (add a parameter to
  `storeValidationPair`; do not overload `divergence`).
- `gateVersion` → `'v39.0'` on both row types.
- A hard-flagged observation (Check 2/3) that is also an outlier: `OUTLIER:z=…` stays in its
  `anomalyFlags`; soft counters and the event row are NOT written.

### 5. Kept as is (owner defaults, change only on request)
- v37.20 bin-read failure still skips learning AND accuracy; its comment is reworded (the
  observation could not be vetted or clamped), since "Check 5 could not run" no longer implies
  exclusion from accuracy.
- Client code: no logic change. Known, documented effects: soft outliers become solid points and
  enter the 7-day chart's y-domain; the "Last Flag" panel shows hard flags only (tooltip text
  corrected); dead client `isGFOutlier` / `GF_OUTLIER_THRESHOLD` get a comment marking them dead
  and pre-v39.0.
- Analysis harnesses: `ci_backtest_harness.mjs` imports the shared `updateCorrectionBin`, so its
  soft-clamp replay changes with this version while its local Check 5 copy stays hard — header
  notes updated on all three harnesses; the cross-check test header's "bit-for-bit" claim is
  corrected and a z > 3 case asserting the DOCUMENTED divergence is added.
  `EMPIRICAL_CI_90` provenance gap → TODO.

### 6. Tests (in addition to the lists above, as amended by the audit)
`updateCorrectionBin` (rewrite existing expectations in `test/update-correction-bin.test.mjs` to
the new contract; list every changed assertion in the report):
- soft, preCount ≥ 10, extreme error (e.g. −4275 against the live `0-3000_rising` numbers from the
  snapshot): step == 0.6·sdPre exactly, far below the old post-stat step; sums take the raw value.
- bound property over a grid of errors (±100 … ±50,000): |emaAfter − center| ≤ 0.6·sdPre + ε.
- preCount 9 soft → unclamped (documents the gate; TODO #34); preCount 10 → clamped.
- sdPre 0 with preCount ≥ 10 → unclamped, EMA moves; missing `sumErrorSq` → no NaN anywhere.
- EMA exactly 0 honoured; EMA undefined → centre = pre mean; first observation → EMA = error.
- not soft-flagged → unclamped, identical to the old recurrence for a numeric non-zero EMA
  (golden numbers computed from the OLD code before editing, kept as constants).
- stage bin: clamped from pre-stats when stage preCount ≥ 10, unclamped below.
Replay (fixture built by a committed script from `analysis/snapshot-2026-11-10-*.json`, which the
script may also refresh from the public endpoints; the committed fixture lives in
`test/fixtures/`, records `fetchedAt` and source URLs, and is declared a non-reproducible
snapshot; the script fails unless it finds exactly the ten 2026-10-16→18
`6000-12000_falling` rows; tests never touch the network): classify + update sequentially —
EMA strictly decreases from +401; on rows where `isOutlier` the step ≤ 0.6·sdPre; on other rows
the step ≤ 0.9·sdPre; record how many of the ten are outliers.
Integration: as listed above plus — soft outlier does not update `lastFlagged`;
`pairs[].hardFlagged === false`; shadow leaderboard row written; `stageObsClean` +1; `outlierZ`
absent on non-outlier entries; `soft_outlier_event` row written with the listed fields and its
insert failure is non-fatal; no `validation_failure` row; hard + outlier → no soft counters, no
event row; update the existing `gateVersion 'v37.21'` assertion.
Mutations: route outlier to hardScore; `softScore += 2` → `+= 1`; centre `??` → `||`; centre →
`meanError`; z `>` → `>=`; count gate 10 → 0 and 10 → 11 (both helpers); sdPre → post-update sd
in `updateCorrectionBin`; EMA recurrence back to `emaMeanError || meanError`; drop the
`sd > 0` guard; drop `softOutlierValidations`; drop the event row; stamp `outlierZ` on every
entry; gateVersion string.

## Post-review amendments (v39.0 review, uncommitted)

- **Deviation from FINAL SPEC §1.4 (defensive hardening).** When the pre-state EMA centre is non-finite (`emaMeanError` NaN, or both `emaMeanError` and `meanError` absent), step 4 seeds `emaMeanError = learningError` instead of running the recurrence, which would give NaN. Same rule in the inline stage-bin block (`stagePre.count === 0 || !Number.isFinite(stagePre.center)`). Not reachable with bins as stored today (JSON cannot carry NaN; every writer stores `meanError`). Finite-centre numerics are bit-identical to the spec. Lifetime sums are unchanged (they can still be NaN when `sumErrorSq` is missing).
- **Additive event-row field.** `soft_outlier_event` rows also carry `binWriteFailed` (boolean); when true, `emaAfter` and `binCountAfter` were never persisted and must be ignored. This is a superset of the §4 field list.

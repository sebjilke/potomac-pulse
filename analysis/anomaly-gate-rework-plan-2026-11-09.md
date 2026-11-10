# Anomaly-gate rework — plan (v37.21 ice check, v37.22 outlier check)

Date: 2026-11-09. Status: AUDITED — v37.21 implemented and re-audited (PASS WITH FIXES, fixes applied); v37.22 was ON HOLD and is SUPERSEDED: option A1 was chosen on 2026-11-10 and implemented as v39.0 (see "Open decision" and `analysis/outlier-always-soft-plan-2026-11-09.md`).
Scope approved by the user 2026-11-09 ("do 1-4" of the 2026-11-09 audit recommendations).

## Why

Evidence, all from the live `validation_failure` log, the live bins and USGS (2026-09-03 → 2026-11-09):

1. **Check 3 (`LOW_FLOW_HIGH_STAGE`) fires on normal open-water readings.** Condition is
   `actualCFS < 1500 && actualStage > 2.45`, comment "classic ice signature", HARD. The repo's own
   rating relation puts 2.45 ft at ~500 cfs and 1,500 cfs at ~2.73 ft, so the check covers the whole
   normal 600–1,500 cfs band. It has no temperature or season gate although `waterTempC` is in
   scope. 15 validations were hard-flagged by Check 3 alone between 2026-09-16 and 2026-10-10 at
   USGS-confirmed water temperatures of 19–26 °C (daily minimum 17.6 °C); corrected errors were
   mostly under 10 %. All were dropped from learning and accuracy.
2. **Check 5 (`STATISTICAL_OUTLIER`) rejects regime change, not corruption.** HARD at
   `|errorCFS − meanError| / sd > 3` once `count >= 10`. Because a hard-flagged observation never
   updates the bin, `sd` cannot widen while every new observation lies beyond 3 sd: a bin whose history is tight is locked out permanently
   when the regime shifts. Live: `6000-12000_falling` (n=17, sd=174 cfs → ±3sd ≈ ±5.8 % of flow)
   rejected 10 consecutive validations on 2026-10-16→18 (corrected errors −5.8 %…−13.8 %) while its
   frozen +401 cfs correction made each of them worse than the raw estimate. Lifetime (since v37.9 logging began, 2026-06-22): of the
   Check-5 hard flags, 29 of 35 had |corrected error| < 25 %, 21 < 15 % (as of 2026-10-19).
3. **Check 5 is centred on the lifetime mean, not the EMA.** After the Oct 2026 recession the
   `0-3000_steady` bin has lifetime mean +267 and EMA −135; the test window is therefore asymmetric
   around the correction actually in force. `updateCorrectionBin`'s soft clamp was already moved to
   the EMA centre in v36.0; Check 5 was not.

## Changes

### v37.21 — Check 3 gains a cold-plausibility gate (MINOR, server-only)

- New pure helper in `netlify/functions/shared/model.js`:
  `isIcePlausible(waterTempC, nowMs)` →
  - `waterTempC` finite: `waterTempC <= ICE_CHECK.maxTempC`
  - otherwise (temp unknown): `ICE_CHECK.coldMonths.includes(new Date(nowMs).getUTCMonth())`
- New constant `ICE_CHECK = { maxTempC: 5, coldMonths: [10, 11, 0, 1, 2] }`.
  - `maxTempC = 5`: ice at the Little Falls gauge needs water near 0 °C. 5 °C leaves margin for the
    temperature being measured at Point of Rocks (01638500), not Little Falls, and for diurnal swing.
    Deliberately NOT the 10 °C `EF_MODEL.coldMaxTemp` (that constant selects an EF rating, a
    different question).
  - `coldMonths` equals `EF_DIVERGENCE.coldMonths` (UTC Nov–Mar), the existing temp-unknown proxy.
    Fail-toward-flagging when temperature is unknown in the cold season: unchanged behaviour there.
- Check 3 becomes
  `if (actualCFS < 1500 && actualStage > 2.45 && isIcePlausible(waterTempC, now.getTime()).plausible)`.
- **Not changed:** the 1500 cfs / 2.45 ft thresholds. They remain inconsistent with the rating
  relation, so in genuinely cold water every sub-1,500 cfs validation will still hard-flag. That is
  the pre-existing winter behaviour; recalibrating the stage threshold needs winter data and its own
  decision. Filed as a TODO item, not done here.
- Check 2 (`STAGE_DISCHARGE`, >35 % stage-implied excess) is untouched and remains the
  temperature-independent corrupt-LF guard.

### v37.22 — Check 5 two-tier, EMA-centred (MINOR, server-only)

- New pure helper in `netlify/functions/shared/model.js`:
  `classifyOutlier(binData, errorCFS, errorPercentCorrected)` →
  `{ zScore: number|null, tier: 'none'|'soft'|'hard' }`
  - `binData.count < 10` or `sd <= 0` → `{ zScore: null, tier: 'none' }` (unchanged gating)
  - `center = binData.emaMeanError ?? binData.meanError` (same expression as `updateCorrectionBin`)
  - `sd = sqrt(max(0, sumErrorSq/count − meanError²))` (unchanged)
  - `z = |errorCFS − center| / sd`
  - `z <= 3` → `none`
  - `z > 3 && |errorPercentCorrected| >= OUTLIER.hardMinAbsPct` → `hard`
  - `z > 3` otherwise → `soft`
- New constant `OUTLIER = { zThreshold: 3, hardMinAbsPct: 25 }`.
- In `validatePendingPredictions`:
  - `hard` → `hardScore += 2`, flag string `STATISTICAL_OUTLIER:z=…` (unchanged string, so the
    client chart, the appendix and historical rows stay comparable).
  - `soft` → `softScore += 2`, flag string `OUTLIER_SOFT:z=…`. The observation then takes the
    existing soft path: learned through `updateCorrectionBin(..., isSoftFlagged=true)` (±2 sd clamp
    around the EMA), counted in accuracy, `softFlaggedValidations` incremented.
- Rationale for 25 %: it is the boundary the evidence drew — the six ≥25 % Check-5 flags are the
  genuine local-runoff misses (incl. −72.9 % on 2026-10-12); everything under it was a regime
  shift or an accurate prediction in a tight bin. 25 % is also the "big miss" level the
  LF-residual advisory backtest used (≤ −25 %).
- Consequences, stated plainly:
  - Bins can now drift toward a new regime, at most 0.3 × 2 sd per observation, and `sd` widens as
    the clamped-path raw values enter `sumErrorSq` — the lockout self-heals.
  - The headline accuracy will include observations it used to drop. It will read WORSE for the
    same model. That is the honest number.
  - The stale `6000-12000_falling` (+401) and `12000-25000_falling` bins are NOT hand-edited; they
    unlock on the next visit through this path.
  - The LF-residual advisory already feeds on both validation paths; no change.

### Not changed (both versions)

Estimator, weights, correction formula, `applyGFCorrection`, client code, bin schema, Checks 1/2/4,
the claim-before-learn order, the bin-read-failure guard (v37.20), stage-bin learning.

## Files

- `netlify/functions/shared/model.js` — `ICE_CHECK`, `isIcePlausible`, `OUTLIER`, `classifyOutlier`, exports.
- `netlify/functions/scheduled-update.js` — Check 3 and Check 5 call sites, comments.
- Tests (new file `test/anomaly-gates.test.mjs` + additions to `test/scheduled-update.test.js`).
- Docs, same commit as each version: `README.md` (version, history, anomaly bullet), `CLAUDE.md`
  (version header + Two-Tier Anomaly Flagging bullet), `src/assets/tech-appendix.md` §7,
  `src/assets/CHANGELOG.md`, `index.html` (title/footer/version table/How-It-Works wording if it
  describes the flags), `TODO.md`.
- No client model file changes → parity tests untouched. Confirm nothing in `src/` or `analysis/`
  harnesses re-implements Check 3/5 (if the CI backtest harness does, it must be listed and kept
  as a frozen historical replay, not silently diverge).

## Tests

Unit (pure helpers):
- `isIcePlausible`: 26 °C → false; 5.0 → true; 5.01 → false; 0 → true; null/undefined/NaN in July
  → false, in January → true; boundary months (Oct → false, Nov → true, Mar → true, Apr → false).
- `classifyOutlier`: count 9 → none; sd 0 → none; z exactly 3 → none; z>3 with |pct| 24.9 → soft;
  25.0 → hard; negative pct symmetric; centre is EMA when EMA and mean differ (construct a bin where
  the lifetime-mean-centred z > 3 but EMA-centred z < 3, and the reverse); `emaMeanError` undefined
  falls back to mean; `emaMeanError === 0` is honoured (uses `??`, not `||`).
- Replay fixture: the ten 2026-10-16→18 `6000-12000_falling` rows (errorCFS, corrected %) against
  the n=17/mean=231/sumErrorSq bin → every one classifies `soft`; fed sequentially through
  `updateCorrectionBin(…, true)` the EMA moves monotonically down from +401 and `sd` grows.
- The 2026-10-12 row (−72.9 %) classifies `hard`.

Integration (`validatePendingPredictions` with the existing mock client):
- Check 3 at 1,330 cfs / 2.66 ft with waterTempC = 22 → NOT hard-flagged, bin written, no
  `validation_failure` row; same reading with waterTempC = 1 → hard-flagged as before; with
  waterTempC = null → follows the month proxy (inject/mirror the clock the way existing tests do).
- Check 5 soft tier → bin written with a clamped EMA, `softFlaggedValidations` +1,
  `hardFlaggedValidations` unchanged, validation-history row written, no `validation_failure` row.
- Check 5 hard tier → unchanged behaviour (failure row, no bin write).

Mutation checks (the HANDOFF requires them — a green suite is not evidence a guard is covered):
remove the `isIcePlausible` term; flip `>=` to `>` on 25; swap EMA centre back to `meanError`;
route `soft` to `hardScore`. Each must turn at least one test red.

Suite must stay green apart from deliberate additions (`npm test` currently 780).

## Side effects / risks

- R1: true ice at water temp reported > 5 °C at Point of Rocks. Mitigations: USGS ice qualifiers
  already skip learning upstream of this block; Check 2 still fires on stage-implied excess > 35 %.
- R2: temperature fetch fails (null) in Apr–Oct → Check 3 cannot fire. Acceptable: no ice then.
- R3: soft-tier outliers are real transient contamination under 25 %. Bounded by the ±2 sd EMA
  clamp; lifetime `sumError`/`sumErrorSq` take the raw value (existing soft-flag semantics).
- R4: accuracy headline discontinuity at deploy. Documented in changelog; no reset.
- R5: the offline CI-band harness (`EMPIRICAL_CI_90`, v36.1) was derived under the old gate. Band
  is display-only; note the provenance gap in TODO, do not re-derive here.

## Verification path (stated before implementing)

1. `npm test` green + mutation checks, locally.
2. Fresh Opus auditor re-audits the diff against this plan (each plan-audit finding
   RESOLVED / PARTIAL / NOT RESOLVED).
3. Push requires the user's explicit approval (auto-deploys via the Netlify test gate).
4. Production: first cron after deploy runs clean (`lastPrediction` advances, `binWriteFailures` 0).
   **Unverifiable until the river provides the case:** Check 3 needs LF < 1,500 cfs in warm water
   (or cold water for the positive case); Check 5 soft tier needs a z > 3 validation. These are
   UNVERIFIED GAPS at ship time, to be closed from the `validation_failure` log and bin counts.

## Items 3 and 4 of the audit

- Item 3 (stale +401 bin): no action by design — unlocks through v37.22.
- Item 4a (`HEALTHCHECKS_PING_URL`): blocked on the user creating a healthchecks.io check URL.
- Item 4b: refresh `.claude/HANDOFF.md`, TODO header/watch item, `netlify.toml` Node comment.

---

## Plan audit (independent Opus auditor, 2026-11-09) — disposition

Verdict: PROCEED WITH CHANGES. 15 findings. Status of the plan after engaging with them:
**v37.21 (Check 3) PROCEEDS with the changes below. v37.22 (Check 5) is ON HOLD pending a user
decision — do not implement from the section above.**

| # | Finding | Disposition |
|---|---------|-------------|
| 1 | BLOCKER: seven `hardUsgs` tests rely on Check 3 with no temp and no mocked clock → suite goes red every 1 April | ACCEPTED. Those calls pass `waterTempC = 1`; one clock (`now.getTime()`) feeds the helper; add a pinned-July no-temp negative test. |
| 2 | BLOCKER: hard-tier cut on the CORRECTED % re-creates the lockout when the stale correction is large relative to flow | ACCEPTED, and it sinks the 25 % design as written. Re-derived on the full 54-row log: of 39 Check-5 rows, 8 have \|raw\| ≥ 25 %, 7 have \|corrected\| ≥ 25 %, and only 2 are both. Raw is routinely +25…+44 % in the low bins while corrected is small (2026-08-24: raw +38 %, corrected +12…+20 %; 2026-10-14: raw +37 %, corrected +3.9 %), so a raw cut hard-flags accurate predictions and a corrected cut relocks. Neither basis is sound → v37.22 ON HOLD. |
| 3 | Harness copies of Checks 3/5 (`ci_backtest_harness.mjs`, `c45_gate.mjs`, `flow_state_floor_gate.mjs`) will diverge; dead client `isGFOutlier` | ACCEPTED as freeze: header note on each harness ("replays pre-v37.21 gates"); rewire-before-next-backtest and the dead client copy filed in TODO. Not rewired here (analysis harnesses carry no temperature series). |
| 4 | Soft tier leaves no persisted trace | Deferred with v37.22. |
| 5 | Flag strings change meaning; failure rows record neither temp nor gate version | ACCEPTED for Check 3: `validation_failure` rows gain `waterTempC`, `iceBasis`, `gateVersion`; flag string gains the temperature basis. |
| 6 | Widened admission reaches stage bins, history, shadow leaderboard | ACCEPTED: stated in changelog; warm sub-1,500 cfs observations now reach Check 5 and every learned series. |
| 7 | 5 °C conflicts with `EF_DIVERGENCE.coldLockC` = 10 ("ice/backwater regime") | DEFAULT 5 °C KEPT, flagged to the user as their call. Reason: Point of Rocks is at 12.8 °C and falling with flow near the trigger; a 10 °C gate would resume flagging ice-free 5–10 °C water within weeks. One constant, trivially flipped. |
| 8 | Versioning | v37.21 MINOR accepted. v37.22's level deferred with it (precedent v33/v34 says MAJOR; "v38" is taken). |
| 9 | ≥25 % rows are model error yet dropped from accuracy | Deferred with v37.22 — part of the same user decision. |
| 10 | Non-finite inputs fail toward learning | For Check 3: non-finite temp → month proxy (fail toward flagging in the cold season). Rest deferred with v37.22. |
| 11 | Test gaps | ACCEPTED for Check 3: (a) the seven calls, (b) UTC month boundary, (c) negative temp, bin-read-failure path unchanged, failure-row fields. |
| 12 | Overstatements in "Why" | ACCEPTED: "sd can never widen" holds only while every new observation is beyond 3 sd; "lifetime" means since v37.9 logging began (2026-06-22). |
| 13 | R6: lifetime sd only ratchets up | Deferred with v37.22. |
| 14 | Doc impact list | ACCEPTED (appendix §6.5, §7.2, §7.3, §7.5, §13 + stale footer; index.html title, tooltip; README; CLAUDE.md; CHANGELOG; TODO). |
| 15 | Wording | ACCEPTED. |

### Open decision for v37.22 (user) — RESOLVED 2026-11-10: **A1 chosen → v39.0**

The owner chose option A on 2026-11-09; the plan audit of `analysis/outlier-always-soft-plan-2026-11-09.md` then found the option-A contamination bound wrong (the old clamp used post-update statistics, so the 2026-10-12 miss would move its bin ≈603 cfs, not ≈250), and on 2026-11-10 the owner chose **A1** (always-soft with the clamp computed from PRE-observation statistics; bound 0.6·σ_pre). Implemented as **v39.0 (MAJOR)**; "v37.22" and "v38" are not used. The options below are kept as the original record.

A. **Always-soft.** Check 5 never hard-flags: every z > 3 observation is learned through the ±2 sd
   EMA clamp and counted in accuracy. Hard flags return to meaning data corruption only (Checks 2, 3).
   No threshold to tune; no lockout possible; the −72.9 % class of miss moves a bin by at most
   ~0.6 sd once and shows in the headline. Reverses the v33.0 decision.
B. **Hard only on surprise relative to flow**: z > 3 AND |errorCFS − EMA| / actualCFS ≥ X. Keeps
   big transients out of learning; still relocks if a regime genuinely jumps by ≥ X in one step;
   X needs a backtest (plan → audit → blind dual-language per CLAUDE.md), not a pick.
C. **Leave Check 5 as is**, move only the centre to the EMA. Smallest change; lockout remains.

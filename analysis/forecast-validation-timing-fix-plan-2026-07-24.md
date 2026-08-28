# Forecast Validation Timing — Fix Plan (2026-07-24)

**Status:** PLAN — not implemented. Awaiting independent audit + user methodology confirmation.
**Trigger:** CONFIRMED MISMATCH found 2026-07-24 (code trace + live-metric corroboration).
**Scope class:** display/metrics only. The GF estimate and EMA learning are NOT touched.

---

## 0. The defect, stated precisely

`predictedCFS` for horizon H is a **Great-Falls-referenced** flow at wall-clock `T = now + H`.
It is constructed at `src/ui/great-falls-ui.js:416-417` by reading the NWS **Little Falls**
forecast at `T + gfToLfTravel`:

```js
const getGFAtTime = (targetGFHrs) => {
    const lfTimeForThisWater = targetGFHrs + gfToLfTravel;
```

It is validated at `netlify/functions/scheduled-update.js:1665-1692` against `lf.q` — the live
Little Falls discharge at ≈ `T`:

```js
if (now < new Date(targetTime.getTime() + 15 * 60 * 1000)) continue;
...
const predictedCFS = pred.data.predictedCFS;
const actualCFS = lf.q;
const errorCFS = predictedCFS - actualCFS;
```

Water at Great Falls at `T` reaches Little Falls only at `T + travel`. The validation omits
that term. The **nowcast in the same file does not** (`:791, :901`):

```js
const travelGFtoLF = getGFtoLFTravelTime(mult, porRiseRate);
validationDue: new Date(Date.now() + travelGFtoLF * 60 * 60 * 1000).toISOString(),
```

**Magnitude** (`TRAVEL_GF_LF_BASELINE = 6.5`, `T = 4139·Q^−0.5963`, `MEDIAN_TRAVEL = 25.8`):

| LF flow (cfs) | GF→LF travel |
|---|---|
| 1,000 (floor) | 16.95 h |
| 2,800 | 9.18 h |
| 4,110 (today) | 7.30 h |
| 5,000 | 6.49 h |
| 15,000 | 3.37 h |
| 50,000 | 1.65 h |

At typical summer flow the gap **exceeds the +6h horizon itself**.

**Live corroboration.** At +6h the model scores 12.02% mean error vs naive persistence 10.52%
and bias-corrected NWS 10.87%; it beats persistence at 12h (11.99 / 13.24), 24h (13.32 / 18.78)
and 48h (18.26 / 21.12). Losing only at the shortest horizon is the expected signature of a
fixed timing offset. *Caveat: model n=3058 vs baselines n=1138 (C24 began persisting baselines
2026-06-16), so these are different sample periods — suggestive, not conclusive.*

---

## 1. The complication that makes this NOT a one-line gate change

The three baselines scored alongside the model are **Little-Falls-referenced at T**, and are
correctly scored against LF at T today (`src/ui/great-falls-ui.js:478-488`):

```js
const rawLf = interpolateForecast(lfPoints, targetHrs);        // LF forecast at T — no travel offset
nwsLfRawCFS = Math.round(rawLf);
nwsLfBiasCorrectedCFS = Math.round(rawLf + lfBiasOffset);
const persistenceCFS = Math.round(observedLfCFS);              // LF now
```

So the four quantities validated in one pass are **not predicting the same thing**:

| Quantity | Predicts | Correct observation |
|---|---|---|
| `predictedCFS` | GF at T | LF at **T + travel** |
| `nwsLfRawCFS` | LF at T | LF at T |
| `nwsLfBiasCorrectedCFS` | LF at T | LF at T |
| `persistenceCFS` | LF at T | LF at T |

Consequences:

- **Only the model is mis-scored today.** The baselines are correctly referenced. The head-to-head
  panel (`great-falls-ui.js:707-720`, "Our model predicts Great Falls; NWS predicts Little Falls
  directly") is therefore **structurally biased against the model**.
- **Naively moving only the model's gate to `T + travel` does not fix the horse race** — it puts
  the model and the baselines on two different observation moments, which is a different apples-to-
  oranges comparison, and forces per-row partial validation (model ripe at `T+travel`, baselines at
  `T`) with state tracking that does not exist today.
- **Making the baselines GF-referenced collapses one of them.** `predictedCFS` already equals
  `NWS LF forecast at T+travel + lfBiasOffset` (plus any EF blend). A GF-referenced
  `nwsLfBiasCorrectedCFS` would be the *same number*. **The model's entire claimed skill over the
  corrected-NWS baseline IS the travel shift.** That is a real finding about what the horse race
  has been measuring, and it must be decided deliberately, not silently.

---

## 2. Design options (METHODOLOGY DECISION REQUIRED — CLAUDE.md §Scientific/Modeling Work)

### Option 1 — Fix the model's clock only (minimal)
Gate model validation at `T + travel`; leave baselines scored at `T`.
- ✅ Model's own headline accuracy becomes correct.
- ❌ Requires per-row partial validation (two ripeness moments, new state).
- ❌ Head-to-head becomes incomparable in a new way; the "vs NWS" delta must be relabelled or hidden.

### Option 2 — Put everything on Great Falls' clock (coherent horse race) — **RECOMMENDED**
All four quantities become GF-at-T predictions; all validated against `lf.q` at `T + travel`
(single moment, no row-splitting). Baselines re-derived at store time:
- `nwsLfRawCFS` → `interpolateForecast(lfPoints, targetHrs + gfToLfTravel)` (raw, no bias term)
- `nwsLfBiasCorrectedCFS` → same `+ lfBiasOffset`  ⚠ **collapses onto `predictedCFS` absent EF blend**
- `persistenceCFS` → current **GF estimate** (`gfEst.cfs`), the true no-change baseline for GF
- ✅ Single validation moment; no partial-row state.
- ✅ Horse race becomes meaningful for the first time.
- ⚠ Touches client production code (baseline derivation only — displayed forecast values unchanged).
- ⚠ Invalidates all accumulated accuracy history (see §5).
- ⚠ Must decide what to do about the degenerate corrected-NWS baseline (drop it, or keep and
  document that it is by construction ≈ the model).

### Option 3 — Redefine the card as a Little Falls forecast
Change the production lookup to read LF at `T`. **REJECTED**: silently converts the Great Falls
forecast into an LF forecast. The card is explicitly a GF forecast
(`great-falls-ui.js:720`), period 0 is `gfEst.cfs`, and `getGFAtTime` is named for what it does.

---

## 3. Implementation (assuming Option 2 is confirmed)

### 3a. Travel-time source — SECOND METHODOLOGY DECISION

| | 2a. Persist the client's `gfToLfTravel` | 2b. Server recomputes at validation |
|---|---|---|
| Self-consistency with how `predictedCFS` was built | ✅ exact | ✗ approximate |
| Schema / client / validator changes | 3 files + migration for in-flight rows | none |
| Public-write attack surface | new attacker-controllable field (bound it 0–24 h) | none |
| Handles rows created before deploy | needs fallback | ✅ self-healing |
| Ripeness monotonic in time | ✅ | ✗ can recede if flow drops (benign: fires on first tick where the condition holds) |

**Recommendation: 2a (persist).** The validation must compare the *same water parcel* the
prediction was built from; recomputing from a different flow 48 h later breaks that. Bound the
field to `0 < x ≤ 24` in the C13a validator; fall back to a server-side recompute when the field
is absent (in-flight rows drain within 72 h).

### 3b. Files to change

| File | Change |
|---|---|
| `src/ui/great-falls-ui.js` | route `:407` through `getGFtoLFTravelTime(mult, riseRate)` (fixes the missing celerity reduction + the `currentCFS`-into-`lfFlow` param misuse); re-derive the three baselines at `targetHrs + gfToLfTravel`; set `persistenceCFS = gfEst.cfs` |
| `src/learning/gf-learning.js` | add `gfToLfTravelHrs` to the POST payload |
| `netlify/functions/sync-learning.js` | `buildForecastRows`: persist `gfToLfTravelHrs`; C13a validator: bound it |
| `netlify/functions/scheduled-update.js` | readiness gate → `targetTime + travel + 15 min`; widen the stale gate (see 3c) |
| docs | README, `src/assets/tech-appendix.md`, `index.html` `#tab-docs`, CHANGELOG, CLAUDE.md, TODO.md |

⚠ **`:407` change alters displayed forecast values** (celerity reduction on rising rivers). That
makes this arguably MAJOR, not MINOR. If the user wants to keep it MINOR, split `:407` into a
separate versioned change and persist the un-reduced travel for now.

### 3c. Stale-gate collision — MUST FIX
`validateForecastPredictions` deletes any row with `ageHours > 72` (`:1671`). Under the new gate a
+48 h forecast ripens at `48 + travel`:
- at 4,110 cfs → 55.3 h (fine)
- at 1,000 cfs → **64.95 h**, only ~7 h before the stale delete
With `missedRuns: 456` in live metadata, a cron gap at low flow would silently delete the row as
stale before it ever validated — a **silent low-flow sampling bias** in the metric.
**Fix:** raise the stale threshold to `72 + maxTravel` (≈ 96 h) or make it
`targetTime + travel + grace`. Also confirm `FCAST_TARGET_MAX_OFFSET_MS` still admits the payload.

### 3d. Tests (none exist today for forecast validation timing)
1. Ripeness gate: row with `travel = 9.18` is NOT ripe at `T + 1 min`, IS ripe at `T + 9.2 h`.
2. Missing-field fallback: pre-deploy row (no `gfToLfTravelHrs`) still validates, does not throw.
3. Stale gate: +48 h row at 1,000 cfs is not deleted before it ripens.
4. C13a validator: rejects `gfToLfTravelHrs` of `-1`, `25`, `"abc"`, `NaN`; accepts `7.3`.
5. `buildForecastRows` persists the field; absent → `null`.
6. Baseline re-derivation reads `lfPoints` at `targetHrs + travel`.
7. Characterization: the **displayed** forecast card values are unchanged by the baseline
   re-derivation (guards against scope creep into the estimate).
8. Parity: forecast gate travel and nowcast `validationDue` travel come from the same helper.

### 3e. Side effects to expect
- Forecast rows live ~1 travel-time longer → `gf_forecast_pending` table depth grows modestly.
- Validation throughput per cron tick unchanged (loop is `limit: 100`).
- No change to `gf_correction_bins`, `validationDue` for the nowcast, or any displayed estimate.
- `forecast-accuracy` numbers will shift discontinuously at deploy — must be reset (§5).

---

## 4. Verification path (stated upfront, per global CLAUDE.md)
1. `npm test` green (744 + new tests).
2. Fresh independent auditor reviews this plan (step 2 of the protocol) — findings marked
   RESOLVED / PARTIAL / NOT RESOLVED.
3. Fresh re-auditor after implementation verifies each finding and plan-conformance.
4. **Live, cannot be confirmed pre-deploy:** the first post-deploy forecast validation must be
   observed writing `gf_forecast_metadata` at `T + travel`, not `T`. Until a real cron cycle runs
   this is an **unverified gap**, not a verified pass.
5. Empirical confirmation (optional, strong): re-score archived predictions against LF at
   `T + travel` and check the +6 h anomaly vs persistence disappears. **Blocked** — no per-row
   forecast validation endpoint exists; would need direct Supabase access.

---

## 5. The accumulated history — DESTRUCTIVE, USER DECISION
All `gf_forecast_metadata` counters accrued under the broken comparison. Mixing pre- and post-fix
validations leaves the metric permanently uninterpretable. `resetForecastAccuracy` exists but has
no UI button (TODO #17) — it is an out-of-band PIN-gated POST.
**This plan does NOT auto-reset.** Recommend the user trigger it explicitly after deploy.

---

## 6. Open questions for the user
1. **Option 1 or Option 2?** (~~recommend 2~~ → **superseded, see §7: Option 1**)
2. **Travel source: persist client value (2a) or server recompute (2b)?** (~~recommend 2a~~ → **superseded: 2b**)
3. **Degenerate corrected-NWS baseline** under Option 2 — drop it, or keep and document?
4. **Fold the `:407` celerity fix in (MAJOR) or split it out (keeps this MINOR)?**
5. **Reset the accuracy history at deploy?**

---

# 7. AUDIT ENGAGEMENT (protocol step 3) — 2026-07-24

Independent auditor (fresh agent, did not draft this plan). 3 BLOCKER / 6 MAJOR / 9 MINOR.
Every blocker was re-verified by the orchestrator against the code before acceptance.

## Blockers — ALL ACCEPTED

**B1 — Option 2 collapses the baselines onto the model. ACCEPTED. Option 2 is withdrawn.**
Re-verified: `interpolateForecast` (`great-falls-ui.js:371-381`) and the inline interpolation inside
`getGFAtTime` (`:421-430`) are logically identical — same array, same before/after/clamp branches.
So under Option 2, `nwsLfBiasCorrectedCFS` would be the *same integer* as `predictedCFS`, and
`nwsLfRawCFS` would be `predictedCFS − lfBiasOffset`, a constant per batch. EF blend cannot rescue
it — measured weight is 0.07% at 2,800 cfs, 0.46% at 4,110, 2.89% at 6,000. **Option 2 would leave
no external reference in the horse race.** The auditor's deeper reading is correct and is the most
important finding in this exercise: *the GF forecast has no independent content beyond a time-shift
of the bias-corrected NWS LF forecast, plus a negligible EF blend.*
Also accepted: Option 2 would have introduced a negative-baseline bug (`getGFAtTime` floors at 0
at `:434`; the baseline derivation would not, and `if (pred.data.nwsLfBiasCorrectedCFS)` at
`scheduled-update.js:1715` is truthy for negatives).

**B2 — This is spec conformance, not a methodology choice. ACCEPTED.**
Re-verified: `CLAUDE.md:129` — "validated when water arrives at LF"; `tech-appendix.md:597` —
"validated when water arrives at Little Falls"; `:565` — `GF_forecast(t) ≈ LF_forecast(t + T_GF_LF)`.
The documented behavior already IS the fix. §2's escalation of the whole change to a methodology
decision was wrong and is withdrawn. **The model's gate needs no user sign-off.** Only the baseline
treatment remains a genuine product decision.

**B3 — `limit: 100` ordering. ACCEPTED; §3e's "throughput unchanged" was wrong.**
Re-verified: `lastForecastPredictionTime` is in-memory only (`src/state/store.js:67`; zero
`localStorage` references in that file), so the 2h throttle resets on every page load and depth is
visitor-driven, not 4-rows-per-2h as §3e assumed. Rows are ordered `created_at` ascending
(`scheduled-update.js:1641-1646`) while ripeness is `created_at + horizon`, so an un-ripe +48h row
sorts ahead of a ripe +6h row; past depth 100 the ripe short-horizon rows are never reached.
Pre-existing bug, worsened ~30% by this change. **Must ship with the gate fix.**

## Major — accepted except M4's prescription

- **M4 ACCEPTED, and it strengthens the case.** The auditor found a third GF→LF travel number that
  is *already on screen*: `gfEstimate.inputs.travelGFtoLF` at `great-falls-ui.js:239`
  (`#gf-input-travel-gf-lf`). The forecast builds from `:407` while the card displays `:239`.
  Correct minimal fix is to reuse `gfEst.inputs.travelGFtoLF` (already parity-tested, already
  displayed) with a null guard for the EF-only ice path (`great-falls.js:367`), **not** a fresh
  `getGFtoLFTravelTime(mult, riseRate)` call as §3b proposed. Still split out (see below).
- **M5 ACCEPTED.** When `hasLFForecast` is false, `getGFAtTime` falls back to the PoR forecast at
  `targetGFHrs` with **no travel offset** (`:437-446`) — already GF-at-T referenced — yet `source`
  still starts with `'NWS'` so the row is stored. Gating those rows at `T + travel` would be a NEW
  mis-scoring. Needs a `travelApplied` discriminator. This is a genuine hole in §3.
- **M6 ACCEPTED.** `observedLfCFS = lfData?.q || currentCFS` (`:388`), so on an LF outage
  "persistence" silently becomes the GF estimate. §1's table row is not unconditionally true.
- **M7 ACCEPTED as pre-existing, NOT fixed here.** Read-modify-write without a claim
  (`:1698` → `:1730` → `:1737`). The change widens the window but does not create the hazard.
  Fixing it is a separate concern; recorded, not bundled. *Reason for rejection-as-scope:* bundling
  a concurrency redesign into a timing fix defeats attribution if the metric later moves.
- **M8 ACCEPTED.** Test #7 as written is not buildable — no jsdom, and `updateForecastPeriods` is
  DOM- and `fetch`-coupled. Adding a devDependency is forbidden by the global rules without an
  explicit request. Tests 1/2/3/8 also require adding `validateForecastPredictions` to
  `exports._test` (`:1801-1809`). Tests 4/5 are extensions of `test/sync-learning.test.js`, not new.
- **M9 ACCEPTED.** No golden/characterization test covers the forecast at all
  (`gf-characterization.test.mjs` snapshots only the nowcast). Good news: nothing silently
  re-baselines. Bad news: there is no safety net, and the one test that would provide it is the
  one M8 shows cannot be written without new tooling.

## Minor — accepted; two corrections to the auditor

- N10–N18 accepted as written. `FCAST_TARGET_MAX_OFFSET_MS = 72h` and `PRED_DUE_MIN_OFFSET_MS = -3h`
  (`sync-learning.js:117-119`) — neither is violated; that open action is closed.
- N11 accepted: bound travel at **18h**, not 24h (physical max is 16.95h at the 1,000-cfs floor).
- N15 accepted and re-verified: `resetForecastAccuracy` deletes **both** `gf_forecast_metadata` and
  `gf_forecast_pending` (`sync-learning.js:725-731`), so §3a's migration fallback dies if the reset
  runs at deploy. §3a and §5 are coupled.
- N13 accepted and **the plan was worse than the auditor said**: the cron is hourly
  (`netlify.toml:36`, `schedule = "0 */1 * * *"`), so ripeness quantizes to T+[0.25, 1.25]h.
- **Correction to the auditor (N16):** it lists `great-falls-ui.js:720` as a mis-citation for
  "the card is explicitly a GF forecast." Agreed that line is the accuracy-panel tooltip — but the
  claim itself stands on better evidence the auditor supplies: `tech-appendix.md:565` and
  `CLAUDE.md:129`. Conclusion unchanged, citation corrected.
- **Correction to the auditor (N17):** agreed the live-metric corroboration is "consistent with",
  not proof. The CONFIRMED verdict rests on the code trace alone. Header language corrected in §0.

## Rejected

- **Nothing rejected outright.** M7 is deferred-with-reasoning (scope/attribution), not rejected.

## Revised design

| | Decision |
|---|---|
| Option | **1** — fix the model's clock. Option 2 withdrawn (B1). |
| Travel source | **2b — server recomputes at validation.** No new field on the unauthenticated write path, no migration (which N15 shows would be dead on arrival), self-healing for in-flight rows. The self-consistency gain is minutes against an hourly cron (N13). |
| `:407` | **Split out** into its own MINOR, using M4's prescription (reuse `inputs.travelGFtoLF`). |
| Version | **MINOR, v37.16.** The auditor is right that MAJOR is not just wrong but dangerous: **v38.0 is a poisoned number** — five documents record the v38.0 estimator gate as FAILED and unimplemented. |
| `limit: 100` | **Fix the ordering in this change** (B3). |
| Stale gate | Widen to `72 + maxTravel` (N12/N14). |
| Baselines | ⚠ **BLOCKED — genuine product decision, see §8.** |

## 8. The one remaining decision (user)

Fixing the model's clock forces a choice about the three baselines, because model and baselines
ripen at different moments and today share one row validated in one pass. There is no LF observation
history server-side (`gf_history` stores the GF *estimate*, 24h only, `scheduled-update.js:342-374`),
so the elegant one-pass fix — score baselines against stored LF at T — is not available without
adding LF history storage, which is out of scope.

**A. Split the row into two ripeness moments** (marker field in `data`). Everything scored correctly,
all current behavior and UI preserved. Cost: more code, an in-place update on the M7
concurrency-exposed path, and it builds machinery to carefully score baselines that B1 proves are
the model plus a constant.

**B. Retire the NWS baselines and the "vs NWS LF forecast" panel** (`great-falls-ui.js:702-721`);
keep `persistenceCFS` as observed LF — the one honest external comparison left. Option 1 then
reduces to the gate change + stale widening + B3. This is the auditor's recommendation.
Cost: removes a shipped UI element; user-visible.

**C. Defer** — ship nothing until decided.

Auditor recommends B. Orchestrator agrees on the merits but flags it as user-visible feature
removal, which the global scope rules require explicit approval for.

**USER DECISION 2026-07-24: B.** Retire the NWS baselines and the "vs NWS LF forecast" panel; keep
persistence as observed LF.

---

# 9. IMPLEMENTATION RECORD (protocol step 4) — v37.16, 2026-07-24

Shipped as **MINOR v37.16**. No change to the GF estimate, the EMA correction bins, or the nowcast.
`npm test` 744 → **757**, build green.

## Code

| File | Change |
|---|---|
| `src/ui/great-falls-ui.js` | `getGFAtTime` now returns `{cfs, travelApplied}` — `true` on the NWS-LF path (which reads the LF series at `targetGFHrs + gfToLfTravel`), `false` on the PoR fallback (which reads PoR at `targetGFHrs` with no offset and is therefore already GF-at-T referenced). Resolves audit **M5**. Removed the `nwsLfRawCFS` / `nwsLfBiasCorrectedCFS` derivation; `persistenceCFS` kept. Accuracy panel now renders **vs persistence** instead of vs NWS raw. |
| `src/learning/gf-learning.js` | POST payload drops the two NWS baselines, adds `travelApplied`. |
| `netlify/functions/sync-learning.js` | `buildForecastRows` persists `travelApplied` (coerced with `=== true`, so a truthy non-boolean cannot enable deferral) and stops persisting the NWS baselines. C13a validator: their bounds removed, `persistenceCFS` bound kept, `travelApplied` type-checked. |
| `netlify/functions/scheduled-update.js` | New server-only `FORECAST_STALE_MAX_AGE_HRS = 90` (72h + 18h > the 16.95h physical max). `validateForecastPredictions`: computes `forecastTravelHrs` once per tick via `getGFtoLFTravelTime(getFlowMultiplier(lf.q))`; ripeness `targetTime + (travelApplied ? travel : 0) + 15min`; rows sorted by ripeness in JS before the loop; fetch cap 100 → 300; unparseable `targetTime` cleaned (mirrors the nowcast's C12 handling) instead of scoring garbage; the two NWS baseline scoring blocks removed, persistence kept. Exported via `_test`. |

**Deliberate deviation from §3a:** the plan recommended **2a** (persist the client's travel value).
Implemented **2b** (server recompute) per the audit's Q2 — no NUMERIC attacker-controllable field on the public unauthenticated
write path (the one field added there, `travelApplied`, is a strictly-coerced boolean), no migration (which N15 showed would be dead on arrival, since `resetForecastAccuracy`
deletes pending rows), and self-healing for rows already in flight. The self-consistency loss is
minutes against an hourly cron (N13).

**Deliberate deviation from §3b:** the JSON-path ordering (`data->>targetTime`) originally written into
the query was replaced with a JS sort. A malformed order clause would make `getObsRows` return an
error, and `validateForecastPredictions` early-returns on error — silently halting *all* forecast
validation. Not worth the risk for an ordering that cannot be exercised locally.

## Tests (+13)

- `test/forecast-validation-timing.test.js` (new, 11 tests): un-ripe row is not validated; ripe row is;
  PoR-fallback row is not deferred (M5); legacy row without the flag uses the old clock; the deferral
  scales with flow (0 validations at 1,000 cfs vs 1 at 50,000 cfs for the same row); the stale
  threshold exceeds the latest ripeness with ≥24h margin; corrupt `targetTime` is cleaned not scored;
  persistence accrues while the retired NWS counters do not; a ripe short-horizon row is scored ahead
  of an older un-ripe long-horizon one (B3); the travel offset comes from the shared helper.
- `test/sync-learning.test.js`: the two C24 baseline-passthrough tests were **deliberately
  re-baselined** — the three-baseline contract they pinned was retired by design. Replaced with
  assertions that the NWS fields are no longer persisted even if a legacy client sends them, that
  `persistenceCFS` still stores as `null` when absent, and that `travelApplied` coerces strictly.

**Known test gap (audit M8/M9, accepted):** no test covers the client-side forecast card itself —
`updateForecastPeriods` is DOM- and `fetch`-coupled and there is no jsdom, and adding a devDependency
is forbidden without an explicit request. The `travelApplied` plumbing is therefore verified from
`buildForecastRows` inward, not from the DOM outward.

## Docs

README (version, Current Model header, history row) · CHANGELOG · tech-appendix (§8.2 travel range
corrected from the wrong "~6-12h" to ~1.6/6.5/17h, §8.6 rewritten incl. the retired-baselines
rationale and the "two NWS baselines" count error, header version line — which was stale at 37.0 —
current-version line, `Generated by` footer) · `index.html` (title, How It Works: honest framing of
what the forecast is and why the NWS comparison is gone) · CLAUDE.md (Forecast/Validation block,
Current Model Parameters header) · TODO.md (#23 reset, #24 `:407` split-out, #25 displayed travel
times not rise-adjusted, #26 forecast RMW concurrency).

## Not done here, on purpose

- **`:407` celerity bypass** → TODO #24. Changes displayed forecast values; wants its own version.
- **M7 read-modify-write concurrency** → TODO #26. Pre-existing; bundling it would ruin attribution.
- **The accuracy reset** → TODO #23. Destructive and user-triggered, and per §4 it should follow the
  first observed post-deploy validation, not the deploy.

## Re-audit (protocol step 5) — fresh auditor, 2026-07-24 — **SHIP**

Verdict SHIP, conditional on the fixes below. Plan conformance confirmed on every design decision;
all travel figures quoted in the docs independently re-derived and exact; M5's `travelApplied`
flag traced end-to-end through all four hops with strict `=== true` at each. Gate arithmetic checked
for off-by-one, NaN and unit errors — clean. `npm test` 757, build green.

**Fixed in response:**

- **M6 (MAJOR) — accepted in §7 and then dropped with no disposition. Genuine miss, now fixed.**
  `persistenceCFS` was `Math.round(observedLfCFS)`, and `observedLfCFS = lfData?.q || currentCFS`
  degrades to the GF estimate on an LF outage. Tolerable when persistence was one of three
  baselines; **not** tolerable now that it is the only baseline AND the only rendered skill delta —
  an outage would have scored the model against itself and read flatteringly. Now
  `lfData?.q != null ? Math.round(lfData.q) : null`; the scorer already skips a falsy baseline.
- **MAJOR-2 — the ripeness sort does not do what five documents claimed.** It runs *after* the
  fetch, so it cannot change which rows arrive, and the loop has no `break` or per-tick budget, so
  every fetched row is examined regardless of order. The actual starvation mitigation is the cap
  raise alone, and even that is "far less likely to crowd out" rather than "cannot starve" — depth
  is visitor-driven. The sort's honest justification is resilience if the tick throws or times out
  part-way. Corrected in the code comment, README, CHANGELOG, tech-appendix, CLAUDE.md.
  Also noted: the starvation test passes with the sort deleted (it exercises the gate); the sibling
  ordering test does fail without it, verified by mutation.
- **MINOR-3 — "no new field on the public unauthenticated write path" was false.** `travelApplied`
  *is* a new field there. The security argument survives (a strictly-coerced boolean is far weaker
  than a free-form numeric travel value) but the sentence was wrong; reworded everywhere.
- **MINOR-4** — test counts were stale by one everywhere (757/+13/11, not 756/+12/10).
- **MINOR-5** — three JSDoc blocks inside the changed functions still described the old behavior
  (`validateForecastPredictions`' 72h + three-baseline summary; `getGFAtTime`'s `@returns {number}`;
  `updateForecastAccuracyUI`'s NWS delta). All rewritten.
- **MINOR-6** — v37.16 appended to the tech-appendix version enumeration.
- **MINOR-7/8 — overconfident rationales softened.** The 2b clock mismatch is disclosed as an
  approximation that can reach hours across a flood recession, not merely sub-quantization noise.
  The PoR-fallback comment no longer claims those rows are "GF-at-T referenced by construction" —
  PoR is ~19h upstream of GF, so they are PoR-at-T; not deferring them preserves prior behavior
  rather than making them correct.

**Accepted, not fixed (recorded):**

- **MINOR-9 — two ways this fix could silently no-op with a green suite.** No test imports
  `great-falls-ui.js` or `gf-learning.js`, so flipping `travelApplied` to `false` at its source
  would leave every server test green while the fix no-ops in production; and the mock's `limit()`
  ignores its argument, so reverting the cap raise is also invisible. This is the concrete blast
  radius of the M8/M9 gap (no DOM harness, and adding a devDependency is forbidden unqualified).
  Stated here rather than papered over.
- **Pre-existing, out of scope:** `pred.data === null` would throw at the loop's unguarded
  dereference (caught by the non-fatal wrapper, aborting the tick's remaining rows); metadata is
  upserted before the row delete, so a delete failure double-counts on retry — both belong to
  TODO #26.
- The `single()` mock always returns `PGRST116`, so the metadata *accumulation* arithmetic is never
  exercised by the new tests — pre-existing behavior, unchanged by this work.

## Verification status

1. `npm test` 757/757 ✅ · `npm run build` ✅
2. Plan audit (3 BLOCKER / 6 MAJOR / 9 MINOR) — engaged in §7 ✅
3. Fresh re-audit — **launched**
4. **UNVERIFIED GAP:** the first post-deploy forecast validation writing `gf_forecast_metadata` at
   `targetTime + travel` cannot be confirmed until a real cron cycle runs against production.
   Not a verified pass.
5. Empirical re-scoring of archived predictions — **blocked**, no per-row forecast endpoint exists.

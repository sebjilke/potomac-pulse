# v37.13 — EF Divergence Advisory (display-honesty patch) — Plan (2026-07-20)

**Status:** PLAN, audited (17 findings, ALL ACCEPTED — §8) → implement → re-audit. TODO #22;
the pre-registered FAIL fallback of the v38 gate (`v38_gate_verdict_2026-07-20.md` §6),
user-approved. Amendments from the audit are folded into §§0–7 below.
**Scope:** NO estimate change, NO learning change, NO weight change. Server detects
sustained EF-above-model divergence, client downgrades displayed confidence and explains
why. MINOR bump v37.12 → v37.13.

## 0. Evidence base (from the v38 gate residuals, multi mode, 122,976 scored hours)

| Hours | n | med \|%err\| | P(\|err\|>25%) | mean %err |
|---|---|---|---|---|
| normal, D̄ ≤ 1.20 | 110,470 | 2.1% | 1.8% | −0.3% |
| normal, D̄ > 1.20 | 11,539 | **5.0%** | **5.7%** | −0.5% |
| event windows, D̄ > 1.20 | 53 | **31.0%** | 67.9% | **−30.5%** (100% under-read >10%) |

Divergence-active hours are ~2.4× less accurate with ~3× the large-miss rate even outside
events; **76% (521/687) of the >25% misses on divergence-active normal hours are
under-reads** (F1 — backs the copy's "mostly under-reads"); when divergence coincides with
a genuine below-PoR event the estimate runs 20–35% low. Threshold sweep 1.10→1.30 shows error elevation nearly flat while duty falls
12.3%→7.7% → use **1.20** (the gate's most conservative reviewed T_LO; both 2026
production misses had D̄ ≈ 1.2–1.3 and would have fired). Expected advisory duty: ~9.5% of
hours, concentrated in warm-season low flows.

## 1. Server — detector (the gate's validated half, `scheduled-update.js`)

Runs **every cron cycle unconditionally** (F10) — after `makeGFPrediction`, before
`storePrediction` (so the pending row is stamped with the just-computed D̄); tolerates
`prediction === null` (ice/no-data: no new sample, window still trims, D̄ recomputed,
state decays to inactive — never frozen-active). Pure logic lives in an exported helper
(`updateEfDivergenceState` in `netlify/functions/shared/model.js`, server-only block) so
it is unit-testable.

- `D = pred.efEstimateCFS / pred.porEstimateCFS` with **strict EF validity (F11):**
  efEstimateCFS non-null (stage in rating range) AND ∈ (500, 500000) cfs AND the EF
  reading is ≤ **2h** old — which requires `fetchUSGSData` to capture the stage reading's
  timestamp (**F7**: new `hTime` field for 00065 params in the parse loop; named diff +
  its own test, since the loop feeds all consumers).
- **State row:** `(observation_type='ef_divergence', gauge_id='state')`, data =
  `{samples: [{t, d}] (trimmed to trailing 6h), dbar, active, activeSince, coldLockout,
  updatedAt}`. Read-modify-upsert; concurrent cron runs are possible (the C12 defenses
  exist because they happen — F14): last-writer-wins loses at most one sample, median over
  the remainder, fail-closed — benign. Write wrapped **non-fatal** (advisory must never
  break the learning cron).
- **D̄** = median of samples in trailing **5h**, requiring **≥3** samples AND a
  strictly-valid current-cycle sample (else inactive; fail-closed).
- **Eligibility with temp lockout (F12, adopts the reviewed 1 °C hysteresis):** temp ≤ 10 °C
  sets `coldLockout = true`; temp > 11 °C clears it; 10–11 °C keeps the previous value.
  Temp unknown: month proxy (Nov–Mar ineligible, Apr–Oct eligible; lockout unchanged).
  Ineligible ⇒ inactive.
- **Activation deadband:** ON at `D̄ ≥ 1.20`, OFF at `D̄ < 1.15`. (The deadband is NEW —
  the gate reviewed a continuous ramp, not this binary rule; recorded as a post-gate
  design choice, F12.)
- **Observability (F9, explicit):** the prediction object gains `efDivergence` (D̄) and
  `divergenceActive` before `storePrediction` (flows into the pending row wholesale).
  `storeValidationPair` (scheduled-update.js:386-395 + call site :1419) gains the two
  fields from the pending row (legacy rows → null, `??` pattern); the hard-flag
  `validation_failure` insert (:1143-1167) gains them too — the most valuable place, since
  both 2026 misses were hard-flagged. Additive only; no consumer pins the entry shape.

Constants (`EF_DIVERGENCE = {on: 1.20, off: 1.15, windowH: 5, minSamples: 3, staleMs: 2h}`)
live in `netlify/functions/shared/model.js` (server-only block; no client parity needed —
the client never computes divergence).

## 2. API — `sync-learning.js` GET

The main learning GET payload gains `efDivergence: {active, dbar, activeSince, updatedAt}`
(from the state row; `null` when absent). One extra row in the existing parallel SELECT
batch (v37.5 pattern).

## 3. Client — display only

- `src/ui/great-falls-ui.js` (+ a new pure helper module for testability,
  `src/ui/divergence-advisory.js`): if the payload's `efDivergence.active` AND
  `updatedAt` fresher than **2h** (stale cron ⇒ show nothing — fail-safe; constant
  `EF_DIVERGENCE_STALE_MS` in `src/model/constants.js` with a cross-ref comment to the
  server's value, F16):
  - displayed confidence drops one notch at render time (high→medium, medium→low, low
    stays low). **Stacking with the existing EF-trend downgrade is intended** (different
    signals; F17). The EF-only ice path is unaffected (no server prediction under ice ⇒
    state decays inactive).
  - an amber advisory renders under the GF estimate (follow the `#offlineBar` pattern).
- **Refresh cadence (F8 — without this the advisory misses its audience):** the learning
  payload is re-fetched on the existing **15-min** `fetchData` cycle (today it loads once
  per session at `init.js:84`; the v37.10 service worker's stale-while-revalidate on
  sync-learning GETs means periodic refetch converges to fresh within one cycle). This
  also fixes (a) returning users seeing a >2h-old cached payload (guard would hide a live
  advisory), (b) long-open tabs silently dropping it, (c) divergence starting after load.
- **Server-authoritative:** the client computes nothing; it renders server state.
- The empirical CI band is NOT changed (a band change is model-adjacent; out of scope).

**Advisory copy (the user-requested "why to trust it less", numbers from §0):**

> **⚠️ Cross-check gauge disagrees — treat this estimate with extra caution.**
> The Edwards Ferry gauge — an independent cross-check just upstream of Great Falls — has
> been reading well above what the upstream gauges suggest for several hours. Sometimes
> that's just gauge noise at low water, but it can mean water is entering the Potomac
> below those gauges — water this estimate may not fully see. In 15 years of replayed
> history, hours like this were about 2–3× less accurate than usual, and large misses
> (>25% off) were three times more likely — mostly under-reads. If the river looks higher
> than the number, believe the river.

(F13: "what the upstream gauges suggest" and "may not fully see" — accurate also for
high-flow hours where EF is already partially blended into the estimate.)

(Copy states disagreement and elevated uncertainty; it does NOT claim EF is right — the
v38 gate proved trusting EF is wrong more often than not.)

## 4. Tests (target: 679 → ~692)

- Detector pure logic (extract as a pure function taking `{samples, nowMs, efValid, dbar
  inputs, tempC, month, prevActive}` → state): window trim, ≥3-sample rule, median,
  cold/month eligibility, ON/OFF hysteresis, fail-closed on missing inputs. (~7 tests)
- State-row write is non-fatal: rejected upsert + throwing client don't break the cron. (2)
- GET payload includes `efDivergence`; absent row → null. (2)
- Client advisory helper: active+fresh → downgrade+note; stale → nothing; inactive →
  nothing; low stays low. (4)
- Existing 679 stay green (no estimate/learning surface touched — golden/parity untouched).

## 5. Docs & versioning

v37.13 (MINOR), corrected targets (F15): CLAUDE.md version refs + a "Divergence advisory"
bullet under Model Mechanisms · README version in its three spots (:6, :58, history row) ·
`src/assets/CHANGELOG.md` version-history entry · `src/assets/tech-appendix.md`
"Current version" (:656) + "Generated by" footer (:662) + a short advisory subsection ·
`index.html` `<title>` (line 6). TODO #22 → done. Cross-ref the v38 verdict §6.

## 6. Verification path (stated upfront)

1. `npm test` green locally (692-ish).
2. **Fresh-subagent implementation re-audit** (goal + diff only, no session context).
3. Push → Netlify gate (tests re-run) → deploy.
4. **Live, time-gated:** after the next cron cycle, `GET /api/sync` must include
   `efDivergence`; the divergence regime is still ongoing as of today, so `active: true`
   and the banner are likely observable on the live site within ~1h of deploy. Until that
   cycle runs this is an **unverified gap** (flagged per repo rules).
5. In-browser visual check of the banner + confidence notch (browser tooling if available;
   else flagged for Seb's manual check like v37.10–12).

## 7. Risks / edge cases (for the auditor)

- EF gauge stale-but-present: USGS returns last readings inside the fetch window; if EF
  froze >2h ago the current-cycle sample is stale. Mitigation: carry the EF reading
  timestamp into validity (reading older than 2h ⇒ current-cycle invalid ⇒ decay to
  inactive within the 5h window). Auditor: check the server fetch exposes the timestamp.
- Cron gap: `updatedAt` staleness guard on the client (2h) hides a dead advisory.
- Duty honesty: ~9.5% of hours will show the advisory (mostly summer/fall low flow). This
  is intended (the error elevation is real there), but the copy's "sometimes just gauge
  noise" sentence exists precisely for those hours.
- DB growth: single upserted state row — no growth. Pending/validation rows grow by two
  small fields.
- Supabase unique-key constraint `(observation_type, gauge_id)`: state row is upsert-only,
  never transitions identity — the DELETE-not-UPDATE rule for prediction rows does not
  apply. Auditor: confirm. (Confirmed — F3: the rule exists because prediction rows
  transition identity; `upsertObs` with `onConflict` is the right helper.)

## 8. Plan-audit resolutions (2026-07-20, independent auditor — 17 findings, ALL ACCEPTED)

F1 §0 numbers reproduce exactly; under-read split added · F2 makeGFPrediction exposes
what's needed (D visible past the 50% skip) · F3 DELETE-rule inapplicable, confirmed ·
F4 679-green verified by execution; test seams have precedents · F5 GET extension safe ·
F6 copy consistent with the verdict constraint · **F7 EF timestamp missing from the parse
→ capture `hTime` for 00065 (named diff + test)** · **F8 learning payload refetch on the
15-min cycle** · **F9 explicit `storeValidationPair` change + the fields on
`validation_failure` rows too** · **F10 detector runs every cycle unconditionally, after
makeGFPrediction / before storePrediction** · F11 strict EF validity (rating range AND
500–500k AND ≤2h) · F12 11 °C re-eligibility lockout adopted; deadband recorded as a
post-gate design choice · F13 copy softened for the blended high-flow case ·
F14 concurrency wording corrected (last-writer-wins, benign) · F15 doc targets corrected ·
F16 client staleness constant in `constants.js` with cross-ref · F17 downgrade stacking
declared intended; ice path unaffected.

## 9. Post-ship addendum (v37.14, 2026-07-20, user-directed)

- **Episode logging:** the user requires durable documentation of firings with actual numbers
  ("it fires a lot; issues are more pronounced in certain flow regimes"). Since the state row
  overwrites and §1's validation stamps live in a 7-day window, v37.14 adds an append-only
  `ef_divergence_episode` row emitted at each deactivation: startedAt/endedAt, cycles, peak D̄
  (+ LF at peak), mean D̄, LF min–max, per-cycle {t, D̄, LF} trail (capped 336, overflow counted).
  Aggregation is in the pure helper (new optional `lfCFS` input); emission is non-fatal in the
  cron. Together with the (windowed) validation stamps this answers duty-by-regime queries.
- **Copy trim:** the §3 copy's history-stats sentence removed from the DISPLAYED text at user
  direction; the evidence remains in §0 here and tech-appendix §5.9.

# System-1 (gauge-learning) full retirement — plan

**Date:** 2026-06-18 · **TODO item:** Tier 0 #0a · **Version:** MINOR (v37.0 → v37.1)
**Decision (user-confirmed):** full client + server retirement; accept the gauge arrival-display change.

## 1. Goal & rationale

Remove the dead System-1 gauge travel-time learning system entirely (client code, server
endpoints, stale DB rows, orphaned DOM). System-1 has been a **dead write path since
2026-02-24** (`learningEnabled` permanently `false` since the Feb-2026 Vite modularization,
so `recordObservation`/`calculateCorrections` never run), but a **live read path**: the
server `/api/sync` GET returns 15 frozen `correction` rows and `calcTravelTimes()` multiplies
the displayed per-gauge travel times / arrival times by them.

## 2. Behavior change (the one observable effect)

- The 15 frozen correction factors (mean **0.9347**, range 0.828–1.049, 12/15 < 1.0, newest row
  2026-02-24) stop applying. Displayed gauge **arrival times** for those gauges shift by the
  reciprocal — **~+6.5% on average** (up to +20.8% on the 0.828 gauge, −4.7% on the 1.049 gauge).
- **The GF estimate does NOT change.** `makeGFPrediction` computes its own PoR→GF travel time via
  `getPoRtoGFTravelTime(mult, riseRate)` and never reads `getCorrectionFactor`/`d.correction`. The
  8 characterization snapshots (which protect the estimate) therefore stay green — but note they do
  **not** cover the arrival-display change, which is intended.
- Justification for accepting it: these are stale single-browser-session artifacts the TODO's own
  Tier-0 evidence calls "self-referential/noisy"; they bias the arrival display with un-updatable
  Feb-2026 numbers. Removing restores the documented `baseHrs × Searcy-multiplier` display.

## 3. Files changed

### Client — full-file deletions
- **`src/learning/gauge-learning.js`** — DELETE (entire file is System-1: load/save/merge learning,
  `recordObservation`, `calculateCorrections`, `getCorrectionFactor`).
- **`src/learning/cloud-sync.js`** — DELETE (entire file is System-1 cloud sync: `initCloudSync`,
  `syncToCloud`, `updateSyncStatus`).

### Client — edits
- **`src/data/fetch.js`**
  - Remove imports of `getCorrectionFactor`, `recordObservation` (L26–27) and the now-unused
    `SYNC_API` import (L6 — already dead in this file).
  - `calcTravelTimes()`: drop `const correction = getCorrectionFactor(id); travelHrs *= correction;`,
    drop `d.correction = correction;`, drop the `recordObservation()` call (L149). Keep
    `d.travelHrs = g.baseHrs * multInfo.mult`.
- **`src/ui/learning-ui.js`**
  - Remove `toggleLearning`.
  - Rework `updateLearningUI()`: drop the System-1 block (`learningData.corrections`, `learnTotal`,
    `learnSince`, `learnAccuracy`, `learnGauges`, `correctionList`) and the `if (!learningData) return;`
    guard; keep the live calls (`updateAdminDashboard()`, `updateShadowModelUI()`,
    `updateShadowLeaderboardUI()`). Caller in fetch.js (`updateLearningUI()`) stays.
  - Remove `learningData, learningEnabled, setLearningEnabled` from the store import.
- **`src/state/store.js`** — remove `learningEnabled`/`setLearningEnabled`,
  `learningData`/`setLearningData`, `cloudSyncEnabled`/`setCloudSyncEnabled`,
  `lastSyncTime`/`setLastSyncTime`, `syncPending`/`setSyncPending`, `syncTimeout`/`setSyncTimeout`.
  (Verified: used only by the two deleted System-1 files + init.js wiring below.)
- **`src/init.js`** — remove `loadLearning`/`createEmptyLearning` import + `setLearningData(...)` calls
  (L75–76, L98), `initCloudSync()` (L59) + its import, and `updateSyncStatus('syncing')` (L60).
- **`src/main.js`** — remove `import './learning/gauge-learning.js';` (L27).
- **`src/model/constants.js`** — remove `STORAGE_KEY` (System-1 localStorage key) and
  `MIN_OBS_FOR_CORRECTION`. **Keep `SYNC_API`** (live: gf-learning.js + history.js use it).

### Client — HTML (`index.html`)
- Remove `syncStatus` span (L50).
- Remove the "📈 Learning Statistics" `<h3>` + 4 `learn-stat` rows (`learnTotal`, `learnSince`,
  `learnAccuracy`, `learnGauges`) (L518–534).
- Remove the "Gauge Corrections (System 1)" `<h3>` + `correctionList` div (L560–563).
- Update the reset-note text (L567) to drop the "Gauge corrections (System 1) preserved" clause.
- Keep: Validation Status, Scheduled Function Health, GF Flow-Bin (System 2), reset buttons,
  validation chart.

### Server — `netlify/functions/sync-learning.js`
- Remove the default-endpoint branch: GET→`loadLearningData` and POST→`saveLearningData` (L258–270).
  After removal the no-`endpoint` path falls through to the existing `405 Method not allowed`.
- Delete functions `loadLearningData` (~L289–360) and `saveLearningData` (~L363–463).
- Remove `saveLearningData` from the `_test` export (L973).
- **Keep `validatePostBody`** (still used by the live `gf` endpoint, L222).

### Tests
- **`test/sync-learning.test.js`** — remove the `saveLearningData` import (L4) and the
  "saveLearningData (C46 honest failure reporting)" describe block (L162–179). (Those test the
  retired System-1 sync; C49 "don't fabricate stage" lives in fetch.js and is untouched.)
- **Add** `test/travel-times.test.mjs` (new) — assert `calcTravelTimes()` sets
  `d.travelHrs === g.baseHrs * mult` with no correction multiplier and no `d.correction` field
  (locks in the removal). If `calcTravelTimes` is hard to unit-test in isolation (DOM/store deps),
  fall back to a focused test of the new no-correction invariant.
- Confirm no other test imports the deleted client modules (verified: none reference
  gauge-learning / cloud-sync / getCorrectionFactor / learningData).

### DB cleanup (Supabase `sabbonifrduiunuebxzf`, via MCP `execute_sql`)
- `DELETE` where `observation_type IN ('correction','observation','rise_event')` (expected 15+18+9=42)
  **and** the single System-1 `('metadata','system')` row (expected 1) → 43 total.
- **Do NOT touch** `gf_metadata`/`system` (System-2 run-health) or any `gf_*`/`shadow_*`/`ef_gf_*`/
  `por_history`/`gf_history` rows. Investigate the lone `snapshot` row (n=1) before deciding; leave
  it if its provenance is unclear (out of the approved set).
- Verify counts with a `SELECT … GROUP BY` immediately before the `DELETE`; abort if they differ.

### Docs / version
- `CLAUDE.md` (version header → v37.1; note System-1 retired; the "keep the gauge travel-time
  display" Tier-0 note no longer applies), `README.md` (version refs + new v37.1 history row),
  `index.html` `<title>` → v37.1, `src/assets/tech-appendix.md` (version + any System-1 mention),
  `src/assets/CHANGELOG.md` (v37.1 entry documenting the arrival-display shift).
- Update `TODO.md`: move Tier 0 #0a to Completed; #0b remains (becomes the sole Tier-0 open item).

## 4. What is explicitly KEPT (and why)
- `SYNC_API` constant; `/api/sync` endpoints `gf`, `forecast-accuracy`, `validation-history`,
  `gf-history`, `por-history`; `validatePostBody`; `buildForecastRows`; `validateGFWritePayload`.
- All of System-2: `gf-learning.js`, scheduled-update learning loop, EMA bins, shadow models
  (`shadow_*`), health telemetry, validation chart, admin dashboard.

## 5. Side effects & risks
- `GET /api/sync` (no endpoint) → now `405`. Only the deleted client cloud-sync called it; no external
  consumer. **Low risk.**
- User browsers retain stale `localStorage["potomac_learning_v24"]` — never read again; harmless, no
  migration. (Optional: a one-line `localStorage.removeItem` on init — deferred; not worth it.)
- Orphaned DOM removed to avoid dangling `getElementById` no-ops; the live widgets are untouched.
- The arrival-display shift is the intended, documented change (CHANGELOG).

## 6. Verification path (stated upfront)
1. `npm test` green after test edits (count drops by the 2 removed C46 tests, rises by the new
   travel-time test).
2. Characterization/golden snapshots unchanged → GF estimate proven invariant.
3. **Fresh-subagent re-audit** (goal + diff only): confirms no live System-2 path references a removed
   symbol, client/server still parity-consistent, no dangling imports/DOM, plan matches diff.
4. Netlify deploy gate (`npm install && npm test && npm run build`) must pass before deploy.
5. Post-deploy (fresh subagent / curl): site loads, Learning tab renders System-2 widgets, no console
   errors from missing modules; `SELECT` confirms the 43 System-1 rows are gone and `gf_metadata`
   intact.

## 7. Independent-audit resolutions (2026-06-18)

Fresh auditor verdict: PARTIAL — estimate-invariance/MINOR sound and well-evidenced; one
build-breaker missed. Resolutions:

- **MUST-FIX 1 — ACCEPTED (critical).** `src/ui/gauges-ui.js` is an unlisted live consumer: imports
  `learningData` (L7) and reads `d.correction` (L246–248, the "× N learned" popup suffix) +
  `learningData?.observations[id]?.length` (L252–255, "🧠 N observations recorded"). Removing the
  store export without editing this file fails `vite build`. **Added to §3 Client edits:** drop the
  `learningData` import; delete the L246–248 `d.correction` block (calc note becomes `baseHrs × mult`);
  delete the L252–255 observations block.
- **MUST-FIX 2 — ACCEPTED.** Rewritten `updateLearningUI` (+ whole learning-ui.js) must be
  provably free of `learningData`/`learningEnabled`/`setLearningEnabled`; remove `toggleLearning`
  entirely. Will grep the file post-edit to confirm zero residual references.
- **MUST-FIX 3 — ACCEPTED.** Ordering made explicit: **deploy server first** (removes
  `saveLearningData`), **then** DELETE the DB rows — else a stray client POST could re-create
  `metadata`/`correction` rows in the gap. (Client cloud-sync is also gone, so no client POSTs, but
  keep the order regardless.)
- **NICE-TO-HAVE — reword #0a Completed entry** so it doesn't read as contradicting the old
  "keep the display" note: ACCEPTED.
- **NICE-TO-HAVE — assert `d.correction === undefined`** (not 1.0) in the new travel-time test:
  ACCEPTED.
- **NICE-TO-HAVE — `localStorage.removeItem("potomac_learning_v24")` on init:** DEFERRED (reject for
  now) — the stale key is never read again; a migration line is out of scope and not worth the added
  init surface. Documented as harmless in §5.
- Auditor confirmed: `SYNC_API`/`validatePostBody`/`buildForecastRows`/`validateGFWritePayload` kept
  correctly; parity tests + characterization snapshot unaffected; `recordObservation` (System-1) is
  distinct from `recordPoRReading` (System-2); `rise_event` has zero source refs (legacy artifact).

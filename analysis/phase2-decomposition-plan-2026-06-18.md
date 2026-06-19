# Phase 2 internal decomposition — plan (Tier 3 #9, scope: T3 + T2)

**Date:** 2026-06-18 · **Class:** behavior-neutral refactor (load-bearing) · MINOR (no estimate/UI change).
**Scope (user-confirmed):** Target 3 + Target 2 only. **Target 1 (decompose `validatePendingPredictions`)
is OUT** — high risk, untested blocks (B10 EF-corr, B12 shadow, stage-bin clamp); deferred/declined.

**Invariant:** zero behavior change. Safety net = `gf-characterization` snapshot (estimate unchanged) +
the 602-test suite + `ensemble`/`correction`/`travel-time` parity + `ci-harness-crosscheck` (drives the
REAL `validatePendingPredictions`) + `scheduled-update`/`sync-learning` DB-mock tests. All must stay green.

---

## Target 3 — pull the model invocation out of `updateGreatFallsUI`

`src/ui/great-falls-ui.js`. The invocation is a single line (`setGfEstimate(estimateGreatFalls())`, ~L54);
render already reads from the `gfEstimate` store.

**Change:** add an exported `computeGFEstimate()` that does exactly `setGfEstimate(estimateGreatFalls())`;
`updateGreatFallsUI` calls `computeGFEstimate()` in place of the inline call, at the SAME point (after the
loading/ice guard, before render). No reordering of the guard, `recordGFEstimate`, `runShadowModels`, or
`storeForecastPredictions` side-effects. Net effect: names the compute seam, behavior identical.

**Verify:** `gf-characterization` snapshot unchanged (protects `estimateGreatFalls`); build clean. The DOM
render path is uncharacterized (no jsdom) — so the change is limited to the one-line extraction, nothing
in the render body moves. Risk: ~nil.

---

## Target 2 — `netlify/functions/shared/observations.js` data-access helper

~48 `.from('potomac_observations')` sites across `scheduled-update.js` + `sync-learning.js`; ~40
mechanically replaceable. `getSupabase` stays in `shared/model.js`; every call site already has an
injected `client`, so helpers take `client` as the first arg.

### Helper API (CJS module, `require('./shared/observations')` server-side)
```
getObs(client, type, gaugeId)        // .select('data').eq(type).eq(gauge).single() → returns data?.data ?? null; SWALLOWS error (incl. PGRST116) → null
getObsRaw(client, type, gaugeId)     // → { data, error } for the few sites that branch on error.code
getObsRows(client, type, {gaugeId, order, ascending, limit, columns})  // multi-row: load-all-bins / load-pending / load-forecast-pending
upsertObs(client, type, gaugeId, data)   // .upsert({observation_type,gauge_id,data}, {onConflict:'observation_type,gauge_id'}) → { error }
insertObs(client, type, gaugeId, data)   // .insert({...}) → { error }
deleteObs(client, type, {gaugeId})       // .delete().eq(type)[.eq(gauge)] → { error }   (admin resets, delete-by-type)
deleteObsById(client, id)                // .delete().eq('id') → { error }
claimObsById(client, id)                 // .delete().eq('id').select('id') → { data, error }  (C12 idempotency — KEPT DISTINCT, own name)
```

### Hard rules (the behavior-preservation catch)
1. **Error-shape parity per site.** Today some sites swallow errors and fall back to defaults (a failed
   `.single()` → null → default object); some check `error.code === 'PGRST116'`; some `console.error` the
   `.message/.code/.details`; some set a `binWriteFailed`/return-false flag. The helpers must reproduce
   EACH site's existing handling — do NOT introduce throws where the site currently swallows. Sites that
   inspect `error.code` use `getObsRaw`/`upsertObs`'s returned `{error}`, not a throwing `getObs`.
2. **C12 claim-delete stays its own helper** (`claimObsById`) and is NOT merged into `deleteObs*`. The
   delete-before-learn ordering in `validatePendingPredictions` is untouched (that function is out of
   scope; only its individual `.from()` calls are swapped 1:1 for the matching helper, no reordering).
3. **Don't fold one-offs.** The ~8 special sites (5-stacked `loadGFLearningData` reads, the two
   load-pending vs load-forecast chains, `error.code`-branching sites) get the matching helper only where
   it's a clean 1:1; otherwise leave as-is. No logic moves, only the `.from()` boilerplate.
4. **`onConflict` string** stays exactly `'observation_type,gauge_id'` everywhere.

### Method
Build `observations.js` + a small unit test for each helper (mock client). Then replace call sites
**file-by-file, in small batches**, running `npm test` after each batch (the DB-mock tests in
`scheduled-update.test.js` / `sync-learning.test.js` + `ci-harness-crosscheck` exercise many sites and
will catch a shape regression). Keep `_test` exports intact.

### Verify
602 suite green after every batch; `gf-characterization` snapshot unchanged; `ci-harness-crosscheck`
green (real validate path); parity tests green. Fresh-subagent re-audit of the final diff: confirms each
swapped site preserves operation + filters + error handling, C12 claim-delete distinct, no behavior drift.

---

## Audit resolutions (2026-06-18) — 7 MUST-FIX, all ACCEPTED

1. **Descope ALL `.from()` inside `validatePendingPredictions` (L838–1351) — leave 100% untouched.** Out of
   scope; highest silent-drift risk; exact-call-chain mocks; swapping buys nothing. `claimObsById` is still
   defined as a helper but applied only outside that function (or not at all).
2. **`sync-learning.js` has ZERO DB-site test coverage (25 sites).** Refactoring it is unverifiable by
   `npm test`. → either write a DB-mock test harness for its read paths first, or treat all 25 as
   manual-verify. (My earlier "suite exercises many sites" was overstated for this file.)
3. **`getObsRaw` mandatory** for the 7 error-branching reads: `loadCorrectionBins` (sched 648),
   `loadGFLearningData` bins (sync 286) + pending (294), `loadForecastAccuracy` (652),
   `loadValidationHistory` (696), `loadGFHistory` (728), `loadPoRHistory` (760). The PGRST116 sites keep
   `if (error && error.code !== 'PGRST116') throw error` verbatim; `getObsRaw` passes `error` through untouched.
4. **`deleteObs` second `.eq('gauge_id')` is CONDITIONAL** on gaugeId — else `resetGFLearning`'s delete-all
   (sync 554) silently deletes nothing. `getObsRows` makes gaugeId/order/limit optional and returns `{data,error}`.
5. **Preserve `loadShadowModelState`'s try/catch→defaults** (sched 430): swap only the `.from()` expression
   inside the existing try; don't let `getObs` turn throw→defaults into throw→null.
6. **Leave as-is (one-offs):** the forecast-batch `.insert(array)` (sync 454) and the forecast-pending
   no-gauge-filter multi-row read (sched 1488) unless a clean `insertObsRows`/optional-filter variant is added.
7. **Re-scope reality:** 62 sites total, not ~48. After descoping validatePendingPredictions (~13) the
   replaceable surface is split: **T2a = scheduled-update.js non-validate sites** (storePrediction is
   test-covered; the periodic writers are manual-verify-but-simple) · **T2b = sync-learning.js 25 sites**
   (zero coverage → needs tests first). Safe batch order: T3 → T2a → (tests) → T2b.

## Ship
Two commits (T3, then T2) or one "Phase 2 decomposition" commit. MINOR bump (v37.3) only if we treat
internal refactors as version-worthy per project convention; otherwise a no-bump refactor commit with a
CHANGELOG "internal, behavior-neutral" line. Mark Tier 3 #9 done (T3+T2) and Target 1 "declined (risk)"
in TODO. Push needs approval.

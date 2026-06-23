# Plan — Tier 4 #18: Log validation failures (v37.9)

**Date:** 2026-06-22
**Scope (user-confirmed):** Write the dropped-validation detail rows **+** a read-only GET endpoint. No new UI.
**Protocol:** Code-Change Verification (load-bearing `scheduled-update.js`). Plan → independent audit → test-first → implement → re-audit.

## Problem

When `validatePendingPredictions` (`netlify/functions/scheduled-update.js`) hard-flags a validation
(`isHardFlagged`, L1126 — data corruption: stage/discharge inconsistency, ice signature, statistical
outlier), the observation is **dropped from both learning and accuracy** and the pending row is deleted
(claimed at L1082). Nothing about the dropped point is retained beyond an aggregate count
(`metaData.hardFlaggedValidations`) and the single most-recent reason (`metaData.lastFlaggedReason`,
surfaced by #16). There is **no per-failure record** for post-hoc analysis — we cannot later answer
"what were the predicted/actual values and flags on the dropped points?"

## Correction to the handoff's framing

The handoff said to write the row "BEFORE the claim-delete." **That is infeasible**: Check 5
(statistical-outlier → HARD, L1108-1123) needs `binData`, which is fetched at L1097 — *after* the
claim-delete (L1082). The full `isHardFlagged` verdict is not known until L1126. Writing a separate
append-only `validation_failure` row *after* the claim is functionally equivalent (we are not
resurrecting the pending row, we are appending a new row of a different `observation_type`) and avoids
any interaction with the C12 idempotency claim. **Insertion point: inside the existing
`if (isHardFlagged)` block at L1130.**

## Files changed

### 1. `netlify/functions/scheduled-update.js` — write the row (load-bearing)

Inside `if (isHardFlagged)` (L1130), after the two existing `console.log`s, add a **non-fatal**
append-only insert via the existing `insertObs(client, type, gaugeId, data)` helper (already imported,
L24):

```js
// v37.9 (#18): persist the dropped validation for post-hoc analysis. Hard-flagged obs are
// excluded from BOTH learning and accuracy and otherwise vanish (only an aggregate count +
// last-reason survive). Append-only `validation_failure` row, unique gauge_id. NON-FATAL: a
// logging failure must never abort validation/accounting for this or any later pending row
// (the row is already claim-deleted; `validated++` and the metadata upsert still run below).
try {
    const { error: failErr } = await insertObs(
        client, 'validation_failure', `${Date.now()}_${pred.id}`,
        {
            predictionId: pred.id,
            predictionCreatedAt: pred.created_at,
            validatedAt: new Date().toISOString(),
            predictedCFS: correctedCFS,      // headline (corrected) estimate
            rawPredictedCFS: rawCFS,         // raw estimate (learning basis)
            actualCFS,                       // the suspect LF reading that triggered the flag
            errorCFS,                        // raw − actual
            errorPercentCorrected,
            errorPercentRaw,
            predictedStage,
            actualStage,
            errorStage,
            flowBin,
            flowState,
            hardScore,
            anomalyFlags,                    // array of reason strings (e.g. LOW_FLOW_HIGH_STAGE:…)
        }
    );
    if (failErr) console.error(`❌ validation_failure log FAILED for ${pred.id}:`, failErr.message);
} catch (logErr) {
    console.error(`❌ validation_failure log threw (non-fatal) for ${pred.id}:`, logErr?.message || logErr);
}
```

- **gauge_id `${Date.now()}_${pred.id}`** — append-only, satisfies the `(observation_type, gauge_id)`
  unique constraint. `pred.id` is unique per pending row, so two hard flags in the same millisecond
  cannot collide (stronger than #17's `${Date.now()}_${action}`).
- **Non-fatal**: `insertObs` returns `{error}` on a Supabase error (logged) and rejects only if the
  client throws synchronously (caught). Either way the loop iteration continues to `validated++` /
  metadata upsert. This mirrors the existing shadow-scoring `try/catch` (L1432) and #17's
  `logAdminAction`.
- **No other logic changes.** The claim-delete, learning skip, metadata branch, and EF-correlation
  block are byte-identical. All payload values are already in scope at L1130 (`correctedCFS`/`rawCFS`
  L1001-1002, `errorCFS` L1004, `errorStage` L1013, `flowBin`/`flowState` L1007-1008, `hardScore`/
  `anomalyFlags` L1028-1126).

### 2. `netlify/functions/sync-learning.js` — read endpoint (additive)

Add `loadValidationFailures(client)` mirroring `loadAuditLog` (L798) exactly — select
`validation_failure`, `order created_at desc`, `limit 50`, return `{ entries }`, 500 on error. Add the
dispatch branch after the `audit-log` branch (L300):

```js
// Validation-failure log — dropped (hard-flagged) validations, newest-first (v37.9 #18)
if (endpoint === 'validation-failures') {
    if (event.httpMethod === 'GET') {
        return await loadValidationFailures(client);
    }
}
```

Add `loadValidationFailures` to `exports._test` (L934).

## Tests (test-first) — `test/validation-failure-logging.test.js` (new, CJS, node:test)

Reuses the stateful mock-Supabase idiom from `test/audit-logging.test.js` / `test/sync-learning-loadgf.test.js`.

**Group A — the write (drives the real `validatePendingPredictions._test`):**
1. **Hard flag writes a `validation_failure` row.** Construct `usgsData` with `lf={q:1200,h:2.5}`
   (triggers Check 3 LOW_FLOW_HIGH_STAGE → `hardScore≥2`) and one in-window pending row. Assert the
   captured insert has `observation_type:'validation_failure'`, `gauge_id` matching `/^\d+_<id>$/`, and
   `data` carrying `predictedCFS/actualCFS/errorCFS/flowBin/flowState`, an `anomalyFlags` array
   containing `LOW_FLOW_HIGH_STAGE…`, and an ISO `validatedAt`.
2. **Non-fatal on insert failure.** Same setup, but the `validation_failure` insert rejects.
   `validatePendingPredictions` must still resolve (no throw) and return `{validated:1, cleaned:0}`
   (the row falls through to `validated++`), and the metadata upsert is still attempted.
3. **Clean validation writes NO failure row.** `lf={q:9000,h:3.2}` (no hard flag), in-window pending.
   Assert zero `validation_failure` inserts captured.

**Group B — the endpoint (`loadValidationFailures._test`):**
4. Returns `{entries}` mapped from `rows.map(r=>r.data)`, status 200.
5. Returns 500 on a query error.

Test-first: author A1/A3/B before implementing — A1/B fail (no write/endpoint yet), A3 passes
(vacuously). Then implement → all green.

## What tests catch which regression

- A1 → the row is actually written with the documented shape on a hard flag.
- A2 → the non-fatal guarantee (a logging failure can't corrupt validation accounting).
- A3 → no false-positive logging of clean validations (the write is gated on `isHardFlagged`).
- B → the endpoint returns the rows / fails closed with a 500.
- Existing 654 suite → the claim-delete / learning / metadata / parity paths are unchanged.

## Side effects / expected

- **One extra `insert` per hard-flagged validation.** Hard flags are rare (ice events, sensor
  corruption); negligible write volume. Clean and soft-flagged validations are unaffected (no extra DB op).
- **Unbounded table growth** — accepted: hard flags are rare; the GET caps reads at 50. Revisit only if
  volume surprises (no retention/cleanup in this change — out of scope, matches #17 `audit_log`).
- **No change** to the GF estimate, the EMA learning, accuracy scoring, parity tests, or any existing
  endpoint. `stored gauge_id` set gains `validation_failure` rows alongside `system`/`pending`/bin keys.

## Versioning

**MINOR → v37.9.** Server-only; additive logging + read endpoint; no change to core estimation output
for the same inputs, no change to learning/accuracy math. Update: `index.html` `<title>`, `CLAUDE.md`
params header, `README.md` (current-version + Current Model header + history table + changelog range +
footer), `src/assets/tech-appendix.md` (current-version + range + footer), `src/assets/CHANGELOG.md`,
`TODO.md` (#18 → done, test count 654 → +5).

## Out of scope (flagged, not done)

- **EF↔GF correlation accepts hard-flagged `actualCFS`** (L1218 not gated on `!isHardFlagged`): a
  corrupted LF reading already feeds that regression. Pre-existing behavior; #18 does not change it.
  Worth a separate look, but not here.
- No UI list (user chose write + endpoint). #16 already surfaces the count + last reason.
- Stale/expired-pending cleanups (L955-980) are not "failed validations" (they never validated); not logged.

## Independent audit — engagement (2026-06-22)

Auditor verdict: plan fundamentally sound (insertion point, scope, collision key, non-fatal dual-guard,
endpoint mirroring all correct against the real code). Four MUST-FIX + two nice-to-haves. Disposition:

1. **Wrong mock cited — ACCEPTED.** Group A (the write) tests go in `test/scheduled-update.test.js`,
   reusing the existing stateful `validateClient` (L805) + `pendingRow()` (L839) + `captures.inserts`
   (which already records `insert` rows) — NOT the `audit-logging.test.js` mock. Group B (the endpoint)
   reuses the `audit-logging.test.js` mock (its `.limit()` knob already fits `loadValidationFailures`).
2. **Fixtures must omit `efStage`/`shadowModels` — ACCEPTED.** Reuse `pendingRow()` (omits both), so the
   EF-correlation (L1220) and shadow (L1388) blocks stay skipped and need no extra mock scripting.
3. **Add a soft-flag-only negative test — ACCEPTED.** Locked fixture (verified numerically):
   `lf={q:3000,h:2.6}`, `ef.h=5.0`, `waterTempC` unset → Check 1 EF-disc +120% (soft +2), Check 2
   stage-disc −66% (no hard), Check 3 false → `isSoftFlagged && !isHardFlagged`. Asserts a bin IS
   upserted (soft flags learn) AND no `validation_failure` row is written.
4. **Stale TODO.md count — ACCEPTED.** TODO.md L17 still says 645; authoritative is **654**
   (`npm test`). Bump to the real post-implementation count during the doc pass.

Nice-to-haves: (a) only Check 3 fires for `lf={q:1200,h:2.5}` (Check 2 is −40%, silent) — noted, A1
asserts `anomalyFlags` *contains* `LOW_FLOW_HIGH_STAGE` (LARGE_ERROR also present from the 300% raw
error, so an exact-array assert would over-specify). (b) A1 also asserts `hardScore≥2` to lock the verdict.

No findings rejected.

## Final test placement

- **Group A → `test/scheduled-update.test.js`** inside the `validatePendingPredictions` describe (L769-944),
  reusing `validateClient`/`pendingRow`/`usgs`/`binUpserts`/`metaUpsert`. A2 adds a backward-compatible
  `failInsertType` knob to `validateClient` (defaults null → existing callers unaffected).
- **Group B → `test/validation-failure-logging.test.js`** (new) for `loadValidationFailures`, mirroring
  the `loadAuditLog` tests in `audit-logging.test.js`.

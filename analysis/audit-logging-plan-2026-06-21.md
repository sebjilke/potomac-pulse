# #17 — Admin audit logging (write + view) — Plan

**Date:** 2026-06-21
**Files (load-bearing):** `netlify/functions/sync-learning.js` (reset handlers + GET dispatch). Client: `src/ui/learning-ui.js`, `index.html`, `src/init.js`. Protocol: plan → audit → implement (test-first) → re-audit.
**Goal:** Record every PIN-gated admin reset to an append-only `audit_log`, expose it via a GET endpoint, and show "Recent Admin Actions" in the Learning-tab diagnostics panel. Additive — does not change what the resets *do*.

## Scope (what's logged)
The 3 server-side PIN-gated actions in `sync-learning.js`: `resetLowFlowBins` (L530), `resetGFLearning` (L607), `resetForecastAccuracy` (L667). (Client-only `resetShadowModels` clears localStorage with no server round-trip → not server-loggable; out of scope, noted.)

## Schema (new observation_type — append-only, multi-row)
- `observation_type='audit_log'`, `gauge_id = `${Date.now()}_${action}`` (unique per entry; the forecast multi-row pattern).
- `data = { action: string, at: ISO string, details: object|null }` (details e.g. `{ deletedCount }` for low-flow).
- Unbounded growth is fine (manual resets are rare — a handful/month); pruning deferred (note in code).

## Server changes (`sync-learning.js`)
1. **`logAdminAction(client, action, details)` helper** — `insert` one `audit_log` row; wrapped in try/catch and **non-fatal** (a failed audit write must NOT break the reset or change its response). Added to `exports._test`.
2. **Call it after success** in each of the 3 reset handlers: `await logAdminAction(client, '<action>', {<relevant details>})`.
3. **Fix the stale hardcoded `resetReason`** at L653 (`'flow_state_window_fix_v35.0'` → `'manual_admin_reset'`) — it's a manual admin action now, not the v35.0 migration.
4. **New GET branch `endpoint==='audit-log'`** (near the other GET endpoints ~L252-289): select `audit_log` rows, `.order('created_at', {ascending:false}).limit(50)`, return `{ entries: rows.map(r => r.data) }`. Mirror the existing endpoints' error handling.

## Client changes
5. **`renderAuditLog()` (async) in `learning-ui.js`** — fetch `SYNC_API + '?endpoint=audit-log'`; render entries into a new `#auditLog` div (each: `at` (localized) · action · details summary). No-op if the element is absent (learning locked) or fetch fails (console.warn). Read-only.
6. **HTML:** a "🧾 Recent Admin Actions" subsection + `#auditLog` div in the `#learnUnlocked` panel (after the System Diagnostics / before bin stats).
7. **Wiring (`init.js`):** call `renderAuditLog()` once during `init()` (loads on page load if unlocked) AND `on('learning:reset', renderAuditLog)` so the list refreshes immediately after a GF-learning reset. (Forecast-accuracy reset has no event today — acceptable; it'll refresh on next load. Don't over-wire.)

## Tests (test-first, reuse #12's mock-Supabase idiom)
- New `test/audit-logging.test.js`:
  - `logAdminAction` inserts a row with the right observation_type/gauge_id-shape/data, and **swallows insert errors** (non-fatal — returns without throwing when the mock client errors).
  - The `audit-log` GET branch returns `{entries}` newest-first and tolerates empty.
  - A characterization test that a reset handler still returns its success `result` even when the audit insert fails (proves non-fatal).
- Reuse the chainable mock-client builder from `test/sync-learning-loadgf.test.js` (extend it with `.insert` capture if needed).
- `npm test` must stay green (645 + new).

## Version / docs
MINOR **v37.8** (additive feature; no model/estimate change). Update the usual version-string locations + README/CHANGELOG/tech-appendix rows.

## Audit engagement (independent auditor, 2026-06-21) — PROCEED w/ 5 must-fixes (ALL ACCEPTED)

1. **Call-site placement:** insert `await logAdminAction(...)` INSIDE each of the 3 action blocks (after that block's `result =`), before the block closes — NOT after the shared `return` at L692. The 3 reset blocks have no early-return, so this is safe.
2. **Testability extraction:** extract the GET branch into `loadAuditLog(client)` (mirrors `loadForecastAccuracy`/`loadValidationHistory`) and export `loadAuditLog`, `logAdminAction`, AND `saveGFLearningData` in `exports._test` (the reset handlers live inside `saveGFLearningData`, currently unexported).
3. **Test setup:** `ADMIN_PIN` is captured at module-load (L7) → the test must `process.env.ADMIN_PIN = '<pin>'` BEFORE `require`-ing the module, and pass the matching pin. Reset handlers take the `client` param (mockable, like `loadGFLearningData`).
4. **`resetReason` is user-visible** (`learning-ui.js:191` renders it in bin-stats) — the L653 change `'flow_state_window_fix_v35.0'` → `'manual_admin_reset'` is a deliberate user-visible improvement (old string stale); safe (no equality checks on it anywhere). Keep.
5. **Raw `.insert`** (append-only), matching sync-learning.js's existing raw `client.from(...)` idiom — NOT `upsertObs` (would clobber) and NOT a new `observations.js` import (the file doesn't use it).

Other: `loadAuditLog` orders by `created_at` desc (column confirmed to exist). `details` is `{deletedCount}` for low-flow, a short `{cleared:'…'}` for the other two (logAdminAction tolerates any object/null). GET branch placed AFTER the last existing endpoint block, before the 404 fallthrough. `resetForecastAccuracy` has no UI button today (dead from client) — logged defensively; its audit row only surfaces on a manual reload.

## Risks / open items for the auditor
1. **Non-fatal guarantee:** is `logAdminAction` truly isolated so a failed/`throw`ing audit insert cannot change the reset's success response or 500 it? (try/catch swallow + await placement after the reset's own writes.)
2. **GET dispatch:** does adding the `audit-log` branch risk shadowing/altering existing endpoint routing? Confirm placement + that unknown endpoints still fall through as before.
3. **gauge_id uniqueness:** `${Date.now()}_${action}` — collision only if the same action twice in 1ms (impossible for manual PIN resets); the unique-key conflict would throw → swallowed (non-fatal). OK?
4. **created_at ordering** for newest-first — does the row have `created_at` (DB default)? If not, order by `gauge_id` desc (epoch-prefixed string sorts correctly). Verify.
5. **Client fetch cadence:** `renderAuditLog` on init + on `learning:reset` only (not every `data:updated`) — sufficient freshness without per-render fetches?
6. **Unbounded growth** acceptable given rarity? Or add a cap now?
7. Anything that would break the live reset handlers.

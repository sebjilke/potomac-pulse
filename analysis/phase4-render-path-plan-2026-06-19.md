# Phase 4 — Render Path Refactor (Tier 3 #11) — Plan

**Date:** 2026-06-19
**Author:** implementing agent (pre-audit draft)
**Scope chosen by user:** *Event bus (decouple)* — introduce a tiny pub/sub bus, dissolve the
6 setter-injection callbacks + scattered manual re-render triggers, fold the 4s NWS render gate
into an `nws:arrived` event. **Render functions stay internally unchanged.**
**Explicitly NOT doing:** full reactive store (setter-emit reactivity) — unsafe while render
functions mutate state (`computeGFEstimate`/`recordGFEstimate`/`runShadowModels` run inside
`updateGreatFallsUI`); that needs a compute/render split first.

---

## 1. Goal & rationale

Replace the indirection that exists today for cross-module re-render triggers:

- **Setter injection** (6 callbacks): a producer module holds `let _fn = null; export function setFn(f){_fn=f}`
  and calls `if (_fn) _fn()`; `init.js` injects the real function. Used to avoid (the appearance of)
  import cycles between producers (`gf-learning.js`, `history.js`, `great-falls-ui.js`) and UI consumers.
- **Scattered direct calls**: `fetch.js` imports and calls `updateUI`/`updateLearningUI`/`updateCreeksUI`;
  `auth.js` imports and calls `updateGFBinStats`.

With a bus: producers emit a **string event**; consumers are subscribed **once in `init.js`**. Producers no
longer hold callback slots or export setters, and no longer import UI modules. The bus is a standalone
leaf module (imports nothing from the app), so importing it everywhere introduces **no new cycle**.

**Why a bus and not direct imports?** ES modules already tolerate the call-time cycles here (proven:
`fetch ↔ gauges-ui ↔ great-falls-ui` is a live static cycle today). We *could* just convert the injected
callbacks to direct imports. The bus is preferred because it inverts the coupling cleanly (producer knows
only an event name, not a function reference it must be handed), centralizes wiring, and allows N
subscribers per event. It also dissolves the `fetch ↔ gauges-ui` cycle as a side benefit (fetch stops
importing the UI modules).

**This is NOT a behavior change to renders.** Every event below reproduces an existing call, in the same
order, synchronously. The one intentional *timing* change is the NWS gate removal (§5), which the user
approved.

---

## 2. The event bus (NEW: `src/state/event-bus.js`)

A ~25-line synchronous pub/sub. Synchronous `emit` preserves the exact ordering of today's nested/sequential
calls. **No error swallowing** — a throwing handler propagates, exactly as a throwing direct call does today
(so `emit('data:updated')` aborting on a bad `updateUI` skips the rest, identical to the current sequential
statements in `fetch.js`).

```js
// src/state/event-bus.js — standalone pub/sub. Imports NOTHING from the app (leaf module).
const listeners = new Map(); // event -> Set<fn>

export function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => off(event, fn);
}
export function off(event, fn) { listeners.get(event)?.delete(fn); }
export function emit(event, payload) {
    const fns = listeners.get(event);
    if (!fns) return;
    for (const fn of [...fns]) fn(payload); // snapshot; propagate errors (match direct-call semantics)
}
export function clear() { listeners.clear(); } // test isolation only
```

Decisions:
- **Snapshot (`[...fns]`)** so a handler that (hypothetically) subscribes/unsubscribes during emit can't
  corrupt the iteration. Cheap insurance.
- **Propagate errors** (no try/catch). Behavior-identical to the current direct calls. (A future improvement
  could isolate per-handler errors; out of scope to keep "renders unchanged" honest.)
- `off`/`clear` exist for the unit test; `off`'s returned unsubscribe from `on` is unused by the app today
  but is the natural API (kept minimal).

---

## 3. Event catalogue (every event = an existing call, preserved)

| Event | Emitted by (was) | Subscribers wired in `init.js` (= today's callee) |
|-------|------------------|---------------------------------------------------|
| `data:updated` | `fetch.js` main render (was `updateUI();updateLearningUI();updateCreeksUI()` L423–426) | `updateUI`, `updateLearningUI`, `updateCreeksUI` (in this order) |
| `data:unavailable` | `fetch.js` error path (was `updateUI()` L405) | `updateUI` |
| `nws:arrived` | `fetch.js` NWS `.then` (was late `updateUI()` L432) | `updateUI` |
| `gf-estimate:rendered` | `great-falls-ui.js` `updateGreatFallsUI` (was `if(_updateGFLearningUI)_updateGFLearningUI()` L266) | `updateGFLearningUI` |
| `forecast-accuracy:updated` | `gf-learning.js` `loadForecastAccuracy` (was L147) | `updateForecastAccuracyUI` |
| `learning:reset` | `gf-learning.js` `resetGFLearning` (L174–175) + `resetLowFlowBins` (L203–204) | `updateGFLearningUI`, `updateGFBinStats` |
| `por-history:healed` | `history.js` `fetchServerPoRHistory` (was L96) | `updateGreatFallsUI` |
| `gf-history:updated` **(payload: `gfEstimate`)** | `history.js` `fetchServerGFHistory` (was L214 `_updateForecastPeriods(gfEstimate)`) | `updateForecastPeriods` (receives payload) |

> **Audit fix (Finding 1b):** `gf-history:updated` MUST carry `gfEstimate` as payload —
> `updateForecastPeriods(gfEst)` early-returns on `!gfEst` (`great-falls-ui.js:271,273`), so a bare emit
> would silently no-op. Emit `emit('gf-history:updated', gfEstimate)`; the bus forwards it (`fn(payload)`).
> All other converted calls are bare (no required arg) — verified.
>
> **Audit fix (Finding 9):** the `learning:unlocked` event is **DROPPED**. `auth.js → learning-ui.js` is
> one-way (non-cyclic), so converting `auth.js`'s two `updateGFBinStats()` calls breaks no cycle — pure
> churn. `auth.js` stays untouched with its direct import.

### Ordering & re-entrancy proof (no loops)

- `data:updated` → `updateUI` (nested `updateGreatFallsUI` → emits `gf-estimate:rendered` → `updateGFLearningUI`),
  then `updateLearningUI`, then `updateCreeksUI`. Matches current `fetch.js` L423–426 exactly (incl. the
  nested `_updateGFLearningUI` at GF-UI L266). `updateLearningUI` does **not** call `updateGFLearningUI`
  (it calls admin/shadow/leaderboard only — see map), so no double-render.
- No subscriber re-emits an event that re-enters it. Traced all 9 events:
  `updateGFLearningUI`/`updateGFBinStats`/`updateForecastAccuracyUI`/`updateForecastPeriods`/`updateCreeksUI`/
  `updateLearningUI` emit nothing. `updateUI`→`updateGreatFallsUI` emits only `gf-estimate:rendered`, whose
  handler emits nothing. **No cycles.**
- `learning:reset` preserves today's (redundant but harmless) double bin-render: `updateGFLearningUI`
  internally calls `updateGFBinStats` (learning-ui L52), then the separately-subscribed `updateGFBinStats`
  runs again — identical to today's L174 then L175. (Kept identical on purpose; not de-duped.)

---

## 4. File-by-file changes

**NEW `src/state/event-bus.js`** — the module in §2.

**NEW `test/event-bus.test.js`** — two layers:
- *Primitive unit tests* (the only render-related part testable without a DOM): `on`+`emit` calls all
  subscribers in registration order; payload is forwarded to handlers (guards Finding 1b's class of bug);
  multiple events are isolated; `emit` with no listeners is a no-op; `off` removes a listener; a throwing
  handler propagates (documents the chosen semantics); `clear` empties.
- *Static wiring consistency (audit Finding 7)*: read every file under `src/` with `fs.readFileSync`,
  regex-extract every `emit('…')` and `on('…')` event-name literal, and assert the two sets are equal —
  every emitted event has ≥1 subscriber and every subscription has ≥1 emitter. No DOM/Vite needed; runs
  under `node --test`. Catches typo'd/orphaned event names that the in-browser checklist could miss.

~12–14 assertions total. Raises `npm test` 626 → ~638.

**`src/data/fetch.js`**
- Remove imports of `updateUI` (gauges-ui), `updateLearningUI` (learning-ui), `updateCreeksUI` (creeks-ui)
  at L28–30. Add `import { emit } from '../state/event-bus.js'`.
- Error path L405: `updateUI()` → `emit('data:unavailable')`.
- Main path L411–434: remove the `nwsFinished` flag, the `Promise.race([nwsFetch, setTimeout(…,4000)])`,
  and the late-re-render `if (!nwsFinished){…}` block. Replace with: `emit('data:updated')` immediately
  after `setStatus(...)`, then `fetchNWSForecasts().then(() => emit('nws:arrived')).catch(e => console.warn('NWS forecast fetch error:', e))`.
  (See §5 for the exact replacement + the timing tradeoff.)
- Net: `fetch.js` no longer imports any UI module → the `fetch ↔ gauges-ui ↔ great-falls-ui` static cycle
  is dissolved.

**`src/init.js`**
- Remove the injection imports (L20–29) and the 6 `setUpdateX(...)` inject calls (L38–43).
- Add `import { on } from './state/event-bus.js'` and imports of the root render fns now wired here:
  `updateUI` (gauges-ui), `updateCreeksUI` (creeks-ui) — `updateLearningUI`, `updateGFLearningUI`,
  `updateGFBinStats` (learning-ui) and `updateForecastAccuracyUI`, `updateGreatFallsUI`,
  `updateForecastPeriods` (great-falls-ui) are mostly already imported.
- Wire all subscriptions from §3 at the **top of `init()`** (before any load/fetch), replacing the inject
  block. This guarantees subscribers exist before the first `fetchData()` (L83).
- Keep the one-time direct `updateLearningUI()` at L80 (init paint) and `buildBranches`/`buildCreeks` as-is.

**`src/learning/gf-learning.js`**
- Remove forward-decls L24–26 and setters L28–30 (`setUpdateGFLearningUI`, `setUpdateGFBinStats`,
  `setUpdateForecastAccuracyUI`). Add `import { emit } from '../state/event-bus.js'`.
- L147 `if (_updateForecastAccuracyUI) _updateForecastAccuracyUI()` → `emit('forecast-accuracy:updated')`.
- L174–175 → `emit('learning:reset')`. L203–204 → `emit('learning:reset')`.

**`src/data/history.js`**
- Remove forward-decls L18–19 and setters L21–22. Add `import { emit } from '../state/event-bus.js'`.
- L96 `if (_updateGreatFallsUI) _updateGreatFallsUI()` → `emit('por-history:healed')`.
- L214 `if (_updateForecastPeriods) _updateForecastPeriods(gfEstimate)` → `emit('gf-history:updated', gfEstimate)`
  **(payload required — audit Finding 1b).**

**`src/ui/great-falls-ui.js`**
- Remove forward-decl L31 and setter L32 (`setUpdateGFLearningUIRef`). Add
  `import { emit } from '../state/event-bus.js'`.
- L266 `if (_updateGFLearningUI) _updateGFLearningUI()` → `emit('gf-estimate:rendered')`.

**`src/ui/auth.js`** — **UNCHANGED (audit Finding 9 — conversion dropped).** `auth → learning-ui` is
one-way/non-cyclic; converting its two `updateGFBinStats()` calls breaks no cycle and is pure churn.
Leave its direct `import { updateGFBinStats }` and the L27/L50 calls exactly as-is.

**Docs (MINOR version bump v37.3 → v37.4 — client display/timing only, estimate output unchanged):**
- `index.html` `<title>`, `CLAUDE.md` params header, `README.md` (current-version + history table + footer +
  changelog range), `src/assets/tech-appendix.md` (current-version + footer), `src/assets/CHANGELOG.md`.

---

## 5. The 4s NWS gate removal (the one intentional behavior change)

**Today** (`fetch.js` L411–434): NWS is raced against a 4000ms timeout. The first render happens *after*
that race, so if NWS resolves < 4s the forecast **and gauge trend arrows** paint once, complete. If NWS is
slow, render with PoR+EF, then re-render (full `updateUI`) when NWS lands.

**After:** render immediately (no wait), then re-render on NWS arrival:
```js
setStatus(dataSource === "live" ? "ok" : (dataSource === "stale" ? "stale" : "cached"));
emit('data:updated');
fetchNWSForecasts()
    .then(() => emit('nws:arrived'))
    .catch(e => console.warn('NWS forecast fetch error:', e));
```
`nws:arrived` is wired to **`updateUI`** (not just the forecast) because gauge trend arrows (`#lfTrend`,
`#trend-${id}`) and the forecast cards are *all* NWS-driven — matching today's late re-render which also calls
the full `updateUI()` (L432).

**Visible tradeoff (accepted — sharpened by audit Finding 5):** first paint never waits up to 4s, but the
NWS-driven bits now **always** repaint one beat late — even when NWS is fast (the common case, where today
the user sees a single complete paint). Two distinct effects:
- Gauge trend arrows (`#lfTrend`, `#trend-${id}`): "n/a → value" flash.
- **48h forecast cards: a content FLIP, not just a fill.** `updateForecastPeriods` gates on `efReady`, not
  NWS, so the immediate pre-NWS paint renders the **linear-extrapolation fallback** cards
  (`great-falls-ui.js:444-468`), which then flip to NWS-based cards on `nws:arrived`. Today (NWS<4s) the user
  never sees the extrapolation cards. This is the **highest-scrutiny item for in-browser verification.**

**Mitigation (deferred, not built):** if the flip looks bad in-browser, gate the forecast-card section on
`hasNWSForecast` to show a "forecast loading…" placeholder on first paint instead of extrapolation cards
(keeping extrapolation only as the genuine NWS-failed fallback). NOT implemented up front — it's a render-
logic change beyond "renders unchanged" and a UX judgment best made after seeing the actual flip. Decide
with the user post-verification.

**Correctness note:** `storeForecastPredictions` (inside `updateForecastPeriods`) only stores
`source.startsWith('NWS')` forecasts and is throttled to 2h, so the immediate (pre-NWS, extrapolation-only)
paint stores nothing and the `nws:arrived` paint stores the NWS forecasts — same end state as today, no
double-store.

---

## 6. Tests & verification

- **`npm test` must stay green** (626 + new bus tests). The model/estimation path is untouched, so
  characterization / parity / golden tests are unaffected.
- **Bus primitive**: unit-tested (`test/event-bus.test.js`).
- **Wiring + render behavior**: **NO DOM tests exist** — must verify **in-browser** (Code-Change
  Verification Protocol + project "Deployment & Verification" rule). Checklist:
  1. Cold load → Great Falls tab paints estimate, inputs, EF cross-check; gauge list paints; map paints.
  2. **§5 forecast flip (highest scrutiny):** on a normal (fast-NWS) load, confirm whether the forecast
     cards visibly flip extrapolation→NWS and whether the trend-arrow "n/a → value" flash is objectionable.
     If bad → discuss the placeholder mitigation with the user.
  3. Refresh button → full re-render, no stale panels, no duplicated/again-flashing content.
  4. Learning tab: unlock with PIN → bin-stats table renders (`auth.js` direct call, unchanged). Reset GF
     learning / reset low-flow bins → learning UI + bin stats refresh (`learning:reset`).
  5. Creeks tab renders + chart expand/collapse works.
  6. Console: no errors, no "Maximum call stack" (re-entrancy), no unhandled NWS rejection.
- **Slow-NWS simulation** (DevTools throttling or block the NWS host): confirm gauges/estimate paint
  immediately and forecast/trends fill in on arrival (no hang, no permanent n/a).

---

## 7. Risks & open items for the auditor

1. **No DOM test net** — wiring correctness rests on in-browser checks. Auditor: is the §6 checklist
   sufficient, and is anything render-affecting NOT covered by an event in §3?
2. **Completeness** — did §3 capture *every* setter-injection usage and *every* manually-triggered render?
   (Cross-check against the call-site map: `updateUI`, `updateLearningUI`, `updateCreeksUI`,
   `updateGreatFallsUI`, `updateForecastPeriods`, `updateGFLearningUI`, `updateGFBinStats`,
   `updateForecastAccuracyUI`, `updateShadowModelUI`, `updateShadowLeaderboardUI`, `updateAdminDashboard`.)
   Note: `updateShadowModelUI`/`updateShadowLeaderboardUI`/`updateAdminDashboard` are **intra-module nested
   calls** (within learning-ui / within updateGreatFallsUI) and `resetShadowModels`→`updateShadowModelUI`
   (learning-ui L542) is intra-module — these are NOT setter-injected and are intentionally left as direct
   calls. Confirm that's correct (no cross-module cycle there).
3. **Ordering fidelity** — does synchronous `emit` with registration-order iteration reproduce the exact
   current sequence, including the nested `gf-estimate:rendered` mid-`updateUI`?
4. **NWS gate** — is the §5 timing tradeoff acceptable / correctly scoped to `updateUI`? Any consumer of
   NWS data not refreshed by `nws:arrived → updateUI`?
5. **Dangling references** — after removing the 6 setters, confirm `init.js` is the *only* importer (grep);
   no other module imports `setUpdateGFLearningUI` / `setUpdateGFBinStats` / `setUpdateForecastAccuracyUI` /
   `setUpdateGreatFallsUI` / `setUpdateForecastPeriods` / `setUpdateGFLearningUIRef`.
6. **`auth.js` conversion** — keep (consistency) or drop (smaller blast radius)?
7. **Error semantics** — propagate vs isolate per-handler. Plan chooses propagate (behavior-identical).
   Concur?
8. **Version bump** — MINOR (v37.4) correct? (No estimate-output change for same inputs; render timing only.)

---

## 8. Audit engagement (independent auditor, 2026-06-19)

Auditor verdict: *"Not safe to implement exactly as written — one real bug must be fixed first"* (Finding 1b),
core architecture sound. Disposition of every finding:

- **1b — `gf-history:updated` dropped the `gfEstimate` arg → silent no-op. ACCEPTED (blocker fixed).** Now
  emits with payload; bus forwards it; subscriber receives it. See §3/§4. Re-verified all other converted
  calls are bare/argless.
- **5 — first-paint forecast *content flip* (extrapolation→NWS), not just a fill. ACCEPTED.** §5 sharpened;
  placeholder mitigation documented but deferred to post-in-browser decision with the user.
- **7 — add static `emit`/`on` consistency test. ACCEPTED.** Added to `test/event-bus.test.js` (§4/§6).
- **8 — grep `37\.3` exhaustively (README L58 "Current Model", tech-appendix L652 range string). ACCEPTED.**
  Will grep rather than work from a list.
- **9 (auth.js) — DROP the optional conversion. ACCEPTED.** `auth.js` untouched; `learning:unlocked` event
  removed from the catalogue.
- **2, 3, 4, 6 — RESOLVED by auditor** (setter inventory complete + init.js sole importer; re-entrancy
  airtight; ordering faithful; cycle dissolution correct). No change needed.
- **Pre-existing `[object Object]` at `learning-ui.js:208`** (`por?.trend` is an object post-NWS) — auditor
  confirms it's NOT introduced by this refactor. **Out of scope; not touched.** Noted to user separately.
- **`gf-estimate:rendered` naming** (fires *during* render, cosmetically imprecise) — kept; not worth churn.
- **`off`/`clear` unused in app** — kept (test-only; tree-shaken in build).

**Net plan after engagement:** 8 events (was 9 — dropped `learning:unlocked`); `auth.js` untouched;
`gf-history:updated` carries payload; bus test gains the static wiring check. Cleared to implement.

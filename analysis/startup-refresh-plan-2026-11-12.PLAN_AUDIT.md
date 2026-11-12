# v39.7 plan: independent plan audit (2026-11-12)

Auditor: a fresh subagent that did not write the plan. Text as returned, saved by the orchestrator. No code had been changed.

## Verdict: approve_with_changes

The plan's direction is sound. Its decision to keep `period=P7D` holds up, and the change is stronger than the plan states. Do not implement as written. Three defects would make item 4 fail on the very cases it exists for:

1. `fetchSettled` is set in `fetchData`'s `finally`, after the last render has already happened. No render ever sees it, so the "unavailable" state never appears when USGS is down. When only Edwards Ferry is down, it appears only by accident, when NWS lands later (PA-1).
2. `.btn { display: flex }` overrides the HTML `hidden` attribute, so "Try again" would show all the time. Nothing in the plan hides it again once a number is shown (PA-2, PA-3).
3. Two small correctness holes in the new machinery:
   - The admin reset can be overwritten by an older request that was still in flight (PA-4).
   - The "negative age means resume" rule refetches on every tab switch for up to 5 minutes on a phone whose clock is slow (PA-5).

Baseline: I ran `npm test`. Result: 1224 tests, 1222 pass, 2 skipped, 0 fail. The plan's 1223 comes from TODO.md and is off by one.

## Findings

**PA-1. must-fix. `fetchSettled` is never seen by a render.**
- Evidence: plan 4b says "set true in fetchData's finally". In `fetch.js`, `emit('data:unavailable')` (L517) and `emit('data:updated')` (L527) both run before `finally { setIsFetching(false); }` (L549-551), and nothing renders after the `finally`.
- If USGS is down and there is no cache: the card stays on "..." or "Waiting for data..." for ever. This is the F2 bug, unfixed.
- If only Edwards Ferry is down: the message appears only when `nws:arrived` happens to re-render 0 to 20 s later.
- Change: call `setFetchSettled(true)` immediately before each of the two final emits. Also call it in `finally` for the exception path, and there trigger one card render if the flag changed (see PA-7).
- Add a fake-browser test in the `data-freshness.test.mjs` style: Edwards Ferry fetch fails, USGS succeeds. After one `fetchData()`, the card state must be `unavailable` with no further event.

**PA-2. must-fix. The `hidden` attribute does not hide `.btn`.**
- Evidence: `main.css:52-62` `.btn { ... display: flex; ... }`. No `[hidden]` rule exists in `src/styles`. Author CSS beats the browser's `[hidden]{display:none}`.
- Change: add `#gfRetryBtn[hidden] { display: none; }` to `main.css`, and a source test that the rule exists. Do not add a global `[hidden]{display:none !important}` without checking every other element that uses `hidden`.

**PA-3. must-fix. The retry button is never hidden on the ready path, and the helper can overwrite the ice label.**
- Evidence: plan 4c calls `renderGFCardGate(view)` only "before each `renderCapIndicator(null)`". That means only the two early-return branches. The ready path (from L127) never runs the helper, so after a successful retry "Try again" stays next to a valid number.
- The second early-return segment also contains the ice branch (L106-112). If the helper "restores ESTIMATED NOW" for non-unavailable kinds, it overwrites the ice "UNAVAILABLE" label.
- Change:
  - Set `gfRetryBtn.hidden = true` at the top of `updateGreatFallsUI`, after the DOM check. The helper only shows it, and only for `unavailable`.
  - The helper must be a no-op for the ice kind.
  - Define the helper above `updateGreatFallsUI`. The helper must contain no `return;` line and no `renderCapIndicator` call. `cap-indicator.test.mjs` splits the rest of the file on `\n\s*return;\n` and counts `renderCapIndicator(null)` from `export function updateGreatFallsUI` to the end of the file.
  - Do not add a new `return;` inside the second segment. Branch with if/else instead.

**PA-4. must-fix. The admin reset can be overwritten by an older request.**
- Evidence: plan 2.1 says `force: true` "skips sharing". The older shared request still resolves later and calls `setGfLearningData` with pre-reset data, after `resetGFLearning` (L195-196) has already emitted `learning:reset`. Also, the old promise's cleanup can null out `inFlight` while the forced request is still running.
- Change:
  - Keep a module counter `gen`. Each request takes `my = ++gen` and writes to the store only if `my === gen`.
  - Clear with `if (inFlight === p) inFlight = null`.
  - Test: start a normal load, start a forced load, resolve the forced one first and then the old one. The store must hold the forced payload.

**PA-5. must-fix. "Negative age means resume" refetches repeatedly on slow device clocks.**
- Evidence: `bodyTimeMs` (`data-freshness.js:87`) accepts a body up to `CLOCK_SKEW_MIN` = 5 min in the future. So any negative age `lastGoodMs` sees is within -5 min, and it happens exactly when the device clock is 1 to 5 min slow.
- Plan 3 says negative age returns true. On such phones, every `visibilitychange`, `pageshow` or `online` event in the 1 to 5 min after each fetch (whatever the clock offset is) starts a full 2.9 MB fetch plus about 34 NWS calls, limited only by the 60 s gap.
- Change: clamp the age to 0 when it is between -5 min and 0. Only a larger negative age, meaning the clock was moved back, should count as unknown. Add both cases to the `refresh-policy` truth table.

**PA-6. should-fix. Refresh cycles can now change the number twice within seconds.**
- Evidence: today the interval in `main.js:57-60` awaits learning, then fetches, so it renders once. With `refreshAll` running both in parallel and `gfDataReady` already true, the fetch usually finishes first (`/api/sync` is under 2 s but USGS P7D is about 1 s TTFB plus 2.9 MB). It then renders new gauge data with the previous correction, and `learning:loaded` re-renders a moment later.
- The plan's skip rule only handles the opposite order. The intermediate number is not "wrong" (it is the correction v39.6 showed for the previous 15 min), but it is a visible flicker. It is also an extra pass of `recordGFEstimate`, `runShadowModels` (which saves shadow state on every call) and `storeForecastPredictions`.
- Change, pick one:
  - (a) Smallest: keep `main.js` sequential (learning with the new deadline, then `fetchData`) and use parallel start only at startup.
  - (b) Cleaner: when `gfDataReady` is already true, have `fetchData` await the shared learning promise (bounded by the deadline) after its `Promise.all` and before `processData`. Then a refresh renders once, and wake and ↻ keep the parallel network.
- State the choice in the plan.

**PA-7. should-fix. The plan's safety argument for skipping the `learning:loaded` render is partly false.**
- Evidence: plan 2.3 says "The exception path is covered by 4e". It is not: 4e only re-enables `#refreshBtn`. If `processData` or a handler throws while learning settled mid-fetch, nothing renders with the new learning. This is no worse than v39.6, but the claim must not stand.
- Change, simplest robust form: add one `emit('fetch:settled')` in `fetchData`'s `finally`, after `setIsFetching(false)`, wrapped in try/catch. Subscribe one handler in `init.js`/`refresh.js` that:
  - re-renders the card if learning settled during the fetch (replaces the skip-and-hope rule);
  - sets `fetchSettled` (with PA-1);
  - consumes `resumePending` (PA-8).
- This is one hook in place of three separate mechanisms. The event-bus static test will require the matching `on`.

**PA-8. should-fix. A deferred resume is dropped when the blocking fetch is the early-refetch timer's fetch.**
- Evidence: plan 3 consumes `resumePending` "when `refreshAll` finishes". The early timer calls `fetchData({ early: true })` directly (`fetch.js:539`), not `refreshAll`. A wake during that fetch sets the flag, and nothing reads it until the next `refreshAll` (up to 15 min).
- Change: consume the flag when the fetch finishes (the PA-7 hook), not in `refreshAll`.
- Note on bounds: when the radio is not up yet, the plan allows up to three full downloads in about 60 s (the frozen fetch, the forced re-run, the early timer). That is bounded and acceptable, but put it in the plan's risk list.

**PA-9. should-fix. Emitting from inside the loader can turn a successful reset into a "Reset failed" alert.**
- Evidence: `event-bus.js:52` does not catch handler errors. `resetGFLearning` awaits the loader inside a try whose catch shows `alert("Reset failed: ...")` (L200-202) and skips `emit('learning:reset')`.
- Change: wrap `emit('learning:loaded')` in try/catch inside the loader, or emit it from `refreshAll` instead. The reset path already has `learning:reset`.

**PA-10. should-fix. The Netlify time limit claim is wrong.**
- Evidence: `docs.netlify.com/build/functions/configuration/` today lists "Synchronous execution limit | 60 seconds | Configurable: No". Plan 2.1(c) says 10 s.
- Change: delete reason (c). The 10 s deadline still stands on reasons (a), (b) and (d).
- Also have the helper race a timer rather than rely only on abort reaching `response.json()`. Otherwise the "stalled body" test passes only if the stub happens to honour the abort signal.

**PA-11. should-fix. Lazy outlines can add a duplicate layer on retry.**
- Evidence: plan 3b has one `ensureOutlines()` with one "started" flag cleared on failure. If one of the two files loads and the other fails, the next map open re-adds the layer that already loaded.
- Change: one run-once promise per file, retrying only the one that failed. A module-level promise per file inside `map.js` may be enough. `map-outlines.js` is optional and exists only for testability.

**PA-12. should-fix (scope). Drop 3c (flood-category deferral) from v39.7.**
- These calls start after first paint (`fetch.js:542`), so deferring them does not make the first load faster, which is item 3's goal. The cost is:
  - a store flag and a changed function signature;
  - a new `emit('nws:arrived')` site, which forces a full `updateUI` and card render (with the PA-6 side effects);
  - duplicate category calls if the map is opened during a cycle;
  - a new delay on a safety-related display.
- A benefit the plan missed, for the follow-up: the `pp-data` service-worker cache has `maxEntries: 32` (`runtime-caching.mjs`), but it holds 34 to 85 NWS URLs plus Edwards Ferry, temperature, creek and proxy entries. Least-recently-used eviction can push out the Edwards Ferry saved copy that offline use relies on. That belongs in its own cache plan, not here.

**PA-13. note. Corrections to the ice-lookback text. The decision stands and is stronger.**
- The fact is confirmed: the loop at `fetch.js:210-223` walks the whole 7-day series, and the "2-day window" comments at L224 and L229 are stale.
- Two errors in the plan's text:
  - The Little Falls case does not flip "from EF-ONLY". EF-only is the Point of Rocks ice path (`great-falls.js:344-357`). With P3D, a Little Falls ice episode of 3 to 7 days loses `lf.q`, so `estimateGreatFalls` returns null at L335-337 and the card goes from a normal estimate to the ice "UNAVAILABLE" state.
  - Point of Rocks is also affected. With `iceLongTerm`, `fillMissingData` fills Point of Rocks `q` from the drainage ratio and marks it estimated (`fetch.js:300-308`), so the estimate input changes.
- A safe cut the plan missed, for a follow-up only: the 19 stage (00065) series need only their last point. Splitting the call would change the service-worker route, the proxy chain and three tests, so it does not belong in v39.7.

**PA-14. note. The bin table can stay empty for a signed-in admin.**
- `initAuth()` (init L98) now runs before learning arrives. If no estimate renders (Edwards Ferry down), `gf-estimate:rendered` never fires, so the bin table stays "No bin data available".
- Change: `onLearningLoaded` also calls `updateGFLearningUI()`.

**PA-15. note. The click event reaches `refreshAll` as its first argument.**
- `bindButton` passes the MouseEvent. If `refreshAll` ever takes options, the event will be read as options.
- Change: bind `() => refreshAll()` for both buttons.

**PA-16. should-fix. Tests.**
- Add:
  - PA-1 behaviour test;
  - PA-2 CSS source test;
  - PA-3 test: the button is hidden after a ready render, and the ice label survives;
  - PA-4 race test;
  - PA-5 skew rows;
  - PA-8 test: a pending flag set during an early-timer fetch is consumed.
- `startup-wiring.test.mjs` only checks that strings exist. It passes even when the wiring does nothing. Keep it minimal and do not count it as coverage of behaviour.
- `refresh.test.mjs` tests `createRefresher` with stubs, not the real link between the flag and fetch completion. That link needs the fake-browser harness.
- Still untested: the order of the two renders (PA-6), iOS wake, the lazy outline layer order.

**PA-17. note. Simplicity.**
- Merge `refresh-policy.js` into `refresh.js`.
- Put the deadline helper inside `gf-learning.js` (its only user). It is a local function, so it creates no import cycle.
- That leaves two new pure files (`refresh.js`, `gf-card-state.js`) plus `map-outlines.js` only if wanted.
- Keep 4e only if it also releases `#gfRetryBtn`.

**PA-18. note. Docs.**
- The six version places plus the footer span plus the CHANGELOG row match what the tests check: pageMeta, the CLAUDE.md heading, the appendix "Current version", the appendix footer, README, and TODO `current version:` in lower case.
- Fix the baseline to 1224 / 1222 / 2.
- Record the accepted and rejected audit findings in the revised plan, as CLAUDE.md requires.
- The new CLAUDE.md bullet should say `SERVER_VERSION` stays v39.6.

**PA-19. should-fix. Deploy verification.**
- CLAUDE.md "Deployment & Verification" requires an end-to-end browser check with Chrome MCP tools. Plan section 13 leaves all browser checks to the owner.
- Add a fresh-verifier Chrome MCP pass:
  - fresh load shows a number on the card;
  - "Try again" is not visible;
  - the network list shows no `.geojson` request before the map button is pressed;
  - outlines appear after it is pressed;
  - no console errors.
- curl additions:
  - the built CSS contains the `#gfRetryBtn[hidden]` rule;
  - `index.html` has the button with `hidden`;
  - the CSP header from `curl -sI /` is unchanged.
- The curl string greps are fine: string literals survive minification.

**PA-20. note.** The button sits inside `#gf-estimate-display`, which has `aria-live="polite" aria-atomic="true"`. Every update re-announces "Try again", and focus is lost when the button hides after a successful retry. Accept this, or place the button just after the live region.

**PA-21. note.** Each extra card render steps the shadow models and saves their state (`shadow-models.js:283-326`). This is display-only but real. It adds weight to PA-6 and PA-12.

## Checked claims

| Claim | Result |
|---|---|
| `init.js` L88 await, L93-101 UI build, L104 fetch, catch L105-112 never loads learning | confirmed |
| `main.js:57-60` interval loads learning, then fetches | confirmed |
| `gf-learning.js` L42 bare fetch; L58-69 `emptyData` only if null; L72 ready set on every outcome | confirmed |
| A hang leaves `gfDataReady` false and the card on "..." | confirmed |
| Card gate at `great-falls-ui.js:80-81` | confirmed |
| `history.js:96` emits only when `gfDataReady` | confirmed |
| `fetchWithTimeout` clears its timer once headers arrive (L75-90) | confirmed |
| No event fires when learning finishes | confirmed |
| Every `fetchData` exit renders | partly wrong: true for normal exits; an exception renders nothing, and 4e does not cover it (PA-7) |
| Netlify synchronous limit is 10 s | wrong: 60 s, not configurable (PA-10) |
| Guard at L405-406 has no race; `finally` covers the early return | confirmed |
| `lastFetchTime` is set in `accept()` even for a saved copy | confirmed |
| Early timer conditions; memo in `data-freshness.js` | confirmed |
| Data-freshness test 29 relies on the `clearTimeout` stub; test 21 reads the online/offline lines in `init.js` | confirmed |
| `creek-level.test.mjs:391` reads `init.js` | confirmed |
| `#gf-data-source` is `display:none` (`index.html:134`) | confirmed |
| `NWS_LIDS` has 17 entries; Edwards Ferry is not among them | confirmed |
| 4 USGS calls per refresh | confirmed |
| `SERVER_VERSION 'v39.6'` at L2228 | confirmed |
| `floodCategory` is read only at `gauges-ui.js:216` | confirmed |
| `processData` starts with `setData({})` (L172) | confirmed |
| Point of Rocks trend is the flow-state fallback (about L463) | confirmed |
| Ice lookback walks 7 days | confirmed |
| Little Falls goes from "EF-ONLY" to unavailable | wrong label (PA-13); Point of Rocks also affected |
| `POR_HISTORY_MAX_AGE` 72 h (`constants.js:10`) | confirmed |
| Correction is 0 "through `great-falls.js:66-67`" | wrong anchor: that is the CI code; the correction goes through `applyGFCorrection` (L506) |
| Geojson loaded in `initMap` L125/128; only `toggleMap` adds `show-map`; `vite.config.js:23` precaches geojson | confirmed |
| `/api/sync` is not routed by the service worker | confirmed (`runtime-caching.mjs` comment and pattern) |
| Structural test in `cap-indicator.test.mjs` (lines 313-322) | confirmed; constraints in PA-3 |
| `.btn` with `hidden` hides the button | wrong (PA-2) |
| Test baseline 1223 | wrong: 1224 (1222 pass, 2 skipped) |
| Server uses P2D; `sw-runtime-caching` test 6 | not checked |

## The five defaults

1. **No automatic learning retry: agree.** Wake refresh, ↻, Try again and the 15 min timer already recover it. An automatic retry adds a timer path for no requirement.
2. **Keep 10 s: agree**, with the justification corrected (PA-10). A 6 s cut would show uncorrected numbers more often.
3. **Defer flood categories: object.** Drop the step from v39.7 (PA-12). It does not touch first paint, and it adds risk to a safety-related display.
4. **iPhone cache-write check as an optional owner check: agree.** It only sets the urgency of the 3d follow-up.
5. **Wording: agree.** Optional: drop the "Estimate unavailable." prefix, because the label already says UNAVAILABLE and the reason alone is shorter. "Try again" is fine.

## What I could not check

- Any browser behaviour: iOS wake and frozen fetches, whether `pageshow` fires on iOS, whether Leaflet loads tiles for a hidden map, localStorage quota.
- Whether the live site matches `dist/`.
- Whether `getGFCorrection` with empty bins returns exactly 0 (I did not trace `shared-model.js`).
- The server's P2D period, and `sw-runtime-caching` test 6 line by line.
- NWS latency.
- I did not build or run the app. I made no changes.

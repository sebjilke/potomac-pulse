# C8 + C16 Server Travel-Time Parity & PoR-History Coverage Fix — Plan

**Date:** 2026-06-18
**Version:** MINOR **v36.4** (user-decided)
**Protocol:** Code-Change Verification (plan → independent audit → implement → re-audit → test → push-approval → deploy-verify). Load-bearing: `scheduled-update.js`, `shared/model.js`.

## Goal & locked decisions

- **C8 — Full parity (user-chosen):** make the SERVER compute PoR→GF travel time with the same algorithm as the client — the 3-iteration convergence **and** the outlier-robust historic-reading selection — replacing the server's single-pass + raw-closest lookup.
- **C16 — Retention only (user-chosen):** raise server PoR-history retention 48h→72h via a shared named constant (matches the client's `POR_HISTORY_MAX_AGE`). No null-path hardening.
- **Version MINOR v36.4 (user-chosen).**

### Honest scope of "parity" (do not over-claim)
C8 buys **algorithmic** parity: client and server will use the *same method*, so on *identical inputs* they produce the *same* travel time and historic-PoR pick. It does **not** make the displayed (client) and validated (server) values bit-identical, because they consume **different PoR-history sources by design**:
- Client `porHistory` = noisy localStorage merge (≤72h, may contain stale/out-of-order/glitch entries); its rise-rate uses robust median-of-record selection (`getPoRRiseRate`, great-falls.js:160, *deliberately divergent* — documented at :153).
- Server `porHistory` = clean USGS rebuild, pre-sorted each cron.

Because the server history is clean, `selectHistoricReading` (which only drops >40%-off-median outliers) is **≈ a no-op on server data** — it reduces to "closest within 1h," i.e. today's behavior. So the **substantive** server behavior change from C8 is the **iteration**; the reading-selection port is algorithmic-parity insurance + future-proofing, essentially behavior-neutral today. The deliberate client/server rise-rate divergence is **out of scope** and stays.

## Files changed

### 1. `netlify/functions/shared/model.js` (server pure-math, CJS) — additions
Add CJS copies (logic byte-identical to the client originals, console.logs dropped) + exports:
- `medianCfs(entries)` and `selectHistoricReading(history, targetTime, opts)` — mirror of `src/estimation/rise-rate-robust.mjs:15-20, 71-88`.
- `getPoRtoGFTravelTime(mult, riseRate)` and `getGFtoLFTravelTime(mult, riseRate)` — mirror of `src/estimation/great-falls.js:28-50` (apply the `min(0.30, ratePerHour*0.02)` rising-celerity reduction internally).
- `const POR_HISTORY_MAX_AGE = 72 * 60 * 60 * 1000;` (mirror of `src/model/constants.js:11`) + export.

**Sync obligations (document in-file with SYNC comments):**
- `selectHistoricReading`/`medianCfs` ↔ `src/estimation/rise-rate-robust.mjs`
- `getPoRtoGFTravelTime`/`getGFtoLFTravelTime` ↔ `src/estimation/great-falls.js`
- `POR_HISTORY_MAX_AGE` ↔ `src/model/constants.js`

### 2. `netlify/functions/scheduled-update.js` — server logic
- **Imports:** add `getPoRtoGFTravelTime, getGFtoLFTravelTime, selectHistoricReading, POR_HISTORY_MAX_AGE` from `./shared/model`.
- **`getPoRFromHistory` (397-422):** replace the manual raw-closest scan with `const closest = selectHistoricReading(history, targetTime);` then map to `{ cfs: closest.cfs, actualHoursAgo: (Date.now()-closest.timestamp)/3.6e6 }` (keep current return shape; include `stage` only if callers need it — they don't). Preserve the `null` return when no candidate within 1h.
- **Travel block (683-697):** replace single-pass + inline celerity with the iteration (mirrors client great-falls.js:344-382):
  ```
  const riseRate = getPoRRiseRateFromHistory(porHistory);
  let mult = getFlowMultiplier(lf.q);                 // scalar (server). == client data._mult.mult
  let travelPoRtoGF = getPoRtoGFTravelTime(mult, riseRate);
  let historicPoR = null;
  for (let iteration = 0; iteration < 3; iteration++) {
      const tryHistoric = getPoRFromHistory(porHistory, travelPoRtoGF);
      if (!tryHistoric) break;
      historicPoR = tryHistoric;
      const historicMult = getFlowMultiplier(historicPoR.cfs);
      const newTravelTime = getPoRtoGFTravelTime(historicMult, riseRate);
      if (Math.abs(newTravelTime - travelPoRtoGF) < 1.0) break;   // converged: keep historicPoR + current travel/mult
      travelPoRtoGF = newTravelTime;
      mult = historicMult;
  }
  const travelGFtoLF = getGFtoLFTravelTime(mult, riseRate);
  ```
  Removes the inline celerity block (687-694) — celerity now lives inside the helpers (parity). `historicPoR` flows into the existing 705-729 shifted/unshifted branch unchanged. The existing `porRiseRate` console.log is preserved via the helper's internal log (or kept once before the loop).
- **`storePoRHistory` (272):** `const cutoff = Date.now() - POR_HISTORY_MAX_AGE;` (was `48*60*60*1000`).

### 3. Tests
- **`test/travel-time-parity.test.mjs` (NEW):** import the client travel helpers + `selectHistoricReading` from `src/...` and the server copies from `netlify/functions/shared/model.js`; assert byte-equality of `getPoRtoGFTravelTime`/`getGFtoLFTravelTime` over a grid of (mult, riseRate) and `selectHistoricReading` over crafted histories (outlier present/absent, sparse, empty). Mirrors `correction-parity.test.mjs`.
- **`test/scheduled-update.test.js`:** (a) unit-test the iterated travel loop via the `_test` seam on a synthetic `porHistory` + `lf.q` — assert it converges and picks the same historic reading the client algorithm would; (b) low-flow case (lf.q≈1000, history extending to ~60h) now returns a time-shifted reading instead of null (C16); (c) `selectHistoricReading` drops a single +50% glitch and keeps the real closest.
- **`test/model.test.js`** (or the parity file): assert `POR_HISTORY_MAX_AGE` server == client (72h).

### 4. Docs (MINOR bump)
- `CLAUDE.md`: version → v36.4; Nowcast §: note the server now iterates travel time to PoR-self-consistency (client/server use the same algorithm); PoR history retained 72h (≥ max travel 50.6h). Add the new shared/model.js ↔ source sync pairings to the sync list (§96/§128 area).
- `src/assets/tech-appendix.md`, `README.md`, `src/assets/CHANGELOG.md`: v36.3→v36.4; CHANGELOG entry describing C8 (server travel-time iteration + robust reading selection = algorithmic parity) and C16 (retention 48→72h closes the low-flow coverage gap); footer/version-history rows.

## Side effects / risks
- **EMA re-learning:** the server's validated raw estimate shifts slightly at low flow (iteration changes the looked-up historic PoR). The 18 correction bins learn on the raw residual (EMA α=0.3), so they re-converge over ~10-15 obs. Low-flow bins are sparse (per the C45 diagnostic) → a brief transient in those bins only. No effect on high/steady flow (iteration converges in 1 pass there → identical to today).
- **C16 storage:** the single `por_history` row grows from ~48h to ~72h of hourly readings (~24 extra small entries) — negligible.
- **Convergence semantics:** must replicate the client's "break-on-converge keeps the current `historicPoR`/travel/mult" exactly (don't update after the convergence check). Covered by the parity test.
- **`selectHistoricReading` on clean data:** ≈ no-op (confirmed). If ever the server history carried an outlier, behavior would now match the client's robust pick — desirable.

## Verification path (stated upfront, per global rule)
1. `npm test` green (existing 418 + new parity/loop/retention tests).
2. `npm run build` clean.
3. **Fresh subagent re-audit** of the diff vs this plan (gets goal + diff only).
4. Push only on explicit user approval → Netlify gate (`npm install && npm test && npm run build`) → auto-deploy from `main`.
5. **Fresh subagent deploy-verify:** confirm v36.4 title live; spot-check a cron cycle wrote sane `gf_metadata` + a time-shifted estimate (the C16/C8 paths only diverge at low flow, so live confirmation of *no regression* in normal flow + green tests is the bar; the low-flow path is unit-tested, flagged as unverified-until-a-low-flow-event otherwise).

## Open questions for the auditor
- **Architecture:** add server CJS copies (this plan, minimal client risk) vs. centralize the travel helpers into the `shared-model.js`↔`shared/model.js` pair and refactor `great-falls.js` to import them (cleaner single-source, more churn)? Recommend the former for a low-severity fix; defer to auditor.
- **Seed edge case:** client falls back `mult=1.0` if `data._mult` missing; server uses `getFlowMultiplier(lf.q)` always. In practice `data._mult` is always set (fetch.js:125) and `lf.q` always present. Worth a guard, or note-only?
- Any doc claim (tech-appendix §5.5/§8.1 travel-time) that becomes stale or newly-true and must change?

## Audit resolutions (2026-06-18, independent 3-lens panel)

All findings accepted; none rejected. Revised decisions:

- **[F1 blocker] Centralize the travel helpers.** Move `getPoRtoGFTravelTime`/`getGFtoLFTravelTime` from
  `great-falls.js` into the node-safe shared pair `src/model/shared-model.js` ↔ `netlify/functions/shared/model.js`;
  `great-falls.js` imports (and re-exports for surface preservation) them. Resolves the unrunnable parity test
  (`great-falls.js` throws `window is not defined` under node) AND the SP3 3rd-copy drift risk. Drop the
  `console.log` from both shared copies (logic-only; client loses one debug line — noted in CHANGELOG).
  `selectHistoricReading`/`medianCfs` stay CJS copies in `shared/model.js`; their client source
  `src/estimation/rise-rate-robust.mjs` is already node-safe, so the parity test imports client-from-`.mjs`,
  server-from-`shared/model.js`.
- **[F2/F5 blocker] No-regression characterization + version contingency.** Before editing the loop, snapshot
  current `makeGFPrediction` outputs (`predictedCFS`/`porCFS`/`useTimeShifted`/`timeShiftedHoursAgo`) for a grid of
  normal/high STEADY-flow inputs via the `_test` seam; freeze as expected; assert bit-identical post-change.
  **MINOR v36.4 holds only if this passes.** CHANGELOG must state the low-flow validated estimate shifts (it is an
  estimation-output change in that regime).
- **[SP1 blocker] C16 scope expands beyond retention.** Also: fix the stale `sync-learning.js:938-941` comment
  ("48h rolling"→"72h", "every 2h"→"every hour" — it serves the now-72h `por_history` row over `/api/sync`).
  Explicitly ring-fence `scheduled-update.js:855` `staleThreshold` (pending-prediction cleanup) — a DIFFERENT 48h
  that STAYS 48h. Add doc strings `README.md:143` and `tech-appendix.md:412` (48h→72h). Do NOT touch the
  ">48 hours deleted" prediction-staleness refs (tech-appendix ~§6, `scheduled-update.js:855`).
- **[SP2/F3 blocker] Scalar vs object `getFlowMultiplier`.** Server returns a SCALAR, client an OBJECT. Every
  server loop call site uses bare `getFlowMultiplier(x)` (no `.mult`). Parity test drives both helper copies with
  identical SCALAR `mult` + `riseRate` — never routes through the client's object form.
- **[C8-return-shape major] `getPoRFromHistory` rewrite.** Build `{cfs, actualHoursAgo:(Date.now()-entry.timestamp)/3.6e6}`
  EXPLICITLY from the `selectHistoricReading` entry (never return the entry — else `actualHoursAgo` is undefined and
  the PoR-delta `fractionElapsed` silently zeroes the decay). The 1h null-guard now comes solely from
  `selectHistoricReading`'s internal `matchMs` (drop the separate `closestDiff<1h` check; no double-gate). Test asserts
  `actualHoursAgo` finite on a hit.
- **[F4 minor] Fix C45 citation** to `analysis/c45-bin-edge-diagnostic-2026-06-17.md`; restate the low-flow EMA
  transient honestly — those cells are count 0–2 today (near-reset on first contact), not a gentle ~10–15-obs
  reconvergence. "Bounded to low flow" stands.
- **[C8-riserate / F7] Doc wording.** Say "client and server use the same travel-time ITERATION and historic-reading
  SELECTION; the PoR rise-rate input stays deliberately divergent (client robust / server raw) — see
  great-falls.js:153." Avoid an unqualified "same algorithm." tech-appendix §3.5 (already documents iteration)
  becomes accurate for the server too — optional one-sentence note, no rewrite.
- **Test design (accepted notes):** parity test asserts the full converged tuple `(historicPoR, travelPoRtoGF, mult)`
  incl. the one-step lag, an exact-timestamp-tie case, a high-ratePerHour (>15%/hr) case to engage the 0.30 celerity
  cap, and a ≥3-candidate +50% glitch-drop case for `selectHistoricReading`. C16 test computes
  `getPoRtoGFTravelTime(getFlowMultiplier(1000), null)` and asserts `< 72h` (verify coverage from code, not the doc).
  `_test` seam already exports `makeGFPrediction`+`getPoRFromHistory` (no seam change); only `shared/model.js`
  `module.exports` grows (the 4 new helpers/constant). Confirm `ensemble-parity.test.mjs` TIER 1 still passes
  (independent end-to-end drift net).
- **[C8-celerity-both-legs] Re-audit task:** enumerate downstream consumers of `travelGFtoLF` (now computed from the
  converged mult) — expected forecast-offset only, not the nowcast estimate.

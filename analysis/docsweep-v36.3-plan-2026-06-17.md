# v36.3 Documentation-Accuracy Sweep — Implementation Plan

**Date:** 2026-06-17
**Type:** MINOR (v36.2 → v36.3). Mix of doc-only edits and load-bearing code fixes; **no change to the core GF estimation output** for the same inputs.
**Closes (science-review claims):** C5, C7, C9, C10, C38, C40, C41, C4, C36, C50 + the §8.1 travel-time nit + ~10 completeness-critic residuals (incl. C39).
**Source of scope:** `analysis/science-review-2026-06-10.md` (frozen audit) re-scoped against current (v36.2) code by the `docsweep-scope` workflow; all quantitative figures blind dual-language (Python+R) verified by `docsweep-numverify` (verdict=pass, full agreement, USGS drainage areas confirmed live).

## User decisions (locked 2026-06-17)
1. **Code scope:** include all load-bearing code fixes (C7 math, C9 correlationCount, C10 dead code) — full Code-Change Verification Protocol applies.
2. **EF median error:** show both — `11.7% (hourly) / 6.3% (daily)`.
3. **Extra items:** fold in the ~10 completeness-critic residuals.

---

## 1. Verified numbers (drop-in values)

All confirmed by blind Python+R + independent auditor (`analysis` workflow run `wf_ba57d955-afb`). Rounded to the docs' existing precision style.

| Use | Verified value |
|---|---|
| §5.4 EF-weight table (EF%) | 1,000→**0.0%** · 3,000→**0.1%** · 5,000→**1.2%** · 10,000→**20.0%** · 20,000→**38.8%** · 50,000→**40.0%** (PoR = 100−EF) |
| §5.6 / README ceiling rising-bias | 110%→**−509** cfs · 120%→**−61** cfs (production decay=0.50) |
| §7.5 Ex1 rating curve | `estimateLFFlowFromStage(2.60)=1026` cfs; curve = 2,000 cfs at **2.83 ft** |
| §7.5 Ex2 EF power law | warm 126·3.50^2.46 = 2,746 cfs; **inverse: 11,200 cfs ⇒ EF 6.20 ft** (warm) |
| §8.1 travel @1,000 cfs | T_total=67.3h; **PoR→GF ≈ 50h**; +6h forecast ⇒ PoR **~44h** ago; +48h ⇒ PoR **~2h** ago |
| index.html travel table | T(1,200)=60.4h ⇒ **~60h / ~0.7 mph**; T(2,000)=44.5h ⇒ **~45h / ~0.9 mph** (reach=41 mi, speed=41/T) |
| §2.4 / §9.1 ungauged | 16.5 − (7.1+3.0+0.66+0.87) = **4.87% ≈ 4.9%** |
| C36 distances (river-mi) | PoR→GF **~34**, EF→GF **~16** (straight-line haversine cross-checks: 24.5 / 13.6 mi — river > straight, consistent) |
| C36 drainage areas | LF 11,560 · PoR 9,651 · EF 11,130 · Seneca 101 · Monocacy 817 · Goose 332 · Broad Run 76.1 — **all match live USGS** (no doc change needed) |

---

## 2. Risk tiers & verification strategy

- **Tier D (doc-only):** prose/tables in `.md`/`.html`. No behavioral effect. Verified by re-reading + the number table above.
- **Tier C (code, load-bearing):** edits to `scheduled-update.js`, `great-falls.js`, `great-falls-ui.js`, `edwards-ferry.js`, `constants.js`. Triggers the project Code-Change Verification Protocol (this plan → independent auditor → implement → re-audit). Gate = `npm test` (expect ≥407) + `npm run build`.

**Verification path (stated upfront, per global rules):**
- `npm test` must stay green (currently 407). The C9 UI-gate change and C10 dead-code deletion are the only edits that could move a test; the EF cross-check panel and dead exports are **not** covered by the current suite (C18), so a green suite is necessary-but-not-sufficient — the re-audit subagent must additionally confirm the EF panel still renders and nothing imports the deleted functions.
- C7 missed-run math: no test seam exists in `scheduled-update.js` (C18). **Decision for auditor (Q1 below):** extract the pure arithmetic into a tiny exported helper + add a unit test, vs. verify by the worked-examples table + re-audit only.
- Anything confirmable only at runtime (the cron's next health tick, the live browser EF panel) is flagged as an **unverified-until-deployed gap**, not a pass — to be checked in the post-deploy live verification step.

---

## 3. Tier C — code changes (load-bearing)

### 3.1 C7 — missed-run health math (`netlify/functions/scheduled-update.js`, ~1438–1445)
**SUPERSEDED by §9 audit resolution S4/Q1 — use the round-based `computeRunHealth` helper below, not the `>2`/`floor` form originally drafted here.**
Cron is hourly (`netlify.toml: 0 */1 * * *`) but `updateRunHealth` still computes on a 2h cadence.

```
1438  // Detect missed runs (gap > 3h means at least one 2h cycle was skipped)
1439  if (gapHours > 3) {
1440      metaData.missedRuns = (metaData.missedRuns || 0) + Math.floor(gapHours / 2) - 1;
1441      console.log(`... ~${Math.floor(gapHours / 2) - 1} missed cycles`);
1445  metaData.consecutiveRuns = gapHours <= 3 ? (metaData.consecutiveRuns || 0) + 1 : 1;
```
→
```
// Detect missed runs (gap > 2h means at least one hourly cycle was skipped;
// >2h leaves headroom for Netlify scheduler jitter on a 1h cadence)
if (gapHours > 2) {
    metaData.missedRuns = (metaData.missedRuns || 0) + Math.floor(gapHours) - 1;
    console.log(`... ~${Math.floor(gapHours) - 1} missed cycles`);
metaData.consecutiveRuns = gapHours <= 2 ? (metaData.consecutiveRuns || 0) + 1 : 1;
```
**Why >2h, not >1h:** Netlify scheduled functions can fire late; a healthy hourly gap is occasionally ~1.1–1.5h. `>2h` trigger + `floor(gap)−1` count is correct integer arithmetic (gap 2.0→1 missed, 3.0→2, 6.0→5) and avoids jitter false-positives. **Side effect:** `missedRuns`/`consecutiveRuns` are health *telemetry* only — they do not feed the model, predictions, or learning. Historic accumulated counts stay as-is; only future increments change.

### 3.2 C9 — correlationCount sentinel + EF metric provenance
- `src/estimation/edwards-ferry.js:161–162`: delete the `// Legacy field for backwards compatibility` comment and `correlationCount: 16971,`.
- `src/ui/great-falls-ui.js:210`: `if (gfEstimate.efEstimate && gfEstimate.efEstimate.correlationCount >= 10)` → `if (gfEstimate.efEstimate)`. **The `efEstimate` object is already null when EF data is missing/out-of-range (`estimateGFFromEdwardsFerry` returns null), so a plain presence check preserves the panel's render condition** without the dead sentinel gate. Behavior preserved: panel shows whenever a valid EF estimate exists.
- `src/model/constants.js:73` comment: `(10,434 daily observations)` → `(5,220 deduplicated daily observations)`.
- `src/model/constants.js:81` `medianErrorPct: 6.3` — **keep the value** (it is the daily figure and is *not* rendered in the EF panel — confirmed `great-falls-ui.js:207–232` shows cfs/stage/icon only) and add comment: `// daily-resolution median |error|; hourly refit = 11.7% (analysis/powerlaw_refit_audit.md)`. Implementation must `grep medianErrorPct` once more to confirm no other display consumer before finalizing.

### 3.3 C10 — dead code & stale code comments
- `src/estimation/great-falls.js`: **delete** `computeGFHistoryFromPoR` (~207) — orphaned, no live caller, only a historical CHANGELOG mention.
- `src/estimation/great-falls.js`: `getTravelTimeAwarePor` (~243) — **annotate, do NOT delete** (see Q2). It is the C22 forecast-fallback scaffolding ("written for the offset, never called"); deleting forecloses deferred C22 work. Add `// TODO(C22): wire into forecast PoR fallback (travel-offset + tributary scaling); currently unused.` *(Auditor may override to delete-with-CHANGELOG-note.)*
- `netlify/functions/shared/model.js:112` comment: `Client copy exists in index.html` → `Client copy is src/model/shared-model.js (getFlowState)`.
- `netlify/functions/scheduled-update.js:811` comment: `(0% <3k, 35% ≥3k)` → `(logistic ramp: 0 below 1000 cfs, → W_MAX=0.40)`.
- `netlify/functions/analyze-stage-errors.js:58` dead `.eq('gauge_id','validated')` reader — **defer / investigate separately** (Q3). `validated` is never written, so this query is already inert; removing it safely requires reading the whole function. Not blocking the sweep.

---

## 4. Tier D — documentation edits

### 4.1 `src/assets/tech-appendix.md`
| Loc | Claim | Current → New |
|---|---|---|
| L3 | ver | `Version: 36.2` → `36.3` |
| L13 | C36+C7 | `20 miles upstream` → `~34 river miles upstream`; `Edwards Ferry, 2 miles above the falls` → `~16 river miles above the falls`; `Every two hours, the server validates` → `Every hour, the server validates` |
| L46 | critic | EF "Travel to LF \| ~4 hrs" → `~7 hrs` (EF is upstream of GF; EF→LF must exceed the 6.5h GF→LF baseline) |
| L50 | C36 | Seneca role `(enters below GF)` → `(enters above GF, below EF)` |
| L72 | C36 | Seneca `enters below GF` → `enters below EF, above GF` |
| L199 | C9 | `R² \| 0.94` → `0.91` |
| L200 | C9 | `Median error \| 6.3%` → `11.7% (hourly) / 6.3% (daily)` |
| L211 | C9 | append resolution clarity: `3,354 daily observations (1,680 unique dates; 12,959 hourly)` |
| L267–274 | C5 | replace table body with verified EF-weight values (§1) |
| L280 | critic | `(19-26h old)` → `(~19h old at median flow, up to ~50h in low water)` |
| L295 | C38 | `−476 cfs … (-29 cfs)` → `−509 cfs … (−61 cfs)` |
| L301–309 | C4 | reframe §5.8 as **fixed/frozen priors**, client-only, not in the server-validated estimate (see 4.5) |
| L405 | C41+C10 | rewrite cold-start to distinguish **client (NWS trend fallback)** vs **server (returns `steady`)**, and fix `fewer than 4` (client rise-rate gate) vs server `< 8` flow-state gate (see 4.5) |
| L411 | C7 | `executes every 2 hours` → `executes every hour` |
| L416,425 | C10 | `→ expired` / `marked expired, not validated` → `deleted` (validated rows are deleted) |
| L423 | C7 | `successful 2-hour executions` → `successful hourly executions` |
| L424 | C7 | `gap > 3 hours` → `gap > 2 hours` (matches new code in 3.1) |
| L428–434 | C39/critic | §6.9 rewrite: the Historical-Accuracy badge was **retired in v33.2** as structurally flawed (display is hard-hidden); point to forecast-accuracy metrics |
| L489–501 | C40 | Ex1 `2.60 ft` → `2.83 ft`; Ex2 `3.50 ft` → `6.20 ft` (preserves the intended 79% / 32% HARD/SOFT outcomes; verified) |
| L509–511 | nit | `travel time ~40h` → `PoR→GF lag ~50h`; `34 hours ago` → `~44 hours ago`; `8 hours ago` → `~2 hours ago` |
| L570 | critic | ungauged `~5.5%` → `~4.9%` |
| §9.1 table | C50 | add row: **Provisional USGS data / Small, transient** — PoR input and raw-LF validation target come from the provisional USGS IV feed; values are frozen at fetch time and not re-read after USGS revision; effect is noise, not bias |
| §10.1 (L594) | C50 | add bullet: **Data status:** Provisional (real-time IV); values are unverified and subject to USGS revision; the value at fetch time is used and revisions are not back-filled |
| L649,651,655 | ver | `v36.2` → `v36.3`; rewrite the footer "Generated by" line for the v36.3 sweep |

### 4.2 `README.md`
| Loc | Claim | Current → New |
|---|---|---|
| L67 | C9 | **leave** — cold `R²=0.98, 12,959 hourly cold-water obs` is sourced (powerlaw_refit_audit.md:188) and internally consistent with the hourly default row |
| L69 | C38 | `(-29 cfs) vs -476 cfs` → `(−61 cfs) vs −509 cfs` |
| L89 | C36 | verify + fix PoR `20 miles upstream` → `~34 river miles upstream` |
| L124 | C41 | comment → `// Observed PoR rate (6h lookback); client falls back to NWS trend on cold start, server returns 'steady'` |
| L223 | critic | `(v16–v35.3)` → `(v16–v36.3)` |
| L227 | critic | footer → `Last updated: 2026-06-17 (v36.3 — documentation-accuracy sweep)` |
| version table | rule | add a `v36.3 \| 2026-06-17 \| Documentation-accuracy sweep …` row |
| header (L6) | ver | `Current Model (v36.2)` → `v36.3` |

### 4.3 `index.html`
| Loc | Claim | Current → New |
|---|---|---|
| ~L241 | C36 | PoR box `20 mi upstream` → `~34 mi upstream` |
| L248 | critic (C6 residual) | `19–33 hrs travel time` → `~5–50 hrs travel time` |
| ~L306 | C36 | `Point of Rocks gauge, 20 miles upstream` → `~34 river miles upstream` |
| ~L312 | C36 | `Edwards Ferry gauge, 2 miles above the falls` → `~16 river miles above the falls` |
| ~L318 | C7 | `Every two hours, the server checks` → `Every hour, the server checks` |
| L389–390 | critic (C6 residual) | `~1.2k: ~0.9 mph / ~44 hrs` → `~0.7 mph / ~60 hrs`; `~2k: ~1.2 mph / ~35 hrs` → `~0.9 mph / ~45 hrs` |

### 4.4 `CLAUDE.md`
| Loc | Claim | Current → New |
|---|---|---|
| L96 | C10 | `Keep index.html and scheduled-update.js in sync` → `Keep src/model/shared-model.js and netlify/functions/shared/model.js in sync (plus src/model/constants.js ↔ server constants)` |
| L128 | C10 | `index.html (client) and scheduled-update.js (server)` → `src/estimation/great-falls.js + src/model/shared-model.js (client) and netlify/functions/scheduled-update.js + shared/model.js (server)` |
| L138 | ver | `Current Model Parameters (v36.2)` → `(v36.3)` |
| L140 | C10 | `Three gauge_id tiers: hard_flagged, soft_flagged, validated` → `Two written tiers on flagged rows: hard_flagged, soft_flagged (validated predictions are deleted, not stored)` |

### 4.5 Replacement prose (drafts)

**§5.8 (C4):**
> ### 5.8 Hysteresis Correction
> At the same stage, a rising river carries more flow than a falling river (Fread 1973, Henderson 1966). The system applies fixed, literature-informed multipliers to the **client-side** Edwards Ferry estimate:
> - Rising ×1.08 (+8%), falling ×0.92 (−8%), steady ×1.00 — **fixed priors, not learned** (they do not adapt to validation errors)
> - Applied client-side only, to the EF component of the local ensemble and the shadow-model comparison; the server-written (validated, displayed) GF estimate applies no hysteresis multiplier
>
> *(An adaptive-EMA update path exists in the code but is not wired into the validation pipeline, so the multipliers stay frozen at the values above.)*

**§6.6 cold-start (C41 + C10 threshold):**
> Flow state is determined from the observed PoR rate (**6-hour lookback** on stored PoR history). Cold-start behavior differs by runtime: the **client** falls back to NWS forecast trend direction when its PoR history is too sparse to classify a trend (rise-rate gate: fewer than 4 readings or no ~6h-spaced baseline); the **server** (cron — the sole learner/validator) returns `steady` when its PoR history has fewer than 8 entries or lacks a reading ≥6h old, and never consults NWS for flow state. …(retain existing 6-hour-window rationale sentence).

**§6.9 (C39):**
> ### 6.9 Historical Accuracy Tracking *(retired v33.2)*
> An earlier build displayed a `100% − MAE%` "Historical Accuracy" badge. It was removed in v33.2 as structurally misleading (it scored the uncorrected model and conflated bias with noise); the display element remains hidden. Current accuracy reporting lives in the forecast-validation metrics (§8.6) and the learning panel.

---

## 5. Version bump
- App version string: locate the displayed `Potomac Pulse v36.x` constant (grep `36.2` in `src/`, `index.html`, `constants.js`) and bump to **v36.3**. (Live title currently `Potomac Pulse v36.2`.)
- `src/assets/CHANGELOG.md`: add a v36.3 entry summarizing the sweep.
- tech-appendix L3/L649/L651/L655, README header/footer/table, CLAUDE.md L138 — all to v36.3.

## 6. Side effects & risks
- **No model-output change.** No edit touches the estimation math, EMA learning, CI, ceiling, weights, or travel-time formula. C7 changes only health telemetry; C9/C10 remove dead code / fix a UI gate that preserves behavior.
- **C9 UI gate:** the only user-visible behavioral change. Risk: if `efEstimate` truthiness differs from the old `correlationCount>=10` gate, the EF panel render could change. Mitigation: re-audit confirms the panel still shows/hides identically (efEstimate is null exactly when EF is unavailable).
- **C10 deletion:** risk = a hidden dynamic reference to `computeGFHistoryFromPoR`. Mitigation: grep all of `src/`, `netlify/`, `index.html`, `test/` for the name before deleting; `npm test` + build.
- **Doc/code coupling (C7):** §6.8 doc and the missed-run code are changed together so the doc continues to describe the code accurately (the critic's warning).

## 7. Explicitly OUT of scope (conscious exclusions)
- C37 (headline ~6% nowcast = daily, hourly ~11% MAPE) — appendix L17; **not** in the 10. Left unchanged.
- C24/C25 (§8.6 forecast-vs-NWS baseline never operational) — not in the 10. §8.6 left unchanged.
- C36 `GREAT_FALLS.area=10000` constant — **refuted** as a doc defect (dead/unused, in no doc). Optional non-load-bearing reconciliation only; not done here.
- §5.5 L291 daily backtest figures (17.8%/25.6%, "5,220 days") — possible daily/hourly issue but **unverified** by the review; not touched.

## 8. Open questions for the plan auditor
- **Q1 (C7 testability):** extract `computeRunHealth(gapHours, prev)` as a pure exported helper + add a unit test, or accept worked-examples + re-audit as the regression guard given no existing seam?
- **Q2 (getTravelTimeAwarePor):** annotate as `TODO(C22)` (recommended) or delete with a CHANGELOG note that C22 must re-add it?
- **Q3 (analyze-stage-errors.js dead reader):** defer (recommended) or fix the `validated` query now?
- **Q4:** any edit mis-classified Tier D when it is actually behavioral? Any stale figure in the four files the sweep still misses?

---

## 9. Plan-audit resolutions (2026-06-17)
Independent audit: `analysis/docsweep-v36.3-plan-audit-2026-06-17.md` (2 BLOCKER, 5 SHOULD-FIX, 4 NICE-TO-HAVE). Engagement below; all accepted.

### B1 (BLOCKER) — ACCEPTED. Flag-tier storage doesn't exist; my replacement was also false.
Code ground truth (`scheduled-update.js`): validation computes `hardScore`/`softScore` + an in-memory `anomalyFlags` array (console-logged only), then **deletes** the pending row (L996) regardless of flag. The only `gauge_id` values ever written are `system`, `pending`, and bin keys (`<flowbin>_<state>`, `stage_*`). No code writes `hard_flagged`/`soft_flagged`/`validated`. So BOTH the original CLAUDE.md L140 *and* my proposed replacement are wrong, AND the appendix §7.3 (L468/469/475) makes the same false "Record is marked …" claim.
- **CLAUDE.md L140 → (corrected):** `**Two-Tier Anomaly Flagging**: Hard flags (data corruption) skip learning AND accuracy; soft flags (model disagreement) are included in both (EMA clamped ±2σ). Flags are computed per validation and gate learning/accuracy — they are NOT persisted as a gauge_id tier; the pending row is deleted on validation. (Stored gauge_id values: only `system`, `pending`, and bin keys.)`
- **tech-appendix §7.3 L468–469 → (corrected):** drop "Validation is recorded (for analysis) but skips…/Record is marked 'hard_flagged'"; replace with: `Excluded from both learning and accuracy; logged with an anomaly tag for analysis. The pending row is deleted on validation like any other prediction (no per-record tier is stored).`
- **tech-appendix §7.3 L475 → (corrected):** `Included in learning (EMA clamped ±2σ) and accuracy; logged with a soft-flag tag.`
- CHANGELOG v33.0 line (historical "Three-tier gauge_id") — **leave** (append-only history of intent).

### B2 (BLOCKER) — ACCEPTED. Fix all 8 stale sync comments, not 1.
`shared/model.js` has 8 "Client copy exists in index.html" comments: L3 (`Client-side copies exist in index.html — keep all three in sync…`) and L38/64/76/91/102/112/343 (`SYNC WARNING: Client copy exists in index.html — keep in sync!`). Fix ALL → point at `src/model/shared-model.js`. (L144 `Client copy: src/model/constants.js GF_EMA_ALPHA` is already correct — leave. `src/model/shared-model.js`'s reciprocal "SOURCE OF TRUTH … keep client copy in sync" header is correct — leave.)

### S1 (SHOULD-FIX) — ACCEPTED. CLAUDE.md version header located by content (`## Current Model Parameters (v36.2)` → `(v36.3)`), not by line number.
### S2 (SHOULD-FIX) — ACCEPTED. README has a second version header (`## Current Model (v36.2)`). Implementation bumps ALL `v36.2` occurrences in README (grep-driven), not just the footer.
### S3 (SHOULD-FIX) — ACCEPTED. C9 `correlationCount` delete + the `great-falls-ui.js` gate change are ONE atomic edit step (delete-without-gate-change makes `undefined>=10` false → EF panel silently never renders).
### S4 (SHOULD-FIX) + Q1 — ACCEPTED with refinement. Use round-based math + pure helper + test.
My drafted `>2`/`floor(gap)−1` form has two flaws: (a) the plan prose mis-stated the 2.0h boundary, and (b) `floor` undercounts on large fractional gaps (gap 2.9h → 1 missed, truly ~2). Replace with a round-based pure helper, extracted for testability:
```
// Pure: number of skipped hourly cycles. round(gap) ≈ cycles elapsed; current run isn't a miss.
function computeRunHealth(gapHours, prev) {
  const cycles = Math.round(gapHours);
  const missedThisGap = Math.max(0, cycles - 1);
  return {
    missedRuns: (prev.missedRuns || 0) + missedThisGap,
    consecutiveRuns: cycles <= 1 ? (prev.consecutiveRuns || 0) + 1 : 1,
  };
}
```
Worked table (to pin in the test): gap 0→{+0,consec+1}; 1.0→{+0,+1}; 1.4→{+0,+1}; 1.6→{+1,reset}; 2.0→{+1,reset}; 2.9→{+2,reset}; 3.0→{+2,reset}; 6.0→{+5,reset}. First run (no lastRun, gap=0) → consec+1, matching current behavior.
**Placement:** extract to `netlify/functions/shared/run-health.js` (pure, side-effect-free) imported by `scheduled-update.js` AND `test/run-health.test.mjs` — UNLESS `scheduled-update.js` is import-safe (no module-load side effects), in which case export from it directly. Implementation checks top-level side effects first.
**§6.8 doc:** "Missed runs: Count of skipped hourly cycles" / "Consecutive runs: Streak of on-time hourly executions" (drop the literal "gap > 3 hours").

### S5 — NOTED. `medianErrorPct` keep-6.3-with-comment confirmed (auditor verified no display consumer).
### Q2 — ACCEPTED. Annotate `getTravelTimeAwarePor` `// TODO(C22): wire into forecast PoR fallback — needs travel-offset AND tributary scaling (currently has neither); unused until then.` Delete only `computeGFHistoryFromPoR`.
### Q3 — ACCEPTED. Defer `analyze-stage-errors.js:58`; add one-line `// NOTE: 'validated' gauge_id is never written (validated rows are deleted) — this query is inert; see C10.` (non-breaking).
### Q4 — NOTED. No mis-tiering; C9 is the only behavioral change and is behavior-preserving (gate is currently always-pass at `16971>=10`).

**Net new files:** `netlify/functions/shared/run-health.js` (maybe), `test/run-health.test.mjs`. **Net new edits beyond §3–4:** appendix §7.3 (B1), 7 extra `shared/model.js` comments (B2), README extra version header (S2), CLAUDE.md L140 corrected text (B1).

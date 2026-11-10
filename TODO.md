# Potomac Pulse — Remaining Work

**The single source of truth for outstanding work.** Open items live here; nowhere else.
Session state is in `.claude/HANDOFF.md`; methodology provenance for shipped versions is the
small set of cited docs in `analysis/` (see CLAUDE.md / README). Pick a tier, prioritize, go.

*Last updated: 2026-11-10 (current version: v39.4; 1140 tests, 1139 pass, 1 opt-in skip). Verified against live DB + git history, not memory.*

---

## How to read this

- **Tiers are by kind, not strict priority** — skim all, then prioritize.
- Effort is a rough order-of-magnitude.
- 🔒 = needs a decision from you before work starts · 📅 = date-gated · 🔍 = verify-only.
- Anything touching the estimate must keep the characterization/golden tests green and the
  client↔server parity tests green (`npm test` = **1075**), or deliberately re-baseline + version-bump.
- **Pushing auto-deploys from `main`** through the Netlify gate (`npm install && npm test && npm run build`);
  a red suite blocks deploy. Pushing needs explicit approval each time.

---

## Tiers 0 & 1 — Model accuracy + Security · ✅ RESOLVED (nothing open)

Cleared this session. Full detail in CHANGELOG / git / `analysis/`.
- **Done / verified-done:** 0a low-flow floor (REJECTED, low-leverage) · System-1 retired (v37.1) ·
  travel-time refit (v36.2) · RLS · composite index · C12 deadlock+idempotency · C13a/b write-path
  validation · DB constraints (already in place) · service_role key removed from `settings.local.json`.
- **Decided NOT to do:** rotate the Supabase service key (key was gitignored / never pushed → local-only;
  revisit only on suspected local-machine compromise) · `NOT NULL` on `created_at` (optional, beyond spec).

---

## Tier 2 — Observability & infra · ⏸️ NOT PURSUING

Decided 2026-06-18 not to do the remaining Tier 2 items (all optional, all need your dashboard/env access). Re-open any if wanted:
- **Set `VITE_SENTRY_DSN`** in Netlify env vars — code + sourcemaps already done; just needs the DSN.
- **Uptime HTTP checks** in healthchecks.io — site + USGS availability alerts. Includes setting `HEALTHCHECKS_PING_URL` in Netlify env so the v37.2 cron success/`/fail` ping actually reaches a monitor (it's wired correctly but is a **no-op until that env var is set** — so there is currently no live cron-stall alerting).
- **Scope MCP servers per-project** — Gmail/Calendar/Drive/Scholar waste ~17k context tokens; not needed here.

**Closed:** **silent USGS-null cron early-return fixed** (v37.2 — now `throw`s into the healthchecks `/fail` ping instead of returning; `analysis/cron-failping-fix-2026-06-18.md`) · shadow-leaderboard reset verified (`shadowServerMigration` non-null) · honest sync-failure reporting + stop fabricating gauge stage (C46/C49, `ad6f486`) · Netlify deploys gated on `npm test` (C20, `4a85a4c`).

---

## Tier 3 — Refactor / tech debt (snapshot-protected)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 9  | **Phase 2 — internal decomposition** | done (partial) | ✅ **v37.3** — extracted `computeGFEstimate()` (model invocation out of `updateGreatFallsUI`) + added server-only `shared/observations.js` and DRY'd ~21 data-access sites in `scheduled-update.js` (behavior-neutral; 602→626; byte-identical `validatePendingPredictions`). **Declined sub-scope:** decomposing `validatePendingPredictions` (untested EF-corr/shadow/stage blocks → unverifiable, not worth the risk on the live learning loop) and the `sync-learning.js` adoption (25 DB sites, no test net) — re-open only with test-hardening first. See `analysis/phase2-decomposition-plan-2026-06-18.md`. |
| 10 | ⏸️ **Phase 3 — unify the 3 runtimes** | — | **NOT PURSUING** (decided 2026-06-19). One shared `gf-pipeline` for client + server + unify 3 flow-state impls would change observable output on the non-canonical side for ~2–3 days of risk on a live learning loop; the parity tests already guard client↔server drift and v36.0 unified correction *application* via `applyGFCorrection`. Re-open only if the three impls actually diverge in production. |
| 11 | **Phase 4 — render path** | done | ✅ **v37.4** — replaced the 6 setter-injection lazy callbacks + scattered re-render triggers with a synchronous pub/sub event bus (`src/state/event-bus.js`; producers emit, UI subscribes once in `init.js`) and removed the 4s NWS render gate (paints immediately, re-renders on `nws:arrived`). Dissolves the `fetch ↔ gauges-ui ↔ great-falls-ui` cycle. Plan→audit→implement→re-audit; 626→637 (bus unit + static `emit`/`on` wiring test). ✅ **In-browser verified** (2026-06-19, user) — render wiring + first-paint forecast-card flip confirmed acceptable on the live site. |
| 12 | **Parallelize Supabase queries** | done | ✅ **v37.5** — `loadGFLearningData`'s 5 independent SELECTs now fire via `Promise.all` (~100–400ms off cold load). **Test-first** (the file had zero DB-site coverage): 8 characterization tests with a mock Supabase client lock the asymmetric error semantics + sumCFSSq heal + bins/pending assembly, passing against both the sequential and parallel code (proves equivalence). 637→645. Plan→audit→implement→re-audit. See `analysis/sync-learning-parallel-selects-plan-2026-06-19.md`. **Remaining `sync-learning.js` SELECTs are single-query** (nothing else to parallelize); the broader no-test-net debt on its write paths is still open. |
| 13 | **JSDoc comments** | done | ✅ **2026-06-19** — exhaustive `@param`/`@returns` JSDoc added above every function across `src/` + `netlify/functions/` (~26 files, 515 tags, from 0). Doc-only (no version bump): provably comment-only (zero deletions, zero non-comment added lines), 637 tests + build green. Run via per-file subagents + central diff verification. |

---

## Tier 4 — Features / UX (nice-to-have)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 14 | ⏸️ **Multi-pending validation pipeline (Option B)** | — | **NOT PURSUING** (decided 2026-06-19, backtest-gated). Dual-arm prequential study (`multipending_gate.mjs`, blind Py+R, 3rd-agent audit; data integrity confirmed) was a **QUALIFIED PASS but rejected on cost-benefit**: multi-pending helps only the rare high-flow flood tail (25-50k & 50k+ rising, CI-significant), the **aggregate effect is not significant** (pooled CI straddles 0), it **mildly worsens all 7 everyday low/mid cells**, the targeted 12-25k-rising cell is a wash, and the edge **halves out-of-sample** (over-fit). Too thin to justify the riskiest implementation in the backlog (MAJOR live-loop change + test-hardening `validatePendingPredictions`). Re-open only to study the *responsiveness* benefit (out of scope here), not more correction-quality backtesting. Findings: `analysis/multipending-learning-findings-2026-06-19.md`. |
| 15 | **Backup export function** | done | ✅ **v37.6** — PIN-gated "📥 Download Backup (JSON)" button in the Learning tab; `downloadLearningBackup()` fetches the live `gf` learning state + forecast accuracy fresh and downloads a timestamped JSON. Additive, read-only (no model/estimate/learning change). Build green, 645 tests. ✅ in-browser verified (2026-06-22, user). |
| 16 | **Admin monitoring dashboard** | done | ✅ **v37.7** — added a "🔧 System Diagnostics" panel surfacing already-captured-but-hidden metrics (throughput, stage error, bin-write health, last-flag recency+reason, EF regression R²) from the loaded `gfLearningData`. Additive read-only display, no new fetch/server change. Scoped down from timelines/heatmap (would need new fetches). Build green, 645 tests. ✅ in-browser verified (2026-06-22, user). The existing dashboard (current conditions, model health, validation chart, bin stats, shadow horse-race, forecast accuracy) already covered most of this item. |
| 17 | **Audit logging** | done | ✅ **v37.8** — the 3 PIN-gated reset actions append to a new `audit_log` observation type via a non-fatal `logAdminAction()` helper; GET `audit-log` endpoint + "🧾 Recent Admin Actions" list in the Learning tab. Fixed stale hardcoded `resetReason`. Full protocol (plan→audit→implement→re-audit); 9 new tests incl. non-fatal characterization (645→654). ✅ in-browser verified (2026-06-22, user). Note: `resetForecastAccuracy` has no UI button (logs only via out-of-band POST). |
| 18 | **Log validation failures** | done | ✅ **v37.9** — hard-flagged validations (dropped from both learning + accuracy) now append to a new `validation_failure` observation type via the non-fatal `insertObs` helper, written inside the `if (isHardFlagged)` block after the claim-delete; GET `validation-failures` endpoint (`loadValidationFailures`, 50 newest, mirrors `audit-log`). Full protocol (plan→audit→test-first→re-audit); +8 tests incl. both non-fatal-guard halves + soft-flag/clean negatives (654→662). Append-only, no retention (hard flags rare; GET caps 50). Server-only, additive — no model/learning/accuracy/estimate change. See `analysis/validation-failure-logging-plan-2026-06-22.md`. |
| 19 | **Service worker for offline** | done | ✅ **v37.10** — offline SW via `vite-plugin-pwa` (Workbox `generateSW`, `autoUpdate`): precaches the hashed app shell + geojson, runtime-caches (SWR) the `sync-learning` GETs (`pp-api`) + USGS/NWS data (`pp-data`), so a returning user opens offline with last-known state. `skipWaiting`+`clientsClaim`+`cleanupOutdatedCaches` busts the precache per deploy (no stale code); tiles excluded; `manifest:false`; no SW in dev; registered prod-only in `main.js`. New `#offlineBar` (`navigator.onLine`-driven, distinct from the fetch-failure banner the SW masks). CSP unchanged (origins already in `connect-src`). +2 tests (662→664); `dist/sw.js` emitted. 1 new build-time devDep (`vite-plugin-pwa`; 5 dev-only audit advisories, none shipped). ⚠️ in-browser verification pending (SW register/activate, offline reload, post-deploy cache-bust, no CSP errors). Plan→audit→implement→verify: `analysis/service-worker-offline-plan-2026-06-23.md`. **Update v39.1:** river data is now network-first (A1). The in-browser verification listed above is still pending. |
| 20 | **Mobile sidebar scrolling** | done | ✅ **v37.11** — fixed the mobile double-scroll (CSS-only): `#app` uses `100dvh` with a `100vh` fallback (fills the visual viewport, not the chrome-occluded 100vh), and on ≤768px the sidebar is the single scroll container (`.tab-content`'s inner `overflow` removed) with the tab bar pinned (`.tabs` `position: sticky; top: 0`, opaque). Mobile-scoped — desktop `.tab-content`-scrolls model untouched (`100dvh` == `100vh` on desktop). Build green, 664 tests. ⚠️ in-browser (mobile) verification pending. |
| 21 | **Show hard-flagged validations in the accuracy chart** | done | ✅ **v37.12** (follow-on to #18) — the Prediction Accuracy (7d) chart merges the `validation_failure` log into its timeline as hollow rings (legend + "⚠ hard-flagged" tooltip note), so flagged validations stop appearing as unexplained gaps (the 2026-07-09/10 local-runoff event left a silent 44h hole; this chart is now also the recurrence monitor for that decision). Flagged points stay out of the line paths, y-domain, and headline avg (byte-identical over history; failures 7d-windowed client-side; summary discloses the count). New pure `src/ui/validation-merge.js` + 15 tests (664→679). Client display only — no learning/accuracy-metric change. Full protocol (plan → audit (15 findings) → implement → re-audit). ⚠️ in-browser verification pending. |
| 22 | **EF-divergence display-honesty patch (v38-gate fallback)** | done | ✅ **v37.13** (2026-07-20) — server maintains a fail-closed 5h-median D̄ state (`ef_divergence/state`, non-fatal upsert; strict EF validity incl. new `hTime` stage-timestamp capture; cold lockout w/ 1°C hysteresis; ON≥1.20/OFF<1.15); pending/validation/`validation_failure` rows stamped with `efDivergence`/`divergenceActive`; learning GET ships the state; client (2h freshness guard) downgrades displayed confidence one notch + shows the evidence-based "why to trust it less" advisory; learning payload refreshes on the 15-min cycle. NO estimate/learning/weight change. Full protocol (plan → 17-finding audit, all accepted → implement → re-audit); 679→702 tests. Plan: `analysis/ef-divergence-advisory-plan-2026-07-20.md`. ⚠️ in-browser + first-live-cron verification pending. |

---

## Modeling — deferred with skepticism

- ✅ **v37.15 LF-residual advisory — SHIPPED 2026-07-23.** Second display-only honesty banner
  driven by the model's own validated LF residual (rule R2: pair ≤ −15% latches, > −7.5% clears,
  12h signal staleness) — catches below-EF ungauged-inflow events the v37.13 EF advisory is
  structurally blind to (motivating case: 2026-07-22 storm, −21% hard-flagged miss at D̄ 1.15).
  Decision-gated backtest on the frozen v38 dataset, blind Python/R dual-verified; full evidence +
  10-finding plan audit in `analysis/lf-residual-advisory-plan-2026-07-23.md`. Known limits, on
  the record: reactive (first miss of every episode unflagged), ~4.9% duty (exceeds the pre-stated
  2–3% bound — user-accepted; banner-up hours ARE degraded ~6×), positive-err corrupt-LF hard flags
  can false-CLEAR a true alarm (accepted, documented). NOT a model change; the v38 re-open
  condition below is untouched.

- ❌ **v38.0 EF divergence gate — FAILED its pre-registered gate (2026-07-20). Not implemented.**
  Externally reviewed plan (v3), 85-config × 2-mode prequential replay over 14.6y: best cell +10%
  event-window MAE improvement vs the required 25%; even T_LO=1.20 false-activates on 9.5% of
  normal hours with CI-confirmed harm. Structural cause: in 4 of 6 historical below-PoR windows
  EF read *below* the PoR estimate throughout (D̄ max 0.84–0.98) — water entering below Edwards
  Ferry is invisible to both sensors; the 2026 episodes were a regime-biased (EF-visible) sample.
  Full verdict: `analysis/v38_gate_verdict_2026-07-20.md`. Re-open only with a genuinely new
  observable for the below-EF reach (none exists at USGS today), NOT with re-tuned thresholds.

- ⏸️ **C45 Phase 2 — trend-state-axis correction smoothing.** **NOT PURSUING** (decided 2026-06-23).
  Rejected on the existing evidence, not a fresh gate: the v37 bin-edge diagnostic + the Phase-1
  backtest gate both showed the high-flow state flips (25–50k rising↔falling ≈ 3,088 cfs) are **real
  regime signal**, and smoothing the 25k/50k *flow* boundaries already **failed** the gate for the same
  reason (→ v37.0 left those boundaries stepped). Smoothing the state axis is the same move on an
  analogous regime boundary and would, on that evidence, **degrade** high-flow accuracy. Not worth a
  new backtest to prove a negative we already expect. Re-open only with a concrete blend design that
  provably preserves the high-flow signal; gate it with `analysis/c45_gate.mjs` before any implementation.

---

## 🔴 Open — follow-ups created by v37.16 (2026-08-28)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 23 | ✅ **Reset forecast accuracy — DONE 2026-08-28 16:24Z** | done | Ran via the PIN-gated `resetForecastAccuracy` endpoint (user supplied the PIN). Verified: `gf_forecast_metadata` 0 rows, `gf_forecast_pending` 0 rows, `audit_log` entry written at 16:24:23Z. **Nowcast untouched as intended** — `gf_correction_bin` still 28 rows, 314 validations / 6.94% mean error, both advisories unchanged. The pre-reset numbers are preserved in `analysis/forecast-accuracy-final-snapshot-pre-reset-2026-08-28.md` (they are the empirical corroboration of the timing bug and were otherwise destroyed). Accuracy now rebuilds from zero under the corrected clock; the panel stays hidden until 10 validations accrue, and +48h needs ~2 days per validation. |
| 24 | **Split-out: forecast `:407` GF→LF travel bypass** | small | `src/ui/great-falls-ui.js:407` computes its own `TRAVEL_GF_LF_BASELINE * getFlowMultiplier(currentCFS).mult`, bypassing `getGFtoLFTravelTime` — so the forecast misses the rising-river celerity reduction (up to −30%) **and** disagrees with the GF→LF travel time already displayed at `:239` (`gfEstimate.inputs.travelGFtoLF`, from the iterated historic-PoR mult). Two different GF→LF numbers on one card. Also passes `currentCFS` (a GF estimate) into a parameter documented as `lfFlow`. **Minimal fix:** reuse `gfEst.inputs.travelGFtoLF` (already parity-tested, already displayed) with a null guard for the EF-only ice path (`great-falls.js:367`). Split from v37.16 deliberately — it changes displayed forecast values, so it wants its own version + attribution. Still MINOR. |
| 25 | **Displayed travel times aren't rise-adjusted (header / All Gauges / Learning tile)** | small | `calcTravelTimes()` (`src/data/fetch.js:139-160`) is `baseHrs × mult` with **no** rise-rate term, while the GF card's PoR→GF and GF→LF rows apply up to a −30% wave-celerity reduction. Steady flow: agree within ~0.2h. Rising 5%/hr: header 29h vs GF-card 26.2h. Rising 15%/hr: 29h vs 20.4h. Also `waveCelerity.reductionPct` is computed at `great-falls.js:589` and **rendered nowhere**, so nothing explains why the card's numbers moved. Decide: adjust the displayed arrivals too, or surface the reduction. |
| 26 | ⚪ **Forecast validation is read-modify-write with no claim** | medium | `validateForecastPredictions` does `getObs` → mutate → `upsertObs` → `deleteObsById` with no claim-before-score, so two overlapping cron runs can double-count. Pre-existing; v37.16 widens the window slightly (rows live one travel time longer). The nowcast solved this in C12 (claim-before-learn) and `updateLfResidualAdvisory` has an F2 skip-guard — this is the last unguarded write path. Deliberately NOT bundled into v37.16 to keep attribution clean if the metric moves. |

---

## 🔴 Open — pre-existing defects surfaced by the v37.17 review (2026-09-02)

*All three were found by the adversarial verification of the v37.17 diff, not by the diff itself. None is caused by v37.17; none is fixed by it.*

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 27 | ✅ **DONE v37.19 — clean series added under the `!isHardFlagged` gate; legacy fields frozen as an audit trail (option (c), user's call 2026-09-02).** | done | The stage metadata block (`scheduled-update.js:1414-1418`) sits **outside** `if (!isHardFlagged)`, but the `stage_*` bin write (`:1230`) sits **inside** it. So all 18 hard-flagged (physically implausible) validations feed `sumAbsStageError`/`stageValidations` while being correctly excluded from the bins. Live: the dashboard "Stage Err" row reads `n=313`; the stage bins hold **295**. This is the same class of defect v32.3 fixed for `avgErrorPercent` (flagged observations inflating the headline) — it was simply never applied to the stage series. **Fix:** move the stage metadata block inside the `!isHardFlagged` gate. **Changes a published metric**, so it wants its own version + a before/after note; `avgStageError` will move. |
| 28 | ✅ **DONE v37.18 — `resetLowFlowBins` DELETED; `resetGFLearning` keeps bin-write health.** ~~`resetLowFlowBins` wipes the bin-write health counters and desynchronises the derived diagnostics** | small | The action deletes only the 12 low-flow bins (`sync-learning.js:598-615`) but upserts a `newMeta` literal that **replaces the whole jsonb**, so `binWriteSuccesses`/`binWriteFailures`/`stageValidations`/`stageSkipped` are dropped — despite the `// Keep health tracking` comment at `:645`, which only carries over `lastPrediction`/`consecutiveRuns`/`missedRuns`. Two consequences: bin-write health silently restarts at 0 (the v37.7 diagnostics panel's whole point), and the surviving high-flow bins keep pre-reset counts while the counters restart, so the v37.17 derived figure and the bin-level deficit diverge permanently. **Fix:** carry the health + stage counters across both reset literals, or spread `...oldMeta` and null only the learning stats. |
| 29 | ✅ **DONE v37.18 — now `Number.isFinite` on both operands** (stricter than the `!= null` first drafted: `lf.h` is parsed text so NaN is reachable and must stay rejected). | done | `const errorStage = (predictedStage && actualStage) ? … : null` (`scheduled-update.js:1039-1041`) is a truthiness test, so a real 0.00 ft reading is discarded as absent. Not reachable at Little Falls in practice (stage never approaches 0), but it is the wrong predicate and the new `stageSkipped` counter would silently absorb it. **Fix:** `predictedStage != null && actualStage != null`. |

---

## 🔴 Open — found during the v37.19 verification rounds (2026-09-02)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 30 | ✅ **DONE v37.20 — worse than filed: the discarded error also disabled Check 5 and the ±2σ clamp, so the observation entered learning unvetted AND the bin was overwritten. Now excluded from learning + accuracy and counted as `binReadFailures`/read-skip.** | done | `scheduled-update.js:1133` does `const { data: existingBin } = await client…single()` with **no error binding**, then `existingBin?.data || { count: 0, … }` at `:1140`. Because `.single()` also errors with `PGRST116` when the row does not exist yet, an ignored error makes a transient read failure indistinguishable from "new bin" — and the fallback then **upserts `count: 1` over a bin holding n=71**, wiping the learned correction for that (flowBin × flowState) with no counter firing and nothing in the panel. `binWriteSuccesses` even increments, because the *write* succeeded. **This one feeds the estimate**, unlike the stage bin: the next estimate in that bin applies a correction derived from a single observation, and `getGFCorrection` blends at weight 1/5 toward the hierarchical fallback, so the visible jump can be hundreds of cfs. Fixed for the `stage_*` bin in v37.19; **deliberately NOT bundled** because the CFS path changes displayed estimates and wants its own version + attribution. **Minimal fix:** bind the error, treat only `PGRST116` as "no row", otherwise skip the write and set `binWriteFailed = true`. Same two-line shape as the v37.19 stage fix, plus the existing `binWriteFailed` plumbing. |

---

## 🟠 Open — bin storage → estimation review (2026-09-02)

*From a full sweep of the applied correction across 500–80,000 cfs, driven by the live bin data. These are design/behaviour findings, not defects introduced by v37.17–v37.20. Ranked by consequence.*

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 31 | 🔴 **The 25,000 cfs cliff — the corrected estimate FALLS as the river RISES** | small | `CORR_SMOOTH_BOUNDARIES` (`shared/model.js`) smooths 3k/6k/12k but deliberately leaves 25k and 50k as steps ("backtest showed smoothing them degraded accuracy"). With the current bins that step is now enormous: at exactly 25,000 cfs the applied correction jumps **219 → 3,273** (rising) and **209 → 2,336** (steady). Since `corrected = raw − correction`, the displayed estimate **drops 3,053 cfs (rising) / 2,126 cfs (steady) for a 1-cfs rise in the raw estimate.** A full 500→80,000 cfs monotonicity sweep confirms these are the only large inversions (falling is clean: 209 → 185). The original decision justified a *step*; it did not anticipate a 3,000 cfs one, and 25,000 cfs at Great Falls is exactly when someone is watching the number. **Also:** rising is mildly non-monotonic *through the smoothed 3,000 band* — the correction ramps +769 cfs while flow rises 681, a gradient of 1.13, so ~88 cfs of backward travel. Smoothing removed the jump but not the inversion; the inversion condition is d(correction)/d(flow) > 1 inside a band, which nothing checks. |
| 32 | 🔴 **`50000+` has never been observed and silently inherits the bin below** | medium | n=0 in all three states, permanently — no 50k event since the bins began. `getFallbackCorrection` walks to the neighbour and applies `25000-50000` wholesale: **3,273 cfs subtracted at 70,000 cfs** (rising). No extrapolation guard, no widened uncertainty band, no "this bin is unlearned" signal anywhere in the UI. The most consequential flow regime for safety has the least evidence behind its correction, and nothing says so. |
| 33 | 🟠 **Bins carry no `lastUpdated`, so a stale correction is indistinguishable from a fresh one** | small | Confirmed: `lastUpdated` is null on all 28 rows. Consequence, live: `6000-12000_rising` holds n=4, meanError −1,580.25, and applies **−1,000 cfs (−11.1%)** — the only negative bin in the system. `analysis/ef-divergence-gate-plan-v2-external-review-2026-07-20.md` recorded that bin at n=4 / −1,580 on **2026-07-20**; it is *still* n=4 / −1,580.25, `created_at` 2026-05-24. **Zero observations in six weeks**, applied at full strength to every rising 6–12k estimate, with no way to see it. Minimal fix: stamp `lastUpdated` on write and surface bin age in the panel. Whether staleness should *decay* the correction is a separate call (see #35). |
| 34 | 🟠 **Corrections apply at full weight from n=5, but the outlier clamp only starts at n=10** | trivial | `getGFCorrection` reaches full weight at `count >= 5`; `updateCorrectionBin`'s ±2σ soft clamp requires a PRE-observation `count >= 10` (v39.0; was post-increment, i.e. pre ≥ 9). **Bins with n = 5–9 therefore apply a raw EMA at full strength with no outlier protection at all** — precisely the sparse bins most vulnerable to one bad observation. Live right now: `0-3000_rising` at n=7, the bin a falling river is heading into. The two thresholds should be the same number, or the clamp should start at 5. |
| 35 | 🟠 **EMA memory is counted in observations, not time** | medium | `GF_EMA_ALPHA = 0.3` gives ~3.3 observations of effective memory — *identically for every bin*. Low bins update roughly hourly, so that is ~3 hours (appropriate). `25000-50000` has 57 observations total since May across a handful of flood events, so ~3 observations can span **months**. The same constant yields time constants differing by orders of magnitude, and high-flow corrections are in practice frozen snapshots of the last flood. Interacts with #33. Needs a decision-gated backtest before any change — do not re-tune alpha by intuition. |
| 36 | 🟡 **No floor guard: the correction is a large fraction of flow at the bottom end** | small | `applyGFCorrection` has a 120%-of-LF *ceiling* (`CEILING_RATIO`) and nothing below. The 0–3000 correction is a flat cfs offset learned mostly near 2,000–3,000 and applied unscaled all the way down: at raw 1,000 cfs steady the correction is 420 → corrected **580 (a 42% cut)**; at 1,500 → 1,080 (28%); at 2,500 → 2,080 (17%). Drought is when low-flow accuracy matters most to paddlers. Consider scaling the correction by flow, or a floor analogous to the ceiling. |

### ✅ What the same review found working

Recorded so a future session does not re-litigate it: the 3k/6k/12k smoothing produces continuous ramps with no steps; learn-bin == apply-bin by construction and the interpolation is application-only, so there is **no learn↔apply feedback loop**; the hierarchical fallback (same-bin pooled → adjacent-bin same-state → 0) with linear blending genuinely removes the n=5 discontinuity; server/client parity is locked by `correction-parity` + `correction-interp`; `buildCorrectionBins` is shared by cron and API so they cannot drift; and the bin counts reconcile exactly (`sum(CFS bins) == validValidations == binWriteSuccesses`, 0 failures).

---

## 🔴 Open — anomaly-gate follow-ups (2026-11-09, updated 2026-11-10)

*From `analysis/anomaly-gate-rework-plan-2026-11-09.md`, `analysis/outlier-always-soft-plan-2026-11-09.md` and their plan audits. v37.21 shipped the Check 3 ice gate; v39.0 implements option A1 (Check 5 always-soft, pre-observation clamp).*

1. ✅ **Check 5 rework — implemented in v39.0 (option A1)**: outliers are soft, learned through a clamp bounded at 0.6·σ_pre and counted in accuracy. **Production behaviour UNVERIFIED until a z > 3 validation occurs** (then `softOutlierValidations` ≥ 1, the bin count +1, a `soft_outlier_event` row, no new `validation_failure` row).
2. Recalibrate Check 3's 2.45 ft threshold against the rating relation using winter data (2.45 ft is ~500 cfs; in cold water every sub-1,500 cfs validation still flags).
3. The water-temperature reading has no age check (it is the latest value in P1D), so a stale temperature can decide Check 3.
4. Rewire `analysis/ci_backtest_harness.mjs`, `c45_gate.mjs` and `flow_state_floor_gate.mjs` to the shared `isIcePlausible` and `classifyOutlier` helpers before the next backtest (they replay the pre-v37.21 Check 3 and the pre-v39.0 hard Check 5 while importing the v39.0 `updateCorrectionBin`; header notes added in v37.21 and v39.0). `analysis/v38_gate_harness.mjs` and `multipending_gate.mjs` import `scoreAnomalies` from `ci_backtest_harness.mjs` and `updateCorrectionBin` from `shared/model.js`, so they mix the same pre-v39.0 hard Check 5 / pre-v37.21 Check 3 with the v39.0 clamp (v39.0 NOTE headers added to both).
5. Dead client copy of Check 5: `isGFOutlier` in `src/estimation/great-falls.js` and `GF_OUTLIER_THRESHOLD` in `src/model/constants.js` (v39.0: marked dead by comment; delete in a later cleanup).
6. The validation-failures GET endpoint caps at 50 rows and the table now holds 54.
7. 👀 **Review the first live `soft_outlier_event` rows** (v39.0): confirm `clamped`, `emaAfter − emaBefore` ≤ 0.6·`sdPre`, `zScore` and `binCountAfter` look right, that no new `validation_failure` row was written for the same prediction, and that `softOutlierValidations` advanced by one. Ignore `emaAfter` / `binCountAfter` on any row where `binWriteFailed` is true (the bin upsert failed, so those values were never persisted). Closes the v39.0 verification gap.
8. **7-day chart y-domain now takes soft outliers** (v39.0): soft-flagged observations are non-hard-flagged readings, so a −70 % local-runoff miss now enters the chart's y-domain and can squash the real series. Decide whether to exclude `outlierZ` entries from the domain (client change, not done).
9. **CI-band provenance**: `EMPIRICAL_CI_90` (v36.1) was derived under the old hard Check 5 and the post-stat clamp; it lags the v39.0 learning rule. Re-derive when the harnesses are rewired (item 4), via the plan → audit → blind dual-language protocol.
10. 🔒 **Owner decision: should bin-read-failure rows still be excluded from accuracy?** (v37.20 excluded them because "Check 5 could not run"; since v39.0 Check 5 no longer drops observations, so that rationale lapses. Kept as is. Note an unvetted observation also cannot be clamped, which is the remaining reason.)
11. *(accepted, not fixed — v39.0 review)* `resetGFLearning` zeroes `softOutlierValidations` but keeps `soft_outlier_event` rows (audit history, same as `validation_failure`); compare row counts with the counter only after `resetAt`.
12. *(accepted, pre-existing)* An observation whose bin read failed (`binReadFailed`) still enters `gf_validation_history` and the client's 7-day chart/average: `storeValidationPair` is gated on `!isHardFlagged` only. Fix if wanted: `!isHardFlagged && !binReadFailed` (scheduled-update.js).
13. *(accepted, not fixed)* No API endpoint reads `soft_outlier_event` rows; inspecting them needs direct DB access. Optional: a `soft-outlier-events` GET mirroring `loadValidationFailures` (newest 50).
14. *(accepted, not fixed)* The stage-bin clamp is triggered by the CFS-domain outlier flag (`isSoftFlagged`), so a normal-looking stage residual can be clamped when the CFS residual is an outlier (per spec section 2), and the event row records no stage outcome (`stageLearningError` / `stageClamped` would need hoisting out of the stage block).
15. *(accepted, by design)* With `sd_pre = 0` and pre-count >= 10 a soft observation is learned unclamped at the full step (a zero-width clamp would freeze the bin; `classifyOutlier` never flags it either). A floor would be a spec change and needs unit-scaled values for flow (cfs) vs stage (ft).

---

## 🔴 Open — October 2026 flood audit (2026-11-10)

Source: `analysis/pulse-audit-2026-10/REPORT.md` (ranked problems and evidence). Owner asked for all ten,
worked one at a time in this order. A–E items change the model or its scoring and need the full
plan → audit → dual-language protocol; A6 and A7 must not be judged on this one event alone.

| # | Item | Status | Size |
|---|------|--------|------|
| A1 | **Stale cache.** Fetch river data network-first; drive "Updated" from reading time, not fetch time. | ✅ done 2026-11-10 (v39.1); plan and audit response in `analysis/stale-cache-fix-plan-2026-11-10.md`. In-browser checks still pending (see plan section 6). | small |
| A2 | **+9,743 bin** (12,000–25,000 steady, one mislabelled observation). | ✅ done 2026-11-10: flow bin + paired stage bin deleted; record and undo in `analysis/bin-reset-2026-11-10-12000-25000-steady.json` | decision |
| A3 | **Logging.** Per prediction: inputs seen, raw value, flags, whether the cap bound; keep clean rows longer. | ✅ implemented 2026-11-10 (v39.2); plan and audit response in `analysis/prediction-logging-plan-2026-11-10.md`. **Production behaviour UNVERIFIED** until the follow-ups below are checked. | small |
| A4a | **120% cap indicator.** Show when the cap is active. | ✅ done 2026-11-10 (v39.3); plan and audit response in `analysis/cap-indicator-plan-2026-11-10.md`. Browser checks pending (phone layout, light and dark, screen reader, live bound example). | small |
| A4b | **Keep capped rows out of learning.** | NOT done, 🔒 owner decision. A4 was split. The October finding was aimed at the wrong cause: the capped rows did train the 12,000 to 25,000 rising bin, but the cap did not cause the value. Bins learn the raw residual (rawCFS minus actual), the learning code never reads `ceilingApplied`, and the same residuals would have been learned with no cap (`analysis/cap-mechanism-map-2026-11-10.md`). Recommendation: do not filter by `ceilingApplied`. After two or three real rises, replay "exclude" and "down-weight" on the raw values that v39.2 now logs, then decide. The real fix is upstream in A7. | small |
| A4c | **Cap indicator follow-ups (from the v39.3 re-audit; none changes the estimate).** (1) The map popup (`src/ui/great-falls-ui.js` near line 312) and the dashboard (`src/ui/learning-ui.js` near lines 220 and 401) show the capped value with no mark. (2) The note's "over 3 h old" clause is computed only on the 15 minute render, so it can lag. (3) The note sits inside the card's atomic live region and is re-read on each change. (4) The note type is small (0.6rem). Added by the last independent check: the loading and no-estimate paths never rewrite the 90% range row, so after a capped render it can keep "(around the capped value)" while the note is hidden; and the page wiring of that suffix is guarded only by a source pattern, so add a test that renders the card update against a fake page. | NOT done, can wait. | small |
| A5 | **Difficult Run.** Subtract from the validation truth, or flag validations when it is high. | open 🔒 | medium, needs a backtest |
| A6 | **Multi-pending validation.** Reopen for responsiveness (learning was 23 h late at onset). | open 🔒 | large, rejected once in June |
| A7 | **Rising-limb travel lookup + PoR-delta correction.** | open 🔒 | large, needs A3 data first |
| A8 | **Confidence band and labels.** Rebuild from live residuals. | open 🔒 | medium |
| A9 | **Creeks tab high-water state; How It Works corrections.** | ✅ done 2026-11-10 (v39.4); plan and audit response in `analysis/creeks-highwater-and-howitworks-plan-2026-11-10.md`. Browser checks pending (see A9 follow-ups). | small |
| A9z | **Left by the last independent check of v39.4 (none blocks; none changes the estimate).** (1) The banner and tab dot stay green when one creek is currently at 1x to 2x while another creek's OLD reading was at 2x or more; the old card is grey and says so, but the colour ignores it. Decide whether an old high reading should hold the colour. (2) The confidence legend's "also drops when the latest check against Little Falls was far off" is broader than the code: it lowers only when the estimate was at least 15% below Little Falls within the last 12 h, and never for an over-estimate (appendix 5.9 is exact). (3) "1 with no data. Levels for those creeks" mixes singular and plural. (4) Old-reading text rounds the cfs but truncates the multiple (1599.6 cfs reads "1600 cfs, 7.9x"). (5) `creek_lastran` is stamped with fetch time, so a card with an old reading can show "Last ran: today". (6) The `data:unavailable` re-render is pinned only by a source pattern, not a behavioural test. | open | small |
| A10 | **Orphan `rise_event` writer.** | ✅ found and paused 2026-11-10: Supabase pg_cron job 2 (`potomac-learning-job`, every 15 min since 2026-01-14) calling the edge function `potomac-learner`; its inserts were failing on the unique key. Job set inactive at 18:01 UTC, verified. **Still to do, on or after 2026-11-17, with the owner's go-ahead:** unschedule the job (removes the anon key stored in its command), delete the edge function, the unused database function `run_potomac_learning()`, and the eleven rows it owns. Evidence and undo: `analysis/orphan-writer-2026-11-10/`. The RLS policy "Allow public access" (anon can write any row) is still in place: its removal was declined at the permission prompt on 2026-11-10 and waits for the owner. | paused 🔒 | small |

**Owner checks, 2026-11-10.** The owner reported "all good / green" after the manual checks requested that day. Read here as: the four-step browser checklist for v39.1 to v39.4 passed (header shows "Latest reading ... ago"; Creeks tab shows multiples; How It Works legend corrected; airplane-mode reload opens with "Saved copy:") and the healthchecks.io check is green. That reading is the assistant's, from a two-word reply; the individual steps were not itemised by the owner. Not covered by it: the amber, red and old-reading creek states and a live capped estimate, which need rain or a fast rise.

**Decisions waiting on the owner for A5 to A8:** `analysis/decision-brief-A5-A8-2026-11-10.md` (options, recommendation, backtest outline and one question per item; the gate thresholds in it are proposals, not yet agreed).

**Follow-ups from A9 (v39.4, 2026-11-10; plan `analysis/creeks-highwater-and-howitworks-plan-2026-11-10.md`):**

- **Per-creek high-water values: none available.** Owner answered on 2026-11-10 that there is no high-water data for the creeks. The multiples (2x, 5x) and the sentence that Potomac Pulse has no high-water level stay as shipped. Reopen only if a sourced level per creek turns up (then add `upper` and `upperSource` to `CREEK_RUNS`).
- **How It Works travel-time numbers disagree** between index.html :273, :331 and the table at :422-426 (about 19 h vs 26 h typical). Separate ticket; not part of A9.
- **Card cfs rounding.** The card uses Math.round, so Rock Creek at 399.6 shows "400 cfs" next to "Needs ≥400". Pre-existing.
- **Browser checks not done (unverified):** colours and contrast of green, amber and red in light and dark theme; banner wrapping at 320 px and the long high-water sentence fitting the card; the amber flow line in the chart is distinguishable from the amber dashed threshold line (`--accent-amber` vs `--accent-loading`) and the gradient renders the amber and red RGB values; tab-dot colours in the real tab bar; screen reader reading of the status line; live USGS response with the service worker cache.
- The confidence-band wording at index.html:215 (49% coverage) is left to A8.
- **Untested creek display parts (v39.4).** The UI status colour, cfs colour, chart line colour and gradient, card order and trend tooltip are not covered by tests (the chart renderer never runs in tests). The cfs text in red (4.19:1 on the card) still uses the plain red; only the status line and the banner use the lighter red.
- **Age is re-checked only on the 15 minute tick** (and on `data:unavailable`), so a reading can show as current for up to about 15 minutes past 2 h.

**Follow-ups from A3 (v39.2, 2026-11-10; plan `analysis/prediction-logging-plan-2026-11-10.md`):**

| # | Item | Status | Size |
|---|------|--------|------|
| A3a | **Verify the first live rows.** After the first deployed tick read one `tick_log` row: `commit` non-null (if null, `COMMIT_REF` is not available in the scheduled-function runtime and `ver` alone is the record), `ms` plausible, `in.lf.qT` and `in.tT` match the USGS page. | open 🔍 | tiny |
| A3b | **Verify the 03:00 UTC run.** Check a `bin_snapshot` row exists for the day and `tick_log.aux.prune` shows candidate counts. Check `pg_column_size` of each type after a day and a week; move retention if the size estimate was off by more than 2x. | open 🔍 | tiny |
| A3c | **First real prune is an unverified gap.** `tick_log` has its first candidates at day 180; until then the delete path is proven only by mocks. Option: with approval, insert one synthetic `tick_log` row with `gauge_id = '2020-01-01T00:00:00.000Z'` and confirm the next 03:00 UTC run deletes exactly that row. That is a production write, so it needs a go-ahead. | open 🔒 | tiny |
| A3d | **First `validation_log` row.** Appears at the next validation (13 to 19 h at current flow, longer in calm weather). The non-claimed fates (`stale_deleted`, `replaced_missed_window`, `claim_lost`) may not occur for weeks and are proven by mocks only. | open 🔍 | tiny |
| A3e | **Ran but made no prediction.** The tick row records it (`out`, `why`); the healthchecks ping is unchanged. Measure how often `null_lf_or_por` and `insert_failed` occur from `tick_log`, then choose a `/fail` threshold (for example 3 in a row). Ice must stay green in winter. The healthchecks.io period and grace are still unconfirmed. | open | small |
| A3f | **Scored 48 h forecast rows.** Deferred: they need the client-posted NWS inputs stored with them. Flood audit item 4 stays open. | open | medium |
| A3g | **RLS "Allow public access".** The logs (and every other row) can be read, deleted or forged with the anon key. Separate migration; can break the cron if done wrong. | open 🔒 | medium |
| A3h | **Platform limits.** Netlify's 30 s scheduled-function limit and the 500 MB vs 2 GB plan limit are from memory; check both. Added time is capped at about 6 s after the ping. | open 🔍 | tiny |
| A3i | **Three test gaps left by the last independent check (code is correct today).** The handler test's event recorder sees only inserts and upserts, so a prune delete or a log select moved before the success ping is not caught; and the five handler-stamped fields on a stored prediction (`shadowModels`, `efDivergence` and three more) are checked for presence, not value. Record delete and select events in the recorder; pin the stamp values. | open | small |
| A3j | **Three notes from the production check of v39.2.** (1) `commit` is null in every `tick_log` row because `COMMIT_REF` is not available to the scheduled function, so rows identify code only by `ver`. (2) On a tick whose `slot` is `skipped_in_window` the row's `due` field is the due time of a prediction that was not stored, and can be mistaken for the real pending deadline. (3) `ef.w` in the tick row is rounded to 0 where the pending row keeps 6.85e-5. | open | small |

**Follow-ups from A1 (v39.1, 2026-11-10; plan `analysis/stale-cache-fix-plan-2026-11-10.md`):**

| # | Item | Status | Size |
|---|------|--------|------|
| A1a | **`/api/sync` is not SW-cached.** The learning reads use `/api/sync` (Netlify rewrite), which matches no runtime route, so the June plan's "offline user sees last learned estimate" is false for corrections. If the `pp-api` regex is ever widened to `/api/sync`, it must be NetworkFirst. The false comment in `src/main.js` was corrected in v39.1. | open | small |
| A1b | **"Live - Connected to USGS" status text** is also shown when the SW served an old body. The label now carries the truth; the header text does not. | open | small |
| A1c | **`loadFromCache` age stamp.** A localStorage copy saved after an SW-stale 200 is stamped "now", so the cached/stale status dot can be off. The label is immune. | open | small |
| A1d | **Edwards Ferry freshness** is not in the label (it carries up to about 40% weight at high flow). | open | small |
| A1e | **24 h lag sample** of real USGS reading lag (Little Falls, Point of Rocks) to confirm the 120 min boundary; raise it if the 99th percentile of lag plus drift is over 120. | open | small |
| A1f | **CORS proxy fallbacks look dead (2026-11-10).** corsproxy.io answered 403 `keyless_legacy_url` and allorigins did not answer, so the direct USGS call is effectively the only path. Replace or remove the proxy chain. | open | small |

---

## 📅 Date-gated / watch

- ✅ **`scheduled-update` outage — RESOLVED:** the cron resumed on its own by 2026-09-03T21:00Z (first post-outage write `legacyStageFrozenAt`). Root cause was never diagnosed. As of 2026-11-09: 454 consecutive runs and 656 lifetime missed ticks. There is still no stall alerting because `HEALTHCHECKS_PING_URL` is unset.

| Item | When | Notes |
|------|------|-------|
| ✅ **Reassess LF ground-truth bias (C32 estimand)** | **RESOLVED 2026-08-28 — documentation matter, no model change** | `analysis/lf-ground-truth-bias-scoping-2026-08-28.md` (scoped → audited → **§2 retracted**). Every calibrated component (EMA residual, EF power-law fit, CI table, 120% ceiling) is anchored to **Little Falls**, so the displayed "GF flow" is structurally *LF discharge one travel time ahead*, and there is no GF ground truth. **But the practical difference is negligible:** only the Washington Aqueduct's Little Falls intake (~43 cfs, drawn from the gage pool) sits between the two points, it is partly offset by Difficult Run + Cabin John (~7–11 cfs), and operator records show it at **0 MGD throughout the Sept-2025 drought** — so the net wedge is ≈ **−10 to +70 cfs and ~0 exactly when flow is low**. The big diversions (WSSC at Swains Lock, Fairfax at Seneca, Aqueduct at Great Falls) are **above the falls** and lower both points equally. This independently reproduces the v31.2 (2026-02) conclusion. ✅ Done: appendix §6.1 corrected twice — first for the false "calculate[s] what GF actually was", then to fix a WSSC-geography error this session's own scoping doc introduced. **No further work recommended.** If anyone ever wants it closed empirically rather than arithmetically, use USGS **01646502** (published adjusted series, daily, back to 1930) — not ICPRB, whose reporting is episodic (~11% of days) and has no API. |

---

## Recently completed (reference)

- **v39.4** (2026-11-10): Creek level bands and How It Works corrections (A9; MINOR, client only, estimation unchanged). Creeks tab shows the multiple of the minimum with green/amber/red bands, a grey old-reading state, and says Potomac Pulse has no high-water level for the creek; banner and tab dot follow the highest band; four How It Works statements and the matching appendix/README lines corrected. New `src/ui/creek-level.js`; 65 new tests (1140 total). `SERVER_VERSION` stays v39.2.

- **v39.3** (2026-11-10): Cap indicator (A4a, flood audit problem 4; MINOR, display only, estimation unchanged). The Great Falls card says when the 120% cap holds the number down, with the model's own value; inputs row "120% ceiling"; 90% CI row marked when capped. Additive `inputs` fields only. 42 new tests (1075 total). `SERVER_VERSION` stays v39.2. A4b split off and left open. Plan: `analysis/cap-indicator-plan-2026-11-10.md`.
- **v39.2** (2026-11-10): Audit logging for the hourly cron (A3, flood audit finding 3; MINOR, server-only, estimation unchanged). `tick_log`, `validation_log`, `bin_snapshot`, `log_health` rows; non-fatal, time-bounded, written after the success ping; bounded prune of the three log types only. 913→1032 tests. Production behaviour UNVERIFIED (see A3 follow-ups).
- **v39.1** (2026-11-10): River data is network-first in the service worker; the "last update" label shows the age of the readings, not of the fetch; an old direct USGS payload now still tries the CORS proxies (A1, flood audit finding 5; MINOR, client only). 842→913 tests. Amendment: the page reads the USGS response time (requestDT), so a live body with old readings costs no extra downloads when the clock is right (plan section 11). In-browser checks still pending. Plan: `analysis/stale-cache-fix-plan-2026-11-10.md`.
- **v39.0** (2026-11-10) — Statistical outliers (Check 5) are soft: learned through a ±2σ clamp computed from PRE-observation bin stats (≤ 0.6·σ_pre per observation; stage bins likewise; `EF_DISCREPANCY` soft path changes with it) and counted in accuracy, so the headline reads worse for the same model (MAJOR, server-only; v38 skipped). New `soft_outlier_event` rows / `softOutlierValidations` / `outlierZ`. 798→842 tests. Production behaviour UNVERIFIED until a z > 3 validation occurs. Plan: `analysis/outlier-always-soft-plan-2026-11-09.md`.
- **v37.21** (2026-11-09) — Check 3 (`LOW_FLOW_HIGH_STAGE`) fires only when ice is plausible: water temp ≤ 5 °C, or Nov–Mar UTC when temp is unknown (MINOR, server-only). 15 warm-water validations had been hard-flagged 2026-09-16 → 10-10. Thresholds unchanged; production behaviour UNVERIFIED until LF < 1,500 cfs. 780→798 tests. Check 5 part then on hold; done in v39.0.
- **v37.20** (2026-09-02) — CFS bin read stops discarding its error; unvetted observations are refused, not guessed (TODO #30 closed).
- **v37.19** (2026-09-02) — Stage error stops averaging over hard-flagged observations; legacy frozen against a latched denominator; stage-bin read/write failures now suppress the clean series and register as faults (TODO #27 closed, #30 opened).
- **v37.18** (2026-09-02) — Removed dead `resetLowFlowBins`; `resetGFLearning` keeps bin-write health; `errorStage` uses `Number.isFinite` (TODO #28, #29 closed).
- **v37.17** (2026-09-02) — Stage-skip counter: `stage_*` bins silently lag the CFS bins by 12 obs when a gauge-height pair is missing (MINOR, diagnostics only).
- **v37.16** (2026-08-28) — Forecast validation clock + NWS baselines retired (MINOR, metrics/display only).
  Forecasts were scored against LF at `targetTime`, omitting the GF→LF travel time — the behavior CLAUDE.md
  and tech-appendix §8.6 already specified. Now validated at `targetTime + travel`; stale sweep 72→90h;
  fetch cap 100→300; `travelApplied` keeps the offset-free PoR fallback un-deferred. The two NWS baselines
  were retired (on the model's own clock they are the model plus a constant) — persistence is now the sole
  skill comparison. 744→757 tests. Plan + audit + re-audit:
  `analysis/forecast-validation-timing-fix-plan-2026-08-28.md`. **Follow-ups: #23–#26 above.**

- **v37.2** (2026-06-18) — Cron observability fix (MINOR, server-only): USGS-fetch-failure path now throws
  into the healthchecks `/fail` ping instead of silently early-returning. `analysis/cron-failping-fix-2026-06-18.md`.
- **v37.1** (2026-06-18) — System-1 gauge travel-time learning retired (MINOR, display-only): removed dead
  client + server code + 43 stale DB rows; displayed gauge arrivals now `baseHrs × Searcy-multiplier`.
- **v37.0** (2026-06-18) — C45 flow-edge correction smoothing (MAJOR): applied correction continuous in flow
  across 3k/6k/12k; 25k/50k left stepped (backtest-gated). Learning unchanged.
- **v36.4** (2026-06-18) — C8/C16 server travel-time parity + 72h PoR-history retention (MINOR).
- **v36.3** (2026-06-17) — documentation-accuracy sweep + health-telemetry (MINOR, no model change).
- **v36.2** (2026-06-17) — travel-time documentation accuracy; travel-time refit closed low-leverage (MINOR).
- **v36.1** (2026-06-16) — C2 corrected-residual confidence band: sign-aware, asymmetric, re-derived.
- **v36.0** (2026-06-16) — C1 close the learning loop: server end-applies the EMA correction (shared helper).
- **v35.x** (2026-06-03/04) — characterization safety net; dead-code removal; endpoint gating; reliability
  & integrity fixes (C12 deadlock, C13a payload validation, C24 forecast baselines, C46/C49 sync honesty).
- Older history (v24–v35) is in README.md / CHANGELOG.md / git.

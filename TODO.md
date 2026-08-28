# Potomac Pulse — Remaining Work

**The single source of truth for outstanding work.** Open items live here; nowhere else.
Session state is in `.claude/HANDOFF.md`; methodology provenance for shipped versions is the
small set of cited docs in `analysis/` (see CLAUDE.md / README). Pick a tier, prioritize, go.

*Last updated: 2026-08-28 (current version: v37.16). Verified against live DB + git history, not memory.*

---

## How to read this

- **Tiers are by kind, not strict priority** — skim all, then prioritize.
- Effort is a rough order-of-magnitude.
- 🔒 = needs a decision from you before work starts · 📅 = date-gated · 🔍 = verify-only.
- Anything touching the estimate must keep the characterization/golden tests green and the
  client↔server parity tests green (`npm test` = **757**), or deliberately re-baseline + version-bump.
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
| 19 | **Service worker for offline** | done | ✅ **v37.10** — offline SW via `vite-plugin-pwa` (Workbox `generateSW`, `autoUpdate`): precaches the hashed app shell + geojson, runtime-caches (SWR) the `sync-learning` GETs (`pp-api`) + USGS/NWS data (`pp-data`), so a returning user opens offline with last-known state. `skipWaiting`+`clientsClaim`+`cleanupOutdatedCaches` busts the precache per deploy (no stale code); tiles excluded; `manifest:false`; no SW in dev; registered prod-only in `main.js`. New `#offlineBar` (`navigator.onLine`-driven, distinct from the fetch-failure banner the SW masks). CSP unchanged (origins already in `connect-src`). +2 tests (662→664); `dist/sw.js` emitted. 1 new build-time devDep (`vite-plugin-pwa`; 5 dev-only audit advisories, none shipped). ⚠️ in-browser verification pending (SW register/activate, offline reload, post-deploy cache-bust, no CSP errors). Plan→audit→implement→verify: `analysis/service-worker-offline-plan-2026-06-23.md`. |
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
| 23 | 🔒 **Reset forecast accuracy after v37.16 deploys** | 5 min | **Required for the metric to mean anything.** Every `gf_forecast_metadata` counter accrued while forecasts were scored one GF→LF travel time too early; the counters are cumulative sums with no per-era split, so pre- and post-fix validations cannot be un-mixed later. Do it **after** confirming the new gate fired in production (not at deploy — if the deploy is broken you want the old numbers to compare against). No UI button exists (see #17): out-of-band PIN-gated POST `resetForecastAccuracy`, which also deletes pending forecast rows. Expect the accuracy panel to go dark for a while afterwards (`updateForecastAccuracyUI` hides below 10 validations; the +48h horizon needs ~2 days per validation). |
| 24 | **Split-out: forecast `:407` GF→LF travel bypass** | small | `src/ui/great-falls-ui.js:407` computes its own `TRAVEL_GF_LF_BASELINE * getFlowMultiplier(currentCFS).mult`, bypassing `getGFtoLFTravelTime` — so the forecast misses the rising-river celerity reduction (up to −30%) **and** disagrees with the GF→LF travel time already displayed at `:239` (`gfEstimate.inputs.travelGFtoLF`, from the iterated historic-PoR mult). Two different GF→LF numbers on one card. Also passes `currentCFS` (a GF estimate) into a parameter documented as `lfFlow`. **Minimal fix:** reuse `gfEst.inputs.travelGFtoLF` (already parity-tested, already displayed) with a null guard for the EF-only ice path (`great-falls.js:367`). Split from v37.16 deliberately — it changes displayed forecast values, so it wants its own version + attribution. Still MINOR. |
| 25 | **Displayed travel times aren't rise-adjusted (header / All Gauges / Learning tile)** | small | `calcTravelTimes()` (`src/data/fetch.js:139-160`) is `baseHrs × mult` with **no** rise-rate term, while the GF card's PoR→GF and GF→LF rows apply up to a −30% wave-celerity reduction. Steady flow: agree within ~0.2h. Rising 5%/hr: header 29h vs GF-card 26.2h. Rising 15%/hr: 29h vs 20.4h. Also `waveCelerity.reductionPct` is computed at `great-falls.js:589` and **rendered nowhere**, so nothing explains why the card's numbers moved. Decide: adjust the displayed arrivals too, or surface the reduction. |
| 26 | ⚪ **Forecast validation is read-modify-write with no claim** | medium | `validateForecastPredictions` does `getObs` → mutate → `upsertObs` → `deleteObsById` with no claim-before-score, so two overlapping cron runs can double-count. Pre-existing; v37.16 widens the window slightly (rows live one travel time longer). The nowcast solved this in C12 (claim-before-learn) and `updateLfResidualAdvisory` has an F2 skip-guard — this is the last unguarded write path. Deliberately NOT bundled into v37.16 to keep attribution clean if the metric moves. |

---

## 📅 Date-gated / watch

| Item | When | Notes |
|------|------|-------|
| 🔴 **Reassess LF ground-truth bias** | **DUE — gate passed 2026-08-27** | EMA learning biases the GF estimate toward LF; revisit solutions now. Not started. |

---

## Recently completed (reference)

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

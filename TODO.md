# Potomac Pulse — Remaining Work

**The single source of truth for outstanding work.** Open items live here; nowhere else.
Session state is in `.claude/HANDOFF.md`; methodology provenance for shipped versions is the
small set of cited docs in `analysis/` (see CLAUDE.md / README). Pick a tier, prioritize, go.

*Last updated: 2026-06-19 (current version: v37.5). Verified against live DB + git history, not memory.*

---

## How to read this

- **Tiers are by kind, not strict priority** — skim all, then prioritize.
- Effort is a rough order-of-magnitude.
- 🔒 = needs a decision from you before work starts · 📅 = date-gated · 🔍 = verify-only.
- Anything touching the estimate must keep the characterization/golden tests green and the
  client↔server parity tests green (`npm test` = **645**), or deliberately re-baseline + version-bump.
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
| 15 | **Backup export function** | done | ✅ **v37.6** — PIN-gated "📥 Download Backup (JSON)" button in the Learning tab; `downloadLearningBackup()` fetches the live `gf` learning state + forecast accuracy fresh and downloads a timestamped JSON. Additive, read-only (no model/estimate/learning change). Build green, 645 tests. ⚠️ in-browser verification pending. |
| 16 | **Admin monitoring dashboard** | done | ✅ **v37.7** — added a "🔧 System Diagnostics" panel surfacing already-captured-but-hidden metrics (throughput, stage error, bin-write health, last-flag recency+reason, EF regression R²) from the loaded `gfLearningData`. Additive read-only display, no new fetch/server change. Scoped down from timelines/heatmap (would need new fetches). Build green, 645 tests. ⚠️ in-browser verification pending. The existing dashboard (current conditions, model health, validation chart, bin stats, shadow horse-race, forecast accuracy) already covered most of this item. |
| 17 | **Audit logging** | done | ✅ **v37.8** — the 3 PIN-gated reset actions append to a new `audit_log` observation type via a non-fatal `logAdminAction()` helper; GET `audit-log` endpoint + "🧾 Recent Admin Actions" list in the Learning tab. Fixed stale hardcoded `resetReason`. Full protocol (plan→audit→implement→re-audit); 9 new tests incl. non-fatal characterization (645→654). ⚠️ in-browser verification pending. Note: `resetForecastAccuracy` has no UI button (logs only via out-of-band POST). |
| 18 | **Log validation failures** | ~2h | Store failed validations for post-hoc analysis. |
| 19 | **Service worker for offline** | ~4h | Cache last-known state for offline viewing. |
| 20 | **Mobile sidebar scrolling** | ~1h | Sticky tabs, remove double-scroll on mobile. |

---

## Modeling — deferred with skepticism

- **C45 Phase 2 — trend-state-axis correction smoothing.** 🚩 The v37 bin-edge diagnostic + the Phase-1
  backtest gate both show the high-flow state flips (25–50k rising↔falling ≈ 3,088 cfs) are **real regime
  signal**, and smoothing the 25k/50k *flow* boundaries already failed the gate for the same reason.
  Smoothing the state axis will likely **degrade** accuracy. If attempted: reuse `analysis/c45_gate.mjs`
  as the gate template and design a blend that provably preserves the high-flow signal, else expect a
  REJECT. May well be a "not worth it" conclusion.

---

## 📅 Date-gated / watch

| Item | When | Notes |
|------|------|-------|
| **Reassess LF ground-truth bias** | after **2026-08-27** | EMA learning biases the GF estimate toward LF; revisit solutions then. |

---

## Recently completed (reference)

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

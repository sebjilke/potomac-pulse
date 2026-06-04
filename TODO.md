# Potomac Pulse — Remaining Work

Single source of truth for outstanding work. Consolidates the old `TODO.md`, the
session `.claude/HANDOFF.md` (refactor phases), and deferred items from memory.
Pick a tier, prioritize, go.

*Last updated: 2026-06-04*

---

## How to read this

- **Tiers are by kind, not strict priority** — skim all, then prioritize.
- Effort is a rough order-of-magnitude.
- 🔒 = needs a decision from you before work starts · 📅 = date-gated · 🔍 = verify-only (check state, may already be fine).
- Anything touching the estimate must keep the 8 `baseline stable:` characterization tests green (or deliberately re-baseline + version-bump).

---

## Tier 0: Model accuracy — *changes the estimate*

Replace the unverified travel-time assumptions (`baseHrs`, `TRAVEL_POR_GF_BASELINE`=19.4h, `TRAVEL_GF_LF_BASELINE`=6.5h) with values measured from raw gauge data. Only path that can improve the estimate's PoR time-shift; also retires the dead System 1 gauge-learning system.

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 0a | **Measure real travel times** | ~days | Cross-correlate raw USGS flow series (each upstream gauge ↔ Little Falls; PoR↔LF for the estimate) across many rise events → measured lag-to-peak, flow-dependent. |
| 0b | **Delete dead System 1 machinery** | ~1h | Orphaned `toggleLearning` (no `learnBtn` in DOM), `recordObservation`/`calculateCorrections`/cloud-write path, `learningEnabled` (permanently false since the 2026-02-28 Vite modularization). Keep the gauge travel-time *display*, driven by recalibrated `baseHrs`. Snapshot net proves the estimate is invariant. |
| 0c | **Set constants from analysis + version-bump** | ~2h | Re-baseline `test/characterization/snapshots/baseline.json`, MAJOR bump, sync `index.html` ↔ `scheduled-update.js`. |

**Evidence:** 15 frozen System 1 factors skew low (12/15 < 1.0, mean ≈ 0.935; PoR = 0.90) → `baseHrs` likely ~7% too slow. But self-referential/noisy — measure properly, don't fold them in. System 2's EMA shows the *dominant* error is high-flow **level** over-prediction (25–50k rising +3273, steady +2336 cfs), not travel-time phase — so the travel signal is real but secondary.
**Process (CLAUDE.md):** plan-first in `/analysis/` → independent auditor → blind dual-language (Python + R agree <0.01) → third-agent audit (≥5 obs vs live USGS) → outputs to `/analysis/`.

---

## Tier 1: Security

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 1 | **Enable RLS** on `potomac_observations` | ~10 min | SQL in `SUPABASE-SETUP.md`. Critical — without it anyone with the URL can write. |
| 2 | **Composite index** `(observation_type, gauge_id, created_at DESC)` | ~5 min | Every 2h cron does seq scans without it. |
| 3 | **Move Supabase `service_role` key out of `settings.local.json`** → env var | ~15 min | Currently plaintext in the local settings file. |
| 4 | **DB constraints** (`NOT NULL` on type/gauge, `CHECK created_at > 2020`) | ~15 min | Optional — app-level validation already exists. |

## Tier 2: Observability & infra (mostly external config)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 5 | **Set `VITE_SENTRY_DSN`** in Netlify env vars | ~15 min | Code + sourcemaps already done; just needs the DSN. |
| 6 | **Uptime HTTP checks** in healthchecks.io | ~10 min | Site + USGS API availability alerts. |
| 7 | 🔍 **Verify shadow leaderboard reset** | ~5 min | `SELECT data->>'shadowServerMigration' FROM potomac_observations WHERE observation_type='gf_metadata' AND gauge_id='system'` → should be non-null. |
| 8 | **Scope MCP servers per-project** | ~15 min | Gmail/Calendar/Drive/Scholar waste ~17k context tokens; not needed here. |
| 9 | **Review/rotate Supabase service key age** | ~5 min | Rotate if >6 months old. |

## Tier 3: Refactor / tech debt (snapshot-protected; full detail in `.claude/HANDOFF.md`)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 10 | **Phase 2 — internal decomposition** | ~1 day | Extract `shared/observations.js` data-access helper; decompose `validatePendingPredictions` (~517 lines) into named sub-functions; pull model invocation out of `updateGreatFallsUI`. Behavior-neutral. |
| 11 | 🔒 **Phase 3 — unify the 3 runtimes** | ~2–3 days | One shared `gf-pipeline` for client + server; unify 3 flow-state impls; golden sync-guard test. **Needs a decision first:** which side is canonical (provisional: server math canonical, client keeps display-time correction). Changes observable output on the non-canonical side. |
| 12 | **Phase 4 — render path (optional)** | ~1 day | Store pub/sub + targeted re-render (kills setter-injection scaffolding); remove the 4s NWS render gate. Highest UX-feel risk. |
| 13 | **Parallelize Supabase queries** | ~2h | `Promise.all()` for independent SELECTs in `sync-learning.js`. |
| 14 | **JSDoc comments** | ~8h | Low priority — code is already well-structured. |

## Tier 4: Features / UX (nice-to-have)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 15 | 🔒 **Multi-pending validation pipeline (Option B)** | ~1 day | Allow multiple simultaneous pending predictions for better storm-event coverage. Design decision pending. |
| 16 | **Backup export function** | ~2h | Export correction bins / learning data as JSON. |
| 17 | **Admin monitoring dashboard** | ~4h | Health metrics, validation history. |
| 18 | **Audit logging** | ~2h | Track admin actions (bin resets, manual overrides). |
| 19 | **Log validation failures** | ~2h | Store failed validations for post-hoc analysis. |
| 20 | **Service worker for offline** | ~4h | Cache last-known state for offline viewing. |
| 21 | **Mobile sidebar scrolling** | ~1h | Sticky tabs, remove double-scroll on mobile. |

## 📅 Date-gated / watch

| Item | When | Notes |
|------|------|-------|
| **Reassess LF ground-truth bias** | after **2026-08-27** | EMA learning biases the GF estimate toward LF; revisit solutions then. |

---

## Completed (reference)

All items below are done and verified. Kept for audit trail only.

- **v35.x (this session, 2026-06-03/04)**: Phase 0 characterization safety net; Phase 1 dead-code removal + constant centralization + endpoint security gating (deployed). Folder reorg flattened to git root.
- **v34.9**: Gauge search/filter, persist branch collapse, map loading spinner
- **v34.10**: Fix flat forecast line (NWS endpoint reorder + late-arrival re-render)
- **v34.0–v34.8**: EMA learning fix, two-tier anomaly flagging, Sentry scaffold, bin recovery
- **v33.0–v33.1**: 24h stored GF history, observed flow state
- **v32.0**: Observed flow state fix
- **v31.0–v31.3**: Tributaries (Broad Run, Seneca Creek), Creeks tab, forecast graph history
- **v30.0**: Flow-dependent weights (logistic ramp, 7-approach horse race)
- **v29.0–v29.1**: 117k hourly validation, empirical 90% CI
- **v28.0**: Soft LF ceiling + decay cap
- **v27.0**: Gradient EF weights
- **v25.0–v26.0**: PoR-delta correction, model recalibration
- **v24.0–v24.16**: Security (XSS, USGS validation, timeouts, PIN env), UX (mobile, errors, map), accessibility (ARIA, keyboard, contrast), Vite modularization, automated tests, GitHub Actions CI, shared utilities, Sentry, rate limiting, CSP/SRI

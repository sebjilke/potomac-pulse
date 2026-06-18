# Potomac Pulse — Remaining Work

**The single source of truth for outstanding work.** Open items live here; nowhere else.
Session state is in `.claude/HANDOFF.md`; methodology provenance for shipped versions is the
small set of cited docs in `analysis/` (see CLAUDE.md / README). Pick a tier, prioritize, go.

*Last updated: 2026-06-18 (current version: v37.0). Verified against live DB + git history, not memory.*

---

## How to read this

- **Tiers are by kind, not strict priority** — skim all, then prioritize.
- Effort is a rough order-of-magnitude.
- 🔒 = needs a decision from you before work starts · 📅 = date-gated · 🔍 = verify-only.
- Anything touching the estimate must keep the characterization/golden tests green and the
  client↔server parity tests green (`npm test` = **599**), or deliberately re-baseline + version-bump.
- **Pushing auto-deploys from `main`** through the Netlify gate (`npm install && npm test && npm run build`);
  a red suite blocks deploy. Pushing needs explicit approval each time.

---

## Tier 0 — Model accuracy (*changes the estimate*)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 0a | **Finish dead System-1 write-path removal** | ~1h | Phase-1 (`26bc64f`) removed most; residual orphans remain in `src/ui/learning-ui.js`, `src/learning/gauge-learning.js`, `src/state/store.js`, `src/data/fetch.js` (permanently-false `learningEnabled` path). Keep the gauge travel-time *display*. Snapshot/golden tests must prove the estimate is invariant. |
| 0b | **Low-flow flow-state classification floor** | ~days | The `max(100, q×2%)` floor binds at 3–5k cfs, so slow recessions still classify ~77–80% steady (per `analysis/flow_state_window_diagnostic.md`). A flow-dependent window or scaled floor is the deferred second-pass fix. Empirical-analysis protocol applies (plan → auditor → blind Python+R → audit). |

**Closed (no longer open):** the travel-time *relation* refit was investigated and **closed as low-leverage — no model change** (v36.2; Layer-0/A diagnostics). See `analysis/travel-time-refit-plan-2026-06-17.md`. The dominant residual error is high-flow *level* over-prediction, already absorbed by the EMA correction.

---

## Tier 1 — Security

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 1 | **Move Supabase `service_role` key out of `settings.local.json`** → env var | ~15 min | Still plaintext in the local settings file. |
| 2 | **Field-level write-path bounds (C13b)** | ~1h | C13a (`59d7546`) validates nested payload *shape*. Still want value bounds: `predictedCFS ∈ [0, 500000]`, `validationDue` parseable and in `(now, now+48h]`, cap forecast length. Load-bearing → plan→audit. |
| 3 | **DB constraints** (`NOT NULL` on type/gauge, `CHECK created_at > 2020`) | ~15 min | Optional — app-level validation already exists. |
| 4 | 🔍 **Review/rotate Supabase service key age** | ~5 min | Rotate if >6 months old. |

**Closed:** RLS enabled (verified live, `relrowsecurity=true`) · composite index `idx_obs_type_gauge_created` exists · validation-pipeline deadlock + non-idempotency fixed (C12, `f181baa`).

---

## Tier 2 — Observability & infra

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 5 | **Fix the silent USGS-null cron early return** | ~2 lines | `netlify/functions/scheduled-update.js:~1634` returns on null USGS data writing nothing — pings neither healthchecks success nor `/fail`, doesn't bump `missedRuns`, so a stall is invisible (it masked a ~2h outage on 2026-06-18). Fire the `/fail` ping there. Load-bearing → plan→audit→push. |
| 6 | **Set `VITE_SENTRY_DSN`** in Netlify env vars | ~15 min | Code + sourcemaps done; just needs the DSN. |
| 7 | **Uptime HTTP checks** in healthchecks.io | ~10 min | Site + USGS API availability alerts. |
| 8 | **Scope MCP servers per-project** | ~15 min | Gmail/Calendar/Drive/Scholar waste ~17k context tokens; not needed here. |

**Closed:** shadow-leaderboard reset verified (`shadowServerMigration` non-null) · honest sync-failure reporting + stop fabricating gauge stage (C46/C49, `ad6f486`) · Netlify deploys gated on `npm test` (C20, `4a85a4c`).

---

## Tier 3 — Refactor / tech debt (snapshot-protected)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 9  | **Phase 2 — internal decomposition** | ~1 day | Extract `shared/observations.js` data-access helper; decompose `validatePendingPredictions` (~517 lines); pull model invocation out of `updateGreatFallsUI`. Behavior-neutral. |
| 10 | 🔒 **Phase 3 — unify the 3 runtimes** | ~2–3 days | One shared `gf-pipeline` for client + server; unify 3 flow-state impls; golden sync-guard test. **Needs a decision first:** which side is canonical (provisional: server math canonical). Changes observable output on the non-canonical side. (v36.0 already unified correction *application* via the shared `applyGFCorrection` helper — this is the remaining pipeline unification.) |
| 11 | **Phase 4 — render path (optional)** | ~1 day | Store pub/sub + targeted re-render; remove the 4s NWS render gate. Highest UX-feel risk. |
| 12 | **Parallelize Supabase queries** | ~2h | `Promise.all()` for independent SELECTs in `sync-learning.js`. |
| 13 | **JSDoc comments** | ~8h | Low priority — code is already well-structured. |

---

## Tier 4 — Features / UX (nice-to-have)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 14 | 🔒 **Multi-pending validation pipeline (Option B)** | ~1 day | Allow multiple simultaneous pending predictions for better storm-event coverage. Design decision pending. |
| 15 | **Backup export function** | ~2h | Export correction bins / learning data as JSON. |
| 16 | **Admin monitoring dashboard** | ~4h | Health metrics, validation history. |
| 17 | **Audit logging** | ~2h | Track admin actions (bin resets, manual overrides). |
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

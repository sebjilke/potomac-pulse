# Potomac Pulse — Remaining Work

*Consolidated from TODO.md, CHANGES-AND-REMAINING-WORK.md, and MEMORY.md (2026-03-06, v34.8)*

---

## Tier 0: Travel-Time Recalibration (empirical analysis + model change)

**Goal:** Replace the unverified `baseHrs` / `TRAVEL_POR_GF_BASELINE` (19.4h) / `TRAVEL_GF_LF_BASELINE` (6.5h) travel-time assumptions with values measured from raw gauge data. This is the only path that can improve the *estimate's* PoR time-shift (not just a display), and it supersedes the dead System 1 gauge-learning system.

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 0a | **Measure real travel times** | ~days | Cross-correlate raw USGS flow series (each upstream gauge ↔ Little Falls; PoR↔LF specifically for the estimate) across many rise events → measured lag-to-peak, flow-dependent. Derive defensible travel times. |
| 0b | **Delete dead System 1 machinery** | ~1h | `toggleLearning` (orphaned, no `learnBtn` in DOM), `recordObservation`/`calculateCorrections`/cloud-write path, `learningEnabled` (permanently false since the 2026-02-28 Vite modularization dropped the toggle wiring). Keep the gauge travel-time *display*, now driven by recalibrated `baseHrs`. Snapshot net proves the estimate is invariant to this. |
| 0c | **Set constants from the analysis, version-bump** | ~2h | Changing `TRAVEL_POR_GF_BASELINE` changes estimate output → deliberately re-baseline `test/characterization/snapshots/baseline.json`, MAJOR version bump, sync `index.html` ↔ `scheduled-update.js`. |

**Why (evidence):** The 15 frozen System 1 factors skew systematically low (12/15 < 1.0, mean ≈ 0.935; PoR = 0.90) → `baseHrs` likely overestimates travel ~7%. But those factors are self-referential/noisy — not trustworthy enough to bake in directly. System 2's EMA bins show the *dominant* error is high-flow level over-prediction (25–50k rising +3273, steady +2336 cfs), **not** a clean travel-time phase bias — so the travel signal is real but secondary. Hence: measure it properly, don't fold the broken-system numbers.

**Process (per CLAUDE.md):** Plan-first doc in `/analysis/` → independent auditor reviews plan → blind dual-language (Python + R must agree <0.01) → third-agent audit spot-checking ≥5 obs against live USGS → all outputs to `/analysis/` (`*_python.csv`, `*_R.csv`, `*_audit.md`).

## Tier 1: Security (Supabase Dashboard — no code)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 1 | **Enable RLS** on `potomac_observations` | ~10 min | SQL in `SUPABASE-SETUP.md`. Critical — without it anyone with URL can write. |
| 2 | **Composite index** `(observation_type, gauge_id, created_at DESC)` | ~5 min | Every 2h cron does seq scans without it. |
| 3 | **Database constraints** (`NOT NULL` on type/gauge, `CHECK created_at > 2020`) | ~15 min | Optional — app-level validation already exists. |

## Tier 2: Observability (External config — no code)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 4 | **Set `VITE_SENTRY_DSN`** in Netlify env vars | ~15 min | Create Sentry project (free), paste DSN, redeploy. Code already done. |
| 5 | **Uptime HTTP checks** in healthchecks.io | ~10 min | Site + USGS API availability alerts. |
| 6 | **Review Supabase service key age** | ~5 min | Rotate if >6 months old. |

## Tier 3: Nice-to-Have (code changes)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 7 | **Parallelize Supabase queries** | ~2h | `Promise.all()` for independent SELECTs in sync-learning.js. |
| 8 | **Service worker for offline** | ~4h | Cache last-known state for offline viewing. |
| 9 | ~~Gauge search/filter~~ | — | ✅ Done (v34.9) |
| 10 | ~~Persist branch collapse state~~ | — | ✅ Done (v34.9) |
| 11 | ~~Map loading states~~ | — | ✅ Done (v34.9) |
| 12 | **Mobile sidebar scrolling** | ~1h | Sticky tabs, remove double-scroll on mobile. |
| 13 | **Backup export function** | ~2h | Export correction bins / learning data as JSON. |
| 14 | **Admin monitoring dashboard** | ~4h | Enhance with health metrics, validation history. |
| 15 | **Audit logging** | ~2h | Track admin actions (bin resets, manual overrides). |
| 16 | **Log validation failures** | ~2h | Store failed validations for post-hoc analysis. |
| 17 | **JSDoc comments** | ~8h | Low priority — code is already well-structured. |

---

## Completed (reference)

All items below are done and verified. Kept for audit trail only.

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

*Last updated: 2026-06-04 — added Tier 0 (travel-time recalibration + System 1 retirement)*

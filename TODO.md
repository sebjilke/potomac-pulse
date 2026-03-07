# Potomac Pulse — Remaining Work

*Consolidated from TODO.md, CHANGES-AND-REMAINING-WORK.md, and MEMORY.md (2026-03-06, v34.8)*

---

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
| 7 | **Batch upsert operations** | ~2h | Reduce Supabase round-trips in scheduled-update.js. |
| 8 | **Service worker for offline** | ~4h | Cache last-known state for offline viewing. |
| 9 | **Gauge search/filter** | ~2h | Filter All Gauges tab by name/branch. |
| 10 | **Persist branch collapse state** | ~1h | Remember collapsed gauge branches in localStorage. |
| 11 | **Map loading states** | ~1h | Show spinner while Leaflet tiles load. |
| 12 | **Mobile sidebar scrolling** | ~1h | Improve scroll behavior on small screens. |
| 13 | **Backup export function** | ~2h | Export correction bins / learning data as JSON. |
| 14 | **Admin monitoring dashboard** | ~4h | Enhance with health metrics, error rates. |
| 15 | **Audit logging** | ~2h | Track admin actions (bin resets, manual overrides). |
| 16 | **Log validation failures** | ~2h | Store failed validations for post-hoc analysis. |
| 17 | **JSDoc comments** | ~8h | Low priority — code is already well-structured. |

---

## Completed (reference)

All items below are done and verified. Kept for audit trail only.

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

*Last updated: 2026-03-06 (v34.8)*

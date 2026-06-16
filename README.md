# Potomac Pulse

Real-time Potomac River flow tracking and Great Falls water level predictions for paddlers.

**Live Site**: Deployed on Netlify (auto-deploys from `main` branch)
**Current Version**: v36.0 (June 2026)

## Quick Start

```bash
npm install          # Install Supabase dependency
# Deploy: git push origin main (auto-deploys via Netlify)
```

## Architecture

```
Frontend (PWA)                    Netlify Functions (Backend)
┌──────────────────┐              ┌──────────────────────────┐
│ index.html (SPA) │─── API ────→│ sync-learning.js         │
│  All HTML/CSS/JS │              │ scheduled-update.js (1h) │
│  Leaflet.js maps │              └──────────┬───────────────┘
└──────────────────┘                         │
                                   ┌─────────┼──────────┐
                                   ▼         ▼          ▼
                               Supabase   USGS API   NWS/NOAA
```

**Key principle**: Single-page app built with Vite. Modular `src/` structure, auto-deployed on push.

## File Structure

```
├── index.html                    # HTML shell (tabs, layout, footer)
├── src/                          # Vite source modules
│   ├── main.js                   # Entry point
│   ├── model/constants.js        # All client-side constants
│   ├── data/                     # USGS/NWS data fetching, history
│   ├── ui/                       # Tabs, gauges, map, forecast, creeks
│   ├── estimation/               # GF, LF, EF, NWS algorithms
│   ├── learning/                 # GF/gauge learning, cloud sync
│   ├── monitoring/sentry.js      # Error tracking
│   ├── state/store.js            # Global app state
│   ├── styles/                   # CSS (theme.css, main.css)
│   └── assets/tech-appendix.md   # Downloadable tech appendix
├── test/                         # Unit & integration tests
├── netlify.toml                  # Build config, function routing
├── package.json                  # Dependencies, build scripts
├── vite.config.js                # Vite bundler config
└── netlify/functions/
    ├── shared/model.js           # Shared server module (Supabase init, flow bins, rating curve)
    ├── sync-learning.js          # Cloud sync API (learning data, predictions, PoR/GF history)
    ├── scheduled-update.js       # Hourly background job (data collection, validation, predictions, shadow models)
    └── [analysis tools]          # EF correlation, stage errors, travel time validation
├── analysis/                         # Model calibration scripts, audit reports (CSVs gitignored — reproducible from scripts)
```

## Current Model (v36.0)

All estimation parameters validated on **117,704 hourly observations** (2011–2026) via simultaneous blind Python + R subagents with independent audits.

### Core Estimation

| Component | Formula / Value | Notes |
|-----------|----------------|-------|
| **EF Power-Law (default)** | `LF = 126 × EF^2.46` | R² = 0.91, validated on 117k hourly obs |
| **EF Power-Law (cold ≤10°C)** | `LF = 160 × EF^2.36` | R² = 0.98, 12,959 hourly cold-water obs |
| **EF Weight (Logistic Ramp)** | `0.40 / (1 + exp(-5.0 × (ln(Q) - ln(10000))))` | Near 0% at low flows, ~40% at high. Winner of 7-approach horse race (−4.6% RMSE). |
| **Soft LF Ceiling** | 120% of LF actual | Near-zero rising bias (-29 cfs) vs -476 cfs with 110% |
| **Decay Cap** | 0.50 | PoR-delta correction. At hourly resolution, effectively irrelevant. |
| **Travel Time** | `T = 4139 × Q^(-0.5963)` | Searcy (1961) × 0.80 empirical correction |

### Estimation Pipeline

```
1. Look up PoR reading from ~19-33 hours ago (iterative convergence)
2. Add tributary flows (Monocacy 7.1%, Goose Creek 3.0%, Broad Run 0.66%, Seneca Creek 0.87%)
3. Blend with EF power-law estimate (logistic ramp: 0-40% weight by flow)
4. Apply PoR-delta correction for rising/falling rivers
5. Cap at 120% of LF actual (soft ceiling)
6. Apply learned EMA correction factors (18 flow bins × 3 flow states; hierarchical fallback for sparse bins)
7. Validate ~6 hours later when water reaches Little Falls (server-only, v34.0)
```

### Gauge Network

| Gauge | USGS ID | Role | Distance | % of Basin |
|-------|---------|------|----------|:----------:|
| Point of Rocks | 01638500 | Primary predictor | 20 mi upstream | 83.5% |
| Edwards Ferry | 01644148 | Ensemble cross-check (stage only) | 2 mi upstream | 96.3% |
| Little Falls | 01646500 | Validation target | — | 100% |
| Monocacy | 01643000 | Tributary addition | 14 hrs | 7.1% |
| Goose Creek | 01644000 | Tributary addition | 10 hrs | 3.0% |
| Broad Run | 01644280 | Tributary addition | — | 0.66% |
| Seneca Creek | 01645000 | Tributary addition | — | 0.87% |

### EMA Learning System (v34.0)

The model learns per-bin bias corrections via EMA (α=0.3) across 18 bins (6 flow ranges × 3 flow states). Key design:

- **Validation**: Server-only, every hour. Validates predicted GF against actual LF discharge.
- **Anomaly detection**: Two-tier — hard flags (data corruption) skip learning; soft flags (model disagreement) included with ±2σ clamping.
- **Timing guard**: Rejects validations >2.5h late (flow conditions have changed).
- **No Seneca subtraction**: Validates against raw LF; correction naturally absorbs tributary + ungauged area signal.

## Key Algorithms

### Travel Time (Searcy Model)
```javascript
travelHours = 4139 * Math.pow(flowCFS, -0.5963);
// ~44 hrs at 1,200 cfs → ~7 hrs at 50,000 cfs
```

### Edwards Ferry Power-Law
```javascript
// Default (water temp > 10°C or unknown)
estimatedCFS = 126 * Math.pow(efStage, 2.46);
// Cold water (≤ 10°C)
estimatedCFS = 160 * Math.pow(efStage, 2.36);
```

### Flow State Classification
```javascript
// Observed PoR rate (6-hour lookback), falls back to NWS forecast on cold start
const threshold = Math.max(100, flow * 0.02);
if (change >= threshold && rising) return 'rising';
if (change >= threshold && falling) return 'falling';
return 'steady';
```

## API Endpoints

### `/api/sync` (sync-learning.js)

| Method | Query | Purpose |
|--------|-------|---------|
| GET | — | Returns all stored learning data |
| POST | — | Saves learning data to Supabase |
| GET | `?endpoint=gf` | Loads GF learning data (bins, predictions, metadata) |
| POST | `?endpoint=gf` | Store predictions, record validations |
| GET | `?endpoint=forecast-accuracy` | Forecast accuracy stats per horizon |
| GET | `?endpoint=gf-history` | 24h GF estimation history (server-stored) |
| GET | `?endpoint=por-history` | 48h PoR reading history (cross-device sync) |

### Scheduled Function (scheduled-update.js)

Runs every hour: fetch USGS data → validate pending predictions (2.5h window) → make new prediction → run server-side shadow models → update health metrics → store PoR/GF history. Learning suspended during ice conditions.

## Deployment

```bash
# Auto-deploys from main branch
git push origin main  # Netlify deploys in ~1 minute
```

**Environment Variables** (Netlify): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_PIN`, `CORS_ORIGIN` (optional, defaults to production domain)

## Development

- **Vite build** — `npm run dev` for local dev server, `npm run build` outputs to `dist/`
- **Tests** — `npm test` runs model + integration tests
- **Keep in sync** — `src/model/constants.js` and `netlify/functions/shared/model.js` share model constants
- **Always update README** — update this file at the end of every commit to reflect changes

## Documentation

| Audience | Where |
|----------|-------|
| End users | "How It Works" tab in app |
| Scientists | Download Technical Appendix (in-app button) |
| Developers | This README + `CLAUDE.md` |
| Model details | `analysis/` directory (scripts, CSVs, audit reports) |

## Version History (Recent)

| Version | Date | Change |
|---------|------|--------|
| v36.0 | 2026-06-16 | **Closed the learning loop (C1) — MAJOR.** The server now end-applies the learned EMA correction to its own prediction, so the model that is stored, validated, learned-on, and reported is the same corrected model the user sees. The correction is applied at unit gain (`corrected = raw − correction`, after the EF ensemble and the 120%-LF display ceiling) on both client and server via one shared helper (`applyGFCorrection`) — eliminating the old pre-ensemble dilution (only ~60% of the correction reached the output at high flow) and unifying the two estimators (characterization fixtures now match the server **exactly**; previously a ~13% gap and two flow-bin mismatches). Learning stays honest and feedback-free: the EMA learns on the **raw** residual (correction-independent), while the **headline** accuracy now scores the **corrected** residual, prequentially. The cron is now the **sole** prediction writer (client `sendGFPrediction`/retry-queue removed, finishing C12). The 120%-LF ceiling is a display-only guard on the corrected output and no longer censors the EMA target. Soft-flag clamp re-centered on `emaMeanError`; shadow leaderboard scored on the raw error. Correction bins carry over unchanged (they already encoded the raw residual). 181 → 374 unit tests. The empirical CI band's asymmetry/sign fix and re-derivation (C2) are deferred to v36.1. |
| v35.6 | 2026-06-16 | Reliability & data-integrity hardening from a re-verified science review — no change to the GF estimate. (C20) Netlify deploys are gated on `npm test`. (C24) The three NWS/persistence forecast baselines previously dropped at insert are now stored, so forecast-vs-NWS skill scoring can accrue. (C12) Fixed a validation-pipeline deadlock (a malformed `validationDue` could permanently occupy the single pending slot, in both the cron and API write paths) and made EMA learning idempotent (claim-before-learn prevents a mid-cycle crash from double-counting). (C13a) The public `/api/sync` write path validates nested prediction/forecast payloads — bounds CFS/dates, requires an in-vocabulary flow bin/state, and couples `flowBin` to `predictedCFS` so a caller can't free-target a learning bin (full auth hardening tracked separately). (C46) The legacy observation sync no longer reports "synced" when its insert failed. (C49) Stopped fabricating a gauge's stage from Point-of-Rocks stage (display-only). 137→181 tests; each fix independently audited. |
| v35.5 | 2026-06-01 | Client-side flow-state & graph robustness fix. Nowcast could show a false RISING trend and a graph spike from a stale/out-of-order/glitch entry in browser `localStorage` PoR/GF history (server data unaffected). Hardened interpretation without discarding readings: `getPoRRiseRate()` uses median-of-record for current + 6h-ago readings (≥3 pts in window, 3–9h baseline, else NWS fallback); `getPoRFromHoursAgo()` uses outlier-resistant selection returning a real entry; record functions stay timestamp-sorted, replace (not drop) the freshest reading, reject only >500k cfs; server history self-heals local drift on merge; graph has a display-only spike filter. Pure helpers in `rise-rate-robust.mjs`, 16 new tests. Server estimation untouched. No model-output change for clean inputs. |
| v35.4 | 2026-05-27 | Server-side shadow models. Move all three shadow model horse race estimators (LF Feedback, Online Regression, Kalman Filter) from client browser to server cron function. Eliminates selection bias (shadow scores were only attached when browser was open, oversampling storms). State persisted in Supabase. Leaderboard reset on first server-side validation round via `gf_metadata.shadowServerMigration`. Client Learning tab display unchanged. `estimateLFStage` moved to `shared/model.js`. |
| v35.3 | 2026-05-23 | How It Works tab and Technical Appendix overhaul. Restructured tab from 10+ flat sections to 2 clear sections (Nowcast + Forecast) with flow diagram. Tech Appendix: added executive summary, removed superseded optimization sections (v27.0/v29.0), added §8.6 Forecast Validation, extracted version history to CHANGELOG.md. |
| v35.1 | 2026-05-23 | Hierarchical correction fallback for sparse bins. When a flow-bin × flow-state has <5 observations, `getGFCorrection()` falls back: (1) pooled states in same bin, (2) adjacent bin same state, (3) return 0. Linear blending (`weight=count/5`) for smooth transition. Read-side only. Pure helpers extracted to `shared/model.js` + `shared-model.js`. 13 new tests (102 total). |
| v35.0 | 2026-05-06 | Flow-state classification: widened the PoR lookback window from 2h to 6h in `getFlowState()` and `getPoRRiseRate()`. Diagnostic on 117k hourly obs (2011–2026) showed the prior 2h+max(100, 2%) rule classified ~99% of baseflow as steady (3 rising / 87 steady / 3 falling in production). 6h lookback at the same threshold gives a hydrologically realistic distribution across all flow regimes (~19/45/36 dataset-wide; storm months 25–55% non-steady; drought months 80% steady). All `gf_correction_bin` rows reset, plus `gf_prediction:pending`, shadow leaderboard, and contaminated learning fields in `gf_metadata` (operational health stats preserved). Bins repopulate over 1–2 weeks; high-flow rising bins may take longer in dry periods. **Side effect on wave celerity:** `getPoRRiseRate.ratePerHour` is now smoothed over 6h instead of 2h, reducing wave-celerity travel-time reductions on flashy sub-6h rises; deliberate accepted change. Threshold (`max(100, q×2%)`) and per-bin EMA logic unchanged. See `analysis/flow_state_window_diagnostic.md`. |
| v34.24 | 2026-03-22 | Fix health counter: move run tracking from storePrediction to updateRunHealth so every 2h run updates the display, not just prediction-store runs |
| v34.23 | 2026-03-22 | Map Tier 3: watershed boundary overlay, flood-condition marker rings (NWS categories), zoom-dependent gauge labels |
| v34.22 | 2026-03-22 | Map overhaul: Stamen Terrain basemap, NHDPlus GeoJSON rivers (296KB static asset), drain-area marker scaling, compact legend |
| v34.21 | 2026-03-22 | Switch gauge table trend from 48h to 24h; label column "24h Trend" |
| v34.20 | 2026-03-19 | Fix prediction overwrite loop: skip storing new prediction if existing pending is still within validation window |
| v34.19 | 2026-03-17 | Fix learning system deadlock: unique constraint on prediction lifecycle prevented state transitions. DELETE predictions after validation/expiry instead of UPDATE. 270h outage resolved. |
| v34.18 | 2026-03-17 | Fix efMissing blocking all predictions when EF stage unavailable |
| v34.17 | 2026-03-17 | Remove current CFS label from creek chart y-axis |
| v34.16 | 2026-03-16 | Add horizontal gridlines to creek history charts |
| v34.15 | 2026-03-16 | Expandable creek cards with 24h CFS history graph (click to expand) |
| v34.14 | 2026-03-16 | Remove estimated threshold warning from Difficult Run (200 cfs threshold confirmed correct) |
| v34.13 | 2026-03-16 | Replace discontinued Rock Creek gauge 01648000 (Georgetown) with 01648010 (Joyce Rd) |
| v34.12 | 2026-03-16 | Fix learning system: correct GF_EMA_ALPHA import typo in scheduled-update.js. ReferenceError was crashing every cron run after the first observation per bin, stalling learning for 247h+ |
| v34.11 | 2026-03-09 | Correction system bug fixes: EF cross-check cold-water model, R² double-count, EF sums re-anchor at 200pts, EMA alpha centralized, server wave celerity, stage bin EMA clamp, totalObs sum, calculateCorrections throttle, cold-start flow state |
| v34.10 | 2026-03-07 | Fix flat forecast: reorder NWS endpoints (forecast-first), re-render UI on late NWS arrival |
| v34.9 | 2026-03-06 | UI: gauge search/filter, persist branch collapse, map loading spinner. Consolidated TODO. |
| v34.8 | 2026-03-06 | Sentry DSN from env var (`VITE_SENTRY_DSN`), font-size px→rem already complete |
| v34.7 | 2026-03-06 | Fix silent Supabase write failures: error handling on all 5 remaining upserts/deletes, fix forecast double-count bug |
| v34.6 | 2026-03-06 | Add error handling to correction bin writes, bin-write health counters, recovery script |
| v34.5 | 2026-02-26 | All Gauges UIX: sticky headers, row separators, trend column fix, responsive mobile |
| v34.4 | 2026-02-26 | Security hardening: remove hardcoded PIN, lock CORS to production domain |
| v34.3 | 2026-02-26 | Extract shared server module (shared/model.js) — deduplicate Supabase init, flow bins, rating curve |
| v34.2 | 2026-02-26 | Client-side cleanup: collapsible estimation inputs, null-check guards, Tech Appendix version fix, temperature docs |
| v34.1 | 2026-02-26 | Fix 90% CI display (center on corrected estimate) and Learning tab bin data race condition |
| v34.0 | 2026-02-26 | EMA learning fix: drop Seneca noise, 2.5h validation window, server-only updates, eliminate race conditions |
| v33.1 | 2026-02-23 | 24h stored GF history replaces PoR-only re-estimation on forecast graph |
| v33.0 | 2026-02-23 | Two-tier anomaly flagging (hard/soft flags with different learning treatment) |
| v32.0 | 2026-02-23 | Observed flow state from PoR rate instead of NWS forecast |
| v31.3 | 2026-02-22 | Server-side GF history storage + cross-device sync |
| v31.1 | 2026-02-21 | Creeks tab: rain-dependent whitewater runs near DC |
| v31.0 | 2026-02-21 | Tributaries: Broad Run + Seneca Creek added to estimation |
| v30.0 | 2026-02-20 | Flow-dependent EF weights (logistic ramp). −4.6% OOS RMSE. |
| v29.1 | 2026-02-19 | Empirical 90% CI per flow bin (non-normal error distributions) |
| v29.0 | 2026-02-19 | Flat 35% EF weight (hourly optimization). All params validated on 117k hourly obs. |
| v28.0 | 2026-02-19 | Soft LF ceiling (120%) + decay cap (0.50). Grid search on daily + hourly. |

See [CHANGELOG.md](src/assets/CHANGELOG.md) for complete version history (v16–v35.3).

---

*Last updated: 2026-06-16 (v36.0 — closed the learning loop: displayed model == validated model)*

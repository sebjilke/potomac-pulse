# Potomac Pulse

Real-time Potomac River flow tracking and Great Falls water level predictions for paddlers.

**Live Site**: Deployed on Netlify (auto-deploys from `main` branch)
**Current Version**: v37.2 (June 2026)

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
│   ├── learning/                 # GF learning (System 2 — server-side EMA correction)
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
    ├── sync-learning.js          # Server API (GF learning/predictions, forecast accuracy, PoR/GF history)
    ├── scheduled-update.js       # Hourly background job (data collection, validation, predictions, shadow models)
    └── [analysis tools]          # EF correlation, stage errors, travel time validation
├── analysis/                         # Model calibration scripts, audit reports (CSVs gitignored — reproducible from scripts)
```

## Current Model (v37.2)

Core estimation parameters (travel time, EF power-law, EF weight) validated on **117,704 hourly observations** (2011–2026) via simultaneous blind Python + R subagents with independent audits. The v36.1 confidence band was re-derived separately on **126,916 hourly observations** (the same period, with the four tributaries + LF stage added) — see the v36.1 changelog entry.

### Core Estimation

| Component | Formula / Value | Notes |
|-----------|----------------|-------|
| **EF Power-Law (default)** | `LF = 126 × EF^2.46` | R² = 0.91, validated on 117k hourly obs |
| **EF Power-Law (cold ≤10°C)** | `LF = 160 × EF^2.36` | R² = 0.98, 12,959 hourly cold-water obs |
| **EF Weight (Logistic Ramp)** | `0.40 / (1 + exp(-5.0 × (ln(Q) - ln(10000))))` | Near 0% at low flows, ~40% at high. Winner of 7-approach horse race (−4.6% RMSE). |
| **Soft LF Ceiling** | 120% of LF actual | Near-zero rising bias (-61 cfs) vs -509 cfs with 110% |
| **Decay Cap** | 0.50 | PoR-delta correction. At hourly resolution, effectively irrelevant. |
| **Travel Time** | `T = 4139 × Q^(-0.5963)` | Searcy (1961) × 0.80; hydrograph (wave-celerity) lag. PoR→GF ~5h (high water) to ~50h (1,000-cfs floor), ~19h median |

### Estimation Pipeline

```
1. Look up PoR reading from ~5-50 hours ago, flow-dependent (~19h median; iterative convergence)
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
| Point of Rocks | 01638500 | Primary predictor | ~34 mi upstream | 83.5% |
| Edwards Ferry | 01644148 | Ensemble cross-check (stage only) | ~16 mi upstream | 96.3% |
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
// Observed PoR rate (6h lookback); client falls back to NWS trend on cold start, server returns 'steady'
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
| GET | `?endpoint=por-history` | 72h PoR reading history (cross-device sync) |

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
| v37.2 | 2026-06-18 | **Cron observability fix — MINOR (server-only).** The hourly scheduled function's USGS-fetch-failure path did an early `return` inside its `try`, which bypassed the catch block's healthchecks `/fail` ping — so a fetch stall pinged neither success nor failure and was invisible to monitoring (it masked the ~2h cron outage earlier today). Now it `throw`s, routing the failure through the existing `/fail` ping and 500 return. New end-to-end test invokes the handler with `fetch` mocked to fail and asserts the `/fail` ping fires (and the success ping does not). Live alerting still requires `HEALTHCHECKS_PING_URL` set in Netlify env (Tier 2, separate). Plan + verification: `analysis/cron-failping-fix-2026-06-18.md`. 601 → 602 tests. |
| v37.1 | 2026-06-18 | **System-1 gauge travel-time learning retired — MINOR (display-only).** The pre-2026-02 per-gauge travel-time correction ("System 1") had been a dead write path since the Feb-2026 Vite modularization (`learningEnabled` permanently false) but a **live read path**: the `/api/sync` GET returned 15 frozen `correction` rows (mean 0.935, frozen 2026-02-24) that `calcTravelTimes()` still multiplied into the **displayed** per-gauge arrival times. The GF *estimate* never consumed them (it computes its own PoR→GF travel time via `getPoRtoGFTravelTime`), so the characterization snapshots are unchanged → MINOR. Removed: client `gauge-learning.js` + `cloud-sync.js`, the System-1 store state + `toggleLearning`/correction-list/observations UI, the server `/api/sync` default `load/saveLearningData` handlers (named endpoints unaffected), and 43 stale DB rows (`correction`/`observation`/`rise_event`/`metadata`). **Observable effect:** displayed gauge arrival times shift ~+6.5% on average (up to +21%) as the frozen factors stop applying — the display now equals the documented `baseHrs × Searcy-multiplier`. The C46 System-1 honest-failure tests retired with it (C49 stays). Plan + independent audit: `analysis/system1-retirement-plan-2026-06-18.md`. 599 → 601 tests. |
| v37.0 | 2026-06-18 | **C45 flow-edge correction smoothing — MAJOR.** The applied EMA correction is now **continuous in flow** across the low/mid bin boundaries (3k/6k/12k): within ±12% flow it ramps (log-flow) between the adjacent bins' corrections instead of stepping; flows away from a boundary keep their exact binned value. The 25000/50000 boundaries are **left as steps** — at high flow the correction is genuine regime structure. Validated by a prequential 14-yr backtest (110,548 obs, blind Python+R, independent auditor): the rejected full-width (+3.4% MAE, +17.4% at 25-50k) and all-boundary (+5.7% at 25-50k) variants degraded accuracy; the shipped low/mid-only design is accuracy-neutral-to-better (pooled MAE −1.1%, RMSE −0.6%; worst bin +1.1% median; 25-50k/50k+ exactly unchanged). Learning unchanged (no feedback). **Accuracy-series discontinuity** at the v36→v37 boundary (methodology change, not a regression). Plan + gate: `analysis/c45-phase1-flow-interp-plan-2026-06-18.md`. 521 → 599 tests. |
| v36.4 | 2026-06-18 | **Server travel-time parity + PoR-history coverage (C8/C16) — MINOR.** C8: the server now iterates the PoR→GF travel time to PoR-self-consistency and uses the client's outlier-robust historic-reading selection (travel helpers centralized into `shared-model.js`↔`shared/model.js`; `selectHistoricReading` ported), closing a displayed-vs-validated divergence. Normal/high steady flow is **bit-identical** to v36.3 (golden-tested); only the low-flow lookup shifts (sparse low-flow EMA bins re-learn). C16: server PoR-history retention 48h→72h (≥ the ~50.6h max travel) so the low-flow time-shift no longer silently falls back to unshifted current PoR. The PoR rise-rate input stays deliberately divergent (client robust / server raw). Plan + independent audit in `analysis/c8-c16-parity-fix-plan-2026-06-18.md`. 418 → 521 tests. |
| v36.3 | 2026-06-17 | **Documentation-accuracy sweep (C4/C5/C7/C9/C10/C36/C38/C39/C40/C41/C50 + §8.1 nit) — MINOR (docs + health-telemetry only; no GF model-output change).** Regenerated the §5.4 EF-weight table, §5.6 ceiling figures (−509/−61), §7.5 worked examples, and the §8.1 travel-time example from the deployed model; reconciled the Edwards Ferry metrics (R² 0.91; median error 11.7% hourly / 6.3% daily; 5,220 deduped obs); corrected the hourly cron cadence and the run-health missed-run math (round-based, unit-tested); fixed the Seneca confluence ordering and the PoR/Edwards Ferry river distances (~34 / ~16 mi); reframed §5.8 hysteresis as fixed priors (not learned) and §6.6 cold-start as client-vs-server; documented provisional USGS-data jitter; removed two dead functions, stale "sync with index.html" comments, and the retired §6.9 accuracy badge. All doc numbers blind Python+R verified and USGS-checked; plan + independent audit in `analysis/docsweep-v36.3-plan-2026-06-17.md`. 407 → 418 tests. |
| v36.2 | 2026-06-17 | **Travel-time documentation accuracy (C6) — MINOR (docs/display only, no model change).** Corrected the displayed PoR→GF travel-time range from the stale "19–33h" to the true flow-dependent **~5–50h** (≈19h median, ~5h high water, up to ~50h at the 1,000-cfs floor) across the tech appendix, README, index.html and CLAUDE.md; rebuilt the §3.3 table's low-flow rows from the deployed relation `T = 4139·Q^−0.5963` (they understated low flow — e.g. 2,000 cfs is ~33h PoR→GF, not ~26h); clarified that the time-shift is a hydrograph wave-celerity propagation lag, not dye-tracer water travel, and that the low-flow lag is poorly constrained empirically (PoR↔LF cross-correlation r≈0.10 below ~4,000 cfs). The travel-time *relation* refit itself was investigated (Layer-0/Layer-A no-model-change diagnostics) and closed as low-leverage — see `analysis/travel-time-refit-plan-2026-06-17.md`. |
| v36.1 | 2026-06-17 | **Corrected-residual confidence band (C2) — MINOR** (display + a behavior-preserving refactor; the point estimate is unchanged). Fixed the 90% CI band on two coupled axes. The band is now applied **sign-aware and asymmetric** as `[estimate − q95, estimate − q05]` — the v36.0 symmetric `estimate ± (q95−q05)/2` discarded the residual's sign and could not represent an asymmetric or same-signed interval (e.g. `50000+/falling` is q05 −4,099 / q95 +6,429). And the `EMPIRICAL_CI_90` table was re-derived on the **corrected** residual the user actually sees (not the bare ensemble error): the real production model was replayed over 126,916 hourly obs (2011-2026, now including the four tributaries + LF stage) with its prequential EMA learn loop, and the corrected residual was quantiled binned by the model's own `(flowBin, flowState)`. High-flow bins (25000-50000, 50000+) use the wider of the multi-/single-pending tails so the band doesn't under-cover the laggier correction the deployed cron serves. The EMA bin update was extracted to a shared `updateCorrectionBin` so cron and backtest learn identically (behavior-preserving, cross-checked against the real validator). Blind Python + R derivation (agree <1e-9), independent auditor, 6/6 live-USGS provenance checks; out-of-sample coverage 88.4%, deployed-proxy (single-pending) coverage 89.1%. 386 → 391 unit tests. Methodology pre-audited by two independent lenses before coding. |
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

See [CHANGELOG.md](src/assets/CHANGELOG.md) for complete version history (v16–v37.2).

---

*Last updated: 2026-06-18 (v37.2 — cron observability fix)*

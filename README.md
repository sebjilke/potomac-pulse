# Potomac Pulse

Real-time Potomac River flow tracking and Great Falls water level predictions for paddlers.

**Live Site**: Deployed on Netlify (auto-deploys from `main` branch)
**Current Version**: v34.3 (February 2026)

## Quick Start

```bash
cd files/potomac-site
npm install          # Install Supabase dependency
# Deploy: git push origin main (auto-deploys via Netlify)
```

## Architecture

```
Frontend (PWA)                    Netlify Functions (Backend)
┌──────────────────┐              ┌──────────────────────────┐
│ index.html (SPA) │─── API ────→│ sync-learning.js         │
│  All HTML/CSS/JS │              │ scheduled-update.js (2h) │
│  Leaflet.js maps │              └──────────┬───────────────┘
└──────────────────┘                         │
                                   ┌─────────┼──────────┐
                                   ▼         ▼          ▼
                               Supabase   USGS API   NWS/NOAA
```

**Key principle**: Single-page app with embedded CSS/JS. No build step — edit and push.

## File Structure

```
files/potomac-site/
├── index.html                    # Main SPA (all HTML, CSS, JS)
├── manifest.json                 # PWA manifest
├── netlify.toml                  # Build config, function routing
├── package.json                  # Dependencies (@supabase/supabase-js)
└── netlify/functions/
    ├── shared/model.js           # Shared server module (Supabase init, flow bins, rating curve)
    ├── sync-learning.js          # Cloud sync API (learning data, predictions, PoR/GF history)
    ├── scheduled-update.js       # 2-hour background job (data collection, validation, predictions)
    ├── build-ef-correlation*.js  # EF correlation builders
    ├── validate-searcy-travel-times.js
    └── analyze-stage-errors.js
```

## Current Model (v34.3)

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
6. Apply learned EMA correction factors (18 flow bins × 3 flow states)
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

- **Validation**: Server-only, every 2h. Validates predicted GF against actual LF discharge.
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
// Observed PoR rate (2-hour lookback), falls back to NWS forecast on cold start
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

Runs every 2 hours: fetch USGS data → validate pending predictions (2.5h window) → make new prediction → update health metrics → store PoR/GF history. Learning suspended during ice conditions.

## Deployment

```bash
# Auto-deploys from main branch
git push origin main  # Netlify deploys in ~1 minute
```

**Environment Variables** (Netlify): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`

## Development

- **No build step** — edit `index.html` directly and push
- **Local testing** — open `index.html` in browser (USGS/NWS APIs work; cloud sync won't)
- **Keep in sync** — `index.html` and `scheduled-update.js` share model constants
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

See Technical Appendix for complete version history (v16–v34.3).

---

*Last updated: 2026-02-26 (v34.3 — Shared server module extraction)*

# Potomac Pulse

Real-time Potomac River flow tracking and Great Falls water level predictions for paddlers.

**Live Site**: Deployed on Netlify (auto-deploys from `main` branch)

## Quick Start

```bash
cd files/potomac-site
npm install          # Install Supabase dependency
# Deploy: git push origin main
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (PWA)                          │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  index.html (213 KB) - Single-page application        │  │
│  │  - Embedded CSS (~470 lines)                          │  │
│  │  - Embedded JS (~3,800 lines)                         │  │
│  │  - Leaflet.js for maps (CDN)                          │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Netlify Functions (Backend)                │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ sync-learning   │  │ scheduled-update│ (every 2 hours)  │
│  │ /api/sync       │  │ Background job  │                   │
│  └─────────────────┘  └─────────────────┘                   │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ build-ef-*      │  │ analyze-stage   │                   │
│  │ Correlation     │  │ Rating curves   │                   │
│  └─────────────────┘  └─────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    External Services                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  Supabase   │  │ USGS Water  │  │ NWS/NOAA    │          │
│  │  Database   │  │ Services    │  │ Forecasts   │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
files/potomac-site/
├── index.html              # Main SPA (all HTML, CSS, JS embedded)
├── manifest.json           # PWA manifest
├── netlify.toml            # Build config, function routing, scheduled jobs
├── package.json            # Dependencies (only @supabase/supabase-js)
├── TODO.md                 # Deferred tasks and roadmap
├── README.md               # This file
├── app-icon.svg            # PWA icon
├── gs-logo.png             # Footer logo
└── netlify/functions/      # Serverless backend
    ├── sync-learning.js           # Cloud sync API (31 KB)
    ├── scheduled-update.js        # 2-hour background job (34 KB)
    ├── build-ef-correlation.js    # Simple EF correlation (12 KB)
    ├── build-ef-correlation-advanced.js  # Advanced regression (34 KB)
    ├── validate-searcy-travel-times.js   # Travel time validation (19 KB)
    └── analyze-stage-errors.js    # Rating curve analysis (7 KB)
```

## Core Features

### 1. Real-Time River Tracking
Monitors 6+ USGS gauges with 15-minute updates:

| Gauge | USGS ID | Location | Purpose |
|-------|---------|----------|---------|
| Point of Rocks | 01638500 | 41 mi upstream | Primary predictor |
| Little Falls | 01646500 | Reference point | Target gauge |
| Edwards Ferry | 01644148 | Stage-only | Ensemble input |
| Monocacy | 01643000 | Major tributary | Flow contribution |
| Goose Creek | 01644000 | Tributary | Flow contribution |
| Seneca Creek | 01645000 | Minor tributary | Local adjustment |

### 2. Great Falls Prediction Model
Estimates current flow at Great Falls using time-shifted upstream data.

**Core Concept**: Water takes time to travel. At low flow (~1200 cfs), it takes ~25-30 hours
for water to travel from Point of Rocks to Great Falls. To know what's at GF *right now*,
we need to look at what PoR was reading a day ago - the current PoR reading tells you what
will arrive at GF tomorrow.

**Iterative Travel Time Convergence (v24.9)**:
Travel time depends on flow, but we're looking up historical flow - this creates a chicken-and-egg problem.
Solution: iterate to converge on the correct time-shift.

```
1. Start with current flow → calculate travel time
2. Look up historical PoR from that many hours ago
3. Recalculate travel time based on that historical flow
4. Repeat until converged (within 1 hour)
```

Example: Current flow 1200 cfs → 33h travel time → historical 1900 cfs found.
But 1900 cfs travels in ~25h, so that water already passed! Iterate to find correct data.

**Ensemble Blending (v24.15)**:
```
GF_estimate = (1 - w) × PoR_time_shifted + w × EF_power_law

Where:
- PoR_time_shifted = Point of Rocks reading from X hours ago (X = converged travel time)
- EF_power_law = coef × (EF_stage)^exp
  - Cold water (≤10°C): 175.4 × EF^2.302 (v24.14)
  - Default (>10°C): 136 × EF^2.42
- w = flow-dependent EF weight (v24.15):
  - <3000 cfs: 25% (EF has +33% bias from dam operations)
  - 3000-6000 cfs: 35%
  - 6000-15000 cfs: 40% (sweet spot)
  - >15000 cfs: 45% (EF most reliable at high flow)
- EF skipped if >50% discrepancy vs PoR (indicates ice/backwater)
```

**EF-Only Fallback (v24.10)**:
When Point of Rocks is ice-affected but Edwards Ferry and Little Falls are available,
the model falls back to an EF-only estimate instead of showing "UNAVAILABLE":
```
- Uses 100% EF power-law model with temperature adjustment
- Confidence: LOW (single-source, no ensemble)
- UI shows "❄️ EF-ONLY ESTIMATE" in blue with degraded confidence indicator
- Automatically reverts to full ensemble when PoR recovers
- No learning/validation data collected during EF-only mode
```

### 3. 48-Hour Forecast (v24.6)
Uses NWS hydrological forecasts with LF-constrained GF estimation and dynamic bias correction.

**LF-Constrained Approach**: Since GF is between PoR and LF, if NWS predicts LF will rise,
GF must rise BEFORE LF does. The forecast uses LF predictions shifted backward by GF→LF
travel time (~6-12h depending on flow) to ensure alignment with downstream conditions.

**Additive Bias Correction**: NWS forecasts often show systematic bias vs observed conditions
(e.g., forecast says 1.3 kcfs when gauge reads 1.0 kcfs). We apply an additive correction:

```
offset = observed_LF_now - forecast_LF_at_now
corrected_forecast = raw_forecast + offset
```

Why additive (not multiplicative)?
- Preserves the forecast's predicted *change* in flow (the physics of the rise)
- Doesn't amplify errors at high flows like multiplicative would
- River hydraulics are non-linear; a %-based correction at low flow would over/under-correct at different flow levels

The correction is **dynamic** - recalculated on every data fetch (every 15 min). As NWS
updates their model runs and reduces basin-wide errors, the offset automatically shrinks.

**Configuration**:
- **Primary source**: NWS/NOAA forecast for Little Falls (BRKM2), bias-corrected and shifted
- **Secondary source**: NWS forecast for Point of Rocks (PORM2) as fallback
- **Calculation intervals**: 6, 12, 18, 24, 30, 36, 42, 48 hours (for smooth graph interpolation)
- **Display intervals**: 6, 12, 24, 48 hours (shown as period cards)
- **Ensemble blending**: 60% PoR-based + 40% EF power-law (when EF forecast available)
- **Fallback**: Linear extrapolation when NWS unavailable

**Accuracy Tracking (v24.7)**:
The system tracks forecast accuracy by horizon (6h, 12h, 24h, 48h):
- Forecasts stored every 2 hours with target times
- Validated when target time arrives (compare to actual LF reading)
- Per-horizon error percentages tracked and displayed
- Shown in UI: `+6h: 92% • +12h: 89% • +24h: 85% • +48h: 78%`

### 4. Travel Time Calculations
Based on Searcy model (USGS Circular 438, 1961) with empirical correction:

```javascript
// Continuous power law: T = 4139 × Q^(-0.5963) hours
// (Original Searcy × 0.80 correction factor)

// Example travel times (Point of Rocks → Little Falls):
// 1,200 cfs → ~44 hours (low flow)
// 2,000 cfs → ~35 hours
// 5,000 cfs → ~26 hours (median flow)
// 20,000 cfs → ~15 hours
// 50,000 cfs → ~10 hours (flood)
```

**PoR → GF vs GF → LF Split**:
- Total PoR→LF distance: 41 miles
- PoR→GF: ~20 miles (49% of distance, but takes ~75% of travel time - slower upstream)
- GF→LF: ~21 miles (51% of distance, takes ~25% of time - gorge speeds flow)

### 5. Adaptive Learning System (v24)
Flow-binned corrections with anomaly detection:

- **18 correction bins**: 6 flow ranges × 3 flow states (rising/falling/steady)
- **Anomaly detection**: Ice signature, stage-discharge inconsistency, statistical outliers
- **EMA tracking**: Exponential moving average for error correction (α=0.3)
- **Validation cycle**: Every 2 hours via scheduled function
- **Ice suspension (v24.10)**: All learning and validation is suspended when any critical gauge (PoR, LF, or EF) is ice-affected. This prevents corrupted ice data from polluting correction bins. Applies to both client-side (`storeGFPrediction`, `storeForecastPredictions`, `updateEFHysteresis`) and server-side (`scheduled-update.js` validation and prediction steps). Centralized via `isCriticalGaugeIceAffected()` helper on client and `criticalIce` flag on server.

## Data Model

### Supabase Database Schema

Single table `potomac_observations` with polymorphic types:

| observation_type | gauge_id | data (JSON) |
|-----------------|----------|-------------|
| `observation` | gauge ID | Flow/stage readings |
| `correction` | gauge ID | Correction factor |
| `gf_prediction` | `pending`/`validated`/`flagged` | Prediction object |
| `gf_correction_bin` | `flowBin_flowState` | Bin statistics |
| `gf_forecast_pending` | `+6h`/`+12h`/`+24h`/`+48h` | Forecast prediction |
| `gf_forecast_metadata` | `+6h`/`+12h`/`+24h`/`+48h` | Forecast accuracy stats |
| `por_history` | `system` | 72-hour rolling buffer |
| `ef_gf_correlation` | `system` | Correlation model |
| `gf_metadata` | `system` | Health stats |

### LocalStorage Keys

| Key | Purpose |
|-----|---------|
| `potomac_learning_v24` | Learning corrections and observations |
| `potomac_cached_data` | Cached gauge readings (6-hour max age) |
| `potomac_por_history` | Point of Rocks time series |

## API Endpoints

### `/api/sync` (sync-learning.js)

**GET /api/sync**
- Returns all stored learning data
- Merges corrections, observations, metadata

**POST /api/sync**
- Saves learning data to Supabase
- Body: `{ metadata, corrections, observations }`

**GET /api/sync?endpoint=gf**
- Loads Great Falls learning data
- Returns: correction bins, pending predictions, metadata, EF correlation

**POST /api/sync?endpoint=gf**
- Actions: `storePrediction`, `storeForecastPredictions`, `recordValidation`, `incrementPredictions`
- Admin actions (PIN-protected): `resetLowFlowBins`, `resetGFLearning`

**GET /api/sync?endpoint=forecast-accuracy**
- Returns forecast accuracy stats per horizon
- Response: `{ horizons: { 6: { validations, avgErrorPercent }, 12: {...}, ... } }`

### Scheduled Function (scheduled-update.js)

Runs every 2 hours (cron: `0 */2 * * *`):
1. Fetch fresh USGS data (with ice detection: checks for -999999 and "Ice" qualifier)
2. Store Point of Rocks history (48-hour window)
3. Check critical gauge ice status (PoR, LF, EF)
4. If no ice: Validate pending GF predictions against actuals
5. If no ice: Validate pending 48h forecast predictions against actuals
6. If no ice: Make new GF prediction
7. Update health metrics (includes ice status in summary)

## Deployment

### Git-Based Deployment

```bash
# Repository: https://github.com/sebjilke/potomac-pulse.git
# Branch: main (auto-deploys to Netlify)

cd /Users/sebjilke/Desktop/PotomacPulse/files/potomac-site

# After making changes:
git add .
git commit -m "Description of changes"
git push origin main

# Netlify automatically deploys within ~1 minute
```

### Change Checklist

Before committing, ensure:
- [ ] Code changes are complete and tested
- [ ] README.md updated (if architecture/APIs/algorithms changed)
- [ ] In-app "How It Works" updated (if user-facing behavior changed)
- [ ] TODO.md updated (if tasks completed or new tasks identified)

### Environment Variables (Netlify)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Server-side auth key |

### Build Configuration (netlify.toml)

```toml
[build]
  publish = "."
  functions = "netlify/functions"
  command = "npm install"

[functions]
  node_bundler = "esbuild"

[[redirects]]
  from = "/api/sync"
  to = "/.netlify/functions/sync-learning"
  status = 200
```

## Key Algorithms Reference

### Searcy Travel Time Model
Location: `index.html` - `getFlowMultiplier()`, `calcTravelTimes()`

```javascript
// Travel time from Point of Rocks to Little Falls
const TRAVEL_COEF = 4139;  // Corrected coefficient (original: 5174)
const TRAVEL_EXP = -0.5963;
travelHours = TRAVEL_COEF * Math.pow(flowCFS, TRAVEL_EXP);
```

### Edwards Ferry Power-Law Model
Location: `index.html` - `estimateGFFromEdwardsFerry()`

```javascript
// Convert EF stage to estimated Little Falls CFS
const EF_COEF = 108;
const EF_EXP = 2.64;
estimatedCFS = EF_COEF * Math.pow(efStage, EF_EXP);

// Ensemble: 60% PoR + 40% EF (when consistent)
// Skip EF if discrepancy >50% (indicates ice/backwater)
```

### Flow State Classification
Location: `index.html` - used in prediction binning

```javascript
// Based on 2-hour flow change
const threshold = Math.max(100, flow * 0.02);
if (currentFlow > pastFlow * 1.02 && change >= threshold) return 'rising';
if (currentFlow < pastFlow * 0.98 && change >= threshold) return 'falling';
return 'steady';
```

### Anomaly Detection Scoring (v24.3)
Location: `scheduled-update.js` - `validatePendingPredictions()`

The system uses multiple physics-based checks to detect ice and equipment anomalies.
When suspicious score ≥ 2, learning is skipped to protect model integrity.

```javascript
// Score >= 2 triggers skipLearning
+2: EF cross-check discrepancy > 25% (v24.3: lowered from 30%)
+2: Stage-discharge inconsistency > 35% (ice reduces velocity, stage stays high)
+2: Low flow (<1500 cfs) + high stage (>2.45 ft) - classic ice signature (v24.3: raised from +1)
+1: Large prediction error > 50% - safety net for any anomaly
+2: Statistical outlier (z-score > 3)
```

**Physics rationale:**
- Ice dampens ADVM acoustic returns → underestimated velocity → low CFS reading
- Ice creates backwater effect → stage remains elevated despite reduced apparent flow
- Edwards Ferry (stage-only gauge) is less affected by ice than LF's ADVM
- Comparing EF estimate to LF actual reveals ice-induced discrepancies

## UI Structure

```
┌─────────────────────────────────────────────────────┐
│  Header (Status indicators, refresh button)         │
├─────────────────────────────────────────────────────┤
│  Main Content                                       │
│  ┌──────────────────┬──────────────────────────────┐│
│  │ Leaflet Map      │ Sidebar                      ││
│  │ (gauge markers)  │ ├─ Target Gauge (LF)        ││
│  │                  │ ├─ Flow Indicator           ││
│  │                  │ ├─ Tabs:                    ││
│  │                  │ │  ├─ Great Falls          ││
│  │                  │ │  ├─ All Gauges           ││
│  │                  │ │  ├─ How It Works         ││
│  │                  │ │  └─ Learning (PIN-locked)││
│  │                  │ │     └─ Admin Dashboard   ││
│  │                  │ └─ Footer                   ││
│  └──────────────────┴──────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

## Development Guidelines

### Documentation Requirements

**Every code change must be documented in two places:**

1. **This README.md** - Update relevant sections if the change affects:
   - Architecture or file structure
   - API endpoints or data model
   - Key algorithms or constants
   - Deployment process
   - Any information that helps understand the codebase

2. **In-App Documentation** (`index.html` - "How It Works" tab) - Update if the change affects:
   - User-facing features or behavior
   - How predictions are calculated
   - Data sources or refresh rates
   - Any information users should know about

**Why this matters:** Development often happens in new sessions without prior context. Good documentation ensures any developer (or AI assistant) can quickly understand the codebase and make informed changes.

### No Build Step Required
- All code is in `index.html` (CSS and JS embedded)
- Just edit and push to deploy

### Testing Locally
- Open `index.html` directly in browser
- Note: Cloud sync won't work without Netlify functions
- USGS/NWS APIs will work (CORS-enabled)

### Adding New Gauges
1. Add to `GAUGES` object in `index.html`
2. Add to appropriate `BRANCHES` group
3. Update map markers if needed

### Modifying Learning System
1. Changes to bins: Update both `index.html` and `scheduled-update.js`
2. Test locally with console logging
3. Consider migration for existing data

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Mapping | Leaflet.js 1.9.4 (CDN) |
| Backend | Node.js 18 (Netlify Functions) |
| Database | Supabase (PostgreSQL) |
| Hosting | Netlify |
| Analytics | GoatCounter |
| Data APIs | USGS WaterServices, NWS/NOAA |

## Version History

- **v24.15** (2026-02-11): **Flow-Dependent EF Weighting** — EF weight now varies by flow regime: 25% at <3k cfs (dam operations cause +33% EF bias), 35% at 3-6k, 40% at 6-15k (default), 45% at >15k cfs (EF most reliable at high flow). Based on RMSE optimization across 10,434 observations. Analysis in `/analysis/flow_weight_optimization_realistic.csv`.
- **v24.14** (2026-02-11): **Cold-Water EF Model** — Added temperature-aware coefficients: uses 175.4×EF^2.302 when water temp ≤10°C (50°F), default 136×EF^2.42 otherwise. Improves winter RMSE by 10.9%. Fetches water temp from Point of Rocks (USGS 01638500, param 00010).
- **v24.13** (2026-02-10): **EF Model Recalibration** — Updated Edwards Ferry power-law model from 108×EF^2.64 to 136×EF^2.42 based on analysis of 10,434 USGS daily observations (2011-2026). Reduces RMSE by 54% (from 12,577 to 5,790 cfs), mean error from 22.6% to 6.3%. This fixes ice detection EF cross-check which was previously broken due to systematic underestimation. Analysis scripts in `/analysis/` directory.
- **v24.12** (2026-02-10): **Phase 2 User Experience** — Mobile sidebar height fix (scrollable 45-60vh instead of fixed 45vh), network error banner with auto-dismiss (10s), map toggle button in header (🗺️), about button accessibility fix (span→button), forecast disclaimer font size increased (0.45rem→0.6rem), mobile font size CSS overrides for readability.
- **v24.11** (2026-02-10): **Phase 1 Security & Stability** — XSS fix (innerHTML→textContent throughout UI rendering), USGS response schema validation (client + server), fetch timeouts with AbortController (5-10s), admin PIN moved to server-side env variable (ADMIN_PIN), .env patterns in .gitignore, event listener memory leak fixed (property assignment vs addEventListener for repeated renders).
- **v24.10** (2026-02-03): EF-only GF fallback when PoR is ice-affected (shows "❄️ EF-ONLY ESTIMATE" with LOW confidence, auto-reverts when PoR recovers). Learning/validation suspended across all critical gauge ice conditions (client + server). Admin dashboard in Learning tab (LF/GF/PoR/EF status, model health, ice indicators). Fixed `ef.toFixed` crash in admin dashboard (ef is `{stage, timestamp}`, not a number). Fixed fetchData race condition with `isFetching` guard. Added forecast item validation in sync-learning. Fixed syncTimeout cleanup.
- **v24.9** (2026-01-25): Iterative travel time convergence fixes overprediction bug. At low flow, previous logic used current flow to calculate travel time (33h), but found higher historical flow (1900 cfs) that actually traveled faster (25h) and had already passed. Now iterates up to 3x to converge on correct time-shift.
- **v24.8** (2026-01-25): Skip EF ensemble when discrepancy >50% indicates ice/backwater. Extended PoR history to 72h for low-flow time-shifting.
- **v24.7** (2026-01-25): 48h forecast with LF-constrained approach, additive bias correction, and accuracy tracking. Uses NWS LF forecast shifted backward by GF→LF travel time with dynamic bias correction. Calculates at 8 intervals for smooth graph; displays 4 periods. Tracks per-horizon accuracy (6h, 12h, 24h, 48h) with validation when target time arrives.
- **v24.3** (2026-01-25): Tighter ice detection thresholds - EF cross-check 30%→25%, low-flow+high-stage now +2 points
- **v24.2** (2026-01-24): Ice-affected gauge display - shows last valid reading with ❄️ indicator, excludes from learning
- **v24.1** (2026-01-24): Improved ice detection - EF cross-check at validation time, tighter thresholds
- **v24.0** (2026-01-24): Adaptive learning system with anomaly detection
- **v23** (2026-01-24): Wave celerity adjustment for rising flood events
- **v22** (2026-01-23): Flow-scaled thresholds and learnable EF hysteresis
- **v21** (2026-01-23): Improved learning system - 2h schedule, 3% threshold, stale cleanup
- **v20** (2026-01-17): Empirical travel time correction (×0.80) from cross-correlation analysis
- **v19** (2026-01-17): Edwards Ferry power-law ensemble integration (original: 108×EF^2.64, later recalibrated in v24.13)
- Prior versions: See git history

---

*Last updated: 2026-02-11 (v24.15)*

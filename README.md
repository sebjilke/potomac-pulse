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
Ensemble approach combining two methods:

```
GF_estimate = 0.60 × PoR_time_shifted + 0.40 × EF_power_law

Where:
- PoR_time_shifted = Point of Rocks reading shifted by travel time
- EF_power_law = 108 × (EF_stage)^2.64
```

### 3. Travel Time Calculations
Based on Searcy model (USGS Circular 438, 1961) with empirical correction:

```javascript
// Original Searcy: T = 5174 × Q^(-0.5963) hours
// Corrected (2026): T = 4139 × Q^(-0.5963) hours (×0.80 multiplier)

// Example travel times (Point of Rocks → Little Falls):
// 2,000 cfs → ~35 hours
// 5,000 cfs → ~26 hours (median flow)
// 20,000 cfs → ~15 hours
// 50,000 cfs → ~10 hours
```

### 4. Adaptive Learning System (v24)
Flow-binned corrections with anomaly detection:

- **18 correction bins**: 6 flow ranges × 3 flow states (rising/falling/steady)
- **Anomaly detection**: Ice signature, stage-discharge inconsistency, statistical outliers
- **EMA tracking**: Exponential moving average for error correction (α=0.3)
- **Validation cycle**: Every 2 hours via scheduled function

## Data Model

### Supabase Database Schema

Single table `potomac_observations` with polymorphic types:

| observation_type | gauge_id | data (JSON) |
|-----------------|----------|-------------|
| `observation` | gauge ID | Flow/stage readings |
| `correction` | gauge ID | Correction factor |
| `gf_prediction` | `pending`/`validated`/`flagged` | Prediction object |
| `gf_correction_bin` | `flowBin_flowState` | Bin statistics |
| `por_history` | `system` | 48-hour rolling buffer |
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
- Actions: `storePrediction`, `recordValidation`, `incrementPredictions`
- Admin actions (PIN-protected): `resetLowFlowBins`, `resetGFLearning`

### Scheduled Function (scheduled-update.js)

Runs every 2 hours (cron: `0 */2 * * *`):
1. Fetch fresh USGS data
2. Store Point of Rocks history (48-hour window)
3. Validate pending predictions against actuals
4. Make new GF prediction
5. Update health metrics

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

### Anomaly Detection Scoring
Location: `scheduled-update.js` - `validatePendingPredictions()`

```javascript
// Score >= 2 triggers skipLearning
+2: EF cross-check discrepancy > 30%
+2: Stage-discharge inconsistency > 50%
+1: Low flow (<1000 cfs) + high stage (>2.50 ft) - ice signature
+2: Statistical outlier (z-score > 3)
```

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
│  │                  │ │  └─ Learning (locked)    ││
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

- **v24** (2026-01): Adaptive learning system with anomaly detection
- Prior versions: See git history

---

*Last updated: 2026-01-24*

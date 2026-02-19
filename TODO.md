# Potomac Pulse - Task List

*Reorganized after comprehensive project review (Feb 2026) — 45 issues identified across 5 areas*

---

## Phase 1: Security & Stability (Critical) ✅ COMPLETED

*Completed 2026-02-10*

### ~~Fix XSS vulnerability~~ ✅
- Replaced `innerHTML` with `textContent` throughout UI update code
- Added `getTrendData()` and `applyTrendToElement()` for safe trend rendering
- Refactored sync status, validation UI, bin stats table, and correction list displays

### ~~Add USGS response validation~~ ✅
- Added `validateUSGSResponse()` schema validation in both client and server
- Checks for required structure: `value.timeSeries` array with proper siteCode/variableCode

### ~~Add fetch timeouts~~ ✅
- Added `fetchWithTimeout()` wrapper using AbortController
- Client: 10s for USGS direct, 5s for proxies and Edwards Ferry
- Server: 10s for USGS in scheduled-update.js

### ~~Move PIN to environment variable~~ ✅
- Server-side PIN now uses `process.env.ADMIN_PIN` with fallback
- Client-side hash check remains for UI gating (not security)

### ~~Add .env to .gitignore~~ ✅
- Added `.env`, `.env.local`, `.env.*.local`, `.env.development`, `.env.production`

### ~~Fix memory leak in event listeners~~ ✅
- Changed forecast card and graph hover listeners from `addEventListener` to property assignment
- Prevents listener accumulation on repeated re-renders

---

## Phase 2: User Experience (High) ✅ COMPLETED

*Completed 2026-02-10*

### ~~Fix mobile sidebar height~~ ✅
- Changed from fixed `max-height: 45vh` to `min-height: 45vh; max-height: 60vh; overflow-y: auto`
- Sidebar now scrollable on mobile while maintaining split-view appearance

### ~~Add network error messaging~~ ✅
- Added error banner below header with auto-dismiss (10s)
- Shows on stale/error status: "Network unavailable" or "Unable to connect to USGS"
- Dismissible via ✕ button, auto-hidden on successful fetch

### ~~Add map toggle button~~ ✅
- Added 🗺️ button in header next to refresh
- Syncs with tab changes (active when on All Gauges tab)
- Proper ARIA attributes (aria-pressed, aria-label)

### ~~Increase mobile font sizes~~ ✅
- Added CSS overrides in mobile media query for 0.45rem and 0.5rem inline styles
- Targets forecast timeline and docs panel specifically

### ~~Fix about button accessibility~~ ✅
- Converted `<span id="about-btn">` to proper `<button>` element
- Removed role="button" and tabindex (native button doesn't need them)
- Added min-width/min-height 44px for touch targets

### ~~Increase forecast disclaimer size~~ ✅
- Changed 3 forecast disclaimer lines from 0.45rem to 0.6rem
- Experimental warning, legend hint, tributary note all now readable

---

## Phase 3: Science & Model Improvements (High)

*Requires sequential validation*

### ~~Update EF power-law model coefficients~~ ✅ (v24.13)
- **Old model**: 108 × EF^2.64 (had 22.6% mean error)
- **New model**: 136 × EF^2.42 (6.3% mean error, 54% RMSE reduction)
- **Data**: 10,434 daily observations from USGS (2011-2026)
- **Files updated**: index.html, scheduled-update.js
- **Analysis**: `/analysis/fetch_ef_longterm.py`, `/analysis/ef_lf_daily_longterm.csv`

### ~~Add temperature-aware EF model~~ ✅ (v24.14)
- **Implemented**: Cold-only adjustment (water temp ≤10°C uses 175.4×EF^2.302)
- **Finding**: Full temp model made predictions worse overall (-3.4%), but cold-only improves winter by 10.9%
- **Implementation**: Fetches PoR water temp (USGS 01638500, param 00010)
- **Fallback**: Uses default 136×EF^2.42 when temp unavailable or >10°C
- **Data**: `/analysis/ef_lf_temp_merged.csv`

### ~~Implement flow-dependent ensemble weighting~~ ✅ (v24.15)
- **Implemented**: EF weight varies by flow regime
  - <3000 cfs: 25% EF (dam operations cause +33% EF bias)
  - 3000-6000 cfs: 35% EF
  - 6000-15000 cfs: 40% EF (current default)
  - >15000 cfs: 45% EF (EF most reliable at high flow)
- **Analysis**: `/analysis/flow_weight_optimization_realistic.csv`
- **Impact**: Expected 2-3% RMSE improvement, better low-flow predictions

### Review GF prediction accuracy with live data
- **Background**: v24.13 (EF recalibration), v24.14 (cold-water model), v24.15 (flow-dependent weights) all now in production
- **Observation**: Predictions work but "feel off" — needs validation against actual readings
- **Action**: Compare GF predictions vs LF validation readings over several days/weeks of non-ice data
- **Check**: Are ensemble weights (25-45% EF) appropriate? Do cold-water coefficients trigger correctly?
- **May need**: Coefficient tuning, weight adjustments, or travel time corrections
- **Best timing**: Now — ice has melted, clean data flowing
- **Effort**: 4-8h (data collection + analysis)

### Re-tune ice detection thresholds (now possible)
- **Background**: Previous EF model underestimated by ~22%, so EF cross-check rarely triggered
- **With new model**: EF estimates are accurate, so EF >> LF during ice should now trigger correctly
- **Action**: Monitor ice detection during remainder of winter 2025-2026
- **Threshold review**: May need to adjust 25% threshold based on new model accuracy
- **Data**: USGS ice flags in `/analysis/ice_data_raw.csv`
- **Effort**: 4h (after monitoring period)

### Validate 0.80 travel time correction
- **Location**: `index.html` — Searcy model constants
- **Issue**: No statistical justification for 0.80 multiplier
- **Fix**: Compare with modern data, document confidence interval, or conduct dye-tracer study
- **Impact**: Model accuracy foundation
- **Effort**: 8h

### Add flow-dependent EF→LF time shift
- **Current**: Fixed 8-hour shift
- **Issue**: Shift varies 2-5 hrs depending on flow
- **Fix**: Use power-law T(Q) scaled to 15-mile distance
- **Effort**: 4h

### Add confidence intervals to predictions
- **Current**: Point estimates only
- **Fix**: Report "2,500 cfs ±300 cfs (90% CI)" with uncertainty propagation
- **Effort**: 4h

### Fix tributary timing calculations
- **Location**: `index.html` — `calcTravelTimes()`
- **Issue**: Timing calculations for tributaries need adjustment
- **Impact**: Inaccurate arrival predictions

### Segment-specific travel time validation (spring)
- **Location**: `validate-searcy-travel-times.js`
- **Issue**: Need more data during high-flow spring events
- **Note**: Seasonal — best addressed during spring runoff

---

## Phase 4: Database & Infrastructure (High)

*Can run parallel to Phase 3*

### Add data retention policy
- **Location**: `scheduled-update.js`
- **Issue**: Predictions grow indefinitely (~4,380/year)
- **Fix**: Auto-delete predictions older than 6 months, archive before deletion
- **Effort**: 2h

### Add database constraints
- **Location**: Supabase schema
- **Issue**: No CHECK, NOT NULL constraints; relies on application logic
- **Fix**: Add constraints on correction_factor range, required fields
- **Effort**: 2h

### Implement RLS policies
- **Location**: Supabase
- **Issue**: No Row Level Security; data potentially exposed
- **Fix**: Public read, service-role write policies
- **Effort**: 2h

### Add composite index
- **Location**: Supabase
- **Issue**: No index for common query pattern
- **Fix**: `CREATE INDEX ON potomac_observations (observation_type, gauge_id, created_at DESC)`
- **Effort**: 1h

### Batch upsert operations
- **Location**: `sync-learning.js`
- **Issue**: Loop of individual upserts is inefficient
- **Fix**: Single batch upsert call
- **Effort**: 2h

### Review Supabase service key age
- **Location**: Netlify environment variables
- **Issue**: Rotate if key is old
- **Impact**: Security best practice

---

## Phase 5: Code Quality & Testing (Medium)

*Foundation for ongoing maintenance*

### Add automated tests
- **Location**: New test files needed
- **Focus**: Travel time calculations, flow estimation, anomaly detection
- **Framework**: Jest or similar
- **Effort**: 16h

### Extract shared utilities
- **Location**: `index.html`, `sync-learning.js`, `scheduled-update.js`
- **Issue**: `estimateLFFlowFromStage()`, `getFlowState()` duplicated 3x
- **Fix**: Create shared module, single source of truth
- **Effort**: 4h

### Add error tracking
- **Location**: Application-wide
- **Issue**: Can't diagnose production issues
- **Fix**: Integrate Sentry or similar
- **Effort**: 2h

### Create constants.js
- **Location**: New file
- **Issue**: Flow thresholds, coefficients scattered across files
- **Fix**: Centralize all constants with documentation
- **Effort**: 2h

### Add JSDoc comments
- **Location**: `index.html` — complex algorithms
- **Issue**: No unit documentation, function purposes unclear
- **Fix**: Document all public functions with units and return types
- **Effort**: 8h

### Add input validation for learning data sync
- **Location**: `sync-learning.js`
- **Current**: Some validation exists (0.1-10 range)
- **Fix**: Comprehensive validation with error messages

### Add rate limiting to sync endpoint
- **Location**: `sync-learning.js`
- **Current**: 100 observations limit exists
- **Fix**: Add proper rate limiting middleware

---

## Phase 6: Nice-to-Have Enhancements (Low)

*Ongoing backlog*

### Add service worker for offline
- **Current**: PWA manifest exists but no service worker
- **Fix**: Network-first strategy, cache last 24h of data
- **Effort**: 8h

### Add gauge search/filter
- **Location**: All Gauges tab
- **Issue**: Hard to find specific gauges
- **Fix**: Search box with instant filtering
- **Effort**: 4h

### Persist branch collapse state
- **Location**: All Gauges tab
- **Issue**: Branches reset on refresh
- **Fix**: Store in localStorage
- **Effort**: 2h

### Add backup export function
- **Location**: `scheduled-update.js`
- **Issue**: No documented backup strategy
- **Fix**: Monthly export to file storage or email
- **Effort**: 4h

### Add audit logging
- **Location**: Admin functions
- **Issue**: No record of admin actions (resets)
- **Fix**: Separate audit_log table
- **Effort**: 4h

### Consider Muskingum-Cunge for floods
- **Current**: Searcy model may miss wave peaking
- **Improvement**: Hybrid KC model for Q > 20,000 cfs
- **Effort**: 40h (research project)

### Split monolithic index.html
- **Current**: Single 273KB file with 5,656 lines
- **Recommendation**: Extract to `styles.css`, `app.js`, modules
- **Impact**: Improved maintainability, better caching

### Improve mobile sidebar scrolling
- **Current**: Fixed 45vh on mobile (covered in Phase 2)

### Add loading states for map initialization
- **Location**: `index.html` — `initMap()`
- **Impact**: Better perceived performance

### Enhance admin monitoring dashboard
- **Current**: Basic dashboard in Learning tab
- **Improvement**: Historical trend charts, alert thresholds, export

### Log validation failures for analysis
- **Location**: `scheduled-update.js`
- **Current**: Flagged predictions stored but not accessible
- **Fix**: Query interface or export

### Implement Bayesian updating
- **Current**: Simple EMA for error tracking
- **Improvement**: Bayesian posterior with uncertainty quantification

### Add seasonal stratification to bins
- **Current**: 18 bins (6 flow × 3 state)
- **Improvement**: Add spring/summer/winter dimension

### Build cross-validation framework
- **Current**: No formal validation framework
- **Improvement**: Hold-out testing, k-fold

### 1-year retrospective validation study
- **Approach**: Archive 15-min data + predictions to Supabase
- **Goal**: Full model calibration across all seasons/regimes

---

## Completed

- [x] **Flow-Dependent EF Weighting** v24.15 (2026-02-11)
  - EF weight now varies by flow: 25% at <3k (dam ops), 35% at 3-6k, 40% at 6-15k, 45% at >15k
  - Based on RMSE optimization across 10,434 observations
  - Expected 2-3% overall improvement, better low-flow predictions
  - Analysis: `/analysis/flow_weight_optimization_realistic.csv`
- [x] **Cold-Water EF Model** v24.14 (2026-02-11)
  - Added cold-water adjustment: 175.4×EF^2.302 when temp ≤10°C
  - Improves winter RMSE by 10.9%
  - Full temp model hurt warm predictions, so cold-only implemented
  - Fetches PoR water temp (USGS 01638500, param 00010)
  - Analysis: `/analysis/ef_lf_temp_merged.csv`
- [x] **EF Model Recalibration** v24.13 (2026-02-10)
  - Updated power-law from 108×EF^2.64 to 136×EF^2.42
  - Based on 10,434 USGS daily observations (2011-2026)
  - RMSE reduced 54% (12,577 → 5,790 cfs), mean error 22.6% → 6.3%
  - Fixes ice detection EF cross-check (was broken due to underestimation)
  - Analysis data: `/analysis/ef_lf_daily_longterm.csv`
- [x] **Comprehensive project review** (2026-02-10)
  - 5 independent review agents analyzed structure, code, UX, science, database
  - 45 issues identified: 8 critical, 12 high, 15 medium, 10 low
  - Reorganized TODO into 6 phases with holistic prioritization
  - Created PDF slide deck with findings
- [x] **Phase 2: User Experience** v24.12 (2026-02-10)
  - Mobile sidebar height fix (scrollable 45-60vh)
  - Network error banner with auto-dismiss
  - Map toggle button in header (🗺️)
  - About button accessibility (span→button)
  - Forecast disclaimer font size increased (0.45rem→0.6rem)
  - Mobile font size CSS overrides
- [x] **Phase 1: Security & Stability** v24.11 (2026-02-10)
  - XSS fix: innerHTML → textContent throughout UI
  - USGS response schema validation (client + server)
  - Fetch timeouts with AbortController (5-10s)
  - PIN moved to server-side env variable
  - .env patterns added to .gitignore
  - Event listener memory leak fixed
- [x] EF-only fallback, ice learning suspension, admin dashboard, code review fixes v24.10 (2026-02-03)
  - EF-only GF fallback when PoR ice-affected
  - Ice learning suspension (client + server)
  - Admin dashboard in Learning tab
  - Fixed ef.toFixed crash, fetchData race, forecast validation, syncTimeout
- [x] Iterative travel time convergence v24.9 (2026-01-25)
- [x] EF ensemble discrepancy check & extended history v24.8 (2026-01-26)
- [x] 48h forecast with LF-constrained approach, bias correction & accuracy tracking v24.7 (2026-01-25)
- [x] Tighter ice detection thresholds v24.3 (2026-01-25)
- [x] Ice-affected gauge display v24.2 (2026-01-24)
- [x] Improve ice/anomaly detection v24.1 (2026-01-24)
- [x] Create comprehensive README.md (2026-01-24)
- [x] Document deployment workflow
- [x] Add documentation requirements to development guidelines

---

*Last updated: 2026-02-11 (Cold-water EF v24.14, flow-dependent weighting v24.15)*

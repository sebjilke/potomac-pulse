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

### Completed ✅

All model parameters have been validated on 117,704 hourly observations (2011–2026) via the 3-layer verification protocol (simultaneous blind Python + R subagents + independent auditor):

- **EF power-law**: 126×EF^2.46 (default), 160×EF^2.36 (cold) — validated, <5% change on hourly data ✅
- **EF weights**: Flat 35% above 3k cfs — graduated ramp 0.70 cfs worse, CV 1.8% worse OOS ✅
- **Ceiling/decay**: 120% ceiling, 0.50 decay cap — validated, decay irrelevant at hourly resolution ✅
- **Autocorrelation**: Extreme (DW=0.007) but does not bias estimates (confirmed by subsampling) ✅
- **Cold-water model**: 160×EF^2.36 when ≤10°C — validated on 12,959 hourly obs ✅

Audit reports: `analysis/powerlaw_refit_audit.md`, `analysis/gradient_weights_117k_audit.md`, `analysis/backtest_117k_audit.md`

### Completed (Phase 3 Validation, 2026-02-19) ✅

- **Validate 0.80 travel time correction** — INCONCLUSIVE. First-difference cross-correlation works at high flows (>20k cfs) where empirical ratios (0.84, 1.05) bracket current 0.80, but noise-dominated at low flows. Keeping 0.80. See `analysis/travel_time_audit.md`.
- **Add flow-dependent EF→LF time shift** — lag=0 VALIDATED. Lag=4h gives only 3.3% improvement, concentrated entirely in >50k cfs floods (3% of data). For 87% of operational data (3k-25k cfs), lag=0 is already optimal. See `analysis/ef_lag_audit.md`.
- **Add confidence intervals to predictions** — IMPLEMENTED (v29.1). Empirical 90% CI per bin replaces ±1σ. Errors are non-normal in all 18 bins (kurtosis up to 18.3, asymmetry up to 42:1). Gaussian ±1.645σ would mis-specify by up to 745%. See `analysis/error_distribution_audit.md`.
- **Fix tributary timing calculations** — NO CHANGE needed. Monocacy (7.1%) and Goose Creek (3.0%) contribute only 10.1% of flow. Time-shifting provides <1% RMSE improvement in all flow regimes. Theoretical upper bound: 0.098% (mathematically impossible to reach 1% threshold). See `analysis/tributary_timing_audit.md`.

### Segment-specific travel time validation (spring)
- **Note**: Seasonal — best addressed during spring runoff
- **Effort**: 8h

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

- [x] **Empirical 90% CI** v29.1 (2026-02-19)
  - Per-bin error quantiles (q05/q95) replace ±1σ uncertainty display
  - Errors non-normal in all 18 bins; Gaussian would mis-specify by up to 745%
  - 3-layer verified (Python + R + auditor)
- [x] **Phase 3 Science Validation** v29.1 (2026-02-19)
  - Travel time 0.80 correction: INCONCLUSIVE, keeping current (brackets at high flow)
  - EF→LF lag=0: VALIDATED (3% improvement only in rare >50k floods)
  - Tributary timing: NO CHANGE needed (<1% improvement, theoretical max 0.098%)
- [x] **117k Hourly Validation** v29.0 (2026-02-19)
  - All model parameters re-estimated on 117,704 hourly observations (2011–2026)
  - 3-step pipeline: gradient weights, ceiling/decay, power-law + autocorrelation
  - 3-layer verification: blind Python + R subagents + independent auditor
  - Result: No parameter changes warranted. v29.0 fully validated.
- [x] **Flat 35% EF Weight** v29.0 (2026-02-19)
  - Re-optimized on 42,838 hourly obs with travel-time-shifted PoR
  - Flat 35% beats graduated ramp by -4.6% RMSE
- [x] **Soft LF Ceiling + Decay Cap** v28.0 (2026-02-19)
  - 120% ceiling, 0.50 decay cap. Grid search: 25 configs on daily + hourly
- [x] **Gradient EF Weights** v27.0 (2026-02-19)
  - Piecewise-linear (0%→40%). -25.8% RMSE vs step function.
- [x] **PoR-Delta Correction** v25.0 (2026-02-18)
  - Staleness correction for rising/falling rivers. -26% Overall RMSE.
- [x] **EF Model Recalibration** v24.16 (2026-02-18)
  - 126×EF^2.46 (default), 160×EF^2.36 (cold). 5,220 daily obs.
- [x] **Flow-Dependent EF Weighting** v24.15 (2026-02-11)
- [x] **Cold-Water EF Model** v24.14 (2026-02-11)
- [x] **Phase 2: User Experience** v24.12 (2026-02-10)
- [x] **Phase 1: Security & Stability** v24.11 (2026-02-10)
- [x] EF-only fallback, ice learning suspension, admin dashboard v24.10 (2026-02-03)
- [x] Iterative travel time convergence v24.9 (2026-01-25)
- [x] 48h forecast with LF-constrained approach v24.6-24.7 (2026-01-25)
- [x] Ice/anomaly detection v24.0-24.3 (2026-01-24)

---

*Last updated: 2026-02-19 (v29.1 — Empirical 90% CI, Phase 3 science validation)*

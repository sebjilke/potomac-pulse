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

## Phase 2: User Experience (High)

*Mobile-first fixes that work together*

### Fix mobile sidebar height
- **Location**: CSS — `max-height: 45vh` on mobile
- **Issue**: Users can't scroll to see all gauges on phones
- **Fix**: Remove limit or make truly scrollable
- **Effort**: 30m

### Add network error messaging
- **Location**: `index.html` — `fetchData()` error handling
- **Issue**: API failures show `--` with no explanation
- **Fix**: Add prominent error banner above content
- **Effort**: 2h

### Add map toggle button
- **Location**: Header UI
- **Issue**: No visible control to switch between map and list
- **Fix**: Add toggle button in header
- **Effort**: 1h

### Increase mobile font sizes
- **Location**: CSS media queries
- **Issue**: Fonts as small as 0.7rem are unreadable
- **Fix**: Minimum 0.8rem for all content
- **Effort**: 1h

### Fix about button accessibility
- **Location**: `index.html` — about button
- **Issue**: Uses `<span>` instead of `<button>`
- **Fix**: Convert to proper button element, add aria-describedby to tooltip
- **Effort**: 30m

### Increase forecast disclaimer size
- **Location**: CSS — forecast experimental warning
- **Issue**: 0.45rem text is unreadable
- **Fix**: Increase to 0.6rem minimum
- **Effort**: 15m

---

## Phase 3: Science & Model Improvements (High)

*Requires sequential validation*

### Validate 0.80 travel time correction
- **Location**: `index.html` — Searcy model constants
- **Issue**: No statistical justification for 0.80 multiplier
- **Fix**: Compare with modern data, document confidence interval, or conduct dye-tracer study
- **Impact**: Model accuracy foundation
- **Effort**: 8h

### Implement flow-dependent ensemble weighting
- **Current**: Static 60% PoR / 40% EF regardless of flow
- **Fix**: Vary weights by flow regime:
  - Low flow (<3000 cfs): 80/20 (EF less reliable at low stage)
  - Medium flow (3000-15000 cfs): 60/40
  - High flow (>15000 cfs): 50/50 (both methods reliable)
- **Effort**: 4h

### Add flow-dependent EF→LF time shift
- **Current**: Fixed 8-hour shift
- **Issue**: Shift varies 2-5 hrs depending on flow
- **Fix**: Use power-law T(Q) scaled to 15-mile distance
- **Effort**: 4h

### Data-driven ice detection thresholds
- **Current**: 25%, 35% thresholds are ad-hoc
- **Fix**: Analyze historical false positives/negatives, optimize with ROC curve
- **Effort**: 8h

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

- [x] **Comprehensive project review** (2026-02-10)
  - 5 independent review agents analyzed structure, code, UX, science, database
  - 45 issues identified: 8 critical, 12 high, 15 medium, 10 low
  - Reorganized TODO into 6 phases with holistic prioritization
  - Created PDF slide deck with findings
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

*Last updated: 2026-02-10 (Phase 1 complete)*

# Potomac Pulse - Task List

## Medium Priority

### Fix tributary timing calculations
- **Location**: `index.html` - `calcTravelTimes()` and related functions
- **Issue**: Timing calculations for tributaries need adjustment
- **Impact**: Inaccurate arrival predictions for tributaries

### Segment-specific travel time validation (spring)
- **Location**: `validate-searcy-travel-times.js`
- **Issue**: Need more data during high-flow spring events
- **Impact**: Model accuracy during spring conditions
- **Note**: Seasonal - best addressed during spring runoff

### Add error handling for failed API calls
- **Location**: Multiple `fetch()` calls in `index.html`
- **Issue**: Basic error handling exists but inconsistent
- **Impact**: Better UX when USGS/NWS APIs are unavailable

### Add automated tests for prediction model
- **Location**: New test files needed
- **Issue**: No test suite exists
- **Impact**: Regression prevention, confidence in changes

### Review Supabase service key age
- **Location**: Netlify environment variables
- **Issue**: Rotate if key is old
- **Impact**: Security best practice

---

## Low Priority

### Code Quality / Maintenance

#### Split monolithic index.html into separate files
- **Current**: Single 213 KB HTML file with embedded CSS/JS (~3,800 lines of JS)
- **Recommendation**: Extract to `styles.css`, `app.js`, and component modules
- **Impact**: Improved maintainability, better caching

#### Add input validation for learning data sync
- **Location**: `sync-learning.js`
- **Current**: Some validation exists (correction factors 0.1-10 range)
- **Impact**: Data integrity protection

### Model Improvements

#### Implement flow-dependent ensemble weighting
- **Current**: Static 60% PoR / 40% EF weighting regardless of flow
- **Improvement**: Vary weights by flow regime:
  - Low flow (<3000 cfs): EF weight higher (~50%) - power-law is stable, travel time uncertain
  - Medium flow (3000-15000 cfs): Current 60/40 may be optimal
  - High flow (>15000 cfs): PoR weight higher (~70%) - travel time more predictable
  - Flood (>50000 cfs): Consider EF higher - proximity matters, travel time compressed
- **Alternative**: Inverse-variance weighting based on historical error by flow bin
- **Physics**: EF's proximity (2 mi) gives it an advantage when travel times are uncertain; PoR's actual flow data is more reliable when hydraulics are stable
- **Impact**: Better predictions across all flow regimes

#### Implement Bayesian updating
- **Current**: Simple EMA for error tracking
- **Improvement**: Bayesian posterior updates with uncertainty quantification
- **Impact**: Better convergence and uncertainty ranges

#### Muskingum-Cunge routing
- **Current**: Searcy model (1961) with empirical correction
- **Improvement**: Proper hydrological flow routing
- **Impact**: Better travel time predictions during varying flows

#### Add seasonal stratification
- **Current**: 18 bins (6 flow ranges × 3 flow states)
- **Improvement**: Add seasonal dimension (spring/summer/winter)
- **Impact**: Account for seasonal hydraulic behavior differences

#### Build cross-validation framework
- **Current**: No formal validation framework
- **Improvement**: Hold-out testing, k-fold cross-validation
- **Impact**: Model reliability verification

#### Large-scale retrospective validation study (1-year)
- **Approach**: Archive 15-min instantaneous data + model predictions to Supabase
- **Timeline**: Run for 1 year to capture all seasons/flow regimes
- **Analysis**:
  - Compare predictions vs actuals across flow bins
  - Validate/refine Searcy travel time coefficients
  - Optimize ensemble weights (PoR/EF) by flow regime
  - Identify systematic biases by season, gauge, or condition
- **Data to store**:
  - 15-min instantaneous gauge readings (all gauges)
  - GF predictions at each interval
  - Actual outcomes for validation
  - Flow state (rising/falling/steady)
  - PoR history for wave propagation analysis
  - Validation results with error %, anomaly flags
- **Note**: Already storing predictions/validations via scheduled-update.js (~4,380/year)
- **Enhancement**: Add lightweight 15-min raw data archive for finer granularity
- **Impact**: Rigorous model calibration based on real wave propagation data

### UI/UX Improvements

#### Add loading states for map initialization
- **Location**: `index.html` - `initMap()`
- **Impact**: Better perceived performance

#### Improve mobile sidebar scrolling
- **Current**: Fixed 45vh on mobile
- **Impact**: Better mobile experience

#### Add offline data caching with Service Worker
- **Current**: PWA manifest exists but no service worker
- **Impact**: True offline capability

### Testing & Monitoring

#### Add health monitoring dashboard
- **Location**: `scheduled-update.js` tracks health metrics
- **Current**: Some health stats in Learning tab (PIN-protected)
- **Impact**: Easier operational monitoring

#### Log validation failures for analysis
- **Location**: `scheduled-update.js`
- **Current**: Flagged predictions stored but not easily accessible
- **Impact**: Better model debugging

### Documentation

#### Add inline code comments for complex algorithms
- **Location**: `index.html` - Searcy model, ensemble logic, learning system
- **Current**: Some comments exist but could use more
- **Impact**: Code maintainability

### Security

#### Add rate limiting to sync endpoint
- **Location**: `sync-learning.js`
- **Current**: 100 observations per sync limit exists
- **Impact**: Additional abuse prevention

---

## Completed

- [x] Tighter ice detection thresholds v24.3 (2026-01-25)
  - Lowered EF cross-check threshold (30% → 25%)
  - Increased low-flow + high-stage weight (+1 → +2) - this is THE classic ice signature
  - Reset corrupted low-flow learning bins (0-3000, 3000-6000 cfs)
  - Following USGS/NWS approach: detect bad data, flag it, exclude from learning
- [x] Ice-affected gauge display v24.2 (2026-01-24)
  - Detects USGS ice flags (-999999 with "Ice" qualifier)
  - Shows last valid reading (7-day window) with ❄️ indicator
  - Falls back to drainage estimate with "Ice-affected >7 days" message
  - Ice-affected data excluded from learning model
  - GF predictions skipped when critical gauges (PoR, LF) are ice-affected
  - Removed Harpers Ferry gauge (stage-only, no discharge data)
- [x] Improve ice/anomaly detection v24.1 (2026-01-24)
  - EF cross-check now uses current stage at validation time
  - Lowered stage-discharge threshold (50% → 35%)
  - Raised low-flow threshold (1000 → 1500 cfs)
  - Added large error check (>50%)
- [x] Create comprehensive README.md (2026-01-24)
- [x] Document deployment workflow
- [x] Add documentation requirements to development guidelines

---

*Last updated: 2026-01-25 (v24.3)*

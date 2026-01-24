# Potomac Pulse - Task List

## Medium Priority

### Fix estimated gauge values not fetching
- **Location**: `index.html` - data fetching logic
- **Issue**: Estimated gauge data retrieval failing
- **Impact**: Missing data affects predictions

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

- [x] Create comprehensive README.md (2026-01-24)
- [x] Document deployment workflow
- [x] Add documentation requirements to development guidelines

---

*Last updated: 2026-01-24 (v24)*

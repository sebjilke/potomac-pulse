# Potomac Pulse: Comprehensive Improvement Plan (Revised)

**Date:** 2026-02-27 (revised after full codebase review)
**Based on:** Adversarial review + complete reading of source code, 19 audit reports, CLAUDE.md, TODO.md
**Version reviewed:** v34.5

---

## Preamble: What the Original Review Got Wrong

After reading the full codebase and all 19 audit reports, several criticisms in the original
adversarial review were overstated or factually incorrect. Corrections for the record:

| Original Claim | Reality |
|----------------|---------|
| "0.80 Searcy multiplier is unjustified" | Investigated in `travel_time_audit.md`. Result: INCONCLUSIVE but validated at high flows (empirical ratios 0.84 and 1.05 bracket 0.80). Kept with documented rationale. |
| "R² is misleading, use MdAPE" | Already done (v29.1). Empirical 90% CIs replace Gaussian. The project explicitly shows Gaussian would mis-specify by up to 745%. MdAPE of 6.3% is already the operational metric. |
| "Tributary percentages are treated as constants" | Wrong. Real-time USGS gauge data is fetched for Monocacy, Goose Creek, Broad Run, and Seneca. Drainage-area ratios are fallbacks, not primaries. Tributary timing was investigated (`tributary_timing_audit.md`) and found to provide <1% improvement (theoretical max 0.098%). |
| "The 120% soft ceiling is a band-aid" | Validated in a 25-config grid search on 117k hourly obs (`backtest_117k_audit.md`). Current 1.20 is the balanced choice. |
| "18 learning bins may be overfitting" | The error distribution was analyzed per-bin (`error_distribution_audit.md`). The wide CI at 50k+ is honest reporting of genuine uncertainty, not overfitting. |
| "No uncertainty propagation" | Empirical quantile-based CIs capture all combined error sources from the actual data — arguably more honest than RSS propagation of assumed-independent components. |
| "Race conditions in async data flow" | Fixed in v34.0. Server-only validation eliminated client/server race condition. |
| "XSS vectors via innerHTML" | Fixed in Phase 1 (v24.11). `innerHTML` replaced with `textContent` throughout. |
| "Ice detection is vague" | Two-tier anomaly detection system implemented (v33.0) with hard flags (physical corruption) and soft flags (model disagreement), plus EMA clamping per auditor recommendation. |

**What the review got right:** The code architecture (monolith, duplication, no tests), security
gaps (CSP, SRI, rate limiting, RLS), and UI/accessibility issues are all genuine and confirmed
by the project's own TODO.md.

---

## Phase 1: Security Hardening (Week 1)

Low effort, high impact. These items align with the project's existing TODO Phase 4.

### 1.1 Add Content Security Policy

**Status:** Not present. `netlify.toml` has `X-Frame-Options` and `X-Content-Type-Options` but no CSP.

**Fix:** Add to the existing `[[headers]]` block in `netlify.toml`:
```toml
Content-Security-Policy = "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.usgs.gov https://*.tile.openstreetmap.org; connect-src 'self' https://waterservices.usgs.gov https://api.water.noaa.gov https://*.supabase.co; frame-ancestors 'none'"
```

Note: `'unsafe-inline'` is required while the app remains a single `index.html`. Remove it after modularization (Phase 3).

**Files changed:** `netlify.toml`

### 1.2 Add SRI to External Resources

**Status:** Leaflet CSS and JS loaded from `unpkg.com` without integrity hashes.

**Fix:** Pin exact versions and add `integrity` + `crossorigin` attributes to all CDN `<script>` and `<link>` tags in `index.html`.

**Files changed:** `index.html`

### 1.3 Enable Supabase Row Level Security

**Status:** Not enabled (listed in project TODO Phase 4).

**Fix:**
- Public read on `gf_learning`, `gf_history`, `por_history`, `forecast_accuracy`
- Service-role-only write on all tables
- This prevents direct Supabase API access from bypassing the Netlify Function auth layer

**Files changed:** Supabase dashboard (SQL migrations)

### 1.4 Add Database Constraints

**Status:** No CHECK or NOT NULL constraints (listed in project TODO Phase 4).

**Fix:**
- `correction_factor` range CHECK (e.g., 0.1 to 10.0)
- NOT NULL on required fields (timestamp, flow_bin, flow_state)
- Composite index on `(flow_bin, flow_state, created_at DESC)` for common query pattern

**Files changed:** Supabase dashboard (SQL migrations)

### 1.5 Add Data Retention Policy

**Status:** Predictions grow indefinitely (~4,380/year). Listed in project TODO Phase 4.

**Fix:** In `scheduled-update.js`, add cleanup step:
- Delete predictions older than 6 months
- Archive to a `predictions_archive` table before deletion (optional)
- Run as part of the existing 2-hour cron job

**Files changed:** `scheduled-update.js`

### 1.6 Rate Limiting on `/api/sync`

**Status:** Some validation exists (100 observations limit) but no per-IP rate limiting.

**Fix:** Add a simple sliding-window counter using Supabase or in-memory state in `sync-learning.js`:
- GET endpoints: 60 requests/min per IP
- POST endpoints: 10 requests/min per IP
- Return 429 with `Retry-After` header when exceeded

**Files changed:** `sync-learning.js`

---

## Phase 2: Eliminate Code Duplication (Week 1-2)

The single highest-risk maintenance issue. Every model parameter change currently requires
updating 2-3 files with SYNC WARNING comments that are not programmatically enforced.

### 2.1 Expand `shared/model.js` as the Single Source of Truth

**Status:** `shared/model.js` already exports `getFlowBin()`, `estimateLFFlowFromStage()`, and
`getSupabase()`. But the following are still duplicated between `index.html` and `scheduled-update.js`:

| Duplicated Code | Locations |
|----------------|-----------|
| `estimateLFStage()` / `estimateLFFlowFromStage()` | `index.html` (CFS→stage), `model.js` (stage→CFS) — inverse functions with same breakpoints |
| `TRAVEL_COEF`, `TRAVEL_EXP`, `MEDIAN_TRAVEL` | `index.html`, `scheduled-update.js` |
| `EF_MODEL` (coef, exp, cold variants) | `index.html`, `scheduled-update.js` |
| `EF_W_MAX`, `EF_K`, `EF_Q_MID` | `index.html`, `scheduled-update.js` |
| `SOFT_CEILING_FACTOR`, `DECAY_CAP` | `index.html`, `scheduled-update.js` |
| `TRIB_FACTORS` | `index.html`, `scheduled-update.js` |
| `GF_FLOW_BINS` | `index.html`, `model.js` (partial), `scheduled-update.js` |
| `getFlowState()` thresholds | `index.html`, `scheduled-update.js` |
| Anomaly detection logic | `index.html` (display), `scheduled-update.js` (validation) |

**Fix:** Move all shared constants and pure functions into `shared/model.js`. Since Netlify
Functions use Node.js with `require()`, and the server-side code already imports from
`shared/model.js`, this requires no build step change:

```javascript
// netlify/functions/shared/model.js — expanded

// === Constants ===
const TRAVEL_COEF = 4139;
const TRAVEL_EXP = -0.5963;
const MEDIAN_TRAVEL = 25.8;

const EF_MODEL = {
  coef: 126, exp: 2.46,
  coldCoef: 160, coldExp: 2.36,
  coldMaxTemp: 10, minStage: 2.5, maxStage: 20.0
};

const EF_WEIGHT = { W_MAX: 0.40, K: 5.0, Q_MID: 10000 };
const SOFT_CEILING_FACTOR = 1.20;
const DECAY_CAP = 0.50;
const TRIB_FACTORS = { monocacy: 0.071, gooseCreek: 0.030, broadRun: 0.0066, senecaCreek: 0.0087 };
const GF_FLOW_BINS = ['0-3000','3000-6000','6000-12000','12000-25000','25000-50000','50000+'];

// === Pure functions ===
function getFlowBin(cfs) { /* ... */ }
function getFlowState(riseRate) { /* ... */ }
function estimateLFFlowFromStage(stage) { /* ... */ }
function estimateLFStage(cfs) { /* ... */ }
function calculateTravelTime(flow) { /* ... */ }
function calculateEFWeight(flow) { /* ... */ }

module.exports = {
  TRAVEL_COEF, TRAVEL_EXP, MEDIAN_TRAVEL,
  EF_MODEL, EF_WEIGHT, SOFT_CEILING_FACTOR, DECAY_CAP,
  TRIB_FACTORS, GF_FLOW_BINS,
  getSupabase, getFlowBin, getFlowState,
  estimateLFFlowFromStage, estimateLFStage,
  calculateTravelTime, calculateEFWeight
};
```

**For `scheduled-update.js`:** Replace all local constant definitions and duplicated functions
with `require('./shared/model.js')` imports.

**For `index.html`:** This is trickier since the client can't `require()`. Two options:

**Option A (minimal change):** Keep constants in `index.html` but add a version check. At startup,
fetch `/api/sync?endpoint=model-version` and compare a hash of the client's constants against
the server's. Show a warning banner if they diverge ("App update available — please refresh").

**Option B (better, requires build step):** See Phase 3 for full modularization.

**Recommendation:** Option A first (immediate safety net), then Option B when ready.

**Files changed:** `shared/model.js`, `scheduled-update.js`, `sync-learning.js`, `index.html`

### 2.2 Batch Upsert Operations

**Status:** Listed in project TODO Phase 4. Loop of individual upserts in `sync-learning.js`.

**Fix:** Replace with single Supabase `.upsert()` call with array payload.

**Files changed:** `sync-learning.js`

---

## Phase 3: Architecture — Modularize the Monolith (Week 2-4)

This is the highest-effort change. The project's TODO.md lists it as Phase 6 "Nice-to-Have,"
but it gates: testability, CSP without `unsafe-inline`, proper constant sharing, and
independent deployability of UI vs. model logic.

### 3.1 Introduce Vite Build Step

**Trade-off acknowledged:** The project currently has zero build step — `git push origin main`
deploys directly. Introducing Vite adds a dependency but provides:
- ES module support (eliminates all SYNC WARNING duplication)
- Tree-shaking (smaller bundle)
- Dev server with HMR
- CSS extraction (cacheable)
- Path to removing `'unsafe-inline'` from CSP

**Minimal Vite config:**
```javascript
// vite.config.js
import { defineConfig } from 'vite';
export default defineConfig({
  build: { outDir: 'dist' }
});
```

Update `netlify.toml`:
```toml
[build]
  publish = "dist"
  command = "npm run build"
```

### 3.2 File Structure

```
potomac-pulse/
├── index.html                    (HTML shell only — no inline CSS/JS)
├── src/
│   ├── main.js                   (entry point)
│   ├── state.js                  (consolidated app state, replaces 40+ globals)
│   ├── config.js                 (re-exports from shared/model.js + client-only constants)
│   ├── model/
│   │   ├── great-falls.js        (estimateGreatFalls — decomposed into sub-functions)
│   │   ├── travel-time.js        (Searcy formula, wave celerity, iterative convergence)
│   │   ├── edwards-ferry.js      (EF power-law, cold-water variant, logistic weight)
│   │   ├── ceiling.js            (soft LF ceiling)
│   │   ├── por-delta.js          (PoR-delta staleness correction)
│   │   ├── uncertainty.js        (empirical CI lookup)
│   │   ├── learning.js           (correction bin application)
│   │   └── shadow-models.js      (LF Feedback, SGD, Kalman — horse race)
│   ├── data/
│   │   ├── usgs.js               (USGS fetch + parse + CORS proxy fallback)
│   │   ├── nws.js                (NWS forecast fetch)
│   │   ├── sync.js               (Supabase/Netlify API — fetchWithRetry)
│   │   └── storage.js            (localStorage wrapper with TTL + quota checks)
│   ├── ui/
│   │   ├── tabs.js               (tab system with ARIA)
│   │   ├── great-falls-ui.js     (GF estimate + forecast graph rendering)
│   │   ├── gauges.js             (All Gauges tab with branches)
│   │   ├── creek-runs.js         (Creek Runs tab)
│   │   ├── map.js                (Leaflet initialization + markers)
│   │   ├── forecast-graph.js     (SVG forecast graph — extracted from monolith)
│   │   └── admin.js              (Learning tab)
│   └── utils/
│       ├── format.js             (number/date formatting)
│       └── dom.js                (safe textContent helpers — already using textContent)
├── styles/
│   └── main.css                  (extracted from inline <style>)
├── netlify/
│   └── functions/
│       ├── scheduled-update.js   (imports from shared/model.js)
│       ├── sync-learning.js      (imports from shared/model.js)
│       └── shared/
│           └── model.js          (SINGLE SOURCE OF TRUTH — constants + pure functions)
├── tests/                        (see Phase 4)
├── vite.config.js
├── package.json
└── netlify.toml
```

**Key resolution:** `src/config.js` imports from `netlify/functions/shared/model.js` at build time.
Vite resolves this import. Netlify Functions use `require()` at runtime. Same file, zero duplication.

### 3.3 Decompose `estimateGreatFalls()`

**Status:** ~350 lines handling 8 concerns. The pipeline is well-documented in the code but
is a single function.

**Refactored to ~30 lines** calling independently testable sub-functions:

```javascript
// src/model/great-falls.js
import { getTimeShiftedPoR } from './travel-time.js';
import { aggregateTributaries } from './tributaries.js';
import { applyPoRDeltaCorrection } from './por-delta.js';
import { blendWithEdwardsFerry } from './edwards-ferry.js';
import { applyLearningCorrection } from './learning.js';
import { applySoftCeiling } from './ceiling.js';
import { getUncertaintyRange } from './uncertainty.js';
import { scoreConfidence } from './confidence.js';

export function estimateGreatFalls(gaugeData, learningData) {
  const porShifted = getTimeShiftedPoR(gaugeData.pointOfRocks, gaugeData.porHistory);
  const withTribs = aggregateTributaries(porShifted, gaugeData.tributaries);
  const deltaCorrected = applyPoRDeltaCorrection(withTribs, gaugeData.porHistory);
  const blended = blendWithEdwardsFerry(deltaCorrected, gaugeData.edwardsFerry, gaugeData.waterTempC);
  const learned = applyLearningCorrection(blended, learningData);
  const ceilinged = applySoftCeiling(learned, gaugeData.littleFalls);
  const uncertainty = getUncertaintyRange(ceilinged);
  const confidence = scoreConfidence(porShifted, gaugeData.edwardsFerry, blended, ceilinged);

  return { ...ceilinged, ...uncertainty, confidence,
           components: { porShifted, withTribs, deltaCorrected, blended, learned } };
}
```

Each sub-function mirrors an existing code block — this is a refactor, not a rewrite.

### 3.4 Consolidate Global State

**Status:** 40+ module-level variables (`porHistory`, `gfHistory`, `gfEstimate`, `shadowModelState`,
`creekData`, `edwardsFerryData`, `waterTempC`, `data`, `dataSource`, `lastFetchTime`, `isFetching`, etc.)

**Fix:** Single `appState` object in `src/state.js`:

```javascript
export const appState = {
  // Gauge data
  gauges: {},
  edwardsFerry: null,
  waterTempC: null,
  creekData: {},

  // Model outputs
  gfEstimate: null,
  shadowResults: {},

  // History
  porHistory: [],
  gfHistory: [],

  // Learning
  gfLearningData: {},

  // Fetch state
  lastFetchTime: null,
  isFetching: false,
  dataSource: null,

  // UI state
  activeTab: 'great-falls',
  mapVisible: false,
};
```

### 3.5 localStorage Wrapper with Quota Management

**Status:** Direct `localStorage.getItem/setItem` calls. PoR history has 72h TTL, GF history has
24h TTL. No quota checking.

**Fix:** Create `src/data/storage.js` with TTL enforcement and quota warning (see original plan
section 2.6 — that code still applies).

---

## Phase 4: Automated Testing (Week 3-4)

The project has zero JavaScript tests. Model validation is done via offline Python/R analysis
(thoroughly), but there are no regression tests to catch bugs introduced during code changes.

### 4.1 Test Framework Setup

**Choice:** Vitest (pairs naturally with Vite). Add to `package.json`:

```json
{
  "devDependencies": {
    "vitest": "^3.0.0"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

### 4.2 Model Unit Tests (Priority — these gate all future changes)

Test each sub-function from the decomposed `estimateGreatFalls()`:

```javascript
// tests/model/travel-time.test.js
describe('calculateTravelTime', () => {
  it('returns ~25.8 hours at median flow (4940 cfs)');
  it('is monotonically decreasing with flow');
  it('never returns negative or NaN');
  it('handles edge cases: 0, negative, Infinity');
});

describe('getTimeShiftedPoR (iterative convergence)', () => {
  it('converges within 3 iterations for typical flows');
  it('returns null when porHistory has no matching timestamp');
  it('handles sparse history gracefully');
});

// tests/model/edwards-ferry.test.js
describe('EF power-law', () => {
  it('uses cold model when waterTempC <= 10');
  it('uses default model when waterTempC > 10 or null');
  it('returns null when EF stage below minStage (2.5)');
  it('applies ±8% hysteresis for rising/falling');
});

describe('calculateEFWeight (logistic ramp)', () => {
  it('returns ~0% at low flows (<1000 cfs)');
  it('returns ~20% at 10k cfs');
  it('returns ~40% at high flows (>50k cfs)');
  it('is monotonically increasing');
});

// tests/model/rating-curve.test.js
describe('estimateLFStage', () => {
  // Test against USGS calibration points (18 breakpoints in the code)
  it('matches all 18 USGS calibration breakpoints within 0.01 ft');
  it('is monotonically increasing');
  it('handles flows below minimum breakpoint');
  it('handles flows above maximum breakpoint');
});

describe('estimateLFFlowFromStage (inverse)', () => {
  // Verify the inverse is consistent
  it('roundtrips: estimateLFStage(estimateLFFlowFromStage(stage)) ≈ stage');
});

// tests/model/great-falls.test.js (integration)
describe('estimateGreatFalls', () => {
  it('returns positive CFS for typical inputs');
  it('does not exceed 120% of Little Falls');
  it('includes uncertainty bounds (lower < cfs < upper)');
  it('returns confidence between 0 and 1');
  it('degrades gracefully when EF is unavailable');
  it('degrades gracefully when tributaries are unavailable');
  it('applies learning correction when bin data exists');
  it('skips learning correction when bin data is empty');
});

// tests/model/anomaly-detection.test.js
describe('two-tier anomaly detection', () => {
  it('hard-flags when actual CFS < 50% of stage-implied CFS');
  it('soft-flags when EF discrepancy > 25%');
  it('soft-flags when prediction error > 50%');
  it('does not flag normal observations');
  it('clamps EMA update within ±2σ for soft-flagged observations');
});
```

### 4.3 Server Function Tests

```javascript
// tests/functions/scheduled-update.test.js
describe('validatePendingPredictions', () => {
  it('skips predictions that are too old (>2.5h past validationDue)');
  it('skips predictions where water has not arrived yet');
  it('correctly identifies hard-flag ice conditions');
  it('updates correction bin with EMA alpha=0.3');
});

// tests/functions/sync-learning.test.js
describe('API routing', () => {
  it('returns 405 for unsupported methods');
  it('validates CORS origin');
  it('requires PIN for admin actions (reset, etc.)');
  it('rejects invalid POST payloads (NaN, negative CFS)');
});
```

### 4.4 Snapshot Tests for Constant Sync

Until modularization eliminates duplication, add a test that fails if constants drift:

```javascript
// tests/sync-check.test.js
import { TRAVEL_COEF, EF_MODEL } from '../netlify/functions/shared/model.js';

describe('constant synchronization', () => {
  it('server TRAVEL_COEF matches expected value', () => {
    expect(TRAVEL_COEF).toBe(4139);
  });
  it('server EF_MODEL matches expected values', () => {
    expect(EF_MODEL).toEqual({
      coef: 126, exp: 2.46,
      coldCoef: 160, coldExp: 2.36,
      coldMaxTemp: 10, minStage: 2.5, maxStage: 20.0
    });
  });
  // ... all other duplicated constants
});
```

**Target:** 80%+ coverage on `model/` and `shared/model.js` before any model changes.

---

## Phase 5: UI / UX & Accessibility (Week 3-5)

### 5.1 SEO & Social Sharing Meta Tags

**Status:** The existing `index.html` has `<meta charset>` and `<meta name="viewport">` but
no `<title>`, `<meta description>`, or Open Graph tags.

**Fix:** Add to `<head>`:
```html
<title>Potomac Pulse — Real-Time River Flow at Great Falls</title>
<meta name="description" content="Live water flow estimates for Great Falls on the Potomac River. Tracks every gauge with travel times to Little Falls.">
<meta property="og:title" content="Potomac Pulse — Real-Time River Flow">
<meta property="og:description" content="Live estimates for Great Falls. Every gauge, with travel times.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://potomac-pulse.netlify.app/">
<meta property="og:image" content="https://potomac-pulse.netlify.app/og-image.png">
```

Also add `robots.txt` and basic `sitemap.xml`.

### 5.2 ARIA Tab Pattern

**Status:** Skip link exists. Buttons have proper touch targets (44px, fixed in Phase 2). But
tabs lack `role="tablist"`, `role="tab"`, `aria-selected`, and arrow-key navigation.

**Fix:** Add WCAG tab pattern to the existing tab buttons and panels. Include `aria-live="polite"`
on the GF estimate display region for screen reader announcements of changing data.

### 5.3 Color Contrast

**Status:** Secondary text (`#94a3b8`) on card backgrounds (`#1e293b`) is approximately 4:1
contrast ratio — borderline WCAG AA.

**Fix:** Bump secondary text to `#b0bec5` (5.2:1 ratio) or lighten further. Ensure all
interactive elements meet 4.5:1 minimum.

### 5.4 Safety Disclaimer Visibility

**Status:** Disclaimer exists in the "How It Works" documentation tab. Also present in the
forecast graph area.

**Fix:** Add a persistent one-line banner in the header area (visible on all tabs):
```
⚠ Model estimates only — not for safety decisions. Always verify with USGS.
```
Styled as a subtle but always-visible amber bar. Non-dismissible.

### 5.5 CSS Cleanup

**Status:** `!important` overrides exist in mobile media queries. Font sizes mix `px` and `rem`.

**Fix:** During the CSS extraction (Phase 3), convert all font sizes to `rem`, resolve specificity
conflicts that necessitate `!important`, and adopt mobile-first breakpoint structure.

---

## Phase 6: DevOps & Monitoring (Week 4-6)

### 6.1 CI Pipeline

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run test -- --coverage
      - run: npm run build
```

### 6.2 Error Monitoring

**Status:** Listed in project TODO Phase 5. Currently `console.error` only.

**Fix:** Lightweight client-side error reporter that POSTs to `/api/sync?endpoint=errors`.
Captures `unhandledrejection` and `window.error` events with stack traces. No third-party
dependency needed — the existing Supabase infrastructure can store error logs.

Alternative: Integrate Sentry free tier if more sophisticated alerting is needed.

### 6.3 Service Worker

**Status:** `manifest.json` exists but no service worker is registered. PWA install works but
app has no offline capability.

**Fix:** Network-first strategy service worker that caches:
- The app shell (HTML, CSS, JS)
- Last known gauge readings
- Last GF estimate

Shows cached data with a "Data may be stale" banner when offline.

---

## Phase 7: Science — Future Research (When Resources Allow)

These items emerged from the review but, after reading the full audit trail, are genuinely
open research questions — not bugs or oversights. Each would require following the project's
CLAUDE.md protocol: plan → dual Python/R → independent auditor.

### 7.1 Flow-Dependent Travel Time Correction

**Status:** The 0.80 Searcy multiplier is a global constant. The `travel_time_audit.md` found
it INCONCLUSIVE — validated at high flows but noise-dominated at low flows.

**Research question:** Does the correction factor vary systematically with flow? A flow-dependent
multiplier (e.g., 0.85 at low flows, 0.75 at high flows) might better capture the Potomac's
channel geometry.

**Approach:** Event-based peak matching on discrete flood events (2011-2026) as recommended
by the travel time auditor. Requires spring runoff data collection.

### 7.2 Dynamic Soft Ceiling

**Status:** The 1.20 ceiling was validated as the best *static* choice. But it clips the signal
during rising rivers where GF genuinely leads LF.

**Research question:** Does a travel-time-dependent ceiling (e.g., higher ratio when GF-to-LF
travel time is longer) reduce rising-limb error without increasing overall RMSE?

**Approach:** Grid search on `max_ratio = f(travel_time)` parameterizations, evaluated on
the 117k hourly dataset with LOYO CV.

### 7.3 Muskingum-Cunge Flood Routing

**Status:** Listed in project TODO Phase 6. The Searcy model is empirical; Muskingum-Cunge
is physics-based routing that models wave attenuation and diffusion.

**Research question:** For flows >20k cfs, does MC routing improve on the Searcy model?

**Approach:** Major research effort (~40h per TODO estimate). Would need USGS cross-section
data for the Potomac reach.

### 7.4 Bayesian Shrinkage for Sparse Bins

**Status:** The 50k+ flow bin has few observations and wide CIs (spread of ~52,000 cfs).

**Research question:** Can Bayesian hierarchical priors (shrinking sparse bins toward the
population mean) produce tighter, better-calibrated CIs at extreme flows?

### 7.5 Per-Bin Accuracy Table in Documentation

**Status:** The documentation shows overall accuracy. Per-bin accuracy exists in the Learning
tab (admin-only) and in the audit reports, but not in the user-facing "How It Works" tab.

**Action:** Add an accuracy table to the documentation panel showing MdAPE, bias, and 90% CI
coverage probability per flow bin. The data already exists in `EMPIRICAL_CI_90`.

---

## Priority Matrix (Revised)

| Phase | Effort | Impact | Dependency | Risk if Skipped |
|-------|--------|--------|------------|-----------------|
| 1. Security | Low (1 week) | Critical | None | Data corruption, unauthorized DB access |
| 2. Deduplication | Low (1 week) | High | None | Constants drift → silent model divergence |
| 3. Modularization | High (2 weeks) | High | Phase 2 | Untestable code, CSP stuck on unsafe-inline |
| 4. Testing | Medium (2 weeks) | High | Phase 3 | No regression detection on code changes |
| 5. UI/Accessibility | Medium (1 week) | Medium | Phase 3 (CSS extraction) | Excludes users, no SEO, WCAG non-compliance |
| 6. DevOps | Medium (1 week) | Medium | Phase 4 | No CI, no error monitoring |
| 7. Science | High (ongoing) | Variable | Phase 4 (tests gate model changes) | Low — current model is well-validated |

---

## What Changed from the Original Plan

| Original Plan | Revised Plan | Why |
|---------------|-------------|-----|
| Phase 4 Science was 8 items, "Week 4-8" | Demoted to Phase 7 "Future Research" | Nearly all science criticisms were already investigated. The audit trail is thorough. |
| "Fix the soft ceiling" | "Research: dynamic ceiling" (future) | The 1.20 ceiling was validated in a 25-config grid search. |
| "Dynamic tributary contributions" | Removed | Already using real-time gauge data. Timing shift provides <1% improvement. |
| "Fix high-flow bin overfitting" | Removed | Honest uncertainty reporting, not overfitting. |
| "Proper uncertainty propagation" | Removed (with note in 7.4) | Empirical CIs capture all error sources. RSS propagation assumes independence that doesn't hold. |
| "Improve wave celerity model" | Merged into 7.1 | Valid research but requires their full verification protocol. |
| "Improve ice detection" | Removed | Two-tier flagging with hard/soft flags + EMA clamping already implemented. |
| "Replace R² with MdAPE" | Downgraded to 7.5 (add table) | Already using empirical CIs as primary metric. R² is only in docs, not the UI. |
| "Fix race conditions" | Removed | Fixed in v34.0 (server-only validation). |
| "Prevent XSS" | Removed | Fixed in Phase 1 (v24.11). innerHTML→textContent already done. |
| Phase 2 had Vite as first step | Phase 2 is now deduplication (no build step needed) | Ship the safety net first; Vite is Phase 3. |
| Admin JWT auth | Kept but softened | PIN is already server-side (v34.4). Client hash is UI gating only. JWT still valuable but lower urgency. |

---

## Success Criteria (Revised)

- [ ] CSP header in `netlify.toml` (Phase 1)
- [ ] SRI on all CDN resources (Phase 1)
- [ ] Supabase RLS enabled on all tables (Phase 1)
- [ ] Data retention policy running in cron job (Phase 1)
- [ ] All model constants defined in exactly one file (`shared/model.js`) (Phase 2)
- [ ] `scheduled-update.js` imports all constants from `shared/model.js` (Phase 2)
- [ ] Client has version-check safety net for constant drift (Phase 2)
- [ ] `index.html` split into separate HTML/CSS/JS files (Phase 3)
- [ ] `estimateGreatFalls()` is <50 lines, composed of testable sub-functions (Phase 3)
- [ ] Zero global variables; all state in `appState` object (Phase 3)
- [ ] 80%+ test coverage on model functions (Phase 4)
- [ ] Constant-sync snapshot test in CI (Phase 4)
- [ ] `<title>`, `<meta description>`, Open Graph tags present (Phase 5)
- [ ] WCAG tab pattern with arrow-key navigation (Phase 5)
- [ ] Safety disclaimer visible on all tabs (Phase 5)
- [ ] CI pipeline runs tests on every push (Phase 6)
- [ ] Client-side error reporting to Supabase (Phase 6)

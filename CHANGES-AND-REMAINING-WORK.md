# Potomac Pulse — Changes Made & Remaining Work

**Date:** 2026-02-28
**Sessions:** Adversarial review + Phase 1/2 implementation, Phase 3 Vite modularization, Phase 6 DevOps

---

## Changes Made This Session

### Phase 1: Security Hardening

| Change | File | Status |
|--------|------|--------|
| **CSP header** | `netlify.toml` | Done — `Content-Security-Policy` added with locked-down directives |
| **SRI hashes** | `index.html` | Done — `integrity` + `crossorigin` on Leaflet CSS, Leaflet JS, GoatCounter |
| **Rate limiting** | `sync-learning.js` | Done — in-memory per-IP rate limiter (60 GET/min, 10 POST/min) |
| **POST body validation** | `sync-learning.js` | Done — 10KB limit, NaN/Infinity rejection, future timestamp, negative CFS |

### Phase 2: Constant Deduplication

| Change | File | Status |
|--------|------|--------|
| **Expanded shared/model.js** | `shared/model.js` | Done — now exports all model constants and functions |
| **Removed duplicates from scheduled-update.js** | `scheduled-update.js` | Done — imports from shared/model.js |

Constants/functions moved to `shared/model.js`:
- `TRAVEL_COEF`, `TRAVEL_EXP`, `MEDIAN_TRAVEL`, `TRAVEL_POR_GF_BASELINE`, `TRAVEL_GF_LF_BASELINE`
- `EF_MODEL` object
- `getEFWeight()`, `getFlowMultiplier()`, `getFlowState()`
- `CEILING_RATIO`, `DECAY_CAP`
- `TRIB_FALLBACK` (tributary drainage-area fallback ratios)

### Phase 5 Quick Wins

| Change | File | Status |
|--------|------|--------|
| **Safety disclaimer banner** | `index.html` | Done — persistent amber banner above main content, dismissible per session, links to NWS |
| **Meta tags** | `index.html` | Already existed (title, OG tags, viewport) — no change needed |

### Phase 5 Accessibility: ARIA & Keyboard Navigation

| Change | File | Status |
|--------|------|--------|
| **Tab panels — ARIA roles** | `index.html` | Done — added `role="tabpanel"`, `aria-labelledby`, `tabindex="0"` to all 5 tab content panels; added `id` attributes to tab buttons for `aria-labelledby` references |
| **Tab switching — ARIA state** | `index.html` | Done — `activateTab()` now sets `aria-selected` and `tabindex` on all tabs when switching, not just CSS classes |
| **Keyboard arrow navigation** | `index.html` | Done — `keydown` listener on `.tabs` container: Left/Right arrows, Home/End, Enter/Space per WAI-ARIA Tabs pattern |
| **`aria-live` on gauge values** | `index.html` | Done — Little Falls `.target-vals` and Great Falls `#gf-estimate-display` wrapped with `aria-live="polite" aria-atomic="true"` so screen readers announce updates |
| **Color contrast for small text** | `index.html` | Done — replaced `#94a3b8` with `#b0bec9` (~5.5:1 on `#0f172a`) in CSS class declarations for small text: `.target-sub`, `.target-unit`, `.tab` (inactive), `.branch-arr`, `.fp-time`, branch header, `.pop-area`, `.pop-lbl`. Inline styles on larger/decorative text left unchanged |

### Phase 4: Automated Testing

| Change | File | Status |
|--------|------|--------|
| **Test script** | `package.json` | Done — `"test": "node --test 'test/**/*.test.js'"` |
| **Unit tests (46)** | `test/model.test.js` | Done — covers `getFlowBin`, `estimateLFFlowFromStage`, `getEFWeight`, `getFlowMultiplier`, `getFlowState`, and all constants |
| **Integration tests (32)** | `test/scheduled-update.test.js` | Done — covers `validateUSGSResponse`, `fetchWithTimeout`, `fetchWaterTemp`, `getPoRFromHistory`, `estimateLFStage`, `makeGFPrediction` with mocked `fetch` and `Date.now` |
| **USGS fixture** | `test/fixtures/usgs-response-valid.json` | Done — realistic 8-gauge response |
| **Test exports** | `scheduled-update.js` | Done — `exports._test` block exposes internal functions |
| **CI workflow** | `.github/workflows/test.yml` | Done — runs on push to main and PRs, Node 24 |

Framework: Node.js built-in test runner (`node:test`). Zero external test dependencies.

---

## Remaining Work

### Phase 1 (Security) — Needs Supabase Dashboard

1. **Enable Row Level Security (RLS)** on all Supabase tables
   - `gf_estimates`, `forecast_accuracy`, `gf_history`, `por_history`, `learning_corrections`
   - Write policies: only the service key (server functions) can INSERT/UPDATE
   - Read policies: allow anonymous SELECT for the API
   - This is done via Supabase Dashboard → Authentication → Policies, not code

2. **Add database constraints** via Supabase SQL editor:
   - `CHECK (estimated_cfs > 0 AND estimated_cfs < 500000)` on gf_estimates
   - `CHECK (timestamp > '2020-01-01')` on all tables
   - `NOT NULL` on critical columns

3. **Data retention policy** in `scheduled-update.js`:
   - Add cleanup query to delete records older than 90 days
   - Run as part of the 2-hour cron job
   - Approximate location: end of the `handler` function

### ~~Phase 3: Vite Modularization~~ — Done

Monolithic `index.html` (7,325 lines) split into 26 ES module files with Vite build step:

| Change | Status |
|--------|--------|
| **Vite + Leaflet npm** | Done — `vite ^7.3.1`, `leaflet ^1.9.4` installed |
| **CSS extraction** | Done — `src/styles/main.css` (~555 lines) |
| **JS modularization** | Done — 26 files across `src/{model,state,data,estimation,learning,ui}/` |
| **Static assets** | Done — moved to `public/` (manifest.json, icons) |
| **onclick migration** | Done — all inline handlers replaced with addEventListener + event delegation |
| **Netlify build** | Done — publishes from `dist/`, `npm run build` |
| **CSP hardened** | Done — removed `'unsafe-inline'` from script-src, removed `https://unpkg.com` |
| **index.html** | Done — stripped to ~650 lines (HTML only) |

Key architecture decisions:
- Central state store (`src/state/store.js`) with exported let + setter functions
- Lazy callback registration to break circular dependencies
- Client-side ESM copy of shared model (not Vite alias, to avoid bundling Supabase)
- No `"type": "module"` in package.json — server code stays CJS

### Shadow Model Leaderboard (v35.0)

| Change | File | Status |
|--------|------|--------|
| **Fix shadow prediction storage** | `sync-learning.js` | Done — `shadowModels` field now persisted in Supabase |
| **Server-side scoring function** | `scheduled-update.js` | Done — `scoreShadowPredictions()` pure function scores 4 models per validation |
| **Wire scoring into validation** | `scheduled-update.js` | Done — called after non-hard-flagged validation, wrapped in try/catch |
| **Return leaderboard in GET** | `sync-learning.js` | Done — `shadowLeaderboard` field in GF endpoint response |
| **Admin reset integration** | `sync-learning.js` | Done — both `resetGFLearning` and `resetLowFlowBins` delete leaderboard |
| **Client state** | `store.js`, `gf-learning.js` | Done — `shadowLeaderboard` state + setter, loaded on GF data fetch |
| **Leaderboard UI** | `learning-ui.js`, `index.html` | Done — ranked table with avg error %, count, streaks, last winner |
| **Tests** | `scheduled-update.test.js` | Done — 6 tests for `scoreShadowPredictions` (84 total) |

Per-model metrics: count, sumAbsErrorPercent, meanAbsErrorPercent, currentStreak, bestStreak. Leaderboard starts empty and populates over 1-2 days as new predictions (with `shadowModels`) are stored and validated.

### ~~Phase 4: Automated Testing~~ — Done

Implemented with 84 tests (46 unit + 38 integration) using Node.js built-in test runner. CI via GitHub Actions. See "Changes Made" section above.

### Phase 5: Accessibility & UI (Remaining Items)

1. ~~**ARIA tab pattern**~~ — Done (tab panels have `role="tabpanel"`, tabs already had `role="tab"`, JS now updates `aria-selected`/`tabindex`, keyboard navigation added)
2. ~~**`aria-live` regions**~~ — Done (Little Falls and Great Falls gauge displays)
3. ~~**Color contrast**~~ — Done (small-text CSS classes bumped from `#94a3b8` to `#b0bec9` for ~5.5:1 ratio). Inline styles on larger text still use `#94a3b8` — acceptable at those sizes.
4. ~~**Font units**~~ — Done (converted `14px` → `0.875rem` in `.leaflet-popup-content`; moved inline `font-size:0.5rem` from JS/HTML to CSS classes `.fp-source`/`.fp-subtime`/`#forecast-accuracy`)
5. ~~**Remove `!important` overrides**~~ — Done (removed all 6 `!important` from media queries; moved `#gf-forecast-periods` inline grid style to CSS rule so source order handles specificity; deleted dead `[style*=]` selectors)

### ~~Phase 6: DevOps~~ — Code Done (Activation Pending)

| Change | File | Status |
|--------|------|--------|
| **Sentry client-side error monitoring** | `src/monitoring/sentry.js`, `src/main.js` | Done — init module with placeholder DSN, `captureException` on init failure |
| **CSP update for Sentry** | `netlify.toml` | Done — added `https://*.ingest.sentry.io` to `connect-src` |
| **Cron heartbeat ping** | `netlify/functions/scheduled-update.js` | Done — success/fail pings to healthchecks.io, guarded by env var |
| **CI workflow** | `.github/workflows/test.yml` | Done (Phase 4) — runs tests on push to main and PRs |

**Activation required by you (no code changes):**

| Service | Steps | Time |
|---------|-------|------|
| **Sentry** | 1. Create free account at sentry.io 2. Create a Browser JavaScript project 3. Copy the DSN string 4. Paste into `src/monitoring/sentry.js` line 5 5. Commit & push | ~5 min |
| **UptimeRobot** | 1. Create free account at uptimerobot.com 2. Add monitor → HTTP(s) → your site URL 3. Set alert contact to your email | ~3 min |
| **Healthchecks.io** | 1. Create free account at healthchecks.io 2. Create a check: period = 2 hours, grace = 1 hour 3. Copy the ping URL 4. In Netlify dashboard → Site settings → Environment variables → add `HEALTHCHECKS_PING_URL` = the ping URL | ~5 min |

### Phase 7: Science Research (Deferred)

These require the CLAUDE.md verification protocol (dual Python/R analysis + auditor):

1. **Muskingum-Cunge routing**: Replace heuristic travel-time model with physics-based routing
2. **NWS forecast integration**: Blend NWS ensemble forecasts for 6-24hr predictions
3. **Backwater detection**: Identify when downstream conditions affect upstream readings
4. **High-flow bin analysis**: Investigate whether the 50k+ bin CI can be narrowed with more data

---

## Notes

- **Client-side model is a separate ESM copy** at `src/model/shared-model.js`. It mirrors the pure math from `netlify/functions/shared/model.js` but does NOT import the server version (which would pull in Supabase). SYNC WARNING comments remain — update both files together.
- **Rate limiting is in-memory** — each Netlify function invocation may get a fresh instance, so it's a lightweight layer, not a hard guarantee. RLS (Phase 1 remaining) is the real protection.
- **Leaflet is now npm-bundled** — no CDN, no SRI hashes needed for it. GoatCounter still loads from CDN with SRI hash.
- **SRI hash for GoatCounter** is pinned to count.js. If updated, regenerate with: `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`

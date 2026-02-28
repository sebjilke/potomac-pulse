# Potomac Pulse — Changes Made & Remaining Work

**Date:** 2026-02-27
**Session:** Adversarial review + Phase 1/2 implementation

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

### Phase 3: Vite Modularization (Major Refactor)

This is the biggest remaining change — splitting the monolithic `index.html` into ES modules with a Vite build step.

1. **Initialize Vite project**: `npm create vite@latest` with vanilla JS template
2. **Extract CSS** from `<style>` block (~585 lines) into `src/styles/main.css`
3. **Extract JavaScript** into modules:
   - `src/model/constants.js` — client-side copy of shared model constants
   - `src/model/estimate.js` — `estimateGreatFalls()` broken into smaller functions
   - `src/data/usgs.js` — USGS fetch + CORS proxy logic
   - `src/data/supabase.js` — Supabase client + learning system
   - `src/ui/gauges.js` — gauge card rendering
   - `src/ui/charts.js` — Leaflet map + hydrograph
   - `src/ui/tabs.js` — tab navigation + ARIA
   - `src/ui/admin.js` — admin panel
4. **Update `netlify.toml`** build command to `npm run build`, publish to `dist/`
5. **Update CSP** to remove `'unsafe-inline'` for scripts (Vite handles this)

**Risk:** This touches every line of the frontend. Must be done carefully with before/after visual testing.

### Phase 4: Automated Testing

1. **Unit tests** for `shared/model.js`:
   - `getFlowBin()` — boundary values
   - `getFlowState()` — rising/falling/steady thresholds
   - `getEFWeight()` — logistic curve values at key flows
   - `getFlowMultiplier()` — travel time scaling
   - `estimateLFFlowFromStage()` — piecewise interpolation
2. **Integration tests** for `scheduled-update.js`:
   - Mock USGS API responses → verify GF prediction output
   - Mock Supabase → verify data storage
3. **Test framework**: Vitest (pairs with Vite) or plain Node test runner
4. **CI**: GitHub Actions workflow to run tests on PR

### Phase 5: Accessibility & UI (Remaining Items)

1. ~~**ARIA tab pattern**~~ — Done (tab panels have `role="tabpanel"`, tabs already had `role="tab"`, JS now updates `aria-selected`/`tabindex`, keyboard navigation added)
2. ~~**`aria-live` regions**~~ — Done (Little Falls and Great Falls gauge displays)
3. ~~**Color contrast**~~ — Done (small-text CSS classes bumped from `#94a3b8` to `#b0bec9` for ~5.5:1 ratio). Inline styles on larger text still use `#94a3b8` — acceptable at those sizes.
4. **Font units**: Convert `px` font sizes to `rem`/`em` for browser zoom accessibility
5. **Remove `!important` overrides** in media queries — refactor responsive CSS

### Phase 6: DevOps

1. **GitHub Actions CI/CD**: Lint + test on push, deploy preview on PR
2. **Sentry or similar**: Error tracking for production JS errors
3. **Uptime monitoring**: Alert if the Netlify function or USGS API is down
4. **Scheduled function monitoring**: Verify the 2-hour cron actually runs

### Phase 7: Science Research (Deferred)

These require the CLAUDE.md verification protocol (dual Python/R analysis + auditor):

1. **Muskingum-Cunge routing**: Replace heuristic travel-time model with physics-based routing
2. **NWS forecast integration**: Blend NWS ensemble forecasts for 6-24hr predictions
3. **Backwater detection**: Identify when downstream conditions affect upstream readings
4. **High-flow bin analysis**: Investigate whether the 50k+ bin CI can be narrowed with more data

---

## Notes

- **Client-side `index.html` still has its own copies** of all model constants and functions. These cannot be deduplicated until Phase 3 (Vite) because the frontend has no module import system currently. The SYNC WARNING comments remain.
- **Rate limiting is in-memory** — each Netlify function invocation may get a fresh instance, so it's a lightweight layer, not a hard guarantee. RLS (Phase 1 remaining) is the real protection.
- **SRI hashes will break if CDN resources update**. The hashes are pinned to specific versions (Leaflet 1.9.4, GoatCounter count.js). If these are updated, regenerate with: `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`

# Plan — Tier 4 #19: Service worker / offline cache (v37.10)

**Date:** 2026-06-23
**Approach (user-chosen):** `vite-plugin-pwa` (Workbox `generateSW`), `registerType: 'autoUpdate'`. User explicitly approved the one new devDependency.
**Protocol:** Code-Change Verification (build + client runtime change). Plan → independent audit → implement → build-verify + fresh-subagent verify. SW runtime behavior is in-browser-only → stated as a manual gap.
**Version:** MINOR → **v37.10** (client feature; no estimate/learning/accuracy change).

## Goal

Cache last-known state so a **returning** user can open the app offline and see the most-recent
gauges + Great Falls estimate + forecast they previously loaded. The app already ships
`public/manifest.json` (linked in `index.html`) but has **no service worker** today.

## Data-flow buckets (what to cache, and how)

1. **Same-origin build assets** (Vite-hashed `assets/*.js`/`*.css`, `index.html`, `public/` geojson +
   icons): **precache** via Workbox's generated manifest (solves the hashed-filename problem — the
   reason hand-rolling was rejected).
2. **Same-origin Netlify functions** (`/.netlify/functions/sync-learning?endpoint=gf|gf-history|
   por-history|forecast-accuracy|validation-history|audit-log|validation-failures`): **StaleWhileRevalidate**
   (show last-known instantly, refresh in background).
3. **Cross-origin data** — USGS via CORS proxies (`api.allorigins.win`, `corsproxy.io`,
   `waterservices.usgs.gov`) and NWS (`api.water.noaa.gov`): **StaleWhileRevalidate**, bounded by an
   expiration cap (storage hygiene).
4. **Map tiles** (`server.arcgisonline.com`): **NOT cached** — heavy, would blow the cache quota.
   Offline base-map is out of scope; the gauge/forecast data is the deliverable. Flagged explicitly.
5. **Analytics/Sentry** (goatcounter, sentry ingest): not matched → never cached (runtime caching is opt-in).

## Files changed

### 1. `package.json` — add `vite-plugin-pwa@^1.3.0` (devDependency)
`npm install -D vite-plugin-pwa`. Peer `vite ^7` satisfied by the project's `^7.3.1`. Pulls in
`workbox-build`/`workbox-window`. (`@vite-pwa/assets-generator` is an *optional* peer — not installed;
icons already exist.)

### 2. `vite.config.js` — add the VitePWA plugin
```js
import { VitePWA } from 'vite-plugin-pwa';
// ...
plugins: [
  VitePWA({
    registerType: 'autoUpdate',
    injectRegister: null,          // we register manually in main.js (prod-only)
    manifest: false,               // keep the existing public/manifest.json + its <link> (no double manifest)
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico,json,geojson}'],
      cleanupOutdatedCaches: true, // drop prior-build precaches → no stale code after deploy
      clientsClaim: true,
      skipWaiting: true,           // with autoUpdate: new SW activates + claims immediately
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/\.netlify\//],  // never serve the SPA shell for function calls
      runtimeCaching: [
        { urlPattern: /\/\.netlify\/functions\/sync-learning/, handler: 'StaleWhileRevalidate',
          options: { cacheName: 'pp-api', expiration: { maxEntries: 32, maxAgeSeconds: 86400 },
                     cacheableResponse: { statuses: [0, 200] } } },
        { urlPattern: ({url}) => /allorigins\.win|corsproxy\.io|waterservices\.usgs\.gov|api\.water\.noaa\.gov/.test(url.href),
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'pp-data', expiration: { maxEntries: 32, maxAgeSeconds: 21600 },
                     cacheableResponse: { statuses: [0, 200] } } },
      ],
    },
    devOptions: { enabled: false },  // no SW in `vite dev` → no HMR interference
  }),
],
```
- **Stale-code footgun mitigation:** `autoUpdate` + `skipWaiting` + `clientsClaim` +
  `cleanupOutdatedCaches`. Each deploy ⇒ new revisioned precache ⇒ old caches purged on activate ⇒
  next navigation serves fresh code. (One-navigation lag is acceptable.)

### 3. `src/main.js` — register the SW, prod-only
```js
if (import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {});   // registration must never break app boot
}
```
Dynamic import + `PROD` guard so dev boot is untouched and a registration failure is non-fatal.

### 4. Offline indicator — `src/ui/offline-banner.js` (new) + `index.html` + `init.js`
- `index.html`: one hidden element inside `#app` — `<div id="offlineBanner" hidden role="status">📡 Offline — showing last-known data</div>`.
- `src/ui/offline-banner.js`: `initOfflineBanner()` toggles `#offlineBanner` `hidden` on `window`
  `'offline'`/`'online'` events and on the bus `data:unavailable` (show) / `data:updated` (hide).
  Exports a **pure** `shouldShowOffline(isOnline, lastFetchFailed)` so the toggle logic is unit-testable
  without a DOM. Set initial state from `navigator.onLine`.
- `src/init.js`: `import { initOfflineBanner }` and call it once during init (alongside the existing
  bus wiring). No change to render/estimate logic.

### 5. Test — `test/offline-banner.test.js` (new, CJS/node:test)
Unit-test the pure `shouldShowOffline(isOnline, lastFetchFailed)` truth table (online+ok → hide;
offline → show; online+failed-fetch → show). The SW/Workbox config and DOM toggling are **not**
node-testable (no SW/DOM env) — covered by the build check + the in-browser manual gap. Honest about this.

## Verification path

- **Automatable now:** `npm run build` succeeds and emits `dist/sw.js` + `dist/workbox-*.js` + a
  precache manifest that includes the hashed `assets/*` and the geojson. `npm test` stays green
  (+ the banner-logic test). A **fresh subagent** audits the config (autoUpdate/cleanup/denylist/dev-disabled,
  runtime patterns, tiles excluded, manifest:false) and the build output, goal+diff only.
- **Manual / in-browser (UNVERIFIED GAP — needs a human or Chrome devtools):**
  1. `npm run preview` → DevTools ▸ Application ▸ Service Workers: registered + activated.
  2. Cache Storage shows the precache + `pp-api`/`pp-data` entries after a normal load.
  3. DevTools ▸ Network ▸ Offline → reload → app still renders with last-known gauges/forecast; the
     `#offlineBanner` shows.
  4. **Post-deploy cache-bust:** after the next deploy, a normal reload serves the new JS (no stale
     bundle) — the highest-risk property; confirm explicitly.

## Side effects / risks

- **Stale app code after deploy** — mitigated (see §2). The single most important thing to confirm in-browser (step 4).
- **First post-install load** does a background precache fetch burst (one-time; ~600KB: bundle + CSS + geojson).
- **Cross-origin/opaque responses** cached under `pp-data` are bounded (`maxEntries: 32`, 6h TTL) so storage can't grow unbounded.
- **iOS Safari**: SW supported (11.3+) but standalone-PWA caches can be evicted under storage pressure — known platform limitation, not a regression.
- **No behavior change** to the model, learning, accuracy, or any existing fetch path — the SW sits transparently below `fetch()`; runtime caching is opt-in by pattern.

## Out of scope (flagged, not done)

- Precaching map tiles / offline base map (quota).
- Background Sync, Push, or an install-prompt / "new version available" UI (`autoUpdate` updates silently).
- Replaying queued writes offline (the client is server-sole-writer; it doesn't POST predictions).

## Independent audit — engagement (2026-06-23)

Auditor verdict: core SW strategy sound + Vite-7-compatible. 4 MUST-FIX, 4 should-fix. Disposition:

1. **CSP (`netlify.toml`) — ACCEPTED, no code change.** Confirmed: `connect-src` already lists
   waterservices.usgs.gov, api.water.noaa.gov, corsproxy.io, api.allorigins.win, *.supabase.co,
   goatcounter, *.ingest.sentry.io; `script-src 'self'` (worker-src absent → falls back to script-src)
   permits the same-origin `/sw.js`; precache is same-origin (`'self'`). So registration + precache +
   runtime fetches all pass the existing CSP. **No netlify.toml edit.** Added a CSP-console-error check
   to the in-browser verification.
2. **No top-level DOM in the offline module — ACCEPTED.** `offline-banner.js` accesses
   `window`/`navigator`/`document` ONLY inside `initOfflineBanner()`; the exported `shouldShowOffline()`
   is pure, so `npm test` (Node, gates the Netlify build) imports it without a DOM.
3. **`audit-log`/`validation-failures` public reads — CONFIRMED.** All `sync-learning` GET handlers are
   unauthenticated (PIN gates POST only). Caching them under `pp-api` is safe (per-browser cache, public
   reads). Broad `sync-learning` pattern kept.
4. **Doc/version updates — ACCEPTED.** v37.9 → v37.10 across title/CLAUDE/README/tech-appendix/CHANGELOG (impl step).

Should-fix:
- **Double-banner overlap — RESOLVED by redesign.** The existing `#error-banner`/`setStatus` fires on
  *fetch failure*; but with the SW serving USGS from cache, an offline fetch SUCCEEDS, so that banner
  won't fire and stale data would read as "live." The new indicator is therefore driven by
  **`navigator.onLine` + window `online`/`offline`** (a different signal) — complementary, not duplicate.
  It fixes a clarity wart the SW itself introduces. Documented; kept minimal (`#offlineBar`, distinct
  from `#error-banner`).
- **navigateFallbackDenylist — kept as harmless safety**; corrected reasoning (nav fallback is
  same-origin-navigation-only, so cross-origin/sourcemap/function calls were never at risk).
- **Sourcemap warning is cosmetic** — `.map` excluded from `globPatterns`; the verification subagent is
  told not to treat a Workbox sourcemap warning as failure.
- **No-stale-chunk guarantee depends on the app staying free of lazy `import()` of feature code** —
  noted; the only dynamic import is the added prod-only `virtual:pwa-register`.

No findings rejected.

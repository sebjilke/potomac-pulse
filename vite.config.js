import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true, // ship source maps so Sentry stack traces map to source
  },
  plugins: [
    // v37.10 (#19): offline service worker. generateSW + autoUpdate so each deploy fully busts the
    // precache (skipWaiting + clientsClaim + cleanupOutdatedCaches) — no stale app code. The existing
    // public/manifest.json + its <link> are kept (manifest: false). devOptions disabled → no SW in
    // `vite dev` (no HMR interference). Registration is manual + prod-only (see src/main.js).
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,   // we register manually in main.js, prod-only
      manifest: false,        // keep the existing public/manifest.json (no duplicate)
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json,geojson}'], // precache build assets (.map excluded)
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/\.netlify\//], // never serve the SPA shell for function calls
        runtimeCaching: [
          {
            // Same-origin learning/forecast endpoints — show last-known instantly, refresh in background.
            // All sync-learning GETs are unauthenticated public reads (PIN gates POST only).
            urlPattern: /\/\.netlify\/functions\/sync-learning/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'pp-api',
              expiration: { maxEntries: 32, maxAgeSeconds: 86400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Cross-origin live data: USGS (via CORS proxies) + NWS. Bounded TTL/entries for storage hygiene.
            // Map tiles (arcgisonline) are intentionally NOT matched — too heavy for the cache quota.
            urlPattern: ({ url }) =>
              /allorigins\.win|corsproxy\.io|waterservices\.usgs\.gov|api\.water\.noaa\.gov/.test(url.href),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'pp-data',
              expiration: { maxEntries: 32, maxAgeSeconds: 21600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});

import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { runtimeCaching } from './config/runtime-caching.mjs';

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
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'], // precache build assets (.map excluded)
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/\.netlify\//, /^\/robots\.txt$/, /^\/sitemap\.xml$/], // never serve the SPA shell for function calls or the crawler files
        // River data is network-first (v39.1); see config/runtime-caching.mjs.
        runtimeCaching,
      },
      devOptions: { enabled: false },
    }),
  ],
});

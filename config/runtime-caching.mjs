// Workbox runtime caching routes (v39.1, audit finding 5 / TODO A1).
//
// Imported by vite.config.js. Workbox generateSW serialises each urlPattern function with
// toString(), so every predicate below must be self-contained: inline checks only, no imported
// helpers and no closure over module variables. test/sw-runtime-caching.test.mjs rebuilds each
// predicate in isolation to catch a violation.
//
// River data is NetworkFirst, not StaleWhileRevalidate. The cache is only a fallback when the
// network fails or the response HEADERS take longer than networkTimeoutSeconds. The SW timeout
// must fire before the page's own timer or the page gives up first and never sees the fallback:
//   main call  : page timer 10 s (src/data/fetch.js fetchUSGS direct call)  -> SW 8 s
//   everything else: page timer 5 s (proxies, creeks, Edwards Ferry, temp)   -> SW 4 s
// Measured TTFB of the main call is about 1 s (3 runs, 0.93 to 1.02 s) with a 2.9 MB body.
//
// fetchOptions.cache = 'no-cache': USGS sends Cache-Control max-age=900 and no validators, so
// without it the browser HTTP cache can answer the "network" request with a body up to 15 min old.

export const runtimeCaching = [
  {
    // Same-origin learning/forecast endpoints: show last-known instantly, refresh in background.
    // All sync-learning GETs are unauthenticated public reads (PIN gates POST only).
    // Only two admin-panel reads use this route; no displayed river number depends on it.
    // NOTE: the client's main learning reads use /api/sync (a Netlify rewrite) and are NOT matched
    // here. If this pattern is ever widened to /api/sync, it MUST become NetworkFirst, because
    // stale-while-revalidate would then show an old learned correction.
    urlPattern: /\/\.netlify\/functions\/sync-learning/,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'pp-api',
      expiration: { maxEntries: 32, maxAgeSeconds: 86400 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
  {
    // Main multi-site USGS call (direct URL only; proxy URLs carry it URL-encoded and do not match).
    // Own cache name so the 2.9 MB entry cannot be evicted by NWS URL variants in pp-data.
    // Listed before the general route so it wins.
    urlPattern: ({ url }) =>
      url.hostname === 'waterservices.usgs.gov' &&
      url.search.indexOf('period=P7D') !== -1 &&
      url.search.indexOf('parameterCd=00060,00065') !== -1,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'pp-data-main',
      networkTimeoutSeconds: 8,
      fetchOptions: { cache: 'no-cache' },
      expiration: { maxEntries: 4, maxAgeSeconds: 21600 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
  {
    // All other cross-origin live data: USGS via CORS proxies, creeks, Edwards Ferry, water temp, NWS.
    urlPattern: ({ url }) =>
      /allorigins\.win|corsproxy\.io|waterservices\.usgs\.gov|api\.water\.noaa\.gov/.test(url.href),
    handler: 'NetworkFirst',
    options: {
      cacheName: 'pp-data',
      networkTimeoutSeconds: 4,
      fetchOptions: { cache: 'no-cache' },
      expiration: { maxEntries: 32, maxAgeSeconds: 21600 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
];

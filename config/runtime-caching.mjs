// Workbox runtime caching routes (v39.1, audit finding 5 / TODO A1).
//
// Imported by vite.config.js. Workbox generateSW serialises each urlPattern function with
// toString(), so every predicate below must be self-contained: inline checks only, no imported
// helpers and no closure over module variables. test/sw-runtime-caching.test.mjs rebuilds each
// predicate in isolation to catch a violation.
//
// River data is NetworkFirst, not StaleWhileRevalidate. The cache is only a fallback when the
// network fails or the response HEADERS take longer than networkTimeoutSeconds. The SW timeout
// must fire before the page's own timer or the page gives up first and never sees the fallback.
// v39.13 numbers (src/data/usgs-source.js PAGE_TIMERS; function caps in netlify/functions/shared/usgs-sets.js):
//   /api/usgs?set=main : function cap 5 s    -> SW 7 s -> page 8 s
//   other sets         : function cap 3.5 s  -> SW 6 s -> page 7 s
//   NWS (not USGS)     : no function         -> SW 4 s -> page 5 s (nws.js)
// (cap + 1.5 s of function overhead and transit must fit strictly inside the SW timeout, which is strictly below the page timer; test/sw-runtime-caching.test.mjs.)
// The direct calls to USGS's new service (api.waterdata.usgs.gov) have NO route here (ruling 8): the
// browser's own saved copy (localStorage) is the fallback for them, so no 11.8 MB body is cached twice.
//
// fetchOptions.cache = 'no-cache': without it the browser HTTP cache could answer the "network"
// request with an old body. The function also sends Cache-Control max-age=0.

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
    // Main multi-site USGS set from our own function. Own cache name so the 2.7 MB entry cannot be
    // evicted by NWS URL variants in pp-data. Listed before the general route so it wins.
    urlPattern: ({ url }) =>
      url.pathname === '/api/usgs' &&
      url.search.indexOf('set=main') !== -1,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'pp-data-main',
      networkTimeoutSeconds: 7,
      fetchOptions: { cache: 'no-cache' },
      expiration: { maxEntries: 2, maxAgeSeconds: 21600 },
      cacheableResponse: { statuses: [200] },
    },
  },
  {
    // The other /api/usgs sets (creeks, ef, temp).
    urlPattern: ({ url }) => url.pathname === '/api/usgs',
    handler: 'NetworkFirst',
    options: {
      cacheName: 'pp-data',
      networkTimeoutSeconds: 6,
      fetchOptions: { cache: 'no-cache' },
      expiration: { maxEntries: 32, maxAgeSeconds: 21600 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
  {
    // NWS forecasts (page timer 5 s in nws.js, so the route waits 4 s as before v39.13).
    urlPattern: ({ url }) => /api\.water\.noaa\.gov/.test(url.href),
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

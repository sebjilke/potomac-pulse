// Potomac Pulse - the four named USGS requests behind /api/usgs (v39.12, server only).
//
// Pure data, no network, no environment access. The app asks for a set by name; it can never ask for
// a free-form address, so the function cannot be used to spend the key on other requests.
// A test compares these tables with src/model/constants.js (GAUGES, CREEK_RUNS, EDWARDS_FERRY.id), so a
// gauge added to the app cannot be missed here.
// Plan: analysis/usgs-step2-app-plan-2026-11-17.md (sections 2 and the rulings).

// How long Netlify may hand the same answer to every visitor, in seconds.
// Owner's decision, 2026-11-17: keep 120 / 30 / 60 / 60 / 300.
//   okSeconds             a good answer is shared this long before USGS is asked again
//   okGraceSeconds         after that, the old answer may still be served this long while a fresh one is fetched
//   errorSeconds           a failure answer (USGS down or slow) is shared this long
//   rateLimitedMin/Max     when USGS says "too many requests", wait at least / at most this long
// Bounds enforced by test/usgs-proxy.test.mjs: okSeconds >= 30, errorSeconds >= 30,
// okSeconds + okGraceSeconds <= 300 (the app calls an answer a "saved copy" once it is 10 minutes old).
const CACHE_POLICY = { okSeconds: 120, okGraceSeconds: 30, errorSeconds: 60, rateLimitedMinSeconds: 60, rateLimitedMaxSeconds: 300 };

const MAIN_SITES = [
    '01646500', '01638500', '01618000', '01613000', '01610000', '01603000', '01595500', '01608500',
    '01606500', '01604500', '01636500', '01631000', '01643000', '01644000', '01644280', '01645000',
    '01611500', '01614500', '01619500'
];
const CREEK_SITES = ['01648010', '01650500', '01646000', '01650800'];
const EF_SITE = '01644148';
const TEMP_SITE = '01638500';

// capMs: the time cap for the upstream request plus its body read. `main` is fetched as one upstream
// call per parameter (ruling 5: 19 gauges x 2 parameters x 7 days is 72% of the 50,000 row limit).
const SETS = Object.freeze({
    main:   Object.freeze({ sites: Object.freeze(MAIN_SITES), params: Object.freeze(['00060', '00065']), period: 'P7D', capMs: 5000 }),
    creeks: Object.freeze({ sites: Object.freeze(CREEK_SITES), params: Object.freeze(['00060']), period: 'P1D', capMs: 3500 }),
    ef:     Object.freeze({ sites: Object.freeze([EF_SITE]), params: Object.freeze(['00065']), period: 'P1D', capMs: 3500 }),
    temp:   Object.freeze({ sites: Object.freeze([TEMP_SITE]), params: Object.freeze(['00010']), period: 'P1D', capMs: 3500 })
});

module.exports = { SETS, CACHE_POLICY };

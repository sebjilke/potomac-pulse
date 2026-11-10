// v39.1 (audit finding 5 / TODO A1): pins the Workbox strategy for live river data.
// Config level (always runs) and built dist/sw.js level (runs only when SW_DIST_TEST=1).
// The built-worker test is opt-in because a dist/ left over from an earlier build is not evidence about
// this commit: Netlify reuses its working folder between builds, so `npm test` there (which runs BEFORE
// `npm run build`) would inspect the previous deploy's worker. That failed the first v39.1 deploy.
// GitHub Actions runs it right after a build (see .github/workflows/test.yml); locally use
// `npm run build && SW_DIST_TEST=1 node --test test/sw-runtime-caching.test.mjs`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runtimeCaching } from '../config/runtime-caching.mjs';
import { GAUGES, CREEK_RUNS, EDWARDS_FERRY } from '../src/model/constants.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Generated SW code serialises urlPattern with toString(); rebuild each predicate in isolation so a
// closure or imported helper (which would be a ReferenceError in the SW) fails here.
const isolated = runtimeCaching.map((r) => {
    if (typeof r.urlPattern === 'function') {
        const fn = new Function('return (' + String(r.urlPattern) + ')')();
        return { route: r, match: (href) => fn({ url: new URL(href) }) };
    }
    return { route: r, match: (href) => r.urlPattern.test(new URL(href).href) };
});
const first = (href) => isolated.find((x) => x.match(href))?.route;

// Request URLs built from the same constants and templates the app code uses
// (src/data/fetch.js fetchData / fetchCreekData, src/estimation/edwards-ferry.js).
const USGS = 'https://waterservices.usgs.gov/nwis/iv/';
const MAIN = `${USGS}?sites=${Object.keys(GAUGES).join(',')}&parameterCd=00060,00065&period=P7D&format=json`;
const GENERAL = [
    `${USGS}?sites=${Object.keys(CREEK_RUNS).join(',')}&parameterCd=00060&period=P1D&format=json`,
    `${USGS}?sites=${EDWARDS_FERRY.id}&parameterCd=00065&period=P1D&format=json`,
    `${USGS}?sites=01638500&parameterCd=00010&period=P1D&format=json`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(MAIN)}`,
    `https://corsproxy.io/?${encodeURIComponent(MAIN)}`,
    `https://corsproxy.io/?${encodeURIComponent(`${USGS}?sites=1&period=P1D`)}`,
    'https://api.water.noaa.gov/nwps/v1/gauges/LTLM2/stageflow/forecast',
];
const SYNC = 'https://potomacpulse.example/.netlify/functions/sync-learning?action=x';

describe('runtime caching config (river data is network-first)', () => {
    it('1. vite.config.js imports the routes and has no inline urlPattern', () => {
        const v = readFileSync(resolve(root, 'vite.config.js'), 'utf8');
        assert.match(v, /import \{ runtimeCaching \} from '\.\/config\/runtime-caching\.mjs'/);
        assert.doesNotMatch(v, /urlPattern/);
        assert.match(v, /runtimeCaching,/);
    });

    it('2. predicates are self-contained (rebuilt in isolation without throwing)', () => {
        for (const r of runtimeCaching) {
            if (typeof r.urlPattern === 'function') {
                const fn = new Function('return (' + String(r.urlPattern) + ')')();
                assert.doesNotThrow(() => fn({ url: new URL(MAIN) }));
            }
        }
    });

    it('3. the main P7D call hits the main route; everything else river-side hits the general route', () => {
        const m = first(MAIN);
        assert.equal(m.handler, 'NetworkFirst');
        assert.equal(m.options.cacheName, 'pp-data-main');
        assert.equal(m.options.networkTimeoutSeconds, 8);
        for (const u of GENERAL) {
            const g = first(u);
            assert.ok(g, u);
            assert.equal(g.handler, 'NetworkFirst', u);
            assert.equal(g.options.cacheName, 'pp-data', u);
            assert.equal(g.options.networkTimeoutSeconds, 4, u);
        }
    });

    it('4. SW timeouts stay below the page timers', () => {
        // Page timers: main direct call 10 s (fetch.js fetchUSGS), every other river call 5 s
        // (proxies, creeks, Edwards Ferry, water temp). Measured TTFB of the main call is about 1 s
        // (0.93 to 1.02 s) with a 2.9 MB body. If the SW waits longer than the page, the page gives up first.
        assert.ok(first(MAIN).options.networkTimeoutSeconds < 10);
        assert.ok(first(GENERAL[0]).options.networkTimeoutSeconds < 5);
    });

    it('5. both river routes bypass the browser HTTP cache', () => {
        assert.equal(first(MAIN).options.fetchOptions.cache, 'no-cache');
        assert.equal(first(GENERAL[0]).options.fetchOptions.cache, 'no-cache');
    });

    it('6. map tiles and /api/sync match no route', () => {
        assert.equal(first('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/10/10'), undefined);
        assert.equal(first('https://potomacpulse.example/api/sync?action=load'), undefined);
    });

    it('7. pp-api stays stale-while-revalidate on sync-learning only (scope pin)', () => {
        const r = first(SYNC);
        assert.equal(r.handler, 'StaleWhileRevalidate');
        assert.equal(r.options.cacheName, 'pp-api');
    });
});

describe('built dist/sw.js', () => {
    // Evaluates the built worker against a stub Workbox and records every registered route, so the
    // minified matchers and handlers are exercised exactly as the browser would run them.
    const loadRoutes = (code) => {
        const routes = [];
        class Strat { constructor(o) { this.o = o; this.kind = this.constructor.name; } }
        const wb = {
            clientsClaim() {}, precacheAndRoute() {}, cleanupOutdatedCaches() {},
            NavigationRoute: class {}, createHandlerBoundToURL() {},
            registerRoute(m, h, meth) { routes.push({ m, h, meth }); },
            StaleWhileRevalidate: class StaleWhileRevalidate extends Strat {},
            NetworkFirst: class NetworkFirst extends Strat {},
            ExpirationPlugin: class { constructor(o) { this.o = o; } },
            CacheableResponsePlugin: class { constructor(o) { this.o = o; } },
        };
        const tail = code.slice(code.lastIndexOf('define(['));
        new Function('define', 'self', tail)((deps, f) => f(wb), { skipWaiting() {} });
        return routes;
    };
    const routeFor = (routes, href) => {
        const url = new URL(href);
        return routes.find((r) => (typeof r.m === 'function' ? r.m({ url }) : r.m instanceof RegExp && r.m.test(url.href)));
    };

    it('8. built SW routes the real request URLs to the right handler, cache and timeout', (t) => {
        if (process.env.SW_DIST_TEST !== '1') return t.skip('set SW_DIST_TEST=1 after npm run build to check the built worker');
        const sw = resolve(root, 'dist/sw.js');
        assert.ok(existsSync(sw), 'SW_DIST_TEST=1 but dist/sw.js is absent, run npm run build first');
        const built = statSync(sw).mtimeMs;
        for (const src of ['config/runtime-caching.mjs', 'vite.config.js']) {
            assert.ok(built >= statSync(resolve(root, src)).mtimeMs, 'dist/sw.js is stale, run npm run build first');
        }
        const routes = loadRoutes(readFileSync(sw, 'utf8'));
        const main = routeFor(routes, MAIN);
        assert.equal(main.h.kind, 'NetworkFirst');
        assert.equal(main.h.o.cacheName, 'pp-data-main');
        assert.equal(main.h.o.networkTimeoutSeconds, 8);
        assert.equal(main.h.o.fetchOptions.cache, 'no-cache');
        for (const u of GENERAL) {
            const g = routeFor(routes, u);
            assert.ok(g, 'no built route for ' + u);
            assert.equal(g.h.kind, 'NetworkFirst', u);
            assert.equal(g.h.o.cacheName, 'pp-data', u);
            assert.equal(g.h.o.networkTimeoutSeconds, 4, u);
            assert.equal(g.h.o.fetchOptions.cache, 'no-cache', u);
        }
        const api = routeFor(routes, SYNC);
        assert.equal(api.h.kind, 'StaleWhileRevalidate');
        assert.equal(api.h.o.cacheName, 'pp-api');
        assert.equal(routeFor(routes, 'https://server.arcgisonline.com/x/tile/5/10/10'), undefined);
    });

    it('9. CI wiring: the GitHub workflow builds before running the built-worker test', () => {
        const wf = readFileSync(resolve(root, '.github/workflows/test.yml'), 'utf8');
        assert.match(wf, /npm run build && SW_DIST_TEST=1 node --test test\/sw-runtime-caching\.test\.mjs/);
    });
});

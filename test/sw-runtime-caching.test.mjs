// v39.1 (audit finding 5 / TODO A1): pins the Workbox strategy for live river data.
// Config level (always runs) and built dist/sw.js level (runs only when SW_DIST_TEST=1).
// The built-worker test is opt-in because a dist/ left over from an earlier build is not evidence about
// this commit: Netlify reuses its working folder between builds, so `npm test` there (which runs BEFORE
// `npm run build`) would inspect the previous deploy's worker. That failed the first v39.1 deploy.
// GitHub Actions and the Netlify build command both run it right after their own build (see
// .github/workflows/test.yml and netlify.toml; tests 9 and 10 pin both); locally use
// `npm run build && SW_DIST_TEST=1 node --test test/sw-runtime-caching.test.mjs`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { runtimeCaching } from '../config/runtime-caching.mjs';
import { PAGE_TIMERS, directSet } from '../src/data/usgs-source.js';
import { buildContinuousUrl } from '../src/data/usgs-adapter.js';

const { SETS } = createRequire(import.meta.url)('../netlify/functions/shared/usgs-sets.js');

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

// v39.13: request URLs as the app builds them (src/data/usgs-source.js): same-origin /api/usgs?set=<name>
// for stage 1; stage 2 (direct, new service) addresses come from the browser adapter and the app's own constants.
const FN = 'https://potomacpulse.example/api/usgs?set=';
const MAIN = `${FN}main`;
const GENERAL = [
    `${FN}creeks`,
    `${FN}ef`,
    `${FN}temp`,
];
const NWS = 'https://api.water.noaa.gov/nwps/v1/gauges/LTLM2/stageflow/forecast';
const DIRECT = ['main', 'creeks', 'ef', 'temp'].map((n) => buildContinuousUrl(directSet(n)));
// Gone for good: the old service and the two relays (nothing may route them any more).
const REMOVED = [
    'https://waterservices.usgs.gov/nwis/iv/?sites=01646500&parameterCd=00060,00065&period=P7D&format=json',
    'https://waterservices.usgs.gov/nwis/iv/?sites=01644148&parameterCd=00065&period=P1D&format=json',
    `https://api.allorigins.win/raw?url=${encodeURIComponent('https://waterservices.usgs.gov/nwis/iv/?sites=1&period=P7D')}`,
    `https://corsproxy.io/?${encodeURIComponent('https://waterservices.usgs.gov/nwis/iv/?sites=1&period=P7D')}`,
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

    it('3. /api/usgs?set=main hits the main route (7 s); the other sets hit the general route (6 s); NWS keeps 4 s', () => {
        const m = first(MAIN);
        assert.equal(m.handler, 'NetworkFirst');
        assert.equal(m.options.cacheName, 'pp-data-main');
        assert.equal(m.options.networkTimeoutSeconds, 7);
        assert.equal(m.options.expiration.maxEntries, 2);
        for (const u of GENERAL) {
            const g = first(u);
            assert.ok(g, u);
            assert.equal(g.handler, 'NetworkFirst', u);
            assert.equal(g.options.cacheName, 'pp-data', u);
            assert.equal(g.options.networkTimeoutSeconds, 6, u);
        }
        const n = first(NWS);
        assert.equal(n.options.cacheName, 'pp-data');
        assert.equal(n.options.networkTimeoutSeconds, 4);
        assert.ok(n.options.networkTimeoutSeconds * 1000 < 5000, 'NWS page timer is 5 s (src/estimation/nws.js)');
    });

    it('4. function cap + 1.5 s < service worker timeout < page timer, for both groups (strict)', () => {
        // Function caps (shared/usgs-sets.js): 5 s main, 3.5 s the others. The service worker must wait for the
        // function's headers (cap plus cold start, conversion and transit, 1.5 s), and must fire before the page
        // timer or the page gives up first and never sees the saved copy.
        const main = { cap: SETS.main.capMs, sw: first(MAIN).options.networkTimeoutSeconds * 1000, page: PAGE_TIMERS.main };
        assert.ok(main.cap + 1500 < main.sw, `main: ${main.cap}+1500 < ${main.sw}`);
        assert.ok(main.sw < main.page, `main: ${main.sw} < ${main.page}`);
        for (const name of ['creeks', 'ef', 'temp']) {
            const sw = first(`${FN}${name}`).options.networkTimeoutSeconds * 1000;
            assert.ok(SETS[name].capMs + 1500 < sw, `${name}: ${SETS[name].capMs}+1500 < ${sw}`);
            assert.ok(sw < PAGE_TIMERS[name], `${name}: ${sw} < ${PAGE_TIMERS[name]}`);
        }
    });

    it('5. both river routes bypass the browser HTTP cache', () => {
        assert.equal(first(MAIN).options.fetchOptions.cache, 'no-cache');
        assert.equal(first(GENERAL[0]).options.fetchOptions.cache, 'no-cache');
    });

    it('5b. no service worker route for the direct new-service calls (ruling 8), the old host or the relays', () => {
        for (const u of DIRECT) assert.equal(first(u), undefined, 'direct call must match no route: ' + u.slice(0, 90));
        for (const u of REMOVED) assert.equal(first(u), undefined, 'removed host must match no route: ' + u.slice(0, 60));
    });

    it('5c. only the exact /api/usgs path is routed (no look-alike path)', () => {
        assert.equal(first('https://potomacpulse.example/api/usgsx?set=main'), undefined);
        assert.equal(first('https://potomacpulse.example/x/api/usgs?set=main'), undefined);
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
        assert.equal(main.h.o.networkTimeoutSeconds, 7);
        assert.equal(main.h.o.fetchOptions.cache, 'no-cache');
        for (const u of GENERAL) {
            const g = routeFor(routes, u);
            assert.ok(g, 'no built route for ' + u);
            assert.equal(g.h.kind, 'NetworkFirst', u);
            assert.equal(g.h.o.cacheName, 'pp-data', u);
            assert.equal(g.h.o.networkTimeoutSeconds, 6, u);
            assert.equal(g.h.o.fetchOptions.cache, 'no-cache', u);
        }
        const nws = routeFor(routes, NWS);
        assert.equal(nws.h.o.cacheName, 'pp-data');
        assert.equal(nws.h.o.networkTimeoutSeconds, 4);
        for (const u of [...DIRECT, ...REMOVED]) assert.equal(routeFor(routes, u), undefined, 'built worker must not route ' + u.slice(0, 60));
        const text = readFileSync(sw, 'utf8');
        assert.ok(text.includes('/api/usgs'), 'built worker must name /api/usgs');
        for (const bad of ['waterservices.usgs.gov', 'allorigins', 'corsproxy']) assert.ok(!text.includes(bad), `built worker still mentions ${bad}`);
        const api = routeFor(routes, SYNC);
        assert.equal(api.h.kind, 'StaleWhileRevalidate');
        assert.equal(api.h.o.cacheName, 'pp-api');
        assert.equal(routeFor(routes, 'https://server.arcgisonline.com/x/tile/5/10/10'), undefined);
    });

    it('8b. built output has robots.txt and sitemap.xml, and the built worker denies them for navigation', (t) => {
        if (process.env.SW_DIST_TEST !== '1') return t.skip('set SW_DIST_TEST=1 after npm run build to check the built output');
        for (const f of ['robots.txt', 'sitemap.xml']) assert.ok(existsSync(resolve(root, 'dist', f)), `dist/${f} is absent`);
        const code = readFileSync(resolve(root, 'dist/sw.js'), 'utf8');
        const m = code.match(/denylist:\s*\[([^\]]*)\]/);
        assert.ok(m, 'no navigation denylist in the built worker');
        const list = [...m[1].matchAll(/\/((?:\\.|[^/\\])+)\//g)].map((x) => new RegExp(x[1]));
        for (const path of ['/robots.txt', '/sitemap.xml', '/.netlify/functions/x']) assert.ok(list.some((re) => re.test(path)), `denylist misses ${path}`);
        assert.ok(!list.some((re) => re.test('/')), 'denylist must not cover the app shell');
        const html = readFileSync(resolve(root, 'dist/index.html'), 'utf8');
        assert.match(html, /<link rel="canonical" href="https:\/\/potomac-pulse\.netlify\.app\/">/);
    });

    it('9. CI wiring: the GitHub workflow builds before running the built-worker test', () => {
        const wf = readFileSync(resolve(root, '.github/workflows/test.yml'), 'utf8');
        assert.match(wf, /npm run build && SW_DIST_TEST=1 node --test test\/sw-runtime-caching\.test\.mjs/);
    });

    it('10. deploy gate: the Netlify build command checks the built worker after its own build', () => {
        const toml = readFileSync(resolve(root, 'netlify.toml'), 'utf8');
        const m = toml.match(/^\s*command\s*=\s*"([^"]+)"/m);
        assert.ok(m, 'no build command in netlify.toml');
        const steps = m[1].split('&&').map((x) => x.trim());
        const iTest = steps.indexOf('npm test');
        const iBuild = steps.indexOf('npm run build');
        const iGate = steps.indexOf('SW_DIST_TEST=1 node --test test/sw-runtime-caching.test.mjs');
        assert.ok(iTest >= 0 && iBuild > iTest, 'npm test must run before npm run build');
        assert.equal(iGate, iBuild + 1, 'the built-worker check must be the step right after npm run build');
        assert.equal(iGate, steps.length - 1, 'the built-worker check must be the last step');
    });
});

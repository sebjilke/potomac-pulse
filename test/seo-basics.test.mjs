// v39.5: search visibility basics. robots.txt, sitemap.xml and the index.html head.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readAppVersion } from '../src/ui/app-version.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const SITE = 'https://potomac-pulse.netlify.app/';
const TITLE = 'Potomac Pulse: Great Falls and Potomac River flow for paddlers';

describe('robots.txt', () => {
    it('exists, names the sitemap and does not disallow the whole site', () => {
        assert.ok(existsSync(resolve(root, 'public/robots.txt')));
        const r = read('public/robots.txt');
        assert.ok(r.includes(`Sitemap: ${SITE}sitemap.xml`));
        assert.ok(/^Allow: \/$/m.test(r));
        assert.ok(!/^Disallow:\s*\/\s*$/m.test(r), 'must not disallow "/"');
        assert.ok(/^Disallow: \/api\/$/m.test(r) && /^Disallow: \/\.netlify\/$/m.test(r));
    });
});

describe('robots.txt disallow list', () => {
    it('has no Disallow lines other than /api/ and /.netlify/', () => {
        const d = read('public/robots.txt').split('\n').filter((l) => /^Disallow:/i.test(l)).map((l) => l.trim());
        assert.deepEqual(d.sort(), ['Disallow: /.netlify/', 'Disallow: /api/']);
    });
});

describe('sitemap.xml', () => {
    it('is well formed and lists exactly the canonical URL', () => {
        assert.ok(existsSync(resolve(root, 'public/sitemap.xml')));
        const x = read('public/sitemap.xml');
        assert.ok(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
        assert.match(x, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">[\s\S]*<\/urlset>\s*$/);
        const locs = [...x.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
        assert.deepEqual(locs, [SITE]);
        assert.equal((x.match(/<url>/g) || []).length, 1);
        assert.equal((x.match(/<\/url>/g) || []).length, 1);
        assert.ok(!x.includes('lastmod'));
    });
});

describe('index.html head', () => {
    const html = read('index.html');
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    it('has the exact title with no version in it', () => {
        assert.equal(head.match(/<title>([^<]*)<\/title>/)[1], TITLE);
        assert.ok(!/<title>[^<]*\bv\d+\.\d+/.test(head));
    });
    it('has exactly one canonical link', () => {
        const c = head.match(/<link rel="canonical"[^>]*>/g) || [];
        assert.equal(c.length, 1);
        assert.ok(c[0].includes(`href="${SITE}"`));
    });
    it('has absolute og:url and og:image, og:title and twitter:card', () => {
        assert.ok(head.includes(`<meta property="og:url" content="${SITE}">`));
        assert.match(head, /<meta property="og:image" content="https:\/\/potomac-pulse\.netlify\.app\/[^"]+">/);
        assert.ok(head.includes(`<meta property="og:title" content="${TITLE}">`));
        assert.ok(head.includes('<meta name="twitter:card" content="summary">'));
    });
    it('has a description of at most 160 characters naming the key words', () => {
        const d = head.match(/<meta name="description" content="([^"]*)">/)[1];
        assert.ok(d.length > 50 && d.length <= 160, String(d.length));
        for (const w of ['Great Falls', 'Potomac', 'paddlers', 'USGS']) assert.ok(d.includes(w), w);
    });
    it('og:description equals the meta description', () => {
        const d = head.match(/<meta name="description" content="([^"]*)">/)[1];
        assert.ok(head.includes(`<meta property="og:description" content="${d}">`));
        assert.equal(JSON.parse(read('public/manifest.json')).description, d);
    });
    it('og:image file exists in public/', () => {
        const f = head.match(/<meta property="og:image" content="https:\/\/potomac-pulse\.netlify\.app\/([^"]+)">/)[1];
        assert.ok(existsSync(resolve(root, 'public', f)), f);
    });
    it('html element has lang="en"', () => assert.match(html, /<html lang="en">/));
    it('does not say noindex', () => assert.ok(!/noindex/i.test(html)));
    it('has no inline script and no JSON-LD in the head (CSP)', () => {
        assert.ok(!/ld\+json/.test(head));
        assert.ok(!/<script(?![^>]*\bsrc=)/.test(head));
    });
    it('shows the version on the page footer and it matches the meta', () => {
        const meta = head.match(/<meta name="app-version" content="(v\d+\.\d+)">/)[1];
        assert.match(html, new RegExp(`<span id="app-version-text"[^>]*>${meta.replace('.', '\\.')}</span>`));
    });
});

describe('service worker config', () => {
    it('vite.config.js denies the navigation fallback for robots.txt and sitemap.xml', () => {
        const v = read('vite.config.js');
        assert.match(v, /navigateFallbackDenylist:\s*\[[^\]]*robots[^\]]*sitemap[^\]]*\]/);
    });
});

describe('version reader', () => {
    const fake = (content) => ({ querySelector: (q) => (q === 'meta[name="app-version"]' && content ? { content } : null), title: 'Potomac Pulse v1.0' });
    it('reads the meta tag and ignores the title', () => assert.equal(readAppVersion(fake('v39.5')), 'v39.5'));
    it('returns unknown only when the meta tag is absent', () => assert.equal(readAppVersion(fake(null)), 'unknown'));
    it('learning-ui.js uses the helper, not the title', () => {
        const src = read('src/ui/learning-ui.js');
        assert.ok(src.includes('readAppVersion(document)'));
        assert.ok(!/document\.title/.test(src));
    });
    it('the real index.html meta is readable by the helper', () => {
        const m = read('index.html').match(/<meta name="app-version" content="([^"]*)">/);
        assert.equal(readAppVersion(fake(m[1])), m[1]);
    });
});

describe('Search Console ownership tag', () => {
    it('is in the head exactly once, with a non-empty code', () => {
        const html = read('index.html');
        const head = html.slice(0, html.indexOf('</head>'));
        const tags = head.match(/<meta name="google-site-verification" content="([^"]+)"\s*\/?>/g) || [];
        assert.equal(tags.length, 1, 'removing or duplicating this tag unverifies the site in Search Console');
        assert.equal((html.match(/google-site-verification/g) || []).length, 1);
    });
});

# SEO basics, 2026-11-10

## What was checked on 2026-11-10
- The site had no robots.txt. Nothing blocked crawlers.
- There was no sitemap.
- No page said noindex.
- No other site links to it that we could find.
- A site-restricted search for potomac-pulse.netlify.app returned nothing.
- The title was "Potomac Pulse v39.4": it changed every release and had no search words.
- There was no canonical link and og:image was a relative path.

## What v39.5 adds
- public/robots.txt: allow all, disallow /api/ and /.netlify/, names the sitemap.
- public/sitemap.xml: the one page, no lastmod, so it cannot go stale.
- Title: "Potomac Pulse: Great Falls and Potomac River flow for paddlers".
- A description under 160 characters, a canonical link, og:url, absolute og:image, og:title, twitter:card.
- The version moved out of the title. It is now in <meta name="app-version"> and in small text in the page footer.
- The service worker no longer answers /robots.txt or /sitemap.xml with the app shell.
- Tests in test/seo-basics.test.mjs, and a built-output check in the SW_DIST_TEST=1 test.
- No scripts, no JSON-LD, no header changes. A comment in the head marks where the Google verification tag goes.

## What only the owner can do
- Register the site in Google Search Console, send the verification code, and ask Google to index the home page.
- Get at least one inbound link from another site.
- Consider a custom domain.
- Know the limit: the page is mostly script-rendered, so only its static text is crawlable. Ranking for "Potomac River flow" is a long shot against USGS and NWS pages.

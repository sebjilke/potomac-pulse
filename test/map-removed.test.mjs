// v39.9: source-text guards for the removals (map and Leaflet, About second line, footer sentence, sq mi line,
// "vs persistence" row), the two column info icons, the footer link and the new header line. Structural only;
// the behaviour is in forecast-accuracy-row.test.mjs and col-info-behaviour.test.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const html = read('index.html');
const css = read('src/styles/main.css');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const srcFiles = walk(resolve(root, 'src')).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
// body of the first rule whose selector line matches, optionally inside a media block
const rule = (sel, from = 0) => {
    const i = css.indexOf(sel + ' {', from);
    assert.ok(i >= 0, `rule ${sel} not found`);
    return css.slice(i, css.indexOf('}', i));
};
const mediaBlock = (q) => { const i = css.indexOf(q); assert.ok(i >= 0, q); return css.slice(i, css.indexOf('\n}\n', i)); };

describe('map and Leaflet are gone', () => {
    it('no source file imports or uses Leaflet', () => {
        for (const f of srcFiles) {
            const t = readFileSync(f, 'utf8');
            assert.ok(!/from 'leaflet|import 'leaflet|\bleaflet\b|L\.divIcon|L\.map/i.test(t), f);
        }
    });
    it('the map source files and outline files do not exist', () => {
        for (const p of ['src/ui/map.js', 'src/ui/map-outlines.js', 'public/potomac-nhd.geojson', 'public/potomac-watershed.geojson']) {
            assert.ok(!existsSync(resolve(root, p)), p);
        }
    });
    it('index.html has no map container, toggle button or map label', () => {
        for (const s of ['id="map"', 'id="mapToggleBtn"', 'aria-label="Toggle map"', 'River gauge map']) assert.ok(!html.includes(s), s);
    });
    it('package.json has no leaflet', () => {
        // package-lock.json is deliberately NOT checked: it is gitignored, and on Netlify it is rebuilt from a
        // cached node_modules that can still hold the old package (that failed the first v39.9 build). What
        // ships is decided by the imports, which the first test in this file guards.
        const pkg = JSON.parse(read('package.json'));
        assert.equal(pkg.dependencies?.leaflet, undefined);
        assert.equal(pkg.devDependencies?.leaflet, undefined);
    });
    it('public/ has no geojson and vite.config.js does not precache it', () => {
        assert.deepEqual(readdirSync(resolve(root, 'public')).filter((f) => f.endsWith('.geojson')), []);
        assert.ok(!/geojson/.test(read('vite.config.js')));
    });
    it('the CSP has no tile host and still allows data: images', () => {
        const toml = read('netlify.toml');
        assert.ok(!/cartocdn|arcgisonline|basemaps/.test(toml));
        assert.ok(toml.includes("img-src 'self' data:;"));
    });
    it('main.css has no map, Leaflet, popup or legend rules', () => {
        for (const re of [/\.leaflet-/, /#map\b/, /show-map/, /\.map-legend/, /\.pop-/, /\.map-loading/, /\.gauge-label/, /\.btn\.active/]) assert.ok(!re.test(css), String(re));
    });
    it('the store exports no map or markers state', () => {
        const store = read('src/state/store.js');
        for (const s of ['export let map', 'export let markers', 'setMap', 'setMarkers']) assert.ok(!store.includes(s), s);
        assert.ok(!/\bmarkers\b/.test(read('src/ui/gauges-ui.js')));
    });
    it('gauge rows have no click target for the map; the branch header toggle is still wired', () => {
        const g = read('src/ui/gauges-ui.js');
        for (const s of ['data-gauge-id', 'panTo', '.gauge[data-gauge-id]', 'popup(']) assert.ok(!g.includes(s), s);
        assert.ok(g.includes(".branch-hd[data-branch]"));
        assert.ok(!/\.gauge(:hover|:focus)/.test(css));
        assert.ok(!/cursor:\s*pointer/.test(rule('.gauge')));
    });
    it('tabs.js and init.js mention no map hook', () => {
        for (const f of ['src/ui/tabs.js', 'src/init.js', 'src/main.js']) assert.ok(!/updateMapVisibility|initMap|toggleMap|ui\/map/.test(read(f)), f);
    });
});

describe('the sidebar keeps its old no-map look (merged rules)', () => {
    it('the plain #sidebar rule carries the old no-map values', () => {
        const r = rule('#sidebar');
        for (const s of ['width: 100%', 'max-width: 600px', 'margin: 0 auto', 'border-left: none']) assert.ok(r.includes(s), s);
        assert.ok(!css.includes('width: 380px'));
    });
    it('the phone #sidebar rule keeps min-height 45vh, max-height none, flex 1 and square corners', () => {
        const m = mediaBlock('@media (max-width: 768px)');
        const r = m.slice(m.indexOf('#sidebar {'), m.indexOf('}', m.indexOf('#sidebar {')));
        for (const s of ['min-height: 45vh', 'max-height: none', 'flex: 1', 'border-radius: 0', 'border-top: none']) assert.ok(r.includes(s), s);
    });
});

describe('About text, footer, sq mi line', () => {
    it('About: two owner lines, exactly', () => {
        const i = html.indexOf('id="about-tooltip"');
        const block = html.slice(i, html.indexOf('</div>\n            <div class="hdr-right">', i));
        const divs = [...block.matchAll(/<div[^>]*>([^<]*)<\/div>/g)].map((m) => m[1]);
        assert.deepEqual(divs, [
            'This app tracks water moving through the Potomac basin — every gauge, with travel times to Little Falls. And since Great Falls has no gauge, it estimates that too.',
            'Built by Gordon Shumway.'
        ]);
        assert.ok(!/Toby|Tim Slim/.test(html));
        assert.ok(!/Toby|Tim Slim/.test(read('src/ui/about.js')));
    });
    it('footer: no life-safety sentence or Toby egg; credit, Open Source and the version text stay', () => {
        const f = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
        for (const s of ['life-safety', 'navigation', 'toby-egg']) assert.ok(!f.includes(s), s);
        for (const s of ['gs-credit', 'Open Source', 'app-version-text']) assert.ok(f.includes(s), s);
    });
    it('footer: the name is one link to American Whitewater, text and title unchanged', () => {
        assert.equal((html.match(/id="gs-credit"/g) || []).length, 1);
        const m = html.match(/<a id="gs-credit"([^>]*)>([^<]*)<\/a>/);
        assert.ok(m, 'gs-credit is an <a>');
        assert.ok(m[1].includes('href="https://www.americanwhitewater.org/"'));
        assert.ok(m[1].includes('target="_blank"'));
        assert.ok(m[1].includes('rel="noopener"'));
        assert.ok(m[1].includes('title="Click me!"'));
        assert.equal(m[2], 'Gordon Shumway');
    });
    it('the Little Falls card has no sq mi line', () => {
        assert.ok(!html.includes('target-sub') && !html.includes('sq mi'));
        assert.ok(!css.includes('.target-sub'));
    });
});

describe('forecast accuracy: no "vs persistence" row', () => {
    it('great-falls-ui.js does not read persistence validations or print the row', () => {
        const g = read('src/ui/great-falls-ui.js');
        assert.ok(!g.includes('persistenceValidations') && !g.includes('vs persistence'));
        assert.ok(g.includes('persistenceCFS'), 'the posted persistenceCFS field stays (the server still scores it)');
    });
});

describe('gauge-list column info icons', () => {
    const TREND = 'Forecast change in flow over the next 24 hours';
    const BASIN = 'Share of the land draining to Little Falls that lies upstream of this gauge';
    const g = read('src/ui/gauges-ui.js');
    const header = g.slice(g.indexOf('<div class="gauge-header">'), g.indexOf('</div>`;', g.indexOf('<div class="gauge-header">')));
    it('the explanation texts are exactly the approved wording', () => {
        assert.ok(g.includes(`const TREND_TIP = '${TREND}';`));
        assert.ok(g.includes(`const BASIN_TIP = '${BASIN}';`));
    });
    it('the header has exactly two buttons, in the 24h Trend and Basin cells, aria-label equal to data-tip, no title', () => {
        const buttons = header.match(/<button[^>]*>i<\/button>/g) || [];
        assert.equal(buttons.length, 2);
        assert.match(header, /24h Trend <button type="button" class="col-info" aria-label="\$\{TREND_TIP\}" aria-expanded="false" data-tip="\$\{TREND_TIP\}">i<\/button>/);
        assert.match(header, /Basin <button type="button" class="col-info" aria-label="\$\{BASIN_TIP\}" aria-expanded="false" data-tip="\$\{BASIN_TIP\}">i<\/button>/);
        assert.ok(!/title=/.test(header));
    });
    it('the click handler toggles the open class; document click and Escape close', () => {
        assert.ok(g.includes("info.classList.add('open')"));
        assert.ok(g.includes("el.classList.remove('open')"));
        assert.ok(g.includes("document.addEventListener('click'"));
        assert.ok(g.includes("document.addEventListener('pointerdown'"), 'a touch elsewhere closes it too (iOS sends no document click)');
        assert.ok(g.includes("e.key === 'Escape'"));
    });
    it('CSS: bubble for .open only (plus hover inside (hover: hover)); anchored to the header; header cells do not wrap', () => {
        assert.ok(/\.col-info\.open::after/.test(css));
        // A bubble shown by focus alone could not be closed with Escape and would disagree with aria-expanded.
        assert.ok(!/\.col-info:focus-visible::after/.test(css) && !/\.col-info:focus::after/.test(css));
        assert.ok(/\.col-info:focus-visible\s*\{[^}]*outline/.test(css), 'the keyboard focus ring stays');
        assert.ok(/\.gauge-header > div\s*\{[^}]*white-space:\s*nowrap/.test(css));
        const hv = css.indexOf('@media (hover: hover)');
        assert.ok(hv >= 0 && css.indexOf('.col-info:hover::after', hv) > hv);
        assert.equal((css.match(/\.col-info:hover::after/g) || []).length, 1, 'no hover rule outside the media query');
        assert.ok(css.includes('content: attr(data-tip)'));
        assert.ok(!/position:\s*relative/.test(rule('.col-info')), 'the bubble must anchor to the sticky header');
        assert.ok(rule('.gauge-header').includes('position: sticky'));
    });
    it('header and row grid templates match at every breakpoint', () => {
        const hd = rule('.gauge-header').match(/grid-template-columns:\s*([^;]+);/)[1];
        const rw = rule('.gauge').match(/grid-template-columns:\s*([^;]+);/)[1];
        assert.equal(hd, rw);
        assert.ok(/\.gauge,\s*\.gauge-header\s*\{[^}]*grid-template-columns:\s*8px 1fr 82px 50px 42px 38px;/.test(css));
    });
});

describe('Great Falls to Little Falls header line', () => {
    it('markup: label, id, class, no aria-label, after the Point of Rocks line and inside .flow-indicator', () => {
        const i = html.indexOf('<div class="flow-indicator">');
        const block = html.slice(i, html.indexOf('</div>', i));
        assert.ok(block.includes('Great Falls to Little Falls: <span class="mult" id="gfLfTravelVal">--</span>'));
        assert.ok(block.indexOf('id="multVal"') < block.indexOf('id="gfLfTravelVal"'));
        assert.ok(!/gfLfTravelVal"[^>]*aria-label/.test(html));
    });
    it('.flow-indicator is a column', () => {
        assert.ok(/flex-direction:\s*column/.test(rule('.flow-indicator')));
    });
    it('exactly two renderGfLfTravel calls inside updateGreatFallsUI, defined above it, and no other write to the id', () => {
        const g = read('src/ui/great-falls-ui.js');
        const fnStart = g.indexOf('export function updateGreatFallsUI');
        assert.ok(g.indexOf('function renderGfLfTravel') > 0 && g.indexOf('function renderGfLfTravel') < fnStart);
        const body = g.slice(fnStart, g.indexOf('\n}\n', fnStart));
        assert.equal((body.match(/renderGfLfTravel\(/g) || []).length, 2);
        assert.ok(body.includes('renderGfLfTravel(null);'));
        assert.ok(body.includes('renderGfLfTravel(gfEstimate.inputs.travelGFtoLF);'));
        const users = srcFiles.filter((f) => readFileSync(f, 'utf8').includes('gfLfTravelVal'));
        assert.deepEqual(users.map((f) => f.slice(root.length + 1)), ['src/ui/great-falls-ui.js']);
        assert.equal((g.match(/gfLfTravelVal/g) || []).length, 1);
    });
    it('the main-path call sits directly after the panel row write', () => {
        const g = read('src/ui/great-falls-ui.js');
        assert.match(g, /getElementById\("gf-input-travel-gf-lf"\)\.textContent = gfEstimate\.inputs\.travelGFtoLF\.toFixed\(1\) \+ " hrs";\n\s*renderGfLfTravel\(gfEstimate\.inputs\.travelGFtoLF\);/);
    });
});

// v39.4 (A9): creek level bands (src/ui/creek-level.js) and the Creeks tab wiring (src/ui/creeks-ui.js).
// Display only. Calls the pure functions; the UI test drives updateCreeksUI() against a fake DOM and
// compares what lands in the DOM with what the pure module returns.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CREEK_RUNS } from '../src/model/constants.js';
import {
    creekLevel, creekCardView, creekBanner, creekTabDotClass, formatReadingAge, NO_HIGH_WATER_LEVEL
} from '../src/ui/creek-level.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const HOUR = 3_600_000;
const fresh = NOW - 10 * 60_000;
const ids = Object.keys(CREEK_RUNS);
const byName = (n) => Object.entries(CREEK_RUNS).find(([, c]) => c.name === n)[1];
const view = (q, c, opts = {}) => creekCardView({ q, trend: 'steady', time: opts.time ?? fresh }, c, NOW);
const num = (shown) => parseFloat(shown);

describe('bands at the edges, every creek', () => {
    for (const [id, c] of Object.entries(CREEK_RUNS)) {
        it(`${c.name} (${id})`, () => {
            const m = c.runnable;
            const at = (r) => creekLevel(m * r, m, fresh, NOW).band;
            assert.equal(at(0.999), 'below');
            assert.equal(at(1), 'run');
            assert.equal(at(1.999), 'run');
            assert.equal(at(2), 'high');
            assert.equal(at(4.999), 'high');
            assert.equal(at(5), 'veryhigh');
            assert.equal(creekLevel(m * 2, m, fresh, NOW).shown, '2.0x');
            assert.equal(creekLevel(m * 1.999, m, fresh, NOW).shown, '1.9x');
            assert.equal(creekLevel(m * 4.999, m, fresh, NOW).shown, '4.9x');
            assert.equal(creekLevel(m * 5, m, fresh, NOW).shown, '5.0x');
        });
    }
});

describe('PA-1: displayed ratio never contradicts the band (sweep over the string)', () => {
    for (const m of [200, 400]) {
        it(`minimum ${m}`, () => {
            for (let q100 = 0; q100 <= m * 100 * 100; q100 += 1) {
                const q = q100 / 100;
                const lvl = creekLevel(q, m, fresh, NOW);
                const text = creekCardView({ q, trend: 'steady', time: fresh }, { runnable: m }, NOW).status;
                if (lvl.band === 'run') {
                    assert.ok(num(lvl.shown) >= 1 && num(lvl.shown) < 2, `${q}: ${lvl.shown}`);
                    assert.ok(text.startsWith('Running:'));
                } else {
                    assert.ok(!/running/i.test(text), `${q}: ${text}`);
                }
                if (lvl.band === 'high') assert.ok(num(lvl.shown) >= 2 && num(lvl.shown) < 5, `${q}: ${lvl.shown}`);
                if (lvl.band === 'veryhigh') assert.ok(num(lvl.shown) >= 5, `${q}: ${lvl.shown}`);
            }
        });
    }
});

describe('PA-6: inputs that must not be trusted', () => {
    const c = { runnable: 200 };
    for (const bad of [null, undefined, NaN, -1, -999999, Infinity, '12']) {
        it(`q = ${String(bad)} gives the no-data view`, () => {
            assert.equal(creekLevel(bad, 200, fresh, NOW).band, 'none');
            const v = creekCardView({ q: bad, trend: 'rising', time: fresh }, c, NOW);
            assert.equal(v.band, 'none');
            assert.equal(v.cfsText, '❓ No data');
            assert.equal(v.status, 'Gauge offline or no response');
            assert.equal(v.trendText, '');
        });
    }
    for (const bad of [0, null, undefined, NaN, -5, Infinity]) {
        it(`minimum = ${String(bad)}: no ratio, no band, no "Infinityx"`, () => {
            const lvl = creekLevel(500, bad, fresh, NOW);
            assert.equal(lvl.band, 'nominimum');
            assert.equal(lvl.ratio, null);
            const v = creekCardView({ q: 500, trend: 'steady', time: fresh }, { runnable: bad }, NOW);
            assert.ok(!/Infinity|NaN|undefined|null/.test(v.status + v.cfsText), v.status);
            assert.equal(v.status, 'No minimum flow is set for this creek.');
        });
    }
    it('a card view with no creek definition does not throw', () => {
        assert.doesNotThrow(() => creekCardView({ q: 5, time: fresh }, undefined, NOW));
        assert.doesNotThrow(() => creekCardView(undefined, undefined, NOW));
    });
    it('very large ratios print a whole number', () => {
        assert.equal(creekLevel(200000, 200, fresh, NOW).shown, '1000x');
        assert.equal(creekLevel(2460, 200, fresh, NOW).shown, '12x');
        assert.equal(creekLevel(1990, 200, fresh, NOW).shown, '9.9x');
        assert.equal(creekLevel(2000, 200, fresh, NOW).shown, '10x');
        assert.ok(!/\d\.\dx/.test(view(2460, c).status));
    });
});

describe('PA-5: old readings', () => {
    const c = byName('Difficult Run');
    it('exactly 120 min old is fresh, 121 min is old', () => {
        assert.equal(creekLevel(1620, 200, NOW - 120 * 60_000, NOW).band, 'veryhigh');
        assert.equal(creekLevel(1620, 200, NOW - 121 * 60_000, NOW).band, 'old');
    });
    it('a missing or invalid reading time is old', () => {
        for (const t of [null, undefined, NaN, 'x']) assert.equal(creekLevel(300, 200, t, NOW).band, 'old');
        assert.equal(creekCardView({ q: 300, trend: 'rising' }, c, NOW).band, 'old');
    });
    it('the old view says how old, that the level is unknown, and has no Running or band colour', () => {
        const v = view(300, c, { time: NOW - 3 * HOUR });
        assert.equal(v.band, 'old');
        assert.equal(v.status, 'Old reading: 3 h ago it was 300 cfs, 1.5x the 200 cfs minimum. The current level is unknown.');
        assert.equal(v.cfsText, '300 cfs (old)');
        assert.ok(!/running/i.test(v.status));
        assert.equal(v.trendText, '');
        assert.equal(v.active, false);
        assert.notEqual(v.lastRan, 'now');
        for (const k of ['dotColor', 'cfsColor', 'borderColor', 'statusColor', 'lineColor']) {
            assert.ok(!/green|amber|red/.test(v[k]), `${k} = ${v[k]}`);
        }
        assert.equal(v.chartRgb, '100,116,139');
    });
    it('an old reading of 8x is not shown as red', () => {
        const v = view(1620, c, { time: NOW - 5 * HOUR });
        assert.equal(v.band, 'old');
        assert.ok(!/far above|high-water|running/i.test(v.status));
        assert.ok(/^Old reading: 5 h ago it was 1620 cfs, 8\.1x the 200 cfs minimum\./.test(v.status));
        assert.ok(!/red/.test(v.statusColor + v.cfsColor + v.dotColor + v.lineColor));
    });
    it('an old reading keeps what it knew, as history (re-audit item 3)', () => {
        const old3 = { time: NOW - 3 * HOUR };
        assert.equal(view(1600, c, old3).status, 'Old reading: 3 h ago it was 1600 cfs, 8.0x the 200 cfs minimum. The current level is unknown.');
        assert.equal(view(150, c, old3).status, 'Old reading: 3 h ago it was 150 cfs, below the 200 cfs minimum. The current level is unknown.');
        assert.equal(view(1999, byName('Rock Creek'), { time: NOW - 60 * HOUR }).status, 'Old reading: 2 days ago it was 1999 cfs, 4.9x the 400 cfs minimum. The current level is unknown.');
        assert.equal(creekCardView({ q: 300, trend: 'rising' }, c, NOW).status, 'Old reading: its time is unknown. The current level is unknown.');
        assert.equal(creekCardView({ q: 300, time: 'x' }, c, NOW).status, 'Old reading: its time is unknown. The current level is unknown.');
        for (const q of [150, 300, 500, 1600]) {
            const v = view(q, c, old3);
            assert.ok(!/running|far above/i.test(v.status));
            assert.equal(v.band, 'old');
            assert.equal(v.statusColor, 'var(--text-tertiary)');
        }
    });
    it('age text', () => {
        assert.equal(formatReadingAge(125), '2 h ago');
        assert.equal(formatReadingAge(60 * 49), '2 days ago');
        assert.equal(formatReadingAge(NaN), 'of unknown age');
    });
});

describe('exact visitor strings', () => {
    const dr = byName('Difficult Run');
    const rock = byName('Rock Creek');
    const sligo = byName('Sligo Creek');
    it('below', () => {
        assert.equal(view(150, dr).status, 'Needs ≥200 cfs');
        assert.equal(view(150, sligo).status, 'Needs ≥200 cfs (micro-run)');
        assert.equal(view(399, rock).status, 'Needs ≥400 cfs');
    });
    it('run, high, veryhigh', () => {
        assert.equal(view(322, dr).status, 'Running: 1.6x the 200 cfs minimum');
        assert.equal(view(480, dr).status, '2.4x the 200 cfs minimum. Potomac Pulse has no high-water level for this creek, so it cannot say whether this is too high.');
        assert.equal(view(1620, dr).status, '8.1x the 200 cfs minimum, far above it. Potomac Pulse has no high-water level for this creek, so it cannot say whether this is too high.');
    });
    it('banner: mixed bands, exact', () => {
        assert.deepEqual(creekBanner(['veryhigh', 'run', 'below', 'below'], 4), { emoji: '🔴', text: '2 of 4 creeks at or above their minimum flow · 1 at 5x or more', tone: 'veryhigh' });
        assert.deepEqual(creekBanner(['high', 'run', 'below', 'none'], 4), { emoji: '🟠', text: '2 of 4 creeks at or above their minimum flow · 1 with no data', tone: 'high' });
        assert.deepEqual(creekBanner(['run', 'below', 'below', 'below'], 4), { emoji: '🟢', text: '1 of 4 creeks at or above their minimum flow', tone: 'running' });
        assert.deepEqual(creekBanner(['below', 'below', 'nominimum', 'below'], 4), { emoji: '⚫', text: 'Nothing running', tone: 'quiet' });
        assert.equal(creekBanner(['run', 'old', 'below', 'below'], 4).text, '1 of 4 creeks at or above their minimum flow · 1 with old readings');
        assert.equal(creekBanner(['run', 'old', 'none', 'old'], 4).text, '1 of 4 creeks at or above their minimum flow · 2 with old readings · 1 with no data');
        assert.equal(creekBanner(['veryhigh', 'none', 'below', 'below'], 4).text, '1 of 4 creeks at or above their minimum flow · 1 at 5x or more · 1 with no data');
        assert.equal(creekBanner(['run', 'run', 'run'], 3).text, '3 of 3 creeks at or above their minimum flow');
    });
    it('the "5x or more" part appears only when a creek is at 5x or more', () => {
        for (const bands of [['high', 'run'], ['run'], ['below'], []]) assert.ok(!/5x/.test(creekBanner(bands, 4).text));
        assert.ok(/5x/.test(creekBanner(['veryhigh'], 4).text));
    });
});

describe('banner when levels are unknown (re-audit item 1)', () => {
    it('never says "Nothing running" while any creek is old or has no data', () => {
        const all = ['run', 'high', 'veryhigh', 'below', 'old', 'none', 'nominimum'];
        for (const a of all) for (const b of all) for (const c of all) for (const d of all) {
            const bn = creekBanner([a, b, c, d], 4);
            if ([a, b, c, d].some((x) => x === 'old' || x === 'none')) assert.ok(!/Nothing running/.test(bn.text), bn.text);
        }
    });
    it('no active creek, some old or no data: exact text, grey tone', () => {
        assert.deepEqual(creekBanner(['below', 'old', 'old', 'below'], 4), { emoji: '⚪', text: 'No current reading at or above minimum · 2 with old readings. Levels for those creeks are unknown.', tone: 'unknown' });
        assert.equal(creekBanner(['below', 'none', 'below', 'below'], 4).text, 'No current reading at or above minimum · 1 with no data. Levels for those creeks are unknown.');
        assert.equal(creekBanner(['below', 'none', 'old', 'below'], 4).text, 'No current reading at or above minimum · 1 with old readings · 1 with no data. Levels for those creeks are unknown.');
    });
    it('all creeks old or no data: exact text', () => {
        assert.equal(creekBanner(['old', 'old', 'old', 'old'], 4).text, 'Creek levels unknown · 4 with old readings');
        assert.equal(creekBanner(['none', 'none', 'none', 'none'], 4).text, 'Creek levels unknown · 4 with no data');
        assert.equal(creekBanner(['old', 'none', 'old', 'none'], 4).text, 'Creek levels unknown · 2 with old readings · 2 with no data');
        assert.equal(creekBanner(['old', 'old', 'old', 'old'], 4).tone, 'unknown');
    });
    it('unknown tone is grey in the stylesheet, never green', () => {
        const css = readFileSync(resolve(root, 'src/styles/main.css'), 'utf8');
        const m = css.match(/\.creeks-banner\.unknown\s*\{([^}]*)\}/);
        assert.ok(m && /var\(--text-tertiary\)/.test(m[1]) && !/green/.test(m[1]));
    });
});

describe('text contrast of the band colours (re-audit item 4)', () => {
    const theme = readFileSync(resolve(root, 'src/styles/theme.css'), 'utf8');
    const css = readFileSync(resolve(root, 'src/styles/main.css'), 'utf8');
    const token = (name) => {
        const m = theme.match(new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`));
        assert.ok(m, `token ${name}`);
        return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    };
    const resolveVar = (v) => token(v.match(/var\((--[\w-]+)\)/)[1]);
    const lum = (rgb) => {
        const [r, g, b] = rgb.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const over = (rgba, base) => base.map((c, i) => rgba[i] * rgba[3] + c * (1 - rgba[3]));
    const bases = [token('--bg-surface'), token('--bg-base')];
    const ruleBg = (selector) => {
        const m = css.match(new RegExp(`${selector.replace(/[.]/g, '\\.')}\\s*\\{[^}]*background:\\s*rgba\\((\\d+),(\\d+),(\\d+),([\\d.]+)\\)`));
        assert.ok(m, selector);
        return [+m[1], +m[2], +m[3], +m[4]];
    };
    const ruleColor = (selector) => {
        const m = css.match(new RegExp(`${selector.replace(/[.]/g, '\\.')}\\s*\\{[^}]*?color:\\s*(var\\([^)]+\\))`));
        assert.ok(m, selector);
        return m[1];
    };
    const report = [];
    it('card status text, every band that uses a coloured text, is at least 4.5:1', () => {
        const c = byName('Difficult Run');
        const cardBg = ruleBg('.creek-card');
        for (const [name, q] of [['green', 300], ['amber', 500], ['red', 1500]]) {
            const fg = resolveVar(view(q, c).statusColor);
            const worst = Math.min(...bases.map((b) => ratio(fg, over(cardBg, b))));
            report.push(`card ${name} ${worst.toFixed(2)}`);
            assert.ok(worst >= 4.5, `card ${name} status ${worst.toFixed(2)}:1`);
        }
    });
    it('banner text (running, high, veryhigh, quiet, unknown) is at least 4.5:1', () => {
        for (const tone of ['running', 'high', 'veryhigh', 'quiet', 'unknown']) {
            const sel = `.creeks-banner.${tone}`;
            const fg = resolveVar(ruleColor(sel));
            const bg = ruleBg(sel);
            const worst = Math.min(...bases.map((b) => ratio(fg, over(bg, b))));
            report.push(`banner ${tone} ${worst.toFixed(2)}`);
            assert.ok(worst >= 4.5, `banner ${tone} ${worst.toFixed(2)}:1`);
        }
    });
    it('the red card status uses the lighter red token', () => assert.equal(view(1500, byName('Difficult Run')).statusColor, 'var(--accent-red-light)'));
    it('prints the measured ratios', (t) => { t.diagnostic(report.join('; ')); });
});

describe('advice guard over every visitor-facing creek string', () => {
    const BAD = /safe|ok to|okay|good|fine|enjoy|recommend|go paddle|don'?t|do not|avoid|stay off|dangerous|should|upper limit|too low to matter|paddle|\bgo\b|unsafe/i;
    it('all bands, banners, quiet text, old, none', () => {
        const strings = [NO_HIGH_WATER_LEVEL];
        for (const c of Object.values(CREEK_RUNS)) {
            for (const r of [0.5, 1, 1.5, 2, 3, 5, 8.1, 12, 1000]) {
                const v = view(c.runnable * r, c);
                strings.push(v.status, v.cfsText, v.trendTitle);
            }
            const o = view(300, c, { time: NOW - 9 * HOUR });
            strings.push(o.status, o.cfsText);
            const n = creekCardView(undefined, c, NOW);
            strings.push(n.status, n.cfsText);
        }
        const all = ['run', 'high', 'veryhigh', 'below', 'old', 'none'];
        for (const a of all) for (const b of all) {
            const bn = creekBanner([a, b, b, a], 4);
            strings.push(bn.text);
        }
        for (const s of strings) assert.ok(!BAD.test(s), `advice-like wording in: ${s}`);
        assert.ok(strings.length > 50);
    });
    it('"Running" appears only in the run band, with no exclamation mark', () => {
        for (const [id, c] of Object.entries(CREEK_RUNS)) {
            for (let r = 0; r <= 60; r += 0.05) {
                const v = view(c.runnable * r, c);
                const hasRunning = /running/i.test(v.status);
                assert.equal(hasRunning, v.band === 'run', `${id} ${r}: ${v.status}`);
                assert.ok(!/!/.test(v.status));
            }
        }
    });
});

describe('October 2026 peaks, keyed by creek', () => {
    const peaks = { 'Difficult Run': [1620, 'veryhigh'], 'Rock Creek': [978, 'high'], 'Sligo Creek': [556, 'high'], 'NW Branch Anacostia': [322, 'run'] };
    for (const [name, [q, band]] of Object.entries(peaks)) {
        it(`${name} at ${q} cfs is ${band}`, () => assert.equal(view(q, byName(name)).band, band));
    }
});

describe('PA-3: nothing green at 2x or more; tab dot; Last ran', () => {
    it('tab dot class follows the highest band', () => {
        assert.equal(creekTabDotClass(['below', 'none', 'old']), '');
        assert.equal(creekTabDotClass([]), '');
        assert.equal(creekTabDotClass(['below', 'run']), 'has-running');
        assert.equal(creekTabDotClass(['run', 'high', 'below']), 'has-high');
        assert.equal(creekTabDotClass(['run', 'high', 'veryhigh']), 'has-veryhigh');
        assert.equal(creekTabDotClass(['veryhigh']), 'has-veryhigh');
    });
    it('banner tone and emoji are never green when any creek is high or veryhigh', () => {
        for (const bands of [['high', 'run'], ['veryhigh', 'run'], ['veryhigh', 'high', 'run', 'below']]) {
            const b = creekBanner(bands, 4);
            assert.notEqual(b.tone, 'running');
            assert.notEqual(b.emoji, '🟢');
        }
    });
    it('card colours at 2x or more are never green; "Last ran: now" only in the run band', () => {
        const c = byName('Difficult Run');
        for (const q of [400, 700, 999, 1000, 1620, 5000]) {
            const v = view(q, c);
            for (const k of ['dotColor', 'cfsColor', 'borderColor', 'statusColor', 'lineColor']) assert.ok(!/green/.test(v[k]), `${q} ${k}`);
            assert.notEqual(v.chartRgb, '74,222,128');
            assert.equal(v.lastRan, 'hidden');
        }
        assert.equal(view(300, c).lastRan, 'now');
        assert.equal(view(100, c).lastRan, 'history');
    });
    it('band colours', () => {
        const c = byName('Difficult Run');
        assert.equal(view(300, c).lineColor, 'var(--accent-green)');
        assert.equal(view(500, c).lineColor, 'var(--accent-amber)');
        assert.equal(view(1500, c).lineColor, 'var(--accent-red)');
        assert.equal(view(1500, c).chartRgb, '239,68,68');
        assert.equal(view(500, c).chartRgb, '251,191,36');
    });
    it('trend arrows are neutral in colour, glyph and title still carry the meaning', () => {
        const c = byName('Difficult Run');
        for (const [t, g] of [['rising', '↑'], ['falling', '↓'], ['steady', '→']]) {
            const v = creekCardView({ q: 1500, trend: t, time: fresh }, c, NOW);
            assert.equal(v.trendColor, 'var(--text-tertiary)');
            assert.equal(v.trendText, g);
            assert.match(v.trendTitle, /^Flow /);
        }
    });
});

describe('the UI renders exactly what the pure module returns (fake DOM)', () => {
    function makeEl() {
        const classes = new Set();
        return {
            style: {}, textContent: '', title: '', innerHTML: '',
            classList: { toggle: (k, on) => { if (on) classes.add(k); else classes.delete(k); }, contains: (k) => classes.has(k), add: (k) => classes.add(k), remove: (k) => classes.delete(k) },
            setAttribute() {}, appendChild() {}, classes
        };
    }
    it('updateCreeksUI writes the pure module output for every card, the banner and the tab dot', async () => {
        const els = {};
        const tab = makeEl();
        globalThis.document = {
            getElementById: (id) => (els[id] ??= makeEl()),
            querySelector: () => tab
        };
        globalThis.localStorage = { getItem: () => new Date().toISOString(), setItem() {} };
        const { creekData } = await import('../src/state/store.js');
        const { updateCreeksUI } = await import('../src/ui/creeks-ui.js');
        const now = Date.now();
        const feed = { '01648010': 978, '01650500': 322, '01646000': 1620, '01650800': 150 };
        for (const k of Object.keys(creekData)) delete creekData[k];
        for (const [id, q] of Object.entries(feed)) creekData[id] = { q, trend: 'rising', time: new Date(now - 60_000), running: q >= CREEK_RUNS[id].runnable };
        updateCreeksUI();
        const bands = [];
        for (const [id, c] of Object.entries(CREEK_RUNS)) {
            const v = creekCardView(creekData[id], c, now);
            bands.push(v.band);
            assert.equal(els[`creek-status-${id}`].textContent, v.status);
            assert.equal(els[`creek-cfs-${id}`].textContent, v.cfsText);
            assert.equal(els[`creek-dot-${id}`].style.background, v.dotColor);
            assert.equal(els[`creek-${id}`].style.borderColor, v.borderColor);
            assert.equal(els[`creek-trend-${id}`].style.color, 'var(--text-tertiary)');
        }
        const b = creekBanner(bands, 4);
        assert.equal(els['creeks-status'].innerHTML, `<div class="creeks-banner ${b.tone}">${b.emoji} ${b.text}</div>`);
        assert.match(els['creeks-status'].innerHTML, /3 of 4 creeks at or above their minimum flow · 1 at 5x or more/);
        assert.equal(els['creek-lastran-01646000'].textContent, '');
        assert.ok(tab.classes.has('has-veryhigh') && tab.classes.size === 1);
        // a reading that has gone stale is marked on the next refresh, even though creekData itself did not change
        creekData['01646000'].time = new Date(now - 4 * HOUR);
        updateCreeksUI();
        assert.match(els['creek-status-01646000'].textContent, /^Old reading: \d+ h ago it was 1620 cfs, 8\.1x the 200 cfs minimum\. The current level is unknown\.$/);
        assert.ok(!tab.classes.has('has-veryhigh'));
        assert.match(els['creeks-status'].innerHTML, /with old readings/);
        delete globalThis.document; delete globalThis.localStorage;
    });
    it('data:unavailable re-renders the creeks from the last known readings (re-audit item 2)', () => {
        const init = readFileSync(resolve(root, 'src/init.js'), 'utf8');
        assert.match(init, /on\('data:unavailable',\s*updateCreeksUI\)/);
        assert.match(init, /on\('data:updated',\s*updateCreeksUI\)/);
    });
    it('source guard: creeks-ui.js imports the pure module and holds no band text or colour logic', () => {
        const src = readFileSync(resolve(root, 'src/ui/creeks-ui.js'), 'utf8');
        assert.match(src, /import \{[^}]*creekCardView[^}]*creekBanner[^}]*creekTabDotClass[^}]*\} from '\.\/creek-level\.js'/);
        assert.ok(!/Running/.test(src));
        assert.ok(!/running \?/.test(src));
        assert.ok(!/accent-green/.test(src));
        assert.ok(!/d\.running|d\?\.running/.test(src));
    });
    it('creek definitions carry no upper value', () => {
        for (const c of Object.values(CREEK_RUNS)) assert.deepEqual(Object.keys(c).filter((k) => /upper|high/i.test(k)), []);
    });
});

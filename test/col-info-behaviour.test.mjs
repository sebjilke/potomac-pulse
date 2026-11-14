// v39.9: the "i" icons beside "24h Trend" and "Basin" in the gauge-list header. A click toggles an `open`
// class on that icon (and closes the other); a click anywhere else and Escape close both. Fake browser,
// real buildBranches from src/ui/gauges-ui.js.
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let B, doc, container, icons, containerListeners;
// The document-level handlers are bound once per page (module flag), so they are kept across tests.
const docListeners = [];

before(async () => {
    if (!globalThis.localStorage) {
        const m = new Map();
        globalThis.localStorage = {
            getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
            removeItem: (k) => { m.delete(k); }, clear: () => m.clear()
        };
    }
    const out = await build({
        stdin: { contents: `export { buildBranches } from ${JSON.stringify(resolve(root, 'src/ui/gauges-ui.js'))};`, resolveDir: root, sourcefile: 'col-info-entry.mjs', loader: 'js' },
        bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent'
    });
    B = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
});

const makeIcon = (name) => {
    const set = new Set(); const attrs = {};
    return {
        name, attrs,
        classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), toggle: (c) => (set.has(c) ? set.delete(c) : set.add(c)) },
        setAttribute: (k, v) => { attrs[k] = String(v); },
        closest(sel) { return sel === '.col-info' ? this : null; }
    };
};
const outside = { closest: () => null };
const clickOn = (target) => {
    const e = { target };
    for (const f of containerListeners.filter((l) => l.type === 'click')) f.fn(e);   // the delegated handler first
    for (const f of docListeners.filter((l) => l.type === 'click')) f.fn(e);         // then the bubbling document handler
};
const touchOn = (target) => { for (const f of docListeners.filter((l) => l.type === 'pointerdown')) f.fn({ target }); };
const press = (key) => { for (const f of docListeners.filter((l) => l.type === 'keydown')) f.fn({ key }); };
const open = () => icons.filter((i) => i.classList.contains('open')).map((i) => i.name);

beforeEach(() => {
    icons = [makeIcon('trend'), makeIcon('basin')];
    containerListeners = [];
    const dataset = {};
    container = { innerHTML: '', dataset, addEventListener: (type, fn) => containerListeners.push({ type, fn }) };
    const search = { value: '', addEventListener() {} };
    doc = {
        getElementById: (id) => (id === 'branches' ? container : id === 'gauge-search' ? search : { classList: { contains: () => false }, style: {} }),
        querySelectorAll: (sel) => (sel === '.col-info.open' ? icons.filter((i) => i.classList.contains('open')) : []),
        addEventListener: (type, fn) => docListeners.push({ type, fn })
    };
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
});

describe('column info icons: click, outside click, Escape', () => {
    it('a click opens that icon and sets aria-expanded; a second click closes it', () => {
        B.buildBranches();
        clickOn(icons[0]);
        assert.deepEqual(open(), ['trend']);
        assert.equal(icons[0].attrs['aria-expanded'], 'true');
        clickOn(icons[0]);
        assert.deepEqual(open(), []);
        assert.equal(icons[0].attrs['aria-expanded'], 'false');
    });
    it('opening the other icon closes the first', () => {
        B.buildBranches();
        clickOn(icons[0]);
        clickOn(icons[1]);
        assert.deepEqual(open(), ['basin']);
        assert.equal(icons[0].attrs['aria-expanded'], 'false');
    });
    it('a click anywhere else closes both', () => {
        B.buildBranches();
        clickOn(icons[1]);
        assert.deepEqual(open(), ['basin']);
        clickOn(outside);
        assert.deepEqual(open(), []);
    });
    it('a touch anywhere else closes both; a touch on the icon itself does not', () => {
        B.buildBranches();
        clickOn(icons[1]);
        touchOn(icons[1]);
        assert.deepEqual(open(), ['basin']);
        touchOn(outside);
        assert.deepEqual(open(), []);
        clickOn(icons[0]);
        touchOn({});                       // a target with no closest() (for example the document itself)
        assert.deepEqual(open(), []);
    });
    it('Escape closes both; other keys do not', () => {
        B.buildBranches();
        clickOn(icons[0]);
        press('Enter');
        assert.deepEqual(open(), ['trend']);
        press('Escape');
        assert.deepEqual(open(), []);
    });
    it('building the gauge list twice attaches the delegated click handler once and the document handlers once', () => {
        B.buildBranches();
        B.buildBranches();
        assert.equal(containerListeners.filter((l) => l.type === 'click').length, 1);
        // however many times the list was built in this file, the document got one click and one keydown handler
        assert.equal(docListeners.filter((l) => l.type === 'click').length, 1);
        assert.equal(docListeners.filter((l) => l.type === 'pointerdown').length, 1);
        assert.equal(docListeners.filter((l) => l.type === 'keydown').length, 1);
    });
});

// v39.8 (A): plain labels. Source-text checks for index.html and cap-indicator.js; the Great Falls card strings
// are checked by behaviour in clean-screen-behaviour.test.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ROW_EF_ONLY } from '../src/ui/cap-indicator.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const html = read('index.html');
const app = html.slice(0, html.indexOf('id="tab-docs"')); // the How It Works tab keeps its own wording

describe('plain labels in index.html (before the How It Works tab)', () => {
    for (const old of ['Target gauge', 'PoR →', 'LF scale', 'PoR→GF', 'GF→LF', 'Flow bin', 'Learned correction', '120% ceiling', 'EF Cross-check', 'power-law estimate']) {
        it(`no longer contains "${old}"`, () => assert.ok(!app.includes(old)));
    }
    it('keeps "90% CI" (the wording waits for TODO A8)', () => assert.ok(app.includes('>90% CI<')));
    it('the new wording is there', () => {
        for (const t of [
            'aria-label="Little Falls gauge, below Great Falls"',
            'Point of Rocks to Little Falls: ',
            'id="multVal" aria-label="travel time"',
            '>cfs<', '>ft<', '>on the Little Falls gauge scale<',
            '>Travel time, Point of Rocks to Great Falls<', '>Travel time, Great Falls to Little Falls<',
            '>Flow band<', '>Adjustment learned from past errors<', '>Display cap (120% of Little Falls)<',
            '>Edwards Ferry check<', '>Estimate from the Edwards Ferry gauge alone<'
        ]) assert.ok(app.includes(t), t);
    });
    it('v39.14: the gauge-scale caption is its own line under both numbers, not inside the ft column', () => {
        // The card (#gf-estimate-display) has text-align:center, so a line that is a direct child of the card is
        // centred. Inside the two-column row it widened the right column and sat right of centre.
        assert.ok(!app.includes('ft<br>'), 'the caption no longer shares the unit label');
        // ft label closes, its column closes, the row closes, then the caption, then the trend line.
        assert.match(app,
            />ft<\/div>\s*<\/div>\s*<\/div>\s*(?:<!--[^>]*-->\s*)?<div style="font-size:0\.55rem;color:var\(--text-muted\);">on the Little Falls gauge scale<\/div>\s*<div id="gf-trend"/);
        const card = app.slice(app.indexOf('id="gf-estimate-display"'), app.indexOf('id="gf-trend"'));
        assert.match(card, /id="gf-estimate-display"[^>]*text-align:center/, 'the card still centres its text');
        assert.equal(card.split('on the Little Falls gauge scale').length - 1, 1, 'the caption appears once in the card');
    });
    it('the legend line under the forecast cards is unchanged (PA-10)', () => {
        assert.ok(app.includes('vs now • tap card or graph for details</div>'));
        assert.ok(!app.includes('ft are on the Little Falls gauge scale'));
    });
});

describe('plain labels in the sources', () => {
    it('cap-indicator.js: the Edwards Ferry row text is spelled out', () => {
        assert.equal(ROW_EF_ONLY, 'N/A (Edwards Ferry only)');
        assert.ok(!/EF only/.test(read('src/ui/cap-indicator.js')));
    });
    it('great-falls-ui.js: no "(EF only)", "EF-ONLY", "(EF trend)" or "obs)" left (backstop; behaviour is tested separately)', () => {
        const src = read('src/ui/great-falls-ui.js');
        for (const old of ['(EF only)', 'EF-ONLY', '(EF trend)', 'obs)', '— EF only']) assert.ok(!src.includes(old), old);
    });
});

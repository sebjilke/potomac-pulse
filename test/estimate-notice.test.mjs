// v39.8 (B): the one notice box. Pure logic (estimate-notice.js) plus a source guard on the wiring.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { noticeView, applyNoticeView, NOTICE_CLOSING } from '../src/ui/estimate-notice.js';
import { describeCap, capView, CAP_LAG_CLAUSE, CAP_OLD_CLAUSE } from '../src/ui/cap-indicator.js';
import { DIVERGENCE_LINE } from '../src/ui/divergence-advisory.js';
import { RESIDUAL_LINE } from '../src/ui/residual-advisory.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const L = (n) => n.toLocaleString();
const HOUR = 3600000;

const NOW = new Date(2026, 10, 10, 16, 0).getTime();
const READ = new Date(2026, 10, 10, 14, 40).getTime();
const cut = describeCap({ shownCFS: 10800, uncappedCFS: 11999, ceilingLimitCFS: 10800, lfCFS: 9000, lfReadMs: READ, nowMs: NOW });
const CAP = cut.line;

// the seven combinations of the plan (C = cap line, E = Edwards Ferry advisory, R = Little Falls advisory)
const COMBOS = [
    ['1 C', true, false, false, [CAP]],
    ['2 E', false, true, false, [DIVERGENCE_LINE, NOTICE_CLOSING]],
    ['3 R', false, false, true, [RESIDUAL_LINE, NOTICE_CLOSING]],
    ['4 C+E', true, true, false, [CAP, DIVERGENCE_LINE, NOTICE_CLOSING]],
    ['5 C+R', true, false, true, [CAP, RESIDUAL_LINE, NOTICE_CLOSING]],
    ['6 E+R', false, true, true, [DIVERGENCE_LINE, RESIDUAL_LINE, NOTICE_CLOSING]],
    ['7 C+E+R', true, true, true, [CAP, DIVERGENCE_LINE, RESIDUAL_LINE, NOTICE_CLOSING]]
];
const visible = (v) => [v.capLine, v.efLine, v.lfLine, v.closing].filter(Boolean);

describe('noticeView: the seven combinations and none', () => {
    for (const [name, c, e, r, expected] of COMBOS) {
        it(`${name}: exact lines in the order cap, Edwards Ferry, Little Falls, closing`, () => {
            const v = noticeView({ capLine: c ? CAP : '', divergence: e, residual: r });
            assert.equal(v.hidden, false);
            assert.deepEqual(visible(v), expected);
            assert.equal(visible(v).join(' ').split('believe the river').length - 1, e || r ? 1 : 0, '"believe the river" at most once');
            assert.equal(v.closing, e || r ? NOTICE_CLOSING : '');
        });
    }
    it('none: hidden, every line empty', () => {
        const v = noticeView({ capLine: '', divergence: false, residual: false });
        assert.equal(v.hidden, true);
        assert.deepEqual(visible(v), []);
        assert.deepEqual(noticeView(), v);
    });
    it('the cap alone carries no closing sentence (it would be new caution wording)', () => {
        const v = noticeView({ capLine: CAP });
        assert.equal(v.closing, '');
        assert.ok(!visible(v).join(' ').includes('believe the river'));
        assert.ok(!visible(v).join(' ').includes('extra caution'));
    });
    it('each line is a lead-in plus a text, split for two spans', () => {
        const v = noticeView({ capLine: CAP, divergence: true, residual: true });
        assert.deepEqual([v.cap.lead, v.ef.lead, v.lf.lead], ['Capped:', 'Cross-check gauge disagrees:', 'Recent estimates ran low:']);
        for (const part of [v.cap, v.ef, v.lf]) assert.ok(part.text.length > 40 && !part.text.startsWith(' '));
        assert.equal(`${v.cap.lead} ${v.cap.text}`, CAP);
    });
});

describe('the sentences are only the ones the plan gives', () => {
    it('exact text of the three lines and the closing', () => {
        assert.equal(DIVERGENCE_LINE, 'Cross-check gauge disagrees: Edwards Ferry has read well above what the upstream gauges suggest for several hours. That can be gauge noise at low water, or water entering below those gauges, water this estimate may not fully see.');
        assert.equal(RESIDUAL_LINE, 'Recent estimates ran low: they came in well below what Little Falls later measured. That often means rain-swollen local streams are adding water the upstream gauges cannot see. The current number may be low too.');
        assert.equal(NOTICE_CLOSING, 'Treat this estimate with extra caution. If the river looks higher than the number, believe the river.');
    });
    it('never "upper limit", in any combination', () => {
        for (const [, c, e, r] of COMBOS) {
            const v = noticeView({ capLine: c ? CAP : '', divergence: e, residual: r });
            assert.ok(!/upper limit/i.test(visible(v).join(' ')));
        }
    });
});

describe('the cap line reaches the box unchanged', () => {
    const facts = (line) => [L(11999), L(10800), L(9000), '14:40', '120%', CAP_LAG_CLAUSE].every((f) => line.includes(f));
    it('cut', () => {
        const v = noticeView({ capLine: cut.line });
        assert.equal(v.capLine, cut.line);
        assert.ok(facts(v.capLine));
        assert.ok(v.capLine.startsWith('Capped: the model estimates '));
        assert.ok(!v.capLine.includes('which is'));
    });
    it('old reading', () => {
        const old = describeCap({ shownCFS: 10800, uncappedCFS: 11999, ceilingLimitCFS: 10800, lfCFS: 9000, lfReadMs: NOW - 4 * HOUR, nowMs: NOW });
        const v = noticeView({ capLine: old.line });
        assert.ok(v.capLine.endsWith(CAP_OLD_CLAUSE));
        assert.ok(v.capLine.includes(CAP_LAG_CLAUSE) && v.capLine.includes('120%'));
    });
    it('unknown figures: no number is invented, the lag sentence stays', () => {
        const unk = describeCap({ shownCFS: 10800, uncappedCFS: NaN, ceilingLimitCFS: 10800, lfCFS: 9000, lfReadMs: READ, nowMs: NOW });
        const v = noticeView({ capLine: unk.line });
        assert.equal(v.capLine, `Capped: the model reads higher than this. The cfs and ft shown are held at 120% of the latest Little Falls reading. ${CAP_LAG_CLAUSE}`);
        assert.ok(!/\d/.test(v.capLine.replace('120%', '')));
    });
    it('a tie has no line, so the box is hidden', () => {
        const tie = capView({ cfs: 13200, inputs: { ceilingApplied: true, uncappedCFS: 13200, ceilingLimitCFS: 13200, lfCFS: 11000, lfReadMs: READ } }, NOW);
        assert.equal(tie.noteHidden, true);
        assert.equal(noticeView({ capLine: tie.noteHidden ? '' : tie.line }).hidden, true);
    });
});

describe('applyNoticeView resets every slot', () => {
    const mk = () => {
        const o = {};
        for (const k of ['box', 'cap', 'ef', 'lf', 'closing']) o[k] = { hidden: true, textContent: 'stale' };
        for (const k of ['capLead', 'capText', 'efLead', 'efText', 'lfLead', 'lfText']) o[k] = { textContent: 'stale' };
        return o;
    };
    it('all on, then all off: nothing is left behind', () => {
        const els = mk();
        applyNoticeView(noticeView({ capLine: CAP, divergence: true, residual: true }), els);
        assert.equal(els.box.hidden, false);
        for (const k of ['cap', 'ef', 'lf', 'closing']) assert.equal(els[k].hidden, false, k);
        assert.equal(els.capLead.textContent, 'Capped:');
        assert.equal(els.efLead.textContent, 'Cross-check gauge disagrees:');
        assert.equal(els.lfLead.textContent, 'Recent estimates ran low:');
        assert.equal(els.closing.textContent, NOTICE_CLOSING);
        applyNoticeView(noticeView({}), els);
        assert.equal(els.box.hidden, true);
        for (const k of ['cap', 'ef', 'lf', 'closing']) assert.equal(els[k].hidden, true, k);
        for (const k of ['capLead', 'capText', 'efLead', 'efText', 'lfLead', 'lfText']) assert.equal(els[k].textContent, '', k);
        assert.equal(els.closing.textContent, '');
    });
    it('each combination, applied after the previous one, shows exactly its lines', () => {
        const els = mk();
        for (const [name, c, e, r] of [...COMBOS, ...COMBOS].reverse()) {
            applyNoticeView(noticeView({ capLine: c ? CAP : '', divergence: e, residual: r }), els);
            assert.equal(els.cap.hidden, !c, name); assert.equal(els.ef.hidden, !e, name);
            assert.equal(els.lf.hidden, !r, name); assert.equal(els.closing.hidden, !(e || r), name);
            assert.equal(els.efText.textContent === '', !e, name);
        }
    });
    it('only given elements are touched', () => {
        assert.doesNotThrow(() => applyNoticeView(noticeView({ capLine: CAP }), {}));
    });
});

describe('wiring (source guard; the behaviour is in clean-screen-behaviour.test.mjs)', () => {
    const ui = read('src/ui/great-falls-ui.js');
    it('great-falls-ui.js calls renderNotice(capV, divergenceShown, residualShown) and no longer imports the old copy', () => {
        assert.equal((ui.match(/renderNotice\(capV, divergenceShown, residualShown\);/g) || []).length, 1);
        // the old element ids are gone from the sources: test/hidden-leftovers.test.mjs
        assert.ok(!/ADVISORY_TITLE|ADVISORY_BODY/.test(ui));
    });
    it('the notice text goes in with textContent, never innerHTML', () => {
        const src = read('src/ui/estimate-notice.js');
        assert.ok(!/innerHTML|insertAdjacentHTML/.test(src));
        const fn = ui.slice(ui.indexOf('function renderNotice'), ui.indexOf('function clearNotice'));
        assert.ok(!/innerHTML/.test(fn));
    });
    it('index.html: one box, no role or aria-live, four fixed slots, three lead-in and text span pairs', () => {
        const html = read('index.html');
        const tag = html.match(/<div id="gf-notice"[^>]*>/)[0];
        assert.ok(/\bhidden\b/.test(tag) && !/role=|aria-live/.test(tag));
        for (const id of ['gf-notice-cap', 'gf-notice-ef', 'gf-notice-lf', 'gf-notice-closing',
            'gf-notice-cap-lead', 'gf-notice-cap-text', 'gf-notice-ef-lead', 'gf-notice-ef-text', 'gf-notice-lf-lead', 'gf-notice-lf-text']) {
            assert.ok(html.includes(`id="${id}"`), id);
        }
        assert.ok(!/id="gf-(divergence|residual)-advisory"/.test(html));
    });
    it('main.css spaces the visible lines', () => {
        assert.match(read('src/styles/main.css'), /#gf-notice > div:not\(\[hidden\]\) ~ div:not\(\[hidden\]\)\s*\{\s*margin-top:\s*4px;?\s*\}/);
    });
    it('no inline event handlers were added (CSP)', () => {
        const html = read('index.html');
        const box = html.slice(html.indexOf('id="gf-notice"'), html.indexOf('id="gfRetryBtn"'));
        assert.doesNotMatch(box, /\son[a-z]+=/i);
    });
});

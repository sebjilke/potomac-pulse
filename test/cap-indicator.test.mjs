// v39.3 (A4a): the 120% cap indicator (src/ui/cap-indicator.js) and the additive estimate fields it reads.
// Display only. The estimate, the cap and the learning are not touched (characterization and parity tests prove that).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadEstimators } from './characterization/harness.mjs';
import { GAUGES, NOW } from './characterization/fixtures.mjs';
import { applyGFCorrection } from '../src/model/shared-model.js';
import { OLD_MIN, clock } from '../src/ui/data-freshness.js';
import {
    describeCap, capView, applyCapView, ciRowText, formatClock, CAP_LAG_CLAUSE,
    CAP_HEADLINE, ROW_NONE, ROW_EF_ONLY, ROW_NOT_ACTIVE, ROW_ACTIVE, ROW_TIE, CI_SUFFIX
} from '../src/ui/cap-indicator.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const HOUR = 3_600_000;
const MIN = 60_000;
// Local-time instants, so expected strings do not depend on the time zone the suite runs in.
const local = (d, h, m) => new Date(2026, 10, d, h, m).getTime();
const NOW_LOCAL = local(10, 15, 0);
// Numbers are formatted by the same call as the big number on the card (the browser locale), so expectations use it too.
const L = (n) => n.toLocaleString();

// ---- real estimators, as in test/ensemble-parity.test.mjs ----
const E = await loadEstimators();
function porSeries(current, perHourDelta, cadenceMin = 10, spanHours = 7) {
    const pts = [];
    for (let m = 0; m <= spanHours * 60; m += cadenceMin) {
        const h = m / 60;
        pts.push({ timestamp: NOW - h * HOUR, cfs: Math.round(current - perHourDelta * h), stage: null });
    }
    return pts.sort((a, b) => a.timestamp - b.timestamp);
}
const efState = (stage) => ({ current: { stage, timestamp: NOW }, history: [{ stage, timestamp: NOW }], correlation: null });
function fixture({ por, lf, lfH, lfRead = null, lfIce = false }) {
    return {
        data: {
            '01638500': { q: por, h: null },
            '01646500': { q: lf, h: lfH, ...(lfRead ? { readTime: lfRead } : {}), ...(lfIce ? { iceAffected: true } : {}) },
            '01643000': { q: 900 }, '01644000': { q: 400 }, '01644280': { q: 90 }, '01645000': { q: 110 },
            '01644148': { h: 5.2 },
        },
        porHistory: porSeries(por, 0),
        gfLearningData: null,
        edwardsFerryData: efState(5.2),
        waterTempC: 18,
    };
}
function runClient(base) {
    const f = structuredClone(base);
    f.data._mult = { mult: E.model.getFlowMultiplier(f.data[GAUGES.lf].q).mult };
    E.store.setData(f.data);
    E.store.setPorHistory(f.porHistory);
    E.store.setGfLearningData(f.gfLearningData ?? null);
    E.store.setEdwardsFerryData(f.edwardsFerryData);
    E.store.setWaterTempC(f.waterTempC ?? null);
    return E.estimateGreatFalls();
}
function runServer(base, trace) {
    const f = structuredClone(base);
    return E.makeGFPrediction({ gauges: GAUGES, data: f.data }, f.porHistory, f.waterTempC ?? null, {}, trace);
}
const frozen = (fn) => { const r = Date.now; try { Date.now = () => NOW; return fn(); } finally { Date.now = r; } };

const LF_READ = local(10, 14, 40);
const BOUND = fixture({ por: 13000, lf: 9000, lfH: 3.6, lfRead: LF_READ });

describe('A4a end to end: a real bound fixture (por 13000, lf 9000)', () => {
    const trace = {};
    const { c, s } = frozen(() => ({ c: runClient(BOUND), s: runServer(BOUND, trace) }));

    it('the cap binds on both client and server (guards against a vacuous test)', () => {
        assert.equal(c.inputs.ceilingApplied, true);
        assert.equal(s.ceilingApplied, true);
    });
    it('the new fields equal the model\'s own pre-cap value and limit', () => {
        assert.equal(c.cfs, 10800);
        assert.equal(c.inputs.ceilingLimitCFS, 10800);
        assert.equal(c.inputs.ceilingLimitCFS, Math.round(trace.ceilLim));
        assert.equal(c.inputs.uncappedCFS, Math.round(trace.unc));
        assert.equal(c.inputs.uncappedCFS, 11999);
        assert.equal(c.inputs.lfCFS, 9000);
        assert.equal(c.inputs.lfCFS, s.lfCFS);
        assert.equal(c.inputs.lfReadMs, LF_READ);
        assert.ok(c.inputs.uncappedCFS > c.cfs);
    });
    it('capView on the real estimate shows the note with the model value, the shown value and the LF value', () => {
        const v = capView(c, NOW_LOCAL);
        assert.equal(v.noteHidden, false);
        assert.equal(v.line,
            `Capped: the model estimates ${L(11999)} cfs. The cfs and ft shown are held at ${L(10800)} cfs, 120% of the latest Little Falls reading (${L(9000)} cfs at 14:40). `
            + 'The real flow may be above the number shown, especially on a rising river, where Little Falls responds later.');
        assert.equal(v.rowText, `Active (model said ${L(11999)} cfs)`);
        assert.equal(v.ciSuffix, ' (around the capped value)');
    });
    it('an unbound real fixture hides the note and says Not active', () => {
        const u = frozen(() => runClient(fixture({ por: 13000, lf: 12000, lfH: 3.92, lfRead: LF_READ })));
        assert.equal(u.inputs.ceilingApplied, false);
        const v = capView(u, NOW_LOCAL);
        assert.equal(v.noteHidden, true);
        assert.equal(v.rowText, 'Not active');
        assert.equal(v.ciSuffix, '');
    });
    it('a real EF-only estimate (LF ice-affected) has no cap and a hidden note (PA-10)', () => {
        const e = frozen(() => runClient(fixture({ por: 13000, lf: 9000, lfH: 3.6, lfIce: true })));
        assert.ok(e && e.efOnly === true, 'expected the EF-only estimate');
        assert.equal(e.inputs.ceilingApplied, undefined);
        const v = capView(e, NOW_LOCAL);
        assert.equal(v.noteHidden, true);
        assert.equal(v.rowText, 'N/A (Edwards Ferry only)');
    });
});

describe('A4a wording (PA-1, PA-5)', () => {
    const d = describeCap({ shownCFS: 13200, uncappedCFS: 14300, ceilingLimitCFS: 13200, lfCFS: 11000, lfReadMs: LF_READ, nowMs: NOW_LOCAL });
    const unk = describeCap({ shownCFS: 13200, uncappedCFS: NaN, ceilingLimitCFS: 13200, lfCFS: 11000, lfReadMs: null, nowMs: NOW_LOCAL });
    for (const [name, x] of [['cut', d], ['unknown', unk]]) {
        it(`${name}: never says "upper limit", says the real flow may be above the number shown`, () => {
            const all = x.line;
            assert.ok(!/upper limit/i.test(all));
            assert.ok(!/at most|no more than|maximum/i.test(all));
            assert.ok(all.includes('may be above the number shown'));
            assert.ok(all.endsWith('The real flow may be above the number shown, especially on a rising river, where Little Falls responds later.'));
            assert.equal(CAP_LAG_CLAUSE, 'The real flow may be above the number shown, especially on a rising river, where Little Falls responds later.');
            assert.ok(!/lags a rising river/.test(all), 'the causal clause is gone: the cap also binds on steady and falling rivers');
            assert.ok(x.line.includes('The cfs and ft shown are held'));
            assert.ok(x.line.startsWith('Capped:'));
            if (name === 'unknown') assert.ok(x.line.includes('the model reads higher than this'));
        });
    }
    it('index.html How It Works does not say "upper limit" either', () => {
        assert.ok(!/upper limit/i.test(read('index.html')));
    });
});

describe('A4a clock time and old-reading clause (PA-3)', () => {
    const at = (readMs, nowMs = NOW_LOCAL) => describeCap({ shownCFS: 13200, uncappedCFS: 14300, ceilingLimitCFS: 13200, lfCFS: 11000, lfReadMs: readMs, nowMs }).line;
    it('formats an absolute clock time', () => {
        assert.ok(at(local(10, 14, 40)).includes(`(${L(11000)} cfs at 14:40)`));
        assert.equal(formatClock(local(10, 0, 5), NOW_LOCAL), '0:05');
        assert.equal(formatClock(local(10, 12, 0), NOW_LOCAL), '12:00');
    });
    it('adds a short date when the reading is from an earlier day', () => {
        assert.ok(at(local(9, 23, 50)).includes('at Nov 9, 23:50'));
    });
    it('omits the clause when the read time is unknown', () => {
        const t = at(null);
        assert.ok(t.includes(`(${L(11000)} cfs)`));
        assert.ok(!/cfs at /.test(t));
    });
    it('no relative age text and no invented threshold', () => {
        const t = at(local(10, 13, 0));
        assert.ok(!/min ago|read \d+ min/.test(t));
    });
    it('the "over 3 h old" clause starts at the existing old band (180 min)', () => {
        assert.equal(OLD_MIN, 180);
        assert.ok(!at(NOW_LOCAL - 179 * MIN).includes('over 3 h old'));
        assert.ok(at(NOW_LOCAL - 180 * MIN).includes('That Little Falls reading is over 3 h old.'));
        assert.ok(at(NOW_LOCAL - 400 * MIN).includes('over 3 h old'));
    });
});

describe('A4a rounding ties and non-integer LF (PA-7), through the real helper', () => {
    // Build the estimate the page would hold from the real applyGFCorrection output.
    function viaHelper(rawFinalUnclipped, lfCFS) {
        const r = applyGFCorrection({ rawFinalUnclipped, lfCFS, correctionBins: null, flowState: 'steady' });
        const est = {
            cfs: Math.round(r.correctedFinal),
            inputs: {
                ceilingApplied: r.ceilingApplied, uncappedCFS: Math.round(r.correctedFinalUnclipped),
                ceilingLimitCFS: Math.round(lfCFS * 1.2), lfCFS: Math.round(lfCFS), lfReadMs: LF_READ
            }
        };
        return { r, view: capView(est, NOW_LOCAL), est };
    }
    it('exactly 120%: the helper does not bind, the view is Not active', () => {
        const { r, view } = viaHelper(13200, 11000);
        assert.equal(r.ceilingApplied, false);
        assert.equal(view.noteHidden, true);
        assert.equal(view.rowText, ROW_NOT_ACTIVE);
    });
    it('just above (+0.4): binds, rounds to a tie; note hidden, row says so, CI still marked', () => {
        const { r, view } = viaHelper(13200.4, 11000);
        assert.equal(r.ceilingApplied, true);
        assert.equal(view.noteHidden, true);
        assert.equal(view.rowText, 'Active (changed it by under 1 cfs)');
        assert.equal(view.ciSuffix, ' (around the capped value)');
        assert.equal(view.line, '');
    });
    it('one above (+1): the note shows with figures', () => {
        const { r, view } = viaHelper(13201, 11000);
        assert.equal(r.ceilingApplied, true);
        assert.equal(view.noteHidden, false);
        assert.ok(view.line.startsWith(`Capped: the model estimates ${L(13201)} cfs. The cfs and ft shown are held at ${L(13200)} cfs`));
    });
    it('non-integer LF (11003.4): the stated 120% arithmetic stays within 1 cfs', () => {
        const { est, view } = viaHelper(14000, 11003.4);
        assert.equal(est.inputs.lfCFS, 11003);
        assert.equal(est.cfs, 13204);
        assert.ok(view.line.includes(`held at ${L(13204)} cfs, 120% of the latest Little Falls reading (${L(11003)} cfs`));
        assert.ok(Math.abs(est.cfs - est.inputs.lfCFS * 1.2) < 1);
    });
});

describe('A4a missing or inconsistent figures (PA-7)', () => {
    const good = { shownCFS: 13200, uncappedCFS: 14300, ceilingLimitCFS: 13200, lfCFS: 11000, lfReadMs: LF_READ, nowMs: NOW_LOCAL };
    for (const [name, patch] of [
        ['uncapped missing', { uncappedCFS: undefined }], ['uncapped NaN', { uncappedCFS: NaN }],
        ['limit missing', { ceilingLimitCFS: undefined }], ['lf zero', { lfCFS: 0 }], ['lf missing', { lfCFS: null }],
        ['shown missing', { shownCFS: undefined }], ['uncapped below shown', { uncappedCFS: 13000 }],
        ['limit differs from shown', { ceilingLimitCFS: 13000 }],
    ]) {
        it(`${name}: generic text, no invented number, row just says Active`, () => {
            const d = describeCap({ ...good, ...patch });
            assert.equal(d.kind, 'unknown');
            assert.ok(d.line.startsWith(CAP_HEADLINE));
            assert.equal(d.rowText, ROW_ACTIVE);
            assert.ok(!/\d/.test(d.line.replace('120%', '')), d.line);
        });
    }
});

describe('A4a reset in every branch and real assignments (PA-4, PA-6, PA-8)', () => {
    const mk = () => ({
        row: { textContent: 'stale' }, ci: { textContent: '9,000 – 12,000 cfs' }
    });
    const bound = { cfs: 10800, inputs: { ceilingApplied: true, uncappedCFS: 11999, ceilingLimitCFS: 10800, lfCFS: 9000, lfReadMs: LF_READ } };

    it('a bound view sets the ceiling row (v39.8: the sentence goes to the notice box, see estimate-notice.test.mjs)', () => {
        const els = mk();
        applyCapView(capView(bound, NOW_LOCAL), els);
        assert.ok(capView(bound, NOW_LOCAL).line.includes(L(11999)));
        assert.equal(els.row.textContent, `Active (model said ${L(11999)} cfs)`);
        assert.equal(els.ci.textContent, '9,000 – 12,000 cfs', 'applyCapView no longer touches the CI row, so render order cannot change it');
    });
    it('ciRowText (PA-9, order-independent): the capped case gets the suffix, from a pure function', () => {
        const range = `${L(9000)} – ${L(12000)} cfs`;
        assert.equal(ciRowText(range, capView(bound, NOW_LOCAL)), `${range} (around the capped value)`);
        const tie = { cfs: 13200, inputs: { ceilingApplied: true, uncappedCFS: 13200, ceilingLimitCFS: 13200, lfCFS: 11000, lfReadMs: LF_READ } };
        assert.equal(ciRowText(range, capView(tie, NOW_LOCAL)), range + CI_SUFFIX, 'tie: note hidden but CI still marked');
        assert.equal(ciRowText(range, capView({ cfs: 5000, inputs: { ceilingApplied: false } }, NOW_LOCAL)), range);
        assert.equal(ciRowText(range, capView(null, NOW_LOCAL)), range);
    });
    it('ciRowText leaves a row with no range alone', () => {
        const v = capView(bound, NOW_LOCAL);
        assert.equal(ciRowText('--', v), '--');
        assert.equal(ciRowText('N/A (Edwards Ferry only)', v), 'N/A (Edwards Ferry only)');
        assert.equal(ciRowText('', v), '');
    });
    for (const [name, est, row] of [['loading or no estimate', null, ROW_NONE], ['EF only', { efOnly: true, cfs: 5000, inputs: {} }, ROW_EF_ONLY]]) {
        it(`${name}: after a bound render the view has no line and the row is reset`, () => {
            const els = mk();
            applyCapView(capView(bound, NOW_LOCAL), els);
            const v = capView(est, NOW_LOCAL);
            applyCapView(v, els);
            assert.equal(v.noteHidden, true);
            assert.equal(v.line, '');
            assert.equal(els.row.textContent, row);
        });
    }
    it('unbound after bound: no line, row Not active', () => {
        const els = mk();
        applyCapView(capView(bound, NOW_LOCAL), els);
        const v = capView({ cfs: 5000, inputs: { ceilingApplied: false } }, NOW_LOCAL);
        applyCapView(v, els);
        assert.equal(v.line, '');
        assert.equal(els.row.textContent, ROW_NOT_ACTIVE);
    });
    it('constants are what the tests above assume', () => {
        assert.equal(ROW_TIE, 'Active (changed it by under 1 cfs)');
        assert.equal(CI_SUFFIX, ' (around the capped value)');
    });
});

describe('A4a number and clock formats match the page (item 4)', () => {
    it('the note formats numbers with the same call as the big number: toLocaleString()', () => {
        const src = read('src/ui/cap-indicator.js');
        assert.ok(!/en-US/.test(src));
        assert.ok(/Math\.round\(n\)\.toLocaleString\(\)/.test(src));
        assert.ok(/gfEstimate\.cfs\.toLocaleString\(\)/.test(read('src/ui/great-falls-ui.js')));
    });
    it('the note clock is the header label clock (24 hour, H:MM), not 12 hour', () => {
        assert.equal(formatClock(local(10, 14, 40), NOW_LOCAL), clock(local(10, 14, 40)));
        assert.ok(!/AM|PM/.test(formatClock(local(10, 14, 40), NOW_LOCAL)));
    });
    // Setting process.env.TZ at run time changes the zone Node uses, so these hold under any TZ the suite runs in.
    function inZone(tz, fn) {
        const before = process.env.TZ;
        process.env.TZ = tz;
        try { return fn(); } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
    }
    const INSTANT = Date.UTC(2026, 10, 10, 19, 40); // 19:40 UTC
    for (const [tz, expected] of [['America/New_York', '14:40'], ['Asia/Kolkata', '1:10'], ['UTC', '19:40']]) {
        it(`the clock is local time, not UTC (${tz} shows ${expected})`, () => {
            inZone(tz, () => {
                const text = formatClock(INSTANT, INSTANT);
                assert.equal(text, expected);
                assert.equal(text, clock(INSTANT));
            });
        });
    }
    it('the date prefix also follows the local calendar day (Kolkata is already Nov 11)', () => {
        inZone('Asia/Kolkata', () => {
            assert.equal(formatClock(INSTANT, INSTANT + 24 * HOUR), 'Nov 11, 1:10');
        });
    });
});

describe('A4a wiring in the page (source guard; the behaviour is tested above)', () => {
    const ui = read('src/ui/great-falls-ui.js');
    const body = ui.slice(ui.indexOf('export function updateGreatFallsUI'));
    it('the two early returns reset the cap indicator, and the main path renders it exactly once', () => {
        const parts = body.split(/\n\s*return;\n/);
        assert.ok(parts.length >= 3, 'expected at least two early returns before the main path');
        for (const seg of parts.slice(0, 2)) {
            assert.ok(/renderCapIndicator\(null\)/.test(seg), 'a branch returns without resetting the cap indicator');
        }
        assert.equal((body.match(/renderCapIndicator\(gfEstimate\)/g) || []).length, 1);
        assert.equal((body.match(/renderCapIndicator\(null\)/g) || []).length, 2, 'loading and no-estimate branches');
    });
    it('the cap ROW is rendered immediately after the big number is written (the cap sentence is set later, in renderNotice)', () => {
        const write = body.indexOf('document.getElementById("gf-cfs").textContent = gfEstimate.cfs.toLocaleString();');
        const render = body.indexOf('renderCapIndicator(gfEstimate)');
        assert.ok(write > 0 && render > write);
        const between = body.slice(write, render).split('\n').slice(1)
            .filter((l) => l.trim() && !l.trim().startsWith('//')).join('\n').trim();
        assert.equal(between, 'const capV =', 'only the assignment may sit between the number write and the cap render');
    });
    it('the 90% CI row text is built with ciRowText from the cap view, so render order cannot drop the suffix', () => {
        assert.ok(/getElementById\("gf-input-uncertainty"\)\.textContent = ciRowText\([\s\S]*?, capV\);/.test(body));
        assert.ok(!/gf-input-uncertainty"\)\.textContent \+=/.test(body));
    });
    it('index.html has the notice box (hidden, no role) and the ceiling row; the old cap note is gone', () => {
        const html = read('index.html');
        const tag = html.match(/<div id="gf-notice"[^>]*>/);
        assert.ok(tag, 'gf-notice missing');
        assert.ok(/\bhidden\b/.test(tag[0]));
        assert.ok(!/role=|aria-live/.test(tag[0]));
        assert.ok(html.includes('id="gf-input-ceiling"'));
        // the old ids are gone from index.html, src/ and test/: test/hidden-leftovers.test.mjs
    });
});

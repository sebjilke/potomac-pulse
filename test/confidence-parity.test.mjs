// v39.6 (A8): binds the SERVER copies of the confidence label, its advisory downgrade, the 90% band
// table and the band formula to the BROWSER's. The server copies exist only for the audit log
// (tick_log.conf, tick_log.ci). Nothing here changes what the browser displays.
//
// How the label is bound: the test takes the exact SOURCE TEXT of the browser's label block
// (src/estimation/great-falls.js, between the "Confidence" and "Forecast" markers) and of the
// shownConfidence lines (src/ui/great-falls-ui.js), EXECUTES that text for all 96 input combinations
// and compares with the server copy. Edit the browser lines and either the table changes or the markers
// stop matching; both fail this test until the server copy is updated too. The browser code is not
// refactored (that would touch the estimate module).

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEstimators } from './characterization/harness.mjs';
import { EMPIRICAL_CI_90 } from '../src/model/constants.js';
import { downgradeConfidence } from '../src/ui/divergence-advisory.js';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { _test } = require('../netlify/functions/scheduled-update.js');
const ciTable = require('../netlify/functions/shared/ci-table.js');   // a load-time error here would crash every tick
const { computeUncertaintyBand } = await loadEstimators();

const GF = readFileSync(resolve(ROOT, 'src/estimation/great-falls.js'), 'utf8');
const UI = readFileSync(resolve(ROOT, 'src/ui/great-falls-ui.js'), 'utf8');

// ── the browser label block, as source text ──
function extractLabelBlock() {
    const start = GF.indexOf('    // Confidence\n');
    const end = GF.indexOf('    // Forecast (current readings arriving at GF)');
    assert.ok(start >= 0 && end > start, 'browser label markers ("// Confidence" ... "// Forecast") not found: the label code moved; update the server copy and this test together');
    return GF.slice(start, end);
}
const LABEL_SRC = extractLabelBlock();
const labelFn = new Function('monocacy', 'goose', 'useTimeShifted', 'useEfEnsemble', 'getEdwardsFerryTrend', 'flowState', 'console',
    LABEL_SRC + '\nreturn confidence;');
const quiet = { log() {} };
function browserLabel({ hasTribs, shifted, efUsed, efTrend, flowState }) {
    return labelFn(hasTribs ? { q: 100 } : {}, hasTribs ? { q: 50 } : null, shifted, efUsed, () => efTrend, flowState, quiet);
}

const SHOWN_MATCH = UI.match(/ *let shownConfidence = gfEstimate\.confidence;\n(?: *if \((?:divergenceShown|residualShown)\) shownConfidence = downgradeConfidence\(shownConfidence\);\n){2}/);
test('the browser shownConfidence lines are where the test expects them', () => {
    assert.ok(SHOWN_MATCH, 'great-falls-ui.js shownConfidence lines changed: update the server copy and this test together');
    assert.match(SHOWN_MATCH[0], /if \(divergenceShown\)[\s\S]*if \(residualShown\)/, 'order: EF advisory first, then LF residual');
});
const shownFn = new Function('gfEstimate', 'divergenceShown', 'residualShown', 'downgradeConfidence', SHOWN_MATCH[0] + '\nreturn shownConfidence;');

const TRENDS = [null, 'rising', 'falling', 'steady'];
const STATES = ['rising', 'falling', 'steady'];
const BOOLS = [false, true];

test('confidenceLabel equals the executed browser code for all 96 input combinations', () => {
    let n = 0;
    for (const hasTribs of BOOLS) for (const shifted of BOOLS) for (const efUsed of BOOLS)
        for (const efTrend of TRENDS) for (const flowState of STATES) {
            const inp = { hasTribs, shifted, efUsed, efTrend, flowState };
            assert.equal(_test.confidenceLabel(inp), browserLabel(inp), JSON.stringify(inp));
            n++;
        }
    assert.equal(n, 96);
});

test('the label table is not degenerate (all three labels occur, the trend can move it)', () => {
    const seen = new Set();
    let moved = 0;
    for (const hasTribs of BOOLS) for (const shifted of BOOLS) for (const efUsed of BOOLS) for (const flowState of STATES) {
        const base = browserLabel({ hasTribs, shifted, efUsed, efTrend: null, flowState });
        seen.add(base);
        for (const efTrend of TRENDS.slice(1)) if (browserLabel({ hasTribs, shifted, efUsed, efTrend, flowState }) !== base) moved++;
    }
    assert.deepEqual([...seen].sort(), ['high', 'low', 'medium']);
    assert.ok(moved > 0, 'a long-open tab can show a different label: that is why the log says "fresh load"');
});

test('downgradeLabel equals the browser downgradeConfidence, and shownLabel equals the executed shownConfidence lines', () => {
    for (const level of ['high', 'medium', 'low']) {
        assert.equal(_test.downgradeLabel(level), downgradeConfidence(level), level);
        for (const advEf of BOOLS) for (const advLfr of BOOLS) {
            assert.equal(_test.shownLabel(level, advEf, advLfr), shownFn({ confidence: level }, advEf, advLfr, downgradeConfidence), `${level} ${advEf} ${advLfr}`);
        }
    }
});

test('unknown advisory state gives null, never "inactive"', () => {
    assert.equal(_test.shownLabel('high', null, false), null);
    assert.equal(_test.shownLabel('high', false, null), null);
    assert.equal(_test.shownLabel('high', undefined, undefined), null);
});

test('buildConf: freshLoad uses the fresh-load rule (no Edwards Ferry trend); ingredients are echoed', () => {
    const g = (name) => ({ monocacy: { q: 800 }, goose: { q: 350 } }[name] || null);
    const pred = { useTimeShifted: true, useEfEnsemble: false, flowState: 'rising' };
    const c = _test.buildConf(pred, g, { ef: true, lfr: false });
    assert.equal(c.freshLoad, 'high');
    assert.equal(c.freshLoadShown, 'medium');
    assert.deepEqual([c.tribs, c.shift, c.ef, c.st, c.advEf, c.advLfr], [true, true, false, 'rising', true, false]);
    assert.equal(_test.buildConf(null, g, null), null);
    assert.equal(_test.buildConf(pred, g, null).freshLoadShown, null);
    assert.equal(_test.buildConf(pred, () => null, { ef: false, lfr: false }).tribs, false);
});

// ── band ──
test('ci-table.js deep-equals the browser EMPIRICAL_CI_90 and is frozen', () => {
    assert.deepEqual(ciTable.EMPIRICAL_CI_90, EMPIRICAL_CI_90);
    assert.ok(Object.isFrozen(ciTable.EMPIRICAL_CI_90) && Object.isFrozen(ciTable.EMPIRICAL_CI_90['0-3000']) && Object.isFrozen(ciTable.EMPIRICAL_CI_90['0-3000'].rising));
});

const LOOKUP_MATCH = GF.match(/const ciData = EMPIRICAL_CI_90\[flowBin\];\n\s*if \(!ciData\) return null;\n\s*const stateCI = ciData\[flowState\] \|\| ciData\['all'\];/);
test('the browser band lookup lines are where the test expects them', () => {
    assert.ok(LOOKUP_MATCH, 'getGFUncertainty lookup changed: update ci-table.js bandFor and this test together');
});
const lookupFn = new Function('EMPIRICAL_CI_90', 'flowBin', 'flowState', LOOKUP_MATCH[0] + '\nreturn stateCI;');

test('bandFor equals the browser lookup plus computeUncertaintyBand on a grid (low floored at 0, unknown bin null, unknown state falls back to all)', () => {
    const ests = [0, 50, 200, 400, 2999, 3000, 5000, 11000, 24999, 40000, 80000];
    const states = ['rising', 'falling', 'steady', 'all', 'weird', undefined, null];
    let floored = 0, checked = 0;
    for (const bin of Object.keys(EMPIRICAL_CI_90)) for (const st of states) for (const est of ests) {
        const q = lookupFn(EMPIRICAL_CI_90, bin, st);
        const exp = computeUncertaintyBand(est, q.q05, q.q95);
        const got = ciTable.bandFor(est, bin, st);
        assert.deepEqual([got.lo, got.hi, got.q05, got.q95], [exp.lowCFS, exp.highCFS, q.q05, q.q95], `${bin} ${st} ${est}`);
        assert.equal(got.bin, bin);
        if (got.lo === 0 && est - q.q95 < 0) floored++;
        checked++;
    }
    assert.ok(floored > 0, 'grid includes cases where the low end is floored at 0');
    assert.ok(checked > 400);
    assert.equal(ciTable.bandFor(5000, 'no-such-bin', 'steady'), null);
    assert.equal(ciTable.bandFor(5000, undefined, 'steady'), null);
    assert.equal(ciTable.bandFor(5000, 'constructor', 'steady'), null);
    assert.equal(ciTable.bandFor(NaN, '3000-6000', 'steady'), null);
    assert.equal(ciTable.bandFor(null, '3000-6000', 'steady'), null);
});

test('capped case: the band is centred on the CAPPED value but uses the bin of the RAW UNCLIPPED final', () => {
    // raw 13000 (bin 12000-25000), capped to 11900 (a lower bin): the page keeps the raw bin's limits.
    const b = ciTable.bandFor(11900, '12000-25000', 'steady');
    assert.deepEqual([b.lo, b.hi, b.bin], [11900 - 425, 11900 + 549, '12000-25000']);
    const wrongBin = ciTable.bandFor(11900, '6000-12000', 'steady');
    assert.notDeepEqual([b.lo, b.hi], [wrongBin.lo, wrongBin.hi], 'the bin of the capped value would give different limits');
});

// ── Edwards Ferry trend rule ──
test('efTrendOfTail mirrors the browser rule (>= 4 entries, history[max(0,len-5)], +-2 percent, stage filter)', () => {
    const mk = (...v) => v.map((x, i) => ({ t: i * 900000, v: x }));
    assert.equal(_test.efTrendOfTail(mk(4, 4, 4)), null, 'fewer than 4');
    assert.equal(_test.efTrendOfTail(mk(4, 4, 4, 4.16)), 'rising', 'exactly 4 entries: looks 3 back (index 0), +4 percent');
    assert.equal(_test.efTrendOfTail(mk(4, 4, 4, 4.07)), 'steady', '+1.75 percent');
    assert.equal(_test.efTrendOfTail(mk(4.2, 4.2, 4.2, 4.2, 4.0)), 'falling');
    assert.equal(_test.efTrendOfTail(mk(4, 4, 4, 4, 4.12)), 'rising', '+3 percent');
    assert.equal(_test.efTrendOfTail(mk(4, 4, 4, 4, 3.88)), 'falling', '-3 percent');
    assert.equal(_test.efTrendOfTail(mk(4, 4, 4, 4, 4.04)), 'steady', '+1 percent');
    // 5+ entries compare with exactly 4 readings back
    assert.equal(_test.efTrendOfTail(mk(9, 4, 4, 4, 4, 4.0)), 'steady', 'the 9 is 5 back, not 4');
    // stage filter: sentinel and out-of-range readings are dropped before counting
    assert.equal(_test.efTrendOfTail(mk(-999999, 4, 4, 4.2, 100.5)), null, 'only 3 valid readings');
    assert.equal(_test.efTrendOfTail(null), null);
    assert.equal(_test.efTrendOfTail([]), null);
});

// A3 (v39.2): the estimate must not change by one bit when the audit trace is collected (T1),
// the trace must carry the right values (T2), and the two new reading-time fields must parse (T3).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../netlify/functions/scheduled-update');
const { makeGFPrediction, fetchUSGSData, fetchWaterTemp } = _test;

const NOW = 1_700_000_000_000;
const HOUR = 3600000;
const G = { por: '01638500', lf: '01646500', monocacy: '01643000', goose: '01644000', broadRun: '01644280', seneca: '01645000', ef: '01644148' };

function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const k of Object.keys(o)) deepFreeze(o[k]);
    }
    return o;
}

function build({ lf = 6500, por = 6000, ef = 3.2, mono = 800, goose = 350, br = 75, sen = 100, lfH = 3.85 } = {}) {
    const data = {
        [G.por]: { q: por, history: [] },
        [G.lf]: { q: lf, h: lfH },
        [G.monocacy]: mono == null ? {} : { q: mono },
        [G.goose]: goose == null ? {} : { q: goose },
        [G.broadRun]: br == null ? {} : { q: br },
        [G.seneca]: sen == null ? {} : { q: sen },
        [G.ef]: ef == null ? {} : { h: ef },
    };
    return { gauges: G, data };
}
// History from a function of "hours ago", every half hour, oldest first.
function hist(fn, spanH) {
    const h = [];
    for (let k = spanH; k >= 0; k -= 0.5) h.push({ cfs: fn(k), timestamp: NOW - k * HOUR });
    return h;
}
const steady = (cfs, spanH = 60) => hist(() => cfs, spanH);
// Step histories found by search: a non-converging one and one whose second lookup falls off the end.
const stepFn = (levels, span) => (k) => levels[Math.min(9, Math.floor(k / (span / 10 + 0.001)))];
const MAX_ITER = { levels: [2900, 1821, 1266, 8601, 9536, 2692, 4628, 3263, 2678, 902], span: 61 };
const HIST_LOST = { levels: [1491, 2417, 1822, 2662, 1192, 10466, 11151, 1303, 1664, 4686], span: 38 };

const quiet = (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    try { t.mock.timers.enable({ apis: ['Date'] }); } catch (_) { /* already enabled in this test */ }
    t.mock.timers.setTime(NOW);
};

const BINS_WITH_CORRECTION = { '3000-6000': { steady: { count: 12, meanError: 900, emaMeanError: 900, sumErrorSq: 10_200_000 } } };

// ── T1 ────────────────────────────────────────────────────────────────────────────────────────
describe('T1: makeGFPrediction is identical with and without a trace', () => {
    const cases = [
        ['steady, EF in range', () => ({ u: build(), h: steady(6000), t: 15, b: {} })],
        ['EF missing', () => ({ u: build({ ef: null }), h: steady(6000), t: 15, b: {} })],
        ['no historic PoR (short history)', () => ({ u: build(), h: steady(6000, 10), t: 15, b: {} })],
        ['empty history', () => ({ u: build(), h: [], t: null, b: {} })],
        ['all four tributaries missing', () => ({ u: build({ mono: null, goose: null, br: null, sen: null }), h: steady(6000), t: 15, b: {} })],
        ['cold water, EF', () => ({ u: build({ lf: 5000, por: 4800, ef: 3.5 }), h: steady(4800), t: 5, b: {} })],
        ['with a learned correction', () => ({ u: build({ lf: 5000, por: 4800, ef: 3.5 }), h: steady(4800), t: 18, b: BINS_WITH_CORRECTION })],
        ['PoR delta (falling river)', () => ({ u: build({ lf: 5000, por: 3000, ef: null }), h: steady(6000), t: 15, b: {} })],
        ['ceiling binds', () => ({ u: build({ lf: 3000, por: 20000, ef: null }), h: hist(k => Math.max(900, 20000 - k * 500), 70), t: 15, b: {} })],
        ['non-converging travel loop', () => ({ u: build({ lf: 6000, por: 2900, ef: null }), h: hist(stepFn(MAX_ITER.levels, MAX_ITER.span), MAX_ITER.span), t: 15, b: {} })],
        ['lookup lost on pass 2', () => ({ u: build({ lf: 6000, por: 1491, ef: null }), h: hist(stepFn(HIST_LOST.levels, HIST_LOST.span), HIST_LOST.span), t: 15, b: {} })],
    ];
    for (const [name, mk] of cases) {
        it(name, (t) => {
            quiet(t);
            const a = mk(), b = mk();
            const plain = makeGFPrediction(a.u, a.h, a.t, a.b);
            const trace = {};
            // scheduled-update.js is sloppy-mode CJS, so a write to a frozen object is silently ignored
            // rather than thrown. The input-snapshot comparison below is what actually catches a write.
            deepFreeze(b.u); deepFreeze(b.h); deepFreeze(b.b);
            const traced = makeGFPrediction(b.u, b.h, b.t, b.b, trace);
            const c = mk();
            const snap = JSON.stringify([c.u, c.h, c.b]);
            makeGFPrediction(c.u, c.h, c.t, c.b, {});
            assert.equal(JSON.stringify([c.u, c.h, c.b]), snap, 'the traced call must not mutate usgsData, history or bins');
            assert.deepEqual(traced, plain);
            assert.equal(JSON.stringify(traced), JSON.stringify(plain));
            assert.ok(plain, 'every fixture here yields a prediction');
            assert.ok(Object.keys(trace).length > 10, 'trace was actually filled');
            // and an explicit null behaves like the old 4-argument call
            assert.deepEqual(makeGFPrediction(mk().u, mk().h, a.t, a.b, null), plain);
        });
    }

    it('null return (LF missing) leaves the trace empty and still returns null', (t) => {
        quiet(t);
        const trace = {};
        assert.equal(makeGFPrediction(build({ lf: 0 }), steady(6000), 15, {}, trace), null);
        assert.deepEqual(trace, {});
    });

    it('server characterization fixtures: same output with a trace', async (t) => {
        quiet(t);
        const { FIXTURES, GAUGES } = await import('./characterization/fixtures.mjs');
        let n = 0;
        for (const fx of FIXTURES) {
            const mk = () => fx.build();
            const a = mk(), b = mk();
            const plain = makeGFPrediction({ gauges: GAUGES, data: a.data }, a.porHistory, a.waterTempC ?? null, a.gfLearningData?.correctionBins ?? {});
            const bins = deepFreeze(structuredClone(b.gfLearningData?.correctionBins ?? {}));
            deepFreeze(b.data); deepFreeze(b.porHistory);
            const traced = makeGFPrediction({ gauges: GAUGES, data: b.data }, b.porHistory, b.waterTempC ?? null, bins, {});
            assert.deepEqual(traced, plain, fx.name);
            n++;
        }
        assert.ok(n >= 8);
    });
});

// ── T2 ────────────────────────────────────────────────────────────────────────────────────────
describe('T2: trace content', () => {
    function run(t, u, h, temp = 15, bins = {}) {
        quiet(t);
        const trace = {};
        const pred = makeGFPrediction(u, h, temp, bins, trace);
        return { trace, pred };
    }

    it('converged on steady flow, one pass, first travel equals final', (t) => {
        const { trace } = run(t, build({ ef: null }), steady(6000));
        assert.equal(trace.stop, 'converged');
        assert.equal(trace.it, 1);
        assert.equal(trace.t0, trace.t);
        assert.equal(trace.nohist, false);
        assert.equal(trace.preShifted, true);
        assert.equal(trace.histCfs, 6000);
        assert.equal(trace.histTs % 60000, 0);
    });

    it('max_iter after the pass cap on a non-converging history', (t) => {
        const { trace } = run(t, build({ lf: 6000, por: 2900, ef: null }), hist(stepFn(MAX_ITER.levels, MAX_ITER.span), MAX_ITER.span));
        assert.equal(trace.stop, 'max_iter');
        assert.equal(trace.it, 3);
        assert.notEqual(trace.t0, trace.t);
        assert.equal(trace.nohist, false);
    });

    it('no_hist when the history cannot serve the lookup', (t) => {
        const { trace, pred } = run(t, build({ ef: null }), steady(6000, 10));
        assert.equal(trace.stop, 'no_hist');
        assert.equal(trace.it, 1);
        assert.equal(trace.nohist, true);
        assert.equal(trace.preShifted, false);
        assert.equal(trace.histTs, null);
        assert.equal(pred.useTimeShifted, false);
        assert.equal(trace.pct, undefined, 'no delta without a historic reading');
    });

    it('no_hist on an empty history', (t) => {
        const { trace } = run(t, build({ ef: null }), []);
        assert.equal(trace.stop, 'no_hist');
        assert.equal(trace.rate, null);
        assert.equal(trace.rst, null);
    });

    it('hist_lost when the second lookup falls off the history (NOT converged, NOT no_hist)', (t) => {
        const { trace, pred } = run(t, build({ lf: 6000, por: 1491, ef: null }), hist(stepFn(HIST_LOST.levels, HIST_LOST.span), HIST_LOST.span));
        assert.equal(trace.stop, 'hist_lost');
        assert.equal(trace.it, 2);
        assert.equal(trace.nohist, false, 'an earlier pass did find a reading');
        assert.equal(pred.useTimeShifted, true);
    });

    it('PoR delta values match a hand calculation', (t) => {
        // PoR now 3000, shifted reading 6000: change -50%, hours elapsed ~ travel so decay = min(cap, sqrt(frac))
        const { trace, pred } = run(t, build({ lf: 5000, por: 3000, ef: null }), steady(6000));
        assert.equal(trace.deltaOn, true);
        assert.ok(Math.abs(trace.pct - (-50)) < 1e-9);
        const frac = Math.min(1, pred.historicPorCFS ? (trace.histAgo / Math.max(1, trace.t)) : 0);
        const decay = Math.min(0.5, Math.sqrt(frac));
        assert.ok(Math.abs(trace.decay - decay) < 1e-9);
        assert.ok(Math.abs(trace.ratio - (1 + (0.5 - 1) * decay)) < 1e-9);
        const pre = 6000 + 800 + 350 + 75 + 100;
        assert.equal(trace.preCfs, pre);
        assert.equal(trace.porEst, Math.round(pre * trace.ratio));
        assert.equal(pred.porEstimateCFS, Math.round(trace.porEst));
    });

    it('no delta applied inside +/-5 percent', (t) => {
        const { trace } = run(t, build({ ef: null }), steady(6000));
        assert.equal(trace.deltaOn, false);
        assert.equal(trace.decay, undefined);
    });

    it('ceiling: lim is 120 percent of LF and bound equals ceilingApplied', (t) => {
        const a = run(t, build({ lf: 3000, por: 20000, ef: null }), hist(k => Math.max(900, 20000 - k * 500), 70));
        assert.equal(a.trace.ceilLim, 3000 * 1.2);
        assert.equal(a.trace.ceilBound, a.pred.ceilingApplied);
        assert.equal(a.pred.ceilingApplied, true);
        const b = run(t, build({ ef: null }), steady(6000));
        assert.equal(b.trace.ceilBound, false);
        assert.equal(b.trace.ceilBound, b.pred.ceilingApplied);
    });

    it('tributary fallback flags', (t) => {
        const { trace } = run(t, build({ mono: null, br: null }), steady(6000));
        assert.equal(trace.fbMono, true);
        assert.equal(trace.fbBr, true);
        assert.equal(trace.fbGoose, false);
        assert.equal(trace.fbSen, false);
        assert.ok(trace.monoFlow > 0 && trace.brFlow > 0, 'effective fallback flows recorded');
    });

    it('EF skip at more than 50 percent discrepancy', (t) => {
        // EF stage 4.5 -> ~12.5k cfs against a 7.3k PoR estimate: far over 50 percent
        const { trace, pred } = run(t, build({ ef: 6.5 }), steady(6000));
        assert.ok(trace.efDisc > 0.5);
        assert.equal(trace.efSkip, true);
        assert.equal(pred.useEfEnsemble, false);
    });

    it('EF used when close: disc under 0.5, skip false', (t) => {
        const { trace, pred } = run(t, build({ lf: 11000, por: 10000, ef: 6.2 }), steady(10000));
        assert.ok(trace.efDisc < 0.5);
        assert.equal(trace.efSkip, false);
        assert.equal(pred.useEfEnsemble, true);
    });

    it('correction: st matches flowState, unc equals raw minus correction, raw is unclipped', (t) => {
        const { trace, pred } = run(t, build({ lf: 5000, por: 4800, ef: null }), steady(4800), 18, BINS_WITH_CORRECTION);
        assert.equal(pred.flowState, 'steady');
        assert.ok(trace.corr !== 0, 'the seeded bin applies a correction');
        assert.equal(trace.unc, trace.rawUnc - trace.corr);
        assert.equal(pred.rawFinalCFS, Math.round(trace.rawUnc));
        assert.equal(pred.correctionApplied, Math.round(trace.corr));
    });

    it('the trace holds only primitives', (t) => {
        for (const mk of [
            () => run(t, build(), steady(6000)),
            () => run(t, build({ ef: null }), []),
            () => run(t, build({ lf: 6000, por: 2900, ef: null }), hist(stepFn(MAX_ITER.levels, MAX_ITER.span), MAX_ITER.span)),
        ]) {
            const { trace } = mk();
            for (const [k, v] of Object.entries(trace)) {
                assert.ok(v === null || ['number', 'string', 'boolean'].includes(typeof v), `${k} is ${typeof v}`);
            }
        }
    });
});

// ── T3 ────────────────────────────────────────────────────────────────────────────────────────
describe('T3: reading times', () => {
    function usgsJson({ lfVal = '11000', lfTime = '2026-02-25T12:15:00.000-05:00', lfStageTime = '2026-02-25T12:30:00.000-05:00' } = {}) {
        const ts = (site, param, value, dateTime) => ({
            sourceInfo: { siteCode: [{ value: site }] },
            variable: { variableCode: [{ value: param }] },
            values: [{ value: [{ value, dateTime, qualifiers: [] }] }],
        });
        return { value: { timeSeries: [
            ts('01646500', '00060', lfVal, lfTime),
            ts('01646500', '00065', '3.85', lfStageTime),
            ts('01638500', '00060', '10000', '2026-02-25T12:00:00.000-05:00'),
        ] } };
    }

    it('fetchUSGSData sets qTime next to q, like hTime next to h', async (t) => {
        t.mock.method(console, 'log', () => {});
        t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => usgsJson() }));
        const out = await fetchUSGSData();
        const lf = out.data['01646500'];
        assert.equal(lf.q, 11000);
        assert.equal(lf.qTime, Date.parse('2026-02-25T17:15:00.000Z'), 'offset parsed');
        assert.equal(lf.hTime, Date.parse('2026-02-25T17:30:00.000Z'));
        assert.equal(out.data['01638500'].qTime, Date.parse('2026-02-25T17:00:00.000Z'));
    });

    it('qTime is absent when the discharge reading is invalid', async (t) => {
        t.mock.method(console, 'log', () => {});
        t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => usgsJson({ lfVal: '-999999' }) }));
        const out = await fetchUSGSData();
        assert.equal(out.data['01646500'].q, undefined);
        assert.equal(out.data['01646500'].qTime, undefined);
        assert.equal(out.data['01646500'].iceAffected, true);
    });

    function tempJson(value, dateTime) {
        return { value: { timeSeries: [{ values: [{ value: [{ value: '1.0', dateTime: '2026-02-25T10:00:00.000-05:00' }, { value, dateTime }] }] }] } };
    }
    it('fetchWaterTemp(out) sets out.t and returns exactly what it returned before', async (t) => {
        t.mock.method(console, 'log', () => {});
        t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => tempJson('12.3', '2026-02-25T12:45:00.000-05:00') }));
        const out = {};
        const withOut = await fetchWaterTemp(out);
        const without = await fetchWaterTemp();
        assert.equal(withOut, 12.3);
        assert.equal(without, 12.3);
        assert.equal(out.t, Date.parse('2026-02-25T17:45:00.000Z'));
    });

    it('fetchWaterTemp(out) leaves out untouched when the reading is out of range', async (t) => {
        t.mock.method(console, 'log', () => {});
        t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => tempJson('99', '2026-02-25T12:45:00.000-05:00') }));
        const out = {};
        assert.equal(await fetchWaterTemp(out), null);
        assert.deepEqual(out, {});
    });
});

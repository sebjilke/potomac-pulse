// v39.6 (A5, A8): the estimate does not depend on anything the new logging adds, the Edwards Ferry
// tail copy cannot hurt the fetch, and the record builder survives bad new inputs.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../netlify/functions/scheduled-update');
const { makeGFPrediction, fetchUSGSData, buildTickRecord, pruneLogType, attachDr, buildValidationRecord } = _test;
const { createMemClient } = require('./helpers/mem-supabase');
const { usgsPayload } = require('./helpers/usgs-mock');

const NOW = 1_700_000_000_000;
const HOUR = 3600000;
const G = { por: '01638500', lf: '01646500', monocacy: '01643000', goose: '01644000', broadRun: '01644280', seneca: '01645000', ef: '01644148' };
const hist = (cfs, spanH = 60) => { const h = []; for (let k = spanH; k >= 0; k -= 0.5) h.push({ cfs, timestamp: NOW - k * HOUR }); return h; };
const quiet = (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    t.mock.timers.enable({ apis: ['Date'] });
    t.mock.timers.setTime(NOW);
};
const tailOf = (vals) => vals.map((v, i) => ({ t: NOW - (vals.length - 1 - i) * 900000, v }));
function build(efH, hTail) {
    const ef = { h: efH };
    if (hTail !== undefined) ef.hTail = hTail;
    return {
        gauges: G,
        data: {
            [G.por]: { q: 6000, history: [] }, [G.lf]: { q: 6500, h: 3.85 }, [G.monocacy]: { q: 800 },
            [G.goose]: { q: 350 }, [G.broadRun]: { q: 75 }, [G.seneca]: { q: 100 }, [G.ef]: ef,
        },
    };
}

describe('I1: makeGFPrediction is identical with the EF tail present and stripped', () => {
    const cases = {
        rising: [3.0, 3.05, 3.1, 3.2, 3.3, 3.4],
        falling: [3.4, 3.3, 3.2, 3.1, 3.0, 2.9],
        steady: [3.2, 3.2, 3.2, 3.2, 3.2, 3.2],
        short: [3.2, 3.25],
        junk: [-999999, 3.2, 150, 3.3],
    };
    for (const [name, vals] of Object.entries(cases)) {
        it(name, (t) => {
            quiet(t);
            const h = vals[vals.length - 1] > 0 && vals[vals.length - 1] < 100 ? vals[vals.length - 1] : 3.2;
            const withTail = makeGFPrediction(build(h, tailOf(vals)), hist(6000), 15, {}, null);
            const stripped = makeGFPrediction(build(h), hist(6000), 15, {}, null);
            const traceA = {}, traceB = {};
            const a = makeGFPrediction(build(h, tailOf(vals)), hist(6000), 15, {}, traceA);
            const b = makeGFPrediction(build(h), hist(6000), 15, {}, traceB);
            assert.ok(withTail && stripped);
            assert.deepEqual(withTail, stripped);
            assert.deepEqual(a, b);
            assert.deepEqual(traceA, traceB);
        });
    }

    it('the estimate does not read hTail even when the last raw EF reading is invalid (h absent) and a valid-looking tail exists', (t) => {
        quiet(t);
        const tails = [
            tailOf([3.2, 3.3, 3.4]),                 // plausible tail, no h
            tailOf([3.2, 3.3, -999999]),             // last raw reading invalid
            tailOf([3.4, 3.4, 3.4, 3.4, 3.4]),
            tailOf([150, 3.3]),
        ];
        for (const tl of tails) {
            const withTail = makeGFPrediction(build(undefined, tl), hist(6000), 15, {}, null);
            const stripped = makeGFPrediction(build(undefined), hist(6000), 15, {}, null);
            assert.ok(withTail && stripped);
            assert.deepEqual(withTail, stripped);
            assert.equal(withTail.useEfEnsemble, false, 'no EF stage, so no ensemble, tail or not');
        }
    });
    it('end to end: a payload whose last EF reading is the sentinel gives the same estimate with hTail present and stripped', async (t) => {
        quiet(t);
        t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => usgsPayload(NOW, { efVals: [3.2, 3.3, 3.4, -999999] }) }));
        const out = await fetchUSGSData();
        assert.ok(out.data[G.ef].hTail && out.data[G.ef].hTail.length === 4, 'the raw tail is kept, sentinel included');
        assert.equal(out.data[G.ef].h, undefined);
        const stripped = JSON.parse(JSON.stringify(out));
        delete stripped.data[G.ef].hTail;
        assert.deepEqual(makeGFPrediction(out, hist(6000), 15, {}, null), makeGFPrediction(stripped, hist(6000), 15, {}, null));
    });
    it('frozen input with a tail: no write to the usgs object', (t) => {
        quiet(t);
        const u = build(3.2, tailOf([3.1, 3.2]));
        const deepFreeze = (o) => { Object.freeze(o); for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object' && !Object.isFrozen(o[k])) deepFreeze(o[k]); return o; };
        deepFreeze(u);
        assert.ok(makeGFPrediction(u, hist(6000), 15, {}, null));
    });
});

describe('fetchUSGSData: the EF tail copy is additive and cannot hurt the fetch', () => {
    const mock = (t, payload) => { t.mock.method(console, 'log', () => {}); t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => payload })); };
    it('healthy: a plain-number tail of the last 16 readings, nothing else changed', async (t) => {
        const efVals = Array.from({ length: 20 }, (_, i) => 3 + i * 0.01);
        mock(t, usgsPayload(NOW, { efVals }));
        const out = await fetchUSGSData();
        const ef = out.data[G.ef];
        assert.equal(ef.hTail.length, 16);
        assert.equal(ef.hTail[15].v, efVals[19]);
        assert.equal(ef.h, efVals[19]);
        assert.ok(ef.hTail.every(x => Number.isFinite(x.t) && typeof x.v === 'number'));
        assert.equal(out.data[G.lf].q, 11000);
        assert.ok(!('hTail' in out.data[G.lf]) && !('hTail' in out.data[G.por]));
    });
    it('a malformed element inside the tail window: the tail is absent, every other value is identical', async (t) => {
        const efVals = [3.1, 3.2, 3.3, 3.4];
        const good = usgsPayload(NOW, { efVals });
        const bad = usgsPayload(NOW, { efVals });
        const efSeries = bad.value.timeSeries.find(s => s.sourceInfo.siteCode[0].value === G.ef);
        efSeries.values[0].value[1] = null;           // the existing parser only reads the LAST element
        mock(t, good);
        const a = await fetchUSGSData();
        t.mock.restoreAll();
        mock(t, bad);
        const b = await fetchUSGSData();
        assert.ok(b, 'the fetch still succeeded');
        assert.ok(!('hTail' in b.data[G.ef]));
        const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); delete c.data[G.ef].hTail; return c; };
        assert.deepEqual(strip(b), strip(a));
    });
});

describe('buildTickRecord: new fields survive bad inputs and keep the old shape', () => {
    function ctx(over = {}) {
        const usgsData = build(3.2, tailOf([3.0, 3.05, 3.1, 3.2, 3.3]));
        usgsData.data[G.lf].qTime = NOW - 900000;
        const prediction = makeGFPrediction(usgsData, hist(6000), 15, {}, {});
        return { stage: 'housekeeping', usgsData, waterTempC: 15, tempT: NOW, fullHistory: hist(6000), trace: {}, prediction, slot: 'stored', val: { n: 0, cleaned: 0 }, adv: { dbar: 1, ef: false, lfr: false, lfe: null }, ice: { lf: false, por: false, efMiss: false }, aux: {}, ...over };
    }
    it('schema 2, v39.6; conf and ci present; ci uses pred.flowBin and the capped predictedCFS', (t) => {
        quiet(t);
        const c = ctx();
        c.prediction = { ...c.prediction, predictedCFS: 11900, flowBin: '12000-25000', flowState: 'steady', rawFinalCFS: 13000 };   // capped: lower bin than the raw one
        const rec = buildTickRecord(c, NOW, { out: 'predicted', ms: 5 });
        assert.equal(rec.v, 2);
        assert.equal(rec.ver, 'v39.6');
        assert.deepEqual(rec.ci, { lo: 11900 - 425, hi: 11900 + 549, q05: -549, q95: 425, bin: '12000-25000', st: 'steady' });
        assert.equal(rec.conf.st, 'steady');
        assert.equal(rec.in.efx.tr1h, 'rising');
        assert.ok(rec.in.efx.tail && rec.in.efx.tail.v.length === 5);
        assert.deepEqual(Object.keys(rec.in.ef).sort(), ['h', 'hT']);
    });
    it('freshLoad is computed with the Edwards Ferry trend NULL, even when the tail shows a trend that would change the label', (t) => {
        quiet(t);
        const c = ctx();
        c.prediction = { ...c.prediction, useTimeShifted: true, useEfEnsemble: false, flowState: 'steady' };
        const rec = buildTickRecord(c, NOW, { out: 'predicted' });
        assert.equal(rec.in.efx.tr1h, 'rising');
        assert.equal(rec.conf.tribs, true);
        assert.equal(_test.confidenceLabel({ hasTribs: true, shifted: true, efUsed: false, efTrend: 'rising', flowState: 'steady' }), 'medium', 'with the trend the label would drop a notch');
        assert.equal(rec.conf.freshLoad, 'high', 'the fresh-load label ignores the trend');
        assert.equal(rec.conf.freshLoadShown, 'high');
    });
    it('attachDr touches only claimed rows that carry actualCFS', () => {
        const dr = { q: 13, t: NOW, at: NOW, ms: 5, qual: ['P'], why: null, ageMin: 5, tail: { t0: NOW, step: 15, v: [13] } };
        const pred = { id: 'p1', created_at: new Date(NOW).toISOString(), data: { timestamp: new Date(NOW).toISOString(), predictedCFS: 1000, flowBin: '0-3000', flowState: 'steady' } };
        const mk = (outcome, x) => ({ gaugeId: outcome, rec: buildValidationRecord(outcome, pred, NOW, x) });
        const claimed = mk('validated', { actualCFS: 1100, errRawCFS: 5 });
        const nonClaimed = ['stale_deleted', 'bad_due_deleted', 'replaced_missed_window', 'claim_failed', 'claim_lost', 'claimed_then_threw'].map(o => mk(o, {}));
        const queue = [claimed, ...nonClaimed];
        assert.equal(attachDr(queue, dr, NOW), 1);
        assert.equal(claimed.rec.dr.q, 13);
        assert.equal(claimed.rec.tickAt, new Date(NOW).toISOString());
        assert.ok(!('tail' in claimed.rec.dr));
        for (const it of nonClaimed) assert.ok(!('dr' in it.rec) && !('tickAt' in it.rec), it.gaugeId);
        assert.equal(attachDr(null, dr, NOW), 0);
        assert.equal(attachDr(queue, null, NOW), 0);
    });
    it('no prediction: conf and ci are null; no usgs data: in.efx and in.dr are null', (t) => {
        quiet(t);
        const a = buildTickRecord(ctx({ prediction: null, trace: null }), NOW, { out: 'no_prediction', why: 'ice_skip' });
        assert.equal(a.conf, null); assert.equal(a.ci, null);
        const b = buildTickRecord({ stage: 'fetch' }, NOW, { out: 'error', why: 'usgs_fetch_failed', err: new Error('x') });
        assert.equal(b.conf, null); assert.equal(b.ci, null); assert.equal(b.in.dr, null);
        assert.equal(b.v, 2);
    });
    it('a hostile hTail and a hostile dr cannot cost the tick row', (t) => {
        quiet(t);
        const c = ctx();
        c.usgsData.data[G.ef] = { h: 3.2, hTime: NOW, get hTail() { throw new Error('getter boom'); } };
        c.dr = { get q() { throw new Error('dr boom'); } };
        const rec = buildTickRecord(c, NOW, { out: 'predicted' });
        assert.equal(rec.out, 'predicted');
        assert.equal(rec.in.efx, null);
        assert.equal(rec.in.dr, null);
        assert.equal(rec.final.cfs, c.prediction.predictedCFS);
    });
    it('deep-frozen inputs including hTail and dr: no mutation, JSON-safe', (t) => {
        quiet(t);
        const c = ctx();
        c.dr = { q: 13, t: NOW - 3600000, at: NOW, ms: 80, qual: ['P'], why: null, ageMin: 60, tail: { t0: NOW, step: 15, v: [13] } };
        const deepFreeze = (o) => { Object.freeze(o); for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object' && !Object.isFrozen(o[k])) deepFreeze(o[k]); return o; };
        deepFreeze(c);
        const rec = buildTickRecord(c, NOW, { out: 'predicted' });
        assert.equal(rec.in.dr.q, 13);
        assert.deepEqual(rec.in.dr.tail, { t0: NOW, step: 15, v: [13] });
        assert.ok(JSON.stringify(rec).length < 4096, 'row stays under 4 KB');
    });
});

describe('I3: pruning is untouched', () => {
    it('pruneLogType refuses every type that is not one of the three log types', async () => {
        const mem = createMemClient({ rows: [] });
        for (const bad of ['dr_log', 'conf', 'log_health', 'gf_prediction', 'tick_log ', '']) {
            const r = await pruneLogType(mem.client, bad, { nowMs: NOW });
            assert.notEqual(r && r.status, 'pruned', bad);
        }
        assert.equal(mem.ops.filter(o => o.op === 'delete').length, 0, 'nothing was deleted');
    });
});

// A3 (v39.2): the record builders (T4), the non-fatal time-bounded writer and its budget
// (T5, T5a), pruning (T7), snapshots (T8) and the no-public-exposure scan (T10).

process.env.ADMIN_PIN = 'test-pin-1234';   // sync-learning captures it at require time

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { _test } = require('../netlify/functions/scheduled-update');
const {
    LogBudget, writeLogRow, flushLogHealth, buildTickRecord, buildValidationRecord, buildBinSnapshot,
    runBinSnapshot, pruneLogType, runLogHousekeeping, finalizeTick, noPredictionWhy,
    makeGFPrediction, LOG_RETENTION_DAYS, SERVER_VERSION,
} = _test;
const { createMemClient, LOG_TYPES } = require('./helpers/mem-supabase');

const NOW = 1_700_000_000_000;      // 2023-11-14T22:13:20Z
const DAY = 86400000;
const HOUR = 3600000;
const G = { por: '01638500', lf: '01646500', monocacy: '01643000', goose: '01644000', broadRun: '01644280', seneca: '01645000', ef: '01644148' };

function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
    return o;
}
const quiet = (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'error', () => {});
};
const fakeTimers = (t, ms = NOW) => { t.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); t.mock.timers.setTime(ms); };
const flush = () => new Promise(r => setImmediate(r));
// Lets pending microtasks and macrotasks settle while fake timers are on (setImmediate is real).
async function settle(n = 6) { for (let i = 0; i < n; i++) await flush(); }

// ── a realistic tickCtx ──────────────────────────────────────────────────────────────────────
function makeCtx(overrides = {}) {
    const tickStart = NOW;
    const usgsData = {
        gauges: G,
        data: {
            [G.por]: { q: 10000, qTime: NOW - 20 * 60000, h: 5.1, hTime: NOW - 20 * 60000, history: [{ timestamp: NOW - 60000, cfs: 10000 }] },
            [G.lf]: { q: 11000, qTime: NOW - 15 * 60000, h: 3.85, hTime: NOW - 15 * 60000 },
            [G.monocacy]: { q: 800, qTime: NOW - 10 * 60000 },
            [G.goose]: { q: 350, qTime: NOW - 10 * 60000 },
            [G.broadRun]: {},
            [G.seneca]: { q: 100, qTime: NOW - 10 * 60000 },
            [G.ef]: { h: 4.5, hTime: NOW - 30 * 60000 },
        },
    };
    const fullHistory = [];
    for (let k = 60; k >= 0; k--) fullHistory.push({ timestamp: NOW - k * HOUR, cfs: 10000 });
    const trace = {};
    const prediction = makeGFPrediction(usgsData, fullHistory, 12.5, {}, trace);
    prediction.efDivergence = 1.0123; prediction.divergenceActive = false;
    return {
        stage: 'housekeeping', usgsData, waterTempC: 12.5, tempT: NOW - 5 * 60000, fullHistory, trace, prediction,
        slot: 'stored', val: { n: 0, cleaned: 0 },
        adv: { dbar: 1.0123, ef: false, lfr: false, lfe: null },
        ice: { lf: false, por: false, efMiss: false },
        aux: { snapshot: 'not_due' },
        ...overrides,
    };
}

// ── T4 ────────────────────────────────────────────────────────────────────────────────────────
describe('T4: record builders', () => {
    function withNow(t, fn) { t.mock.timers.enable({ apis: ['Date'] }); t.mock.timers.setTime(NOW); quiet(t); return fn(); }

    it('predicted tick: full shape, join key equals prediction.timestamp, built from deep-frozen inputs', (t) => withNow(t, () => {
        const ctx = makeCtx();
        deepFreeze(ctx.usgsData); deepFreeze(ctx.prediction); deepFreeze(ctx.trace); deepFreeze(ctx.fullHistory);
        deepFreeze(ctx.adv); deepFreeze(ctx.ice); deepFreeze(ctx.val); deepFreeze(ctx.aux);
        const rec = buildTickRecord(ctx, NOW, { out: 'predicted', why: null, ms: 1234 });
        assert.equal(rec.v, 2);
        assert.equal(rec.ver, SERVER_VERSION);
        assert.equal(rec.at, new Date(NOW).toISOString());
        assert.equal(rec.out, 'predicted');
        assert.equal(rec.final.ts, ctx.prediction.timestamp);
        assert.equal(rec.final.cfs, ctx.prediction.predictedCFS);
        assert.equal(rec.corr.st, ctx.prediction.flowState);
        assert.equal(rec.corr.bin, ctx.prediction.flowBin);
        assert.equal(rec.due, ctx.prediction.validationDue);
        assert.equal(rec.in.lf.q, 11000);
        assert.equal(rec.in.lf.qT, NOW - 15 * 60000);
        assert.equal(rec.in.lf.hT, NOW - 15 * 60000);
        assert.equal(rec.in.br.fb, true, 'Broad Run missing -> fallback');
        assert.equal(rec.in.mono.fb, false);
        assert.ok(rec.in.br.eff > 0, 'effective fallback flow recorded');
        assert.equal(rec.in.tT, NOW - 5 * 60000);
        assert.equal(rec.in.tC, 12.5);
        assert.equal(rec.in.porHist.n, 61);
        assert.equal(rec.in.porHist.lastT, NOW);
        assert.equal(rec.trv.stop, 'converged');
        assert.equal(rec.hist.cfs, 10000);
        assert.equal(rec.pre.shifted, true);
        assert.equal(rec.ceil.lim, 13200);
        assert.equal(rec.ceil.bound, ctx.prediction.ceilingApplied);
        assert.equal(rec.slot, 'stored');
        assert.equal(rec.adv.dbar, 1.012);
        assert.equal(rec.ms, 1234);
    }));

    // TD-1: every field gets a value that differs from every other field it could be confused with
    // (read times differ per gauge, correction nonzero, ceiling on, EF used, delta on, loop not converged,
    // ice true, raw differs from porEst). A builder that reads the wrong source then fails.
    it('TD-1: every tick field is checked against its own source with distinct values', (t) => withNow(t, () => {
        const m = 60000;
        const gd = (q, qT, h, hT) => ({ q, qTime: NOW - qT * m, h, hTime: NOW - hT * m });
        const usgsData = {
            gauges: G,
            data: {
                [G.por]: gd(10100, 21, 5.11, 22),
                [G.lf]: gd(11200, 13, 3.91, 17),
                [G.monocacy]: gd(801, 31, undefined, 0),
                [G.goose]: gd(352, 33, undefined, 0),
                [G.broadRun]: gd(41, 35, undefined, 0),
                [G.seneca]: gd(103, 37, undefined, 0),
                [G.ef]: { h: 4.55, hTime: NOW - 41 * m },
            },
        };
        const fullHistory = [{ timestamp: NOW - 5 * HOUR, cfs: 1 }, { timestamp: NOW - 4 * HOUR, cfs: 2 }, { timestamp: NOW - 2 * HOUR, cfs: 3 }];
        const trace = {
            monoFlow: 57.1, gooseFlow: 10.7, brFlow: 0.3, senFlow: 0.9, fbMono: false, fbGoose: true, fbBr: false, fbSen: true,
            rate: 0.0123, rst: 'rising', t0: 18.5, t: 19.25, it: 3, stop: 'max_iter', mult: 1.234, nohist: false, gf2lf: 6.75,
            histTs: NOW - 19 * HOUR, histCfs: 9876, histAgo: 19.25, preCfs: 10321, preShifted: true,
            pct: 7.77, decay: 0.321, ratio: 1.0456, deltaOn: true,
            porEst: 10555, efDisc: 0.2345, efSkip: true,
            rawUnc: 11777, corr: 321, unc: 12098, ceilLim: 13440, ceilBound: true,
        };
        const prediction = {
            predictedCFS: 12000, predictedStage: 4.31, rawFinalStage: 4.12, timestamp: '2023-11-14T22:00:00.000Z',
            validationDue: '2023-11-15T04:00:00.000Z', flowBin: '12000-25000', flowState: 'rising',
            efEstimateCFS: 13111, efModelType: 'cold', efWeight: 0.222, useEfEnsemble: true, ceilingApplied: false,
        };
        const ctx = {
            stage: 'housekeeping', usgsData, waterTempC: 9.5, tempT: NOW - 7 * m, fullHistory, trace, prediction,
            slot: 'replaced', val: { n: 2, cleaned: 1 }, adv: { dbar: 1.2345, ef: true, lfr: false, lfe: -17.4 },
            ice: { lf: false, por: true, efMiss: true }, aux: { snapshot: 'written' },
        };
        const r = buildTickRecord(ctx, NOW, { out: 'predicted', why: null, ms: 321 });
        assert.deepEqual(r.in.lf, { q: 11200, qT: NOW - 13 * m, h: 3.91, hT: NOW - 17 * m });
        assert.deepEqual(r.in.por, { q: 10100, qT: NOW - 21 * m, h: 5.11, hT: NOW - 22 * m });
        assert.deepEqual(r.in.mono, { q: 801, qT: NOW - 31 * m, eff: 57.1, fb: false });
        assert.deepEqual(r.in.goose, { q: 352, qT: NOW - 33 * m, eff: 10.7, fb: true });
        assert.deepEqual(r.in.br, { q: 41, qT: NOW - 35 * m, eff: 0.3, fb: false });
        assert.deepEqual(r.in.sen, { q: 103, qT: NOW - 37 * m, eff: 0.9, fb: true });
        assert.deepEqual(r.in.ef, { h: 4.55, hT: NOW - 41 * m });
        assert.equal(r.in.tC, 9.5);
        assert.equal(r.in.tT, NOW - 7 * m);
        assert.deepEqual(r.in.ice, { lf: false, por: true, efMiss: true });
        assert.deepEqual(r.in.porHist, { n: 3, firstT: NOW - 5 * HOUR, lastT: NOW - 2 * HOUR });
        assert.deepEqual(r.rise, { r: 0.012, rst: 'rising' });
        assert.deepEqual(r.trv, { t0: 18.5, t: 19.25, it: 3, stop: 'max_iter', mult: 1.234, nohist: false, gf2lf: 6.75 });
        assert.deepEqual(r.hist, { cfs: 9876, ago: 19.25, ts: NOW - 19 * HOUR });
        assert.deepEqual(r.pre, { cfs: 10321, shifted: true });
        assert.deepEqual(r.delta, { pct: 7.77, decay: 0.321, ratio: 1.0456, on: true });
        assert.deepEqual(r.por, { est: 10555 });
        assert.deepEqual(r.ef, { est: 13111, type: 'cold', w: 0.222, used: true, disc: 0.235, skip: true });
        assert.deepEqual(r.raw, { cfs: 11777, stage: 4.12 });
        assert.notEqual(r.raw.cfs, r.por.est);
        assert.deepEqual(r.corr, { bin: '12000-25000', st: 'rising', c: 321, unc: 12098 });
        assert.deepEqual(r.ceil, { lim: 13440, bound: true });
        assert.notEqual(r.ceil.bound, ctx.prediction.ceilingApplied);
        assert.deepEqual(r.final, { cfs: 12000, stage: 4.31, ts: '2023-11-14T22:00:00.000Z' });
        assert.equal(r.due, '2023-11-15T04:00:00.000Z');
        assert.deepEqual(r.adv, { dbar: 1.235, ef: true, lfr: false, lfe: -17.4 });
        assert.equal(r.slot, 'replaced');
        assert.deepEqual(r.val, { n: 2, cleaned: 1 });
        // the other trace fork: no history, converged
        const r2 = buildTickRecord({ ...ctx, trace: { ...trace, nohist: true, stop: 'converged', deltaOn: false, efSkip: false, ceilBound: false }, ice: { lf: true, por: false, efMiss: false } }, NOW, { out: 'predicted' });
        assert.equal(r2.hist, null);
        assert.equal(r2.trv.stop, 'converged');
        assert.equal(r2.delta.on, false);
        assert.equal(r2.ef.skip, false);
        assert.equal(r2.ceil.bound, false);
        assert.deepEqual(r2.in.ice, { lf: true, por: false, efMiss: false });
    }));

    it('size stays under 4 KB and every number is finite or null', (t) => withNow(t, () => {
        const rec = buildTickRecord(makeCtx({ aux: { snapshot: 'written', prune: { tick_log: { cand: 3, deleted: 3 }, validation_log: { cand: 0, deleted: 0 }, bin_snapshot: { cand: 0, deleted: 0 } }, logFail: [] } }), NOW, { out: 'predicted', ms: 900 });
        const json = JSON.stringify(rec);
        assert.ok(json.length < 4096, `record is ${json.length} bytes`);
        (function walk(v, p) {
            if (typeof v === 'number') assert.ok(Number.isFinite(v), `${p} is not finite`);
            else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
        })(rec, 'rec');
    }));

    it('non-finite inputs become null, not NaN or Infinity', (t) => withNow(t, () => {
        const ctx = makeCtx();
        ctx.usgsData.data[G.lf].q = Infinity;
        ctx.usgsData.data[G.lf].qTime = NaN;
        ctx.trace.rate = NaN;
        const rec = buildTickRecord(ctx, NOW, { out: 'predicted' });
        assert.equal(rec.in.lf.q, null);
        assert.equal(rec.in.lf.qT, null);
        assert.equal(rec.rise.r, null);
    }));

    it('ice_skip tick: model fields null, in.* and adv filled', (t) => withNow(t, () => {
        const ctx = makeCtx({ prediction: null, trace: undefined, slot: undefined, ice: { lf: true, por: false, efMiss: false } });
        deepFreeze(ctx.usgsData);
        const rec = buildTickRecord(ctx, NOW, { out: 'no_prediction', why: noPredictionWhy(true, ctx.usgsData), ms: 5 });
        assert.equal(rec.out, 'no_prediction');
        assert.equal(rec.why, 'ice_skip');
        for (const k of ['rise', 'trv', 'hist', 'pre', 'delta', 'por', 'ef', 'raw', 'corr', 'ceil', 'final', 'due']) assert.equal(rec[k], null, k);
        assert.equal(rec.in.ice.lf, true);
        assert.equal(rec.in.lf.q, 11000);
        assert.ok(rec.adv);
        assert.equal(rec.slot, 'none');
    }));

    it('null_lf_or_por is derived from the same inputs the model tests', (t) => withNow(t, () => {
        const u1 = makeCtx().usgsData; u1.data[G.lf].q = undefined;
        const u2 = makeCtx().usgsData; u2.data[G.por].q = undefined;
        assert.equal(noPredictionWhy(false, u1), 'null_lf_or_por');
        assert.equal(noPredictionWhy(false, u2), 'null_lf_or_por');
        assert.equal(noPredictionWhy(true, u1), 'ice_skip');
        assert.equal(noPredictionWhy(false, makeCtx().usgsData), 'no_prediction_unknown');
    }));

    it('error tick with a partial context: truncated message, no stack, never throws', (t) => withNow(t, () => {
        const e = new Error('x'.repeat(500));
        const rec = buildTickRecord({ stage: 'fetch' }, NOW, { out: 'error', why: 'usgs_fetch_failed', err: e, ms: 12 });
        assert.equal(rec.out, 'error');
        assert.equal(rec.err.length, 200);
        assert.ok(!JSON.stringify(rec).includes('at Object'), 'no stack');
        assert.equal(rec.in.lf.q, null);
        assert.equal(rec.in.porHist, null);
        const rec2 = buildTickRecord(undefined, NOW, { out: 'error', err: 'plain string' });
        assert.equal(rec2.err, 'plain string');
    }));

    it('commit comes from COMMIT_REF and is null when absent', (t) => withNow(t, () => {
        const old = process.env.COMMIT_REF;
        try {
            delete process.env.COMMIT_REF;
            assert.equal(buildTickRecord(makeCtx(), NOW, { out: 'predicted' }).commit, null);
            process.env.COMMIT_REF = 'abc123';
            assert.equal(buildTickRecord(makeCtx(), NOW, { out: 'predicted' }).commit, 'abc123');
        } finally { if (old === undefined) delete process.env.COMMIT_REF; else process.env.COMMIT_REF = old; }
    }));

    it('builders do not mutate their inputs', (t) => withNow(t, () => {
        const ctx = makeCtx();
        const before = JSON.stringify(ctx);
        buildTickRecord(ctx, NOW, { out: 'predicted' });
        assert.equal(JSON.stringify(ctx), before);
    }));

    it('validation record for a non-claimed fate is small and carries only the common fields', () => {
        const pred = { id: 'p1', created_at: '2026-01-01T00:00:00.000Z', data: { timestamp: '2026-01-01T00:00:01.000Z', validationDue: '2026-01-02T00:00:00.000Z', predictedCFS: 100, rawFinalCFS: 90, flowBin: '3000-6000', flowState: 'rising' } };
        const rec = buildValidationRecord('stale_deleted', pred, NOW, { ageH: 50.04, delFailed: false });
        assert.equal(rec.outcome, 'stale_deleted');
        assert.equal(rec.predTs, '2026-01-01T00:00:01.000Z');
        assert.equal(rec.predId, 'p1');
        assert.equal(rec.ageH, 50);
        assert.equal(rec.delFailed, false);
        assert.ok(JSON.stringify(rec).length < 700);
        assert.equal(rec.actualCFS, undefined);
    });

    it('bin snapshot: every bin row, with sums, plus the leaderboard', () => {
        const rows = [
            { gauge_id: '3000-6000_steady', data: { count: 12, sumError: 100, sumErrorSq: 5000, meanError: 8.33, emaMeanError: 9 } },
            { gauge_id: 'stage_3000-6000_steady', data: { count: 4, sumError: 0.2, sumErrorSq: 0.01, meanError: 0.05, emaMeanError: 0.04, stdDev: 0.02 } },
        ];
        const snap = buildBinSnapshot(rows, { totalRounds: 7 }, '2023-11-14T03:00:00.000Z');
        assert.deepEqual(Object.keys(snap.bins).sort(), ['3000-6000_steady', 'stage_3000-6000_steady']);
        assert.equal(snap.bins['3000-6000_steady'].n, 12);
        assert.equal(snap.bins['3000-6000_steady'].sum, 100);
        assert.equal(snap.lb.totalRounds, 7);
        assert.equal(snap.key, '2023-11-14T03:00:00.000Z');
    });
});

// ── T5 ────────────────────────────────────────────────────────────────────────────────────────
describe('T5: writeLogRow is non-fatal and time-bounded', () => {
    const okClient = (ins) => ({ from: () => ({ insert: ins }) });

    it('ok insert', async (t) => {
        quiet(t);
        const b = new LogBudget();
        const r = await writeLogRow(okClient(() => Promise.resolve({ error: null })), 'tick_log', 'k', { a: 1 }, b, 'tick');
        assert.deepEqual(r, { ok: true, reason: 'ok' });
        assert.equal(b.fails.length, 0);
    });

    for (const [name, ins, reason] of [
        ['insert rejects', () => Promise.reject(new Error('boom')), 'error'],
        ['insert throws synchronously', () => { throw new Error('sync boom'); }, 'error'],
        ['insert returns {error}', () => Promise.resolve({ error: { message: 'rls', code: '42501' } }), 'error'],
    ]) {
        it(name, async (t) => {
            quiet(t);
            const b = new LogBudget();
            const r = await writeLogRow(okClient(ins), 'validation_log', 'k', {}, b, 'general', { predTs: 'T' });
            assert.deepEqual(r, { ok: false, reason });
            assert.equal(b.pending.errors, 1);
            assert.deepEqual(b.fails[0], { type: 'validation_log', reason: 'error', predTs: 'T', msg: b.fails[0].msg });
        });
    }

    it('missing client method is a caught error, not a crash', async (t) => {
        quiet(t);
        const b = new LogBudget();
        assert.equal((await writeLogRow({}, 'tick_log', 'k', {}, b, 'tick')).reason, 'no_client_method');
        assert.equal((await writeLogRow(null, 'tick_log', 'k', {}, b, 'tick')).reason, 'no_client_method');
        assert.equal((await writeLogRow({ from: () => ({}) }, 'tick_log', 'k', {}, b, 'tick')).reason, 'error');
    });

    it('a never-resolving insert returns within its cap and counts as a timeout', { timeout: 3000 }, async (t) => {
        quiet(t); fakeTimers(t);
        const b = new LogBudget();
        const p = writeLogRow(okClient(() => new Promise(() => {})), 'tick_log', 'k', {}, b, 'tick');
        await settle();
        t.mock.timers.tick(2000);
        const r = await p;
        assert.deepEqual(r, { ok: false, reason: 'timeout' });
        assert.equal(b.pending.timeouts, 1);
        assert.equal(b.pending.errors, 0, 'timeouts are counted apart from errors');
        assert.equal(b.remaining('tick'), 1000, 'elapsed time was charged to the pool');
    });

    it('the cap is min(2000, pool remaining)', { timeout: 3000 }, async (t) => {
        quiet(t); fakeTimers(t);
        const b = new LogBudget(500, 500);
        const p = writeLogRow(okClient(() => new Promise(() => {})), 'validation_log', 'k', {}, b, 'general');
        await settle();
        t.mock.timers.tick(500);
        assert.equal((await p).reason, 'timeout');
        assert.equal(b.remaining('general'), 0);
    });

    it('23505 is dup: success, and not counted', async (t) => {
        quiet(t);
        const b = new LogBudget();
        const r = await writeLogRow(okClient(() => Promise.resolve({ error: { code: '23505', message: 'dup' } })), 'tick_log', 'k', {}, b, 'tick');
        assert.deepEqual(r, { ok: true, reason: 'dup' });
        assert.equal(b.fails.length, 0);
        assert.equal(b.hasPending(), false);
    });

    it('a spent pool returns budget without touching the database', async (t) => {
        quiet(t);
        const b = new LogBudget(0, 3000);
        let called = 0;
        const r = await writeLogRow(okClient(() => { called++; return Promise.resolve({ error: null }); }), 'validation_log', 'k', {}, b, 'general');
        assert.deepEqual(r, { ok: false, reason: 'budget' });
        assert.equal(called, 0);
        assert.equal(b.pending.skipped, 1);
    });

    it('log_health: written on failure with timeouts apart from errors; skipped when the general pool is spent', async (t) => {
        quiet(t);
        const mem = createMemClient();
        const b = new LogBudget();
        b.noteFailure('validation_log', 'timeout');
        b.noteFailure('tick_log', 'error', { msg: 'x' });
        assert.equal((await flushLogHealth(mem.client, b)).status, 'written');
        const row = mem.get('log_health', 'system');
        assert.equal(row.timeouts, 1);
        assert.equal(row.errors, 1);
        assert.deepEqual(row.byType, { validation_log: 1, tick_log: 1 });
        // accumulates across ticks
        b.noteFailure('tick_log', 'error');
        await flushLogHealth(mem.client, b);
        assert.equal(mem.get('log_health', 'system').errors, 2);
        // nothing pending: no writes at all
        const opsBefore = mem.ops.length;
        assert.equal((await flushLogHealth(mem.client, b)).status, 'none');
        assert.equal(mem.ops.length, opsBefore);
        // pool spent: skipped, no database call, counters kept
        const spent = new LogBudget(0, 3000);
        spent.noteFailure('tick_log', 'error');
        const before = mem.ops.length;
        assert.equal((await flushLogHealth(mem.client, spent)).status, 'skipped');
        assert.equal(mem.ops.length, before);
        assert.equal(spent.hasPending(), true);
    });

    it('log_health is not overwritten with fresh counters when its read fails', async (t) => {
        quiet(t);
        const mem = createMemClient({ rows: [{ observation_type: 'log_health', gauge_id: 'system', data: { errors: 9, timeouts: 0, skipped: 0, byType: {} } }] });
        const realFrom = mem.client.from;
        mem.client.from = (tbl) => {
            const q = realFrom(tbl);
            const origSingle = q.single.bind(q);
            q.single = () => { origSingle(); return Promise.resolve({ data: null, error: { code: '08006', message: 'down' } }); };
            return q;
        };
        const b = new LogBudget();
        b.noteFailure('tick_log', 'error');
        assert.equal((await flushLogHealth(mem.client, b)).status, 'skipped');
        assert.equal(mem.get('log_health', 'system').errors, 9);
    });
});

// ── T5a ───────────────────────────────────────────────────────────────────────────────────────
describe('T5a: the tick pool is reserved', () => {
    it('hung validation_log writes exhaust the general pool, then the tick write still lands', { timeout: 3000 }, async (t) => {
        quiet(t); fakeTimers(t);
        const mem = createMemClient({ insertMode: { validation_log: 'hang' } });
        const b = new LogBudget();
        // two hung validation writes: 2000 ms + 1000 ms = the whole 3000 ms general pool
        const p1 = writeLogRow(mem.client, 'validation_log', 'v1', {}, b, 'general', { predTs: 'a' });
        await settle(); t.mock.timers.tick(2000);
        assert.equal((await p1).reason, 'timeout');
        const p2 = writeLogRow(mem.client, 'validation_log', 'v2', {}, b, 'general', { predTs: 'b' });
        await settle(); t.mock.timers.tick(1000);
        assert.equal((await p2).reason, 'timeout');
        assert.equal(b.remaining('general'), 0);
        // a third validation write is refused without a database call
        const opsBefore = mem.ops.length;
        assert.equal((await writeLogRow(mem.client, 'validation_log', 'v3', {}, b, 'general')).reason, 'budget');
        assert.equal(mem.ops.length, opsBefore);
        // the tick row still goes through
        const ctx = makeCtx();
        const w = await finalizeTick(mem.client, b, ctx, NOW, { out: 'predicted' });
        assert.equal(w.ok, true);
        assert.equal(mem.of('tick_log').length, 1);
        assert.equal(mem.of('tick_log')[0].data.aux.logFail.length, 3, 'tick row lists the three lost validation rows');
    });
});

// ── T7 ────────────────────────────────────────────────────────────────────────────────────────
describe('T7: pruning only touches old rows of the three log types', () => {
    const iso = (ms) => new Date(ms).toISOString();
    function seeded() {
        const rows = [];
        // old and young rows for each prunable type
        for (let i = 0; i < 5; i++) rows.push({ observation_type: 'tick_log', gauge_id: iso(NOW - (200 + i) * DAY), data: { old: true } });
        for (let i = 0; i < 5; i++) rows.push({ observation_type: 'tick_log', gauge_id: iso(NOW - (i + 1) * DAY), data: { young: true } });
        for (let i = 0; i < 3; i++) rows.push({ observation_type: 'validation_log', gauge_id: `${iso(NOW - (800 + i) * DAY)}_id${i}`, data: { old: true } });
        rows.push({ observation_type: 'validation_log', gauge_id: `${iso(NOW - 300 * DAY)}_idx`, data: { young: true } });
        rows.push({ observation_type: 'bin_snapshot', gauge_id: iso(NOW - 900 * DAY), data: { old: true } });
        rows.push({ observation_type: 'bin_snapshot', gauge_id: iso(NOW - 10 * DAY), data: { young: true } });
        // rows that must never be touched, even with ancient ids
        rows.push({ observation_type: 'log_health', gauge_id: 'system', data: { errors: 1 } });
        rows.push({ observation_type: 'por_history', gauge_id: 'system', data: { readings: [] } });
        rows.push({ observation_type: 'gf_correction_bin', gauge_id: '1999-01-01T00:00:00.000Z', data: { count: 3 } });
        rows.push({ observation_type: 'validation_failure', gauge_id: '1999-01-01T00:00:00.000Z_x', data: {} });
        rows.push({ observation_type: 'gf_prediction', gauge_id: 'pending', data: {} });
        rows.push({ observation_type: 'gf_prediction', gauge_id: '1999-01-01T00:00:00.000Z', data: { ancient: true } });   // TD-6
        rows.push({ observation_type: 'audit_log', gauge_id: '1999-01-01T00:00:00.000Z', data: {} });
        return createMemClient({ rows });
    }
    const keepers = ['log_health', 'por_history', 'gf_correction_bin', 'validation_failure', 'gf_prediction', 'audit_log'];

    it('unknown type issues zero queries', async (t) => {
        quiet(t);
        const mem = seeded();
        const before = mem.ops.length;
        for (const bad of ['gf_prediction', 'validation_failure', 'gf_correction_bin', 'log_health', 'por_history', '', undefined, null, '__proto__', 'constructor', 'toString']) {
            const r = await pruneLogType(mem.client, bad, { nowMs: NOW });
            assert.equal(r.error, 'type_not_allowed', String(bad));
        }
        assert.equal(mem.ops.length, before);
    });

    it('prunes old rows of one type; the select and the delete both carry the type eq', async (t) => {
        quiet(t);
        const mem = seeded();
        const total = mem.rows.length;
        const r = await pruneLogType(mem.client, 'tick_log', { nowMs: NOW });
        assert.deepEqual(r, { cand: 5, deleted: 5 });
        assert.equal(mem.rows.length, total - 5);
        assert.equal(mem.of('tick_log').length, 5);
        assert.ok(mem.of('tick_log').every(x => x.data.young));
        const sel = mem.ops.find(o => o.op === 'select');
        const del = mem.ops.find(o => o.op === 'delete');
        for (const o of [sel, del]) assert.ok(o.filters.some(f => f.k === 'eq' && f.c === 'observation_type' && f.v === 'tick_log'));
        assert.ok(del.filters.some(f => f.k === 'in' && f.c === 'id'));
        for (const k of keepers) assert.ok(mem.of(k).length >= 1, `${k} untouched`);
    });

    it('full housekeeping at hour 3 prunes all three types and nothing else', async (t) => {
        quiet(t);
        const mem = seeded();
        const hour3 = Date.UTC(2023, 10, 14, 3, 5, 0);
        // rows were seeded relative to NOW; re-seed relative to hour3 is unnecessary: ages are far from the cutoffs
        const budget = new LogBudget();
        const aux = await runLogHousekeeping(mem.client, budget, hour3);
        assert.equal(aux.prune.tick_log.deleted, 5);
        assert.equal(aux.prune.validation_log.deleted, 3);
        assert.equal(aux.prune.bin_snapshot.deleted, 1);
        for (const d of mem.ops.filter(o => o.op === 'delete').flatMap(o => o.deleted)) {
            assert.ok(['tick_log', 'validation_log', 'bin_snapshot'].includes(d.type), `deleted a ${d.type} row`);
        }
        for (const k of keepers) assert.ok(mem.of(k).length >= 1);
        assert.ok(mem.of('tick_log').every(x => x.data.young));
        assert.ok(mem.of('validation_log').every(x => x.data.young));
        assert.ok(mem.of('bin_snapshot').filter(x => x.gauge_id !== '2023-11-14T03:00:00.000Z').every(x => x.data.young));
    });

    it('housekeeping prunes only at hour 3', async (t) => {
        quiet(t);
        for (const hour of [0, 2, 4, 5, 12, 23]) {
            const mem = seeded();
            const aux = await runLogHousekeeping(mem.client, new LogBudget(), Date.UTC(2023, 10, 14, hour, 5, 0));
            assert.equal(aux.prune, undefined, `hour ${hour}`);
            assert.equal(mem.ops.filter(o => o.op === 'delete').length, 0, `hour ${hour}`);
        }
    });

    it('empty candidate list issues no delete', async (t) => {
        quiet(t);
        const mem = createMemClient({ rows: [{ observation_type: 'tick_log', gauge_id: iso(NOW - DAY), data: {} }] });
        const r = await pruneLogType(mem.client, 'tick_log', { nowMs: NOW });
        assert.deepEqual(r, { cand: 0, deleted: 0 });
        assert.equal(mem.ops.filter(o => o.op === 'delete').length, 0);
    });

    it('the 30-day floor refuses a 5-day cutoff', async (t) => {
        quiet(t);
        const mem = seeded();
        const before = mem.ops.length;
        const r = await pruneLogType(mem.client, 'tick_log', { nowMs: NOW, days: 5 });
        assert.equal(r.error, 'cutoff_refused');
        assert.equal(mem.ops.length, before);
        assert.equal((await pruneLogType(mem.client, 'tick_log', { nowMs: NOW, days: NaN })).error, 'cutoff_refused');
        assert.equal((await pruneLogType(mem.client, 'tick_log', { nowMs: NaN })).error, 'cutoff_refused');
        // exactly 30 days is allowed
        assert.equal((await pruneLogType(mem.client, 'tick_log', { nowMs: NOW, days: 30 })).error, undefined);
    });

    it('retention table is frozen and has exactly the three types', () => {
        assert.deepEqual(LOG_RETENTION_DAYS, { tick_log: 180, validation_log: 730, bin_snapshot: 730 });
        assert.ok(Object.isFrozen(LOG_RETENTION_DAYS));
    });

    it('batch cap of 100 ids, and the delete URL stays under 4 KB (plan 10 says about 4 KB; its T7 line says 2 KB, which 100 uuids cannot meet)', async (t) => {
        quiet(t);
        const rows = [];
        for (let i = 0; i < 250; i++) rows.push({ observation_type: 'tick_log', gauge_id: iso(NOW - (300 + i) * DAY), data: {} });
        const mem = createMemClient({ rows });
        const r = await pruneLogType(mem.client, 'tick_log', { nowMs: NOW });
        assert.deepEqual(r, { cand: 100, deleted: 100 });
        assert.equal(mem.of('tick_log').length, 150);
        const del = mem.ops.find(o => o.op === 'delete');
        assert.equal(del.filters.find(f => f.k === 'in').v.length, 100);
        assert.ok(del.urlLen < 4096, `delete URL is ${del.urlLen} chars`);
        // the oldest rows go first
        assert.ok(mem.of('tick_log').every(x => x.gauge_id >= iso(NOW - 450 * DAY)));
    });

    it('TD-6: an ISO-keyed old gf_prediction row survives pruning and housekeeping', async (t) => {
        quiet(t);
        const mem = seeded();
        const hour3 = Date.UTC(2023, 10, 14, 3, 5, 0);
        await runLogHousekeeping(mem.client, new LogBudget(), hour3);
        for (const type of ['gf_prediction', 'validation_failure', 'gf_correction_bin', 'audit_log']) {
            assert.ok(mem.rows.some(r => r.observation_type === type && r.gauge_id.startsWith('1999-')), `${type} ancient row survives`);
        }
        const r = await pruneLogType(mem.client, 'gf_prediction', { nowMs: NOW, days: 31 });
        assert.equal(r.error, 'type_not_allowed');
    });

    it('TD-7: the cutoff is exactly 180 / 730 days (one row each side)', async (t) => {
        quiet(t);
        const rows = [
            { observation_type: 'tick_log', gauge_id: iso(NOW - 179.9 * DAY), data: { side: 'new' } },
            { observation_type: 'tick_log', gauge_id: iso(NOW - 180.1 * DAY), data: { side: 'old' } },
            { observation_type: 'validation_log', gauge_id: `${iso(NOW - 729.9 * DAY)}_a`, data: { side: 'new' } },
            { observation_type: 'validation_log', gauge_id: `${iso(NOW - 730.1 * DAY)}_b`, data: { side: 'old' } },
            { observation_type: 'bin_snapshot', gauge_id: iso(NOW - 729.9 * DAY), data: { side: 'new' } },
            { observation_type: 'bin_snapshot', gauge_id: iso(NOW - 730.1 * DAY), data: { side: 'old' } },
        ];
        const mem = createMemClient({ rows });
        const budget = new LogBudget();
        for (const type of ['tick_log', 'validation_log', 'bin_snapshot']) {
            const r = await pruneLogType(mem.client, type, { nowMs: NOW, budget });
            assert.deepEqual(r, { cand: 1, deleted: 1 }, type);
        }
        assert.equal(mem.rows.length, 3);
        assert.ok(mem.rows.every(r => r.data.side === 'new'));
    });

    it('TD-9: the prune select is bounded to 100 rows', async (t) => {
        quiet(t);
        const mem = seeded();
        await pruneLogType(mem.client, 'tick_log', { nowMs: NOW });
        const sel = mem.ops.find(o => o.op === 'select');
        assert.equal(sel.limit, 100);
    });

    it('FM-2: deleted counts what the server removed, not what was requested', async (t) => {
        quiet(t);
        const fake = {
            from: () => {
                let mode = 'sel';
                const b = {
                    select() { return b; }, eq() { return b; }, lt() { return b; }, order() { return b; }, limit() { return b; },
                    in() { return b; }, delete() { mode = 'del'; return b; },
                    then(res, rej) {
                        return Promise.resolve(mode === 'sel' ? { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null } : { data: [{ id: 'a' }], error: null }).then(res, rej);
                    },
                };
                return b;
            },
        };
        assert.deepEqual(await pruneLogType(fake, 'tick_log', { nowMs: NOW }), { cand: 3, deleted: 1 });
        // a delete that matches nothing (data []) or returns no body must not read as success
        const nothing = { from: () => { let m = 'sel'; const b = { select() { return b; }, eq() { return b; }, lt() { return b; }, order() { return b; }, limit() { return b; }, in() { return b; }, delete() { m = 'del'; return b; }, then(res, rej) { return Promise.resolve(m === 'sel' ? { data: [{ id: 'a' }], error: null } : { data: null, error: null }).then(res, rej); } }; return b; } };
        assert.deepEqual(await pruneLogType(nothing, 'tick_log', { nowMs: NOW }), { cand: 1, deleted: 0 });
    });

    it('FM-4: the real postgrest client builds a prune delete URL under 8 KB', async (t) => {
        quiet(t);
        const { createClient } = require('@supabase/supabase-js');
        const seen = [];
        const fakeFetch = async (url, init) => { seen.push({ url: String(url), method: init && init.method }); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); };
        const real = createClient('https://test.supabase.co', 'test-key-not-a-secret', { global: { fetch: fakeFetch }, auth: { persistSession: false, autoRefreshToken: false } });
        const ids = Array.from({ length: 100 }, (_, i) => `${String(i).padStart(8, '0')}-aaaa-4bbb-8ccc-${String(i).padStart(12, '0')}`);
        await real.from('potomac_observations').delete().eq('observation_type', 'validation_log').in('id', ids).select('id');
        const del = seen.find(x => x.method === 'DELETE');
        assert.ok(del, 'a DELETE request was built');
        assert.ok(del.url.length < 8192, `real delete URL is ${del.url.length} chars`);
        assert.ok(del.url.length > 3500, 'the ids are really in the URL');
    });

    it('FM-6: URLs in error text are not stored in logFail, lastError or the tick error', async (t) => {
        quiet(t);
        const b = new LogBudget();
        b.noteFailure('validation_log', 'error', { msg: 'boom https://test.supabase.co/rest/v1?apikey=SECRET&x=1 end' });
        assert.ok(!JSON.stringify(b.fails).includes('SECRET'));
        assert.ok(!b.pending.lastError.includes('SECRET'));
        assert.match(b.fails[0].msg, /<url>/);
        const mem = createMemClient({ insertMode: { validation_log: 'error' } });
        const w = new LogBudget();
        mem.client.from = ((orig) => (tbl) => { const q = orig(tbl); const ins = q.insert.bind(q); q.insert = (row) => { if (row.observation_type === 'validation_log') return Promise.resolve({ error: { message: 'bad http://x.test/?apikey=SECRET', code: 'XX000' } }); return ins(row); }; return q; })(mem.client.from);
        await writeLogRow(mem.client, 'validation_log', 'k', {}, w, 'general');
        assert.ok(!JSON.stringify(w.fails).includes('SECRET'));
        const rec = buildTickRecord({ stage: 'fetch' }, NOW, { out: 'error', err: new Error('fail at https://a.b/c?key=SECRET') });
        assert.ok(!JSON.stringify(rec).includes('SECRET'));
    });

    it('FM-3: logFailTotal counts every failure even when logFail is cut at 10', async (t) => {
        quiet(t);
        const mem = createMemClient();
        const b = new LogBudget();
        for (let i = 0; i < 14; i++) b.noteFailure('validation_log', 'timeout', { predTs: `p${i}` });
        await finalizeTick(mem.client, b, { stage: 'housekeeping', aux: { snapshot: 'not_due' } }, NOW, { out: 'no_prediction', why: 'null_lf_or_por' });
        const row = mem.of('tick_log')[0].data;
        assert.equal(row.aux.logFail.length, 10);
        assert.equal(row.aux.logFailTotal, 14);
    });

    it('a select or delete failure is counted and does not throw', async (t) => {
        quiet(t);
        const mem = seeded();
        const b = new LogBudget();
        const bad = { from: () => { throw new Error('db down'); } };
        const r = await pruneLogType(bad, 'tick_log', { nowMs: NOW, budget: b });
        assert.equal(r.error, 'select_error');
        assert.equal(b.pending.byType.prune_tick_log, 1);
        assert.equal(mem.rows.length, seeded().rows.length);
    });

    it('sync-learning: every delete it issues is scoped to a non-log type, and reset leaves the logs', async (t) => {
        quiet(t);
        const { saveGFLearningData } = require('../netlify/functions/sync-learning')._test;
        const mem = seeded();
        mem.add({ observation_type: 'gf_prediction', gauge_id: 'pending', data: { validationDue: new Date(NOW - 10 * HOUR).toISOString() } });
        const logRows = () => mem.rows.filter(r => LOG_TYPES.includes(r.observation_type)).length;
        const logsBefore = logRows();
        for (const action of ['resetGFLearning', 'resetForecastAccuracy']) {
            await saveGFLearningData(mem.client, { action, pin: 'test-pin-1234' });
        }
        await saveGFLearningData(mem.client, {
            action: 'storePrediction',
            prediction: { timestamp: new Date(NOW).toISOString(), predictedCFS: 5000, validationDue: new Date(NOW + HOUR).toISOString() },
        });
        const deletes = mem.ops.filter(o => o.op === 'delete');
        assert.ok(deletes.length >= 4, 'the actions did issue deletes');
        for (const d of deletes) {
            const eq = d.filters.find(f => f.k === 'eq' && f.c === 'observation_type');
            assert.ok(eq, 'delete without an observation_type eq');
            assert.ok(!LOG_TYPES.includes(eq.v), `delete targets log type ${eq.v}`);
        }
        assert.equal(logRows(), logsBefore, 'log rows survive the resets');
    });
});

// ── T8 ────────────────────────────────────────────────────────────────────────────────────────
describe('T8: daily snapshot', () => {
    const at = (h) => Date.UTC(2023, 10, 14, h, 2, 0);
    const key = '2023-11-14T03:00:00.000Z';
    function withBins() {
        const rows = [];
        for (const k of ['0-3000_rising', '0-3000_falling', '0-3000_steady', '3000-6000_steady', '3000-6000_rising', '6000-12000_steady', 'stage_3000-6000_steady', 'stage_6000-12000_steady', 'stage_6000-12000_rising']) {
            rows.push({ observation_type: 'gf_correction_bin', gauge_id: k, data: { count: 11, sumError: 55, sumErrorSq: 900, meanError: 5, emaMeanError: 4.5 } });
        }
        rows.push({ observation_type: 'shadow_leaderboard', gauge_id: 'system', data: { totalRounds: 41 } });
        return createMemClient({ rows });
    }

    it('hour 3 writes one row holding EVERY bin row in the store plus the leaderboard', async (t) => {
        quiet(t);
        const mem = withBins();
        const b = new LogBudget();
        assert.equal(await runBinSnapshot(mem.client, b, at(3)), 'written');
        const snaps = mem.of('bin_snapshot');
        assert.equal(snaps.length, 1);
        assert.equal(snaps[0].gauge_id, key);
        const want = mem.of('gf_correction_bin').map(r => r.gauge_id).sort();
        assert.deepEqual(Object.keys(snaps[0].data.bins).sort(), want);
        assert.equal(snaps[0].data.lb.totalRounds, 41);
        // set equality tracks the store, not a fixed 36: add one more bin and re-run on a fresh day
        mem.add({ observation_type: 'gf_correction_bin', gauge_id: '25000-50000_steady', data: { count: 1, sumError: 1, sumErrorSq: 1, meanError: 1, emaMeanError: 1 } });
        assert.equal(await runBinSnapshot(mem.client, b, Date.UTC(2023, 10, 15, 3, 2, 0)), 'written');
        assert.equal(Object.keys(mem.get('bin_snapshot', '2023-11-15T03:00:00.000Z').bins).length, want.length + 1);
    });

    it('hours 4 and 5 write only when the day row is missing', async (t) => {
        quiet(t);
        const mem = withBins();
        const b = new LogBudget();
        assert.equal(await runBinSnapshot(mem.client, b, at(4)), 'written', 'missing -> written at hour 4');
        assert.equal(await runBinSnapshot(mem.client, b, at(5)), 'exists');
        assert.equal(await runBinSnapshot(mem.client, b, at(4)), 'exists');
        assert.equal(mem.of('bin_snapshot').length, 1);
    });

    it('other hours write nothing and touch nothing', async (t) => {
        quiet(t);
        const mem = withBins();
        for (const h of [0, 1, 2, 6, 12, 23]) assert.equal(await runBinSnapshot(mem.client, new LogBudget(), at(h)), 'not_due');
        assert.equal(mem.ops.length, 0);
    });

    it('a 23505 re-run is success', async (t) => {
        quiet(t);
        const mem = withBins();
        const b = new LogBudget();
        assert.equal(await runBinSnapshot(mem.client, b, at(3)), 'written');
        assert.equal(await runBinSnapshot(mem.client, b, at(3)), 'dup');
        assert.equal(mem.of('bin_snapshot').length, 1);
        assert.equal(b.fails.length, 0, 'dup is not a failure');
    });

    it('a read failure is non-fatal and writes nothing', async (t) => {
        quiet(t);
        const bad = { from: () => ({ select: () => ({ eq: () => Promise.reject(new Error('read down')) }) }) };
        const b = new LogBudget();
        assert.equal(await runBinSnapshot(bad, b, at(3)), 'read_error');
        assert.equal(b.pending.errors, 1);
        // empty bin table: nothing worth snapshotting
        assert.equal(await runBinSnapshot(createMemClient().client, new LogBudget(), at(3)), 'no_bins');
    });
});

// ── T10 ───────────────────────────────────────────────────────────────────────────────────────
describe('T10: no public exposure', () => {
    it('sync-learning.js mentions none of the new types', () => {
        const src = fs.readFileSync(path.join(__dirname, '../netlify/functions/sync-learning.js'), 'utf8');
        for (const type of ['tick_log', 'validation_log', 'bin_snapshot', 'log_health']) {
            assert.ok(!src.includes(type), `sync-learning.js mentions ${type}`);
        }
    });
    it('no src/ module mentions them either (the browser never reads this table)', () => {
        const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
        for (const f of walk(path.join(__dirname, '../src')).filter(f => /\.(js|mjs)$/.test(f))) {
            const src = fs.readFileSync(f, 'utf8');
            for (const type of ['tick_log', 'validation_log', 'bin_snapshot', 'log_health']) {
                assert.ok(!src.includes(type), `${f} mentions ${type}`);
            }
        }
    });
});

describe('Final re-audit residue: FM-6 scrub on housekeeping', () => {
    it('FM-6: a URL in the housekeeping error is not stored in aux.error', async (t) => {
        quiet(t);
        const mem = createMemClient();
        const evil = { valueOf() { throw new Error('boom at https://test.supabase.co/rest/v1?apikey=SECRET&x=1 end'); } };
        const aux = await runLogHousekeeping(mem.client, new LogBudget(), evil);
        assert.ok(aux.error, 'the catch path ran');
        assert.ok(!JSON.stringify(aux).includes('SECRET'));
        assert.match(aux.error, /<url>/);
    });
});

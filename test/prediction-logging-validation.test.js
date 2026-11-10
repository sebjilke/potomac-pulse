// A3 (v39.2) T9: one validation_log row for every terminal fate of a pending prediction row, with the
// right join key and bin state, and learning that is identical whether the log write succeeds, errors,
// rejects or hangs.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../netlify/functions/scheduled-update');
const { validatePendingPredictions, storePrediction, storeValidationPair, LogBudget, flushDeferredLogs } = _test;
const { createMemClient, LOG_TYPES } = require('./helpers/mem-supabase');

const NOW = 1_700_000_000_000;
const HOUR = 3600000;
const iso = (ms) => new Date(ms).toISOString();

const quiet = (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'error', () => {});
};
const flush = () => new Promise(r => setImmediate(r));
async function settle(n = 6) { for (let i = 0; i < n; i++) await flush(); }
// Runs `fn()` to completion while fake timers are on, advancing the clock whenever it is parked.
async function drive(t, fn) {
    let done = false, result, error;
    const p = fn().then(v => { done = true; result = v; }, e => { done = true; error = e; });
    for (let i = 0; i < 60 && !done; i++) { await settle(); if (!done) t.mock.timers.tick(500); }
    await p;
    if (error) throw error;
    return result;
}
const start = (t) => { t.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); t.mock.timers.setTime(NOW); quiet(t); };

const usgs = {
    data: { '01646500': { q: 10000, h: 3.95, qTime: NOW - 12 * 60000, hTime: NOW - 11 * 60000 }, '01645000': {}, '01644148': {} },
    gauges: { lf: '01646500', seneca: '01645000', ef: '01644148' },
};
const hardUsgs = {
    data: { '01646500': { q: 1200, h: 2.5, qTime: NOW - 12 * 60000, hTime: NOW - 11 * 60000 }, '01645000': {}, '01644148': {} },
    gauges: { lf: '01646500', seneca: '01645000', ef: '01644148' },
};
const PRED_TS = iso(NOW - 3 * HOUR);
function pendingRow(overrides = {}, rowOverrides = {}) {
    return {
        observation_type: 'gf_prediction', gauge_id: 'pending',
        created_at: iso(NOW - HOUR),
        data: {
            timestamp: PRED_TS,
            validationDue: iso(NOW - 10 * 60000),
            predictedCFS: 10500, rawFinalCFS: 10800, correctionApplied: 300,
            predictedStage: 4.0, rawFinalStage: 4.05,
            flowBin: '6000-12000', flowState: 'steady', lfCFS: 9900, ceilingApplied: false,
            efStage: 3.5,
            efDivergence: 1.02, divergenceActive: false, lfResidualActive: false, lfResidualLastErrPct: null,
            shadowModels: { lfFeedback: 10100, onlineRegression: 10300, kalman: 10050 },
            ...overrides,
        },
        ...rowOverrides,
    };
}
const BIN = { count: 12, sumError: 3000, sumErrorSq: 900000, meanError: 250, emaMeanError: 260 };
const STAGE_BIN = { count: 8, sumError: 0.8, sumErrorSq: 0.2, meanError: 0.1, emaMeanError: 0.09 };

function seedStore(pending, extra = [], opts = {}) {
    const rows = [pending,
        { observation_type: 'gf_correction_bin', gauge_id: '6000-12000_steady', data: { ...BIN } },
        { observation_type: 'gf_correction_bin', gauge_id: 'stage_6000-12000_steady', data: { ...STAGE_BIN } },
        { observation_type: 'gf_metadata', gauge_id: 'system', data: { totalValidations: 40, totalPredictions: 50, validValidations: 38, sumAbsErrorPercent: 120, hardFlaggedValidations: 2, softFlaggedValidations: 0, shadowServerMigration: 'x' } },
        ...extra];
    return createMemClient({ rows, ...opts });
}
const vlogs = (mem) => mem.of('validation_log').map(r => r.data);
const nonLog = (mem) => mem.rows
    .filter(r => !LOG_TYPES.includes(r.observation_type))
    .map(r => ({ type: r.observation_type, gid: r.gauge_id, data: JSON.parse(JSON.stringify(r.data)) }))
    .sort((a, b) => (a.type + a.gid).localeCompare(b.type + b.gid));
const nonLogWrites = (mem) => mem.ops
    .filter(o => !LOG_TYPES.includes(o.type) && o.op !== 'select')
    .map(o => JSON.stringify([o.op, o.type, o.filters, o.payload]));

describe('T9: validation_log rows', () => {
    it('validated: one row, join key, bin before/after, stage capture, pair status, leaderboard', async (t) => {
        start(t);
        const mem = seedStore(pendingRow());
        const budget = new LogBudget();
        const res = await validatePendingPredictions(mem.client, usgs, 15, { budget });
        assert.equal(res.validated, 1);
        const rows = vlogs(mem);
        assert.equal(rows.length, 1);
        const r = rows[0];
        const pending = pendingRow();
        assert.equal(r.outcome, 'validated');
        assert.equal(r.predTs, pending.data.timestamp, 'join key equals the pending row timestamp');
        assert.equal(r.predAt, pending.created_at);
        assert.equal(r.dueAt, pending.data.validationDue);
        assert.equal(r.valAt, iso(NOW));
        assert.equal(r.delayMin, 10);
        assert.equal(r.rawCFS, 10800); assert.equal(r.corrCFS, 10500);
        assert.equal(r.corrApplied, 300); assert.equal(r.lfAtPred, 9900);
        assert.equal(r.actualCFS, 10000);
        assert.equal(r.errRawCFS, 800);
        assert.equal(r.errPctRaw, 8);
        assert.equal(r.errPctCorr, 5);
        assert.equal(r.actualT, usgs.data['01646500'].qTime);
        assert.equal(r.actualStageT, usgs.data['01646500'].hTime);
        assert.equal(r.rawStage, 4.05); assert.equal(r.predStage, 4); assert.equal(r.actualStage, 3.95);
        assert.equal(r.bin, '6000-12000'); assert.equal(r.st, 'steady');
        assert.equal(r.learned, true); assert.equal(r.accuracyCounted, true);
        assert.equal(r.binReadFailed, false); assert.equal(r.binWriteFailed, false);
        // bin state: before is the pre-update bin, after is the bin as stored
        assert.deepEqual(r.binBefore, { n: 12, ema: 260, sd: Math.round(Math.sqrt(900000 / 12 - 250 * 250) * 1000) / 1000 });
        assert.deepEqual(r.binAfter, mem.get('gf_correction_bin', '6000-12000_steady'));
        assert.equal(r.binAfter.count, 13);
        assert.notEqual(r.binAfter.emaMeanError, 260);
        // stage bin capture equals the stored stage bin
        assert.equal(r.stage.key, 'stage_6000-12000_steady');
        assert.equal(r.stage.before.n, 8);
        assert.deepEqual(r.stage.after, mem.get('gf_correction_bin', 'stage_6000-12000_steady'));
        assert.equal(r.stage.after.count, 9);
        assert.equal(r.pairStored, 'written');
        assert.equal(r.lb.totalRounds, 1, 'post-update leaderboard');
        assert.deepEqual(r.lb, mem.get('shadow_leaderboard', 'system'));
        assert.equal(r.efDiv, 1.02);
        assert.equal(r.tC, 15);
        // the claim removed the pending row
        assert.equal(mem.of('gf_prediction').length, 0);
        assert.equal(budget.fails.length, 0);
    });

    it('validated: pairStored reflects the 30-minute dedupe', async (t) => {
        start(t);
        const hist = { readings: [{ timestamp: NOW - 5 * 60000, predictedCFS: 1, actualCFS: 1, errorPercent: 0 }] };
        const mem = seedStore(pendingRow(), [{ observation_type: 'gf_validation_history', gauge_id: 'system', data: hist }]);
        await validatePendingPredictions(mem.client, usgs, 15, { budget: new LogBudget() });
        assert.equal(vlogs(mem)[0].pairStored, 'deduped');
    });

    it('storeValidationPair returns written / deduped / error', async (t) => {
        start(t);
        const m1 = createMemClient();
        assert.equal(await storeValidationPair(m1.client, 100, 100, 0, 'b', 'steady'), 'written');
        assert.equal(await storeValidationPair(m1.client, 100, 100, 0, 'b', 'steady'), 'deduped');
        const m2 = createMemClient({ faults: { upsertFail: ['system'] } });
        assert.equal(await storeValidationPair(m2.client, 100, 100, 0, 'b', 'steady'), 'error');
    });

    it('validated with a failed bin write: binAfter is null, binWriteFailed true', async (t) => {
        start(t);
        const mem = seedStore(pendingRow(), [], { faults: { upsertFail: ['6000-12000_steady'] } });
        await validatePendingPredictions(mem.client, usgs, 15, { budget: new LogBudget() });
        const r = vlogs(mem)[0];
        assert.equal(r.binWriteFailed, true);
        assert.equal(r.binAfter, null);
        assert.ok(r.binBefore);
    });

    it('validated with a failed stage bin write: stage.after is null and the key is recorded', async (t) => {
        start(t);
        const mem = seedStore(pendingRow(), [], { faults: { upsertFail: ['stage_6000-12000_steady'] } });
        await validatePendingPredictions(mem.client, usgs, 15, { budget: new LogBudget() });
        const r = vlogs(mem)[0];
        assert.equal(r.stageBinWriteFailedKey, 'stage_6000-12000_steady');
        assert.equal(r.stage.after, null);
        assert.ok(r.binAfter, 'the flow bin write was fine');
    });

    it('hard_flagged: learning skipped, flags kept in full, no bin state', async (t) => {
        start(t);
        const mem = seedStore(pendingRow({ lfCFS: 1300, predictedCFS: 1250, rawFinalCFS: 1250 }));
        const res = await validatePendingPredictions(mem.client, hardUsgs, 1, { budget: new LogBudget() });
        assert.equal(res.validated, 1);
        const r = vlogs(mem)[0];
        assert.equal(r.outcome, 'hard_flagged');
        assert.equal(r.hard, true);
        assert.equal(r.learned, false); assert.equal(r.accuracyCounted, false);
        assert.ok(r.flags.some(f => f.startsWith('LOW_FLOW_HIGH_STAGE:')));
        assert.equal(r.binBefore, null); assert.equal(r.binAfter, null);
        assert.equal(r.pairStored, null);
        assert.equal(mem.of('validation_failure').length, 1, 'the existing validation_failure row is still written');
    });

    it('bin_read_failed: claimed, learning skipped, outcome says so', async (t) => {
        start(t);
        const mem = seedStore(pendingRow(), [], { faults: { readFail: ['6000-12000_steady'] } });
        const res = await validatePendingPredictions(mem.client, usgs, 15, { budget: new LogBudget() });
        assert.equal(res.validated, 1);
        const r = vlogs(mem)[0];
        assert.equal(r.outcome, 'bin_read_failed');
        assert.equal(r.binReadFailed, true);
        assert.equal(r.learned, false); assert.equal(r.accuracyCounted, false);
        assert.equal(r.binAfter, null);
        assert.deepEqual(mem.get('gf_correction_bin', '6000-12000_steady'), BIN, 'the bin was not overwritten');
    });

    it('stale_deleted', async (t) => {
        start(t);
        const mem = seedStore(pendingRow({}, { created_at: iso(NOW - 60 * HOUR) }));
        const res = await validatePendingPredictions(mem.client, usgs, 15, { budget: new LogBudget() });
        assert.equal(res.cleaned, 1);
        const rows = vlogs(mem);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].outcome, 'stale_deleted');
        assert.equal(rows[0].predTs, PRED_TS);
        assert.equal(rows[0].ageH, 60);
        assert.equal(rows[0].delFailed, false);
        assert.equal(rows[0].actualCFS, undefined);
        assert.equal(mem.of('gf_prediction').length, 0);
    });

    it('bad_due_deleted', async (t) => {
        start(t);
        const mem = seedStore(pendingRow({ validationDue: 'not-a-date' }));
        const res = await validatePendingPredictions(mem.client, usgs, 15, { budget: new LogBudget() });
        assert.equal(res.cleaned, 1);
        const rows = vlogs(mem);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].outcome, 'bad_due_deleted');
        assert.equal(rows[0].dueAt, 'not-a-date');
        assert.equal(rows[0].predTs, PRED_TS);
    });

    it('claim_failed', async (t) => {
        start(t);
        const mem = seedStore(pendingRow(), [], { faults: { claim: 'error' } });
        const res = await validatePendingPredictions(mem.client, usgs, 15, { budget: new LogBudget() });
        assert.equal(res.validated, 0);
        const rows = vlogs(mem);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].outcome, 'claim_failed');
        assert.ok(rows[0].claimErr.includes('claim failed'));
        assert.equal(rows[0].predTs, PRED_TS);
        assert.equal(mem.of('gf_correction_bin').length, 2, 'no learning');
    });

    it('claim_lost', async (t) => {
        start(t);
        const mem = seedStore(pendingRow(), [], { faults: { claim: 'lost' } });
        const res = await validatePendingPredictions(mem.client, usgs, 15, { budget: new LogBudget() });
        assert.equal(res.validated, 0);
        const rows = vlogs(mem);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].outcome, 'claim_lost');
        assert.equal(rows[0].delayMin, 10);
        assert.deepEqual(mem.get('gf_correction_bin', '6000-12000_steady'), BIN, 'no learning');
    });

    it('replaced_missed_window: storePrediction logs the row it replaced and returns replaced', async (t) => {
        start(t);
        const old = pendingRow({ validationDue: iso(NOW - 10 * HOUR) });
        const mem = createMemClient({ rows: [old] });
        const budget = new LogBudget();
        const status = await storePrediction(mem.client, { timestamp: iso(NOW), predictedCFS: 9000, validationDue: iso(NOW + 5 * HOUR) }, { budget });
        assert.equal(status, 'replaced');
        const rows = vlogs(mem);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].outcome, 'replaced_missed_window');
        assert.equal(rows[0].predTs, PRED_TS, 'the OLD row is the one described');
        assert.equal(rows[0].dueAt, old.data.validationDue);
        assert.equal(mem.get('gf_prediction', 'pending').predictedCFS, 9000);
    });

    it('storePrediction statuses: stored, skipped_in_window (no log row), insert_failed', async (t) => {
        start(t);
        const fresh = createMemClient();
        assert.equal(await storePrediction(fresh.client, { predictedCFS: 1, validationDue: iso(NOW + HOUR) }, { budget: new LogBudget() }), 'stored');
        assert.equal(await storePrediction(fresh.client, { predictedCFS: 2, validationDue: iso(NOW + HOUR) }, { budget: new LogBudget() }), 'skipped_in_window');
        assert.equal(fresh.of('validation_log').length, 0);
        const failing = createMemClient({ insertMode: { gf_prediction: 'error' } });
        assert.equal(await storePrediction(failing.client, { predictedCFS: 1, validationDue: iso(NOW + HOUR) }, { budget: new LogBudget() }), 'insert_failed');
        // replaced, then the new insert fails: the old row is still logged
        const both = createMemClient({ rows: [pendingRow({ validationDue: iso(NOW - 10 * HOUR) })], insertMode: { gf_prediction: 'error' } });
        assert.equal(await storePrediction(both.client, { predictedCFS: 1, validationDue: iso(NOW + HOUR) }, { budget: new LogBudget() }), 'insert_failed');
        assert.equal(both.of('validation_log').length, 1);
    });

    it('a row that is not yet due, or past the window, leaves no fate row', async (t) => {
        start(t);
        for (const due of [iso(NOW + HOUR), iso(NOW - 5 * HOUR)]) {
            const mem = seedStore(pendingRow({ validationDue: due }));
            const res = await validatePendingPredictions(mem.client, usgs, 15, { budget: new LogBudget() });
            assert.equal(res.validated, 0);
            assert.equal(mem.of('validation_log').length, 0);
            assert.equal(mem.of('gf_prediction').length, 1, 'still pending');
        }
    });

    it('deferred mode (what the handler uses): nothing is written during validation, the flush writes the same rows', async (t) => {
        start(t);
        const ctx = { budget: new LogBudget(), defer: true, queue: [] };
        const mem = seedStore(pendingRow({ validationDue: iso(NOW - 10 * 60000) }));
        await validatePendingPredictions(mem.client, usgs, 15, ctx);
        assert.equal(mem.of('validation_log').length, 0, 'no log insert before the flush');
        assert.equal(mem.ops.filter(o => o.op === 'insert' && o.type === 'validation_log').length, 0);
        assert.equal(ctx.queue.length, 1);
        await flushDeferredLogs(mem.client, ctx);
        assert.equal(ctx.queue.length, 0);
        const rows = vlogs(mem);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].outcome, 'validated');
        assert.equal(rows[0].predTs, PRED_TS);
        assert.deepEqual(rows[0].binAfter, mem.get('gf_correction_bin', '6000-12000_steady'));
        // a failed deferred write is visible on the budget and does not throw
        const bad = { budget: new LogBudget(), defer: true, queue: [] };
        const mem2 = seedStore(pendingRow(), [], { insertMode: { validation_log: 'reject' } });
        await validatePendingPredictions(mem2.client, usgs, 15, bad);
        await flushDeferredLogs(mem2.client, bad);
        assert.equal(bad.budget.fails.length, 1);
        assert.equal(bad.budget.fails[0].predTs, PRED_TS);
    });

    it('FM-1: a throw after the claim leaves the pending row marked inflight; a normal run clears the mark', async (t) => {
        start(t);
        const ctx = { budget: new LogBudget(), defer: true, queue: [] };
        const mem = seedStore(pendingRow());
        const real = mem.client.from;
        mem.client.from = (tbl) => {
            const b = real(tbl);
            const up = b.upsert.bind(b);
            b.upsert = (row, o) => { if (row.observation_type === 'gf_correction_bin') throw new Error('bin upsert threw'); return up(row, o); };
            return b;
        };
        await assert.rejects(() => validatePendingPredictions(mem.client, usgs, 15, ctx), /bin upsert threw/);
        assert.equal(ctx.inflight.pred.data.timestamp, PRED_TS);
        assert.equal(ctx.queue.length, 0, 'no fate queued yet: the handler catch does that');
        const ok = { budget: new LogBudget(), defer: true, queue: [] };
        await validatePendingPredictions(seedStore(pendingRow()).client, usgs, 15, ok);
        assert.equal(ok.inflight, null);
        assert.equal(ok.queue.length, 1);
    });

    it('with no logCtx (the default) nothing is written: existing callers are unchanged', async (t) => {
        start(t);
        const mem = seedStore(pendingRow());
        await validatePendingPredictions(mem.client, usgs, 15);
        assert.equal(mem.of('validation_log').length, 0);
    });

    // Learning must be bit-identical whatever the log write does.
    for (const mode of ['error', 'reject', 'hang']) {
        it(`learning is identical when the validation_log insert ${mode === 'hang' ? 'hangs' : mode === 'reject' ? 'rejects' : 'returns an error'}`, { timeout: 3000 }, async (t) => {
            start(t);
            const baseline = seedStore(pendingRow());
            await validatePendingPredictions(baseline.client, usgs, 15, { budget: new LogBudget() });
            const want = nonLog(baseline);
            const wantWrites = nonLogWrites(baseline);

            const mem = seedStore(pendingRow(), [], { insertMode: { validation_log: mode } });
            const budget = new LogBudget();
            const res = await drive(t, () => validatePendingPredictions(mem.client, usgs, 15, { budget }));
            assert.equal(res.validated, 1);
            assert.deepEqual(nonLog(mem), want, 'bins, metadata, validation history, leaderboard, EF correlation all identical');
            assert.deepEqual(nonLogWrites(mem), wantWrites, 'identical non-log write sequence');
            assert.equal(mem.of('validation_log').length, 0);
            assert.equal(budget.fails.length, 1);
            assert.equal(budget.fails[0].type, 'validation_log');
            assert.equal(budget.fails[0].predTs, PRED_TS);
            assert.equal(budget.fails[0].reason, mode === 'hang' ? 'timeout' : 'error');
        });
    }

    it('hard-flag path: learning identical with a failing validation_log insert', async (t) => {
        start(t);
        const mk = (opts) => seedStore(pendingRow({ lfCFS: 1300, predictedCFS: 1250, rawFinalCFS: 1250 }), [], opts);
        const a = mk(); await validatePendingPredictions(a.client, hardUsgs, 1, { budget: new LogBudget() });
        const b = mk({ insertMode: { validation_log: 'reject' } }); await validatePendingPredictions(b.client, hardUsgs, 1, { budget: new LogBudget() });
        assert.deepEqual(nonLog(b), nonLog(a));
    });
});

describe('Final re-audit residue: FM-6 scrub on claim_failed', () => {
    it('FM-6: a URL in the claim error is not stored in validation_log.claimErr', async (t) => {
        start(t);
        const mem = seedStore(pendingRow(), [], { faults: { claim: 'error', claimMsg: 'bad https://test.supabase.co/rest/v1?apikey=SECRET&x=1 end' } });
        await validatePendingPredictions(mem.client, usgs, 15, { budget: new LogBudget() });
        const rows = vlogs(mem);
        assert.equal(rows[0].outcome, 'claim_failed');
        assert.ok(!JSON.stringify(rows).includes('SECRET'));
        assert.match(rows[0].claimErr, /<url>/);
    });
});

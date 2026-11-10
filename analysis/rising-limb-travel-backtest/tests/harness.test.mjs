import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as H from '../rising_limb_harness.mjs';

const T0 = Date.UTC(2020, 0, 1);
const fakeD = { epoch: (i) => T0 + i * H.HOUR };
const mkInp = (q, h = 2.0, temp = null) => ({ lf: { q, h }, ef: {}, temp, por: 1000, lfq: q });
const mkPendData = (dueMs, extra = {}) => ({ validationDue: new Date(dueMs).toISOString(), rawFinalCFS: 1000, predictedCFS: 1000,
  rawFinalStage: 2, predictedStage: 2, flowBin: '0-3000', flowState: 'steady', ...extra });
const setPending = (c, createdIdx, dueIdx, extra) => { c.pending = { id: 1, created_at: new Date(fakeD.epoch(createdIdx)).toISOString(), createdMs: fakeD.epoch(createdIdx), data: mkPendData(fakeD.epoch(dueIdx), extra) }; };

test('lag view: carry-forward within 3 h, missing beyond', () => {
  const a = new Float64Array(20).fill(NaN); a[10] = 5;
  assert.equal(H.view(a, 12, 2), 5);          // s = 10
  assert.equal(H.view(a, 13, 2), 5);          // s = 11 blank, carry 1 h
  assert.equal(H.view(a, 15, 2), 5);          // s = 13, carry 3 h
  assert.ok(Number.isNaN(H.view(a, 16, 2)));  // s = 14, carry would need 4 h
});

test('PoR history: stamps <= t-2h within 72 h, timestamp s+30 min, blanks skipped', () => {
  const D = { por: new Float64Array(200).fill(NaN), epoch: (i) => T0 + i * H.HOUR };
  for (let j = 0; j < 200; j++) D.por[j] = 100 + j; D.por[95] = NaN;
  const h = H.porHistoryAt(D, 100);
  assert.equal(h[h.length - 1].cfs, 198 - 100 + 100 - 0 + 0 === 198 ? 198 : 198);  // stamp 98 -> 198
  assert.equal(h[h.length - 1].timestamp, D.epoch(98) + 30 * 60e3);
  assert.equal(h[0].timestamp, D.epoch(28) + 30 * 60e3);
  assert.ok(!h.some(e => e.timestamp === D.epoch(95) + 30 * 60e3));
  assert.equal(h.length, 98 - 28 + 1 - 1);
});

test('loadData never reads por_lagged or travel_time_h', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  const mk = (lag, tt) => {
    const p = path.join(dir, `x${lag}.csv`);
    fs.writeFileSync(p, `timestamp,por_now,por_lagged,ef_stage,lf_discharge,lf_stage,water_temp_c,monocacy,goose,broad_run,seneca,travel_time_h\n` +
      `2020-01-01 00:00,100,${lag},3,200,2,,1,2,3,4,${tt}\n2020-01-01 01:00,110,${lag},3,210,2,,1,2,3,4,${tt}\n`);
    return H.loadData(p);
  };
  const a = mk(1, 1), b = mk(999999, -5);
  for (const k of ['por', 'lf', 'ef', 'temp', 'monocacy']) assert.deepEqual(Array.from(a[k]), Array.from(b[k]));
});

test('no reading from the future: poisoning every index >= t leaves inputs, history and base prediction unchanged', () => {
  const D = H.loadData();
  const keys = ['por', 'temp', 'ef', 'lf', 'lfStage', 'monocacy', 'goose', 'broadRun', 'seneca'];
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const chainA = new H.ArmChain('base');
  for (let k = 0; k < 200; k++) {
    const i = 1000 + Math.floor(rnd() * (D.n - 2000));
    const inp1 = H.inputsAt(D, i), h1 = H.porHistoryAt(D, i);
    const r1 = chainA.predict(D, i, inp1);
    const P = { ...D };
    for (const key of keys) { P[key] = D[key].slice(); for (let j = i; j < D.n; j++) P[key][j] = 987654; }
    const inp2 = H.inputsAt(P, i), h2 = H.porHistoryAt(P, i);
    const r2 = chainA.predict(P, i, inp2);
    assert.ok(H.deepEq(inp1.usgs, inp2.usgs) && H.deepEq(h1, h2) && H.deepEq(r1, r2), `future leak at ${i}`);
  }
});

test('deepEq is zero tolerance; invariant comparer ignores fields after rawUnc only', () => {
  assert.equal(H.deepEq(1, 1 + 1e-12), false);
  assert.equal(H.deepEq({ a: [1, 2] }, { a: [1, 2] }), true);
  const mk = (raw, o = {}) => ({ pred: { rawFinalCFS: raw }, trace: { rate: 1, stop: 'converged', rawUnc: raw, corr: 0, unc: raw, ...o } });
  assert.equal(H.sameRawPrefix(mk(5), mk(5, { corr: 99, unc: 77 })), true);   // after rawUnc: ignored
  assert.equal(H.sameRawPrefix(mk(5), mk(6)), false);
  assert.equal(H.sameRawPrefix(mk(5), mk(5, { stop: 'max_iter' })), false);    // before rawUnc: compared
});

test('chain (a): retries every tick while LF missing or out of range; early returns leave the row', async () => {
  const c = new H.ArmChain('base'); setPending(c, 0, 10);
  let o = await c.validate(fakeD, 10, { lf: { q: null }, ef: {}, temp: null });
  assert.equal(o.validated, false); assert.ok(c.pending);
  o = await c.validate(fakeD, 11, mkInp(400));   // below 500
  assert.equal(o.validated, false); assert.ok(c.pending);
  o = await c.validate(fakeD, 12, mkInp(1000));  // due+2h, inside 2.5 h
  assert.equal(o.validated, true); assert.equal(c.pending, null);
});

test('chain (a2): a pending that missed the 2.5 h window stays, blocks the slot until replaceable', async () => {
  const c = new H.ArmChain('base'); setPending(c, 0, 10);
  const o = await c.validate(fakeD, 13, mkInp(1000));   // due+3h
  assert.equal(o.validated, false); assert.ok(c.pending);
  c.pending.data.validationDue = new Date(fakeD.epoch(11)).toISOString();   // t=13 -> 2 h after due: still in window
  assert.equal(c.store(fakeD, 13, mkPendData(fakeD.epoch(20))), 'skipped_in_window');
  c.pending.data.validationDue = new Date(fakeD.epoch(10)).toISOString();   // 3 h after due: replaceable
  assert.equal(c.store(fakeD, 13, mkPendData(fakeD.epoch(20))), 'stored');
  assert.equal(c.n.replaced, 1);
});

test('chain (b): hard-flagged pending is still claimed (slot freed) but not learned', async () => {
  const c = new H.ArmChain('base'); setPending(c, 0, 10);
  const o = await c.validate(fakeD, 10, mkInp(1000, 3.0, 2.0));   // low flow + high stage + cold: Check 3 hard
  assert.equal(o.validated, true); assert.equal(o.hard, true);
  assert.equal(c.pending, null); assert.equal(c.written.size, 0); assert.equal(c.n.claims, 1);
});

test('chain (c): stale cleanup (>48 h) does not run on ticks where LF is missing or out of range', async () => {
  const c = new H.ArmChain('base'); setPending(c, 0, 5);
  await c.validate(fakeD, 60, { lf: { q: null }, ef: {}, temp: null });
  assert.ok(c.pending, 'LF missing: no cleanup');
  await c.validate(fakeD, 60, mkInp(400));
  assert.ok(c.pending, 'LF out of range: no cleanup');
  const o = await c.validate(fakeD, 60, mkInp(1000));
  assert.equal(c.pending, null); assert.equal(o.cleaned, true); assert.equal(c.n.stale, 1); assert.equal(o.validated, false);
});

test('chain (d): learning bin key comes from the stored prediction, not the bin at validation', async () => {
  const c = new H.ArmChain('base');
  setPending(c, 0, 10, { flowBin: '0-3000', flowState: 'rising', rawFinalCFS: 1100 });
  await c.validate(fakeD, 10, mkInp(20000, 4.5));   // LF now sits in a far higher bin; stored bin must still be used
  assert.deepEqual([...c.written], ['0-3000_rising']);
  assert.equal(c.bins['0-3000'].rising.count, 1);
});

test('soft outlier path uses the shared updateCorrectionBin (learned, flagged soft)', async () => {
  const c = new H.ArmChain('base');
  // warm a bin to >= 10 observations with small errors, then a z>3 outlier
  for (let k = 0; k < 12; k++) { setPending(c, 0, 0, { rawFinalCFS: 1000 + (k % 3) }); await c.validate(fakeD, 0, mkInp(1000)); }
  setPending(c, 0, 0, { rawFinalCFS: 1900 });
  const o = await c.validate(fakeD, 0, mkInp(1000));
  assert.equal(o.validated, true); assert.equal(o.hard, false); assert.equal(o.gate.isSoftFlagged, true);
  assert.ok(o.gate.binUpdate.clamped);
});

test('tick row schema has every column, labels derive from the frozen event file', () => {
  const evs = H.loadEvents();
  assert.equal(evs.length, 53);
  const oct = evs.find(e => e.oct);
  const lab = H.labelTick(evs, oct.t0);
  assert.equal(lab.rl_event, String(oct.id)); assert.equal(lab.normal, 0);
  const far = H.labelTick(evs, Date.UTC(2013, 5, 1));
  assert.equal(far.normal, 1);
  const D = H.loadData(); const i = D.idx(Date.UTC(2026, 9, 13, 12));
  const inp = H.inputsAt(D, i); const c = new H.ArmChain('base'); const r = c.predict(D, i, inp);
  const row = H.tickRow({ D, i, arm: 'base', r, base: r, tr: H.truthAt(D, i), labels: lab, inp, tickOut: null });
  assert.deepEqual(Object.keys(row).sort(), [...H.TICK_COLUMNS].sort());
  assert.equal(row.unc, r.trace.unc);   // trace.unc as returned
});

test('runReplay plumbing: 4 arm rows per tick, schema columns, base_rst on every arm row, in_scoring, b_active, snapshots (burn-in slice, counts only)', async () => {
  const D = H.loadData(); const evs = H.loadEvents();
  const rows = []; const snaps = [];
  await H.runReplay(D, { evs, limit: 600, onRow: r => rows.push(r), snapshotAt: new Map([[300, [1]]]), onSnapshot: (i, a, s) => snaps.push([i, a, Object.keys(s)]) });
  assert.equal(rows.length, 2400); assert.equal(snaps.length, 4);
  assert.deepEqual(Object.keys(rows[0]), H.TICK_COLUMNS);
  assert.ok(!('rising' in rows[0]) && 'b_active' in rows[0] && 'in_scoring' in rows[0]);
  assert.ok(rows.every(r => r.in_scoring === 0));                                    // 2011-12 .. 2011-12-26 is burn-in
  for (let k = 0; k < rows.length; k += 4) {                                          // same tick, four arms
    assert.deepEqual(rows.slice(k, k + 4).map(r => r.arm), H.ARMS);
    assert.equal(new Set(rows.slice(k, k + 4).map(r => r.base_rst)).size, 1);
    assert.equal(new Set(rows.slice(k, k + 4).map(r => r.truth)).size, 1);
  }
  assert.equal(new Date(Date.UTC(2012, 11, 1)).getTime(), H.SCORING_START_MS);
});

test('horizon truth columns follow D-5 H6 (first tick v >= t+h, search v..v+2 h) with h = base travel and own travel', () => {
  const D = H.loadData(); const evs = H.loadEvents();
  const i = D.idx(Date.UTC(2026, 9, 13, 12));
  const chains = Object.fromEntries(H.ARMS.map(a => [a, new H.ArmChain(a)]));
  const inp = H.inputsAt(D, i); const rb = chains.base.predict(D, i, inp), rc = chains.C.predict(D, i, inp);
  const row = H.tickRow({ D, i, arm: 'C', r: rc, base: rb, tr: H.truthAt(D, i), labels: H.labelTick(evs, D.epoch(i)), inp });
  const eb = H.lfViewAtTime(D, i, rb.pred.travelTimeGFtoLF), eo = H.lfViewAtTime(D, i, rc.pred.travelTimeGFtoLF);
  assert.equal(row.truth_basehz, eb.v); assert.equal(row.truth_own, eo.v);
  assert.ok(eb.u >= i + rb.pred.travelTimeGFtoLF && eb.u <= i + Math.ceil(rb.pred.travelTimeGFtoLF) + 2);
  assert.equal(row.truth_basehz_tick, new Date(D.epoch(eb.u)).toISOString());
  // epsilon: an exact whole-hour horizon is not pushed to the next tick
  assert.equal(H.lfViewAtTime(D, i, 7.0).u, i + 7);
});

test('carry hours: 0 when the stamp is present, k when carried, NaN beyond 3 h', () => {
  const a = new Float64Array(20).fill(NaN); a[10] = 5;
  assert.equal(H.carryHours(a, 12, 2), 0); assert.equal(H.carryHours(a, 14, 2), 2); assert.equal(H.carryHours(a, 15, 2), 3);
  assert.ok(Number.isNaN(H.carryHours(a, 16, 2)));
});

test('window label STOP (D-5 H9): a second event id in one label throws', () => {
  const mk = (id) => ({ id, kept: true, ew: [0, 100], rl: [0, 100], rlx: [0, 100], recSet: new Set([50]) });
  assert.throws(() => H.labelTick([mk(1), mk(2)], 50), /STOP/);
  assert.doesNotThrow(() => H.labelTick([mk(1)], 50));
});

test('retries counter increments when a due pending meets a missing or out-of-range LF inside its window', async () => {
  const c = new H.ArmChain('base'); setPending(c, 0, 10);
  await c.validate(fakeD, 10, { lf: { q: null }, ef: {}, temp: null });
  await c.validate(fakeD, 11, mkInp(400));
  await c.validate(fakeD, 14, mkInp(400));   // outside the 2.5 h window: not a retry
  assert.equal(c.n.retries, 2);
});

test('multi-pending chain: every tick stores; due rows are claimed when LF is available', async () => {
  const c = new H.MultiChain('base');
  c.store(fakeD, 0, mkPendData(fakeD.epoch(5))); c.store(fakeD, 1, mkPendData(fakeD.epoch(5)));
  const o = await c.validate(fakeD, 6, mkInp(1000));
  assert.equal(o.validated, true); assert.equal(c.pendings.length, 0); assert.equal(c.n.validated, 2);
});

test('D-5 H12: S2/S3 views change inputs only; every truth column, tau_ref and the label columns equal the primary run; mask = primary mask AND view inputs', async () => {
  const D = H.loadData(); const evs = H.loadEvents();
  const get = async (cfg) => { const rows = []; await H.runReplay(D, { evs, cfg, limit: 700, onRow: r => rows.push(r) }); return rows; };
  const P = await get(H.PRIMARY);
  for (const cfg of [H.S2_VIEW, H.S3_VIEW]) {
    const V = await get(cfg);
    const truthCols = ['tau_ref', 'tau_converged', 'truth', 'truth_tick_utc', 'rl_event', 'rlx_event', 'rec_event', 'ew_any', 'normal'];
    let differsInput = 0;
    for (let k = 0; k < P.length; k++) {
      for (const c of truthCols) assert.equal(V[k][c], P[k][c], `${cfg.name} ${c} row ${k}`);
      if (V[k].mask === 1) assert.equal(P[k].mask, 1);
      if (V[k].lf_view !== P[k].lf_view || V[k].por_view !== P[k].por_view || V[k].raw !== P[k].raw) differsInput++;
    }
    assert.ok(differsInput > 0, 'the view must actually change the model inputs');
  }
});

test('D-5 H13: snapshot carries bins, written keys and pending slot of the state after the full tick', async () => {
  const c = new H.ArmChain('base'); setPending(c, 0, 10);
  await c.validate(fakeD, 10, mkInp(1000));
  const s = c.snapshot();
  assert.deepEqual(s.written, ['0-3000_steady']); assert.equal(s.pending, null);
  assert.equal(s.bins['3000-6000'].rising.count, 0);   // never written == empty (count 0)
});

// Replay harness for the rising-limb travel backtest (plan A7 sections 2, 4, 7). STEP 3, FIRST HALF.
// Lag view, hourly tick loop, per-arm single-slot learning chain, arm-independent truth and mask, window labels,
// tick-row schema, and the precondition runners. It computes NO error of any arm against the truth.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeVariant } from './rising_limb_model_variants.mjs';
import { runLearningGate } from './rising_limb_learning_gate.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SM = require('../../netlify/functions/shared/model.js');
const PROD = require('../../netlify/functions/scheduled-update.js')._test;
const { buildCorrectionBins, getFlowMultiplier, getGFtoLFTravelTime, getPoRRiseRateFromHistory,
  VALIDATION_MAX_DELAY_MS, isExistingPredictionReplaceable } = SM;

export const HOUR = 3600e3;
export const ARMS = ['base', 'A', 'B', 'C'];
export const GAUGES = { por: '01638500', lf: '01646500', monocacy: '01643000', goose: '01644000',
  broadRun: '01644280', seneca: '01645000', ef: '01644148' };
export const LAG = { por: 2, temp: 2, broadRun: 2, ef: 2, lf: 1, lfStage: 1, monocacy: 1, goose: 1, seneca: 1 };
export const CARRY = 3;
// Lag-view configurations. PRIMARY is plan section 2. S2 / S3 are the report-only views; the plan does not say how the
// truth reads under them, so the truth uses the same view's LF lag (see STEP_3_LOG.md, open question Q1).
export const PRIMARY = { name: 'primary', lag: LAG, histMaxLag: 2, histOffsetMs: 30 * 60e3, carry: CARRY };
export const S2_VIEW = { name: 'S2', lag: Object.fromEntries(Object.keys(LAG).map(k => [k, 0])), histMaxLag: 0, histOffsetMs: 0, carry: CARRY };
export const S3_VIEW = { name: 'S3', lag: Object.fromEntries(Object.keys(LAG).map(k => [k, 1])), histMaxLag: 1, histOffsetMs: 30 * 60e3, carry: CARRY };
const STALE_MS = 48 * HOUR;

// ---------- clock + console stub (model calls only) ----------
const RealDate = Date;
export function withSim(ms, fn) {
  const realLog = console.log;
  class SimDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(ms); else super(...a); }
    static now() { return ms; }
  }
  globalThis.Date = SimDate; console.log = () => {};
  try { return fn(); } finally { globalThis.Date = RealDate; console.log = realLog; }
}
export async function withSimAsync(ms, fn) {
  const realLog = console.log;
  class SimDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(ms); else super(...a); }
    static now() { return ms; }
  }
  globalThis.Date = SimDate; console.log = () => {};
  try { return await fn(); } finally { globalThis.Date = RealDate; console.log = realLog; }
}

// ---------- data ----------
export const tsToMs = (s) => RealDate.parse(s.replace(' ', 'T') + (s.length === 16 ? ':00Z' : 'Z'));
export function loadData(csvPath = path.join(HERE, 'hourly_backtest_data_v39.csv')) {
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  const hdr = lines[0].split(',');
  const col = Object.fromEntries(hdr.map((h, i) => [h, i]));
  const rows = lines.slice(1).map(l => l.split(','));
  const first = tsToMs(rows[0][col.timestamp]);
  const last = tsToMs(rows[rows.length - 1][col.timestamp]);
  const n = Math.round((last - first) / HOUR) + 1;
  const mk = () => new Float64Array(n).fill(NaN);
  const A = { por: mk(), temp: mk(), ef: mk(), lf: mk(), lfStage: mk(), monocacy: mk(), goose: mk(), broadRun: mk(), seneca: mk() };
  const src = { por: 'por_now', temp: 'water_temp_c', ef: 'ef_stage', lf: 'lf_discharge', lfStage: 'lf_stage',
    monocacy: 'monocacy', goose: 'goose', broadRun: 'broad_run', seneca: 'seneca' };   // por_lagged / travel_time_h are never read
  for (const r of rows) {
    const i = Math.round((tsToMs(r[col.timestamp]) - first) / HOUR);
    for (const [k, c] of Object.entries(src)) { const v = r[col[c]]; if (v !== '' && v !== undefined) A[k][i] = parseFloat(v); }
  }
  return { first, last, n, nrows: rows.length, ...A, epoch: (i) => first + i * HOUR, idx: (ms) => Math.round((ms - first) / HOUR) };
}

// stamp s = i - lag; blank -> carry latest non-blank within 3 h before it; else NaN (missing)
export function view(a, i, lag, carry = CARRY) {
  for (let c = 0; c <= carry; c++) { const j = i - lag - c; if (j >= 0 && j < a.length && !Number.isNaN(a[j])) return a[j]; }
  return NaN;
}
// hours carried forward at this tick (0 = the stamp itself was present); NaN when the quantity is missing
export function carryHours(a, i, lag, carry = CARRY) {
  for (let c = 0; c <= carry; c++) { const j = i - lag - c; if (j >= 0 && j < a.length && !Number.isNaN(a[j])) return c; }
  return NaN;
}
const nn = (v) => (Number.isNaN(v) ? null : v);

// PoR history: non-blank stamps s' in [t-72h, t-2h], timestamp s'+30min (never reads the future)
export function porHistoryAt(D, i, cfg = PRIMARY) {
  const h = [];
  for (let j = Math.max(0, i - 72); j <= i - cfg.histMaxLag; j++) if (!Number.isNaN(D.por[j])) h.push({ timestamp: D.epoch(j) + cfg.histOffsetMs, cfs: D.por[j] });
  return h;
}

// Model inputs at tick i. Returns null when PoR or LF is missing (no prediction).
export function inputsAt(D, i, cfg = PRIMARY) {
  const LAG = cfg.lag;
  const por = view(D.por, i, LAG.por), lfq = view(D.lf, i, LAG.lf);
  const o = { por: nn(por), lfq: nn(lfq) };
  const lfh = view(D.lfStage, i, LAG.lfStage), efh = view(D.ef, i, LAG.ef), temp = view(D.temp, i, LAG.temp);
  const mono = view(D.monocacy, i, LAG.monocacy), goose = view(D.goose, i, LAG.goose),
    br = view(D.broadRun, i, LAG.broadRun), sen = view(D.seneca, i, LAG.seneca);
  const d = {};
  d[GAUGES.por] = { q: nn(por) };
  d[GAUGES.lf] = { q: nn(lfq), h: nn(lfh) };
  d[GAUGES.monocacy] = Number.isNaN(mono) ? {} : { q: mono };
  d[GAUGES.goose] = Number.isNaN(goose) ? {} : { q: goose };
  d[GAUGES.broadRun] = Number.isNaN(br) ? {} : { q: br };
  d[GAUGES.seneca] = Number.isNaN(sen) ? {} : { q: sen };
  d[GAUGES.ef] = Number.isNaN(efh) ? {} : { h: efh };
  o.usgs = { data: d, gauges: GAUGES };
  o.temp = nn(temp);
  o.lf = d[GAUGES.lf]; o.ef = d[GAUGES.ef];
  return o;
}

// ---------- truth (plan section 4), arm-independent ----------
// First tick u >= i + h hours, then up to 2 more ticks (2.5 h rule, D-1 C2 / D-5 H6). The 1e-12 epsilon keeps a horizon that is an
// exact whole number of hours (e.g. 7.0) from being pushed to the next tick by floating-point noise; it never moves a real horizon.
export function lfViewAtTime(D, i, h, cfg = PRIMARY) {
  const u0 = i + Math.ceil(h - 1e-12);
  for (let off = 0; off <= 2; off++) {          // D-1 C2: up to 2.5 h counted from the first tick found
    const u = u0 + off;
    const v = view(D.lf, u, cfg.lag.lf);
    if (!Number.isNaN(v) && u - 1 < D.n) return { v, u };
  }
  return null;
}
export function truthAt(D, i, cfg = PRIMARY) {
  const t = D.epoch(i);
  if (Number.isNaN(view(D.por, i, cfg.lag.por)) || Number.isNaN(view(D.lf, i, cfg.lag.lf))) return { mask: false, why: 'no_input' };
  const rr = withSim(t, () => getPoRRiseRateFromHistory(porHistoryAt(D, i, cfg)));
  let tau = 6.5, conv = false;
  for (let k = 0; k < 3; k++) {
    const r = lfViewAtTime(D, i, tau, cfg);
    if (!r) return { mask: false, why: 'tau_lf_missing' };
    const nt = getGFtoLFTravelTime(getFlowMultiplier(r.v), rr);
    if (Math.abs(nt - tau) < 0.5) { tau = nt; conv = true; break; }
    tau = nt;
  }
  const tr = lfViewAtTime(D, i, tau, cfg);
  if (!tr) return { mask: false, why: 'no_truth', tauRef: tau, tauConverged: conv };
  return { mask: true, why: 'ok', tauRef: tau, tauConverged: conv, truth: tr.v, truthTick: tr.u };
}

// ---------- per-arm single-slot chain (plan section 4) ----------
export class ArmChain {
  constructor(arm, cfg = PRIMARY) {
    this.arm = arm; this.cfg = cfg; this.model = makeVariant(arm);
    this.bins = buildCorrectionBins([]); this.written = new Set();
    this.pending = null;               // {id, created_at, createdMs, data}
    this.n = { validated: 0, hard: 0, soft: 0, stale: 0, stored: 0, replaced: 0, skipped: 0, claims: 0, retries: 0 };
    this._id = 0;
  }
  hooks() {
    return {
      claim: (pred) => { this.n.claims++; this.pending = null; return { data: [{ id: pred.id }], error: null }; },
      binRead: (binKey) => {
        const [b, s] = binKey.split('_');
        // production selects the row's `data` column, so the destructured value is the row {data: bin}
        return { data: this.written.has(binKey) ? { data: this.bins[b][s] } : null, error: null };
      },
    };
  }
  // Runs the ported production gate for one claimable due pending and applies the bin write the production upsert would make.
  async _learn(p, t, delay, inp) {
    const res = await withSimAsync(t, () => runLearningGate({
      pred: { id: p.id, created_at: p.created_at, data: p.data }, lf: inp.lf, ef: inp.ef, waterTempC: inp.temp,
      now: new Date(t), delayMinutes: Math.round(delay / 60000), hooks: this.hooks(),
    }));
    this.n.validated++;
    if (res.isHardFlagged) this.n.hard++; else if (res.isSoftFlagged) this.n.soft++;
    if (!res.isHardFlagged && !res.binReadFailed) {          // harness equivalent of the bin upsert
      const [b, s2] = res.binKey.split('_');
      this.bins[b][s2] = res.binData; this.written.add(res.binKey);
    }
    return res;
  }
  // Step 1+2 of production order: validatePendingPredictions. Returns a small record (no errors vs truth).
  async validate(D, i, inp) {
    const out = { validated: false, cleaned: false, hard: false, soft: false };
    const lf = inp.lf;
    const lfBad = !lf?.q || lf.q < 500 || lf.q > 500000;
    const t = D.epoch(i);
    if (lfBad) {                                              // 'No LF data' / out of range -> row stays, retried next tick
      const q = this.pending; if (q) { const d = t - Date.parse(q.data.validationDue); if (d >= 0 && d <= VALIDATION_MAX_DELAY_MS) this.n.retries++; }
      return out;
    }
    const p = this.pending; if (!p) return out;
    const ageMs = t - p.createdMs;
    if (isNaN(ageMs) || ageMs > STALE_MS) { this.pending = null; this.n.stale++; out.cleaned = true; return out; }
    const dueMs = Date.parse(p.data.validationDue);
    const delay = t - dueMs;
    if (t >= dueMs && delay <= VALIDATION_MAX_DELAY_MS) {
      const res = await this._learn(p, t, delay, inp);
      out.validated = true; out.hard = res.isHardFlagged; out.soft = res.isSoftFlagged; out.gate = res;
    }
    return out;
  }
  // Steps 3+4: predict, store only if the slot is free (or replaceable).
  predict(D, i, inp) {
    if (inp.por == null || inp.lfq == null) return null;
    const t = D.epoch(i);
    const trace = {};
    const hist = porHistoryAt(D, i, this.cfg);
    const pred = withSim(t, () => this.model(inp.usgs, hist, inp.temp, this.bins, trace));
    return pred ? { pred, trace } : null;
  }
  store(D, i, pred) {
    const t = D.epoch(i);
    if (this.pending) {
      if (!isExistingPredictionReplaceable(this.pending.data, t)) { this.n.skipped++; return 'skipped_in_window'; }
      this.pending = null; this.n.replaced++;
    }
    this.pending = { id: ++this._id, created_at: new RealDate(t).toISOString(), createdMs: t, data: pred };
    this.n.stored++;
    return 'stored';
  }
  async tick(D, i, inp) {
    const v = await this.validate(D, i, inp);
    const r = this.predict(D, i, inp);
    const slot = r ? this.store(D, i, r.pred) : 'no_prediction';
    return { v, r, slot };
  }
  // D-5 H13: state AFTER the full tick (validate, predict, store). Bins never written equal empty bins (count 0); `written` lists the keys that were.
  snapshot() { return { bins: JSON.parse(JSON.stringify(this.bins)), written: [...this.written].sort(), pending: this.pending && JSON.parse(JSON.stringify(this.pending)) }; }
}

// ---------- events and window labels ----------
export function loadEvents(csvPath = path.join(HERE, 'rising_limb_events_python_v39.csv')) {
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  const hdr = lines[0].split(',');
  const rows = lines.slice(1).map(l => Object.fromEntries(l.split(',').map((v, k) => [hdr[k], v])));
  const ms = (s) => (s ? tsToMs(s) : null);
  const evs = [];
  for (const r of rows) if (r.event_row === '1') {
    const comps = rows.filter(x => x.event_id === r.event_id && x.event_row === '0').map(x => ({ t0: ms(x.onset_t0), tp: ms(x.onset_tp) }));
    const recSet = new Set();
    if (r.rec_start && r.rec_end) for (let x = ms(r.rec_start); x <= ms(r.rec_end); x += HOUR) recSet.add(x);
    for (const c of comps) for (let x = c.t0 - 12 * HOUR; x <= c.tp; x += HOUR) recSet.delete(x);
    evs.push({ id: +r.event_id, cls: r.event_class, kept: r.kept === '1', oct: r.oct === '1', holdout: r.holdout === '1',
      t0: ms(r.event_t0), tp: ms(r.event_tp), tend: ms(r.event_tend), rl: [ms(r.rl_start), ms(r.rl_end)],
      rlx: [ms(r.rl_start), ms(r.rlx_end)], ew: [ms(r.ew_start), ms(r.ew_end)], recSet, recN: +r.rec_n_stamps,
      scoredRl: +r.x3_scored_rl_ticks, rlTicks: +r.x3_rl_ticks });
  }
  return evs;
}
export function labelTick(evs, t) {
  const L = { rl: [], rlx: [], rec: [], ew: [] };
  for (const e of evs) {
    if (t >= e.ew[0] && t <= e.ew[1]) L.ew.push(e.id);
    if (!e.kept) continue;
    if (t >= e.rl[0] && t <= e.rl[1]) L.rl.push(e.id);
    if (t >= e.rlx[0] && t <= e.rlx[1]) L.rlx.push(e.id);
    if (e.recSet.has(t)) L.rec.push(e.id);
  }
  for (const k of ['rl', 'rlx', 'rec']) if (L[k].length > 1) throw new Error(`STOP (D-5 H9): tick ${new RealDate(t).toISOString()} has ${L[k].length} ${k} event ids: ${L[k]}`);
  return { rl_event: L.rl.join(''), rlx_event: L.rlx.join(''), rec_event: L.rec.join(''),
    ew_any: L.ew.length ? 1 : 0, normal: L.ew.length ? 0 : 1 };
}

// ---------- tick row schema (plan section 7: one row per tick per arm). Metric analysts' input; not written in this half. ----------
export const SCORING_START_MS = Date.UTC(2012, 11, 1, 0, 0, 0);   // D-5 H7 burn-in end
export const TICK_COLUMNS = ['tick_utc', 'arm', 'in_scoring', 'has_pred', 'raw', 'raw_unc', 'unc', 'disp', 'ceiling_applied', 'corr', 'flow_bin', 'flow_state',
  'rst', 'rate', 'stop', 'nonconverged', 'lookup_fail', 'it', 'travel_por_gf', 'travel_gf_lf', 'b_active', 'delta_on', 'pct',
  'lf_view', 'por_view', 'lf_carry_h', 'por_carry_h', 'base_rst', 'base_stop', 'base_flow_bin', 'base_flow_state', 'mask', 'mask_why', 'tau_ref', 'tau_converged',
  'truth', 'truth_tick_utc', 'truth_basehz', 'truth_basehz_tick', 'truth_own', 'truth_own_tick',
  'rl_event', 'rlx_event', 'rec_event', 'ew_any', 'normal', 'slot', 'validated', 'hard_flag', 'soft_flag'];
const iso = (D, u) => new RealDate(D.epoch(u)).toISOString();
export function tickRow({ D, i, arm, r, base, tr, labels, inp, tickOut, cfg = PRIMARY }) {
  const t = D.epoch(i), pred = r?.pred, tc = r?.trace;
  const hz = (h) => { if (h === undefined || h === null) return null; return lfViewAtTime(D, i, h, PRIMARY); };   // truth: primary view always (D-5 H12)
  const tb = hz(base?.pred.travelTimeGFtoLF), to = hz(pred?.travelTimeGFtoLF);
  const pc = carryHours(D.por, i, cfg.lag.por, cfg.carry), lc = carryHours(D.lf, i, cfg.lag.lf, cfg.carry);
  return {
    tick_utc: new RealDate(t).toISOString(), arm, in_scoring: +(t >= SCORING_START_MS), has_pred: pred ? 1 : 0,
    raw: pred?.rawFinalCFS ?? '', raw_unc: tc?.rawUnc ?? '', unc: tc?.unc ?? '', disp: pred?.predictedCFS ?? '',
    ceiling_applied: pred ? +pred.ceilingApplied : '', corr: tc?.corr ?? '', flow_bin: pred?.flowBin ?? '', flow_state: pred?.flowState ?? '',
    rst: tc?.rst ?? '', rate: tc?.rate ?? '', stop: tc?.stop ?? '', nonconverged: tc ? +(tc.stop === 'max_iter') : '',
    lookup_fail: tc ? +(tc.stop === 'no_hist' || tc.stop === 'hist_lost') : '', it: tc?.it ?? '',
    travel_por_gf: tc?.t ?? '', travel_gf_lf: pred?.travelTimeGFtoLF ?? '',
    b_active: tc ? +(tc.rst === 'rising' && tc.rate > 0) : '', delta_on: tc?.deltaOn === undefined ? '' : +tc.deltaOn, pct: tc?.pct ?? '',
    lf_view: inp.lfq ?? '', por_view: inp.por ?? '', lf_carry_h: Number.isNaN(lc) ? '' : lc, por_carry_h: Number.isNaN(pc) ? '' : pc,
    base_rst: base?.trace.rst ?? '', base_stop: base?.trace.stop ?? '', base_flow_bin: base?.pred.flowBin ?? '', base_flow_state: base?.pred.flowState ?? '',
    mask: tr.mask ? 1 : 0, mask_why: tr.why, tau_ref: tr.tauRef ?? '', tau_converged: tr.tauConverged === undefined ? '' : +tr.tauConverged,
    truth: tr.truth ?? '', truth_tick_utc: tr.truthTick === undefined ? '' : iso(D, tr.truthTick),
    truth_basehz: tb ? tb.v : '', truth_basehz_tick: tb ? iso(D, tb.u) : '', truth_own: to ? to.v : '', truth_own_tick: to ? iso(D, to.u) : '',
    ...labels, slot: tickOut?.slot ?? '', validated: tickOut ? +tickOut.v.validated : '', hard_flag: tickOut ? +tickOut.v.hard : '', soft_flag: tickOut ? +tickOut.v.soft : '',
  };
}

// ---------- deep equality, zero tolerance ----------
export function deepEq(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEq(a[k], b[k])) return false;
  return true;
}
export const TRAVEL_FIELDS = ['rate', 'rst', 't0', 't', 'it', 'stop', 'mult', 'nohist', 'gf2lf', 'histTs', 'histCfs', 'histAgo'];
export const traceKeysUpToRawUnc = (tr) => { const k = Object.keys(tr); return k.slice(0, k.indexOf('rawUnc') + 1); };
// compares ONLY rawFinalCFS and trace fields up to and including rawUnc (plan section 7 P1)
export function sameRawPrefix(a, b) {
  if (!a || !b) return a === b;
  if (!Object.is(a.pred.rawFinalCFS, b.pred.rawFinalCFS)) return false;
  const ka = traceKeysUpToRawUnc(a.trace), kb = traceKeysUpToRawUnc(b.trace);
  if (ka.length !== kb.length) return false;
  for (let q = 0; q < ka.length; q++) if (ka[q] !== kb[q] || !deepEq(a.trace[ka[q]], b.trace[kb[q]])) return false;
  return true;
}


// Report-only secondary run (plan section 4): a pending at EVERY tick. Same gate, same bins; each pending is claimed and learned when
// due (retry window as production), dropped when its window passes or it is older than 48 h. No slot, so store never skips.
export class MultiChain extends ArmChain {
  constructor(arm, cfg = PRIMARY) { super(arm, cfg); this.pendings = []; }
  hooks() {
    const h = super.hooks();
    h.claim = (pred) => { this.n.claims++; this.pendings = this.pendings.filter(q => q.id !== pred.id); return { data: [{ id: pred.id }], error: null }; };
    return h;
  }
  async validate(D, i, inp) {
    const out = { validated: false, cleaned: false, hard: false, soft: false };
    const lf = inp.lf, t = D.epoch(i);
    if (!lf?.q || lf.q < 500 || lf.q > 500000) return out;
    for (const p of [...this.pendings]) {
      if (t - p.createdMs > STALE_MS) { this.pendings = this.pendings.filter(q => q.id !== p.id); this.n.stale++; out.cleaned = true; continue; }
      const dueMs = Date.parse(p.data.validationDue), delay = t - dueMs;
      if (t >= dueMs && delay <= VALIDATION_MAX_DELAY_MS) {
        const res = await this._learn(p, t, delay, inp);
        out.validated = true; out.hard = out.hard || res.isHardFlagged; out.soft = out.soft || res.isSoftFlagged;
      } else if (t >= dueMs) this.pendings = this.pendings.filter(q => q.id !== p.id);   // missed window
    }
    return out;
  }
  store(D, i, pred) {
    const t = D.epoch(i);
    this.pendings.push({ id: ++this._id, created_at: new RealDate(t).toISOString(), createdMs: t, data: pred });
    this.n.stored++;
    return 'stored';
  }
  snapshot() { return { bins: JSON.parse(JSON.stringify(this.bins)), pendings: JSON.parse(JSON.stringify(this.pendings)) }; }
}

// One replay of all four arms over the grid. Calls onRow(row) for every tick x arm and onSnapshot(i, arm, snap) at the
// requested tick indices (state AFTER completing that tick). Computes no error of any arm against the truth.
export async function runReplay(D, { cfg = PRIMARY, multi = false, evs, onRow, snapshotAt = new Map(), onSnapshot = null, limit = null } = {}) {
  const Chain = multi ? MultiChain : ArmChain;
  const chains = Object.fromEntries(ARMS.map(a => [a, new Chain(a, cfg)]));
  const n = limit ?? D.n;
  for (let i = 0; i < n; i++) {
    const inp = inputsAt(D, i, cfg);
    const out = {};
    for (const a of ARMS) out[a] = await chains[a].tick(D, i, inp);
    // D-5 H12: the truth, tau_ref and the rise rate behind them ALWAYS use the PRIMARY view, whatever view the inputs use.
    // Mask = primary mask AND the view's own PoR and LF exist.
    let tr = truthAt(D, i, PRIMARY);
    if (tr.mask && (inp.por == null || inp.lfq == null)) tr = { ...tr, mask: false, why: 'view_input_missing' };
    const labels = labelTick(evs, D.epoch(i)), base = out.base.r;
    for (const a of ARMS) onRow(tickRow({ D, i, arm: a, r: out[a].r, base, tr, labels, inp, tickOut: out[a], cfg }));
    if (onSnapshot && snapshotAt.has(i)) for (const a of ARMS) onSnapshot(i, a, chains[a].snapshot());
  }
  return chains;
}

// ---------- precondition runner: baseline identity + cross-arm invariants (booleans and counts only) ----------
// Runs all four chains over the whole grid. Production comparison uses live bins of the base chain.
export async function runPreconditions(D, { arms = ARMS, log = () => {}, limit = null, onBase = null } = {}) {
  const chains = Object.fromEntries(arms.map(a => [a, new ArmChain(a)]));
  const inv = { identity: { checked: 0, exact: 0, firstFail: null },
    B_eq_base_not_rising: { checked: 0, fail: 0 }, A_eq_base_delta_off: { checked: 0, fail: 0 },
    C_eq_A_B_inactive: { checked: 0, fail: 0 }, C_eq_B_delta_off: { checked: 0, fail: 0 },
    A_travel_eq_base: { checked: 0, fail: 0 }, C_travel_eq_B: { checked: 0, fail: 0 }, C_porEst_delta_on: { checked: 0, fail: 0 }, firstInvFail: null };
  const n = limit ?? D.n;
  for (let i = 0; i < n; i++) {
    const t = D.epoch(i), inp = inputsAt(D, i);
    const out = {};
    for (const a of arms) out[a] = await chains[a].tick(D, i, inp);
    const base = out.base?.r;
    if (onBase) onBase(i, base, inp, out);
    if (base && arms.includes('base')) {
      // identity: production makeGFPrediction on identical inputs and the base chain's pre-tick bins
      // (bins at predict time are those after this tick's validation; chain.bins now equals that state)
      const pt = {}, histP = porHistoryAt(D, i).map(o => ({ ...o }));
      const pp = withSim(t, () => PROD.makeGFPrediction(inp.usgs, histP, inp.temp, chains.base.bins, pt));
      inv.identity.checked++;
      if (deepEq(pp, base.pred) && deepEq(pt, base.trace) && deepEq(Object.keys(pt), Object.keys(base.trace))) inv.identity.exact++;
      else if (!inv.identity.firstFail) inv.identity.firstFail = new RealDate(t).toISOString();
    }
    if (arms.length === 4) {
      const R = (a) => out[a].r;
      const bT = R('base')?.trace, rising = (tr) => tr.rst === 'rising' && tr.rate > 0;
      const deltaOff = (tr) => tr.nohist || tr.deltaOn === false;
      const chk = (name, x, y) => { inv[name].checked++; if (!sameRawPrefix(x, y)) { inv[name].fail++; if (!inv.firstInvFail) inv.firstInvFail = [name, new RealDate(t).toISOString()]; } };
      if (bT && R('B') && !rising(bT)) chk('B_eq_base_not_rising', R('B'), R('base'));
      if (bT && R('A') && deltaOff(bT)) chk('A_eq_base_delta_off', R('A'), R('base'));
      if (R('C') && R('A') && bT && !rising(bT)) chk('C_eq_A_B_inactive', R('C'), R('A'));
      if (R('C') && R('B') && R('B').trace && deltaOff(R('B').trace)) chk('C_eq_B_delta_off', R('C'), R('B'));
      // per-tick invariants on model internals (arms compared with each other, never with the truth)
      const travelSame = (x, y) => TRAVEL_FIELDS.every(k => deepEq(x.trace[k], y.trace[k])) && x.pred.travelTimeGFtoLF === y.pred.travelTimeGFtoLF && x.pred.validationDue === y.pred.validationDue;
      const chk2 = (name, ok) => { inv[name].checked++; if (!ok) { inv[name].fail++; if (!inv.firstInvFail) inv.firstInvFail = [name, new RealDate(t).toISOString()]; } };
      if (R('A') && R('base')) chk2('A_travel_eq_base', travelSame(R('A'), R('base')));
      if (R('C') && R('B')) chk2('C_travel_eq_B', travelSame(R('C'), R('B')));
      if (R('C') && R('B') && R('B').trace.deltaOn === true) {
        const c = R('C').trace, b = R('B').trace;
        chk2('C_porEst_delta_on', c.porEst === Math.round(b.histCfs * b.ratio) + c.monoFlow + c.gooseFlow + c.brFlow + c.senFlow);
      }
    }
  }
  return { inv, chains };
}

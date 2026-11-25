// Replay-lag harness (analysis only; NOT shipped). Built 2026-11-17 from analysis/ci_backtest_harness.mjs.
//
// Two code paths in one file:
//  (1) --arm=orig  : the ORIGINAL harness logic, unchanged (multi | single modes). With --gate=old it must
//      reproduce baseline/ci_residuals_v361_{multi,single}.csv byte for byte (regress.sh).
//  (2) --arm=F|L|F0|L0 --mode=hybrid : the lag replay of PLAN.md (rulings + pre-registration).
//
// Production code is IMPORTED read-only (makeGFPrediction via _test, updateCorrectionBin, classifyOutlier,
// isIcePlausible, ...). Nothing under netlify/ or src/ is touched.
//
// Usage:
//   node ci_backtest_harness_lag.mjs --arm=orig --gate=old --mode=multi|single [--in=PATH] [--out=PATH]
//   node ci_backtest_harness_lag.mjs --arm=F|L|F0|L0 --gate=new|old --mode=hybrid [--outdir=DIR]
//        [--switch=ISO --until=ISO]     (switch needs --arm=L: L inputs until the switch, F inputs from then on)
//
// BLINDNESS: this file computes per-row errors and writes them to the output files, but it never aggregates,
// prints or compares error values. Console output is counts only.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Real production model + shared helpers (imported, not reimplemented) ---
const { _test } = require('../../../netlify/functions/scheduled-update.js');
const { makeGFPrediction } = _test;
const {
    updateCorrectionBin, buildCorrectionBins,
    estimateLFFlowFromStage, EF_MODEL, VALIDATION_MAX_DELAY_MS,
    isIcePlausible, classifyOutlier,
    getGFCorrectionInterpolated, CEILING_RATIO,
} = require('../../../netlify/functions/shared/model.js');

// Production gauge IDs (scheduled-update.js:167-173)
const GAUGES = {
    por: '01638500', lf: '01646500', monocacy: '01643000', goose: '01644000',
    broadRun: '01644280', seneca: '01645000', ef: '01644148',
};

const HOUR_MS = 3600 * 1000;
const POR_HISTORY_WINDOW_MS = 72 * HOUR_MS;   // PoR lookback covers max travel time (~48h) + margin
const FILL_WINDOW_MS = 48 * HOUR_MS;          // production fetches P2D: a missing reading is replaced by the last one within 2 days
const CENTER_MS = 22.5 * 60 * 1000;           // an hourly median is placed at hour start + 22.5 min
const TAU_BEFORE_HOUR_MS = 11 * 60 * 1000;    // truth instant = first whole hour at/after due, minus 11 min
const PROD_LF_MIN = 500, PROD_LF_MAX = 500000; // validatePendingPredictions:1149 (validation skipped outside this)

// ---------------- args ----------------
export function parseArgs(argv) {
    const a = {
        arm: 'orig', gate: 'old', mode: 'multi',
        in: path.join(__dirname, '..', 'hourly_backtest_data_v361.csv'),
        out: null, outdir: __dirname, switch: null, until: null,
    };
    for (const tok of argv) {
        const m = tok.match(/^--([^=]+)=(.*)$/);
        if (m) a[m[1]] = m[2];
    }
    if (!['orig', 'F', 'L', 'F0', 'L0'].includes(a.arm)) throw new Error(`bad --arm=${a.arm}`);
    if (!['old', 'new'].includes(a.gate)) throw new Error(`bad --gate=${a.gate}`);
    if (!['multi', 'single', 'hybrid'].includes(a.mode)) throw new Error(`bad --mode=${a.mode}`);
    if (a.arm === 'orig' && a.mode === 'hybrid') throw new Error('--arm=orig supports --mode=multi|single only');
    if (a.arm !== 'orig' && a.mode !== 'hybrid') throw new Error('--arm=F|L|F0|L0 requires --mode=hybrid');
    if (a.switch && a.arm !== 'L') throw new Error('--switch requires --arm=L');
    a.switchMs = a.switch ? Date.parse(a.switch) : null;
    a.untilMs = a.until ? Date.parse(a.until) : null;
    if (a.switch && !Number.isFinite(a.switchMs)) throw new Error(`bad --switch=${a.switch}`);
    if (a.until && !Number.isFinite(a.untilMs)) throw new Error(`bad --until=${a.until}`);
    if (a.arm === 'orig' && !a.out) a.out = path.join(a.outdir, `ci_residuals_v361_${a.mode}.csv`);
    return a;
}

// ---------------- CSV load ----------------
function numOrNull(s) {
    if (s === undefined || s === '') return null;
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : null;
}
// CSV timestamps are UTC wall time ("YYYY-MM-DD HH:MM"); parse as UTC epoch ms.
function tsToEpoch(s) { return Date.parse(s.replace(' ', 'T') + ':00Z'); }

export function loadRows(csvPath) {
    const text = fs.readFileSync(csvPath, 'utf8').trim();
    const lines = text.split('\n');
    const header = lines[0].split(',');
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(',');
        rows.push({
            epoch: tsToEpoch(c[idx.timestamp]),
            ts: c[idx.timestamp],
            por: numOrNull(c[idx.por_now]),
            ef: numOrNull(c[idx.ef_stage]),
            lf: numOrNull(c[idx.lf_discharge]),
            lfStage: numOrNull(c[idx.lf_stage]),
            temp: numOrNull(c[idx.water_temp_c]),
            mono: numOrNull(c[idx.monocacy]),
            goose: numOrNull(c[idx.goose]),
            broad: numOrNull(c[idx.broad_run]),
            seneca: numOrNull(c[idx.seneca]),
        });
    }
    rows.sort((a, b) => a.epoch - b.epoch);
    return rows;
}

// ---------------- OLD anomaly gates (mirror validatePendingPredictions:947-1037, pre-v37.21 / pre-v39.0) ----------------
// Returns { isHardFlagged, isSoftFlagged, checks }. binData is the bin BEFORE this obs is added.
// (`checks` is an addition for the replay's per-check columns; the two flags are unchanged.)
export function scoreAnomalies({ errorCFS, errorPercentRaw, actualLF, actualStage, efStage, temp, binData }) {
    let hardScore = 0, softScore = 0;
    const checks = { c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 };

    // Check 1: EF cross-check → SOFT (>25%)
    let efEstimateNow = null;
    if (efStage && efStage >= EF_MODEL.minStage && efStage <= EF_MODEL.maxStage) {
        const useCold = temp !== null && temp !== undefined && temp <= EF_MODEL.coldMaxTemp;
        const coef = useCold ? EF_MODEL.coldCoef : EF_MODEL.coef;
        const exp = useCold ? EF_MODEL.coldExp : EF_MODEL.exp;
        efEstimateNow = coef * Math.pow(efStage, exp);
    }
    if (efEstimateNow && actualLF) {
        if ((efEstimateNow - actualLF) / actualLF > 0.25) { softScore += 2; checks.c1 = 1; }
    }

    // Check 2: stage-discharge inconsistency → HARD (>35%)
    if (actualStage && actualLF) {
        const expected = estimateLFFlowFromStage(actualStage);
        if (expected > 0 && (expected - actualLF) / actualLF > 0.35) { hardScore += 2; checks.c2 = 1; }
    }

    // Check 3: low flow + high stage → HARD (ice signature)
    if (actualLF < 1500 && actualStage > 2.45) { hardScore += 2; checks.c3 = 1; }

    // Check 4: large prediction error (RAW) → SOFT (+1)
    if (Math.abs(errorPercentRaw) > 50) { softScore += 1; checks.c4 = 1; }

    // Check 5: statistical outlier → HARD (z>3, needs >=10 prior obs)
    if (binData.count >= 10) {
        const variance = (binData.sumErrorSq / binData.count) - (binData.meanError * binData.meanError);
        const stdDev = Math.sqrt(Math.max(0, variance));
        if (stdDev > 0 && Math.abs((errorCFS - binData.meanError) / stdDev) > 3) { hardScore += 2; checks.c5 = 1; }
    }

    const isHardFlagged = hardScore >= 2;
    const isSoftFlagged = !isHardFlagged && softScore >= 2;
    return { isHardFlagged, isSoftFlagged, checks };
}

// ---------------- NEW anomaly gate: CURRENT production (validatePendingPredictions:1277-1408, v39.0) ----------------
// Same five checks as production, using the shared helpers isIcePlausible and classifyOutlier.
//  Check 1 EF cross-check (soft +2)       Check 2 stage-discharge (HARD)
//  Check 3 low flow + high stage + ice plausible (HARD)       Check 4 raw error > 50% (soft +1)
//  Check 5 z > 3 outlier via classifyOutlier (SOFT +2, never hard since v39.0)
// hard = Checks 2 and 3 (truth-dependent); soft = !hard && softScore >= 2.
// nowMs is the production `now` (used by isIcePlausible's month proxy only).
export function anomaliesNew({ errorCFS, errorPercentRaw, actualLF, actualStage, efStage, temp, binData, nowMs }) {
    let hardScore = 0, softScore = 0;
    const checks = { c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 };

    const currentEfStage = efStage;
    let efEstimateNow = null;
    if (currentEfStage && currentEfStage >= EF_MODEL.minStage && currentEfStage <= EF_MODEL.maxStage) {
        const useColdEF = temp !== null && temp !== undefined && temp <= EF_MODEL.coldMaxTemp;
        const efCoef = useColdEF ? EF_MODEL.coldCoef : EF_MODEL.coef;
        const efExp = useColdEF ? EF_MODEL.coldExp : EF_MODEL.exp;
        efEstimateNow = efCoef * Math.pow(currentEfStage, efExp);
    }
    if (efEstimateNow && actualLF) {
        const efDiscrepancy = (efEstimateNow - actualLF) / actualLF;
        if (efDiscrepancy > 0.25) { softScore += 2; checks.c1 = 1; }
    }

    if (actualStage && actualLF) {
        const expectedFlowFromStage = estimateLFFlowFromStage(actualStage);
        if (expectedFlowFromStage > 0) {
            const stageDiscrepancy = (expectedFlowFromStage - actualLF) / actualLF;
            if (stageDiscrepancy > 0.35) { hardScore += 2; checks.c2 = 1; }
        }
    }

    const ice = isIcePlausible(temp, nowMs);
    if (actualLF < 1500 && actualStage > 2.45 && ice.plausible) { hardScore += 2; checks.c3 = 1; }

    if (Math.abs(errorPercentRaw) > 50) { softScore += 1; checks.c4 = 1; }

    const { zScore, isOutlier } = classifyOutlier(binData, errorCFS);
    if (isOutlier) { softScore += 2; checks.c5 = 1; }

    const isHardFlagged = hardScore >= 2;
    const isSoftFlagged = !isHardFlagged && softScore >= 2;
    return { isHardFlagged, isSoftFlagged, checks, zScore, iceBasis: ice.basis };
}

// ---------------- one model call with Date.now monkeypatched to sim-time ----------------
const NOOP = () => {};
export function predictAtSimTime(simNowMs, usgsData, porHistory, temp, correctionBins, trace = null) {
    const realNow = Date.now;
    const realLog = console.log;
    Date.now = () => simNowMs;
    console.log = NOOP;                  // silence the model's per-call chatter
    try {
        return makeGFPrediction(usgsData, porHistory, temp, correctionBins, trace);
    } finally {
        Date.now = realNow;
        console.log = realLog;
    }
}

function buildUsgsData(row) {
    // data[siteId] = { q, h }. Null tributary/EF -> empty object -> model fallback path.
    const d = {};
    d[GAUGES.por] = { q: row.por };
    d[GAUGES.lf] = { q: row.lf, h: row.lfStage };
    d[GAUGES.monocacy] = row.mono !== null ? { q: row.mono } : {};
    d[GAUGES.goose] = row.goose !== null ? { q: row.goose } : {};
    d[GAUGES.broadRun] = row.broad !== null ? { q: row.broad } : {};
    d[GAUGES.seneca] = row.seneca !== null ? { q: row.seneca } : {};
    d[GAUGES.ef] = row.ef !== null ? { h: row.ef } : {};
    return { data: d, gauges: GAUGES };
}

// =====================================================================================================
// (1) ORIGINAL replay (multi | single), logic unchanged from analysis/ci_backtest_harness.mjs
// =====================================================================================================
function runOrig(args) {
    console.log(`[harness] mode=${args.mode}  in=${path.basename(args.in)}  out=${path.basename(args.out)}`);
    const rows = loadRows(args.in);
    const byEpoch = new Map(rows.map(r => [r.epoch, r]));
    console.log(`[harness] loaded ${rows.length} hourly rows: ${rows[0].ts} .. ${rows[rows.length - 1].ts}`);

    // gate=old: the original local copy; gate=new: production's current gate (not regression-tested, see README)
    const gate = args.gate === 'new'
        ? (x, simNowMs) => anomaliesNew({ ...x, nowMs: simNowMs })
        : (x) => scoreAnomalies(x);

    const correctionBins = buildCorrectionBins([]);   // empty 18-cell seed (matches cron load path)
    const porHist = [];                                // rolling [{timestamp, cfs}] ascending
    const pending = [];
    const residuals = [];
    const stats = { predictions: 0, validated: 0, hardSkipped: 0, softClamped: 0, missedWindow: 0, noLF: 0 };

    for (const row of rows) {
        const simNowMs = row.epoch;

        // (1) VALIDATE due pendings first (cron order). Multi-pending fires each at its horizon.
        for (let k = pending.length - 1; k >= 0; k--) {
            const p = pending[k];
            if (p.dueMs > simNowMs) continue;            // not yet due
            pending.splice(k, 1);                          // claim (remove) regardless of outcome
            if (simNowMs - p.dueMs > VALIDATION_MAX_DELAY_MS) { stats.missedWindow++; continue; }
            const vrow = byEpoch.get(simNowMs);            // validate against CURRENT-hour actuals (C-F4)
            if (!vrow || vrow.lf === null || vrow.lf <= 0) { stats.noLF++; continue; }

            const actualLF = vrow.lf;
            const actualStage = vrow.lfStage;
            const errorCFS = p.rawFinalCFS - actualLF;     // learn-on-raw residual
            const errorPercentRaw = (errorCFS / actualLF) * 100;
            const binData = correctionBins[p.flowBin][p.flowState];

            const { isHardFlagged, isSoftFlagged } = gate({
                errorCFS, errorPercentRaw, actualLF, actualStage,
                efStage: vrow.ef, temp: vrow.temp, binData,
            }, simNowMs);
            if (isHardFlagged) { stats.hardSkipped++; continue; }   // corrupted truth: skip learn + residual

            const upd = updateCorrectionBin(binData, errorCFS, isSoftFlagged);
            if (upd.clamped) stats.softClamped++;
            stats.validated++;
            residuals.push({
                predTs: new Date(p.predEpoch).toISOString(),
                valTs: vrow.ts,
                rawFinalCFS: p.rawFinalCFS,
                predictedCFS: p.predictedCFS,         // corrected, post-ceiling (displayed)
                correction: p.correction,
                flowBin: p.flowBin,
                flowState: p.flowState,
                actualLF,
                residual: p.predictedCFS - actualLF,  // CORRECTED residual r = est - actual
                rawResidual: errorCFS,                // raw residual (for cross-checks)
                ceilingApplied: p.ceilingApplied ? 1 : 0,
                isSoftFlagged: isSoftFlagged ? 1 : 0,
                binCountAtPred: p.binCountAtPred,
            });
        }

        // (2) Maintain rolling porHistory from PoR readings (timestamp = real epoch).
        if (row.por !== null && row.por > 0) {
            porHist.push({ timestamp: simNowMs, cfs: row.por });
            while (porHist.length && porHist[0].timestamp < simNowMs - POR_HISTORY_WINDOW_MS) porHist.shift();
        }

        // (3) Make a new prediction when the model can (needs PoR + LF). Single-pending: only if slot free.
        if (row.por === null || row.por <= 0 || row.lf === null || row.lf <= 0) continue;
        if (args.mode === 'single' && pending.length > 0) continue;   // slot occupied (throughput bottleneck)

        const usgsData = buildUsgsData(row);
        const pred = predictAtSimTime(simNowMs, usgsData, porHist, row.temp, correctionBins);
        if (!pred) continue;
        stats.predictions++;
        pending.push({
            dueMs: simNowMs + pred.travelTimeGFtoLF * HOUR_MS,   // computed from horizon, NOT the shifted ISO string
            predEpoch: simNowMs,
            rawFinalCFS: pred.rawFinalCFS,
            predictedCFS: pred.predictedCFS,
            correction: pred.correctionApplied,
            flowBin: pred.flowBin,
            flowState: pred.flowState,
            ceilingApplied: pred.ceilingApplied,
            binCountAtPred: correctionBins[pred.flowBin][pred.flowState].count,
        });
    }

    // ---------------- write residual log ----------------
    const cols = ['predTs', 'valTs', 'rawFinalCFS', 'predictedCFS', 'correction', 'flowBin',
        'flowState', 'actualLF', 'residual', 'rawResidual', 'ceilingApplied', 'isSoftFlagged', 'binCountAtPred'];
    const out = [cols.join(',')];
    for (const r of residuals) out.push(cols.map(c => r[c]).join(','));
    fs.writeFileSync(args.out, out.join('\n') + '\n');

    console.log(`[harness] DONE mode=${args.mode}`);
    console.log(`  predictions made : ${stats.predictions}`);
    console.log(`  validated (kept) : ${stats.validated}`);
    console.log(`  hard-skipped     : ${stats.hardSkipped}`);
    console.log(`  soft-clamped     : ${stats.softClamped}`);
    console.log(`  missed 2.5h window: ${stats.missedWindow}`);
    console.log(`  no-LF at horizon : ${stats.noLF}`);
    console.log(`  residuals written: ${residuals.length} -> ${path.basename(args.out)}`);

    console.log('  final bin counts (count | emaMeanError):');
    for (const bin of Object.keys(correctionBins)) {
        const parts = ['rising', 'steady', 'falling'].map(s => {
            const b = correctionBins[bin][s];
            return `${s}=${b.count}/${b.emaMeanError !== undefined ? Math.round(b.emaMeanError) : '-'}`;
        });
        console.log(`    ${bin.padEnd(12)} ${parts.join('  ')}`);
    }
}

// =====================================================================================================
// (2) HYBRID lag replay
// =====================================================================================================

// Input lag (hours before the simulated hour t) per arm and channel. Lags are by TIMESTAMP.
//  F : every input from row t-1.            L : PoR flow (+stage, +water temperature), Edwards Ferry stage,
//  F0: every input from row t.                  Goose flow from row t-2; everything else (LF, Monocacy, Seneca,
//  L0: the three lagged gauges from t-1,        Broad Run) from t-1.
//      the rest from t.
const ALL = ['por', 'temp', 'ef', 'goose', 'lf', 'lfStage', 'mono', 'seneca', 'broad'];
const THREE = ['por', 'temp', 'ef', 'goose'];   // PoR (with its temperature), Edwards Ferry, Goose
function lagTable(laggedH, restH) {
    const o = {};
    for (const c of ALL) o[c] = THREE.includes(c) ? laggedH : restH;
    return o;
}
export const LAGS = {
    F: lagTable(1, 1),
    L: lagTable(2, 1),
    F0: lagTable(0, 0),
    L0: lagTable(1, 0),
};

// Per-channel series of non-null values, ascending by epoch.
export function buildSeries(rows) {
    const chans = {
        por: r => (r.por !== null && r.por > 0 ? r.por : null),
        temp: r => r.temp,
        ef: r => r.ef,
        goose: r => r.goose,
        lf: r => (r.lf !== null && r.lf > 0 ? r.lf : null),
        lfStage: r => r.lfStage,
        mono: r => r.mono,
        seneca: r => r.seneca,
        broad: r => r.broad,
    };
    const S = { rows, first: rows[0].epoch, last: rows[rows.length - 1].epoch };
    for (const [name, get] of Object.entries(chans)) {
        const ep = [], val = [];
        const map = new Map();
        for (const r of rows) {
            const v = get(r);
            if (v !== null) { ep.push(r.epoch); val.push(v); map.set(r.epoch, v); }
        }
        S[name] = { ep, val, map };
    }
    S.porObjs = S.por.ep.map((e, i) => ({ timestamp: e, cfs: S.por.val[i] }));
    return S;
}

// largest index with ep[i] <= x, or -1
function bsearchLE(ep, x) {
    let lo = 0, hi = ep.length - 1, ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (ep[mid] <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
}
// smallest index with ep[i] >= x, or ep.length
function bsearchGE(ep, x) {
    let lo = 0, hi = ep.length - 1, ans = ep.length;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (ep[mid] >= x) { ans = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return ans;
}

// Value of channel `ch` at the lagged timestamp (t - lagH hours), or, if missing there, the last available
// value at or before it, provided it lies within production's 2-day window of the sim clock t.
// Returns { v, ep, age, idx } (age in hours relative to t) or null.
export function pickAt(S, ch, lagH, t) {
    const lagEpoch = t - lagH * HOUR_MS;
    const ser = S[ch];
    const i = bsearchLE(ser.ep, lagEpoch);
    if (i < 0) return null;
    if (ser.ep[i] < t - FILL_WINDOW_MS) return null;
    return { v: ser.val[i], ep: ser.ep[i], age: (t - ser.ep[i]) / HOUR_MS, idx: i };
}

// All inputs the arm sees at sim hour t.
export function inputsAt(S, arm, t) {
    const lag = LAGS[arm];
    const inp = {};
    for (const c of ALL) inp[c] = pickAt(S, c, lag[c], t);
    return inp;
}

export function assertHistory(porInp, hist) {
    if (!porInp || !hist.length) throw new Error('history assertion: empty history with a PoR input');
    const last = hist[hist.length - 1];
    if (last.cfs !== porInp.v || last.timestamp !== porInp.ep) {
        throw new Error(`history assertion FAILED: por.q=${porInp.v}@${porInp.ep} but last history entry=${last.cfs}@${last.timestamp}`);
    }
}

// Rolling PoR history given to the model: entries from t-72h up to the arm's newest PoR row (inclusive).
export function historyFor(S, porInp, t) {
    const lo = bsearchGE(S.por.ep, t - POR_HISTORY_WINDOW_MS);
    return S.porObjs.slice(lo, porInp.idx + 1);
}

function usgsFromInputs(inp) {
    const d = {};
    d[GAUGES.por] = { q: inp.por ? inp.por.v : null };
    d[GAUGES.lf] = { q: inp.lf ? inp.lf.v : null, h: inp.lfStage ? inp.lfStage.v : null };
    d[GAUGES.monocacy] = inp.mono ? { q: inp.mono.v } : {};
    d[GAUGES.goose] = inp.goose ? { q: inp.goose.v } : {};
    d[GAUGES.broadRun] = inp.broad ? { q: inp.broad.v } : {};
    d[GAUGES.seneca] = inp.seneca ? { q: inp.seneca.v } : {};
    d[GAUGES.ef] = inp.ef ? { h: inp.ef.v } : {};
    return { data: d, gauges: GAUGES };
}

// ---- truth: linear interpolation between hourly medians placed at hour start + 22.5 min ----
// Returns { v, kind } or null. kind: 'interp' | 'lo' | 'hi'.
export function interpAt(map, tau) {
    const lo0 = Math.floor((tau - CENTER_MS) / HOUR_MS) * HOUR_MS;   // row whose centre is at/before tau
    const lo = map.get(lo0), hi = map.get(lo0 + HOUR_MS);
    const cLo = lo0 + CENTER_MS, cHi = lo0 + HOUR_MS + CENTER_MS;
    if (lo !== undefined && hi !== undefined) return { v: lo + (hi - lo) * ((tau - cLo) / HOUR_MS), kind: 'interp' };
    if (lo !== undefined && tau - cLo <= HOUR_MS) return { v: lo, kind: 'lo' };
    if (hi !== undefined && cHi - tau <= HOUR_MS) return { v: hi, kind: 'hi' };
    return null;
}
export function ceilHour(ms) { return Math.ceil(ms / HOUR_MS) * HOUR_MS; }
export function tauFor(T) { return T - TAU_BEFORE_HOUR_MS; }

// ---- csv helpers ----
const iso = ms => (ms === null || ms === undefined || !Number.isFinite(ms)) ? '' : new Date(ms).toISOString();
function cell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    return String(v).replace(/[,\n\r]/g, ' ');
}
function writeCsv(file, cols, rows) {
    const out = [cols.join(',')];
    for (const r of rows) out.push(cols.map(c => cell(r[c])).join(','));
    fs.writeFileSync(file, out.join('\n') + '\n');
}

export const SHADOW_COLS = [
    'predTs', 'arm', 'inputArm', 'status', 'statusDetail',
    'rawFinalCFS', 'predictedCFS', 'correctionApplied', 'flowBin', 'flowState',
    'porQ', 'porSrcTs', 'historicPorCFS', 'histSrcTs', 'travelPoRtoGF', 'travelGFtoLF',
    'pct', 'deltaOn', 'appliedRatio', 'decay', 'riseRatePerHr', 'efWeight', 'ceilingApplied',
    'porEstimateCFS', 'efEstimateCFS', 'useTimeShifted', 'histLen', 'histLastTs',
    'efStage', 'efSrcTs', 'gooseQ', 'gooseSrcTs', 'tempC', 'tempSrcTs',
    'lfQ', 'lfSrcTs', 'lfStageIn', 'lfStageSrcTs', 'monoQ', 'monoSrcTs', 'senecaQ', 'senecaSrcTs', 'broadQ', 'broadSrcTs',
    'age_por_h', 'age_ef_h', 'age_goose_h', 'age_lf_h', 'age_temp_h', 'age_mono_h', 'age_seneca_h', 'age_broad_h',
    'dueTs', 'valHourTs', 'tauTs', 'truthFlow', 'truthStage', 'truthInProdRange',
    'errPctRaw', 'errPctCorr',
    'valEfStage', 'valEfAge_h', 'valTempC', 'valTempAge_h',
    'chk1_ef', 'chk2_stage', 'chk3_lowflow_ice', 'chk4_largeerr', 'chk5_outlier', 'outlierZ',
    'hardFlag', 'softFlag', 'truthDependentHard',
    // onset-study additions (appended; blank when not available)
    'rawUnc', 'corrUsed', 'corrR', 'corrS', 'corrF',
    'd6', 'thr6', 'p6Ts', 'p6Cfs', 'span_h', 'histShort',
    'lfCap', 'ageR_h', 'ageS_h',
];
export const LEARN_COLS = [
    'predTs', 'valHourTs', 'dueTs', 'tauTs', 'arm', 'inputArm', 'cell', 'outcome', 'learned', 'clamped', 'softFlagged',
    'rawResidualCFS', 'learningErrorCFS', 'emaBefore', 'countBefore', 'emaAfter', 'countAfter',
    'chk1_ef', 'chk2_stage', 'chk3_lowflow_ice', 'chk4_largeerr', 'chk5_outlier', 'truthDependentHard',
];
export const BIN_COLS = ['ts', 'arm', 'cell', 'emaMeanError', 'count', 'clamped'];

// Core of the hybrid replay. Pure with respect to the filesystem (returns arrays); `predictFn` is injectable for tests.
export function runHybrid(rows, opts) {
    const { arm: baseArm, gate = 'new', switchMs = null, untilMs = null, predictFn = predictAtSimTime, armLabel = null } = opts;
    const S = buildSeries(rows);
    const armAt = t => (switchMs !== null && t >= switchMs) ? 'F' : baseArm;
    const label = armLabel || baseArm;
    const bins = buildCorrectionBins([]);
    const endPred = untilMs === null ? S.last : Math.min(S.last, untilMs);
    const drainEnd = endPred + 72 * HOUR_MS;

    const shadowRows = [], learnRows = [], binRows = [];
    const lastLearn = new Map();    // onset study: `${bin}_${state}` -> sim time (ms) of the last updateCorrectionBin call
    const onsetChecked = { rows: 0, a_state: 0, a_lookup: 0, b: 0, c: 0 };
    const shadowQ = new Map();      // T -> [shadow row records awaiting validation]
    let slot = null;                // learning track: one pending prediction
    const cnt = {
        rowsRead: rows.length, gridHours: 0, predictAttempts: 0,
        status: { predicted: 0, no_por: 0, no_lf: 0, no_truth: 0, other: 0 },
        shadowValidated: 0, shadowOutOfProdRange: 0,
        shadowHard: 0, shadowSoft: 0, shadowTruthDependentHard: 0,
        shadowChecks: { c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 },
        learnSlotsStored: 0, learnValidations: 0, learnLearned: 0, learnHardSkipped: 0, learnSoftLearned: 0,
        learnClamped: 0, learnRetries: 0, learnDroppedMissedWindow: 0, learnSlotBlockedHours: 0,
    };

    function validateAt(p, T) {
        const tau = tauFor(T);
        const tf = interpAt(S.lf.map, tau);
        const ts = interpAt(S.lfStage.map, tau);
        if (!tf) return { ok: false };
        const actual = tf.v;
        const aArm = armAt(T);
        const lag = LAGS[aArm];
        const ef = pickAt(S, 'ef', lag.ef, T);
        const tp = pickAt(S, 'temp', lag.temp, T);
        const errorCFS = p.raw - actual;
        const errorPercentRaw = (errorCFS / actual) * 100;
        const binData = bins[p.flowBin][p.flowState];
        const x = {
            errorCFS, errorPercentRaw, actualLF: actual, actualStage: ts ? ts.v : null,
            efStage: ef ? ef.v : null, temp: tp ? tp.v : null, binData,
        };
        let g;
        if (gate === 'new') {
            g = anomaliesNew({ ...x, nowMs: T });
        } else {
            g = scoreAnomalies(x);
            // old gate has no z column; recompute z for information only (does not drive any decision)
            g.zScore = classifyOutlier(binData, errorCFS).zScore;
        }
        const truthDependentHard = (g.checks.c2 || g.checks.c3) ? 1 : 0;
        return {
            ok: true, tau, actual, stage: ts ? ts.v : null, inProdRange: actual >= PROD_LF_MIN && actual <= PROD_LF_MAX,
            errorCFS, errPctRaw: errorPercentRaw, errPctCorr: ((p.corr - actual) / actual) * 100,
            efStage: x.efStage, efAge: ef ? ef.age : null, temp: x.temp, tempAge: tp ? tp.age : null,
            g, truthDependentHard, binData,
        };
    }

    function makeRecord(t, a) {
        const inp = inputsAt(S, a, t);
        const r = { predTs: iso(t), arm: label, inputArm: a, status: '', statusDetail: '' };
        r.porSrcTs = iso(inp.por && inp.por.ep);
        const fill = (key, ch, ageKey, srcKey) => {
            r[key] = inp[ch] ? inp[ch].v : null;
            r[srcKey] = inp[ch] ? iso(inp[ch].ep) : '';
            r[ageKey] = inp[ch] ? inp[ch].age : null;
        };
        fill('porQ', 'por', 'age_por_h', 'porSrcTs');
        fill('efStage', 'ef', 'age_ef_h', 'efSrcTs');
        fill('gooseQ', 'goose', 'age_goose_h', 'gooseSrcTs');
        fill('tempC', 'temp', 'age_temp_h', 'tempSrcTs');
        fill('lfQ', 'lf', 'age_lf_h', 'lfSrcTs');
        fill('lfStageIn', 'lfStage', 'age_lfstage_h', 'lfStageSrcTs');
        fill('monoQ', 'mono', 'age_mono_h', 'monoSrcTs');
        fill('senecaQ', 'seneca', 'age_seneca_h', 'senecaSrcTs');
        fill('broadQ', 'broad', 'age_broad_h', 'broadSrcTs');
        if (!inp.por) { r.status = 'no_por'; return { r, pred: null }; }
        if (!inp.lf) { r.status = 'no_lf'; return { r, pred: null }; }

        const hist = historyFor(S, inp.por, t);
        assertHistory(inp.por, hist);                      // newest PoR value passed == last history entry (every step)
        r.histLen = hist.length;
        r.histLastTs = iso(hist[hist.length - 1].timestamp);
        const trace = {};
        const pred = predictFn(t, usgsFromInputs(inp), hist, inp.temp ? inp.temp.v : null, bins, trace);
        if (!pred) { r.status = 'other'; r.statusDetail = 'model_returned_null'; return { r, pred: null }; }
        r.status = 'predicted';
        r.rawFinalCFS = pred.rawFinalCFS; r.predictedCFS = pred.predictedCFS; r.correctionApplied = pred.correctionApplied;
        r.flowBin = pred.flowBin; r.flowState = pred.flowState;
        r.historicPorCFS = pred.historicPorCFS; r.histSrcTs = iso(trace.histTs);
        r.travelPoRtoGF = trace.t; r.travelGFtoLF = pred.travelTimeGFtoLF;
        r.pct = trace.pct; r.deltaOn = trace.deltaOn; r.appliedRatio = trace.ratio; r.decay = trace.decay;
        r.riseRatePerHr = trace.rate; r.efWeight = pred.efWeight; r.ceilingApplied = pred.ceilingApplied;
        r.porEstimateCFS = pred.porEstimateCFS; r.efEstimateCFS = pred.efEstimateCFS; r.useTimeShifted = pred.useTimeShifted;
        const dueMs = t + pred.travelTimeGFtoLF * HOUR_MS;
        r.dueTs = iso(dueMs);
        onsetColumns(r, t, inp, hist, trace, pred);
        return {
            r,
            pred: {
                predEpoch: t, dueMs, raw: pred.rawFinalCFS, corr: pred.predictedCFS,
                flowBin: pred.flowBin, flowState: pred.flowState, inputArm: a,
            },
        };
    }

    // ---- onset study: added columns + row checks (a), (b), (c). Reads only; changes nothing the model or learning sees. ----
    function onsetFail(r, what, got, want) {
        throw new Error(`ONSET CHECK FAILED ${what} at predTs=${r.predTs}: got ${got}, expected ${want}`);
    }
    function onsetColumns(r, t, inp, hist, trace, pred) {
        r.rawUnc = trace.rawUnc;
        r.corrUsed = trace.corr;
        r.corrR = getGFCorrectionInterpolated(bins, trace.rawUnc, 'rising');
        r.corrS = getGFCorrectionInterpolated(bins, trace.rawUnc, 'steady');
        r.corrF = getGFCorrectionInterpolated(bins, trace.rawUnc, 'falling');
        r.lfCap = inp.lf.v;

        // State rule inputs, same history array, same current flow, same clock as getFlowState (model.js:466-493)
        const cur = inp.por.v;
        const sixHoursAgo = t - 6 * HOUR_MS;
        let past = null;
        if (hist.length >= 8) {
            for (const e of hist) { if (e.timestamp <= sixHoursAgo) past = e; }
        }
        r.histShort = past ? 0 : 1;
        r.thr6 = Math.max(100, cur * 0.02);
        let rebuilt = 'steady';
        if (past) {
            r.d6 = cur - past.cfs;
            r.p6Ts = iso(past.timestamp);
            r.p6Cfs = past.cfs;
            r.span_h = (hist[hist.length - 1].timestamp - past.timestamp) / HOUR_MS;
            if (Math.abs(r.d6) >= r.thr6) rebuilt = r.d6 > 0 ? 'rising' : 'falling';
        }
        // (a) state
        if (rebuilt !== pred.flowState) onsetFail(r, '(a) state rebuilt from d6/thr6', rebuilt, `model flowState ${pred.flowState}`);
        onsetChecked.a_state++;
        // (a) second lookup, written differently: greatest timestamp <= t-6h by binary search over the whole PoR series
        //     (not the hist array); only valid inside the hist window and when the rule had enough history.
        let alt = null;
        if (hist.length >= 8) {
            const i = bsearchLE(S.por.ep, sixHoursAgo);
            if (i >= 0 && S.por.ep[i] >= hist[0].timestamp) alt = { ts: S.por.ep[i], cfs: S.por.val[i] };
        }
        if (!past !== !alt) onsetFail(r, '(a) past-reading existence (hist scan vs series search)', past ? 'found' : 'none', alt ? 'found' : 'none');
        if (past && (alt.ts !== past.timestamp || alt.cfs !== past.cfs)) {
            onsetFail(r, '(a) past reading', `${iso(past.timestamp)}@${past.cfs}`, `${iso(alt.ts)}@${alt.cfs}`);
        }
        onsetChecked.a_lookup++;
        // (b)
        const byState = { rising: r.corrR, steady: r.corrS, falling: r.corrF };
        if (!(pred.flowState in byState)) onsetFail(r, '(b) unknown flowState', pred.flowState, 'rising|steady|falling');
        if (byState[pred.flowState] !== r.corrUsed) onsetFail(r, `(b) corr of state ${pred.flowState}`, byState[pred.flowState], `corrUsed ${r.corrUsed}`);
        onsetChecked.b++;
        // (c)
        const base = r.rawUnc - r.corrUsed;
        const shown = Math.floor((r.lfCap > 0 ? Math.min(base, CEILING_RATIO * r.lfCap) : base) + 0.5);
        if (shown !== pred.predictedCFS) onsetFail(r, '(c) shown value', shown, `predictedCFS ${pred.predictedCFS}`);
        onsetChecked.c++;
        onsetChecked.rows++;
        // cell ages (hours since the rising / steady cell of this hour's flowBin last learned; blank if never)
        const lr = lastLearn.get(`${pred.flowBin}_rising`), ls = lastLearn.get(`${pred.flowBin}_steady`);
        r.ageR_h = lr === undefined ? null : (t - lr) / HOUR_MS;
        r.ageS_h = ls === undefined ? null : (t - ls) / HOUR_MS;
    }

    function fillShadow(rec, v, T) {
        const { r } = rec;
        r.valHourTs = iso(T);
        if (!v.ok) {
            r.status = 'no_truth'; r.tauTs = iso(tauFor(T));
            return;
        }
        r.tauTs = iso(v.tau); r.truthFlow = v.actual; r.truthStage = v.stage; r.truthInProdRange = v.inProdRange;
        r.errPctRaw = v.errPctRaw; r.errPctCorr = v.errPctCorr;
        r.valEfStage = v.efStage; r.valEfAge_h = v.efAge; r.valTempC = v.temp; r.valTempAge_h = v.tempAge;
        r.chk1_ef = v.g.checks.c1; r.chk2_stage = v.g.checks.c2; r.chk3_lowflow_ice = v.g.checks.c3;
        r.chk4_largeerr = v.g.checks.c4; r.chk5_outlier = v.g.checks.c5; r.outlierZ = v.g.zScore;
        r.hardFlag = v.g.isHardFlagged ? 1 : 0; r.softFlag = v.g.isSoftFlagged ? 1 : 0;
        r.truthDependentHard = v.truthDependentHard;
        cnt.shadowValidated++;
        if (!v.inProdRange) cnt.shadowOutOfProdRange++;
        if (v.g.isHardFlagged) cnt.shadowHard++;
        if (v.g.isSoftFlagged) cnt.shadowSoft++;
        if (v.truthDependentHard) cnt.shadowTruthDependentHard++;
        for (const k of Object.keys(cnt.shadowChecks)) cnt.shadowChecks[k] += v.g.checks[k];
    }

    for (let T = S.first; T <= drainEnd; T += HOUR_MS) {
        cnt.gridHours++;

        // (a) SHADOW validations due at this hour: bins as they stand BEFORE this hour's learning step.
        const due = shadowQ.get(T);
        if (due) {
            for (const rec of due) {
                const v = validateAt(rec.pred, T);
                fillShadow(rec, v, T);
            }
            shadowQ.delete(T);
        }

        // (b) LEARNING track: validate the single pending prediction when due (production's single slot).
        if (slot && T >= slot.dueMs) {
            if (T - slot.dueMs > VALIDATION_MAX_DELAY_MS) {
                cnt.learnDroppedMissedWindow++;
                slot = null;                                 // slot becomes replaceable (isExistingPredictionReplaceable)
            } else {
                const v = validateAt(slot, T);
                if (!v.ok || !v.inProdRange) {
                    cnt.learnRetries++;                      // production returns early: row stays pending, retried next cron
                } else {
                    cnt.learnValidations++;
                    const cellKey = `${slot.flowBin}_${slot.flowState}`;
                    const binData = bins[slot.flowBin][slot.flowState];
                    const lr = {
                        predTs: iso(slot.predEpoch), valHourTs: iso(T), dueTs: iso(slot.dueMs), tauTs: iso(v.tau),
                        arm: label, inputArm: slot.inputArm, cell: cellKey,
                        chk1_ef: v.g.checks.c1, chk2_stage: v.g.checks.c2, chk3_lowflow_ice: v.g.checks.c3,
                        chk4_largeerr: v.g.checks.c4, chk5_outlier: v.g.checks.c5, truthDependentHard: v.truthDependentHard,
                        rawResidualCFS: v.errorCFS,
                        emaBefore: binData.emaMeanError === undefined ? null : binData.emaMeanError,
                        countBefore: binData.count,
                    };
                    if (v.g.isHardFlagged) {
                        cnt.learnHardSkipped++;
                        lr.outcome = 'hard_skipped'; lr.learned = 0; lr.clamped = 0; lr.softFlagged = 0;
                        lr.learningErrorCFS = null; lr.emaAfter = lr.emaBefore; lr.countAfter = lr.countBefore;
                    } else {
                        const upd = updateCorrectionBin(binData, v.errorCFS, v.g.isSoftFlagged);
                        lastLearn.set(cellKey, T);   // onset study: bookkeeping only
                        cnt.learnLearned++;
                        if (v.g.isSoftFlagged) cnt.learnSoftLearned++;
                        if (upd.clamped) cnt.learnClamped++;
                        lr.outcome = 'learned'; lr.learned = 1; lr.clamped = upd.clamped ? 1 : 0;
                        lr.softFlagged = v.g.isSoftFlagged ? 1 : 0; lr.learningErrorCFS = upd.learningError;
                        lr.emaAfter = binData.emaMeanError; lr.countAfter = binData.count;
                        binRows.push({ ts: iso(T), arm: label, cell: cellKey, emaMeanError: binData.emaMeanError, count: binData.count, clamped: upd.clamped ? 1 : 0 });
                    }
                    learnRows.push(lr);
                    slot = null;
                }
            }
        }

        // (c) New prediction at this hour (after validation, cron order). One computation serves both tracks:
        //     the learning-track prediction and the shadow prediction at the same hour are the same call.
        if (T <= endPred) {
            cnt.predictAttempts++;
            const a = armAt(T);
            const rec = makeRecord(T, a);
            cnt.status[rec.r.status] = (cnt.status[rec.r.status] || 0) + 1;
            shadowRows.push(rec.r);
            if (rec.pred) {
                const Tv = ceilHour(rec.pred.dueMs);
                if (!shadowQ.has(Tv)) shadowQ.set(Tv, []);
                shadowQ.get(Tv).push({ r: rec.r, pred: rec.pred });
                if (slot === null) { slot = rec.pred; cnt.learnSlotsStored++; }
                else cnt.learnSlotBlockedHours++;
            }
        }
    }
    // Anything still queued (validation hour beyond the drain window): never silently dropped.
    for (const [Tv, list] of shadowQ) for (const rec of list) { rec.r.status = 'no_truth'; rec.r.statusDetail = 'drain_end'; rec.r.valHourTs = iso(Tv); }
    // Rows that became no_truth inside fillShadow were counted as 'predicted' at creation; fix the status tallies.
    cnt.status = { predicted: 0, no_por: 0, no_lf: 0, no_truth: 0, other: 0 };
    for (const r of shadowRows) cnt.status[r.status] = (cnt.status[r.status] || 0) + 1;
    cnt.slotLeftPending = slot ? 1 : 0;
    return { shadowRows, learnRows, binRows, cnt, bins, onsetChecked };
}

function countsText(runName, args, cnt, extra = {}) {
    const L = [];
    L.push(`run: ${runName}`);
    L.push(`command: node ci_backtest_harness_lag.mjs ${process.argv.slice(2).join(' ')}`);
    L.push(`rows read from CSV: ${cnt.rowsRead}`);
    L.push(`simulated whole-hour grid points (incl. drain): ${cnt.gridHours}`);
    L.push(`prediction attempts (one per simulated hour up to the end): ${cnt.predictAttempts}`);
    L.push('shadow rows per status:');
    for (const [k, v] of Object.entries(cnt.status)) L.push(`  ${k}: ${v}`);
    L.push(`shadow rows written: ${Object.values(cnt.status).reduce((a, b) => a + b, 0)}`);
    L.push(`shadow validated (truth found): ${cnt.shadowValidated}`);
    L.push(`  of which truth outside production range [500, 500000]: ${cnt.shadowOutOfProdRange}`);
    // BLIND-SAFE: only checks that do not depend on the prediction error are tallied here (Check 4 and Check 5 depend on it).
    L.push(`  truth-dependent hard (Check 2 or 3 fired): ${cnt.shadowTruthDependentHard}`);
    L.push(`  Check 1 (EF vs truth) fired: ${cnt.shadowChecks.c1}   Check 2: ${cnt.shadowChecks.c2}   Check 3: ${cnt.shadowChecks.c3}`);
    L.push(`learning track: slots stored ${cnt.learnSlotsStored}; hours a new prediction found the slot occupied ${cnt.learnSlotBlockedHours}`);
    L.push(`  validations (truth found, in production range): ${cnt.learnValidations}`);
    if (args.gate === 'new') {   // hard = Checks 2 and 3 only (truth-dependent), so these counts are blind-safe
        L.push(`  learned: ${cnt.learnLearned}`);
        L.push(`  hard-skipped (excluded from learning): ${cnt.learnHardSkipped}`);
    } else {                     // old gate: hard includes the error-dependent Check 5; counts left to the learn file
        L.push('  learned / hard-skipped: not tallied here (old-gate hard flags depend on the prediction error); see learn_*.csv, column outcome');
    }
    L.push(`  retries (no truth or truth out of production range at the validation hour): ${cnt.learnRetries}`);
    L.push(`  dropped, missed 2.5 h window: ${cnt.learnDroppedMissedWindow}`);
    L.push(`  slot still pending at end of run: ${cnt.slotLeftPending}`);
    for (const [k, v] of Object.entries(extra)) L.push(`${k}: ${v}`);
    return L.join('\n') + '\n';
}

function runHybridCli(args) {
    const rows = loadRows(args.in);
    console.log(`[lag] arm=${args.arm} gate=${args.gate} mode=hybrid switch=${args.switch || '-'} until=${args.until || '-'}  rows=${rows.length}`);
    const isSwitch = args.switchMs !== null;
    const gateSuffix = args.gate === 'old' ? '_gateold' : '';
    const armLabel = isSwitch ? 'L>F' : args.arm;
    const res = runHybrid(rows, {
        arm: args.arm, gate: args.gate, switchMs: args.switchMs, untilMs: args.untilMs, armLabel,
    });
    fs.mkdirSync(args.outdir, { recursive: true });
    let name, shadowOut = res.shadowRows, extra = {};
    if (isSwitch) {
        const d = new Date(args.switchMs).toISOString().slice(0, 10);
        name = `switch_${d}`;
        shadowOut = res.shadowRows.filter(r => Date.parse(r.predTs) >= args.switchMs);
        const st = {};
        for (const r of shadowOut) st[r.status] = (st[r.status] || 0) + 1;
        extra = {
            'NOTE': 'the counts above cover the whole switched run from the start of the data (L inputs before the switch); the file holds only predTs >= switch',
            'shadow rows written to file (predTs >= switch)': shadowOut.length,
            'file rows per status': JSON.stringify(st),
        };
        writeCsv(path.join(args.outdir, `${name}.csv`), SHADOW_COLS, shadowOut);
    } else {
        name = `${args.arm}${gateSuffix}`;
        writeCsv(path.join(args.outdir, `shadow_${name}.csv`), SHADOW_COLS, shadowOut);
        writeCsv(path.join(args.outdir, `learn_${name}.csv`), LEARN_COLS, res.learnRows);
        writeCsv(path.join(args.outdir, `bins_${name}.csv`), BIN_COLS, res.binRows);
        extra = { 'learn rows written': res.learnRows.length, 'bin-update rows written': res.binRows.length };
    }
    fs.writeFileSync(path.join(args.outdir, `counts_${name}.txt`), countsText(name, args, res.cnt, extra));
    console.log(`[lag] done ${name}: shadow rows ${shadowOut.length}; statuses ${JSON.stringify(res.cnt.status)}; learn validations ${res.cnt.learnValidations}`);
    console.log(`[onset] CEILING_RATIO used: production export CEILING_RATIO = ${CEILING_RATIO}`);
    console.log(`[onset] rows checked: ${res.onsetChecked.rows}; passed (a) state ${res.onsetChecked.a_state}, (a) past-reading lookup ${res.onsetChecked.a_lookup}, (b) ${res.onsetChecked.b}, (c) ${res.onsetChecked.c}`);
}

// Auto-run only when invoked as the main script (so selftest can import without triggering a replay).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const args = parseArgs(process.argv.slice(2));
    if (args.arm === 'orig') runOrig(args); else runHybridCli(args);
}

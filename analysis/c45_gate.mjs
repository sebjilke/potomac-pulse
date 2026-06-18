// v36.1 — Corrected-residual CI backtest harness (analysis only; NOT shipped).
//
// Runs the REAL production GF model (makeGFPrediction, imported via the existing _test
// export — zero production change) over the re-fetched ~14-yr hourly series, replaying the
// server's prequential EMA learn-on-raw loop, and logs the CORRECTED residual per validated
// prediction. That log feeds the blind Python+R CI derivation (ci_corrected_residuals_*).
//
// Fidelity notes (see analysis/ci_v36.1_backtest_plan.md §§3,5,12):
//  - Date.now() is monkeypatched to the sim-hour epoch around each model call, so the model's
//    relative-time lookups (getPoRFromHistory/getFlowState/getPoRRiseRateFromHistory) resolve
//    against the REAL csv epochs with no timestamp shifting. Restored immediately after.
//  - The EMA bin update uses the SAME shared updateCorrectionBin the cron uses (no drift).
//  - The anomaly gates (Checks 1-5) are reproduced from validatePendingPredictions:947-1037
//    using the shared helpers (estimateLFFlowFromStage, EF_MODEL). HARD-flagged obs are skipped
//    AND excluded from the residual sample (corrupted ground truth); SOFT-flagged are kept.
//  - Cron order is preserved: validate due pendings FIRST, then make the new prediction.
//  - Modes: --mode=multi (default; validate every hour's prediction at its horizon) or
//    --mode=single (reproduce production's one-pending-slot throughput bottleneck, S-F3 guardrail).
//
// Usage: node analysis/ci_backtest_harness.mjs [--mode=multi|single] [--in=PATH] [--out=PATH]

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Real production model + shared helpers (imported, not reimplemented) ---
const { _test } = require('../netlify/functions/scheduled-update.js');
const { makeGFPrediction } = _test;
const {
    updateCorrectionBin, buildCorrectionBins,
    estimateLFFlowFromStage, EF_MODEL, VALIDATION_MAX_DELAY_MS,
    getGFCorrection, getFlowBin, CEILING_RATIO,
} = require('../netlify/functions/shared/model.js');

// ---- C45 Phase-1 PROTOTYPE (final = v3, SHIPPED design): NARROW band on the LOW/MID boundaries only ----
// (analysis-only; NOT the shipped impl). Full-width interpolation (v1) degraded accuracy by
// shifting MID-bin corrections toward different-regime neighbors (gate REJECT, worst +17.4% at
// 25-50k). v2 leaves mid-bin obs at their EXACT binned correction (getGFCorrection of their own
// bin) and only blends within ±BAND flow of each hard boundary, so the visible step is replaced
// by a short ramp while accuracy-bearing mid-bin values are untouched. Continuous: at a band edge
// t->0/1 == the bin's own value (matches the outside-band value); at the boundary t=0.5 (midpoint).
// Same flowState column throughout (Phase 1 doesn't touch state).
const BAND = 0.12;   // ±12% flow band around each boundary (bins are ~2× apart → no band overlap)
// v3: smooth ONLY the low/mid boundaries where the correction is a continuous fn of flow
// (diagnostic: data-backed edge jumps ≤192 cfs there). The 25000 & 50000 boundaries are LEFT as
// steps — the correction is genuinely regime-dependent at high flow (smoothing them degraded the
// 25-50k bin +5.73% in v2), so those steps are real signal, not artifact.
const BOUNDARIES = [
    { B: 3000,  below: '0-3000',      above: '3000-6000' },
    { B: 6000,  below: '3000-6000',   above: '6000-12000' },
    { B: 12000, below: '6000-12000',  above: '12000-25000' },
];
function getGFCorrectionInterpolated(correctionBins, flowCFS, flowState) {
    if (!correctionBins) return 0;
    const f = Math.max(flowCFS, 1);
    const lnf = Math.log(f);
    for (const bd of BOUNDARIES) {
        const lnLo = Math.log(bd.B / (1 + BAND));
        const lnHi = Math.log(bd.B * (1 + BAND));
        if (lnf > lnLo && lnf < lnHi) {                 // inside this boundary's transition band → ramp
            const t = (lnf - lnLo) / (lnHi - lnLo);
            const cLo = getGFCorrection(correctionBins, bd.below, flowState);
            const cHi = getGFCorrection(correctionBins, bd.above, flowState);
            return (1 - t) * cLo + t * cHi;
        }
    }
    return getGFCorrection(correctionBins, getFlowBin(f), flowState);  // mid-bin → own bin's correction (unchanged)
}

// Production gauge IDs (scheduled-update.js:167-173)
const GAUGES = {
    por: '01638500', lf: '01646500', monocacy: '01643000', goose: '01644000',
    broadRun: '01644280', seneca: '01645000', ef: '01644148',
};

const HOUR_MS = 3600 * 1000;
const POR_HISTORY_WINDOW_MS = 72 * HOUR_MS;   // PoR lookback covers max travel time (~48h) + margin

// ---------------- args ----------------
function parseArgs(argv) {
    const a = { mode: 'multi', in: path.join(__dirname, 'hourly_backtest_data_v361.csv'), out: null };
    for (const tok of argv.slice(2)) {
        const m = tok.match(/^--([^=]+)=(.*)$/);
        if (m) a[m[1]] = m[2];
    }
    if (!a.out) a.out = path.join(__dirname, `c45_gate_residuals_${a.mode}.csv`);
    if (a.mode !== 'multi' && a.mode !== 'single') throw new Error(`bad --mode=${a.mode}`);
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

function loadRows(csvPath) {
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

// ---------------- anomaly gates (mirror validatePendingPredictions:947-1037) ----------------
// Returns { isHardFlagged, isSoftFlagged }. binData is the bin BEFORE this obs is added.
export function scoreAnomalies({ errorCFS, errorPercentRaw, actualLF, actualStage, efStage, temp, binData }) {
    let hardScore = 0, softScore = 0;

    // Check 1: EF cross-check → SOFT (>25%)
    let efEstimateNow = null;
    if (efStage && efStage >= EF_MODEL.minStage && efStage <= EF_MODEL.maxStage) {
        const useCold = temp !== null && temp !== undefined && temp <= EF_MODEL.coldMaxTemp;
        const coef = useCold ? EF_MODEL.coldCoef : EF_MODEL.coef;
        const exp = useCold ? EF_MODEL.coldExp : EF_MODEL.exp;
        efEstimateNow = coef * Math.pow(efStage, exp);
    }
    if (efEstimateNow && actualLF) {
        if ((efEstimateNow - actualLF) / actualLF > 0.25) softScore += 2;
    }

    // Check 2: stage-discharge inconsistency → HARD (>35%)
    if (actualStage && actualLF) {
        const expected = estimateLFFlowFromStage(actualStage);
        if (expected > 0 && (expected - actualLF) / actualLF > 0.35) hardScore += 2;
    }

    // Check 3: low flow + high stage → HARD (ice signature)
    if (actualLF < 1500 && actualStage > 2.45) hardScore += 2;

    // Check 4: large prediction error (RAW) → SOFT (+1)
    if (Math.abs(errorPercentRaw) > 50) softScore += 1;

    // Check 5: statistical outlier → HARD (z>3, needs >=10 prior obs)
    if (binData.count >= 10) {
        const variance = (binData.sumErrorSq / binData.count) - (binData.meanError * binData.meanError);
        const stdDev = Math.sqrt(Math.max(0, variance));
        if (stdDev > 0 && Math.abs((errorCFS - binData.meanError) / stdDev) > 3) hardScore += 2;
    }

    const isHardFlagged = hardScore >= 2;
    const isSoftFlagged = !isHardFlagged && softScore >= 2;
    return { isHardFlagged, isSoftFlagged };
}

// ---------------- one model call with Date.now monkeypatched to sim-time ----------------
const NOOP = () => {};
function predictAtSimTime(simNowMs, usgsData, porHistory, temp, correctionBins) {
    const realNow = Date.now;
    const realLog = console.log;
    Date.now = () => simNowMs;
    console.log = NOOP;                  // silence the model's per-call chatter (~500k lines over 14yr)
    try {
        return makeGFPrediction(usgsData, porHistory, temp, correctionBins);
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

// ---------------- main replay ----------------
function run() {
    const args = parseArgs(process.argv);
    console.log(`[harness] mode=${args.mode}  in=${path.basename(args.in)}  out=${path.basename(args.out)}`);
    const rows = loadRows(args.in);
    const byEpoch = new Map(rows.map(r => [r.epoch, r]));
    console.log(`[harness] loaded ${rows.length} hourly rows: ${rows[0].ts} .. ${rows[rows.length - 1].ts}`);

    const correctionBins = buildCorrectionBins([]);   // empty 18-cell seed (matches cron load path)
    const porHist = [];                                // rolling [{timestamp, cfs}] ascending
    const pending = [];                                // {dueMs, predEpoch, rawFinalCFS, predictedCFS, correction, flowBin, flowState, ceilingApplied, binCountAtPred}
    const residuals = [];
    const stats = { predictions: 0, validated: 0, hardSkipped: 0, softClamped: 0, missedWindow: 0, noLF: 0, selfCheckFail: 0, corrMismatch: 0 };

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

            const { isHardFlagged, isSoftFlagged } = scoreAnomalies({
                errorCFS, errorPercentRaw, actualLF, actualStage,
                efStage: vrow.ef, temp: vrow.temp, binData,
            });
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
                // C45 A/B residuals (unclipped = threshold metric; clipped = displayed)
                corrBinned: p.corrBinned, corrInterp: p.corrInterp,
                resUnclBinned: p.unclBinned - actualLF, resUnclInterp: p.unclInterp - actualLF,
                resClipBinned: p.clipBinned - actualLF, resClipInterp: p.clipInterp - actualLF,
                ceilBinned: p.ceilBinned, ceilInterp: p.ceilInterp,
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

        // ---- C45 A/B arms, from the SAME bins snapshot + pred.rawFinalCFS (GATE-2/3) ----
        const raw = pred.rawFinalCFS;
        const lfCeil = (row.lf > 0) ? row.lf * CEILING_RATIO : Infinity;
        const corrBinned = getGFCorrection(correctionBins, pred.flowBin, pred.flowState);
        const corrInterp = getGFCorrectionInterpolated(correctionBins, raw, pred.flowState);
        const unclBinned = raw - corrBinned;                       // pre-ceiling (threshold metric, GATE-3)
        const unclInterp = raw - corrInterp;
        const clipBinned = Math.round(Math.min(unclBinned, lfCeil)); // post-ceiling rounded (what users see)
        const clipInterp = Math.round(Math.min(unclInterp, lfCeil));
        const ceilBinned = unclBinned > lfCeil ? 1 : 0;
        const ceilInterp = unclInterp > lfCeil ? 1 : 0;
        // self-checks: binned arm must reproduce the real model's correction + predictedCFS
        if (Math.round(corrBinned) !== pred.correctionApplied) stats.corrMismatch++;
        if (Math.abs(clipBinned - pred.predictedCFS) > 1) stats.selfCheckFail++;

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
            corrBinned, corrInterp, unclBinned, unclInterp, clipBinned, clipInterp, ceilBinned, ceilInterp,
        });
    }

    // ---------------- write residual log ----------------
    const cols = ['predTs', 'valTs', 'rawFinalCFS', 'predictedCFS', 'correction', 'flowBin',
        'flowState', 'actualLF', 'residual', 'rawResidual', 'ceilingApplied', 'isSoftFlagged', 'binCountAtPred',
        'corrBinned', 'corrInterp', 'resUnclBinned', 'resUnclInterp', 'resClipBinned', 'resClipInterp',
        'ceilBinned', 'ceilInterp'];
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
    console.log(`  [A/B self-check] corrMismatch=${stats.corrMismatch}  predictedCFS selfCheckFail=${stats.selfCheckFail}  (both MUST be 0)`);
    console.log(`  residuals written: ${residuals.length} -> ${path.basename(args.out)}`);

    // quick per-bin count sanity (final correction state)
    console.log('  final bin counts (count | emaMeanError):');
    for (const bin of Object.keys(correctionBins)) {
        const parts = ['rising', 'steady', 'falling'].map(s => {
            const b = correctionBins[bin][s];
            return `${s}=${b.count}/${b.emaMeanError !== undefined ? Math.round(b.emaMeanError) : '-'}`;
        });
        console.log(`    ${bin.padEnd(12)} ${parts.join('  ')}`);
    }
}

// Auto-run only when invoked as the main script (so tests can import scoreAnomalies/etc.
// without triggering the CSV read + replay).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) run();

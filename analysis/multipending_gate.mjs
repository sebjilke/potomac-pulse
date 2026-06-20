// #14 — Multi-pending vs single-pending learning gate (analysis only; NOT shipped).
//
// Dual-arm, common-evaluation-stream backtest (see analysis/multipending-learning-backtest-plan-2026-06-19.md).
// Maintains TWO parallel 18-cell EMA bin states learned under two policies, and scores BOTH corrections
// on the SAME hourly prediction stream so the only difference is what fed each EMA (isolates correction
// quality from policy throughput — the "run --mode twice" comparison is confounded, see plan §2).
//
//   binsMulti  : fed by EVERY validated hourly prediction (multi-pending policy).
//   binsSingle : fed ONLY by predictions the single-slot rule would have stored (current production).
//
// Fidelity (mirrors ci_backtest_harness.mjs + validatePendingPredictions):
//  - REAL makeGFPrediction (via _test export) + shared updateCorrectionBin/applyGFCorrection (no drift).
//  - Date.now monkeypatched to sim-hour epoch around each model call (no timestamp shifting).
//  - Each arm's corrected estimate is the model's OWN predictedCFS from a real makeGFPrediction call with
//    that arm's bins (TWO calls/hour) — guaranteed model-faithful through the ceiling/EF-only paths, no
//    re-derivation. Self-check (must-fix #1): rawFinalCFS/flowBin/flowState are correction-INDEPENDENT, so
//    both arms' calls must agree on them; any disagreement is counted and flagged.
//  - Single-slot faithfulness (must-fix #1): validation runs BEFORE the store decision (cron order), so any
//    remaining pending is in-window/not-replaceable => slot free iff count==0. This equals production's
//    isExistingPredictionReplaceable rule on the hourly grid; cross-checked against `--mode=single` offline.
//  - Anomaly flags computed PER ARM (each uses its own binData for the z-outlier check) for faithful
//    per-arm learning; the eval residual sample excludes an obs hard-flagged by EITHER arm (paired clean
//    sample, corrupted ground truth removed from both).
//  - Emits a per-prediction residual log with both arms' corrected residuals + the shared raw residual
//    (must-fix #5) + timestamps + flow cell, for downstream event-level blind Python+R analysis
//    (event aggregation / bootstrap / power thresholds live in the analysis, not here — must-fix #3,#4).
//
// Usage: node analysis/multipending_gate.mjs [--in=PATH] [--out=PATH]

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreAnomalies } from './ci_backtest_harness.mjs';   // SAME anomaly logic (imported, no drift)

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { _test } = require('../netlify/functions/scheduled-update.js');
const { makeGFPrediction } = _test;
const {
    updateCorrectionBin, buildCorrectionBins, VALIDATION_MAX_DELAY_MS,
} = require('../netlify/functions/shared/model.js');

// Production gauge IDs (scheduled-update.js:167-173)
const GAUGES = {
    por: '01638500', lf: '01646500', monocacy: '01643000', goose: '01644000',
    broadRun: '01644280', seneca: '01645000', ef: '01644148',
};
const HOUR_MS = 3600 * 1000;
const POR_HISTORY_WINDOW_MS = 72 * HOUR_MS;
const SELFCHECK_EPS = 1.0;   // cfs; allows the model's integer rounding of predictedCFS

// ---------- args ----------
function parseArgs(argv) {
    const a = { in: path.join(__dirname, 'hourly_backtest_data_v361.csv'), out: path.join(__dirname, 'multipending_residuals.csv') };
    for (const tok of argv.slice(2)) {
        const m = tok.match(/^--([^=]+)=(.*)$/);
        if (m) a[m[1]] = m[2];
    }
    return a;
}

// ---------- CSV load (mirrors ci_backtest_harness.mjs:60-92) ----------
function numOrNull(s) {
    if (s === undefined || s === '') return null;
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : null;
}
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
            epoch: tsToEpoch(c[idx.timestamp]), ts: c[idx.timestamp],
            por: numOrNull(c[idx.por_now]), ef: numOrNull(c[idx.ef_stage]),
            lf: numOrNull(c[idx.lf_discharge]), lfStage: numOrNull(c[idx.lf_stage]),
            temp: numOrNull(c[idx.water_temp_c]), mono: numOrNull(c[idx.monocacy]),
            goose: numOrNull(c[idx.goose]), broad: numOrNull(c[idx.broad_run]), seneca: numOrNull(c[idx.seneca]),
        });
    }
    rows.sort((a, b) => a.epoch - b.epoch);
    return rows;
}

// ---------- model call with Date.now monkeypatched (mirrors harness:137-148) ----------
const NOOP = () => {};
function predictAtSimTime(simNowMs, usgsData, porHistory, temp, correctionBins) {
    const realNow = Date.now, realLog = console.log;
    Date.now = () => simNowMs; console.log = NOOP;
    try { return makeGFPrediction(usgsData, porHistory, temp, correctionBins); }
    finally { Date.now = realNow; console.log = realLog; }
}
function buildUsgsData(row) {
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

function finalBinReport(label, bins) {
    console.log(`  [${label}] final bin counts (count | emaMeanError):`);
    for (const bin of Object.keys(bins)) {
        const parts = ['rising', 'steady', 'falling'].map(s => {
            const b = bins[bin][s];
            return `${s}=${b.count}/${b.emaMeanError !== undefined ? Math.round(b.emaMeanError) : '-'}`;
        });
        console.log(`    ${bin.padEnd(12)} ${parts.join('  ')}`);
    }
}

// ---------- main replay ----------
function run() {
    const args = parseArgs(process.argv);
    console.log(`[gate] in=${path.basename(args.in)} out=${path.basename(args.out)}`);
    const rows = loadRows(args.in);
    const byEpoch = new Map(rows.map(r => [r.epoch, r]));
    console.log(`[gate] loaded ${rows.length} hourly rows: ${rows[0].ts} .. ${rows[rows.length - 1].ts}`);

    const binsSingle = buildCorrectionBins([]);
    const binsMulti = buildCorrectionBins([]);
    const porHist = [];
    const evalPending = [];     // every hour's prediction (common eval stream)
    let singleSlotCount = 0;    // 0/1 — single-pending slot occupancy (production-faithful, see header)
    const residuals = [];
    const stats = {
        predictions: 0, evalValidated: 0, evalIncluded: 0, singleStored: 0,
        singleLearned: 0, multiLearned: 0, hardSingle: 0, hardMulti: 0,
        missedWindow: 0, noLF: 0, rawMismatch: 0, maxRawMiss: 0,
    };

    for (const row of rows) {
        const simNowMs = row.epoch;

        // (1) VALIDATE due predictions first (cron order).
        for (let k = evalPending.length - 1; k >= 0; k--) {
            const p = evalPending[k];
            if (p.dueMs > simNowMs) continue;
            evalPending.splice(k, 1);
            if (p.singleStored) singleSlotCount--;       // free the single slot when its stored pred leaves
            if (simNowMs - p.dueMs > VALIDATION_MAX_DELAY_MS) { stats.missedWindow++; continue; }
            const vrow = byEpoch.get(simNowMs);
            if (!vrow || vrow.lf === null || vrow.lf <= 0) { stats.noLF++; continue; }

            const actualLF = vrow.lf, actualStage = vrow.lfStage;
            const rawErr = p.rawFinalCFS - actualLF;     // shared learn-on-raw residual (identical both arms)
            const errPctRaw = (rawErr / actualLF) * 100;
            const binSingle = binsSingle[p.flowBin][p.flowState];
            const binMulti = binsMulti[p.flowBin][p.flowState];

            // Per-arm anomaly flags (z-outlier check uses each arm's own binData).
            const fM = scoreAnomalies({ errorCFS: rawErr, errorPercentRaw: errPctRaw, actualLF, actualStage, efStage: vrow.ef, temp: vrow.temp, binData: binMulti });
            const fS = scoreAnomalies({ errorCFS: rawErr, errorPercentRaw: errPctRaw, actualLF, actualStage, efStage: vrow.ef, temp: vrow.temp, binData: binSingle });

            // MULTI learns from every validated prediction (if not hard-flagged).
            if (fM.isHardFlagged) { stats.hardMulti++; }
            else { updateCorrectionBin(binMulti, rawErr, fM.isSoftFlagged); stats.multiLearned++; }

            // SINGLE learns only from single-stored predictions (if not hard-flagged).
            if (p.singleStored) {
                if (fS.isHardFlagged) { stats.hardSingle++; }
                else { updateCorrectionBin(binSingle, rawErr, fS.isSoftFlagged); stats.singleLearned++; }
            }

            stats.evalValidated++;
            // Eval residual: paired clean sample — exclude if EITHER arm flags corrupted ground truth.
            if (!fM.isHardFlagged && !fS.isHardFlagged) {
                stats.evalIncluded++;
                residuals.push({
                    predTs: new Date(p.predEpoch).toISOString(), valTs: vrow.ts,
                    flowBin: p.flowBin, flowState: p.flowState,
                    rawFinalCFS: Math.round(p.rawFinalCFS), actualLF: Math.round(actualLF),
                    corrSingle: Math.round(p.corrSingleEst), corrMulti: Math.round(p.corrMultiEst),
                    resSingle: Math.round(p.corrSingleEst - actualLF),
                    resMulti: Math.round(p.corrMultiEst - actualLF),
                    rawResidual: Math.round(rawErr),
                    singleStored: p.singleStored ? 1 : 0,
                    softSingle: fS.isSoftFlagged ? 1 : 0, softMulti: fM.isSoftFlagged ? 1 : 0,
                    binCountSingleAtPred: p.binCountSingleAtPred, binCountMultiAtPred: p.binCountMultiAtPred,
                });
            }
        }

        // (2) Maintain rolling porHistory.
        if (row.por !== null && row.por > 0) {
            porHist.push({ timestamp: simNowMs, cfs: row.por });
            while (porHist.length && porHist[0].timestamp < simNowMs - POR_HISTORY_WINDOW_MS) porHist.shift();
        }

        // (3) Make ONE eval prediction every hour the model can (PoR + LF present). Common eval stream.
        if (row.por === null || row.por <= 0 || row.lf === null || row.lf <= 0) continue;
        const usgsData = buildUsgsData(row);
        // TWO real model calls — one per arm's bins — so each corrected estimate is the model's own
        // predictedCFS (faithful through ceiling/EF-only paths). The raw model is correction-independent.
        const predM = predictAtSimTime(simNowMs, usgsData, porHist, row.temp, binsMulti);
        const predS = predictAtSimTime(simNowMs, usgsData, porHist, row.temp, binsSingle);
        if (!predM || !predS) continue;
        stats.predictions++;

        // Self-check (must-fix #1): raw/bin/state must be identical across the two bin states.
        const rawMiss = Math.abs(predM.rawFinalCFS - predS.rawFinalCFS);
        if (rawMiss > stats.maxRawMiss) stats.maxRawMiss = rawMiss;
        if (rawMiss > SELFCHECK_EPS || predM.flowBin !== predS.flowBin || predM.flowState !== predS.flowState) stats.rawMismatch++;

        const rawFinal = predM.rawFinalCFS, flowBin = predM.flowBin, flowState = predM.flowState;
        const corrMultiEst = predM.predictedCFS;   // model's own corrected estimate, binsMulti
        const corrSingleEst = predS.predictedCFS;  // model's own corrected estimate, binsSingle

        const singleStored = (singleSlotCount === 0);   // slot free => single-pending would store here
        if (singleStored) { singleSlotCount++; stats.singleStored++; }

        evalPending.push({
            dueMs: simNowMs + predM.travelTimeGFtoLF * HOUR_MS, predEpoch: simNowMs,
            rawFinalCFS: rawFinal, flowBin, flowState, corrSingleEst, corrMultiEst, singleStored,
            binCountSingleAtPred: binsSingle[flowBin][flowState].count,
            binCountMultiAtPred: binsMulti[flowBin][flowState].count,
        });
    }

    // ---------- write residual log ----------
    const cols = ['predTs', 'valTs', 'flowBin', 'flowState', 'rawFinalCFS', 'actualLF',
        'corrSingle', 'corrMulti', 'resSingle', 'resMulti', 'rawResidual', 'singleStored',
        'softSingle', 'softMulti', 'binCountSingleAtPred', 'binCountMultiAtPred'];
    const out = [cols.join(',')];
    for (const r of residuals) out.push(cols.map(c => r[c]).join(','));
    fs.writeFileSync(args.out, out.join('\n') + '\n');

    console.log('[gate] DONE');
    console.log(`  predictions made   : ${stats.predictions}`);
    console.log(`  single-stored      : ${stats.singleStored}   (multi stores every hour)`);
    console.log(`  eval validated     : ${stats.evalValidated}`);
    console.log(`  eval included (paired): ${stats.evalIncluded} -> ${path.basename(args.out)}`);
    console.log(`  multi learned      : ${stats.multiLearned}   (hard-skipped ${stats.hardMulti})`);
    console.log(`  single learned     : ${stats.singleLearned}   (hard-skipped ${stats.hardSingle})`);
    console.log(`  missed 2.5h window : ${stats.missedWindow}`);
    console.log(`  no-LF at horizon   : ${stats.noLF}`);
    console.log(`  SELF-CHECK raw/bin/state mismatches (> ${SELFCHECK_EPS} cfs): ${stats.rawMismatch}  (max raw Δ ${stats.maxRawMiss.toFixed(3)} cfs)`);
    if (stats.rawMismatch > 0) console.log('  ⚠️  SELF-CHECK FAILED — raw model is not correction-independent; gate design invalid.');
    finalBinReport('single', binsSingle);
    finalBinReport('multi', binsMulti);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) run();

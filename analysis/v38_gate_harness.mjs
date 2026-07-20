// v38.0 — EF divergence gate replay harness (analysis only; NOT shipped).
// Plan: analysis/ef-divergence-gate-plan-v3-2026-07-20.md (§§1-5).
//
// Extends the ci_backtest_harness.mjs pattern (real production makeGFPrediction via the
// _test export, Date.now monkeypatch, prequential EMA learn-on-raw, cron order) with the
// v38 arm mechanisms behind a config sweep. Key design point (fidelity-checked below):
// correctionBins feed NOTHING inside makeGFPrediction except the final applyGFCorrection
// (verified scheduled-update.js:742-880), so porEstimateCFS / rawFinalCFS / efEstimateCFS /
// flowState / travelTimeGFtoLF are learning-independent. ONE model call per hour therefore
// serves ALL 85 configs exactly; each config end-applies its OWN bins via the same shared
// applyGFCorrection/getGFCorrectionInterpolated helpers the model itself uses, and learns
// into its own bins. As an internal guard, the harness asserts each hour that its own
// C0 end-apply reproduces the model call's predictedCFS (they use the same bins object).
//
// Arms (plan v3 §2): c0 · c1/c1f/c1n × 24 cells (T_LO×band×W_CAP) · c2 × 6 · c2m × 6 = 85.
//   c1  : estimate = (1−a)·SQ + a·BOOST (convex form, E5); SQ = own-bins status-quo
//         (incl. 50% skip, full correction); BOOST = (1−W)·porEst + W·efEst, no correction.
//   c1f : as c1; bin learning SKIPPED for validations whose prediction-time a > 0.25.
//   c1n : as c1 but no damping — displayed = rawArm − interp-correction(rawArm).
//   c2  : logistic re-centered (midpoint sweep) on porEst; skip unchanged; full correction.
//   c2m : as c2 but logistic input = max(porEst, efEst) (de-self-referentialized).
//
// Activation (shared per (T_LO, band)): D = efEst_bare/porEst recorded each model hour when
// efEst valid; D̄ = median over trailing 5h, needs ≥3 samples AND current-hour efEst valid.
// Eligibility (E1): a = 0 when cold model active (temp ≤ 10°C) or temp missing in Nov–Mar.
//
// Scoring (E-common-mask): EVERY claimed due validation with valid LF logs a row for ALL
// configs (residual = displayed − actualLF); anomaly flags gate LEARNING only, per config.
//
// Usage: node analysis/v38_gate_harness.mjs [--mode=multi|single]
//        [--in=analysis/hourly_backtest_data_v38.csv] [--outdir=analysis]
// Outputs: v38_residuals_<mode>.csv (wide: shared cols + raw_<cfg>, disp_<cfg>)
//          v38_summary_<mode>.json  (per-config learn/flag counters + config metadata)

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreAnomalies } from './ci_backtest_harness.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { _test } = require('../netlify/functions/scheduled-update.js');
const { makeGFPrediction } = _test;
const {
    updateCorrectionBin, buildCorrectionBins, getFlowBin,
    getGFCorrectionInterpolated, VALIDATION_MAX_DELAY_MS, CEILING_RATIO, EF_MODEL,
} = require('../netlify/functions/shared/model.js');

const GAUGES = {
    por: '01638500', lf: '01646500', monocacy: '01643000', goose: '01644000',
    broadRun: '01644280', seneca: '01645000', ef: '01644148',
};
const HOUR_MS = 3600 * 1000;
const POR_HISTORY_WINDOW_MS = 72 * HOUR_MS;
const D_WINDOW_MS = 5 * HOUR_MS;          // plan v3 §1: trailing 5h
const D_MIN_SAMPLES = 3;                  // fail-closed
const FREEZE_A = 0.25;                    // c1f learning-freeze threshold (prediction-time a)
const EF_SKIP_DISCREPANCY = 0.50;         // status-quo skip, reused in c2/c2m branches
const COLD_MONTHS = new Set([10, 11, 0, 1, 2]);  // UTC months Nov(10)–Mar(2): missing-temp proxy (E1)

// ---------------- configs ----------------
function buildConfigs() {
    const cfgs = [{ id: 'c0', kind: 'c0' }];
    for (const kind of ['c1', 'c1f', 'c1n']) {
        for (const tlo of [1.10, 1.15, 1.20]) {
            for (const bw of [0.15, 0.25]) {
                for (const w of [0.5, 0.65, 0.8, 1.0]) {
                    cfgs.push({
                        id: `${kind}_t${Math.round(tlo * 100)}_b${Math.round(bw * 100)}_w${Math.round(w * 100)}`,
                        kind, tlo, bw, w,
                    });
                }
            }
        }
    }
    for (const mid of [3000, 5000]) {
        for (const wm of [0.4, 0.5, 0.65]) {
            cfgs.push({ id: `c2_m${mid / 1000}k_w${Math.round(wm * 100)}`, kind: 'c2', mid, wm });
            cfgs.push({ id: `c2m_m${mid / 1000}k_w${Math.round(wm * 100)}`, kind: 'c2m', mid, wm });
        }
    }
    for (const c of cfgs) {
        c.bins = buildCorrectionBins([]);
        c.stats = { validated: 0, hardSkipped: 0, softClamped: 0, frozenSkipped: 0 };
    }
    return cfgs;
}

// ---------------- args / CSV ----------------
function parseArgs(argv) {
    const a = { mode: 'multi', in: path.join(__dirname, 'hourly_backtest_data_v38.csv'), outdir: __dirname };
    for (const tok of argv.slice(2)) {
        const m = tok.match(/^--([^=]+)=(.*)$/);
        if (m) a[m[1]] = m[2];
    }
    if (a.mode !== 'multi' && a.mode !== 'single') throw new Error(`bad --mode=${a.mode}`);
    return a;
}

function numOrNull(s) {
    if (s === undefined || s === '') return null;
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : null;
}
function tsToEpoch(s) { return Date.parse(s.replace(' ', 'T') + ':00Z'); }

function loadRows(csvPath) {
    const text = fs.readFileSync(csvPath, 'utf8').trim();
    const lines = text.split('\n');
    const idx = Object.fromEntries(lines[0].split(',').map((h, i) => [h, i]));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(',');
        rows.push({
            epoch: tsToEpoch(c[idx.timestamp]), ts: c[idx.timestamp],
            por: numOrNull(c[idx.por_now]), ef: numOrNull(c[idx.ef_stage]),
            lf: numOrNull(c[idx.lf_discharge]), lfStage: numOrNull(c[idx.lf_stage]),
            temp: numOrNull(c[idx.water_temp_c]), mono: numOrNull(c[idx.monocacy]),
            goose: numOrNull(c[idx.goose]), broad: numOrNull(c[idx.broad_run]),
            seneca: numOrNull(c[idx.seneca]),
        });
    }
    rows.sort((a, b) => a.epoch - b.epoch);
    return rows;
}

const NOOP = () => {};
function predictAtSimTime(simNowMs, usgsData, porHistory, temp, correctionBins) {
    const realNow = Date.now, realLog = console.log;
    Date.now = () => simNowMs;
    console.log = NOOP;
    try {
        return makeGFPrediction(usgsData, porHistory, temp, correctionBins);
    } finally {
        Date.now = realNow;
        console.log = realLog;
    }
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

function median(xs) {
    const v = [...xs].sort((a, b) => a - b);
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const clamp01 = x => Math.max(0, Math.min(1, x));

// ---------------- main ----------------
function run() {
    const args = parseArgs(process.argv);
    const configs = buildConfigs();
    const N = configs.length;
    const outCsv = path.join(args.outdir, `v38_residuals_${args.mode}.csv`);
    const outJson = path.join(args.outdir, `v38_summary_${args.mode}.json`);
    console.log(`[v38] mode=${args.mode} configs=${N} in=${path.basename(args.in)}`);

    const rows = loadRows(args.in);
    const byEpoch = new Map(rows.map(r => [r.epoch, r]));
    console.log(`[v38] ${rows.length} hourly rows: ${rows[0].ts} .. ${rows[rows.length - 1].ts}`);

    const porHist = [];
    const dHist = [];          // {t, D} — shared bare-power-law divergence samples
    const pending = [];        // shared entries; per-config arrays inside
    const stats = { hours: 0, predictions: 0, scoredRows: 0, missedWindow: 0, noLF: 0, c0Mismatch: 0 };

    const out = fs.createWriteStream(outCsv);
    const header = ['predTs', 'valTs', 'actualLF', 'flowState', 'dbarPred', 'eligiblePred', 'efValidPred',
        ...configs.map(c => `raw_${c.id}`), ...configs.map(c => `disp_${c.id}`)].join(',');
    out.write(header + '\n');

    const t0 = Date.now();
    for (const row of rows) {
        const simNowMs = row.epoch;
        stats.hours++;

        // (1) validate due pendings (cron order), common mask
        for (let k = pending.length - 1; k >= 0; k--) {
            const p = pending[k];
            if (p.dueMs > simNowMs) continue;
            pending.splice(k, 1);
            if (simNowMs - p.dueMs > VALIDATION_MAX_DELAY_MS) { stats.missedWindow++; continue; }
            const vrow = byEpoch.get(simNowMs);
            if (!vrow || vrow.lf === null || vrow.lf <= 0) { stats.noLF++; continue; }
            const actualLF = vrow.lf;

            // learning per config (flags gate learning ONLY)
            for (let i = 0; i < N; i++) {
                const cfg = configs[i];
                const rawArm = p.raw[i];
                const errorCFS = rawArm - actualLF;
                const bin = getFlowBin(rawArm);
                const binData = cfg.bins[bin][p.flowState];
                const { isHardFlagged, isSoftFlagged } = scoreAnomalies({
                    errorCFS, errorPercentRaw: (errorCFS / actualLF) * 100,
                    actualLF, actualStage: vrow.lfStage, efStage: vrow.ef, temp: vrow.temp, binData,
                });
                if (isHardFlagged) { cfg.stats.hardSkipped++; continue; }
                if (cfg.kind === 'c1f' && p.aP[i] > FREEZE_A) { cfg.stats.frozenSkipped++; continue; }
                const upd = updateCorrectionBin(binData, errorCFS, isSoftFlagged);
                if (upd.clamped) cfg.stats.softClamped++;
                cfg.stats.validated++;
            }

            // common-mask scored row (all configs, no flag exclusion)
            stats.scoredRows++;
            const line = [
                new Date(p.predEpoch).toISOString(), vrow.ts, actualLF, p.flowState,
                p.dbarPred === null ? '' : p.dbarPred.toFixed(4), p.eligiblePred ? 1 : 0,
                p.efValidPred ? 1 : 0,
                ...p.raw.map(v => Math.round(v)), ...p.disp.map(v => Math.round(v)),
            ].join(',');
            out.write(line + '\n');
        }

        // (2) rolling PoR history
        if (row.por !== null && row.por > 0) {
            porHist.push({ timestamp: simNowMs, cfs: row.por });
            while (porHist.length && porHist[0].timestamp < simNowMs - POR_HISTORY_WINDOW_MS) porHist.shift();
        }

        // (3) model call each cycle (needs PoR + LF). Production computes the D sample EVERY
        // cron cycle regardless of the pending slot (plan v3 §1 "computed each server cycle"),
        // so the call runs even when single mode won't post — only the pending.push is gated.
        // (v2 of this harness gated the whole block, starving single-mode D̄ history: with the
        // slot occupied ~4-8h, the ≥3-samples-in-5h rule almost never held except at very high
        // flow. Fixed 2026-07-20; multi mode was unaffected.)
        if (row.por === null || row.por <= 0 || row.lf === null || row.lf <= 0) continue;
        const slotFree = !(args.mode === 'single' && pending.length > 0);

        const pred = predictAtSimTime(simNowMs, buildUsgsData(row), porHist, row.temp, configs[0].bins);
        if (!pred) continue;

        const porEst = pred.porEstimateCFS;
        const efEst = pred.efEstimateCFS;          // bare power-law (server path), null if invalid
        const rawFinal = pred.rawFinalCFS;         // status-quo ensemble output (bin-independent)
        const state = pred.flowState;
        const lfNow = row.lf;

        // D sample + D̄ (shared)
        if (efEst !== null && porEst > 0) {
            dHist.push({ t: simNowMs, D: efEst / porEst });
            while (dHist.length && dHist[0].t < simNowMs - D_WINDOW_MS) dHist.shift();
        } else {
            while (dHist.length && dHist[0].t < simNowMs - D_WINDOW_MS) dHist.shift();
        }
        if (!slotFree) continue;   // single-mode slot occupied: D sample recorded, no new posting
        stats.predictions++;

        const dSamples = dHist.filter(s => s.t >= simNowMs - D_WINDOW_MS).map(s => s.D);
        const coldActive = row.temp !== null && row.temp <= EF_MODEL.coldMaxTemp;
        const missingCold = row.temp === null && COLD_MONTHS.has(new Date(simNowMs).getUTCMonth());
        const eligible = !coldActive && !missingCold;
        const gateReady = eligible && efEst !== null && dSamples.length >= D_MIN_SAMPLES;
        const dbar = dSamples.length >= D_MIN_SAMPLES ? median(dSamples) : null;

        // per-config estimate
        const raw = new Float64Array(N), disp = new Float64Array(N), aP = new Float64Array(N);
        for (let i = 0; i < N; i++) {
            const cfg = configs[i];
            let rawArm, displayed, a = 0;

            if (cfg.kind === 'c0' || cfg.kind === 'c1' || cfg.kind === 'c1f' || cfg.kind === 'c1n') {
                if (cfg.kind !== 'c0' && gateReady && dbar !== null) {
                    a = clamp01((dbar - cfg.tlo) / cfg.bw);
                }
                const corrSQ = getGFCorrectionInterpolated(cfg.bins, rawFinal, state);
                const sqPre = rawFinal - corrSQ;
                if (a > 0) {
                    const boost = (1 - cfg.w) * porEst + cfg.w * efEst;
                    rawArm = (1 - a) * rawFinal + a * boost;
                    if (cfg.kind === 'c1n') {
                        displayed = rawArm - getGFCorrectionInterpolated(cfg.bins, rawArm, state);
                    } else {
                        displayed = (1 - a) * sqPre + a * boost;
                    }
                } else {
                    rawArm = rawFinal;
                    displayed = sqPre;
                }
            } else {  // c2 / c2m
                const f = cfg.kind === 'c2m' && efEst !== null ? Math.max(porEst, efEst) : porEst;
                let w2 = 0;
                if (f >= 1000) w2 = cfg.wm / (1 + Math.exp(-5.0 * (Math.log(f) - Math.log(cfg.mid))));
                const efUsable = efEst !== null && Math.abs(efEst - porEst) / porEst <= EF_SKIP_DISCREPANCY;
                rawArm = efUsable ? (1 - w2) * porEst + w2 * efEst : porEst;
                displayed = rawArm - getGFCorrectionInterpolated(cfg.bins, rawArm, state);
            }

            // display-only 120%-LF ceiling on the final displayed value (production semantics)
            if (lfNow > 0 && displayed > lfNow * CEILING_RATIO) displayed = lfNow * CEILING_RATIO;
            raw[i] = rawArm; disp[i] = displayed; aP[i] = a;
        }

        // internal fidelity guard: our C0 end-apply must equal the model call's own output
        if (Math.abs(disp[0] - pred.predictedCFS) > 1.5) stats.c0Mismatch++;

        pending.push({
            dueMs: simNowMs + pred.travelTimeGFtoLF * HOUR_MS,
            predEpoch: simNowMs, flowState: state,
            dbarPred: dbar, eligiblePred: eligible, efValidPred: efEst !== null, raw, disp, aP,
        });
    }
    out.end();

    // Dump end-state unvalidated pendings (fidelity checks on predictions the dataset
    // ends before validating, e.g. the 2026-07-20 12:00Z production row).
    const pendPath = path.join(args.outdir, `v38_pending_${args.mode}.csv`);
    const pendLines = ['predTs,flowState,dbarPred,eligiblePred,efValidPred,' +
        configs.map(c => `raw_${c.id}`).join(',') + ',' + configs.map(c => `disp_${c.id}`).join(',')];
    for (const p of pending) {
        pendLines.push([new Date(p.predEpoch).toISOString(), p.flowState,
            p.dbarPred === null ? '' : p.dbarPred.toFixed(4), p.eligiblePred ? 1 : 0,
            p.efValidPred ? 1 : 0,
            ...Array.from(p.raw, v => Math.round(v)), ...Array.from(p.disp, v => Math.round(v)),
        ].join(','));
    }
    fs.writeFileSync(pendPath, pendLines.join('\n') + '\n');

    const summary = {
        mode: args.mode, rows: rows.length, ...stats,
        configs: configs.map(c => ({ id: c.id, kind: c.kind, tlo: c.tlo ?? null, bw: c.bw ?? null,
            w: c.w ?? null, mid: c.mid ?? null, wm: c.wm ?? null, ...c.stats })),
    };
    fs.writeFileSync(outJson, JSON.stringify(summary, null, 1));
    console.log(`[v38] DONE mode=${args.mode} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    console.log(`  predictions=${stats.predictions} scoredRows=${stats.scoredRows} ` +
        `missedWindow=${stats.missedWindow} noLF=${stats.noLF} c0Mismatch=${stats.c0Mismatch}`);
    console.log(`  c0: validated=${configs[0].stats.validated} hard=${configs[0].stats.hardSkipped}`);
    console.log(`  -> ${path.basename(outCsv)}, ${path.basename(outJson)}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) run();

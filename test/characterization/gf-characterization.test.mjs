// Potomac Pulse — Phase-0 characterization test (READ-ONLY safety net).
//
// What it does (no source files are modified):
//   1. Runs a fixed set of fixtures through BOTH estimators on identical inputs.
//   2. Captures a deterministic snapshot of each side's output.
//   3. Asserts the snapshot matches the committed baseline (snapshots/baseline.json).
//      On first run it WRITES the baseline and passes — establishing the safety net.
//   4. Writes a human-readable client/server divergence report
//      (snapshots/divergence-report.md) — the input to the Tier-3 "which side is
//      canonical?" decision.
//
// Once the baseline exists, ANY future refactor that changes client or server
// output will fail this test — which is exactly the protection we want before
// touching the duplicated model. To intentionally re-baseline, delete the JSON.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadEstimators } from './harness.mjs';
import { FIXTURES, GAUGES, NOW } from './fixtures.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = resolve(__dirname, 'snapshots');
const BASELINE = resolve(SNAP_DIR, 'baseline.json');
const REPORT = resolve(SNAP_DIR, 'divergence-report.md');

const round2 = (x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x);

// Pick only deterministic, comparable fields (exclude absolute-time fields).
function snapClient(r) {
    if (!r) return null;
    return {
        cfs: r.cfs,
        stage: round2(r.stage),
        flowState: r.flowState,
        confidence: r.confidence,
        useTimeShifted: r.useTimeShifted,
        useEfEnsemble: r.useEfEnsemble,
        efWeight: round2(r.efWeight),
        flowBin: r.inputs?.flowBin ?? null,
        correction: round2(r.inputs?.correction),
        porEstimateCFS: r.inputs?.porEstimateCFS ?? null,
        historicPorCFS: r.inputs?.historicPorCFS ?? null,
        ceilingApplied: r.inputs?.ceilingApplied ?? null,
    };
}

function snapServer(r) {
    if (!r) return null;
    return {
        predictedCFS: r.predictedCFS,           // corrected (displayed) — v36.0
        predictedStage: round2(r.predictedStage),
        rawFinalCFS: r.rawFinalCFS,             // raw learning target — v36.0
        correction: r.correctionApplied,        // signed EMA correction applied — v36.0
        flowState: r.flowState,
        useTimeShifted: r.useTimeShifted,
        useEfEnsemble: r.useEfEnsemble,
        efWeight: round2(r.efWeight),
        flowBin: r.flowBin,
        porEstimateCFS: r.porEstimateCFS,
        historicPorCFS: r.historicPorCFS,
        ceilingApplied: r.ceilingApplied,
    };
}

function runClient(E, base) {
    const f = structuredClone(base);
    f.data._mult = { mult: E.model.getFlowMultiplier(f.data[GAUGES.lf].q).mult };
    E.store.setData(f.data);
    E.store.setPorHistory(f.porHistory);
    E.store.setGfLearningData(f.gfLearningData ?? null);
    E.store.setEdwardsFerryData(f.edwardsFerryData ?? { current: null, history: [], correlation: null });
    E.store.setWaterTempC(f.waterTempC ?? null);
    return E.estimateGreatFalls();
}

function runServer(E, base) {
    const f = structuredClone(base);
    // v36.0: the server now END-APPLIES the EMA correction too, so it must receive the same
    // correction bins the client reads. Without this the server would stay raw while the client
    // is corrected, and Δcfs would WIDEN instead of narrowing to the C19 ensemble residual.
    return E.makeGFPrediction(
        { gauges: GAUGES, data: f.data }, f.porHistory, f.waterTempC ?? null,
        f.gfLearningData?.correctionBins ?? {}
    );
}

// Compare the apples-to-apples fields the two sides share.
function divergence(c, s) {
    if (!c || !s) return { client: !!c, server: !!s, comparable: false };
    return {
        comparable: true,
        cfsDelta: c.cfs - s.predictedCFS,
        stageDelta: round2(c.stage - s.predictedStage),
        flowStateMatch: c.flowState === s.flowState,
        flowBinMatch: c.flowBin === s.flowBin,
        useTimeShiftedMatch: c.useTimeShifted === s.useTimeShifted,
        useEfEnsembleMatch: c.useEfEnsemble === s.useEfEnsemble,
        clientFlowState: c.flowState,
        serverFlowState: s.flowState,
    };
}

// ── Run everything once (deterministic: Date.now frozen to NOW) ────────────────
const E = await loadEstimators();

const RESULTS = [];
const realNow = Date.now;
try {
    Date.now = () => NOW;
    for (const fx of FIXTURES) {
        const base = fx.build();
        const client = runClient(E, base);
        const server = runServer(E, base);
        const c = snapClient(client);
        const s = snapServer(server);
        RESULTS.push({ name: fx.name, desc: fx.desc, expectResult: fx.expectResult, client: c, server: s, divergence: divergence(c, s) });
    }
} finally {
    Date.now = realNow;
}

const SNAPSHOT = Object.fromEntries(RESULTS.map((r) => [r.name, { client: r.client, server: r.server }]));

function writeReport() {
    const lines = [];
    lines.push('# Client vs Server Divergence Report (Phase-0 characterization)');
    lines.push('');
    lines.push(`Generated by \`test/characterization/gf-characterization.test.mjs\`. Inputs frozen at NOW=${NOW}.`);
    lines.push('Captures CURRENT behavior of the two duplicated estimators on identical inputs — the baseline a refactor must preserve, and the evidence for the Tier-3 "which side is canonical?" decision.');
    lines.push('');
    lines.push('| Fixture | Client cfs | Server cfs | Δcfs | Client state | Server state | state✓ | bin✓ |');
    lines.push('|---|--:|--:|--:|---|---|:--:|:--:|');
    for (const r of RESULTS) {
        const d = r.divergence;
        if (!d.comparable) {
            lines.push(`| ${r.name} | ${r.client ? r.client.cfs : '—'} | ${r.server ? r.server.predictedCFS : '—'} | n/a | ${r.client?.flowState ?? '—'} | ${r.server?.flowState ?? '—'} | — | — |`);
            continue;
        }
        lines.push(`| ${r.name} | ${r.client.cfs} | ${r.server.predictedCFS} | ${d.cfsDelta >= 0 ? '+' : ''}${d.cfsDelta} | ${d.clientFlowState} | ${d.serverFlowState} | ${d.flowStateMatch ? '✓' : '✗'} | ${d.flowBinMatch ? '✓' : '✗'} |`);
    }
    lines.push('');
    lines.push('## Notes');
    lines.push('- Δcfs = client.cfs − server.predictedCFS. As of v36.0 BOTH sides end-apply the EMA correction via the shared applyGFCorrection helper (byte-equal — see correction-parity.test.mjs), so the correction no longer contributes to Δcfs. Remaining nonzero Δcfs is the C19 ensemble residual only: flow-state classification and historic-PoR selection differences between the two implementations.');
    lines.push('- EF hysteresis is neutralized in fixtures (short EF history → multiplier 1.0), so EF is apples-to-apples here; production EF hysteresis is an additional client-only divergence not exercised by this report.');
    lines.push('- This report is descriptive, not a pass/fail. The pass/fail guard is `baseline.json`.');
    lines.push('');
    for (const r of RESULTS) {
        lines.push(`### ${r.name}`);
        lines.push(`*${r.desc}*`);
        lines.push('```json');
        lines.push(JSON.stringify({ client: r.client, server: r.server, divergence: r.divergence }, null, 2));
        lines.push('```');
        lines.push('');
    }
    writeFileSync(REPORT, lines.join('\n'));
}

describe('GF characterization: client vs server on identical inputs', () => {
    before(() => {
        if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true });
        writeReport(); // always refresh the human-readable artifact
    });

    it('every fixture produced a result from both estimators (no crash)', () => {
        for (const r of RESULTS) {
            if (!r.expectResult) continue;
            assert.ok(r.client, `client estimateGreatFalls returned null for fixture "${r.name}"`);
            assert.ok(r.server, `server makeGFPrediction returned null for fixture "${r.name}"`);
        }
    });

    it('matches the committed baseline (writes it on first run)', () => {
        if (!existsSync(BASELINE)) {
            if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true });
            writeFileSync(BASELINE, JSON.stringify(SNAPSHOT, null, 2) + '\n');
            console.log(`\n  ▸ baseline captured: ${BASELINE} (${RESULTS.length} fixtures)`);
            console.log(`  ▸ divergence report: ${REPORT}\n`);
            return; // first run establishes the safety net
        }
        const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
        assert.deepEqual(SNAPSHOT, baseline,
            'Estimator output drifted from baseline. If intentional, delete snapshots/baseline.json to re-capture.');
    });

    // One assertion per fixture so drift points at the offending case.
    for (const r of RESULTS) {
        it(`baseline stable: ${r.name}`, () => {
            if (!existsSync(BASELINE)) return; // first run handled above
            const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
            assert.deepEqual({ client: r.client, server: r.server }, baseline[r.name],
                `Output for "${r.name}" drifted from baseline.`);
        });
    }

    // v36.0 (C1): both estimators now END-APPLY the EMA correction via the shared helper, so on
    // these (EF-neutralized, clean-history) fixtures the DISPLAYED model equals the VALIDATED model.
    // Before C1 two fixtures had flowBinMatch:false and `with-learning-correction` diverged by ~863
    // cfs. A change that reintroduces client/server divergence trips this. Genuine C19 ensemble
    // residuals (production EF hysteresis / noisy localStorage history) are out of scope here.
    for (const r of RESULTS) {
        if (!r.expectResult || !r.client || !r.server) continue;
        it(`client == server end-apply parity: ${r.name}`, () => {
            assert.equal(r.client.cfs, r.server.predictedCFS, `cfs parity broke for "${r.name}"`);
            assert.equal(r.client.flowBin, r.server.flowBin, `flowBin parity broke for "${r.name}"`);
        });
    }
});

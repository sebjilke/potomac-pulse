// C19 — client/server ENSEMBLE parity.
//
// The GF nowcast is computed twice from the same inputs: client `estimateGreatFalls()`
// (src/estimation/great-falls.js, the browser display path) and server `makeGFPrediction()`
// (netlify/functions/scheduled-update.js, the cron learn/validate path). v36.0 made the two
// END-APPLY the SAME EMA correction via a shared helper, so the displayed estimate is meant to
// equal the validated one. The existing characterization snapshot (test/characterization/) only
// asserts client/server equality on `cfs` and `flowBin`; the rest of the ensemble internals
// (the time-shifted historic-PoR selection, the EF blend weight, the pre-ensemble PoR+tribs
// estimate, the correction, the ceiling flag) are snapshotted but NOT asserted equal across the
// two implementations. This file closes that gap.
//
// TWO TIERS, because the two estimators are NOT byte-identical by construction:
//
//   TIER 1 — STRICT PARITY on DENSE clean history. With sub-hourly, glitch-free PoR history the
//   two implementations agree on EVERY comparable ensemble field. This is the real guarantee: the
//   duplicated ensemble logic (great-falls.js vs scheduled-update.js) stays in lock-step, and the
//   shared correction helper carries through the full pipeline. A drift in either copy trips this.
//
//   TIER 2 — CHARACTERIZED DIVERGENCE on HOURLY history. The flow-state classifiers are
//   deliberately different: the client requires >=3 readings in a 90-min window
//   (robustCurrentReading, rise-rate-robust.mjs) before it will call a trend, so on hourly-spaced
//   history it returns null -> 'steady'; the server only needs >=8 entries and a reading <=6h old
//   (getFlowState, shared/model.js) so it still classifies the true trend. Same data, different
//   answer. This tier PINS that known divergence so it can't change silently (see the flow-state
//   learning-gate backlog item). It is a characterization, not a spec: if a future change unifies
//   the two classifiers, update this tier rather than assume a regression.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadEstimators } from './characterization/harness.mjs';
import { GAUGES, NOW } from './characterization/fixtures.mjs';

const HOUR = 3_600_000;
const round2 = (x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x);

// Clean PoR series at `cadenceMin` cadence over the trailing 7h (default), ascending by ts.
// cfs(h) = current - perHourDelta*h  → perHourDelta>0 rising, <0 falling, 0 steady. No glitches.
function porSeries(current, perHourDelta, cadenceMin = 10, spanHours = 7) {
    const pts = [];
    for (let m = 0; m <= spanHours * 60; m += cadenceMin) {
        const h = m / 60;
        pts.push({ timestamp: NOW - h * HOUR, cfs: Math.round(current - perHourDelta * h), stage: null });
    }
    return pts.sort((a, b) => a.timestamp - b.timestamp);
}
// EF state with a single-entry history → trend null → hysteresis multiplier 1.0, so the client EF
// formula matches the server's (no client-only hysteresis divergence). Mirrors the char fixtures.
function efState(stage) {
    return { current: { stage, timestamp: NOW }, history: [{ stage, timestamp: NOW }], correlation: null };
}
function baseData({ por, lf, lfH, mon, goose, broadRun, seneca, efStage }) {
    return {
        '01638500': { q: por, h: null },
        '01646500': { q: lf, h: lfH },
        '01643000': { q: mon },
        '01644000': { q: goose },
        '01644280': { q: broadRun },
        '01645000': { q: seneca },
        '01644148': { h: efStage },
    };
}

const E = await loadEstimators();

// Run the CLIENT estimator (mirrors test/characterization runClient — same store wiring + _mult).
function runClient(base) {
    const f = structuredClone(base);
    f.data._mult = { mult: E.model.getFlowMultiplier(f.data[GAUGES.lf].q).mult };
    E.store.setData(f.data);
    E.store.setPorHistory(f.porHistory);
    E.store.setGfLearningData(f.gfLearningData ?? null);
    E.store.setEdwardsFerryData(f.edwardsFerryData ?? { current: null, history: [], correlation: null });
    E.store.setWaterTempC(f.waterTempC ?? null);
    return E.estimateGreatFalls();
}
// Run the SERVER predictor with the SAME correction bins the client reads (v36.0 end-apply parity).
function runServer(base) {
    const f = structuredClone(base);
    return E.makeGFPrediction(
        { gauges: GAUGES, data: f.data }, f.porHistory, f.waterTempC ?? null,
        f.gfLearningData?.correctionBins ?? {}
    );
}

// The comparable ensemble fields and where each side exposes them. Client splits "inputs" off the
// top-level result; the server is flat. correction: client `inputs.correction` == server
// `correctionApplied`; final cfs: client `cfs` == server `predictedCFS` (both corrected, v36.0).
const FIELDS = [
    ['flowState',      (c) => c.flowState,                (s) => s.flowState],
    ['flowBin',        (c) => c.inputs?.flowBin,          (s) => s.flowBin],
    ['porEstimateCFS', (c) => c.inputs?.porEstimateCFS,   (s) => s.porEstimateCFS],
    ['historicPorCFS', (c) => c.inputs?.historicPorCFS,   (s) => s.historicPorCFS],
    ['useTimeShifted', (c) => c.useTimeShifted,           (s) => s.useTimeShifted],
    ['useEfEnsemble',  (c) => c.useEfEnsemble,            (s) => s.useEfEnsemble],
    ['efWeight',       (c) => round2(c.efWeight),         (s) => round2(s.efWeight)],
    ['correction',     (c) => c.inputs?.correction,       (s) => s.correctionApplied],
    ['ceilingApplied', (c) => c.inputs?.ceilingApplied,   (s) => s.ceilingApplied],
    ['finalCFS',       (c) => c.cfs,                      (s) => s.predictedCFS],
];

// Freeze Date.now so the relative-time history lookups on both sides resolve deterministically.
function withFrozenNow(fn) {
    const real = Date.now;
    try { Date.now = () => NOW; return fn(); }
    finally { Date.now = real; }
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1 — strict parity on DENSE clean history
// ─────────────────────────────────────────────────────────────────────────────

// Four flow levels straddling the EF-weight ramp (≈0 at low flow → ~40% at high) and every
// correction flow-bin cutpoint, each in all three flow states. lf≈por, tribs scaled, warm water.
const LEVELS = [
    { name: 'low',      por: 2400,  lf: 2500,  lfH: 2.85, mon: 200,  goose: 90,  broadRun: 20,  seneca: 25,  efStage: 2.6 },
    { name: 'normal',   por: 4800,  lf: 5000,  lfH: 3.35, mon: 400,  goose: 180, broadRun: 40,  seneca: 50,  efStage: 3.5 },
    { name: 'elevated', por: 13000, lf: 12000, lfH: 3.92, mon: 900,  goose: 400, broadRun: 90,  seneca: 110, efStage: 5.2 },
    { name: 'high',     por: 22000, lf: 25000, lfH: 5.30, mon: 1500, goose: 700, broadRun: 150, seneca: 200, efStage: 7.6 },
];
const STATES = [
    { name: 'steady',  delta: () => 0 },
    { name: 'rising',  delta: (cur) => cur * 0.06 },   // +6%/h → unambiguous rising on dense history
    { name: 'falling', delta: (cur) => -cur * 0.06 },
];

function assertFullParity(label, base) {
    const { c, s } = withFrozenNow(() => ({ c: runClient(base), s: runServer(base) }));
    assert.ok(c, `client returned null for ${label}`);
    assert.ok(s, `server returned null for ${label}`);
    // Guard against a vacuous all-null "match".
    assert.ok(c.cfs > 0 && s.predictedCFS > 0, `degenerate estimate for ${label}`);
    for (const [name, cf, sf] of FIELDS) {
        const cv = cf(c), sv = sf(s);
        assert.deepEqual(cv, sv, `${label} :: ${name} diverged — client=${cv} server=${sv}`);
    }
}

describe('C19 Tier 1 — full ensemble parity on dense clean history', () => {
    for (const lvl of LEVELS) {
        for (const st of STATES) {
            it(`${lvl.name}/${st.name}: every ensemble field matches client↔server`, () => {
                assertFullParity(`${lvl.name}/${st.name}`, {
                    data: baseData(lvl),
                    porHistory: porSeries(lvl.por, st.delta(lvl.por)),
                    waterTempC: 18,
                    gfLearningData: null,
                    edwardsFerryData: efState(lvl.efStage),
                });
            });
        }
    }

    it('cold water (≤10°C): cold EF coefficients applied identically on both sides', () => {
        const lvl = LEVELS[1]; // normal
        assertFullParity('cold/steady', {
            data: baseData(lvl),
            porHistory: porSeries(lvl.por, 0),
            waterTempC: 5,
            gfLearningData: null,
            edwardsFerryData: efState(lvl.efStage),
        });
    });

    it('populated EMA bin: correction carries through the full ensemble identically (v36.0)', () => {
        const lvl = LEVELS[1]; // normal, raw lands in 3000-6000
        const base = {
            data: baseData(lvl),
            porHistory: porSeries(lvl.por, 0),
            waterTempC: 18,
            gfLearningData: { correctionBins: { '3000-6000': { steady: { count: 12, meanError: 900, emaMeanError: 900, sumErrorSq: 10_200_000 } } } },
            edwardsFerryData: efState(lvl.efStage),
        };
        const { c, s } = withFrozenNow(() => ({ c: runClient(base), s: runServer(base) }));
        // Correction is non-trivial AND applied byte-identically; corrected display == validated.
        assert.notEqual(s.correctionApplied, 0, 'expected a non-zero correction for this bin');
        assert.equal(c.inputs.correction, s.correctionApplied, 'correction diverged');
        assert.equal(c.cfs, s.predictedCFS, 'corrected (displayed) cfs != server corrected cfs');
        // The corrected value really moved off the raw by the correction (no accidental no-op).
        assert.equal(s.rawFinalCFS - s.predictedCFS, s.correctionApplied, 'server raw−corrected != correction');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// TIER 2 — characterized flow-state divergence on HOURLY history
// ─────────────────────────────────────────────────────────────────────────────
// SAME steep-rising scenario, two cadences. Dense → both classify 'rising' (parity). Hourly over
// 12h (13 entries: comfortably above the server's >=8 gate, with a clean reading at the 6h mark) →
// the client's 90-min/>=3-point current-reading window holds only 2 hourly points, so it returns a
// null rise-rate and falls back to 'steady', while the server still reads the trend as 'rising'.
// This is the dominant "C19 ensemble residual": flow-state classification, surfaced by sampling
// cadence (NOT by glitches — the named glitch-history char fixture does not actually diverge).
describe('C19 Tier 2 — flow-state classifier divergence is cadence-driven (characterization)', () => {
    const lvl = { por: 22000, lf: 25000, lfH: 5.30, mon: 1500, goose: 700, broadRun: 150, seneca: 200, efStage: 7.6 };
    const steepRise = 1320; // +6%/h on 22k

    it('DENSE (10-min) steep rise → client and server agree: rising', () => {
        const base = { data: baseData(lvl), porHistory: porSeries(22000, steepRise, 10), waterTempC: 18, gfLearningData: null, edwardsFerryData: efState(lvl.efStage) };
        const { c, s } = withFrozenNow(() => ({ c: runClient(base), s: runServer(base) }));
        assert.equal(c.flowState, 'rising');
        assert.equal(s.flowState, 'rising');
    });

    it('HOURLY (60-min) steep rise → client under-detects (steady) while server sees rising', () => {
        const base = { data: baseData(lvl), porHistory: porSeries(22000, steepRise, 60, 12), waterTempC: 18, gfLearningData: null, edwardsFerryData: efState(lvl.efStage) };
        const { c, s } = withFrozenNow(() => ({ c: runClient(base), s: runServer(base) }));
        // The documented, intentional divergence. If you unify the two classifiers, update this test.
        assert.equal(s.flowState, 'rising', 'server should still classify the hourly trend as rising');
        assert.equal(c.flowState, 'steady', 'client falls back to steady when <3 readings fit the 90-min window');
        assert.notEqual(c.flowState, s.flowState, 'this tier exists to pin that the two CAN disagree on cadence alone');
    });
});

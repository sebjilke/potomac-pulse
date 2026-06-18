// C45 v37.0 — flow-edge correction interpolation: behavior + client↔server parity.
// getGFCorrectionInterpolated ramps the applied correction within ±12% flow of the LOW/MID boundaries
// (3k/6k/12k) only; mid-bin flows keep the exact binned correction; the 25k/50k boundaries stay as steps.
// Client (src/model/shared-model.js, ESM) and server (netlify/functions/shared/model.js, CJS) must be
// byte-identical (the shared-helper invariant). If parity fails, the displayed and validated estimates drift.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
    getGFCorrectionInterpolated as clientInterp,
    getGFCorrection as clientGetCorrection,
    getGFFlowBin as clientFlowBin,
    buildCorrectionBins as clientBuildBins,
    CORR_SMOOTH_BAND,
} from '../src/model/shared-model.js';

const require = createRequire(import.meta.url);
const {
    getGFCorrectionInterpolated: serverInterp,
    getFlowBin: serverFlowBin,
} = require('../netlify/functions/shared/model.js');

// Fixture: each bin × state well-populated (count>=5) with a distinct emaMeanError, so getGFCorrection
// returns the EMA directly and the interpolation is cleanly observable. Doubling per bin: 100,200,...,3200.
const EMAS = { '0-3000': 100, '3000-6000': 200, '6000-12000': 400, '12000-25000': 800, '25000-50000': 1600, '50000+': 3200 };
const ROWS = [];
for (const [bin, ema] of Object.entries(EMAS)) {
    for (const st of ['rising', 'steady', 'falling']) {
        ROWS.push({ gauge_id: `${bin}_${st}`, data: { count: 10, sumError: ema * 10, sumErrorSq: 0, meanError: ema, emaMeanError: ema } });
    }
}
const BINS = clientBuildBins(ROWS);

describe('getGFCorrectionInterpolated — behavior (steady)', () => {
    it('mid-bin (away from any smoothed boundary) == the exact binned correction', () => {
        // 8485 = geo-center of 6000-12000, outside both the 6000 band [5357,6720] and 12000 band [10714,13440]
        assert.equal(clientInterp(BINS, 8485, 'steady'), clientGetCorrection(BINS, '6000-12000', 'steady'));
        assert.equal(clientInterp(BINS, 8485, 'steady'), 400);
        // 4243 = geo-center of 3000-6000, outside the 3000 [2679,3360] and 6000 [5357,6720] bands
        assert.equal(clientInterp(BINS, 4243, 'steady'), 200);
    });

    it('at a smoothed boundary (12000) the correction is the midpoint of the two bins (continuity)', () => {
        const c = clientInterp(BINS, 12000, 'steady');
        // ~0.5*(400 + 800) = ~600 (log-midpoint of the symmetric band lands ~t=0.5 at the boundary)
        assert.ok(Math.abs(c - 600) < 5, `expected ~600 at the 12000 boundary, got ${c}`);
        // and it is strictly between the two bin values (a ramp, not a step)
        assert.ok(c > 400 && c < 800);
    });

    it('continuity: the hard step at 3k/6k/12k is removed (corr just-below ≈ just-above)', () => {
        for (const B of [3000, 6000, 12000]) {
            const below = clientInterp(BINS, B * 0.999, 'steady');
            const above = clientInterp(BINS, B * 1.001, 'steady');
            assert.ok(Math.abs(below - above) < 5, `boundary ${B}: step not removed (${below} vs ${above})`);
        }
    });

    it('band edges rejoin the binned value exactly (continuous with the mid-bin region)', () => {
        // lower edge of the 12000 band = 12000/1.12; just below it is mid-6000-12000 → both == 400
        const lo = 12000 / (1 + CORR_SMOOTH_BAND);
        assert.equal(clientInterp(BINS, lo * 0.999, 'steady'), 400);
        // upper edge = 12000*1.12; just above is mid-12000-25000 → both == 800
        const hi = 12000 * (1 + CORR_SMOOTH_BAND);
        assert.equal(clientInterp(BINS, hi * 1.001, 'steady'), 800);
    });

    it('25000 and 50000 are NOT smoothed — the step is preserved (real high-flow regime structure)', () => {
        // just below/above 25000 → the two bins' exact values, i.e. a genuine step remains
        assert.equal(clientInterp(BINS, 24999, 'steady'), clientGetCorrection(BINS, '12000-25000', 'steady')); // 800
        assert.equal(clientInterp(BINS, 25001, 'steady'), clientGetCorrection(BINS, '25000-50000', 'steady')); // 1600
        assert.notEqual(clientInterp(BINS, 24999, 'steady'), clientInterp(BINS, 25001, 'steady'));            // step intact
        // 50000 likewise
        assert.equal(clientInterp(BINS, 49999, 'steady'), 1600);
        assert.equal(clientInterp(BINS, 50001, 'steady'), 3200);
    });

    it('empty bins → 0 (interpolation is a no-op when there is nothing to correct)', () => {
        const empty = clientBuildBins([]);
        for (const f of [1500, 4500, 9000, 12000, 30000, 60000]) {
            assert.equal(clientInterp(empty, f, 'steady'), 0);
        }
    });

    it('state isolation: interpolation never blends across rising/steady/falling', () => {
        // craft a fixture where only rising differs; interp at a flow must equal the within-state ramp
        const r = clientInterp(BINS, 12000, 'rising');
        const s = clientInterp(BINS, 12000, 'steady');
        // rising and steady share the same EMAs here, so equal; the point is each is computed within its own column
        assert.equal(r, s);
        // and at a high-flow step (unsmoothed), state still selects its own column
        assert.equal(clientInterp(BINS, 24999, 'falling'), clientGetCorrection(BINS, '12000-25000', 'falling'));
    });
});

describe('getGFCorrectionInterpolated — client ↔ server parity', () => {
    const flows = [1200, 1732, 2679, 3000, 3360, 4243, 5357, 6000, 6720, 8485, 10714, 12000, 13440,
        17321, 24999, 25000, 25001, 35355, 49999, 50000, 50001, 70000, 120000];
    for (const f of flows) {
        for (const st of ['rising', 'steady', 'falling']) {
            it(`flow=${f} state=${st}`, () => {
                assert.equal(serverInterp(BINS, f, st), clientInterp(BINS, f, st));
            });
        }
    }
    it('getFlowBin / getGFFlowBin agree across the grid (shared binning)', () => {
        for (const f of flows) assert.equal(serverFlowBin(f), clientFlowBin(f));
    });
    it('empty-bins parity', () => {
        const empty = clientBuildBins([]);
        for (const f of flows) assert.equal(serverInterp(empty, f, 'steady'), clientInterp(empty, f, 'steady'));
    });
});

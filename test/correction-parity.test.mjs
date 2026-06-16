// Correction-application parity (v36.0, C1).
// The client (src/model/shared-model.js, ESM) and server (netlify/functions/shared/model.js, CJS)
// must apply the EMA correction byte-identically — that is the whole point of the shared helper.
// This test imports BOTH copies and asserts equal output across a grid that straddles every flow
// cutpoint plus a binding-ceiling case. If it fails, the two model implementations have drifted.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
    applyGFCorrection as clientApply,
    getGFCorrection as clientGetCorrection,
    buildCorrectionBins as clientBuildBins,
} from '../src/model/shared-model.js';

const require = createRequire(import.meta.url);
const {
    applyGFCorrection: serverApply,
    getGFCorrection: serverGetCorrection,
    buildCorrectionBins: serverBuildBins,
    CEILING_RATIO,
} = require('../netlify/functions/shared/model.js');

// Sample DB rows mirroring observation_type='gf_correction_bin'. Includes a <5-count bin
// (exercises the hierarchical blend), a stage_* row (must be skipped), and a non-vocab row.
const ROWS = [
    { gauge_id: '0-3000_steady',     data: { count: 10, sumError: 1800, sumErrorSq: 360000, meanError: 180, emaMeanError: 200 } },
    { gauge_id: '3000-6000_rising',  data: { count: 4,  sumError: 3099, sumErrorSq: 2400000, meanError: 775, emaMeanError: 789 } },
    { gauge_id: '6000-12000_falling',data: { count: 17, sumError: 3933, sumErrorSq: 1500000, meanError: 231, emaMeanError: 401 } },
    { gauge_id: '25000-50000_rising',data: { count: 13, sumError: 31514, sumErrorSq: 9e8,    meanError: 2424, emaMeanError: 3273 } },
    { gauge_id: 'stage_6000-12000_steady', data: { count: 9, emaMeanError: 0.07 } }, // separate series — must be ignored
    { gauge_id: 'garbage_key',       data: { count: 5, emaMeanError: 999 } },         // non-vocab — must be ignored
];

describe('buildCorrectionBins parity + stage_ skipping', () => {
    it('client and server build identical bin structures', () => {
        assert.deepEqual(clientBuildBins(ROWS), serverBuildBins(ROWS));
    });
    it('skips stage_* and non-vocab rows; seeds all 18 cells', () => {
        const bins = serverBuildBins(ROWS);
        assert.equal(Object.keys(bins).length, 6);
        assert.ok(!('stage' in bins) && !('garbage' in bins));
        // stage_6000-12000_steady must NOT have overwritten the real 6000-12000/steady seed
        assert.equal(bins['6000-12000'].steady.count, 0);
        assert.equal(bins['6000-12000'].falling.count, 17); // the real row landed
    });
    it('handles null/empty rows without throwing', () => {
        assert.deepEqual(clientBuildBins(null), serverBuildBins(null));
        assert.deepEqual(clientBuildBins([]), serverBuildBins([]));
    });
});

const BINS = serverBuildBins(ROWS);

const RAW_GRID = [1000, 2999, 3000, 3001, 5999, 6000, 11999, 12000, 24999, 25000, 49999, 50000, 60000];
const STATES = ['rising', 'steady', 'falling'];
const LF_GRID = [0, 2500, 10000, 45000]; // 0 → no ceiling; 2500 → forces ceiling at high raw

describe('applyGFCorrection client/server byte-equality across the grid', () => {
    for (const rawFinalUnclipped of RAW_GRID) {
        for (const flowState of STATES) {
            for (const lfCFS of LF_GRID) {
                it(`raw=${rawFinalUnclipped} state=${flowState} lf=${lfCFS}`, () => {
                    const args = { rawFinalUnclipped, lfCFS, correctionBins: BINS, flowState };
                    const c = clientApply(args);
                    const s = serverApply(args);
                    assert.deepEqual(c, s);
                });
            }
        }
    }
});

describe('getGFCorrection client/server byte-equality', () => {
    for (const bin of Object.keys(BINS)) {
        for (const state of STATES) {
            it(`${bin}/${state}`, () => {
                assert.equal(clientGetCorrection(BINS, bin, state), serverGetCorrection(BINS, bin, state));
            });
        }
    }
});

describe('end-apply unit-gain + ceiling-guard semantics', () => {
    it('no ceiling: correctedFinal === rawFinalUnclipped − correction (unit gain)', () => {
        const raw = 8000;
        const r = serverApply({ rawFinalUnclipped: raw, lfCFS: 0, correctionBins: BINS, flowState: 'falling' });
        assert.equal(r.ceilingApplied, false);
        assert.equal(r.correctedFinal, raw - r.correction);
        assert.equal(r.correctedFinalUnclipped, raw - r.correction);
    });
    it('unit gain holds regardless of efWeight (correction is applied AFTER the ensemble)', () => {
        // d(correctedFinal)/d(correction) = -1: bumping the bin EMA by +500 drops corrected by exactly 500.
        const raw = 30000;
        const base = serverApply({ rawFinalUnclipped: raw, lfCFS: 0, correctionBins: BINS, flowState: 'rising' });
        const bumped = JSON.parse(JSON.stringify(BINS));
        bumped['25000-50000'].rising.emaMeanError += 500;
        const after = serverApply({ rawFinalUnclipped: raw, lfCFS: 0, correctionBins: bumped, flowState: 'rising' });
        assert.equal(base.correctedFinal - after.correctedFinal, 500);
    });
    it('ceiling binds: correctedFinal === lfCFS × CEILING_RATIO and flag set', () => {
        const r = serverApply({ rawFinalUnclipped: 40000, lfCFS: 2500, correctionBins: BINS, flowState: 'steady' });
        assert.equal(r.ceilingApplied, true);
        assert.equal(r.correctedFinal, 2500 * CEILING_RATIO);
    });
    it('bin used for the correction is the bin of the UNCLIPPED raw final (apply-bin == learn-bin)', () => {
        const r = serverApply({ rawFinalUnclipped: 26000, lfCFS: 2500, correctionBins: BINS, flowState: 'rising' });
        assert.equal(r.flowBin, '25000-50000'); // off raw=26000, NOT off the clipped 3000
    });
});

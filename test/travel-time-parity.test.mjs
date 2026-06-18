// Travel-time + historic-reading-selection parity (C8, v36.4).
// The client travel helpers (src/model/shared-model.js, ESM) and the server copies
// (netlify/functions/shared/model.js, CJS) must be byte-identical, and selectHistoricReading
// (src/estimation/rise-rate-robust.mjs, ESM ↔ server copy) likewise. This test imports BOTH
// copies and asserts equal output. If it fails, the travel-time / lookup logic has drifted —
// which would re-open the displayed-vs-validated divergence C8 closed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
    getPoRtoGFTravelTime as clientPoRtoGF,
    getGFtoLFTravelTime as clientGFtoLF,
    getFlowMultiplier as clientFlowMult,
} from '../src/model/shared-model.js';
import {
    selectHistoricReading as clientSelect,
    medianCfs as clientMedian,
} from '../src/estimation/rise-rate-robust.mjs';

const require = createRequire(import.meta.url);
const {
    getPoRtoGFTravelTime: serverPoRtoGF,
    getGFtoLFTravelTime: serverGFtoLF,
    getFlowMultiplier: serverFlowMult,
    selectHistoricReading: serverSelect,
    medianCfs: serverMedian,
    POR_HISTORY_MAX_AGE,
} = require('../netlify/functions/shared/model.js');

// NOTE: getFlowMultiplier deliberately differs in RETURN SHAPE — client returns an
// object {flow,mult,cond,travelHrs}, server returns a bare scalar. The travel helpers on
// both sides take a SCALAR mult, so we drive them with scalars and unwrap the client object.

describe('travel-time helper parity (client ↔ server)', () => {
    // Grid of scalar mults straddling the flow range + rise-rate states incl. the 0.30 cap.
    const MULTS = [0.4, 0.624, 1.0, 1.5, 2.0, 2.608];
    const RISE = [
        null,
        { flowState: 'steady', ratePerHour: 0 },
        { flowState: 'falling', ratePerHour: -5 },
        { flowState: 'rising', ratePerHour: 0 },      // ratePerHour not >0 → no reduction
        { flowState: 'rising', ratePerHour: 3 },      // 6% reduction
        { flowState: 'rising', ratePerHour: 8 },      // 16% reduction
        { flowState: 'rising', ratePerHour: 20 },     // would be 40% → capped at 30%
    ];

    for (const m of MULTS) {
        for (const r of RISE) {
            const tag = `mult=${m} rise=${r ? r.flowState + '/' + r.ratePerHour : 'null'}`;
            it(`getPoRtoGFTravelTime ${tag}`, () => {
                const c = clientPoRtoGF(m, r);
                const s = serverPoRtoGF(m, r);
                assert.equal(s, c);
                assert.ok(Number.isFinite(s), 'server travel time must be finite');
            });
            it(`getGFtoLFTravelTime ${tag}`, () => {
                assert.equal(serverGFtoLF(m, r), clientGFtoLF(m, r));
            });
        }
    }

    it('rising-cap engages identically at high ratePerHour (>15%/hr → 30% cap)', () => {
        const r = { flowState: 'rising', ratePerHour: 50 };
        // 50*0.02 = 1.0 → capped at 0.30 → ×0.70 on both sides.
        assert.equal(serverPoRtoGF(2.0, r), clientPoRtoGF(2.0, r));
        assert.equal(serverPoRtoGF(2.0, r), 19.4 * 2.0 * 0.70);
    });

    it('seed mult matches: client getFlowMultiplier(x).mult === server getFlowMultiplier(x)', () => {
        for (const q of [1000, 4940, 11000, 35000, 80000]) {
            assert.equal(serverFlowMult(q), clientFlowMult(q).mult);
            assert.ok(Number.isFinite(serverFlowMult(q)));
        }
    });
});

describe('selectHistoricReading parity (client ↔ server)', () => {
    const now = 1700000000000;
    const mk = (hoursAgo, cfs) => ({ cfs, stage: 4.0, timestamp: now - hoursAgo * 3600000 });

    const cases = {
        'empty history': [],
        'single within window': [mk(12, 9000)],
        'closest of several': [mk(10, 8000), mk(12, 9000), mk(14, 10000)],
        'none within 1h of target': [mk(40, 5000), mk(60, 5200)], // target=12h → nothing within 1h
        'three candidates, one +50% glitch dropped': [
            mk(11.5, 9000), mk(12, 13500), mk(12.5, 9100), // 13500 is >40% off median(9100) → dropped
        ],
        'exact-timestamp tie': [mk(12, 9000), mk(12, 9000)],
        'zero/negative cfs filtered': [mk(12, 0), mk(11.8, -5), mk(12.2, 9000)],
    };

    for (const [name, hist] of Object.entries(cases)) {
        it(name, () => {
            const target = now - 12 * 3600000;
            const c = clientSelect(hist, target);
            const s = serverSelect(hist, target);
            assert.deepEqual(s, c);
        });
    }

    it('medianCfs parity', () => {
        for (const entries of [[], [mk(1, 100)], [mk(1, 100), mk(2, 300)], [mk(1, 100), mk(2, 200), mk(3, 900)]]) {
            assert.equal(serverMedian(entries), clientMedian(entries));
        }
    });
});

describe('C16 retention covers max travel', () => {
    it('72h retention > PoR→GF travel at the 1000-cfs floor', () => {
        const maxTravel = serverPoRtoGF(serverFlowMult(1000), null); // no rise reduction = longest
        assert.ok(maxTravel < POR_HISTORY_MAX_AGE / 3600000,
            `max travel ${maxTravel.toFixed(1)}h must be < retention ${(POR_HISTORY_MAX_AGE / 3600000)}h`);
        assert.equal(POR_HISTORY_MAX_AGE, 72 * 60 * 60 * 1000);
    });
});

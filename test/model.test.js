const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

const {
    GF_FLOW_BINS, getFlowBin,
    estimateLFFlowFromStage,
    TRAVEL_COEF, TRAVEL_EXP, MEDIAN_TRAVEL, TRAVEL_POR_GF_BASELINE, TRAVEL_GF_LF_BASELINE,
    EF_MODEL,
    getEFWeight, getFlowMultiplier, getFlowState,
    CEILING_RATIO, DECAY_CAP,
    TRIB_FALLBACK,
    getBinCorrection, getFallbackCorrection,
    isExistingPredictionReplaceable, VALIDATION_MAX_DELAY_MS
} = require('../netlify/functions/shared/model');

// ─── isExistingPredictionReplaceable (C12 deadlock fix) ─────────────────────────
// A truthy-but-unparseable validationDue used to make a pending row un-replaceable
// forever (Invalid Date is truthy; now - InvalidDate is NaN; NaN > MAX is false).
describe('isExistingPredictionReplaceable', () => {
    const now = Date.parse('2026-06-16T12:00:00.000Z');

    it('future due date → not replaceable', () => {
        assert.equal(isExistingPredictionReplaceable({ validationDue: '2026-06-16T13:00:00.000Z' }, now), false);
    });
    it('1h past due (within 2.5h window) → not replaceable', () => {
        assert.equal(isExistingPredictionReplaceable({ validationDue: '2026-06-16T11:00:00.000Z' }, now), false);
    });
    it('3h past due (beyond window) → replaceable', () => {
        assert.equal(isExistingPredictionReplaceable({ validationDue: '2026-06-16T09:00:00.000Z' }, now), true);
    });
    it('exactly at the window boundary → not replaceable (not strictly greater)', () => {
        const dueIso = new Date(now - VALIDATION_MAX_DELAY_MS).toISOString();
        assert.equal(isExistingPredictionReplaceable({ validationDue: dueIso }, now), false);
    });
    it('missing validationDue → replaceable', () => {
        assert.equal(isExistingPredictionReplaceable({}, now), true);
    });
    it('null/undefined existingData → replaceable', () => {
        assert.equal(isExistingPredictionReplaceable(null, now), true);
        assert.equal(isExistingPredictionReplaceable(undefined, now), true);
    });
    it('truthy-but-unparseable validationDue → replaceable (the deadlock case)', () => {
        assert.equal(isExistingPredictionReplaceable({ validationDue: 'not-a-date' }, now), true);
        assert.equal(isExistingPredictionReplaceable({ validationDue: 'Invalid Date' }, now), true);
    });
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe('Constants', () => {
    it('TRAVEL_COEF is the Searcy adjusted coefficient', () => {
        assert.equal(TRAVEL_COEF, 4139);
    });

    it('TRAVEL_EXP is the Searcy exponent', () => {
        assert.equal(TRAVEL_EXP, -0.5963);
    });

    it('MEDIAN_TRAVEL is 25.8 hours', () => {
        assert.equal(MEDIAN_TRAVEL, 25.8);
    });

    it('TRAVEL_POR_GF_BASELINE and TRAVEL_GF_LF_BASELINE sum close to MEDIAN_TRAVEL', () => {
        assert.equal(TRAVEL_POR_GF_BASELINE, 19.4);
        assert.equal(TRAVEL_GF_LF_BASELINE, 6.5);
        assert.ok(Math.abs(TRAVEL_POR_GF_BASELINE + TRAVEL_GF_LF_BASELINE - MEDIAN_TRAVEL) < 0.1);
    });

    it('CEILING_RATIO is 1.20', () => {
        assert.equal(CEILING_RATIO, 1.20);
    });

    it('DECAY_CAP is 0.50', () => {
        assert.equal(DECAY_CAP, 0.50);
    });

    it('TRIB_FALLBACK has the correct keys and values', () => {
        assert.deepEqual(Object.keys(TRIB_FALLBACK).sort(), ['broadRun', 'goose', 'monocacy', 'seneca']);
        assert.equal(TRIB_FALLBACK.monocacy, 0.071);
        assert.equal(TRIB_FALLBACK.goose, 0.030);
        assert.equal(TRIB_FALLBACK.broadRun, 0.0066);
        assert.equal(TRIB_FALLBACK.seneca, 0.0087);
    });

    it('EF_MODEL has correct structure and values', () => {
        assert.equal(EF_MODEL.coef, 126);
        assert.equal(EF_MODEL.exp, 2.46);
        assert.equal(EF_MODEL.coldCoef, 160);
        assert.equal(EF_MODEL.coldExp, 2.36);
        assert.equal(EF_MODEL.coldMaxTemp, 10);
        assert.equal(EF_MODEL.minStage, 2.5);
        assert.equal(EF_MODEL.maxStage, 20.0);
    });

    it('GF_FLOW_BINS has 6 bins', () => {
        assert.equal(GF_FLOW_BINS.length, 6);
        assert.deepEqual(GF_FLOW_BINS, [
            '0-3000', '3000-6000', '6000-12000',
            '12000-25000', '25000-50000', '50000+'
        ]);
    });
});

// ─── getFlowBin ───────────────────────────────────────────────────────────────

describe('getFlowBin', () => {
    it('returns 0-3000 for flow = 0', () => {
        assert.equal(getFlowBin(0), '0-3000');
    });

    it('returns 0-3000 for flow = 2999', () => {
        assert.equal(getFlowBin(2999), '0-3000');
    });

    it('returns 3000-6000 for flow = 3000', () => {
        assert.equal(getFlowBin(3000), '3000-6000');
    });

    it('returns 6000-12000 for flow = 6000', () => {
        assert.equal(getFlowBin(6000), '6000-12000');
    });

    it('returns 12000-25000 for flow = 12000', () => {
        assert.equal(getFlowBin(12000), '12000-25000');
    });

    it('returns 25000-50000 for flow = 25000', () => {
        assert.equal(getFlowBin(25000), '25000-50000');
    });

    it('returns 50000+ for flow = 50000', () => {
        assert.equal(getFlowBin(50000), '50000+');
    });

    it('returns 50000+ for flow = 200000', () => {
        assert.equal(getFlowBin(200000), '50000+');
    });
});

// ─── estimateLFFlowFromStage ──────────────────────────────────────────────────

describe('estimateLFFlowFromStage', () => {
    it('returns 0 for stage below 2.40', () => {
        assert.equal(estimateLFFlowFromStage(2.0), 0);
        assert.equal(estimateLFFlowFromStage(2.39), 0);
    });

    it('returns 0 at exactly 2.40', () => {
        assert.equal(estimateLFFlowFromStage(2.40), 0);
    });

    it('returns 600 at stage 2.46', () => {
        const flow = estimateLFFlowFromStage(2.46);
        assert.ok(Math.abs(flow - 600) < 1, `Expected ~600, got ${flow}`);
    });

    it('returns 1300 at stage 2.69', () => {
        const flow = estimateLFFlowFromStage(2.69);
        assert.ok(Math.abs(flow - 1300) < 1, `Expected ~1300, got ${flow}`);
    });

    it('interpolates within a segment (midpoint of first segment)', () => {
        const flow = estimateLFFlowFromStage(2.43);  // midpoint of 2.40-2.46
        assert.ok(flow > 0 && flow < 600, `Expected between 0 and 600, got ${flow}`);
        assert.ok(Math.abs(flow - 300) < 1, `Expected ~300, got ${flow}`);
    });

    it('returns 5000 at stage 3.35', () => {
        const flow = estimateLFFlowFromStage(3.35);
        assert.ok(Math.abs(flow - 5000) < 1, `Expected ~5000, got ${flow}`);
    });

    it('returns 10000 at stage 3.95', () => {
        const flow = estimateLFFlowFromStage(3.95);
        assert.ok(Math.abs(flow - 10000) < 5, `Expected ~10000, got ${flow}`);
    });

    it('returns 50000 at stage 6.79', () => {
        const flow = estimateLFFlowFromStage(6.79);
        assert.ok(Math.abs(flow - 50000) < 5, `Expected ~50000, got ${flow}`);
    });

    it('handles high stage above 10.93', () => {
        const flow = estimateLFFlowFromStage(12.0);
        assert.ok(flow > 150000, `Expected > 150000, got ${flow}`);
    });

    it('is monotonically increasing across all breakpoints', () => {
        const stages = [2.40, 2.46, 2.69, 2.83, 2.96, 3.09, 3.16, 3.23, 3.35, 3.46, 3.67, 3.95, 4.29, 5.50, 6.79, 8.36, 10.93, 12.0];
        for (let i = 1; i < stages.length; i++) {
            const prev = estimateLFFlowFromStage(stages[i - 1]);
            const curr = estimateLFFlowFromStage(stages[i]);
            assert.ok(curr > prev, `Stage ${stages[i]} (${curr}) should be > stage ${stages[i-1]} (${prev})`);
        }
    });
});

// ─── getEFWeight ──────────────────────────────────────────────────────────────

describe('getEFWeight', () => {
    it('returns 0 for flow below 1000', () => {
        assert.equal(getEFWeight(0), 0);
        assert.equal(getEFWeight(500), 0);
        assert.equal(getEFWeight(999), 0);
    });

    it('returns small positive weight just above 1000', () => {
        const w = getEFWeight(1001);
        assert.ok(w > 0, `Expected > 0, got ${w}`);
        assert.ok(w < 0.1, `Expected < 0.1, got ${w}`);
    });

    it('returns ~0.20 at midpoint 10000 cfs', () => {
        const w = getEFWeight(10000);
        assert.ok(Math.abs(w - 0.20) < 0.01, `Expected ~0.20, got ${w}`);
    });

    it('approaches but never exceeds W_MAX of 0.40', () => {
        const w100k = getEFWeight(100000);
        assert.ok(w100k > 0.35, `Expected > 0.35, got ${w100k}`);
        assert.ok(w100k <= 0.40, `Expected <= 0.40, got ${w100k}`);

        const w500k = getEFWeight(500000);
        assert.ok(w500k <= 0.40, `Expected <= 0.40, got ${w500k}`);
    });

    it('is monotonically increasing above 1000', () => {
        const flows = [1000, 2000, 5000, 10000, 20000, 50000, 100000];
        for (let i = 1; i < flows.length; i++) {
            const prev = getEFWeight(flows[i - 1]);
            const curr = getEFWeight(flows[i]);
            assert.ok(curr >= prev, `Weight at ${flows[i]} (${curr}) should be >= weight at ${flows[i-1]} (${prev})`);
        }
    });
});

// ─── getFlowMultiplier ────────────────────────────────────────────────────────

describe('getFlowMultiplier', () => {
    it('returns approximately 1.0 at median flow', () => {
        // MEDIAN_TRAVEL = TRAVEL_COEF * medianFlow^TRAVEL_EXP
        // Solve for medianFlow: medianFlow = (MEDIAN_TRAVEL / TRAVEL_COEF)^(1/TRAVEL_EXP)
        const medianFlow = Math.pow(MEDIAN_TRAVEL / TRAVEL_COEF, 1 / TRAVEL_EXP);
        const mult = getFlowMultiplier(medianFlow);
        assert.ok(Math.abs(mult - 1.0) < 0.01, `Expected ~1.0, got ${mult}`);
    });

    it('returns > 1 for low flows (slow travel)', () => {
        const mult = getFlowMultiplier(2000);
        assert.ok(mult > 1, `Expected > 1, got ${mult}`);
    });

    it('returns < 1 for high flows (fast travel)', () => {
        const mult = getFlowMultiplier(50000);
        assert.ok(mult < 1, `Expected < 1, got ${mult}`);
    });

    it('clamps flow at 1000 minimum', () => {
        const multAt500 = getFlowMultiplier(500);
        const multAt1000 = getFlowMultiplier(1000);
        assert.equal(multAt500, multAt1000, 'Flows below 1000 should clamp to 1000');
    });

    it('returns positive values', () => {
        assert.ok(getFlowMultiplier(3000) > 0);
        assert.ok(getFlowMultiplier(50000) > 0);
    });
});

// ─── getFlowState ─────────────────────────────────────────────────────────────

describe('getFlowState', () => {
    it('returns steady for null history', () => {
        assert.equal(getFlowState(null, 5000), 'steady');
    });

    it('returns steady for empty history', () => {
        assert.equal(getFlowState([], 5000), 'steady');
    });

    it('returns steady for short history (< 8 entries)', () => {
        const history = Array.from({ length: 7 }, (_, i) => ({
            timestamp: Date.now() - i * 60 * 60 * 1000,
            cfs: 5000
        }));
        assert.equal(getFlowState(history, 5000), 'steady');
    });

    it('detects rising flow', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        const now = 1700000000000;
        t.mock.timers.setTime(now);

        const sixHoursAgo = now - 6 * 60 * 60 * 1000;
        const history = Array.from({ length: 10 }, (_, i) => ({
            timestamp: sixHoursAgo - (9 - i) * 15 * 60 * 1000,
            cfs: 3000 + i * 100
        }));

        // Current CFS is much higher than 6hrs-ago reading
        assert.equal(getFlowState(history, 5000), 'rising');
    });

    it('detects falling flow', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        const now = 1700000000000;
        t.mock.timers.setTime(now);

        const sixHoursAgo = now - 6 * 60 * 60 * 1000;
        const history = Array.from({ length: 10 }, (_, i) => ({
            timestamp: sixHoursAgo - (9 - i) * 15 * 60 * 1000,
            cfs: 8000 - i * 100
        }));

        assert.equal(getFlowState(history, 5000), 'falling');
    });

    it('returns steady when change is below threshold', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        const now = 1700000000000;
        t.mock.timers.setTime(now);

        const sixHoursAgo = now - 6 * 60 * 60 * 1000;
        const history = Array.from({ length: 10 }, (_, i) => ({
            timestamp: sixHoursAgo - (9 - i) * 15 * 60 * 1000,
            cfs: 10000
        }));

        // 10050 vs 10000 = 50 cfs change, below max(100, 10000*0.02=200)
        assert.equal(getFlowState(history, 10050), 'steady');
    });

    it('uses 2% threshold for high flows', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        const now = 1700000000000;
        t.mock.timers.setTime(now);

        const sixHoursAgo = now - 6 * 60 * 60 * 1000;
        const history = Array.from({ length: 10 }, (_, i) => ({
            timestamp: sixHoursAgo - (9 - i) * 15 * 60 * 1000,
            cfs: 20000
        }));

        // 20150 vs 20000 = 150 cfs. Threshold = max(100, 20000*0.02=400) = 400.
        // 150 < 400, so still steady
        assert.equal(getFlowState(history, 20150), 'steady');

        // 20500 vs 20000 = 500 > 400, so rising
        assert.equal(getFlowState(history, 20500), 'rising');
    });

    it('uses 100 cfs minimum threshold for low flows', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        const now = 1700000000000;
        t.mock.timers.setTime(now);

        const sixHoursAgo = now - 6 * 60 * 60 * 1000;
        const history = Array.from({ length: 10 }, (_, i) => ({
            timestamp: sixHoursAgo - (9 - i) * 15 * 60 * 1000,
            cfs: 2000
        }));

        // 2050 vs 2000 = 50 cfs. Threshold = max(100, 2000*0.02=40) = 100.
        // 50 < 100, so steady
        assert.equal(getFlowState(history, 2050), 'steady');

        // 2150 vs 2000 = 150 > 100, so rising
        assert.equal(getFlowState(history, 2150), 'rising');
    });

    it('returns steady when no past reading exists before 6hrs ago', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        const now = 1700000000000;
        t.mock.timers.setTime(now);

        // All readings are within the last hour (after sixHoursAgo)
        const history = Array.from({ length: 10 }, (_, i) => ({
            timestamp: now - (9 - i) * 5 * 60 * 1000,
            cfs: 5000
        }));

        assert.equal(getFlowState(history, 8000), 'steady');
    });

    it('selects past reading from before the 6h cutoff, not after', (t) => {
        // Locks in the 6h window: a reading 4h old must NOT be the past reading
        // (it falls inside the cutoff), and a reading 7h old MUST be selected.
        // This test would have caught the v34 bug where the window was 2h.
        t.mock.timers.enable({ apis: ['Date'] });
        const now = 1700000000000;
        t.mock.timers.setTime(now);

        const sevenHoursAgo = now - 7 * 60 * 60 * 1000;
        const fourHoursAgo  = now - 4 * 60 * 60 * 1000;

        // 8 readings before the 6h cutoff (anchor cluster, cfs=10000) +
        // 4 readings after the 6h cutoff (recent cluster, cfs=10500). If the
        // function correctly uses 6h, past=10000, current=10000 → steady.
        // If a buggy 2h or 4h window were in effect, past would come from the
        // recent cluster (10500), and the comparison would be wrong.
        const history = [
            ...Array.from({ length: 8 }, (_, i) => ({
                timestamp: sevenHoursAgo - (7 - i) * 15 * 60 * 1000,
                cfs: 10000
            })),
            ...Array.from({ length: 4 }, (_, i) => ({
                timestamp: fourHoursAgo + i * 30 * 60 * 1000,
                cfs: 10500
            })),
        ];

        // current matches the 7h-ago anchor → steady under 6h rule
        assert.equal(getFlowState(history, 10000), 'steady');

        // current is well above the 7h-ago anchor → rising (change=500, threshold=max(100, 10500*0.02)=210)
        assert.equal(getFlowState(history, 10500), 'rising');

        // current well below the 7h-ago anchor → falling
        assert.equal(getFlowState(history, 9500), 'falling');
    });
});

// ─── Hierarchical Correction Fallback (v35.1) ───────────────────────────────

describe('getBinCorrection', () => {
    it('returns emaMeanError when present', () => {
        assert.equal(getBinCorrection({ emaMeanError: -50, meanError: -30, count: 10 }), -50);
    });

    it('falls back to meanError when emaMeanError is absent', () => {
        assert.equal(getBinCorrection({ meanError: -30, count: 10 }), -30);
    });

    it('returns 0 when no error values', () => {
        assert.equal(getBinCorrection({ count: 10 }), 0);
    });
});

describe('getFallbackCorrection', () => {
    const makeBin = (count, ema) => ({ count, emaMeanError: ema });

    it('Tier 1: pools across states within same flow bin', () => {
        const bins = {
            '0-3000': {
                rising: makeBin(10, -100),
                steady: makeBin(20, -200),
            }
        };
        // weighted avg: (10*-100 + 20*-200) / 30 = -5000/30 ≈ -166.67
        const result = getFallbackCorrection(bins, '0-3000', 'falling');
        assert.ok(Math.abs(result - (-5000 / 30)) < 0.01);
    });

    it('Tier 1: ignores states with <5 observations', () => {
        const bins = {
            '3000-6000': {
                rising: makeBin(3, -100),
                steady: makeBin(10, -200),
            }
        };
        assert.equal(getFallbackCorrection(bins, '3000-6000', 'falling'), -200);
    });

    it('Tier 2: falls back to adjacent bin when no states qualify in same bin', () => {
        const bins = {
            '0-3000': { rising: makeBin(2, -50) },
            '3000-6000': { rising: makeBin(10, -120) }
        };
        assert.equal(getFallbackCorrection(bins, '0-3000', 'rising'), -120);
    });

    it('Tier 2: prefers lower neighbor', () => {
        const bins = {
            '0-3000': { rising: makeBin(10, -100) },
            '3000-6000': {},
            '6000-12000': { rising: makeBin(10, -300) }
        };
        assert.equal(getFallbackCorrection(bins, '3000-6000', 'rising'), -100);
    });

    it('Tier 2: uses upper neighbor when lower has no data', () => {
        const bins = {
            '0-3000': {},
            '3000-6000': { steady: makeBin(10, -200) }
        };
        assert.equal(getFallbackCorrection(bins, '0-3000', 'steady'), -200);
    });

    it('Tier 2: falls back to steady in adjacent bin', () => {
        const bins = {
            '0-3000': { steady: makeBin(10, -150) },
            '3000-6000': {}
        };
        assert.equal(getFallbackCorrection(bins, '3000-6000', 'rising'), -150);
    });

    it('Tier 3: returns 0 on total cold start', () => {
        assert.equal(getFallbackCorrection({}, '0-3000', 'rising'), 0);
    });

    it('Tier 3: returns 0 when all bins are sparse', () => {
        const bins = {
            '0-3000': { rising: makeBin(2, -50), steady: makeBin(3, -60) },
            '3000-6000': { falling: makeBin(1, -10) }
        };
        assert.equal(getFallbackCorrection(bins, '0-3000', 'falling'), 0);
    });

    it('handles first bin (no lower neighbor)', () => {
        const bins = {
            '0-3000': {},
            '3000-6000': { rising: makeBin(10, -200) }
        };
        assert.equal(getFallbackCorrection(bins, '0-3000', 'rising'), -200);
    });

    it('handles last bin (no upper neighbor)', () => {
        const bins = {
            '25000-50000': { steady: makeBin(8, -500) },
            '50000+': {}
        };
        assert.equal(getFallbackCorrection(bins, '50000+', 'steady'), -500);
    });
});

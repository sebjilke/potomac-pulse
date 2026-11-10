import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { isIcePlausible, ICE_CHECK, classifyOutlier, OUTLIER, updateCorrectionBin } = require('../netlify/functions/shared/model');

const JULY = Date.UTC(2026, 6, 15, 12);
const JANUARY = Date.UTC(2027, 0, 15, 12);

describe('isIcePlausible (v37.21, anomaly Check 3 gate)', () => {
    it('exports the documented constant', () => {
        assert.deepEqual(ICE_CHECK, { maxTempC: 5, coldMonths: [10, 11, 0, 1, 2] });
    });

    for (const [temp, want] of [[26, false], [5.0, true], [5.01, false], [0, true], [-0.5, true]]) {
        it(`temp ${temp} -> plausible ${want}, basis temp (month ignored)`, () => {
            assert.deepEqual(isIcePlausible(temp, JULY), { plausible: want, basis: 'temp' });
            assert.deepEqual(isIcePlausible(temp, JANUARY), { plausible: want, basis: 'temp' });
        });
    }

    for (const [label, v] of [['null', null], ['undefined', undefined], ['NaN', NaN]]) {
        it(`${label} temp falls back to the month proxy`, () => {
            assert.deepEqual(isIcePlausible(v, JULY), { plausible: false, basis: 'month' });
            assert.deepEqual(isIcePlausible(v, JANUARY), { plausible: true, basis: 'month' });
        });
    }

    for (const [month, want] of [[9, false], [10, true], [2, true], [3, false]]) {
        it(`month index ${month} (unknown temp) -> ${want}`, () => {
            assert.equal(isIcePlausible(null, Date.UTC(2026, month, 15, 12)).plausible, want);
        });
    }

    it('uses UTC months: 2026-11-01T03:00Z is November, 2026-10-31T23:59:59Z is October', () => {
        assert.equal(isIcePlausible(null, Date.parse('2026-11-01T03:00:00Z')).plausible, true);
        assert.equal(isIcePlausible(null, Date.parse('2026-10-31T23:59:59Z')).plausible, false);
    });
});

// ── v39.0: classifyOutlier (anomaly Check 5, always-soft) ────────────────────────────────────────
// A bin with count 20, lifetime mean 0 and sd exactly 100 (sumErrorSq = 20 * 100^2).
const binOf = (over = {}) => ({ count: 20, sumError: 0, meanError: 0, sumErrorSq: 20 * 100 * 100, emaMeanError: 0, ...over });

describe('classifyOutlier (v39.0, anomaly Check 5)', () => {
    it('exports the documented constant', () => {
        assert.deepEqual(OUTLIER, { zThreshold: 3 });
    });

    it('count 9 -> not an outlier, z null (gate unchanged)', () => {
        assert.deepEqual(classifyOutlier(binOf({ count: 9, sumErrorSq: 9 * 10000 }), 100000), { zScore: null, isOutlier: false });
    });

    it('count 10 is evaluated (gate is >= 10)', () => {
        const r = classifyOutlier(binOf({ count: 10, sumErrorSq: 10 * 10000 }), 400);
        assert.equal(r.zScore, 4);
        assert.equal(r.isOutlier, true);
    });

    it('sd 0 -> no flag, z null', () => {
        assert.deepEqual(classifyOutlier(binOf({ sumErrorSq: 0 }), 5000), { zScore: null, isOutlier: false });
    });

    it('missing sumErrorSq / NaN stats / non-finite error -> { null, false }', () => {
        const noSq = binOf(); delete noSq.sumErrorSq;
        assert.deepEqual(classifyOutlier(noSq, 5000), { zScore: null, isOutlier: false });
        assert.deepEqual(classifyOutlier(binOf({ sumErrorSq: NaN }), 5000), { zScore: null, isOutlier: false });
        assert.deepEqual(classifyOutlier(binOf({ emaMeanError: NaN }), 5000), { zScore: null, isOutlier: false });
        assert.deepEqual(classifyOutlier(binOf({ emaMeanError: undefined, meanError: NaN }), 5000), { zScore: null, isOutlier: false });
        assert.deepEqual(classifyOutlier(binOf(), NaN), { zScore: null, isOutlier: false });
        assert.deepEqual(classifyOutlier(binOf(), Infinity), { zScore: null, isOutlier: false });
        assert.deepEqual(classifyOutlier(null, 100), { zScore: null, isOutlier: false });
    });

    it('z exactly 3 -> NOT an outlier (strict >); just over 3 -> outlier', () => {
        const at = classifyOutlier(binOf(), 300);
        assert.equal(at.zScore, 3);
        assert.equal(at.isOutlier, false);
        const over = classifyOutlier(binOf(), 300.5);
        assert.equal(over.isOutlier, true);
        assert.ok(over.zScore > 3);
    });

    it('symmetric in sign', () => {
        assert.equal(classifyOutlier(binOf(), -450).isOutlier, true);
        assert.equal(classifyOutlier(binOf(), -450).zScore, classifyOutlier(binOf(), 450).zScore);
    });

    it('the centre is the EMA: mean-centred z > 3 but EMA-centred z < 3', () => {
        // lifetime mean 0 (old centre), EMA +350: error 350 is 3.5 sd from the mean, 0 sd from the EMA
        const r = classifyOutlier(binOf({ emaMeanError: 350 }), 350);
        assert.equal(r.zScore, 0);
        assert.equal(r.isOutlier, false);
    });

    it('the centre is the EMA: mean-centred z < 3 but EMA-centred z > 3', () => {
        // error 100 is 1 sd from the lifetime mean 0 (old rule: no flag) but 4.5 sd from the EMA -350
        const r = classifyOutlier(binOf({ emaMeanError: -350 }), 100);
        assert.equal(r.zScore, 4.5);
        assert.equal(r.isOutlier, true);
    });

    it('emaMeanError undefined -> falls back to the lifetime mean', () => {
        const b = binOf({ meanError: 10, sumError: 200, sumErrorSq: 20 * (100 * 100 + 100) }); // sd = 100
        delete b.emaMeanError;
        const r = classifyOutlier(b, 410);
        assert.equal(r.zScore, 4);
        assert.equal(r.isOutlier, true);
    });

    it('emaMeanError === 0 is honoured (?? not ||): centre 0, not the lifetime mean', () => {
        const b = binOf({ meanError: 400, sumError: 8000, sumErrorSq: 20 * (100 * 100 + 400 * 400), emaMeanError: 0 }); // sd = 100
        const r = classifyOutlier(b, 400);
        assert.equal(r.zScore, 4);          // centred on 0; the || bug would centre on 400 -> z 0
        assert.equal(r.isOutlier, true);
    });

    it('does not mutate the bin', () => {
        const b = binOf({ emaMeanError: 12 });
        const before = JSON.stringify(b);
        classifyOutlier(b, 9999);
        assert.equal(JSON.stringify(b), before);
    });
});

// ── v39.0: replay of the October 2026 lock-out episode (frozen snapshot fixture) ─────────────────
const fx = JSON.parse(readFileSync(new URL('./fixtures/outlier-replay-2026-10.json', import.meta.url), 'utf8'));
const sdOf = (b) => Math.sqrt(Math.max(0, b.sumErrorSq / b.count - b.meanError * b.meanError));

describe('outlier replay, 2026-10-16..18 6000-12000_falling (v39.0, snapshot fixture)', () => {
    it('fixture is the documented non-reproducible snapshot with exactly ten rows in time order', () => {
        assert.equal(fx.fetchedAt, '2026-11-10');
        assert.match(fx.note, /NON-REPRODUCIBLE/);
        assert.ok(fx.sources.validationFailures.endsWith('?endpoint=validation-failures'));
        assert.ok(fx.sources.gf.endsWith('?endpoint=gf'));
        assert.equal(fx.fallingRows.length, 10);
        assert.equal(fx.fallingBin.stats.count, 17);
        assert.equal(fx.fallingBin.stats.emaMeanError, 401.15096838548686);
        const t = fx.fallingRows.map((r) => Date.parse(r.validatedAt));
        assert.deepEqual([...t].sort((a, b) => a - b), t);
    });

    it('ALL ten rows classify as outliers against the FROZEN bin (EMA centre) - the lock-out the old rule produced', () => {
        for (const r of fx.fallingRows) {
            const c = classifyOutlier(fx.fallingBin.stats, r.errorCFS);
            assert.equal(c.isOutlier, true, `${r.validatedAt} z=${c.zScore}`);
        }
    });

    it('fed sequentially (soft only when classified an outlier): EMA falls strictly from +401, bounded steps, later rows stop being outliers', () => {
        const b = { ...fx.fallingBin.stats };
        let prevEma = b.emaMeanError;
        let outliers = 0;
        const sdTrail = [sdOf(b)];
        for (const r of fx.fallingRows) {
            const c = classifyOutlier(b, r.errorCFS);
            const upd = updateCorrectionBin(b, r.errorCFS, c.isOutlier);
            if (c.isOutlier) {
                outliers++;
                assert.ok(Math.abs(b.emaMeanError - prevEma) <= 0.6 * upd.sdPre + 1e-9, 'outlier step <= 0.6*sdPre');
            } else {
                assert.ok(Math.abs(b.emaMeanError - prevEma) <= 0.9 * upd.sdPre + 1e-9, 'non-outlier step <= 0.9*sdPre');
            }
            assert.ok(b.emaMeanError < prevEma, `EMA strictly decreases: ${prevEma} -> ${b.emaMeanError}`);
            prevEma = b.emaMeanError;
            sdTrail.push(sdOf(b));
        }
        assert.equal(outliers, 2, 'only the first two rows stay outliers once the bin starts moving');
        assert.ok(b.emaMeanError < 0, 'the bin has left its stale +401');
        assert.ok(sdTrail[sdTrail.length - 1] > sdTrail[0] * 2, 'lifetime sd grows');
        assert.equal(b.count, 27);
    });

    it('first row: step is exactly 0.6*sdPre', () => {
        const b = { ...fx.fallingBin.stats };
        const sd = sdOf(b);
        const r = updateCorrectionBin(b, fx.fallingRows[0].errorCFS, true);
        assert.ok(Math.abs((r.emaAfter - r.emaBefore) + 0.6 * sd) < 1e-9);
    });
});

describe('2026-10-12 local-runoff miss in 0-3000_rising (v39.0, snapshot fixture)', () => {
    it('classifies as an outlier; the new rule moves the bin by 0.6*sdPre (~261 cfs); the OLD post-stat rule moved it ~603 cfs', () => {
        const row = fx.risingRow;
        assert.equal(row.errorCFS, -4275);
        const b = { ...fx.risingBin.stats };
        const c = classifyOutlier(b, row.errorCFS);
        assert.equal(c.isOutlier, true);
        const sd = sdOf(b);
        const upd = updateCorrectionBin(b, row.errorCFS, true);
        const step = upd.emaAfter - upd.emaBefore;
        assert.ok(Math.abs(step + 0.6 * sd) < 1e-9);
        assert.ok(step > -262 && step < -260, `step=${step}`);
        // the old rule, re-derived inline from the documented formula (post-update stats, ||-recurrence)
        const o = { ...fx.risingBin.stats };
        const n1 = o.count + 1, sumE = o.sumError + row.errorCFS, sumSq = o.sumErrorSq + row.errorCFS ** 2, mean = sumE / n1;
        const oldSd = Math.sqrt(Math.max(0, sumSq / n1 - mean * mean));
        const oldLearn = Math.max(o.emaMeanError - 2 * oldSd, Math.min(o.emaMeanError + 2 * oldSd, row.errorCFS));
        const oldStep = (0.3 * oldLearn + 0.7 * o.emaMeanError) - o.emaMeanError;
        assert.ok(oldStep < -600 && oldStep > -606, `oldStep=${oldStep}`);
        assert.ok(Math.abs(step) < Math.abs(oldStep) / 2);
    });
});

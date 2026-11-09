import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isIcePlausible, ICE_CHECK } = require('../netlify/functions/shared/model');

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

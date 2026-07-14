// Potomac Pulse — validation-merge tests (v37.12)
//
// Guards the Prediction Accuracy (7d) chart's central invariant: hard-flagged validations
// (validation_failure log) are merged into the chart series but NEVER enter the headline
// average, and history entries pass through unmodified and unfiltered — the pre-v37.12
// metric must be reproducible byte-for-byte from the same history input.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mergeValidationReadings, summarizeValidations } from '../src/ui/validation-merge.js';

const NOW = Date.parse('2026-07-13T12:00:00Z');
const HOUR = 3600000;
const DAY = 24 * HOUR;

/** History row as storeValidationPair writes it (integer CFS, 0.1% error). */
function hist(hoursAgo, over = {}) {
    return {
        timestamp: NOW - hoursAgo * HOUR,
        predictedCFS: 5000, actualCFS: 5200, errorPercent: -3.8,
        flowBin: '3000-6000', flowState: 'steady', ...over
    };
}

/** validation_failure entry as the v37.9 log writes it (raw floats, ISO validatedAt). */
function fail(hoursAgo, over = {}) {
    return {
        validatedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
        predictedCFS: 5606.4, actualCFS: 8250.7, errorPercentCorrected: -32.049,
        errorPercentRaw: -27.5, flowBin: '3000-6000', flowState: 'steady',
        anomalyFlags: ['STATISTICAL_OUTLIER:z=13.2'], hardScore: 2, ...over
    };
}

describe('mergeValidationReadings', () => {
    it('tags and interleaves both sources in ascending time order', () => {
        const merged = mergeValidationReadings([hist(30), hist(10)], [fail(20)], NOW);
        assert.deepEqual(merged.map(r => r.hardFlagged), [false, true, false]);
        assert.deepEqual(merged.map(r => r.timestamp), [NOW - 30 * HOUR, NOW - 20 * HOUR, NOW - 10 * HOUR]);
    });

    it('passes history entries through with fields unmodified (headline reproducibility)', () => {
        const original = hist(10, { errorPercent: -12.4, predictedCFS: 1699 });
        const [out] = mergeValidationReadings([original], [], NOW);
        const { hardFlagged, ...fields } = out;
        assert.equal(hardFlagged, false);
        assert.deepEqual(fields, original);
    });

    it('does NOT time-filter history entries, even ones older than 7 days', () => {
        const merged = mergeValidationReadings([hist(10 * 24)], [], NOW);
        assert.equal(merged.length, 1);
    });

    it('windows failure entries to the last 7 days', () => {
        const merged = mergeValidationReadings([], [fail(6 * 24), fail(8 * 24)], NOW);
        assert.equal(merged.length, 1);
        assert.equal(merged[0].timestamp, NOW - 6 * DAY);
    });

    it('normalizes failure precision: integer CFS, error to 0.1', () => {
        const [out] = mergeValidationReadings([], [fail(1)], NOW);
        assert.equal(out.predictedCFS, 5606);
        assert.equal(out.actualCFS, 8251);
        assert.equal(out.errorPercent, -32.0);
        assert.deepEqual(out.anomalyFlags, ['STATISTICAL_OUTLIER:z=13.2']);
        assert.equal(out.hardFlagged, true);
    });

    it('derives errorPercent from pred/actual when errorPercentCorrected is missing', () => {
        const [out] = mergeValidationReadings([], [fail(1, { errorPercentCorrected: undefined, predictedCFS: 4000, actualCFS: 5000 })], NOW);
        assert.equal(out.errorPercent, -20);
    });

    it('skips malformed failure entries (bad date, non-finite CFS, null, zero-actual fallback)', () => {
        const merged = mergeValidationReadings([], [
            fail(1, { validatedAt: 'not-a-date' }),
            fail(1, { predictedCFS: 'NaN?' }),
            fail(1, { actualCFS: null }),
            null,
            fail(1, { errorPercentCorrected: undefined, actualCFS: 0 })
        ], NOW);
        assert.equal(merged.length, 0);
    });

    it('is input-order independent (server returns failures newest-first)', () => {
        const a = mergeValidationReadings([hist(5), hist(15)], [fail(1), fail(10)], NOW);
        const b = mergeValidationReadings([hist(15), hist(5)], [fail(10), fail(1)], NOW);
        assert.deepEqual(a.map(r => [r.timestamp, r.hardFlagged]), b.map(r => [r.timestamp, r.hardFlagged]));
    });

    it('breaks exact-timestamp ties deterministically: unflagged first', () => {
        const merged = mergeValidationReadings([hist(10)], [fail(10)], NOW);
        assert.deepEqual(merged.map(r => r.hardFlagged), [false, true]);
    });

    it('tolerates non-array inputs', () => {
        assert.deepEqual(mergeValidationReadings(null, undefined, NOW), []);
    });
});

describe('summarizeValidations', () => {
    it('averages |error| over unflagged only and counts flagged separately', () => {
        const merged = mergeValidationReadings(
            [hist(20, { errorPercent: -4.0 }), hist(10, { errorPercent: 8.0 })],
            [fail(15, { errorPercentCorrected: -32.0 })],
            NOW
        );
        const s = summarizeValidations(merged, NOW);
        assert.equal(s.unflaggedCount, 2);
        assert.equal(s.flaggedCount, 1);
        assert.equal(s.avgAbsErrorPct, 6.0);  // (4+8)/2 — the -32 flagged entry must not move this
        assert.equal(s.spanHours, 20);        // span from oldest UNFLAGGED entry
    });

    it('matches the pre-v37.12 headline exactly when no failures exist', () => {
        const readings = [hist(30, { errorPercent: 4.3 }), hist(20, { errorPercent: -12.4 }), hist(10, { errorPercent: 21.3 })];
        const legacyAvg = readings.reduce((s, r) => s + Math.abs(r.errorPercent), 0) / readings.length;
        const legacySpan = Math.round((NOW - readings[0].timestamp) / HOUR);
        const s = summarizeValidations(mergeValidationReadings(readings, [], NOW), NOW);
        assert.equal(s.avgAbsErrorPct, legacyAvg);
        assert.equal(s.spanHours, legacySpan);
        assert.equal(s.unflaggedCount, 3);
        assert.equal(s.flaggedCount, 0);
    });

    it('span ignores a flagged entry older than every unflagged one', () => {
        const merged = mergeValidationReadings([hist(10)], [fail(100)], NOW);
        const s = summarizeValidations(merged, NOW);
        assert.equal(s.spanHours, 10);
    });

    it('returns null avg/span when only flagged entries exist (no NaN)', () => {
        const s = summarizeValidations(mergeValidationReadings([], [fail(5), fail(10)], NOW), NOW);
        assert.deepEqual(s, { unflaggedCount: 0, flaggedCount: 2, avgAbsErrorPct: null, spanHours: null });
    });

    it('handles the empty series', () => {
        const s = summarizeValidations([], NOW);
        assert.deepEqual(s, { unflaggedCount: 0, flaggedCount: 0, avgAbsErrorPct: null, spanHours: null });
    });
});

// Potomac Pulse — pure helpers for the Prediction Accuracy (7d) chart (v37.12)
// Merges the rolling validation history (non-flagged validations) with the append-only
// validation_failure log (hard-flagged validations) into one chart-ready series.
// Pure module: no DOM, no fetch — unit-tested directly (test/validation-merge.test.mjs).

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Merges rolling validation-history readings with hard-flagged validation_failure entries
 * into a single ascending-time series for the accuracy chart.
 *
 * History entries pass through unmodified (plus hardFlagged:false) and are NOT time-filtered —
 * the headline metric over them must stay identical to the pre-v37.12 chart. Failure entries
 * are an unbounded newest-50 log, so they alone are windowed to the last 7 days.
 *
 * @param {Array<Object>} historyReadings - Rows from the validation-history endpoint
 *   ({timestamp (ms), predictedCFS, actualCFS, errorPercent, flowBin, flowState}).
 * @param {Array<Object>} failureEntries - Rows from the validation-failures endpoint
 *   ({validatedAt (ISO), predictedCFS, actualCFS, errorPercentCorrected, anomalyFlags, ...}).
 * @param {number} nowMs - Current time (ms epoch) anchoring the 7-day failure window.
 * @returns {Array<Object>} Ascending-time merged readings; failure-derived entries carry
 *   hardFlagged:true, integer CFS, errorPercent rounded to 0.1, and their anomalyFlags.
 */
export function mergeValidationReadings(historyReadings, failureEntries, nowMs) {
    const history = (Array.isArray(historyReadings) ? historyReadings : [])
        .map(r => ({ ...r, hardFlagged: false }));

    const cutoff = nowMs - WINDOW_MS;
    const flagged = (Array.isArray(failureEntries) ? failureEntries : [])
        .map(e => {
            if (!e) return null;
            const timestamp = Date.parse(e.validatedAt);
            const predictedCFS = Number(e.predictedCFS);
            const actualCFS = Number(e.actualCFS);
            // Positive-flow guard (not just isFinite): Number(null) is 0, and a silently
            // zero-cfs marker would be worse than a dropped row.
            if (!Number.isFinite(timestamp) || !(predictedCFS > 0) || !(actualCFS > 0)) return null;
            let errorPercent = Number(e.errorPercentCorrected);
            if (!Number.isFinite(errorPercent)) {
                errorPercent = ((predictedCFS - actualCFS) / actualCFS) * 100;
            }
            return {
                timestamp,
                predictedCFS: Math.round(predictedCFS),
                actualCFS: Math.round(actualCFS),
                errorPercent: Math.round(errorPercent * 10) / 10,
                flowBin: e.flowBin,
                flowState: e.flowState,
                anomalyFlags: Array.isArray(e.anomalyFlags) ? e.anomalyFlags : [],
                hardFlagged: true
            };
        })
        .filter(e => e && e.timestamp > cutoff);

    // Stable order: time ascending; on an exact tie the unflagged entry first (deterministic paths).
    return [...history, ...flagged].sort((a, b) =>
        a.timestamp - b.timestamp || (a.hardFlagged === b.hardFlagged ? 0 : (a.hardFlagged ? 1 : -1))
    );
}

/**
 * Computes the chart summary over a merged series: the headline average |error| and time span
 * cover ONLY unflagged validations (identical to the pre-v37.12 metric); flagged entries are
 * counted for disclosure but never enter the average.
 * @param {Array<Object>} merged - Output of mergeValidationReadings.
 * @param {number} nowMs - Current time (ms epoch) for the span computation.
 * @returns {{unflaggedCount: number, flaggedCount: number, avgAbsErrorPct: (number|null), spanHours: (number|null)}}
 *   avgAbsErrorPct/spanHours are null when there are no unflagged entries.
 */
export function summarizeValidations(merged, nowMs) {
    const unflagged = merged.filter(r => !r.hardFlagged);
    const flaggedCount = merged.length - unflagged.length;
    if (unflagged.length === 0) {
        return { unflaggedCount: 0, flaggedCount, avgAbsErrorPct: null, spanHours: null };
    }
    const avgAbsErrorPct = unflagged.reduce((s, r) => s + Math.abs(r.errorPercent), 0) / unflagged.length;
    const spanHours = Math.round((nowMs - unflagged[0].timestamp) / 3600000);
    return { unflaggedCount: unflagged.length, flaggedCount, avgAbsErrorPct, spanHours };
}

// Potomac Pulse: Great Falls card state (v39.7, display only)
// Pure: decides what the card should say before an estimate exists. Never changes the estimate.
// "unavailable" is reachable only after a fetch has settled, so the card cannot flash it during loading.

export const REASON_USGS = 'USGS data did not load.';
export const REASON_EF = 'Edwards Ferry data did not load.';
export const REASON_LF_POR = 'Little Falls or Point of Rocks readings are missing.';

/**
 * @param {Object} i
 * @param {boolean} i.learningReady - gfDataReady.
 * @param {boolean} i.efReady - Edwards Ferry data present.
 * @param {boolean} i.fetchSettled - At least one fetch has finished (any outcome).
 * @param {boolean} i.sourceUnavailable - dataSource is "unavailable" (USGS down, no cache).
 * @param {boolean} i.hasEstimate - An estimate was computed.
 * @param {boolean} i.iceIssue - No estimate because a critical gauge is ice-affected.
 * @returns {{kind: ('loading'|'unavailable'|'ice'|'ready'), text?: string}}
 */
export function gfCardState({ learningReady, efReady, fetchSettled, sourceUnavailable, hasEstimate, iceIssue }) {
    if (!learningReady) return { kind: 'loading', text: 'Loading corrections...' };
    if (!efReady) {
        if (!fetchSettled) return { kind: 'loading', text: 'Loading EF data...' };
        return { kind: 'unavailable', text: sourceUnavailable ? REASON_USGS : REASON_EF };
    }
    if (hasEstimate) return { kind: 'ready' };
    if (iceIssue) return { kind: 'ice' };
    if (!fetchSettled) return { kind: 'loading', text: 'Waiting for data...' };
    return { kind: 'unavailable', text: sourceUnavailable ? REASON_USGS : REASON_LF_POR };
}

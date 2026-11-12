// Potomac Pulse: forecast card display text (v39.8). Pure: no DOM, no browser globals.
// Display only. Nothing here may be written back to a forecast period: `p.cfs`, `p.stage` and `p.source`
// are posted for accuracy tracking (gf-learning.js storeForecastPredictions) and must stay exactly as computed.

/**
 * Rounds a forecast flow for display: to 10 cfs below 1,000, to 50 cfs below 5,000, to 100 cfs from 5,000 up.
 * @param {number} cfs
 * @returns {number}
 */
export function roundForecastCfs(cfs) {
    const step = cfs < 1000 ? 10 : cfs < 5000 ? 50 : 100;
    return Math.round(cfs / step) * step;
}

/**
 * Trend direction for a forecast card against the Now value. When both round to the same displayed flow the
 * answer is 'flat', so the arrow never points up or down beside two numbers that look the same or that read the
 * other way. Otherwise the raw values decide, as before.
 * @param {number} cfs - the card's raw flow.
 * @param {number} nowCfs - the raw Now flow.
 * @returns {'up'|'down'|'flat'}
 */
export function forecastTrend(cfs, nowCfs) {
    if (roundForecastCfs(cfs) === roundForecastCfs(nowCfs)) return 'flat';
    return cfs > nowCfs ? 'up' : (cfs < nowCfs ? 'down' : 'flat');
}

const TITLE_NWS = 'National Weather Service forecast (arrival time varies with flow)';
const TITLE_NWS_EF = 'National Weather Service forecast, blended with the Edwards Ferry forecast (arrival time varies with flow)';
const TITLE_TREND = 'No National Weather Service forecast available. A rough projection from the current estimate and the upstream reading.';

/**
 * Plain-language source for a forecast period's `source` value ('NWS', 'NWS+EF', 'extrapolated').
 * `text` is the one line shown under the cards; `title` is the longer hover text (also used on each card).
 * @param {string} source
 * @returns {{text: string, title: string}}
 */
export function forecastSourceLabel(source) {
    if (source === 'extrapolated') return { text: 'No Weather Service forecast. Rough projection.', title: TITLE_TREND };
    if (source === 'NWS+EF') return { text: 'Source: National Weather Service forecast', title: TITLE_NWS_EF };
    return { text: 'Source: National Weather Service forecast', title: TITLE_NWS };
}

/**
 * The single source line for the set of periods shown. 'extrapolated' wins only when every future period is
 * extrapolated; the hover text names the Edwards Ferry blend when any period used it.
 * @param {Array<{source?: string, isCurrent?: boolean}>} periods
 * @returns {{text: string, title: string}}
 */
export function forecastSourceLine(periods) {
    const future = periods.filter((p) => !p.isCurrent);
    if (future.length > 0 && future.every((p) => p.source === 'extrapolated')) return forecastSourceLabel('extrapolated');
    return forecastSourceLabel(future.some((p) => p.source === 'NWS+EF') ? 'NWS+EF' : 'NWS');
}

/**
 * Whether a graph tooltip point is a forecast point (rounded like the cards). History points and the pushed
 * "now" point stay exact, so a tapped Now card and its tooltip agree.
 * @param {{isHistory?: boolean, hrs: number}} d
 * @returns {boolean}
 */
export function isRoundedForecastPoint(d) {
    return !d.isHistory && d.hrs > 0;
}

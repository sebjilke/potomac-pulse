// Potomac Pulse - 120% cap indicator (v39.3, audit item A4a)
//
// Pure functions only: no DOM, no browser globals at module top level (same pattern as
// data-freshness.js and residual-advisory.js), so everything here is unit-tested under Node.
//
// The cap holds the displayed Great Falls number at 120% of the latest Little Falls reading.
// This module only DESCRIBES that fact. It trusts inputs.ceilingApplied and never recomputes
// the cap. It never feeds the estimate, the bins or the learning.
//
// Wording rule: the cap limits the display, not the river. Never call the shown number a limit
// on the flow. The real flow may be above the number shown, especially on a rising river.

import { OLD_MIN, bandFor, clock } from './data-freshness.js';

export const CAP_LEAD = 'Capped:';
export const CAP_HEADLINE = `${CAP_LEAD} the model reads higher than this.`;
export const CAP_LAG_CLAUSE = 'The real flow may be above the number shown, especially on a rising river, where Little Falls responds later.';
export const CAP_OLD_CLAUSE = `That Little Falls reading is over ${Math.round(OLD_MIN / 60)} h old.`;
export const ROW_NONE = '--';
export const ROW_EF_ONLY = 'N/A (Edwards Ferry only)';
export const ROW_NOT_ACTIVE = 'Not active';
export const ROW_ACTIVE = 'Active';
export const ROW_TIE = 'Active (changed it by under 1 cfs)';
export const CI_SUFFIX = ' (around the capped value)';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
// Same call as the big number on the card (gfEstimate.cfs.toLocaleString()), so the two cannot disagree.
const fmt = (n) => Math.round(n).toLocaleString();

/**
 * Formats a reading time as a local 24-hour clock time (the same call as the "not refreshed since"
 * header label in data-freshness.js), with a short date when it is not on the same local calendar
 * day as now.
 * @param {number} ms - Reading time in ms.
 * @param {number} nowMs - Current time in ms.
 * @returns {string} For example "14:40" or "Nov 9, 23:50".
 */
export function formatClock(ms, nowMs) {
    const d = new Date(ms);
    const clockText = clock(ms);
    const n = new Date(nowMs);
    const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    return sameDay ? clockText : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${clockText}`;
}

/**
 * Describes a binding cap. Call only when ceilingApplied is true.
 * @param {Object} i
 * @param {number} i.shownCFS - The cfs on screen.
 * @param {number} i.uncappedCFS - The model's value before the cap, rounded.
 * @param {number} i.ceilingLimitCFS - 120% of the Little Falls reading, rounded.
 * @param {number} i.lfCFS - The Little Falls reading used, rounded.
 * @param {(number|null)} i.lfReadMs - Time of that reading, ms.
 * @param {number} i.nowMs - Current time, ms.
 * @returns {{kind: string, line: (string|null), rowText: string}}
 *   kind "cut" (figures shown), "unknown" (figure missing or inconsistent, no number invented)
 *   or "tie" (the model value equals the shown value after rounding; note hidden). `line` is the one
 *   sentence group for the notice box (v39.8: it replaced the headline and the detail).
 */
export function describeCap({ shownCFS, uncappedCFS, ceilingLimitCFS, lfCFS, lfReadMs, nowMs }) {
    const ok = fin(shownCFS) && fin(uncappedCFS) && fin(ceilingLimitCFS) && fin(lfCFS) && lfCFS > 0
        && uncappedCFS >= shownCFS && ceilingLimitCFS === shownCFS;
    if (!ok) {
        return {
            kind: 'unknown',
            line: `${CAP_HEADLINE} The cfs and ft shown are held at 120% of the latest Little Falls reading. ${CAP_LAG_CLAUSE}`,
            rowText: ROW_ACTIVE
        };
    }
    if (uncappedCFS === shownCFS) {
        return { kind: 'tie', line: null, rowText: ROW_TIE };
    }
    const at = fin(lfReadMs) && fin(nowMs) ? ` at ${formatClock(lfReadMs, nowMs)}` : '';
    const old = fin(lfReadMs) && fin(nowMs) && nowMs >= lfReadMs && ['old', 'stale'].includes(bandFor((nowMs - lfReadMs) / 60000));
    const line = `${CAP_LEAD} the model estimates ${fmt(uncappedCFS)} cfs. The cfs and ft shown are held at ${fmt(shownCFS)} cfs, `
        + `120% of the latest Little Falls reading (${fmt(lfCFS)} cfs${at}). ${CAP_LAG_CLAUSE}`
        + (old ? ` ${CAP_OLD_CLAUSE}` : '');
    return { kind: 'cut', line, rowText: `Active (model said ${fmt(uncappedCFS)} cfs)` };
}

/**
 * Everything the page writes for the cap, for every case.
 * @param {(Object|null)} estimate - The gfEstimate object, or null when there is none (loading, no data).
 * @param {number} nowMs - Current time, ms.
 * @returns {{noteHidden: boolean, line: string, rowText: string, ciSuffix: string}}
 */
export function capView(estimate, nowMs) {
    const hidden = (rowText, ciSuffix = '') => ({ noteHidden: true, line: '', rowText, ciSuffix });
    if (!estimate) return hidden(ROW_NONE);
    if (estimate.efOnly) return hidden(ROW_EF_ONLY);
    const inp = estimate.inputs;
    if (!inp || inp.ceilingApplied !== true) return hidden(ROW_NOT_ACTIVE);
    const d = describeCap({
        shownCFS: estimate.cfs, uncappedCFS: inp.uncappedCFS, ceilingLimitCFS: inp.ceilingLimitCFS,
        lfCFS: inp.lfCFS, lfReadMs: inp.lfReadMs ?? null, nowMs
    });
    if (d.kind === 'tie') return hidden(d.rowText, CI_SUFFIX);
    return { noteHidden: false, line: d.line, rowText: d.rowText, ciSuffix: CI_SUFFIX };
}

/**
 * Text for the 90% CI row: the base range text plus the cap mark when the cap is active. Pure, so
 * the result does not depend on when the cap view was rendered relative to the row.
 * @param {string} baseText - The range text, for example "9,000 – 12,000 cfs", or "--" / "N/A".
 * @param {{ciSuffix: string}} view - From capView.
 * @returns {string} The row text. Unchanged when there is no range to mark.
 */
export function ciRowText(baseText, view) {
    if (!view || !view.ciSuffix || !baseText || baseText === '--' || /^N\/A/.test(baseText)) return baseText;
    return baseText + view.ciSuffix;
}

/**
 * Writes the inputs-panel row of a view onto an element-like object (a real DOM node in the page, a plain
 * object in tests). v39.8: the cap sentence no longer has its own elements; it goes into the single notice box
 * (estimate-notice.js). Always sets the row, so no state survives from a previous render. The 90% CI row is not
 * written here: the page builds that text with ciRowText.
 * @param {Object} view - From capView.
 * @param {Object} els - { row }, optional.
 */
export function applyCapView(view, els) {
    if (els.row) els.row.textContent = view.rowText;
}

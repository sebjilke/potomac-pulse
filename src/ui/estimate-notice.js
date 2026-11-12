// Potomac Pulse - the one notice box under the Great Falls confidence line (v39.8)
//
// Replaces the cap note and the two advisory boxes. Pure functions only: no DOM, no browser globals at module
// top level (same pattern as cap-indicator.js). It decides nothing about WHEN a note shows: the callers pass in
// what shouldShowDivergenceAdvisory, shouldShowResidualAdvisory and capView already decided.
//
// Order is always: cap line, Edwards Ferry line, Little Falls line, then the shared closing sentence. The
// closing sentence appears only when an advisory is on (not for the cap alone) and only once. Each line has a
// lead-in (shown in the amber title style) and a text; both are set with textContent, never as markup.

import { CAP_LEAD } from './cap-indicator.js';
import { DIVERGENCE_LEAD, DIVERGENCE_TEXT } from './divergence-advisory.js';
import { RESIDUAL_LEAD, RESIDUAL_TEXT } from './residual-advisory.js';

export const NOTICE_CLOSING = 'Treat this estimate with extra caution. If the river looks higher than the number, believe the river.';

const join = (lead, text) => (lead ? (text ? `${lead} ${text}` : lead) : '');

// Splits a cap line ("Capped: ...") into its lead-in and the rest. A line without the lead-in is all text.
function splitCap(line) {
    if (!line) return { lead: '', text: '' };
    if (line.startsWith(CAP_LEAD)) return { lead: CAP_LEAD, text: line.slice(CAP_LEAD.length).trim() };
    return { lead: '', text: line };
}

/**
 * What the notice box shows.
 * @param {{capLine?: string, divergence?: boolean, residual?: boolean}} i - capLine is capView().line when the cap
 *   note is active, else ''. divergence and residual are the two shouldShow* results.
 * @returns {{hidden: boolean, capLine: string, efLine: string, lfLine: string, closing: string,
 *   cap: {lead: string, text: string}, ef: {lead: string, text: string}, lf: {lead: string, text: string}}}
 *   The *Line fields are the whole line as one string ('' when not shown).
 */
export function noticeView({ capLine = '', divergence = false, residual = false } = {}) {
    const cap = splitCap(capLine);
    const ef = divergence ? { lead: DIVERGENCE_LEAD, text: DIVERGENCE_TEXT } : { lead: '', text: '' };
    const lf = residual ? { lead: RESIDUAL_LEAD, text: RESIDUAL_TEXT } : { lead: '', text: '' };
    const closing = divergence || residual ? NOTICE_CLOSING : '';
    const hidden = !capLine && !divergence && !residual;
    return {
        hidden, cap, ef, lf, closing,
        capLine: join(cap.lead, cap.text), efLine: join(ef.lead, ef.text), lfLine: join(lf.lead, lf.text)
    };
}

/**
 * Writes a view onto element-like objects (real DOM nodes in the page, plain objects in tests). Sets textContent
 * and hidden on EVERY element it is given, so nothing survives from a previous render.
 * @param {Object} view - From noticeView.
 * @param {Object} els - Each optional: box, cap, capLead, capText, ef, efLead, efText, lf, lfLead, lfText, closing.
 */
export function applyNoticeView(view, els) {
    const line = (row, lead, text, v) => {
        if (row) row.hidden = !(v.lead || v.text);
        if (lead) lead.textContent = v.lead;
        if (text) text.textContent = v.text;
    };
    if (els.box) els.box.hidden = view.hidden;
    line(els.cap, els.capLead, els.capText, view.cap);
    line(els.ef, els.efLead, els.efText, view.ef);
    line(els.lf, els.lfLead, els.lfText, view.lf);
    if (els.closing) {
        els.closing.hidden = !view.closing;
        els.closing.textContent = view.closing;
    }
}

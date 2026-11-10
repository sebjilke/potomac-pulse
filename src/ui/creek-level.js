// Potomac Pulse - creek level bands (v39.4, audit item A9)
//
// Pure functions only: no DOM, no browser globals at module top level (same pattern as
// cap-indicator.js and data-freshness.js), so everything here is unit-tested under Node.
//
// Each creek has one number, its minimum runnable flow. This module DESCRIBES how far a reading is
// above that minimum and says plainly that Potomac Pulse has no high-water level for the creek.
// It never advises. The cuts at 2x and 5x are conventions, not safety facts.
// Wording rule: never say "upper limit" (a limit sounds like a safety fact). The word "Running"
// appears only in the run band (1x to under 2x).
//
// Nothing here feeds the Great Falls estimate, the bins or the learning.

export const CREEK_BANDS = { run: 1, high: 2, veryhigh: 5 };
export const OLD_READING_MIN = 120;
export const NO_HIGH_WATER_LEVEL = 'Potomac Pulse has no high-water level for this creek, so it cannot say whether this is too high.';

const GREEN = { color: 'var(--accent-green)', rgb: '74,222,128' };
const AMBER = { color: 'var(--accent-amber)', rgb: '251,191,36' };
// Red text uses the lighter token (5.7:1 on the card); the plain red stays for dots, borders and chart lines.
const RED = { color: 'var(--accent-red)', text: 'var(--accent-red-light)', rgb: '239,68,68' };
const GREY = { color: 'var(--text-muted)', rgb: '100,116,139' };
const BAND_STYLE = { run: GREEN, high: AMBER, veryhigh: RED };
const TREND_COLOR = 'var(--text-tertiary)';
const ARROWS = { rising: '↑', falling: '↓', steady: '→' };
const TITLES = { rising: 'Flow rising', falling: 'Flow falling', steady: 'Flow steady' };
const ACTIVE = new Set(['run', 'high', 'veryhigh']);
const RANK = { run: 1, high: 2, veryhigh: 3 };

const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const toMs = (t) => (t instanceof Date ? t.getTime() : t);

/** Age text for an old reading: whole hours below 48 h, whole days from 48 h. */
export function formatReadingAge(min) {
    if (!fin(min) || min < 0) return 'of unknown age';
    const h = Math.floor(min / 60);
    if (h >= 48) return `${Math.floor(h / 24)} days ago`;
    return `${h} h ago`;
}

/**
 * Classifies one creek reading.
 * @param {number} q - cfs. @param {number} runnable - minimum cfs.
 * @param {Date|number|null} readingTime - when USGS took the reading. @param {number} now - ms.
 * @returns {{band: string, ratio: (number|null), shown: string, ageMin: (number|null)}}
 */
export function creekLevel(q, runnable, readingTime, now) {
    const none = { band: 'none', ratio: null, shown: '', ageMin: null };
    if (!fin(q) || q < 0) return none;   // null, NaN, Infinity, negative, -999999
    const t = toMs(readingTime);
    const ageMin = fin(t) && fin(now) ? Math.max(0, (now - t) / 60000) : null;
    if (ageMin === null || ageMin > OLD_READING_MIN) return { band: 'old', ratio: null, shown: '', ageMin };
    if (!fin(runnable) || runnable <= 0) return { band: 'nominimum', ratio: null, shown: '', ageMin };
    const ratio = q / runnable;
    const band = ratio >= CREEK_BANDS.veryhigh ? 'veryhigh' : ratio >= CREEK_BANDS.high ? 'high' : ratio >= CREEK_BANDS.run ? 'run' : 'below';
    let shown = '';
    if (band !== 'below') {
        // Truncate, never round, then clamp inside the band so the text cannot contradict it.
        let tenths = Math.floor(q * 10 / runnable);
        const lo = CREEK_BANDS[band] * 10;
        const hi = band === 'run' ? CREEK_BANDS.high * 10 - 1 : band === 'high' ? CREEK_BANDS.veryhigh * 10 - 1 : Infinity;
        tenths = Math.min(Math.max(tenths, lo), hi);
        shown = tenths >= 100 ? `${Math.floor(tenths / 10)}x` : `${(tenths / 10).toFixed(1)}x`;
    }
    return { band, ratio, shown, ageMin };
}

/** The same truncated multiple the fresh bands show (shared code path), e.g. '8.0x'. */
const shownMultiple = (q, runnable) => creekLevel(q, runnable, 0, 0).shown;

/** Status line of an old reading: keeps what it knew, as history, never as the current level. */
function oldReadingStatus(q, runnable, ageMin) {
    if (!fin(ageMin)) return 'Old reading: its time is unknown. The current level is unknown.';
    const ago = formatReadingAge(ageMin);
    const cfs = `${Math.round(q)} cfs`;
    const hasMin = fin(runnable) && runnable > 0;
    const level = !hasMin ? cfs
        : q < runnable ? `${cfs}, below the ${runnable} cfs minimum`
        : `${cfs}, ${shownMultiple(q, runnable)} the ${runnable} cfs minimum`;
    return `Old reading: ${ago} it was ${level}. The current level is unknown.`;
}

/**
 * The whole card view for one creek, so the UI only assigns values.
 * @param {object|undefined} d - creekData entry ({q, trend, time}) or undefined for no data.
 * @param {object} c - CREEK_RUNS entry ({runnable, microRun}).
 * @param {number} now - ms.
 */
export function creekCardView(d, c, now) {
    const grey = {
        dotColor: 'var(--border-hover)', cfsColor: 'var(--text-tertiary)', borderColor: 'var(--border-default)',
        statusColor: 'var(--text-tertiary)', chartRgb: GREY.rgb, lineColor: GREY.color,
        trendText: '', trendTitle: '', trendColor: TREND_COLOR, lastRan: 'history', active: false
    };
    const lvl = d ? creekLevel(d.q, c?.runnable, d.time, now) : { band: 'none' };
    if (lvl.band === 'none') {
        return { ...grey, band: 'none', cfsText: '❓ No data', status: 'Gauge offline or no response' };
    }
    const cfsText = `${Math.round(d.q)} cfs`;
    if (lvl.band === 'old') {
        return { ...grey, band: 'old', cfsText: `${cfsText} (old)`, dotColor: 'var(--text-muted)', status: oldReadingStatus(d.q, c?.runnable, lvl.ageMin) };
    }
    if (lvl.band === 'nominimum') {
        return { ...grey, band: 'nominimum', cfsText, dotColor: 'var(--text-muted)', status: 'No minimum flow is set for this creek.' };
    }
    const arrow = ARROWS[d.trend] ? d.trend : 'steady';
    const trend = { trendText: ARROWS[arrow], trendTitle: TITLES[arrow], trendColor: TREND_COLOR };
    if (lvl.band === 'below') {
        return {
            ...grey, ...trend, band: 'below', cfsText, dotColor: 'var(--text-muted)',
            status: `Needs ≥${c.runnable} cfs${c.microRun ? ' (micro-run)' : ''}`
        };
    }
    const s = BAND_STYLE[lvl.band];
    const base = `${lvl.shown} the ${c.runnable} cfs minimum`;
    const status = lvl.band === 'run' ? `Running: ${base}`
        : lvl.band === 'high' ? `${base}. ${NO_HIGH_WATER_LEVEL}`
        : `${base}, far above it. ${NO_HIGH_WATER_LEVEL}`;
    return {
        ...trend, band: lvl.band, cfsText, status, active: true,
        dotColor: s.color, cfsColor: s.color, borderColor: s.color, statusColor: s.text ?? s.color,
        chartRgb: s.rgb, lineColor: s.color,
        lastRan: lvl.band === 'run' ? 'now' : 'hidden'
    };
}

/** True for the three bands at or above the creek's minimum. */
export const isActiveBand = (band) => ACTIVE.has(band);

function highestBand(bands) {
    let top = null;
    for (const b of bands) if (RANK[b] && (!top || RANK[b] > RANK[top])) top = b;
    return top;
}

/**
 * Banner for the Creeks tab. tone: 'running' | 'high' | 'veryhigh' | 'quiet' | 'unknown'. The tone and emoji
 * follow the highest band, so nothing is green while a creek is at 2x or more.
 * @param {string[]} bands - one band per creek.
 * @param {number} total - number of creeks.
 */
export function creekBanner(bands, total) {
    const active = bands.filter(isActiveBand).length;
    const very = bands.filter((b) => b === 'veryhigh').length;
    const old = bands.filter((b) => b === 'old').length;
    const nodata = bands.filter((b) => b === 'none').length;
    const oldPart = old > 0 ? ` · ${old} with old readings` : '';
    const noPart = nodata > 0 ? ` · ${nodata} with no data` : '';
    const top = highestBand(bands);
    if (active === 0) {
        // Nothing current at or above the minimum. Only claim "Nothing running" when every creek has a current reading.
        if (old + nodata === 0) return { emoji: '⚫', text: 'Nothing running', tone: 'quiet' };
        if (old + nodata >= total) return { emoji: '⚪', text: `Creek levels unknown${oldPart}${noPart}`, tone: 'unknown' };
        return { emoji: '⚪', text: `No current reading at or above minimum${oldPart}${noPart}. Levels for those creeks are unknown.`, tone: 'unknown' };
    }
    const text = `${active} of ${total} creeks at or above their minimum flow${very > 0 ? ` · ${very} at 5x or more` : ''}${oldPart}${noPart}`;
    const tone = top === 'veryhigh' ? 'veryhigh' : top === 'high' ? 'high' : 'running';
    const emoji = top === 'veryhigh' ? '🔴' : top === 'high' ? '🟠' : '🟢';
    return { emoji, text, tone };
}

/** Class for the Creeks tab dot: '' | 'has-running' | 'has-high' | 'has-veryhigh'. */
export function creekTabDotClass(bands) {
    const top = highestBand(bands);
    return top === 'veryhigh' ? 'has-veryhigh' : top === 'high' ? 'has-high' : top === 'run' ? 'has-running' : '';
}

export const TAB_DOT_CLASSES = ['has-running', 'has-high', 'has-veryhigh'];

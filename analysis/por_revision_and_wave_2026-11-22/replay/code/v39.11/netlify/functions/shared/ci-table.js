// v39.6 (A8): server copy of the browser's 90% band table and band formula, used ONLY by the audit
// log (tick_log.ci). Observation only: nothing in estimation or learning reads this file.
//
// This is a COPY of EMPIRICAL_CI_90 in src/model/constants.js and of the formula in
// src/estimation/great-falls.js (getGFUncertainty + computeUncertaintyBand). test/confidence-parity.test.mjs
// binds both copies, so a change to one without the other fails the suite.
//
// Not named index.js or shared.js on purpose: a file with those names in a functions folder could
// be deployed as a function of its own. esbuild bundles this file into scheduled-update only.

function deepFreeze(o) {
    for (const k of Object.keys(o)) {
        if (o[k] && typeof o[k] === 'object') deepFreeze(o[k]);
    }
    return Object.freeze(o);
}

const EMPIRICAL_CI_90 = deepFreeze({
    '0-3000':     { rising: { q05: -547, q95: 369 }, steady: { q05: -271, q95: 250 }, falling: { q05: -315, q95: 336 }, all: { q05: -309, q95: 284 } },
    '3000-6000':  { rising: { q05: -676, q95: 535 }, steady: { q05: -327, q95: 287 }, falling: { q05: -391, q95: 361 }, all: { q05: -425, q95: 356 } },
    '6000-12000': { rising: { q05: -1650, q95: 1046 }, steady: { q05: -404, q95: 320 }, falling: { q05: -451, q95: 359 }, all: { q05: -628, q95: 506 } },
    '12000-25000':{ rising: { q05: -2384, q95: 1543 }, steady: { q05: -549, q95: 425 }, falling: { q05: -514, q95: 464 }, all: { q05: -884, q95: 741 } },
    '25000-50000':{ rising: { q05: -3851, q95: 2860 }, steady: { q05: -2013, q95: 1844 }, falling: { q05: -1068, q95: 1059 }, all: { q05: -2402, q95: 1899 } },
    '50000+':     { rising: { q05: -7354, q95: 5519 }, steady: { q05: -5858, q95: 6410 }, falling: { q05: -4099, q95: 6429 }, all: { q05: -5858, q95: 6410 } }
});

/**
 * The 90% band the page shows, computed the way the page computes it.
 * @param {number} estimateCFS - The displayed (capped, rounded) estimate: the band's centre.
 * @param {string} bin - The bin of the RAW UNCLIPPED final (pred.flowBin), not the bin of the capped value.
 * @param {string} state - Flow state ('rising' | 'falling' | 'steady'); unknown states fall back to 'all'.
 * @returns {{lo: number, hi: number, q05: number, q95: number, bin: string, st: string}|null} null where the page shows no band (unknown bin or non-numeric estimate).
 */
function bandFor(estimateCFS, bin, state) {
    if (typeof estimateCFS !== 'number' || !Number.isFinite(estimateCFS)) return null;
    const ciData = Object.prototype.hasOwnProperty.call(EMPIRICAL_CI_90, bin) ? EMPIRICAL_CI_90[bin] : null;
    if (!ciData) return null;
    const s = Object.prototype.hasOwnProperty.call(ciData, state) ? ciData[state] : null;
    const stateCI = s || ciData.all;
    return {
        lo: Math.max(0, Math.round(estimateCFS - stateCI.q95)),
        hi: Math.round(estimateCFS - stateCI.q05),
        q05: stateCI.q05,
        q95: stateCI.q95,
        bin,
        st: state
    };
}

module.exports = { EMPIRICAL_CI_90, bandFor };

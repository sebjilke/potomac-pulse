// Potomac Pulse: refresh orchestration (v39.7, client only)
//
// Three things live here:
//  1. The pure resume policy: when a wake / visible / online event should start a refresh.
//  2. createRefresher: starts the learning load and the data fetch in the same tick, and keeps the one
//     "deferred resume" flag. It takes its dependencies as arguments so it can be tested with stubs.
//  3. refreshAll: the real instance, wired to the app. Used by init.js, main.js and the two buttons.
//
// Resume only decides WHEN to call fetchData. It does not change how a fetch works (v39.1 rules stand).

import { CLOCK_SKEW_MIN } from '../ui/data-freshness.js';
import { fetchData } from './fetch.js';
import { loadGFLearningData } from '../learning/gf-learning.js';
import { lastReading, lastFetchTime, dataSource, lastAttemptMs, isFetching, fetchSettled, setFetchSettled } from '../state/store.js';
import { updateGreatFallsUI } from '../ui/great-falls-ui.js';
import { updateLearningUI, updateGFLearningUI } from '../ui/learning-ui.js';

export const RESUME_STALE_MIN = 10;
export const RESUME_ATTEMPT_GAP_MS = 60000;

/**
 * Time of the last good answer. The server's own response time wins; the fetch time counts only for a live
 * answer (a service-worker saved copy sets the fetch time too, so it cannot be trusted on its own).
 * @param {{bodyMs: (number|null|undefined), fetchMs: (number|null|undefined), source: string}} i
 * @returns {(number|null)} ms since epoch, or null when unknown.
 */
export function lastGoodMs({ bodyMs, fetchMs, source }) {
    if (Number.isFinite(bodyMs)) return bodyMs;
    if (source === 'live' && Number.isFinite(fetchMs)) return fetchMs;
    return null;
}

/**
 * Decides whether a wake / visible / online event should start a refresh.
 * @param {Object} i
 * @param {number} i.now - Current time, ms.
 * @param {(number|null)} i.lastGood - From lastGoodMs.
 * @param {(number|null)} i.lastAttemptMs - Start of the last fetch attempt, ms.
 * @param {boolean} i.online
 * @param {boolean} i.visible
 * @param {boolean} i.fetching
 * @param {boolean} [i.force] - Skips the 60 s attempt gap only. The age test still applies.
 * @returns {boolean}
 */
export function shouldResumeRefresh({ now, lastGood, lastAttemptMs: attempt, online, visible, fetching, force = false }) {
    if (!online || !visible || fetching) return false;
    if (!force && Number.isFinite(attempt) && now - attempt < RESUME_ATTEMPT_GAP_MS) return false;
    if (!Number.isFinite(lastGood)) return true;
    let ageMin = (now - lastGood) / 60000;
    // Device clock up to 5 min slow: the server time can sit slightly in the future. That is skew, not
    // an unknown age, so clamp to 0. Only a larger negative age (clock moved back) counts as unknown.
    if (ageMin < -CLOCK_SKEW_MIN) return true;
    if (ageMin < 0) ageMin = 0;
    return ageMin >= RESUME_STALE_MIN;
}

/**
 * Builds the refresher. All dependencies are injected.
 * @param {Object} d
 * @param {Function} d.loadLearning - Starts the learning load (never needs arguments).
 * @param {Function} d.fetchData - Starts the data fetch.
 * @param {Function} d.getState - Returns {bodyMs, fetchMs, source, lastAttemptMs, online, visible, fetching}.
 * @param {Function} [d.now]
 * @returns {{refreshAll: Function, maybeResume: Function, onFetchSettled: Function, isResumePending: Function}}
 */
export function createRefresher({ loadLearning, fetchData: doFetch, getState, now = Date.now }) {
    let resumePending = false;

    const run = (fn) => {
        try {
            return Promise.resolve(fn()).catch((e) => console.warn('Refresh step failed:', e));
        } catch (e) {
            console.warn('Refresh step failed:', e);
            return Promise.resolve();
        }
    };

    // Both calls start in this tick; each has its own try/catch, so neither can block or break the other.
    function refreshAll() {
        return Promise.allSettled([run(() => loadLearning()), run(() => doFetch())]);
    }

    const evaluate = (force) => {
        const s = getState();
        return shouldResumeRefresh({
            now: now(),
            lastGood: lastGoodMs({ bodyMs: s.bodyMs, fetchMs: s.fetchMs, source: s.source }),
            lastAttemptMs: s.lastAttemptMs,
            online: s.online,
            visible: s.visible,
            fetching: s.fetching,
            force
        });
    };

    // Called by the wake / visible / online handlers.
    function maybeResume() {
        if (evaluate(false)) { refreshAll(); return true; }
        const s = getState();
        // A fetch is already running (iOS can freeze one mid-flight): remember the event so the
        // fetch:settled hook can look again once it ends.
        if (s.fetching && s.online && s.visible) resumePending = true;
        return false;
    }

    // Called from the fetch:settled hook (after isFetching is false). The re-run skips only the attempt gap,
    // and it never sets the flag again, so it cannot chain.
    function onFetchSettled() {
        if (!resumePending) return false;
        resumePending = false;
        if (evaluate(true)) { refreshAll(); return true; }
        return false;
    }

    return { refreshAll, maybeResume, onFetchSettled, isResumePending: () => resumePending };
}

const refresher = createRefresher({
    loadLearning: () => loadGFLearningData(),
    fetchData: () => fetchData(),
    getState: () => ({
        bodyMs: lastReading?.bodyMs ?? null,
        fetchMs: lastFetchTime,
        source: dataSource,
        lastAttemptMs,
        online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
        visible: typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
        fetching: isFetching
    })
});

export const refreshAll = () => refresher.refreshAll();
export const maybeResume = () => refresher.maybeResume();
export const onResumeFetchSettled = () => refresher.onFetchSettled();

// ==================== render hooks (wired in init.js) ====================

// Set when learning settles while a fetch is running (the fetch's own render will use it). data:updated and
// data:unavailable clear it; if the fetch ended without either (an exception), the fetch:settled hook renders
// once so the new learning data is never lost.
let learningMissed = false;

/** Clears the "learning landed mid-fetch" note. Subscribed to data:updated and data:unavailable. */
export function clearLearningMissed() { learningMissed = false; }

/**
 * learning:loaded handler. The bin table is filled first, always (PA-14, N-5: it would stay empty for a
 * signed-in admin when no estimate renders). Mid-fetch the card is only noted: every normal fetch end
 * renders it. Otherwise it renders now.
 */
export function onLearningLoaded() {
    updateGFLearningUI();
    if (isFetching) { learningMissed = true; return; }
    updateGreatFallsUI();
    updateLearningUI();
}

/**
 * fetch:settled handler (emitted once per fetchData, after isFetching is false). One hook for three jobs:
 * marks that a fetch has finished, repaints the card if learning or the flag changed under a render that
 * did not see them, and gives a deferred wake/resume event its turn.
 */
export function onFetchSettled() {
    const flagChanged = !fetchSettled;
    setFetchSettled(true);
    if (learningMissed || flagChanged) {
        learningMissed = false;
        updateGreatFallsUI();
    }
    onResumeFetchSettled();
}

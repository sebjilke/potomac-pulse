// Potomac Pulse — Application initialization
// Extracted from index.html inline script

import { loadPoRHistory, loadGFHistory } from './data/history.js';
import { loadShadowModelState } from './estimation/shadow-models.js';
import { loadEFHysteresis } from './estimation/edwards-ferry.js';
import { loadForecastAccuracy, resetGFLearning } from './learning/gf-learning.js';
import { dismissErrorBanner, updateStalenessDisplay } from './data/fetch.js';
import { buildBranches, updateUI } from './ui/gauges-ui.js';
import { buildCreeks, updateCreeksUI } from './ui/creeks-ui.js';
import { updateLearningUI, updateGFLearningUI, updateGFBinStats, resetShadowModels, downloadLearningBackup, renderAuditLog } from './ui/learning-ui.js';
import { initTabs } from './ui/tabs.js';
import { initAuth } from './ui/auth.js';
import { initAbout } from './ui/about.js';
import { downloadTechAppendix } from './ui/tech-appendix.js';
import { lockLearning } from './ui/auth.js';

// Render wiring (v37.4): the event bus replaces the old setter-injection lazy callbacks. Producers emit;
// the UI re-render functions below are subscribed once, here, at the top of init().
import { on } from './state/event-bus.js';
import { updateForecastAccuracyUI, updateGreatFallsUI, updateForecastPeriods } from './ui/great-falls-ui.js';
import { initOfflineBanner } from './ui/offline-banner.js';
import { refreshAll, maybeResume, onLearningLoaded, onFetchSettled, clearLearningMissed } from './data/refresh.js';

/**
 * Attaches a click handler to the DOM element with the given id, if it exists.
 * @param {string} id - The id of the target DOM element.
 * @param {Function} handler - The click event handler to attach.
 * @returns {void}
 */
function bindButton(id, handler) {
    document.getElementById(id)?.addEventListener('click', handler);
}

/**
 * Bootstraps the application: subscribes UI re-render functions to bus events,
 * binds button handlers, loads persisted state/history, initializes the UI, and
 * fetches current data. Falls back to a minimal UI on error.
 * @returns {Promise<void>}
 */
export async function init() {
    try {
        // Subscribe UI re-render functions to bus events (must run before the first fetchData below).
        on('data:updated', updateUI);
        on('data:updated', updateLearningUI);
        on('data:updated', updateCreeksUI);
        on('data:unavailable', updateUI);
        on('data:unavailable', updateCreeksUI);  // re-apply the 2 h age rule to the last known creek readings
        on('nws:arrived', updateUI);
        on('gf-estimate:rendered', updateGFLearningUI);
        on('forecast-accuracy:updated', updateForecastAccuracyUI);
        on('learning:reset', updateGFLearningUI);
        on('learning:reset', updateGFBinStats);
        on('learning:reset', renderAuditLog);
        on('por-history:healed', updateGreatFallsUI);
        on('learning:loaded', onLearningLoaded);
        on('fetch:settled', onFetchSettled);
        on('data:updated', clearLearningMissed);
        on('data:unavailable', clearLearningMissed);
        on('gf-history:updated', updateForecastPeriods);

        // v37.10 (#19): offline indicator (navigator.onLine-driven; see offline-banner.js).
        initOfflineBanner();
        // v39.1: the freshness label depends on connectivity (saved-copy wording); redraw on change
        // so it cannot disagree with the offline bar for up to 60 s.
        window.addEventListener('online', updateStalenessDisplay);
        window.addEventListener('offline', updateStalenessDisplay);

        // v39.7: refresh on wake. Each event first ages the label (no network), then lets the policy decide
        // (readings at least 10 min old, 60 s between attempts; see src/data/refresh.js). 'pageshow' covers
        // back/forward-cache restores where 'visibilitychange' may not fire.
        const onResume = () => { updateStalenessDisplay(); maybeResume(); };
        document.addEventListener('visibilitychange', onResume);
        window.addEventListener('pageshow', onResume);
        window.addEventListener('online', onResume);

        // Bind event listeners (replaces inline onclick handlers)
        // v39.7 (PA-15): arrow functions, so the click event never reaches refreshAll as an argument.
        bindButton('refreshBtn', () => refreshAll());
        bindButton('gfRetryBtn', () => refreshAll());
        bindButton('dismissErrorBtn', dismissErrorBanner);
        bindButton('techAppendixBtn', downloadTechAppendix);
        bindButton('resetGFLearningBtn', resetGFLearning);
        bindButton('resetShadowModelsBtn', resetShadowModels);
        bindButton('downloadBackupBtn', downloadLearningBackup);
        bindButton('lockLearningBtn', lockLearning);

        // Load PoR history for Great Falls time-shifting
        loadPoRHistory();

        // Load GF estimate history for forecast graph
        loadGFHistory();

        // Load shadow model state (horse race)
        loadShadowModelState();

        // Load EF hysteresis corrections (local learning)
        loadEFHysteresis();

        // Load forecast accuracy data (non-blocking)
        loadForecastAccuracy().catch(e => console.warn('Forecast accuracy load error:', e));

        // Initialize UI
        buildBranches();
        buildCreeks();
        initTabs();
        initAuth();
        initAbout();
        updateLearningUI();
        renderAuditLog();   // load recent admin actions (no-op if learning locked)

        // v39.7: learning (10 s deadline) and the data fetch start together, after the UI is built. The card
        // waits for both (gate in updateGreatFallsUI); 'learning:loaded' repaints it if learning lands last.
        // refreshAll never rejects, so awaiting it cannot send a failed load to the catch below.
        await refreshAll();
    } catch(e) {
        console.error('Init error:', e);
        buildBranches();
        buildCreeks();
        refreshAll(); // v39.7: the fallback also loads learning, so the card cannot wait for it for ever
    }
}

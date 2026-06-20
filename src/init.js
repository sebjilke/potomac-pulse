// Potomac Pulse — Application initialization
// Extracted from index.html inline script

import { loadPoRHistory, loadGFHistory } from './data/history.js';
import { loadShadowModelState } from './estimation/shadow-models.js';
import { loadEFHysteresis } from './estimation/edwards-ferry.js';
import { loadGFLearningData, loadForecastAccuracy, resetGFLearning, resetLowFlowBins } from './learning/gf-learning.js';
import { fetchData, dismissErrorBanner } from './data/fetch.js';
import { initMap, toggleMap } from './ui/map.js';
import { buildBranches, updateUI } from './ui/gauges-ui.js';
import { buildCreeks, updateCreeksUI } from './ui/creeks-ui.js';
import { updateLearningUI, updateGFLearningUI, updateGFBinStats, resetShadowModels, downloadLearningBackup } from './ui/learning-ui.js';
import { initTabs } from './ui/tabs.js';
import { initAuth } from './ui/auth.js';
import { initAbout } from './ui/about.js';
import { downloadTechAppendix } from './ui/tech-appendix.js';
import { lockLearning } from './ui/auth.js';

// Render wiring (v37.4): the event bus replaces the old setter-injection lazy callbacks. Producers emit;
// the UI re-render functions below are subscribed once, here, at the top of init().
import { on } from './state/event-bus.js';
import { updateForecastAccuracyUI, updateGreatFallsUI, updateForecastPeriods } from './ui/great-falls-ui.js';

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
        on('nws:arrived', updateUI);
        on('gf-estimate:rendered', updateGFLearningUI);
        on('forecast-accuracy:updated', updateForecastAccuracyUI);
        on('learning:reset', updateGFLearningUI);
        on('learning:reset', updateGFBinStats);
        on('por-history:healed', updateGreatFallsUI);
        on('gf-history:updated', updateForecastPeriods);

        // Bind event listeners (replaces inline onclick handlers)
        bindButton('mapToggleBtn', toggleMap);
        bindButton('refreshBtn', fetchData);
        bindButton('dismissErrorBtn', dismissErrorBanner);
        bindButton('techAppendixBtn', downloadTechAppendix);
        bindButton('resetGFLearningBtn', resetGFLearning);
        bindButton('resetLowFlowBinsBtn', resetLowFlowBins);
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

        // Load GF learning data for Great Falls corrections
        await loadGFLearningData();

        // Load forecast accuracy data (non-blocking)
        loadForecastAccuracy().catch(e => console.warn('Forecast accuracy load error:', e));

        // Initialize UI
        initMap();
        buildBranches();
        buildCreeks();
        initTabs();
        initAuth();
        initAbout();
        updateLearningUI();

        // Fetch current data
        await fetchData();
    } catch(e) {
        console.error('Init error:', e);
        // Fallback: at least show the map
        initMap();
        buildBranches();
        buildCreeks();
        fetchData();
    }
}

// Potomac Pulse — Application initialization
// Extracted from index.html inline script

import { setLearningData } from './state/store.js';
import { initCloudSync, updateSyncStatus } from './learning/cloud-sync.js';
import { loadPoRHistory, loadGFHistory } from './data/history.js';
import { loadShadowModelState } from './estimation/shadow-models.js';
import { loadEFHysteresis } from './estimation/edwards-ferry.js';
import { loadLearning, createEmptyLearning } from './learning/gauge-learning.js';
import { loadGFLearningData, loadForecastAccuracy, resetGFLearning, resetLowFlowBins } from './learning/gf-learning.js';
import { fetchData, dismissErrorBanner, setUpdateWaveAnimation } from './data/fetch.js';
import { initMap, toggleMap, updateWaveAnimation } from './ui/map.js';
import { buildBranches } from './ui/gauges-ui.js';
import { buildCreeks } from './ui/creeks-ui.js';
import { updateLearningUI, resetShadowModels } from './ui/learning-ui.js';
import { initTabs } from './ui/tabs.js';
import { initAuth } from './ui/auth.js';
import { initAbout } from './ui/about.js';
import { downloadTechAppendix } from './ui/tech-appendix.js';
import { lockLearning } from './ui/auth.js';

// Wire up cross-module lazy callbacks
import { setUpdateGFLearningUI, setUpdateGFBinStats, setUpdateForecastAccuracyUI } from './learning/gf-learning.js';
import { updateGFLearningUI, updateGFBinStats } from './ui/learning-ui.js';
import { updateForecastAccuracyUI } from './ui/great-falls-ui.js';

// Wire up history module lazy callbacks
import { setUpdateGreatFallsUI as setHistoryUpdateGFUI, setUpdateForecastPeriods as setHistoryUpdateForecast } from './data/history.js';
import { updateGreatFallsUI, updateForecastPeriods } from './ui/great-falls-ui.js';

// Wire up great-falls-ui lazy callback
import { setUpdateGFLearningUIRef as setGFUILearningCallback } from './ui/great-falls-ui.js';

function bindButton(id, handler) {
    document.getElementById(id)?.addEventListener('click', handler);
}

export async function init() {
    try {
        // Register lazy callbacks to break circular dependencies
        setUpdateWaveAnimation(updateWaveAnimation);
        setUpdateGFLearningUI(updateGFLearningUI);
        setUpdateGFBinStats(updateGFBinStats);
        setUpdateForecastAccuracyUI(updateForecastAccuracyUI);
        setHistoryUpdateGFUI(updateGreatFallsUI);
        setHistoryUpdateForecast(updateForecastPeriods);
        setGFUILearningCallback(updateGFLearningUI);

        // Bind event listeners (replaces inline onclick handlers)
        bindButton('mapToggleBtn', toggleMap);
        bindButton('refreshBtn', fetchData);
        bindButton('dismissErrorBtn', dismissErrorBanner);
        bindButton('techAppendixBtn', downloadTechAppendix);
        bindButton('resetGFLearningBtn', resetGFLearning);
        bindButton('resetLowFlowBinsBtn', resetLowFlowBins);
        bindButton('resetShadowModelsBtn', resetShadowModels);
        bindButton('lockLearningBtn', lockLearning);

        // Initialize cloud sync via serverless function
        initCloudSync();
        updateSyncStatus('syncing');

        // Load PoR history for Great Falls time-shifting
        loadPoRHistory();

        // Load GF estimate history for forecast graph
        loadGFHistory();

        // Load shadow model state (horse race)
        loadShadowModelState();

        // Load EF hysteresis corrections (local learning)
        loadEFHysteresis();

        // Load learning data (from cloud + local)
        const loadedLearning = await loadLearning();
        setLearningData(loadedLearning);

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
        setLearningData(createEmptyLearning());
        initMap();
        buildBranches();
        buildCreeks();
        fetchData();
    }
}

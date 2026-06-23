// Potomac Pulse — Vite entry point
import 'leaflet/dist/leaflet.css';
import './styles/theme.css';
import './styles/main.css';

// Error monitoring (initialize first to capture loading errors)
import { initSentry, Sentry } from './monitoring/sentry.js';
initSentry();

// Core modules (side-effect imports to ensure they're bundled)
import './model/constants.js';
import './model/shared-model.js';
import './state/store.js';

// Data layer
import './data/fetch.js';
import './data/history.js';

// Estimation engine
import './estimation/great-falls.js';
import './estimation/edwards-ferry.js';
import './estimation/shadow-models.js';
import './estimation/nws.js';

// Learning system (System 2 — server-side GF EMA correction)
import './learning/gf-learning.js';

// UI modules
import './ui/great-falls-ui.js';
import './ui/forecast-graph.js';
import './ui/gauges-ui.js';
import './ui/creeks-ui.js';
import './ui/map.js';
import './ui/tabs.js';
import './ui/learning-ui.js';
import './ui/auth.js';
import './ui/tech-appendix.js';
import './ui/about.js';

// Application initialization
import { init } from './init.js';
import { fetchData, updateStalenessDisplay } from './data/fetch.js';

// Boot the application
init().catch(e => {
    console.error('Init failed:', e);
    Sentry.captureException(e);
});

// Refresh every 15 minutes
setInterval(fetchData, 900000);

// Update staleness display every minute
setInterval(updateStalenessDisplay, 60000);

// v37.10 (#19): register the offline service worker — production builds only. Dynamic import so the
// dev bundle never pulls the virtual module, and a registration failure can never break app boot.
if (import.meta.env.PROD) {
    import('virtual:pwa-register')
        .then(({ registerSW }) => registerSW({ immediate: true }))
        .catch(() => {});
}

console.log('Potomac Pulse main.js loaded');

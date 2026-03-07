// Potomac Pulse — Sentry error monitoring
// Set VITE_SENTRY_DSN in Netlify env vars to activate
import * as Sentry from '@sentry/browser';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || '';

export function initSentry() {
    if (!SENTRY_DSN) {
        console.log('Sentry DSN not configured — error monitoring inactive');
        return;
    }

    Sentry.init({
        dsn: SENTRY_DSN,
        environment: window.location.hostname === 'localhost' ? 'development' : 'production',
        sampleRate: 1.0
    });

    console.log('Sentry error monitoring active');
}

export { Sentry };

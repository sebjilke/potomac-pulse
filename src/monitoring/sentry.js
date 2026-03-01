// Potomac Pulse — Sentry error monitoring
// Replace the DSN below after creating a Sentry project at https://sentry.io
import * as Sentry from '@sentry/browser';

const SENTRY_DSN = ''; // Paste your DSN here

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

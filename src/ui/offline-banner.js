// Potomac Pulse — offline indicator (v37.10, #19)
//
// A minimal "you're offline" bar driven by the browser's online/offline state (navigator.onLine +
// the window 'online'/'offline' events). This is DISTINCT from fetch.js's #error-banner, which fires
// on a FAILED fetch: with the service worker serving USGS/forecast from cache, an offline fetch can
// SUCCEED, so that banner won't fire — this fills the gap so cached-but-shown data isn't mistaken for
// live. Module import is side-effect-free (no top-level window/document/navigator) so the pure
// shouldShowOffline() can be unit-tested under Node, which gates the Netlify build.

import { on } from '../state/event-bus.js';

/**
 * Pure decision: should the offline indicator be visible?
 * @param {boolean} isOnline - The browser's connectivity state (navigator.onLine / latest online-offline event).
 * @returns {boolean} True when the browser reports offline (indicator shown).
 */
export function shouldShowOffline(isOnline) {
    return !isOnline;
}

/**
 * Wires the #offlineBar element to the browser's online/offline state. Call once during init.
 * All DOM/window access is confined here (the module top level stays import-safe for Node tests).
 * @returns {void}
 */
export function initOfflineBanner() {
    const bar = document.getElementById('offlineBar');
    if (!bar) return;
    const render = () => { bar.hidden = !shouldShowOffline(navigator.onLine); };
    window.addEventListener('online', render);
    window.addEventListener('offline', render);
    // A successful data refresh implies connectivity even if an 'online' event was missed.
    on('data:updated', render);
    render(); // set initial state from navigator.onLine
}

// Potomac Pulse — minimal synchronous pub/sub event bus
//
// Decouples re-render producers (fetch, history server-pulls, learning resets, GF render) from the UI
// consumers that repaint in response. Producers `emit('event', payload?)`; consumers are subscribed once
// in init.js via `on('event', fn)`. This replaces the old setter-injection lazy-callback scaffolding
// (v37.4, Tier 3 #11).
//
// Design notes:
// - This module imports NOTHING from the app. It is a leaf, so importing it everywhere creates no cycle.
// - `emit` is SYNCHRONOUS and iterates subscribers in registration order, reproducing the exact ordering
//   of the previous nested/sequential direct calls.
// - `emit` does NOT swallow handler errors — a throwing handler propagates, identical to the previous
//   direct calls (a throw in one render aborts the rest of that emit, just as a throw in a sequential
//   statement aborted the rest).
// - The subscriber set is snapshotted per-emit so a handler that (un)subscribes mid-emit can't corrupt
//   iteration.

const listeners = new Map(); // event name -> Set<fn>

// Subscribe `fn` to `event`. Returns an unsubscribe function.
export function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => off(event, fn);
}

// Unsubscribe `fn` from `event`.
export function off(event, fn) {
    listeners.get(event)?.delete(fn);
}

// Fire `event`, calling every subscriber synchronously (registration order) with `payload`.
export function emit(event, payload) {
    const fns = listeners.get(event);
    if (!fns) return;
    for (const fn of [...fns]) fn(payload);
}

// Remove all subscriptions. Test-isolation helper only.
export function clear() {
    listeners.clear();
}

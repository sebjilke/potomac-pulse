// Potomac Pulse — event-bus tests (v37.4, Tier 3 #11)
//
// Two layers:
//   (1) Unit tests for the pub/sub primitive (src/state/event-bus.js).
//   (2) A static wiring-consistency check: every emit('x') in src/ has a matching on('x') subscription
//       and vice versa. This is the only automated guard on the render wiring (the UI has no DOM tests),
//       so it catches typo'd / orphaned event names.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { on, off, emit, clear } from '../src/state/event-bus.js';

describe('event-bus primitive', () => {
    beforeEach(() => clear());

    it('emit calls every subscriber in registration order', () => {
        const calls = [];
        on('e', () => calls.push('a'));
        on('e', () => calls.push('b'));
        on('e', () => calls.push('c'));
        emit('e');
        assert.deepEqual(calls, ['a', 'b', 'c']);
    });

    it('forwards the payload to handlers (guards the dropped-arg regression class)', () => {
        let seen;
        on('e', (p) => { seen = p; });
        const payload = { gfEstimate: { cfs: 12345 } };
        emit('e', payload);
        assert.equal(seen, payload);
    });

    it('isolates events from one another', () => {
        let a = 0, b = 0;
        on('a', () => { a++; });
        on('b', () => { b++; });
        emit('a');
        assert.equal(a, 1);
        assert.equal(b, 0);
    });

    it('emit with no subscribers is a no-op (does not throw)', () => {
        assert.doesNotThrow(() => emit('nobody-listening', { x: 1 }));
    });

    it('off removes a specific listener', () => {
        let n = 0;
        const fn = () => { n++; };
        on('e', fn);
        emit('e');
        off('e', fn);
        emit('e');
        assert.equal(n, 1);
    });

    it('the unsubscribe returned by on() removes the listener', () => {
        let n = 0;
        const unsub = on('e', () => { n++; });
        emit('e');
        unsub();
        emit('e');
        assert.equal(n, 1);
    });

    it('a throwing handler propagates (matches direct-call semantics)', () => {
        const after = [];
        on('e', () => { throw new Error('boom'); });
        on('e', () => after.push('ran'));
        assert.throws(() => emit('e'), /boom/);
        // the second handler did NOT run — emit aborts on throw, exactly like sequential direct calls
        assert.deepEqual(after, []);
    });

    it('clear removes all subscriptions', () => {
        let n = 0;
        on('e', () => { n++; });
        clear();
        emit('e');
        assert.equal(n, 0);
    });
});

describe('event-bus wiring consistency (static scan of src/)', () => {
    const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

    function walk(dir) {
        let out = [];
        for (const entry of readdirSync(dir)) {
            const p = join(dir, entry);
            if (statSync(p).isDirectory()) out = out.concat(walk(p));
            // skip the bus module itself (defines on/emit generically, no event-name literals)
            else if (/\.(js|mjs)$/.test(entry) && !p.endsWith('event-bus.js')) out.push(p);
        }
        return out;
    }

    // Match bare `emit('x')` / `on('x')` calls — the negative lookbehind excludes `.on(` (Leaflet) and
    // `bindButton(` (whose tail is "...on(").
    const EMIT_RE = /(?<![.\w])emit\(\s*['"]([^'"]+)['"]/g;
    const ON_RE = /(?<![.\w])on\(\s*['"]([^'"]+)['"]/g;

    const emitted = new Set();
    const subscribed = new Set();
    for (const file of walk(SRC)) {
        const txt = readFileSync(file, 'utf8');
        for (const m of txt.matchAll(EMIT_RE)) emitted.add(m[1]);
        for (const m of txt.matchAll(ON_RE)) subscribed.add(m[1]);
    }

    it('found a non-trivial set of events (scan sanity check)', () => {
        assert.ok(emitted.size >= 5, `expected >=5 emitted events, got ${emitted.size}`);
    });

    it('every emitted event has at least one subscriber', () => {
        const orphans = [...emitted].filter(e => !subscribed.has(e));
        assert.deepEqual(orphans, [], `emitted but never subscribed: ${orphans.join(', ')}`);
    });

    it('every subscription has at least one emitter', () => {
        const dead = [...subscribed].filter(e => !emitted.has(e));
        assert.deepEqual(dead, [], `subscribed but never emitted: ${dead.join(', ')}`);
    });
});

// v37.15 — LF-residual advisory detector (updateLfResidualState, shared/model.js) and the
// handler step-5c wrapper (updateLfResidualAdvisory, scheduled-update.js).
// Pure-function tests per analysis/lf-residual-advisory-plan-2026-07-23.md §4:
// latch/deadband/clear semantics, PERCENT-units trap, staleness suppression with latch
// survival, episode documentation, F2 skip-guard, non-fatal writes, and garbage resilience.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { updateLfResidualState, LF_RESIDUAL } = require('../netlify/functions/shared/model.js');
const { updateLfResidualAdvisory } = require('../netlify/functions/scheduled-update.js')._test;

const H = 3600 * 1000;
const T0 = Date.parse('2026-07-23T12:00:00Z');

// Advance the state through hourly cycles; each entry is null (no validation this cycle)
// or an errPct (PERCENT) validated at that cycle's timestamp.
function runCycles(prev, errs, { startMs = T0, lfs = null } = {}) {
    let state = prev;
    errs.forEach((e, i) => {
        const nowMs = startMs + i * H;
        state = updateLfResidualState(state, {
            nowMs,
            pairs: e === null ? [] : [{ at: nowMs, errPct: e, hardFlagged: false }],
            lfCFS: Array.isArray(lfs) ? lfs[i] : lfs
        });
    });
    return state;
}

describe('updateLfResidualState — latch, deadband, clear (rule R2)', () => {
    it('latches ON at err <= -15 and stays across no-pair cycles', () => {
        let s = runCycles(null, [-21]);
        assert.equal(s.active, true);
        assert.equal(s.lastErrPct, -21);
        assert.ok(s.activeSince);
        s = runCycles(s, [null, null, null], { startMs: T0 + H });
        assert.equal(s.active, true, 'latch holds between validations');
    });

    it('a deadband pair (-15 < err <= -7.5) holds the current state, both ways', () => {
        let s = runCycles(null, [-21, -10]);       // latched, then deadband
        assert.equal(s.active, true, 'deadband holds an active latch');
        s = runCycles(null, [-10]);                // deadband from clean
        assert.equal(s.active, false, 'deadband does not latch a clean state');
    });

    it('clears at err > -7.5 (including positive errors)', () => {
        let s = runCycles(null, [-21, -3]);
        assert.equal(s.active, false);
        assert.equal(s.latched, false);
        assert.equal(s.activeSince, null);
        s = runCycles(null, [-21, +40]);
        assert.equal(s.active, false, 'a positive-err pair clears too');
    });

    it('UNITS TRAP: errPct is PERCENT — a fraction (-0.15) must NOT latch', () => {
        const s = runCycles(null, [-0.15]);
        assert.equal(s.active, false);
        assert.equal(s.latched, false);
    });

    it('boundary: exactly -15 latches; exactly -7.5 holds (does not clear)', () => {
        assert.equal(runCycles(null, [-15]).latched, true);
        const held = runCycles(null, [-21, -7.5]);
        assert.equal(held.latched, true, '-7.5 is not > -7.5, so it holds');
    });

    it('a positive-errPct HARD-FLAGGED pair clears a genuine latch (plan F4, accepted behavior)', () => {
        let s = runCycles(null, [-21]);
        s = updateLfResidualState(s, {
            nowMs: T0 + H,
            pairs: [{ at: T0 + H, errPct: +35, hardFlagged: true }]   // e.g. frazil-ice corrupt-LOW LF
        });
        assert.equal(s.latched, false, 'hard-flagged pairs feed the detector like any other');
        assert.equal(s.active, false);
    });

    it('multiple pairs in one cycle apply in `at` order even when passed out of order (defensive)', () => {
        const s = updateLfResidualState(null, {
            nowMs: T0,
            pairs: [
                { at: T0 - 1 * H, errPct: -3 },     // later pair (clears)... passed first
                { at: T0 - 2 * H, errPct: -21 }     // earlier pair (latches)
            ]
        });
        assert.equal(s.latched, false, 'the chronologically-last pair (-3, clear) must win');
        assert.equal(s.lastErrPct, -3);
        assert.equal(s.lastPairAt, T0 - 1 * H);
    });
});

describe('updateLfResidualState — staleness suppression (12h), latch survival', () => {
    it('goes effective-inactive after >12h without a pair; latch survives', () => {
        let s = runCycles(null, [-21]);
        assert.equal(s.active, true);
        s = runCycles(s, Array(13).fill(null), { startMs: T0 + H });   // 13h of no pairs
        assert.equal(s.active, false, 'stale signal suppresses the advisory (fail-closed)');
        assert.equal(s.latched, true, 'the latch itself survives staleness');
        assert.equal(s.activeSince, null, 'activeSince follows EFFECTIVE active');
    });

    it('a mid-deadband pair after a stale gap resumes active WITHOUT re-crossing -15 (backtest fidelity)', () => {
        let s = runCycles(null, [-21]);
        s = runCycles(s, Array(13).fill(null), { startMs: T0 + H });
        assert.equal(s.active, false);
        const resumeAt = T0 + 14 * H;
        s = updateLfResidualState(s, { nowMs: resumeAt, pairs: [{ at: resumeAt, errPct: -10 }] });
        assert.equal(s.active, true, 'latched + fresh deadband pair => active again');
        assert.equal(Date.parse(s.activeSince), resumeAt, 'a NEW activeSince starts at resume');
    });

    it('lastPairAt/lastErrPct survive empty-pairs cycles unchanged', () => {
        let s = runCycles(null, [-21]);
        const { lastPairAt, lastErrPct } = s;
        s = runCycles(s, [null, null, null], { startMs: T0 + H });
        assert.equal(s.lastPairAt, lastPairAt);
        assert.equal(s.lastErrPct, lastErrPct);
    });

    it('exactly 12h old is still fresh; 12h+1ms is stale', () => {
        let s = runCycles(null, [-21]);
        const atLimit = updateLfResidualState(s, { nowMs: T0 + LF_RESIDUAL.signalStaleMs, pairs: [] });
        assert.equal(atLimit.active, true);
        const past = updateLfResidualState(s, { nowMs: T0 + LF_RESIDUAL.signalStaleMs + 1, pairs: [] });
        assert.equal(past.active, false);
    });
});

describe('updateLfResidualState — episode documentation', () => {
    it('episode is null while inactive, initializes at the activating cycle, and counts cycles + pairs', () => {
        let s = runCycles(null, [-3]);
        assert.equal(s.episode, null);
        s = runCycles(null, [-21, null, -18], { lfs: [3000, 3200, 3500] });
        assert.ok(s.episode);
        assert.equal(s.episode.cycles, 3, 'every active cron cycle counts (duty)');
        assert.equal(s.episode.pairCount, 2, 'only validated pairs enter the trail');
        assert.equal(s.episode.worstErrPct, -21);
        assert.equal(s.episode.trail.length, 2);
        assert.equal(s.episode.minLF, 3000);
        assert.equal(s.episode.maxLF, 3500);
        assert.ok(Math.abs(s.episode.sumErrPct - (-39)) < 0.001, 'meanErrPct derivable at emission');
    });

    it('deactivation clears episode on the new state; the PREVIOUS state retains it (caller emits from prev)', () => {
        const active = runCycles(null, [-21, -18], { lfs: 3000 });
        assert.ok(active.episode);
        const after = runCycles(active, [-2], { startMs: T0 + 2 * H });
        assert.equal(after.active, false);
        assert.equal(after.episode, null);
        assert.equal(active.episode.pairCount, 2, 'prev state retains the completed aggregates');
    });

    it('reactivation after a full clear starts a FRESH episode (plan F8-5)', () => {
        let s = runCycles(null, [-21, -2]);                     // latch, then full clear
        assert.equal(s.episode, null);
        s = runCycles(s, [-30], { startMs: T0 + 2 * H, lfs: 4000 });
        assert.equal(s.episode.pairCount, 1, 'no carryover from the first firing');
        assert.equal(s.episode.worstErrPct, -30);
        assert.equal(s.episode.cycles, 1);
        assert.equal(Date.parse(s.episode.startedAt), T0 + 2 * H);
    });

    it('caps the per-pair trail at 336 entries and counts the overflow', () => {
        const s = runCycles(null, Array(340).fill(-20), { lfs: 3000 });
        assert.equal(s.episode.trail.length, 336);
        assert.equal(s.episode.trailDropped, 4);
        assert.equal(s.episode.pairCount, 340, 'aggregates keep counting past the cap');
    });
});

describe('updateLfResidualState — resilience', () => {
    it('never throws on garbage previous state and starts clean', () => {
        for (const garbage of [undefined, null, {}, { latched: 'yes' }, { lastPairAt: 'x', lastErrPct: {} }, { episode: 42 }]) {
            const s = updateLfResidualState(garbage, { nowMs: T0, pairs: [{ at: T0, errPct: -21 }] });
            assert.equal(s.active, true, 'a valid latching pair still works');
        }
        const empty = updateLfResidualState({ active: 'maybe' }, { nowMs: T0, pairs: [] });
        assert.equal(empty.active, false);
    });

    it('ignores malformed pairs (missing at/errPct) without throwing', () => {
        const s = updateLfResidualState(null, {
            nowMs: T0,
            pairs: [null, { at: 'x', errPct: -30 }, { at: T0 }, { errPct: -30 }]
        });
        assert.equal(s.latched, false);
        assert.equal(s.lastPairAt, null);
    });
});

// ─── Handler step 5c wrapper (updateLfResidualAdvisory) ─────────────────────

// Minimal Supabase mock in the observations idiom: select→single resolves the scripted state
// row; upsert/insert are captured and resolve/reject per script.
function stepClient({ stateRow = null, upsertError = null, insertError = null, throwOn = null, captures }) {
    return {
        from() {
            const b = {
                select() { return b; },
                eq() { return b; },
                single() {
                    if (throwOn === 'read') return Promise.reject(new Error('read boom'));
                    return Promise.resolve({ data: stateRow ? { data: stateRow } : null, error: stateRow ? null : { code: 'PGRST116' } });
                },
                upsert(row) {
                    captures.upserts.push(row);
                    if (throwOn === 'upsert') return Promise.reject(new Error('upsert boom'));
                    return Promise.resolve({ error: upsertError });
                },
                insert(row) {
                    captures.inserts.push(row);
                    return Promise.resolve({ error: insertError });
                }
            };
            return b;
        }
    };
}

describe('updateLfResidualAdvisory (handler 5c) — non-fatal + skip-guard', () => {
    const iso = ms => new Date(ms).toISOString();

    it('runs with empty pairs (validation skipped / bare-0 path) and persists a decaying state', async () => {
        const captures = { upserts: [], inserts: [] };
        const client = stepClient({ stateRow: { latched: true, active: true, lastPairAt: Date.now() - 13 * H, lastErrPct: -20, activeSince: iso(T0), updatedAt: iso(Date.now() - 13 * H) }, captures });
        const state = await updateLfResidualAdvisory(client, { runStartMs: Date.now(), pairs: [], lfCFS: 3000 });
        assert.ok(state, 'state written even with no pairs');
        assert.equal(state.active, false, 'stale signal decayed to inactive');
        assert.equal(captures.upserts.length, 1);
    });

    it('rejected upsert does not throw (non-fatal)', async () => {
        const captures = { upserts: [], inserts: [] };
        const client = stepClient({ throwOn: 'upsert', captures });
        const state = await updateLfResidualAdvisory(client, { runStartMs: Date.now(), pairs: [{ at: Date.now(), errPct: -21 }], lfCFS: null });
        assert.ok(state, 'the computed state is still returned for the prediction stamp');
        assert.equal(state.active, true);
    });

    it('throwing client (read) does not throw; returns null', async () => {
        const captures = { upserts: [], inserts: [] };
        const client = stepClient({ throwOn: 'read', captures });
        const state = await updateLfResidualAdvisory(client, { runStartMs: Date.now(), pairs: [], lfCFS: null });
        assert.equal(state, null);
        assert.equal(captures.upserts.length, 0);
    });

    it('F2 skip-guard: no pairs + state written after runStartMs => no write, returns null', async () => {
        const captures = { upserts: [], inserts: [] };
        const runStartMs = Date.now() - 60000;
        const client = stepClient({ stateRow: { latched: true, active: true, lastPairAt: Date.now(), lastErrPct: -20, updatedAt: iso(Date.now()) }, captures });
        const state = await updateLfResidualAdvisory(client, { runStartMs, pairs: [], lfCFS: null });
        assert.equal(state, null);
        assert.equal(captures.upserts.length, 0, 'must not clobber the fresher concurrent write');
    });

    it('with pairs it ALWAYS writes (only one run can hold a claimed pair) even past a fresher state', async () => {
        const captures = { upserts: [], inserts: [] };
        const client = stepClient({ stateRow: { latched: false, active: false, updatedAt: iso(Date.now()) }, captures });
        const state = await updateLfResidualAdvisory(client, { runStartMs: Date.now() - 60000, pairs: [{ at: Date.now(), errPct: -21 }], lfCFS: null });
        assert.ok(state);
        assert.equal(captures.upserts.length, 1);
    });

    it('deactivation emits the episode row (gauge_id = startedAt, meanErrPct appended); insert failure is non-fatal', async () => {
        const startedAt = iso(T0);
        const prev = {
            latched: true, active: true, lastPairAt: Date.now() - 30 * 60000, lastErrPct: -20,
            activeSince: startedAt, updatedAt: iso(Date.now() - 30 * 60000),
            episode: { startedAt, cycles: 5, pairCount: 2, worstErrPct: -21, sumErrPct: -36, minLF: 2800, maxLF: 3900, trail: [], trailDropped: 0 }
        };
        const captures = { upserts: [], inserts: [] };
        const client = stepClient({ stateRow: prev, captures });
        await updateLfResidualAdvisory(client, { runStartMs: Date.now(), pairs: [{ at: Date.now(), errPct: -2 }], lfCFS: 3900 });
        assert.equal(captures.inserts.length, 1);
        const row = captures.inserts[0];
        assert.equal(row.observation_type, 'lf_residual_episode');
        assert.equal(row.gauge_id, startedAt, 'F9: startedAt identity self-dedups concurrent emission');
        assert.equal(row.data.meanErrPct, -18);
        assert.ok(row.data.endedAt);

        // Same transition with a failing insert must not throw.
        const captures2 = { upserts: [], inserts: [] };
        const client2 = stepClient({ stateRow: prev, insertError: { message: 'dup' }, captures: captures2 });
        const state2 = await updateLfResidualAdvisory(client2, { runStartMs: Date.now(), pairs: [{ at: Date.now(), errPct: -2 }], lfCFS: null });
        assert.ok(state2);
    });
});

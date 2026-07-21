// v37.13 — EF divergence advisory detector (updateEfDivergenceState, shared/model.js).
// Pure-function tests per analysis/ef-divergence-advisory-plan-2026-07-20.md §4:
// window/median math, fail-closed rules, strict EF validity, cold lockout hysteresis,
// month proxy, ON/OFF deadband, decay on missing cycles, and garbage-input resilience
// (the handler wraps the call non-fatally, but the helper itself must also never throw).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { updateEfDivergenceState, EF_DIVERGENCE } = require('../netlify/functions/shared/model.js');

const H = 3600 * 1000;
const T0 = Date.parse('2026-07-15T12:00:00Z');   // July → month proxy eligible

// Advance the state through hourly cycles with the given D ratios (efEst = d × porEst).
function runCycles(prev, ratios, { startMs = T0, tempC = 25, porEst = 3000, efAgeMs = 0, lfs = null } = {}) {
    let state = prev;
    ratios.forEach((d, i) => {
        const nowMs = startMs + i * H;
        state = updateEfDivergenceState(state, {
            nowMs,
            efEstimateCFS: d === null ? null : Math.round(d * porEst),
            porEstimateCFS: porEst,
            efReadingMs: d === null ? null : nowMs - efAgeMs,
            waterTempC: tempC,
            lfCFS: Array.isArray(lfs) ? lfs[i] : lfs
        });
    });
    return state;
}

describe('updateEfDivergenceState — window, median, activation', () => {
    it('stays inactive below 3 samples even at huge D (fail-closed)', () => {
        const s = runCycles(null, [1.8, 1.8]);
        assert.equal(s.active, false);
        assert.equal(s.dbar, null);
    });

    it('activates once >=3 samples put the 5h median at/above ON (1.20)', () => {
        const s = runCycles(null, [1.25, 1.22, 1.30]);
        assert.equal(s.dbar, 1.25);          // median of 1.25/1.22/1.30
        assert.equal(s.active, true);
        assert.ok(s.activeSince);
    });

    it('median tolerates one glitch sample (glitch does not activate)', () => {
        const s = runCycles(null, [1.02, 3.5, 1.03]);
        assert.equal(s.dbar, 1.03);
        assert.equal(s.active, false);
    });

    it('deadband: active at 1.17 persists (>= OFF), deactivates below OFF (1.15)', () => {
        let s = runCycles(null, [1.25, 1.25, 1.25]);          // active
        assert.equal(s.active, true);
        const since = s.activeSince;
        s = runCycles(s, [1.17, 1.17, 1.17], { startMs: T0 + 3 * H });
        assert.equal(s.active, true, 'D̄ 1.17 >= OFF keeps it active');
        assert.equal(s.activeSince, since, 'activeSince preserved across active cycles');
        s = runCycles(s, [1.05, 1.05, 1.05], { startMs: T0 + 6 * H });
        assert.equal(s.active, false);
        assert.equal(s.activeSince, null);
    });

    it('fresh (inactive) state needs ON (1.20), not just OFF: D̄ 1.17 does not activate', () => {
        const s = runCycles(null, [1.17, 1.17, 1.17]);
        assert.equal(s.active, false);
    });

    it('decays to inactive when cycles bring no samples (window ages out)', () => {
        let s = runCycles(null, [1.3, 1.3, 1.3]);
        assert.equal(s.active, true);
        s = runCycles(s, [null, null, null, null, null, null], { startMs: T0 + 3 * H });
        assert.equal(s.active, false, 'no frozen-active state (plan F10)');
        assert.equal(s.samples.length, 0, 'retention trim emptied the window');
    });
});

describe('updateEfDivergenceState — strict EF validity (F11/F7)', () => {
    it('current-cycle invalid EF blocks activation even with 3 prior samples', () => {
        let s = runCycles(null, [1.3, 1.3, 1.3]);
        s = updateEfDivergenceState(s, {
            nowMs: T0 + 3 * H, efEstimateCFS: null, porEstimateCFS: 3000,
            efReadingMs: null, waterTempC: 25
        });
        assert.equal(s.active, false);
    });

    it('rejects EF estimates outside (500, 500000) cfs', () => {
        const s = runCycles(null, [1.3, 1.3, 1.3], { porEst: 300 });  // efEst ~390 < 500
        assert.equal(s.samples.length, 0);
        assert.equal(s.active, false);
    });

    it('rejects an EF reading older than 2h (frozen gauge, F7)', () => {
        const s = runCycles(null, [1.3, 1.3, 1.3], { efAgeMs: EF_DIVERGENCE.efMaxAgeMs + 60000 });
        assert.equal(s.samples.length, 0);
        assert.equal(s.active, false);
    });
});

describe('updateEfDivergenceState — temperature eligibility (F12)', () => {
    it('cold water (<=10°C) locks out and deactivates', () => {
        let s = runCycles(null, [1.3, 1.3, 1.3]);
        s = runCycles(s, [1.3], { startMs: T0 + 3 * H, tempC: 9 });
        assert.equal(s.active, false);
        assert.equal(s.coldLockout, true);
    });

    it('10–11°C keeps the lockout; >11°C clears it (1°C hysteresis)', () => {
        let s = runCycles(null, [1.3], { tempC: 9 });
        s = runCycles(s, [1.3, 1.3, 1.3], { startMs: T0 + 1 * H, tempC: 10.5 });
        assert.equal(s.coldLockout, true, '10.5°C must not re-enable');
        assert.equal(s.active, false);
        s = runCycles(s, [1.3, 1.3, 1.3], { startMs: T0 + 4 * H, tempC: 11.5 });
        assert.equal(s.coldLockout, false);
        assert.equal(s.active, true);
    });

    it('unknown temp: month proxy — January ineligible, July eligible', () => {
        const jan = Date.parse('2026-01-15T12:00:00Z');
        const sJan = runCycles(null, [1.3, 1.3, 1.3], { startMs: jan, tempC: null });
        assert.equal(sJan.active, false, 'Nov–Mar unknown-temp is cold-proxied');
        const sJul = runCycles(null, [1.3, 1.3, 1.3], { tempC: null });
        assert.equal(sJul.active, true, 'Apr–Oct unknown-temp is eligible');
    });
});

describe('updateEfDivergenceState — episode documentation (v37.14)', () => {
    it('episode is null while inactive and initializes on activation', () => {
        let s = runCycles(null, [1.02, 1.03]);
        assert.equal(s.episode, null);
        s = runCycles(null, [1.25, 1.22, 1.30], { lfs: [3100, 3200, 3300] });
        assert.ok(s.episode);
        assert.equal(s.episode.cycles, 1, 'episode starts at the activating cycle');
        assert.equal(s.episode.trail.length, 1);
    });

    it('accumulates actual numbers across active cycles: peak/sum D̄, LF range, lfAtPeak', () => {
        // Activation happens at cycle 3 (>=3-sample rule): episode covers cycles 3-6.
        // D̄ is the trailing-5h MEDIAN, so it reaches 1.40 only once high samples dominate
        // the window (cycle 6) — lfAtPeak must be THAT cycle's LF.
        let s = runCycles(null, [1.25, 1.25, 1.25], { lfs: [3000, 3000, 3000] });
        s = runCycles(s, [1.40, 1.40, 1.40], { startMs: T0 + 3 * H, lfs: [5200, 5200, 5200] });
        assert.equal(s.episode.cycles, 4);
        assert.equal(s.episode.peakDbar, 1.40);
        assert.equal(s.episode.lfAtPeak, 5200, 'LF recorded at the peak-D̄ cycle');
        assert.equal(s.episode.minLF, 3000);
        assert.equal(s.episode.maxLF, 5200);
        assert.equal(s.episode.trail.length, 4);
        assert.ok(Math.abs(s.episode.sumDbar / s.episode.cycles - 1.2875) < 0.001, 'mean D̄ derivable');
    });

    it('deactivation clears episode on the new state; the PREVIOUS state still carries it (caller emits the log row from prev)', () => {
        let active = runCycles(null, [1.3, 1.3, 1.3], { lfs: 3500 });
        assert.ok(active.episode);
        const after = runCycles(active, [1.05, 1.05, 1.05], { startMs: T0 + 3 * H });
        assert.equal(after.active, false);
        assert.equal(after.episode, null);
        assert.ok(active.episode.cycles >= 1, 'prev state retains the completed aggregates');
    });

    it('caps the per-cycle trail at 336 entries and counts the overflow', () => {
        const ratios = Array(345).fill(1.3);        // activates at cycle 3 -> 343 active cycles
        const s = runCycles(null, ratios, { lfs: 3000 });
        assert.equal(s.episode.trail.length, 336);
        assert.equal(s.episode.trailDropped, 7);
        assert.equal(s.episode.cycles, 343, 'aggregates keep counting past the cap');
    });
});

describe('fetchUSGSData — stage-reading timestamp capture (F7)', () => {
    const usgsJson = (dateTime) => ({
        value: {
            timeSeries: [{
                sourceInfo: { siteCode: [{ value: '01644148' }] },
                variable: { variableCode: [{ value: '00065' }] },
                values: [{ value: [
                    { value: '3.10', dateTime: '2026-07-20T10:00:00.000-04:00' },
                    { value: '3.20', dateTime }
                ] }]
            }]
        }
    });

    it('captures hTime (epoch ms of the latest stage reading) alongside h', async () => {
        const { fetchUSGSData } = require('../netlify/functions/scheduled-update.js')._test;
        const realFetch = global.fetch;
        const latestISO = '2026-07-20T11:15:00.000-04:00';
        global.fetch = async () => ({ ok: true, json: async () => usgsJson(latestISO) });
        try {
            const out = await fetchUSGSData();
            assert.equal(out.data['01644148'].h, 3.20);
            assert.equal(out.data['01644148'].hTime, new Date(latestISO).getTime());
        } finally {
            global.fetch = realFetch;
        }
    });
});

describe('updateEfDivergenceState — resilience', () => {
    it('never throws on garbage previous state and starts clean', () => {
        for (const garbage of [undefined, null, {}, { samples: 'nope' }, { samples: [{ t: 'x', d: {} }, null] }, { active: 'yes' }]) {
            const s = updateEfDivergenceState(garbage, {
                nowMs: T0, efEstimateCFS: 3900, porEstimateCFS: 3000, efReadingMs: T0, waterTempC: 25
            });
            assert.equal(s.active, false);
            assert.equal(s.samples.length, 1);
        }
    });
});

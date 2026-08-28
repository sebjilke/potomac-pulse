const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    validateForecastPredictions,
    FORECAST_STALE_MAX_AGE_HRS,
} = require('../netlify/functions/scheduled-update')._test;
const {
    getFlowMultiplier, getGFtoLFTravelTime, TRAVEL_GF_LF_BASELINE,
} = require('../netlify/functions/shared/model');

// v37.16 — the forecast validation CLOCK.
//
// A forecast for wall-clock T predicts flow at GREAT FALLS at T. That water only reaches Little
// Falls at T + GF→LF travel, so it must be scored against LF then — the behavior CLAUDE.md and
// tech-appendix §8.6 already documented ("validated when water arrives at LF") but the code did
// not implement: it compared against `lf.q` at T, understating/overstating by one travel time
// (1.65h at 50k cfs, 9.18h at 2.8k, up to 16.95h at the 1,000-cfs floor).
//
// These tests pin the gate itself, not the arithmetic of the error — that is unchanged.

const HOUR = 60 * 60 * 1000;
const LF_ID = '01646500';

// LF flow used across the suite; travel here is a little over 7h.
const LF_CFS = 4110;
const TRAVEL_HRS = getGFtoLFTravelTime(getFlowMultiplier(LF_CFS));

function usgs(qOverride) {
    return {
        data: { [LF_ID]: { q: qOverride === undefined ? LF_CFS : qOverride } },
        gauges: { lf: LF_ID },
    };
}

// Minimal Supabase double covering the four access shapes validateForecastPredictions uses:
// getObsRows (select→eq→order), getObs (select→eq→eq→single), upsertObs, deleteObsById.
function mockClient({ pending, captures }) {
    return {
        from() {
            const q = { op: 'select' };
            const builder = {
                select() { return builder; },
                eq() { return builder; },
                // getObsRows chains .order(...).limit(...), so order must stay chainable.
                order() { return builder; },
                limit() { return Promise.resolve({ data: pending, error: null }); },
                single() { return Promise.resolve({ data: null, error: { code: 'PGRST116' } }); },
                upsert(row) { captures.upserts.push(row); return Promise.resolve({ error: null }); },
                insert(row) { captures.inserts.push(row); return Promise.resolve({ error: null }); },
                delete() { q.op = 'delete'; return builder; },
                then(resolve, reject) {
                    if (q.op === 'delete') {
                        captures.deletes.push(true);
                        return Promise.resolve({ error: null }).then(resolve, reject);
                    }
                    return Promise.resolve({ data: null, error: null }).then(resolve, reject);
                },
            };
            return builder;
        },
    };
}

function forecastRow(overrides = {}, dataOverrides = {}) {
    return {
        id: 'f1',
        gauge_id: '+24h_1700000000000',
        created_at: new Date(Date.now() - 24 * HOUR).toISOString(),
        data: {
            horizon: 24,
            targetTime: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // target passed 30min ago
            predictedCFS: 4200,
            predictedStage: 3.2,
            source: 'NWS',
            createdAt: new Date(Date.now() - 24 * HOUR).toISOString(),
            travelApplied: true,
            persistenceCFS: 4000,
            ...dataOverrides,
        },
        ...overrides,
    };
}

function freshCaptures() {
    return { upserts: [], inserts: [], deletes: [] };
}

describe('forecast validation clock (v37.16)', () => {
    it('does NOT validate a travel-applied forecast merely because targetTime has passed', async () => {
        // Pre-v37.16 this validated immediately — that was the defect.
        const captures = freshCaptures();
        const client = mockClient({ pending: [forecastRow()], captures });

        const res = await validateForecastPredictions(client, usgs());

        assert.equal(res.validated, 0, 'must wait for the water to reach Little Falls');
        assert.equal(captures.upserts.length, 0, 'no metadata may accrue before the water arrives');
        assert.equal(captures.deletes.length, 0, 'the pending row must survive to be scored later');
    });

    it('validates once targetTime + GF→LF travel has elapsed', async () => {
        const captures = freshCaptures();
        // Target passed travel + 1h ago → ripe.
        const row = forecastRow({}, {
            targetTime: new Date(Date.now() - (TRAVEL_HRS + 1) * HOUR).toISOString(),
        });
        const client = mockClient({ pending: [row], captures });

        const res = await validateForecastPredictions(client, usgs());

        assert.equal(res.validated, 1);
        assert.equal(captures.deletes.length, 1, 'validated row is claimed by deletion');
        const meta = captures.upserts.find(u => u.observation_type === 'gf_forecast_metadata');
        assert.ok(meta, 'metadata row must be written');
        assert.equal(meta.gauge_id, '+24h');
        assert.equal(meta.data.validations, 1);
    });

    it('does NOT defer a PoR-fallback forecast — it is already GF-at-T referenced', async () => {
        // When the NWS LF series is unavailable the client interpolates PoR at targetGFHrs with no
        // travel offset, so deferring these rows would be a NEW mis-scoring (audit finding M5).
        const captures = freshCaptures();
        const client = mockClient({ pending: [forecastRow({}, { travelApplied: false })], captures });

        const res = await validateForecastPredictions(client, usgs());

        assert.equal(res.validated, 1, 'no travel offset applies to the PoR fallback path');
    });

    it('treats a row written before v37.16 (no travelApplied key) as un-deferred', async () => {
        const captures = freshCaptures();
        const bare = forecastRow();
        delete bare.data.travelApplied;
        const client = mockClient({ pending: [bare], captures });

        const res = await validateForecastPredictions(client, usgs());

        assert.equal(res.validated, 1, 'absent flag ⇒ pre-v37.16 clock, so legacy rows still drain');
    });

    it('scales the deferral with flow — a low-flow forecast waits much longer', async () => {
        // Same row, two flows. At the 1,000-cfs floor travel is ~16.95h; at 50k it is ~1.65h.
        const row = () => forecastRow({}, {
            targetTime: new Date(Date.now() - 3 * HOUR).toISOString(), // 3h past target
        });

        const lowCaps = freshCaptures();
        const lowRes = await validateForecastPredictions(
            mockClient({ pending: [row()], captures: lowCaps }), usgs(1000));
        assert.equal(lowRes.validated, 0, 'at 1,000 cfs the water is still ~14h from Little Falls');

        const highCaps = freshCaptures();
        const highRes = await validateForecastPredictions(
            mockClient({ pending: [row()], captures: highCaps }), usgs(50000));
        assert.equal(highRes.validated, 1, 'at 50,000 cfs travel is ~1.65h, so 3h is ripe');
    });

    it('stale threshold covers the longest deferred window (+48h at the discharge floor)', () => {
        const maxTravel = getGFtoLFTravelTime(getFlowMultiplier(1000));
        assert.ok(maxTravel < 17, `max GF→LF travel should be ~16.95h, got ${maxTravel}`);
        // The row that ripens latest is +48h at the floor.
        const latestRipenessHrs = 48 + maxTravel;
        assert.ok(
            FORECAST_STALE_MAX_AGE_HRS > latestRipenessHrs,
            `stale threshold ${FORECAST_STALE_MAX_AGE_HRS}h must exceed latest ripeness ${latestRipenessHrs.toFixed(2)}h`
        );
        // And it must retain real margin for a missed cron run, not just barely clear it.
        assert.ok(
            FORECAST_STALE_MAX_AGE_HRS - latestRipenessHrs >= 24,
            'want ≥24h of margin between latest ripeness and the stale sweep'
        );
    });

    it('deletes a row whose targetTime cannot be parsed instead of scoring garbage', async () => {
        // `now < new Date(NaN)` is false, so without the guard such a row validates immediately
        // against whatever LF happens to be.
        const captures = freshCaptures();
        const client = mockClient({ pending: [forecastRow({}, { targetTime: 'not-a-date' })], captures });

        const res = await validateForecastPredictions(client, usgs());

        assert.equal(res.validated, 0, 'must not score a row with no usable target time');
        assert.equal(res.cleaned, 1);
        assert.equal(captures.upserts.length, 0, 'no metadata may accrue from a corrupt row');
    });

    it('scores persistence but no longer accrues the retired NWS baselines', async () => {
        const captures = freshCaptures();
        const row = forecastRow({}, {
            targetTime: new Date(Date.now() - (TRAVEL_HRS + 1) * HOUR).toISOString(),
            // a legacy row may still carry them; they must be ignored
            nwsLfRawCFS: 3900,
            nwsLfBiasCorrectedCFS: 3950,
        });
        const client = mockClient({ pending: [row], captures });

        await validateForecastPredictions(client, usgs());

        const meta = captures.upserts.find(u => u.observation_type === 'gf_forecast_metadata');
        assert.ok(meta.data.persistenceValidations >= 1, 'persistence is the surviving baseline');
        assert.equal(meta.data.nwsRawValidations, undefined, 'retired baseline must not accrue');
        assert.equal(meta.data.nwsCorrectedValidations, undefined, 'retired baseline must not accrue');
    });

    it('processes rows in ripeness order, not insertion order', async () => {
        // Both rows are ripe, so the ripeness GATE cannot explain the ordering — only the sort can.
        // The row that is due EARLIER (targetTime further in the past) was created LATER, so
        // created_at order would process them backwards. Fed to the mock in created_at order, which
        // is what the DB query returns.
        const captures = freshCaptures();
        const dueLater = forecastRow({
            id: 'old48',
            created_at: new Date(Date.now() - 60 * HOUR).toISOString(),
        }, {
            horizon: 48,
            targetTime: new Date(Date.now() - (TRAVEL_HRS + 2) * HOUR).toISOString(),
        });
        const dueEarlier = forecastRow({
            id: 'new6',
            created_at: new Date(Date.now() - 10 * HOUR).toISOString(),
        }, {
            horizon: 6,
            targetTime: new Date(Date.now() - (TRAVEL_HRS + 9) * HOUR).toISOString(),
        });

        const client = mockClient({ pending: [dueLater, dueEarlier], captures });
        const res = await validateForecastPredictions(client, usgs());

        assert.equal(res.validated, 2, 'both rows are ripe and must be scored');
        const order = captures.upserts
            .filter(u => u.observation_type === 'gf_forecast_metadata')
            .map(u => u.gauge_id);
        assert.deepEqual(order, ['+6h', '+48h'],
            'the earlier-due row must be processed first even though it was created later');
    });

    it('does not starve a ripe row sitting behind an un-ripe long-horizon backlog', async () => {
        const captures = freshCaptures();
        const unripeOld = forecastRow({
            id: 'old48',
            created_at: new Date(Date.now() - 40 * HOUR).toISOString(),
        }, {
            horizon: 48,
            targetTime: new Date(Date.now() + 8 * HOUR).toISOString(), // still in the future
        });
        const ripeNew = forecastRow({
            id: 'new6',
            created_at: new Date(Date.now() - 10 * HOUR).toISOString(),
        }, {
            horizon: 6,
            targetTime: new Date(Date.now() - (TRAVEL_HRS + 1) * HOUR).toISOString(),
        });

        const client = mockClient({ pending: [unripeOld, ripeNew], captures });
        const res = await validateForecastPredictions(client, usgs());

        assert.equal(res.validated, 1, 'the ripe short-horizon row must be scored');
        const meta = captures.upserts.find(u => u.observation_type === 'gf_forecast_metadata');
        assert.equal(meta.gauge_id, '+6h', 'the +6h row is the one that was due');
    });

    it('derives the travel offset from the same shared helper the nowcast uses', () => {
        // Guards against a fourth GF→LF travel number appearing in the codebase.
        const mult = getFlowMultiplier(LF_CFS);
        assert.equal(TRAVEL_HRS, TRAVEL_GF_LF_BASELINE * mult);
    });
});

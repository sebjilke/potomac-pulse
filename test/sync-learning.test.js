const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildForecastRows } = require('../netlify/functions/sync-learning')._test;

// C24: the storeForecastPredictions insert used to drop the three NWS/persistence
// baseline fields, so scheduled-update.js could never score forecast skill against
// them. These tests pin that the baselines survive into the stored row.
describe('buildForecastRows (C24 baseline passthrough)', () => {
    const TS = 1700000000000;
    const fullForecast = {
        horizon: 24,
        targetTime: '2026-06-16T12:00:00.000Z',
        predictedCFS: 8000,
        predictedStage: 4.2,
        source: 'nws-lf',
        createdAt: '2026-06-16T00:00:00.000Z',
        nwsLfRawCFS: 7800,
        nwsLfBiasCorrectedCFS: 7950,
        persistenceCFS: 8100,
    };

    it('preserves the three baseline fields when the client provides them', () => {
        const [row] = buildForecastRows([fullForecast], TS);
        assert.equal(row.data.nwsLfRawCFS, 7800);
        assert.equal(row.data.nwsLfBiasCorrectedCFS, 7950);
        assert.equal(row.data.persistenceCFS, 8100);
    });

    it('stores the baseline keys as null (not absent) when missing, so the scorer skips cleanly', () => {
        const { nwsLfRawCFS, nwsLfBiasCorrectedCFS, persistenceCFS, ...bare } = fullForecast;
        const [row] = buildForecastRows([bare], TS);
        assert.equal(row.data.nwsLfRawCFS, null);
        assert.equal(row.data.nwsLfBiasCorrectedCFS, null);
        assert.equal(row.data.persistenceCFS, null);
        // keys must exist so the row shape is stable
        assert.ok('nwsLfRawCFS' in row.data);
        assert.ok('persistenceCFS' in row.data);
    });

    it('keeps the core fields and gauge_id/observation_type shape intact', () => {
        const [row] = buildForecastRows([fullForecast], TS);
        assert.equal(row.observation_type, 'gf_forecast_pending');
        assert.equal(row.gauge_id, `+24h_${TS}`);
        assert.equal(row.data.horizon, 24);
        assert.equal(row.data.predictedCFS, 8000);
        assert.equal(row.data.source, 'nws-lf');
    });

    it('filters out malformed forecasts (missing horizon or targetTime)', () => {
        const rows = buildForecastRows(
            [fullForecast, null, {}, { horizon: 6 }, { targetTime: 'x' }],
            TS
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].data.horizon, 24);
    });
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildForecastRows, validateGFWritePayload } = require('../netlify/functions/sync-learning')._test;

// C24 pinned that the three NWS/persistence baselines survive into the stored row.
// v37.16 RE-BASELINED this deliberately: the two NWS baselines were retired. Once the
// model is validated on the GF clock (targetTime + GF→LF travel), a same-clock NWS
// baseline is the model by construction — nwsLfBiasCorrected is the identical integer and
// nwsLfRaw is the model minus the batch-constant lfBiasOffset — so neither can carry skill
// information. Persistence (observed LF) is the one external reference that survives, and
// `travelApplied` is new: it tells the validator which clock the row belongs on.
describe('buildForecastRows (baseline passthrough + v37.16 travel clock)', () => {
    const TS = 1700000000000;
    const fullForecast = {
        horizon: 24,
        targetTime: '2026-06-16T12:00:00.000Z',
        predictedCFS: 8000,
        predictedStage: 4.2,
        source: 'nws-lf',
        createdAt: '2026-06-16T00:00:00.000Z',
        travelApplied: true,
        persistenceCFS: 8100,
    };

    it('preserves the persistence baseline when the client provides it', () => {
        const [row] = buildForecastRows([fullForecast], TS);
        assert.equal(row.data.persistenceCFS, 8100);
    });

    it('no longer persists the two retired NWS baselines, even if a legacy client sends them', () => {
        const [row] = buildForecastRows(
            [{ ...fullForecast, nwsLfRawCFS: 7800, nwsLfBiasCorrectedCFS: 7950 }],
            TS
        );
        assert.ok(!('nwsLfRawCFS' in row.data));
        assert.ok(!('nwsLfBiasCorrectedCFS' in row.data));
        // the surviving baseline is unaffected by the legacy extras
        assert.equal(row.data.persistenceCFS, 8100);
    });

    it('stores persistenceCFS as null (not absent) when missing, so the scorer skips cleanly', () => {
        const { persistenceCFS, ...bare } = fullForecast;
        const [row] = buildForecastRows([bare], TS);
        assert.equal(row.data.persistenceCFS, null);
        // key must exist so the row shape is stable
        assert.ok('persistenceCFS' in row.data);
    });

    it('coerces travelApplied to a strict boolean so the validator cannot be fooled by a truthy value', () => {
        const [t] = buildForecastRows([fullForecast], TS);
        assert.equal(t.data.travelApplied, true);

        const [f] = buildForecastRows([{ ...fullForecast, travelApplied: false }], TS);
        assert.equal(f.data.travelApplied, false);

        // absent ⇒ false ⇒ validator uses the pre-v37.16 clock (no travel deferral)
        const { travelApplied, ...noFlag } = fullForecast;
        const [n] = buildForecastRows([noFlag], TS);
        assert.equal(n.data.travelApplied, false);

        // a truthy non-boolean must not become `true`
        const [s] = buildForecastRows([{ ...fullForecast, travelApplied: 'yes' }], TS);
        assert.equal(s.data.travelApplied, false);
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

// C13: the public /api/sync write path must reject out-of-range nested payloads
// before they reach the learning bins.
describe('validateGFWritePayload (C13 write-path bounds)', () => {
    const NOW = Date.parse('2026-06-16T12:00:00.000Z');
    const validPrediction = () => ({
        action: 'storePrediction',
        prediction: {
            predictedCFS: 9000, validationDue: '2026-06-16T18:00:00.000Z',
            flowBin: '6000-12000', flowState: 'steady',
            porCFS: 8000, monocacyCFS: 600, gooseCFS: 200,
            efStage: 4.1, predictedStage: 4.0, travelTimeGFtoLF: 6.5,
        }
    });
    const validForecasts = () => ({
        action: 'storeForecastPredictions',
        forecasts: [{ horizon: 24, targetTime: '2026-06-17T06:00:00.000Z', predictedCFS: 9000, predictedStage: 4.0, nwsLfRawCFS: 8800 }]
    });

    it('accepts a well-formed prediction', () => assert.equal(validateGFWritePayload(validPrediction(), NOW), null));
    it('accepts well-formed forecasts', () => assert.equal(validateGFWritePayload(validForecasts(), NOW), null));
    it('ignores non-write actions (PIN-gated elsewhere)', () => {
        assert.equal(validateGFWritePayload({ action: 'resetGFLearning', pin: '0000' }, NOW), null);
    });

    it('rejects missing prediction object', () => {
        assert.ok(validateGFWritePayload({ action: 'storePrediction' }, NOW));
    });
    it('rejects predictedCFS over the ceiling', () => {
        const b = validPrediction(); b.prediction.predictedCFS = 9_000_000;
        assert.match(validateGFWritePayload(b, NOW), /predictedCFS/);
    });
    it('rejects non-numeric / NaN / negative predictedCFS', () => {
        for (const v of ['9000', NaN, Infinity, -5, null]) {
            const b = validPrediction(); b.prediction.predictedCFS = v;
            assert.ok(validateGFWritePayload(b, NOW), `should reject predictedCFS=${v}`);
        }
    });
    it('rejects unparseable or far-future validationDue', () => {
        for (const v of ['not-a-date', '2030-01-01T00:00:00Z', '2026-06-10T00:00:00Z']) {
            const b = validPrediction(); b.prediction.validationDue = v;
            assert.ok(validateGFWritePayload(b, NOW), `should reject validationDue=${v}`);
        }
    });
    it('rejects an injected flowBin or flowState (bin-key poisoning)', () => {
        const b1 = validPrediction(); b1.prediction.flowBin = '999999-evil';
        assert.match(validateGFWritePayload(b1, NOW), /flowBin/);
        const b2 = validPrediction(); b2.prediction.flowState = 'plummeting';
        assert.match(validateGFWritePayload(b2, NOW), /flowState/);
    });

    it('rejects an oversized forecasts array', () => {
        const b = validForecasts();
        b.forecasts = Array.from({ length: 17 }, () => ({ horizon: 24, targetTime: '2026-06-17T06:00:00.000Z', predictedCFS: 9000 }));
        assert.match(validateGFWritePayload(b, NOW), /too many/);
    });
    it('rejects a non-integer horizon that would pass the insert filter', () => {
        const b = validForecasts(); b.forecasts[0].horizon = '24evil';
        assert.match(validateGFWritePayload(b, NOW), /horizon/);
    });
    it('rejects forecast predictedCFS over the ceiling', () => {
        const b = validForecasts(); b.forecasts[0].predictedCFS = 9_000_000;
        assert.match(validateGFWritePayload(b, NOW), /predictedCFS/);
    });

    // Cross-field coupling (the critical bypass the panel found)
    it('rejects a flowBin inconsistent with predictedCFS (free bin-targeting)', () => {
        const b = validPrediction(); b.prediction.predictedCFS = 500000; b.prediction.flowBin = '0-3000';
        assert.match(validateGFWritePayload(b, NOW), /inconsistent/);
    });
    it('allows an adjacent-bin flowBin (boundary rounding)', () => {
        const b = validPrediction(); b.prediction.predictedCFS = 5900; b.prediction.flowBin = '6000-12000'; // getFlowBin(5900)='3000-6000', adjacent
        assert.equal(validateGFWritePayload(b, NOW), null);
    });
    it('rejects a missing/null flowBin or flowState (phantom bin)', () => {
        const b1 = validPrediction(); b1.prediction.flowBin = null;
        assert.match(validateGFWritePayload(b1, NOW), /flowBin/);
        const b2 = validPrediction(); delete b2.prediction.flowState;
        assert.match(validateGFWritePayload(b2, NOW), /flowState/);
    });
    it('rejects oversized or non-string forecast.source', () => {
        const b1 = validForecasts(); b1.forecasts[0].source = 'x'.repeat(41);
        assert.match(validateGFWritePayload(b1, NOW), /source/);
        const b2 = validForecasts(); b2.forecasts[0].source = { evil: 1 };
        assert.match(validateGFWritePayload(b2, NOW), /source/);
    });
    it('rejects a bogus forecast.createdAt', () => {
        const b = validForecasts(); b.forecasts[0].createdAt = 'TOTALLY BOGUS';
        assert.match(validateGFWritePayload(b, NOW), /createdAt/);
    });
    it('rejects duplicate forecast horizons in a batch (self-DoS)', () => {
        const b = validForecasts();
        b.forecasts = [
            { horizon: 6, targetTime: '2026-06-16T18:00:00.000Z', predictedCFS: 9000 },
            { horizon: 6, targetTime: '2026-06-16T18:00:00.000Z', predictedCFS: 9100 },
        ];
        assert.match(validateGFWritePayload(b, NOW), /duplicate/);
    });
});

// (v37.1) The System-1 saveLearningData honest-failure tests (C46) were removed with the
// gauge-learning sync retirement. C49 "don't fabricate gauge stage" lives in fetch.js and is
// unaffected. C24 forecast-baseline passthrough and the GF write-payload validation remain above.

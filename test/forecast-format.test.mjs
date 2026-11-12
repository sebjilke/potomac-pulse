// v39.8 (C1): forecast card display text. Pure functions; nothing here may change a forecast period.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    roundForecastCfs, forecastTrend, forecastSourceLabel, forecastSourceLine, isRoundedForecastPoint
} from '../src/ui/forecast-format.js';

describe('roundForecastCfs', () => {
    const cases = [[994, 990], [995, 1000], [4974, 4950], [4975, 5000], [10812, 10800], [0, 0], [4, 0], [5, 10], [4999, 5000], [5049, 5000], [5050, 5100]];
    for (const [i, o] of cases) it(`${i} -> ${o}`, () => assert.equal(roundForecastCfs(i), o));
});

describe('forecastTrend (PA-5)', () => {
    it('the audit example: Now 10,812 and +6h 10,830 both display as 10,800, so the arrow is flat', () => {
        assert.equal(forecastTrend(10830, 10812), 'flat');
    });
    it('different displayed values follow the raw direction', () => {
        assert.equal(forecastTrend(10950, 10812), 'up');
        assert.equal(forecastTrend(10600, 10812), 'down');
        assert.equal(forecastTrend(5000, 5000), 'flat');
    });
    it('never contradicts the displayed numbers: up only when the rounded card value is higher', () => {
        for (let now = 900; now < 12000; now += 37) {
            for (const d of [-250, -60, -11, -1, 0, 1, 11, 60, 250]) {
                const cfs = now + d;
                const t = forecastTrend(cfs, now);
                const r = roundForecastCfs(cfs), rn = roundForecastCfs(now);
                if (t === 'up') assert.ok(r > rn, `${now} -> ${cfs}`);
                if (t === 'down') assert.ok(r < rn, `${now} -> ${cfs}`);
                if (r === rn) assert.equal(t, 'flat');
            }
        }
    });
});

describe('source labels (PA-9, PA-11)', () => {
    it('NWS and NWS+EF share one visible line; the EF blend is in the hover text only', () => {
        const a = forecastSourceLabel('NWS'), b = forecastSourceLabel('NWS+EF');
        assert.equal(a.text, 'Source: National Weather Service forecast');
        assert.equal(b.text, a.text);
        assert.equal(a.title, 'National Weather Service forecast (arrival time varies with flow)');
        assert.equal(b.title, 'National Weather Service forecast, blended with the Edwards Ferry forecast (arrival time varies with flow)');
    });
    it('extrapolated: the line and the hover text are not the NWS text', () => {
        const x = forecastSourceLabel('extrapolated');
        assert.equal(x.text, 'No Weather Service forecast. Rough projection.');
        assert.equal(x.title, 'No National Weather Service forecast available. A rough projection from the current estimate and the upstream reading.');
        assert.ok(!/straight-line/.test(x.title));
    });
    it('forecastSourceLine reads the periods', () => {
        const now = { isCurrent: true, source: 'estimate' };
        assert.equal(forecastSourceLine([now, { source: 'extrapolated' }, { source: 'extrapolated' }]).text, 'No Weather Service forecast. Rough projection.');
        assert.equal(forecastSourceLine([now, { source: 'NWS' }]).text, 'Source: National Weather Service forecast');
        assert.match(forecastSourceLine([now, { source: 'NWS' }, { source: 'NWS+EF' }]).title, /Edwards Ferry/);
    });
    it('no jargon abbreviations in any visible source text', () => {
        for (const s of ['NWS', 'NWS+EF', 'extrapolated']) assert.ok(!/\bNWS\b|\bEF\b/.test(forecastSourceLabel(s).text));
    });
});

describe('tooltip scope (PA-4)', () => {
    it('forecast points are rounded; history and the Now point are not', () => {
        assert.equal(isRoundedForecastPoint({ hrs: 6, isHistory: false }), true);
        assert.equal(isRoundedForecastPoint({ hrs: 0, isHistory: false }), false);
        assert.equal(isRoundedForecastPoint({ hrs: 0, isHistory: true }), false);
        assert.equal(isRoundedForecastPoint({ hrs: -5, isHistory: true }), false);
    });
});

describe('nothing is mutated', () => {
    it('a frozen period is untouched by the helpers', () => {
        const p = Object.freeze({ cfs: 10812, stage: 6.4321, source: 'NWS+EF' });
        roundForecastCfs(p.cfs); forecastSourceLabel(p.source); forecastTrend(p.cfs, 10000);
        forecastSourceLine(Object.freeze([p]));
        assert.deepEqual({ ...p }, { cfs: 10812, stage: 6.4321, source: 'NWS+EF' });
    });
});

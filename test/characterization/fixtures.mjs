// Potomac Pulse — Phase-0 characterization fixtures (pure data, no imports of
// source modules — those can't be imported directly; the harness injects them).
//
// Each fixture builds the SAME input shape consumed by both estimators:
//   data        keyed by USGS gauge id (+ ef stage at 01644148)
//   porHistory  ascending-by-timestamp PoR readings, includes a current (0h) entry
//   waterTempC  for EF cold/warm model selection
//   gfLearningData  EMA correction bins (null = no learning)
//   edwardsFerryData  EF current stage + short history (history<4 => trend null =>
//                     hysteresis multiplier 1.0, so EF is apples-to-apples vs server)
//
// NOW is fixed; the harness freezes Date.now() to it so both sides are deterministic.

export const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

export const GAUGES = {
    por: '01638500', lf: '01646500', monocacy: '01643000',
    goose: '01644000', broadRun: '01644280', seneca: '01645000', ef: '01644148',
};

// Dense PoR series at 10-min cadence over the trailing 7h.
// cfs(h) = current - perHourDelta*h  → perHourDelta>0 rising, <0 falling, 0 steady.
function porSeries(current, perHourDelta) {
    const pts = [];
    for (let m = 0; m <= 7 * 60; m += 10) {
        const h = m / 60;
        pts.push({ timestamp: NOW - h * HOUR, cfs: Math.round(current - perHourDelta * h), stage: null });
    }
    return pts.sort((a, b) => a.timestamp - b.timestamp);
}

// EF state with <4 history entries → getEdwardsFerryTrend() returns null →
// hysteresis multiplier defaults to 1.0 → client EF == server EF formula.
function efState(stage) {
    return { current: { stage, timestamp: NOW }, history: [{ stage, timestamp: NOW }], correlation: null };
}

function baseData({ por, lf, lfH, mon, goose, broadRun, seneca, efStage }) {
    return {
        '01638500': { q: por, h: null },
        '01646500': { q: lf, h: lfH },
        '01643000': { q: mon },
        '01644000': { q: goose },
        '01644280': { q: broadRun },
        '01645000': { q: seneca },
        '01644148': { h: efStage },
    };
}

export const FIXTURES = [
    {
        name: 'low-steady-warm',
        desc: 'Low flow (~2.5k), steady, warm water. EF weight ~0.',
        expectResult: true,
        build: () => ({
            data: baseData({ por: 2400, lf: 2500, lfH: 2.85, mon: 200, goose: 90, broadRun: 20, seneca: 25, efStage: 2.6 }),
            porHistory: porSeries(2400, 0),
            waterTempC: 18,
            gfLearningData: null,
            edwardsFerryData: efState(2.6),
        }),
    },
    {
        name: 'normal-steady-warm',
        desc: 'Normal flow (~5k), steady, warm water.',
        expectResult: true,
        build: () => ({
            data: baseData({ por: 4800, lf: 5000, lfH: 3.35, mon: 400, goose: 180, broadRun: 40, seneca: 50, efStage: 3.5 }),
            porHistory: porSeries(4800, 0),
            waterTempC: 18,
            gfLearningData: null,
            edwardsFerryData: efState(3.5),
        }),
    },
    {
        name: 'elevated-rising-warm',
        desc: 'Elevated (~12k), PoR rising 9k→13k over 6h (exercises wave celerity + time-shift).',
        expectResult: true,
        build: () => ({
            data: baseData({ por: 13000, lf: 12000, lfH: 3.92, mon: 900, goose: 400, broadRun: 90, seneca: 110, efStage: 5.2 }),
            porHistory: porSeries(13000, (13000 - 9000) / 6),
            waterTempC: 15,
            gfLearningData: null,
            edwardsFerryData: efState(5.2),
        }),
    },
    {
        name: 'high-falling-warm',
        desc: 'High (~25k LF), PoR falling 30k→22k over 6h.',
        expectResult: true,
        build: () => ({
            data: baseData({ por: 22000, lf: 25000, lfH: 5.30, mon: 1500, goose: 700, broadRun: 150, seneca: 200, efStage: 7.6 }),
            porHistory: porSeries(22000, (22000 - 30000) / 6),
            waterTempC: 12,
            gfLearningData: null,
            edwardsFerryData: efState(7.6),
        }),
    },
    {
        name: 'cold-water-normal',
        desc: 'Normal flow, steady, COLD water (≤10°C) → cold EF coefficients on both sides.',
        expectResult: true,
        build: () => ({
            data: baseData({ por: 4800, lf: 5000, lfH: 3.35, mon: 400, goose: 180, broadRun: 40, seneca: 50, efStage: 3.5 }),
            porHistory: porSeries(4800, 0),
            waterTempC: 5,
            gfLearningData: null,
            edwardsFerryData: efState(3.5),
        }),
    },
    {
        name: 'with-learning-correction',
        desc: 'Normal flow, steady, with a populated EMA bin (+900). Client applies it; server stores raw. Expect divergence ≈ correction.',
        expectResult: true,
        build: () => ({
            data: baseData({ por: 4800, lf: 5000, lfH: 3.35, mon: 400, goose: 180, broadRun: 40, seneca: 50, efStage: 3.5 }),
            porHistory: porSeries(4800, 0),
            waterTempC: 18,
            gfLearningData: {
                correctionBins: {
                    '3000-6000': {
                        steady: { count: 12, meanError: 900, emaMeanError: 900, sumErrorSq: 10_200_000 },
                    },
                },
            },
            edwardsFerryData: efState(3.5),
        }),
    },
    {
        name: 'glitch-history',
        desc: 'Elevated, rising, with one stale-high glitch (40k) 1.5h ago. Client selectHistoricReading/robust drops it; server uses raw nearest.',
        expectResult: true,
        build: () => {
            const ph = porSeries(12000, (12000 - 10000) / 6);
            // Inject a glitch ~1.5h ago.
            const target = NOW - 1.5 * HOUR;
            let nearest = ph[0];
            for (const e of ph) if (Math.abs(e.timestamp - target) < Math.abs(nearest.timestamp - target)) nearest = e;
            nearest.cfs = 40000;
            return {
                data: baseData({ por: 12000, lf: 12000, lfH: 3.92, mon: 900, goose: 400, broadRun: 90, seneca: 110, efStage: 5.0 }),
                porHistory: ph,
                waterTempC: 15,
                gfLearningData: null,
                edwardsFerryData: efState(5.0),
            };
        },
    },
    {
        name: 'sparse-history',
        desc: 'Only 2 PoR points → client getPoRRiseRate() null (NWS-trend fallback); server getFlowState <8 entries → steady.',
        expectResult: true,
        build: () => ({
            data: baseData({ por: 5000, lf: 5000, lfH: 3.35, mon: 400, goose: 180, broadRun: 40, seneca: 50, efStage: 3.5 }),
            porHistory: [
                { timestamp: NOW - 0.5 * HOUR, cfs: 5000, stage: null },
                { timestamp: NOW, cfs: 5000, stage: null },
            ],
            waterTempC: 18,
            gfLearningData: null,
            edwardsFerryData: efState(3.5),
        }),
    },
];

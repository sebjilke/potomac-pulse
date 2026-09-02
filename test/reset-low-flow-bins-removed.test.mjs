// v37.18 (TODO #28): `resetLowFlowBins` was a v24 ice-cleanup admin action, confirmed dead by the
// user 2026-09-02 and removed. It was actively harmful while it existed: it deleted only 12 of the
// 28 correction bins but upserted a `newMeta` literal that REPLACED the whole metadata jsonb, so the
// surviving high-flow bins kept their observation counts while every counter restarted at 0 —
// permanently desynchronising the diagnostics from the bins. This locks the removal so it cannot
// return by accident (the same guard pattern as test/system1-removed.test.mjs for v37.1).
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('v37.18: resetLowFlowBins is fully removed', () => {
    const files = {
        'netlify/functions/sync-learning.js': read('../netlify/functions/sync-learning.js'),
        'src/learning/gf-learning.js': read('../src/learning/gf-learning.js'),
        'src/init.js': read('../src/init.js'),
        'index.html': read('../index.html')
    };

    for (const [name, src] of Object.entries(files)) {
        it(`${name} has no resetLowFlowBins reference`, () => {
            assert.ok(!src.includes('resetLowFlowBins'), `${name} still references resetLowFlowBins`);
            assert.ok(!src.includes('resetLowFlowBinsBtn'), `${name} still references the button id`);
        });
    }

    it('the other two PIN-gated admin actions survive', () => {
        const s = files['netlify/functions/sync-learning.js'];
        assert.ok(s.includes("action === 'resetGFLearning'"), 'resetGFLearning removed by mistake');
        assert.ok(s.includes("action === 'resetForecastAccuracy'"), 'resetForecastAccuracy removed by mistake');
    });

    it('resetGFLearning preserves bin-write health across the metadata replace (TODO #28)', () => {
        const s = files['netlify/functions/sync-learning.js'];
        // The upsert replaces the whole jsonb, so anything not named here is destroyed.
        for (const f of ['binWriteSuccesses: oldMeta.binWriteSuccesses',
                         'binWriteFailures: oldMeta.binWriteFailures',
                         'lastBinError: oldMeta.lastBinError']) {
            assert.ok(s.includes(f), `resetGFLearning drops ${f.split(':')[0]} — health telemetry is not learning state`);
        }
        // Learning stats must still be explicitly zeroed, not carried over.
        assert.ok(/totalValidations: 0/.test(s) && /validValidations: 0/.test(s), 'learning stats must reset');
    });
});

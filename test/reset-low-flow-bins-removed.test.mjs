// v37.18 (TODO #28): `resetLowFlowBins` was a v24 ice-cleanup admin action, confirmed dead by the
// user 2026-09-02 and removed. It was actively harmful while it existed: it deleted only 12 of the
// 28 correction bins but upserted a `newMeta` literal that REPLACED the whole metadata jsonb, so the
// surviving high-flow bins kept their observation counts while every counter restarted at 0 —
// permanently desynchronising the diagnostics from the bins. This locks the removal so it cannot
// return by accident (the same guard pattern as test/system1-removed.test.mjs for v37.1).
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';

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

    it('no source file anywhere still names it (the 4-file list above missed a comment)', () => {
        // The first cut of this guard checked a hand-picked four files and missed a stale comment in
        // src/ui/learning-ui.js, which then shipped into the published source map. Sweep instead.
        const root = new URL('../', import.meta.url);
        const skip = new Set(['node_modules', 'dist', '.git', 'analysis', 'test']);
        const hits = [];
        const walk = dir => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
                if (skip.has(e.name)) continue;
                const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
                if (e.isDirectory()) walk(p);
                else if (/\.(js|mjs|html)$/.test(e.name) && readFileSync(p, 'utf8').includes('resetLowFlowBins')) {
                    hits.push(p.pathname);
                }
            }
        };
        walk(root);
        assert.deepEqual(hits, [], `resetLowFlowBins still referenced in: ${hits.join(', ')}`);
    });

    it('the other two PIN-gated admin actions survive', () => {
        const s = files['netlify/functions/sync-learning.js'];
        assert.ok(s.includes("action === 'resetGFLearning'"), 'resetGFLearning removed by mistake');
        assert.ok(s.includes("action === 'resetForecastAccuracy'"), 'resetForecastAccuracy removed by mistake');
    });

    it('resetGFLearning preserves bin-write health across the metadata replace (TODO #28)', () => {
        const s = files['netlify/functions/sync-learning.js'];
        // The upsert replaces the whole jsonb, so anything not named here is destroyed.
        // Failures are a fault log and must survive; successes count writes into the bins this
        // action deletes, so they reset with them (keeps v37.17's reconciliation identity intact).
        for (const f of ['binWriteFailures: oldMeta.binWriteFailures', 'lastBinError: oldMeta.lastBinError']) {
            assert.ok(s.includes(f), `resetGFLearning drops ${f.split(':')[0]} — a fault log is not learning state`);
        }
        assert.ok(s.includes('binWriteSuccesses: 0'), 'binWriteSuccesses must reset with the bins it counts');
        // Learning stats must still be explicitly zeroed, not carried over.
        assert.ok(/totalValidations: 0/.test(s) && /validValidations: 0/.test(s), 'learning stats must reset');
    });
});

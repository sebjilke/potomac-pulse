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
        // Allow-list the shipped source roots rather than skip-listing: a skip list makes the
        // guard's verdict depend on whatever untracked/gitignored directories happen to exist
        // locally (.netlify, .claude, coverage, …), which is not a property of the codebase.
        const hits = [];
        const walk = dir => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
                const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
                if (e.isDirectory()) walk(p);
                else if (/\.(js|mjs|html)$/.test(e.name) && readFileSync(p, 'utf8').includes('resetLowFlowBins')) {
                    hits.push(p.pathname);
                }
            }
        };
        for (const d of ['../src/', '../netlify/']) walk(new URL(d, import.meta.url));
        for (const f of ['../index.html']) {
            if (readFileSync(new URL(f, import.meta.url), 'utf8').includes('resetLowFlowBins')) hits.push(f);
        }
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
        // Tallies count writes into the bins this action deletes, so BOTH reset with them (keeps
        // v37.17's reconciliation identity, and avoids a permanent "0 ok / N fail" with no clearing
        // path). The fault RECORD must survive, so the evidence of a failure is never erasable.
        for (const f of ['binWriteSuccesses: 0', 'binWriteFailures: 0']) {
            assert.ok(s.includes(f), `resetGFLearning must zero ${f.split(':')[0]} along with the bins`);
        }
        for (const f of ['lastBinError: oldMeta.lastBinError', 'lastBinErrorAt: oldMeta.lastBinErrorAt']) {
            assert.ok(s.includes(f), `resetGFLearning drops ${f.split(':')[0]} — the fault record must not be erasable`);
        }
        // Learning stats must still be explicitly zeroed, not carried over.
        assert.ok(/totalValidations: 0/.test(s) && /validValidations: 0/.test(s), 'learning stats must reset');
    });
});

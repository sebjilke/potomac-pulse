// v36.0 (C1) sole-writer guard. The hourly cron (scheduled-update.js) is the ONLY writer of GF
// predictions. No client/browser module may POST a prediction — re-introducing one would revive the
// client/cron contamination race into the single `pending` slot. This test scans the client source
// tree and fails if any module references the storePrediction write action or the removed sender.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir) {
    const out = [];
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) out.push(...walk(p));
        else if (/\.(js|mjs)$/.test(ent.name)) out.push(p);
    }
    return out;
}

const FILES = walk(SRC);

// Strip // line and /* */ block comments so removal-note comments don't trip the guard — we only
// want to catch the symbols appearing in actual CODE.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const codeOf = (f) => stripComments(readFileSync(f, 'utf8'));

describe('v36.0 sole-writer: no client module writes a GF prediction', () => {
    it('no src module references the storePrediction write action', () => {
        const offenders = FILES.filter(f => /['"]storePrediction['"]/.test(codeOf(f)));
        assert.deepEqual(offenders.map(f => f.replace(SRC, 'src')), [],
            'these client modules still reference the storePrediction action');
    });

    it('the removed sender/queue helpers are gone from client code', () => {
        for (const sym of ['sendGFPrediction', 'processGFRetryQueue', 'gfPredictionRetryQueue']) {
            const offenders = FILES.filter(f => new RegExp(`\\b${sym}\\b`).test(codeOf(f)));
            assert.deepEqual(offenders.map(f => f.replace(SRC, 'src')), [], `${sym} still referenced in code`);
        }
    });
});

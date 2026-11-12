// v39.8 (C2, PA-2): static guards for the "never shown" elements that were removed from index.html.
// The fake DOM in the behaviour tests creates any id on demand, so a write to a deleted element passes there
// and throws in a real browser (blanking the Great Falls card). These checks read the source text instead.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const walk = (dir, exts, out = []) => {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, exts, out);
        else if (exts.some((e) => name.endsWith(e))) out.push(full);
    }
    return out;
};
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const srcFiles = walk(resolve(root, 'src'), ['.js', '.mjs']);

// Ids removed from index.html in v39.8. This file is excluded from its own scan.
const REMOVED_IDS = [
    'gf-ci-range', 'gf-ci-text', 'gf-data-source', 'gf-accuracy',
    'gf-forecast-cfs', 'gf-forecast-stage', 'gf-forecast-hrs', 'gf-forecast-arrival',
    'gf-validation', 'gf-val-countdown', 'gf-val-last',
    // replaced by the one notice box (#gf-notice)
    'gf-cap-note', 'gf-cap-headline', 'gf-cap-detail',
    'gf-divergence-advisory', 'gf-divergence-title', 'gf-divergence-body',
    'gf-residual-advisory', 'gf-residual-title', 'gf-residual-body'
];
// Ids that exist only at run time (created by JS into the map, the graph SVG or a popup), so they are not in index.html.
const RUNTIME_IDS = new Set([
    'gf-popup-cfs', 'gf-popup-stage', 'gauge-search', 'gf-graph-hover', 'gf-graph-marker',
    'gf-marker-dot', 'gf-marker-line', 'valChartHover'
]);

describe('removed hidden elements (C2)', () => {
    it('the removed ids appear nowhere in index.html, src/ or test/', () => {
        const files = [resolve(root, 'index.html'), ...srcFiles, ...walk(resolve(root, 'test'), ['.js', '.mjs']).filter((f) => f !== SELF)];
        for (const f of files) {
            const text = readFileSync(f, 'utf8');
            for (const id of REMOVED_IDS) assert.ok(!new RegExp(`(?<![\\w-])${id}(?![\\w-])`).test(text), `${relative(root, f)} still mentions ${id}`);
            assert.doesNotMatch(text, /id="status"/, `${relative(root, f)} still has id="status"`);
            assert.doesNotMatch(text, /getElementById\(\s*['"`]status['"`]\s*\)/, `${relative(root, f)} still reads #status`);
        }
    });

    it('every static id passed to getElementById anywhere in src/ exists in index.html (or is a listed run-time id)', () => {
        const re = /getElementById\(\s*(['"`])([^'"`$\\]+)\1\s*\)/g;
        const missing = [];
        let seen = 0;
        for (const f of srcFiles) {
            const text = readFileSync(f, 'utf8');
            for (const m of text.matchAll(re)) {
                seen++;
                const id = m[2];
                if (RUNTIME_IDS.has(id)) continue;
                if (!html.includes(`id="${id}"`)) missing.push(`${relative(root, f)}: ${id}`);
            }
        }
        assert.ok(seen > 100, 'the scan found the getElementById calls (' + seen + ')');
        assert.deepEqual(missing, [], 'ids used by src/ but missing from index.html');
    });

    it('the allowlisted run-time ids are really absent from index.html (the list stays honest)', () => {
        for (const id of RUNTIME_IDS) assert.ok(!html.includes(`id="${id}"`), `${id} is in index.html, drop it from the allowlist`);
    });
});

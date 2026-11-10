// Builds test/fixtures/outlier-replay-2026-10.json for the v39.0 always-soft outlier tests.
//
// INPUT (local, gitignored, treated as DATA ONLY — never executed or interpolated):
//   analysis/snapshot-2026-11-10-validation-failures.json   { entries: [...] }  (/api/sync?endpoint=validation-failures)
//   analysis/snapshot-2026-11-10-gf.json                    { correctionBins: {...}, ... } (/api/sync?endpoint=gf)
// OUTPUT (committed): test/fixtures/outlier-replay-2026-10.json
//
// The fixture is a NON-REPRODUCIBLE snapshot: the live bins have since moved and validation_failure
// rows age out of the endpoint's 50-row window, so this script cannot be re-run against production
// to regenerate the same bytes. Tests read only the committed fixture and never touch the network.
//
// Usage: node analysis/build_outlier_replay_fixture.mjs
// Fails (non-zero exit) unless it finds EXACTLY ten 2026-10-16..18 `6000-12000` / `falling` rows and
// exactly one 2026-10-12 `0-3000` / `rising` row.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const failuresPath = resolve(here, 'snapshot-2026-11-10-validation-failures.json');
const gfPath = resolve(here, 'snapshot-2026-11-10-gf.json');
const outPath = resolve(here, '..', 'test', 'fixtures', 'outlier-replay-2026-10.json');

const failures = JSON.parse(readFileSync(failuresPath, 'utf8'));
const gf = JSON.parse(readFileSync(gfPath, 'utf8'));
const entries = Array.isArray(failures.entries) ? failures.entries : [];

const KEEP = ['validatedAt', 'predictionId', 'flowBin', 'flowState', 'errorCFS', 'actualCFS',
    'errorPercentRaw', 'errorPercentCorrected', 'anomalyFlags'];
const pick = (e) => Object.fromEntries(KEEP.map((k) => [k, e[k]]));
const day = (e) => String(e.validatedAt).slice(0, 10);

const fallingRows = entries
    .filter((e) => e.flowBin === '6000-12000' && e.flowState === 'falling' && day(e) >= '2026-10-16' && day(e) <= '2026-10-18')
    .sort((a, b) => Date.parse(a.validatedAt) - Date.parse(b.validatedAt))
    .map(pick);
const risingRows = entries
    .filter((e) => e.flowBin === '0-3000' && e.flowState === 'rising' && day(e) === '2026-10-12')
    .map(pick);

if (fallingRows.length !== 10) {
    console.error(`FAIL: expected exactly 10 6000-12000/falling rows 2026-10-16..18, found ${fallingRows.length}`);
    process.exit(1);
}
if (risingRows.length !== 1) {
    console.error(`FAIL: expected exactly 1 0-3000/rising row on 2026-10-12, found ${risingRows.length}`);
    process.exit(1);
}

const STAT_KEYS = ['count', 'sumError', 'sumErrorSq', 'meanError', 'emaMeanError'];
const statsOf = (bin, label) => {
    if (!bin) { console.error(`FAIL: bin ${label} missing from the gf snapshot`); process.exit(1); }
    const out = Object.fromEntries(STAT_KEYS.map((k) => [k, bin[k]]));
    if (STAT_KEYS.some((k) => !Number.isFinite(out[k]))) { console.error(`FAIL: bin ${label} has non-finite stats`); process.exit(1); }
    return out;
};

const fixture = {
    fetchedAt: '2026-11-10',
    sources: {
        validationFailures: 'https://potomac-pulse.netlify.app/api/sync?endpoint=validation-failures',
        gf: 'https://potomac-pulse.netlify.app/api/sync?endpoint=gf',
    },
    note: 'NON-REPRODUCIBLE SNAPSHOT of live production state taken 2026-11-10 (the live bins move every validation and validation_failure rows age out of a 50-row window). Built once by analysis/build_outlier_replay_fixture.mjs from local, gitignored snapshot files; tests read this file only and never touch the network. Rows are the pre-v39.0 HARD STATISTICAL_OUTLIER flags; bin stats are the live (frozen) stats at fetch time.',
    fallingBin: {
        key: '6000-12000_falling',
        stats: statsOf(gf.correctionBins?.['6000-12000']?.falling, '6000-12000_falling'),
    },
    fallingRows,       // chronological, oldest first
    risingBin: {
        key: '0-3000_rising',
        stats: statsOf(gf.correctionBins?.['0-3000']?.rising, '0-3000_rising'),
    },
    risingRow: risingRows[0],
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n');
console.log(`wrote ${outPath}: ${fallingRows.length} falling rows + 1 rising row`);

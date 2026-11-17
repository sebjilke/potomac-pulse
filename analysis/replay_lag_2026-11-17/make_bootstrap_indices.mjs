// Month-block bootstrap resamples, generated ONCE so that the Python and R analysts use identical draws.
//
//   node make_bootstrap_indices.mjs [shadow_F.csv] [outdir]
//
// Input : shadow_F.csv (column 1 = predTs, ISO UTC). The month list is every distinct calendar month
//         (YYYY-MM, UTC) spanned by the rows of that file, in ascending order, whatever their status.
// Output: months.csv             header `month`; one month per line (K lines), ascending.
//         bootstrap_indices.csv  header `b,m1,...,mK`; 10,000 rows. Row b (b = 1..10000) holds K month labels,
//                                each drawn uniformly WITH replacement from months.csv.
// Generator: mulberry32 (32-bit PRNG, public domain), seed = 20261117 (the run date as an integer),
//         u in [0,1) = mulberry32()/2^32, draw index = floor(u * K) (0-based into months.csv).
//         Draw order: row 1 columns 1..K, then row 2, ... (one generator, never re-seeded).
//         mulberry32(a): a |= 0; a = a + 0x6D2B79F5 | 0; t = Math.imul(a ^ a >>> 15, 1 | a);
//                        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const inFile = process.argv[2] || path.join(here, 'shadow_F.csv');
const outDir = process.argv[3] || here;
const SEED = 20261117, NB = 10000;

function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const lines = fs.readFileSync(inFile, 'utf8').split('\n');
if (lines[0].split(',')[0] !== 'predTs') throw new Error('first column must be predTs');
const set = new Set();
for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    set.add(lines[i].slice(0, 7));          // 'YYYY-MM' of the ISO UTC timestamp
}
const months = [...set].sort();
const K = months.length;
fs.writeFileSync(path.join(outDir, 'months.csv'), 'month\n' + months.join('\n') + '\n');

const rnd = mulberry32(SEED);
const out = [['b', ...months.map((_, j) => `m${j + 1}`)].join(',')];
for (let b = 1; b <= NB; b++) {
    const row = [b];
    for (let j = 0; j < K; j++) row.push(months[Math.floor(rnd() * K)]);
    out.push(row.join(','));
}
fs.writeFileSync(path.join(outDir, 'bootstrap_indices.csv'), out.join('\n') + '\n');
console.log(`months: ${K} (${months[0]} .. ${months[K - 1]}); bootstrap rows: ${NB}`);

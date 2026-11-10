// THE SINGLE GATE RUN (plan section 7, D-5 H11). PREPARED, NOT EXECUTED in step 3 first half.
//
//   node run_gate.mjs --i-am-the-single-gate-run
//
// One invocation: (1) refuses if any output already exists; (2) runs the whole test suite (drift tests, harness tests, and every
// precondition: baseline identity, invariants old and new, mask/REC agreement, P3, P4) and refuses to continue unless all pass;
// (3) runs the four arms ONCE per view and writes
//   rising_limb_ticks.csv            primary: single-slot chains, primary lag view
//   rising_limb_ticks_S2.csv         S2 unlagged leaky view          (report-only)
//   rising_limb_ticks_S3.csv         S3 uniform 1 h lag              (report-only)
//   rising_limb_ticks_multi.csv      multi-pending replay, primary view (report-only)
//   rising_limb_snapshots_t0m72.json bin + pending-slot state of every arm after the tick at t0-72h, every kept event (primary run)
//   rising_limb_run_log.json         node version, input hashes, source blob/HEAD, counters, timings
// No error of any arm against the truth is computed here. Files are opened with 'wx' so nothing is ever overwritten.
// Plumbing test only (never counts): --dry-run writes up to --limit ticks into a temp dir and skips the suite and git guards. It is capped to ticks
// before 2012-12-01 00:00 (index < 8,779, burn-in), so it can never produce a scorable tick file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as H from './rising_limb_harness.mjs';
import { blobSha1 } from './drift_lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const val = (f, d) => { const k = args.indexOf(f); return k >= 0 ? args[k + 1] : d; };
const dry = flag('--dry-run');
if (!flag('--i-am-the-single-gate-run') && !dry) { console.error('REFUSED: pass --i-am-the-single-gate-run'); process.exit(2); }

const OUT = dry ? fs.mkdtempSync(path.join(os.tmpdir(), 'gate-dry-')) : HERE;
const FILES = { primary: 'rising_limb_ticks.csv', S2: 'rising_limb_ticks_S2.csv', S3: 'rising_limb_ticks_S3.csv', multi: 'rising_limb_ticks_multi.csv',
  snaps: 'rising_limb_snapshots_t0m72.json', log: 'rising_limb_run_log.json' };
for (const f of Object.values(FILES)) if (fs.existsSync(path.join(OUT, f))) { console.error(`REFUSED: ${f} already exists; the gate run is a single run and never overwrites`); process.exit(2); }

const FROZEN = { 'hourly_backtest_data_v39.csv': 'd1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f',
  'rising_limb_events_python_v39.csv': '978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44',
  'rising_limb_bootstrap_indices.csv': '7eff92a751fd9cc0c6f8e0220998e98788cc2f293b5437088bf9376e1dd96519',
  'rising_limb_bootstrap_indices_nonoct.csv': 'c1f50235edf229d65f8dcd0432f0a9699c752e3a67f7fac27e597c040a29ff5c' };
const hashes = {};
for (const [f, h] of Object.entries(FROZEN)) {
  hashes[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(HERE, f))).digest('hex');
  if (hashes[f] !== h) { console.error(`REFUSED: input hash mismatch for ${f}`); process.exit(2); }
}

// D-5 H15: prove which code ran. Everything under this folder must be committed (ignored raw/ cache and the uncompressed data CSV are
// git-ignored and do not show). The run's own outputs do not exist yet (checked above), so any porcelain line is a violation.
let gitCommit = null;
if (!dry) {
  const st = execSync('git status --porcelain -- .', { cwd: HERE, encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter(l => !Object.values(FILES).some(f => l.endsWith(' ' + f) || l.endsWith('/' + f)));
  if (st.length) { console.error('REFUSED: uncommitted or untracked files under the harness folder:\n' + st.join('\n')); process.exit(2); }
  gitCommit = execSync('git rev-parse HEAD', { cwd: HERE, encoding: 'utf8' }).trim();
}
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const codeHashes = {};
for (const f of [...fs.readdirSync(HERE).filter(f => f.endsWith('.mjs')), ...fs.readdirSync(path.join(HERE, 'tests')).filter(f => f.endsWith('.mjs')).map(f => 'tests/' + f),
  'TICK_SCHEMA.md', 'production_fingerprints.json']) codeHashes[f] = sha(path.join(HERE, f));
codeHashes['../rising-limb-travel-backtest-plan-2026-11-10.md'] = sha(path.join(HERE, '../rising-limb-travel-backtest-plan-2026-11-10.md'));

if (!dry) {
  const tests = fs.readdirSync(path.join(HERE, 'tests')).filter(f => f.endsWith('.test.mjs')).map(f => path.join('tests', f));
  const r = spawnSync(process.execPath, ['--test', ...tests], { cwd: HERE, encoding: 'utf8', maxBuffer: 1 << 26 });
  const tail = (r.stdout || '').split('\n').filter(l => /^ℹ (tests|pass|fail)/.test(l)).join(' | ');
  console.error('suite:', tail);
  if (r.status !== 0) { console.error('REFUSED: drift tests / preconditions did not all pass in this invocation'); process.exit(2); }
}

const D = H.loadData();
const evs = H.loadEvents();
const limit = dry ? +val('--limit', 2000) : null;
if (dry && !(limit > 0 && limit <= D.idx(H.SCORING_START_MS))) { console.error(`REFUSED: --dry-run --limit must be between 1 and ${D.idx(H.SCORING_START_MS)} (burn-in only)`); process.exit(2); }
const log = { startedAt: new Date().toISOString(), node: process.version, platform: process.platform + ' ' + process.arch, inputs: hashes, dryRun: dry,
  scheduledUpdateBlob: blobSha1(), head: gitCommit, codeSha256: codeHashes,
  ticksPerView: limit ?? D.n, gridTicks: D.n, runs: {} };

function csvWriter(file) {
  const fd = fs.openSync(path.join(OUT, file), 'wx');
  fs.writeSync(fd, H.TICK_COLUMNS.join(',') + '\n');
  let buf = [], rows = 0;
  const flush = () => { if (buf.length) { fs.writeSync(fd, buf.join('')); buf = []; } };
  return { row: (r) => { buf.push(H.TICK_COLUMNS.map(c => r[c]).join(',') + '\n'); rows++; if (buf.length >= 4000) flush(); }, close: () => { flush(); fs.closeSync(fd); return rows; } };
}

// snapshot tick indices: t0 - 72 h for every kept event
const snapAt = new Map(); const snaps = [];
for (const e of evs) if (e.kept) { const k = D.idx(e.t0 - 72 * H.HOUR); snapAt.set(k, (snapAt.get(k) || []).concat(e.id)); }

async function pass(name, cfg, multi, withSnaps) {
  const w = csvWriter(FILES[name]); const t0 = Date.now();
  const chains = await H.runReplay(D, { cfg, multi, evs, onRow: w.row, limit,
    snapshotAt: withSnaps ? snapAt : new Map(),
    onSnapshot: withSnaps ? (i, arm, snap) => { for (const id of snapAt.get(i)) snaps.push({ event_id: id, tick_utc: new Date(D.epoch(i)).toISOString(), arm, state: 'after completing this tick', ...snap }); } : null });
  log.runs[name] = { rows: w.close(), seconds: (Date.now() - t0) / 1000, counters: Object.fromEntries(Object.entries(chains).map(([a, c]) => [a, c.n])) };
}
await pass('primary', H.PRIMARY, false, true);
fs.writeFileSync(path.join(OUT, FILES.snaps), JSON.stringify({ note: 'bin and pending-slot state of each arm AFTER completing the tick at t0-72h (primary single-slot run)', snapshots: snaps }), { flag: 'wx' });
await pass('S2', H.S2_VIEW, false, false);
await pass('S3', H.S3_VIEW, false, false);
await pass('multi', H.PRIMARY, true, false);
log.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(OUT, FILES.log), JSON.stringify(log, null, 1), { flag: 'wx' });
console.error(dry ? `DRY RUN OK in ${OUT}` : 'GATE RUN DONE');

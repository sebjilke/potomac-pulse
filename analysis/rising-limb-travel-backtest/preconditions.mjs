// Precondition runner for step 3, first half. Outputs counts and pass/fail only. NO error of any arm vs the truth.
// Baseline-only quantities used: raw (for P4 vs logged values), trace.rst/stop (for P3 convergence share on the common mask).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import * as H from './rising_limb_harness.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
import os from 'node:os';
// P4 file: out/replay/fidelity_table.csv inside the archived October audit tarball (extracted to a temp dir, read only).
function fidelityCsv() {
  const tgz = path.resolve(HERE, '../pulse-audit-2026-10/audit_outputs.tar.gz');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fid-'));
  execSync(`tar -xzf "${tgz}" -C "${dir}" out/replay/fidelity_table.csv`);
  return path.join(dir, 'out/replay/fidelity_table.csv');
}

export async function computePreconditions() {
  const D = H.loadData();
  const evs = H.loadEvents();
  const n = D.n;
  const baseRaw = new Float64Array(n).fill(NaN);
  const baseRst = new Array(n).fill(null), baseStop = new Array(n).fill(null);
  const { inv, chains } = await H.runPreconditions(D, {
    onBase: (i, r) => { if (r) { baseRaw[i] = r.pred.rawFinalCFS; baseRst[i] = r.trace.rst; baseStop[i] = r.trace.stop; } },
  });
  // mask + truth existence, counts only (arm-independent); compared to the step-2 event file
  const mask = new Uint8Array(n); let maskTicks = 0, tauNonConv = 0;
  for (let i = 0; i < n; i++) { const tr = H.truthAt(D, i); if (tr.mask) { mask[i] = 1; maskTicks++; if (!tr.tauConverged) tauNonConv++; } }
  const maskCmp = { events: 0, rlTicksMatch: 0, scoredMatch: 0, mismatches: [] };
  for (const e of evs) {
    maskCmp.events++;
    let rl = 0, sc = 0;
    for (let t = e.rl[0]; t <= e.rl[1]; t += H.HOUR) { const i = D.idx(t); rl++; if (i >= 0 && i < n && mask[i]) sc++; }
    if (rl === e.rlTicks) maskCmp.rlTicksMatch++;
    if (sc === e.scoredRl) maskCmp.scoredMatch++; else maskCmp.mismatches.push({ id: e.id, mine: sc, file: e.scoredRl });
  }
  const recCmp = { events: 0, match: 0, mismatches: [] };
  for (const e of evs) { recCmp.events++; if (e.recSet.size === e.recN) recCmp.match++; else recCmp.mismatches.push({ id: e.id, mine: e.recSet.size, file: e.recN }); }

  // P3 (October mechanism): base non-converged share on October RL rising ticks, common mask
  const oct = evs.find(e => e.oct && e.kept);
  let p3 = { applicable: false };
  if (oct) {
    let rising = 0, nonconv = 0, lookup = 0;
    for (let t = oct.rl[0]; t <= oct.rl[1]; t += H.HOUR) {
      const i = D.idx(t);
      if (!mask[i] || baseRst[i] !== 'rising') continue;
      rising++; if (baseStop[i] === 'max_iter') nonconv++; if (baseStop[i] === 'no_hist' || baseStop[i] === 'hist_lost') lookup++;
    }
    p3 = { applicable: true, eventId: oct.id, risingTicks: rising, nonConverged: nonconv, lookupFail: lookup, share: rising ? nonconv / rising : null, pass: rising > 0 && nonconv / rising >= 0.20 };
  }

  // P4 fidelity (report only): harness base raw vs the 20 logged hard-flag raw values, within max(5%,150 cfs)
  const lines = fs.readFileSync(fidelityCsv(), 'utf8').trim().split('\n');
  const hdr = lines[0].split(',');
  const rows = lines.slice(1).map(l => Object.fromEntries(l.split(',').map((v, k) => [hdr[k], v])));
  const hf = rows.filter(r => r.kind === 'hardflag');
  const seen = new Set(); const p4rows = [];
  for (const r of hf) {
    const key = r.pred_created_tick_utc; if (seen.has(key)) continue; seen.add(key);
    const i = D.idx(Date.parse(key)); const mine = baseRaw[i]; const obs = +r.obs_raw_cfs; const rep = +r.replay_raw_cfs;
    const tol = Math.max(0.05 * obs, 150);
    p4rows.push({ tick: key, logged_raw: obs, october_replay_raw: rep, harness_base_raw: Number.isNaN(mine) ? null : mine,
      diff_vs_logged: Number.isNaN(mine) ? null : mine - obs, within_tol: !Number.isNaN(mine) && Math.abs(mine - obs) <= tol });
  }
  const p4 = { rows: p4rows, n: p4rows.length, within: p4rows.filter(r => r.within_tol).length };

  const out = { dataRows: D.nrows, gridTicks: n, baseChain: chains.base.n, invariants: inv, maskTicks, tauNonConvergedTicks: tauNonConv, maskCmp, recCmp, p3, p4 };
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(HERE, 'preconditions.mjs')) {
  const out = await computePreconditions();
  fs.writeFileSync(path.join(HERE, 'STEP_3_PRECONDITIONS.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ ...out, p4: { n: out.p4.n, within: out.p4.within }, maskCmp: { ...out.maskCmp, mismatches: out.maskCmp.mismatches.length } }, null, 1));
}

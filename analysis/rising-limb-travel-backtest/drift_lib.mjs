// Anchor extraction shared by the generator and the drift tests (plan section 1 anchor rule, section 4 learning-gate anchors).
// An anchor is the start of exactly one line (leading whitespace trimmed; a trailing code comment is not part of the anchor).
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROD_PATH = path.resolve(HERE, '../../netlify/functions/scheduled-update.js');

export const ANCHORS = {
  MODEL_START: 'function makeGFPrediction(',
  POR_START: 'function getPoRFromHistory(history, hoursAgo) {',
  R: 'const porRiseRate = getPoRRiseRateFromHistory(porHistory);',
  H1: 'let mult = getFlowMultiplier(lf.q);',
  H2: 'const historicMult = getFlowMultiplier(historicPoR.cfs);',
  TRAVEL: 'const travelGFtoLF = getGFtoLFTravelTime(mult, porRiseRate);',
  SUM: 'porEstimateCFS = historicPoR.cfs + monocacyFlow + gooseFlow + broadRunFlow + senecaFlow;',
  TRIG: 'if (Math.abs(porChangePct) > 5) {',
  H3: 'porEstimateCFS = Math.round(porEstimateCFS * appliedRatio);',
  DUE: 'validationDue: new Date(Date.now() + travelGFtoLF * 60 * 60 * 1000).toISOString(),',
  TRACE_RAWUNC: 'trace.rawUnc = rawFinalUnclipped;',
  TRACE_UNC: 'trace.unc = correctedFinalUnclipped;',
  GATE_START: '// Check 1: EF cross-check',
  GATE_END: 'const binUpdate = updateCorrectionBin(binData, errorCFS, isSoftFlagged);',
  CLAIM: "const { data: claimed, error: claimErr } = await client.from('potomac_observations')",
  BINREAD: 'const { data: existingBin, error: binReadErr } = await client',
  VALIDATE_FN: 'async function validatePendingPredictions(',
};
// Extra guard beyond the plan (not unique file-wide): the preamble of the gate block that defines errorCFS etc.
// starts at the LAST such line between VALIDATE_FN and GATE_START.
export const PRE_START = 'const actualCFS = lf.q;';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const readLines = (p = PROD_PATH) => fs.readFileSync(p, 'utf8').split('\n');

// Index of the unique line whose trimmed text starts with `anchor`. Throws unless exactly one.
export function findAnchor(lines, anchor, label = anchor) {
  const hits = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].trim().startsWith(anchor)) hits.push(i);
  if (hits.length !== 1) throw new Error(`ANCHOR_NOT_UNIQUE: ${label} occurs ${hits.length} times (need exactly 1): ${anchor}`);
  return hits[0];
}

// First line after `from` that is exactly `}` in column 0.
export function findCloseBrace(lines, from) {
  for (let i = from + 1; i < lines.length; i++) if (lines[i] === '}') return i;
  throw new Error('CLOSE_BRACE_NOT_FOUND after line ' + (from + 1));
}

// All anchors must be unique in the whole file (plan: "occurs exactly once").
export function checkAllAnchors(lines) {
  const idx = {};
  for (const [k, a] of Object.entries(ANCHORS)) idx[k] = findAnchor(lines, a, k);
  return idx;
}

export function extractModel(lines) {
  const idx = checkAllAnchors(lines);
  const mEnd = findCloseBrace(lines, idx.MODEL_START);
  const pEnd = findCloseBrace(lines, idx.POR_START);
  // sanity: all in-block anchors fall inside their block
  for (const k of ['R', 'H1', 'H2', 'TRAVEL', 'SUM', 'TRIG', 'H3', 'DUE', 'TRACE_RAWUNC', 'TRACE_UNC']) {
    if (!(idx[k] > idx.MODEL_START && idx[k] < mEnd)) throw new Error(`ANCHOR_OUTSIDE_BLOCK: ${k}`);
  }
  return {
    idx,
    model: lines.slice(idx.MODEL_START, mEnd + 1),
    por: lines.slice(idx.POR_START, pEnd + 1),
    modelRange: [idx.MODEL_START, mEnd], porRange: [idx.POR_START, pEnd],
  };
}

// Statement spans inside the gate block that the plan permits to be replaced by hooks.
function spanEnd(block, startI, endTest) {
  for (let i = startI; i < block.length; i++) if (endTest(block[i].trim())) return i;
  throw new Error('HOOK_SPAN_END_NOT_FOUND');
}

export function extractGate(lines) {
  const idx = checkAllAnchors(lines);
  if (!(idx.GATE_START < idx.GATE_END)) throw new Error('GATE anchors out of order');
  const block = lines.slice(idx.GATE_START, idx.GATE_END + 1);
  const claimI = block.findIndex(l => l.trim().startsWith(ANCHORS.CLAIM));
  const binI = block.findIndex(l => l.trim().startsWith(ANCHORS.BINREAD));
  if (claimI < 0 || binI < 0) throw new Error('hook statements not inside gate block');
  const claimE = spanEnd(block.slice(claimI), 0, t => t.endsWith(';')) + claimI;
  const binE = spanEnd(block.slice(binI), 0, t => t === '.single();') + binI;
  if (!(claimE < binI)) throw new Error('claim/binread overlap');
  // preamble: PRE_START .. line before GATE_START
  let preStart = -1;
  for (let i = idx.VALIDATE_FN; i < idx.GATE_START; i++) if (lines[i].trim().startsWith(PRE_START)) preStart = i;
  if (preStart < 0) throw new Error('PREAMBLE_START_NOT_FOUND');
  const pre = lines.slice(preStart, idx.GATE_START);
  return { idx, block, claim: [claimI, claimE], bin: [binI, binE], pre, range: [idx.GATE_START, idx.GATE_END], preRange: [preStart, idx.GATE_START - 1] };
}

// The gate block with its two permitted hook statements replaced by fixed tokens (the comparison form).
export function gateCanonical(g) {
  const out = [];
  for (let i = 0; i < g.block.length; i++) {
    if (i === g.claim[0]) out.push('<<HOOK:claim>>');
    if (i === g.bin[0]) out.push('<<HOOK:binread>>');
    if ((i >= g.claim[0] && i <= g.claim[1]) || (i >= g.bin[0] && i <= g.bin[1])) continue;
    out.push(g.block[i]);
  }
  return out;
}

// git blob hash of the production file (what `git hash-object` prints), computed without git
export function blobSha1(p = PROD_PATH) {
  const buf = fs.readFileSync(p);
  return crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');
}

// Fingerprints of production code that the harness re-implements BY HAND (ArmChain in rising_limb_harness.mjs):
// the validation loop head (stale cleanup, retry/early returns, due window), storePrediction, and the cron handler's
// ice -> validate -> predict -> store order. A mismatch means production's single-slot cadence changed since the harness
// was written: re-read ArmChain.validate/predict/store against the new text, then regenerate production_fingerprints.json.
// It does NOT mean the model or the learning gate changed (those have their own copy-and-compare drift tests).
export function fingerprints(lines) {
  const one = (a) => findAnchor(lines, a, a);
  const seg = (a, b, inclusiveEnd = true) => { const i = one(a), j = one(b); if (j < i) throw new Error('SEGMENT_ORDER ' + a + ' / ' + b); return lines.slice(i, inclusiveEnd ? j + 1 : j); };
  const h = (arr) => sha256(arr.join('\n'));
  const g = extractGate(lines);
  const fnStart = one(ANCHORS.VALIDATE_FN);
  const storeI = one('async function storePrediction(');
  const iVal = one("const validationResult = await validatePendingPredictions("), iPred = one('prediction = makeGFPrediction(usgsData, fullHistory'), iStore = one('tickCtx.slot = await storePrediction(');
  if (!(iVal < iPred && iPred < iStore)) throw new Error('HANDLER_ORDER: validate -> predict -> store order changed');
  const storeStage = one("tickCtx.stage = 'store';");
  return {
    validateHead: h(lines.slice(fnStart, g.preRange[0])),
    storePrediction: h(lines.slice(storeI, findCloseBrace(lines, storeI) + 1)),
    handlerValidate: h(seg("tickCtx.stage = 'validate';", 'tickCtx.val = {')),
    handlerPredict: h(seg("tickCtx.stage = 'predict';", 'tickCtx.prediction = prediction;')),
    handlerStore: h([...lines.slice(storeStage, storeStage + 4), lines[iStore]]),
  };
}

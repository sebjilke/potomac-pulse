import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HERE, PROD_PATH, ANCHORS, readLines, extractModel, extractGate, gateCanonical, findAnchor, sha256, fingerprints } from '../drift_lib.mjs';
import { generate } from '../generate_copies.mjs';

const prod = readLines();
const variantsText = fs.readFileSync(path.join(HERE, 'rising_limb_model_variants.mjs'), 'utf8').split('\n');
const gateText = fs.readFileSync(path.join(HERE, 'rising_limb_learning_gate.mjs'), 'utf8').split('\n');
const between = (arr, a, b) => arr.slice(arr.indexOf(a) + 1, arr.indexOf(b));
const startsWith = (l, a) => l.trim().startsWith(a);

function modelDriftReport(prodLines, vLines) {
  const m = extractModel(prodLines);
  const modelCopy = between(vLines, '// MODEL-COPY-BEGIN', '// MODEL-COPY-END').filter(l => !l.includes('// VARIANT-HOOK'));
  const porCopy = between(vLines, '// POR-COPY-BEGIN', '// POR-COPY-END');
  // production side: drop the replaced anchor lines (H1,H2,H3); R has no production counterpart to drop
  const prodModel = m.model.filter(l => ![ANCHORS.H1, ANCHORS.H2, ANCHORS.H3].some(a => startsWith(l, a)));
  return { modelEq: JSON.stringify(modelCopy) === JSON.stringify(prodModel), porEq: JSON.stringify(porCopy) === JSON.stringify(m.por) };
}

test('anchors each occur exactly once in production', () => {
  for (const [k, a] of Object.entries(ANCHORS)) assert.doesNotThrow(() => findAnchor(prod, a, k), k);
});

test('MODEL and POR copies equal production text (hook lines stripped)', () => {
  const r = modelDriftReport(prod, variantsText);
  assert.ok(r.modelEq, 'MODEL block drifted'); assert.ok(r.porEq, 'POR block drifted');
});

test('exactly four VARIANT-HOOK lines (R, H1, H2, H3)', () => {
  const h = variantsText.filter(l => l.includes('// VARIANT-HOOK'));
  assert.equal(h.length, 4);
  assert.deepEqual(h.map(l => /VARIANT-HOOK\[(\w+)\]/.exec(l)[1]), ['R', 'H1', 'H2', 'H3']);
});

test('learning-gate copy equals production text between the section 4 anchors (two permitted hooks only)', () => {
  const g = extractGate(prod);
  const copy = between(gateText, '// GATE-COPY-BEGIN', '// GATE-COPY-END')
    .map(l => l.includes('GATE-HOOK[claim]') ? '<<HOOK:claim>>' : l.includes('GATE-HOOK[binread]') ? '<<HOOK:binread>>' : l);
  assert.deepEqual(copy, gateCanonical(g));
  const pre = between(gateText, '// PREAMBLE-COPY-BEGIN', '// PREAMBLE-COPY-END');
  assert.deepEqual(pre, g.pre);
  assert.equal(g.block[0].trim().startsWith(ANCHORS.GATE_START), true);
  assert.equal(g.block[g.block.length - 1].trim().startsWith(ANCHORS.GATE_END), true);
});

// header line index 1 holds the git blob hash of the whole production file; it is informational and excluded here
const noBlobLine = (t) => t.split('\n').filter((l, k) => k !== 1).join('\n');
test('generated files on disk equal a fresh generation from current production (blob header line excluded)', () => {
  const r = generate({ write: false });
  assert.equal(noBlobLine(r.variants), noBlobLine(variantsText.join('\n')));
  assert.equal(noBlobLine(r.gate), noBlobLine(gateText.join('\n')));
  assert.equal(r.fp, fs.readFileSync(path.join(HERE, 'production_fingerprints.json'), 'utf8'));
});

test('recorded source hashes match current production blocks', () => {
  const m = extractModel(prod);
  assert.ok(variantsText[2].includes(sha256(m.model.join('\n'))));
  assert.ok(variantsText[2].includes(sha256(m.por.join('\n'))));
  assert.ok(gateText[2].includes(sha256(extractGate(prod).block.join('\n'))));
});

// ---- the detector itself must fail on drift and on anchor multiplicity ----
test('detector: a one-character change inside MODEL is reported as drift', () => {
  const i = prod.findIndex(l => l.includes('const decayFactor = Math.min(DECAY_CAP'));
  const mut = prod.slice(); mut[i] = mut[i].replace('Math.sqrt', 'Math.cbrt');
  const r = modelDriftReport(mut, variantsText); assert.equal(r.modelEq, false);
});
test('detector: a change inside POR is reported as drift', () => {
  const i = prod.findIndex(l => l.includes('const targetTime = Date.now() - (hoursAgo'));
  const mut = prod.slice(); mut[i] = mut[i].replace('hoursAgo', 'hoursAgo + 1');
  assert.equal(modelDriftReport(mut, variantsText).porEq, false);
});
test('detector: a change inside the learning gate is reported as drift', () => {
  const i = prod.findIndex(l => l.includes('if (efDiscrepancy > 0.25) {'));
  const mut = prod.slice(); mut[i] = mut[i].replace('0.25', '0.30');
  assert.notDeepEqual(between(gateText, '// GATE-COPY-BEGIN', '// GATE-COPY-END').map(l => l.includes('GATE-HOOK[claim]') ? '<<HOOK:claim>>' : l.includes('GATE-HOOK[binread]') ? '<<HOOK:binread>>' : l), gateCanonical(extractGate(mut)));
});
test('detector: a duplicated anchor line (2 matches) throws', () => {
  const i = prod.findIndex(l => l.trim().startsWith(ANCHORS.TRIG));
  const mut = prod.slice(); mut.splice(i, 0, mut[i]);
  assert.throws(() => extractModel(mut), /ANCHOR_NOT_UNIQUE/);
});
test('detector: a missing anchor line (0 matches) throws', () => {
  const mut = prod.filter(l => !l.trim().startsWith(ANCHORS.SUM));
  assert.throws(() => extractModel(mut), /ANCHOR_NOT_UNIQUE/);
  const mut2 = prod.filter(l => !l.trim().startsWith(ANCHORS.GATE_END));
  assert.throws(() => extractGate(mut2), /ANCHOR_NOT_UNIQUE/);
});
test('detector: duplicated gate-hook anchor throws', () => {
  const i = prod.findIndex(l => l.trim().startsWith(ANCHORS.CLAIM));
  const mut = prod.slice(); mut.splice(i, 0, mut[i]);
  assert.throws(() => extractGate(mut), /ANCHOR_NOT_UNIQUE/);
});

test('repo npm test glob (test/**) cannot pick up this folder', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /'test\/\*\*\/\*\.test\.js' 'test\/\*\*\/\*\.test\.mjs'/);
  assert.ok(!path.relative(path.resolve(HERE, '../..'), HERE).startsWith('test'));
});

// ---- hand-written production behaviour: fingerprints (what a failure means: see fingerprints() in drift_lib.mjs) ----
test('fingerprints of hand-reimplemented production code (validation loop head, storePrediction, handler order) are unchanged', () => {
  const rec = JSON.parse(fs.readFileSync(path.join(HERE, 'production_fingerprints.json'), 'utf8'));
  assert.deepEqual(fingerprints(prod), rec, 'production single-slot cadence code changed: re-read ArmChain against it, then rerun generate_copies.mjs');
});
test('fingerprint detector: a change in the validation loop head, storePrediction or handler store step is caught', () => {
  const rec = JSON.parse(fs.readFileSync(path.join(HERE, 'production_fingerprints.json'), 'utf8'));
  for (const [needle, key] of [['VALIDATION_MAX_DELAY_MS) {', 'validateHead'], ['isExistingPredictionReplaceable(existing.data', 'storePrediction'], ["tickCtx.stage = 'store';", 'handlerStore']]) {
    const i = prod.findIndex(l => l.includes(needle));
    assert.ok(i >= 0, needle);
    const mut = prod.slice(); mut[i] = mut[i] + ' /* x */';
    assert.notEqual(fingerprints(mut)[key], rec[key], key);
  }
});

// ---- hook lines: the production line each hook replaces/follows is the anchored line ----
test('each stripped production line equals its anchor, and each hook sits where the plan says', () => {
  const m = extractModel(prod);
  const hooks = variantsText.filter(l => l.includes('// VARIANT-HOOK'));
  const modelCopyAll = between(variantsText, '// MODEL-COPY-BEGIN', '// MODEL-COPY-END');
  const modelCopy = modelCopyAll.filter(l => !l.includes('VARIANT-HOOK[R]'));
  for (const [tag, anchor] of [['H1', ANCHORS.H1], ['H2', ANCHORS.H2], ['H3', ANCHORS.H3]]) {
    const prodHits = m.model.filter(l => startsWith(l, anchor));
    assert.equal(prodHits.length, 1, tag);
    const k = modelCopy.findIndex(l => l.includes(`VARIANT-HOOK[${tag}]`));
    // the hook occupies exactly the slot of the production line: neighbours are identical
    const pk = m.model.findIndex(l => startsWith(l, anchor));
    assert.equal(modelCopy[k - 1], m.model[pk - 1], tag + ' prev'); assert.equal(modelCopy[k + 1], m.model[pk + 1], tag + ' next');
  }
  const kr = modelCopyAll.findIndex(l => l.includes('VARIANT-HOOK[R]'));
  assert.ok(startsWith(modelCopyAll[kr - 1], ANCHORS.R));
  assert.equal(hooks.length, 4);
  const g = extractGate(prod);
  assert.ok(startsWith(g.block[g.claim[0]], ANCHORS.CLAIM) && startsWith(g.block[g.bin[0]], ANCHORS.BINREAD));
});

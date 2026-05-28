# v32.3 Accuracy Metric Fix — Independent Audit Report

**Date**: 2026-02-21
**Auditor**: Independent subagent (Claude Opus 4.6)
**Files reviewed**:
- `/files/potomac-site/netlify/functions/sync-learning.js` (lines 560–860)
- `/files/potomac-site/netlify/functions/scheduled-update.js` (lines 700–1060)
- `/files/potomac-site/index.html` (lines 655–662, 1437–1443, 1855–1912, 4095–4115, 6030–6045, 6530–6545, 6577–6580)
- `/CLAUDE.md` (line 154)

---

## 1. Claim Verification

### Claim (a): `sumAbsErrorPercent` is ONLY accumulated for non-flagged observations
**VERIFIED** — In both `sync-learning.js` (line 687) and `scheduled-update.js` (line 883), the line:
```js
metaData.sumAbsErrorPercent = (metaData.sumAbsErrorPercent || 0) + Math.abs(errorPercent);
```
is inside the `else` branch of `if (skipLearning)`, meaning it only executes for non-flagged observations.

### Claim (b): `avgErrorPercent` is computed using `validValidations` (or backward-compat fallback)
**VERIFIED** — In both files (sync-learning.js line 691–692, scheduled-update.js line 887–888):
```js
const validCount = metaData.validValidations || (metaData.totalValidations - (metaData.flaggedValidations || 0));
metaData.avgErrorPercent = validCount > 0 ? metaData.sumAbsErrorPercent / validCount : null;
```

### Claim (c): `totalValidations` still counts ALL observations
**VERIFIED** — In both files, `metaData.totalValidations += 1` is unconditional (sync-learning.js line 675, scheduled-update.js line 871), executing before the `if (skipLearning)` branch.

### Claim (d): Both reset functions include `validValidations: 0`
**VERIFIED** — Two reset functions in `sync-learning.js`:
1. `resetLowFlowBins` (lines 780–797): includes `validValidations: 0`, `flaggedValidations: 0`, `sumAbsErrorPercent: 0`
2. `resetGFLearning` (lines 837–850): includes `validValidations: 0`, `flaggedValidations: 0`, `sumAbsErrorPercent: 0`

### Claim (e): Client-side display uses `validCount` for threshold check and count display
**VERIFIED** — In `index.html` (lines 1883–1890):
```js
const validCount = meta.validValidations || (meta.totalValidations - (meta.flaggedValidations || 0));
if (validCount >= 5) {  // Threshold uses validCount
    ...
    accuracyCount.textContent = validCount.toLocaleString();  // Display uses validCount
```

### Claim (f): Dashboard shows valid/total split
**VERIFIED** — In `index.html` (lines 4108–4110):
```js
const dashValid = meta.validValidations || (meta.totalValidations - (meta.flaggedValidations || 0));
document.getElementById("dash-gf-validations").textContent =
    `${dashValid} valid / ${meta.totalValidations || 0} total`;
```

---

## 2. Edge Case Analysis

### Edge Case (a): Division by zero when `validValidations` is 0
**SAFE** — Line 692 (sync-learning.js) / line 888 (scheduled-update.js):
```js
metaData.avgErrorPercent = validCount > 0 ? metaData.sumAbsErrorPercent / validCount : null;
```
When `validCount` is 0, `avgErrorPercent` is set to `null`. The client-side display at line 1886 checks `validCount >= 5` before showing anything, and at line 1888 uses `meta.avgErrorPercent || 0` which handles `null` gracefully.

### Edge Case (b): Backward compatibility with existing metadata lacking `validValidations`
**SAFE** — The fallback logic `meta.validValidations || (meta.totalValidations - (meta.flaggedValidations || 0))` correctly handles databases that predate this field. When `validValidations` is undefined/0, it falls back to computing `totalValidations - flaggedValidations`.

**However, see CRITICAL FINDING below** — the backward-compat fallback works for the *denominator*, but not for the *numerator* (`sumAbsErrorPercent`).

### Edge Case (c): Other places using `totalValidations` for accuracy-related logic
**FOUND — minor, acceptable**:
1. `index.html` line 1864: `if (meta.totalValidations > 0)` — Used for the Learning tab status text ("N validated | Avg err: X%"). This still shows `totalValidations` in the status text, which is appropriate since it's displaying total count context, not using it for accuracy computation.
2. `index.html` line 1867: `statusText += meta.totalValidations + ' validated | Avg err: ...'` — Same context. This shows total count, which is informational. The `avgErr` displayed here correctly comes from `meta.avgErrorPercent` which is already computed using `validCount`.
3. `scheduled-update.js` line 899–902: Monthly/milestone summary log uses `meta.totalValidations % 100` for trigger and displays `totalValidations` in the console log. This is for logging only and `avgErrorPercent` is already correctly computed. **Acceptable.**

**Forecast accuracy metadata** (scheduled-update.js lines 1044–1047): The per-horizon forecast accuracy (`gf_forecast_metadata`) does NOT have the flagged/valid distinction. However, this is a **different validation path** for multi-hour NWS-based forecasts. It does not go through the anomaly detection pipeline (no `skipLearning` logic) and uses a simple absolute error. This is a separate system that does not suffer from the same bug. **No fix needed.**

---

## 3. CRITICAL FINDING: Existing `sumAbsErrorPercent` Data Pollution

### The Problem

`sumAbsErrorPercent` is **always cumulative** — it is loaded from the database, a new value is added, and saved back. It is never recomputed from scratch during normal operation. The only reset paths are the admin `resetLowFlowBins` and `resetGFLearning` actions.

**Before v32.3**, the existing database `sumAbsErrorPercent` includes error contributions from ALL observations (flagged + non-flagged). After v32.3 deploys:

1. The code correctly stops adding flagged errors to `sumAbsErrorPercent` going forward.
2. But `validValidations` starts fresh (effectively from 0, incrementing only for new non-flagged observations).
3. The denominator (`validValidations`) will be a small number (new non-flagged count only).
4. The numerator (`sumAbsErrorPercent`) will be the old polluted sum + only new non-flagged errors.
5. Result: `avgErrorPercent = (largePollutedSum + smallNewErrors) / smallNewCount` = **wildly inflated error**.

### Example

Suppose before v32.3: `sumAbsErrorPercent = 1500` (from 250 total obs, 60 flagged), `totalValidations = 250`, `flaggedValidations = 60`.

After v32.3, the first non-flagged observation arrives with 5% error:
- `validValidations = 1`
- `sumAbsErrorPercent = 1500 + 5 = 1505`
- `avgErrorPercent = 1505 / 1` = **1505%** (should be ~5%)

The backward-compat fallback would give `validCount = 1` (since `validValidations = 1` is truthy, it uses it directly instead of the fallback `250 - 60 = 190`).

### Will it self-correct?

Slowly, yes — but it will take a very long time. After 190 new non-flagged observations, `validValidations` would reach 190, and the denominator would be correct. But the numerator would still include the old ~900 in flagged error contributions (assuming ~60 flagged obs with ~15% avg error = 900 extra). With 190 valid obs at ~6% avg error = 1140, plus the 900 pollution, the sum would be ~2040, giving `avgErrorPercent = 2040/190 = 10.7%` instead of the correct ~6%. It would **never** fully self-correct — the polluted sum permanently biases upward.

### Recommendation

**A one-time data migration is needed.** Either:

1. **Option A (preferred): Reset `sumAbsErrorPercent` and `validValidations` to 0** at deployment time, via the existing admin reset mechanism or a manual database update. This restarts accuracy tracking from scratch — losing history but giving correct results immediately. Given the database already has `flaggedValidations` and `totalValidations`, you could also reconstruct the correct `sumAbsErrorPercent` from the individual validated observations in the database.

2. **Option B: Reconstruct from validated observations** — Query all observations with `gauge_id = 'validated'` (not `'flagged'`), sum their `Math.abs(errorPercent)`, count them, and set `sumAbsErrorPercent` and `validValidations` to the correct reconstructed values. This preserves history with correct numbers.

3. **Option C: Check if a recent reset already occurred** — If a `resetLowFlowBins` or `resetGFLearning` was recently executed (which sets `sumAbsErrorPercent: 0, validValidations: 0, flaggedValidations: 0`), the pollution problem does not exist. The fix would work correctly from that clean state forward.

**Severity: HIGH** — Without migration, the accuracy display will show wildly incorrect values until enough new observations wash out the pollution (which never fully happens).

---

## 4. Version Table Verification

### Tech Appendix Table (line 6039)
**VERIFIED** — v32.3 entry present:
```
| v32.3 | 2026-02-21 | 126 × EF^2.46 | 0.91 | — | Fix accuracy metric: exclude flagged (ice-affected) observations from avgErrorPercent... |
```

### Bottom Version History Table (line 6535)
**VERIFIED** — v32.3 entry present with detailed description of the fix.

### Footer (line 6579)
**VERIFIED** — `*Generated by Potomac Pulse v32.3 — Accuracy metric fix.*`

### CLAUDE.md (line 154)
**VERIFIED** — `## Current Model (v32.3) — Accuracy Metric Fix (2026-02-21)`

---

## 5. Minor Observations

### 5a. Comment syntax issue (cosmetic)
Lines 1877 and 1882 in `index.html` use single-slash comments (`/ v32.3: ...` and `/ Valid count: ...`) instead of double-slash (`// v32.3: ...`). These happen to work because they're inside a JavaScript block and the single slash starts a regex literal that gets discarded, but the intent is clearly a comment. Should use `//`.

Similarly, line 4107 uses `/ v32.3:` instead of `// v32.3:`.

**Impact: None** — These lines parse correctly in JavaScript (the `/` starts a regex division context that is immediately abandoned). But they should be `//` for clarity and correctness.

### 5b. `errorPercent` definition difference between files
In `sync-learning.js` (line 490): `const errorPercent = (errorCFS / actualCFS) * 100;` — This is **signed** (can be negative).
In `scheduled-update.js` (line 607): `const errorPercent = (errorCFS / actualCFS) * 100;` — Also **signed**.

But in `sync-learning.js` line 687: `Math.abs(errorPercent)` — correctly takes absolute value before accumulating.
In `scheduled-update.js` line 883: `Math.abs(errorPercent)` — also correct.

This is consistent and correct. The `sumAbsErrorPercent` name matches the `Math.abs()` usage.

### 5c. Forecast accuracy metadata not affected
The per-horizon forecast accuracy system (`gf_forecast_metadata` in `scheduled-update.js` lines 1044–1047) has no anomaly detection and no flagging mechanism. It always includes all observations. This is a separate system and does not need the v32.3 fix.

---

## 6. Audit Summary

| Check | Status | Notes |
|-------|--------|-------|
| Claim (a): sumAbsErrorPercent in else branch only | PASS | Both files verified |
| Claim (b): avgErrorPercent uses validValidations | PASS | Both files verified |
| Claim (c): totalValidations counts all | PASS | Unconditional increment |
| Claim (d): Reset functions include validValidations | PASS | Both resets verified |
| Claim (e): Client uses validCount for threshold/display | PASS | Lines 1886, 1890 |
| Claim (f): Dashboard shows valid/total split | PASS | Lines 4108-4110 |
| Edge case: division by zero | PASS | Guarded by validCount > 0 |
| Edge case: backward compat | PASS | Fallback logic correct |
| Edge case: missed totalValidations refs | PASS | All appropriate |
| Version tables | PASS | Tech appendix, bottom table, footer, CLAUDE.md |
| **Data pollution on existing DB** | **FAIL** | **sumAbsErrorPercent contains flagged errors; validValidations starts fresh** |
| Comment syntax (cosmetic) | WARN | Single-slash `/ v32.3:` instead of `// v32.3:` |

---

## 7. Verdict

**CONDITIONAL PASS** — The v32.3 code logic is correct for a clean-state database (post-reset). All claims verified. Edge cases handled. Version tables updated.

**However, deploying without a data migration will produce incorrect accuracy values.** The existing cumulative `sumAbsErrorPercent` includes flagged observation errors, while the new `validValidations` counter starts from 0. This numerator/denominator mismatch will make the accuracy display wildly wrong until a reset or reconstruction is performed.

**Required action before deployment**: Either (a) trigger a `resetGFLearning` to zero out all counters, or (b) reconstruct `sumAbsErrorPercent` and `validValidations` from the validated (non-flagged) observations in the database.

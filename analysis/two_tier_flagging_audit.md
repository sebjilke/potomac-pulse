# Audit Report: Two-Tier Anomaly Flagging (v33.0)

**Auditor**: Independent subagent
**Date**: 2026-02-21
**Plan reviewed**: `~/.claude/plans/prancy-crafting-matsumoto.md`
**Code reviewed**: `sync-learning.js` (lines 494–720), `scheduled-update.js` (lines 623–900), `index.html` (dashboard, accuracy, client logging)

---

## Verdict: APPROVE WITH CHANGES

The core design — separating physical data corruption (hard) from model disagreement (soft) — is sound and well-motivated. The plan correctly identifies that USGS ice flags already gate the validation loop, so most of the ~60 flags are model disagreements, not data corruption. However, several issues need resolution before implementation.

---

## 1. Methodology Review

### 1.1 Hard/Soft Classification

**Check 2 (STAGE_DISCHARGE) → Hard: CORRECT.** Stage-discharge inconsistency at >35% means the ADVM velocity sensor is reporting contradictory data. The LF CFS number itself is untrustworthy. Hard flag is the right call.

**Check 3 (LOW_FLOW_HIGH_STAGE) → Hard: CORRECT.** Sub-1500 cfs at >2.45 ft stage is physically impossible without ice damming or sensor failure. The CFS reading is meaningless. Hard flag is appropriate. The plan correctly standardizes this to +2 in sync-learning.js (currently +1, already +2 in scheduled-update.js).

**Check 1 (EF_DISCREPANCY) → Soft: CORRECT.** EF is a poor predictor of downstream discharge at low flows (negative skill <6k cfs per CLAUDE.md). A 25% EF-vs-LF discrepancy is fully consistent with normal model error, especially at low/moderate flows where EF weight is near zero anyway. LF is the more reliable reading.

**Check 4 (LARGE_ERROR) → Soft: MOSTLY CORRECT, but see R1.** A >50% prediction error is alarming, but the *prediction* is what failed, not the *measurement*. However, there is a subtlety: a 50%+ error could indicate that the observation landed in a flow regime where the model is extrapolating badly, and learning from it could distort the correction bin. This needs a safeguard (see R1).

**Check 5 (STATISTICAL_OUTLIER) → Soft: NEEDS RECONSIDERATION — see R2.** An observation 3σ from the bin mean could be:
- (a) A legitimate rare event (storm surge, dam release) → should learn from it
- (b) A subtly corrupted reading that passed Checks 2–3 (e.g., partial ADVM interference not severe enough to trigger stage-discharge inconsistency) → should NOT learn from it

The plan treats all 3σ outliers as soft, but the current system treats them as hard (skipLearning = true when isOutlier = true, line 574 of sync-learning.js). This is the single highest-risk change in the plan.

### 1.2 Threshold Appropriateness (score ≥ 2 for hard flags)

With only Checks 2 and 3 contributing to hardScore, each at +2, the threshold of ≥ 2 means any single hard check triggers a hard flag. This is correct — both checks individually indicate physical corruption. The threshold is effectively a formality here (both checks independently reach ≥ 2). No issue.

---

## 2. Risk Analysis

### 2.1 Learning Contamination from Soft-Flagged Observations

**R1: EMA sensitivity to large-error observations.**

The EMA update formula is:
```
emaMeanError = 0.3 × errorCFS + 0.7 × emaMeanError
```

With alpha = 0.3, a single observation shifts the EMA by 30% of the distance from current mean to the new error. Consider a bin with emaMeanError = 200 cfs receiving a soft-flagged observation with errorCFS = 3000 cfs (a 50%+ error on a 6000 cfs reading):

```
new EMA = 0.3 × 3000 + 0.7 × 200 = 900 + 140 = 1040 cfs
```

That is a **5.2x shift** in a single observation. The running mean (`meanError`) is more robust (diluted by count), but the EMA — which is the *primary correction used in real-time estimation* — would be severely distorted.

This is the plan's most dangerous gap. A single soft-flagged observation with a large error can corrupt the correction bin's EMA for ~3-5 subsequent observations (until the EMA decays back).

**R2: Statistical outlier reclassification risk.**

Currently, the outlier check (z > 3) sets `isOutlier = true` AND `skipLearning = true` (line 574). The plan reclassifies this as soft, meaning 3σ outliers will now flow into the EMA. This amplifies the R1 risk: a 3σ outlier by definition has an error far from the bin mean. Feeding it into a 0.3-alpha EMA will cause a large jump.

The plan's argument — "could be a legitimate rare event" — is valid for the *accuracy metric* but dangerous for the *learning system*. Rare events (dam releases, flash floods) create errors that are real but non-representative of the typical model bias the correction bin is trying to capture. The EMA should track *systematic* bias, not *transient* events.

### 2.2 Accuracy Display Impact

The plan estimates ~50 observations will shift from flagged to soft-flagged and included in accuracy. If those observations have 15–30% errors (as noted in the plan), the accuracy metric will shift from roughly `100 - 5 = 95%` to roughly `100 - (5*N_old + 20*50)/(N_old + 50)`. For N_old = 200 valid observations:

```
new avgError = (5 × 200 + 20 × 50) / 250 = 2000/250 = 8% → accuracy = 92%
```

A drop from ~95% to ~92% is honest and appropriate. It would not be alarming. If the errors cluster higher (25-30%), accuracy could drop to ~87-88%, which is still defensible for a real-time hydrological model.

However, the plan does not address whether the user interface should distinguish accuracy-with-soft-flags from accuracy-without. This would be informative for diagnostics.

### 2.3 Backward Compatibility

**gauge_id change from 'flagged' to 'hard_flagged':**

I searched for all references to `gauge_id = 'flagged'` across the codebase:
- `sync-learning.js` line 649: `gauge_id: skipLearning ? 'flagged' : 'validated'` — will be changed by the plan.
- `scheduled-update.js` line 844: identical — will be changed.
- `index.html` line 6363: documentation text only ("Record is marked 'flagged'") — cosmetic, no logic impact.

There are **no Supabase queries** that filter on `gauge_id = 'flagged'`. The metadata tracks counts via `metaData.flaggedValidations`, not by querying `gauge_id = 'flagged'` rows. So the rename from 'flagged' to 'hard_flagged' will NOT break any queries or logic.

However, existing rows in the database with `gauge_id = 'flagged'` will remain with that value forever. If anyone later adds a query for `gauge_id = 'hard_flagged'` to count historical hard flags, the old rows will be missed. This is a minor data archaeology concern, not a runtime risk.

---

## 3. Missing Considerations

### 3.1 Combined Check 1 + Check 2 Scenario

If both EF_DISCREPANCY (Check 1, soft +2) and STAGE_DISCHARGE (Check 2, hard +2) fire on the same observation, the plan correctly classifies it as hard (hardScore ≥ 2). The soft score is also accumulated but `isHardFlagged` takes precedence. The diagnostic information from Check 1 is preserved in the `anomalyFlags` array and `softScore` field.

**No issue here** — the plan handles this correctly via the `!isHardFlagged && ...` guard in isSoftFlagged.

### 3.2 Existing 'flagged' Observations in the Database

The plan's migration (Section G) resets counters but does NOT reclassify the ~60 existing 'flagged' rows. They retain `gauge_id = 'flagged'`, which is neither 'hard_flagged' nor 'validated'. This creates a third, orphaned category.

The plan acknowledges this implicitly by mapping `flaggedValidations → hardFlaggedValidations` in the migration, treating all historical flags as hard. This is conservative and acceptable, but means the accuracy metric will NOT retroactively improve — it only improves going forward as new soft-flagged observations are counted as valid.

**This is acceptable.** Retroactive reclassification would require re-running anomaly detection on all ~60 observations with the new scoring, which adds complexity for minimal gain.

### 3.3 Consecutive Soft Flag Promotion

The plan does not address a scenario where 5+ consecutive soft flags occur. This pattern could indicate:
- A subtle ADVM problem not severe enough to trigger Check 2 or 3
- A persistent gauge calibration shift
- A physical channel change (e.g., debris jam)

Currently, each soft flag is treated independently. There is no escalation mechanism.

### 3.4 Race Conditions Between sync-learning.js and scheduled-update.js

Both files can validate observations. `sync-learning.js` is the client-triggered path (called when a user loads the page), while `scheduled-update.js` is the cron-triggered path. Both compete for the same pending predictions.

The current code has a natural serialization: `scheduled-update.js` runs every 15 minutes and processes all pending predictions, while `sync-learning.js` processes one prediction per client request. The Supabase `upsert` with `onConflict` prevents duplicate writes.

**No new race condition introduced by this plan.** The hard/soft split is a local scoring change within each function. Both functions independently compute scores and write results. The risk is that the two files could apply *different* scoring logic if they drift out of sync — but this risk exists today and the plan actually *reduces* it by standardizing thresholds.

---

## 4. Implementation Concerns

### 4.1 Migration Strategy

The migration (Section G) is sound:
- Resets `sumAbsErrorPercent` and `validValidations` to 0 (accuracy rebuilds from scratch)
- Maps `flaggedValidations → hardFlaggedValidations` (conservative)
- Initializes `softFlaggedValidations` to 0
- One-time guard via `v33MigrationDone` flag

The v32.3 migration guard (`!metaData.validValidations && metaData.sumAbsErrorPercent > 0`) will still fire if v33 migration hasn't run yet but v32.3 migration also hasn't run. The v33 migration should supersede it. The plan handles this by checking `!metaData.v33MigrationDone` first, which will fire before the v32.3 check on line 678 of sync-learning.js (because the v33 migration sets `validValidations = 0`, which means the v32.3 check `!metaData.validValidations` would also be true on the next run, but `sumAbsErrorPercent` would be 0 so it would be a no-op). **No issue.**

### 4.2 Soft-Flagged Observations Get gauge_id = 'validated'

This means the database cannot distinguish between clean validations and soft-flagged ones at the `gauge_id` level. The distinction is only in `data.isSoftFlagged`. This is fine for current usage (no queries filter on `gauge_id = 'flagged'`), but limits future analysis.

A better approach would be `gauge_id: 'soft_flagged'`, creating three distinct categories: `'hard_flagged'`, `'soft_flagged'`, `'validated'`. This costs nothing and preserves maximum information.

### 4.3 Tech Appendix Discrepancy

The Tech Appendix (index.html lines 6346–6383) shows Check 3 as +1 and EF threshold as >30%. These are already wrong relative to `scheduled-update.js` (which has +2 and 0.25). The plan should update the Tech Appendix to match the standardized values.

---

## 5. Alternative Approaches

### 5.1 Weighted Learning Instead of Binary

Instead of binary include/exclude, soft-flagged observations could contribute to the EMA with a reduced weight:

```javascript
const learningWeight = isSoftFlagged ? 0.5 : 1.0;
const effectiveAlpha = EMA_ALPHA * learningWeight;
binData.emaMeanError = effectiveAlpha * errorCFS + (1 - effectiveAlpha) * binData.emaMeanError;
```

This would reduce the EMA contamination risk (R1) while still allowing learning. A soft-flagged 3000 cfs error with weight 0.5 would shift the EMA by only:

```
0.15 × 3000 + 0.85 × 200 = 450 + 170 = 620 cfs  (vs 1040 with full weight)
```

Still a large shift, but less damaging. However, this adds complexity to an already nuanced system. The simpler approach (R1: cap the per-observation EMA contribution) may be preferable.

### 5.2 Different Soft Flag Threshold

The plan uses softScore ≥ 2, same as the old suspiciousScore ≥ 2. Since soft checks have lower stakes (they still contribute to learning), a higher threshold like ≥ 3 would mean Check 1 (EF_DISCREPANCY, +2) alone is not enough to soft-flag — it would need to combine with Check 4 (LARGE_ERROR, +1) or Check 5 (STATISTICAL_OUTLIER, +2). This would reduce the total number of soft flags, making the distinction less useful for diagnostics.

**I recommend keeping softScore ≥ 2** since soft flags are informational and low-stakes.

---

## Recommendations

### R1: Cap EMA Contribution from Soft-Flagged Observations [CRITICAL]

**Problem**: A single soft-flagged observation with a 50%+ error can shift the EMA by 5x, corrupting the correction bin for subsequent estimates.

**Recommendation**: Clamp the error contribution to the EMA when the observation is soft-flagged. Specifically, cap the error at ±2σ of the bin's historical distribution before applying the EMA update:

```javascript
if (!skipLearning) {
    let learningError = errorCFS;

    // Clamp soft-flagged observations to ±2σ to prevent EMA contamination
    if (isSoftFlagged && binData.count >= 10) {
        const variance = (binData.sumErrorSq / binData.count) - (binData.meanError * binData.meanError);
        const stdDev = Math.sqrt(Math.max(0, variance));
        const maxDelta = 2 * stdDev;
        learningError = Math.max(binData.meanError - maxDelta,
                        Math.min(binData.meanError + maxDelta, errorCFS));
    }

    // Use learningError for EMA, but raw errorCFS for running sums
    binData.count += 1;
    binData.sumError += errorCFS;        // Running sums use raw value (robust)
    binData.sumErrorSq += errorCFS * errorCFS;
    binData.meanError = binData.sumError / binData.count;
    binData.emaMeanError = EMA_ALPHA * learningError + (1 - EMA_ALPHA) * binData.emaMeanError;
}
```

This allows soft-flagged observations to influence the running mean (which is diluted by count and robust) but limits their ability to spike the EMA (which is used in real-time and sensitive to individual observations).

### R2: Keep STATISTICAL_OUTLIER as Hard, or Use Dampened Learning [HIGH]

**Problem**: Reclassifying 3σ outliers from hard to soft means extreme errors flow into a 0.3-alpha EMA. Even with the R1 clamp, outliers represent transient events (storms, dam releases) whose errors are non-representative of systematic model bias. Learning from them adds noise, not signal.

**Recommendation (Option A — simpler)**: Keep Check 5 (STATISTICAL_OUTLIER) as a hard flag contributor (`hardScore += 2`). The physical reasoning is: if an observation is 3σ from the bin mean, something abnormal happened. It might be the data or the event, but either way, it should not shift the EMA. This is the current behavior and is working.

**Recommendation (Option B — if Option A is rejected)**: If the plan insists on making outliers soft, apply the R1 clamp AND additionally exclude outliers (z > 3) from the EMA entirely while still including them in count/sumError/sumErrorSq. This means outliers improve the long-run mean (robust) but cannot spike the EMA (fragile).

### R3: Use gauge_id = 'soft_flagged' Instead of 'validated' [MEDIUM]

**Problem**: Soft-flagged observations get `gauge_id = 'validated'`, making them indistinguishable from clean validations at the database query level. The only distinction is buried in `data.isSoftFlagged`.

**Recommendation**: Use three gauge_id values: `'hard_flagged'`, `'soft_flagged'`, `'validated'`. This costs nothing to implement and preserves maximum queryability for future analysis. The learning logic would be:

```javascript
gauge_id: isHardFlagged ? 'hard_flagged' : (isSoftFlagged ? 'soft_flagged' : 'validated')
```

Metadata counting and accuracy logic remain unchanged (both 'soft_flagged' and 'validated' contribute).

### R4: Add Consecutive Soft-Flag Escalation [LOW]

**Problem**: Five consecutive soft flags likely indicate a gauge problem, not five consecutive model disagreements.

**Recommendation**: Track `consecutiveSoftFlags` in metadata. If it exceeds 3, promote the next soft flag to hard and log a warning. Reset the counter when a clean validation occurs:

```javascript
if (isSoftFlagged) {
    metaData.consecutiveSoftFlags = (metaData.consecutiveSoftFlags || 0) + 1;
    if (metaData.consecutiveSoftFlags > 3) {
        // Promote to hard — persistent disagreement suggests gauge issue
        isHardFlagged = true;
        isSoftFlagged = false;
        console.log('⚠️ Promoted soft flag to hard: 4+ consecutive soft flags');
    }
} else if (!isHardFlagged) {
    metaData.consecutiveSoftFlags = 0;  // Reset on clean validation
}
```

This is a low-priority enhancement. The current ~60 flags accumulated over winter; if ice is melting, consecutive runs should diminish naturally. Implement only if soft flags remain frequent post-thaw.

### R5: Update Tech Appendix to Match Standardized Thresholds [LOW]

**Problem**: The Tech Appendix (index.html, Section 7.2) shows Check 1 threshold as >30% and Check 3 score as +1, but `scheduled-update.js` already uses 0.25 and +2. The plan standardizes to 0.25 and +2 but does not mention updating the documentation table.

**Recommendation**: Update the Tech Appendix table and Section 7.3 text to reflect the two-tier system, standardized thresholds, and the distinction between hard/soft flags.

### R6: Add Soft-Flag Accuracy Breakdown in Dashboard [LOW]

**Problem**: When accuracy drops from 95% to ~90% due to soft-flagged observations, users may be alarmed without understanding why.

**Recommendation**: Show accuracy as two numbers in the dashboard tooltip or detail view:
- "Accuracy: 92% (all validated)" — includes soft-flagged
- "Accuracy: 95% (clean only)" — excludes soft-flagged

This provides honesty AND context. The primary display can show the "all validated" number (the honest one), with the "clean only" number available on hover or in the Learning tab.

---

## Summary of Recommendations

| ID | Priority | Summary | Accept/Reject Decision Needed |
|----|----------|---------|-------------------------------|
| R1 | CRITICAL | Cap EMA contribution from soft-flagged observations at ±2σ | Must accept for approval |
| R2 | HIGH | Keep STATISTICAL_OUTLIER as hard flag (or exclude from EMA) | Must accept one option for approval |
| R3 | MEDIUM | Use `gauge_id = 'soft_flagged'` for three-tier DB classification | Recommended but not blocking |
| R4 | LOW | Consecutive soft-flag escalation to hard | Optional enhancement |
| R5 | LOW | Update Tech Appendix thresholds | Should be done with this PR |
| R6 | LOW | Dual accuracy display (all validated vs clean only) | Optional UX improvement |

---

## Conditions for Approval

This plan is **APPROVED WITH CHANGES** contingent on:

1. **R1 is implemented** (EMA clamping for soft-flagged observations) — without this, the plan creates a direct path for large errors to corrupt the real-time correction bins.
2. **R2 is resolved** (either keep outliers hard, or exclude from EMA) — 3σ outliers flowing into a 0.3-alpha EMA is too risky without a dampening mechanism.

R3–R6 are recommended but not blocking. The plan can proceed without them, though R3 and R5 are cheap to implement and should be included.

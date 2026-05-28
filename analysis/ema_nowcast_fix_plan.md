# Plan: Fix Nowcast EMA Validation (v34.0)

## Problem Statement

The EMA correction system learns from nowcast validation errors that have four structural flaws:

1. **Seneca noise**: `actualCFS = lf.q - senecaFlow` where `senecaFlow = seneca?.q || (lf.q * 0.01)` — the 1% Seneca approximation adds ±50-200 cfs noise when the Seneca gauge is offline
2. **Timing jitter**: Validation fires when `now >= validationDue` with no upper bound — if the 2h server cron misses the window, validation happens 0-2h late, when the river has changed
3. **Flow state mismatch**: Already stored at prediction time (flowBin, flowState), but this is NOT the problem people think — the mismatch is actually in the *target*: `actualCFS` is computed from LF at validation time, which reflects conditions that changed during transit
4. **Dual update paths**: Both client (every 30min via `recordValidation`) and server (every 2h via `validatePendingPredictions`) independently update the same correction bins — race condition

## Why NOT Forecast-Based Learning

The original plan proposed switching to +6h forecast errors. Two independent auditors (coding + hydrology) identified a **critical domain mismatch**:

- The +6h forecast uses **NWS forecast inputs** (predicted PoR, predicted EF)
- The nowcast uses **observed gauge data** (actual PoR, actual EF)
- Corrections learned from NWS-contaminated forecast errors, applied to observation-based nowcasts, would **inject NWS forecast bias** into clean estimates
- This violates the operational hydrology principle: corrections must be learned and applied in the same model framework

See rejected plan: `analysis/ema_forecast_learning_plan.md`

## Proposed Solution: Fix the Four Nowcast Flaws

### Fix 1: Eliminate Seneca Noise — Validate Against Raw LF

**Current** (scheduled-update.js line 650-651):
```javascript
const senecaFlow = seneca?.q || (lf.q * 0.01);
const actualCFS = lf.q - senecaFlow;
```

**New**:
```javascript
const actualCFS = lf.q;
```

**Rationale**: The correction should learn the full model-vs-LF error, which naturally includes the Seneca Creek contribution. This is better than subtracting a noisy 1% approximation. The nowcast model already adds Seneca as a tributary input (`senecaCFS` at line 2624 of index.html), so the correction will learn the net Seneca estimation error along with everything else — which is exactly what we want.

The same change applies to the client-side path in sync-learning.js (line 474) and index.html (line 1852-1853).

**Impact**: Removes ±50-200 cfs noise per validation. At median flow (~5000 cfs), this is 1-4% noise eliminated.

### Fix 2: Tight Validation Window — Reject Late Validations

**Current** (scheduled-update.js line 648):
```javascript
if (now >= validationDue) {
```

**New**:
```javascript
const VALIDATION_WINDOW_MS = 30 * 60 * 1000;  // 30-minute window
if (now >= validationDue && now <= new Date(validationDue.getTime() + VALIDATION_WINDOW_MS)) {
```

Predictions whose window has passed without being checked are left pending for the next cron run. If still stale after 48h, the existing stale cleanup (line 632) handles them.

**Wait — this won't work well with a 2h cron**. If the cron fires at T and validationDue is T+15min, the prediction won't be ready yet. The next cron at T+2h would be T+2h > validationDue+30min = T+45min → too late, window closed.

**Better approach**: Use a wider window but still bounded. The key is to reject validations that are extremely late (>2h after due), not to narrow the window to 30min:

```javascript
const VALIDATION_MAX_DELAY_MS = 2.5 * 60 * 60 * 1000;  // 2.5 hours max delay
if (now >= validationDue && (now - validationDue) <= VALIDATION_MAX_DELAY_MS) {
```

With 2h cron cycles, validationDue will typically be caught within 0-2h of becoming ready. The 2.5h bound rejects predictions that were missed by two full cron cycles (indicating something went wrong — server down, etc).

**Impact**: Eliminates extreme outlier validations (>2.5h late) while allowing normal cron timing. The 0-2h jitter within the window is still present but bounded.

### Fix 3: Disable Client-Side Bin Updates — Server-Only

**Current**: Both paths update correction bins:
- Server: `validatePendingPredictions()` in scheduled-update.js (lines 765-832)
- Client: `recordValidation` action in sync-learning.js (lines 596-628)

**New**: Only the server path updates bins. The client-side `recordValidation` action keeps everything else (anomaly detection, prediction status move, metadata counters, EF correlation) but **skips the correction bin UPSERT**.

Additionally, the client-side validation and the server-side validation can race on the same prediction — both try to move it from `pending` to `validated`. This race also affects metadata counters (double-counting).

**Full fix**: Disable client-side `checkGFValidations()` entirely. The server handles all validations every 2h. The client doesn't need to duplicate this work.

**Implementation**: In `index.html`, make `checkGFValidations()` a no-op that just returns. Keep the function signature for backward compatibility. Add a comment explaining why.

**Impact**: Eliminates race conditions on both bins AND metadata. Single source of truth for all validation.

### Fix 4: (Already correct — No change needed)

Flow state mismatch: `flowBin` and `flowState` are already stored at prediction time (when `makeGFPrediction()` runs on the server, and when `sendGFPrediction()` runs on the client). They're correctly used at validation time for bin keying. No change needed.

## What Changes vs What Stays

### Stays the same
- `estimateGreatFalls()` — unchanged
- `getGFCorrection()` / `getGFUncertainty()` — unchanged
- Correction bin schema, EMA formula, flow bins, two-tier anomaly flagging
- Client-side learning data loading (`loadGFLearningData()`)
- Empirical CI lookup table
- Forecast prediction storage and validation (accuracy tracking continues separately)
- Server-side `validatePendingPredictions()` — still updates bins (with Fixes 1-2 applied)

### Changes

| # | File | Change | Lines |
|---|------|--------|-------|
| 1a | `scheduled-update.js` | `actualCFS = lf.q` (drop Seneca subtraction) | ~650-651 |
| 1b | `scheduled-update.js` | Add validation window guard (2.5h max delay) | ~648 |
| 2a | `sync-learning.js` | Remove correction bin UPSERT from `recordValidation` | ~596-628 |
| 2b | `sync-learning.js` | Remove EF correlation update from `recordValidation` | ~630-678 |
| 3 | `index.html` | Disable `checkGFValidations()` (no-op) | ~1800-1876 |

## Implementation Details

### File 1: `scheduled-update.js` (~10 lines changed)

**Change A** — Line 650-651, `actualCFS` calculation:

Before:
```javascript
const senecaFlow = seneca?.q || (lf.q * 0.01);
const actualCFS = lf.q - senecaFlow;
```

After:
```javascript
// v34.0: Validate against raw LF discharge (not LF - Seneca estimate)
// The correction naturally absorbs Seneca estimation error + ungauged area signal
const actualCFS = lf.q;
```

**Change B** — Line 648, validation window:

Before:
```javascript
if (now >= validationDue) {
```

After:
```javascript
// v34.0: Reject validations that are too late (>2.5h after due)
// With 2h cron, normal delay is 0-2h; beyond that, flow conditions have changed too much
const validationDelayMs = now - validationDue;
const VALIDATION_MAX_DELAY_MS = 2.5 * 60 * 60 * 1000;
if (now >= validationDue && validationDelayMs <= VALIDATION_MAX_DELAY_MS) {
```

Note: The `seneca` variable is still fetched (line 588) and used for logging, but no longer used in error calculation. Keep `seneca` available for future reference/logging.

**Change C** — Log the delay for monitoring:

After the validation window check, add:
```javascript
const delayMinutes = Math.round(validationDelayMs / 60000);
console.log(`⏱️ Validation delay: ${delayMinutes}min after due time`);
```

### File 2: `sync-learning.js` (~40 lines removed/commented)

**Change A** — Lines 596-628, remove correction bin update from `recordValidation`:

Replace the bin update block with a comment:
```javascript
// v34.0: Correction bin updates disabled in client path
// Server-side validatePendingPredictions() is the single source of truth for EMA bin updates
// This eliminates the client/server race condition on correction bins
```

Keep: anomaly detection (lines 508-593), prediction status move (lines 680-702), metadata update (lines 704-752).

**Change B** — Lines 630-678, remove EF correlation update from `recordValidation`:

The server-side `validatePendingPredictions()` already updates EF correlation (lines 834-898 of scheduled-update.js). The client was doing the same update → race condition. Remove from client path.

```javascript
// v34.0: EF correlation updates disabled in client path
// Server-side validatePendingPredictions() handles EF correlation as single source of truth
```

**Change C** — Update the response to indicate bins were NOT updated:

Line 759: Change `binUpdated: isHardFlagged ? null : binKey` to `binUpdated: null  // v34.0: server-only bin updates`

### File 3: `index.html` (~15 lines changed)

**Change A** — Disable `checkGFValidations()`:

Replace the function body (~lines 1800-1876) with:
```javascript
// v34.0: Client-side validation disabled — server is single source of truth
// The server's validatePendingPredictions() runs every 2h and handles all validations.
// Keeping client-side validation created race conditions where both paths updated
// correction bins, metadata counters, and EF correlation concurrently.
// The function signature is preserved for backward compatibility.
function checkGFValidations() { return; }
```

**Change B** — `sendGFValidation()` can stay as-is (it won't be called anymore since `checkGFValidations` is a no-op). Or optionally, also make it a no-op with a comment. Keeping it doesn't hurt — dead code, but harmless.

**Change C** — Remove the Seneca subtraction in the (now dead) client validation path. Even though `checkGFValidations` is disabled, for code clarity update lines 1850-1853:

```javascript
// v34.0: Was actualGFCFS = lf.q - senecaFlow; now validate against raw LF
const actualGFCFS = lf.q;
```

## What Does NOT Change
- `sendGFPrediction()` — still stores predictions from client (these are validated by server)
- `storePrediction()` in scheduled-update.js — still stores predictions from server
- `storeForecastPredictions()` — unchanged (forecast accuracy tracking is independent)
- `validateForecastPredictions()` — unchanged (tracks forecast accuracy display only)
- EMA alpha (stays at 0.3)
- Flow bins, flow states
- Two-tier anomaly detection logic
- Prediction record fields (flowBin, flowState already stored at prediction time)

## Migration / Backward Compatibility

- **Correction bins**: Keep existing values. The Seneca removal will shift errors by ~1% of LF (the Seneca that was being subtracted). For typical flow (~5000 cfs), this is ~50 cfs shift — small enough that the EMA will absorb it within a few validations.
- **Client predictions in flight**: Any pending predictions stored by the client will still be validated by the server on the next cron run. No orphaned predictions.
- **Old `recordValidation` calls**: If a client version before the update calls `recordValidation`, the server function no longer updates bins but still processes the validation correctly (moves prediction, updates metadata). Graceful degradation.

## Error Comparison: Before vs After

| Aspect | Before (v33.1) | After (v34.0) |
|--------|----------------|---------------|
| **Target** | `predicted_GF - (LF - Seneca_est)` | `predicted_GF - LF` |
| **Seneca noise** | ±50-200 cfs | Zero |
| **Max validation delay** | Unbounded (0 to 48h) | Capped at 2.5h |
| **Update paths** | Client (30min) + Server (2h) | Server only (2h) |
| **Race conditions** | Yes (bins + metadata + EF corr) | None |
| **Correction signal** | Model error - Seneca | Model error + ungauged area |

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Correction shift from Seneca removal (~1%) | Low | EMA absorbs within ~5 validations (~10h) |
| Fewer validations (server-only vs client+server) | Low | Server validates every 2h → ~12/day, sufficient |
| 2.5h window rejects some valid late validations | Low | Only rejects extreme outliers; 99%+ of validations are within 2h |
| Dead client validation code | Very Low | Harmless; clean up in future version |

## Version Impact

- **v34.0 (MAJOR)**: The Seneca removal changes the error target, which changes what the EMA corrections converge to. Same model coefficients, but different learned corrections → different output for same inputs.
- Update version in: `index.html` (footer + Tech Appendix), `CLAUDE.md`

## Verification Plan

1. **Pre-deployment**: Review diffs — confirm only the three changes described above
2. **Post-deployment**: Check server logs for `⏱️ Validation delay:` messages — confirm delays are 0-120min
3. **Monitor bins**: Compare correction bin emaMeanError values over 48h — should see small shift (~50 cfs toward negative) as Seneca removal takes effect
4. **Check for races**: Confirm no more client-side `🌊 GF validation` console messages
5. **Rollback**: Re-enable client validation and Seneca subtraction if corrections diverge unexpectedly

## Summary of Changes

| File | Lines changed | What |
|------|---------------|------|
| `scheduled-update.js` | ~5 | Drop Seneca subtraction + add 2.5h validation window + delay logging |
| `sync-learning.js` | ~40 (removals) | Remove bin update + EF correlation from `recordValidation` |
| `index.html` | ~15 | Disable `checkGFValidations()` + clean up dead Seneca code |
| **Total** | ~60 lines | |

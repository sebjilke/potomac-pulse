# Plan: Switch EMA Corrections to Learn from Forecast Errors

## Problem Statement

The current EMA correction system learns from **nowcast validation errors** that are structurally flawed:

1. **Wrong target**: GF estimate (predicted) vs `LF - Seneca` (actual) — Seneca is approximated as 1% of LF when gauge is unavailable, adding noise
2. **Timing jitter**: Validation happens when the 2h server cron fires, but water takes 6.5h to transit GF→LF — creating 0-2h random delay where the river has changed
3. **Flow state mismatch**: The `flowBin` and `flowState` stored with the prediction reflect conditions at prediction time, but the river may have transitioned (rising→falling) during the 6.5h transit — correction gets stored in the wrong bucket
4. **Compounding**: These errors compound in the EMA (α=0.3), slowly drifting corrections away from true bias

## Proposed Solution

Switch the EMA correction system to learn from **+6h forecast validation errors** instead. The infrastructure already exists:

- Client already stores forecast predictions every 2h (`storeForecastPredictions()`)
- Server already validates them (`validateForecastPredictions()`) — compares `predictedCFS` vs `lf.q`
- The +6h horizon is closest to the GF→LF travel time (~5-7h), making it the most relevant

The key change: instead of just tracking forecast accuracy as a display metric, **feed the +6h forecast validation error into the EMA correction bins**.

## What Changes vs What Stays

### Stays the same
- `estimateGreatFalls()` — unchanged, still reads from `correctionBins`
- `getGFCorrection()` / `getGFUncertainty()` — unchanged
- Correction bin schema: `{count, sumError, sumErrorSq, meanError, emaMeanError}`
- EMA formula: `newEMA = 0.3 × newError + 0.7 × oldEMA`
- Flow bin definitions: `['0-3000', '3000-6000', '6000-12000', '12000-25000', '25000-50000', '50000+']`
- Two-tier anomaly flagging logic (hard/soft thresholds)
- Client-side learning data loading (`loadGFLearningData()`)
- Empirical CI lookup table (hardcoded, display-only)

### Changes

#### 1. `storeForecastPredictions()` in `index.html` — Add flow context fields

**Current**: Stores `{horizon, targetTime, predictedCFS, predictedStage, source, nwsLfRawCFS, ...}`

**New**: Also store `flowBin` and `flowState` at prediction time so validation can key corrections properly.

```javascript
// Add to each forecast object:
flowBin: getGFFlowBin(p.cfs),     // Bin based on predicted CFS at forecast time
flowState: currentFlowState,       // Flow state when prediction was made
currentPorCFS: currentPorCFS       // PoR reading at prediction time (for context)
```

**Rationale**: The correction should be keyed by conditions at *prediction time* (when the model made its decision), not at validation time (when we check the result). This eliminates the flow-state-mismatch problem.

#### 2. `validateForecastPredictions()` in `scheduled-update.js` — Feed +6h errors into EMA bins

**Current**: Only updates `gf_forecast_metadata` (accuracy display). Deletes prediction after.

**New**: For +6h predictions only, *also* update `gf_correction_bin` rows using the same EMA logic currently in `validatePendingPredictions()`.

```
IF horizon === 6:
  errorCFS = predictedCFS - actualLF
  flowBin = pred.data.flowBin      ← from prediction time
  flowState = pred.data.flowState   ← from prediction time

  [Run two-tier anomaly detection]
  [If not hard-flagged: update gf_correction_bin with EMA]
  [Update gf_metadata counts]
```

**Key details**:
- Only +6h horizon feeds into EMA (closest to real travel time)
- `flowBin` and `flowState` come from the prediction record (prediction-time conditions)
- Error is `predictedCFS - lf.q` (clean comparison: model vs actual LF, no Seneca subtraction)
- Same EMA α=0.3, same soft-flag clamping at ±2σ
- Same hard-flag thresholds (stage-discharge, low-flow+high-stage, 3σ outlier)

#### 3. `validatePendingPredictions()` in `scheduled-update.js` — Stop feeding nowcast errors into EMA bins

**Current**: Validates pending GF predictions and updates `gf_correction_bin`.

**New**: Still validate (for record-keeping, flagging, and metadata), but **do NOT update `gf_correction_bin`**. The prediction records are still moved from `pending` to `validated`/`flagged`, metadata counters still update, but the EMA bins are no longer touched.

**Why keep the rest**:
- Prediction records provide audit trail (when was this prediction made, what was the result)
- Metadata counters track overall system health (total validations, flag rates)
- The anomaly detection catches genuine data corruption even if corrections aren't updated from this path

#### 4. `recordValidation` action in `sync-learning.js` — Stop feeding client-side validations into EMA bins

**Current**: Client calls `sendGFValidation()` → `recordValidation` action → updates correction bins.

**New**: Same as server-side: still moves predictions to validated/flagged, still updates metadata, but **skips the correction bin update**. This eliminates the duplicate validation path (both client AND server were updating bins, creating race conditions).

**Note**: After this change, corrections flow exclusively through the server-side forecast validation path, which is cleaner — single source of truth, no race conditions between client and server updating the same bins.

## Error Comparison: Old vs New

| Aspect | Old (Nowcast) | New (+6h Forecast) |
|--------|---------------|---------------------|
| **Target** | `predicted_GF - (LF - Seneca)` | `predicted_LF - actual_LF` |
| **Seneca noise** | ±1% of LF (~50-200 cfs) | Zero (LF vs LF) |
| **Timing** | Validated 0-2h late (cron jitter) | Validated at +6h target ±15min |
| **Flow state key** | Prediction-time (may mismatch transit) | Prediction-time (correct by design) |
| **Update frequency** | Every 2h (server) + every 30min (client) | Every 2h (server only) |
| **Race conditions** | Client + server both update bins | Server only — single source of truth |

## What `predictedCFS` Actually Is

The forecast's `predictedCFS` (stored by `storeForecastPredictions`) is the output of the **GF estimation model** applied to future NWS forecast conditions (PoR forecast + EF power-law). The `forecastStage` is the LF stage derived from `estimateLFStage(forecastCFS)`.

So the +6h forecast validation compares: **"what the GF model predicts LF-equivalent flow will be in 6h"** vs **"what LF actually reads in 6h"**. This is a clean model-vs-actual comparison at the LF gauge — the only place we have ground truth.

The error includes the systematic GF→LF gap (~3.7% ungauged area), but this gap is consistent and exactly what the EMA corrections should learn to compensate for.

## Anomaly Detection Adaptation

Current anomaly checks in `validatePendingPredictions()` use:
1. **Stage-discharge inconsistency** — compares predicted stage vs stage implied by actual CFS. Still valid.
2. **Low-flow + high-stage** — checks `actualCFS < 1500 && actualStage > 2.45`. Still valid (using LF values).
3. **Statistical outlier** — z-score > 3σ from bin mean. Still valid.
4. **EF discrepancy** — checks if EF estimate diverges >25% from actual. Needs adaptation: the forecast record currently doesn't store `efEstimateCFS`. Options:
   - **Skip EF soft-flag for forecasts**: Simplest. The EF discrepancy check is a soft flag (included in learning with clamping). At +6h horizon, the EF forecast is less reliable anyway. Removing this one soft flag check is acceptable.
   - **Store EF estimate in forecast**: Add `efEstimateCFS` to the forecast prediction. More complete but more work.

   **Recommendation**: Skip EF soft-flag for now. We can add it later if needed.
5. **Large error >50%** — checks `errorPercent > 50`. Still valid.

## Implementation: File-by-File

### File 1: `index.html` (~10 lines changed)

**Location**: `storeForecastPredictions()` (~line 1714)

Add flow context to each forecast object:
```javascript
forecasts: forecastsToStore.map(p => ({
    horizon: parseInt(p.label.replace('+', '').replace('h', '')),
    targetTime: p.time.toISOString(),
    predictedCFS: p.predictedCFS,
    predictedStage: p.predictedStage,
    source: p.source,
    createdAt: new Date().toISOString(),
    // Flow context at prediction time (for EMA correction keying)
    flowBin: getGFFlowBin(p.cfs),
    flowState: currentFlowState,
    currentPorCFS: porData?.q || null,
    // Baselines
    nwsLfRawCFS: p.nwsLfRawCFS || null,
    nwsLfBiasCorrectedCFS: p.nwsLfBiasCorrectedCFS || null,
    persistenceCFS: p.persistenceCFS || null
}))
```

**Note**: Need to capture `currentFlowState` at the scope where `storeForecastPredictions` is called. Check if it's available in `updateForecastPeriods()`.

### File 2: `scheduled-update.js` (~60 lines changed)

**Change A**: `validateForecastPredictions()` (~line 1049)

After the existing accuracy metadata update (line 1158), add for +6h horizon only:

```javascript
// Feed +6h forecast errors into EMA correction bins
if (horizonNum === 6 && pred.data.flowBin && pred.data.flowState) {
    await updateCorrectionBinFromForecast(client, {
        errorCFS,
        errorPercent,
        flowBin: pred.data.flowBin,
        flowState: pred.data.flowState,
        predictedCFS,
        actualCFS,
        actualStage: lf.stageValue || null,    // LF stage at validation time
        predictedStage: pred.data.predictedStage
    });
}
```

**New function**: `updateCorrectionBinFromForecast()` — extracted from `validatePendingPredictions()` lines 765-832. Same logic:
1. Load existing bin data
2. Run anomaly detection (hard flags: stage-discharge, low+high, 3σ; soft flag: large error >50%)
3. If not hard-flagged: update count, sumError, sumErrorSq, meanError, emaMeanError
4. Soft-flag clamping at ±2σ
5. UPSERT to `gf_correction_bin`

**Change B**: `validatePendingPredictions()` (~line 765)

Comment out (or remove) the correction bin update block. Keep:
- Anomaly detection (for flagging/audit trail)
- Prediction status update (pending → validated/flagged)
- Metadata update (totalValidations, avgErrorPercent)
- Stage error tracking
- EF correlation tracking

Remove:
- The `gf_correction_bin` UPSERT (lines ~765-832)

### File 3: `sync-learning.js` (~10 lines changed)

**Change**: `recordValidation` action (~line 473-776)

Comment out the correction bin update block. Keep everything else (prediction status update, metadata, anomaly detection records).

### File 4: `sync-learning.js` — `storeForecastPredictions` action (~line 449)

**Change**: Pass through the new `flowBin`, `flowState`, `currentPorCFS` fields in the stored data.

```javascript
data: {
    horizon: f.horizon,
    targetTime: f.targetTime,
    predictedCFS: f.predictedCFS,
    predictedStage: f.predictedStage,
    source: f.source,
    createdAt: f.createdAt,
    // NEW: flow context for EMA correction keying
    flowBin: f.flowBin || null,
    flowState: f.flowState || null,
    currentPorCFS: f.currentPorCFS || null,
    // Baselines (existing)
    nwsLfRawCFS: f.nwsLfRawCFS || null,
    nwsLfBiasCorrectedCFS: f.nwsLfBiasCorrectedCFS || null,
    persistenceCFS: f.persistenceCFS || null
}
```

## Migration / Backward Compatibility

### Existing correction bins
- **Keep them**. The new +6h errors will flow into the same bins and gradually overwrite the old corrections via EMA (α=0.3). After ~10 validations per bin (5 days × ~2/day), the old signal will be ~97% decayed.
- No reset needed. The corrections will naturally converge to the new, cleaner signal.

### Existing forecast predictions without flowBin/flowState
- Guard: `if (pred.data.flowBin && pred.data.flowState)` — skip EMA update for old predictions that don't have these fields.
- New predictions will include the fields. Old ones will validate for accuracy tracking only (existing behavior).

### Client-side validation still runs
- `checkGFValidations()` still fires every 30min on the client — but `recordValidation` no longer updates correction bins. The validation is stored for audit trail only.
- Could fully remove client-side validation in a future cleanup. For now, leave it running (zero risk, provides data).

## Timing & Update Frequency

| Event | Frequency | What happens |
|-------|-----------|-------------|
| Client stores forecast predictions | Every 2h | 4 forecasts stored (+6h, +12h, +24h, +48h) |
| Server validates +6h forecast | Every 2h (when target time passes) | EMA bins updated |
| Client loads correction bins | On page load + every 30min | Uses latest EMA corrections |
| Old nowcast validation (server) | Every 2h | Still runs but no longer updates bins |
| Old nowcast validation (client) | Every 30min | Still runs but no longer updates bins |

**Net effect**: EMA bins get ~12 updates per day (one +6h forecast every 2h × ~50% that mature before next cron). Same order of magnitude as current system.

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| +6h forecasts less frequent than nowcasts | Low | ~12/day is sufficient for EMA convergence |
| Old bins may be stale during transition | Low | EMA naturally decays old signal; 5-day convergence |
| Forecast not stored during ice periods | Low | Learning already skipped during ice (existing guard) |
| flowBin/flowState might be wrong at forecast time | Low | Based on model output, which is what corrections should target |
| Client-side validation becomes orphaned code | Low | Harmless; can clean up later |
| EF soft-flag check missing from forecast path | Very Low | Only matters for soft flags; large-error check still catches extreme cases |

## Verification Plan

1. **Pre-deployment**: Check console logs on staging for "📈 Stored 4 forecast predictions" — confirm `flowBin` and `flowState` are included
2. **Post-deployment**: Wait for +6h forecast to mature. Check server logs for new correction bin update message
3. **Monitor**: Compare correction bin values before vs after over 48h. They should converge toward lower-noise values
4. **Rollback**: If corrections diverge wildly, re-enable nowcast bin updates (uncomment the removed blocks)

## Version Impact

This changes how EMA corrections are learned but doesn't change the estimation model itself. However, because corrections *feed into* the estimate (via `getGFCorrection()`), the output will gradually change as new corrections overwrite old ones.

**Recommendation**: Version bump to **v34.0** (MAJOR) — the EMA corrections will produce different GF estimates for the same inputs once the new +6h errors flow through. The model coefficients and logic are unchanged, but the learned corrections are a core part of the output.

## Summary of Changes

| File | Lines changed | What |
|------|---------------|------|
| `index.html` | ~10 | Add `flowBin`, `flowState`, `currentPorCFS` to forecast predictions |
| `scheduled-update.js` | ~60 | New `updateCorrectionBinFromForecast()`, call it for +6h; disable bin updates in nowcast validation |
| `sync-learning.js` | ~10 | Pass through new fields; disable bin updates in client validation |
| **Total** | ~80 lines | |

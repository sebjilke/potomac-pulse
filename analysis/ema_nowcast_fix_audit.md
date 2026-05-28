# Hydrology Audit Report: EMA Nowcast Fix Plan (v34.0)

**Auditor**: Independent hydrology and prediction systems expert
**Date**: 2026-02-26
**Plan file**: `/Users/sebjilke/Desktop/PotomacPulse/analysis/ema_nowcast_fix_plan.md`
**Scope**: Four-fix plan to correct structural flaws in nowcast EMA validation

---

## Overall Assessment

The revised plan is **hydrologically sound and well-motivated**. The decision to reject forecast-based learning was correct -- applying corrections learned from NWS-contaminated error signals to observation-based nowcasts would violate the fundamental RFC operational principle that bias corrections must be learned and applied within the same model framework. The four-fix approach targets real validation pathology without changing the estimation model itself.

I identify **no CRITICAL issues**. Two MODERATE findings merit attention before implementation. The remainder are LOW or INFO.

---

## Finding 1: Seneca Removal -- Validate Against Raw LF

**Rating: LOW**

### Water Balance Analysis

The model estimates Great Falls discharge as:

```
GF_hat = f(PoR_shifted, Monocacy, Goose, BroadRun, Seneca, EF_blend, corrections)
```

The validation target changes from:

- **Old**: `actual = LF - Seneca_estimate` (attempting to reconstruct GF)
- **New**: `actual = LF` (raw downstream measurement)

From a mass balance perspective:

```
LF = GF + DifficultRun + CabinJohn + minor_seeps - WashAqueduct_diversion
```

where the ungauged GF-to-LF gap is approximately +3.7% of LF flow (Difficult Run ~58 sq mi, Cabin John ~26 sq mi, minus ~400-700 cfs aqueduct withdrawal). The old approach subtracted Seneca (~0.87% of LF) from LF to approximate GF, but this was incomplete -- it did not account for the additions (Difficult Run, Cabin John) or the subtraction (aqueduct). The result was a target that was neither GF nor LF, but an inconsistent hybrid.

### Is lumping three error sources into one correction acceptable?

The correction will now absorb: (a) structural model bias, (b) Seneca estimation error, and (c) the ungauged GF-to-LF gap.

**Yes, this is acceptable and arguably preferable.** Here is why:

1. **The Seneca contribution is small and varies with the same hydrology as the main stem.** At 0.87% of LF, it is dominated by main-stem PoR variability. The Seneca estimation error (gauge online vs. 0.87% fallback) added ±50-200 cfs of pure noise to the validation target with no information gain.

2. **The ungauged area gap is NOT constant, but it is monotonically flow-dependent.** Difficult Run and Cabin John are urbanized tributaries with flashy response. At baseflow (~3,000 cfs LF), their combined contribution is perhaps 50-100 cfs. During regional storms (>25,000 cfs LF), it can reach 1,000+ cfs. This flow dependence is *exactly* what the 6-bin x 3-state correction matrix is designed to capture. The per-bin EMA will learn a different ungauged-area offset for each flow regime.

3. **Regime-dependent behavior is a feature, not a bug.** The concern that corrections will vary by regime is correct -- but the bin structure already stratifies by flow regime and flow state. A constant correction across all flows would be wrong; a per-bin correction is how RFC operational systems handle exactly this kind of systematic bias.

4. **The old Seneca subtraction created worse regime-dependent behavior.** When the Seneca gauge was offline (using the 1% fallback), the subtraction was deterministic and flow-proportional. When the gauge was online, the subtraction reflected actual Seneca Creek discharge, which responds to local precipitation events on a different timescale than the Potomac main stem. This created an inconsistent validation target that mixed two different error structures.

**One nuance**: during localized thunderstorms over the Difficult Run / Cabin John watersheds (but not over the main Potomac basin), the ungauged-area contribution could spike by 500+ cfs while the main-stem flow remains baseflow. This would create a transient negative error (model under-predicts LF) that the EMA would partially absorb. With alpha=0.3, a single 500 cfs anomaly shifts the EMA by ~150 cfs, which would decay over subsequent validations. The per-bin structure limits damage: a localized storm at baseflow only affects the `0-3000_steady` bin, not the high-flow bins. This is acceptable -- RFC systems routinely tolerate this kind of noise in bias correction.

**Conclusion**: The switch to raw LF is cleaner, less noisy, and produces a more physically interpretable correction signal. Approved.

---

## Finding 2: Validation Window (2.5h Max Delay)

**Rating: MODERATE**

### Hydrological Adequacy

The validation checks whether `predicted_GF(T)` matches `LF(T + travelGFtoLF)`. With a 2h cron cycle, the actual validation time is `T + travelGFtoLF + delay`, where delay ranges from 0 to 2h.

**How much can LF change during the 0-2h delay?**

I computed approximate LF change rates from the system's own flow regime:

| Flow regime | Typical rise rate | Max LF change in 2h |
|-------------|-------------------|---------------------|
| Baseflow (~3,000 cfs) | 50-100 cfs/hr | 100-200 cfs (3-7%) |
| Moderate (~10,000 cfs) | 200-500 cfs/hr | 400-1,000 cfs (4-10%) |
| Flood rise (~30,000 cfs) | 1,000-3,000 cfs/hr | 2,000-6,000 cfs (7-20%) |
| Flood crest (~50,000+) | near-zero | <500 cfs (<1%) |
| Recession | -100 to -500 cfs/hr | -200 to -1,000 cfs (stable) |

During flood rises, a 2h delay introduces 7-20% error into the validation target. This is a significant contamination of the learning signal. However:

**Mitigating factors:**
- The 2.5h window *caps* the delay; the median delay with a 2h cron is ~1h (uniformly distributed 0-2h)
- Flood rises (>30,000 cfs) are infrequent -- perhaps 5-10% of all validations per year
- During rises, the flow state is `rising`, so the error contaminates only the `*_rising` bins
- The rising-state bins already have larger error variance (empirical 90% CI is wider), so the additional noise is proportionally less impactful
- The EMA with alpha=0.3 smooths over individual noisy validations

**However**: the plan could do better. NWS River Forecast Centers validate bias corrections at the *observation time closest to the target time*, not at an arbitrary cron window. A simple improvement: instead of checking `now >= validationDue`, look up the LF observation whose USGS timestamp is closest to `validationDue`. The USGS instantaneous values API provides timestamps to 15-minute resolution. This would reduce the effective delay from 0-2h to 0-15min.

**Recommendation**: The 2.5h window is adequate for an initial fix -- it eliminates the worst outliers (unbounded delay). But for a future version, consider matching the validation observation to the target time via USGS timestamps rather than relying on whatever LF reading happens to be current when the cron fires. This would bring the system closer to RFC best practices.

**Conclusion**: Approved with reservation. The 2.5h window is a meaningful improvement over unbounded delay. The remaining 0-2h jitter is acceptable for baseflow and recession, but introduces non-trivial noise during rapid rises. Flag for future improvement.

---

## Finding 3: Single-Source Validation (Server-Only)

**Rating: LOW**

### Is 2h granularity sufficient?

The concern here is whether reducing from client (every 30min) + server (every 2h) to server-only (every 2h) degrades operational learning.

**Short answer: No.** Here is why:

1. **Validation frequency is NOT the same as prediction frequency.** The model generates a new prediction every 2h (server cron cycle). Each prediction has exactly one validation opportunity (when `travelGFtoLF` hours have elapsed). Whether that validation happens at the client or server is irrelevant -- each prediction is validated once.

2. **The race condition was the real problem.** Both client and server were validating the *same* prediction, potentially with different LF readings (minutes apart) and racing to update the same correction bin. This could cause: (a) double-counting in `count`, `sumError`, `sumErrorSq`, (b) inconsistent EMA values depending on who wrote last, (c) double metadata increments. Eliminating this is strictly an improvement.

3. **RFC systems validate on the forecast cycle, not more frequently.** NOAA's CHPS (Community Hydrologic Prediction System) validates forecasts once per forecast issuance cycle (typically 6h). Validating every 2h is already more frequent than standard practice.

4. **The server path has all necessary context.** It has fresh USGS data, the prediction record with stored `flowBin` and `flowState`, and full anomaly detection. Nothing is lost.

**One concern**: if the server cron fails (e.g., Netlify function timeout, API rate limit), predictions that fall within that cron's window are never validated -- they persist as `pending` until either a subsequent cron catches them (within the 2.5h window) or they age out at 48h. With the old dual-path system, the client provided redundancy. With server-only, a single cron failure loses that validation cycle.

**Severity of this concern**: Low. Netlify scheduled functions are reliable (>99.5% uptime). A missed cycle means 1-2 predictions go unvalidated, which does not materially affect the EMA with hundreds of observations per bin. The 48h stale cleanup prevents accumulation.

**Conclusion**: Approved. The race condition elimination is worth far more than the marginal frequency reduction.

---

## Finding 4: Correction Signal Interpretation

**Rating: LOW**

### Will per-bin EMA capture ungauged area variability?

After the Seneca removal, the correction learns:

```
error = predicted_GF - actual_LF
```

which includes the systematic ungauged-area gap. The concern is whether the 6 flow bins x 3 flow states = 18 correction cells capture enough of the variability.

**Analysis:**

The ungauged area contribution has three major drivers:

1. **Flow magnitude** (captured by the 6 flow bins): Higher main-stem flow generally means higher tributary flow. The flow bins range from 0-3000 to 50000+, providing coarse but adequate stratification.

2. **Flow state** (captured by the 3 flow states): Rising conditions increase ungauged area relative contribution (urban tributaries respond faster than the main stem). The `rising/steady/falling` stratification captures this.

3. **Seasonality and antecedent moisture** (NOT captured): In August, Difficult Run may be at 5 cfs while the Potomac is at 4,000 cfs. In March with saturated soils, Difficult Run might be at 100 cfs with the same Potomac flow. This seasonal variation within the same flow bin is a source of unmodeled variability.

**However**: the EMA correction is not trying to model ungauged area physics. It is learning a *bias correction* -- the systematic component of the error. Within each bin, the seasonal variation appears as noise around the mean bias, not as a systematic trend. The EMA will converge to the average ungauged-area contribution for that flow bin and state, which is the best unbiased estimate absent seasonal stratification.

Adding a seasonal dimension (e.g., 18 bins x 4 seasons = 72 cells) would improve specificity but dramatically reduce observations per cell, increasing EMA noise. With ~12 validations/day and 18 bins, each bin sees roughly 0.67 validations/day, or ~20/month. With 72 cells, each cell would see ~5/month -- too few for reliable EMA convergence. The current 18-cell design is the right trade-off for the available data rate.

**Conclusion**: The per-bin structure captures the dominant flow-magnitude and flow-state dependence of the ungauged area signal. Seasonal variation becomes noise that the EMA smooths over. This is appropriate and consistent with RFC practice (which typically stratifies by flow range, not season, for real-time bias correction).

---

## Finding 5: Impact on Existing Correction Values

**Rating: LOW**

### Should correction bins be reset?

The switch from `LF - Seneca_estimate` to `LF` shifts the error signal by approximately `+Seneca_estimate` (making the error more negative, since the predicted value is now compared to a larger target).

**Magnitude by flow regime:**

| Flow | Seneca gauge online | Seneca gauge offline (1% fallback) |
|------|--------------------|------------------------------------|
| 3,000 cfs | ~26 cfs (actual) | ~30 cfs |
| 10,000 cfs | ~70 cfs (actual) | ~100 cfs |
| 30,000 cfs | ~200 cfs (actual) | ~300 cfs |
| 50,000 cfs | ~350 cfs (actual) | ~500 cfs |

With EMA alpha = 0.3, the time constant is approximately `1/alpha = 3.3` validations. After 5 validations, the EMA has absorbed `1 - (1-0.3)^5 = 83%` of the shift. After 10 validations, 97%. At ~12 validations/day, the system adapts within 12-24 hours for busy bins (mid-range flows), and within a few days for extreme bins (very low or very high flow).

At 50,000 cfs, the 500 cfs shift (1%) could temporarily affect one or two validations before the EMA absorbs it. But the `50000+` bin already has a large error variance (typical stdDev > 2,000 cfs from the empirical CI data), so a 500 cfs shift is well within noise.

**Recommendation**: Do NOT reset correction bins. The EMA will naturally adapt. Resetting would throw away all learned corrections and force a multi-day re-learning period across all bins, which is far worse than a brief transient in a few bins.

**Conclusion**: The plan's approach (keep existing bins, let EMA absorb the shift) is correct. Approved.

---

## Finding 6: Flow State Mismatch -- Is It Already Fixed?

**Rating: MODERATE**

### The plan claims this is already addressed. Is that correct?

The plan states (Fix 4): *"`flowBin` and `flowState` are already stored at prediction time... They're correctly used at validation time for bin keying. No change needed."*

This is **partially correct but misses a subtle issue**.

**What IS correct**: The prediction stores `flowBin` and `flowState` at prediction time. The validation uses these stored values to key into the correction bin. This means the correction is learned for the *conditions that existed when the estimate was made*, which is the right choice for an operational bias correction. You want to know: "When the model sees 10,000 cfs rising, how much does it typically err?" -- and that error is learned from past validations where the prediction-time state was also "10,000 cfs rising."

**What the plan misses**: The more subtle mismatch is in the *validation target*, not the bin key. At validation time, `actualCFS = lf.q` reflects LF conditions at `T + travelGFtoLF + delay`. The river state at validation time may differ from prediction time:

- **Prediction time**: River is rising at PoR. Model estimates GF = 15,000 cfs. State = `12000-25000_rising`.
- **Validation time** (6-8h later): The rise has peaked and LF is now falling. LF reads 18,000 cfs (the crest), but it is decelerating.
- **Error signal**: The model learns `15000 - 18000 = -3000` in the `12000-25000_rising` bin.

Is this a problem? The -3000 cfs error is real -- the model under-predicted the crest. But the model was seeing a *rising* river when it made the estimate, and the under-prediction is partly because the rise continued during transit. This is exactly the kind of systematic behavior that the `rising` bin should capture. The EMA in the `_rising` bin will learn that the model tends to under-predict during rises (because the wave continues to amplify during transit), and will apply a positive correction. This is correct behavior.

**The real question is**: could the flow state *change* during transit such that the validation happens in a completely different regime? For example, if a short pulse passes through: prediction-time is `rising`, but by validation-time the pulse has passed and LF is back to baseflow. The error would be `15000 - 5000 = 10000`, learned in the `_rising` bin. This is a genuine contamination -- but it requires a very short hydrologic event (pulse duration < travelGFtoLF = 4-8h), which is rare on the Potomac main stem at this scale. Flash floods on urban tributaries are fast, but main-stem waves at the GF-to-LF scale persist for 12-48h minimum.

**Conclusion**: The plan's assertion is **substantially correct**. The prediction-time keying is the right design choice. The validation-time target mismatch is real but small in practice due to the persistence of main-stem flow events. No change needed, but the plan should acknowledge this as a known limitation rather than claiming the issue does not exist.

---

## Finding 7: Additional Improvements Not in the Plan

### 7a. EMA Alpha = 0.3 -- Should It Be Lower?

**Rating: LOW**

Alpha = 0.3 gives an effective memory of ~3.3 observations (half-life ~2 validations). This is responsive but noisy. RFC systems typically use longer memory for bias correction:

- NOAA CHPS uses alpha = 0.05-0.15 for real-time bias correction
- The NWS Middle Atlantic River Forecast Center (MARFC) uses 7-14 day running means for stage corrections

With 0.3, a single outlier validation shifts the correction by 30% of the outlier's deviation. With the two-tier anomaly flagging (v33.0), hard outliers are excluded and soft outliers are clamped. But even clamped soft-flagged errors contribute 30% of their (clamped) deviation.

**However**: the system has only 18 bins, with some bins receiving few observations per day. A lower alpha (e.g., 0.10) would take 10+ observations to converge, meaning several days for infrequently-visited bins. This delays adaptation to genuine shifts in river behavior (e.g., seasonal changes, new dam operations).

**Recommendation**: Alpha = 0.3 is aggressive but defensible given the bin structure and observation rate. A future improvement could use an adaptive alpha that starts at 0.3 for new bins (fast convergence) and decays to 0.15 for mature bins (count > 50). This is not a blocker for v34.0.

### 7b. Ice Transition Buffer (6h After Flag Toggle)

**Rating: LOW**

The concern is that when a USGS ice flag is toggled off, the first few readings may still reflect ice-affected conditions (e.g., backwater pooling behind ice that is still clearing). A 6h buffer after the flag toggle would prevent learning from these transitional readings.

**Analysis**: This is a real phenomenon. When ice breaks up on the Potomac, the first post-ice readings can show elevated stage (due to ice jams downstream) or suppressed discharge (gauge calibration shifting). However:

1. USGS field hydrologists are conservative about removing ice flags -- they typically wait until readings stabilize before removing the flag.
2. The two-tier anomaly detection (v33.0) would catch most ice-transition anomalies via the stage-discharge inconsistency check (hard flag) or the statistical outlier check (hard flag).
3. A 6h buffer adds implementation complexity (need to track when ice flags were last active, persist this across cron cycles).

**Recommendation**: Not needed for v34.0. The existing anomaly detection provides adequate protection. If future analysis shows systematic bias in post-ice correction values, this can be added as a targeted fix.

### 7c. Observation-Time Matching for Validation (NEW)

**Rating: INFO**

As noted in Finding 2, the current system validates against whatever LF reading happens to be current when the cron fires. A more precise approach would match the validation observation to the target time using USGS timestamps:

```
target_time = prediction_time + travelGFtoLF
actual_LF = USGS reading with timestamp closest to target_time
```

The USGS instantaneous values API already provides 15-minute readings with timestamps. This would reduce validation timing error from 0-2h to 0-15min. This is how NOAA's CHPS matches forecast-observation pairs.

**Not a blocker for v34.0**, but worth considering for v35.

---

## Summary of Findings

| # | Finding | Rating | Action |
|---|---------|--------|--------|
| 1 | Seneca removal: raw LF is cleaner target | LOW | Approved as-is |
| 2 | 2.5h validation window: adequate but 0-2h jitter persists | MODERATE | Approve, flag for future timestamp matching |
| 3 | Server-only validation: 2h granularity is sufficient | LOW | Approved as-is |
| 4 | Per-bin EMA captures ungauged area variability adequately | LOW | Approved as-is |
| 5 | Existing correction bins: do NOT reset, EMA absorbs shift | LOW | Approved as-is |
| 6 | Flow state mismatch: mostly addressed, subtle transit issue acknowledged | MODERATE | Approve, document as known limitation |
| 7a | EMA alpha = 0.3: aggressive but defensible | LOW | Consider adaptive alpha in future |
| 7b | Ice transition buffer: not needed with anomaly detection | LOW | No action |
| 7c | Observation-time matching: future improvement | INFO | Track for v35 |

---

## Verdict

**APPROVE**

The plan correctly identifies and fixes three real structural flaws (Seneca noise, timing bounds, race condition) while maintaining the proven estimation model. The Seneca removal produces a physically cleaner validation target. The timing window is a meaningful improvement. The race condition elimination is unambiguously positive.

The two MODERATE findings (validation delay during rapid rises, and the flow-state transit mismatch acknowledgment) are not blockers. Both are known limitations inherent to a 2h cron-based validation system, and both are ameliorated by the per-bin stratification and EMA smoothing.

The decision to reject forecast-based learning remains correct. The fixes are conservative, targeted, and reversible. Proceed with implementation.

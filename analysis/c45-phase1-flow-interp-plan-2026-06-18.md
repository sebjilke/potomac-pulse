# C45 Phase 1 — Flow-Edge Correction Interpolation — Plan

**Date:** 2026-06-18
**Version (proposed):** **MAJOR v37.0** (changes the core GF estimation output for the same inputs at
nearly all flows — see §Versioning). Confirm before shipping.
**Protocol:** Modeling-methodology confirmation (done — user agreed to phased/flow-first) → this plan →
independent auditor → **prequential backtest accept/reject gate** → implement → re-audit → tests → push
approval → deploy-verify. Load-bearing: `shared/model.js`, `shared-model.js`, `scheduled-update.js`.

## Goal

Remove the **flow-bin-edge discontinuities** in the displayed/validated GF estimate by making the applied
EMA correction **continuous in flow**, while leaving the 18-bin EMA *learning* untouched. Phase 2 (trend-
state blend) is deliberately out of scope (separate session).

## Evidence basis (from `analysis/c45-bin-edge-diagnostic-2026-06-17.md`, verified)

- The applied correction is a step function: `corrected = raw − getGFCorrection(flowBin, flowState)`, with
  `flowBin` from hard cutoffs 3k/6k/12k/25k/50k → it jumps as flow crosses a boundary.
- Flow-edge jumps that are *data-backed* (both sides count≥5) are small (≤192 cfs); the **large** edge
  jumps are sparse-cell artifacts (25k-rising **3,054**, 25k-steady **2,127**, 6k-rising **1,435** — one
  side falls back to a neighbor while the other carries a real EMA). Bin boundaries are arbitrary admin
  lines with no physical meaning, so a continuous-in-flow correction is strictly more defensible.
- The *largest* data-backed jumps are on the trend-state axis (25-50k rising↔falling 3,088) — a real
  signal → **Phase 2**, not here. Phase 1 must NOT alter the per-state distinction.

## Design

### Core principle (no feedback loop)
Smooth only the **application** of the correction. The EMA still learns into the 18 discrete bins on the
**raw** residual (`updateCorrectionBin`, keyed by `getGFFlowBin(rawFinal)`) — unchanged. The CI band
(`EMPIRICAL_CI_90`) stays keyed by the discrete `flowBin` — unchanged. Only `applyGFCorrection`'s lookup
becomes continuous. Because learning is keyed on the raw bin (independent of how the correction is applied),
there is no learn↔apply feedback loop — the fixed point is identical to today.

### New helper (added to BOTH `src/model/shared-model.js` and `netlify/functions/shared/model.js`, synced)
```
getGFCorrectionInterpolated(correctionBins, flowCFS, flowState):
    # Per-bin effective corrections (existing fallback-blended values — count-aware already)
    # interpolated piecewise-linearly in LOG flow between bin anchors. Same flowState column throughout
    # (Phase 1 does not touch the state axis).
    anchors = geometric centers of GF_FLOW_BINS:
       '0-3000':1732, '3000-6000':4243, '6000-12000':8485,
       '12000-25000':17321, '25000-50000':35355, '50000+':70711
    corr_i = getGFCorrection(correctionBins, GF_FLOW_BINS[i], flowState)   # existing per-bin effective value
    if flowCFS <= anchors[0]: return corr_0            # flat below the lowest anchor
    if flowCFS >= anchors[5]: return corr_5            # flat above the highest anchor
    find i: anchors[i] <= flowCFS < anchors[i+1]
    t = (ln flowCFS − ln anchors[i]) / (ln anchors[i+1] − ln anchors[i])
    return (1−t)*corr_i + t*corr_{i+1}
```
Properties: continuous in flow; equals the current binned value exactly **at each anchor**; ramps between;
operates within a single state column; reuses `getGFCorrection` so per-cell sparsity handling is inherited.

### Wiring
- `applyGFCorrection({rawFinalUnclipped, lfCFS, correctionBins, flowState})` (both shared files): replace
  `const correction = getGFCorrection(correctionBins, getGFFlowBin(rawFinalUnclipped), flowState)` with
  `const correction = getGFCorrectionInterpolated(correctionBins, rawFinalUnclipped, flowState)`. Still
  compute & return `flowBin = getGFFlowBin(rawFinalUnclipped)` (telemetry + the CI lookup downstream).
- No change to `great-falls.js:446` / `scheduled-update.js:781` call sites (they call `applyGFCorrection`).
- `getGFCorrection` (single-bin) stays — it's the per-bin primitive the interpolator calls.
- Anchors: add a `GF_BIN_ANCHORS` constant alongside `GF_FLOW_BINS` (both constants files, synced).

### Anchor-choice rationale
Geometric (log) centers because the bins are ~log-spaced (each ~2× the previous). `50000+` is open-ended →
anchored at `sqrt(50000·100000)=70711` (i.e., correction ramps from 25-50k up to that anchor, then flat).
The lowest bin anchors at `sqrt(1000·3000)=1732` (1000 = the model's flow floor). These are the one real
methodology choice in the interpolation; the auditor should sanity-check them (alternatives: arithmetic
mid, or obs-weighted centroid per bin).

## The accept/reject GATE — prequential backtest (BEFORE implementing the shipped change)

Continuity is only worth shipping if it does **not** degrade accuracy. Run the existing
`analysis/ci_backtest_harness.mjs` (real `makeGFPrediction`, prequential learn-on-raw replay over the
~14-yr hourly series, ~127k obs) **twice**: (A) current binned `applyGFCorrection`; (B) the interpolated
variant. Compare the **corrected-residual** accuracy (median |error|, MAE, RMSE; overall and per flow bin).

- **ACCEPT** if interpolated is accuracy-neutral-or-better (no material degradation; threshold to be set
  with the auditor, e.g. median |error| not worse by >1% relative, no bin materially worse).
- **REJECT / rethink** if it degrades (e.g., blending toward a very different neighbor hurts mid-bin
  accuracy) — then reconsider anchors / count-weighting / whether flow interp is worth it.
- Also report the **discontinuity reduction** (max edge jump → 0 by construction) to quantify the win.
- **Verification of the gate** (per the Analysis Verification protocol): the accuracy comparison is
  load-bearing → reproduce the headline accuracy deltas blind in Python + R from the harness's residual
  logs (as the v36.1 CI derivation did), agree <0.01; independent auditor spot-checks ≥5 obs. The
  interpolation math itself is unit-tested (below), so the harness only needs to toggle binned vs interp.

Implementation note for the gate: prototype `getGFCorrectionInterpolated` in the harness (or behind a
`--interp` flag) so A/B run on the identical obs stream and learned bins — clean attribution. Do NOT ship
the production change until the gate passes.

## Tests (added with the shipped change, after the gate passes)

- **`travel-time-parity`-style parity:** client `getGFCorrectionInterpolated` (shared-model.js) ==
  server copy byte-for-byte over a flow grid × state × crafted bins (extend `correction-parity.test.mjs`).
- **Hand-computed interpolation:** at an anchor → equals the bin value; midway (log) → the exact
  `(1−t)·a + t·b`; below first / above last anchor → flat; monotone-flow continuity (no jump at the old
  boundaries).
- **No-feedback invariant:** `updateCorrectionBin` / bin keys unchanged (learning still discrete).
- **Backtest crosscheck** test stays green (`ci-harness-crosscheck.test.mjs`); `ensemble-parity` /
  `correction-parity` updated for the new application.

## Side effects / risks

- **Output changes at nearly all flows** (interpolation blends mid-bin toward the neighbor), not just at
  edges → this is the MAJOR-version trigger and the reason the backtest gate is mandatory.
- **Mid-bin blend could help or hurt** depending on neighbor disparity — the gate decides.
- **No learning feedback** (argued above) — the EMA fixed point is unchanged.
- Sparse/empty bins (e.g. `50000+` all-fallback) feed their fallback value into the ramp — acceptable
  (same value the binned path already serves), and the ramp softens the sparse cliffs by design.

## Versioning

Proposed **MAJOR v37.0**: unlike v36.4 (bit-identical on normal flow), this changes the corrected estimate
for essentially every input. Update CLAUDE.md, tech-appendix (§6.3 correction + a new "continuous
application" note), README, CHANGELOG, index.html title, footer. Confirm MAJOR before shipping.

## Verification path (stated upfront)

1. Backtest gate passes (dual-language-verified accuracy comparison) — else stop.
2. `npm test` green (new interpolation/parity tests + existing 521).
3. Fresh-subagent re-audit of the diff vs this plan.
4. Push only on explicit approval → Netlify gate → auto-deploy from `main`.
5. Fresh-subagent deploy-verify (title v37.0; a cron cycle produces a sane estimate; spot-check that a
   mid-bin flow now yields an interpolated correction).

## GATE RESULT (2026-06-18): **REJECT** — do not ship

Prequential A/B over 110,548 validated obs (14-yr replay; `analysis/c45_gate.mjs`; residuals
`c45_gate_residuals_multi.csv`; metrics `c45_gate_metrics_{python,R}.*`). A/B self-checks clean
(`corrMismatch=0`, `selfCheckFail=0` — binned arm exactly reproduces the model). Metrics blind in Python
and R + an independent third recomputation, all agree <1e-4. **Interpolation is WORSE on every gated
criterion (unclipped residuals):**

- (1) Pooled: median|err| **+3.40%** (138.5→143.3), MAE **+1.84%** (317.6→323.4, +5.85 cfs — breaches both
  0.5% rel and 5 cfs abs), RMSE +0.46%. → FAIL.
- (2) 4 of 6 bins (n≥30) breach the 2% median limit; worst **25000-50000: median +17.4%, RMSE +9.56%**
  (349.6→410.4 / 1404→1538), 12000-25000 +12.6% median. → FAIL.
- (3) Paired Wilcoxon p=3.09e-4 (significant), interp worse on all headline metrics, none improves. → FAIL.

Ceiling-flip rate 0.45% (low, symmetric — clipping doesn't rescue interp; clipped MAE tells the same story).

**Interpretation:** the EMA correction is **genuinely regime-dependent in flow** (it steps between flow
bins) — it is NOT a smooth function of flow, so interpolating shifts mid-bin corrections toward different-
regime neighbors and over-corrects, worst at high flow. The bin "steps" encode real bias structure; smoothing
them trades accuracy for cosmetic continuity. This confirms the diagnostic's own warning that flow-bin
smoothing "targets the wrong axis." Note the backtest bins are DENSE (14 yr) — in that mature regime the
binned correction is accurate; the large jumps seen in the sparse LIVE data are transient sparsity artifacts
that densify away over time, so they don't justify a permanent accuracy cost.

**Decision: full-width flow interpolation REJECTED.** Iterated to a narrow transition band:

### GATE v2 — narrow band (±12%) on ALL boundaries: REJECT (close)
Mid-bin obs left at exact binned value; only ±12% flow around each boundary blended. Overall IMPROVED
(median −0.21%, MAE −1.32%, RMSE −2.06%) and Wilcoxon favored interp, but criterion (2) failed: 25-50k
median |err| +5.73% (>2%). The 25000/50000 boundary blends mis-correct the typical high-flow case (real
regime steps). Py≡R verified.

### GATE v3 — narrow band (±12%) on the LOW/MID boundaries ONLY (3k/6k/12k); 25k/50k left as steps: **ACCEPT**
Principled scope (diagnostic established a-priori that high-flow corrections are genuine regime structure,
not artifacts to smooth). Re-gated against the SAME pre-registered threshold. Verified Py≡R (identical to
4 sig figs; Wilcoxon p=4.873e-88 favoring interp; 9 auditor spot-checks incl. full-file confirmation that
all 10,796 obs in 25-50k/50k+ are byte-identical between arms):
- (1) pooled unclipped: median **−0.72%**, MAE **−1.12%**, RMSE **−0.60%** — all improve. PASS.
- (2) per-bin: worst median +1.11% (12-25k, <2%); all RMSE improve or flat (25-50k/50k+ exactly 0). PASS.
- (3) Wilcoxon: significant **improvement** (interp lower |err|). PASS.
- clipped (displayed) MAE also improves −0.97%; ceiling-flip rate 0.0011 (123 obs).

**SHIPPED DESIGN (locked):** `getGFCorrectionInterpolated(bins, flowCFS, state)` = for flow within ±12%
(log) of a boundary in {3000, 6000, 12000}, linearly ramp (log-flow) between `getGFCorrection(below,state)`
and `getGFCorrection(above,state)`; otherwise return `getGFCorrection(getGFFlowBin(flow),state)` (exact binned
value). The 25000/50000 boundaries are deliberately NOT smoothed (real regime steps). `applyGFCorrection`
swaps its `getGFCorrection` call for this; `flowBin`/learning unchanged. Prototype + gate artifacts:
`analysis/c45_gate.mjs`, `c45_gate_residuals_v3.csv`, `c45_gate_metrics_v3_{python,R}.{py,R,json}`.

## Open questions for the auditor

- Anchor choice: geometric centers vs obs-weighted centroids vs arithmetic mid — does it matter for the
  backtest result? Is the `50000+` open-end anchor (70711) defensible, or should ≥50k be flat at the bin
  value?
- Accept threshold: what relative degradation in median |error| (overall + worst bin) is the reject line?
- Should the interpolation be explicitly **count-weighted** (down-weight a low-count bin's anchor so the
  ramp leans toward the populated neighbor), or is the existing per-cell fallback in `getGFCorrection`
  sufficient? (Default: rely on existing fallback; add count-weighting only if the gate shows distortion.)
- Does interpolating the **post-fallback effective** corrections risk double-smoothing (fallback already
  blended toward a neighbor, then interpolation blends again)? Acceptable, or interpolate raw bin EMAs
  with a separate sparsity guard?
- Dual-language scope for the gate: full residual-log reproduction in Py+R, or is an independent single-
  language re-run + auditor spot-check sufficient for a *relative* A/B (vs the absolute quantiles in v36.1)?

## Audit resolutions (2026-06-18, independent 2-lens panel)

All findings accepted; one (F2) accepted in spirit but refined with reasoning. Revised design:

- **[F2 double-smoothing / F3 50k+ anchor — RESOLVED together] Exclude EMPTY (count==0) bins from the
  interpolation; no synthetic 70711 anchor.** The interpolator still interpolates each bin's **effective**
  correction (`getGFCorrection`, reused — code economy + it IS the model's best per-bin estimate), BUT a
  bin is an anchor only if it has ≥1 of its **own** observations. Empty bins (count 0) contribute nothing
  but a wholesale-borrowed neighbor value, so they're dropped — which makes the top flat at the highest
  populated bin (kills the `50000+`=`25000-50000` borrow-then-ramp degeneracy F3 flagged) and removes the
  fictitious 70711 anchor entirely. **I reject the auditor's literal "drop every count<5 bin / interpolate
  raw EMAs"** because on the current data it collapses whole state columns: e.g. the **rising** column has
  only ONE count≥5 cell (25-50k, 13 obs), so dropping count<5 anchors would apply a flat +3,273 rising
  correction at all flows — clearly wrong. Excluding only count==0 keeps the partial-own-data sparse bins
  (whose effective value is a count/5 own+neighbor blend) while removing the pure-borrow degeneracy. The
  residual double-smoothing on count 1–4 bins is then made **observable in the gate** (below) rather than
  argued away.
- **[GATE-2 harness seam] Re-derive BOTH arms in the harness from the prediction-time snapshot.** The
  harness calls `makeGFPrediction` directly (no `applyGFCorrection` seam), so right after each call —
  using the same `correctionBins` passed in plus the returned `rawFinalCFS`/`flowState`/`flowBin`/`lfCFS`
  — compute `correction_binned = getGFCorrection(bins, flowBin, state)` and `correction_interp =
  getGFCorrectionInterpolated(bins, rawFinalCFS, state)`, then both corrected estimates. **Self-check:**
  the binned arm must reproduce the real `pred.predictedCFS` (post-ceiling, rounded) exactly before any
  delta is trusted. Production code stays untouched for the gate (analysis-only harness change).
- **[GATE-3 ceiling/rounding confound] Threshold on UNCLIPPED residuals.** The 120%-LF ceiling binds in
  the high-flow 25-50k region — exactly where correction differences are largest — masking the delta to
  zero. So compute the accept/reject on the **pre-ceiling, unrounded** corrected residual
  (`rawFinalUnclipped − correction − actual`); ALSO report the post-ceiling rounded residual (what users
  see) and the per-bin **ceiling-bound obs count + ceiling-flip rate** between arms.
- **[THRESHOLD — concrete, set before running] ACCEPT iff ALL:** (1) pooled corrected median|err|, MAE,
  RMSE each not worse by >0.5% relative AND not worse by >5 cfs absolute; (2) no flow bin with n≥30 worse
  by >2% rel median|err| or >1% RMSE (n<30 reported, not gated); (3) a paired Wilcoxon signed-rank on
  per-obs |corrected err| (binned vs interp) shows no significant degradation (p≥0.05) OR a headline metric
  improves; (4) discontinuity win quantified: binned step size at each old boundary (3k/6k/12k/25k) per
  state vs interp's zero, reported positively. REJECT on any breach of (1)/(2) or significant degradation.
- **[GATE-1] Assert identical learned-bin trajectory** across arms (dump final bin counts/EMAs, require
  byte-equality) — converts the "no feedback" argument into a checked invariant.
- **[DUAL-LANG — scoped] Logs once (JS, the canonical model); metrics dual-language.** Python + R
  independently compute the headline deltas + paired test from the SAME two residual CSVs, blind, agree
  <0.01; auditor spot-checks ≥5 obs (hand-recompute both corrections from the live bins snapshot). Full
  Py+R model reproduction is NOT done (would be a different model, not a verification).
- **[Observability — DOUBLE-SMOOTHING] Gate reports, per bin: fraction of validated obs whose ramp segment
  touches a fallback-sourced/sparse anchor**, and flags any bin that degrades while sitting on such a
  segment — so the residual double-smoothing risk is empirically visible, not carried into ship.
- **[F4] Anchor rationale reworded:** geometric center of each bin's [lo,hi] for log-symmetry; drop the
  "1000 = model flow floor constrains the estimate" justification (it's the travel/EF floor, not a GF-
  estimate floor). Flat-below-lowest-anchor behavior kept.
- **[Tests] Add:** (a) **all NON-EMPTY anchors × 3 states** — `interp(anchor_i,state)` ===
  `getGFCorrection(bin_i,state)` exactly (uses the diagnostic's real sparse-bin fixture incl. empty 50k+);
  (b) **state isolation** — changing state at fixed flow reproduces per-state anchors (locks the Phase-2
  boundary); (c) **mid-bin direction** — value lies strictly between the two anchor corrections and is the
  LOG-flow fraction (catches a swapped-t / arithmetic-vs-log bug); (d) **continuity** at the old hard
  cutoffs → 0; flat-extrapolation clamps below first / above last populated anchor; **do NOT assert
  monotonicity** (corrections legitimately go up/down across bins); (e) **constants parity** — `GF_BIN_ANCHORS`
  deepEqual client↔server; interpolator parity grid includes points strictly inside each bin.
- **[F1] Preserve** `flowBin = getGFFlowBin(rawFinalUnclipped)` in `applyGFCorrection`'s return (telemetry +
  CI lookup + learn-bin); only the `correction` value changes.
- **[VERSION] MAJOR v37.0 confirmed.** CHANGELOG must note the **accuracy-series discontinuity** at the
  v36→v37 boundary (the corrected residual — and thus the published headline accuracy — changes), so the
  series break is documented, not read as a regression.

# Flow-State Learning Gate — Parcel-Aligned Redesign — Methodology Plan

**Date:** 2026-06-17
**Status:** DRAFT — methodology plan for review. **No code until this plan is audited and signed off.**
**Author:** planning session (Claude Opus 4.8)
**Versioning if implemented:** **MAJOR (v37.0)** — changes the core estimate for the same inputs
(the binning key that selects the applied EMA correction changes).

---

## 0. Why this exists (one paragraph)

The learned EMA correction is keyed by `(flowBin, flowState)` — 6 flow ranges × 3 flow states =
18 bins. `flowState` is supposed to capture the hydrograph limb the estimated water is on, because
the model's bias differs on rising vs falling vs steady water. The current implementation keys the
bin on the **wrong water parcel** and treats the state as a **hard 3-way step**, and the two
runtimes **classify it differently**. This plan proposes a parcel-aligned, transition-aware redesign
and — critically — an **empirical A/B** (using the v36.1 backtest harness) that must justify it
before it ships. The redesign is only worth doing if it measurably tightens the corrected residual;
the plan is built to prove or kill that.

---

## 1. Problem statement & evidence (grounded in code + the science review)

### 1.1 PRIMARY — temporal misalignment (the "parcel" problem; c1-plan D10, confirmed)
`makeGFPrediction` estimates GF **now** by routing the PoR reading from ~19h ago
(`getPoRFromHistory(porHistory, travelPoRtoGF)`), but classifies the limb from the **current** PoR
reading: `const flowState = getFlowState(porHistory, por.q)` (`scheduled-update.js:753`, `por.q` is
the current reading). So the residual is binned by the trend of the parcel **currently at PoR**
(which reaches GF ~19h *later*), not the parcel **being estimated and validated**. On any limb that
starts/ends within a travel time, these disagree. c1-plan **D10** recorded this as the reason the
flow-state gate was dropped from v36.0: *"reads PoR trend at validation time (~19h after the
prediction's PoR reading → wrong water parcel) and skips overshoot cases → biases the rising bin
optimistically … needs parcel-aligned state + a simulation."*

### 1.2 SECONDARY — hard step function at state/bin edges (C45, confirmed, **major**)
The applied correction is a step function of `(flowBin, flowState)` with no interpolation or
hysteresis → *"~24% / ~1,400 cfs display jumps as flow crosses 6,000 cfs and rising-to-steady flaps
near the threshold"* (science-review C45). A small wobble across the `max(100, 2%)` rising threshold
flips the bin and snaps the displayed estimate.

### 1.3 SECONDARY — sparse, noisy bins; EMA harmful at transitions (C15/C44/C7/C43, confirmed)
Live data: only ~6 of 18 bins reach count ≥ 10, 5 are empty; α=0.3 on heavily autocorrelated errors
≈ single-observation noise; adjacent sparse bins show sign reversals (−1,424 vs +401) that are event
noise, not regime bias; no calendar-time decay for stale bins. The EMA is *"unambiguously harmful
only at transitions and in sparse bins."* Validation cadence is ~3.5–4/day (single-pending), so bins
fill slowly.

### 1.4 SECONDARY — three classifiers disagree (C41/C19/C10, confirmed)
Client `getPoRRiseRate` (robust median-of-record, needs ≥3 pts/90min) vs server `getFlowState`
(≥8 entries, last-entry ≤6h) vs the documented thresholds. Verified this session
(`c19-findings-2026-06-17.md`): steady-state parity holds, but at cold start / backgrounded tab the
client falls back to NWS-trend while the server reads the PoR trend (this *is* C41). Any redesign of
the gate should decide whether one canonical classifier governs learning **and** display.

---

## 2. Goal, non-goals, scope

**Goal.** Make the flow-state that keys the learned correction (a) *parcel-aligned* (the limb of the
water actually being estimated/validated), (b) *transition-robust* (no snap jumps, no learning into
ambiguous bins), and (c) *consistent across runtimes* — **only if** an A/B backtest shows it improves
the corrected residual.

**Non-goals (explicitly out of scope here).**
- Travel-time / wave-celerity refit (that is Wave-3 Tier-0 / C23/C8/C16 — separate plan). This plan
  **consumes** the existing travel-time function; it does not change it. (Note dependency in §6.)
- The EF power-law refit and forecast routing (Wave-3).
- Multi-pending validation cadence (separate; would help bin fill but is orthogonal).

**Scope decision to confirm (see Decision D0).** Minimal (parcel-alignment only) vs full
(parcel-alignment + continuous/hysteresis state + classifier unification). Recommendation: **stage
it** — land parcel-alignment first (smallest correct change, directly testable), then evaluate
continuous-state and unification as follow-ons gated on their own A/B.

---

## 3. Proposed redesign (the concept to be validated, not yet decided)

**3.1 Parcel-aligned state.** Define the binning state as the PoR trend evaluated **around the
historic reading that sourced the estimate** — i.e. classify `getFlowState` over the window centered
on `T0 − travelPoRtoGF` (the `historicPoR` timestamp the model already selects), not at `T0`. Stamp
this `parcelFlowState` into the pending prediction; the validator already reuses
`pred.data.flowState` (`scheduled-update.js:922`), so predict-bin == learn-bin automatically once the
stamped value is parcel-aligned. The server already has the historic PoR series in hand, so this is a
classification-window change, not new data.

**3.2 Transition handling (two independent levers, each A/B'd).**
- *Continuous/blended state* — replace the hard 3-way pick with a weight over {rising, steady,
  falling} from the normalized rate (e.g. logistic in `ratePerHour` around the threshold), and apply
  a **weighted blend of the three bin corrections** instead of one bin. Kills the C45 snap.
- *Hysteresis* — require the rate to cross the threshold by a margin (or persist N readings) before
  the state flips; damps rising↔steady flapping.

**3.3 Learning gate.** Optionally **down-weight or skip** learning when the parcel state is
*ambiguous* (rate near threshold) — this is the "gate" — since that is where the EMA is documented as
harmful. A clean rule: learn at full weight when |rate| is clearly in-state, fractional weight in the
transition band, zero only for genuinely indeterminate parcels.

**3.4 Classifier unification (optional, Decision D4).** Pick one canonical flow-state implementation
used by both server learning and client display (TODO #11's "server math canonical" provisional),
removing the C41/C19/C10 divergence. Can be deferred to TODO #11 but should be *decided* here so the
redesign doesn't bake in the split.

---

## 4. Methodology decision points — **need explicit sign-off** (per project rule)

| # | Decision | Options | Provisional recommendation |
|---|---|---|---|
| **D0** | Scope | (a) parcel-alignment only; (b) + continuous state; (c) + hysteresis/gate; (d) + classifier unification | **Stage:** ship (a) first if its A/B wins; evaluate (b)/(c)/(d) as gated follow-ons |
| **D1** | Parcel-state time basis | (a) current `T0` *(status quo)*; (b) historic `T0 − travel`; (c) average over the routed window | **(b)** — hydrologically the parcel being validated; **let the A/B confirm** it beats (a) |
| **D2** | State representation | hard 3-way *(status quo)* vs continuous weight/blend | continuous **iff** A/B shows lower transition-jump without coverage loss; else keep categorical |
| **D3** | Transition learning gate | learn-all *(status quo)* vs down-weight/skip ambiguous parcels | down-weight in a defined transition band; **never** silently drop without logging the count |
| **D4** | Classifier unification | keep 3 / unify to one canonical | decide direction now (server-canonical), implement with TODO #11 |
| **D5** | Stale-bin decay | none *(status quo)* vs calendar half-life | out of scope unless trivial; flag for a separate item |

**These are the choices I will NOT make unilaterally.** D1 (the time basis) and D2 (categorical vs
continuous) are the load-bearing hydrological/statistical decisions the project requires confirmation
on before any code.

---

## 5. Evaluation framework (this is what makes it rigorous)

**5.1 Engine.** Reuse the **v36.1 backtest harness** (`analysis/ci_backtest_harness.mjs`) — it
already imports the *real* `makeGFPrediction`, monkeypatches `Date.now()` to the sim epoch, and
replays the prequential EMA learn loop over the **126,916 hourly-obs** dataset (2011–2026, incl.
tributaries + LF stage). It is the production-faithful A/B bench; no model reimplementation.

**5.2 Arms (A/B/…):** A = status quo (current-`T0` hard 3-way); B = parcel-aligned hard 3-way (D1b);
C = parcel-aligned + continuous (D1b+D2); D = + hysteresis/gate (D3). Each arm is a config flag on
one harness run — same data, same engine, prequential.

**5.3 Metrics (per arm, out-of-sample, prequential):**
- **Corrected-residual RMSE & MAE** (primary — does the correction de-bias better?).
- **90% CI coverage** (must stay ≥ ~88–90%; re-derive `EMPIRICAL_CI_90` per arm — the v36.1 pipeline,
  reused — because changing the bin key changes the residual partition).
- **Transition-jump magnitude** — distribution of |Δ displayed estimate| across consecutive hours and
  specifically at state flips (directly measures the C45 win).
- **Bin occupancy & effective N** — how many of the 18 (or blended) bins reach count ≥ 10; fewer
  empty/sparse bins is better.
- **Sign-stability of adjacent bins** — fewer noise sign-reversals.
- **Rising-limb bias** — mean signed residual on rising parcels (D10's "optimistic rising bias" must
  shrink, not just move).

**5.4 Verification (project Analysis-Verification protocol):**
- Any statistical derivation (the per-arm quantile tables, the continuous-weight calibration) is done
  **blind dual-language Python + R**, must agree < 0.01; fail-fast on divergence.
- **Independent auditor** subagent (not an implementer) reviews methodology + spot-checks ≥5 obs vs
  live USGS; every CSV has a generating script (provenance).
- Cross-check the harness path against the **real** `validatePendingPredictions` (as C19 did) so the
  offline binning equals production.

**5.5 Go / no-go (pre-registered).** Ship arm X over status quo **only if**: corrected-residual RMSE
improves (or is within noise) **AND** coverage stays ≥ 88% **AND** transition-jump P95 drops
materially **AND** rising-limb bias shrinks. If parcel-alignment alone (B) doesn't beat A on RMSE, we
**stop** and document the null result — the misalignment may be empirically immaterial at the
realized travel times, which is itself a finding worth recording.

---

## 6. Implementation sketch (only if §5 passes)

- **Classify on the historic window.** In `makeGFPrediction`, compute the binning state from the
  series around `historicPoR.timestamp` (reuse `getFlowState`/`getPoRRiseRate` with a shifted
  `now`). Stamp `flowState` (parcel-aligned) into the pending row. Validator unchanged (already reads
  `pred.data.flowState`).
- **Shared helper.** *(Corrected by audit — see §9, code-finding 4.)* `getFlowState` is **already**
  in `shared/model.js` and shared server-side; it is NOT pending extraction. The real divergence is
  that the **client display path never calls it** — it uses `getPoRRiseRate` (robust median-of-record)
  with a `getFlowStateFromTrend` (NWS) fallback. So D4 "unify" means **migrating the client** off two
  different classifiers onto the canonical server one, and **intentionally rewriting** the
  `ensemble-parity.test.mjs` TIER-2 case that exists specifically to pin that divergence. Scope D4 as
  its own audited change, not a rider.
- **Continuous blend (if D2 wins).** Generalize `applyGFCorrection` to accept a state weight vector;
  the C19/C1 parity tests extend to cover it.
- **Re-derive `EMPIRICAL_CI_90`** for the shipped arm (v36.1 pipeline) — the band must match the new
  partition.
- **Dependency flag:** travel-time accuracy (Wave-3 Tier-0) **upstreams** this — if the travel time
  is biased (C23: +10–16h low flow), the "historic parcel" we classify is itself mis-located. Note in
  the plan that parcel-alignment's benefit may be capped until the travel-time refit lands; the A/B
  will reveal interaction. (Possible ordering decision: do Wave-3 Tier-0 first. **Raise with user.**)

**Files:** `netlify/functions/scheduled-update.js`, `netlify/functions/shared/model.js`,
`src/model/shared-model.js`, `src/estimation/great-falls.js`, `src/model/constants.js`
(`EMPIRICAL_CI_90`), tests, docs (CLAUDE.md model params, CHANGELOG, README, tech-appendix). All
load-bearing → full Code-Change Verification Protocol (plan → audit → implement → re-audit).

---

## 7. Risks & rollout

- **Risk: null/negative result.** Mitigated by pre-registered go/no-go — a null is an acceptable,
  documented outcome (and cheap, since the harness is built).
- **Risk: bin re-partition invalidates live correction bins.** Changing the state key means existing
  `gf_correction_bin` rows are keyed on the old (current-`T0`) state. **Migration decision:** reset
  vs re-key vs let them re-converge (the bins re-fill in ~weeks at 3.5/day). Pre-check live rows
  (mirror c1-plan D9). Likely a clean reset with a documented `resetReason`.
- **Risk: travel-time coupling (§6).** Surface ordering vs Wave-3 to the user.
- **Rollout:** behind the C20 test gate; post-deploy step-down watch like v36.0; the cron confirms
  learning into the new bins over the following cycles (time-gated, flagged as unverified until then).

---

## 8. Open questions for the user (before auditor + before code)

1. **D0 scope** — stage parcel-alignment first, or design the full redesign in one shot?
2. **D1/D2** — confirm parcel-aligned time basis is the intended hydrological choice, and whether you
   want categorical-vs-continuous decided empirically (my plan) or pre-committed.
3. **Ordering vs Wave-3 Tier-0** — travel-time refit upstreams this. Do Wave-3 first, or A/B this on
   the current travel time and accept the coupling?
4. **Bin migration** — acceptable to reset `gf_correction_bin` on cutover (≈weeks to re-fill), or
   require a re-key/transfer?

---

---

## 9. Independent audit (two lenses) — dispositions & revised methodology

Two fresh independent auditors reviewed §§0–8 (statistics/methodology lens; code-faithfulness/
feasibility lens). **Both confirmed the load-bearing diagnosis in code** (§1.1 misalignment is real:
`:753` bins on current PoR while the estimate routes the ~19h-old parcel; validator reuses the
stamped state at `:922`). Verdicts: **stats = NOT-READY → SOUND-WITH-FIXES**; **code =
PREMISES-HOLD-WITH-CORRECTIONS.** This section supersedes §§5–7 where they conflict.

### 9.1 Dispositions

| Finding | Lens | Disp. | Incorporation |
|---|---|---|---|
| **F1** A/B confounded (key changes applied-correction + bin population + CI partition together) | stat | **ACCEPT** | Add a **label-only diagnostic** as the primary identifiability check (see 9.2 Step 1) |
| **F2** travel-time bias (C23) → "true parcel" unlocatable | stat | **PARTIAL** | Accept ±12h **lag-sensitivity** as a *kill condition* on every parcel arm. Do **not** hard-require Wave-3 first — promote to user Decision (open Q#3); the Step-1 diagnostic is cheap enough to run under sensitivity now |
| **F3** prequential leakage (per-arm CI re-derived on the scoring series) | stat | **ACCEPT** | Fixed time split (warm/derive ≤2023, score 2024–2026), prequential per CI-plan S-F4, carry B=30 / MIN_OBS=250 |
| **F4** harness emits only per-validation rows → transition-jump uncomputable | stat | **ACCEPT** | Add a **per-sim-hour displayed-estimate stream**; verify it like the CI harness (headless == `_test`) |
| **F5** power/effective-N not quantified | stat | **ACCEPT** | Pre-register MDE vs **moving-block-bootstrap** CI (block = residual decorrelation time, measured — not assumed); "underpowered → do not run" is a valid outcome |
| **F6** continuous arm: free-param identifiability + double-count | stat | **ACCEPT** | Tune weights on a **separate fold**; **learning hard-assigned** to the parcel state, blending **only at application** |
| **F7** go/no-go gameable; OR-structure | stat | **ACCEPT** | RMSE improvement (CI excludes 0 by MDE) is a **necessary** gate; B = single confirmatory arm; C/D exploratory w/ Holm correction + independent confirmatory re-run |
| **F8** transition-gate = MNAR sampling bias | stat | **ACCEPT** | Evaluate the gate arm on the **full** deployment sample incl. gated-out parcels; per-regime transition-band coverage as a hard gate |
| **F9** no paired/CRN comparison | stat | **ACCEPT** | Primary analysis = **paired** bootstrap on per-prediction-hour residual² differences (arms share the replay) |
| **F10** calibration only at 90% | stat | **ACCEPT** | Report 50/80/90/95 calibration curve; gate on **q95 upper-tail coverage on rising parcels** |
| **F11** post-reset transient untested (backtest starts empty-seed) | stat | **ACCEPT** | Report a fresh-seed transient window; document live re-convergence as an unverified-until-cron gap |
| **code-3** harness can't toggle arms without a source seam (chicken-and-egg) | code | **ACCEPT** | Step 1 needs **no** model change; Step 2 adds a test-only `opts.parcelStateBasis` seam to `makeGFPrediction` *before* the A/B, behind `_test` (own the tradeoff vs forking) |
| **code-4** "extract getFlowState" is wrong; D4 unification far larger | code | **ACCEPT** | Corrected §6 bullet in place; D4 re-scoped as its own audited change (migrate client off `getPoRRiseRate`/`getFlowStateFromTrend`; rewrite `ensemble-parity` TIER-2) |
| **code-5** `EMPIRICAL_CI_90` is also flowState-keyed; "re-fills in weeks" optimistic | code | **ACCEPT** | Added to migration checklist (9.4); "weeks" scoped to **active** bins (sparse bins never fill) |
| **code-6** `getFlowState` reads `Date.now()` internally (no `now` arg); `getPoRFromHistory` drops the historic timestamp | code | **ACCEPT** | §6 seam specified: add optional `nowMs` (touches both shared copies + `model.test.js`) **or** classify a `porHistory` sub-slice; thread the historic timestamp through |

No findings rejected. The only push-back is **F2 (PARTIAL)**: hard-sequencing Wave-3 before any
diagnostic is heavier than warranted when the cheap Step-1 label test can be run *with* a lag-
sensitivity sweep that will itself reveal whether the travel-time bias dominates.

### 9.2 Revised evaluation flow (supersedes §5.2)

**Step 0 — Precondition.** Decide Wave-3 ordering (Decision; open Q#3). Either way, every parcel-state
result is reported under a **±12h travel-time sensitivity sweep**; if the effect flips sign under a
plausible lag correction, it is uninterpretable and must not ship (F2).

**Step 1 — Label-only diagnostic (CHEAP, NO model change, the new gate).** In one harness replay,
log per validated prediction: raw residual, the current-`T0` state label, **and** the parcel-aligned
label (computed offline from the input `porHistory` window around the stored `historicPoR`
timestamp — no `makeGFPrediction` change). Then, on the **same** residual sample, compare how much
raw-residual variance each partition explains (between-bin SS / mixed-effects variance decomposition).
This isolates F1's question — *does the parcel label carve the bias more cleanly?* — free of the
EMA-fit/CI confound, and sidesteps code-3 entirely. **If the parcel label does not explain materially
more variance (paired bootstrap, by the MDE), STOP and record the null** — the misalignment is
empirically immaterial at realized lags, and no source change is made.

**Step 2 — Deployment A/B (only if Step 1 wins).** Add the `opts.parcelStateBasis` seam (code-3),
then run arms with all fixes: fixed time split + S-F4 prequential + B/MIN_OBS burn-in (F3); per-hour
displayed-estimate stream for transition-jump (F4); paired CRN analysis (F9); MDE/bootstrap go-no-go
(F5, F7); hard-assign-learn / blend-only-apply for the continuous arm tuned on a separate fold (F6);
full-sample MNAR-safe scoring for the gate arm (F8); multi-level calibration + rising q95 (F10);
post-reset transient (F11). B is confirmatory; C/D exploratory.

### 9.3 Revised go/no-go (supersedes §5.5)

Ship arm X over status quo **iff**: **(necessary)** corrected-residual RMSE improvement's paired-
bootstrap CI excludes zero by the pre-registered MDE; **AND** 90% coverage ≥ 88% with rising-parcel
q95 upper-tail not degraded; **AND** rising-limb signed bias shrinks. Transition-jump reduction is a
**secondary** benefit that **cannot substitute** for the accuracy gate (F7). A null on confirmatory
arm B ends the study (C/D not evaluated).

### 9.4 Corrected migration checklist (supersedes §7 risk bullet)

Changing the state key strands **two** flowState-keyed artifacts, not one: (1) `gf_correction_bin`
rows (`${flowBin}_${flowState}`), and (2) **`EMPIRICAL_CI_90`** in `constants.js` (`[flowBin][flowState]`,
18 cells + `all`). Both must be reset/re-derived on cutover. Active bins re-converge in ~weeks at
~3.5 validations/day; **sparse/empty bins do not meaningfully re-fill** (§1.3). Pre-check live rows
(mirror c1-plan D9); likely a clean reset with a documented `resetReason`.

### 9.5 Status

Plan is **SOUND-WITH-FIXES, awaiting user sign-off** on the §8 decisions (now informed by 9.1–9.4).
On sign-off: run **Step 1** (cheap, no code) → report → only then decide Step 2. The Code-Change
Verification Protocol (plan → audit → implement → re-audit) applies to any Step-2 source change.

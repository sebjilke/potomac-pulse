# Wave-3 Tier-0 — Travel-Time Relation Refit — Methodology Plan

**Date:** 2026-06-17
**Status:** DRAFT — methodology plan for review. **No code until this plan is audited and signed off.**
**Author:** planning session (Claude Opus 4.8)
**Versioning if implemented:** **MAJOR (v37.0)** — changes the core estimate for the same inputs
(the time-shifted historic PoR reading the ensemble routes changes).

---

## 0. Why this exists

The science review names this **the single most defensible "improve the actual estimate"
opportunity** (§137, rec #6). The deployed PoR→GF→LF travel-time relation overestimates the observed
hydrograph lag by 35–71% at low/medium flow, its documentation is wrong, the server and client
compute different lags, and the server runs out of history in drought. The Step-1 flow-state
diagnostic (this session) independently pointed at *current-condition / travel-time* effects as where
the model's bias lives — corroborating that travel-time accuracy, not flow-state binning, is the
lever. This plan refits the relation against 14 years of observed PoR↔LF lag and an A/B backtest, and
fixes the coupled server defects — **only if** the refit measurably reduces model error.

---

## 1. Problem statement & evidence (grounded in code + science review)

### 1.1 PRIMARY — the relation overestimates lag at low/medium flow (C23, confirmed)
Deployed: `T_total = 4139·Q^−0.5963` h (Q = LF discharge floored at 1,000), via
`getFlowMultiplier` (`shared/model.js:104-108`, `constants.js:124-128`: TRAVEL_COEF 4139, TRAVEL_EXP
−0.5963, MEDIAN_TRAVEL 25.8, TRAVEL_POR_GF_BASELINE 19.4). Fresh USGS 15-min data show it **overshoots
the observed PoR→LF hydrograph lag by 10–16h (35–71%) for LF 1,400–4,000 cfs**, matching within ~1h
only above ~17,000 cfs. Root cause (science): a discharge hydrograph is a *signal* and should be
time-shifted by **wave celerity** (faster than bulk water velocity), but the relation is a Searcy
dye-tracer **water-velocity** time with a flat ×0.80 fudge. The appendix already contains a
better-fitting empirical relation **`T = 2438·Q^−0.5491`, R²=0.908**, set aside "to preserve Searcy's
exponent" (`tech-appendix.md:107-108`).

### 1.2 The relation is split to an UNGAUGED point (methodology constraint, not a bug)
`T_total` (PoR→LF, observable) is split **75% PoR→GF / 25% GF→LF** (`tech-appendix.md:121`;
`travelPoRtoGF = 19.4·mult`, `travelGFtoLF = TRAVEL_GF_LF_BASELINE·mult`, `scheduled-update.js:684-686`).
**GF has no gauge**, so PoR→GF cannot be directly observed — only PoR→LF can (cross-correlate the two
hydrographs). Any refit is anchored to the observable PoR→LF lag; the 75/25 split is an assumption
that the data can only constrain indirectly. This is the central methodological limit.

### 1.3 Server/client lag divergence + drought fallback (C8 confirmed, C16 downgraded)
- **C8:** the client iterates travel-time→historic-flow→travel-time to convergence (3 passes, 1h
  tol, `great-falls.js:388-416`); the **server** (which generates every stored/validated prediction)
  does a **single pass** (`scheduled-update.js:684-697`). So the authoritative prediction uses a
  systematically different lag than the browser on rising/falling limbs.
- **C16:** the server fetches only ~48h of PoR history (`P2D`), shorter than the low-flow PoR→GF lag
  (~50.6h at the 1,000-cfs clamp), so in drought it silently falls back to **unshifted current PoR**
  with no flag; the client keeps 72h.

### 1.4 Documentation contradicts the code (C6, confirmed, understated)
Docs ("19–33h PoR→GF" in `CLAUDE.md:101`, README, `tech-appendix.md:113-121`, `index.html:389-393`)
do not match the formula: true PoR→GF range is **~5h (50k cfs) to ~50.6h (1,000-cfs clamp)**; 19.4h is
the *median* value, not the high-water value. A reader checking code against docs concludes the code
is broken when the table is stale.

### 1.5 Celerity add-on may double-count (interaction, C23 tail)
A separate rising-only "wave celerity" reduction (2% per 1%/hr rise, cap 30%; `tech-appendix.md:150-160`,
`scheduled-update.js:689-694`) sits on top of the base relation. If the base relation is **refit to
observed (celerity) lag**, this add-on partly double-counts the same physics. Must be resolved jointly.

---

## 2. Goal, non-goals, scope

**Goal.** Replace the PoR→LF travel-time relation with one fitted to 14 years of observed PoR↔LF lag,
resolve the celerity add-on interaction, fix the server lag defects (iteration parity, history length,
fallback flag), and correct the docs — **iff** an A/B backtest shows the model's corrected-residual
error drops (or holds) without coverage loss.

**Non-goals (separate items).** EF power-law refit (C42) and forecast fallback routing (the other two
Wave-3 Tier-0 pieces) — separable; this plan is travel-time only. Flow-state binning — closed (#7,
refuted). The 75/25 GF split is *examined* (D2) but a full re-derivation of GF location is out of scope
(ungauged).

**Scope decision (D0).** Minimal = refit the relation + doc fix. Full = + server iteration parity (C8)
+ history extension (C16) + fallback flag. Recommendation: **bundle the server fixes** (C8/C16) because
they change *which lag is actually used* and so must be in place for the A/B to reflect production;
keep the EF refit and forecast routing out.

---

## 3. Proposed approach (to be validated, not yet decided)

1. **Measure the observable lag.** From `hourly_backtest_data_v361.csv` (14 yr hourly PoR `por_now` +
   LF `lf_discharge`), estimate the PoR→LF lag as a function of flow: per flow bin, the lag L that
   maximizes the cross-correlation (or minimizes lagged-regression residual) between PoR(t−L) and
   LF(t). Produce observed (Q, L_obs) pairs with uncertainty.
2. **Fit T(Q).** Fit a power law `T = a·Q^b` to (Q, L_obs). Compare candidates: the appendix's
   `2438·Q^−0.5491`; a free 2-parameter fit on the 14-yr data; and the status-quo `4139·Q^−0.5963`.
   Report R², residual lag error by regime, and especially the low-flow (1,000–4,000 cfs) behavior.
3. **Resolve the split + celerity add-on (D2, D3).** Decide whether 75/25 stays; decide whether the
   refit base subsumes the rising-only celerity reduction (likely shrink/drop it to avoid double-count).
4. **Server fixes (D0 full).** Add the client's iterative convergence to the server; extend server PoR
   history fetch past the max lag (`P2D`→`P3D`+, ≥52h); flag (not silently fall back to) the unshifted
   case. Unify the lag computation into the shared helper so client/server can't diverge (C8).
5. **Docs (C6).** Replace "19–33h" with the true range; correct dye-tracer→wave-celerity rationale;
   regenerate the §3.3 table from the chosen relation.

---

## 4. Methodology decision points — **need explicit sign-off**

| # | Decision | Options | Provisional recommendation |
|---|---|---|---|
| **D0** | Scope | (a) refit + docs only; (b) + server C8/C16 fixes | **(b)** — server fixes change the lag actually used; needed for a faithful A/B |
| **D1** | Which relation | adopt `2438·Q^−0.5491`; free refit on 14-yr data; keep Searcy exponent / new coef | **free refit on 14-yr data**, with the appendix candidate + status-quo as benchmarks; pick by held-out lag error + A/B |
| **D2** | GF split | keep 75/25; re-estimate from the data (indirect); make it flow-dependent | keep 75/25 unless the data clearly argues otherwise — GF is ungauged, so resist over-fitting an unobservable |
| **D3** | Celerity add-on (§3.6) | keep; shrink; drop | **decide empirically** — if the refit base is a celerity fit, the rising-only add-on likely double-counts; A/B with/without |
| **D4** | Q variable | keep Q = LF discharge (current/observed) | keep LF (it is what the lookup uses); note the circularity is handled by §3.5 iteration |
| **D5** | Drought fallback (C16) | silent unshifted (status quo); flag; widen history | widen server history ≥52h **and** flag when still unshifted |

**Load-bearing choices I will NOT make alone:** D1 (the fitted relation), D2 (the ungauged split),
and D3 (celerity double-count) — these change the physical estimate and must be confirmed.

---

## 5. Evaluation framework

**5.1 Two independent layers.**
- **Layer A — direct lag fit (no model):** how well does each T(Q) predict the *observed* PoR→LF lag?
  Metric: held-out median/IQR lag error by flow regime (esp. 1,000–4,000 cfs), R². This evaluates the
  relation itself, free of the rest of the model. **Blind Python + R**, agree < 0.01 on the fit
  coefficients and the per-regime lag errors; fail-fast on divergence.
- **Layer B — full-model A/B backtest:** does the refit reduce the *model's* error? Reuse the v36.1
  harness (real `makeGFPrediction`). **Caveat (same seam issue the #7 audit found):** the travel
  constants are baked into the model; the A/B needs a test-only seam to swap the relation (an
  `opts.travelRelation`), added **before** the A/B. Arms: status-quo vs refit (×, with/without celerity
  add-on per D3). Metrics: corrected-residual RMSE/MAE, 90% coverage (must hold ≥88%; re-derive
  `EMPIRICAL_CI_90` per arm), paired block-bootstrap MDE, stratified by flow regime. Pre-registered
  go/no-go: ship only if corrected-residual RMSE improves (paired CI excludes 0) AND coverage holds.

**5.2 Verification protocol (project Analysis-Verification).** Blind dual-language for the fit (Layer
A) and any derived table; independent auditor (not a fitter) reviews methodology + data integrity +
spot-checks ≥5 lag estimates against raw USGS; provenance (every CSV has a generating script);
cross-check the harness path vs real `validatePendingPredictions`.

**5.3 Data sufficiency note.** The 14-yr hourly series covers the full flow range; the low-flow regime
(where the bias is worst) is well-populated. Lag estimation by cross-correlation needs care at low flow
(slow, noisy recession) — quantify lag-estimate uncertainty, don't just take the argmax.

---

## 6. Implementation sketch (only if §5 passes)

- New constants (a, b) in `constants.js` + `shared/model.js` (kept in sync; they already mirror).
- Extract the full lag computation (incl. iteration) into the **shared** helper so client and server
  use one implementation (closes C8); server calls the iterative version.
- Server: widen PoR history fetch to ≥`P3D` and the in-memory retention past the max lag; add an
  explicit `unshiftedFallback` flag on the prediction when history is still too short (C16).
- Re-derive `EMPIRICAL_CI_90` for the shipped relation (the residual partition shifts).
- Docs: `tech-appendix.md` §3.1–3.3 + §3.6, `CLAUDE.md`, `README`, `index.html` — range + rationale.
- Tests: travel-time unit tests (new coefficients, the iteration, the fallback flag),
  client/server lag parity (extend `ensemble-parity.test.mjs` / `correction-parity.test.mjs`).
- All load-bearing → full Code-Change Verification Protocol (plan→audit→implement→re-audit).

## 7. Risks & rollout

- **Risk: refit helps lag-fit but not the model** (the ensemble + EMA correction may already absorb
  lag bias). Mitigated by Layer-B A/B with pre-registered go/no-go — a null is an acceptable outcome
  (and would itself be informative: "the correction already compensates for lag bias").
- **Risk: ungauged GF split unidentifiable.** Resist re-deriving it; keep 75/25 unless strongly argued.
- **Risk: bin re-partition / CI re-derivation** (as v36.1). Reset/re-derive `EMPIRICAL_CI_90`;
  correction bins re-converge.
- **Coupling with #7's null:** Step-1 showed current-T0 flow-state is the better bias key; that is
  independent of the lag value and unaffected here.
- **Rollout:** behind the C20 test gate; post-deploy step-down watch; cron-confirmation (time-gated).

## 8. Open questions for the user (before auditor + before code)

1. **D0/D1** — bundle the server C8/C16 fixes? Free 14-yr refit vs adopt the appendix `2438·Q^−0.5491`?
2. **D2** — leave the 75/25 GF split alone (recommended, ungauged), or attempt a data-indirect estimate?
3. **D3** — willing to drop/shrink the rising-only celerity add-on if the refit base subsumes it?
4. **Sequencing** — travel-time alone now, or fold the EF refit (C42) into the same v37.0 since both
   change the estimate and would otherwise mean two MAJOR releases + two CI re-derivations?

---

---

## 9. Independent audit (two lenses) — dispositions & revised methodology

Two fresh independent auditors reviewed §§0–8. **Code lens: PREMISES-HOLD-WITH-CORRECTIONS** — every
load-bearing code claim verified (formula/constants, 75/25, single-pass vs iteration, 48h history +
silent fallback, the absent harness seam, the circular `por_lagged`/`travel_time_h` columns). **Stats
lens: NOT-READY → SOUND-WITH-FIXES** — the diagnosis is right but the evaluation design needs the
fixes below. This section supersedes §§3, 5, 7 where they conflict.

### 9.1 The big reorder — sensitivity FIRST (mirrors #7's cheap-diagnostic-first win)

Run in this order; each stage can kill the next:

- **Layer 0 — lag→estimate sensitivity (NEW, cheapest, run first; F11).** Does a lag error of the
  *claimed magnitude* even move the GF estimate materially, given five successive dampeners (PoR+trib
  ensemble, EF blend up to 40%, PoR-delta correction, 120% ceiling, and the per-bin EMA correction
  which is built to absorb a *stationary* lag bias)? Method: in the harness, perturb only the lag by
  ±10–16h, hold all else fixed, measure the change in the **raw** and **corrected** estimate
  distribution by flow regime. **If below the practical threshold (D-new), STOP** — the refit cannot
  matter regardless of how good a new fit is. This is the analogue of #7's Step-1 and may likewise
  return a decisive null cheaply.
- **Layer A — lag fit (only if Layer 0 clears), with a CORRECTED estimand (F1–F4).** Not raw-PoR vs
  raw-LF cross-correlation. Instead: (i) subtract the four gauged tributaries — align `PoR(t−L)`
  against `LF(t) − Σtrib(t)` (all four series are columns in the CSV) to isolate the PoR-attributable
  component; (ii) **pre-whiten** (difference / rise-event windows), not levels, to avoid the
  trend-dominated flat-top argmax; (iii) **stratify by limb** (rising vs steady/falling) — pooling is
  ill-posed and the rising-vs-steady gap *is* the celerity add-on (resolves D3 analytically, F5);
  (iv) label each (Q, L) pair by the **same Q the production lookup uses** (current LF, 1,000-clamp;
  F4); (v) **exclude `por_lagged` and `travel_time_h`** — they are the deployed formula's own output
  (`fetch_hourly_backtest_data_v361.py:172-177`, "provenance only"); using them is circular (F12).
  Report a *distribution* of per-event lags with bin IQR and **effective event count** (not hours;
  F-data). Blind Python+R on the robust estimator (agreement guards transcription, not estimand —
  the estimand validity is the auditor's separate check; F2-minor).
- **Layer B — full-model A/B (only if Layer A shows a genuinely better lag).** Requires the seam
  below. Arms: status-quo vs the single chosen refit config (NOT a 4-arm grid — the celerity add-on
  is resolved in Layer A, F5). Fixes: out-of-sample split OR prequential coverage scoring (re-deriving
  `EMPIRICAL_CI_90` on the scoring series is in-sample/vacuous; F6); discard burn-in until bins reach
  count≥10, both arms (F7); pair on prediction timestamp with a block length ≥ the residual
  decorrelation time (F7); report **raw AND corrected** RMSE to attribute a null (F10); pre-registered
  **practical effect-size floor** (e.g. ≥X cfs / ≥Y% at low flow), not merely "paired CI excludes 0"
  (the smooth lag makes arms highly correlated → trivial gains are "significant"; F8).

### 9.2 Dispositions

| Finding (lens) | Disp. | Incorporation |
|---|---|---|
| F1 estimand confounded by tributary gain | **ACCEPT** | Layer A subtracts gauged tributaries; estimand = "PoR-pulse arrival lag" |
| F2 levels CCF trend-dominated | **ACCEPT** | pre-whiten / rise-event lags; report per-event distribution |
| F3 limb hysteresis | **ACCEPT** | stratify lag by flow state |
| F4 Q-labeling circularity | **ACCEPT** | label pairs by the production-lookup Q (current LF, 1,000-clamp) |
| F5 celerity add-on A/B confounded | **ACCEPT** | resolve analytically from rising-vs-steady lag, not a 4-arm A/B |
| F6 CI re-derivation leakage | **ACCEPT** | OOS split or prequential coverage; same split both arms |
| F7 burn-in/split/block unspecified | **ACCEPT** | discard burn-in; pair on timestamp; block ≥ decorrelation time |
| F8 paired power manufactures "ship" | **ACCEPT** | pre-registered practical effect-size floor, not just CI≠0 |
| F9 ungauged split unfalsifiable | **ACCEPT** | §1.2/D2 restated: split is **not** data-constrained here; held fixed; "re-estimate indirect" option removed |
| F10 null ambiguous | **ACCEPT** | report raw+corrected RMSE; Layer A success is a precondition to read a Layer-B null |
| F11 missing sensitivity precheck | **ACCEPT** | added as **Layer 0**, runs first |
| F12 circular columns | **ACCEPT** | named forbidden in Layer A |
| code: 75/25 emergent ratio | **ACCEPT** | D2/§1.2 say "the 19.4 & 6.5 baselines," not a 0.75 param |
| code: 3 constant copies + forked client/server travel paths + 2 return shapes | **ACCEPT** | §6 unification scoped bigger: consolidate constants (constants.js / shared-model.js / shared/model.js) + reconcile `getFlowMultiplier` shapes |
| code: harness seam feeds 4 consumers | **ACCEPT** | seam = single `travelHrsFor(Q)` choke point feeding base shift + celerity + PoR-delta decay denominator + GF→LF horizon; unit-assert all four route through it; **prerequisite for Layer B** |
| code: `useTimeShifted=false` partial flag; doc line refs (index.html:248 not 389-393; CLAUDE.md:99) | **ACCEPT** | corrected; `unshiftedFallback` distinct from overloaded `useTimeShifted` |

No findings rejected. New decision **D-new (practical effect-size floor):** the minimum
corrected-estimate improvement worth a MAJOR release + CI re-derivation — **needs user input** (a
safety-tool judgment), e.g. "≥ N cfs or ≥ M% at low flow."

### 9.3 Status

**SOUND-WITH-FIXES, awaiting user sign-off** on §8 + D-new. On sign-off, run **Layer 0 (sensitivity,
no code)** first — like #7's Step-1 it is cheap and may decisively kill or green-light the refit before
any lag fit or model-seam work. The Code-Change Verification Protocol applies to any seam/source change.

---

## 10. Decisions locked (user, 2026-06-17)

- **D-new (the gate):** the bar is **display accuracy/honesty**, NOT decision-changing impact — the
  user confirmed a few-hundred-cfs low-flow sharpening typically does **not** change a go/no-go
  paddling call, but wants the displayed number accurate. ⇒ A *real, out-of-sample, non-noise*
  accuracy improvement counts even if small; but it must clear a pre-registered effect-size floor (not
  just "paired CI ≠ 0", which the smooth-lag correlation can fake). **Corollary:** the **C6 doc-range
  fix** (displayed "19–33h" is simply wrong) is worth doing **regardless** of the relation refit —
  pure display-accuracy, no model change; fold into the #10 doc sweep.
- **D2:** user knows of **no Great Falls ground truth** (no gauge / NPS / adjusted-flow station). ⇒
  the 75/25 PoR→GF split is **held fixed**, documented as an explicit unfalsifiable assumption; the
  "re-estimate indirect" option is dropped.
- **D1:** ✓ **free 2-parameter refit** on the 14-yr corrected estimand; `2438·Q^−0.5491` and
  status-quo are benchmarks only (the candidate was fit on the confounded basis, so not adopted blind).
- **D3:** ✓ **replace** the ad-hoc rising-only celerity add-on with **limb-stratified fitted lags**
  (rising vs steady/falling) derived in Layer A — removes the double-count by construction.
- **D0:** ✓ **bundle the server fixes** (C8 iteration parity + C16 history extension + explicit
  `unshiftedFallback` flag); **exclude** EF refit + forecast routing.
- **Sequencing:** ✓ travel-time **alone first**; decide EF-bundling only if Layer-0 clears.

Methodology is signed off. Proceeding to **Layer 0**.

---

## 11. Layer-0 + Layer-A results (RUN 2026-06-17) — relation refit NOT worth building

Two cheap, no-model-change probes (exploratory single-language; formalize blind Py+R only if a build
is pursued) on `hourly_backtest_data_v361.csv`. They **concur against** the relation refit.

**Layer 0 — input sensitivity** (how much routed PoR moves if the lag is shortened by the claimed
6–16h). Low flow (1,400–4,000): median |Δ| ~3.9% @12h but **signed mean only −0.5%** — near-zero-mean
scatter, and the small stationary part is **already absorbed by the EMA correction**. High flow:
sensitive (6–16%) but (see Layer A) the lag there is already accurate.

**Layer A — observed PoR→LF lag** (differenced, gauged-tributaries subtracted, labeled by current LF;
circular `por_lagged`/`travel_time_h` excluded):

| LF regime | n | obs lag* | r* | deployed | gap |
|---|---|---|---|---|---|
| 1,000–1,400 | 2,740 | 38h | **0.10** | 60.4h | +22h |
| 1,400–4,000 | 34,500 | 24h | **0.11** | 37.2h | +13h |
| 4,000–6,000 | 16,000 | 19h | 0.21 | 25.8h | +7h |
| 6,000–12,000 | 32,077 | 15h | 0.30 | 18.2h | +3h |
| 12,000–50,000 | 33,129 | 9h | **0.67** | 8.7h | −0.3h |
| 50,000+ | 2,670 | 7h | **0.92** | 5.9h | −1.1h |

**Verdict.** Where the relation is biased (low/mid flow) the lag is **not identifiable** (r≈0.10–0.11 —
the audit's F1/F2 confound realized) *and* the estimate is insensitive (EMA-absorbed); where the lag
**is** well-identified (high flow, r 0.67–0.92) the deployed relation **already matches** (gap ≤1h).
Low-flow removable routed-PoR error is mean +1.6% (EMA-absorbed) + scatter from an unidentified lag.
**No credible accuracy/band gain ⇒ the relation refit is NOT worth a MAJOR release + CI re-derivation +
server refactor.** Decision: **close the relation refit** (like #7, the cheap diagnostics right-sized it).

**Survivor (worth doing):** the **C6 doc-range fix** — displayed "19–33h" is wrong; the deployed
formula spans ~5–50.6h. Pure display-accuracy, no model change → folded into the #10 doc sweep.
(The C8 iteration-parity / C16 history-extension server fixes are real but were only justified as
support for the refit; without the refit they drop to minor correctness items for the backlog.)

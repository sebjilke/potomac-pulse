# C2 / v36.1 — Corrected-Residual CI via Production-Faithful Backtest Harness

**Status:** PLAN (pre-audit). No code until this plan is auditor-reviewed and user-confirmed.
**Version target:** v36.1 (MINOR — display CI band + a no-behavior-change refactor; the point estimate is unchanged).
**Author:** main session, grounded in a direct read of the production model (not from memory).

---

## 1. Problem

The empirical 90% CI is wrong on two coupled axes, and the fixes must ship together.

### 1.1 The table is on the wrong basis
`EMPIRICAL_CI_90` (`src/model/constants.js:90-97`) holds q05/q95 of the **raw** residual binned on **actual** LF (the v2 derivation in `analysis/error_distribution_v2_*.{py,R}`, which builds only a bare `blended = (1-w)·por_lagged + w·ef` ensemble — no PoR-delta, no real tributaries, no ceiling, no learned correction). It does not describe the residual of the **corrected** estimate the user is actually shown.

### 1.2 The application formula is wrong (sign + shape)
Residual convention throughout the system is **`error = estimate − actual`** (positive = overestimate; server `scheduled-update.js:918` `errorCFS = rawCFS − actualCFS`).

For the displayed (corrected) estimate `est = predictedCFS`, define the corrected residual `r = est − actual`. A 90% interval for the true flow is:

```
actual = est − r,   r ∈ [q05, q95] with prob 0.90
⇒ actual ∈ [est − q95,  est − q05]
```

So the **correct** band is `low = est − q95`, `high = est − q05` (asymmetric, sign-aware). The derivation makes **no zero-mean assumption** — it is fully general for any empirical residual distribution.

Shipped code (`great-falls.js:504-506`) instead does:
```js
const halfWidth = (q95 - q05) / 2;
lowCFS  = est - halfWidth;
highCFS = est + halfWidth;
```
which discards the sign and forces symmetry. The corrected residuals are **empirical and generally asymmetric per bin — often same-signed** (e.g. the current table's `6000-12000/steady` is q05=−2377, q95=−159: a band lying entirely *above* the estimate). The symmetric `±halfWidth` form **structurally cannot represent** a same-signed or asymmetric interval. (Note — corrected as a v2 amendment, see §12: the EMA correction *re-centers* each bin but, being a recency-weighted filter rather than a full-sample mean, does **not** zero the residual; the band must therefore be taken as fully empirical, not assumed symmetric or mean-zero.) ⇒ table re-derivation and formula fix are **coupled** and must land in the same change.

`src/assets/tech-appendix.md:329` documents a third, also-wrong form (`[est + q05, est + q95]`).

---

## 2. Why a backtest harness (not "just re-derive on corrected residuals")

The only existing dataset (`hourly_backtest_data.csv`) cannot yield corrected residuals: it has no corrected estimate, no EMA-correction column, bins on actual, and ends pre-v36.0. To get corrected residuals with flood-season coverage **now**, we run the **real production model** over a re-fetched ~14-year hourly series, replaying the sequential EMA learn-on-raw loop, and log the corrected residual per hour. This avoids both (a) reimplementing the model offline (drift risk) and (b) waiting months for live v36.0 data to accumulate.

---

## 3. Internals map (verified by direct read — the harness contract)

| Fact | Location | Consequence for the harness |
|---|---|---|
| `makeGFPrediction(usgsData, porHistory, waterTempC, correctionBins)` is **exported** for tests and is **arg-driven** (no internal fetch) | `scheduled-update.js:666`, exported via `exports._test` (`:1613`) | Harness imports the **real** model: `require('./netlify/functions/scheduled-update.js')._test.makeGFPrediction`. **Zero production change** to run it. `require()` is side-effect-free (handler is never self-invoked). |
| Returns `rawFinalCFS` (learn target), `predictedCFS` (corrected/displayed, post-ceiling), `flowBin`, `flowState`, `travelTimeGFtoLF`, `ceilingApplied` | `:792-817` | Everything the log needs comes straight from the return. |
| `Date.now()` is used in the relative-time lookups: `getPoRFromHistory` (`:397`, target = now − hoursAgo), `getFlowState` (`shared/model.js:114`), `getPoRRiseRateFromHistory` (`:168`) | — | **Timestamp-shift** each sim-hour's `porHistory` so the sim-hour maps onto wall-clock `now` (add `offset = realNow − simNow` to every entry's timestamp). Model uses only relative diffs ⇒ uniform shift is exact. |
| `bin` = `getFlowBin(rawFinalUnclipped)` (off the **raw** final); `flowState` from `getFlowState` | `shared/model.js:274`, `:753` | CI derivation must bin by the **same** `(flowBin, flowState)` keys the application looks up — bin by the **logged model output**, not by a recomputed actual-based bin. |
| EMA learn-on-raw + anomaly gates are **inline** in `validatePendingPredictions` (async, Supabase-coupled) | `:822-1140` | Replay reimplements the pure math; the **EMA bin-update** is extracted to a shared helper (§6, Decision 2). |
| `errorCFS = rawFinalCFS − actualLF`; HARD flags skip learning, SOFT flags learn with ±2σ clamp; `emaMeanError = 0.3·err + 0.7·prev` (seeded at count==1); `count/sumError/sumErrorSq/meanError` accumulate | `:915-1083`; `GF_EMA_ALPHA=0.3` (`shared/model.js:145`) | Exact arithmetic to mirror. |
| Anomaly gates: (1) EF discrepancy >25% → soft+2; (2) stage-discharge >35% → **hard**+2 (needs `lf.h`); (3) low-flow<1500 & stage>2.45 → **hard**+2 (needs `lf.h`); (4) \|errPctRaw\|>50 → soft+1; (5) z>3 when count≥10 → **hard**+2 | `:947-1037` | Reproduce in the harness; **two gates need LF stage** ⇒ data add (§4). |
| Cron cycle order: **validate pending first, then make new prediction** (new prediction uses freshly-updated bins) | handler `:1660-1701` | Replay preserves this order each sim-hour. |
| Validation accepts only within `VALIDATION_MAX_DELAY_MS = 2.5h` of `validationDue` | `shared/model.js:328` | With a clean hourly grid and multi-pending, every prediction validates exactly at its horizon hour — the 2.5h cap is a live-cron artifact; note it, don't let it drop clean validations. |

**Client path (`great-falls.js`) is NOT used by the harness:** it's store-driven (arg-less, reads module globals) and does not return `rawFinalUnclipped` (unrecoverable when the ceiling fires). The server `makeGFPrediction` is the learning/validation path and exposes the raw target directly — strictly better.

---

## 4. Phase 1 — Data re-fetch

Extend `analysis/fetch_hourly_backtest_data.py` → **new** versioned output `analysis/hourly_backtest_data_v361.csv` (do **not** overwrite the existing CSV).

**Add fetches (param 00060 discharge unless noted):**
- Monocacy `01643000`, Goose Creek `01644000`, Broad Run `01644280`, Seneca `01645000` — real-time tributary inflows.
- **LF stage** `01646500` / **00065** — required for anomaly gates 2 & 3 and stage-error context.
- Keep: PoR discharge `01638500/00060`, PoR temp `01638500/00010`, EF stage `01644148/00065`, LF discharge `01646500/00060`.

**Behavior changes:**
- **Stop dropping EF-missing hours** (current `:208-210` `skipped_no_ef`): pass `ef=null` → model's PoR-only path. (Keeps hours the live model would still serve.)
- Tributaries: store real value where available; **blank → harness passes `null` → model's `TRIB_FALLBACK`** (drainage-area %). This is exactly production behavior; early years (before a gauge's IV record begins) fall back, matching reality. **Verify each tributary's IV start date** and log the real-vs-fallback fraction per year.
- `por_lagged` column is now **vestigial** (the real model does its own travel-time lookup off `porHistory`); keep it for provenance but the harness ignores it.

**Provenance / verification (CLAUDE.md §Analysis Verification):** the CSV has a single generating script; blind dual-language is N/A for a fetch, but the auditor spot-checks ≥5 (gauge, hour) cells against the live USGS IV API, and we log row counts + per-series coverage + skip reasons.

**Risk:** USGS IV (15-min) history depth varies by gauge; Broad Run `01644280` in particular may be shallow. Mitigation: fallback handles gaps natively; we report the fallback fraction so the auditor can judge whether early-year tributary fidelity is adequate (high-flow flood cells are concentrated in recent years where real tributary data exists).

---

## 5. Phase 2 — Node backtest harness (`analysis/`, not shipped)

`analysis/ci_backtest_harness.mjs` (or `.cjs` to match the server's CommonJS export). Pure replay; writes a per-hour log CSV that Phase 3 consumes. **No network, no Supabase.**

**Per sim-hour `t` (ascending), in this order:**
1. **Validate due pendings** (multi-pending queue): pop every pending whose `validationDue ≤ t`. For each:
   - `actualLF = lf_discharge` at the hour nearest `validationDue` (drop if missing).
   - Compute anomaly score with the live gates (EF check uses `ef_stage`+temp at validation hour; stage checks use `lf_h`; large-error + z-outlier use `errorCFS`).
   - If **hard-flagged**: skip learning **and exclude from the residual sample** (corrupted ground truth — not model uncertainty; matches the live learning filter).
   - Else: `errorCFS = rawFinalCFS − actualLF`; call shared `updateCorrectionBin(binData, errorCFS, {isSoftFlagged})`; **emit a residual record** `r = predictedCFS − actualLF` with the prediction's logged `(flowBin, flowState)`, `ceilingApplied`, flow magnitude, and the bin's count-at-prediction-time (for burn-in).
2. **Make new prediction:** build `usgsData = {data, gauges}` from row `t` (PoR, LF, 4 tribs, EF, temp); build rolling **timestamp-shifted** `porHistory` (≥34h back, ascending); call **real** `makeGFPrediction(usgsData, porHistory, waterTempC, correctionBins)`; enqueue with `validationDue = t + travelTimeGFtoLF`.

**Decision 1 (confirmed): multi-pending + prequential + burn-in.**
- *Multi-pending:* every hour's prediction validates at its own horizon → dense data, especially the thin high-flow transient cells. (Production's single-slot bottleneck is a throughput limit that subsamples those cells hardest; we deliberately do not reproduce it.)
- *Prequential / contemporaneous:* the correction applied at hour `t` is the bin state **as of `t`** (no look-ahead). The bins evolve forward through the 14-year replay.
- *Burn-in:* exclude a bin's residuals from the **derivation sample** until that bin has accumulated **B observations** (proposed **B = 30**; EMA α=0.3 is ~97% converged by ~10 obs, B=30 adds margin). Burn-in trims the early under-converged transient so the CI reflects the converged regime. (Reporting threshold MIN_OBS is separate — §6.)

**Headless faithfulness check:** a unit test asserts the harness's import of `makeGFPrediction` produces identical output to a direct `_test` call on a fixed `(usgsData, porHistory)` fixture (guards against the timestamp-shift being applied wrong).

---

## 6. Phase 3 — Corrected-residual CI derivation (blind Python + R)

Input: the harness residual log. **Decision 2 (confirmed):** the EMA bin-update arithmetic is extracted to **`updateCorrectionBin(binData, errorCFS, isSoftFlagged)`** in `netlify/functions/shared/model.js`, called by **both** the cron (`scheduled-update.js`, replacing the inline `:1057-1083`) and the harness — zero divergence by construction. This refactor is **behavior-preserving** (same arithmetic) and is covered by:
- a unit test of `updateCorrectionBin` (count==1 seed, EMA recurrence, soft-clamp branch), and
- a **cross-check test**: feed sample `(rawCFS, actualCFS, flowBin, flowState, priorBin)` tuples through the **real** `validatePendingPredictions` (with a mocked Supabase client capturing the upserted `binData`) and assert the captured bins equal the harness path. This pins the harness's **anomaly scoring** too (which is reimplemented, not extracted).

**Statistics:**
- Residual `r = predictedCFS − actualLF` (corrected, **post-ceiling** — matches the displayed value; ceiling-affected rows flagged for a sensitivity check).
- Bin by **`(flowBin, flowState)` = the model's logged output** (identical keys to `getGFUncertainty` lookup). 6 flow bins × {rising, steady, falling}.
- Per cell: q05, q95 (primary) + q10/q25/q50/q75/q90 (diagnostic).
- **Reporting threshold MIN_OBS = 250** per cell (within the statistician's 200–300 range). Below it, fall back to the bin's pooled `all`-state quantiles; if the bin `all` is also < MIN_OBS, fall back to the global pooled quantiles. Record which cells used fallback.
- Exclude hard-flagged observations (done upstream in Phase 2); exclude burn-in observations.

**Verification (CLAUDE.md §Analysis Verification):** Python and R run **blind and simultaneously** (separate subagents, results-blind), must agree **< 0.01** on every reported quantile; fail-fast on divergence. Independent auditor verifies cross-language agreement, methodology, and spot-checks ≥5 residual records back to the harness log and the live USGS API. Outputs saved: `ci_v361_python.csv`, `ci_v361_R.csv`, `ci_v361_audit.md`.

---

## 7. Phase 4 — Coupled application fix (load-bearing → Code-Change Verification Protocol)

1. **`great-falls.js:504-506`** → 
   ```js
   const lowCFS  = Math.max(0, Math.round(estimatedCFS - uncertainty.q95));
   const highCFS = Math.round(estimatedCFS - uncertainty.q05);
   ```
   (drop `halfWidth`). `getGFUncertainty` already returns `{q05, q95}` unchanged.
2. **Regenerate `EMPIRICAL_CI_90`** (`constants.js:90-97`) from `ci_v361_*.csv` (corrected-residual quantiles, model-bin keys).
3. **`src/assets/tech-appendix.md:319-329`** → document the correct `[est − q95, est − q05]` band, the corrected-residual basis, the v36.1 derivation, **and** that the band is an *LF-equivalent-flow* interval at the GF location (it bundles GF model error + GF→LF routing/ungauged-flux variability + LF measurement noise — not pure GF model uncertainty; see §12 S-F7).
4. **Remove dead import** `gf-learning.js:6` (`EMPIRICAL_CI_90` imported, never used).
5. **`updateCorrectionBin` extraction** in `shared/model.js` + `scheduled-update.js` (Decision 2) — behavior-preserving.
6. Keep `index.html` / `scheduled-update.js` in sync; update `CLAUDE.md` params, version history, `README.md`, footer (v36.1).

**Protocol:** plan (this doc) → independent fresh-subagent pre-audit → implement → fresh-subagent re-audit. The C20 test gate (`npm test`) must stay green (a red suite cannot deploy).

---

## 8. Phase 5 — Coverage regression tests

- **Out-of-sample (time-split):** derive on a train span, measure empirical coverage on a held-out **recent** tail. Targets: **global 90% ± 4 pts**; per-cell coverage reported (cells below MIN_OBS exempt from the hard gate but reported); **two-sided miss symmetry** — low-miss ≈ high-miss ≈ ~5% each (guards against a residual sign regression reappearing).
- **Application-formula unit test:** for a known `(est, q05, q95)`, assert `low = est − q95`, `high = est − q05`, `low ≥ 0`. This is the regression that would have caught the shipped `±halfWidth` bug.
- Lock both into the suite.

---

## 9. Defaulted decisions (flagged; reversible if the auditor/user objects)

- **GF-estimate-validated-against-LF conflation kept.** Production already learns `rawFinalCFS − actualLF` and the correction absorbs the GF→LF physical offset + ungauged inflow/withdrawal. C2 mirrors this; it does not introduce the conflation. The CI is therefore a band for LF-equivalent flow displayed as the GF estimate — the existing semantics.
- **Residuals on the post-ceiling displayed value.** Matches what the user sees; ceiling-affected rows (gross overestimates clipped to 1.2·LF) legitimately widen the upper tail. Flagged for a sensitivity check (re-derive excluding ceiling rows; report delta).
- **Hard-flagged observations excluded from the residual sample** (not just from learning) — they are corrupted ground truth, not model uncertainty.

---

## 10. File manifest

**New (analysis, not shipped):** `hourly_backtest_data_v361.csv`, `ci_backtest_harness.{mjs,cjs}`, `ci_v361_python.csv`, `ci_v361_R.csv`, `ci_v361_audit.md`, derivation scripts `ci_corrected_residuals_python.py` / `_R.R`.
**Modified (shipped):** `src/model/constants.js` (EMPIRICAL_CI_90), `src/estimation/great-falls.js` (`:504-506`), `netlify/functions/shared/model.js` (+`updateCorrectionBin`), `netlify/functions/scheduled-update.js` (call the helper), `src/learning/gf-learning.js` (drop dead import), `src/assets/tech-appendix.md`, `CLAUDE.md`, `README.md`, version/footer. **Modified (analysis):** `fetch_hourly_backtest_data.py`. **New tests:** application-formula unit, coverage regression, `updateCorrectionBin` unit + cross-check.

---

## 11. Open risks for the auditor

1. **Multi-pending vs deployed single-slot correction trajectory:** the converged correction differs from production's slower-learning one in sparse/early periods. Defensible (we want the converged-regime CI), but the auditor should confirm burn-in + MIN_OBS adequately isolate the converged regime.
2. **Anomaly scoring is reimplemented (not extracted):** the cross-check test is the guard; auditor to judge whether it's sufficient or whether `scoreAnomalies` should also be extracted.
3. **Tributary IV history depth:** early-year fallback fraction — does it bias any reported cell? (High-flow cells are recent-year-heavy, mitigating this.)
4. **Burn-in B and MIN_OBS values** (30 / 250) — sensitivity to these choices.
5. **Timestamp-shift correctness** under DST / timezone in the CSV timestamps — the harness must use UTC-consistent epoch math.
6. **Ceiling-in-residual** decision — sensitivity check required.

---

## 12. Audit dispositions & v2 amendments

Two independent fresh-subagent auditors reviewed v1 of this plan: a **statistics/methodology** lens (verdict: SOUND_WITH_CHANGES) and a **code-faithfulness** lens (verdict: FAITHFUL_WITH_CHANGES). Both **independently re-derived the §1.2 sign math and confirmed it CORRECT**, and the code auditor **verified every §3 internals-map claim true** (only line-number drift of ±2 lines, and one wrong file path — now fixed). All findings below are **ACCEPTED**; none rejected. These amendments govern implementation where they refine §§1–11.

### Code-faithfulness findings (all accepted)
- **C-F2 (factual fix):** tech-appendix lives at `src/assets/tech-appendix.md` (no `docs/` copy). Fixed throughout (§§1.2, 4, 7.3, 10).
- **C-F1 (extraction pin):** `updateCorrectionBin` must preserve **both** fallback operators verbatim — `?? binData.meanError` (soft-clamp center, `scheduled-update.js:1071`) and `|| binData.meanError` (EMA recurrence, `:1082`). Seed shapes differ between `buildCorrectionBins` (`model.js:250-252`, **no** `emaMeanError` key) and the validation default (`:1018-1020`, `emaMeanError:0`); benign in prod (count==1 overwrites it) but the harness's in-memory bin store **uses the validation seed** (`emaMeanError:0`). Unit test must cover: count==1 seed; count≥2 recurrence with a starting `emaMeanError` both **present and absent**; soft-clamp branch. The cross-check test (sample tuples through the real `validatePendingPredictions` with a mocked Supabase client, compare captured `binData`) is the end-to-end guard incl. anomaly scoring.
- **C-F3 (temp handling):** harness passes `waterTempC = null` on blank `water_temp_c` rows (→ `efModelType:'default-no-temp'`); uses **prediction-hour** temp for `makeGFPrediction` and **validation-hour** temp for anomaly Check 1.
- **C-F4 (validation-input timing):** read **all** validation-side actuals (`actualLF`, `ef_stage`, `lf_h`, temp) **at the validationDue hour as a unit**; on the clean hourly grid the 2.5h window collapses to the exact horizon hour. Implementer must NOT read actuals at prediction-time (off-by-one).
- **C-impl note:** **do not consume the returned `validationDue` ISO string** from `makeGFPrediction` for the queue — it is timestamp-shifted; enqueue using the pure duration `t + travelTimeGFtoLF`. Use a **`.mjs`** harness with `createRequire(import.meta.url)` (precedent: `test/correction-parity.test.mjs:9`); the `.cjs` hedge in §5 is unnecessary. `@supabase/supabase-js` resolves cleanly on `require` (lazy `getSupabase`, no network).

### Statistics/methodology findings (all accepted)
- **S-F2 (drop "mean-~0"):** an EMA re-centers but does not zero the full-sample mean; prequential leaves residual bias. The band is **fully empirical/asymmetric** (sign math is general — unaffected). Report per-cell residual **mean & median** as a diagnostic. *(Amended §1.2.)*
- **S-F1 (MAJOR — serial correlation):** hourly residuals are autocorrelated ⇒ effective-N ≪ raw-N; a single storm contributes hundreds of near-duplicate residuals. **Amendments:** (a) estimate per-cell **effective-N** (decorrelation time / event-block count) and re-justify MIN_OBS in those terms; (b) attach **moving-block-bootstrap CIs** to each reported q05/q95; (c) the §8 coverage test uses a **moving-block bootstrap**, not i.i.d. hourly hits; the ±4pt tolerance is interpreted against bootstrap sampling variance.
- **S-F3 (MAJOR — multi-pending representativeness):** the shipped table is derived on multi-pending (converged) residuals, but users are served the laggier single-slot correction → potential deployment **under-coverage** in transient/high-flow cells. **Amendment (guardrail, does not reverse Decision 1):** run the harness a **second time in single-pending mode**; compare per-cell q05/q95. If high-flow/transient cells diverge materially, **ship the single-pending quantiles for those cells** (what users actually experience) and document the swap. At minimum, report the per-cell delta.
- **S-F4 (prequential coverage):** the §8 held-out coverage is **also** scored using the **as-of-t (prequential)** correction, not only the final converged bins — i.e. coverage as production behaves. Report both steady-state and prequential coverage.
- **S-F9 (heteroskedastic fallback):** revise the §6 cascade — **never** fall a cell back to **global** (residual scale differs by orders of magnitude across flow ⇒ absurdly narrow high-flow band). Cap fallback at the **bin-`all`** aggregate; if bin-`all` < MIN_OBS, **scale a neighboring cell's quantiles by the flow ratio** rather than borrowing global. Flag any cell relying on cross-bin fallback as **low-confidence** in the UI.
- **S-F5 (ceiling sensitivity is a gate, not an afterthought):** the ceiling censors only positive (overestimate) residuals and **leaks ground truth** (`applyGFCorrection` ceiling uses `actualLF`, `model.js:280`), making ceiling-active residuals partly self-referential. **Amendment:** compute the with/without-ceiling **q95 delta per high-flow cell BEFORE finalizing**; if material, derive **q95 on the pre-ceiling corrected value** and apply the ceiling only to the point estimate (accept documented mild low-side over-coverage).
- **S-F6 (burn-in justification):** justify **B empirically** — plot per-cell cumulative prequential residual mean vs obs-count and pick B where it stabilizes — not from EMA-convergence theory. **Sensitivity-sweep B ∈ {20, 30, 50, 75}**.
- **S-F7 (conflation semantics):** keep GF-vs-LF conflation (production already does), but **document** the band as an *LF-equivalent-flow* interval at GF, inflated by GF→LF routing/ungauged-flux variability — not pure GF model uncertainty. *(Amended §7.3.)*
- **S-F8 (non-stationarity):** report **rolling 3-yr** q05/q95 per cell as a diagnostic; if high-flow cells are recent-era-dominated, state the band is effectively a recent-era band labeled 14-year.
- **S-F10 (time-weighted coverage gate):** report the **time-weighted fraction of user-facing hours** in gate-passing cells; require **≥ 80%**.
- **S-F11 (symmetry = diagnostic):** two-sided miss symmetry (~5%/5%) is a **diagnostic**, not a hard gate (asymmetric whitewater-safety loss makes e.g. 4%/6% honest); **gate only the two-sided total** at 90% ± (bootstrap tolerance).

### Preserved strengths (do not lose in revision)
Sign/shape derivation and the `±halfWidth` structural-impossibility argument; the §1.1 basis-mismatch diagnosis (verified against `error_distribution_v2_python.py:50,53,63`); **binning on the model's own logged `(flowBin, flowState)`** so derivation-key == application-key (`great-falls.js:497`); reusing the **real exported `makeGFPrediction`** to kill model-drift; the timestamp-shift exactness argument; the `updateCorrectionBin` shared-helper extraction + cross-check; excluding hard-flagged (corrupted-truth) observations while keeping soft-flagged (real model-error) ones; out-of-sample time-split as the coverage backbone.

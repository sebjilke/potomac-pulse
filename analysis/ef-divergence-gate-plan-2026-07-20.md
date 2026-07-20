# EF Divergence Gate — v38.0 Plan (2026-07-20)

**Status:** PLAN — pre-audit. No analysis code written yet.
**Decision trigger:** two below-PoR divergence failures in 10 days, both under-predicting while the
EF power-law was nearly exact:

| Episode | App (corrected) | Actual LF | Error | EF estimate | EF error |
|---|---|---|---|---|---|
| 2026-07-10 14:03Z (storm) | 5,606 cfs / 3.45 ft | 8,950 / 3.86 | −36% | 7,377 | −18% |
| 2026-07-19 ~23:00Z (recession) | 2,901 / 3.02 | 3,740 / 3.16 | −22% | ~3,820 | +2% |
| 2026-07-20 12:06Z (pending) | 2,611 / 2.96 | 3,230 / 3.07 | −19% | 3,233 | +0.1% |

Root cause (diagnosed 2026-07-10, confirmed 2026-07-20): the nowcast is PoR-anchored; water entering
below PoR (storm runoff or elevated lower-basin baseflow) is invisible to it. EF integrates 96.3% of
the LF basin from 16 mi above the falls and sees that water — but `getEFWeight` is a logistic in the
*PoR-based estimate* (self-referential: the more the PoR path under-reads, the less EF counts), and
`EF_DISCREPANCY_MAX` (0.50) *skips* EF entirely at high divergence. User decision 2026-07-20: fix it;
no new fitted inflow term (rejected 2026-07-10); detector-gated trust shift to EF.

## 1. Production candidate — divergence-gated EF weight

All quantities already computed in the pipeline. Let `porEst` = time-shifted PoR + tribs + PoR-delta
(pre-ensemble), `efEst` = EF power-law estimate.

- **Divergence:** `D = efEst / porEst`.
- **Sustain:** `D̄` = median of the last K readings of D (K ≈ 4–6 h of readings; median kills
  single-reading EF glitches; sustained requirement kills flapping).
- **Activation (continuous, no binary switch):** `a = clamp((D̄ − T_LO) / (T_HI − T_LO), 0, 1)`.
  Sweep `T_LO ∈ {1.10, 1.15, 1.20}`, `T_HI = T_LO + {0.15, 0.25}`.
- **One-sided (v38.0 scope):** boost only when `D̄ > 1` (EF above PoR-estimate) — both failures are
  this side. The EF-below side keeps current behavior (incl. the 50% skip). Two-sided studied in the
  gate as a comparator but not shipped unless dramatically better.
- **Effective EF weight:** `w = w_logistic + a · (W_CAP − w_logistic)`, sweep
  `W_CAP ∈ {0.5, 0.65, 0.8, 1.0}`. Note W_CAP applies at all flows when active — at high flow the
  logistic is already 0.40, so the delta there is mild but real; the gate must check high-flow bins.
- **EF_DISCREPANCY_MAX skip:** disabled while `a > 0` (in the boost direction the divergence IS the
  signal). Unchanged otherwise.
- **Correction damping:** applied learned correction × `(1 − a)` — both failures had the
  normal-regime correction pushing the wrong way. Learning itself unchanged (bins still learn the raw
  residual; under the new ensemble those residuals shrink, which is the desired effect). Anomaly
  flag thresholds unchanged in v38.0 (scope discipline); pending rows gain `efDivergence` +
  `efGateActivation` fields for observability.

## 2. Comparators (gate evidence, not production)

- **C0 — status quo** (v37 pipeline): baseline.
- **C1 — the candidate**, over the parameter sweep above.
- **C2 — logistic re-center** (midpoint 10k → sweep 3k/5k; no gating): tests whether simply trusting
  EF more everywhere beats gating. If C2 ≈ C1, ship the simpler thing.
- **C3 (stretch, cut if audit deems low-value) — gated trib-excess inflow term**: rejected for
  production by user, scored only to know what's left on the table.

## 3. Evaluation framework

- **Data:** `analysis/hourly_backtest_data_v361.csv` (Dec 2011 → Jun 2026, hourly, has `ef_stage`,
  water temp, tribs, `lf_stage` — the v36.1 CI dataset, 126,916 obs) **extended through 2026-07-20**
  by re-running `fetch_hourly_backtest_data_v361.py` with the end date bumped (GOES-outage gap
  Jul 15–16 stays as missing rows; harness already tolerates gaps). Both July episodes must be in
  the evaluation set.
- **Replay:** production-faithful prequential replay in the `ci_backtest_harness.mjs` pattern —
  live EMA learning, hierarchical corrections, C45 interpolation, anomaly gating, so learning-loop
  feedback of the new ensemble is captured, not just point re-scoring.
- **Window definitions (fixed a priori — no detector circularity):** "event windows" = the 8
  census episodes (2011-07-09, 2012-07-10, 2014-08-12, 2019-07-24, 2019-10-17/21, 2022-07-09,
  2022-08-05; window = flagged day ± 2 days) + 2026-07-09→12 + 2026-07-17→20. "Normal hours" =
  complement.
- **Metrics** (corrected-residual): MAE + median |%err|, reported for (a) global, (b) event windows,
  (c) normal hours, (d) per flow-bin × state, (e) **false-activation audit**: share of normal hours
  with `a > 0.5`, and Δerror on exactly those hours (is the gate harmful when it fires outside
  events?).
- **Dual-language verification** (repo protocol): JS harness emits per-hour residual CSVs; metrics
  computed independently in Python and R (blind, <0.01 tolerance), c45-gate pattern.

## 4. Pass/fail gate (pre-registered)

SHIP iff, for some parameter set:
1. Event-window MAE improves ≥ **25%** vs C0;
2. Normal-hours MAE degrades ≤ **2%**;
3. No flow-bin × state cell degrades > **5%** (esp. 25k+ where EF already has weight);
4. False-activation hours show no net harm (Δerror ≤ 0 on normal hours with a > 0.5);
5. The chosen parameter set is not a knife-edge (neighbors in the sweep also pass 1–4).

FAIL → do not implement; fall back to the display-honesty patch only (confidence downgrade on
divergence), and record findings.

## 5. Implementation surfaces (post-gate only)

`src/model/shared-model.js` ↔ `netlify/functions/shared/model.js` (new gated-weight helper +
damping; byte-identical, extend `ensemble-parity`/`correction-parity` tests), `great-falls.js`
(client ensemble + divergence state from `edwardsFerryData.history`), `scheduled-update.js` (server
ensemble; server needs a small persisted EF-reading history for the K-median — likely a new
`ef_history` observation row mirroring `por_history`; design detail for implementation audit),
pending-row fields, docs ×3, **v38.0 MAJOR**. Known follow-up (explicitly deferred): the
`EMPIRICAL_CI_90` band was derived from the v36 model — post-v38 it becomes conservative during
gate-active periods; re-derivation is a separate MINOR task.

## 6. Risks / expected outcomes

- Expected: large event-window gains (EF was near-exact in both 2026 episodes); the open question is
  normal-hour cost — the Feb-2026 finding of EF negative skill below 6k cfs was measured when the
  PoR model was already good, so the sustained-divergence condition should keep the gate closed in
  exactly those hours. If it doesn't (frequent false activations), condition 4 fails and we stop.
- EF single-point-of-failure: when the gate is active the estimate leans on one stage-only gauge
  (11.7% hourly median error, hysteresis). Mitigations: activation cap < 1.0 unless the sweep proves
  EF-only, existing EF sanity bounds (minStage/maxStage), hysteresis multipliers stay applied.
- Two same-direction 2026 episodes ≠ proof: the 15-year gate exists precisely because "EF seems
  really good at these levels" is currently n=2 evidence.

---

## 7. Plan-audit resolutions (2026-07-20, independent auditor — 13 findings, ALL ACCEPTED)

Amendments below supersede the corresponding text above.

- **F1 (client/server activation divergence):** sustain window defined in **hours** (5h, min M=3 valid
  samples), not reading counts. Activation is **server-authoritative**; the client consumes `a`/`D̄`
  via the sync payload (like correction bins). The replay validates the server path; client hysteresis
  (±8%) is excluded from D on both sides (D uses the bare power-law on both runtimes).
- **F2 (learning contamination):** two new arms — **C1-freeze** (no bin learning while `a > 0.25`;
  candidate for production if it wins) and **C1-nodamp** (damping off). New pre-registered
  **post-event recovery metric**: MAE on the 5–7 days after each window vs C0, per bin. Bin-EMA
  trajectories dumped through every episode.
- **F3 (replay mode):** run **both** single- and multi-pending. Combination rule (pre-registered):
  PASS requires all conditions in multi AND no sign reversal of conditions 1–3 in single.
- **F4 (winter/backwater false boosts):** gate **ineligible while the cold model is active**
  (temp ≤ 10 °C), with temp hysteresis noted for implementation. False-activation audit broken out by
  season and temp.
- **F5 (D guards, fail-closed):** `a = 0` unless ≥3 valid D samples in the trailing 5h AND the
  current-hour efEst is valid (in rating range, sanity-passed). No damping without boost — `a` is the
  single scalar driving both. Production EF-age cap ≤2h (flagged: untestable in hourly replay).
- **F6 (dataset):** v361 CSV **frozen**. New parameterized fetch → `hourly_backtest_data_v38.csv` =
  v361 rows + appended 2026-06-14→07-20 window (overlap-deduped; July values provisional, fetch date
  recorded). **Precondition:** per-day non-blank counts for por/ef/lf over Jul 9–20 must cover both
  episodes before any replay.
- **F7 (inference):** K fixed (not swept) → 24-cell sweep. **Leave-one-episode-out**: chosen cell
  must pass with each episode dropped; per-episode deltas reported; reject single-episode-carried
  passes. Episode-level block-bootstrap CIs on all headline deltas. Selection rule: **most
  conservative passing cell** (highest T_LO, lowest W_CAP). Condition 4 restated: CI-based
  no-significant-harm on normal hours at `a > 0` and `a > 0.5`, plus duty-cycle cap (< 5% of normal
  hours with `a > 0.5`).
- **F8:** 2011-07-09 predates the CSV → **7 replayable episodes**; 2019-10-17/21 merged into one
  window (10-15→10-23).
- **F9:** all arms scored on a **common hour mask** (every due hour with valid LF); anomaly flags
  govern learning only, never scoring inclusion; per-arm flag counts reported as diagnostics.
- **F10 (production fidelity):** C0 replay must approximately reproduce the three logged production
  estimates (5,606 / 2,901 / 2,611 cfs) at their timestamps, else that episode's deltas are not
  evidence about production. Hourly-median smoothing noted: the K-median's 15-min-glitch-kill claim
  is untestable here.
- **F11:** C2 sweeps W_MAX ∈ {0.4, 0.5, 0.65} with re-centered midpoints. **C3 cut.**
- **F12:** server persists an `ef_history`-style observation row (D inputs not reconstructible);
  the window/gap rule above (F1/F5) is THE rule — harness and production implement it identically.
- **F13:** CI-band coverage during gate-active hours measured in the replay (no direction asserted).
  Recommendation to user: ship a confidence downgrade during activation even on PASS (single-gauge
  dependence) — pending explicit OK.
- **Protocol addition:** verification auditor must spot-check ≥5 replay observations against the live
  USGS API (Analysis Verification rule).

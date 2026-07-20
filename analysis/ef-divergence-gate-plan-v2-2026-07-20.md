# EF Divergence Gate — v38.0 Detailed Plan (v2, 2026-07-20)

**Status:** PLAN, FROZEN FOR EXTERNAL REVIEW. No analysis code written. No production code written.
**Supersedes:** `ef-divergence-gate-plan-2026-07-20.md` (v1 + its §7 audit amendments — kept as the
audit trail; this document integrates everything into one self-contained spec).
**Process state:** plan → independent plan-audit (13 findings, all accepted) → user methodology
confirmations (2, recorded in §9) → **this document** → [external review] → build & run gate →
verdict → implement only on PASS.

---

## 0. Problem statement and evidence

Potomac Pulse nowcasts Great Falls flow by time-shifting the Point of Rocks (PoR) gauge downstream
(~19–50 h flow-dependent travel), adding four gauged tributaries, applying a PoR-delta correction,
blending an Edwards Ferry (EF) stage-derived estimate at a flow-dependent weight, then end-applying
a learned EMA bias correction (18 bins: 6 flow ranges × 3 flow states) and a display-only 120%-of-LF
ceiling. Validation: each server prediction is scored against Little Falls (LF) when the water
arrives (~6.5–11 h), and the EMA learns the raw residual.

Two failures in 10 days, same mechanism, opposite hydrological flavors:

| Episode | Regime | App (corrected) | Actual LF | Error | EF power-law | EF error |
|---|---|---|---|---|---|---|
| 2026-07-10 14:03Z | storm runoff below PoR | 5,606 cfs / 3.45 ft | 8,950 / 3.86 | **−36%** | 7,377 | −18% |
| 2026-07-19 ~23:00Z | elevated lower-basin baseflow (recession) | 2,901 / 3.02 | 3,740 / 3.16 | **−22%** | ~3,820 | +2% |
| 2026-07-20 12:06Z (pending) | same recession | 2,611 / 2.96 | 3,230 / 3.07 | −19% | 3,233 | +0.1% |

Root cause (verified to the cfs against stored production prediction rows):

1. **Structural blindness.** Water entering the Potomac below PoR (storm runoff or elevated ungauged
   baseflow; ~583+ mi² ungauged intervening area) has no model term. July 9–10: ~60% of event volume
   at LF was ungauged (water-balance decomposition). July 19: LF/PoR ratio 1.61 vs normal ~1.25.
2. **Self-referential EF weight.** `getEFWeight(porBasedEstimate)` is a logistic in the *model's own
   PoR-side estimate* (`0.40 / (1 + exp(−5·(ln f − ln 10000)))`, 0 below 1,000 cfs): the more the PoR
   path under-reads, the less the model listens to the one gauge that sees the missing water (EF
   drains 96.3% of the LF basin, 16 river-miles above the falls). Weights at the two failures: 2.8%
   and 0.1%.
3. **Discrepancy skip points the wrong way.** `EF_DISCREPANCY_MAX = 0.50` *discards* EF when
   |efEst − porEst|/porEst > 50% — treating exactly the regime where EF is the only honest sensor as
   noise. (Historical rationale: EF-above-PoR has meant ice/backwater/EF malfunction in winter.)
4. **Learned correction fires the wrong direction.** Low/mid bins carry positive EMA bias
   (+180…+356 cfs; the PoR-anchored model over-predicts in *normal* recessions), so the end-applied
   correction subtracts precisely when the model is already under-reading (−378 and −295 cfs at the
   two failures).
5. **The learning loop cannot self-correct this.** Both misses were hard-flagged as statistical
   outliers (z = 7.8, 4.7 vs the bin's learned error distribution) → excluded from learning →
   the bins never see the regime. Self-sealing.

Prior decisions binding this plan: **no new fitted inflow term** (user, 2026-07-10, reaffirmed
2026-07-20); **no multi-pending production redesign** (backtested & rejected 2026-06-19);
anomaly-flag thresholds unchanged in v38.0 (scope discipline).

## 1. Production candidate C1 — divergence-gated EF weight

All inputs already computed per cycle. Definitions:

- `porEst` — the PoR-side estimate: time-shifted PoR + tributaries + PoR-delta correction,
  pre-ensemble (`porEstimateCFS` in the pipeline). Structurally > 0.
- `efEst` — EF power-law estimate `coef·stage^exp` (126·s^2.46 warm; 160·s^2.36 at ≤10 °C), **bare:
  no hysteresis multiplier on either runtime for this computation** (the client's frozen ±8%
  rising/falling multipliers would otherwise make client and server disagree by up to half an
  activation band). Valid only if stage ∈ [2.5, 20] ft and result ∈ [500, 500000] cfs.

**Divergence:** `D = efEst / porEst`, computed each server cycle when `efEst` is valid.

**Sustain (time-based, not count-based):** `D̄` = median of valid D samples in the trailing **5 h**
(server: ~5 hourly samples). Median tolerates a single glitch sample; the 5 h span prevents flapping.

**Fail-closed validity rule (THE rule — replay and production implement it identically):**
`a = 0` unless BOTH (i) ≥ **3** valid D samples exist in the trailing 5 h, AND (ii) the
*current-cycle* `efEst` is valid. One scalar `a` drives boost, damping, and skip-disable together —
there is no state where damping applies without the EF boost. Production additionally requires the
EF reading be ≤ 2 h old (untestable in the hourly replay; flagged for implementation tests).

**Cold-water ineligibility:** `a = 0` whenever the cold EF model is active (water temp ≤ 10 °C) or
temp is unknown-and-last-known-cold. Rationale: EF-above-PoR in winter historically indicates
ice/backwater (the very case the 50% skip was built for), and the cold/warm model switch moves D
discontinuously by ~10% (a full activation band) when temp hovers at 10 °C. Implementation gets a
temp hysteresis (e.g., re-eligible only above 11 °C). The census events are all July–October, so
this guard costs nothing on the target regime.

**Activation (continuous, one-sided):**
`a = clamp((D̄ − T_LO) / (T_HI − T_LO), 0, 1)`, boost side only (D̄ > 1).
Sweep: `T_LO ∈ {1.10, 1.15, 1.20}` × `T_HI − T_LO ∈ {0.15, 0.25}`. The EF-below-PoR side keeps
current behavior entirely (including the 50% skip). Two-sided gating is out of scope for v38.0.

**Effective EF weight:** `w = w_logistic + a · (W_CAP − w_logistic)`,
sweep `W_CAP ∈ {0.5, 0.65, 0.8, 1.0}`. Note: when active this also lifts high-flow weight
(logistic already 0.40 there); the gate's per-bin guard (§6, condition 3) checks that cost.

**Discrepancy skip:** disabled while `a > 0` (divergence is the signal here, not noise). Unchanged
when `a = 0`.

**Correction damping:** applied learned correction × `(1 − a)`. Both failures had the normal-regime
correction subtracting. (Variant C1-freeze below tests the learning side.)

**Server-authoritative activation.** The server computes and persists `D` history (new
`ef_history`-style observation row — past D depends on past `porEst`, which is NOT reconstructible
from gauge history; Supabase unique key `(observation_type, gauge_id)` shapes the row design). The
client does not compute its own activation; it consumes `a`/`D̄` from the sync payload (exactly how
it already consumes correction bins), so displayed == validated survives. The replay validates the
server path; that is the path that learns and validates.

**Observability:** pending-prediction rows gain `efDivergence` (D̄) and `efGateActivation` (a).

## 2. Arms

- **C0 — status quo** (v37.12 pipeline, replayed faithfully): baseline.
- **C1 — candidate** over the 24-cell sweep (3 T_LO × 2 band widths × 4 W_CAP; K fixed at 5 h/3 min
  — not swept).
- **C1-freeze** — as C1, but **bin learning suspended while `a > 0.25`** (quarantine philosophy, like
  hard flags). Motivation: during a multi-day activation the active bin otherwise learns EF-regime
  residuals (~0 bias) at α=0.3 — ~7–10 validations dilute the learned PoR-regime bias, which then
  mis-corrects normal hours at unit gain after deactivation. **User-approved as a possible production
  candidate if it wins.**
- **C1-nodamp** — as C1, correction damping off. Separates the damping effect from the weight effect
  (in the 07-10 storm the flow-crossed bin 6000-12000/rising held −1,350, a *helpful* correction that
  damping would have discarded).
- **C2 — logistic re-center, no gating:** midpoint 10k → {3k, 5k} × `W_MAX ∈ {0.4, 0.5, 0.65}`.
  Tests whether simply trusting EF more everywhere beats gating; if C2 matches C1 within the CIs,
  ship the simpler mechanism.
- ~~C3 — gated trib-excess inflow term~~ — cut (user-rejected for production; cannot change the ship
  decision).

## 3. Dataset

- **Frozen:** `hourly_backtest_data_v361.csv` (126,916 hourly rows, 2011-12-01 → 2026-06-16;
  columns: timestamp, por_now, por_lagged, ef_stage, lf_discharge, lf_stage, water_temp_c, monocacy,
  goose, broad_run, seneca, travel_time_h). It is the provenance basis of the shipped
  `EMPIRICAL_CI_90` and the C45 gate — never overwritten.
- **New:** `hourly_backtest_data_v38.csv` = v361 rows + appended **2026-06-14 → 2026-07-20** window
  fetched by a new parameterized script (`fetch_hourly_backtest_data_v38.py`, start/end as CLI args),
  overlap-deduplicated on timestamp. July 2026 values are provisional USGS data; the fetch date is
  recorded in the file header comment. The GOES-outage gap (Jul 15–16) stays as missing rows — the
  harness tolerates gaps.
- **Coverage precondition (must pass before any replay):** per-day non-blank counts of
  `por_now`, `ef_stage`, `lf_discharge` over 2026-07-09 → 2026-07-20 must show both July episodes
  covered (an unfilled GOES gap that swallows either episode blocks the gate until backfill lands).

## 4. Event windows (fixed a priori — no detector circularity)

From the 15-year daily-mean census of below-PoR-dominated events (≥50% ungauged share of LF excess,
PoR contribution <40%) plus the two 2026 episodes. 2011-07-09 predates the dataset → **7 replayable
episodes**; the two October-2019 events merge into one window:

`2012-07-08→12 · 2014-08-10→14 · 2019-07-22→26 · 2019-10-15→23 · 2022-07-07→11 · 2022-08-03→08 ·
2026-07-09→12 · 2026-07-17→20` (flagged day ± 2 days; the 2026 pair counts as 2 of the 7+2... —
precisely: 6 historical windows + 2 × 2026 windows = **8 windows, 7 independent episodes** treating
2019-10 as one). "Normal hours" = complement of all windows.

## 5. Replay design

- **Harness:** extend the `ci_backtest_harness.mjs` pattern (production-faithful prequential replay:
  live 18-bin EMA learning α=0.3, hierarchical fallback, C45 flow-interpolation of applied
  corrections, two-tier anomaly scoring, single- and multi-pending modes, travel-time self
  consistency) with the §1 mechanism behind an arm/parameter switch. No production files touched.
- **Both pending modes, pre-registered combination rule:** production is single-pending (one
  validation per ~6.5–11 h; learning-loop adaptation ~8× slower than multi mode). PASS requires all
  §6 conditions in **multi** mode AND **no sign reversal of conditions 1–3 in single** mode.
- **Common scoring mask:** all arms are scored on the identical hour set (every validation-due hour
  with valid LF). Anomaly flags govern *learning only*, never scoring inclusion — otherwise each
  arm's flags select its own sample (C0 hard-flagged its worst event hours: z=7.8/4.7 excluded from
  its own accuracy). Per-arm flag counts reported as diagnostics.
- **Production-fidelity check:** the C0 replay must approximately reproduce the three logged
  production estimates (5,606 / 2,901 / 2,611 cfs) at their timestamps. If it cannot (e.g., GOES-gap
  backfill differences), that episode's deltas are not evidence about production and the gate
  verdict must say so.
- **Known limits (stated, not claimed):** hourly-median resampling cannot validate the 5 h-median's
  15-min-glitch-kill property (client cadence is 15 min); EF-age caps untestable at hourly
  resolution. Both become implementation-phase test obligations.

## 6. Pre-registered gate

**Metrics** (corrected residual = displayed estimate − actual LF): MAE and median |%err| for
(a) global; (b) event windows, per-window and pooled; (c) normal hours; (d) per flow-bin × state;
(e) **post-event recovery**: MAE on the 5–7 days after each window, per bin (catches
learning-contamination hangover); (f) **false-activation audit**: duty cycle (% of normal hours with
`a > 0` and `a > 0.5`, by season and water temp) and Δerror on exactly those hours; (g) bin-EMA
trajectories dumped through every episode (visual contamination check); (h) `EMPIRICAL_CI_90`
coverage during gate-active hours (measured, no direction asserted).

**SHIP iff some parameter cell satisfies all of:**

1. Pooled event-window MAE improves ≥ **25%** vs C0;
2. Normal-hours MAE degrades ≤ **2%**;
3. No flow-bin × state cell degrades > **5%** (attention: 25k+ bins where EF already carries 0.40);
4. **No significant harm on false activations:** episode/month block-bootstrap CI of Δerror on
   normal hours with `a > 0` (and separately `a > 0.5`) excludes meaningful harm, AND duty cycle at
   `a > 0.5` is < **5%** of normal hours;
5. **Robustness:** leave-one-episode-out — the chosen cell passes 1–4 with each episode dropped
   (no single-episode-carried pass); sweep-neighbors of the chosen cell also pass 1–4;
6. **Recovery:** post-event recovery MAE (metric e) not worse than C0 beyond the bootstrap CI.

**Selection rule:** among passing cells, choose the **most conservative** (highest T_LO, lowest
W_CAP) — not the best event-window gain. **Arm choice:** C1 vs C1-freeze vs C1-nodamp decided by
the same criteria, with recovery (6) as the tiebreak; C2 preferred over all if within CIs of the
best (simplicity wins ties). **FAIL → no implementation**; fall back to the already-approved
display-honesty patch (confidence downgrade on divergence) and record findings.

**Verification protocol (repo rules):** the JS harness emits per-hour residual CSVs; headline
metrics computed independently in **Python and R** (blind, agreement < 0.01); a fresh verification
auditor (not the implementer) checks cross-language agreement, replays spot checks of **≥5
observations against the live USGS API**, and reviews the gate arithmetic.

## 7. Implementation surfaces (post-PASS only; separate plan-audit cycle)

`src/model/shared-model.js` ↔ `netlify/functions/shared/model.js` (gated-weight helper + damping,
byte-identical, `ensemble-parity`/`correction-parity` tests extended) · `great-falls.js` (client
consumes server activation) · `scheduled-update.js` (D computation, `ef_history` persistence,
pending-row fields, C1-freeze learning guard if that arm wins) · `sync-learning.js` (activation in
the GET payload) · confidence downgrade while active (§9) · docs ×3 · **v38.0 MAJOR**.
Deferred follow-up: re-derive `EMPIRICAL_CI_90` under the v38 model (display-only band; measured
coverage from metric (h) informs urgency).

## 8. Risks

- **n=2 enthusiasm.** "EF is really good at these levels" rests on two 2026 episodes; the 15-year
  gate exists to test exactly that. If EF's historical event-window record is mediocre, the gate
  fails and nothing ships.
- **Single-gauge dependence while active.** EF is stage-only, 11.7% hourly median error, hysteresis
  on falling limbs. Mitigations: conservative-cell selection, W_CAP < 1 unless the sweep proves
  EF-only, rating-range/sanity guards, fail-closed validity, confidence downgrade (§9).
- **Learning contamination** (dilution during activation, hangover after) — addressed by C1-freeze
  arm + recovery metric + trajectory dumps; the combination rule forces the slow single-pending
  reality into the verdict.
- **Winter false boosts** — cold-water ineligibility + seasonal false-activation breakout.
- **Provisional data.** July 2026 USGS values may be revised; the gate verdict notes this; a
  post-approval re-check of the two July windows is cheap insurance before implementation lands.

## 9. Decision log

- 2026-07-10 — user: no new fitted inflow term; reopen only on recurrence. (Recurred: 2026-07-19/20.)
- 2026-07-20 — user: proceed with the EF-pivot "big fix"; still no new term.
- 2026-07-20 — plan-audit: 13 findings, all accepted (v1 doc §7 = full list and trail).
- 2026-07-20 — **user confirmation 1:** C1-freeze may ship as the production variant if it wins the
  gate.
- 2026-07-20 — **user confirmation 2:** confidence downgrade during gate activation ships regardless
  of arm (single-gauge honesty).
- 2026-07-20 — plan frozen for external review (this document). **Next actor: external reviewer.**

## 10. Questions for the external reviewer

1. Is the one-sided, cold-ineligible, fail-closed activation design sound, or does it leave an
   exploitable failure mode (e.g., EF rating drift slowly inflating D̄)?
2. Are the pre-registered thresholds (25% / 2% / 5% / 5% duty cycle) and the
   conservative-cell selection rule the right severity, given 7 independent episodes?
3. Is the multi+single combination rule sufficient protection against the learning-rate artifact,
   or should single-pending be the primary mode outright?
4. Any objection to scoring on the common mask (flags govern learning only)?
5. Is C2-with-W_MAX-sweep a fair "simpler alternative," or is there a simpler-still mechanism we
   have not considered that deserves an arm?

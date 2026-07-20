# EF Divergence Gate — v38.0 Detailed Plan (v3, 2026-07-20)

**Status:** ACTIVE SPEC — external review complete, all findings accepted; gate build authorized
(user, 2026-07-20: "push and implement all").
**Supersedes:** `ef-divergence-gate-plan-v2-2026-07-20.md` (frozen as the externally reviewed
artifact). Audit trails: v1 §7 (internal, F1–F13) ·
`ef-divergence-gate-plan-v2-external-review-2026-07-20.md` (external, E1–E10). §11 maps E→spec.
**Process state:** plan → internal audit (13 accepted) → external review (10 accepted) → **build &
run gate** → verdict → implement production v38.0 only on PASS (separate plan-audit cycle).

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
   baseflow; ~600 mi² ungauged intervening area — exact figure to be stated by the census script,
   E2) has no model term. July 9–10: ~60% of event volume at LF was ungauged (water-balance
   decomposition). July 19: LF/PoR ratio 1.61 vs normal ~1.25.
2. **Self-referential EF weight.** `getEFWeight(porBasedEstimate)` is a logistic in the *model's own
   PoR-side estimate* (`0.40 / (1 + exp(−5·(ln f − ln 10000)))`, 0 below 1,000 cfs): the more the PoR
   path under-reads, the less the model listens to the one gauge that sees the missing water (EF
   drains 96.3% of the LF basin, 16 river-miles above the falls). Weights at the two failures: 2.8%
   and 0.1%. **This was the binding failure at both episodes.**
3. **Discrepancy skip points the wrong way — prophylactically.** `EF_DISCREPANCY_MAX = 0.50`
   *discards* EF when |efEst − porEst|/porEst > 50%. Neither July episode tripped it (discrepancies
   ~24% and ~19.5%), but in a larger below-PoR event it would silence EF exactly when EF is the only
   honest sensor. (Historical rationale: EF-above-PoR has meant ice/backwater/EF malfunction in
   winter.)
4. **Learned correction fires the wrong direction.** Low/mid bins carry positive EMA bias
   (verified live 2026-07-20: 0-3000_steady +242, 3000-6000 +432…+441, 6000-12000_falling +231; the
   PoR-anchored model over-predicts in *normal* recessions), so the end-applied correction subtracts
   precisely when the model is already under-reading (−378 and −295 cfs at the two failures).
5. **The learning loop cannot self-correct this.** Both misses were hard-flagged as statistical
   outliers (z = 7.8, 4.7 vs the bin's learned error distribution) → excluded from learning →
   the bins never see the regime. Self-sealing.

Prior decisions binding this plan: **no new fitted inflow term** (user, 2026-07-10, reaffirmed
2026-07-20); **no multi-pending production redesign** (backtested & rejected 2026-06-19);
anomaly-flag thresholds unchanged in v38.0 (scope discipline).

## 1. Production candidate C1 — divergence-gated EF trust (convex-combination form)

All inputs already computed per cycle. Definitions:

- `porEst` — the PoR-side estimate: time-shifted PoR + tributaries + PoR-delta correction,
  pre-ensemble (`porEstimateCFS` in the pipeline). Structurally > 0.
- `efEst` — EF power-law estimate `coef·stage^exp` (126·s^2.46 warm; 160·s^2.36 at ≤10 °C), **bare
  on both runtimes** (no hysteresis multiplier — see the client-parity rule below). Valid only if
  stage ∈ [2.5, 20] ft and result ∈ [500, 500000] cfs.

**Divergence:** `D = efEst / porEst`, computed each server cycle when `efEst` is valid.

**Sustain (time-based):** `D̄` = median of valid D samples in the trailing **5 h** (server: ~5
hourly samples). Median tolerates a single glitch sample; the 5 h span prevents flapping.

**Fail-closed validity rule (THE rule — replay and production implement it identically):**
`a = 0` unless BOTH (i) ≥ **3** valid D samples exist in the trailing 5 h, AND (ii) the
*current-cycle* `efEst` is valid. Production additionally requires the EF reading be ≤ 2 h old
(untestable in the hourly replay; implementation-phase test obligation).

**Cold-water / temperature eligibility (E1, E10):**
- `a = 0` whenever the cold EF model is active (water temp ≤ 10 °C) or temp is
  unknown-and-last-known-cold. Implementation gets a temp hysteresis (re-eligible above 11 °C).
- **Staleness cap (production):** a temp reading older than **7 days** counts as unknown; unknown
  temp in **Nov–Mar** is treated as cold (ineligible), unknown in Apr–Oct as warm.
- **Replay proxy (pre-registered):** replay hours with missing `water_temp_c` are
  **gate-ineligible in Nov–Mar** and eligible otherwise. (The frozen CSV has no temp 2011–2020 and
  65% coverage in 2021; without this rule the cold guard is inoperative for 62% of the replay.
  All census events are July–October, so the proxy costs nothing on the target regime.)

**Activation (continuous, one-sided):**
`a = clamp((D̄ − T_LO) / (T_HI − T_LO), 0, 1)`, boost side only (D̄ > 1).
Sweep: `T_LO ∈ {1.10, 1.15, 1.20}` × `T_HI − T_LO ∈ {0.15, 0.25}`. The EF-below-PoR side keeps
current behavior entirely (including the 50% skip). Two-sided gating is out of scope for v38.0.

**Mechanism (E5 — one convex combination, no discontinuities):**

```
estimate = (1 − a) · SQ + a · BOOST
SQ    = the exact status-quo pipeline: logistic-weighted ensemble (incl. the 50% discrepancy
        skip) with the learned correction end-applied at unit gain
BOOST = (1 − W_CAP) · porEst + W_CAP · efEst   — no skip, no learned correction
```

sweep `W_CAP ∈ {0.5, 0.65, 0.8, 1.0}`. Algebraically this reproduces v2's
`w = w_logistic + a·(W_CAP − w_logistic)` and correction damping `×(1−a)` exactly, **except** the
skip now lives only inside the SQ branch — removing the discrete jump at `a = 0⁺` when
instantaneous discrepancy > 50% (worst case ~10% of the estimate at mid/high flows under the v2
formulation). `a = 0 ≡ C0` is structural. The 120%-LF display ceiling applies to the combined
estimate as today.

**Server-authoritative activation.** The server computes and persists `D` history (new
`ef_history`-style observation row — past D depends on past `porEst`, which is NOT reconstructible
from gauge history; Supabase unique key `(observation_type, gauge_id)` shapes the row design). The
client does not compute its own activation; it consumes `a`/`D̄` from the sync payload (exactly how
it already consumes correction bins). The replay validates the server path; that is the path that
learns and validates.

**Client EF parity while active (E6):** while `a > 0` the client ensemble uses the **bare** EF
estimate — the frozen client hysteresis multipliers (×1.08/×0.92, plus possible legacy localStorage
drift within [0.8, 1.2]) are excluded, so displayed == validated survives at boosted weight (at
W_CAP = 1.0 the hysteresis gap would otherwise be 8–20% of the headline number). Hysteresis remains
in the `a = 0` client path and the EF-only ice fallback, unchanged. Parity-tested (§7).

**Observability:** pending-prediction rows gain `efDivergence` (D̄) and `efGateActivation` (a,
stamped at prediction time).

## 2. Arms

- **C0 — status quo** (v37.12 pipeline, replayed faithfully): baseline.
- **C1 — candidate** over the 24-cell sweep (3 T_LO × 2 band widths × 4 W_CAP; K fixed at 5 h/3 min
  — not swept).
- **C1-freeze** — as C1, but **bin learning suspended for validations whose prediction-time
  `a > 0.25`** (keyed off the stamped `efGateActivation`, not activation at validation time).
  Quarantine philosophy, like hard flags. **User-approved as a possible production candidate.**
- **C1-nodamp** — as C1, but the learned correction stays fully applied in the BOOST branch
  (equivalently: correction damping off). Separates the damping effect from the weight effect
  (in the 07-10 storm the flow-crossed bin 6000-12000/rising held a *helpful* negative correction —
  live value −1,580, n=4 — that damping would have discarded).
- **C2 — logistic re-center, no gating:** midpoint 10k → {3k, 5k} × `W_MAX ∈ {0.4, 0.5, 0.65}`
  (6 cells). Tests whether simply trusting EF more everywhere beats gating.
- **C2-max — de-self-referentialized logistic (E-Q5):** the existing logistic evaluated on
  `max(porEst, efEst_bare)` instead of `porEst`, same re-centered midpoints {3k, 5k} ×
  `W_MAX ∈ {0.4, 0.5, 0.65}` (6 cells). Stateless, no skip change, no D̄. Known cost: an EF glitch
  lifts its own weight (no median sustain) — priced by the false-activation audit. Worked example:
  at the 07-19 miss, midpoint-3k C2-max yields w ≈ 0.31–0.50 vs the shipped 0.1%.
- ~~C3 — gated trib-excess inflow term~~ — cut (user-rejected for production).

**85 replay configs per mode:** C0 (1) + C1/C1-freeze/C1-nodamp (24×3 = 72) + C2 (6) + C2-max (6).

## 3. Dataset

- **Frozen:** `hourly_backtest_data_v361.csv` (126,916 hourly rows, 2011-12-01 → 2026-06-16;
  columns: timestamp, por_now, por_lagged, ef_stage, lf_discharge, lf_stage, water_temp_c, monocacy,
  goose, broad_run, seneca, travel_time_h). Provenance basis of the shipped `EMPIRICAL_CI_90` and
  the C45 gate — never overwritten.
- **New:** `hourly_backtest_data_v38.csv` = v361 rows + appended **2026-06-14 → 2026-07-20** window
  fetched by `fetch_hourly_backtest_data_v38.py` (parameterized start/end CLI args).
  **Dedup precedence (E10): v361 rows win** — freshly fetched rows are appended only at timestamps
  not present in v361; provisional revisions must not silently rewrite frozen provenance. The
  overlap (06-14 → 06-16) is also diffed and reported (fetch-consistency check), not merged. July
  2026 values are provisional USGS data; the fetch date is recorded in the file header comment. The
  GOES-outage gap (Jul 15–16) stays as missing rows — the harness tolerates gaps.
- **Coverage precondition (must pass before any replay):** per-day non-blank counts of
  `por_now`, `ef_stage`, `lf_discharge` over 2026-07-09 → 2026-07-20 must show both July episodes
  covered (an unfilled GOES gap that swallows either episode blocks the gate until backfill lands).

## 4. Event windows (fixed a priori — no detector circularity)

**Census artifact (E2, build step 0):** `census_below_por_events.py` implements the daily-mean
below-PoR-dominance census (≥50% ungauged share of LF excess, PoR contribution <40%) and writes
`below_por_event_census.csv`. It must **reproduce the 6 historical windows before any replay
runs**; it also reports the ungauged shares of the two 2026 episodes (which were selected as the
observed failures, not by the census — stated openly) and the intervening drainage-area arithmetic
behind the ~600 mi² figure. Discrepancies between script and the frozen windows below are
documented, but the windows themselves cannot move (pre-registered). Extra events the script finds
beyond the frozen list are reported as census-surplus diagnostics, not added.

Frozen windows (flagged day ± 2 days, truncated at dataset edges; 2011-07-09 predates the dataset;
the two October-2019 events merge into one window):

`2012-07-08→12 · 2014-08-10→14 · 2019-07-22→26 · 2019-10-15→23 · 2022-07-07→11 · 2022-08-03→08 ·
2026-07-09→12 · 2026-07-17→20`

= **8 windows, 7 independent episodes** (2019-10 counts once). Window conventions (E2): kept
exactly as frozen in v2 — 2026-07-09→12 is one day shy of "flagged day −2" on the leading edge
(kept as pre-registered rather than widened post-hoc); 2026-07-17→20 = flagged day 07-19 ± 2
truncated at the dataset end (07-21 → 07-20). "Normal hours" = complement of all windows.

## 5. Replay design

- **Harness:** extend the `ci_backtest_harness.mjs` pattern (production-faithful prequential replay:
  live 18-bin EMA learning α=0.3, hierarchical fallback, C45 flow-interpolation of applied
  corrections, two-tier anomaly scoring, single- and multi-pending modes, travel-time self
  consistency) with the §1 mechanism behind an arm/parameter switch. New file
  (`v38_gate_harness.mjs`); no production files touched.
- **Both pending modes (E7).** Multi mode is the full-battery primary (statistical power for
  per-cell diagnostics); single mode is production reality and carries **quantitative
  requirements** (§6, conditions S1–S3), replacing v2's sign-reversal rule.
- **Common scoring mask:** all arms are scored on the identical hour set (every validation-due hour
  with valid LF). Anomaly flags govern *learning only*, never scoring inclusion — otherwise each
  arm's flags select its own sample (C0 hard-flagged its worst event hours: z=7.8/4.7 excluded from
  its own accuracy). Per-arm flag counts reported as diagnostics. The mask is arm-invariant within
  each mode (posting/validation timing depends only on observed gauges, not the arm's estimate).
- **Production-fidelity check (numeric, E3):** the C0 replay must reproduce the three logged
  production estimates (5,606 / 2,901 / 2,611 cfs) at their timestamps within
  **max(5%, 150 cfs)**, with the same flow bin and same correction sign. Failures demote that
  episode's deltas to diagnostic (not evidence about production) and the verdict must say so.
- **Known limits (stated, not claimed):** hourly-median resampling cannot validate the 5 h-median's
  15-min-glitch-kill property (client cadence is 15 min); EF-age caps untestable at hourly
  resolution. Both become implementation-phase test obligations.

## 6. Pre-registered gate

**Metrics** (corrected residual = displayed estimate − actual LF): MAE and median |%err| for
(a) global; (b) event windows, per-window and pooled; (c) normal hours; (d) per flow-bin × state;
(e) **post-event recovery**: MAE on the **6 days** after each window, per bin;
(f) **false-activation audit**: duty cycle (% of normal hours with `a > 0`, `a > 0.25`, and
`a > 0.5`) broken out **by season, water temp, and flow bin** (drought-edge structural bias: EF
validity floor ≈ 1,200 cfs warm vs porEst 600–900 gives D ≈ 1.3–2.0 from rating-edge extrapolation
alone), and Δerror on exactly those hours; (g) bin-EMA trajectories dumped through every episode;
(h) `EMPIRICAL_CI_90` coverage during gate-active hours (measured, no direction asserted);
(i) **ceiling bind-rate** during gate-active hours; (j) per-window C0 MAE table (prequential
maturity gradient made visible).

**Bootstrap spec (E3):** 95% two-sided CIs, 10,000 iterations; block unit = episode for
event-window metrics, calendar month for normal-hours metrics. LOEO uses point estimates.

**SHIP iff some parameter cell satisfies all of (multi mode):**

1. Pooled event-window MAE improves ≥ **25%** vs C0, AND the episode-block bootstrap CI of the
   pooled improvement **excludes 0**;
   - **1H (historical floor, E4):** with *both* 2026 windows dropped, pooled event-window MAE on
     the 6 historical windows still improves ≥ **15%**;
   - **1B (breadth, E4):** MAE improves (any margin) in ≥ **5 of 7** independent episodes;
2. Normal-hours MAE degrades ≤ **2%**;
3. No flow-bin × state cell with ≥ **200** common-mask scored hours degrades > **5%** (cells below
   min-n are report-only; attention: 25k+ bins where EF already carries 0.40);
4. **No significant harm on false activations:** the 95% month-block bootstrap CI of ΔMAE on
   normal hours with `a > 0` (and separately `a > 0.5`) excludes **+5% relative to C0's MAE on
   those same hours**, AND duty cycle at `a > 0.5` is < **3%** of normal hours;
5. **Robustness:** leave-one-episode-out — the chosen cell passes 1–4 with each episode dropped
   (no single-episode-carried pass); all sweep-neighbors of the chosen cell (±1 step in any one of
   T_LO, band width, W_CAP; edge cells have fewer neighbors) also pass 1–4;
6. **Recovery:** post-event recovery MAE (metric e) not worse than C0 beyond the 95% bootstrap CI.

**AND in single mode (E7):**

- **S1:** pooled event-window MAE improves ≥ **10%** (point estimate);
- **S2:** normal-hours MAE degrades ≤ **2%**;
- **S3:** no *flow bin* (aggregated across states, ≥ 100 scored hours) degrades > **10%**;
  per-cell condition 3 is report-only in single mode.

**Selection rule (E3):** among passing cells, choose the most conservative by lexicographic order:
(1) highest T_LO, (2) lowest W_CAP, (3) wider band (T_HI−T_LO = 0.25 over 0.15). **Arm choice:**
C1 vs C1-freeze vs C1-nodamp decided by the same criteria, with recovery (6) as the tiebreak.
**Simplicity rule (E3):** C2 or C2-max is preferred over all C1 variants if it passes conditions
1–6 + S1–S3 itself AND its pooled event-window MAE point estimate falls inside the best C1-variant
cell's 95% bootstrap CI. Between C2 and C2-max, same rule (C2 simpler than C2-max? both stateless —
prefer the one with the better point estimate; if within each other's CIs, prefer C2-max, which
fixes the root cause rather than re-tuning around it).
**FAIL → no implementation**; fall back to the already-approved display-honesty patch (confidence
downgrade on divergence) and record findings.

**Reporting caveat (E10):** the C0 replay's "accuracy" is common-mask and will NOT match the
historical production headline (which excluded hard-flagged validations); the gate report states
this once. **Global-MAE tradeoff (E10, explicit):** conditions 1+2 can net a small global-MAE
degradation (~1% worst case: events ~0.7% of hours at ~6× normal MAE). Accepted deliberately —
the failures being fixed are trust-breaking worst-case misses; global MAE is reported (metric a)
so the realized tradeoff is visible in the verdict.

**Verification protocol (repo rules):** the JS harness emits per-hour residual CSVs; headline
metrics computed independently in **Python and R** (blind, agreement < 0.01); a fresh verification
auditor (not the implementer) checks cross-language agreement, replays spot checks of **≥5
observations against the live USGS API**, and reviews the gate arithmetic.

## 7. Implementation surfaces (post-PASS only; separate plan-audit cycle)

`src/model/shared-model.js` ↔ `netlify/functions/shared/model.js` (convex-combination helper,
byte-identical, `ensemble-parity`/`correction-parity` tests extended) · `great-falls.js` (client
consumes server activation; **bare-EF blend while `a > 0`**, E6) · `scheduled-update.js` (D
computation, `ef_history` persistence, pending-row fields, C1-freeze learning guard if that arm
wins) · `sync-learning.js` (activation in the GET payload) · confidence downgrade while active
(§9) · **rating-drift sentinel (E9):** rolling 30-day median of `efEst / LF_actual` on
gate-inactive normal hours — alarm and suspend the gate (fail-closed) on ±10% departure from its
historical band; 30-day duty cycle surfaced in the learning UI; standing annual EF power-law refit
check while the gate is live · temp staleness cap (§1) · docs ×3 · **v38.0 MAJOR**.
Deferred follow-up: re-derive `EMPIRICAL_CI_90` under the v38 model (display-only band; measured
coverage from metric (h) informs urgency).

## 8. Risks

- **n=2 enthusiasm.** "EF is really good at these levels" rests on two 2026 episodes; the 15-year
  gate — now with the historical floor (1H) and breadth (1B) conditions fencing the
  hypothesis-generating data — exists to test exactly that. If EF's historical event-window record
  is mediocre, the gate fails and nothing ships.
- **Single-gauge dependence while active.** EF is stage-only, 11.7% hourly median error, hysteresis
  on falling limbs. Mitigations: conservative-cell selection, W_CAP < 1 unless the sweep proves
  EF-only, rating-range/sanity guards, fail-closed validity, confidence downgrade, drift sentinel
  (§7), duty cap tightened to 3%.
- **Learning contamination** (dilution during activation, hangover after) — C1-freeze arm +
  recovery metric + trajectory dumps; single-mode conditions S1–S3 force the slow single-pending
  reality into the verdict.
- **Winter false boosts** — cold-water ineligibility + replay temp proxy (E1) + seasonal
  false-activation breakout.
- **EF rating drift** — invisible to the backtest by construction; production sentinel (§7) is the
  defense.
- **Provisional data.** July 2026 USGS values may be revised; the gate verdict notes this; a
  post-approval re-check of the two July windows is cheap insurance before implementation lands.

## 9. Decision log

- 2026-07-10 — user: no new fitted inflow term; reopen only on recurrence. (Recurred: 2026-07-19/20.)
- 2026-07-20 — user: proceed with the EF-pivot "big fix"; still no new term.
- 2026-07-20 — plan-audit: 13 findings, all accepted (v1 doc §7).
- 2026-07-20 — user confirmation 1: C1-freeze may ship as the production variant if it wins.
- 2026-07-20 — user confirmation 2: confidence downgrade during gate activation ships regardless.
- 2026-07-20 — plan v2 frozen for external review.
- 2026-07-20 — **external review returned: PROCEED after amendments (E1–E10). User: "push and
  implement all" → all findings accepted, gate build authorized.** This document (v3) is the
  build spec.
- 2026-07-20 — gate built and run same day: census artifact (4/7 exact reproduction, near-misses
  documented), v38 dataset (coverage precondition PASS), 85 configs × 2 modes, Python+R exact
  agreement, independent audit. Harness amendment mid-run: single-mode D-sample recording was
  slot-gated (production computes D every cycle) — fixed and rerun; multi unaffected.
- 2026-07-20 — **GATE FAIL. No cell passes. v38.0 estimator change is NOT implemented; v37.12
  stays. Fallback per pre-registration: display-honesty patch only (TODO #22).** Structural
  cause and full numbers: `v38_gate_verdict_2026-07-20.md`.

## 10. External-review questions — resolutions

The v2 §10 questions were answered in the external review; resolutions now embedded above:
Q1 sound with E1/E5/E6/E9 adopted · Q2 thresholds kept, fenced by 1H/1B/CI-excludes-0, duty cap
3%, min-n rule · Q3 multi-primary + quantified single (S1–S3) · Q4 common mask confirmed ·
Q5 C2-max arm added.

## 11. External-review finding → spec map (all ACCEPTED)

| Finding | Where integrated |
|---|---|
| E1 replay temp hole | §1 replay proxy (Nov–Mar missing-temp ineligible) |
| E2 census artifact | §4 step 0 (`census_below_por_events.py`), window conventions |
| E3 numeric pre-registration ×7 | §5 fidelity tolerance; §6 bootstrap spec, condition-4 numbers, min-n, lexicographic order, simplicity rule, 6-day recovery; §2 freeze keying |
| E4 fence 2026 episodes | §6 conditions 1H + 1B |
| E5 convex combination | §1 mechanism |
| E6 client EF parity | §1 parity rule; §7 surface |
| E7 quantified single mode | §5, §6 S1–S3 |
| E8 duty flow-bin breakout, 3% cap | §6 metric (f), condition 4 |
| E9 drift sentinel | §7 |
| E10 batch (dedup precedence, staleness, global-MAE statement, skip wording, ceiling bind-rate, C0-headline caveat, per-window table) | §3, §1, §6, §0.3, §6 metrics (i)/(j) |

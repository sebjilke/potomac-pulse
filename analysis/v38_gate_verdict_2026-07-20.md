# v38.0 EF Divergence Gate — VERDICT: FAIL (2026-07-20)

**Pre-registered gate:** `ef-divergence-gate-plan-v3-2026-07-20.md` §6 (plan v2 externally
reviewed; all amendments E1–E10 adopted before the run).
**Result: NO parameter cell passes. v38.0 is NOT implemented.** Per the pre-registered FAIL
branch: fall back to the display-honesty patch only (confidence downgrade on sustained EF
divergence — user-approved 2026-07-20 to ship regardless of arm), and record findings.

## 1. What ran

- Dataset `hourly_backtest_data_v38.csv`: 126,916 frozen v361 rows + 812 appended
  (2026-06-14 → 07-20; provisional; 48 overlap-drift rows logged, v361 kept). Coverage
  precondition PASSED: both July episodes fully covered (GOES gap Jul 15–16 partially
  backfilled, swallows neither window).
- `v38_gate_harness.mjs`: production-faithful prequential replay (real `makeGFPrediction`,
  live per-arm 18-bin EMA learning, common scoring mask, replay temp-proxy E1). 85 configs ×
  2 pending modes. Multi: 123,354 predictions / 122,976 scored. Single: ~23k scored.
  Internal C0 end-apply guard: 2 mismatches / 123,354 (rounding-edge; single: 0).
- Census artifact (E2): `census_below_por_events.py` — **the "must reproduce the 6
  historical windows" precondition was only partially met**: 4/7 frozen flagged days
  reproduce exactly (2012-07-10, 2014-08-12, 2022-07-09, 2022-08-05); near-misses
  documented: 2019-07-24 share 0.463, 2019-10-21 share 0.442, 2019-10-17 share 0.142 vs
  the 0.50 bar. The original chat census's exact parameters were not preserved; the
  versioned re-implementation is now THE definition. Windows stayed frozen as
  pre-registered (deviation disclosed, per plan §4). Neither 2026 window meets the census
  criteria (07-10: PoR-contrib 0.47; the recession window is invisible to a rise census) —
  they are the observed production failures, as the plan states openly.
- Production-fidelity (§5, tolerance max(5%, 150 cfs)): 07-10 14:00Z replay 5,684 vs logged
  5,606 (Δ78, 1.4%) **PASS** · 07-20 12:00Z pending replay 2,747 vs 2,611 (Δ136) **PASS** ·
  the 07-19 "2,901" row **cannot be matched to a unique replay row** (the production trail
  records it against both 23:06 EDT and ~23:00Z): candidate mappings give Δ157 (prediction
  posted 23:00Z; auditor's reading), Δ215 (validated 23:00Z), Δ80 (validated 03:00Z 07-20) —
  two of three exceed tolerance. **Treated as FAIL → W8 demoted to diagnostic** per §5.
  Verdict-neutral: the gate fails on the historical windows alone.
- Verification: Python and R headline metrics agree exactly (max |Δ| = 0.000000 across
  85 configs × 4 metrics × 2 modes). Independent auditor report: §5.

## 2. Headline results (multi mode)

C0 baseline: global MAE 416 cfs · event-window MAE 667 · normal-hours MAE 414.

| Best cells | event improve (need ≥25%) | historical-only (need ≥15%) | normal degrade (cap 2%) | episodes improved (need ≥5/7) |
|---|---|---|---|---|
| c2m_m3k_w65 (best overall) | **+10.0%** | +3.7% | 1.66% | 3/7 |
| c1f_t110_b15_w100 (best C1) | +9.8% | +8.9% | **25.4%** | 5/7 |
| c1_t120_b25_w50 (most conservative) | +2.3% | +2.2% | 7.8% | 5/7 |

Every cell fails condition 1 (no cell reaches 25%; best bootstrap CI of the event delta
includes 0: [−177, +37] cfs) and condition 1H; every C1 cell obliterates condition 2; every
cell fails condition 3 (worst cells +5%…+24%). Condition 4: even T_LO = 1.20 activates on
**9.5% of normal prediction hours** (a > 0.5: 7.4%, vs the 3% cap) with ΔMAE +317 cfs on
those hours — sustained EF-above-PoR divergence is *common* in normal operation, not a
below-PoR signature. Single mode (post-fix, §4) corroborates and worsens the picture: best
cell +14.8% events but +11.4% normal degradation (S2/S3 FAIL); C1 cells reach **+38%**
normal degradation (learning contamination bites hardest at single-pending's ~8×-slower
learning, exactly the F2/E7 concern); every cell fails S1–S3 jointly.

## 3. Why it failed — the structural finding

**The divergence signal does not exist for most events of this class.** Per-window D̄
(5h-median of bare-EF/PoR-estimate) during the 8 frozen event windows:

| Window | D̄ median | D̄ max | % hours D̄ > 1.10 |
|---|---|---|---|
| 2012-07 (W1) | 1.089 | 1.72 | 48% |
| 2014-08 (W2) | 0.955 | 0.98 | 0% |
| 2019-07 (W3) | 0.904 | 1.25 | 11% |
| 2019-10 (W4) | 0.799 | 0.88 | 0% |
| 2022-07 (W5) | 0.779 | 0.94 | 0% |
| 2022-08 (W6) | 0.746 | 0.84 | 0% |
| 2026-07-09 (W7) | 0.969 | 1.25 | 15% |
| 2026-07-17 (W8) | 1.070 | 1.31 | 24% |

EF was valid and reporting in every window (efValid ≥ 97% of prediction hours). In four of
six historical windows EF read **below** the PoR-side estimate for the entire event — no
threshold, however low, could fire, and no EF-trust mechanism of any kind could help.
Hydrologic reading: the ~600 mi² ungauged intervening area splits at Edwards Ferry. Water
entering **above** EF (2012-07, partially 2019-07, both 2026 episodes) is visible to EF and
the mechanism works exactly as designed where it fires (W1: +45% at the aggressive cell).
Water entering **below** EF — the Seneca-to-falls reach — is invisible to *both* sensors,
and that is what most historical census events were. The two 2026 episodes were not merely
an n=2 sample; they were a **regime-biased** sample drawn from the EF-visible subclass.

Compounding findings:

- **False-activation cost is real and large.** D̄ > 1.20 on ~9.5% of normal hours (EF's
  11.7% error plus genuine hydrological variation), and EF hurts on those hours (condition
  4 CI-confirmed). The one-sided trust-shift premise — "sustained EF-above-PoR means EF is
  right" — is empirically wrong most of the time it triggers.
- **Replay C0 under-reads less than production did** on the 2026 episodes (e.g. 2,747 vs
  2,611 at 07-20 12:00Z; W8 replay MAE only 242 cfs). Production's July misses were partly
  a property of its accumulated learned-bin state, not solely of the model structure the
  replay can reproduce. The exact production trajectory is not fully recoverable, which is
  itself a finding for how much event-window headroom there was to win.
- July 2026 data are provisional; revisions cannot bridge a 10%-vs-25% shortfall.

## 4. Amendments during the run (recorded)

- **Harness fix (single mode), 2026-07-20:** the first single-mode run recorded D samples
  only at posting hours (slot-gated), starving the 5h/≥3-sample D̄ rule — production
  computes D every cron cycle regardless of the pending slot (plan v3 §1). Fixed (model
  call every cycle; only posting is slot-gated) and single mode rerun; multi mode was
  structurally unaffected. Single-mode numbers in this verdict are post-fix.
- LOEO interpretation (pre-registered in `v38_gate_metrics.py` header before results):
  7 folds with both 2026 windows as one fold, evaluated at the 15% historical floor.
- W8's recovery window extends past dataset end → empty by construction (noted).

## 5. Independent verification

Blind dual-language: exact Python/R agreement (§1; re-verified after the single-mode rerun).
Fresh verification auditor (no session context): **"the gate FAIL is TRUSTWORTHY"** — own
cross-language comparison (max |Δ| = 0.000000), 21/21 live USGS spot checks across 2012–2026
including the appended window, harness one-call optimization verified against
`scheduled-update.js` (correctionBins consumed at exactly one point), the c0Mismatch=2
explained (rounded-raw bin-step edge, 4 such hours in 14.6y, no bias), every gate condition
traced to the committed pre-registration trail, and the headline FAIL re-derived from raw
residuals to full precision (max event improvement across all 84 cells = 10.05%; "no
condition-1 pass is arithmetically possible on this data"). Seven defects found, none
verdict-capable; full report + per-defect disposition: **`v38_gate_audit_2026-07-20.md`**.
All defects are resolved or disclosed: single-mode D-starvation fixed and rerun (D̄ coverage
12.2% → 97.1%; §4), 07-19 fidelity treated as FAIL (§1), census precondition deviation
disclosed (§1), simplicity-rule bug fixed in `v38_gate_metrics.py` (dead code this run),
LOEO leniency documented in-code (lenient-side only), report-only metrics disposition in §8,
and all artifacts committed with this verdict.

## 6. What ships instead, and what stands down

- **Ships (separate MINOR change, own plan-audit cycle): the display-honesty patch** —
  server computes/persists D̄ (the detector half of this work is validated and cheap),
  pending rows gain `efDivergence`, and the UI downgrades confidence during sustained
  divergence. No estimate change. Note from this gate: D̄ > threshold hours carry REAL extra
  uncertainty (both the 2026 misses sat there), so the honesty patch is justified even
  though the trust-shift is not — but its copy must not claim EF is "right", only that the
  sensors disagree.
- **Stands down:** divergence-gated EF weight (C1 all variants), logistic re-centering
  (C2), de-self-referentialized input (C2-max) — all fail the pre-registered gate.
  **No new fitted inflow term** remains the standing user decision. The only structural fix
  the data would support is a below-EF-reach observation the basin does not currently have
  (no USGS gauge exists between EF and the falls with lower-basin coverage) — recorded as a
  known limitation, not an action item.
- **EMPIRICAL_CI_90 re-derivation:** moot (model unchanged).

## 7. Decision log

- 2026-07-20 — plan v3 (all external-review amendments adopted) = build spec.
- 2026-07-20 — census artifact built; windows frozen as pre-registered; reconciliation §1.
- 2026-07-20 — coverage precondition PASS; replay run (85 configs × 2 modes).
- 2026-07-20 — **GATE FAIL** (no cell passes conditions 1/1H/2/3/4 jointly; §2–§3).
- 2026-07-20 — fallback per pre-registration: display-honesty patch only; queued as its own
  MINOR change. v37.12 remains the deployed model.

## 8. Appendix — false-activation anatomy + report-only metrics disposition

Duty cycle at a > 0.5 for the most conservative cell (T_LO = 1.20, band 0.25), normal
prediction hours, multi mode, by season × flow bin (share of hours; n in parens):

| | 0-3k | 3-6k | 6-12k | 12-25k | 25-50k | 50k+ |
|---|---|---|---|---|---|---|
| DJF | 0.0 (2007) | 0.0 (4793) | 0.0 (10576) | 0.0 (7519) | 0.0 (3291) | 0.0 (921) |
| MAM | 0.0 (87) | 0.0 (2912) | 0.0 (13384) | 0.0 (11907) | 0.4 (3575) | 18.1 (1074) |
| JJA | 25.2 (6017) | 10.9 (13693) | 0.2 (7115) | 0.1 (2549) | 0.2 (807) | 12.1 (224) |
| SON | 28.1 (14832) | 13.9 (7888) | 6.8 (3913) | 4.1 (1322) | 1.1 (1068) | 21.7 (535) |

Three readings: (i) the cold-season guard (E1/E4) works perfectly — DJF duty is zero
everywhere; (ii) the dominant false-activation mass sits at **warm-season low flows**
(25–28% of 0-3k hours!) — the EF rating-edge/low-flow bias the external review predicted
(E8) and the Feb-2026 "EF negative skill below 6k" finding, now quantified; (iii) a
secondary mass at 50k+ (18–22% MAM/SON) — EF high-stage behavior during floods. A detector
that fires on a quarter of ordinary summer low-flow hours cannot gate trust, whatever the
threshold.

Report-only metrics disposition (audit defect 4): duty breakouts (f) — above; per-bin
recovery (e), bin-EMA trajectories (g), `EMPIRICAL_CI_90` coverage (h), and ceiling
bind-rate (i) were **waived on FAIL** — they exist to characterize a winning cell's
behavior before implementation, and no cell won. If any EF-trust mechanism is ever
re-opened (see TODO "re-open only with a new below-EF observable"), they are owed then.

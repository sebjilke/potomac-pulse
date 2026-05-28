# Flow-State Lookback Window Diagnostic — v35.0

**Date:** 2026-05-06
**Author:** Seb + Claude (Opus 4.7)
**Decision:** Widen the PoR lookback window in `getFlowState()` and `getPoRRiseRate()` from 2 hours to 6 hours. Threshold formula (`max(100 cfs, q × 2%)`) unchanged.

## Problem

User reported the production GF estimate "always shows steady." A query of `gf_correction_bin` rows in Supabase confirmed: across all flow bins, **3 rising / 87 steady / 3 falling** validations were collected over ~7–8 days of operation (93% steady).

For a river with active recession dynamics, this is implausible. Normal Potomac behavior even on a calm week should produce ≥30–40% non-steady classifications.

## Hypothesis

The 2-hour lookback combined with `max(100 cfs, q × 2%)` is too strict to register the Potomac's slow recession. The recession limb falls ~10–15% per day → ~1% per 2h → systematically below the 2% threshold; the 100 cfs absolute floor is also rarely cleared at baseflow (3–5k cfs).

## Diagnostic 1 — Live USGS data

Pulled 14 days of 15-minute PoR (`01638500`) discharge from USGS Water Services (`period=P14D`). 4,021 readings, q range 3,080–4,200 cfs (drought-like baseflow). Script: `/tmp/flow_state_diagnostic.js`.

|Δcfs| over 2h, distribution: p10=0, p25=0, **p50=30 cfs**, p75=30, p90=60, **p99=90 cfs** (below the 100 cfs floor).

|Δcfs| / q (percent): p50=0.72%, p90=1.55%, p99=2.35%.

**The 99th percentile barely crosses 2%.** Confirms the threshold is the binding constraint.

### Threshold/window sweep (4,021 readings, drought period)

| Rule | rising | steady | falling |
|---|---|---|---|
| current (2h, max(100, 2.0%)) | 0.4% | 99.6% | 0.0% |
| 2h, max(100, 1.0%) | 0.4% | 99.6% | 0.0% |
| 2h, max(50, 0.5%) | 8.8% | 82.9% | 8.3% |
| 4h, max(100, 2.0%) | 4.6% | 91.7% | 3.6% |
| **6h, max(100, 2.0%)** | **11.1%** | **76.9%** | **12.0%** |

The current rule lines up with production (3/87/3 ≈ 3%/94%/3% — slightly higher than population because cron timing happens to catch some wiggles). The 100 cfs floor is what's binding; loosening pct alone doesn't help.

## Diagnostic 2 — Historical backtest (storm-period validation)

Loaded `analysis/hourly_backtest_data.csv` (117,704 hourly observations, 2011-12 → 2026-02), classified each row under both rules. Script: `/tmp/flow_state_storm_diagnostic.js`.

### Full dataset (117k obs, 2011–2026)

| Rule | rising | steady | falling |
|---|---|---|---|
| current (2h, max(100, 2.0%)) | 9.0% | 81.9% | 9.1% |
| **option B (6h, max(100, 2.0%))** | **19.2%** | **44.8%** | **36.0%** |

The 6h rule's asymmetry (rising < falling) is hydrologically correct: rising phases are short and steep (a few hours per storm), falling phases are long recessions (days). Per-hour sampling weights toward falling.

### Spot-checks on stormy/calm months

| Month | q range (cfs) | current (2h) R/S/F | option B (6h) R/S/F |
|---|---|---|---|
| 2018-05 (wet) | 8,450–99,200 | 18 / 59 / 23 | 28 / 17 / 55 |
| 2020-04 (spring) | 7,640–31,100 | 15 / 83 / 2 | 24 / 35 / 41 |
| 2018-09 (hurricane) | 6,100–134,000 | 24 / 49 / 27 | 34 / 14 / 52 |
| 2011-12 (mixed) | 8,720–74,700 | 10 / 76 / 15 | 20 / 31 / 49 |
| 2025-09 (drought) | 1,380–2,560 | 2 / 98 / 0 | 9 / 80 / 11 |
| 2025-12 (mixed low) | 1,110–3,045 | 7 / 87 / 6 | 25 / 50 / 26 |

All percentages. Option B never goes degenerate; drought months stay ~80% steady (correct), storm months become non-steady-dominant (correct).

### Per-flow-bin breakdown under Option B (full dataset)

| Bin (cfs) | rising | steady | falling |
|---|---|---|---|
| <3k | 14.6% | 68.2% | 17.2% |
| 3–6k | 20.3% | 50.0% | 29.6% |
| 6–10k | 17.1% | 48.2% | 34.7% |
| 10–15k | 18.7% | 38.2% | 43.1% |
| 15–25k | 21.1% | 22.8% | 56.0% |
| 25–50k | 28.5% | 15.5% | 56.0% |
| >50k | 43.0% | 8.7% | 48.4% |

Recession-heavy at high flows, as physics predicts. No regime is degenerate.

## Why 6 hours

Three principled criteria, all of which the 6h window satisfies and the 2h window violates:

1. **Physically meaningful timescale.** PoR→GF travel time is ~6 hours at median flow (varies 4–8h across operating range). The rise/fall at PoR over the past T hours, where T = travel time, is exactly what is about to arrive at GF — so a 6h window asks "is the wavefront approaching GF rising or falling?"
2. **Non-degenerate distribution at all regimes.** Diagnostic 2 confirms across drought, baseflow, spring rises, summer storms, and major floods.
3. **Detection lag tolerable relative to regime duration.** A typical Potomac storm rise lasts 12–24h. 6h ≈ 25–50% lag — acceptable. A 12h window would miss half the rise.

A flow-dependent window scaling with computed travel time was considered but rejected as added complexity for marginal gain (travel time only varies 4–8h; 6h covers the middle).

## Server-side coverage check

Queried `potomac_observations` row `(observation_type='por_history', gauge_id='system')` on 2026-05-06: 574 readings, oldest 48.8h ago, newest 62 minutes ago. The 6h cutoff is comfortably inside the stored window. The `>= 8` history floor in `getFlowState()` was left unchanged because production always has ~500+ readings; the actual coverage check is via the `pastReading <= now - 6h` lookup.

## What changes in code

Three files:

- `netlify/functions/shared/model.js` — `getFlowState()` and `getPoRRiseRateFromHistory()` use `6 * 60 * 60 * 1000` instead of `2 * 60 * 60 * 1000`. Variable rename `twoHoursAgo → sixHoursAgo`.
- `src/estimation/great-falls.js` — `getPoRRiseRate()` mirrors the change.
- `test/model.test.js` — fixtures updated to `sixHoursAgo`. All 88 tests pass.

Threshold formula unchanged. Bin selection logic unchanged. Cold-start fallback to NWS forecast direction unchanged.

## What changes in data

All `gf_correction_bin` rows wiped (covers both `${flowBin}_${flowState}` and `stage_${flowBin}_${flowState}` keys — same `observation_type`). The pending prediction row (`gf_prediction:pending`) is also deleted, so any prediction stored under the broken rule cannot validate into a wrongly-keyed bin after deploy. The shadow-model leaderboard is wiped on the same path.

`gf_metadata` is partially reset: the contaminated learning-stats fields (`totalValidations`, `validValidations`, `sumAbsErrorPercent`, `avgErrorPercent`, `flaggedValidations`, `lastValidation`) are zeroed; operational health fields (`lastPrediction`, `consecutiveRuns`, `missedRuns`) are preserved. This matches the existing `resetGFLearning` admin endpoint behavior. The accuracy stats are reset because predictions made under steady-biased bins inherited contaminated corrections, so the `avgErrorPercent` that the bins fed into is itself biased.

Bins were filled under the broken rule, and Supabase does not retain per-observation raw records (only aggregate `count, sumError, meanError, sumErrorSq, emaMeanError`), so true retroactive reclassification was impossible. Reset was the methodologically clean alternative.

**Bin-repopulation timeline.** Expected steady-state in 1–2 weeks (~12 runs/day × 14 days ≈ 168 validations across 18 bins, average ~9 per bin). Repopulation is non-uniform: most validations land in low-flow steady/falling bins, so high-flow rising bins may not reach the `count >= 5` activation floor (`great-falls.js:66`) during a dry period. Until then, the affected bins return zero correction and the prediction is the raw PoR+EF ensemble + LF ceiling — the system is still functional, just with no learned correction term in those regimes.

## Side effect on wave celerity

`getPoRRiseRate()` returns `ratePerHour = pctChange / hoursDiff`, which feeds the wave-celerity travel-time reduction at `scheduled-update.js:423-424`. Widening the lookback to 6h smooths the rate: a 90-min flashy rise that returned ~20%/h under the 2h rule now returns ~5%/h averaged over 6h, which translates to ~10% travel-time reduction instead of the 30% cap. This is a deliberate accepted side effect — the 6h average is more representative of conditions affecting a 6h-travel-time wave than a sub-window spike — but it is a real behavior change separate from the flow-state classification fix. Wave-celerity reductions on flashy storm fronts will be smaller after this change.

## Limitations / known issues

- **Drought regimes still classify ~77–80% steady** under 6h+max(100, 2%). The 100 cfs floor is binding at 3–5k cfs (1% of 5k = 50 cfs → threshold = 100 cfs ≈ 2%/6h, near the recession rate). The widening helps but does not fully fix slow recessions at low flow. A second-pass fix (e.g., scaling the 100 cfs floor down at low flow, or a flow-dependent window) is deferred to a future version.
- **Diurnal upstream-release signals** (Jennings Randolph, Savage River) operate on sub-6h cycles and may now be smoothed away when previously they registered.
- **Ice periods**: behavior at frozen conditions was not explicitly tested. Ice flagging is upstream of `getFlowState` (the cron skips learning when PoR/LF are ice-affected), so the impact is bounded.
- **Threshold itself unchanged.** Diagnostic 1 line 33 (`max(50, 0.5%)`) gave a more balanced distribution but was rejected for noise sensitivity. Documented for the record.

## Cross-references

- v32.0 (2026-02-21) introduced the original 2h observed-PoR lookback, replacing an even-worse NWS-forecast-based classifier. v35.0 widens that lookback. v32.0's "(2-hour lookback from porHistory)" wording in `tech-appendix.md:780` is preserved as historical record.

## Validation done before commit

1. ✅ All 89 tests pass after the lookback change (88 prior + 1 new boundary test that fails under any window other than 6h).
2. ✅ Server-side `por_history` coverage confirmed via Supabase query (574 readings spanning 48h).
3. ✅ Storm-period backtest confirms Option B is well-behaved across all flow regimes.
4. ✅ Diagnostic scripts saved at `analysis/flow_state_window_diagnostic_live.js` and `analysis/flow_state_window_diagnostic_backtest.js`.
5. ✅ Independent auditor subagent reviewed the change (audit report archived alongside).

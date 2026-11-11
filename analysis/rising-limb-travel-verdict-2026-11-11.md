# Rising-limb travel and delta backtest (A7): verdict, 2026-11-11

Plan: `analysis/rising-limb-travel-backtest-plan-2026-11-10.md` (frozen 2026-11-10; deviations D-1 to D-9, all recorded before any result was seen).
Audit: `analysis/rising-limb-travel-backtest/rising_limb_audit.md` (sha256 e5e1c62ff008385583a4f68ca038abf3ef3f7d067ca90c1f30cc7ea684745c5b). Every number below is taken from the audited gate table; the audit holds the full table, the Python and R values side by side, and the scripts that rebuild it.

## Outcome

**FAIL.** No arm meets every criterion of plan section 5. Nothing ships. Per the plan, the item closes: no retuning of variants, windows, thresholds or exclusions, and no rerun on the same data. A new idea needs a new plan and new data (rises after 2026-11-09) or a separate audited design.

This is not FAIL-INSUFFICIENT (20 non-October events against a floor of 15) and not a STOP (the audit found no implementation bug that touches a gate quantity; all preconditions hold).

## What was tested

Three changes to the Great Falls raw estimator, against the production baseline, over all large rises in the hourly record 2012-12 to 2026-11:
- A: apply the Point of Rocks change correction to Point of Rocks only, not to the tributaries.
- B: use the higher of Little Falls and Point of Rocks for the travel-time lookup while Point of Rocks is rising.
- C: A and B together.

N = 21 rises with a Little Falls peak of 12,000 cfs or more (20 plus October 2026). 13 further rises of that size were excluded by the rules fixed in advance (burn-in, ice risk, gauge outage); they are listed with reasons in the audit, section 3. Holdout: events 47, 48, 49, 51.

## Result per arm (primary run)

| Arm | Failed criteria | Binding criterion |
|---|---|---|
| A | G7f | G7f: the error of the DISPLAYED estimate on the rising limb gets 5.49 percent worse (needs no worse than baseline) |
| B | G1a, G1b, G4b, G6a, G6b, G7d, G7f | G1a: rising-limb gain 5.98 percent (needs 15) |
| C | G4b, G7f | G4b: normal hours 7.48 percent worse in the 12,000 to 25,000 cfs rising cell (needs at most 5); G7f: displayed error 8.27 percent worse |

The originally approved thresholds, for the record:

| Arm | Rising-limb gain, all events (needs 15%) | Without October (needs 10%) | Events improved (needs 65%) | Normal hours (at most +2%) | Recession bias change |
|---|---|---|---|---|---|
| A | +36.6% [29.4, 42.4] | +35.5% [27.7, 41.1] | 18 of 21 | -0.40% | -0.11 pp |
| B | +6.0% [3.0, 9.3] | +6.3% [3.3, 9.8] | 15 of 21 | +1.28% | -0.04 pp |
| C | +36.1% [28.1, 41.9] | +34.7% [26.1, 40.2] | 17 of 21 | +0.54% | -0.16 pp |

A and C pass every originally approved threshold. They fail on rows the plan added before the run as tightenings. That explains the result; it does not change it. The gate was fixed in advance precisely so that this could not be argued afterwards.

## Why the failure is real and not a technicality

Criterion G7f asks whether the number a visitor sees gets better, not only the internal number before the 120 percent display cap.
- On rising-limb hours the baseline overestimates heavily before the cap (mean +2,461 cfs). The cap binds on 52.5 percent of those hours and already removes most of that overestimate from the screen.
- A and C remove the overestimate inside the model (mean +478 and +379 cfs). Most of that gain falls on hours where the display was capped anyway, so the visitor sees little of it.
- On the 342 rising-limb hours where neither the baseline nor A is capped, the displayed estimate is already too LOW under the baseline (mean -1,477 cfs), and A reads lower still (-1,811 cfs). Too low on a rising river is the unsafe direction.
- Only 6 of 21 events have a lower displayed error under A. Dropping any single event keeps A's G7f negative (-6.4 to -0.35 percent).

So A and C improve the uncapped number and make the shown number slightly worse, in the unsafe direction. B, the travel-lookup change that motivated the item, gives a small gain (6 percent) and fails on its own.

## What the study did establish

- The mechanism behind October 2026 is reproduced: the baseline's travel lookup fails to converge on 9 of 26 October rising hours (34.6 percent; precondition P3 needed 20).
- B and C bring non-convergence on rising hours down from 7.8 percent to 1.6 percent, but convergence alone buys little accuracy.
- Scaling the tributaries with the Point of Rocks change (what A removes) is the larger source of rising-limb overestimate in the uncapped number.
- The 120 percent cap is doing much of the work on rising limbs today. Any future change to the raw estimator has to be judged on the displayed value.

## Trust in the numbers

Independent audit, 2026-11-11: the numbers can be trusted within the limits below.
- Python and R (blind to each other) agree on all 5,148 shared rows; largest difference on a gate quantity 5.5e-11. The auditor's own recomputation of all 17 criteria matches both.
- Baseline equals production on 127,874 of 127,874 hours; all cross-arm invariants hold; the learning-gate and model text match production apart from the permitted hooks.
- A third, independent Python implementation matches the harness on four events with no value beyond tolerance, and rebuilds the correction bins from empty over 130,222 hours to an exact match.
- Live USGS spot check: 8 hours, all 46 approved gauge values within 1 percent; 17 provisional values flagged.
- No error of any arm was computed or seen by anyone, including the orchestrator, before the two blind analyses were complete and frozen in git (commit 0bae75d). The rulings D-7, D-8 and D-9 were made blind.

## Limits (plan section 8 applies in full)

- Truth is Little Falls as reported, which includes ungauged inflow below Great Falls.
- The replay uses hourly medians and a 1 to 2 h lag view, not the live 15 minute data; the October cap effect is only roughly reproduced.
- Single-slot learning is the primary run by design, because production has one pending slot. Report-only: under the multi-pending replay arm A would have met all 17 criteria (G7f +2.9 percent). This decides nothing and must not be used to pick a run after the fact.
- October 2026 lies wholly in freshly fetched provisional USGS data, on a later revision state than the cron saw (D-3). This applies to every October-specific number (P3, the difference between the all-events and no-October gains).
- About 21 events, almost all June to November (winter lost to the ice-risk exclusion); holdout of 4.
- Production's critical-ice skip is not modelled (D-5 H4).
- Audit findings of low severity: the harness reads one hour past the end of the record on two hours of the last day (handled by D-8, effect at most 1e-6 on one normal-hours criterion); the baseline-identity and invariant checks ran in the test suite's own replay inside the same command rather than inside the pass that wrote the result files (re-verified on the written files, 0 failures).
- Correction to D-9: one hour, not two, has its secondary truth columns past the end of the record; the other is the D-8 hour.

## Consequences

- A7 is closed. Production stays at v39.6; no model change.
- The rollback rule of plan section 11 is not needed, since nothing ships.
- A6 (multi-pending validation) was queued behind this verdict. Note for its design: this study has now shown, report-only, how arm A behaves under multi-pending learning on this same record. A new gate for A6 on the same data would no longer be a clean test of anything that combines the two. That needs to be stated in A6's plan and weighed by the owner and the plan auditor.
- Open observation for the owner, not a recommendation to act: the display cap, not the raw estimator, determines most of what is shown on a rising limb. The cap indicator (v39.3) already tells the visitor when that happens.

# Replay analysis, final record: does a fresher Point of Rocks reading improve the Great Falls estimate?

Date: 2026-11-18 (UTC). Question, design and decision rule: `PLAN.md` (pre-registration confirmed by the owner on
2026-11-17 before any code). Tool audit: `TOOL_AUDIT.md`. Blind analyses: `py/metrics_python.csv`,
`r/metrics_R.csv` (329 common numbers, largest difference 4.5e-9). Third auditor: `replay_lag_audit.md`
(every headline reproduced with independent code; 34 hourly values checked against the live USGS service, all equal).

## Result

`d = |error with the fresh reading| - |error with the reading an hour older|`, in points of absolute percent error
against Little Falls; negative would mean fresh is better. 95% intervals from a month-block bootstrap.

| Population | Pairs | Mean d | 95% interval | Mean abs. error fresh / stale |
|---|---|---|---|---|
| **Primary: rising water, hours where the two versions differ** | 11,587 | **+0.35** | +0.22 to +0.49 | 9.03 / 8.67 |
| Floods (Little Falls at least 50,000 cfs), hours that differ | 1,616 | +0.31 | +0.10 to +0.50 | 4.91 / 4.60 |
| Falling water, hours that differ | 14,866 | +0.17 | +0.09 to +0.25 | 3.73 / 3.56 |
| Steady in both versions | 63,842 | +0.02 | -0.02 to +0.05 | 4.71 / 4.69 |
| All scored hours | 124,631 | +0.04 | +0.01 to +0.07 | 4.90 / 4.86 |

The uncorrected model loses more with the fresh reading (+1.26 points on the primary population); the learned
corrections absorb about 70% of that. Misses beyond 25%: 6.33% (fresh) and 6.44% (stale). Mean signed error:
-1.89% (fresh), -2.44% (stale).

## Where the loss comes from (third auditor's decomposition)

| Within the primary population | Pairs | Mean d |
|---|---|---|
| Both versions call the water rising | 8,209 | -0.10 |
| Same flow state and bin in both | 7,842 | -0.14 (interval -0.27 to -0.01: fresh better) |
| Fresh says rising, stale still says steady | 2,987 | +1.83 |
| State or bin differs | 3,745 | +1.38 |
| Point of Rocks rose at least 5% in one hour | 1,565 | -0.17 (interval -0.43 to +0.09) |

The fresh reading flips the flow state to "rising" about an hour earlier. The rising bins then subtract more than
the steady bins (6.9% of the raw estimate against 5.2%) and over-correct gentle onsets. Where both versions agree
on the state, and on fast rises, the fresh reading is neutral or slightly better. The loss is therefore a property
of the current state classifier and bins, not of fresh data as such.

## Decision rule, applied mechanically

Primary upper end 0.490 < 0.5 and flood upper end 0.502 < 1: **MOVE**. Median absolute offset at the first rising
prediction after a switch 1.37% (90th percentile 4.7%; one branched date showed 11.7%): no safeguard triggered.

The rule is a non-inferiority rule. It says the fresh reading is not worse by more than half a point. It does not
say it is better, and the data say it is slightly worse. The verdict passes by 0.01 point; it would read
INCONCLUSIVE in either half of the record alone (upper ends 0.512 and 0.586) or with the truth read one hour
earlier (0.525). Truth timing never changes the sign (0.22 to 0.43 across shifts of plus or minus two hours).

## Orchestrator's recommendation (formed after seeing the result; the pre-registered verdict is MOVE)

Do not move the job. The only purpose of moving was accuracy; the replay finds none and a small loss. This is the
owner's decision.

## Limitations

Hourly medians (smooth fast rises, which is where the fresh reading helps); a 60 minute gap where the real one is
55; both versions about 30 minutes staler than production; approved historical data where production sees
provisional readings; ice periods are gaps, not replayed; a look-ahead of at most one hour through the bins,
identical in both versions; water temperature present for 35% of the record; production's displayed estimate is
computed in the browser; the effect of re-tuning the model for fresh inputs (state threshold, onset handling) was
not tested.

## Side findings, recorded as open items, not acted on

1. The rising-state corrections over-correct gentle rise onsets (example 2025-02-15 06:00 UTC: raw 14,695 cfs, the
   rising bin subtracts 4,247 cfs, error -26%; the steady bin would subtract 583, error -0.7%).
2. The published 90% band (`EMPIRICAL_CI_90`) was derived with a replay that excluded its largest errors as
   outliers and read each hour about 22 minutes early, and with an older model version; it describes neither
   current production nor this replay (TODO A8).

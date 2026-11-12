# Multi-pending validation (A6): verdict, 2026-11-12

Plan: `analysis/multipending-responsiveness-plan-2026-11-11.md` (v2, frozen on the owner's approval of the gate, 2026-11-12; deviations D-1 and D-2 record results of preparation steps only, both entered before any result was seen).
Audit: `analysis/multipending-responsiveness/audit_work/a6_audit.md` (sha256 65303f29050d0d9ea4b136ea343554344b1b382e161d4a29423a22c45b21ab00). Every number below is from the audited gate table. The audit holds the full table and the scripts that rebuild it.

## Outcome

**FAIL.** Learning from every hourly prediction ("multi") does not make the displayed estimate better early in large rises. On this record it makes it worse. Nothing is built. Per the plan this closes multi-pending at the current learning speed (alpha 0.3), as replayed here, on this record. No retuning and no rerun on this record.

This is not a STOP, STOP-MECH, RERUN or VOID: every precondition holds and the audit found no implementation bug.

## What was compared

The unchanged production model (v39.6 server code), replayed over 2012-12 to 2026-11 under two learning policies: "single" (one pending prediction at a time, as production runs) and "multi" (a pending prediction every hour). Same inputs, same raw estimate, same truth; only the learned correction differs. Scored on the DISPLAYED value (after the 120 percent cap) on the 21 rises with a Little Falls peak of 12,000 cfs or more (727 rising-limb hours), 3,172 recession hours and 108,140 ordinary hours.

The mechanical precondition passes: multi does learn earlier and more often (first learned validation a median 5 h sooner; 583 against 80 event-time validations; earlier in 20 of 21 rises).

## The 14 rules

| Rule | Group | Result | Value | Needed |
|---|---|---|---|---|
| R2 displayed error early in rises | deciding | FAIL | 13.0 percent WORSE (95 percent interval 32.5 percent worse to 0.3 percent better) | at least 5 percent better, interval above zero |
| R3 breadth | deciding | FAIL | better in 8 of 21 rises | 14 of 21 |
| B1 without October 2026 | deciding | FAIL | 13.1 percent worse | better |
| B2 leave one rise out | robustness | FAIL | worse in all 21 drops (7.1 to 15.3 percent) | better in every drop |
| B3 four most recent rises | robustness | FAIL | 82.4 percent worse | better |
| N1 ordinary hours, pooled | guard | pass | 4.4 percent better (interval upper bound 2.4 percent better) | at most 1 percent worse |
| N2 ordinary hours by flow group | guard | FAIL | 5 of 18 groups worse by 5.6 to 10.5 percent: all three groups below 3,000 cfs, and rising and steady at 3,000 to 6,000 cfs | no group clearly more than 3 percent worse, no large group more than 5 percent worse |
| N3 ordinary hours, most recent fifth | guard | pass | 0.1 percent better | at most 2 percent worse |
| D1 recession bias | guard | pass, narrow | bias size 0.60 points smaller (upper bound +0.18) | at most +0.5 (upper bound at most +1.0) |
| C1 band coverage, ordinary hours | guard | FAIL | 84.3 percent against 84.9 percent under single (target 90) | no further from 90 than single |
| C2 band coverage, rises | guard | pass | 355 against 361 of 727 hours | at most 2 points lower |
| C3 band coverage, recessions | guard | pass, narrow | 2,402 against 2,436 of 3,172 hours | at most 2 points lower |
| S1 too-low readings on rises | guard | FAIL | 282 against 254 of 727 hours read 15 percent or more too low (+3.9 points; upper bound +8.0) | at most +1 point (upper bound at most +3) |
| S2 too-low readings on recessions | guard | pass | 0.6 points fewer | at most +1 point |

Six of 14 rules pass. Failed: all three deciding rules, both robustness rules, and three guard rules (N2, C1, S1).

## How to read it

- The plan warned that this gate would fail a truly helpful change about two times in three, so a narrow miss on the deciding rules alone would have been weak evidence. This is not a narrow miss. The point estimates go the wrong way in every version of the comparison, and three guard rules show direct harm.
- Ordinary hours are better on average (N1) but worse where the river is low (N2), which is where it spends much of the year.
- The unsafe direction gets worse: more rising-limb hours read 15 percent or more too low (S1).

## Why, as far as the side tables show (report-only, decides nothing)

- Before multi's first validation in a rise the two policies show the same error (1,197 cfs). After it, multi is worse (2,143 against 1,847 cfs).
- On hours capped under both policies (340) the display is identical. On hours capped under neither (340), multi reads lower still (mean error -1,934 against -1,466 cfs). On 42 hours multi's faster correction lifts the estimate off the cap and it then reads far too low (mean -2,494 cfs).
- On the uncapped corrected value the two policies are about even (0.3 percent worse, interval 5.0 percent worse to 4.5 percent better).
- Reading (inference, not a test): on a rising river the raw model overestimates, the learned correction subtracts, and the cap had been hiding most of the overestimate. Learning the positive residual faster subtracts more, sooner, and pushes the shown number low. A7 failed for the same reason from a different side.
- The owner's question about low starting levels: the three rises that began below 3,000 cfs (including October 2026) are close to even (2.1 percent worse, 1 of 3 better); the 18 that began higher are 16.2 percent worse (7 of 18 better). So multi is least bad where the single slot is slowest, but it does not help there either. October 2026 itself: learning started 9 h sooner (13 h against 22 h) and the displayed error was 11.2 percent worse.

## Trust in the numbers

Independent audit, 2026-11-12: the numbers can be trusted within the limits below.
- Python and R (blind to each other) agree on every gate row; largest difference 5.0e-11. The auditor's own code reproduces all 299 comparable rows.
- A third, independent Python rebuild of BOTH replays from empty bins matches the harness on all 130,987 hours per policy (largest correction difference 4.5e-11 cfs) and reproduces the validation counts exactly (23,609 single, 127,714 multi).
- Live USGS spot check: 16 readings behind 8 rising-limb hours, all exact; the 4 October readings are provisional.
- No result was computed or seen by anyone, including the orchestrator, before the plan was frozen and the two analyses were committed (4519f09).
- Nothing that could flip a rule does: the end-of-record hour (D-8) changes no result; counting the one exact tie as an improvement gives 9 of 21; no gate rule depends on a wording that the analysts read differently (those differences are confined to report-only rows).

## Limits

- Plan section 12 applies in full: hourly medians and a 1 to 2 h lag view, not live 15 minute data; no missed runs or database failures; the confidence table was derived on multi-pending residuals (an advantage for multi in C1 to C3, which it still failed in C1); truth is Little Falls including ungauged inflow; 21 rises, almost all June to November.
- Data after 2026-06-14, including October 2026, is provisional or later-revised USGS data.
- This tests hourly learning at alpha 0.3 only. Hourly learning with a slower rate matched to today's memory (about 0.063), per-hour weighting, and "extra slots only on a rise" are NOT tested. They may not be tested on this record (plan section 15); each would need a new plan and new data.
- A7's arm A combined with multi-pending is not tested and may not be tested on this record.

## Consequences

- A6 is closed. Production keeps one pending prediction at a time. No model or learning change.
- The October audit's concern (learning began about 23 h late) is answered for this record: starting to learn sooner did not improve what the visitor saw.
- A5 (Difficult Run) and A8 (confidence band) remain open and wait for logged data.
- Common thread of A6 and A7, for any future idea: on a rising river the displayed number is governed by the 120 percent cap and by how the learned correction interacts with it. Changes that improve the uncapped value, or make it learn faster, have twice made the shown value worse. A future study should start from the displayed value on rising limbs.

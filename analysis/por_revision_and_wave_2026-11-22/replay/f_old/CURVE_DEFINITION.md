# Definition of "the old curve in force on the last old days" (f_old)

Written before the test-set comparison (step 4) was computed and before any comparison of the curve with
`hist.cfs`. What had been looked at when this was written: the level test (logged `in.por.h` against today's
level: 279 of 280 equal), the flow resolution of the old archive (all values multiples of 10 cfs), and the
fact that old pairs from the job log exist only for runs from 10 Nov 21:00 to the 19:00 run of 13 Nov.
Nothing about the reproduction of `hist.cfs`, `rise.r` or any other logged chain value had been looked at.

Fixed rules (no later change without a dated entry at the bottom of this file):

1. Fit pairs. (a) Every run whose logged current Point of Rocks flow is old (logged `in.por.q` differs from the
   current record at `in.por.qT`; the revision is read from the log, not assumed): pair = (today's level at
   `in.por.qT`, logged `in.por.q`). Level taken at the FLOW reading time `qT` (not the logged `in.por.h`,
   whose reading time `hT` can differ from `qT`). (b) Every old-archive 5-minute flow with today's level at the
   same timestamp. Only pairs with a level on the 0.01 ft grid and a flow in the window below are used for the
   curve.
2. Window. The curve uses pairs stamped 2026-11-07T00:00:00Z up to and including the last old pair
   (the 19:00 UTC run of 13 Nov, reading 17:55). This is "the last old days": seven UTC days. Pairs of earlier
   months are reported (pairs_fit.csv, lookup_by_day.csv) but never enter the curve.
3. Knots. For every distinct level (0.01 ft) in the window, the knot flow is the flow of the LATEST pair
   (by timestamp) at that level. If the same level has several flows, all are reported (lookup_by_day.csv,
   F_OLD_REPORT.md); the latest wins, so the curve follows the most recent shift.
4. Inside the knot range: linear in level between the two neighbouring knots, then rounded to the nearest
   10 cfs (half up). At a knot level the value is the knot flow.
5. Outside the knot range, two fixed rules, both carried:
   - Rule A: linear in level through the two lowest knots (below the range) or the two highest knots (above
     it), rounded to the nearest 10 cfs.
   - Rule B: constant ratio to the current record. ratio = (sum of current-record flows) / (sum of old flows)
     over all window pairs whose level is one of the two lowest knots (below the range) or the two highest
     knots (above); value = current-record flow at that timestamp / ratio, rounded to the nearest 10 cfs.
6. Where used. 10 Nov 00:00 to 13 Nov 17:55 (rebuilding what the job stored) and, as the counterfactual, every
   later reading. The level at each timestamp is today's level at that timestamp. A timestamp without a level
   has no old-curve value.
7. Test set (step 4). The logged time-shifted readings (`hist.cfs` at `hist.ts`) stamped 10 Nov 00:00 to
   13 Nov 17:55 whose timestamp is not the timestamp of any fit pair of rule 1. Exact match and misses by
   size are reported; nothing is tuned on them.

## Dated entries

### 2026-11-22 (same day as the definition, after the first outputs of `build_f_old.py`): what was edited in the script (audit finding 5)
`build_f_old.py` was edited after its first outputs (file times: first outputs 06:39, last edit 06:57, final outputs 07:02). The edits:
1. Old-run classification. The first version applied rule 1 literally ("logged `in.por.q` differs from the current record") to every predicted run. That also marked seq 212 (18 Nov 13:00, a post-revision run whose 12:00 reading USGS rewrote afterwards) as an old pair. The first outputs therefore had a curve window ending 18 Nov, the 1.14 ft knot at 1840 cfs, and 3 of 77 test misses, all at 1.14 ft. I saw those outputs before changing. The classification became "the contiguous prefix of predicted runs, up to the first run whose logged flow equals the current record" (the run that first fetched revised values), which is what rule 2 ("up to and including the last old pair", the 19:00 run of 13 Nov) already required. Rule 1's wording describes the intent; the prefix form is its implementation. Rules A and B, the window start, the knots rule, the rounding and the test-set rule did not change.
2. Removed an unused statistic (a month-by-month level/flow count in `f_old_summary.json`) that had no effect on any output file.
3. Added the diagnostic table of archive pairs below the knot range, and the "limits of this test" paragraph, to `F_OLD_REPORT.md`. Neither enters the curve.
The test of 77 readings is a CONSTANCY test only: every test reading sits at a knot level, so it shows that the same level kept the same flow from 7 to 13 Nov and that the level was not revised; it does not test interpolation between knots or extrapolation.

### 2026-11-23: rule C added (audit finding 1), before any study result existed
The October pairs (archive 9 to 12 Oct: 1.01 ft = 1200 cfs, 1.02 ft = 1220 cfs, one flow each) were seen by the builder (LOG anomaly 5, the diagnostic table) and by the tool audit. Rules A (1190 and 1210 at those levels) and B (1200 and 1220) are not shown to bracket the old curve below 1.03 ft, so rule C was added as a disclosed sensitivity for that reason, not after any scenario result.
Rule C: the same knots as rules A and B (7 Nov to the last old pair) plus the two October knots 1.01 ft = 1200 and 1.02 ft = 1220 (confirmed from `lookup_by_day.csv` and the archive pairs); below 1.01 ft linear in level through those two knots, rounded to the nearest 10 cfs (half up); at and above the top knot equal to rule A. Rules A and B are unchanged. Rule C columns were appended to `f_old_values.csv` (`f_old_rule_C_cfs`, `flag_rule_C`); no existing column changed.

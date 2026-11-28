# Clarifications to `ANALYSIS_SPEC.md` version 1.2

The specification itself is not edited after the analysts started (its checksum stays `19c979f2fa575a4fc349047b374a95ceade0fa5e37589f9f892f264b6bd90bf9`). Each clarification below was sent to both analysts in the same words, at the same time, by the orchestrator. A clarification settles an ambiguity; it changes no definition and no number.

## C1 (2026-11-27, sent while both analysts were working)

Found by the builder of the compare tool. Section 10 says for block 2 "periods `burnin`, `design`, `test` in that order" and "Metrics in order", and likewise for block 3, but not which of the two is the outer loop.

**Ruling:** in `learning_health.csv`, blocks 2 and 3, the period is the outer loop and the metric the inner loop. Within a run the rows are: block 1 (11 rows); block 2: all four metrics for `burnin`, then all four for `design`, then all four for `test`; block 3: all nine metrics for `design`, then all nine for `test`.

## C2 (2026-11-27, after both analysts had finished their first complete runs)

Found by the compare tool: 10 of the 11 output files were byte-identical; `checks.csv` differed in one information row, `M04_lfrise_margin` (13 against 14). Cause: the row's text says "hours with `Row(6)` non-blank ..." and names no set of hours. One analyst counted over the base set (hours of the design and test periods with an estimate), the other over every hour with an estimate, burn-in included. The row is information only (a count of near misses of the 10% line of the group "Little Falls rising"); no result depends on it.

**Ruling:** `M04_lfrise_margin` is counted over the base set: the hours of the design and test periods that have an estimate, the same hours on which the group `lf_rising` is used. For the record, `G24` is counted over the same base set (both readings gave the same value there). Nothing else changes.

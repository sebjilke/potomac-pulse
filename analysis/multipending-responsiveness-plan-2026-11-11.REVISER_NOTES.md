# A6 plan v2, reviser notes (2026-11-11)

Returned by the plan reviser with v2. Not part of the plan.

## Things I changed beyond the rulings, and why

1. **Due time in integer ms, with the exact JavaScript evaluation order** (section 3). v1's "v - s >= travel - 1e-9 h" test can disagree with the code by up to 1 ms because of truncation. The rule is now exact, and v1's "ms-truncation edge" STOP clause is gone.
2. **Every column is read as text, and equality is checked on text.** Numbers are parsed with round-trip precision. This removes any parser difference between pandas and R from A2 to A4 and A9.
3. **C1 to C3 and the S1/S2 points are decided in integers** on tick counts. This avoids floating-point ties next to the 2 pp, 4 pp and 1 pp margins.
4. **The non-October index file is dropped from the inputs.** B1 is point-only (PA-9), so the file has no use and is not checksummed.
5. **A month list file is written next to the month-block indices,** so both languages map indices to the same months. Both get a sha256.
6. **The third implementation may read only 11 named columns of the multi file and no truth column.** This makes "computes no error against truth" checkable.
7. **The auditor compares the third implementation's totals with the run-log counters,** including stale 48 and stored 127,874, as an extra full-grid check.
8. **A1 also asserts 122,208 ticks with `in_scoring == 1`,** which ties T80 to the file.
9. **A null band is a STOP** (the band check), instead of silently counting as a miss.
10. **The narrow-pass rule is made computable:** per condition, in the row's own unit, computed by the auditor. I note that D1 will almost always be marked narrow.
11. **Step 0b:** a results-blind grep of the A7 audit text for any base-multi figure, the audit's open point.
12. **FAIL is worded "not demonstrated", and failures are grouped** (deciding, robustness, guard). Given the false-fail estimate, a deciding-row FAIL is weak evidence of no effect.
13. **The live-row limit of about 20 carries one exception:** LF present but out of range. Predictions are still made there, but nothing is validated or dropped.
14. **A fixed definition of October's "LF reached 3,000 cfs" reference tick** (report-only), so both analysts compute the same value.
15. **The P-MECH ratio is defined when the single sum is 0.**
16. **The spot-check draw is fully specified** (8 rows, 2 from event 53, seed 20261116), following A7's method. CLAUDE.md requires at least 5.
17. **RERUN keeps the single file unchanged and requires the third implementation to match the new multi file** before the analysts restart.
18. **Required output rows include `n_res_used` and `n_res_dropped`,** so dropped resamples are visible.

## Points still not established

- **The false-fail figures are judgement, not simulation.** A null simulation would need tick data the plan writer may not open.
- **Whether the A7 audit or verdict text holds any base-multi against base-single figure** (step 0b).
- **Whether R's `as.numeric` and pandas' round-trip parser give bit-identical doubles for every `travel_gf_lf` value** (INFERRED yes). The integer-ms due rule depends on it only at exact ms edges, and A6/A7 would catch a difference.
- **The single chain has been independently checked only on four events and one rebuild** (A7). A cheap option: extend the new third implementation to replay the single chain over the full grid too, comparing `corr` on the single file's base rows. Not added, because it is outside the rulings.
- **What share of single's RL absolute error sits on ticks capped in both,** so the R2 dilution factor (about 2) is INFERRED.
- **Per-bin memory under single:** the 11 h and 38 h figures are grid averages. They are not per active bin.
- **How often LF is present but outside 500 to 500,000 cfs,** which bounds the live-row exception.
- **Production details from v1 and the audit that remain unverified:** the Netlify time limit, Supabase latency, the database unique constraint, the number of database calls per validation, and the cadence on which the LF-residual advisory was backtested.
- **Whether the October reference tick defined here matches the October audit's own "3,000 cfs" moment.**
- **The June storm-bias figures in section 0** come from the audit (BRIEF). I did not open the June findings.

### Critical Files for Implementation
- /Users/sebjilke/Desktop/PotomacPulse/analysis/multipending-responsiveness-plan-2026-11-11.md
- /Users/sebjilke/Desktop/PotomacPulse/analysis/rising-limb-travel-backtest/TICK_SCHEMA.md
- /Users/sebjilke/Desktop/PotomacPulse/analysis/rising-limb-travel-backtest/rising_limb_harness.mjs (ArmChain, MultiChain, for the reconstruction rules; analysts must not read it)
- /Users/sebjilke/Desktop/PotomacPulse/analysis/rising-limb-travel-backtest/model_check/rising_limb_model_check_python.py (starting point for the multi third implementation)
- /Users/sebjilke/Desktop/PotomacPulse/netlify/functions/shared/model.js and /Users/sebjilke/Desktop/PotomacPulse/netlify/functions/scheduled-update.js (travel, due time, learning gate, clamp)
- /Users/sebjilke/Desktop/PotomacPulse/netlify/functions/shared/ci-table.js (`bandFor`)

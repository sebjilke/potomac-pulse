# metrics_R ASSUMPTIONS (readings taken where the plan was unclear)

A1. End of record, truth lookup (UNRESOLVED, caused the STOP). The plan (s.4) reads the truth as "LF view at the
first tick v >= t + tau_ref" with a search to v+2; D-5 H1 and TICK_SCHEMA s.0 say ticks run to
2026-11-09T23:00Z. Literal reading taken: v (and every hour of the tau iteration lookup) must be a tick of that
grid; an hour after 2026-11-09T23:00Z has no tick and so no LF view. The tick files instead give tick
2026-11-09T12:00Z a truth read at 2026-11-10T00:00Z (not a tick of the grid), value 1940, mask 1, mask_why ok.
Under the literal reading that tick is tau_lf_missing, mask 0. The tick files mark 13:00 and 14:00 as
tau_lf_missing, which the literal reading agrees with. So the harness seems to treat the LF view as existing at
the hour whose own stamp (v - 1 h) is the last data stamp (2026-11-09 23:00) but not at later hours (no
carry from it). Out of interest I also tried a second reading (the view exists at any hour, carried up to 3 h
from the last data stamp). It disagreed on 2 ticks (13:00 and 14:00). I did not adopt it. I did NOT
implement the harness's apparent rule, because I could find no plan text that supports it.
This is one tick in every run file (the tick is in_scoring and normal, so it would enter G4a/G4b only).

A2. Rising-rate history: getPoRRiseRateFromHistory / getFlowState are in netlify/functions/shared/model.js
(the brief named scheduled-update.js, which only imports and calls it). Reproduced from shared/model.js lines 466-540.

A3. tau comparison: tau_ref is compared with tolerance 1e-9 h. The maximum absolute difference found is
1.78e-15 h (float noise, R pow vs V8 Math.pow). Truth values and truth ticks are compared exactly.

A4. EW / normal hours use the 53 detected events of the frozen file (GATE and STRATUM, kept or excluded).
BELOW-8,000 onsets are not events (plan s.3), so they do not contribute to EW.

A5. REC for the merged event 24: (tp, tend] before the cut r, minus [t0_k - 12 h, tp_k] of the later
component (component t0/tp read from the component rows of the event file). The derived counts equal the
event file's rec_n_stamps for all 53 events.

A6. n_tau_nonconverged_masked (CHECK row): count of ticks with in_scoring == 1, mask == 1 and tau_converged == 0.

## After ruling D-8 (2026-11-11)
A1 is resolved by D-8: the literal reading stands. Tick 2026-11-09T12:00Z is treated as mask 0 in all four runs by a commented override. G4a_edge / G4b_edge recompute G4 with the file's mask as written (report-only; never in ARM).

## Gate metric readings
G1. G1a/G1b MAE = sum |e_unc| / tick count, hour-pooled over the RL ticks of the kept GATE events (G1b: without the October event). Bootstrap gain per resample = 1 - sum_e c_e S_arm,e / sum_e c_e S_base,e (c_e = how many times event e was drawn). G3a per resample: bias = sum_e c_e B_e / sum_e c_e n_e for arm and base, then |arm| - |base|. No resample had a non-finite statistic.
G2. Per-event rows are written for arms A, B, C (key = event_id); sum_abs_base repeats the base value on each arm's rows.
G4b. Cells use the base arm's base_flow_bin|base_flow_state on the scored normal ticks (count >= 200, shared by every arm). rel_change per cell = sum|e_disp arm| / sum|e_disp base| - 1 (same ticks, so equal to the MAE ratio). Rows only for A, B, C.
G5a. Rows for base, A, B, C in both subsets. The pass row (subset blank) only for B and C: share < 0.05 in both subsets. G5b: diff = share(A) - share(base); pass = both <= 0.
G6a. The October drop in LOEO_all is judged at 0.10, the other drops at 0.15, and every LOEO_nooct drop at 0.10. Breadth is checked on the remaining events: improved x 100 >= 65 x n.
G7d. Scoring set per arm: RL GATE ticks with truth_basehz non-blank and that arm's truth_own non-blank. gain_basehz scores both arm and base against truth_basehz. gain_own scores each against its own truth_own. Both are ratios of sums.
G7e. Subset RL_rising_all, as in the plan table ("RL rising").
Base rows. For criteria where base is the comparator (G1-G4, G6, G7), base values appear as *_base stats on the A/B/C rows, not as separate base rows. Base rows exist for G5a and P3.
CHECK. truth_mismatches = count before the override (D-8 item 5). truth_mismatches_after_override excludes the override tick. Extra rows: view_mismatches, and labelled_rows_truth_after_grid_end (the D-8 assertion).

## Report-only readings
R1. Season = meteorological season of the UTC month of t0 (DJF, MAM, JJA, SON).
R2. LF-led: raw PoR at stamp t0 < 0.5 x raw LF at stamp t0 (plan: "PoR now < 50 percent of LF at t0"). Raw stamps, no lag.
R3. Peak class from event_peak_lf: 12k-25k means 12,000 <= peak < 25,000; 25k+ means peak >= 25,000.
R4. Per-year RL table by the UTC year of t0. Per-year normal table by the UTC year of the tick. Per-bin tables by base_flow_bin.
R5. "PoR-onset timing" has no definition in the plan. Reading taken, by analogy with the LF onset: the first stamp s in [t0-72 h, tp] with raw PoR >= 6,000 and PoR(s-1 h) present and < 6,000. The value reported is t0 - s in hours; positive means PoR rose first. Blank when there is no such stamp (9 kept events, for example events whose PoR never crosses 6,000 in the window).
R6. Observed travel: lag 0-48 h maximising the Pearson correlation of hourly first differences dLF(s) with dPoR(s-lag), s in [t0-12 h, t0+36 h], raw unfilled stamps, pairwise complete, at least 10 pairs. Modelled travel: mean of travel_por_gf + travel_gf_lf over the scored RL ticks, per arm.
R7. The event-equal-weighted gain is reported in two forms (see README), because the plan does not fix which one.
R8. Month-block bootstrap: blocks are the UTC year-months that contain scored normal ticks. Each resample draws all K months with replacement. Statistic = sum|e_disp arm| / sum|e_disp base| - 1.

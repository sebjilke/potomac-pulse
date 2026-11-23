# Addendum to the Part W specification (version 2.1)

Written by the orchestrator on 2026-11-23, after the first comparison of the two Part W analysts. Their tables
agree in 22 of 30 files. The differences were traced to places where version 2 did not fully determine the
computation. This addendum closes those places. Each rule below is a convention chosen on principle; none was
chosen by looking at which analyst's number it favours, and neither analyst is told the other's numbers.

Everything in `ANALYSIS_SPEC_COMMON.md` and `ANALYSIS_SPEC_W.md` stands. Where this addendum is more specific,
it governs. Apply it, rerun everything with your one command, and report.

## A1. Ties in crest and trough (common part, section 3, point 7)

Water levels are published in steps of 0.01 ft, so the smoothed series has flat stretches, and a mean computed
in floating point can differ in its last bits between two equal values. Before taking the largest or smallest
smoothed value of a day, **round every smoothed value to 9 decimal places** (round half away from zero). Then
the crest is the earliest grid time of the day whose rounded value equals the day's largest rounded value; the
trough likewise with the smallest. Use the same rounding wherever a rule says "largest", "smallest" or "ties"
on a smoothed or averaged series: W4 `crest_hour` (hourly means rounded to 9 decimals, earliest hour wins) and
the largest `r` of a lagged correlation (`r` rounded to 9 decimals, then the tie rule of point 10).

## A2. Which group uses which columns in a two-group resample (common part, section 4)

In every two-group statistic the statistic is "a minus b". **Group a (the minuend, first-named) uses columns
`u1` onward; group b (the subtrahend) uses columns `u61` onward.** Concretely: clock test, a = window `after`,
b = window `before`; differences NEW minus OLD, a = NEW, b = OLD; H2, a = P7, b = P5 and P6 together; H5, a =
phase NEW, b = phase OLD.

## A3. `cycle_size_pct_of_mean` (W4)

`cycle_size_pct_of_mean = 100 * cycle_size / abs(mean)`; blank if the mean is zero or undefined.

## A4. Paired comparisons use one set of runs (W5: H1, H3, H4, H6, H7)

In a row that compares two estimates a and b on the same runs, **a run is used only if it has a non-blank
estimate and a non-blank truth for both a and b.** `value_a`, `value_b`, `diff` and their intervals are all
computed on that one set. In H1 the quantity `mean_delay_h` is computed over that same set of runs (the runs
used for the `MAE` row of the same variant and `old_rule`). Report the number of runs used per row as a metric
named `w5_n_runs` with `group` = `candidate|variant|old_rule|quantity`.

## A5. The reference cycle `c_ref` for rows computed on phase OLD only (W5; common part, section 4)

`c_ref` is the cycle of `e_raw` of S0 logged in phase NEW. For a row whose own statistic uses only phase NEW
runs (one group), `c_ref` is recomputed on the same drawn blocks, as version 2 says. For a row whose own
statistic uses only phase OLD runs (H3, variant `OLD`), draw `c_ref` as a second, separate group over the
phase NEW days, using columns `u61` onward. For a two-group row (H5), `c_ref` is recomputed from the phase NEW
group's draw (group a). The point estimate `share_p` always uses the full-sample `c_ref`.

## A6. Names of the H2 variants (W5)

`variant` is exactly one of `por_level`, `por_flow`, `lf_level`, `lf_flow`.

## A7. A diagnostic, not a rule: one fitted wave

For the series Catoctin `01637500`, level `00065`, UTC day `2026-10-26` (table `W2_daily`): add to your report
the number of grid points in the 72-hour window, the number non-missing, the fitted `a`, `b`, `c`, `s` with 12
significant digits, `A_b`, and `phi_b_utc_h`, and say how your code solves the least-squares problem (normal
equations, QR, or a library call) and how `tau` is defined. Do not change your method unless you find that it
departs from the recipe of the common part, point 6; if it does, say what you found and correct it.

## What to deliver

Rerun everything. Keep your folder and table names. In your report add a section "Addendum 2.1": which tables
changed and by how many cells against your previous run (keep a copy of your previous `tables/` as
`tables_v2/` before rerunning and compare), the A7 diagnostic, and anything in A1 to A6 you could not apply as
written. Same rules as before: no opinions, no reading outside the allowed list, no other analyst's folder.

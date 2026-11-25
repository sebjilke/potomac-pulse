READY AFTER CHANGES

# Review of ANALYSIS_SPEC.md (onset study, version 1)

Reviewer: independent, did not write the specification. Date 2026-11-25.
Scratch work: `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/onset_spec_review/`.
No error of any estimate, no comparison between rules and nothing the decision rule depends on was computed on the real data.
Everything on the real files below is a count, a hash, a parse comparison or a per-hour equality between the two languages.
Python 3.14.7 (`python3 -I`), R 4.5.2 (`Rscript --vanilla`), macOS arm64.

Short verdict: the arithmetic is right, every worked unit value is right, the bootstrap mapping is exact, and the data are clean
(every check C01 to C14 would pass in Python, and C09 and C12 also pass under R's parser). Two rulings of the plan's author
must be written in (findings 1 and 2). Three points can make the two analysts differ beyond 0.01 or produce a DIFFER
for a reason that is not in the data (findings 3 to 5). The rest is minor wording.

## Findings

### 1. BLOCKER. Section 7.2 still implements the old tie rule (choice 10), which the author has changed.

Place: section 7.2, mstar.csv in section 12, choice 10 in section 15.
Evidence: the text lets the tie rule pick the smaller `m` of the best two even when that candidate is not itself below production,
and it sets `tie_rule_used = 1` also when the first branch picks `m(b1)` (the second-best has the larger `m`).
Replacement wording for the two bullets of 7.2 that start "If `mic(mae(b2))`" and "`beats_production` = 1":

> Rank the four candidates by `mic(mae)` ascending; equal `mic(mae)` by smaller `m` first. `b1` is rank 1, `b2` rank 2. Let `P = mic(mae(production))`.
> - `beats_production` = 1 if `mic(mae(b1)) < P`, else 0.
> - If `beats_production == 0`: `m* = m(b1)`, `tie_rule_used = 0`.
> - Else, if `m(b2) < m(b1)` AND `mic(mae(b2)) - mic(mae(b1)) <= 20000` AND `mic(mae(b2)) < P`: `m* = m(b2)`, `tie_rule_used = 1`.
> - Else: `m* = m(b1)`, `tie_rule_used = 0`.
> `tie_rule_used` is 1 exactly when `m*` differs from `m(b1)`.

Replace choice 10 with the author's ruling verbatim.

### 2. MAJOR. Criterion 5 on an empty population must be TRUE (author's change to choice 17); the text says 0.

Place: section 10.3, item 5; section 10.1 "A blank value makes every condition that uses it FALSE"; choice 17.
Replacement for item 5:

> 5. `crit5_lowered` = 1 if `lowered_n == 0` (no lowered hour: nothing to guard). Otherwise `crit5_lowered` = `mic(lowered_mean_d) <= 0` AND `mic(lowered_below15_diff) <= 0`.

Add to 10.1: "The blank rule does not apply to criterion 5 when `lowered_n == 0` (see 10.3)."

### 3. MAJOR. R's `as.numeric` is not correctly rounded on these files, and section 13 understates what that can do.

Place: sections 1.3 and 13.
Evidence (scratch `uniq.txt`, `py17.txt`, `r17.R`): of the 1,046,862 distinct non-blank strings in the 15 number columns
(both arms, scored hours), 98,869 (9.4%) parse to a different double in R than in Python, always one unit in the last place.
By column: `rawUnc` 21,624; `errPctCorr` 22,005; `errPctRaw` 20,323; `corrUsed` 10,643; `corrF` 8,628; `corrS` 8,345;
`corrR` 6,925; `truthFlow` 281; `thr6` 95 (for example `thr6 = 100.10000000000001` gives `0x1.9066666666667p+6` in Python,
`...666p+6` in R). `d6`, `span_h`, `lfCap`, `ageR_h`, `rawFinalCFS`, `predictedCFS` have no mismatch.
Every string is the shortest round-trip form (`repr(float(s)) == s` on all 1,046,862), so Python's double is the double the replay had. R is the one that is off.
What I checked does NOT flip (scratch `disc.py`, `disc.R`, `c12.R`):
- the shown value under every rule (production, the four hand-overs, `half_half`, `mean_of_three`, `steady_always`) and under
  `both_sides` with each of the four `m` on falling hours, the tie flag `d6 == thr6` and the ratio group: identical in both
  languages on all 39,690 (L) and 48,610 (F) scored rising or falling LOW4 hours;
- C09 and C12 under R parsing: 0 violations on all scored hours of both arms; the nearest production `v + 0.5` to an integer is 4.5e-6 away;
- no hour has `r` within 1e-9 of 1, 1.5, 2, 3, 5 or 10 without being exactly on it, and no tie or exact-edge hour has a 16 or 17 digit `thr6`.
What I did not check (it needs the error of each hour): whether an hour with a mis-parsed `truthFlow` (or a mis-parsed `errPct*`) lies within about 1e-12 of `err = -15` or `+15`.
Section 13 says the 0.01 tolerance absorbs a flip. It does not for the share columns: one flipped hour moves `below15_*` on
`R_test` by 100 / 8,148 = 0.0123 points, more on smaller populations, so the compare tool would print DIFFER and, through
`R_below15_diff` or `lowered_below15_diff`, a criterion could in principle differ.
Remedy, two options (the first is cheap and keeps the data as they are; the second gives exact identity):
(a) Add a check row that never stops the run:

> `C15_parse_margin`: count the (scored hour, rule variant) pairs with `abs(err + 15) < 1e-9` or `abs(err - 15) < 1e-9`, and the hours of `rising_high_test` with `abs(d6 / thr6 - m*) < 1e-9 * m*` but not equal. This row never stops the run. If it is above 0 on either side, the analysts report it under "Checks"; a DIFFER in a share column is then first explained by these pairs.

(b) Give R the replay's exact doubles: a small audited tool (Python, standard library) writes `replay_L/num_L.csv` and `replay_F/num_F.csv` with `predTs` and the 15 number columns as `float.hex()` strings (blank stays blank), and asserts `repr(float(s)) == s` for every non-blank input string. R reads those columns with `as.numeric` (exact for hex: R's hex parse equals Python's double on all 1,046,862 values, verified). Then replace the parsing sentence of 13 by: "Both analysts parse the number columns from the hex files; the doubles are identical."
Either way, correct section 13, bullet 2, to: "R's `as.numeric` gives a different double for about 9% of the long decimals (verified). The reviewer found no flip of a shown value, tie, group or check. A flip at `err = ±15` would change a share by at least 0.012 points and would show as DIFFER; check C15 counts the pairs at risk."

### 4. MAJOR. C14 names "8 non-production rules" but lists 11 rule variants; its `n_checked` is undefined.

Place: section 6, C14.
Evidence: `m` = 1.5, 2, 3, 5 (4), `half_half`, `mean_of_three`, `steady_always` (3) and `both_sides` with 4 values of `m` (4) make 11. "Pairs the check ran on" can be read as all pairs or only the pairs outside the change set. Two careful analysts can write different integers, which is a DIFFER in `checks.csv`.
Replacement:

> `C14_unchanged_outside` | every (scored hour, rule variant) pair, over 11 variants: `handover_m1.5`, `handover_m2`, `handover_m3`, `handover_m5`, `half_half`, `mean_of_three`, `steady_always`, and `both_sides` with `m` = 1.5, 2, 3, 5 (HIGH2 hours included). `n_checked` = 11 × number of scored hours of the arm. | the hour is outside that variant's change set and its shown value differs from production's

Also C13: write "`n_checked` = 5 × |scored R hours, all periods| + 4 × |scored falling LOW4 hours, all periods|".

### 5. MAJOR. Python's `sum()` and R's `mean()` do not compute "the sum in file order".

Place: sections 4.4, 9.3, 13.
Evidence (scratch): in Python 3.12 and later `sum()` of floats is compensated (Neumaier). On this machine `sum([0.1]*10)` gives `1.0` in Python and `0.99999999999999989` in R; `sum([1e16, 1.0, -1e16])` gives `1.0` in Python and `0` in R. R's `mean()` adds a second correction pass, so `mean(x) != sum(x)/length(x)` in the last bits (seen on a made-up vector of 8,000 values). R's `sum()` on this arm64 build has no long double (`capabilities("long.double")` is FALSE) and equals a plain left-to-right loop (verified). `%*%`, `crossprod` and `rowSums` may reorder.
The effect is in the last bits, so this does not reach 0.01, but it defeats the byte-identity aim near a sixth-decimal boundary and in the percentile ordering.
Wording for section 4.4 (after "All sums run in file order"):

> A sum is computed as `s = 0.0`, then `s = s + x` for each term in the stated order. Python: an explicit loop (never `sum()`, `math.fsum` or `statistics.mean`; `sum()` is compensated since Python 3.12). R: an explicit loop or `sum()` on a plain double vector in that order (never `mean()`, `%*%`, `crossprod`, `colSums`, `rowSums`). A mean is that sum divided by the count. Counts are exact integers.

Wording for 9.3: "`num` and `den` start at 0 and add `c_j * S_j` and `c_j * N_j` for `j = 0, 1, ..., B-1`, every `j` included. `S_j` and `N_j` are computed once per interval row, before the draws."

### 6. MINOR. R writes some integers in exponent form.

Place: section 11.
Evidence: R `paste(100000)`, `as.character(1e5)` and `format(100000)` give `1e+05`; `sprintf("%d", 100000L)` gives `100000`. Any count that is a multiple of 100,000 written through `paste`, `as.character`, `format` or `write.csv` breaks the format rule. Both sides writing `1e+05` would even pass the compare tool (finding 8).
Add to section 11: "R: write every integer with `sprintf("%d", x)` (x a whole number) and every decimal with `sprintf("%.6f", x)`; never through `paste`, `as.character`, `format`, `write.csv` or `cat` of a number."

### 7. MINOR. C01 cannot be computed from `read.csv`, which pads short rows silently.

Place: sections 0 and 6 (C01).
Evidence: `read.csv` has `fill = TRUE` by default, so a row with fewer than 87 fields becomes a padded row, and the data frame no longer shows the field count. Python's `csv` module sees it. (The files are clean: 0 bad rows in both arms, so this changes nothing today, but the check must be computable the same way.)
Wording for section 0, R bullet: "For C01 count the fields per line with `count.fields(path, sep = ",", quote = "", comment.char = "", blank.lines.skip = FALSE)` (this includes the header line, which is not counted as a data row)."

### 8. MINOR. The compare tool can print AGREE when it should not.

Place: section 14, `tools/compare_analysts.py`.
Evidence (scratch folder `ct/`, own made-up files):
- `-nan` on both sides: AGREE (the token list has `nan`, `-inf`, `+inf`, not `-nan`, `+nan`).
- `1e+05` written on both sides: AGREE (exponent form is forbidden by section 11 but only caught when the two sides differ).
- a leading space (` -0.300000`) or a plus sign (`+8148`) on one side: AGREE, only `BYTE-IDENTICAL: no`.
- the same row missing or duplicated on both sides: AGREE (the tool knows neither the expected row keys nor the row counts).
- `decision_inputs.csv` values that differ by up to 0.01: AGREE. The decision is defined on the written strings, so these files should match as text.
Proposed changes to the tool (mechanical, no new judgement):
1. Add `-nan`, `+nan`, `nan(ind)` to `BAD_TOKENS`, and flag any field that matches `[eE]` inside a number, or has leading or trailing space, or a leading `+`.
2. Compare `mstar.csv`, `decision_inputs.csv` and `decision.csv` as exact text (tolerance 0).
3. Check the row count of each file against section 12: checks 35, row_accounting 12, populations 44, a1_tables 126, a2_pick 8, mstar 9, stepb_main 20, stepb_rules 8, both_sides 6, step_at_25000 6, intervals 24, decision_inputs 24, decision 12; and the key column against the listed order where the keys are fixed (all files except `a1_tables.csv`, whose keys are also fixed and can be generated).

### 9. MINOR. Criterion 2 has three loose ends: an empty cell, a blank lower bound, and "covers 0".

Place: section 10.3, item 2; choice 16 and the author's rule on choice 17.
Evidence: the text makes an empty cell (blank `rel`) count as "no harm" (crit2 can be 1), but the author's ruling says an empty population makes its criterion FALSE. A cell whose interval is blank (more than 500 skipped draws) and that is above the margin is not said to be fail or unclear. The plan says "a cell above the margin whose interval covers 0" makes the verdict UNCLEAR; the text uses "not fail", which also includes `hi < 0`. In the data each LOW4 cell of `R_test` has at least 1,408 hours in at least 41 months, so none of this is likely to bite, but the text should be closed.
Replacement for item 2:

> 2. For each LOW4 cell `c`: if `R_cell_c` is empty or `mae_prod` of it is 0, `crit2_no_harm_by_cell` = 0. Otherwise `above_margin_c` = `mic(cell_c_rel) > 20000`; `fail_c` = `above_margin_c` AND `cell_c_ci_lo` is not blank AND `mic(cell_c_ci_lo) > 0`; `unclear_c` = `above_margin_c` AND NOT `fail_c`. `crit2_no_harm_by_cell` = 1 if no cell has `fail_c`. `flag_unclear_cell` = 1 if some cell has `unclear_c`. (A blank interval on a cell above the margin counts as covering 0.)

### 10. MINOR. Criterion 7 omits the point estimate the plan names.

Place: section 10.3, item 7; choice 20.
Evidence: the plan says "the rule's absolute error is lower than half and half, with the whole interval of the difference below 0". A percentile interval need not contain its own estimate, so `hi < 0` alone does not literally imply a lower absolute error.
Replacement: "`crit7_tied_to_rise` = `mic(hh_est) < 0` AND `mic(hh_ci_hi) < 0`, where `hh_est` is `est` of `I17`." Add `hh_est` to `decision_inputs.csv` before `hh_ci_hi` (25 rows).

### 11. MINOR. `est` of an interval row is not pinned to one summation order.

Place: section 9.3, "`est` = the same statistic on the full data".
Evidence: `mean_d` in `stepb_main.csv` sums in file order; `est` read as "num/den with every `c_j = 1`" sums block by block. They differ in the last bits.
Replacement: "`est` = the sum of `x` over P in file order divided by the count of P (the same number as `mean_d` of the matching row of `stepb_main.csv`)."

### 12. MINOR. Quarters are given for only a few intervals; the plan says "the same with calendar quarters".

Place: section 8.2, choice 26, `intervals.csv`.
Evidence: plan section 8, Uncertainty: "Reported as well, not judged: the same with calendar quarters as blocks." The plain reading is a quarter interval for every month interval. It costs about one second.
Replacement: add a quarters row after each months row that has none (`I03` to `I16`), with new ids, or say explicitly in choice 26 that the author restricts it. Either is fine; it must be ruled.

### 13. MINOR. `tie_rule_used` and the other `mstar.csv` rows under the new rule.

Covered by the wording of finding 1. Add: "`m_second`, `mae_second`, `gap_best_second` always describe `b2`, also when `beats_production == 0`."

### 14. MINOR. The unit tests are said to run "before any file is read" but `unit_boot_index` reads one; add the edge cases that are missing.

Place: section 5.
Replacement of the first line: "run FIRST, before the shadow files are read". Add these assertions (all recomputed by me in Python and R, scratch `units.py`, `units.R`, `edge.py`; base values `rawUnc = 3000.4, corrS = 100, corrR = 300, corrF = -50, lfCap = 3300` unless stated):
- `r` exactly `m`: `d6 = 100 * m, thr6 = 100`, each `m` in {1.5, 2, 3, 5}: `w = 1`, shown `2700`.
- `d6 = 125, thr6 = 100`: `w` = 0.5, 0.25, 0.125, 0.0625 for `m` = 1.5, 2, 3, 5; correction 200, 150, 125, 112.5; shown 2800, 2850, 2875, 2888.
- `d6 = 300, thr6 = 120` (r = 2.5): `w` = 1, 1, 0.75, 0.375 for `m` = 1.5, 2, 3, 5; shown 2700, 2700, 2750, 2825.
- Exact half: `rawUnc = 3000.5`, correction 100, no cap: shown `2901`. `rawUnc = 99.5`, correction 100: `0`. `rawUnc = 98.5`, correction 100: `-1`.
- Cap binding under one rule and not another: `lfCap = 2400` (cap `2880` exactly): `steady_always` shown `2880`, production with `w = 1` shown `2700`.
- `lfCap = -5`: no cap, production with `w = 1` shown `2700`.
- Negative correction: `corrS = -200, corrR = 100, w = 0.5`: correction `-50`, shown `3050`.
- Both sides on a falling hour at the tie: `d6 = -100, thr6 = 100, m = 3`: `w = 0`, shown `2900`; far fall `d6 = -400, thr6 = 100, m = 3`: `w = 1`, correction `-50`, shown `3050`.
- Error boundary: `(850 - 1000) / 1000 * 100 = -15` exactly in both languages (`below15` true); `(1150 - 1000) / 1000 * 100 = 15` (`above15` true); `(17 - 20) / 20 * 100 = -15` (true).
- New `unit_periods`: `2019-12-31T23` design, `2020-01-01T00` test; `2023-05-31T23` half1, `2023-06-01T00` half2; `09-14T23` noneel, `09-15T00` eel, `12-15T23` eel, `12-16T00` noneel; `2026-10-07T23` before1008, `2026-10-08T00` from1008; quarter of `2020-03` is `2020Q1`, of `2020-04` is `2020Q2`, of `2026-11` is `2026Q4`; month block index of `2020-01` is 0 and of `2026-11` is 82; quarter block index of `2026Q4` is 27.

### 15. MINOR. R environment and string order.

Place: section 0.
Evidence: section 0 says "Run as `Rscript`"; a site or user profile could change options. String comparison in R follows the collation locale (here `en_US`). The fixed-width `predTs` makes this harmless today, but it should not rest on that. Section 1.1 says "no base SHA-256 exists": R 4.5.2 has `tools::sha256sum` (verified, gives the same hash as `shasum -a 256`).
Replacements: "Run as `Rscript --vanilla r/run_all.R`. First line of the script: `Sys.setlocale("LC_COLLATE", "C")`." And in 1.1: "R analyst: check the SHA-256 with `tools::sha256sum` (the package `tools` is allowed for this one call), and the byte sizes and row counts."
Also name the Python version: "Python 3.14 (as installed); see 4.4 on `sum()`."

### 16. MINOR. `R_from1008` lives in two months; its month interval will be blank. Say so.

Place: section 9.3 and `I16`.
Evidence: on `tools/boot_uniforms.csv`, 1,381 of the 10,000 draws contain neither 2026-10 nor 2026-11, so `n_skipped > 500` and `lo`, `hi` of `I16` are blank by the rule. Not a decision input. Add one sentence so neither analyst treats it as a bug: "`I16` is expected to have blank bounds (its population lies in two months)."

### 17. MINOR. Section 9.1's assert has no output.

Place: 9.1, "Assert that every scored test hour falls in a listed block".
Replacement: "If a scored test hour has a month or quarter label outside the lists, stop the run (as for a check violation) and write the count in `REPORT.md`." Or make it a check row `C16_blocks_cover` (n_checked = scored test hours).

### 18. MINOR. Blindness.

No sentence states an expected direction or result. The verdict names (`GAIN_WITHOUT_ONSET`) and the title ("the onset study") tell an analyst what is tested, which the decision rule needs anyway. Two small points:
- Section 15 ("Choices the plan left open ... for the plan's author to rule on") belongs in a separate note or should be replaced by the rulings before the analysts start, so that the analysts' copy contains rules only.
- This review sits in the study folder; section 0 already forbids reading it. I have kept the plan's expectations out of it.
The tools (`make_boot_uniforms.py`, `compare_analysts.py`) contain no hint.

### 19. MINOR. Performance: prescribe the block sums once.

Place: section 9.3.
Evidence (scratch `tb.py`): with `S_j`, `N_j` computed once per interval and the per-draw counts `c_j` built once per block list, 24 intervals × 10,000 draws × 83 blocks take 2.8 s in pure Python and 1.2 s in base R (made-up `S_j`). Resampling hours instead of blocks would cost about 10,000 × 8,000 × 24 additions in Python, hours of run time. Parsing both shadow files takes about 5 s in R (measured) and a few seconds in Python. The wording in finding 5 (second paragraph) fixes this without changing any result.

### 20. MINOR. Small wording points.

- 3, R: "`R` is the same for every rule and every `m`" is right; add "R contains both design and test hours; `R` in `stepb_main.csv` means `R_test`" (already said in 8.1, repeat in 3 to avoid a slip).
- 7.1, ageR: an `ageR_h` of exactly 720 occurs (18 rows in arm L); it goes to `gt30d` by the half-open rule. The plan says "more than 30 days". Accepted ruling 7 covers it; say "720 hours exactly goes to `gt30d`" next to the table.
- 7.1, the `ageR` level `blank` will have `n = 0` in every ratio group (no R hour has a blank `ageR_h` in either arm). Expected, not an error.
- 10.1: `mic` in R: parse the digit string with `as.numeric`, not `as.integer` (exact either way at these sizes, but `as.integer` returns NA above 2^31).

## Point 1. Plan against specification

Checked line by line against PLAN.md sections 5 to 9 and 17.
- Section 5 scored hours, burn-in, design and test years: in the specification exactly (2.1 to 2.5, section 3). Counts I get with the specification's rules (Python):
  arm L: read 130,987; status 2,392 dropped (128,595 left); burn-in 8,751 (119,844); truth-dependent hard 356 (119,488); out of range 41 (119,447); blank error 0 (119,447).
  arm F: 130,987; 2,374 (128,613); 8,753 (119,860); 355 (119,505); 41 (119,464); 0 (119,464).
  `R_design` L 7,052, F 8,209; `R_test` L 8,148, F 9,373 (the L figures match plan 2.12). `scored_test` L 59,448, F 59,451. `rising_high_test` L 911, F 959. `falling_low_test` L 12,925, F 16,295. `R_test` cells L: 1,587 / 2,586 / 2,567 / 1,408. `R_test_from1008` L 174.
  Hours with `span_h != U`: L design 32, test 55; F design 38, test 183.
  The hour grid is complete (0 gaps, 2011-12-01T05 to 2026-11-09T23, 130,987 hours). C01 to C14 have 0 violations in Python on both arms.
- Section 6 rules: production, the four hand-overs, half and half, mean of three, steady always, both sides: exact, including `w = 0` at `r = 1`, the cap and `floor(x + 0.5)`. All four `m - 1` are powers of two, so the weight is exact in both languages.
- Section 7 A1: populations, the three errors, the ratio groups and the five splits: exact. Spell age matches the plan's levels. A2: deviates until finding 1 is applied.
- Section 8: population R, `d`, measures, splits (halves, season, cells, raised and lowered, with and without 2026-10-08), the control, the timing check, the "also reported" rules: all present. Quarters: only partly (finding 12). Step at 25,000 cfs: present.
- Section 9 criteria: 1, 3, 4, 6, 8 exact, including every inequality (`<= -0.25`, `< 0`, `<= 0`, `<= 0.5` points, `< 0`). Criterion 2: see finding 9. Criterion 5: see finding 2. Criterion 7: see finding 10.
- Verdicts: order NOT_SUPPORTED, FAIL, PASS, GAIN_WITHOUT_ONSET, UNCLEAR. FAIL and PASS (or GAIN) cannot both hold, since criterion 1 implies `hi < 0` and mean `<= -0.25`. So the only order that matters is NOT_SUPPORTED first, which the plan's A2 requires. Correct. `flag_unclear_cell` turning PASS and GAIN into UNCLEAR and leaving FAIL alone matches the plan.
- Tool check (plan 9, last line): C14, correct after finding 4.
- Section 17: T4 (span) handled as ruled; T5 note present (7.1); arm F regression and rows checked are not the analysts' business.
- Additions beyond the plan, all harmless and labelled as reported: `R_span_usual` rows, `stepb_main` for arm F beyond `R`, `step_at_25000.csv` details, the C checks.

## Point 2. Ambiguity hunt

Closed by findings 3 to 11, 14, 15, 17, 20. Other places I read as a hostile implementer and found closed: blank handling (1.3, `na.strings = character(0)`), string periods, the hour key (verified, including `K(2011-12-01T05) = 367421` and 130,987 hours to the end), group edges, the `corrR > corrS` split, file order, `%.6f` (Python and R agree on the cases I tried, including `-0.000000` and values near a sixth-decimal half), negative zero (normalised), `\n` endings, integer division for block indices.

## Point 3. Arithmetic and unit tests

Every worked value of section 5 is correct in Python and in R (scratch `units.py`, `units.R`):
`floor(x + 0.5)`: 1, 2, 3, 0, -1, 8, 9. Keys: 438288, 376200, 498407, 0. `unit_rule`: w 0.5, 200, 2800; 0, 100, 2900; 1, 300, 2700; cap 2400, shown 2400; no cap 2800; mean of three 116.66666666666667, 2884; steady 2900; falling `rf` 2.5, `w` 0.75, correction -12.5, shown 3013. Groups and spell ages as stated (spell: `-, 1, 2, 3, -, 1, 2, 1, 2`). Percentile on 1..10000: 250.975 and 9750.025 (R prints 9750.0249999999996; within 1e-9). Boot index: 0, 82, 3, 28, 9.
Edge cases and their values: finding 14.

## Point 4. Bootstrap

- The statistic `num / den` is defined for every listed interval whenever `den > 0`; the skip rule handles the rest. Expected blanks: `I16` only (finding 16). Every other population lies in at least 27 months (`R_eel`), cells in at least 41.
- One fixed list of months for every population: sound. For a sub-population that lives in some months only, a draw is a random number of its months, drawn with replacement; that is a valid block bootstrap of a ratio mean with random size, slightly wider than one restricted to its own months. It matters for the decision only through the cell intervals (crit 2) and `I01`, `I17`, whose populations cover 41 to 83 months.
- Percentile rule: exact and identical in both languages (verified on 1..10000 and on a single value).
- Mapping: `(n * B) // 10^12` gives the same index in Python and R for all 10,000 × 83 month cells and all 10,000 × 28 quarter cells (scratch: full comparison). Range 0 to 82 and 0 to 27. Each month is drawn between 9,806 and 10,240 times over the whole file.
- `tools/make_boot_uniforms.py` rerun into the scratch folder: SHA-256 `71d75af9b10c1ba4d3d9492f0e07d17497a35e01d3568d9b3ed8ab8fe528d515`, 13,000,392 bytes. Same as the specification and as `tools/boot_uniforms.csv`. The shadow files' SHA-256 and sizes also match section 1.1.

## Point 5. Number representation

Finding 3. Short answer: R and Python disagree on 9.4% of the distinct long decimals, by one unit in the last place. On these files that flips no shown value, tie, group, or check C09 or C12. The `err = ±15` boundary is the one place I could not test without computing errors, and a flip there would exceed 0.01 in a share. The rule "decide on written values" protects the criteria against last-bit noise in means, but not against a flipped count. Remedy (a) or (b) in finding 3.

## Point 6. Blindness

Finding 18. No hint of an expected direction in the specification or the tools.

## Point 7. Compare tool

Finding 8. It does catch: missing files, header differences, row count differences, key or order differences, values beyond 0.01, format (decimal count) differences, `NA`, `NaN`, `inf`, CR, missing final newline, BOM, wrong field counts, an empty folder, a one-sided extra `.csv`. It also gives `DIFFER` when the run stopped after `checks.csv` (the other files are missing on both sides).

## Point 8. Feasibility

All 13 outputs can be computed from the two shadow files and `boot_uniforms.csv` as they are: every needed column exists once in the header, no needed value is blank on a scored hour, `d6` and `span_h` are filled on every scored rising or falling hour, `lfCap` is above 0 on every scored hour, no number uses exponent form, no `-0` string. Run time: finding 19 (seconds, not minutes).

## Point 9. Section 15, the 27 choices

Agreed as written: 1 to 9, 11 to 16, 18, 19, 21 to 25, 27.
- 10: replaced by the author's ruling; wording in finding 1.
- 17: replaced by the author's ruling; wording in finding 2. Also the crit 2 case of an empty cell must follow it (finding 9).
- 20: add the point estimate (finding 10).
- 26: the plan's "the same with calendar quarters" reads as every interval (finding 12); rule it either way.
- 7 (edges): agreed; note the 18 rows at exactly 720 h (finding 20).

## What I could not check

- Whether any scored hour lies within about 1e-12 of `err = -15` or `+15` under any rule. That needs the error of each hour, which the limits of this review exclude. Finding 3 (a) makes the analysts count it.
- The hypothetical shown values of `step_at_25000.csv` under R parsing (HIGH2 rising hours were not in my cross-language comparison). No exact-edge `r` with a long `thr6` exists, so `r < m*` cannot flip, but the floor of the hypothetical value was not compared.
- R on an x86 machine (where `sum()` uses long double). The study runs on this arm64 machine.

---

# Second pass (version 1.1)

READY

Specification read: `ANALYSIS_SPEC.md` version 1.1, SHA-256 `a202bdef40deae330217447b4c20045f9dbd49fa719c4159ca403d505a9282c2` (verified). Version 1 is unchanged as `ANALYSIS_SPEC_v1.md`.
I read the whole of version 1.1, not only the diff. Every one of the 40 changed hunks of `diff ANALYSIS_SPEC_v1.md ANALYSIS_SPEC.md` falls in a passage I read and checked.
Same limits as the first pass. No error of any estimate was computed on the real data.

The verdict READY means that nothing left open can make the analysts compute the wrong thing, make the two differ beyond 0.01, or mis-evaluate the decision. Three small points remain (S1 to S3 below). S1 is a one-word fix that can be made at any time. S2 and S3 concern the compare tool, which the analysts never run, so they can be fixed before the comparison, after the analysts start.

## 1. Status of the 20 findings

| # | Status | Where in version 1.1 |
|---|---|---|
| 1 Tie rule | RESOLVED | 7.2 (lines 265 to 271), `mstar.csv` (12.6), ruling 15.10, 15.11. Wording as proposed; `m_second` etc. always describe `b2` |
| 2 Criterion 5 empty | RESOLVED | 10.3 item 5; exception in 10.1; ruling 15.17 |
| 3 Parsing | RESOLVED (remedy a) | `C15_parse_margin` in 6; section 13 rewritten. See S4 for one loose sentence |
| 4 C14 count | RESOLVED | C14 lists 11 variants, `n_checked` = 11 x scored; C13 `n_checked` defined |
| 5 Summation order | RESOLVED | 4.4 (explicit loop, no `sum()` in Python, no `mean()` etc. in R), 9.3 (order of `num`, `den`; `S_j`, `N_j` once per row), 13 |
| 6 R integer output | RESOLVED | 11, third bullet |
| 7 C01 in R | RESOLVED | 0, R bullet (`count.fields`) |
| 8 Compare tool | RESOLVED for all five cases; new minor gaps S2, S3 | `tools/compare_analysts.py`, section 14 |
| 9 Criterion 2 | RESOLVED | 10.3 item 2, ruling 15.16. Small wording point S5 |
| 10 Criterion 7 | RESOLVED | 10.2 (`hh_est`), 10.3 item 7, `decision_inputs.csv` (25 rows), ruling 15.20 |
| 11 `est` | RESOLVED | 9.3 |
| 12 Quarters | RESOLVED | 8.2, `intervals.csv` I25 to I38, ruling 15.26 |
| 13 `mstar.csv` semantics | RESOLVED | 7.2 |
| 14 Unit tests | RESOLVED | 5 (header line, new cases in `unit_rule`, new `unit_periods`) |
| 15 R environment | PARTIAL | 0 line 33 and 1.1 resolved; line 40 still says `Rscript r/run_all.R` (S1) |
| 16 I16 blank | RESOLVED | 9.3 (also `I38`) |
| 17 Block assert | RESOLVED | `C16_blocks_cover` (stops), 9.1 |
| 18 Blindness | RESOLVED | section 15 now rulings only; `SPEC_REVIEW.md` and `ANALYSIS_SPEC_v1.md` added to the forbidden list |
| 19 Performance | RESOLVED | 9.3 |
| 20 Wording | RESOLVED | 3 (line 108), 7.1 (720 h, blank level), 10.1 (`as.numeric`) |

The writer's own two choices: C15 over production plus the 11 variants, and the ratio part over all four `m` (independent of `m*`): sound, and better than my wording, because the check is then computable before step A. C16 stopping the run: sound.

## 2. New problems, contradictions, counts

Counts, each recomputed from the definitions (and the compare tool's own expected-key lists assert the same lengths at import):
- `checks.csv` 40 = 8 unit tests (same 8 names, same order in 5 and 12.1) + 16 checks x 2 arms. Correct.
- `intervals.csv` 38 = 24 + 14 (I25 to I38 are the quarters of I03 to I16, in order). Correct. Ruling 15.26 lists the quarters rows as `I02, I18, I20, I22, I24, I25 to I38`: correct.
- `decision_inputs.csv` 25 (`hh_est` before `hh_ci_hi`). Correct.
- `row_accounting.csv` 12, `populations.csv` 44 (22 per arm), `a1_tables.csv` 126 (18 levels x 7), `a2_pick.csv` 8, `mstar.csv` 9, `stepb_main.csv` 20 (16 + 4), `stepb_rules.csv` 8, `both_sides.csv` 6, `step_at_25000.csv` 6, `decision.csv` 12. All correct.
- C13 `n_checked` = 5 x scored R + 4 x scored falling LOW4; C14 = 11 x scored; C15 = 12 x scored + 4 x `rising_high_test`; C16 = scored test hours. Unambiguous.
- `I38` (quarters of `R_from1008`): its population lies in 2026Q4 only; 3,635 of the 10,000 draws contain no 2026Q4, so its bounds are blank, as 9.3 says. No other quarters row is expected to be blank (the smallest other populations span at least 41 months).

Points found:
- **S1. MINOR. Contradiction in section 0.** Line 33 says `Rscript --vanilla r/run_all.R`; line 40 still says `Rscript r/run_all.R`. On this machine there is no `.Rprofile`, `.Renviron` or site profile, so the result is the same either way. Replacement for line 40: "`python3 -I py/run_all.py` or `Rscript --vanilla r/run_all.R`".
- **S4. MINOR. One sentence of section 13 overstates.** "With the stated order the two languages add the same doubles in the same order." The order is the same, but the doubles are not always the same: about 9% of the long decimals parse one unit apart (the next bullet says so). Replacement: "With the stated order the two languages add the same terms in the same order; the terms are identical doubles except where the parsing difference of the next bullet reaches them, which moves a sum in its last bits only."
- **S5. MINOR. Criterion 2's closing parenthesis.** "`crit2_no_harm_by_cell` = 1 if no cell has `fail_c` (and no cell is empty)" leaves out the `mae_prod == 0` case, which the first sentence already sends to 0. Replacement for the parenthesis: "(and no cell is empty or has `mae_prod` 0)". No reader can reach a different value from the current text, because the first sentence governs.
- No new place where the two analysts could differ. C15 compares `abs(err ± 15)` with a window of 1e-9, far wider than the 1e-13 parsing noise, so the two counts agree unless a pair sits within 1e-13 of the window edge. The new unit cases, `unit_periods`, the tie rule, criterion 2, criterion 5 and criterion 7 are all stated as exact tests.
- The decision logic is unchanged apart from findings 1, 2, 9 and 10. I re-traced it. NOT_SUPPORTED, FAIL, PASS, GAIN_WITHOUT_ONSET, UNCLEAR, first hit wins. FAIL and PASS or GAIN cannot both hold. `flag_unclear_cell` blocks PASS and GAIN only. Criterion 2 = 0 on an empty cell also blocks PASS and GAIN. This matches the plan and the rulings.

## 3. Added unit-test values, recomputed

Python 3.14.7 and R 4.5.2 (scratch `u2.py`, `u2.R`), same results in both:
- `r = m`: `w = 1`, shown 2700 for each `m`.
- `d6 = 125, thr6 = 100`: `w` 0.5, 0.25, 0.125, 0.0625; correction 200, 150, 125, 112.5; shown 2800, 2850, 2875, 2888.
- `d6 = 300, thr6 = 120`: `w` 1, 1, 0.75, 0.375; shown 2700, 2700, 2750, 2825.
- Exact halves: 2901, 0, -1 (the same with `lfCap = 0` and with `lfCap = 3300`, so "no cap" cannot be read two ways).
- `lfCap = 2400`: steady 2880, production with `w = 1` 2700. `lfCap = -5`: 2700. Negative correction: 3050.
- Falling: tie 2900; far fall `w = 1`, 3050.
- Error boundary: -15, 15, -15 exactly in both languages.
- `unit_periods`: every stated label is correct in both: design and test; half1 and half2; noneel, eel, eel, noneel; before1008 and from1008. Quarters are `2020Q1`, `2020Q2`, `2026Q4`. Month index is 0 for 2020-01 and 82 for 2026-11. Quarter index is 27 for 2026Q4. There are 83 months and 28 quarters. (In R, `Sys.setlocale` prints `[1] "C"` when called at top level; this is harmless.)
- The first-pass values (round, key, the first `unit_rule` cases, groups, spell, percentile, boot index) are unchanged and were verified in the first pass.

## 4. Compare tool, re-tested

Scratch `ct2.py`: I generated complete made-up file sets from the tool's own expected keys and the headers of section 12, then changed one thing at a time.
The five earlier false AGREEs now give DIFFER:
- `-nan` on both sides;
- `1e+05` on both sides;
- a leading space, and a leading plus sign, on one side;
- a duplicated row, and a missing row, on both sides;
- `decision_inputs.csv` within 0.01 (exact text now required).
Also DIFFER, correctly: `NaN` on one side, `Infinity` on both, a tab on both, a blank against a number, a lower-case verdict, an extra column. Expected row counts and key order in the tool match version 1.1 exactly (I checked `_intervals()`, the 25 decision inputs, the 16 checks and 8 unit tests, the 44 populations, the 126 A1 keys).
Still AGREE, which it should not be (none can change a verdict; all need the same format error on both sides, or are visible as `BYTE-IDENTICAL: no`):
- **S2. MINOR. Headers are not checked against section 12.** A column name misspelt in the same way on both sides gives AGREE. Fix: an `EXPECTED_HEADER` per file, compared as text.
- **S3. MINOR. Field format is not checked against section 11 when both sides make the same mistake, and quotes are not detected.**
  - These pass when they appear on both sides: an integer written `8148.0`, `-0.000000`, `0.500` (3 decimals), `1_000.500000`, `0x1p-1`.
  - A quoted field `"L"` gives AGREE whether it is on one side or both, because `csv.reader` removes the quotes. This is the one realistic case: R's `write.csv` quotes text by default.
  - Fixes:
    - Report any `"` in the raw bytes as a difference.
    - Check each non-key field: a count or flag column must match `^-?[0-9]+$`, a decimal column `^-?[0-9]+\.[0-9]{6}$`, or be blank, and `-0.000000` is a difference.
    - The column types follow from section 11. `checks.csv`, `row_accounting.csv`, `populations.csv`, the `n*` columns and `n_valid`, `n_skipped` are integers; `mstar.csv` and `decision_inputs.csv` follow their stated types; `decision.csv` is 0/1 or a verdict word.
Within-tolerance differences in files other than the three exact ones still give AGREE with `BYTE-IDENTICAL: no`, as section 14 says. That is by design.

## 5. Blindness of version 1.1

No sentence states or hints at an expected direction or result.
- The new change log at the top describes rules only.
- Section 13 gives parse facts and the size of `R_test` (8,148). That is a count already in `populations.csv`, not an outcome.
- Section 15 is now rulings only.
- The forbidden list now names `SPEC_REVIEW.md` and `ANALYSIS_SPEC_v1.md`.
- The compare tool's new code and docstring contain no hint.
- This second-pass section quotes no expectation of the plan.

## 6. Still not checked

Unchanged from the first pass. First, whether any hour sits within about 1e-12 of `err = ±15`; C15 now makes the analysts count it. Second, the floor of the hypothetical shown values of `step_at_25000.csv` under R parsing, which C15 does not cover. These are 911 test hours at 25,000 cfs and above. No `r` there lies near an `m` without being on it, and production's `v + 0.5` is at least 4.5e-6 from an integer on every scored hour. A flip would change `n_hyp_changed` by 1 and would show as DIFFER in a reported-only file, never in the decision.

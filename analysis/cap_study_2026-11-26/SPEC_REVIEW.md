READY AFTER CHANGES

# Review of ANALYSIS_SPEC.md version 1.0 (cap study)

Reviewer: independent, Opus. Written 2026-11-27. The spec was read against PLAN.md version 2 (sections 3 to 8, 11, 17), the onset spec version 1.2 and its review, the replay tool, and the five data files.

Nothing on the real data below is an error of an estimate against the truth. What I computed on the real files: counts of hours in populations, blanks, formats, shown values under two parsers (no truth involved), the truth rebuilt from the hourly file compared with `truthFlow` (truth against truth), and the shifted-truth missing and range counts. My scripts are in `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/cap_spec_review/` (`data_counts.py`, `gate.py`, `gateF.py`, `mr.py`, `mr2.py`, `checks2.py`, `rparse.R`, `rparseF.R`, `cmp.py`, `shown_cmp.py`, `shown_cmpF.py`, `myunit.py`, `myunit.R`). I did not reuse the writer's `unit.py`.

No blocker. Two major findings, twelve minor.

## Findings

### 1. MAJOR. Section 19 (lines 592 to 594): the compare contract cannot be implemented without guessing.

Evidence. "The key columns (the text and integer columns before the first `%.6f` column of each file ...) must equal the expected values and order." By that rule `n` is a key column of `rule_tables.csv`, `intervals.csv`, `cap_description.csv`, `cap_classes.csv`, `rises_test.csv`, and `n_all` of `timing_candidates.csv`. These are data, and the spec gives no expected value for them. Other key values are known only after the run: `rule` of `S01` to `S03` (the pick, or blank), and `event_id`, `event_t0` of `rises_test.csv` (from the events file). Second gap: `timing_pick.csv` is in the numeric fall-back group (step 2), but its `value` column mixes integers (`c5_n_rl`), `%.6f` numbers and words (`pass`, `KEEP`). Step 2 says "every integer and text column equal as text; every `%.6f` column within 0.01", which is defined per column, not per cell. Third: the exponent guard of step 4 cannot be applied to whole rows ("no exponent form") because text fields such as `rl_large_lfled` or `2015-06-20 12:00` hold the letter e; it must be applied to numeric cells only.

Replacement for item 1, last sentence: "The key columns of each file, which must equal the expected values in the expected order, are: `checks.csv` `check,arm`; `row_accounting.csv` `arm,step,condition`; `populations.csv` `arm,period,item`; `rule_tables.csv` `arm,period,population,rule`; `cap_description.csv` `period,group`; `cap_classes.csv` `period,item`; `intervals.csv` `id,period,population,x` (and `rule` for `I01` to `I32`; for `S01` to `S03` the two sides must agree with each other and with the `pick` row of `decision_inputs.csv`); `pick_design.csv` `rule,tie_order`; `decision_inputs.csv` `name`; `decision.csv` `item`; `rises_test.csv` `event_id,event_t0,rule` (the two sides must agree; the tool does not read the events file); `timing_gate.csv` `key`; `timing_candidates.csv` `shift,rule`; `timing_pick.csv` `shift,item`. All other integer columns are data and are compared as text in step 2."
Add to item 3: "In a key-value file and in `timing_pick.csv`, a cell is typed by its text: a cell matching `^-?[0-9]+\.[0-9]{6}$` is a decimal (tolerance 0.01), a cell matching `^-?[0-9]+$` is an integer (exact), anything else is text (exact)."
Add to item 4: "The exponent, `NA` and `inf` guards apply to every cell that is not a key or text value; a cell that is a number must match `^-?[0-9]+(\.[0-9]{6})?$`."
Also add: "A `.csv` present on both sides but not in section 17 is ignored."

### 2. MAJOR. Section 4.3 MR step 4 (line 131) and ruling 5 (line 607): "has an estimate" is read as `status == "predicted"`, which drops rows that do have an estimate. The plan does not settle this; the orchestrator must decide.

Evidence (`mr.py`). In arm L, Row(h) is not `predicted` on 120 design and 70 test scored hours. The 120 design cases are `no_por` (71) and `no_lf` (49) rows, which have blank `rawUnc` and `corrUsed`, so they have no estimate under any reading. All 70 test cases are `no_truth` rows. Every one of the 939 `no_truth` rows of the file has `rawUnc`, `corrUsed`, `lfCap` and `lfSrcTs`. Its estimate exists; only its own truth was not found. PLAN.md 4.1 says "If that row has no estimate ... production". Under the reading "rawUnc and corrUsed non-blank, any status", the fall-back count is 120 design and 0 test, and `mr_differs` is 1,903 and 2,122 (`mr2.py`), against 120 and 70, and 1,903 and 2,121 under the spec. The spec's reading matches the counts in PLAN.md 4.1 ("falls back to production on 120 and 70"), so the orchestrator's own count used it. But it makes MR depend on whether an earlier hour later found its truth. That is information a browser or server build would not use, and it is the only place where a rule depends on a truth-side status.

Recommended (if the orchestrator agrees): line 131: "4. `Row(h)` has no estimate: its `rawUnc` is blank or its `corrUsed` is blank (any status)." Ruling 5: "'has an estimate' means `rawUnc` and `corrUsed` non-blank, any status." C15: MR fall-back test 0 (design stays 120); MR differs test 2,122. If the orchestrator keeps the spec's reading, add one sentence that says it is deliberate. Either way, the change is to the frozen text before any result exists.

### 3. MINOR. Section 18, parsing bullet (line 568): the list of affected columns is incomplete, and a cheap remedy makes the errors bit-identical.

Evidence (`rparse.R`, `cmp.py`, arm L, all rows). R gives a different double than Python on: `corrUsed` 13,870, `errPctCorr` 13,497, `rawUnc` 13,105, `travelGFtoLF` 12,114, `truthFlow` 324 (always one unit in the last place). `lfCap, lfQ, age_lf_h, d6, span_h, porQ, tempC, predictedCFS` never differ. The spec does not name `travelGFtoLF`, which feeds LF3, LF6, MR and UP.
What this does (`shown_cmp.py`, `shown_cmpF.py`): with R's doubles in place of Python's, the shown value of every one of the 17 rules is identical on every scored hour of both arms (119,447 and 119,464). `h` of MR is identical everywhere, the capped test is identical everywhere, and no `T + a` lies within 1e-9 of a half-integer. So the only R-side difference that reaches an error is `truthFlow` on 324 rows. For none of the mis-parsed truths (either arm) is `0.85 * t` or `1.15 * t` within 1e-6 of an integer. Since a shown value is an integer, no rule's error can sit at -15 or +15 on those hours. On these files no class can flip between the languages. What remains is last-bit noise in sums. That keeps every number within 0.01, but it can in principle change a sixth decimal in the six byte-exact files.
Remedy (recommended): use the rebuilt truth everywhere. The gate of 12.2 passes with EXACT equality in Python on every scored hour of both arms (`gate.py`, `gateF.py`: 0 failures, 119,447 and 119,464 exact). `lf_discharge` holds short decimals, which R parses exactly, and the interpolation is the same IEEE operations in both languages. Text: "Section 2a. After the scored hours are fixed, compute `truth(tau0)` of 12.1 for every scored hour of both arms. Check C16_truth_rebuilt (L, F; stops the run): `truth(tau0)` missing or `abs(truth(tau0) - truthFlow) > 1e-6 * max(1.0, abs(truthFlow))`. In every error of this study, `truth` is `truth(tau0)`, not the parsed `truthFlow`." Then the gate of 12.2 is always passed when the run gets that far (keep `timing_gate.csv` as is), and section 18 can say: "The errors are bit-identical in the two languages: the shown values were verified identical under both parsers, and the truth comes from exactly parsed short decimals."
Whether or not the remedy is taken, replace the second sentence of the bullet with: "On the shadow files, R's `as.numeric` gives a different double (one unit in the last place) for `rawUnc`, `corrUsed`, `travelGFtoLF`, `errPctCorr` (about 10% of rows each) and `truthFlow` (324 rows of arm L); `lfCap, lfQ, age_lf_h, d6, span_h, porQ, tempC, predictedCFS` parse identically. The reviewer verified that the shown value of every rule is identical under both parsers on every scored hour of both arms, and that no mis-parsed truth admits an error of exactly -15 or +15."

### 4. MINOR. Section 15, M1 and M4 (lines 524, 527): both count exact hits, which are deterministic, so M4 is large on every run and tells nothing.

Evidence (`shown_cmp.py`): with integer `L`, `1.25 * L`, `1.75 * L`, `1.5 * L` are often exact half-integers, and `1.1 * L`, `1.3 * L`, `1.35 * L` are often within 1e-9 of one. M4 as written counts 1,034 (T110), 1,450 (F125), 787 (F135), 303 (F130), 223 (F175), 175 (F150), 3 (F140) pairs on arm L, and similar on arm F. These values come from exactly parsed `L` and literal constants and are identical in both languages. M1 likewise counts hours where an integer truth gives an error of exactly 15 (as in the unit test 850 against 1000), which is also deterministic. Replacement: M1 counts pairs with `0 < abs(abs(error) - 15.0) < 1e-9`; M4 counts pairs with `0 < abs(z - floor(z + 0.5)) < 1e-9`. Add two more rows that report the exact hits (`M1x`, `M4x`) as information. With finding 3's remedy, the only risky inputs left are `u` and the limits, which were verified.

### 5. MINOR. Section 12.3 (line 350) and ruling 18 (line 620): the sentence on the flags contradicts the counting rule next to it.

The orchestrator's ruling says "an hour whose shifted truth is missing, or fails the same range check the tool applies to the truth, is left out of that table and counted". The spec does this (`n_range`, range 500 to 500,000, as in `replay_onset.mjs:48`, `:564`). So in substance the spec follows the ruling. But the sentence "the hard flag and the range flag of the file are NOT recomputed" reads as if the range check were not applied. What is true: the scored set stays the one defined by the file's flags for the unshifted truth (no hour comes back in), and the shifted value must also pass the range check. The hard flag (the tool's Checks 2 and 3) needs the stage, Edwards Ferry, temperature and the ice rule at the shifted time. The spec cannot recompute it from its inputs, and the ruling did not ask for it.
Replacement: "The scored set is the one of section 2 (built with the file's flags for the unshifted truth); no hour is added. On top of that, a shifted hour is left out when `v` is missing (`n_missing`) or `v` is outside the range of 12.1 (`n_range`, counted only when not missing). The hard flag of the tool (Checks 2 and 3) is not recomputed for the shifted truth; this is a stated limit of the timing tables. Production and the rule are scored on the same reduced hour set, and every population, including `test_half1`, `test_half2`, `high_water` and `low_water`, is intersected with it." Facts for the orchestrator (structure only): arm L test hours left out are 143 + 3 (shift -1), 132 + 4 (+1), 274 + 7 (+2).

### 6. MINOR. Section 12.3 (line 353), ruling 18: arm F is not shifted, so condition 7 is the same number in all three timing tables.

PLAN.md section 8 says "the step B table is computed three more times". Condition 7 belongs to that table. Arm F's truth comes from the same hourly file. The gate passes exactly on arm F too (`gateF.py`), and its missing counts are similar (143 + 3, 134 + 4, 275 + 7). Recommended: shift arm F as well, gate it the same way, and fill `c7_off_diff_rising_F` of `timing_pick.csv` from the shifted arm F. Effect: report-only tables. The timing flag uses condition 1 only, so it is not affected. If the orchestrator keeps the spec's choice, add to 12.3: "This differs from a full re-computation of step B: condition 7 is not shifted."

### 7. MINOR. Section 12.4 (line 359): `timing_flag` is undefined when the shift -1 value is blank.

Add: "If `c1_off_diff_rising` of shift -1 is blank, `timing_flag` is blank."

### 8. MINOR. Section 12.1 (line 328): the replay tool keeps only `lf > 0` in the Little Falls map (`replay_onset.mjs:373`); the spec keeps every non-blank value.

No effect on these data: no non-blank `lf_discharge` is 0 or below. Add to C13: "a non-blank `lf_discharge` that is not `> 0` is a violation", so that the two rules stay provably the same.

### 9. MINOR. Section 6.1 (lines 200 to 202), writer decision 10: a rise takes the period of its `event_t0`, its hours take their own. Nothing checks that the two agree.

On these data they agree: no limb crosses 2020-01-01. The last design limb ends 2019-11-01 22:00 and the first test limb starts 2020-11-11 17:00. Add to C14: "plus one violation for every scored hour of `rl_large` (either arm) whose own period differs from the period of its rise." Then `rl_large` of the test period is exactly "the 452 hours of the 13 test rises" of PLAN.md condition 5.

### 10. MINOR. Section 9 (lines 250 to 258): the pick runs on unrounded doubles, but `pick_design.csv` holds only `%.6f` strings, so a hand audit can disagree.

A `mean_d_all` of `+4e-7` is written `0.000000`. An auditor reads it as qualifying; the double says it does not. All `off_rising` values share one `n` (the rising design hours of arm L), so the comparisons can be made on exact integers. Replacement: "`c_off(X)` = the count of badly-off rising design hours under `X`; `n_r` = the number of rising design hours. Leader = the smallest `c_off`; tied if `1000 * (c_off(X) - c_off(leader)) <= n_r`; pick if `c_off(first tied) < c_off(P)`. Qualify on the double `mean_d_all(X) <= 0`." Add columns `c_off_rising`, `n_rising` and `mean_d_sign` (-1, 0, 1 from the double) to `pick_design.csv`, and `P_c_off_rising` to `decision_inputs.csv`. This is the same rule as the plan's, made exact. On these data the integer form and the double form cannot differ (0.1 points is 9.272 hours, never an integer difference), so the risk is only to the audit, not to the result. M5's second half can then be dropped.

### 11. MINOR. Free structural checks are missing (result-blind; they catch coding errors).

Every candidate's limit is at least production's on every hour (true for LF3, LF6, MR, UP by `max(L, g)`, `max(1.0, ratio)`, `p > 0`, and for the rest by construction). Add a stopping check `C17_monotone` (L, F; per period and candidate) with these violations: `shown(X) < shown(P)` on any scored hour; `n_differ` > 0 outside `capped`; `low_diff > 0`; `high_diff < 0`. In `cap_classes.csv` the cells `no_low__cap_within`, `no_low__cap_high`, `no_within__cap_high` are 0 by construction (on a capped hour `shown(N) >= shown(P)`). Say so in 8.2 so that a reader does not take those zeros as a finding, and add them to the same check.

### 12. MINOR. Section 7.2 (line 230): for `P`, `mae_rel` "is 0", but the general rule says blank when `mae of P == 0`.

Replace with "For `P` and `P_icet_hours`, `mean_d` and the three differences are 0 and `mae_rel` is 0, each blank when `n = 0`; `mae_rel` is also blank when `mae of P == 0`." No reader can reach another value on these data. The sentence only removes the conflict.

### 13. MINOR. Section 14.3 (line 448): the MR case `rawUnc = 5100` is not a fall-back step.

There the rule runs to its formula and returns `1.2 * 1.0 * L`. The test is right (1800, 1800), but an analyst who also tests a "fell back" flag (used for `mr_fallback` in C15 and `populations.csv`) will expect 1. Add: "(this case is not a fall-back step; it does not count in `mr_fallback`)."

### 14. MINOR. Section 10.2 (line 268): with no pick, step B has no named rule at all.

PLAN.md section 7 says "the verdict is KEEP and step B is reported as description only". The spec blanks every decision input. The test-year description is still in `rule_tables.csv` and `I13` to `I32`, which is enough for a reader. If the orchestrator wants the description to name a rule (for example the first tied candidate), that has to be added now. Otherwise leave it as written and add one sentence: "With no pick, step B's description is the candidates' rows of `rule_tables.csv` and `I13` to `I32`."

## Answers

### A. Faithfulness to PLAN.md version 2

Rules (4.1, 4.2): every formula matches the plan, including `T + a`, the real `e`, the 2.00 ceiling, ICE in all years, and ICE-T from 2021-05-07 with the month rule on blank temperature. The populations (section 5), the measures and the `d` definition, the badly-off threshold at 15 on both sides, the description groups and their reading (section 6), the reach, the 3 by 3 table, the pick (section 7), the nine conditions with their thresholds 1.0, 0.05, 0.5, 1.5, 5% (section 8), the halves at 2023-06-01, the verdicts and the per-rise count all match. Departures:
- MR "no estimate" read as status `predicted` (finding 2). Changes MR on 70 test hours, one shown value.
- Arm F not shifted in the timing tables (finding 6). Report-only, changes condition 7 there only.
- The hard flag is not recomputed for a shifted truth (finding 5). Report-only; a stated limit, consistent with the ruling.
- The truth map omits the tool's `lf > 0` filter (finding 8). No effect on these data.
- Additions that change nothing: the `P_icet_hours` row (decision 2); `low_water` equal to `bin_0-3000` (decision 1); the halves as periods; blank T, a or `lfSrcTs` gives production and stops in C06 (decision 4; none occurs, C06 covers `age_lf_h`, `travelGFtoLF`, `lfSrcTs`); UP production on blank `porQ` (none on scored hours).
- Decision 3 (`(100 * (cX - cP)) / n`) is the same number as the difference of shares in exact arithmetic and is the better form. Decision 8 (`off_diff <= -1.0`, `mae_rel <= 0.05`) is the plan's wording. Decision 9 matches section 8 (see B iii).

### B. The four named points

(i) Every rule on every scored hour. Yes. P, the fixed factors, RIS (needs `flowState`, non-blank by C06), ICE (needs `predTs`), N: always defined. LF3, LF6, MR, UP: every blank or absent input leads to a stated production fall-back. My count shows none of these blanks on a scored hour except `d6`/`span_h` (498 design) and Row(k) gaps, all handled. ICE-T: defined from 2021-05-07, blank `tempC` gives the month rule (24 test hours of arm L). Blanks are alike in both languages: R reads every column as text with `na.strings = character(0)`, so a blank stays `""`, and every rule tests blankness before parsing. I ran the rule cases in R (`myunit.R`) and got the same limits and shown values as in Python.
(ii) MR in the tie order. Correct: F135, F150, LF6, LF3, MR, UP, RIS, F200, ICE, N, with MR after LF3 as in PLAN.md section 16 (own addition to F4). `tie_order` 5. Unit table T3 tests LF3 against MR and UP when all three are tied; the result, LF3, is right.
(iii) KEEP wording. Correct. "No pick" gives KEEP. Then BETTER_RULE_FOUND if all nine pass. Then KEEP if `c1_ci_hi` is blank or `>= 0`, which is exactly "the interval includes 0 or lies above it" (both mean the upper bound is not below 0). Then UNCLEAR. The two KEEP routes cannot collide with BETTER_RULE_FOUND, because condition 1 needs `c1_ci_hi < 0`. Also checked: the sub-case of section 7, "pick's share not below production's", is folded into "no pick", as the plan says. "Blank bound counts as including 0" is the spec's own choice; it can arise only if more than 500 draws are skipped, which cannot happen on the rising test hours.
(iv) Gate and missing hours. The gate is as ruled: `|rebuilt - truthFlow| <= 1e-6 * max(1, |truthFlow|)` on every scored hour of arm L, a missing rebuilt value counts as a failure, and a failure suppresses the shifted tables (files with header only). The gate passes on these data with exact equality on all 119,447 hours, and also on arm F. Missing and out-of-range shifted hours are left out and counted, missing first. Wording fix in finding 5, timing-flag blank in finding 7.

### C. Determinism

Carried over from the onset spec: `colClasses` text reading, `count.fields` for C01, the explicit summation loops, `%d` and `%.6f` writing, the `-0.000000` normalisation, `LC_COLLATE` C, the integer time algorithm, block counts once per draw, the hand-written percentile, and decisions on written strings. Gaps a careful pair could implement differently: the compare tool's key columns and cell types (finding 1); `timing_flag` with a blank input (7); the shifted-run hour sets for P and the populations (5); the MR fall-back flag in the unit cases (13); `mae_rel` of P when `mae of P == 0` (12, no effect). Row order, period order, tie handling (`<=` on one subtraction), equality of the leader (first in candidate order) and the percentile rule are exact. On R's `as.numeric`: the onset spec chose "count the pairs at risk" and this spec carried that over (M1 to M5), but it left `travelGFtoLF` out of the description. M1 and M4 as written are dominated by exact, deterministic hits. On these files no flip can happen (finding 3, with evidence). What the spec should say: take the rebuilt truth as the truth (exact in both languages), keep M rows only for non-exact near misses, and correct the list of columns. A hex companion file (the onset reviewer's remedy b) would also work, but it needs a new tool. The rebuilt truth needs nothing new.

### D. Unit tests

I recomputed every expected value of section 14 in Python (`myunit.py`) and in R (`myunit.R`). The R run covered all 12 rule-case groups of 14.2 (base row, LF3 changes, the ceiling cases, both MR `h` cases, rounding), all ICE and ICE-T cases, the three pick tables at every `P` given, set A of the verdict with all 19 changes, the seven label cases, the truth cases, the percentile, the block index, the keys and `mic`. All agree with the spec: the limits (including `2104.6153846153843`, `2128.9036544850496`, `2045.4545454545457`, `2418.75`), the shown values, the fall-backs (all 30 cases give 1800, 1800), `-15` and `15` exactly for the three error cases, every value of `unit_measures`, the pick (6 qualifiers, leader UP, tied F150/LF6/UP/ICE, pick F150 only at P 20.0; T3 pick LF3), every verdict, every label, the truth values `1250, 1000, 1500, 1000, 2000, 4000, missing`, the percentile `250.975` and `9750.025` (Python gives `250.97500000000002`, inside 1e-9), the block indices `84, 82, 3, 29, 28` (the first cell of `boot_uniforms.csv` is `343638232196`), the keys and the time values. No wrong case. One ambiguity: finding 13. Note for the R analyst: `sprintf("%.6f", -0.0000001)` gives `-0.000000` in R, so the normalisation of section 16 is needed, as `unit_mic` tests.

### E. Checks on the real data

All 26 C15 counts reproduce exactly with my own script from the spec's text (`data_counts.py`): scored 59,999 and 59,448; capped 2,137 and 2,511; rising 9,272 and 9,059; capped rising 1,238 and 1,302; Little Falls rising 9,885 and 10,302; of them capped 1,296 and 1,257; `rl_large` 275 and 452; rises 8 and 13; `rl_large` capped 140 and 240; blank `d6` 498 and 0; `span_h == 0` 593 and 81; MR fall-back 120 and 70; MR differs 1,903 and 2,121. Also reproduced: 21 selected rises, no scored hour in two limbs (both arms), the class of every rise (20 `upstream`, 1 `lfled`, the 2026-10-12 rise; so `rl_large_lfled` is empty in design and `rl_large_notclassed` is empty in both periods), C04, C05, C08, C09, C11 with 0 violations on both arms (`checks2.py`), events file 47 fields on every line, ICE-T hours 47,640 with 24 blank `tempC` (test, arm L). The LF6 gap `e` is 6 hours on 59,798 of 59,999 design hours and 0 on 57; a fall-back on 37.

### F. Bootstrap and decision

The machinery is right. A share difference is a mean of `x = 100 * (ind_X - ind_P)` over the hours, so the ratio `sum c_j S_j / sum c_j N_j` is the resampled `off_diff`, and `est` equals `off_diff`. The design months (85, `u1..u85`) are used only for `I01` to `I06`, which is correct. The test months (83) are used for the rest. Skipped draws matter only for `rl_large` in design (8 rises in about 10 months of 85: a few skips at most, far under 500). All nine conditions are computable from `rule_tables.csv` and `intervals.csv`, and `decision_inputs.csv` holds every input as the written string, so the verdict can be audited by hand from `decision_inputs.csv` and section 10.3 alone. The pick can be audited from `pick_design.csv` except at a 1e-6 edge (finding 10).

### G. One-directional traps

For every candidate the limit is at least production's on every hour, so a candidate can only raise a shown value, and only on capped hours. Item by item:
- Qualify (`mean_d <= 0`), the leader and ties (`off`), the pick against P: can go either way.
- Conditions 1, 2, 5, 6, 7, 8, 9: both ways (badly off, `mean_d` and `mae_rel` are two-sided).
- Conditions 3 and 4: `high_diff >= 0` by construction, but with a positive tolerance they can pass or fail. The plan names them as cost limits.
- The three labels: `d` of N against P can have either sign on capped hours, so `good_job`, `harm` and `unclear` are all possible.
- The timing flag: both ways.
- `lower_than_P`: both ways.
- One-directional by construction, all reported as description only, never as a benefit: `low_diff` (never above 0), `high_diff` (never below 0), and three cells of `cap_classes.csv` (always 0). Finding 11 turns these into checks.
No condition of the decision is one-directional in the way the two earlier studies' were.

### H. Blindness

Nothing in the spec states or hints at an expected result. The fixed counts are structural (hour counts, blanks, fall-backs, rises). The words "expected" occur only for row counts. The unit tables are made-up numbers. This review must not reach the analysts. Section 0 already excludes every other file in the study folder.

### I. Compare contract

Not enough as written (finding 1): the key columns, the typing of mixed key-value cells, and the scope of the format guards must be stated. The rest (14 files, expected headers and row counts, six exact-text files, 0.01 tolerance, AGREE as the last line, exit status, DIFFER when a run stopped) is clear.

## What I could not check

- C10 and M1, M5 on the real data, and any statistic (they need errors or `d`). My parse argument for M1 rests on the truth values alone (finding 3).
- The bootstrap on real data and the last-bit identity of sums between the two languages. I checked the inputs (shown values identical, truth identical under finding 3's remedy), not the sums.
- The real run times in R and Python.
- Whether R's `sprintf("%.6f")` and Python's `%` give the same string at a true rounding tie. Both should round correctly on this machine; I did not test this on study numbers.
- The hard flag under a shifted truth (it needs the tool's Checks 2 and 3; see finding 5).

## Re-check of version 1.1

READY AFTER CHANGES (two one-line text fixes, below; neither changes a computed result, and no further review is needed once they are made)

Worked from `diff ANALYSIS_SPEC_v1.0.md ANALYSIS_SPEC.md`. New scratch scripts: `recheck_unit.py`, `recheck.R`, `c17.py` in the same scratch folder. No error of any estimate and no statistic of the study were computed.

### 1. The 14 findings

| # | Status | Where in 1.1 |
|---|---|---|
| 1 Compare contract | RESOLVED | 19.1, 19.3, 19.4 (lines 617 to 620) |
| 2 MR "has an estimate" | RESOLVED | 4.3 step 4 (line 152), ruling 5 (line 632), ruling 23, C15 (lines 541 to 542), unit cases 14.2 and 14.3 |
| 3 Parsing and rebuilt truth | RESOLVED | 2.1 (line 96), 4.4, 5 (line 181), C07, C10, C16 (line 523), 12.2, 18 (line 593), ruling 18 |
| 4 M1 and M4 near misses | PARTIAL | M1, M1x, M4, M4x are right. But the new M heading says `M1` to `M5` "count near misses", and M3 (unchanged) still counts exact hits; see fix A |
| 5 Shifted hour set wording | RESOLVED | 12.3 (line 369) |
| 6 Arm F shifted | RESOLVED | 12.3, 12.4 (`shiftF_*` rows, 32 rows), ruling 18 |
| 7 `timing_flag` blank | RESOLVED | 12.4 (line 376) |
| 8 `lf_discharge > 0` | RESOLVED | C13 (line 520) |
| 9 Rise period check | RESOLVED | C14 (line 521) |
| 10 Integer pick | RESOLVED in section 9 (lines 269 to 277), 10.2, 18 and ruling 15. One stale list in section 16; see fix B |
| 11 Structural checks | RESOLVED | C17 (line 544), note in 8.2 (line 265) |
| 12 `mae_rel` of P | RESOLVED | 7.2 (line 251) |
| 13 MR 5100 case | RESOLVED | 14.3 (line 466) |
| 14 No pick | RESOLVED | 10.2 (line 312), ruling 24 |

### 2. Unit values added or changed (recomputed in Python and in R)

- MR with row 6 `status = no_truth`, and with row 6 `status = no_por` and non-blank `rawUnc`, `corrUsed`: `lim` 2250, shown 2250 in both languages. Also checked: `no_por` with blank `rawUnc` falls back (1800, 1800).
- T1 in counts, `n_r = 10000`: 6 qualifiers, MR's `mean_d_sign` 1, leader UP (1885), tied F150, LF6, UP, ICE, first tied F150. Pick F150 at P 2000; no pick at P 1893, 1890 and 1800. Both languages agree.
- T2: no qualifier, no pick.
- T3: leader UP, all three tied, pick LF3 at P 3000.
- T4: F135 tied exactly on the edge (`10000 <= 10000`), F150 not (`11000`), pick F135 at P 2000.
- All as written in the spec, in both languages.

### 3. The real data

- C15: MR fall-back is 120 design and 0 test; MR differs from P on 1,903 and 2,122 hours. Both pass.
- C16: passes on both arms, with exact equality on all 119,447 and 119,464 scored hours.
- C13 `> 0`: 0 violations.
- C14 period agreement: 0 violations.
- C17: parts (a) and (b) give 0 violations on both arms (1,719,898 and 1,720,139 pairs compared on shown values only). Parts (c) and (d) follow from (a): a shown value at least production's gives an error at least production's. I did not evaluate them directly, because they need classes.

### 4. New ambiguities and leftovers

- **Fix A** (section 15, M3, and the heading line above M1). M3 counts exact hits, which are deterministic: 96 on each arm, for example an integer `L` equal to `1.02 * L3`. Replace the `n_violations` of `M3_lfrise_margin` with: "those with `0 < abs(L - 1.02 * L3) < 1e-9 * max(1.0, abs(L))` (near misses; exact equality is deterministic in both languages)". Make the same change to `M2_cap_margin`: "`0 < abs(u - 1.2 * L) < 1e-9 * max(1.0, abs(u))`".
- **Fix B** (section 16, the integer-columns bullet). The key-value list omits the new integer items. Replace "(`n_qualifiers`, `c5_n_rl`, `gate_*` counts, `gate_passed`, `shift_*_n_*`, `timing_flag`)" with "(`n_qualifiers`, `P_c_off_rising`, `c5_n_rl`, `gate_*` counts, `gate_passed`, `shift_*_n_*`, `shiftF_*_n_*`, `timing_flag`)".
- No other leftover found:
  - `truthFlow` now appears only in the column lists, C06, C16, the gate of 12.2 and section 18.
  - No text still says that arm F is not shifted, that the gate can fail, or that MR needs status `predicted`.
  - Row counts are consistent: `checks.csv` 60, `decision_inputs.csv` 22, `timing_gate.csv` 32, the timing files always 30 and 72.

### 5. Blindness

Unchanged: nothing states or hints at an expected result. The change list at the top names findings, not outcomes.

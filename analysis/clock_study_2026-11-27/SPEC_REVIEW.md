READY AFTER CHANGES

# Review of ANALYSIS_SPEC.md version 1.0 (clock study)

Reviewer: independent, Opus. Written 2026-11-27. Read against PLAN.md version 2 (2.5, 2.6, 3, 4, 6), PLAN_AUDIT.md (F2 to F9, F11 to F14, F17), and the cap study spec 1.2 and its review as the standard. I did not reuse the writer's scratch scripts.

What I computed on the real data: counts of units, windows, candidates, weeks, clusters, hours present, used windows, replay rows and statuses, field formats, SHA-256 and sizes, and the hours with a Difficult Run reading in the raw answers fetched so far. No lag, no correlation between gauges, no creek share, no fit. Scripts in `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/clock_spec_review/`: `struct.py` (all structural counts), `edges.py` (knife edges), `cov.py` (coverage), `drcov.py` (Difficult Run coverage so far), `myunit.py` and `myunit.R` (every unit test), `boot.py` and `boot.R` (run time on made-up numbers).

No blocker. Seven major findings (three need an orchestrator decision), nine minor.

## Findings

### 1. MAJOR (orchestrator decides). Ruling 16 (line 455), 5.2 point 4 (line 149), 7.1: the upper leg is measured in Little Falls time, not in the time of its own downstream gauge.

PLAN 4.2: "Window of a rise unit, in the downstream gauge's time". For `UPP` the downstream gauge is Edwards Ferry. The spec gives `UPP` the Little Falls window `[s - 6, p + 6]` and applies it to Edwards Ferry. Edwards Ferry leads Little Falls by the very lag being measured (PLAN 2.4: 7 to 17 h and more at low flow). The window opens only 6 h before the Little Falls start, so on short units the steepest part of the Edwards Ferry rise falls before the window or at its edge. Structure: 47 of the 86 bumps have windows of 48 h or less (median 48 h, shortest 16 h); 13 rise units have 36 h or less. This biases the `UPP` lags and pass rates of exactly the units that set the whole days at low water (`Mb` of `UPP`), and through the chain check it can decide whether the low-water cell qualifies. `WHO` and the three `LOW` versions are not affected (their downstream gauge is Little Falls).

Replacement (option A, recommended), add to 7.1: "For version `UPP` only, a rise, bump or recession window is moved into Edwards Ferry time: `aU = a - d`, `bU = b - d`, where `d` is the `s_best` of the same unit for `LOW_P` when its `LOW_P` status is `ok`. When the `LOW_P` status is not `ok`, the `UPP` status of that unit is `data`. The use rule (5.6), XC (3.4) and the parts (7.2) of `UPP` use `[aU, bU]`. `Q`, flow class, period, creek share and cluster stay those of `[a, b]`." Then `used_UPP_*` in section 17 have no fixed expected value (they depend on a lag): make them expected blank and move them out of C05 (C05 then tests 49 rows). Option B: keep the spec as written and state the bias as a limit in the report. Ruling 16 must say which.

### 2. MAJOR (orchestrator decides). Section 12, rising-water range (line 298), ruling 22: "cover both" departs from the plan in two ways.

PLAN 4.1: "If the median lag of a flow class differs by more than 1 hour between the primary and a sensitivity version ... the range covers both." The spec (a) uses fitted lags at the flow, not class medians (decision 11), and (b) tests `max - min > 1.0` over all usable versions, so `LOW_A` against `LOW_B` can switch it on while neither differs from the primary (example: P 10.0, A 9.2, B 10.9). (b) is a plain error against the plan. (a) is defensible (the range lives at a flow), but it is a change of a confirmed rule. Also the test is on unrounded doubles and is not counted by any M row.

Replacement (keeps the fit, fixes b, decides on written strings): "`L, lo, hi` are those of `LOW_P`. A sensitivity version (`LOW_A`, `LOW_B`) **differs** at `F` when it is usable and `abs(mic(lag_v) - mic(lag_LOW_P)) > 1000000`, on the written `lag` of `fit_at_flows.csv`. `cover_both = 1` when at least one version differs; then `lo` = the minimum and `hi` = the maximum of the bounds over `LOW_P` and the versions that differ, among those with bounds. Else `cover_both = 0`. When `LOW_P` is not usable, everything is blank." Plan-literal alternative for (a): "differs when, in `class_summary.csv` group `all_rise`, class of `F` (5.2 point 5), both `med_g60` are defined and their `mic` values differ by more than 1000000". Add to unit test 17: "usable lags P 10.0, A 9.2, B 10.9 give `cover_both = 0`."

### 3. MAJOR (orchestrator decides). Section 6 (line 202), decision 9: a gap in Difficult Run alone throws a unit out of every lower-leg and whole-reach clock set.

A unit is `unknown`, hence out of the `LOW_P` points, the cells and `Mb`, when any creek lacks 90% of the window. Counted on the raw Difficult Run answers present at review time (through 2016-02, keys to 404,140): 5 of the 40 rise and bump units in that span have Difficult Run under 90% of their window, although the gauge reads 97.8% of all hours in that span. Seneca and Broad Run were complete for them. Over the full record this could remove a tenth of the units for a reason that has nothing to do with the creeks' water. The plan does not ask for this; it only says that if the record cannot be fetched, the creek's part is dropped.

Replacement, section 6 after the "enough data" sentence: "Exception: when only Difficult Run lacks enough data in a unit's window (Seneca, Broad Run, and for the whole reach Monocacy and Goose Creek, and `LF` have enough), the share of that leg is computed without Difficult Run, with the gauged drainage of 1.4 (b) for that leg and the same local drainage." Add to `dr_summary.csv` a 17th row `share_fallback` (number of rise and bump units that used this exception; blank when the file is absent). If the orchestrator keeps the spec's rule, the report must count these units.

### 4. MAJOR. 7.1 (line 210), 9.2 (line 238), 11 step 5 (line 285): which result fields are written for `end`, `neighbour`, `no_eligible`, `data` is not determined.

"`s_best` (also given for `end` and `neighbour` ...), `n_pairs`, `r`, `delta`, `lag` (blank unless `ok`)" can be read with "(blank unless ok)" on `lag` only or on all four. 9.2 and section 11 say nothing. Blank against non-blank is a DIFFER in the compare.

Replacement, end of 7.1: "Fields by status. `data` and `no_eligible`: `s_best, n_pairs, r, delta, lag, g40..g70` blank. `end` and `neighbour`: `s_best = sb`, `n_pairs = n(sb)`, `r = r(sb)`; `delta`, `lag` and the flags blank. `ok`: all written." Add to 9.2: "`s_best, n_pairs, r` as in 7.1 for `neighbour` and `ok`; `delta` and `phase` only for `ok`; `gate50` always 0 or 1." Add to 11 step 5: "`lag_scaled` only for `ok`; `pass` is written 0 or 1 for every selected unit; `used` 0 or 1."

### 5. MAJOR. Section 8 (line 228) and section 16: "A statistic over an empty set is blank" can be read to blank the counts.

Many `class_summary.csv` rows have no units (for example group `bump`, classes `6000-12000` and above: no bump has `Q >= 6000`; group `small` and `event` in some classes). One analyst writes `0`, the other blank.
Replacement for line 228: "Counts (`n_*`) are always written, 0 for an empty set. Medians, percentiles and `share_whole_g60` over an empty set are blank." Add the same sentence to section 16 for every file.

### 6. MAJOR. 7.2 (line 214): it is not said whether recession windows get parts.

"(unit-versions with status `ok` only)" under the heading "The parts of a rise", and section 8 computes `n_parts` and the part medians for the group `recession`. Replacement, first sentence of 7.2: "Parts are computed for every row of `unit_lags.csv` with status `ok`, recession windows included; their parts enter the group `recession` of section 8. `parts_status` is `no_xc` for every row whose status is not `ok`." (If the orchestrator prefers to exclude recessions: "`parts_status` is `no_xc` for recession windows", and the recession rows of section 8 have `n_parts` 0 and blank part medians.)

### 7. MAJOR. 10.3 to 10.5, section 17 items 7 and 11: blank rules of `fits.csv` and `lowwater_summary.csv` are open.

"Blank when the fit is blank" does not say whether `n_points`, `n_clusters`, `qmin`, `qmax`, `n_floor` are blank, whether the bootstrap runs on a blank fit (`n_valid`, `n_skipped`), or which flows the bootstrap uses when a cell flow is blank. `lowwater_summary.csv` lag rows leave `n_weeks`, `n_gate` open; chain rows leave `chain_whole` undefined; `n_bumps` when `Mb` is blank is open.
Replacement, 10.5: "`n_points`, `n_clusters`, `n_floor` are always written (0 when no point). `qmin`, `qmax` when `n_points >= 1`. `nslopes`, `B`, `A` blank when the fit is blank. For `all`: when the fit is blank the bootstrap is not run and `n_valid`, `n_skipped`, `B_lo`, `B_hi` are blank; otherwise `n_valid` and `n_skipped` are written and `B_lo`, `B_hi` when the bounds are defined." 10.3: "for each flow of 10.4 that is not blank". 17 item 11: "lag rows: `n_weeks` and `n_gate` blank; `n_bumps` always written; chain rows: `chain_whole = L(WHO)`; every column not named for a row type is blank."

### 8. MINOR. Section 16 (line 389): the type of `flow` is not named.

`flow` is the key of `clock_grid.csv` and holds whole grid flows and medians. By the rule it is `%.6f` (`1500.000000`), but an analyst will be tempted to write `1500`. Add `flow` explicitly: "`flow` is a decimal (`%.6f`) in both files."

### 9. MINOR. Section 19 item 4 (line 429): the format guards cannot catch `NA`, `1e-05` or `+3.000000`.

The guards apply to "numeric cells", and step 2 types a cell as numeric only if it already matches a digit pattern, so these cells are typed text and pass. Replacement: "The guards apply to every cell of a column that section 16 makes numeric (all columns except `check, item, unit_id, kind, event_id, cluster, qclass, period, version, status, creek, parts_status, group, class, period, flow_id, source, week_id, row_type, reason, cell, name` and the `value` of `dr_sha256` and `verdict`); such a cell must be blank or match `^-?[0-9]+(\.[0-9]{6})?$`."

### 10. MINOR. Section 17 item 1 ("Written first") against section 15: `checks.csv` holds M4, which needs the fits.

Replacement: "`checks.csv` is the first file in this list; it is written when all its rows are known (after the fits), or at a stop as section 15 says."

### 11. MINOR (orchestrator decides). 13.1 app value (line 313): 939 `no_truth` rows also carry the clock the app used.

All 939 `no_truth` rows have a non-blank `travelGFtoLF`; PLAN 4.10 says "the clock the app actually used". The spec takes `predicted` only (128,595 rows). Either is defensible; the effect on a median is small. If included: "with `status` `predicted` or `no_truth`", and add a row `replay_with_clock` (expected 129,534) to section 17. If not: one sentence saying it is deliberate.

### 12. MINOR. 5.6 (line 184): the use rule passes windows that cannot give 24 pairs.

`cb >= 24` admits windows of 24 and 25 hours, which have at most 23 and 24 changes. For `LOW_P`: S44 (24 h), S58 (25 h), B451751 (25 h), B491475 (24 h). They come out `no_eligible` (or, for 25 h, eligible only at full coverage), not `data`. Harmless and deterministic; keep the plan's wording and say it in one sentence.

### 13. MINOR. Section 18 knife edges: one kept bump lies exactly on `v >= 1.4 * m`.

B477632: `v = 2030.0`, `m = 1450.0`, `1.4 * m = 2029.9999999999998`. Every reading (product first, `v / m >= 1.4`, `10 * v >= 14 * m`) keeps it, so it is safe. Name it in section 18 as a known edge so that a DIFFER in `bumps.csv` is checked there first.

### 14. MINOR. Section 14: three rules of real weight have no unit test.

Add: (a) `unit_cluster`: event windows `[0, 100]`, `[90, 200]`; a small onset `[95, 120]` joins the second (overlap 26 against 6); a small onset `[95, 104]` with overlaps 6 and 10 joins the second; a small onset `[300, 320]` is its own cluster. (b) `unit_draw`: clusters in order `A` (points 1, 2), `B` (point 3), `C` (point 4), `m = 3`, seed 20261127: draw 1 indices `1, 0, 1`, points `3, 1, 2, 3`; draw 2 indices `0, 1, 1`, points `1, 2, 3, 3` (checked in Python). (c) `unit_use`: window of 30 h, `up` present 27, `down` present 27, both 24 gives used; `up` present 26 gives `data`.

### 15. MINOR. 11 step 3 d: "max - min" for Seneca and Broad Run is stricter than the plan's "rising by".

A creek that falls by 25% of the Difficult Run rise over the 37 hours fails. Acceptable and deterministic; say in ruling 25 that a fall counts as variation.

### 16. MINOR. Section 0: the analysts write inside the study folder, which holds PLAN.md with its section 8 "Expected outcomes" (including the expected verdict).

The spec forbids reading it, which is the only guard available here (as in the cap study). Keep the sentence; the orchestrator should tell each analyst the same in its prompt.

## A. Faithfulness to PLAN.md version 2

Implemented as the plan says: series and the three Edwards Ferry versions (4.1); the start of the limb, 30% rule, event units, bumps with 40%, base below 3,000, peak below 6,000, 96 h spacing (4.2, by ruling 2 the 48 h end at the onset); the window in Little Falls time for the lower leg and the whole reach; recessions from `p - 6` to `p + 72` cut at the next window start, description only (4.5, F3); XC with the gate, the end rule, parabola, gates 0.4 to 0.7, whole-hour share (4.3, F14, F17); the parts at 10, 50, 90% and crests (F9); creek share by F8 wording; low water by phase, whole days from bumps, chain within 3 h (4.6, F6); Theil and Sen on all years, halves reported, bootstrap over events, no use outside the flow range (4.7, F12); Difficult Run units, lag, scaling, validity (4.8, F5); the one-sided range with the stated factors (4.9, F4, F13); four cells, all years, NOT DECIDED, the replay clock and the formula beside it (4.10, F2).

Departures: (1) `UPP` window not in its downstream gauge's time (finding 1; can change results, including the low-water cell). (2) cover both (finding 2; can change a cell's range and status). (3) `unknown` when only Difficult Run is short (finding 3; can change every lower-leg set). (4) Low-water weeks also need 152 of 168 hours and exclude bump windows (needed and consistent with bumps being rise units; cannot be wrong in kind). (5) App value on `predicted` rows only (finding 11; small). (6) Creek range in DR condition d (finding 15; small).

Rulings on the 14 decisions:
1. Bump scan: sound. Reproduced 103 candidates, 1 overlap, 16 spacing, 86 kept; doing spacing before overlap also gives 86.
2. Same window for every pair: change for `UPP` (finding 1, option A), or keep with the bias stated.
3. Use rule and the 24-pair rule: sound (finding 12 is cosmetic).
4. Parabola and end and neighbour statuses: sound. `den == 0` cannot occur in XC (the best is strictly above its left neighbour).
5. Recession cut: sound; it never fires. 3 recession windows still overlap windows that start before `p - 6`; harmless for description.
6. Low-water weeks: sound. Reproduced 779, 37, 567, 75, 100; 17, 30, 53.
7. Low-water bounds `L +/- spread`, 5 weeks per class, 3 bumps: sound as rules; the bounds are a spread of weeks, not an interval, and the report must say so.
8. Class of the median week flow; low water below the fit's range: sound.
9. Creek `unknown` out of the clock sets: change (finding 3).
10. Clusters and generator: sound. `48271 * x < 2^47` and `x * m < 2^39` are exact in doubles; `%%` and `%/%` give the integer result (checked; the quotient can never round onto an integer because the modulus is prime and above `x`).
11. Cover both at the flow: change at least part (b) (finding 2); part (a) is the orchestrator's call.
12. Difficult Run selection: sound; the thresholds are reasonable; untested on real data (file absent).
13. NOT DECIDED first: sound. It only matters when one cell qualifies and is INSIDE (or none qualifies), where the plan's rules collide.
14. The writer's claim: every expected value of section 14 is correct; I recomputed all of them in Python and the listed ones in R (C below). Section 11 stays untested on real data.

## B. Determinism

Findings 4 to 10 and 13. Otherwise I found the text exact: integer keys and weeks, sum order, two-pass correlation, parabola and clip, tie rules (best shift, circular median with 1e-9, spacing, clusters), the start of the limb, crossing times across gaps, Theil and Sen with equal-`Q` pairs skipped (the sign of `outer` differences cancels exactly), medians and percentiles, `%.6f` and `mic`, row orders. R: `48271 * x` is exact, `%%` is safe, `sum()` on arm64 has no extended precision. Short decimals parse to the same doubles in both languages; `EFQ` and `LNEF` gave identical doubles in both on a test value.

## C. Unit tests (all 20 recomputed in Python; in R: keys of 3, stats, correlation, XC with all sub-cases, parabola and wrap, crossing times, creek share, circular median and spread, Theil and Sen, generator and index, range, formula, every verdict and cell case, `mic`, the 9.1/7.4 product)

Every expected value is right. Notes: percentile 0.025 of `1..10000` is `250.97500000000002` (within the 1e-9 the spec allows); `short_end` prints `1.0880000000000001` at 17 digits in R, the same double as Python's `1.088`; the R value `9750.0249999999996` is the same double as `9750.025`. Test 12's last sentence ("a lag of 0.04 ... counts one floor") names no data set; give one: "`Q = 1000, 2000, 3000, 4000, 5000`, `lag = 0.04, 5, 4, 3, 2`: `n_floor = 1` and the first `y` is `ln(0.05)`." Gaps in coverage: finding 14.

## D. Expected counts (own script, from the text alone)

All 52 reproduce exactly: hourly 130,416 / 130,987 / 571; rise list 87, 54, 53 events, 33 small; no start 0, no peak 0, under 30% 0 (smallest ratio 1.319); rise units 86; bumps 103, 1, 16, 86; recessions 53, cut 0; weeks 779, 37, 567, 75, 100, and 17, 30, 53; clusters 6 joined, 53, 27, 86, 166 (no tie in the overlap); replay 130,987 rows, 128,595 `predicted` (statuses only `predicted`, `no_por`, `no_truth`, `no_lf`; no blank or malformed `travelGFtoLF` on a `predicted` row; keys consecutive); used windows 81/75/53, 81/74/53, 81/74/53, 76/68/48, 76/69/48; weeks used 93, 93, 93, 92, 99. SHA-256 and sizes of the three files match 1.1. No present value of the 8 checked columns is zero or malformed (C01 will pass). Shortest rise and bump window is 16 h, so C06's `n_hours < 16` passes at its edge.

## E. Can every outcome occur?

Gate statuses: all reachable. Creek cut: reachable either way. Low-water settlement: reachable; needs, for one class, 5 passing weeks for each of `LOW_P`, `UPP`, `WHO` (class sizes 17, 30, 53; `lt1500` is thin) and 3 clean `g60` bumps for each pair (bumps used: 75, 68, 69). Low-water cell: can qualify (93 weeks used for `LOW_P`, 20 must pass at 0.5); its class is that of the median passing week. Difficult Run validity: unknown until the file exists.

Cells: all three statuses are reachable by the 4.9 range. TOO SHORT needs the app value below `0.136 * lo` (without Difficult Run), for example `lo` above about 25 h at 15,000 cfs where the formula gives about 3.4 h: possible in arithmetic, far from the earlier measurements, so in practice a cell will be INSIDE or TOO LONG. Nothing is decided by construction.

Counts that bound the cells (no lag needed): rise and bump units with `Q >= 12000`: 7 in all years (E3, E15, E21, E34, E42, E48, E49), all used for `LOW_P`. `rising_ge12000` qualifies only if 5 of these 7 pass `ok`, `g60` and clean. `6000 <= Q < 12000`: 24 units (23 used). `Q < 6000`: 141 (123 used). So the verdict will most likely rest on `rising_lt6000`, `rising_6000_12000` and `low_water`; with `rising_ge12000` out, TOO LONG needs two of those three TOO LONG. The plan's rule works as written, but the high-water cell is close to its threshold; the orchestrator should know this before the run, not after.

## F. Blindness

Nothing in the spec states an expected lag, an expected status or a wanted direction. Unit test values are made up; test 17's formula values are the app's formula, not a result; the first verdict example being TOO LONG is neutral. Finding 16 for the plan file in the same folder.

## G. Compare contract

Enough to write the tool once findings 8 and 9 are applied. The exact-text group is sound: `units.csv` and `bumps.csv` use only parsed short decimals, medians and the operations `+ - * /`, which are identical in both languages; `checks.csv` and `decision.csv` depend on M counts and on `mic` of a median of `travelGFtoLF`, where R's parser differs from Python's in the last bit on some rows (cap review): a DIFFER there is possible only at a knife edge of the sixth decimal and must be traced, not tolerated.

## H. Run time in R

Made-up data at the worst case (172 points, 166 clusters): R with `outer` and `upper.tri`, 10,000 draws times 5 fits, about 100 s; Python nested loops about 5 minutes. Affordable as written; no cheaper formulation is needed. XC (about 100,000 small correlations by index slices) is light.

## What I could not check

- The Difficult Run file (absent at review time): its contract, SHA-256, section 11 on real data, the full count of units where Difficult Run lacks 90% (finding 3 is based on the raw answers through 2016-02 only). The fetch script writes `round(v, 1)` through `csv`; a negative reading would be written `-x.x` and stop the run at C04 (the script counts non-positive readings; the orchestrator should look at that line of its output).
- Any number that needs a lag, a share or a fit: pass rates per class, whether `Mb` exists for each pair, whether `rising_ge12000` and `low_water` qualify.
- Run time of the real XC and parts in each language (estimated, not run).

## Re-check of version 1.1

READY AFTER CHANGES (one minor contradiction, one sentence to add; nothing else open)

Checked from the diff against `ANALYSIS_SPEC_v1.0.md`. Scripts: `re11.py`, `re11.R` in the same scratch folder as before.

### Status of the 16 findings

1. RESOLVED (lines 226, 477): `UPP` window `[a - d, b - d]` with `d` = the `LOW_P` `s_best` when `ok`, else `data`; the use rule, XC and parts on the moved window; the parts' upstream window `[aU - sb, bU - sb]`; `Q`, class, period, share, cluster on `[a, b]`; weeks not moved. Unambiguous. One side effect: see new finding N1.
2. RESOLVED (line 316, ruling 22 at 483): mechanical. The class of `F` is by 5.2 point 5, the comparison is on `mic` of the written `med_g60`, primary against each sensitivity, `n_g60_clean >= 3` for both, bounds from each version's own row. Two analysts cannot differ given identical `class_summary.csv`.
3. RESOLVED (lines 218 to 219, 420, 430, 481).
4. RESOLVED (lines 228, 256, 303).
5. RESOLVED (lines 246, 411), except the `n_both` exception of N1.
6. RESOLVED (line 232).
7. RESOLVED (lines 281, 289, 428).
8. RESOLVED (line 411).
9. RESOLVED (line 451). The text-column list covers every text column of the 15 files.
10. RESOLVED (line 418).
11. RESOLVED (lines 331, 387, 419). `replay_with_clock` 129,534 is right: all 939 `no_truth` rows have a non-blank `travelGFtoLF`.
12. RESOLVED (line 199).
13. RESOLVED (line 441).
14. RESOLVED (tests 21 to 23 at lines 374 to 376; floor data set in test 12).
15. RESOLVED (line 486), but version 1.2 reverses it (see "Collisions with 1.2").
16. RESOLVED (line 21).

### Unit-test values added or changed: all right, in Python and R

- Test 11, Difficult Run fallback: `0.5827216261998871`. Status `heavy`. 3 of 5 hours present fails 90%.
- Test 12, floor set: `n_floor = 1`, `y[0] = -2.995732273553991`, `nslopes = 10`, `B = -0.6436526536897076`, `A = 6.437099349353944`.
- Test 17, switching in: every case as stated, including the exact 1.0 (not switched) and `11.000001` (switched). Every bounds case as stated.
- Test 21, `unit_cluster`: overlaps 6 and 26, 6 and 10, 0 and 0.
- Test 22, `unit_draw`: indices `1, 0, 1` with points `3, 1, 2, 3`, then `0, 1, 1` with points `1, 2, 3, 3`.
- Test 23, `unit_use`: 27, 27, 24 gives used; 26 gives `data`.

### Counts

- `row_accounting.csv`: 33 + 15 + 5 + 1 = 54 rows. 50 rows have an expected value (32 old base rows + `replay_with_clock` + 12 used rows without `UPP` + 5 week rows). All 50 values are what my script gives.
- `weeks_used_UPP` (92) stays right: weeks are not moved.
- No other expected count depends on a lag.
- Row totals are consistent: `checks.csv` 36, `dr_summary.csv` 17, 23 unit tests, 19 columns in `units.csv`.

### New finding

N1. MINOR. Line 421 against line 411. Line 421 makes `n_both` blank when `UPP` is `data` because `LOW_P` is not `ok`. Line 411 says counts (`n_*`) are always written, 0 when nothing is counted. One analyst writes blank, the other 0.
Fix, append to line 411: "Exception: `n_both` of a `UPP` row whose `LOW_P` status is not `ok` is blank (7.1); it is the only count that can be blank."

No other new ambiguity, contradiction, stale count or leftover 1.0 text found.

### Blindness

Still nothing about expected results. Line 21 adds the guard sentence.

### Collisions with the planned 1.2 edits (section 11 and around)

- Non-positive Difficult Run reading counted as missing:
  - Line 68 (pattern `^[0-9]+(\.[0-9]+)?$`, "zero or above") and C04 would still stop the run on a negative value. Both must allow `^-?[0-9]+(\.[0-9]+)?$`, and C04 must count but not stop on non-positive values.
  - Name where the count goes. A new `dr_summary.csv` row makes 18 rows; update section 17's row count and the compare tool's expected count.
  - Say that the missing hour also applies to the dense array of 2.3, so the use rule, XC, the creek share and the Difficult Run exception all see it as missing.
- Creek condition reworded to "rising by":
  - Ruling 25 (line 486) now says the opposite and must be rewritten.
  - Section 17 item 12 names the columns `seneca_range` and `broad_run_range` and defines them as `max - min`. Rename them (for example `seneca_rise`, `broad_run_rise`) or redefine them.
  - Test 19's creek case ("a range of 74.5 passes ... 75.0 fails") must be restated as a rise.
  - Define the first present value as "the first present hour of `p - 24, ..., p + 12`", with the 30-of-37 rule unchanged.
- Placeholder: line 71 and C00 already handle it. No collision.

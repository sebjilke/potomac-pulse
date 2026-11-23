# Tool audit: freeze, tidy tables, old curve, replay, research table

Independent tool auditor (Opus), 2026-11-22/23. I built none of what is audited. Read-only everywhere; all reruns in a scratch
directory outside the repository. No estimate was compared with the truth, no scenario was compared with another, and no
pattern in the river data was looked at.

## Verdict: GO WITH CHANGES

No blocker. The tools reproduce, the tables trace back to the raw files, and the replay matches the job log wherever USGS did
not rewrite an input. One MAJOR finding (the old-curve extrapolation rules are not shown to bracket the truth) and a set of
MINOR fixes, mostly items the analysis specification must pin down. The gate ruling stands on the facts; its wording should
change (finding 2).

Counts: 0 BLOCKER, 1 MAJOR, 9 MINOR, 8 NOTE.

---

## Findings

### 1. MAJOR: rules A and B are not shown to bracket the old curve below 1.03 ft; the only evidence there sits on rule B

**Evidence**
- `replay/f_old/lookup_by_day.csv`: the old curve observed in the archive on 9 to 12 Oct gives exactly the same flow as the
  7 to 13 Nov knots at all 22 shared levels (1.03 to 1.24 ft). The same October days also hold the only old values below the
  knot range: 1.01 ft = 1200 cfs, 1.02 ft = 1220 cfs (85 and 67 archive pairs, one flow each).
- `replay/f_old/f_old_values.csv`: at 1.01 and 1.02 ft rule A gives 1190 and 1210 (10 cfs, one step, below the observed old
  curve); rule B gives 1200 and 1220 (equal to it). Rule A is below rule B at every extrapolated level, and the gap widens
  downward (to 60 cfs at 0.92 ft).
- 268 of the 923 extrapolated readings are at 1.01 or 1.02 ft (`F_OLD_REPORT.md` section 5).
- The plan (R5, section 11) reads terms 1 and 2 as "a range across the two extrapolation rules". That reading assumes the
  truth lies between A and B. Below 1.01 ft nothing shows that: the one piece of evidence lies on the upper rule, so the truth
  further down could as well lie above B as between them.

**Implication.** The "revision never happened" counterfactual is fine inside 1.03 to 1.24 ft. Below it, rule A is known to be
one step low where evidence exists, and rule B is the only rule consistent with that evidence. The range is therefore not a
demonstrated bound; it is two assumptions.

**Fix (no change to the pre-registered rules).** Keep A and B. Add, as a disclosed sensitivity fixed before any result, a rule
C: the window knots plus the two October archive knots (1.01, 1.02 ft), extrapolated linearly from 1.01 and 1.02 ft. Report the
range as min to max over A, B and C, the number of readings in each level band, and state in the report that the bound property
is not demonstrated below 1.01 ft. Record in `CURVE_DEFINITION.md` a dated entry saying the October pairs were seen by the
builder (LOG anomaly 5) and by this audit, and that rule C was added for that reason, not after any result.

### 2. MINOR: the gate ruling is right on the facts, but "nothing was loosened" is not accurate

**Facts verified independently**
- The plan's list of gated values (PLAN 4.4) contains no current readings and no temperature. Under that list there are 2
  misses (seq 212 and 217), both in the pre-listed category "a value USGS rewrote after the run". Correct.
- The four misses are real and are input rewrites:
  - seq 136 and 147 (temperature): the frozen readings at the logged reading times carry `last_modified`
    2026-11-16T12:02:21Z and 20:02:23Z, 1.5 and 1.0 minutes after the run starts (12:00:54, 20:01:21). Same for seq 56
    (Gate B, 04:02:24 against 04:00:56). Only `cur.temp.c` differs; every computed value equals the log.
  - seq 212: the job logged, in its own `pub` field, that the 12:00 Point of Rocks flow reading it received carried
    `last_modified` 2026-11-18T12:04:24.476Z. The frozen record (and live USGS today) carries 13:03:30.060Z for the same
    reading. This is direct evidence, not used by the builder, that USGS rewrote the reading 2.5 minutes after the run began.
  - seq 217: only `rise.r`, through that same stored reading. Verified.
- The operational spec (`FIDELITY_SPEC.md`), written before the first gate run at the orchestrator's instruction ("the current
  readings themselves"), counted temperature. Under the spec that was actually pre-registered for the gate, there are 4 misses
  against a cap of 3. Removing temperature from the counted list after seeing the result is a narrowing of the operational spec,
  even though it returns to the plan's own list.

**My ruling would have been:** proceed, as the orchestrator did, but worded as an accepted deviation: "Gate A exceeds its cap by
one under the pre-registered spec (4 of 174); all four misses are in a pre-listed category and are independently evidenced
input rewrites; no computed value differs on any run whose inputs were not rewritten; the deviation is accepted and reported."
Same outcome, without claiming nothing was loosened.

**Fix.** Reword Ruling 1 in PLAN.md section 14 accordingly and cite the `pub` evidence for seq 212. `out/GATE_VERDICT.json`
still says `"gateA": "FAIL"` next to a ruling text that says passed: add a field such as `"gateA_after_ruling": "ACCEPTED_DEVIATION"`
or state in `OUT_DICTIONARY.md` which field governs.

### 3. MINOR: the as-run values of seq 212 and 217 in `replay_runs.csv` are the replay's, not what ran

`replay_runs.csv` (S0) carries the replayed chain for seq 212 (from the rewritten 1860-cfs reading) and the replayed rise rate for
217. Ruling 1 says "the logged values are what ran" and that the difference falls into term 3. Two analysts could take S0 from
either source. **Fix:** the spec must name the source of S0 for these two runs (logged values from `runs.csv` for the three-term
split; replayed values only where the split is reported "without the two runs"), and flag them in every table.

### 4. MINOR: the availability rule is a legitimate reconstruction; two edges should be stated

**Independent tests (evidence the builder did not use)**
- Prediction test: for every run from 13 Nov 20:00 on, I predicted the newest reading the job could have had as "the newest
  frozen reading whose `last_modified` is at or before the run start", without using any logged time, and compared it with the
  logged reading time. Point of Rocks flow 208 of 209 equal (the miss is seq 212, explained in finding 2); Little Falls flow
  209 of 209; Monocacy 209 of 209; Edwards Ferry level 207 of 209 (seq 72 and 191, old-service runs, where the job received a
  reading one hour older than the rule predicts).
- Publication-stamp test: on all 114 new-service runs the job logged the `last_modified` of the newest Point of Rocks reading it
  received (`pub_01638500_lm`). It equals the frozen `last_modified` exactly on 113 runs; the one exception is seq 212.
- So `last_modified` behaves as the publication time, and the rule reconstructs what the job received. It was found with the
  mismatches in view, but it is not fitted to them.

**Edges.** (a) The exception covers only the reading at the logged reading time. An older stamp that the job had and that USGS
rewrote after the run would be wrongly excluded; the stored-history counts match on 272 of 280 runs and the 8 misses are
old-service runs, so no such case occurs here. (b) The condition "later than the 13 Nov bulk stamp" is inert for S0; it matters
only for S-new on the runs before 13 Nov 19:41, where it keeps availability identical across scenarios. **Fix:** say both in
`FIDELITY_SPEC.md`.

### 5. MINOR: `f_old` test set: independent of the fit, but it tests only one thing

All 77 test readings sit at knot levels, and the 22 knots are contiguous at 0.01 ft (1.03 to 1.24), so interpolation between
knots is never exercised and extrapolation is never tested. The test shows that the same level kept the same flow from 7 to
13 Nov and that the levels were not revised; nothing more. The definition file was written before the test (`CURVE_DEFINITION.md`
created 06:38:04, `build_f_old.py` 06:39:30, first outputs 06:39:41). **But** `build_f_old.py` was modified at 06:57:35, after
its first outputs, and the definition has no dated change. I cannot tell what changed (no git history for the study folder at
that time). **Fix:** the builder states what changed in that edit (the diagnostic table of section 5 is the likely candidate) and
the report says the test is a constancy test only.

### 6. MINOR: `bins.csv`, `gf_correction_bin` rows: times can mislead

`snapshot_time_utc` is set to the export time (10:51), and `row_created_utc` holds the row's `created_at`, which for these rows
is months old (for example `0-3000_falling` 2026-07-06) although the bins were updated by November checks. The row is updated
in place, so `created_at` is not the last-update time. **Fix:** say so in the dictionary; for bin state at any moment use the
snapshot rows and `binBefore`/`binAfter` in `checks.csv` (as the replay does).

### 7. MINOR: water-withdrawal table (`research/data/coop/coop_daily_reports_parsed.csv`): small parse gaps and a misleading name

Checked against all 50 saved pages with my own parser (650 cells) and against 2 live pages (node 846 and 812; live text equal to
the saved pages). Report date and withdrawal date are right on every page (withdrawal date = the date in "Yesterday's ...
withdrawals (date)", one day before the report date); the previous-day Little Falls and Point of Rocks flows carry that same date.
Units are as stated (MGD for withdrawals, cfs for the two gauge columns).
- node 825 (23 Jan 2026): Point of Rocks previous-day flow 1727 cfs is on the page ("2026-01-22*") but blank in the CSV.
- Footnote markers are dropped: node 836 gives Little Falls and Great Falls "2105 cfs*" (estimated after removal of an anomalous
  USGS spike); the CSV has no flag. Only the Washington Aqueduct Great Falls estimate has a flag column. The report-day "est."
  values are not in the CSV (fine, but say so).
- `great_falls_est_MGD` is CO-OP's "flow below Great Falls intake = Little Falls plus Little Falls withdrawal", in MGD, while the
  neighbouring gauge columns are in cfs. It must not be confused with the app's Great Falls estimate.
- `lf_gage_prev_day_cfs` and `por_prev_day_cfs` are CO-OP's snapshot of USGS provisional values on the report day (a vintage, not
  the current record).
**Fix:** fill node 825, add a footnote flag column, rename or document `great_falls_est_MGD`, and state the vintage nature of the
two gauge columns.

### 8. MINOR: the analysis specification must pin several things the files leave open

See the list at the end. The three most likely to split the two analysts: which S0 values to use for seq 212/217 (finding 3);
that `checks.predTs` joins to `runs.final_ts`, not to `runs.at`; and that truth for a 2 x 2 x 2 cell is looked up at the cell's
`due_utc`, which equals the due time of the `due_from` scenario in `truth.csv`.

### 9. MINOR: blind analysts can read expectations in PLAN.md

PLAN.md sections 0, 1 and 6 and all of PLAN_AUDIT.md carry first-pass error numbers and expectations ("about 21% high", "15 of 15
too high", expected ratios, "Reading B holds"). `research/` notes state a documented cause of the wave. **Fix:** make
ANALYSIS_SPEC.md self-contained and tell the analysts not to open PLAN*.md, PLAN_AUDIT.md or research/*.md (the research tables
they need can be named by path).

### 10. MINOR: `OUT_DICTIONARY.md` and `DICTIONARY.md` small errors

`checks.csv` `seq` is described as "row number after ordering by `at`", but checks have no `at` (they are ordered by
`created_at`). `cur_extrap_flag` lists a value `interpolated` that never occurs (every knot level is observed). **Fix:** correct
both.

### 11. NOTE: `tools/04_time_alignment_check.py` is sound, and it already disclosed part of R2

Logic: exact equality of old and current values at shift -60, 0 and +60 minutes for four series assumed unrevised. Shift 0 gives
100% on all eight series-period cells, shift ±60 gives 36 to 75%. That settles the old-service labels: the -04:00 and -05:00
offsets are right, and the one-hour-early window is a property of the old service's request handling. The same reasoning
covers Point of Rocks flow and temperature (same files, same conversion). Side effect: the output shows that Little Falls flow
and level, Monocacy flow and Edwards Ferry level were not revised from 12 Jun to 9 Nov, which is part of R2's answer and is now
known to the orchestrator. **Fix:** disclose it in the spec; it does not invalidate R2.

### 12. NOTE: the revision boundary is found from a logged value

`engine.cjs` `findRevisionIndex` compares the logged `in.por.q` with the current record to find the first revised run (seq 72).
This is a configuration choice, not a model input, and it agrees with a rule that uses no logged value (the first run after the
bulk stamp 13 Nov 19:41:13). **Fix (optional):** derive it from the stamp and assert equality.

### 13. NOTE: the replay drops USGS qualifier codes

The fake responses pass only P/A as qualifiers, so an `Ice` qualifier would never trigger the job's ice path. The frozen record
has no qualifier on any model gauge from 8 Nov on, so nothing is affected. State it.

### 14. NOTE: code versions

R8A's claim holds: `shared/model.js` is identical in all three exports and at HEAD; the v39.11 export of `scheduled-update.js`,
`shared/model.js` and `shared/observations.js` equals commit cd7b0c3 and HEAD byte for byte. `shared/usgs-adapter.js` at HEAD
differs from cd7b0c3 only by two marker comments (`// --- BEGIN SHARED ---`, `// --- END SHARED ---`, v39.12/v39.13, deployed
17 Nov from about 17:35 UTC while runs kept logging `v39.11`). No functional change. Add one line to R8A_CODE_DIFF.md.

### 15. NOTE: the 2 x 2 x 2 means what the plan says, with one consequence for analysts

The copy reproduces the production raw estimate in both pure cells on 280 of 280 runs for both rules, and its line map
re-verifies (`verify_copy.py`: IDENTICAL). The raw estimate never depends on `due_from` (0 of 2,200 groups vary); `due_from`
only moves the moment at which truth is read. Mixed cells measure "same timestamp and travel time, other numbers", not mistiming,
as the plan says.

### 16. NOTE: truth series T2

T2 reproduces `actualCFS` on 19 of 19 traceable checks, each from the check's own run. T2 uses the run's `final.ts` as the
validation moment, while production validates a few seconds earlier in the same run; the one case flagged
`t2_ambiguous_within_3s` (seq 91) is not ambiguous in fact, because the validating run started after the due time.

### 17. NOTE: research claims that rest only on search-tool summaries

Listed by the researcher, and confirmed as such: Dam 4 and Dam 5 capacities, license terms and Dam 5 "run-of-river"
(hydroreform.org); Millville license date (Dec 2017); Shenandoah P-2509 run-of-river with 44 cfs; Jennings Randolph and Savage
operated by the Corps (July 2026 outlook summary); the Sept 2025 Jennings Randolph release; the Point of Rocks REMARKS mention of
run-of-river plants (UNVERIFIED); eelways at Dams 4 and 5; the USGS FAQ list of debris and backwater causes (page 403); the
backwater web-flag blog; the USGS memo on correcting published data and the three-year provisional statement; TWRI 3-A13 shift
practice ("not shifted within 5 percent"); the definition of 01646502 as withdrawal-adjusted; the January 2026 Little Falls
intake closure; NPS and WTOP and Leesburg intake descriptions. None may be quoted in the report without reading the source.

### 18. NOTE: what Gate B does not test

Gate B accepts 8 runs whose stored-history count is 5 to 7 stamps larger than the log (the old service gives no publication
stamp, so availability cannot be reconstructed for 10 to 13 Nov). These stamps are the newest of each 8-hour burst; they do not
enter any time-shifted or 6-hour reading and are stored with the same value by the next run, so no computed value is affected
(every Gate B field matches).

---

## Checked and found correct

- **Manifest:** all 85 raw files re-hashed: 0 mismatches in bytes or SHA-256; gzip pages' uncompressed hashes match; the 55
  archive files equal the originals in `rising-limb-travel-backtest/raw/`.
- **Counts:** my own counts from the raw files equal every table and `tools/LOG.md`: archive 303,659; October pull 57,135;
  current model 375,865 (sum of 9 pages); upstream 126,281; census 271,042 (113,013 + 47,030 Little Falls; 63,935 + 47,064
  Point of Rocks). 305 log rows, 280 predicted, 25 error.
- **Cell traces (my seed, 32 cells, all correct):** 20 readings cells, 4 per readings table, each traced to the raw value, the raw
  `dateTime` with its offset, approval and (new service) `last_modified`; 12 `runs.csv` cells traced to the raw `tick_log.json`
  (`hist.cfs`, `raw.cfs`, `due`, `in.por.q`, `in.porHist.n`, `in.lf.qT`, `rise.rst`); plus 21 `checks.csv` cells and 3 `bins.csv`
  rows traced to `validation_log.json` and `state_rows.json`.
- **Time zones:** the builder's hand check around 1 Nov is right (repeated local hour 01:00 at -04:00 and -05:00, contiguous in
  UTC); my traces include -04:00 rows from Aug to Oct.
- **`used` rule:** recomputed: first `predicted` row of each clock hour; 275 rows; `rows_in_hour` correct; the 5 duplicate hours
  (16 to 17 Nov) are the ones listed.
- **Flattening:** every leaf path of `tick_log` and `validation_log` is a column; the missing names are whole-object nulls; arrays
  go to `runs_tails.csv` or are `|` joined.
- **Rebuild:** `tools/03_build_tidy.py` rerun from the frozen raw files in scratch: all 14 tidy files and `MANIFEST.json`
  byte-identical; `tools/05_reconcile.py` byte-identical.
- **Replay rerun:** `replay/` and `data/tidy/` copied to scratch, `./run_all.sh --gate-ruling="audit rerun"`: `verify_copy.py`
  IDENTICAL; all 8 `f_old/` files and 9 of 11 `out/` files byte-identical; `GATE_VERDICT.json` and `facts.json` differ only in the
  ruling text. 11.5 s, no network.
- **No logged value is a model input.** Uses of the log in the replay: reading times, run times, version, source (allowed); the
  logged `in.por.q` to find the boundary (finding 12) and, by the plan's design, as `f_old` fit pairs; logged values otherwise only
  as gate targets.
- **Stubs:** `fetch` (serves frozen readings; any other address throws), the Supabase library and an in-memory `por_history` row,
  `Date.now` frozen at `final.ts`, a dummy key in the environment to take the new-service path, console silenced, one export line
  appended in memory. Nothing else. `new Date()` without arguments is not frozen; it only sets the record's `timestamp`, which the
  replay does not use.
- **Fidelity, recomputed for 34 runs x 25 fields (850 comparisons)** from the raw `tick_log.json` against the replayed values:
  the first run (seq 1), every run 13 Nov 17:00 to 14 Nov 00:00 (seq 69 to 76), every run 17 Nov 15:00 to 19:00 including the
  switch (seq 188 to 194), seq 136, 147, 212, 217 and 16 random runs. Every field equal within the spec except the known ones:
  seq 212 (14 fields), 217 (`rise.r`), seq 16 (`in.porHist.n`, Gate B).
- **Scenarios:** in S-old-A/B every Point of Rocks value the run uses (current, 6-hour, time-shifted, whole history) is `f_old` or
  archive (275 of 275 used runs); in S-new all are current; the current reading equals `f_old` rule A, rule B or the current
  record at its time on every row; `f_old_values.csv` covers every Point of Rocks stamp from 10 Nov (3,576), so no stamp drops out
  of S-old. Little Falls, tributaries, Edwards Ferry, temperature and run clock identical across scenarios (`facts.json` 0, and my
  check of `lf_q`, `trib_sum_cfs`, `cur_qT_utc`, `ceil_lim`). `trv_t0` differs because it includes the Point of Rocks rise-rate
  shortening (expected). Scenario final estimates are flagged `approx_final = 1`.
- **Labels around the boundary:** seq 69 to 71 all old; 72 to 75 current new, 6-hour old, label `mixed` (the four phantom-rising
  runs); 76 6-hour new; time-shifted reading old to seq 106 (15 Nov 06:00), new from seq 107. Matches PLAN section 5 and the
  plan audit.
- **2 x 2 x 2:** line-by-line comparison of `post_iteration_copy.cjs` with v39.11 lines 999 to 1082 (and the identical bodies of
  v39.2 and v39.6); pure cells equal `replay_runs.csv` raw on 1,100 of 1,100 rows; every cell's `due_utc` equals the due time of
  its `due_from` scenario in `truth.csv`; 0 empty cells, 0 match-window uses.
- **Bin timeline:** reproduces the 11 daily snapshots (count difference 0, EMA difference at most 0.0005); `corr.*` equal on 280 of
  280 runs.
- **Research quotations** found verbatim in the saved pages: ICPRB 24 Oct 2024 (two sentences), 23 Oct 2025, 11 Dec 2025, CO-OP
  node 809, the FERC Millville EA (three passages) and the USGS eel paper ("1800-0600 hours", en-dashes in the source).
- **Live USGS, keyless, 6 requests, all HTTP 200, all equal to the frozen values with identical `last_modified`:** 10 Point of
  Rocks flows (18 Nov 11:55 to 12:10, including the rewritten 12:00 reading; 20 Nov 06:00 to 06:15; 15 Nov 03:00 to 03:10), 6
  Point of Rocks field-measurement values (3 Sep, 8 Oct, 10 Nov: level, flow, control condition, rating, bulk stamp
  2026-11-13T20:34:53), 3 Shepherdstown and 3 Millville flows (19 Nov 00:00 to 00:30). Nothing was rewritten since the freeze.

## Not checked

- `tools/01_freeze_local.py` and `tools/02_pull_usgs.py` were not rerun (the first needs session files, the second the network
  and would change by design); I checked their outputs by hash and by count instead.
- No query of the live job log; the frozen exports were taken as the reference (their hashes are in the manifest).
- What changed in `build_f_old.py` at 06:57 (finding 5).
- The remaining research PDFs and pages beyond the quotations listed; the W7 inputs (`hourly_backtest_data_v39.csv`,
  `replay_lag_2026-11-17`), which no tool of this stage produces.
- Whether the old-service runs (v39.6) received their readings from a service whose publication times match the new service's
  `last_modified`; the prediction test (finding 4) says yes for Point of Rocks, Little Falls and Monocacy, with two Edwards
  Ferry exceptions.

## For the analysis specification (point 10)

Join keys and units
1. Runs: `seq` is unique in `runs.csv`; use `used = 1` rows (275). `replay_runs.csv` and `truth.csv` key = (`seq`, `scenario`).
   `replay_2x2x2.csv` key = (`seq`, `old_rule`, `flow_numbers`, `reading_pick_from`, `due_from`). `labels.csv` key = `seq`.
2. Checks join to runs by `checks.predTs_utc = runs.final_ts_utc` (not `at`); check 1 has no run.
3. Truth for a 2 x 2 x 2 cell: `truth.csv` row of (`seq`, `S-old-<old_rule>`) if `due_from = old`, else (`seq`, `S-new`).
4. Readings: `readings_current_census.csv` repeats the model-table rows for the two flow series from 12 Jun; never union the two
   tables without de-duplicating on (`gauge`, `parameter`, `time_utc`). (`gauge`, `parameter`, `time_utc`) is unique within each
   readings table. Old archive starts 11 Jun 23:00Z; pick windows by UTC time, not by file.
5. `field_measurements.csv`: one row per parameter per visit (level and flow are separate rows sharing `field_visit_id`); two
   duplicate-content rows with different `feature_id` exist (1905 and 2008); say whether to keep them.
6. Withdrawal table: MGD, convert with one fixed factor (state it, for example 1.547 cfs per MGD); date = `withdrawal_date`;
   "Not available" is missing; `great_falls_est_MGD` is CO-OP's quantity (finding 7).

Choices to fix before any result
7. Source of S0 for seq 212 and 217 (finding 3), and that every analysis is also run without them.
8. Which `f_old` rules define the range (A, B, and rule C if adopted), and how readings are classed by level band (inside the
   knots, 1.01 to 1.02, below 1.01).
9. Truth: T1 or T2 for each output (the plan says T1 for the split); the 60 rows with no truth (due after the last frozen
   reading) are dropped and counted; T1 at a Little Falls blank (7 Nov only) is not reached in the window.
10. Time zone and hour-of-day basis per table (local time of the due time for error cycles; of the reading for the wave), with
    the 1 Nov clock change handled by converting each UTC time, not by a fixed offset.
11. Phases from `labels.csv` per component; Gate membership (`gate`) is a fidelity notion, not a phase.
12. Scenario finals use frozen bins (`approx_final = 1`), S0 uses the as-run bins: no analysis may difference an S0 final with
    a scenario final and call it a revision effect.
13. The 4 runs of the gate (136, 147, 212, 217) are flagged in every table; the 5 duplicate-hour rows are excluded.
14. Day blocks for resampling: UTC days or local days (state which), and the pre-generated index file shared by both languages.
15. Little Falls quantisation (40-cfs steps) stated with every Little Falls amplitude, and the event-day rule per gauge
    (section 5) with its centred-mean edge handling.
16. The R2 part already disclosed by `tools/04` (finding 11).
17. What the analysts may read (finding 9).

---

## Re-check after the fix rounds, and review of the analysis specification (same auditor, 2026-11-23)


## Verdict for starting the analysts: GO WITH CHANGES

The fix rounds are done and they check out: 17 findings RESOLVED and 1 PARTIAL (finding 8, through the specification
items below). The delivered replay outputs are trustworthy: a fresh rerun reproduces them byte for byte. The specification is
close, but several recipes are not yet fully determined. A Python analyst and an R analyst would produce different cells
there, and under PLAN section 8 a disagreement stops the study. Fix the MAJOR items (all are wording) before the analysts
start.

Counts for this re-check: 0 BLOCKER, 9 MAJOR, 14 MINOR, 5 NOTE (part 2 only; part 1 is a status table).

---

### Part 1. Status of the 18 findings

| # | Status | Evidence |
|---|---|---|
| 1 | RESOLVED | Rule C is in `f_old_values.csv` as asked: window knots plus 1.01 ft = 1200 and 1.02 ft = 1220; linear below 1.01 ft through those two knots, rounded to 10 cfs (0.92 ft = 1020, 1.00 ft = 1180); equal to rule A at and above the knots. `S-old-C` uses rule C for every Point of Rocks value it uses (275 of 275 used runs: the current reading, the 6-hour reading and the time-shifted reading all equal rule C at their stamps; 0 mismatches). Its flags come from `flag_rule_C` (`observed_oct_knot` at 1.01/1.02 ft). Identity test of the post-iteration copy: 280 of 280 runs equal for rule C (and for A and B); 0 empty cells. |
| 2 | RESOLVED | PLAN section 14 Ruling 1 is reworded as an accepted deviation; `GATE_VERDICT.json` keeps `gateA: FAIL` and adds `gateA_after_ruling: ACCEPTED_DEVIATION`. |
| 3 | RESOLVED | COMMON section 2 names `runs.csv` as what ran and requires a `without_212_217` set. A side effect remains for truth; see S-3 below. |
| 4 | RESOLVED | `FIDELITY_SPEC.md` dated entry of 2026-11-23 states both edges. Correction to my own wording: the bulk-stamp condition is NOT inert for S0. It keeps the old-world stamps in the S0 fetches of the runs before 19:41 on 13 Nov. The addendum states this correctly. |
| 5 | RESOLVED | `CURVE_DEFINITION.md` has a dated entry describing the edit and calling the test a constancy test only. Item (b) below judges the disclosure. |
| 6 | RESOLVED | `DICTIONARY.md` lines 415 and 416. |
| 7 | RESOLVED | `tools/06` writes `withdrawals_coop.csv` with a flag column per value, `coop_flow_below_gf_intake_*` (renamed), and node 825's 1727 cfs with flag `*`. Item (d) below checks it. |
| 8 | PARTIAL | Of my 17 points, 13 are covered and correct and 4 are partial (5, 8, 12, 15). See the coverage table in part 2. |
| 9 | RESOLVED | COMMON section 1 forbids PLAN*, both audits and `research/`; Part W may not open the withdrawal table. |
| 10 | RESOLVED | `DICTIONARY.md` line 91 (`seq` of checks); `OUT_DICTIONARY.md` line 41 (`interpolated` "defined but do not occur"). |
| 11 | RESOLVED | COMMON lines 8 to 10. |
| 12 | RESOLVED | `engine.cjs` derives the boundary from the bulk stamp; `gate_run.cjs` line 20 asserts it equals the log-based one (both seq 72). |
| 13 | RESOLVED | `replay/LOG.md` line 47. |
| 14 | RESOLVED | `R8A_CODE_DIFF.md` lines 97 and 103. |
| 15 | RESOLVED | W5 H7 treats the due-time factor as moving the truth only. |
| 16 | RESOLVED | `OUT_DICTIONARY.md` truth section. |
| 17 | RESOLVED | None of those claims is in the analysts' reading list. |
| 18 | RESOLVED | `replay/LOG.md`. |

**(a) Pre-existing rows unchanged.** I checked this against my own scratch rerun from the first audit, not the builder's
script. Every row of the first audit's `replay_runs.csv` (1,100), `truth.csv` (1,100), `replay_2x2x2.csv` (4,400),
`labels.csv` (275), `fidelity_table.csv` (12,880), `cell_identity_test.csv` (560), `iteration_limit_share.csv` (76) and
`truth_gate.csv` (20) exists in the new outputs with every old column equal. 0 cells differ; the only new column is
`gate_miss`. In `f_old_values.csv` all 3,576 rows have every old column equal; rule C is two appended columns. The tidy
tables are byte-identical to the first audit's rebuild except `DICTIONARY.md` and `BUILD_REPORT.json` (as the data builder
says). One expected side effect: `t1_missing` is 16 for `S-old-C` against 15 for the other scenarios, because one due time
differs.

**(b) The `build_f_old.py` disclosure: the final definition is clean.**
- The first implementation contradicted the definition as written beforehand. Rule 2 already fixed the window end at "the
  19:00 UTC run of 13 Nov, reading 17:55". Classifying seq 212 (18 Nov) as an old pair broke that rule.
- The correction brings the code back to the written rule. It is now also confirmed by a criterion that uses neither the
  test nor any logged value: the boundary from the bulk stamp, asserted equal (seq 72).
- The corrected knot (1.14 ft) equals the old curve of 9 to 12 Oct in the archive at that level. The archive is not part of
  the curve window, so this confirmation is independent.
- The change was made with the 3 misses in view, so the 77-reading test is no longer a fully blind test of the
  classification. It remains a valid constancy test of the curve. State that in the report.

**(c) The transient failure: your hypothesis is consistent with the file times, and the delivered outputs are good.**
- Every pre-existing tidy table carries a modification time of 09:31:11 to 09:31:52 EST (14:31 UTC) on 23 Nov. The file
  creation times are still those of 22 Nov, so the files were rewritten in place. That falls inside the builder's failure
  window (09:28 to 09:45 local, `replay/LOG.md` line 53).
- A reader of a CSV being rewritten in place sees a truncated file. That gives exactly the symptoms logged: runs whose
  readings cannot be found, 0 or 88 of 106 Gate B runs replayed, a TypeError later.
- Only the 14:31 rewrite is visible in the file times. Whether all three failures fell inside it cannot be proven, because
  an earlier rewrite in the same window leaves no trace.
- What settles trust: a fresh rerun in my scratch (copy of `replay/` and `data/tidy/` as of 14:40 UTC) reproduces
  `replay/out/` (all 9 tables) and `replay/f_old/` (all 8 files) byte for byte. Only the ruling text differs.
- Recommendation: `run_all.sh` should verify SHA-256 hashes of the tidy tables it reads against a list written by
  `tools/03`. The builder's new guard (stop unless 280 of 280 runs replay) catches a partial gate but not a silently wrong
  value.

**(d) `withdrawals_coop.csv`.**
- All 50 rows were compared cell by cell with the researcher's table, which I had verified in the first audit against all 50
  saved pages with my own parser. 13 shared columns, 650 cells: the only difference is node 825's Point of Rocks flow
  (now 1727 with flag `*`, as on the page).
- Spot-read against the saved pages: 825, 836, 837, 810, 812, 822 and 846. Flags match the pages: `(estimate)` on 810, `*`
  on 836 Little Falls and the commission flow, `Not available` on 836 and 837, `Not available due to ice` on 822.
- `withdrawal_date` is unique (assertion of R4(b) holds).

**(e) `boot_uniforms.csv`.**
- Reproduced byte for byte by running `tools/08_make_boot_uniforms.py` in scratch.
- The numbers are written with 12 decimals, and both languages parse a decimal string to the same double, so `floor(u * D)`
  is identical.
- The use prescribed in COMMON section 4 is not fully defined for groups and for undefined statistics: S-6 below.

---

### Part 2. Review of the analysis specification

#### Coverage of my 17 points

Covered and correct: 1, 2, 3, 4, 6, 7, 9, 10, 11, 13, 14, 16, 17. Partial:
- **5** (field measurements): the duplicate rule is there, but the pairing rule cannot be applied as written. See S-4.
- **8** (level bands of the old curve): the extrapolation share counts `observed_oct_knot` as extrapolated. See S-12.
- **12** (approximate scenario finals): `R5_chain` tabulates scenario `corr_c` and `final_cfs` beside S0 without the
  approximate flag. See S-13.
- **15** (moving-average edge handling): not settled. See S-1.

#### MAJOR

**S-1. Series preparation: window, edges and grid anchor are open (COMMON section 3).**
Points 1 to 3 do not say:
- over which window a series is prepared;
- where the grid starts;
- whether grid points outside the window count as missing in the 24-hour moving average.

At the window edges the moving average is then either undefined or one-sided. Both readings are plausible, and they give
different event days, wave sizes, crest times and onsets.

Replace point 1's first sentence and point 2 with:
> "1. Grid. Prepare each series once, over its preparation window: Part W, 2026-09-01T00:00:00Z to 2026-11-22T10:00:00Z;
> W3(4), 2026-06-12T00:00:00Z to the cutoff; R4, 2026-08-31T00:00:00Z to the cutoff; W7, the whole file. Select days or
> points from the prepared series afterwards; never re-prepare on a sub-window. The grid starts at the window start and
> includes every multiple of the step up to and including the window end. The step is the most frequent difference between
> consecutive non-blank readings of the series inside the window. ...
> 2. Moving average MA(t): defined only if t - 12 h and t + 12 h both lie inside the preparation window and at least 95% of
> the grid points in the closed interval [t - 12 h, t + 12 h] (289 points at 5 minutes, 97 at 15 minutes, 25 at 60 minutes)
> are non-missing; then the mean of the non-missing ones."

**S-2. Lagged correlations are not determined (W2 instrument and upstream tests, W3(2)).**
Open points:
- which series is the base grid when steps differ (EF is 15-minute; PoR and LF are 5-minute);
- how the event-day exclusion applies to the shifted point;
- whether the Pearson mean and standard deviation are recomputed per lag;
- what counts as a local maximum.

Add to COMMON section 3 as point 10:
> "10. Lagged correlation r(L) of series x (upstream or first-named) and y (downstream or second-named), lag L >= 0 meaning
> y later: evaluate on the 5-minute grid if both series are 5-minute, otherwise on the 15-minute grid (all grids are
> anchored at 00:00 UTC, so every 15-minute point is also a 5-minute point; no interpolation between series). For a lag
> step of 5 minutes with a 15-minute series (W3(2) pairs with EF), first interpolate the 15-minute detrended values linearly
> to the 5-minute grid between two non-missing neighbours 15 minutes apart, never across a missing value. The pairs used
> at lag L are all t with d_x(t) and d_y(t + L) non-missing, the UTC day of t a non-event day for x and the UTC day of
> t + L a non-event day for y, and both days inside the analysis window. r(L) is the Pearson correlation of those pairs,
> with means and standard deviations recomputed for each L; n_points is their number at the reported lag. A local maximum
> is an interior lag with r(L) > r(L - step) and r(L) >= r(L + step); the two end lags are never local maxima. Ties for
> the largest r go to the smallest lag."

**S-3. Truth for S0 logged at seq 212 is read at the replayed due time, not the one that ran (COMMON, "Truth").**
The replayed due time of seq 212 is 236 s earlier than the logged one. With the rule "for S0 logged use the row (seq, S0)",
the logged estimate is scored at a moment it was not due. Add:
> "Exception: for seq 212 compute T1 of S0 logged yourself at `runs.due_utc` by linear interpolation between the
> neighbouring non-blank Little Falls flow readings of `readings_current_census.csv`, the same rule as `truth.csv`. Report
> both values."

**S-4. Field-visit pairing cannot be applied as written (R3.1, R3.3, R4(0)).**
- Since 2021, 86 visits (`field_visit_id`) do not have exactly one discharge row and one gauge-height row.
- Many visits have only `ReferencePrimary` gauge readings (an inspection without a discharge measurement); some have 2 to 6
  of them.
- One Little Falls visit has two discharge rows.

"Visits per year", "days since last visit" and `level_ft` therefore depend on unstated choices. Replace R3.1's second and
third sentences with:
> "A visit is a distinct `field_visit_id` of the gauge. `flow_cfs` = `value` of its row with `parameter_code = 00060` and
> `reading_type = Discharge`; `level_ft` = `value` of its row with `parameter_code = 00065` and `reading_type =
> MeanGageHeight`; ignore `ReferencePrimary` rows except to count them. If a visit has more than one row of one of these two
> kinds, use the one with the latest `last_modified`, then the largest `feature_id` in text order, and count such visits.
> `visit_time_utc` = that of the Discharge row if present, else the earliest `visit_time_utc` of the visit. Visits per year
> and median days between visits count every visit (with or without a discharge); days are `(t2 - t1)` in fractional days.
> `days_since_last_visit` uses visits with a discharge only."

**S-5. The labels' "interval of abs(x)" and the share p are ambiguous (COMMON section 4, W5).**
Two analysts can take abs of the endpoints or quantiles of abs, and can resample p as a ratio or divide the interval by a
fixed denominator. Labels must match exactly. Replace the "Labels" paragraph with:
> "Labels (only where a spec asks for one). Let [lo, hi] be the interval of the difference x (points). Its magnitude
> interval is: [min(abs lo, abs hi), max(abs lo, abs hi)] if lo and hi have the same sign, else [0, max(abs lo, abs hi)].
> For a cycle row, the share p = diff / c_ref, where c_ref is the cycle of e_raw of S0 logged in phase NEW, recomputed in
> the same resample (ratio per resample; resamples with c_ref = 0 are undefined), and the magnitude interval of p is built
> the same way from its own [lo, hi]. A row is labelled from its own quantity only (MAE rows from x, cycle rows from p):
> "matters" if the magnitude interval lies at or above 1.0 point (MAE) or 10% (cycle); "does not matter" if it lies below
> 0.5 point or 5%; "small" if it lies within [0.5, 1.0) or [5%, 10%); otherwise "undetermined". Rows of H2 and H8 (not in
> points of error) get no label."

**S-6. Resampling is not defined for two groups that share a day, for recomputed validity, or for empty draws (COMMON
section 4; W4, R8(a), R5).**
- A UTC day can hold runs of two phases (13 Nov: OLD and TRANS) or both sides of the switch (17 Nov).
- `cycle_size` depends on which hours have at least 3 runs, and that changes in a resample.

Add to section 4:
> "In a two-group statistic, the blocks of each group are the UTC days that contain at least one row of that group; a
> drawn block contributes only that group's rows. Validity thresholds (for example 'hours with at least 3 runs') are
> re-applied inside each resample. A resample whose statistic is undefined is skipped and counted; if more than 5% are
> skipped, report the interval as blank and the count. Assert D <= 60 and D2 <= 60."

**S-7. R4 bands: not derived by the plan's rule, and the R4(a) centre is calibrated on a choice that can decide the verdict
(R4(a), (b)).**
PLAN R4 says the band "comes from the ratings USGS gives its own measurements at the gauges involved ... combined". The spec
instead fixes 11.3% (two "Fair" gauges in quadrature) for both (a) and (b).

Two problems:
- **The band.** The Point of Rocks measurements in the window are rated Poor (3 Sep, 8 Oct) and Fair (10 Nov), and the
  rule maps Poor to 15%. The band width is a lever on the verdict, and it was set by someone who knows the size of the
  revision.
- **The centre.** `c`, the centre in R4(a), is the median new/upstream ratio on unrevised days. That assumes the unrevised
  part of the record was right, which is part of what R4 asks. If the unrevised days were already off, the test is tilted
  by construction.

Replace in R4(a):
> "band = [c / (1 + b), c * (1 + b)] with b = sqrt(b_PoR^2 + b_U^2), where b_PoR is the band of the rating of the latest
> Point of Rocks measurement with a flow on or before the day (from R3), and b_U is the band of the worst rating among the
> latest measurements of the four U gauges on or before 2026-11-22 (from R4(0) and the upstream visits). Report the verdict
> for two centres: c = 1.03 (fixed, the ungauged share of the drainage area; main result) and c = the median of ratio_new
> over steady unrevised days (sensitivity; if fewer than 10 days, not computed). Also report the verdict with b = 0.113
> (sensitivity)."

and in R4(b):
> "band = b% of the median LF of those days with b = sqrt(b_PoR^2 + b_LF^2) from the latest ratings as above; also report
> with b = 11.3%."

**S-8. W3's mechanical decision compares two different quantities (W3, "Decision, mechanical").**
- The size method's `k_days` is the UTC-day offset between daily wave sizes.
- `floor(median_lag_h / 24)` from (4) is the whole-day part of the delay.

For a delay of 24n + h hours, the size signal of day D falls mostly into day D + n when h < 12 and into D + n + 1 when
h >= 12. So the two can disagree, or agree wrongly, by construction. Replace the `whole_days` sentence with:
> "Let h = hours_within_day if defined, else the PoR to LF lag_h_mod_24 of nov_all. From (1), if decisive: n1 = k_days if
> h < 12, else k_days - 1. From (4), if at least three matched onsets below 3,000 cfs exist: n4 = round((median_lag_h - h) /
> 24) (half away from zero). whole_days is "resolved" with that n if n1 and n4 both exist and are equal, or only one exists;
> otherwise "unresolved". total_delay_h = 24 * whole_days + h when resolved."

**S-9. H1's verdict rule from the plan is missing (W5).**
PLAN W5: "H1 is supported only if the delay measured in W3 sides with one scenario's choice of reading." The spec reports
the difference and `trv_t_of_pick_h` but has no rule, so the verdict would be decided after the results. Add to H1:
> "H1 verdict: if W3 is resolved, compare total_delay_h with the mean of trv_t_of_pick_h + gf2lf_h over the NEW-phase used
> runs of cell (new,new,new) and of cell (new,old,new) (old_rule B; A and C as sensitivity). "supported" if W3's
> total_delay_h is closer to one of the two means by at least 2 hours and that cell has the smaller MAE; "not supported" if
> it is closer to the cell with the larger MAE by at least 2 hours; otherwise, or if W3 is unresolved, "undetermined"."

#### MINOR

- **S-10. Phase assignment of daily quantities (R8(b), W5 H8).** A day can contain runs of two phases. Add: "a daily mean
  for a phase uses only that phase's runs; a day enters a phase's regression if it has at least 3 runs of that phase"; and
  in R8(b): "the day of a run is the UTC day of `at_utc`".
- **S-11. Column names of the replayed scenarios (R5 `R5_chain`).** `replay_runs.csv` has `trv_t_h`, `trv_gf2lf_h`,
  `hist_ago_h` and `iteration_limit`, not `trv_t`, `trv_gf2lf`, `hist_ago` and `trv_stop`. Add: "for replayed scenarios use
  `trv_t_h`, `trv_gf2lf_h`, `hist_ago_h`, `iteration_limit = 1`".
- **S-12. Extrapolation share for rule C (R5).** "not `observed`" counts `observed_oct_knot` as extrapolated. Replace with:
  "share whose flag is `extrapolated_low` or `extrapolated_high`; report `observed_oct_knot` separately (S-old-C)".
- **S-13. Approximate scenario finals (R5 `R5_chain`).** Add a column `approx_final` (1 for scenarios) and the sentence: "the
  means of `corr_c` and `final_cfs` of scenarios use frozen bins and are not comparable with S0 logged".
- **S-14. `gate_miss` source.** `runs.csv` has no `gate_miss`. Add: "take `gate_miss` from `labels.csv` by `seq`".
- **S-15. Level bands and floating point (R1.5, R1.7).** Add: "work with levels as integers in hundredths of a foot
  (round(level * 100)); bands are half-open on those integers".
- **S-16. Shift inverse on flat stretches (R1.6).** Add: "`h*` is the smallest level at which the interpolated, non-decreasing
  L reaches the pair's current flow; a flow equal to L's maximum maps to the smallest level where that maximum is reached".
- **S-17. Unstated directions and closures.**
  - W2 weekend `ratio` = `median_A_a_weekend / median_A_a_weekdays`.
  - W3 damping ratio = LF / PoR, with columns `period, n_days, median_A_a_rel_lf_flow, median_A_a_rel_por_flow,
    ratio_lf_over_por, median_A_a_por_level, median_A_a_ef_level, median_A_a_lf_level`.
  - W7 classes are half-open `[lo, hi)`.
  - W3(4) match window is closed `[0, 96]` h.
  - R4(a) days 3 Sep to 9 Nov are inclusive.
  - R3.3 `n_bulk_within_7_days_after_a_visit` means `days_since_last_visit <= 7`; `span_days` is fractional days.
- **S-18. Crest definition (COMMON 3.7).** Add: "crest and trough are defined only if `A_a(D)` is defined"; W4 `crest_hour`
  ties go to the earliest hour.
- **S-19. W1 metrics.** `lf_flow_step_cfs`: say "of the raw readings (not the grid)"; `lf_median_A_a_in_steps`: "over
  non-event days of 10 to 22 Nov".
- **S-20. W3(1) pairs.** Name them: "PoR-LF, PoR-EF, EF-LF". For each pair, use days where both `A_a` are defined and both
  days are non-event at their own gauge.
- **S-21. W4 `share_of_variance_by_hour` and `sd_remainder`.** Say whether runs in non-valid hours are included. Proposed:
  "over runs in valid hours only".
- **S-22. R6 `checks_per_day_NEW`.** "Days" = fractional days from the `created_at_utc` of the first NEW check to the cutoff.
- **S-23. R7 `R7_bins`.** Say whether the `stage_` bins are included. Proposed: "flow bins only (18)". `sd` is blank in those
  rows; say "compute sd = sqrt((sum_sq - sum^2 / n) / (n - 1))" or drop the column.

#### NOTE

- **S-24. W1's start, weakening and strengthening dates.** PLAN W1 asks for these dates; the spec gives the daily table but no
  rule. Either add a rule or state that the report reads them off `W1_daily` descriptively.
- **S-25. Period P2 starts on 15 Sep.** That is the documented eel-season date from the research notes. The choice is
  hypothesis-driven, not data-driven, and the spec should say so in one line.
- **S-26. R4(b) uses the net withdrawal.** The Loudoun Broad Run discharge may already be in the Broad Run gauge (in T), which
  would count it twice. It is small. State it.
- **S-27. Main old rule B.** R8 and H5/H8 use rule B as "the" old rule. That is a pre-fixed choice; report A and C as
  sensitivities in the same tables.
- **S-28. PLAN R4(d).** The intake map in words is research, not an analyst task; the report should take it from
  `research/WITHDRAWALS_AND_INTAKES.md`.

#### Other checks of part 2

- **Column names checked against the headers:** `runs.csv`, `checks.csv`, `bins.csv`, `field_measurements.csv`,
  `withdrawals_coop.csv`, `replay_runs.csv`, `truth.csv`, `labels.csv`, `replay_2x2x2.csv` and `f_old_values.csv`, plus the
  W7 files (`hourly_backtest_data_v39.csv`: `timestamp, por_now, lf_discharge`; `shadow_F.csv`: `predTs, status,
  truthDependentHard, truthInProdRange, truthFlow, errPctRaw, errPctCorr`, values `0`/`1`). Every input name the specs use
  exists, except the ones in S-11 and S-14. W7's `timestamp` has the form `2011-12-01 05:00` (no `Z`); say so.
- **Feasibility with the standard library and base R:** nothing is impractical.
  - The largest jobs are the W3(2) cross-correlations: about 6,300 points x 865 lags x 3 pairs x 3 windows, about 50 million
    multiply-adds, under a minute in pure Python.
  - The W3(4) moving average over 47,000 points: compute it with a running sum, not by rescanning 289 points each time.
  - The 2,000 resamples of every statistic are small (at most a few hundred rows each).
  - No cheaper equivalent is needed. Advise running sums for every moving average.
- **Blindness:** nothing in the allowed files states an expected result.
  - `DICTIONARY.md` does not quote the commission's free text.
  - `replay_lag_2026-11-17/README.md` holds counts only (the builder's disclosure of error-dependent tallies it saw names no
    figures).
  - The hypothesis names in W5 are the plan's and carry no direction.
  - Period P6/P7's boundary (13/14 Nov) and COMMON's sentence on USGS rewrites tell the Part W analysts that something
    happened around 13 Nov. That is unavoidable and harmless.

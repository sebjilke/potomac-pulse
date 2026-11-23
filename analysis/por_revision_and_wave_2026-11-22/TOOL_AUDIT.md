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

Status: IN PROGRESS (written incrementally).


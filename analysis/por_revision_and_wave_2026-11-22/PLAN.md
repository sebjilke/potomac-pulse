# Study plan: the Point of Rocks revision and the daily wave (November 2026)

**Status:** v3, 2026-11-22 (UTC). Revised twice by the orchestrator after the independent plan audit
(`PLAN_AUDIT.md`). First audit: NO-GO as written, 2 blockers, 9 major, 12 minor, 2 notes; all 25 accepted.
Re-check of v2 by the same auditor: GO WITH CHANGES, no blockers, 13 new findings (6 major); all 13 accepted
(section 12). Earlier versions are kept as `PLAN_v1_2026-11-22.md` and `PLAN_v2_2026-11-22.md`. Not yet
confirmed by the owner. No analysis code has been written.
Nothing in the app, the hourly job or the database is changed by this study.

**Owner's request (2026-11-22):** "study the wave, and do the same for the USGS correction. I wanna fully
understand both patterns before discussing remedies!"

## 0. In plain words

Since 14 November the Great Falls estimate has been off by about 14% on average (2.6% in the days before, 7.4%
long-run). Two patterns are involved:

1. **The revision.** On 13 November USGS rewrote its published flow at Point of Rocks: about 30% more flow at
   the same water level. Point of Rocks is the model's main input.
2. **The daily wave.** The river at Point of Rocks goes up and down by about 0.2 ft every day. The estimate
   follows that wave poorly, and apparently worse since the revision.

The audit changed how the revision must be studied. There are two readings of it, and v1 could only see one:

- **Reading A, "the revision disturbed the model":** the input changed and the learned corrections, tuned to
  the old numbers, have to catch up.
- **Reading B, "the revision fixed the input":** the old numbers were too low (debris at the gauge), the new
  ones are right, and the 20% gap that is now visible is the drinking-water withdrawals between Point of Rocks
  and Little Falls, which the old error happened to hide.

Both can be true at once. Which share belongs to which matters for any later remedy, so the study must be able
to tell them apart. It also must separate a third thing the audit found: part of the break began on an estimate
made with old numbers, so something besides the revision moved too (the falling river, the wave, the share of
the withdrawals).

The study is descriptive. It proposes no remedy and changes nothing.

## 1. First pass, and what the audit already did to it

First-pass numbers by the orchestrator (2026-11-22). The auditor re-derived most of them. None is an input to
the study; all are re-derived from frozen files.

| First-pass claim | Audit |
|---|---|
| Error shown in the app: 2.6% mean absolute over 5 checks (11 to 13 Nov), 14.3% over 15 checks (14 to 21 Nov) | reproduced |
| Raw estimate about 7% low before, about 21% high after, "15 of 15 too high since the revision" | numbers reproduced; **the label is wrong**: the first of the 15 was predicted at 17:01 on 13 Nov with old numbers only, and was already at +4.8% (the five before it: -9.0 to -5.8%) |
| Job log 13 Nov 16:55 UTC: 1.14 ft, 1,440 cfs; USGS today: 1,860 cfs, last modified 13 Nov 19:41:13 | reproduced |
| Field measurements: 8 Oct 1.20 ft 1,510 cfs "Debris - Moderate"; 10 Nov 1.20 ft 1,980 cfs "Clear" | reproduced; added: 8 Oct and 3 Sep were rated **Poor**, 10 Nov Fair |
| "Entered 13 Nov 20:34" | **wrong reading**: all 12 records since June carry that same stamp; it says nothing about entry |
| "For 38 hours the model saw a rise of up to 44% that did not exist" | 44% reproduced; **refined**: the flow state was wrongly "rising" on four runs only (20:00 to 23:00 on 13 Nov); the time-shifted reading stayed old until about 15 Nov 07:00 |
| "The model derives its travel time from the Point of Rocks flow number" | **imprecise**: it starts from Little Falls flow, then iterates on the time-shifted Point of Rocks reading; 38 of 280 runs stop at the iteration limit |
| "Old Point of Rocks flows survive in three places only" | **false**: a 5-minute archive of 12 Jun to 9 Nov, pulled 10 Nov, is in the repository |
| Two frozen hourly datasets "overlap; differences are revisions" | **false**: one contains the other verbatim (0 of 126,916 rows differ) |
| Morning checks about 30% raw error, evening about 18% | reproduced (4 against 4), but too few and mixed with the trend |

## 2. Questions

Tier: **core** unless marked **extended**.

### Part R: the USGS revision

- **R1. Anatomy.** Old against current Point of Rocks flow at identical timestamps, 5-minute steps, 12 Jun to
  13 Nov. Report: the first timestamp whose flow changed; the ratio new/old by date and by water level;
  whether the change is best described as a percent, a fixed number of cfs, or a shift of the level-to-flow
  curve in feet; whether it is constant over time or grows (USGS can pro-rate a shift). Free consistency test:
  the two old copies (archive of 10 Nov, October pull of 9 Nov) must agree exactly on 5 to 22 Oct.
- **R2. Was anything else revised?** The same comparison for Little Falls (flow and level), Monocacy, Goose
  Creek, Seneca Creek, Broad Run (flow), Edwards Ferry (level) and water temperature, 12 Jun to 9 Nov; and
  for the Point of Rocks level on the windows where an old level survives (October pull, job log). The
  archive has no Point of Rocks level, so old level/flow pairs use today's level; R2 tests that assumption.
- **R3. USGS's own account.** Every field measurement at Point of Rocks and at Little Falls (the truth gauge)
  that the new service offers: date, level, flow, control condition, rating of the measurement, method. A
  census of `last_modified` stamps in today's flow records of both gauges over 24 months, matched to visit
  dates: how often has USGS rewritten each record, over which spans. This is a lower bound (only the latest
  rewrite of each value is visible) and is reported as such. 25 Aug 2026 was last modified on 3 Sep, a visit
  day, so an earlier revision exists; it is described with the archive.
- **R4. Which record is closer to the river? (Reading B).** Four tests, reported whichever way they come
  out. The verdict rule is fixed here: "B supported" if the new record lies inside the uncertainty band of
  the reference and the old record outside it; "A supported" in the mirror case; "undetermined" otherwise.
  The band comes from the ratings USGS gives its own measurements at the gauges involved (a "Fair"
  measurement is taken as +/-8%, "Poor" as more than +/-8%, "Good" as +/-5%), combined across the gauges
  summed. The tests can be wrong together: the upstream gauges' provisional curves may themselves be off,
  and water is taken out and returned upstream; both are stated with every verdict.
  - (0) The most direct test: USGS's own hand measurements at Point of Rocks in the window (for example
    10 Nov: 1,980 cfs at 1.20 ft) against what the old and the new curve give at that level; and the latest
    hand measurements at the upstream gauges against their own published flow, to see whether those gauges
    were off their curves too.
  - (a) Upstream water balance: daily mean flow on steady (non-event) days, the gauges above Point of Rocks
    summed with a fixed delay (Potomac at Shepherdstown 01618000, Shenandoah at Millville 01636500, Antietam
    01619500, Catoctin 01637500, and the main-stem and tributary gauges further up as needed), as a ratio to
    the old and to the new Point of Rocks value. About 3% of the drainage area is ungauged; stated.
  - (b) Withdrawals between Point of Rocks and Little Falls, daily, from public sources (the interstate
    commission's daily reports, the utilities, the USGS "adjusted" Little Falls record 01646502). Availability
    for November 2026 is unverified; if nothing usable exists, (b) is reported as not done.
  - (c) The raw estimate's error against Little Falls plus withdrawals, before and after.
  - (d) Where each intake sits relative to Great Falls and to Little Falls, from public sources: a map in
    words of what "flow at Great Falls" and "flow at Little Falls" each include.
- **R5. Passage through the model, run by run, 10 Nov to the cutoff.** The chain: Point of Rocks flow ->
  travel time and time-shifted reading -> sum with tributaries -> rise/fall factor -> (Edwards Ferry blend:
  weight about 0.0001 at these flows, reported as inert) -> raw estimate -> flow state and bin -> learned
  correction -> 120% cap -> final estimate -> due time. For every run each Point of Rocks value used (the
  current reading, the reading 6 hours back, the time-shifted reading) is labelled old or new; phases are
  defined per component from those labels (section 5). Scenario replays with the production code (section 4)
  give a three-term split of the logged raw error, fixed in advance and named neutrally:
  - term 1, "raw error with the old numbers" (scenario S-old);
  - term 2, "change from the numbers alone" (S-new minus S-old);
  - term 3, "change from mixing old and new in the stored history" (S0 minus S-new).
  The three always add up to the logged raw error; that is arithmetic, not a finding. **The terms carry no
  verdict by themselves.** Under Reading A term 2 is a disturbance; under Reading B term 1 contains an input
  that was too low and term 2 is that error being removed. Each term is therefore reported only beside the
  R4 verdict. Further rules: the split is on the raw estimate, against truth T1, averaged per phase over the
  windows of section 5, with day-block intervals. Term 3 is zero by construction once every value a run uses
  is new; any value USGS rewrote again after a run saw it also lands in term 3 and is listed by the gate.
  Because S-old needs the old curve beyond where it was observed (section 4.3), terms 1 and 2 are reported as
  a range across the two extrapolation rules, with the share of readings that needed extrapolation.
- **R6. How the learned corrections responded.** Each bin before and after every check (`binBefore`,
  `binAfter` in `validation_log`), the checks each bin received, the gap still open at the cutoff, and the
  closing rate the learning rule implies (EMA, alpha 0.3). No forecast beyond that.
- **R7. The other flow ranges.** From R1's ratio by level and date: how much the revision changes the Point of
  Rocks number at levels typical of each of the six flow ranges; beside it each bin's current value, its
  number of checks and the date it last learned. Descriptive only.
- **R8. Other breaks inside the window.** (a) The job's code changed (v39.2, v39.6, v39.11) and its data source
  switched to the new USGS service on 17 Nov 17:01 UTC: a diff of the prediction path across the three
  versions, a replay of a sample of runs under each, and a test for a break at the switch in the inputs
  (logged readings against today's record) and in the error. (b) The recession: the rise/fall factor's decay
  is capped at 0.5, so a falling river leaves a positive raw bias; measured under "never happened".

### Part W: the daily wave

- **W1. Description.** Point of Rocks (level and flow), Edwards Ferry (level), Little Falls (level and flow),
  native time steps, 1 Sep to the cutoff: period, size (two measures, section 5), time of crest and trough,
  shape, the dates it starts, weakens or strengthens. Flood days are flagged by a fixed rule (section 5) and
  left out of the summaries. Little Falls flow moves in steps of about 40 cfs; every size at Little Falls is
  reported with that rounding noise, and on level as well as flow.
- **W2. Origin.** The same description at the upstream gauges (Shepherdstown, Hancock 01613000, Paw Paw
  01610000, Millville, and the tributaries Antietam, Conococheague 01614500, Opequon 01616500; site numbers
  confirmed against USGS site information by the builder). Which branch carries the wave and when it passes
  each gauge. Three sharp tests:
  - clock test: the clocks changed on 1 Nov. If the crest moves by one hour in UTC across that date, the wave
    follows a human schedule; if not, it does not;
  - weekdays against weekends;
  - instrument test: does the level wave at Point of Rocks appear as flow at the next gauges in proportion,
    and is it independent of the water-temperature cycle.
  The physical cause is named only if a public source documents it; otherwise "unknown".
- **W3. Travel and damping, Point of Rocks to Little Falls.** A 24-hour wave fixes the delay only up to whole
  days, and the model's assumed total is about 50 hours, two wave periods. Four estimates, with a decision
  rule fixed here: (1) matching the day-to-day changes of the wave's size; (2) the two legs via Edwards Ferry
  must add up; (3) individual crests; (4) the speed of distinct, non-periodic disturbances at similar flows
  (onsets of rises in the 5-minute and hourly records). Estimates (2) and (3) can only fix the hours within
  a day; they can agree with each other and still be wrong by a whole day. So: the hours come from (2) and
  (3), which must agree within 2 hours; the number of whole days comes from (1) and (4). The delay is
  "resolved" only if (1) and (4) give the same number of days, or one of them is decisive and the other has
  nothing to say. (1) is decisive only if a weak day (wave size below 60% of the median of the three days on
  either side) is visible at both gauges. Otherwise the delay is reported as "hours known, days unresolved".
  The result is set against the model's assumed times, and checked for continuity across the revision.
- **W4. How the model passes the wave on.** For each component of R5's chain: daily size and timing, by phase,
  against the truth. Every hourly estimate is scored, not only the roughly two a day the job checks. The
  hourly error is split into a constant offset, a daily cycle (mean by hour of day) and the remainder.
- **W5. Why is the wave tracked worse since the revision, if it is?** Nine candidates. Each gets the
  observation that would support or reject it, with thresholds as in section 5:
  - H1 mistiming of the time-shifted reading (the travel time is iterated on a Point of Rocks number that rose
    30% while the river did not speed up). Test: the 2 x 2 x 2 of section 4 shows how much the error depends
    on which reading is picked; that alone does not show mistiming. H1 is supported only if the delay
    measured in W3 sides with one scenario's choice of reading.
  - H2 the wave itself changed. Test: W1 and W3, before and after.
  - H3 the rise/fall factor reacts differently to the new numbers. Test: its daily cycle in the replays.
  - H4 switching between the three state corrections over the day. Test: daily cycle of raw against final.
  - H5 nothing changed; too few checks. Test: hourly scoring with day-block uncertainty.
  - H6 the 120% cap: it uses Little Falls at prediction time and so passes Little Falls' own wave into the
    estimate about 13 hours out of step; it bound on 6 of 15 checks after the revision, none before.
  - H7 the due time: the same multiplier sets the Great Falls to Little Falls time, so the revision moved the
    moment at which the truth is sampled by 1 to 2 hours.
  - H8 the fixed 100-cfs threshold of the flow state: the revision scaled the wave in cfs by about 1.3 while
    the threshold stayed, so states may flip more often. Test: flips per day under each scenario.
  - H9 part of Little Falls' daily swing is the daily rhythm of pumping, not the river's wave. A daily rhythm
    cannot be seen in daily totals, and Edwards Ferry lies above the main intakes. Unless hourly pumping data
    are found, H9 is expected to end "undetermined", and the report will say so.
- **W6. What the job's own checks see.** At which times of day the checks fall, which part of the daily error
  cycle they sample, which phase of the wave feeds each state bin.
- **W7 (extended). Is this a recurring pattern?** (a) 2011 to 2026 hourly flow at Point of Rocks and Little
  Falls (`rising-limb-travel-backtest/hourly_backtest_data_v39.csv`): days with a daily wave, by flow, season
  and year. (b) In the existing 2011 to 2026 replay of the production model (`replay_lag_2026-11-17`, arm F):
  error by size of the wave that day.

## 3. Data, and how it is frozen

USGS rewrites provisional data. Every USGS request of this study is saved raw with its request time and a
SHA-256 before anything is computed; analysts read only frozen files. The cutoff of the study window is the
last full hour before the freeze script runs, recorded in the manifest; nothing later is added.

| Data | Source | Covers | Old Point of Rocks flow? |
|---|---|---|---|
| `rising-limb-travel-backtest/raw/` (55 files, 23 MB, SHA-256 in `FETCH_MANIFEST.json`) | old USGS service, pulled 2026-11-10; **not in git, this machine only** | 5-minute, 12 Jun to 9 Nov 23:55 UTC: Point of Rocks flow and temperature, Little Falls flow and level, Monocacy, Goose, Broad Run, Seneca flow, Edwards Ferry level | **yes, complete** |
| `pulse-audit-2026-10/audit_inputs.tar.gz` -> `usgs_iv_2026-10-05_2026-10-22.json` | old service, pulled about 2026-11-09 | 5-minute, 5 to 22 Oct, 7 gauges, flow, level, temperature | yes, with level |
| `tick_log` | Supabase, read-only `SELECT`, saved with the query text | hourly runs since 10 Nov 21:00 UTC: inputs with reading times, intermediate values, estimate, due time | yes, to 13 Nov 17:55 (one reading per run) |
| `validation_log`, `bin_snapshot` | Supabase, read-only | every check since 11 Nov; daily bin snapshots | n/a |
| USGS new service, `continuous`, with `last_modified` and approval status | new pull | 12 Jun to cutoff for the model gauges; 1 Sep to cutoff for the upstream gauges; 24 months of Point of Rocks and Little Falls flow for the R3 census | no (current record) |
| USGS new service, `field-measurements` | new pull | Point of Rocks, Little Falls, all years offered | n/a |
| Withdrawal data | public web sources, saved as retrieved with address and date | as available | n/a |
| `hourly_backtest_data_v39.csv` (with provenance file), `replay_lag_2026-11-17` shadow files (regenerated by `run_all.sh`) | repository | hourly, 2011-12 to 2026-11-09 | n/a (W7) |

Rules. Every CSV has a generating script. No row is dropped or added without a count. The archive is copied
read-only into the study folder and its hashes are checked against the manifest first. Old-service files carry
local offsets (-04:00 before 1 Nov, -05:00 after), the new service UTC: all times are parsed to UTC, one
reading on each side of 1 Nov is checked by hand. `tick_log` has hours with two or three rows and hours with
none: the row used per clock hour is the first whose outcome is `predicted`; error rows and empty hours are
counted and listed. Files over 5 MB are not committed; hashes and scripts are. No USGS key is used; if the
keyless limit stops a pull, the builder stops and reports. The 24-month census of R3 is the largest pull
(about 210,000 values per gauge): it requests only time, value and `last_modified`, in pages of up to 50,000
rows with a pause between pages; if refused, it is narrowed to 12 months, and if refused again it is reported
as not done.

## 4. Tools to build, and their gates

1. **Freeze script and manifest.**
2. **Tidy tables**: readings (gauge, parameter, time, value, source file, pull time, old or current), runs
   (flattened `tick_log`), checks. Gate: counts reconcile with the raw files; 20 random cells traced by the
   tool auditor.
3. **Old curve `f_old(level)`**: the level-to-flow lookup USGS used before the revision. It is needed in two
   places. (i) To rebuild what the job stored for 10 Nov 00:00 to 13 Nov 17:55, where no old 5-minute flow
   survives. (ii) For scenario S-old, for **every** reading from 10 Nov to the cutoff. Use (ii) is an
   extrapolation twice over, and is reported as one: in time (no old value exists after 13 Nov 17:55, so
   S-old means "the curve in force on the last old days, kept unchanged") and in level (old pairs of the job
   log span 1.03 to 1.21 ft; later levels go down to about 0.93 ft). The curve is fitted per day, to detect a
   shift that varies in time, on the hourly `in.por` readings of the job log and on archive flow with
   today's level; S-old uses the fit of the last old days, not a pooled fit across months that had other
   shifts. Order of work: R2's level test first (logged `in.por.h` against today's level at the same
   timestamp), because every pair relies on the level not having been revised. **Test set, separate from the
   fit set:** the logged time-shifted readings stamped 10 Nov 00:00 to 13 Nov 17:55 whose timestamps are not
   among the fitted pairs. Levels outside the fitted range are extrapolated by two fixed rules (linear in
   level through the two lowest fitted points; constant ratio to the current record), carried as bounds.
4. **Replay tool.** Runs the production prediction code (frozen export, `makeGFPrediction` and the shared
   helpers imported unchanged; no network, no database) once per run. The clock is frozen at each run's
   logged `final.ts` (the moment the prediction was computed, 1 to 3 seconds after the run's start). The
   stored Point of Rocks history is rebuilt only from frozen data with the job's own rule (first value seen
   per timestamp is kept): archive values to 9 Nov 23:55, `f_old` to the last old reading, current values
   after. All other inputs (Little Falls, tributaries, Edwards Ferry, temperature) come from the frozen
   record at the logged reading times. **Logged values are targets of the gate, never inputs.** Post-switch
   runs go through the adapter. The commit of the frozen export is recorded.
   **Fidelity gate, before any scenario is run.** The replay of the as-run inputs must reproduce, run by
   run, every logged value: `hist.ts/cfs/ago`, `rise.r/rst`, `trv.t/t0/it/stop/gf2lf/mult`,
   `delta.pct/ratio`, `pre.cfs`, `raw.cfs`, `corr.c/st/bin`, `ceil`, `final`, `due`, and
   `in.porHist.n/firstT/lastT`. The tolerance per field is written into the spec before the run (the logged
   rounding; `due` within 5 seconds). Rates are tabulated per field. The gate has two parts:
   - Gate A, runs built only from frozen USGS values: at most 3 runs may miss, each in a category listed
     beforehand (a reading not yet published at run time; a duplicate-run row; a value USGS rewrote after the
     run). More, or any other kind, and the study stops for a ruling.
   - Gate B, runs that use `f_old` (about 85 to 90, roughly 11 Nov 16:00 to 15 Nov 07:00): every time-shifted
     value within one 20-cfs step of the logged one, at least 95% exact, the 6-hour readings checked through
     `rise.r`. If B fails, the as-run replay of those runs is labelled "approximate" and the report carries
     the label; it is not a stop.
   Scenarios:
   - S0: as stored by the job (old and new mixed by the first-seen rule).
   - S-old, "never happened": every Point of Rocks flow is `f_old(level)` or the archive value.
   - S-new, "revised from the start": every Point of Rocks flow is the current record.
   - The 2 x 2 x 2 for H1 and H7: (flow numbers old/new) x (which reading the time shift picks, taken from the
     S-old or the S-new run) x (due time, from the S-old or the S-new run). The production function has no
     hook for this (the reading is chosen inside it), so the mixed cells use a small separate copy of the
     steps after the iteration: time-shifted value, plus tributaries, times the rise/fall factor. That copy
     is audited, and it must reproduce the production function exactly in the two pure cells before any
     mixed cell is reported. In mixed cells the iteration and the rise-rate shortening are not re-run; they
     are the thing being swapped. Where the swapped timestamp has no reading in the other scenario's
     history, the job's own one-hour match window applies; if nothing falls inside it, the cell is empty for
     that run and counted. Little Falls inputs, the 120% cap and the first travel time use the same frozen
     Little Falls values in every cell. The 2 x 2 x 2 is on the raw estimate only: the flow state also
     changes between scenarios, which moves the learned correction but not the raw estimate.
   The share of runs stopping at the iteration limit is reported by phase and scenario.
   Scenarios replay the raw estimate. A scenario's final estimate uses the bins frozen at their last state
   before the first revised reading and is labelled "approximate". Learning is not replayed.
5. **Truth series**: Little Falls at each estimate's due time. T1: interpolated between neighbouring readings.
   T2: the reading the job would use at its first run at or after the due time (1 to 66 minutes later). Gate:
   T2 reproduces `actualCFS` of every logged check. The check predicted before the log begins (10 Nov 19:01)
   cannot be replayed and is listed as such.

An independent auditor (Opus) reviews tools 1 to 5 before the analysts start.

## 5. Definitions

- UTC throughout. Hour of day is given in local time of the **due** time for error cycles and of the reading
  for the wave, both stated on every table.
- Error = (estimate - truth) / truth x 100; positive is too high. "Raw" is before the learned correction,
  "final" is what the app shows.
- **Every before/after label is keyed on the prediction's run time and on the old/new labels of the values
  that entered it, never on the check time.** Per component: "old" while the value it uses is old, "new"
  when it is new, "mixed" when the component combines one of each. The boundary is the last old reading in
  the stored history (between the 17:55 and 18:00 readings of 13 Nov; the builder confirms it from the log).
- Wave size, two measures that must tell the same story: (a) half of (max - min) per 24 hours of the series
  minus its centred 24-hour moving average (edges: the first and last 12 hours are not reported); (b)
  amplitude and phase of a 24-hour cosine with a straight-line trend fitted over sliding 72-hour windows.
- Flood rule, per gauge: a UTC day is an "event day" at a gauge if that gauge's centred 24-hour mean flow at
  the end of the day differs from its value at the start by more than 10% (for a gauge with level only: by
  more than 0.10 ft). Event days are left out of that gauge's wave summaries; a comparison between two gauges
  leaves out a day that is an event day at either.
- Delay: lag of the maximum cross-correlation after the same detrending, all local maxima reported; decided as
  in W3.
- Thresholds for W5 and R8: a candidate "matters" if it accounts for at least 2 points of error (percent of
  flow) or at least 20% of the daily error cycle's size; "does not matter" below 1 point and 10%; "small" in
  between. Fixed here, before any result. "The daily error cycle's size" is half the range of the mean error
  by hour of day. "Accounts for" is, for each candidate, one named difference between two computations on the
  same runs (for example H6: the final estimate with the cap minus without it); the spec names the
  difference for every candidate before any result. A label is given only if the day-block interval of that
  difference lies wholly inside the label's band; otherwise the result is "undetermined". With about eight
  days after the revision, "undetermined" is a likely and acceptable outcome for some candidates.

## 6. Expectations written before any result

Kept from v1 for the record. The audit showed one is already contradicted ("never happened" would look like 11
to 13 Nov) and that others could steer choices. They are therefore **not reliable and no method choice may
refer to them**: revision ratio about 1.25 to 1.32 at low levels and smaller at flood levels; no other gauge
revised; 24-hour wave on every day since at least 10 Nov, weaker on 15 and 16 Nov; wave at Little Falls about
+/-5% against +/-13% at Point of Rocks; raw estimate nearly flat over the day; daily error cycle of about
+/-6 points after the revision; no expectation among H1 to H9. New, after the audit: Reading B holds for most
of the lasting raw error; the wave follows a human clock.

## 7. What would overturn the working picture (looked for actively)

- Old and current Point of Rocks flows agree within 2% at identical timestamps: no revision of that size.
- The upstream balance fits the old numbers better than the new ones: Reading B fails.
- "Never happened" is as wrong as the logged estimates after 14 Nov: the revision is not the main cause.
- Little Falls or another input was revised (R2), or the truth gauge has a pending shift (R3).
- A break at 17 Nov 17:01 UTC in inputs or error: the service switch or the code is involved (R8).
- The wave's size or timing changed around 13 Nov on the level record: part of the break is the river's.
- The crest does not move with the clock change and shows on water temperature: the wave may be an artifact
  or natural, and the working picture of it is wrong.

## 8. Verification

1. Blind dual-language analysis: a Python analyst and an R analyst, separately, from `ANALYSIS_SPEC.md`,
   which the orchestrator writes after the tool audit and before any result. The spec fixes, per output type,
   what "agree" means: continuous numbers within 0.01 in the unit reported; lags, sets of local maxima,
   counts, labels and category assignments exactly; uncertainty from pre-generated resampling indices in
   blocks of whole days, shared by both languages. It also fixes the classification key, the hour-of-day
   basis, edge handling, the `f_old` rules and the thresholds of section 5. Any disagreement stops the study.
2. Third auditor (Opus), never one who ran an analysis: cross-language agreement, method against plan and
   spec, data integrity, the fidelity table, and at least 10 spot checks against the live USGS service (at
   least 3 current Point of Rocks flows, 3 field measurements, 2 upstream gauges).
3. The auditor reports which first-pass numbers the study reproduced.

## 9. Roles, sequence, size

Fable orchestrates, rules, writes the spec and the owner's report. Sonnet builds, researches and runs the two
blind analyses. Opus audits. `model` is set on every agent call. Builders do not commit.

1. Plan audit (done) -> rulings -> auditor's re-check of v2 (done) -> v3 -> owner confirms (section 13).
2. Freeze and tidy tables; withdrawal and intake research; replay tool (three Sonnet runs).
3. Tool audit (Opus) -> fixes.
4. `ANALYSIS_SPEC.md` -> Python and R analysts (Sonnet, blind, parallel) -> comparison.
5. Third auditor (Opus).
6. Report to the owner in plain words with charts, every number tied to a file. Then the remedies discussion.

About twelve to fourteen agent runs. Quality signals watched for the Sonnet tier: the fidelity gate,
cross-language agreement, the third auditor's refutation count.

## 10. Out of scope

Remedies of any kind; any change to the app, the hourly job, the learned corrections or the database; new
on-screen wording; the 48-hour forecast; the 90% band (TODO D21/A8). The earlier study of checking several
estimates at once (`analysis/multipending-responsiveness/`, 2026-11-11) is not re-opened.

## 11. Known limits

- Old 5-minute Point of Rocks flow ends on 9 Nov 23:55. For 10 Nov to 13 Nov 17:55 it is reconstructed from
  the level; the hourly job-log readings anchor it.
- The archive of old values exists on one machine only and is not in git. USGS no longer serves those values.
- The detailed job log starts on 10 Nov 21:00 UTC: 71 predicted runs before the first revised reading, and
  old time-shifted readings until about 15 Nov 07:00 (the per-component labels of section 5 say which).
- "Revision never happened" after 13 Nov is an extrapolation of the old curve in time and, at the lowest
  levels, in level. Its results are ranges, not single numbers.
- Reading A against Reading B may end "undetermined": every reference (upstream gauges, Little Falls) has its
  own provisional curve and its own withdrawals and returns.
- One revision, one low-water period. R3 and W7 say how typical it is, at lower detail.
- Counterfactuals replay the raw estimate, not the learning.
- Withdrawal data may not exist at daily resolution for November 2026.
- The 24-hour ambiguity of the wave's delay may remain unresolved; the rule in W3 says when.

## 12. Audit record

Independent plan audit by a fresh Opus agent, 2026-11-22, `PLAN_AUDIT.md`. All 25 findings are accepted.

| # | Severity | Finding | Ruling |
|---|---|---|---|
| 1 | BLOCKER | A 5-minute pre-revision archive (12 Jun to 9 Nov) exists; plan did not know | Accepted. Sections 2 (R1, R2, R3), 3, 4, 11 rewritten around it. The orchestrator's scouting had cut a file listing short. |
| 2 | BLOCKER | No arm could show the revision fixed the input and exposed withdrawals | Accepted. Reading B added to section 0; new R4 with three tests and the intake map; section 7. |
| 3 | MAJOR | Before/after keyed on check time; the first "after" check used old inputs and already jumped | Accepted. Labels keyed on prediction time and on the values used (section 5); recession hypothesis (R8b); decomposition fixed in advance (R5). |
| 4 | MAJOR | Transition mis-defined; the job keeps first-seen values | Accepted. Per-component phases from old/new labels; "72-hour history" end dropped. |
| 5 | MAJOR | H1's 2 x 2 did not match how travel time is derived | Accepted. H1 restated; 2 x 2 x 2 with the override spelled out; due time as its own factor (H7); iteration-limit share reported. |
| 6 | MAJOR | Fidelity gate too weak, passable by construction | Accepted. Gate on every logged value, no injection, fit/test split for `f_old`, per-day fit, frozen clock, cap of 3 misses in pre-listed categories. |
| 7 | MAJOR | Code versions and data source changed inside the window | Accepted. R8a: diff, sample replay under each version, break test at 17 Nov 17:01. |
| 8 | MAJOR | Missing explanations for the daily cycle | Accepted. H6 cap, H7 due time, H8 threshold, H9 pumping rhythm added. |
| 9 | MAJOR | R7(a) zero by construction; R7(b) costly | Accepted. Both dropped; replaced by the archive comparison (R1, R2) and the `last_modified` census (R3). |
| 10 | MAJOR | Origin of the wave should be core, with clock, weekday and instrument tests | Accepted. W2 is core with the three tests and the extra tributaries. |
| 11 | MAJOR | The delay method is weak at about 50 hours | Accepted. Fourth estimate from distinct events, decision rule, Little Falls level, rounding noise (W3, W1). |
| 12 | MINOR | Point of Rocks data are 5-minute | Accepted. Native steps. |
| 13 | MINOR | Edwards Ferry blend is inert at these flows | Accepted. Stated in R5. |
| 14 | MINOR | The 20:34 stamp is a bulk stamp; ratings of the measurements | Accepted. Section 1 corrected; R3 records ratings. |
| 15 | MINOR | Bin states per check come from `validation_log` | Accepted. R6. |
| 16 | MINOR | "About 270 cfs" spread is not current | Accepted. Figure removed; derived in the study. |
| 17 | MINOR | Logged truth is at the check time; rounding at Little Falls | Accepted. T1/T2 and the rounding statement. |
| 18 | MINOR | The W1 window contains the flood | Accepted. Event-day rule (section 5). |
| 19 | MINOR | First "before" check predates the log | Accepted. Listed as not replayable. |
| 20 | MINOR | R3 should cover Little Falls | Accepted. |
| 21 | MINOR | R6 leaned toward remedies | Accepted. Now R7, descriptive, with last-learned dates. |
| 22 | MINOR | Duplicate and missing rows; freeze cutoff | Accepted. Section 3 rules. |
| 23 | MINOR | Old-service files use local offsets | Accepted. Section 3 rule and hand check. |
| 24 | NOTE | "Within 0.01" cannot apply to every output | Accepted. Section 8, per output type. |
| 25 | NOTE | Expectations leak; one already contradicted | Accepted. Section 6 marked unreliable; no method choice may refer to it. |

Re-check of v2 by the same auditor, 2026-11-22 (appended to `PLAN_AUDIT.md`): GO WITH CHANGES; of the 25,
18 resolved and 7 partial (2, 3, 5, 6, 8, 11 and part of 6), none unresolved; 13 new findings. All 13 are
accepted and worked into v3; the seven partials are closed by them.

| # | Severity | Finding | Ruling |
|---|---|---|---|
| N1 | MAJOR | "Never happened" needs the old curve beyond where it was fitted; v2 said the opposite | Accepted. Section 4.3 corrected; S-old uses the curve of the last old days; terms reported as ranges (R5); limit added (section 11). |
| N2 | MAJOR | The three-term split's labels prejudged Reading A | Accepted. Neutral names; no term carries a verdict; read only beside R4; rules for truth, windows, intervals, term 3 (R5). |
| N3 | MAJOR | The 2 x 2 x 2 cannot run on the unchanged production function | Accepted. Audited copy of the post-iteration steps that must reproduce the pure cells; match-window rule; raw estimate only; H1 needs W3's measured delay (section 4.4, W5). |
| N4 | MAJOR | The gate would fail on every run (clock), and one cap mixed two kinds of miss | Accepted. Clock at `final.ts`, tolerance per field, `due` within 5 s; gate split into A (strict) and B (old-curve runs, tolerance, "approximate" on failure). |
| N5 | MAJOR | "Three agree" could be three estimates wrong by the same whole day | Accepted. Hours from (2) and (3), days from (1) and (4); "resolved" defined; weak-day criterion fixed (W3). |
| N6 | MINOR | Old-curve test set overlapped the fit set | Accepted. Test set restricted; level test first (section 4.3). |
| N7 | MAJOR | R4 had no decision rule and could be confidently wrong | Accepted. Verdict rule with a band from USGS's measurement ratings; direct test (0) with the hand measurements; the shared weaknesses stated with every verdict. |
| N8 | MINOR | H9 cannot be tested with daily withdrawal data | Accepted. Stated in W5: expected "undetermined" unless hourly data are found. |
| N9 | MINOR | Thresholds needed a metric and an interval rule | Accepted. Section 5. |
| N10 | MINOR | Event-day rule imprecise, one gauge only | Accepted. Per gauge, in relative flow (section 5). |
| N11 | MINOR | "About 68" old-only predictions is wrong | Accepted. 71 (section 11). |
| N12 | MINOR | Source of the replay's other inputs not stated | Accepted. Frozen record at logged reading times (section 4.4). |
| N13 | MINOR | The 24-month census is large for keyless requests | Accepted. Paging, pause, narrowing and stop rule (section 3). |

## 13. Owner's confirmation

**Confirmed by the owner on 2026-11-22:** "confirm: the full study as planned" (v3, core and extended).

Open at confirmation, to be closed before `ANALYSIS_SPEC.md` is written (no result exists until then):

- **The "matters" thresholds of section 5.** The owner: "I think less than 2 pp of error matters, but I have a
  hard time determining a cut off", and asked for a recommendation from the data. Orchestrator's
  recommendation, 2026-11-22: "matters" from 1.0 point (or 10% of the daily error cycle), "does not matter"
  below 0.5 point (and 5%), "small" in between. Reasons: 0.5 point is the floor the owner confirmed for the
  job-timing replay (2026-11-17); the excess error to explain is about 12 points across roughly a dozen
  candidates, so a bar of 2 would label most of them "small" although together they are the whole problem;
  and every candidate is reported with its size and interval whatever its label. Cost: with about eight days
  of data, narrower bands mean more "undetermined" labels. Awaiting the owner's word.

Data snapshot taken at confirmation: read-only exports of `tick_log` (305 rows, to the 10:00 UTC run of
2026-11-22), `validation_log` (20 rows) and the bin and state rows (97 rows), all with
`created_at < 2026-11-22 10:30:00+00`.

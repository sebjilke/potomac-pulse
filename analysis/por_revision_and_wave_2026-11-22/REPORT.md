# Report: the Point of Rocks revision and the daily wave (November 2026)

Written by the orchestrator on 2026-11-23 for the owner, after the third auditor's review
(`RESULTS_AUDIT.md`: every recomputed number matches; the results may be reported with the changes it lists,
all of which are made here). Descriptive only. No remedy is proposed and nothing in the app, the hourly job or
the database was changed. Every number below is tied to a file at the end.

## 1. In one minute

**Your question:** why did the error go from about 7% to about 15%?

1. **USGS corrected its Point of Rocks numbers, and the model's learned corrections were tuned to the old
   ones.** That is the whole jump. It is not the app updates and not the move to the new USGS service.
2. **The correction did not start on 13 November. It covers 8 October to 13 November and grows steadily,**
   from about 10 cfs to about 410 cfs. USGS applied all of it in one batch on 13 November at 19:41 UTC.
3. **The corrected numbers are clearly closer to the real river than the old ones.** How exact they are is not
   established. So the unusual period was the five weeks before 13 November, when the gauge read too low and
   the model quietly absorbed it.
4. **With the corrected numbers the model's raw estimate is the river before the drinking-water withdrawals.**
   Little Falls is measured after them, about 560 cfs less. The learned correction has to carry that, and it
   is on its way there.
5. **The daily wave is a separate, long-standing autumn pattern.** It costs about 5 points of error at the
   worst hours against the best, and that was the same before and after the revision. It did not get worse.

Measured on every hourly estimate, the error of the number shown in the app was **5.8% before the revision
and 16.0% after it**.

## 2. What I told you earlier that the study corrected

| I said | The study says |
|---|---|
| "The wave is tracked worse since the revision: about ±1.5 points before, ±6 after." | **Wrong.** About 5 points before and after. My figure came from 5 and 15 of the job's own checks, which fall at only a few hours of the day. |
| "USGS made Point of Rocks 30% higher at the same water level on 13 November." | True only for 10 to 13 November. The change grew from about 1% on 9 October. |
| "Expect another bad stretch when the river rises", and later "that warning is withdrawn". | **Neither is supported. Unknown.** Higher flows occurred only in mid October, when the correction was still small. Its size at higher flows today cannot be read from the data. |
| "The new numbers are the right ones; the sharpest proof is USGS's measurement of 10 November." | Too strong. That measurement shows the old curve was 21% low that day. It cannot confirm the new record, because USGS built the new record from it. |
| "For 38 hours the model saw a rise that did not exist." | The flow state was wrong for four runs. One input (the time-shifted reading) stayed old until 15 November 07:00 UTC. |
| "The cause is autumn weed die-back." | USGS's own notes: debris at the gauge in September and October, clear on 10 November. |
| "The learned corrections add to the daily swing." | Not established. One measure says about 2 points, another says none. |
| "The wave takes about 6, 30 or 54 hours to Little Falls." | 6 is impossible. It is 30 or 54; the data do not decide. |
| "Since 14 November the app is off by about 14%." | 16.0% on all hourly estimates. 14.3% was the figure from the job's 15 checks. |

## 3. The revision

### What USGS did
- One batch, stamped 2026-11-13 19:41:13 UTC, rewrote 10,306 readings from 8 October 21:05 to 13 November
  18:55 UTC. Of the 9,251 of them that we could compare with a copy saved earlier (that copy ends on
  9 November), 9,214 changed.
- The change grows almost in a straight line with time:

| Day | Old flow | New flow | Change |
|---|---|---|---|
| 9 Oct | 1,417 | 1,427 | +11 cfs, +1% |
| 25 Oct | 2,549 | 2,807 | +258 cfs, +10% |
| 31 Oct | 1,807 | 2,132 | +324 cfs, +18% |
| 9 Nov | 1,431 | 1,840 | +409 cfs, +29% |
| 10 to 13 Nov (job log) | | | +28 to +33% |

- On any one day the change is close to the same number of cfs at every flow seen that day (15 October, during
  high water: +189 cfs on 13,100 cfs).
- **Nothing else among the model's inputs was revised:** Little Falls flow and level, the four tributaries,
  Edwards Ferry level, Point of Rocks level and temperature are identical, reading for reading.
- Why: USGS's field notes say "Debris - Moderate" at the visits of 3 September and 8 October and "Clear" on
  10 November. On 8 October a hand measurement gave 1,510 cfs at 1.20 ft; on 10 November 1,980 cfs at the
  same level. USGS spread the difference evenly over the days between the two visits. That even spread is
  USGS's assumption, not a measurement.

### Is the new record right?
Clearly closer than the old one. Not shown to be exact.
- **USGS's own measurement:** on 10 November the old curve was 21% low (1,560 against 1,980 measured).
- **Water coming from upstream** (Shepherdstown, Millville, Antietam, Catoctin, one day earlier): Point of
  Rocks was 75% of that sum on the old record and 88% on the new one; in mid September, before anything was
  revised, it was 96 to 98%. The old ratio drifts down through October; the new one does not.
- **Water balance at Little Falls with the withdrawals:** on the old record Little Falls carried about 590 cfs
  more than could be accounted for; on the new record about 270; on days nobody revised, 160 to 210.
- Both balances suggest the new record may still be a few percent low for late October.
- The pre-set verdict was "the revised record is supported" in the main variants and "undetermined" with a
  narrower tolerance; in no variant was the old record supported.
- Weak points: the upstream gauges are provisional too (Shepherdstown was itself rewritten that evening), and
  all of this is one low-water spell.

### What it did to the model
- Point of Rocks is about 83% of the model's input. A 30% rise in it lifts the raw estimate by about 25
  points. That is arithmetic, not a second finding.
- Raw estimate against Little Falls, every hourly estimate: **6% too low before, 25% too high after.**
- Replaying the real production code with the old numbers throughout: the raw error after 15 November would
  have been about zero, within a few points. (Uncertain: it needs the old curve below the lowest level it was
  ever seen at.) With the old numbers the error also moved by about 6 points over these days, so the river
  itself contributed a little.
- **Against Little Falls plus the day's withdrawals, the raw estimate after the revision is 8% low** (98 runs,
  14 to 19 November); on the one earlier day with withdrawal data it was 24% low. Reading: the model's physics
  computes the river before withdrawals. The old, too-low input had cancelled the withdrawals by coincidence.
  The remaining 8% is about the size of the inflow nobody gauges.
- Withdrawals this autumn: median 363 million gallons a day net, about 560 cfs, roughly a third of the river
  at Little Falls. Day to day they vary by about 40 cfs.

### The learned corrections
- Before the revision the three low-flow corrections *added* 90 to 230 cfs. Now they *subtract*: 278 cfs
  (steady), 303 (falling), 145 (rising). Over their whole lifetime these bins had subtracted 90 to 260 cfs on
  average, so they are moving back toward where they used to be. (That last sentence is my reading.)
- Still short of the recent errors: about 30 cfs (steady), 160 (falling), 170 (rising).
- At the pace checks reached each bin during 15 to 22 November, the learning rule would close 90% of today's
  gap in about a week (steady, falling) or two (rising), if the river held still. That is arithmetic of the
  rule, not a forecast.

### What was ruled out
- **The app updates:** the estimate code is byte-identical in the three versions that ran in those days.
- **The move to the new USGS service on 17 November:** every reading the job logged equals USGS's record
  before and after the switch; no break in the error larger than about 3 points could be hidden.

## 4. The daily wave

### What it is
- From mid September on, Point of Rocks rises and falls by 0.14 to 0.19 ft over each day; its flow swings by
  7 to 12% above and below the daily mean. In early September it was less than half that.
- It sets in sharply on 15 to 16 September at Shepherdstown, Millville and Point of Rocks.
- At Little Falls it is much smaller: about 3 to 6% depending on how it is measured, close to what that gauge
  can resolve (it reports in steps of 40 cfs).

### Where it comes from
- Both branches carry it: the Potomac main stem at Shepherdstown (about 250 cfs of swing) and the Shenandoah
  at Millville (65 to 100 cfs). About three quarters comes down the main stem. Further up, at Hancock and Paw
  Paw, there is almost none.
- It then appears in sequence: Point of Rocks 13 to 16 hours after the upstream gauges, Edwards Ferry 13 hours
  after Point of Rocks. A wave that travels is not a fault of one instrument.
- **Cause, as stated by the regional water-supply commission:** "From September to December, upstream
  hydroelectric dams turn off operations at night during the annual American eel migration downstream", and
  "the flows downstream fluctuate in this predictable daily pattern". One licence document gives the season as
  15 September to 15 December. The start we see on 15 to 16 September fits. No document measures the effect or
  names the main-stem plants.
- A weekend weakening shows at Shepherdstown in November only (5 weekend days) and not in September and
  October. Not established.
- The test of whether the wave follows the clock change of 1 November came out "undetermined" everywhere, and
  was badly posed: the river was falling across those weeks, which shifts arrival times by itself.

### How long it takes
- Within the day, the wave reaches Little Falls 6.4 hours after its Point of Rocks timing.
- The two legs via Edwards Ferry show the total is at least about 30 hours. So it is about 30 or about 54
  hours. The data lean very slightly to 30 and do not decide.
- The model assumes about 49 hours now and assumed 54 before the revision.

### What it costs, and what the model does with it
- **A daily error cycle of about 5 points, the same before and after the revision.** After the revision the
  raw error is 27 to 31% for estimates that fall due between midnight and 8 am local time and 19 to 22% for
  those due between 11 am and 5 pm. A worsening of up to about 5 points cannot be excluded with 4 days before
  and 7 after; none is detectable.
- **The model's raw estimate is nearly flat over the day** (it varies by about 2%), while Little Falls varies
  by about 4%. The time-shifted Point of Rocks input does carry the wave, but at the wrong hour (peak about
  8 pm local, where Little Falls peaks about 1 pm). The rise/fall factor happens to cancel it. So the error
  cycle is roughly Little Falls' own cycle.
- Which reading the time shift picks hardly matters now: a change of more than 6 hours in the assumed delay
  moves the error by less than 0.1 point (uncertainty about ±0.5).
- **Two parts of the model helped in this period:** the 120% cap lowered the error of the shown estimate by
  about 3.3 points (it was active in 44% of runs), and state-specific corrections by about 2.2 points against a
  single average correction. Both are specific to a period when the raw estimate runs 25% high.
- Whether the state-specific corrections also add to the daily cycle is not established.

### Is it new?
No. In the hourly record since 2011, on days without a flood:
- 80% of October days, 69% of November days and 53% of September days show a daily swing of at least 3% at
  Point of Rocks; under 10% of March and April days.
- 60% of days when Little Falls is below 2,000 cfs.
- In a replay of the production model over those 15 years, at Little Falls flows below 3,000 cfs, the error
  was 6.6% on days with a large swing and 4.7% on the 48 calm days. An association, mixed with season.

## 5. How the two patterns relate

They are independent. The revision moved the *level* of the error (from near zero to +25% raw). The wave
moves the error *around* that level through the day, by about the same amount before and after. What you saw
on your phone, an error jumping between about 0% and 30% from one check to the next, is the two together: a
large one-sided offset that the corrections are still closing, plus a daily swing on top.

## 6. What the study could not answer

- The size of the correction at flows above 3,000 cfs under USGS's present curve.
- How exact the revised record is day by day, especially before about 25 October.
- Whether the wave takes about 30 or about 54 hours to Little Falls.
- Whether part of Little Falls' own daily swing is the rhythm of pumping (no hourly withdrawal data exist).
- Whether the daily cycle of the error changed slightly with the revision (4 days before is too few).
- Everything here is one revision, one low-water spell, one week after the revision.
- The revised record is still provisional; USGS may change it again at its next visit.

## 7. Facts that bear on the two ideas you parked (no recommendation here)

- **Withdrawals in the model (TODO D22):** the steady part, about 560 cfs, is what the learned correction is
  converging to. The day-to-day part is about 40 cfs, roughly 2.5% of the river now. The commission's own
  definition: flow below the Great Falls intake = Little Falls flow + the Little Falls withdrawal, which was
  zero on every day checked.
- **The eel-season wave in the model (TODO D23):** the wave is documented, seasonal (15 September to
  15 December) and visible in 15 years of data; it costs about 5 points across the day now and roughly 2
  points on average historically; the model does not lack the signal but carries it at the wrong hour; the
  travel time to Little Falls is not pinned down.

## 8. How this was checked

- A plan written before any analysis, audited twice by an independent auditor (38 findings, all worked in),
  and confirmed by you.
- All USGS data frozen with checksums before anything was computed, including the only surviving copy of the
  pre-revision numbers.
- The real production code replayed on every hourly run; it reproduces what the job logged except where USGS
  rewrote a reading minutes after the job had read it (an accepted deviation from the pre-set check, recorded
  in the plan).
- Every result computed twice, blind, in Python and in R. The revision part agreed on every number at once.
  The wave part first differed in 8 of 30 files; the causes were gaps in my specification (for example how to
  break a tie between two equally high points); both analysts reran with a written addendum and now agree,
  except one undefined value.
- A third, independent auditor recomputed the headline numbers with its own code, checked 14 values against
  USGS live, and corrected the wording of most of my conclusions. Its report is `RESULTS_AUDIT.md`.

## 9. Where the numbers are

Folder `analysis/por_revision_and_wave_2026-11-22/`. Python tables in `py_R/tables/` and `py_W/tables/`; the R
copies in `r_R/` and `r_W/` are identical.

| Statement | File |
|---|---|
| Stamp, span and counts of the revision; change by day | `py_R/tables/R1_rewrite_groups.csv`, `R1_by_day.csv`, `py_R/metrics.csv` (R1) |
| Nothing else revised | `py_R/tables/R2_series.csv`, `R2_por_level_octpull.csv` |
| Field measurements and notes | `py_R/tables/R3_visits.csv`, `R3_measured_vs_published.csv`, `R4_0_por.csv` |
| Upstream balance; balance at Little Falls | `py_R/tables/R4_a_days.csv`, `R4_a_verdicts.csv`, `R4_b_days.csv`, `R4_b_verdicts.csv` |
| Raw error with old numbers, new numbers, as run | `py_R/tables/R5_split.csv`, `R5_runs.csv`, `R5_extrapolation.csv` |
| Raw estimate against Little Falls plus withdrawals | `py_R/tables/R4_c_runs.csv`, `py_R/metrics.csv` (R4) |
| Withdrawals | `data/tidy/withdrawals_coop.csv` (median and day-to-day spread computed by the orchestrator, not audited) |
| Corrections before and after each check; gaps | `py_R/tables/R6_checks.csv`, `R6_bins.csv`, `R7_bins.csv` |
| Service switch | `py_R/tables/R8_inputs.csv`, `py_R/metrics.csv` (R8); `replay/R8A_CODE_DIFF.md` |
| Error of the shown estimate, 5.8% and 16.0% | `py_W/tables/W4_runs.csv` (means by phase computed by the orchestrator; 16.04 confirmed by the auditor) |
| Wave size, onset, origin | `py_W/tables/W1_daily.csv`, `W1_periods.csv`, `W2_daily.csv`, `W2_periods.csv`, `W2_weekend.csv`, `W2_clock.csv` |
| Travel of the wave | `py_W/tables/W3_xcorr.csv`, `W3_xcorr_maxima.csv`, `W3_crests.csv`, `W3_model_times.csv`; `RESULTS_AUDIT.md` (W-c) |
| Daily error cycle; components | `py_W/tables/W4_cycle.csv`, `W4_error_by_hour.csv`, `W4_component_cycles.csv`; `RESULTS_AUDIT.md` (W-d, W-e) |
| Cap, corrections, reading pick | `py_W/tables/W5_candidates.csv` |
| History since 2011 | `py_W/tables/W7_year_month.csv`, `W7_flow_class.csv`, `W7_error_by_wave.csv` |
| Quotations on the cause of the wave | `research/WAVE_SOURCES.md` (only the passages the auditor found verbatim in the saved pages are used) |

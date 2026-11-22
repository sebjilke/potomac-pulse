# Independent plan audit: the Point of Rocks revision and the daily wave

Auditor: a fresh subagent (Opus) that did not write the plan. Read-only, 2026-11-22. What I ran: read-only SELECTs against `potomac_observations` (tick_log, validation_log, bin_snapshot), reads of `scheduled-update.js` and `shared/model.js`, Python one-liners over frozen files in the repository, about 14 keyless GETs to `api.waterdata.usgs.gov`. The only extraction (the October pull) went to my scratch directory outside the repository.

## Verdict: NO-GO in the current form. It becomes GO WITH CHANGES once findings 1 to 4 are fixed.

The questions are good and the plan is honest about its limits. But the design has three problems:

1. It misses the largest pre-revision dataset in the repository.
2. It has no arm that could show the revision made the model's input *more* correct. In that reading the post-revision raw error is mostly the known water withdrawals between Point of Rocks and Little Falls, which the bins used to hide.
3. Its "before/after" split, its transition definition and its H1 2 x 2 do not match what the code actually does.

All three are fixable before code is written.

Counts: 2 BLOCKER, 9 MAJOR, 12 MINOR, 2 NOTE.

---

## Findings

### 1. BLOCKER: a complete 5-minute pre-revision record (June 12 to November 9) is already in the repository, and the plan does not know it exists

**Evidence**
- `analysis/rising-limb-travel-backtest/raw/` holds 49 files from the OLD USGS service. `FETCH_MANIFEST.json` gives `fetched_utc_date: 2026-11-10` for every file, with a URL and SHA-256.
- Coverage:
  - Point of Rocks flow (00060) and temperature
  - Little Falls flow and stage
  - Monocacy, Goose, Broad Run, Seneca flow
  - Edwards Ferry stage
  - 2026-06-12 00:00Z to 2026-11-09 23:55Z, at full resolution
- The file holds 288 PoR readings per day, so the data are 5-minute.
- I compared one reading per spot check with today's record:

| Timestamp (UTC) | Old file (pulled 10 Nov) | USGS today | `last_modified` today |
|---|---|---|---|
| PoR 2026-11-09 12:00 | 1,460 cfs | 1,870 cfs | 2026-11-13 19:41 |
| PoR 2026-09-03 18:00 | 1,800 cfs | 1,800 cfs | 2026-09-03 19:03 |
| PoR 2026-08-25 16:00 | 4,420 cfs | 4,420 cfs | 2026-09-03 18:19 |
| LF 2026-11-09 12:00 and 13:00 | 1,810 | 1,810 | unchanged |

- So the 13 Nov revision reaches back at least to 9 Nov and not to 3 Sep. Its start date can be found exactly in this file.
- The 25 Aug value was itself last modified on 3 Sep, the day of a field visit. That is direct evidence of an earlier revision.
- The hourly derivative `hourly_backtest_data_v39.csv` (sha256 `d1d3f6a5...`, provenance file next to it) carries the same old values as hourly medians through 2026-11-09 23:00.

**Consequences for the plan as written**
- §11 "Old Point of Rocks flows exist only ... 5 to 22 Oct, 11 Oct, and 10 to 13 Nov" is false. So is the §3 table.
- R1 cannot find "the earliest reading whose flow changed" from the windows the plan names. With this file it can, at 5-minute resolution: old against current at identical timestamps, with no level curve needed.
- R2 can be done for Little Falls and all four tributaries over five months, not only over the October and November windows.
- The replay's warm-up (the stored 72-hour history before the first logged run reaches back to 2026-11-08 00:05, per `porHist.firstT` of the 11 Nov 00:00 run) can use real old values for everything up to 9 Nov 23:55. Only 10 Nov 00:00 to 13 Nov 17:55 needs `f_old(level)`.
- R7 has a much better design (finding 9).

**Recommendation**
- Add these files to §3, including their SHA-256 values and their pull date.
- Rewrite R1, R2, §11 and the replay's history reconstruction around them.
- The file has no PoR stage (00065), so an old level/flow pair still needs today's level. State that this assumes the levels were not revised, and test it in R2 on the October pull and the job log, which both carry old levels.
- Also cross-check the October pull against this file over 5 to 22 Oct. Both are old-service copies a day apart, so they should agree exactly. That is a free consistency test of the "old" record.

### 2. BLOCKER: no arm can tell "the revision broke the model" from "the revision fixed the input and exposed the withdrawals"

**Evidence**
- Little Falls 01646500 sits below the Washington-area water intakes: the Washington Aqueduct at Great Falls and Little Falls, WSSC's Potomac plant, and Fairfax Water's Corbalis intake. All of them are between Point of Rocks and Little Falls. In November they take a few hundred cfs.
- The CLAUDE.md model notes already say the bins "absorb ungauged tributary and withdrawal signal".
- 9 Nov 12:00 UTC, steady flow, values from the frozen old file and from today's record:
  - Little Falls: 1,810 cfs
  - Tributaries: about 330 cfs
  - Old PoR: 1,460, so old PoR plus tributaries ≈ 1,790. That is a gap of about 0 against Little Falls, even though several hundred cfs are being withdrawn.
  - New PoR: 1,870, so new PoR plus tributaries ≈ 2,200. That is a gap of about 390 cfs, the size of the withdrawals.
- The raw estimate is +21% after the revision (first-pass value, reproduced below). That is about what a physically correct input should give against a withdrawal-depleted gauge.
- USGS's own field data point the same way. Query: `field-measurements`, USGS-01638500, June to November 2026.
  - 8 Oct: 1.20 ft, 1,510 cfs, control "Debris - Moderate", measurement rated **Poor**.
  - 10 Nov: 1.20 ft, 1,980 cfs, control "Clear", rated Fair.
  - The control changed (debris cleared, possibly in the October flood), and the old November flows were too low.
- Independent upstream check, 20 Nov 00:00 UTC: Potomac at Shepherdstown 01618000 read 1,430 cfs and Shenandoah at Millville 01636500 read 582 cfs. Their sum is about 2,000 cfs before Antietam, Catoctin and others. That is much closer to the revised PoR (about 1,800) than to anything on the old curve (about 1,400).

**Why this blocks**
- The plan frames the revision as the disturbance. §7's only refutation test for the revision is "S-old is as wrong as the logged one", and §6 expects S-old to look like 11 to 13 Nov.
- If the old curve was wrong, a good S-old score only shows that the bins had learned to cancel a wrong input against an unmodelled withdrawal. The design would then "confirm" the theory while the real story is the opposite.
- §7 says withdrawals are "not measurable with these data". They are measurable with other public data.

**Recommendation**
- Add a hypothesis R-H0: "the revised record is closer to the truth and the post-revision raw error is mostly withdrawals". Give it its own tests:
  - (a) Upstream mass balance, old and new PoR against Shepherdstown + Millville + Antietam (01619500) + Catoctin (01637500) + Opequon (01616500), lagged. Use the same frozen pull.
  - (b) Daily water-supply withdrawals between PoR and LF, from ICPRB's CO-OP daily reports or the utilities. Also USGS 01646502, "Potomac River, adjusted, near Wash, DC", the withdrawal-adjusted Little Falls record. The site exists, but my query for daily values 1 to 21 Nov 2026 returned none, so its availability for November is unverified.
  - (c) Raw error against LF + withdrawals, before and after the revision.
- Report the result whichever way it comes out. This is description, not remedy.

### 3. MAJOR: the before/after split by check date puts a pre-revision prediction into "after", and that prediction already shows a jump in error with old inputs

**Evidence**
- `validation_log`: the first "after" check (checked 14 Nov 08:00) was predicted on 13 Nov at 17:01. That is before the revision; the first revised reading entered at the 20:00 run.
- Its raw error is **+4.76%**. The five checks before it ran from −9.0% to −5.8%. Its final error is +13.2%.
- Little Falls fell to 1,640 at that check. Section 1 shows LF averaging 1,868 cfs on 10 to 13 Nov and 1,574 on 18 to 22 Nov, a 16% drop. PoR level dropped only about 0.07 ft.

**Why it matters**
- An 11-point jump in raw error happened on inputs that contain no revised number. Something besides the revision moved: the recession, the wave phase at the due time, or the withdrawal share as flow fell.
- §1's "15 of 15 too high", the 14.3% after-mean, and §6/§7's S-old expectation all mix this in.

**Recommendation**
- Key every before/transition/after label on the **prediction** time and on which history values entered that prediction (see finding 4), never on the check time.
- Add an explicit "recession" hypothesis. The rise/fall factor only half-corrects, because the decay is capped at 0.5 (`DECAY_CAP`, model.js:506), so a falling river leaves a positive raw bias. Test it with S-old over 14 to 22 Nov.
- Pre-register a decomposition: logged error after = S-old error (river, recession, wave, withdrawals with an unchanged input) + (S-new − S-old) (the revision). Fix the numeric reading of each term in advance.

### 4. MAJOR: the transition is mis-defined; what the code actually stored is different

**Evidence**
- `storePoRHistory` (scheduled-update.js:461-498) keeps the **first-seen** value per timestamp. New readings are added only for timestamps not already stored, and nothing is overwritten. Each run fetches P2D (line 356).
- The 19:00 run on 13 Nov had last stored reading 17:55 (`in.por.hT`). The 20:00 run stored 18:00 to 19:35 with **revised** values.
- So the stored history's old/new boundary lies between the 17:55 and 18:00 readings, not at 19:41.
- Confirmed with numbers:
  - The 14 Nov 00:00 run logs rise rate −1.769 %/h and state "falling".
  - That matches the current reading (22:55, 1,680) against the reading at or before 6 h ago, which is 18:00 at 1,840: −8.7% over 4.92 h. 1,840 is today's revised value at 18:00 (USGS GET 2026-11-13T16:40Z to 18:10Z).
  - With the old value (about 1,440) the state would have been "rising".
- Phantom effects therefore differ by component:
  - **Flow state and rise rate** (6-hour lookback, model.js:466-540): phantom "rising" only on the four runs 20:00 to 23:00 on 13 Nov. The rise rate of about 3.6 to 3.9 %/h also shortens the travel time by about 7% (`getPoRtoGFTravelTime`, model.js:385-393).
  - **Time-shifted reading** (about 36 to 44 h lookback): old values until the lookup target passes 18:00 on 13 Nov, so until about 15 Nov 06:00 to 08:00. The end is ragged, because the travel time oscillates (finding 5).
  - **"Until the stored 72-hour history holds only new numbers"** (§5) ends about 16 Nov 18:00. That is irrelevant to the estimate after the time-shift lookup has moved on, and it contradicts §1's "first 38 h".
- Maximum logged `delta.pct` is 44.27% (SQL max over tick_log), consistent with §1.

**Recommendation**
- Define the phases in the spec per component, from the stored history's boundary (last `in.por.hT` before the first revised fetch).
- For every run, label whether `hist.ts`, the 6-hour reading and the current reading are old or new.
- Drop "until the 72-hour history holds only new numbers" as the end of the transition.

### 5. MAJOR: H1's 2 x 2 ("old/new travel time") does not match how the code derives travel time

**Evidence** (`makeGFPrediction`, scheduled-update.js:945-980)
- The first travel time comes from **Little Falls flow** (`getFlowMultiplier(lf.q)`). It is then iterated up to 3 times on the **time-shifted** PoR value, not on the current one, and shortened when the 6-hour rise rate says "rising".
- **38 of 280** predicted runs end at `max_iter` without converging (SQL count of `trv.stop`). On those runs the reading actually used (`hist.ago`, for example 39.27 h at 13 Nov 20:00) is not the one at the reported travel time (`trv.t` 41.08 h). The loop sets `travelPoRtoGF` after the last lookup.
- The same `mult` also sets the **Great Falls to Little Falls** time (`gf2lf`), which sets `validationDue`. The revision therefore also moves the moment at which the truth is sampled, by about 1 to 2 h: `gf2lf` was 14.7 h at 19:00 and 12.5 h at 22:00 on 13 Nov. On a 24-hour wave that changes the sampled phase.
- LF itself fell 16%, which lengthens the first travel time independently of the revision.
- The rise/fall factor's decay `sqrt(ago/travel)` is ≥0.5 in every case seen, so it is capped at 0.5. Its value does not depend on the travel time.

**Recommendation**
- Before the replay is built, the spec must say exactly what is overridden:
  - the lookup target (the reading used), or `trv.t`, or both
  - whether the iteration and the rise-rate shortening are kept
  - whether `gf2lf` (the due time) is held fixed or follows
  - what is held for LF
- Make it at least a 2 x 2 x 2 (flow numbers x PoR-to-GF timing x due time), or report the due-time effect separately.
- Restate H1's premise correctly: the travel time comes from LF and from the *time-shifted* PoR value, not from "the Point of Rocks flow number".
- Report the `max_iter` share by phase. The oscillation alone can move the chosen reading by 4 to 7 h between consecutive runs: `hist.ts` 11:05 on 12 Nov at the 23:00 run, then 06:35 on 12 Nov at the 00:00 run.

### 6. MAJOR: the fidelity gate is too weak and can be passed by construction

**Evidence**
- §4.4's gate checks only the raw estimate within 2 cfs, and "every miss is explained".
- The log holds many more intermediate values: `hist.ts/cfs/ago`, `rise.r/rst`, `trv.t/t0/it/stop/gf2lf/mult`, `delta.pct/ratio`, `pre.cfs`, `por.est`, `corr.c/st/bin`, `ceil`, `final`, `due`, `in.porHist.n/firstT/lastT`.
- If the builder injects logged `hist.cfs`, the gate is trivial. If the history is rebuilt from `f_old` fitted on the same job-log pairs, the gate partly tests the fit on its own data.
- The earlier October replay had to **fit** per-gauge latencies in-sample: 6 parameters on 22 constraints (`pulse-audit-2026-10/REPLAY_NOTES.md`, rule 4). Here the log gives every input's reading time (`hT`, `qT`), so no fitting is needed. The plan does not say this.

**Recommendation**
- The gate must be exact (or within the logged rounding) on every logged intermediate, run by run. Separate rates go in a fidelity table.
- Test the reconstructed history against `in.porHist.n/firstT/lastT`. They are 851 or 852 on every run, which is 5-minute data over 70.8 h.
- Rebuild the history only from frozen USGS data plus the first-seen rule. Never inject logged values.
- Fit `f_old` on one set of pairs: the `in.por` pairs plus the old file up to 9 Nov with today's level. Test it on the other: the 280 logged `hist.cfs` values with `hist.ts` and today's level.
- Replace "every miss is explained" with a pre-set cap, for example at most 2 runs, each in a pre-listed category, or the gate fails.
- Use `final.ts` (or `at`) as the frozen clock. `Date.now()` is read several times per run, and a 5-minute reading can sit exactly on the 6-hour or ±1-hour boundary.
- Test the possibility that USGS pro-rates shifts over time: fit `f_old` by day, not only overall.

### 7. MAJOR: the code and the data source changed during the study window, and the plan replays "the current commit"

**Evidence**
- `tick_log` `ver`/`v`/`src`, by period:

| Period | Version | Log schema | Data source |
|---|---|---|---|
| 10 Nov 21:00 to 22:00 | v39.2 | 1 | old service |
| to 17 Nov 16:01 | v39.6 | 2 | old service |
| from 17 Nov 17:01 | v39.11 | 3 | new service, through the adapter (`src: new`) |

- 25 error rows on 16 and 17 Nov are "Failed to fetch USGS data". Hours 03:00, 10:00 and 12:00 on 17 Nov have no prediction at all.
- `git log` shows v39.2, v39.6, v39.11 and v39.13 touching the server files since 9 Nov.
- The 17 Nov source switch is a second breakpoint inside the "after" period. It is not a hypothesis anywhere in the plan.

**Recommendation**
- Either replay each run with the code that ran it, or show by a diff (and a replay of a sample under both versions) that the prediction path is identical.
- Feed post-17 Nov runs through the adapter.
- Add "the data source switched on 17 Nov 17:01" to §7 and test for a break there, in input agreement (log against today's record) and in error.

### 8. MAJOR: missing explanations for the daily error cycle

The H list (H1 to H5) leaves out mechanisms that the code makes likely:

- **H6, the cap.** The 120% cap uses Little Falls *at prediction time* (`applyGFCorrection`, model.js:705-721). When it binds, the final estimate inherits LF's own daily wave, about 13 h out of phase with the truth. `ceilBound` is true on 6 of the 15 "after" checks (validation_log) and on none before.
- **H7, the due time.** The revision shortens `gf2lf`, which moves the sampled phase (finding 5).
- **H8, state switching sensitivity.** The flow-state threshold is max(100 cfs, 2%) (model.js:483-486). The revision scaled the wave in cfs by about 1.28 while the 100-cfs floor stayed fixed, so state flips and bin switching (H4) can become more frequent purely because of the revision. Measure flips per day under S-old and S-new.
- **H9, withdrawals at Little Falls.** Municipal pumping has its own daily cycle, so part of LF's daily swing may not be the river wave.

**Recommendation:** add these with the observation that would support or reject each, as for H1 to H5.

### 9. MAJOR: R7(a) returns zero by construction; R7(b) is expensive while a cheap better design exists

**Evidence**
- `hourly_backtest_data_v38.PROVENANCE.txt`: "Base: hourly_backtest_data_v361.csv (126916 rows, FROZEN, rows win on overlap)".
- I compared the two CSVs. 126,916 common timestamps, **0 rows differ**. v38 is v361 plus appended rows.
- v361 ends 2026-06-16 03:00, so the two pulls never overlap "almost completely for five weeks". The only information is the 48 differing stamps listed in the provenance file, and several of those are method differences (a blank `por_lagged`), not revisions.
- v39 against v38 is also 0 differing rows out of 127,728.

**Recommendation**
- Drop R7(a) and R7(b). Replace them with:
  - (i) The rising-limb raw old file (pulled 10 Nov) against today's record, 12 Jun to 9 Nov, for every gauge.
  - (ii) A census of `last_modified` values in today's PoR and LF records over the last 12 to 24 months, matched to field-visit dates. 25 Aug was last modified 3 Sep, the day of a visit, so revisions appear to follow visits.
- Say plainly that (ii) is a lower bound, because only the latest change per value is visible.

### 10. MAJOR: the wave's origin needs cheap tests the plan does not list, and W2 should be core

**Evidence**
- Shepherdstown 01618000 fell from 1,430 to 1,260 cfs between 00:00 and 02:00 UTC on 20 Nov (USGS GET). Millville 01636500 was nearly flat at 582 to 575.
- So a strong wave is already present on the Potomac main stem above Shepherdstown. The four W2 sites are real and correctly named (monitoring-locations GETs: Shepherdstown 5,955 sq mi, Hancock 4,064, Millville 3,041, Paw Paw 3,129).

**Recommendation** (add these tests)
- (a) **Daylight-saving test.** If the crest moves by one hour in UTC across 1 Nov, the wave follows a human clock (dam or plant operation). This is a sharp, cheap test.
- (b) Weekday against weekend.
- (c) A stage-sensor artifact check: does the PoR stage wave show up in flow at the downstream gauges in proportion, and is it independent of the water-temperature cycle (`tC` is logged)?
- (d) Add Antietam, Conococheague and Opequon to W2.
- (e) Make W2 core. Without it the owner cannot "fully understand" the wave, and it costs little once the freeze script exists.

### 11. MAJOR: W3's 24-hour ambiguity method is weak at these delays

**Evidence**
- The logged PoR-to-GF time is 36 to 44 h and the GF-to-LF time is 12 to 15 h. The total of about 50 h is about two full wave periods.
- Edwards Ferry gives stage only. If either leg is over 12 h it is ambiguous on its own.
- The "weak days 15 and 16 Nov" fall inside the transition window, although the wave is measured on level and so is not itself contaminated.
- Little Falls flow moves in steps of about 40 cfs, which is 0.01 ft: values 1,480, 1,520, 1,560, 1,600, 1,640, 1,680. A ±5% wave there is only ±2 steps.

**Recommendation**
- Pre-register the decision rule: which of the three methods wins, and what counts as "agree" (for example within 2 h).
- Add an independent celerity estimate from distinct events at similar flows (onsets of rises in the 2011 to 2026 hourly record, or in the Sep to Nov 5-minute record).
- Use Little Falls stage alongside flow.
- Report quantization noise on every LF amplitude.

---

### 12. MINOR: Point of Rocks is 5-minute data, not 15-minute

`porHist.n` is 851 or 852 over 70.8 h, the frozen old file has 288 readings per day, and USGS today returns 5-minute steps. W1 and §5 say 15-minute. Pre-specify the resampling rule, or use native steps per gauge.

### 13. MINOR: the Edwards Ferry blend is inert at these flows

`getEFWeight` at about 1,900 cfs gives about 1e-4 (logged `ef.w: 0`). R4 should say this component contributes nothing, rather than describing it as a stage of the chain.

### 14. MINOR: "entered 13 Nov 20:34 UTC" is a bulk timestamp

All 12 PoR field-measurement records since June carry the same `last_modified` of 2026-11-13 20:34:53. It says nothing about when the 10 Nov measurement was entered, and it is later than the 19:41 flow revision.

R3 should also record that the 8 Oct measurement was rated Poor, and so was 3 Sep (1.34 ft, 1,830 cfs, debris moderate).

### 15. MINOR: bin states before and after each check come from `validation_log`, not `bin_snapshot`

`bin_snapshot` is daily at 03:00 UTC. R5's "before and after every check" must use `binBefore` and `binAfter` from `validation_log`.

### 16. MINOR: the "about 270 cfs" spread between the three state corrections is not current

The latest snapshot (22 Nov 03:00) has `0-3000` rising 144.6, steady 278.5 and falling 303.4, a spread of 159. Cite the time at which 270 held, or derive it in the study.

### 17. MINOR: the logged truth is LF at the check time, not at the due time

The job scores against LF at the check, up to 66 min after due (`delayMin` 1 to 66). T2 handles this. T1 must state that LF is quantized at about 40 cfs, about 2.5% at these flows.

### 18. MINOR: the W1 window includes the October flood

1 Sep to 22 Nov contains the flood. Detrended amplitude and the cosine fits will be dominated by it unless an exclusion or flow-condition rule is fixed in advance.

### 19. MINOR: the first "before" check cannot be traced in the log

Its prediction (10 Nov 19:01) predates the log, which starts at 21:00. The first two log rows are schema v1. Say that this check cannot be replay-verified.

### 20. MINOR: R3 should cover Little Falls too

Little Falls is the truth gauge. Add its field visits and its `last_modified` record. A pending LF shift would move the truth. One spot check of 9 Nov showed LF unchanged.

### 21. MINOR: R6 leans toward remedies

R6's "which bins were learned against numbers that no longer exist" points at bin resets. Keep it descriptive, and add each bin's last-learned date. An EMA with alpha 0.3 reflects only about its last 10 checks, which for the high bins may be months old and under older shifts.

### 22. MINOR: duplicate and missing rows need a fixed rule, and so does the freeze cutoff

- Some hours have 2 or 3 rows. For example, 17 Nov 09:00 has two predictions (1,992.8 and 1,990.9).
- Three hours on 17 Nov have no prediction.
- `tick_log` is at 305 rows, not 304, and still growing.
- Fix the rule (for example, the first `predicted` row per hour, or the one whose `slot` is `stored`) and a hard cutoff timestamp.

### 23. MINOR: the old-service files use local time offsets

They carry −04:00 or −05:00 depending on the date, and the switch is on 1 Nov. The new service is UTC. The tidy-table builder must parse the offsets. Spot-check one reading on each side of 1 Nov.

---

### 24. NOTE: §8's "within 0.01" cannot apply to every output type

- Lags, local-maxima sets, counts, phase labels and category assignments must match **exactly**.
- Bootstrap intervals agree only if both languages use pre-generated indices, as the earlier studies did. Hourly errors are autocorrelated, so use blocks by day.
- Write this per output type into `ANALYSIS_SPEC.md`.
- Before any result, also fix:
  - the classification key (prediction time)
  - hour-of-day basis (local or UTC; of prediction or of due time)
  - the moving-average edge handling
  - the `f_old` interpolation and the two extrapolation rules
  - numeric thresholds for "supports" and "rejects" for every hypothesis

### 25. NOTE: §6 leaks expectations, and one is already contradicted

- §6's R4 expectation ("S-old shows errors like those of 11 to 13 Nov") is already contradicted by finding 3.
- §6's W4 expectation (±6 points) and §1's morning/evening split could guide window or phase choices.
- The morning/evening claim does check out (4 against 4: 29.9% against 17.1%, labelled by local **check** time). But it is n=4 per arm and confounded with the trend.
- Keep §6, but mark these as unreliable, and let the spec fix every method choice before any analyst sees data.

---

## Checked and found correct

- PoR 13 Nov 16:55 UTC: log 1.14 ft / 1,440 cfs (read at the 18:00 run). USGS today 1,860, `last_modified` 2026-11-13 19:41:13.
- PoR field measurements 8 Oct (1.20 ft, 1,510 cfs, debris moderate) and 10 Nov (1.20 ft, 1,980 cfs, clear).
- Final error before: 5 checks, mean absolute 2.59%. After: 15 checks, mean absolute 14.33%. Raw error before: mean −6.9%. Raw after: mean +21.2%, 15 of 15 positive (but see finding 3).
- 71 runs before 19:41 on 13 Nov, all predicted. Logged PoR levels 1.03 to 1.21 ft. Maximum `delta.pct` 44.27%.
- `validation_log` has 20 rows and `bin_snapshot` 12. EMA alpha is 0.3 (model.js:497). The 72-hour retention is real (model.js:89). The decay cap is 0.5.
- The October pull holds PoR stage and flow at 5-minute steps (4,897 each), plus the other gauges, 5 Oct 00:00Z to 22 Oct 00:00Z, old service. Its archive mtime is 9 Nov.
- The upstream site numbers in W2 are real and correctly named. Shepherdstown and Millville report November data.
- The 1 Nov 2026 daylight-saving change is correct.
- Little Falls, 9 Nov 12:00 and 13:00: old equals current (one spot check of R2's expectation).

## Not checked

- Whether `multipending-responsiveness/audit_work/usgs_raw/01638500_2026101*.json` was pulled on 12 Nov, and what windows it covers.
- Little Falls averages 1,868 and 1,574 cfs. PoR daily level ranges. The travel-time summary of about 40 h and about 37 h, which is ambiguous anyway (finding 5).
- Whether USGS 01646502 (adjusted Little Falls) or ICPRB withdrawal data exist for November 2026. The site exists; my daily query returned no rows.
- Whether the prediction path is byte-identical across v39.2, v39.6 and v39.11. I only saw the commit subjects claiming "estimate logic unchanged".
- The PoR level record for revisions (R2 levels). Monocacy, Goose, Seneca and Broad Run, old against current.
- Whether the replay can import `makeGFPrediction` unchanged under today's code. The earlier replay did, but I did not run it.
- Whether the plan's withdrawals statement is wrong in degree as well as in kind. The withdrawal figure of "a few hundred cfs" is general knowledge of the system, not verified from a source in this audit.

---

## Re-check of plan v2 (same auditor, 2026-11-22)

I judged the body text of `PLAN.md` v2, not the rulings table.

What I checked:
- `makeGFPrediction` and the history and travel helpers in `scheduled-update.js` and `shared/model.js`
- 2 read-only SELECTs: `tick_log` keys of the schema v1 and v3 rows, and the difference between `final.ts` and `at`
- `git ls-files` and `.gitignore` for the archive

I made no USGS requests this time.

Correction to my first report: the archive holds 55 files (9 series x 6 files, plus the manifest), not 49. v2's "55 files" is right. The archive is not in git (`analysis/rising-limb-travel-backtest/.gitignore` has `raw/`, and `git ls-files` lists 0 files), as v2 says.

### Updated verdict: GO WITH CHANGES

No blockers remain. Six new MAJOR findings (N1 to N5, N7) must be fixed in the plan before the replay tool is specified; the MINOR ones can go into `ANALYSIS_SPEC.md`.

Status of my 25 findings: **18 RESOLVED, 7 PARTIAL, 0 NOT RESOLVED.**

### Status of the 25 findings

| # | Status | Evidence in v2 |
|---|---|---|
| 1 | RESOLVED | The archive is in §3 with hashes. R1 and R2 are rebuilt on it. §11 is corrected. R1 includes the consistency test against the October pull. |
| 2 | PARTIAL | Reading B (§0), R4(a) to R4(d) and §7 were added. But no rule says what result counts as "fits better" (see N7). The decomposition's labels still assume Reading A (N2). |
| 3 | PARTIAL | Labels are keyed on the prediction run (§5) and the recession is in R8(b): done. The R5 decomposition is fixed, but its terms are mislabelled and partly undefined (N1, N2). |
| 4 | RESOLVED | §5 gives per-component old/new/mixed labels with the 17:55/18:00 boundary. The 72-hour end is dropped. |
| 5 | PARTIAL | The 2 x 2 x 2 (§4.4) and H7 are good in substance. How to implement them against the real code is not said, and it conflicts with "imported unchanged" (N3). |
| 6 | PARTIAL | §4.4 gates every logged value, never injects logged values, uses a fit/test split and a per-day fit. But the clock choice makes `due` miss on every run (N4), the cap of 3 mixes two kinds of miss (N4), and the fit and test sets overlap (N6). |
| 7 | RESOLVED | R8(a): diff, sample replay under each version, break test at 17 Nov 17:01. It does not name the commit of the "frozen export"; minor, for the spec. |
| 8 | PARTIAL | H6 to H9 are added. H9's test cannot see a daily rhythm in daily withdrawal data (N8). "Accounts for" is undefined (N9). |
| 9 | RESOLVED | R7(a) and R7(b) are dropped. R3 has the `last_modified` census, stated as a lower bound. |
| 10 | RESOLVED | W2 is core, with the clock, weekday and instrument tests and the added tributaries. |
| 11 | PARTIAL | Four estimates and a decision rule are in W3. But the rule can be met by three estimates that share the same whole-day error (N5). |
| 12 | RESOLVED | W1 uses native time steps. |
| 13 | RESOLVED | R5 reports the Edwards Ferry weight (about 0.0001) as inert. This checks out: 0.40/(1+(10000/1913)^5) ≈ 1.0e-4. |
| 14 | RESOLVED | §1 rows on the 20:34 stamp and the ratings; R3. |
| 15 | RESOLVED | R6 uses `binBefore`/`binAfter`. |
| 16 | RESOLVED | The 270-cfs figure is gone; H4 has no number. |
| 17 | RESOLVED | §4.5 T1/T2 (1 to 66 minutes); W1 rounding statement. |
| 18 | RESOLVED | §5 event-day rule. Its form needs work (N10). |
| 19 | RESOLVED | §4.5 lists the 10 Nov 19:01 check as not replayable. |
| 20 | RESOLVED | R3 covers Little Falls. |
| 21 | RESOLVED | R7 is descriptive, with last-learned dates. |
| 22 | RESOLVED | §3: first `predicted` row per hour, errors and empty hours listed, cutoff in the manifest. |
| 23 | RESOLVED | §3: offsets parsed, one hand check on each side of 1 Nov. |
| 24 | RESOLVED | §8: agreement rule per output type; shared day-block indices. |
| 25 | RESOLVED | §6 is marked unreliable and no method choice may refer to it. |

### New findings in v2

**N1. MAJOR: "never happened" needs the old curve outside the range where it was fitted. §4.3 says the opposite.**
- §4.3 says `f_old` is "needed only for 10 Nov 00:00 to 13 Nov 17:55". But S-old (§4.4) sets "every Point of Rocks flow" to `f_old(level)` or the archive value. There is no archive after 9 Nov, so S-old needs `f_old` for every reading from 13 Nov 18:00 to the cutoff.
- Two extrapolations follow:
  - **In time.** No old value exists after 17:55 on 13 Nov, so the counterfactual is "the old curve as of 13 Nov, kept unchanged".
  - **In level.** The job log's old pairs span 1.03 to 1.21 ft. The level was 0.93 to 1.15 ft on 18 to 22 Nov (§1 of v1), so the lowest levels of the after-period fall below the fitted range.
- Archive pairs (with today's level) may reach lower levels. But they come from months under other shifts: the record was already revised on 3 Sep. So a pooled fit mixes curves.
- The first two terms of the R5 decomposition then depend directly on the extrapolation rule. The "lasting effect" term is the most sensitive.
- **Fix:**
  - Correct §4.3.
  - Define S-old as "the shift in force on 13 Nov, from the per-day fit of the last old days", not a pooled fit.
  - Report the R5 decomposition as a range across the two extrapolation rules, with the share of after-period readings that need extrapolation.

**N2. MAJOR: the R5 decomposition adds up, but its labels prejudge the answer.**
- Arithmetic: S-old + (S-new − S-old) + (S0 − S-new) = S0 is an identity. With the gate passed, S0 equals the logged raw. So the terms always add up.
- The labels are the problem:
  - Term 1 is called "the river alone (recession, wave, withdrawal share, with unchanged input)". Under Reading B the unchanged input is itself about 25% too low, so term 1 also holds the old curve's input error, with the opposite sign to the withdrawals.
  - Term 2 is called "the lasting effect of the revision". Under Reading B it is the removal of an input bias, which exposes the withdrawals.
- A reader will take term 2 as "the damage the revision did". That is Reading A by naming.
- **Fix:**
  - Name the terms neutrally: (1) "raw error with the old numbers"; (2) "change from the numbers alone"; (3) "change from mixing old and new in the stored history".
  - Interpret each only next to R4's result.
- **Also fix in the plan:**
  - Terms are on the raw estimate, against one truth (state whether T1 or T2), averaged per phase over windows set in advance, with day-block intervals.
  - Term 3 is zero by construction once all three readings are new.
  - Any later rewrite of the current record after a run (the first-seen value differs from today's) lands in term 3. The gate must show it is zero, or list it.

**N3. MAJOR: the 2 x 2 x 2 cannot be run with `makeGFPrediction` "imported unchanged". The mixed cells need a stated method.**
- There is no hook in the code:
  - The reading choice happens inside `makeGFPrediction` through `getPoRFromHistory` (scheduled-update.js:622), a module-internal function. It cannot be stubbed from outside.
  - The travel helpers and `selectHistoricReading` are destructured from `./shared/model` at load time (scheduled-update.js:23). They can be replaced only by patching that module's exports before loading the job file, and that patch would apply to every call.
- The mixed cells are not meaningless: "same timestamps, other numbers" is a clean question. With the iteration not re-run, the raw estimate in a cell depends only on:
  - the time-shifted value at the swapped timestamp
  - the current reading
  - the tributaries
  - the rise/fall factor, whose decay is ≥0.5 and so always capped at 0.5 in every logged run
  
  The flow state also changes between scenarios. It moves the bin correction but not the raw estimate, so say that the 2 x 2 x 2 is on the raw estimate only.
- These cells measure how sensitive the error is to the reading choice. They do not show "mistiming". Mistiming needs a true delay, which only W3 can give. So H1 is supported only if W3's measured delay sides with one scenario's choice.
- **Fix:**
  - Specify the mechanism. One option: a small, audited copy of the post-iteration lines (time-shifted value + tributaries + rise/fall factor). It must reproduce `makeGFPrediction` exactly in the two pure cells before any mixed cell is reported.
  - Say how the 1-hour match window applies when the swapped timestamp has no reading in the other scenario's history.

**N4. MAJOR: the fidelity gate fails on every run for a reason of definition, and its cap of 3 mixes two kinds of miss.**
- §4.4 freezes the clock "at each run's logged time". The logged `at` is the start of the run. `due` is computed inside `makeGFPrediction` at its own `Date.now()`, which is 1 to 3 seconds later.
  - Evidence: `final.ts` − `at` = 1.0 s on 10 Nov 21:00, 1.4 s on 13 Nov 20:00, 3.2 s on 17 Nov 17:01.
  - `due` is logged to the millisecond. So "within the logged rounding" fails for `due` on every run, and the cap of 3 stops the study for no real reason.
  - Fix: use `final.ts` as the clock, or give `due` an explicit tolerance (for example ±5 s), and write a tolerance per logged field into the spec.
- The cap of 3 is too strict where the history is rebuilt with `f_old`.
  - About 85 to 90 runs (roughly 11 Nov 16:00 to 15 Nov 07:00) take their time-shifted reading, and some take their 6-hour reading, from the `f_old` region.
  - Point of Rocks flow moves in 20-cfs steps. One step of rounding at a few readings, or a shift that USGS pro-rated over the day, would honestly exceed 3 misses.
  - The cap is still the right strictness for runs built only from frozen USGS values.
- **Fix:** split the gate.
  - Gate A: runs whose inputs come only from frozen USGS values. Cap 3, as written.
  - Gate B: runs that use `f_old`. This is the `f_old` test, with a tolerance fixed now. For example: every time-shifted value within one 20-cfs step, at least 95% exact, and the 6-hour readings checked through `rise.r`.
  - If B fails, S0 for those runs is "approximate", not a stop.

**N5. MAJOR: W3's rule ("three agree within 2 h") can be met by three estimates that are wrong by the same whole day.**
- Estimates (2) (the two legs via Edwards Ferry) and (3) (individual crests) are both ambiguous by whole periods of 24 h, so they can agree on the wrong day count.
- Only (1) (day-to-day changes in size) and (4) (non-periodic disturbances) fix the whole-day count.
- **Fix:**
  - Decide the fraction of a day from (2) and (3), and the whole-day count from (1) and (4).
  - The delay is "resolved" only if (1) and (4) agree on the count, or one of them is decisive and the other is silent.
  - Say in advance what makes (1) decisive: for example, a weak day must be visible at both ends with a clear margin.

**N6. MINOR: the `f_old` test set is not fully separate from the fit set.**
- Time-shifted readings from before 10 Nov are archive values, and the archive is in the fit set. Some `hist.ts` values also equal an earlier run's `in.por.hT`.
- Both sets use today's level. So a revision of the level cannot show up in the test.
- **Fix:**
  - Test only on time-shifted readings stamped 10 Nov 00:00 to 13 Nov 17:55 whose timestamps are not in the fit set.
  - Run R2's level test first: logged `in.por.h` against today's level at the same timestamp.
- Otherwise the split is adequate. The old curve is a deterministic function, so what the test can catch is a shift that changes by day, rounding, and wrong level pairing. Those are the failure modes that matter.

**N7. MAJOR: R4 has no decision rule and can give a confident wrong answer.**
- The risks, in order of size:
  - The upstream gauges' own provisional ratings could be shifted, just like Point of Rocks was. At low flow these are rated "Fair" (about ±8%) or worse.
  - Water taken out and returned upstream: municipal intakes and treatment-plant returns (Hagerstown, Martinsburg, Frederick and others). A few percent.
  - About 300 sq mi of ungauged area between Shepherdstown + Millville + Antietam and Point of Rocks, about 3% of the area. Small next to the 25% difference between the curves.
  - Travel of about a day from the upstream gauges.
- On the Little Falls side, R4(c) carries Little Falls' own rating error (Fair) and plant returns above Little Falls, such as Broad Run and Seneca. These are small but one-sided.
- **Fix:**
  - Pre-register the metric: daily means on steady days, upstream summed with a fixed lag, the ratio to the old and new Point of Rocks values.
  - Pre-register an uncertainty band from the measurement ratings of the gauges involved, and the rule for a verdict: "B supported", "A supported" or "undetermined".
  - Add the most direct test, already in hand: USGS's own measured flows at Point of Rocks in the window (10 Nov: 1,980 cfs at 1.20 ft) against old and new curves at that level. Add the latest measurements at the upstream gauges, to see whether they too were off their curves.

**N8. MINOR: H9 cannot be tested with daily withdrawal data.**
- A daily rhythm is invisible in daily totals.
- Edwards Ferry is above the main intakes, so comparing Edwards Ferry with Little Falls mixes damping and pumping.
- Unless hourly pumping data are found, H9 should be expected to end "undetermined". Say so.

**N9. MINOR: the thresholds in §5 need a metric and an uncertainty rule.**
- "Accounts for 2 points" is defined only for additive terms (R5). For H4, H6 and H8, the spec must name the counterfactual difference that measures each. For example, H6 is the final estimate with the cap minus without it, on the same runs.
- "The daily error cycle's size" must be defined (for example, half the range of the hourly means).
- A label may be given only if its day-block interval lies inside the band; otherwise the result is "undetermined".
- With about 8 days after the revision, the noise could otherwise decide "does not matter". The cut points themselves are reasonable for a 14% problem.

**N10. MINOR: the event-day rule.**
- "Changes by more than 0.10 ft across it" needs a definition. For example: centred mean at the end of the UTC day minus at its start.
- It uses Point of Rocks only, in level units. Little Falls and its local creeks (Seneca, Difficult Run) can have storm days that Point of Rocks does not see.
- The W2 gauges have their own level-to-flow sensitivity.
- **Fix:** state the rule per gauge in relative flow, for example a centred daily mean flow change above 10%.

**N11. MINOR: §11 "about 68 predictions with old numbers only" is wrong.**
- The log has 71 predicted runs before the first revised fetch (10 Nov 21:00 to 13 Nov 19:00; SQL count).
- Old time-shifted readings continue to about 15 Nov 07:00.
- Use the per-component labels instead.

**N12. MINOR: the source of the non-Point-of-Rocks replay inputs is not stated.**
- Little Falls, the tributaries, Edwards Ferry and temperature need a source.
- **Fix:** take them from the frozen record at the logged reading times (`qT`, `hT`, `tT`). The logged values are gate targets, never inputs.
- The 120% cap and the first travel time use logged-time Little Falls in every cell (§4.4 says this for the 2 x 2 x 2 only).

**N13. MINOR: the R3 census of 24 months of 5-minute data is large for keyless requests.**
- It is about 210,000 values per gauge. The builder should plan paging and a stop rule now, or narrow the census to what it needs.

### Factual checks of v2 against code and data

| Claim in v2 | Result |
|---|---|
| H6: the cap bound on 6 of 15 checks after the revision, none before | correct |
| H7: the same multiplier sets the Great Falls to Little Falls time | correct (scheduled-update.js:969) |
| §5: boundary between the 17:55 and 18:00 readings | correct |
| §1: four phantom "rising" runs | correct |
| §1: 38 of 280 runs stop at the iteration limit | correct |
| R5: Edwards Ferry weight about 0.0001 | correct |
| §3: 55 files, not in git | correct |
| §4.3: `f_old` needed only to 13 Nov 17:55 | wrong (N1) |
| §11: about 68 predictions with old numbers only | wrong (N11) |
| §4.4: clock at the logged time gives an exact `due` | wrong (N4) |

### Not checked in this re-check

- Whether daily or hourly withdrawal data for November 2026 exist.
- The actual Point of Rocks level range of the archive months, which decides how much of N1's level extrapolation the archive can cover.
- Whether the new service allows the R3 census volume without a key.

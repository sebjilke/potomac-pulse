# Plan audit: creek-fed rises and the truth at Little Falls (PLAN.md version 1)

Independent audit, 2026-11-27. Read-only except this file. Scratch scripts and their output: `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/creek_plan_audit/` (`count_record.py`, `floor.py`, `kpulse.py`, `event.py`, `count_record.out`). Every count in section D below is the auditor's rough count, made to test the plan's definitions. None of them is a finding of the analysis and none may be quoted as one.

## Verdict: PROCEED AFTER CHANGES

The question is worth answering and the floor case (Difficult Run alone, `k = 1`) is cheap, close to measured, and on the auditor's rough count already moves a large share of the badly-low rising hours. But version 1 has two flaws that would let the report make the app look better than it is, with no check able to catch it: the central and ceiling cases produce a physically impossible flow at the falls on 26 and 27 November, at exactly the hours where the app is judged; and the reading rule counts hours that turn badly high as "explained". Both need a fix before the specification.

## A. Findings

### F1. BLOCKER. The central and ceiling cases give an impossible flow at the falls on the event, and the plan has no check that could notice
- Evidence (auditor's count, event pull, linear interpolation of the 5 and 15 minute readings): `T_falls = LF(x) − k × DR(x − ℓ)` between 26 Nov 12:00 and 27 Nov 12:00 UTC falls to 890 cfs (k 2.0, ℓ 1), 1,110 cfs (k 2.0, ℓ 3), 488 cfs (k 2.25, ℓ 1), 720 cfs (k 2.25, ℓ 3), around 27 Nov 01:00 to 02:00 UTC; it stays below Little Falls' own pre-storm flow (1,640 cfs at 12:00 on the 26th; 1,680 at the start of the pull) for 4 to 9 hours. At the same time Broad Run, Seneca and Goose Creek, all above the falls, were rising. The river at Great Falls cannot have dropped by a third below its pre-storm flow during a storm. With `k = 1.0` the minimum is 1,545 cfs, a 15 minute dip at 12:15 that is ordinary gauge noise.
- At 02:30 UTC on the 27th the central `B` is 73% of Little Falls (the plan expects "a third to a half"). These are the hours (about 21:00 to 03:00 UTC) when, per the first look, the cap was holding the app's number. A1 would therefore report the app as close to, or above, a truth that cannot be right.
- The same thing happens on the record. On Little Falls rising hours of the test years, central case: 248 hours have a `T_falls` below the lowest Little Falls reading of the previous 24 hours; 75 of the 456 hours that the central case "explains" are among them. Floor case: 4 of 295.
- Cause: a pure time shift of the sharp Difficult Run hydrograph, multiplied by 2 or 2.25, puts the whole scaled peak into one or two hours. The nearer, ungauged creeks peak earlier (Dead Run peaked at 20:45, Difficult Run at 23:30) and the pulse spreads on its way down; both lower and widen the real `B` at Little Falls.
- Change wanted:
  1. Add a physical floor that can fail: on every row, `T_falls` must be at least the lowest Little Falls reading of the 24 hours before the truth time (event: at least the pre-storm flow, 1,640 cfs). Count and list the rows that break it, per case. A case that breaks it on the event is reported as refuted for the event, not as part of the range. On the record the rows that break it are excluded from the "explained" count (F2) and counted.
  2. Add a mass check per rise: the volume of `B` over a rise must not exceed the volume of the Little Falls rise minus the gauged creek volume above the falls (Seneca, Broad Run). Report the count of rises that break it, per case.
  3. Split `B` in two parts with their own timing (F4).

### F2. BLOCKER. The reading rule of section 4 counts hours that turn badly high as "explained", has no placebo, and its outcome hinges on the lag
- Evidence (auditor's rough count, test years, Little Falls rising hours, central clock, 953 badly-low hours): central case, 456 are "no longer badly low"; 340 of them are within 15% and 116 are now badly high. Ceiling: 473, of which 138 badly high. A rule that calls a reading 30% high "explained" makes an overshoot of `k` look like success.
- Baseline effect: hours just below −15% leave the class with any positive `B`, and Difficult Run's own baseflow (median 0.5% of Little Falls) is already carried by the app's learned corrections (plan risk 6). 157 of the 953 sit between −17.5% and −15%. Placebo, auditor's rough count: replacing `DR` by its 30-day trailing median flips 2.5% (k 1) and 5.0% (k 2); using `DR` from 14 days earlier flips 5.2% and 8.2%. So a part of any share is not "water that never passed the falls" at all.
- Lag: floor case, central clock: 31.0% at ℓ 3, 30.7% at ℓ 1, 24.2% at ℓ 5. The rule fixes ℓ at 3 for the floor, so "large" passes; at ℓ 5 it would not. The label is decided by a parameter the plan itself calls uncertain.
- Can it come out each way? Yes in principle: the share is monotone in `k` (a larger `B` lowers the truth and raises every error), so "large" (floor ≥ 25%) and "small" (central < 10%) are exclusive and all three outcomes are reachable. On the auditor's count "large" is the likely outcome; that is not by construction, but its size is inflated by the three routes above.
- Change wanted: define "explained" as an hour that is badly low against `T_LF` and within ±15% against `T_falls`, with `T_falls` passing the floor of F1. Report the placebo share beside it (both placebos), and apply the thresholds to the share minus the larger placebo. Require the label to hold over ℓ 1, 3 and 5 (or the two-part timing of F4) as well as the three clocks. Report "turned badly high" as its own row, never inside "explained". If the owner prefers, drop the labels and keep the numbers; the auditor's preference is to keep the rule with these changes, because the owner asked for conditions fixed before the numbers.

### F3. MAJOR. The range of `k` is a range of area, and will be read as a range of water
- The fact sheet supports the areas: 57.8 + 26 + 4.8 + 4.67 + 2.05 = 95.3 (plan "at least 95", correct); 2.0 × 57.8 = 115.6; 130 / 57.8 = 2.25. A rough sum at the mouths from the fact sheet's search-summary figures (Scott's Run about 6.0, Dead Run about 3.0, Turkey Run about 1.95, Rock Run somewhat above 4.8, Bullneck and the gorge slopes a few square miles, Minnehaha unknown and possibly below the gauge) lands near 105 to 115, so the central 2.0 is reasonable.
- 130 is not a clean upper limit of the land below the falls: it is the difference of two rounded USGS mainstem areas (11,560 minus 11,430, each likely good to about 10 square miles) and it includes the land between USGS 01645300 and the falls (the fact sheet says so, 1.5), which drains above the falls. As an area it overstates the land below the falls; as a bound it carries about ±10 square miles.
- Runoff per square mile varies far more than area: in this event, excess volume per square mile was Seneca 89, Difficult Run 304, Broad Run 453 and Dead Run 274 cfs-hours per square mile (auditor's count, from 26 Nov 00:00). A fivefold spread between neighbouring gauged creeks in the same storm dwarfs the 2.25 / 1.0 ratio. The clock study's own area scaling (430 / 234.9 on the lower leg) gives a creek share above 1, more creek water than the whole Little Falls rise, on 31 of 160 rises (`py/units.csv`, `share_lower`): area scaling can overshoot badly.
- Check A3 points the other way from the plan's worry: Dead Run shed about 10% less per square mile than Difficult Run in this storm (274 against 304). One storm on 2 square miles settles nothing either way.
- Change wanted: call the three values "scenarios of area" in every table, never a bound on water. State in the weak-spot paragraph that per-square-mile runoff of neighbouring creeks varied fivefold in this very event. Let the F1 floor and mass checks cap `k` from the data. Drop the sentence "If Dead Run sheds much more per square mile ... the ceiling may be too low" or make it symmetric (much less: the central may be too high).
- Dead Run's long record: not needed for this look. If wanted later, the fetch is small (Difficult Run's 15 years took 182 requests); the plan's "would take hours" is probably wrong, but the gain is small because the gauge covers 2 square miles.

### F4. MAJOR. One lag for all of `k × DR` mis-times both parts
- The basis for ℓ is sound for Difficult Run itself: the four gated pulses lagged 0.95, 3.25, 3.35 and 3.49 hours (`py/dr_units.csv`), and 7.3 river miles at the measured clock (4.2 hours for 9.1 miles at 3,000 cfs) gives about 3.4 hours. Five hours is outside every measured pulse, and is reached by the clock only below about 1,400 cfs (0.80 × 5.7 = 4.6 hours).
- But applying ℓ 1 to the Difficult Run part moves measured water two hours early, and applying ℓ 3 to the Cabin John part (about 2.3 miles from the gauge, more built-up) moves it hours late. The 1 hour value "stands for" the near creeks only by moving everything.
- Change wanted: `B(τ) = DR(τ − ℓ_DR) + (k − 1) × N(τ − ℓ_N)`, with `ℓ_DR = (7.3 / 9.1) × c` (same clock and same two ends as the truth, so the lag follows flow), and for the near creeks `ℓ_N` short (for example `(2.3 / 9.1) × c`). `N` is Difficult Run's own hydrograph on the record; on the event it can also be Dead Run's hydrograph scaled to Difficult Run's volume (Dead Run is the only fast urban creek with readings), as a second view. Keep the fixed 1, 3, 5 hours as a sensitivity only.

### F5. MAJOR. The envelope mixes the clock's uncertainty with the creek's
- The envelope takes the extremes over 27 combinations, including the clock's short end (0.30 × clock) and long end (1.23 ×). Those ends move `T_LF` itself, and on rising hours they move it more than `B` does. The report would then show a wide envelope that is mostly the clock, and a reader would take it for creek uncertainty.
- Change wanted: the creek effect is always reported as a paired difference at a fixed clock (against `T_LF` read with the same clock): floor, central, ceiling at each of the three clocks. The 27-case envelope stays, in its own column labelled "creek and clock together". Define the envelope as the minimum and maximum of each reported statistic over the cases, not per-hour extremes.

### F6. MAJOR. A sentence in section 0 is false
- "What is left of the app's miss after (i) is taken off is the upper limit of (ii) and of everything else." It is not an upper limit of anything. Errors of other kinds (the clock, Point of Rocks timing, the learned corrections, which lean high against the falls) offset or add; a `k` too high makes the residual smaller than the blind spot above the falls.
- Change wanted: "What is left of the app's miss after (i) is taken off is a residual. It contains (ii), errors of every other kind, and the error in (i) itself. It is not a bound on (ii)."

### F7. MAJOR. The uncapped value must be judged beside the shown one; the event extract is an unverified single-hand input
- On the event the cap held the shown number in the hours where `B` is largest, so "the app's number is close to the flow at the falls" there would be a statement about the cap (1.2 × Little Falls now), not the model. The first look's uncapped values were 39 to 139% above Little Falls from 5 pm. On the record 79 of the 953 badly-low rising hours are capped (auditor's count).
- `tick_log` holds the fields needed: `final.cfs`, `corr.unc` (corrected value before the ceiling), `ceil {lim, bound}`, `raw.cfs`, `in.lf {q, qT}` (tech appendix 6.10, line 538), and `in.dr` with its 6 hour tail. The plan names only `final.cfs`. It says the uncapped value is extracted, but not which field.
- The orchestrator alone extracts the rows; no one checks the extract. That is the yardstick-nobody-checked pattern the owner named.
- Change wanted: (a) judge `corr.unc` beside `final.cfs` in A1 and the uncapped value (`predictedCFS` before the cap; the replay has `ceilingApplied` and `lfCap`) beside the shown value in B2 and B3, with cap-held hours flagged; (b) name the fields in the plan; (c) the third auditor re-runs the saved query (or reads the saved file against the database) and checks that `in.dr.q` and its tail match the event pull at five times; (d) A1 shows the app's own clock (`due`) beside the measured clock, so the 26 to 61% first-look figures can be tied to this table.

### F8. MAJOR. Definitions a specification writer would have to guess
1. Where an hourly `DR` value sits in time. The replay and the clock build place hourly medians at the start of the hour plus 22.5 minutes and interpolate linearly with a one-neighbour rule (`clock_build_2026-11-27/TOOL_AUDIT.md`, line 47). Say that `DR` is placed the same way and read at `τ − ℓ` by the same rule. For the event: interpolate the 5 and 15 minute readings linearly, or take the last reading; say which.
2. Rows where `B ≥ LF` (`T_falls ≤ 0`): 4 hours over the record at the ceiling (auditor's count). Percent error is undefined; say they are excluded from every error statistic and listed.
3. "Test years": by estimate time `t` or by truth time.
4. The section 4 denominator: the badly-low set differs per clock. Say whether each clock uses its own set or the hours with a truth on all three.
5. A2: the base for Difficult Run (its flow at 12:00 on the 26th, 20 cfs, or earlier; it was 13 at 09:00), whether its window is shifted by ℓ, and the end. At 28 Nov 00:00 Little Falls is still at about 9,500 cfs and Point of Rocks still rising, so the share falls as the end moves later. Fix the end and report the share at two ends (for example 27 Nov 12:00 and 28 Nov 00:00).
6. A3: the window and the base. The auditor used excess above the flow at 26 Nov 00:00 to the last reading.
7. A1: last row; the estimate time `t` is the tick time (cron minute) not the whole hour; `Qc` for the clock is `in.lf.q` of that tick; "rising" for the event rows.
8. B2 intervals: number of resamples, interval type, and whether the difference is paired by hour.
9. B3: on which case and clock (central only, or each).
10. B5: the volume window of each rise (`a` to `b` of `units.csv`), whether `B` is shifted into it, and the base.
11. "Hours where B is 90% or more": in which case.
12. "Every table gives floor, central and envelope", but B1 asks for "floor, central, ceiling": settle it (B1 has no clock in it, so ceiling is right there).
Change wanted: settle each item in plan version 2, so the specification copies rather than invents.

### F9. MINOR. "Creek hours" are defined by the quantity under study
- Every creek hour has central `B` ≥ 10% of Little Falls, so its truth drops by at least 10% and every error on it rises by at least about 11 points. Any "improvement" on creek hours is therefore by construction. Membership is fixed by the central case, which is right (it does not move with `k`). Auditor's count: 1,459 test-year hours, 950 of them rising, median Little Falls 5,000 cfs.
- Change wanted: define the group by `DR / LF` (≥ 5%, which equals central `B` ≥ 10%) so that it is visibly free of `k`, and print next to every creek-hour row: "the change on these hours is large by construction; it shows how much, not whether."
- Related: the group "Little Falls rising" is selected on a reading that the creek water itself raises. Add, as a second view, "falls rising": central `T_falls` at least 10% above its value 6 hours earlier.

### F10. MINOR. Smaller wording and fact points
- "This part is certain" (floor `k = 1`): the amount is close to measured; its timing is not. Write "measured, up to its timing".
- Section 0 quotes the decision brief's −31% to −22% as "the bias at the start of rises". The brief says it was one event in October 2026 (`decision-brief-A5-A8-2026-11-10.md`, section 2, "single event"). Say so.
- Risk 3 (the Little Falls intake): give the direction. If the intake draws between the falls and the gauge, ignoring it makes `T_falls` too low, so the app looks better on low hours. The fact sheet says the intake was at 0 MGD in autumn 2026 (TODO D22, as quoted in section 2), so it does not matter for the event.
- Risk 6: "leans slightly high at all times" is a statement about the mean. Write "on average".
- The 130 square miles includes land above the falls (F3); in section 0 write "at most about 130".
- Section 6 was written before the audit; this audit now contains rough counts. Freeze section 6 as written in version 1 and do not revise it after reading this file, or the guesses stop being guesses.

### F11. MINOR. Scope and the standing decisions
- No conflict with the standing decision against an inflow term: nothing in the app changes and `B` never feeds anything. But `k × DR(t − ℓ)` with chosen `k` and ℓ is exactly the shape a below-falls inflow term would have. Add one sentence: "No `k`, ℓ or share from this look is a proposal for the estimate or the learning."
- TODO row A5 is open, its backtest is pending and needs "an owner choice of lag". This look's B2 is close to that backtest in form but not in substance: the app here was trained against Little Falls, and the A5 backtest needs an arm trained against the new truth. Say that the look does not choose A5's lag, does not apply the brief's proposed gate, and is not the A5 backtest.

## B. Answers to the plan's ten questions

1. **Is `T_falls = LF(t + c) − k × DR(t + c − ℓ)` the right first-order construction?** The timing logic is right: the falls water seen at `t` reaches the gauge at `t + c`, and the creek water arriving then left the Difficult Run gauge at `t + c − ℓ`. What it leaves out, with direction for the case where the app reads low: (a) the spreading of the creek pulse on its way down and the earlier peaks of the nearer creeks: a pure shift puts too much `B` into the peak hours, `T_falls` too low there, the app looks better (F1, the largest of these, refuted at central `k` on the event); (b) the scaling by area: either direction, size up to several fold per storm (F3); (c) the Little Falls intake: `T_falls` slightly too low, app looks slightly better, zero in autumn 2026; (d) land above the falls inside the 130: at the ceiling, `T_falls` too low, app looks better; (e) hourly medians: flatten the peak, a little against (a); (f) channel storage in the Little Falls pool and the gorge between the falls and the gauge: spreads both main-river and creek water, already partly inside the measured clock; (g) the clock's own flow input is `lf.q`, which includes creek water on these rises, so the clock is a little short: either direction, small. Net, most omissions push toward making the app look better on rising hours, which is why F1 asks for checks that can fail.
2. **Are the three values of `k` defensible?** As areas, yes (F3). 130 is an upper limit of area only roughly (rounding, and it includes land above the falls). As water, no: neighbouring gauged creeks varied fivefold per square mile in this storm. A3 is too weak to handle the runoff worry, and on this storm it points the other way (Dead Run about 10% less than Difficult Run). Do not download the long Dead Run record for this look; use the floor and mass checks of F1 instead.
3. **The lags?** Three hours is well founded for Difficult Run (three of four pulses, and the distance at the measured clock). One hour fits only the near creeks; five fits nothing measured above about 1,400 cfs. Replace by the two-part timing tied to the clock (F4); keep 1, 3, 5 as a sensitivity.
4. **Time the truth with the measured clock and its two ends; show the app's own clock?** Yes to the measured clock, read at exact times as in the clock build. Yes to the app's own clock beside it, but in A1 only (the event), where `tick_log.due` gives it directly and the first look's numbers used it. On the record the app's clock is known to be too long (clock study) and would add a third truth with no use. Report the creek effect at a fixed clock (F5).
5. **Run OLD's shown value; the uncapped value beside?** Run OLD's shown value is the right number to judge, because it is what the app shows. The uncapped value must be judged beside it (F7); on the event it is the only number that says anything about the model in the capped hours.
6. **Can the reading fail every way; are 25% and 10% sensible?** Every way is reachable and "large" and "small" cannot both hold (monotone in `k`). The thresholds are reasonable in size, but the measured quantity is wrong: it counts turned-high hours and baseline flips, and its label depends on ℓ. Keep the rule with the changes of F2, or drop the labels. The auditor's rough count suggests "large" on the floor case even after the placebo, which is plausible and is not by construction.
7. **Is "creek hours" circular?** As a description of how much the error moves, no; as evidence that the app is better there, yes, because the change is at least about 11 points by construction. Define it by `DR / LF`, label it, and add a "falls rising" group (F9).
8. **Routes to making the app look better than it is, and the guard for each.**
   - `k` too high: refuted cases via the floor and mass checks; floor case leads the report.
   - Pure shift puts too much `B` in the peak hours: two-part timing (F4); floor check (F1).
   - Turned-high hours counted as explained: separate row (F2).
   - Baseflow already in the corrections: placebo subtraction (F2) and B4 beside.
   - The cap holding the number: uncapped beside, cap-held hours flagged (F7).
   - The clock's short end chosen in the envelope: creek effect at a fixed clock (F5).
   - Selection on Little Falls rising: "falls rising" view (F9).
   - Land above the falls in the 130 and the intake: stated with their direction (F3, F10).
   - Reading the residual as the bound of the blindness above the falls: the corrected sentence (F6).
   - Provisional event readings later revised: record the pull time (done) and say that a USGS revision can move every event number.
   And the other side: a `k` or lag that is wrong can also make hours worse (a mis-timed subtraction adds error; at ℓ 5 the floor explains 7 points less than at ℓ 3). The transition table B3 covers this if it reports both directions per case.
9. **Scope; overlap with A5 and the inflow decision?** The smallest look that answers the owner: Part A (A1, A2, A4; A3 as a footnote) and B1, B3 and the reading rule on rising hours. B2 can shrink to its front measures (share badly low, share badly high, mean signed error) with the month resampling; B4 is one number and cheap; B5 is cheap and links to the clock study. Missing and essential: the physical floor and mass checks (F1), the placebo (F2), the uncapped value (F7), the paired creek effect at a fixed clock (F5). Nothing touches the inflow decision; the look must say it does not choose A5's lag or run its gate (F11).
10. **The strongest argument against doing this at all.** Nothing changes whatever the result, and the answer beyond Difficult Run is set by an assumption (`k`) that this look cannot test, so the expensive part (two analysts, a third auditor, 27 cases) buys precision on a number whose real uncertainty is the scaling. A floor-only look (Difficult Run alone, measured, one lag tied to the clock) would answer "how much at least" in an afternoon. The counter-argument, which the auditor accepts: the owner asked how the app's number should be judged, the floor case alone seems to move about a third of the badly-low rising hours, and that is worth knowing correctly before any A5 decision. Proceed, with the floor case leading and the scaled cases plainly labelled as scenarios.

## C. The verification design (section 8)

- Enough for the arithmetic, which is simple. Two blind analysts and a compare tool will agree; the risk of this look is in the assumptions, and no amount of cross-language agreement tests those. The checks that can fail (F1, F2 placebo) are the verification that matters here and are missing.
- Add: the third auditor checks the event log extract (F7c), checks that every refuted case is reported as refuted, and recomputes the floor case of A1 and the section 4 share by own code.
- The "five readings against the public USGS service" should include at least two Difficult Run readings at the event peak (23:00 to 24:00 UTC on 26 November) and two of the record's hourly medians used for the floor case, since those carry the result.
- The spec writer and both analysts on Sonnet, the spec reviewer and auditors on Opus: fits the project's tier rule.
- Could shrink: B2's month resampling over 27 cases (resample the floor and central cases only, at the central clock).

## D. Counts made by the auditor (not findings of the analysis)

Rough, single-hand, standard library Python. Definitions: values placed at the hour plus 22.5 minutes and interpolated linearly (one-neighbour rule); clock `98.2 × Qc^−0.3935`, `Qc` = replay `lfQ` held inside 1,400 to 20,000; truth at `t + c`; "rising" = `lfQ` at `t` at least 10% above `lfQ` at `t − 6`; test years by estimate time 2020-01-01 to 2026-11-09; error of run OLD's `predictedCFS` (the shown value). Central clock only unless said.

Record, Difficult Run over Little Falls at the truth time (`DR(τ − 3) / LF(τ)`, `k = 1`):
| Group | Hours | DR missing | Median | Mean | 90th | 99th | ≥ 5% (k 1 / k 2) | ≥ 10% | ≥ 20% |
|---|---|---|---|---|---|---|---|---|---|
| All, test | 59,749 | 0 | 0.50% | 0.94% | 1.40% | 10.2% | 2.4% / 5.2% | 1.0% / 2.4% | 0.3% / 1.0% |
| All, 2012-2019 | 68,876 | 606 | 0.42% | 0.71% | 1.08% | 6.6% | 1.6% / 3.8% | 0.5% / 1.6% | 0.1% / 0.5% |
| Rising, test | 4,467 | 0 | 0.84% | 3.48% | 10.4% | 28.5% | 21.3% / 31.3% | 10.6% / 21.3% | 3.2% / 10.6% |
| Rising, 2012-2019 | 4,978 | 63 | 0.71% | 2.45% | 7.0% | 18.1% | 16.2% / 28.0% | 5.6% / 16.2% | 0.7% / 5.6% |

Section 4 quantity, rising test hours, 953 badly low against `T_LF`:
| k | ℓ | No longer badly low | of which within 15% | of which badly high |
|---|---|---|---|---|
| 1.0 | 1 / 3 / 5 | 293 / 295 / 231 (30.7 / 31.0 / 24.2%) | 292 / 291 / 226 | 1 / 4 / 5 |
| 2.0 | 1 / 3 / 5 | 485 / 456 / 369 (50.9 / 47.8 / 38.7%) | 366 / 340 / 297 | 119 / 116 / 72 |
| 2.25 | 1 / 3 / 5 | 514 / 473 / 393 (53.9 / 49.6 / 41.2%) | 357 / 335 / 300 | 157 / 138 / 93 |
- Badly-low hours between −17.5% and −15%: 157 (16.5%). Capped: 79.
- Placebo: `DR` replaced by its 30-day trailing median: 2.5% (k 1), 5.0% (k 2). `DR` from 14 days earlier: 5.2%, 8.2%.
- Rising test hours within 15% against `T_LF` (3,374) that turn badly high: 3.9% (k 1), 11.6% (k 2), 13.6% (k 2.25).
- Rising test hours with `T_falls` below the lowest Little Falls of the previous 24 hours, and how many of the "explained" rest on them: k 1, ℓ 3: 68 and 4; k 2, ℓ 3: 248 and 75; k 2.25, ℓ 3: 317 and 111.
- Creek hours (central `B` ≥ 10%), test years: 1,459, of them 950 rising; median Little Falls 5,000 cfs. Hours with central `B` ≥ 90% of Little Falls: 4; ceiling `B` ≥ Little Falls: 4.

Event pull (provisional readings):
- Excess volume per square mile from 26 Nov 00:00 to the last reading: Difficult Run 304, Dead Run 274, Seneca 89, Broad Run 453 cfs-hours per square mile (0.47, 0.42, 0.14, 0.70 inches).
- Peaks: Dead Run 154 cfs at 26 Nov 20:45; Difficult Run 1,610 at 23:30; Little Falls 10,100 at 27 Nov 19:40.
- `B / LF` (ℓ 3): 26 Nov 18:00 central 10.6%; 21:00 22%; 27 Nov 00:00 56%; 02:30 73% (floor 36%); 06:00 44%; 12:00 8.7%; 19:40 3.3%.
- A2 as the auditor read it (Little Falls base 1,640 at 26 Nov 12:00, end 28 Nov 00:00, Difficult Run base at the shifted start): share of the rise volume 11.3% (k 1), 22.7% (k 2), 25.5% (k 2.25), nearly the same for ℓ 1, 3, 5. The clock study's "four fifths" from the creeks between Edwards Ferry and Little Falls, and these numbers, together imply that most creek water of this rise joined above the falls (Broad Run alone shed 34,467 cfs-hours of excess against Difficult Run's 17,564).
- Minimum `T_falls` between 26 Nov 12:00 and 27 Nov 12:00: see F1.

Clock study pulses (the 10 that met the conditions, `py/dr_units.csv`): volume of the Little Falls rise (shifted 3 hours) over the Difficult Run rise, window 12 hours before to 24 hours after the Difficult Run peak: 2.40, 3.20, 2.44, 0.09, 2.86, 0.52, 3.17, 2.63, 7.26, 4.55 (median about 2.7). This ratio includes ungauged water above the falls, so it does not measure `k`; it says only that the scaled cases are not out of line with the river's own response, and that one pulse in five shows almost no response at Little Falls.

Counts that should change the plan: the impossible central and ceiling falls flow on the event (F1); the 116 to 138 turned-high hours inside "explained" (F2); the floor share crossing 25% between ℓ 3 and ℓ 5 (F2); the fivefold spread of runoff per square mile in the event (F3).

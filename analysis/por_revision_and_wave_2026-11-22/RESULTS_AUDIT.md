# Results audit (third auditor), Point of Rocks revision and daily wave

Date: 2026-11-23. Auditor: fresh Opus agent, no part in planning, building or analysis. Read-only on the study;
own code and outputs in a scratch directory outside the repository
(`/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/audit/`: `cmp.py`,
`mm.py`, `r1.py`, `rec.py`, `runs.py`, `w7.py`, `live/`).

## Verdict

**The results may be reported with the changes listed below.** Every number I recomputed reproduces, and the two
languages agree in both parts. The problems are in what several claims say the numbers mean. Four claims need
new wording before they reach the owner (R-a's flow-range contrast, R-h, W-c, W-e), one should be dropped as
worded (R-h), and three need a stated limit that changes how much weight they can carry (R-c, W-d, W-b).

The three most important corrections:

1. **R-a and R-h: the "small at high water" contrast is a time effect, not a flow effect.** Every revised reading
   above 3,000 cfs lies between 12 and 24 October, when USGS's change had only grown to 1 to 7%. On any single
   day the change is close to a fixed number of cfs at every flow (13 Oct: +89 cfs at 3,000 to 6,000 cfs,
   +131 cfs above 12,000 cfs). The data cannot say how large the shift now in force would be at higher flows.
   The earlier warning about the other flow ranges should not be withdrawn on this evidence.
2. **R-c: the hand measurement of 10 Nov is not an independent test.** USGS built the revision to match it, so
   "2,000 against 1,980" holds by construction. The independent evidence is the two water balances. They point
   the same way as Reading B, but they also show the revised record still sitting about 5 to 10% below the
   relation seen before October. Honest strength: "the revised record is clearly closer than the old one; whether
   it is right, especially for mid to late October, is not shown."
3. **W-d and W-e: the "cycle size" statistic has a large noise floor.** If the hours of day are shuffled within
   each day, half the range of the hourly means is still about 5.3 points (before) and 4.2 points (after) with no
   daily cycle at all. So 6.8 and 6.1 are mostly noise plus a real cycle of a few points. "No worsening
   detectable" holds under a fitted 24-hour wave as well (5.9 before, 5.0 after). But W-e's "the corrections add
   2.4 points" depends on the statistic: under a fitted 24-hour wave the shown estimate and the raw estimate
   have the same cycle after the revision (5.0 and 5.0).

A fourth correction, smaller but simple: **W-c's "6 hours" is not a candidate.** The two legs via Edwards Ferry
take at least 12.9 h and 17.3 h, so the total is at least about 30 h. The candidates are about 30 or 54 hours.

---

## Claims, one by one

### R-a. Size and timing of the revision: SUPPORTED WITH A CAVEAT (the flow-range sentence is OVERSTATED)

Reproduced exactly (own code from `data/tidy/`): 43,488 compared pairs from 12 Jun (43,500 if the 12 readings of
11 Jun 23:00 to 23:55 are kept, as both analysts did); 9,214 changed, all stamped 2026-11-13 19:41; first
2026-10-08 21:05, last compared 2026-11-09 23:55 (the archive ends there); 10,306 current readings carry the
stamp, the last at 2026-11-13 18:55. 37 unchanged pairs inside the span. Daily ratio: 9 Oct 1.008, 10 Oct
1.015, 25 Oct 1.102, 31 Oct 1.180, 7 Nov 1.261, 8 Nov 1.277, 9 Nov 1.286; job log 10 to 13 Nov: 1.278 to 1.333,
mean 1.305.

Two wording points:

- "About 10% by late October" is true for 25 Oct; by 31 Oct it is 18%. Say "about 10% on 25 Oct, 18% on 31 Oct".
- **"Large at low water (16%), small at high water (5%, 2% or less)" is a time effect.** By UTC day, every
  revised reading of 3,000 cfs or more is from 12 to 24 October (ratios 1.006 to 1.088); every reading after
  24 October is below 3,000 cfs. The flow-range means therefore compare early October with November. Within a
  day the change in cfs is nearly the same at all flows (13 Oct: +89, +110, +131 cfs in the 3,000, 6,000 and
  12,000 cfs ranges; 15 Oct: +191 and +188; 17 Oct: +192 and +187). The cfs change grows almost linearly in
  time, from about 10 cfs on 9 Oct to 409 cfs on 9 Nov.

Wording the data support: "USGS spread a correction over 8 Oct to 13 Nov that grows steadily with time, from
about 10 cfs on 9 Oct to about 410 cfs on 9 Nov (about 1% to 29% at the low flows of November). On a given day
it is close to the same number of cfs at every flow seen that day. Higher flows occurred only in mid October,
when the correction was still small, so the data do not say how large it would be at higher flows now."

### R-b. Nothing else revised: SUPPORTED, with a scope note

Recomputed: Little Falls flow 43,455 pairs, 0 changed; Little Falls level 43,467, 0; Monocacy 14,496, 0; Edwards
Ferry level 14,492, 0. Analysts: the same for all eight series in `R2_series`, Point of Rocks level in the
October pull (4,897, 0) and in the job log (274 of 275 equal; the one exception is seq 212, rewritten by USGS
minutes after the run).

Scope note: this covers the model gauges only. The upstream gauges used in R-c have no old copy and **were
themselves rewritten**. Shepherdstown has 6,926 readings (1 Sep to 13 Nov 19:30) stamped 2026-11-13 20:16, the
same evening as Point of Rocks. Catoctin, Conococheague, Antietam, Hancock and Paw Paw had bulk rewrites between
15 Oct and 19 Nov. Say "nothing else among the model's inputs was revised".

### R-c. The revised record is closer to the river: SUPPORTED IN DIRECTION, OVERSTATED IN STRENGTH

Numbers reproduce: 10 Nov 1,980 cfs at 1.20 ft (Fair, Clear); current 2,000; `f_old` 1,560 under all three rules
(-21.2%). Upstream balance at lag 1, 21 steady revised days: median ratio old 0.7514, new 0.8765 (my
recomputation from the day table: 0.7514 and 0.8765; spot check of the day means of U on 1 Nov and of Point of
Rocks on 2 Nov from raw readings: identical). Little Falls balance at lag 2, 9 revised days: median residual old
+594 cfs, new +270 cfs; "B supported" with the ratings band (370 cfs), "undetermined" with the fixed band
(246 cfs).

Why this is weaker than it reads:

1. **The 10 Nov measurement is circular for the new record.** USGS revised the record to agree with that
   measurement, so the new record matching it is expected by construction. It shows only that the old curve was
   21% low on 10 Nov.
2. **The 8 Oct measurement agreed with the old curve.** 1,510 cfs measured against 1,560 published (+3.3%,
   rated Poor, debris). The revision starts right after that visit and grows linearly in time to 10 Nov. That
   linear spread is USGS's assumption about when the debris effect changed, not a measurement. If the control
   changed abruptly (for example during the 12 to 15 October high water, up to 22,000 cfs), the revised record
   is still too low for mid to late October.
3. **The balances point the same way.** The revised record is closer, but not on the reference.
   - Upstream ratio on unrevised steady days: 0.96 to 0.98 in mid September. It was already falling in early
     October before any revision (0.90 on 1 Oct, 0.83 on 7 Oct). On revised days the new record gives 0.85 to
     0.93, still below the September relation; the old record falls steadily from 0.83 to 0.72. The strongest
     evidence is this trend: the old ratio drifts down over the span and the new one does not.
   - Little Falls residual on unrevised days: +160 to +210 cfs, the ungauged inflow. On revised days the new
     record gives +270 to +350 cfs, still 60 to 190 cfs above that baseline; the old gives +510 to +660.
   - Both say the same thing: the revised record removes most, perhaps not all, of the shortfall.
4. **The upstream reference has its own errors.** The latest hand measurements at Paw Paw, Hancock,
   Conococheague and Shepherdstown run 5 to 7.5% below the published flow, all inside their bands.
   Shepherdstown, the largest term of U, was rewritten on 13 Nov (above). Millville, the second largest, has no
   measurement since 1 Sep. If U is about 6% high, both ratios rise by about 6%; the ranking does not change.
5. **The verdicts depend on the band.** With the fixed centre 1.03 and the fixed 11.3% band, lags 0, 1 and 2 are
   "undetermined": both records lie outside. With the ratings band (21%) the new record is inside by 2.6 points
   at lag 1 (0.876 against a lower edge of 0.850) and outside at lag 2.
6. **The 21 days are one low-water spell, and 3 of them (8 to 10 Oct) carry almost no revision** (old and new
   within 1.5%), so they add nothing to the comparison.
7. **The withdrawal figures are daily totals reported to ICPRB.** Their own accuracy is unknown.

Wording the data support: "USGS's hand measurement of 10 Nov shows the old curve was about 21% low that day;
the revision was fitted to that measurement. Two independent water balances, upstream and at Little Falls,
both move toward the revised record, and neither favours the old one. They also suggest that even the revised
record may still be a few percent low for late October, which is consistent with USGS spreading the change
evenly over time. The revised record is clearly closer to the river than the old one. How close it is, day by
day before about 25 October, is not established."

### R-d. Three-term split after the revision: SUPPORTED WITH CAVEATS

Recomputed, own due time, phase NEW, 153 runs:

| Rule | Term 1 | Term 2 | Term 3 | MAE under old numbers |
|---|---|---|---|---|
| A | -1.18 | +26.40 | -0.002 | 4.47 |
| B | -0.36 | +25.58 | -0.002 | 4.33 |
| C | -0.82 | +26.05 | -0.002 | 4.50 |

All three rows match `R5_split`. MAE as run: 25.22.

Caveats the report must state:

- **Term 1 rests on extrapolation.** 80% of NEW runs (60% under rule C) use the old curve extrapolated below the
  lowest observed November level. The plan's own ruling says no rule is shown to bound the old curve below
  1.01 ft. The three rules differ by about 0.8 points, but they could all be off in the same direction. One
  20-cfs step at about 1,150 cfs is about 1.7%. Say "about zero (within a few points)", not "-1 to 0".
- **"Never happened" is a frozen curve, not a known alternative.** It assumes USGS would have kept the curve of
  10 to 13 Nov unchanged. In reality the old record was drifting low over time (R-c, point 3).
- **Term 2 is a restatement of R-a's size, not a separate finding.** Point of Rocks is about 83% of the
  pre-factor sum (mean `pre_cfs` 1,971; tributaries about 330). A 30% rise in that share gives about +25 to +26
  points on the raw error. Report term 2 as "what R-a's 30% means for the raw estimate".
- **Term 3 is zero by construction in NEW** (the spec says so). Reporting it as a finding adds nothing.
- **The old-numbers error itself moved by about 6 points** between phases: -6.2% in OLD (71 runs) against about
  -0.4% in NEW. Something besides the revision moved too (R8b: daily term 1 correlates -0.76 with the 24-hour
  change of Little Falls, 7 days). This belongs beside R-d.

### R-e. Raw estimate against Little Falls plus withdrawals: SUPPORTED WITH A CAVEAT

Recomputed: OLD 32 runs, e_raw -3.16, e_adj -24.41; TRANS 35, +11.04 / -15.85; NEW 98, +25.03 / -8.09. 96 runs
dropped for a missing withdrawal value. All match.

Caveats:

- **"Before" rests on one day.** The 32 OLD runs are all due on 12 Nov, the only OLD-period day with a
  withdrawal total (the totals for 6 to 11 Nov and 13 Nov are blank because WSSC was not reported).
- **"After" covers 98 of 169 NEW runs,** due 14 to 19 Nov.
- **The day-to-day test has no power.** Over 5 days the withdrawal varies by only 16 cfs (sd), r = 0.04. Do not
  present it as a test.
- **-8% is not zero.** "The raw estimate is the river before withdrawals" overstates. The remaining 8% is about
  the size of the ungauged local inflow seen on unrevised days in R-c (+160 to +210 cfs, about 10%), or a
  revised record still slightly low, or both.

Wording: "With the revised input the raw estimate is about 8% below Little Falls plus that day's net
withdrawal (98 runs, 14 to 19 Nov). On the one earlier day with withdrawal data it was about 24% below. This
fits the reading that the old, too-low input had offset the withdrawals. It rests on 6 days of withdrawal data
in all."

### R-f. The learned corrections: SUPPORTED AS ARITHMETIC; the recovery times are NOT a forecast

Table reproduced (both analysts identical): gaps 29 cfs (steady), 160 (falling), 171 (rising); 6.8, 7.2 and
14.8 days. These are 7 divided by the observed rate of NEW checks per bin.

They hold only if all of the following hold:

- the target stays where the last three checks put it (it moves with the falling river);
- checks keep landing in each bin at the same rate (which depends on the river's state);
- the soft clamp does not bind.

The rising-bin rate comes from 3 NEW checks. A 29-cfs gap is smaller than the scatter of the last three raw
errors in that bin (227 to 423 cfs).

Wording: "at the rate checks reached each bin during 15 to 22 Nov, the learning rule would close 90% of today's
gap in about a week (steady, falling) or two (rising), if the river held still. That is arithmetic, not a
forecast."

### R-g. Service switch and code versions: SUPPORTED WITH A CAVEAT

`R8_inputs` reproduces in both languages: every logged input equals the record except seq 212's Point of Rocks
reading. Error difference across the switch: -1.12 points, interval -3.16 to +1.68.

Caveat: the interval means only a break larger than about 3 points would have shown. The same split on term 1
gives -2.7 (rule A, interval -4.2 to -0.8) and -2.5 (rule C, -4.2 to -0.45). The two sides of the switch also
differ in river conditions, so a smaller effect of the switch could be hidden in them. Say "no break larger than
about 3 points"; the code was unchanged on the prediction path (tool audit, note 14).

### R-h. Withdrawing the warning about other flow ranges: NOT SUPPORTED

It rests on R-a's flow-range contrast, which is a time effect (R-a above). The data contain no revised reading
above 3,000 cfs after 24 Oct. On any one day the correction was nearly the same in cfs at all flows. If the
correction now in force is about 400 to 450 cfs at all flows, it would be about 7 to 15% at 3,000 to 6,000 cfs
and about 3% at 12,000 cfs. If it is a shift in feet, it would be larger in cfs at high flows. Neither is shown.

Wording: "Unknown. The revision was large only at low flow because the river was low when it grew large. Its
size at higher flows under the shift now in force cannot be read from these data. USGS may also change the
shift at its next visit."

### W-a. Size of the wave: SUPPORTED WITH A CAVEAT

From `W1_periods` (identical in both languages):

- Point of Rocks level, half range: 0.096 ft in P2, 0.071 to 0.085 ft in P4 to P7, against 0.037 ft in P1 (P3
  has only 2 non-event days).
- Point of Rocks flow: 7.1% (P4) to 12.5% (P2). Say "7 to 12%".
- Little Falls flow: 3.8 to 6.2%; median 89 cfs = 2.2 steps of 40 cfs, 10 to 22 Nov.

Caveat: at Little Falls the two measures that "must tell the same story" do not. The fitted 24-hour wave is
about half the half-range: 42 to 67 cfs against 78 to 131 cfs, so about 2.5 to 3.5% of flow. Much of measure
(a) at Little Falls is rounding steps and non-daily movement. Say "Little Falls: about 3 to 6% depending on the
measure, near the gauge's resolution".

### W-b. Origin: SUPPORTED WITH CAVEATS; the weekend statement is OVERSTATED

Numbers reproduce:

- Shepherdstown: 0.12 to 0.19 ft; 15 to 23% of flow in P2 and P4 to P7.
- Millville: 0.09 to 0.13 ft; 10.5 to 13.6% of flow.
- Paw Paw and Hancock: 0.7 to 2.5% of flow.
- In cfs the main stem carries about three quarters (Shepherdstown about 250 cfs, Millville 65 to 100 cfs).

Corrections and additions:

- **Weekend:** the ratio of 0.39 at Shepherdstown is for P5 to P7 only, from 5 weekend days. In P2 (15 Sep to
  11 Oct, also 5 weekend days) the ratio is 1.00. Point of Rocks shows 0.62 in November and 1.02 in P2; Little
  Falls 1.18 in November. A nightly eel shutdown does not predict a weekend difference. Say "in November only,
  from 5 weekend days, and not in September and October; not established".
- **The data do support the documented cause more than the claim says.** The wave sets in sharply on 15 to
  16 September at all three gauges:
  - Shepherdstown half-range 0.145 ft on 15 Sep, 0.135 on 16 Sep;
  - Millville 0.076 ft on 16 Sep, after 0.01 to 0.06 ft before;
  - Point of Rocks 0.067 ft on 16 Sep;
  - the fitted 24-hour amplitude doubles at the same time.

  This matches the documented start of the eel shutdown season (15 Sep). The P2 boundary was set from that
  document, but the jump is visible in the daily table whatever the boundary. Crest times of about 15 to 18 h
  local upstream fit daytime operation.
- **What the documents do and do not say.** The FERC Millville document describes only temporary flow changes
  at Millville that "attenuate within approximately two hours". It does not describe a 24-hour wave of 10 to 14%.
  The claim of a daily pattern rests on ICPRB's general statements, which name no dams. Dam 4 and Dam 5 are not
  documented to shut down nightly. Say "a public agency (ICPRB) attributes it to upstream hydroelectric dams
  shutting down at night during eel season; no document quantifies it or names the main-stem plants".
- **Clock test.** It is "undetermined" everywhere, but it is also ill-posed. The windows (22 to 31 Oct, 2 to
  11 Nov) straddle a recession that lengthens travel times. Point of Rocks' crest moved about +3 h (interval
  +1.5 to +4.6) and Millville's about +7 h. That is neither "follows the clock" (+1) nor "does not" (0). It
  should not be read as evidence either way.
- **Instrument test not mentioned.** Point of Rocks level and water temperature correlate at r = -0.68 at lag 0,
  |r| = 0.75 at 10 h. Two daily cycles always correlate at some lag, so this test cannot clear the gauge. The
  stronger evidence against an artifact at one gauge is propagation: the same wave appears in sequence at
  Shepherdstown and Millville, then Point of Rocks (13.5 to 16 h later), then Edwards Ferry (13 h later). The
  report should say that, and that the plan's "overturn" condition (no clock shift plus a temperature link) was
  not cleanly tested.
- **The weekend and size measures depend on the gauge.** Relative sizes in flow depend on each gauge's
  level-to-flow slope, and ratios from 5 weekend days carry no interval. Do not compare percentages across
  gauges as if they were measured the same way.

### W-c. Travel to Little Falls: OVERSTATED in one point

Reproduced:

- PoR-LF peak correlation at 6.42 h modulo 24 for 1 to 22 Nov; crests 5.75 h (circular sd 3.0);
- the legs add up within -0.17 h;
- whole days "unresolved" (no weak day matched at Little Falls; 2 matched onsets where 3 are required).

Corrections:

- **6 hours is excluded by the legs.** PoR to Edwards Ferry peaks at 12.9 h (next maxima 36.9, 61.1). Edwards
  Ferry to Little Falls peaks at 17.3 h (next 42.2, 67). Neither leg can be shorter, so the total is at least
  about 30 h. 6 h over about 45 river miles at 1,500 cfs is also physically implausible.
- **The two matched onsets are 18 h (July) and 82 h (August).** Under the "first Little Falls onset within
  96 h" rule they are probably unrelated events. They carry no information.
- **The data barely prefer about 30 h.** After the revision r = 0.815 at 31.1 h against 0.799 at 55.3 h; for all
  of November 0.632 against 0.546. Before the revision 30.0 h and 5.6 h are tied. That is not decisive. The
  plan's rule correctly says "unresolved".
- The model assumes 49.2 h (NEW) and 54.1 h (OLD), from `W3_model_times`; this is correct.

Wording: "Within the day the wave reaches Little Falls about 6.4 hours later than its Point of Rocks timing.
The two legs via Edwards Ferry show the total is at least about 30 hours, so the candidates are about 30 or
about 54 hours. The data lean very slightly to 30 but do not decide. The model assumes about 49 hours now,
54 before."

### W-d. Daily error cycle before and after: SUPPORTED WITH A CAVEAT; reword to "no worsening detectable"

Recomputed: e_raw cycle 6.767 (OLD, 71 runs, 21 valid hours) and 6.105 (NEW, 155 runs, 24 valid hours);
difference -0.66, interval -2.05 to +4.88. Matches.

Caveats:

- **The OLD phase is 4 UTC days** (10 Nov has 3 runs), so its hourly means are averages of about 3 runs each,
  and the day-block interval is built from 4 blocks.
- **The half-range of hourly means has a noise floor.** With hours shuffled within each day (2,000 shuffles),
  the statistic is 5.3 (OLD) and 4.2 (NEW) with no daily cycle at all; the 95th percentiles are 6.5 and 5.4. The
  floor is higher in OLD because it has fewer runs per hour. So the comparison is biased toward finding the OLD
  cycle larger.
- **A fitted 24-hour wave per run, with day offsets removed, gives amplitude 5.9 before (bootstrap 3.6 to 7.7)
  and 5.0 after (3.5 to 7.3).** Same conclusion, without the bias.

Wording: "There is a daily error cycle of about 5 points both before and after the revision. No worsening is
detectable with 4 days before and 7 after; a worsening of up to about 5 points cannot be excluded. The earlier
'plus or minus 1.5 before, plus or minus 6 after' came from 5 and 15 checks and is withdrawn." The withdrawal
itself is correct.

### W-e. Flat raw estimate; the rise/fall factor; corrections add a cycle: PARTLY OVERSTATED

Supported (NEW): raw cycle 1.8% of its mean, truth 4.0% (`W4_component_cycles`). H3 NEW: without the factor
11.92 against 6.11, "matters".

Corrections:

- **"The factor flattens it" holds after the revision only.** Before it (H3 OLD), the error cycle without the
  factor is 4.81, against 6.77 with it (interval -3.35 to +4.66, undetermined). Point estimate: the factor made
  it larger.
- **The 12-point counterfactual is fair arithmetic but needs its mechanism stated.** The time-shifted sum
  (`pre_cfs`) carries a 7% wave peaking at about 20 h local. The truth peaks at about 13 h. The factor (peak
  about 9 h) happens to cancel the misplaced wave, leaving a flat estimate. Removing the factor alone keeps the
  wrongly timed wave, so "12 points" describes a model with a misplaced wave and no cancellation. It is not a
  neutral baseline. Say "the time-shifted input carries the wave at the wrong hour; the rise/fall factor
  happens to cancel it, so the estimate is flat and the error cycle is roughly Little Falls' own cycle".
- **"The state-dependent corrections add about 2.4 points (0.3 to 5.0)" is final against raw.** That includes
  the cap, which itself removes 1.4 points (H6 cycle). The direct test, state corrections against one mean
  correction (H4 `mean_correction`), gives +2.46 with interval -0.26 to +5.22, undetermined. The final_vs_raw
  row is labelled "undetermined" too (share interval 5 to 75%). Under a fitted 24-hour wave the shown and raw
  estimates have the same amplitude after the revision (5.0 and 5.0). Say "the shown estimate may have a
  somewhat larger daily cycle than the raw one; the size depends on how the cycle is measured and is not
  established".

### W-f. Nine candidates; reading pick; cap and corrections: SUPPORTED WITH CAVEATS

Numbers reproduce (W5 identical in both languages after the addendum).

- **"None is supported" is the wrong summary.** Three rows are labelled "matters": H3 cycle, H4 MAE and H6 MAE.
  They matter for the level and shape of the error, not for a change, so say "none explains a worsening, since
  no worsening is detectable".
- **Reading pick.** With the new numbers the MAE changes by -0.02 to +0.03 points (intervals about +/-0.5) for a
  6.3 to 6.5 h change in assumed delay. With the old numbers it changes by -0.24 to -0.28. The cycle changes by
  +0.18 to +0.26 (new numbers) and -1.26 to -1.37 (old numbers). "Less than 0.1 point" is right for MAE with the
  new numbers only; add the intervals.
- **Cap: -3.31 (interval -4.05 to -2.55). Corrections: -2.19 (-2.77 to -1.57).** Both correct. Context:
  - the cap bound on 74 of 169 NEW runs (44%), or 73 of the 155 with a truth (47%); the two analysts each report
    one denominator, so name it;
  - the cap uses Little Falls itself, so it helps most exactly when the raw estimate is 25% high, as now; the
    benefit is specific to this period;
  - the "single mean correction" uses the in-sample mean of the period (hindsight), which favours that
    comparison slightly.

### W-g. MAE of the shown estimate after the revision: SUPPORTED

Recomputed 16.04% over 155 hourly estimates (NEW runs 15 Nov 07:00 to 21 Nov 20:00 with a truth); 16.14% if the
TRANS runs from 13 Nov 20:00 are included. Against Little Falls interpolated at the due time, one low-water
regime, one flow bin. The job's own 15 checks gave 14.3%, so the checks slightly understated it.

### W-h. Long history 2011 to 2026: SUPPORTED WITH A CAVEAT

Reproduced exactly with my own preparation of the hourly file:

- Point of Rocks wave-day share: October 0.801, November 0.689, September 0.525, March 0.066, April 0.087;
- below 2,000 cfs at Little Falls: 273 of 454, 0.601;
- W7b corrected MAE by wave class: 4.69 (0 to 1%), 5.94, 5.76, 6.60 (6% or more), on 48, 399, 333 and 231 days.

Caveats:

- **A "wave day" is any non-event day whose detrended half-range reaches 3% of the mean.** It is not a test of a
  24-hour rhythm. I checked whether it counts rounding noise. On wave days a single 24-hour harmonic explains a
  median 95% of the detrended day (Sep to Nov) and 86% (other months), so most wave days are smooth one-hump
  days, not noise. But any smooth within-day movement under the 10% event threshold also qualifies. Point of
  Rocks flow at 1,500 cfs moves in steps of about 20 cfs, so 3% is about 2 to 3 steps.
- **The 4.7% rests on only 48 days**, and the gradient is not monotone (5.9, 5.8, 6.6).
- **The raw error runs the other way**: 24.0, 20.7, 18.9, 18.8.
- **Wave days cluster in autumn at low flow**, so season and flow confound the comparison.

Wording: "In 15 years of the production model, at Little Falls flows below 3,000 cfs, the corrected error was
somewhat higher on days with a large daily swing (6.6% against 4.7% on the 48 calm days). This is an
association, mixed with season."

---

## Cross-language agreement (my own comparison, not the orchestrator's tool)

Code: `cmp.py` (cell by cell: tolerance 0.01, 0.0001 for ratios, correlations and shares; `Z` and `+00:00`
treated as equal) and `mm.py` (single numbers matched by value, then checked by meaning).

**Part R.** 31 of 31 tables identical in every cell. One form difference: `R5_runs` in R carries four extra label
columns (`cur_label`, `back6_label`, `hist_label`, `label_all_three`); the shared columns are identical.

Metrics: every Python number has a value match in R except:

- grid steps, written in seconds by Python and in minutes by R (same meaning);
- the count of visits with several rows of one kind: Python 24 for both gauges together, R 7 + 17 = 24;
- Python's count of intervals for Little Falls (47), which R does not report.

R reports extra counts that Python does not (visit totals, `b_lf` = 0.08, day counts of R4).

`n_pairs_all` = 43,500 in both. It includes 12 readings of 11 Jun before the spec's window; R also gives 43,488.
No disagreement.

**Part W.** 28 of the 29 shared tables identical. The one differing cell is `W2_daily`, Catoctin level,
26 Oct, `phi_b_utc_h` 16.32 (Python) against 22.74 (R): the fitted wave is of size zero, so its timing is
undefined, as ruling 5 says. R has two extra files (`boot_skipped.csv`, `series_prep.csv`).

Metrics match by value except:

- **the cap share in NEW:** Python 0.4379 = 74 of 169 used runs; R reports that and also 0.4710 = 73 of the
  155 runs with a truth. Not a disagreement, but the report must pick one denominator;
- the blank W3 decision metrics, blank in both.

**Ruling 5's account of the pre-addendum differences is accurate.** My comparison of the two `tables_v2/`
folders finds:

1. crest and trough ties: `W1_daily` 10 cells of up to 0.17 h; `W2_daily` 87 cells, some 20 h apart on flat
   days; period means;
2. resampling columns: every interval of `W2_clock` (up to 8.6 h on Paw Paw's lower bound);
3. `cycle_size_pct_of_mean` for `corr_c` OLD, -37.8 against +37.8;
4. paired run sets in W5: Python's `value_a`, `value_b`, `diff` differ by up to 0.09 in H1 `mean_delay_h` and H7
   MAE;
5. R's blank `lo_p`, `hi_p` for H3 OLD;
6. capital letters in four H2 variant names.

What remains after the addendum is the single Catoctin cell and the bookkeeping count, as stated.

## The addendum (ruling 5): were the conventions neutral?

All six are neutral in effect. None changed a label or a claimed number by a meaningful amount.

| Convention | What changed (v2 to v2.1) | Effect on claims |
|---|---|---|
| A1 ties (9-decimal rounding) | Crest/trough hours on flat days; period means by up to 6.6 h at Paw Paw and Catoctin; Point of Rocks, Little Falls, Shepherdstown, Millville clock rows unchanged in point estimate | All 13 clock labels stay "undetermined" (W-b) |
| A2 group a uses u1, group b u61 | Interval bounds only | No label change |
| A3 absolute mean | Sign of one percentage | None |
| A4 one run set per paired row | Python H1 delay means move by about 0.1 h; H7 MAE value_a 25.27 to 25.23 | Labels unchanged; W-f's "more than 6 hours" and "less than 0.1 point" unaffected |
| A5 c_ref for OLD-only rows | Fills R's blank interval for H3 OLD | Label unchanged ("undetermined") |
| A6 variant names | Text | None |

Two observations:

- A2 and A4 are the readings the R analyst had already used. R's W5 numbers did not change, and Python's moved
  onto R's. That is a choice between two reasonable readings, not a choice that moves a result toward a
  conclusion.
- A1 is a pure tie rule.

The orchestrator could not have steered a Part W conclusion through these: every claim W-a to W-h rests on
cells that are identical or immaterially different between `tables_v2/` and `tables/`.

## My recomputed numbers beside the analysts'

| Item | Mine | Analysts (both) |
|---|---|---|
| REV13 count | 9,214 | 9,214 |
| REV13 first / last compared | 2026-10-08 21:05 / 2026-11-09 23:55 | same |
| Stamped 19:41, count and last | 10,306; 2026-11-13 18:55 | same |
| Ratio 10 Oct / 25 Oct / 8 Nov | 1.0146 / 1.1015 / 1.2766 | `R1_by_day`: same |
| R-b: Little Falls flow pairs, changed | 43,455, 0 | 43,467, 0 (theirs from 11 Jun 23:00; mine from 12 Jun 00:00; LF level 43,467 both) |
| R-b: Monocacy flow pairs, changed | 14,496, 0 | 14,496, 0 |
| 10 Nov measurement / current / f_old A, B, C | 1,980 / 2,000 / 1,560, 1,560, 1,560 | same |
| Upstream balance lag 1, median old / new | 0.7514 / 0.8765 (from their day table; one day's U and PoR day means checked from raw) | 0.7514 / 0.8765 |
| R-d rule B, NEW, terms 1/2/3 | -0.357 / +25.583 / -0.002 | -0.36 / +25.58 / -0.00 |
| R-e NEW e_raw / e_adj | 25.03 / -8.09 (98 runs) | same |
| R-e OLD e_adj | -24.41 (32 runs) | same |
| W-d e_raw cycle OLD / NEW | 6.767 / 6.105 | 6.767 / 6.105 |
| W-e e_final cycle NEW | 8.499 | 8.499 |
| W-g MAE final NEW | 16.04 (155) | 16.04 |
| W-h October share of wave days | 254/317 = 0.801 | 0.801 |
| W-h class 0 to 2,000 cfs | 273/454 = 0.601 | 0.601 |
| W-h W7b classes, MAE corrected | 4.691, 5.936, 5.757, 6.604 | same |
| Extra, mine only | Null cycle, hours shuffled within day: 5.30 (OLD), 4.16 (NEW); 24-h harmonic amplitude e_raw 5.94 / 5.03, e_final 8.07 / 4.99 | not computed |

## Spot checks against USGS today (2026-11-23, keyless, 8 requests)

All frozen values match the live service; no value has been rewritten since the freeze.

| Series | Time (UTC) | Frozen | Live | last_modified (live) |
|---|---|---|---|---|
| Point of Rocks flow | 2026-10-25 12:00 | 2,900 (old 2,640) | 2,900 | 2026-11-13 19:41:13 |
| Point of Rocks flow | 2026-11-05 12:00 | 2,180 (old 1,780) | 2,180 | 2026-11-13 19:41:13 |
| Point of Rocks flow | 2026-11-12 12:00 | 1,980 | 1,980 | 2026-11-13 19:41:13 |
| Shepherdstown flow | 2026-11-05 12:00 / 12:30 | 1,190 / 1,210 | 1,190 / 1,210 | 2026-11-13 20:16:10 |
| Millville flow | 2026-11-05 12:00 | 528 | 528 | 2026-11-05 12:35:20 |
| Little Falls flow | 2026-11-18 12:00 / 12:05 | 1,560 / 1,600 | 1,560 / 1,600 | 2026-11-18 12:58:22 |
| Field meas. Point of Rocks | 2026-06-12 | 4,040 cfs, 2.02 ft, Fair | same | 2026-11-13 20:34:53 |
| Field meas. Point of Rocks | 2026-08-12 | 2,690 cfs, 1.65 ft, Poor | same | same |
| Field meas. Point of Rocks | 2026-09-03 | 1,830 cfs, 1.34 ft, Poor | same | same |
| Field meas. Point of Rocks | 2026-11-10 | 1,980 cfs, 1.20 ft, Fair, Clear | same | same |
| Field meas. Shepherdstown | 2026-11-10 | 1,200 cfs, 2.02 ft, Poor | same | 2026-11-13 21:20:44 |

That is 14 values; 3 are Point of Rocks flows inside the revised span, 5 are field measurements and 2 are
upstream gauges. The 8 Oct Point of Rocks measurement was not on the first page of the live answer (10-row
page). An earlier request saved in the same scratch folder by another session shows it unchanged (1,510 cfs,
1.20 ft); I did not repeat it.

## Research table and notes

Withdrawals: three rows checked against the saved CO-OP pages. All match `withdrawals_coop.csv`.

| Date | Fairfax | WSSC | Aqueduct Great Falls | Aqueduct Little Falls | Total | Net |
|---|---|---|---|---|---|---|
| 1 Nov (node 831) | 80 | 168 | 116 | 0 | 375 | 367 |
| 12 Nov (node 840) | 88 | 117 | 112 | 0 | 323 | 316 |
| 18 Nov (node 845) | 86 | 169 | 118 | 0 | 383 | 375 |

The pages also say "Estimated flow below Great Falls intake is flow at Little Falls ...". This supports the
model's design of validating against Little Falls, and R-e's reading that the raw estimate (upstream of all
intakes) should exceed it by the withdrawals.

Key quotations, checked in the saved pages:

- ICPRB 24 Oct 2024: "From September to December, upstream hydroelectric dams turn off operations at night
  during the annual American eel migration downstream" and "the flows downstream fluctuate in this predictable
  daily pattern". Verbatim.
- ICPRB 23 Oct 2025: verbatim.
- FERC Millville document: "shuts down nightly from September 15 to December 15" and "attenuate within
  approximately two hours". Verbatim (the second limits what the document can be cited for, see W-b).
- USGS eel publication: "nighttime turbine shutdowns (1800-0600 hours) ... September 15-December 15". Verbatim.

Must not be cited (search-tool summary only, per the notes themselves):

- capacities and operating modes of Dam 4 and Dam 5;
- the Shenandoah P-2509 "run-of-river, 44 cfs";
- the eelway status at Dams 4 and 5;
- the Millville licence date of 2017;
- the September 2025 Jennings Randolph release;
- the Point of Rocks REMARKS on "run-of-the-river hydroelectric plants" (marked UNVERIFIED);
- the Corps' ownership statement for Jennings Randolph and Savage;
- in `USGS_REVISIONS_BACKGROUND.md`: the USGS FAQ sentence on debris and backwater, the webflags blog, the
  sw1408 memo, the "three years" and "6 months" statements, and the 5% shift practice;
- in `WITHDRAWALS_AND_INTAKES.md`: the January 2026 Little Falls intake closure (DVIDS), the NPS location text
  for the Great Falls intake, Loudoun (WTOP), Leesburg, and the "USGS adds withdrawals back" wording for
  01646502.

## First-pass numbers (PLAN.md section 1 and section 0)

**Reproduced:**

- the shown error, 2.6% over 5 checks and 14.3% over 15 checks (my sum of `R6_checks.errPctCorr`: 2.59 and
  14.33);
- the job log reading of 13 Nov 16:55 (1,440 cfs) against today's 1,860;
- the field measurements and their ratings;
- morning raw error higher than afternoon: hourly NEW means are about 28 to 31% for due hours 0 to 8 local and
  19 to 22% for 11 to 17. "Evening" is the wrong word; the low is early afternoon, and evenings are 24 to 27%.

**Corrected:**

- "about 21% high after" is 25.3% on hourly scoring;
- "about 7% low before" is 6.2%;
- "about 30% more flow at the same level" is true only for 10 to 13 Nov; the change grew from about 1% on 9 Oct;
- "since 14 Nov off by about 14%" is 16.0% on all hourly estimates (the 14.3% is the check-based figure);
- "the river goes up and down by about 0.2 ft every day": the full daily range is about 0.14 to 0.19 ft (half
  range 0.07 to 0.10).

**Overturned:**

- "the estimate follows the wave worse since the revision" (W-d);
- "plus or minus 1.5 before, plus or minus 6 after" (withdrawn).

**Partly supported:** Reading B's "the 20% gap now visible is the withdrawals". The raw estimate is +25% against
Little Falls and -8% against Little Falls plus withdrawals.

**Not re-derived:** the 7.4% long-run figure.

## Weak points of the specification, now that results exist

1. **R1.6 compares unlike quantities (the orchestrator's suspicion is right).** The coefficient of variation of
   the ratio (0.082) divides by about 1.12, not by the change. Taken on the excess, the ratio minus 1, it is
   0.785, worse than the cfs difference (0.446) and the level shift (0.587). Within single days the cfs
   difference is the most stable (median within-day coefficient of variation 0.031, against 0.058 for the
   excess ratio). None of the three is constant, because all are dominated by the growth in time. A fair
   comparison is within a day: there the change looks like a nearly fixed number of cfs, growing with time.
2. **R7 and the level bands of R1 classify by flow without controlling for time** (R-a, R-h).
3. **R4(0) treats the 10 Nov measurement as an independent reference** although the revision was fitted to it.
4. **R4(a) uses a fixed centre of 1.03** where the observed unrevised relation is 0.96 (and drifted from 1.05 to
   0.83 in September and early October). **R4(b) centres its verdict on zero** although unrevised days show
   about +160 to +210 cfs of ungauged inflow. Both choices happen not to change the direction here, but they
   make the verdicts depend on the band rather than on the comparison with unrevised days.
5. **The cycle statistic** (half the range of hourly means over hours with at least 3 runs) is biased upward, and
   more so with fewer runs per hour. That makes OLD against NEW comparisons (W4, H5) lean toward finding OLD
   larger. A fitted 24-hour wave with day offsets would have been the better primary measure.
6. **W3(4) matches each Point of Rocks onset to the first Little Falls onset within 96 h.** That can pair
   unrelated events; the two matches (18 h, 82 h) are inconsistent.
7. **W3 legs were combined modulo 24.** The unreduced legs exclude totals below about 30 h, information the
   decision rule discards.
8. **The clock test windows straddle a recession,** so travel-time changes are confounded with any clock effect.
9. **R6's 7-update rule** ignores the soft clamp and the moving target.
10. **Wave size (a)** at a gauge with coarse flow steps (Little Falls) mixes rounding and non-daily movement; the
    plan's "two measures must tell the same story" was not enforced.

**Shared misreadings where agreement proves nothing:** none found in the computations. Both analysts followed
the recipes, and my independent code reproduces them. The points above are weaknesses of the recipes, so the
agreement of two analysts on them confirms only the arithmetic.

## Limits the report must state

- One revision, one low-water spell (all NEW runs in the 0 to 3,000 cfs bin), one week after the revision, 4 days
  before it.
- The revised record is itself provisional; USGS spread the change evenly in time between two visits, an
  assumption. The upstream gauges were rewritten too (Shepherdstown on 13 Nov), and their published flows run
  5 to 7.5% above their latest hand measurements.
- "Revision never happened" is an extrapolated, frozen old curve; term 1 is "about zero, within a few points".
- Withdrawal data cover 6 of the 11 days of runs (12 Nov and 14 to 19 Nov) and are daily totals. Nothing hourly
  exists, so pumping rhythm (H9) cannot be tested.
- The revision's effect at flows above 3,000 cfs under the shift now in force is unknown.
- The whole-day part of the wave's delay is unresolved (30 or 54 h).
- The daily error cycle is a few points above what noise alone produces; before/after comparisons of it rest on
  4 days before.
- The wave's cause is attributed by ICPRB, not measured. The onset on 15 to 16 Sep fits the documented season;
  no document quantifies the effect.
- W7 is an association across 15 years, mixed with season and flow.
- The cap's 3.3-point benefit is specific to a period when the raw estimate runs 25% high.

## Not checked

- The analysts' code was not read line by line except the W5 candidate sections (H3, H4, H6), which match the
  spec. My conclusions rest on independent recomputation of the headline numbers. The rest of the analysts'
  code, including the bootstrap machinery for every interval, was not re-implemented. I reproduced intervals
  only by agreement between the two languages.
- My upstream-balance check used the analysts' day table plus a raw-data spot check of one day; I did not rebuild
  event days and the 90% rules for all 68 days.
- No query of the live job log (Supabase).
- The replay tool and the fidelity gate were not re-audited (the tool audit did this).
- The 8 Oct field measurement was not re-fetched live by me (see spot checks).
- The ICPRB 11 Dec 2025 page and the CO-OP "eel" count (35 of 37 reports) were not rechecked.
- The 7.4% long-run figure of section 0.

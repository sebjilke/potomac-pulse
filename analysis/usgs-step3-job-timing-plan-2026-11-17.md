# Step 3 plan: run the hourly job after USGS has published (draft for owner approval)

Written by the orchestrator on 2026-11-17. Nothing in this plan has been built. Line numbers are from commit 2161b21.

## 1. Why

The hourly job is scheduled at minute :00 and starts between :00:53 and :01:02. USGS publishes each gauge once an
hour at a fixed minute. Evidence, two independent sources:

| Gauge | Published at (2 days of USGS `last_modified`, 15 to 17 Nov) | Age of the reading the job used (job's own log, 4 runs on 17 Nov, checked by a fresh verifier) | Next batch after the run started |
|---|---|---|---|
| Little Falls | :57 to :58 | 11 min | 56 to 59 min later |
| Seneca | :55 to :56 | 11 min | 54 to 58 min later |
| Broad Run | :48 to :49 | 21 min | 47 to 52 min later |
| Monocacy | :46 to :48 | 31 min | 46 to 52 min later |
| Goose Creek | :00 to :01 (once :06) | 16 min in three runs, 76 min in one | 2.5 min later in the missed run |
| Edwards Ferry | :01 (three times :36 to :39) | 76 min in three runs | 0.3 to 0.4 min later |
| **Point of Rocks** | **:02 (41 of 49), :03 (5), :51 to :54 (3)** | **66 min in all four runs** | **1.4 min later** |

So the job always reads Point of Rocks and Edwards Ferry one batch late, and Goose Creek sometimes. Point of Rocks
is the starting point of the estimate: its newest reading enters the Point of Rocks change correction
(`appliedRatio = 1 + (por.q / historicPoR.cfs - 1) x min(0.50, sqrt(fractionElapsed))`) and the rise-rate input.
At steady flow an hour-old reading costs almost nothing; on a rise or a recession it is the difference that matters.

## 2. Proposal

1. `netlify.toml:38`: `schedule = "0 */1 * * *"` becomes `schedule = "5 * * * *"`. With the observed start delay
   of about 55 s the job then starts at about :05:55.
2. `SERVER_VERSION` becomes v39.14, so every `tick_log` row says on which schedule it was made.
3. Comments and documents that state the schedule (`scheduled-update.js:2074` and the docs), and the working rule
   "never push within two minutes of the top of the hour", which becomes "never push between :03 and :09".
4. No change to any formula, constant, bin, threshold, time limit or to the app.

Why minute 5: Point of Rocks was published by :03:59 in 46 of 49 hours of the sample and Edwards Ferry by :01:59 in
44 of 47; minute 5 leaves about two minutes of margin after the latest of these and costs five minutes of age on
the four gauges that publish before the hour.

## 3. What changes for the estimate

| Input | Today | After |
|---|---|---|
| Point of Rocks newest reading (flow, stage) | 66 min old | about 11 min old |
| Edwards Ferry stage (blend weight near zero below about 6,000 cfs; divergence advisory) | 76 min old | about 21 min old |
| Goose Creek flow (3.0% tributary) | 16 or 76 min old | about 21 min old |
| Little Falls (120% display cap; the truth for validation), Seneca | 11 min old | 16 min old |
| Broad Run, Monocacy | 21 and 31 min old | 26 and 36 min old |
| The historic Point of Rocks reading used for the time shift (about 37 h back today) | unchanged in method; the lookup time moves by 5 min | |

The same inputs still give the same output. The inputs are fresher. Version: MINOR.

## 4. Effects to check before building (for the auditor and the builder)

1. **Learned corrections.** The 18 correction bins were learned while the Point of Rocks input lagged by an hour.
   In rising and falling states the raw model's bias may shift once the lag is gone; the bins re-learn at
   alpha 0.3 per validation, but validations in rising states are rare (about two validations a day in total at
   low flow). Is a transient over- or under-correction on the next rise plausible, how large, and should anything
   be done about it (nothing; a note; a reset of nothing; a shadow log)?
2. **Run health** (`computeRunHealth`, `round(gapHours)`): the first run after the change comes 65 min after the
   previous one. Must count as one cycle, not as a miss.
3. **Hour-of-day logic**: `SNAPSHOT_HOURS_UTC` (`scheduled-update.js:3051`), the hour test at 2983, and
   `hourFraction` at 876 use the hour, not the minute. Confirm nothing assumes minute 0.
4. **Validation timing**: the 2.5 h cap after `validationDue`, the forecast validation clock
   (`targetTime + travel`), the 90 h stale sweep, the 12 h rule of the Little Falls residual advisory, the 5 h
   median of the Edwards Ferry divergence advisory (one sample per run). All are relative to "now"; confirm none
   is tied to the top of the hour.
5. **The app**: it refreshes on its own 15 minute clock and reads server state with 2 h freshness guards. Confirm
   nothing displays or assumes "updated on the hour".
6. **Monitoring** (healthchecks.io): the success signal moves from about :01 to about :06. If the check is
   configured with a fixed schedule or a grace period under about 6 minutes, the first run after the change (65
   min after the previous signal) raises one false alert. Owner checks the setting; the assistant never calls
   that service.
7. **Netlify**: a changed schedule takes effect with the deploy. The deploy itself must not land between the old
   and the new run time in a way that skips an hour: push at about :10 to :50.
8. **Tests and documents** that state the schedule or the push rule.

## 5. Options

| | A. Move the schedule (recommended) | B. Move it and log a comparison | C. Analyse first, move later |
|---|---|---|---|
| What | the change above | A, plus each run also logs the estimate it would have produced with the older Point of Rocks, Edwards Ferry and Goose readings (the ones the :00 run would have seen) | replay past runs offline with fresher readings and compare errors before changing anything |
| Evidence gained | before and after, separated by `ver` in the log, confounded by different weather | a like-for-like pair every hour, scored when the water arrives | a number before the change |
| Cost and risk | one line of configuration | new logging code in the hourly job (logging only, but in the load-bearing file) | a full empirical analysis under the project's protocol; `tick_log` only starts on 2026-11-10 and holds no real rise yet, so the answer would rest on steady flow |
| Reversible | yes, one line | yes | not applicable |

Recommendation: A. Using a reading that is 55 minutes fresher needs little proof, C cannot say anything about
rises until rises have been logged, and B adds code to the file that feeds the estimate for a question that the
planned backtests (TODO A5, A8, once three real rises are logged) will answer anyway.

## 6. Verification

- Before: `npm test`; a test pins the schedule string and that `SERVER_VERSION` and the documents agree.
- After the deploy, by a fresh verifier with the owner's export of `tick_log`: three runs start between :05:30 and
  :06:30; one row per hour; `ver` v39.14; the Point of Rocks, Edwards Ferry and Goose readings are at most about
  25 minutes old at run start and each is the newest published; Little Falls is at most about 20 minutes old; run
  health counts no miss at the changeover; the monitoring service stays up.
- Unverified until a real rise: any effect on accuracy.

## 7. Non-goals

No change to formulas, bins, thresholds, the app, the 15 minute refresh, the function `/api/usgs`, or the number of
runs per hour. No second run per hour.

## 8. Decisions for the owner

1. Option A, B or C (recommended: A).
2. Minute 5 (recommended) or another minute.
3. A look at the healthchecks.io setting before the change (grace period of at least 10 minutes, or a simple
   "every hour" period rather than a fixed minute).

---

# Rulings on the plan audit (orchestrator, 2026-11-17)

The audit is `usgs-step3-job-timing-plan-2026-11-17.PLAN_AUDIT.md` (no blocker, five major findings). A ruling
wins over the audit; the audit wins over the plan. Nothing is built before the owner decides.

| Finding | Ruling |
|---|---|
| 1 Minute 5 is the wrong trade-off | ACCEPTED: **minute 10** (`schedule = "10 * * * *"`, start at about :10:55). The four gauges that publish at :46 to :58 return the same readings to any run between about :04 and :45, so a later minute costs nothing on them; the plan's "five minutes older" was wrong. On 10 to 30 days of USGS data minute 10 catches the late batches that minute 5 would miss (Point of Rocks at :07 and :09 on 17 Nov; Edwards Ferry at :05:49; Goose at :06). Section 3's table is corrected accordingly: the early gauges are unchanged, not older. |
| 2 `last_modified` is a weak proxy; two table entries were misread | ACCEPTED. USGS rewrote `last_modified` for 7,465 Point of Rocks readings (all stamped 2026-11-13 19:41), so only about four days of its rhythm can be rebuilt, and lateness read from this field is an upper bound. The ":51 to :54" (Point of Rocks) and ":36 to :39" (Edwards Ferry) entries are single early readings ahead of a batch, not late batches. After the change the rhythm is measured from `tick_log.pub`, which records what the job read. |
| 3 Effects on the model that the plan missed | ACCEPTED, added to the plan as stated by the auditor: (a) the flow-state test (`getFlowState`, newest reading against one at least 6 h back) spans about 5.8 h instead of 4.9 h, so rising and falling states begin about an hour earlier and the bin that is applied and learned can differ; the same holds for the rise rate and the travel-time reduction. (b) Size of the shift in the estimate once the lag is gone: about +2.6% on a moderate rise (Point of Rocks +5 %/h), about +9% at a flood onset (+15 %/h), about -0.8% on a recession, about 0 at steady flow; the +/-5% gate can switch on about an hour earlier (a step of about 2.5%). Sign: the rising bins learned a negative raw error while the input lagged, so after the change the corrected estimate over-predicts on rises (the cautious direction) and slightly under-predicts on recessions, until the bins re-learn (remaining bias 0.7^n: about 34% after 3 rising validations, 12% after 6). The bins are NOT reset. (c) The estimate shown in the app is computed in the browser from its own fetch with the server's bins; its skew changes by a small amount. The changelog will say "the estimate changes because its inputs are fresher", not "estimation unchanged"; the version stays MINOR. |
| 4 Deploy hazard described the wrong way round | ACCEPTED: nothing is skipped by the forward change; a deploy going live between the old and the new minute causes one extra run in that hour. The deploy must go live between about :15 and :55. A rollback that goes live between :00 and :10 would count one false miss. |
| 5 Netlify and the push rule | ACCEPTED: the working rule becomes "no deploy may go live between :08 and :13" and is updated where it is kept (`.claude/HANDOFF.md`). |
| 6 Monitoring | ACCEPTED: the owner opens the check's schedule in healthchecks.io. If it is "simple" (period plus grace), a grace of at least 15 minutes is enough. If it is a cron expression at minute 0, it must be changed to minute 10 in the same window as the deploy, otherwise every run counts as late and alerts go out hourly. |
| 7 Options B and C were dismissed for the wrong reasons | ACCEPTED, and the options table is CORRECTED: C is possible. `analysis/ci_backtest_harness.mjs` replays the production model with its learning bins over 126,916 hourly observations from 2011 to 2026, floods included; replaying with the Point of Rocks input lagged by one hour, and switching mid-replay, would measure both the steady effect and the transient on real rises. It falls under the project's Empirical Analysis Protocol (plan, independent audit, blind dual-language check). B needs no production code either: the old-schedule estimate can be rebuilt offline from the `tick_log` trace and USGS history. Recommendation now: A at minute 10 with a written commitment to the offline comparison at the first logged rise; C before the change is the more careful route and is the owner's to choose. |
| 8 Verification | ACCEPTED: a new test pins the schedule string; the live check uses `tick_log.pub.t` and is run within the hour. |

---

# Outcome of option C (2026-11-18 UTC)

The owner chose option C on 2026-11-17. The replay analysis is complete: `analysis/replay_lag_2026-11-17/replay_lag_FINAL.md`.
On rising water, in the hours where the two versions of history differ, the fresher Point of Rocks reading makes
the estimate slightly worse (0.35 points of absolute percent error, 95% interval 0.22 to 0.49), because the flow
state flips to "rising" about an hour earlier and the rising-state corrections over-correct gentle onsets. The
pre-registered rule returns MOVE as a non-inferiority verdict, by 0.01 point; the orchestrator's recommendation
is not to move. The job stays at minute :00 until the owner decides (TODO D19). The first-order expectation in
the plan audit (the fresh estimate over-predicts on rises) was not borne out after correction: both versions
under-predict.

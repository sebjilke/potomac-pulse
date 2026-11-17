# Independent plan audit: Step 3 (job timing)

Auditor: a fresh subagent (Opus) that did not write the plan, read-only, 2026-11-17. Text extracted by script from the auditor's final report, not retyped.

## Audit: `analysis/usgs-step3-job-timing-plan-2026-11-17.md`

**Verdict:** the change can be built once the owner approves, but the plan needs edits first (listed at the end). Five findings are MAJOR (1, 2, 3, 6, 7). None is a BLOCKER.

**USGS requests used: 6 keyless GETs.** Point of Rocks, Edwards Ferry, Goose and Little Falls over 10 days (P10D), then Point of Rocks and Edwards Ferry over 30 days (P30D). Scratch files are in `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/audit3/`.

### Findings

**1. MAJOR: minute 5 is the wrong trade-off. The "cost" on the early gauges is not real.**
- Little Falls, Seneca, Broad Run and Monocacy publish at :46 to :58. Any run minute from :04 to about :45 reads exactly the same readings from them. That includes the validation truth (`scheduled-update.js:1233`, `actualCFS = lf.q`) and the 120% cap. "Five minutes older" only means the same reading, seen later.
- Simulated misses (run start at M min 55 s, availability taken from `last_modified`):
  - **Point of Rocks, about 95 hours:** at M=5 it misses the 14:09 batch, and the 20:07 batch today falls just after the simulated window, so 1 to 2 misses, both today. M=8 catches 20:07. M=10 catches both.
  - **Edwards Ferry, 716 hours (30 days):** 25 misses at M=5, 21 at M=10. Whole-hour batches came late at :07 to :29 on Oct 21, 22, 24 and 29, and on Nov 17 at 14:08 and 20:05:49 (the last one only 6 s before a :05:55 start).
  - **Goose:** 2 misses at M=5 (the two :06 batches), 0 at M=6.
- Today in hour 20 every gauge was late: Little Falls :00:25, Goose :03, Edwards Ferry :05:49, Point of Rocks :07:27.
- **Recommendation:** minute 10. It costs nothing on the early gauges.

**2. MAJOR: `last_modified` is a weak proxy, and the plan misreads part of its own table.**
- USGS rewrote `last_modified` for 7,465 Point of Rocks readings back to Oct 18 (all stamped 2026-11-13 19:41). The Point of Rocks rhythm can therefore be rebuilt for only about 4 days, whatever window is requested.
- Revisions can only push `last_modified` later. Apparent lateness is an upper bound. Whether today's 20:07 batch was published late or revised after a :02 publish cannot be told from this API.
- The Point of Rocks ":51 to :54" and Edwards Ferry ":36 to :39" entries are not late batches. Each is a single reading published ahead of its batch, on a cycle about every 8 hours that drifts 1 to 2 minutes each time. They make readings fresher, not staler.
- **Recommendation:** correct the evidence table. After the change, measure publish timing from `tick_log.pub.t`, which records what the job actually read.

**3. MAJOR: the plan misses effects on the model.**
- **(a) Flow state and bin assignment.** `getFlowState` (`model.js:466`, called at `scheduled-update.js:1052`) compares the newest reading with one at least 6 h before now. The span grows from about 4.9 h to about 5.8 h. The rise threshold falls from about 0.41 to 0.34 %/h, and rising/falling states start about 1 h earlier. That changes which bin is applied and learned, not only the value. The same span change affects the rise rate (`model.js:525-539`) and the travel-time reduction.
- **(b) Size of the transient.** When |pct| > 5 (`scheduled-update.js:1010-1020`, decay at its 0.5 cap): Δest/est ≈ 0.5·ratio·0.0092·r / (1 + 0.5·(ratio − 1)), with r the Point of Rocks change in %/h.

  | Situation | r | ratio | Shift in estimate |
  |---|---|---|---|
  | Moderate rise | +5 %/h | 1.3 | +2.6% |
  | Flood onset | +15 %/h | 2 | about +9% |
  | Recession | −2 %/h | 0.8 | −0.8% |
  | Steady | 0 | ~1 | about 0 |

  A fresher Edwards Ferry stage adds to this at high flow (blend weight up to 0.4). The ±5% gate can also switch on about an hour earlier, a step of about 2.5%.
- **Sign.** The rising bins learned a negative raw error, because the lagged raw estimate under-predicts on rises. After the change the corrected value over-predicts on rises, which is the cautious direction, and slightly under-predicts on recessions.
- **Re-learning.** The leftover bias shrinks as 0.7^n: about 34% after 3 rising validations, 12% after 6. With one pending prediction at a time (about 2 validations a day), it lasts several rise events.
- **(c) The app's displayed estimate.** It is computed in the browser (`great-falls.js:506`) from the browser's own fetch, about 35 min old on average, using the server's bins. Its skew flips from about +30 to about −24 minutes' worth of change. That is small.
- "Do nothing" is defensible: the shifts are inside the rising-state 90% bands (for example `0-3000` rising: −547 to +369 cfs). But the plan must state the sign and size above and leave a dated note to check at the first rise. Do not reset the bins.
- **Version.** MINOR holds literally (same inputs, same output). The changelog must still say "estimate changes (fresher inputs)", not "estimation unchanged". The versioning rule also requires `index.html` and footer updates, which conflicts with the non-goal "no change to the app"; reword it.

**4. MINOR: validation and timing are fine, but the deploy hazard is described the wrong way round.**
- Everything in item 3 of the brief checks out: it is relative to "now" or to the hour.
  - The due time (`:1114`), the 2.5 h cap (`model.js:872`) and the 90 h sweep (`:42`) all move with the run.
  - Forecasts due on the hour are validated against the same Little Falls reading either way.
  - The residual advisory's 12 h rule (`model.js:274`) and the snapshot and prune logic (`:2983`, `:3051`; the key is always T03:00) are unaffected.
  - Edwards Ferry divergence gains samples: readings older than 2 h (`model.js:138`) occurred in 11 of 716 hours at :00, and 0 at :05.
  - `computeRunHealth` (`:2079`): a 65 min gap gives round(1.08) = 1 cycle, and 55 min gives 1.
- The real hazard:
  - Forward change, deploy goes live at :01 to :05: an extra run 5 minutes after the :00 run (gap rounds to 0, so no miss counted). This means two tick rows in that hour and a double divergence sample. Nothing is skipped.
  - Rollback, deploy goes live at :00 to :05: a gap of about 115 min, counted as one false miss.

**5. MINOR: Netlify.** `"5 * * * *"` is standard cron, run in UTC (from my knowledge; not checked live). State the push window as the time the deploy goes live, since the build runs about 1,600 tests first. Update the rule where it is actually kept, `.claude/HANDOFF.md:70`.

**6. MAJOR: monitoring. "One false alert" is wrong for one setting.** The owner should open the check's schedule settings in healthchecks.io:
- **Simple (period plus grace):** alerts only if grace is under about 5 min, and then only once at the changeover.
- **Cron `0 * * * *`:** with grace under about 6 to 7 min, every run arrives late, so the check is down and emails go out every hour. Change the expression to the new minute in the same window as the deploy, and set grace to at least 10 min.

**7. MAJOR: options B and C are dismissed for the wrong reasons.**
- **C:** `analysis/ci_backtest_harness.mjs` already replays the real production model, including the learning bins, over 126,916 hourly observations from 2011 to 2026, floods included (`constants.js:89`). Replaying with `por_now` lagged one row, and switching mid-replay, measures the transient on real rises. That falls under the Empirical Analysis Protocol: plan, audit, Python and R.
- **B:** a like-for-like pair needs no new production code. Rebuild the :00-schedule raw estimate offline from the `tick_log` trace (`preCfs`, `histCfs`, `decay`, `pct`, `rawUnc`, `corr`) plus USGS history.
- **Recommendation:** A, with a written commitment to this offline comparison at the first rise. The owner's sign-off satisfies the Scientific/Modeling Work rule.

**8. MINOR: the verification section.** No test pins the schedule string today (searched `test/`); one must be written. The "newest published" check depends on `last_modified`, which can be rewritten, so run it within the hour or use `pub.t`.
- Still unverified: accuracy and the transient, the monitoring setting, how Netlify behaves at the changeover, and future late-batch rates.

### Changes needed before building
1. Choose minute 10, or justify minute 5 against the misses in finding 1.
2. Fix the evidence table (finding 2).
3. Add the flow-state effect and the transient's sign, size and dated note (finding 3).
4. Correct the deploy-hazard text (finding 4).
5. Correct the monitoring text (finding 6).
6. Add the new schedule test (finding 8).
7. Commit to the offline counterfactual (finding 7).
8. Reword the version and changelog lines (finding 3).

### Not checked
- Netlify documentation, live.
- The healthchecks.io configuration.
- The actual bin values in the database.
- How old the browser's fetched readings really are.
- Whether the 20:07 Point of Rocks batch was published late or revised.
- Seneca, Broad Run and Monocacy over more than the plan's 2 days.
- The tests were not run.

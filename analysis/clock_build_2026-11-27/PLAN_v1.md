# Build plan: a measured clock for scoring the Great Falls estimate

Plan version 1, 2026-11-27. Draft for the independent audit. Nothing is built, and no replay is run, before the audit, the rulings on it and the owner's confirmation.

Follows the clock study (`analysis/clock_study_2026-11-27/REPORT.md`, verdict TOO LONG) on the owner's word of 2026-11-27 ("go": measure, then plan the build). Facts for this plan: `FACTS.md` in this folder and the study's `FACTS.md`.

## 0. What the owner should know first

- **What changes:** one thing. The moment at which the hourly job scores an estimate against Little Falls. Today that is 6 to 14 hours after the estimate, by a formula that was never checked. After the build it is the measured travel time: about 5.5 hours at 1,500 cfs, 3.4 hours at 5,000, 2.6 hours at 10,000.
- **What that moves:** the corrections learn from a different Little Falls reading, so over days the shown number changes. That makes it a major version. The estimate before the correction does not change. The cap does not change.
- **What it does not fix:** a rise fed by creeks, like 26 and 27 November. The clock describes water coming down the main river.
- **The new clock is itself partly an assumption** (the split by distance). The replay below is scored on three clocks (central, long end, short end), and a finding counts only if it is the same on all three.
- **Scoring on the new clock favours the new clock.** An estimate that learned against a truth is closer to that truth. So the replay is not a test of whether the clock is right (the study did that). It shows what the change does to the shown number, and it guards against harm.
- **Nothing ships without the owner's word** after the replay's report.

## 1. The change, in one release

1. **Server, the due time** (`netlify/functions/scheduled-update.js:1117`): `validationDue = now + clock(Q)`, with `Q` the Little Falls flow the job holds at that run (never the past Point of Rocks flow), floored at 1,000 cfs, and
   `clock(Q) = 98.2 × Q^−0.3935` hours, never below 1.0 hour.
   This is 36% (the share by distance) of the study's fitted lag from Edwards Ferry to Little Falls (`273 × Q^−0.3935`). Values: 6.5 h at 1,000 cfs, 5.5 at 1,500, 4.9 at 2,000, 4.2 at 3,000, 3.4 at 5,000, 2.6 at 10,000, 2.0 at 20,000, 1.4 at 50,000.
2. **A new pure function** for it in `netlify/functions/shared/model.js` and its browser copy `src/model/shared-model.js`, bound by a parity test. The existing travel functions and constants are not touched: the time from Point of Rocks to Great Falls, which enters the estimate, shares a variable with the old Great Falls to Little Falls time (`mult`, `scheduled-update.js:953-972`), and must not move.
3. **Display:** the header line "Great Falls to Little Falls", the inputs panel row and the countdown in the locked section show the new clock.
4. **Logging:** the hourly log keeps the old value (`trv.gf2lf`) and gains the new one, so the two can be compared after release.
5. **Stored state:** the learned corrections are not reset and not edited (as at v36.0 and v39.0). A pending estimate stored before the release is scored at its stored due time.

**Not in this release, each a later decision:** the 48 hour forecast's offset in the browser and its scoring offset on the server (the same formula family; changing them changes the forecast cards); the time from Point of Rocks to Great Falls inside the estimate; the cap.

### Choices made here, open to the audit
- **The central value of the range, not the long end.** Reasons: the lower leg is faster per mile than the upper leg, and the four usable Difficult Run pulses sit at the split, not above it. The long end is about a fifth longer.
- **One relation for all states.** The low-water weeks suggest up to 1.5 hours more below 1,500 cfs (7.1 against 5.6 hours). The relation from rising water is used throughout, for simplicity.
- **Above 20,000 cfs the relation is extrapolated.** Nothing is measured there. At 50,000 cfs it gives 1.4 hours where today's formula gives 1.65; at 100,000 cfs 1.06 against 1.09. The replay guards high water separately (condition 4).
- **No extra shortening while the river rises.** The relation was measured on rising water.

## 2. What the replay must show before anything ships

### 2.1 The run
- **Tool:** `analysis/onset_correction_2026-11-25/tools/replay_onset.mjs`, copied into this folder with one new option that replaces the due time at its line 607 by `t + clock(Q)`, where `Q` is the Little Falls flow the model holds at that hour. Nothing else changes. An independent audit of the copy (the diff, a run without the option that must reproduce the existing file byte for byte, and a hand check of ten due times).
- **Two runs:** OLD (the existing main run, `replay_L/shadow_L.csv`) and NEW (the new option), same inputs, same settings.
- **Known side effect, wanted:** with a shorter clock the single pending slot frees sooner, so more estimates are scored per day (about 3 to 6 instead of 1.5 to 3.5) and the corrections move more often.

### 2.2 The common truth
Both runs are scored against the same truth: the Little Falls flow at the hour of the estimate plus the measured clock, rebuilt from the hourly record (hourly medians placed at the centre of their hour). Three versions: central (as in section 1), long end (`0.37 ×` the upper bound of the fitted lag) and short end (`0.4 × 0.34 ×` the lower bound), from the study's `clock_grid` relation. The replay's own scoring of each run is reported beside, not used.

### 2.3 Hours
Test years 2020-01-01 to 2026-11-09 for the conditions; 2012-12 to 2019 reported beside. Groups, fixed now: all hours with an estimate; **rising** (inside a rise window of the clock study, from the start of the limb to the Little Falls peak); **low water** (Little Falls below 3,000 cfs and outside every rise and recession window); **high water** (Little Falls at 12,000 cfs or more); the rising limbs of the 21 large rises, split into led by Point of Rocks and led by Little Falls.

### 2.4 Measures
Per hour: error of the shown value against the common truth, in percent; `d` = absolute error of NEW minus absolute error of OLD. Mean absolute error, mean signed error, share badly off (15% or more), badly low, badly high. Intervals by bootstrap over calendar months, 10,000 draws.

### 2.5 Conditions for SHIP, fixed in advance
A condition holds only if it holds on the central truth **and** on both ends.
1. **No loss overall:** the upper bound of the interval of mean `d` over all test hours is not above +0.05 points.
2. **Gain on rising water:** mean `d` on rising test hours is below 0 with the whole interval below 0 on the central truth, and not above 0 on either end.
3. **No loss at low water:** the upper bound of mean `d` on low-water test hours is not above +0.10 points.
4. **High water, where the clock is extrapolated:** the mean absolute error of NEW is not more than 5% (relative) above OLD's, on the common truth and also on OLD's own truth (the replay's scoring of the old run).
5. **Both halves of the test years** (before and from 2023-06-01): mean `d` on rising hours is not above 0 in either.
6. **The corrections stay calm:** the median absolute change of the applied correction from one scored estimate to the next, in percent of the estimate, is not more than 1.5 times OLD's.

Verdicts: **SHIP** (all six). **DO NOT SHIP** (condition 1 fails with the whole interval above +0.05 on the central truth, or condition 4 fails). **UNCLEAR** (everything else): the owner decides on the description.

### 2.6 Description, no conditions
- How far the shown number moves: the distribution of NEW minus OLD, by flow range and state.
- **The cap on the new clock:** error without the cap minus with it (run NEW), per group; "good job", "harm" or "unclear" only if the same on all three truths.
- **Two yardsticks beside the app** (run NEW): Y0, "Great Falls equals Little Falls now"; Y1, `LF_now + (LF_now − LF_3h_ago) / 3 × clock(Q)`, never below Y0. The app "beats" a yardstick, or the yardstick "beats the app", only if the reading is the same on all three truths.
- How the app's own accuracy line and the Little Falls notice would have read: scored estimates per day, share of scored estimates 15% or more low, under each run's own scoring.
- The large rises, by who led them.

## 3. The code change (after SHIP and the owner's word)

By the project's protocol for code changes: this plan and its audit, then implementation, then a fresh audit of the diff.
- **Files:** `netlify/functions/shared/model.js` and `src/model/shared-model.js` (the new function and its two constants), `netlify/functions/scheduled-update.js` (the due time at `:1117`, the log field, `SERVER_VERSION`, the log schema number), `src/estimation/great-falls.js` and `src/ui/great-falls-ui.js` (the three displayed places), `index.html` (version), tests, and the documents that carry the version (`CLAUDE.md`, `README.md`, `src/assets/CHANGELOG.md`, `src/assets/tech-appendix.md`, `TODO.md`).
- **Tests:** unit tests of the new function (values of section 1, the floors); a parity test for its two copies; a test that the due time uses the Little Falls flow of the run and is unaffected by a lookup that does not converge; the existing four exact-value cases of `travelTimeGFtoLF` stay green because that field is not touched; a test that the time from Point of Rocks to Great Falls is byte for byte as before on the existing cases.
- **Version:** major (the shown number changes over time through the learning).
- **After release:** a live check by a fresh verifier on the first scored estimates (the stored due time equals the run time plus `clock(Q)`; the version string on the rows; scored estimates per day), and a second check after two weeks comparing the logged old and new clocks and the errors.

## 4. What this plan cannot settle

- The true travel time below Great Falls. The three truths bound it.
- Creek-led rises. Reported in the split of the large rises, not solved.
- The forecast's offsets and the time from Point of Rocks to Great Falls, which rest on the same 1961 formula.
- The replay holds hourly values with readings one to two hours old; the live job has fresher readings.

## 5. Expected outcomes, written before the run

- The shown number moves little on most hours and by several percent on rising water.
- Conditions 1, 3 and 5 hold. Condition 2 holds on the central truth and the long end; on the short end the reading is open.
- High water: NEW and OLD within 2% of each other.
- The corrections move more often and a little more per step; condition 6 is the least certain.
- The cap does a good job on every group on all three truths. Y1 beats the app on rising hours; on all hours the app beats both yardsticks.

## 6. Roles and cost

Orchestrator: plan, rulings, synthesis. Tool change, specification, both analysts, implementation: Sonnet. Plan auditor, tool auditor, specification reviewer, third auditor, code auditor, live verifier: Opus. About ten agents over two stages; several hours; the laptop must stay awake.

## 7. Questions put to the plan auditor

1. Is the one-line change of section 1 really the whole change in what is learned and shown? Trace the due time through `scheduled-update.js` (truth, residuals, checks, history, the Little Falls notice, `validation_log`) and say what else moves. Is anything in the browser a second source of the due time?
2. Is the central value the right choice, and "one relation for all states"? What does the extrapolation above 20,000 cfs risk? Should low water get its own, longer value?
3. Section 2: both runs are scored on a truth that NEW learned against. Which conditions can NEW not fail by construction, and which can it not pass? Is "holds on all three truths" enough protection? Is there a fairer common truth?
4. Is the group "rising" (rise windows of the clock study) sound here, and are the thresholds of 2.5 sensible given the counts of hours in each group (count them)?
5. Condition 6: is the measure of calm defined well enough, and is 1.5 a sensible limit when more estimates are scored per day?
6. Is it right to leave the forecast's offsets out of this release? What does the app look like in between (a header that says 4 hours while the forecast cards still use the old offset)?
7. The stored state at release: is "no reset, pending row finishes on its old due time" safe? Is there a case where an old pending row blocks the new clock for long?
8. Section 3: which test or parity rule is missing? Does keeping `travelTimeGFtoLF` untouched and adding a new field avoid every silent change?
9. The strongest argument against building this at all, or for a smaller first step (for example: only log the new clock for some weeks).
